
export type PJAllocationBucket = 'operacional' | 'reserva' | 'reinvestimento' | 'financeiro' | 'dividas';

export interface PJAllocationModel {
    id: string;
    name: string;
    description: string;
    percentages: {
        reserva: number;      // Sugerido: 10%
        reinvestimento: number; // Sugerido: 15%
    };
}

export interface PJAllocationResult {
    bucket: PJAllocationBucket;
    label: string;
    targetValue: number;
    actualValue: number;
    percentageOfRevenue: number;
    status: 'healthy' | 'attention' | 'critical';
}

export interface PJBusinessDiagnostic {
    revenue: number;
    operatingExpenses: number;
    netResult: number;
    margin: number;
    totalTargetValue: number;
    totalActualValue: number;
    allocationProgress: number;
    buckets: Record<PJAllocationBucket, PJAllocationResult>;
    alerts: {
        id: string;
        title: string;
        message: string;
        severity: 'info' | 'warning' | 'error';
    }[];
    trends: {
        reinvestment: 'up' | 'down' | 'stable';
        reserve: 'up' | 'down' | 'stable';
        margin: 'up' | 'down' | 'stable';
    };
}
