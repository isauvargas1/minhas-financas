import type { Timestamp } from 'firebase/firestore';

export type InvestmentStatus = 'active' | 'archived';
// M3.D deu saída ao estado pendente: um pedido pode ser cancelado sem apagar
// fato financeiro, já que os deltas de um pendente são todos zero.
export type InvestmentMovementStatus = 'pending' | 'settled' | 'cancelled';

export interface InvestmentAccount {
  id: string;
  workspaceId: string;
  name: string;
  institutionName: string;
  currency: 'BRL';
  status: InvestmentStatus;
  updatedAt: Timestamp;
}

export interface InvestmentAsset {
  id: string;
  workspaceId: string;
  name: string;
  symbol?: string;
  assetType: 'fixed_income' | 'fund' | 'stock' | 'etf' | 'crypto' | 'other';
  allocationPurpose?: 'unassigned' | 'retirement' | 'goal' | 'reserve' | 'financial_application' | 'reinvestment' | 'fixed_asset';
  currency: 'BRL';
  status: InvestmentStatus;
  updatedAt: Timestamp;
}

export interface InvestmentPosition {
  id: string;
  workspaceId: string;
  accountId: string;
  assetId: string;
  goalId?: string;
  status: InvestmentStatus;
  quantityMicros: number;
  principalCents: number;
  currentValueCents: number;
  realizedGainCents: number;
  /** Perda realizada acumulada (INV-P1-009). Ausente em documentos anteriores. */
  realizedLossCents?: number;
  unrealizedAppreciationCents: number;
  updatedAt: Timestamp;
}

export interface InvestmentMovement {
  id: string;
  workspaceId: string;
  accountId: string;
  assetId: string;
  positionId: string;
  operation: 'contribution' | 'redemption' | 'reversal' | 'goal_link' | 'goal_unlink';
  status: InvestmentMovementStatus;
  description: string;
  principalCents: number;
  gainCents: number;
  /** Perda realizada da liquidação (INV-P1-009). */
  lossCents?: number;
  feesCents: number;
  taxCents: number;
  quantityMicros: number;
  reversedByMovementId?: string;
  occurredAt: Timestamp;
}

export interface InvestmentSummary {
  id: 'current';
  workspaceId: string;
  positionCount: number;
  principalCents: number;
  currentValueCents: number;
  realizedGainCents: number;
  realizedLossCents?: number;
  unrealizedAppreciationCents: number;
  feesCents: number;
  taxCents: number;
  updatedAt: Timestamp;
}

export type InvestmentAllocationDimension = 'account' | 'class' | 'asset' | 'goal' | 'risk' | 'liquidity' | 'indexer' | 'purpose';

export interface InvestmentReportPeriod {
  id: string;
  workspaceId: string;
  period: string;
  contributionCents: number;
  redemptionPrincipalCents: number;
  realizedGainCents: number;
  realizedLossCents?: number;
  feesCents: number;
  taxCents: number;
  costDeltaCents: number;
  currentValueDeltaCents: number;
  /**
   * Valor patrimonial ao fim do mês, materializado na própria série mensal.
   * O gráfico lê este campo direto: reconstruir subtraindo deltas a partir do
   * patrimônio atual depende da janela carregada e erra o histórico.
   */
  closingCurrentValueCents?: number;
  cashDeltaCents: number;
  settledMovementCount: number;
  daily?: Record<string, {
    contributionCents: number;
    redemptionPrincipalCents: number;
    realizedGainCents: number;
    realizedLossCents?: number;
    feesCents: number;
    taxCents: number;
    costDeltaCents: number;
    currentValueDeltaCents: number;
    cashDeltaCents: number;
    settledMovementCount: number;
  }>;
  periodStart: Timestamp;
}

export interface InvestmentAllocationSummary {
  id: string;
  workspaceId: string;
  dimension: InvestmentAllocationDimension;
  key: string;
  label: string;
  positionCount: number;
  principalCents: number;
  currentValueCents: number;
  realizedGainCents: number;
  realizedLossCents?: number;
  feesCents: number;
  taxCents: number;
}

export interface OfficialInvestmentReportData {
  summary: InvestmentSummary | null;
  periods: InvestmentReportPeriod[];
  allocations: Partial<Record<InvestmentAllocationDimension, InvestmentAllocationSummary[]>>;
  periodsTruncated: boolean;
  truncatedDimensions: InvestmentAllocationDimension[];
}

export interface InvestmentPage<T> {
  items: T[];
  nextCursor: { updatedAt: Timestamp; id: string } | null;
}
