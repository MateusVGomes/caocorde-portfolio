// AMIZADES, BLOQUEIO E SILENCIAR POR CONTA (0.5.11) — como no Discord.
//
//  - Amizade: um pede (pelo nome de usuário ou pelo clique direito), o outro aceita. Amigos se veem mesmo sem dividir
//    servidor (nome, foto, online) e podem mandar mensagem direta.
//  - Bloquear: desfaz a amizade e os pedidos; a pessoa bloqueada não manda pedido nem mensagem direta para quem
//    bloqueou (vale nos dois sentidos para DM). As mensagens dela nos servidores ficam escondidas para quem bloqueou
//    (a página esconde) e ela não gera aviso no celular.
//  - Silenciar (pela conta, em todos os aparelhos): a voz da pessoa some para você em qualquer call e ela não gera
//    aviso. Diferente do "Silenciar para mim" do menu da call, que vale só naquele aparelho.
// Convidado (acesso temporário) não usa nada disso (fica fora da lista de ações do convidado).
//
// As funções recebem o objeto do servidor (`comunidade`, a classe Comunidade de comunidade.js).

import { agora, limpar, USUARIO, LIMITES } from './utilidades.js';
import { dadosDoConvidado } from './convidados.js';

/** Tipos de mensagem do WebSocket tratados aqui. */
export const ACOES_DE_AMIZADE = ['amizade-pedir', 'amizade-aceitar', 'amizade-remover', 'bloquear', 'desbloquear', 'silenciar-conta', 'dessilenciar-conta'];

export function migrarAmizades(sql) {
  // A dupla da amizade é guardada em ordem (menor id, maior id), como nas conversas diretas.
  sql.exec(`
    CREATE TABLE IF NOT EXISTS amizades (usuario_menor INTEGER NOT NULL, usuario_maior INTEGER NOT NULL, estado TEXT NOT NULL,
      pedido_por INTEGER NOT NULL, criado INTEGER NOT NULL, PRIMARY KEY (usuario_menor, usuario_maior));
    CREATE TABLE IF NOT EXISTS bloqueios (usuario_id INTEGER NOT NULL, bloqueado_id INTEGER NOT NULL, criado INTEGER NOT NULL,
      PRIMARY KEY (usuario_id, bloqueado_id));
    CREATE TABLE IF NOT EXISTS silenciados_conta (usuario_id INTEGER NOT NULL, silenciado_id INTEGER NOT NULL, criado INTEGER NOT NULL,
      PRIMARY KEY (usuario_id, silenciado_id));`);
}

const emOrdem = (primeiro, segundo) => (primeiro < segundo ? [primeiro, segundo] : [segundo, primeiro]);

/** Ids dos amigos (amizade aceita). */
export function amigosDe(comunidade, usuarioId) {
  return comunidade.sql.exec(`SELECT CASE WHEN usuario_menor = ? THEN usuario_maior ELSE usuario_menor END AS id FROM amizades
    WHERE estado = 'aceita' AND (usuario_menor = ? OR usuario_maior = ?)`, usuarioId, usuarioId, usuarioId).toArray().map(linha => linha.id);
}

export function saoAmigos(comunidade, primeiro, segundo) {
  const [menor, maior] = emOrdem(primeiro, segundo);
  return comunidade.sql.exec("SELECT 1 FROM amizades WHERE usuario_menor = ? AND usuario_maior = ? AND estado = 'aceita'", menor, maior).toArray().length > 0;
}

/** Algum dos dois bloqueou o outro? */
export function haBloqueioEntre(comunidade, primeiro, segundo) {
  return comunidade.sql.exec('SELECT 1 FROM bloqueios WHERE (usuario_id = ? AND bloqueado_id = ?) OR (usuario_id = ? AND bloqueado_id = ?)',
    primeiro, segundo, segundo, primeiro).toArray().length > 0;
}

/** Quem não quer receber aviso desta pessoa (bloqueou ou silenciou). */
export function naoQueremAvisoDe(comunidade, autorId) {
  return new Set(comunidade.sql.exec(`SELECT usuario_id AS id FROM bloqueios WHERE bloqueado_id = ?
    UNION SELECT usuario_id FROM silenciados_conta WHERE silenciado_id = ?`, autorId, autorId).toArray().map(linha => linha.id));
}

/** Ids de todo mundo que tem alguma relação com a pessoa (amigo, pedido, bloqueado) — entram na lista de membros dela. */
export function pessoasDasRelacoes(comunidade, usuarioId) {
  return comunidade.sql.exec(`SELECT CASE WHEN usuario_menor = ? THEN usuario_maior ELSE usuario_menor END AS id FROM amizades
      WHERE usuario_menor = ? OR usuario_maior = ?
    UNION SELECT bloqueado_id FROM bloqueios WHERE usuario_id = ?`, usuarioId, usuarioId, usuarioId, usuarioId).toArray().map(linha => linha.id);
}

/** Tudo que a página precisa: amigos, pedidos recebidos/enviados, bloqueados e silenciados (só ids). */
export function relacoesDe(comunidade, usuarioId) {
  const linhas = comunidade.sql.exec(`SELECT usuario_menor, usuario_maior, estado, pedido_por FROM amizades WHERE usuario_menor = ? OR usuario_maior = ?`,
    usuarioId, usuarioId).toArray();
  const outro = linha => (linha.usuario_menor === usuarioId ? linha.usuario_maior : linha.usuario_menor);
  return {
    amigos: linhas.filter(linha => linha.estado === 'aceita').map(outro),
    pedidosRecebidos: linhas.filter(linha => linha.estado === 'pendente' && linha.pedido_por !== usuarioId).map(outro),
    pedidosEnviados: linhas.filter(linha => linha.estado === 'pendente' && linha.pedido_por === usuarioId).map(outro),
    bloqueados: comunidade.sql.exec('SELECT bloqueado_id AS id FROM bloqueios WHERE usuario_id = ?', usuarioId).toArray().map(linha => linha.id),
    silenciados: comunidade.sql.exec('SELECT silenciado_id AS id FROM silenciados_conta WHERE usuario_id = ?', usuarioId).toArray().map(linha => linha.id),
  };
}

/** Manda para os aparelhos da pessoa as relações e a lista de membros atualizadas. */
export function mandarRelacoes(comunidade, usuarioId) {
  const mensagem = { t: 'relacoes', ...relacoesDe(comunidade, usuarioId), membros: comunidade.membrosVisiveis(usuarioId) };
  for (const conexao of comunidade.socketsDe(usuarioId)) comunidade.mandar(conexao, mensagem);
}

/** Trata as mensagens de amizade / bloqueio / silenciar do WebSocket. */
export function tratarAcaoDeAmizade(comunidade, conexao, eu, mensagem) {
  const erro = texto => comunidade.erro(conexao, texto);
  let alvoId = Number(mensagem.uid) || null;
  if (mensagem.t === 'amizade-pedir' && !alvoId) {
    // Pedido pelo nome de usuário: trava contra "varredura" de nomes (30 por hora por conta).
    if (comunidade.bloqueado(`amizade:${eu.id}`, LIMITES.amizade)) return erro('Muitos pedidos de amizade. Espere um pouco.');
    comunidade.errou(`amizade:${eu.id}`, LIMITES.amizade);
    const usuario = limpar(mensagem.usuario, 21).toLowerCase().replace(/^@/, '');
    if (!USUARIO.test(usuario)) return erro('Digite o nome de usuário (ex.: jorginho).');
    alvoId = comunidade.sql.exec('SELECT id FROM usuarios WHERE usuario = ? AND convidado_ate IS NULL', usuario).toArray()[0]?.id || null;
    if (!alvoId) return erro('Não achei ninguém com esse usuário. Confira se digitou certinho.');
  }
  if (!alvoId || alvoId === eu.id) return erro('Escolha outra pessoa.');
  if (!comunidade.membro(alvoId)) return erro('Essa pessoa não existe mais.');
  if (dadosDoConvidado(comunidade, alvoId)) return erro('Convidado não tem amigos nem pode ser bloqueado aqui: ele some quando sai.');
  const [menor, maior] = emOrdem(eu.id, alvoId);
  const amizade = comunidade.sql.exec('SELECT * FROM amizades WHERE usuario_menor = ? AND usuario_maior = ?', menor, maior).toArray()[0];

  switch (mensagem.t) {
    case 'amizade-pedir':
      if (haBloqueioEntre(comunidade, eu.id, alvoId)) return erro('Não dá para mandar pedido de amizade para essa pessoa.');
      if (amizade?.estado === 'aceita') return erro('Vocês já são amigos.');
      if (amizade && amizade.pedido_por === eu.id) return erro('Você já mandou o pedido. Agora é com a outra pessoa.');
      if (amizade) {   // a outra pessoa já tinha pedido: pedir de volta = aceitar
        comunidade.sql.exec("UPDATE amizades SET estado = 'aceita' WHERE usuario_menor = ? AND usuario_maior = ?", menor, maior);
      } else {
        if (comunidade.sql.exec("SELECT COUNT(*) AS n FROM amizades WHERE pedido_por = ? AND estado = 'pendente'", eu.id).one().n >= 100) return erro('Você tem 100 pedidos esperando resposta. Cancele alguns.');
        comunidade.sql.exec("INSERT INTO amizades (usuario_menor, usuario_maior, estado, pedido_por, criado) VALUES (?,?,'pendente',?,?)", menor, maior, eu.id, agora());
      }
      comunidade.mandar(conexao, { t: 'ok', texto: amizade ? 'Agora vocês são amigos ✓' : 'Pedido de amizade enviado ✓' });
      break;
    case 'amizade-aceitar':
      if (!amizade || amizade.estado !== 'pendente' || amizade.pedido_por === eu.id) return erro('Não tem pedido dessa pessoa para aceitar.');
      comunidade.sql.exec("UPDATE amizades SET estado = 'aceita' WHERE usuario_menor = ? AND usuario_maior = ?", menor, maior);
      break;
    case 'amizade-remover':   // recusar pedido, cancelar o próprio pedido ou desfazer amizade
      comunidade.sql.exec('DELETE FROM amizades WHERE usuario_menor = ? AND usuario_maior = ?', menor, maior);
      break;
    case 'bloquear':
      comunidade.sql.exec('DELETE FROM amizades WHERE usuario_menor = ? AND usuario_maior = ?', menor, maior);
      comunidade.sql.exec('INSERT OR IGNORE INTO bloqueios (usuario_id, bloqueado_id, criado) VALUES (?,?,?)', eu.id, alvoId, agora());
      break;
    case 'desbloquear':
      comunidade.sql.exec('DELETE FROM bloqueios WHERE usuario_id = ? AND bloqueado_id = ?', eu.id, alvoId);
      break;
    case 'silenciar-conta':
      comunidade.sql.exec('INSERT OR IGNORE INTO silenciados_conta (usuario_id, silenciado_id, criado) VALUES (?,?,?)', eu.id, alvoId, agora());
      break;
    case 'dessilenciar-conta':
      comunidade.sql.exec('DELETE FROM silenciados_conta WHERE usuario_id = ? AND silenciado_id = ?', eu.id, alvoId);
      break;
    default: return undefined;
  }
  mandarRelacoes(comunidade, eu.id);
  // Silenciar/desbloquear não muda nada para o outro lado; o resto (amizade, bloqueio) sim.
  if (!['silenciar-conta', 'dessilenciar-conta'].includes(mensagem.t)) mandarRelacoes(comunidade, alvoId);
  return undefined;
}

/** Conta apagada: some de todas as relações. */
export function apagarRelacoesDe(comunidade, usuarioId) {
  comunidade.sql.exec('DELETE FROM amizades WHERE usuario_menor = ? OR usuario_maior = ?', usuarioId, usuarioId);
  comunidade.sql.exec('DELETE FROM bloqueios WHERE usuario_id = ? OR bloqueado_id = ?', usuarioId, usuarioId);
  comunidade.sql.exec('DELETE FROM silenciados_conta WHERE usuario_id = ? OR silenciado_id = ?', usuarioId, usuarioId);
}
