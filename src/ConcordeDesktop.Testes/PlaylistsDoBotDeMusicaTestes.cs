// Testes das playlists do bot de música (Captura/Musica.cs).
//
// Duas partes:
// 1. Sem internet: a leitura da resposta do yt-dlp (o que entra na fila e o que é pulado).
// 2. Com internet (marcados com Trait "Rede"): abre playlists públicas de verdade no YouTube e no Spotify e
//    confere que um link de UMA música continua sendo uma música. Rodar só estes:
//      dotnet test src/ConcordeDesktop.Testes --filter "Rede=sim"
//    Pular estes (sem internet):
//      dotnet test src/ConcordeDesktop.Testes --filter "Rede!=sim"

using System.Text.Json;
using Concorde.Captura;
using Xunit;

namespace ConcordeDesktop.Testes;

public class PlaylistsDoBotDeMusicaTestes
{
    /// <summary>Resposta parecida com a do "yt-dlp -J --flat-playlist" para uma playlist do YouTube.</summary>
    private const string RespostaDePlaylistDoYouTube = """
    {
      "_type": "playlist", "title": "Minha playlist", "playlist_count": 250,
      "entries": [
        { "_type": "url", "ie_key": "Youtube", "id": "aaaaaaaaaaa", "url": "https://www.youtube.com/watch?v=aaaaaaaaaaa", "title": "Música 1", "duration": 200 },
        { "_type": "url", "ie_key": "Youtube", "id": "bbbbbbbbbbb", "url": "https://www.youtube.com/watch?v=bbbbbbbbbbb", "title": "[Private video]", "duration": null },
        { "_type": "url", "ie_key": "Youtube", "id": "ccccccccccc", "url": "https://www.youtube.com/watch?v=ccccccccccc", "title": "Live 24h", "live_status": "is_live" },
        { "_type": "url", "ie_key": "Youtube", "id": "ddddddddddd", "url": "https://www.youtube.com/watch?v=ddddddddddd", "title": "Mix de 5 horas", "duration": 18000 },
        { "_type": "url", "ie_key": "Youtube", "id": "eeeeeeeeeee", "title": "Sem link (só o código)", "duration": 180 },
        { "_type": "url", "url": "file:///C:/Windows/win.ini", "title": "Arquivo do PC" }
      ]
    }
    """;

    private static Playlist LerPlaylist(string respostaEmJson)
    {
        using var documento = JsonDocument.Parse(respostaEmJson);
        return Musica.PlaylistDoJson(documento.RootElement, documento.RootElement.GetProperty("entries"));
    }

    [Fact]
    public void Playlist_guarda_nome_e_total_do_site()
    {
        var playlist = LerPlaylist(RespostaDePlaylistDoYouTube);
        Assert.Equal("Minha playlist", playlist.Titulo);
        Assert.Equal(250, playlist.TotalNoSite);
    }

    [Fact]
    public void Playlist_pula_privado_ao_vivo_longo_demais_e_link_que_nao_e_da_internet()
    {
        var playlist = LerPlaylist(RespostaDePlaylistDoYouTube);
        var titulos = playlist.Faixas.Select(faixa => faixa.Titulo).ToList();
        Assert.Equal(new[] { "Música 1", "Sem link (só o código)" }, titulos);
    }

    [Fact]
    public void Playlist_monta_o_link_do_YouTube_quando_so_vem_o_codigo()
    {
        var playlist = LerPlaylist(RespostaDePlaylistDoYouTube);
        Assert.Equal("https://www.youtube.com/watch?v=eeeeeeeeeee", playlist.Faixas[1].Consulta);
        Assert.Equal(180, playlist.Faixas[1].DuracaoEmSegundos);
    }

    [Fact]
    public void Playlist_enorme_para_em_100_musicas()
    {
        var entradas = string.Join(",", Enumerable.Range(1, 150).Select(numero =>
            $$"""{ "url": "https://soundcloud.com/artista/musica-{{numero}}", "title": "Música {{numero}}" }"""));
        var playlist = LerPlaylist($$"""{ "_type": "playlist", "title": "Grande", "entries": [{{entradas}}] }""");
        Assert.Equal(Musica.MaximoDeMusicasDaPlaylist, playlist.Faixas.Count);
        Assert.Equal(150, playlist.TotalNoSite);
    }

    // ---------------- resposta "null" do yt-dlp (bug achado na 0.5.7) ----------------

    [Fact]
    public void Resposta_null_vira_a_mensagem_de_verdade_do_yt_dlp()
    {
        var erro = Assert.Throws<InvalidOperationException>(() =>
            Musica.LerRespostaDoYtDlp("null\n", "ERROR: [youtube] abc: Sign in to confirm you're not a bot\n"));
        Assert.Equal("[youtube] abc: Sign in to confirm you're not a bot", erro.Message);
    }

    [Fact]
    public void Resposta_vazia_ou_quebrada_tambem_vira_mensagem()
    {
        Assert.Equal("não achei essa música", Assert.Throws<InvalidOperationException>(() => Musica.LerRespostaDoYtDlp("", "")).Message);
        Assert.Equal("falhou", Assert.Throws<InvalidOperationException>(() => Musica.LerRespostaDoYtDlp("{quebrado", "ERROR: falhou")).Message);
    }

    [Fact]
    public void Resposta_boa_continua_sendo_lida()
    {
        using var resposta = Musica.LerRespostaDoYtDlp("""{ "title": "ok" }""", "");
        Assert.Equal("ok", resposta.RootElement.GetProperty("title").GetString());
    }

    [Fact]
    public void Playlist_com_musica_que_deu_erro_pula_ela()
    {
        var playlist = LerPlaylist("""{ "_type": "playlist", "title": "P", "entries": [ null, { "url": "https://www.youtube.com/watch?v=aaaaaaaaaaa", "title": "Boa" } ] }""");
        Assert.Single(playlist.Faixas);
        Assert.Equal("Boa", playlist.Faixas[0].Titulo);
    }

    // ---------------- com internet ----------------

    [Fact, Trait("Rede", "sim")]
    public async Task Video_indisponivel_mostra_o_motivo_e_nao_erro_sem_sentido()
    {
        var erro = await Assert.ThrowsAsync<InvalidOperationException>(() => Musica.AcharFaixaOuPlaylistAsync("https://music.youtube.com/watch?v=Y-pw-gTAuwl"));
        Assert.Contains("unavailable", erro.Message);
        Assert.DoesNotContain("Object", erro.Message);
    }

    [Fact, Trait("Rede", "sim")]
    public async Task YouTube_Music_link_de_uma_musica_toca()
    {
        var (faixa, playlist) = await Musica.AcharFaixaOuPlaylistAsync("https://music.youtube.com/watch?v=Y-pw-gTAuwI");
        Assert.Null(playlist);
        Assert.Equal("chase the sun tekkno", faixa!.Titulo);
    }

    [Fact, Trait("Rede", "sim")]
    public async Task YouTube_link_de_playlist_vira_lista_de_musicas()
    {
        var (faixa, playlist) = await Musica.AcharFaixaOuPlaylistAsync("https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI");
        Assert.Null(faixa);
        Assert.NotNull(playlist);
        Assert.True(playlist!.Faixas.Count > 10, $"vieram só {playlist.Faixas.Count} músicas");
        Assert.All(playlist.Faixas, musica => Assert.StartsWith("https://", musica.Consulta));
    }

    [Fact, Trait("Rede", "sim")]
    public async Task Spotify_link_de_playlist_vira_buscas_por_nome_e_artista()
    {
        var (faixa, playlist) = await Musica.AcharFaixaOuPlaylistAsync("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
        Assert.Null(faixa);
        Assert.NotNull(playlist);
        Assert.True(playlist!.Faixas.Count > 10, $"vieram só {playlist.Faixas.Count} músicas");
        Assert.All(playlist.Faixas, musica => Assert.EndsWith(" audio", musica.Consulta));
    }

    [Fact, Trait("Rede", "sim")]
    public async Task YouTube_link_de_uma_musica_continua_sendo_uma_musica()
    {
        var (faixa, playlist) = await Musica.AcharFaixaOuPlaylistAsync("https://www.youtube.com/watch?v=fOT0BUpITw8");
        Assert.Null(playlist);
        Assert.NotNull(faixa);
        Assert.Contains("fOT0BUpITw8", faixa!.Pagina);
    }

    [Fact, Trait("Rede", "sim")]
    public async Task YouTube_mix_toca_so_a_musica_do_link()
    {
        var (faixa, playlist) = await Musica.AcharFaixaOuPlaylistAsync("https://www.youtube.com/watch?v=fOT0BUpITw8&list=RDfOT0BUpITw8");
        Assert.Null(playlist);
        Assert.NotNull(faixa);
    }
}
