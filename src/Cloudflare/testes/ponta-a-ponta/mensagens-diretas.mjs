// Teste de ponta a ponta das MENSAGENS DIRETAS (DMs) — src/conversasDiretas.js.
// Rodar (com o servidor local de pé, ver auxiliares.mjs):  node testes/ponta-a-ponta/mensagens-diretas.mjs

import { criarConferidor, postar, entrarComSenha, conectar, mandar, ultimaDoTipo, canaisAtuais, servidoresAtuais, esperar, apagarConvitesDeConvidado } from './auxiliares.mjs';

const { conferir, imprimir } = criarConferidor();
const SACANAS = 1;

const ana = await conectar(await entrarComSenha('teste.ana'));
const beto = await conectar(await entrarComSenha('teste.beto'));

// ---- abrir a conversa ----
mandar(ana, { t: 'direta-abrir', uid: ana.id });
await esperar(300);
conferir('não abre conversa consigo mesmo', /outra pessoa/.test(ultimaDoTipo(ana, 'erro')?.texto || ''));

mandar(ana, { t: 'direta-abrir', uid: beto.id });
await esperar(500);
const conversa = ultimaDoTipo(ana, 'direta-aberta')?.canal;
conferir('ana abre conversa com o beto', !!conversa);
conferir('a conversa aparece na lista da ana (servidor 0, com o beto)', canaisAtuais(ana).some(canal => canal.id === conversa && canal.servidor === 0 && canal.com === beto.id));
conferir('a conversa aparece na lista do beto (com a ana)', canaisAtuais(beto).some(canal => canal.id === conversa && canal.com === ana.id));

ana.recebidas.length = 0;
mandar(ana, { t: 'direta-abrir', uid: beto.id });
await esperar(400);
conferir('abrir de novo volta para a MESMA conversa', ultimaDoTipo(ana, 'direta-aberta')?.canal === conversa);

// ---- mensagens só para os dois ----
const terceiraConta = await entrarComSenha('teste.c048160').catch(() => '');
const terceiro = terceiraConta ? await conectar(terceiraConta).catch(() => null) : null;
mandar(ana, { t: 'enviar', canal: conversa, texto: 'oi beto, só entre nós' });
await esperar(500);
conferir('o beto recebe a mensagem direta', ultimaDoTipo(beto, 'msg')?.msg?.texto === 'oi beto, só entre nós');
if (terceiro) conferir('quem é do mesmo servidor mas não está na conversa NÃO recebe', !terceiro.recebidas.some(mensagem => mensagem.t === 'msg' && mensagem.msg?.canal === conversa));
mandar(beto, { t: 'digitando', canal: conversa });
await esperar(300);
conferir('"digitando" chega para a outra pessoa', ultimaDoTipo(ana, 'digitando')?.canal === conversa);
mandar(beto, { t: 'historico', canal: conversa });
await esperar(400);
conferir('histórico da conversa funciona', ultimaDoTipo(beto, 'historico')?.msgs?.some(mensagem => mensagem.texto === 'oi beto, só entre nós'));
const minhaMensagem = ultimaDoTipo(beto, 'historico').msgs.find(mensagem => mensagem.texto === 'oi beto, só entre nós');
mandar(beto, { t: 'apagar', id: minhaMensagem.id });
await esperar(300);
conferir('a outra pessoa não apaga a mensagem de quem mandou', /Só dá para apagar mensagem sua/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));
mandar(ana, { t: 'editar', id: minhaMensagem.id, texto: 'oi beto (editado)' });
await esperar(400);
conferir('editar a própria mensagem chega para o outro', ultimaDoTipo(beto, 'msg-editada')?.msg?.texto === 'oi beto (editado)');

// ---- quem está fora não lê ----
if (terceiro) {
  mandar(terceiro, { t: 'historico', canal: conversa });
  await esperar(400);
  conferir('quem está fora da conversa não lê o histórico', /Canal não existe/.test(ultimaDoTipo(terceiro, 'erro')?.texto || ''));
  mandar(terceiro, { t: 'enviar', canal: conversa, texto: 'intruso' });
  await esperar(400);
  conferir('quem está fora da conversa não escreve nela', /Canal de texto inválido/.test(ultimaDoTipo(terceiro, 'erro')?.texto || ''));
}
// Envio de arquivo de verdade: POST /api/arquivos?canal=ID, corpo = o arquivo (index.js → arquivos).
const enviarArquivo = cookie => fetch(`http://127.0.0.1:8790/api/arquivos?canal=${conversa}`, {
  method: 'POST', headers: { cookie, 'content-type': 'image/png', 'X-Nome': 'teste.png' }, body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
}).then(async resposta => ({ status: resposta.status, corpo: await resposta.json().catch(() => ({})) }));
if (terceiraConta) {
  const arquivoDeFora = await enviarArquivo(terceiraConta);
  conferir('quem está fora não manda arquivo na conversa', arquivoDeFora.status >= 400 && /inválido/.test(arquivoDeFora.corpo.erro || ''), `${arquivoDeFora.status} ${arquivoDeFora.corpo.erro || ''}`);
}
const arquivoDeDentro = await enviarArquivo(await entrarComSenha('teste.beto'));
conferir('quem está na conversa manda arquivo nela', arquivoDeDentro.status === 200, `${arquivoDeDentro.status} ${JSON.stringify(arquivoDeDentro.corpo)}`);

// ---- convidado fica de fora das DMs ----
mandar(ana, { t: 'codigo-criar', id: SACANAS, horas: 1, usos: 1, convidado: true });
await esperar(500);
const codigoDeConvidado = servidoresAtuais(ana).find(servidor => servidor.id === SACANAS).codigos.filter(codigo => codigo.convidado === 1).at(0).codigo;
const convidado = await conectar((await postar('/api/auth/convidado', { codigo: codigoDeConvidado, nome: 'Visita DM' })).cookie);
mandar(ana, { t: 'direta-abrir', uid: convidado.id });
await esperar(400);
conferir('ninguém abre DM com convidado', /Convidado não recebe/.test(ultimaDoTipo(ana, 'erro')?.texto || ''));
mandar(convidado, { t: 'direta-abrir', uid: ana.id });
await esperar(400);
conferir('convidado não abre DM', /Convidado não pode/.test(ultimaDoTipo(convidado, 'erro')?.texto || ''));
conferir('convidado não vê as DMs dos outros na lista', !canaisAtuais(convidado).some(canal => canal.servidor === 0));
mandar(ana, { t: 'servidor-membro', id: SACANAS, uid: convidado.id, acao: 'expulsar' });
await esperar(300);
await apagarConvitesDeConvidado(ana, SACANAS);   // não deixa convite de teste sobrando

for (const cliente of [ana, beto, terceiro].filter(Boolean)) cliente.conexao.close();
const tudoCerto = imprimir();
process.exit(tudoCerto ? 0 : 1);
