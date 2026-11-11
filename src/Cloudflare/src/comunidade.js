// Concorde: contas, servidores (no sentido do Discord), canais, mensagens, presença, calls e fila de música.
// Um Durable Object só, com SQLite dentro. Todo mundo conectado por um WebSocket (com hibernação).
import { DurableObject } from 'cloudflare:workers';
import { enviarEmail, htmlRedefinicao } from './email.js';
import { enviarPush } from './fcm.js';
import { hashDoTokenDeSessao, migrarSessoesParaHash } from './sessoes.js';

import { PALETA, USUARIO, EMAIL, agora, limpar, limparEmail, hex, novoConvite, erroSenha, hashSenha, RODADAS_SENHA, iguais, LIMITES, SACANAS } from './utilidades.js';
import { MetodosDaMusica } from './musicaDaCall.js';
import { MetodosDoPainelDoAdmin } from './painelDoAdmin.js';
import * as convidados from './convidados.js';
import * as conversasDiretas from './conversasDiretas.js';
import * as acessoAoApp from './acessoAoApp.js';
import * as amizades from './amizades.js';
import * as cargos from './cargos.js';

const PAGINA = 50;

/** Anexos do chat: até 20 MB, apagados depois de 7 dias. */
const ANEXO_MAX = 20 * 1024 * 1024;
const ANEXO_DIAS = 7;

/** Sessão de login vale 1 ano (igual o cookie de "manter conectado"). */
const SESSAO_MS = 365 * 86400_000;


/** Tipos de anexo aceitos (sem SVG: imagem com script dentro). */
const TIPOS_ANEXO = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|quicktime|ogg|x-matroska)|audio\/(mpeg|mp4|ogg|webm|wav|x-wav|aac|flac|x-m4a|opus))$/;

/**
 * Linha da tabela usuarios → membro como a página recebe. admin vira true/false; convidadoAte (ms) só existe para
 * convidado (a página mostra a etiqueta "convidado" e quanto tempo falta).
 */
function paraMembroDoCliente({ convidado_ate: convidadoAte, ...colunas }) {
  return { ...colunas, admin: !!colunas.admin, ...(convidadoAte ? { convidadoAte } : {}) };
}

/** Canal onde se conversa por texto: canal de texto de servidor ou conversa direta (DM). */
const ehCanalDeConversa = canal => canal.tipo === 'texto' || canal.tipo === conversasDiretas.TIPO_DO_CANAL_DE_CONVERSA_DIRETA;


export class Comunidade extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => { await this.migrar(); });
    // Batimento do app ("ping" a cada 30 s): o Cloudflare responde sozinho, sem acordar o objeto (não gasta),
    // e a conexão não fica parada a ponto de cair.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async migrar() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, nome TEXT NOT NULL,
        hash TEXT NOT NULL, salt TEXT NOT NULL, cor TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, criado INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessoes (token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, criado INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS canais (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, tipo TEXT NOT NULL, posicao INTEGER NOT NULL, criado INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mensagens (id INTEGER PRIMARY KEY, canal_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL,
        texto TEXT NOT NULL, criado INTEGER NOT NULL, editado INTEGER, resposta_id INTEGER, apagado INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS mensagens_canal ON mensagens (canal_id, id);
      CREATE TABLE IF NOT EXISTS servidores (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, icone TEXT, cor TEXT NOT NULL,
        dono_id INTEGER NOT NULL, convite TEXT UNIQUE NOT NULL, criado INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS membros_servidor (servidor_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL,
        admin INTEGER NOT NULL DEFAULT 0, entrou INTEGER NOT NULL, PRIMARY KEY (servidor_id, usuario_id));
      CREATE TABLE IF NOT EXISTS musica_fila (id INTEGER PRIMARY KEY, canal_id INTEGER NOT NULL, consulta TEXT NOT NULL,
        titulo TEXT, duracao INTEGER, por INTEGER NOT NULL, criado INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS musica_tocando (canal_id INTEGER PRIMARY KEY, dados TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS musica_passar (canal_id INTEGER PRIMARY KEY, dados TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS uso_servidor (servidor_id INTEGER NOT NULL, mes TEXT NOT NULL, voz_seg REAL NOT NULL DEFAULT 0,
        tela_seg REAL NOT NULL DEFAULT 0, mb REAL NOT NULL DEFAULT 0, PRIMARY KEY (servidor_id, mes));
      CREATE TABLE IF NOT EXISTS uso_marca (canal_id INTEGER PRIMARY KEY, desde INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS arquivos (chave TEXT PRIMARY KEY, canal_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL,
        nome TEXT NOT NULL, tipo TEXT NOT NULL, tamanho INTEGER NOT NULL, criado INTEGER NOT NULL, mensagem_id INTEGER);
    `);
    const colunas = t => this.sql.exec(`PRAGMA table_info(${t})`).toArray().map(c => c.name);
    if (!colunas('canais').includes('servidor_id')) this.sql.exec(`ALTER TABLE canais ADD COLUMN servidor_id INTEGER NOT NULL DEFAULT ${SACANAS}`);
    if (!colunas('usuarios').includes('banido')) this.sql.exec('ALTER TABLE usuarios ADD COLUMN banido INTEGER NOT NULL DEFAULT 0');
    // 0.5: e-mail de recuperação e "segurança atualizada" (contas antigas passam pela tela de senha nova uma vez).
    if (!colunas('usuarios').includes('email')) this.sql.exec('ALTER TABLE usuarios ADD COLUMN email TEXT');
    if (!colunas('arquivos').includes('mensagem_id')) this.sql.exec('ALTER TABLE arquivos ADD COLUMN mensagem_id INTEGER');
    if (!colunas('mensagens').includes('anexo')) this.sql.exec('ALTER TABLE mensagens ADD COLUMN anexo TEXT');
    if (!colunas('usuarios').includes('avatar')) this.sql.exec('ALTER TABLE usuarios ADD COLUMN avatar INTEGER');   // versão da foto (null = inicial)
    if (!colunas('usuarios').includes('seguranca')) this.sql.exec('ALTER TABLE usuarios ADD COLUMN seguranca INTEGER NOT NULL DEFAULT 0');
    // 0.5.7: senha com 6 rodadas de PBKDF2 (ver hashSenha). Contas antigas ficam com 1 até o próximo login.
    if (!colunas('usuarios').includes('rodadas_senha')) this.sql.exec('ALTER TABLE usuarios ADD COLUMN rodadas_senha INTEGER NOT NULL DEFAULT 1');
    await migrarSessoesParaHash(this.sql, funcao => this.ctx.storage.transactionSync(funcao));
    // 0.5.5: o gasto do mês separado por tipo (o "mb" continua sendo o total).
    for (const col of ['mb_voz', 'mb_cam', 'mb_tela', 'mb_musica'])
      if (!colunas('uso_servidor').includes(col)) this.sql.exec(`ALTER TABLE uso_servidor ADD COLUMN ${col} REAL NOT NULL DEFAULT 0`);
    this.sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email ON usuarios (email);
      CREATE TABLE IF NOT EXISTS convites_temp (codigo TEXT PRIMARY KEY, servidor_id INTEGER NOT NULL, criado_por INTEGER NOT NULL,
        criado INTEGER NOT NULL, expira INTEGER NOT NULL, usos_max INTEGER NOT NULL, usos INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS redefinicoes (token TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, criado INTEGER NOT NULL, expira INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tentativas (chave TEXT PRIMARY KEY, n INTEGER NOT NULL, desde INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sfu_sessoes (sessao TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, criado INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS push_aparelhos (token TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, modo TEXT NOT NULL, atualizado INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS moderacao_voz (servidor_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL, mudo INTEGER NOT NULL, surdo INTEGER NOT NULL,
        por INTEGER NOT NULL, criado INTEGER NOT NULL, PRIMARY KEY (servidor_id, usuario_id));`);

    // Primeira vez com servidores: o que existia vira o servidor "Sacanas", com todo mundo dentro.
    if (this.sql.exec('SELECT COUNT(*) AS n FROM servidores').one().n === 0) {
      const t = agora();
      const dono = this.sql.exec('SELECT id FROM usuarios ORDER BY admin DESC, id LIMIT 1').toArray()[0]?.id ?? 0;
      this.sql.exec('INSERT INTO servidores (id, nome, icone, cor, dono_id, convite, criado) VALUES (?,?,?,?,?,?,?)',
        SACANAS, 'Sacanas', '/img/bg.jpg', '#ef4444', dono, novoConvite(), t);
      this.sql.exec('INSERT OR IGNORE INTO membros_servidor (servidor_id, usuario_id, admin, entrou) SELECT ?, id, admin, criado FROM usuarios', SACANAS);
      if (this.sql.exec('SELECT COUNT(*) AS n FROM canais').one().n === 0) this.canaisPadrao(SACANAS, true);
    }
    // 0.5.9: acesso temporário de convidado (convidados.js).
    convidados.migrarConvidados(this.sql);
    // 0.5.9: mensagens diretas (conversasDiretas.js).
    conversasDiretas.migrarConversasDiretas(this.sql);
    // 0.5.10: convites do app e pedidos de acesso (acessoAoApp.js).
    acessoAoApp.migrarAcessoAoApp(this.sql);
    // 0.5.11: amizades, bloqueio e silenciar por conta (amizades.js).
    amizades.migrarAmizades(this.sql);
    // 0.5.11: cargos dos servidores (cargos.js).
    cargos.migrarCargos(this.sql);
    // O Jorginho virou o logo do Concorde; o ícone do Sacanas é a arte do servidor.
    this.sql.exec("UPDATE servidores SET icone = '/img/bg.jpg' WHERE id = ? AND icone = '/img/jorginho.jpg'", SACANAS);
  }

  canaisPadrao(sid, sacanas = false) {
    const t = agora();
    const lista = sacanas ? [['geral', 'texto'], ['avisos', 'texto'], ['Resenha', 'voz']] : [['geral', 'texto'], ['Geral', 'voz']];
    lista.forEach(([nome, tipo], i) => this.sql.exec('INSERT INTO canais (nome, tipo, posicao, criado, servidor_id) VALUES (?,?,?,?,?)', nome, tipo, i, t, sid));
  }

  // ---------------- contas (chamadas pelo Worker via RPC) ----------------

  /**
   * Convite de SERVIDOR (para quem já tem conta entrar num servidor): código temporário de 6 números (gerado pelo
   * admin do servidor, igual 2FA) ou o link fixo do servidor. Não cria conta (isso é o convite do app,
   * acessoAoApp.js). consumir: conta um uso do código temporário.
   */
  servidorDoConvite(convite, consumir = false) {
    const c = limpar(convite, 64).toLowerCase();
    if (!c) return null;
    const digitos = c.replace(/[\s.-]/g, '');
    if (/^\d{6}$/.test(digitos)) {
      // Código de convidado (convidado = 1) não serve para criar conta: ele só vale na tela de convidado.
      const t = this.sql.exec('SELECT * FROM convites_temp WHERE codigo = ? AND convidado = 0 AND expira > ? AND (usos_max = 0 OR usos < usos_max)', digitos, agora()).toArray()[0];
      if (!t) return null;
      if (consumir) this.sql.exec('UPDATE convites_temp SET usos = usos + 1 WHERE codigo = ?', digitos);
      return t.servidor_id;
    }
    return this.sql.exec('SELECT id FROM servidores WHERE convite = ?', c).toArray()[0]?.id ?? null;
  }

  /** Muitas tentativas erradas com essa chave na janela? */
  bloqueado(chave, [max, janela]) {
    const r = this.sql.exec('SELECT n, desde FROM tentativas WHERE chave = ?', chave).toArray()[0];
    return !!r && r.desde > agora() - janela && r.n >= max;
  }

  errou(chave, [, janela]) {
    const r = this.sql.exec('SELECT desde FROM tentativas WHERE chave = ?', chave).toArray()[0];
    if (r && r.desde > agora() - janela) this.sql.exec('UPDATE tentativas SET n = n + 1 WHERE chave = ?', chave);
    else this.sql.exec('INSERT OR REPLACE INTO tentativas (chave, n, desde) VALUES (?, 1, ?)', chave, agora());
    this.sql.exec('DELETE FROM tentativas WHERE desde < ?', agora() - 86400_000);
  }

  /**
   * Criar conta. Desde a 0.5.10 só com CONVITE DO APP (acessoAoApp.js — o admin do app gera, ou vem no e-mail de
   * pedido aprovado). Convite de servidor não cria conta. A pessoa confirma ter 18 anos ou mais.
   * Conta nova começa sem servidor, a não ser que o convite seja "app + servidor".
   */
  async registrar({ usuario, senha, confirmar, nome, email, convite, conversao, maiorDeIdade }, ip = '') {
    // Convidado virando conta definitiva (pedido do admin): não precisa de código de convite.
    if (conversao && maiorDeIdade !== true) return { erro: 'O Caocorde é só para maiores de 18 anos.' };
    if (conversao) return convidados.converterEmContaDefinitiva(this, { conversao, usuario, senha, confirmar, nome, email });
    usuario = limpar(usuario, 20).toLowerCase();
    nome = limpar(nome, 32) || usuario;
    email = limparEmail(email);
    // Banco vazio (primeira instalação): a primeira conta entra sem convite e vira admin do app.
    const primeiro = this.sql.exec('SELECT COUNT(*) AS n FROM usuarios').one().n === 0;
    if (this.bloqueado(`convite:${ip}`, LIMITES.convite)) return { erro: 'Muitos convites errados. Espere uma hora e tente de novo.' };
    const conviteDoApp = primeiro ? null : acessoAoApp.conviteDoAppValido(this, convite);
    if (!primeiro && !conviteDoApp) { this.errou(`convite:${ip}`, LIMITES.convite); return { erro: 'Código de convite errado ou vencido.' }; }
    if (maiorDeIdade !== true) return { erro: 'O Caocorde é só para maiores de 18 anos.' };
    if (!USUARIO.test(usuario)) return { erro: 'Usuário: 3 a 20 letras minúsculas, números, ponto ou _.' };
    if (!EMAIL.test(email)) return { erro: 'E-mail inválido.' };
    const fraca = erroSenha(senha);
    if (fraca) return { erro: fraca };
    if (confirmar !== undefined && String(confirmar) !== String(senha)) return { erro: 'A confirmação não bate com a senha.' };
    if (this.sql.exec('SELECT 1 FROM usuarios WHERE usuario = ?', usuario).toArray().length) return { erro: 'Esse usuário já existe.' };
    if (this.sql.exec('SELECT 1 FROM usuarios WHERE email = ?', email).toArray().length) return { erro: 'Esse e-mail já tem conta.' };
    const { hash, salt, rodadas } = await hashSenha(String(senha));
    // O convite pode ter sido usado por outra pessoa durante o hash (último uso): confere de novo antes de gravar.
    if (!primeiro && !acessoAoApp.conviteDoAppValido(this, convite)) return { erro: 'Esse convite acabou de ser usado. Peça outro.' };
    if (conviteDoApp) acessoAoApp.consumirConviteDoApp(this, convite);
    const cor = PALETA[Math.floor(Math.random() * PALETA.length)];
    const id = this.sql.exec(`INSERT INTO usuarios (usuario, nome, hash, salt, rodadas_senha, cor, admin, criado, email, seguranca, maior_de_idade_em, entrou_pelo_convite)
      VALUES (?,?,?,?,?,?,?,?,?,1,?,?) RETURNING id`,
      usuario, nome, hash, salt, rodadas, cor, primeiro ? 1 : 0, agora(), email, agora(), conviteDoApp?.codigo || null).one().id;
    if (primeiro) {
      this.sql.exec('UPDATE servidores SET dono_id = ? WHERE id = ?', id, SACANAS);
      this.entrarNoServidor(SACANAS, id, true);
    } else if (conviteDoApp.tipo === 'servidor' && conviteDoApp.servidor_id) {
      this.entrarNoServidor(conviteDoApp.servidor_id, id);
    }
    return { token: await this.novaSessao(id) };
  }

  async entrar({ usuario, senha }, ip = '') {
    usuario = limpar(usuario, 20).toLowerCase();
    // Chutar senha: depois de 10 erros na conta (ou 30 no mesmo IP) em 15 min, espera.
    if (this.bloqueado(`login:${usuario}`, LIMITES.conta) || this.bloqueado(`ip:${ip}`, LIMITES.ip)) {
      return { erro: 'Muitas tentativas erradas. Espere 15 minutos ou use "Esqueci minha senha".' };
    }
    const u = this.sql.exec('SELECT id, hash, salt, rodadas_senha, banido FROM usuarios WHERE usuario = ?', usuario).toArray()[0];
    // Mesmo sem usuário, calcula um hash: a resposta demora igual (não dá para descobrir quem existe pelo tempo).
    const { hash } = await hashSenha(String(senha || ''), u?.salt || '00'.repeat(16), u?.rodadas_senha ?? RODADAS_SENHA);
    if (!u || !iguais(hash, u.hash)) {
      this.errou(`login:${usuario}`, LIMITES.conta);
      this.errou(`ip:${ip}`, LIMITES.ip);
      return { erro: 'Usuário ou senha errados.' };
    }
    if (u.banido) return { erro: 'Essa conta foi bloqueada pelo admin.' };
    this.sql.exec('DELETE FROM tentativas WHERE chave = ?', `login:${usuario}`);
    // Conta com o hash antigo (1 rodada): aproveita que a senha está certa e guarda no padrão novo (ver hashSenha).
    if (u.rodadas_senha < RODADAS_SENHA) {
      const senhaReforcada = await hashSenha(String(senha), u.salt);
      this.sql.exec('UPDATE usuarios SET hash = ?, rodadas_senha = ? WHERE id = ?', senhaReforcada.hash, senhaReforcada.rodadas, u.id);
    }
    return { token: await this.novaSessao(u.id) };
  }

  /** Tela "Tenho um código de convite": o código do app vale? (chamado pelo Worker) */
  validarConviteDoApp(dados, ip = '') { return acessoAoApp.validarConvite(this, dados, ip); }

  /** Download do instalador/APK: no máximo 5 por minuto por endereço (cada um tem 45 a 150 MB). */
  permitirDownload(ip = '') {
    if (this.bloqueado(`download:${ip}`, LIMITES.download)) return false;
    this.errou(`download:${ip}`, LIMITES.download);
    return true;
  }

  /** "Pedir acesso" da página inicial (chamado pelo Worker). */
  pedirAcesso(dados, ip = '') { return acessoAoApp.pedirAcesso(this, dados, ip); }

  /** Tela do convite de convidado: nome do servidor e validade (chamado pelo Worker). */
  informacoesDoConviteDeConvidado(dados, ip = '') { return convidados.informacoesDoConvite(this, dados, ip); }

  /** Entrar como convidado só com o nome (chamado pelo Worker): devolve { token } ou { erro }. */
  entrarComoConvidado(dados, ip = '') { return convidados.entrarComoConvidado(this, dados, ip); }

  async sair(tokenDeSessao) {
    // Convidado que clicou em "Sair": o acesso termina na hora (conta e chat de convidado apagados).
    const usuarioId = await this.usuarioDaSessao(String(tokenDeSessao));
    if (usuarioId && convidados.dadosDoConvidado(this, usuarioId)) return convidados.apagarConvidado(this, usuarioId);
    this.sql.exec('DELETE FROM sessoes WHERE token_hash = ?', await hashDoTokenDeSessao(String(tokenDeSessao)));
  }

  /** A própria conta (com e-mail e se ainda falta a atualização de segurança — só para a própria pessoa). */
  async eu(token) {
    const id = await this.usuarioDaSessao(token);
    if (!id) return null;
    const u = this.sql.exec('SELECT email, seguranca FROM usuarios WHERE id = ?', id).one();
    return { ...this.membro(id), email: u.email, precisaSeguranca: !u.seguranca };
  }

  // ---------------- anexos (imagens, vídeos, áudios — ficam 7 dias no R2) ----------------

  /** Antes de subir para o R2: confere a conta e o canal e reserva a chave do arquivo. */
  async reservarArquivo(token, { canal, nome, tipo, tamanho }) {
    const uid = await this.usuarioDaSessao(token);
    if (!uid) return { erro: 'não logado' };
    const c = this.canalVisivel(uid, Number(canal));
    if (!c || !ehCanalDeConversa(c)) return { erro: 'Canal de texto inválido.' };
    if (!TIPOS_ANEXO.test(tipo)) return { erro: 'Só dá para mandar imagem (PNG, JPG, GIF, WebP), vídeo ou áudio.' };
    if (!(tamanho > 0 && tamanho <= ANEXO_MAX)) return { erro: 'O arquivo tem que ter até 20 MB.' };
    const hoje = this.sql.exec('SELECT COALESCE(SUM(tamanho), 0) AS t FROM arquivos WHERE usuario_id = ? AND criado > ?', uid, agora() - 86400_000).one().t;
    if (hoje + tamanho > 500 * 1024 * 1024) return { erro: 'Limite de 500 MB de arquivos por dia.' };
    const chave = `${agora()}-${crypto.randomUUID()}`;
    this.sql.exec('INSERT INTO arquivos (chave, canal_id, usuario_id, nome, tipo, tamanho, criado) VALUES (?,?,?,?,?,?,?)',
      chave, c.id, uid, limpar(nome, 120) || 'arquivo', tipo, tamanho, agora());
    return { chave };
  }

  /** Pode baixar? Só quem enxerga o canal onde o arquivo foi mandado. */
  async arquivoPermitido(token, chave) {
    const uid = await this.usuarioDaSessao(token);
    const a = uid && this.sql.exec('SELECT canal_id, nome, tipo FROM arquivos WHERE chave = ?', String(chave)).toArray()[0];
    // Arquivo antigo com tipo fora da lista (ex.: SVG) desce como download, nunca aberto como página.
    return a && this.canalVisivel(uid, a.canal_id) ? { nome: a.nome, tipo: TIPOS_ANEXO.test(a.tipo) ? a.tipo : 'application/octet-stream' } : null;
  }

  /** Limpeza diária: tira do banco os arquivos de mais de 7 dias (o Worker apaga do R2). */
  arquivosVencidos() {
    const limite = agora() - ANEXO_DIAS * 86400_000;
    const chaves = this.sql.exec('SELECT chave FROM arquivos WHERE criado < ?', limite).toArray().map(r => r.chave);
    this.sql.exec('DELETE FROM arquivos WHERE criado < ?', limite);
    return chaves;
  }

  // ---------------- foto de perfil (R2: avatar/<id>, um arquivo por pessoa, trocado no lugar) ----------------

  /** Antes de gravar a foto: conta logada e no máximo 10 trocas por hora. Devolve o id ou { erro }. */
  async avatarPermitido(token) {
    const uid = await this.usuarioDaSessao(token);
    if (!uid) return { erro: 'não logado' };
    if (this.bloqueado(`avatar:${uid}`, LIMITES.avatar)) return { erro: 'Muitas trocas de foto. Espere uma hora.' };
    this.errou(`avatar:${uid}`, LIMITES.avatar);   // conta a troca
    return { uid };
  }

  /** Foto gravada (ou removida): nova versão para o cache das imagens e aviso para quem vê a pessoa. */
  avatarTrocado(uid, tem) {
    this.sql.exec('UPDATE usuarios SET avatar = ? WHERE id = ?', tem ? agora() : null, uid);
    this.paraQuemVe(uid, { t: 'membro', membro: this.membro(uid) });
    return this.membro(uid);
  }

  /** Pode ver a foto? A própria, ou de quem divide algum servidor (igual à lista de membros). */
  async avatarVisivel(token, alvo) {
    const uid = await this.usuarioDaSessao(token);
    if (!uid || !this.sql.exec('SELECT 1 FROM usuarios WHERE id = ? AND avatar IS NOT NULL', alvo).toArray().length) return false;
    return uid === alvo || this.sql.exec(`SELECT 1 FROM membros_servidor a JOIN membros_servidor b ON a.servidor_id = b.servidor_id
      WHERE a.usuario_id = ? AND b.usuario_id = ? LIMIT 1`, uid, alvo).toArray().length > 0
      || amizades.pessoasDasRelacoes(this, uid).includes(alvo) || amizades.pessoasDasRelacoes(this, alvo).includes(uid);
  }

  // ---------------- recuperar a senha por e-mail ----------------

  /** Cria o link de senha nova (1 h) e manda para o e-mail da conta. No máximo 1 envio a cada 2 min por conta. */
  async mandarRedefinicao(uid, origem, porAdmin = false) {
    const u = this.sql.exec('SELECT id, nome, email, banido FROM usuarios WHERE id = ?', uid).toArray()[0];
    if (!u?.email || u.banido) return { erro: 'Essa conta não tem e-mail.' };
    const recente = this.sql.exec('SELECT 1 FROM redefinicoes WHERE usuario_id = ? AND criado > ?', uid, agora() - 120_000).toArray().length;
    if (recente && !porAdmin) return { ok: true };   // não manda de novo (evita encher a caixa da pessoa)
    this.sql.exec('DELETE FROM redefinicoes WHERE usuario_id = ? OR expira < ?', uid, agora());
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    // No banco fica só o HASH do link (igual às sessões): quem ler o banco não consegue trocar a senha de ninguém.
    this.sql.exec('INSERT INTO redefinicoes (token, usuario_id, criado, expira) VALUES (?,?,?,?)', await hashDoTokenDeSessao(token), uid, agora(), agora() + 3600_000);
    await enviarEmail(this.env, {
      para: u.email,
      assunto: 'Caocorde — criar senha nova',
      html: htmlRedefinicao(u.nome, `${origem}/concorde?redefinir=${token}`, porAdmin),
    });
    return { ok: true };
  }

  /** "Esqueci minha senha": aceita usuário ou e-mail. Sempre responde igual (não revela quem tem conta). */
  async pedirRedefinicao({ login }, origem, ip = '') {
    // Trava por endereço: ninguém usa o "esqueci a senha" para encher a caixa de e-mail dos outros.
    if (this.bloqueado(`esqueci:${ip}`, LIMITES.esqueci)) return { erro: 'Muitos pedidos de senha nova. Espere uma hora.' };
    this.errou(`esqueci:${ip}`, LIMITES.esqueci);
    const l = limpar(login, 254).toLowerCase();
    const u = this.sql.exec('SELECT id FROM usuarios WHERE usuario = ? OR email = ?', l, l).toArray()[0];
    if (u) {
      try { await this.mandarRedefinicao(u.id, origem); }
      catch (e) { console.log('[email] falhou:', e.message); return { erro: 'Não consegui mandar o e-mail agora. Tente mais tarde ou fale com o admin.' }; }
    }
    return { ok: true };
  }

  /** Link do e-mail: senha nova (padrão forte). Vale uma vez; derruba as sessões antigas. */
  async redefinirSenha({ token, nova, confirmar }) {
    const r = /^[0-9a-f]{64}$/.test(String(token)) && this.sql.exec('SELECT * FROM redefinicoes WHERE token = ? AND expira > ?', await hashDoTokenDeSessao(String(token)), agora()).toArray()[0];
    if (!r) return { erro: 'Esse link venceu ou já foi usado. Peça outro em "Esqueci minha senha".' };
    const fraca = erroSenha(nova);
    if (fraca) return { erro: fraca };
    if (String(confirmar) !== String(nova)) return { erro: 'A confirmação não bate com a senha nova.' };
    const novo = await hashSenha(String(nova));
    this.sql.exec('UPDATE usuarios SET hash = ?, salt = ?, rodadas_senha = ?, seguranca = 1 WHERE id = ?', novo.hash, novo.salt, novo.rodadas, r.usuario_id);
    this.sql.exec('DELETE FROM redefinicoes WHERE usuario_id = ?', r.usuario_id);
    this.sql.exec('DELETE FROM sessoes WHERE usuario_id = ?', r.usuario_id);
    for (const ws of this.socketsDe(r.usuario_id)) ws.close(4001, 'senha trocada');
    return { ok: true };
  }

  /**
   * Atualização de segurança do 0.5 (uma vez por conta antiga): senha nova no padrão forte + e-mail de recuperação.
   * Pede a senha atual (sessão roubada sozinha não basta) e derruba as outras sessões.
   */
  async atualizarSeguranca(token, { atual, nova, confirmar, email }) {
    const id = await this.usuarioDaSessao(token);
    if (!id) return { erro: 'Sessão expirada, entre de novo.' };
    const u = this.sql.exec('SELECT hash, salt, rodadas_senha FROM usuarios WHERE id = ?', id).one();
    if (!iguais((await hashSenha(String(atual || ''), u.salt, u.rodadas_senha)).hash, u.hash)) return { erro: 'Senha atual errada.' };
    email = limparEmail(email);
    if (!EMAIL.test(email)) return { erro: 'E-mail inválido.' };
    const fraca = erroSenha(nova);
    if (fraca) return { erro: fraca };
    if (String(confirmar) !== String(nova)) return { erro: 'A confirmação não bate com a senha nova.' };
    if (String(nova) === String(atual)) return { erro: 'A senha nova tem que ser diferente da antiga.' };
    if (this.sql.exec('SELECT 1 FROM usuarios WHERE email = ? AND id <> ?', email, id).toArray().length) return { erro: 'Esse e-mail já está em outra conta.' };
    const novo = await hashSenha(String(nova));
    this.sql.exec('UPDATE usuarios SET hash = ?, salt = ?, rodadas_senha = ?, email = ?, seguranca = 1 WHERE id = ?', novo.hash, novo.salt, novo.rodadas, email, id);
    await this.apagarOutrasSessoes(id, token);
    return { ok: true };
  }

  /** Cria a sessão de login e devolve o token (vai para o cookie). No banco fica só o hash dele. */
  async novaSessao(usuarioId) {
    this.sql.exec('DELETE FROM sessoes WHERE criado < ?', agora() - SESSAO_MS);
    const tokenDeSessao = hex(crypto.getRandomValues(new Uint8Array(32)));
    this.sql.exec('INSERT INTO sessoes (token_hash, usuario_id, criado) VALUES (?,?,?)', await hashDoTokenDeSessao(tokenDeSessao), usuarioId, agora());
    return tokenDeSessao;
  }

  /** Quem é o dono deste token de sessão (null = token inválido, vencido ou de conta bloqueada). */
  async usuarioDaSessao(tokenDeSessao) {
    if (!tokenDeSessao || !/^[0-9a-f]{64}$/.test(tokenDeSessao)) return null;
    const usuarioId = this.sql.exec(`SELECT sessao.usuario_id AS id FROM sessoes sessao JOIN usuarios usuario ON usuario.id = sessao.usuario_id
      WHERE sessao.token_hash = ? AND usuario.banido = 0 AND sessao.criado > ?`,
      await hashDoTokenDeSessao(tokenDeSessao), agora() - SESSAO_MS).toArray()[0]?.id ?? null;
    // Convidado com o tempo vencido: a sessão só vale enquanto ele continua conectado (não cai no meio da call).
    if (usuarioId && !convidados.sessaoDeConvidadoAindaVale(this, usuarioId)) return null;
    return usuarioId;
  }

  /** Apaga as outras sessões da pessoa (troca de senha): só a do aparelho que trocou continua. */
  async apagarOutrasSessoes(usuarioId, tokenQueFica) {
    this.sql.exec('DELETE FROM sessoes WHERE usuario_id = ? AND token_hash <> ?', usuarioId, await hashDoTokenDeSessao(tokenQueFica || ''));
  }

  // ---------------- Realtime (SFU): cada sessão é de quem criou ----------------

  /** O Worker pergunta antes de repassar: sessao null = criar sessão nova. Devolve o id da pessoa ou null. */
  async sfuPermitido(token, sessao) {
    const uid = await this.usuarioDaSessao(token);
    if (!uid || sessao == null) return uid;
    const dono = this.sql.exec('SELECT usuario_id FROM sfu_sessoes WHERE sessao = ?', String(sessao)).toArray()[0]?.usuario_id;
    return dono === uid ? uid : null;
  }

  sfuCriada(uid, sessao) {
    this.sql.exec('DELETE FROM sfu_sessoes WHERE criado < ?', agora() - 7 * 86400_000);
    this.sql.exec('INSERT OR REPLACE INTO sfu_sessoes (sessao, usuario_id, criado) VALUES (?,?,?)', String(sessao), uid, agora());
  }

  /** admin = admin do app (o painel do app); admin de servidor fica em servidores[].admins. */
  membro(id) {
    const u = this.sql.exec('SELECT id, usuario, nome, cor, admin, avatar, convidado_ate FROM usuarios WHERE id = ?', id).toArray()[0];
    return u ? paraMembroDoCliente(u) : null;
  }

  // ---------------- servidores ----------------

  servidoresDe(uid) { return new Set(this.sql.exec('SELECT servidor_id AS s FROM membros_servidor WHERE usuario_id = ?', uid).toArray().map(r => r.s)); }

  membroDe(sid, uid) { return this.sql.exec('SELECT admin FROM membros_servidor WHERE servidor_id = ? AND usuario_id = ?', sid, uid).toArray()[0] || null; }

  /** Pode mexer no servidor: dono, admin do servidor ou admin do app (que esteja nele). */
  adminDe(sid, uid) {
    const s = this.sql.exec('SELECT dono_id FROM servidores WHERE id = ?', sid).toArray()[0];
    const m = this.membroDe(sid, uid);
    if (!s || !m) return false;
    return s.dono_id === uid || !!m.admin || !!this.membro(uid)?.admin;
  }

  servidorParaCliente(sid, uid) {
    const s = this.sql.exec('SELECT * FROM servidores WHERE id = ?', sid).toArray()[0];
    if (!s) return null;
    const ms = this.sql.exec('SELECT usuario_id AS u, admin FROM membros_servidor WHERE servidor_id = ? ORDER BY entrou', sid).toArray();
    const admin = this.adminDe(sid, uid);
    const permissoes = cargos.permissoesNoServidor(this, sid, uid);
    const podeConvidar = (permissoes & cargos.PERMISSOES.convidar) !== 0;
    return {
      id: s.id, nome: s.nome, icone: s.icone, cor: s.cor, dono: s.dono_id,
      membros: ms.map(m => m.u), admins: ms.filter(m => m.admin).map(m => m.u),
      admin, permissoes, ...cargos.cargosParaCliente(this, sid),
      convite: podeConvidar ? s.convite : null,
      codigos: podeConvidar ? this.sql.exec('SELECT codigo, expira, usos, usos_max, convidado FROM convites_temp WHERE servidor_id = ? AND expira > ? AND (usos_max = 0 OR usos < usos_max) ORDER BY criado DESC', sid, agora()).toArray() : [],
    };
  }

  servidoresParaCliente(uid) {
    return [...this.servidoresDe(uid)].sort((a, b) => a - b).map(sid => this.servidorParaCliente(sid, uid)).filter(Boolean);
  }

  entrarNoServidor(sid, uid, admin = false) {
    this.sql.exec('INSERT OR IGNORE INTO membros_servidor (servidor_id, usuario_id, admin, entrou) VALUES (?,?,?,?)', sid, uid, admin ? 1 : 0, agora());
    this.atualizarTodos();
  }

  /** Mudou servidor/membros/canais: cada conexão recebe a própria lista de novo (são poucas pessoas). */
  atualizarTodos() {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a) continue;
      this.mandar(ws, { t: 'servidores', servidores: this.servidoresParaCliente(a.uid), canais: this.canaisDe(a.uid), membros: this.membrosVisiveis(a.uid) });
    }
    this.avisarVoz();
  }

  mexerServidor(ws, eu, m) {
    if (m.t === 'servidor-criar') {
      const nome = limpar(m.nome, 40);
      if (!nome) return this.erro(ws, 'Dá um nome para o servidor.');
      if (this.sql.exec('SELECT COUNT(*) AS n FROM servidores WHERE dono_id = ?', eu.id).one().n >= 10) return this.erro(ws, 'Limite de 10 servidores por pessoa.');
      const cor = PALETA.includes(m.cor) ? m.cor : PALETA[Math.floor(Math.random() * PALETA.length)];
      const sid = this.sql.exec('INSERT INTO servidores (nome, icone, cor, dono_id, convite, criado) VALUES (?,?,?,?,?,?) RETURNING id',
        nome, limpar(m.icone, 8) || null, cor, eu.id, novoConvite(), agora()).one().id;
      this.canaisPadrao(sid);
      this.entrarNoServidor(sid, eu.id, true);
      return this.mandar(ws, { t: 'servidor-aberto', id: sid });
    }
    if (m.t === 'servidor-entrar') {
      if (this.bloqueado(`convite:u${eu.id}`, LIMITES.convite)) return this.erro(ws, 'Muitos convites errados. Espere uma hora.');
      const sid = this.servidorDoConvite(m.convite, true);
      if (!sid) { this.errou(`convite:u${eu.id}`, LIMITES.convite); return this.erro(ws, 'Convite inválido.'); }
      if (!this.membroDe(sid, eu.id)) this.entrarNoServidor(sid, eu.id);
      return this.mandar(ws, { t: 'servidor-aberto', id: sid });
    }

    const sid = Number(m.id);
    const s = this.sql.exec('SELECT * FROM servidores WHERE id = ?', sid).toArray()[0];
    if (!s || !this.membroDe(sid, eu.id)) return this.erro(ws, 'Servidor não encontrado.');

    if (m.t === 'servidor-sair') {
      if (s.dono_id === eu.id) return this.erro(ws, 'O dono não pode sair — passe o servidor para outra pessoa ou apague.');
      this.tirarDoServidor(sid, eu.id);
      return;
    }
    // Cada ação pede a sua permissão (cargos.js). Dono, admin do servidor e admin do app podem tudo.
    const permissaoNecessaria = {
      'servidor-editar': cargos.PERMISSOES.editarServidor, 'servidor-convite-novo': cargos.PERMISSOES.convidar,
      'codigo-criar': cargos.PERMISSOES.convidar, 'codigo-apagar': cargos.PERMISSOES.convidar,
      'servidor-membro': m.acao === 'expulsar' ? cargos.PERMISSOES.expulsar : cargos.TODAS_AS_PERMISSOES,
      'servidor-apagar': cargos.TODAS_AS_PERMISSOES,
    }[m.t] ?? cargos.TODAS_AS_PERMISSOES;
    if (!cargos.pode(this, sid, eu.id, permissaoNecessaria)) return this.erro(ws, 'Você não tem permissão para isso neste servidor.');

    switch (m.t) {
      case 'servidor-editar': {
        const nome = limpar(m.nome, 40) || s.nome;
        const cor = PALETA.includes(m.cor) ? m.cor : s.cor;
        const icone = sid === SACANAS ? s.icone : (limpar(m.icone, 8) || null);
        this.sql.exec('UPDATE servidores SET nome = ?, cor = ?, icone = ? WHERE id = ?', nome, cor, icone, sid);
        break;
      }
      case 'servidor-convite-novo':
        this.sql.exec('UPDATE servidores SET convite = ? WHERE id = ?', novoConvite(), sid);
        break;
      case 'codigo-criar': {
        // Código de 6 números (igual 2FA): vence e tem limite de usos.
        //  - normal: coloca no servidor quem JÁ TEM conta (desde a 0.5.10 não cria conta — ver acessoAoApp.js);
        //  - convidado (m.convidado): acesso temporário sem criar conta, só pelo navegador (1 a 24 horas).
        const ehDeConvidado = !!m.convidado;
        const duracoesPermitidas = ehDeConvidado ? convidados.DURACOES_DO_CONVITE_DE_CONVIDADO_EM_HORAS : [1, 3, 6, 12, 24, 168];
        const horas = duracoesPermitidas.includes(Number(m.horas)) ? Number(m.horas) : (ehDeConvidado ? 3 : 24);
        const usos = [1, 5, 0].includes(Number(m.usos)) ? Number(m.usos) : 1;
        if (this.sql.exec('SELECT COUNT(*) AS n FROM convites_temp WHERE servidor_id = ? AND expira > ?', sid, agora()).one().n >= 20) return this.erro(ws, 'Máximo de 20 códigos ativos por servidor.');
        let codigo;
        do { codigo = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); }
        while (this.sql.exec('SELECT 1 FROM convites_temp WHERE codigo = ?', codigo).toArray().length);
        this.sql.exec('DELETE FROM convites_temp WHERE expira < ?', agora());
        this.sql.exec('INSERT INTO convites_temp (codigo, servidor_id, criado_por, criado, expira, usos_max, convidado) VALUES (?,?,?,?,?,?,?)',
          codigo, sid, eu.id, agora(), agora() + horas * 3600_000, usos, ehDeConvidado ? 1 : 0);
        break;
      }
      case 'codigo-apagar':
        this.sql.exec('DELETE FROM convites_temp WHERE codigo = ? AND servidor_id = ?', limpar(m.codigo, 6), sid);
        break;
      case 'servidor-membro': {
        const alvo = Number(m.uid);
        if (!this.membroDe(sid, alvo)) return this.erro(ws, 'Essa pessoa não está no servidor.');
        if (alvo === s.dono_id) return this.erro(ws, 'Não dá para mexer no dono do servidor.');
        // Quem expulsa pelo cargo (não é admin) não tira admin do servidor.
        if (m.acao === 'expulsar' && !this.adminDe(sid, eu.id) && this.adminDe(sid, alvo)) return this.erro(ws, 'Só admin tira outro admin do servidor.');
        if (m.acao === 'expulsar') { this.tirarDoServidor(sid, alvo); return; }
        if (m.acao === 'admin' || m.acao === 'tirar-admin') {
          this.sql.exec('UPDATE membros_servidor SET admin = ? WHERE servidor_id = ? AND usuario_id = ?', m.acao === 'admin' ? 1 : 0, sid, alvo);
        }
        if (m.acao === 'dono') {
          if (s.dono_id !== eu.id && !eu.admin) return this.erro(ws, 'Só o dono passa o servidor.');
          this.sql.exec('UPDATE servidores SET dono_id = ? WHERE id = ?', alvo, sid);
          this.sql.exec('UPDATE membros_servidor SET admin = 1 WHERE servidor_id = ? AND usuario_id IN (?, ?)', sid, alvo, eu.id);
        }
        break;
      }
      case 'servidor-apagar':
        if (s.dono_id !== eu.id && !eu.admin) return this.erro(ws, 'Só o dono apaga o servidor.');
        if (sid === SACANAS) return this.erro(ws, 'O Sacanas não pode ser apagado.');
        this.apagarServidor(sid);
        return;
      default: return;
    }
    this.atualizarTodos();
  }

  tirarDoServidor(sid, uid) {
    // Convidado expulso (ou saindo): a conta temporária é apagada na hora, com o chat temporário.
    if (convidados.dadosDoConvidado(this, uid)) return convidados.apagarConvidado(this, uid);
    this.sql.exec('DELETE FROM membros_servidor WHERE servidor_id = ? AND usuario_id = ?', sid, uid);
    cargos.tirarCargosDoMembro(this, sid, uid);
    // Sai da call se estava num canal de voz desse servidor.
    for (const ws of this.socketsDe(uid)) {
      const a = ws.deserializeAttachment();
      if (a?.voz && this.canal(a.voz.canal)?.servidor_id === sid) { delete a.voz; ws.serializeAttachment(a); this.mandar(ws, { t: 'voz-expulso', motivo: 'servidor' }); }
    }
    this.atualizarTodos();
  }

  apagarServidor(sid) {
    const canais = this.sql.exec('SELECT id FROM canais WHERE servidor_id = ?', sid).toArray().map(c => c.id);
    for (const c of canais) {
      this.sql.exec('DELETE FROM mensagens WHERE canal_id = ?', c);
      this.sql.exec('DELETE FROM musica_fila WHERE canal_id = ?', c);
      this.sql.exec('DELETE FROM musica_tocando WHERE canal_id = ?', c);
    }
    this.sql.exec('DELETE FROM canais WHERE servidor_id = ?', sid);
    this.sql.exec('DELETE FROM moderacao_voz WHERE servidor_id = ?', sid);
    cargos.apagarCargosDoServidor(this, sid);
    const membros = this.sql.exec('SELECT usuario_id AS u FROM membros_servidor WHERE servidor_id = ?', sid).toArray().map(r => r.u);
    this.sql.exec('DELETE FROM membros_servidor WHERE servidor_id = ?', sid);
    this.sql.exec('DELETE FROM servidores WHERE id = ?', sid);
    for (const uid of membros) for (const ws of this.socketsDe(uid)) {
      const a = ws.deserializeAttachment();
      if (a?.voz && canais.includes(a.voz.canal)) { delete a.voz; ws.serializeAttachment(a); this.mandar(ws, { t: 'voz-expulso', motivo: 'servidor' }); }
    }
    this.atualizarTodos();
  }

  // ---------------- WebSocket ----------------

  async fetch(req) {
    const uid = await this.usuarioDaSessao(req.headers.get('X-Sessao'));
    if (!uid) return new Response('sessão inválida', { status: 401 });
    this.origem = new URL(req.url).origin;
    if (!this.sql.exec('SELECT seguranca FROM usuarios WHERE id = ?', uid).one().seguranca) return new Response('atualize a segurança', { status: 403 });
    const [client, server] = Object.values(new WebSocketPair());
    const jaOnline = this.socketsDe(uid).length > 0;
    this.ctx.acceptWebSocket(server, [`u${uid}`]);
    server.serializeAttachment({ uid, token: req.headers.get('X-Sessao'), estado: 'online', ultimo: 0, digitou: 0, desde: agora() });
    convidados.aoConectarConvidado(this, uid);   // convidado que voltou dentro da tolerância não é apagado
    server.send(JSON.stringify({
      t: 'pronto',
      eu: this.membro(uid),
      servidores: this.servidoresParaCliente(uid),
      membros: this.membrosVisiveis(uid),
      canais: this.canaisDe(uid),
      presencas: this.presencas(uid),
      voz: this.estadoVoz(uid),
      musica: this.musicaDe(uid),
      aviso: (await this.ctx.storage.get('aviso-geral')) || null,
      relacoes: amizades.relacoesDe(this, uid),
    }));
    if (!jaOnline) this.paraQuemVe(uid, { t: 'presenca', uid, estado: 'online' });
    return new Response(null, { status: 101, webSocket: client });
  }

  socketsDe(uid) { return this.ctx.getWebSockets(`u${uid}`); }

  /** Quem aparece para esta pessoa: quem divide algum servidor com ela, os amigos, os pedidos, os bloqueados e quem tem DM com ela. */
  membrosVisiveis(uid) {
    return this.sql.exec(`SELECT DISTINCT u.id, u.usuario, u.nome, u.cor, u.admin, u.avatar, u.convidado_ate FROM usuarios u
      WHERE u.id = ? OR u.id IN (SELECT usuario_id FROM membros_servidor WHERE servidor_id IN (SELECT servidor_id FROM membros_servidor WHERE usuario_id = ?))
        OR u.id IN (SELECT CASE WHEN usuario_menor = ? THEN usuario_maior ELSE usuario_menor END FROM amizades WHERE usuario_menor = ? OR usuario_maior = ?)
        OR u.id IN (SELECT bloqueado_id FROM bloqueios WHERE usuario_id = ?)
        OR u.id IN (SELECT CASE WHEN usuario_menor = ? THEN usuario_maior ELSE usuario_menor END FROM conversas_diretas WHERE usuario_menor = ? OR usuario_maior = ?)
      ORDER BY u.nome`, uid, uid, uid, uid, uid, uid, uid, uid, uid)
      .toArray().map(paraMembroDoCliente);
  }

  /** Quem está online/ausente. paraUid: só as pessoas que essa conta enxerga (não vaza presença de estranhos). */
  presencas(paraUid = null) {
    const visiveis = paraUid == null ? null : new Set([paraUid, ...this.membrosVisiveis(paraUid).map(membro => membro.id)]);
    const p = {};
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a || (visiveis && !visiveis.has(a.uid))) continue;
      // Com dois aparelhos abertos, vale o "mais presente".
      if (p[a.uid] !== 'online') p[a.uid] = a.estado;
    }
    return p;
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const a = ws.deserializeAttachment();
    const t = agora();
    // Anti-flood: no máximo ~6 ações por segundo por conexão (digitando, call e música têm o próprio ritmo).
    // "historico" também fica de fora: só lê, e a página pede logo depois de abrir uma conversa (barrar deixava o
    // chat carregando para sempre).
    if (m.t !== 'digitando' && m.t !== 'fundo' && m.t !== 'historico' && !m.t?.startsWith('push') && !m.t?.startsWith('voz-') && !m.t?.startsWith('musica-') && t - a.ultimo < 150) return this.erro(ws, 'Calma aí, devagar 😅');
    a.ultimo = t;
    ws.serializeAttachment(a);
    const eu = this.membro(a.uid);
    if (!eu) return ws.close(4001, 'conta removida');
    // Convidado: só chat (no chat temporário dele), call e música. Criar servidor, canal, convite, senha... não.
    if (eu.convidadoAte && !convidados.acaoPermitidaAoConvidado(m.t)) return this.erro(ws, 'Convidado não pode fazer isso.');

    switch (m.t) {
      case 'convidado-converter': return convidados.pedirConversao(this, ws, eu, m);
      case 'direta-abrir': return conversasDiretas.abrirConversaDireta(this, ws, eu, m);
      case 'amizade-pedir': case 'amizade-aceitar': case 'amizade-remover': case 'bloquear': case 'desbloquear':
      case 'silenciar-conta': case 'dessilenciar-conta':
        return amizades.tratarAcaoDeAmizade(this, ws, eu, m);
      case 'cargo-criar': case 'cargo-editar': case 'cargo-apagar': case 'cargo-dar': case 'cargo-tirar':
        if (cargos.tratarAcaoDeCargo(this, ws, eu, m)) this.atualizarTodos();
        return;
      case 'historico': return this.enviarHistorico(ws, eu, Number(m.canal), Number(m.antes) || null);
      case 'enviar': return this.novaMensagem(ws, eu, m);
      case 'editar': return this.editarMensagem(ws, eu, m);
      case 'apagar': return this.apagarMensagem(ws, eu, m);
      case 'digitando': {
        if (t - a.digitou < 2500) return;
        a.digitou = t;
        ws.serializeAttachment(a);
        const c = this.canalVisivel(eu.id, Number(m.canal));
        return c && this.paraCanal(c, { t: 'digitando', canal: c.id, uid: eu.id }, ws);
      }
      // Celular: avisos com o app fechado (Firebase). O app manda o "endereço" do aparelho e o que a pessoa quer receber.
      case 'push': {
        const token = limpar(m.token, 512);
        if (!token) return;
        const modo = ['todas', 'mencoes', 'nenhuma'].includes(m.modo) ? m.modo : 'todas';
        this.sql.exec('INSERT OR REPLACE INTO push_aparelhos (token, usuario_id, modo, atualizado) VALUES (?,?,?,?)', token, eu.id, modo, t);
        return;
      }
      case 'push-sair':   // saiu da conta neste celular: para de mandar aviso para ele
        this.sql.exec('DELETE FROM push_aparelhos WHERE token = ? AND usuario_id = ?', limpar(m.token, 512), eu.id);
        return;
      case 'fundo':       // app do celular foi para segundo plano (ou voltou)
        a.fundo = !!m.sim;
        ws.serializeAttachment(a);
        return;
      case 'presenca': {
        a.estado = m.estado === 'ausente' ? 'ausente' : 'online';
        ws.serializeAttachment(a);
        return this.paraQuemVe(eu.id, { t: 'presenca', uid: eu.id, estado: this.presencas()[eu.id] });
      }
      case 'perfil': {
        const nome = limpar(m.nome, 32);
        if (!nome) return this.erro(ws, 'Nome vazio.');
        this.sql.exec('UPDATE usuarios SET nome = ? WHERE id = ?', nome, eu.id);
        return this.paraQuemVe(eu.id, { t: 'membro', membro: this.membro(eu.id) });
      }
      case 'senha': return this.trocarSenha(ws, eu, m);
      case 'canal-criar': case 'canal-renomear': case 'canal-apagar': return this.mexerCanal(ws, eu, m);
      case 'servidor-criar': case 'servidor-entrar': case 'servidor-sair': case 'servidor-editar':
      case 'servidor-convite-novo': case 'servidor-membro': case 'servidor-apagar': case 'codigo-criar': case 'codigo-apagar':
        return this.mexerServidor(ws, eu, m);
      case 'voz-entrar': return this.entrarVoz(ws, a, eu, m);
      case 'voz-estado': return this.mudarVoz(ws, a, m);
      case 'voz-stats': return this.statsTransmissao(ws, a, m.s);
      case 'voz-sair':
        if (!a.voz) return;
        this.tirarDaCall(ws, a);
        return this.avisarVoz();
      case 'voz-moderar': return this.moderarVoz(ws, eu, m);
      case 'musica-add': case 'musica-pular': case 'musica-parar': case 'musica-remover':
      case 'musica-pausar': case 'musica-dj': case 'musica-fim': case 'musica-erro': case 'musica-passar': case 'musica-expandir':
        return this.mexerMusica(ws, a, eu, m);
      case 'admin-dados': case 'admin-acao':
        if (!eu.admin) return this.erro(ws, 'Só o admin do app.');
        return m.t === 'admin-dados' ? this.adminDados(ws) : this.adminAcao(ws, eu, m);
    }
  }

  async webSocketClose(ws) {
    const a = ws.deserializeAttachment();
    try { ws.close(); } catch { }
    if (a && this.socketsDe(a.uid).filter(s => s !== ws).length === 0) this.paraQuemVe(a.uid, { t: 'presenca', uid: a.uid, estado: 'offline' });
    if (a?.voz) { this.contarUso(a.voz.canal, a); this.liberarDj(a.uid, a.voz.canal); this.avisarVoz(); }
    // Convidado que fechou a página: apaga (na hora, se o tempo acabou; senão depois da tolerância de 2 min).
    if (a) await convidados.aoDesconectarConvidado(this, a.uid, ws);
  }

  async webSocketError(ws) { await this.webSocketClose(ws); }

  async trocarSenha(ws, eu, m) {
    const u = this.sql.exec('SELECT hash, salt, rodadas_senha FROM usuarios WHERE id = ?', eu.id).one();
    const { hash } = await hashSenha(String(m.atual || ''), u.salt, u.rodadas_senha);
    if (!iguais(hash, u.hash)) return this.erro(ws, 'Senha atual errada.');
    const fraca = erroSenha(m.nova);
    if (fraca) return this.erro(ws, fraca);
    const novo = await hashSenha(String(m.nova));
    this.sql.exec('UPDATE usuarios SET hash = ?, salt = ?, rodadas_senha = ?, seguranca = 1 WHERE id = ?', novo.hash, novo.salt, novo.rodadas, eu.id);
    // Quem estava com a sessão de outro aparelho (inclusive alguém que pegou a conta) cai. Este aparelho continua.
    const minha = ws.deserializeAttachment()?.token || '';
    await this.apagarOutrasSessoes(eu.id, minha);
    for (const s of this.socketsDe(eu.id)) if (s.deserializeAttachment()?.token !== minha) s.close(4001, 'senha trocada');
    this.mandar(ws, { t: 'ok', texto: 'Senha trocada ✓ (os outros aparelhos saíram da conta)' });
  }

  // ---------------- voz (a mídia vai pelo Cloudflare Realtime; aqui só fica quem está em qual call e o que publica) ----------------

  /** canal → [{ uid, sessao, mudo, surdo, app, trilhas }] — só dos servidores da pessoa. */
  estadoVoz(uid) {
    const meus = this.servidoresDe(uid);
    const visivel = new Map();
    const voz = {};
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a?.voz || ws.readyState !== 1) continue;
      if (!visivel.has(a.voz.canal)) visivel.set(a.voz.canal, meus.has(this.canal(a.voz.canal)?.servidor_id));
      // Junto com o estado da pessoa vai o mute imposto por admin (o aparelho de cada um aplica: voz.js).
      if (visivel.get(a.voz.canal)) (voz[a.voz.canal] ||= []).push({ uid: a.uid, ...a.voz, ...this.moderacaoDe(this.canal(a.voz.canal)?.servidor_id, a.uid) });
    }
    return voz;
  }

  /** Tira esta conexão da call em que ela está (sair, desconectado por admin). Quem chama avisa todo mundo depois. */
  tirarDaCall(ws, sessaoDaConexao) {
    const canalQueSaiu = sessaoDaConexao.voz.canal;
    this.contarUso(canalQueSaiu);
    delete sessaoDaConexao.voz;
    ws.serializeAttachment(sessaoDaConexao);
    this.liberarDj(sessaoDaConexao.uid, canalQueSaiu);
  }

  /** Mute imposto por admin desta pessoa neste servidor: { mutadoPeloAdmin, ensurdecidoPeloAdmin } (false se não tem). */
  moderacaoDe(servidorId, usuarioId) {
    const linha = this.sql.exec('SELECT mudo, surdo FROM moderacao_voz WHERE servidor_id = ? AND usuario_id = ?', servidorId, usuarioId).toArray()[0];
    return { mutadoPeloAdmin: !!linha?.mudo, ensurdecidoPeloAdmin: !!linha?.surdo };
  }

  /**
   * Moderação de voz, pelo menu da pessoa (clique direito). Só admin do servidor (ou do app) e nunca no dono do
   * servidor (a não ser que seja o próprio dono ou o admin do app). Ações:
   *   mutar / desmutar           — microfone da pessoa mudo para o servidor todo;
   *   ensurdecer / desensurdecer — a pessoa para de ouvir a call;
   *   desconectar                — tira só da call (ela continua no servidor e pode voltar).
   * O mute fica guardado por servidor (vale se ela sair e entrar de novo, igual o Discord) até um admin tirar.
   * Quem garante o silêncio são os aparelhos dos OUTROS: eles zeram o volume de quem está mutado pelo admin
   * (voz.js → aplicarVolumes), então nem um app adulterado da pessoa mutada consegue ser ouvido.
   */
  moderarVoz(ws, eu, m) {
    const alvoId = Number(m.uid);
    const conexaoDoAlvoNaCall = this.socketsDe(alvoId).find(conexao => conexao.deserializeAttachment()?.voz);
    if (!conexaoDoAlvoNaCall) return this.erro(ws, 'Essa pessoa não está numa call.');
    const canalDoAlvo = conexaoDoAlvoNaCall.deserializeAttachment().voz.canal;
    const servidorId = this.canal(canalDoAlvo)?.servidor_id;
    const servidor = this.sql.exec('SELECT dono_id FROM servidores WHERE id = ?', servidorId).toArray()[0];
    if (!servidor || !cargos.pode(this, servidorId, eu.id, cargos.PERMISSOES.moderarVoz)) return this.erro(ws, 'Só admin do servidor (ou cargo com "moderar a call") pode moderar a call.');
    if (alvoId === eu.id) return this.erro(ws, 'Para você mesmo, use os botões de mutar da call.');
    if (alvoId === servidor.dono_id && !eu.admin) return this.erro(ws, 'Não dá para moderar o dono do servidor.');
    if (!this.adminDe(servidorId, eu.id) && this.adminDe(servidorId, alvoId)) return this.erro(ws, 'Só admin modera outro admin.');

    const nomeDoAlvo = this.membro(alvoId)?.nome || 'a pessoa';
    if (m.acao === 'desconectar') {
      for (const conexao of this.socketsDe(alvoId)) {
        const sessaoDaConexao = conexao.deserializeAttachment();
        if (!sessaoDaConexao?.voz) continue;
        this.tirarDaCall(conexao, sessaoDaConexao);
        this.mandar(conexao, { t: 'voz-expulso', motivo: 'admin', por: eu.nome });
      }
      this.mandar(ws, { t: 'ok', texto: `${nomeDoAlvo} foi desconectado(a) da call.` });
      return this.avisarVoz();
    }

    const atual = this.moderacaoDe(servidorId, alvoId);
    const novoMudo = { mutar: true, desmutar: false }[m.acao] ?? atual.mutadoPeloAdmin;
    const novoSurdo = { ensurdecer: true, desensurdecer: false }[m.acao] ?? atual.ensurdecidoPeloAdmin;
    if (!['mutar', 'desmutar', 'ensurdecer', 'desensurdecer'].includes(m.acao)) return this.erro(ws, 'Ação de moderação desconhecida.');
    if (novoMudo || novoSurdo) {
      this.sql.exec('INSERT OR REPLACE INTO moderacao_voz (servidor_id, usuario_id, mudo, surdo, por, criado) VALUES (?,?,?,?,?,?)',
        servidorId, alvoId, novoMudo ? 1 : 0, novoSurdo ? 1 : 0, eu.id, agora());
    } else {
      this.sql.exec('DELETE FROM moderacao_voz WHERE servidor_id = ? AND usuario_id = ?', servidorId, alvoId);
    }
    this.avisarVoz();
  }

  avisarVoz() {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a) this.mandar(ws, { t: 'voz', voz: this.estadoVoz(a.uid) });
    }
  }

  entrarVoz(ws, a, eu, m) {
    const c = this.canalVisivel(eu.id, Number(m.canal));
    if (!c || c.tipo !== 'voz') return this.erro(ws, 'Canal de voz inválido.');
    // Uma call por pessoa: entrar de outro aparelho tira a call do anterior (igual Discord).
    for (const outro of this.socketsDe(a.uid)) {
      const b = outro.deserializeAttachment();
      if (outro !== ws && b?.voz) { delete b.voz; outro.serializeAttachment(b); this.mandar(outro, { t: 'voz-expulso' }); }
    }
    if (a.voz) this.contarUso(a.voz.canal);
    this.contarUso(c.id);
    if (a.voz && a.voz.canal !== c.id) this.liberarDj(a.uid, a.voz.canal);
    a.voz = { canal: c.id, sessao: limpar(m.sessao, 100), mudo: !!m.mudo, surdo: !!m.surdo, app: !!m.app, entrou: agora(), trilhas: this.trilhas(m.trilhas) };
    ws.serializeAttachment(a);
    this.avisarVoz();
  }

  mudarVoz(ws, a, m) {
    if (!a.voz) return;
    this.contarUso(a.voz.canal);
    a.voz = { ...a.voz, mudo: !!m.mudo, surdo: !!m.surdo, trilhas: this.trilhas(m.trilhas) };
    ws.serializeAttachment(a);
    this.avisarVoz();
  }

  /**
   * Painel "Estatísticas" da transmissão: quem transmite manda os números do envio (a cada ~2 s) e vai só para quem
   * está na mesma call e é admin do app. Só números e alguns textos curtos conhecidos; no máximo um a cada 1,5 s por conexão.
   */
  statsTransmissao(ws, a, s) {
    if (!a.voz || !(a.voz.trilhas?.tela || a.voz.trilhas?.telaSessao) || typeof s !== 'object' || !s) return;
    const t = agora();
    if (t - (a.stats || 0) < 1500) return;
    a.stats = t;
    ws.serializeAttachment(a);
    const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v * 10) / 10)) : null);
    const limpo = {
      fps: num(s.fps, 500), alvoFps: num(s.alvoFps, 500), kbps: num(s.kbps, 200000), perda: num(s.perda, 100),
      jitterMs: num(s.jitterMs, 10000), pingMs: num(s.pingMs, 10000), cpu: num(s.cpu, 100),
      largura: num(s.largura, 10000), altura: num(s.altura, 10000),
      maiorKb: num(s.maiorKb, 100000), filaMs: num(s.filaMs, 600000),
      limite: ['cpu', 'bandwidth', 'other', 'none'].includes(s.limite) ? s.limite : null,
      encoder: limpar(s.encoder, 40) || null, origem: s.origem === 'app' ? 'app' : 'navegador',
      qualidade: limpar(s.qualidade, 80) || null,
    };
    const msg = JSON.stringify({ t: 'voz-stats', uid: a.uid, s: limpo });
    const admins = {};   // o painel é só para os admins do app
    for (const outro of this.ctx.getWebSockets()) {
      const o = outro.deserializeAttachment();
      if (outro !== ws && o?.voz?.canal === a.voz.canal && (admins[o.uid] ??= !!this.membro(o.uid)?.admin)) { try { outro.send(msg); } catch { } }
    }
  }

  /** Nomes das trilhas publicadas no SFU (null = desligada). */
  trilhas(t = {}) {
    const nome = v => (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v) ? v : null);
    // telaSessao: transmissão pela captura nativa do app desktop, que tem sessão própria no SFU.
    const sessao = typeof t.telaSessao === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(t.telaSessao) ? t.telaSessao : null;
    return { mic: nome(t.mic), cam: nome(t.cam), tela: nome(t.tela), telaAudio: nome(t.telaAudio), telaSessao: sessao, telaInfo: limpar(t.telaInfo, 60) || null };
  }

  /**
   * Uso de cada servidor no mês, para o gráfico do admin do app. Chamado antes de qualquer mudança na call:
   * soma o tempo desde a última marca com quem estava lá. O consumo do Cloudflare é o que SAI do SFU para cada
   * pessoa, então a estimativa é: cada um recebe a voz dos outros (~40 kbps), cada câmera (~1,2 Mbps) e cada
   * transmissão (~3,2 Mbps) vão para todos os outros, e a música (~128 kbps) para todos.
   */
  contarUso(canal, saindo = null) {
    const agoraMs = agora();
    const marca = this.sql.exec('SELECT desde FROM uso_marca WHERE canal_id = ?', canal).toArray()[0]?.desde;
    const pessoas = this.naCall(canal);
    if (saindo && !pessoas.includes(saindo)) pessoas.push(saindo);   // o socket que fechou ainda conta até agora
    if (pessoas.length) this.sql.exec('INSERT OR REPLACE INTO uso_marca (canal_id, desde) VALUES (?,?)', canal, agoraMs);
    else this.sql.exec('DELETE FROM uso_marca WHERE canal_id = ?', canal);
    if (!marca || !pessoas.length) return;
    const seg = Math.min((agoraMs - marca) / 1000, 6 * 3600);
    const c = this.canal(canal);
    if (!c || seg <= 0) return;
    const n = pessoas.length, outros = Math.max(n - 1, 0);
    const telas = pessoas.filter(p => p.voz.trilhas?.tela || p.voz.trilhas?.telaSessao).length;
    const cams = pessoas.filter(p => p.voz.trilhas?.cam).length;
    const musica = this.sql.exec('SELECT COUNT(*) AS n FROM musica_tocando WHERE canal_id = ?', canal).one().n;
    // MB por segundo de cada tipo (o que sai do SFU para quem recebe).
    const voz = n * outros * 0.005, cam = cams * 0.15 * outros, tela = telas * 0.4 * outros, som = musica * n * 0.016;
    const mes = new Date(agoraMs).toISOString().slice(0, 7);
    this.sql.exec(`INSERT INTO uso_servidor (servidor_id, mes, voz_seg, tela_seg, mb, mb_voz, mb_cam, mb_tela, mb_musica) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT (servidor_id, mes) DO UPDATE SET voz_seg = voz_seg + excluded.voz_seg, tela_seg = tela_seg + excluded.tela_seg, mb = mb + excluded.mb,
        mb_voz = mb_voz + excluded.mb_voz, mb_cam = mb_cam + excluded.mb_cam, mb_tela = mb_tela + excluded.mb_tela, mb_musica = mb_musica + excluded.mb_musica`,
      c.servidor_id, mes, seg * n, seg * telas, seg * (voz + cam + tela + som), seg * voz, seg * cam, seg * tela, seg * som);
  }

  naCall(canal) {
    const lista = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a?.voz?.canal === canal && ws.readyState === 1) lista.push(a);
    }
    return lista;
  }

  // ---------------- música e painel do admin do app ----------------
  // Ficam em arquivos próprios: musicaDaCall.js (fila de música, DJ, despertador) e painelDoAdmin.js.
  // Os métodos de lá são copiados para esta classe no fim deste arquivo (juntarMetodos).

  // ---------------- envio ----------------

  erro(ws, texto) { this.mandar(ws, { t: 'erro', texto }); }

  mandar(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch { } }

  broadcast(obj, exceto) {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) if (ws !== exceto) { try { ws.send(s); } catch { } }
  }

  /** Só para quem divide algum servidor com a pessoa (e ela mesma). */
  paraQuemVe(uid, obj) {
    const veem = new Set(this.sql.exec(`SELECT DISTINCT usuario_id AS u FROM membros_servidor
      WHERE servidor_id IN (SELECT servidor_id FROM membros_servidor WHERE usuario_id = ?)`, uid).toArray().map(r => r.u));
    veem.add(uid);
    // Amigos (e quem tem pedido de amizade com a pessoa) também veem nome, foto e online, mesmo sem servidor em comum.
    for (const id of amizades.pessoasDasRelacoes(this, uid)) veem.add(id);
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (veem.has(ws.deserializeAttachment()?.uid)) { try { ws.send(s); } catch { } }
    }
  }

  /**
   * Evento de um canal (mensagem nova, editada, apagada, "digitando"): só para quem PODE VER aquele canal.
   * Conversa direta: só as duas pessoas. Canal de servidor: os membros — menos o convidado, que só vê o próprio chat
   * (sem isso ele receberia ao vivo as mensagens dos canais que não consegue abrir).
   */
  paraCanal(canal, obj, exceto) {
    const participantesDaConversa = conversasDiretas.participantesDaConversa(this, canal.id);
    const recebem = participantesDaConversa
      ? new Set(participantesDaConversa)
      : new Set(this.sql.exec('SELECT usuario_id AS u FROM membros_servidor WHERE servidor_id = ?', canal.servidor_id).toArray().map(linha => linha.u)
        .filter(usuarioId => {
          const convidado = convidados.dadosDoConvidado(this, usuarioId);
          return !convidado || convidados.canalPermitidoAoConvidado(convidado, canal);
        }));
    const texto = JSON.stringify(obj);
    for (const conexao of this.ctx.getWebSockets()) {
      if (conexao === exceto || !recebem.has(conexao.deserializeAttachment()?.uid)) continue;
      try { conexao.send(texto); } catch { }
    }
  }

  /** Manda de novo a lista de servidores e canais para todas as conexões de UMA pessoa (ex.: DM nova). */
  mandarListaDeCanais(usuarioId) {
    for (const conexao of this.socketsDe(usuarioId)) {
      this.mandar(conexao, { t: 'servidores', servidores: this.servidoresParaCliente(usuarioId), canais: this.canaisDe(usuarioId), membros: this.membrosVisiveis(usuarioId) });
    }
  }

  /** Só para quem é membro do servidor. */
  paraServidor(sid, obj, exceto) {
    const membros = new Set(this.sql.exec('SELECT usuario_id AS u FROM membros_servidor WHERE servidor_id = ?', sid).toArray().map(r => r.u));
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exceto || !membros.has(ws.deserializeAttachment()?.uid)) continue;
      try { ws.send(s); } catch { }
    }
  }

  // ---------------- canais ----------------

  canaisDe(uid) {
    const lista = this.sql.exec(`SELECT id, nome, tipo, posicao, servidor_id AS servidor FROM canais
      WHERE servidor_id IN (SELECT servidor_id FROM membros_servidor WHERE usuario_id = ?) ORDER BY servidor_id, posicao, id`, uid).toArray();
    const convidado = convidados.dadosDoConvidado(this, uid);
    if (convidado) return lista.filter(canal => convidados.canalPermitidoAoConvidado(convidado, canal));
    // + as conversas diretas da pessoa (canais sem servidor: servidor 0).
    return [...lista, ...conversasDiretas.conversasDiretasDe(this, uid)];
  }

  canal(id) { return this.sql.exec('SELECT id, nome, tipo, servidor_id FROM canais WHERE id = ?', id).toArray()[0]; }

  /** O canal, se a pessoa é membro do servidor dele. */
  canalVisivel(uid, id) {
    const c = this.canal(id);
    if (!c) return null;
    // Conversa direta: só as duas pessoas dela.
    if (c.servidor_id === conversasDiretas.SERVIDOR_DAS_CONVERSAS_DIRETAS) {
      return conversasDiretas.participantesDaConversa(this, c.id)?.includes(uid) ? c : null;
    }
    if (!this.membroDe(c.servidor_id, uid)) return null;
    // Convidado: canais de voz e o próprio chat temporário; os outros canais de texto não existem para ele.
    const convidado = convidados.dadosDoConvidado(this, uid);
    return convidado && !convidados.canalPermitidoAoConvidado(convidado, c) ? null : c;
  }

  mexerCanal(ws, eu, m) {
    const sid = m.t === 'canal-criar' ? Number(m.servidor) : this.canal(Number(m.id))?.servidor_id;
    if (!sid || !cargos.pode(this, sid, eu.id, cargos.PERMISSOES.canais)) return this.erro(ws, 'Você não tem permissão para mexer nos canais.');
    if (m.t === 'canal-criar') {
      const tipo = m.tipo === 'voz' ? 'voz' : 'texto';
      const nome = tipo === 'texto' ? limpar(m.nome, 32).toLowerCase().replace(/\s+/g, '-') : limpar(m.nome, 32);
      if (!nome) return this.erro(ws, 'Nome do canal vazio.');
      const pos = this.sql.exec('SELECT COALESCE(MAX(posicao), 0) + 1 AS p FROM canais WHERE servidor_id = ?', sid).one().p;
      this.sql.exec('INSERT INTO canais (nome, tipo, posicao, criado, servidor_id) VALUES (?,?,?,?,?)', nome, tipo, pos, agora(), sid);
    } else if (m.t === 'canal-renomear') {
      const c = this.canal(Number(m.id));
      const nome = c?.tipo === 'texto' ? limpar(m.nome, 32).toLowerCase().replace(/\s+/g, '-') : limpar(m.nome, 32);
      if (!c || !nome) return this.erro(ws, 'Canal ou nome inválido.');
      this.sql.exec('UPDATE canais SET nome = ? WHERE id = ?', nome, c.id);
    } else {
      if (this.sql.exec('SELECT COUNT(*) AS n FROM canais WHERE servidor_id = ?', sid).one().n <= 1) return this.erro(ws, 'Precisa sobrar pelo menos um canal.');
      const id = Number(m.id);
      this.sql.exec('DELETE FROM canais WHERE id = ?', id);
      this.sql.exec('DELETE FROM mensagens WHERE canal_id = ?', id);
      this.sql.exec('DELETE FROM musica_fila WHERE canal_id = ?', id);
      this.sql.exec('DELETE FROM musica_tocando WHERE canal_id = ?', id);
    }
    this.atualizarTodos();
  }

  // ---------------- mensagens ----------------

  linhaParaMsg(r) {
    const resposta = r.resposta_id
      ? this.sql.exec('SELECT id, usuario_id AS autor, texto, apagado FROM mensagens WHERE id = ?', r.resposta_id).toArray()[0] ?? null
      : null;
    const anexo = !r.apagado && r.anexo ? JSON.parse(r.anexo) : null;
    if (anexo) anexo.expirou = r.criado < agora() - ANEXO_DIAS * 86400_000;
    return {
      id: r.id, canal: r.canal_id, autor: r.usuario_id, texto: r.apagado ? '' : r.texto, criado: r.criado, anexo,
      editado: r.editado, apagado: !!r.apagado,
      resposta: resposta && { id: resposta.id, autor: resposta.autor, texto: resposta.apagado ? '' : (resposta.texto.slice(0, 120) || '📎 anexo') },
    };
  }

  enviarHistorico(ws, eu, canalId, antes) {
    if (!this.canalVisivel(eu.id, canalId)) return this.erro(ws, 'Canal não existe.');
    const linhas = this.sql.exec(
      `SELECT * FROM mensagens WHERE canal_id = ? ${antes ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ${PAGINA + 1}`,
      ...(antes ? [canalId, antes] : [canalId])).toArray();
    const fim = linhas.length <= PAGINA;
    const msgs = linhas.slice(0, PAGINA).reverse().map(r => this.linhaParaMsg(r));
    this.mandar(ws, { t: 'historico', canal: canalId, msgs, fim, antes });
  }

  novaMensagem(ws, eu, m) {
    const c = this.canalVisivel(eu.id, Number(m.canal));
    if (!c || !ehCanalDeConversa(c)) return this.erro(ws, 'Canal de texto inválido.');
    // Conversa direta com bloqueio (em qualquer sentido): não passa mensagem nova.
    const duplaDaConversa = conversasDiretas.participantesDaConversa(this, c.id);
    if (duplaDaConversa && amizades.haBloqueioEntre(this, duplaDaConversa[0], duplaDaConversa[1])) return this.erro(ws, 'Não dá para mandar mensagem nessa conversa.');
    const texto = limpar(m.texto, 2000);
    // Anexo: só um arquivo que a própria pessoa subiu para este canal e ainda não foi usado.
    let anexo = null;
    if (m.anexo) {
      const a = this.sql.exec('SELECT * FROM arquivos WHERE chave = ? AND usuario_id = ? AND canal_id = ?', String(m.anexo), eu.id, c.id).toArray()[0];
      if (!a) return this.erro(ws, 'Arquivo não encontrado.');
      if (a.mensagem_id) return;   // cada arquivo vai numa mensagem só
      anexo = { chave: a.chave, nome: a.nome, tipo: a.tipo, tamanho: a.tamanho, duracao: Number(m.duracao) > 0 ? Math.min(Number(m.duracao), 3600) : null, voz: !!m.voz };
    }
    if (!texto && !anexo) return;
    // Resposta só a mensagem do mesmo canal (senão dava para ler o começo de mensagens de outros servidores).
    const resposta = (Number(m.resposta) && this.sql.exec('SELECT id FROM mensagens WHERE id = ? AND canal_id = ?', Number(m.resposta), c.id).toArray()[0]?.id) || null;
    const id = this.sql.exec('INSERT INTO mensagens (canal_id, usuario_id, texto, criado, resposta_id, anexo) VALUES (?,?,?,?,?,?) RETURNING id',
      c.id, eu.id, texto, agora(), resposta, anexo && JSON.stringify(anexo)).one().id;
    if (anexo) this.sql.exec('UPDATE arquivos SET mensagem_id = ? WHERE chave = ?', id, anexo.chave);
    const r = this.sql.exec('SELECT * FROM mensagens WHERE id = ?', id).one();
    this.paraCanal(c, { t: 'msg', msg: this.linhaParaMsg(r), nonce: limpar(m.nonce, 40) });
    this.avisarCelulares(c, eu, texto, anexo, resposta);
  }

  /**
   * Aviso no celular de quem não está com o Concorde aberto (app fechado, ou em segundo plano há um tempo — o Android
   * congela o app e a conexão fica "aberta" sem receber nada). Quem respondeu a mensagem de alguém também "marca".
   * Só funciona com o Firebase configurado (secret FCM_CONTA; ver docs/notificacoes-celular.md).
   */
  avisarCelulares(c, eu, texto, anexo, respostaId) {
    if (!this.env.FCM_CONTA) return;
    const respondido = respostaId ? this.sql.exec('SELECT usuario_id FROM mensagens WHERE id = ?', respostaId).toArray()[0]?.usuario_id : null;
    // Conversa direta: o aviso vai só para a outra pessoa, e conta como "te marcou" (é para ela).
    const participantesDaConversa = conversasDiretas.participantesDaConversa(this, c.id);
    const aparelhos = participantesDaConversa
      ? this.sql.exec(`SELECT token, usuario_id, modo FROM push_aparelhos WHERE usuario_id = ? AND modo != 'nenhuma'`,
        participantesDaConversa.find(usuarioId => usuarioId !== eu.id)).toArray()
      : this.sql.exec(`SELECT p.token, p.usuario_id, p.modo FROM push_aparelhos p
        JOIN membros_servidor m ON m.usuario_id = p.usuario_id AND m.servidor_id = ?
        WHERE p.usuario_id != ? AND p.modo != 'nenhuma'`, c.servidor_id, eu.id).toArray();
    if (!aparelhos.length) return;
    const naoQueremAviso = amizades.naoQueremAvisoDe(this, eu.id);   // bloquearam ou silenciaram quem escreveu
    const t = agora();
    // "Com o app na mão": conexão que não está em segundo plano e deu sinal de vida (ping a cada 30 s) há pouco.
    const ativo = uid => this.socketsDe(uid).some(ws => {
      const a = ws.deserializeAttachment();
      const vivo = Math.max(a?.desde || 0, this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() || 0);
      return a && !a.fundo && t - vivo < 75_000;
    });
    const legivel = (texto || '').replace(/<@(\d+)>/g, (_, id) => '@' + (this.membro(Number(id))?.nome || 'alguém'));
    const corpo = (legivel || (anexo?.voz ? '🎤 mensagem de voz' : `📎 ${anexo?.nome || 'anexo'}`)).slice(0, 180);
    const envios = [];
    for (const p of aparelhos) {
      const marcou = !!participantesDaConversa || texto.includes(`<@${p.usuario_id}>`) || respondido === p.usuario_id;
      if (p.modo === 'mencoes' && !marcou) continue;
      if (naoQueremAviso.has(p.usuario_id)) continue;
      if (ativo(p.usuario_id) || !this.canalVisivel(p.usuario_id, c.id)) continue;
      const titulo = participantesDaConversa ? `${eu.nome} (mensagem direta)` : marcou ? `${eu.nome} te marcou em #${c.nome}` : `${eu.nome} em #${c.nome}`;
      envios.push(enviarPush(this.env, p.token, { titulo, corpo, canal: c.id }).then(r => {
        if (r === 'invalido') this.sql.exec('DELETE FROM push_aparelhos WHERE token = ?', p.token);
      }));
    }
    if (envios.length) this.ctx.waitUntil(Promise.allSettled(envios));
  }

  editarMensagem(ws, eu, m) {
    const r = this.sql.exec('SELECT * FROM mensagens WHERE id = ?', Number(m.id)).toArray()[0];
    if (!r || r.usuario_id !== eu.id || r.apagado) return this.erro(ws, 'Só dá para editar mensagem sua.');
    // Quem saiu (ou foi expulso) do servidor não mexe mais nas mensagens que ficaram lá.
    if (!this.canalVisivel(eu.id, r.canal_id)) return this.erro(ws, 'Você não está mais nesse canal.');
    const texto = limpar(m.texto, 2000);
    if (!texto) return;
    this.sql.exec('UPDATE mensagens SET texto = ?, editado = ? WHERE id = ?', texto, agora(), r.id);
    const c = this.canal(r.canal_id);
    this.paraCanal(c, { t: 'msg-editada', msg: this.linhaParaMsg(this.sql.exec('SELECT * FROM mensagens WHERE id = ?', r.id).one()) });
  }

  apagarMensagem(ws, eu, m) {
    const r = this.sql.exec('SELECT * FROM mensagens WHERE id = ?', Number(m.id)).toArray()[0];
    const c = r && this.canal(r.canal_id);
    if (!r || !c || (r.usuario_id !== eu.id && !cargos.pode(this, c.servidor_id, eu.id, cargos.PERMISSOES.apagarMensagens))) return this.erro(ws, 'Só dá para apagar mensagem sua.');
    this.sql.exec("UPDATE mensagens SET apagado = 1, texto = '' WHERE id = ?", r.id);
    this.paraCanal(c, { t: 'msg-apagada', id: r.id, canal: r.canal_id });
  }
}

/**
 * Junta na classe Comunidade os métodos que ficam em arquivos próprios (para o comunidade.js não virar um arquivo de
 * milhares de linhas). Depois disso é como se eles estivessem escritos aqui dentro: usam "this" normalmente.
 */
function juntarMetodos(classeDeDestino, ...classesComMetodos) {
  for (const classeComMetodos of classesComMetodos) {
    for (const nomeDoMetodo of Object.getOwnPropertyNames(classeComMetodos.prototype)) {
      if (nomeDoMetodo === 'constructor') continue;
      if (Object.prototype.hasOwnProperty.call(classeDeDestino.prototype, nomeDoMetodo)) throw new Error(`Método repetido: ${nomeDoMetodo}`);
      classeDeDestino.prototype[nomeDoMetodo] = classeComMetodos.prototype[nomeDoMetodo];
    }
  }
}
juntarMetodos(Comunidade, MetodosDaMusica, MetodosDoPainelDoAdmin);
