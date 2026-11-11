import { useSignal } from '@preact/signals';
import { LogIn, UserPlus, Lock } from 'lucide-preact';
import { entrar, registrar } from './store.js';
import { Mascote } from './App.jsx';
import { campo, Girando, RegrasSenha, senhaOk } from './ui.jsx';
import { EsqueciSenha } from './Recuperar.jsx';
import { ConfirmacaoDeIdade } from './Inicio.jsx';

/** Botão grande do formulário (entrar / criar conta). */
const botaoGrande = 'w-full bg-brand-600 hover:bg-brand-500 active:scale-95 text-white font-black text-base py-3.5 rounded-2xl shadow-xl shadow-brand-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-60 keep-white';

/** Login de quem já tem conta (com "Esqueci minha senha"). Usado em Inicio.jsx. */
export function FormularioDeEntrar() {
  const esqueci = useSignal(false);
  const erro = useSignal('');
  const enviando = useSignal(false);
  if (esqueci.value) return <EsqueciSenha onVoltar={() => { esqueci.value = false; }} />;

  async function enviar(evento) {
    evento.preventDefault();
    const campos = Object.fromEntries(new FormData(evento.target));
    erro.value = '';
    enviando.value = true;
    try { await entrar(campos.usuario, campos.senha, campos.lembrar === 'on'); }
    catch (falha) { erro.value = falha.message; } finally { enviando.value = false; }
  }
  return (
    <form onSubmit={enviar} class="space-y-3">
      <input name="usuario" required autoComplete="username" placeholder="Usuário" class={campo} maxLength={20}
        onInput={evento => { evento.target.value = evento.target.value.toLowerCase(); }} />
      <input name="senha" required type="password" autoComplete="current-password" placeholder="Senha" class={campo} />
      <label class="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer select-none">
        <input type="checkbox" name="lembrar" defaultChecked class="w-4 h-4 accent-brand-500" /> Manter conectado
      </label>
      {erro.value && <p class="text-xs font-semibold text-red-400" role="alert">{erro.value}</p>}
      <button disabled={enviando.value} class={botaoGrande}>
        {enviando.value ? <Girando /> : <LogIn size={20} />} {enviando.value ? 'Um segundo…' : 'Entrar'}
      </button>
      <button type="button" class="w-full text-xs font-bold text-slate-400 hover:text-white" onClick={() => { esqueci.value = true; erro.value = ''; }}>Esqueci minha senha</button>
    </form>
  );
}

/**
 * Criar conta. convite = { codigo, servidor } que o servidor JÁ CONFERIU na tela anterior: o código aparece
 * travado (não dá para editar nem precisa digitar de novo). O servidor confere o código outra vez no cadastro —
 * quem abrir esta tela "na mão" sem código válido não cria conta.
 * conversao = convidado virando conta definitiva (sem código de convite).
 */
export function FormularioDeCadastro({ convite = null, conversao = null }) {
  const erro = useSignal('');
  const enviando = useSignal(false);
  const senha = useSignal('');
  const confirmar = useSignal('');

  async function enviar(evento) {
    evento.preventDefault();
    const campos = Object.fromEntries(new FormData(evento.target));
    erro.value = '';
    if (!senhaOk(senha.value)) return void (erro.value = 'A senha ainda não segue o padrão (veja a lista).');
    if (senha.value !== confirmar.value) return void (erro.value = 'A confirmação não bate com a senha.');
    enviando.value = true;
    try {
      await registrar({
        usuario: campos.usuario, nome: campos.nome, email: campos.email, senha: senha.value, confirmar: confirmar.value,
        lembrar: campos.lembrar === 'on', maiorDeIdade: campos.maiorDeIdade === 'on',
        ...(conversao ? { conversao } : { convite: convite?.codigo }),
      });
    } catch (falha) { erro.value = falha.message; } finally { enviando.value = false; }
  }
  return (
    <form onSubmit={enviar} class="space-y-3">
      {convite && (
        <div>
          <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Código de convite</span>
          <div class="mt-1 flex items-center gap-2 bg-slate-950/60 border border-emerald-500/40 rounded-xl px-3.5 py-2.5" aria-label="Código de convite já conferido">
            <Lock size={15} class="text-emerald-400" />
            <span class="flex-1 font-black tracking-[0.25em] text-white">{convite.codigo}</span>
            <span class="text-[11px] font-bold text-emerald-400">✓ conferido</span>
          </div>
          {convite.servidor && <p class="mt-1 text-xs text-slate-400">Você vai entrar direto no servidor <b class="text-slate-200">{convite.servidor}</b>.</p>}
        </div>
      )}
      <input name="usuario" required autoComplete="username" placeholder="Usuário (para entrar)" class={campo} maxLength={20}
        onInput={evento => { evento.target.value = evento.target.value.toLowerCase(); }} />
      <input name="nome" required placeholder="Nome que a galera vê" class={campo} maxLength={32} />
      <input name="email" required type="email" autoComplete="email" placeholder="E-mail (para recuperar a senha)" class={campo} maxLength={254} />
      <input required type="password" autoComplete="new-password" placeholder="Senha" class={campo}
        value={senha.value} onInput={evento => { senha.value = evento.currentTarget.value; }} />
      <input required type="password" autoComplete="new-password" placeholder="Confirmar a senha" class={campo}
        value={confirmar.value} onInput={evento => { confirmar.value = evento.currentTarget.value; }} />
      <RegrasSenha senha={senha.value} confirmar={confirmar.value} />
      <ConfirmacaoDeIdade />
      <label class="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer select-none">
        <input type="checkbox" name="lembrar" defaultChecked class="w-4 h-4 accent-brand-500" /> Manter conectado
      </label>
      {erro.value && <p class="text-xs font-semibold text-red-400" role="alert">{erro.value}</p>}
      <button disabled={enviando.value} class={botaoGrande}>
        {enviando.value ? <Girando /> : <UserPlus size={20} />} {enviando.value ? 'Um segundo…' : 'Criar conta'}
      </button>
    </form>
  );
}

/** Convidado virando conta definitiva (o admin pediu): só o cadastro, sem código de convite. */
export function Login({ conversaoDeConvidado }) {
  return (
    <div class="h-full overflow-y-auto flex flex-col items-center p-6">
      <div class="w-full max-w-sm flex flex-col items-center gap-6 my-auto">
        <Mascote />
        <div class="w-full bg-slate-900/80 border border-slate-800/80 backdrop-blur-md rounded-2xl p-5 shadow-2xl space-y-3">
          <div>
            <h2 class="text-lg font-extrabold text-white">Agora é pra valer 🎉</h2>
            <p class="text-xs text-slate-400 mt-0.5">Um admin transformou seu acesso de convidado em conta. Escolha seu usuário e senha: você continua no servidor.</p>
          </div>
          <FormularioDeCadastro conversao={conversaoDeConvidado} />
        </div>
      </div>
    </div>
  );
}
