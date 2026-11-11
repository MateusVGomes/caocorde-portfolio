import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { eu, carregarSessao, appDesktop, acessoDeConvidadoTerminou, codigoDeConversaoDeConvidado, conviteDeConvidadoDoLink } from './store.js';
import { EntrarComoConvidado, FimDoAcessoDeConvidado } from './Convidado.jsx';

/** App desktop mais velho que isso não entra: as versões antigas não se atualizam sozinhas ao abrir. */
const VERSAO_MINIMA = '0.4.0';
const menor = (a, b) => {
  const [x, y] = [a, b].map(v => String(v).split('.').map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};
const appVelho = appDesktop && menor(appDesktop.versao, VERSAO_MINIMA);
import { Login } from './Login.jsx';
import { Inicio } from './Inicio.jsx';
import { Shell } from './Shell.jsx';
import { Toast } from './ui.jsx';
import { Seguranca } from './Seguranca.jsx';
import { RedefinirSenha } from './Recuperar.jsx';

/** Link do e-mail de recuperação: …/concorde?redefinir=TOKEN */
const tokenRedefinir = (() => { try { return new URLSearchParams(location.search).get('redefinir'); } catch { return null; } })();

export function App() {
  const carregando = useSignal(true);
  useEffect(() => { carregarSessao().finally(() => { carregando.value = false; }); }, []);

  if (appVelho) return <AtualizacaoObrigatoria />;
  if (tokenRedefinir) return <><RedefinirSenha token={tokenRedefinir} /><Toast /></>;
  if (carregando.value) {
    return <div class="h-full flex items-center justify-center"><Mascote tamanho="w-24 h-24" /></div>;
  }
  // Convidado (acesso temporário): fim do acesso, virar conta definitiva, ou a tela de entrada pelo link.
  if (acessoDeConvidadoTerminou.value) return <FimDoAcessoDeConvidado />;
  if (codigoDeConversaoDeConvidado) return <><Login conversaoDeConvidado={codigoDeConversaoDeConvidado} /><Toast /></>;
  if (!eu.value && conviteDeConvidadoDoLink) return <><EntrarComoConvidado /><Toast /></>;
  return <>{!eu.value ? <Inicio /> : eu.value.precisaSeguranca ? <Seguranca /> : <Shell />}<Toast /></>;
}

export function Mascote({ tamanho = 'w-32 h-32', pular = true }) {
  return (
    <div class={`relative flex flex-col items-center ${pular ? 'animate-bounce-subtle' : ''}`}>
      <img src="/img/logo-concorde.svg" alt="Caocorde" class={`${tamanho} drop-shadow-xl`} />
      <div class="-mt-1 bg-brand-500 text-white font-black text-xs px-4 py-1 rounded-lg shadow-md uppercase tracking-wider z-10 keep-white">Caocorde</div>
    </div>
  );
}

/** App 0.3.x: não tem atualização forçada. Explica como atualizar (fechar, abrir e clicar em "Sim"). */
function AtualizacaoObrigatoria() {
  return (
    <div class="h-full flex items-center justify-center p-6">
      <div class="max-w-md text-center space-y-5">
        <Mascote tamanho="w-24 h-24" />
        <h1 class="text-2xl font-black text-white">Atualização obrigatória</h1>
        <p class="text-sm text-slate-300">Seu Caocorde está na versão <b>{appDesktop.versao}</b>, e essa não funciona mais com o servidor.</p>
        <ol class="text-left text-sm text-slate-200 space-y-2 bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4">
          <li><b>1.</b> Feche o Caocorde (no X da janela).</li>
          <li><b>2.</b> Abra de novo.</li>
          <li><b>3.</b> Deixe aberto: em alguns minutos (ele baixa a versão nova antes) aparece <i>"Saiu a versão… Atualizar agora?"</i> — clique em <b>Sim</b>.</li>
        </ol>
        <p class="text-xs text-slate-400">O app fecha e abre sozinho já atualizado. Daí em diante as atualizações são automáticas.</p>
      </div>
    </div>
  );
}
