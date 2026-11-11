// MENSAGENS DIRETAS (DMs) — conversa particular entre duas pessoas, como no Discord.
//
// Como funciona: cada conversa é um canal especial (tipo "direta") que não pertence a servidor nenhum
// (servidor_id = 0) e que só as duas pessoas enxergam. Assim ela reaproveita TUDO do chat que já existe:
// mensagens, respostas, anexos, mensagem de voz, editar/apagar, "digitando" e os avisos no celular.
//
// Regras:
//  - Só dá para abrir conversa com amigos ou com quem divide algum servidor com você; bloqueio (em qualquer
//    sentido) impede (amizades.js).
//  - Convidado (acesso temporário) não manda nem recebe DM.
//  - A conversa entre duas pessoas é sempre a mesma (abrir de novo volta para ela).
//
// As funções recebem o objeto do servidor (`comunidade`, a classe Comunidade de comunidade.js).

import { agora } from './utilidades.js';
import { dadosDoConvidado } from './convidados.js';
import { saoAmigos, haBloqueioEntre } from './amizades.js';

/** "Servidor" das conversas diretas: nenhum (os canais delas usam servidor_id = 0). */
export const SERVIDOR_DAS_CONVERSAS_DIRETAS = 0;
export const TIPO_DO_CANAL_DE_CONVERSA_DIRETA = 'direta';

export function migrarConversasDiretas(sql) {
  // A dupla é guardada em ordem (menor id, maior id) para a mesma conversa nunca ser criada duas vezes.
  sql.exec(`CREATE TABLE IF NOT EXISTS conversas_diretas (canal_id INTEGER PRIMARY KEY, usuario_menor INTEGER NOT NULL,
    usuario_maior INTEGER NOT NULL, criado INTEGER NOT NULL, UNIQUE (usuario_menor, usuario_maior))`);
}

/** As duas pessoas da conversa, ou null se o canal não é conversa direta. */
export function participantesDaConversa(comunidade, canalId) {
  const conversa = comunidade.sql.exec('SELECT usuario_menor, usuario_maior FROM conversas_diretas WHERE canal_id = ?', canalId).toArray()[0];
  return conversa ? [conversa.usuario_menor, conversa.usuario_maior] : null;
}

/** As conversas diretas da pessoa, no formato da lista de canais da página (com quem é a conversa em "com"). */
export function conversasDiretasDe(comunidade, usuarioId) {
  return comunidade.sql.exec(`SELECT canal_id AS id, CASE WHEN usuario_menor = ? THEN usuario_maior ELSE usuario_menor END AS com,
      (SELECT MAX(id) FROM mensagens WHERE canal_id = conversas_diretas.canal_id) AS ultima_mensagem
    FROM conversas_diretas WHERE usuario_menor = ? OR usuario_maior = ?`, usuarioId, usuarioId, usuarioId).toArray()
    .map(conversa => ({ id: conversa.id, nome: '', tipo: TIPO_DO_CANAL_DE_CONVERSA_DIRETA, posicao: 0, servidor: SERVIDOR_DAS_CONVERSAS_DIRETAS, com: conversa.com, ultimaMensagem: conversa.ultima_mensagem || 0 }));
}

/** As duas pessoas dividem algum servidor? */
function dividemUmServidor(comunidade, primeiroUsuarioId, segundoUsuarioId) {
  return comunidade.sql.exec(`SELECT 1 FROM membros_servidor primeiro JOIN membros_servidor segundo ON segundo.servidor_id = primeiro.servidor_id
    WHERE primeiro.usuario_id = ? AND segundo.usuario_id = ? LIMIT 1`, primeiroUsuarioId, segundoUsuarioId).toArray().length > 0;
}

/**
 * "Mandar mensagem" para alguém: abre (ou cria) a conversa e devolve { t: 'direta-aberta', canal } para quem pediu.
 * As duas pessoas recebem a lista de canais nova.
 */
export function abrirConversaDireta(comunidade, conexao, eu, mensagem) {
  const outroUsuarioId = Number(mensagem.uid);
  if (!outroUsuarioId || outroUsuarioId === eu.id) return comunidade.erro(conexao, 'Escolha outra pessoa para conversar.');
  if (!comunidade.membro(outroUsuarioId)) return comunidade.erro(conexao, 'Essa pessoa não existe mais.');
  if (dadosDoConvidado(comunidade, outroUsuarioId)) return comunidade.erro(conexao, 'Convidado não recebe mensagem direta.');
  if (haBloqueioEntre(comunidade, eu.id, outroUsuarioId)) return comunidade.erro(conexao, 'Não dá para mandar mensagem para essa pessoa.');
  if (!saoAmigos(comunidade, eu.id, outroUsuarioId) && !dividemUmServidor(comunidade, eu.id, outroUsuarioId)) return comunidade.erro(conexao, 'Só dá para mandar mensagem para amigos ou para quem está num servidor com você.');

  const [usuarioMenor, usuarioMaior] = [eu.id, outroUsuarioId].sort((primeiro, segundo) => primeiro - segundo);
  let canalId = comunidade.sql.exec('SELECT canal_id FROM conversas_diretas WHERE usuario_menor = ? AND usuario_maior = ?', usuarioMenor, usuarioMaior).toArray()[0]?.canal_id;
  if (!canalId) {
    comunidade.ctx.storage.transactionSync(() => {
      canalId = comunidade.sql.exec('INSERT INTO canais (nome, tipo, posicao, criado, servidor_id) VALUES (?,?,0,?,?) RETURNING id',
        '', TIPO_DO_CANAL_DE_CONVERSA_DIRETA, agora(), SERVIDOR_DAS_CONVERSAS_DIRETAS).one().id;
      comunidade.sql.exec('INSERT INTO conversas_diretas (canal_id, usuario_menor, usuario_maior, criado) VALUES (?,?,?,?)', canalId, usuarioMenor, usuarioMaior, agora());
    });
    for (const usuarioId of [usuarioMenor, usuarioMaior]) comunidade.mandarListaDeCanais(usuarioId);
  }
  comunidade.mandar(conexao, { t: 'direta-aberta', canal: canalId });
}
