/*
 * Sonda de privacidade P5-F.1-R3 — a impressão da versão ATUAL não acrescenta nada ao que o viewer já lê.
 *
 * O viewer lê o lançamento (Rules: `transactions` com `allow read: if isMember`) e pode calcular, com a mesma
 * função do cliente (`src/modules/work-time/projectionProof.ts`), a impressão que o gatilho grava em
 * `chains.*.node.fp`. Se as duas coincidem, a marca não revela nada sobre a versão atual que o próprio
 * documento já não revele. Confere também que uma diferença de 1 µs muda a impressão (o instante entra no hash).
 *
 * Uso: node --experimental-strip-types sonda-versao-atual.mjs <wt> <dir do build das functions>
 */
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const [wt, build] = process.argv.slice(2).map((p) => path.resolve(p));
const require = createRequire(path.join(wt, 'functions', 'package.json'));
const backend = require(path.join(build, 'cash/projectionMarks.js'));
const {Timestamp: AdminTimestamp} = require('firebase-admin/firestore');
const client = await import(pathToFileURL(path.join(wt, 'src/modules/work-time/projectionProof.ts')).href);
const webRequire = createRequire(path.join(wt, 'package.json'));
const {Timestamp: WebTimestamp} = webRequire('firebase/firestore');

const docWith = (T, micros) => ({
  type: 'receita', description: 'Recebimento', category: 'Salário', categoryId: 'cat_salario', valueCents: 500_000,
  date: '2026-10-05', isPaid: true, cashAccountId: 'acc_1', workspaceId: 'ws', profileId: 'ws', profileType: 'PF',
  userId: 'uid-owner', createdBy: 'uid-owner', updatedBy: 'uid-owner',
  createdAt: new T(1_790_000_000, 123_456_000), updatedAt: new T(1_790_000_000, micros * 1000),
  cashEntry: {domainVersion: 1, origin: 'manual', status: 'confirmed', currency: 'BRL', requestHash: 'a'.repeat(64),
    quotaPeriod: '2026-10', accountMovementId: 'mv_apply_1'},
});

const markNodeFp = backend.transactionFingerprint(docWith(AdminTimestamp, 123_456)); // o que o gatilho grava
const viewerFp = await client.transactionFingerprint(docWith(WebTimestamp, 123_456)); // o que o viewer calcula
const plusOneMicro = await client.transactionFingerprint(docWith(WebTimestamp, 123_457));
console.log(`fp gravado pelo gatilho (Admin SDK):     ${markNodeFp}`);
console.log(`fp calculado pelo viewer (SDK web):      ${viewerFp}`);
console.log(`iguais: ${markNodeFp === viewerFp}`);
console.log(`mesmo documento com updatedAt + 1 µs:    ${plusOneMicro} (diferente: ${plusOneMicro !== viewerFp})`);
if (markNodeFp !== viewerFp || plusOneMicro === viewerFp) process.exitCode = 1;
