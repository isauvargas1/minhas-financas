import type { ReportRange, ReportSectionStatus } from './official.ts';

export type ReportTimeRange = '7d' | '30d' | '90d' | '12m' | 'ytd' | 'all';

export type ReportType = 'cashflow' | 'category' | 'comparison' | 'heatmap';

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
  /** Utilização do limite em %, ou `null` sem limite (pontos-base ÷ 100). */
  utilizationRate: number | null;

  /** Próxima fatura a pagar (próxima obrigação não vencida); `null` sem fatura a vencer, nunca 0 fingindo fatura. */
  openInvoiceBalance: number | null;
  futureCommittedBalance: number;
  overdueAmount: number;

  dueBuckets: CreditCardDueBuckets;

  registeredPaymentsAmount: number;
  reversedPaymentsAmount: number;

  currentInvoiceId?: string;
  currentInvoiceDueDate?: string;
  currentInvoiceStatus?: string;
  /** A próxima fatura a pagar é de um ciclo ainda aberto (recebe compras); vem do servidor. */
  currentInvoiceOpenCycle?: boolean;
  /** Crédito de fatura aberta ainda não transportado (informativo; não abate nada). */
  openCreditAmount: number;
}

export interface CreditCardExpenseByPeriodItem {
  period: string;
  label: string;
  amount: number;
  /** `null` quando o relatório oficial não traz a contagem (pagamentos por mês). */
  count: number | null;
}

export interface CreditCardExpenseByCardItem {
  cardId: string;
  cardName: string;
  purchaseAmount: number;
  purchaseCount: number;
  paidAmount: number;
  /** Próxima fatura a pagar; `null` sem fatura a vencer. */
  openInvoiceBalance: number | null;
  futureCommittedBalance: number;
  overdueAmount: number;
  utilizationRate: number | null;
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
  /**
   * Valor de exibição (reais ou %); `null` quando o relatório oficial não
   * entrega número (indisponível, sem permissão, aguardando reconstrução).
   */
  value: number | null;
  /** Texto do valor; "—" quando não há número (o estado vai na `description`). */
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
  /** Recebimentos operacionais realizados do mês. */
  totalIncome: number;
  /** Pagamentos operacionais realizados do mês. */
  totalExpenses: number;
  /** Resultado operacional (recebimentos − pagamentos) do mês. */
  operationalResult: number;
  /** Pagamentos de fatura de cartão do mês (saída de caixa). */
  cardPayments: number;
  /** Fluxo líquido total do mês. */
  netCashFlow: number;
  /** O mês não está inteiro na janela (ponta ou mês corrente). */
  partial: boolean;
}

export interface ExpenseCategoryBreakdown {
  categoryId: string;
  categoryName: string;
  totalAmount: number;
  /** Participação no total de despesas em %; `null` sem base de cálculo. */
  percentageOfTotal: number | null;
}

/**
 * Dívidas e cartões do relatório oficial. Valores só são válidos quando o
 * bloco correspondente tem números (`ReportViewModel.blocks`); fora disso os
 * campos valem 0 e NÃO devem ser exibidos.
 */
export interface DebtProfile {
  /** Obrigações de cartão em aberto (faturas abertas e fechadas a pagar). */
  totalCreditCardDebt: number;
  /** Saldo devedor de empréstimos tomados. Recebíveis e concedidos não são dívida. */
  totalLoans: number;
  /** Utilização do limite de todos os cartões ativos, em %; `null` sem limite. */
  utilizationRate: number | null;

  creditCardLimitUsed: number;
  creditCardTotalLimit: number;
  creditCardAvailableLimit: number;
  creditCardOpenInvoiceBalance: number;
  creditCardFutureCommittedBalance: number;
  creditCardOverdueAmount: number;
  /** Atraso de cartões arquivados (fora da tabela de consumo dos Gráficos). */
  creditCardArchivedOverdueAmount: number;
  /** Crédito de faturas abertas a compensar no fechamento (informativo; não abate o futuro). */
  creditCardOpenCreditAmount: number;
  creditCardDueNext7Days: number;
  creditCardDueNext15Days: number;
  creditCardDueNext30Days: number;
  registeredInvoicePaymentsAmount: number;
  reversedInvoicePaymentsAmount: number;

  creditCardIndicators: CreditCardReportIndicator[];
}

/** Investimentos do relatório oficial (D-37.5), em reais de exibição. */
export interface InvestmentOverview {
  contributions: number;
  redeemedPrincipal: number;
  realizedGain: number;
  realizedLoss: number;
  /** Resultado realizado com sinal: ganho − perda. */
  realizedResult: number;
  fees: number;
  taxes: number;
  /** `null`: sem permissão para o patrimônio (viewer). */
  cost: number | null;
  currentValue: number | null;
  unrealizedGain: number | null;
  /** Fechamento do valor atual por mês da janela; `null` para o viewer. */
  evolution: Array<{ period: string; currentValue: number }> | null;
  /** Só em "tudo": patrimônio atual − último fechamento da série, em centavos. */
  reconciliationDifferenceCents: number | null;
}

// --- PHASE 4: Business Specifics ---
export interface ClientMetric {
  clientId: string;
  clientName: string;
  totalValue: number;
  /** `null`: participação indisponível (sem total positivo). */
  percentage: number | null;
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

/** Blocos do relatório oficial que a interface apresenta. */
export type ReportBlockKey =
  | 'accounts'
  | 'cash'
  | 'kpis'
  | 'series'
  | 'categories'
  | 'cards'
  | 'debts'
  | 'investments'
  | 'alerts'
  | 'topClients';

/**
 * Estado de apresentação de um bloco (D-37.10). Só `hasNumbers` autoriza
 * exibir valores; `message` ocupa o lugar dos números e `note` acompanha
 * números parciais.
 */
export interface ReportBlockView {
  status: ReportSectionStatus;
  hasNumbers: boolean;
  /** Texto no lugar dos números (indisponível, aguardando reconstrução). */
  message: string | null;
  /** Aviso de cobertura parcial exibido junto dos números (amostra, teto). */
  note: string | null;
}

export type ReportCoverage = Record<ReportBlockKey, ReportBlockView>;

/** O que as telas precisam além do snapshot: estados por bloco e notas fixas. */
export interface ReportViewModel {
  blocks: ReportCoverage;
  /** O papel do ator lê o domínio de investimentos. */
  investmentsPermitted: boolean;
  /** Linhas da tabela de fluxo mensal: no máximo os 12 meses mais recentes. */
  cashFlowRows: CashFlowSummary[];
  cashFlowNote: string | null;
  /** Nota fixa D-37.3 sobre compra no cartão × pagamento da fatura. */
  cardsNote: string;
  purchaseSeriesNote: string | null;
  topClientsNote: string | null;
  investmentNote: string | null;
  /** Texto objetivo de "Leitura dos indicadores" (sem IA e sem limiar). */
  insight: string;
}

export interface FinancialReportSnapshot {
  /** Tipo do workspace do relatório (PF ou PJ). */
  workspaceType?: 'PF' | 'PJ';
  /** Estado de cada bloco; ausente = tudo completo. */
  coverage?: ReportCoverage;
  creditCardIndicators: CreditCardReportIndicator[];
  debtProfile: DebtProfile;
  generatedAt: string;
  periodLabel: string; // ex.: "Últimos 30 dias", "Ano de 2025", etc.
  /** Faixa do relatório (contrato oficial); é o que a análise por IA envia ao servidor. */
  range: ReportRange;
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
