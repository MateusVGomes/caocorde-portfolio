// COFRE — guarda, cifrado, o registro das mensagens de uma conta que o admin apagou (0.5.10).
//
// Por quê: ao apagar uma conta, as mensagens dela somem do app. Mas, por segurança (golpe, ameaça, investigação),
// fica uma cópia num "cofre" que NINGUÉM consegue ler pelo app, nem o admin.
//
// Como funciona (criptografia "de mão única" para quem grava):
//   - O servidor só tem a chave PÚBLICA (var COFRE_CHAVE_PUBLICA no wrangler.jsonc). Com ela dá para TRANCAR,
//     nunca para abrir.
//   - A chave PRIVADA (a que abre) é criada por ferramentas/criar-chave-do-cofre.mjs no PC do dono e guardada fora
//     da internet (pen drive). Ela nunca vai para o servidor, para o GitHub nem para o chat.
//   - Cada registro: uma chave AES-256-GCM sorteada cifra os dados; essa chave é trancada com RSA-OAEP-4096
//     (SHA-256) usando a chave pública. Fica no R2 em cofre/<data>-conta-<id>.json.
//   - Para abrir um dia (análise por uma ferramenta própria): ferramentas/abrir-cofre.mjs com a chave privada.

const textoParaBytes = texto => new TextEncoder().encode(texto);
/** Bytes → base64 em pedaços (passar milhões de bytes de uma vez para fromCharCode estoura a pilha). */
function bytesParaBase64(bytes) {
  const todos = new Uint8Array(bytes);
  let texto = '';
  for (let inicio = 0; inicio < todos.length; inicio += 0x8000) texto += String.fromCharCode(...todos.subarray(inicio, inicio + 0x8000));
  return btoa(texto);
}

/** O cofre está pronto para gravar? (a chave pública foi configurada) */
export function cofreConfigurado(env) {
  return !!(env.COFRE_CHAVE_PUBLICA && env.ARQUIVOS);
}

/**
 * Tranca `dados` (qualquer objeto) e grava no R2. Devolve a chave do arquivo no R2.
 * Lança erro se o cofre não estiver configurado ou a gravação falhar (aí a conta NÃO é apagada).
 */
export async function guardarNoCofre(env, nomeDoRegistro, dados) {
  if (!cofreConfigurado(env)) throw new Error('o cofre ainda não foi configurado (COFRE_CHAVE_PUBLICA)');
  const chavePublicaJwk = typeof env.COFRE_CHAVE_PUBLICA === 'string' ? JSON.parse(env.COFRE_CHAVE_PUBLICA) : env.COFRE_CHAVE_PUBLICA;
  const chavePublica = await crypto.subtle.importKey('jwk', chavePublicaJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const chaveDosDados = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const vetorInicial = crypto.getRandomValues(new Uint8Array(12));
  const dadosCifrados = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: vetorInicial }, chaveDosDados, textoParaBytes(JSON.stringify(dados)));
  const chaveDosDadosCifrada = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, chavePublica, await crypto.subtle.exportKey('raw', chaveDosDados));
  const registro = {
    formato: 'caocorde-cofre-1', algoritmo: 'RSA-OAEP-4096-SHA256 + AES-256-GCM', criado: new Date().toISOString(),
    chave: bytesParaBase64(chaveDosDadosCifrada), iv: bytesParaBase64(vetorInicial), dados: bytesParaBase64(dadosCifrados),
  };
  const chaveNoR2 = `cofre/${new Date().toISOString().replace(/[:.]/g, '-')}-${nomeDoRegistro}.json`;
  await env.ARQUIVOS.put(chaveNoR2, JSON.stringify(registro), { httpMetadata: { contentType: 'application/json' } });
  return chaveNoR2;
}
