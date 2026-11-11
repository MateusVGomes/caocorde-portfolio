using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Concorde;

/// <summary>
/// Atalhos globais (igual o Discord): funcionam com o jogo ou outro app na frente. Usa um "gancho" de teclado
/// (WH_KEYBOARD_LL) que só ESCUTA as teclas e deixa elas seguirem: a mesma tecla pode mutar o Discord e o
/// Concorde juntos. (Antes era RegisterHotKey, que reservava a tecla só para o Concorde — o F8 parava de chegar
/// no Discord.) O gancho roda na thread da janela principal: tem de ser criado e usado nela.
/// </summary>
internal sealed class Atalhos : IDisposable
{
    private const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
    private const int VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;
    private const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_SHIFT = 4;

    private readonly List<(string Acao, uint Mods, uint Vk)> _lista = [];
    private readonly HashSet<uint> _apertadas = [];   // segurar a tecla não repete a ação
    private readonly HookProc _proc;                   // guardado: o coletor de lixo não pode levar o delegate
    private readonly Control _ui;
    private IntPtr _gancho;

    /// <summary>A pessoa apertou o atalho de uma ação ("mudo", "surdo", "camera").</summary>
    public event Action<string>? Acionado;

    public Atalhos(Control ui)
    {
        _ui = ui;
        _proc = Gancho;
    }

    /// <summary>Troca todos os atalhos. Devolve as combinações inválidas (com o gancho, nenhum app "toma" a tecla).</summary>
    public List<string> Definir(IEnumerable<(string Acao, string Combo)> lista)
    {
        _lista.Clear();
        var invalidos = new List<string>();
        foreach (var (acao, combo) in lista)
        {
            if (Ler(combo) is { } t) _lista.Add((acao, t.Mods, t.Vk));
            else invalidos.Add(combo);
        }
        if (_lista.Count > 0 && _gancho == IntPtr.Zero)
            _gancho = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(Process.GetCurrentProcess().MainModule?.ModuleName), 0);
        else if (_lista.Count == 0) Soltar();
        return invalidos;
    }

    /// <summary>"Ctrl+Shift+M" → modificadores e tecla virtual. Só letras, números e F1–F24 (o que a página deixa gravar).</summary>
    private static (uint Mods, uint Vk)? Ler(string combo)
    {
        uint mods = 0, vk = 0;
        foreach (var parte in combo.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            switch (parte)
            {
                case "Ctrl": mods |= MOD_CONTROL; break;
                case "Alt": mods |= MOD_ALT; break;
                case "Shift": mods |= MOD_SHIFT; break;
                default:
                    if (parte.Length == 1 && char.IsAsciiLetterOrDigit(parte[0])) vk = char.ToUpperInvariant(parte[0]);
                    else if (parte.Length is 2 or 3 && parte[0] == 'F' && int.TryParse(parte[1..], out int f) && f is >= 1 and <= 24) vk = (uint)(0x6F + f);
                    else return null;
                    break;
            }
        }
        // Letra ou número sozinho roubaria a digitação no PC inteiro.
        if (vk == 0 || (mods == 0 && vk < 0x70)) return null;
        return (mods, vk);
    }

    /// <summary>Chamado pelo Windows a cada tecla do PC inteiro: tem de ser rápido e SEMPRE passar a tecla adiante.</summary>
    private IntPtr Gancho(int codigo, IntPtr wParam, IntPtr lParam)
    {
        if (codigo >= 0)
        {
            int msg = (int)wParam;
            uint vk = (uint)Marshal.ReadInt32(lParam);
            if (msg is WM_KEYUP or WM_SYSKEYUP) _apertadas.Remove(vk);
            else if (msg is WM_KEYDOWN or WM_SYSKEYDOWN && _apertadas.Add(vk))
            {
                uint mods = (Apertada(VK_CONTROL) ? MOD_CONTROL : 0) | (Apertada(VK_MENU) ? MOD_ALT : 0) | (Apertada(VK_SHIFT) ? MOD_SHIFT : 0);
                foreach (var (acao, m, v) in _lista)
                    if (v == vk && m == mods) { _ui.BeginInvoke(() => Acionado?.Invoke(acao)); break; }
            }
        }
        return CallNextHookEx(_gancho, codigo, wParam, lParam);
    }

    private static bool Apertada(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;

    private void Soltar()
    {
        if (_gancho != IntPtr.Zero) UnhookWindowsHookEx(_gancho);
        _gancho = IntPtr.Zero;
    }

    public void Dispose() => Soltar();

    private delegate IntPtr HookProc(int codigo, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int idHook, HookProc fn, IntPtr hMod, uint threadId);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hhk, int codigo, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vk);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? nome);
}
