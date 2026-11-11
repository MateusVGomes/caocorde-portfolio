import { useEffect, useRef, useLayoutEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { Hash, Reply, Pencil, Trash2, X, SendHorizontal, LoaderCircle } from 'lucide-preact';
import { eu, membros, mensagens, digitando, pedirHistorico, enviar, servidorSelecionado, aviso, textoLegivel, marca, converterMencoes, bloqueados, posso, PERMISSOES } from './store.js';
import { Avatar, hora, dataLonga } from './ui.jsx';
import { comandoMusica } from './voz.js';
import { Anexo, BotaoAnexar, GravarVoz, EnviandoAnexo, subirArquivo, arquivoOk } from './Anexos.jsx';

const AGRUPAR_MS = 5 * 60_000;

/** Texto com links clicáveis e menções <@id> destacadas (sem HTML: cada pedaço vira nó de texto, <a> ou <span>). */
function Texto({ texto }) {
  const partes = texto.split(/(https?:\/\/[^\s<]+|<@\d+>)/g);
  return partes.map((p, i) => {
    if (i % 2 === 0) return p;
    const mencao = /^<@(\d+)>$/.exec(p);
    if (!mencao) return <a key={i} href={p} target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:underline break-all">{p}</a>;
    const id = Number(mencao[1]);
    return (
      <span key={i} class={`rounded px-0.5 font-semibold ${id === eu.value.id ? 'bg-amber-500/30 text-amber-200' : 'bg-brand-500/20 text-brand-300'}`}>
        @{membros.value.get(id)?.nome || 'alguém'}
      </span>
    );
  });
}

/** Celular não tem "passar o mouse": tocar na mensagem mostra os botões (responder, editar, apagar). */
const semMouse = typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches;

export function Chat({ canal }) {
  const estado = mensagens.value.get(canal.id) || { lista: [], fim: false, carregando: true };
  const resposta = useSignal(null);
  const editando = useSignal(null);
  const tocada = useSignal(null);    // celular: mensagem com os botões abertos
  const lista = useRef(null);
  const colado = useRef(true);       // usuário está no fim da conversa?
  const alturaAntes = useRef(0);

  // Mantém no fim quando chega mensagem (se já estava no fim); mantém a posição ao carregar mensagens antigas.
  useLayoutEffect(() => {
    const el = lista.current;
    if (!el) return;
    if (alturaAntes.current) { el.scrollTop += el.scrollHeight - alturaAntes.current; alturaAntes.current = 0; }
    else if (colado.current) el.scrollTop = el.scrollHeight;
  }, [estado.lista]);

  useEffect(() => { colado.current = true; resposta.value = null; editando.value = null; }, [canal.id]);

  function rolou(e) {
    const el = e.currentTarget;
    colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && !estado.fim && !estado.carregando && estado.lista.length) {
      alturaAntes.current = el.scrollHeight;
      pedirHistorico(canal.id, estado.lista[0].id);
    }
  }

  const quemDigita = [...(digitando.value.get(canal.id)?.keys() || [])]
    .filter(uid => uid !== eu.value.id).map(uid => membros.value.get(uid)?.nome).filter(Boolean);

  return (
    <div class="flex-1 min-h-0 flex flex-col">
      {/* Imagem/vídeo terminou de carregar e ficou mais alto: continua no fim da conversa. */}
      <div ref={lista} onScroll={rolou} onLoadCapture={() => { if (colado.current) lista.current.scrollTop = lista.current.scrollHeight; }} onLoadedMetadataCapture={() => { if (colado.current) lista.current.scrollTop = lista.current.scrollHeight; }} class="flex-1 overflow-y-auto px-4 py-4">
        {estado.fim && <BoasVindas canal={canal} />}
        {estado.carregando && <div class="flex justify-center py-3 text-slate-400"><LoaderCircle size={20} class="animate-spin" /></div>}
        {estado.lista.map((m, i) => {
          const ant = estado.lista[i - 1];
          const novoDia = !ant || new Date(ant.criado).toDateString() !== new Date(m.criado).toDateString();
          const agrupada = !novoDia && ant && ant.autor === m.autor && !m.resposta && m.criado - ant.criado < AGRUPAR_MS;
          return (
            <div key={m.id}>
              {novoDia && <Divisor ts={m.criado} />}
              <Mensagem m={m} agrupada={agrupada} editando={editando.value === m.id}
                aberta={tocada.value === m.id}
                onTocar={() => { tocada.value = tocada.value === m.id ? null : m.id; }}
                onResponder={() => { resposta.value = m; tocada.value = null; }}
                onEditar={() => { editando.value = m.id; tocada.value = null; }}
                onFimEdicao={() => { editando.value = null; }} />
            </div>
          );
        })}
      </div>

      <div class="px-4 pb-4 pt-1 flex-shrink-0">
        <div class="h-5 px-1 text-[11px] font-semibold text-slate-400 truncate">
          {quemDigita.length > 0 && <span class="animate-pulse">{quemDigita.slice(0, 3).join(', ')} {quemDigita.length > 1 ? 'estão' : 'está'} digitando…</span>}
        </div>
        <Compositor canal={canal} resposta={resposta} onEditarUltima={() => {
          const minha = [...estado.lista].reverse().find(m => m.autor === eu.value.id && !m.apagado);
          if (minha) editando.value = minha.id;
        }} />
      </div>
    </div>
  );
}

function BoasVindas({ canal }) {
  // Conversa direta (DM): mostra a outra pessoa em vez do "#canal".
  if (canal.tipo === 'direta') {
    const outraPessoa = membros.value.get(canal.com) || { nome: '?' };
    return (
      <div class="pb-6 pt-10 px-1">
        <Avatar membro={outraPessoa} tamanho="w-16 h-16 text-2xl" raio="rounded-full" />
        <h3 class="text-2xl font-black text-white mt-3">{outraPessoa.nome}</h3>
        <p class="text-sm text-slate-400">Esse é o começo da sua conversa particular com <b class="text-slate-200">{outraPessoa.nome}</b>. Só vocês dois veem.</p>
      </div>
    );
  }
  return (
    <div class="pb-6 pt-10 px-1">
      <div class="w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center mb-3"><Hash size={32} class="text-brand-500" /></div>
      <h3 class="text-2xl font-black text-white">Bem-vindo a #{canal.nome}!</h3>
      <p class="text-sm text-slate-400">Esse é o começo do canal. Manda a primeira zoeira 🔥</p>
    </div>
  );
}

function Divisor({ ts }) {
  return (
    <div class="flex items-center gap-3 my-4">
      <div class="flex-1 h-px bg-slate-800" />
      <span class="text-[11px] font-bold text-slate-400">{new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
      <div class="flex-1 h-px bg-slate-800" />
    </div>
  );
}

function Mensagem({ m, agrupada, editando, aberta, onTocar, onResponder, onEditar, onFimEdicao }) {
  const autor = membros.value.get(m.autor) || { nome: 'alguém', cor: '#64748b' };
  const minha = m.autor === eu.value.id;
  const podeApagar = minha || posso(servidorSelecionado.value, PERMISSOES.apagarMensagens);
  const meMarcou = marca(m.texto, eu.value.id);
  const revelada = useSignal(false);   // mensagem de alguém bloqueado: escondida até clicar em "mostrar"

  if (!m.apagado && bloqueados.value.has(m.autor) && !revelada.value) {
    return (
      <div class={`pl-14 ${agrupada ? 'py-0.5' : 'pt-3 pb-0.5'} text-xs text-slate-500`}>
        Mensagem de alguém que você bloqueou. <button class="underline hover:text-slate-300" onClick={() => { revelada.value = true; }}>Mostrar</button>
      </div>
    );
  }

  if (m.apagado) {
    return <div class={`pl-14 ${agrupada ? 'py-0.5' : 'pt-3 pb-0.5'} text-xs italic text-slate-500`}>mensagem apagada</div>;
  }
  // Toque no celular (fora de link, botão, áudio e vídeo) abre/fecha os botões.
  const tocar = e => { if (semMouse && !editando && !e.target.closest('a, button, audio, video, input, textarea')) onTocar(); };
  return (
    <div onClick={tocar} class={`group relative flex gap-3 px-2 -mx-2 rounded-lg ${meMarcou ? 'bg-amber-500/10 border-l-2 border-amber-400 hover:bg-amber-500/15' : 'hover:bg-slate-800/40'} ${aberta ? 'bg-slate-800/40' : ''} ${agrupada ? 'py-0.5' : 'pt-3 pb-1 mt-1'}`}>
      <div class="w-10 flex-shrink-0">
        {agrupada
          ? <span class="hidden group-hover:block text-[10px] text-slate-500 text-right pt-1">{hora(m.criado)}</span>
          : <Avatar membro={autor} />}
      </div>
      <div class="min-w-0 flex-1">
        {m.resposta && (
          <div class="flex items-center gap-1.5 text-xs text-slate-400 mb-0.5 truncate">
            <Reply size={12} class="flex-shrink-0 rotate-180" />
            <span class="font-bold" style={{ color: membros.value.get(m.resposta.autor)?.cor }}>{membros.value.get(m.resposta.autor)?.nome || 'alguém'}</span>
            <span class="truncate">{textoLegivel(m.resposta.texto) || 'mensagem apagada'}</span>
          </div>
        )}
        {!agrupada && (
          <div class="flex items-baseline gap-2">
            <span class="font-extrabold text-sm" style={{ color: autor.cor }}>{autor.nome}</span>
            <span class="text-[11px] text-slate-500">{dataLonga(m.criado)}</span>
          </div>
        )}
        {editando
          ? <EdicaoInline m={m} onFim={onFimEdicao} />
          : (
            <>
              {m.texto && (
                <p class="text-sm text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                  <Texto texto={m.texto} />
                  {m.editado && <span class="text-[10px] text-slate-500 ml-1">(editado)</span>}
                </p>
              )}
              {m.anexo && <Anexo a={m.anexo} />}
            </>
          )}
      </div>

      {!editando && (
        <div class={`absolute -top-3 right-2 ${aberta ? 'flex' : 'hidden'} group-hover:flex items-center bg-slate-900/95 border border-slate-700/80 rounded-lg shadow-lg overflow-hidden z-10`}>
          <Acao titulo="Responder" onClick={onResponder}><Reply size={semMouse ? 18 : 15} /></Acao>
          {minha && m.texto && <Acao titulo="Editar" onClick={onEditar}><Pencil size={semMouse ? 18 : 15} /></Acao>}
          {podeApagar && <Acao titulo="Apagar" perigo onClick={() => { if (confirm('Apagar essa mensagem?')) enviar({ t: 'apagar', id: m.id }); }}><Trash2 size={semMouse ? 18 : 15} /></Acao>}
        </div>
      )}
    </div>
  );
}

const Acao = ({ titulo, perigo, onClick, children }) => (
  <button title={titulo} onClick={onClick} class={`${semMouse ? 'p-2.5' : 'p-1.5'} text-slate-400 hover:bg-slate-800 ${perigo ? 'hover:text-red-400' : 'hover:text-white'}`}>{children}</button>
);

function EdicaoInline({ m, onFim }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, []);
  function tecla(e) {
    if (e.key === 'Escape') onFim();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const texto = converterMencoes(ref.current.value.trim(), servidorSelecionado.value?.membros || []);
      if (texto && texto !== m.texto) enviar({ t: 'editar', id: m.id, texto });
      onFim();
    }
  }
  return (
    <div class="mt-1">
      <textarea ref={ref} defaultValue={textoLegivel(m.texto)} onKeyDown={tecla} rows={Math.min(8, m.texto.split('\n').length + 1)}
        class="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none" />
      <p class="text-[11px] text-slate-400">Enter salva • Esc cancela</p>
    </div>
  );
}

function Compositor({ canal, resposta, onEditarUltima }) {
  const ref = useRef(null);
  const ultimoDigitando = useRef(0);
  const enviando = useSignal(null);   // { nome, progresso }
  const arrastando = useSignal(false);
  useEffect(() => { ref.current?.focus(); }, [canal.id, resposta.value]);

  /** Sobe o arquivo e manda a mensagem com ele (o que estiver escrito vai junto). */
  async function mandarArquivo(arquivo, { nome, duracao, voz } = {}) {
    if (enviando.value) { aviso.value = 'Espera o arquivo anterior terminar de enviar.'; return; }
    const rotulo = nome || arquivo.name || 'arquivo';
    enviando.value = { nome: rotulo, progresso: 0 };
    try {
      const r = await subirArquivo(canal.id, arquivo, rotulo, p => { enviando.value = { nome: rotulo, progresso: p }; });
      const texto = voz ? '' : ref.current.value.trim();
      if (enviar({ t: 'enviar', canal: canal.id, texto, anexo: r.chave, duracao, voz, resposta: resposta.value?.id })) {
        if (!voz) { ref.current.value = ''; ajustarAltura(); }
        resposta.value = null;
      }
    } catch (e) {
      aviso.value = e.message;
    } finally {
      enviando.value = null;
    }
  }

  function colou(e) {
    const f = [...(e.clipboardData?.files || [])][0];
    if (f) { e.preventDefault(); if (arquivoOk(f)) mandarArquivo(f, { nome: f.name || 'imagem colada.png' }); }
  }

  function soltou(e) {
    e.preventDefault();
    arrastando.value = false;
    const f = e.dataTransfer?.files?.[0];
    if (f && arquivoOk(f)) mandarArquivo(f);
  }

  function ajustarAltura() {
    const el = ref.current;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  // ---- @ para marcar alguém: digitou @ (e o começo do nome), aparece a lista de quem está no servidor ----
  const sugestoes = useSignal([]);
  const escolhida = useSignal(0);
  // Quem pode ser marcado: os membros do servidor, ou as duas pessoas numa conversa direta.
  const idsServidor = () => (canal.tipo === 'direta' ? [eu.value?.id, canal.com].filter(Boolean) : servidorSelecionado.value?.membros || []);

  function procurarMencao() {
    const el = ref.current;
    const antes = el.value.slice(0, el.selectionStart);
    const achou = /(^|\s)@([^\s@]{0,32})$/.exec(antes);
    if (!achou) { sugestoes.value = []; return; }
    const busca = achou[2].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const sem = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    sugestoes.value = idsServidor().map(id => membros.value.get(id)).filter(p => p && p.id !== eu.value.id)
      .filter(p => sem(p.nome).includes(busca) || sem(p.usuario).includes(busca))
      .sort((a, b) => sem(a.nome).indexOf(busca) - sem(b.nome).indexOf(busca) || a.nome.localeCompare(b.nome))
      .slice(0, 6);
    escolhida.value = 0;
  }

  function mencionar(p) {
    const el = ref.current;
    const antes = el.value.slice(0, el.selectionStart).replace(/@([^\s@]{0,32})$/, `@${p.nome} `);
    const depois = el.value.slice(el.selectionStart);
    el.value = antes + depois;
    el.focus();
    el.setSelectionRange(antes.length, antes.length);
    sugestoes.value = [];
    ajustarAltura();
  }

  function mandar() {
    const texto = converterMencoes(ref.current.value.trim(), idsServidor());
    if (!texto) return;
    sugestoes.value = [];
    if (comandoMusica(texto)) { ref.current.value = ''; ajustarAltura(); return; }
    if (enviar({ t: 'enviar', canal: canal.id, texto, resposta: resposta.value?.id })) {
      ref.current.value = '';
      ajustarAltura();
      resposta.value = null;
    }
  }

  function tecla(e) {
    const lista = sugestoes.value;
    if (lista.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); escolhida.value = (escolhida.value + (e.key === 'ArrowDown' ? 1 : lista.length - 1)) % lista.length; return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); mencionar(lista[escolhida.value]); return; }
      if (e.key === 'Escape') { sugestoes.value = []; return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandar(); return; }
    if (e.key === 'ArrowUp' && !ref.current.value) { e.preventDefault(); onEditarUltima(); return; }
    if (e.key === 'Escape') resposta.value = null;
    if (Date.now() - ultimoDigitando.current > 2500) {
      ultimoDigitando.current = Date.now();
      enviar({ t: 'digitando', canal: canal.id });
    }
  }

  const alvo = resposta.value && (membros.value.get(resposta.value.autor)?.nome || 'alguém');
  return (
    <div class="relative">
    {sugestoes.value.length > 0 && (
      <div class="absolute bottom-full mb-2 left-0 right-0 bg-slate-900 border border-slate-700/80 rounded-xl shadow-xl p-1 z-20">
        <div class="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Marcar alguém</div>
        {sugestoes.value.map((p, i) => (
          <button key={p.id} onMouseDown={e => e.preventDefault()} onClick={() => mencionar(p)}
            class={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left ${i === escolhida.value ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}>
            <Avatar membro={p} tamanho="w-6 h-6 text-[10px]" />
            <span class="text-sm font-semibold" style={{ color: p.cor }}>{p.nome}</span>
            <span class="text-xs text-slate-500">@{p.usuario}</span>
          </button>
        ))}
      </div>
    )}
    <div class={`bg-slate-900/80 border backdrop-blur-md rounded-2xl shadow-xl overflow-hidden ${arrastando.value ? 'border-brand-500 ring-2 ring-brand-500/50' : 'border-slate-800/80'}`}
      onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); arrastando.value = true; } }}
      onDragLeave={() => { arrastando.value = false; }} onDrop={soltou}>
      {enviando.value && <EnviandoAnexo nome={enviando.value.nome} progresso={enviando.value.progresso} />}
      {resposta.value && (
        <div class="flex items-center gap-2 px-4 py-2 text-xs text-slate-400 bg-slate-950/60 border-b border-slate-800/80">
          <Reply size={13} /> Respondendo <span class="font-bold text-slate-200">{alvo}</span>
          <button class="ml-auto hover:text-white" onClick={() => { resposta.value = null; }} title="Cancelar"><X size={14} /></button>
        </div>
      )}
      <div class="flex items-end gap-1 p-2">
        <BotaoAnexar onArquivo={f => mandarArquivo(f)} />
        <textarea ref={ref} rows={1} maxLength={2000} onKeyDown={tecla} onInput={() => { ajustarAltura(); procurarMencao(); }} onPaste={colou}
          onBlur={() => setTimeout(() => { sugestoes.value = []; }, 150)}
          placeholder={canal.tipo === 'direta' ? `Mensagem para ${membros.value.get(canal.com)?.nome || '…'}` : `Conversar em #${canal.nome}`}
          class="flex-1 bg-transparent px-2.5 py-2 text-sm text-slate-100 placeholder-slate-400 focus:outline-none resize-none max-h-[200px]" />
        <GravarVoz onPronto={(blob, dur) => mandarArquivo(blob, { nome: 'mensagem de voz.' + (blob.type.split('/')[1] || 'webm'), duracao: dur, voz: true })} />
        <button onClick={mandar} title="Enviar" class="bg-brand-600 hover:bg-brand-500 text-white p-2.5 rounded-xl shadow-md transition-colors keep-white"><SendHorizontal size={18} /></button>
      </div>
    </div>
    </div>
  );
}
