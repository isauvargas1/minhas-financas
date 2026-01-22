
import { Loan, LoanInstallment, LoanInterestBasis, LoanInterestType } from './types.ts';

/**
 * Calculates the total cost of a loan including estimated interest.
 */
export const calculateTotalLoanCost = (loan: Loan): number => {
    if (loan.interestType === 'none') return loan.principalValue;
    if (loan.interestType === 'fixed') return loan.principalValue + (loan.interestValue || 0);
    
    // For percentage based on installments (simplified)
    if (loan.hasInstallments && loan.installments) {
        return loan.installments.reduce((acc, inst) => acc + inst.amount, 0);
    }
    
    return loan.principalValue; // Fallback
};

/**
 * Generates installments with principal/interest split for PJ.
 */
export const generatePJAmortizationPlan = (
    principal: number,
    count: number,
    startDate: string,
    interestBasis: LoanInterestBasis,
    interestValue: number = 0
): LoanInstallment[] => {
    const installments: LoanInstallment[] = [];
    
    // Simplified Fixed Installment Calculation (SAC or Price would be ideal, using fixed for simplicity in UI)
    let monthlyRate = 0;
    if (interestBasis === 'monthly') monthlyRate = interestValue / 100;
    else if (interestBasis === 'annual') monthlyRate = (interestValue / 12) / 100;

    const installmentAmount = monthlyRate > 0 
        ? (principal * monthlyRate * Math.pow(1 + monthlyRate, count)) / (Math.pow(1 + monthlyRate, count) - 1)
        : principal / count;

    const start = new Date(startDate + 'T12:00:00');
    let remainingPrincipal = principal;

    for (let i = 1; i <= count; i++) {
        const dueDate = new Date(start);
        dueDate.setMonth(start.getMonth() + i);
        
        const interestPart = remainingPrincipal * monthlyRate;
        const principalPart = installmentAmount - interestPart;
        remainingPrincipal -= principalPart;

        installments.push({
            number: i,
            dueDate: dueDate.toISOString().split('T')[0],
            amount: parseFloat(installmentAmount.toFixed(2)),
            principalPart: parseFloat(principalPart.toFixed(2)),
            interestPart: parseFloat(interestPart.toFixed(2)),
            status: 'pending'
        });
    }
    
    return installments;
};

export const getPJLoanClassificationLabel = (cls?: string): string => {
    const map: Record<string, string> = {
        'dividas_financeiras': 'Dívidas Financeiras',
        'antecipacoes': 'Antecipações',
        'emprestimos_colaboradores': 'Empréstimos a Colaboradores',
        'capital_giro': 'Capital de Giro',
        'outro': 'Outros'
    };
    return map[cls || ''] || 'Não classificado';
};
