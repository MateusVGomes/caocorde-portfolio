// Testes da trava de links do bot de música (Musica.LinkPublicoAsync e Musica.EhEnderecoInterno).
// O bot baixa, NO PC DE QUEM É O DJ, o link que qualquer pessoa da call manda. A trava impede que esse link
// aponte para dentro da casa do DJ (roteador, impressora, outro PC). Cada caso é testado dos dois lados:
// o que tem de ser NEGADO e o que tem de ser ACEITO. Nenhum teste usa a internet.
using System.Net;
using Concorde.Captura;
using Xunit;

namespace Concorde.Testes;

public class TravaDeLinksDoBotDeMusicaTestes
{
    [Theory]
    [InlineData("127.0.0.1")]        // o próprio PC
    [InlineData("10.0.0.5")]         // rede de casa/empresa
    [InlineData("172.16.3.4")]
    [InlineData("172.31.255.1")]
    [InlineData("192.168.0.1")]      // roteador de casa
    [InlineData("169.254.169.254")]  // "link-local" (e endereço de metadados de nuvem)
    [InlineData("100.64.0.1")]       // rede da operadora (CGNAT)
    [InlineData("0.0.0.0")]
    [InlineData("224.0.0.1")]        // multicast
    [InlineData("::1")]              // o próprio PC em IPv6
    [InlineData("fe80::1")]          // link-local IPv6
    [InlineData("fd00::1")]          // rede local IPv6
    [InlineData("::ffff:192.168.0.1")] // IPv4 da rede de casa escondido dentro de um IPv6
    public void EnderecoInternoEhReconhecido(string enderecoEscrito)
    {
        Assert.True(Musica.EhEnderecoInterno(IPAddress.Parse(enderecoEscrito)));
    }

    [Theory]
    [InlineData("8.8.8.8")]
    [InlineData("142.250.79.14")]
    [InlineData("172.32.0.1")]       // logo depois da faixa 172.16–31: já é internet
    [InlineData("100.128.0.1")]      // logo depois da faixa da operadora
    [InlineData("2001:4860:4860::8888")]
    public void EnderecoDaInternetNaoEhInterno(string enderecoEscrito)
    {
        Assert.False(Musica.EhEnderecoInterno(IPAddress.Parse(enderecoEscrito)));
    }

    [Theory]
    [InlineData("http://192.168.0.1/admin")]
    [InlineData("http://127.0.0.1:8080/")]
    [InlineData("http://[::1]/")]
    [InlineData("http://localhost/")]
    [InlineData("http://impressora.local/")]
    [InlineData("file:///C:/Windows/win.ini")]   // arquivo do PC
    [InlineData("ftp://8.8.8.8/")]               // só http e https
    [InlineData("isso não é um link")]
    public async Task LinkPerigosoEhRecusado(string link)
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => Musica.LinkPublicoAsync(link));
    }

    [Fact]
    public async Task LinkDaInternetEscritoComNumeroEhAceito()
    {
        // Número público escrito direto no link: não precisa consultar DNS (o teste roda sem internet).
        Assert.Equal("https://8.8.8.8/musica", await Musica.LinkPublicoAsync("https://8.8.8.8/musica"));
    }
}
