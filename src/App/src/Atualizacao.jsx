// Atualização do app do Windows, vista pela página (como no Discord).
//
// O app baixa a versão nova sozinho, em segundo plano. Quando ela fica pronta:
//  1. aparece um BOTÃO VERDE com o símbolo de download na barra de cima, à direita (fica lá até atualizar);
//  2. aparece um BALÃO estilo história em quadrinhos apontando para o botão, que some sozinho em 10 segundos.
//     Ele aparece de novo quando a pessoa volta para o Concorde (no máximo uma vez a cada 10 minutos).
// Clicar no botão (ou em "Atualizar agora" no balão) fecha, instala e abre o app — e, se a pessoa estava numa
// call, ela volta sozinha para a call (voz.js → "voltar para a call").
// Se a pessoa não clicar, a versão nova entra na próxima vez que o Concorde abrir — ou sozinha, se o app ficar
// 5 minutos fora de foco sem ninguém numa call (ver abaixo).
//
// Antes (até a 0.5.7) o app instalava sozinho 5 s depois de baixar: o botão quase nunca chegava a aparecer.

import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { signal, useSignal } from '@preact/signals';
import { Download, X } from 'lucide-preact';
import { appDesktop, aviso } from './store.js';
import { NoTopo } from './ui.jsx';
import { minhaCall, lembrarDaCallAntesDeAtualizar } from './voz.js';

/** Versão nova já baixada e pronta para instalar (ex.: "0.5.8"), ou null. Só existe no app do Windows. */
export const versaoNovaPronta = signal(null);
appDesktop?.nativo?.atualizacao?.().then(versao => { versaoNovaPronta.value = versao || null; }).catch(() => {});
appDesktop?.nativo?.aoEvento?.((evento, dados) => { if (evento === 'atualizacao') { versaoNovaPronta.value = dados.versao; mostrarOBalao(); } });

const balaoVisivel = signal(false);
const TEMPO_DO_BALAO_NA_TELA_EM_MS = 10_000;
const INTERVALO_MINIMO_ENTRE_BALOES_EM_MS = 10 * 60 * 1000;
let ultimaVezQueOBalaoApareceuEmMs = 0;
let temporizadorDoBalao = null;

/** Mostra o balão por 10 s (se tem versão nova e ele não apareceu há pouco). */
function mostrarOBalao({ mesmoQueTenhaAparecidoHaPouco = false } = {}) {
  if (!versaoNovaPronta.value) return;
  const agoraEmMs = Date.now();
  if (!mesmoQueTenhaAparecidoHaPouco && agoraEmMs - ultimaVezQueOBalaoApareceuEmMs < INTERVALO_MINIMO_ENTRE_BALOES_EM_MS) return;
  ultimaVezQueOBalaoApareceuEmMs = agoraEmMs;
  balaoVisivel.value = true;
  clearTimeout(temporizadorDoBalao);
  temporizadorDoBalao = setTimeout(() => { balaoVisivel.value = false; }, TEMPO_DO_BALAO_NA_TELA_EM_MS);
}

// Voltou para o Concorde (clicou na janela, trocou de volta de outro app): lembra da versão nova.
if (appDesktop) addEventListener('focus', () => mostrarOBalao());
// A janela mudou de tamanho: o balão (posição fixa) deixaria de apontar para o botão — então some.
addEventListener('resize', () => { balaoVisivel.value = false; });

/**
 * Para ninguém ficar dias na versão velha com o app aberto: se a pessoa NÃO está numa call e o Concorde ficou
 * 5 minutos seguidos fora de foco (minimizado ou atrás de outra janela), atualiza sozinho — sem atrapalhar ninguém.
 * (Até a 0.5.7 instalava 5 s depois de baixar, mesmo com a pessoa usando o app.)
 */
const TEMPO_FORA_DE_FOCO_PARA_ATUALIZAR_SOZINHO_EM_MS = 5 * 60 * 1000;
let foraDeFocoDesdeEmMs = null;
if (appDesktop) {
  setInterval(() => {
    const emFoco = document.hasFocus() && !document.hidden;
    if (emFoco) { foraDeFocoDesdeEmMs = null; return; }
    foraDeFocoDesdeEmMs ??= Date.now();
    const tempoForaDeFocoEmMs = Date.now() - foraDeFocoDesdeEmMs;
    if (versaoNovaPronta.value && !minhaCall.value && tempoForaDeFocoEmMs >= TEMPO_FORA_DE_FOCO_PARA_ATUALIZAR_SOZINHO_EM_MS) atualizarAgora();
  }, 30_000);
}

/** Fecha, instala e reabre o app. Se estava numa call, volta para ela depois. */
export function atualizarAgora() {
  if (!versaoNovaPronta.value) return;
  lembrarDaCallAntesDeAtualizar();
  aviso.value = minhaCall.value
    ? 'Atualizando… o Caocorde reabre e volta para a call sozinho.'
    : 'Atualizando… o Caocorde reabre em alguns segundos.';
  balaoVisivel.value = false;
  setTimeout(() => appDesktop.nativo.atualizar(), 1200);
}

/** Botão verde na barra de cima + o balão em quadrinhos. Não aparece sem versão nova (nem fora do app). */
export function BotaoDeAtualizacao() {
  const referenciaDoBotao = useRef(null);
  // Posição do botão na tela, medida DEPOIS de ele aparecer (o balão é desenhado apontando para ela).
  const retanguloDoBotao = useSignal(null);
  // O balão aparece assim que o botão surge na tela (versão já estava pronta quando o app abriu).
  useEffect(() => { if (versaoNovaPronta.value) mostrarOBalao({ mesmoQueTenhaAparecidoHaPouco: true }); }, [versaoNovaPronta.value]);
  useLayoutEffect(() => {
    if (balaoVisivel.value && referenciaDoBotao.current) retanguloDoBotao.value = referenciaDoBotao.current.getBoundingClientRect();
  }, [balaoVisivel.value, versaoNovaPronta.value]);
  if (!versaoNovaPronta.value) return null;
  return (
    <>
      <button ref={referenciaDoBotao} onClick={atualizarAgora} aria-label={`Atualizar o Caocorde para a versão ${versaoNovaPronta.value}`}
        title={`Versão ${versaoNovaPronta.value} pronta — clique para atualizar`}
        class="p-2 rounded-lg text-emerald-400 hover:text-white hover:bg-emerald-600 transition-colors">
        <Download size={18} strokeWidth={2.5} />
      </button>
      {balaoVisivel.value && retanguloDoBotao.value && <BalaoEmQuadrinhos retanguloDoBotao={retanguloDoBotao.value} />}
    </>
  );
}

/**
 * Balão de fala de história em quadrinhos (borda grossa escura, sombra "chapada" deslocada e a pontinha
 * apontando para o botão). Desenhado no topo da página (NoTopo): dentro da barra de cima ele ficava escondido
 * atrás da lista de membros. role="status": leitor de tela anuncia sem roubar o foco.
 */
function BalaoEmQuadrinhos({ retanguloDoBotao }) {
  const LARGURA_DO_BALAO = 288;
  const direita = Math.max(8, innerWidth - retanguloDoBotao.right - 8);
  const pontinhaDaDireita = Math.max(12, innerWidth - direita - (retanguloDoBotao.left + retanguloDoBotao.width / 2) - 10);
  return (
    <NoTopo>
    <div role="status" class="fixed z-50 animate-fade-in origin-top-right"
      style={{ top: retanguloDoBotao.bottom + 12, right: direita, width: Math.min(LARGURA_DO_BALAO, innerWidth - 16), transform: 'rotate(-1.5deg)' }}>
      {/* Pontinha do balão, apontando para cima (para o botão). */}
      <div class="absolute -top-[11px] w-5 h-5 rotate-45 bg-white border-l-[3px] border-t-[3px] border-[#111114]" style={{ right: pontinhaDaDireita }} />
      <div class="relative rounded-2xl bg-white border-[3px] border-[#111114] px-4 py-3 text-[#111114]" style={{ boxShadow: '5px 5px 0 #111114' }}>
        <button aria-label="Fechar o aviso" class="absolute top-1.5 right-1.5 p-1 rounded-full hover:bg-black/10" onClick={() => { balaoVisivel.value = false; }}>
          <X size={14} strokeWidth={3} />
        </button>
        <div class="text-lg font-black uppercase tracking-tight leading-none">Psiu! 📦</div>
        <p class="mt-1.5 text-sm font-semibold leading-snug">
          A versão <b>{versaoNovaPronta.value}</b> do Caocorde já está baixada.
          {minhaCall.value ? ' Pode atualizar: você volta para a call sozinho.' : ' Leva uns segundinhos.'}
        </p>
        <button onClick={atualizarAgora}
          class="mt-2.5 w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black uppercase py-2 border-[3px] border-[#111114]">
          Atualizar agora
        </button>
      </div>
    </div>
    </NoTopo>
  );
}
