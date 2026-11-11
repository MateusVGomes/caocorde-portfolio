// Abre UM registro do cofre do Caocorde (ver src/Cloudflare/src/cofre.js) com a chave PRIVADA.
// Feito para a futura ferramenta de análise; rodar só no PC, sem internet de preferência:
//   node ferramentas/abrir-cofre.mjs <cofre-chave-PRIVADA.json> <registro.json>
// Mostra o conteúdo (JSON) na tela. Não grava nada.

import { readFile } from 'node:fs/promises';

const [arquivoDaChave, arquivoDoRegistro] = process.argv.slice(2);
if (!arquivoDaChave || !arquivoDoRegistro) { console.log('Uso: node ferramentas/abrir-cofre.mjs <chave-PRIVADA.json> <registro.json>'); process.exit(1); }
const base64ParaBytes = texto => Uint8Array.from(atob(texto), caractere => caractere.charCodeAt(0));

const chavePrivada = await crypto.subtle.importKey('jwk', JSON.parse(await readFile(arquivoDaChave, 'utf8')), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
const registro = JSON.parse(await readFile(arquivoDoRegistro, 'utf8'));
const chaveDosDadosCrua = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, chavePrivada, base64ParaBytes(registro.chave));
const chaveDosDados = await crypto.subtle.importKey('raw', chaveDosDadosCrua, 'AES-GCM', false, ['decrypt']);
const dados = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ParaBytes(registro.iv) }, chaveDosDados, base64ParaBytes(registro.dados));
console.log(JSON.stringify(JSON.parse(new TextDecoder().decode(dados)), null, 2));
