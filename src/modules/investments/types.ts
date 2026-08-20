import type { Timestamp } from 'firebase/firestore';

export type InvestmentStatus = 'active' | 'archived';
export type InvestmentMovementStatus = 'pending' | 'settled';

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
  unrealizedAppreciationCents: number;
  feesCents: number;
  taxCents: number;
  updatedAt: Timestamp;
}

export interface InvestmentPage<T> {
  items: T[];
  nextCursor: { updatedAt: Timestamp; id: string } | null;
}
