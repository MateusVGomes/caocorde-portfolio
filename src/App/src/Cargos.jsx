// CARGOS DO SERVIDOR na tela (servidor: src/Cloudflare/src/cargos.js).
//  - AbaCargos: criar, editar (nome, cor, permissões) e apagar cargos — aba "Cargos" das configurações do servidor.
//  - CargosDoMembro: as etiquetas de cargo de uma pessoa, com o menu para dar/tirar (aba "Membros").
// Quem não é dono/admin só vê e dá cargos com permissões que ele mesmo tem (o servidor confere de novo).

import { useSignal } from '@preact/signals';
import { Plus, Trash2, Save, Tag } from 'lucide-preact';
import { enviar, PERMISSOES } from './store.js';
import { campo, botaoPrincipal, botaoCinza } from './ui.jsx';

/** Nome e explicação de cada permissão (na ordem em que aparecem). */
export const NOMES_DAS_PERMISSOES = [
  ['convidar', 'Convidar pessoas', 'Gerar o link e os códigos do servidor (só para quem já tem conta no Caocorde).'],
  ['canais', 'Gerenciar canais', 'Criar, renomear e apagar canais de texto e de voz.'],
  ['expulsar', 'Expulsar membros', 'Tirar pessoas do servidor (menos admins e o dono).'],
  ['moderarVoz', 'Moderar a call', 'Silenciar a voz, desativar o áudio ou desconectar alguém da call.'],
  ['apagarMensagens', 'Apagar mensagens', 'Apagar mensagens dos outros nos canais.'],
  ['editarServidor', 'Editar o servidor', 'Trocar nome, cor e ícone do servidor.'],
  ['gerenciarCargos', 'Gerenciar cargos', 'Criar e editar cargos e dar cargos às pessoas (só com permissões que ele mesmo tem).'],
];
const CORES_DOS_CARGOS = ['#F07A1E', '#2EC4D3', '#6FCF97', '#F2C94C', '#F2777A', '#9B8AFB', '#E87BA4', '#B4B4BD'];

export function AbaCargos({ s }) {
  const escolhido = useSignal(null);   // id do cargo aberto, ou 'novo'
  const cargo = escolhido.value === 'novo' ? { nome: '', cor: CORES_DOS_CARGOS[0], permissoes: 0 } : s.cargos.find(item => item.id === escolhido.value);
  return (
    <div class="grid md:grid-cols-[200px_1fr] gap-4">
      <div class="space-y-1">
        <button class={`${botaoCinza} w-full flex items-center gap-2 !py-2`} onClick={() => { escolhido.value = 'novo'; }}><Plus size={15} /> Criar cargo</button>
        {s.cargos.length === 0 && <p class="text-xs text-slate-500 px-1 pt-2">Nenhum cargo ainda. Cargos dão permissões a quem não é admin (ex.: "Moderador" pode moderar a call).</p>}
        {s.cargos.map(item => (
          <button key={item.id} onClick={() => { escolhido.value = item.id; }}
            class={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-left ${escolhido.value === item.id ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/50'}`}>
            <span class="w-3 h-3 rounded-full flex-shrink-0" style={{ background: item.cor }} />
            <span class="truncate flex-1">{item.nome}</span>
            <span class="text-[11px] text-slate-500">{Object.values(s.cargosDosMembros || {}).filter(lista => lista.includes(item.id)).length}</span>
          </button>
        ))}
      </div>
      {cargo ? <EditorDeCargo key={escolhido.value} s={s} cargo={cargo} novo={escolhido.value === 'novo'} aoTerminar={() => { escolhido.value = null; }} />
        : <p class="text-sm text-slate-400">Escolha um cargo para editar, ou crie um novo. Para dar um cargo a alguém, vá na aba "Membros".</p>}
    </div>
  );
}

function EditorDeCargo({ s, cargo, novo, aoTerminar }) {
  const nome = useSignal(cargo.nome);
  const cor = useSignal(cargo.cor);
  const permissoes = useSignal(cargo.permissoes);
  const minhas = s.permissoes || 0;
  function salvar(evento) {
    evento.preventDefault();
    enviar({ t: novo ? 'cargo-criar' : 'cargo-editar', servidor: s.id, cargo: novo ? undefined : cargo.id, nome: nome.value, cor: cor.value, permissoes: permissoes.value });
    if (novo) aoTerminar();
  }
  return (
    <form onSubmit={salvar} class="space-y-4">
      <label class="block">
        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Nome do cargo</span>
        <input required maxLength={32} value={nome.value} onInput={evento => { nome.value = evento.currentTarget.value; }} class={`${campo} mt-1`} placeholder="Ex.: Moderador" />
      </label>
      <div>
        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Cor</span>
        <div class="mt-1 flex gap-2" role="radiogroup" aria-label="Cor do cargo">
          {CORES_DOS_CARGOS.map(opcao => (
            <button type="button" key={opcao} role="radio" aria-checked={cor.value === opcao} aria-label={opcao} onClick={() => { cor.value = opcao; }}
              class={`w-7 h-7 rounded-full ${cor.value === opcao ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''}`} style={{ background: opcao }} />
          ))}
        </div>
      </div>
      <div class="space-y-1">
        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Permissões</span>
        {NOMES_DAS_PERMISSOES.map(([chave, titulo, explicacao]) => {
          const bit = PERMISSOES[chave];
          const tenho = (minhas & bit) === bit;
          return (
            <label key={chave} class={`flex items-start gap-3 p-2.5 rounded-xl border border-slate-800/80 ${tenho ? 'cursor-pointer hover:bg-slate-800/40' : 'opacity-40'}`}>
              <input type="checkbox" disabled={!tenho} checked={(permissoes.value & bit) === bit} class="mt-1 w-4 h-4 accent-brand-500"
                onChange={evento => { permissoes.value = evento.currentTarget.checked ? permissoes.value | bit : permissoes.value & ~bit; }} />
              <span><b class="block text-sm text-white">{titulo}</b><span class="text-xs text-slate-400">{explicacao}</span></span>
            </label>
          );
        })}
      </div>
      <div class="flex gap-2">
        <button class={`${botaoPrincipal} flex items-center gap-2`}><Save size={15} /> {novo ? 'Criar cargo' : 'Salvar'}</button>
        {!novo && (
          <button type="button" class={`${botaoCinza} flex items-center gap-2 !text-red-300`}
            onClick={() => { if (confirm(`Apagar o cargo "${cargo.nome}"? Quem tem ele perde as permissões.`)) { enviar({ t: 'cargo-apagar', servidor: s.id, cargo: cargo.id }); aoTerminar(); } }}>
            <Trash2 size={15} /> Apagar
          </button>
        )}
      </div>
    </form>
  );
}

/** Etiquetas dos cargos de uma pessoa e o menu para dar/tirar (só para quem pode gerenciar cargos). */
export function CargosDoMembro({ s, uid, podeMexer }) {
  const meus = (s.cargosDosMembros || {})[uid] || [];
  const aberto = useSignal(false);
  const cargosDaPessoa = s.cargos.filter(cargo => meus.includes(cargo.id));
  return (
    <div class="relative flex flex-wrap items-center gap-1 mt-0.5">
      {cargosDaPessoa.map(cargo => (
        <span key={cargo.id} class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-200">
          <span class="w-2 h-2 rounded-full" style={{ background: cargo.cor }} /> {cargo.nome}
        </span>
      ))}
      {podeMexer && s.cargos.length > 0 && (
        <button type="button" title="Dar ou tirar cargos" aria-label="Dar ou tirar cargos" class="p-0.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-700"
          onClick={() => { aberto.value = !aberto.value; }}><Tag size={12} /></button>
      )}
      {aberto.value && (
        <>
          <div class="fixed inset-0 z-10" onClick={() => { aberto.value = false; }} />
          <div class="absolute left-0 top-full mt-1 z-20 w-52 bg-slate-950 border border-slate-800 rounded-lg shadow-2xl p-1.5" role="menu">
            {s.cargos.map(cargo => {
              const tem = meus.includes(cargo.id);
              return (
                <label key={cargo.id} class="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-slate-200 hover:bg-slate-800 cursor-pointer">
                  <input type="checkbox" checked={tem} class="accent-brand-500"
                    onChange={() => enviar({ t: tem ? 'cargo-tirar' : 'cargo-dar', servidor: s.id, cargo: cargo.id, uid })} />
                  <span class="w-2.5 h-2.5 rounded-full" style={{ background: cargo.cor }} /> <span class="truncate">{cargo.nome}</span>
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
