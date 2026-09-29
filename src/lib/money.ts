/**
 * Dinheiro em centavos inteiros no cliente (P1; D-16, D-34).
 *
 * Espelho do contrato de `functions/src/shared/money.ts`: mesma leitura de
 * valores em BRL, mesmas recusas (NaN, Infinity, inteiro inseguro, fração de
 * centavo) e a mesma divisão pelo maior resto. Os dois módulos são exercitados
 * pelos mesmos vetores (`tests/fixtures/money-vectors.json`). A formatação em
 * pt-BR existe só aqui: o backend nunca formata dinheiro para exibição.
 *
 * A adoção pelas telas financeiras acontece com os domínios (P3–P5).
 */
export type MoneyCents = number;

export const MONEY_CURRENCY = 'BRL' as const;

export class MoneyError extends Error {
  constructor(field: string) {
    super(`Valor monetário inválido em ${field}.`);
    this.name = 'MoneyError';
  }
}

const ZERO = BigInt(0);
const ONE = BigInt(1);
const HUNDRED = BigInt(100);

export const isMoneyCents = (value: unknown): value is MoneyCents =>
  typeof value === 'number' && Number.isSafeInteger(value);

export const assertMoneyCents = (value: unknown, field = 'valor'): MoneyCents => {
  if (!isMoneyCents(value)) throw new MoneyError(field);
  return value === 0 ? 0 : value;
};

const assertResult = (value: number, field: string): MoneyCents => {
  if (!Number.isSafeInteger(value)) throw new MoneyError(field);
  return value === 0 ? 0 : value;
};

export const addCents = (left: MoneyCents, right: MoneyCents): MoneyCents =>
  assertResult(assertMoneyCents(left, 'parcela') + assertMoneyCents(right, 'parcela'), 'soma');

export const subtractCents = (left: MoneyCents, right: MoneyCents): MoneyCents =>
  assertResult(
    assertMoneyCents(left, 'minuendo') - assertMoneyCents(right, 'subtraendo'),
    'subtração',
  );

export const sumCents = (values: readonly MoneyCents[]): MoneyCents =>
  values.reduce<MoneyCents>((total, value) => addCents(total, value), 0);

export const compareCents = (left: MoneyCents, right: MoneyCents): -1 | 0 | 1 => {
  const a = assertMoneyCents(left, 'comparação');
  const b = assertMoneyCents(right, 'comparação');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

const BRL_PATTERN = /^([+-])?(?:R\$)?([+-])?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * Lê um valor digitado em pt-BR: `R$` opcional, sinal opcional, milhar com
 * ponto e até duas casas depois da vírgula. `10.50` é recusado por ambíguo;
 * três casas decimais são fração de centavo e são recusadas, não arredondadas.
 */
export const parseBrlToCents = (input: string, field = 'valor'): MoneyCents => {
  if (typeof input !== 'string') throw new MoneyError(field);
  const compact = input.replace(/[\s ]/g, '');
  const match = BRL_PATTERN.exec(compact);
  if (!match) throw new MoneyError(field);
  const [, signBefore, signAfter, integerPart, decimalPart = ''] = match;
  if (signBefore && signAfter) throw new MoneyError(field);
  const negative = (signBefore ?? signAfter) === '-';
  const cents =
    BigInt(integerPart.replace(/\./g, '')) * HUNDRED + BigInt(decimalPart.padEnd(2, '0'));
  const signed = negative ? -cents : cents;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(field);
  }
  return assertResult(Number(signed), field);
};

/**
 * Divisão pelo maior resto: as partes somam exatamente `totalCents`; empates
 * vão para o menor índice; total negativo é o espelho exato do positivo.
 */
export const allocateCents = (totalCents: MoneyCents, weights: readonly number[]): MoneyCents[] => {
  const total = assertMoneyCents(totalCents, 'total');
  if (weights.length === 0) throw new MoneyError('pesos');
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) throw new MoneyError('pesos');
  }
  const weightSum = weights.reduce((sum, weight) => sum + BigInt(weight), ZERO);
  if (weightSum === ZERO) throw new MoneyError('pesos');

  const magnitude = BigInt(Math.abs(total));
  const shares = weights.map((weight, index) => {
    const numerator = magnitude * BigInt(weight);
    return { index, quotient: numerator / weightSum, remainder: numerator % weightSum };
  });
  let leftover = magnitude - shares.reduce((sum, share) => sum + share.quotient, ZERO);
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

export const splitCentsEvenly = (totalCents: MoneyCents, count: number): MoneyCents[] => {
  if (!Number.isSafeInteger(count) || count <= 0) throw new MoneyError('quantidade de partes');
  return allocateCents(totalCents, Array.from({ length: count }, () => 1));
};

const integerFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/**
 * Formatação para exibição (`R$ 1.234,56`, `-R$ 0,01`), idêntica à de
 * `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`, mas
 * exata em todo o intervalo seguro: reais e centavos são separados em inteiros,
 * sem dividir por 100 em ponto flutuante. Só no cliente.
 */
export const formatCentsBRL = (cents: MoneyCents): string => {
  const value = assertMoneyCents(cents, 'valor');
  const magnitude = Math.abs(value);
  const centsPart = magnitude % 100;
  const reais = (magnitude - centsPart) / 100;
  const sign = value < 0 ? '-' : '';
  return `${sign}R$\u00a0${integerFormatter.format(reais)},${String(centsPart).padStart(2, '0')}`;
};
