import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";

import {
  receiptMovementIdFor,
  receivableCashTransactionIdFor,
  reversalMovementIdFor,
} from "../model";

/**
 * P5-F.1-R1 (B01) — fixture compartilhada com o cliente
 * (`tests/fixtures/receivable-reversal-ids.json`): os IDs do recebimento, do
 * espelho de caixa dele, do estorno e do espelho do estorno, como o backend os
 * grava. O teste do cliente confere que a derivação do navegador dá os mesmos
 * valores: o estorno de um recebimento é achado pelo identificador oficial, sem
 * consulta nova e sem ler descrição.
 */

interface FixtureCase {
  receivableId: string;
  intentId: string;
  movementId: string;
  mirrorId: string;
  reversalMovementId: string;
  reversalMirrorId: string;
}

// lib/receivables/__tests__ → raiz do repositório.
const FIXTURE = resolve(
  __dirname,
  "../../../../tests/fixtures/receivable-reversal-ids.json",
);
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  cases: FixtureCase[];
};

test("P5-F.1-R1 — IDs do recebimento e do estorno: " +
  "os do backend batem com a fixture", () => {
  assert.ok(fixture.cases.length >= 3, "fixture completa");
  for (const item of fixture.cases) {
    assert.equal(receiptMovementIdFor(item.receivableId, item.intentId),
      item.movementId);
    assert.equal(receivableCashTransactionIdFor(item.movementId),
      item.mirrorId);
    assert.equal(reversalMovementIdFor(item.movementId),
      item.reversalMovementId);
    assert.equal(receivableCashTransactionIdFor(item.reversalMovementId),
      item.reversalMirrorId);
  }
});
