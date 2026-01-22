
export interface Client {
  id: string;
  workspaceId: string;
  name: string;
  email?: string;
  phone?: string;
  document?: string; // CPF or CNPJ
  notes?: string;
  createdAt: string;
}

export interface Receivable {
  id: string;
  workspaceId: string;
  clientId: string;
  description: string;
  amount: number;
  dueDate: string;
  status: 'pendente' | 'recebido' | 'atrasado' | 'cancelado';
  createdAt: string;
}
