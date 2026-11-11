using System.Diagnostics;
using System.Net.Http.Json;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace Concorde;

/// <summary>
/// Atualização automática do app. O site publica /concorde-app/versao.json com a versão nova e o instalador
/// dividido em partes (o Cloudflare só serve arquivos de até 25 MB). O app baixa as partes em segundo plano,
/// confere tamanho e SHA-256, e roda o instalador em modo silencioso, que reabre o Concorde no fim.
/// (A interface em si é o site: ela já se atualiza sozinha; isto é só para o programa.)
/// </summary>
public sealed class Atualizador(string origem)
{
    private sealed record Manifesto(string versao, string[] partes, string sha256, long tamanho);

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(5) };
    private readonly string _pasta = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), MainWindow.Teste ? "Concorde-Teste" : "Concorde", "atualizacao");

    public static Version Atual => Assembly.GetEntryAssembly()!.GetName().Version ?? new Version(0, 0);

    /// <summary>Versão nova publicada no site, ou null se o app já está em dia.</summary>
    public async Task<Version?> VersaoNovaAsync(CancellationToken ct = default)
    {
        _manifesto = await Http.GetFromJsonAsync<Manifesto>($"{origem}/concorde-app/versao.json?t={DateTime.UtcNow.Ticks}", ct);
        return _manifesto != null && Version.TryParse(_manifesto.versao, out var nova) && nova > Atual ? nova : null;
    }

    private Manifesto? _manifesto;

    /// <summary>Instalador da versão nova já baixado e conferido, ou null se não há nada novo. progresso: 0 a 1.</summary>
    public async Task<(Version Versao, string Arquivo)?> BaixarSeHouverAsync(IProgress<double>? progresso = null)
    {
        // Download fora da thread da janela (senão cada pedaço espera o WebView2 e fica 50× mais lento).
        if (await VersaoNovaAsync().ConfigureAwait(false) is not { } nova) return null;
        var m = _manifesto!;

        Directory.CreateDirectory(_pasta);
        var arquivo = Path.Combine(_pasta, $"ConcordeInstalador-{nova}.exe");
        if (!File.Exists(arquivo) || !Confere(arquivo, m))
        {
            var temp = arquivo + ".baixando";
            await using (var saida = File.Create(temp))
            {
                var buf = new byte[256 * 1024];
                long feito = 0;
                foreach (var parte in m.partes)
                {
                    await using var entrada = await Http.GetStreamAsync(origem + parte).ConfigureAwait(false);
                    int n;
                    while ((n = await entrada.ReadAsync(buf).ConfigureAwait(false)) > 0)
                    {
                        await saida.WriteAsync(buf.AsMemory(0, n)).ConfigureAwait(false);
                        feito += n;
                        progresso?.Report(Math.Min(1, (double)feito / m.tamanho));
                    }
                }
            }
            if (!Confere(temp, m)) { File.Delete(temp); throw new InvalidDataException("atualização baixada não confere (SHA-256)"); }
            File.Move(temp, arquivo, overwrite: true);
        }
        // Limpa instaladores de versões antigas.
        foreach (var velho in Directory.EnumerateFiles(_pasta, "ConcordeInstalador-*.exe").Where(f => f != arquivo)) { try { File.Delete(velho); } catch { } }
        return (nova, arquivo);
    }

    private static bool Confere(string arquivo, Manifesto m)
    {
        if (new FileInfo(arquivo).Length != m.tamanho) return false;
        using var f = File.OpenRead(arquivo);
        return Convert.ToHexString(SHA256.HashData(f)).Equals(m.sha256, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Roda o instalador silencioso. Com reabrir, ele abre o Concorde de novo ao terminar.</summary>
    public static void Instalar(string arquivo, bool reabrir)
    {
        // FORCECLOSEAPPLICATIONS: nunca para perguntando se pode fechar o Concorde (ele já está fechando).
        var args = "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /FORCECLOSEAPPLICATIONS" + (reabrir ? " /RELANCAR" : "");
        Process.Start(new ProcessStartInfo(arquivo, args) { UseShellExecute = true });
    }
}
