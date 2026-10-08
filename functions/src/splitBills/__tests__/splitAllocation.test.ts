import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {
  SplitAllocationError,
  allocateShares,
  allocationIssue,
} from "../allocation";
import {SPLIT_MAX_CENTS} from "../model";

/**
 * Rateio exato em centavos (P4-C, PR-SPLIT-05): Σ rateios = valor por
 * construção, sem tolerância, determinístico (participantes ordenados pelo
 * ID; empate de restos → menor posição). Os vetores fixos, calculados à
 * mão, vêm de `tests/fixtures/split-allocation-vectors.json` — o mesmo
 * arquivo de `tests/unit/split-model.test.ts`, que prova a prévia do
 * frontend.
 */
const p = (id: string, extra: Record<string, number> = {}) =>
  ({participantId: id, ...extra});

const due = (shares: ReturnType<typeof allocateShares>) =>
  Object.fromEntries(shares.map((share) =>
    [share.participantId, share.amountDueCents]));

interface SharedVector {
  name: string;
  amountCents: number;
  method: "equal" | "percentage" | "fixed";
  participants: {participantId: string; weightBps?: number;
    amountCents?: number}[];
  expected: Record<string, number>;
}

// lib/splitBills/__tests__ → raiz do repositório.
const SHARED_VECTORS = (JSON.parse(readFileSync(resolve(__dirname,
  "../../../../tests/fixtures/split-allocation-vectors.json"), "utf8")) as
  {vectors: SharedVector[]}).vectors;

test("vetores fixos: mesmo resultado da prévia do frontend", () => {
  assert.ok(SHARED_VECTORS.length >= 10);
  for (const vector of SHARED_VECTORS) {
    assert.deepEqual(due(allocateShares(vector)), vector.expected,
      vector.name);
  }
});

test("igual: Σ exato, ordem pelo ID e o centavo extra para a menor posição",
  () => {
    const shares = allocateShares({amountCents: 10_000, method: "equal",
      participants: [p("spt_c"), p("spt_a"), p("spt_b")]});
    assert.deepEqual(shares.map((share) => share.participantId),
      ["spt_a", "spt_b", "spt_c"]);
    assert.deepEqual(shares.map((share) => share.amountDueCents),
      [3_334, 3_333, 3_333]);
    assert.ok(shares.every((share) => share.weightBps === null));
  });

test("propriedade: Σ rateios = valor para qualquer combinação (sem tolerância)",
  () => {
    let seed = 20_261_007;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (let round = 0; round < 500; round += 1) {
      const count = 1 + (next() % 50);
      const amountCents = 1 + (next() % 5_000_000);
      const ids = Array.from({length: count}, (_, index) => `p${index}`);
      const equal = allocateShares({amountCents, method: "equal",
        participants: ids.map((id) => p(id))});
      assert.equal(equal.reduce((sum, share) => sum + share.amountDueCents, 0),
        amountCents);
      // Partes iguais diferem no máximo 1 centavo entre si.
      const values = equal.map((share) => share.amountDueCents);
      assert.ok(Math.max(...values) - Math.min(...values) <= 1);
      // Percentual: pesos inteiros que somam exatamente 10.000.
      if (count <= 100) {
        const base = Math.floor(10_000 / count);
        const weights = ids.map((_, index) =>
          base + (index < 10_000 - base * count ? 1 : 0));
        if (weights.every((weight) => weight > 0)) {
          const percent = allocateShares({amountCents, method: "percentage",
            participants: ids.map((id, index) =>
              p(id, {weightBps: weights[index]}))});
          assert.equal(percent.reduce((sum, share) =>
            sum + share.amountDueCents, 0), amountCents);
        }
      }
    }
  });

test("a ordem de entrada não muda o resultado (determinismo)", () => {
  const a = allocateShares({amountCents: 1_000, method: "percentage",
    participants: [p("b", {weightBps: 5_000}), p("a", {weightBps: 3_000}),
      p("c", {weightBps: 2_000})]});
  const b = allocateShares({amountCents: 1_000, method: "percentage",
    participants: [p("c", {weightBps: 2_000}), p("a", {weightBps: 3_000}),
      p("b", {weightBps: 5_000})]});
  assert.deepEqual(a, b);
});

test("percentual: soma diferente de 100%, peso zero ou valor junto: recusa",
  () => {
    for (const participants of [
      [p("a", {weightBps: 5_000}), p("b", {weightBps: 4_999})],
      [p("a", {weightBps: 5_000}), p("b", {weightBps: 5_001})],
      [p("a", {weightBps: 10_000}), p("b", {weightBps: 0})],
      [p("a", {weightBps: 10_000, amountCents: 100})],
      [p("a")],
    ]) {
      assert.throws(() => allocateShares({amountCents: 100,
        method: "percentage", participants}), SplitAllocationError);
    }
  });

test("fixo: um centavo a mais ou a menos é recusado; parte zero também", () => {
  for (const amounts of [[500, 499], [500, 501], [1_000, 0]]) {
    assert.throws(() => allocateShares({amountCents: 1_000, method: "fixed",
      participants: amounts.map((cents, index) =>
        p(`p${index}`, {amountCents: cents}))}),
    /exatamente o valor do título|maiores que zero/);
  }
  assert.throws(() => allocateShares({amountCents: 1_000, method: "fixed",
    participants: [p("a", {amountCents: 1_000, weightBps: 10_000})]}),
  SplitAllocationError);
});

test("igual: percentuais ou valores por participante são recusados", () => {
  assert.throws(() => allocateShares({amountCents: 100, method: "equal",
    participants: [p("a", {weightBps: 10_000})]}), SplitAllocationError);
  assert.throws(() => allocateShares({amountCents: 100, method: "equal",
    participants: [p("a", {amountCents: 100})]}), SplitAllocationError);
});

test("limites: vazio, duplicado, mais de 50, zero, fracionário e acima do teto",
  () => {
    const cases: Parameters<typeof allocateShares>[0][] = [
      {amountCents: 100, method: "equal", participants: []},
      {amountCents: 100, method: "equal", participants: [p("a"), p("a")]},
      {amountCents: 100, method: "equal",
        participants: Array.from({length: 51}, (_, index) => p(`p${index}`))},
      {amountCents: 0, method: "equal", participants: [p("a")]},
      {amountCents: 10.5, method: "equal", participants: [p("a")]},
      {amountCents: SPLIT_MAX_CENTS + 1, method: "equal",
        participants: [p("a")]},
    ];
    for (const input of cases) {
      assert.throws(() => allocateShares(input), SplitAllocationError);
      assert.equal(typeof allocationIssue(input), "string");
    }
    assert.equal(allocationIssue({amountCents: 100, method: "equal",
      participants: [p("a")]}), null);
  });
