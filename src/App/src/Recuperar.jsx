import { raiz } from './store.js';
import { useSignal } from '@preact/signals';
import { KeyRound, Mail } from 'lucide-preact';
import { Mascote } from './App.jsx';
import { campo, Girando, RegrasSenha, senhaOk } from './ui.jsx';

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `erro ${r.status}`);
  return j;
}

/** "Esqueci minha senha": usuário ou e-mail → manda o link para o e-mail da conta. */
export function EsqueciSenha({ onVoltar }) {
  const login = useSignal('');
  const estado = useSignal(null);   // null | 'enviando' | 'ok' | mensagem de erro
  async function enviar(e) {
    e.preventDefault();
    estado.value = 'enviando';
    try { await post('/api/auth/esqueci', { login: login.value }); estado.value = 'ok'; }
    catch (err) { estado.value = err.message; }
  }
  if (estado.value === 'ok') {
    return (
      <div class="space-y-3 text-center">
        <Mail size={28} class="mx-auto text-emerald-400" />
        <p class="text-sm text-slate-200">Se existir uma conta com esse usuário ou e-mail, mandamos um link para criar a senha nova. Olhe a caixa de entrada (e o spam).</p>
        <button type="button" class="text-xs font-bold text-slate-400 hover:text-white" onClick={onVoltar}>Voltar para entrar</button>
      </div>
    );
  }
  return (
    <form onSubmit={enviar} class="space-y-3">
      <p class="text-sm text-slate-300">Digite seu usuário ou e-mail. Mandamos um link para criar uma senha nova (vale 1 hora).</p>
      <input required class={campo} placeholder="Usuário ou e-mail" value={login.value} onInput={e => { login.value = e.currentTarget.value; }} />
      {estado.value && estado.value !== 'enviando' && <p class="text-xs font-semibold text-red-400">{estado.value}</p>}
      <button disabled={estado.value === 'enviando'} class="w-full bg-brand-600 hover:bg-brand-500 text-white font-bold py-3 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-60 keep-white">
        {estado.value === 'enviando' ? <Girando /> : <Mail size={18} />} Mandar link
      </button>
      <button type="button" class="w-full text-xs font-bold text-slate-400 hover:text-white" onClick={onVoltar}>Voltar para entrar</button>
    </form>
  );
}

/** Página do link do e-mail (…/concorde?redefinir=TOKEN): senha nova no padrão forte. */
export function RedefinirSenha({ token }) {
  const nova = useSignal('');
  const confirmar = useSignal('');
  const estado = useSignal(null);
  async function salvar(e) {
    e.preventDefault();
    if (!senhaOk(nova.value)) return void (estado.value = 'A senha ainda não segue o padrão (veja a lista).');
    if (nova.value !== confirmar.value) return void (estado.value = 'A confirmação não bate com a senha.');
    estado.value = 'enviando';
    try { await post('/api/auth/redefinir', { token, nova: nova.value, confirmar: confirmar.value }); estado.value = 'ok'; }
    catch (err) { estado.value = err.message; }
  }
  const entrada = (sinal, placeholder) => <input required type="password" autoComplete="new-password" class={campo} placeholder={placeholder} value={sinal.value} onInput={e => { sinal.value = e.currentTarget.value; }} />;
  return (
    <div class="h-full overflow-y-auto flex flex-col items-center justify-center p-6">
      <div class="w-full max-w-sm flex flex-col items-center gap-5">
        <Mascote tamanho="w-24 h-24" />
        <h1 class="text-2xl font-black text-white flex items-center gap-2"><KeyRound size={22} class="text-brand-500" /> Senha nova</h1>
        <div class="w-full bg-slate-900/80 border border-slate-800/80 backdrop-blur-md rounded-2xl p-5 shadow-2xl">
          {estado.value === 'ok' ? (
            <div class="space-y-3 text-center">
              <p class="text-sm text-emerald-400 font-bold">Senha trocada! ✓</p>
              <a href={raiz} class="block w-full bg-brand-600 hover:bg-brand-500 text-white font-bold py-3 rounded-2xl keep-white">Entrar no Caocorde</a>
            </div>
          ) : (
            <form onSubmit={salvar} class="space-y-3">
              {entrada(nova, 'Senha nova')}
              {entrada(confirmar, 'Confirmar a senha nova')}
              <RegrasSenha senha={nova.value} confirmar={confirmar.value} />
              {estado.value && estado.value !== 'enviando' && <p class="text-xs font-semibold text-red-400">{estado.value}</p>}
              <button disabled={estado.value === 'enviando'} class="w-full bg-brand-600 hover:bg-brand-500 text-white font-bold py-3 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-60 keep-white">
                {estado.value === 'enviando' ? <Girando /> : <KeyRound size={18} />} Salvar senha nova
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
