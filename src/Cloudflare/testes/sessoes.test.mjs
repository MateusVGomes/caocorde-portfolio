// Testes da migração das sessões de login para hash (src/Cloudflare/src/sessoes.js).
// Rodar (na pasta src/Cloudflare):  npm test
// Usa um SQLite em memória (node:sqlite, já vem com o Node 22+) imitando o banco do Durable Object: nada de rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { hashDoTokenDeSessao, migrarSessoesParaHash } from '../src/sessoes.js';

/**
 * Banco em memória com a mesma "cara" do sql do Durable Object: exec(consulta, ...valores) devolve { toArray() }.
 * Também devolve a função de transação, como o ctx.storage.transactionSync.
 */
function criarBancoDeTeste() {
  const banco = new DatabaseSync(':memory:');
  const bancoDeDados = {
    exec(consulta, ...valores) {
      const comando = banco.prepare(consulta);
      const ehLeitura = /^\s*(SELECT|PRAGMA)/i.test(consulta);
      const linhas = ehLeitura ? comando.all(...valores) : (comando.run(...valores), []);
      return { toArray: () => linhas };
    },
  };
  const executarEmTransacao = funcao => {
    banco.exec('BEGIN');
    try { funcao(); banco.exec('COMMIT'); }
    catch (erro) { banco.exec('ROLLBACK'); throw erro; }   // erro no meio: desfaz tudo e avisa quem chamou
  };
  return { banco, bancoDeDados, executarEmTransacao };
}

const TOKEN_DA_ANA = 'a'.repeat(64);
const TOKEN_DO_BETO = 'b'.repeat(64);

/** Cria a tabela no formato antigo (até a 0.5.6), com o token puro, e duas sessões. */
function criarSessoesNoFormatoAntigo(bancoDeDados) {
  bancoDeDados.exec('CREATE TABLE sessoes (token TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, criado INTEGER NOT NULL)');
  bancoDeDados.exec('INSERT INTO sessoes VALUES (?,?,?)', TOKEN_DA_ANA, 1, 1000);
  bancoDeDados.exec('INSERT INTO sessoes VALUES (?,?,?)', TOKEN_DO_BETO, 2, 2000);
}

test('sessões antigas viram hash e continuam achando a mesma pessoa', async () => {
  const { bancoDeDados, executarEmTransacao } = criarBancoDeTeste();
  criarSessoesNoFormatoAntigo(bancoDeDados);

  const quantidadeConvertida = await migrarSessoesParaHash(bancoDeDados, executarEmTransacao);
  assert.equal(quantidadeConvertida, 2);

  // Quem tinha o token da Ana continua sendo a Ana (procurando pelo hash, como o servidor faz agora).
  const sessaoDaAna = bancoDeDados.exec('SELECT usuario_id, criado FROM sessoes WHERE token_hash = ?', await hashDoTokenDeSessao(TOKEN_DA_ANA)).toArray();
  assert.deepEqual(sessaoDaAna.map(linha => ({ ...linha })), [{ usuario_id: 1, criado: 1000 }]);
});

test('depois da migração o token puro não aparece mais no banco', async () => {
  const { bancoDeDados, executarEmTransacao } = criarBancoDeTeste();
  criarSessoesNoFormatoAntigo(bancoDeDados);
  await migrarSessoesParaHash(bancoDeDados, executarEmTransacao);

  const colunas = bancoDeDados.exec('PRAGMA table_info(sessoes)').toArray().map(coluna => coluna.name);
  assert.ok(!colunas.includes('token'), 'a coluna "token" (token puro) tem de sumir');
  const valoresGuardados = bancoDeDados.exec('SELECT token_hash FROM sessoes').toArray().map(linha => linha.token_hash);
  assert.ok(!valoresGuardados.includes(TOKEN_DA_ANA) && !valoresGuardados.includes(TOKEN_DO_BETO), 'nenhum token puro guardado');
});

test('rodar a migração de novo não muda nada (banco já migrado)', async () => {
  const { bancoDeDados, executarEmTransacao } = criarBancoDeTeste();
  criarSessoesNoFormatoAntigo(bancoDeDados);
  await migrarSessoesParaHash(bancoDeDados, executarEmTransacao);
  assert.equal(await migrarSessoesParaHash(bancoDeDados, executarEmTransacao), 0);
  assert.equal(bancoDeDados.exec('SELECT COUNT(*) AS total FROM sessoes').toArray()[0].total, 2);
});

test('banco novo (já nasce com token_hash) não é mexido', async () => {
  const { bancoDeDados, executarEmTransacao } = criarBancoDeTeste();
  bancoDeDados.exec('CREATE TABLE sessoes (token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL, criado INTEGER NOT NULL)');
  assert.equal(await migrarSessoesParaHash(bancoDeDados, executarEmTransacao), 0);
});

test('se der erro no meio, nada muda (as sessões antigas continuam lá)', async () => {
  const { bancoDeDados } = criarBancoDeTeste();
  criarSessoesNoFormatoAntigo(bancoDeDados);
  // Transação que falha no último passo: imita o servidor caindo no meio da troca de tabela.
  const transacaoQueFalha = funcao => {
    bancoDeDados.exec('BEGIN');
    try { funcao(); throw new Error('servidor caiu'); }
    catch (erro) { bancoDeDados.exec('ROLLBACK'); throw erro; }
  };
  await assert.rejects(migrarSessoesParaHash(bancoDeDados, transacaoQueFalha), /servidor caiu/);
  const colunas = bancoDeDados.exec('PRAGMA table_info(sessoes)').toArray().map(coluna => coluna.name);
  assert.ok(colunas.includes('token'), 'a tabela antiga continua intacta para tentar de novo');
  assert.equal(bancoDeDados.exec('SELECT COUNT(*) AS total FROM sessoes').toArray()[0].total, 2);
});

test('hash do token: mesmo token, mesmo hash; tokens diferentes, hashes diferentes', async () => {
  assert.equal(await hashDoTokenDeSessao(TOKEN_DA_ANA), await hashDoTokenDeSessao(TOKEN_DA_ANA));
  assert.notEqual(await hashDoTokenDeSessao(TOKEN_DA_ANA), await hashDoTokenDeSessao(TOKEN_DO_BETO));
  assert.match(await hashDoTokenDeSessao(TOKEN_DA_ANA), /^[0-9a-f]{64}$/);
});
