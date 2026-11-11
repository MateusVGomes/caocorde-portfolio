// ACESSO TEMPORÁRIO (CONVIDADO) — só pelo navegador.
//
// Regras combinadas com o dono (2026-11-04, CHECKLIST.md → item 5):
//  - Quem cria: admin do servidor (ou do app), na tela de convite. O convite de convidado vale 1, 3, 6, 12 ou 24 h
//    e tem limite de quantas pessoas podem usar (1, 5 ou sem limite).
//  - O convidado só escolhe o NOME que aparece no servidor. O Concorde cria uma conta ESCONDIDA para ele
//    (usuário "convidado.xxxxxxxx", sem senha que dê para usar, sem e-mail) — ele não vê cadastro nenhum.
//  - Ele pode: entrar nas calls e assistir lives. Chat e arquivos só no CHAT TEMPORÁRIO dele, um canal de texto
//    criado quando ele entra, que todo mundo do servidor vê.
//  - Quando o tempo acaba com ele conectado, ele NÃO cai no meio; quando ele sai (fecha a página), a conta, o chat
//    temporário e as mensagens são APAGADOS. Se ele sair antes do tempo acabar, também é apagado — depois de uma
//    tolerância de 2 minutos (para uma queda de internet ou um recarregar de página não apagar tudo).
//  - Expulso do servidor por um admin: apagado na hora. "Desconectar" da call (moderação) só tira da call.
//  - "Converter em conta definitiva" (admin): a página do convidado recarrega no cadastro normal (usuário, senha,
//    e-mail) SEM pedir código de convite; a conta escondida vira a conta de verdade (continua no servidor).
//
// Todas as funções recebem o objeto do servidor (`comunidade`, a classe Comunidade de comunidade.js) para usar o
// banco (comunidade.sql) e as conexões (comunidade.ctx).

import { PALETA, USUARIO, EMAIL, agora, limpar, limparEmail, hex, erroSenha, hashSenha, LIMITES } from './utilidades.js';
import { hashDoTokenDeSessao } from './sessoes.js';

/** Quanto tempo o convite de convidado pode valer (horas). */
export const DURACOES_DO_CONVITE_DE_CONVIDADO_EM_HORAS = [1, 3, 6, 12, 24];
/** Saiu (fechou a página) antes do tempo acabar: espera isso antes de apagar (queda de internet, recarregar). */
export const TOLERANCIA_PARA_VOLTAR_EM_MS = 2 * 60_000;
/** O que o convidado pode pedir pelo WebSocket. Todo o resto (criar servidor, canal, convite, senha...) é negado. */
const ACOES_PERMITIDAS_AO_CONVIDADO = new Set(['historico', 'enviar', 'editar', 'apagar', 'digitando', 'presenca']);

/** Colunas novas (0.5.9): convite de convidado e os dados da conta temporária. */
export function migrarConvidados(sql) {
  const colunas = tabela => sql.exec(`PRAGMA table_info(${tabela})`).toArray().map(coluna => coluna.name);
  if (!colunas('convites_temp').includes('convidado')) sql.exec('ALTER TABLE convites_temp ADD COLUMN convidado INTEGER NOT NULL DEFAULT 0');
  const colunasDeUsuarios = colunas('usuarios');
  // convidado_ate: até quando vale (null = conta normal) · convidado_servidor: servidor do convite ·
  // convidado_canal: o chat temporário · convidado_saiu: quando a última conexão fechou · convidado_conversao:
  // hash do código de uso único para virar conta definitiva.
  for (const [coluna, tipo] of [['convidado_ate', 'INTEGER'], ['convidado_servidor', 'INTEGER'], ['convidado_canal', 'INTEGER'], ['convidado_saiu', 'INTEGER'], ['convidado_conversao', 'TEXT']]) {
    if (!colunasDeUsuarios.includes(coluna)) sql.exec(`ALTER TABLE usuarios ADD COLUMN ${coluna} ${tipo}`);
  }
}

/** Os dados de convidado da conta, ou null se é uma conta normal. */
export function dadosDoConvidado(comunidade, usuarioId) {
  const linha = comunidade.sql.exec('SELECT convidado_ate, convidado_servidor, convidado_canal, convidado_saiu FROM usuarios WHERE id = ?', usuarioId).toArray()[0];
  return linha?.convidado_ate ? linha : null;
}

/** O convidado pode fazer essa ação pelo WebSocket? (voz e música: sim; mexer em servidor, canal, senha: não.) */
export function acaoPermitidaAoConvidado(tipoDaMensagem) {
  return ACOES_PERMITIDAS_AO_CONVIDADO.has(tipoDaMensagem) || tipoDaMensagem?.startsWith('voz-') || tipoDaMensagem?.startsWith('musica-');
}

/** Convidado só enxerga os canais de VOZ do servidor e o PRÓPRIO chat temporário (texto). */
export function canalPermitidoAoConvidado(convidado, canal) {
  return canal.tipo === 'voz' || canal.id === convidado.convidado_canal;
}

/** O convite de convidado (código de 6 números), se ainda vale e tem vaga. */
function conviteDeConvidadoValido(comunidade, codigo) {
  const somenteDigitos = limpar(codigo, 16).replace(/[\s.-]/g, '');
  if (!/^\d{6}$/.test(somenteDigitos)) return null;
  return comunidade.sql.exec(`SELECT c.*, s.nome AS nome_do_servidor FROM convites_temp c JOIN servidores s ON s.id = c.servidor_id
    WHERE c.codigo = ? AND c.convidado = 1 AND c.expira > ? AND (c.usos_max = 0 OR c.usos < c.usos_max)`, somenteDigitos, agora()).toArray()[0] || null;
}

/** Para a tela de entrada: o nome do servidor e até quando vale (sem gastar o convite). */
export function informacoesDoConvite(comunidade, { codigo }, ip = '') {
  if (comunidade.bloqueado(`convite:${ip}`, LIMITES.convite)) return { erro: 'Muitos convites errados. Espere uma hora e tente de novo.' };
  const convite = conviteDeConvidadoValido(comunidade, codigo);
  if (!convite) { comunidade.errou(`convite:${ip}`, LIMITES.convite); return { erro: 'Esse convite de convidado não vale mais (venceu ou já foi usado).' }; }
  return { servidor: convite.nome_do_servidor, expira: convite.expira };
}

/**
 * Entra como convidado: cria a conta escondida, o chat temporário e a sessão. Devolve { token } (o Worker põe no
 * cookie, que some ao fechar o navegador) ou { erro }.
 */
export async function entrarComoConvidado(comunidade, { codigo, nome }, ip = '') {
  if (comunidade.bloqueado(`convite:${ip}`, LIMITES.convite)) return { erro: 'Muitos convites errados. Espere uma hora e tente de novo.' };
  const nomeNoServidor = limpar(nome, 32);
  if (nomeNoServidor.length < 2) return { erro: 'Escolha um nome com pelo menos 2 letras.' };
  const convite = conviteDeConvidadoValido(comunidade, codigo);
  if (!convite) { comunidade.errou(`convite:${ip}`, LIMITES.convite); return { erro: 'Esse convite de convidado não vale mais (venceu ou já foi usado).' }; }

  // Conta escondida: usuário aleatório e uma "senha" aleatória que ninguém conhece (não dá para entrar por senha).
  let usuarioEscondido;
  do { usuarioEscondido = `convidado.${hex(crypto.getRandomValues(new Uint8Array(4)))}`; }
  while (comunidade.sql.exec('SELECT 1 FROM usuarios WHERE usuario = ?', usuarioEscondido).toArray().length);
  const corDaConta = PALETA[Math.floor(Math.random() * PALETA.length)];
  const agoraEmMs = agora();

  let usuarioId;
  comunidade.ctx.storage.transactionSync(() => {
    comunidade.sql.exec('UPDATE convites_temp SET usos = usos + 1 WHERE codigo = ?', convite.codigo);
    usuarioId = comunidade.sql.exec(`INSERT INTO usuarios (usuario, nome, hash, salt, rodadas_senha, cor, admin, criado, email, seguranca, convidado_ate, convidado_servidor)
      VALUES (?,?,?,?,?,?,0,?,NULL,1,?,?) RETURNING id`,
      usuarioEscondido, nomeNoServidor, hex(crypto.getRandomValues(new Uint8Array(32))), hex(crypto.getRandomValues(new Uint8Array(16))), 1,
      corDaConta, agoraEmMs, convite.expira, convite.servidor_id).one().id;
    // Chat temporário: canal de texto no fim da lista, com o nome do convidado.
    const nomeDoCanal = `convidado-${nomeNoServidor.toLowerCase().replace(/\s+/g, '-')}`.slice(0, 32);
    const posicao = comunidade.sql.exec('SELECT COALESCE(MAX(posicao), 0) + 1 AS p FROM canais WHERE servidor_id = ?', convite.servidor_id).one().p;
    const canalId = comunidade.sql.exec('INSERT INTO canais (nome, tipo, posicao, criado, servidor_id) VALUES (?,?,?,?,?) RETURNING id',
      nomeDoCanal, 'texto', posicao, agoraEmMs, convite.servidor_id).one().id;
    comunidade.sql.exec('UPDATE usuarios SET convidado_canal = ? WHERE id = ?', canalId, usuarioId);
    comunidade.sql.exec('INSERT OR IGNORE INTO membros_servidor (servidor_id, usuario_id, admin, entrou) VALUES (?,?,0,?)', convite.servidor_id, usuarioId, agoraEmMs);
  });
  comunidade.atualizarTodos();
  await agendarProximaLimpeza(comunidade);
  return { token: await comunidade.novaSessao(usuarioId) };
}

/** A sessão de um convidado vencido só vale enquanto ele continua conectado (não cai no meio da call). */
export function sessaoDeConvidadoAindaVale(comunidade, usuarioId) {
  const convidado = dadosDoConvidado(comunidade, usuarioId);
  if (!convidado) return true;
  return convidado.convidado_ate > agora() || comunidade.socketsDe(usuarioId).length > 0;
}

/** Conectou (ou reconectou dentro da tolerância): cancela a contagem para apagar. */
export function aoConectarConvidado(comunidade, usuarioId) {
  if (dadosDoConvidado(comunidade, usuarioId)) comunidade.sql.exec('UPDATE usuarios SET convidado_saiu = NULL WHERE id = ?', usuarioId);
}

/**
 * A última conexão do convidado fechou: se o tempo já acabou, apaga agora; senão, marca e agenda (tolerância).
 * conexaoQueFechou: na hora do aviso ela ainda aparece na lista de conexões — não conta.
 */
export async function aoDesconectarConvidado(comunidade, usuarioId, conexaoQueFechou) {
  const convidado = dadosDoConvidado(comunidade, usuarioId);
  if (!convidado || comunidade.socketsDe(usuarioId).some(conexao => conexao !== conexaoQueFechou)) return;
  if (convidado.convidado_ate <= agora()) return apagarConvidado(comunidade, usuarioId);
  const saiuEmMs = agora();
  comunidade.sql.exec('UPDATE usuarios SET convidado_saiu = ? WHERE id = ?', saiuEmMs, usuarioId);
  // Programa o despertador direto para o fim da tolerância (ou o fim do convite, se vier antes). Não dá para usar
  // agendarProximaLimpeza aqui: a conexão que está fechando ainda aparece como aberta e o convidado seria pulado.
  await programarDespertadorPara(comunidade, Math.min(saiuEmMs + TOLERANCIA_PARA_VOLTAR_EM_MS, Math.max(convidado.convidado_ate, saiuEmMs)));
}

/** Programa o despertador (alarm) do servidor para este momento, se não houver outro antes. */
async function programarDespertadorPara(comunidade, momentoEmMs) {
  const despertadorAtual = await comunidade.ctx.storage.getAlarm();
  if (!despertadorAtual || despertadorAtual > momentoEmMs) await comunidade.ctx.storage.setAlarm(momentoEmMs + 200);
}

/**
 * Apaga o convidado por inteiro: tira da call, fecha as conexões, apaga o chat temporário (mensagens e arquivos),
 * a sessão e a conta. Os arquivos guardados no R2 somem sozinhos na limpeza diária (7 dias).
 */
export function apagarConvidado(comunidade, usuarioId) {
  const convidado = dadosDoConvidado(comunidade, usuarioId);
  if (!convidado) return;
  for (const conexao of comunidade.socketsDe(usuarioId)) {
    const sessaoDaConexao = conexao.deserializeAttachment();
    if (sessaoDaConexao?.voz) comunidade.tirarDaCall(conexao, sessaoDaConexao);
    comunidade.mandar(conexao, { t: 'convidado-fim' });
    try { conexao.close(4003, 'acesso de convidado terminou'); } catch (erroAoFechar) { console.log('[convidado] não fechou a conexão:', erroAoFechar?.message); }
  }
  comunidade.ctx.storage.transactionSync(() => {
    const canal = convidado.convidado_canal;
    if (canal) {
      comunidade.sql.exec('DELETE FROM mensagens WHERE canal_id = ?', canal);
      comunidade.sql.exec('DELETE FROM arquivos WHERE canal_id = ?', canal);
      comunidade.sql.exec('DELETE FROM canais WHERE id = ?', canal);
    }
    comunidade.sql.exec('DELETE FROM sessoes WHERE usuario_id = ?', usuarioId);
    comunidade.sql.exec('DELETE FROM membros_servidor WHERE usuario_id = ?', usuarioId);
    comunidade.sql.exec('DELETE FROM membros_cargos WHERE usuario_id = ?', usuarioId);
    comunidade.sql.exec('DELETE FROM moderacao_voz WHERE usuario_id = ?', usuarioId);
    comunidade.sql.exec('DELETE FROM push_aparelhos WHERE usuario_id = ?', usuarioId);
    comunidade.sql.exec('DELETE FROM usuarios WHERE id = ?', usuarioId);
  });
  comunidade.atualizarTodos();
}

/**
 * Chamado pelo despertador (alarm) do servidor: apaga quem saiu e não voltou na tolerância, e quem venceu sem
 * estar conectado. Devolve quando é a próxima limpeza (ms) ou null se não há convidado esperando.
 */
export function limparConvidadosQueSairam(comunidade) {
  const agoraEmMs = agora();
  let proximaLimpezaEmMs = null;
  for (const convidado of comunidade.sql.exec('SELECT id, convidado_ate, convidado_saiu FROM usuarios WHERE convidado_ate IS NOT NULL').toArray()) {
    if (comunidade.socketsDe(convidado.id).length > 0) continue;   // conectado: quem decide é o "saiu"
    const quandoApagarEmMs = convidado.convidado_saiu != null
      ? Math.min(convidado.convidado_saiu + TOLERANCIA_PARA_VOLTAR_EM_MS, Math.max(convidado.convidado_ate, convidado.convidado_saiu))
      : convidado.convidado_ate;
    if (quandoApagarEmMs <= agoraEmMs) apagarConvidado(comunidade, convidado.id);
    else proximaLimpezaEmMs = Math.min(proximaLimpezaEmMs ?? Infinity, quandoApagarEmMs);
  }
  return proximaLimpezaEmMs;
}

/** Acerta o despertador do servidor para a próxima limpeza de convidado (sem atrasar o da música). */
async function agendarProximaLimpeza(comunidade) {
  const proxima = limparConvidadosQueSairam(comunidade);
  if (proxima != null) await programarDespertadorPara(comunidade, proxima);
}

/**
 * Admin pede "converter em conta definitiva": gera um código de uso único e manda para a página do convidado, que
 * recarrega no cadastro normal (sem pedir código de convite).
 */
export async function pedirConversao(comunidade, conexaoDoAdmin, admin, mensagem) {
  const usuarioId = Number(mensagem.uid);
  const convidado = dadosDoConvidado(comunidade, usuarioId);
  if (!convidado) return comunidade.erro(conexaoDoAdmin, 'Essa pessoa não é convidada.');
  if (!comunidade.adminDe(convidado.convidado_servidor, admin.id)) return comunidade.erro(conexaoDoAdmin, 'Só admin do servidor converte o convidado.');
  const conexoesDoConvidado = comunidade.socketsDe(usuarioId);
  if (!conexoesDoConvidado.length) return comunidade.erro(conexaoDoAdmin, 'O convidado não está conectado agora.');
  const codigoDeConversao = hex(crypto.getRandomValues(new Uint8Array(32)));
  comunidade.sql.exec('UPDATE usuarios SET convidado_conversao = ? WHERE id = ?', await hashDoTokenDeSessao(codigoDeConversao), usuarioId);
  for (const conexao of conexoesDoConvidado) comunidade.mandar(conexao, { t: 'convidado-converter', codigo: codigoDeConversao });
  comunidade.mandar(conexaoDoAdmin, { t: 'ok', texto: 'Pronto: a página do convidado abriu o cadastro. Quando ele terminar, vira conta normal.' });
}

/**
 * O convidado terminou o cadastro (usuário, senha, e-mail) com o código de conversão: a conta escondida vira a
 * conta de verdade (mesmo id, continua no servidor), o chat temporário é apagado e as sessões antigas caem.
 */
export async function converterEmContaDefinitiva(comunidade, { conversao, usuario, senha, confirmar, nome, email }) {
  const hashDoCodigo = await hashDoTokenDeSessao(String(conversao || ''));
  const convidado = comunidade.sql.exec('SELECT id, convidado_canal FROM usuarios WHERE convidado_conversao = ? AND convidado_ate IS NOT NULL', hashDoCodigo).toArray()[0];
  if (!convidado) return { erro: 'Esse pedido para virar conta não vale mais. Peça para o admin de novo.' };
  usuario = limpar(usuario, 20).toLowerCase();
  const nomeNoServidor = limpar(nome, 32) || usuario;
  email = limparEmail(email);
  if (!USUARIO.test(usuario) || usuario.startsWith('convidado.')) return { erro: 'Usuário: 3 a 20 letras minúsculas, números, ponto ou _.' };
  if (!EMAIL.test(email)) return { erro: 'E-mail inválido.' };
  const fraca = erroSenha(senha);
  if (fraca) return { erro: fraca };
  if (confirmar !== undefined && String(confirmar) !== String(senha)) return { erro: 'A confirmação não bate com a senha.' };
  if (comunidade.sql.exec('SELECT 1 FROM usuarios WHERE usuario = ?', usuario).toArray().length) return { erro: 'Esse usuário já existe.' };
  if (comunidade.sql.exec('SELECT 1 FROM usuarios WHERE email = ?', email).toArray().length) return { erro: 'Esse e-mail já tem conta.' };
  const { hash, salt, rodadas } = await hashSenha(String(senha));

  for (const conexao of comunidade.socketsDe(convidado.id)) { try { conexao.close(4004, 'virou conta definitiva'); } catch { } }
  comunidade.ctx.storage.transactionSync(() => {
    if (convidado.convidado_canal) {
      comunidade.sql.exec('DELETE FROM mensagens WHERE canal_id = ?', convidado.convidado_canal);
      comunidade.sql.exec('DELETE FROM arquivos WHERE canal_id = ?', convidado.convidado_canal);
      comunidade.sql.exec('DELETE FROM canais WHERE id = ?', convidado.convidado_canal);
    }
    comunidade.sql.exec(`UPDATE usuarios SET usuario = ?, nome = ?, hash = ?, salt = ?, rodadas_senha = ?, email = ?, seguranca = 1,
      convidado_ate = NULL, convidado_servidor = NULL, convidado_canal = NULL, convidado_saiu = NULL, convidado_conversao = NULL WHERE id = ?`,
      usuario, nomeNoServidor, hash, salt, rodadas, email, convidado.id);
    comunidade.sql.exec('DELETE FROM sessoes WHERE usuario_id = ?', convidado.id);
  });
  comunidade.atualizarTodos();
  return { token: await comunidade.novaSessao(convidado.id) };
}
