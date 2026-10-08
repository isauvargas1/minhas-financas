import type * as admin from "firebase-admin";

import {isDayKey} from "../shared/dateKeys";
import {CASH_ENTRY_MAX_CENTS} from "./contracts";

/**
 * Quem pode ser corrigido, confirmado ou anulado pelas callables de caixa
 * (P3-C, D-35; P3-F, D-29).
 *
 * Elegível é só o **lançamento do Caixa** (`cashEntry`) pendente ou
 * confirmado, com origem conhecida — `manual` (criação e importação,
 * P3-A/P3-D) ou `recurring` (P4-B) —, `valueCents` e o estado coerente com
 * `isPaid`.
 *
 * Todo o resto é recusado com um código nomeado, sem tocar no documento.
 * Desde a P4-D o cliente não grava `transactions` (Rules), e todo documento
 * da coleção é escrito pelo backend com a marca do seu domínio: documento
 * sem `cashEntry` não é lançamento do Caixa e não é convertido em um — a
 * adoção do caminho legado do cliente (`legacy_manual`, P3-C) saiu junto
 * com ele.
 *
 * Conta/carteira (D-30, P3-J): o lançamento precisa ter a conta
 * (`cashAccountId`) e, quando confirmado, o movimento de conta em vigor
 * (`cashEntry.accountMovementId`); pendente não tem movimento. Fora disso é
 * `ambiguous_account` — não há saldo a compensar com segurança.
 */

export type CashIneligibilityCode =
  | "workspace_mismatch"
  | "voided"
  | "unsupported_type"
  | "linked_to_other_domain"
  | "unsupported_origin"
  | "invalid_author"
  | "ambiguous_payment_state"
  | "ambiguous_value"
  | "ambiguous_date"
  | "ambiguous_account";

export type CashEntryStatus = "pending" | "confirmed";

export type CashEntryEligibility =
  | {
    eligible: true;
    type: "receita" | "despesa";
    status: CashEntryStatus;
    amountCents: number;
    /** Data de referência: efetiva no confirmado, vencimento no pendente. */
    date: string;
    /** Vencimento: do pendente, ou preservado depois da confirmação. */
    dueDate: string | null;
    /** Revisão atual: 1 na criação pela callable. */
    revision: number;
    /** Conta do lançamento (D-30). */
    cashAccountId: string;
    /** Movimento de conta em vigor: só no confirmado com conta. */
    accountMovementId: string | null;
  }
  | {eligible: false; code: CashIneligibilityCode};

/**
 * Vínculos com outros domínios: cartões, faturas, empréstimos, metas,
 * investimentos, recebíveis e divisão. Com qualquer um deles preenchido o
 * lançamento pertence ao fluxo daquele domínio. P4-B: sem `recurringId` — a
 * geração recorrente anterior saiu; o lançamento gerado por Recorrentes é um
 * lançamento do Caixa (`cashEntry.origin = recurring`, vínculo
 * backend-only `recurringEntry`).
 */
export const PROTECTED_LINK_KEYS = [
  // Nenhum fluxo grava mais `cardId` em `transactions` (P4-C, PR-TX-06): a
  // compra de cartão — manual, recorrente ou da Divisão de contas — vive em
  // `credit_card_purchases`. A chave segue protegendo o documento.
  "cardId",
  // P4-A: espelho autoritativo de pagamento de fatura (marca backend-only).
  "creditCardPaymentEntry",
  "loanId",
  "loanMovementId",
  // P3-G: espelho autoritativo de empréstimo (marca backend-only).
  "loanEntry",
  // P4-D (D-15): espelho de caixa de investimento (marca backend-only).
  "investmentEntry",
  "receivableId",
  "clientId",
  // P3-I: espelho autoritativo de recebimento (marca backend-only).
  "receivableEntry",
  // P4-C: espelho autoritativo da Divisão de contas (marca backend-only):
  // título pago pelo Caixa e pagamento de reembolso, só pelo domínio Split.
  "splitEntry",
] as const;

/**
 * Origens que as callables de caixa reconhecem em `cashEntry`. `recurring`
 * (P4-B): lançamento gerado por uma ocorrência de despesa recorrente — um
 * lançamento do Caixa como outro qualquer depois de gerado (pagar o pendente
 * é a confirmação P3-F; corrigir e anular seguem D-35). O vínculo
 * `recurringEntry` só existe nessa origem.
 */
const CASH_ENTRY_ORIGINS = new Set(["manual", "recurring"]);

const isRecurringEntryLink = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const link = value as Record<string, unknown>;
  return link.domainVersion === 1 &&
    typeof link.recurringExpenseId === "string" &&
    link.recurringExpenseId.length > 0 &&
    typeof link.occurrenceId === "string" &&
    link.occurrenceId.length > 0;
};

const isFilled = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== "";

const isAccountRef = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

const isSupportedType = (value: unknown): value is "receita" | "despesa" =>
  value === "receita" || value === "despesa";

const isSafeAmount = (cents: unknown): cents is number =>
  typeof cents === "number" &&
  Number.isSafeInteger(cents) &&
  cents > 0 &&
  cents <= CASH_ENTRY_MAX_CENTS;

const cashEntryEligibility = (
  data: admin.firestore.DocumentData,
  type: "receita" | "despesa",
): CashEntryEligibility => {
  const entry = data.cashEntry as Record<string, unknown>;
  if (typeof entry !== "object" || entry === null) {
    return {eligible: false, code: "unsupported_origin"};
  }
  if (entry.status === "voided") return {eligible: false, code: "voided"};
  if (
    !CASH_ENTRY_ORIGINS.has(String(entry.origin)) ||
    (entry.status !== "confirmed" && entry.status !== "pending") ||
    entry.currency !== "BRL"
  ) {
    return {eligible: false, code: "unsupported_origin"};
  }
  // Origem recorrente ⇔ vínculo válido com a ocorrência; vínculo em outra
  // origem é escritor desconhecido.
  if (
    entry.origin === "recurring" ?
      !isRecurringEntryLink(data.recurringEntry) :
      data.recurringEntry !== undefined
  ) {
    return {eligible: false, code: "unsupported_origin"};
  }
  if (typeof data.userId !== "string" || data.userId.length === 0) {
    return {eligible: false, code: "invalid_author"};
  }
  if (!isSafeAmount(data.valueCents)) {
    return {eligible: false, code: "ambiguous_value"};
  }
  if (!isDayKey(data.date)) return {eligible: false, code: "ambiguous_date"};
  // O estado e `isPaid` andam juntos; divergência é escritor desconhecido.
  const pending = entry.status === "pending";
  if (data.isPaid !== !pending) {
    return {eligible: false, code: "ambiguous_payment_state"};
  }
  if (data.dueDate !== undefined && !isDayKey(data.dueDate)) {
    return {eligible: false, code: "ambiguous_date"};
  }
  if (pending && data.dueDate !== data.date) {
    return {eligible: false, code: "ambiguous_date"};
  }
  const revision = Number.isSafeInteger(entry.revision) ?
    entry.revision as number :
    1;
  // D-30: conta obrigatória; movimento em vigor só no confirmado.
  const movementId = entry.accountMovementId;
  if (
    !isAccountRef(data.cashAccountId) ||
    (pending ? movementId !== null && movementId !== undefined :
      !isAccountRef(movementId))
  ) {
    return {eligible: false, code: "ambiguous_account"};
  }
  return {
    eligible: true,
    type,
    status: pending ? "pending" : "confirmed",
    amountCents: data.valueCents,
    date: data.date,
    dueDate: typeof data.dueDate === "string" ? data.dueDate : null,
    revision,
    cashAccountId: data.cashAccountId,
    accountMovementId: pending ? null : movementId as string,
  };
};

export const classifyCashEntryEligibility = (
  data: admin.firestore.DocumentData,
  workspaceId: string,
): CashEntryEligibility => {
  if (
    (data.workspaceId !== undefined && data.workspaceId !== workspaceId) ||
    (data.profileId !== undefined && data.profileId !== workspaceId)
  ) {
    return {eligible: false, code: "workspace_mismatch"};
  }
  if (isFilled(data.voidedAt)) return {eligible: false, code: "voided"};
  if (!isSupportedType(data.type)) {
    return {eligible: false, code: "unsupported_type"};
  }
  if (PROTECTED_LINK_KEYS.some((key) => isFilled(data[key]))) {
    return {eligible: false, code: "linked_to_other_domain"};
  }
  // Sem `cashEntry` não é lançamento do Caixa: nenhum escritor atual grava
  // receita ou despesa sem a marca do seu domínio.
  return cashEntryEligibility(data, data.type);
};
