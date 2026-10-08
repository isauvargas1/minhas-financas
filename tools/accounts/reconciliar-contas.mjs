#!/usr/bin/env node
/**
 * Reconciliação local das contas/carteiras (D-30, P3-J) — SOMENTE Emulator.
 *
 * Recalcula o saldo esperado de cada conta de um workspace pela soma dos
 * movimentos do livro-razão (`cash_account_movements`) e compara com o saldo
 * gravado (`balanceCents`). Sem `--reparar` é simulação: nada é escrito e o
 * relatório lista as divergências. Com `--reparar`, o saldo esperado das
 * contas divergentes é regravado — e isso só existe no Emulator.
 *
 * Não substitui a reconciliação agendada de produção (P7).
 *
 * Uso (com o Emulator no ar e as Functions compiladas):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   GCLOUD_PROJECT=minhas-financas-local \
 *     node tools/accounts/reconciliar-contas.mjs --workspace=<id> [--reparar]
 *
 * Saída: JSON do relatório; código 0 sem divergência, 2 com divergência
 * (depois do reparo, conta-se o que ainda diverge), 1 em erro de uso.
 */

import {createRequire} from 'node:module';

const PROJETO_EMULADOR = 'minhas-financas-local';

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.length > 0 ? rest.join('=') : 'true'];
}));

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
if (!process.env.FIRESTORE_EMULATOR_HOST || projectId !== PROJETO_EMULADOR) {
  fail(`Recusado: a reconciliação local só roda no Emulator (${PROJETO_EMULADOR}), ` +
    'com FIRESTORE_EMULATOR_HOST definido.');
}
const workspaceId = args.get('workspace');
if (!workspaceId || workspaceId === 'true') {
  fail('Informe --workspace=<id>.');
}

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
const {runCashAccountReconciliation} =
  require('../../functions/lib/accounts/reconciliation.js');

admin.initializeApp({projectId: PROJETO_EMULADOR});

const repair = args.get('reparar') === 'true';
const first = await runCashAccountReconciliation(workspaceId, {repair});
const report = repair ?
  {...first, after: await runCashAccountReconciliation(workspaceId)} :
  first;
console.log(JSON.stringify(report, null, 2));
const remaining = repair ? report.after.divergentAccountIds : first.divergentAccountIds;
process.exit(remaining.length > 0 || first.orphanMovementCount > 0 ? 2 : 0);
