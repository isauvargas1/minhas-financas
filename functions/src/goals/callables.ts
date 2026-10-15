import type {z} from "zod";

import {defineCallable} from "../shared/callable";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import type {WorkspaceActor, WorkspaceRole} from "../shared/workspaceAuth";
import {
  archiveGoalPayloadSchema,
  createGoalPayloadSchema,
  getGoalKpiProgressPayloadSchema,
  getGoalsOverviewPayloadSchema,
  setGoalStatusPayloadSchema,
  updateGoalManualProgressPayloadSchema,
  updateGoalPayloadSchema,
} from "./contracts";
import {executeGetGoalKpiProgress, executeGetGoalsOverview} from "./kpi";
import {
  executeArchiveGoal,
  executeCreateGoal,
  executeSetGoalStatus,
  executeUpdateGoal,
  executeUpdateGoalManualProgress,
} from "./operations";

const MANAGER_ROLES: WorkspaceRole[] = ["owner", "admin", "member"];
const READER_ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

/**
 * Matriz declarativa de papéis das callables de metas.
 *
 * Segue o formato de `investments/writeStrategy.ts`: a matriz é a única
 * fonte, e o teste percorre ela inteira — uma callable nova sem entrada aqui
 * não compila. Owner, admin e member gerenciam metas (D-31.5); viewer só lê,
 * e as únicas callables abertas a ele são as de leitura (contagem do painel e
 * indicadores PJ), que não escrevem nada.
 */
export const GOAL_OPERATION_ROLES = {
  createGoal: MANAGER_ROLES,
  updateGoal: MANAGER_ROLES,
  updateGoalManualProgress: MANAGER_ROLES,
  setGoalStatus: MANAGER_ROLES,
  archiveGoal: MANAGER_ROLES,
  getGoalsOverview: READER_ROLES,
  getGoalKpiProgress: READER_ROLES,
} as const satisfies Record<string, readonly WorkspaceRole[]>;

type GoalOperation = keyof typeof GOAL_OPERATION_ROLES;

/** Com `workspaceRoles`, o kernel sempre entrega o ator resolvido. */
const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new Error("goal_callable_without_actor");
  return actor;
};

/**
 * Recursos declarados explicitamente: `setGlobalOptions` fixa região e
 * `maxInstances`, mas não tempo limite nem memória.
 */
const goalCallable = <TPayload extends {workspaceId: string}>(
  operation: GoalOperation,
  schema: z.ZodType<TPayload>,
  execute: (
    actor: WorkspaceActor,
    payload: TPayload,
  ) => Promise<object>,
) => {
  return defineCallable({
    operation,
    schema,
    runtime: DOMAIN_CALLABLE_OPTIONS,
    workspaceRoles: [...GOAL_OPERATION_ROLES[operation]],
    // A pré-checagem do kernel recusa cedo; nas mutações, a decisão que vale
    // é a releitura dentro da transação de cada operação (`operations.ts`).
    handler: ({actor, payload}) => execute(requireActor(actor), payload),
  });
};

export const createGoal = goalCallable(
  "createGoal",
  createGoalPayloadSchema,
  executeCreateGoal,
);

export const updateGoal = goalCallable(
  "updateGoal",
  updateGoalPayloadSchema,
  executeUpdateGoal,
);

export const updateGoalManualProgress = goalCallable(
  "updateGoalManualProgress",
  updateGoalManualProgressPayloadSchema,
  executeUpdateGoalManualProgress,
);

export const setGoalStatus = goalCallable(
  "setGoalStatus",
  setGoalStatusPayloadSchema,
  executeSetGoalStatus,
);

export const archiveGoal = goalCallable(
  "archiveGoal",
  archiveGoalPayloadSchema,
  executeArchiveGoal,
);

export const getGoalsOverview = goalCallable(
  "getGoalsOverview",
  getGoalsOverviewPayloadSchema,
  (actor) => executeGetGoalsOverview(actor),
);

export const getGoalKpiProgress = goalCallable(
  "getGoalKpiProgress",
  getGoalKpiProgressPayloadSchema,
  (actor, payload) => executeGetGoalKpiProgress(actor, payload),
);
