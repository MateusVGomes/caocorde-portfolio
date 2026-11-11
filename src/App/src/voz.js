// Call do Concorde: voz, câmera e tela pelo Cloudflare Realtime (SFU), igual Discord.
// Cada pessoa tem UMA sessão no SFU (um RTCPeerConnection): publica as próprias trilhas uma vez e
// "puxa" as dos outros. O Cloudflare cobra o que sai para quem recebe, então só puxamos o que está em uso:
//   - microfones de quem está na mesma call (sempre);
//   - câmeras só com a tela da call aberta e a janela visível;
//   - tela (e o som dela) só de quem a pessoa clicou em "Assistir".
import { signal, computed, effect } from '@preact/signals';
import { eu, enviar, aviso, canalAtual, canais, vozEstado, eventosVoz, appDesktop, appAndroid, musica, caladosPelaConta, bloqueados } from './store.js';
import { statsEnvio, lerEnvioNavegador, lerRecebimento } from './Estatisticas.js';
import processadorFocoNaVoz from './audio/rnnoise-foco-na-voz.worklet.js?url';
import rnnoiseWasm from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimd from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

/** Dentro do app desktop: transmissão pela captura nativa (placa de vídeo, som por app, cursor em jogo). */
export const nativo = appDesktop?.nativo || null;
/** No celular (app Android): compartilhar a tela pelo próprio Android e manter a call viva em segundo plano. */
export const android = appAndroid?.nativo || null;

export const minhaCall = signal(null);          // { canal, conectando } enquanto estiver numa call
// No celular: a call continua viva com a tela desligada (serviço do Android) enquanto a pessoa estiver numa call.
effect(() => { const c = minhaCall.value; android?.emCall(!!c).catch(() => {}); });
export const mudo = signal(false);
export const surdo = signal(false);
export const falando = signal(new Set());       // uids falando agora
export const assistindo = signal(new Set());    // uids cuja tela estou assistindo
export const midias = signal(new Map());        // `${uid}:${tipo}` → MediaStream (tipo: cam | tela)
export const minhas = signal({});               // trilhas que eu publico: { mic, cam, tela, telaAudio, telaInfo }
export const volumes = signal(lerVolumes());    // uid → 0..1

export const QUALIDADES = {
  '720p30': { altura: 720, fps: 30, bitrate: 2_500_000, nome: '720p 30fps' },
  '720p60': { altura: 720, fps: 60, bitrate: 4_000_000, nome: '720p 60fps' },
  '1080p30': { altura: 1080, fps: 30, bitrate: 4_500_000, nome: '1080p 30fps' },
  '1080p60': { altura: 1080, fps: 60, bitrate: 6_000_000, nome: '1080p 60fps' },
};
// Padrões econômicos: voz ~40 kbps, câmera 360p ~400 kbps, tela 720p30 2,5 Mbps (dá para subir na hora de transmitir).
const BITRATE_VOZ = 40_000;
const BITRATE_CAM = 400_000;

const visivel = signal(!document.hidden);
document.addEventListener('visibilitychange', () => { visivel.value = !document.hidden; });
/** Câmeras só valem a pena com a call na tela. */
export const vendoCall = computed(() => !!minhaCall.value && canalAtual.value === minhaCall.value.canal && visivel.value);

export const pessoasNaCall = canal => vozEstado.value[canal] || [];

// Modo de teste (localStorage concorde-teste-midia = 1): tom e vídeo sintéticos no lugar de microfone, câmera e tela.
const teste = (() => { try { return localStorage.getItem('concorde-teste-midia') === '1'; } catch { return false; } })();
function falsa(tipo) {
  if (tipo === 'audio') {
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination();
    o.frequency.value = 330; o.connect(d); o.start();
    return d.stream;
  }
  const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 }), g = c.getContext('2d');
  setInterval(() => { g.fillStyle = tipo === 'tela' ? '#1e3a8a' : '#065f46'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText(`${tipo} ${new Date().toLocaleTimeString()}`, 120, 190); }, 50);
  return c.captureStream(20);
}
/** Microfone, câmera e saída de som escolhidos em Configurações (vazio = o padrão do Windows). */
export const dispositivos = signal(lerJson('dispositivos', { mic: '', cam: '', saida: '' }));
/**
 * Filtro de ruído do microfone, em 3 níveis (como o "isolamento de voz" do Discord):
 *  - 'sem'     → Sem filtro: passa tudo (só tira o eco). Para quando você QUER que ouçam o ambiente.
 *  - 'estudio' → Estúdio (o PADRÃO, igual ao filtro de até a 0.5.7): RNNoise; tira chiado, microfonia e ruído de
 *                fundo, mas o som do ambiente ainda passa.
 *  - 'foco'    → Foco na voz: RNNoise + portão de voz. O portão só abre quando o RNNoise detecta VOZ (e não tom de
 *                máquina); furadeira, teclado e cachorro não passam (src/audio/rnnoise-foco-na-voz.worklet.js).
 * Quem tinha desligado a antiga "supressão forte" vai para 'sem'; o resto, para 'estudio'.
 */
export const NIVEIS_DO_FILTRO_DE_RUIDO = ['sem', 'estudio', 'foco'];

/**
 * Faixa de volume da voz no "Foco na voz" (dB, 0 = o máximo do microfone): abaixo do mínimo (menos que um sussurro)
 * e acima do máximo (mais que falar alto: grito, pancada, furadeira colada) o portão não abre.
 * Padrão: -50 a -10 dB. A pessoa ajusta nas Configurações olhando o medidor (nivelDoMicrofone).
 */
export const FAIXA_DA_VOZ_PADRAO = { minimoEmDb: -50, maximoEmDb: -10 };
export const faixaDaVoz = signal(lerJson('faixaDaVoz', FAIXA_DA_VOZ_PADRAO));
/** Medidor ao vivo do microfone (só com o microfone aberto numa call): { volumeEmDb, portaoAberto } ou null. */
export const nivelDoMicrofone = signal(null);
/** O nó do filtro de ruído que está tocando agora (para mandar a faixa nova sem reabrir o microfone). */
let noDoFiltroAtual = null;

/** Muda a faixa da voz (vale na hora, mesmo no meio da call). */
export function mudarFaixaDaVoz(mudancas) {
  const nova = { ...faixaDaVoz.value, ...mudancas };
  // O mínimo fica sempre pelo menos 6 dB abaixo do máximo (senão quase nada passaria).
  if (nova.minimoEmDb > nova.maximoEmDb - 6) {
    if ('minimoEmDb' in mudancas) nova.minimoEmDb = nova.maximoEmDb - 6; else nova.maximoEmDb = nova.minimoEmDb + 6;
  }
  faixaDaVoz.value = nova;
  try { localStorage.setItem('faixaDaVoz', JSON.stringify(nova)); } catch {}
  noDoFiltroAtual?.port.postMessage({ tipo: 'faixa-da-voz', ...nova });
}
export const nivelDoFiltroDeRuido = signal((() => {
  try {
    const nivelGuardado = localStorage.getItem('filtroDeRuido');
    if (NIVEIS_DO_FILTRO_DE_RUIDO.includes(nivelGuardado)) return nivelGuardado;
    return localStorage.getItem('supressaoForte') === 'false' ? 'sem' : 'estudio';
  } catch { return 'estudio'; }
})());
function lerJson(k, padrao) { try { return { ...padrao, ...JSON.parse(localStorage.getItem(k)) }; } catch { return padrao; } }

const TIPO_APARELHO = { mic: ['audioinput', 'O microfone escolhido', 'ligado'], cam: ['videoinput', 'A câmera escolhida', 'ligada'], saida: ['audiooutput', 'A saída de som escolhida', 'ligada'] };

/**
 * Código do aparelho escolhido que vale AGORA. O Windows/WebView pode trocar o código (reiniciou o PC, reconectou
 * o fone): aí acha o mesmo aparelho pelo nome e atualiza. Antes ele caía calado no padrão do Windows — e o
 * Concorde ficava ouvindo o microfone errado (o do Discord, por exemplo) sem ninguém saber.
 */
async function aparelhoAtual(tipo) {
  const id = dispositivos.value[tipo];
  if (!id) return '';
  const [kind, nomeTipo, ligado] = TIPO_APARELHO[tipo];
  const lista = (await navigator.mediaDevices?.enumerateDevices().catch(() => [])) || [];
  const achado = lista.find(d => d.kind === kind && d.deviceId === id);
  if (achado) {
    // Escolha feita antes desta versão: guarda o nome agora, para a próxima vez que o código mudar.
    if (achado.label && dispositivos.value[tipo + 'Nome'] !== achado.label) {
      dispositivos.value = { ...dispositivos.value, [tipo + 'Nome']: achado.label };
      try { localStorage.setItem('dispositivos', JSON.stringify(dispositivos.value)); } catch {}
    }
    return id;
  }
  const nome = dispositivos.value[tipo + 'Nome'];
  const mesmo = nome && lista.find(d => d.kind === kind && d.label === nome);
  if (mesmo) {
    dispositivos.value = { ...dispositivos.value, [tipo]: mesmo.deviceId };
    try { localStorage.setItem('dispositivos', JSON.stringify(dispositivos.value)); } catch {}
    return mesmo.deviceId;
  }
  // Só avisa quando dá para ter certeza (com os nomes liberados a lista está completa).
  if (lista.some(d => d.kind === kind && d.label))
    aviso.value = `${nomeTipo}${nome ? ` (${nome})` : ''} não está ${ligado} — usando o padrão do Windows. Troque em Configurações → Voz e vídeo.`;
  return '';
}

/** getUserMedia no aparelho escolhido; se ele sumiu (fone desconectado), cai no padrão — e avisa. */
async function pegarMidia(r) {
  if (teste) return falsa(r.video ? 'cam' : 'audio');
  const id = await aparelhoAtual(r.video ? 'cam' : 'mic');
  if (id) {
    const tipo = r.video ? 'video' : 'audio';
    try { return await navigator.mediaDevices.getUserMedia({ [tipo]: { ...r[tipo], deviceId: { exact: id } } }); } catch {}
  }
  return navigator.mediaDevices.getUserMedia(r);
}
/** Microfone escolhido em Configurações (mensagem de voz do chat). */
export const pegarMicrofone = () => pegarMidia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
const pegarTela = r => teste ? Promise.resolve(falsa('tela')) : navigator.mediaDevices.getDisplayMedia(r);

// ---------------- sessão no SFU ----------------

// Duas conexões: uma só para ENVIAR (o app oferece) e outra só para RECEBER (o SFU oferece). Numa conexão só,
// o Chrome e o Cloudflare escolhem IDs diferentes para as extensões RTP e a renegociação quebra
// ("RTP extension ID reassignment not supported") ao fechar/abrir trilhas.
let pc = null, sessao = null, contador = 0;   // envio: microfone, câmera, tela
let pcR = null, sessaoR = null;               // recebimento: o que puxamos dos outros
const locais = {};               // tipo → { track, tr, nome }
const puxadas = new Map();       // `${sessao}/${nome}` → { tr, uid, tipo, stream }
const audios = new Map();        // chave de puxada → <audio> (mic e som da tela)
let fila = Promise.resolve();
if (teste) window.__call = { pc: () => pcR, pcEnvio: () => pc, locais, puxadas, midias, vendoCall, visivel, musica, minhaCall, audios: () => audios, ctx: () => ctxAudio };

/** Mexidas no RTCPeerConnection uma de cada vez (oferta/resposta não pode cruzar). */
function emFila(f) {
  const meu = pc;
  fila = fila.then(() => (pc && pc === meu ? f() : undefined)).catch(e => {
    console.error('[call]', e);
    if (pc === meu && minhaCall.value) reconectar();
  });
  return fila;
}

/** Negociação deu errado (a conexão fica num estado sem volta): sai e entra de novo na mesma call. */
let ultimaReconexao = 0;
function reconectar() {
  const canal = minhaCall.value.canal;
  if (Date.now() - ultimaReconexao < 15_000) { aviso.value = 'A call travou — saia e entre de novo.'; return sairVoz(); }
  ultimaReconexao = Date.now();
  aviso.value = 'A call deu um soluço, reconectando…';
  sairVoz(true);
  entrarVoz(canal);
}

async function api(rota, metodo, corpo) {
  if (teste) console.log("[call] api", metodo, rota, JSON.stringify(corpo?.tracks || ""));
  const r = await fetch('/api/sfu/' + rota, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo && JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errorCode) throw new Error(j.errorDescription || j.erro || `SFU ${r.status}`);
  return j;
}

async function publicar(tipo, track, encoding) {
  const tr = pc.addTransceiver(track, { direction: 'sendonly', sendEncodings: [encoding] });
  await pc.setLocalDescription(await pc.createOffer());
  const nome = `${tipo === 'telaAudio' ? 'tela-audio' : tipo}-${++contador}`;
  const r = await api(`sessions/${sessao}/tracks/new`, 'POST', {
    sessionDescription: { type: 'offer', sdp: pc.localDescription.sdp },
    tracks: [{ location: 'local', mid: tr.mid, trackName: nome }],
  });
  await pc.setRemoteDescription(r.sessionDescription);
  locais[tipo] = { track, tr, nome };
}

/**
 * Fecha trilhas (minhas ou puxadas) no SFU. O transceiver é parado (m-line rejeitada) e não só "inactive":
 * com "inactive" o Chrome recusa a resposta do SFU (as extensões RTP vêm com outros IDs).
 */
async function fechar(trs, recebidas = false) {
  if (!trs.length) return;
  const [con, ses] = recebidas ? [pcR, sessaoR] : [pc, sessao];
  // Na conexão de receber quem oferece é sempre o SFU: fecha sem renegociar (o Chrome nunca faz oferta nela).
  // Na de enviar, se não sobrar nenhuma trilha ativa, uma oferta sem BUNDLE seria recusada: fecha do mesmo jeito.
  const sobra = !recebidas && con.getTransceivers().some(tr => !trs.includes(tr) && tr.currentDirection !== 'stopped' && tr.direction !== 'stopped');
  if (recebidas || !sobra) {
    if (!recebidas) for (const tr of trs) { tr.sender.replaceTrack(null).catch(() => {}); tr.direction = 'inactive'; }
    await api(`sessions/${ses}/tracks/close`, 'PUT', { tracks: trs.map(tr => ({ mid: tr.mid })), force: true }).catch(() => null);
    return;
  }
  for (const tr of trs) tr.stop();
  await con.setLocalDescription(await con.createOffer());
  const r = await api(`sessions/${ses}/tracks/close`, 'PUT', {
    tracks: trs.map(tr => ({ mid: tr.mid })),
    sessionDescription: { type: 'offer', sdp: con.localDescription.sdp },
    force: false,
  }).catch(() => null);   // quem saiu da call já levou as trilhas junto
  if (r?.sessionDescription) await con.setRemoteDescription(r.sessionDescription);
  else await con.setLocalDescription({ type: 'rollback' }).catch(() => {});
}

async function despublicar(tipo) {
  const l = locais[tipo];
  if (!l) return;
  delete locais[tipo];
  l.track.stop();
  await fechar([l.tr]);
}

async function puxar(lista) {
  const r = await api(`sessions/${sessaoR}/tracks/new`, 'POST', {
    tracks: lista.map(x => ({ location: 'remote', sessionId: x.sessao, trackName: x.nome })),
  });
  if (r.requiresImmediateRenegotiation) {
    await pcR.setRemoteDescription(r.sessionDescription);
    await pcR.setLocalDescription(await pcR.createAnswer());
    await api(`sessions/${sessaoR}/renegotiate`, 'PUT', { sessionDescription: { type: 'answer', sdp: pcR.localDescription.sdp } });
  }
  let espera = 0;
  for (const t of r.tracks || []) {
    const x = lista.find(y => y.sessao === t.sessionId && y.nome === t.trackName);
    const tr = pcR.getTransceivers().find(z => z.mid === t.mid);
    if (!x) continue;
    const k = `${x.sessao}/${x.nome}`;
    if (t.errorCode || !tr) {
      // A trilha pode ainda não ter chegado no SFU: tenta de novo esperando cada vez mais (1,5 s → 30 s),
      // para não ficar martelando o Worker (cada tentativa é uma requisição do plano grátis).
      const n = (tentativas.get(k)?.n || 0) + 1;
      const atraso = Math.min(1500 * 2 ** (n - 1), 30_000);
      tentativas.set(k, { n, proxima: Date.now() + atraso });
      espera = espera ? Math.min(espera, atraso) : atraso;
      continue;
    }
    tentativas.delete(k);
    puxadas.set(k, { ...x, tr, stream: new MediaStream([tr.receiver.track]) });
  }
  if (espera) setTimeout(reconciliar, espera);
}

const tentativas = new Map();   // trilha que falhou → { n, proxima }

// ---------------- o que puxar ----------------

function desejadas() {
  const call = minhaCall.value;
  if (!call || call.conectando) return [];
  const out = [];
  for (const p of pessoasNaCall(call.canal)) {
    if (p.uid === eu.value?.id) continue;
    const t = p.trilhas || {};
    const add = (tipo, nome) => nome && out.push({ uid: p.uid, sessao: p.sessao, nome, tipo });
    add('mic', t.mic);
    if (vendoCall.value) add('cam', t.cam);
    if (assistindo.value.has(p.uid)) {
      // Transmissão pelo app desktop vem de outra sessão no SFU (a do app).
      const daTela = (tipo, nome) => nome && out.push({ uid: p.uid, sessao: t.telaSessao || p.sessao, nome, tipo });
      daTela('tela', t.tela); daTela('telaAudio', t.telaAudio);
    }
  }
  // Música do bot (quem toca é o app de um DJ na call): todo mundo da call ouve.
  const mus = musica.value[call.canal]?.tocando;
  if (mus?.sessao && mus.trilha) out.push({ uid: 'musica', sessao: mus.sessao, nome: mus.trilha, tipo: 'musica' });
  return out;
}

/**
 * O SFU às vezes renumera as extensões RTP numa oferta nova e o Chrome recusa ("RTP extension ID reassignment").
 * Como manda a documentação do Cloudflare, troca a conexão: sessão nova de receber, puxando tudo de uma vez
 * (uma oferta só, numeração única). Só o que chega dos outros pisca; o seu microfone continua.
 */
let refeitas = [];
async function recriarRecebimento() {
  refeitas = refeitas.filter(t => Date.now() - t < 30_000);
  if (refeitas.length >= 3) throw new Error('recebimento instável');   // vira reconexão completa
  refeitas.push(Date.now());
  pcR?.close();
  pcR = novaConexao();
  sessaoR = (await api('sessions/new', 'POST')).sessionId;
  puxadas.clear();
  tentativas.clear();
  atualizarMidias();
}

function novaConexao() {
  const c = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' });
  c.onconnectionstatechange = () => {
    if (c.connectionState === 'failed' && (c === pc || c === pcR)) { aviso.value = 'A conexão da call caiu.'; sairVoz(); }
  };
  return c;
}

function reconciliar() {
  return emFila(async () => {
    try { await sincronizarRecebidas(); }
    catch (e) {
      console.warn('[call] recebimento falhou, trocando a conexão de receber:', e.message);
      await recriarRecebimento();
      await sincronizarRecebidas();
    }
  });
}

async function sincronizarRecebidas() {
  {
    const quero = new Map(desejadas().map(x => [`${x.sessao}/${x.nome}`, x]));
    const sobrando = [...puxadas.keys()].filter(k => !quero.has(k));
    if (sobrando.length) {
      const trs = sobrando.map(k => puxadas.get(k).tr);
      sobrando.forEach(k => puxadas.delete(k));
      atualizarMidias();
      await fechar(trs, true);
    }
    const agora = Date.now();
    const faltando = [...quero].filter(([k]) => !puxadas.has(k) && !(tentativas.get(k)?.proxima > agora)).map(([, x]) => x);
    if (faltando.length) await puxar(faltando);
    atualizarMidias();
  }
}

effect(() => {
  // Lê aqui o que muda a lista (o effect só acompanha o que é lido na hora).
  vozEstado.value; assistindo.value; vendoCall.value; minhaCall.value; musica.value;
  if (pc) reconciliar();
});

/** Atualiza vídeos (signal para a tela) e áudios (elementos <audio> fora da tela). */
function atualizarMidias() {
  const m = new Map();
  for (const x of puxadas.values()) {
    if (x.tipo === 'cam' || x.tipo === 'tela') m.set(`${x.uid}:${x.tipo}`, x.stream);
  }
  const meu = eu.value?.id;
  if (locais.cam) m.set(`${meu}:cam`, new MediaStream([locais.cam.track]));
  if (locais.tela) m.set(`${meu}:tela`, new MediaStream([locais.tela.track]));
  midias.value = m;

  for (const [k, a] of audios) if (!puxadas.has(k)) { a.ganho.disconnect(); a.fonte.disconnect(); a.el.srcObject = null; audios.delete(k); }
  for (const [k, x] of puxadas) {
    if (x.tipo !== 'mic' && x.tipo !== 'telaAudio' && x.tipo !== 'musica') continue;
    if (!audios.has(k)) {
      // O <audio> mudo só "liga" a trilha (o Chrome não entrega áudio do WebRTC ao WebAudio sem ele);
      // o som sai pelo ganho, que passa de 100% (igual o volume por pessoa do Discord).
      const el = new Audio();
      el.muted = true;
      el.srcObject = x.stream;
      el.play().catch(() => {});
      const ctx = contextoAudio();
      const fonte = ctx.createMediaStreamSource(x.stream);
      const ganho = ctx.createGain();
      fonte.connect(ganho).connect(ctx.destination);
      // Indicador de quem fala: mede direto no áudio (com o <audio> mudo, o audioLevel do getStats fica 0).
      let medidor = null;
      if (x.tipo === 'mic') { medidor = ctx.createAnalyser(); medidor.fftSize = 512; fonte.connect(medidor); }
      audios.set(k, { el, fonte, ganho, medidor });
    }
  }
  aplicarVolumes();
}

/** Volume padrão: pessoas 100%; música do bot 35% (para não cobrir as vozes). */
export const volumePadrao = uid => (uid === 'musica' ? 0.35 : 1);

/** Silenciados pelo clique direito ("Silenciar a live" / "Silenciar"): o volume escolhido fica guardado para quando voltar. */
export const silenciados = signal(new Set((() => { try { return JSON.parse(localStorage.getItem('silenciados')) || []; } catch { return []; } })()));
export function alternarSilencio(chave) {
  const s = new Set(silenciados.value);
  s.has(chave) ? s.delete(chave) : s.add(chave);
  silenciados.value = s;
  try { localStorage.setItem('silenciados', JSON.stringify([...s])); } catch {}
}

/**
 * Volume de cada som que chega:
 *   - "Mutar tudo" (o fone) cala a call — voz das pessoas e música —, mas NUNCA a live que estou assistindo;
 *   - um admin me ensurdeceu: igual ao "mutar tudo";
 *   - um admin mutou alguém: o microfone DELE fica em zero aqui (é assim que o mute do admin vale de verdade,
 *     mesmo se o app da pessoa ignorar);
 *   - "Silenciar"/volume do menu da pessoa (clique direito): só para mim.
 *   - silenciado pela CONTA (vale em todos os aparelhos): a voz some; bloqueado: voz e live somem.
 */
function aplicarVolumes() {
  const euEnsurdecidoPeloAdmin = moderacaoNaMinhaCall(eu.value?.id).ensurdecidoPeloAdmin;
  for (const [chaveDaPuxada, audio] of audios) {
    const puxada = puxadas.get(chaveDaPuxada);
    const ehLive = puxada?.tipo === 'telaAudio';
    const chaveDoVolume = ehLive ? `${puxada.uid}:tela` : puxada?.uid;   // live tem volume próprio
    const microfoneMutadoPeloAdmin = puxada?.tipo === 'mic' && moderacaoNaMinhaCall(puxada.uid).mutadoPeloAdmin;
    const caladoPelaConta = (puxada?.tipo === 'mic' && caladosPelaConta.value.has(puxada.uid)) || bloqueados.value.has(puxada?.uid);
    const calado = ((surdo.value || euEnsurdecidoPeloAdmin) && !ehLive) || microfoneMutadoPeloAdmin || caladoPelaConta || silenciados.value.has(chaveDoVolume);
    audio.ganho.gain.value = calado ? 0 : Math.max(0, Math.min(2, volumes.value[chaveDoVolume] ?? volumePadrao(chaveDoVolume)));
  }
}

let ctxAudio = null;
/** Um AudioContext para todo o som da call (criado no clique de entrar, que libera o som no navegador). */
function contextoAudio() {
  if (!ctxAudio) {
    ctxAudio = new AudioContext({ latencyHint: 'interactive' });
    aplicarSaida();
  }
  if (ctxAudio.state === 'suspended') ctxAudio.resume().catch(() => {});
  return ctxAudio;
}

async function aplicarSaida() {
  if (!ctxAudio?.setSinkId) return;
  const id = await aparelhoAtual('saida');
  if (ctxAudio?.setSinkId) ctxAudio.setSinkId(id || '').catch(() => { aviso.value = 'Não deu para usar essa saída de som — voltando para a padrão.'; ctxAudio.setSinkId('').catch(() => {}); });
}

let ctxRuido = null, wasmRuido = null;

/**
 * Microfone com o filtro de ruído escolhido (ver nivelDoFiltroDeRuido). No "Estúdio" e no "Foco na voz" o som passa
 * pelo RNNoise (48 kHz); no "Foco na voz", também pelo portão de voz. O stop() da trilha filtrada também solta o
 * microfone de verdade. Se o RNNoise falhar (aparelho antigo), segue com o filtro do navegador e avisa.
 */
async function abrirMic() {
  const nivel = nivelDoFiltroDeRuido.value;
  const cru = (await pegarMidia({ audio: { echoCancellation: true, noiseSuppression: nivel !== 'sem', autoGainControl: true } })).getAudioTracks()[0];
  if (nivel === 'sem') return cru;
  try {
    const { loadRnnoise } = await import('@sapphi-red/web-noise-suppressor');
    if (!ctxRuido) {
      const ctx = new AudioContext({ sampleRate: 48000 });
      [wasmRuido] = await Promise.all([loadRnnoise({ url: rnnoiseWasm, simdUrl: rnnoiseSimd }), ctx.audioWorklet.addModule(processadorFocoNaVoz)]);
      ctxRuido = ctx;
    }
    if (ctxRuido.state === 'suspended') ctxRuido.resume().catch(() => {});
    const fonte = ctxRuido.createMediaStreamSource(new MediaStream([cru]));
    // Mesmo formato do nó da biblioteca (RnnoiseWorkletNode), com o processador que tem o portão de voz
    // (ligado só no "Foco na voz").
    const filtro = new AudioWorkletNode(ctxRuido, 'concorde-rnnoise-foco-na-voz', {
      processorOptions: { wasmBinary: wasmRuido, maxChannels: 1, portaoDeVozLigado: nivel === 'foco', faixaDaVoz: faixaDaVoz.value },
    });
    filtro.destroy = () => {
      filtro.port.postMessage('destroy');
      if (noDoFiltroAtual === filtro) { noDoFiltroAtual = null; nivelDoMicrofone.value = null; }
    };
    filtro.port.onmessage = evento => { if (evento.data?.tipo === 'nivel') nivelDoMicrofone.value = evento.data; };
    noDoFiltroAtual = filtro;
    const saida = ctxRuido.createMediaStreamDestination();
    fonte.connect(filtro).connect(saida);
    const track = saida.stream.getAudioTracks()[0];
    const parar = track.stop.bind(track);
    track.stop = () => { parar(); cru.stop(); fonte.disconnect(); filtro.disconnect(); filtro.destroy(); };
    return track;
  } catch (e) {
    console.warn('filtro "Foco na voz" indisponível; usando o filtro do navegador', e);
    aviso.value = 'O filtro de ruído não funcionou neste aparelho; usando o filtro simples do navegador.';
    return cru;
  }
}

/** Troca o nível do filtro de ruído (vale na hora, mesmo no meio da call). */
export function mudarFiltroDeRuido(nivel) {
  if (!NIVEIS_DO_FILTRO_DE_RUIDO.includes(nivel)) return;
  nivelDoFiltroDeRuido.value = nivel;
  try { localStorage.setItem('filtroDeRuido', nivel); } catch {}
  if (locais.mic) trocarDispositivo('mic', dispositivos.value.mic);
}

/** Troca de aparelho em Configurações (vale na hora, mesmo no meio da call). */
export async function trocarDispositivo(tipo, id) {
  // Guarda também o nome: o código do aparelho pode mudar depois de reiniciar o PC (ver aparelhoAtual).
  const lista = id ? ((await navigator.mediaDevices?.enumerateDevices().catch(() => [])) || []) : [];
  const nome = lista.find(d => d.kind === TIPO_APARELHO[tipo][0] && d.deviceId === id)?.label || '';
  dispositivos.value = { ...dispositivos.value, [tipo]: id, [tipo + 'Nome']: nome };
  try { localStorage.setItem('dispositivos', JSON.stringify(dispositivos.value)); } catch {}
  if (tipo === 'saida') return aplicarSaida();
  const l = locais[tipo];
  if (!l) return;   // vale na próxima vez que ligar
  let nova;
  try {
    nova = tipo === 'mic'
      ? await abrirMic()
      : (await pegarMidia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } } })).getVideoTracks()[0];
    if (tipo === 'mic') nova.enabled = !mudo.value;
    await l.tr.sender.replaceTrack(nova);
    l.track.stop();
    l.track = nova;
    atualizarMidias();
  } catch {
    if (nova && nova !== l.track) nova.stop();   // abriu mas não deu para trocar: não deixa ligado
    aviso.value = 'Não deu para usar esse aparelho.';
  }
}
effect(() => { surdo.value; volumes.value; silenciados.value; caladosPelaConta.value; aplicarVolumes(); });

// ---------------- entrar e sair ----------------

/**
 * Muda a cada entrar/sair da call. Microfone, câmera ou tela que terminam de abrir depois que a pessoa saiu
 * (ou trocou de call) são desligados na hora, em vez de ficarem ligados sem ninguém usar.
 */
let geracao = 0;
const saiu = g => g !== geracao;

export async function entrarVoz(canal) {
  if (minhaCall.value?.canal === canal) return;
  if (minhaCall.value) sairVoz(true);
  const g = ++geracao;
  minhaCall.value = { canal, conectando: true };
  contextoAudio();
  let mic = null;
  try {
    mic = await abrirMic();
  } catch {
    aviso.value = 'Sem acesso ao microfone — entrando só para ouvir.';
  }
  if (saiu(g)) return void mic?.stop();   // desistiu enquanto o microfone abria
  try {
    pc = novaConexao();
    pcR = novaConexao();
    const novas = await Promise.all([api('sessions/new', 'POST'), api('sessions/new', 'POST')]);
    if (saiu(g)) return void mic?.stop();   // desistiu (ou trocou de call) enquanto conectava
    [sessao, sessaoR] = novas.map(r => r.sessionId);
    if (mic) {
      mic.enabled = !mudo.value && !surdo.value;
      await emFila(() => publicar('mic', mic, { maxBitrate: BITRATE_VOZ }));
    }
    minhaCall.value = { canal };
    avisarServidor(true);
    som('entrar');
    medirFala();
  } catch (e) {
    mic?.stop();
    if (saiu(g)) return;
    aviso.value = 'Não deu para entrar na call: ' + e.message;
    sairVoz(true);
  }
}

export function sairVoz(silencioso = false) {
  if (!minhaCall.value) return;
  // Saiu de propósito (botão, admin desconectou, outro aparelho): não volta sozinho depois.
  // Só quando a PÁGINA está fechando (app fechou/atualizou) a call fica lembrada — ver "voltar para a call" abaixo.
  if (!aPaginaEstaFechando) esquecerACallParaVoltar();
  geracao++;
  enviar({ t: 'voz-sair' });
  for (const l of Object.values(locais)) l.track.stop();
  for (const k of Object.keys(locais)) delete locais[k];
  if (telaNativa) { telaNativa.ponte.parar().catch(() => {}); telaNativa = null; }
  pararDj();
  for (const a of audios.values()) { a.ganho.disconnect(); a.fonte.disconnect(); a.el.srcObject = null; }
  audios.clear();
  puxadas.clear();
  tentativas.clear();
  pc?.close();
  pcR?.close();
  pc = null; sessao = null; pcR = null; sessaoR = null;
  minhaCall.value = null;
  assistindo.value = new Set();
  falando.value = new Set();
  midias.value = new Map();
  minhas.value = {};
  clearInterval(timerFala);
  if (!silencioso) som('sair');
}

function avisarServidor(entrando = false) {
  const trilhas = {
    mic: locais.mic?.nome, cam: locais.cam?.nome,
    tela: locais.tela?.nome || telaNativa?.tela, telaAudio: locais.telaAudio?.nome || telaNativa?.telaAudio,
    telaSessao: telaNativa?.sessao, telaInfo: minhas.value.telaInfo,
  };
  minhas.value = trilhas;
  enviar({ t: entrando ? 'voz-entrar' : 'voz-estado', canal: minhaCall.value?.canal, sessao, mudo: mudo.value, surdo: surdo.value, app: !!nativo?.musicaTocar, trilhas });
}

// Reconectou o WebSocket: o servidor esqueceu que estávamos na call (a sessão no SFU continua viva).
eventosVoz.addEventListener('pronto', () => { if (minhaCall.value && !minhaCall.value.conectando) avisarServidor(true); });
eventosVoz.addEventListener('expulso', evento => {
  const { motivo, por } = evento.detail || {};
  aviso.value = motivo === 'admin' ? `${por || 'Um admin'} te desconectou da call. Você pode entrar de novo.`
    : motivo === 'servidor' ? 'Você não está mais nesse servidor, então saiu da call.'
    : 'Você entrou na call por outro aparelho.';
  sairVoz(true);
});

/**
 * Mute imposto por um admin (menu da pessoa → moderação), lido do estado da call que o servidor manda.
 * { mutadoPeloAdmin, ensurdecidoPeloAdmin } da pessoa (uid) na call em que EU estou.
 */
export function moderacaoNaMinhaCall(uid) {
  const canal = minhaCall.value?.canal;
  const pessoa = canal ? pessoasNaCall(canal).find(participante => participante.uid === uid) : null;
  return { mutadoPeloAdmin: !!pessoa?.mutadoPeloAdmin, ensurdecidoPeloAdmin: !!pessoa?.ensurdecidoPeloAdmin };
}

// Quando um admin me muta ou tira o mute, o microfone segue na hora; quando me ensurdece, o som da call também.
let jaAviseiDoMuteDoAdmin = false;
effect(() => {
  vozEstado.value;   // muda quando o servidor manda o estado novo da call
  const minhaModeracao = moderacaoNaMinhaCall(eu.value?.id);
  if (minhaModeracao.mutadoPeloAdmin && !jaAviseiDoMuteDoAdmin) aviso.value = 'Um admin mutou seu microfone neste servidor.';
  jaAviseiDoMuteDoAdmin = minhaModeracao.mutadoPeloAdmin;
  if (locais.mic) locais.mic.track.enabled = !mudo.value && !minhaModeracao.mutadoPeloAdmin;
  aplicarVolumes();
});
// ---------------- voltar para a call depois que o app fecha e abre (como o Discord) ----------------
//
// Se o Concorde fechar no meio de uma call (atualização, queda, recarregar a página) e abrir de novo logo, ele
// volta sozinho para a mesma call, com o mesmo mute. Passou do tempo máximo, não volta (a pessoa já foi embora).
// Sair da call de propósito (botão, admin desconectou, entrou por outro aparelho) apaga a lembrança.

const CHAVE_DA_CALL_PARA_VOLTAR = 'concorde-call-para-voltar';
/** Fechou e abriu (queda, recarregou): volta se abriu em até 3 minutos. */
export const TEMPO_MAXIMO_PARA_VOLTAR_EM_MS = 3 * 60 * 1000;
/** Fechou para ATUALIZAR: baixar e instalar demora mais, então espera até 10 minutos. */
export const TEMPO_MAXIMO_PARA_VOLTAR_DEPOIS_DE_ATUALIZAR_EM_MS = 10 * 60 * 1000;
let aPaginaEstaFechando = false;
/** Ficou true quando a pessoa clicou em "Atualizar agora": as gravações seguintes mantêm a marca de atualização. */
let vaiFecharParaAtualizar = false;

/** Guarda em qual call estou (e se estou mutado), com a hora — atualizado a cada 15 s enquanto estou nela. */
function lembrarACallParaVoltar() {
  const fechandoParaAtualizar = vaiFecharParaAtualizar;
  const call = minhaCall.value;
  if (!call || call.conectando) return;
  try {
    localStorage.setItem(CHAVE_DA_CALL_PARA_VOLTAR, JSON.stringify({
      canal: call.canal, mudo: mudo.value, surdo: surdo.value, vistoEmMs: Date.now(), fechandoParaAtualizar,
    }));
  } catch {}
}
function esquecerACallParaVoltar() { try { localStorage.removeItem(CHAVE_DA_CALL_PARA_VOLTAR); } catch {} }
effect(() => { minhaCall.value; mudo.value; surdo.value; lembrarACallParaVoltar(); });
setInterval(() => lembrarACallParaVoltar(), 15_000);

/** Chamado logo antes de instalar uma atualização: dá mais tempo para voltar para a call. */
export function lembrarDaCallAntesDeAtualizar() { vaiFecharParaAtualizar = true; lembrarACallParaVoltar(); }

/**
 * Se a página abriu logo depois de fechar no meio de uma call, volta para ela (uma vez, quando a lista de canais
 * chega). Decide pelo tempo desde a última vez que a call foi vista aberta.
 */
let jaTenteiVoltarParaACall = false;
effect(() => {
  const listaDeCanais = canais.value;
  if (jaTenteiVoltarParaACall || !eu.value || !listaDeCanais.length) return;
  jaTenteiVoltarParaACall = true;
  let lembranca = null;
  try { lembranca = JSON.parse(localStorage.getItem(CHAVE_DA_CALL_PARA_VOLTAR)); } catch {}
  esquecerACallParaVoltar();
  if (!lembranca?.canal) return;
  const tempoFechadoEmMs = Date.now() - lembranca.vistoEmMs;
  const limiteEmMs = lembranca.fechandoParaAtualizar ? TEMPO_MAXIMO_PARA_VOLTAR_DEPOIS_DE_ATUALIZAR_EM_MS : TEMPO_MAXIMO_PARA_VOLTAR_EM_MS;
  const canalAindaExiste = listaDeCanais.some(canal => canal.id === lembranca.canal && canal.tipo === 'voz');
  if (tempoFechadoEmMs > limiteEmMs || !canalAindaExiste) return;
  mudo.value = !!lembranca.mudo;
  surdo.value = !!lembranca.surdo;
  aviso.value = lembranca.fechandoParaAtualizar ? 'Caocorde atualizado! Voltando para a call…' : 'Voltando para a call em que você estava…';
  entrarVoz(lembranca.canal);
});

window.addEventListener('pagehide', () => { aPaginaEstaFechando = true; sairVoz(true); });

// ---------------- mudo, surdo, câmera e tela ----------------

let mudoAntesDoSurdo = false;

export function alternarMudo() {
  if (surdo.value) { surdo.value = false; mudo.value = false; }
  else mudo.value = !mudo.value;
  aplicarMic();
  som(mudo.value ? 'mudo' : 'desmudo');
}

export function alternarSurdo() {
  if (!surdo.value) { mudoAntesDoSurdo = mudo.value; surdo.value = true; mudo.value = true; }
  else { surdo.value = false; mudo.value = mudoAntesDoSurdo; }
  aplicarMic();
  som(surdo.value ? 'mudo' : 'desmudo');
}

function aplicarMic() {
  if (locais.mic) locais.mic.track.enabled = !mudo.value && !moderacaoNaMinhaCall(eu.value?.id).mutadoPeloAdmin;
  if (!mudo.value && moderacaoNaMinhaCall(eu.value?.id).mutadoPeloAdmin) aviso.value = 'Um admin mutou seu microfone neste servidor — só um admin pode tirar.';
  if (minhaCall.value && !minhaCall.value.conectando) avisarServidor();
}

/** Ações em andamento ("cam", "tela"): o botão mostra o carregando e não aceita outro clique. */
export const ocupado = signal({});
async function comOcupado(chave, f) {
  if (ocupado.value[chave]) return;
  ocupado.value = { ...ocupado.value, [chave]: true };
  try { return await f(); }
  finally { const o = { ...ocupado.value }; delete o[chave]; ocupado.value = o; }
}

export const alternarCamera = () => comOcupado('cam', alternarCameraAgora);

async function alternarCameraAgora() {
  if (!pc) return;
  if (locais.cam) { await emFila(() => despublicar('cam')); atualizarMidias(); return avisarServidor(); }
  const g = geracao;
  let track;
  try {
    track = (await pegarMidia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } } })).getVideoTracks()[0];
  } catch {
    return void (aviso.value = 'Sem acesso à câmera.');
  }
  if (saiu(g)) return void track.stop();   // saiu da call enquanto a câmera abria
  track.onended = () => { if (locais.cam?.track === track) alternarCamera(); };
  try {
    await emFila(() => publicar('cam', track, { maxBitrate: BITRATE_CAM, maxFramerate: 24 }));
  } catch (e) {
    // A câmera abriu mas não foi para a call: desliga (senão a luz dela fica acesa sem transmitir nada).
    track.stop();
    if (locais.cam?.track === track) delete locais.cam;
    if (!saiu(g)) aviso.value = 'Não deu para ligar a câmera: ' + e.message;
    return;
  }
  if (saiu(g)) { track.stop(); delete locais.cam; return; }
  atualizarMidias();
  avisarServidor();
}

export const compartilharTela = q => comOcupado('tela', () => compartilharTelaAgora(q));

async function compartilharTelaAgora(qualidade = '720p30') {
  if (!pc) return;
  if (locais.tela) await pararTelaAgora(false);
  const q = QUALIDADES[qualidade] || QUALIDADES['720p30'];
  let s;
  try {
    s = await pegarTela({
      video: { height: { ideal: q.altura, max: q.altura }, frameRate: { ideal: q.fps, max: q.fps } },
      // Som do PC sem o som da própria call (senão a galera se ouve de volta).
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include', restrictOwnAudio: true, selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
    });
  } catch {
    return;   // cancelou a escolha
  }
  const g = geracao;
  const video = s.getVideoTracks()[0];
  const audio = s.getAudioTracks()[0];
  const soltar = () => { s.getTracks().forEach(tr => tr.stop()); if (locais.tela?.track === video) delete locais.tela; if (locais.telaAudio?.track === audio) delete locais.telaAudio; };
  if (saiu(g) || !pc) return soltar();
  video.contentHint = q.fps >= 60 ? 'motion' : 'detail';
  video.onended = () => { if (locais.tela?.track === video) pararTela(); };
  try {
    await emFila(async () => {
      await publicar('tela', video, { maxBitrate: q.bitrate, maxFramerate: q.fps });
      if (audio) await publicar('telaAudio', audio, { maxBitrate: 128_000 });
    });
  } catch (e) {
    // A captura abriu mas não foi para a call: para (o Windows continuaria mostrando "compartilhando").
    if (locais.tela?.track === video) await emFila(() => despublicar('tela')).catch(() => {});
    soltar();
    if (!saiu(g)) aviso.value = 'Não deu para transmitir: ' + e.message;
    return;
  }
  if (saiu(g)) return soltar();
  minhas.value = { ...minhas.value, telaInfo: q.nome };
  atualizarMidias();
  avisarServidor();
  som('live');
}

export const pararTela = (avisar = true) => comOcupado('tela', () => pararTelaAgora(avisar));

async function pararTelaAgora(avisar = true) {
  if (telaNativa) { const p = telaNativa.ponte; telaNativa = null; await p.parar().catch(() => {}); }
  await emFila(async () => { await despublicar('telaAudio'); await despublicar('tela'); });
  minhas.value = { ...minhas.value, telaInfo: null };
  atualizarMidias();
  if (avisar) avisarServidor();
}

// ---------------- ao vivo pela captura nativa do app desktop ----------------

let telaNativa = null;   // { ponte, sessao, tela, telaAudio }

/**
 * O app captura e codifica (placa escolhida) e publica numa sessão própria no SFU; a página só faz a sinalização:
 * pede a oferta ao app, registra as trilhas no SFU e devolve a resposta.
 */
export const transmitirNativo = p => comOcupado('tela', () => transmitirNativoAgora(p));

async function transmitirNativoAgora(pedido) {
  const { fonte, nomeFonte, qualidade, placa, semSom, cursorJogo } = pedido;
  if (!pc || !nativo) return;
  if (locais.tela || telaNativa) await pararTelaAgora(false);
  const q = QUALIDADES[qualidade] || QUALIDADES['720p30'];
  aviso.value = 'Preparando a transmissão…';
  const g = geracao;
  try {
    const r = await nativo.iniciar({ fonte, altura: q.altura, fps: q.fps, kbps: q.bitrate / 1000, placa, semSom, cursorJogo });
    if (saiu(g)) throw new Error('saiu da call');
    const mid = tipo => r.sdp.split(/\r?\nm=/).find(sec => sec.startsWith(tipo))?.match(/a=mid:(\S+)/)?.[1];
    const s2 = (await api('sessions/new', 'POST')).sessionId;
    const nomes = { tela: `tela-${++contador}`, telaAudio: `tela-audio-${contador}` };
    const resp = await api(`sessions/${s2}/tracks/new`, 'POST', {
      sessionDescription: { type: 'offer', sdp: r.sdp },
      tracks: [{ location: 'local', mid: mid('video'), trackName: nomes.tela }, { location: 'local', mid: mid('audio'), trackName: nomes.telaAudio }],
    });
    await nativo.resposta(resp.sessionDescription.sdp);
    if (saiu(g)) throw new Error('saiu da call');   // a captura do app não pode continuar sem call
    telaNativa = { ponte: nativo, sessao: s2, tela: nomes.tela, telaAudio: r.som ? nomes.telaAudio : null, nomeFonte, pedido, conectou: false };
    minhas.value = { ...minhas.value, telaInfo: `${q.nome} · ${nomeFonte}`.slice(0, 60) };
    avisarServidor();
    aviso.value = `Ao vivo: ${nomeFonte} (${r.encoder})`;
    som('live');
  } catch (e) {
    nativo.parar().catch(() => {});
    telaNativa = null;
    aviso.value = saiu(g) ? '' : 'Não deu para transmitir: ' + e.message;
  }
}

/** Pedido da transmissão do app que está no ar (null = nenhuma, ou app antigo que não ajusta ao vivo). */
export const transmissaoAjustavel = () => (telaNativa?.ponte === nativo && nativo?.ajustar ? telaNativa.pedido : null);

/** Muda a transmissão no ar sem fechar (qualidade, som, fonte, placa, modo jogo): a sessão no SFU é a mesma. */
export const ajustarNativo = (p, atualizar = false) => comOcupado('tela', () => ajustarNativoAgora(p, atualizar));

async function ajustarNativoAgora(pedido, atualizar) {
  if (!telaNativa) return;
  const { fonte, nomeFonte, qualidade, placa, semSom, cursorJogo } = pedido;
  const q = QUALIDADES[qualidade] || QUALIDADES['720p30'];
  aviso.value = atualizar ? 'Atualizando a tela…' : 'Ajustando a transmissão…';
  try {
    const r = await nativo.ajustar({ fonte, altura: q.altura, fps: q.fps, kbps: q.bitrate / 1000, placa, semSom, cursorJogo, atualizar });
    if (!telaNativa) return;
    telaNativa.pedido = { ...telaNativa.pedido, ...pedido };
    telaNativa.nomeFonte = nomeFonte;
    minhas.value = { ...minhas.value, telaInfo: `${q.nome} · ${nomeFonte}`.slice(0, 60) };
    avisarServidor();
    aviso.value = `Transmissão ajustada: ${nomeFonte} (${q.nome}${r?.encoder ? ' · ' + r.encoder : ''})`;
  } catch (e) {
    aviso.value = 'Não deu para ajustar: ' + e.message + ' — a transmissão continua como estava.';
  }
}

/** Celular: o Android captura a tela (janela "Começar a transmitir?") e codifica; a página só faz a sinalização. */
export const transmitirAndroid = qualidade => comOcupado('tela', () => transmitirAndroidAgora(qualidade));

async function transmitirAndroidAgora(qualidade) {
  if (!pc || !android) return;
  if (locais.tela || telaNativa) await pararTelaAgora(false);
  const q = QUALIDADES[qualidade] || QUALIDADES['720p30'];
  const g = geracao;
  try {
    const r = await android.iniciar({ altura: q.altura, fps: q.fps, kbps: q.bitrate / 1000 });
    if (saiu(g)) throw new Error('saiu da call');
    const mid = r.sdp.split(/\r?\nm=/).find(sec => sec.startsWith('video'))?.match(/a=mid:(\S+)/)?.[1];
    const s2 = (await api('sessions/new', 'POST')).sessionId;
    const nome = `tela-${++contador}`;
    const resp = await api(`sessions/${s2}/tracks/new`, 'POST', {
      sessionDescription: { type: 'offer', sdp: r.sdp }, tracks: [{ location: 'local', mid, trackName: nome }],
    });
    await android.resposta(resp.sessionDescription.sdp);
    if (saiu(g)) throw new Error('saiu da call');
    telaNativa = { ponte: android, sessao: s2, tela: nome, telaAudio: null };
    minhas.value = { ...minhas.value, telaInfo: `${q.nome} · celular` };
    avisarServidor();
    aviso.value = 'Ao vivo: tela do celular';
    som('live');
  } catch (e) {
    android.parar().catch(() => {});
    telaNativa = null;
    aviso.value = 'Não deu para transmitir: ' + e.message;
  }
}

android?.aoEvento((evento, dados) => {
  if (evento === 'transmissao' && telaNativa?.ponte === android && dados.estado === 'caiu') { aviso.value = 'A transmissão parou.'; pararTela(); }
});

nativo?.aoEvento((evento, dados) => {
  if (evento !== 'transmissao' || !telaNativa) return;
  if (dados.estado === 'fonte-perdida') { aviso.value = 'A janela transmitida foi fechada.'; pararTela(); }
  else if (dados.estado === 'conectado') telaNativa.conectou = true;
  else if (dados.estado === 'tela-cheia-exclusiva') aviso.value = 'O jogo está em tela cheia exclusiva e a captura pega poucos quadros. Coloque o jogo em "Janela sem bordas" (ou "Tela cheia em janela") nas opções de vídeo dele.';
  else if (dados.estado === 'caiu') {
    // Às vezes a conexão com o Cloudflare não fecha na primeira tentativa (antes de conectar): tenta de novo uma vez sozinha.
    const { pedido, conectou } = telaNativa;
    if (!conectou && !pedido.tentouDeNovo) {
      aviso.value = 'Reconectando a transmissão…';
      transmitirNativo({ ...pedido, tentouDeNovo: true });
      return;
    }
    // Caiu no meio (conexão oscilou e não voltou sozinha): reconecta até 3 vezes seguidas (zera depois de 2 min sem cair).
    const agora = Date.now();
    const quedas = agora - (pedido.ultimaQueda || 0) > 120_000 ? 0 : (pedido.quedas || 0);
    if (conectou && quedas < 3) {
      aviso.value = 'A conexão oscilou — reconectando a transmissão…';
      transmitirNativo({ ...pedido, tentouDeNovo: true, quedas: quedas + 1, ultimaQueda: agora });
    } else { aviso.value = 'A transmissão caiu.'; pararTela(); }
  }
  else if (dados.estado === 'qualidade') {
    // Qualidade automática: o app desceu (ou voltou a subir) um degrau. Quem assiste vê o rótulo novo.
    aviso.value = dados.reduzida ? `Qualidade reduzida para ${dados.nome}: ${dados.motivo}` : `Qualidade de volta a ${dados.nome}`;
    minhas.value = { ...minhas.value, telaInfo: `${dados.nome}${dados.reduzida ? ' auto' : ''} · ${telaNativa.nomeFonte || ''}`.slice(0, 60) };
    avisarServidor();
  }
});

export function assistir(uid, sim = true) {
  const s = new Set(assistindo.value);
  sim ? s.add(uid) : s.delete(uid);
  assistindo.value = s;
}

// Parou de transmitir: sai sozinho do "assistindo".
effect(() => {
  const call = minhaCall.value;
  if (!call) return;
  const aoVivo = new Set(pessoasNaCall(call.canal).filter(p => p.trilhas?.tela).map(p => p.uid));
  const s = new Set([...assistindo.peek()].filter(uid => aoVivo.has(uid)));
  if (s.size !== assistindo.peek().size) assistindo.value = s;
});

export function mudarVolume(uid, v) {
  volumes.value = { ...volumes.value, [uid]: v };
  try { localStorage.setItem('volumes', JSON.stringify(volumes.value)); } catch {}
}

function lerVolumes() {
  try { return JSON.parse(localStorage.getItem('volumes')) || {}; } catch { return {}; }
}

// ---------------- quem está falando (nível de áudio do próprio WebRTC, sem processar som) ----------------

let timerFala;
const amostrasFala = new Float32Array(512);
function medirFala() {
  clearInterval(timerFala);
  timerFala = setInterval(async () => {
    if (!pc || !pcR) return;
    const agora = new Set();
    for (const [k, a] of audios) {
      if (!a.medidor) continue;
      a.medidor.getFloatTimeDomainData(amostrasFala);
      let soma = 0;
      for (const v of amostrasFala) soma += v * v;
      if (Math.sqrt(soma / amostrasFala.length) > 0.01) agora.add(puxadas.get(k)?.uid);
    }
    const enviado = await pc.getStats();
    enviado.forEach(s => {
      if (s.type === 'media-source' && s.kind === 'audio' && s.audioLevel > 0.02 && !mudo.value && locais.mic && s.trackIdentifier === locais.mic.track.id) agora.add(eu.value.id);
    });
    const antes = falando.value;
    if (agora.size !== antes.size || [...agora].some(u => !antes.has(u))) falando.value = agora;
  }, 200);
}

// ---------------- sons de entrar/sair (gerados na hora, sem arquivo) ----------------

let ctxSom;
function som(tipo) {
  try {
    ctxSom ||= new AudioContext();
    // [notas, forma da onda, passo, volume]: o bot tem som "8-bit" (onda quadrada, igual videogame antigo).
    const [notas, onda, passo, vol] = {
      entrar: [[520, 780], 'sine', 0.09, 0.12], sair: [[780, 520], 'sine', 0.09, 0.12],
      'outro-entrou': [[660, 880], 'sine', 0.09, 0.12], 'outro-saiu': [[880, 660], 'sine', 0.09, 0.12],
      mudo: [[440], 'sine', 0.09, 0.12], desmudo: [[660], 'sine', 0.09, 0.12],
      live: [[520, 660, 880], 'sine', 0.09, 0.12],
      'live-outro': [[880, 1108, 1318, 1760], 'triangle', 0.07, 0.14],
      'bot-entrou': [[784, 988, 1175, 1568], 'square', 0.06, 0.05],
      'bot-saiu': [[1175, 988, 784], 'square', 0.06, 0.05],
    }[tipo] || [[600], 'sine', 0.09, 0.12];
    notas.forEach((f, i) => {
      const o = ctxSom.createOscillator(), g = ctxSom.createGain(), t = ctxSom.currentTime + i * passo;
      o.frequency.value = f; o.type = onda;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(ctxSom.destination); o.start(t); o.stop(t + 0.18);
    });
  } catch {}
}

// Alguém entrou/saiu da minha call: toca o sonzinho.
let antesNaCall = null;
effect(() => {
  const call = minhaCall.value;
  const ids = call && !call.conectando ? new Set(pessoasNaCall(call.canal).map(p => p.uid).filter(u => u !== eu.value?.id)) : null;
  if (ids && antesNaCall) {
    if ([...ids].some(u => !antesNaCall.has(u))) som('outro-entrou');
    else if ([...antesNaCall].some(u => !ids.has(u))) som('outro-saiu');
  }
  antesNaCall = ids;
});

// ---------------- música: o app desktop de alguém da call vira o DJ ----------------

let dj = null;   // { canal, item, preparando, pausado } quando o MEU app está tocando

/** Quem toca: quem pôs a música (se está na call com o app); senão o app que entrou primeiro na call. */
function djEscolhido(canal, item) {
  const comApp = pessoasNaCall(canal).filter(p => p.app);
  if (comApp.some(p => p.uid === item.por)) return item.por;
  return comApp.sort((a, b) => (a.entrou || 0) - (b.entrou || 0))[0]?.uid ?? null;
}

effect(() => {
  const call = minhaCall.value;
  const estado = call && musica.value[call.canal];
  vozEstado.value;
  if (!nativo?.musicaTocar) return;   // app 0.3.0 não tem a parte de música
  if (!call || call.conectando) { pararDj(); return; }
  const fila = estado?.fila || [], tocando = estado?.tocando;
  const euId = eu.value?.id;
  if (dj && !dj.preparando) {
    if (!tocando || tocando.item !== dj.item || tocando.dj !== euId) pararDj();
    else if (!!tocando.pausado !== dj.pausado) { dj.pausado = !!tocando.pausado; nativo.musicaPausar(dj.pausado).catch(() => {}); }
  }
  const djNaCall = tocando && pessoasNaCall(call.canal).some(p => p.uid === tocando.dj);
  // Depois que o DJ sai, só toca quem respondeu "sim" na pergunta (estado.passar).
  const escolhido = estado?.passar ? estado.passar.aceito : djEscolhido(call.canal, fila[0] || {});
  if (!dj && fila.length && !djNaCall && escolhido === euId) assumir(call.canal, fila[0]);
});

async function assumir(canal, item) {
  dj = { canal, item: item.id, preparando: true, pausado: false };
  try {
    const r = await nativo.musicaTocar(item.consulta);
    if (dj?.item !== item.id) { nativo.musicaParar().catch(() => {}); return; }
    // Era um link de PLAYLIST: o app abriu e devolveu as músicas. O servidor troca o item por elas (no mesmo lugar
    // da fila) e avisa todo mundo; a nova fila chega pelo WebSocket e este efeito assume a primeira música dela.
    if (r.playlist) {
      dj = null;
      enviar({ t: 'musica-expandir', canal, item: item.id, titulo: r.playlist.titulo, total: r.playlist.total, faixas: r.playlist.faixas });
      return;
    }
    const s2 = (await api('sessions/new', 'POST')).sessionId;
    const mid = r.sdp.split(/\r?\nm=/).find(x => x.startsWith('audio'))?.match(/a=mid:(\S+)/)?.[1];
    const trilha = `musica-${item.id}`;
    const resp = await api(`sessions/${s2}/tracks/new`, 'POST', {
      sessionDescription: { type: 'offer', sdp: r.sdp }, tracks: [{ location: 'local', mid, trackName: trilha }],
    });
    await nativo.musicaResposta(resp.sessionDescription.sdp);
    if (dj?.item !== item.id) { nativo.musicaParar().catch(() => {}); return; }
    dj.preparando = false;
    enviar({ t: 'musica-dj', canal, item: item.id, sessao: s2, trilha, titulo: r.titulo, duracao: r.duracao, thumb: r.capa, url: r.pagina });
  } catch (e) {
    const it = dj?.item;
    dj = null;
    nativo.musicaParar().catch(() => {});
    if (it != null) enviar({ t: 'musica-erro', canal, item: it, erro: String(e.message || e).slice(0, 120) });
  }
}

function pararDj() {
  if (!dj) return;
  dj = null;
  nativo?.musicaParar().catch(() => {});
}

nativo?.aoEvento((evento, dados) => {
  if (evento !== 'musica' || !dj || dj.preparando) return;
  const { canal, item } = dj;
  dj = null;
  enviar(dados.estado === 'fim' ? { t: 'musica-fim', canal, item } : { t: 'musica-erro', canal, item, erro: dados.erro || 'erro' });
});

/** Comandos de música no chat (igual bot do Discord): /play, /skip, /pause, /resume, /stop. Retorna true se tratou. */
export function comandoMusica(texto) {
  const m = texto.trim().match(/^\/(play|p|tocar|skip|pular|pause|pausar|resume|continuar|stop|parar)\b\s*(.*)$/i);
  if (!m) return false;
  const canal = minhaCall.value?.canal;
  if (!canal) { aviso.value = '🎵 Entre numa call para usar a música.'; return true; }
  const cmd = m[1].toLowerCase(), arg = m[2].trim();
  if (['play', 'p', 'tocar'].includes(cmd)) {
    if (!arg) { aviso.value = 'Use: /play nome da música ou link'; return true; }
    tocarMusica(arg);
  } else if (['skip', 'pular'].includes(cmd)) enviar({ t: 'musica-pular', canal });
  else if (['pause', 'pausar'].includes(cmd)) enviar({ t: 'musica-pausar', canal, pausado: true });
  else if (['resume', 'continuar'].includes(cmd)) enviar({ t: 'musica-pausar', canal, pausado: false });
  else enviar({ t: 'musica-parar', canal });
  return true;
}

export function tocarMusica(consulta) {
  const canal = minhaCall.value?.canal;
  if (!canal || !consulta.trim()) return;
  enviar({ t: 'musica-add', canal, consulta: consulta.trim() });
  if (!pessoasNaCall(canal).some(p => p.app)) aviso.value = '🎵 Na fila — mas só toca quando alguém com o app desktop estiver na call.';
}

// ---------------- bot na call e sons de quem entra no ao vivo ----------------

/** O Jorginho DJ "está na call" quando tem música tocando ou na fila (aparece já procurando a música). */
export const botNoCanal = canal => { const m = musica.value[canal]; return !!(m && (m.tocando || m.fila?.length)); };

let botAntes = false, telasAntes = null;
effect(() => {
  const call = minhaCall.value;
  const pronta = call && !call.conectando;
  const bot = pronta && botNoCanal(call.canal);
  if (pronta) {
    if (bot && !botAntes) som('bot-entrou');
    else if (!bot && botAntes) som('bot-saiu');
  }
  botAntes = !!bot;

  // Alguém (não eu) começou a transmitir na minha call.
  const telas = pronta ? new Set(pessoasNaCall(call.canal).filter(p => p.trilhas?.tela && p.uid !== eu.value?.id).map(p => p.uid)) : null;
  if (telas && telasAntes && [...telas].some(u => !telasAntes.has(u))) som('live-outro');
  telasAntes = telas;
});

// ---------------- estatísticas da transmissão (painel "Estatísticas") ----------------

/**
 * Quem transmite manda os números do envio a cada 2 s para quem está na call (o servidor repassa só para lá).
 * App desktop: o que saiu do codificador + o relatório do Cloudflare + a CPU do PC. Navegador: getStats() do envio.
 * Celular ainda não manda (o painel mostra só o lado de quem assiste).
 */
let amostraEnvio = null;
setInterval(async () => {
  if (!minhaCall.value || minhaCall.value.conectando || !(telaNativa || locais.tela)) { amostraEnvio = null; return; }
  try {
    let s = null;
    if (telaNativa?.ponte === nativo && nativo?.estatisticas) s = { ...(await nativo.estatisticas()), origem: 'app' };
    else if (locais.tela && pc) {
      s = lerEnvioNavegador(await pc.getStats(locais.tela.track), amostraEnvio);
      amostraEnvio = s;
      if (s) s.alvoFps = locais.tela.track.getSettings?.().frameRate || null;
    }
    if (!s) return;
    enviar({ t: 'voz-stats', s });
    const m = new Map(statsEnvio.value);
    m.set(eu.value.id, { ...s, quando: Date.now() });
    statsEnvio.value = m;
  } catch { }
}, 2000);

/** Números do que chega aqui da transmissão de uma pessoa (anterior = a amostra de 2 s atrás). */
export async function medirRecebimento(uid, anterior) {
  const track = midias.value.get(`${uid}:tela`)?.getVideoTracks()[0];
  if (!track || !pcR) return null;
  return lerRecebimento(await pcR.getStats(track), anterior);
}
