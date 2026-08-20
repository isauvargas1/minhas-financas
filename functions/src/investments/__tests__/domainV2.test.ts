import assert from "node:assert/strict";
import test from "node:test";

import {
  createInvestmentContributionPayloadSchema,
  createInvestmentRedemptionPayloadSchema,
  settleInvestmentRedemptionPayloadSchema,
  saveInvestmentAccountPayloadSchema,
  saveInvestmentAssetPayloadSchema,
} from "../contracts";
import {profileTypeFromWorkspace} from "../infrastructure";
import {currentValueForPosition, positionValueCents} from "../math";

const common = {
  workspaceId: "workspace-a",
  idempotencyKey: "investment-domain-unit-0001",
  correlationId: "investment-domain-correlation-0001",
};

test(
  "contratos M3 exigem correlação, centavos inteiros e payload estrito",
  () => {
    const contribution = createInvestmentContributionPayloadSchema.parse({
      ...common,
      accountId: "account-a",
      assetId: "asset-a",
      description: "Aporte oficial",
      principalCents: 12_345,
      quantityMicros: 1_000_000,
      occurredAt: "2026-08-18T12:00:00.000Z",
    });
    assert.equal(contribution.feesCents, 0);
    assert.equal(contribution.taxCents, 0);
    assert.throws(() =>
      createInvestmentContributionPayloadSchema.parse({
        ...contribution,
        principalCents: 123.45,
      }),
    );
    assert.throws(() =>
      createInvestmentContributionPayloadSchema.parse({
        ...contribution,
        principalCents: 0,
      }),
    );
    assert.throws(() =>
      createInvestmentContributionPayloadSchema.parse({
        ...contribution,
        principalCents: 9_000_000_000_001,
      }),
    );
    assert.throws(() =>
      createInvestmentContributionPayloadSchema.parse({
        ...contribution,
        internalRole: "owner",
      }),
    );
    assert.throws(() =>
      createInvestmentRedemptionPayloadSchema.parse({
        workspaceId: "workspace-a",
        idempotencyKey: "investment-domain-unit-0002",
        accountId: "account-a",
        assetId: "asset-a",
        description: "Sem correlação",
        requestedPrincipalCents: 100,
        requestedQuantityMicros: 1,
        requestedAt: "2026-08-18T12:00:00.000Z",
      }),
    );
    assert.throws(() =>
      createInvestmentRedemptionPayloadSchema.parse({
        ...common,
        accountId: "account-a",
        assetId: "asset-a",
        description: "Fuso ausente",
        requestedPrincipalCents: 100,
        requestedQuantityMicros: 1,
        requestedAt: "2026-08-18T12:00:00",
      }),
    );
  },
);

test("cadastros patrimoniais aceitam somente campos públicos tipados", () => {
  assert.equal(saveInvestmentAccountPayloadSchema.parse({
    ...common,
    name: "Corretora principal",
    institutionName: "Instituição Teste",
  }).name, "Corretora principal");
  assert.equal(saveInvestmentAssetPayloadSchema.parse({
    ...common,
    name: "Tesouro Selic",
    symbol: "SELIC",
    assetType: "fixed_income",
  }).assetType, "fixed_income");
  assert.throws(() => saveInvestmentAccountPayloadSchema.parse({
    ...common,
    name: "Conta",
    institutionName: "Instituição",
    workspaceRole: "owner",
  }));
  assert.throws(() => saveInvestmentAssetPayloadSchema.parse({
    ...common,
    name: "Ativo",
    assetType: "ação",
  }));
});

test("liquidação separa principal, ganho, taxa e imposto", () => {
  const parsed = settleInvestmentRedemptionPayloadSchema.parse({
    ...common,
    movementId: "movement-a",
    settlement: {
      principalCents: 10_000,
      quantityMicros: 500_000,
      gainCents: 1_000,
      feesCents: 100,
      taxCents: 150,
    },
    settledAt: "2026-08-18T12:00:00.000Z",
  });
  assert.deepEqual(parsed.settlement, {
    principalCents: 10_000,
    quantityMicros: 500_000,
    gainCents: 1_000,
    feesCents: 100,
    taxCents: 150,
  });
  assert.throws(
    () =>
      settleInvestmentRedemptionPayloadSchema.parse({
        ...parsed,
        settlement: {...parsed.settlement, taxCents: 1_001},
      }),
    /imposto não pode superar/i,
  );
});

test(
  "valuation usa micros com arredondamento half-up sem float monetário",
  () => {
    assert.equal(positionValueCents(1_000_000, 100_000_000), 10_000);
    assert.equal(positionValueCents(500_000, 123_450_000), 6_173);
    assert.equal(currentValueForPosition(500_000, 5_000), 5_000);
    assert.equal(currentValueForPosition(500_000, 5_000, 123_450_000), 6_173);
  },
);

test(
  "contexto financeiro do workspace aceita somente PF ou PJ explícito",
  () => {
    assert.equal(profileTypeFromWorkspace({type: "PF"}), "PF");
    assert.equal(profileTypeFromWorkspace({type: "PJ"}), "PJ");
    assert.throws(
      () => profileTypeFromWorkspace({type: "INVALID"}),
      /PF ou PJ/i,
    );
    assert.throws(() => profileTypeFromWorkspace({}), /PF ou PJ/i);
  },
);
