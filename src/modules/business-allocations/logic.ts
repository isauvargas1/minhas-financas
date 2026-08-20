
import { Transaction, Goal } from '../../types.ts';
import { PJAllocationBucket, PJAllocationModel, PJBusinessDiagnostic, PJAllocationResult } from './types.ts';
import { contributionAllocation, isInvestmentContribution } from '../investments/semantics.ts';

// Mapeamento de categorias PJ para buckets lógicos
const PJ_CATEGORY_MAP: Record<string, PJAllocationBucket> = {
    // Operacional (Custos Fixos/Variáveis)
    'Moradia': 'operacional', // Aluguel escritório
    'Utilidades': 'operacional',
    'Salários': 'operacional',
    'Impostos': 'operacional',
    'Logística': 'operacional',
    
    // Reserva de Caixa
    'Reserva de Emergência': 'reserva',
    'Reserva de Caixa': 'reserva',
    'Aplicações de Liquidez': 'reserva',
    
    // Reinvestimento (Crescimento)
    'Marketing': 'reinvestimento',
    'Publicidade': 'reinvestimento',
    'Treinamento': 'reinvestimento',
    'Infraestrutura': 'reinvestimento',
    'Ferramentas/SaaS': 'reinvestimento',
    'Software': 'reinvestimento',
    'Equipamentos': 'reinvestimento',
    'Expansão': 'reinvestimento',
    'Pesquisa e Desenvolvimento': 'reinvestimento',
    
    // Investimentos Financeiros
    'Ações': 'financeiro',
    'CDB': 'financeiro',
    'Tesouro Direto': 'financeiro',
    'Fundos': 'financeiro',

    // Dívidas/Crédito
    'Empréstimo': 'dividas',
    'Juros': 'dividas',
    'Parcelado': 'dividas'
};

export const PJ_MODELS: PJAllocationModel[] = [
    { id: 'balanced', name: 'Equilibrado', description: 'Foco em estabilidade e crescimento orgânico.', percentages: { reserva: 10, reinvestimento: 15 } },
    { id: 'aggressive', name: 'Expansão Rápida', description: 'Foco total em reinvestir para escalar.', percentages: { reserva: 5, reinvestimento: 25 } },
    { id: 'defensive', name: 'Segurança Máxima', description: 'Foco em criar colchão de caixa robusto.', percentages: { reserva: 20, reinvestimento: 5 } }
];

export const calculatePJAllocation = (
    transactions: Transaction[],
    model: PJAllocationModel
): PJBusinessDiagnostic => {
    const revenue = transactions.filter(t => t.type === 'receita').reduce((s, t) => s + t.value, 0);
    
    const sums: Record<PJAllocationBucket, number> = {
        operacional: 0,
        reserva: 0,
        reinvestimento: 0,
        financeiro: 0,
        dividas: 0
    };

    transactions.forEach(t => {
        if (t.type === 'receita') return;
        if (t.type === 'investimento' && !isInvestmentContribution(t)) return;
        const bucket = PJ_CATEGORY_MAP[t.category] || 'operacional';
        const value = t.type === 'investimento' ? contributionAllocation(t) : t.value;
        if (value > 0) sums[bucket] += value;
    });

    const netResult = revenue - Object.values(sums).reduce((a, b) => a + b, 0);
    const margin = revenue > 0 ? (netResult / revenue) * 100 : 0;

    const buildResult = (bucket: PJAllocationBucket, label: string, targetPct: number): PJAllocationResult => {
        const val = sums[bucket];
        const pct = revenue > 0 ? (val / revenue) * 100 : 0;
        const targetVal = (revenue * targetPct) / 100;
        
        let status: any = 'healthy';
        if (bucket === 'reserva' || bucket === 'reinvestimento') {
            if (pct < targetPct * 0.7) status = 'critical';
            else if (pct < targetPct) status = 'attention';
        }
        
        return { bucket, label, targetValue: targetVal, actualValue: val, percentageOfRevenue: pct, status };
    };

    const bucketsResults = {
        operacional: buildResult('operacional', 'Operecional', 0),
        reserva: buildResult('reserva', 'Reserva de Caixa', model.percentages.reserva),
        reinvestimento: buildResult('reinvestimento', 'Reinvestimento', model.percentages.reinvestimento),
        financeiro: buildResult('financeiro', 'Inv. Financeiros', 0),
        dividas: buildResult('dividas', 'Dívidas e Juros', 0)
    };

    const totalTargetVal = bucketsResults.reserva.targetValue + bucketsResults.reinvestimento.targetValue;
    const totalActualVal = bucketsResults.reserva.actualValue + bucketsResults.reinvestimento.actualValue;
    const progress = totalTargetVal > 0 ? (totalActualVal / totalTargetVal) * 100 : 0;

    // Gerador de Alertas de CFO
    const alerts: any[] = [];
    if (margin < 10 && revenue > 0) alerts.push({ id: 'pj1', title: 'Margem Apertada', message: `Sua margem de lucro (${margin.toFixed(1)}%) está abaixo da média recomendada para segurança operacional.`, severity: 'warning' });
    if (sums.dividas > revenue * 0.15) alerts.push({ id: 'pj2', title: 'Pressão de Endividamento', message: 'O serviço da dívida está consumindo mais de 15% da sua receita bruta.', severity: 'error' });
    if (bucketsResults.reserva.status === 'critical') alerts.push({ id: 'pj3', title: 'Caixa de Segurança Baixo', message: 'A empresa não está direcionando capital suficiente para a reserva de contingência.', severity: 'error' });
    if (revenue > 0 && sums.operacional > revenue * 0.7) alerts.push({ id: 'pj4', title: 'Custo Operacional Elevado', message: 'Custos operacionais acima de 70% da receita. Avalie eficiência de processos.', severity: 'warning' });

    return {
        revenue,
        operatingExpenses: sums.operacional,
        netResult,
        margin,
        totalTargetValue: totalTargetVal,
        totalActualValue: totalActualVal,
        allocationProgress: progress,
        buckets: bucketsResults,
        alerts,
        // Fixed: changed reinvestimento to reinvestment to match PJBusinessDiagnostic type
        trends: { reinvestment: 'stable', reserve: 'stable', margin: 'up' } // Mock de tendências
    };
};
