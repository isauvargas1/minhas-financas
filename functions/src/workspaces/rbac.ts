import type {WorkspaceRole} from "../shared/workspaceAuth";

/**
 * Matriz de gestão de membros (D-04).
 *
 * OWNER convida, promove, rebaixa e remove admin/member/viewer e transfere a
 * titularidade. ADMIN convida e remove só member/viewer e alterna entre os
 * dois; não cria, promove, rebaixa nem remove admin e não toca no owner.
 * MEMBER e VIEWER não gerem membros. Ninguém altera o próprio papel; o papel
 * `owner` só muda por transferência.
 */
export type ManageableRole = Exclude<WorkspaceRole, "owner">;

export const MANAGEABLE_ROLES: readonly ManageableRole[] = [
  "admin",
  "member",
  "viewer",
];

const MANAGED_BY: Record<WorkspaceRole, readonly ManageableRole[]> = {
  owner: ["admin", "member", "viewer"],
  admin: ["member", "viewer"],
  member: [],
  viewer: [],
};

/** Papéis que o ator pode conceder por convite. */
export const canInvite = (
  actor: WorkspaceRole,
  role: ManageableRole,
): boolean => MANAGED_BY[actor].includes(role);

/** Revogar segue a mesma regra de emitir. */
export const canRevokeInvite = canInvite;

/** Troca de papel de outro membro: origem e destino na alçada do ator. */
export const canChangeRole = (
  actor: WorkspaceRole,
  from: WorkspaceRole,
  to: ManageableRole,
): boolean =>
  from !== "owner" &&
  MANAGED_BY[actor].includes(from) &&
  MANAGED_BY[actor].includes(to);

/** Remoção de outro membro. O owner nunca é removível. */
export const canRemove = (
  actor: WorkspaceRole,
  target: WorkspaceRole,
): boolean => target !== "owner" && MANAGED_BY[actor].includes(target);
