// Primeira tela do site para quem não está logado (0.5.11): "onde você quer usar o Caocorde?"
//   - Usar no navegador → segue para a página de apresentação / entrar (e o navegador lembra a escolha);
//   - Usar no Windows   → baixa o instalador (/baixar/windows);
//   - Usar no Android   → baixa o app do celular (/baixar/android).
// Os downloads têm trava de 5 por minuto por endereço no servidor (index.js → baixarInstalador).
// Dentro do app do Windows/celular esta tela não aparece (Inicio.jsx decide).

import { useSignal } from '@preact/signals';
import { Globe, Download } from 'lucide-preact';
import { Mascote } from './App.jsx';

/** Chave do navegador que lembra "já escolhi usar aqui" (para não mostrar esta tela toda vez). */
export const CHAVE_DA_ESCOLHA_NAVEGADOR = 'caocorde-usar-no-navegador';
export function jaEscolheuONavegador() {
  try { return localStorage.getItem(CHAVE_DA_ESCOLHA_NAVEGADOR) === '1'; } catch { return false; }
}

/** Bandeira do Windows (4 quadrados). */
const IconeWindows = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="currentColor">
    <path d="M2 4.2 10.2 3v8.2H2V4.2Zm9.3-1.3L22 1.5v9.7H11.3V2.9ZM2 12.8h8.2V21L2 19.8v-7Zm9.3 0H22v9.7l-10.7-1.4v-8.3Z" />
  </svg>
);
/** Robozinho do Android. */
const IconeAndroid = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="currentColor">
    <path d="M17.6 9.5 19.4 6.3a.4.4 0 0 0-.7-.4l-1.8 3.2A10.9 10.9 0 0 0 12 8a10.9 10.9 0 0 0-4.9 1.1L5.3 5.9a.4.4 0 1 0-.7.4l1.8 3.2A9.6 9.6 0 0 0 1.5 17h21a9.6 9.6 0 0 0-4.9-7.5ZM7 14.2a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm10 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
  </svg>
);

export function EscolherOndeUsar({ aoUsarNoNavegador }) {
  const baixando = useSignal(null);   // 'windows' | 'android' | null
  function usarNoNavegador() {
    try { localStorage.setItem(CHAVE_DA_ESCOLHA_NAVEGADOR, '1'); } catch { /* sem armazenamento: só não lembra */ }
    aoUsarNoNavegador();
  }
  const cartao = 'w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all active:scale-[.98]';
  return (
    <div class="h-full overflow-y-auto flex flex-col items-center p-6">
      <div class="w-full max-w-sm flex flex-col items-center gap-6 my-auto">
        <Mascote />
        <div class="text-center">
          <h1 class="text-2xl font-black text-white">Onde você quer usar o Caocorde?</h1>
          <p class="text-sm text-slate-400 mt-1">Chat de voz, call e transmissão ao vivo para a sua galera. Só para maiores de 18 anos.</p>
        </div>
        <div class="w-full space-y-3">
          <button onClick={usarNoNavegador} class={`${cartao} bg-brand-600 hover:bg-brand-500 border-brand-500 text-white keep-white`}>
            <Globe size={26} />
            <span class="flex-1"><b class="block text-base">Usar no navegador</b><span class="text-xs opacity-90">Entra agora, sem instalar nada.</span></span>
          </button>
          <a href="/baixar/windows" download onClick={() => { baixando.value = 'windows'; }}
            class={`${cartao} bg-slate-900/80 hover:bg-slate-800 border-slate-700/80 text-slate-100`}>
            <span class="text-[#4CC2FF]"><IconeWindows /></span>
            <span class="flex-1"><b class="block text-base text-white">Usar no Windows</b><span class="text-xs text-slate-400">Baixa o instalador (~150 MB). Melhor para transmitir jogo.</span></span>
            <Download size={18} class="text-slate-400" />
          </a>
          <a href="/baixar/android" download onClick={() => { baixando.value = 'android'; }}
            class={`${cartao} bg-slate-900/80 hover:bg-slate-800 border-slate-700/80 text-slate-100`}>
            <span class="text-[#3DDC84]"><IconeAndroid /></span>
            <span class="flex-1"><b class="block text-base text-white">Usar no Android</b><span class="text-xs text-slate-400">Baixa o app do celular (~45 MB).</span></span>
            <Download size={18} class="text-slate-400" />
          </a>
        </div>
        {baixando.value && (
          <div class="w-full text-xs text-slate-300 bg-slate-900/80 border border-slate-800/80 rounded-xl p-3 space-y-1" role="status">
            {baixando.value === 'windows' ? (
              <>
                <b class="block text-white">Baixando o instalador…</b>
                <span>Abra o arquivo quando terminar. Se o Windows mostrar "O Windows protegeu o computador", clique em <b>Mais informações</b> → <b>Executar assim mesmo</b>.</span>
              </>
            ) : (
              <>
                <b class="block text-white">Baixando o app do Android…</b>
                <span>Toque no arquivo baixado. Se aparecer "instalação bloqueada", toque em <b>Configurações</b>, ligue <b>Permitir desta fonte</b> e volte para instalar.</span>
              </>
            )}
            <span class="block text-slate-400">No app, entre com a sua conta ou use "Tenho um código de convite".</span>
          </div>
        )}
      </div>
    </div>
  );
}
