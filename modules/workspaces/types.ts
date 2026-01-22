
export type WorkspaceType = 'PF' | 'PJ';

export interface Workspace {
  id: string;
  userId: string;
  type: WorkspaceType; // 'PF' ou 'PJ'
  name: string; // 'Pessoal', 'Cartório...', 'Nutri Cursos'
  slug?: string;
  cnpj?: string | null; // apenas PJ
  createdAt: string;
  updatedAt: string;
  
  // Optional property for UI compatibility/migration
  themeColor?: string; 

  // Fix: Added alertPreferences to satisfy requirements in api.ts
  alertPreferences?: {
    billing: boolean;
    accountsPayable: boolean;
    delinquency: boolean;
    lowMargin: boolean;
  };
}
