
export type ReportTimeRange = '7d' | '30d' | '90d' | '12m' | 'ytd' | 'all';

export type ReportType = 'cashflow' | 'category' | 'comparison' | 'heatmap';

export interface ChartDataPoint {
    label: string;
    value: number;
    color?: string;
    secondaryValue?: number; // For comparisons (e.g., previous period)
}

export interface ReportSummary {
    totalIncome: number;
    totalExpense: number;
    netResult: number;
    savingsRate: number;
}

export interface CategoryMetric {
    id: string;
    name: string;
    value: number;
    percentage: number;
    color: string;
    transactionCount: number;
}

// --- PHASE 2: Domain Models ---

export interface FinancialKPI {
  id: string;
  label: string;
  description?: string;
  value: number;
  formattedValue: string;
  trend?: 'up' | 'down' | 'stable';
  trendPercentage?: number;
  period: 'mensal' | 'anual' | 'custom';
}

export interface CashFlowSummary {
  month: string; // '2025-03'
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  savingsRate: number; // % da renda que sobra
}

export interface ExpenseCategoryBreakdown {
  categoryId: string;
  categoryName: string;
  totalAmount: number;
  percentageOfTotal: number;
}

export interface DebtProfile {
  totalCreditCardDebt: number;
  totalLoans: number;
  totalInstallments: number;
  utilizationRate: number; // % do limite de cartão utilizado
  riskLevel: 'baixo' | 'moderado' | 'alto' | 'critico';
}

export interface InvestmentOverview {
  totalInvested: number;
  estimatedReturnMonthly: number;
  estimatedReturnYearly: number;
  allocationByType: {
    type: string; // renda fixa, variável, etc
    amount: number;
    percentage: number;
  }[];
}

// --- PHASE 4: Business Specifics ---
export interface ClientMetric {
    clientId: string;
    clientName: string;
    totalValue: number;
    percentage: number;
}

export interface ReceivableStatusMetric {
    status: string; // 'Em Dia', 'Atrasado', 'Pago'
    count: number;
    totalValue: number;
    color: string;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface FinancialAlert {
  id: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  createdAt: string;
  relatedKpiId?: string;
  relatedCategoryId?: string;
}

export interface FinancialReportSnapshot {
  generatedAt: string;
  periodLabel: string; // ex.: "Últimos 30 dias", "Ano de 2025", etc.
  kpis: FinancialKPI[];
  cashFlow: CashFlowSummary[];
  expenseCategories: ExpenseCategoryBreakdown[];
  debtProfile: DebtProfile;
  investmentOverview?: InvestmentOverview;
  
  // Business Specifics (Optional)
  topClients?: ClientMetric[];
  receivablesStatus?: ReceivableStatusMetric[];

  alerts: FinancialAlert[];
}

export interface FinanceAIQuestion {
  id?: string;
  userId?: string;
  question: string;
  createdAt?: string;
}

export interface FinanceAIAnswer {
  id?: string;
  questionId?: string;
  answer: string;
  createdAt?: string;
  // opcional: referências aos dados usados
  usedKPIs?: string[];
  usedPeriod?: string;
}
