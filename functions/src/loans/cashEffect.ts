import {isMoneyCents} from "../shared/money";

/**
 * Efeito de caixa de um espelho de empréstimo (D-13, P3-G).
 *
 * O espelho em `transactions` carrega a marca backend-only `loanEntry` (as
 * Rules negam a chave ao cliente). É ela, e não `type`/`value`, que decide a
 * classificação na projeção mensal:
 *
 * | fato                  | borrow (tomado)    | lend (concedido)   |
 * | --------------------- | ------------------ | ------------------ |
 * | contratação           | entrada principal  | saída principal    |
 * | liquidação: principal | saída principal    | entrada principal  |
 * | liquidação: juros     | despesa financeira | receita financeira |
 *
 * O principal nunca é receita nem despesa operacional: vai para os campos de
 * fluxo de principal de empréstimo; os juros vão para os campos financeiros.
 * `incomeCents`/`expenseCents` (operacionais) não mudam. Um espelho de
 * estorno (`reversal: true`) aplica o mesmo efeito com sinal oposto, de modo
 * que fato + estorno somam zero em todos os campos.
 */
export const LOAN_CASH_ENTRY_VERSION = 1;

export type LoanType = "borrow" | "lend";
export type LoanCashFactKind = "disbursement" | "payment";

export interface LoanCashEntry {
  domainVersion: number;
  loanId: string;
  loanMovementId: string;
  loanType: LoanType;
  /** Fato espelhado; no estorno, o fato original. */
  kind: LoanCashFactKind;
  reversal: boolean;
  principalCents: number;
  interestCents: number;
  currency: "BRL";
  /** No estorno: o movimento original. */
  reversalOf?: string;
}

export interface LoanCashEffect {
  loanPrincipalInflowCents: number;
  loanPrincipalOutflowCents: number;
  financialIncomeCents: number;
  financialExpenseCents: number;
  netCents: number;
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/** Marca válida ou `null`. Nada de coerção: forma inesperada não conta. */
export const readLoanCashEntry = (value: unknown): LoanCashEntry | null => {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (
    entry.domainVersion !== LOAN_CASH_ENTRY_VERSION ||
    !isText(entry.loanId) ||
    !isText(entry.loanMovementId) ||
    (entry.loanType !== "borrow" && entry.loanType !== "lend") ||
    (entry.kind !== "disbursement" && entry.kind !== "payment") ||
    typeof entry.reversal !== "boolean" ||
    entry.currency !== "BRL" ||
    !isMoneyCents(entry.principalCents) ||
    !isMoneyCents(entry.interestCents) ||
    (entry.principalCents as number) < 0 ||
    (entry.interestCents as number) < 0 ||
    (entry.principalCents as number) + (entry.interestCents as number) <= 0
  ) {
    return null;
  }
  // A contratação é só principal.
  if (entry.kind === "disbursement" && entry.interestCents !== 0) return null;
  if (entry.reversal && !isText(entry.reversalOf)) return null;
  return entry as unknown as LoanCashEntry;
};

// `|| 0` normaliza `-0`.
const signed = (value: number, sign: number): number => value * sign || 0;

export const loanCashEffect = (entry: LoanCashEntry): LoanCashEffect => {
  const sign = entry.reversal ? -1 : 1;
  let principalIn = 0;
  let principalOut = 0;
  let financialIncome = 0;
  let financialExpense = 0;
  if (entry.kind === "disbursement") {
    if (entry.loanType === "borrow") principalIn = entry.principalCents;
    else principalOut = entry.principalCents;
  } else if (entry.loanType === "borrow") {
    principalOut = entry.principalCents;
    financialExpense = entry.interestCents;
  } else {
    principalIn = entry.principalCents;
    financialIncome = entry.interestCents;
  }
  return {
    loanPrincipalInflowCents: signed(principalIn, sign),
    loanPrincipalOutflowCents: signed(principalOut, sign),
    financialIncomeCents: signed(financialIncome, sign),
    financialExpenseCents: signed(financialExpense, sign),
    netCents: signed(
      principalIn - principalOut + financialIncome - financialExpense,
      sign,
    ),
  };
};
