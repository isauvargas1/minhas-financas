/**
 * Contrato cliente do relatório financeiro autoritativo (P5-C1, D-37).
 *
 * Módulo puro: não importa o SDK. `officialApi.ts` o liga ao `httpsCallable`;
 * os testes, a um `invoke` falso. Os tipos abaixo são cópia fiel de
 * `functions/src/reports/contract.ts` (a única fonte do contrato): valores em
 * centavos inteiros (BRL) e razões em pontos-base (1% = 100). O cliente só
 * formata — não recalcula nenhum indicador nem troca dado ausente por zero.
 */

export const REPORT_PRESETS =
  ['7d', '30d', '90d', '12m', 'ytd', 'all'] as const;
export type ReportPreset = typeof REPORT_PRESETS[number];

export const REPORT_SECTIONS = [
  'accounts',
  'cash',
  'kpis',
  'series',
  'categories',
  'cards',
  'debts',
  'investments',
  'alerts',
] as const;
export type ReportSection = typeof REPORT_SECTIONS[number];

export type ReportRange =
  | {kind: 'preset'; preset: ReportPreset}
  | {kind: 'month'; month: string};

export interface GetFinancialReportPayload {
  workspaceId: string;
  range: ReportRange;
  /** Blocos pedidos; ausente = todos. */
  sections?: ReportSection[];
}

/**
 * Cobertura de um bloco.
 *
 * - `exact`: completo e exato.
 * - `zero`: completo e exato, sem nenhum movimento (zero verdadeiro).
 * - `unavailable`: a fonte não cobre o pedido (`reason` diz por quê).
 * - `sample`: número calculado sobre uma amostra limitada, nunca o total.
 * - `truncated`: a leitura atingiu o teto; o número é parcial.
 * - `rebuild_needed`: a projeção está marcada para reconstrução ou falhou na
 *   conferência de paridade; nenhum número é entregue.
 * - `not_requested`: o bloco não foi pedido.
 */
export type ReportSectionStatus =
  | 'exact'
  | 'zero'
  | 'unavailable'
  | 'sample'
  | 'truncated'
  | 'rebuild_needed'
  | 'not_requested';

export interface ReportSectionResult<T> {
  status: ReportSectionStatus;
  /** Motivo técnico estável (não é texto de interface). */
  reason?: string;
  /** `null` quando o bloco não tem número confiável para entregar. */
  data: T | null;
}

export interface ReportPeriod {
  range: ReportRange;
  /** Primeira data civil incluída; `null` em 'tudo' sem nenhum dado. */
  startDate: string | null;
  /** Última data civil incluída (nunca depois de `referenceDate`). */
  endDate: string;
  boundaries: 'inclusive';
  /** Dias civis da janela, contando as duas pontas; 0 em mês futuro. */
  dayCount: number;
  /** Mês pedido ainda não começou: nada realizado por definição. */
  future: boolean;
}

export interface AccountsReport {
  totalBalanceCents: number;
  accountCount: number;
  negativeAccountCount: number;
}

export interface CashReport {
  receiptsCents: number;
  paymentsCents: number;
  operationalResultCents: number;
  financial: {
    incomeCents: number;
    expenseCents: number;
    resultCents: number;
  };
  patrimonial: {
    investmentOutflowCents: number;
    investmentInflowCents: number;
    loanPrincipalInflowCents: number;
    loanPrincipalOutflowCents: number;
  };
  cardPaymentsCents: number;
  netFlowCents: number;
  transactionCount: number;
}

export interface KpiReport {
  /** Resultado operacional ÷ recebimentos; `null` com recebimentos ≤ 0. */
  operationalMarginBasisPoints: number | null;
  /**
   * Aportes líquidos ÷ recebimentos operacionais; pode ser negativa e passar
   * de 100%. `null` quando indisponível; o motivo vem em
   * `netContributionRateReason`.
   */
  netContributionRateBasisPoints: number | null;
  netContributionRateReason: 'no_receipts' | 'investments_unavailable' | null;
}

export interface SeriesPoint {
  month: string;
  startDate: string;
  endDate: string;
  /** O mês não está inteiro na janela (ponta ou mês corrente). */
  partial: boolean;
  receiptsCents: number;
  paymentsCents: number;
  operationalResultCents: number;
  /** Pagamentos de fatura de cartão no recorte (visão de caixa). */
  cardPaymentsCents: number;
  netFlowCents: number;
}

export interface SeriesReport {
  granularity: 'month';
  /**
   * `true` só em 'tudo' com mais de 120 meses: a série traz apenas os meses
   * com movimento (os totais continuam exatos).
   */
  sparse: boolean;
  points: SeriesPoint[];
}

export type CategoryClassification =
  | 'catalog'
  | 'uncategorized'
  | 'receivables'
  | 'split';

export interface CategoryItem {
  categoryKey: string;
  categoryId: string | null;
  classification: CategoryClassification;
  /** Nome atual do catálogo; `null` para as classificações sem catálogo. */
  name: string | null;
  amountCents: number;
  /** Participação no total do lado (despesa ou receita), em pontos-base. */
  shareBasisPoints: number | null;
  transactionCount: number;
}

export interface CategoriesReport {
  expense: CategoryItem[];
  income: CategoryItem[];
}

export interface CardInvoiceRef {
  invoiceId: string;
  competenceMonth: string;
  dueDate: string;
  cycleStatus: 'open' | 'closed';
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  payableCents: number;
  /**
   * Servidor: ciclo já fechado (gravado ou com o fechamento alcançado hoje em
   * São Paulo). Só com `cycleStatus === 'open'` e `effectivelyClosed === false`
   * o ciclo ainda recebe compras ("ciclo aberto").
   */
  effectivelyClosed: boolean;
}

export interface CardItem {
  cardId: string;
  name: string;
  status: 'active' | 'archived';
  limitTotalCents: number;
  limitUsedCents: number;
  limitAvailableCents: number;
  /** `null` sem limite positivo ou com cartão arquivado (limite fora de uso). */
  utilizationBasisPoints: number | null;
  /**
   * Próxima fatura a pagar: a próxima obrigação — entre as faturas com saldo que
   * não estão em atraso, a de menor vencimento. `null` sem fatura a vencer.
   */
  currentInvoice: CardInvoiceRef | null;
  /** Saldo pendente do cartão = atraso + próxima fatura a pagar + futuro. */
  outstandingCents: number;
  /** Futuro: faturas com saldo, fora de atraso, depois da próxima fatura a pagar. */
  futureCommittedCents: number;
  /** Atraso: fechadas com saldo e vencimento antes de hoje. */
  overdueCents: number;
  dueNext7Cents: number;
  dueNext15Cents: number;
  dueNext30Cents: number;
  purchasesCents: number;
  purchaseCount: number;
  paidCents: number;
  reversedCents: number;
  /**
   * Crédito ainda não transportado: Σ de `-totalCents` das faturas abertas com
   * total negativo. Informativo; não entra em pendente, atraso, próxima fatura
   * nem futuro, e não muda limite nem caixa.
   */
  openCreditCents: number;
}

export interface CardsReport {
  /** Visão de consumo: compras pela data da compra, líquidas de estorno. */
  purchases: {netCents: number; count: number};
  /** Visão de caixa: pagamentos de fatura na janela (saída de caixa). */
  payments: {paidCents: number; reversedCents: number; netCents: number};
  obligations: {
    openCyclesCents: number;
    closedUnpaidCents: number;
    overdueCents: number;
    overdueCount: number;
    partiallyPaidCount: number;
    partiallyPaidRemainingCents: number;
    dueNext7Cents: number;
    dueNext15Cents: number;
    dueNext30Cents: number;
    totalOutstandingCents: number;
    /** Σ `openCreditCents` dos cartões (informativo; não abate o futuro). */
    openCreditCents: number;
  };
  limits: {
    totalCents: number;
    usedCents: number;
    availableCents: number;
    /** Usado ÷ limite dos cartões ativos (servidor); `null` sem limite positivo. */
    utilizationBasisPoints: number | null;
  };
  /** Ativos e arquivados com saldo pendente; Σ fecha com `obligations`. */
  cards: CardItem[];
  /**
   * Compras por mês da compra, líquidas de estorno. Cobre no máximo os 36
   * últimos meses da janela; `purchaseSeriesStartMonth` diz onde começa
   * (`null` = a janela inteira).
   */
  purchaseSeries: Array<{month: string; netCents: number; count: number}>;
  purchaseSeriesStartMonth: string | null;
}

export interface LoanBucket {
  balanceCents: number;
  count: number;
  overdueBalanceCents: number;
  overdueCount: number;
}

/**
 * Ranking de clientes pelo valor original dos recebíveis não cancelados,
 * numa amostra dos 500 vencimentos mais recentes (`sample` quando a amostra
 * não cobre todos).
 */
export interface TopClientItem {
  clientId: string;
  name: string | null;
  amountCents: number;
  shareBasisPoints: number | null;
}

export interface DebtsReport {
  /** Dívida: saldo devedor de empréstimos tomados. */
  loansBorrowed: LoanBucket;
  /** Não é dívida: saldo a receber de empréstimos concedidos. */
  loansLent: LoanBucket;
  /** Obrigações de cartão (as mesmas do bloco de cartões, contadas uma vez). */
  cardObligationsCents: number | null;
  /** Não é dívida: recebíveis comerciais em aberto. */
  receivables: {
    openCents: number;
    openCount: number;
    overdueCents: number;
    overdueCount: number;
    dueNext30Cents: number;
    receivedCents: number;
    receivedCount: number;
  };
  topClients: ReportSectionResult<TopClientItem[]>;
}

/**
 * Investimentos (D-37.5), só do domínio de investimentos: patrimônio atual
 * (`investment_summaries/current`) e fluxos da janela
 * (`investment_report_periods`: total do mês nos meses inteiros, `daily`
 * nos parciais). Fluxos e evolução vão a todo membro (agregado mensal legível
 * por todos, D-15); o patrimônio só a quem lê o domínio — para o viewer,
 * `patrimony` e `reconciliationDifferenceCents` vêm `null`.
 */
export interface InvestmentsReport {
  patrimony: {
    currentValueCents: number;
    costCents: number;
    unrealizedResultCents: number;
  } | null;
  flows: {
    contributionsCents: number;
    redemptionsPrincipalCents: number;
    netContributionsCents: number;
    realizedGainCents: number;
    realizedLossCents: number;
    realizedResultCents: number;
    feesCents: number;
    taxCents: number;
  };
  /** Fechamento do valor atual por mês da janela (mês corrente: até hoje). */
  /** Fechamentos mensais (patrimônio): `null` para o viewer, como `patrimony`. */
  evolution: Array<{month: string; closingValueCents: number}> | null;
  /**
   * Só em 'tudo': patrimônio atual − último fechamento da série. Diferença
   * diferente de zero indica deriva entre as projeções do domínio.
   */
  reconciliationDifferenceCents: number | null;
}

export type ReportAlertCode =
  | 'negative_account_balance'
  | 'negative_operational_result'
  | 'overdue_card_invoices'
  | 'card_invoices_due_soon'
  | 'overdue_borrowed_loans'
  | 'overdue_receivables'
  | 'insufficient_base'
  | 'projection_rebuild_needed';

export interface ReportAlert {
  code: ReportAlertCode;
  severity: 'info' | 'warning' | 'critical';
  /** Valores objetivos do fato (centavos, contagens). */
  values: Record<string, number>;
}

export interface FinancialReport {
  schemaVersion: 1;
  workspaceType: 'PF' | 'PJ';
  generatedAt: string;
  timezone: 'America/Sao_Paulo';
  currency: 'BRL';
  /** Hoje, no fuso oficial: a última data que pode ter fato realizado. */
  referenceDate: string;
  period: ReportPeriod;
  /** `investments`: lê o patrimônio do domínio de investimentos. */
  permissions: {investments: boolean};
  accounts: ReportSectionResult<AccountsReport>;
  cash: ReportSectionResult<CashReport>;
  kpis: ReportSectionResult<KpiReport>;
  series: ReportSectionResult<SeriesReport>;
  categories: ReportSectionResult<CategoriesReport>;
  cards: ReportSectionResult<CardsReport>;
  debts: ReportSectionResult<DebtsReport>;
  investments: ReportSectionResult<InvestmentsReport>;
  alerts: ReportSectionResult<{items: ReportAlert[]}>;
}

export const REPORT_CALLABLES = ['getFinancialReport'] as const;
export type ReportCallableName = (typeof REPORT_CALLABLES)[number];

export type ReportInvoke = <TResult>(
  name: ReportCallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

export const createReportCallables = (invoke: ReportInvoke) => ({
  getFinancialReport: (payload: GetFinancialReportPayload) =>
    invoke<FinancialReport>('getFinancialReport', {
      workspaceId: payload.workspaceId,
      range: payload.range,
      // `sections` ausente = todos os blocos; o backend recusa lista vazia.
      ...(payload.sections ? {sections: payload.sections} : {}),
    }),
} satisfies Record<ReportCallableName, (...args: never[]) => Promise<unknown>>);

export const REPORT_LOAD_ERROR_MESSAGE =
  'Não foi possível carregar o relatório. Tente novamente.';

/**
 * Traduz o erro da callable para o texto da interface (pt-BR). Só a mensagem
 * que o backend escreveu chega à tela; o texto padrão do SDK (inglês) nunca.
 */
export const reportErrorMessage = (error: unknown): string => {
  const value = error as {code?: unknown} | null;
  const code = typeof value?.code === 'string' ?
    value.code.replace(/^functions\//, '') : '';
  switch (code) {
    case 'permission-denied':
      return 'Você não tem permissão para ver o relatório deste espaço.';
    case 'failed-precondition': {
      // Limite de frequência, workspace arquivado, conta suspensa: o kernel
      // responde em pt-BR e o texto chega como está.
      const message = (error as {message?: unknown} | null)?.message;
      return typeof message === 'string' && message.trim()
        ? message
        : REPORT_LOAD_ERROR_MESSAGE;
    }
    default:
      return REPORT_LOAD_ERROR_MESSAGE;
  }
};
