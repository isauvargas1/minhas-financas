import {isMoneyCents} from "../shared/money";

/**
 * Efeito de caixa dos movimentos de investimento (D-15, P4-D).
 *
 * O patrimônio vive em `investment_movements` e nas projeções dele; o espelho
 * em `transactions/investment_{movementId}` representa **só** o efeito de
 * caixa. Ele carrega a marca backend-only `investmentEntry` (as Rules negam
 * qualquer escrita do cliente em `transactions`). É ela, e não `type`/`value`,
 * que decide a classificação na projeção mensal do Caixa e no frontend:
 *
 * | fato                          | projeção                                   | conta |
 * | ----------------------------- | ------------------------------------------ | ----- |
 * | aporte liquidado              | `investmentOutflowCents` (saída)           | sai   |
 * | retirada recebida             | `investmentInflowCents` (principal) + `financialIncomeCents` (rendimento) | entra |
 * | pendente / cancelado          | zero                                       | —     |
 * | estorno (`reversal`)          | o mesmo efeito do original, com sinal oposto | compensa na mesma conta |
 *
 * Principal retirado não é receita operacional; o rendimento é resultado
 * financeiro realizado. O efeito líquido (`netCents`) de um fato liquidado é
 * igual ao `amountCents` do movimento na conta escolhida (P3-J). Documento
 * `type: "investimento"` sem marca válida está fora do contrato e não tem
 * efeito nenhum — não há leitura de `value`, de metadado antigo nem de tipo.
 */
export const INVESTMENT_CASH_ENTRY_VERSION = 1;

export type InvestmentCashOperation = "contribution" | "redemption";
export type InvestmentCashStatus = "pending" | "settled" | "cancelled";

export interface InvestmentCashEntry {
  domainVersion: number;
  /** Movimento do domínio que este espelho projeta. */
  movementId: string;
  /** Operação financeira (no estorno, a do movimento estornado). */
  operation: InvestmentCashOperation;
  reversal: boolean;
  /** No estorno: o movimento estornado. */
  reversalOf: string | null;
  status: InvestmentCashStatus;
  /** Capital do movimento. */
  principalCents: number;
  /** Rendimento realizado; sempre zero no aporte. */
  gainCents: number;
  /** Valor do fato: `principalCents + gainCents`, sempre positivo. */
  amountCents: number;
  currency: "BRL";
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isNonNegativeCents = (value: unknown): value is number =>
  isMoneyCents(value) && (value as number) >= 0;

/** Marca válida ou `null`. Nada de coerção: forma inesperada não conta. */
export const readInvestmentCashEntry = (
  value: unknown,
): InvestmentCashEntry | null => {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (
    entry.domainVersion !== INVESTMENT_CASH_ENTRY_VERSION ||
    !isText(entry.movementId) ||
    (entry.operation !== "contribution" && entry.operation !== "redemption") ||
    typeof entry.reversal !== "boolean" ||
    (entry.reversal ? !isText(entry.reversalOf) : entry.reversalOf !== null) ||
    (entry.status !== "pending" && entry.status !== "settled" &&
      entry.status !== "cancelled") ||
    // Estorno só existe como fato liquidado.
    (entry.reversal && entry.status !== "settled") ||
    !isNonNegativeCents(entry.principalCents) ||
    !isNonNegativeCents(entry.gainCents) ||
    (entry.operation === "contribution" && entry.gainCents !== 0) ||
    !isMoneyCents(entry.amountCents) || (entry.amountCents as number) <= 0 ||
    entry.amountCents !==
      (entry.principalCents as number) + (entry.gainCents as number) ||
    entry.currency !== "BRL"
  ) {
    return null;
  }
  return entry as unknown as InvestmentCashEntry;
};

export interface InvestmentCashEffect {
  investmentOutflowCents: number;
  investmentInflowCents: number;
  financialIncomeCents: number;
  netCents: number;
}

const ZERO_EFFECT: InvestmentCashEffect = Object.freeze({
  investmentOutflowCents: 0,
  investmentInflowCents: 0,
  financialIncomeCents: 0,
  netCents: 0,
});

// `|| 0` normaliza `-0`.
const signed = (value: number, sign: number): number => value * sign || 0;

/** Efeito do espelho no Caixa; zero para pendente e cancelado. */
export const investmentCashEffect = (
  entry: InvestmentCashEntry,
): InvestmentCashEffect => {
  if (entry.status !== "settled") return ZERO_EFFECT;
  const sign = entry.reversal ? -1 : 1;
  if (entry.operation === "contribution") {
    return {
      ...ZERO_EFFECT,
      investmentOutflowCents: signed(entry.amountCents, sign),
      netCents: signed(entry.amountCents, -sign),
    };
  }
  return {
    ...ZERO_EFFECT,
    investmentInflowCents: signed(entry.principalCents, sign),
    financialIncomeCents: signed(entry.gainCents, sign),
    netCents: signed(entry.amountCents, sign),
  };
};
