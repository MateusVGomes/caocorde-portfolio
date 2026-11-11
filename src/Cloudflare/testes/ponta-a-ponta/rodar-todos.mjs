// Roda todos os testes de ponta a ponta, um depois do outro, e mostra o resumo.
// Pré-requisito: o servidor local de pé (ver auxiliares.mjs). Rodar:  cd src/Cloudflare; npm.cmd run test:ponta-a-ponta
// Demora uns 3 minutos (o do convidado espera a tolerância de 2 minutos).

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pasta = dirname(fileURLToPath(import.meta.url));
const testes = readdirSync(pasta).filter(arquivo => arquivo.endsWith('.mjs') && !['auxiliares.mjs', 'rodar-todos.mjs'].includes(arquivo)).sort();
let falhas = 0;
for (const teste of testes) {
  const resultado = spawnSync(process.execPath, [join(pasta, teste)], { encoding: 'utf8' });
  const linhas = resultado.stdout.split('\n').filter(linha => /^(PASSOU|FALHOU)/.test(linha));
  const falhou = linhas.filter(linha => linha.startsWith('FALHOU'));
  const parouComErro = resultado.status !== 0 && falhou.length === 0;
  falhas += falhou.length + (parouComErro ? 1 : 0);
  console.log(`${falhou.length || parouComErro ? '✖' : '✔'} ${teste}: ${linhas.length - falhou.length} passou, ${falhou.length} falhou`);
  for (const linha of falhou) console.log(`    ${linha}`);
  if (resultado.status !== 0 && falhou.length === 0) console.log(`    (o teste parou com erro)\n${resultado.stderr.slice(-600)}`);
}
process.exit(falhas ? 1 : 0);
