
export type AllocationBucket = 'essenciais' | 'estilo_vida' | 'educacao' | 'aposentadoria' | 'objetivos';

export interface AllocationModel {
    id: string;
    name: string;
    isCustom: boolean;
    percentages: {
        essenciais: number;
        estilo_vida: number;
        educacao: number;
        aposentadoria: number;
        objetivos: number;
    };
}

export interface AllocationResult {
    bucket: AllocationBucket;
    label: string;
    targetPercentage: number;
    targetValue: number;
    actualValue: number;
    actualPercentage: number;
    diff: number;
    status: 'ok' | 'warning' | 'critical' | 'success';
}

export interface AllocationDiagnostic {
    totalIncome: number;
    totalInvested: number;
    investedPercentage: number;
    investmentTarget: number;
    results: Record<AllocationBucket, AllocationResult>;
    alerts: {
        id: string;
        message: string;
        type: 'info' | 'warning' | 'success';
    }[];
    trend: {
        percentageDiff: number; // vs previous period
        direction: 'up' | 'down' | 'stable';
    };
}
