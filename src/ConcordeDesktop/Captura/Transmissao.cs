using System.Runtime.InteropServices;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;

namespace Concorde.Captura;

/// <summary>Pedido da página: o que transmitir e como.</summary>
public sealed record PedidoTransmissao(string Fonte, int Altura, int Fps, int Kbps, string Placa, string[] SemSom, bool CursorJogo);

/// <summary>
/// "Ao vivo" pelo app: captura (GPU escolhida), som dos apps escolhidos sem o som da própria call, e publica
/// no Cloudflare Realtime por WebRTC (SIPSorcery). A sinalização (sessão e trilhas no SFU) quem faz é a página:
/// aqui só sai a oferta SDP e entra a resposta.
/// </summary>
public sealed class Transmissao : IAsyncDisposable
{
    private static readonly VideoFormat H264 = new(VideoCodecsEnum.H264, 102, 90000,
        "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f");
    private static readonly AudioFormat Opus = new(AudioCodecsEnum.OPUS, 111, 48000, 2,
        "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1");

    /// <summary>"conectado", "caiu", "fonte-perdida" ou "tela-cheia-exclusiva" (aviso: o jogo prende a captura).</summary>
    public event Action<string>? Estado;

    /// <summary>A qualidade automática mudou: nome do degrau ("720p30"), se está abaixo do escolhido e o motivo.</summary>
    public event Action<string, bool, string>? Qualidade;

    public string? Encoder => _encoder?.ActiveEncoder;
    public bool TemSom => _audio != null;

    private ScreenEncoder? _encoder;
    private AudioPipeline? _audio;
    private readonly List<ProcessLoopbackCapture> _captures = [];
    private RTCPeerConnection? _pc;
    private EnvioCompassado? _envio;
    private ForcarComposicao? _camada;
    private uint _rtpTs = (uint)Random.Shared.Next();
    private double _maiorKb, _filaMs;
    private int _ptVideo = 102;   // tipo de carga do H.264 que o SFU aceitou (lido da resposta)
    private volatile bool _conectado;
    private int _fps = 30, _altura;

    // Estatísticas (painel "Estatísticas" da transmissão): o que saiu do codificador e o que o Cloudflare diz que chegou.
    private long _bytes, _quadros;
    private DateTime _desde = DateTime.UtcNow;
    private double _fpsMedido, _kbpsMedido;

    // Qualidade automática (igual o Discord): desce um degrau quando a conexão perde pacotes ou o fps não se sustenta,
    // sobe de volta depois de 30 s sem problema.
    private sealed record Degrau(int Altura, int Fps, int Kbps)
    {
        public string Nome(int alturaBase) => $"{(Altura > 0 ? Altura : alturaBase)}p{Fps}";
    }
    private List<Degrau> _degraus = [];
    private int _nivel, _alturaBase = 1080, _bons;
    private readonly Queue<bool> _ruins = new();
    private DateTime _mudou = DateTime.UtcNow;
    private volatile bool _mudando;
    private string? _motivo;
    // Teste: CONCORDE_DEBUG_PERDA="12:40" finge 12% de perda nos primeiros 40 s.
    private static readonly (double Perda, double Segundos)? PerdaFalsa = LerPerdaFalsa();
    private readonly DateTime _inicio = DateTime.UtcNow;
    private System.Threading.Timer? _medidor;
    private double _perda, _jitterMs;
    private double? _pingMs, _pingBase;
    private volatile int _quedas;
    private long _cpuOcioso, _cpuTotal;

    /// <summary>Sobe a captura + codificador. Quadro de um codificador que já foi trocado não sai (troca sem emenda).</summary>
    private async Task<ScreenEncoder> NovoEncoderAsync(VideoSettings s, bool aoVivo = false)
    {
        var ffmpeg = ScreenEncoder.FindFfmpeg() ?? throw new InvalidOperationException("FFmpeg não encontrado. Reinstale o Caocorde.");
        var enc = new ScreenEncoder(ffmpeg, s);
        enc.FrameEncoded += (au, _) =>
        {
            if (_encoder != null && enc != _encoder) return;
            Interlocked.Add(ref _bytes, au.Length);
            Interlocked.Increment(ref _quadros);
            _rtpTs += (uint)(90000 / _fps);
            if (_conectado) _envio?.Quadro(au, _rtpTs);
        };
        enc.SourceLost += () => { if (enc == _encoder) Estado?.Invoke("fonte-perdida"); };
        Console.WriteLine($"[concorde] capturando {s.Source.Name}");
        var inicio = enc.StartAsync();
        // Ao vivo a live antiga segue no ar enquanto testa: se a fonte nova não manda imagem em 10 s, desiste logo
        // (testar todas as placas levaria quase 1 minuto).
        if (aoVivo && await Task.WhenAny(inicio, Task.Delay(10_000)) != inicio)
        {
            enc.Dispose();
            throw new InvalidOperationException("essa janela não mandou imagem (minimizada, em outra área de trabalho ou protegida contra captura)");
        }
        if (!await inicio) { enc.Dispose(); throw new InvalidOperationException("Não consegui capturar com nenhuma placa de vídeo."); }
        Console.WriteLine($"[concorde] vídeo: {enc.ActiveEncoder}");
        return enc;
    }

    private PedidoTransmissao? _pedido;
    private readonly SemaphoreSlim _ajuste = new(1, 1);

    /// <summary>
    /// Muda a transmissão AO VIVO, sem fechar: qualidade, apps com som, o que transmitir (tela/janela), placa e modo jogo.
    /// Quem assiste só vê ~1 s parado (o codificador novo já começa com um quadro-chave). A sessão no SFU é a mesma.
    /// </summary>
    /// <param name="atualizar">"Atualizar a tela": refaz a captura de imagem e de som do zero mesmo sem mudança
    /// (cursor sumido, imagem parada, app de som que não entrou, jogo que trocou de tela cheia para janela...).</param>
    public async Task<object> AjustarAsync(PedidoTransmissao p, bool atualizar = false)
    {
        if (_pedido is not { } antes || _encoder == null) throw new InvalidOperationException("transmissão não iniciada");
        await _ajuste.WaitAsync();
        _mudando = true;   // a qualidade automática espera
        try
        {
            if (atualizar || !new HashSet<string>(antes.SemSom, StringComparer.OrdinalIgnoreCase).SetEquals(p.SemSom))
                await Task.Run(() => TrocarSomAsync(p.SemSom));

            var fonte = AcharFonte(p.Fonte) ?? throw new InvalidOperationException("A janela escolhida foi fechada. Escolha de novo.");
            if (fonte.IsMinimized) throw new InvalidOperationException("A janela escolhida está minimizada — abra ela antes.");
            if (p.CursorJogo && fonte.Kind == SourceKind.Window && MonitorCoberto(fonte) is { } tela) fonte = tela;
            bool outraCaptura = atualizar || p.Fonte != antes.Fonte || p.CursorJogo != antes.CursorJogo || p.Placa != antes.Placa;
            bool outraQualidade = p.Altura != antes.Altura || p.Fps != antes.Fps || p.Kbps != antes.Kbps;

            if (outraCaptura)
            {
                // Codificador novo para a fonte nova; o velho só para depois que o novo já está mandando quadro.
                var velho = _encoder;
                _encoder = await NovoEncoderAsync(new VideoSettings(fonte, p.Altura, p.Fps, p.Kbps, p.Placa, p.CursorJogo), aoVivo: true);
                velho.Dispose();
            }
            else if (outraQualidade && !await _encoder.TrocarAsync(p.Altura, p.Fps, p.Kbps))
                throw new InvalidOperationException("Não deu para trocar a qualidade.");

            if (outraCaptura || outraQualidade)
            {
                _fps = p.Fps;
                _altura = p.Altura;
                _alturaBase = p.Altura > 0 ? p.Altura : fonte.Kind == SourceKind.Monitor ? fonte.MonitorBounds.Height : 1080;
                _degraus = Degraus(p.Altura, _alturaBase, p.Fps, p.Kbps);
                _nivel = 0;
                _motivo = null;
                _envio?.Taxa(p.Kbps);
                _avisouExclusiva = false;
            }
            _pedido = p;
            Console.WriteLine($"[concorde] transmissão ajustada ao vivo: {fonte.Name}, {(p.Altura > 0 ? p.Altura + "p" : "nativa")}{p.Fps}");
            return new { encoder = Encoder, nome = fonte.Name };
        }
        finally
        {
            _mudou = DateTime.UtcNow;
            _ruins.Clear();
            _bons = 0;
            _mudando = false;
            _ajuste.Release();
        }
    }

    /// <summary>Troca quais apps vão no som: fecha as capturas de som e abre as novas (a trilha de áudio é a mesma).</summary>
    private async Task TrocarSomAsync(string[] semSom)
    {
        _somCts?.Cancel();
        var velhas = new List<ProcessLoopbackCapture>();
        lock (_captures) { velhas.AddRange(_captures); _captures.Clear(); }
        foreach (var c in velhas) c.Dispose();
        _capturados.Clear();
        var audioVelho = _audio;
        await IniciarSomAsync(semSom);
        audioVelho?.Dispose();
    }

    /// <summary>Começa a captura e devolve a oferta SDP. Lança exceção com mensagem amigável se não der.</summary>
    public async Task<string> IniciarAsync(PedidoTransmissao p)
    {
        var fonte = AcharFonte(p.Fonte) ?? throw new InvalidOperationException("A janela escolhida foi fechada. Escolha de novo.");
        if (fonte.IsMinimized) throw new InvalidOperationException("A janela escolhida está minimizada — abra ela antes de transmitir.");
        // Jogo em tela cheia/sem borda numa janela do tamanho do monitor: no modo jogo, captura o monitor (com o cursor).
        if (p.CursorJogo && fonte.Kind == SourceKind.Window && MonitorCoberto(fonte) is { } tela) fonte = tela;

        _fps = p.Fps;
        _altura = p.Altura;
        _alturaBase = p.Altura > 0 ? p.Altura : fonte.Kind == SourceKind.Monitor ? fonte.MonitorBounds.Height : 1080;
        _degraus = Degraus(p.Altura, _alturaBase, p.Fps, p.Kbps);
        _pedido = p;
        _encoder = await NovoEncoderAsync(new VideoSettings(fonte, p.Altura, p.Fps, p.Kbps, p.Placa, p.CursorJogo));
        // Mede fps e taxa a cada 2 s aqui dentro (quem pede os números só lê o último, sem atrapalhar a medida).
        _desde = DateTime.UtcNow;
        _medidor = new System.Threading.Timer(_ => Medir(), null, 2000, 2000);

        // Modo jogo: tira o jogo do flip independente (senão o cursor some da transmissão). Desligada até confirmar no jogo.
        if (p.CursorJogo && Environment.GetEnvironmentVariable("CONCORDE_CAMADA") == "1")   // ainda em teste: só com CONCORDE_CAMADA=1
            _camada = new ForcarComposicao(fonte.Kind == SourceKind.Monitor ? fonte.MonitorBounds : Screen.FromHandle(fonte.Handle).Bounds);

        await Task.Run(() => IniciarSomAsync(p.SemSom)); // áudio do Windows precisa de thread MTA

        _pc = new RTCPeerConnection(new RTCConfiguration
        {
            iceServers = [new RTCIceServer { urls = "stun:stun.cloudflare.com:3478" }],
            X_UseRtpFeedbackProfile = true,
        });
        _pc.addTrack(new MediaStreamTrack(H264, MediaStreamStatusEnum.SendOnly));
        _pc.addTrack(new MediaStreamTrack(Opus, MediaStreamStatusEnum.SendOnly));
        _pc.OnReceiveReport += (_, tipo, rtcp) => { if (tipo == SDPMediaTypesEnum.video) LerRelatorio(rtcp); };
        // Vídeo sai pelo pacer (pacotes espalhados), no formato que o SFU aceitou na resposta.
        _envio = new EnvioCompassado((carga, ts, marker) =>
        {
            try { _pc?.SendRtpRaw(SDPMediaTypesEnum.video, carga, ts, marker, _ptVideo); } catch { }
        });
        _envio.Taxa(p.Kbps);
        _pc.onconnectionstatechange += s =>
        {
            Console.WriteLine($"[concorde] conexão: {s}");
            if (s == RTCPeerConnectionState.connected) { _conectado = true; Estado?.Invoke("conectado"); }
            else if (s == RTCPeerConnectionState.disconnected)
            {
                // Oscilação (fila do roteador cheia, ping lá em cima): o ICE costuma voltar sozinho. Para de mandar vídeo
                // para a fila esvaziar e só avisa que caiu se não voltar em 10 s (antes a página encerrava na hora).
                bool estava = _conectado;
                _conectado = false;
                int queda = ++_quedas;
                if (estava) _ = Task.Delay(10_000).ContinueWith(_ => { if (queda == _quedas && !_conectado) Estado?.Invoke("caiu"); });
            }
            else if (s is RTCPeerConnectionState.failed or RTCPeerConnectionState.closed)
            {
                bool estava = _conectado;
                _conectado = false;
                ++_quedas;   // o aviso já sai agora; o de 10 s não repete
                if (estava || s == RTCPeerConnectionState.failed) Estado?.Invoke("caiu");
            }
        };
        var oferta = _pc.createOffer(null);
        await _pc.setLocalDescription(oferta);
        return oferta.sdp;
    }

    /// <summary>
    /// Relatório que o Cloudflare manda sobre o vídeo que chega nele: perda (fração dos últimos pacotes), jitter e,
    /// pelo carimbo do nosso último relatório de envio, o ping ida e volta (RFC 3550: agora − LSR − DLSR).
    /// </summary>
    private void LerRelatorio(RTCPCompoundPacket rtcp)
    {
        var lista = rtcp.ReceiverReport?.ReceptionReports ?? rtcp.SenderReport?.ReceptionReports;
        if (lista == null) return;
        foreach (var r in lista)
        {
            _perda = r.FractionLost * 100.0 / 256;
            _jitterMs = r.Jitter / 90.0;   // relógio do vídeo: 90 kHz
            if (r.LastSenderReportTimestamp == 0) continue;
            double ping = unchecked(NtpMeio() - r.LastSenderReportTimestamp - r.DelaySinceLastSenderReport) * 1000.0 / 65536;
            if (ping < 0 || ping >= 5000) continue;
            _pingMs = ping;
            // Ping "normal" da conexão: o menor visto, que só sobe devagar (se a rota mudar de verdade).
            _pingBase = _pingBase is { } b ? Math.Min(ping, b + 0.5) : ping;
        }
    }

    /// <summary>Os 32 bits do meio do horário NTP (16 de segundos + 16 de fração), o formato do LSR.</summary>
    private static uint NtpMeio()
    {
        var t = DateTime.UtcNow - new DateTime(1900, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        ulong seg = (ulong)t.TotalSeconds;
        ulong frac = (ulong)((t.TotalSeconds - seg) * 65536);
        return (uint)(((seg & 0xFFFF) << 16) | (frac & 0xFFFF));
    }

    private void Medir()
    {
        var agora = DateTime.UtcNow;
        double seg = Math.Max(0.5, (agora - _desde).TotalSeconds);
        _desde = agora;
        long bytes = Interlocked.Exchange(ref _bytes, 0), quadros = Interlocked.Exchange(ref _quadros, 0);
        _fpsMedido = Math.Round(quadros / seg, 1);
        _kbpsMedido = Math.Round(bytes * 8 / seg / 1000);
        if (_envio != null) { _maiorKb = Math.Round(_envio.LerMaiorQuadro() / 1024.0); _filaMs = Math.Round(_envio.FilaMs); }
        if (PerdaFalsa is { } f && (agora - _inicio).TotalSeconds < f.Segundos) _perda = f.Perda;
        AvisarTelaCheiaExclusiva();
        Avaliar(agora);
    }

    private bool _avisouExclusiva;

    /// <summary>
    /// Jogo em tela cheia EXCLUSIVA (ARK, jogos antigos) manda a imagem direto para a placa, por fora do compositor
    /// do Windows de onde a captura tira os quadros: a captura recebe poucos (ARK: 11 de 60). Não tem como forçar
    /// daqui; o que resolve é o jogo em "janela sem bordas". Avisa quem transmite uma vez.
    /// </summary>
    private void AvisarTelaCheiaExclusiva()
    {
        if (_avisouExclusiva || !_conectado || _encoder?.Reiniciando == true || _fpsMedido >= _fps * 0.8) return;
        if (SHQueryUserNotificationState(out int estado) != 0 || estado != 3 /* QUNS_RUNNING_D3D_FULL_SCREEN */) return;
        _avisouExclusiva = true;
        Estado?.Invoke("tela-cheia-exclusiva");
    }

    [DllImport("shell32.dll")] private static extern int SHQueryUserNotificationState(out int estado);

    /// <summary>
    /// Degraus a partir do que a pessoa escolheu (ex.: 1080p60): mesma imagem com 70% da taxa; 30 fps com metade;
    /// 720p30; 480p30. Os repetidos (quem já escolheu 720p30) saem da lista.
    /// </summary>
    private static List<Degrau> Degraus(int altura, int alturaBase, int fps, int kbps)
    {
        int f30 = Math.Min(fps, 30);
        int ate(int max) => alturaBase > max ? max : altura;
        var lista = new List<Degrau>
        {
            new(altura, fps, kbps),
            new(altura, fps, kbps * 7 / 10),
            new(altura, f30, kbps / 2),
            new(ate(720), f30, Math.Max(kbps * 35 / 100, 1500)),
            new(ate(480), f30, Math.Max(kbps / 5, 700)),
        };
        var saida = new List<Degrau> { lista[0] };
        foreach (var d in lista.Skip(1))
        {
            var u = saida[^1];
            int a = d.Altura > 0 ? d.Altura : alturaBase, ua = u.Altura > 0 ? u.Altura : alturaBase;
            if (d.Kbps < u.Kbps || d.Fps < u.Fps || a < ua) saida.Add(d with { Kbps = Math.Min(d.Kbps, u.Kbps) });
        }
        return saida;
    }

    /// <summary>A cada 2 s: 3 de 4 medições ruins (perda acima de 5%, fps abaixo de 80% ou ping 150 ms acima do normal) descem;
    /// 30 s limpos (perda abaixo de 1%, fps de 90% e ping perto do normal) sobem.</summary>
    private void Avaliar(DateTime agora)
    {
        if (_encoder?.Reiniciando == true) { _ruins.Clear(); _bons = 0; _mudou = agora; return; }   // fps de reinício não conta
        if (_mudando || !_conectado || _degraus.Count < 2 || (agora - _mudou).TotalSeconds < 6) return;
        var d = _degraus[_nivel];
        // Ping subindo muito acima do normal (ex.: 20 → 600 ms) = fila enchendo no roteador de quem transmite, antes
        // mesmo de perder pacotes. Trata como perda (desce a taxa); muito alto desce mais rápido.
        double extra = _pingMs is { } pm && _pingBase is { } pb ? pm - pb : 0;
        bool perde = _perda > 5, lento = _fpsMedido < d.Fps * 0.8, atrasa = extra > 150 && _pingMs > 200;
        _ruins.Enqueue(perde || lento || atrasa);
        while (_ruins.Count > 4) _ruins.Dequeue();
        _bons = perde || lento || atrasa || _perda >= 1 || _fpsMedido < d.Fps * 0.9 || extra > 60 ? 0 : _bons + 1;

        int ruins = _ruins.Count(r => r);
        if ((ruins >= 3 || atrasa && extra > 400 && ruins >= 2) && _nivel < _degraus.Count - 1)
        {
            int alvo = _nivel + 1;
            // Só o fps não se sustenta (sem perda nem fila): baixar a taxa não ajuda; vai para menos fps ou menos resolução.
            if (lento && !perde && !atrasa)
                while (alvo < _degraus.Count - 1 && _degraus[alvo].Fps >= d.Fps && _degraus[alvo].Altura == d.Altura) alvo++;
            Mudar(alvo, perde ? "a conexão está perdendo pacotes" : atrasa ? "a conexão está atrasando (fila no envio)" : "o PC ou a conexão não mantém o fps");
        }
        else if (_bons >= 15 && _nivel > 0) Mudar(_nivel - 1, "voltando ao normal");
    }

    private void Mudar(int alvo, string motivo)
    {
        _mudando = true;
        var antes = _degraus[_nivel];
        var d = _degraus[alvo];
        _ = Task.Run(async () =>
        {
            try
            {
                Console.WriteLine($"[qualidade] {antes.Nome(_alturaBase)} {antes.Kbps}k → {d.Nome(_alturaBase)} {d.Kbps}k ({motivo})");
                if (_encoder == null) return;
                if (await _encoder.TrocarAsync(d.Altura, d.Fps, d.Kbps))
                {
                    _envio?.Taxa(d.Kbps);
                    _nivel = alvo;
                    _fps = d.Fps;
                    _altura = d.Altura;
                    _motivo = alvo == 0 ? null : motivo;
                    Qualidade?.Invoke(d.Nome(_alturaBase), alvo > 0, motivo);
                }
                else if (!await _encoder.TrocarAsync(antes.Altura, antes.Fps, antes.Kbps))
                    Console.WriteLine("[qualidade] não deu para voltar ao degrau anterior");
            }
            catch (Exception ex) { Console.WriteLine("[qualidade] falhou: " + ex.Message); }
            finally
            {
                _mudou = DateTime.UtcNow;
                _ruins.Clear();
                _bons = 0;
                _mudando = false;
            }
        });
    }

    private static (double, double)? LerPerdaFalsa()
    {
        var v = Environment.GetEnvironmentVariable("CONCORDE_DEBUG_PERDA")?.Split(':');
        return v is { Length: 2 } && double.TryParse(v[0], out var p) && double.TryParse(v[1], out var s) ? (p, s) : null;
    }

    /// <summary>Últimos 2 s: fps e taxa que saíram do codificador, o relatório do Cloudflare e a CPU do PC.</summary>
    public object Estatisticas()
    {
        return new
        {
            encoder = Encoder, alvoFps = _fps, altura = _altura > 0 ? _altura : _alturaBase, conectado = _conectado,
            qualidade = _degraus.Count > 0 ? (_nivel > 0 ? $"{_degraus[_nivel].Nome(_alturaBase)} (automática: {_motivo})" : _degraus[0].Nome(_alturaBase)) : null,
            fps = _fpsMedido, kbps = _kbpsMedido, maiorKb = _maiorKb, filaMs = _filaMs,
            perda = Math.Round(_perda, 1), jitterMs = Math.Round(_jitterMs, 1), pingMs = _pingMs is { } p ? Math.Round(p) : (double?)null,
            cpu = CpuDoPc(),
        };
    }

    /// <summary>Uso da CPU do PC inteiro desde a última vez (jogo + codificador + tudo), em %.</summary>
    private double? CpuDoPc()
    {
        if (!GetSystemTimes(out var ocioso, out var kernel, out var usuario)) return null;
        long o = ocioso, total = kernel + usuario;   // o tempo de kernel já inclui o ocioso
        long dO = o - _cpuOcioso, dT = total - _cpuTotal;
        bool primeira = _cpuTotal == 0;
        _cpuOcioso = o; _cpuTotal = total;
        return primeira || dT <= 0 ? null : Math.Round(100.0 * (dT - dO) / dT);
    }

    [DllImport("kernel32.dll")] private static extern bool GetSystemTimes(out long ocioso, out long kernel, out long usuario);

    public void AplicarResposta(string sdp)
    {
        if (_pc == null) throw new InvalidOperationException("transmissão não iniciada");
        var r = _pc.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.answer, sdp = sdp });
        if (r != SetDescriptionResultEnum.OK) throw new InvalidOperationException("resposta do Realtime recusada: " + r);
    }

    /// <summary>
    /// O som vai sem a própria call: o Concorde (e o WebView2 dele) sempre fica de fora.
    /// - Nenhum app desmarcado: uma captura "tudo menos o Concorde" (pega até app que abrir som depois).
    /// - Algum app desmarcado (ex.: o Discord, igual o Telinha fazia): o Windows só exclui um app por captura,
    ///   então captura cada app marcado separado e mistura — e a cada 3 s procura app novo tocando som
    ///   (jogo aberto depois da live começar) e junta na mistura.
    /// </summary>
    private async Task IniciarSomAsync(string[] semSom)
    {
        var fora = new HashSet<string>(semSom, StringComparer.OrdinalIgnoreCase);
        _audio = new AudioPipeline((pkt, dur) => { if (_conectado) try { _pc?.SendAudio(dur, pkt); } catch { } }, 0);
        if (fora.Count == 0)
        {
            await CapturarAsync(Environment.ProcessId, incluir: false, "todo o som do PC, menos o Concorde");
        }
        else
        {
            Console.WriteLine($"[concorde] som: só os apps marcados (de fora: {string.Join(", ", fora)})");
            await JuntarAppsNovosAsync(fora);
            _somCts = new CancellationTokenSource();
            var ct = _somCts.Token;
            _ = Task.Run(async () =>
            {
                while (!ct.IsCancellationRequested)
                {
                    try { await Task.Delay(3000, ct); await JuntarAppsNovosAsync(fora); } catch { }
                }
            }, ct);
        }
        _audio.Start();
    }

    private readonly HashSet<int> _capturados = [];
    private CancellationTokenSource? _somCts;

    private async Task JuntarAppsNovosAsync(HashSet<string> fora)
    {
        foreach (var app in AudioApps.List())
        {
            if (fora.Contains(app.Exe) || _capturados.Contains(app.RootPid)) continue;
            _capturados.Add(app.RootPid);
            await CapturarAsync(app.RootPid, incluir: true, app.Name);
        }
    }

    private async Task CapturarAsync(int pid, bool incluir, string descricao)
    {
        if (_audio == null) return;
        int indice = _audio.AdicionarFonte();
        var cap = new ProcessLoopbackCapture(pid, incluir);
        cap.DataAvailable += pcm => _audio?.Push(indice, pcm);
        try
        {
            await cap.StartAsync();
            lock (_captures) _captures.Add(cap);
            Console.WriteLine($"[concorde] som: {descricao}");
        }
        catch (Exception ex) { Console.WriteLine($"[concorde] som falhou em {descricao} ({ex.Message})"); cap.Dispose(); }
    }

    private static CaptureSource? AcharFonte(string id) => CaptureSource.List().FirstOrDefault(f => Id(f) == id);

    /// <summary>Id estável para a página: telas pelo número, janelas pelo handle.</summary>
    public static string Id(CaptureSource f) => f.Kind == SourceKind.Monitor ? $"tela:{f.MonitorIndex}" : $"janela:{f.Handle}";

    /// <summary>
    /// Se a janela é um jogo em tela cheia/sem borda (ocupa o monitor inteiro), devolve esse monitor.
    /// Janela comum maximizada também cobre o monitor (num segundo monitor sem barra de tarefas), mas tem barra de
    /// título: essa continua sendo capturada sozinha (senão quem assiste via o PC inteiro, até o alt+tab).
    /// </summary>
    private static CaptureSource? MonitorCoberto(CaptureSource janela)
    {
        const int GWL_STYLE = -16, WS_CAPTION = 0x00C00000;
        if (IsZoomed(janela.Handle) || (GetWindowLong(janela.Handle, GWL_STYLE) & WS_CAPTION) == WS_CAPTION) return null;
        if (!GetWindowRect(janela.Handle, out var r)) return null;
        var rect = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
        return CaptureSource.List().FirstOrDefault(m => m.Kind == SourceKind.Monitor && rect.Contains(m.MonitorBounds));
    }

    public async ValueTask DisposeAsync()
    {
        _conectado = false;
        _medidor?.Dispose();
        _envio?.Dispose();
        _camada?.Dispose();
        try { _pc?.close(); } catch { }
        _somCts?.Cancel();
        _encoder?.Dispose();
        await Task.Run(() => { lock (_captures) foreach (var c in _captures) c.Dispose(); });
        _audio?.Dispose();
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out RECT r);
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool IsZoomed(nint hwnd);
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern int GetWindowLong(nint hwnd, int indice);
}
