import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Reconciliação local das contas (D-30, P3-J) — executada como o operador a
 * executa.
 *
 * - Fora do Emulator (sem `FIRESTORE_EMULATOR_HOST`, ou com o projeto real)
 *   a ferramenta recusa antes de abrir qualquer conexão.
 * - No Emulator: simulação não escreve e aponta divergência (código 2);
 *   `--reparar` regrava o saldo esperado e a reconciliação seguinte fecha.
 *
 * Exige as Functions compiladas (`functions/lib`), como na suíte de
 * integração que roda antes desta.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório.');
}

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const SCRIPT = path.join(RAIZ, 'tools', 'accounts', 'reconciliar-contas.mjs');
const PROJETO_EMULADOR = 'minhas-financas-local';
const WORKSPACE = 'guard-reconciliacao-workspace';

const require = createRequire(import.meta.url);
const admin = require(path.join(RAIZ, 'functions', 'node_modules', 'firebase-admin'));
const db = () => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJETO_EMULADOR});
  return admin.firestore();
};

const run = (args, env) => spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd: RAIZ,
  encoding: 'utf8',
  env: {PATH: process.env.PATH, ...env},
});

const emulatorEnv = {
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
  GCLOUD_PROJECT: PROJETO_EMULADOR,
};

test('P3-J — reconciliação recusa qualquer alvo fora do Emulator', () => {
  for (const env of [
    {GCLOUD_PROJECT: PROJETO_EMULADOR},
    {...emulatorEnv, GCLOUD_PROJECT: 'sistema-financeiro-pesso-20698'},
    {FIRESTORE_EMULATOR_HOST: emulatorEnv.FIRESTORE_EMULATOR_HOST},
  ]) {
    const result = run([`--workspace=${WORKSPACE}`], env);
    assert.equal(result.status, 1, JSON.stringify(env));
    assert.match(result.stderr, /só roda no Emulator/);
  }
  const noWorkspace = run([], emulatorEnv);
  assert.equal(noWorkspace.status, 1);
  assert.match(noWorkspace.stderr, /--workspace/);
});

test('P3-J — simulação aponta divergência sem escrever; reparo fecha', async () => {
  const firestore = db();
  const base = `workspaces/${WORKSPACE}`;
  await firestore.recursiveDelete(firestore.doc(base));
  const ts = admin.firestore.Timestamp.now();
  await firestore.doc(`${base}/cash_accounts/acc_1`).set({
    id: 'acc_1', schemaVersion: 1, workspaceId: WORKSPACE, name: 'Caixa', accountType: 'cash',
    status: 'active', balanceCents: 1_500, currency: 'BRL', createdBy: 'u', updatedAt: ts,
  });
  for (const [id, amountCents] of [['acm_1', 1_000], ['acm_2', 400]]) {
    await firestore.doc(`${base}/cash_account_movements/${id}`).set({
      id, schemaVersion: 1, workspaceId: WORKSPACE, accountId: 'acc_1', kind: 'cash_transaction',
      amountCents, effectiveDate: '2026-10-01', sourceDomain: 'cash', sourceId: 'cash_1',
      sourceFactId: 'cash_1@r1', reversalOf: null, createdAt: ts,
    });
  }
  const dryRun = run([`--workspace=${WORKSPACE}`], emulatorEnv);
  assert.equal(dryRun.status, 2, dryRun.stderr);
  const report = JSON.parse(dryRun.stdout);
  assert.equal(report.mode, 'dry-run');
  assert.deepEqual(report.divergentAccountIds, ['acc_1']);
  assert.equal(report.accounts[0].expectedCents, 1_400);
  assert.equal(report.accounts[0].divergenceCents, 100);
  assert.equal((await firestore.doc(`${base}/cash_accounts/acc_1`).get()).get('balanceCents'), 1_500,
    'simulação não escreve');

  const repair = run([`--workspace=${WORKSPACE}`, '--reparar'], emulatorEnv);
  assert.equal(repair.status, 0, repair.stderr);
  const repaired = JSON.parse(repair.stdout);
  assert.deepEqual(repaired.repairedAccountIds, ['acc_1']);
  assert.deepEqual(repaired.after.divergentAccountIds, []);
  assert.equal((await firestore.doc(`${base}/cash_accounts/acc_1`).get()).get('balanceCents'), 1_400);
  await firestore.recursiveDelete(firestore.doc(base));
});
