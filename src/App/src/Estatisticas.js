// Painel "Estatísticas" da transmissão: números de quem transmite (mandados pelo servidor a cada ~2 s, só para a
// mesma call) e de quem assiste (medidos aqui), e um veredito de onde está o problema.
import { signal } from '@preact/signals';
import { eventosVoz } from './store.js';

/** uid → últimos números de envio de quem transmite ({ fps, alvoFps, kbps, perda, pingMs, cpu, limite, … , quando }). */
export const statsEnvio = signal(new Map());

eventosVoz.addEventListener('stats', e => {
  const { uid, s } = e.detail;
  const m = new Map(statsEnvio.value);
  m.set(uid, { ...s, quando: Date.now() });
  statsEnvio.value = m;
});

/** Números de quem assiste, de um getStats() do recebimento, comparando com a amostra anterior. */
export function lerRecebimento(relatorio, anterior) {
  let video = null, par = null;
  relatorio.forEach(r => {
    if (r.type === 'inbound-rtp' && r.kind === 'video') video = r;
    if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && r.currentRoundTripTime != null) par = r;
  });
  if (!video) return null;
  const agora = video.timestamp;
  const dt = anterior ? (agora - anterior.t) / 1000 : 0;
  const recebidos = video.packetsReceived || 0, perdidos = Math.max(0, video.packetsLost || 0);
  const novos = anterior ? (recebidos - anterior.recebidos) + (perdidos - anterior.perdidos) : 0;
  return {
    t: agora, bytes: video.bytesReceived || 0, recebidos, perdidos, travadas: video.freezeCount || 0,
    largura: video.frameWidth || null, altura: video.frameHeight || null,
    fps: video.framesPerSecond ?? null,
    kbps: anterior && dt > 0 ? Math.round(((video.bytesReceived || 0) - anterior.bytes) * 8 / dt / 1000) : null,
    perda: anterior && novos > 0 ? Math.round(1000 * (perdidos - anterior.perdidos) / novos) / 10 : 0,
    jitterMs: video.jitter != null ? Math.round(video.jitter * 1000) : null,
    pingMs: par ? Math.round(par.currentRoundTripTime * 1000) : null,
    travadasNovas: anterior ? (video.freezeCount || 0) - anterior.travadas : 0,
  };
}

/** Números de quem transmite pelo navegador, de um getStats() do envio da tela. */
export function lerEnvioNavegador(relatorio, anterior) {
  let saida = null, remoto = null, par = null;
  relatorio.forEach(r => {
    if (r.type === 'outbound-rtp' && r.kind === 'video') saida = r;
    if (r.type === 'remote-inbound-rtp' && r.kind === 'video') remoto = r;
    if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && r.currentRoundTripTime != null) par = r;
  });
  if (!saida) return null;
  const dt = anterior ? (saida.timestamp - anterior.t) / 1000 : 0;
  return {
    t: saida.timestamp, bytes: saida.bytesSent || 0, origem: 'navegador',
    fps: saida.framesPerSecond ?? null, largura: saida.frameWidth || null, altura: saida.frameHeight || null,
    kbps: anterior && dt > 0 ? Math.round(((saida.bytesSent || 0) - anterior.bytes) * 8 / dt / 1000) : null,
    perda: remoto?.fractionLost != null ? Math.round(remoto.fractionLost * 1000) / 10 : null,
    jitterMs: remoto?.jitter != null ? Math.round(remoto.jitter * 1000) : null,
    pingMs: remoto?.roundTripTime != null ? Math.round(remoto.roundTripTime * 1000) : par ? Math.round(par.currentRoundTripTime * 1000) : null,
    limite: saida.qualityLimitationReason || null, encoder: saida.encoderImplementation || null,
  };
}

/**
 * Onde está o problema? t = quem transmite, v = quem assiste (eu). Devolve { nivel: 'ok'|'aviso'|'ruim', texto }.
 * Os limites são os de uma call boa: perda até 2%, ping até 150 ms, fps pelo menos 70% do escolhido.
 */
export function diagnostico(t, v) {
  const deles = [], meus = [];
  if (t) {
    if (t.perda > 2) deles.push(`perdendo ${t.perda}% dos pacotes no envio (Wi-Fi ou upload instável)`);
    if (t.pingMs > 150) deles.push(`ping alto até o Cloudflare (${t.pingMs} ms)`);
    if (t.limite === 'bandwidth') deles.push('o upload não aguenta a qualidade escolhida');
    if (t.filaMs > 200) deles.push(`o vídeo está acumulando para sair (${t.filaMs} ms de fila): o upload não dá conta`);
    if (t.limite === 'cpu' || t.cpu >= 90) deles.push(`o PC está no limite (CPU ${t.cpu ?? '?'}%)`);
    if (t.alvoFps && t.fps != null && t.fps < t.alvoFps * 0.7) deles.push(`a captura está saindo a ${t.fps} de ${t.alvoFps} fps`);
  }
  if (v) {
    if (v.perda > 2) meus.push(`você está perdendo ${v.perda}% dos pacotes`);
    if (v.pingMs > 150) meus.push(`seu ping até o Cloudflare está alto (${v.pingMs} ms)`);
  }
  if (deles.length) return { nivel: 'ruim', texto: 'O problema está em quem transmite: ' + deles.join('; ') + '.' };
  if (meus.length) return { nivel: 'ruim', texto: 'O problema está na sua conexão: ' + meus.join('; ') + '.' };
  // Sem problema na minha conexão: travada ou fps baixo vêm do envio (mesmo sem os números de quem transmite).
  if (v?.travadasNovas > 0) return { nivel: 'aviso', texto: 'O vídeo travou sem perda na sua conexão: veio do envio de quem transmite.' };
  if (v && v.fps != null && v.fps < 15) return { nivel: 'aviso', texto: `Chegam só ${v.fps} fps sem perda na sua conexão: o envio de quem transmite está fraco.` };
  if (!t) return { nivel: 'aviso', texto: 'Do seu lado está tudo bem. Sem os números de quem transmite (app antigo ou celular).' };
  return { nivel: 'ok', texto: 'Tudo certo dos dois lados.' };
}
