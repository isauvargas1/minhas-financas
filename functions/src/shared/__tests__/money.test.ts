import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {ApplicationError} from "../errors";
import {
  addCents,
  allocateCents,
  assertMoneyCents,
  compareCents,
  isMoneyCents,
  parseBrlToCents,
  splitCentsEvenly,
  subtractCents,
  sumCents,
} from "../money";

/**
 * Vetores compartilhados com `tests/unit/money.test.ts` (frontend). O teste
 * compilado roda em `functions/lib/shared/__tests__/` ou em outro diretório
 * de saída; a fixture é procurada subindo a partir do arquivo e do `cwd`.
 */
type Expected<T> = T | "error";

interface MoneyVectors {
  limits: {maxSafeCents: number; minSafeCents: number};
  parse: Array<{input: string; expected: Expected<number>}>;
  allocate: Array<{
    total: number;
    weights: number[];
    expected: Expected<number[]>;
  }>;
  split: Array<{total: number; count: number; expected: Expected<number[]>}>;
  arithmetic: Array<{
    op: "add" | "subtract";
    left: number;
    right: number;
    expected: Expected<number>;
  }>;
  sum: Array<{values: number[]; expected: Expected<number>}>;
}

const FIXTURE = path.join("tests", "fixtures", "money-vectors.json");

const ancestors = (start: string): string[] => {
  const dirs: string[] = [];
  let dir = path.resolve(start);
  while (!dirs.includes(dir)) {
    dirs.push(dir);
    dir = path.dirname(dir);
  }
  return dirs;
};

const findFixture = (): string => {
  const candidates = [
    path.resolve(__dirname, "../../../..", FIXTURE),
    ...ancestors(__dirname).map((dir) => path.join(dir, FIXTURE)),
    ...ancestors(process.cwd()).map((dir) => path.join(dir, FIXTURE)),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Fixture não encontrada: ${FIXTURE}`);
  return found;
};

const vectors = JSON.parse(
  fs.readFileSync(findFixture(), "utf8"),
) as MoneyVectors;

const MAX = Number.MAX_SAFE_INTEGER;

const isInvalidMoney = (error: unknown): boolean =>
  error instanceof ApplicationError && error.code === "invalid_payload";

const assertRejects = (operation: () => unknown): void => {
  assert.throws(operation, isInvalidMoney);
};

test("fixture tem os limites do inteiro seguro", () => {
  assert.equal(vectors.limits.maxSafeCents, MAX);
  assert.equal(vectors.limits.minSafeCents, -MAX);
  assert.ok(vectors.parse.length > 0);
  assert.ok(vectors.allocate.length > 0);
});

for (const {input, expected} of vectors.parse) {
  test(`parseBrlToCents(${JSON.stringify(input)}) → ${expected}`, () => {
    if (expected === "error") {
      assertRejects(() => parseBrlToCents(input));
      return;
    }
    // `strict` compara com Object.is: -0 não passa por 0.
    assert.equal(parseBrlToCents(input), expected);
  });
}

for (const {total, weights, expected} of vectors.allocate) {
  const label = `allocateCents(${total}, ${JSON.stringify(weights)})`;
  test(`${label} → ${JSON.stringify(expected)}`, () => {
    if (expected === "error") {
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

for (const {total, count, expected} of vectors.split) {
  test(`splitCentsEvenly(${total}, ${count}) → ${expected}`, () => {
    if (expected === "error") {
      assertRejects(() => splitCentsEvenly(total, count));
      return;
    }
    assert.deepEqual(splitCentsEvenly(total, count), expected);
  });
}

for (const {op, left, right, expected} of vectors.arithmetic) {
  test(`${op}Cents(${left}, ${right}) → ${expected}`, () => {
    const run = () =>
      op === "add" ? addCents(left, right) : subtractCents(left, right);
    if (expected === "error") {
      assertRejects(run);
      return;
    }
    assert.equal(run(), expected);
  });
}

for (const {values, expected} of vectors.sum) {
  test(`sumCents(${JSON.stringify(values)}) → ${expected}`, () => {
    if (expected === "error") {
      assertRejects(() => sumCents(values));
      return;
    }
    assert.equal(sumCents(values), expected);
  });
}

test("assertMoneyCents recusa o que não é inteiro seguro", () => {
  const invalid: unknown[] = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
    0.1 + 0.2,
    2 ** 53,
    -(2 ** 53),
    "1",
    null,
    undefined,
    BigInt(1),
    {},
    [1],
  ];
  for (const value of invalid) {
    assert.equal(isMoneyCents(value), false, String(value));
    assertRejects(() => assertMoneyCents(value));
  }
});

test("assertMoneyCents aceita os extremos do intervalo seguro", () => {
  assert.equal(assertMoneyCents(MAX), MAX);
  assert.equal(assertMoneyCents(-MAX), -MAX);
  assert.equal(assertMoneyCents(0), 0);
  assert.equal(assertMoneyCents(-1), -1);
});

test("erro de valor inválido cita o campo em pt-BR", () => {
  assert.throws(
    () => assertMoneyCents(1.5, "total"),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.message === "Valor monetário inválido em total.",
  );
});

test("-0 é normalizado para 0 em toda saída", () => {
  assert.ok(Object.is(assertMoneyCents(-0), 0));
  assert.ok(Object.is(addCents(-0, -0), 0));
  assert.ok(Object.is(subtractCents(-0, 0), 0));
  assert.ok(Object.is(sumCents([-0]), 0));
  assert.ok(Object.is(parseBrlToCents("-0,00"), 0));
  for (const part of allocateCents(-0, [1, 1])) {
    assert.ok(Object.is(part, 0));
  }
  for (const part of allocateCents(-1, [1, 1, 1]).slice(1)) {
    assert.ok(Object.is(part, 0));
  }
  assert.equal(compareCents(-0, 0), 0);
});

test("compareCents ordena e recusa não inteiros", () => {
  assert.equal(compareCents(1, 2), -1);
  assert.equal(compareCents(2, 1), 1);
  assert.equal(compareCents(5, 5), 0);
  assert.equal(compareCents(-MAX, MAX), -1);
  assertRejects(() => compareCents(Number.NaN, 1));
  assertRejects(() => compareCents(1, 1.5));
});

test("parseBrlToCents recusa entrada que não é string", () => {
  for (const value of [123, null, undefined, {}, ["1"]]) {
    assertRejects(() => parseBrlToCents(value as unknown as string));
  }
});

/** PRNG determinístico (mulberry32) para a propriedade de soma. */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

test("propriedade: partes somam o total e ficam a menos de 1 da cota", () => {
  const random = mulberry32(0x5eed1234);
  const int = (limit: number) => Math.floor(random() * limit);
  const randomMagnitude = (): number => {
    switch (int(4)) {
    case 0:
      return int(1000);
    case 1:
      return int(10_000_000);
    case 2:
      return MAX - int(1000);
    default:
      // Até 53 bits: 21 bits altos e 32 baixos.
      return int(2 ** 21) * 2 ** 32 + int(2 ** 32);
    }
  };
  for (let round = 0; round < 3000; round += 1) {
    const magnitude = Math.min(randomMagnitude(), MAX);
    const total = random() < 0.5 ? -magnitude : magnitude;
    const size = 1 + int(12);
    const weights: number[] = Array.from({length: size}, () =>
      random() < 0.2 ? 0 : int(round % 2 === 0 ? 1000 : 2 ** 40));
    if (!weights.some((weight) => weight > 0)) weights[int(size)] = 1;

    const parts = allocateCents(total, weights);
    const context = `total=${total} pesos=${JSON.stringify(weights)}`;
    assert.equal(parts.length, weights.length, context);
    const weightSum = weights.reduce(
      (sum, weight) => sum + BigInt(weight),
      BigInt(0),
    );
    let partSum = BigInt(0);
    parts.forEach((part, index) => {
      assert.ok(Number.isSafeInteger(part), context);
      assert.ok(part === 0 || Math.sign(part) === Math.sign(total), context);
      partSum += BigInt(part);
      // |parte − total·peso/soma| < 1  ⇔  |parte·soma − total·peso| < soma
      const deviation =
        BigInt(part) * weightSum - BigInt(total) * BigInt(weights[index]);
      const absolute = deviation < BigInt(0) ? -deviation : deviation;
      assert.ok(absolute < weightSum, `${context} índice=${index}`);
    });
    assert.equal(partSum, BigInt(total), context);
    assert.deepEqual(
      allocateCents(-total, weights),
      parts.map((part) => (part === 0 ? 0 : -part)),
      context,
    );
  }
});
