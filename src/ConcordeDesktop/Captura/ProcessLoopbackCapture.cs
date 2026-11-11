using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Concorde.Captura;

/// <summary>
/// Captura o áudio do sistema via WASAPI "process loopback" (Windows 10 2004+).
/// Modo Exclude: captura tudo MENOS a árvore de processos alvo (ex.: Discord) → sem eco.
/// Modo Include: captura SÓ a árvore de processos alvo (ex.: um jogo ou o player).
/// Entrega PCM 16-bit, 48 kHz, estéreo.
/// </summary>
public sealed class ProcessLoopbackCapture : IDisposable
{
    public const int SampleRate = 48000;
    public const int Channels = 2;

    /// <summary>Chamado na thread de captura com amostras intercaladas (L,R,L,R...).</summary>
    public event PcmHandler? DataAvailable;
    public delegate void PcmHandler(ReadOnlySpan<short> samples);

    private readonly uint _targetPid;
    private readonly bool _include;
    private IAudioClient? _client;
    private IAudioCaptureClient? _capture;
    private Thread? _thread;
    private volatile bool _running;
    private readonly AutoResetEvent _event = new(false);
    private short[] _silence = new short[4096];

    public ProcessLoopbackCapture(int targetPid, bool includeTree)
    {
        _targetPid = (uint)targetPid;
        _include = includeTree;
    }

    /// <summary>
    /// Os objetos de áudio do Windows só funcionam em threads MTA: por isso o ConfigureAwait(false)
    /// (não volta para a thread STA da janela) e Stop/Release acontecem na própria thread de captura.
    /// </summary>
    public async Task StartAsync()
    {
        _client = await ActivateAsync(_targetPid, _include).ConfigureAwait(false);

        var fmt = new WAVEFORMATEX
        {
            wFormatTag = 1, // PCM
            nChannels = Channels,
            nSamplesPerSec = SampleRate,
            wBitsPerSample = 16,
            nBlockAlign = Channels * 2,
            nAvgBytesPerSec = SampleRate * Channels * 2,
            cbSize = 0,
        };
        IntPtr pFmt = Marshal.AllocHGlobal(Marshal.SizeOf<WAVEFORMATEX>());
        try
        {
            Marshal.StructureToPtr(fmt, pFmt, false);
            const uint flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM;
            _client.Initialize(0, flags, 200_000 /* 20ms em 100ns */, 0, pFmt, IntPtr.Zero);
        }
        finally { Marshal.FreeHGlobal(pFmt); }

        _client.SetEventHandle(_event.SafeWaitHandle.DangerousGetHandle());
        var iid = typeof(IAudioCaptureClient).GUID;
        _client.GetService(ref iid, out var svc);
        _capture = (IAudioCaptureClient)svc;

        _running = true;
        _thread = new Thread(CaptureLoop) { IsBackground = true, Name = "AudioCapture", Priority = ThreadPriority.AboveNormal };
        _thread.SetApartmentState(ApartmentState.MTA);
        _client.Start();
        _thread.Start();
    }

    private void CaptureLoop()
    {
        try { CaptureUntilStopped(); }
        finally
        {
            try { _client?.Stop(); } catch { }
            if (_capture != null) Marshal.ReleaseComObject(_capture);
            if (_client != null) Marshal.ReleaseComObject(_client);
        }
    }

    private void CaptureUntilStopped()
    {
        while (_running)
        {
            if (!_event.WaitOne(100)) continue;
            while (_running)
            {
                _capture!.GetNextPacketSize(out uint packet);
                if (packet == 0) break;
                _capture.GetBuffer(out IntPtr data, out uint frames, out uint bufFlags, out _, out _);
                int samples = (int)frames * Channels;
                if ((bufFlags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 || data == IntPtr.Zero)
                {
                    if (_silence.Length < samples) _silence = new short[samples];
                    DataAvailable?.Invoke(_silence.AsSpan(0, samples));
                }
                else
                {
                    unsafe { DataAvailable?.Invoke(new ReadOnlySpan<short>((void*)data, samples)); }
                }
                _capture.ReleaseBuffer(frames);
            }
        }
    }

    public void Dispose()
    {
        _running = false;
        if (_thread != null) _thread.Join(1000); // a própria thread de captura para e libera o cliente de áudio
        else if (_client != null) Marshal.ReleaseComObject(_client); // falhou antes de começar
        _event.Dispose();
    }

    /// <summary>
    /// Acha o processo raiz do Discord (estável, PTB ou Canary). Exclui-lo com a árvore
    /// remove as vozes da call do áudio transmitido. Retorna null se o Discord não estiver aberto.
    /// </summary>
    public static Process? FindDiscordRoot()
    {
        string[] names = ["Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment"];
        var procs = names.SelectMany(Process.GetProcessesByName).ToList();
        var pids = procs.Select(p => p.Id).ToHashSet();
        // O processo raiz é o único cujo pai não é outro processo do Discord.
        return procs.FirstOrDefault(p => !pids.Contains(GetParentPid(p)));
    }

    internal static int GetParentPid(Process p)
    {
        try
        {
            var pbi = new PROCESS_BASIC_INFORMATION();
            if (NtQueryInformationProcess(p.Handle, 0, ref pbi, Marshal.SizeOf(pbi), out _) == 0)
                return (int)pbi.InheritedFromUniqueProcessId;
        }
        catch { }
        return -1;
    }

    private static Task<IAudioClient> ActivateAsync(uint pid, bool include)
    {
        var p = new AUDIOCLIENT_ACTIVATION_PARAMS
        {
            ActivationType = 1, // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
            TargetProcessId = pid,
            ProcessLoopbackMode = include ? 0 : 1, // INCLUDE_TARGET_PROCESS_TREE : EXCLUDE_TARGET_PROCESS_TREE
        };
        IntPtr pParams = Marshal.AllocHGlobal(Marshal.SizeOf<AUDIOCLIENT_ACTIVATION_PARAMS>());
        Marshal.StructureToPtr(p, pParams, false);
        var pv = new PROPVARIANT_BLOB { vt = 65 /* VT_BLOB */, cbSize = (uint)Marshal.SizeOf<AUDIOCLIENT_ACTIVATION_PARAMS>(), pBlobData = pParams };

        var handler = new CompletionHandler(pParams);
        var iid = typeof(IAudioClient).GUID;
        ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, ref pv, handler, out _);
        return handler.Task;
    }

    [ComVisible(true)]
    private sealed class CompletionHandler(IntPtr paramsToFree) : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        private readonly TaskCompletionSource<IAudioClient> _tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task<IAudioClient> Task => _tcs.Task;

        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op)
        {
            Marshal.FreeHGlobal(paramsToFree);
            try
            {
                op.GetActivateResult(out int hr, out object iface);
                if (hr < 0) _tcs.SetException(Marshal.GetExceptionForHR(hr)!);
                else _tcs.SetResult((IAudioClient)iface);
            }
            catch (Exception ex) { _tcs.SetException(ex); }
        }
    }

    // ---------------- Interop ----------------

    private const uint AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
    private const uint AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
    private const uint AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = 0x80000000;
    private const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x2;

    [StructLayout(LayoutKind.Sequential)]
    private struct AUDIOCLIENT_ACTIVATION_PARAMS
    {
        public int ActivationType;
        public uint TargetProcessId;
        public int ProcessLoopbackMode;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROPVARIANT_BLOB
    {
        public ushort vt, r1, r2, r3;
        public uint cbSize;
        public IntPtr pBlobData;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    private struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_BASIC_INFORMATION
    {
        public IntPtr ExitStatus, PebBaseAddress, AffinityMask, BasePriority, UniqueProcessId, InheritedFromUniqueProcessId;
    }

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PROCESS_BASIC_INFORMATION pbi, int len, out int retLen);

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    private static extern void ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath, ref Guid riid, ref PROPVARIANT_BLOB activationParams,
        IActivateAudioInterfaceCompletionHandler completionHandler, out IActivateAudioInterfaceAsyncOperation op);

    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAgileObject { }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        void Initialize(int shareMode, uint streamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, IntPtr audioSessionGuid);
        void GetBufferSize(out uint frames);
        void GetStreamLatency(out long latency);
        void GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr pFormat, out IntPtr closest);
        void GetMixFormat(out IntPtr format);
        void GetDevicePeriod(out long def, out long min);
        void Start();
        void Stop();
        void Reset();
        void SetEventHandle(IntPtr handle);
        void GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        void GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        void ReleaseBuffer(uint frames);
        void GetNextPacketSize(out uint frames);
    }
}
