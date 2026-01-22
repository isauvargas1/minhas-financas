
import { Transaction, Goal } from '../../types.ts';
import { AllocationModel, AllocationDiagnostic, AllocationBucket, AllocationResult } from './types.ts';

// Dicionário padrão de mapeamento (pode ser expandido via config futuramente)
const CATEGORY_MAP: Record<string, AllocationBucket> = {
    'Moradia': 'essenciais',
    'Utilidades': 'essenciais',
    'Alimentação': 'essenciais',
    'Saúde': 'essenciais',
    'Transporte': 'essenciais',
    'Educação': 'educacao',
    'Lazer': 'estilo_vida',
    'Comunicação': 'estilo_vida',
    'Vestuário': 'estilo_vida',
    'Eletrônicos': 'estilo_vida',
    'Móveis': 'estilo_vida',
    'Outros': 'estilo_vida'
};

export const MODELS: AllocationModel[] = [
    {
        id: '70-30',
        name: '70/30 (Padrão)',
        isCustom: false,
        percentages: { essenciais: 55, estilo_vida: 10, educacao: 5, aposentadoria: 10, objetivos: 20 }
    },
    {
        id: '50-30-20',
        name: '50/30/20 (Flexível)',
        isCustom: false,
        percentages: { essenciais: 40, estilo_vida: 10, educacao: 0, aposentadoria: 10, objetivos: 40 }
    }
];

export const calculateAllocation = (
    transactions: Transaction[],
    goals: Goal[],
    model: AllocationModel,
    previousInvestedPercentage: number = 0
): AllocationDiagnostic => {
    const income = transactions.filter(t => t.type === 'receita').reduce((sum, t) => sum + t.value, 0);
    
    const buckets: Record<AllocationBucket, number> = {
        essenciais: 0,
        estilo_vida: 0,
        educacao: 0,
        aposentadoria: 0,
        objetivos: 0
    };

    transactions.forEach(t => {
        if (t.type === 'despesa' || t.type === 'parcelado') {
            const bucket = CATEGORY_MAP[t.category] || 'estilo_vida';
            if (bucket in buckets) buckets[bucket as AllocationBucket] += t.value;
        } else if (t.type === 'investimento') {
            // Se tem meta e a meta é categoria patrimônio/aposentadoria -> Aposentadoria
            // Senão se tem meta -> Objetivos
            // Senão -> Aposentadoria (longo prazo padrão)
            const linkedGoal = goals.find(g => g.id === t.goalId);
            if (linkedGoal?.category === 'patrimonio') {
                buckets.aposentadoria += t.value;
            } else if (t.goalId) {
                buckets.objetivos += t.value;
            } else {
                buckets.aposentadoria += t.value;
            }
        }
    });

    const results: any = {};
    const labels: Record<AllocationBucket, string> = {
        essenciais: 'Essenciais',
        estilo_vida: 'Estilo de Vida',
        educacao: 'Educação',
        aposentadoria: 'Aposentadoria',
        objetivos: 'Objetivos'
    };

    (Object.keys(buckets) as AllocationBucket[]).forEach(key => {
        const targetPct = model.percentages[key];
        const targetVal = (income * targetPct) / 100;
        const actualVal = buckets[key];
        const actualPct = income > 0 ? (actualVal / income) * 100 : 0;
        
        let status: any = 'ok';
        if (['essenciais', 'estilo_vida'].includes(key)) {
            if (actualPct > targetPct * 1.1) status = 'critical';
            else if (actualPct > targetPct) status = 'warning';
        } else {
            // Para educação e investimentos, abaixo do alvo é alerta
            if (actualPct < targetPct * 0.5) status = 'critical';
            else if (actualPct < targetPct) status = 'warning';
            else if (actualPct >= targetPct) status = 'success';
        }

        results[key] = {
            bucket: key,
            label: labels[key],
            targetPercentage: targetPct,
            targetValue: targetVal,
            actualValue: actualVal,
            actualPercentage: actualPct,
            diff: actualVal - targetVal,
            status
        };
    });

    const totalInvested = buckets.aposentadoria + buckets.objetivos;
    const investedPercentage = income > 0 ? (totalInvested / income) * 100 : 0;
    const investmentTarget = model.percentages.aposentadoria + model.percentages.objetivos;

    // Alertas
    const alerts: any[] = [];
    if (results.essenciais.actualPercentage > 55) {
        alerts.push({ id: 'a1', type: 'warning', message: `Seu custo fixo está em ${results.essenciais.actualPercentage.toFixed(1)}%, reduzindo sua capacidade de investir.` });
    }
    if (investedPercentage < investmentTarget) {
        alerts.push({ id: 'a2', type: 'info', message: `Você investiu ${investedPercentage.toFixed(1)}% este mês, abaixo do alvo de ${investmentTarget}%. Avalie reduzir gastos aleatórios.` });
    }
    if (results.educacao.actualValue === 0 && income > 0) {
        alerts.push({ id: 'a3', type: 'info', message: `Não identificamos gastos com Educação. Lembre-se de investir no seu capital intelectual.` });
    }
    if (investedPercentage > investmentTarget) {
        alerts.push({ id: 'a4', type: 'success', message: `Parabéns! Você superou sua meta de investimentos. Considere antecipar parcelas de metas de longo prazo.` });
    }

    const trendDiff = investedPercentage - previousInvestedPercentage;

    return {
        totalIncome: income,
        totalInvested,
        investedPercentage,
        investmentTarget,
        results,
        alerts,
        trend: {
            percentageDiff: Math.abs(trendDiff),
            direction: trendDiff > 0.5 ? 'up' : trendDiff < -0.5 ? 'down' : 'stable'
        }
    };
};
