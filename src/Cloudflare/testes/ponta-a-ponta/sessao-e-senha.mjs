// Teste de ponta a ponta (servidor local de pé — ver auxiliares.mjs). Rodar: node testes/ponta-a-ponta/sessao-e-senha.mjs
// Teste da senha reforçada e da sessão com hash, no servidor local (contas de teste).
// Cada controle é testado dos dois lados: o que deve ser ACEITO e o que deve ser NEGADO.
const BASE = 'http://127.0.0.1:8790';
const resultados = [];
const conferir = (nome, passou, detalhe = '') => resultados.push(`${passou ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? '  (' + detalhe + ')' : ''}`);

async function entrar(usuario, senha) {
  const inicio = Date.now();
  const resposta = await fetch(BASE + '/api/auth/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario, senha }) });
  const corpo = await resposta.json().catch(() => ({}));
  return { status: resposta.status, corpo, cookie: resposta.headers.get('set-cookie')?.split(';')[0] || null, ms: Date.now() - inicio };
}
const quemSouEu = async cookie => (await fetch(BASE + '/api/eu', { headers: cookie ? { cookie } : {} })).json().catch(() => null);

// 1) Sessão criada ANTES da migração (cookie antigo passado como argumento) continua valendo.
const cookieAntigo = process.argv[2];
if (cookieAntigo) {
  const eu = await quemSouEu(cookieAntigo);
  conferir('sessão antiga continua logada depois da migração', !!eu?.usuario, eu?.usuario || 'sem usuário');
}

// 2) Login com a senha certa (conta antiga, 1 rodada) → entra e o hash é reforçado.
const primeiro = await entrar('teste.ana', 'Teste@2026');
conferir('senha certa entra (1º login, conta com hash antigo)', !!primeiro.cookie, `${primeiro.ms} ms`);
// 3) Login de novo: agora o hash é o reforçado (6 rodadas) e tem de continuar batendo.
const segundo = await entrar('teste.ana', 'Teste@2026');
conferir('senha certa entra de novo (hash já reforçado)', !!segundo.cookie, `${segundo.ms} ms`);
// 4) Senha errada é negada.
const errada = await entrar('teste.ana', 'Errada@2026');
conferir('senha errada é negada', !errada.cookie && /errad/i.test(errada.corpo?.erro || ''), errada.corpo?.erro);
// 5) Usuário que não existe: mesma mensagem (não revela quem tem conta).
const inexistente = await entrar('ninguem.aqui', 'Teste@2026');
conferir('usuário inexistente: mesma mensagem de erro', inexistente.corpo?.erro === errada.corpo?.erro, `${inexistente.ms} ms`);

// 6) O cookie novo funciona; token inventado não.
const eu = await quemSouEu(segundo.cookie);
conferir('cookie da sessão nova funciona', eu?.usuario === 'teste.ana');
const falso = await quemSouEu('concorde_sessao=' + 'a'.repeat(64));
conferir('token inventado é negado', !falso?.usuario);
// 7) O token puro não é a chave do banco: o hash do token, usado como token, não entra.
const tokenPuro = segundo.cookie.split('=')[1];
const hashDoToken = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tokenPuro)))].map(b => b.toString(16).padStart(2, '0')).join('');
const comHash = await quemSouEu('concorde_sessao=' + hashDoToken);
conferir('o hash guardado no banco não serve como token', !comHash?.usuario);

// 8) Sair da conta derruba a sessão.
await fetch(BASE + '/api/auth/sair', { method: 'POST', headers: { cookie: segundo.cookie } });
const depoisDeSair = await quemSouEu(segundo.cookie);
conferir('depois de sair, o cookie não vale mais', !depoisDeSair?.usuario);
// 9) A outra sessão (primeiro login) continua viva: sair de um aparelho não derruba o outro.
const outra = await quemSouEu(primeiro.cookie);
conferir('sair num aparelho não derruba o outro', outra?.usuario === 'teste.ana');

console.log(resultados.join('\n'));

process.exit(0);
