// Sessões de login do Concorde: o token de cada sessão fica só no cookie da pessoa; no banco fica o hash dele.
// Separado do comunidade.js para poder ser testado sozinho (teste: src/Cloudflare/testes/sessoes.test.mjs).

/** Converte bytes para texto hexadecimal (2 dígitos por byte). */
function bytesParaHex(bytes) {
  return [...new Uint8Array(bytes)].map(umByte => umByte.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash do token de sessão (SHA-256 em hexadecimal). É isto que fica no banco: quem conseguir ler o banco (backup,
 * erro nosso) não consegue entrar na conta de ninguém, porque não dá para voltar do hash para o token.
 * SHA-256 simples basta (diferente da senha): o token tem 256 bits aleatórios, não dá para adivinhar.
 */
export async function hashDoTokenDeSessao(tokenDeSessao) {
  return bytesParaHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tokenDeSessao)));
}

/**
 * Migração da versão 0.5.7: a tabela "sessoes" guardava o token puro (coluna "token"); passa a guardar só o hash
 * (coluna "token_hash"). Ninguém precisa entrar de novo: cada token antigo vira o hash dele.
 *
 * - bancoDeDados: o "sql" do Durable Object (exec(consulta, ...valores) devolve algo com toArray()).
 * - executarEmTransacao: roda uma função numa transação só (no Durable Object: ctx.storage.transactionSync).
 *
 * Os hashes são calculados antes (é assíncrono) e a troca de tabela acontece numa transação só: se o servidor cair
 * no meio, nada muda e a migração roda de novo na próxima vez. Devolve quantas sessões foram convertidas.
 */
export async function migrarSessoesParaHash(bancoDeDados, executarEmTransacao) {
  const colunasDaTabela = bancoDeDados.exec('PRAGMA table_info(sessoes)').toArray().map(coluna => coluna.name);
  if (!colunasDaTabela.includes('token')) return 0;   // já migrada (ou banco novo, que já nasce com token_hash)

  const sessoesAntigas = bancoDeDados.exec('SELECT token, usuario_id, criado FROM sessoes').toArray();
  const sessoesConvertidas = [];
  for (const sessaoAntiga of sessoesAntigas) {
    sessoesConvertidas.push([await hashDoTokenDeSessao(sessaoAntiga.token), sessaoAntiga.usuario_id, sessaoAntiga.criado]);
  }

  executarEmTransacao(() => {
    bancoDeDados.exec('CREATE TABLE IF NOT EXISTS sessoes_com_hash (token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, criado INTEGER NOT NULL)');
    for (const valoresDaSessao of sessoesConvertidas) {
      bancoDeDados.exec('INSERT OR IGNORE INTO sessoes_com_hash (token_hash, usuario_id, criado) VALUES (?,?,?)', ...valoresDaSessao);
    }
    bancoDeDados.exec('DROP TABLE sessoes');
    bancoDeDados.exec('ALTER TABLE sessoes_com_hash RENAME TO sessoes');
  });
  return sessoesConvertidas.length;
}
