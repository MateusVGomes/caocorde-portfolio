using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Concorde.Captura;

/// <summary>
/// "Pacer" do vídeo (o que o Discord e o navegador fazem): em vez de jogar um quadro inteiro na rede de uma vez —
/// um quadro-chave de jogo/vídeo pode ter centenas de pacotes saindo em menos de 1 ms, e o roteador, o Wi-Fi ou a
/// operadora descartam o que não cabe no buffer —, o quadro é quebrado em pacotes RTP (H.264, RFC 6184) e eles saem
/// espalhados, a ~2,5× a taxa da transmissão, com rajada de no máximo ~10 ms.
/// </summary>
public sealed class EnvioCompassado : IDisposable
{
    private const int Mtu = 1200;   // carga útil por pacote (cabe com folga nos 1500 bytes da rede)

    private readonly Action<byte[], uint, int> _enviar;   // carga, timestamp RTP, marker
    private readonly ConcurrentQueue<(byte[] Carga, uint Ts, int Marker)> _fila = new();
    private readonly Thread _thread;
    private volatile bool _parar;
    private volatile int _bytesPorSeg = 2_000_000;
    private long _naFila, _maiorQuadro;

    public EnvioCompassado(Action<byte[], uint, int> enviar)
    {
        _enviar = enviar;
        _thread = new Thread(Loop) { IsBackground = true, Name = "envio-compassado", Priority = ThreadPriority.AboveNormal };
        _thread.Start();
    }

    /// <summary>Taxa da transmissão: os pacotes saem a 2,5× ela (folga para o quadro-chave sem estourar a rede).</summary>
    public void Taxa(int kbps) => _bytesPorSeg = Math.Max(kbps * 1000 / 8 * 5 / 2, 250_000);

    /// <summary>Quanto tempo de vídeo está esperando para sair (ms). Crescendo sem parar = a taxa está acima do upload.</summary>
    public double FilaMs => Interlocked.Read(ref _naFila) * 1000.0 / _bytesPorSeg;

    /// <summary>Maior quadro (bytes) desde a última leitura — o quadro-chave, quase sempre.</summary>
    public long LerMaiorQuadro() => Interlocked.Exchange(ref _maiorQuadro, 0);

    /// <summary>Um quadro do codificador (Annex B, com 00 00 01 antes de cada NAL) vira pacotes na fila.</summary>
    public void Quadro(byte[] au, uint ts)
    {
        long maior;
        do { maior = Interlocked.Read(ref _maiorQuadro); } while (au.Length > maior && Interlocked.CompareExchange(ref _maiorQuadro, au.Length, maior) != maior);

        var nals = Nals(au).Where(n => n.Length > 0 && (n.Span[0] & 0x1F) != 9).ToList();   // tira o AUD (tipo 9)
        for (int k = 0; k < nals.Count; k++)
        {
            var nal = nals[k].Span;
            bool ultimo = k == nals.Count - 1;
            if (nal.Length <= Mtu) { Por(nal.ToArray(), ts, ultimo ? 1 : 0); continue; }
            // FU-A: o NAL grande vai em pedaços; o 1º leva o bit de início, o último o de fim.
            byte indicador = (byte)((nal[0] & 0xE0) | 28), tipo = (byte)(nal[0] & 0x1F);
            for (int i = 1; i < nal.Length; i += Mtu - 2)
            {
                int n = Math.Min(Mtu - 2, nal.Length - i);
                bool fim = i + n >= nal.Length;
                var p = new byte[n + 2];
                p[0] = indicador;
                p[1] = (byte)(tipo | (i == 1 ? 0x80 : 0) | (fim ? 0x40 : 0));
                nal.Slice(i, n).CopyTo(p.AsSpan(2));
                Por(p, ts, ultimo && fim ? 1 : 0);
            }
        }
    }

    private void Por(byte[] carga, uint ts, int marker)
    {
        Interlocked.Add(ref _naFila, carga.Length);
        _fila.Enqueue((carga, ts, marker));
    }

    /// <summary>Separa os NALs pelos códigos de início (00 00 01 ou 00 00 00 01).</summary>
    private static List<ReadOnlyMemory<byte>> Nals(byte[] au)
    {
        var lista = new List<ReadOnlyMemory<byte>>();
        int inicio = -1;
        for (int i = 0; i + 2 < au.Length; i++)
        {
            if (au[i] != 0 || au[i + 1] != 0 || au[i + 2] != 1) continue;
            if (inicio >= 0) lista.Add(au.AsMemory(inicio, (i > 0 && au[i - 1] == 0 ? i - 1 : i) - inicio));
            inicio = i + 3;
            i += 2;
        }
        if (inicio >= 0 && inicio < au.Length) lista.Add(au.AsMemory(inicio));
        return lista;
    }

    private void Loop()
    {
        timeBeginPeriod(1);   // Sleep(1) de verdade (o padrão do Windows é ~15 ms)
        try
        {
            var relogio = Stopwatch.StartNew();
            double credito = 0, antes = 0;
            while (!_parar)
            {
                double agora = relogio.Elapsed.TotalSeconds;
                credito = Math.Min(credito + (agora - antes) * _bytesPorSeg, _bytesPorSeg * 0.01);   // rajada de até ~10 ms
                antes = agora;
                while (credito > 0 && _fila.TryDequeue(out var p))
                {
                    _enviar(p.Carga, p.Ts, p.Marker);
                    credito -= p.Carga.Length;
                    Interlocked.Add(ref _naFila, -p.Carga.Length);
                }
                Thread.Sleep(1);
            }
        }
        finally { timeEndPeriod(1); }
    }

    public void Dispose() => _parar = true;

    [DllImport("winmm.dll")] private static extern uint timeBeginPeriod(uint ms);
    [DllImport("winmm.dll")] private static extern uint timeEndPeriod(uint ms);
}
