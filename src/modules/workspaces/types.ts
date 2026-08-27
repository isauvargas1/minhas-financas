export type WorkspaceType = 'PF' | 'PJ';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface WorkspaceMember {
  uid: string;
  email: string;       // Essencial para convites e exibição (desnormalizado)
  displayName?: string; // Melhor UX para não buscar user profile toda hora
  role: WorkspaceRole;
  joinedAt: string;
}

export interface Workspace {
  id: string;
  // userId: string; -> REMOVIDO: O conceito de "userId" único morre aqui.
  ownerId?: string; // Mantemos opcional apenas para auditoria de quem criou
  type: WorkspaceType;
  name: string;
  slug?: string;
  cnpj?: string | null;
  createdAt: string;
  updatedAt: string;
  themeColor?: string;
  // Campo injetado dinamicamente no front ao listar (não salvo no banco)
  myRole?: WorkspaceRole; 

  alertPreferences?: {
    billing: boolean;
    accountsPayable: boolean;
    delinquency: boolean;
    lowMargin: boolean;
  };
}
