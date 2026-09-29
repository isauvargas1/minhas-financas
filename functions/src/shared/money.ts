import {ApplicationError} from "./errors";

/**
 * Dinheiro em centavos inteiros (P1, §2.7; D-16, D-34).
 *
 * Moeda única: BRL. Todo valor monetário autoritativo é um inteiro seguro de
 * centavos. Ponto flutuante não é aceito como entrada: `0.1 + 0.2` não é
 * `0.3`, e um valor com fração abaixo do centavo não tem representação
 * contábil. Este módulo tem espelho com o mesmo contrato em
 * `src/lib/money.ts`; os dois são exercitados pelos mesmos vetores de teste
 * (`tests/fixtures/money-vectors.json`).
 *
 * A adoção pelos domínios financeiros acontece em P3–P5; P1 entrega o módulo e
 * a política.
 */
export type MoneyCents = number;

export const MONEY_CURRENCY = "BRL" as const;

const ZERO = BigInt(0);
const ONE = BigInt(1);
const HUNDRED = BigInt(100);

const invalidMoney = (field: string): ApplicationError =>
  new ApplicationError(
    "invalid_payload",
    `Valor monetário inválido em ${field}.`,
  );

export const isMoneyCents = (value: unknown): value is MoneyCents =>
  typeof value === "number" && Number.isSafeInteger(value);

export const assertMoneyCents = (
  value: unknown,
  field = "valor",
): MoneyCents => {
  if (!isMoneyCents(value)) throw invalidMoney(field);
  // `-0` é inteiro seguro, mas vira "-R$ 0,00" na formatação e quebra
  // igualdade por `Object.is`. Normaliza para 0.
  return value === 0 ? 0 : value;
};

const assertResult = (value: number, field: string): MoneyCents => {
  if (!Number.isSafeInteger(value)) throw invalidMoney(field);
  return value === 0 ? 0 : value;
};

export const addCents = (left: MoneyCents, right: MoneyCents): MoneyCents =>
  assertResult(
    assertMoneyCents(left, "parcela") + assertMoneyCents(right, "parcela"),
    "soma",
  );

export const subtractCents = (
  left: MoneyCents,
  right: MoneyCents,
): MoneyCents =>
  assertResult(
    assertMoneyCents(left, "minuendo") - assertMoneyCents(right, "subtraendo"),
    "subtração",
  );

export const sumCents = (values: readonly MoneyCents[]): MoneyCents =>
  values.reduce<MoneyCents>((total, value) => addCents(total, value), 0);

export const compareCents = (
  left: MoneyCents,
  right: MoneyCents,
): -1 | 0 | 1 => {
  const a = assertMoneyCents(left, "comparação");
  const b = assertMoneyCents(right, "comparação");
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

/**
 * Formato aceito: pt-BR, com `R$` opcional, sinal opcional, milhar com ponto
 * em grupos de três (ou nenhum separador de milhar) e até duas casas depois
 * da vírgula. `1.234` é mil duzentos e trinta e quatro reais; `10.50` é
 * recusado por ser ambíguo. Três casas decimais são fração de centavo e são
 * recusadas em vez de arredondadas.
 */
const BRL_PATTERN =
  /^([+-])?(?:R\$)?([+-])?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

export const parseBrlToCents = (
  input: string,
  field = "valor",
): MoneyCents => {
  if (typeof input !== "string") throw invalidMoney(field);
  const compact = input.replace(/[\s\u00a0]/g, "");
  const match = BRL_PATTERN.exec(compact);
  if (!match) throw invalidMoney(field);
  const [, signBefore, signAfter, integerPart, decimalPart = ""] = match;
  if (signBefore && signAfter) throw invalidMoney(field);
  const negative = (signBefore ?? signAfter) === "-";
  const reais = integerPart.replace(/\./g, "");
  const cents = BigInt(reais) * HUNDRED + BigInt(decimalPart.padEnd(2, "0"));
  const signed = negative ? -cents : cents;
  if (
    signed > BigInt(Number.MAX_SAFE_INTEGER) ||
    signed < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw invalidMoney(field);
  }
  return assertResult(Number(signed), field);
};

/**
 * Divide `totalCents` proporcionalmente aos pesos pelo método do maior resto.
 *
 * Invariante: a soma das partes é exatamente `totalCents`. Cada parte recebe o
 * piso da sua cota; os centavos que sobram vão, um a um, para as partes com
 * maior resto, e em caso de empate para a de menor índice (D-34). Com total
 * negativo, a divisão é feita sobre o módulo e o sinal é reaplicado, para que
 * `allocate(-x)` seja exatamente o espelho de `allocate(x)`.
 *
 * A aritmética é em `BigInt`: `total × peso` passa de 2^53 com valores
 * perfeitamente plausíveis.
 */
export const allocateCents = (
  totalCents: MoneyCents,
  weights: readonly number[],
): MoneyCents[] => {
  const total = assertMoneyCents(totalCents, "total");
  if (weights.length === 0) throw invalidMoney("pesos");
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw invalidMoney("pesos");
    }
  }
  const weightSum = weights.reduce((sum, weight) => sum + BigInt(weight), ZERO);
  if (weightSum === ZERO) throw invalidMoney("pesos");

  const magnitude = BigInt(Math.abs(total));
  const shares = weights.map((weight, index) => {
    const numerator = magnitude * BigInt(weight);
    return {
      index,
      quotient: numerator / weightSum,
      remainder: numerator % weightSum,
    };
  });
  let leftover = magnitude -
    shares.reduce((sum, share) => sum + share.quotient, ZERO);
  const byRemainder = [...shares].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (const share of byRemainder) {
    if (leftover === ZERO) break;
    share.quotient += ONE;
    leftover -= ONE;
  }
  const sign = total < 0 ? -1 : 1;
  return shares.map((share) => {
    const value = Number(share.quotient) * sign;
    return value === 0 ? 0 : value;
  });
};

/** Divide em `count` partes iguais pelo maior resto. */
export const splitCentsEvenly = (
  totalCents: MoneyCents,
  count: number,
): MoneyCents[] => {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw invalidMoney("quantidade de partes");
  }
  return allocateCents(totalCents, Array.from({length: count}, () => 1));
};
