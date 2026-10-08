import {isMoneyCents} from "../shared/money";

/**
 * Efeito de caixa dos fatos da Divisão de contas (P4-C).
 *
 * O espelho em `transactions` carrega a marca backend-only `splitEntry` (as
 * Rules negam a chave ao cliente). É ela, e não `type`/`value`, que decide a
 * classificação na projeção mensal e na reconstrução:
 *
 * | fato (`kind`)                  | projeção            | caixa |
 * | ------------------------------ | ------------------- | ----- |
 * | título pelo Caixa (`bill_expense`) | despesa operacional | sai |
 * | reembolso PJ pago (`reimbursement_payment`) | despesa operacional | sai |
 *
 * A compensação (`reversal: true`) aplica o mesmo efeito com sinal oposto:
 * fato + compensação somam zero em todos os campos. A quitação entre
 * participantes não tem espelho: é fato do domínio Split, não do Caixa.
 */
export const SPLIT_CASH_ENTRY_VERSION = 1;

export type SplitCashEntryKind = "bill_expense" | "reimbursement_payment";

export interface SplitCashEntry {
  domainVersion: number;
  kind: SplitCashEntryKind;
  groupId: string;
  billId: string | null;
  reimbursementId: string | null;
  reversal: boolean;
  /** Na compensação: o lançamento original. */
  reversalOf: string | null;
  amountCents: number;
  currency: "BRL";
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/** Marca válida ou `null`. Nada de coerção: forma inesperada não conta. */
export const readSplitCashEntry = (value: unknown): SplitCashEntry | null => {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  const bill = entry.kind === "bill_expense";
  if (
    entry.domainVersion !== SPLIT_CASH_ENTRY_VERSION ||
    (entry.kind !== "bill_expense" &&
      entry.kind !== "reimbursement_payment") ||
    !isText(entry.groupId) ||
    // Título ⇔ `billId`; reembolso ⇔ `reimbursementId`.
    (bill ?
      !isText(entry.billId) || entry.reimbursementId !== null :
      !isText(entry.reimbursementId) || entry.billId !== null) ||
    typeof entry.reversal !== "boolean" ||
    (entry.reversal ? !isText(entry.reversalOf) : entry.reversalOf !== null) ||
    !isMoneyCents(entry.amountCents) || (entry.amountCents as number) <= 0 ||
    entry.currency !== "BRL"
  ) {
    return null;
  }
  return entry as unknown as SplitCashEntry;
};

export interface SplitCashEffect {
  expenseCents: number;
  netCents: number;
}

// `|| 0` normaliza `-0`.
const signed = (value: number, sign: number): number => value * sign || 0;

export const splitCashEffect = (entry: SplitCashEntry): SplitCashEffect => {
  const sign = entry.reversal ? -1 : 1;
  return {
    expenseCents: signed(entry.amountCents, sign),
    netCents: signed(entry.amountCents, -sign),
  };
};
