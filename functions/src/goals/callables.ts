import {onCall} from "firebase-functions/v2/https";
import type {CallableOptions} from "firebase-functions/v2/https";
import {z} from "zod";

import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";

import {requireWorkspaceRole} from "../creditCards/auth";
import {toHttpsError} from "../creditCards/errors";
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

const buildContext = async <TPayload extends {workspaceId: string}>(
  request: Parameters<typeof requireWorkspaceRole>[0],
  schema: z.ZodType<TPayload>,
  allowedRoles: Array<"owner" | "admin" | "member">,
) => {
  const payload = schema.parse(request.data);
  const auth = await requireWorkspaceRole(request, payload.workspaceId, allowedRoles);
  return {payload, auth};
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
const callable = <TPayload extends {workspaceId: string}>(
  schema: z.ZodType<TPayload>,
  allowedRoles: Array<"owner" | "admin" | "member">,
  operation: (auth: Awaited<ReturnType<typeof requireWorkspaceRole>>, payload: TPayload) => Promise<Record<string, unknown>>,
  options: CallableOptions = DOMAIN_CALLABLE_OPTIONS,
) => onCall(options, async (request) => {
  try {
    const context = await buildContext(request, schema, allowedRoles);
    return await operation(context.auth, context.payload);
  } catch (error) {
    throw toHttpsError(error);
  }
});

type GoalRole = "owner" | "admin" | "member";

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

export const createGoal = callable(
  createGoalPayloadSchema,
  [...GOAL_OPERATION_ROLES.createGoal],
  executeCreateGoal,
);

export const updateGoal = callable(
  updateGoalPayloadSchema,
  [...GOAL_OPERATION_ROLES.updateGoal],
  executeUpdateGoal,
);

export const archiveGoal = callable(
  archiveGoalPayloadSchema,
  [...GOAL_OPERATION_ROLES.archiveGoal],
  executeArchiveGoal,
);

export const seedLegacySettingsCatalog = callable(
  seedLegacyCatalogPayloadSchema,
  [...GOAL_OPERATION_ROLES.seedLegacySettingsCatalog],
  executeSeedLegacySettingsCatalog,
);
