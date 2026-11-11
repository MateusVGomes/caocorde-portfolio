// Auxiliares dos testes de ponta a ponta: falam com o SERVIDOR LOCAL de teste como a página falaria.
//
// Pré-requisito: o servidor local rodando (ver CLAUDE.md → "Testar"):
//   cd src/Cloudflare; npx.cmd wrangler dev --port 8790 --ip 127.0.0.1 --inspector-port 9332 --persist-to .wrangler/state-teste
// e as contas de teste teste.ana (admin do app) e teste.beto, senha Teste@2026, no servidor "Sacanas".
//
// ATENÇÃO: os testes erram convites de propósito, e o servidor bloqueia o endereço depois de 10 convites errados
// numa hora (LIMITES.convite em utilidades.js). Rodando muitas vezes seguidas, o teste do convidado passa a falhar
// com "não conectou" — é a trava funcionando. Espere uma hora, ou apague a linha "convite:" da tabela "tentativas" do
// banco de TESTE (.wrangler/state-teste) com o servidor local parado.

export const ENDERECO_DO_SERVIDOR_LOCAL = 'http://127.0.0.1:8790';
export const SENHA_DAS_CONTAS_DE_TESTE = 'Teste@2026';

export const esperar = milissegundos => new Promise(resolver => setTimeout(resolver, milissegundos));

/**
 * Mostra cada resultado NA HORA ("PASSOU  nome" / "FALHOU  nome  (detalhe)"): se o teste quebrar no meio, dá para
 * ver até onde foi. imprimir() no fim só diz se tudo passou.
 */
export function criarConferidor() {
  const resultados = [];
  return {
    conferir(nome, passou, detalhe = '') {
      const linha = `${passou ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? `  (${detalhe})` : ''}`;
      resultados.push(linha);
      console.log(linha);
    },
    imprimir() { return resultados.every(linha => linha.startsWith('PASSOU')); },
  };
}

/** POST com JSON; devolve { status, corpo, cookie }. */
export async function postar(caminho, corpo, cookie = '') {
  const resposta = await fetch(ENDERECO_DO_SERVIDOR_LOCAL + caminho, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(corpo),
  });
  return { status: resposta.status, corpo: await resposta.json().catch(() => ({})), cookie: resposta.headers.get('set-cookie')?.split(';')[0] || '' };
}

/** Entra com usuário e senha e devolve o cookie da sessão. */
export async function entrarComSenha(usuario, senha = SENHA_DAS_CONTAS_DE_TESTE) {
  return (await postar('/api/auth/entrar', { usuario, senha })).cookie;
}

/**
 * Abre o WebSocket com um cookie e espera o "pronto". Devolve { conexao, recebidas, inicio, id, fechou }.
 * recebidas guarda tudo que chegou; fechou vira { codigo, motivo } quando o servidor fecha a conexão.
 */
export function conectar(cookie) {
  return new Promise((pronto, falhou) => {
    const conexao = new WebSocket(ENDERECO_DO_SERVIDOR_LOCAL.replace('http', 'ws') + '/api/ws', { headers: { cookie } });
    const cliente = { conexao, recebidas: [], inicio: null, id: null, fechou: null };
    conexao.onmessage = evento => {
      const mensagem = JSON.parse(evento.data);
      cliente.recebidas.push(mensagem);
      if (mensagem.t === 'pronto') { cliente.inicio = mensagem; cliente.id = mensagem.eu.id; pronto(cliente); }
    };
    conexao.onclose = evento => { cliente.fechou = { codigo: evento.code, motivo: evento.reason }; if (!cliente.inicio) falhou(new Error(`não conectou (${evento.code})`)); };
    conexao.onerror = () => { if (!cliente.inicio) falhou(new Error('não conectou')); };
  });
}

export const mandar = (cliente, mensagem) => cliente.conexao.send(JSON.stringify(mensagem));

/**
 * Apaga os convites de CONVIDADO ativos de um servidor (o admin é quem chama). Os testes fazem isso no começo e no
 * fim: o servidor aceita no máximo 20 convites ativos, e rodadas seguidas de teste iam acumulando.
 */
export async function apagarConvitesDeConvidado(admin, servidorId) {
  const servidor = (ultimaDoTipo(admin, 'servidores') || admin.inicio).servidores.find(item => item.id === servidorId);
  for (const convite of (servidor?.codigos || []).filter(codigo => codigo.convidado === 1)) {
    mandar(admin, { t: 'codigo-apagar', id: servidorId, codigo: convite.codigo });
    await esperar(200);   // a trava contra excesso aceita uma ação a cada 150 ms
  }
  await esperar(300);
}
export const ultimaDoTipo = (cliente, tipo) => [...cliente.recebidas].reverse().find(mensagem => mensagem.t === tipo);
/** A lista de canais mais nova que o cliente recebeu (do "pronto" ou de uma atualização "servidores"). */
export const canaisAtuais = cliente => (ultimaDoTipo(cliente, 'servidores') || cliente.inicio).canais;
export const servidoresAtuais = cliente => (ultimaDoTipo(cliente, 'servidores') || cliente.inicio).servidores;
