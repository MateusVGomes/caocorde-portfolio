// Login do YouTube para o bot de música, sem a pessoa mexer em arquivo: o Concorde abre uma janela própria do
// YouTube (perfil separado e descartável), a pessoa entra na conta e o Concorde copia só os cookies do YouTube
// dessa janela para o arquivo que o yt-dlp usa (Musica.ArquivoCookies). A página só chama isto depois que a pessoa
// autorizou (ver src/App/src/Musica.jsx → LoginDoYouTube).
// Nunca escreve o valor dos cookies no log: eles são o login da pessoa.
using System.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Concorde;

internal static class LoginDoYouTube
{
    /// <summary>
    /// Página de login do Google que volta para o YouTube já logado. Depois do login, o Concorde abre
    /// youtube.com/robots.txt (página sem scripts) antes de copiar os cookies: é o que o yt-dlp recomenda para o
    /// YouTube não "trocar" os cookies logo em seguida (https://github.com/yt-dlp/yt-dlp/wiki/Extractors).
    /// </summary>
    private const string EnderecoDeLogin =
        "https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=" +
        "https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26next%3Dhttps%253A%252F%252Fwww.youtube.com%252F";
    private const string PaginaParaCopiar = "https://www.youtube.com/robots.txt";

    /// <summary>Cookies que só existem com alguém logado no YouTube (qualquer um deles basta).</summary>
    private static readonly string[] CookiesDeQuemEstaLogado = ["LOGIN_INFO", "__Secure-3PSID", "SAPISID"];

    /// <summary>
    /// Abre a janela e espera a pessoa entrar (ou fechar). Devolve quantos cookies foram copiados
    /// (0 = a pessoa fechou a janela sem entrar). Lança exceção com mensagem amigável se o Google recusar a janela.
    /// Tem de ser chamado na thread da janela principal.
    /// </summary>
    public static async Task<int> AbrirAsync(Form janelaPrincipal, string pastaDeDadosDoApp)
    {
        // Perfil descartável: nada fica misturado com o Concorde nem com o navegador da pessoa.
        var pastaDoPerfilDescartavel = Path.Combine(pastaDeDadosDoApp, "LoginYouTube-temporario");
        ApagarPastaSemErro(pastaDoPerfilDescartavel);

        var resultado = new TaskCompletionSource<int>();
        using var janela = new Form
        {
            Text = "Entrar no YouTube — Caocorde (bot de música)",
            Width = 520, Height = 760,
            StartPosition = FormStartPosition.CenterParent,
            Icon = janelaPrincipal.Icon,
        };
        var explicacao = new Label
        {
            Dock = DockStyle.Top, Height = 54, Padding = new Padding(10, 8, 10, 0),
            Text = "Entre na conta que o bot de música vai usar (de preferência uma conta secundária). " +
                   "Quando terminar, esta janela fecha sozinha. Para cancelar, é só fechar.",
        };
        var navegador = new WebView2 { Dock = DockStyle.Fill };
        janela.Controls.Add(navegador);
        janela.Controls.Add(explicacao);
        janela.FormClosed += (_, _) => resultado.TrySetResult(0);
        janela.Show(janelaPrincipal);

        var ambiente = await CoreWebView2Environment.CreateAsync(null, pastaDoPerfilDescartavel);
        await navegador.EnsureCoreWebView2Async(ambiente);
        var copiando = false;
        navegador.CoreWebView2.NavigationCompleted += async (_, _) =>
        {
            if (copiando || navegador.CoreWebView2 == null) return;
            var enderecoAtual = navegador.CoreWebView2.Source;
            if (!enderecoAtual.StartsWith("https://www.youtube.com/", StringComparison.OrdinalIgnoreCase)) return;
            var cookiesDoYouTube = await navegador.CoreWebView2.CookieManager.GetCookiesAsync("https://www.youtube.com");
            if (!cookiesDoYouTube.Any(cookie => CookiesDeQuemEstaLogado.Contains(cookie.Name))) return;   // ainda não entrou

            if (!enderecoAtual.StartsWith(PaginaParaCopiar, StringComparison.OrdinalIgnoreCase))
            {
                navegador.CoreWebView2.Navigate(PaginaParaCopiar);   // copia na próxima volta, já na página sem scripts
                return;
            }
            copiando = true;
            try
            {
                var quantidade = SalvarNoFormatoDoYtDlp(cookiesDoYouTube);
                Console.WriteLine($"[música] login do YouTube pela janela do app: {quantidade} cookies copiados");
                resultado.TrySetResult(quantidade);
            }
            catch (Exception erro) { resultado.TrySetException(erro); }
            janela.Close();
        };
        navegador.CoreWebView2.Navigate(EnderecoDeLogin);

        try { return await resultado.Task; }
        finally
        {
            navegador.Dispose();
            // O navegador descartável demora um instante para soltar os arquivos: apaga depois.
            _ = Task.Delay(3000).ContinueWith(_ => ApagarPastaSemErro(pastaDoPerfilDescartavel));
        }
    }

    /// <summary>
    /// Grava os cookies no formato "Netscape cookies.txt", o mesmo que a extensão do navegador gera e o yt-dlp lê:
    /// uma linha por cookie, campos separados por TAB: domínio, vale-para-subdomínios, caminho, só-https,
    /// validade (segundos desde 1970; 0 = até fechar), nome, valor.
    /// </summary>
    private static int SalvarNoFormatoDoYtDlp(IReadOnlyList<CoreWebView2Cookie> cookies)
    {
        var arquivo = new StringBuilder("# Netscape HTTP Cookie File\n# Gerado pelo Concorde (login do YouTube pela janela do app)\n\n");
        foreach (var cookie in cookies)
        {
            var dominio = cookie.Domain;
            var valeParaSubdominios = cookie.Domain.StartsWith('.') ? "TRUE" : "FALSE";
            var validadeEmSegundos = cookie.IsSession ? 0 : (long)cookie.Expires.ToUniversalTime().Subtract(DateTime.UnixEpoch).TotalSeconds;
            arquivo.Append(dominio).Append('\t').Append(valeParaSubdominios).Append('\t').Append(cookie.Path).Append('\t')
                .Append(cookie.IsSecure ? "TRUE" : "FALSE").Append('\t').Append(validadeEmSegundos).Append('\t')
                .Append(cookie.Name).Append('\t').Append(cookie.Value).Append('\n');
        }
        Directory.CreateDirectory(Path.GetDirectoryName(Captura.Musica.ArquivoCookies)!);
        File.WriteAllText(Captura.Musica.ArquivoCookies, arquivo.ToString());
        return cookies.Count;
    }

    private static void ApagarPastaSemErro(string pasta)
    {
        try { if (Directory.Exists(pasta)) Directory.Delete(pasta, recursive: true); }
        catch (IOException) { /* ainda em uso pelo navegador descartável: a próxima abertura apaga */ }
        catch (UnauthorizedAccessException) { /* idem */ }
    }
}
