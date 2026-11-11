import { useEffect, useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { Paperclip, Mic, Square, X, Trash2, Play, Pause, FileWarning } from 'lucide-preact';
import { aviso } from './store.js';
import { NoTopo } from './ui.jsx';
import { pegarMicrofone } from './voz.js';

// Anexos do chat: imagens, vídeos e áudios de até 20 MB, que somem depois de 7 dias.
export const ANEXO_MAX = 20 * 1024 * 1024;
const VOZ_MAX_S = 5 * 60;
const mb = b => (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
const tempo = s => (s == null || !isFinite(s) ? '0:00' : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'));

/** Sobe o arquivo para o R2 (com progresso). Resolve com { chave, nome, tipo, tamanho }. */
export function subirArquivo(canal, arquivo, nome, onProgresso) {
  return new Promise((ok, falha) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/arquivos?canal=' + canal);
    x.setRequestHeader('Content-Type', arquivo.type);
    x.setRequestHeader('X-Nome', encodeURIComponent(nome || arquivo.name || 'arquivo'));
    x.upload.onprogress = e => e.lengthComputable && onProgresso?.(e.loaded / e.total);
    x.onload = () => {
      let r = {};
      try { r = JSON.parse(x.responseText); } catch { }
      x.status === 200 ? ok(r) : falha(new Error(r.erro || 'Não deu para enviar o arquivo.'));
    };
    x.onerror = () => falha(new Error('Sem conexão para enviar o arquivo.'));
    x.send(arquivo);
  });
}

/** Confere tipo e tamanho antes de mandar. */
export function arquivoOk(f) {
  if (!/^(image|video|audio)\//.test(f.type)) { aviso.value = 'Só dá para mandar imagem, vídeo ou áudio.'; return false; }
  if (f.size > ANEXO_MAX) { aviso.value = 'O arquivo tem ' + mb(f.size) + ' — o máximo é 20 MB.'; return false; }
  return true;
}

/** Botão de clipe: escolhe arquivos do computador. */
export function BotaoAnexar({ onArquivo }) {
  const input = useRef(null);
  return (
    <>
      <input ref={input} type="file" accept="image/*,video/*,audio/*" class="hidden"
        onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f && arquivoOk(f)) onArquivo(f); }} />
      <button type="button" title="Mandar imagem, vídeo ou áudio (até 20 MB)" onClick={() => input.current.click()}
        class="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><Paperclip size={18} /></button>
    </>
  );
}

/** Gravador de mensagem de voz: clica para gravar, de novo para mandar (ou lixeira para desistir). */
export function GravarVoz({ onPronto }) {
  const gravando = useSignal(null);   // { inicio }
  const agora = useSignal(0);
  const rec = useRef(null);
  useEffect(() => () => parar(false), []);
  useEffect(() => {
    if (!gravando.value) return;
    const t = setInterval(() => {
      agora.value = (Date.now() - gravando.value.inicio) / 1000;
      if (agora.value >= VOZ_MAX_S) parar(true);
    }, 250);
    return () => clearInterval(t);
  }, [gravando.value]);

  async function comecar() {
    let stream;
    try { stream = await pegarMicrofone(); }
    catch { aviso.value = 'Sem acesso ao microfone.'; return; }
    const tipo = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    const r = new MediaRecorder(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 48000 } : undefined);
    const partes = [];
    r.ondataavailable = e => e.data.size && partes.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const dur = (Date.now() - r.inicio) / 1000;
      if (r.mandar && dur >= 0.5) {
        const blob = new Blob(partes, { type: (r.mimeType || 'audio/webm').split(';')[0] });
        onPronto(blob, dur);
      }
    };
    r.inicio = Date.now();
    r.start(1000);
    rec.current = r;
    agora.value = 0;
    gravando.value = { inicio: r.inicio };
  }

  function parar(mandar) {
    const r = rec.current;
    rec.current = null;
    gravando.value = null;
    if (r && r.state !== 'inactive') { r.mandar = mandar; r.stop(); }
  }

  if (!gravando.value) {
    return (
      <button type="button" title="Gravar mensagem de voz" onClick={comecar}
        class="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><Mic size={18} /></button>
    );
  }
  return (
    <div class="flex items-center gap-2 bg-red-500/15 border border-red-500/40 rounded-xl pl-3 pr-1 py-1">
      <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      <span class="text-xs font-bold tabular-nums text-red-300">{tempo(agora.value)}</span>
      <button type="button" title="Desistir" onClick={() => parar(false)} class="p-1.5 rounded-lg text-slate-400 hover:text-red-400"><Trash2 size={15} /></button>
      <button type="button" title="Mandar" onClick={() => parar(true)} class="p-1.5 rounded-lg bg-red-500 text-white keep-white"><Square size={13} fill="currentColor" /></button>
    </div>
  );
}

/** Arquivo subindo, acima da caixa de texto. */
export function EnviandoAnexo({ nome, progresso, onCancelar }) {
  return (
    <div class="flex items-center gap-2 px-4 py-2 text-xs text-slate-300 bg-slate-950/60 border-b border-slate-800/80">
      <Paperclip size={13} class="flex-shrink-0" />
      <span class="truncate max-w-[40%]">{nome}</span>
      <div class="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden"><div class="h-full bg-brand-500 transition-all" style={{ width: Math.round(progresso * 100) + '%' }} /></div>
      <span class="tabular-nums text-slate-400">{Math.round(progresso * 100)}%</span>
      {onCancelar && <button class="hover:text-white" onClick={onCancelar} title="Cancelar"><X size={14} /></button>}
    </div>
  );
}

/** Anexo dentro da mensagem. */
export function Anexo({ a }) {
  const aberto = useSignal(false);
  // A foto não carregou (arquivo sumiu, internet caiu): mostra um aviso no lugar do ícone de imagem quebrada.
  const fotoNaoCarregou = useSignal(false);
  if (fotoNaoCarregou.value) {
    return <div class="mt-1 inline-flex items-center gap-2 text-xs text-slate-500 italic"><FileWarning size={14} /> {a.nome} — não deu para carregar a foto</div>;
  }
  if (a.expirou) {
    return <div class="mt-1 inline-flex items-center gap-2 text-xs text-slate-500 italic"><FileWarning size={14} /> {a.voz ? 'mensagem de voz' : a.nome} — apagado depois de 7 dias</div>;
  }
  const url = '/api/arquivos/' + a.chave;
  if (a.tipo.startsWith('image/')) {
    return (
      <>
        <img src={url} alt={a.nome} loading="lazy" onClick={() => { aberto.value = true; }} onError={() => { fotoNaoCarregou.value = true; }}
          class="mt-1 max-h-80 max-w-full sm:max-w-md rounded-xl border border-slate-800/80 cursor-zoom-in bg-slate-950/40" />
        {aberto.value && (
          <NoTopo>
            <div class="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6 cursor-zoom-out" onClick={() => { aberto.value = false; }}>
              <img src={url} alt={a.nome} class="max-w-full max-h-full rounded-lg shadow-2xl" />
            </div>
          </NoTopo>
        )}
      </>
    );
  }
  if (a.tipo.startsWith('video/')) {
    return <video src={url} controls preload="metadata" class="mt-1 max-h-80 max-w-full sm:max-w-md rounded-xl border border-slate-800/80 bg-black" />;
  }
  return <Audio url={url} a={a} />;
}

/** Player compacto para áudio e mensagem de voz. */
function Audio({ url, a }) {
  const el = useRef(null);
  const tocando = useSignal(false);
  const pos = useSignal(0);
  const dur = useSignal(a.duracao || 0);
  const alternar = () => { const e = el.current; e.paused ? e.play().catch(() => {}) : e.pause(); };
  return (
    <div class="mt-1 flex items-center gap-3 w-72 max-w-full bg-slate-800/60 border border-slate-700/60 rounded-2xl px-3 py-2">
      <audio ref={el} src={url} preload="metadata"
        onPlay={() => { tocando.value = true; }} onPause={() => { tocando.value = false; }} onEnded={() => { tocando.value = false; pos.value = 0; }}
        onTimeUpdate={e => { pos.value = e.currentTarget.currentTime; }}
        onLoadedMetadata={e => { if (isFinite(e.currentTarget.duration)) dur.value = e.currentTarget.duration; }} />
      <button onClick={alternar} class="w-9 h-9 flex-shrink-0 rounded-full bg-brand-500 hover:bg-brand-400 text-white flex items-center justify-center keep-white">
        {tocando.value ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" class="ml-0.5" />}
      </button>
      <div class="flex-1 min-w-0">
        <div class="text-[11px] font-bold text-slate-300 truncate">{a.voz ? '🎙️ Mensagem de voz' : a.nome}</div>
        <input type="range" min="0" max={dur.value || 1} step="0.1" value={pos.value} class="w-full accent-brand-500 h-1"
          onInput={e => { el.current.currentTime = Number(e.currentTarget.value); }} />
      </div>
      <span class="text-[10px] tabular-nums text-slate-400 flex-shrink-0">{tempo(tocando.value || pos.value ? pos.value : dur.value)}</span>
    </div>
  );
}
