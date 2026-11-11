// Atalhos de teclado (igual o Discord): mutar o microfone, mutar tudo (microfone + som da call) e ligar/desligar a câmera.
// No app do PC são globais (funcionam com o jogo na frente); no navegador, só com a aba do Concorde em foco.
import { signal, effect, useSignal } from '@preact/signals';
import { X } from 'lucide-preact';
import { aviso } from './store.js';
import { nativo, alternarMudo, alternarSurdo, alternarCamera } from './voz.js';

const ACOES = [
  { acao: 'mudo', nome: 'Mutar o microfone', fazer: alternarMudo },
  { acao: 'surdo', nome: 'Mutar tudo (microfone e som da call)', fazer: alternarSurdo },
  { acao: 'camera', nome: 'Ligar/desligar a câmera', fazer: alternarCamera },
];
const PADRAO = { mudo: 'Ctrl+Shift+M', surdo: 'Ctrl+Shift+D', camera: 'Ctrl+Shift+K' };

function ler() {
  try { return { ...PADRAO, ...JSON.parse(localStorage.getItem('concorde-atalhos') || '{}') }; } catch { return { ...PADRAO }; }
}
export const atalhos = signal(ler());
/** Combinações que o Windows recusou (outro app já usa). */
const recusados = signal([]);

function fazer(acao) { ACOES.find(a => a.acao === acao)?.fazer(); }

// O app do PC usa a versão global; app antigo (sem a função) ou navegador ficam com o teclado da página.
const globais = !!nativo?.atalhos;
if (globais) {
  effect(() => {
    const lista = Object.entries(atalhos.value).filter(([, combo]) => combo).map(([acao, combo]) => ({ acao, combo }));
    nativo.atalhos(lista).then(r => { recusados.value = r || []; }).catch(() => {});
  });
  nativo.aoEvento((evento, dados) => { if (evento === 'atalho') fazer(dados.acao); });
} else {
  window.addEventListener('keydown', e => {
    if (gravando || e.repeat) return;
    const combo = comboDe(e);
    const acao = combo && Object.keys(atalhos.value).find(a => atalhos.value[a] === combo);
    if (acao) { e.preventDefault(); fazer(acao); }
  });
}

/** Tecla apertada → "Ctrl+Shift+M". Só letras, números e F1–F24; letra/número precisa de Ctrl ou Alt (senão rouba a digitação). */
function comboDe(e) {
  const m = /^(?:Key([A-Z])|Digit(\d)|(F\d{1,2}))$/.exec(e.code);
  if (!m) return null;
  const tecla = m[1] || m[2] || m[3];
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
  if (!m[3] && !e.ctrlKey && !e.altKey) return null;
  return [...mods, tecla].join('+');
}

let gravando = false;

/** Configurações → Atalhos: clica no atalho e aperta a combinação nova; Backspace tira; Esc cancela. */
export function ConfigAtalhos() {
  const editando = useSignal(null);
  function gravar(acao) {
    editando.value = acao;
    gravando = true;
    const fim = () => { window.removeEventListener('keydown', tecla, true); gravando = false; editando.value = null; };
    function tecla(e) {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;   // ainda montando a combinação
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return fim();
      if (e.key === 'Backspace' || e.key === 'Delete') { salvar(acao, ''); return fim(); }
      const combo = comboDe(e);
      if (!combo) { aviso.value = 'Use Ctrl ou Alt + uma letra ou número (ou uma tecla F1–F12)'; return; }
      const outra = ACOES.find(a => a.acao !== acao && atalhos.value[a.acao] === combo);
      if (outra) salvar(outra.acao, '');   // a mesma combinação não pode fazer duas coisas
      salvar(acao, combo);
      fim();
    }
    window.addEventListener('keydown', tecla, true);
  }
  return (
    <div class="space-y-1.5 normal-case font-normal">
      <p class="text-xs text-slate-400">
        {globais ? 'Funcionam mesmo com o jogo na frente, e a tecla continua chegando nos outros apps: dá para usar a mesma do Discord (ex.: F8 muta os dois).' : 'No navegador, só funcionam com o Caocorde em foco (no app do PC funcionam com o jogo na frente).'}
        {' '}Clique e aperte a combinação; o X tira o atalho.
      </p>
      {ACOES.map(a => {
        const combo = atalhos.value[a.acao];
        const recusado = combo && recusados.value.includes(combo);
        return (
          <div key={a.acao} class="flex items-center gap-2">
            <span class="text-xs text-slate-300 flex-1">{a.nome}</span>
            <button type="button" onClick={() => gravar(a.acao)}
              class={`text-xs font-bold font-mono rounded-lg px-2.5 py-1.5 border min-w-[120px] ${editando.value === a.acao ? 'border-brand-500 text-brand-400 bg-slate-900' : recusado ? 'border-red-500/60 text-red-400 bg-slate-800/80' : 'border-slate-700/80 text-slate-200 bg-slate-800/80 hover:bg-slate-700/80'}`}
              title={recusado ? 'Outro programa já usa essa combinação — escolha outra' : ''}>
              {editando.value === a.acao ? 'Aperte as teclas…' : combo || 'Nenhum'}
            </button>
            <button type="button" title="Tirar este atalho" disabled={!combo} onClick={() => salvar(a.acao, '')}
              class="p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-slate-800 disabled:opacity-0">
              <X size={14} />
            </button>
          </div>
        );
      })}
      {recusados.value.length > 0 && <p class="text-xs text-red-400">Em vermelho: o app do PC não aceitou essa combinação. Escolha outra.</p>}
    </div>
  );
}

function salvar(acao, combo) {
  atalhos.value = { ...atalhos.value, [acao]: combo };
  try { localStorage.setItem('concorde-atalhos', JSON.stringify(atalhos.value)); } catch {}
}
