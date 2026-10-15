import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';

import {db, functions} from '../../lib/firebase';
import type {Goal, GoalDefinition, GoalStatus} from '../../types';
import {
  GOALS_PAGE_SIZE,
  MANUAL_HISTORY_LIMIT,
  buildInvestmentGoalOptionsPage,
  mapGoalDocument,
  mapManualProgressAudit,
  parseGoalKpiResults,
  parseGoalsOverview,
  type GoalKpiResult,
  type InvestmentGoalOptionsCursor,
  type InvestmentGoalOptionsPage,
  type GoalManualProgressEntry,
  type GoalsOverview,
} from './model';

/**
 * Metas (P5-B, D-31). Toda escrita é de callable do backend; este módulo só
 * **lê** `goals` e `goal_audit_logs` e liga as callables. Erros não viram lista
 * vazia: sobem para a tela.
 */

/** Página da consulta dos seletores de investimento (as Rules exigem `limit <= 26`). */
export const INVESTMENT_GOAL_OPTIONS_PAGE = 25;
/** Lote da busca de metas por ID (`in` + `limit`, dentro do teto das Rules). */
export const GOALS_BY_ID_CHUNK = 25;

const isReady = (workspaceId?: string): workspaceId is string =>
  Boolean(workspaceId) && workspaceId !== 'loading';

/** Cursor da lista: um valor por campo da ordenação (prioridade, criação, ID). */
export interface GoalListCursor {
  priorityRank: number;
  /** Timestamp do Firestore do último documento da página. */
  createdAt: unknown;
  id: string;
}

export interface GoalsPage {
  items: Goal[];
  nextCursor?: GoalListCursor;
  hasMore: boolean;
}

const reportInvalid = (id: string) => {
  // Só o ID: nenhum dado da meta vai para o console.
  console.error(`Documento de meta fora do formato autoritativo ignorado: ${id}`);
};

/**
 * Uma página da lista: metas não arquivadas, da maior prioridade para a menor,
 * da mais nova para a mais antiga. Pede 26 (25 + 1 de sonda) para saber se há
 * próxima página sem outra consulta.
 */
export const listGoalsPage = async (
  workspaceId?: string,
  cursor?: GoalListCursor,
): Promise<GoalsPage> => {
  if (!isReady(workspaceId)) return {items: [], hasMore: false};
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, 'goals'),
    where('archived', '==', false),
    orderBy('priorityRank', 'desc'),
    orderBy('createdAt', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(cursor ? [startAfter(cursor.priorityRank, cursor.createdAt, cursor.id)] : []),
    limit(GOALS_PAGE_SIZE + 1),
  ));
  const docs = snapshot.docs.slice(0, GOALS_PAGE_SIZE);
  const items: Goal[] = [];
  for (const entry of docs) {
    const goal = mapGoalDocument(entry.id, entry.data());
    if (goal) items.push(goal);
    else reportInvalid(entry.id);
  }
  const last = docs[docs.length - 1];
  return {
    items,
    nextCursor: last
      ? {priorityRank: last.get('priorityRank'), createdAt: last.get('createdAt'), id: last.id}
      : undefined,
    hasMore: snapshot.size > GOALS_PAGE_SIZE,
  };
};

/**
 * Metas de investimento ativas, uma página por vez (25 + sonda), em ordem de
 * nome. Sem teto: quem chama pede a próxima página quando o usuário quer ver
 * mais — nada é carregado em lote automaticamente, e uma meta além da
 * centésima continua alcançável (P5-B.1).
 */
export const listInvestmentGoalOptionsPage = async (
  workspaceId: string | undefined,
  cursor?: InvestmentGoalOptionsCursor,
): Promise<InvestmentGoalOptionsPage> => {
  if (!isReady(workspaceId)) return {goals: [], nextCursor: null, invalidIds: []};
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, 'goals'),
    where('archived', '==', false),
    where('progressSource', '==', 'investment'),
    orderBy('name', 'asc'),
    orderBy(documentId(), 'asc'),
    ...(cursor ? [startAfter(cursor.name, cursor.id)] : []),
    limit(INVESTMENT_GOAL_OPTIONS_PAGE + 1),
  ));
  const page = buildInvestmentGoalOptionsPage(
    snapshot.docs.map((entry) => ({id: entry.id, data: entry.data()})),
    INVESTMENT_GOAL_OPTIONS_PAGE,
  );
  page.invalidIds.forEach(reportInvalid);
  return page;
};

/**
 * Metas de investimento ativas pelo ID, em lotes de 25 (`in` + `limit`).
 *
 * Nomeia posições e cards cuja meta ainda não está nas páginas carregadas e
 * mantém selecionada uma meta já escolhida. Só volta meta de investimento não
 * arquivada: arquivada, de outra fonte ou inexistente fica de fora, como na
 * lista (a tela segue mostrando "Meta removida"/"Sem meta").
 */
export const listActiveInvestmentGoalsByIds = async (
  workspaceId: string | undefined,
  ids: readonly string[],
): Promise<Goal[]> => {
  if (!isReady(workspaceId)) return [];
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += GOALS_BY_ID_CHUNK) {
    chunks.push(unique.slice(index, index + GOALS_BY_ID_CHUNK));
  }
  const pages = await Promise.all(chunks.map((chunk) => getDocs(query(
    collection(db, 'workspaces', workspaceId, 'goals'),
    where(documentId(), 'in', chunk),
    limit(GOALS_BY_ID_CHUNK),
  ))));
  const goals: Goal[] = [];
  for (const page of pages) {
    for (const entry of page.docs) {
      const goal = mapGoalDocument(entry.id, entry.data());
      if (!goal) {
        reportInvalid(entry.id);
        continue;
      }
      if (!goal.archived && goal.progressSource === 'investment') goals.push(goal);
    }
  }
  return goals;
};

/** Histórico das atualizações manuais da meta (owner/admin, mais recentes primeiro). */
export const listGoalManualProgressHistory = async (
  workspaceId: string | undefined,
  goalId: string,
): Promise<GoalManualProgressEntry[]> => {
  if (!isReady(workspaceId) || !goalId) return [];
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, 'goal_audit_logs'),
    where('targetId', '==', goalId),
    where('operation', '==', 'updateGoalManualProgress'),
    orderBy('timestamp', 'desc'),
    limit(MANUAL_HISTORY_LIMIT),
  ));
  const items: GoalManualProgressEntry[] = [];
  for (const entry of snapshot.docs) {
    const mapped = mapManualProgressAudit(entry.id, entry.data());
    if (mapped) items.push(mapped);
  }
  return items;
};

// --- Callables --------------------------------------------------------------

const omitUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(omitUndefined) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, omitUndefined(entry)]),
    ) as T;
  }
  return value;
};

const callGoalFunction = async <TResult>(
  name: string,
  input: Record<string, unknown>,
): Promise<TResult> => {
  const callable = httpsCallable<Record<string, unknown>, TResult>(functions, name);
  const response = await callable(omitUndefined(input));
  return response.data;
};

export interface GoalWriteResult {
  success: boolean;
  goalId: string;
  revision: number;
}

export interface CreateGoalInput {
  goal: GoalDefinition;
  status?: GoalStatus;
  manualProgressCents?: number;
}

export const createGoal = (
  input: CreateGoalInput,
  workspaceId: string,
  idempotencyKey: string,
): Promise<GoalWriteResult> =>
  callGoalFunction<GoalWriteResult>('createGoal', {
    workspaceId,
    idempotencyKey,
    goal: input.goal,
    status: input.status,
    manualProgressCents: input.manualProgressCents,
  });

export interface UpdateGoalInput {
  goalId: string;
  expectedRevision: number;
  goal: GoalDefinition;
  manualProgressCents?: number;
}

export const updateGoal = (
  input: UpdateGoalInput,
  workspaceId: string,
  idempotencyKey: string,
): Promise<GoalWriteResult> =>
  callGoalFunction<GoalWriteResult>('updateGoal', {
    workspaceId,
    idempotencyKey,
    goalId: input.goalId,
    expectedRevision: input.expectedRevision,
    goal: input.goal,
    manualProgressCents: input.manualProgressCents,
  });

export interface UpdateManualProgressInput {
  goalId: string;
  expectedRevision: number;
  manualProgressCents: number;
}

export const updateGoalManualProgress = (
  input: UpdateManualProgressInput,
  workspaceId: string,
  idempotencyKey: string,
): Promise<GoalWriteResult & {manualProgressCents: number}> =>
  callGoalFunction('updateGoalManualProgress', {
    workspaceId,
    idempotencyKey,
    goalId: input.goalId,
    expectedRevision: input.expectedRevision,
    manualProgressCents: input.manualProgressCents,
  });

export interface SetGoalStatusInput {
  goalId: string;
  status: GoalStatus;
}

export const setGoalStatus = (
  input: SetGoalStatusInput,
  workspaceId: string,
  idempotencyKey: string,
): Promise<GoalWriteResult & {status: GoalStatus}> =>
  callGoalFunction('setGoalStatus', {
    workspaceId,
    idempotencyKey,
    goalId: input.goalId,
    status: input.status,
  });

export interface ArchiveGoalInput {
  goalId: string;
  reason: string;
}

export const archiveGoal = (
  input: ArchiveGoalInput,
  workspaceId: string,
  idempotencyKey: string,
): Promise<GoalWriteResult> =>
  callGoalFunction<GoalWriteResult>('archiveGoal', {
    workspaceId,
    idempotencyKey,
    goalId: input.goalId,
    reason: input.reason,
  });

/** Contagem exata do servidor (metas não arquivadas), independente da página. */
export const getGoalsOverview = async (workspaceId: string): Promise<GoalsOverview> =>
  parseGoalsOverview(await callGoalFunction('getGoalsOverview', {workspaceId}));

/** Indicadores PJ calculados no servidor; no máximo 25 metas por chamada. */
export const getGoalKpiProgress = async (
  workspaceId: string,
  goalIds: string[],
): Promise<GoalKpiResult[]> =>
  parseGoalKpiResults(await callGoalFunction('getGoalKpiProgress', {workspaceId, goalIds}));
