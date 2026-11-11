using System.Runtime.InteropServices;

namespace Concorde;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        // Uma janela só: abrir de novo traz para a frente a que já está aberta.
        // Reinício pedido pelo próprio app (trocou a aceleração de hardware): espera a janela antiga terminar de fechar.
        string nome = MainWindow.Teste ? @"Local\Concorde.Teste" : @"Local\Concorde.App";
        bool reinicio = Environment.GetCommandLineArgs().Contains("--reiniciar");
        var mutex = new Mutex(true, nome, out bool primeiro);
        for (int i = 0; reinicio && !primeiro && i < 50; i++)
        {
            mutex.Dispose();
            Thread.Sleep(200);
            mutex = new Mutex(true, nome, out primeiro);
        }
        using var _ = mutex;
        if (!primeiro)
        {
            var existente = FindWindow(null, MainWindow.Titulo);
            if (existente != IntPtr.Zero)
            {
                ShowWindow(existente, 9 /* SW_RESTORE */);
                SetForegroundWindow(existente);
            }
            return;
        }

        // Registro da captura/transmissão (FFmpeg, placa, som, conexão) para diagnosticar problema no PC de alguém.
        try
        {
            var pasta = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), MainWindow.Teste ? "Concorde-Teste" : "Concorde");
            Directory.CreateDirectory(pasta);
            Console.SetOut(new StreamWriter(Path.Combine(pasta, "concorde.log"), append: false) { AutoFlush = true });
        }
        catch { }

        Preferencias.Carregar();
        Captura.ScreenEncoder.SemAceleracao = !Preferencias.Aceleracao;

        ApplicationConfiguration.Initialize();
        Application.Run(new MainWindow());
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string? cls, string title);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr h);
}
