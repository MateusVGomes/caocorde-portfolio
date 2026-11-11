// Teste de ponta a ponta (servidor local de pé — ver auxiliares.mjs). Rodar: node testes/ponta-a-ponta/permissoes-da-musica.mjs
// Teste das permissões da música e do painel do admin, no servidor local (contas de teste).
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
    conexao.onmessage = evento => { const mensagem = JSON.parse(evento.data); recebidas.push(mensagem); if (mensagem.t === 'pronto') pronto({ conexao, recebidas, inicio: mensagem }); };
  });
}
const mandar = (cliente, mensagem) => cliente.conexao.send(JSON.stringify(mensagem));
const ultimaDoTipo = (cliente, tipo) => [...cliente.recebidas].reverse().find(mensagem => mensagem.t === tipo);

const beto = await conectar('teste.beto');
const ana = await conectar('teste.ana');
const canalDeVoz = beto.inicio.canais.find(canal => canal.tipo === 'voz').id;

// Fora da call: negado.
beto.recebidas.length = 0;
mandar(beto, { t: 'musica-add', canal: canalDeVoz, consulta: 'teste fora da call' });
await espera(500);
const erroForaDaCall = ultimaDoTipo(beto, 'erro');
conferir('fora da call: pôr música é negado', /Entre na call/.test(erroForaDaCall?.texto || ''), erroForaDaCall?.texto);
await espera(200);
mandar(beto, { t: 'musica-parar', canal: canalDeVoz });
await espera(500);
conferir('fora da call: parar música é negado', /Entre na call/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));

// Dentro da call: aceito.
mandar(beto, { t: 'voz-entrar', canal: canalDeVoz, sessao: 'teste-beto', mudo: true, trilhas: {} });
await espera(500);
beto.recebidas.length = 0;
mandar(beto, { t: 'musica-add', canal: canalDeVoz, consulta: 'teste dentro da call' });
await espera(600);
const estadoDaMusica = ultimaDoTipo(beto, 'musica');
const naFila = JSON.stringify(estadoDaMusica || {}).includes('teste dentro da call');
conferir('dentro da call: pôr música é aceito', naFila && !ultimaDoTipo(beto, 'erro'));
await espera(200);
mandar(beto, { t: 'musica-parar', canal: canalDeVoz });
await espera(500);
mandar(beto, { t: 'voz-sair' });

// Ação removida (musica-info) não faz nada.
await espera(200);
beto.recebidas.length = 0;
mandar(beto, { t: 'musica-info', canal: canalDeVoz, id: 1, titulo: 'renomeado por fora' });
await espera(400);
conferir('ação removida (musica-info) é ignorada', !ultimaDoTipo(beto, 'musica'));

// Painel do admin: a ana (admin) recebe os números; o beto não.
mandar(ana, { t: 'admin-dados' });
await espera(600);
const dados = ultimaDoTipo(ana, 'admin-dados');
const primeiroServidor = dados?.servidores?.[0];
conferir('admin recebe o painel com o uso do mês', !!primeiroServidor && 'mbVoz' in primeiroServidor && typeof primeiroServidor.mensagensMes === 'number', primeiroServidor ? `mb=${Math.round(primeiroServidor.mb)} mensagensMes=${primeiroServidor.mensagensMes}` : 'sem dados');
await espera(200);
beto.recebidas.length = 0;
mandar(beto, { t: 'admin-dados' });
await espera(500);
conferir('quem não é admin não recebe o painel', !ultimaDoTipo(beto, 'admin-dados') && /admin/.test(ultimaDoTipo(beto, 'erro')?.texto || ''));

beto.conexao.close(); ana.conexao.close();
console.log(resultados.join('\n'));

process.exit(0);
