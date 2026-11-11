using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text;

namespace Concorde.Captura;

public enum SourceKind { Monitor, Window }

/// <summary>
/// O que transmitir: uma tela inteira ou a janela de um app. O mesmo handle (HMONITOR/HWND) vai para
/// o FFmpeg (gfxcapture) e para a prévia, então a prévia mostra exatamente o que está sendo enviado.
/// </summary>
public sealed record CaptureSource(SourceKind Kind, nint Handle, int MonitorIndex, Rectangle MonitorBounds, string Label, string Key, string Name)
{
    public override string ToString() => Label;

    public bool IsAlive => Kind == SourceKind.Monitor || IsWindow(Handle);

    public bool IsMinimized => Kind == SourceKind.Window && IsIconic(Handle);

    /// <summary>Telas primeiro, depois as janelas de apps abertas (sem as do próprio Concorde).</summary>
    public static List<CaptureSource> List()
    {
        var list = new List<CaptureSource>();
        var screens = Screen.AllScreens;
        for (int i = 0; i < screens.Length; i++)
        {
            var b = screens[i].Bounds;
            var hmon = MonitorFromPoint(new POINT { X = b.Left + b.Width / 2, Y = b.Top + b.Height / 2 }, 2);
            list.Add(new CaptureSource(SourceKind.Monitor, hmon, i, b,
                $"🖥  Tela {i + 1}{(screens[i].Primary ? " (principal)" : "")} — {b.Width}×{b.Height}", $"tela:{i}",
                screens.Length > 1 ? $"Tela {i + 1}" : "Tela inteira"));
        }

        int self = Environment.ProcessId;
        var windows = new List<CaptureSource>();
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd) || GetWindow(hwnd, 4 /* GW_OWNER */) != 0) return true;
            if ((GetWindowLongPtr(hwnd, -20 /* GWL_EXSTYLE */) & 0x80 /* WS_EX_TOOLWINDOW */) != 0) return true;
            if (DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, out int cloaked, 4) == 0 && cloaked != 0) return true;
            int len = GetWindowTextLength(hwnd);
            if (len == 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(hwnd, sb, sb.Capacity);
            var title = sb.ToString();
            GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == self || title == "Program Manager") return true;
            string exe;
            try { exe = Process.GetProcessById((int)pid).ProcessName; } catch { return true; }
            var shortTitle = title.Length > 55 ? title[..52] + "…" : title;
            // Nome para quem assiste: título sem emojis/contadores de notificação, ex.: "(3) YouTube" → "YouTube".
            var name = System.Text.RegularExpressions.Regex.Replace(new string(title.Where(c => !char.IsSurrogate(c)).ToArray()), @"^\(\d+\)\s*", "").Trim();
            windows.Add(new CaptureSource(SourceKind.Window, hwnd, -1, Rectangle.Empty,
                $"🪟  {shortTitle}  ({exe})", $"janela:{exe.ToLowerInvariant()}", name.Length > 50 ? name[..47] + "…" : name));
            return true;
        }, 0);
        list.AddRange(windows.OrderBy(w => w.Label, StringComparer.CurrentCultureIgnoreCase));
        return list;
    }

    /// <summary>Miniatura do que está sendo capturado, para a prévia na janela do Concorde.</summary>
    public Bitmap? GrabPreview(Size max)
    {
        try
        {
            Bitmap full;
            if (Kind == SourceKind.Monitor)
            {
                full = new Bitmap(MonitorBounds.Width, MonitorBounds.Height);
                using var g = Graphics.FromImage(full);
                g.CopyFromScreen(MonitorBounds.Location, Point.Empty, MonitorBounds.Size);
            }
            else
            {
                if (!IsWindow(Handle) || IsIconic(Handle) || !GetWindowRect(Handle, out var r)) return null;
                int w = r.Right - r.Left, h = r.Bottom - r.Top;
                if (w <= 0 || h <= 0) return null;
                full = new Bitmap(w, h);
                using var g = Graphics.FromImage(full);
                var hdc = g.GetHdc();
                PrintWindow(Handle, hdc, 2 /* PW_RENDERFULLCONTENT: funciona com apps desenhados pela GPU */);
                g.ReleaseHdc(hdc);
            }
            using (full)
            {
                double scale = Math.Min((double)max.Width / full.Width, (double)max.Height / full.Height);
                var thumb = new Bitmap(Math.Max(1, (int)(full.Width * scale)), Math.Max(1, (int)(full.Height * scale)));
                using var tg = Graphics.FromImage(thumb);
                tg.InterpolationMode = InterpolationMode.Bilinear;
                tg.DrawImage(full, 0, 0, thumb.Width, thumb.Height);
                return thumb;
            }
        }
        catch { return null; }
    }

    // ---------------- Interop ----------------

    private delegate bool EnumWindowsProc(nint hwnd, nint lParam);
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, nint lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")] private static extern nint GetWindow(nint hwnd, uint cmd);
    [DllImport("user32.dll")] private static extern nint GetWindowLongPtr(nint hwnd, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(nint hwnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(nint hwnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out RECT r);
    [DllImport("user32.dll")] private static extern bool PrintWindow(nint hwnd, nint hdc, uint flags);
    [DllImport("user32.dll")] private static extern nint MonitorFromPoint(POINT pt, uint flags);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint hwnd, int attr, out int value, int size);
}
