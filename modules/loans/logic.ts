
import { Loan, LoanInstallment, LoanType } from './types.ts';

export const calculateNextInstallment = (loan: Loan) => {
    if (!loan.installments) return null;
    return loan.installments.find(i => i.status === 'pending' || i.status === 'overdue');
};

export const generateInstallmentPlan = (
    principal: number,
    count: number,
    startDate: string,
    interestType: 'percentage' | 'fixed' | 'none',
    interestValue: number = 0
): LoanInstallment[] => {
    const installments: LoanInstallment[] = [];
    let baseAmount = principal / count;
    
    let installmentAmount = baseAmount;
    if (interestType === 'fixed') {
        installmentAmount = (principal + interestValue) / count;
    } else if (interestType === 'percentage') {
        // Simple interest simulation for this mock
        installmentAmount = (principal * (1 + (interestValue / 100))) / count;
    }

    const start = new Date(startDate + 'T12:00:00');
    
    for (let i = 1; i <= count; i++) {
        const dueDate = new Date(start);
        dueDate.setMonth(start.getMonth() + i);
        
        installments.push({
            number: i,
            dueDate: dueDate.toISOString().split('T')[0],
            amount: parseFloat(installmentAmount.toFixed(2)),
            status: 'pending'
        });
    }
    
    return installments;
};

export const getLoanCategory = (type: LoanType): string => {
    return type === 'lend' ? 'Empréstimos concedidos' : 'Empréstimos recebidos';
};
