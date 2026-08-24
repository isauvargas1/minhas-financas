import {collection, getDocs, limit, query} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';

import {db, functions} from '../../lib/firebase';
import type {Goal} from '../../types';
import {mapGoalDocument} from './projection';

type GoalWriteInput = Omit<Goal, 'id' | 'createdAt' | 'updatedAt' | 'currentAmount'>;

const omitUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(omitUndefined) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, omitUndefined(entry)]),
    ) as T;
  }
  return value;
};

const callGoalFunction = async <TInput extends Record<string, unknown>, TResult>(
  name: string,
  input: TInput,
): Promise<TResult> => {
  const callable = httpsCallable<TInput, TResult>(functions, name);
  const response = await callable(input);
  return response.data;
};

export const listGoals = async (workspaceId?: string, investmentsV2Enabled = false): Promise<Goal[]> => {
  if (!workspaceId || workspaceId === 'loading') return [];
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, 'goals'),
    limit(100),
  ));
  return snapshot.docs
    .map((item) => {
      const data = item.data() as Omit<Goal, 'id'>;
      return mapGoalDocument(
        item.id,
        data as Omit<Goal, 'id'> & {investmentProgressCents?: number},
        investmentsV2Enabled,
      );
    })
    .filter((goal) => goal.archived !== true);
};

export const createGoal = async (
  goal: GoalWriteInput,
  workspaceId: string,
  idempotencyKey: string,
): Promise<Goal> => {
  const result = await callGoalFunction<
    {workspaceId: string; idempotencyKey: string; goal: GoalWriteInput},
    {success: true; goalId: string}
  >('createGoal', {workspaceId, idempotencyKey, goal: omitUndefined(goal)});
  return {
    id: result.goalId,
    ...goal,
    currentAmount: goal.progressBasis === 'current_value' ? goal.currentValue ?? 0 : 0,
    progressBasis: goal.progressBasis ?? 'net_contributions',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const updateGoal = async (
  id: string,
  goal: GoalWriteInput,
  workspaceId: string,
  idempotencyKey: string,
): Promise<Goal> => {
  await callGoalFunction('updateGoal', {
    workspaceId,
    idempotencyKey,
    goalId: id,
    goal: omitUndefined(goal),
  });
  return {
    id,
    ...goal,
    currentAmount: goal.progressBasis === 'current_value' ? goal.currentValue ?? 0 : 0,
    progressBasis: goal.progressBasis ?? 'net_contributions',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const setGoalTransactionLinks = async (
  goalId: string,
  transactionIds: string[],
  workspaceId: string,
  idempotencyKey: string,
): Promise<void> => {
  await callGoalFunction('setGoalTransactionLinks', {
    workspaceId,
    idempotencyKey,
    goalId,
    transactionIds,
  });
};

export const archiveGoal = async (
  goalId: string,
  workspaceId: string,
  idempotencyKey: string,
): Promise<void> => {
  await callGoalFunction('archiveGoal', {
    workspaceId,
    idempotencyKey,
    goalId,
    reason: 'Arquivada pelo usuário',
  });
};

export type {GoalWriteInput};
