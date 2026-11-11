import { useEffect, useRef } from 'preact/hooks';
import { useSignal, signal } from '@preact/signals';
import {
  Mic, MicOff, Headphones, HeadphoneOff, Video, VideoOff, ScreenShare, ScreenShareOff, PhoneOff,
  Maximize, Volume2, VolumeX, Signal, Eye, X, Activity, Speaker, SlidersHorizontal, Check,
} from 'lucide-preact';
import { statsEnvio, diagnostico } from './Estatisticas.js';
import { eu, membros, musica, aviso, vozEstado, servidores, canais, enviar, abrirConversaCom, posso, PERMISSOES, relacoes, acaoDeAmizade } from './store.js';
import { PainelMusica } from './Musica.jsx';
import { Music } from 'lucide-preact';
import {
  minhaCall, mudo, surdo, falando, assistindo, midias, minhas, volumes, QUALIDADES, pessoasNaCall,
  entrarVoz, sairVoz, alternarMudo, alternarSurdo, alternarCamera, compartilharTela, pararTela, assistir, mudarVolume, nativo, volumePadrao, dispositivos, trocarDispositivo, ocupado, botNoCanal, nivelDoFiltroDeRuido, mudarFiltroDeRuido, faixaDaVoz, mudarFaixaDaVoz, nivelDoMicrofone, FAIXA_DA_VOZ_PADRAO, android, transmitirAndroid, medirRecebimento, transmissaoAjustavel, silenciados, alternarSilencio,
} from './voz.js';
import { Avatar, NoTopo, Girando } from './ui.jsx';
import { DialogoTransmitir } from './Transmitir.jsx';

/** Vídeo de um MediaStream (sempre sem som: o áudio toca separado, com volume por pessoa). */
function Video_({ stream, espelhar, ajustar = 'object-cover' }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoplay playsInline muted class={`w-full h-full ${ajustar} ${espelhar ? '-scale-x-100' : ''}`} />;
}

/** Tela da call (canal de voz aberto), estilo Discord: grade de pessoas + transmissões + barra de controles. */
export function CallView({ canal }) {
  const naCall = minhaCall.value?.canal === canal.id;
  const pessoas = pessoasNaCall(canal.id);
  const foco = useSignal(null);   // chave do bloco em destaque (`${uid}:tela` ou `${uid}:pessoa`)

  if (!naCall) {
    return (
      <div class="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
        <div class="w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center"><Volume2 size={30} class="text-brand-500" /></div>
        <h3 class="text-lg font-extrabold text-white">{canal.nome}</h3>
        {pessoas.length > 0
          ? <div class="flex -space-x-2">{pessoas.map(p => <Avatar key={p.uid} membro={membros.value.get(p.uid)} tamanho="w-9 h-9 text-sm" raio="rounded-full" />)}</div>
          : <p class="text-sm text-slate-400">Ninguém na call ainda.</p>}
        <button disabled={!!minhaCall.value?.conectando} class="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-70 disabled:cursor-wait text-white font-bold rounded-xl px-5 py-2.5 text-sm shadow-md transition-all flex items-center gap-2" onClick={() => entrarVoz(canal.id)}>
          {minhaCall.value?.conectando ? <><Girando tamanho={16} /> Conectando…</> : 'Entrar na call'}
        </button>
      </div>
    );
  }

  // Blocos: uma pessoa cada + uma transmissão para cada tela ao vivo.
  const blocos = [];
  if (botNoCanal(canal.id)) blocos.push({ chave: 'bot', tipo: 'bot', p: { uid: 'musica' } });
  for (const p of pessoas) {
    if (p.trilhas?.tela) blocos.push({ chave: `${p.uid}:tela`, tipo: 'tela', p });
    blocos.push({ chave: `${p.uid}:pessoa`, tipo: 'pessoa', p });
  }
  const destaque = blocos.find(b => b.chave === foco.value);
  const resto = destaque ? blocos.filter(b => b !== destaque) : blocos;
  const colunas = Math.min(4, Math.ceil(Math.sqrt(resto.length)));

  const bloco = (b, grande = false) => b.tipo === 'bot' ? (
    <div key="bot" onClick={() => { foco.value = foco.value === 'bot' ? null : 'bot'; }} class="cursor-pointer">
      <BlocoBot canal={canal.id} grande={grande} onVolume={e => abrirVolume(e, 'musica')} />
    </div>
  ) : (
    <Bloco key={b.chave} b={b} grande={grande} focado={b === destaque}
      onFoco={() => { foco.value = foco.value === b.chave ? null : b.chave; }}
      onVolume={e => abrirVolume(e, b.p.uid, b.tipo === 'tela' ? 'tela' : 'voz')} />
  );

  return (
    <div class="flex-1 min-h-0 flex flex-col bg-slate-950/70">
      <div class="flex-1 min-h-0 p-3 flex flex-col gap-3 overflow-y-auto">
        {destaque ? (
          <>
            <div class="flex-1 min-h-0">{bloco(destaque, true)}</div>
            {resto.length > 0 && <div class="flex-shrink-0 flex gap-3 justify-center overflow-x-auto">{resto.map(b => <div class="w-48 flex-shrink-0">{bloco(b)}</div>)}</div>}
          </>
        ) : (
          <div class="m-auto w-full max-w-6xl grid gap-3" style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` }}>
            {resto.map(b => bloco(b))}
          </div>
        )}
      </div>
      <BarraControles />
    </div>
  );
}

/** O Jorginho DJ como "pessoa" na call: capa da música (ou procurando) e o nome. */
function BlocoBot({ canal, grande, onVolume }) {
  const m = musica.value[canal] || {};
  const t = m.tocando;
  return (
    <div onContextMenu={onVolume} class={`relative ${grande ? 'h-full' : 'aspect-video'} rounded-2xl overflow-hidden border ${t && !t.pausado ? 'border-emerald-400 ring-2 ring-emerald-400' : 'border-slate-800/80'} bg-gradient-to-br from-brand-400/30 to-brand-600/30`}>
      {t?.thumb && <img src={t.thumb} alt="" class="absolute inset-0 w-full h-full object-cover opacity-40 blur-[2px]" />}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
        <img src="/img/logo-concorde.svg" alt="" class={`${grande ? 'w-24 h-24' : 'w-16 h-16'} drop-shadow-lg ${t ? '' : 'animate-bounce-subtle'}`} />
        <span class="text-xs font-bold text-white drop-shadow line-clamp-2 max-w-[90%]">{t ? (t.pausado ? '⏸ ' : '🎵 ') + t.titulo : m.passar && !m.passar.aceito ? 'esperando alguém continuar…' : 'procurando a música…'}</span>
      </div>
      <div class="absolute bottom-2 left-2 bg-black/60 backdrop-blur px-2 py-1 rounded-lg text-xs font-bold text-white keep-white">Jorginho DJ <span class="text-[9px] font-black bg-brand-500 px-1 rounded ml-1">BOT</span></div>
    </div>
  );
}

function Bloco({ b, grande, focado, onFoco, onVolume }) {
  const { p } = b;
  const m = membros.value.get(p.uid);
  const souEu = p.uid === eu.value.id;
  const ref = useRef(null);
  const tela = b.tipo === 'tela';
  const stream = midias.value.get(`${p.uid}:${tela ? 'tela' : 'cam'}`);
  const vendo = tela && (souEu || assistindo.value.has(p.uid));
  const fala = !tela && falando.value.has(p.uid);
  const verStats = useSignal(false);

  return (
    <div ref={ref} onClick={onFoco} onContextMenu={onVolume}
      class={`group relative ${grande ? 'h-full' : 'aspect-video'} rounded-2xl overflow-hidden bg-slate-900 border cursor-pointer transition-shadow ${fala ? 'border-emerald-400 ring-2 ring-emerald-400' : 'border-slate-800/80'}`}>
      {tela ? (
        vendo && stream ? <Video_ stream={stream} ajustar="object-contain" /> : (
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-800 to-slate-950">
            <span class="bg-brand-600 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider">Ao vivo</span>
            <span class="text-sm font-bold text-white">{m?.nome} está transmitindo</span>
            {!souEu && <button class="bg-slate-100 hover:bg-white text-slate-900 font-bold rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5"
              onClick={e => { e.stopPropagation(); assistir(p.uid); }}><Eye size={14} /> Assistir</button>}
          </div>
        )
      ) : stream ? (
        <Video_ stream={stream} espelhar={souEu} />
      ) : (
        // Fundo neutro com um brilho leve da cor da pessoa no meio (a cor inteira deixava o quadro marrom).
        <div class="absolute inset-0 flex items-center justify-center bg-slate-800" style={{ backgroundImage: `radial-gradient(circle at center, ${m?.cor || '#6B6461'}2e 0%, transparent 65%)` }}>
          <div class={`rounded-full transition-shadow ${fala ? 'ring-4 ring-emerald-400' : ''}`}>
            <Avatar membro={m} tamanho={grande ? 'w-24 h-24 text-4xl' : 'w-16 h-16 text-2xl'} raio="rounded-full" />
          </div>
        </div>
      )}

      <div class="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur px-2 py-1 rounded-lg text-xs font-bold text-white max-w-[90%]">
        {tela && <ScreenShare size={13} class="text-brand-500 flex-shrink-0" />}
        <span class="truncate">{m?.nome || '?'}{tela && p.trilhas.telaInfo ? ` · ${p.trilhas.telaInfo}` : ''}</span>
        {!tela && <IconesDeMute participante={p} />}
        {silenciados.value.has(tela ? `${p.uid}:tela` : p.uid) && <VolumeX size={13} class="text-red-400 flex-shrink-0" title="Silenciado por você (clique direito para voltar)" />}
      </div>

      {tela && vendo && eu.value.admin && verStats.value && <PainelStats uid={p.uid} souEu={souEu} onFechar={() => { verStats.value = false; }} />}

      <div class="absolute top-2 right-2 hidden group-hover:flex gap-1">
        {tela && vendo && eu.value.admin && (
          <button title="Estatísticas" class={`p-1.5 rounded-lg text-white hover:bg-black/80 ${verStats.value ? 'bg-brand-600' : 'bg-black/60'}`}
            onClick={e => { e.stopPropagation(); verStats.value = !verStats.value; }}><Activity size={15} /></button>
        )}
        {tela && vendo && !souEu && (
          <button title="Parar de assistir" class="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80" onClick={e => { e.stopPropagation(); assistir(p.uid, false); }}><X size={15} /></button>
        )}
        {(tela ? vendo : stream) && (
          <button title="Tela cheia" class="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
            onClick={e => { e.stopPropagation(); document.fullscreenElement ? document.exitFullscreen() : ref.current.requestFullscreen(); }}><Maximize size={15} /></button>
        )}
      </div>
      {focado && <div class="absolute top-2 left-2 text-[10px] font-bold text-slate-300 bg-black/50 px-1.5 py-0.5 rounded hidden group-hover:block">clique para soltar</div>}
    </div>
  );
}

/**
 * Estatísticas da transmissão (igual o "Stream info" do Discord): o que sai de quem transmite, o que chega aqui
 * e onde está o problema. Mede o que chega a cada 2 s enquanto está aberto. Só para os admins do app.
 */
function PainelStats({ uid, souEu, onFechar }) {
  const v = useSignal(null);
  useEffect(() => {
    if (souEu) return;
    let anterior = null, vivo = true;
    const medir = async () => {
      const r = await medirRecebimento(uid, anterior).catch(() => null);
      if (vivo && r) { anterior = r; v.value = r; }
    };
    medir();
    const timer = setInterval(medir, 2000);
    return () => { vivo = false; clearInterval(timer); };
  }, [uid, souEu]);
  const bruto = statsEnvio.value.get(uid);
  const t = bruto && Date.now() - bruto.quando < 6000 ? bruto : null;   // número velho não vale
  const d = diagnostico(t, souEu ? null : v.value);
  const x = (n, sufixo = '') => (n == null ? '—' : `${n}${sufixo}`);
  const res = o => (o?.largura ? `${o.largura}×${o.altura}` : o?.altura ? `${o.altura}p` : '—');
  const linha = (rotulo, valor, ruim) => (
    <div class="flex justify-between gap-3"><span class="text-slate-400">{rotulo}</span><span class={ruim ? 'text-red-400 font-bold' : ''}>{valor}</span></div>
  );
  const limites = { cpu: 'CPU', bandwidth: 'conexão', other: 'outro', none: 'nenhuma' };
  return (
    <div onClick={e => e.stopPropagation()} class="absolute top-2 left-2 z-10 w-64 max-w-[calc(100%-1rem)] max-h-[calc(100%-1rem)] overflow-y-auto bg-black/80 backdrop-blur rounded-xl p-3 text-[11px] text-white space-y-2 cursor-default keep-white">
      <div class="flex items-center justify-between">
        <span class="font-extrabold uppercase tracking-wider text-[10px]">Estatísticas</span>
        <button title="Fechar" class="text-slate-400 hover:text-white" onClick={onFechar}><X size={13} /></button>
      </div>
      <p class={`rounded-lg px-2 py-1.5 font-bold leading-snug ${d.nivel === 'ok' ? 'bg-emerald-500/20 text-emerald-300' : d.nivel === 'aviso' ? 'bg-amber-500/20 text-amber-200' : 'bg-red-500/20 text-red-300'}`}>{d.texto}</p>
      <div class="space-y-0.5 font-mono">
        <div class="font-sans font-bold text-slate-300">{souEu ? 'Seu envio' : 'Quem transmite'}{t?.origem === 'app' ? ' (app)' : t ? ' (navegador)' : ''}</div>
        {t ? <>
          {linha('Imagem', `${res(t)}${t.encoder ? ' · ' + t.encoder : ''}`)}
          {t.qualidade && linha('Qualidade', t.qualidade, t.qualidade.includes('automática'))}
          {linha('Quadros', `${x(t.fps)} / ${x(t.alvoFps)} fps`, t.alvoFps && t.fps < t.alvoFps * 0.7)}
          {linha('Envio', x(t.kbps, ' kbps'))}
          {t.maiorKb != null && linha('Maior quadro', x(t.maiorKb, ' KB'))}
          {t.filaMs != null && linha('Fila de envio', x(t.filaMs, ' ms'), t.filaMs > 200)}
          {linha('Perda até o Cloudflare', x(t.perda, '%'), t.perda > 2)}
          {linha('Ping', x(t.pingMs, ' ms'), t.pingMs > 150)}
          {t.cpu != null && linha('CPU do PC', x(t.cpu, '%'), t.cpu >= 90)}
          {t.limite && linha('Limitado por', limites[t.limite] || t.limite, ['cpu', 'bandwidth'].includes(t.limite))}
        </> : <div class="text-slate-500 font-sans">sem números (app antigo ou celular)</div>}
      </div>
      {!souEu && (
        <div class="space-y-0.5 font-mono">
          <div class="font-sans font-bold text-slate-300">Você recebendo</div>
          {v.value ? <>
            {linha('Imagem', res(v.value))}
            {linha('Quadros', x(v.value.fps, ' fps'), v.value.fps != null && v.value.fps < 15)}
            {linha('Recebendo', x(v.value.kbps, ' kbps'))}
            {linha('Perda', x(v.value.perda, '%'), v.value.perda > 2)}
            {linha('Jitter', x(v.value.jitterMs, ' ms'), v.value.jitterMs > 50)}
            {linha('Ping', x(v.value.pingMs, ' ms'), v.value.pingMs > 150)}
            {linha('Travadas', x(v.value.travadas), v.value.travadasNovas > 0)}
          </> : <div class="text-slate-500 font-sans">medindo…</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Aceleração de hardware (só no app desktop, igual a opção do Discord): usar a placa de vídeo para mostrar o app,
 * decodificar as transmissões e capturar/codificar a sua. Desligar ajuda quando a placa dá problema (tela piscando,
 * preta). O WebView2 só lê isso ao abrir, então pede para reiniciar.
 */
function AceleracaoHardware() {
  const estado = useSignal(null);
  useEffect(() => { nativo?.aceleracao?.().then(e => { estado.value = e; }).catch(() => {}); }, []);
  if (!nativo?.aceleracao || !estado.value) return null;
  const mudar = ligada => nativo.mudarAceleracao(ligada).then(e => { estado.value = e; }).catch(() => {});
  const pendente = estado.value.ligada !== estado.value.emUso;
  return (
    <div class="space-y-1.5">
      <label class="flex items-start gap-2 text-xs text-slate-300 normal-case font-normal cursor-pointer">
        <input type="checkbox" class="accent-brand-500 mt-0.5" checked={estado.value.ligada} onChange={e => mudar(e.currentTarget.checked)} />
        <span><b>Aceleração de hardware</b><br /><span class="text-slate-500">Usa a placa de vídeo para mostrar o app, assistir e transmitir. Desligue só se a tela piscar ou ficar preta.</span></span>
      </label>
      {pendente && (
        <div class="flex items-center gap-2 text-[11px] text-amber-300 normal-case font-normal">
          <span class="flex-1">Vale depois de reiniciar o Caocorde (a call cai por alguns segundos).</span>
          <button type="button" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-bold rounded-lg px-2.5 py-1" onClick={() => nativo.reiniciar()}>Reiniciar agora</button>
        </div>
      )}
    </div>
  );
}

/**
 * Ícones de mute ao lado do nome: vermelho = a própria pessoa mutou; amarelo = um admin mutou (vale para o servidor
 * todo e só um admin tira). Som cortado aparece no lugar do microfone, como no Discord.
 */
function IconesDeMute({ participante }) {
  if (participante.ensurdecidoPeloAdmin) return <span title="Som cortado por um admin"><HeadphoneOff size={13} class="text-amber-400 flex-shrink-0" /></span>;
  if (participante.surdo) return <span title="Mutou o som"><HeadphoneOff size={13} class="text-red-400 flex-shrink-0" /></span>;
  if (participante.mutadoPeloAdmin) return <span title="Microfone mutado por um admin"><MicOff size={13} class="text-amber-400 flex-shrink-0" /></span>;
  if (participante.mudo) return <span title="Mutou o microfone"><MicOff size={13} class="text-red-400 flex-shrink-0" /></span>;
  return null;
}

/** Menu da pessoa aberto agora: { uid, x, y } (um só para o app inteiro). */
const menuDaPessoa = signal(null);

/**
 * Clique direito em qualquer lugar onde a pessoa aparece (quadro da call, lista do canal de voz, lista de membros)
 * abre o MENU DA PESSOA. Ele sempre aparece — com a pessoa mutada, fora da call, transmitindo ou não — e só mostra
 * o que faz sentido naquela hora. (Nome antigo "abrirVolume" mantido: os lugares que já abriam o volume continuam.)
 */
export function abrirVolume(evento, uid) {
  evento.preventDefault();
  menuDaPessoa.value = { uid, x: evento.clientX, y: evento.clientY };
}
export const abrirMenuDaPessoa = abrirVolume;

/**
 * Volume (0% a 200%) de uma voz, live ou da música, no formato do menu do Discord: rótulo, porcentagem e o slider.
 * Duplo clique no slider volta ao padrão. Mexer no slider de algo silenciado tira o silêncio.
 */
function ControleDeVolume({ chave, rotulo }) {
  const volumeAtual = volumes.value[chave] ?? volumePadrao(chave);
  const porcentagem = Math.round(volumeAtual * 100);
  const silenciado = silenciados.value.has(chave);
  return (
    <div class="px-2 py-1.5">
      <div class="flex items-center justify-between text-xs font-semibold text-slate-300">
        <span>{rotulo}</span>
        <span class={`tabular-nums ${porcentagem > 100 ? 'text-brand-300' : 'text-slate-400'}`}>{silenciado ? 'silenciado' : `${porcentagem}%`}</span>
      </div>
      <input type="range" min="0" max="200" step="5" value={porcentagem} aria-label={rotulo} title="Duplo clique: volta ao padrão"
        class={`w-full mt-1 accent-brand-400 ${silenciado ? 'opacity-40' : ''}`}
        onDblClick={() => mudarVolume(chave, volumePadrao(chave))}
        onInput={evento => { if (silenciado) alternarSilencio(chave); mudarVolume(chave, evento.currentTarget.value / 100); }} />
    </div>
  );
}

/**
 * Uma linha do menu da pessoa, no padrão do Discord.
 * perigo = ação de ADMIN (vale para o servidor todo): texto vermelho e fundo vermelho ao passar o mouse.
 * marcado = true/false mostra uma caixa de marcar à direita (o estado nunca é mostrado só pela cor).
 */
function ItemDoMenu({ rotulo, aoClicar, perigo = false, marcado }) {
  const temCaixa = marcado === true || marcado === false;
  return (
    <button role={temCaixa ? 'menuitemcheckbox' : 'menuitem'} aria-checked={temCaixa ? marcado : undefined} onClick={aoClicar}
      class={`group w-full flex items-center justify-between gap-3 rounded-md px-2 min-h-[34px] text-left text-sm font-medium transition-colors
        ${perigo ? 'text-[#F2777A] hover:bg-[#DA373C] hover:text-white' : 'text-slate-200 hover:bg-brand-600 hover:text-white'}`}>
      <span>{rotulo}</span>
      {temCaixa && (
        <span aria-hidden="true" class={`w-[18px] h-[18px] flex-shrink-0 rounded-[4px] border-2 flex items-center justify-center
          ${marcado ? (perigo ? 'bg-[#DA373C] border-[#DA373C] group-hover:bg-white group-hover:border-white' : 'bg-brand-600 border-brand-600 group-hover:bg-white group-hover:border-white')
                    : 'border-slate-500 group-hover:border-white'}`}>
          {marcado && <Check size={12} strokeWidth={4} class={`text-white ${perigo ? 'group-hover:text-[#DA373C]' : 'group-hover:text-brand-600'}`} />}
        </span>
      )}
    </button>
  );
}

/** Linha fina que separa os grupos do menu (para você / admin). */
const SeparadorDoMenu = () => <div role="separator" class="my-1 mx-2 border-t border-slate-700/60" />;

export function MenuDaPessoa() {
  const aberto = menuDaPessoa.value;
  // Esc fecha o menu (ouvindo a página toda: o menu não recebe o foco do teclado sozinho).
  // Fica ANTES do "return null": hook do Preact tem de rodar sempre, na mesma ordem.
  useEffect(() => {
    if (!aberto) return undefined;
    const fecharNoEsc = evento => { if (evento.key === 'Escape') menuDaPessoa.value = null; };
    addEventListener('keydown', fecharNoEsc);
    return () => removeEventListener('keydown', fecharNoEsc);
  }, [aberto]);
  if (!aberto) return null;
  const fechar = () => { menuDaPessoa.value = null; };
  const { uid } = aberto;
  const ehBot = uid === 'musica';
  const ehEu = uid === eu.value?.id;
  const pessoa = ehBot ? { nome: 'Jorginho DJ (música)' } : membros.value.get(uid) || { nome: '?' };

  // Onde a pessoa está agora (em qualquer call que eu enxergo) e o que ela publica.
  const estadoDaPessoaNaCall = ehBot ? null : Object.values(vozEstado.value).flat().find(participante => participante.uid === uid) || null;
  const transmitindo = !!(estadoDaPessoaNaCall?.trilhas?.tela || estadoDaPessoaNaCall?.trilhas?.telaSessao);
  const servidorDaCall = estadoDaPessoaNaCall ? servidores.value.find(servidor => servidor.id === canais.value.find(canal => canal.id === estadoDaPessoaNaCall.canal)?.servidor) : null;
  const souAdminAli = !!(posso(servidorDaCall, PERMISSOES.moderarVoz) || eu.value?.admin);
  const podeModerar = !ehEu && !ehBot && !!estadoDaPessoaNaCall && souAdminAli;
  const moderar = acao => { enviar({ t: 'voz-moderar', uid, acao }); if (acao === 'desconectar') fechar(); };
  // Convidado só está num servidor (o do convite): é lá que um admin pode converter ou encerrar o acesso.
  const servidorDoConvidado = pessoa.convidadoAte ? servidores.value.find(servidor => servidor.membros.includes(uid)) : null;
  const adminDoServidorDoConvidado = !!(servidorDoConvidado?.admin || (servidorDoConvidado && eu.value?.admin));

  const copiarNome = () => { navigator.clipboard?.writeText(pessoa.usuario ? `@${pessoa.usuario}` : pessoa.nome).catch(() => {}); aviso.value = 'Nome copiado.'; fechar(); };
  const estaNaMinhaCall = !!estadoDaPessoaNaCall && estadoDaPessoaNaCall.canal === minhaCall.value?.canal;

  return (
    <NoTopo>
      <div class="fixed inset-0 z-50" onClick={fechar} onContextMenu={evento => { evento.preventDefault(); fechar(); }}
        onKeyDown={evento => { if (evento.key === 'Escape') fechar(); }}>
        <div role="menu" aria-label={`Opções de ${pessoa.nome}`}
          class="absolute w-60 bg-slate-950 border border-slate-800 rounded-lg shadow-2xl shadow-black/50 p-1.5 animate-fade-in"
          style={{ left: Math.max(8, Math.min(aberto.x, innerWidth - 248)), top: Math.max(8, Math.min(aberto.y, innerHeight - 400)) }} onClick={evento => evento.stopPropagation()}>

          {/* Quem é e onde está. */}
          <div class="flex items-center gap-2.5 px-2 pt-1 pb-2">
            {ehBot
              ? <div class="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center flex-shrink-0"><Music size={16} class="text-white" /></div>
              : <Avatar membro={pessoa} tamanho="w-9 h-9 text-xs" raio="rounded-full" />}
            <div class="min-w-0">
              <div class="text-sm font-bold text-white truncate">{pessoa.nome}{ehEu ? ' (você)' : ''}</div>
              <div class="text-xs text-slate-400 truncate">
                {estadoDaPessoaNaCall ? (transmitindo ? '🔴 Ao vivo na call' : 'Na call') : ehBot ? 'Bot de música' : 'Fora da call'}
              </div>
            </div>
          </div>
          <SeparadorDoMenu />

          {/* PARA VOCÊ (texto normal): só muda o que VOCÊ ouve. */}
          {ehEu ? (
            <>
              <ItemDoMenu rotulo="Mutar meu microfone" marcado={mudo.value} aoClicar={() => alternarMudo()} />
              <ItemDoMenu rotulo="Desativar meu áudio" marcado={surdo.value} aoClicar={() => alternarSurdo()} />
            </>
          ) : (
            <>
              <ControleDeVolume chave={uid} rotulo={ehBot ? 'Volume da música' : 'Volume do usuário'} />
              <ItemDoMenu rotulo={ehBot ? 'Silenciar a música' : 'Silenciar para mim'} marcado={silenciados.value.has(uid)} aoClicar={() => alternarSilencio(uid)} />
              {transmitindo && (
                <>
                  <SeparadorDoMenu />
                  <ControleDeVolume chave={`${uid}:tela`} rotulo="Volume da live" />
                  <ItemDoMenu rotulo="Silenciar a live" marcado={silenciados.value.has(`${uid}:tela`)} aoClicar={() => alternarSilencio(`${uid}:tela`)} />
                  {estaNaMinhaCall && <ItemDoMenu rotulo="Assistir a live" aoClicar={() => { assistir(uid); fechar(); }} />}
                </>
              )}
            </>
          )}

          {/* ADMIN (vermelho): vale para o servidor todo; só aparece para admin do servidor ou do app. */}
          {podeModerar && (
            <>
              <SeparadorDoMenu />
              <ItemDoMenu perigo rotulo="Silenciar voz no servidor" marcado={!!estadoDaPessoaNaCall.mutadoPeloAdmin}
                aoClicar={() => moderar(estadoDaPessoaNaCall.mutadoPeloAdmin ? 'desmutar' : 'mutar')} />
              <ItemDoMenu perigo rotulo="Desativar áudio no servidor" marcado={!!estadoDaPessoaNaCall.ensurdecidoPeloAdmin}
                aoClicar={() => moderar(estadoDaPessoaNaCall.ensurdecidoPeloAdmin ? 'desensurdecer' : 'ensurdecer')} />
              <ItemDoMenu perigo rotulo="Desconectar" aoClicar={() => moderar('desconectar')} />
            </>
          )}

          {/* CONVIDADO (acesso temporário): o admin do servidor dele pode transformar em conta ou encerrar. */}
          {pessoa.convidadoAte && adminDoServidorDoConvidado && (
            <>
              <SeparadorDoMenu />
              <ItemDoMenu rotulo="Converter em conta definitiva" aoClicar={() => { enviar({ t: 'convidado-converter', uid }); fechar(); }} />
              <ItemDoMenu perigo rotulo="Encerrar acesso de convidado" aoClicar={() => {
                if (confirm(`Encerrar o acesso de ${pessoa.nome}? O chat de convidado dele é apagado.`)) enviar({ t: 'servidor-membro', id: servidorDoConvidado.id, uid, acao: 'expulsar' });
                fechar();
              }} />
            </>
          )}

          {!ehBot && !pessoa.convidadoAte && (
            <>
              <SeparadorDoMenu />
              {/* Mensagem direta: não para si mesmo, e convidado não manda nem recebe. */}
              {!ehEu && !eu.value?.convidadoAte && <ItemDoMenu rotulo="Mandar mensagem" aoClicar={() => { abrirConversaCom(uid); fechar(); }} />}
              {!ehEu && !eu.value?.convidadoAte && <ItensDeAmizade uid={uid} nome={pessoa.nome} fechar={fechar} />}
              <ItemDoMenu rotulo="Copiar nome de usuário" aoClicar={copiarNome} />
            </>
          )}
        </div>
      </div>
    </NoTopo>
  );
}

/**
 * Amizade, silenciar pela conta e bloquear (servidor: src/Cloudflare/src/amizades.js). "Silenciar (minha conta)"
 * vale em todos os seus aparelhos, diferente do "Silenciar para mim" da call (só neste aparelho).
 */
function ItensDeAmizade({ uid, nome, fechar }) {
  const lista = relacoes.value;
  const ehAmigo = lista.amigos.includes(uid);
  const pediuParaMim = lista.pedidosRecebidos.includes(uid);
  const euPedi = lista.pedidosEnviados.includes(uid);
  const bloqueado = lista.bloqueados.includes(uid);
  const silenciado = lista.silenciados.includes(uid);
  const agir = (tipo, pergunta) => { if (!pergunta || confirm(pergunta)) acaoDeAmizade(tipo, { uid }); fechar(); };
  return (
    <>
      {!bloqueado && (ehAmigo
        ? <ItemDoMenu rotulo="Desfazer amizade" aoClicar={() => agir('amizade-remover', `Desfazer a amizade com ${nome}?`)} />
        : pediuParaMim ? <ItemDoMenu rotulo="Aceitar pedido de amizade" aoClicar={() => agir('amizade-aceitar')} />
          : euPedi ? <ItemDoMenu rotulo="Cancelar pedido de amizade" aoClicar={() => agir('amizade-remover')} />
            : <ItemDoMenu rotulo="Adicionar amigo" aoClicar={() => agir('amizade-pedir')} />)}
      <ItemDoMenu rotulo="Silenciar (minha conta)" marcado={silenciado} aoClicar={() => agir(silenciado ? 'dessilenciar-conta' : 'silenciar-conta')} />
      <ItemDoMenu perigo rotulo="Bloquear" marcado={bloqueado}
        aoClicar={() => agir(bloqueado ? 'desbloquear' : 'bloquear', bloqueado ? null : `Bloquear ${nome}? A amizade é desfeita, as mensagens dele(a) ficam escondidas, a voz some para você e ele(a) não consegue te mandar mensagem direta.`)} />
    </>
  );
}

/** Nome antigo do componente (o Shell monta <MenuVolume />). */
export const MenuVolume = MenuDaPessoa;

/** Celular: por onde sai o som da call (viva-voz, no ouvido, fone com fio, Bluetooth), igual o Discord. */
function BotaoSaidaSom({ classe }) {
  const menu = useSignal(null);   // { lista, atual } enquanto aberto
  const abrir = () => {
    if (menu.value) return void (menu.value = null);
    android.saidas().then(r => { menu.value = r; }).catch(() => { aviso.value = 'Atualize o app do celular para escolher a saída de som.'; });
  };
  const escolher = id => android.saida(id).then(() => { menu.value = null; }).catch(e => { aviso.value = e.message; });
  return (
    <div class="relative flex-shrink-0">
      <button title="Saída de som" class={classe(!!menu.value)} onClick={abrir}><Speaker size={20} /></button>
      {menu.value && (
        <div class="absolute bottom-14 right-0 w-60 bg-slate-900 border border-slate-700/80 rounded-xl shadow-xl p-1 z-20">
          {menu.value.lista.map(s => (
            <button key={s.id} class={`w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-slate-800 ${s.id === menu.value.atual ? 'text-brand-400 font-bold' : 'text-slate-200'}`}
              onClick={() => escolher(s.id)}>{s.id === menu.value.atual ? '✓ ' : ''}{s.nome}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Botões no rodapé da call: câmera, tela (com qualidade), microfone, fone, desligar. */
function BarraControles() {
  const escolhendo = useSignal(false);
  const ajustando = useSignal(false);
  const verMusica = useSignal(false);
  const canalCall = minhaCall.value?.canal;
  const tocandoAgora = !!(canalCall && musica.value[canalCall]?.tocando);
  const cam = !!minhas.value.cam, tela = !!minhas.value.tela;
  const camOcupada = !!ocupado.value.cam, telaOcupada = !!ocupado.value.tela;
  // No celular os botões encolhem um pouco e a música entra na fila (antes ficava por cima do botão da câmera).
  const btn = (ativo, perigo) => `flex-shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-colors disabled:cursor-wait ${perigo ? 'bg-red-600 hover:bg-red-500 text-white' : ativo ? 'bg-slate-100 text-slate-900 hover:bg-white' : 'bg-slate-800/90 text-slate-100 hover:bg-slate-700'}`;
  return (
    <div class="flex-shrink-0 relative flex items-center justify-center gap-1.5 sm:gap-3 px-2 py-3 border-t border-slate-800/80 bg-slate-900/70 backdrop-blur-md">
      <button title={camOcupada ? 'Aguarde…' : cam ? 'Desligar câmera' : 'Ligar câmera'} disabled={camOcupada} class={btn(cam)} onClick={alternarCamera}>
        {camOcupada ? <Girando /> : cam ? <Video size={20} /> : <VideoOff size={20} />}
      </button>
      <button title={telaOcupada ? 'Aguarde…' : tela ? 'Parar transmissão' : 'Compartilhar tela'} disabled={telaOcupada} class={btn(tela)} onClick={() => (tela ? pararTela() : (escolhendo.value = !escolhendo.value))}>
        {telaOcupada ? <Girando /> : tela ? <ScreenShareOff size={20} /> : <ScreenShare size={20} />}
      </button>
      {tela && !telaOcupada && transmissaoAjustavel() && (
        <button title="Ajustar transmissão (qualidade, som, o que transmitir) sem parar a live" class={btn(ajustando.value)} onClick={() => { ajustando.value = true; }}>
          <SlidersHorizontal size={20} />
        </button>
      )}
      <button title={mudo.value ? 'Ligar microfone' : 'Mutar'} class={btn(false, mudo.value)} onClick={alternarMudo}>{mudo.value ? <MicOff size={20} /> : <Mic size={20} />}</button>
      <button title={surdo.value ? 'Voltar a ouvir' : 'Ensurdecer'} class={btn(false, surdo.value)} onClick={alternarSurdo}>{surdo.value ? <HeadphoneOff size={20} /> : <Headphones size={20} />}</button>
      {android?.saidas && <BotaoSaidaSom classe={btn} />}
      <button title="Sair da call" class={btn(false, true)} onClick={() => sairVoz()}><PhoneOff size={20} /></button>
      <button title="Música (Jorginho DJ)" class={`order-first sm:order-none sm:absolute sm:left-3 ${btn(verMusica.value)} ${tocandoAgora && !verMusica.value ? 'ring-2 ring-brand-500 animate-pulse-glow' : ''}`}
        onClick={() => { verMusica.value = !verMusica.value; }}><Music size={20} /></button>
      {verMusica.value && canalCall && <PainelMusica canal={canalCall} onFechar={() => { verMusica.value = false; }} />}
      {escolhendo.value && (nativo
        ? <DialogoTransmitir onFechar={() => { escolhendo.value = false; }} />
        : <EscolherQualidade onFechar={() => { escolhendo.value = false; }} />)}
      {ajustando.value && <DialogoTransmitir atual={transmissaoAjustavel()} onFechar={() => { ajustando.value = false; }} />}
    </div>
  );
}

function EscolherQualidade({ onFechar }) {
  const salva = (() => { try { return localStorage.getItem('qualidadeTela') || '720p30'; } catch { return '720p30'; } })();
  const q = useSignal(salva);
  function ir() {
    try { localStorage.setItem('qualidadeTela', q.value); } catch {}
    onFechar();
    android ? transmitirAndroid(q.value) : compartilharTela(q.value);
  }
  return (
    <div class="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-72 bg-slate-900/95 border border-slate-800/80 rounded-2xl shadow-2xl p-4 space-y-3 animate-fade-in z-20">
      <div class="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Qualidade da transmissão</div>
      <div class="grid grid-cols-2 gap-2">
        {Object.entries(QUALIDADES).map(([k, v]) => (
          <button key={k} onClick={() => { q.value = k; }}
            class={`rounded-xl px-2 py-2 text-xs font-bold border transition-colors ${q.value === k ? 'bg-brand-600 border-brand-500 text-white' : 'bg-slate-800/80 border-slate-700/80 text-slate-200 hover:bg-slate-700/80'}`}>{v.nome}</button>
        ))}
      </div>
      <p class="text-[11px] text-slate-400 leading-snug">Só gasta dados de quem clicar em "Assistir". 720p 30fps é o mais econômico; 60fps para jogo.</p>
      <div class="flex gap-2">
        <button class="flex-1 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-slate-200 font-bold rounded-xl py-2 text-sm" onClick={onFechar}>Cancelar</button>
        <button class="flex-1 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl py-2 text-sm" onClick={ir}>Transmitir</button>
      </div>
    </div>
  );
}

/** Quem está em cada canal de voz, embaixo do nome do canal na lista (igual Discord). */
export function PessoasNoCanal({ canal }) {
  const pessoas = pessoasNaCall(canal.id);
  const estadoMus = musica.value[canal.id];
  const mus = estadoMus?.tocando || (estadoMus?.fila?.length ? { titulo: estadoMus.passar && !estadoMus.passar.aceito ? 'esperando alguém continuar…' : 'procurando a música…', procurando: true } : null);
  if (!pessoas.length) return null;
  return (
    <div class="ml-6 mb-1 space-y-0.5">
      {mus && (
        <div class="flex items-center gap-2 px-2 py-1 rounded-md text-slate-300 hover:bg-slate-800/40" title={`${mus.titulo} — clique direito: volume da música`} onContextMenu={e => abrirVolume(e, 'musica')}>
          <img src="/img/logo-concorde.svg" alt="" class={`w-6 h-6 rounded-full ${mus.pausado || mus.procurando ? 'opacity-60' : 'ring-2 ring-emerald-400'} ${mus.procurando ? 'animate-pulse' : ''}`} />
          <span class="truncate text-[13px] font-semibold">Jorginho DJ</span>
          <span class="ml-auto truncate max-w-[45%] text-[10px] text-slate-400">🎵 {mus.titulo}</span>
        </div>
      )}
      {pessoas.map(p => {
        const m = membros.value.get(p.uid);
        const fala = falando.value.has(p.uid);
        return (
          <div key={p.uid} class="flex items-center gap-2 px-2 py-1 rounded-md text-slate-300 hover:bg-slate-800/40" onContextMenu={e => abrirVolume(e, p.uid)}>
            <div class={`rounded-full ${fala ? 'ring-2 ring-emerald-400' : ''}`}><Avatar membro={m} tamanho="w-6 h-6 text-[11px]" raio="rounded-full" /></div>
            <span class="truncate text-[13px] font-semibold">{m?.nome}</span>
            <span class="ml-auto flex items-center gap-1 flex-shrink-0">
              {p.trilhas?.tela && <span class="bg-brand-600 text-white text-[9px] font-black px-1.5 rounded uppercase">Ao vivo</span>}
              {p.trilhas?.cam && <Video size={13} class="text-slate-400" />}
              <IconesDeMute participante={p} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Faixa "Voz conectada" acima do painel do usuário (igual Discord). */
export function VozConectada({ nomeCanal, aoAbrir }) {
  if (!minhaCall.value) return null;
  const conectando = minhaCall.value.conectando;
  return (
    <div class="flex-shrink-0 px-3 py-2 bg-slate-950/70 border-t border-slate-800/80 flex items-center gap-2">
      <Signal size={18} class={conectando ? 'text-amber-400' : 'text-emerald-400'} />
      <button class="min-w-0 flex-1 text-left" onClick={aoAbrir}>
        <div class={`text-xs font-extrabold ${conectando ? 'text-amber-400' : 'text-emerald-400'}`}>{conectando ? 'Conectando…' : 'Voz conectada'}</div>
        <div class="text-[11px] text-slate-400 truncate hover:underline">{nomeCanal}</div>
      </button>
      <button title={minhas.value.cam ? 'Desligar câmera' : 'Ligar câmera'} disabled={!!ocupado.value.cam} class="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/60 disabled:cursor-wait" onClick={alternarCamera}>
        {ocupado.value.cam ? <Girando tamanho={17} /> : minhas.value.cam ? <Video size={17} /> : <VideoOff size={17} />}
      </button>
      <button title="Sair da call" class="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-slate-800/60" onClick={() => sairVoz()}><PhoneOff size={17} /></button>
    </div>
  );
}

/** Microfone e fone no painel do usuário. */
export function BotoesAudio() {
  return (
    <>
      <button title={mudo.value ? 'Ligar microfone' : 'Mutar'} class={`p-1.5 rounded-lg hover:bg-slate-800/60 ${mudo.value ? 'text-red-400' : 'text-slate-400 hover:text-white'}`} onClick={alternarMudo}>
        {mudo.value ? <MicOff size={17} /> : <Mic size={17} />}
      </button>
      <button title={surdo.value ? 'Voltar a ouvir' : 'Ensurdecer'} class={`p-1.5 rounded-lg hover:bg-slate-800/60 ${surdo.value ? 'text-red-400' : 'text-slate-400 hover:text-white'}`} onClick={alternarSurdo}>
        {surdo.value ? <HeadphoneOff size={17} /> : <Headphones size={17} />}
      </button>
    </>
  );
}

/** Configurações → microfone, câmera e saída de som (vale na hora, até no meio da call). */
export function DispositivosVoz() {
  const lista = useSignal([]);
  useEffect(() => {
    const ler = () => navigator.mediaDevices?.enumerateDevices().then(d => { lista.value = d; }).catch(() => {});
    ler();
    navigator.mediaDevices?.addEventListener('devicechange', ler);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', ler);
  }, []);
  const campo = (tipo, kind, rotulo, padrao) => {
    const opcoes = lista.value.filter(d => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications');
    return (
      <label class="block text-xs font-bold text-slate-300">{rotulo}
        <select class="mt-1.5 w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-3 py-2 text-sm text-slate-100 normal-case font-normal"
          value={dispositivos.value[tipo]} onChange={e => trocarDispositivo(tipo, e.currentTarget.value)}>
          <option value="">{padrao}</option>
          {opcoes.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${rotulo} ${i + 1}`}</option>)}
        </select>
      </label>
    );
  };
  return (
    <div class="space-y-4">
      {campo('mic', 'audioinput', 'Microfone', 'Padrão do Windows')}
      <EscolhaDoFiltroDeRuido />
      {campo('saida', 'audiooutput', 'Saída de som (fone / caixa)', 'Padrão do Windows')}
      <AceleracaoHardware />
      {campo('cam', 'videoinput', 'Câmera', 'Padrão do Windows')}
      {!lista.value.some(d => d.label) && <p class="text-[11px] text-slate-500">Os nomes aparecem depois que você entra numa call (o navegador só mostra com o microfone liberado).</p>}
    </div>
  );
}

/**
 * Filtro de ruído do microfone em 3 níveis, lado a lado (como no Discord). Vale na hora, mesmo no meio da call.
 * A explicação embaixo muda conforme o escolhido, para a pessoa saber o que os outros vão ouvir.
 */
function EscolhaDoFiltroDeRuido() {
  const opcoes = [
    { nivel: 'sem', titulo: 'Sem filtro', explicacao: 'Passa tudo, só tira o eco. Bom quando você quer que ouçam o ambiente (um instrumento, alguém do seu lado).' },
    { nivel: 'estudio', titulo: 'Estúdio', explicacao: 'Tira chiado, microfonia e ruído de fundo, mas o som do ambiente ainda passa. É o padrão.' },
    { nivel: 'foco', titulo: 'Foco na voz', explicacao: 'Só a sua voz abre o microfone: furadeira, teclado e cachorro não passam, mesmo altos.' },
  ];
  const escolhida = opcoes.find(opcao => opcao.nivel === nivelDoFiltroDeRuido.value) || opcoes[1];
  return (
    <div>
      <div id="rotulo-filtro-de-ruido" class="text-xs font-bold text-slate-300 mb-1.5">Filtro de ruído</div>
      <div role="radiogroup" aria-labelledby="rotulo-filtro-de-ruido" class="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-800/80 border border-slate-700/80">
        {opcoes.map(opcao => {
          const ativa = opcao.nivel === escolhida.nivel;
          return (
            <button key={opcao.nivel} type="button" role="radio" aria-checked={ativa} onClick={() => mudarFiltroDeRuido(opcao.nivel)}
              class={`rounded-lg px-2 py-2 text-xs font-bold transition-colors ${ativa ? 'bg-brand-600 text-white shadow' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}>
              {opcao.titulo}
            </button>
          );
        })}
      </div>
      <p class="text-xs text-slate-400 mt-1.5">{escolhida.explicacao}</p>
      {escolhida.nivel === 'foco' && <FaixaDaVoz />}
    </div>
  );
}

/** Converte dB (-70 a 0) na posição (0% a 100%) do medidor. */
const posicaoNoMedidor = volumeEmDb => `${Math.max(0, Math.min(100, ((volumeEmDb + 70) / 70) * 100))}%`;

/**
 * Faixa da voz do "Foco na voz": o medidor mostra o volume do seu microfone agora (verde = o portão abriu) e a área
 * laranja é a faixa que conta como voz. Abaixo do mínimo e acima do máximo o portão não abre.
 */
function FaixaDaVoz() {
  const { minimoEmDb, maximoEmDb } = faixaDaVoz.value;
  const nivel = nivelDoMicrofone.value;
  return (
    <div class="mt-3 rounded-xl border border-slate-700/80 bg-slate-900 p-3 space-y-3">
      <div>
        <div class="flex items-center justify-between text-xs font-bold text-slate-300">
          <span>Faixa da sua voz</span>
          <span class="tabular-nums text-slate-400">{minimoEmDb} a {maximoEmDb} dB</span>
        </div>
        <div class="relative h-3 mt-1.5 rounded-full bg-slate-800 overflow-hidden" aria-hidden="true">
          <div class="absolute inset-y-0 bg-brand-600/40" style={{ left: posicaoNoMedidor(minimoEmDb), right: `calc(100% - ${posicaoNoMedidor(maximoEmDb)})` }} />
          {nivel && <div class={`absolute inset-y-0 left-0 transition-[width] duration-75 ${nivel.portaoAberto ? 'bg-emerald-400' : 'bg-slate-500'}`} style={{ width: posicaoNoMedidor(nivel.volumeEmDb) }} />}
          {/* Marcas do mínimo e do máximo, por cima do medidor (sempre visíveis). */}
          <div class="absolute inset-y-0 w-0.5 bg-brand-300" style={{ left: posicaoNoMedidor(minimoEmDb) }} />
          <div class="absolute inset-y-0 w-0.5 bg-brand-300" style={{ left: posicaoNoMedidor(maximoEmDb) }} />
        </div>
        <p class="text-xs text-slate-400 mt-1.5">
          {nivel
            ? (nivel.portaoAberto ? 'Verde: sua voz está passando.' : 'Cinza: o portão está fechado (não é voz, ou está fora da faixa).')
            : 'Entre numa call com o "Foco na voz" para ver o medidor do seu microfone.'}
        </p>
      </div>
      <label class="block text-xs font-bold text-slate-300">Mínimo (mais baixo que isso é ruído de fundo)
        <input type="range" min="-70" max="-20" step="1" value={minimoEmDb} class="w-full mt-1 accent-brand-400"
          onInput={evento => mudarFaixaDaVoz({ minimoEmDb: Number(evento.currentTarget.value) })} />
      </label>
      <label class="block text-xs font-bold text-slate-300">Máximo (mais alto que isso é grito, pancada ou furadeira)
        <input type="range" min="-40" max="0" step="1" value={maximoEmDb} class="w-full mt-1 accent-brand-400"
          onInput={evento => mudarFaixaDaVoz({ maximoEmDb: Number(evento.currentTarget.value) })} />
      </label>
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs text-slate-400">Barulho passando? Suba o mínimo ou desça o máximo.</p>
        <button type="button" class="flex-shrink-0 text-xs font-bold text-slate-300 hover:text-white underline" onClick={() => mudarFaixaDaVoz(FAIXA_DA_VOZ_PADRAO)}>Voltar ao padrão</button>
      </div>
    </div>
  );
}
