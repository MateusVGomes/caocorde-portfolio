// MENSAGENS DIRETAS (DMs) na tela — servidor: src/Cloudflare/src/conversasDiretas.js.
//  - ListaDeConversasDiretas: a coluna da esquerda quando o botão do Concorde (em cima, na barra dos servidores) está
//    escolhido. Mostra as conversas (a mais recente em cima), com bolinha nas que têm mensagem nova.
//  - DialogoNovaConversa: escolher com quem conversar (quem divide algum servidor com você; convidado não entra).
// O chat em si é o mesmo dos canais (Chat.jsx), que entende o tipo "direta".

import { useSignal } from '@preact/signals';
import { Plus, MessageCircle, Search, Users, Check, X, UserMinus, UserPlus, Undo2 } from 'lucide-preact';
import { eu, membros, canalAtual, naoLidos, conversasDiretas, abrirCanal, abrirConversaCom, relacoes, acaoDeAmizade, presencas } from './store.js';
import { Avatar, Dialogo, campo, botaoPrincipal } from './ui.jsx';

/** Coluna da esquerda das mensagens diretas. aoEscolher: fecha a gaveta no celular. */
export function ListaDeConversasDiretas({ aoEscolher, rodape }) {
  const escolhendoPessoa = useSignal(false);
  return (
    <aside class="w-64 flex-shrink-0 flex flex-col bg-slate-900/90 md:bg-slate-900/80 border-r border-slate-800/80 backdrop-blur-md">
      <div class="h-14 flex-shrink-0 px-4 flex items-center border-b border-slate-800/80">
        <h1 class="font-black text-white tracking-tight">Mensagens diretas</h1>
      </div>
      <div class="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        <button onClick={() => { canalAtual.value = null; aoEscolher?.(); }}
          class={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm font-semibold ${canalAtual.value == null ? 'bg-slate-800/80 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'}`}>
          <span class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center flex-shrink-0"><Users size={16} class="text-brand-400" /></span>
          <span class="flex-1 text-left">Amigos</span>
          {relacoes.value.pedidosRecebidos.length > 0 && <span class="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-black flex items-center justify-center" aria-label="pedidos de amizade">{relacoes.value.pedidosRecebidos.length}</span>}
        </button>
        <button onClick={() => { escolhendoPessoa.value = true; }}
          class="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:bg-slate-800/60 hover:text-white">
          <span class="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center flex-shrink-0"><Plus size={16} class="text-white" /></span>
          Nova conversa
        </button>
        <div class="px-2 pt-3 pb-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Conversas</div>
        {conversasDiretas.value.length === 0 && (
          <p class="px-2 text-xs text-slate-400">Nenhuma conversa ainda. Clique em "Nova conversa" ou, no clique direito em alguém, em "Mandar mensagem".</p>
        )}
        {conversasDiretas.value.map(conversa => {
          const outraPessoa = membros.value.get(conversa.com) || { nome: '?' };
          const ativa = conversa.id === canalAtual.value;
          const nova = naoLidos.value.has(conversa.id);
          return (
            <button key={conversa.id} onClick={() => { abrirCanal(conversa.id); aoEscolher?.(); }}
              class={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors ${ativa ? 'bg-slate-800/80 text-white' : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'}`}>
              <Avatar membro={outraPessoa} tamanho="w-8 h-8 text-sm" raio="rounded-full" presenca />
              <span class={`truncate text-sm flex-1 ${nova ? 'font-extrabold text-white' : 'font-semibold'}`}>{outraPessoa.nome}</span>
              {nova && !ativa && <span class="w-2 h-2 rounded-full bg-brand-400 flex-shrink-0" aria-label="mensagem nova" />}
            </button>
          );
        })}
      </div>
      {rodape}
      {escolhendoPessoa.value && <DialogoNovaConversa onFechar={() => { escolhendoPessoa.value = false; }} aoEscolher={aoEscolher} />}
    </aside>
  );
}

/** Escolher com quem conversar: a lista de quem divide servidor com você (sem convidados), com busca. */
function DialogoNovaConversa({ onFechar, aoEscolher }) {
  const busca = useSignal('');
  const pessoas = [...membros.value.values()]
    .filter(pessoa => pessoa.id !== eu.value?.id && !pessoa.convidadoAte && !relacoes.value.bloqueados.includes(pessoa.id))
    .filter(pessoa => !busca.value.trim() || `${pessoa.nome} ${pessoa.usuario}`.toLowerCase().includes(busca.value.trim().toLowerCase()))
    .sort((primeira, segunda) => primeira.nome.localeCompare(segunda.nome));
  const escolher = pessoa => { abrirConversaCom(pessoa.id); onFechar(); aoEscolher?.(); };
  return (
    <Dialogo titulo="Nova conversa" onFechar={onFechar}>
      <div class="relative">
        <Search size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input autoFocus placeholder="Procurar pelo nome" aria-label="Procurar pelo nome" class={`${campo} pl-9`}
          value={busca.value} onInput={evento => { busca.value = evento.currentTarget.value; }} />
      </div>
      <div class="max-h-72 overflow-y-auto -mx-1 space-y-0.5">
        {pessoas.length === 0 && <p class="text-xs text-slate-400 px-1">Ninguém com esse nome nos seus servidores.</p>}
        {pessoas.map(pessoa => (
          <button key={pessoa.id} onClick={() => escolher(pessoa)} class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-slate-800/60">
            <Avatar membro={pessoa} tamanho="w-8 h-8 text-sm" raio="rounded-full" presenca />
            <span class="flex-1 min-w-0">
              <span class="block truncate text-sm font-semibold text-white">{pessoa.nome}</span>
              <span class="block truncate text-[11px] text-slate-400">@{pessoa.usuario}</span>
            </span>
            <MessageCircle size={15} class="text-slate-400" />
          </button>
        ))}
      </div>
    </Dialogo>
  );
}

/**
 * Página de amigos (aparece nas mensagens diretas quando nenhuma conversa está aberta), como no Discord:
 * abas Online / Todos / Pendentes / Bloqueados e "Adicionar amigo" pelo nome de usuário.
 */
export function PainelDeAmigos() {
  const aba = useSignal('online');
  const usuario = useSignal('');
  const lista = relacoes.value;
  const pessoa = id => membros.value.get(id) || { id, nome: '?', usuario: '?' };
  const online = id => (presencas.value[id] || 'offline') !== 'offline';
  const linhas = {
    online: lista.amigos.filter(online).map(id => ({ id, tipo: 'amigo' })),
    todos: lista.amigos.map(id => ({ id, tipo: 'amigo' })),
    pendentes: [...lista.pedidosRecebidos.map(id => ({ id, tipo: 'recebido' })), ...lista.pedidosEnviados.map(id => ({ id, tipo: 'enviado' }))],
    bloqueados: lista.bloqueados.map(id => ({ id, tipo: 'bloqueado' })),
  }[aba.value];
  const abas = [['online', 'Online'], ['todos', 'Todos'], ['pendentes', `Pendentes${lista.pedidosRecebidos.length ? ` (${lista.pedidosRecebidos.length})` : ''}`], ['bloqueados', 'Bloqueados']];
  const vazio = { online: 'Nenhum amigo online agora.', todos: 'Você ainda não tem amigos aqui. Adicione pelo nome de usuário, logo acima.', pendentes: 'Nenhum pedido de amizade.', bloqueados: 'Você não bloqueou ninguém.' }[aba.value];
  const botao = (titulo, Icone, aoClicar, perigo = false) => (
    <button title={titulo} aria-label={titulo} onClick={aoClicar} class={`p-2 rounded-full bg-slate-800 hover:bg-slate-700 ${perigo ? 'text-red-400' : 'text-slate-200'}`}><Icone size={16} /></button>
  );
  function adicionar(evento) {
    evento.preventDefault();
    if (!usuario.value.trim()) return;
    acaoDeAmizade('amizade-pedir', { usuario: usuario.value.trim() });
    usuario.value = '';
  }
  return (
    <div class="flex-1 min-h-0 flex flex-col">
      <div class="flex flex-wrap items-center gap-1 px-4 py-3 border-b border-slate-800/80" role="tablist" aria-label="Amigos">
        <Users size={18} class="text-slate-400 mr-1" />
        {abas.map(([id, rotulo]) => (
          <button key={id} role="tab" aria-selected={aba.value === id} onClick={() => { aba.value = id; }}
            class={`px-3 py-1 rounded-lg text-sm font-semibold ${aba.value === id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'}`}>{rotulo}</button>
        ))}
      </div>
      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        <form onSubmit={adicionar} class="space-y-1.5">
          <h2 class="text-sm font-extrabold text-white">Adicionar amigo</h2>
          <p class="text-xs text-slate-400">Digite o nome de usuário da pessoa (o que aparece com @, ex.: jorginho).</p>
          <div class="flex gap-2 max-w-lg">
            <input value={usuario.value} onInput={evento => { usuario.value = evento.currentTarget.value.toLowerCase(); }} maxLength={21}
              placeholder="nome de usuário" aria-label="Nome de usuário do amigo" class={campo} autoComplete="off" spellcheck={false} />
            <button class={`${botaoPrincipal} flex items-center gap-1.5 flex-shrink-0`} disabled={!usuario.value.trim()}><UserPlus size={15} /> Mandar pedido</button>
          </div>
        </form>
        <div>
          <h3 class="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">{abas.find(([id]) => id === aba.value)[1]} — {linhas.length}</h3>
          {linhas.length === 0 && <p class="text-sm text-slate-500">{vazio}</p>}
          <div class="space-y-0.5">
            {linhas.map(({ id, tipo }) => {
              const alguem = pessoa(id);
              return (
                <div key={`${tipo}-${id}`} class="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-slate-800/40">
                  <Avatar membro={alguem} tamanho="w-9 h-9 text-sm" raio="rounded-full" presenca />
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-bold text-white truncate">{alguem.nome}</div>
                    <div class="text-[11px] text-slate-400 truncate">
                      @{alguem.usuario}{tipo === 'recebido' ? ' · quer ser seu amigo' : tipo === 'enviado' ? ' · pedido enviado' : ''}
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5">
                    {tipo === 'amigo' && <>{botao('Mandar mensagem', MessageCircle, () => abrirConversaCom(id))}{botao('Desfazer amizade', UserMinus, () => confirm(`Desfazer a amizade com ${alguem.nome}?`) && acaoDeAmizade('amizade-remover', { uid: id }), true)}</>}
                    {tipo === 'recebido' && <>{botao('Aceitar', Check, () => acaoDeAmizade('amizade-aceitar', { uid: id }))}{botao('Recusar', X, () => acaoDeAmizade('amizade-remover', { uid: id }), true)}</>}
                    {tipo === 'enviado' && botao('Cancelar pedido', X, () => acaoDeAmizade('amizade-remover', { uid: id }), true)}
                    {tipo === 'bloqueado' && botao('Desbloquear', Undo2, () => acaoDeAmizade('desbloquear', { uid: id }))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
