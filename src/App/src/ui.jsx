import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';

/**
 * Desenha direto no <body>. Janela "fixed" dentro de um painel com efeito de vidro (backdrop-blur) fica presa
 * nele — era isso que espremia a tela de transmitir na área da call e jogava o menu de volume para o canto.
 */
export function NoTopo({ children }) { return createPortal(children, document.body); }
import { aviso, presencas } from './store.js';

/** Endereço da foto de perfil (muda a cada troca, então o navegador guarda no cache sem medo). */
export const urlAvatar = m => (m?.avatar ? `/api/avatar/${m.id}?v=${m.avatar}` : null);

/** Avatar: foto da pessoa (ou a inicial do nome na cor dela), com bolinha de presença opcional. */
export function Avatar({ membro, tamanho = 'w-10 h-10 text-base', presenca = false, raio = 'rounded-xl' }) {
  const estado = presencas.value[membro?.id] || 'offline';
  const cor = { online: 'bg-emerald-500', ausente: 'bg-amber-400', offline: 'bg-slate-500' }[estado];
  const foto = urlAvatar(membro);
  const [quebrou, setQuebrou] = useState(null);
  return (
    <div class="relative flex-shrink-0">
      {foto && quebrou !== foto
        ? <img src={foto} alt={membro.nome} loading="lazy" onError={() => setQuebrou(foto)} class={`${tamanho} ${raio} object-cover shadow bg-slate-800`} />
        : <div class={`${tamanho} ${raio} flex items-center justify-center font-black text-white shadow keep-white`} style={{ background: membro?.cor || '#64748b' }}>
            {[...(membro?.nome || '?')][0].toUpperCase()}
          </div>}
      {presenca && <span class={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-[3px] border-slate-900 ${cor}`} title={estado} />}
    </div>
  );
}

/** Aviso rápido no canto (erros do servidor, "copiado", etc.). */
export function Toast() {
  useEffect(() => {
    if (!aviso.value) return;
    const t = setTimeout(() => { aviso.value = null; }, 3500);
    return () => clearTimeout(t);
  }, [aviso.value]);
  return (
    <div class={`fixed bottom-5 right-5 z-50 transition-all duration-300 bg-slate-800/90 border border-slate-700/90 text-white px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md text-xs font-bold pointer-events-none ${aviso.value ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-20'}`}>
      {aviso.value}
    </div>
  );
}

/** Padrão de senha do 0.5 (o servidor confere igual). */
const REGRAS = [
  [s => s.length >= 8, '8 caracteres ou mais'],
  [s => /[A-Z]/.test(s) && /[a-z]/.test(s), 'maiúscula e minúscula'],
  [s => /[0-9]/.test(s), 'um número'],
  [s => /[^A-Za-z0-9]/.test(s), 'um símbolo (! @ # $ %…)'],
];
export const senhaOk = s => REGRAS.every(([ok]) => ok(s || ''));

/** Lista que vai ficando verde enquanto a pessoa digita a senha (e a confirmação). */
export function RegrasSenha({ senha = '', confirmar = '' }) {
  const item = (ok, texto) => (
    <li key={texto} class={`flex items-center gap-1.5 ${ok ? 'text-emerald-400' : 'text-slate-500'}`}>
      <span class="w-3 text-center">{ok ? '✓' : '•'}</span>{texto}
    </li>
  );
  return (
    <ul class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] font-semibold">
      {REGRAS.map(([ok, texto]) => item(ok(senha), texto))}
      {item(!!senha && senha === confirmar, 'confirmação igual')}
    </ul>
  );
}

/** Círculo girando (carregando). */
export function Girando({ tamanho = 20, class: classe = '' }) {
  return <svg class={`animate-spin ${classe}`} width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity=".25" stroke-width="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>;
}

export const hora = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function dataLonga(ts) {
  const d = new Date(ts), hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return `Hoje às ${hora(ts)}`;
  if (d.toDateString() === ontem.toDateString()) return `Ontem às ${hora(ts)}`;
  return `${d.toLocaleDateString('pt-BR')} ${hora(ts)}`;
}

/** Caixinha de diálogo simples (renomear canal, perfil…). */
export function Dialogo(props) { return <NoTopo><DialogoConteudo {...props} /></NoTopo>; }

function DialogoConteudo({ titulo, children, onFechar }) {
  // Esc fecha qualquer diálogo (o jeito que todo mundo espera de uma janelinha). Ouve na fase de "captura" e para
  // o Esc ali: se o diálogo está por cima das Configurações (ex.: enquadrar a foto), só ele fecha, não as duas.
  useEffect(() => {
    const fecharNoEsc = evento => { if (evento.key === 'Escape') { evento.stopPropagation(); onFechar(); } };
    addEventListener('keydown', fecharNoEsc, true);
    return () => removeEventListener('keydown', fecharNoEsc, true);
  }, []);
  return (
    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onFechar()}>
      <div class="w-full max-w-sm bg-slate-900/95 border border-slate-800/80 rounded-2xl shadow-2xl p-5 space-y-4 animate-fade-in">
        <h2 class="text-sm font-extrabold uppercase tracking-wider text-white">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

export const campo = 'w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-acento-400';
/** Botão da ação principal da tela (laranja, texto branco: contraste 5,2:1 — ver docs/design.md). */
export const botaoPrincipal = 'bg-brand-600 hover:bg-brand-500 active:scale-[.98] text-white font-bold rounded-xl px-4 py-2.5 text-sm shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed';
/** Nome antigo do botão principal (era vermelho na 0.4); mantido para os arquivos que ainda usam. */
export const botaoVermelho = botaoPrincipal;
export const botaoCinza = 'bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-slate-200 font-bold rounded-xl px-4 py-2.5 text-sm transition-all';
