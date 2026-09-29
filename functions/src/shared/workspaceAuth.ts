import * as admin from "firebase-admin";

import {ApplicationError} from "./errors";
import {memberIdSchema, workspaceIdSchema} from "./ids";

/**
 * Resolvedor canônico de autorização por workspace (P1, §2.4; D-02, D-03).
 *
 * A única fonte de papel é `workspaces/{workspaceId}/members/{uid}` com
 * `status == "active"`. `workspace.ownerId` é campo denormalizado e **nunca**
 * autoriza nem serve de fallback; o índice `users/{uid}/workspaces` não tem
 * papel. O papel nunca vem do payload.
 *
 * Toda autorização exige, além do membership ativo:
 * - perfil `users/{uid}` existente com `status == "active"` (suspensão);
 * - workspace existente e não arquivado.
 *
 * Existem duas leituras e as duas usam a mesma avaliação:
 * - `resolveWorkspaceActor`: pré-checagem fora da transação, feita pelo
 *   wrapper para recusar cedo e para registrar o papel no log;
 * - `reassertWorkspaceActor`: releitura **dentro** da transação da mutação,
 *   que é a que vale. Entre a pré-checagem e o commit o membro pode ter sido
 *   removido ou rebaixado; a releitura torna a decisão atômica com a escrita.
 */
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  "owner",
  "admin",
  "member",
  "viewer",
];

export const isWorkspaceRole = (value: unknown): value is WorkspaceRole =>
  typeof value === "string" &&
  (WORKSPACE_ROLES as readonly string[]).includes(value);

export interface WorkspaceActor {
  uid: string;
  workspaceId: string;
  role: WorkspaceRole;
}

export type AccountStatus = "active" | "suspended";

const db = () => admin.firestore();

const assertPathId = (
  schema: typeof workspaceIdSchema,
  value: unknown,
): string => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApplicationError("invalid_payload", "Identificador inválido.");
  }
  return parsed.data;
};

export const userProfileRef = (uid: string) =>
  db().collection("users").doc(assertPathId(memberIdSchema, uid));

export const workspaceRef = (workspaceId: string) =>
  db().collection("workspaces")
    .doc(assertPathId(workspaceIdSchema, workspaceId));

export const workspaceMemberRef = (workspaceId: string, uid: string) =>
  workspaceRef(workspaceId).collection("members")
    .doc(assertPathId(memberIdSchema, uid));

export const userWorkspaceIndexRef = (uid: string, workspaceId: string) =>
  userProfileRef(uid).collection("workspaces")
    .doc(assertPathId(workspaceIdSchema, workspaceId));

type Snapshot = admin.firestore.DocumentSnapshot;

export const ACCOUNT_SUSPENDED_MESSAGE =
  "Sua conta está suspensa. Entre em contato com o suporte.";

export const ACCOUNT_NOT_INITIALIZED_MESSAGE =
  "Sua conta ainda não foi preparada. Recarregue a página e tente novamente.";

export const WORKSPACE_ACCESS_DENIED_MESSAGE =
  "Você não tem acesso a este espaço de trabalho.";

export const WORKSPACE_ROLE_DENIED_MESSAGE =
  "Seu papel neste espaço de trabalho não permite esta operação.";

export const WORKSPACE_ARCHIVED_MESSAGE =
  "Este espaço de trabalho está arquivado.";

export const WORKSPACE_ROLE_CHANGED_MESSAGE =
  "Suas permissões neste espaço de trabalho mudaram. " +
  "Atualize a página e tente novamente.";

/** Avalia o perfil: existe e está ativo. */
export const assertActiveAccountSnapshot = (profile: Snapshot): void => {
  if (!profile.exists) {
    throw new ApplicationError(
      "account_not_initialized",
      ACCOUNT_NOT_INITIALIZED_MESSAGE,
    );
  }
  if (profile.get("status") !== "active") {
    throw new ApplicationError("account_suspended", ACCOUNT_SUSPENDED_MESSAGE);
  }
};

/** Pré-checagem de conta ativa para callables sem workspace. */
export const requireActiveAccount = async (uid: string): Promise<void> => {
  assertActiveAccountSnapshot(await userProfileRef(uid).get());
};

/**
 * Avaliação única de acesso a um workspace.
 *
 * A ordem das verificações é deliberada: a ausência de membership ativo é
 * respondida antes de olhar o workspace, e com a mesma mensagem que um
 * workspace inexistente produziria. Quem não é membro não consegue usar a
 * resposta como oráculo de existência de um ID de outro tenant.
 */
export const evaluateWorkspaceAccess = (
  snapshots: {profile: Snapshot; workspace: Snapshot; member: Snapshot},
  allowedRoles: readonly WorkspaceRole[],
): {workspace: admin.firestore.DocumentData; role: WorkspaceRole} => {
  assertActiveAccountSnapshot(snapshots.profile);
  const member = snapshots.member;
  const role = member.get("role");
  if (
    !member.exists ||
    member.get("status") !== "active" ||
    !isWorkspaceRole(role) ||
    !snapshots.workspace.exists
  ) {
    throw new ApplicationError(
      "workspace_membership_required",
      WORKSPACE_ACCESS_DENIED_MESSAGE,
    );
  }
  const workspace = snapshots.workspace.data() ?? {};
  if (workspace.status === "archived") {
    throw new ApplicationError(
      "workspace_archived",
      WORKSPACE_ARCHIVED_MESSAGE,
    );
  }
  if (!allowedRoles.includes(role)) {
    throw new ApplicationError(
      "workspace_role_denied",
      WORKSPACE_ROLE_DENIED_MESSAGE,
    );
  }
  return {workspace, role};
};

const accessRefs = (uid: string, workspaceId: string) => [
  userProfileRef(uid),
  workspaceRef(workspaceId),
  workspaceMemberRef(workspaceId, uid),
] as const;

/** Pré-checagem fora da transação. */
export const resolveWorkspaceActor = async (
  uid: string,
  workspaceId: string,
  allowedRoles: readonly WorkspaceRole[],
): Promise<WorkspaceActor> => {
  const [profile, workspace, member] = await db().getAll(
    ...accessRefs(uid, workspaceId),
  );
  const {role} = evaluateWorkspaceAccess(
    {profile, workspace, member},
    allowedRoles,
  );
  return {uid, workspaceId, role};
};

export interface ReassertedWorkspaceAccess {
  workspace: admin.firestore.DocumentData;
  role: WorkspaceRole;
}

/**
 * Releitura transacional da autorização.
 *
 * Deve ser chamada na fase de leitura da transação da mutação. Com
 * `allowedRoles`, reavalia a matriz da operação; sem, exige que o papel seja
 * o mesmo resolvido na pré-checagem — um rebaixamento concorrente recusa a
 * operação em vez de deixá-la terminar com o poder antigo.
 */
export const reassertWorkspaceActor = async (
  transaction: admin.firestore.Transaction,
  actor: Pick<WorkspaceActor, "uid" | "workspaceId"> & {role?: WorkspaceRole},
  allowedRoles?: readonly WorkspaceRole[],
): Promise<ReassertedWorkspaceAccess> => {
  const [profile, workspace, member] = await transaction.getAll(
    ...accessRefs(actor.uid, actor.workspaceId),
  );
  const roles = allowedRoles ?? (actor.role ? [actor.role] : []);
  try {
    return evaluateWorkspaceAccess({profile, workspace, member}, roles);
  } catch (error) {
    if (
      !allowedRoles &&
      error instanceof ApplicationError &&
      error.code === "workspace_role_denied"
    ) {
      throw new ApplicationError(
        "workspace_role_denied",
        WORKSPACE_ROLE_CHANGED_MESSAGE,
      );
    }
    throw error;
  }
};
