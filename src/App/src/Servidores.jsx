import { useSignal, signal } from '@preact/signals';
import { Download, Plus, Shield, Link2, Settings, LogOut, ChevronDown, Crown, Copy, RefreshCw, Trash2, UserMinus, ShieldCheck, ShieldOff, X } from 'lucide-preact';
import { eu, membros, servidores, servidorAtual, servidorSelecionado, abrirServidor, enviar, aviso, naoLidos, canais, raiz, abrirMensagensDiretas, temConversaDiretaNaoLida, SERVIDOR_DAS_CONVERSAS_DIRETAS, posso, PERMISSOES } from './store.js';
import { AbaCargos, CargosDoMembro } from './Cargos.jsx';

// A atualização do app do Windows (botão verde e balão) fica em Atualizacao.jsx.
import { Avatar, Dialogo, NoTopo, campo, botaoVermelho, botaoCinza } from './ui.jsx';
import { android } from './voz.js';

/**
 * Celular: o Android não deixa o app se atualizar sozinho. Quando o site tem APK novo, aparece a faixa; tocando,
 * o app baixa e abre a tela "Atualizar este app?" do Android. App antigo (sem a função) não mostra nada.
 */
const apkNovo = signal(null);      // versão
const baixandoApk = signal(null);  // 0..100 enquanto baixa
android?.atualizacao?.().then(r => { apkNovo.value = r?.versao || null; }).catch(() => {});
android?.aoEvento?.((evento, dados) => { if (evento === 'atualizacao') baixandoApk.value = dados.pct; });

export function AtualizacaoCelular() {
  const fechada = useSignal(false);
  if (!apkNovo.value || fechada.value) return null;
  const atualizar = () => {
    baixandoApk.value = 0;
    android.atualizar()
      .then(() => { aviso.value = 'Confirme em "Atualizar" na tela do Android.'; })
      .catch(e => { aviso.value = 'Não deu para atualizar: ' + e.message; })
      .finally(() => { baixandoApk.value = null; });
  };
  const pct = baixandoApk.value;
  return (
    <div class="flex items-center gap-2 px-3 py-2 bg-emerald-700/90 text-white text-sm">
      <Download size={16} class="flex-shrink-0" />
      <span class="flex-1">{pct != null ? `Baixando a versão ${apkNovo.value}… ${pct}%` : `Versão ${apkNovo.value} do app disponível`}</span>
      {pct == null && <button class="font-bold bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1" onClick={atualizar}>Atualizar</button>}
      {pct == null && <button title="Agora não" class="p-1 hover:bg-white/20 rounded-lg" onClick={() => { fechada.value = true; }}><X size={16} /></button>}
    </div>
  );
}

export const CORES = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

/** Ícone do servidor: imagem (Sacanas = Jorginho), emoji, ou a inicial na cor dele. */
export function IconeServidor({ s, tamanho = 'w-12 h-12 text-lg' }) {
  if (s.icone?.startsWith('/')) return <img src={s.icone} alt={s.nome} class={`${tamanho} rounded-2xl object-cover`} />;
  return (
    <div class={`${tamanho} rounded-2xl flex items-center justify-center font-black text-white keep-white`} style={{ background: s.cor }}>
      {s.icone || [...s.nome][0].toUpperCase()}
    </div>
  );
}

/** Barra da esquerda (igual Discord): servidores, "+" para criar/entrar e o painel do admin do app. */
export function BarraServidores({ aoAbrirAdminApp, celular = false }) {
  const novo = useSignal(false);
  return (
    <nav class={`${celular ? 'flex sm:hidden' : 'hidden sm:flex'} w-[72px] flex-shrink-0 flex-col items-center gap-2 py-3 bg-slate-950/80 border-r border-slate-800/80 overflow-y-auto`}>
      {/* Logo do Caocorde (Jorginho + Dobby), no lugar do logo do Discord: abre as mensagens diretas (como no Discord).
          Convidado não tem mensagens diretas: para ele o logo só volta para o servidor. */}
      {(() => {
        const ehConvidado = !!eu.value?.convidadoAte;
        const ativo = !ehConvidado && servidorAtual.value === SERVIDOR_DAS_CONVERSAS_DIRETAS;
        return (
          <button title={ehConvidado ? 'Caocorde' : 'Mensagens diretas'} aria-label={ehConvidado ? 'Caocorde' : 'Mensagens diretas'}
            onClick={() => (ehConvidado ? servidores.value[0] && abrirServidor(servidores.value[0].id) : abrirMensagensDiretas())}
            class="group relative w-12 h-12 flex-shrink-0">
            <span class={`absolute -left-3 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-white transition-all ${ativo ? 'h-10' : temConversaDiretaNaoLida.value ? 'h-2' : 'h-0 group-hover:h-5'}`} />
            <span class={`block w-12 h-12 overflow-hidden shadow-lg shadow-brand-500/30 transition-all ${ativo ? 'rounded-2xl' : 'rounded-3xl group-hover:rounded-2xl'}`}>
              <img src="/img/icone-caocorde.svg" alt="" class="w-full h-full scale-110" />
            </span>
            {temConversaDiretaNaoLida.value && !ativo && <span class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 border-[3px] border-slate-950" aria-label="mensagem direta nova" />}
          </button>
        );
      })()}
      <div class="w-8 h-0.5 rounded-full bg-slate-800 my-1 flex-shrink-0" />
      {servidores.value.map(s => {
        const ativo = s.id === servidorAtual.value;
        const novidade = !ativo && canais.value.some(c => c.servidor === s.id && naoLidos.value.has(c.id));
        return (
          <button key={s.id} title={s.nome} onClick={() => abrirServidor(s.id)} class="relative group">
            <span class={`absolute -left-3 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-white transition-all ${ativo ? 'h-10' : novidade ? 'h-2' : 'h-0 group-hover:h-5'}`} />
            <div class={`overflow-hidden transition-all ${ativo ? 'rounded-2xl ring-2 ring-brand-500' : 'rounded-3xl group-hover:rounded-2xl'}`}>
              <IconeServidor s={s} />
            </div>
          </button>
        );
      })}
      <div class="w-8 h-0.5 rounded-full bg-slate-800 my-1" />
      {/* Convidado não cria nem entra em outros servidores. */}
      {!eu.value?.convidadoAte && (
        <button title="Criar ou entrar num servidor" onClick={() => { novo.value = true; }}
          class="w-12 h-12 rounded-3xl hover:rounded-2xl bg-slate-800/80 text-emerald-400 hover:bg-emerald-600 hover:text-white flex items-center justify-center transition-all">
          <Plus size={22} />
        </button>
      )}
      {eu.value?.admin && (
        <button title="Painel do admin do app" onClick={aoAbrirAdminApp}
          class="w-12 h-12 rounded-3xl hover:rounded-2xl bg-slate-800/80 text-amber-400 hover:bg-amber-500 hover:text-slate-950 flex items-center justify-center transition-all mt-auto">
          <Shield size={20} />
        </button>
      )}
      {novo.value && <DialogoNovoServidor onFechar={() => { novo.value = false; }} />}
    </nav>
  );
}

/** Nome do servidor no topo da lista de canais, com o menu (convidar, configurações, sair). */
export function CabecalhoServidor() {
  const s = servidorSelecionado.value;
  const aberto = useSignal(false);
  const dialogo = useSignal(null);   // 'convite' | 'config'
  if (!s) return <div class="h-14 flex-shrink-0 border-b border-slate-800/80" />;
  const item = 'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-left';
  return (
    <div class="relative h-14 flex-shrink-0 border-b border-slate-800/80">
      <button class="w-full h-full px-4 flex items-center gap-2 hover:bg-slate-800/40 transition-colors" onClick={() => { aberto.value = !aberto.value; }}>
        <h1 class="font-black text-white tracking-tight truncate">{s.nome}</h1>
        {s.dono === eu.value.id && <Crown size={13} class="text-amber-400 flex-shrink-0" />}
        <ChevronDown size={16} class={`ml-auto text-slate-400 transition-transform ${aberto.value ? 'rotate-180' : ''}`} />
      </button>
      {aberto.value && (
        <>
          <div class="fixed inset-0 z-30" onClick={() => { aberto.value = false; }} />
          <div class="absolute left-2 right-2 top-full mt-1 z-40 bg-slate-900/95 border border-slate-800/80 rounded-xl shadow-2xl p-1.5 animate-fade-in">
            {posso(s, PERMISSOES.convidar) && <button class={`${item} text-sky-300 hover:bg-sky-600 hover:text-white`} onClick={() => { aberto.value = false; dialogo.value = 'convite'; }}><Link2 size={15} /> Convidar pessoas</button>}
            {(s.admin || (s.permissoes & (PERMISSOES.editarServidor | PERMISSOES.gerenciarCargos | PERMISSOES.expulsar | PERMISSOES.convidar))) ? <button class={`${item} text-slate-200 hover:bg-slate-800`} onClick={() => { aberto.value = false; dialogo.value = 'config'; }}><Settings size={15} /> Configurações do servidor</button> : null}
            {s.dono !== eu.value.id && (
              <button class={`${item} text-red-400 hover:bg-red-600 hover:text-white`} onClick={() => {
                aberto.value = false;
                if (confirm(`Sair do servidor "${s.nome}"?`)) enviar({ t: 'servidor-sair', id: s.id });
              }}><LogOut size={15} /> Sair do servidor</button>
            )}
            {!s.admin && s.dono === eu.value.id && <p class="text-xs text-slate-400 px-3 py-2">Você é o dono.</p>}
          </div>
        </>
      )}
      {dialogo.value === 'convite' && <DialogoConvite s={s} onFechar={() => { dialogo.value = null; }} />}
      {dialogo.value === 'config' && <PainelServidor s={s} onFechar={() => { dialogo.value = null; }} />}
    </div>
  );
}

export function DialogoNovoServidor({ onFechar, abaInicial = 'criar' }) {
  const aba = useSignal(abaInicial);
  const cor = useSignal(CORES[Math.floor(Math.random() * CORES.length)]);
  function enviarForm(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    if (aba.value === 'criar') enviar({ t: 'servidor-criar', nome: f.get('nome'), icone: f.get('icone'), cor: cor.value });
    else enviar({ t: 'servidor-entrar', convite: String(f.get('convite')).trim().split(/[=/]/).pop() });
    onFechar();
  }
  const chip = a => `flex-1 py-2 rounded-lg text-xs font-bold ${aba.value === a ? 'bg-slate-100 text-slate-900' : 'text-slate-300 hover:bg-slate-800'}`;
  return (
    <Dialogo titulo="Servidores" onFechar={onFechar}>
      <div class="flex gap-1 bg-slate-950/50 p-1 rounded-xl">
        <button class={chip('criar')} onClick={() => { aba.value = 'criar'; }}>Criar um servidor</button>
        <button class={chip('entrar')} onClick={() => { aba.value = 'entrar'; }}>Entrar com convite</button>
      </div>
      <form onSubmit={enviarForm} class="space-y-3">
        {aba.value === 'criar' ? (
          <>
            <input name="nome" required autoFocus maxLength={40} placeholder="Nome do servidor" class={campo} />
            <div class="flex items-center gap-2">
              <input name="icone" maxLength={4} placeholder="Emoji (opcional)" class={`${campo} w-36`} />
              <div class="flex gap-1.5 flex-wrap">
                {CORES.map(c => <button type="button" key={c} onClick={() => { cor.value = c; }} class={`w-6 h-6 rounded-full ${cor.value === c ? 'ring-2 ring-white' : ''}`} style={{ background: c }} />)}
              </div>
            </div>
          </>
        ) : (
          <input name="convite" required autoFocus maxLength={200} placeholder="Código ou link do convite" class={campo} />
        )}
        <div class="flex justify-end gap-2">
          <button type="button" class={botaoCinza} onClick={onFechar}>Cancelar</button>
          <button class={botaoVermelho}>{aba.value === 'criar' ? 'Criar' : 'Entrar'}</button>
        </div>
      </form>
    </Dialogo>
  );
}

const linkConvite = codigo => `${location.origin}${raiz}?convite=${codigo}`;

function copiar(texto) {
  navigator.clipboard?.writeText(texto).then(() => { aviso.value = 'Copiado ✓'; }, () => { aviso.value = texto; });
}

function DialogoConvite({ s: inicial, onFechar }) {
  const s = servidores.value.find(x => x.id === inicial.id) || inicial;   // atualiza ao gerar outro código
  return (
    <Dialogo titulo={`Convidar para ${s.nome}`} onFechar={onFechar}>
      <p class="text-xs text-slate-400">Mande o link (ou só o código) para quem já tem conta no Caocorde: ela entra direto no servidor. Quem não tem conta precisa primeiro pedir acesso ao app.</p>
      <div class="flex gap-2">
        <input readOnly value={linkConvite(s.convite)} class={`${campo} text-xs`} onFocus={e => e.currentTarget.select()} />
        <button class={botaoVermelho} title="Copiar link" onClick={() => copiar(linkConvite(s.convite))}><Copy size={16} /></button>
      </div>
      <div class="flex items-center justify-between text-xs text-slate-400">
        <span>Código: <b class="text-slate-200 font-mono tracking-wider">{s.convite}</b></span>
        <button class="flex items-center gap-1 hover:text-white" onClick={() => { if (confirm('Gerar um código novo? O antigo para de funcionar.')) enviar({ t: 'servidor-convite-novo', id: s.id }); }}>
          <RefreshCw size={12} /> Gerar outro
        </button>
      </div>
    </Dialogo>
  );
}

/** Painel do admin do servidor: nome/ícone/cor, membros (admin, expulsar, passar o servidor), convite e apagar. */
function PainelServidor(props) { return <NoTopo><PainelServidorConteudo {...props} /></NoTopo>; }

function PainelServidorConteudo({ s: inicial, onFechar }) {
  const s = servidores.value.find(x => x.id === inicial.id) || inicial;   // sempre a versão mais nova (membros mudam)
  const aba = useSignal('geral');
  const cor = useSignal(s.cor);
  const souDono = s.dono === eu.value.id;
  const podeEditar = posso(s, PERMISSOES.editarServidor);
  const podeConvidar = posso(s, PERMISSOES.convidar);
  const podeCargos = posso(s, PERMISSOES.gerenciarCargos);
  const podeExpulsar = posso(s, PERMISSOES.expulsar);
  if (aba.value === 'geral' && !podeEditar) aba.value = 'membros';
  const abaBtn = a => `w-full text-left px-3 py-2 rounded-lg text-sm font-semibold ${aba.value === a ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'}`;

  function salvar(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    enviar({ t: 'servidor-editar', id: s.id, nome: f.get('nome'), icone: f.get('icone'), cor: cor.value });
    aviso.value = 'Salvo ✓';
  }
  const acao = (uid, a, pergunta) => { if (!pergunta || confirm(pergunta)) enviar({ t: 'servidor-membro', id: s.id, uid, acao: a }); };

  return (
    <div class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onFechar()}>
      <div class="w-full max-w-3xl h-[80vh] flex bg-slate-900/95 border border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
        <aside class="w-48 flex-shrink-0 p-3 space-y-1 bg-slate-950/60 border-r border-slate-800/80">
          <div class="px-3 pb-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-500 truncate">{s.nome}</div>
          {podeEditar && <button class={abaBtn('geral')} onClick={() => { aba.value = 'geral'; }}>Visão geral</button>}
          <button class={abaBtn('membros')} onClick={() => { aba.value = 'membros'; }}>Membros ({s.membros.length})</button>
          {podeCargos && <button class={abaBtn('cargos')} onClick={() => { aba.value = 'cargos'; }}>Cargos ({(s.cargos || []).length})</button>}
          {podeConvidar && <button class={abaBtn('convite')} onClick={() => { aba.value = 'convite'; }}>Convite</button>}
          {(souDono || eu.value.admin) && s.id !== 1 && <button class={abaBtn('perigo')} onClick={() => { aba.value = 'perigo'; }}>Apagar servidor</button>}
        </aside>
        <section class="flex-1 min-w-0 flex flex-col">
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-800/80">
            <h2 class="text-sm font-extrabold uppercase tracking-wider text-white">Configurações do servidor</h2>
            <button class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" onClick={onFechar}><X size={18} /></button>
          </div>
          <div class="flex-1 overflow-y-auto p-5">
            {aba.value === 'geral' && (
              <form onSubmit={salvar} class="space-y-4 max-w-md">
                <div class="flex items-center gap-4">
                  <IconeServidor s={{ ...s, cor: cor.value }} tamanho="w-16 h-16 text-2xl" />
                  <div class="text-xs text-slate-400">{s.id === 1 ? 'O ícone do Sacanas é o Jorginho 🐱' : 'Emoji ou a inicial do nome, na cor escolhida.'}</div>
                </div>
                <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Nome
                  <input name="nome" maxLength={40} defaultValue={s.nome} class={`${campo} mt-1`} />
                </label>
                {s.id !== 1 && (
                  <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Emoji
                    <input name="icone" maxLength={4} defaultValue={s.icone || ''} class={`${campo} mt-1 w-32`} />
                  </label>
                )}
                <div class="flex gap-2">
                  {CORES.map(c => <button type="button" key={c} onClick={() => { cor.value = c; }} class={`w-7 h-7 rounded-full ${cor.value === c ? 'ring-2 ring-white' : ''}`} style={{ background: c }} />)}
                </div>
                <button class={botaoVermelho}>Salvar</button>
              </form>
            )}

            {aba.value === 'cargos' && podeCargos && <AbaCargos s={s} />}

            {aba.value === 'membros' && (
              <div class="space-y-1">
                {s.membros.map(uid => {
                  const m = membros.value.get(uid);
                  const ehDono = uid === s.dono, ehAdmin = s.admins.includes(uid);
                  return (
                    <div key={uid} class="group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-800/50">
                      <Avatar membro={m} tamanho="w-9 h-9 text-sm" presenca />
                      <div class="min-w-0 flex-1">
                        <div class="text-sm font-bold text-white truncate flex items-center gap-1.5">
                          {m?.nome || '?'} {ehDono && <Crown size={13} class="text-amber-400" />} {!ehDono && ehAdmin && <ShieldCheck size={13} class="text-sky-400" />}
                        </div>
                        <div class="text-[11px] text-slate-400">@{m?.usuario} · {ehDono ? 'dono' : ehAdmin ? 'admin' : 'membro'}</div>
                        <CargosDoMembro s={s} uid={uid} podeMexer={podeCargos} />
                      </div>
                      {!ehDono && uid !== eu.value.id && (
                        <div class="flex items-center gap-1 opacity-60 group-hover:opacity-100">
                          {s.admin && (ehAdmin
                            ? <button title="Tirar admin" class="p-1.5 rounded-lg text-slate-300 hover:bg-slate-700" onClick={() => acao(uid, 'tirar-admin')}><ShieldOff size={15} /></button>
                            : <button title="Tornar admin" class="p-1.5 rounded-lg text-sky-300 hover:bg-slate-700" onClick={() => acao(uid, 'admin')}><ShieldCheck size={15} /></button>)}
                          {(souDono || eu.value.admin) && <button title="Passar o servidor (vira dono)" class="p-1.5 rounded-lg text-amber-300 hover:bg-slate-700" onClick={() => acao(uid, 'dono', `Passar o servidor para ${m?.nome}? Você continua como admin.`)}><Crown size={15} /></button>}
                          {podeExpulsar && (s.admin || !ehAdmin) && <button title="Expulsar" class="p-1.5 rounded-lg text-red-400 hover:bg-slate-700" onClick={() => acao(uid, 'expulsar', `Expulsar ${m?.nome} do servidor?`)}><UserMinus size={15} /></button>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {aba.value === 'convite' && (
              <div class="space-y-3 max-w-md">
                <p class="text-sm text-slate-300">Quem já tem conta no Caocorde e tiver o código ou o link entra no servidor. Sem conta, o link mostra que precisa pedir acesso ao app primeiro.</p>
                <div class="flex gap-2">
                  <input readOnly value={linkConvite(s.convite)} class={`${campo} text-xs`} onFocus={e => e.currentTarget.select()} />
                  <button class={botaoVermelho} onClick={() => copiar(linkConvite(s.convite))}><Copy size={16} /></button>
                </div>
                <div class="text-sm text-slate-400">Código: <b class="text-white font-mono tracking-wider">{s.convite}</b></div>
                <button class={`${botaoCinza} flex items-center gap-2`} onClick={() => { if (confirm('Gerar um link novo? O antigo para de funcionar.')) enviar({ t: 'servidor-convite-novo', id: s.id }); }}>
                  <RefreshCw size={15} /> Gerar outro link
                </button>
                <CodigosTemporarios s={s} />
              </div>
            )}

            {aba.value === 'perigo' && (
              <div class="space-y-3 max-w-md">
                <p class="text-sm text-slate-300">Apaga o servidor com todos os canais e mensagens. Não tem volta.</p>
                <button class="bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl px-4 py-2.5 text-sm flex items-center gap-2" onClick={() => {
                  const nome = prompt(`Para confirmar, digite o nome do servidor: ${s.nome}`);
                  if (nome === s.nome) { enviar({ t: 'servidor-apagar', id: s.id }); onFechar(); }
                }}><Trash2 size={15} /> Apagar "{s.nome}"</button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const restante = ms => {
  const min = Math.max(0, Math.round(ms / 60000));
  return min >= 1440 ? `${Math.round(min / 1440)} d` : min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`;
};

/** Link do convite de convidado (abre a tela de entrar só com o nome, no navegador). */
const linkDeConvidado = codigo => `${location.origin}${raiz === '/' ? '/' : `${raiz}/`}?convidado=${codigo}`;

/**
 * Códigos de 6 números (igual 2FA), em dois tipos:
 *  - CONTA: para quem baixou o app sem link — a pessoa digita o código ao criar a conta (vale de 1 h a 7 dias);
 *  - CONVIDADO: acesso temporário só pelo navegador, sem criar conta — a pessoa abre o link e escolhe só o nome
 *    (vale de 1 a 24 h; quando ela sai, o acesso e o chat de convidado somem). Regras: src/Cloudflare/src/convidados.js.
 * Os dois vencem sozinhos e têm limite de quantas pessoas podem usar.
 */
function CodigosTemporarios({ s }) {
  const tipo = useSignal('conta');   // 'conta' | 'convidado'
  const horas = useSignal(24);
  const usos = useSignal(1);
  const sel = 'bg-slate-800/80 border border-slate-700/80 rounded-lg px-2 py-1.5 text-xs text-slate-100';
  const duracoes = tipo.value === 'convidado' ? [1, 3, 6, 12, 24] : [1, 3, 6, 12, 24, 168];
  const escolherTipo = novoTipo => { tipo.value = novoTipo; if (novoTipo === 'convidado' && horas.value > 24) horas.value = 3; };
  return (
    <div class="pt-4 mt-2 border-t border-slate-800/80 space-y-3">
      <div>
        <h3 class="text-sm font-extrabold text-white">Convites com prazo</h3>
        <p class="text-xs text-slate-400">Código de 6 números que vence sozinho. Escolha o tipo:</p>
      </div>
      <div role="radiogroup" aria-label="Tipo de convite" class="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-800/80 border border-slate-700/80">
        {[['conta', 'Entrar no servidor'], ['convidado', 'Convidado (sem conta)']].map(([valor, rotulo]) => (
          <button key={valor} type="button" role="radio" aria-checked={tipo.value === valor} onClick={() => escolherTipo(valor)}
            class={`rounded-lg px-2 py-1.5 text-xs font-bold ${tipo.value === valor ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>{rotulo}</button>
        ))}
      </div>
      <p class="text-xs text-slate-400">
        {tipo.value === 'convidado'
          ? 'A pessoa abre o link no navegador e escolhe só o nome. Pode entrar nas calls, assistir lives e conversar num chat de convidado (todos do servidor veem). Quando ela sai, ou o tempo acaba, o acesso e o chat são apagados.'
          : 'Para quem já tem conta: a pessoa digita o código em "+" → "Entrar com convite".'}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <select class={sel} aria-label="Quanto tempo vale" value={horas.value} onChange={e => { horas.value = Number(e.currentTarget.value); }}>
          {duracoes.map(duracao => <option key={duracao} value={duracao}>{duracao === 168 ? 'vale 7 dias' : `vale ${duracao} hora${duracao > 1 ? 's' : ''}`}</option>)}
        </select>
        <select class={sel} aria-label="Quantas pessoas podem usar" value={usos.value} onChange={e => { usos.value = Number(e.currentTarget.value); }}>
          <option value={1}>1 pessoa</option><option value={5}>até 5 pessoas</option><option value={0}>sem limite</option>
        </select>
        <button class={`${botaoVermelho} !py-1.5 text-xs`} onClick={() => enviar({ t: 'codigo-criar', id: s.id, horas: horas.value, usos: usos.value, convidado: tipo.value === 'convidado' })}>Gerar</button>
      </div>
      {(s.codigos || []).length === 0 ? <p class="text-xs text-slate-500">Nenhum convite ativo.</p> : (
        <div class="space-y-1.5">
          {s.codigos.map(c => (
            <div key={c.codigo} class="flex items-center gap-3 bg-slate-950/50 rounded-xl px-3 py-2">
              <b class="font-mono text-lg tracking-[0.3em] text-white">{c.codigo.slice(0, 3)} {c.codigo.slice(3)}</b>
              <span class="text-[11px] text-slate-400 flex-1">
                {c.convidado ? <b class="text-brand-300">convidado · </b> : null}
                vence em {restante(c.expira - Date.now())} · {c.usos_max ? `${c.usos}/${c.usos_max} usos` : `${c.usos} usos`}
              </span>
              <button title={c.convidado ? 'Copiar o link de convidado' : 'Copiar'} class="p-1.5 rounded-lg text-slate-300 hover:bg-slate-800"
                onClick={() => copiar(c.convidado ? linkDeConvidado(c.codigo) : c.codigo)}>{c.convidado ? <Link2 size={14} /> : <Copy size={14} />}</button>
              <button title="Cancelar código" class="p-1.5 rounded-lg text-red-400 hover:bg-slate-800" onClick={() => enviar({ t: 'codigo-apagar', id: s.id, codigo: c.codigo })}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
