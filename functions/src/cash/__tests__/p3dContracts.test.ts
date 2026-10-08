import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import type * as admin from "firebase-admin";

import {quotaExceeded} from "../../billing/quota";
import {
  readTransactionQuotaUsed,
  transactionQuotaMonthId,
} from "../../billing/transactionQuota";
import {
  CASH_IMPORT_MAX_ITEMS,
  importCashTransactionsPayloadSchema,
} from "../contracts";
import {
  cashImportItemHash,
  cashImportTransactionId,
  importSummaryMessage,
} from "../importTransactions";

/**
 * Contratos puros da P3-D: importação, contador da quota, classificação do
 * ledger para a inicialização e o índice da âncora de idempotência.
 */
const WS = "ws-p3d";

const item = (lineId: string, overrides: Record<string, unknown> = {}) => ({
  lineId,
  type: "despesa",
  description: "Mercado",
  category: "Casa",
  amountCents: 1_000,
  date: "2026-09-10",
  ...overrides,
});

const payload = (items: unknown[], overrides = {}) => ({
  workspaceId: WS,
  idempotencyKey: "idem-lote-0001",
  importId: "arquivo-0001",
  cashAccountId: "acc_lote",
  items,
  ...overrides,
});

const ok = (data: unknown) =>
  importCashTransactionsPayloadSchema.safeParse(data).success;

test("P3-D — contrato da importação: lote limitado e linhas estritas", () => {
  assert.ok(ok(payload([item("1"), item("2", {type: "receita"})])));
  assert.ok(ok(payload(Array.from({length: CASH_IMPORT_MAX_ITEMS},
    (_, index) => item(`l${index}`)))));
  assert.ok(ok(payload([item("1")], {correlationId: "corr-1"})));
  for (const [label, data] of [
    ["vazio", payload([])],
    ["excessivo", payload(Array.from({length: CASH_IMPORT_MAX_ITEMS + 1},
      (_, index) => item(`l${index}`)))],
    ["linha repetida", payload([item("1"), item("1")])],
    ["linha com barra", payload([item("a/b")])],
    ["linha longa", payload([item("x".repeat(65))])],
    ["importação curta", payload([item("1")], {importId: "curta"})],
    ["sem chave", payload([item("1")], {idempotencyKey: undefined})],
    ["campo extra no lote", payload([item("1")], {userId: "outro"})],
    ["quota forjada", payload([item("1")], {quotaPeriod: "2026-01"})],
  ] as const) {
    assert.equal(ok(data), false, label);
  }
  for (const forged of [
    "userId", "valueCents", "value", "isPaid", "cardId", "loanId", "goalId",
    "installments", "source", "walletId", "cashEntry", "createdBy",
    "investmentEntry", "recurringId", "recurringEntry", "voidedAt",
  ]) {
    assert.equal(ok(payload([item("1", {[forged]: "x"})])), false, forged);
  }
});

test("P3-D — identidade da linha e resumo em pt-BR", () => {
  const id = cashImportTransactionId(WS, "uid-a", "arquivo-1", "7");
  assert.match(id, /^cashimp_[0-9a-f]{40}$/);
  assert.equal(id, cashImportTransactionId(WS, "uid-a", "arquivo-1", "7"));
  for (const other of [
    cashImportTransactionId(WS, "uid-b", "arquivo-1", "7"),
    cashImportTransactionId(WS, "uid-a", "arquivo-2", "7"),
    cashImportTransactionId(WS, "uid-a", "arquivo-1", "8"),
    cashImportTransactionId("ws-outro", "uid-a", "arquivo-1", "7"),
  ]) {
    assert.notEqual(other, id);
  }
  const base = item("1") as never;
  assert.equal(
    cashImportItemHash(WS, "arquivo-1", "acc_1", base),
    cashImportItemHash(WS, "arquivo-1", "acc_1", base),
  );
  assert.notEqual(
    cashImportItemHash(WS, "arquivo-1", "acc_1", base),
    cashImportItemHash(WS, "arquivo-1", "acc_1",
      item("1", {amountCents: 1}) as never),
  );
  // P3-J (D-30): a mesma linha para outra conta é outra intenção.
  assert.notEqual(
    cashImportItemHash(WS, "arquivo-1", "acc_1", base),
    cashImportItemHash(WS, "arquivo-1", "acc_2", base),
  );
  assert.equal(importSummaryMessage(1, 0), "1 lançamento importado.");
  assert.equal(importSummaryMessage(3, 1),
    "3 lançamentos importados; 1 já estava registrado.");
  assert.equal(importSummaryMessage(0, 2),
    "Nenhum lançamento novo: 2 já estavam registrados.");
});

/** Snapshot mínimo para as funções puras do contador. */
const snapshot = (data?: Record<string, unknown>) => ({
  exists: data !== undefined,
  get: (field: string) => data?.[field],
}) as unknown as admin.firestore.DocumentSnapshot;

const anchor = (overrides = {}) => snapshot({
  workspaceId: WS, trackingSince: "2026-10", origin: "workspace_created",
  initialUsed: 0, schemaVersion: 1, ...overrides,
});

const monthDoc = (overrides = {}) => snapshot({
  workspaceId: WS, monthKey: "2026-10", used: 7, schemaVersion: 1,
  ...overrides,
});

test("P3-D — contador: ausência só é zero com a âncora; resto falha", () => {
  assert.equal(readTransactionQuotaUsed(anchor(), monthDoc(), WS, "2026-10"),
    7);
  assert.equal(readTransactionQuotaUsed(anchor(), snapshot(), WS, "2026-11"),
    0);
  const invalid: Array<[string, () => number]> = [
    ["sem âncora", () =>
      readTransactionQuotaUsed(snapshot(), snapshot(), WS, "2026-10")],
    ["âncora de outra versão", () =>
      readTransactionQuotaUsed(anchor({schemaVersion: 2}), snapshot(), WS,
        "2026-10")],
    ["âncora de outro workspace", () =>
      readTransactionQuotaUsed(anchor({workspaceId: "x"}), snapshot(), WS,
        "2026-10")],
    ["mês anterior ao rastreio", () =>
      readTransactionQuotaUsed(anchor(), snapshot(), WS, "2026-09")],
    ["uso negativo", () =>
      readTransactionQuotaUsed(anchor(), monthDoc({used: -1}), WS,
        "2026-10")],
    ["uso fracionado", () =>
      readTransactionQuotaUsed(anchor(), monthDoc({used: 1.5}), WS,
        "2026-10")],
    ["mês trocado", () =>
      readTransactionQuotaUsed(anchor(), monthDoc({monthKey: "2026-09"}), WS,
        "2026-10")],
    ["chave de mês inválida", () => {
      transactionQuotaMonthId("2026-13");
      return 0;
    }],
  ];
  for (const [label, read] of invalid) {
    assert.throws(read, {code: "internal"}, label);
  }
  assert.equal(transactionQuotaMonthId("2026-10"), "transactions_2026-10");
});

test("P3-D — erro de quota: uso só para o titular, pedido se houver", () => {
  const base = {
    resource: "transactionsPerMonth" as const, planId: "free" as const,
    limit: 50, used: 50, periodKey: "2026-10",
  };
  const owner = quotaExceeded({...base, actorIsBillingOwner: true});
  assert.deepEqual(owner.details, {
    resource: "transactionsPerMonth", planId: "free", limit: 50, used: 50,
    periodKey: "2026-10",
  });
  const member = quotaExceeded({
    ...base, actorIsBillingOwner: false, requested: 3,
  });
  assert.deepEqual(member.details, {
    resource: "transactionsPerMonth", planId: "free", limit: 50,
    periodKey: "2026-10", requested: 3,
  });
  assert.match(member.message, /titular/);
  assert.doesNotMatch(member.message, /upgrade/i);
  assert.match(owner.message, /upgrade em Meu Plano/);
});

test("P3-D — índice de grupo da âncora de idempotência declarado", () => {
  const indexes = JSON.parse(readFileSync(
    resolve(__dirname, "../../../../firestore.indexes.json"),
    "utf8",
  )) as {indexes: Array<Record<string, unknown>>};
  assert.ok(indexes.indexes.some((index) =>
    JSON.stringify(index) === JSON.stringify({
      collectionGroup: "cash_events",
      queryScope: "COLLECTION_GROUP",
      fields: [
        {fieldPath: "intentId", order: "ASCENDING"},
        {fieldPath: "operation", order: "ASCENDING"},
      ],
    })));
});
