import assert from "node:assert/strict";
import test, {after} from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {executeArchiveCashAccount} from "../../accounts/operations";
import {runCashAccountReconciliation} from "../../accounts/reconciliation";
import {
  createAccountPayload,
  newAccount,
  statusPayload,
} from "../../accounts/testSupport/accountTestSupport";
import {cashPeriodDeltaFor, cashPeriodEventKey} from "../../cash/periods";
import {executeCreateCreditCard} from "../../cards/cardOperations";
import {executeRegisterInvoicePayment} from "../../cards/invoiceOperations";
import {invoiceIdFor} from "../../cards/model";
import {executeCreateCreditCardPurchase} from "../../cards/purchaseOperations";
import {executeRecalculateCardLimit} from "../../cards/reconciliation";
import {
  actorOf as cardActor,
  buy,
  cardPayload,
  clockAt as cardClock,
  createCard,
  invoiceVersion,
  pay,
  purchasePayload,
  readInvoice,
  requestId as cardRequest,
} from "../../cards/testSupport/cardTestSupport";
import {
  executeCreateSimpleInvestment,
  executeReverseInvestmentMovement,
  executeWithdrawSimpleInvestment,
} from "../../investments/operationsV2";
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
  executeArchiveSettingsCatalogItem,
  executeCreateSettingsCatalogItem,
  executeUpdateSettingsCatalogItem,
} from "../../settingsCatalog/operations";
import {executeCreateSplitBill} from "../../splitBills/billOperations";
import {executeCreateSplitGroup} from "../../splitBills/groupOperations";
import {
  addMember,
  approveReimbursement,
  assertSplitReconciles,
  billPayload,
  clockAt as splitClock,
  createBill,
  createGroup,
  createReimbursement,
  groupPayload,
  memberParticipantId,
  payReimbursement,
  reimbursementPayload,
  reimbursementRef,
  requestId as splitRequest,
  seedSplitTenant,
  type SplitTenant,
} from "../../splitBills/testSupport/splitTestSupport";
import {handleTransactionWrite} from "../../triggers/transactions";
import {db, idempotencyKey} from "../../workspaces/testSupport/p1TestSupport";
import {formatIsoInstant} from "../commitTime";
import {
  defaultAccountOf,
  seedMember,
} from "../testSupport/kernelTestSupport";
import type {WorkspaceActor, WorkspaceRole} from "../workspaceAuth";

/**
 * Gate de P4 — invariantes **entre** domínios (Cartões P4-A, Recorrentes
 * P4-B, Divisão de contas P4-C, Investimentos P4-D, Catálogo P4-E, Caixa
 * P3-J). Cada domínio tem a própria suíte; aqui só as interfaces:
 *
 * - **caixa** — todo fato liquidado dos produtores P4 move a conta no mesmo
 *   commit, e conta = livro-razão = espelho em `transactions`, por conta;
 * - **quota** — nenhum fato derivado consome `transactionsPerMonth` (D-40);
 * - **`transactions` forjado** — um documento que não veio do produtor não
 *   vira saldo, patrimônio, fatura nem limite em outro domínio;
 * - **catálogo** — item inativo não serve para fato novo; o histórico
 *   continua resolvível pela fotografia do nome;
 * - **RBAC** — o mesmo padrão em todos: papel relido na transação, viewer
 *   recusado, membership removido recusado, operação administrativa recusada
 *   ao member, sem nenhuma escrita;
 * - **workspace** — ID estrangeiro (conta, cartão, posição, item) recusado
 *   em toda integração crítica, sem escrita em nenhum dos dois workspaces;
 * - **concorrência** — duas quitações da mesma fatura, dois estornos do mesmo
 *   aporte, dois pagamentos do mesmo reembolso e arquivamento da conta contra
 *   um aporte nela: um vence, sem efeito parcial;
 * - **trilha do gatilho** — o efeito em caixa registrado em `activity_logs`
 *   é o da classificação autoritativa (marca do domínio), em centavos.
 */

const tenants: SplitTenant[] = [];
after(async () => {
  await cleanupRecurring(tenants);
});

const ws = (workspaceId: string) => db().doc(`workspaces/${workspaceId}`);
const docsOf = async (workspaceId: string, collection: string) =>
  (await ws(workspaceId).collection(collection).get()).docs;
const countOf = async (workspaceId: string, collection: string) =>
  (await docsOf(workspaceId, collection)).length;

const P4_COLLECTIONS = [
  "transactions",
  "cash_account_movements",
  "credit_cards",
  "credit_card_purchases",
  "credit_card_invoice_payments",
  "recurring_expenses",
  "split_groups",
  "split_bills",
  "investment_movements",
  "settings_catalog",
] as const;

const snapshotCounts = async (workspaceId: string) => {
  const counts: Record<string, number> = {};
  for (const name of P4_COLLECTIONS) {
    counts[name] = await countOf(workspaceId, name);
  }
  return counts;
};

const errorCode = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return String((error as {code?: string}).code ?? "sem código");
  }
  assert.fail("a operação deveria ter sido recusada");
};

const actor = (
  tenant: SplitTenant,
  uid: string,
  role: WorkspaceRole,
): WorkspaceActor => ({uid, workspaceId: tenant.workspaceId, role});

// ------------------------------------------------------------- catálogo

type CatalogPayload = Parameters<typeof executeCreateSettingsCatalogItem>[1];

const catalogItem = async (
  tenant: SplitTenant,
  group: string,
  name: string,
  transactionSubtype?: string,
): Promise<string> => {
  const result = await executeCreateSettingsCatalogItem(
    actor(tenant, tenant.owner, "owner"), {
      workspaceId: tenant.workspaceId,
      idempotencyKey: idempotencyKey(),
      group,
      name,
      ...(transactionSubtype ? {transactionSubtype} : {}),
    } as CatalogPayload, `req-p4g-cat-${name}`);
  return result.itemId;
};

interface InvestmentCatalog {
  institutionId: string;
  classId: string;
  typeId: string;
}

const investmentCatalog = async (
  tenant: SplitTenant,
  suffix = "",
): Promise<InvestmentCatalog> => ({
  institutionId: await catalogItem(tenant, "investment_institution",
    `Banco Gate${suffix}`),
  classId: await catalogItem(tenant, "investment_class",
    `Reserva Gate${suffix}`),
  typeId: await catalogItem(tenant, "category", `Renda fixa Gate${suffix}`,
    "investimento"),
});

const catalogVersion = async (workspaceId: string, itemId: string) =>
  formatIsoInstant((await ws(workspaceId).collection("settings_catalog")
    .doc(itemId).get()).get("updatedAt") as Timestamp);

// --------------------------------------------------------- investimentos

type CreateInvestmentPayload =
  Parameters<typeof executeCreateSimpleInvestment>[1];
type WithdrawPayload = Parameters<typeof executeWithdrawSimpleInvestment>[1];
type ReversePayload = Parameters<typeof executeReverseInvestmentMovement>[1];

const invest = (
  tenant: SplitTenant,
  catalog: InvestmentCatalog,
  valueCents: number,
  overrides: Record<string, unknown> = {},
  who: WorkspaceActor = actor(tenant, tenant.owner, "owner"),
) => executeCreateSimpleInvestment(who, {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  correlationId: `corr-p4g-${idempotencyKey()}`,
  institutionId: catalog.institutionId,
  classId: catalog.classId,
  typeId: catalog.typeId,
  description: "Tesouro Selic",
  valueCents,
  settled: true,
  occurredAt: "2026-08-10T12:00:00.000Z",
  cashAccountId: defaultAccountOf(tenant.workspaceId),
  ...overrides,
} as CreateInvestmentPayload);

const withdraw = (
  tenant: SplitTenant,
  positionId: string,
  valueCents: number,
  overrides: Record<string, unknown> = {},
) => executeWithdrawSimpleInvestment(actor(tenant, tenant.owner, "owner"), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  correlationId: `corr-p4g-${idempotencyKey()}`,
  positionId,
  valueCents,
  received: true,
  occurredAt: "2026-08-20T12:00:00.000Z",
  cashAccountId: defaultAccountOf(tenant.workspaceId),
  ...overrides,
} as WithdrawPayload);

const reverseInvestment = (tenant: SplitTenant, movementId: string) =>
  executeReverseInvestmentMovement(actor(tenant, tenant.owner, "owner"), {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    correlationId: `corr-p4g-${idempotencyKey()}`,
    movementId,
    reversedAt: "2026-08-25T12:00:00.000Z",
    reason: "Lançamento desfeito",
  } as ReversePayload);

// ------------------------------------------------------------------ caixa

/**
 * Conta = livro-razão = espelho, **por conta**: o saldo gravado é a soma dos
 * movimentos, e o efeito dos espelhos de caixa que apontam para a conta (pela
 * mesma classificação da projeção) é o mesmo valor.
 */
const assertCashCoherent = async (workspaceId: string) => {
  const report = await runCashAccountReconciliation(workspaceId);
  assert.deepEqual(report.divergentAccountIds, [], "conta ≠ livro-razão");
  assert.equal(report.orphanMovementCount, 0, "movimento sem conta");
  const mirrors = (await docsOf(workspaceId, "transactions"))
    .map((doc) => doc.data());
  const movements = (await docsOf(workspaceId, "cash_account_movements"))
    .map((doc) => doc.data());
  for (const account of await docsOf(workspaceId, "cash_accounts")) {
    const balance = Number(account.get("balanceCents"));
    const ledger = movements.filter((item) => item.accountId === account.id)
      .reduce((sum, item) => sum + Number(item.amountCents), 0);
    const mirrored = mirrors.filter((item) => item.cashAccountId === account.id)
      .reduce((sum, item) => sum + cashPeriodDeltaFor(item).netCents, 0);
    assert.equal(balance, ledger, `saldo ≠ movimentos (${account.id})`);
    assert.equal(mirrored, ledger, `espelhos ≠ movimentos (${account.id})`);
  }
  return {mirrors, movements};
};

/** D-40: nenhum contador mensal `transactions_YYYY-MM` foi aberto. */
const assertNoManualQuota = async (workspaceId: string) => {
  const counters = (await docsOf(workspaceId, "quota_state"))
    .map((doc) => doc.id).filter((id) => id.startsWith("transactions_"));
  assert.deepEqual(counters, [], "fato derivado consumiu a quota manual");
};

// ------------------------------------------------------------------ testes

test("gate P4 — caixa: cartão, recorrente, divisão, reembolso PJ e " +
  "investimento movem a conta no mesmo commit; conta = razão = espelho; " +
  "sem quota manual; trilha do gatilho com o efeito autoritativo",
async () => {
  const t = await seedSplitTenant("PJ", "p4g-cash");
  tenants.push(t);
  const accountId = defaultAccountOf(t.workspaceId);

  // P4-A — compra no cartão e quitação da fatura pelo Caixa.
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-10", {totalCents: 30_000});
  await pay(t, cardId, "2026-03", "2026-03-26", 30_000);

  // P4-B — rotina de recorrentes no Caixa (D-12): a automática gera despesa
  // pendente, sem mover a conta; a "por confirmação", confirmada como paga,
  // move a conta no mesmo commit.
  await executeCreateRecurringExpense(cardActor(t, t.owner),
    contractPayload(t, {startDate: "2026-03-10", billingDay: 10}),
    recurringRequest(), recurringClock("2026-03-01"));
  const confirmed = await executeCreateRecurringExpense(cardActor(t, t.owner),
    contractPayload(t, {startDate: "2026-03-10", billingDay: 10,
      name: "Aluguel", amountCents: 150_000,
      executionMode: "confirmation_required"}),
    recurringRequest(), recurringClock("2026-03-01"));
  await runOn("2026-03-10");
  const occurrences = (await docsOf(t.workspaceId, "recurring_occurrences"))
    .map((doc) => doc.data());
  const awaiting = occurrences.find((item) =>
    item.recurringExpenseId === confirmed.recurringExpenseId);
  assert.equal(awaiting?.status, "awaiting_confirmation");
  assert.equal(occurrences.find((item) =>
    item.recurringExpenseId !== confirmed.recurringExpenseId)?.settlement,
  "pending", "automática fora do cartão: pendente, sem mover conta");
  await confirmOccurrence(t, String(awaiting?.id), "2026-03-10",
    {settlement: "paid", paidDate: "2026-03-10", amountCents: 150_000});

  // P4-C — título pago pelo Caixa e reembolso PJ pago.
  const split = await createGroup(t);
  const ownerParticipant = memberParticipantId(t, split.groupId, t.owner);
  await addMember(t, split.groupId, t.member);
  const memberParticipant = memberParticipantId(t, split.groupId, t.member);
  await createBill(t, billPayload(t, split.groupId, ownerParticipant,
    [ownerParticipant, memberParticipant], {
      amountCents: 10_000, financialIntegration: "cash",
      cashAccountId: accountId,
    }));
  const reimbursementGroup = await createGroup(t,
    {businessMode: "reimbursement", name: "Reembolsos"});
  const requester = memberParticipantId(t, reimbursementGroup.groupId,
    t.owner);
  const {reimbursementId} = await createReimbursement(t,
    reimbursementPayload(t, reimbursementGroup.groupId, requester));
  await approveReimbursement(t, reimbursementId);
  await payReimbursement(t, reimbursementId);

  // P4-D — aporte liquidado e retirada recebida (itens do catálogo P4-E).
  const catalog = await investmentCatalog(t);
  const contribution = await invest(t, catalog, 100_000);
  const withdrawal = await withdraw(t, String(contribution.positionId),
    40_000);
  // Estorno compensa na conta do fato original (D-30), não na padrão.
  const second = await newAccount(t.owner, createAccountPayload(
    t.workspaceId, {name: "Corrente", openingBalanceCents: 0}));
  const inSecond = await invest(t, catalog, 7_000,
    {cashAccountId: second.accountId});
  await reverseInvestment(t, String(inSecond.movementId));

  const {mirrors, movements} = await assertCashCoherent(t.workspaceId);
  const secondAccount = await ws(t.workspaceId).collection("cash_accounts")
    .doc(second.accountId).get();
  assert.equal(secondAccount.get("balanceCents"), 0,
    "aporte e estorno na mesma conta");
  assert.equal(movements.filter((item) =>
    item.accountId === second.accountId).length, 2);
  const balance = Number((await ws(t.workspaceId).collection("cash_accounts")
    .doc(accountId).get()).get("balanceCents"));
  assert.equal(balance,
    -30_000 - 150_000 - 10_000 - 8_750 - 100_000 + 40_000,
    "cada produtor moveu a conta uma vez, pelo valor do fato");
  assert.equal(movements.length, 8, "um movimento por fato liquidado");
  for (const movement of movements) {
    assert.ok(mirrors.some((mirror) =>
      mirror.cashAccountId === movement.accountId &&
      cashPeriodDeltaFor(mirror).netCents === movement.amountCents),
    `movimento ${movement.id} sem espelho do mesmo valor`);
  }
  await assertNoManualQuota(t.workspaceId);
  await assertSplitReconciles(t.workspaceId, split.groupId);

  // Trilha do gatilho: a retirada (entrada de caixa) aparece positiva, pela
  // marca `investmentEntry`, e em centavos — nunca pelo `value` em reais.
  const mirrorDoc = (await docsOf(t.workspaceId, "transactions")).find((doc) =>
    doc.get("investmentEntry")?.movementId === withdrawal.movementId);
  assert.ok(mirrorDoc, "espelho da retirada");
  const eventId = `p4g-trilha-${t.workspaceId}`;
  await handleTransactionWrite({
    eventId,
    workspaceId: t.workspaceId,
    transactionId: mirrorDoc.id,
    eventTime: Timestamp.now(),
    after: mirrorDoc.data(),
  });
  const log = (await ws(t.workspaceId).collection("activity_logs")
    .doc(`transaction_${cashPeriodEventKey(eventId)}`).get()).data();
  assert.equal(log?.details?.netCentsBefore, 0);
  assert.equal(log?.details?.netCentsAfter, 40_000);
  assert.equal(log?.details?.balanceAfter, undefined,
    "sem saldo em reais na trilha");
});

test("gate P4 — `transactions` forjado não vira saldo, patrimônio, fatura " +
  "nem limite em outro domínio", async () => {
  const t = await seedSplitTenant("PF", "p4g-forged");
  const accountId = defaultAccountOf(t.workspaceId);
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-10", {totalCents: 20_000});
  const catalog = await investmentCatalog(t);
  const contribution = await invest(t, catalog, 50_000);
  const positionId = String(contribution.positionId);
  const read = async (path: string) =>
    (await ws(t.workspaceId).collection(path.split("/")[0])
      .doc(path.split("/")[1]).get()).data() ?? {};

  const before = {
    account: await read(`cash_accounts/${accountId}`),
    position: await read(`investment_positions/${positionId}`),
    summary: await read("investment_summaries/current"),
    invoice: await readInvoice(t.workspaceId, cardId, "2026-03"),
    card: await read(`credit_cards/${cardId}`),
  };
  const realEntry = (await docsOf(t.workspaceId, "transactions"))
    .find((doc) => doc.get("investmentEntry"))?.get("investmentEntry");
  assert.ok(realEntry);

  // Escritas que nenhum produtor faz (as Rules negam ao cliente; aqui o Admin
  // SDK simula um documento que chegou por fora).
  const forged = ws(t.workspaceId).collection("transactions");
  await forged.doc("forjado-sem-marca").set({
    type: "investimento", value: 9_999.99, valueCents: 999_999,
    date: "2026-08-11", isPaid: true, cashAccountId: accountId,
    workspaceId: t.workspaceId,
  });
  await forged.doc("forjado-com-marca").set({
    type: "investimento", value: 7_777.77, valueCents: 777_777,
    date: "2026-08-12", isPaid: true, cashAccountId: accountId,
    accountMovementId: "acm_inexistente", workspaceId: t.workspaceId,
    investmentEntry: {...realEntry, movementId: "mov-forjado",
      amountCents: 777_777},
  });
  await forged.doc("forjado-pagamento").set({
    type: "despesa", value: 200, valueCents: 20_000, date: "2026-03-26",
    isPaid: true, cashAccountId: accountId, workspaceId: t.workspaceId,
    creditCardPaymentEntry: {cardId, invoiceId: invoiceIdFor(cardId,
      "2026-03"), paymentId: "pagamento-forjado", amountCents: 20_000,
    accountMovementId: "acm_forjado", reversal: false},
  });

  // Nenhuma autoridade mudou.
  assert.deepEqual(await read(`cash_accounts/${accountId}`), before.account);
  assert.deepEqual(await read(`investment_positions/${positionId}`),
    before.position);
  assert.deepEqual(await read("investment_summaries/current"),
    before.summary);
  assert.deepEqual(await readInvoice(t.workspaceId, cardId, "2026-03"),
    before.invoice, "fatura não é quitada por espelho");
  const report = await runCashAccountReconciliation(t.workspaceId);
  assert.deepEqual(report.divergentAccountIds, []);

  // As operações seguintes leem o próprio livro, nunca o espelho.
  const limit = await executeRecalculateCardLimit(cardActor(t, t.owner), {
    workspaceId: t.workspaceId, cardId,
  } as Parameters<typeof executeRecalculateCardLimit>[1], cardRequest());
  assert.equal(limit.consistent, true, "limite = razão = fatos");
  assert.equal(limit.ledgerLimitUsedCents, 20_000);
  assert.equal(limit.factsLimitUsedCents, 20_000,
    "o pagamento forjado não libera limite");
  assert.equal(await errorCode(withdraw(t, positionId, 50_001)),
    "domain_precondition_failed", "o espelho não aumenta a posição");
  const all = await withdraw(t, positionId, 50_000);
  assert.ok(all.movementId, "a retirada do principal inteiro é aceita");
  const movements = (await docsOf(t.workspaceId, "cash_account_movements"))
    .map((doc) => doc.data());
  assert.equal(movements.reduce((sum, item) =>
    sum + Number(item.amountCents), 0), 0, "aporte e retirada se anulam");
  assert.equal(Number((await read(`cash_accounts/${accountId}`))
    .balanceCents), 0);
});

test("gate P4 — catálogo: item inativo não serve para fato novo; o " +
  "histórico continua resolvível pela fotografia", async () => {
  const t = await seedSplitTenant("PF", "p4g-catalog");
  const catalog = await investmentCatalog(t);
  const first = await invest(t, catalog, 30_000);
  await executeArchiveSettingsCatalogItem(actor(t, t.owner, "owner"), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    itemId: catalog.institutionId,
    expectedUpdatedAt: await catalogVersion(t.workspaceId,
      catalog.institutionId),
  }, "req-p4g-archive");
  const before = await snapshotCounts(t.workspaceId);
  assert.equal(await errorCode(invest(t, catalog, 10_000)),
    "domain_precondition_failed", "instituição inativa recusada");
  assert.deepEqual(await snapshotCounts(t.workspaceId), before);
  const movement = (await ws(t.workspaceId).collection("investment_movements")
    .doc(String(first.movementId)).get()).data();
  assert.equal(movement?.institutionName, "Banco Gate",
    "o fato antigo guarda o nome da época");
  // A posição já existente continua movimentável (vínculo preservado).
  const out = await withdraw(t, String(first.positionId), 30_000);
  assert.ok(out.movementId, "a posição antiga continua movimentável");
  // O nome continua reservado: recriar falha; reativar devolve o item.
  assert.equal(await errorCode(catalogItem(t, "investment_institution",
    "banco gate")), "already_exists");
});

test("gate P4 — RBAC uniforme: papel relido na transação; viewer, " +
  "membership removido e member em operação administrativa recusados, " +
  "sem escrita", async () => {
  const t = await seedSplitTenant("PF", "p4g-rbac");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-10", {totalCents: 5_000});
  const catalog = await investmentCatalog(t);
  const contribution = await invest(t, catalog, 10_000);
  // Membership removido depois da pré-checagem: o ator ainda diz "member".
  await seedMember(t.workspaceId, t.otherMember, "member", "removed");

  type Operation = (who: WorkspaceActor) => Promise<unknown>;
  const memberOps: Array<[string, Operation]> = [
    ["compra no cartão (P4-A)", (who) => executeCreateCreditCardPurchase(
      who, purchasePayload(t.workspaceId, cardId,
        {purchaseDate: "2026-03-11"}), cardRequest(), cardClock("2026-03-11"))],
    ["recorrente (P4-B)", (who) => executeCreateRecurringExpense(who,
      contractPayload(t), recurringRequest(), recurringClock("2026-03-01"))],
    ["grupo de divisão (P4-C)", (who) => executeCreateSplitGroup(who,
      groupPayload(t), splitRequest(), splitClock())],
    ["aporte (P4-D)", (who) => invest(t, catalog, 1_000, {}, who)],
  ];
  const adminOps: Array<[string, Operation]> = [
    ["cartão (P4-A)", (who) => executeCreateCreditCard(who,
      cardPayload(t.workspaceId), cardRequest())],
    ["pagamento de fatura (P4-A)", async (who) =>
      executeRegisterInvoicePayment(who, {
        workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(), cardId,
        invoiceId: invoiceIdFor(cardId, "2026-03"),
        cashAccountId: defaultAccountOf(t.workspaceId), amountCents: 5_000,
        paymentDate: "2026-03-26",
        expectedUpdatedAt: await invoiceVersion(t.workspaceId, cardId,
          "2026-03"),
      } as Parameters<typeof executeRegisterInvoicePayment>[1], cardRequest(),
      cardClock("2026-03-26"))],
    ["estorno de investimento (P4-D)", (who) =>
      executeReverseInvestmentMovement(who, {
        workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
        correlationId: "corr-p4g-rbac",
        movementId: String(contribution.movementId),
        reversedAt: "2026-08-25T12:00:00.000Z", reason: "Teste de papel",
      } as ReversePayload)],
    ["item do catálogo (P4-E)", (who) => executeCreateSettingsCatalogItem(
      who, {workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
        group: "expense_type", name: "Proibido"} as CatalogPayload,
      "req-p4g-rbac")],
  ];

  const before = await snapshotCounts(t.workspaceId);
  for (const [name, run] of [...memberOps, ...adminOps]) {
    assert.equal(await errorCode(run(actor(t, t.viewer, "viewer"))),
      "workspace_role_denied", `viewer: ${name}`);
    assert.equal(await errorCode(run(actor(t, t.otherMember, "member"))),
      "workspace_membership_required", `membership removido: ${name}`);
  }
  for (const [name, run] of adminOps) {
    assert.equal(await errorCode(run(actor(t, t.member, "member"))),
      "workspace_role_denied", `member: ${name}`);
  }
  // O ator que mente o papel não ganha nada: o papel vem do membership.
  assert.equal(await errorCode(adminOps[3][1](actor(t, t.member, "owner"))),
    "workspace_role_denied", "papel do payload/ator não é autoridade");
  assert.deepEqual(await snapshotCounts(t.workspaceId), before,
    "nenhuma escrita em nenhum domínio");
});

test("gate P4 — workspace: conta, cartão, posição e item de outro " +
  "workspace são recusados em toda integração crítica, sem escrita",
async () => {
  const a = await seedSplitTenant("PF", "p4g-ws-a");
  const b = await seedSplitTenant("PF", "p4g-ws-b");
  const cardA = await createCard(a);
  await buy(a, cardA, "2026-03-10", {totalCents: 10_000});
  const cardB = await createCard(b);
  const catalogA = await investmentCatalog(a);
  const catalogB = await investmentCatalog(b, " B");
  const positionB = String((await invest(b, catalogB, 10_000)).positionId);
  const foreignAccount = defaultAccountOf(b.workspaceId);
  const owner = actor(a, a.owner, "owner");
  const split = await createGroup(a);
  const payer = memberParticipantId(a, split.groupId, a.owner);

  const beforeA = await snapshotCounts(a.workspaceId);
  const beforeB = await snapshotCounts(b.workspaceId);
  const attempts: Array<[string, () => Promise<unknown>]> = [
    ["aporte em conta de B", () => invest(a, catalogA, 1_000,
      {cashAccountId: foreignAccount})],
    ["aporte com instituição de B", () => invest(a, {...catalogA,
      institutionId: catalogB.institutionId}, 1_000)],
    ["retirada de posição de B", () => withdraw(a, positionB, 1_000)],
    ["fatura paga com conta de B", () => pay(a, cardA, "2026-03",
      "2026-03-26", 10_000, {cashAccountId: foreignAccount})],
    ["compra no cartão de B", () => executeCreateCreditCardPurchase(owner,
      purchasePayload(a.workspaceId, cardB), cardRequest(),
      cardClock("2026-03-10"))],
    ["recorrente na conta de B", () => executeCreateRecurringExpense(owner,
      contractPayload(a, {cashAccountId: foreignAccount}),
      recurringRequest(), recurringClock("2026-03-01"))],
    ["recorrente no cartão de B", () => executeCreateRecurringExpense(owner,
      contractPayload(a, {cashAccountId: null, cardId: cardB,
        paymentMethod: "credit_card"}),
      recurringRequest(), recurringClock("2026-03-01"))],
    ["título pago com conta de B", () => executeCreateSplitBill(owner,
      billPayload(a, split.groupId, payer, [payer], {
        financialIntegration: "cash", cashAccountId: foreignAccount,
      }), splitRequest(), splitClock())],
    ["edição de item do catálogo de B", async () =>
      executeUpdateSettingsCatalogItem(owner, {
        workspaceId: a.workspaceId, idempotencyKey: idempotencyKey(),
        itemId: catalogB.typeId,
        expectedUpdatedAt: await catalogVersion(b.workspaceId,
          catalogB.typeId),
        changes: {name: "Invadido"},
      } as Parameters<typeof executeUpdateSettingsCatalogItem>[1],
      "req-p4g-ws")],
  ];
  for (const [name, run] of attempts) {
    const code = await errorCode(run());
    assert.ok(["not_found", "domain_precondition_failed", "invalid_payload"]
      .includes(code), `${name}: ${code}`);
  }
  assert.deepEqual(await snapshotCounts(a.workspaceId), beforeA,
    "nada gravado em A");
  assert.deepEqual(await snapshotCounts(b.workspaceId), beforeB,
    "nada gravado em B");
});

test("gate P4 — concorrência: fatura, estorno de aporte, reembolso e " +
  "conta arquivada contra aporte — um vence, sem efeito parcial",
async () => {
  const t = await seedSplitTenant("PJ", "p4g-race");
  const accountId = defaultAccountOf(t.workspaceId);

  // Duas quitações integrais da mesma fatura, com a mesma versão lida.
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-10", {totalCents: 25_000});
  const version = await invoiceVersion(t.workspaceId, cardId, "2026-03");
  const payments = await Promise.allSettled([1, 2].map(() =>
    pay(t, cardId, "2026-03", "2026-03-26", 25_000,
      {expectedUpdatedAt: version})));
  assert.equal(payments.filter((r) => r.status === "fulfilled").length, 1,
    "uma quitação só");
  const invoice = await readInvoice(t.workspaceId, cardId, "2026-03");
  assert.equal(invoice.paidCents, 25_000);
  assert.equal((await docsOf(t.workspaceId, "credit_card_invoice_payments"))
    .length, 1);

  // Dois estornos do mesmo aporte, com chaves diferentes.
  const catalog = await investmentCatalog(t);
  const contribution = await invest(t, catalog, 60_000);
  const reversals = await Promise.allSettled([1, 2].map(() =>
    reverseInvestment(t, String(contribution.movementId))));
  assert.equal(reversals.filter((r) => r.status === "fulfilled").length, 1,
    "um estorno só");

  // Dois pagamentos do mesmo reembolso.
  const group = await createGroup(t, {businessMode: "reimbursement",
    name: "Reembolsos"});
  const requester = memberParticipantId(t, group.groupId, t.owner);
  const {reimbursementId} = await createReimbursement(t,
    reimbursementPayload(t, group.groupId, requester, {amountCents: 4_000}));
  await approveReimbursement(t, reimbursementId);
  const reimbursementPayments = await Promise.allSettled([1, 2].map(() =>
    payReimbursement(t, reimbursementId)));
  assert.equal(reimbursementPayments.filter((r) => r.status === "fulfilled")
    .length, 1, "um pagamento só");

  // Conta nova (saldo zero) arquivada contra um aporte nela.
  const spare = await newAccount(t.owner, createAccountPayload(t.workspaceId,
    {name: "Reserva", openingBalanceCents: 0}));
  const archive = executeArchiveCashAccount(actor(t, t.owner, "owner"),
    await statusPayload(t.workspaceId, spare.accountId), "req-p4g-arch");
  const contributionInSpare = invest(t, catalog, 7_000,
    {cashAccountId: spare.accountId});
  const [archived, invested] = await Promise.allSettled([archive,
    contributionInSpare]);
  assert.ok(!(archived.status === "fulfilled" &&
    invested.status === "fulfilled"), "arquivar e aportar não vencem juntos");
  const spareDoc = (await ws(t.workspaceId).collection("cash_accounts")
    .doc(spare.accountId).get()).data();
  const spareMovements = (await docsOf(t.workspaceId,
    "cash_account_movements")).filter((doc) =>
    doc.get("accountId") === spare.accountId);
  if (spareDoc?.status === "archived") {
    assert.equal(spareMovements.length, 0, "conta arquivada sem movimento");
  } else {
    assert.equal(spareMovements.length, 1);
  }

  const {movements} = await assertCashCoherent(t.workspaceId);
  const byDomain = (domain: string) => movements
    .filter((item) => item.sourceDomain === domain)
    .reduce((sum, item) => sum + Number(item.amountCents), 0);
  assert.equal(byDomain("credit_card"), -25_000);
  assert.equal(byDomain("split"), -4_000);
  assert.equal(byDomain("investment"),
    spareMovements.length === 1 ? -7_000 : 0,
    "aporte e estorno se anulam; só o aporte na conta reserva, se venceu");
  assert.equal(Number((await ws(t.workspaceId).collection("cash_accounts")
    .doc(accountId).get()).get("balanceCents")), -25_000 - 4_000);
  assert.equal((await reimbursementRef(t.workspaceId, reimbursementId).get())
    .get("status"), "paid");
});
