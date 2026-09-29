export type WorkspaceType = 'PF' | 'PJ';

/** Papéis de membership (D-02). `viewer` é estritamente somente leitura. */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface WorkspaceMember {
  uid: string;
  email: string;
  displayName?: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface WorkspaceAlertPreferences {
  billing: boolean;
  accountsPayable: boolean;
  delinquency: boolean;
  lowMargin: boolean;
}

/**
 * Workspace como a interface o usa. `ownerId` é só informativo (D-03): a
 * autoridade é `myRole`, lido do membership ativo do usuário.
 */
export interface Workspace {
  id: string;
  ownerId?: string;
  type: WorkspaceType;
  name: string;
  cnpj?: string | null;
  createdAt: string;
  updatedAt: string;
  themeColor?: string;
  /** Papel do usuário, lido de `workspaces/{id}/members/{uid}` ativo. */
  myRole?: WorkspaceRole;
  alertPreferences?: WorkspaceAlertPreferences;
}
