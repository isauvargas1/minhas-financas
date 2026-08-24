import assert from "node:assert/strict";
import test from "node:test";

import {contributionMinorUnits} from "../../goals/operations";
import {saveInvestmentRedemptionPayloadSchema} from "../contracts";

const payload = {
  workspaceId: "workspace-a",
  idempotencyKey: "redemption-unit-test-0001",
  correlationId: "corr-redemption-unit-test",
  redemption: {
    sourceMovementId: "contribution-a",
    description: "Resgate parcial",
    principal: 100,
    gain: 10,
    fees: 2,
    tax: 1.5,
    settlementDate: "2026-08-18",
    status: "settled" as const,
  },
};

test("contrato de resgate mantém principal, ganho, taxas e impostos separados", () => {
  assert.deepEqual(saveInvestmentRedemptionPayloadSchema.parse(payload), payload);
  assert.throws(
    () => saveInvestmentRedemptionPayloadSchema.parse({
      ...payload,
      redemption: {...payload.redemption, tax: 10.01},
    }),
    /imposto não pode superar o ganho/i,
  );
  assert.throws(
    () => saveInvestmentRedemptionPayloadSchema.parse({
      ...payload,
      redemption: {...payload.redemption, principal: 0},
    }),
  );
  assert.throws(
    () => saveInvestmentRedemptionPayloadSchema.parse({
      ...payload,
      redemption: {...payload.redemption, settlementDate: "2026-02-30"},
    }),
    /data inválida/i,
  );
});

test("callable legada exige correlationId do cliente", () => {
  const {correlationId: _omitted, ...withoutCorrelation} = payload;
  assert.throws(
    () => saveInvestmentRedemptionPayloadSchema.parse(withoutCorrelation),
    /correlationId/i,
  );
  assert.throws(
    () => saveInvestmentRedemptionPayloadSchema.parse({
      ...payload,
      correlationId: "curto",
    }),
  );
});

test("progresso de meta usa principal e neutraliza estorno sem dupla contagem", () => {
  const base = {
    type: "investimento",
    goalId: "goal-a",
    isPaid: true,
    investmentMetadata: {
      principalCents: 10_000,
      status: "settled",
    },
  };
  assert.equal(contributionMinorUnits({
    ...base,
    investmentMetadata: {...base.investmentMetadata, investmentOperation: "contribution"},
  }), 10_000);
  assert.equal(contributionMinorUnits({
    ...base,
    investmentMetadata: {...base.investmentMetadata, investmentOperation: "redemption"},
  }), -10_000);
  assert.equal(contributionMinorUnits({
    ...base,
    investmentMetadata: {...base.investmentMetadata, investmentOperation: "redemption_reversal"},
  }), 10_000);
  assert.equal(contributionMinorUnits({
    ...base,
    investmentMetadata: {
      ...base.investmentMetadata,
      investmentOperation: "redemption",
      status: "pending",
    },
  }), 0);
});
