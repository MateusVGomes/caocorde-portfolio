
namespace Concorde.Captura;

/// <summary>
/// Modo jogo: jogo em tela cheia/sem borda sem nada por cima vira "flip independente" — o Windows deixa o jogo mandar a
/// imagem direto para a placa, sem passar pelo compositor. Aí o cursor (e filtros de tela, como a Tela Calma) ficam de fora
/// e somem da transmissão. Em modo janela funciona porque a barra de tarefas fica por cima e obriga o Windows a compor.
/// Esta janela faz o mesmo papel enquanto transmite: cobre o monitor, é quase transparente (alfa 1/255), o clique passa
/// por ela, não pega foco e não aparece na barra de tarefas.
/// </summary>
public sealed class ForcarComposicao : IDisposable
{
    private Thread? _thread;
    private Form? _form;

    public ForcarComposicao(Rectangle monitor)
    {
        var pronto = new ManualResetEventSlim();
        _thread = new Thread(() =>
        {
            _form = new Camada(monitor);
            _form.Shown += (_, _) => pronto.Set();
            Application.Run(_form);
        }) { IsBackground = true, Name = "forcar-composicao" };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        pronto.Wait(2000);
        Console.WriteLine("[cursor] camada por cima do jogo (força o Windows a compor a tela)");
    }

    public void Dispose()
    {
        var f = _form;
        _form = null;
        try { f?.BeginInvoke(f.Close); } catch { }
    }

    private sealed class Camada : Form
    {
        public Camada(Rectangle monitor)
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Bounds = monitor;
            BackColor = Color.Black;
            Opacity = 1.0 / 255;
            TopMost = true;
        }

        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                // LAYERED (transparência) | TRANSPARENT (clique passa) | TOOLWINDOW (fora do Alt+Tab) | NOACTIVATE | TOPMOST
                cp.ExStyle |= 0x80000 | 0x20 | 0x80 | 0x8000000 | 0x8;
                return cp;
            }
        }

        // Sem WDA_EXCLUDEFROMCAPTURE: excluída da captura, o Windows pinta de PRETO o que fica embaixo dela na
        // transmissão (o jogo sumia). Com alfa 1/255 ela aparece na captura sem diferença visível.
    }
}
