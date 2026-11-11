// Telinha no Cloudflare (plano grátis): o Worker é a "porta da frente" com endereço fixo.
// Ele serve a página e repassa a sinalização para o servidor do desktop, que avisa o endereço
// atual do seu túnel a cada inicialização. O vídeo em si vai direto para o desktop (UDP).
//
//   POST /api/registrar          desktop informa a URL do túnel (Bearer SENHA_REGISTRO)
//   GET  /api/salas              → desktop
//   *    /<sala>/whip[/<id>]     → desktop (transmissor publica; senha conferida pelo MediaMTX)
//   *    /<sala>/whep[/<id>]     → desktop (espectador assiste)
//   GET  /, /s/<sala>            página
//   GET  /api/sala/<sala>/ws     bate-papo e reações da sala (WebSocket)
//   GET  /api/sala/<sala>/info   o que está sendo transmitido (fonte, qualidade)
//   POST /api/sala/<sala>/info   transmissor informa isso (Basic telinha:SENHA_TRANSMISSAO)

//
// Concorde (o "Discord" da galera):
//   POST /api/auth/registrar | /api/auth/entrar | /api/auth/sair
//   POST /api/auth/convidado-info | /api/auth/convidado   → acesso temporário de convidado (convidados.js)
//   GET  /api/eu                 quem está logado (cookie concorde_sessao)
//   GET  /api/ws                 WebSocket do servidor: chat, canais, presença
//   *    /api/sfu/sessions/...   → Cloudflare Realtime (SFU), só para quem está logado; o token fica aqui

import { DurableObject } from 'cloudflare:workers';
export { Comunidade } from './comunidade.js';

const COOKIE = 'concorde_sessao';

const SIGNALING = /^\/[A-Za-z0-9_-]{1,40}\/(whip|whep)(\/[A-Za-z0-9_-]+)?$/;
const ROOM_API = /^\/api\/sala\/([A-Za-z0-9_-]{1,40})\/(ws|info)$/;
const REACTIONS = ['🔥', '😂', '👏', '🤡', '❤️', '💩'];

export default {
  /** Todo dia: apaga do R2 os anexos de mais de 7 dias. */
  async scheduled(_evento, env) {
    if (!env.ARQUIVOS) return;
    const chaves = await comunidade(env).arquivosVencidos();
    for (let i = 0; i < chaves.length; i += 1000) await env.ARQUIVOS.delete(chaves.slice(i, i + 1000));
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Proteção contra "pedido forjado" (CSRF): ação que muda algo no Caocorde (POST, PUT, DELETE) só vale se vier da
    // própria página. O cookie já é SameSite=Lax (o navegador não manda em POST de outro site); isto é a 2ª trava.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && ehRotaDoCaocorde(path) && !origemPermitida(req, url)) {
      return json({ erro: 'origem não permitida' }, 403);
    }
    if (path.startsWith('/api/auth/') || path === '/api/eu' || path === '/api/ws') return concorde(env, req, url);
    if (path.startsWith('/api/sfu/')) return sfu(env, req, path);
    if (path === '/api/arquivos' || path.startsWith('/api/arquivos/')) return arquivos(env, req, url);
    if (path === '/api/avatar' || path.startsWith('/api/avatar/')) return avatar(env, req, url);
    return cabecalhosDeSeguranca(await rotear(env, req, url, path), ehPaginaDoCineSacana(url, path));
  },
};

/**
 * Endereço principal (concorde.SEU-SUBDOMINIO.workers.dev, que chega aqui pelo Worker "concorde"):
 * "/" é o Concorde e o Cine Sacana fica em "/telinha". No endereço antigo (telinha.…) nada muda: "/" é a lista
 * "ao vivo agora" (o botão do Telinha 1.x abre ela) e o Concorde fica em /concorde até todo mundo atualizar.
 * No teste local, http://concorde.localhost:8790 se comporta como o endereço principal.
 */
/** Rotas da API do Caocorde (as do Telinha — /api/registrar, /api/salas, /<sala>/whip… — ficam como estão). */
const ehRotaDoCaocorde = caminho => /^\/api\/(auth\/|eu$|ws$|sfu\/|arquivos|avatar)/.test(caminho);

/**
 * O pedido veio da nossa página? Sem cabeçalho Origin (app antigo, ferramenta de linha de comando) passa: quem não é
 * navegador não carrega o cookie de ninguém. No teste local, 127.0.0.1 e localhost contam como a mesma casa.
 */
function origemPermitida(req, url) {
  const origem = req.headers.get('Origin');
  if (!origem || origem === 'null') return !origem;
  let hostDaOrigem;
  try { hostDaOrigem = new URL(origem).host; } catch { return false; }
  const local = host => /^(127\.0\.0\.1|localhost|[a-z0-9-]+\.localhost)(:\d+)?$/.test(host);
  return hostDaOrigem === url.host || (local(url.host) && local(hostDaOrigem));
}

const ehPrincipal = url => url.hostname.startsWith('concorde.') || /^(www\.)?caocorde\.(com|localhost)$/.test(url.hostname);

async function rotear(env, req, url, path) {
  {
    const principal = ehPrincipal(url);
    const concordeApp = () => env.ASSETS.fetch(new Request(new URL('/', url), req));   // "/" nos assets = index.html do Concorde
    // (nos assets, "/cine.html" redireciona para "/cine": pede direto sem a extensão)
    const cine = () => env.ASSETS.fetch(new Request(new URL('/cine', url), req));
    if (req.method === 'GET' && principal) {
      if (path === '/') return utf8(await concordeApp());
      if (path === '/telinha' || path === '/telinha/') return utf8(await cine());
      // Links antigos (convite, e-mail de senha nova): /concorde?convite=… → /?convite=…
      if (path === '/concorde' || path.startsWith('/concorde/')) return Response.redirect(new URL('/' + url.search, url), 301);
    }
    if (req.method === 'GET' && path === '/') return utf8(await cine());
    if (req.method === 'GET' && (path === '/concorde' || path.startsWith('/concorde/'))) return utf8(await concordeApp());
    const room = path.match(/^\/s\/([A-Za-z0-9_-]{1,40})\/?$/);
    if (req.method === 'GET' && room) {
      // Página antiga do Cine Sacana (transmissor 1.x), enquanto a galera migra para o Concorde.
      // O Discord não roda JavaScript: o título da miniatura com o nome da sala tem que vir pronto no HTML.
      const page = utf8(await cine());
      const title = `${room[1]} tá ao vivo no Cine Sacana 🔥`;
      return new HTMLRewriter()
        .on('meta[property="og:title"]', { element: e => e.setAttribute('content', title) })
        .on('title', { element: e => e.setInnerContent(title) })
        .transform(page);
    }
    if (req.method === 'GET' && (path === '/baixar/windows' || path === '/baixar/android')) return baixarInstalador(env, req, url, path.endsWith('android'));
    if (req.method === 'POST' && path === '/api/registrar') return register(env, req);
    if (req.method === 'GET' && path === '/api/salas') return listRooms(env, req, url);
    if (SIGNALING.test(path)) return proxy(env, req, url);
    const api = path.match(ROOM_API);
    if (api) return roomApi(env, req, api[1], api[2]);
    if (path.startsWith('/api/')) return json({ erro: 'não encontrado' }, 404);
    return env.ASSETS.fetch(req); // SPA do Concorde (index.html para rotas desconhecidas)
  }
}

/**
 * Download do instalador do Windows (/baixar/windows) e do app do celular (/baixar/android) — os links do e-mail de
 * pedido aprovado. Os arquivos ficam no site em partes de até 25 MB (limite do Cloudflare por arquivo; ver
 * installer/gerar-concorde.ps1 e construir-apk.ps1): aqui elas são emendadas, na ordem, num download só.
 * Público de propósito: o instalador não tem segredo nenhum (sem convite dentro). Só entra parte da pasta certa.
 */
async function baixarInstalador(env, req, url, android) {
  // Trava: 5 downloads por minuto por endereço (ninguém gasta a banda do servidor baixando em loop).
  if (!(await comunidade(env).permitirDownload(req.headers.get('CF-Connecting-IP') || ''))) {
    return new Response('Muitos downloads em pouco tempo. Espere 1 minuto e tente de novo.', { status: 429, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' } });
  }
  const [manifesto, pasta, tipo, nome] = android
    ? ['/concorde-android/android.json', '/concorde-android/', 'application/vnd.android.package-archive', versao => `Caocorde-${versao}.apk`]
    : ['/concorde-app/versao.json', '/concorde-app/', 'application/vnd.microsoft.portable-executable', versao => `CaocordeInstalador-${versao}.exe`];
  const resposta = await env.ASSETS.fetch(new Request(new URL(manifesto, url)));
  const dados = resposta.ok ? await resposta.json().catch(() => null) : null;
  const partes = Array.isArray(dados?.partes) ? dados.partes : [];
  if (!partes.length || !partes.every(parte => typeof parte === 'string' && parte.startsWith(pasta) && !parte.includes('..'))) {
    return json({ erro: 'download indisponível agora' }, 503);
  }
  const { readable, writable } = new TransformStream();
  (async () => {
    try {
      for (const parte of partes) {
        const pedaco = await env.ASSETS.fetch(new Request(new URL(parte, url)));
        if (!pedaco.ok || !pedaco.body) throw new Error('parte faltando: ' + parte);
        await pedaco.body.pipeTo(writable, { preventClose: true });
      }
      await writable.close();
    } catch (erro) { await writable.abort(erro).catch(() => {}); }
  })();
  const versaoLimpa = String(dados.versao || '').replace(/[^0-9.]/g, '').slice(0, 20) || 'atual';
  return new Response(readable, {
    headers: {
      'Content-Type': tipo,
      'Content-Disposition': `attachment; filename="${nome(versaoLimpa)}"`,
      ...(Number(dados.tamanho) > 0 ? { 'Content-Length': String(Number(dados.tamanho)) } : {}),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Regra de segurança da página do Concorde (CSP): o navegador só roda e carrega o que está listado aqui.
 * Se alguém conseguir enfiar um <script> numa mensagem ou num nome (XSS), o navegador recusa: script só de
 * arquivo do próprio site. Cada linha diz o que libera e por quê:
 */
const REGRA_DE_SEGURANCA_DO_CONCORDE = [
  "default-src 'self'",                          // por padrão, só coisas do próprio site
  "script-src 'self' 'wasm-unsafe-eval'",        // scripts só de arquivos do site; WebAssembly = supressão de ruído (RNNoise)
  "style-src 'self' 'unsafe-inline'",            // a interface usa style="..." nos elementos (cores dos membros, tamanhos)
  "img-src 'self' data: blob: https:",           // fotos e anexos do site; capa da música vem do YouTube/SoundCloud (só https)
  "media-src 'self' blob:",                      // vídeos e áudios dos anexos, mensagens de voz, câmeras e telas da call
  "connect-src 'self'",                          // API, WebSocket do chat e atualização do app: tudo no próprio site
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",                           // nada de plugins (Flash, Java)
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",                      // ninguém coloca o Concorde dentro de outro site (golpe do clique escondido)
].join('; ');

/**
 * Cabeçalhos de segurança nas páginas HTML. A página antiga do Cine Sacana (Telinha) fica só com os básicos: ela
 * carrega coisas de fora e não é mexida (ver CLAUDE.md → Telinha).
 *   - X-Frame-Options / frame-ancestors: ninguém coloca a página dentro de outro site;
 *   - nosniff: o navegador não "adivinha" o tipo de arquivo;
 *   - Referrer-Policy: o endereço completo (com código de convite) não vaza para os links de fora;
 *   - HSTS: o navegador sempre usa https neste endereço;
 *   - Permissions-Policy: câmera, microfone e tela só para o próprio site; localização, pagamento e USB, ninguém.
 */
function cabecalhosDeSeguranca(resposta, paginaDoCineSacana) {
  if (!(resposta.headers.get('Content-Type') || '').startsWith('text/html')) return resposta;
  const comCabecalhos = new Response(resposta.body, resposta);
  comCabecalhos.headers.set('X-Frame-Options', 'DENY');
  comCabecalhos.headers.set('X-Content-Type-Options', 'nosniff');
  comCabecalhos.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  comCabecalhos.headers.set('Strict-Transport-Security', 'max-age=31536000');
  comCabecalhos.headers.set('Content-Security-Policy', paginaDoCineSacana ? "frame-ancestors 'none'" : REGRA_DE_SEGURANCA_DO_CONCORDE);
  if (!paginaDoCineSacana) {
    comCabecalhos.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()');
  }
  return comCabecalhos;
}

/** Páginas do Cine Sacana (Telinha): a lista de salas, /telinha e /s/<sala>. O resto é o Concorde. */
function ehPaginaDoCineSacana(url, caminho) {
  return caminho === '/telinha' || caminho === '/telinha/' || caminho === '/cine' || /^\/s\//.test(caminho)
    || (caminho === '/' && !ehPrincipal(url));
}

/**
 * Lê o corpo do upload parando no limite: quem mente o tamanho (ou manda sem dizer) não faz o Worker ler
 * 100 MB à toa. Devolve null se passou do limite.
 */
async function lerAte(req, max) {
  if (!req.body) return new Uint8Array(0);
  const leitor = req.body.getReader();
  const partes = [];
  let total = 0;
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { leitor.cancel().catch(() => {}); return null; }
    partes.push(value);
  }
  const tudo = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { tudo.set(p, i); i += p.byteLength; }
  return tudo;
}

// ---------------- Concorde: anexos do chat (R2) ----------------

const CHAVE_ARQUIVO = /^\d{13}-[0-9a-f-]{36}$/;

async function arquivos(env, req, url) {
  if (!env.ARQUIVOS) return json({ erro: 'Envio de arquivos ainda não foi ativado (R2).' }, 503);
  const stub = comunidade(env);
  const token = lerCookie(req);

  // Enviar: POST /api/arquivos?canal=ID, corpo = o arquivo, X-Nome = nome (encodeURIComponent).
  if (req.method === 'POST' && url.pathname === '/api/arquivos') {
    const tipo = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    const tamanho = Number(req.headers.get('Content-Length') || 0);
    let nome = '';
    try { nome = decodeURIComponent(req.headers.get('X-Nome') || ''); } catch { }
    const r = await stub.reservarArquivo(token, { canal: url.searchParams.get('canal'), nome, tipo, tamanho });
    if (r.erro) return json(r, r.erro === 'não logado' ? 401 : 400);
    const corpo = await lerAte(req, tamanho);
    if (!corpo || corpo.byteLength !== tamanho) return json({ erro: 'O arquivo chegou diferente do tamanho informado.' }, 400);
    await env.ARQUIVOS.put(r.chave, corpo, { httpMetadata: { contentType: tipo } });
    return json({ chave: r.chave, nome, tipo, tamanho });
  }

  // Baixar: GET /api/arquivos/<chave> (com Range, para pular no vídeo/áudio).
  const chave = url.pathname.slice('/api/arquivos/'.length);
  if (req.method !== 'GET' || !CHAVE_ARQUIVO.test(chave)) return json({ erro: 'não encontrado' }, 404);
  const info = await stub.arquivoPermitido(token, chave);
  if (!info) return json({ erro: 'não encontrado' }, 404);
  const pediuPedaco = req.headers.has('Range');
  const obj = await env.ARQUIVOS.get(chave, pediuPedaco ? { range: req.headers } : undefined);
  if (!obj) return json({ erro: 'Esse arquivo já foi apagado (fica 7 dias).' }, 404);
  const h = new Headers({
    'Content-Type': info.tipo, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=604800',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(info.nome)}`, 'X-Content-Type-Options': 'nosniff',
    // Mesmo que alguém consiga subir algo com script, aberto direto ele não roda nada nem lê a sessão.
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  if (pediuPedaco && obj.range) {
    const ini = obj.range.offset ?? (obj.size - obj.range.suffix);
    const len = obj.range.length ?? (obj.size - ini);
    h.set('Content-Range', `bytes ${ini}-${ini + len - 1}/${obj.size}`);
    h.set('Content-Length', String(len));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers: h });
}

// ---------------- Concorde: foto de perfil ----------------

/**
 * Padrão da foto: o app recorta e comprime para 256×256 (WebP, ~20-50 KB). Aqui só passa WebP ou JPEG de verdade
 * (confere os bytes do começo do arquivo e o tamanho em pixels), com até 256 KB e 512×512. Cada pessoa tem um
 * arquivo só no R2 (avatar/<id>), trocado no lugar: o espaço usado nunca passa de ~256 KB por pessoa.
 */
const AVATAR_MAX = 256 * 1024;
const AVATAR_LADO = 512;

/** Tipo e tamanho em pixels lidos do próprio arquivo (null se não for WebP/JPEG válido). */
function lerImagem(b) {
  const u16 = i => b[i] | (b[i + 1] << 8), u24 = i => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  // WebP: "RIFF" .... "WEBP" + bloco VP8 / VP8L / VP8X
  if (b.length > 30 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') {
    const bloco = String.fromCharCode(...b.slice(12, 16));
    if (bloco === 'VP8 ') return { tipo: 'image/webp', w: u16(26) & 0x3fff, h: u16(28) & 0x3fff };
    if (bloco === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { tipo: 'image/webp', w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (bloco === 'VP8X') return { tipo: 'image/webp', w: u24(24) + 1, h: u24(27) + 1 };
    return null;
  }
  // JPEG: FF D8, procura o bloco SOF (altura e largura)
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { tipo: 'image/jpeg', h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + len;
    }
  }
  return null;
}

async function avatar(env, req, url) {
  if (!env.ARQUIVOS) return json({ erro: 'Fotos ainda não foram ativadas (R2).' }, 503);
  const stub = comunidade(env);
  const token = lerCookie(req);

  // Ver: GET /api/avatar/<id>?v=<versão>
  const alvo = url.pathname.match(/^\/api\/avatar\/(\d{1,10})$/);
  if (req.method === 'GET' && alvo) {
    if (!(await stub.avatarVisivel(token, Number(alvo[1])))) return json({ erro: 'não encontrado' }, 404);
    const obj = await env.ARQUIVOS.get(`avatar/${alvo[1]}`);
    if (!obj) return json({ erro: 'não encontrado' }, 404);
    return new Response(obj.body, { headers: {
      'Content-Type': obj.httpMetadata?.contentType === 'image/jpeg' ? 'image/jpeg' : 'image/webp',
      'Content-Length': String(obj.size), 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // O endereço muda a cada troca (?v=), então pode guardar por muito tempo.
      'Cache-Control': 'private, max-age=31536000, immutable',
    } });
  }
  if (url.pathname !== '/api/avatar' || !['POST', 'DELETE'].includes(req.method)) return json({ erro: 'não encontrado' }, 404);

  const ok = await stub.avatarPermitido(token);
  if (ok.erro) return json(ok, ok.erro === 'não logado' ? 401 : 429);
  if (req.method === 'DELETE') {
    await env.ARQUIVOS.delete(`avatar/${ok.uid}`);
    return json({ membro: await stub.avatarTrocado(ok.uid, false) });
  }
  // Trocar: POST /api/avatar, corpo = a imagem já recortada pelo app.
  if (Number(req.headers.get('Content-Length') || 0) > AVATAR_MAX) return json({ erro: 'A foto tem que ter até 256 KB.' }, 413);
  const corpo = await lerAte(req, AVATAR_MAX);
  if (!corpo) return json({ erro: 'A foto tem que ter até 256 KB.' }, 413);
  const img = lerImagem(corpo);
  if (!img) return json({ erro: 'Foto inválida (só WebP ou JPEG).' }, 400);
  if (!(img.w > 0 && img.h > 0 && img.w <= AVATAR_LADO && img.h <= AVATAR_LADO)) return json({ erro: 'A foto tem que ter até 512×512.' }, 400);
  await env.ARQUIVOS.put(`avatar/${ok.uid}`, corpo, { httpMetadata: { contentType: img.tipo } });
  return json({ membro: await stub.avatarTrocado(ok.uid, true) });
}

// ---------------- Concorde: contas e WebSocket ----------------

const comunidade = env => env.COMUNIDADE.get(env.COMUNIDADE.idFromName('sacanas'));

function lerCookie(req) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]{64})`));
  return m?.[1] || null;
}

/** "Manter conectado": cookie de 1 ano; sem isso, cookie de sessão (some ao fechar o navegador/app). */
function comCookie(res, token, url, lembrar = true) {
  const seguro = url.protocol === 'https:' ? '; Secure' : '';
  res.headers.append('Set-Cookie', token
    ? `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/${lembrar ? '; Max-Age=31536000' : ''}${seguro}`
    : `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${seguro}`);
  return res;
}

async function concorde(env, req, url) {
  const stub = comunidade(env);
  const path = url.pathname;

  if (path === '/api/ws') {
    if (req.headers.get('Upgrade') !== 'websocket') return json({ erro: 'use WebSocket' }, 426);
    // Só a nossa página abre o WebSocket com o cookie de alguém (impede site de terceiros de usar a sessão).
    const origin = req.headers.get('Origin');
    const local = h => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h);
    if (origin && new URL(origin).host !== url.host && !(local(url.host) && local(new URL(origin).host))) {
      return json({ erro: 'origem não permitida' }, 403);
    }
    const headers = new Headers(req.headers);
    headers.set('X-Sessao', lerCookie(req) || '');
    return stub.fetch(new Request(req.url, { headers }));
  }

  if (path === '/api/eu') {
    const eu = await stub.eu(lerCookie(req));
    return eu ? json(eu) : json({ erro: 'não logado' }, 401);
  }

  if (req.method !== 'POST') return json({ erro: 'método' }, 405);
  if (path === '/api/auth/sair') {
    const token = lerCookie(req);
    if (token) await stub.sair(token);
    return comCookie(json({ ok: true }), null, url);
  }
  const body = await req.json().catch(() => ({}));
  if (path === '/api/auth/esqueci') {
    const r = await stub.pedirRedefinicao(body, url.origin, req.headers.get('CF-Connecting-IP') || '');
    return json(r, r.erro ? 400 : 200);
  }
  if (path === '/api/auth/redefinir') {
    const r = await stub.redefinirSenha(body);
    return json(r, r.erro ? 400 : 200);
  }
  if (path === '/api/auth/seguranca') {
    const s = await stub.atualizarSeguranca(lerCookie(req), body);
    return json(s, s.erro ? 400 : 200);
  }
  const ip = req.headers.get('CF-Connecting-IP') || '';
  // Convite de convidado (acesso temporário, só pelo navegador): ver de qual servidor é, e entrar só com o nome.
  if (path === '/api/auth/convidado-info') {
    const informacoes = await stub.informacoesDoConviteDeConvidado(body, ip);
    return json(informacoes, informacoes.erro ? 400 : 200);
  }
  if (path === '/api/auth/convidado') {
    const resultado = await stub.entrarComoConvidado(body, ip);
    if (resultado.erro) return json(resultado, 400);
    // Cookie de sessão (sem "manter conectado"): fechou o navegador, acabou o acesso de convidado.
    return comCookie(json({ ok: true }), resultado.token, url, false);
  }
  // Página inicial: "Tenho um código de convite" (confere antes do cadastro) e "Pedir acesso".
  if (path === '/api/auth/convite-validar') {
    const resultado = await stub.validarConviteDoApp(body, ip);
    return json(resultado, resultado.erro ? 400 : 200);
  }
  if (path === '/api/auth/pedir-acesso') {
    const resultado = await stub.pedirAcesso(body, ip);
    return json(resultado, resultado.erro ? 400 : 200);
  }
  const r = path === '/api/auth/registrar' ? await stub.registrar(body, ip)
    : path === '/api/auth/entrar' ? await stub.entrar(body, ip)
    : { erro: 'não encontrado' };
  if (r.erro) return json(r, 400);
  return comCookie(json({ ok: true }), r.token, url, body.lembrar !== false);
}

// ---------------- Concorde: Realtime (SFU) ----------------

// Só as chamadas que o app usa: criar sessão, publicar/puxar trilhas, renegociar, fechar trilhas e ver a sessão.
const SFU_ROTAS = [
  ['POST', /^sessions\/new$/],
  ['POST', /^sessions\/[A-Za-z0-9_-]{1,100}\/tracks\/new$/],
  ['PUT', /^sessions\/[A-Za-z0-9_-]{1,100}\/(renegotiate|tracks\/close)$/],
  ['GET', /^sessions\/[A-Za-z0-9_-]{1,100}$/],
];

async function sfu(env, req, path) {
  const rota = path.slice('/api/sfu/'.length);
  if (!SFU_ROTAS.some(([m, re]) => m === req.method && re.test(rota))) return json({ erro: 'não encontrado' }, 404);
  if (!env.CF_APP_ID || !env.CF_APP_TOKEN) return json({ erro: 'Realtime não configurado' }, 503);
  // Cada sessão do SFU é de quem criou: ninguém fecha ou renegocia a câmera/tela de outra pessoa.
  const stub = comunidade(env);
  const sessao = rota === 'sessions/new' ? null : rota.split('/')[1];
  const uid = await stub.sfuPermitido(lerCookie(req), sessao);
  if (!uid) return json({ erro: sessao ? 'sessão de outra pessoa' : 'não logado' }, sessao ? 403 : 401);
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${env.CF_APP_ID}/${rota}`, {
    method: req.method,
    headers: { Authorization: `Bearer ${env.CF_APP_TOKEN.replace(/^﻿/, '').trim()}`, 'Content-Type': 'application/json' },
    body: req.method === 'GET' ? undefined : (await req.text()) || undefined,
  });
  if (sessao === null && res.ok) {
    const corpo = await res.json();
    if (corpo.sessionId) await stub.sfuCriada(uid, corpo.sessionId);
    return json(corpo, res.status);
  }
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}

async function register(env, req) {
  // trim: secrets gravados pelo terminal podem vir com quebra de linha/BOM no fim ou no começo.
  const expected = (env.SENHA_REGISTRO || '').replace(/^﻿/, '').trim();
  const given = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/, '').trim();
  if (!expected || given !== expected) {
    return json({ erro: 'não autorizado' }, 401);
  }
  const { url } = await req.json();
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url || '')) return json({ erro: 'url inválida' }, 400);
  await origin(env).set(url);
  return json({ ok: true });
}

async function proxy(env, req, url) {
  const target = await origin(env).get();
  if (!target) return json({ erro: 'servidor desligado' }, 503);

  const headers = new Headers();
  for (const h of ['Content-Type', 'Authorization', 'If-Match']) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('X-Forwarded-For', req.headers.get('CF-Connecting-IP') || '');

  try {
    const res = await fetch(target + url.pathname + url.search, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
      redirect: 'manual',
    });
    // Túnel antigo (desktop reiniciou e ainda não se registrou de novo) responde 530/1033.
    if (res.status === 530) return json({ erro: 'servidor desligado' }, 503);
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch {
    return json({ erro: 'servidor desligado' }, 503);
  }
}

/** Salas ao vivo (vêm do desktop) + o que cada uma está transmitindo (guardado aqui). */
async function listRooms(env, req, url) {
  const res = await proxy(env, req, url);
  if (!res.ok) return res;
  const rooms = await res.json().catch(() => []);
  await Promise.all(rooms.map(async r => { r.info = await room(env, r.nome).getInfo().catch(() => null); }));
  return json(rooms);
}

async function roomApi(env, req, name, what) {
  const stub = room(env, name);
  if (what === 'ws') {
    if (req.headers.get('Upgrade') !== 'websocket') return json({ erro: 'use WebSocket' }, 426);
    return stub.fetch(req);
  }
  if (req.method === 'GET') return json(await stub.getInfo());
  if (req.method === 'POST') {
    // Mesma senha de transmissão do MediaMTX (só quem transmite troca o título da sala).
    const auth = req.headers.get('Authorization') || '';
    const pass = auth.startsWith('Basic ') ? atob(auth.slice(6)).split(':').slice(1).join(':') : '';
    if (!env.SENHA_TRANSMISSAO || pass.trim() !== env.SENHA_TRANSMISSAO.replace(/^﻿/, '').trim()) return json({ erro: 'não autorizado' }, 401);
    const body = await req.json().catch(() => ({}));
    await stub.setInfo({ fonte: clean(body.fonte, 60), qualidade: clean(body.qualidade, 30), desde: Date.now() });
    return json({ ok: true });
  }
  return json({ erro: 'método' }, 405);
}

const origin = env => env.ORIGEM.get(env.ORIGEM.idFromName('desktop'));
const room = (env, name) => env.SALA.get(env.SALA.idFromName(name.toLowerCase()));

/** Texto de usuário: sem caracteres de controle, sem espaços nas pontas e com tamanho máximo. */
function clean(v, max) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

/**
 * Uma sala: bate-papo, reações e o "o que está passando". WebSockets com hibernação
 * (o objeto dorme entre mensagens, então não gasta nada parado).
 */
export class Sala extends DurableObject {
  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const cutoff = Date.now() - 6 * 3600_000; // conversa de mais de 6 h atrás não aparece
    const hist = ((await this.ctx.storage.get('hist')) || []).filter(m => m.hora > cutoff);
    server.send(JSON.stringify({ t: 'boas-vindas', hist, info: await this.getInfo(), online: this.ctx.getWebSockets().length }));
    this.broadcast({ t: 'online', n: this.ctx.getWebSockets().length });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    // No máximo uma mensagem a cada 400 ms por pessoa (evita flood de reação/chat).
    const now = Date.now();
    const last = ws.deserializeAttachment()?.last || 0;
    if (now - last < 400) return;
    ws.serializeAttachment({ last: now });

    if (m.t === 'chat') {
      const texto = clean(m.texto, 300);
      if (!texto) return;
      const msg = { t: 'chat', nome: clean(m.nome, 24) || 'anônimo', texto, hora: now };
      const hist = ((await this.ctx.storage.get('hist')) || []).slice(-49);
      hist.push(msg);
      await this.ctx.storage.put('hist', hist);
      this.broadcast(msg);
    } else if (m.t === 'reacao' && REACTIONS.includes(m.emoji)) {
      this.broadcast({ t: 'reacao', emoji: m.emoji });
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch { }
    this.broadcast({ t: 'online', n: this.ctx.getWebSockets().filter(s => s !== ws).length });
  }

  async webSocketError(ws) { await this.webSocketClose(ws); }

  async getInfo() { return (await this.ctx.storage.get('info')) || null; }

  async setInfo(info) {
    await this.ctx.storage.put('info', info);
    this.broadcast({ t: 'info', info });
  }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(s); } catch { } }
  }
}

export class Origem extends DurableObject {
  async get() { return (await this.ctx.storage.get('url')) || null; }
  async set(url) { await this.ctx.storage.put('url', url); }
}

/** Página com o charset declarado no cabeçalho (sem isso, prévias de link podem estragar acentos). */
function utf8(res) {
  const out = new Response(res.body, res);
  out.headers.set('Content-Type', 'text/html; charset=utf-8');
  return out;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
