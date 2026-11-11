import { useSignal } from '@preact/signals';
import { IconeServidor } from './Servidores.jsx';

// Uso do mês por servidor (rosca): quanto cada servidor pesa no consumo do Cloudflare.
const METRICAS = {
  mb: { nome: 'Voz e vídeo', valor: s => s.mb, texto: v => v >= 1024 ? (v / 1024).toFixed(1) + ' GB' : Math.round(v) + ' MB' },
  voz: { nome: 'Tempo em call', valor: s => s.vozSeg, texto: v => v >= 3600 ? (v / 3600).toFixed(1) + ' h' : Math.round(v / 60) + ' min' },
  msgs: { nome: 'Mensagens', valor: s => s.mensagensMes, texto: v => String(v) },
};
const CORES = 7;   // a 8ª cor é "Outros"

const ponto = (r, a) => [50 + r * Math.sin(a), 50 - r * Math.cos(a)];
function fatia(a0, a1, r0 = 30, r1 = 46) {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
  const g = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = ponto(r1, a0), [x1, y1] = ponto(r1, a1), [x2, y2] = ponto(r0, a1), [x3, y3] = ponto(r0, a0);
  return 'M' + x0 + ' ' + y0 + 'A' + r1 + ' ' + r1 + ' 0 ' + g + ' 1 ' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 + 'A' + r0 + ' ' + r0 + ' 0 ' + g + ' 0 ' + x3 + ' ' + y3 + 'Z';
}

// ---------------- para onde vai o consumo (por tipo) ----------------
// O Cloudflare Realtime cobra o que SAI do SFU para quem recebe: 1.000 GB/mês grátis, depois US$ 0,05 por GB.
// Taxas iguais às do contarUso (comunidade.js), em MB por hora para cada pessoa recebendo.
const GRATIS_GB = 1000, US_POR_GB = 0.05;
const TIPOS = [
  { k: 'mbTela', nome: 'Transmissão de tela', cor: 'var(--s2)', explica: 'cada tela ao vivo vai para todo mundo da call — ~1,4 GB por hora para cada pessoa assistindo. É o que mais pesa.' },
  { k: 'mbCam', nome: 'Câmera', cor: 'var(--s1)', explica: 'cada câmera ligada vai para todo mundo da call — ~0,5 GB por hora para cada pessoa vendo.' },
  { k: 'mbVoz', nome: 'Voz', cor: 'var(--s3)', explica: 'cada um recebe a voz de todos os outros — só ~18 MB por hora por pessoa ouvindo alguém.' },
  { k: 'mbMusica', nome: 'Música (Jorginho DJ)', cor: 'var(--s4)', explica: 'o bot toca para todos da call — ~60 MB por hora por pessoa.' },
];
const gb = mb => mb / 1024;
const textoGB = mb => (mb >= 1024 ? (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + ' GB' : mb > 0 && mb < 1 ? 'menos de 1 MB' : Math.round(mb) + ' MB');
const dolar = v => 'US$ ' + v.toFixed(2).replace('.', ',');

export function ConsumoPorTipo({ servidores, mes }) {
  const soma = k => servidores.reduce((x, s) => x + (s[k] || 0), 0);
  const total = soma('mb');
  const tipos = TIPOS.map(t => ({ ...t, v: soma(t.k) }));
  // Uso de antes da 0.5.5 só tem o total (sem separar por tipo).
  const semDetalhe = Math.max(0, total - tipos.reduce((x, t) => x + t.v, 0));
  if (semDetalhe > 1) tipos.push({ k: 'sem', nome: 'Sem detalhe', cor: 'var(--s8)', v: semDetalhe, explica: 'uso de antes da versão 0.5.5, quando o app ainda não separava por tipo.' });
  const linhas = tipos.filter(t => t.v > 0).sort((a, b) => b.v - a.v);

  // Ritmo do mês: o que já foi gasto, esticado até o último dia.
  const hoje = new Date();
  const [ano, m] = (mes || '').split('-').map(Number);
  const diasNoMes = ano ? new Date(ano, m, 0).getDate() : 30;
  const diaAtual = ano && hoje.getFullYear() === ano && hoje.getMonth() + 1 === m ? Math.max(1, hoje.getDate()) : diasNoMes;
  const previsto = total / diaAtual * diasNoMes;
  const custo = mb => Math.max(0, gb(mb) - GRATIS_GB) * US_POR_GB;
  const usadoPct = Math.min(100, gb(total) / GRATIS_GB * 100);
  const pct = v => (total ? (v / total) * 100 : 0).toFixed(v / total < 0.1 ? 1 : 0) + '%';

  return (
    <div class="viz bg-slate-800/50 border border-slate-700/60 rounded-xl p-4 space-y-4">
      <div>
        <div class="text-sm font-extrabold text-white">Para onde vai o consumo</div>
        <div class="text-[11px] text-slate-400">Voz e vídeo do mês, somando todos os servidores. É a única parte do Cloudflare que pode passar do plano de US$ 5 (chat, fotos e anexos cabem nele).</div>
      </div>

      {/* Quanto dos 1.000 GB grátis já foi. */}
      <div class="space-y-1.5">
        <div class="flex items-baseline justify-between text-xs">
          <span class="text-slate-300"><b class="text-white text-base">{textoGB(total)}</b> de 1.000 GB grátis</span>
          <span class={`font-bold ${custo(total) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{custo(total) > 0 ? `Já passou: ${dolar(custo(total))}` : 'Grátis até agora'}</span>
        </div>
        <div class="h-2.5 rounded-full bg-slate-700/70 overflow-hidden">
          <div class={`h-full rounded-full ${usadoPct >= 100 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(usadoPct, total > 0 ? 1 : 0)}%` }} />
        </div>
        <div class="text-[11px] text-slate-400">
          No ritmo atual o mês fecha em <b class="text-slate-200">~{textoGB(previsto)}</b>
          {custo(previsto) > 0 ? <> → <b class="text-amber-400">~{dolar(custo(previsto))}</b> além dos US$ 5.</> : <> → <b class="text-emerald-400">continua grátis</b>.</>}
          {' '}(Passando de 1.000 GB, cada GB custa US$ 0,05.)
        </div>
      </div>

      {!total ? <p class="text-xs text-slate-400 py-2 text-center">Ninguém usou call neste mês ainda.</p> : (
        <>
          {/* Barra única dividida por tipo + tabela que explica cada pedaço. */}
          <div class="flex h-4 rounded-lg overflow-hidden gap-px bg-slate-900" role="img"
            aria-label={'Consumo por tipo: ' + linhas.map(t => `${t.nome} ${pct(t.v)}`).join(', ')}>
            {linhas.map(t => <div key={t.k} title={`${t.nome}: ${textoGB(t.v)} (${pct(t.v)})`} style={{ width: `${(t.v / total) * 100}%`, background: t.cor }} />)}
          </div>
          <table class="w-full text-xs">
            <tbody>
              {linhas.map(t => (
                <tr key={t.k} class="align-top border-t border-slate-700/40 first:border-0">
                  <td class="py-2 pr-2 w-3"><span class="block w-3 h-3 mt-0.5 rounded" style={{ background: t.cor }} /></td>
                  <td class="py-2 pr-3">
                    <div class="font-bold text-slate-200">{t.nome}</div>
                    <div class="text-[11px] text-slate-400 leading-snug">{t.explica}</div>
                  </td>
                  <td class="py-2 pr-2 text-right tabular-nums text-slate-300 whitespace-nowrap">{textoGB(t.v)}</td>
                  <td class="py-2 text-right tabular-nums font-black text-white w-12">{pct(t.v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p class="text-[10px] text-slate-500">É uma estimativa feita pelo app (tempo de call × câmeras × transmissões × quem assiste). O valor exato fica no painel do Cloudflare → Realtime.</p>
    </div>
  );
}

export function GraficoUso({ servidores, mes }) {
  const metrica = useSignal('mb');
  const foco = useSignal(null);
  const m = METRICAS[metrica.value];
  // A cor segue o servidor (ordem de criação), não a posição no ranking — trocar a métrica não repinta ninguém.
  const cor = new Map([...servidores].sort((a, b) => a.id - b.id).map((s, i) => [s.id, i < CORES ? 'var(--s' + (i + 1) + ')' : 'var(--s8)']));
  const linhas = servidores.map(s => ({ s, v: m.valor(s) || 0, cor: cor.get(s.id) })).filter(l => l.v > 0).sort((a, b) => b.v - a.v);
  const comCor = linhas.filter(l => l.cor !== 'var(--s8)');
  const outros = linhas.filter(l => l.cor === 'var(--s8)');
  const fatias = [...comCor, ...(outros.length ? [{ s: { id: 'outros', nome: 'Outros (' + outros.length + ')' }, v: outros.reduce((x, l) => x + l.v, 0), cor: 'var(--s8)' }] : [])];
  const total = fatias.reduce((x, l) => x + l.v, 0);
  let a = 0;
  const arcos = fatias.map(l => { const a0 = a; a += (l.v / total) * Math.PI * 2; return { ...l, a0, a1: a }; });
  const sel = arcos.find(l => l.s.id === foco.value);
  const pct = v => (total ? (v / total) * 100 : 0).toFixed(v / total < 0.1 ? 1 : 0) + '%';
  const nomeMes = mes ? new Date(mes + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';

  return (
    <div class="viz bg-slate-800/50 border border-slate-700/60 rounded-xl p-4 space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <div>
          <div class="text-sm font-extrabold text-white">Qual servidor gasta mais</div>
          <div class="text-[11px] text-slate-400">{nomeMes} · {m.nome.toLowerCase()}</div>
        </div>
        <div class="ml-auto flex gap-1">
          {Object.entries(METRICAS).map(([k, v]) => (
            <button key={k} onClick={() => { metrica.value = k; }}
              class={'text-[11px] font-bold px-2.5 py-1 rounded-lg ' + (metrica.value === k ? 'bg-brand-500 text-white keep-white' : 'text-slate-400 hover:bg-slate-700/80')}>{v.nome}</button>
          ))}
        </div>
      </div>

      {!total ? <p class="text-xs text-slate-400 py-6 text-center">Nenhum uso registrado neste mês ainda.</p> : (
        <div class="flex flex-col sm:flex-row items-center gap-5">
          <svg viewBox="0 0 100 100" class="w-44 h-44 flex-shrink-0" role="img" aria-label={'Uso por servidor: ' + arcos.map(l => l.s.nome + ' ' + pct(l.v)).join(', ')}>
            {arcos.map(l => (
              <path key={l.s.id} d={fatia(l.a0, l.a1, foco.value === l.s.id ? 28 : 30, foco.value === l.s.id ? 48 : 46)} fill={l.cor}
                stroke="var(--viz-fundo)" stroke-width="1" stroke-linejoin="round" class="cursor-pointer transition-all"
                opacity={foco.value && foco.value !== l.s.id ? 0.45 : 1}
                onMouseEnter={() => { foco.value = l.s.id; }} onMouseLeave={() => { foco.value = null; }}>
                <title>{l.s.nome + ': ' + m.texto(l.v) + ' (' + pct(l.v) + ')'}</title>
              </path>
            ))}
            <text x="50" y="48" text-anchor="middle" class="fill-current text-white" style="font-size:9px;font-weight:900">{sel ? pct(sel.v) : m.texto(total)}</text>
            <text x="50" y="59" text-anchor="middle" class="fill-current text-slate-400" style="font-size:5px;font-weight:700">{sel ? sel.s.nome.slice(0, 18) : 'total do mês'}</text>
          </svg>

          {/* Legenda = tabela: nome, valor e porcentagem de cada servidor (a cor nunca fica sozinha). */}
          <table class="flex-1 w-full text-xs">
            <tbody>
              {arcos.map(l => (
                <tr key={l.s.id} class={'cursor-default ' + (foco.value === l.s.id ? 'bg-slate-700/40' : '')}
                  onMouseEnter={() => { foco.value = l.s.id; }} onMouseLeave={() => { foco.value = null; }}>
                  <td class="py-1 pr-2 w-3"><span class="block w-3 h-3 rounded" style={{ background: l.cor }} /></td>
                  <td class="py-1 pr-2">
                    <div class="flex items-center gap-2 min-w-0">
                      {l.s.id !== 'outros' && <IconeServidor s={l.s} tamanho="w-5 h-5 text-[9px]" />}
                      <span class="font-bold text-slate-200 truncate">{l.s.nome}</span>
                    </div>
                  </td>
                  <td class="py-1 pr-2 text-right tabular-nums text-slate-400">{m.texto(l.v)}</td>
                  <td class="py-1 text-right tabular-nums font-black text-white w-12">{pct(l.v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {metrica.value === 'mb' && total > 0 && (
        <p class="text-[10px] text-slate-500">Mesma estimativa do quadro de cima, separada por servidor. Passe o mouse numa fatia para ver o valor.</p>
      )}
    </div>
  );
}
