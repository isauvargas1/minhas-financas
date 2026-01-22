
import { Goal, Transaction, GoalPeriod, BusinessGoalType } from '../../types.ts';

/**
 * Calcula o intervalo de datas baseado no período da meta.
 */
export const getPeriodDates = (period: GoalPeriod, startDateStr: string, deadlineStr: string) => {
    const now = new Date();
    let start = new Date(startDateStr);
    let end = new Date(deadlineStr);

    if (period === 'mensal') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (period === 'trimestral') {
        const quarter = Math.floor(now.getMonth() / 3);
        start = new Date(now.getFullYear(), quarter * 3, 1);
        end = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
    } else if (period === 'anual') {
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31);
    }

    return { start, end };
};

/**
 * Calcula o progresso automático para uma meta PJ.
 */
export const calculateBusinessGoalProgress = (
    goal: Goal,
    transactions: Transaction[],
    currentBalance: number
): number => {
    if (goal.businessType === 'investimento' || !goal.isAutomatic) {
        return goal.currentAmount;
    }

    const { start, end } = getPeriodDates(goal.period || 'custom', goal.startDate, goal.deadline);
    
    const periodTransactions = transactions.filter(t => {
        const tDate = new Date(t.date);
        return tDate >= start && tDate <= end;
    });

    switch (goal.businessType) {
        case 'faturamento': {
            return periodTransactions
                .filter(t => t.type === 'receita')
                .reduce((acc, t) => acc + t.value, 0);
        }
        case 'lucro': {
            const income = periodTransactions.filter(t => t.type === 'receita').reduce((acc, t) => acc + t.value, 0);
            const expenses = periodTransactions.filter(t => t.type === 'despesa' || t.type === 'parcelado').reduce((acc, t) => acc + t.value, 0);
            return income - expenses;
        }
        case 'margem': {
            const income = periodTransactions.filter(t => t.type === 'receita').reduce((acc, t) => acc + t.value, 0);
            const expenses = periodTransactions.filter(t => t.type === 'despesa' || t.type === 'parcelado').reduce((acc, t) => acc + t.value, 0);
            const profit = income - expenses;
            return income > 0 ? (profit / income) * 100 : 0;
        }
        case 'caixa_minimo': {
            return currentBalance;
        }
        case 'reducao_custos': {
            // No caso de redução de custos, o progresso é quanto do "teto" já foi usado.
            // O componente visual precisará inverter a lógica ou mostrar como "consumo de orçamento".
            return periodTransactions
                .filter(t => t.type === 'despesa' || t.type === 'parcelado')
                .reduce((acc, t) => acc + t.value, 0);
        }
        default:
            return goal.currentAmount;
    }
};

/**
 * Determina a tendência e ritmo da meta.
 */
export const getGoalPaceStatus = (goal: Goal, currentVal: number) => {
    if (goal.status !== 'em_andamento') return 'neutral';
    
    const now = new Date().getTime();
    const start = new Date(goal.startDate).getTime();
    const end = new Date(goal.deadline).getTime();
    
    if (now >= end) return currentVal >= goal.targetAmount ? 'completed' : 'missed';
    
    const totalTime = end - start;
    const elapsedTime = now - start;
    const timeProgress = elapsedTime / totalTime;
    const valueProgress = currentVal / goal.targetAmount;
    
    // Se a meta é de redução de custos, estar ACIMA do progresso de tempo é RUIM.
    if (goal.businessType === 'reducao_custos') {
        if (valueProgress > timeProgress + 0.1) return 'off_track_high';
        return 'on_track';
    }

    if (valueProgress >= timeProgress * 0.95) return 'on_track';
    if (valueProgress >= timeProgress * 0.7) return 'warning';
    return 'off_track';
};
