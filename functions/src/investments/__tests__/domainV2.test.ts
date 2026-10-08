import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRIBUTION_ACCOUNT_REQUIRED_MESSAGE,
  PENDING_ACCOUNT_FORBIDDEN_MESSAGE,
  WITHDRAWAL_ACCOUNT_REQUIRED_MESSAGE,
  cancelInvestmentMovementPayloadSchema,
  createSimpleInvestmentPayloadSchema,
  reverseInvestmentMovementPayloadSchema,
  settleInvestmentContributionPayloadSchema,
  settleSimpleWithdrawalPayloadSchema,
  withdrawSimpleInvestmentPayloadSchema,
} from "../contracts";
import {profileTypeFromWorkspace} from "../infrastructure";

const common = {
  workspaceId: "workspace-a",
  idempotencyKey: "investment-domain-unit-0001",
  correlationId: "investment-domain-correlation-0001",
};

const createBase = {
  ...common,
  institutionId: "cat-institution-btg",
  classId: "cat-class-aposentadoria",
  typeId: "cat-type-renda-fixa",
  description: "Tesouro Selic 2029",
  valueCents: 100_000,
  occurredAt: "2026-08-18T12:00:00.000Z",
  cashAccountId: "conta-corrente",
};

const withdrawBase = {
  ...common,
  positionId: "position-a",
  valueCents: 50_000,
  occurredAt: "2026-08-18T12:00:00.000Z",
  cashAccountId: "conta-corrente",
};

const issueMessages = (run: () => unknown): string[] => {
  try {
    run();
  } catch (error) {
    return ((error as {issues?: Array<{message: string}>}).issues ?? [])
      .map((issue) => issue.message);
  }
  throw new Error("O contrato deveria ter recusado o payload.");
};

test(
  "contratos exigem correlação, centavos inteiros e payload estrito",
  () => {
    const parsed = createSimpleInvestmentPayloadSchema.parse(createBase);
    assert.equal(parsed.settled, true);
    for (const valueCents of [123.45, 0, 9_000_000_000_001]) {
      assert.throws(() =>
        createSimpleInvestmentPayloadSchema.parse({...createBase, valueCents}));
    }
    assert.throws(() =>
      createSimpleInvestmentPayloadSchema.parse({
        ...createBase,
        internalRole: "owner",
      }));
    const {correlationId: _ignored, ...withoutCorrelation} = withdrawBase;
    void _ignored;
    assert.throws(() =>
      withdrawSimpleInvestmentPayloadSchema.parse(withoutCorrelation));
    assert.throws(() =>
      withdrawSimpleInvestmentPayloadSchema.parse({
        ...withdrawBase,
        occurredAt: "2026-08-18T12:00:00",
      }));
  },
);

test("fato liquidado exige a conta do Caixa; pendente a recusa (D-30)", () => {
  const {cashAccountId: _create, ...createWithoutAccount} = createBase;
  void _create;
  assert.deepEqual(
    issueMessages(() =>
      createSimpleInvestmentPayloadSchema.parse(createWithoutAccount)),
    [CONTRIBUTION_ACCOUNT_REQUIRED_MESSAGE],
  );
  assert.equal(
    createSimpleInvestmentPayloadSchema.parse({
      ...createWithoutAccount, settled: false,
    }).cashAccountId,
    undefined,
  );
  assert.deepEqual(
    issueMessages(() =>
      createSimpleInvestmentPayloadSchema.parse({...createBase, settled: false})),
    [PENDING_ACCOUNT_FORBIDDEN_MESSAGE],
  );

  const {cashAccountId: _withdraw, ...withdrawWithoutAccount} = withdrawBase;
  void _withdraw;
  assert.deepEqual(
    issueMessages(() =>
      withdrawSimpleInvestmentPayloadSchema.parse(withdrawWithoutAccount)),
    [WITHDRAWAL_ACCOUNT_REQUIRED_MESSAGE],
  );
  assert.deepEqual(
    issueMessages(() =>
      withdrawSimpleInvestmentPayloadSchema.parse({
        ...withdrawBase, received: false,
      })),
    [PENDING_ACCOUNT_FORBIDDEN_MESSAGE],
  );

  for (const schema of [
    settleInvestmentContributionPayloadSchema,
    settleSimpleWithdrawalPayloadSchema,
  ]) {
    const settle = {
      ...common,
      movementId: "movement-a",
      settledAt: "2026-08-18T12:00:00.000Z",
    };
    assert.throws(() => schema.parse(settle), /cashAccountId/);
    assert.equal(
      schema.parse({...settle, cashAccountId: "conta"}).cashAccountId,
      "conta",
    );
  }
});

test("estorno e cancelamento não escolhem conta; walletId saiu dos contratos", () => {
  const reverse = {
    ...common,
    movementId: "movement-a",
    reversedAt: "2026-08-18T12:00:00.000Z",
    reason: "Lançamento desfeito",
  };
  reverseInvestmentMovementPayloadSchema.parse(reverse);
  // O estorno compensa na conta do original: escolher outra é recusado.
  assert.throws(() => reverseInvestmentMovementPayloadSchema.parse({
    ...reverse, cashAccountId: "outra-conta",
  }));
  assert.throws(() => cancelInvestmentMovementPayloadSchema.parse({
    ...common,
    movementId: "movement-a",
    occurredAt: "2026-08-18T12:00:00.000Z",
    reason: "Cancelado",
    cashAccountId: "conta",
  }));
  assert.throws(() => createSimpleInvestmentPayloadSchema.parse({
    ...createBase, walletId: "wallet-a",
  }));
  assert.throws(() => withdrawSimpleInvestmentPayloadSchema.parse({
    ...withdrawBase, walletId: "wallet-a",
  }));
});

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
  cashAccountId: "conta-corrente",
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
