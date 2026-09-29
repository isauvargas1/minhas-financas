import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MoneyError,
  addCents,
  allocateCents,
  assertMoneyCents,
  compareCents,
  formatCentsBRL,
  isMoneyCents,
  parseBrlToCents,
  splitCentsEvenly,
  subtractCents,
  sumCents,
} from '../../src/lib/money.ts';

// Mesmos vetores de `functions/src/shared/__tests__/money.test.ts`: o cliente
// e o backend precisam ler, recusar e dividir dinheiro exatamente igual.
type Expected<T> = T | 'error';

interface MoneyVectors {
  limits: { maxSafeCents: number; minSafeCents: number };
  parse: Array<{ input: string; expected: Expected<number> }>;
  allocate: Array<{ total: number; weights: number[]; expected: Expected<number[]> }>;
  split: Array<{ total: number; count: number; expected: Expected<number[]> }>;
  arithmetic: Array<{
    op: 'add' | 'subtract';
    left: number;
    right: number;
    expected: Expected<number>;
  }>;
  sum: Array<{ values: number[]; expected: Expected<number> }>;
}

const vectors = JSON.parse(
  readFileSync(new URL('../fixtures/money-vectors.json', import.meta.url), 'utf8'),
) as MoneyVectors;

const MAX = Number.MAX_SAFE_INTEGER;

const assertRejects = (operation: () => unknown): void => {
  assert.throws(operation, MoneyError);
};

const intlBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

test('fixture tem os limites do inteiro seguro', () => {
  assert.equal(vectors.limits.maxSafeCents, MAX);
  assert.equal(vectors.limits.minSafeCents, -MAX);
});

for (const { input, expected } of vectors.parse) {
  test(`parseBrlToCents(${JSON.stringify(input)}) → ${expected}`, () => {
    if (expected === 'error') {
      assertRejects(() => parseBrlToCents(input));
      return;
    }
    assert.equal(parseBrlToCents(input), expected);
  });
}

for (const { total, weights, expected } of vectors.allocate) {
  test(`allocateCents(${total}, ${JSON.stringify(weights)}) → ${JSON.stringify(expected)}`, () => {
    if (expected === 'error') {
      assertRejects(() => allocateCents(total, weights));
      return;
    }
    const parts = allocateCents(total, weights);
    assert.deepEqual(parts, expected);
    assert.equal(
      parts.reduce((sum, part) => sum + BigInt(part), BigInt(0)),
      BigInt(total),
    );
  });
}

for (const { total, count, expected } of vectors.split) {
  test(`splitCentsEvenly(${total}, ${count}) → ${expected}`, () => {
    if (expected === 'error') {
      assertRejects(() => splitCentsEvenly(total, count));
      return;
    }
    assert.deepEqual(splitCentsEvenly(total, count), expected);
  });
}

for (const { op, left, right, expected } of vectors.arithmetic) {
  test(`${op}Cents(${left}, ${right}) → ${expected}`, () => {
    const run = () => (op === 'add' ? addCents(left, right) : subtractCents(left, right));
    if (expected === 'error') {
      assertRejects(run);
      return;
    }
    assert.equal(run(), expected);
  });
}

for (const { values, expected } of vectors.sum) {
  test(`sumCents(${JSON.stringify(values)}) → ${expected}`, () => {
    if (expected === 'error') {
      assertRejects(() => sumCents(values));
      return;
    }
    assert.equal(sumCents(values), expected);
  });
}

test('assertMoneyCents recusa o que não é inteiro seguro', () => {
  const invalid: unknown[] = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
    0.1 + 0.2,
    2 ** 53,
    -(2 ** 53),
    '1',
    null,
    undefined,
    BigInt(1),
    {},
  ];
  for (const value of invalid) {
    assert.equal(isMoneyCents(value), false, String(value));
    assertRejects(() => assertMoneyCents(value));
  }
  assert.throws(() => assertMoneyCents(1.5, 'total'), {
    message: 'Valor monetário inválido em total.',
  });
});

test('-0 é normalizado para 0', () => {
  assert.ok(Object.is(assertMoneyCents(-0), 0));
  assert.ok(Object.is(subtractCents(-0, 0), 0));
  assert.ok(Object.is(parseBrlToCents('-0,00'), 0));
  for (const part of allocateCents(-1, [1, 1, 1]).slice(1)) assert.ok(Object.is(part, 0));
  assert.equal(compareCents(-0, 0), 0);
});

test('formatCentsBRL coincide com Intl pt-BR/BRL em valores pequenos', () => {
  for (let cents = -20_000; cents <= 20_000; cents += 1) {
    assert.equal(formatCentsBRL(cents), intlBRL.format(cents / 100), String(cents));
  }
  for (const cents of [99_999, 100_000, 123_456, 1_000_000, 123_456_789, -123_456_789]) {
    assert.equal(formatCentsBRL(cents), intlBRL.format(cents / 100), String(cents));
  }
});

test('formatCentsBRL coincide com Intl em valores aleatórios até 10^12 centavos', () => {
  let state = 0x1234abcd;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let round = 0; round < 5000; round += 1) {
    const cents = Math.floor(random() * 1e12) * (random() < 0.5 ? -1 : 1);
    const normalized = cents === 0 ? 0 : cents;
    assert.equal(formatCentsBRL(normalized), intlBRL.format(normalized / 100), String(cents));
  }
});

test('formatCentsBRL é exato perto do limite, com o mesmo separador do Intl', () => {
  const separator = intlBRL.format(0).charAt(2);
  assert.equal(intlBRL.format(0), `R$${separator}0,00`);
  assert.equal(separator, ' ');
  assert.equal(formatCentsBRL(MAX), `R$${separator}90.071.992.547.409,91`);
  assert.equal(formatCentsBRL(-MAX), `-R$${separator}90.071.992.547.409,91`);
  assert.equal(formatCentsBRL(MAX - 1), `R$${separator}90.071.992.547.409,90`);
  assert.equal(formatCentsBRL(-1), `-R$${separator}0,01`);
  assert.equal(formatCentsBRL(-0), `R$${separator}0,00`);
});

test('formatCentsBRL recusa valor que não é centavo inteiro seguro', () => {
  for (const value of [Number.NaN, 1.5, 2 ** 53, Number.POSITIVE_INFINITY]) {
    assertRejects(() => formatCentsBRL(value));
  }
});

test('parse(format(c)) devolve c em todo o intervalo seguro', () => {
  const samples = [0, 1, -1, 99, 100, 101, 123_456, -123_456, MAX, -MAX, MAX - 99, 2 ** 52];
  for (const cents of samples) {
    assert.equal(parseBrlToCents(formatCentsBRL(cents)), cents, String(cents));
  }
});
