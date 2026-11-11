// Estado do Concorde (signals) + conexão com o servidor (WebSocket com reconexão).
import { signal, computed, effect } from '@preact/signals';

export const eu = signal(null);                // conta logada (null = tela de login)
export const conectado = signal(false);
/** Faixa "sem conexão": só depois de 4 s caído (reconexão rápida — ex.: atualização do site — não pisca na tela). */
export const semConexao = signal(false);
let timerSemConexao;
effect(() => {
  clearTimeout(timerSemConexao);
  if (conectado.value) semConexao.value = false;
  else timerSemConexao = setTimeout(() => { semConexao.value = true; }, 4000);
});
export const membros = signal(new Map());      // id → { id, usuario, nome, cor, admin }
export const canais = signal([]);              // [{ id, nome, tipo, posicao, servidor }] de todos os meus servidores
export const servidores = signal([]);          // [{ id, nome, icone, cor, dono, membros, admins, admin, convite }]
export const servidorAtual = signal(lerLocal('servidor', null));
export const musica = signal({});              // canal de voz → { fila, tocando }
export const avisoGeral = signal(null);        // { texto, de } — faixa para todo mundo (painel do admin do app)
export const adminDados = signal(null);        // painel do admin do app
export const adminSenha = signal(null);        // { uid, senha } senha provisória gerada no painel
export const presencas = signal({});           // id → 'online' | 'ausente' | 'offline'
export const canalAtual = signal(null);
export const mensagens = signal(new Map());    // canal → { lista, fim, carregando }
export const digitando = signal(new Map());    // canal → Map(uid → expira)
export const naoLidos = signal(new Set());     // canais com mensagem nova fora de vista
export const aviso = signal(null);             // erro rápido (toast)
export const vozEstado = signal({});           // canal de voz → [{ uid, sessao, mudo, surdo, trilhas }]
export const eventosVoz = new EventTarget();   // "pronto" (reconectou) e "expulso" (entrou na call por outro aparelho)

export const canalSelecionado = computed(() => canais.value.find(c => c.id === canalAtual.value) || null);
export const servidorSelecionado = computed(() => servidores.value.find(x => x.id === servidorAtual.value) || null);
export const canaisDoServidor = computed(() => canais.value.filter(c => c.servidor === servidorAtual.value));

function lerLocal(k, padrao) { try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } }
function salvarLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

/** Onde o Concorde abre: "/" no endereço principal (concorde.…), "/concorde" no endereço antigo (telinha.…). */
export const raiz = typeof location !== 'undefined' && location.pathname.startsWith('/concorde') ? '/concorde' : '/';

/** Convite do link (…/?convite=abc123): usado no cadastro ou para entrar no servidor depois do login. */
export const conviteDoLink = (() => { try { return new URLSearchParams(location.search).get('convite'); } catch { return null; } })();
/** Código de convite DO APP no link (…/?acesso=ABCD-EFGH, vem no e-mail de pedido aprovado): abre o cadastro. */
export const conviteDoAppDoLink = (() => { try { return new URLSearchParams(location.search).get('acesso'); } catch { return null; } })();
/** Rodando dentro do app do Windows ou do celular (lá a página inicial de apresentação não aparece). */
export const dentroDoApp = typeof window !== 'undefined' && (!!window.concordeApp || !!window.ConcordeAndroidPonte || /ConcordeAndroid/.test(navigator.userAgent));
/** Admin do app: chegou pedido de acesso novo enquanto estava conectado (mostra a bolinha no painel). */
export const pedidoDeAcessoNovo = signal(false);
/** Admin do app: o último convite criado no painel (para mostrar o código/link e copiar). */
export const conviteCriadoNoPainel = signal(null);

// ---------------- amizades e cargos (0.5.11 — servidor: amizades.js e cargos.js) ----------------

/** Amigos, pedidos (recebidos/enviados), bloqueados e silenciados pela conta (listas de ids). */
export const relacoes = signal({ amigos: [], pedidosRecebidos: [], pedidosEnviados: [], bloqueados: [], silenciados: [] });
export const bloqueados = computed(() => new Set(relacoes.value.bloqueados));
/** Silenciados pela conta + bloqueados: a voz deles some em qualquer call e eles não geram aviso. */
export const caladosPelaConta = computed(() => new Set([...relacoes.value.silenciados, ...relacoes.value.bloqueados]));
/** Ações de amizade/bloqueio (o servidor responde com a lista nova). */
export const acaoDeAmizade = (tipo, dados) => enviar({ t: tipo, ...dados });

/** Permissões dos cargos (iguais às do servidor, src/Cloudflare/src/cargos.js). */
export const PERMISSOES = { convidar: 1, canais: 2, expulsar: 4, moderarVoz: 8, apagarMensagens: 16, editarServidor: 32, gerenciarCargos: 64 };
/** Eu posso fazer isto no servidor? (dono/admin/admin do app: tudo; os outros pelos cargos) */
export const posso = (servidor, permissao) => !!servidor && ((servidor.permissoes || 0) & permissao) === permissao;

// ---------------- HTTP (login) ----------------

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || `erro ${res.status}`);
  return data;
}

export async function carregarSessao() {
  const res = await fetch('/api/eu');
  eu.value = res.ok ? await res.json() : null;
  // Conta antiga: primeiro a tela de segurança (senha nova + e-mail); o servidor também recusa a conexão antes disso.
  if (eu.value && !eu.value.precisaSeguranca) conectar();
  return eu.value;
}

export async function entrar(usuario, senha, lembrar = true) { await post('/api/auth/entrar', { usuario, senha, lembrar }); return carregarSessao(); }

/** Dados que o app desktop injeta na página (versão do app, código de convite embutido no instalador). */
export const appDesktop = typeof window !== 'undefined' ? window.concordeApp || null : null;

/**
 * App Android (WebView): a ponte ConcordeAndroidPonte.chamar(id, método, argsJson) responde em
 * window.__concordeAndroid.resposta(id, ok, valorJson). Só transmitir a tela e manter a call viva — o resto é o site.
 */
export const appAndroid = (() => {
  const ponte = typeof window !== 'undefined' && window.ConcordeAndroidPonte;
  if (!ponte) return null;
  const pendentes = new Map(), ouvintes = new Set();
  let n = 0;
  window.__concordeAndroid = {
    resposta(id, ok, valor) {
      const p = pendentes.get(id);
      if (!p) return;
      pendentes.delete(id);
      ok ? p[0](JSON.parse(valor)) : p[1](new Error(valor));
    },
    evento(nome, dados) { ouvintes.forEach(f => { try { f(nome, JSON.parse(dados)); } catch {} }); },
  };
  const chamar = (metodo, args = {}) => new Promise((ok, falha) => {
    const id = ++n;
    pendentes.set(id, [ok, falha]);
    ponte.chamar(id, metodo, JSON.stringify(args));
  });
  let info = {};
  try { info = JSON.parse(ponte.info()); } catch {}
  return {
    ...info,
    nativo: {
      emCall: ligado => chamar('emCall', { ligado }),
      iniciar: p => chamar('iniciar', p), resposta: sdp => chamar('resposta', { sdp }), parar: () => chamar('parar'),
      // App 0.5.4+: saída de som (viva-voz, ouvido, fone, Bluetooth) e atualização do APK. App antigo responde "método desconhecido"
      // (para ele a faixa de atualização não aparece; quem tem o 0.5.0 precisa instalar o 0.5.4 na mão uma vez).
      saidas: () => chamar('saidas'), saida: id => chamar('saida', { id }),
      // 0.5.5+: avisos de mensagem (Android e Firebase).
      notificar: p => chamar('notificar', p), pushToken: () => chamar('pushToken'), canalPendente: () => chamar('canalPendente'),
      atualizacao: () => chamar('atualizacao'), atualizar: () => chamar('atualizar'),
      aoEvento: f => { ouvintes.add(f); return () => ouvintes.delete(f); },
    },
  };
})();
/** "Tenho um código de convite": confere o código do app antes do cadastro. Devolve { codigo, servidor }. */
export const validarConviteDoApp = codigo => post('/api/auth/convite-validar', { codigo });
/** "Pedir acesso" (página inicial). */
export const pedirAcesso = dados => post('/api/auth/pedir-acesso', dados);

/** Atualização de segurança do 0.5 (uma vez por conta antiga). */
export async function atualizarSeguranca(dados) { await post('/api/auth/seguranca', dados); return carregarSessao(); }

export async function registrar(dados) {
  await post('/api/auth/registrar', dados);
  if (dados.conversao) {
    // Convidado que virou conta: recarrega a página do zero (a tela de cadastro de conversão sai de cena).
    try { sessionStorage.removeItem(CHAVE_DA_CONVERSAO_DE_CONVIDADO); } catch {}
    location.href = location.pathname;
    return null;
  }
  return carregarSessao();
}

// ---------------- convidado (acesso temporário, só pelo navegador — servidor: convidados.js) ----------------

/** Código do convite de convidado no link (…/?convidado=123456), ou null. */
export const conviteDeConvidadoDoLink = (() => { try { return new URLSearchParams(location.search).get('convidado'); } catch { return null; } })();
/** O convidado virando conta: o código de uso único fica guardado enquanto a página recarrega no cadastro. */
const CHAVE_DA_CONVERSAO_DE_CONVIDADO = 'concorde-conversao-de-convidado';
export const codigoDeConversaoDeConvidado = (() => { try { return sessionStorage.getItem(CHAVE_DA_CONVERSAO_DE_CONVIDADO); } catch { return null; } })();
/** O acesso de convidado acabou (expulso, tempo acabou e saiu): a página mostra a tela de fim. */
export const acessoDeConvidadoTerminou = signal(false);

/** Nome do servidor e validade do convite de convidado (antes de entrar). */
export const informacoesDoConviteDeConvidado = codigo => post('/api/auth/convidado-info', { codigo });

/** Entra como convidado só com o nome. */
export async function entrarComoConvidado(codigo, nome) {
  await post('/api/auth/convidado', { codigo, nome });
  // Tira o código do endereço (recarregar a página não deve tentar entrar de novo).
  try { history.replaceState(null, '', location.pathname); } catch {}
  return carregarSessao();
}
export async function sair() {
  if (pushToken) enviar({ t: 'push-sair', token: pushToken });   // este celular para de receber avisos dessa conta
  await post('/api/auth/sair');
  desconectar();
  eu.value = null;
}

// ---------------- WebSocket ----------------

let ws = null, tentativa = 0, timerReconexao = null, desligado = false, timerPing = null;

export function conectar() {
  desligado = false;
  clearTimeout(timerReconexao);
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`);
  ws.onopen = () => {
    tentativa = 0;
    clearInterval(timerPing);
    timerPing = setInterval(() => { if (ws?.readyState === 1) ws.send('ping'); }, 30_000);
  };
  ws.onmessage = e => { if (e.data !== 'pong') receber(JSON.parse(e.data)); };
  ws.onclose = e => {
    clearInterval(timerPing);
    conectado.value = false;
    if (desligado) return;
    if (e.code === 4001) { eu.value = null; return; }
    if (e.code === 4003) { acessoDeConvidadoTerminou.value = true; return; }   // acesso de convidado terminou
    // Recarrega a sessão (pode ter expirado) e tenta de novo com espera crescente.
    timerReconexao = setTimeout(async () => {
      const res = await fetch('/api/eu').catch(() => null);
      if (res && res.status === 401) { eu.value = null; return; }
      conectar();
    }, Math.min(1000 * 2 ** tentativa++, 15000));
  };
}

function desconectar() { desligado = true; ws?.close(); }

export function enviar(obj) {
  // Sem WebSocket ainda (tela de login/segurança): fica quieto; caiu no meio do uso: avisa.
  if (ws?.readyState !== 1) { if (ws && !desligado) aviso.value = 'Sem conexão — reconectando…'; return false; }
  ws.send(JSON.stringify(obj));
  return true;
}

function atualizarMsgs(canal, fn) {
  const mapa = new Map(mensagens.value);
  const atual = mapa.get(canal) || { lista: [], fim: false, carregando: false };
  mapa.set(canal, fn(atual));
  mensagens.value = mapa;
}

function receber(m) {
  switch (m.t) {
    case 'pronto': {
      eu.value = m.eu;
      membros.value = new Map(m.membros.map(x => [x.id, x]));
      canais.value = m.canais;
      presencas.value = m.presencas;
      servidores.value = m.servidores || [];
      musica.value = m.musica || {};
      avisoGeral.value = m.aviso;
      vozEstado.value = m.voz || {};
      if (m.relacoes) relacoes.value = m.relacoes;
      conectado.value = true;
      eventosVoz.dispatchEvent(new Event("pronto"));
      // Depois de reconectar, recarrega o histórico do zero (pode ter perdido mensagens no meio).
      mensagens.value = new Map();
      // Estava nas mensagens diretas (servidor 0) ou num servidor que ainda existe: continua lá.
      if (servidorAtual.value !== SERVIDOR_DAS_CONVERSAS_DIRETAS && !servidores.value.some(x => x.id === servidorAtual.value)) servidorAtual.value = servidores.value[0]?.id ?? null;
      abrirServidor(servidorAtual.value);
      if (conviteDoLink && !conviteUsado) { conviteUsado = true; enviar({ t: 'servidor-entrar', convite: conviteDoLink }); }
      prontoNoCelular();
      break;
    }
    case 'servidores':
      servidores.value = m.servidores;
      canais.value = m.canais;
      membros.value = new Map(m.membros.map(x => [x.id, x]));
      if (!servidores.value.some(x => x.id === servidorAtual.value)) abrirServidor(servidores.value[0]?.id ?? null);
      else if (!canais.value.some(c => c.id === canalAtual.value)) abrirServidor(servidorAtual.value);
      break;
    case 'servidor-aberto':
      abrirServidor(m.id);
      break;
    case 'musica':
      musica.value = { ...musica.value, [m.canal]: { fila: m.fila, tocando: m.tocando, passar: m.passar } };
      break;
    case 'aviso-geral':
      avisoGeral.value = m.texto ? { texto: m.texto, de: m.de } : null;
      break;
    case 'admin-dados':
      adminDados.value = m;
      break;
    case 'admin-senha':
      adminSenha.value = { uid: m.uid, senha: m.senha };
      break;
    case 'admin-convite-criado':
      conviteCriadoNoPainel.value = { codigo: m.codigo, tipo: m.tipo };
      break;
    case 'pedido-novo':
      pedidoDeAcessoNovo.value = true;
      break;
    case 'relacoes': {
      const { t: _tipo, membros: pessoas, ...listas } = m;
      relacoes.value = listas;
      if (pessoas) membros.value = new Map(pessoas.map(pessoa => [pessoa.id, pessoa]));
      break;
    }
    case 'ok':
      aviso.value = m.texto;
      break;
    case 'historico':
      atualizarMsgs(m.canal, s => ({
        lista: m.antes ? [...m.msgs, ...s.lista] : m.msgs,
        fim: m.fim,
        carregando: false,
      }));
      break;
    case 'msg':
      if (mensagens.value.has(m.msg.canal)) atualizarMsgs(m.msg.canal, s => ({ ...s, lista: [...s.lista, m.msg] }));
      pararDigitando(m.msg.canal, m.msg.autor);
      if (m.msg.canal !== canalAtual.value || document.hidden || appFundo) {
        if (m.msg.canal !== canalAtual.value) naoLidos.value = new Set([...naoLidos.value, m.msg.canal]);
        notificar(m.msg);
      }
      break;
    case 'msg-editada':
      atualizarMsgs(m.msg.canal, s => ({ ...s, lista: s.lista.map(x => x.id === m.msg.id ? m.msg : x) }));
      break;
    case 'msg-apagada':
      atualizarMsgs(m.canal, s => ({ ...s, lista: s.lista.map(x => x.id === m.id ? { ...x, apagado: true, texto: '' } : x) }));
      break;
    case 'digitando': {
      const mapa = new Map(digitando.value);
      const doCanal = new Map(mapa.get(m.canal) || []);
      doCanal.set(m.uid, Date.now() + 4000);
      mapa.set(m.canal, doCanal);
      digitando.value = mapa;
      setTimeout(() => pararDigitando(m.canal, m.uid, true), 4100);
      break;
    }
    case 'presenca':
      presencas.value = { ...presencas.value, [m.uid]: m.estado };
      break;
    case 'membro': {
      const mapa = new Map(membros.value);
      mapa.set(m.membro.id, m.membro);
      membros.value = mapa;
      if (eu.value?.id === m.membro.id) eu.value = m.membro;
      break;
    }
    case 'canais':
      canais.value = m.canais;
      if (!m.canais.some(c => c.id === canalAtual.value)) abrirCanal((m.canais.find(c => c.tipo === 'texto') || m.canais[0])?.id);
      break;
    case 'voz':
      vozEstado.value = m.voz;
      break;
    case 'voz-stats':
      eventosVoz.dispatchEvent(new CustomEvent('stats', { detail: m }));
      break;
    case 'direta-aberta':
      // A conversa que eu pedi está pronta (nova ou a de sempre): abre ela.
      abrirCanal(m.canal);
      break;
    case 'convidado-fim':
      // Acesso de convidado terminou (expulso, ou o tempo acabou): a conta já não existe no servidor.
      acessoDeConvidadoTerminou.value = true;
      desconectar();
      break;
    case 'convidado-converter':
      // Um admin transformou este convidado em conta definitiva: recarrega no cadastro (sem código de convite).
      try { sessionStorage.setItem(CHAVE_DA_CONVERSAO_DE_CONVIDADO, m.codigo); } catch {}
      location.href = location.pathname;
      break;
    case 'voz-expulso':
      // motivo: undefined (entrou por outro aparelho), 'servidor' (saiu/foi tirado do servidor), 'admin' (um admin desconectou)
      eventosVoz.dispatchEvent(new CustomEvent('expulso', { detail: { motivo: m.motivo, por: m.por } }));
      break;
    case 'erro':
      aviso.value = m.texto;
      break;
  }
}

function pararDigitando(canal, uid, soSeExpirou) {
  const doCanal = digitando.value.get(canal);
  if (!doCanal?.has(uid) || (soSeExpirou && doCanal.get(uid) > Date.now())) return;
  const mapa = new Map(digitando.value);
  const novo = new Map(doCanal);
  novo.delete(uid);
  mapa.set(canal, novo);
  digitando.value = mapa;
}

export function pedirHistorico(canal, antes) {
  atualizarMsgs(canal, s => ({ ...s, carregando: true }));
  enviar({ t: 'historico', canal, antes });
}

let conviteUsado = false;

/** Abre um servidor no último canal que a pessoa usou nele (ou no primeiro de texto). */
export function abrirServidor(id) {
  if (id === SERVIDOR_DAS_CONVERSAS_DIRETAS) return abrirMensagensDiretas();
  servidorAtual.value = id;
  salvarLocal('servidor', id);
  const doServidor = canais.value.filter(c => c.servidor === id);
  const ultimo = lerLocal('ultimoCanal', {})[id];
  const alvo = doServidor.find(c => c.id === ultimo) || doServidor.find(c => c.tipo === 'texto') || doServidor[0];
  canalAtual.value = null;
  if (alvo) abrirCanal(alvo.id);
}

export function abrirCanal(id) {
  if (id == null) return;
  canalAtual.value = id;
  const c0 = canais.value.find(x => x.id === id);
  if (c0) {
    if (c0.servidor !== servidorAtual.value) { servidorAtual.value = c0.servidor; salvarLocal('servidor', c0.servidor); }
    salvarLocal('ultimoCanal', { ...lerLocal('ultimoCanal', {}), [c0.servidor]: id });
  }
  const s = new Set(naoLidos.value);
  s.delete(id);
  naoLidos.value = s;
  const c = canais.value.find(x => x.id === id);
  if ((c?.tipo === 'texto' || c?.tipo === TIPO_CONVERSA_DIRETA) && !mensagens.value.has(id)) pedirHistorico(id);
}

// ---------------- mensagens diretas (DMs — servidor: conversasDiretas.js) ----------------

/** As conversas diretas são canais sem servidor: servidor 0, tipo "direta", e "com" = a outra pessoa. */
export const SERVIDOR_DAS_CONVERSAS_DIRETAS = 0;
export const TIPO_CONVERSA_DIRETA = 'direta';
/** Minhas conversas diretas, da mais recente para a mais antiga. */
export const conversasDiretas = computed(() => canais.value
  .filter(canal => canal.tipo === TIPO_CONVERSA_DIRETA)
  .sort((primeira, segunda) => (segunda.ultimaMensagem || segunda.id) - (primeira.ultimaMensagem || primeira.id)));
/** Tem mensagem direta nova sem ler? (bolinha no botão das mensagens diretas) */
export const temConversaDiretaNaoLida = computed(() => conversasDiretas.value.some(conversa => naoLidos.value.has(conversa.id)));

/** "Mandar mensagem" para alguém: o servidor abre (ou cria) a conversa e responde "direta-aberta". */
export function abrirConversaCom(usuarioId) { enviar({ t: 'direta-abrir', uid: usuarioId }); }

/** Tela das mensagens diretas: abre na página de amigos (como no Discord); a conversa é escolhida na lista. */
export function abrirMensagensDiretas() {
  servidorAtual.value = SERVIDOR_DAS_CONVERSAS_DIRETAS;
  salvarLocal('servidor', SERVIDOR_DAS_CONVERSAS_DIRETAS);
  canalAtual.value = null;
}

// ---------------- presença e notificações ----------------

let timerAusente;
document.addEventListener('visibilitychange', () => {
  clearTimeout(timerAusente);
  if (document.hidden) timerAusente = setTimeout(() => enviar({ t: 'presenca', estado: 'ausente' }), 5 * 60_000);
  else enviar({ t: 'presenca', estado: 'online' });
});

// Avisos de mensagem, em três jeitos guardados no aparelho: todas, só quando me marcam (ou respondem), nenhuma.
// A página não consegue tirar a permissão do navegador: silenciar é uma escolha nossa.
//   PC/navegador: notificação do navegador.
//   Celular: aviso do Android pela ponte com o app aberto/em segundo plano; com o app fechado, o servidor manda
//   pelo Firebase (só se o APK foi gerado com ele — aí a página não repete o aviso).
const modoSalvo = lerLocal('concorde-notificacoes', 'todas');   // antes era true/false
export const modoAvisos = signal(modoSalvo === true ? 'todas' : modoSalvo === false ? 'nenhuma' : modoSalvo);

export async function mudarAvisos(modo) {
  if (!appAndroid && !('Notification' in window)) { aviso.value = 'Este navegador não mostra notificações.'; return; }
  if (modo !== 'nenhuma' && !appAndroid && Notification.permission !== 'granted'
      && await Notification.requestPermission() !== 'granted') {
    aviso.value = 'O navegador bloqueou as notificações — libere no cadeado ao lado do endereço.';
    return;
  }
  modoAvisos.value = modo;
  salvarLocal('concorde-notificacoes', modo);
  registrarCelular();
  aviso.value = { todas: 'Avisos de todas as mensagens 🔔', mencoes: 'Avisos só quando te marcarem ou responderem 🔔', nenhuma: 'Avisos silenciados 🔕' }[modo];
}

// ---- celular ----
let pushToken = null;     // "endereço" do aparelho no Firebase (null = APK sem Firebase)
let appFundo = false;     // app do celular em segundo plano

/** Conta para o servidor que este celular quer avisos com o app fechado (e de que jeito). */
async function registrarCelular() {
  const a = appAndroid?.nativo;
  if (!a?.pushToken) return;
  try { if (!pushToken) pushToken = (await a.pushToken())?.token || null; } catch { }
  if (pushToken) enviar({ t: 'push', token: pushToken, modo: modoAvisos.value });
}

appAndroid?.nativo.aoEvento((evento, dados) => {
  if (evento === 'app') { appFundo = !!dados.fundo; enviar({ t: 'fundo', sim: appFundo }); }
  else if (evento === 'abrir-canal') abrirCanal(Number(dados.canal));   // tocou num aviso com o app aberto
});

/** Conectou: registra o celular e, se o app abriu tocando num aviso, vai para o canal dele. */
async function prontoNoCelular() {
  const a = appAndroid?.nativo;
  if (!a?.pushToken) return;
  registrarCelular();
  if (appFundo) enviar({ t: 'fundo', sim: true });
  try { const r = await a.canalPendente(); if (r?.canal) abrirCanal(Number(r.canal)); } catch { }
}

// ---------------- menções (@) ----------------
// Na mensagem a menção vai como <@id> (igual o Discord): continua certa se a pessoa trocar de nome.

/** <@12> → @Nome (para notificação, prévia da resposta e edição). */
export const textoLegivel = texto => (texto || '').replace(/<@(\d+)>/g, (_, id) => '@' + (membros.value.get(Number(id))?.nome || 'alguém'));

/** A mensagem marca essa pessoa? */
export const marca = (texto, id) => !!texto && texto.includes(`<@${id}>`);

/** Antes de enviar: @Nome (ou @usuario) de quem está no servidor → <@id>. Nomes maiores primeiro ("Ana Paula" antes de "Ana"). */
export function converterMencoes(texto, ids) {
  const nomes = ids.map(id => membros.value.get(id)).filter(Boolean)
    .flatMap(p => [[p.nome, p.id], [p.usuario, p.id]]).filter(([n]) => n)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [nome, id] of nomes) {
    const esc = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    texto = texto.replace(new RegExp(`(^|[^\\w<])@${esc}(?![\\w])`, 'giu'), `$1<@${id}>`);
  }
  return texto;
}

function notificar(msg) {
  if (msg.autor === eu.value?.id || modoAvisos.value === 'nenhuma' || caladosPelaConta.value.has(msg.autor)) return;
  const canalDaMensagem = canais.value.find(c => c.id === msg.canal);
  const ehDireta = canalDaMensagem?.tipo === TIPO_CONVERSA_DIRETA;   // mensagem direta é sempre "para mim"
  const marcou = ehDireta || marca(msg.texto, eu.value?.id) || msg.resposta?.autor === eu.value?.id;
  if (modoAvisos.value === 'mencoes' && !marcou) return;
  const autor = membros.value.get(msg.autor)?.nome || 'alguém';
  const canal = canalDaMensagem?.nome || '';
  const titulo = ehDireta ? `${autor} (mensagem direta)` : marcou ? `${autor} te marcou em #${canal}` : `${autor} em #${canal}`;
  const corpo = (textoLegivel(msg.texto) || (msg.anexo?.voz ? '🎤 mensagem de voz' : `📎 ${msg.anexo?.nome || 'anexo'}`)).slice(0, 140);
  if (appAndroid) {
    // Com o app na frente não precisa; com o Firebase quem avisa é o servidor (senão chegava repetido).
    if (appFundo && !pushToken) appAndroid.nativo.notificar?.({ titulo, texto: corpo, canal: msg.canal }).catch(() => {});
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(titulo, { body: corpo, icon: '/img/jorginho.jpg', tag: `canal-${msg.canal}` }); } catch {}
}

// ---------------- tema ----------------

export function alternarTema() {
  const escuro = document.documentElement.classList.toggle('dark');
  try { localStorage.setItem('theme', escuro ? 'dark' : 'light'); } catch {}   // padrão (sem escolha) = escuro
}
