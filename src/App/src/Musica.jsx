import { useEffect } from 'preact/hooks';
import { useSignal, signal } from '@preact/signals';
import { Music, Pause, Play, SkipForward, Square, X, ListMusic, Volume2, KeyRound, ChevronDown } from 'lucide-preact';
import { membros, musica, enviar, appDesktop, aviso, eu } from './store.js';
import { Girando, Dialogo } from './ui.jsx';
import { pessoasNaCall, tocarMusica, volumes, mudarVolume, volumePadrao, minhaCall } from './voz.js';

const tempo = s => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

/**
 * Se ESTE PC (app do Windows) já tem o login do YouTube para o bot: { configurado, desde } ou null (ainda não leu).
 * Compartilhado entre as Configurações e o painel do bot, para os dois mostrarem a mesma coisa.
 */
const estadoDoLoginDoYoutube = signal(null);
function lerEstadoDoLoginDoYoutube() {
  appDesktop?.nativo?.youtubeLoginEstado?.().then(novoEstado => { estadoDoLoginDoYoutube.value = novoEstado; }).catch(() => {});
}

/**
 * Parte do painel do bot que abre e fecha: login do YouTube. Só aparece no app do Windows e só enquanto este PC
 * ainda não tem o login. Depois do login ela some e o painel volta ao normal.
 */
function LoginDoYoutubeNoPainel() {
  const aberto = useSignal(false);
  useEffect(() => { lerEstadoDoLoginDoYoutube(); }, []);
  if (!appDesktop?.nativo?.youtubeLogin || !estadoDoLoginDoYoutube.value || estadoDoLoginDoYoutube.value.configurado) return null;
  return (
    <div class="border-t border-slate-800/80">
      <button type="button" aria-expanded={aberto.value} onClick={() => { aberto.value = !aberto.value; }}
        class="w-full flex items-center gap-2 px-4 py-2.5 text-left text-xs font-bold text-slate-300 hover:bg-slate-800/60">
        <KeyRound size={14} class="text-brand-300 flex-shrink-0" />
        <span class="flex-1">Entrar no YouTube <span class="font-normal text-slate-400">(o bot para de ser bloqueado)</span></span>
        <ChevronDown size={14} class={`transition-transform ${aberto.value ? 'rotate-180' : ''}`} />
      </button>
      {aberto.value && <div class="px-4 pb-3 max-h-80 overflow-y-auto"><LoginYoutube /></div>}
    </div>
  );
}

/** Player do bot de música na call: o que toca, controles, volume, fila e "tocar…" (YouTube, Spotify, SoundCloud…). */
export function PainelMusica({ canal, onFechar }) {
  const estado = musica.value[canal] || { fila: [], tocando: null };
  const { fila, tocando } = estado;
  const consulta = useSignal('');
  const agora = useSignal(Date.now());
  useEffect(() => { const t = setInterval(() => { agora.value = Date.now(); }, 1000); return () => clearInterval(t); }, []);

  const semApp = !pessoasNaCall(canal).some(p => p.app);
  const atual = tocando && fila.find(f => f.id === tocando.item);
  const proximas = fila.filter(f => f.id !== tocando?.item);
  const passou = tocando && !tocando.pausado ? Math.min((agora.value - tocando.desde) / 1000, tocando.duracao || Infinity) : null;
  const vol = volumes.value.musica ?? volumePadrao('musica');
  const botao = 'p-2 rounded-full text-slate-200 hover:bg-slate-700 hover:text-white transition-colors';

  function adicionar(e) {
    e.preventDefault();
    tocarMusica(consulta.value);
    consulta.value = '';
  }

  return (
    <div class="absolute bottom-full mb-3 left-3 w-[22rem] max-w-[calc(100vw-1.5rem)] bg-slate-900/95 border border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden animate-fade-in z-20">
      <div class="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/80">
        <img src="/img/logo-concorde.svg" alt="" class="w-6 h-6" />
        <span class="text-sm font-extrabold text-white">Jorginho DJ</span>
        <span class="text-[10px] font-black uppercase bg-brand-600 text-white px-1.5 rounded">bot</span>
        <button class="ml-auto p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" onClick={onFechar}><X size={16} /></button>
      </div>

      {tocando ? (
        <div class="p-4 space-y-3">
          <div class="flex gap-3">
            {tocando.thumb
              ? <img src={tocando.thumb} alt="" class="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
              : <div class="w-16 h-16 rounded-xl bg-slate-800 flex items-center justify-center flex-shrink-0"><Music size={22} class="text-slate-500" /></div>}
            <div class="min-w-0">
              <a href={tocando.url || undefined} target="_blank" rel="noopener noreferrer" class="block text-sm font-bold text-white leading-snug line-clamp-2 hover:underline">{tocando.titulo}</a>
              <div class="text-[11px] text-slate-400 mt-1">
                {tocando.pausado ? 'pausada' : 'tocando'} pelo app de {membros.value.get(tocando.dj)?.nome || '?'}
                {atual && membros.value.get(atual.por) && ` · pedida por ${membros.value.get(atual.por).nome}`}
              </div>
            </div>
          </div>
          {tocando.duracao && (
            <div class="flex items-center gap-2 text-[10px] font-bold text-slate-400 tabular-nums">
              <span>{tempo(passou)}</span>
              <div class="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                <div class="h-full bg-brand-500" style={{ width: `${passou != null ? Math.min(100, passou / tocando.duracao * 100) : 0}%` }} />
              </div>
              <span>{tempo(tocando.duracao)}</span>
            </div>
          )}
          <div class="flex items-center gap-1">
            <button title={tocando.pausado ? 'Continuar' : 'Pausar'} class={botao} onClick={() => enviar({ t: 'musica-pausar', canal, pausado: !tocando.pausado })}>
              {tocando.pausado ? <Play size={18} /> : <Pause size={18} />}
            </button>
            <button title="Pular" class={botao} onClick={() => enviar({ t: 'musica-pular', canal })}><SkipForward size={18} /></button>
            <button title="Parar e limpar a fila" class={`${botao} hover:!text-red-400`} onClick={() => enviar({ t: 'musica-parar', canal })}><Square size={16} /></button>
            <Volume2 size={15} class="ml-auto text-slate-400" />
            <input type="range" min="0" max="100" value={Math.round(vol * 100)} title="Volume da música (só para você)" class="w-24 accent-brand-500"
              onInput={e => mudarVolume('musica', e.currentTarget.value / 100)} />
          </div>
        </div>
      ) : (
        <div class="px-4 py-3 text-xs text-slate-400 flex items-center gap-2">
          {fila.length > 0 && !semApp && <Girando tamanho={14} />}
          {fila.length ? (semApp ? 'Na fila — só toca quando alguém com o app desktop estiver na call.' : 'Preparando a música…') : 'Nada tocando. Cole um link ou pesquise abaixo.'}
        </div>
      )}

      {proximas.length > 0 && (
        <div class="border-t border-slate-800/80 max-h-40 overflow-y-auto py-1">
          <div class="px-4 pt-1 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1"><ListMusic size={12} /> Próximas ({proximas.length})</div>
          {proximas.map((f, i) => (
            <div key={f.id} class="group flex items-center gap-2 px-4 py-1 text-xs text-slate-300 hover:bg-slate-800/50">
              <span class="w-4 text-slate-500 tabular-nums">{i + 1}</span>
              <span class="truncate flex-1">{f.titulo || f.consulta}</span>
              <span class="text-slate-500">{membros.value.get(f.por)?.nome}</span>
              <button title="Tirar da fila" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-400" onClick={() => enviar({ t: 'musica-remover', canal, id: f.id })}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}

      <LoginDoYoutubeNoPainel />

      <form onSubmit={adicionar} class="flex gap-2 p-3 border-t border-slate-800/80">
        <input value={consulta.value} onInput={e => { consulta.value = e.currentTarget.value; }} maxLength={300}
          placeholder="Nome da música, link ou playlist (YouTube, Spotify…)" class="flex-1 min-w-0 bg-slate-800/80 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500" />
        <button disabled={!consulta.value.trim()} class="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-bold rounded-xl px-3 text-xs">Tocar</button>
      </form>
    </div>
  );
}

/** O DJ saiu da call: pergunta para mim (o próximo da call com o app) se quero continuar a música. */
export function PerguntaDj() {
  const call = minhaCall.value;
  const estado = call && musica.value[call.canal];
  const p = estado?.passar;
  const minha = p && !p.aceito && p.pergunta === eu.value?.id;
  const resta = useSignal(20);
  useEffect(() => {
    if (!minha) return;
    resta.value = Math.max(1, Math.round((p.ate - Date.now()) / 1000)) || 20;
    if (resta.value > 20) resta.value = 20;
    const t = setInterval(() => { resta.value = Math.max(0, resta.value - 1); }, 1000);
    return () => clearInterval(t);
  }, [minha, p?.ate]);
  if (!minha) return null;
  const responder = sim => enviar({ t: 'musica-passar', canal: call.canal, sim });
  const musicaAtual = estado.fila[0];
  return (
    <Dialogo titulo="🎵 Continuar a música?" onFechar={() => responder(false)}>
      <div class="flex gap-3 items-center">
        <img src="/img/logo-concorde.svg" alt="" class="w-12 h-12 flex-shrink-0" />
        <p class="text-sm text-slate-300">
          <b class="text-white">{membros.value.get(p.saiu)?.nome || 'O DJ'}</b> saiu da call. Quer que o Jorginho DJ continue tocando pelo seu app?
          {musicaAtual && <span class="block text-xs text-slate-400 mt-1 truncate">Agora: {musicaAtual.titulo || musicaAtual.consulta}{estado.fila.length > 1 ? ` (+${estado.fila.length - 1} na fila)` : ''}</span>}
        </p>
      </div>
      <div class="flex gap-2">
        <button class="flex-1 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl py-2 text-sm keep-white" onClick={() => responder(true)}>Sim, continuar</button>
        <button class="flex-1 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-slate-200 font-bold rounded-xl py-2 text-sm" onClick={() => responder(false)}>Não ({resta.value}s)</button>
      </div>
    </Dialogo>
  );
}

/**
 * Configurações (só no app desktop): login do YouTube para o bot de música. O arquivo de cookies fica só neste
 * PC e só é usado quando o YouTube pede "entre na conta para confirmar que não é um robô".
 */
export function LoginYoutube() {
  const nativo = appDesktop?.nativo;
  const estado = estadoDoLoginDoYoutube;   // { configurado, desde } — compartilhado com o painel do bot
  const modo = useSignal(null);         // null (escolher) | 'automatico' | 'manual'
  const ocupado = useSignal(false);
  useEffect(() => { lerEstadoDoLoginDoYoutube(); }, []);
  if (!nativo?.youtubeLogin) return null;

  const remover = () => nativo.youtubeLoginRemover().then(novoEstado => { estado.value = novoEstado; aviso.value = 'Login do YouTube removido'; });
  const concluido = novoEstado => { estado.value = novoEstado; modo.value = null; aviso.value = 'Login do YouTube pronto ✓ — o bot já usa na próxima música.'; };

  return (
    <div class="space-y-3 normal-case font-normal">
      <p class="text-xs text-slate-400">
        Quando o YouTube bloqueia o bot ("confirme que não é um robô"), ele entra com uma conta sua. Sem login, ele
        procura a música no SoundCloud. O login fica <b class="text-slate-300">só neste PC</b>: o Caocorde não manda para
        o servidor nem para ninguém.
      </p>
      <div class="flex items-center gap-2">
        <span class={`text-xs font-bold ${estado.value?.configurado ? 'text-emerald-400' : 'text-slate-400'}`}>
          {estado.value?.configurado ? `✓ Login pronto (desde ${estado.value.desde})` : 'Sem login'}
        </span>
        {estado.value?.configurado && <button type="button" class="ml-auto text-xs font-bold text-red-400 hover:text-red-300" onClick={remover}>Tirar o login</button>}
      </div>

      {modo.value == null && (
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button type="button" onClick={() => { modo.value = 'automatico'; }}
            class="text-left rounded-xl border border-brand-500/60 bg-brand-500/10 hover:bg-brand-500/20 p-3">
            <div class="text-sm font-bold text-white">Automático (recomendado)</div>
            <div class="text-[11px] text-slate-400 mt-0.5">O Caocorde abre uma janela do YouTube, você entra na conta e pronto.</div>
          </button>
          <button type="button" onClick={() => { modo.value = 'manual'; }}
            class="text-left rounded-xl border border-slate-700/80 bg-slate-800/60 hover:bg-slate-800 p-3">
            <div class="text-sm font-bold text-white">Manual (passo a passo)</div>
            <div class="text-[11px] text-slate-400 mt-0.5">Você mesmo tira o arquivo de cookies do seu navegador. Use se o automático não der.</div>
          </button>
        </div>
      )}
      {modo.value === 'automatico' && <LoginAutomatico ocupado={ocupado} onPronto={concluido} onVoltar={() => { modo.value = null; }} onUsarManual={() => { modo.value = 'manual'; }} />}
      {modo.value === 'manual' && <LoginManualEmEtapas onPronto={concluido} onVoltar={() => { modo.value = null; }} />}
    </div>
  );
}

/**
 * Automático: explica o que vai acontecer e só abre a janela depois do "Autorizo". A janela (app do PC,
 * src/ConcordeDesktop/LoginDoYouTube.cs) usa um perfil descartável e copia só os cookies do YouTube.
 */
function LoginAutomatico({ ocupado, onPronto, onVoltar, onUsarManual }) {
  const entrar = async () => {
    ocupado.value = true;
    try {
      const resposta = await appDesktop.nativo.youtubeLoginAutomatico();
      if (resposta?.copiados > 0) onPronto(resposta.estado);
      else aviso.value = 'Janela fechada sem entrar na conta — nada foi copiado.';
    } catch (erro) {
      aviso.value = 'Não deu para entrar pela janela do app: ' + erro.message + ' — tente o modo manual.';
    } finally { ocupado.value = false; }
  };
  return (
    <div class="rounded-xl border border-slate-700/80 bg-slate-900/60 p-3 space-y-2 text-xs text-slate-300">
      <div class="font-bold text-white text-sm">O que vai acontecer</div>
      <ol class="list-decimal pl-5 space-y-1">
        <li>O Caocorde abre <b>uma janela própria do YouTube</b> (separada do seu navegador e do Caocorde).</li>
        <li>Você entra na conta que o bot vai usar — de preferência <b>uma conta secundária</b>, não a principal.</li>
        <li>Quando você terminar de entrar, o Caocorde <b>copia o login (cookies) só do YouTube</b> dessa janela para um arquivo neste PC, fecha a janela e apaga o resto.</li>
      </ol>
      <p class="text-slate-400">Nós <b>não vemos nem recebemos</b> sua senha nem esse login: tudo fica neste computador e só o bot de música usa. Dá para tirar a qualquer momento em "Tirar o login".</p>
      <p class="text-amber-400/90">Às vezes o Google não deixa entrar por janelas de apps ("este navegador pode não ser seguro"). Se acontecer, use o modo manual.</p>
      <div class="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" disabled={ocupado.value} onClick={entrar}
          class="bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white font-bold rounded-lg px-3 py-2 flex items-center gap-2">
          {ocupado.value ? <><Girando tamanho={14} /> Esperando você entrar na janela…</> : 'Autorizo — abrir a janela do YouTube'}
        </button>
        <button type="button" class="text-slate-400 hover:text-white font-bold px-2 py-2" onClick={onUsarManual}>Prefiro o manual</button>
        <button type="button" class="ml-auto text-slate-500 hover:text-white px-2 py-2" onClick={onVoltar}>Voltar</button>
      </div>
    </div>
  );
}

const LOJA_CHROME = 'https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc';
const LOJA_FIREFOX = 'https://addons.mozilla.org/pt-BR/firefox/addon/cookies-txt/';

/**
 * Manual em etapas (o jeito que o yt-dlp recomenda para o YouTube): cada etapa só libera a próxima quando a
 * pessoa confirma que fez; a última só termina com um cookies.txt válido (o app do PC confere o formato e se é do
 * YouTube — Ponte.cs → CarregarCookies).
 */
function LoginManualEmEtapas({ onPronto, onVoltar }) {
  const etapaAtual = useSignal(0);
  const navegador = useSignal(null);   // 'chromium' | 'firefox'
  const link = (endereco, texto) => <a href={endereco} target="_blank" rel="noreferrer" class="text-orange-400 hover:text-orange-300 underline font-bold">{texto}</a>;
  const carregarArquivo = () => appDesktop.nativo.youtubeLogin()
    .then(novoEstado => { if (novoEstado?.configurado) onPronto(novoEstado); })
    .catch(erro => { aviso.value = erro.message + ' Gere o arquivo de novo (etapa 4) e tente outra vez.'; });

  const etapas = [
    {
      titulo: 'Qual navegador você usa?',
      conteudo: (
        <div class="flex flex-wrap gap-2">
          <button type="button" class={`rounded-lg px-3 py-1.5 font-bold border ${navegador.value === 'chromium' ? 'bg-brand-600 border-brand-500 text-white' : 'border-slate-700 text-slate-200 hover:bg-slate-800'}`} onClick={() => { navegador.value = 'chromium'; }}>Chrome, Brave, Opera, Edge ou Vivaldi</button>
          <button type="button" class={`rounded-lg px-3 py-1.5 font-bold border ${navegador.value === 'firefox' ? 'bg-brand-600 border-brand-500 text-white' : 'border-slate-700 text-slate-200 hover:bg-slate-800'}`} onClick={() => { navegador.value = 'firefox'; }}>Firefox</button>
        </div>
      ),
      liberado: !!navegador.value, confirmar: 'Próximo',
    },
    {
      titulo: 'Instale a extensão que salva os cookies num arquivo',
      conteudo: navegador.value === 'firefox'
        ? <p>Abra {link(LOJA_FIREFOX, 'cookies.txt (Firefox)')} e clique em "Adicionar ao Firefox".</p>
        : <p>Abra {link(LOJA_CHROME, 'Get cookies.txt LOCALLY')} e clique em "Usar no Chrome" (no Edge: "Permitir extensões de outras lojas"; na Opera: "Adicionar à Opera").</p>,
      liberado: true, confirmar: 'Já instalei',
    },
    {
      titulo: 'Deixe a extensão funcionar na janela anônima',
      conteudo: navegador.value === 'firefox'
        ? <p>Em <b>Gerenciar extensão</b>, marque <b>"Executar em janelas privativas: Permitir"</b>.</p>
        : <p>Em <b>Gerenciar extensões → Detalhes</b> da extensão, ligue <b>"Permitir no modo anônimo"</b>.</p>,
      liberado: true, confirmar: 'Já liguei',
    },
    {
      titulo: 'Entre no YouTube numa janela anônima e salve os cookies',
      conteudo: (
        <ol class="list-decimal pl-5 space-y-1">
          <li>Abra uma <b>janela anônima</b> e entre no YouTube com a conta que o bot vai usar (de preferência uma secundária).</li>
          <li>Nessa mesma aba, abra <b>youtube.com/robots.txt</b>.</li>
          <li>Clique no ícone da extensão e em <b>Export</b> (formato Netscape). O arquivo vai para a pasta Downloads.</li>
        </ol>
      ),
      liberado: true, confirmar: 'Salvei o arquivo',
    },
    {
      titulo: 'Feche a janela anônima',
      conteudo: <p>Feche <b>sem sair da conta</b>. Se você continuar usando o YouTube nessa janela, ele troca os cookies e o arquivo para de funcionar.</p>,
      liberado: true, confirmar: 'Já fechei',
    },
    {
      titulo: 'Carregue o arquivo aqui',
      conteudo: <p>Escolha o arquivo que a extensão salvou (cookies.txt ou youtube.com_cookies.txt). O Caocorde confere se é mesmo um login do YouTube antes de aceitar.</p>,
      liberado: true, confirmar: null,
    },
  ];

  return (
    <div class="rounded-xl border border-slate-700/80 bg-slate-900/60 p-3 space-y-2 text-xs text-slate-300">
      {etapas.map((etapa, indice) => {
        const feita = indice < etapaAtual.value, atual = indice === etapaAtual.value;
        return (
          <div key={indice} class={`rounded-lg p-2.5 border ${atual ? 'border-brand-500/60 bg-brand-500/5' : 'border-transparent'} ${indice > etapaAtual.value ? 'opacity-40' : ''}`}>
            <div class="flex items-center gap-2 font-bold text-slate-200">
              <span class={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${feita ? 'bg-emerald-600 text-white' : atual ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}>{feita ? '✓' : indice + 1}</span>
              {etapa.titulo}
            </div>
            {atual && (
              <div class="mt-2 pl-7 space-y-2">
                {etapa.conteudo}
                {etapa.confirmar
                  ? <button type="button" disabled={!etapa.liberado} class="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-bold rounded-lg px-3 py-1.5" onClick={() => { etapaAtual.value++; }}>{etapa.confirmar}</button>
                  : <button type="button" class="bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-lg px-3 py-1.5" onClick={carregarArquivo}>Escolher o arquivo de cookies</button>}
              </div>
            )}
          </div>
        );
      })}
      <div class="flex items-center gap-2 pt-1">
        {etapaAtual.value > 0 && <button type="button" class="text-slate-400 hover:text-white px-2 py-1" onClick={() => { etapaAtual.value--; }}>← Etapa anterior</button>}
        <button type="button" class="ml-auto text-slate-500 hover:text-white px-2 py-1" onClick={onVoltar}>Voltar</button>
      </div>
      <p class="text-amber-400/90">Esse arquivo é a sua conta logada: não mande para ninguém.</p>
    </div>
  );
}
