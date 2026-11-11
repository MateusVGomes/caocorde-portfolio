// Cria o par de chaves do COFRE do Caocorde (ver src/Cloudflare/src/cofre.js).
//
// Rodar UMA vez, no seu PC:   node ferramentas/criar-chave-do-cofre.mjs "E:\"
// (o argumento é a pasta onde salvar a chave privada — de preferência um pen drive)
//
// Gera:
//   - cofre-chave-PRIVADA.json  → na pasta que você escolheu. É a única coisa que abre o cofre. Guarde fora da
//     internet. NÃO mande para ninguém, não suba no GitHub e não cole no chat (nem para o Claude).
//     Perdeu = os registros guardados nunca mais abrem (isso é de propósito).
//   - cofre-chave-publica.json  → na pasta do projeto (src/Cloudflare). Só tranca, não abre: pode ficar público.
//     O conteúdo dela vai na var COFRE_CHAVE_PUBLICA do wrangler.jsonc (o script mostra a linha pronta).

import { writeFile, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pastaDaChavePrivada = process.argv[2];
if (!pastaDaChavePrivada) {
  console.log('Diga onde salvar a chave PRIVADA (de preferência um pen drive). Exemplo:\n  node ferramentas/criar-chave-do-cofre.mjs "E:\\"');
  process.exit(1);
}
const arquivoDaChavePrivada = join(resolve(pastaDaChavePrivada), 'cofre-chave-PRIVADA.json');
try { await access(arquivoDaChavePrivada); console.log(`Já existe ${arquivoDaChavePrivada}. Não sobrescrevo (perder a antiga = não abrir os registros dela).`); process.exit(1); } catch { /* não existe: segue */ }

const par = await crypto.subtle.generateKey(
  { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
const chavePublica = await crypto.subtle.exportKey('jwk', par.publicKey);
const chavePrivada = await crypto.subtle.exportKey('jwk', par.privateKey);

await writeFile(arquivoDaChavePrivada, JSON.stringify(chavePrivada), { flag: 'wx' });
const pastaDoProjeto = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'Cloudflare');
await writeFile(join(pastaDoProjeto, 'cofre-chave-publica.json'), JSON.stringify(chavePublica));

console.log(`Chave PRIVADA salva em: ${arquivoDaChavePrivada}  (guarde fora da internet)`);
console.log('Chave pública salva em: src/Cloudflare/cofre-chave-publica.json');
console.log('\nAgora avise o Claude: "criei a chave do cofre". Ele coloca a chave pública no wrangler.jsonc.');
