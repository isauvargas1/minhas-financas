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
  /**
   * Classificação por catálogo do workspace (INV-P2-026).
   *
   * O par `id`/`name` é gravado junto: o ID vincula ao item do catálogo e o
   * nome fica fotografado no ativo, para que renomear ou inativar o item não
   * apague o rótulo histórico da faixa de alocação já publicada.
   */
  classId?: string;
  className?: string;
  riskId?: string;
  riskName?: string;
  liquidityId?: string;
  liquidityName?: string;
  indexerId?: string;
  indexerName?: string;
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
  /**
   * Efeito assinado deste movimento sobre o valor investido da meta.
   *
   * É o mesmo número que o backend aplica em `investmentNetContributionCents`
   * (`operationsV2.updateGoalProjection`). Ler o sinal daqui, e não inferi-lo
   * da operação, é o que faz resgate, estorno e desvínculo aparecerem como
   * saída no histórico da meta em vez de como mais um aporte.
   */
  goalNetContributionDeltaCents?: number;
  goalId?: string;
  walletId?: string;
  /**
   * Fotografia de apresentação gravada na escrita (Etapa 1, §10).
   *
   * A listagem simples precisa de instituição, carteira, categoria e nome do
   * investimento por linha. Resolver isso na leitura custaria uma consulta por
   * linha e ainda mostraria o rótulo **atual** num histórico que já mudou de
   * nome. Os identificadores continuam sendo a autoridade; os nomes são o
   * rótulo do instante da escrita.
   */
  institutionId?: string;
  institutionName?: string;
  classId?: string;
  className?: string;
  typeId?: string;
  typeName?: string;
  assetName?: string;
  /**
   * Movimento que **este** estornou. Presente só no próprio estorno.
   *
   * O sentido inverso — quem estornou este lançamento — é
   * `reversedByMovementId`, e é ele que marca a linha como desfeita.
   */
  reversedMovementId?: string;
  settlementAt?: Timestamp;
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
