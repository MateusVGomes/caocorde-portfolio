// Gera o processador de áudio dos filtros de ruído "Estúdio" e "Foco na voz" (src/audio/rnnoise-foco-na-voz.worklet.js).
//
// O QUE É: o RNNoise (biblioteca @sapphi-red/web-noise-suppressor, licença MIT) tira o ruído da voz e, a cada
// pedacinho de 10 ms ("quadro"), calcula a PROBABILIDADE DE SER VOZ (0 a 1). A biblioteca joga esse número fora.
// Este script copia o processador da biblioteca e encaixa um PORTÃO DE VOZ (noise gate) exatamente onde o número sai.
//   - "Estúdio": portão desligado — é o filtro de sempre (até a 0.5.7): tira chiado, microfonia e estouros.
//   - "Foco na voz": portão ligado — só passa o que parece VOZ HUMANA FALANDO, quadro a quadro.
//
// POR QUE "QUADRO A QUADRO": em obra a furadeira liga e desliga o tempo todo. Um filtro que precisa "observar" o
// barulho por um tempo antes de cortar deixaria vazar um pedaço cada vez que ela liga. Por isso cada quadro de 10 ms
// é julgado sozinho, só com o que dá para medir na hora (ver "O portão" abaixo).
//
// POR QUE GERAR E NÃO ESCREVER À MÃO: o RNNoise vem compilado (WebAssembly + código gerado) dentro do arquivo da
// biblioteca. Copiar com ajustes pequenos e conferidos é mais seguro que reescrever tudo.
//
// QUANDO RODAR: sozinho antes de cada "npm run build" (script "prebuild" do package.json). Se a biblioteca mudar
// por dentro e um ponto de encaixe sumir, o script PARA com erro (melhor que gerar um filtro quebrado).
// Testes: ferramentas/gerar-worklet-foco-na-voz.test.mjs (rodam o filtro de verdade, com fala e barulhos).
//
// Uso manual: node ferramentas/gerar-worklet-foco-na-voz.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pastaDoApp = join(dirname(fileURLToPath(import.meta.url)), '..');
const arquivoDaBiblioteca = join(pastaDoApp, 'node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise/workletProcessor.js');
const arquivoGerado = join(pastaDoApp, 'src/audio/rnnoise-foco-na-voz.worklet.js');

/** Nome do processador gerado (o da biblioteca continua existindo com o nome dela). */
export const NOME_DO_PROCESSADOR = 'concorde-rnnoise-foco-na-voz';

/** Faixa de volume da voz que vem marcada (em dB, relativo ao máximo do microfone). Ver CODIGO_DO_PORTAO. */
export const FAIXA_DA_VOZ_PADRAO = { minimoEmDb: -50, maximoEmDb: -10 };

// Pontos de encaixe no código da biblioteca (versão 0.4.x). Cada um tem de aparecer UMA vez.
// 1) Onde o RNNoise processa o quadro: medimos o volume ANTES (o volume real que a pessoa falou) e passamos a
//    probabilidade de voz para o portão DEPOIS.
const CHAMADA_ORIGINAL_DO_RNNOISE = 'n=e=>{u(e),t.processFrame(e),d(e)}';
const CHAMADA_COM_PORTAO = 'n=e=>{u(e);let volumeDeEntradaEmDb=volumeDoQuadroEmDb(e,32767);let probabilidadeDeVoz=t.processFrame(e);d(e);portaoDeVoz(e,probabilidadeDeVoz,volumeDeEntradaEmDb)}';
// 2) O construtor: lê as opções que a página mandou e liga a conversa com a página (faixa ao vivo e medidor).
const CONSTRUTOR_ORIGINAL = 'constructor(e){super(),';
const CONSTRUTOR_COM_OPCOES = 'constructor(e){super(),configurarPortao(e.processorOptions,this.port),';
// 3) O nome do processador.
const REGISTRO_ORIGINAL = 'registerProcessor(`@sapphi-red/web-noise-suppressor/rnnoise`';
const REGISTRO_NOVO = `registerProcessor(\`${NOME_DO_PROCESSADOR}\``;

/**
 * O portão, escrito por extenso. Roda dentro do processador de áudio, a cada quadro de 480 amostras (10 ms a 48 kHz).
 *
 * Um quadro "PARECE VOZ" quando as TRÊS coisas valem ao mesmo tempo, nele mesmo:
 *  1. VOLUME NA FAIXA DA VOZ: entre o mínimo (um sussurro) e o máximo (alguém falando alto, sem gritar).
 *     Abaixo do mínimo é barulho de fundo; acima do máximo é grito, pancada ou furadeira colada no microfone.
 *     A pessoa ajusta a faixa nas Configurações: sobe o mínimo ou desce o máximo se um barulho chato cair dentro.
 *  2. O RNNOISE ACHA QUE É VOZ: probabilidade de voz de 0,8 ou mais (média deste quadro com o anterior).
 *  3. TEM TOM DE VOZ: as cordas vocais vibram e dão um "tom" (70 a 400 Hz). Chiado, teclado e palma não têm tom.
 *
 * O portão ABRE no primeiro quadro que parece voz e FICA ABERTO mais 250 ms depois do último (para não cortar o fim
 * das palavras). Acima do máximo ele FECHA NA HORA, mesmo no meio da fala (protege o ouvido de quem escuta).
 * Abre em 5 ms e fecha em 60 ms (estouro: 5 ms), sem estalo. Fechado, o som cai para quase zero (-60 dB).
 */
const CODIGO_DO_PORTAO = `
// ---- Portão de voz do Concorde (gerado por ferramentas/gerar-worklet-foco-na-voz.mjs; não editar à mão) ----
const PROBABILIDADE_MINIMA_DE_VOZ = 0.8;
const ESPERA_ANTES_DE_FECHAR_EM_QUADROS = 25;        // 25 quadros de 10 ms = 250 ms
const GANHO_FECHADO = 0.001;                          // -60 dB
const PASSO_PARA_ABRIR_POR_AMOSTRA = 1 / (0.005 * 48000);
const PASSO_PARA_FECHAR_POR_AMOSTRA = 1 / (0.060 * 48000);
const PASSO_PARA_FECHAR_NO_ESTOURO_POR_AMOSTRA = 1 / (0.005 * 48000);
const QUADROS_ENTRE_MEDICOES_PARA_A_PAGINA = 5;       // manda o volume para o medidor da tela a cada 50 ms

let portaoLigadoNesteProcessador = true;              // false = "Estúdio" (só o RNNoise, sem portão)
let volumeMinimoDaVozEmDb = ${FAIXA_DA_VOZ_PADRAO.minimoEmDb};
let volumeMaximoDaVozEmDb = ${FAIXA_DA_VOZ_PADRAO.maximoEmDb};
let portaDaPagina = null;
let quadrosDesdeAUltimaMedicao = 0;
let portaoAberto = false;
let quadrosDesdeAUltimaVoz = 0;
let ganhoAtual = GANHO_FECHADO;
let probabilidadeDoQuadroAnterior = 0;

/** Lê as opções da página (processorOptions) e passa a ouvir mudanças da faixa ao vivo. */
function configurarPortao(opcoes, porta) {
  portaoLigadoNesteProcessador = opcoes?.portaoDeVozLigado !== false;
  aplicarFaixaDaVoz(opcoes?.faixaDaVoz);
  portaDaPagina = porta;
  porta.onmessage = evento => { if (evento.data?.tipo === 'faixa-da-voz') aplicarFaixaDaVoz(evento.data); };
}

function aplicarFaixaDaVoz(faixa) {
  if (Number.isFinite(faixa?.minimoEmDb)) volumeMinimoDaVozEmDb = faixa.minimoEmDb;
  if (Number.isFinite(faixa?.maximoEmDb)) volumeMaximoDaVozEmDb = faixa.maximoEmDb;
}

/** Volume do quadro em dB (0 dB = o máximo que o microfone registra). escalaMaxima: 32767 (antes do RNNoise). */
function volumeDoQuadroEmDb(amostras, escalaMaxima) {
  let somaDosQuadrados = 0;
  for (let posicao = 0; posicao < amostras.length; posicao++) somaDosQuadrados += amostras[posicao] * amostras[posicao];
  return 10 * Math.log10(somaDosQuadrados / amostras.length / (escalaMaxima * escalaMaxima) + 1e-12);
}

// Medidor de tom (autocorrelação) num sinal reduzido para 16 kHz (média de 3 amostras): de 70 Hz a 400 Hz.
const TAMANHO_DO_SINAL_REDUZIDO = 512;               // 32 ms a 16 kHz
const JANELA_DA_AUTOCORRELACAO = 256;
const MENOR_ATRASO = 40, MAIOR_ATRASO = 228;         // 16000/400 Hz e 16000/70 Hz
const sinalReduzido = new Float32Array(TAMANHO_DO_SINAL_REDUZIDO);
const tomDosUltimosQuadros = [0, 0, 0];

/** Guarda o quadro no sinal reduzido (16 kHz). Barato: roda em todo quadro, para o histórico ficar contínuo. */
function guardarNoSinalReduzido(amostras) {
  const novas = Math.floor(amostras.length / 3);
  sinalReduzido.copyWithin(0, novas);
  for (let posicao = 0; posicao < novas; posicao++) {
    sinalReduzido[TAMANHO_DO_SINAL_REDUZIDO - novas + posicao] = (amostras[3 * posicao] + amostras[3 * posicao + 1] + amostras[3 * posicao + 2]) / 3;
  }
}

/**
 * true se o trecho mais recente tem um tom claro (voz sonora); false para consoante, ruído e silêncio.
 * Caro (autocorrelação): só é chamado quando o quadro já passou nos outros dois testes.
 */
function temTomNoTrechoRecente() {
  const inicio = TAMANHO_DO_SINAL_REDUZIDO - JANELA_DA_AUTOCORRELACAO - MAIOR_ATRASO;
  let energiaDaJanela = 0;
  for (let posicao = 0; posicao < JANELA_DA_AUTOCORRELACAO; posicao++) energiaDaJanela += sinalReduzido[inicio + posicao] ** 2;
  if (energiaDaJanela < 1e-9) return false;
  for (let atraso = MENOR_ATRASO; atraso <= MAIOR_ATRASO; atraso++) {
    let produto = 0, energiaAtrasada = 0;
    for (let posicao = 0; posicao < JANELA_DA_AUTOCORRELACAO; posicao++) {
      const atual = sinalReduzido[inicio + posicao], atrasado = sinalReduzido[inicio + posicao + atraso];
      produto += atual * atrasado; energiaAtrasada += atrasado * atrasado;
    }
    if (produto / Math.sqrt(energiaDaJanela * energiaAtrasada + 1e-12) > 0.6) return true;
  }
  return false;
}

function portaoDeVoz(amostras, probabilidadeDeVoz, volumeDeEntradaEmDb) {
  // Medidor da tela (Configurações): volume de quem fala e se o portão está aberto. Vale nos dois filtros.
  if (portaDaPagina && ++quadrosDesdeAUltimaMedicao >= QUADROS_ENTRE_MEDICOES_PARA_A_PAGINA) {
    quadrosDesdeAUltimaMedicao = 0;
    portaDaPagina.postMessage({ tipo: 'nivel', volumeEmDb: volumeDeEntradaEmDb, portaoAberto: portaoLigadoNesteProcessador ? portaoAberto : true });
  }
  if (!portaoLigadoNesteProcessador) return;

  guardarNoSinalReduzido(amostras);
  const probabilidadeMedia = (probabilidadeDeVoz + probabilidadeDoQuadroAnterior) / 2;
  probabilidadeDoQuadroAnterior = probabilidadeDeVoz;

  const volumeNaFaixa = volumeDeEntradaEmDb >= volumeMinimoDaVozEmDb && volumeDeEntradaEmDb <= volumeMaximoDaVozEmDb;
  const acimaDoMaximo = volumeDeEntradaEmDb > volumeMaximoDaVozEmDb;
  const passouNosTestesBaratos = volumeNaFaixa && probabilidadeMedia >= PROBABILIDADE_MINIMA_DE_VOZ;
  tomDosUltimosQuadros.shift();
  tomDosUltimosQuadros.push(passouNosTestesBaratos && temTomNoTrechoRecente());
  const temTom = tomDosUltimosQuadros[0] || tomDosUltimosQuadros[1] || tomDosUltimosQuadros[2];
  const quadroPareceVoz = passouNosTestesBaratos && temTom;

  if (acimaDoMaximo) { portaoAberto = false; quadrosDesdeAUltimaVoz = ESPERA_ANTES_DE_FECHAR_EM_QUADROS; }
  else if (quadroPareceVoz) { portaoAberto = true; quadrosDesdeAUltimaVoz = 0; }
  else if (portaoAberto && ++quadrosDesdeAUltimaVoz > ESPERA_ANTES_DE_FECHAR_EM_QUADROS) portaoAberto = false;

  const ganhoDesejado = portaoAberto ? 1 : GANHO_FECHADO;
  const passoParaFechar = acimaDoMaximo ? PASSO_PARA_FECHAR_NO_ESTOURO_POR_AMOSTRA : PASSO_PARA_FECHAR_POR_AMOSTRA;
  for (let posicao = 0; posicao < amostras.length; posicao++) {
    if (ganhoAtual < ganhoDesejado) ganhoAtual = Math.min(ganhoDesejado, ganhoAtual + PASSO_PARA_ABRIR_POR_AMOSTRA);
    else if (ganhoAtual > ganhoDesejado) ganhoAtual = Math.max(ganhoDesejado, ganhoAtual - passoParaFechar);
    amostras[posicao] *= ganhoAtual;
  }
}
// ---- fim do portão; daqui para baixo é o processador da biblioteca (MIT), com as chamadas acima encaixadas ----
`;

/** Troca um trecho que tem de existir exatamente uma vez; senão para com erro explicando o que houve. */
function trocarUmaVez(texto, procurado, novo) {
  const vezes = texto.split(procurado).length - 1;
  if (vezes !== 1) {
    throw new Error(`Ponto de encaixe encontrado ${vezes} vez(es) (esperado: 1): ${procurado}\n`
      + 'A biblioteca @sapphi-red/web-noise-suppressor mudou por dentro. Ajuste este script (ver o comentário do topo).');
  }
  return texto.replace(procurado, novo);
}

/** Gera o texto do processador a partir do texto da biblioteca (separado para poder testar). */
export function gerarProcessador(textoDaBiblioteca) {
  let texto = trocarUmaVez(textoDaBiblioteca, CHAMADA_ORIGINAL_DO_RNNOISE, CHAMADA_COM_PORTAO);
  texto = trocarUmaVez(texto, CONSTRUTOR_ORIGINAL, CONSTRUTOR_COM_OPCOES);
  texto = trocarUmaVez(texto, REGISTRO_ORIGINAL, REGISTRO_NOVO);
  return CODIGO_DO_PORTAO + texto;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const gerado = gerarProcessador(readFileSync(arquivoDaBiblioteca, 'utf8'));
  mkdirSync(dirname(arquivoGerado), { recursive: true });
  writeFileSync(arquivoGerado, gerado);
  console.log(`Gerado: ${arquivoGerado} (${gerado.length} caracteres)`);
}
