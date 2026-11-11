// Configurações do usuário (a engrenagem no canto de baixo), no formato do Discord: as seções ficam numa lista à
// esquerda e o conteúdo de cada uma à direita. Antes era um formulário comprido só, com tudo empilhado e escondido
// em "abrir/fechar"; agora cada assunto tem o seu lugar e o seu próprio botão de salvar.
//
// Seções: Minha conta (foto, nome, senha) · Voz e vídeo · Atalhos · Avisos · Aparência · Bot de música (só no app
// do Windows). "Sair da conta" fica no fim da lista, em vermelho, como no Discord.
// No celular a lista de seções vira uma fileira de abas no topo.

import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { X, LogOut, User, Mic, Keyboard, Bell, Palette, Music, Moon, Sun, Check } from 'lucide-preact';
import { eu, enviar, sair, alternarTema, modoAvisos, mudarAvisos, appAndroid, appDesktop } from './store.js';
import { NoTopo, campo, botaoPrincipal, RegrasSenha, senhaOk } from './ui.jsx';
import { FotoPerfil } from './Foto.jsx';
import { DispositivosVoz } from './Call.jsx';
import { ConfigAtalhos } from './Atalhos.jsx';
import { LoginYoutube } from './Musica.jsx';

/** Título e explicação curta no topo de cada seção. */
function CabecalhoDaSecao({ titulo, explicacao }) {
  return (
    <div class="mb-5">
      <h2 class="text-lg font-extrabold text-white">{titulo}</h2>
      {explicacao && <p class="text-sm text-slate-400 mt-0.5">{explicacao}</p>}
    </div>
  );
}

/** Rótulo de um campo (texto pequeno acima dele). */
const RotuloDoCampo = ({ children }) => <div class="text-xs font-bold text-slate-300 mb-1.5">{children}</div>;

function SecaoMinhaConta() {
  const nomeDigitado = useSignal(eu.value.nome);
  const senhaAtual = useSignal('');
  const senhaNova = useSignal('');
  const confirmacaoDaSenha = useSignal('');
  const nomeMudou = nomeDigitado.value.trim() && nomeDigitado.value.trim() !== eu.value.nome;
  const podeTrocarSenha = senhaAtual.value && senhaOk(senhaNova.value) && senhaNova.value === confirmacaoDaSenha.value;

  function salvarNome(evento) {
    evento.preventDefault();
    if (nomeMudou) enviar({ t: 'perfil', nome: nomeDigitado.value.trim() });
  }
  function trocarSenha(evento) {
    evento.preventDefault();
    if (!podeTrocarSenha) return;
    // Os campos ficam como estão: se o servidor recusar (senha atual errada), a pessoa só corrige o campo errado.
    enviar({ t: 'senha', atual: senhaAtual.value, nova: senhaNova.value });
  }

  return (
    <div class="space-y-7">
      <CabecalhoDaSecao titulo="Minha conta" explicacao={`Você entra como @${eu.value.usuario}.`} />

      <section class="space-y-2">
        <RotuloDoCampo>Foto de perfil</RotuloDoCampo>
        <FotoPerfil />
      </section>

      <form onSubmit={salvarNome} class="space-y-2">
        <label for="config-nome"><RotuloDoCampo>Nome que a galera vê</RotuloDoCampo></label>
        <div class="flex gap-2">
          <input id="config-nome" maxLength={32} value={nomeDigitado.value} onInput={evento => { nomeDigitado.value = evento.currentTarget.value; }} class={campo} />
          <button disabled={!nomeMudou} class={`${botaoPrincipal} flex-shrink-0`}>Salvar</button>
        </div>
      </form>

      <form onSubmit={trocarSenha} class="space-y-2">
        <RotuloDoCampo>Trocar senha</RotuloDoCampo>
        <input type="password" autoComplete="current-password" placeholder="Senha atual" aria-label="Senha atual" class={campo}
          value={senhaAtual.value} onInput={evento => { senhaAtual.value = evento.currentTarget.value; }} />
        <div class="grid sm:grid-cols-2 gap-2">
          <input type="password" autoComplete="new-password" placeholder="Senha nova" aria-label="Senha nova" class={campo}
            value={senhaNova.value} onInput={evento => { senhaNova.value = evento.currentTarget.value; }} />
          <input type="password" autoComplete="new-password" placeholder="Repita a senha nova" aria-label="Repita a senha nova" class={campo}
            value={confirmacaoDaSenha.value} onInput={evento => { confirmacaoDaSenha.value = evento.currentTarget.value; }} />
        </div>
        {senhaNova.value && <RegrasSenha senha={senhaNova.value} confirmar={confirmacaoDaSenha.value} />}
        <button disabled={!podeTrocarSenha} class={botaoPrincipal}>Trocar senha</button>
      </form>
    </div>
  );
}

function SecaoVozEVideo() {
  return (
    <div>
      <CabecalhoDaSecao titulo="Voz e vídeo" explicacao="Microfone, fone/caixa de som e câmera que o Caocorde usa." />
      <DispositivosVoz />
    </div>
  );
}

function SecaoAtalhos() {
  return (
    <div>
      <CabecalhoDaSecao titulo="Atalhos de teclado" explicacao="Funcionam mesmo com o Caocorde minimizado (no app do Windows)." />
      <ConfigAtalhos />
    </div>
  );
}

function SecaoAvisos() {
  // No navegador sem permissão (ou sem notificação) mostra "Nenhum" até a pessoa escolher e liberar.
  const bloqueado = !appAndroid && (!('Notification' in window) || Notification.permission !== 'granted');
  const escolhaAtual = bloqueado ? 'nenhuma' : modoAvisos.value;
  const opcoes = [
    ['todas', 'Todas as mensagens', 'Avisa a cada mensagem nova dos seus servidores.'],
    ['mencoes', 'Só quando me marcarem', 'Quando alguém usar @ com o seu nome ou responder você.'],
    ['nenhuma', 'Nenhum', 'Silencioso. Você vê as mensagens quando abrir o Concorde.'],
  ];
  return (
    <div>
      <CabecalhoDaSecao titulo="Avisos de mensagem" explicacao="Quando o Caocorde avisa você de mensagens novas." />
      <div role="radiogroup" aria-label="Avisos de mensagem" class="space-y-2">
        {opcoes.map(([valor, titulo, explicacao]) => (
          <OpcaoEscolhivel key={valor} escolhida={escolhaAtual === valor} titulo={titulo} explicacao={explicacao} aoEscolher={() => mudarAvisos(valor)} />
        ))}
      </div>
      {bloqueado && <p class="text-xs text-slate-400 mt-3">Para receber avisos no navegador, escolha uma opção e libere as notificações quando o navegador perguntar.</p>}
    </div>
  );
}

function SecaoAparencia() {
  const escuro = useSignal(document.documentElement.classList.contains('dark'));
  const escolher = querEscuro => { if (querEscuro !== escuro.value) { alternarTema(); escuro.value = querEscuro; } };
  return (
    <div>
      <CabecalhoDaSecao titulo="Aparência" explicacao="O tema escuro é o padrão do Concorde." />
      <div role="radiogroup" aria-label="Tema" class="grid sm:grid-cols-2 gap-3">
        <OpcaoEscolhivel escolhida={escuro.value} titulo={<span class="flex items-center gap-2"><Moon size={16} /> Escuro</span>} explicacao="Descansa a vista à noite." aoEscolher={() => escolher(true)} />
        <OpcaoEscolhivel escolhida={!escuro.value} titulo={<span class="flex items-center gap-2"><Sun size={16} /> Claro</span>} explicacao="Bom em lugar muito iluminado." aoEscolher={() => escolher(false)} />
      </div>
    </div>
  );
}

function SecaoBotDeMusica() {
  return (
    <div>
      <CabecalhoDaSecao titulo="Bot de música" explicacao="Quando o YouTube pedir para entrar na conta, o bot usa este login (fica só neste PC)." />
      <LoginYoutube />
    </div>
  );
}

/** Cartão que se escolhe (tema, avisos): a escolhida fica com borda laranja e um ✓ — nunca só pela cor. */
function OpcaoEscolhivel({ escolhida, titulo, explicacao, aoEscolher }) {
  return (
    <button type="button" role="radio" aria-checked={escolhida} onClick={aoEscolher}
      class={`w-full text-left flex items-start gap-3 rounded-xl border-2 px-4 py-3 transition-colors
        ${escolhida ? 'border-brand-400 bg-brand-600/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/40'}`}>
      <span class={`mt-0.5 w-5 h-5 flex-shrink-0 rounded-full border-2 flex items-center justify-center ${escolhida ? 'border-brand-400 bg-brand-400' : 'border-slate-500'}`}>
        {escolhida && <Check size={12} strokeWidth={4} class="text-slate-950" />}
      </span>
      <span>
        <span class="block text-sm font-bold text-white">{titulo}</span>
        <span class="block text-xs text-slate-400 mt-0.5">{explicacao}</span>
      </span>
    </button>
  );
}

/** Lista das seções (a de música só aparece no app do Windows, que é quem toca). */
function secoesDisponiveis() {
  const ehConvidado = !!eu.value?.convidadoAte;   // convidado não tem senha nem troca o nome
  return [
    ...(ehConvidado ? [] : [{ chave: 'conta', titulo: 'Minha conta', Icone: User, Conteudo: SecaoMinhaConta }]),
    { chave: 'voz', titulo: 'Voz e vídeo', Icone: Mic, Conteudo: SecaoVozEVideo },
    { chave: 'atalhos', titulo: 'Atalhos', Icone: Keyboard, Conteudo: SecaoAtalhos },
    { chave: 'avisos', titulo: 'Avisos', Icone: Bell, Conteudo: SecaoAvisos },
    { chave: 'aparencia', titulo: 'Aparência', Icone: Palette, Conteudo: SecaoAparencia },
    ...(appDesktop?.nativo?.youtubeLogin ? [{ chave: 'musica', titulo: 'Bot de música', Icone: Music, Conteudo: SecaoBotDeMusica }] : []),
  ];
}

/**
 * Janela de configurações. Fecha no X, no Esc ou clicando fora.
 * @param {{ onFechar: () => void, secaoInicial?: string }} propriedades
 */
export function Configuracoes({ onFechar, secaoInicial = 'conta' }) {
  const secoes = secoesDisponiveis();
  const secaoAberta = useSignal(secoes.some(secao => secao.chave === secaoInicial) ? secaoInicial : secoes[0].chave);
  const SecaoAtual = secoes.find(secao => secao.chave === secaoAberta.value).Conteudo;

  useEffect(() => {
    const fecharNoEsc = evento => { if (evento.key === 'Escape') onFechar(); };
    addEventListener('keydown', fecharNoEsc);
    return () => removeEventListener('keydown', fecharNoEsc);
  }, []);

  const classeDoItem = ativa => `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold whitespace-nowrap transition-colors
    ${ativa ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`;

  return (
    <NoTopo>
      <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-stretch sm:items-center justify-center sm:p-6"
        onClick={evento => evento.target === evento.currentTarget && onFechar()}>
        <div role="dialog" aria-modal="true" aria-label="Configurações"
          class="w-full sm:max-w-4xl h-full sm:h-[min(640px,90vh)] bg-slate-900 sm:border border-slate-800 sm:rounded-2xl shadow-2xl flex flex-col sm:flex-row overflow-hidden animate-fade-in">

          {/* Seções: coluna à esquerda no PC, abas no topo no celular. */}
          <nav aria-label="Seções das configurações" class="sm:w-56 flex-shrink-0 bg-slate-950 border-b sm:border-b-0 sm:border-r border-slate-800 p-2 sm:p-3 flex sm:flex-col gap-1 overflow-x-auto">
            <div class="hidden sm:block px-2.5 pb-2 text-xs font-extrabold uppercase tracking-wider text-slate-500">Configurações</div>
            {secoes.map(({ chave, titulo, Icone }) => (
              <button key={chave} aria-current={secaoAberta.value === chave ? 'page' : undefined} class={classeDoItem(secaoAberta.value === chave)}
                onClick={() => { secaoAberta.value = chave; }}>
                <Icone size={16} class="flex-shrink-0" /> {titulo}
              </button>
            ))}
            <div class="hidden sm:block my-2 border-t border-slate-800" />
            <button class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold whitespace-nowrap text-[#F2777A] hover:bg-[#DA373C] hover:text-white sm:mt-auto"
              onClick={() => { if (confirm(eu.value?.convidadoAte ? 'Sair? Seu acesso de convidado e o seu chat de convidado vão ser apagados.' : 'Sair da sua conta neste aparelho?')) sair(); }}>
              <LogOut size={16} class="flex-shrink-0" /> {eu.value?.convidadoAte ? 'Sair (encerra o convite)' : 'Sair da conta'}
            </button>
          </nav>

          {/* Conteúdo da seção escolhida. */}
          <div class="flex-1 min-h-0 relative">
            <button title="Fechar (Esc)" aria-label="Fechar as configurações" onClick={onFechar}
              class="absolute top-3 right-3 z-10 p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800">
              <X size={20} />
            </button>
            <div class="h-full overflow-y-auto px-5 sm:px-8 py-6 pr-14">
              <SecaoAtual />
            </div>
          </div>
        </div>
      </div>
    </NoTopo>
  );
}
