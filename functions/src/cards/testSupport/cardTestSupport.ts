import assert from "node:assert/strict";
import type * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {
  seedLoanTenant,
  type LoanTenant,
} from "../../loans/testSupport/loanTestSupport";
import {formatIsoInstant} from "../../shared/commitTime";
import {defaultAccountOf} from "../../shared/testSupport/kernelTestSupport";
import type {WorkspaceActor, WorkspaceRole} from "../../shared/workspaceAuth";
import {db, idempotencyKey} from "../../workspaces/testSupport/p1TestSupport";
import {executeCreateCreditCard} from "../cardOperations";
import type {CardOperationOptions} from "../common";
import type {
  CreateCreditCardPayload,
  CreateCreditCardPurchasePayload,
} from "../contracts";
import {executeRegisterInvoicePayment} from "../invoiceOperations";
import {
  derivePaymentStatus,
  invoiceIdFor,
} from "../model";
import {executeCreateCreditCardPurchase} from "../purchaseOperations";

/** Apoio das suítes de cartões (P4-A), só no Emulator. */

export {defaultAccountOf, idempotencyKey};
export type CardTenant = LoanTenant;

export const seedCardTenant = (
  type: "PF" | "PJ" = "PF",
  prefix = "card",
): Promise<CardTenant> => seedLoanTenant(type, prefix);

/** Relógio fixo ao meio-dia em São Paulo (15:00Z) do dia informado. */
export const clockAt = (dayKey: string): CardOperationOptions => ({
  now: () => Date.parse(`${dayKey}T15:00:00.000Z`),
});

export const actorOf = (
  tenant: CardTenant,
  uid: string,
  role: WorkspaceRole = "owner",
): WorkspaceActor => ({uid, workspaceId: tenant.workspaceId, role});

let requestCounter = 0;
export const requestId = (): string => `req-card-${++requestCounter}`;

export const VISUAL = {
  bgType: "color" as const,
  bgColor: "#1e293b",
  bgGradientColor: null,
  bgImage: null,
  textColor: "white" as const,
  showName: true,
  showBrand: true,
  showLogo: true,
};

export const cardPayload = (
  workspaceId: string,
  overrides: Partial<CreateCreditCardPayload> = {},
): CreateCreditCardPayload => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  name: "Cartão principal",
  brand: "Visa",
  closingDay: 25,
  dueDay: 5,
  limitTotalCents: 500_000,
  visual: VISUAL,
  ...overrides,
} as CreateCreditCardPayload);

export const purchasePayload = (
  workspaceId: string,
  cardId: string,
  overrides: Partial<CreateCreditCardPurchasePayload> = {},
): CreateCreditCardPurchasePayload => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  cardId,
  description: "Notebook",
  category: "Equipamentos",
  purchaseDate: "2026-03-10",
  totalCents: 100_000,
  installmentsCount: 1,
  ...overrides,
} as CreateCreditCardPurchasePayload);

export const createCard = async (
  tenant: CardTenant,
  overrides: Partial<CreateCreditCardPayload> = {},
): Promise<string> => {
  const result = await executeCreateCreditCard(
    actorOf(tenant, tenant.owner), cardPayload(tenant.workspaceId, overrides),
    requestId());
  return result.cardId;
};

export const buy = async (
  tenant: CardTenant,
  cardId: string,
  today: string,
  overrides: Partial<CreateCreditCardPurchasePayload> = {},
  uid = tenant.owner,
) => executeCreateCreditCardPurchase(
  actorOf(tenant, uid), purchasePayload(tenant.workspaceId, cardId,
    {purchaseDate: today, ...overrides}),
  requestId(), clockAt(today));

const ws = (workspaceId: string) => db().doc(`workspaces/${workspaceId}`);

export const cardRef = (workspaceId: string, cardId: string) =>
  ws(workspaceId).collection("credit_cards").doc(cardId);
export const purchaseRef = (workspaceId: string, purchaseId: string) =>
  ws(workspaceId).collection("credit_card_purchases").doc(purchaseId);
export const invoiceRef = (workspaceId: string, invoiceId: string) =>
  ws(workspaceId).collection("credit_card_invoices").doc(invoiceId);
export const paymentRef = (workspaceId: string, paymentId: string) =>
  ws(workspaceId).collection("credit_card_invoice_payments").doc(paymentId);

export const readDoc = async (ref: admin.firestore.DocumentReference) =>
  (await ref.get()).data() ?? {};

export const readCard = (workspaceId: string, cardId: string) =>
  readDoc(cardRef(workspaceId, cardId));
export const readPurchase = (workspaceId: string, purchaseId: string) =>
  readDoc(purchaseRef(workspaceId, purchaseId));
export const readInvoice = (
  workspaceId: string,
  cardId: string,
  competence: string,
) => readDoc(invoiceRef(workspaceId, invoiceIdFor(cardId, competence)));

const versionOf = async (ref: admin.firestore.DocumentReference) =>
  formatIsoInstant((await ref.get()).get("updatedAt") as Timestamp);

export const cardVersion = (workspaceId: string, cardId: string) =>
  versionOf(cardRef(workspaceId, cardId));
export const purchaseVersion = (workspaceId: string, purchaseId: string) =>
  versionOf(purchaseRef(workspaceId, purchaseId));
export const invoiceVersion = (
  workspaceId: string,
  cardId: string,
  competence: string,
) => versionOf(invoiceRef(workspaceId, invoiceIdFor(cardId, competence)));

const listOf = async (
  workspaceId: string,
  collection: string,
  field?: string,
  value?: string,
) => {
  let query: admin.firestore.Query = ws(workspaceId).collection(collection);
  if (field) query = query.where(field, "==", value);
  return (await query.get()).docs.map((doc) => ({id: doc.id, ...doc.data()}));
};

export const entriesOf = (workspaceId: string, cardId: string) =>
  listOf(workspaceId, "credit_card_invoice_entries", "cardId", cardId);
export const invoicesOf = (workspaceId: string, cardId: string) =>
  listOf(workspaceId, "credit_card_invoices", "cardId", cardId);
export const paymentsOf = (workspaceId: string, cardId: string) =>
  listOf(workspaceId, "credit_card_invoice_payments", "cardId", cardId);
export const ledgerOf = (workspaceId: string, cardId: string) =>
  listOf(workspaceId, "credit_card_limit_ledger", "cardId", cardId);
export const cardEventsOf = (workspaceId: string, cardId?: string) =>
  cardId ?
    listOf(workspaceId, "credit_card_events", "cardId", cardId) :
    listOf(workspaceId, "credit_card_events");
export const transactionsOf = (workspaceId: string) =>
  listOf(workspaceId, "transactions");
export const countOf = async (workspaceId: string, collection: string) =>
  (await ws(workspaceId).collection(collection).count().get()).data().count;

/** Total de lançamentos ativos por competência. */
export const activeEntriesByCompetence = async (
  workspaceId: string,
  cardId: string,
): Promise<Record<string, number>> => {
  const totals: Record<string, number> = {};
  for (const entry of await entriesOf(workspaceId, cardId)) {
    const data = entry as Record<string, unknown>;
    if (data.status !== "active") continue;
    const key = String(data.competenceMonth);
    totals[key] = (totals[key] ?? 0) + Number(data.amountCents);
  }
  return totals;
};

/**
 * Invariantes do domínio sobre o estado persistido do cartão:
 * - limite usado = soma do livro do limite = lançamentos ativos − pagamentos
 *   líquidos; disponível = total − usado;
 * - cada fatura: total = soma dos lançamentos ativos dela, pago = pagamentos
 *   líquidos dela, restante = total − pago, estado do pagamento derivado,
 *   fechada com total ≥ 0 e pago ≤ total, aberta sem pagamento;
 * - nenhum documento grava `overdue`; todo valor é centavo inteiro.
 */
export const assertCardInvariants = async (
  workspaceId: string,
  cardId: string,
): Promise<Record<string, unknown>> => {
  const card = await readCard(workspaceId, cardId);
  const entries = (await entriesOf(workspaceId, cardId)) as
    Array<Record<string, unknown>>;
  const payments = (await paymentsOf(workspaceId, cardId)) as
    Array<Record<string, unknown>>;
  const ledger = (await ledgerOf(workspaceId, cardId)) as
    Array<Record<string, unknown>>;
  const invoices = (await invoicesOf(workspaceId, cardId)) as
    Array<Record<string, unknown>>;
  const cents = (value: unknown, label: string) => {
    assert.ok(Number.isSafeInteger(value), `${label} não é centavo inteiro`);
    return value as number;
  };
  const signedPayment = (payment: Record<string, unknown>) =>
    (payment.kind === "payment" ? 1 : -1) *
      cents(payment.amountCents, `pagamento ${payment.id}`);
  const ledgerSum = ledger.reduce((sum, entry) =>
    sum + cents(entry.amountCents, `livro ${entry.id}`), 0);
  const activeSum = entries.filter((entry) => entry.status === "active")
    .reduce((sum, entry) => sum + cents(entry.amountCents, `lanc ${entry.id}`),
      0);
  const netPaid = payments.reduce((sum, payment) =>
    sum + signedPayment(payment), 0);
  assert.equal(card.limitUsedCents, ledgerSum,
    "limite usado ≠ soma do livro do limite");
  assert.equal(card.limitUsedCents, activeSum - netPaid,
    "limite usado ≠ lançamentos ativos − pagamentos líquidos");
  assert.equal(card.limitAvailableCents,
    cents(card.limitTotalCents, "limite total") -
      (card.limitUsedCents as number),
    "disponível ≠ total − usado");
  for (const invoice of invoices) {
    const id = String(invoice.id);
    const total = entries
      .filter((entry) => entry.invoiceId === id && entry.status === "active")
      .reduce((sum, entry) => sum + (entry.amountCents as number), 0);
    const paid = payments.filter((payment) => payment.invoiceId === id)
      .reduce((sum, payment) => sum + signedPayment(payment), 0);
    assert.equal(invoice.totalCents, total, `total da fatura ${id}`);
    assert.equal(invoice.paidCents, paid, `pago da fatura ${id}`);
    assert.equal(invoice.remainingCents, total - paid, `restante ${id}`);
    assert.equal(invoice.paymentStatus, derivePaymentStatus(total, paid),
      `estado do pagamento ${id}`);
    assert.notEqual(invoice.paymentStatus, "overdue");
    assert.notEqual(invoice.cycleStatus, "overdue");
    assert.equal(invoice.status, undefined, "fatura sem campo `status`");
    if (invoice.cycleStatus === "closed") {
      assert.ok(total >= 0, `fatura fechada ${id} com total negativo`);
      assert.ok(paid <= total, `fatura fechada ${id} paga acima do total`);
    } else {
      assert.equal(paid, 0, `fatura aberta ${id} com pagamento`);
    }
  }
  return card;
};

/** Pagamento pela operação real com relógio injetado. */
export const pay = async (
  tenant: CardTenant,
  cardId: string,
  competence: string,
  today: string,
  amountCents: number,
  overrides: Record<string, unknown> = {},
) => executeRegisterInvoicePayment(actorOf(tenant, tenant.owner), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  cardId,
  invoiceId: invoiceIdFor(cardId, competence),
  cashAccountId: defaultAccountOf(tenant.workspaceId),
  amountCents,
  paymentDate: today,
  expectedUpdatedAt: await invoiceVersion(tenant.workspaceId, cardId,
    competence),
  ...overrides,
} as Parameters<typeof executeRegisterInvoicePayment>[1], requestId(),
clockAt(today));

/** Saldo e soma dos movimentos de uma conta (livro-razão D-30). */
export const accountLedger = async (workspaceId: string, accountId: string) => {
  const account = (await ws(workspaceId).collection("cash_accounts")
    .doc(accountId).get()).data() ?? {};
  const movements = (await ws(workspaceId)
    .collection("cash_account_movements")
    .where("accountId", "==", accountId).get()).docs.map((doc) => doc.data());
  const sum = movements.reduce((total, movement) =>
    total + (movement.amountCents as number), 0);
  assert.equal(account.balanceCents, sum, "saldo ≠ soma dos movimentos");
  return {balanceCents: account.balanceCents as number, movements};
};
