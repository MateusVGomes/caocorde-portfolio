using System.IO.Pipes;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using NetMQ;
using NetMQ.Sockets;

namespace Concorde.Captura;

/// <summary>
/// Modo jogo: o próprio Concorde desenha o cursor no vídeo (como o OBS). Em muitos jogos o Windows mostra o cursor
/// num "plano de hardware" que a captura de tela não junta na imagem — por isso ele some também no Go Live e no Meet —
/// e o Desktop Duplication do FFmpeg não desenha cursores monocromáticos/"mascarados".
/// Aqui a forma vem do GetCursorInfo + DrawIconEx (qualquer tipo de cursor) e vai para o FFmpeg como um vídeo pequeno
/// (<see cref="Lado"/>², BGRA, por um named pipe); a posição vai por comandos zmq para o filtro overlay.
/// </summary>
public sealed class CursorProprio : IDisposable
{
    public const int Lado = 128;
    private static readonly bool Debug = Environment.GetEnvironmentVariable("CONCORDE_DEBUG") == "1";

    private volatile CaptureSource _src;
    /// <summary>Muda junto com a qualidade automática (vale no próximo início do FFmpeg).</summary>
    public int Fps { get => _fps; set => _fps = Math.Max(1, value); }
    private int _fps;
    private readonly string _pipe = $"concorde-cursor-{Environment.ProcessId}-{Guid.NewGuid():N}";
    private volatile byte[] _quadro = new byte[Lado * Lado * 4];
    private volatile int _porta;

    /// <summary>
    /// Tamanho do quadro quando a placa de vídeo já reduz a captura (modo jogo pela GPU). O cursor é desenhado no
    /// quadro reduzido: posição e tamanho na mesma escala (e com as faixas pretas de janela fora de 16:9). null = nativo.
    /// </summary>
    public Size? Alvo { get; set; }
    private volatile bool _parar;
    private readonly Thread _escritor, _posicao;

    /// <summary>A tela mudou de resolução (jogo em tela cheia exclusiva): as contas do cursor passam a usar o tamanho novo.</summary>
    public void TrocarFonte(CaptureSource src) => _src = src;

    public CursorProprio(CaptureSource src, int fps)
    {
        _src = src;
        _fps = fps;
        _escritor = new Thread(Escrever) { IsBackground = true, Name = "cursor-imagem" };
        _posicao = new Thread(Acompanhar) { IsBackground = true, Name = "cursor-posicao" };
        _escritor.Start();
        _posicao.Start();
    }

    /// <summary>Entrada do FFmpeg com a imagem do cursor (fica sempre a 1ª depois da captura: [1:v]).</summary>
    public string Entrada => $"-f rawvideo -pix_fmt bgra -video_size {Lado}x{Lado} -framerate {_fps} -thread_queue_size 4 -i \\\\.\\pipe\\{_pipe}";

    /// <summary>
    /// Filtros que juntam a captura [0:v] com o cursor [1:v]. A porta do zmq fica como {PORTA}: quem inicia o FFmpeg
    /// troca por uma nova com <see cref="NovaPorta"/> (cada FFmpeg novo — reinício ou troca de qualidade — ganha a sua).
    /// Os dois lados ganham relógio pelo número do quadro, para o overlay nunca esperar um pelo outro.
    /// </summary>
    public string Filtros()
    {
        // Imagem do cursor na escala do quadro (fixa até o próximo início; a posição acompanha a janela mudar de tamanho).
        var (s, _, _) = Escala();
        int lado = Math.Max(8, (int)Math.Round(Lado * s) / 2 * 2);
        string reduzir = s < 0.999 ? $",scale={lado}:{lado}:flags=bilinear" : "";
        return $"[0:v]setpts=N/{_fps}/TB[cap];[1:v]setpts=N/{_fps}/TB{reduzir}[cur];" +
               $"[cap][cur]overlay@cursor=x=-{Lado}:y=-{Lado}:format=auto:eof_action=repeat," +
               "zmq=bind_address=tcp\\\\://127.0.0.1\\\\:{PORTA}";
    }

    /// <summary>Escala e deslocamento do quadro reduzido em relação ao que é capturado (1 e 0 sem <see cref="Alvo"/>).</summary>
    private (double S, double X, double Y) Escala()
    {
        if (Alvo is not { } a || Area() is not { } r) return (1, 0, 0);
        double w = r.Right - r.Left, h = r.Bottom - r.Top;
        if (w <= 0 || h <= 0) return (1, 0, 0);
        double s = Math.Min(a.Width / w, a.Height / h);
        return (s, (a.Width - w * s) / 2, (a.Height - h * s) / 2);
    }

    /// <summary>Área capturada na tela (monitor inteiro, ou a moldura visível da janela); null se a janela sumiu.</summary>
    private RECT? Area()
    {
        if (_src.Kind == SourceKind.Monitor)
        {
            var b = _src.MonitorBounds;
            return new RECT { Left = b.Left, Top = b.Top, Right = b.Right, Bottom = b.Bottom };
        }
        return !IsIconic(_src.Handle) && DwmGetWindowAttribute(_src.Handle, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, out RECT r, Marshal.SizeOf<RECT>()) == 0 ? r : null;
    }

    /// <summary>Porta nova para o próximo FFmpeg (o acompanhamento do cursor passa a falar com ela).</summary>
    public int NovaPorta() => _porta = PortaLivre();

    /// <summary>Tamanho da janela como a captura de janela vê (moldura visível), arredondado para par.</summary>
    public static Size TamanhoJanela(nint h) =>
        DwmGetWindowAttribute(h, 9, out RECT r, Marshal.SizeOf<RECT>()) == 0 ? new Size((r.Right - r.Left) / 2 * 2, (r.Bottom - r.Top) / 2 * 2) : new Size(1280, 720);

    private static int PortaLivre()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        int p = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return p;
    }

    /// <summary>Manda a imagem atual sem parar: o pipe só aceita o que o FFmpeg consome, então anda no ritmo do vídeo.</summary>
    private void Escrever()
    {
        while (!_parar)
        {
            try
            {
                using var servidor = new NamedPipeServerStream(_pipe, PipeDirection.Out, 1, PipeTransmissionMode.Byte, PipeOptions.None, 0, Lado * Lado * 4);
                servidor.WaitForConnection();
                while (!_parar) servidor.Write(_quadro, 0, _quadro.Length);
            }
            catch (IOException) { }      // o FFmpeg fechou (reinício): espera o próximo
            catch (ObjectDisposedException) { return; }
        }
    }

    /// <summary>Lê o cursor do Windows ~2× por quadro e avisa o overlay quando a posição muda.</summary>
    private void Acompanhar()
    {
        RequestSocket? sock = null;
        int portaSock = 0, ultX = int.MinValue, ultY = int.MinValue;
        nint ultCursor = -1;
        var intervalo = TimeSpan.FromMilliseconds(Math.Max(4, 500 / Math.Max(_fps, 1)));
        try
        {
            while (!_parar)
            {
                Thread.Sleep(intervalo);
                if (_porta == 0) continue;
                if (sock == null || portaSock != _porta)
                {
                    sock?.Dispose();
                    sock = new RequestSocket();
                    sock.Options.Linger = TimeSpan.Zero;
                    portaSock = _porta;
                    sock.Connect($"tcp://127.0.0.1:{portaSock}");
                    ultX = ultY = int.MinValue;   // FFmpeg novo começa com o cursor escondido
                }

                var (x, y, cursor) = Onde();
                if (cursor != ultCursor)
                {
                    _quadro = cursor == 0 ? new byte[Lado * Lado * 4] : Desenhar(cursor, out _);
                    ultCursor = cursor;
                }
                if (x == ultX && y == ultY) continue;
                if (!Comando(sock, $"overlay@cursor x {x}") || !Comando(sock, $"overlay@cursor y {y}"))
                {
                    if (Debug) Console.WriteLine($"[cursor] sem resposta do FFmpeg na porta {portaSock}");
                    sock.Dispose(); sock = null;  // REQ travado sem resposta: recria (o FFmpeg pode estar reiniciando)
                    continue;
                }
                if (Debug) Console.WriteLine($"[cursor] {x},{y} ({cursor})");
                ultX = x; ultY = y;
            }
        }
        catch (ObjectDisposedException) { }
        finally { sock?.Dispose(); }
    }

    private static bool Comando(RequestSocket sock, string cmd)
    {
        if (!sock.TrySendFrame(TimeSpan.FromMilliseconds(200), cmd)) return false;
        return sock.TryReceiveFrameString(TimeSpan.FromMilliseconds(300), out _);
    }

    /// <summary>Onde desenhar (canto da imagem, já descontando o "ponto quente") nas coordenadas da captura.</summary>
    private (int X, int Y, nint Cursor) Onde()
    {
        var fora = (-Lado, -Lado, (nint)0);
        var ci = new CURSORINFO { cbSize = Marshal.SizeOf<CURSORINFO>() };
        if (!GetCursorInfo(ref ci) || (ci.flags & 1) == 0 || ci.hCursor == 0) return fora;   // escondido pelo app/jogo

        // A captura de janela pega a moldura visível (sem a borda invisível do Windows 10/11).
        if (Area() is not { } area) return fora;
        // Janela: só mostra o cursor quando ele está mesmo em cima dela (não sobre outra que a cobre).
        if (_src.Kind == SourceKind.Window && GetAncestor(WindowFromPoint(ci.pt), 2 /* GA_ROOT */) != _src.Handle) return fora;
        if (ci.pt.X < area.Left || ci.pt.Y < area.Top || ci.pt.X >= area.Right || ci.pt.Y >= area.Bottom) return fora;
        Desenhar(ci.hCursor, out var quente);
        var (s, dx, dy) = Escala();
        return ((int)Math.Round((ci.pt.X - area.Left - quente.X) * s + dx), (int)Math.Round((ci.pt.Y - area.Top - quente.Y) * s + dy), ci.hCursor);
    }

    private readonly Dictionary<nint, (byte[] Img, Point Quente)> _cache = new();

    /// <summary>
    /// Desenha o cursor em BGRA com transparência. Pinta duas vezes, em fundo preto e em fundo branco: a diferença dá a
    /// transparência de cada pixel — funciona com cursor colorido, "mascarado" e monocromático (os invertidos viram branco).
    /// </summary>
    private byte[] Desenhar(nint cursor, out Point quente)
    {
        if (_cache.TryGetValue(cursor, out var c)) { quente = c.Quente; return c.Img; }
        quente = Point.Empty;
        var img = new byte[Lado * Lado * 4];
        if (!GetIconInfo(cursor, out var ii)) return img;
        int w = 32, h = 32;
        try
        {
            if (GetObject(ii.hbmColor != 0 ? ii.hbmColor : ii.hbmMask, Marshal.SizeOf<BITMAP>(), out BITMAP bm) != 0)
            {
                w = bm.bmWidth;
                h = ii.hbmColor != 0 ? bm.bmHeight : bm.bmHeight / 2;   // monocromático: máscara AND + XOR empilhadas
            }
        }
        finally
        {
            if (ii.hbmMask != 0) DeleteObject(ii.hbmMask);
            if (ii.hbmColor != 0) DeleteObject(ii.hbmColor);
        }
        // Cursor maior que o quadro (acessibilidade): reduz para caber.
        double escala = Math.Min(1.0, (double)Lado / Math.Max(w, h));
        int dw = Math.Max(1, (int)(w * escala)), dh = Math.Max(1, (int)(h * escala));
        quente = new Point((int)(ii.xHotspot * escala), (int)(ii.yHotspot * escala));

        var preto = PintarSobre(cursor, dw, dh, 0x00000000);
        var branco = PintarSobre(cursor, dw, dh, 0x00FFFFFF);
        for (int y = 0; y < dh; y++)
            for (int x = 0; x < dw; x++)
            {
                int i = (y * Lado + x) * 4;
                int b0 = preto[i], g0 = preto[i + 1], r0 = preto[i + 2];
                int b1 = branco[i], g1 = branco[i + 1], r1 = branco[i + 2];
                int a = 255 - ((b1 - b0) + (g1 - g0) + (r1 - r0)) / 3;
                if (a <= 0) continue;
                if (a >= 255 || b1 < b0) { img[i] = (byte)b0; img[i + 1] = (byte)g0; img[i + 2] = (byte)r0; img[i + 3] = 255; continue; }
                img[i] = (byte)Math.Min(255, b0 * 255 / a);
                img[i + 1] = (byte)Math.Min(255, g0 * 255 / a);
                img[i + 2] = (byte)Math.Min(255, r0 * 255 / a);
                img[i + 3] = (byte)a;
            }
        _cache[cursor] = (img, quente);
        return img;
    }

    private static byte[] PintarSobre(nint cursor, int w, int h, uint fundo)
    {
        var bmi = new BITMAPINFO { biSize = 40, biWidth = Lado, biHeight = -Lado, biPlanes = 1, biBitCount = 32 };
        nint tela = GetDC(0), dc = CreateCompatibleDC(tela);
        nint dib = CreateDIBSection(dc, ref bmi, 0, out nint bits, 0, 0);
        nint antigo = SelectObject(dc, dib);
        try
        {
            var px = new byte[Lado * Lado * 4];
            for (int i = 0; i < px.Length; i += 4) { px[i] = (byte)(fundo >> 16); px[i + 1] = (byte)(fundo >> 8); px[i + 2] = (byte)fundo; }
            Marshal.Copy(px, 0, bits, px.Length);
            DrawIconEx(dc, 0, 0, cursor, w, h, 0, 0, 3 /* DI_NORMAL */);
            GdiFlush();
            Marshal.Copy(bits, px, 0, px.Length);
            return px;
        }
        finally
        {
            SelectObject(dc, antigo);
            DeleteObject(dib);
            DeleteDC(dc);
            ReleaseDC(0, tela);
        }
    }

    public void Dispose()
    {
        _parar = true;
        // Destrava o WaitForConnection do escritor conectando e soltando na hora.
        try { using var c = new NamedPipeClientStream(".", _pipe, PipeDirection.In); c.Connect(100); } catch { }
    }

    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct CURSORINFO { public int cbSize, flags; public nint hCursor; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] private struct ICONINFO { public bool fIcon; public int xHotspot, yHotspot; public nint hbmMask, hbmColor; }
    [StructLayout(LayoutKind.Sequential)] private struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public short bmPlanes, bmBitsPixel; public nint bmBits; }
    [StructLayout(LayoutKind.Sequential)] private struct BITMAPINFO { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }

    [DllImport("user32.dll")] private static extern bool GetCursorInfo(ref CURSORINFO ci);
    [DllImport("user32.dll")] private static extern bool GetIconInfo(nint h, out ICONINFO ii);
    [DllImport("user32.dll")] private static extern bool DrawIconEx(nint dc, int x, int y, nint icon, int w, int h, int step, nint brush, int flags);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint h);
    [DllImport("user32.dll")] private static extern nint WindowFromPoint(POINT p);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint h, int flags);
    [DllImport("user32.dll")] private static extern nint GetDC(nint h);
    [DllImport("user32.dll")] private static extern int ReleaseDC(nint h, nint dc);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint h, int attr, out RECT r, int size);
    [DllImport("gdi32.dll")] private static extern int GetObject(nint h, int size, out BITMAP bm);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(nint h);
    [DllImport("gdi32.dll")] private static extern nint CreateCompatibleDC(nint dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(nint dc);
    [DllImport("gdi32.dll")] private static extern nint SelectObject(nint dc, nint obj);
    [DllImport("gdi32.dll")] private static extern bool GdiFlush();
    [DllImport("gdi32.dll")] private static extern nint CreateDIBSection(nint dc, ref BITMAPINFO bmi, uint usage, out nint bits, nint section, uint offset);
}
