import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {
  applyCashPeriodWrite,
  cashPeriodDeltaFor,
  cashPeriodKeyFor,
} from "../periods";
import {executeRebuildCashPeriods} from "../rebuild";

/**
 * Projeção mensal de caixa (INV-P1-011).
 *
 * É ela que permite ao produto parar de varrer a subcoleção inteira de
 * transações para responder "qual é o saldo acumulado". Um acumulador só é
 * aceitável quando é reconstrutível a partir dos fatos, então a reconstrução é
 * testada contra o caminho incremental.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório.");
}

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const WORKSPACE = "cash-periods-workspace";
const ACTOR = "cash-periods-actor";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

const transaction = (overrides: Record<string, unknown>) => ({
  type: "despesa",
  description: "Lançamento",
  category: "Casa",
  value: 100,
  date: "2026-08-10",
  transactionDate: at("2026-08-10T15:00:00.000Z"),
  userId: ACTOR,
  workspaceId: WORKSPACE,
  ...overrides,
});

const reset = async () => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
};

const period = async (key: string) =>
  (await db().doc(`workspaces/${WORKSPACE}/cash_report_periods/${key}`).get())
    .data();

/** Aplica a escrita como o gatilho faria, numa transação própria. */
const applyWrite = async (
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
) => {
  await db().runTransaction(async (tx) => {
    applyCashPeriodWrite(
      tx as unknown as Parameters<typeof applyCashPeriodWrite>[0],
      WORKSPACE,
      before,
      after,
    );
  });
};

test("classificação de caixa espelha a semântica do produto", () => {
  assert.equal(cashPeriodDeltaFor(transaction({type: "receita"})).netCents, 10_000);
  assert.equal(cashPeriodDeltaFor(transaction({type: "despesa"})).netCents, -10_000);
  assert.equal(cashPeriodDeltaFor(transaction({type: "parcelado"})).netCents, -10_000);

  // Aporte é saída de caixa contabilizada à parte das despesas de consumo.
  const contribution = cashPeriodDeltaFor(transaction({type: "investimento"}));
  assert.equal(contribution.netCents, -10_000);
  assert.equal(contribution.expenseCents, 0);
  assert.equal(contribution.investmentOutflowCents, 10_000);

  // Resgate pendente não é fato consumado: não toca caixa.
  assert.equal(cashPeriodDeltaFor(transaction({
    type: "investimento",
    investmentMetadata: {status: "pending", cashImpact: "inflow"},
  })).netCents, 0);

  // Resgate liquidado entra no caixa.
  assert.equal(cashPeriodDeltaFor(transaction({
    type: "investimento",
    investmentMetadata: {status: "settled", cashImpact: "inflow"},
  })).netCents, 10_000);

  // Vínculo de meta não move caixa.
  assert.equal(cashPeriodDeltaFor(transaction({
    type: "investimento",
    investmentMetadata: {status: "settled", cashImpact: "none"},
  })).netCents, 0);

  // Baixa lógica não conta (INV-P2-032).
  assert.equal(cashPeriodDeltaFor(transaction({
    type: "receita",
    voidedAt: at("2026-08-11T10:00:00.000Z"),
  })).netCents, 0);

  // Centavos exatos vêm de `valueCents` quando existe.
  assert.equal(cashPeriodDeltaFor(transaction({
    type: "receita", value: 10.005, valueCents: 1_001,
  })).netCents, 1_001);
});

test("criação, alteração, troca de mês e exclusão mantêm o saldo exato", async () => {
  await reset();

  const receita = transaction({type: "receita", value: 500});
  await applyWrite(undefined, receita);
  assert.equal((await period("2026-08"))?.netCents, 50_000);
  assert.equal((await period("2026-08"))?.incomeCents, 50_000);
  assert.equal((await period("2026-08"))?.transactionCount, 1);

  // Alteração de valor no mesmo mês: um único incremento combinado.
  const corrigida = {...receita, value: 300};
  await applyWrite(receita, corrigida);
  assert.equal((await period("2026-08"))?.netCents, 30_000);
  assert.equal((await period("2026-08"))?.transactionCount, 1);

  // Troca de mês: sai de agosto, entra em julho.
  const movida = {
    ...corrigida,
    date: "2026-07-05",
    transactionDate: at("2026-07-05T15:00:00.000Z"),
  };
  await applyWrite(corrigida, movida);
  assert.equal((await period("2026-08"))?.netCents, 0);
  assert.equal((await period("2026-08"))?.transactionCount, 0);
  assert.equal((await period("2026-07"))?.netCents, 30_000);
  assert.equal((await period("2026-07"))?.transactionCount, 1);

  // Exclusão retira o efeito por completo.
  await applyWrite(movida, undefined);
  assert.equal((await period("2026-07"))?.netCents, 0);
  assert.equal((await period("2026-07"))?.transactionCount, 0);
});

test("reconstrução reproduz o caminho incremental e é idempotente", async () => {
  await reset();

  const rows = [
    transaction({type: "receita", value: 1_000, date: "2026-06-10", transactionDate: at("2026-06-10T15:00:00.000Z")}),
    transaction({type: "despesa", value: 400, date: "2026-06-20", transactionDate: at("2026-06-20T15:00:00.000Z")}),
    transaction({type: "investimento", value: 200, date: "2026-07-05", transactionDate: at("2026-07-05T15:00:00.000Z")}),
    transaction({type: "receita", value: 900, date: "2026-07-25", transactionDate: at("2026-07-25T15:00:00.000Z")}),
    transaction({
      type: "investimento", value: 150,
      date: "2026-08-02", transactionDate: at("2026-08-02T15:00:00.000Z"),
      investmentMetadata: {status: "settled", cashImpact: "inflow"},
    }),
  ];

  // Caminho incremental, como o gatilho faz.
  for (const [index, row] of rows.entries()) {
    await db().doc(`workspaces/${WORKSPACE}/transactions/tx-${index}`).set(row);
    await applyWrite(undefined, row);
  }

  const incremental = {
    "2026-06": await period("2026-06"),
    "2026-07": await period("2026-07"),
    "2026-08": await period("2026-08"),
  };
  assert.equal(incremental["2026-06"]?.netCents, 60_000);
  assert.equal(incremental["2026-07"]?.netCents, 70_000);
  assert.equal(incremental["2026-08"]?.netCents, 15_000);

  // Injeta deriva para provar que a reconstrução a corrige.
  await db().doc(`workspaces/${WORKSPACE}/cash_report_periods/2026-07`).set(
    {netCents: 999_999},
    {merge: true},
  );

  const first = await executeRebuildCashPeriods(WORKSPACE, ACTOR, {
    workspaceId: WORKSPACE,
    idempotencyKey: "cash-rebuild-0001",
    correlationId: "corr-cash-rebuild",
    pageSize: 2,
    reason: "Reconstrução de teste",
  });
  // Página pequena de propósito: exercita a retomada por cursor.
  let result = first;
  for (let page = 0; page < 20 && result.completed !== true; page += 1) {
    result = await executeRebuildCashPeriods(WORKSPACE, ACTOR, {
      workspaceId: WORKSPACE,
      idempotencyKey: `cash-rebuild-${page}-0002`,
      correlationId: "corr-cash-rebuild",
      pageSize: 2,
      reason: "Reconstrução de teste",
    });
  }
  assert.equal(result.completed, true);

  for (const key of ["2026-06", "2026-07", "2026-08"] as const) {
    const rebuilt = await period(key);
    assert.equal(
      rebuilt?.netCents,
      incremental[key]?.netCents,
      `Mês ${key} precisa bater com o caminho incremental.`,
    );
    assert.equal(rebuilt?.incomeCents, incremental[key]?.incomeCents);
    assert.equal(rebuilt?.expenseCents, incremental[key]?.expenseCents);
    assert.equal(
      rebuilt?.investmentOutflowCents,
      incremental[key]?.investmentOutflowCents,
    );
  }

  // Saldo global = soma dos meses.
  const balance = ["2026-06", "2026-07", "2026-08"]
    .reduce(async (accumulator, key) => (
      await accumulator) + Number((await period(key))?.netCents ?? 0), Promise.resolve(0));
  assert.equal(await balance, 60_000 + 70_000 + 15_000);

  await reset();
});

test("reconstrução zera período órfão sem lastro no ledger", async () => {
  await reset();
  const row = transaction({type: "receita", value: 100});
  await db().doc(`workspaces/${WORKSPACE}/transactions/tx-only`).set(row);

  // Período sobrevivente de uma execução anterior, sem transação que o sustente.
  await db().doc(`workspaces/${WORKSPACE}/cash_report_periods/2026-01`).set({
    id: "2026-01", workspaceId: WORKSPACE, period: "2026-01",
    periodStart: at("2026-01-01T03:00:00.000Z"),
    incomeCents: 999_999, expenseCents: 0, investmentOutflowCents: 0,
    netCents: 999_999, transactionCount: 1,
  });

  const result = await executeRebuildCashPeriods(WORKSPACE, ACTOR, {
    workspaceId: WORKSPACE,
    idempotencyKey: "cash-rebuild-orfao-0001",
    correlationId: "corr-cash-rebuild-orfao",
    pageSize: 100,
    reason: "Reconstrução de teste",
  });
  assert.equal(result.completed, true);

  assert.equal((await period("2026-01"))?.netCents, 0);
  assert.equal((await period("2026-01"))?.transactionCount, 0);
  assert.equal((await period("2026-08"))?.netCents, 10_000);

  await reset();
});

test("chave mensal usa o fuso oficial do produto, não UTC", () => {
  // 22:00 BRT de 31/08 é 01:00 UTC de 01/09. A chave precisa ser de agosto.
  assert.equal(
    cashPeriodKeyFor({transactionDate: at("2026-09-01T01:00:00.000Z")}),
    "2026-08",
  );
  assert.equal(
    cashPeriodKeyFor({date: "2026-08-31"}),
    "2026-08",
  );
});
