import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {CreditCardApplicationError} from "../../creditCards/errors";
import {
  executeEnableInvestmentsV2Flag,
  executeMigrateLegacyInvestments,
  executeRollbackLegacyInvestmentMigration,
  reconcileLegacyMigration,
} from "../legacyMigration";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST é obrigatório para os testes de migração.",
  );
}

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const WORKSPACE = "legacy-migration-workspace";
const OWNER = "legacy-migration-owner";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const auth = (): WorkspaceAuthorizationContext => ({
  workspaceId: WORKSPACE,
  uid: OWNER,
  role: "owner",
});

const doc = (path: string) => db().doc(`workspaces/${WORKSPACE}/${path}`);
const col = (name: string) =>
  db().collection(`workspaces/${WORKSPACE}/${name}`);

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

const seed = async (): Promise<void> => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  await db().doc(`workspaces/${WORKSPACE}`).set({
    ownerId: OWNER, type: "PF", currency: "BRL", name: WORKSPACE,
  });
  await db().doc(`workspaces/${WORKSPACE}/members/${OWNER}`)
    .set({uid: OWNER, role: "owner", status: "active"});

  // Aporte legado do M1: sem metadata, liquidado.
  await doc("transactions/legacy-contribution-1").set({
    type: "investimento", description: "Aporte legado 1", category: "CDB",
    value: 1_000, valueCents: 100_000, date: "2026-06-10",
    transactionDate: at("2026-06-10T15:00:00.000Z"),
    isPaid: true, userId: OWNER, workspaceId: WORKSPACE,
  });
  await doc("transactions/legacy-contribution-2").set({
    type: "investimento", description: "Aporte legado 2", category: "CDB",
    value: 500, valueCents: 50_000, date: "2026-07-10",
    transactionDate: at("2026-07-10T15:00:00.000Z"),
    isPaid: true, userId: OWNER, workspaceId: WORKSPACE,
  });
  // Resgate legado do M2: metadata liquidada, com ganho, taxa e imposto.
  await doc("transactions/legacy-redemption-1").set({
    type: "investimento", description: "Resgate legado", category: "CDB",
    value: 447, valueCents: 44_700, date: "2026-08-05",
    transactionDate: at("2026-08-05T15:00:00.000Z"),
    isPaid: true, userId: OWNER, workspaceId: WORKSPACE,
    investmentMetadata: {
      currency: "BRL", investmentOperation: "redemption",
      cashImpact: "inflow", investmentImpact: "decrease",
      principalCents: 40_000, gainCents: 5_000,
      feesCents: 100, taxCents: 200, status: "settled",
      sourceMovementId: "legacy-contribution-1",
      idempotencyKey: "legacy-redemption-key",
    },
  });
  // Não deve migrar: pendente.
  await doc("transactions/legacy-pending").set({
    type: "investimento", description: "Resgate pendente", category: "CDB",
    value: 100, valueCents: 10_000, date: "2026-08-06",
    isPaid: false, userId: OWNER, workspaceId: WORKSPACE,
    investmentMetadata: {
      currency: "BRL", investmentOperation: "redemption",
      principalCents: 10_000, gainCents: 0, feesCents: 0, taxCents: 0,
      status: "pending", sourceMovementId: "legacy-contribution-1",
      idempotencyKey: "legacy-pending-key",
    },
  });
  // Não deve migrar: não é investimento.
  await doc("transactions/legacy-expense").set({
    type: "despesa", description: "Mercado", category: "Casa",
    value: 80, date: "2026-08-07", isPaid: true,
    userId: OWNER, workspaceId: WORKSPACE,
  });
};

const migrate = (overrides: Record<string, unknown> = {}) =>
  executeMigrateLegacyInvestments(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "legacy-migration-key-0001",
    correlationId: "corr-legacy-migration",
    pageSize: 100,
    dryRun: false,
    reason: "Migração do legado para o domínio patrimonial",
    ...overrides,
  } as never);

/** Executa até esgotar as páginas. */
const migrateAll = async (dryRun: boolean) => {
  let last: Record<string, unknown> = {};
  for (let page = 0; page < 20; page += 1) {
    last = await migrate({dryRun, pageSize: 2});
    if (last.completed === true) return last;
  }
  throw new Error("Migração não concluiu.");
};

test("dry-run relata o que migraria e não grava nada no domínio", async () => {
  await seed();
  const result = await migrateAll(true);

  assert.equal(result.dryRun, true);
  const totals = result.totals as Record<string, number>;
  assert.equal(totals.contributionPrincipalCents, 150_000);
  assert.equal(totals.redemptionPrincipalCents, 40_000);
  assert.equal(totals.realizedGainCents, 5_000);
  // A consulta já é seletiva por `type`, então a despesa nem é varrida. O
  // pendente é varrido e excluído com o motivo nomeado.
  const skipped = result.skipped as Record<string, number>;
  assert.deepEqual(skipped, {status_pending: 1});
  assert.equal(result.scanned, 4);

  // Nada foi criado no domínio.
  assert.equal((await col("investment_movements").get()).size, 0);
  assert.equal((await col("investment_positions").get()).size, 0);
  assert.equal((await col("investment_accounts").get()).size, 0);
});

test("aplicação cria movimentos, conta e ativo de destino legados", async () => {
  await seed();
  const result = await migrateAll(false);
  assert.equal(result.migrated, 3);

  const accounts = await col("investment_accounts").get();
  assert.equal(accounts.size, 1);
  assert.equal(accounts.docs[0].data().name, "Investimentos legados");
  const assets = await col("investment_assets").get();
  assert.equal(assets.size, 1);
  assert.equal(assets.docs[0].data().name, "Investimentos legados");

  const movements = await col("investment_movements").get();
  assert.equal(movements.size, 3);

  const position = (await col("investment_positions").get()).docs[0].data();
  assert.equal(position.principalCents, 150_000 - 40_000);
  assert.equal(position.realizedGainCents, 5_000);
  assert.equal(position.feesCents, 100);
  assert.equal(position.taxCents, 200);
});

test("cada movimento referencia a transação de origem", async () => {
  await seed();
  await migrateAll(false);
  const movements = await col("investment_movements").get();
  for (const entry of movements.docs) {
    const data = entry.data();
    assert.ok(
      data.migratedFromTransactionId,
      "O movimento migrado precisa apontar para a transação de origem.",
    );
    assert.equal(data.transactionId, data.migratedFromTransactionId);
    const source = await doc(`transactions/${data.transactionId}`).get();
    assert.equal(source.exists, true, "A transação de origem precisa existir.");
  }
});

test("nenhuma duplicação de caixa: o espelho não é recriado", async () => {
  await seed();
  const before = (await col("transactions").get()).size;
  await migrateAll(false);
  const after = await col("transactions").get();

  assert.equal(
    after.size,
    before,
    "A migração não pode criar transação nova: o caixa já está registrado.",
  );
  // E o delta de caixa do movimento migrado é zero, para não somar de novo.
  const movements = await col("investment_movements").get();
  for (const entry of movements.docs) {
    assert.equal(entry.data().cashDeltaCents, 0);
  }
  const period = (await doc("investment_report_periods/2026-06").get()).data();
  assert.equal(period?.cashDeltaCents, 0);
});

test("reexecutar é idempotente e não duplica movimento", async () => {
  await seed();
  await migrateAll(false);
  const firstCount = (await col("investment_movements").get()).size;
  const firstPosition = (await col("investment_positions").get()).docs[0].data();

  // Nova execução completa, com outro identificador de lote.
  let last: Record<string, unknown> = {};
  for (let page = 0; page < 20; page += 1) {
    last = await migrate({
      dryRun: false,
      pageSize: 2,
      migrationId: "legacy-migration-second-run",
      idempotencyKey: "legacy-migration-key-0002",
    });
    if (last.completed === true) break;
  }

  assert.equal(last.migrated, 0, "Nada novo deve ser criado.");
  assert.equal(last.alreadyMigrated, 3);
  assert.equal((await col("investment_movements").get()).size, firstCount);
  const secondPosition = (await col("investment_positions").get()).docs[0].data();
  assert.equal(secondPosition.principalCents, firstPosition.principalCents);
  assert.equal(secondPosition.realizedGainCents, firstPosition.realizedGainCents);
});

test("checkpoint por workspace retoma de onde parou", async () => {
  await seed();
  // Uma única página de 2 linhas: fica incompleto e grava o cursor.
  const first = await migrate({dryRun: false, pageSize: 2});
  assert.equal(first.completed, false);
  const checkpoint = (
    await col("investment_snapshots").where("kind", "==", "legacy_migration").get()
  ).docs[0].data();
  assert.equal(checkpoint.workspaceId, WORKSPACE);
  assert.ok(checkpoint.cursor, "O checkpoint precisa guardar o cursor.");
  assert.equal(checkpoint.status, "running");

  // A continuação parte do cursor e conclui.
  let last: Record<string, unknown> = first;
  for (let page = 0; page < 20; page += 1) {
    last = await migrate({dryRun: false, pageSize: 2});
    if (last.completed === true) break;
  }
  assert.equal(last.completed, true);
  assert.equal(
    last.scanned,
    4,
    "As quatro transações de investimento precisam ser varridas.",
  );
  assert.equal((await col("investment_movements").get()).size, 3);
});

test("reconciliação fecha depois da migração e não antes", async () => {
  await seed();
  const before = await reconcileLegacyMigration(WORKSPACE, 100);
  assert.equal(before.legacyPrincipalCents, 110_000);
  assert.equal(before.domainPrincipalCents, 0);
  assert.equal(before.reconciled, false);

  await migrateAll(false);

  const after = await reconcileLegacyMigration(WORKSPACE, 100);
  assert.equal(after.legacyPrincipalCents, 110_000);
  assert.equal(after.domainPrincipalCents, 110_000);
  assert.equal(after.legacyRealizedGainCents, 5_000);
  assert.equal(after.domainRealizedGainCents, 5_000);
  assert.equal(after.reconciled, true);
});

test("a flag só liga depois da reconciliação", async () => {
  await seed();
  const enablePayload = {
    workspaceId: WORKSPACE,
    idempotencyKey: "legacy-enable-flag-0001",
    correlationId: "corr-legacy-enable-flag",
    pageSize: 100,
    reason: "Habilitação após migração",
  } as never;

  // Antes de migrar, os totais divergem e a flag é recusada.
  await assert.rejects(
    () => executeEnableInvestmentsV2Flag(auth(), enablePayload),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "domain_precondition_failed" &&
      /reconcilia/i.test(error.message),
  );
  let workspace = (await db().doc(`workspaces/${WORKSPACE}`).get()).data();
  assert.notEqual(workspace?.features?.investmentsV2?.enabled, true);

  await migrateAll(false);
  const enabled = await executeEnableInvestmentsV2Flag(auth(), enablePayload);
  assert.equal(enabled.flagEnabled, true);
  workspace = (await db().doc(`workspaces/${WORKSPACE}`).get()).data();
  assert.equal(workspace?.features?.investmentsV2?.enabled, true);
});

test("rollback desliga a flag e preserva todo o histórico", async () => {
  await seed();
  await migrateAll(false);
  await executeEnableInvestmentsV2Flag(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "legacy-enable-flag-0002",
    correlationId: "corr-legacy-enable-flag-2",
    pageSize: 100,
    reason: "Habilitação após migração",
  } as never);
  const movementsBefore = (await col("investment_movements").get()).size;

  const migrationId = (
    await col("investment_snapshots").where("kind", "==", "legacy_migration").get()
  ).docs[0].id;
  const result = await executeRollbackLegacyInvestmentMigration(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "legacy-rollback-0001",
    correlationId: "corr-legacy-rollback",
    migrationId,
    reason: "Reversão para reparo",
  } as never);

  assert.equal(result.flagEnabled, false);
  const workspace = (await db().doc(`workspaces/${WORKSPACE}`).get()).data();
  assert.equal(workspace?.features?.investmentsV2?.enabled, false);

  // Histórico preservado: nada foi apagado.
  assert.equal((await col("investment_movements").get()).size, movementsBefore);
  const snapshot = (await col("investment_snapshots").doc(migrationId).get()).data();
  assert.equal(snapshot?.rolledBack, true);
  assert.equal(snapshot?.rollbackReason, "Reversão para reparo");

  // Reparo para frente: reexecutar não duplica e volta a conciliar. O
  // contador do checkpoint é cumulativo, então o invariante que importa é a
  // quantidade de movimentos, que não pode crescer.
  await migrateAll(false);
  assert.equal(
    (await col("investment_movements").get()).size,
    movementsBefore,
    "O reparo para frente não pode criar movimento duplicado.",
  );
  const reconciliation = await reconcileLegacyMigration(WORKSPACE, 100);
  assert.equal(reconciliation.reconciled, true);
});
