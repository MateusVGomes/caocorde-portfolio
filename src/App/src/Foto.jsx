import { useEffect, useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { ImagePlus, Trash2 } from 'lucide-preact';
import { eu, membros, aviso } from './store.js';
import { Avatar, Dialogo, botaoVermelho, botaoCinza } from './ui.jsx';

/**
 * Foto de perfil no padrão do Concorde: a pessoa enquadra num círculo (arrasta e dá zoom) e o app manda só o recorte,
 * 256×256 em WebP (~20-50 KB). O servidor recusa o que passar de 256 KB ou 512×512, então nada grande vai para o R2.
 */
const LADO = 256;
const MAX_BYTES = 256 * 1024;
const MAX_ORIGINAL = 25 * 1024 * 1024;   // foto do celular de até 25 MB (só para abrir; o que sobe é o recorte)

function atualizarMembro(m) {
  if (!m) return;
  const mapa = new Map(membros.value);
  mapa.set(m.id, m);
  membros.value = mapa;
  if (eu.value?.id === m.id) eu.value = m;
}

/** Canvas → WebP (ou JPEG, se o navegador não fizer WebP), baixando a qualidade até caber no limite. */
async function comprimir(canvas) {
  const gerar = (tipo, q) => new Promise(r => canvas.toBlob(r, tipo, q));
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    let b = await gerar('image/webp', q);
    if (!b || b.type !== 'image/webp') b = await gerar('image/jpeg', q);
    if (b && b.size <= MAX_BYTES) return b;
  }
  throw new Error('não deu para comprimir a foto');
}

export function FotoPerfil() {
  const imagem = useSignal(null);   // ImageBitmap aberta para recortar
  const enviando = useSignal(false);
  const entrada = useRef();

  async function escolher(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) return void (aviso.value = 'Escolha uma imagem.');
    if (f.size > MAX_ORIGINAL) return void (aviso.value = 'Imagem grande demais (máximo 25 MB).');
    try { imagem.value = await createImageBitmap(f); }
    catch { aviso.value = 'Não consegui abrir essa imagem.'; }
  }

  async function mandar(metodo, corpo) {
    enviando.value = true;
    try {
      const r = await fetch('/api/avatar', { method: metodo, body: corpo, headers: corpo ? { 'Content-Type': corpo.type } : {} });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || `erro ${r.status}`);
      atualizarMembro(j.membro);
      aviso.value = metodo === 'DELETE' ? 'Foto removida' : 'Foto de perfil trocada ✓';
      return true;
    } catch (e) {
      aviso.value = 'Não deu para salvar a foto: ' + e.message;
      return false;
    } finally { enviando.value = false; }
  }

  return (
    <div class="flex items-center gap-3">
      <Avatar membro={eu.value} tamanho="w-16 h-16 text-2xl" raio="rounded-full" />
      <div class="flex flex-wrap gap-2">
        <button type="button" class={`${botaoCinza} flex items-center gap-2 !py-2 !text-xs`} disabled={enviando.value} onClick={() => entrada.current.click()}>
          <ImagePlus size={15} /> {eu.value?.avatar ? 'Trocar foto' : 'Colocar foto'}
        </button>
        {eu.value?.avatar && (
          <button type="button" class={`${botaoCinza} flex items-center gap-2 !py-2 !text-xs`} disabled={enviando.value} onClick={() => mandar('DELETE')}>
            <Trash2 size={15} /> Remover
          </button>
        )}
      </div>
      <input ref={entrada} type="file" accept="image/*" class="hidden" onChange={escolher} />
      {imagem.value && (
        <Recortar imagem={imagem.value} enviando={enviando.value}
          onCancelar={() => { imagem.value.close?.(); imagem.value = null; }}
          onSalvar={async blob => { if (await mandar('POST', blob)) { imagem.value.close?.(); imagem.value = null; } }} />
      )}
    </div>
  );
}

/** Enquadrar: arrasta para posicionar, barra (ou rodinha do mouse) para o zoom. O círculo mostra o que fica. */
function Recortar({ imagem, enviando, onCancelar, onSalvar }) {
  const tela = useRef();
  const cobrir = Math.max(LADO / imagem.width, LADO / imagem.height);   // zoom 1 = a foto cobre o quadrado todo
  const zoom = useSignal(1);
  const pos = useSignal({ x: (LADO - imagem.width * cobrir) / 2, y: (LADO - imagem.height * cobrir) / 2 });
  const arrasto = useRef(null);

  const escala = () => cobrir * zoom.value;
  // A foto nunca deixa buraco dentro do quadrado.
  const prender = ({ x, y }, s = escala()) => ({
    x: Math.min(0, Math.max(LADO - imagem.width * s, x)),
    y: Math.min(0, Math.max(LADO - imagem.height * s, y)),
  });

  function desenhar(canvas) {
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, LADO, LADO);
    const s = escala();
    g.drawImage(imagem, pos.value.x, pos.value.y, imagem.width * s, imagem.height * s);
  }
  useEffect(() => { desenhar(tela.current); }, [zoom.value, pos.value]);

  function mudarZoom(novo) {
    novo = Math.min(4, Math.max(1, novo));
    // Mantém o centro do círculo no mesmo ponto da foto.
    const antes = escala(), depois = cobrir * novo, c = LADO / 2;
    const x = c - (c - pos.value.x) * (depois / antes), y = c - (c - pos.value.y) * (depois / antes);
    zoom.value = novo;
    pos.value = prender({ x, y }, depois);
  }

  async function salvar() {
    const c = Object.assign(document.createElement('canvas'), { width: LADO, height: LADO });
    desenhar(c);
    try { onSalvar(await comprimir(c)); }
    catch (e) { aviso.value = e.message; }
  }

  return (
    <Dialogo titulo="Enquadrar a foto" onFechar={onCancelar}>
      <div class="space-y-4">
        <div class="relative mx-auto overflow-hidden rounded-2xl bg-slate-950 touch-none select-none cursor-grab active:cursor-grabbing" style={{ width: LADO, height: LADO }}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); arrasto.current = { x: e.clientX, y: e.clientY, p: pos.value }; }}
          onPointerMove={e => { const a = arrasto.current; if (a) pos.value = prender({ x: a.p.x + e.clientX - a.x, y: a.p.y + e.clientY - a.y }); }}
          onPointerUp={() => { arrasto.current = null; }}
          onWheel={e => { e.preventDefault(); mudarZoom(zoom.value * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }}>
          <canvas ref={tela} width={LADO} height={LADO} class="block" />
          <div class="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: '0 0 0 999px rgba(0,0,0,.55)' }} />
        </div>
        <label class="flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">Zoom
          <input type="range" min="1" max="4" step="0.01" value={zoom.value} onInput={e => mudarZoom(Number(e.target.value))} class="flex-1 accent-brand-500" />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class={botaoCinza} onClick={onCancelar}>Cancelar</button>
          <button type="button" class={botaoVermelho} disabled={enviando} onClick={salvar}>{enviando ? 'Salvando…' : 'Salvar foto'}</button>
        </div>
      </div>
    </Dialogo>
  );
}
