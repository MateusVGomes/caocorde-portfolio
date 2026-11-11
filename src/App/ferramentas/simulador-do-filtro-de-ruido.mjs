// Roda o filtro de ruído do Concorde (src/audio/rnnoise-foco-na-voz.worklet.js) FORA do navegador, no Node.
//
// Para que serve: testar o filtro com som de verdade (fala + barulhos) de forma automática e repetível, sem abrir o
// app e sem depender do navegador. Usado por ferramentas/gerar-worklet-foco-na-voz.test.mjs.
//
// Como funciona: o processador foi feito para rodar dentro do "AudioWorklet" do navegador. Aqui imitamos o mínimo
// desse ambiente (registerProcessor, AudioWorkletProcessor, sampleRate) e chamamos process() em blocos de 128
// amostras, como o navegador faz. Cada chamada carrega o arquivo de novo (estado zerado, como um microfone novo).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const pastaDoApp = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TAXA_DE_AMOSTRAGEM = 48000;
const AMOSTRAS_POR_BLOCO = 128;

// O código compilado do RNNoise percebe que está no Node e procura estas duas coisas.
globalThis.__dirname = pastaDoApp;
globalThis.require = createRequire(import.meta.url);
globalThis.sampleRate = TAXA_DE_AMOSTRAGEM;
// Cada carga do RNNoise compilado registra "ouvintes" de erro no processo; nos testes ele é carregado várias vezes.
process.setMaxListeners(0);
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { addEventListener() {}, postMessage() {}, set onmessage(funcao) {} }; } };

const arquivoDoWasm = readFileSync(join(pastaDoApp, 'node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise.wasm'));
let vezesQueCarregou = 0;

/**
 * Passa as amostras (Float32Array, 48 kHz, mono, de -1 a 1) pelo filtro e devolve a saída.
 * @param {Float32Array} amostras
 * @param {{ portaoDeVozLigado?: boolean, faixaDaVoz?: { minimoEmDb: number, maximoEmDb: number } }} opcoes
 */
export async function filtrar(amostras, opcoes = {}) {
  let ClasseDoProcessador = null;
  globalThis.registerProcessor = (nome, classe) => { ClasseDoProcessador = classe; };
  await import(`${pathToFileURL(join(pastaDoApp, 'src/audio/rnnoise-foco-na-voz.worklet.js')).href}?carga=${++vezesQueCarregou}`);
  const wasm = arquivoDoWasm.buffer.slice(arquivoDoWasm.byteOffset, arquivoDoWasm.byteOffset + arquivoDoWasm.byteLength);
  const processador = new ClasseDoProcessador({ processorOptions: { wasmBinary: wasm, maxChannels: 1, portaoDeVozLigado: true, ...opcoes } });
  for (let tentativa = 0; tentativa < 200 && !processador.processor; tentativa++) await new Promise(pronto => setTimeout(pronto, 10));
  if (!processador.processor) throw new Error('o RNNoise não carregou');

  const saida = new Float32Array(amostras.length);
  for (let inicio = 0; inicio + AMOSTRAS_POR_BLOCO <= amostras.length; inicio += AMOSTRAS_POR_BLOCO) {
    const blocoDeSaida = new Float32Array(AMOSTRAS_POR_BLOCO);
    processador.process([[amostras.slice(inicio, inicio + AMOSTRAS_POR_BLOCO)]], [[blocoDeSaida]]);
    saida.set(blocoDeSaida, inicio);
  }
  processador.destroy();
  return saida;
}

/** Volume médio (dB, 0 = máximo) de um trecho, em segundos. */
export function volumeEmDb(amostras, inicioEmSegundos = 0, fimEmSegundos = amostras.length / TAXA_DE_AMOSTRAGEM) {
  const primeira = Math.floor(inicioEmSegundos * TAXA_DE_AMOSTRAGEM), ultima = Math.floor(fimEmSegundos * TAXA_DE_AMOSTRAGEM);
  let somaDosQuadrados = 0;
  for (let posicao = primeira; posicao < ultima; posicao++) somaDosQuadrados += amostras[posicao] ** 2;
  return 10 * Math.log10(somaDosQuadrados / Math.max(1, ultima - primeira) + 1e-12);
}

/** Lê um WAV de 16 bits, mono, 48 kHz (a fala de teste em ferramentas/amostras-de-som). */
export function lerWav(caminho) {
  const bytes = readFileSync(caminho);
  const posicaoDosDados = bytes.indexOf('data', 12) + 8;
  const quantidade = (bytes.length - posicaoDosDados) >> 1;
  const amostras = new Float32Array(quantidade);
  for (let posicao = 0; posicao < quantidade; posicao++) amostras[posicao] = bytes.readInt16LE(posicaoDosDados + 2 * posicao) / 32768;
  return amostras;
}

/** Barulhos de teste, todos com a mesma duração. Um gerador de números fixo deixa o teste repetível. */
export function barulhos(duracaoEmSegundos) {
  const quantidade = Math.floor(duracaoEmSegundos * TAXA_DE_AMOSTRAGEM);
  let semente = 12345;
  const aleatorio = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 1073741824 - 1; };
  let faseDoMotor = 0;
  return {
    chiadoAlto: Float32Array.from({ length: quantidade }, () => 0.3 * aleatorio()),
    chiadoBaixo: Float32Array.from({ length: quantidade }, () => 0.03 * aleatorio()),
    teclado: Float32Array.from({ length: quantidade }, (_, posicao) => (posicao % 7200 < 300 ? 0.5 * aleatorio() * Math.exp(-(posicao % 7200) / 60) : 0)),
    palmas: Float32Array.from({ length: quantidade }, (_, posicao) => (posicao % 24000 < 2400 ? 0.8 * aleatorio() * Math.exp(-(posicao % 24000) / 400) : 0)),
    // Furadeira colada no microfone: motor com tom (o RNNoise confunde com voz), bem acima do máximo da faixa (~ -6 dB).
    furadeiraAlta: Float32Array.from({ length: quantidade }, () => { faseDoMotor += 140 / TAXA_DE_AMOSTRAGEM; return 0.85 * (2 * (faseDoMotor % 1) - 1) + 0.1 * aleatorio(); }),
  };
}
