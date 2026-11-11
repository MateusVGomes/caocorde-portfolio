import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { Mic, MonitorUp, Users, Music, Send, KeyRound, LogIn, ShieldCheck, ArrowLeft, MailCheck } from 'lucide-preact';
import { validarConviteDoApp, pedirAcesso, conviteDoAppDoLink, conviteDoLink, dentroDoApp } from './store.js';
import { Mascote } from './App.jsx';
import { campo, Girando, botaoPrincipal, botaoCinza } from './ui.jsx';
import { FormularioDeEntrar, FormularioDeCadastro } from './Login.jsx';
import { EscolherOndeUsar, jaEscolheuONavegador } from './EscolherOndeUsar.jsx';

/**
 * Tudo que aparece para quem NÃO está logado (0.5.10):
 *   escolher → primeira visita: usar no navegador, baixar para o Windows ou para o Android;
 *   inicio   → página de apresentação (o que é o Caocorde, +18) com "Pedir acesso" e "Tenho um código de convite";
 *   pedir    → 3 perguntas (quem indicou, como te conhecem, e-mail) → o admin aprova no painel;
 *   codigo   → digita o código do convite; o servidor confere ANTES do cadastro;
 *   cadastro → criar conta com o código já validado e travado (não precisa digitar de novo);
 *   entrar   → login de quem já tem conta.
 * Dentro do app do Windows/celular a apresentação é pulada (abre direto no "entrar").
 * Link do e-mail de aprovação (…/?acesso=CODIGO): confere o código sozinho e abre o cadastro.
 */
export function Inicio() {
  // Primeira visita no navegador: "onde você quer usar?" (navegador, Windows ou Android) — EscolherOndeUsar.jsx.
  const tela = useSignal(conviteDoAppDoLink ? 'conferindo' : (dentroDoApp || conviteDoLink) ? 'entrar' : jaEscolheuONavegador() ? 'inicio' : 'escolher');
  const conviteValidado = useSignal(null);   // { codigo, servidor }
  const erroDoLink = useSignal('');

  useEffect(() => {
    if (!conviteDoAppDoLink) return;
    validarConviteDoApp(conviteDoAppDoLink)
      .then(resposta => { conviteValidado.value = resposta; tela.value = 'cadastro'; })
      .finally(() => { try { history.replaceState(null, '', location.pathname); } catch { /* sem histórico: tudo bem */ } })
      .catch(erro => { erroDoLink.value = erro.message; tela.value = 'codigo'; });
  }, []);

  const ir = destino => { tela.value = destino; window.scrollTo?.(0, 0); };

  if (tela.value === 'conferindo') return <div class="h-full flex items-center justify-center"><Girando tamanho={28} class="text-brand-400" /></div>;
  if (tela.value === 'escolher') return <EscolherOndeUsar aoUsarNoNavegador={() => ir('inicio')} />;
  if (tela.value === 'inicio') return <Apresentacao ir={ir} />;
  return (
    <div class="h-full overflow-y-auto flex flex-col items-center p-6">
      <div class="w-full max-w-sm flex flex-col items-center gap-6 my-auto">
        <Mascote />
        {tela.value === 'entrar' && (
          <Cartao titulo="Entrar" voltar={dentroDoApp ? null : () => ir('inicio')}>
            {conviteDoLink && (
              <p class="text-xs text-acento-300 bg-acento-600/15 border border-acento-600/40 rounded-xl p-3">
                Esse link é de um <b>servidor</b>. Entre na sua conta para participar. Ainda não tem conta? Esse convite não cria conta: <b>peça acesso</b> abaixo.
              </p>
            )}
            <FormularioDeEntrar />
          </Cartao>
        )}
        {tela.value === 'pedir' && <PedirAcesso voltar={() => ir(dentroDoApp ? 'entrar' : 'inicio')} />}
        {tela.value === 'codigo' && (
          <TenhoCodigo erroInicial={erroDoLink.value} voltar={() => ir(dentroDoApp ? 'entrar' : 'inicio')}
            aoValidar={resposta => { conviteValidado.value = resposta; ir('cadastro'); }} />
        )}
        {tela.value === 'cadastro' && conviteValidado.value && (
          <Cartao titulo="Criar sua conta" voltar={() => ir('codigo')}>
            <FormularioDeCadastro convite={conviteValidado.value} />
          </Cartao>
        )}
        {(tela.value === 'entrar') && (
          <div class="w-full grid grid-cols-2 gap-2">
            <button class={`${botaoCinza} flex items-center justify-center gap-2 !text-xs`} onClick={() => ir('codigo')}><KeyRound size={15} /> Tenho um código</button>
            <button class={`${botaoCinza} flex items-center justify-center gap-2 !text-xs`} onClick={() => ir('pedir')}><Send size={15} /> Pedir acesso</button>
          </div>
        )}
        {tela.value !== 'entrar' && (
          <button class="text-xs font-bold text-slate-400 hover:text-white" onClick={() => ir('entrar')}>Já tenho conta → Entrar</button>
        )}
      </div>
    </div>
  );
}

/** Moldura dos formulários: título, botão de voltar e o conteúdo. */
function Cartao({ titulo, voltar, children }) {
  return (
    <div class="w-full bg-slate-900/80 border border-slate-800/80 backdrop-blur-md rounded-2xl p-5 shadow-2xl space-y-3">
      <div class="flex items-center gap-2">
        {voltar && <button type="button" aria-label="Voltar" class="p-1 -ml-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" onClick={voltar}><ArrowLeft size={18} /></button>}
        <h2 class="text-lg font-extrabold text-white">{titulo}</h2>
      </div>
      {children}
    </div>
  );
}

/** As 3 perguntas do pedido de acesso (+ a confirmação de 18 anos). */
function PedirAcesso({ voltar }) {
  const enviando = useSignal(false);
  const erro = useSignal('');
  const enviado = useSignal(false);

  async function enviar(evento) {
    evento.preventDefault();
    const campos = Object.fromEntries(new FormData(evento.target));
    erro.value = '';
    enviando.value = true;
    try {
      await pedirAcesso({ indicadoPor: campos.indicadoPor, comoConhece: campos.comoConhece, email: campos.email, maiorDeIdade: campos.maiorDeIdade === 'on' });
      enviado.value = true;
    } catch (falha) { erro.value = falha.message; } finally { enviando.value = false; }
  }

  if (enviado.value) {
    return (
      <Cartao titulo="Pedido enviado!" voltar={voltar}>
        <div class="flex gap-3 items-start">
          <MailCheck size={28} class="text-emerald-400 flex-shrink-0" />
          <p class="text-sm text-slate-300">Quando o admin aprovar, você recebe um <b>e-mail</b> com o link para criar a conta e os links do app do Windows e do celular. Fique de olho no spam também.</p>
        </div>
      </Cartao>
    );
  }
  return (
    <Cartao titulo="Pedir acesso" voltar={voltar}>
      <p class="text-xs text-slate-400">O Caocorde é fechado: entra quem alguém da galera conhece. Responda 3 perguntas e o admin analisa.</p>
      <form onSubmit={enviar} class="space-y-3">
        <label class="block">
          <span class="text-xs font-bold text-slate-300">Quem te indicou? <span class="font-normal text-slate-500">(nome ou nick — deixe vazio se ninguém)</span></span>
          <input name="indicadoPor" maxLength={60} class={`${campo} mt-1`} placeholder="Ex.: Jorginho" />
        </label>
        <label class="block">
          <span class="text-xs font-bold text-slate-300">Como essa pessoa te conhece, ou como você quer ser reconhecido?</span>
          <textarea name="comoConhece" required minLength={3} maxLength={300} rows={3} class={`${campo} mt-1`} placeholder="Ex.: sou o primo do Beto, jogo ARK com a galera" />
        </label>
        <label class="block">
          <span class="text-xs font-bold text-slate-300">Seu e-mail <span class="font-normal text-slate-500">(é para onde vai o convite)</span></span>
          <input name="email" type="email" required maxLength={254} autoComplete="email" class={`${campo} mt-1`} placeholder="voce@exemplo.com" />
        </label>
        <ConfirmacaoDeIdade />
        {erro.value && <p class="text-xs font-semibold text-red-400" role="alert">{erro.value}</p>}
        <button disabled={enviando.value} class={`${botaoPrincipal} w-full flex items-center justify-center gap-2 !py-3`}>
          {enviando.value ? <Girando tamanho={18} /> : <Send size={17} />} {enviando.value ? 'Enviando…' : 'Mandar pedido'}
        </button>
      </form>
    </Cartao>
  );
}

/** Caixa "tenho 18 anos ou mais" — obrigatória no pedido e no cadastro. */
export function ConfirmacaoDeIdade() {
  return (
    <label class="flex items-start gap-2 text-xs font-semibold text-slate-300 cursor-pointer select-none">
      <input type="checkbox" name="maiorDeIdade" required class="w-4 h-4 mt-0.5 accent-brand-500 flex-shrink-0" />
      <span>Confirmo que tenho <b class="text-white">18 anos ou mais</b>.</span>
    </label>
  );
}

/** Digita o código do convite; só passa para o cadastro se o servidor confirmar que vale. */
function TenhoCodigo({ voltar, aoValidar, erroInicial = '' }) {
  const enviando = useSignal(false);
  const erro = useSignal(erroInicial);
  async function conferir(evento) {
    evento.preventDefault();
    const codigo = new FormData(evento.target).get('codigo');
    erro.value = '';
    enviando.value = true;
    try { aoValidar(await validarConviteDoApp(codigo)); }
    catch (falha) { erro.value = falha.message; } finally { enviando.value = false; }
  }
  return (
    <Cartao titulo="Tenho um código de convite" voltar={voltar}>
      <p class="text-xs text-slate-400">É o código que o admin te passou ou que chegou no e-mail de aprovação (ex.: <b class="text-slate-300 tracking-wider">ABCD-EFGH</b>).</p>
      <form onSubmit={conferir} class="space-y-3">
        <input name="codigo" required autoFocus maxLength={16} placeholder="ABCD-EFGH" autoComplete="off" autoCapitalize="characters" spellcheck={false}
          class={`${campo} text-center text-lg font-black tracking-[0.3em] uppercase`} />
        {erro.value && <p class="text-xs font-semibold text-red-400" role="alert">{erro.value}</p>}
        <button disabled={enviando.value} class={`${botaoPrincipal} w-full flex items-center justify-center gap-2 !py-3`}>
          {enviando.value ? <Girando tamanho={18} /> : <KeyRound size={17} />} {enviando.value ? 'Conferindo…' : 'Continuar'}
        </button>
      </form>
    </Cartao>
  );
}

/** Página de apresentação (só no navegador). */
function Apresentacao({ ir }) {
  const recursos = [
    [Mic, 'Call de voz limpa', 'Filtro de ruído em 3 níveis, inclusive o "Foco na voz", que corta tudo que não é voz.'],
    [MonitorUp, 'Transmissão ao vivo', 'Mostre o jogo ou a tela para a galera, com o som que você escolher.'],
    [Users, 'Servidores e DMs', 'Crie o servidor do seu grupo, com canais de texto e voz, e mande mensagem direta.'],
    [Music, 'Bot de música', 'Coloque música na call do YouTube, SoundCloud e playlists.'],
  ];
  return (
    <div class="h-full overflow-y-auto">
      <header class="max-w-5xl mx-auto flex items-center justify-between px-4 sm:px-6 py-4">
        <div class="flex items-center gap-2">
          <img src="/img/icone-caocorde.svg" alt="" class="w-9 h-9" />
          <span class="text-lg font-black text-white">Cao<span class="text-brand-400">corde</span></span>
        </div>
        <button class={`${botaoCinza} flex items-center gap-2`} onClick={() => ir('entrar')}><LogIn size={16} /> Entrar</button>
      </header>

      <main class="max-w-5xl mx-auto px-4 sm:px-6">
        <section class="grid md:grid-cols-[1.2fr_1fr] gap-8 items-center py-8 md:py-16">
          <div>
            <span class="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-acento-300 bg-acento-600/15 border border-acento-600/40 rounded-full px-3 py-1">
              <ShieldCheck size={13} /> Só por convite · +18
            </span>
            <h1 class="mt-4 text-4xl sm:text-5xl font-black tracking-tight text-white leading-[1.05]">
              Chat de voz e <span class="text-brand-400">live</span> para a sua galera.
            </h1>
            <p class="mt-4 text-base text-slate-300 max-w-lg">
              O Caocorde é um lugar fechado para grupos de amigos: call de voz, transmissão de jogo e tela, servidores com canais e mensagens diretas. No navegador, no Windows e no Android.
            </p>
            <div class="mt-6 flex flex-col sm:flex-row gap-3">
              <button class={`${botaoPrincipal} !px-6 !py-3.5 !text-base flex items-center justify-center gap-2`} onClick={() => ir('pedir')}><Send size={18} /> Pedir acesso</button>
              <button class={`${botaoCinza} !px-6 !py-3.5 !text-base flex items-center justify-center gap-2`} onClick={() => ir('codigo')}><KeyRound size={18} /> Já tenho acesso (código)</button>
            </div>
          </div>
          <div class="flex justify-center"><Mascote tamanho="w-48 h-48 sm:w-64 sm:h-64" /></div>
        </section>

        <section class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pb-10">
          {recursos.map(([Icone, titulo, texto]) => (
            <div key={titulo} class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4">
              <Icone size={22} class="text-brand-400" />
              <h3 class="mt-2 text-sm font-extrabold text-white">{titulo}</h3>
              <p class="mt-1 text-xs text-slate-400 leading-relaxed">{texto}</p>
            </div>
          ))}
        </section>

        <section class="pb-10">
          <h2 class="text-xl font-black text-white">Como entrar</h2>
          <ol class="mt-3 grid sm:grid-cols-3 gap-3">
            {[
              ['1', 'Peça acesso', 'Diga quem te indicou e como a galera te conhece.'],
              ['2', 'Receba o e-mail', 'Aprovado, chega o link de cadastro com o código pronto.'],
              ['3', 'Crie a conta', 'No navegador, no app do Windows ou no celular Android.'],
            ].map(([numero, titulo, texto]) => (
              <li key={numero} class="flex gap-3 bg-slate-900/50 border border-slate-800/80 rounded-2xl p-4">
                <span class="w-8 h-8 flex-shrink-0 rounded-full bg-brand-600 text-white font-black flex items-center justify-center keep-white">{numero}</span>
                <span><b class="block text-sm text-white">{titulo}</b><span class="text-xs text-slate-400">{texto}</span></span>
              </li>
            ))}
          </ol>
        </section>

        <section class="pb-12">
          <div class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 text-sm text-slate-300 space-y-2">
            <h2 class="text-base font-black text-white flex items-center gap-2"><ShieldCheck size={18} class="text-acento-400" /> Só para maiores de 18 anos</h2>
            <p>O Caocorde não é para crianças nem adolescentes. Ao pedir acesso e ao criar a conta, você confirma que tem 18 anos ou mais. Conta de menor de idade é apagada.</p>
            <p class="text-xs text-slate-400">Cada grupo cuida do próprio servidor; os admins do app podem bloquear e apagar contas que desrespeitarem as regras ou a lei.</p>
          </div>
        </section>
      </main>
      <footer class="max-w-5xl mx-auto px-4 sm:px-6 py-6 text-xs text-slate-500 border-t border-slate-800/80">Caocorde — feito pela galera, para a galera.</footer>
    </div>
  );
}
