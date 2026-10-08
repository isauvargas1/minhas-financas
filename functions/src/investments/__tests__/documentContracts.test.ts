import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {Timestamp} from "firebase-admin/firestore";

import {ApplicationError} from "../../shared/errors";
import {assertInvestmentDocument} from "../documentContracts";
import {
  INVESTMENT_CALCULATION_VERSION,
  INVESTMENT_DOMAIN_VERSION,
} from "../domain";
import {idempotencyIdentityPayload, stableStringify} from "../infrastructure";
import {INVESTMENT_COLLECTIONS} from "../paths";

const occurredAt = Timestamp.fromDate(new Date("2026-08-23T15:00:00.000Z"));

const movement = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: "mov-1",
  workspaceId: "ws-1",
  profileType: "PF",
  domainVersion: INVESTMENT_DOMAIN_VERSION,
  calculationVersion: INVESTMENT_CALCULATION_VERSION,
  accountId: "acc-1",
  assetId: "ast-1",
  positionId: "pos-1",
  operation: "contribution",
  status: "settled",
  currency: "BRL",
  description: "Aporte",
  principalCents: 10_000,
  gainCents: 0,
  feesCents: 0,
  taxCents: 0,
  quantityMicros: 1_000_000,
  cashDeltaCents: -10_000,
  principalDeltaCents: 10_000,
  realizedGainDeltaCents: 0,
  feesDeltaCents: 0,
  taxDeltaCents: 0,
  quantityDeltaMicros: 1_000_000,
  goalNetContributionDeltaCents: 0,
  goalCurrentValueDeltaCents: 0,
  correlationId: "corr-abcdefgh",
  idempotencyKeyHash: "hash",
  occurredAt,
  settlementAt: occurredAt,
  createdBy: "user-1",
  createdAt: occurredAt,
  settledBy: "user-1",
  settledAt: occurredAt,
  cashAccountId: "conta-1",
  accountMovementId: "acm-1",
  ...overrides,
});

const rejects = (fn: () => unknown, hint: string) => {
  assert.throws(
    fn,
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "domain_precondition_failed",
    hint,
  );
};

test("movimento liquidado válido é aceito", () => {
  const document = movement();
  assert.equal(assertInvestmentDocument("movement", document), document);
});

test("movimento fora do contrato é rejeitado antes da escrita", () => {
  rejects(
    () => assertInvestmentDocument("movement", movement({currency: "USD"})),
    "moeda diferente de BRL",
  );
  rejects(
    () => assertInvestmentDocument("movement", movement({principalCents: 10.5})),
    "centavos fracionados",
  );
  rejects(
    () =>
      assertInvestmentDocument("movement", movement({principalCents: -100})),
    "principal negativo",
  );
  rejects(
    () => assertInvestmentDocument("movement", movement({status: "reversed"})),
    "estorno não é status",
  );
  rejects(
    () =>
      assertInvestmentDocument("movement", movement({campoDesconhecido: 1})),
    "campo fora do contrato",
  );
  rejects(
    () => assertInvestmentDocument("movement", movement({domainVersion: 1})),
    "versão de domínio legada",
  );
});

test("movimento liquidado exige evidência de liquidação", () => {
  const {settledAt: _a, settledBy: _b, ...withoutSettlement} = movement();
  rejects(
    () => assertInvestmentDocument("movement", withoutSettlement),
    "liquidado sem settledAt/settledBy",
  );
});

test("pendente precisa ter todos os deltas em zero", () => {
  const pending = movement({
    status: "pending",
    cashDeltaCents: 0,
    principalDeltaCents: 0,
    quantityDeltaMicros: 0,
    settlementAt: undefined,
    settledAt: undefined,
    settledBy: undefined,
  });
  delete pending.settlementAt;
  delete pending.settledAt;
  delete pending.settledBy;
  delete pending.cashAccountId;
  delete pending.accountMovementId;
  assert.ok(assertInvestmentDocument("movement", pending));

  rejects(
    () =>
      assertInvestmentDocument("movement", {
        ...pending,
        principalDeltaCents: 10_000,
      }),
    "pendente com delta de principal",
  );
  rejects(
    () =>
      assertInvestmentDocument("movement", {...pending, cashDeltaCents: -1}),
    "pendente com delta de caixa",
  );
  rejects(
    () =>
      assertInvestmentDocument("movement", {
        ...pending,
        goalNetContributionDeltaCents: 5,
      }),
    "pendente com delta de meta",
  );
});

test("cancelado mantém deltas zerados e registra autor e instante", () => {
  const base = movement({
    status: "cancelled",
    cashDeltaCents: 0,
    principalDeltaCents: 0,
    quantityDeltaMicros: 0,
    cancelledAt: occurredAt,
    cancelledBy: "user-1",
    cancellationReason: "Solicitação desfeita",
  });
  delete base.settlementAt;
  delete base.settledAt;
  delete base.settledBy;
  delete base.cashAccountId;
  delete base.accountMovementId;
  assert.ok(assertInvestmentDocument("movement", base));

  const {cancelledBy: _c, ...withoutAuthor} = base;
  rejects(
    () => assertInvestmentDocument("movement", withoutAuthor),
    "cancelado sem autor",
  );
  rejects(
    () =>
      assertInvestmentDocument("movement", {...base, principalDeltaCents: -1}),
    "cancelado com delta",
  );
});

test("estorno precisa apontar para o movimento original", () => {
  rejects(
    () =>
      assertInvestmentDocument(
        "movement",
        movement({operation: "reversal", cashDeltaCents: 10_000}),
      ),
    "estorno sem reversedMovementId",
  );
  assert.ok(
    assertInvestmentDocument(
      "movement",
      movement({
        operation: "reversal",
        reversedMovementId: "mov-0",
        reversalOfOperation: "contribution",
        cashDeltaCents: 10_000,
        principalDeltaCents: -10_000,
        quantityDeltaMicros: -1_000_000,
      }),
    ),
  );
});

test("ativo exige finalidade de alocação explícita", () => {
  const asset = {
    id: "ast-1",
    workspaceId: "ws-1",
    profileType: "PJ" as const,
    name: "Reserva",
    assetType: "fixed_income",
    allocationPurpose: "reserve",
    classId: "cls-1",
    className: "Reserva operacional",
    typeId: "cat-1",
    typeName: "CDB",
    trackingMode: "value",
    currency: "BRL",
    status: "active",
    createdBy: "u",
    createdAt: occurredAt,
    updatedBy: "u",
    updatedAt: occurredAt,
  };
  assert.ok(assertInvestmentDocument("asset", asset));

  const {allocationPurpose: _p, ...withoutPurpose} = asset;
  rejects(
    () => assertInvestmentDocument("asset", withoutPurpose),
    "ativo sem finalidade",
  );
  rejects(
    () =>
      assertInvestmentDocument("asset", {
        ...asset,
        allocationPurpose: "inventado",
      }),
    "finalidade fora do enum PF/PJ",
  );
  // Regime único por valor (D-15): ativo quantitativo está fora do contrato.
  rejects(
    () => assertInvestmentDocument("asset", {...asset, trackingMode: "quantity"}),
    "ativo quantitativo",
  );
  const {trackingMode: _t, ...semRegime} = asset;
  rejects(
    () => assertInvestmentDocument("asset", semRegime),
    "ativo sem regime",
  );
  // Sem arquivamento: conta, ativo e posição técnicos são sempre ativos.
  rejects(
    () => assertInvestmentDocument("asset", {...asset, status: "archived"}),
    "ativo arquivado",
  );
});

test("posição rejeita totais negativos e versão inválida", () => {
  const position = {
    id: "pos-1",
    workspaceId: "ws-1",
    profileType: "PF" as const,
    accountId: "acc-1",
    assetId: "ast-1",
    currency: "BRL",
    status: "active",
    quantityMicros: 1_000_000,
    principalCents: 10_000,
    realizedGainCents: 0,
    realizedLossCents: 0,
    feesCents: 0,
    taxCents: 0,
    currentValueCents: 10_000,
    unrealizedAppreciationCents: 0,
    calculationVersion: INVESTMENT_CALCULATION_VERSION,
    version: 3,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    updatedBy: "u",
  };
  assert.ok(assertInvestmentDocument("position", position));
  rejects(
    () =>
      assertInvestmentDocument("position", {...position, principalCents: -1}),
    "principal negativo",
  );
  rejects(
    () => assertInvestmentDocument("position", {...position, version: -1}),
    "versão negativa",
  );
});

test("conta do Caixa acompanha só o fato liquidado com dinheiro (D-30)", () => {
  // Liquidado sem conta: fora do contrato.
  const {cashAccountId: _c, ...semConta} = movement();
  rejects(
    () => assertInvestmentDocument("movement", semConta),
    "liquidado sem cashAccountId",
  );
  const {accountMovementId: _m, ...semMovimento} = movement();
  rejects(
    () => assertInvestmentDocument("movement", semMovimento),
    "liquidado sem accountMovementId",
  );
  // Pendente com conta: fora do contrato.
  const pending = movement({
    status: "pending",
    cashDeltaCents: 0,
    principalDeltaCents: 0,
    quantityDeltaMicros: 0,
  });
  delete pending.settlementAt;
  delete pending.settledAt;
  delete pending.settledBy;
  rejects(
    () => assertInvestmentDocument("movement", pending),
    "pendente com conta",
  );
  // Vínculo de meta não move dinheiro: não carrega conta.
  rejects(
    () => assertInvestmentDocument("movement", movement({
      operation: "goal_link",
      cashDeltaCents: 0,
      principalDeltaCents: 0,
      quantityDeltaMicros: 0,
    })),
    "vínculo de meta com conta",
  );
  // O estorno liquidado carrega a conta (a mesma do original).
  assert.ok(assertInvestmentDocument("movement", movement({
    operation: "reversal",
    reversedMovementId: "mov-0",
    reversalOfOperation: "contribution",
    cashDeltaCents: 10_000,
    principalDeltaCents: -10_000,
    quantityDeltaMicros: -1_000_000,
  })));
  // `walletId` saiu do contrato.
  rejects(
    () => assertInvestmentDocument("movement", movement({walletId: "w-1"})),
    "walletId no movimento",
  );
});

test("correlationId não participa da identidade de idempotência", () => {
  const base = {
    workspaceId: "ws-1",
    idempotencyKey: "chave-de-idempotencia-1",
    principalCents: 1_000,
  };
  const first = stableStringify(
    idempotencyIdentityPayload({...base, correlationId: "corr-primeira"}),
  );
  const retry = stableStringify(
    idempotencyIdentityPayload({...base, correlationId: "corr-segunda"}),
  );
  assert.equal(
    first,
    retry,
    "Retry legítimo com novo correlationId precisa ser replay, não conflito.",
  );

  const other = stableStringify(
    idempotencyIdentityPayload({
      ...base,
      principalCents: 2_000,
      correlationId: "corr-primeira",
    }),
  );
  assert.notEqual(
    first,
    other,
    "Payload diferente com a mesma chave continua sendo conflito.",
  );
});

/**
 * Retenção (INV-P2-041, P4-D): as coleções operacionais que gravam
 * `expiresAt` expiram por política de TTL versionada; fatos, posições,
 * projeções e trilha de sucesso não têm `expiresAt` e não têm TTL. Nenhum
 * índice composto de investimentos fica sem consulta consumidora.
 */
test("coleções operacionais de investimentos têm TTL versionado; fatos não",
  () => {
    const indexes = JSON.parse(readFileSync(
      resolve(__dirname, "../../../../firestore.indexes.json"), "utf8",
    )) as {
      indexes: Array<{collectionGroup: string}>;
      fieldOverrides: Array<Record<string, unknown>>;
    };
    const ttl = indexes.fieldOverrides
      .filter((entry) =>
        String(entry.collectionGroup).startsWith("investment_"))
      .sort((a, b) =>
        String(a.collectionGroup).localeCompare(String(b.collectionGroup)));
    assert.deepEqual(ttl, [
      INVESTMENT_COLLECTIONS.driftReports,
      INVESTMENT_COLLECTIONS.eventLogs,
      INVESTMENT_COLLECTIONS.idempotencyKeys,
      INVESTMENT_COLLECTIONS.operationalMetrics,
    ].map((collectionGroup) => ({
      collectionGroup, fieldPath: "expiresAt", ttl: true, indexes: [],
    })));
    const comIndice = new Set(indexes.indexes
      .map((entry) => entry.collectionGroup)
      .filter((group) => group.startsWith("investment_")));
    assert.deepEqual([...comIndice].sort(), [
      INVESTMENT_COLLECTIONS.allocationSummaries,
      INVESTMENT_COLLECTIONS.movements,
      INVESTMENT_COLLECTIONS.positions,
    ]);
  });
