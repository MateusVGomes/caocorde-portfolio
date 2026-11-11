using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Concorde;

/// <summary>
/// FFmpeg e yt-dlp morrem junto com o app, mesmo se ele travar ou for fechado à força pelo Gerenciador de Tarefas
/// (senão a captura e o download continuam rodando sozinhos, gastando CPU e deixando a tela "compartilhando").
/// Usa um Job Object do Windows: quando o app some, o Windows fecha o job e encerra o que estiver dentro.
/// O instalador da atualização automática não entra no job (ele precisa continuar depois que o app fecha).
/// </summary>
internal static class Filhos
{
    private static readonly IntPtr Job = Criar();

    public static Process Prender(Process p)
    {
        try { if (Job != IntPtr.Zero) AssignProcessToJobObject(Job, p.Handle); } catch { }
        return p;
    }

    private static IntPtr Criar()
    {
        try
        {
            var job = CreateJobObject(IntPtr.Zero, null);
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION { BasicLimitInformation = { LimitFlags = 0x2000 /* KILL_ON_JOB_CLOSE */ } };
            int tamanho = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
            var ptr = Marshal.AllocHGlobal(tamanho);
            try
            {
                Marshal.StructureToPtr(info, ptr, false);
                if (!SetInformationJobObject(job, 9 /* JobObjectExtendedLimitInformation */, ptr, (uint)tamanho)) return IntPtr.Zero;
            }
            finally { Marshal.FreeHGlobal(ptr); }
            return job;
        }
        catch { return IntPtr.Zero; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateJobObject(IntPtr atributos, string? nome);
    [DllImport("kernel32.dll")] private static extern bool SetInformationJobObject(IntPtr job, int classe, IntPtr info, uint tamanho);
    [DllImport("kernel32.dll")] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr processo);
}
