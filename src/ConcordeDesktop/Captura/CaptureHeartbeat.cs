using System.Runtime.InteropServices;

namespace Concorde.Captura;

/// <summary>
/// O Windows Graphics Capture só entrega quadro quando a imagem muda. Com a tela/janela parada
/// não sai nada: o filtro fps do FFmpeg trava esperando o próximo quadro e quem entra fica sem keyframe.
/// Enquanto a imagem estiver parada (&gt;90 ms sem quadro), este "marca-passo" força o Windows a gerar um:
///  - janela: pede para ela se redesenhar (RedrawWindow);
///  - tela: alterna a cor de uma janelinha de 2×2 px praticamente invisível no canto daquela tela.
/// </summary>
public sealed class CaptureHeartbeat : IDisposable
{
    private readonly CaptureSource _src;
    private readonly Func<long> _msSinceLastFrame;
    private Thread? _thread;
    private PokeForm? _form;
    private int _redrawInFlight;

    public CaptureHeartbeat(CaptureSource src, Func<long> msSinceLastFrame)
    {
        _src = src;
        _msSinceLastFrame = msSinceLastFrame;
    }

    public void Start()
    {
        var ready = new ManualResetEventSlim();
        _thread = new Thread(() =>
        {
            // Janela só para tela inteira; para janela de app basta o laço de mensagens com o timer.
            _form = new PokeForm(_src.Kind == SourceKind.Monitor ? _src.MonitorBounds : Rectangle.Empty);
            using var timer = new System.Windows.Forms.Timer { Interval = 100 };
            timer.Tick += (_, _) => Tick();
            timer.Start();
            ready.Set();
            Application.Run(_form);
        }) { IsBackground = true, Name = "CaptureHeartbeat" };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        ready.Wait(2000);
    }

    private bool _announced;

    private void Tick()
    {
        if (_msSinceLastFrame() < 90) return;
        if (!_announced)
        {
            _announced = true;
            Console.WriteLine("[vídeo] imagem parada — forçando a captura a mandar quadros");
        }
        if (_src.Kind == SourceKind.Monitor) { _form?.Poke(); return; }
        // RedrawWindow em janela de outro processo pode demorar se o app estiver travado: fora desta thread.
        if (Interlocked.Exchange(ref _redrawInFlight, 1) == 1) return;
        ThreadPool.QueueUserWorkItem(_ =>
        {
            try { RedrawWindow(_src.Handle, 0, 0, RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_UPDATENOW); }
            finally { Volatile.Write(ref _redrawInFlight, 0); }
        });
    }

    public void Dispose()
    {
        try { _form?.BeginInvoke(() => _form.Close()); } catch { }
        _thread?.Join(1000);
    }

    /// <summary>Janelinha 2×2 px, quase transparente, que não rouba foco nem clique e não aparece na barra de tarefas.</summary>
    private sealed class PokeForm : Form
    {
        private bool _flip;

        public PokeForm(Rectangle monitor)
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            BackColor = Color.Black;
            Opacity = monitor.IsEmpty ? 0 : 0.02;
            MinimumSize = Size.Empty;
            Bounds = monitor.IsEmpty ? new Rectangle(-10, -10, 1, 1) : new Rectangle(monitor.Right - 2, monitor.Bottom - 2, 2, 2);
        }

        public void Poke()
        {
            _flip = !_flip;
            BackColor = _flip ? Color.FromArgb(1, 1, 1) : Color.Black;
        }

        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x80 /* TOOLWINDOW */ | 0x20 /* TRANSPARENT: cliques passam */ | 0x08000000 /* NOACTIVATE */;
                return cp;
            }
        }
    }

    private const uint RDW_INVALIDATE = 0x0001, RDW_ALLCHILDREN = 0x0080, RDW_UPDATENOW = 0x0100;
    [DllImport("user32.dll")] private static extern bool RedrawWindow(nint hwnd, nint rect, nint rgn, uint flags);
}
