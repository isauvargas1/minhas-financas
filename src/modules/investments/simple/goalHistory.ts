/**
 * Histórico de investimentos de uma meta (Etapa 3, §2.B).
 *
 * O baseline chamava a seção de "Histórico de Aportes" e listava transações:
 * tudo que aparecia ali era, por construção, um aporte. Com retirada,
 * cancelamento, estorno e vínculo retroativo no mesmo lugar, aquele título
 * ficou financeiramente errado e os rótulos técnicos do domínio — `redemption`,
 * `goal_unlink`, `settled` — não podem tomar o lugar dele.
 *
 * Este módulo traduz o movimento do ledger no fato que a pessoa reconhece, e
 * só isso. Puro: sem React e sem SDK, testável pelo runner do Node.
 */

import type { InvestmentMovement } from '../types';
// Extensão explícita: este módulo é carregado direto pelo runner do Node nos
// testes unitários, que não resolve import sem extensão.
import { toDateOrNull } from './rows.ts';

export type GoalHistoryKind =
  | 'contribution_settled'
  | 'contribution_pending'
  | 'withdrawal_settled'
  | 'withdrawal_pending'
  | 'cancelled'
  | 'undone'
  | 'linked'
  | 'unlinked'
  | 'other';

export const GOAL_HISTORY_LABEL: Record<GoalHistoryKind, string> = {
  contribution_settled: 'Aporte depositado',
  contribution_pending: 'Aporte pendente',
  withdrawal_settled: 'Retirada recebida',
  withdrawal_pending: 'Retirada aguardando recebimento',
  cancelled: 'Cancelado',
  undone: 'Desfeito',
  linked: 'Vinculado à meta',
  unlinked: 'Removido da meta',
  other: 'Movimentação',
};

export interface GoalHistoryRow {
  id: string;
  description: string;
  kind: GoalHistoryKind;
  label: string;
  occurredAt: Date | null;
  /**
   * Efeito assinado sobre o progresso da meta, em centavos.
   *
   * Vem de `goalNetContributionDeltaCents`, que é exatamente o número que o
   * backend aplicou. Deduzir o sinal da operação no cliente é o que fazia
   * resgate, estorno e desvínculo entrarem como mais um aporte positivo.
   */
  impactCents: number;
  /** Valor do lançamento, para o pendente que ainda não tem impacto. */
  valueCents: number;
  /** O lançamento já moveu o progresso da meta. */
  effective: boolean;
}

const kindOf = (movement: InvestmentMovement): GoalHistoryKind => {
  if (movement.status === 'cancelled') return 'cancelled';
  if (movement.operation === 'goal_link') return 'linked';
  if (movement.operation === 'goal_unlink') return 'unlinked';
  if (movement.operation === 'reversal') return 'undone';
  if (movement.reversedByMovementId) return 'undone';
  if (movement.operation === 'contribution') {
    return movement.status === 'pending' ? 'contribution_pending' : 'contribution_settled';
  }
  if (movement.operation === 'redemption') {
    return movement.status === 'pending' ? 'withdrawal_pending' : 'withdrawal_settled';
  }
  return 'other';
};

const EFFECTIVE_KINDS = new Set<GoalHistoryKind>([
  'contribution_settled', 'withdrawal_settled', 'linked', 'unlinked',
]);

export const toGoalHistoryRow = (movement: InvestmentMovement): GoalHistoryRow => {
  const kind = kindOf(movement);
  return {
    id: movement.id,
    description: movement.description,
    kind,
    label: GOAL_HISTORY_LABEL[kind],
    occurredAt: toDateOrNull(movement.occurredAt),
    impactCents: Number.isSafeInteger(movement.goalNetContributionDeltaCents)
      ? (movement.goalNetContributionDeltaCents as number)
      : 0,
    valueCents: movement.principalCents + (movement.gainCents ?? 0),
    effective: EFFECTIVE_KINDS.has(kind),
  };
};

export const toGoalHistoryRows = (movements: InvestmentMovement[]): GoalHistoryRow[] =>
  movements.map(toGoalHistoryRow);
