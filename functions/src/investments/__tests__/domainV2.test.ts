import assert from "node:assert/strict";
import test from "node:test";

import {
  createInvestmentContributionPayloadSchema,
  createInvestmentRedemptionPayloadSchema,
  createSimpleInvestmentPayloadSchema,
  settleInvestmentRedemptionPayloadSchema,
  saveInvestmentAccountPayloadSchema,
  saveInvestmentAssetPayloadSchema,
  onboardInvestmentWorkspacePayloadSchema,
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

test("onboarding exige IDs de retry tipados e rejeita campos extras", () => {
  assert.equal(onboardInvestmentWorkspacePayloadSchema.parse({
    workspaceId: "workspace-pf",
    idempotencyKey: "onboarding-pf-version-1",
    correlationId: "correlation-onboarding-pf-version-1",
  }).workspaceId, "workspace-pf");
  assert.throws(() => onboardInvestmentWorkspacePayloadSchema.parse({
    workspaceId: "workspace-pf",
    idempotencyKey: "onboarding-pf-version-1",
    correlationId: "correlation-onboarding-pf-version-1",
    role: "owner",
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
      lossCents: 0,
      feesCents: 100,
      taxCents: 150,
    },
    settledAt: "2026-08-18T12:00:00.000Z",
  });
  assert.deepEqual(parsed.settlement, {
    principalCents: 10_000,
    quantityMicros: 500_000,
    gainCents: 1_000,
    // INV-P1-009 — a perda realizada é campo próprio, com default zero.
    lossCents: 0,
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

// ---------------------------------------------------------------------------
// Identificadores de catálogo
// ---------------------------------------------------------------------------

/**
 * Uma referência de catálogo é um **ID de documento**, e vira `.doc(id)` ao
 * ser resolvida. Com "/" no meio o valor deixa de ser um ID e passa a ser um
 * caminho: ou aponta para uma subcoleção fora do catálogo, ou quebra com erro
 * de infraestrutura por número ímpar de segmentos — nunca com erro de domínio.
 * A regra é a mesma dos demais identificadores do contrato.
 */
const simpleBase = {
  ...common,
  institutionId: "cat-institution-btg",
  classId: "cat-class-aposentadoria",
  typeId: "cat-type-renda-fixa",
  description: "Tesouro Selic 2029",
  valueCents: 100_000,
  occurredAt: "2026-08-18T12:00:00.000Z",
};

test("referência de catálogo aceita ID de documento comum", () => {
  const parsed = createSimpleInvestmentPayloadSchema.parse(simpleBase);
  assert.equal(parsed.institutionId, "cat-institution-btg");
  assert.equal(parsed.classId, "cat-class-aposentadoria");
  assert.equal(parsed.typeId, "cat-type-renda-fixa");
  // O default do contrato continua liquidando o lançamento.
  assert.equal(parsed.settled, true);
});

test("referência de catálogo com \"/\" é recusada no contrato", () => {
  for (const campo of ["institutionId", "classId", "typeId"] as const) {
    assert.throws(
      () =>
        createSimpleInvestmentPayloadSchema.parse({
          ...simpleBase,
          [campo]: "cat-institution-btg/../../outro-workspace",
        }),
      /Identificador inválido/,
      `${campo} deveria recusar caminho`,
    );
    // Uma barra só já basta: o valor deixa de ser um ID de documento.
    assert.throws(
      () =>
        createSimpleInvestmentPayloadSchema.parse({
          ...simpleBase,
          [campo]: "grupo/item",
        }),
      /Identificador inválido/,
    );
  }
});

test("referência de catálogo vazia continua recusada", () => {
  assert.throws(() =>
    createSimpleInvestmentPayloadSchema.parse({
      ...simpleBase,
      institutionId: "   ",
    }),
  );
  assert.throws(() =>
    createSimpleInvestmentPayloadSchema.parse({
      ...simpleBase,
      typeId: "x".repeat(161),
    }),
  );
  // O limite atual permanece: 160 caracteres continuam válidos.
  assert.equal(
    createSimpleInvestmentPayloadSchema.parse({
      ...simpleBase,
      typeId: "x".repeat(160),
    }).typeId,
    "x".repeat(160),
  );
});
