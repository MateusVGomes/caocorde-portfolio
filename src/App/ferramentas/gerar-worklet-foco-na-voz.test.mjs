// Testes do gerador do filtro "Foco na voz" (ferramentas/gerar-worklet-foco-na-voz.mjs).
// Rodar: cd src/App; npm.cmd test
//
// O que garantem: (1) os pontos de encaixe ainda existem na biblioteca instalada (se ela mudar por dentro, o teste
// avisa antes de sair um filtro quebrado); (2) o arquivo gerado chama o portão com a probabilidade de voz e
// registra o processador com o nome que o voz.js usa; (3) o arquivo gerado no projeto está em dia.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gerarProcessador, NOME_DO_PROCESSADOR, FAIXA_DA_VOZ_PADRAO } from './gerar-worklet-foco-na-voz.mjs';
import { filtrar, volumeEmDb, lerWav, barulhos, TAXA_DE_AMOSTRAGEM } from './simulador-do-filtro-de-ruido.mjs';

const pastaDoApp = join(dirname(fileURLToPath(import.meta.url)), '..');
const textoDaBiblioteca = readFileSync(join(pastaDoApp, 'node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise/workletProcessor.js'), 'utf8');

test('o gerador encaixa o portão na biblioteca instalada', () => {
  const gerado = gerarProcessador(textoDaBiblioteca);
  assert.ok(gerado.includes('let probabilidadeDeVoz=t.processFrame(e);d(e);portaoDeVoz(e,probabilidadeDeVoz,volumeDeEntradaEmDb)'));
  assert.ok(gerado.includes('constructor(e){super(),configurarPortao(e.processorOptions,this.port),'));
  assert.ok(gerado.includes(`registerProcessor(\`${NOME_DO_PROCESSADOR}\``));
  assert.ok(!gerado.includes('registerProcessor(`@sapphi-red/web-noise-suppressor/rnnoise`'));
});

test('o voz.js usa o mesmo nome de processador e a mesma faixa da voz padrão', () => {
  const codigoDaVoz = readFileSync(join(pastaDoApp, 'src/voz.js'), 'utf8');
  assert.ok(codigoDaVoz.includes(`'${NOME_DO_PROCESSADOR}'`));
  assert.ok(codigoDaVoz.includes(`FAIXA_DA_VOZ_PADRAO = { minimoEmDb: ${FAIXA_DA_VOZ_PADRAO.minimoEmDb}, maximoEmDb: ${FAIXA_DA_VOZ_PADRAO.maximoEmDb} }`),
    'a faixa padrão do voz.js e a do gerador ficaram diferentes');
});

test('biblioteca mudada por dentro: o gerador para com erro em vez de gerar filtro quebrado', () => {
  assert.throws(() => gerarProcessador(textoDaBiblioteca.replace('t.processFrame(e)', 't.processarQuadro(e)')), /Ponto de encaixe/);
});

test('o arquivo gerado no projeto está em dia com o gerador', () => {
  const noProjeto = readFileSync(join(pastaDoApp, 'src/audio/rnnoise-foco-na-voz.worklet.js'), 'utf8');
  assert.equal(noProjeto, gerarProcessador(textoDaBiblioteca), 'rode: node ferramentas/gerar-worklet-foco-na-voz.mjs');
});

// ---------------- o filtro de verdade, com som (simulador-do-filtro-de-ruido.mjs) ----------------
// Fala: frase do sintetizador de voz do Windows (ferramentas/amostras-de-som). Barulhos: gerados, sempre iguais.
// "Bloqueado" = a saída fica pelo menos 50 dB abaixo da entrada. "Passa" = a fala perde no máximo 1,5 dB.

const fala = lerWav(join(pastaDoApp, 'ferramentas/amostras-de-som/fala-sintetizada.wav'));
const duracaoDaFala = fala.length / TAXA_DE_AMOSTRAGEM;
const barulhosDeTeste = barulhos(4);

test('Foco na voz: a fala passa inteira', async () => {
  const perda = volumeEmDb(fala) - volumeEmDb(await filtrar(fala));
  assert.ok(perda < 1.5, `a fala perdeu ${perda.toFixed(1)} dB`);
});

test('Foco na voz: fala baixinha (perto do sussurro) também passa', async () => {
  const falaBaixa = fala.map(amostra => amostra * 0.1);
  const perda = volumeEmDb(falaBaixa) - volumeEmDb(await filtrar(falaBaixa));
  assert.ok(perda < 1.5, `a fala baixa perdeu ${perda.toFixed(1)} dB`);
});

for (const nomeDoBarulho of ['chiadoAlto', 'chiadoBaixo', 'teclado', 'palmas', 'furadeiraAlta']) {
  test(`Foco na voz: bloqueia ${nomeDoBarulho}`, async () => {
    const barulho = barulhosDeTeste[nomeDoBarulho];
    const reducao = volumeEmDb(barulho, 0.5, 4) - volumeEmDb(await filtrar(barulho), 0.5, 4);
    assert.ok(reducao > 50, `${nomeDoBarulho} só caiu ${reducao.toFixed(1)} dB`);
  });
}

test('Foco na voz: fala por cima de chiado — o chiado some, a fala fica', async () => {
  const cena = barulhos(duracaoDaFala + 2).chiadoBaixo;
  for (let posicao = 0; posicao < fala.length; posicao++) cena[TAXA_DE_AMOSTRAGEM + posicao] += fala[posicao];
  const saida = await filtrar(cena);
  assert.ok(volumeEmDb(cena, 0.2, 0.9) - volumeEmDb(saida, 0.2, 0.9) > 50, 'o chiado antes da fala vazou');
  assert.ok(volumeEmDb(cena, 1, 1 + duracaoDaFala) - volumeEmDb(saida, 1, 1 + duracaoDaFala) < 1.5, 'a fala foi cortada');
});

test('Foco na voz: grito (acima do máximo da faixa) é segurado', async () => {
  const grito = fala.map(amostra => Math.max(-1, Math.min(1, amostra * 6)));
  assert.ok(volumeEmDb(grito) - volumeEmDb(await filtrar(grito)) > 6, 'o grito passou quase inteiro');
});

test('Foco na voz: baixar o máximo da faixa corta uma fala que passava', async () => {
  const comMaximoBaixo = await filtrar(fala, { faixaDaVoz: { minimoEmDb: -50, maximoEmDb: -40 } });
  assert.ok(volumeEmDb(fala) - volumeEmDb(comMaximoBaixo) > 20, 'a faixa ajustada não teve efeito');
});

test('Estúdio: não tem portão (fala e ruído de fundo continuam, como até a 0.5.7)', async () => {
  assert.ok(volumeEmDb(fala) - volumeEmDb(await filtrar(fala, { portaoDeVozLigado: false })) < 1.5);
  const chiado = barulhosDeTeste.chiadoAlto;
  assert.ok(volumeEmDb(chiado, 0.5, 4) - volumeEmDb(await filtrar(chiado, { portaoDeVozLigado: false }), 0.5, 4) < 10, 'o Estúdio virou portão');
});
