import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { ScreenShare, RefreshCw, X } from 'lucide-preact';
import { QUALIDADES, nativo, transmitirNativo, ajustarNativo } from './voz.js';
import { NoTopo, Girando } from './ui.jsx';

const lerPref = (k, padrao) => { try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } };
const salvarPref = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/**
 * App desktop: escolha do que transmitir pela captura nativa (igual ao "Go Live" do Discord):
 * telas e janelas com miniatura, qualidade, placa de vídeo, apps que entram no som e modo jogo (cursor).
 */
export function DialogoTransmitir(props) { return <NoTopo><DialogoTransmitirConteudo {...props} /></NoTopo>; }

/**
 * atual: o pedido da transmissão que já está no ar. Aí a janela vira "Ajustar transmissão": vem preenchida e o botão
 * aplica as mudanças sem fechar a live (qualidade, som, o que transmitir, placa e modo jogo).
 */
function DialogoTransmitirConteudo({ onFechar, atual }) {
  const aba = useSignal(atual?.fonte?.startsWith('tela:') ? 'tela' : 'janela');
  const fontes = useSignal(null);
  const apps = useSignal([]);
  const placas = useSignal([]);
  const escolhida = useSignal(atual?.fonte || null);
  const qualidade = useSignal(atual?.qualidade || lerPref('qualidadeNativa', '720p60'));
  const placa = useSignal(atual?.placa || lerPref('placaTela', 'auto'));
  // Igual ao Telinha: o Discord vem desmarcado (quem ainda usa o Discord na call não ecoa na live).
  // O som da call do Concorde nunca vai, e app que começar a tocar depois entra sozinho.
  const semSom = useSignal(new Set(atual?.semSom || lerPref('semSom3', ['discord', 'discordptb', 'discordcanary', 'discorddevelopment'])));
  const cursorJogo = useSignal(atual ? atual.cursorJogo : lerPref('cursorJogo', true));

  async function carregar() {
    fontes.value = null;
    const [f, a, p] = await Promise.all([nativo.fontes(), nativo.apps(), nativo.placas()]);
    fontes.value = f; apps.value = a; placas.value = p;
  }
  useEffect(() => { carregar().catch(e => { fontes.value = []; console.error(e); }); }, []);

  function ir(id = escolhida.value, atualizar = false) {
    const f = fontes.value?.find(x => x.id === id);
    if (!f) return;
    salvarPref('qualidadeNativa', qualidade.value); salvarPref('placaTela', placa.value);
    salvarPref('semSom3', [...semSom.value]); salvarPref('cursorJogo', cursorJogo.value);
    onFechar();
    // Manda a lista inteira (mesmo app fechado agora): se o Discord abrir no meio da live, continua de fora.
    const pedido = {
      fonte: f.id, nomeFonte: f.nome, qualidade: qualidade.value, placa: placa.value,
      semSom: [...semSom.value], cursorJogo: cursorJogo.value,
    };
    if (atual) ajustarNativo(pedido, atualizar);
    else transmitirNativo(pedido);
  }

  const lista = (fontes.value || []).filter(f => f.tipo === aba.value);
  const chip = ativo => `px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${ativo ? 'bg-slate-100 text-slate-900' : 'text-slate-300 hover:bg-slate-800'}`;
  const fora = [...semSom.value].filter(e => apps.value.some(a => a.exe === e)).length;

  const opcao = ativo => `rounded-xl px-2 py-2 text-xs font-bold border transition-colors ${ativo ? 'bg-brand-600 border-brand-500 text-white' : 'bg-slate-800/80 border-slate-700/80 text-slate-200 hover:bg-slate-700/80'}`;
  const titulo = 'text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5';

  // Duas colunas (igual o "Go Live" do Discord): à esquerda o que transmitir, com miniaturas grandes;
  // à direita as opções e o som, sempre à vista — nada some para fora da janela.
  return (
    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3" onClick={e => e.target === e.currentTarget && onFechar()}>
      <div class="w-full max-w-6xl h-[92vh] flex flex-col bg-slate-900/95 border border-slate-800/80 rounded-2xl shadow-2xl animate-fade-in overflow-hidden">
        <div class="px-4 py-3 flex items-center gap-2 border-b border-slate-800/80 flex-shrink-0">
          <h2 class="text-sm font-extrabold uppercase tracking-wider text-white mr-auto">{atual ? 'Ajustar transmissão (ao vivo)' : 'Transmitir'}</h2>
          <button class={chip(aba.value === 'janela')} onClick={() => { aba.value = 'janela'; }}>Janelas</button>
          <button class={chip(aba.value === 'tela')} onClick={() => { aba.value = 'tela'; }}>Telas</button>
          <button title="Atualizar lista" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" onClick={carregar}><RefreshCw size={15} /></button>
          <button title="Fechar" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" onClick={onFechar}><X size={16} /></button>
        </div>

        <div class="flex-1 min-h-0 flex flex-col md:flex-row">
          <div class="flex-1 min-h-0 overflow-y-auto p-4">
            {fontes.value == null ? <p class="text-sm text-slate-400 py-10 flex items-center justify-center gap-2"><Girando tamanho={18} /> Procurando janelas…</p>
              : lista.length === 0 ? <p class="text-sm text-slate-400 text-center py-10">Nada aberto aqui.</p> : (
                <div class={`grid gap-3 ${aba.value === 'tela' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-2 xl:grid-cols-3'}`}>
                  {lista.map(f => (
                    <button key={f.id} onClick={() => { escolhida.value = f.id; }} onDblClick={() => ir(f.id)} title={f.nome}
                      class={`text-left rounded-xl overflow-hidden border-2 bg-slate-800/60 transition-colors ${escolhida.value === f.id ? 'border-brand-500 ring-2 ring-brand-500/40' : 'border-transparent hover:border-slate-600'}`}>
                      <div class="aspect-video bg-slate-950 flex items-center justify-center">
                        {f.miniatura ? <img src={f.miniatura} alt="" class="w-full h-full object-contain" /> : <ScreenShare size={28} class="text-slate-600" />}
                      </div>
                      <div class="px-2.5 py-2 text-xs font-bold text-slate-200 truncate">{f.nome}</div>
                    </button>
                  ))}
                </div>
              )}
          </div>

          <aside class="md:w-80 flex-shrink-0 flex flex-col border-t md:border-t-0 md:border-l border-slate-800/80 bg-slate-950/40 max-h-[45%] md:max-h-none">
            <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              {atual && (
                <div class="bg-slate-800/60 border border-slate-700/80 rounded-xl p-3 space-y-2">
                  <button disabled={!escolhida.value} onClick={() => ir(escolhida.value, true)}
                    class="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-white text-slate-900 font-bold rounded-lg py-2 text-xs disabled:opacity-50">
                    <RefreshCw size={14} /> Atualizar a tela
                  </button>
                  <p class="text-[11px] text-slate-400 leading-snug">
                    Recomeça a captura da imagem e do som <b class="text-slate-300">sem parar a live</b> (quem assiste vê ~1 s parado). Resolve:
                    cursor invisível, imagem travada ou preta, app cujo som não entrou na live, e jogo que trocou de tela cheia
                    para janela (ou de resolução) no meio da transmissão.
                  </p>
                </div>
              )}
              <div>
                <div class={titulo}>Qualidade</div>
                <div class="grid grid-cols-2 gap-2">
                  {Object.entries(QUALIDADES).map(([k, v]) => (
                    <button key={k} onClick={() => { qualidade.value = k; }} class={opcao(qualidade.value === k)}>{v.nome}</button>
                  ))}
                </div>
              </div>
              <label class="block">
                <span class={titulo + ' block'}>Placa de vídeo</span>
                <select class="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg px-2 py-2 text-xs text-slate-100" value={placa.value} onChange={e => { placa.value = e.currentTarget.value; }}>
                  {placas.value.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </label>
              <label class="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" class="accent-brand-500 mt-0.5" checked={cursorJogo.value} onChange={e => { cursorJogo.value = e.currentTarget.checked; }} />
                <span><b>Modo jogo (cursor)</b><br /><span class="text-slate-500">Para jogo em que o cursor some na transmissão (acontece até no Go Live): o Caocorde desenha o cursor no vídeo. Vale para tela e janela. Jogo em tela cheia é transmitido pelo monitor dele (o alt+tab aparece).</span></span>
              </label>
              <div>
                <div class={titulo}>Som da transmissão — {fora === 0 ? 'todo o PC (sem a call)' : `${fora} app${fora > 1 ? 's' : ''} de fora`}</div>
                <div class="space-y-0.5 bg-slate-950/60 rounded-xl p-1.5">
                  {apps.value.length === 0 && <p class="text-xs text-slate-400 p-1.5">Nenhum app com som aberto agora.</p>}
                  {apps.value.map(a => (
                    <label key={a.exe} class="flex items-center gap-2 text-xs text-slate-200 px-2 py-1.5 rounded-lg hover:bg-slate-800/60 cursor-pointer">
                      <input type="checkbox" class="accent-brand-500" checked={!semSom.value.has(a.exe)}
                        onChange={e => { const s = new Set(semSom.value); e.currentTarget.checked ? s.delete(a.exe) : s.add(a.exe); semSom.value = s; }} />
                      <span class="truncate">{a.nome}</span>
                    </label>
                  ))}
                </div>
                <p class="text-[11px] text-slate-500 mt-1.5 leading-snug">Desmarcado = fica fora da live. O som da call do Caocorde nunca vai junto (sem eco), e app que começar a tocar depois entra sozinho.</p>
              </div>
            </div>
            <div class="p-4 pt-3 border-t border-slate-800/80 space-y-2 flex-shrink-0">
              <button disabled={!escolhida.value} class="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-bold rounded-xl py-2.5 text-sm" onClick={() => ir()}>
                {!escolhida.value ? 'Escolha uma janela ou tela' : atual ? 'Aplicar sem parar a live' : 'Transmitir'}
              </button>
              <p class="text-[11px] text-slate-400 text-center">{atual ? 'Quem está assistindo continua: só ~1 s parado na troca.' : 'Só gasta dados de quem clicar em "Assistir".'}</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
