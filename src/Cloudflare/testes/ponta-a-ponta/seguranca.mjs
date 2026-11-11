// Teste de ponta a ponta das travas de SEGURANÇA da auditoria da 0.5.10:
// pedido forjado de outro site (CSRF), presença que não vaza para estranhos e mensagem que não se edita depois de
// sair do servidor. Rodar (com o servidor local de pé, ver auxiliares.mjs):  node testes/ponta-a-ponta/seguranca.mjs

import { criarConferidor, postar, entrarComSenha, conectar, mandar, ultimaDoTipo, esperar, ENDERECO_DO_SERVIDOR_LOCAL, SENHA_DAS_CONTAS_DE_TESTE } from './auxiliares.mjs';

const { conferir, imprimir } = criarConferidor();
const SACANAS = 1;
const sufixo = Math.random().toString(36).slice(2, 7);

// ---- CSRF: POST vindo de outro site é recusado ----
const deOutroSite = await fetch(`${ENDERECO_DO_SERVIDOR_LOCAL}/api/auth/entrar`, {
  method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://site-malicioso.example' },
  body: JSON.stringify({ usuario: 'teste.ana', senha: SENHA_DAS_CONTAS_DE_TESTE }),
});
conferir('POST de outro site (Origin estranho) é recusado com 403', deOutroSite.status === 403);
const deIframeSemOrigem = await fetch(`${ENDERECO_DO_SERVIDOR_LOCAL}/api/auth/sair`, { method: 'POST', headers: { Origin: 'null' } });
conferir('POST com Origin "null" (iframe isolado) é recusado', deIframeSemOrigem.status === 403);
const daPropriaPagina = await fetch(`${ENDERECO_DO_SERVIDOR_LOCAL}/api/auth/entrar`, {
  method: 'POST', headers: { 'content-type': 'application/json', Origin: ENDERECO_DO_SERVIDOR_LOCAL },
  body: JSON.stringify({ usuario: 'teste.ana', senha: SENHA_DAS_CONTAS_DE_TESTE }),
});
conferir('POST da própria página continua funcionando', daPropriaPagina.status === 200);

// ---- presença não vaza para quem não divide servidor ----
const ana = await conectar(await entrarComSenha('teste.ana'));
mandar(ana, { t: 'admin-acao', acao: 'convite-criar', tipo: 'app', horas: 1, usos: 1 });
await esperar(500);
const codigo = ultimaDoTipo(ana, 'admin-convite-criado').codigo;
const conta = await postar('/api/auth/registrar', { convite: codigo, usuario: `sozinho.${sufixo}`, nome: 'Sozinho', email: `sozinho.${sufixo}@exemplo.com`, senha: 'Teste@2026', confirmar: 'Teste@2026', maiorDeIdade: true });
const sozinho = await conectar(conta.cookie);
conferir('quem não divide servidor NÃO recebe a presença da Ana no início', !(ana.id in sozinho.inicio.presencas));
sozinho.recebidas.length = 0;
mandar(ana, { t: 'presenca', estado: 'ausente' });
await esperar(400);
conferir('nem as mudanças de presença dela', !sozinho.recebidas.some(mensagem => mensagem.t === 'presenca' && mensagem.uid === ana.id));
mandar(ana, { t: 'presenca', estado: 'online' });
await esperar(300);   // a trava contra excesso aceita uma ação a cada 150 ms

// ---- mensagem não se edita depois de sair do servidor ----
mandar(ana, { t: 'admin-acao', acao: 'adicionar-ao-servidor', uid: sozinho.id, servidor: SACANAS });
await esperar(500);
const geral = ultimaDoTipo(sozinho, 'servidores').canais.find(canal => canal.nome === 'geral' && canal.servidor === SACANAS);
mandar(sozinho, { t: 'enviar', canal: geral.id, texto: 'antes de sair' });
await esperar(400);
const minha = ultimaDoTipo(sozinho, 'msg').msg;
mandar(sozinho, { t: 'servidor-sair', id: SACANAS });
await esperar(500);
mandar(sozinho, { t: 'editar', id: minha.id, texto: 'editada depois de sair' });
await esperar(400);
conferir('quem saiu do servidor não edita mais a mensagem que ficou lá', /não está mais nesse canal/.test(ultimaDoTipo(sozinho, 'erro')?.texto || ''));

for (const cliente of [ana, sozinho]) cliente.conexao.close();
process.exit(imprimir() ? 0 : 1);
