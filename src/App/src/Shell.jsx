import { useSignal } from '@preact/signals';
import { Hash, Volume2, Plus, Pencil, Trash2, Settings, Users, Menu, Crown, WifiOff, Megaphone, X, ShieldCheck } from 'lucide-preact';
import {
  eu, semConexao, membros, presencas, canais, canalAtual, canalSelecionado, naoLidos, canaisDoServidor, servidorSelecionado, avisoGeral,
  abrirCanal, enviar, servidorAtual, SERVIDOR_DAS_CONVERSAS_DIRETAS, servidores, posso, PERMISSOES,
} from './store.js';
import { ListaDeConversasDiretas, PainelDeAmigos } from './ConversasDiretas.jsx';
import { BarraServidores, CabecalhoServidor, AtualizacaoCelular, DialogoNovoServidor } from './Servidores.jsx';
import { PainelApp } from './AdminApp.jsx';
import { PerguntaDj } from './Musica.jsx';
import { Avatar, Dialogo, campo, botaoPrincipal, botaoCinza } from './ui.jsx';
import { Chat } from './Chat.jsx';
import { Configuracoes } from './Configuracoes.jsx';
import { BotaoDeAtualizacao } from './Atualizacao.jsx';
import { FaixaDoConvidado } from './Convidado.jsx';
import { CallView, PessoasNoCanal, VozConectada, BotoesAudio, MenuVolume, abrirMenuDaPessoa } from './Call.jsx';
import { entrarVoz, minhaCall } from './voz.js';

/** Layout do Concorde: barra de servidores | canais | conversa | membros. */
export function Shell() {
  const gavetaCanais = useSignal(false);   // celular: lista de canais por cima
  const mostrarMembros = useSignal(typeof window !== 'undefined' && window.innerWidth >= 1280);
  const canal = canalSelecionado.value;
  // O botão do Concorde (em cima, na barra dos servidores) abre as mensagens diretas: "servidor" 0.
  const vendoMensagensDiretas = servidorAtual.value === SERVIDOR_DAS_CONVERSAS_DIRETAS;
  const painelApp = useSignal(false);
  const avisoFechado = useSignal((() => { try { return localStorage.getItem('avisoFechado'); } catch { return null; } })());
  const av = avisoGeral.value;

  return (
    <div class="h-full flex flex-col">
      <AtualizacaoCelular />
      <FaixaDoConvidado />
      {semConexao.value && (
        <div class="bg-amber-500 text-slate-950 text-xs font-bold px-4 py-1.5 flex items-center justify-center gap-2 keep-dark">
          <WifiOff size={14} /> Sem conexão com o servidor — reconectando…
        </div>
      )}
      {av && avisoFechado.value !== av.texto && (
        <div class="bg-amber-400 text-slate-950 text-xs font-bold px-4 py-1.5 flex items-center justify-center gap-2 keep-dark">
          <Megaphone size={14} /> <span class="truncate">{av.texto}</span> <span class="opacity-60 font-semibold">— {av.de}</span>
          <button class="ml-2 p-0.5 rounded hover:bg-black/10" title="Fechar" onClick={() => { avisoFechado.value = av.texto; try { localStorage.setItem('avisoFechado', av.texto); } catch {} }}><X size={14} /></button>
        </div>
      )}
      <div class="flex-1 min-h-0 flex">
        <BarraServidores aoAbrirAdminApp={() => { painelApp.value = true; }} />

        {/* Canais: fixo no PC, gaveta no celular (com os servidores junto) */}
        <div class={`${gavetaCanais.value ? 'fixed inset-0 z-40 flex' : 'hidden'} md:static md:flex md:z-auto`}>
          <BarraServidores celular aoAbrirAdminApp={() => { painelApp.value = true; }} />
          {vendoMensagensDiretas
            ? <ListaDeConversasDiretas aoEscolher={() => { gavetaCanais.value = false; }} rodape={<RodapeDaColuna aoEscolher={() => { gavetaCanais.value = false; }} />} />
            : <ListaCanais aoEscolher={() => { gavetaCanais.value = false; }} />}
          <div class="flex-1 bg-black/50 md:hidden" onClick={() => { gavetaCanais.value = false; }} />
        </div>

        <main class="flex-1 min-w-0 flex flex-col">
          <header class="h-14 flex-shrink-0 px-4 flex items-center gap-3 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md">
            <button class="md:hidden text-slate-300 hover:text-white" onClick={() => { gavetaCanais.value = true; }} title="Canais"><Menu size={20} /></button>
            {canal?.tipo === 'direta' ? (
              // Conversa direta: a foto e o nome da outra pessoa no lugar do "#canal".
              <>
                <Avatar membro={membros.value.get(canal.com) || { nome: '?' }} tamanho="w-7 h-7 text-xs" raio="rounded-full" presenca />
                <h2 class="font-extrabold text-white truncate">{membros.value.get(canal.com)?.nome || 'Conversa'}</h2>
              </>
            ) : (
              <>
                {canal && (canal.tipo === 'voz' ? <Volume2 size={20} class="text-slate-400" /> : <Hash size={20} class="text-slate-400" />)}
                <h2 class="font-extrabold text-white truncate">{canal?.nome || (vendoMensagensDiretas ? 'Amigos' : 'Caocorde')}</h2>
              </>
            )}
            <div class="ml-auto flex items-center gap-1">
              <BotaoDeAtualizacao />
              <button onClick={() => { mostrarMembros.value = !mostrarMembros.value; }} title="Membros"
                class={`p-2 rounded-lg transition-colors ${mostrarMembros.value ? 'text-white bg-slate-800/80' : 'text-slate-400 hover:text-white'}`}>
                <Users size={18} />
              </button>
            </div>
          </header>
          <div class="flex-1 min-h-0 flex">
            <div class="flex-1 min-w-0 flex flex-col">
              {(canal?.tipo === 'texto' || canal?.tipo === 'direta') && <Chat canal={canal} />}
              {canal?.tipo === 'voz' && <CallView canal={canal} />}
              {!canal && !vendoMensagensDiretas && servidores.value.length === 0 && <BoasVindasSemServidor />}
              {!canal && vendoMensagensDiretas && <PainelDeAmigos />}
            </div>
            {mostrarMembros.value && !vendoMensagensDiretas && <ListaMembros />}
          </div>
        </main>
      </div>
      {painelApp.value && <PainelApp onFechar={() => { painelApp.value = false; }} />}
      <MenuVolume />
      <PerguntaDj />
    </div>
  );
}

function ListaCanais({ aoEscolher }) {
  const editando = useSignal(null);   // { modo: 'criar'|'renomear', tipo, canal }
  const admin = posso(servidorSelecionado.value, PERMISSOES.canais);   // criar/renomear/apagar canais
  const grupos = [['texto', 'Canais de texto', Hash], ['voz', 'Canais de voz', Volume2]];

  return (
    <aside class="w-64 flex-shrink-0 flex flex-col bg-slate-900/90 md:bg-slate-900/80 border-r border-slate-800/80 backdrop-blur-md">
      <CabecalhoServidor />

      <div class="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {grupos.map(([tipo, titulo, Icone]) => (
          <div key={tipo}>
            <div class="px-2 mb-1 flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              {titulo}
              {admin && <button title="Criar canal" class="hover:text-white" onClick={() => { editando.value = { modo: 'criar', tipo }; }}><Plus size={14} /></button>}
            </div>
            {canaisDoServidor.value.filter(c => c.tipo === tipo).map(c => {
              const ativo = c.id === canalAtual.value;
              const novo = naoLidos.value.has(c.id);
              return (
                <div key={c.id}>
                <div class={`group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${ativo ? 'bg-slate-800/80 text-white' : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'}`}
                  onClick={() => { abrirCanal(c.id); if (c.tipo === 'voz') entrarVoz(c.id); aoEscolher(); }}>
                  <Icone size={18} class="flex-shrink-0 opacity-70" />
                  <span class={`truncate text-sm ${novo ? 'font-extrabold text-white' : 'font-semibold'}`}>{c.nome}</span>
                  {novo && !ativo && <span class="ml-auto w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" />}
                  {admin && (
                    <span class="ml-auto hidden group-hover:flex items-center gap-1">
                      <button title="Renomear" class="hover:text-white" onClick={e => { e.stopPropagation(); editando.value = { modo: 'renomear', canal: c }; }}><Pencil size={13} /></button>
                      <button title="Apagar" class="hover:text-red-400" onClick={e => {
                        e.stopPropagation();
                        if (confirm(`Apagar o canal "${c.nome}"${c.tipo === 'texto' ? ' e todas as mensagens dele' : ''}?`)) enviar({ t: 'canal-apagar', id: c.id });
                      }}><Trash2 size={13} /></button>
                    </span>
                  )}
                </div>
                {c.tipo === 'voz' && <PessoasNoCanal canal={c} />}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <RodapeDaColuna aoEscolher={aoEscolher} />
      {editando.value && <DialogoCanal {...editando.value} onFechar={() => { editando.value = null; }} />}
    </aside>
  );
}

/** Fim da coluna da esquerda (canais ou mensagens diretas): a call em que estou e o meu painel (mute, configurações). */
function RodapeDaColuna({ aoEscolher }) {
  return (
    <>
      <VozConectada nomeCanal={canais.value.find(c => c.id === minhaCall.value?.canal)?.nome} aoAbrir={() => { abrirCanal(minhaCall.value.canal); aoEscolher?.(); }} />
      <PainelUsuario />
    </>
  );
}

function DialogoCanal({ modo, tipo, canal, onFechar }) {
  function salvar(e) {
    e.preventDefault();
    const nome = new FormData(e.target).get('nome');
    enviar(modo === 'criar' ? { t: 'canal-criar', nome, tipo, servidor: servidorSelecionado.value?.id } : { t: 'canal-renomear', id: canal.id, nome });
    onFechar();
  }
  return (
    <Dialogo titulo={modo === 'criar' ? `Novo canal de ${tipo === 'voz' ? 'voz' : 'texto'}` : 'Renomear canal'} onFechar={onFechar}>
      <form onSubmit={salvar} class="space-y-3">
        <input name="nome" required autoFocus maxLength={32} defaultValue={canal?.nome || ''} placeholder={tipo === 'voz' ? 'Resenha' : 'memes'} class={campo} />
        <div class="flex justify-end gap-2">
          <button type="button" class={botaoCinza} onClick={onFechar}>Cancelar</button>
          <button class={botaoPrincipal}>{modo === 'criar' ? 'Criar' : 'Salvar'}</button>
        </div>
      </form>
    </Dialogo>
  );
}

function PainelUsuario() {
  const config = useSignal(false);
  const me = eu.value;
  return (
    <div class="flex-shrink-0 p-2 bg-slate-950/60 border-t border-slate-800/80 flex items-center gap-2">
      <Avatar membro={me} tamanho="w-9 h-9 text-sm" presenca />
      <div class="min-w-0 flex-1">
        <div class="text-sm font-bold text-white truncate">{me.nome}</div>
        {/* Convidado tem um usuário escondido (convidado.xxxx): mostra só que é convidado. */}
        <div class="text-[11px] text-slate-400 truncate">{me.convidadoAte ? 'convidado' : `@${me.usuario}`}</div>
      </div>
      <BotoesAudio />
      <button class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60" title="Configurações" aria-label="Configurações" onClick={() => { config.value = true; }}><Settings size={17} /></button>
      {config.value && <Configuracoes onFechar={() => { config.value = false; }} />}
    </div>
  );
}

function ListaMembros() {
  const s = servidorSelecionado.value;
  const todos = (s?.membros || []).map(id => membros.value.get(id)).filter(Boolean);
  const estado = m => presencas.value[m.id] || 'offline';
  const online = todos.filter(m => estado(m) !== 'offline').sort((a, b) => a.nome.localeCompare(b.nome));
  const offline = todos.filter(m => estado(m) === 'offline').sort((a, b) => a.nome.localeCompare(b.nome));
  const Grupo = ({ titulo, lista, apagado }) => lista.length > 0 && (
    <div class="space-y-1">
      <div class="px-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">{titulo} — {lista.length}</div>
      {lista.map(m => (
        <div key={m.id} onContextMenu={evento => abrirMenuDaPessoa(evento, m.id)} title="Clique direito: volume, silenciar e (admin) moderação"
          class={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-800/40 ${apagado ? 'opacity-50' : ''}`}>
          <Avatar membro={m} tamanho="w-8 h-8 text-sm" presenca />
          <span class="truncate text-sm font-semibold" style={{ color: apagado ? undefined : m.cor }}>{m.nome}</span>
          {m.convidadoAte && <span class="flex-shrink-0 text-[10px] font-extrabold uppercase bg-brand-600/20 text-brand-300 px-1.5 rounded" title="Acesso temporário de convidado">convidado</span>}
          {s?.dono === m.id ? <Crown size={13} class="text-amber-400 flex-shrink-0" title="Dono" /> : s?.admins.includes(m.id) && <ShieldCheck size={13} class="text-sky-400 flex-shrink-0" title="Admin" />}
        </div>
      ))}
    </div>
  );
  return (
    <aside class="hidden md:block w-60 flex-shrink-0 overflow-y-auto px-2 py-4 space-y-5 bg-slate-900/60 border-l border-slate-800/80 backdrop-blur-md">
      <Grupo titulo="Online" lista={online} />
      <Grupo titulo="Offline" lista={offline} apagado />
    </aside>
  );
}

/** Conta nova (desde a 0.5.10 começa sem servidor): explica e oferece criar um servidor ou entrar com convite. */
function BoasVindasSemServidor() {
  const dialogo = useSignal(null);   // 'criar' | 'entrar' | null
  return (
    <div class="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3">
      <img src="/img/logo-concorde.svg" alt="" class="w-28 h-28" />
      <p class="text-xl font-black text-white">Bem-vindo ao Caocorde!</p>
      <p class="text-sm text-slate-400 max-w-sm">Você ainda não está em nenhum servidor. Crie o do seu grupo ou use o convite que um amigo te mandou.</p>
      <div class="flex flex-col sm:flex-row gap-2 mt-2">
        <button class={botaoPrincipal} onClick={() => { dialogo.value = 'criar'; }}>Criar um servidor</button>
        <button class={botaoCinza} onClick={() => { dialogo.value = 'entrar'; }}>Entrar com um convite</button>
      </div>
      {dialogo.value && <DialogoNovoServidor abaInicial={dialogo.value} onFechar={() => { dialogo.value = null; }} />}
    </div>
  );
}
