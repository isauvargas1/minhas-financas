import type {z} from "zod";

import {defineCallable} from "../shared/callable";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import type {WorkspaceActor, WorkspaceRole} from "../shared/workspaceAuth";
import {
  archiveGoalPayloadSchema,
  createGoalPayloadSchema,
  seedLegacyCatalogPayloadSchema,
  updateGoalPayloadSchema,
} from "./contracts";
import {
  executeArchiveGoal,
  executeCreateGoal,
  executeSeedLegacySettingsCatalog,
  executeUpdateGoal,
} from "./operations";

type GoalRole = Extract<WorkspaceRole, "owner" | "admin" | "member">;

const ALL_ACTIVE_ROLES: GoalRole[] = ["owner", "admin", "member"];
/** Operações administrativas de meta. */
const PRIVILEGED_ROLES: GoalRole[] = ["owner", "admin"];

/**
 * Matriz declarativa de papéis das callables de metas.
 *
 * Segue o formato de `investments/writeStrategy.ts`. Antes, o papel de cada
 * operação vivia solto no ponto de construção da callable, sem nada que
 * pudesse ser afirmado por teste: `rebuildGoalProgress` aceitava `member`
 * enquanto a contraparte do domínio patrimonial exigia `owner`/`admin`, e a
 * divergência não aparecia em lugar nenhum.
 *
 * A matriz é a única fonte, e o teste percorre ela inteira — uma callable nova
 * sem entrada aqui não compila.
 */
export const GOAL_OPERATION_ROLES = {
  createGoal: ALL_ACTIVE_ROLES,
  updateGoal: ALL_ACTIVE_ROLES,
  archiveGoal: ALL_ACTIVE_ROLES,
  seedLegacySettingsCatalog: PRIVILEGED_ROLES,
} as const satisfies Record<string, readonly GoalRole[]>;

type GoalOperation = keyof typeof GOAL_OPERATION_ROLES;

/** Com `workspaceRoles`, o kernel sempre entrega o ator resolvido. */
const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new Error("goal_callable_without_actor");
  return actor;
};

/**
 * As callables de metas não declaravam recurso nenhum.
 *
 * `setGlobalOptions` fixa região e `maxInstances`, mas não tempo limite nem
 * memória: as sete rodavam no padrão da plataforma, 60 s e 256 MiB. Serve para
 * criar e editar meta; **não** serve para `rebuildGoalProgress`, que soma os
 * aportes fora da transação, por páginas com cursor, até o teto de 100.000 —
 * mais de trezentas consultas sequenciais no pior caso. O corte por tempo
 * aconteceria no meio da varredura, e a reconciliação que a área operacional
 * oferece falharia justamente nas metas grandes, que são as únicas que
 * precisam dela.
 */
const goalCallable = <TPayload extends {workspaceId: string}>(
  operation: GoalOperation,
  schema: z.ZodType<TPayload>,
  execute: (
    actor: WorkspaceActor,
    payload: TPayload,
  ) => Promise<Record<string, unknown>>,
) => {
  return defineCallable({
    operation,
    schema,
    runtime: DOMAIN_CALLABLE_OPTIONS,
    workspaceRoles: [...GOAL_OPERATION_ROLES[operation]],
    // A pré-checagem do kernel recusa cedo; a decisão que vale é a releitura
    // dentro da transação de cada operação (`operations.ts`).
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

export const archiveGoal = goalCallable(
  "archiveGoal",
  archiveGoalPayloadSchema,
  executeArchiveGoal,
);

export const seedLegacySettingsCatalog = goalCallable(
  "seedLegacySettingsCatalog",
  seedLegacyCatalogPayloadSchema,
  executeSeedLegacySettingsCatalog,
);
