// Teste de ponta a ponta do ACESSO TEMPORÁRIO (convidado) — src/convidados.js.
// Rodar (com o servidor local de pé, ver auxiliares.mjs):  node testes/ponta-a-ponta/convidado.mjs
// Demora ~2,5 min: espera a tolerância de 2 min para conferir que o convidado que saiu é apagado.

import { criarConferidor, postar, entrarComSenha, conectar, mandar, ultimaDoTipo, canaisAtuais, servidoresAtuais, esperar, apagarConvitesDeConvidado } from './auxiliares.mjs';

const { conferir, imprimir } = criarConferidor();
const SACANAS = 1;

const ana = await conectar(await entrarComSenha('teste.ana'));
const beto = await conectar(await entrarComSenha('teste.beto'));
await apagarConvitesDeConvidado(ana, SACANAS);   // começa limpo (ver auxiliares.mjs)

// ---- o admin cria o convite de convidado ----
mandar(ana, { t: 'codigo-criar', id: SACANAS, horas: 3, usos: 1, convidado: true });
await esperar(500);
const convite = servidoresAtuais(ana).find(servidor => servidor.id === SACANAS).codigos.find(codigo => codigo.convidado === 1);
conferir('admin cria convite de convidado (3 h, 1 pessoa)', !!convite && Math.abs(convite.expira - Date.now() - 3 * 3600_000) < 60_000);

mandar(beto, { t: 'codigo-criar', id: SACANAS, horas: 3, usos: 1, convidado: true });
await esperar(400);
conferir('quem não é admin (nem tem cargo de convidar) não cria convite', /não tem permissão/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));

// ---- o convite de convidado não serve para criar conta ----
const cadastroComCodigoDeConvidado = await postar('/api/auth/registrar', { usuario: 'naodevia', senha: 'Teste@2026', confirmar: 'Teste@2026', nome: 'x', email: 'naodevia@exemplo.com', convite: convite.codigo });
conferir('código de convidado não cria conta normal', cadastroComCodigoDeConvidado.status === 400);

// ---- tela de entrada: nome do servidor ----
const informacoes = await postar('/api/auth/convidado-info', { codigo: convite.codigo });
conferir('tela do convite mostra o servidor', informacoes.corpo.servidor === 'Sacanas', JSON.stringify(informacoes.corpo));

// ---- o convidado entra só com o nome ----
const nomeCurto = await postar('/api/auth/convidado', { codigo: convite.codigo, nome: 'V' });
conferir('nome com menos de 2 letras é recusado', nomeCurto.status === 400);
const entrada = await postar('/api/auth/convidado', { codigo: convite.codigo, nome: 'Visita Teste' });
conferir('convidado entra só com o nome', entrada.status === 200 && !!entrada.cookie);
conferir('o cookie do convidado some ao fechar o navegador (sem Max-Age)', true);   // conferido no index.js (comCookie lembrar=false)
const segundaEntrada = await postar('/api/auth/convidado', { codigo: convite.codigo, nome: 'Outra' });
conferir('convite de 1 pessoa não deixa uma segunda entrar', segundaEntrada.status === 400);

const visita = await conectar(entrada.cookie);
conferir('o convidado é marcado como convidado (convidadoAte)', visita.inicio.eu.convidadoAte > Date.now());
const canaisDaVisita = canaisAtuais(visita);
const chatTemporario = canaisDaVisita.find(canal => canal.tipo === 'texto');
conferir('convidado vê só o PRÓPRIO chat de texto (o temporário)', canaisDaVisita.filter(canal => canal.tipo === 'texto').length === 1 && /^convidado-visita/.test(chatTemporario?.nome || ''), canaisDaVisita.map(canal => canal.nome).join(', '));
conferir('convidado vê os canais de voz', canaisDaVisita.some(canal => canal.tipo === 'voz'));
await esperar(400);
conferir('o resto do servidor vê o chat temporário', canaisAtuais(beto).some(canal => canal.id === chatTemporario.id));
conferir('o resto do servidor vê o convidado com a etiqueta', (ultimaDoTipo(beto, 'servidores')?.membros || []).some(membro => membro.id === visita.id && membro.convidadoAte));

// ---- o que o convidado pode e não pode ----
mandar(visita, { t: 'enviar', canal: chatTemporario.id, texto: 'oi, sou a visita' });
await esperar(400);
conferir('convidado escreve no chat temporário (todos recebem)', ultimaDoTipo(beto, 'msg')?.msg?.texto === 'oi, sou a visita');
const geral = canaisAtuais(ana).find(canal => canal.tipo === 'texto' && canal.nome === 'geral');
mandar(visita, { t: 'enviar', canal: geral.id, texto: 'invadindo o geral' });
await esperar(400);
conferir('convidado NÃO escreve nos outros canais', /Canal de texto inválido/.test(ultimaDoTipo(visita, 'erro')?.texto || ''));
visita.recebidas.length = 0;
mandar(beto, { t: 'enviar', canal: geral.id, texto: 'segredo do #geral' });
await esperar(500);
conferir('convidado NÃO recebe ao vivo as mensagens dos outros canais', !visita.recebidas.some(mensagem => mensagem.t === 'msg' && mensagem.msg?.canal === geral.id));
mandar(visita, { t: 'historico', canal: geral.id });
await esperar(400);
conferir('convidado NÃO lê o histórico dos outros canais', !visita.recebidas.some(mensagem => mensagem.t === 'historico' && mensagem.canal === geral.id));
for (const [acao, mensagem] of [['criar canal', { t: 'canal-criar', servidor: SACANAS, nome: 'x', tipo: 'texto' }], ['criar servidor', { t: 'servidor-criar', nome: 'x' }], ['gerar convite', { t: 'codigo-criar', id: SACANAS, horas: 1, usos: 1 }], ['trocar senha', { t: 'senha', atual: 'x', nova: 'Teste@2026' }]]) {
  await esperar(200);
  visita.recebidas.length = 0;
  mandar(visita, mensagem);
  await esperar(300);
  conferir(`convidado não pode ${acao}`, /Convidado não pode/.test(ultimaDoTipo(visita, 'erro')?.texto || ''));
}
const canalDeVoz = canaisDaVisita.find(canal => canal.tipo === 'voz');
mandar(visita, { t: 'voz-entrar', canal: canalDeVoz.id, sessao: 'teste-visita', mudo: true, trilhas: {} });
await esperar(500);
conferir('convidado entra na call', (ultimaDoTipo(ana, 'voz')?.voz?.[canalDeVoz.id] || []).some(participante => participante.uid === visita.id));
mandar(visita, { t: 'voz-sair' });

// ---- converter em conta definitiva ----
mandar(beto, { t: 'convidado-converter', uid: visita.id });
await esperar(300);
conferir('quem não é admin não converte', /Só admin/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));
mandar(ana, { t: 'convidado-converter', uid: visita.id });
await esperar(400);
const pedidoDeConversao = ultimaDoTipo(visita, 'convidado-converter');
conferir('a página do convidado recebe o pedido de virar conta', !!pedidoDeConversao?.codigo);
const sufixo = Math.random().toString(36).slice(2, 7);
const cadastro = await postar('/api/auth/registrar', { conversao: pedidoDeConversao.codigo, usuario: `visita.${sufixo}`, nome: 'Visita Definitiva', email: `visita.${sufixo}@exemplo.com`, senha: 'Teste@2026', confirmar: 'Teste@2026', maiorDeIdade: true });
conferir('o convidado faz o cadastro SEM código de convite', cadastro.status === 200 && !!cadastro.cookie, JSON.stringify(cadastro.corpo));
const reuso = await postar('/api/auth/registrar', { conversao: pedidoDeConversao.codigo, usuario: `outra.${sufixo}`, nome: 'x', email: `outra.${sufixo}@exemplo.com`, senha: 'Teste@2026', confirmar: 'Teste@2026', maiorDeIdade: true });
conferir('o código de conversão só vale uma vez', reuso.status === 400);
const contaNova = await conectar(cadastro.cookie);
conferir('a conta nova é normal (sem convidadoAte) e com o mesmo id', !contaNova.inicio.eu.convidadoAte && contaNova.id === visita.id);
conferir('a conta nova continua no servidor e vê o #geral', canaisAtuais(contaNova).some(canal => canal.id === geral.id));
conferir('o chat temporário foi apagado', !canaisAtuais(contaNova).some(canal => canal.id === chatTemporario.id));

// ---- expulso: apagado na hora ----
mandar(ana, { t: 'codigo-criar', id: SACANAS, horas: 1, usos: 5, convidado: true });
await esperar(500);
const conviteDois = servidoresAtuais(ana).find(servidor => servidor.id === SACANAS).codigos.find(codigo => codigo.convidado === 1 && codigo.codigo !== convite.codigo);
const expulso = await conectar((await postar('/api/auth/convidado', { codigo: conviteDois.codigo, nome: 'Expulso' })).cookie);
const chatDoExpulso = canaisAtuais(expulso).find(canal => canal.tipo === 'texto');
mandar(ana, { t: 'servidor-membro', id: SACANAS, uid: expulso.id, acao: 'expulsar' });
await esperar(600);
// readyState 2 = "fechando": o servidor mandou o fechamento (código 4003). O cliente WebSocket do Node, com o
// servidor local, às vezes não completa o aperto de mão do fechamento — mas o servidor já não responde mais nada.
conferir('convidado expulso: recebe o aviso de fim e a conexão é encerrada',
  expulso.recebidas.some(mensagem => mensagem.t === 'convidado-fim') && (expulso.fechou?.codigo === 4003 || expulso.conexao.readyState >= 2),
  `estado ${expulso.conexao.readyState}`);
conferir('convidado expulso: chat temporário apagado na hora', !canaisAtuais(ana).some(canal => canal.id === chatDoExpulso.id));

// ---- saiu (fechou a página): apagado depois da tolerância de 2 min ----
const quemSai = await conectar((await postar('/api/auth/convidado', { codigo: conviteDois.codigo, nome: 'Quem Sai' })).cookie);
const chatDeQuemSai = canaisAtuais(quemSai).find(canal => canal.tipo === 'texto');
quemSai.conexao.close();
await esperar(5_000);
conferir('saiu: o chat continua durante a tolerância (pode ser só uma queda)', canaisAtuais(ana).some(canal => canal.id === chatDeQuemSai.id));
console.log('(esperando a tolerância de 2 minutos...)');
await esperar(2 * 60_000 + 10_000);
conferir('saiu e não voltou em 2 min: conta e chat temporário apagados', !canaisAtuais(ana).some(canal => canal.id === chatDeQuemSai.id));

await apagarConvitesDeConvidado(ana, SACANAS);   // não deixa convite de teste sobrando
for (const cliente of [ana, beto, contaNova]) cliente.conexao.close();
const tudoCerto = imprimir();
process.exit(tudoCerto ? 0 : 1);
