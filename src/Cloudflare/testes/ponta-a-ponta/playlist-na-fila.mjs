// Teste de ponta a ponta (servidor local de pé — ver auxiliares.mjs). Rodar: node testes/ponta-a-ponta/playlist-na-fila.mjs
// Teste do "musica-expandir" (playlist vira músicas na fila) no servidor local, contas de teste.
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
const filaDe = (cliente, canal) => [...cliente.recebidas].reverse().find(mensagem => mensagem.t === 'musica' && mensagem.canal === canal)?.fila || [];

const ana = await conectar('teste.ana');
const beto = await conectar('teste.beto');
const canal = ana.inicio.canais.find(canalDaLista => canalDaLista.tipo === 'voz').id;
mandar(ana, { t: 'voz-entrar', canal, sessao: 'teste-ana', mudo: true, trilhas: {} });
await espera(400);
mandar(ana, { t: 'musica-parar', canal });
await espera(300);

mandar(ana, { t: 'musica-add', canal, consulta: 'https://www.youtube.com/playlist?list=TESTE' });
await espera(150);
mandar(ana, { t: 'musica-add', canal, consulta: 'musica que ja esperava' });
await espera(400);
const itemDaPlaylist = filaDe(ana, canal)[0];
conferir('fila começa com o link da playlist e a outra música', filaDe(ana, canal).length === 2 && /playlist/.test(itemDaPlaylist?.consulta));

// Quem está fora da call não expande.
mandar(beto, { t: 'musica-expandir', canal, item: itemDaPlaylist.id, titulo: 'X', faixas: [{ consulta: 'invasor' }] });
await espera(400);
conferir('fora da call: recusado', /Entre na call/.test(ultimaDoTipo(beto, 'erro')?.texto || '') && filaDe(ana, canal).length === 2);

// Item errado (não é o do topo): ignorado.
mandar(ana, { t: 'musica-expandir', canal, item: itemDaPlaylist.id + 1, titulo: 'X', faixas: [{ consulta: 'nao devia entrar' }] });
await espera(400);
conferir('item que não é o do topo: ignorado', filaDe(ana, canal).length === 2);

// Expande com 3 músicas: ficam no lugar da playlist, antes da que já esperava.
ana.recebidas.length = 0;
mandar(ana, { t: 'musica-expandir', canal, item: itemDaPlaylist.id, titulo: 'Minha playlist', total: 3, faixas: [
  { consulta: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', titulo: 'Música 1', duracao: 200 },
  { consulta: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', titulo: 'Música 2', duracao: 210 },
  { consulta: 'Música 3 Artista audio', titulo: 'Música 3 — Artista', duracao: null },
] });
await espera(500);
const filaDepois = filaDe(ana, canal);
conferir('playlist vira 3 músicas + a que esperava continua depois', filaDepois.map(item => item.titulo || item.consulta).join(' | ') === 'Música 1 | Música 2 | Música 3 — Artista | musica que ja esperava', filaDepois.map(item => item.titulo || item.consulta).join(' | '));
conferir('as músicas da playlist ficam como "pôs" de quem pôs o link', filaDepois.every(item => item.por === ana.id));
conferir('aviso para quem está na call', /Minha playlist.*3 música/.test(ultimaDoTipo(ana, 'ok')?.texto || ''), ultimaDoTipo(ana, 'ok')?.texto);
conferir('quem está fora da call não recebe o aviso', !ultimaDoTipo(beto, 'ok'));

// Limite de 100: com 4 na fila, uma playlist de 150 no topo só ganha as vagas que sobram.
mandar(ana, { t: 'musica-parar', canal });
await espera(300);
mandar(ana, { t: 'musica-add', canal, consulta: 'https://soundcloud.com/x/sets/grande' });
await espera(150);
for (const numero of [1, 2, 3]) { mandar(ana, { t: 'musica-add', canal, consulta: `esperando ${numero}` }); await espera(150); }
await espera(300);
const playlistGrande = filaDe(ana, canal)[0];
mandar(ana, { t: 'musica-expandir', canal, item: playlistGrande.id, titulo: 'Grande', total: 150,
  faixas: Array.from({ length: 150 }, (_, posicao) => ({ consulta: `https://soundcloud.com/x/musica-${posicao + 1}` })) });
await espera(700);
const filaGrande = filaDe(ana, canal);
conferir('limite: a fila fica com 100 (97 da playlist + 3 que esperavam)', filaGrande.length === 100 && filaGrande.at(-1).consulta === 'esperando 3', `${filaGrande.length}`);
conferir('aviso diz quantas ficaram de fora', /53 ficaram de fora/.test(ultimaDoTipo(ana, 'ok')?.texto || ''), ultimaDoTipo(ana, 'ok')?.texto);

// Playlist vazia: o item some e avisa.
mandar(ana, { t: 'musica-parar', canal });
await espera(300);
mandar(ana, { t: 'musica-add', canal, consulta: 'https://www.youtube.com/playlist?list=VAZIA' });
await espera(400);
mandar(ana, { t: 'musica-expandir', canal, item: filaDe(ana, canal)[0].id, titulo: 'Vazia', faixas: [] });
await espera(400);
conferir('playlist vazia: sai da fila e avisa', filaDe(ana, canal).length === 0 && /vazia/.test(ultimaDoTipo(ana, 'ok')?.texto || ''));

mandar(ana, { t: 'voz-sair' });
await espera(200);
ana.conexao.close(); beto.conexao.close();
console.log(resultados.join('\n'));
process.exit(0);
