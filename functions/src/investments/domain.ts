import type {Timestamp} from "firebase-admin/firestore";

export const INVESTMENT_DOMAIN_VERSION = 2 as const;
export const INVESTMENT_CALCULATION_VERSION =
  "investment-v2-cents-micros-half-up" as const;

export type InvestmentProfileType = "PF" | "PJ";
export type InvestmentCurrency = "BRL";
export type InvestmentLifecycleStatus = "active" | "archived";
/**
 * `pending` tem todos os deltas em zero e não toca posição, meta ou caixa;
 * por isso `cancelled` é uma saída legítima que não apaga fato financeiro.
 * Estorno NÃO é status: continua sendo movimento compensatório com vínculo
 * bidirecional no original.
 */
export type InvestmentMovementStatus = "pending" | "settled" | "cancelled";
export type InvestmentAllocationPurpose =
  | "unassigned"
  | "retirement"
  | "goal"
  | "reserve"
  | "financial_application"
  | "reinvestment"
  | "fixed_asset";
export type InvestmentMovementOperation =
  | "contribution"
  | "redemption"
  | "reversal"
  | "goal_link"
  | "goal_unlink";

export interface InvestmentAccount {
  id: string;
  workspaceId: string;
  profileType: InvestmentProfileType;
  name: string;
  institutionName: string;
  currency: InvestmentCurrency;
  status: InvestmentLifecycleStatus;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
  archivedBy?: string;
  archivedAt?: Timestamp;
  archiveReason?: string;
}

export interface InvestmentAsset {
  id: string;
  workspaceId: string;
  profileType: InvestmentProfileType;
  name: string;
  symbol?: string;
  assetType: string;
  allocationPurpose: InvestmentAllocationPurpose;
  currency: InvestmentCurrency;
  status: InvestmentLifecycleStatus;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
  archivedBy?: string;
  archivedAt?: Timestamp;
  archiveReason?: string;
}

export interface InvestmentMovement {
  id: string;
  workspaceId: string;
  profileType: InvestmentProfileType;
  domainVersion: typeof INVESTMENT_DOMAIN_VERSION;
  calculationVersion: typeof INVESTMENT_CALCULATION_VERSION;
  accountId: string;
  assetId: string;
  positionId: string;
  operation: InvestmentMovementOperation;
  status: InvestmentMovementStatus;
  currency: InvestmentCurrency;
  description: string;
  principalCents: number;
  gainCents: number;
  feesCents: number;
  taxCents: number;
  quantityMicros: number;
  cashDeltaCents: number;
  principalDeltaCents: number;
  realizedGainDeltaCents: number;
  feesDeltaCents: number;
  taxDeltaCents: number;
  quantityDeltaMicros: number;
  goalNetContributionDeltaCents: number;
  goalCurrentValueDeltaCents: number;
  /**
   * Efeito deste movimento sobre o valor patrimonial da posição. Sem ele a
   * reconstrução da série mensal teria de inferir o patrimônio pelo delta da
   * meta, que é zero quando a posição não está vinculada.
   */
  currentValueDeltaCents?: number;
  goalId?: string;
  walletId?: string;
  transactionId?: string;
  reversedMovementId?: string;
  reversalOfOperation?: InvestmentMovementOperation;
  reversedByMovementId?: string;
  reversalReason?: string;
  reversedAt?: Timestamp;
  reversedBy?: string;
  reversalCorrelationId?: string;
  cancelledAt?: Timestamp;
  cancelledBy?: string;
  cancellationReason?: string;
  cancellationCorrelationId?: string;
  correlationId: string;
  idempotencyKeyHash: string;
  occurredAt: Timestamp;
  expectedSettlementAt?: Timestamp;
  settlementAt?: Timestamp;
  settlementCorrelationId?: string;
  importBatchId?: string;
  /** Transação legada que originou este movimento na migração. */
  migratedFromTransactionId?: string;
  migrationId?: string;
  createdBy: string;
  createdAt: Timestamp;
  settledBy?: string;
  settledAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface InvestmentPosition {
  id: string;
  workspaceId: string;
  profileType: InvestmentProfileType;
  accountId: string;
  assetId: string;
  currency: InvestmentCurrency;
  status: InvestmentLifecycleStatus;
  goalId?: string;
  quantityMicros: number;
  principalCents: number;
  realizedGainCents: number;
  feesCents: number;
  taxCents: number;
  currentValueCents: number;
  unrealizedAppreciationCents: number;
  valuationId?: string;
  valuationUnitPriceMicros?: number;
  valuationEffectiveAt?: Timestamp;
  calculationVersion: typeof INVESTMENT_CALCULATION_VERSION;
  version: number;
  lastMovementId?: string;
  lastMovementAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  updatedBy: string;
}

export interface InvestmentValuation {
  id: string;
  workspaceId: string;
  profileType: InvestmentProfileType;
  assetId: string;
  currency: InvestmentCurrency;
  unitPriceMicros: number;
  source: "manual" | "provider" | "import";
  effectiveAt: Timestamp;
  correlationId: string;
  createdBy: string;
  createdAt: Timestamp;
}

export interface InvestmentSnapshotCursor {
  orderedAt: Timestamp;
  documentId: string;
}

export interface InvestmentSnapshot {
  id: string;
  workspaceId: string;
  profileType: InvestmentProfileType;
  kind: "position_rebuild" | "goal_rebuild";
  targetId: string;
  status: "running" | "completed";
  cutoffAt: Timestamp;
  cursor?: InvestmentSnapshotCursor;
  processedCount: number;
  expectedProjectionVersion: number;
  totals: {
    quantityMicros: number;
    principalCents: number;
    realizedGainCents: number;
    feesCents: number;
    taxCents: number;
    netContributionCents: number;
    currentValueCents: number;
  };
  linkedGoalId?: string;
  pageSize: number;
  calculationVersion: typeof INVESTMENT_CALCULATION_VERSION;
  correlationId: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
}

export interface InvestmentEventLog {
  id: string;
  workspaceId: string;
  profileType: InvestmentProfileType;
  actorId: string;
  actorRole: string;
  operation: string;
  entityType:
    | "account"
    | "asset"
    | "movement"
    | "position"
    | "goal"
    | "snapshot";
  entityId: string;
  correlationId: string;
  idempotencyKeyId: string;
  outcome: "completed" | "failed";
  details: Record<string, unknown>;
  occurredAt: Timestamp;
}

export interface InvestmentIdempotencyKey {
  id: string;
  workspaceId: string;
  actorId: string;
  operation: string;
  correlationId: string;
  idempotencyKeyHash: string;
  requestHash: string;
  status: "completed";
  result: Record<string, unknown>;
  createdAt: Timestamp;
  completedAt: Timestamp;
}

export interface InvestmentImportBatch {
  id: string;
  workspaceId: string;
  profileType: InvestmentProfileType;
  status: "pending" | "running" | "completed" | "failed";
  source: string;
  cursor?: string;
  processedCount: number;
  failedCount: number;
  correlationId: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
}
