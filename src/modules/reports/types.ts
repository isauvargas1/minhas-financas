import type {
  CreditCardInstallment,
  CreditCardInvoice,
  CreditCardInvoicePayment,
  CreditCardPurchase,
} from '../credit-cards/domain/types.ts';

export type ReportTimeRange = '7d' | '30d' | '90d' | '12m' | 'ytd' | 'all';

export type ReportType = 'cashflow' | 'category' | 'comparison' | 'heatmap';

export interface CreditCardReportDomainCollectionMeta {
  purchases: number;
  invoices: number;
  installments: number;
  payments: number;
}

export interface CreditCardReportDomainMeta {
  range: ReportTimeRange;
  startDate?: string;
  endDate: string;
  isAllTime: boolean;
  limits: CreditCardReportDomainCollectionMeta;
  truncated: Record<keyof CreditCardReportDomainCollectionMeta, boolean>;
  isTruncated: boolean;
}

export interface CreditCardReportDomainData {
  purchases: CreditCardPurchase[];
  invoices: CreditCardInvoice[];
  installments: CreditCardInstallment[];
  payments: CreditCardInvoicePayment[];
  meta?: CreditCardReportDomainMeta;
}

export interface CreditCardDueBuckets {
  next7Days: number;
  next15Days: number;
  next30Days: number;
}

export interface CreditCardReportIndicator {
  cardId: string;
  cardName: string;
  status: string;

  limitTotal: number;
  limitUsed: number;
  limitAvailable: number;
  utilizationRate: number;

  openInvoiceBalance: number;
  futureCommittedBalance: number;
  overdueAmount: number;

  dueBuckets: CreditCardDueBuckets;

  registeredPaymentsAmount: number;
  reversedPaymentsAmount: number;

  currentInvoiceId?: string;
  currentInvoiceDueDate?: string;
  currentInvoiceStatus?: string;
}

export interface CreditCardExpenseByPeriodItem {
  period: string;
  label: string;
  amount: number;
  count: number;
}

export interface CreditCardExpenseByCardItem {
  cardId: string;
  cardName: string;
  purchaseAmount: number;
  purchaseCount: number;
  paidAmount: number;
  openInvoiceBalance: number;
  futureCommittedBalance: number;
  overdueAmount: number;
  utilizationRate: number;
}

export interface CreditCardExpenseReportViews {
  purchaseCompetence: CreditCardExpenseByPeriodItem[];
  invoicePaymentDate: CreditCardExpenseByPeriodItem[];
  cardAnalytics: CreditCardExpenseByCardItem[];
}

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

/**
 * Natureza do indicador (INV-P2-024).
 *
 * Indicadores de naturezas diferentes apareciam lado a lado sem distinção:
 * "Investimentos" passou a vir das projeções patrimoniais enquanto "Taxa de
 * Poupança" e "Fluxo de Caixa Líquido" continuaram vindo de `transactions`.
 * Somar ou comparar mentalmente esses números leva a conclusões erradas, e
 * nada na tela avisava que eles medem coisas distintas.
 *
 * - `caixa` — dinheiro que entrou ou saiu no período;
 * - `patrimonio` — valor de mercado acumulado, não é fluxo;
 * - `contribuicao` — quanto do caixa foi direcionado a investimento;
 * - `rendimento` — resultado do investimento, realizado ou não;
 * - `indicador` — razão ou percentual derivado dos anteriores.
 */
export type KpiNature =
  | 'caixa'
  | 'patrimonio'
  | 'contribuicao'
  | 'rendimento'
  | 'indicador';

export const KPI_NATURE_LABELS: Record<KpiNature, string> = {
  caixa: 'Caixa',
  patrimonio: 'Patrimônio',
  contribuicao: 'Contribuição',
  rendimento: 'Rendimento',
  indicador: 'Indicador',
};

export interface FinancialKPI {
  id: string;
  label: string;
  description?: string;
  value: number;
  formattedValue: string;
  trend?: 'up' | 'down' | 'stable';
  trendPercentage?: number;
  /**
   * De onde vem o `trend` (INV-P2-046).
   *
   * `sign` significa apenas "o valor é positivo ou negativo" — que é tudo que
   * o cálculo atual produz. Rotular isso como "Alta"/"Baixa" afirmava uma
   * comparação com período anterior que nunca foi feita, e um fluxo de caixa
   * positivo em queda aparecia como "Alta". `period` fica reservado para
   * quando existir comparação real, sempre acompanhada de `trendPercentage`.
   */
  trendBasis?: 'sign' | 'period';
  period: 'mensal' | 'anual' | 'custom';
  /** O que o número mede. Ver `KpiNature`. */
  nature?: KpiNature;
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
  utilizationRate: number;
  riskLevel: 'baixo' | 'moderado' | 'alto' | 'critico';

  creditCardTotalLimit: number;
  creditCardAvailableLimit: number;
  creditCardOpenInvoiceBalance: number;
  creditCardFutureCommittedBalance: number;
  creditCardOverdueAmount: number;
  creditCardDueNext7Days: number;
  creditCardDueNext15Days: number;
  creditCardDueNext30Days: number;
  registeredInvoicePaymentsAmount: number;
  reversedInvoicePaymentsAmount: number;

  creditCardIndicators: CreditCardReportIndicator[];

}


export interface InvestmentOverview {
  source: 'official-v2';
  contributions: number;
  redemptionGross: number;
  redemptionNet: number;
  redeemedPrincipal: number;
  realizedGain: number;
  /** Perda realizada acumulada no período (INV-P1-009). Não-negativa. */
  realizedLoss: number;
  /** Resultado realizado com sinal: `realizedGain − realizedLoss`. */
  realizedResult: number;
  investmentIncome: number;
  fees: number;
  taxes: number;
  cost: number;
  currentValue: number;
  unrealizedGain: number;
  cashImpact: number;
  settledMovementCount: number;
  evolution: Array<{ period: string; currentValue: number }>;
  /** Série indisponível: períodos ainda sem fechamento materializado. */
  evolutionUnavailable: boolean;
  allocations: Array<{
    dimension: 'account' | 'class' | 'asset' | 'goal' | 'risk' | 'liquidity' | 'indexer' | 'purpose';
    label: string;
    items: Array<{ key: string; label: string; amount: number; percentage: number }>;
    truncated: boolean;
  }>;
  reconciliationDifference: number;
  periodsTruncated: boolean;
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
  creditCardIndicators: CreditCardReportIndicator[];
  debtProfile: DebtProfile;
  generatedAt: string;
  periodLabel: string; // ex.: "Últimos 30 dias", "Ano de 2025", etc.
  kpis: FinancialKPI[];
  cashFlow: CashFlowSummary[];
  expenseCategories: ExpenseCategoryBreakdown[];
  investmentOverview?: InvestmentOverview;
  creditCardExpenseReportViews: CreditCardExpenseReportViews;

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
