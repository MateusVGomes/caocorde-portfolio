using System.Text.Json;
using System.Text.Json.Nodes;

namespace Concorde;

/// <summary>
/// Preferências do app que valem antes da página abrir (o WebView2 só lê as opções dele ao começar).
/// Ficam em %LOCALAPPDATA%\Concorde\preferencias.json.
/// </summary>
internal static class Preferencias
{
    private static string Arquivo => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        MainWindow.Teste ? "Concorde-Teste" : "Concorde", "preferencias.json");

    /// <summary>Aceleração de hardware em uso nesta abertura do app.</summary>
    public static bool Aceleracao { get; private set; } = true;

    /// <summary>O que está salvo (vale na próxima abertura, se mudou agora).</summary>
    public static bool AceleracaoSalva { get; private set; } = true;

    public static void Carregar()
    {
        try { AceleracaoSalva = JsonNode.Parse(File.ReadAllText(Arquivo))?["aceleracao"]?.GetValue<bool>() ?? true; }
        catch { AceleracaoSalva = true; }
        Aceleracao = AceleracaoSalva;
    }

    public static void SalvarAceleracao(bool ligada)
    {
        AceleracaoSalva = ligada;
        Directory.CreateDirectory(Path.GetDirectoryName(Arquivo)!);
        File.WriteAllText(Arquivo, JsonSerializer.Serialize(new { aceleracao = ligada }));
    }
}
