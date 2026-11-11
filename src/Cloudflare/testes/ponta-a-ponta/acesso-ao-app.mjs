// Teste de ponta a ponta do ACESSO AO APP (0.5.10) — src/acessoAoApp.js, painelDoAdmin.js e cofre.js:
// convites do app (criar, conferir, cadastrar), conta nova sem servidor, convite de servidor que não cria conta,
// pedido de acesso, aprovação, colocar num servidor sem convite e apagar conta (com o cofre).
// Rodar (com o servidor local de pé, ver auxiliares.mjs):  node testes/ponta-a-ponta/acesso-ao-app.mjs
// O servidor local não tem a senha do Gmail: a aprovação responde "o e-mail não foi" (nenhum e-mail sai no teste).

import { criarConferidor, postar, entrarComSenha, conectar, mandar, ultimaDoTipo, servidoresAtuais, esperar, ENDERECO_DO_SERVIDOR_LOCAL } from './auxiliares.mjs';

const { conferir, imprimir } = criarConferidor();
const SACANAS = 1;
const sufixo = Math.random().toString(36).slice(2, 7);
const ana = await conectar(await entrarComSenha('teste.ana'));
const beto = await conectar(await entrarComSenha('teste.beto'));

/** Pede para o painel criar um convite e devolve o código (ou a mensagem de erro). */
async function criarConvite(dados) {
  ana.recebidas.length = 0;
  mandar(ana, { t: 'admin-acao', acao: 'convite-criar', ...dados });
  await esperar(500);
  return ultimaDoTipo(ana, 'admin-convite-criado')?.codigo || ultimaDoTipo(ana, 'erro')?.texto;
}
const cadastro = (convite, extra = {}) => postar('/api/auth/registrar', {
  convite, usuario: `novo.${sufixo}${extra.letra || ''}`, nome: 'Novo', email: `novo.${sufixo}${extra.letra || ''}@exemplo.com`,
  senha: 'Teste@2026', confirmar: 'Teste@2026', maiorDeIdade: true, ...extra,
});

// ---- só o admin do app cria convite ----
mandar(beto, { t: 'admin-acao', acao: 'convite-criar', tipo: 'app', horas: 24, usos: 1 });
await esperar(400);
conferir('quem não é admin do app não cria convite', /Só o admin do app/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));
conferir('duração fora do limite é recusada', /duração/.test(await criarConvite({ tipo: 'app', horas: 9999, usos: 1 })));

// ---- convite do app: conferir e cadastrar ----
const codigoDoApp = await criarConvite({ tipo: 'app', horas: 24, usos: 1 });
conferir('admin cria convite do app (código ABCD-EFGH)', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigoDoApp || ''), codigoDoApp);
const conferido = await postar('/api/auth/convite-validar', { codigo: codigoDoApp.toLowerCase().replace('-', ' ') });
conferir('a tela "tenho um código" confere o código (aceita minúscula e espaço)', conferido.status === 200 && conferido.corpo.codigo === codigoDoApp);
conferir('código errado é recusado', (await postar('/api/auth/convite-validar', { codigo: 'ZZZZ-ZZZZ' })).status === 400);
const semIdade = await cadastro(codigoDoApp, { maiorDeIdade: false });
conferir('sem confirmar 18 anos não cria conta', semIdade.status === 400 && /18 anos/.test(semIdade.corpo.erro || ''));
const contaNova = await cadastro(codigoDoApp);
conferir('cria a conta com o convite do app', contaNova.status === 200 && !!contaNova.cookie, JSON.stringify(contaNova.corpo));
const novo = await conectar(contaNova.cookie);
conferir('conta nova começa SEM servidor (não entra mais no Sacanas)', novo.inicio.servidores.length === 0, novo.inicio.servidores.map(s => s.nome).join(','));
conferir('o convite de 1 pessoa não serve de novo', (await cadastro(codigoDoApp, { letra: 'b' })).status === 400);

// ---- convite de servidor não cria conta ----
mandar(ana, { t: 'codigo-criar', id: SACANAS, horas: 1, usos: 1 });
await esperar(500);
const codigoDeServidor = servidoresAtuais(ana).find(servidor => servidor.id === SACANAS).codigos.find(codigo => !codigo.convidado)?.codigo;
conferir('código de servidor (6 números) NÃO cria conta', (await cadastro(codigoDeServidor, { letra: 'c' })).status === 400);
const linkFixo = servidoresAtuais(ana).find(servidor => servidor.id === SACANAS).convite;
conferir('link fixo do servidor NÃO cria conta', (await cadastro(linkFixo, { letra: 'd' })).status === 400);
mandar(novo, { t: 'servidor-entrar', convite: codigoDeServidor });
await esperar(500);
conferir('mas quem JÁ TEM conta entra no servidor com o código', servidoresAtuais(novo).some(servidor => servidor.id === SACANAS));
mandar(ana, { t: 'servidor-membro', id: SACANAS, uid: novo.id, acao: 'expulsar' });
await esperar(400);

// ---- app + servidor e "só o código" ----
const codigoComServidor = await criarConvite({ tipo: 'servidor', servidor: SACANAS, horas: 2, usos: 0 });
const contaComServidor = await cadastro(codigoComServidor, { letra: 'e' });
const comServidor = await conectar(contaComServidor.cookie);
conferir('convite "app + servidor" cria a conta já dentro do servidor', comServidor.inicio.servidores.some(servidor => servidor.id === SACANAS));
conferir('convite "sem limite" continua valendo depois do uso', (await postar('/api/auth/convite-validar', { codigo: codigoComServidor })).status === 200);
const soCodigo = await criarConvite({ tipo: 'codigo', horas: 1, usos: 3 });
conferir('convite "só o código" também cria conta', (await cadastro(soCodigo, { letra: 'f' })).status === 200);

// ---- convidado pelo painel ----
const codigoDeConvidado = await criarConvite({ tipo: 'convidado', servidor: SACANAS, horas: 2, usos: 1 });
conferir('painel cria convite de conta temporária (convidado)', /^\d{6}$/.test(codigoDeConvidado || ''));
conferir('o convite de convidado funciona na tela do convidado', (await postar('/api/auth/convidado-info', { codigo: codigoDeConvidado })).status === 200);
conferir('convidado acima de 24 horas é recusado', /24 horas/.test(await criarConvite({ tipo: 'convidado', servidor: SACANAS, horas: 48, usos: 1 })));

// ---- pedido de acesso ----
const emailDoPedido = `pedido.${sufixo}@exemplo.com`;
conferir('pedido sem os 18 anos é recusado', (await postar('/api/auth/pedir-acesso', { comoConhece: 'amigo do beto', email: emailDoPedido })).status === 400);
ana.recebidas.length = 0;
const pedido = await postar('/api/auth/pedir-acesso', { indicadoPor: 'Beto', comoConhece: 'amigo do beto do ARK', email: emailDoPedido, maiorDeIdade: true });
conferir('pedido de acesso é aceito', pedido.status === 200, JSON.stringify(pedido.corpo));
await esperar(300);
conferir('o admin conectado é avisado do pedido novo', !!ultimaDoTipo(ana, 'pedido-novo'));
mandar(ana, { t: 'admin-dados' });
await esperar(500);
const pedidoNoPainel = ultimaDoTipo(ana, 'admin-dados')?.pedidos?.find(item => item.email === emailDoPedido);
conferir('o pedido aparece no painel com as 3 respostas', pedidoNoPainel?.indicadoPor === 'Beto' && /ARK/.test(pedidoNoPainel?.comoConhece || ''));
mandar(ana, { t: 'admin-acao', acao: 'pedido-aprovar', pedido: pedidoNoPainel.id });
await esperar(800);
const avisoDaAprovacao = ultimaDoTipo(ana, 'erro')?.texto || '';
const codigoDoPedido = avisoDaAprovacao.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0];
conferir('aprovar cria o convite (no teste o e-mail não sai e o painel mostra o código)', !!codigoDoPedido, avisoDaAprovacao.slice(0, 120));
conferir('o link do e-mail (?acesso=CÓDIGO) é aceito na conferência', (await postar('/api/auth/convite-validar', { codigo: codigoDoPedido })).status === 200);

// ---- colocar num servidor sem convite ----
mandar(ana, { t: 'admin-acao', acao: 'adicionar-ao-servidor', uid: novo.id, servidor: SACANAS });
await esperar(500);
conferir('admin coloca a pessoa num servidor sem convite', servidoresAtuais(novo).some(servidor => servidor.id === SACANAS));

// ---- apagar conta ----
const geral = novo.recebidas.findLast(mensagem => mensagem.t === 'servidores').canais.find(canal => canal.nome === 'geral' && canal.servidor === SACANAS);
mandar(novo, { t: 'enviar', canal: geral.id, texto: `mensagem que vai para o cofre ${sufixo}` });
await esperar(400);
mandar(beto, { t: 'admin-acao', acao: 'apagar-conta', uid: novo.id });
await esperar(300);
conferir('quem não é admin do app não apaga conta', /Só o admin do app/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));
mandar(ana, { t: 'admin-acao', acao: 'apagar-conta', uid: ana.id });
await esperar(300);
conferir('admin não apaga a própria conta', /própria conta/.test(ultimaDoTipo(ana, 'erro')?.texto || ''));
ana.recebidas.length = 0;
mandar(ana, { t: 'admin-acao', acao: 'apagar-conta', uid: novo.id });
await esperar(1500);
conferir('admin apaga a conta (registro vai para o cofre)', /cofre/.test(ultimaDoTipo(ana, 'ok')?.texto || ''), ultimaDoTipo(ana, 'erro')?.texto || '');
conferir('a pessoa apagada é desconectada', novo.fechou?.codigo === 4001 || novo.conexao.readyState >= 2);
conferir('a conta apagada não entra mais', !(await entrarComSenha(`novo.${sufixo}`)));
mandar(beto, { t: 'historico', canal: geral.id });
await esperar(500);
conferir('as mensagens dela sumiram do canal', !(ultimaDoTipo(beto, 'historico')?.msgs || []).some(mensagem => mensagem.texto.includes(sufixo)));

// ---- download do instalador ----
const download = await fetch(`${ENDERECO_DO_SERVIDOR_LOCAL}/baixar/windows`);
conferir('/baixar/windows responde como download do instalador', download.status === 200 && /attachment; filename="CaocordeInstalador-/.test(download.headers.get('content-disposition') || ''),
  `${download.status} ${download.headers.get('content-disposition')}`);
download.body?.cancel();

// limpeza: cancela os convites de teste que sobraram
mandar(ana, { t: 'admin-dados' });
await esperar(500);
for (const convite of ultimaDoTipo(ana, 'admin-dados').convites) {
  mandar(ana, { t: 'admin-acao', acao: 'convite-apagar', codigo: convite.codigo });
  await esperar(200);
}
for (const cliente of [ana, beto, comServidor]) cliente.conexao.close();
process.exit(imprimir() ? 0 : 1);
