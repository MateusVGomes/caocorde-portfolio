// ACESSO AO APP — quem pode criar conta no Caocorde (0.5.10).
//
// Antes, qualquer código de servidor criava conta. Agora só o ADMIN DO APP abre a porta:
//   - convite do app ("app"): cria a conta e a pessoa começa sem servidor nenhum (cria o dela ou recebe convite);
//   - convite do app + servidor ("servidor"): cria a conta e já coloca a pessoa num servidor escolhido;
//   - só o código ("codigo"): igual ao "app", mas o painel mostra só o código (sem link) para passar por mensagem;
//   - convite de convidado: acesso temporário sem conta (fica em convites_temp, ver convidados.js).
// Os convites de SERVIDOR (link fixo e códigos de 6 números que o admin do servidor gera) agora só colocam no
// servidor quem JÁ TEM conta. Quem não tem recebe "sem acesso" e vai para a página de pedir acesso.
//
// Pedido de acesso: a página inicial (landing) tem "Pedir acesso". A pessoa diz quem indicou, como é conhecida e o
// e-mail. O admin aprova no painel → o servidor cria um convite de uso único e manda por e-mail o link de cadastro
// (com o código já preenchido) e os links para baixar o app do Windows e do celular, com o passo a passo.
//
// O código dos convites do app tem 8 letras/números (32^8 ≈ 1 trilhão de combinações) e cada endereço só pode
// errar 10 vezes por hora (LIMITES.convite): não dá para adivinhar.

import { EMAIL, agora, limpar, limparEmail, LIMITES } from './utilidades.js';
import { enviarEmail, htmlAprovacao } from './email.js';

/** Tipos de convite que o painel do admin cria (o de convidado é tratado à parte). */
export const TIPOS_DE_CONVITE_DO_APP = ['app', 'servidor', 'codigo'];
/** Duração máxima de um convite do app: 30 dias (em horas). Convidado: até 24 horas. */
export const HORAS_MAXIMAS_DO_CONVITE = 720;
export const HORAS_MAXIMAS_DO_CONVIDADO = 24;
/** Quantas pessoas um convite pode cadastrar (0 = sem limite, só até vencer). */
export const USOS_MAXIMOS_DO_CONVITE = 100;
/** Convite que vai no e-mail de aprovação: uso único, vale 7 dias. */
const HORAS_DO_CONVITE_DO_PEDIDO = 168;
/** Para ninguém lotar a fila de pedidos: no máximo isso de pedidos esperando resposta. */
const PEDIDOS_PENDENTES_MAXIMOS = 300;

/** Letras e números sem os que confundem (0/O, 1/I/L). */
const ALFABETO_DO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function migrarAcessoAoApp(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS convites_app (codigo TEXT PRIMARY KEY, tipo TEXT NOT NULL, servidor_id INTEGER,
      criado_por INTEGER NOT NULL, criado INTEGER NOT NULL, expira INTEGER NOT NULL, usos_max INTEGER NOT NULL,
      usos INTEGER NOT NULL DEFAULT 0, pedido_id INTEGER);
    CREATE TABLE IF NOT EXISTS pedidos_acesso (id INTEGER PRIMARY KEY, indicado_por TEXT, como_conhece TEXT NOT NULL,
      email TEXT NOT NULL, criado INTEGER NOT NULL, estado TEXT NOT NULL DEFAULT 'pendente', decidido_por INTEGER,
      decidido_em INTEGER, codigo TEXT, erro_email TEXT);`);
  const colunasDeUsuarios = sql.exec('PRAGMA table_info(usuarios)').toArray().map(coluna => coluna.name);
  // Quando a pessoa confirmou ter 18 anos ou mais (no cadastro) e por qual convite entrou (auditoria).
  if (!colunasDeUsuarios.includes('maior_de_idade_em')) sql.exec('ALTER TABLE usuarios ADD COLUMN maior_de_idade_em INTEGER');
  if (!colunasDeUsuarios.includes('entrou_pelo_convite')) sql.exec('ALTER TABLE usuarios ADD COLUMN entrou_pelo_convite TEXT');
}

/** "abcd-efgh" / "ABCD EFGH" → "ABCDEFGH" (o que a pessoa digitou, sem enfeite). */
export const normalizarCodigo = codigo => limpar(codigo, 32).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** "ABCDEFGH" → "ABCD-EFGH" (como aparece para as pessoas). */
export const codigoParaMostrar = codigo => `${codigo.slice(0, 4)}-${codigo.slice(4)}`;

function sortearCodigo(comunidade) {
  for (;;) {
    const codigo = [...crypto.getRandomValues(new Uint8Array(8))].map(byte => ALFABETO_DO_CODIGO[byte % ALFABETO_DO_CODIGO.length]).join('');
    if (!comunidade.sql.exec('SELECT 1 FROM convites_app WHERE codigo = ?', codigo).toArray().length) return codigo;
  }
}

/** O convite do app ainda vale (não venceu, não esgotou)? Devolve a linha do banco ou null. */
export function conviteDoAppValido(comunidade, codigo) {
  const codigoLimpo = normalizarCodigo(codigo);
  if (codigoLimpo.length !== 8) return null;
  return comunidade.sql.exec('SELECT * FROM convites_app WHERE codigo = ? AND expira > ? AND (usos_max = 0 OR usos < usos_max)',
    codigoLimpo, agora()).toArray()[0] || null;
}

/** Conta um uso do convite (no cadastro). */
export function consumirConviteDoApp(comunidade, codigo) {
  comunidade.sql.exec('UPDATE convites_app SET usos = usos + 1 WHERE codigo = ?', normalizarCodigo(codigo));
}

/**
 * Tela "Tenho um código de convite" (antes do cadastro): o código vale? Erro conta na trava por endereço.
 * Devolve { ok, codigo, servidor } — servidor = nome do servidor em que a pessoa vai entrar (convite "servidor").
 */
export function validarConvite(comunidade, { codigo }, ip) {
  if (comunidade.bloqueado(`convite:${ip}`, LIMITES.convite)) return { erro: 'Muitos códigos errados. Espere uma hora e tente de novo.' };
  const convite = conviteDoAppValido(comunidade, codigo);
  if (!convite) { comunidade.errou(`convite:${ip}`, LIMITES.convite); return { erro: 'Código de convite errado ou vencido.' }; }
  const servidor = convite.servidor_id ? comunidade.sql.exec('SELECT nome FROM servidores WHERE id = ?', convite.servidor_id).toArray()[0]?.nome : null;
  return { ok: true, codigo: codigoParaMostrar(convite.codigo), servidor: servidor || null };
}

/**
 * "Pedir acesso" na página inicial. Responde sempre igual (não revela se o e-mail já tem conta ou pedido).
 * Trava: 3 pedidos por endereço por hora.
 */
export function pedirAcesso(comunidade, { indicadoPor, comoConhece, email, maiorDeIdade }, ip) {
  const chaveDaTrava = `pedido:${ip}`;
  if (comunidade.bloqueado(chaveDaTrava, LIMITES.pedido)) return { erro: 'Você já mandou pedidos demais. Tente de novo daqui a uma hora.' };
  const emailLimpo = limparEmail(email);
  const comoConheceLimpo = limpar(comoConhece, 300);
  const indicadoPorLimpo = limpar(indicadoPor, 60);
  if (maiorDeIdade !== true) return { erro: 'O Caocorde é só para maiores de 18 anos.' };
  if (!EMAIL.test(emailLimpo)) return { erro: 'E-mail inválido.' };
  if (comoConheceLimpo.length < 3) return { erro: 'Conte como a pessoa te conhece (ou como você quer ser reconhecido).' };
  comunidade.errou(chaveDaTrava, LIMITES.pedido);   // todo pedido conta na trava (certo ou não)
  const jaTemConta = comunidade.sql.exec('SELECT 1 FROM usuarios WHERE email = ?', emailLimpo).toArray().length > 0;
  const jaPediu = comunidade.sql.exec("SELECT 1 FROM pedidos_acesso WHERE email = ? AND estado = 'pendente'", emailLimpo).toArray().length > 0;
  const filaCheia = comunidade.sql.exec("SELECT COUNT(*) AS n FROM pedidos_acesso WHERE estado = 'pendente'").one().n >= PEDIDOS_PENDENTES_MAXIMOS;
  if (filaCheia) return { erro: 'Muitos pedidos na fila agora. Tente de novo amanhã.' };
  if (!jaTemConta && !jaPediu) {
    comunidade.sql.exec('INSERT INTO pedidos_acesso (indicado_por, como_conhece, email, criado) VALUES (?,?,?,?)',
      indicadoPorLimpo || null, comoConheceLimpo, emailLimpo, agora());
    avisarAdmins(comunidade, { t: 'pedido-novo' });
  }
  return { ok: true };
}

/** Manda uma mensagem para todo admin do app que está conectado (ex.: chegou pedido novo). */
function avisarAdmins(comunidade, mensagem) {
  for (const conexao of comunidade.ctx.getWebSockets()) {
    const anexo = conexao.deserializeAttachment();
    if (anexo && comunidade.membro(anexo.uid)?.admin) comunidade.mandar(conexao, mensagem);
  }
}

/** Para o painel do admin: convites ativos (do app e de convidado) e pedidos (pendentes + últimos 60 dias). */
export function dadosDoAcessoParaOAdmin(comunidade) {
  const momento = agora();
  comunidade.sql.exec('DELETE FROM convites_app WHERE expira < ?', momento - 30 * 86400_000);
  comunidade.sql.exec("DELETE FROM pedidos_acesso WHERE estado <> 'pendente' AND decidido_em < ?", momento - 60 * 86400_000);
  const convitesDoApp = comunidade.sql.exec(`SELECT c.codigo, c.tipo, c.servidor_id AS servidor, c.criado, c.expira, c.usos, c.usos_max AS usosMax,
      c.pedido_id AS pedido, u.nome AS criadoPor
    FROM convites_app c LEFT JOIN usuarios u ON u.id = c.criado_por
    WHERE c.expira > ? AND (c.usos_max = 0 OR c.usos < c.usos_max) ORDER BY c.criado DESC`, momento).toArray()
    .map(convite => ({ ...convite, codigo: codigoParaMostrar(convite.codigo) }));
  const convitesDeConvidado = comunidade.sql.exec(`SELECT c.codigo, 'convidado' AS tipo, c.servidor_id AS servidor, c.criado, c.expira, c.usos,
      c.usos_max AS usosMax, u.nome AS criadoPor
    FROM convites_temp c LEFT JOIN usuarios u ON u.id = c.criado_por
    WHERE c.convidado = 1 AND c.expira > ? AND (c.usos_max = 0 OR c.usos < c.usos_max) ORDER BY c.criado DESC`, momento).toArray();
  const pedidos = comunidade.sql.exec(`SELECT p.id, p.indicado_por AS indicadoPor, p.como_conhece AS comoConhece, p.email, p.criado, p.estado,
      p.decidido_em AS decididoEm, p.erro_email AS erroEmail, u.nome AS decididoPor
    FROM pedidos_acesso p LEFT JOIN usuarios u ON u.id = p.decidido_por ORDER BY (p.estado = 'pendente') DESC, p.criado DESC LIMIT 300`).toArray();
  return { convites: [...convitesDoApp, ...convitesDeConvidado], pedidos };
}

/** Horas e pessoas que o admin escolheu, conferidas (números inteiros dentro do limite). */
function lerDuracaoEUsos(mensagem, horasMaximas) {
  const horas = Math.round(Number(mensagem.horas));
  const usos = Math.round(Number(mensagem.usos));
  if (!(horas >= 1 && horas <= horasMaximas)) return { erro: `A duração tem que ser de 1 hora a ${horasMaximas >= 48 ? `${horasMaximas / 24} dias` : `${horasMaximas} horas`}.` };
  if (!(usos >= 0 && usos <= USOS_MAXIMOS_DO_CONVITE)) return { erro: `Quantas pessoas: de 1 a ${USOS_MAXIMOS_DO_CONVITE} (ou "sem limite").` };
  return { horas, usos };
}

/**
 * Painel do admin → Convites → criar. mensagem: { tipo: app|servidor|codigo|convidado, horas, usos, servidor }.
 * Devolve { codigo } ou { erro }.
 */
export function criarConvite(comunidade, eu, mensagem) {
  const tipo = String(mensagem.tipo);
  const servidorId = Number(mensagem.servidor) || null;
  const servidorExiste = servidorId && comunidade.sql.exec('SELECT 1 FROM servidores WHERE id = ?', servidorId).toArray().length > 0;
  if (tipo === 'convidado') {
    // Convidado: fica na tabela de convites de servidor (convidados.js cuida da entrada).
    const lido = lerDuracaoEUsos(mensagem, HORAS_MAXIMAS_DO_CONVIDADO);
    if (lido.erro) return lido;
    if (!lido.usos) return { erro: 'Convite de convidado precisa de um número de pessoas (1 a 100).' };
    if (!servidorExiste) return { erro: 'Escolha o servidor do convidado.' };
    let codigo;
    do { codigo = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); }
    while (comunidade.sql.exec('SELECT 1 FROM convites_temp WHERE codigo = ?', codigo).toArray().length);
    comunidade.sql.exec('DELETE FROM convites_temp WHERE expira < ?', agora());
    comunidade.sql.exec('INSERT INTO convites_temp (codigo, servidor_id, criado_por, criado, expira, usos_max, convidado) VALUES (?,?,?,?,?,?,1)',
      codigo, servidorId, eu.id, agora(), agora() + lido.horas * 3600_000, lido.usos);
    return { codigo };
  }
  if (!TIPOS_DE_CONVITE_DO_APP.includes(tipo)) return { erro: 'Tipo de convite inválido.' };
  const lido = lerDuracaoEUsos(mensagem, HORAS_MAXIMAS_DO_CONVITE);
  if (lido.erro) return lido;
  if (tipo === 'servidor' && !servidorExiste) return { erro: 'Escolha o servidor em que a pessoa vai entrar.' };
  const ativos = comunidade.sql.exec('SELECT COUNT(*) AS n FROM convites_app WHERE expira > ?', agora()).one().n;
  if (ativos >= 200) return { erro: 'Já tem 200 convites ativos. Apague alguns antes.' };
  const codigo = sortearCodigo(comunidade);
  comunidade.sql.exec('INSERT INTO convites_app (codigo, tipo, servidor_id, criado_por, criado, expira, usos_max) VALUES (?,?,?,?,?,?,?)',
    codigo, tipo, tipo === 'servidor' ? servidorId : null, eu.id, agora(), agora() + lido.horas * 3600_000, lido.usos);
  return { codigo: codigoParaMostrar(codigo) };
}

/** Apaga (cancela) um convite do app ou de convidado. */
export function apagarConvite(comunidade, codigo) {
  const textoDoCodigo = limpar(codigo, 16);
  if (/^\d{6}$/.test(textoDoCodigo)) comunidade.sql.exec('DELETE FROM convites_temp WHERE codigo = ? AND convidado = 1', textoDoCodigo);
  else comunidade.sql.exec('DELETE FROM convites_app WHERE codigo = ?', normalizarCodigo(textoDoCodigo));
}

/**
 * Aprova um pedido: cria um convite de uso único (7 dias) e manda o e-mail com o link de cadastro e os downloads.
 * servidor (opcional): já coloca a pessoa nesse servidor quando ela criar a conta.
 */
export async function aprovarPedido(comunidade, eu, { pedido, servidor }, origem) {
  const linha = comunidade.sql.exec('SELECT * FROM pedidos_acesso WHERE id = ?', Number(pedido)).toArray()[0];
  if (!linha) return { erro: 'Pedido não encontrado.' };
  if (linha.estado === 'recusado') return { erro: 'Esse pedido foi recusado.' };
  const servidorId = Number(servidor) || null;
  if (servidorId && !comunidade.sql.exec('SELECT 1 FROM servidores WHERE id = ?', servidorId).toArray().length) return { erro: 'Servidor não existe.' };
  // Aprovado de novo (ex.: o e-mail falhou): reaproveita o convite se ainda vale.
  let codigo = linha.codigo && conviteDoAppValido(comunidade, linha.codigo) ? linha.codigo : null;
  if (!codigo) {
    codigo = sortearCodigo(comunidade);
    comunidade.sql.exec('INSERT INTO convites_app (codigo, tipo, servidor_id, criado_por, criado, expira, usos_max, pedido_id) VALUES (?,?,?,?,?,?,1,?)',
      codigo, servidorId ? 'servidor' : 'app', servidorId, eu.id, agora(), agora() + HORAS_DO_CONVITE_DO_PEDIDO * 3600_000, linha.id);
  }
  comunidade.sql.exec("UPDATE pedidos_acesso SET estado = 'aprovado', decidido_por = ?, decidido_em = ?, codigo = ?, erro_email = NULL WHERE id = ?",
    eu.id, agora(), codigo, linha.id);
  try {
    await enviarEmail(comunidade.env, {
      para: linha.email,
      assunto: 'Seu acesso ao Caocorde foi aprovado 🎉',
      html: htmlAprovacao({ origem, codigo: codigoParaMostrar(codigo), diasDeValidade: HORAS_DO_CONVITE_DO_PEDIDO / 24 }),
    });
  } catch (erro) {
    comunidade.sql.exec('UPDATE pedidos_acesso SET erro_email = ? WHERE id = ?', limpar(erro.message, 200), linha.id);
    return { erro: `Aprovado, mas o e-mail não foi: ${erro.message}. O código é ${codigoParaMostrar(codigo)} — mande para a pessoa ou tente de novo.` };
  }
  return { ok: true };
}

export function recusarPedido(comunidade, eu, { pedido }) {
  comunidade.sql.exec("UPDATE pedidos_acesso SET estado = 'recusado', decidido_por = ?, decidido_em = ? WHERE id = ? AND estado = 'pendente'",
    eu.id, agora(), Number(pedido));
  return { ok: true };
}
