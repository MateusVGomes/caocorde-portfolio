// FILA DE MÚSICA DA CALL (o "bot" Jorginho DJ) — parte do servidor do Concorde (classe Comunidade, comunidade.js).
//
// Quem toca é o app do Windows de alguém que está na call (o DJ): ele acha a música, publica o áudio no Cloudflare
// Realtime e todo mundo da call puxa. Aqui fica só a FILA (por canal de voz), quem é o DJ e a pergunta "quer
// continuar a música?" quando o DJ sai da call (respondida em até 20 s; o despertador "alarm" conta o tempo).
//
// Como este arquivo se liga à classe: os métodos abaixo são escritos como numa classe normal (usam "this") e o
// comunidade.js copia todos para a classe Comunidade (ver "juntarMetodos" lá). Separado só para organizar:
// o comportamento é o mesmo de quando estava dentro do comunidade.js.

import { agora, limpar } from './utilidades.js';
import * as convidados from './convidados.js';

/** Tempo para responder "quer continuar a música?" quando o DJ sai da call. */
const PERGUNTA_DJ_MS = 20000;

export class MetodosDaMusica {

  estadoMusica(canal) {
    const fila = this.sql.exec('SELECT id, consulta, titulo, duracao, por FROM musica_fila WHERE canal_id = ? ORDER BY id', canal).toArray();
    const r = this.sql.exec('SELECT dados FROM musica_tocando WHERE canal_id = ?', canal).toArray()[0];
    return { canal, fila, tocando: r ? JSON.parse(r.dados) : null, passar: this.passarDe(canal) };
  }

  passarDe(canal) {
    const r = this.sql.exec('SELECT dados FROM musica_passar WHERE canal_id = ?', canal).toArray()[0];
    return r ? JSON.parse(r.dados) : null;
  }

  musicaDe(uid) {
    const meus = [...this.servidoresDe(uid)];
    if (!meus.length) return {};
    const canais = this.sql.exec(`SELECT DISTINCT f.canal_id AS c FROM musica_fila f JOIN canais k ON k.id = f.canal_id WHERE k.servidor_id IN (${meus.map(() => '?').join(',')})`, ...meus).toArray();
    return Object.fromEntries(canais.map(({ c }) => [c, this.estadoMusica(c)]));
  }

  avisarMusica(canal) {
    const c = this.canal(canal);
    if (c) this.paraServidor(c.servidor_id, { t: 'musica', ...this.estadoMusica(canal) });
  }

  /**
   * Alguém saiu da call. Se era o DJ, a música para e o app pergunta para o próximo da call (ordem de entrada,
   * só quem tem o app desktop) se quer continuar; se a pessoa perguntada (ou a que aceitou) saiu, pula para a próxima.
   */
  liberarDj(uid, canal) {
    const r = this.sql.exec('SELECT dados FROM musica_tocando WHERE canal_id = ?', canal).toArray()[0];
    const p = this.passarDe(canal);
    if (r && JSON.parse(r.dados).dj === uid) {
      this.sql.exec('DELETE FROM musica_tocando WHERE canal_id = ?', canal);
      this.passarDj(canal, { saiu: uid, recusados: [uid] });
    } else if (p && (p.pergunta === uid || p.aceito === uid)) {
      this.passarDj(canal, { saiu: p.saiu, recusados: [...p.recusados, uid] });
    }
  }

  /** Pergunta para o próximo app da call que ainda não recusou; sem ninguém, a música para e a fila é limpa. */
  passarDj(canal, { saiu, recusados }) {
    const temFila = this.sql.exec('SELECT COUNT(*) AS n FROM musica_fila WHERE canal_id = ?', canal).one().n > 0;
    const proximo = temFila && this.naCall(canal).filter(x => x.voz.app && !recusados.includes(x.uid)).sort((x, y) => (x.voz.entrou || 0) - (y.voz.entrou || 0))[0];
    if (proximo) {
      const ate = agora() + PERGUNTA_DJ_MS;
      this.sql.exec('INSERT OR REPLACE INTO musica_passar (canal_id, dados) VALUES (?,?)', canal, JSON.stringify({ saiu, recusados, pergunta: proximo.uid, aceito: null, ate }));
      this.ctx.storage.getAlarm().then(t => { if (!t || t > ate) this.ctx.storage.setAlarm(ate + 200); });
    } else {
      this.sql.exec('DELETE FROM musica_passar WHERE canal_id = ?', canal);
      if (temFila) {
        this.sql.exec('DELETE FROM musica_fila WHERE canal_id = ?', canal);
        const c = this.canal(canal);
        if (c) this.paraServidor(c.servidor_id, { t: 'ok', texto: '🎵 Ninguém com o app quis continuar a música — o Jorginho DJ saiu da call.' });
      }
    }
    this.avisarMusica(canal);
  }

  /** Quem não respondeu a pergunta a tempo conta como "não". */
  async alarm() {
    for (const { canal_id, dados } of this.sql.exec('SELECT canal_id, dados FROM musica_passar').toArray()) {
      const p = JSON.parse(dados);
      if (!p.aceito && p.ate <= agora()) this.passarDj(canal_id, { saiu: p.saiu, recusados: [...p.recusados, p.pergunta] });
    }
    let proximo = null;   // a próxima pergunta que vai vencer
    for (const { dados } of this.sql.exec('SELECT dados FROM musica_passar').toArray()) {
      const p = JSON.parse(dados);
      if (!p.aceito) proximo = Math.min(proximo ?? Infinity, p.ate);
    }
    // O mesmo despertador apaga convidados que saíram (ou venceram) e diz quando é a próxima limpeza.
    const proximaLimpezaDeConvidado = convidados.limparConvidadosQueSairam(this);
    if (proximaLimpezaDeConvidado != null) proximo = Math.min(proximo ?? Infinity, proximaLimpezaDeConvidado);
    if (proximo != null) await this.ctx.storage.setAlarm(proximo + 200);
  }

  mexerMusica(ws, a, eu, m) {
    const canal = Number(m.canal);
    const c = this.canalVisivel(eu.id, canal);
    if (!c || c.tipo !== 'voz') return this.erro(ws, 'Canal de voz inválido.');
    // Só quem está NESTA call mexe na música (pôr, pular, pausar, parar, tirar da fila). A página já só mostra os
    // controles para quem está na call; sem esta conferência, alguém do servidor fora da call podia parar a música
    // dos outros mandando a mensagem direto pelo WebSocket.
    if (a.voz?.canal !== canal) return this.erro(ws, '🎵 Entre na call para mexer na música.');
    const tocando = this.estadoMusica(canal).tocando;

    switch (m.t) {
      case 'musica-add': {
        const consulta = limpar(m.consulta, 300);
        if (!consulta) return;
        if (this.sql.exec('SELECT COUNT(*) AS n FROM musica_fila WHERE canal_id = ?', canal).one().n >= 100) return this.erro(ws, 'A fila já tem 100 músicas.');
        this.sql.exec('INSERT INTO musica_fila (canal_id, consulta, por, criado) VALUES (?,?,?,?)', canal, consulta, eu.id, agora());
        break;
      }
      case 'musica-remover':
        if (tocando?.item === Number(m.id)) return this.erro(ws, 'Use "pular" para a que está tocando.');
        this.sql.exec('DELETE FROM musica_fila WHERE id = ? AND canal_id = ?', Number(m.id), canal);
        break;
      case 'musica-passar': {
        // Resposta da pergunta "quer continuar a música?"
        const p = this.passarDe(canal);
        if (!p || p.pergunta !== eu.id || p.aceito) return;
        if (m.sim && a.voz?.canal === canal && a.voz.app) {
          p.aceito = eu.id;
          this.sql.exec('UPDATE musica_passar SET dados = ? WHERE canal_id = ?', JSON.stringify(p), canal);
          break;
        }
        return this.passarDj(canal, { saiu: p.saiu, recusados: [...p.recusados, eu.id] });
      }
      case 'musica-parar':
        this.sql.exec('DELETE FROM musica_fila WHERE canal_id = ?', canal);
        this.sql.exec('DELETE FROM musica_tocando WHERE canal_id = ?', canal);
        break;
      case 'musica-pular':
        if (tocando) this.sql.exec('DELETE FROM musica_fila WHERE id = ?', tocando.item);
        else this.sql.exec('DELETE FROM musica_fila WHERE id = (SELECT MIN(id) FROM musica_fila WHERE canal_id = ?)', canal);
        this.sql.exec('DELETE FROM musica_tocando WHERE canal_id = ?', canal);
        break;
      case 'musica-pausar':
        if (!tocando) return;
        tocando.pausado = !!m.pausado;
        this.sql.exec('UPDATE musica_tocando SET dados = ? WHERE canal_id = ?', JSON.stringify(tocando), canal);
        break;
      case 'musica-dj': {
        // Um app na call assume a faixa do topo. Só vale se ninguém está tocando (ou o DJ anterior saiu).
        const djNaCall = tocando && this.naCall(canal).some(x => x.uid === tocando.dj);
        if (djNaCall && tocando.dj !== eu.id) return;
        const passar = this.passarDe(canal);
        if (passar && passar.aceito !== eu.id) return;   // esperando a resposta de quem foi perguntado
        const primeiro = this.sql.exec('SELECT * FROM musica_fila WHERE canal_id = ? ORDER BY id LIMIT 1', canal).toArray()[0];
        if (!primeiro || primeiro.id !== Number(m.item) || a.voz?.canal !== canal) return;
        const dados = {
          item: primeiro.id, dj: eu.id, sessao: limpar(m.sessao, 100), trilha: /^[a-z0-9-]{1,40}$/.test(m.trilha) ? m.trilha : null,
          titulo: limpar(m.titulo, 200) || primeiro.consulta, duracao: Number(m.duracao) || null, thumb: /^https:\/\//.test(m.thumb || '') ? limpar(m.thumb, 400) : null,
          url: /^https:\/\//.test(m.url || '') ? limpar(m.url, 400) : null, desde: agora(), pausado: false,
        };
        this.sql.exec('INSERT OR REPLACE INTO musica_tocando (canal_id, dados) VALUES (?,?)', canal, JSON.stringify(dados));
        this.sql.exec('UPDATE musica_fila SET titulo = ?, duracao = ? WHERE id = ?', dados.titulo, dados.duracao, primeiro.id);
        this.sql.exec('DELETE FROM musica_passar WHERE canal_id = ?', canal);
        break;
      }
      case 'musica-expandir': {
        // O item do topo da fila era um link de PLAYLIST (YouTube, SoundCloud, Spotify, Bandcamp...). Só o app do
        // DJ consegue abrir a playlist (o yt-dlp roda no PC dele); ele manda a lista de músicas e aqui o item vira
        // essas músicas, NO MESMO LUGAR da fila (as que já estavam esperando continuam depois delas).
        // Vale nas mesmas condições de "assumir a música" (musica-dj): ninguém tocando e a vez é de quem mandou.
        const djNaCall = tocando && this.naCall(canal).some(participante => participante.uid === tocando.dj);
        if (djNaCall && tocando.dj !== eu.id) return;
        const perguntaDePassar = this.passarDe(canal);
        if (perguntaDePassar && perguntaDePassar.aceito !== eu.id) return;
        const itemDaPlaylist = this.sql.exec('SELECT * FROM musica_fila WHERE canal_id = ? ORDER BY id LIMIT 1', canal).toArray()[0];
        if (!itemDaPlaylist || itemDaPlaylist.id !== Number(m.item)) return;

        // A fila tem no máximo 100 músicas: a playlist ocupa o lugar do próprio item mais as vagas que sobram.
        const quantidadeNaFila = this.sql.exec('SELECT COUNT(*) AS n FROM musica_fila WHERE canal_id = ?', canal).one().n;
        const vagasParaAPlaylist = Math.max(0, 100 - (quantidadeNaFila - 1));
        const faixasRecebidas = Array.isArray(m.faixas) ? m.faixas : [];
        const faixasDaPlaylist = faixasRecebidas
          .map(faixa => ({ consulta: limpar(faixa?.consulta, 300), titulo: limpar(faixa?.titulo, 200) || null, duracao: Number(faixa?.duracao) || null }))
          .filter(faixa => faixa.consulta)
          .slice(0, vagasParaAPlaylist);
        const nomeDaPlaylist = limpar(m.titulo, 120) || 'playlist';

        // As que vinham depois do item são tiradas e postas de volta depois da playlist (a ordem da fila é o id).
        const filaDepoisDoItem = this.sql.exec('SELECT consulta, titulo, duracao, por, criado FROM musica_fila WHERE canal_id = ? AND id > ? ORDER BY id', canal, itemDaPlaylist.id).toArray();
        this.ctx.storage.transactionSync(() => {
          this.sql.exec('DELETE FROM musica_fila WHERE canal_id = ? AND id >= ?', canal, itemDaPlaylist.id);
          for (const faixa of faixasDaPlaylist) {
            this.sql.exec('INSERT INTO musica_fila (canal_id, consulta, titulo, duracao, por, criado) VALUES (?,?,?,?,?,?)',
              canal, faixa.consulta, faixa.titulo, faixa.duracao, itemDaPlaylist.por, itemDaPlaylist.criado);
          }
          for (const musicaQueEsperava of filaDepoisDoItem) {
            this.sql.exec('INSERT INTO musica_fila (canal_id, consulta, titulo, duracao, por, criado) VALUES (?,?,?,?,?,?)',
              canal, musicaQueEsperava.consulta, musicaQueEsperava.titulo, musicaQueEsperava.duracao, musicaQueEsperava.por, musicaQueEsperava.criado);
          }
        });

        const totalNoSite = Number(m.total) || faixasRecebidas.length;
        const ficaramDeFora = Math.max(0, totalNoSite - faixasDaPlaylist.length);
        const textoDoAviso = faixasDaPlaylist.length === 0
          ? `🎵 A playlist "${nomeDaPlaylist}" está vazia (ou não deu para ler as músicas dela).`
          : `🎵 Playlist "${nomeDaPlaylist}": ${faixasDaPlaylist.length} música(s) na fila`
            + (ficaramDeFora ? ` (${ficaramDeFora} ficaram de fora: a fila vai até 100).` : '.');
        // O aviso vai só para quem está nesta call (é quem ouve a música), não para o servidor todo.
        const avisoEmTexto = JSON.stringify({ t: 'ok', texto: textoDoAviso });
        for (const conexao of this.ctx.getWebSockets()) {
          if (conexao.readyState === 1 && conexao.deserializeAttachment()?.voz?.canal === canal) { try { conexao.send(avisoEmTexto); } catch { } }
        }
        break;
      }
      case 'musica-fim': case 'musica-erro': {
        const id = Number(m.item);
        const doDj = tocando && tocando.dj === eu.id && tocando.item === id;
        // Erro antes de começar (não achou/baixou): vale de quem está na call, se a faixa é a primeira e ninguém toca.
        const primeira = this.sql.exec('SELECT id, consulta FROM musica_fila WHERE canal_id = ? ORDER BY id LIMIT 1', canal).toArray()[0];
        const antes = m.t === 'musica-erro' && !tocando && primeira?.id === id && a.voz?.canal === canal;
        if (!doDj && !antes) return;
        this.sql.exec('DELETE FROM musica_fila WHERE id = ?', id);
        this.sql.exec('DELETE FROM musica_tocando WHERE canal_id = ?', canal);
        const nome = tocando?.titulo || primeira?.consulta || 'a música';
        if (m.t === 'musica-erro') this.paraServidor(c.servidor_id, { t: 'erro', texto: `🎵 Não deu para tocar "${nome}": ${limpar(m.erro, 120)}` });
        break;
      }
    }
    if (this.sql.exec('SELECT COUNT(*) AS n FROM musica_fila WHERE canal_id = ?', canal).one().n === 0) this.sql.exec('DELETE FROM musica_passar WHERE canal_id = ?', canal);
    this.avisarMusica(canal);
  }

}
