// Teste de ponta a ponta da 0.5.11: AMIZADES (pedir, aceitar, bloquear, silenciar) e CARGOS dos servidores
// (src/amizades.js e src/cargos.js). Rodar (com o servidor local de pé, ver auxiliares.mjs):
//   node testes/ponta-a-ponta/amizades-e-cargos.mjs

import { criarConferidor, postar, entrarComSenha, conectar, mandar, ultimaDoTipo, servidoresAtuais, canaisAtuais, esperar } from './auxiliares.mjs';

const { conferir, imprimir } = criarConferidor();
const SACANAS = 1;
const sufixo = Math.random().toString(36).slice(2, 7);
const ana = await conectar(await entrarComSenha('teste.ana'));
const beto = await conectar(await entrarComSenha('teste.beto'));

/** Manda e espera (a trava contra excesso aceita uma ação a cada 150 ms por conexão). */
async function fazer(cliente, mensagem, espera = 350) { mandar(cliente, mensagem); await esperar(espera); }
const relacoes = cliente => ultimaDoTipo(cliente, 'relacoes') || cliente.inicio.relacoes;
const servidorDe = (cliente, id) => servidoresAtuais(cliente).find(servidor => servidor.id === id);

// Conta nova sem servidor nenhum (só vê quem é amigo).
await fazer(ana, { t: 'admin-acao', acao: 'convite-criar', tipo: 'app', horas: 1, usos: 1 });
const conta = await postar('/api/auth/registrar', { convite: ultimaDoTipo(ana, 'admin-convite-criado').codigo, usuario: `solo.${sufixo}`, nome: 'Solo',
  email: `solo.${sufixo}@exemplo.com`, senha: 'Teste@2026', confirmar: 'Teste@2026', maiorDeIdade: true });
const solo = await conectar(conta.cookie);
conferir('a conta nova começa sem amigos', relacoes(solo).amigos.length === 0);

// ---------------- amizades ----------------
await fazer(solo, { t: 'amizade-pedir', usuario: 'ninguem.existe.xyz' });
conferir('pedido para usuário que não existe avisa', /Não achei/.test(ultimaDoTipo(solo, 'erro')?.texto || ''));
await fazer(solo, { t: 'amizade-pedir', usuario: '@teste.ana' });
conferir('pede amizade pelo nome de usuário (aceita o @)', relacoes(solo).pedidosEnviados.includes(ana.id));
conferir('a Ana recebe o pedido na hora', relacoes(ana).pedidosRecebidos.includes(solo.id));
conferir('quem pediu aparece na lista de pessoas da Ana (nome e foto)', ultimaDoTipo(ana, 'relacoes').membros.some(pessoa => pessoa.id === solo.id));
await fazer(solo, { t: 'direta-abrir', uid: ana.id });
conferir('antes de aceitar, sem servidor em comum, não abre DM', /amigos ou para quem está num servidor/.test(ultimaDoTipo(solo, 'erro')?.texto || ''));
await fazer(ana, { t: 'amizade-aceitar', uid: solo.id });
conferir('aceitou: os dois viram amigos', relacoes(ana).amigos.includes(solo.id) && relacoes(solo).amigos.includes(ana.id));
await fazer(solo, { t: 'direta-abrir', uid: ana.id }, 500);
const conversa = ultimaDoTipo(solo, 'direta-aberta')?.canal;
conferir('amigos abrem DM mesmo sem servidor em comum', !!conversa);
await fazer(solo, { t: 'direta-abrir', uid: beto.id });
conferir('quem não é amigo nem divide servidor continua sem DM', /amigos ou para quem está num servidor/.test(ultimaDoTipo(solo, 'erro')?.texto || ''));
await fazer(solo, { t: 'presenca', estado: 'ausente' });
conferir('amigo recebe a presença (online/ausente) do outro', ana.recebidas.some(mensagem => mensagem.t === 'presenca' && mensagem.uid === solo.id));
await fazer(solo, { t: 'presenca', estado: 'online' });

// silenciar pela conta
await fazer(ana, { t: 'silenciar-conta', uid: solo.id });
conferir('silenciar pela conta fica guardado (vale em todos os aparelhos)', relacoes(ana).silenciados.includes(solo.id));
await fazer(ana, { t: 'dessilenciar-conta', uid: solo.id });
conferir('e tirar o silêncio também', !relacoes(ana).silenciados.includes(solo.id));

// bloquear
await fazer(ana, { t: 'bloquear', uid: solo.id });
conferir('bloquear desfaz a amizade', !relacoes(ana).amigos.includes(solo.id) && relacoes(ana).bloqueados.includes(solo.id));
await fazer(solo, { t: 'enviar', canal: conversa, texto: 'oi?' });
conferir('bloqueado não manda mensagem na DM', /Não dá para mandar mensagem/.test(ultimaDoTipo(solo, 'erro')?.texto || ''));
await fazer(solo, { t: 'amizade-pedir', uid: ana.id });
conferir('bloqueado não manda pedido de amizade', /Não dá para mandar pedido/.test(ultimaDoTipo(solo, 'erro')?.texto || ''));
await fazer(ana, { t: 'enviar', canal: conversa, texto: 'oi' });
conferir('quem bloqueou também não manda (o bloqueio vale nos dois sentidos na DM)', /Não dá para mandar mensagem/.test(ultimaDoTipo(ana, 'erro')?.texto || ''));
await fazer(ana, { t: 'desbloquear', uid: solo.id });
conferir('desbloquear tira da lista', !relacoes(ana).bloqueados.includes(solo.id));

// ---------------- cargos ----------------
await fazer(beto, { t: 'codigo-criar', id: SACANAS, horas: 1, usos: 1 });
conferir('sem cargo, membro comum não gera convite do servidor', /não tem permissão/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));
conferir('e não vê os convites do servidor', servidorDe(beto, SACANAS).convite === null);
await fazer(beto, { t: 'cargo-criar', servidor: SACANAS, nome: 'Eu mesmo', permissoes: 127 });
conferir('membro comum não cria cargo', /permissão para mexer nos cargos/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));

await fazer(ana, { t: 'cargo-criar', servidor: SACANAS, nome: `Porteiro ${sufixo}`, cor: '#2EC4D3', permissoes: 1 }, 500);
const porteiro = servidorDe(ana, SACANAS).cargos.find(cargo => cargo.nome === `Porteiro ${sufixo}`);
conferir('admin cria o cargo "Porteiro" (só convidar)', porteiro?.permissoes === 1);
await fazer(ana, { t: 'cargo-dar', servidor: SACANAS, cargo: porteiro.id, uid: beto.id }, 500);
conferir('o Beto recebe o cargo e a permissão', (servidorDe(beto, SACANAS).permissoes & 1) === 1 && servidorDe(beto, SACANAS).cargosDosMembros[beto.id]?.includes(porteiro.id));
await fazer(beto, { t: 'codigo-criar', id: SACANAS, horas: 1, usos: 1 }, 500);
conferir('com o cargo, o Beto gera convite do servidor', servidorDe(beto, SACANAS).codigos.some(codigo => !codigo.convidado));
await fazer(beto, { t: 'canal-criar', servidor: SACANAS, nome: 'nao-devia', tipo: 'texto' });
conferir('mas não cria canal (não é permissão do cargo)', /permissão para mexer nos canais/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));

await fazer(ana, { t: 'cargo-criar', servidor: SACANAS, nome: `Gerente ${sufixo}`, permissoes: 64 }, 500);
const gerente = servidorDe(ana, SACANAS).cargos.find(cargo => cargo.nome === `Gerente ${sufixo}`);
await fazer(ana, { t: 'cargo-dar', servidor: SACANAS, cargo: gerente.id, uid: beto.id }, 500);
await fazer(beto, { t: 'cargo-criar', servidor: SACANAS, nome: 'Promoção', permissoes: 2 });
conferir('quem gerencia cargos não dá permissão que não tem (ninguém se promove)', /permissão que não tem/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));
await fazer(beto, { t: 'cargo-criar', servidor: SACANAS, nome: `Ajudante ${sufixo}`, permissoes: 1 }, 500);
conferir('mas cria cargo com o que ele tem (convidar)', servidorDe(beto, SACANAS).cargos.some(cargo => cargo.nome === `Ajudante ${sufixo}`));

await fazer(ana, { t: 'admin-acao', acao: 'adicionar-ao-servidor', uid: solo.id, servidor: SACANAS }, 500);
await fazer(beto, { t: 'servidor-membro', id: SACANAS, uid: solo.id, acao: 'expulsar' });
conferir('sem "expulsar", o Beto não tira ninguém', /não tem permissão/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));
await fazer(ana, { t: 'cargo-editar', servidor: SACANAS, cargo: porteiro.id, permissoes: 1 | 4 }, 500);
await fazer(beto, { t: 'servidor-membro', id: SACANAS, uid: ana.id, acao: 'expulsar' });
conferir('com "expulsar", ainda não tira admin nem o dono', /Só admin tira|dono do servidor/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));
await fazer(beto, { t: 'servidor-membro', id: SACANAS, uid: solo.id, acao: 'expulsar' }, 500);
conferir('com "expulsar", tira um membro comum', !servidorDe(ana, SACANAS).membros.includes(solo.id));

// limpeza
for (const cargo of servidorDe(ana, SACANAS).cargos.filter(item => item.nome.endsWith(sufixo))) await fazer(ana, { t: 'cargo-apagar', servidor: SACANAS, cargo: cargo.id }, 250);
conferir('apagar o cargo tira as permissões de quem tinha', (servidorDe(beto, SACANAS).permissoes || 0) === 0);
for (const codigo of servidorDe(ana, SACANAS).codigos.filter(item => !item.convidado)) await fazer(ana, { t: 'codigo-apagar', id: SACANAS, codigo: codigo.codigo }, 250);
await fazer(ana, { t: 'amizade-remover', uid: solo.id });
void canaisAtuais;
for (const cliente of [ana, beto, solo]) cliente.conexao.close();
process.exit(imprimir() ? 0 : 1);
