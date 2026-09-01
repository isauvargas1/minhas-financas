/**
 * Vínculo retroativo entre investimento e meta (Etapa 3, §2.C e §2.D).
 *
 * O baseline tinha o botão "Vincular Existente" ligado a `() => {}`: existia na
 * tela e não fazia nada. Aqui ele passa a operar sobre o domínio autoritativo,
 * e a entidade vinculada é a **posição** — não uma transação, que é só espelho
 * de caixa e não tem capital para mover de meta.
 *
 * Este módulo é puro: nenhuma leitura, nenhum React, nenhum SDK. É o que
 * permite testar a elegibilidade com o runner do Node, que é o único
 * disponível no repositório.
 */

import type { InvestmentPosition } from '../types';

export type GoalLinkBucket = 'linked' | 'available' | 'other_goal';

export interface GoalLinkCandidate {
  positionId: string;
  /** Link/unlink/change pedem conta e ativo, nunca o id da posição. */
  accountId: string;
  assetId: string;
  name: string;
  principalCents: number;
  currentValueCents: number;
  goalId?: string;
  bucket: GoalLinkBucket;
}

/**
 * A posição representa um investimento que o usuário reconhece?
 *
 * Fica de fora a posição arquivada e a que não tem capital nem valor — o ativo
 * técnico que o onboarding cria, ou a posição inteiramente retirada. Nenhum dos
 * dois é "um investimento" para quem abre a meta, e oferecê-los transformaria a
 * lista num inventário de infraestrutura.
 *
 * O aporte **pendente** também não aparece: ele ainda não tem posição, e não
 * precisa de vínculo retroativo — o próprio formulário já oferece a meta.
 */
export const isLinkableInvestment = (position: InvestmentPosition): boolean =>
  position.status === 'active' &&
  (position.principalCents > 0 || position.currentValueCents > 0);

const bucketOf = (position: InvestmentPosition, goalId: string): GoalLinkBucket => {
  if (position.goalId === goalId) return 'linked';
  if (position.goalId) return 'other_goal';
  return 'available';
};

/**
 * Posições → candidatos de uma meta, já classificados.
 *
 * `names` vem de uma resolução em bloco por `documentId() in`, nunca de uma
 * leitura por linha: a posição não guarda rótulo nenhum, e o nome que a pessoa
 * reconhece é o do ativo, que no modo simples é a própria descrição digitada.
 */
export const toGoalLinkCandidates = (
  positions: InvestmentPosition[],
  goalId: string,
  names: Map<string, string>,
): GoalLinkCandidate[] => positions
  .filter(isLinkableInvestment)
  .map((position) => ({
    positionId: position.id,
    accountId: position.accountId,
    assetId: position.assetId,
    name: names.get(position.assetId) ?? 'Investimento sem nome',
    principalCents: position.principalCents,
    currentValueCents: position.currentValueCents,
    goalId: position.goalId,
    bucket: bucketOf(position, goalId),
  }));

/**
 * Candidatos que a lista de "disponíveis" mostra.
 *
 * Já vinculado a **esta** meta não é candidato — ele aparece na outra lista,
 * com a ação de remover. Vinculado a **outra** meta aparece, porque o §2.C pede
 * que a troca seja possível, mas nunca silenciosa: quem o escolhe recebe a
 * confirmação de que a meta anterior perde aquele capital.
 */
export const availableGoalLinkCandidates = (
  candidates: GoalLinkCandidate[],
): GoalLinkCandidate[] => candidates.filter((candidate) => candidate.bucket !== 'linked');

export const linkedGoalInvestments = (
  candidates: GoalLinkCandidate[],
): GoalLinkCandidate[] => candidates.filter((candidate) => candidate.bucket === 'linked');

/**
 * Papéis que podem mover o vínculo.
 *
 * Espelha `investmentOperationRoles` das três operações de meta no backend
 * (`owner`, `admin`, `member`). Esconder é conveniência de interface; o
 * servidor continua revalidando a autoridade em toda chamada.
 */
export const canManageGoalLinks = (role: string | undefined): boolean =>
  role === 'owner' || role === 'admin' || role === 'member';

export interface GoalLinkCall {
  name: 'linkInvestmentToGoal' | 'changeInvestmentGoal' | 'unlinkInvestmentFromGoal';
  payload: Record<string, unknown>;
}

/**
 * Operação autoritativa para ligar um candidato a uma meta.
 *
 * Sem meta anterior é `linkInvestmentToGoal`; com meta anterior é
 * `changeInvestmentGoal`, que emite desvínculo e vínculo na mesma transação —
 * usar `link` sobre uma posição já vinculada seria recusado pelo domínio
 * ("A posição já está vinculada a uma meta.") e deixaria as duas metas erradas.
 */
export const buildGoalLinkCall = (
  candidate: GoalLinkCandidate,
  goalId: string,
  occurredAt: string,
  reason: string,
): GoalLinkCall => (candidate.goalId
  ? {
    name: 'changeInvestmentGoal',
    payload: {
      accountId: candidate.accountId,
      assetId: candidate.assetId,
      goalId,
      previousGoalId: candidate.goalId,
      occurredAt,
      reason,
    },
  }
  : {
    name: 'linkInvestmentToGoal',
    payload: {
      accountId: candidate.accountId,
      assetId: candidate.assetId,
      goalId,
      occurredAt,
      reason,
    },
  });

export const buildGoalUnlinkCall = (
  candidate: GoalLinkCandidate,
  goalId: string,
  occurredAt: string,
  reason: string,
): GoalLinkCall => ({
  name: 'unlinkInvestmentFromGoal',
  payload: {
    accountId: candidate.accountId,
    assetId: candidate.assetId,
    goalId,
    occurredAt,
    reason,
  },
});
