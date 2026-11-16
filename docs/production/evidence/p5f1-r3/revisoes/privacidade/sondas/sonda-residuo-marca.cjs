/*
 * Sonda de privacidade P5-F.1-R3 — resíduo de impressões digitais de versões passadas na marca.
 *
 * Reproduz, só com as funções puras compiladas do backend (build próprio da árvore revisada, idêntico a
 * functions/lib), o caminho do gatilho (applyCashPeriodWriteOnce: markGenerationsFor → markViewOf →
 * applyMarkEvent → markChainOf → markDocumentData, set sem merge) e o da varredura da reconstrução
 * (markAnchorPatch, set com merge). Nenhum Firestore, nenhum Emulator.
 *
 * Pergunta: depois de uma correção (ou de uma exclusão física de desenvolvimento), a marca que todo membro
 * ativo (inclusive viewer) lê guarda a impressão de um conteúdo que o lançamento não tem mais?
 *
 * Uso: NODE_PATH=<wt>/functions/node_modules node sonda-residuo-marca.cjs <dir do build das functions>
 */
'use strict';
const path = require('node:path');
const build = path.resolve(process.argv[2]);
const marks = require(path.join(build, 'cash/projectionMarks.js'));
const periods = require(path.join(build, 'cash/periods.js'));
const {Timestamp} = require('firebase-admin/firestore');

const WS = 'ws-sintetico';
const ID = 'tx-sintetico';
const ts = (sec, micros = 0) => new Timestamp(sec, micros * 1000);

// Documento real de lançamento (forma de createTransaction.ts / mutateTransaction.ts), dados sintéticos.
const created = ts(1_790_000_000, 123_456);
const v1 = {
  type: 'despesa', description: 'Sessão de terapia com Dra. Ana Exemplo', category: 'Saúde', categoryId: 'cat_saude',
  valueCents: 25_000, date: '2026-10-05', isPaid: true, cashAccountId: 'acc_1', workspaceId: WS, profileId: WS,
  profileType: 'PF', userId: 'uid-owner', createdBy: 'uid-owner', updatedBy: 'uid-owner',
  createdAt: created, updatedAt: created,
  cashEntry: {domainVersion: 1, origin: 'manual', status: 'confirmed', currency: 'BRL', requestHash: 'f'.repeat(64),
    quotaPeriod: '2026-10', accountMovementId: 'mv_apply_1'},
};
// Correção pelo titular (direito de correção): tira o nome da terceira pessoa e a referência de saúde.
const v2 = {...v1, description: 'Despesa pessoal', category: 'Outros', categoryId: 'cat_outros',
  updatedBy: 'uid-owner', updatedAt: ts(1_790_100_000, 654_321),
  cashEntry: {...v1.cashEntry, revision: 2, accountMovementId: 'mv_apply_2'}};

const fp = marks.transactionFingerprint;
const FP1 = fp(v1);
const FP2 = fp(v2);

// Estado da projeção (só os campos que markGenerationsFor lê).
const state = (over) => ({categoryGeneration: 'g0', baselineCutoff: null, markSlot: 'a', categoryStaging: null, ...over});

// Documento da marca "no Firestore" (objeto simples), com as escritas das duas rotas.
let stored;
const triggerWrite = (st, before, after, beforeUpdateTime, eventTime) => {
  const event = marks.markEventOf(before, after, beforeUpdateTime);
  const doc = marks.readMarkDoc(stored);
  for (const generation of periods.markGenerationsFor(st, eventTime)) {
    const next = marks.applyMarkEvent(marks.markViewOf(doc, generation), event, generation);
    doc.chains[generation.slot] = marks.markChainOf(next, generation);
  }
  stored = marks.markDocumentData(WS, ID, doc); // set sem merge (periods.ts)
};
const anchorWrite = (slot, anchor) => { // set com merge (rebuild.ts): mescla campo a campo do mapa anchors
  const patch = marks.markAnchorPatch(WS, ID, slot, anchor);
  stored = {...(stored ?? {}), ...patch, anchors: {...(stored?.anchors ?? {}), ...patch.anchors}};
};

const fpsIn = (doc) => {
  const found = [];
  const walk = (value, where) => {
    if (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) found.push({where, fp: value});
    else if (value && typeof value === 'object' && !(value instanceof Timestamp)) {
      for (const [k, v] of Object.entries(value)) walk(v, where ? `${where}.${k}` : k);
    }
  };
  walk({anchors: doc.anchors, chains: doc.chains}, '');
  return found;
};
const label = (value) => (value === FP1 ? 'fp(V1: conteúdo antes da correção)' : value === FP2 ? 'fp(V2: conteúdo atual)' : value);
const report = (title) => {
  const list = fpsIn(stored).map(({where, fp: value}) => `${where} = ${label(value)}`);
  console.log(`\n## ${title}`);
  for (const line of list) console.log(`  ${line}`);
  console.log(`  tamanho JSON da marca: ${JSON.stringify(stored).length} bytes`);
  return list;
};

// 1. Criação na geração inicial (g0, posição a).
triggerWrite(state(), undefined, v1, null, ts(1_790_000_000, 200_000));
report('1. criação na g0');
// 2. Reconstrução R1 (corte c1): âncora na posição preparada b; publicação passa markSlot para b.
const c1 = ts(1_790_050_000, 0);
anchorWrite('b', {g: 'R1', cut: c1, fp: FP1});
const afterR1 = state({categoryGeneration: 'R1', baselineCutoff: c1, markSlot: 'b'});
report('2. depois da reconstrução R1 (âncora em b)');
// 3. Correção V1 → V2 depois da publicação.
triggerWrite(afterR1, v1, v2, v1.updatedAt, ts(1_790_100_000, 900_000));
const afterFix = report('3. depois da correção V1 → V2 (o lançamento só tem V2)');
// 4. Exclusão física (só existe em desenvolvimento: Rules e backend não apagam lançamentos).
triggerWrite(afterR1, v2, undefined, v2.updatedAt, ts(1_790_200_000, 0));
report('4. depois de uma exclusão física de desenvolvimento');
// 5. Reconstrução R2 (corte c2): o lançamento não está na base; nada grava âncora para ele; publicação → a.
const c2 = ts(1_790_300_000, 0);
const afterR2 = state({categoryGeneration: 'R2', baselineCutoff: c2, markSlot: 'a'});
const final = report('5. depois da reconstrução R2 (lançamento fora da base: nenhum escritor toca a marca de novo)');

const residualAfterFix = afterFix.filter((line) => line.includes('V1'));
const residualFinal = final.filter((line) => line.includes('V1'));
console.log('\n## Resultado');
console.log(`  impressões de V1 que sobram na marca depois da correção: ${residualAfterFix.length}`);
console.log(`  impressões de V1 que sobram depois da exclusão e de R2: ${residualFinal.length}`);
console.log(`  visão da geração vigente (R2) pela regra do backend: ${JSON.stringify(marks.markViewOf(marks.readMarkDoc(stored), {id: 'R2', cutoff: c2, slot: 'a', role: 'published'}))}`);
if (residualAfterFix.length === 0) process.exitCode = 1;
