
export type LoanType = 'lend' | 'borrow'; // 'lend' = Empresa concedeu, 'borrow' = Empresa tomou
export type LoanStatus = 'active' | 'paid' | 'overdue' | 'cancelled';
export type LoanInterestType = 'percentage' | 'fixed' | 'none';
export type LoanInterestBasis = 'monthly' | 'annual' | 'fixed';

export type PJCounterpartyType = 'banco' | 'socio' | 'colaborador' | 'fornecedor' | 'cliente' | 'terceiro';
export type PJLoanClassification = 'dividas_financeiras' | 'antecipacoes' | 'emprestimos_colaboradores' | 'capital_giro' | 'outro';

export interface LoanMovement {
    id: string;
    loanId: string;
    type: 'payment' | 'receipt' | 'adjustment' | 'principal'; 
    amount: number;
    principalAmount?: number; // Part of payment that goes to principal
    interestAmount?: number;  // Part of payment that goes to interest
    date: string;
    description: string;
    transactionId?: string;
    createdAt: string;
}

export interface LoanInstallment {
    number: number;
    dueDate: string;
    amount: number;
    principalPart?: number;
    interestPart?: number;
    status: 'pending' | 'paid' | 'overdue';
    paymentDate?: string;
    movementId?: string;
}

export interface Loan {
    id: string;
    profileId: string; // Workspace ID
    type: LoanType;
    personName: string; // Counterparty Name
    counterpartyType?: PJCounterpartyType;
    personContact?: string;
    cnpjCpf?: string;
    description: string;
    classification?: PJLoanClassification;
    costCenter?: string;
    
    principalValue: number;
    currentBalance: number; // Updated after movements (Principal only usually)
    totalPaidReceived: number; // Amount already settled
    totalInterestPaidReceived: number; // Total interest paid/received separately
    
    startDate: string;
    expectedPayoffDate: string;
    paymentMethod: string; 
    status: LoanStatus;
    
    interestType: LoanInterestType;
    interestBasis?: LoanInterestBasis;
    interestValue?: number; // % or absolute
    
    hasInstallments: boolean;
    installmentsCount?: number;
    installments?: LoanInstallment[];
    
    createdAt: string;
    updatedAt: string;
}
