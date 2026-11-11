import { useSignal } from '@preact/signals';
import { Copy, Trash2, Check, X, Ticket, Link2, UserRoundPlus, Hash, Clock } from 'lucide-preact';
import { enviar, aviso, conviteCriadoNoPainel } from './store.js';
import { campo, botaoPrincipal, botaoCinza } from './ui.jsx';

// Abas "Convites" e "Pedidos" do painel do admin do app (servidor: src/Cloudflare/src/acessoAoApp.js).

const TIPOS = [
  { id: 'app', titulo: 'Convite para o app', explicacao: 'Cria a conta. A pessoa começa sem servidor.', Icone: Link2 },
  { id: 'servidor', titulo: 'App + servidor', explicacao: 'Cria a conta e já coloca num servidor.', Icone: UserRoundPlus },
  { id: 'convidado', titulo: 'Conta temporária', explicacao: 'Convidado: entra só com o nome, pelo navegador. Some quando sai.', Icone: Clock },
  { id: 'codigo', titulo: 'Só o código', explicacao: 'Igual ao do app, mas sem link: para passar o código por mensagem.', Icone: Hash },
];
const nomeDoTipo = tipo => TIPOS.find(item => item.id === tipo)?.titulo || tipo;
const dataHora = ts => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Link que vai junto com o código (o "só o código" não tem link). */
function linkDoConvite(tipo, codigo) {
  if (tipo === 'codigo') return null;
  return tipo === 'convidado' ? `${location.origin}/?convidado=${codigo}` : `${location.origin}/?acesso=${codigo}`;
}
const copiar = texto => navigator.clipboard?.writeText(texto).then(() => { aviso.value = 'Copiado ✓'; });

export function AbaConvites({ dados }) {
  const tipo = useSignal('app');
  const servidor = useSignal(dados.servidores[0]?.id || '');
  const quantidade = useSignal(1);
  const unidade = useSignal('dias');
  const pessoas = useSignal(1);
  const semLimite = useSignal(false);

  const ehConvidado = tipo.value === 'convidado';
  const precisaDeServidor = tipo.value === 'servidor' || ehConvidado;
  const horas = Number(quantidade.value) * (unidade.value === 'dias' ? 24 : 1);

  function gerar(evento) {
    evento.preventDefault();
    conviteCriadoNoPainel.value = null;
    enviar({ t: 'admin-acao', acao: 'convite-criar', tipo: tipo.value, servidor: precisaDeServidor ? Number(servidor.value) : null,
      horas, usos: semLimite.value && !ehConvidado ? 0 : Number(pessoas.value) });
  }
  const criado = conviteCriadoNoPainel.value;
  const linkCriado = criado && linkDoConvite(criado.tipo, criado.codigo);

  return (
    <div class="space-y-5">
      <form onSubmit={gerar} class="space-y-4 bg-slate-800/30 border border-slate-700/60 rounded-2xl p-4">
        <div class="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de convite">
          {TIPOS.map(({ id, titulo, explicacao, Icone }) => (
            <button type="button" key={id} role="radio" aria-checked={tipo.value === id} onClick={() => { tipo.value = id; if (id === 'convidado' && unidade.value === 'dias') { unidade.value = 'horas'; quantidade.value = 3; } }}
              class={`text-left p-3 rounded-xl border transition-all ${tipo.value === id ? 'border-brand-400 bg-brand-600/15' : 'border-slate-700/80 hover:bg-slate-800/60'}`}>
              <span class="flex items-center gap-2 text-sm font-bold text-white"><Icone size={15} class="text-brand-400" /> {titulo}</span>
              <span class="block text-[11px] text-slate-400 mt-0.5">{explicacao}</span>
            </button>
          ))}
        </div>
        {precisaDeServidor && (
          <label class="block">
            <span class="text-xs font-bold text-slate-300">Servidor</span>
            <select class={`${campo} mt-1`} value={servidor.value} onChange={evento => { servidor.value = evento.currentTarget.value; }}>
              {dados.servidores.map(item => <option key={item.id} value={item.id}>{item.nome}</option>)}
            </select>
          </label>
        )}
        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-xs font-bold text-slate-300">Vale por</span>
            <div class="mt-1 flex gap-2">
              <input type="number" min={1} max={ehConvidado ? 24 : unidade.value === 'dias' ? 30 : 720} required value={quantidade.value}
                onInput={evento => { quantidade.value = evento.currentTarget.value; }} class={`${campo} w-20`} />
              <select class={campo} value={unidade.value} onChange={evento => { unidade.value = evento.currentTarget.value; }}>
                <option value="horas">horas</option>
                {!ehConvidado && <option value="dias">dias</option>}
              </select>
            </div>
          </label>
          <label class="block">
            <span class="text-xs font-bold text-slate-300">Quantas pessoas</span>
            <input type="number" min={1} max={100} required={!semLimite.value} disabled={semLimite.value && !ehConvidado} value={pessoas.value}
              onInput={evento => { pessoas.value = evento.currentTarget.value; }} class={`${campo} mt-1 disabled:opacity-40`} />
            {!ehConvidado && (
              <span class="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                <input type="checkbox" checked={semLimite.value} onChange={evento => { semLimite.value = evento.currentTarget.checked; }} class="accent-brand-500" /> sem limite (até vencer)
              </span>
            )}
          </label>
        </div>
        <button class={`${botaoPrincipal} flex items-center gap-2`}><Ticket size={15} /> Gerar convite</button>
      </form>

      {criado && (
        <div class="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 space-y-2" role="status">
          <div class="text-xs font-bold uppercase tracking-wider text-emerald-300">{nomeDoTipo(criado.tipo)} criado</div>
          <div class="flex items-center gap-2">
            <span class="flex-1 text-2xl font-black tracking-[0.2em] text-white">{criado.codigo}</span>
            <button class={`${botaoCinza} !px-3 flex items-center gap-1.5`} onClick={() => copiar(criado.codigo)}><Copy size={14} /> Código</button>
            {linkCriado && <button class={`${botaoCinza} !px-3 flex items-center gap-1.5`} onClick={() => copiar(linkCriado)}><Link2 size={14} /> Link</button>}
          </div>
          {linkCriado && <div class="text-[11px] text-slate-400 break-all">{linkCriado}</div>}
        </div>
      )}

      <div>
        <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-2">Convites ativos ({dados.convites.length})</h3>
        {!dados.convites.length && <p class="text-sm text-slate-500">Nenhum convite ativo.</p>}
        <div class="space-y-1">
          {dados.convites.map(convite => {
            const link = linkDoConvite(convite.tipo === 'app' || convite.tipo === 'servidor' || convite.tipo === 'convidado' ? convite.tipo : 'codigo', convite.codigo);
            return (
              <div key={convite.codigo} class="group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-800/50">
                <span class="font-black tracking-wider text-white w-28">{convite.codigo}</span>
                <div class="min-w-0 flex-1 text-[11px] text-slate-400">
                  <div class="text-xs font-bold text-slate-200">{nomeDoTipo(convite.tipo)}{convite.servidor ? ` · ${dados.servidores.find(item => item.id === convite.servidor)?.nome || '?'}` : ''}{convite.pedido ? ' · de um pedido' : ''}</div>
                  vence {dataHora(convite.expira)} · {convite.usos}/{convite.usosMax || '∞'} usos · por {convite.criadoPor || '?'}
                </div>
                <button title="Copiar o código" class="p-1.5 rounded-lg text-slate-300 hover:bg-slate-700" onClick={() => copiar(convite.codigo)}><Copy size={14} /></button>
                {link && <button title="Copiar o link" class="p-1.5 rounded-lg text-slate-300 hover:bg-slate-700" onClick={() => copiar(link)}><Link2 size={14} /></button>}
                <button title="Cancelar o convite" class="p-1.5 rounded-lg text-red-400 hover:bg-slate-700"
                  onClick={() => confirm(`Cancelar o convite ${convite.codigo}? Ele para de funcionar na hora.`) && enviar({ t: 'admin-acao', acao: 'convite-apagar', codigo: convite.codigo })}><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AbaPedidos({ dados }) {
  const servidorDoPedido = useSignal({});   // pedido → servidor escolhido (opcional)
  const pendentes = dados.pedidos.filter(pedido => pedido.estado === 'pendente');
  const decididos = dados.pedidos.filter(pedido => pedido.estado !== 'pendente');
  return (
    <div class="space-y-5">
      <p class="text-sm text-slate-400">Pedidos da página inicial. Aprovar manda um e-mail com o link de cadastro (código de uso único, vale 7 dias) e os links do app do Windows e do celular.</p>
      {!pendentes.length && <p class="text-sm text-slate-500">Nenhum pedido esperando resposta.</p>}
      {pendentes.map(pedido => (
        <div key={pedido.id} class="p-4 rounded-2xl bg-slate-800/40 border border-slate-700/60 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <b class="text-sm text-white break-all">{pedido.email}</b>
            <span class="text-[11px] text-slate-500 flex-shrink-0">{dataHora(pedido.criado)}</span>
          </div>
          <div class="text-xs text-slate-300"><span class="text-slate-500">Indicado por:</span> {pedido.indicadoPor || <i class="text-slate-500">ninguém</i>}</div>
          <div class="text-xs text-slate-300 whitespace-pre-wrap break-words"><span class="text-slate-500">Como conhece / como quer ser reconhecido:</span> {pedido.comoConhece}</div>
          <div class="flex flex-wrap items-center gap-2 pt-1">
            <select class={`${campo} !w-auto !py-1.5 !text-xs`} value={servidorDoPedido.value[pedido.id] || ''}
              onChange={evento => { servidorDoPedido.value = { ...servidorDoPedido.value, [pedido.id]: evento.currentTarget.value }; }}>
              <option value="">Sem servidor (só a conta)</option>
              {dados.servidores.map(item => <option key={item.id} value={item.id}>Já entra em: {item.nome}</option>)}
            </select>
            <button class={`${botaoPrincipal} !py-1.5 flex items-center gap-1.5`}
              onClick={() => confirm(`Aprovar ${pedido.email}? Vai um e-mail com o convite.`) && enviar({ t: 'admin-acao', acao: 'pedido-aprovar', pedido: pedido.id, servidor: Number(servidorDoPedido.value[pedido.id]) || null })}>
              <Check size={14} /> Aprovar
            </button>
            <button class={`${botaoCinza} !py-1.5 flex items-center gap-1.5 !text-red-300`}
              onClick={() => confirm(`Recusar o pedido de ${pedido.email}? (A pessoa não recebe e-mail.)`) && enviar({ t: 'admin-acao', acao: 'pedido-recusar', pedido: pedido.id })}>
              <X size={14} /> Recusar
            </button>
          </div>
        </div>
      ))}
      {!!decididos.length && (
        <div>
          <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-2">Já respondidos (últimos 60 dias)</h3>
          {decididos.map(pedido => (
            <div key={pedido.id} class="flex items-center gap-3 px-3 py-1.5 text-xs">
              <span class={`font-bold ${pedido.estado === 'aprovado' ? 'text-emerald-400' : 'text-red-400'}`}>{pedido.estado}</span>
              <span class="flex-1 truncate text-slate-300">{pedido.email}</span>
              {pedido.erroEmail && (
                <button class="text-amber-300 underline" title={pedido.erroEmail}
                  onClick={() => enviar({ t: 'admin-acao', acao: 'pedido-aprovar', pedido: pedido.id })}>e-mail falhou — mandar de novo</button>
              )}
              <span class="text-slate-500">{pedido.decididoPor} · {dataHora(pedido.decididoEm)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
