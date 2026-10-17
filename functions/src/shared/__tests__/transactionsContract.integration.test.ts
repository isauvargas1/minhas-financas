import assert from "node:assert/strict";
import test, {after} from "node:test";
import * as admin from "firebase-admin";
import {
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import {
  CASH_DELTA_FIELDS,
  CASH_PERIOD_SCHEMA_VERSION,
  addCashPeriodDelta,
  cashDayKeyFor,
  cashDaysMatchMonth,
  cashPeriodDeltaFor,
  cashProjectionStateRef,
  cashWritePlanFor,
  emptyCashPeriodDelta,
  mergeCashDayDeltas,
  normalizeCashPeriodDelta,
  readCashDayDeltas,
  sumCashDayDeltas,
  type CashDayDeltas,
  type CashPeriodDelta,
} from "../../cash/periods";
import {
  confirmCashTransaction,
  createCashTransaction,
  importCashTransactions,
  updateCashTransaction,
  voidCashTransaction,
} from "../../cash/callables";
import {CASH_ENTRY_MAX_CENTS} from "../../cash/contracts";
import {executeReverseInvoicePayment} from "../../cards/invoiceOperations";
import {
  actorOf as cardActor,
  buy,
  clockAt as cardClock,
  createCard,
  invoiceVersion,
  pay as payCardInvoice,
  requestId as cardRequest,
} from "../../cards/testSupport/cardTestSupport";
import {
  executeCreateSimpleInvestment,
  executeReverseInvestmentMovement,
  executeWithdrawSimpleInvestment,
} from "../../investments/operationsV2";
import {
  json,
  type LoanTenant,
} from "../../loans/testSupport/loanTestSupport";
import {
  cancel as cancelLoanCall,
  cancelPayload as loanCancelPayload,
  create as createLoan,
  createPayload as loanCreatePayload,
  pay as payLoan,
  payPayload as loanPayPayload,
  reverse as reverseLoan,
  reversePayload as loanReversePayload,
} from "../../loans/testSupport/loanTestSupport";
import {
  executeCreateRecurringExpense,
} from "../../recurring/contractOperations";
import {
  cleanupRecurring,
  confirmOccurrence,
  contractPayload,
  clockAt as recurringClock,
  requestId as recurringRequest,
  runOn,
} from "../../recurring/testSupport/recurringTestSupport";
import {
  newReceivable,
  receivablePayload,
  receive,
  receivePayload,
  reverse as reverseReceipt,
  reversePayload as receiptReversePayload,
  seedClient,
} from "../../receivables/testSupport/receivableTestSupport";
import {
  executeCreateSettingsCatalogItem,
} from "../../settingsCatalog/operations";
import {
  defaultCategoryIdFor,
  seedDefaultCategories,
} from "../../settingsCatalog/testSupport/categorySeeds";
import {
  TODAY as SPLIT_TODAY,
  addMember,
  approveReimbursement,
  billPayload,
  createBill,
  createGroup,
  createReimbursement,
  memberParticipantId,
  payReimbursement,
  reimbursementPayload,
  seedSplitTenant,
  type SplitTenant,
} from "../../splitBills/testSupport/splitTestSupport";
import {
  handleTransactionWrite,
  type TransactionWriteEvent,
} from "../../triggers/transactions";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {formatIsoInstant} from "../commitTime";
import {isDayKey} from "../dateKeys";
import {defaultAccountOf} from "../testSupport/kernelTestSupport";

/**
 * Guarda de schema do documento `transactions` (P5-C2, PR-TX-03).
 *
 * O contrato único (`CONTRATOS.md`, §1) tem `valueCents` inteiro e `date`
 * civil; `value` (reais) e `transactionDate` não existem mais, e `parcelado`
 * nunca é um tipo persistido. Esta suíte não testa o leitor isolado: ela
 * executa **cada produtor real** (Admin SDK no Emulator, sem mock de SDK nem
 * de produtor), lê **todos** os documentos gravados em
 * `workspaces/{ws}/transactions` e aplica `assertCanonicalTransaction`. Se
 * algum produtor voltar a gravar um campo removido, ela falha.
 *
 * Depois dos produtores, cada escrita é entregue ao gatilho real
 * (`handleTransactionWrite`, com antes e depois) e a projeção mensal e diária
 * é conciliada com a soma de `cashPeriodDeltaFor` dos documentos.
 */

const tenants: SplitTenant[] = [];
after(async () => {
  await cleanupRecurring(tenants);
});

// ----------------------------------------------------------------- guarda

const FORBIDDEN_FIELDS = ["value", "transactionDate"] as const;
const PERSISTED_TYPES = ["receita", "despesa", "investimento"];

interface TransactionSample {
  id: string;
  data: DocumentData;
}

/**
 * Contrato do documento persistido: sem `value` nem `transactionDate`; tipo
 * entre receita, despesa e investimento (este só com `investmentEntry`);
 * `valueCents` inteiro seguro não negativo; `date` civil válido; `createdAt` e
 * `updatedAt` do servidor.
 */
const assertCanonicalTransaction = (
  sample: TransactionSample,
  context = "",
): void => {
  const label = `lançamento ${sample.id}${context ? ` (${context})` : ""}`;
  const {data} = sample;
  const keys = Object.keys(data);
  for (const field of FORBIDDEN_FIELDS) {
    assert.equal(keys.includes(field), false,
      `${label}: campo removido \`${field}\` foi gravado`);
  }
  assert.ok(PERSISTED_TYPES.includes(data.type),
    `${label}: tipo fora do contrato (${String(data.type)})`);
  assert.notEqual(data.type, "parcelado", `${label}: tipo \`parcelado\``);
  const marked = data.investmentEntry !== undefined &&
    data.investmentEntry !== null;
  if (data.type === "investimento") {
    assert.ok(marked, `${label}: investimento sem \`investmentEntry\``);
  } else {
    assert.equal(marked, false,
      `${label}: \`investmentEntry\` em tipo ${String(data.type)}`);
  }
  assert.ok(
    Number.isSafeInteger(data.valueCents) && data.valueCents >= 0 &&
      !Object.is(data.valueCents, -0),
    `${label}: valueCents não é inteiro seguro não negativo ` +
      `(${String(data.valueCents)})`,
  );
  if (data.type === "investimento") {
    assert.equal(data.valueCents, data.investmentEntry.amountCents,
      `${label}: valueCents diferente do valor da marca de investimento`);
  } else {
    assert.ok(data.valueCents <= CASH_ENTRY_MAX_CENTS,
      `${label}: valueCents acima do teto de receita/despesa`);
  }
  assert.ok(isDayKey(data.date),
    `${label}: date não é um dia civil válido (${String(data.date)})`);
  assert.ok(data.createdAt instanceof Timestamp,
    `${label}: createdAt não é Timestamp`);
  assert.ok(data.updatedAt instanceof Timestamp,
    `${label}: updatedAt não é Timestamp`);
};

const transactionsCollection = (workspaceId: string) =>
  db().collection(`workspaces/${workspaceId}/transactions`);

const transactionDocs = async (
  workspaceId: string,
): Promise<QueryDocumentSnapshot[]> =>
  (await transactionsCollection(workspaceId).get()).docs;

/** Lê tudo o que está gravado no tenant e aplica o guarda em cada documento. */
const assertAllCanonical = async (
  workspaceId: string,
  context = "",
): Promise<QueryDocumentSnapshot[]> => {
  const docs = await transactionDocs(workspaceId);
  for (const doc of docs) {
    assertCanonicalTransaction({id: doc.id, data: doc.data()}, context);
  }
  return docs;
};

// -------------------------------------------------------------- tenants

type Tenant = LoanTenant;

const seedTenant = async (
  type: "PF" | "PJ",
  prefix: string,
): Promise<Tenant> => {
  const tenant = await seedSplitTenant(type, prefix);
  await seedDefaultCategories(tenant.workspaceId);
  tenants.push(tenant);
  return tenant;
};

// -------------------------------------------------------------- gatilho

/**
 * Entrega ao gatilho real (antes e depois, com o instante de commit) tudo o
 * que mudou em `transactions` desde a última chamada. Escritas que se
 * acumulam entre duas chamadas viram uma única variação `antes → depois`.
 */
const deliveryOf = (workspaceId: string) => {
  const seen = new Map<string, {
    data: DocumentData;
    updateTime: Timestamp;
    createTime: Timestamp;
  }>();
  return async (): Promise<number> => {
    let delivered = 0;
    for (const doc of await transactionDocs(workspaceId)) {
      const previous = seen.get(doc.id);
      if (previous && previous.updateTime.isEqual(doc.updateTime)) continue;
      const event: TransactionWriteEvent = {
        eventId: uniqueId(`evt-${doc.id}`),
        workspaceId,
        transactionId: doc.id,
        eventTime: doc.updateTime,
        before: previous?.data,
        after: doc.data(),
        beforeCreateTime: previous?.createTime,
      };
      const result = await handleTransactionWrite(event);
      assert.equal(result.projection, "applied",
        `gatilho não aplicou o lançamento ${doc.id}`);
      seen.set(doc.id, {
        data: doc.data(),
        updateTime: doc.updateTime,
        createTime: doc.createTime,
      });
      delivered += 1;
    }
    return delivered;
  };
};

interface Run {
  t: Tenant;
  /** Guarda de schema em tudo o que está gravado + entrega ao gatilho. */
  checkpoint: (context?: string) => Promise<void>;
}

const startRun = async (type: "PF" | "PJ", prefix: string): Promise<Run> => {
  const t = await seedTenant(type, prefix);
  const deliver = deliveryOf(t.workspaceId);
  return {
    t,
    checkpoint: async (context = "") => {
      await assertAllCanonical(t.workspaceId, context);
      await deliver();
    },
  };
};

// ----------------------------------------------------------- conciliação

const MONTH_ID = /^\d{4}-\d{2}$/;

const isZeroDelta = (delta: CashPeriodDelta): boolean =>
  CASH_DELTA_FIELDS.every((field) => delta[field] === 0);

const periodsCollection = (workspaceId: string) =>
  db().collection(`workspaces/${workspaceId}/cash_report_periods`);

interface StoredMonth {
  total: CashPeriodDelta;
  days: CashDayDeltas;
  schemaVersion: unknown;
}

const storedMonths = async (
  workspaceId: string,
): Promise<Record<string, StoredMonth>> => {
  const months: Record<string, StoredMonth> = {};
  for (const doc of (await periodsCollection(workspaceId).get()).docs) {
    if (!MONTH_ID.test(doc.id)) continue;
    months[doc.id] = {
      total: normalizeCashPeriodDelta(doc.data()),
      days: readCashDayDeltas(doc.data().days),
      schemaVersion: doc.data().schemaVersion,
    };
  }
  return months;
};

const storedMonth = async (
  workspaceId: string,
  month: string,
): Promise<StoredMonth> => {
  const stored = (await storedMonths(workspaceId))[month];
  assert.ok(stored, `projeção do mês ${month} não existe`);
  return stored;
};

interface LedgerTruth {
  months: Record<string, CashPeriodDelta>;
  days: Record<string, CashDayDeltas>;
}

/** Verdade recalculada do ledger inteiro, sem passar pelo plano do gatilho. */
const ledgerTruth = async (workspaceId: string): Promise<LedgerTruth> => {
  const truth: LedgerTruth = {months: {}, days: {}};
  for (const doc of await transactionDocs(workspaceId)) {
    const data = doc.data();
    const delta = cashPeriodDeltaFor(data);
    if (isZeroDelta(delta)) continue;
    const day = cashDayKeyFor(data);
    const month = day.slice(0, 7);
    truth.months[month] = addCashPeriodDelta(
      truth.months[month] ?? emptyCashPeriodDelta(), delta);
    mergeCashDayDeltas(truth.days[month] ??= {}, {[day.slice(8, 10)]: delta});
  }
  return truth;
};

/**
 * Conciliação diária e mensal: o mês gravado é Σ `cashPeriodDeltaFor` dos
 * documentos do mês; o detalhe diário bate dia a dia; Σ dias = mês; o plano
 * de escrita (`cashWritePlanFor`) de cada documento soma o mesmo mês.
 */
const assertProjectionReconciles = async (workspaceId: string) => {
  const truth = await ledgerTruth(workspaceId);
  const stored = await storedMonths(workspaceId);

  const planned: Record<string, CashPeriodDelta> = {};
  for (const doc of await transactionDocs(workspaceId)) {
    const plan = cashWritePlanFor(undefined, doc.data());
    for (const [month, delta] of Object.entries(plan.months)) {
      planned[month] = addCashPeriodDelta(
        planned[month] ?? emptyCashPeriodDelta(), delta);
    }
  }
  assert.deepEqual(planned, truth.months,
    "plano de escrita ≠ soma dos documentos");

  for (const month of new Set([
    ...Object.keys(stored), ...Object.keys(truth.months),
  ])) {
    const actual = stored[month];
    assert.ok(actual || isZeroDelta(truth.months[month]),
      `mês ${month} sem projeção gravada`);
    if (!actual) continue;
    const expected = truth.months[month] ?? emptyCashPeriodDelta();
    assert.deepEqual(actual.total, expected,
      `mês ${month}: projeção ≠ Σ cashPeriodDeltaFor`);
    assert.deepEqual(actual.days, truth.days[month] ?? {},
      `mês ${month}: detalhe diário ≠ Σ por dia`);
    assert.ok(cashDaysMatchMonth(actual.days, actual.total),
      `mês ${month}: Σ dias ≠ total do mês`);
    assert.deepEqual(sumCashDayDeltas(actual.days), actual.total,
      `mês ${month}: Σ dias ≠ total do mês (campo a campo)`);
    assert.equal(actual.schemaVersion, CASH_PERIOD_SCHEMA_VERSION);
  }
  const state = await cashProjectionStateRef(workspaceId).get();
  assert.notEqual(state.get("needsRebuild"), true,
    "projeção marcada para reconstrução");
  return truth;
};

// ------------------------------------------------------------ produtores

// ----- caixa manual

interface MutationResult {
  transactionId: string;
  replayed: boolean;
}

const entryRef = (workspaceId: string, id: string) =>
  transactionsCollection(workspaceId).doc(id);

const readEntry = async (workspaceId: string, id: string) =>
  (await entryRef(workspaceId, id).get()).data() ?? {};

const versionOf = async (
  workspaceId: string,
  id: string,
): Promise<string | null> => {
  const updatedAt = (await readEntry(workspaceId, id)).updatedAt;
  return updatedAt instanceof Timestamp ? formatIsoInstant(updatedAt) : null;
};

const createEntry = (
  t: Tenant,
  overrides: Record<string, unknown> = {},
  uid = t.owner,
) => call<MutationResult>(createCashTransaction, uid, json({
  workspaceId: t.workspaceId,
  cashAccountId: defaultAccountOf(t.workspaceId),
  idempotencyKey: idempotencyKey(),
  type: "receita",
  description: "Salário de setembro",
  categoryId: defaultCategoryIdFor(
    overrides.type === "despesa" ? "despesa" : "receita"),
  amountCents: 620_000,
  date: "2026-09-15",
  ...overrides,
}));

const updateEntry = async (
  t: Tenant,
  transactionId: string,
  entry: Record<string, unknown>,
) => call<MutationResult>(updateCashTransaction, t.owner, json({
  workspaceId: t.workspaceId,
  idempotencyKey: idempotencyKey(),
  transactionId,
  expectedUpdatedAt: await versionOf(t.workspaceId, transactionId),
  reason: "Correção do valor e da data",
  entry: {
    cashAccountId: defaultAccountOf(t.workspaceId),
    type: "receita",
    description: "Salário de setembro",
    categoryId: defaultCategoryIdFor(
      entry.type === "despesa" ? "despesa" : "receita"),
    amountCents: 620_000,
    date: "2026-09-15",
    ...entry,
  },
}));

const confirmEntry = async (
  t: Tenant,
  transactionId: string,
  extra: Record<string, unknown> = {},
) => call<MutationResult>(confirmCashTransaction, t.owner, json({
  workspaceId: t.workspaceId,
  idempotencyKey: idempotencyKey(),
  transactionId,
  expectedUpdatedAt: await versionOf(t.workspaceId, transactionId),
  date: "2026-09-20",
  amountCents: 24_500,
  ...extra,
}));

const voidEntry = async (t: Tenant, transactionId: string) =>
  call<MutationResult>(voidCashTransaction, t.owner, json({
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId,
    expectedUpdatedAt: await versionOf(t.workspaceId, transactionId),
    reason: "Lançado em duplicidade",
  }));

const produceManualCash = async ({t, checkpoint}: Run) => {
  const salary = await createEntry(t);
  const rent = await createEntry(t, {
    type: "despesa",
    description: "Aluguel",
    amountCents: 180_050,
    date: "2026-09-16",
    expenseType: "Fixa",
    paymentMethod: "Pix",
  });
  await checkpoint("criação confirmada");
  assert.equal((await readEntry(t.workspaceId, salary.transactionId)).type,
    "receita");
  assert.equal((await readEntry(t.workspaceId, rent.transactionId)).type,
    "despesa");

  const light = await createEntry(t, {
    type: "despesa",
    description: "Conta de luz",
    amountCents: 24_090,
    status: "pending",
    dueDate: "2026-11-20",
    date: undefined,
    expenseType: "Variável",
    paymentMethod: "Boleto",
  });
  await checkpoint("criação pendente");
  const pending = await readEntry(t.workspaceId, light.transactionId);
  assert.equal(pending.isPaid, false);
  assert.equal(pending.date, "2026-11-20", "pendente: date = vencimento");
  assert.equal(pending.valueCents, 24_090);

  await updateEntry(t, rent.transactionId, {
    type: "despesa",
    description: "Aluguel",
    amountCents: 181_075,
    date: "2026-10-02",
    expenseType: "Fixa",
    paymentMethod: "Pix",
  });
  await checkpoint("correção de valor e data");
  const corrected = await readEntry(t.workspaceId, rent.transactionId);
  assert.equal(corrected.valueCents, 181_075);
  assert.equal(corrected.date, "2026-10-02");

  await confirmEntry(t, light.transactionId);
  await checkpoint("confirmação de pendente");
  const confirmed = await readEntry(t.workspaceId, light.transactionId);
  assert.equal(confirmed.isPaid, true);
  assert.equal(confirmed.valueCents, 24_500);
  assert.equal(confirmed.date, "2026-09-20");

  const duplicate = await createEntry(t, {
    type: "despesa",
    description: "Lançado em duplicidade",
    amountCents: 5_000,
    date: "2026-09-17",
  });
  await voidEntry(t, duplicate.transactionId);
  await checkpoint("anulação");
  const voided = await readEntry(t.workspaceId, duplicate.transactionId);
  assert.ok(voided.voidedAt, "anulação é baixa lógica: o documento fica");
  assert.equal(voided.valueCents, 5_000);
};

// ----- importação

const produceImport = async ({t, checkpoint}: Run) => {
  const result = await call<{
    created: number;
    items: Array<{transactionId: string}>;
  }>(importCashTransactions, t.member, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    importId: uniqueId("arquivo"),
    cashAccountId: defaultAccountOf(t.workspaceId),
    items: [
      {
        lineId: "linha-1", type: "receita", description: "Venda 1",
        categoryId: defaultCategoryIdFor("receita"), amountCents: 100_000,
        date: "2026-08-31",
      },
      {
        lineId: "linha-2", type: "despesa", description: "Compra sem categoria",
        amountCents: 25_050, date: "2026-09-01",
      },
      {
        lineId: "linha-3", type: "despesa", description: "Tarifa",
        categoryId: defaultCategoryIdFor("despesa"), amountCents: 1_999,
        date: "2026-08-05",
      },
    ],
  });
  assert.equal(result.created, 3);
  await checkpoint("importação em lote");
  for (const item of result.items) {
    const entry = await readEntry(t.workspaceId, item.transactionId);
    assert.equal(entry.isPaid, true);
    assert.equal(entry.workspaceId, t.workspaceId);
  }
};

// ----- recorrente

const produceRecurring = async ({t, checkpoint}: Run) => {
  // Automática: gera a despesa pendente; "por confirmação": a confirmação
  // paga gera o lançamento realizado.
  await executeCreateRecurringExpense(cardActor(t, t.owner),
    contractPayload(t, {startDate: "2026-03-10", billingDay: 10}),
    recurringRequest(), recurringClock("2026-03-01"));
  const confirmable = await executeCreateRecurringExpense(
    cardActor(t, t.owner),
    contractPayload(t, {
      startDate: "2026-03-10", billingDay: 10, name: "Aluguel do escritório",
      amountCents: 150_000, executionMode: "confirmation_required",
    }),
    recurringRequest(), recurringClock("2026-03-01"));
  await runOn("2026-03-10");
  const occurrences = (await db().collection(
    `workspaces/${t.workspaceId}/recurring_occurrences`).get())
    .docs.map((doc) => doc.data());
  const awaiting = occurrences.find((item) =>
    item.recurringExpenseId === confirmable.recurringExpenseId);
  assert.equal(awaiting?.status, "awaiting_confirmation");
  await checkpoint("ocorrências geradas");

  await confirmOccurrence(t, String(awaiting?.id), "2026-03-10",
    {settlement: "paid", paidDate: "2026-03-10", amountCents: 150_000});
  const docs = await assertAllCanonical(t.workspaceId, "recorrente confirmado");
  // Origem: `cashEntry.origin` e o vínculo backend-only `recurringEntry`.
  const generated = docs.filter((doc) =>
    doc.get("cashEntry.origin") === "recurring" &&
    doc.get("recurringEntry.recurringExpenseId") ===
      confirmable.recurringExpenseId);
  assert.equal(generated.length, 1,
    "a ocorrência confirmada gerou exatamente um lançamento");
  assert.equal(generated[0].get("valueCents"), 150_000);
  assert.equal(generated[0].get("isPaid"), true);
  assert.equal(generated[0].get("date"), "2026-03-10");
  assert.equal(generated[0].get("type"), "despesa");
  await checkpoint("ocorrência confirmada");
};

// ----- cartão

const produceCard = async ({t, checkpoint}: Run) => {
  const cardId = await createCard(t);
  const before = (await transactionDocs(t.workspaceId)).length;
  const bought = await buy(t, cardId, "2026-03-10",
    {totalCents: 30_000, installmentsCount: 3, description: "Curso"});
  // Compra parcelada vive no domínio de cartões, nunca em `transactions`.
  assert.equal((await transactionDocs(t.workspaceId)).length, before,
    "compra parcelada não cria lançamento em `transactions`");
  const purchase = (await db().doc(
    `workspaces/${t.workspaceId}/credit_card_purchases/${bought.purchaseId}`)
    .get()).data();
  assert.equal(purchase?.installmentsCount, 3);
  assert.equal(purchase?.totalCents, 30_000);
  const installments = (await db().collection(
    `workspaces/${t.workspaceId}/credit_card_invoice_entries`)
    .where("purchaseId", "==", bought.purchaseId).get()).docs;
  assert.equal(installments.length, 3, "uma parcela por competência");
  assert.equal(installments.reduce((sum, doc) =>
    sum + Number(doc.get("amountCents")), 0), 30_000);
  await checkpoint("compra parcelada");

  const payment = await payCardInvoice(t, cardId, "2026-03", "2026-03-26",
    10_000);
  const afterPayment = await assertAllCanonical(t.workspaceId,
    "pagamento de fatura");
  assert.equal(afterPayment.length, before + 1,
    "o pagamento gera um espelho de caixa");
  assert.ok(afterPayment.some((doc) => doc.get("creditCardPaymentEntry")));
  await checkpoint("pagamento de fatura");

  await executeReverseInvoicePayment(cardActor(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    paymentId: String(payment.paymentId),
    expectedUpdatedAt: await invoiceVersion(t.workspaceId, cardId, "2026-03"),
  }, cardRequest(), cardClock("2026-03-27"));
  const afterReversal = await assertAllCanonical(t.workspaceId,
    "estorno do pagamento");
  assert.equal(afterReversal.length, before + 2,
    "o estorno gera o espelho compensatório");
  await checkpoint("estorno do pagamento");
};

// ----- investimento

const catalogItem = async (
  t: Tenant,
  group: string,
  name: string,
  transactionSubtype?: string,
): Promise<string> => {
  const result = await executeCreateSettingsCatalogItem(
    {uid: t.owner, workspaceId: t.workspaceId, role: "owner"}, {
      workspaceId: t.workspaceId,
      idempotencyKey: idempotencyKey(),
      group,
      name,
      ...(transactionSubtype ? {transactionSubtype} : {}),
    } as Parameters<typeof executeCreateSettingsCatalogItem>[1],
    `req-tx-contract-${name}`);
  return result.itemId;
};

const produceInvestment = async ({t, checkpoint}: Run) => {
  const owner = {uid: t.owner, workspaceId: t.workspaceId, role: "owner"} as
    const;
  const catalog = {
    institutionId: await catalogItem(t, "investment_institution",
      "Banco Guarda"),
    classId: await catalogItem(t, "investment_class", "Reserva Guarda"),
    typeId: await catalogItem(t, "category", "Renda fixa Guarda",
      "investimento"),
  };
  const contribution = await executeCreateSimpleInvestment(owner, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    correlationId: `corr-tx-${idempotencyKey()}`,
    ...catalog,
    description: "Tesouro Selic",
    valueCents: 100_000,
    settled: true,
    occurredAt: "2026-08-10T12:00:00.000Z",
    cashAccountId: defaultAccountOf(t.workspaceId),
  } as Parameters<typeof executeCreateSimpleInvestment>[1]);
  await checkpoint("aporte de investimento");

  await executeWithdrawSimpleInvestment(owner, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    correlationId: `corr-tx-${idempotencyKey()}`,
    positionId: String(contribution.positionId),
    valueCents: 40_000,
    received: true,
    occurredAt: "2026-08-20T12:00:00.000Z",
    cashAccountId: defaultAccountOf(t.workspaceId),
  } as Parameters<typeof executeWithdrawSimpleInvestment>[1]);
  await checkpoint("retirada de investimento");

  const small = await executeCreateSimpleInvestment(owner, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    correlationId: `corr-tx-${idempotencyKey()}`,
    ...catalog,
    description: "Tesouro Selic",
    valueCents: 7_000,
    settled: true,
    occurredAt: "2026-08-12T12:00:00.000Z",
    cashAccountId: defaultAccountOf(t.workspaceId),
  } as Parameters<typeof executeCreateSimpleInvestment>[1]);
  await executeReverseInvestmentMovement(owner, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    correlationId: `corr-tx-${idempotencyKey()}`,
    movementId: String(small.movementId),
    reversedAt: "2026-08-25T12:00:00.000Z",
    reason: "Lançamento desfeito",
  } as Parameters<typeof executeReverseInvestmentMovement>[1]);
  await checkpoint("estorno de aporte");

  const docs = await transactionDocs(t.workspaceId);
  const mirrors = docs.filter((doc) => doc.get("investmentEntry"));
  assert.ok(mirrors.length >= 3, "aporte, retirada e aporte estornado");
  assert.ok(mirrors.every((doc) => doc.get("type") === "investimento"));
};

// ----- empréstimo

const produceLoan = async ({t, checkpoint}: Run) => {
  const borrow = await createLoan(t.owner, loanCreatePayload(t.workspaceId, {
    startDate: "2026-03-10", firstDueDate: "2026-04-10",
  }));
  await checkpoint("empréstimo tomado");
  const paid = await payLoan(t.owner, await loanPayPayload(
    t.workspaceId, borrow.loanId, {date: "2026-03-20"}));
  await checkpoint("pagamento de empréstimo");

  const lend = await createLoan(t.owner, loanCreatePayload(t.workspaceId, {
    type: "lend", startDate: "2026-03-12", firstDueDate: "2026-04-12",
  }));
  await payLoan(t.owner, await loanPayPayload(t.workspaceId, lend.loanId, {
    date: "2026-03-22", principalCents: 50_000, interestCents: 2_500,
  }));
  await checkpoint("recebimento de empréstimo concedido");

  await reverseLoan(t.owner, await loanReversePayload(
    t.workspaceId, borrow.loanId, String(paid.movementId)));
  await checkpoint("estorno de pagamento de empréstimo");

  const other = await createLoan(t.owner, loanCreatePayload(t.workspaceId, {
    startDate: "2026-03-14", firstDueDate: "2026-04-14",
  }));
  await cancelLoanCall(t.owner, await loanCancelPayload(
    t.workspaceId, other.loanId));
  await checkpoint("cancelamento de empréstimo");

  const mirrors = (await transactionDocs(t.workspaceId))
    .filter((doc) => doc.get("loanEntry"));
  assert.ok(mirrors.length >= 4, "espelhos de empréstimo gravados");
};

// ----- recebível (PJ)

const produceReceivable = async ({t, checkpoint}: Run) => {
  const clientId = await seedClient(t);
  const {receivableId} = await newReceivable(t.owner, receivablePayload(
    t.workspaceId, clientId, {dueDate: "2026-03-20", amountCents: 100_000}));
  const first = await receive(t.owner, await receivePayload(
    t.workspaceId, receivableId, {
      principalCents: 40_000, interestCents: 1_000, penaltyCents: 500,
      paymentDate: "2026-03-25",
    }));
  await checkpoint("recebimento");
  await receive(t.owner, await receivePayload(t.workspaceId, receivableId, {
    principalCents: 20_000, paymentDate: "2026-04-02",
  }));
  await checkpoint("segundo recebimento");
  await reverseReceipt(t.owner, await receiptReversePayload(
    t.workspaceId, receivableId, String(first.movementId)));
  await checkpoint("estorno de recebimento");
  const mirrors = (await transactionDocs(t.workspaceId))
    .filter((doc) => doc.get("receivableEntry"));
  assert.ok(mirrors.length >= 3, "recebimentos e estorno espelhados");
};

// ----- divisão de contas (PJ)

const produceSplit = async ({t, checkpoint}: Run) => {
  const accountId = defaultAccountOf(t.workspaceId);
  const group = await createGroup(t);
  const ownerParticipant = memberParticipantId(t, group.groupId, t.owner);
  await addMember(t, group.groupId, t.member);
  const memberParticipant = memberParticipantId(t, group.groupId, t.member);
  await createBill(t, billPayload(t, group.groupId, ownerParticipant,
    [ownerParticipant, memberParticipant], {
      amountCents: 10_000, financialIntegration: "cash",
      cashAccountId: accountId,
    }));
  await checkpoint("título da divisão pago pelo caixa");
  assert.ok((await transactionDocs(t.workspaceId))
    .some((doc) => doc.get("splitEntry")), "espelho do título");

  const reimbursementGroup = await createGroup(t,
    {businessMode: "reimbursement", name: "Reembolsos"});
  const requester = memberParticipantId(t, reimbursementGroup.groupId,
    t.owner);
  const {reimbursementId} = await createReimbursement(t,
    reimbursementPayload(t, reimbursementGroup.groupId, requester,
      {expenseDate: SPLIT_TODAY}));
  await approveReimbursement(t, reimbursementId);
  await payReimbursement(t, reimbursementId);
  await checkpoint("reembolso PJ pago");
  assert.ok((await transactionDocs(t.workspaceId)).filter((doc) =>
    doc.get("splitEntry")).length >= 2, "espelho do reembolso");
};

// ----------------------------------------------------------------- testes

test("guarda de schema: recusa documento com campo removido ou fora do " +
  "contrato (a própria guarda detecta)", () => {
  const valid: DocumentData = {
    type: "despesa",
    valueCents: 1_000,
    date: "2026-03-10",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
  assertCanonicalTransaction({id: "ok", data: valid});
  const invalid: Array<[string, DocumentData]> = [
    ["com value em reais", {...valid, value: 10}],
    ["com transactionDate", {...valid, transactionDate: Timestamp.now()}],
    ["tipo parcelado", {...valid, type: "parcelado"}],
    ["investimento sem marca", {...valid, type: "investimento"}],
    ["marca de investimento em despesa",
      {...valid, investmentEntry: {movementId: "x"}}],
    ["sem valueCents", {...valid, valueCents: undefined}],
    ["valueCents decimal", {...valid, valueCents: 10.5}],
    ["valueCents negativo", {...valid, valueCents: -1}],
    ["valueCents fora do inteiro seguro",
      {...valid, valueCents: Number.MAX_SAFE_INTEGER + 1}],
    ["sem date", {...valid, date: undefined}],
    ["date impossível", {...valid, date: "2026-02-30"}],
    ["date com instante", {...valid, date: "2026-03-10T12:00:00.000Z"}],
    ["createdAt em texto", {...valid, createdAt: "2026-03-10"}],
    ["sem updatedAt", {...valid, updatedAt: undefined}],
  ];
  for (const [label, data] of invalid) {
    assert.throws(() => assertCanonicalTransaction({id: "x", data}),
      Error, `a guarda deveria recusar: ${label}`);
  }
});

test("contrato — caixa manual: criação confirmada (receita e despesa), " +
  "pendente, correção, confirmação e anulação gravam só o schema canônico",
async () => {
  const run = await startRun("PF", "tx-cash");
  await produceManualCash(run);
  await assertProjectionReconciles(run.t.workspaceId);

  // Valores exatos: setembro = salário e luz confirmada; outubro = aluguel
  // corrigido; a anulada e a pendente não movem o caixa.
  const september = await storedMonth(run.t.workspaceId, "2026-09");
  assert.equal(september.total.incomeCents, 620_000);
  assert.equal(september.total.expenseCents, 24_500);
  assert.equal(september.total.netCents, 595_500);
  const october = await storedMonth(run.t.workspaceId, "2026-10");
  assert.equal(october.total.expenseCents, 181_075);
  assert.equal(october.total.netCents, -181_075);
});

test("contrato — importação em lote grava só o schema canônico", async () => {
  const run = await startRun("PJ", "tx-imp");
  await produceImport(run);
  const truth = await assertProjectionReconciles(run.t.workspaceId);
  assert.equal(truth.months["2026-08"].incomeCents, 100_000);
  assert.equal(truth.months["2026-08"].expenseCents, 1_999);
  assert.equal(truth.months["2026-09"].expenseCents, 25_050);
});

test("contrato — recorrente: a ocorrência confirmada que gera lançamento " +
  "grava só o schema canônico", async () => {
  const run = await startRun("PF", "tx-rec");
  await produceRecurring(run);
  await assertProjectionReconciles(run.t.workspaceId);
});

test("contrato — cartão: compra parcelada não cria `transactions` (cria " +
  "compra e parcelas); pagamento de fatura e estorno gravam o schema " +
  "canônico", async () => {
  const run = await startRun("PF", "tx-card");
  await produceCard(run);
  const truth = await assertProjectionReconciles(run.t.workspaceId);
  assert.equal(truth.months["2026-03"]?.creditCardPaymentCents ?? 0, 0,
    "pagamento + estorno se compensam no caixa");
});

test("contrato — investimento: aporte, retirada e estorno gravam o schema " +
  "canônico (tipo `investimento` só com `investmentEntry`)", async () => {
  const run = await startRun("PJ", "tx-inv");
  await produceInvestment(run);
  await assertProjectionReconciles(run.t.workspaceId);
});

test("contrato — empréstimo: espelhos de pagamento e recebimento gravam o " +
  "schema canônico", async () => {
  const run = await startRun("PF", "tx-loan");
  await produceLoan(run);
  await assertProjectionReconciles(run.t.workspaceId);
});

test("contrato — recebível: recebimento e estorno gravam o schema " +
  "canônico", async () => {
  const run = await startRun("PJ", "tx-rcv");
  await produceReceivable(run);
  await assertProjectionReconciles(run.t.workspaceId);
});

test("contrato — divisão de contas: título pago pelo caixa e reembolso PJ " +
  "gravam o schema canônico", async () => {
  const run = await startRun("PJ", "tx-split");
  await produceSplit(run);
  await assertProjectionReconciles(run.t.workspaceId);
});

test("conciliação — todos os produtores no mesmo workspace: mês = Σ " +
  "cashPeriodDeltaFor, dia a dia e Σ dias = mês", async () => {
  const run = await startRun("PJ", "tx-all");
  await produceManualCash(run);
  await produceImport(run);
  await produceRecurring(run);
  await produceCard(run);
  await produceInvestment(run);
  await produceLoan(run);
  await produceReceivable(run);
  await produceSplit(run);
  await run.checkpoint("todos os produtores");

  const docs = await transactionDocs(run.t.workspaceId);
  assert.ok(docs.length >= 15, "todos os produtores gravaram");
  const truth = await assertProjectionReconciles(run.t.workspaceId);
  const months = Object.keys(truth.months).sort();
  assert.ok(months.length >= 4, `meses distintos: ${months.join(", ")}`);
  // Cada mês gravado tem detalhe diário e, no total, o mesmo líquido que a
  // soma dos documentos.
  let netTotal = 0;
  for (const month of months) {
    const stored = await storedMonth(run.t.workspaceId, month);
    assert.equal(stored.total.netCents, truth.months[month].netCents, month);
    netTotal += stored.total.netCents;
  }
  assert.equal(netTotal, docs.reduce((sum, doc) =>
    sum + cashPeriodDeltaFor(doc.data()).netCents, 0),
  "caixa acumulado = Σ de todos os documentos");
});

test("virada de ano e de mês: 31/12 e 01/01 caem nos meses certos " +
  "(`date` decide), inclusive depois de uma correção de data", async () => {
  const run = await startRun("PF", "tx-year");
  const {t} = run;
  const lastDay = await createEntry(t, {
    amountCents: 10_000, date: "2025-12-31", description: "Último dia do ano",
  });
  await createEntry(t, {
    type: "despesa", amountCents: 3_000, date: "2026-01-01",
    description: "Primeiro dia do ano",
  });
  await createEntry(t, {
    amountCents: 7_000, date: "2026-01-31", description: "Fim de janeiro",
  });
  await createEntry(t, {
    type: "despesa", amountCents: 1_000, date: "2026-02-01",
    description: "Início de fevereiro",
  });
  await run.checkpoint("virada de ano");

  // O mês é o da data, não o da criação (hoje).
  const december = await storedMonth(t.workspaceId, "2025-12");
  assert.equal(december.total.incomeCents, 10_000);
  assert.equal(december.total.netCents, 10_000);
  assert.deepEqual(Object.keys(december.days), ["31"]);
  const january = await storedMonth(t.workspaceId, "2026-01");
  assert.equal(january.total.incomeCents, 7_000);
  assert.equal(january.total.expenseCents, 3_000);
  assert.equal(january.total.netCents, 4_000);
  assert.deepEqual(Object.keys(january.days).sort(), ["01", "31"]);
  const february = await storedMonth(t.workspaceId, "2026-02");
  assert.equal(february.total.expenseCents, 1_000);
  assert.deepEqual(Object.keys(february.days), ["01"]);
  await assertProjectionReconciles(t.workspaceId);

  // 31/12 → 01/01: sai de dezembro, entra em janeiro.
  await updateEntry(t, lastDay.transactionId, {
    amountCents: 10_000, date: "2026-01-01",
    description: "Último dia do ano",
  });
  await run.checkpoint("correção de data entre anos");
  const decemberAfter = await storedMonth(t.workspaceId, "2025-12");
  assert.equal(isZeroDelta(decemberAfter.total), true);
  assert.deepEqual(decemberAfter.days, {});
  const januaryAfter = await storedMonth(t.workspaceId, "2026-01");
  assert.equal(januaryAfter.total.incomeCents, 17_000);
  assert.equal(januaryAfter.total.netCents, 14_000);
  assert.deepEqual(januaryAfter.days["01"], {
    incomeCents: 10_000, expenseCents: 3_000, netCents: 7_000,
    transactionCount: 2,
  });
  await assertProjectionReconciles(t.workspaceId);
});

test("valor elevado: o teto da entrada de caixa é gravado e projetado " +
  "exatamente; acima dele a operação real recusa", async () => {
  const run = await startRun("PF", "tx-max");
  const {t} = run;
  await createEntry(t, {
    amountCents: CASH_ENTRY_MAX_CENTS, date: "2026-09-10",
    description: "Teto de receita",
  });
  await createEntry(t, {
    amountCents: CASH_ENTRY_MAX_CENTS, date: "2026-09-11",
    description: "Teto de receita 2",
  });
  await createEntry(t, {
    type: "despesa", amountCents: CASH_ENTRY_MAX_CENTS - 1,
    date: "2026-09-12", description: "Quase o teto",
  });
  const docs = await assertAllCanonical(t.workspaceId, "valor elevado");
  assert.deepEqual(docs.map((doc) => doc.get("valueCents")).sort(
    (a, b) => a - b),
  [CASH_ENTRY_MAX_CENTS - 1, CASH_ENTRY_MAX_CENTS, CASH_ENTRY_MAX_CENTS]);
  await run.checkpoint("valor elevado");

  const september = await storedMonth(t.workspaceId, "2026-09");
  assert.equal(september.total.incomeCents, 2 * CASH_ENTRY_MAX_CENTS);
  assert.equal(september.total.expenseCents, CASH_ENTRY_MAX_CENTS - 1);
  assert.equal(september.total.netCents, CASH_ENTRY_MAX_CENTS + 1);
  assert.ok(Number.isSafeInteger(september.total.incomeCents));
  assert.equal(september.days["12"].expenseCents, CASH_ENTRY_MAX_CENTS - 1);
  await assertProjectionReconciles(t.workspaceId);

  // Acima do teto: recusado na entrada, sem documento novo.
  const before = (await transactionDocs(t.workspaceId)).length;
  await expectHttpsError(createEntry(t, {
    amountCents: CASH_ENTRY_MAX_CENTS + 1, date: "2026-09-13",
  }), "invalid-argument");
  const target = docs.find((doc) => doc.get("type") === "despesa");
  assert.ok(target);
  await expectHttpsError(updateEntry(t, target.id, {
    type: "despesa", amountCents: CASH_ENTRY_MAX_CENTS + 1,
    date: "2026-09-12", description: "Quase o teto",
  }), "invalid-argument");
  assert.equal((await transactionDocs(t.workspaceId)).length, before,
    "recusa não deixou documento");
  assert.equal((await readEntry(t.workspaceId, target.id)).valueCents,
    CASH_ENTRY_MAX_CENTS - 1, "recusa não alterou o documento");
});

test("documento fora do contrato gravado à mão (escritor indevido): a " +
  "projeção não muda e o estado fica `needsRebuild` com " +
  "`contract_violation`", async () => {
  const run = await startRun("PF", "tx-forged");
  const {t} = run;
  const salary = await createEntry(t, {amountCents: 50_000});
  await createEntry(t, {
    type: "despesa", amountCents: 12_000, date: "2026-09-18",
  });
  await run.checkpoint("base válida");
  const base = await storedMonths(t.workspaceId);
  assert.equal(base["2026-09"].total.netCents, 38_000);
  const stateBefore = await cashProjectionStateRef(t.workspaceId).get();
  assert.notEqual(stateBefore.get("needsRebuild"), true);

  const now = () => Timestamp.now();
  const valid = {
    type: "receita", description: "Escritor indevido", valueCents: 99_900,
    date: "2026-09-25", isPaid: true, workspaceId: t.workspaceId,
    createdAt: now(), updatedAt: now(),
  };
  const forged: Array<[string, DocumentData]> = [
    ["só value em reais, sem valueCents", (() => {
      const {valueCents: _removed, ...rest} = valid;
      void _removed;
      return {...rest, value: 999};
    })()],
    ["transactionDate e sem date", (() => {
      const {date: _removed, ...rest} = valid;
      void _removed;
      return {...rest, transactionDate: now()};
    })()],
    ["type parcelado", {...valid, type: "parcelado"}],
    // L-4: `date` não textual não volta da consulta ordenada do cliente; a
    // violação é registrada aqui, pelo gatilho.
    ["date não textual (Timestamp)", {...valid, date: now()}],
    ["date numérico", {...valid, date: 20260925}],
  ];
  let expectedIssues = 0;
  for (const [label, data] of forged) {
    // O guarda de schema reconhece o documento como fora do contrato.
    const id = uniqueId("forjado");
    const ref = entryRef(t.workspaceId, id);
    await ref.set(data);
    const written = await ref.get();
    assert.throws(() => assertCanonicalTransaction({id, data: written.data() ??
      {}}), Error, label);
    const result = await handleTransactionWrite({
      eventId: uniqueId(`evt-${id}`),
      workspaceId: t.workspaceId,
      transactionId: id,
      eventTime: written.updateTime as Timestamp,
      before: undefined,
      after: written.data(),
    });
    expectedIssues += 1;
    assert.equal(result.projection, "failed_recorded", label);
    assert.deepEqual(await storedMonths(t.workspaceId), base,
      `${label}: a projeção não pode mudar`);
    const state = (await cashProjectionStateRef(t.workspaceId).get()).data();
    assert.equal(state?.needsRebuild, true, label);
    assert.equal(state?.lastIssueCode, "contract_violation", label);
    assert.equal(state?.lastIssueTransactionId, id, label);
    assert.equal(state?.issueCount, expectedIssues, label);
  }

  // Um lançamento real adulterado depois (antes válido → depois inválido):
  // o efeito anterior permanece e nada parcial é somado.
  const before = await entryRef(t.workspaceId, salary.transactionId).get();
  const adulterated = {...before.data(), type: "parcelado"};
  await entryRef(t.workspaceId, salary.transactionId).set(adulterated);
  const after = await entryRef(t.workspaceId, salary.transactionId).get();
  const result = await handleTransactionWrite({
    eventId: uniqueId("evt-adulterado"),
    workspaceId: t.workspaceId,
    transactionId: salary.transactionId,
    eventTime: after.updateTime as Timestamp,
    before: before.data(),
    after: after.data(),
    beforeCreateTime: before.createTime,
  });
  assert.equal(result.projection, "failed_recorded");
  assert.deepEqual(await storedMonths(t.workspaceId), base);
  const state = (await cashProjectionStateRef(t.workspaceId).get()).data();
  assert.equal(state?.lastIssueCode, "contract_violation");
  assert.equal(state?.issueCount, expectedIssues + 1);
});

test("listagem por cursor: percorre todas as páginas sem repetir nem " +
  "perder, e todo documento é canônico", async () => {
  const run = await startRun("PJ", "tx-page");
  const {t} = run;
  const line = (index: number) => ({
    lineId: `linha-${index}`,
    type: index % 2 === 0 ? "receita" : "despesa",
    description: `Linha ${index}`,
    categoryId: defaultCategoryIdFor(index % 2 === 0 ? "receita" : "despesa"),
    amountCents: 1_000 + index,
    // Datas repetidas de propósito: o desempate é o ID do documento.
    date: `2026-09-${String(1 + (index % 6)).padStart(2, "0")}`,
  });
  for (const [from, to] of [[1, 12], [13, 24]]) {
    await call(importCashTransactions, t.owner, {
      workspaceId: t.workspaceId,
      idempotencyKey: idempotencyKey(),
      importId: uniqueId("arquivo"),
      cashAccountId: defaultAccountOf(t.workspaceId),
      items: Array.from({length: to - from + 1}, (_, k) => line(from + k)),
    });
  }
  await createEntry(t, {amountCents: 5_000, date: "2026-09-03"});
  await createEntry(t, {
    type: "despesa", amountCents: 700, status: "pending",
    dueDate: "2026-09-03", date: undefined,
  });
  await run.checkpoint("lista paginada");

  const all = await transactionDocs(t.workspaceId);
  assert.equal(all.length, 26);
  const pageSize = 7;
  const seen: string[] = [];
  const pages: number[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  for (let guard = 0; guard < 10; guard += 1) {
    let query = transactionsCollection(t.workspaceId)
      .orderBy("date", "desc")
      .orderBy(admin.firestore.FieldPath.documentId(), "desc")
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = (await query.get()).docs;
    if (page.length === 0) break;
    pages.push(page.length);
    for (const doc of page) {
      assertCanonicalTransaction({id: doc.id, data: doc.data()}, "página");
      seen.push(doc.id);
    }
    cursor = page[page.length - 1];
    if (page.length < pageSize) break;
  }
  assert.deepEqual(pages, [7, 7, 7, 5], "quatro páginas");
  assert.equal(new Set(seen).size, seen.length, "documento repetido");
  assert.deepEqual([...seen].sort(), all.map((doc) => doc.id).sort(),
    "documento perdido");
  const keys = seen.map((id) => {
    const doc = all.find((item) => item.id === id);
    return `${doc?.get("date")}|${id}`;
  });
  assert.deepEqual(keys, [...keys].sort().reverse(),
    "ordem: date desc, ID desc");
});

test("isolamento: dois workspaces (PF e PJ) nunca enxergam os documentos " +
  "um do outro e cada um carrega o próprio workspace e perfil", async () => {
  const personal = await startRun("PF", "tx-iso-pf");
  const business = await startRun("PJ", "tx-iso-pj");
  await createEntry(personal.t, {
    amountCents: 11_100, description: "Receita pessoal",
  });
  await createEntry(personal.t, {
    type: "despesa", amountCents: 2_200, description: "Despesa pessoal",
    date: "2026-09-16",
  });
  await createEntry(business.t, {
    amountCents: 33_300, description: "Receita da empresa",
  });
  await produceImport(business);
  await personal.checkpoint("PF");
  await business.checkpoint("PJ");

  const pfDocs = await transactionDocs(personal.t.workspaceId);
  const pjDocs = await transactionDocs(business.t.workspaceId);
  assert.equal(pfDocs.length, 2);
  assert.equal(pjDocs.length, 4);
  const pfIds = new Set(pfDocs.map((doc) => doc.id));
  assert.equal(pjDocs.some((doc) => pfIds.has(doc.id)), false,
    "documento do PF apareceu no PJ");
  for (const doc of pfDocs) {
    assert.equal(doc.get("workspaceId"), personal.t.workspaceId);
    assert.equal(doc.get("profileType"), "PF");
    assert.match(String(doc.get("description")), /pessoal/);
  }
  for (const doc of pjDocs) {
    assert.equal(doc.get("workspaceId"), business.t.workspaceId);
    assert.equal(doc.get("profileType"), "PJ");
    assert.doesNotMatch(String(doc.get("description")), /pessoal/);
    assert.equal(pfIds.has(doc.id), false);
  }
  // A projeção de cada um é só dele.
  const pfMonths = await storedMonths(personal.t.workspaceId);
  const pjMonths = await storedMonths(business.t.workspaceId);
  assert.equal(pfMonths["2026-09"].total.netCents, 11_100 - 2_200);
  assert.equal(pjMonths["2026-09"].total.netCents, 33_300 - 25_050);
  assert.equal(pfMonths["2026-08"], undefined, "mês do PJ vazou para o PF");
  await assertProjectionReconciles(personal.t.workspaceId);
  await assertProjectionReconciles(business.t.workspaceId);
});
