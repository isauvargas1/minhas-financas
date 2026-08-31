import {collection, documentId, getDocs, limit, orderBy, query, where} from 'firebase/firestore';
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

export const listGoals = async (workspaceId?: string): Promise<Goal[]> => {
  if (!workspaceId || workspaceId === 'loading') return [];
  /*
   * INV-P2-033 — o filtro de arquivadas acontecia **depois** do `limit(100)`,
   * e a consulta não tinha `orderBy`: as 100 primeiras vinham em ordem de ID
   * do Firestore, e um workspace com muitas metas arquivadas podia perder
   * metas ativas antes de qualquer filtro. Agora o filtro é do servidor e a
   * ordem é determinística.
   *
   * `archived` é opcional em documentos anteriores ao campo, e o Firestore
   * omite da consulta filtrada todo documento sem o campo — por isso a
   * segunda consulta, que recupera exatamente esses.
   */
  const goalsRef = collection(db, 'workspaces', workspaceId, 'goals');
  const [active, legacy] = await Promise.all([
    getDocs(query(
      goalsRef,
      where('archived', '==', false),
      orderBy(documentId()),
      limit(GOALS_PAGE_LIMIT),
    )),
    getDocs(query(goalsRef, orderBy(documentId()), limit(GOALS_PAGE_LIMIT))),
  ]);
  const seen = new Set(active.docs.map((entry) => entry.id));
  const docs = [
    ...active.docs,
    ...legacy.docs.filter((entry) => !seen.has(entry.id)),
  ];
  return docs
    .map((item) => {
      const data = item.data() as Omit<Goal, 'id'>;
      return mapGoalDocument(
        item.id,
        data as Omit<Goal, 'id'> & {investmentProgressCents?: number},
      );
    })
    .filter((goal) => goal.archived !== true);
};

/** Teto de metas por consulta. As Rules exigem `limit` em toda listagem. */
const GOALS_PAGE_LIMIT = 100;

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
