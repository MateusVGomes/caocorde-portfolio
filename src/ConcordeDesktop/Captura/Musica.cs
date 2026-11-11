using System.Diagnostics;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Concentus;
using Concentus.Enums;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;

namespace Concorde.Captura;

/// <summary>Faixa achada pelo yt-dlp.</summary>
/// <param name="ComLogin">O YouTube pediu para entrar na conta: baixa com o login do bot (cookies).</param>
public sealed record Faixa(string Titulo, int? Duracao, string? Capa, string Pagina, bool ComLogin = false);

/// <summary>Uma música de uma playlist, do jeito que entra na fila da call.</summary>
/// <param name="Consulta">O que o bot procura quando chegar a vez dela: o link da música ou "nome artista".</param>
/// <param name="Titulo">O nome que aparece na fila antes de tocar (pode faltar: alguns sites só dão o link).</param>
/// <param name="DuracaoEmSegundos">Duração, quando o site informa.</param>
public sealed record FaixaDaPlaylist(string Consulta, string? Titulo, int? DuracaoEmSegundos);

/// <summary>Playlist (ou álbum) aberta: o nome, as músicas na ordem e quantas a playlist tem no site.</summary>
/// <param name="TotalNoSite">Quantas músicas a playlist tem de verdade (pode ser mais que as lidas: a fila vai até 100).</param>
public sealed record Playlist(string Titulo, IReadOnlyList<FaixaDaPlaylist> Faixas, int TotalNoSite);

/// <summary>
/// O "bot" de música: o app desktop de quem está de DJ na call acha a música (yt-dlp: YouTube, SoundCloud e
/// centenas de sites; link do Spotify vira busca no YouTube pelo nome e artista), decodifica (FFmpeg), codifica
/// em Opus e publica no Cloudflare Realtime como uma trilha de áudio que todo mundo da call puxa.
/// </summary>
public sealed class Musica : IAsyncDisposable
{
    private static readonly AudioFormat Opus = new(AudioCodecsEnum.OPUS, 111, 48000, 2, "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1");
    private const int Amostras = 960;              // 20 ms a 48 kHz
    private const int BytesQuadro = Amostras * 2 * 2;

    /// <summary>"fim" (acabou a música) ou "erro".</summary>
    public event Action<string, string?>? Estado;

    private RTCPeerConnection? _pc;
    private Process? _ytdlp, _ffmpeg;
    private CancellationTokenSource? _cts;
    private volatile bool _conectado, _pausado;
    private string? _pagina;
    private bool _comLogin;

    /// <summary>
    /// Login do YouTube para o bot (arquivo de cookies exportado do navegador). Fica só neste PC; é usado só quando
    /// o YouTube pede "entre na conta para confirmar que não é um robô".
    /// </summary>
    public static string ArquivoCookies => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        MainWindow.Teste ? "Concorde-Teste" : "Concorde", "youtube-cookies.txt");

    /// <summary>
    /// yt-dlp com cada argumento separado: o link/busca vem da fila (qualquer um da call escreve), então vai depois de
    /// "--" e nunca vira opção (ex.: --exec, que rodaria um programa). Sem arquivo de configuração do PC e sem --exec.
    /// </summary>
    private static ProcessStartInfo YtDlp(string ytdlp, bool comLogin, string alvo, params string[] opcoes)
    {
        var psi = new ProcessStartInfo(ytdlp)
        { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var o in new[] { "--ignore-config", "--no-exec", "--no-warnings" }.Concat(opcoes)) psi.ArgumentList.Add(o);
        if (comLogin && File.Exists(ArquivoCookies)) { psi.ArgumentList.Add("--cookies"); psi.ArgumentList.Add(ArquivoCookies); }
        psi.ArgumentList.Add("--");
        psi.ArgumentList.Add(alvo);
        return psi;
    }

    /// <summary>
    /// Só links http(s) da internet: nada de arquivo do PC nem endereço da rede de casa (roteador, outro PC,
    /// impressora), que alguém da call poderia mandar para o app do DJ abrir (ataque "SSRF").
    /// Confere o endereço escrito E para onde o nome aponta de verdade (DNS): um site como "meuroteador.exemplo.com"
    /// pode apontar para 192.168.0.1. Se QUALQUER endereço do nome for interno, recusa.
    /// Limite conhecido: o yt-dlp segue redirecionamentos sozinho; um site público pode redirecionar para dentro.
    /// O yt-dlp só aceita páginas de mídia, o que reduz esse risco (ver CHECKLIST.md → OWASP-14).
    /// </summary>
    internal static async Task<string> LinkPublicoAsync(string link)
    {
        if (!Uri.TryCreate(link, UriKind.Absolute, out var endereco) || endereco.Scheme is not ("http" or "https"))
            throw new InvalidOperationException("link inválido");
        var nomeDoServidor = endereco.IdnHost.Trim('[', ']');
        if (nomeDoServidor.Equals("localhost", StringComparison.OrdinalIgnoreCase) || nomeDoServidor.EndsWith(".local", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("link da rede local não pode");

        // Número escrito direto no link, ou o(s) número(s) para onde o nome aponta.
        IPAddress[] enderecosReais;
        if (IPAddress.TryParse(nomeDoServidor, out var numeroEscrito)) enderecosReais = [numeroEscrito];
        else
        {
            try { enderecosReais = await Dns.GetHostAddressesAsync(nomeDoServidor); }
            catch (System.Net.Sockets.SocketException) { throw new InvalidOperationException("esse site não existe (ou está fora do ar)"); }
        }
        if (enderecosReais.Length == 0 || enderecosReais.Any(EhEnderecoInterno))
            throw new InvalidOperationException("link da rede local não pode");
        return endereco.AbsoluteUri;
    }

    /// <summary>
    /// Endereço que não é da internet pública: o próprio PC (127.x, ::1), rede de casa/empresa (10.x, 172.16–31.x,
    /// 192.168.x, fc00::/7), "link-local" (169.254.x, fe80::), rede da operadora (100.64–127.x), multicast e "0.0.0.0".
    /// Endereço IPv6 que embute um IPv4 (::ffff:192.168.0.1) é conferido pelo IPv4 de dentro.
    /// </summary>
    internal static bool EhEnderecoInterno(IPAddress endereco)
    {
        if (endereco.IsIPv4MappedToIPv6) endereco = endereco.MapToIPv4();
        if (IPAddress.IsLoopback(endereco) || endereco.Equals(IPAddress.Any) || endereco.Equals(IPAddress.IPv6Any)) return true;
        if (endereco.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
            return endereco.IsIPv6LinkLocal || endereco.IsIPv6SiteLocal || endereco.IsIPv6Multicast || endereco.IsIPv6UniqueLocal;
        var partes = endereco.GetAddressBytes();
        return partes[0] == 10 || partes[0] == 127 || partes[0] == 0
            || (partes[0] == 172 && partes[1] >= 16 && partes[1] <= 31)
            || (partes[0] == 192 && partes[1] == 168)
            || (partes[0] == 169 && partes[1] == 254)
            || (partes[0] == 100 && partes[1] >= 64 && partes[1] <= 127)
            || partes[0] >= 224;   // multicast e reservados
    }

    public bool Pausado { get => _pausado; set => _pausado = value; }

    /// <summary>Acha a música e devolve a faixa + a oferta SDP para a página registrar no SFU.</summary>
    public async Task<(Faixa Faixa, string Sdp)> PrepararAsync(string consulta) => await PrepararAsync(await AcharAsync(consulta));

    /// <summary>Prepara a faixa já achada (ver <see cref="AcharFaixaOuPlaylistAsync"/>) e devolve a oferta SDP.</summary>
    public async Task<(Faixa Faixa, string Sdp)> PrepararAsync(Faixa faixa)
    {
        _pagina = faixa.Pagina;
        _comLogin = faixa.ComLogin;
        _pc = new RTCPeerConnection(new RTCConfiguration
        {
            iceServers = [new RTCIceServer { urls = "stun:stun.cloudflare.com:3478" }],
            X_UseRtpFeedbackProfile = true,
        });
        _pc.addTrack(new MediaStreamTrack(Opus, MediaStreamStatusEnum.SendOnly));
        _pc.onconnectionstatechange += s =>
        {
            Console.WriteLine($"[música] conexão: {s}");
            if (s == RTCPeerConnectionState.connected && !_conectado) { _conectado = true; _ = TocarAsync(); }
            else if (s is RTCPeerConnectionState.failed or RTCPeerConnectionState.disconnected && _conectado) { _conectado = false; Estado?.Invoke("erro", "a conexão caiu"); }
        };
        var oferta = _pc.createOffer(null);
        await _pc.setLocalDescription(oferta);
        return (faixa, oferta.sdp);
    }

    public void AplicarResposta(string sdp)
    {
        var r = _pc?.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.answer, sdp = sdp });
        if (r != SetDescriptionResultEnum.OK) throw new InvalidOperationException("resposta do Realtime recusada: " + r);
    }

    /// <summary>yt-dlp baixa o áudio e joga no FFmpeg, que entrega PCM 48 kHz estéreo; o ritmo (20 ms por quadro) é nosso.</summary>
    private async Task TocarAsync()
    {
        _cts = new CancellationTokenSource();
        var ct = _cts.Token;
        try
        {
            var ytdlp = AcharYtDlp() ?? throw new InvalidOperationException("yt-dlp não encontrado — reinstale o Caocorde");
            var ffmpeg = ScreenEncoder.FindFfmpeg() ?? throw new InvalidOperationException("FFmpeg não encontrado — reinstale o Caocorde");
            _ytdlp = Filhos.Prender(Process.Start(YtDlp(ytdlp, _comLogin, await LinkPublicoAsync(_pagina), "-q", "--no-playlist", "-f", "bestaudio/best", "-o", "-"))!);
            _ffmpeg = Filhos.Prender(Process.Start(new ProcessStartInfo(ffmpeg, "-hide_banner -loglevel error -i pipe:0 -vn -f s16le -ar 48000 -ac 2 pipe:1")
            { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true })!);
            _ = _ytdlp.StandardError.ReadToEndAsync(ct).ContinueWith(t => { if (t.IsCompletedSuccessfully && t.Result.Length > 0) Console.WriteLine("[yt-dlp] " + t.Result.Trim()); });
            _ = _ffmpeg.StandardError.ReadToEndAsync(ct);
            // yt-dlp → FFmpeg (o yt-dlp cuida de cabeçalhos, limites de velocidade e formatos de cada site).
            _ = Task.Run(async () =>
            {
                try { await _ytdlp.StandardOutput.BaseStream.CopyToAsync(_ffmpeg.StandardInput.BaseStream, ct); } catch { }
                try { _ffmpeg.StandardInput.Close(); } catch { }
            }, ct);

            var opus = OpusCodecFactory.CreateEncoder(48000, 2, OpusApplication.OPUS_APPLICATION_AUDIO);
            opus.Bitrate = 96_000;
            opus.SignalType = OpusSignal.OPUS_SIGNAL_MUSIC;
            var entrada = _ffmpeg.StandardOutput.BaseStream;
            var pcm = new byte[BytesQuadro];
            var amostras = new short[Amostras * 2];
            var saida = new byte[1500];
            var relogio = Stopwatch.StartNew();
            long quadros = 0;
            while (!ct.IsCancellationRequested)
            {
                if (_pausado) { await Task.Delay(50, ct); relogio.Restart(); quadros = 0; continue; }
                int lido = 0;
                while (lido < BytesQuadro)
                {
                    int n = await entrada.ReadAsync(pcm.AsMemory(lido, BytesQuadro - lido), ct);
                    if (n <= 0) break;
                    lido += n;
                }
                if (lido == 0) break;   // acabou
                if (lido < BytesQuadro) Array.Clear(pcm, lido, BytesQuadro - lido);
                Buffer.BlockCopy(pcm, 0, amostras, 0, BytesQuadro);
                int tam = opus.Encode(amostras, Amostras, saida, saida.Length);
                if (_conectado) try { _pc?.SendAudio(Amostras, saida[..tam]); } catch { }
                // Manda no ritmo do relógio (sem isso a música inteira sairia em segundos).
                quadros++;
                var adiantado = quadros * 20 - relogio.ElapsedMilliseconds;
                if (adiantado > 0) await Task.Delay((int)Math.Min(adiantado, 100), ct);
            }
            if (!ct.IsCancellationRequested)
            {
                await _ffmpeg.WaitForExitAsync(ct);
                // Nada saiu do FFmpeg: o yt-dlp não conseguiu baixar.
                if (quadros == 0) Estado?.Invoke("erro", "não consegui baixar o áudio");
                else Estado?.Invoke("fim", null);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Console.WriteLine($"[música] erro: {ex.Message}");
            Estado?.Invoke("erro", ex.Message);
        }
    }

    // ---------------- achar a música ----------------

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10), DefaultRequestHeaders = { { "User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } } };

    /// <summary>A fila da call vai até 100 músicas: não adianta ler mais que isso de uma playlist.</summary>
    public const int MaximoDeMusicasDaPlaylist = 100;

    /// <summary>Link de playlist ou álbum do Spotify (com ou sem "intl-pt/" no caminho). Grupos: tipo e código.</summary>
    private static readonly Regex LinkDeListaDoSpotify = new(@"^https?://(?:open\.)?spotify\.com/(?:intl-[a-z-]+/)?(playlist|album)/([A-Za-z0-9]{10,40})", RegexOptions.IgnoreCase);

    /// <summary>
    /// Link do YouTube que é um "Mix" (list=RD...): é uma rádio sem fim montada pelo YouTube, não uma playlist de
    /// alguém. Continua tocando só a música do link, como antes.
    /// </summary>
    private static readonly Regex MixDoYouTube = new(@"[?&]list=RD", RegexOptions.IgnoreCase);

    /// <summary>
    /// Igual a <see cref="AcharAsync"/>, mas entende link de PLAYLIST (ou álbum) de qualquer site que o bot toca:
    /// YouTube e YouTube Music, SoundCloud, Bandcamp, Mixcloud, Vimeo e os outros do yt-dlp, e Spotify (playlist e
    /// álbum, pela página pública). Devolve a música (Faixa) OU a playlist; a página manda a playlist para o servidor,
    /// que troca o item da fila pelas músicas dela.
    /// </summary>
    public static async Task<(Faixa? Faixa, Playlist? Playlist)> AcharFaixaOuPlaylistAsync(string consulta)
    {
        consulta = consulta.Trim();
        var listaDoSpotify = LinkDeListaDoSpotify.Match(consulta);
        if (listaDoSpotify.Success)
            return (null, await PlaylistDoSpotifyAsync(listaDoSpotify.Groups[1].Value.ToLowerInvariant(), listaDoSpotify.Groups[2].Value));

        var ehLinkQueOYtDlpAbre = Regex.IsMatch(consulta, @"^https?://", RegexOptions.IgnoreCase)
            && !Regex.IsMatch(consulta, @"^https?://(open\.)?spotify\.com/", RegexOptions.IgnoreCase)
            && !MixDoYouTube.IsMatch(consulta);
        if (ehLinkQueOYtDlpAbre)
        {
            var ytdlp = AcharYtDlp() ?? throw new InvalidOperationException("yt-dlp não encontrado — reinstale o Caocorde");
            try
            {
                // Uma chamada só serve para os dois casos: com --flat-playlist, link de playlist devolve a lista
                // (rápido, sem abrir cada música) e link de uma música devolve a música inteira, como antes.
                using var resposta = await RodarYtDlpAsync(ytdlp, consulta, "-J", "--flat-playlist", "--yes-playlist",
                    "--playlist-end", MaximoDeMusicasDaPlaylist.ToString(), "-f", "bestaudio/best");
                var raiz = resposta.RootElement;
                var ehPlaylist = raiz.TryGetProperty("entries", out var entradas) && entradas.ValueKind == JsonValueKind.Array;
                if (!ehPlaylist) return (FaixaDoJson(raiz, consulta), null);

                var playlist = PlaylistDoJson(raiz, entradas);
                if (playlist.Faixas.Count == 0) throw new InvalidOperationException("a playlist está vazia (ou é privada)");
                // "Playlist" de uma música só (alguns sites embrulham a página assim): toca a música direto.
                if (playlist.Faixas.Count == 1) return (await AcharAsync(playlist.Faixas[0].Consulta), null);
                return (null, playlist);
            }
            catch (InvalidOperationException erroDoAtalho) when (!erroDoAtalho.Message.StartsWith("a playlist"))
            {
                // Bloqueio do YouTube ("não é um robô"), link estranho etc.: o caminho de sempre trata
                // (login do YouTube, SoundCloud como reserva) e dá a mensagem certa.
                Console.WriteLine($"[música] abrir como playlist não deu ({erroDoAtalho.Message}); tentando como música");
            }
        }
        return (await AcharAsync(consulta), null);
    }

    /// <summary>
    /// Lê a resposta do yt-dlp (-J --flat-playlist) de uma playlist. Pula o que não dá para tocar: vídeo privado ou
    /// apagado, transmissão ao vivo e coisa de mais de 3 horas.
    /// </summary>
    internal static Playlist PlaylistDoJson(JsonElement raiz, JsonElement entradas)
    {
        string? TextoDe(JsonElement elemento, string campo) =>
            elemento.TryGetProperty(campo, out var valor) && valor.ValueKind == JsonValueKind.String ? valor.GetString() : null;

        var faixas = new List<FaixaDaPlaylist>();
        foreach (var entrada in entradas.EnumerateArray())
        {
            if (faixas.Count >= MaximoDeMusicasDaPlaylist) break;
            if (entrada.ValueKind != JsonValueKind.Object) continue;   // música que deu erro vem como "null"
            var titulo = TextoDe(entrada, "title");
            var situacaoAoVivo = TextoDe(entrada, "live_status");
            int? duracaoEmSegundos = entrada.TryGetProperty("duration", out var duracao) && duracao.ValueKind == JsonValueKind.Number ? (int)duracao.GetDouble() : null;
            if (titulo is "[Private video]" or "[Deleted video]") continue;
            if (situacaoAoVivo is "is_live" or "is_upcoming" || duracaoEmSegundos > 3 * 3600) continue;

            // O link da música: "url" (quase todos os sites) ou, no YouTube, montado pelo código do vídeo.
            var link = TextoDe(entrada, "webpage_url") ?? TextoDe(entrada, "url");
            if (link == null && TextoDe(entrada, "ie_key") == "Youtube" && TextoDe(entrada, "id") is { } codigoDoVideo)
                link = $"https://www.youtube.com/watch?v={codigoDoVideo}";
            if (link == null || !Regex.IsMatch(link, @"^https?://", RegexOptions.IgnoreCase)) continue;
            faixas.Add(new FaixaDaPlaylist(link, titulo, duracaoEmSegundos));
        }
        var totalNoSite = raiz.TryGetProperty("playlist_count", out var contagem) && contagem.ValueKind == JsonValueKind.Number
            ? contagem.GetInt32() : entradas.GetArrayLength();
        return new Playlist(TextoDe(raiz, "title") ?? "playlist", faixas, Math.Max(totalNoSite, faixas.Count));
    }

    /// <summary>
    /// Playlist ou álbum do Spotify pela página pública de "incorporar" (open.spotify.com/embed/...), a mesma que
    /// os sites usam para mostrar o player; não precisa de conta. Cada música vira uma busca "nome artista" (o
    /// Spotify não deixa baixar o áudio; o bot acha a mesma música no YouTube, como já faz com link de música).
    /// </summary>
    private static async Task<Playlist> PlaylistDoSpotifyAsync(string tipoDaLista, string codigoDaLista)
    {
        string pagina;
        try { pagina = await Http.GetStringAsync($"https://open.spotify.com/embed/{tipoDaLista}/{codigoDaLista}"); }
        catch (HttpRequestException) { throw new InvalidOperationException("não consegui abrir essa playlist do Spotify (é privada?)"); }
        var dadosDaPagina = Regex.Match(pagina, "<script id=\"__NEXT_DATA__\" type=\"application/json\">(.*?)</script>", RegexOptions.Singleline);
        if (!dadosDaPagina.Success) throw new InvalidOperationException("não consegui ler essa playlist do Spotify");
        using var json = JsonDocument.Parse(dadosDaPagina.Groups[1].Value);
        if (!json.RootElement.TryGetProperty("props", out var propriedades)
            || !propriedades.TryGetProperty("pageProps", out var propriedadesDaPagina)
            || !propriedadesDaPagina.TryGetProperty("state", out var estado)
            || !estado.TryGetProperty("data", out var dados)
            || !dados.TryGetProperty("entity", out var lista)
            || !lista.TryGetProperty("trackList", out var musicas) || musicas.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("não consegui ler essa playlist do Spotify");

        string? TextoDe(JsonElement elemento, string campo) =>
            elemento.TryGetProperty(campo, out var valor) && valor.ValueKind == JsonValueKind.String ? valor.GetString() : null;
        var faixas = new List<FaixaDaPlaylist>();
        foreach (var musica in musicas.EnumerateArray())
        {
            if (faixas.Count >= MaximoDeMusicasDaPlaylist) break;
            if (musica.ValueKind != JsonValueKind.Object) continue;
            var nomeDaMusica = TextoDe(musica, "title");
            var artistas = TextoDe(musica, "subtitle") ?? "";
            if (string.IsNullOrWhiteSpace(nomeDaMusica)) continue;
            int? duracaoEmSegundos = musica.TryGetProperty("duration", out var duracaoEmMilissegundos) && duracaoEmMilissegundos.ValueKind == JsonValueKind.Number
                ? (int)(duracaoEmMilissegundos.GetDouble() / 1000) : null;
            // " audio" no fim: igual ao link de música do Spotify, prefere o áudio oficial ao clipe.
            faixas.Add(new FaixaDaPlaylist($"{nomeDaMusica} {artistas} audio".Trim(),
                string.IsNullOrWhiteSpace(artistas) ? nomeDaMusica : $"{nomeDaMusica} — {artistas}", duracaoEmSegundos));
        }
        if (faixas.Count == 0) throw new InvalidOperationException("a playlist do Spotify está vazia");
        var nomeDaLista = TextoDe(lista, "name") ?? TextoDe(lista, "title") ?? "playlist do Spotify";
        return new Playlist(nomeDaLista, faixas, Math.Max(musicas.GetArrayLength(), faixas.Count));
    }

    /// <summary>Roda o yt-dlp (sem login) e devolve o JSON da resposta; erro do yt-dlp vira mensagem curta.</summary>
    private static async Task<JsonDocument> RodarYtDlpAsync(string ytdlp, string link, params string[] opcoes)
    {
        var configuracao = YtDlp(ytdlp, false, await LinkPublicoAsync(link), opcoes);
        using var processo = Filhos.Prender(Process.Start(configuracao)!);
        var leituraDaSaida = processo.StandardOutput.ReadToEndAsync();
        var leituraDosErros = processo.StandardError.ReadToEndAsync();
        await processo.WaitForExitAsync();
        return LerRespostaDoYtDlp(await leituraDaSaida, await leituraDosErros);
    }

    /// <summary>
    /// Transforma a resposta do yt-dlp (-J) em JSON, ou em erro com a mensagem do próprio yt-dlp.
    /// Por quê: quando dá erro (vídeo indisponível, YouTube pedindo "confirme que não é um robô"...), o yt-dlp
    /// novo (2026.10) escreve "null" em vez de não escrever nada. Sem esta conferência o app tentava ler o "null"
    /// como música, dava um erro sem sentido ("requires an element of type 'Object'") e a mensagem de verdade
    /// sumia — e com ela a saída reserva (login do YouTube, SoundCloud), que depende de reconhecer o bloqueio.
    /// </summary>
    internal static JsonDocument LerRespostaDoYtDlp(string saida, string erros)
    {
        var mensagemDoYtDlp = UltimaLinha(erros) ?? "não achei essa música";
        if (string.IsNullOrWhiteSpace(saida)) throw new InvalidOperationException(mensagemDoYtDlp);
        JsonDocument resposta;
        try { resposta = JsonDocument.Parse(saida); }
        catch (JsonException) { throw new InvalidOperationException(mensagemDoYtDlp); }
        if (resposta.RootElement.ValueKind != JsonValueKind.Object)
        {
            resposta.Dispose();
            throw new InvalidOperationException(mensagemDoYtDlp);
        }
        return resposta;
    }

    public static async Task<Faixa> AcharAsync(string consulta)
    {
        consulta = consulta.Trim();
        var ytdlp = AcharYtDlp() ?? throw new InvalidOperationException("yt-dlp não encontrado — reinstale o Caocorde");
        string? busca = null;
        if (Regex.IsMatch(consulta, @"^https?://(open\.)?spotify\.com/", RegexOptions.IgnoreCase)) busca = await NomeNoSpotifyAsync(consulta) + " audio";
        else if (!Regex.IsMatch(consulta, @"^https?://", RegexOptions.IgnoreCase)) busca = consulta;
        Faixa? achada = null;
        try
        {
            if (busca == null) return await ExtrairAsync(ytdlp, consulta);
            achada = await BuscarAsync(ytdlp, busca, "ytsearch5");
            await ExtrairAsync(ytdlp, achada.Pagina);   // a busca não toca no vídeo; o bloqueio do YouTube aparece aqui
            return achada;
        }
        catch (InvalidOperationException ex) when (BloqueadoPeloYouTube(ex.Message))
        {
            // O YouTube às vezes pede "entre na conta para confirmar que não é um robô" (depende da internet e da hora).
            // Com o login do YouTube carregado nas Configurações, entra com ele (é o que o próprio YouTube pede);
            // sem login, ou se nem assim der, procura a mesma música no SoundCloud.
            var link = achada?.Pagina ?? consulta;
            if (File.Exists(ArquivoCookies))
            {
                try
                {
                    var comLogin = await ExtrairAsync(ytdlp, link, comLogin: true);
                    Console.WriteLine("[música] YouTube pediu para entrar na conta; usando o login carregado");
                    return (achada ?? comLogin) with { ComLogin = true };
                }
                catch (InvalidOperationException ex2) { Console.WriteLine($"[música] o login do YouTube não resolveu ({ex2.Message})"); }
            }
            var nome = busca ?? await NomeNoYouTubeAsync(consulta) ?? throw new InvalidOperationException("o YouTube bloqueou e não deu para saber o nome da música");
            Console.WriteLine($"[música] YouTube bloqueou (anti-robô); procurando no SoundCloud: {nome}");
            return await BuscarAsync(ytdlp, nome, "scsearch5");
        }
    }

    private static bool BloqueadoPeloYouTube(string erro) =>
        erro.Contains("not a bot", StringComparison.OrdinalIgnoreCase) || erro.Contains("Sign in to confirm", StringComparison.OrdinalIgnoreCase);

    /// <summary>Nome e artista de um link do YouTube/YouTube Music pela API pública de oEmbed (não baixa nada).</summary>
    private static async Task<string?> NomeNoYouTubeAsync(string url)
    {
        var id = Regex.Match(url, @"(?:v=|youtu\.be/|/shorts/)([\w-]{11})").Groups[1].Value;
        if (id.Length != 11) return null;
        try
        {
            using var doc = JsonDocument.Parse(await Http.GetStringAsync($"https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v={id}"));
            var titulo = doc.RootElement.GetProperty("title").GetString() ?? "";
            var autor = (doc.RootElement.TryGetProperty("author_name", out var a) ? a.GetString() : "")?.Replace(" - Topic", "") ?? "";
            return titulo.Contains(autor, StringComparison.OrdinalIgnoreCase) ? titulo : $"{titulo} {autor}".Trim();
        }
        catch { return null; }
    }

    /// <summary>Abre o link de verdade (o que o player vai baixar): título, duração e capa.</summary>
    private static async Task<Faixa> ExtrairAsync(string ytdlp, string alvo, bool comLogin = false)
    {
        var consulta = alvo;
        var psi = YtDlp(ytdlp, comLogin, await LinkPublicoAsync(alvo), "-J", "--no-playlist", "-f", "bestaudio/best");
        using var p = Filhos.Prender(Process.Start(psi)!);
        var json = await p.StandardOutput.ReadToEndAsync();
        var erro = await p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        using var doc = LerRespostaDoYtDlp(json, erro);
        var e = doc.RootElement;
        if (e.TryGetProperty("entries", out var lista) && lista.ValueKind == JsonValueKind.Array)
        {
            // Primeira música que veio de verdade (com erro, o yt-dlp põe "null" no lugar dela).
            var primeiraQueVeio = lista.EnumerateArray().FirstOrDefault(entrada => entrada.ValueKind == JsonValueKind.Object);
            if (primeiraQueVeio.ValueKind != JsonValueKind.Object) throw new InvalidOperationException(UltimaLinha(erro) ?? "não achei essa música");
            e = primeiraQueVeio;
        }
        return FaixaDoJson(e, consulta);
    }

    /// <summary>Lê título, duração, capa e página de uma música na resposta do yt-dlp (-J).</summary>
    private static Faixa FaixaDoJson(JsonElement e, string consulta)
    {
        string? Texto(string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        int? dur = e.TryGetProperty("duration", out var d) && d.ValueKind == JsonValueKind.Number ? (int)d.GetDouble() : null;
        var pagina = Texto("webpage_url") ?? Texto("original_url") ?? consulta;
        if (dur > 3 * 3600) throw new InvalidOperationException("muito longa (mais de 3 horas) ou é ao vivo");
        return new Faixa(Texto("title") ?? consulta, dur, Texto("thumbnail"), pagina);
    }

    /// <summary>
    /// Busca no YouTube (rápida, só a lista de 5 resultados) e pega o primeiro que é música de verdade:
    /// sem transmissão ao vivo e com no máximo 3 horas (busca genérica tipo "lofi" costuma cair em live 24 h).
    /// </summary>
    private static async Task<Faixa> BuscarAsync(string ytdlp, string busca, string prefixo)
    {
        var psi = YtDlp(ytdlp, false, $"{prefixo}:{busca}", "--flat-playlist", "-J");
        using var p = Filhos.Prender(Process.Start(psi)!);
        var json = await p.StandardOutput.ReadToEndAsync();
        var erro = await p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        using var doc = LerRespostaDoYtDlp(json, erro);
        if (!doc.RootElement.TryGetProperty("entries", out var resultados) || resultados.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException(UltimaLinha(erro) ?? "não achei essa música");
        foreach (var e in resultados.EnumerateArray())
        {
            if (e.ValueKind != JsonValueKind.Object) continue;   // resultado que deu erro vem como "null"
            string? Texto(string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            int? dur = e.TryGetProperty("duration", out var d) && d.ValueKind == JsonValueKind.Number ? (int)d.GetDouble() : null;
            var live = Texto("live_status");
            // (SoundCloud na lista rápida nem sempre traz a duração: aceita sem.)
            if (live is "is_live" or "is_upcoming" || dur > 3 * 3600 || (dur is null && prefixo.StartsWith("yt"))) continue;
            var capa = e.TryGetProperty("thumbnails", out var t) && t.ValueKind == JsonValueKind.Array && t.GetArrayLength() > 0
                ? t[t.GetArrayLength() - 1].GetProperty("url").GetString() : null;
            var url = Texto("url") ?? (Texto("id") is { } id ? $"https://www.youtube.com/watch?v={id}" : null);
            if (url != null) return new Faixa(Texto("title") ?? busca, dur, capa, url);
        }
        throw new InvalidOperationException("não achei uma música (só live ou vídeo de mais de 3 horas)");
    }

    /// <summary>Link do Spotify → "Música Artista" (da própria página pública: og:title e og:description).</summary>
    private static async Task<string> NomeNoSpotifyAsync(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https") || u.Host.ToLowerInvariant() is not ("open.spotify.com" or "spotify.com"))
            throw new InvalidOperationException("link do Spotify inválido");
        var html = await Http.GetStringAsync(url);
        string Meta(string prop) => WebUtility.HtmlDecode(Regex.Match(html, $"<meta property=\"{prop}\" content=\"([^\"]*)\"").Groups[1].Value);
        var titulo = Meta("og:title");
        var artista = Meta("og:description").Split('·').Select(x => x.Trim()).FirstOrDefault() ?? "";
        if (string.IsNullOrWhiteSpace(titulo)) throw new InvalidOperationException("não consegui ler o link do Spotify");
        return $"{titulo} {artista}".Trim();
    }

    private static string? UltimaLinha(string s) => s.Split('\n', StringSplitOptions.RemoveEmptyEntries).LastOrDefault()?.Replace("ERROR: ", "").Trim();

    /// <summary>
    /// O YouTube muda direto e o yt-dlp velho para de funcionar: o que vem com o app se atualiza sozinho
    /// (yt-dlp -U, versão oficial do GitHub), no máximo uma vez por dia, em segundo plano.
    /// </summary>
    public static void AtualizarYtDlpSePreciso()
    {
        var local = Path.Combine(AppContext.BaseDirectory, "yt-dlp.exe");
        var marca = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Concorde", "yt-dlp-atualizado.txt");
        try
        {
            if (!File.Exists(local) || (File.Exists(marca) && DateTime.UtcNow - File.GetLastWriteTimeUtc(marca) < TimeSpan.FromDays(1))) return;
            Directory.CreateDirectory(Path.GetDirectoryName(marca)!);
            File.WriteAllText(marca, DateTime.UtcNow.ToString("o"));
            _ = Task.Run(async () =>
            {
                using var p = Process.Start(new ProcessStartInfo(local, "-U") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true })!;   // fora do job: não pode morrer no meio da troca do .exe
                Console.WriteLine("[yt-dlp] " + (await p.StandardOutput.ReadToEndAsync()).Trim().Split('\n').LastOrDefault());
            });
        }
        catch { }
    }

    /// <summary>yt-dlp: ao lado do programa, no PATH ou na instalação do winget.</summary>
    public static string? AcharYtDlp()
    {
        var local = Path.Combine(AppContext.BaseDirectory, "yt-dlp.exe");
        if (File.Exists(local)) return local;
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            try { var p = Path.Combine(dir.Trim(), "yt-dlp.exe"); if (File.Exists(p)) return p; } catch { }
        }
        var winget = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WinGet", "Packages");
        return Directory.Exists(winget) ? Directory.EnumerateFiles(winget, "yt-dlp.exe", SearchOption.AllDirectories).FirstOrDefault() : null;
    }

    public async ValueTask DisposeAsync()
    {
        _cts?.Cancel();
        _conectado = false;
        foreach (var p in new[] { _ytdlp, _ffmpeg }) { try { if (p is { HasExited: false }) p.Kill(true); } catch { } }
        try { _pc?.close(); } catch { }
        await Task.CompletedTask;
    }
}
