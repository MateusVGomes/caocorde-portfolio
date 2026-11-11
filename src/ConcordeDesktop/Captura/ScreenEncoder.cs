using System.Diagnostics;

namespace Concorde.Captura;

/// <param name="Encoder">"auto" ou o id de uma família (nvenc, amf, qsv, mf, x264): essa é testada primeiro.</param>
/// <param name="CursorJogo">Modo jogo: o Concorde desenha o cursor no vídeo (ver <see cref="CursorProprio"/>).</param>
public sealed record VideoSettings(CaptureSource Source, int Height /* 0 = nativa */, int Fps, int BitrateKbps, string Encoder = "auto", bool CursorJogo = false);

/// <summary>
/// Captura uma tela ou janela e codifica em H.264 usando o FFmpeg como subprocesso.
/// Testa encoders em ordem (GPU sem cópia → GPU com cópia pela CPU → CPU)
/// e usa o primeiro que funcionar nesta máquina. Emite "access units" (um quadro cada) em Annex B.
/// </summary>
public sealed class ScreenEncoder : IDisposable
{
    /// <summary>Quadro codificado e se ele é um keyframe (IDR).</summary>
    public event Action<byte[], bool>? FrameEncoded;

    /// <summary>A janela capturada foi fechada: não adianta tentar de novo.</summary>
    public event Action? SourceLost;

    public string? ActiveEncoder { get; private set; }

    /// <summary>"Aceleração de hardware" desligada nas Configurações: tudo pela CPU (x264, redução e cursor).</summary>
    public static bool SemAceleracao { get; set; }

    private VideoSettings _s;
    /// <summary>Muda a cada início do FFmpeg: o fim de um FFmpeg antigo (trocado de propósito) não reinicia nada.</summary>
    private int _geracao;

    /// <summary>
    /// Um reinício por vez (queda/keyframe e troca de qualidade): sem isso os dois podiam subir um FFmpeg cada
    /// e ficavam dois rodando — um deles sem o cursor do modo jogo.
    /// </summary>
    private readonly SemaphoreSlim _reinicio = new(1, 1);

    /// <summary>Reiniciando agora (a qualidade automática não mede o fps nesse meio tempo).</summary>
    public bool Reiniciando => _reinicio.CurrentCount == 0;
    private readonly string _ffmpeg;
    private Process? _proc;
    private volatile Process? _testando;   // FFmpeg em teste no StartAsync (o Dispose também mata ele)
    private volatile bool _stopping;

    public ScreenEncoder(string ffmpegPath, VideoSettings settings)
    {
        _ffmpeg = ffmpegPath;
        _s = settings;
        if (settings.CursorJogo) _cursor = new CursorProprio(settings.Source, settings.Fps);
    }

    private readonly CursorProprio? _cursor;

    private IEnumerable<(string Name, string Args)> Candidates()
    {
        int gop = _s.Fps; // keyframe a cada 1s: novos espectadores entram rápido e perdas se recuperam logo
        // force_key_frames: keyframe a cada 1 s marcado pelo próprio FFmpeg. Alguns drivers (RX 7600) ignoram o -g
        // e nunca mais geram keyframe depois do primeiro: quem entra depois só recebe P-frames e vê tela preta.
        // Testes: CONCORDE_DEBUG_GOP_INFINITO=1 imita o driver que ignora o -g; CONCORDE_DEBUG_SEM_FORCE=1 tira o force.
        if (Environment.GetEnvironmentVariable("CONCORDE_DEBUG_GOP_INFINITO") == "1") gop = 100000;
        string force = Environment.GetEnvironmentVariable("CONCORDE_DEBUG_SEM_FORCE") == "1" ? "" : " -force_key_frames expr:gte(t,n_forced*1)";
        // bufsize ~200 ms: limita o tamanho de cada quadro (o quadro-chave não vira uma rajada de centenas de pacotes).
        string rate = $"-b:v {_s.BitrateKbps}k -maxrate {_s.BitrateKbps}k -bufsize {Math.Max(_s.BitrateKbps / 5, 200)}k -g {gop} -bf 0{force}";
        var src = _s.Source;

        // gfxcapture (Windows Graphics Capture): pega tela ou janela pelo handle e já redimensiona na GPU.
        // Quadro sempre 16:9 (janelas com outra proporção ganham faixas pretas); "nativa" só arredonda para par.
        string size = _s.Height > 0
            ? $":width={_s.Height * 16 / 9 / 2 * 2}:height={_s.Height}:resize_mode=scale_aspect"
            : ":width=-2:height=-2";
        string handle = src.Kind == SourceKind.Window ? $"hwnd={src.Handle}" : $"hmonitor={src.Handle}";
        // fps=: o gfxcapture só entrega quadro quando algo muda na tela. Janela parada = quase nenhum quadro,
        // e aí o keyframe demora e quem entra fica vendo tela preta. O filtro repete o último quadro no ritmo certo.
        string gfx = $"gfxcapture={handle}:max_framerate={_s.Fps}:capture_cursor=1{size},fps={_s.Fps}";
        string gfxDown = $"{gfx},hwdownload,format=bgra,format=nv12";

        // Todas saem em H.264 Constrained Baseline (o que qualquer navegador decodifica no WebRTC).
        var gpu = new (string Id, string Name, string Enc)[]
        {
            // forced-idr / forced_idr: o keyframe forçado vira IDR (sem isso o NVENC faz só um I comum, que o navegador não usa para começar).
            ("nvenc", "NVIDIA NVENC", $"-c:v h264_nvenc -preset p1 -tune ll -zerolatency 1 -forced-idr 1 -rc cbr -profile:v baseline {rate}"),
            // header_spacing: SPS/PPS a cada keyframe (drivers novos podem mandar só no começo → quem entra depois vê preto).
            // aud 0: o FFmpeg já põe o AUD; forced_idr: todo I-frame é IDR (ponto de entrada para quem chega).
            // enforce_hrd/max_au_size: sem isso o AMF estoura o bufsize quando a imagem mexe muito (quadros enormes →
            // fila no roteador de quem transmite, ping de 20 para 600 ms e fps instável). Teto = os mesmos ~200 ms.
            ("amf",   "AMD AMF",      $"-c:v h264_amf -usage ultralowlatency -quality speed -rc cbr -enforce_hrd 1 -max_au_size {Math.Max(_s.BitrateKbps / 5, 200) * 1000} -profile:v constrained_baseline -header_spacing {gop} -aud 0 -forced_idr 1 {rate}"),
            ("qsv",   "Intel QSV",    $"-c:v h264_qsv -preset veryfast -forced_idr 1 -profile:v baseline {rate}"),
            // Encoder genérico do Windows: usa o chip de vídeo de qualquer marca (plano B se o driver específico falhar).
            ("mf",    "Windows Media Foundation", $"-c:v h264_mf -hw_encoding 1 -scenario display_remoting -rate_control cbr -profile:v 66 {rate}"),
        };
        if (SemAceleracao) gpu = [];   // aceleração desligada: só a CPU
        const string x264 = "-c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline";
        var cpu = ("CPU x264 (sem GPU compatível)", $"-f lavfi -i {gfxDown} {x264} {rate}");

        // Modo jogo (cursor sumindo): em muitos jogos o Windows mostra o cursor num "plano de hardware" que a captura não
        // junta na imagem (some também no Go Live e no Meet). A captura vai sem cursor, em tamanho real, e o próprio
        // Concorde cola o cursor por cima (CursorProprio) antes de reduzir. Vale para tela e para janela.
        int? saidaDxgi = src.Kind == SourceKind.Monitor ? Dxgi.SaidaDoMonitor(src.Handle) : null;
        if (_cursor != null)
        {
            // Com qualidade menor que a tela, a PLACA reduz a imagem antes de ela vir para a memória do PC (antes vinha
            // inteira — 1440p a 60 fps são ~900 MB/s de cópia — e a CPU reduzia). Aí só o cursor é colado na CPU, já pequeno.
            Size? alvo = null;
            if (_s.Height > 0 && src.Kind == SourceKind.Monitor && _s.Height < src.MonitorBounds.Height)
                alvo = new Size(_s.Height * src.MonitorBounds.Width / src.MonitorBounds.Height / 2 * 2, _s.Height);
            else if (_s.Height > 0 && src.Kind == SourceKind.Window)
                alvo = new Size(_s.Height * 16 / 9 / 2 * 2, _s.Height);   // janela: quadro 16:9 com faixas pretas
            // Teste: CONCORDE_DEBUG_JOGO_CPU=1 volta ao caminho antigo (imagem inteira para a CPU), para comparar.
            _cursor.Alvo = SemAceleracao || Environment.GetEnvironmentVariable("CONCORDE_DEBUG_JOGO_CPU") == "1" ? null : alvo;
            string escala;
            string cap;
            if (_cursor.Alvo is { } a)
            {
                cap = $"gfxcapture={handle}:max_framerate={_s.Fps}:capture_cursor=0:width={a.Width}:height={a.Height}:resize_mode=scale_aspect,fps={_s.Fps},hwdownload,format=bgra";
                escala = $",pad={a.Width}:{a.Height}:-1:-1,setsar=1";   // garante o tamanho exato (sem custo se já veio certo)
            }
            else
            {
                cap = $"gfxcapture={handle}:max_framerate={_s.Fps}:capture_cursor=0:width=-2:height=-2,fps={_s.Fps},hwdownload,format=bgra";
                if (src.Kind == SourceKind.Monitor)
                    escala = _s.Height > 0 && _s.Height != src.MonitorBounds.Height ? $",scale=-2:{_s.Height}:flags=fast_bilinear" : "";
                else
                {
                    // Janela: quadro fixo (16:9 na qualidade escolhida, ou o tamanho dela agora) — se ela mudar de tamanho, só encaixa.
                    var t = _s.Height > 0 ? new Size(_s.Height * 16 / 9 / 2 * 2, _s.Height) : CursorProprio.TamanhoJanela(src.Handle);
                    escala = $",scale={t.Width}:{t.Height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear,pad={t.Width}:{t.Height}:-1:-1,setsar=1";
                }
            }
            string jogo(string enc) => $"-f lavfi -i {cap} {_cursor.Entrada} -filter_complex \"{_cursor.Filtros()}{escala},format=nv12[v]\" -map \"[v]\" {enc}";
            foreach (var (id, name, enc) in gpu.OrderBy(g => g.Id == _s.Encoder ? 0 : 1)) yield return ($"{name} (modo jogo)", jogo(enc));
            yield return ("CPU x264 (modo jogo)", jogo($"{x264} {rate}"));
        }
        if (_s.Encoder == "x264") yield return cpu;

        // Placa escolhida na janela: tenta todos os caminhos dela (direto e com cópia) antes de cair para as outras.
        var chosen = gpu.FirstOrDefault(g => g.Id == _s.Encoder);
        if (chosen.Id != null)
        {
            yield return ($"{chosen.Name} (direto na GPU)", $"-f lavfi -i {gfx} {chosen.Enc}");
            yield return (chosen.Name, $"-f lavfi -i {gfxDown} {chosen.Enc}");
            gpu = gpu.Where(g => g.Id != chosen.Id).ToArray();
        }

        // 1) captura → encoder da GPU sem passar pela CPU
        if (Environment.GetEnvironmentVariable("CONCORDE_SEM_DIRETO") != "1") // só para testar os caminhos 2 e 3
            foreach (var (_, name, enc) in gpu) yield return ($"{name} (direto na GPU)", $"-f lavfi -i {gfx} {enc}");
        // 2) placa de captura ≠ placa do encoder (notebooks com 2 GPUs): copia pela CPU
        foreach (var (_, name, enc) in gpu) yield return (name, $"-f lavfi -i {gfxDown} {enc}");
        if (_s.Encoder != "x264") yield return cpu;

        // 3) Windows antigo sem gfxcapture: Desktop Duplication (só tela inteira)
        if (saidaDxgi is { } saidaAntiga)
        {
            string cpuScale = _s.Height > 0 ? $",scale=-2:{_s.Height}:flags=fast_bilinear" : "";
            string dda = $"ddagrab=output_idx={saidaAntiga}:framerate={_s.Fps}:draw_mouse=1,hwdownload,format=bgra{cpuScale},format=nv12";
            foreach (var (_, name, enc) in gpu) yield return ($"{name} (captura antiga)", $"-f lavfi -i {dda} {enc}");
            yield return ("CPU x264 (captura antiga)", $"-f lavfi -i {dda} {x264} {rate}");
        }
    }

    /// <summary>Inicia o primeiro candidato que produzir vídeo. Retorna false se nenhum funcionar.</summary>
    public async Task<bool> StartAsync()
    {
        if (_heartbeat == null)
        {
            _heartbeat = new CaptureHeartbeat(_s.Source, () => (Stopwatch.GetTimestamp() - Interlocked.Read(ref _lastFrameTimestamp)) * 1000 / Stopwatch.Frequency);
            _heartbeat.Start();
        }
        // Reinício (queda ou troca de qualidade): o encoder que já estava funcionando primeiro, sem testar os outros antes.
        var candidatos = Candidates().ToList();
        if (ActiveEncoder != null) candidatos = candidatos.OrderBy(c => c.Name == ActiveEncoder ? 0 : 1).ToList();
        foreach (var (name, args) in candidatos)
        {
            if (_stopping) break;   // desistiram no meio do teste (ajuste ao vivo que demorou demais)
            var firstFrame = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            // Modo jogo: cada FFmpeg ganha a porta do cursor na hora de iniciar (a lista de candidatos é montada antes).
            var proc = Launch(_cursor != null && args.Contains("{PORTA}") ? args.Replace("{PORTA}", _cursor.NovaPorta().ToString()) : args);
            _testando = proc;
            var reader = Task.Run(() => ReadLoop(proc, firstFrame));
            var done = await Task.WhenAny(firstFrame.Task, reader, Task.Delay(4000));
            _testando = null;
            if (done == firstFrame.Task && !_stopping)
            {
                _proc = proc;
                ActiveEncoder = name;
                _vigia ??= new System.Threading.Timer(_ => VigiarResolucao(), null, 1000, 1000);
                _lastErrors.Clear(); // erros dos candidatos que falharam no teste não interessam mais
                int geracao = ++_geracao;
                _ = reader.ContinueWith(t => { if (geracao == _geracao) RestartAfterCrash(t.Exception?.InnerException); });
                return true;
            }
            try { proc.Kill(); } catch { }
            await reader.ContinueWith(_ => { });
        }
        return false;
    }

    /// <summary>
    /// A captura do Windows cai em situações normais (UAC, jogo em tela cheia, mudança de resolução).
    /// Em vez de congelar a transmissão, reinicia sozinho — testando os encoders de novo se preciso.
    /// </summary>
    private async void RestartAfterCrash(Exception? ex)
    {
        if (_stopping) return;
        // Já tem uma troca de qualidade em andamento: ela sobe o FFmpeg novo.
        if (!await _reinicio.WaitAsync(0)) return;
        try { await ReiniciarAsync(ex); }
        finally { _reinicio.Release(); }
    }

    private async Task ReiniciarAsync(Exception? ex)
    {
        if (!_s.Source.IsAlive)
        {
            Console.WriteLine("[vídeo] a janela que estava sendo transmitida foi fechada.");
            SourceLost?.Invoke();
            return;
        }
        string why = ex?.Message ?? string.Join(" | ", _lastErrors.ToArray().TakeLast(2));
        Console.WriteLine($"[vídeo] a captura parou{(why.Length > 0 ? $" ({why})" : "")} — reiniciando…");
        try { _proc?.Kill(); } catch { }
        for (int attempt = 1; !_stopping; attempt++)
        {
            await Task.Delay(Math.Min(attempt, 5) * 1000);
            if (_stopping) return;
            if (!_s.Source.IsAlive) { Console.WriteLine("[vídeo] a janela foi fechada."); SourceLost?.Invoke(); return; }
            if (await StartAsync())
            {
                Console.WriteLine($"[vídeo] voltou ({ActiveEncoder})");
                return;
            }
        }
    }

    private System.Threading.Timer? _vigia;
    private int _resolucaoNova;

    /// <summary>
    /// Jogo em tela cheia exclusiva com resolução menor que a do monitor (ARK, Tekken): ao abrir, ele troca a resolução
    /// do monitor, mas a captura continua com o tamanho antigo — a imagem fica num canto com faixa preta à direita e
    /// embaixo (acontece até no Medal). A cada 1 s confere o tamanho do monitor; mudou e ficou 2 s assim: reinicia.
    /// </summary>
    private async void VigiarResolucao()
    {
        var src = _s.Source;
        if (_stopping || Reiniciando || src.Kind != SourceKind.Monitor || TamanhoMonitor(src.Handle) is not { } agora) return;
        if (agora == src.MonitorBounds) { _resolucaoNova = 0; return; }
        if (++_resolucaoNova < 2) return;
        _resolucaoNova = 0;
        if (!await _reinicio.WaitAsync(0)) return;
        try
        {
            Console.WriteLine($"[vídeo] a tela mudou de {src.MonitorBounds.Width}×{src.MonitorBounds.Height} para {agora.Width}×{agora.Height} — reiniciando a captura");
            var nova = src with { MonitorBounds = agora };
            _s = _s with { Source = nova };
            _cursor?.TrocarFonte(nova);
            await TrocarAgoraAsync(_s.Height, _s.Fps, _s.BitrateKbps);
        }
        catch { }
        finally { _reinicio.Release(); }
    }

    private static Rectangle? TamanhoMonitor(nint hmonitor)
    {
        var mi = new MONITORINFO { cbSize = System.Runtime.InteropServices.Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(hmonitor, ref mi)) return null;
        return Rectangle.FromLTRB(mi.rcMonitor.Left, mi.rcMonitor.Top, mi.rcMonitor.Right, mi.rcMonitor.Bottom);
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct RECTM { public int Left, Top, Right, Bottom; }
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct MONITORINFO { public int cbSize; public RECTM rcMonitor, rcWork; public uint dwFlags; }
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(nint hmonitor, ref MONITORINFO mi);

    /// <summary>
    /// Qualidade automática: troca altura, fps e taxa no meio da transmissão. O FFmpeg não muda a taxa andando,
    /// então reinicia com o mesmo encoder (~1 s sem quadros; o próximo já é keyframe com o tamanho novo).
    /// </summary>
    public async Task<bool> TrocarAsync(int altura, int fps, int kbps)
    {
        if (_stopping) return false;
        await _reinicio.WaitAsync();
        try { return await TrocarAgoraAsync(altura, fps, kbps); }
        finally { _reinicio.Release(); }
    }

    private async Task<bool> TrocarAgoraAsync(int altura, int fps, int kbps)
    {
        _s = _s with { Height = altura, Fps = fps, BitrateKbps = kbps };
        if (_cursor != null) _cursor.Fps = fps;
        _geracao++;   // o fim deste FFmpeg não é queda
        var velho = _proc;
        _proc = null;
        try { velho?.Kill(); } catch { }
        if (velho != null) await Task.Run(() => { try { velho.WaitForExit(3000); } catch { } });
        return await StartAsync();
    }

    private readonly System.Collections.Concurrent.ConcurrentQueue<string> _lastErrors = new();
    private CaptureHeartbeat? _heartbeat;
    private long _lastFrameTimestamp;
    private long _framesOut, _bytesOut;

    /// <summary>Total de quadros e bytes codificados até agora (para mostrar fps/Mbps na janela).</summary>
    public (long Frames, long Bytes) Counters => (Interlocked.Read(ref _framesOut), Interlocked.Read(ref _bytesOut));

    /// <summary>
    /// Jogo pesado (ARK) deixa a placa a 100%: o Windows atende o jogo primeiro e a captura saía a ~11 de 60 fps,
    /// com a internet sobrando. Igual o OBS: pede prioridade alta na placa (e um pouco mais de CPU) para o FFmpeg,
    /// que captura e codifica. Funciona sem administrador, mas só depois que o processo começou a usar a placa
    /// (antes o Windows responde "parâmetro inválido"): tenta por alguns segundos depois de abrir o FFmpeg.
    /// </summary>
    private static void Prioridade(Process p)
    {
        try { p.PriorityClass = ProcessPriorityClass.AboveNormal; } catch { }
        _ = Task.Run(async () =>
        {
            int r = -1;
            for (int i = 0; i < 20 && r != 0; i++)
            {
                await Task.Delay(250);
                try { if (p.HasExited) return; r = D3DKMTSetProcessSchedulingPriorityClass(p.Handle, 4 /* HIGH */); } catch { return; }
            }
            Console.WriteLine(r == 0 ? "[vídeo] prioridade alta na placa" : $"[vídeo] prioridade na placa recusada (0x{r:X8})");
        });
    }

    [System.Runtime.InteropServices.DllImport("gdi32.dll")]
    private static extern int D3DKMTSetProcessSchedulingPriorityClass(IntPtr processo, int prioridade);

    private Process Launch(string encodeArgs)
    {
        var psi = new ProcessStartInfo(_ffmpeg,
            $"-hide_banner -nostdin -loglevel error -fflags nobuffer {encodeArgs} -bsf:v h264_metadata=aud=insert,dump_extra=freq=keyframe -flush_packets 1 -f h264 pipe:1")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        var p = Filhos.Prender(Process.Start(psi)!);
        Prioridade(p);
        p.ErrorDataReceived += (sender, e) =>
        {
            if (e.Data == null) return;
            if (Verbose) Console.WriteLine("[ffmpeg] " + e.Data);
            _lastErrors.Enqueue(e.Data);
            while (_lastErrors.Count > 10) _lastErrors.TryDequeue(out _);
        };
        p.BeginErrorReadLine();
        return p;
    }

    public static bool Verbose { get; set; }
    private static readonly bool Debug = Environment.GetEnvironmentVariable("CONCORDE_DEBUG") == "1";

    /// <summary>Lê o H.264 Annex B do stdout e corta em quadros usando os delimitadores AUD (NAL tipo 9).</summary>
    private void ReadLoop(Process proc, TaskCompletionSource firstFrame)
    {
        var stream = proc.StandardOutput.BaseStream;
        var buf = new byte[4 * 1024 * 1024];
        int len = 0, scanFrom = 4;
        long debugBytes = 0, debugReads = 0, debugAt = Stopwatch.GetTimestamp();
        while (true)
        {
            if (len == buf.Length) Array.Resize(ref buf, buf.Length * 2);
            int n = stream.Read(buf, len, buf.Length - len);
            if (n <= 0) break;
            len += n;
            if (Debug)
            {
                debugBytes += n; debugReads++;
                if (Stopwatch.GetElapsedTime(debugAt).TotalSeconds >= 2)
                {
                    Console.WriteLine($"[debug] pid {proc.Id}: {debugBytes / 1024} KB em {debugReads} leituras, buffer {len} B, quadros até agora {Interlocked.Read(ref _framesOut)}");
                    debugBytes = debugReads = 0;
                    debugAt = Stopwatch.GetTimestamp();
                }
            }

            int auStart = 0;
            for (int i = Math.Max(scanFrom, auStart + 4); i + 4 < len; i++)
            {
                // 00 00 01 09 → início do próximo quadro. Só corta se o pedaço acumulado já tem imagem:
                // AMD (AMF) e Media Foundation já põem um AUD próprio e o h264_metadata põe outro, então vem
                // "AUD AUD fatia". Cortar no segundo AUD criaria um "quadro" vazio — o dobro de quadros e o
                // relógio do vídeo correndo 2× mais rápido, e o navegador de quem assiste não mostra nada.
                if (buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 1 && (buf[i + 3] & 0x1F) == 9)
                {
                    int cut = i > 0 && buf[i - 1] == 0 ? i - 1 : i; // inclui o 4º zero de 00 00 00 01
                    // O quadro termina logo depois da última fatia de imagem: SPS/PPS que o encoder põe
                    // antes do AUD do próximo keyframe vão junto com ele (senão quem entra não decodifica).
                    int end = cut > auStart ? PictureEnd(buf.AsSpan(auStart, cut - auStart)) : -1;
                    if (end > 0)
                    {
                        Emit(buf.AsSpan(auStart, end), firstFrame);
                        auStart += end;
                    }
                    i += 3;
                }
            }
            if (auStart > 0)
            {
                Buffer.BlockCopy(buf, auStart, buf, 0, len - auStart);
                len -= auStart;
            }
            scanFrom = Math.Max(4, len - 4);
        }
    }

    /// <summary>
    /// Onde termina a imagem neste pedaço: início da primeira NAL depois da última fatia (tipos 1 a 5),
    /// ou o fim do pedaço. -1 se ainda não tem nenhuma fatia (só AUD/SPS/PPS — o quadro continua).
    /// </summary>
    private static int PictureEnd(ReadOnlySpan<byte> piece)
    {
        int end = -1;
        bool afterPicture = false;
        for (int i = 0; i + 3 < piece.Length; i++)
        {
            if (piece[i] != 0 || piece[i + 1] != 0 || piece[i + 2] != 1) continue;
            int start = i > 0 && piece[i - 1] == 0 ? i - 1 : i;
            int type = piece[i + 3] & 0x1F;
            if (type is >= 1 and <= 5) { afterPicture = true; end = -1; }
            else if (afterPicture && end < 0) end = start;
            i += 2;
        }
        return !afterPicture ? -1 : end < 0 ? piece.Length : end;
    }

    private byte[]? _sps, _pps;
    private bool _spsSeenOnce, _warnedNoHeaders;
    private static readonly bool DebugStripHeaders = Environment.GetEnvironmentVariable("CONCORDE_DEBUG_SEM_SPS") == "1";
    private static readonly bool DebugNoHeaderFix = Environment.GetEnvironmentVariable("CONCORDE_DEBUG_SEM_CORRECAO") == "1";

    private void Emit(ReadOnlySpan<byte> au, TaskCompletionSource firstFrame)
    {
        // Separa as NALs do quadro: guarda SPS/PPS e vê se é keyframe (IDR).
        var nals = new List<(int Start, int End, int Type)>();
        for (int i = 0; i + 3 < au.Length; i++)
        {
            if (au[i] != 0 || au[i + 1] != 0 || au[i + 2] != 1) continue;
            int start = i > 0 && au[i - 1] == 0 ? i - 1 : i;
            if (nals.Count > 0) nals[^1] = (nals[^1].Start, start, nals[^1].Type);
            nals.Add((start, au.Length, au[i + 3] & 0x1F));
            i += 2;
        }
        bool key = nals.Any(n => n.Type == 5);
        bool hasSps = nals.Any(n => n.Type == 7);

        // Teste: simula encoder que só manda SPS/PPS no primeiro quadro (o que deixava a tela preta).
        if (DebugStripHeaders && _spsSeenOnce && hasSps)
        {
            var kept = new List<byte>();
            foreach (var n in nals) if (n.Type is not (7 or 8)) kept.AddRange(au[n.Start..n.End].ToArray());
            Emit2(kept.ToArray(), key, firstFrame, nals.Where(n => n.Type is not (7 or 8)).ToList(), stripped: true);
            return;
        }
        Emit2(au.ToArray(), key, firstFrame, nals, stripped: false);
    }

    private void Emit2(byte[] frame, bool key, TaskCompletionSource firstFrame, List<(int Start, int End, int Type)> nals, bool stripped)
    {
        if (!stripped)
        {
            foreach (var n in nals)
            {
                if (n.Type == 7) { _sps = frame[n.Start..n.End]; _spsSeenOnce = true; }
                if (n.Type == 8) _pps = frame[n.Start..n.End];
            }
        }
        // O navegador só abre um keyframe que venha com SPS/PPS junto. Alguns encoders (drivers AMD novos, por
        // exemplo) só mandam no início: quem entra depois fica com tela preta. Então repete os últimos que vimos.
        if (key && !nals.Any(n => n.Type == 7) && _sps != null && _pps != null && !DebugNoHeaderFix)
        {
            if (!_warnedNoHeaders)
            {
                _warnedNoHeaders = true;
                Console.WriteLine("[vídeo] o encoder não repete SPS/PPS nos keyframes — o Concorde está repetindo por ele");
            }
            frame = [.. _sps, .. _pps, .. frame];
        }
        long now = Stopwatch.GetTimestamp();
        Interlocked.Exchange(ref _lastFrameTimestamp, now);
        Interlocked.Increment(ref _framesOut);
        Interlocked.Add(ref _bytesOut, frame.Length);
        firstFrame.TrySetResult();
        FrameEncoded?.Invoke(frame, key);
        CheckKeyframes(key, now);
    }

    private long _lastKeyTimestamp, _lastKeyRestart;

    /// <summary>
    /// Rede de segurança: se passarem 3 s com quadros saindo e nenhum keyframe, quem entrar agora fica com tela
    /// preta. Reinicia a captura (todo começo é keyframe) — no máximo uma vez a cada 30 s para não entrar em laço.
    /// </summary>
    private void CheckKeyframes(bool key, long now)
    {
        if (key || _lastKeyTimestamp == 0) { _lastKeyTimestamp = now; return; }
        if (Stopwatch.GetElapsedTime(_lastKeyTimestamp, now).TotalSeconds < 3) return;
        if (_lastKeyRestart != 0 && Stopwatch.GetElapsedTime(_lastKeyRestart, now).TotalSeconds < 30) return;
        _lastKeyRestart = now;
        _lastKeyTimestamp = now;
        Console.WriteLine($"[vídeo] o encoder ({ActiveEncoder}) parou de gerar keyframes — reiniciando a captura");
        try { _proc?.Kill(); } catch { } // o leitor termina e o RestartAfterCrash sobe tudo de novo
    }

    public void Dispose()
    {
        _stopping = true;
        _vigia?.Dispose();
        _heartbeat?.Dispose();
        try { _testando?.Kill(); } catch { }
        try { _proc?.Kill(); } catch { }
        _proc?.Dispose();
        _cursor?.Dispose();
    }

    /// <summary>Procura o ffmpeg.exe: ao lado do programa, no PATH ou na instalação do winget.</summary>
    public static string? FindFfmpeg()
    {
        var local = Path.Combine(AppContext.BaseDirectory, "ffmpeg.exe");
        if (File.Exists(local)) return local;
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            try { var p = Path.Combine(dir.Trim(), "ffmpeg.exe"); if (File.Exists(p)) return p; } catch { }
        }
        var winget = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WinGet", "Packages");
        if (Directory.Exists(winget))
            return Directory.EnumerateFiles(winget, "ffmpeg.exe", SearchOption.AllDirectories).FirstOrDefault();
        return null;
    }
}
