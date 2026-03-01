export interface Client {
    id: string; // MUDAR DE NUMBER PARA STRING
    name: string;
    cnpj?: string;
    email?: string;
    phone?: string;
    address?: string;
    description?: string;
    status: 'active' | 'inactive';
    createdAt: string;
    updatedAt: string;
}

export interface Receivable {
    id: string; // MUDAR DE NUMBER PARA STRING
    clientId: string; // MUDAR DE NUMBER PARA STRING
    description: string;
    value: number;
    dueDate: string;
    status: 'pending' | 'paid' | 'overdue' | 'cancelled';
    issueDate: string;
    paymentDate?: string;
    invoiceUrl?: string;
    category?: string;
    createdAt: string;
    updatedAt: string;
}