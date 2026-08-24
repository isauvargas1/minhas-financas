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

  // Antes de migrar, a pré-condição de lote aplicado já recusa (INV-P2-021).
  await assert.rejects(
    () => executeEnableInvestmentsV2Flag(auth(), enablePayload),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "domain_precondition_failed",
  );
  let workspace = (await db().doc(`workspaces/${WORKSPACE}`).get()).data();
  assert.notEqual(workspace?.features?.investmentsV2?.enabled, true);

  await migrateAll(false);

  // Com o lote aplicado, mas com deriva injetada na posição, a recusa passa a
  // ser da reconciliação — que é o invariante que este teste protege.
  const positionRef = (await col("investment_positions").get()).docs[0].ref;
  await positionRef.update({principalCents: 999_999});
  await assert.rejects(
    () => executeEnableInvestmentsV2Flag(auth(), {
      ...(enablePayload as Record<string, unknown>),
      idempotencyKey: "legacy-enable-flag-0001-drift",
    } as never),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "domain_precondition_failed" &&
      /reconcilia/i.test(error.message),
  );
  await positionRef.update({principalCents: 110_000});

  const enabled = await executeEnableInvestmentsV2Flag(auth(), enablePayload);
  assert.equal(enabled.flagEnabled, true);
  workspace = (await db().doc(`workspaces/${WORKSPACE}`).get()).data();
  assert.equal(workspace?.features?.investmentsV2?.enabled, true);
});

/** Executa o rollback até esgotar as páginas de compensação. */
const rollbackAll = async (migrationId: string, reason: string) => {
  let last: Record<string, unknown> = {};
  for (let page = 0; page < 40; page += 1) {
    last = await executeRollbackLegacyInvestmentMigration(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: `legacy-rollback-${page}-0001`,
      correlationId: "corr-legacy-rollback",
      migrationId,
      pageSize: 2,
      reason,
    } as never);
    if (last.completed === true) return last;
  }
  throw new Error("Rollback não concluiu.");
};

const appliedMigrationId = async (): Promise<string> => {
  const snapshots = await col("investment_snapshots")
    .where("kind", "==", "legacy_migration")
    .get();
  const applied = snapshots.docs.find(
    (entry) => entry.data().dryRun !== true && entry.data().rolledBack !== true,
  );
  assert.ok(applied, "Nenhum lote aplicado encontrado.");
  return applied.id;
};

const positionTotals = async () => {
  const positions = await col("investment_positions").get();
  return positions.docs.reduce(
    (totals, entry) => ({
      principalCents: totals.principalCents + (entry.data().principalCents ?? 0),
      currentValueCents:
        totals.currentValueCents + (entry.data().currentValueCents ?? 0),
    }),
    {principalCents: 0, currentValueCents: 0},
  );
};

// INV-P1-012 — o rollback anterior só desligava a flag e marcava o lote. Os
// movimentos ficavam publicados, e reexecutar com o mesmo `migrationId`
// migrava zero linhas porque o cursor estava no fim: uma migração incorreta
// era permanente.

test("migrar, reverter e remigrar devolve os totais corretos nas três etapas", async () => {
  await seed();

  // 1. Migração.
  await migrateAll(false);
  const afterMigration = await positionTotals();
  assert.equal(afterMigration.principalCents, 150_000 - 40_000);
  const movementsAfterMigration = (await col("investment_movements").get()).size;
  assert.equal(movementsAfterMigration, 3);

  const reconciled = await reconcileLegacyMigration(WORKSPACE, 100);
  assert.equal(reconciled.reconciled, true);

  await executeEnableInvestmentsV2Flag(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "legacy-enable-flag-0003",
    correlationId: "corr-legacy-enable-flag-3",
    pageSize: 100,
    reason: "Habilitação após migração",
  } as never);

  // 2. Rollback com compensação.
  const migrationId = await appliedMigrationId();
  const rollback = await rollbackAll(migrationId, "Reversão para reparo");
  assert.equal(rollback.flagEnabled, false);
  assert.equal(rollback.reversedCount, 3);
  assert.equal(rollback.movementsPreserved, true);

  const workspace = (await db().doc(`workspaces/${WORKSPACE}`).get()).data();
  assert.equal(workspace?.features?.investmentsV2?.enabled, false);

  // Histórico preservado: nada apagado, e uma compensação por movimento.
  const movementsAfterRollback = await col("investment_movements").get();
  assert.equal(movementsAfterRollback.size, movementsAfterMigration * 2);
  assert.equal(
    movementsAfterRollback.docs.filter(
      (entry) => entry.data().operation === "reversal",
    ).length,
    3,
  );

  // Posição zerada: o patrimônio voltou ao estado anterior à migração.
  const afterRollback = await positionTotals();
  assert.equal(afterRollback.principalCents, 0);
  assert.equal(afterRollback.currentValueCents, 0);

  const rolledBackSnapshot = (
    await col("investment_snapshots").doc(migrationId).get()
  ).data();
  assert.equal(rolledBackSnapshot?.rolledBack, true);
  assert.equal(rolledBackSnapshot?.status, "rolled_back");

  // 3. Remigração pelo caminho padrão, sem `migrationId` explícito.
  await migrateAll(false);
  const afterRemigration = await positionTotals();
  assert.equal(
    afterRemigration.principalCents,
    150_000 - 40_000,
    "A remigração precisa reconstruir o mesmo patrimônio.",
  );
  const finalReconciliation = await reconcileLegacyMigration(WORKSPACE, 100);
  assert.equal(finalReconciliation.reconciled, true);

  // E a flag volta a poder ser ligada.
  const reEnabled = await executeEnableInvestmentsV2Flag(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "legacy-enable-flag-0004",
    correlationId: "corr-legacy-enable-flag-4",
    pageSize: 100,
    reason: "Habilitação após remigração",
  } as never);
  assert.equal(reEnabled.flagEnabled, true);
});

test("lote revertido não aceita retomada: a remigração usa um lote novo", async () => {
  await seed();
  await migrateAll(false);
  const migrationId = await appliedMigrationId();
  await rollbackAll(migrationId, "Reversão para reparo");

  await assert.rejects(
    () => executeMigrateLegacyInvestments(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: "legacy-migration-revertido-0001",
      correlationId: "corr-legacy-migration-revertido",
      pageSize: 100,
      dryRun: false,
      migrationId,
      reason: "Tentativa de retomar lote revertido",
    } as never),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      /revertido/i.test(error.message),
  );
});

// INV-P1-003 — `dryRun` compartilhava `migrationId` e checkpoint com a
// execução real. O procedimento documentado migrava **zero** movimentos e
// reportava `completed: true`.

test("dry-run completo seguido de aplicação real migra tudo e reconcilia", async () => {
  await seed();

  const simulation = await migrateAll(true);
  assert.equal(simulation.completed, true);
  assert.equal(simulation.dryRun, true);
  assert.equal(simulation.migrated, 0);
  assert.equal((await col("investment_movements").get()).size, 0);

  // Sem `migrationId` explícito — exatamente o procedimento documentado.
  const applied = await migrateAll(false);
  assert.equal(applied.completed, true);
  assert.equal(applied.dryRun, false);
  assert.equal(applied.migrated, 3, "A aplicação real precisa migrar tudo.");

  const reconciliation = await reconcileLegacyMigration(WORKSPACE, 100);
  assert.equal(reconciliation.reconciled, true);
  assert.equal(reconciliation.legacyPrincipalCents, 150_000 - 40_000);
  assert.equal(reconciliation.domainPrincipalCents, 150_000 - 40_000);
});

test("um lote de simulação não pode ser reaproveitado como aplicação", async () => {
  await seed();
  const simulationId = "inv_lote_simulacao_explicito";
  await executeMigrateLegacyInvestments(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "legacy-sim-explicita-0001",
    correlationId: "corr-legacy-sim-explicita",
    pageSize: 100,
    dryRun: true,
    migrationId: simulationId,
    reason: "Simulação com lote explícito",
  } as never);

  await assert.rejects(
    () => executeMigrateLegacyInvestments(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: "legacy-sim-explicita-0002",
      correlationId: "corr-legacy-sim-explicita-2",
      pageSize: 100,
      dryRun: false,
      migrationId: simulationId,
      reason: "Tentativa de aplicar sobre a simulação",
    } as never),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      /simulação/i.test(error.message),
  );
});

// INV-P1-010 — o espelho de caixa da V2 caía no ramo de aporte legado.

test("espelho de caixa da V2 é excluído e o principal não dobra", async () => {
  await seed();

  // Espelho tal como `writeCashProjection` o grava, com os três marcadores.
  await doc("transactions/investment_mov-v2-001").set({
    type: "investimento",
    description: "Aporte V2",
    category: "Investimentos",
    value: 300,
    valueCents: 30_000,
    date: "2026-07-20",
    transactionDate: at("2026-07-20T15:00:00.000Z"),
    isPaid: true,
    userId: OWNER,
    workspaceId: WORKSPACE,
    sourceMovementId: "mov-v2-001",
    investmentMetadata: {
      currency: "BRL",
      investmentOperation: "contribution",
      cashImpact: "outflow",
      investmentImpact: "increase",
      principalCents: 30_000,
      gainCents: 0,
      feesCents: 0,
      taxCents: 0,
      status: "settled",
      sourceMovementId: "mov-v2-001",
      domainMovementId: "mov-v2-001",
      domainVersion: 2,
      idempotencyKey: "v2-key",
    },
  });

  const result = await migrateAll(false);
  const skipped = result.skipped as Record<string, number>;
  assert.equal(skipped.espelho_v2, 1, "O espelho precisa ser excluído.");
  assert.equal(result.migrated, 3, "Só as três linhas legadas migram.");

  const totals = await positionTotals();
  assert.equal(
    totals.principalCents,
    150_000 - 40_000,
    "O principal não pode dobrar por causa do espelho.",
  );
});

test("marcadores parciais do espelho V2 também excluem a linha", async () => {
  await seed();
  // Só o ID derivado, sem `domainVersion` nem `domainMovementId`.
  await doc("transactions/investment_mov-v2-002").set({
    type: "investimento", description: "Aporte V2 antigo", category: "CDB",
    value: 100, valueCents: 10_000, date: "2026-07-21",
    transactionDate: at("2026-07-21T15:00:00.000Z"),
    isPaid: true, userId: OWNER, workspaceId: WORKSPACE,
  });
  const result = await migrateAll(false);
  const skipped = result.skipped as Record<string, number>;
  assert.equal(skipped.espelho_v2, 1);
  const totals = await positionTotals();
  assert.equal(totals.principalCents, 150_000 - 40_000);
});

// INV-P2-021 — a flag só checava a reconciliação, que fecha trivialmente num
// workspace onde a migração nunca rodou de verdade.

test("flag não liga sobre simulação, sobre lote revertido nem sem migração", async () => {
  await seed();

  const enable = (suffix: string) => executeEnableInvestmentsV2Flag(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: `legacy-enable-precond-${suffix}-0001`,
    correlationId: `corr-legacy-enable-precond-${suffix}`,
    pageSize: 100,
    reason: "Tentativa de habilitação",
  } as never);

  // Sem migração alguma, com histórico legado presente.
  await assert.rejects(
    () => enable("sem-migracao"),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      /nenhuma migração aplicada/i.test(error.message),
  );

  // Só simulação.
  await migrateAll(true);
  await assert.rejects(
    () => enable("simulacao"),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      /nenhuma migração aplicada/i.test(error.message),
  );

  // Aplicada, mas incompleta: uma única página de duas.
  await migrate({dryRun: false, pageSize: 1});
  await assert.rejects(
    () => enable("incompleta"),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      /não foi concluída/i.test(error.message),
  );
});

// INV-P2-043 — duas execuções concorrentes liam o mesmo checkpoint, aplicavam
// a mesma página duas vezes e inflavam os totais.

test("uma segunda migração é recusada enquanto a primeira detém o lease", async () => {
  await seed();

  // Primeira execução: uma página só, deixando o lote em andamento **e** o
  // lease vivo. É o estado real em que a corrida acontecia.
  const first = await migrate({
    dryRun: false,
    pageSize: 2,
    migrationId: "inv_lote_concorrente_a",
    idempotencyKey: "legacy-concurrent-a-0001",
  });
  assert.equal(first.completed, false);

  await assert.rejects(
    () => migrate({
      dryRun: false,
      pageSize: 2,
      migrationId: "inv_lote_concorrente_b",
      idempotencyKey: "legacy-concurrent-b-0001",
      correlationId: "corr-legacy-concurrent-b",
    }),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      /em andamento/i.test(error.message),
    "O lease precisa recusar a segunda execução.",
  );

  // A execução dona do lease continua avançando normalmente.
  let last: Record<string, unknown> = first;
  for (let page = 0; page < 20; page += 1) {
    last = await migrate({
      dryRun: false,
      pageSize: 2,
      migrationId: "inv_lote_concorrente_a",
      idempotencyKey: "legacy-concurrent-a-0001",
    });
    if (last.completed === true) break;
  }
  assert.equal(last.completed, true);

  const totals = await positionTotals();
  assert.equal(totals.principalCents, 150_000 - 40_000);
});

test("rollback preserva todo o histórico e nada é apagado", async () => {
  await seed();
  await migrateAll(false);
  await executeEnableInvestmentsV2Flag(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "legacy-enable-flag-0002",
    correlationId: "corr-legacy-enable-flag-2",
    pageSize: 100,
    reason: "Habilitação após migração",
  } as never);

  const migratedIds = (await col("investment_movements").get()).docs.map(
    (entry) => entry.id,
  );
  const migrationId = await appliedMigrationId();
  await rollbackAll(migrationId, "Reversão para reparo");

  // Nenhum movimento migrado desapareceu: a reversão é compensatória.
  const afterIds = new Set(
    (await col("investment_movements").get()).docs.map((entry) => entry.id),
  );
  for (const id of migratedIds) {
    assert.ok(afterIds.has(id), `O movimento ${id} não pode ser apagado.`);
  }

  // As transações legadas de origem também permanecem intactas.
  const legacy = await col("transactions").get();
  assert.equal(legacy.size, 5);

  const snapshot = (await col("investment_snapshots").doc(migrationId).get()).data();
  assert.equal(snapshot?.rolledBack, true);
  assert.equal(snapshot?.rollbackReason, "Rollback da migração legada: Reversão para reparo".slice(0, 0) || "Reversão para reparo");
});
