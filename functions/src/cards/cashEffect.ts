import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {isMoneyCents} from "../shared/money";

/**
 * Efeito de caixa do pagamento de fatura de cartão (P4-A).
 *
 * O pagamento é **liquidação do cartão**, não despesa operacional: a despesa
 * de consumo é a compra, reconhecida no domínio de cartões pela competência.
 * Contar o pagamento em "Despesas" somaria a mesma compra duas vezes.
 *
 * O espelho em `transactions` carrega a marca backend-only
 * `creditCardPaymentEntry` (as Rules negam a chave ao cliente). É ela, e não
 * `type`/`value`, que decide a classificação na projeção mensal:
 *
 * | fato      | `creditCardPaymentCents` | `netCents` | `expenseCents` |
 * | --------- | ------------------------ | ---------- | -------------- |
 * | pagamento | +valor                   | −valor     | 0              |
 * | estorno   | −valor                   | +valor     | 0              |
 *
 * Fato + estorno somam zero em todos os campos. O dinheiro sai da conta
 * escolhida (D-30) no mesmo commit, pelo livro-razão de contas.
 */
export const CARD_PAYMENT_CASH_ENTRY_VERSION = 1;

/** Categoria exibida no espelho. */
export const CARD_PAYMENT_CASH_CATEGORY = "Fatura de cartão";

export interface CardPaymentCashEntry {
  domainVersion: number;
  cardId: string;
  invoiceId: string;
  /** O fato de pagamento (ou de estorno) que o espelho representa. */
  paymentId: string;
  kind: "invoice_payment";
  reversal: boolean;
  amountCents: number;
  currency: "BRL";
  /** No estorno: o pagamento original. */
  reversalOf?: string;
}

export interface CardPaymentCashEffect {
  creditCardPaymentCents: number;
  netCents: number;
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/** Marca válida ou `null`. Nada de coerção: forma inesperada não conta. */
export const readCardPaymentCashEntry = (
  value: unknown,
): CardPaymentCashEntry | null => {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (
    entry.domainVersion !== CARD_PAYMENT_CASH_ENTRY_VERSION ||
    !isText(entry.cardId) ||
    !isText(entry.invoiceId) ||
    !isText(entry.paymentId) ||
    entry.kind !== "invoice_payment" ||
    typeof entry.reversal !== "boolean" ||
    entry.currency !== "BRL" ||
    !isMoneyCents(entry.amountCents) ||
    (entry.amountCents as number) <= 0
  ) {
    return null;
  }
  if (entry.reversal && !isText(entry.reversalOf)) return null;
  return entry as unknown as CardPaymentCashEntry;
};

export const cardPaymentCashEffect = (
  entry: CardPaymentCashEntry,
): CardPaymentCashEffect => {
  const sign = entry.reversal ? -1 : 1;
  return {
    creditCardPaymentCents: entry.amountCents * sign,
    netCents: -entry.amountCents * sign,
  };
};

/**
 * Espelho de caixa do pagamento ou do estorno. `valueCents` torna o
 * documento não editável pelo cliente nas Rules, e a marca é chave negada ao
 * cliente. Não consome a quota manual `transactionsPerMonth` (D-40).
 */
export const cardPaymentCashMirrorDocument = (input: {
  workspaceId: string;
  profileType: "PF" | "PJ";
  actorUid: string;
  date: string;
  cashAccountId: string;
  entry: CardPaymentCashEntry;
}): admin.firestore.DocumentData => ({
  type: input.entry.reversal ? "receita" : "despesa",
  description: input.entry.reversal ?
    "Estorno: pagamento de fatura de cartão" :
    "Pagamento de fatura de cartão",
  category: CARD_PAYMENT_CASH_CATEGORY,
  valueCents: input.entry.amountCents,
  date: input.date,
  isPaid: true,
  workspaceId: input.workspaceId,
  profileId: input.workspaceId,
  profileType: input.profileType,
  userId: input.actorUid,
  source: "credit_card_payment",
  creditCardPaymentEntry: input.entry,
  cashAccountId: input.cashAccountId,
  createdBy: input.actorUid,
  updatedBy: input.actorUid,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
