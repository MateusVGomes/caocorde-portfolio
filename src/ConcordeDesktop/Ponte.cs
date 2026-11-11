using System.Drawing.Imaging;
using System.Text.Json;
using System.Text.Json.Nodes;
using Concorde.Captura;
using Microsoft.Web.WebView2.Core;

namespace Concorde;

/// <summary>
/// Ponte entre a página e o app: a página chama window.concordeApp.nativo.* (mensagem com id),
/// o app responde com { id, ok, valor | erro } e avisa eventos com { evento, dados }.
/// Só aceita mensagens do nosso site.
/// </summary>
public sealed class Ponte
{
    /// <summary>Script injetado na página: cria window.concordeApp (versão, convite e as funções nativas).</summary>
    public static string Script(string origem, object dados) => $$"""
        if (location.origin === {{JsonSerializer.Serialize(origem)}}) (() => {
          const pendentes = new Map(); let n = 0;
          const ouvintes = new Set();
          window.chrome.webview.addEventListener('message', e => {
            const m = e.data;
            if (m && m.id != null && pendentes.has(m.id)) {
              const [ok, falha] = pendentes.get(m.id); pendentes.delete(m.id);
              m.ok ? ok(m.valor) : falha(new Error(m.erro));
            } else if (m && m.evento) ouvintes.forEach(f => { try { f(m.evento, m.dados); } catch {} });
          });
          const chamar = (metodo, args) => new Promise((ok, falha) => {
            const id = ++n; pendentes.set(id, [ok, falha]);
            window.chrome.webview.postMessage({ id, metodo, args });
          });
          const nativo = Object.freeze({
            fontes: () => chamar('fontes'), apps: () => chamar('apps'), placas: () => chamar('placas'),
            iniciar: p => chamar('iniciar', p), resposta: sdp => chamar('resposta', { sdp }), parar: () => chamar('parar'),
            ajustar: p => chamar('ajustar', p),
            estatisticas: () => chamar('estatisticas'),
            aceleracao: () => chamar('aceleracao'), mudarAceleracao: ligada => chamar('aceleracao-mudar', { ligada }), reiniciar: () => chamar('reiniciar'),
            musicaTocar: consulta => chamar('musica-tocar', { consulta }), musicaResposta: sdp => chamar('musica-resposta', { sdp }),
            musicaPausar: pausado => chamar('musica-pausar', { pausado }), musicaParar: () => chamar('musica-parar'),
            atualizacao: () => chamar('atualizacao'), atualizar: () => chamar('atualizar'),
            atalhos: lista => chamar('atalhos', { lista }),
            youtubeLogin: () => chamar('youtube-login'), youtubeLoginAutomatico: () => chamar('youtube-login-automatico'), youtubeLoginEstado: () => chamar('youtube-login-estado'), youtubeLoginRemover: () => chamar('youtube-login-remover'),
            aoEvento: f => { ouvintes.add(f); return () => ouvintes.delete(f); },
          });
          window.concordeApp = Object.freeze({ ...{{JsonSerializer.Serialize(dados)}}, nativo });
        })();
        """;

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    private readonly CoreWebView2 _core;
    private readonly string _origem;
    private readonly Control _ui;
    private Transmissao? _tx;

    /// <summary>Versão nova já baixada (null = nenhuma) e o "instalar agora" — vêm da janela.</summary>
    public Func<string?>? VersaoPendente { get; init; }
    public Action? AtualizarAgora { get; init; }

    /// <summary>Atualização baixada: a página mostra o botão "Atualizar".</summary>
    public void AvisarAtualizacao(string versao) => Evento("atualizacao", new { versao });
    private Musica? _musica;
    private Atalhos? _atalhos;

    public Ponte(CoreWebView2 core, string origem, Control ui)
    {
        _core = core;
        _origem = origem;
        _ui = ui;
    }

    /// <summary>
    /// O endereço é do nosso site? Compara a origem inteira (esquema + domínio + porta): "começa com" deixaria passar
    /// "https://nosso-site.workers.dev.golpe.com".
    /// </summary>
    public static bool DoSite(string? endereco, string origem) =>
        Uri.TryCreate(endereco, UriKind.Absolute, out var u)
        && string.Equals(u.GetLeftPart(UriPartial.Authority), origem, StringComparison.OrdinalIgnoreCase);

    /// <summary>Trata a mensagem se for uma chamada da ponte. Retorna false se não for (ex.: "tentar" da tela offline).</summary>
    public bool Tratar(CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!DoSite(e.Source, _origem)) return false;
        JsonNode? m;
        try { m = JsonNode.Parse(e.WebMessageAsJson); } catch { return false; }
        if (m is not JsonObject o || o["id"] is null || o["metodo"] is null) return false;
        var id = o["id"]!.GetValue<int>();
        var metodo = o["metodo"]!.GetValue<string>();
        var args = o["args"];
        _ = ResponderAsync(id, metodo, args);
        return true;
    }

    private async Task ResponderAsync(int id, string metodo, JsonNode? args)
    {
        try
        {
            object? valor = metodo switch
            {
                "fontes" => await Task.Run(ListarFontes),
                "apps" => await Task.Run(() => AudioApps.List().Select(a => new { exe = a.Exe, nome = a.Name }).ToList()),
                "placas" => Placas,
                "iniciar" => await IniciarAsync(args.Deserialize<PedidoTransmissao>(Json) ?? throw new ArgumentException("pedido vazio")),
                "resposta" => Responder(args?["sdp"]?.GetValue<string>() ?? ""),
                "ajustar" => await (_tx ?? throw new InvalidOperationException("transmissão não iniciada"))
                    .AjustarAsync(args.Deserialize<PedidoTransmissao>(Json) ?? throw new ArgumentException("pedido vazio"),
                        args?["atualizar"]?.GetValue<bool>() ?? false),
                "parar" => await PararAsync(),
                "estatisticas" => _tx?.Estatisticas(),
                "aceleracao" => EstadoAceleracao(),
                "aceleracao-mudar" => MudarAceleracao(args?["ligada"]?.GetValue<bool>() ?? true),
                "reiniciar" => Reiniciar(),
                "atualizacao" => VersaoPendente?.Invoke(),
                "atalhos" => DefinirAtalhos(args?["lista"]?.AsArray()),
                "youtube-login" => CarregarCookies(),
                "youtube-login-automatico" => await EntrarNoYouTubePelaJanelaAsync(),
                "youtube-login-estado" => EstadoCookies(),
                "youtube-login-remover" => RemoverCookies(),
                "atualizar" => Atualizar(),
                "musica-tocar" => await TocarMusicaAsync(args?["consulta"]?.GetValue<string>() ?? ""),
                "musica-resposta" => ResponderMusica(args?["sdp"]?.GetValue<string>() ?? ""),
                "musica-pausar" => PausarMusica(args?["pausado"]?.GetValue<bool>() ?? false),
                "musica-parar" => await PararMusicaAsync(),
                _ => throw new ArgumentException("método desconhecido: " + metodo),
            };
            Enviar(new { id, ok = true, valor });
        }
        catch (Exception ex)
        {
            Enviar(new { id, ok = false, erro = ex.Message });
        }
    }

    private static readonly object[] Placas =
    [
        new { id = "auto", nome = "Automático (recomendado)" },
        new { id = "nvenc", nome = "NVIDIA (NVENC)" },
        new { id = "amf", nome = "AMD Radeon (AMF)" },
        new { id = "qsv", nome = "Intel (Quick Sync)" },
        new { id = "mf", nome = "Windows Media Foundation (qualquer placa)" },
        new { id = "x264", nome = "Processador (sem placa — mais pesado)" },
    ];

    /// <summary>Telas e janelas abertas, com miniatura (JPEG pequeno) para a escolha na página.</summary>
    private static List<object> ListarFontes()
    {
        var lista = new List<object>();
        foreach (var f in CaptureSource.List())
        {
            if (f.IsMinimized) continue;
            string? mini = null;
            using (var bmp = f.GrabPreview(new Size(480, 270)))
            {
                if (bmp != null)
                {
                    using var ms = new MemoryStream();
                    var enc = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
                    using var p = new EncoderParameters(1) { Param = { [0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 70L) } };
                    bmp.Save(ms, enc, p);
                    mini = "data:image/jpeg;base64," + Convert.ToBase64String(ms.ToArray());
                }
            }
            lista.Add(new { id = Transmissao.Id(f), tipo = f.Kind == SourceKind.Monitor ? "tela" : "janela", nome = f.Name, miniatura = mini });
        }
        return lista;
    }

    private async Task<object> IniciarAsync(PedidoTransmissao p)
    {
        await PararAsync();
        var tx = new Transmissao();
        tx.Estado += estado => Evento("transmissao", new { estado });
        tx.Qualidade += (nome, reduzida, motivo) => Evento("transmissao", new { estado = "qualidade", nome, reduzida, motivo });
        try
        {
            var sdp = await tx.IniciarAsync(p);
            _tx = tx;
            return new { sdp, encoder = tx.Encoder, som = tx.TemSom };
        }
        catch
        {
            await tx.DisposeAsync();
            throw;
        }
    }

    private object Responder(string sdp)
    {
        (_tx ?? throw new InvalidOperationException("transmissão não iniciada")).AplicarResposta(sdp);
        return true;
    }

    private async Task<object> PararAsync()
    {
        var tx = _tx;
        _tx = null;
        if (tx != null) await tx.DisposeAsync();
        return true;
    }

    // ---------------- aceleração de hardware (vale ao reabrir o app) ----------------

    private static object EstadoAceleracao() => new { ligada = Preferencias.AceleracaoSalva, emUso = Preferencias.Aceleracao };

    private static object MudarAceleracao(bool ligada)
    {
        Preferencias.SalvarAceleracao(ligada);
        return EstadoAceleracao();
    }

    private object Reiniciar()
    {
        if (!_ui.IsDisposed && _ui is MainWindow janela) _ui.BeginInvoke(janela.Reiniciar);
        return true;
    }

    // ---------------- login do YouTube para o bot (cookies, só neste PC) ----------------

    private object CarregarCookies()
    {
        string? escolhido = null;
        _ui.Invoke(() =>
        {
            using var d = new OpenFileDialog
            {
                Title = "Arquivo de cookies do YouTube (cookies.txt)",
                Filter = "Cookies (*.txt)|*.txt|Todos os arquivos|*.*",
            };
            if (d.ShowDialog(_ui) == DialogResult.OK) escolhido = d.FileName;
        });
        if (escolhido == null) return new { ok = false };
        var texto = File.ReadAllText(escolhido);
        // Formato Netscape (o que a extensão e o yt-dlp usam) e com o login do YouTube/Google dentro.
        bool netscape = texto.Contains("# Netscape HTTP Cookie File") || texto.Contains("# HTTP Cookie File");
        bool youtube = System.Text.RegularExpressions.Regex.IsMatch(texto, @"(^|
).?youtube.com	", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!netscape || !youtube) throw new InvalidOperationException("Esse arquivo não parece ser um cookies.txt do YouTube (formato Netscape).");
        Directory.CreateDirectory(Path.GetDirectoryName(Musica.ArquivoCookies)!);
        File.WriteAllText(Musica.ArquivoCookies, texto);
        Console.WriteLine("[música] login do YouTube carregado");
        return EstadoCookies();
    }

    /// <summary>
    /// Login automático do bot de música: abre a janela do YouTube do próprio app (LoginDoYouTube.cs) e devolve o
    /// estado novo. A página só chama isto depois que a pessoa leu a explicação e clicou em "Autorizo".
    /// </summary>
    private async Task<object> EntrarNoYouTubePelaJanelaAsync()
    {
        var pastaDeDados = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), MainWindow.Teste ? "Concorde-Teste" : "Concorde");
        var quantidadeDeCookies = await LoginDoYouTube.AbrirAsync((Form)_ui, pastaDeDados);
        return new { copiados = quantidadeDeCookies, estado = EstadoCookies() };
    }

    private static object EstadoCookies()
    {
        var f = new FileInfo(Musica.ArquivoCookies);
        return new { configurado = f.Exists, desde = f.Exists ? f.LastWriteTime.ToString("dd/MM/yyyy") : null };
    }

    private static object RemoverCookies()
    {
        try { File.Delete(Musica.ArquivoCookies); } catch { }
        return EstadoCookies();
    }

    private object Atualizar()
    {
        if (!_ui.IsDisposed) _ui.BeginInvoke(() => AtualizarAgora?.Invoke());
        return true;
    }

    // ---------------- música (o app é o DJ da call) ----------------

    private async Task<object> TocarMusicaAsync(string consulta)
    {
        await PararMusicaAsync();
        // Link de playlist (ou álbum): não toca aqui; devolve as músicas para a página pôr na fila no lugar do link.
        var (faixaAchada, playlist) = await Musica.AcharFaixaOuPlaylistAsync(consulta);
        if (playlist != null)
            return new
            {
                playlist = new
                {
                    titulo = playlist.Titulo,
                    total = playlist.TotalNoSite,
                    faixas = playlist.Faixas.Select(faixa => new { consulta = faixa.Consulta, titulo = faixa.Titulo, duracao = faixa.DuracaoEmSegundos }),
                },
            };
        var m = new Musica();
        m.Estado += (estado, erro) => Evento("musica", new { estado, erro });
        try
        {
            var (f, sdp) = await m.PrepararAsync(faixaAchada!);
            _musica = m;
            return new { sdp, titulo = f.Titulo, duracao = f.Duracao, capa = f.Capa, pagina = f.Pagina };
        }
        catch
        {
            await m.DisposeAsync();
            throw;
        }
    }

    private object ResponderMusica(string sdp)
    {
        (_musica ?? throw new InvalidOperationException("nenhuma música preparada")).AplicarResposta(sdp);
        return true;
    }

    private object PausarMusica(bool pausado)
    {
        if (_musica != null) _musica.Pausado = pausado;
        return true;
    }

    private async Task<object> PararMusicaAsync()
    {
        var m = _musica;
        _musica = null;
        if (m != null) await m.DisposeAsync();
        return true;
    }

    /// <summary>
    /// Atalhos globais escolhidos na página ([{ acao, combo }]). Devolve as combinações que outro app já usa.
    /// Quando a pessoa aperta um, a página recebe o evento "atalho" { acao } e faz o mesmo que o botão.
    /// </summary>
    private List<string> DefinirAtalhos(JsonArray? lista)
    {
        var pares = (lista ?? []).OfType<JsonObject>()
            .Select(o => (Acao: o["acao"]?.GetValue<string>() ?? "", Combo: o["combo"]?.GetValue<string>() ?? ""))
            .Where(p => p.Acao is "mudo" or "surdo" or "camera" && p.Combo.Length > 0).ToList();
        // RegisterHotKey vale para a thread da janela: cria e troca sempre lá.
        return (List<string>)_ui.Invoke(() =>
        {
            if (_atalhos == null)
            {
                _atalhos = new Atalhos(_ui);
                _atalhos.Acionado += acao => Evento("atalho", new { acao });
            }
            return _atalhos.Definir(pares);
        });
    }

    /// <summary>App fechando: encerra a transmissão (FFmpeg e capturas de som) e a música.</summary>
    public void Encerrar() { try { _atalhos?.Dispose(); PararAsync().Wait(3000); PararMusicaAsync().Wait(2000); } catch { } }

    /// <summary>
    /// A página recarregou ou travou: ela esqueceu a transmissão e a música, então o app para as duas
    /// (senão a captura continuaria rodando sem ninguém saber, e sem botão para parar).
    /// </summary>
    public void PaginaRecomecou() => _ = Task.Run(async () => { try { await PararAsync(); await PararMusicaAsync(); } catch { } });

    private void Evento(string evento, object dados) => Enviar(new { evento, dados });

    private void Enviar(object msg)
    {
        var json = JsonSerializer.Serialize(msg);
        // A ponte responde de threads de fundo; o WebView2 só aceita na thread da janela.
        if (_ui.IsDisposed) return;
        _ui.BeginInvoke(() => { try { _core.PostWebMessageAsJson(json); } catch { } });
    }
}
