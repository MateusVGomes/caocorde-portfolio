// Utilidades do servidor do Concorde, usadas por mais de um arquivo (comunidade.js, convidados.js):
// limpar texto que vem do usuário, hora atual, regras de usuário/e-mail/senha, o hash da senha e os limites de
// tentativas. Nada aqui guarda estado: são só funções e constantes.

/** Id do servidor original (o "Sacanas"): não pode ser apagado e tem o ícone fixo. */
export const SACANAS = 1;

/** Cores que a conta (e o servidor) recebem, sorteadas. */
export const PALETA = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
/** Nome de usuário: 3 a 20 letras minúsculas, números, ponto ou _. */
export const USUARIO = /^[a-z0-9_.]{3,20}$/;
export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** Hora atual em milissegundos (num lugar só, para os testes poderem trocar). */
export const agora = () => Date.now();

/** Texto que veio de fora: tira caracteres de controle, espaços nas pontas e corta no tamanho máximo. */
export const limpar = (valor, tamanhoMaximo) => String(valor ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, tamanhoMaximo);
export const limparEmail = email => limpar(email, 254).toLowerCase();

/** Bytes → texto hexadecimal. */
export const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** Código de convite de servidor: 8 letras/números fáceis de digitar (sem 0/o/1/l). */
export const novoConvite = () => [...crypto.getRandomValues(new Uint8Array(8))].map(byte => 'abcdefghjkmnpqrstuvwxyz23456789'[byte % 31]).join('');

/** Senha forte (padrão novo do 0.5): 8+ caracteres, maiúscula, minúscula, número e símbolo. null = ok. */
export function erroSenha(senha) {
  senha = String(senha || '');
  if (senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (senha.length > 200) return 'Senha longa demais.';
  if (!/[a-z]/.test(senha) || !/[A-Z]/.test(senha)) return 'A senha precisa ter letra maiúscula e minúscula.';
  if (!/[0-9]/.test(senha)) return 'A senha precisa ter pelo menos um número.';
  if (!/[^A-Za-z0-9]/.test(senha)) return 'A senha precisa ter pelo menos um símbolo (ex.: ! @ # $ %).';
  return null;
}

/**
 * Senha guardada como PBKDF2-SHA256 ENCADEADO: cada rodada faz 100 mil iterações (o máximo que o PBKDF2 do
 * Cloudflare aceita numa chamada) e o resultado de uma rodada vira a "senha" da rodada seguinte.
 * 6 rodadas = custo de 600 mil iterações para quem tenta adivinhar a senha, o mínimo que o OWASP recomenda hoje
 * para PBKDF2-SHA256: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 * Com 1 rodada o resultado é idêntico ao hash usado até a versão 0.5.6: conta antiga continua entrando e é
 * atualizada para 6 rodadas no próximo login (coluna usuarios.rodadas_senha).
 */
const ITERACOES_POR_RODADA = 100_000;
export const RODADAS_SENHA = 6;

export async function hashSenha(senha, saltHex, quantidadeDeRodadas = RODADAS_SENHA) {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/../g).map(parDeDigitosHex => parseInt(parDeDigitosHex, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  let entradaDaRodada = new TextEncoder().encode(senha);
  let resultadoDaRodada;
  for (let numeroDaRodada = 1; numeroDaRodada <= quantidadeDeRodadas; numeroDaRodada++) {
    const chave = await crypto.subtle.importKey('raw', entradaDaRodada, 'PBKDF2', false, ['deriveBits']);
    resultadoDaRodada = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERACOES_POR_RODADA }, chave, 256);
    entradaDaRodada = new Uint8Array(resultadoDaRodada);
  }
  return { hash: hex(resultadoDaRodada), salt: hex(salt), rodadas: quantidadeDeRodadas };
}

/** Compara dois textos sempre no mesmo tempo (não dá para adivinhar o hash pela demora da resposta). */
export function iguais(primeiro, segundo) {
  if (primeiro.length !== segundo.length) return false;
  let diferenca = 0;
  for (let posicao = 0; posicao < primeiro.length; posicao++) diferenca |= primeiro.charCodeAt(posicao) ^ segundo.charCodeAt(posicao);
  return diferenca === 0;
}

/** Tentativas erradas antes de bloquear por um tempo (senha por conta e por IP, convite por IP/conta): [quantas, janela em ms]. */
export const LIMITES = { conta: [10, 15 * 60_000], ip: [30, 15 * 60_000], convite: [10, 3600_000], avatar: [10, 3600_000], pedido: [3, 3600_000], esqueci: [10, 3600_000], amizade: [30, 3600_000], download: [5, 60_000] };
