// Telas do ACESSO TEMPORÁRIO (convidado) — só pelo navegador. Regras no servidor: src/Cloudflare/src/convidados.js.
//  - EntrarComoConvidado: quem abriu o link …/?convidado=123456 escolhe só o nome que aparece no servidor.
//  - FimDoAcessoDeConvidado: o acesso acabou (expulso, ou o tempo acabou e ele saiu).
//  - FaixaDoConvidado: lembrete no topo, para o convidado, de até quando vale o acesso.
// O cadastro de "virar conta definitiva" é o Login.jsx no modo conversão.

import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { LogIn, Clock } from 'lucide-preact';
import { eu, appDesktop, appAndroid, informacoesDoConviteDeConvidado, entrarComoConvidado, conviteDeConvidadoDoLink } from './store.js';
import { Mascote } from './App.jsx';
import { campo, botaoPrincipal, Girando } from './ui.jsx';

/** "às 21:30" (hoje) ou "amanhã às 01:00". */
function horarioLegivel(momentoEmMs) {
  const momento = new Date(momentoEmMs);
  const horario = momento.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return momento.toDateString() === new Date().toDateString() ? `às ${horario}` : `amanhã às ${horario}`;
}

/** Tela de entrada do convidado: mostra o servidor e pede só o nome. */
export function EntrarComoConvidado() {
  const informacoes = useSignal(null);   // { servidor, expira } ou { erro }
  const nome = useSignal('');
  const enviando = useSignal(false);
  const erro = useSignal('');
  const estaNoApp = !!(appDesktop || appAndroid);

  useEffect(() => {
    if (estaNoApp) return;
    informacoesDoConviteDeConvidado(conviteDeConvidadoDoLink)
      .then(resposta => { informacoes.value = resposta; })
      .catch(falha => { informacoes.value = { erro: falha.message }; });
  }, []);

  async function entrar(evento) {
    evento.preventDefault();
    erro.value = '';
    enviando.value = true;
    try { await entrarComoConvidado(conviteDeConvidadoDoLink, nome.value); }
    catch (falha) { erro.value = falha.message; }
    finally { enviando.value = false; }
  }

  const cartao = 'w-full bg-slate-900/80 border border-slate-800/80 rounded-2xl p-5 shadow-2xl space-y-3';
  return (
    <div class="h-full overflow-y-auto flex flex-col items-center justify-center p-6">
      <div class="w-full max-w-sm flex flex-col items-center gap-6">
        <Mascote />
        {estaNoApp ? (
          <div class={cartao}>
            <h1 class="text-lg font-extrabold text-white">Convite de convidado</h1>
            <p class="text-sm text-slate-300">Esse convite só funciona <b>no navegador</b> (Chrome, Edge, Firefox…). Abra o mesmo link lá.</p>
          </div>
        ) : !informacoes.value ? (
          <Girando tamanho={28} class="text-slate-400" />
        ) : informacoes.value.erro ? (
          <div class={cartao}>
            <h1 class="text-lg font-extrabold text-white">Esse convite não vale mais</h1>
            <p class="text-sm text-slate-300">{informacoes.value.erro}</p>
            <p class="text-xs text-slate-400">Peça um convite novo para quem te chamou.</p>
          </div>
        ) : (
          <form onSubmit={entrar} class={cartao}>
            <div>
              <p class="text-xs font-bold uppercase tracking-wider text-brand-300">Você foi convidado</p>
              <h1 class="text-xl font-black text-white mt-0.5">{informacoes.value.servidor}</h1>
              <p class="text-xs text-slate-400 mt-1 flex items-center gap-1"><Clock size={12} /> Acesso de convidado até {horarioLegivel(informacoes.value.expira)}. Não precisa criar conta.</p>
            </div>
            <label class="block text-xs font-bold text-slate-300" for="nome-do-convidado">Como a galera vai te ver</label>
            <input id="nome-do-convidado" required autoFocus minLength={2} maxLength={32} placeholder="Seu nome" class={campo}
              value={nome.value} onInput={evento => { nome.value = evento.currentTarget.value; }} />
            <p class="text-xs text-slate-400">Você pode entrar nas calls, assistir às lives e conversar no seu chat de convidado. Quando você sair (ou o tempo acabar), seu acesso e o chat são apagados.</p>
            {erro.value && <p class="text-xs font-semibold text-red-400">{erro.value}</p>}
            <button disabled={enviando.value || nome.value.trim().length < 2} class={`${botaoPrincipal} w-full flex items-center justify-center gap-2`}>
              {enviando.value ? <Girando /> : <LogIn size={18} />} Entrar como convidado
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** O acesso de convidado terminou: explica e não deixa nada pela metade. */
export function FimDoAcessoDeConvidado() {
  return (
    <div class="h-full flex items-center justify-center p-6">
      <div class="max-w-sm text-center space-y-4">
        <Mascote tamanho="w-24 h-24" pular={false} />
        <h1 class="text-xl font-black text-white">Seu acesso de convidado terminou</h1>
        <p class="text-sm text-slate-300">O tempo acabou ou um admin encerrou o acesso. O seu chat de convidado foi apagado.</p>
        <p class="text-xs text-slate-400">Quer voltar? Peça um convite novo para quem te chamou.</p>
      </div>
    </div>
  );
}

/** Faixa no topo, só para o convidado: até quando vale o acesso. */
export function FaixaDoConvidado() {
  const convidadoAte = eu.value?.convidadoAte;
  if (!convidadoAte) return null;
  const venceu = convidadoAte <= Date.now();
  return (
    <div class="bg-brand-600 text-white text-xs font-bold px-4 py-1.5 flex items-center justify-center gap-2 keep-white">
      <Clock size={14} />
      {venceu
        ? 'Seu tempo de convidado acabou: você continua até sair. Depois, o acesso e o seu chat são apagados.'
        : `Você é convidado até ${horarioLegivel(convidadoAte)}. Quando sair, o acesso e o seu chat de convidado são apagados.`}
    </div>
  );
}
