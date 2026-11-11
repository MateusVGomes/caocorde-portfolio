// Cine Sacana — página de quem assiste.
// /s/<sala> → assiste aquela sala; "/" → lista de quem está ao vivo.
createIcons();

const $ = id => document.getElementById(id);
const room = decodeURIComponent(location.pathname.match(/^\/s\/([^/]+)/)?.[1] || '');
const video = $('video');
let pc, retryTimer, statsTimer, joined = false;

// ---------- tema claro/escuro (preferência só deste navegador) ----------
$('theme-toggle').onclick = () => {
  const dark = document.documentElement.classList.toggle('dark');
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
};

// ---------- aviso rápido no canto ----------
let toastTimer;
function showToast(msg) {
  $('toast-message').textContent = msg;
  $('toast').classList.remove('translate-y-20', 'opacity-0');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('translate-y-20', 'opacity-0'), 3000);
}

// ---------- salas ao vivo: seletor do cabeçalho + lista da página inicial ----------
const roomLabel = r => `🔥 Assistindo: ${r.nome}${r.info?.fonte ? ` (${r.info.fonte})` : ''}`;

async function refreshRooms() {
  let rooms = [];
  try {
    const res = await fetch('/api/salas');
    rooms = res.ok ? await res.json() : [];
  } catch {}
  const sel = $('streamer-selector');
  sel.replaceChildren(...rooms.map(r => new Option(roomLabel(r), r.nome, false, r.nome === room)));
  if (room && !rooms.some(r => r.nome === room)) sel.prepend(new Option(`Sala: ${room} (fora do ar)`, room, true, true));
  if (!sel.options.length) sel.append(new Option('Ninguém ao vivo', ''));
  if (room) sel.value = room;

  const me = rooms.find(r => r.nome === room);
  if (room) {
    setViewers(me?.espectadores);
    if (me?.info) setInfo(me.info);
    if (!joined) $('landing-room-text').textContent = me ? 'tá ao vivo aprontando alguma...' : 'não tá transmitindo agora — pode entrar que começa sozinho quando ligar.';
  } else {
    $('home-text').textContent = rooms.length ? 'Quem tá ao vivo agora:' : 'Ninguém aprontando agora… volta daqui a pouco.';
    $('rooms').replaceChildren(...rooms.map(r => {
      const li = document.createElement('li');
      li.innerHTML = `<a class="flex items-center justify-between gap-3 px-4 py-3 bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800/80 hover:border-brand-500 rounded-2xl backdrop-blur-md transition-all text-left">
        <span class="flex items-center gap-3 min-w-0"><span class="w-9 h-9 flex-shrink-0 rounded-xl bg-gradient-to-tr from-brand-600 to-amber-500 flex items-center justify-center font-black text-white"></span>
        <span class="min-w-0"><span class="block font-extrabold text-white truncate"></span><span class="block text-[11px] text-slate-400 truncate"></span></span></span>
        <span class="text-[11px] font-bold text-slate-300 flex items-center gap-1 flex-shrink-0"><span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span><span></span></span></a>`;
      const a = li.firstElementChild;
      a.href = '/s/' + encodeURIComponent(r.nome);
      const spans = a.querySelectorAll('span');
      spans[1].textContent = r.nome[0]?.toUpperCase() || '?';
      spans[3].textContent = r.nome;
      spans[4].textContent = [r.info?.fonte, r.info?.qualidade].filter(Boolean).join(' • ') || 'ao vivo';
      spans[7].textContent = `${r.espectadores} assistindo`;
      return li;
    }));
  }
}
$('streamer-selector').onchange = e => { if (e.target.value && e.target.value !== room) location.href = '/s/' + encodeURIComponent(e.target.value); };

function setViewers(n) {
  if (n == null) return;
  $('tag-viewers').classList.remove('hidden');
  $('landing-viewers').textContent = n === 1 ? '1 assistindo' : `${n} assistindo`;
  $('hud-viewers').textContent = n;
}

function setInfo(info) {
  if (!info) return;
  if (info.fonte) {
    $('tag-source').classList.remove('hidden');
    $('stream-source-name').textContent = info.fonte;
    $('stream-app-footer-name').textContent = info.fonte;
  }
  if (info.qualidade) {
    $('tag-quality').classList.remove('hidden');
    $('tag-quality').textContent = info.qualidade;
  }
}

// ---------- vídeo (WHEP: o navegador oferece, o repetidor responde) ----------
function setStatus(text) {
  $('status').classList.toggle('hidden', !text);
  $('status-text').textContent = text || '';
}

function setConn(kind, text) {
  const color = { ok: 'emerald', wait: 'amber', bad: 'red' }[kind];
  $('conn-state').className = `text-xs font-semibold flex items-center gap-1 text-${color}-400`;
  $('conn-dot').className = `w-2 h-2 rounded-full bg-${color}-500`;
  $('conn-text').textContent = text;
}
// (para o Tailwind gerar as cores usadas acima: text-emerald-400 text-amber-400 text-red-400 bg-emerald-500 bg-amber-500 bg-red-500)

function waitIce() {
  return new Promise(ok => {
    if (pc.iceGatheringState === 'complete') return ok();
    pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && ok());
    setTimeout(ok, 1500);
  });
}

async function connect() {
  clearTimeout(retryTimer);
  if (pc) { pc.onconnectionstatechange = null; pc.close(); }
  setStatus('Conectando…');
  setConn('wait', 'Conectando…');
  const stream = new MediaStream();
  video.srcObject = stream;
  try {
    pc = new RTCPeerConnection();
    pc.ontrack = e => stream.addTrack(e.track);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') { setStatus(''); setConn('ok', 'Conectado via Cloudflare'); }
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        setStatus('Conexão perdida — tentando de novo…');
        setConn('wait', 'Reconectando…');
        retryTimer = setTimeout(connect, 2000);
      }
    };
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    for (const r of pc.getReceivers()) if ('jitterBufferTarget' in r) r.jitterBufferTarget = 0;
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce();
    const res = await fetch(`/${encodeURIComponent(room)}/whep`, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
    if (res.status === 404) throw Object.assign(new Error('offline'), { offline: true });
    if (res.status === 503) throw new Error('o servidor está desligado');
    if (!res.ok) throw new Error('servidor respondeu ' + res.status);
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    await video.play().catch(() => {});
  } catch (err) {
    setStatus(err.offline ? `${room} não tá transmitindo agora — esperando começar…` : `Transmissão indisponível (${err.message}) — tentando de novo…`);
    setConn(err.offline ? 'wait' : 'bad', err.offline ? 'Esperando a live' : 'Sem conexão');
    retryTimer = setTimeout(connect, 3000);
  }
}

let lastBytes = 0, lastTime = 0, connectedFor = 0, warnedNoVideo = false;
async function updateStats() {
  if (!pc) return;
  const report = await pc.getStats();
  let frames = 0;
  report.forEach(s => {
    if (s.type === 'inbound-rtp' && s.kind === 'video') {
      frames = s.framesDecoded || 0;
      const now = s.timestamp, kbps = lastTime ? ((s.bytesReceived - lastBytes) * 8 / (now - lastTime)) : 0;
      lastBytes = s.bytesReceived; lastTime = now;
      if (s.frameHeight) $('hud-quality').textContent = `${s.frameHeight}p ${Math.round(s.framesPerSecond || 0)}fps`;
      $('stats').textContent = `${(kbps / 1000).toFixed(1)} Mbps`;
    }
  });
  // Conectado e nenhuma imagem depois de 6 s: em vez de tela preta muda, diz o que está acontecendo.
  connectedFor = pc.connectionState === 'connected' ? connectedFor + 1 : 0;
  if (connectedFor >= 6 && frames === 0) {
    setStatus('Chegou só o áudio, a imagem não veio 😕 Peça pra quem está transmitindo clicar em Parar e Transmitir de novo.');
    warnedNoVideo = true;
  } else if (warnedNoVideo && frames > 0) {
    setStatus('');
    warnedNoVideo = false;
  }
}

// ---------- controles do player ----------
$('btn-join-stream').onclick = () => {
  joined = true;
  $('landing-screen').classList.add('hidden');
  $('stream-screen').classList.remove('hidden');
  connect();
  statsTimer = setInterval(updateStats, 1000);
  showToast('Você entrou na transmissão!');
};

$('btn-play-pause').onclick = () => {
  if (video.paused) video.play(); else video.pause();
};
video.onplay = video.onpause = () => {
  $('icon-pause').classList.toggle('hidden', video.paused);
  $('icon-play').classList.toggle('hidden', !video.paused);
};

function syncMute() {
  $('icon-vol').classList.toggle('hidden', video.muted);
  $('icon-muted').classList.toggle('hidden', !video.muted);
}
$('btn-mute').onclick = () => { video.muted = !video.muted; syncMute(); };
$('volume-slider').oninput = e => { video.volume = e.target.value / 100; video.muted = false; syncMute(); };

const toggleFull = () => document.fullscreenElement ? document.exitFullscreen() : $('player').requestFullscreen();
$('btn-fullscreen').onclick = toggleFull;
video.ondblclick = toggleFull;

$('btn-share-room').onclick = async () => {
  const link = `${location.origin}/s/${encodeURIComponent(room)}`;
  try { await navigator.clipboard.writeText(link); showToast('Link da live copiado!'); }
  catch { prompt('Copie o link da live:', link); }
};

// ---------- reações e bate-papo (WebSocket da sala no Worker) ----------
let ws, wsRetry = 1000;
const COLORS = [
  ['bg-indigo-600', 'text-indigo-400'], ['bg-emerald-600', 'text-emerald-400'], ['bg-amber-600', 'text-amber-400'],
  ['bg-purple-600', 'text-purple-400'], ['bg-pink-600', 'text-pink-400'], ['bg-sky-600', 'text-sky-400'],
];
const colorOf = name => COLORS[[...name].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) % COLORS.length];

function connectChat() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/sala/${encodeURIComponent(room)}/ws`);
  ws.onopen = () => { wsRetry = 1000; };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'boas-vindas') { m.hist.forEach(addChat); setInfo(m.info); setOnline(m.online); }
    else if (m.t === 'chat') addChat(m);
    else if (m.t === 'reacao') spawnFloatingEmoji(m.emoji);
    else if (m.t === 'online') setOnline(m.n);
    else if (m.t === 'info') setInfo(m.info);
  };
  ws.onclose = () => { setTimeout(connectChat, wsRetry); wsRetry = Math.min(wsRetry * 2, 15000); };
}
const send = obj => ws?.readyState === 1 && ws.send(JSON.stringify(obj));
const setOnline = n => { $('chat-online').textContent = n > 1 ? `${n} na sala` : 'Modo Galera'; };

function addChat(m) {
  const [bg, fg] = colorOf(m.nome);
  const div = document.createElement('div');
  div.className = 'flex items-start gap-2.5 animate-fade-in';
  div.innerHTML = `<div class="w-7 h-7 rounded-lg ${bg} flex items-center justify-center font-bold text-white text-xs flex-shrink-0 shadow"></div>
    <div class="min-w-0"><div class="flex items-center gap-2"><span class="font-extrabold ${fg}"></span><span class="text-[10px] text-slate-500"></span></div>
    <p class="text-slate-200 font-medium mt-0.5 break-words"></p></div>`;
  div.children[0].textContent = [...m.nome][0]?.toUpperCase() || '?';
  const spans = div.querySelectorAll('span');
  spans[0].textContent = m.nome;
  spans[1].textContent = new Date(m.hora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.querySelector('p').textContent = m.texto;
  const box = $('chat-messages');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.append(div);
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function spawnFloatingEmoji(emoji) {
  const el = document.createElement('div');
  el.textContent = emoji;
  el.className = 'absolute text-3xl font-bold select-none animate-float-up pointer-events-none';
  el.style.left = (Math.floor(Math.random() * 70) + 15) + '%';
  el.style.bottom = '10px';
  $('floating-reactions-container').append(el);
  setTimeout(() => el.remove(), 2500);
}

document.querySelectorAll('.reaction-btn').forEach(b => b.onclick = () => send({ t: 'reacao', emoji: b.dataset.emoji }));

try { $('chat-name').value = localStorage.getItem('telinha.nome') || ''; } catch {}
$('chat-form').onsubmit = e => {
  e.preventDefault();
  const nome = $('chat-name').value.trim(), texto = $('chat-input').value.trim();
  if (!nome || !texto) return;
  try { localStorage.setItem('telinha.nome', nome); } catch {}
  if (!send({ t: 'chat', nome, texto })) { showToast('Bate-papo reconectando… tenta de novo já já'); return; }
  $('chat-input').value = '';
};

// ---------- início ----------
if (room) {
  document.title = `${room} — Cine Sacana 🔥`;
  $('landing-room').classList.remove('hidden');
  $('streamer-name-landing').textContent = room;
  $('room-tag-hud').textContent = '#' + room.toUpperCase();
  $('stream-card-title').textContent = `Sala de ${room} com os Parças`;
  document.querySelectorAll('.streamer-active-name').forEach(el => el.textContent = room);
  $('streamer-avatar-box').textContent = [...room][0]?.toUpperCase() || '?';
  connectChat();
} else {
  $('landing-home').classList.remove('hidden');
}
refreshRooms();
setInterval(refreshRooms, 10000);
