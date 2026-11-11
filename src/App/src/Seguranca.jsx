import { useSignal } from '@preact/signals';
import { ShieldCheck, LogOut } from 'lucide-preact';
import { eu, atualizarSeguranca, sair } from './store.js';
import { Mascote } from './App.jsx';
import { campo, Girando, RegrasSenha, senhaOk } from './ui.jsx';

/**
 * Atualização de segurança do Concorde 0.5 — aparece UMA vez para cada conta criada antes dela:
 * senha nova no padrão forte (com confirmação) e e-mail para recuperar a conta.
 */
export function Seguranca() {
  const atual = useSignal('');
  const nova = useSignal('');
  const confirmar = useSignal('');
  const email = useSignal(eu.value?.email || '');
  const erro = useSignal('');
  const enviando = useSignal(false);

  async function salvar(e) {
    e.preventDefault();
    erro.value = '';
    if (!senhaOk(nova.value)) return void (erro.value = 'A senha nova ainda não segue o padrão (veja a lista).');
    if (nova.value !== confirmar.value) return void (erro.value = 'A confirmação não bate com a senha nova.');
    enviando.value = true;
    try {
      await atualizarSeguranca({ atual: atual.value, nova: nova.value, confirmar: confirmar.value, email: email.value });
    } catch (err) {
      erro.value = err.message;
    } finally {
      enviando.value = false;
    }
  }

  const entrada = (sinal, props) => <input {...props} class={campo} value={sinal.value} onInput={e => { sinal.value = e.currentTarget.value; }} />;
  return (
    <div class="h-full overflow-y-auto flex flex-col items-center justify-center p-6">
      <div class="w-full max-w-sm flex flex-col items-center gap-5">
        <Mascote tamanho="w-24 h-24" />
        <div class="text-center space-y-1">
          <h1 class="text-2xl font-black text-white flex items-center justify-center gap-2"><ShieldCheck size={24} class="text-emerald-400" /> Atualização de segurança</h1>
          <p class="text-sm text-slate-300">Oi, <b>{eu.value?.nome}</b>! O Caocorde agora usa senhas mais fortes e um e-mail para recuperar a conta. É só uma vez.</p>
        </div>
        <form onSubmit={salvar} class="w-full bg-slate-900/80 border border-slate-800/80 backdrop-blur-md rounded-2xl p-5 shadow-2xl space-y-3">
          {entrada(atual, { type: 'password', required: true, autoComplete: 'current-password', placeholder: 'Senha atual' })}
          {entrada(email, { type: 'email', required: true, autoComplete: 'email', placeholder: 'E-mail (para recuperar a senha)', maxLength: 254 })}
          {entrada(nova, { type: 'password', required: true, autoComplete: 'new-password', placeholder: 'Senha nova' })}
          {entrada(confirmar, { type: 'password', required: true, autoComplete: 'new-password', placeholder: 'Confirmar a senha nova' })}
          <RegrasSenha senha={nova.value} confirmar={confirmar.value} />
          {erro.value && <p class="text-xs font-semibold text-red-400">{erro.value}</p>}
          <button disabled={enviando.value} class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-60 keep-white">
            {enviando.value ? <Girando /> : <ShieldCheck size={18} />} {enviando.value ? 'Salvando…' : 'Salvar e entrar'}
          </button>
          <p class="text-[11px] text-slate-500 text-center">Os outros aparelhos onde você estava logado vão pedir para entrar de novo.</p>
        </form>
        <button class="text-xs text-slate-400 hover:text-white flex items-center gap-1" onClick={sair}><LogOut size={13} /> Sair desta conta</button>
      </div>
    </div>
  );
}
