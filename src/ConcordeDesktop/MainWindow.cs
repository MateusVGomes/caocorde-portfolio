using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Concorde;

/// <summary>
/// App desktop do Concorde: uma janela com o site dentro (WebView2). Login e cadastro são as telas do próprio site,
/// e o app se atualiza sozinho junto com ele. Aqui ficam só as coisas de "app": login salvo, permissões,
/// links externos no navegador, tela de "sem conexão" e lembrar tamanho/posição da janela.
/// </summary>
public sealed class MainWindow : Form
{
    public const string Titulo = "Caocorde";
    private static readonly Color Fundo = Color.FromArgb(17, 17, 20);

    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Fundo };
    private readonly string _url;
    private readonly string _origem;
    private readonly string? _convite;
    private string? _atualizacaoPendente; // instalador baixado que a pessoa deixou para depois
    private Ponte? _ponte;
    /// <summary>
    /// Modo de teste (CONCORDE_TESTE=1): perfil separado, site em CONCORDE_TESTE_URL (pode ser http://127.0.0.1)
    /// e DevTools remoto na porta 9333 — não mexe no Concorde instalado da pessoa.
    /// </summary>
    public static readonly bool Teste = Environment.GetEnvironmentVariable("CONCORDE_TESTE") == "1";
    /// <summary>Teste da tela de atualização (CONCORDE_TESTE_ATUALIZAR=1): baixa e confere, mas não instala.</summary>
    private static readonly bool TesteAtualizacao = Teste && Environment.GetEnvironmentVariable("CONCORDE_TESTE_ATUALIZAR") == "1";
    private readonly string _dados = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Teste ? "Concorde-Teste" : "Concorde");

    public MainWindow()
    {
        Text = Titulo;
        BackColor = Fundo; // sem clarão branco enquanto carrega
        MinimumSize = new Size(900, 600);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        Controls.Add(_web);

        (_url, _convite) = LerConfig();
        _origem = new Uri(_url).GetLeftPart(UriPartial.Authority);
        RestaurarJanela();
        FormClosing += (_, _) => { SalvarJanela(); _ponte?.Encerrar(); };
        // Atualização baixada e deixada "para depois": instala em silêncio quando o app fecha.
        FormClosed += (_, _) => { if (_atualizacaoPendente != null) Atualizador.Instalar(_atualizacaoPendente, reabrir: false); };
        Load += async (_, _) => await IniciarAsync();
    }

    /// <summary>concorde.json (do instalador): endereço do site e, opcionalmente, o código de convite da galera.</summary>
    private static (string Url, string? Convite) LerConfig()
    {
        string url = "https://concorde.SEU-SUBDOMINIO.workers.dev/";
        string? convite = null;
        try
        {
            var cfg = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "concorde.json"))).RootElement;
            if (cfg.TryGetProperty("Url", out var u) && Uri.TryCreate(u.GetString(), UriKind.Absolute, out var uri) && uri.Scheme == "https") url = uri.ToString();
            if (cfg.TryGetProperty("Convite", out var c) && !string.IsNullOrWhiteSpace(c.GetString())) convite = c.GetString()!.Trim();
        }
        catch { }
        if (Teste && Uri.TryCreate(Environment.GetEnvironmentVariable("CONCORDE_TESTE_URL"), UriKind.Absolute, out var t)) url = t.ToString();
        return (url, convite);
    }

    /// <summary>Fecha e abre de novo (o novo espera este fechar; a call e a transmissão encerram direitinho).</summary>
    public void Reiniciar()
    {
        try { Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "--reiniciar") { UseShellExecute = false }); } catch { return; }
        Close();
    }

    private async Task IniciarAsync()
    {
        try
        {
            // Perfil próprio do app: o login (cookie) fica salvo entre aberturas.
            // Aceleração de hardware desligada (Configurações): o WebView2 desenha e decodifica pela CPU.
            var args = new List<string>();
            if (Teste) args.Add("--remote-debugging-port=9333");
            if (!Preferencias.Aceleracao) args.Add("--disable-gpu --disable-gpu-compositing");
            var opcoes = args.Count > 0 ? new CoreWebView2EnvironmentOptions(string.Join(' ', args)) : null;
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(_dados, "WebView2"), opcoes);
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            if (MessageBox.Show(this,
                    "O Caocorde precisa do componente \"Microsoft Edge WebView2\" do Windows, que não foi encontrado.\n\n" +
                    "Quer abrir a página oficial da Microsoft para instalar? Depois é só abrir o Caocorde de novo.\n\n(" + ex.Message + ")",
                    Titulo, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                AbrirNoNavegador("https://developer.microsoft.com/microsoft-edge/webview2/#download-section");
            Close();
            return;
        }

        var core = _web.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = true;
#if !DEBUG
        core.Settings.AreDevToolsEnabled = false;
#endif
        // Título da janela acompanha a página ("# geral — Concorde"…)
        core.DocumentTitleChanged += (_, _) => Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? Titulo : core.DocumentTitle;

        // Microfone, câmera e notificações liberados só para o nosso site.
        core.PermissionRequested += (_, e) =>
        {
            bool nosso = Ponte.DoSite(e.Uri, _origem);
            bool permitido = e.PermissionKind is CoreWebView2PermissionKind.Microphone or CoreWebView2PermissionKind.Notifications
                or CoreWebView2PermissionKind.Camera or CoreWebView2PermissionKind.ClipboardRead;
            e.State = nosso && permitido ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
            e.Handled = true;
        };

        // Links para fora do Concorde abrem no navegador da pessoa; o app fica só no nosso site.
        core.NewWindowRequested += (_, e) => { e.Handled = true; AbrirNoNavegador(e.Uri); };
        core.NavigationStarting += (_, e) =>
        {
            if (Ponte.DoSite(e.Uri, _origem) || e.Uri.StartsWith("data:") || e.Uri == "about:blank") { _ponte?.PaginaRecomecou(); return; }
            e.Cancel = true;
            AbrirNoNavegador(e.Uri);
        };

        // Sem internet / site fora do ar: tela amigável com "tentar de novo" (e tenta sozinho a cada 10 s).
        core.NavigationCompleted += (_, e) =>
        {
            if (!e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled) MostrarSemConexao();
        };
        // A página travou (processo do WebView2 caiu): o que ela comandava para junto.
        core.ProcessFailed += (_, _) => _ponte?.PaginaRecomecou();
        // Ponte com a página (transmitir pela captura nativa) + "tentar de novo" da tela offline.
        _ponte = new Ponte(core, _origem, this) { VersaoPendente = () => _versaoPendente, AtualizarAgora = AtualizarAgora };
        Captura.Musica.AtualizarYtDlpSePreciso();
        core.WebMessageReceived += (_, e) =>
        {
            if (_ponte.Tratar(e)) return;
            try { if (e.TryGetWebMessageAsString() == "tentar") core.Navigate(_url); } catch { }
        };

        // Avisa a página que ela está dentro do app (versão, convite embutido e as funções nativas), só no nosso site.
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            Ponte.Script(_origem, new { versao = Atualizador.Atual.ToString(3), convite = _convite }));

        // Teste nunca se atualiza: instalaria por cima do Concorde de verdade da pessoa.
        // Igual ao Discord: ao abrir, confere se há versão nova e, se houver, atualiza antes de entrar.
        if ((!Teste || TesteAtualizacao) && await AtualizarAoAbrirAsync()) return;
        core.Navigate(_url);
        if (!Teste || TesteAtualizacao) _ = VerificarAtualizacoesAsync();
    }

    // ---------------- atualização automática ----------------

    /// <summary>
    /// Tela "Procurando atualizações…" ao abrir. Com versão nova: baixa (com progresso), instala em silêncio e o
    /// instalador reabre o app — não dá para entrar com versão velha. Sem internet ou site fora: abre normal.
    /// </summary>
    private async Task<bool> AtualizarAoAbrirAsync()
    {
        var core = _web.CoreWebView2;
        core.NavigateToString(TelaAtualizacao);
        var atualizador = new Atualizador(_origem);
        try
        {
            using var limite = new CancellationTokenSource(TimeSpan.FromSeconds(6));
            if (await atualizador.VersaoNovaAsync(limite.Token) is not { } nova) return false;
            await core.ExecuteScriptAsync($"mostrar('Atualizando para a versão {nova.ToString(3)}…')");
            var ultimo = -1;
            var progresso = new Progress<double>(p =>
            {
                int pct = (int)(p * 100);
                if (pct == ultimo) return;
                ultimo = pct;
                _ = core.ExecuteScriptAsync($"progresso({pct})");
            });
            var baixado = await atualizador.BaixarSeHouverAsync(progresso);
            if (baixado is not { } b) return false;
            await core.ExecuteScriptAsync("mostrar('Instalando… o Caocorde abre de novo sozinho.')");
            await Task.Delay(800);
            if (TesteAtualizacao) { Console.WriteLine($"[atualização] teste: baixou e conferiu {b.Arquivo}, não instala"); return false; }
            Atualizador.Instalar(b.Arquivo, reabrir: true);
            Close();
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[atualização] não deu para atualizar ao abrir ({ex.Message}) — abrindo assim mesmo");
            return false;
        }
    }

    private const string TelaAtualizacao = """
        <!doctype html><html lang="pt-BR"><meta charset="utf-8">
        <body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#111114;color:#F1F1F4;font-family:'Segoe UI',sans-serif;user-select:none">
          <div style="text-align:center;width:280px">
            <div style="font-size:30px;font-weight:900;letter-spacing:-1px;color:#F07A1E">Caocorde</div>
            <p id="t" style="color:#B5ADA8;font-size:13px;margin:14px 0 12px">Procurando atualizações…</p>
            <div style="height:6px;border-radius:99px;background:#292525;overflow:hidden">
              <div id="b" style="height:100%;width:30%;background:#F07A1E;border-radius:99px;animation:v 1.2s ease-in-out infinite"></div>
            </div>
          </div>
          <style>@keyframes v{0%{margin-left:-30%}100%{margin-left:100%}}</style>
          <script>
            function mostrar(t){document.getElementById('t').textContent=t}
            function progresso(p){const b=document.getElementById('b');b.style.animation='none';b.style.marginLeft='0';b.style.width=p+'%'}
          </script>
        </body></html>
        """;

    private async Task VerificarAtualizacoesAsync()
    {
        // Já conferiu ao abrir; com o app aberto, olha de novo a cada 30 min (quem deixa aberto o dia todo).
        await Task.Delay(TesteAtualizacao ? TimeSpan.FromSeconds(10) : TimeSpan.FromMinutes(30));
        var atualizador = new Atualizador(_origem);
        while (!IsDisposed)
        {
            try
            {
                var nova = await atualizador.BaixarSeHouverAsync();
                if (nova is { } n && _atualizacaoPendente != n.Arquivo)
                {
                    // Já baixada e conferida: aparece o botão verde "Atualizar" no app (sem caixa de diálogo
                    // interrompendo quem está na call). Se a pessoa não clicar, instala ao fechar.
                    _atualizacaoPendente = n.Arquivo;
                    _versaoPendente = n.Versao.ToString(3);
                    _ponte?.AvisarAtualizacao(_versaoPendente);
                }
            }
            catch { /* sem internet ou site fora: tenta de novo mais tarde */ }
            await Task.Delay(TesteAtualizacao ? TimeSpan.FromMinutes(5) : TimeSpan.FromMinutes(30));
        }
    }

    private string? _versaoPendente;

    /// <summary>Botão "Atualizar" da página: instala a versão já baixada e reabre o app.</summary>
    private void AtualizarAgora()
    {
        if (_atualizacaoPendente is not { } arquivo) return;
        _atualizacaoPendente = null;   // o FormClosed não instala de novo
        if (TesteAtualizacao) { Console.WriteLine($"[atualização] teste: botão clicado, instalaria {arquivo}"); return; }
        Atualizador.Instalar(arquivo, reabrir: true);
        Close();
    }

    private void MostrarSemConexao()
    {
        _web.CoreWebView2.NavigateToString("""
            <!doctype html><html lang="pt-BR"><meta charset="utf-8">
            <body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#111114;color:#F1F1F4;font-family:'Segoe UI',sans-serif">
              <div style="text-align:center;max-width:360px;padding:24px">
                <div style="font-size:48px">📡</div>
                <h1 style="font-size:20px;margin:12px 0 6px">Sem conexão com o Concorde</h1>
                <p style="color:#B5ADA8;font-size:14px;margin:0 0 20px">Confere a internet. O app tenta de novo sozinho a cada 10 segundos.</p>
                <button onclick="chrome.webview.postMessage('tentar')" style="background:#B84A1E;color:#fff;border:0;border-radius:12px;padding:12px 28px;font-weight:800;font-size:15px;cursor:pointer">Tentar de novo</button>
              </div>
              <script>setTimeout(() => chrome.webview.postMessage('tentar'), 10000)</script>
            </body></html>
            """);
    }

    private static void AbrirNoNavegador(string url)
    {
        if (url.StartsWith("https://") || url.StartsWith("http://"))
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    // ---------------- tamanho e posição da janela ----------------

    private string ArquivoJanela => Path.Combine(_dados, "janela.json");

    private void RestaurarJanela()
    {
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1280, 800);
        try
        {
            var j = JsonSerializer.Deserialize<int[]>(File.ReadAllText(ArquivoJanela));
            if (j is { Length: 5 })
            {
                var r = new Rectangle(j[0], j[1], j[2], j[3]);
                // Só restaura se ainda cabe em alguma tela (monitor pode ter sido desligado).
                if (Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r)))
                {
                    StartPosition = FormStartPosition.Manual;
                    Bounds = r;
                    if (j[4] == 1) WindowState = FormWindowState.Maximized;
                }
            }
        }
        catch { }
    }

    private void SalvarJanela()
    {
        try
        {
            var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            Directory.CreateDirectory(_dados);
            File.WriteAllText(ArquivoJanela, JsonSerializer.Serialize(new[] { r.X, r.Y, r.Width, r.Height, WindowState == FormWindowState.Maximized ? 1 : 0 }));
        }
        catch { }
    }
}
