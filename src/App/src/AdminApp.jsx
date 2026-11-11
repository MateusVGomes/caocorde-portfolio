import { Fragment } from 'preact';
import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { X, KeyRound, Ban, Undo2, Shield, ShieldOff, Trash2, Megaphone, RefreshCw, Copy, Search, Mail, MailPlus, UserPlus, UserX } from 'lucide-preact';
import { eu, adminDados, adminSenha, avisoGeral, enviar, aviso, pedidoDeAcessoNovo } from './store.js';
import { AbaConvites, AbaPedidos } from './PainelDeAcesso.jsx';
import { Avatar, NoTopo, botaoVermelho, botaoCinza, campo } from './ui.jsx';
import { IconeServidor } from './Servidores.jsx';
import { GraficoUso, ConsumoPorTipo } from './GraficoUso.jsx';

const data = ts => new Date(ts).toLocaleDateString('pt-BR');
const mb = b => `${(b / 1024 / 1024).toFixed(1)} MB`;

/** Painel do admin do app: visão geral, contas (senha provisória, bloquear, admin), todos os servidores, aviso geral e versão. */
export function PainelApp(props) { return <NoTopo><PainelAppConteudo {...props} /></NoTopo>; }

function PainelAppConteudo({ onFechar }) {
  const aba = useSignal('resumo');
  const busca = useSignal('');
  const adicionando = useSignal(null);   // conta com o "colocar num servidor" aberto
  const versao = useSignal(null);
  useEffect(() => {
    enviar({ t: 'admin-dados' });
    fetch(`/concorde-app/versao.json?t=${Date.now()}`).then(r => r.json()).then(v => { versao.value = v; }).catch(() => {});
  }, []);
  const d = adminDados.value;
  const abaBtn = a => `w-full text-left px-3 py-2 rounded-lg text-sm font-semibold ${aba.value === a ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'}`;
  const acao = (o, pergunta) => { if (!pergunta || confirm(pergunta)) enviar({ t: 'admin-acao', ...o }); };

  return (
    <div class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onFechar()}>
      <div class="w-full max-w-4xl h-[85vh] flex bg-slate-900/95 border border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
        <aside class="w-48 flex-shrink-0 p-3 space-y-1 bg-slate-950/60 border-r border-slate-800/80">
          <div class="px-3 pb-2 text-[11px] font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5"><Shield size={13} /> Admin do app</div>
          <button class={abaBtn('resumo')} onClick={() => { aba.value = 'resumo'; }}>Visão geral</button>
          <button class={abaBtn('contas')} onClick={() => { aba.value = 'contas'; }}>Contas {d && `(${d.usuarios.length})`}</button>
          <button class={abaBtn('servidores')} onClick={() => { aba.value = 'servidores'; }}>Servidores {d && `(${d.servidores.length})`}</button>
          <button class={abaBtn('convites')} onClick={() => { aba.value = 'convites'; }}>Convites</button>
          <button class={abaBtn('pedidos')} onClick={() => { aba.value = 'pedidos'; pedidoDeAcessoNovo.value = false; }}>
            Pedidos {d && `(${d.pedidos.filter(p => p.estado === 'pendente').length})`}
            {pedidoDeAcessoNovo.value && <span class="ml-1.5 inline-block w-2 h-2 rounded-full bg-red-500" aria-label="pedido novo" />}
          </button>
          <button class={abaBtn('aviso')} onClick={() => { aba.value = 'aviso'; }}>Aviso geral</button>
          <button class={abaBtn('app')} onClick={() => { aba.value = 'app'; }}>App desktop</button>
        </aside>
        <section class="flex-1 min-w-0 flex flex-col">
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-800/80">
            <h2 class="text-sm font-extrabold uppercase tracking-wider text-white">Painel do Caocorde</h2>
            <div class="flex items-center gap-1">
              <button title="Atualizar" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" onClick={() => enviar({ t: 'admin-dados' })}><RefreshCw size={16} /></button>
              <button class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" onClick={onFechar}><X size={18} /></button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto p-5">
            {!d ? <p class="text-sm text-slate-400">Carregando…</p> : (
              <>
                {aba.value === 'resumo' && (
                  <div class="space-y-3">
                  <ConsumoPorTipo servidores={d.servidores} mes={d.mes} />
                  <GraficoUso servidores={d.servidores} mes={d.mes} />
                  <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      ['Contas', d.usuarios.length], ['Online agora', d.resumo.pessoasOnline], ['Em call', d.resumo.emCall],
                      ['Transmitindo', d.resumo.transmitindo], ['Servidores', d.servidores.length], ['Mensagens', d.resumo.mensagens],
                      ['Conexões abertas', d.resumo.conexoes], ['Banco de dados', mb(d.resumo.bancoBytes)],
                      ['App publicado', versao.value?.versao || '…'],
                    ].map(([k, v]) => (
                      <div key={k} class="bg-slate-800/50 border border-slate-700/60 rounded-xl p-4">
                        <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400">{k}</div>
                        <div class="text-2xl font-black text-white mt-1">{v}</div>
                      </div>
                    ))}
                  </div>
                  </div>
                )}

                {aba.value === 'contas' && (
                  <div class="space-y-1">
                    {adminSenha.value && (
                      <div class="mb-3 p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-sm text-amber-100 flex items-center gap-2">
                        <KeyRound size={16} class="text-amber-400 flex-shrink-0" />
                        <span class="flex-1">Senha provisória de <b>{d.usuarios.find(u => u.id === adminSenha.value.uid)?.nome}</b>: <b class="font-mono tracking-wider">{adminSenha.value.senha}</b> — passe para a pessoa; ela troca em Configurações.</span>
                        <button class="p-1 hover:text-white" title="Copiar" onClick={() => navigator.clipboard?.writeText(adminSenha.value.senha).then(() => { aviso.value = 'Copiado ✓'; })}><Copy size={15} /></button>
                        <button class="p-1 hover:text-white" onClick={() => { adminSenha.value = null; }}><X size={15} /></button>
                      </div>
                    )}
                    <div class="relative mb-3">
                      <Search size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input value={busca.value} onInput={e => { busca.value = e.currentTarget.value; }} placeholder="Buscar por nome, usuário ou e-mail…"
                        class={`${campo} !pl-9`} />
                    </div>
                    {d.usuarios.filter(u => {
                      const q = busca.value.trim().toLowerCase();
                      return !q || [u.nome, u.usuario, u.email].some(v => (v || '').toLowerCase().includes(q));
                    }).map(u => (
                      <Fragment key={u.id}>
                      <div class={`group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-800/50 ${u.banido ? 'opacity-50' : ''}`}>
                        <Avatar membro={u} tamanho="w-9 h-9 text-sm" />
                        <div class="min-w-0 flex-1">
                          <div class="text-sm font-bold text-white truncate flex items-center gap-1.5">
                            {u.nome} {u.admin && <Shield size={13} class="text-amber-400" />} {u.online && <span class="w-2 h-2 rounded-full bg-emerald-500" />}
                            {u.banido && <span class="text-[10px] font-black uppercase text-red-400">bloqueado</span>}
                          </div>
                          <div class="text-[11px] text-slate-400">@{u.usuario} · {u.email || <span class="text-amber-400">sem e-mail</span>}{!u.seguranca && <span class="text-amber-400"> · falta a atualização de segurança</span>}</div>
                          <div class="text-[11px] text-slate-500">desde {data(u.criado)} · {u.servidores} servidor(es) · {u.mensagens} msgs</div>
                        </div>
                        {u.id !== eu.value.id && (
                          <div class="flex items-center gap-1 opacity-60 group-hover:opacity-100">
                            <button title="Trocar o e-mail (pessoa perdeu o acesso ao antigo)" class="p-1.5 rounded-lg text-slate-300 hover:bg-slate-700" onClick={() => {
                              const novo = prompt(`E-mail novo de ${u.nome}:`, u.email || '');
                              if (novo && novo.trim()) enviar({ t: 'admin-acao', acao: 'email', uid: u.id, email: novo.trim() });
                            }}><Mail size={15} /></button>
                            <button title="Mandar e-mail para redefinir a senha" disabled={!u.email} class="p-1.5 rounded-lg text-sky-300 hover:bg-slate-700 disabled:opacity-30" onClick={() => acao({ acao: 'enviar-redefinicao', uid: u.id }, `Mandar para ${u.email} um link para ${u.nome} criar uma senha nova?`)}><MailPlus size={15} /></button>
                            <button title="Gerar senha provisória" class="p-1.5 rounded-lg text-slate-300 hover:bg-slate-700" onClick={() => acao({ acao: 'senha', uid: u.id }, `Gerar uma senha provisória para ${u.nome}? A senha atual para de funcionar.`)}><KeyRound size={15} /></button>
                            {u.admin
                              ? <button title="Tirar admin do app" class="p-1.5 rounded-lg text-slate-300 hover:bg-slate-700" onClick={() => acao({ acao: 'tirar-admin-app', uid: u.id })}><ShieldOff size={15} /></button>
                              : <button title="Tornar admin do app" class="p-1.5 rounded-lg text-amber-300 hover:bg-slate-700" onClick={() => acao({ acao: 'admin-app', uid: u.id }, `${u.nome} vai poder ver este painel e mexer em tudo. Confirma?`)}><Shield size={15} /></button>}
                            <button title="Colocar num servidor (sem convite)" class="p-1.5 rounded-lg text-slate-300 hover:bg-slate-700" onClick={() => { adicionando.value = adicionando.value === u.id ? null : u.id; }}><UserPlus size={15} /></button>
                            {u.banido
                              ? <button title="Desbloquear" class="p-1.5 rounded-lg text-emerald-300 hover:bg-slate-700" onClick={() => acao({ acao: 'desbanir', uid: u.id })}><Undo2 size={15} /></button>
                              : <button title="Bloquear conta" class="p-1.5 rounded-lg text-red-400 hover:bg-slate-700" onClick={() => acao({ acao: 'banir', uid: u.id }, `Bloquear ${u.nome}? A pessoa é desconectada e não consegue mais entrar.`)}><Ban size={15} /></button>}
                            <button title="APAGAR a conta (de vez)" class="p-1.5 rounded-lg text-red-500 hover:bg-red-500/20" onClick={() => apagarConta(u, d.cofreConfigurado)}><UserX size={15} /></button>
                          </div>
                        )}
                      </div>
                      {adicionando.value === u.id && (
                        <div class="ml-12 mb-2 flex items-center gap-2">
                          <select id={`servidor-para-${u.id}`} class={`${campo} !w-auto !py-1.5 !text-xs`}>
                            {d.servidores.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                          </select>
                          <button class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold keep-white" onClick={() => {
                            enviar({ t: 'admin-acao', acao: 'adicionar-ao-servidor', uid: u.id, servidor: Number(document.getElementById(`servidor-para-${u.id}`).value) });
                            adicionando.value = null;
                          }}>Colocar no servidor</button>
                        </div>
                      )}
                      </Fragment>
                    ))}
                  </div>
                )}

                {aba.value === 'servidores' && (
                  <div class="space-y-1">
                    {d.servidores.map(s => (
                      <div key={s.id} class="group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-800/50">
                        <IconeServidor s={s} tamanho="w-10 h-10 text-base" />
                        <div class="min-w-0 flex-1">
                          <div class="text-sm font-bold text-white truncate">{s.nome}</div>
                          <div class="text-[11px] text-slate-400">dono: {d.usuarios.find(u => u.id === s.dono)?.nome || '?'} · {s.membros} membros · {s.canais} canais · {s.mensagens} msgs · desde {data(s.criado)}</div>
                        </div>
                        {s.id !== 1 && (
                          <button title="Apagar servidor" class="p-1.5 rounded-lg text-red-400 hover:bg-slate-700 opacity-60 group-hover:opacity-100"
                            onClick={() => acao({ acao: 'apagar-servidor', servidor: s.id }, `Apagar "${s.nome}" com todos os canais e mensagens?`)}><Trash2 size={15} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {aba.value === 'convites' && <AbaConvites dados={d} />}
                {aba.value === 'pedidos' && <AbaPedidos dados={d} />}
                {aba.value === 'aviso' && <AbaAviso />}

                {aba.value === 'app' && (
                  <div class="space-y-3 max-w-lg text-sm text-slate-300">
                    <p>Versão publicada do app desktop: <b class="text-white">{versao.value?.versao || '…'}</b>{versao.value && ` (${(versao.value.tamanho / 1024 / 1024).toFixed(0)} MB, ${versao.value.partes.length} partes)`}.</p>
                    <p>Todo app que abrir com versão menor atualiza na hora, antes de entrar (igual Discord). Com o app aberto, ele confere a cada hora.</p>
                    <p class="text-slate-400 text-xs">Para lançar uma versão: <code class="text-slate-200">installer/gerar-concorde.ps1 -Versao X.Y.Z</code> e depois publicar o site (README).</p>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Apagar conta: pede para digitar o usuário (ação sem volta) e avisa sobre o cofre. */
function apagarConta(conta, cofreConfigurado) {
  if (!cofreConfigurado) return void (aviso.value = 'Configure o cofre antes de apagar contas (ferramentas/criar-chave-do-cofre.mjs).');
  const digitado = prompt(`APAGAR a conta de ${conta.nome} (@${conta.usuario}) DE VEZ?\n\nSomem: mensagens, arquivos, foto, conversas diretas e o acesso a tudo. Um registro cifrado das mensagens vai para o cofre (só a chave do pen drive abre).\nNão tem como desfazer.\n\nPara confirmar, digite o usuário: ${conta.usuario}`);
  if (digitado === null) return;
  if (digitado.trim().toLowerCase() !== conta.usuario) return void (aviso.value = 'O usuário digitado não bate. Nada foi apagado.');
  enviar({ t: 'admin-acao', acao: 'apagar-conta', uid: conta.id });
}

function AbaAviso() {
  const texto = useSignal(avisoGeral.value?.texto || '');
  return (
    <div class="space-y-3 max-w-lg">
      <p class="text-sm text-slate-300">Uma faixa no topo do app para todo mundo (ex.: "manutenção hoje às 22h"). Fica até você tirar.</p>
      <textarea rows={3} maxLength={300} value={texto.value} onInput={e => { texto.value = e.currentTarget.value; }} class={campo} placeholder="Escreva o aviso…" />
      <div class="flex gap-2">
        <button class={`${botaoVermelho} flex items-center gap-2`} disabled={!texto.value.trim()} onClick={() => enviar({ t: 'admin-acao', acao: 'aviso', texto: texto.value })}><Megaphone size={15} /> Publicar aviso</button>
        {avisoGeral.value && <button class={botaoCinza} onClick={() => { texto.value = ''; enviar({ t: 'admin-acao', acao: 'aviso', texto: '' }); }}>Tirar aviso</button>}
      </div>
    </div>
  );
}
