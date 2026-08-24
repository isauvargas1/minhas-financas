import assert from "node:assert/strict";
import test from "node:test";

import {movementReportDeltas} from "../reporting";

test(
  "relatório separa aporte, principal, ganho, taxas, imposto e caixa",
  () => {
    assert.deepEqual(movementReportDeltas({
      operation: "contribution",
      principalCents: 100_000,
      gainCents: 0,
      feesCents: 500,
      taxCents: 0,
      cashDeltaCents: -100_500,
      currentValueDeltaCents: 100_000,
    }), {
      contributionCents: 100_000,
      redemptionPrincipalCents: 0,
      realizedGainCents: 0,
      realizedLossCents: 0,
      feesCents: 500,
      taxCents: 0,
      costDeltaCents: 100_000,
      currentValueDeltaCents: 100_000,
      cashDeltaCents: -100_500,
      settledMovementCount: 1,
    });
    const redemption = movementReportDeltas({
      operation: "redemption",
      principalCents: 40_000,
      gainCents: 5_000,
      feesCents: 500,
      taxCents: 1_000,
      cashDeltaCents: 43_500,
      currentValueDeltaCents: -40_000,
    });
    assert.equal(redemption.redemptionPrincipalCents, 40_000);
    assert.equal(redemption.realizedGainCents, 5_000);
    assert.equal(redemption.costDeltaCents, -40_000);
    assert.equal(redemption.cashDeltaCents, 43_500);
  },
);

test(
  "reversão compensa evento original sem transformar principal em renda",
  () => {
    const redemption = movementReportDeltas({
      operation: "redemption",
      principalCents: 40_000,
      gainCents: 5_000,
      feesCents: 500,
      taxCents: 1_000,
      cashDeltaCents: 43_500,
      currentValueDeltaCents: -40_000,
    });
    const reversal = movementReportDeltas({
      operation: "reversal",
      reversalOfOperation: "redemption",
      principalCents: 40_000,
      gainCents: 5_000,
      feesCents: 500,
      taxCents: 1_000,
      cashDeltaCents: -43_500,
      currentValueDeltaCents: 40_000,
    });
    assert.equal(
      redemption.redemptionPrincipalCents + reversal.redemptionPrincipalCents,
      0,
    );
    assert.equal(redemption.realizedGainCents + reversal.realizedGainCents, 0);
    assert.equal(redemption.feesCents + reversal.feesCents, 0);
    assert.equal(redemption.taxCents + reversal.taxCents, 0);
    assert.equal(redemption.cashDeltaCents + reversal.cashDeltaCents, 0);
  },
);

test("estorno compensa a contagem de movimentos, não a duplica", () => {
  // M7 — o contador era `1` fixo e ignorava o sinal, de modo que um aporte
  // seguido do seu estorno deixava `settledMovementCount` em 2 em vez de 0,
  // contradizendo a fórmula do ExecPlan, que aplica `sign` a toda componente.
  const contribution = movementReportDeltas({
    operation: "contribution",
    principalCents: 100_000,
    gainCents: 0,
    feesCents: 500,
    taxCents: 0,
    cashDeltaCents: -100_500,
    currentValueDeltaCents: 100_000,
  });
  const reversal = movementReportDeltas({
    operation: "reversal",
    reversalOfOperation: "contribution",
    principalCents: 100_000,
    gainCents: 0,
    feesCents: 500,
    taxCents: 0,
    cashDeltaCents: 100_500,
    currentValueDeltaCents: -100_000,
  });
  assert.equal(contribution.settledMovementCount, 1);
  assert.equal(reversal.settledMovementCount, -1);
  assert.equal(
    contribution.settledMovementCount + reversal.settledMovementCount,
    0,
    "Aporte e estorno precisam se anular na contagem.",
  );
  // As demais componentes já se anulavam e continuam anulando.
  for (const field of [
    "contributionCents",
    "redemptionPrincipalCents",
    "realizedGainCents",
    "realizedLossCents",
    "feesCents",
    "taxCents",
    "costDeltaCents",
  ] as const) {
    assert.equal(contribution[field] + reversal[field], 0, field);
  }
});

test("estorno de resgate devolve principal ao custo e retira o ganho", () => {
  const redemption = movementReportDeltas({
    operation: "redemption",
    principalCents: 40_000,
    gainCents: 5_000,
    feesCents: 100,
    taxCents: 200,
    cashDeltaCents: 44_700,
    currentValueDeltaCents: -40_000,
  });
  const reversal = movementReportDeltas({
    operation: "reversal",
    reversalOfOperation: "redemption",
    principalCents: 40_000,
    gainCents: 5_000,
    feesCents: 100,
    taxCents: 200,
    cashDeltaCents: -44_700,
    currentValueDeltaCents: 40_000,
  });
  // Principal resgatado nunca é receita: entra como principal, nunca em ganho.
  assert.equal(redemption.redemptionPrincipalCents, 40_000);
  assert.equal(redemption.realizedGainCents, 5_000);
  assert.equal(redemption.contributionCents, 0);
  // Custo sobe de volta ao estornar o resgate.
  assert.equal(redemption.costDeltaCents, -40_000);
  assert.equal(reversal.costDeltaCents, 40_000);
  assert.equal(redemption.settledMovementCount + reversal.settledMovementCount, 0);
});

// INV-P1-009 — a perda realizada percorre a série mensal com sinal próprio.

test("perda realizada entra no período e é anulada pelo estorno", () => {
  const redemption = movementReportDeltas({
    operation: "redemption",
    principalCents: 40_000,
    gainCents: 0,
    lossCents: 6_000,
    feesCents: 0,
    taxCents: 0,
    cashDeltaCents: 34_000,
    currentValueDeltaCents: -40_000,
  });
  assert.equal(redemption.realizedGainCents, 0);
  assert.equal(redemption.realizedLossCents, 6_000);
  // O custo sai integralmente da posição: a perda não reduz o principal.
  assert.equal(redemption.costDeltaCents, -40_000);
  assert.equal(redemption.redemptionPrincipalCents, 40_000);

  const reversal = movementReportDeltas({
    operation: "reversal",
    reversalOfOperation: "redemption",
    principalCents: 40_000,
    gainCents: 0,
    lossCents: 6_000,
    feesCents: 0,
    taxCents: 0,
    cashDeltaCents: -34_000,
    currentValueDeltaCents: 40_000,
  });
  assert.equal(redemption.realizedLossCents + reversal.realizedLossCents, 0);
});

test("aporte nunca produz resultado realizado, nem ganho nem perda", () => {
  const contribution = movementReportDeltas({
    operation: "contribution",
    principalCents: 10_000,
    gainCents: 0,
    lossCents: 0,
    feesCents: 0,
    taxCents: 0,
    cashDeltaCents: -10_000,
    currentValueDeltaCents: 10_000,
  });
  assert.equal(contribution.realizedGainCents, 0);
  assert.equal(contribution.realizedLossCents, 0);
});
