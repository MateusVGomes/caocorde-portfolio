// Teste de ponta a ponta (servidor local de pé — ver auxiliares.mjs). Rodar: node testes/ponta-a-ponta/moderacao-de-voz.mjs
// Teste da moderação de voz (mutar, ensurdecer, desconectar) no servidor local, contas de teste.
// teste.ana = admin do app; teste.beto = pessoa comum.
const BASE = 'http://127.0.0.1:8790';
const espera = ms => new Promise(resolver => setTimeout(resolver, ms));
const resultados = [];
const conferir = (nome, passou, detalhe = '') => resultados.push(`${passou ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  (' + detalhe + ')' : ''}`);

async function conectar(usuario) {
  const resposta = await fetch(BASE + '/api/auth/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario, senha: 'Teste@2026' }) });
  const cookie = resposta.headers.get('set-cookie').split(';')[0];
  return new Promise(pronto => {
    const conexao = new WebSocket(BASE.replace('http', 'ws') + '/api/ws', { headers: { cookie } });
    const recebidas = [];
    conexao.onmessage = evento => { const mensagem = JSON.parse(evento.data); recebidas.push(mensagem); if (mensagem.t === 'pronto') pronto({ conexao, recebidas, inicio: mensagem, id: mensagem.eu.id }); };
  });
}
const mandar = (cliente, mensagem) => cliente.conexao.send(JSON.stringify(mensagem));
const ultimaDoTipo = (cliente, tipo) => [...cliente.recebidas].reverse().find(mensagem => mensagem.t === tipo);
const estadoDe = (cliente, canal, uid) => (ultimaDoTipo(cliente, 'voz')?.voz?.[canal] || []).find(participante => participante.uid === uid);

const ana = await conectar('teste.ana');
const beto = await conectar('teste.beto');
const canal = ana.inicio.canais.find(canalDaLista => canalDaLista.tipo === 'voz').id;
mandar(ana, { t: 'voz-entrar', canal, sessao: 'teste-ana', mudo: true, trilhas: {} });
await espera(300);
mandar(beto, { t: 'voz-entrar', canal, sessao: 'teste-beto', mudo: true, trilhas: {} });
await espera(600);

// Quem não é admin não modera.
beto.recebidas.length = 0;
mandar(beto, { t: 'voz-moderar', uid: ana.id, acao: 'mutar' });
await espera(400);
conferir('quem não é admin não consegue mutar ninguém', /Só admin/.test(ultimaDoTipo(beto, 'erro')?.texto || ''), ultimaDoTipo(beto, 'erro')?.texto);
conferir('...e a ana continua sem mute de admin', !estadoDe(ana, canal, ana.id)?.mutadoPeloAdmin);

// Ninguém modera a si mesmo.
await espera(200);
ana.recebidas.length = 0;
mandar(ana, { t: 'voz-moderar', uid: ana.id, acao: 'mutar' });
await espera(400);
conferir('admin não modera a si mesmo', /você mesmo/.test(ultimaDoTipo(ana, 'erro')?.texto || ''));

// Admin muta o beto: todo mundo recebe o estado.
await espera(200);
mandar(ana, { t: 'voz-moderar', uid: beto.id, acao: 'mutar' });
await espera(500);
conferir('admin muta: o próprio beto recebe "mutado pelo admin"', estadoDe(beto, canal, beto.id)?.mutadoPeloAdmin === true);
conferir('admin muta: os outros também recebem', estadoDe(ana, canal, beto.id)?.mutadoPeloAdmin === true);

// Ensurdecer também.
await espera(200);
mandar(ana, { t: 'voz-moderar', uid: beto.id, acao: 'ensurdecer' });
await espera(500);
const estadoDoBeto = estadoDe(beto, canal, beto.id);
conferir('ensurdecer soma com o mute (os dois valem)', estadoDoBeto?.ensurdecidoPeloAdmin === true && estadoDoBeto?.mutadoPeloAdmin === true);

// Sai e entra de novo: o mute continua (guardado por servidor).
await espera(200);
mandar(beto, { t: 'voz-sair' });
await espera(300);
mandar(beto, { t: 'voz-entrar', canal, sessao: 'teste-beto-2', mudo: false, trilhas: {} });
await espera(500);
conferir('mute do admin continua depois de sair e entrar', estadoDe(ana, canal, beto.id)?.mutadoPeloAdmin === true);

// Tira os dois.
await espera(200);
mandar(ana, { t: 'voz-moderar', uid: beto.id, acao: 'desmutar' });
await espera(200);
mandar(ana, { t: 'voz-moderar', uid: beto.id, acao: 'desensurdecer' });
await espera(500);
const depoisDeTirar = estadoDe(ana, canal, beto.id);
conferir('admin tira o mute e o som', depoisDeTirar && !depoisDeTirar.mutadoPeloAdmin && !depoisDeTirar.ensurdecidoPeloAdmin);

// Desconectar: tira só da call, com o motivo.
await espera(200);
beto.recebidas.length = 0;
mandar(ana, { t: 'voz-moderar', uid: beto.id, acao: 'desconectar' });
await espera(500);
const expulso = ultimaDoTipo(beto, 'voz-expulso');
conferir('desconectar: o beto recebe o aviso com o motivo "admin"', expulso?.motivo === 'admin', expulso?.por);
conferir('desconectar: o beto some da call', !estadoDe(ana, canal, beto.id));
conferir('desconectar: o beto continua conectado ao servidor', beto.conexao.readyState === 1);

// Pessoa fora da call: não dá para moderar.
await espera(200);
ana.recebidas.length = 0;
mandar(ana, { t: 'voz-moderar', uid: beto.id, acao: 'mutar' });
await espera(400);
conferir('pessoa fora da call: avisa em vez de fazer nada calado', /não está numa call/.test(ultimaDoTipo(ana, 'erro')?.texto || ''));

mandar(ana, { t: 'voz-sair' });
await espera(200);
ana.conexao.close(); beto.conexao.close();
console.log(resultados.join('\n'));

process.exit(0);
