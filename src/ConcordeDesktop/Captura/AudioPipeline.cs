using System.Runtime.InteropServices;
using Concentus;
using Concentus.Enums;

namespace Concorde.Captura;

/// <summary>
/// Mistura uma ou mais capturas (uma por app, ou uma só do "PC menos X") em quadros de 20 ms,
/// codifica em Opus e entrega no ritmo do relógio. Fonte atrasada ou calada entra como silêncio,
/// para o espectador não acumular atraso; excesso guardado é descartado para manter a latência baixa.
/// </summary>
public sealed class AudioPipeline : IDisposable
{
    private const int FrameSamples = 960; // 20 ms a 48 kHz
    private const int FrameShorts = FrameSamples * ProcessLoopbackCapture.Channels;
    private const int MaxBufferedFrames = 8; // ~160 ms

    private sealed class Ring
    {
        public readonly short[] Data = new short[FrameShorts * (MaxBufferedFrames + 2)];
        public int Read, Count;
    }

    private readonly Action<byte[], uint> _send;
    private readonly IOpusEncoder _encoder;
    private readonly List<Ring> _rings;
    private readonly object _lock = new();
    private Thread? _thread;
    private volatile bool _running;

    public AudioPipeline(Action<byte[], uint> send, int sources = 1, int bitrateKbps = 128)
    {
        _send = send;
        _rings = Enumerable.Range(0, Math.Max(1, sources)).Select(_ => new Ring()).ToList();
        _encoder = OpusCodecFactory.CreateEncoder(ProcessLoopbackCapture.SampleRate, ProcessLoopbackCapture.Channels, OpusApplication.OPUS_APPLICATION_AUDIO);
        _encoder.Bitrate = bitrateKbps * 1000;
        _encoder.Complexity = 5;
        _encoder.SignalType = OpusSignal.OPUS_SIGNAL_MUSIC;
    }

    /// <summary>Mais uma fonte na mistura com a transmissão rodando (app que começou a tocar som depois). Devolve o índice.</summary>
    public int AdicionarFonte()
    {
        lock (_lock) { _rings.Add(new Ring()); return _rings.Count - 1; }
    }

    /// <summary>Recebe PCM de uma das capturas (qualquer tamanho).</summary>
    public void Push(int source, ReadOnlySpan<short> pcm)
    {
        lock (_lock)
        {
            var r = _rings[source];
            foreach (var s in pcm)
            {
                if (r.Count == r.Data.Length) { r.Read = (r.Read + FrameShorts) % r.Data.Length; r.Count -= FrameShorts; }
                r.Data[(r.Read + r.Count) % r.Data.Length] = s;
                r.Count++;
            }
            // Mantém no máximo ~160 ms guardados.
            while (r.Count > FrameShorts * MaxBufferedFrames) { r.Read = (r.Read + FrameShorts) % r.Data.Length; r.Count -= FrameShorts; }
        }
    }

    public void Start()
    {
        _running = true;
        _thread = new Thread(Loop) { IsBackground = true, Name = "AudioPump", Priority = ThreadPriority.AboveNormal };
        _thread.Start();
    }

    private void Loop()
    {
        timeBeginPeriod(1);
        try
        {
            var mix = new int[FrameShorts];
            var frame = new short[FrameShorts];
            var packet = new byte[1500];
            var sw = System.Diagnostics.Stopwatch.StartNew();
            long next = 0;
            while (_running)
            {
                long wait = next - sw.ElapsedMilliseconds;
                if (wait > 0) { Thread.Sleep((int)wait); continue; }
                next += 20;
                if (next < sw.ElapsedMilliseconds - 200) next = sw.ElapsedMilliseconds; // ficou muito para trás (PC travou)

                Array.Clear(mix);
                lock (_lock)
                {
                    foreach (var r in _rings)
                    {
                        if (r.Count < FrameShorts) continue; // essa fonte está calada/atrasada: silêncio
                        for (int i = 0; i < FrameShorts; i++) mix[i] += r.Data[(r.Read + i) % r.Data.Length];
                        r.Read = (r.Read + FrameShorts) % r.Data.Length;
                        r.Count -= FrameShorts;
                    }
                }
                for (int i = 0; i < FrameShorts; i++) frame[i] = (short)Math.Clamp(mix[i], short.MinValue, short.MaxValue);

                int len = _encoder.Encode(frame, FrameSamples, packet, packet.Length);
                if (len > 0) _send(packet[..len], FrameSamples);
            }
        }
        finally { timeEndPeriod(1); }
    }

    public void Dispose()
    {
        _running = false;
        _thread?.Join(500);
        _encoder.Dispose();
    }

    [DllImport("winmm.dll")] private static extern uint timeBeginPeriod(uint ms);
    [DllImport("winmm.dll")] private static extern uint timeEndPeriod(uint ms);
}
