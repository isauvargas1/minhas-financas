import {allocateCents, isMoneyCents} from "../shared/money";
import {
  SPLIT_BPS_TOTAL,
  SPLIT_LIMITS,
  SPLIT_MAX_CENTS,
  type SplitAllocationMethod,
} from "./model";

/**
 * Rateio exato em centavos (P4-C, PR-SPLIT-05). Puro: sem Firestore, sem
 * `Date`, sem ponto flutuante.
 *
 * - `equal`: `allocateCents(total, [1, 1, …])` — partes iguais pelo maior
 *   resto;
 * - `percentage`: pesos inteiros em basis points (100% = 10.000), soma
 *   exatamente 10.000, distribuição pelo maior resto;
 * - `fixed`: cada parte em centavos, soma exatamente o total.
 *
 * Invariante, por construção: Σ `amountDueCents` = `amountCents`. Não existe
 * tolerância monetária. A ordem é determinística: participantes ordenados
 * pelo ID; no empate de restos, o de menor posição leva o centavo (D-34).
 */
export interface AllocationParticipant {
  participantId: string;
  /** `percentage`: basis points (1–10.000). */
  weightBps?: number | null;
  /** `fixed`: centavos (> 0). */
  amountCents?: number | null;
}

export interface AllocatedShare {
  participantId: string;
  weightBps: number | null;
  amountDueCents: number;
}

export class SplitAllocationError extends Error {}

const fail = (message: string): never => {
  throw new SplitAllocationError(message);
};

/** Mensagem pt-BR do problema do rateio, ou `null` se ele é válido. */
export const allocationIssue = (input: {
  amountCents: number;
  method: SplitAllocationMethod;
  participants: readonly AllocationParticipant[];
}): string | null => {
  try {
    allocateShares(input);
    return null;
  } catch (error) {
    if (error instanceof SplitAllocationError) return error.message;
    throw error;
  }
};

export const allocateShares = (input: {
  amountCents: number;
  method: SplitAllocationMethod;
  participants: readonly AllocationParticipant[];
}): AllocatedShare[] => {
  const {amountCents, method} = input;
  if (
    !isMoneyCents(amountCents) || amountCents <= 0 ||
    amountCents > SPLIT_MAX_CENTS
  ) {
    fail("Valor: centavos inteiros, maior que zero e dentro do máximo.");
  }
  const count = input.participants.length;
  if (count === 0) fail("Escolha pelo menos um participante.");
  if (count > SPLIT_LIMITS.sharesPerBill) {
    fail(`No máximo ${SPLIT_LIMITS.sharesPerBill} participantes por título.`);
  }
  const ids = input.participants.map((item) => item.participantId);
  if (new Set(ids).size !== ids.length) {
    fail("Cada participante só pode aparecer uma vez no rateio.");
  }
  const ordered = [...input.participants].sort((left, right) =>
    left.participantId < right.participantId ? -1 :
      left.participantId > right.participantId ? 1 : 0);

  if (method === "equal") {
    if (ordered.some((item) => (item.weightBps ?? null) !== null ||
      (item.amountCents ?? null) !== null)) {
      fail("Divisão igual não aceita percentuais nem valores por " +
        "participante.");
    }
    const parts = allocateCents(amountCents, ordered.map(() => 1));
    return ordered.map((item, index) => ({
      participantId: item.participantId,
      weightBps: null,
      amountDueCents: parts[index],
    }));
  }

  if (method === "percentage") {
    const weights = ordered.map((item) => item.weightBps);
    if (weights.some((weight) =>
      typeof weight !== "number" || !Number.isSafeInteger(weight) ||
      weight <= 0 || weight > SPLIT_BPS_TOTAL)) {
      fail("Percentual: informe cada participante com um percentual maior " +
        "que zero, em centésimos de ponto percentual.");
    }
    if (ordered.some((item) => (item.amountCents ?? null) !== null)) {
      fail("Divisão por percentual não aceita valores por participante.");
    }
    const sum = (weights as number[]).reduce((total, weight) => total + weight,
      0);
    if (sum !== SPLIT_BPS_TOTAL) {
      fail("Os percentuais precisam somar exatamente 100%.");
    }
    const parts = allocateCents(amountCents, weights as number[]);
    return ordered.map((item, index) => ({
      participantId: item.participantId,
      weightBps: item.weightBps as number,
      amountDueCents: parts[index],
    }));
  }

  // fixed
  const amounts = ordered.map((item) => item.amountCents);
  if (amounts.some((cents) =>
    !isMoneyCents(cents) || (cents as number) <= 0)) {
    fail("Valor fixo: informe cada participante com centavos maiores que " +
      "zero.");
  }
  if (ordered.some((item) => (item.weightBps ?? null) !== null)) {
    fail("Divisão por valor fixo não aceita percentuais.");
  }
  const sum = (amounts as number[]).reduce((total, cents) => total + cents, 0);
  if (sum !== amountCents) {
    fail("A soma dos valores precisa ser exatamente o valor do título.");
  }
  return ordered.map((item) => ({
    participantId: item.participantId,
    weightBps: null,
    amountDueCents: item.amountCents as number,
  }));
};
