import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {
  executeMigrateLegacyInvestments,
  reconcileLegacyMigration,
} from "../legacyMigration";

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};
const at = (iso: string) => Timestamp.fromDate(new Date(iso));

const setup = async (workspace: string, owner: string) => {
  await db().recursiveDelete(db().doc(`workspaces/${workspace}`));
  await db().doc(`workspaces/${workspace}`).set({
    ownerId: owner, type: "PF", currency: "BRL", name: workspace,
  });
  await db().doc(`workspaces/${workspace}/members/${owner}`)
    .set({uid: owner, role: "owner", status: "active"});
};

const runMigration = async (workspace: string, owner: string, key: string) => {
  const auth: WorkspaceAuthorizationContext = {
    workspaceId: workspace, uid: owner, role: "owner",
  };
  let last: Record<string, unknown> = {};
  for (let page = 0; page < 20; page += 1) {
    last = await executeMigrateLegacyInvestments(auth, {
      workspaceId: workspace, idempotencyKey: key,
      correlationId: `corr-${key}`, pageSize: 10, dryRun: false,
      reason: "verificação de regressão",
    } as never);
    if (last.completed === true) break;
  }
  return last;
};

const totals = async (workspace: string) => {
  const positions = await db()
    .collection(`workspaces/${workspace}/investment_positions`).get();
  return {
    principal: positions.docs.reduce(
      (t, d) => t + Number(d.data().principalCents ?? 0), 0),
    gain: positions.docs.reduce(
      (t, d) => t + Number(d.data().realizedGainCents ?? 0), 0),
  };
};

test("resgate estornado no legado preserva o principal na migração", async () => {
  const ws = "verif-estorno"; const owner = "verif-estorno-owner";
  await setup(ws, owner);
  const doc = (path: string) => db().doc(`workspaces/${ws}/${path}`);

  await doc("transactions/a-aporte").set({
    type: "investimento", description: "Aporte", category: "CDB",
    value: 1_000, valueCents: 100_000, date: "2026-06-10",
    transactionDate: at("2026-06-10T15:00:00.000Z"),
    isPaid: true, userId: owner, workspaceId: ws,
  });
  await doc("transactions/b-resgate").set({
    type: "investimento", description: "Resgate", category: "CDB",
    value: 450, valueCents: 45_000, date: "2026-07-05",
    transactionDate: at("2026-07-05T15:00:00.000Z"),
    isPaid: true, userId: owner, workspaceId: ws,
    investmentMetadata: {
      currency: "BRL", investmentOperation: "redemption",
      cashImpact: "inflow", investmentImpact: "decrease",
      principalCents: 40_000, gainCents: 5_000, feesCents: 0, taxCents: 0,
      status: "reversed", sourceMovementId: "a-aporte",
      idempotencyKey: "k1", reversalMovementId: "c-estorno",
    },
  });
  await doc("transactions/c-estorno").set({
    type: "investimento", description: "Estorno: Resgate", category: "CDB",
    value: 450, valueCents: 45_000, date: "2026-07-06",
    transactionDate: at("2026-07-06T15:00:00.000Z"),
    isPaid: true, userId: owner, workspaceId: ws,
    investmentMetadata: {
      currency: "BRL", investmentOperation: "redemption_reversal",
      cashImpact: "outflow", investmentImpact: "increase",
      principalCents: 40_000, gainCents: 5_000, feesCents: 0, taxCents: 0,
      status: "settled", sourceMovementId: "b-resgate", idempotencyKey: "k2",
    },
  });

  await runMigration(ws, owner, "verif-estorno-key");
  const {principal, gain} = await totals(ws);
  const rec = await reconcileLegacyMigration(ws, 50);
  assert.equal(principal, 100_000, "principal deve voltar ao valor do aporte");
  assert.equal(gain, 0, "estorno anula o ganho do resgate revertido");
  assert.equal(rec.reconciled, true);
  assert.equal(rec.legacyPrincipalCents, 100_000);
  assert.equal(rec.legacyRealizedGainCents, 0);
});

test("resgate com docId anterior ao aporte migra na ordem cronológica", async () => {
  const ws = "verif-ordem"; const owner = "verif-ordem-owner";
  await setup(ws, owner);
  const doc = (path: string) => db().doc(`workspaces/${ws}/${path}`);

  // O resgate é mais recente, mas seu docId ordena antes do aporte.
  await doc("transactions/aaa-resgate").set({
    type: "investimento", description: "Resgate", category: "CDB",
    value: 450, valueCents: 45_000, date: "2026-08-05",
    transactionDate: at("2026-08-05T15:00:00.000Z"),
    isPaid: true, userId: owner, workspaceId: ws,
    investmentMetadata: {
      currency: "BRL", investmentOperation: "redemption",
      cashImpact: "inflow", investmentImpact: "decrease",
      principalCents: 40_000, gainCents: 5_000, feesCents: 0, taxCents: 0,
      status: "settled", sourceMovementId: "zzz-aporte", idempotencyKey: "k1",
    },
  });
  await doc("transactions/zzz-aporte").set({
    type: "investimento", description: "Aporte", category: "CDB",
    value: 1_000, valueCents: 100_000, date: "2026-06-10",
    transactionDate: at("2026-06-10T15:00:00.000Z"),
    isPaid: true, userId: owner, workspaceId: ws,
  });

  await runMigration(ws, owner, "verif-ordem-key");
  const {principal, gain} = await totals(ws);
  const rec = await reconcileLegacyMigration(ws, 50);
  assert.equal(principal, 60_000, "aporte menos resgate");
  assert.equal(gain, 5_000);
  assert.equal(rec.reconciled, true);
});

test("linha não reconhecida reprova a reconciliação", async () => {
  const ws = "verif-desconhecido"; const owner = "verif-desconhecido-owner";
  await setup(ws, owner);
  await db().doc(`workspaces/${ws}/transactions/x`).set({
    type: "investimento", description: "Operação futura", category: "CDB",
    value: 100, valueCents: 10_000, date: "2026-06-10",
    isPaid: true, userId: owner, workspaceId: ws,
    investmentMetadata: {
      currency: "BRL", investmentOperation: "operacao_nova",
      principalCents: 10_000, gainCents: 0, feesCents: 0, taxCents: 0,
      status: "settled", sourceMovementId: "x", idempotencyKey: "k",
    },
  });
  const rec = await reconcileLegacyMigration(ws, 50);
  assert.equal(rec.unclassifiedCount, 1);
  assert.equal(rec.reconciled, false, "não pode fechar sobre linha ignorada");
});
