using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Concorde.Captura;

/// <summary>Um app que tem (ou teve) som aberto no Windows, agrupado pelo processo principal.</summary>
public sealed record AudioApp(string Exe, string Name, int RootPid)
{
    public bool IsDiscord => Exe.StartsWith("discord", StringComparison.OrdinalIgnoreCase);
    public override string ToString() => Name;
}

/// <summary>
/// Lista os apps com sessão de áudio em qualquer saída de som ativa (alto-falante, fone...).
/// Usa a API de sessões do Windows — precisa rodar em thread MTA (chame via Task.Run).
/// </summary>
public static class AudioApps
{
    public static List<AudioApp> List()
    {
        var pids = new HashSet<int>();
        try
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            enumerator.EnumAudioEndpoints(0 /* eRender */, 1 /* ACTIVE */, out var devices);
            devices.GetCount(out uint count);
            for (uint i = 0; i < count; i++)
            {
                // Um dispositivo com problema (driver, fone desconectando) não pode esconder os apps dos outros.
                try
                {
                    devices.Item(i, out var device);
                    var iid = typeof(IAudioSessionManager2).GUID;
                    device.Activate(ref iid, 1 /* CLSCTX_INPROC_SERVER */, 0, out var obj);
                    var manager = (IAudioSessionManager2)obj;
                    manager.GetSessionEnumerator(out var sessions);
                    sessions.GetCount(out int n);
                    for (int s = 0; s < n; s++)
                    {
                        try
                        {
                            sessions.GetSession(s, out var session);
                            if (session.GetProcessId(out uint pid) >= 0 && pid != 0) pids.Add((int)pid);
                            Marshal.ReleaseComObject(session);
                        }
                        catch (Exception ex) { Console.WriteLine($"[áudio] sessão {s} do dispositivo {i}: {ex.Message}"); }
                    }
                    Marshal.ReleaseComObject(sessions);
                    Marshal.ReleaseComObject(manager);
                    Marshal.ReleaseComObject(device);
                }
                catch (Exception ex) { Console.WriteLine($"[áudio] dispositivo {i}: {ex.Message}"); }
            }
            Marshal.ReleaseComObject(devices);
            Marshal.ReleaseComObject(enumerator);
        }
        catch (Exception ex) { Console.WriteLine($"[áudio] não consegui listar os apps com som ({ex.Message})"); }

        // O Discord entra na lista mesmo calado, para dar para desmarcar antes da call começar.
        if (ProcessLoopbackCapture.FindDiscordRoot() is { } discord) pids.Add(discord.Id);

        var apps = new Dictionary<int, AudioApp>();
        foreach (var pid in pids)
        {
            // O próprio Concorde e os processos dele (o WebView2 da janela) não entram na lista.
            if (pid == Environment.ProcessId || IsOurChild(pid)) continue;
            var root = RootOf(pid);
            if (root == null || apps.ContainsKey(root.Id)) continue;
            apps[root.Id] = new AudioApp(root.ProcessName.ToLowerInvariant(), FriendlyName(root), root.Id);
        }
        // Mesmo programa com várias raízes (raro): fica um item por nome, o mais antigo.
        return apps.Values.GroupBy(a => a.Exe).Select(g => g.OrderBy(a => a.RootPid).First())
            .OrderBy(a => a.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    /// <summary>Sobe pelos pais enquanto for o mesmo executável (ex.: o processo de áudio do Chrome → Chrome principal).</summary>
    private static Process? RootOf(int pid)
    {
        Process p;
        try { p = Process.GetProcessById(pid); } catch { return null; }
        for (int guard = 0; guard < 16; guard++)
        {
            int parentPid = ProcessLoopbackCapture.GetParentPid(p);
            Process parent;
            try { parent = Process.GetProcessById(parentPid); } catch { break; }
            if (!string.Equals(parent.ProcessName, p.ProcessName, StringComparison.OrdinalIgnoreCase)) break;
            p = parent;
        }
        return p;
    }

    private static bool IsOurChild(int pid)
    {
        try
        {
            var p = Process.GetProcessById(pid);
            for (int guard = 0; guard < 8; guard++)
            {
                int parent = ProcessLoopbackCapture.GetParentPid(p);
                if (parent == Environment.ProcessId) return true;
                if (parent <= 0) return false;
                p = Process.GetProcessById(parent);
            }
        }
        catch { }
        return false;
    }

    private static string FriendlyName(Process p)
    {
        try
        {
            var desc = p.MainModule?.FileVersionInfo.FileDescription;
            if (!string.IsNullOrWhiteSpace(desc)) return desc.Trim();
        }
        catch { }
        return p.ProcessName;
    }

    // ---------------- Interop (Core Audio) ----------------

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        void EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection
    {
        void GetCount(out uint count);
        void Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        void Activate(ref Guid iid, int clsCtx, nint activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionManager2
    {
        void GetAudioSessionControl(nint sessionGuid, int flags, out nint control);
        void GetSimpleAudioVolume(nint sessionGuid, int flags, out nint volume);
        void GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionEnumerator
    {
        void GetCount(out int count);
        void GetSession(int index, out IAudioSessionControl2 session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2
    {
        // IAudioSessionControl
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName(out nint name);
        [PreserveSig] int SetDisplayName(nint name, nint ctx);
        [PreserveSig] int GetIconPath(out nint path);
        [PreserveSig] int SetIconPath(nint path, nint ctx);
        [PreserveSig] int GetGroupingParam(out Guid g);
        [PreserveSig] int SetGroupingParam(ref Guid g, nint ctx);
        [PreserveSig] int RegisterAudioSessionNotification(nint client);
        [PreserveSig] int UnregisterAudioSessionNotification(nint client);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier(out nint id);
        [PreserveSig] int GetSessionInstanceIdentifier(out nint id);
        [PreserveSig] int GetProcessId(out uint pid);
    }
}
