import {z} from "zod";

import {workspaceIdSchema} from "../shared/ids";

/**
 * Contrato do relatório financeiro autoritativo (P5-C1, D-37).
 *
 * "Um indicador financeiro, uma definição, uma fonte autoritativa": o
 * Dashboard e os Relatórios leem os mesmos números desta callable, calculados
 * no servidor sobre as projeções oficiais e os domínios autoritativos. O
 * cliente não recalcula nenhum indicador nem substitui dado ausente por zero.
 *
 * - Valores monetários em centavos inteiros (BRL); razões em pontos-base
 *   (1% = 100), calculadas com BigInt. Nenhum número em ponto flutuante.
 * - Período resolvido no servidor, em datas civis de `America/Sao_Paulo`,
 *   com as duas pontas **inclusivas** e a data de referência (hoje) explícita.
 * - Cada bloco traz a própria cobertura (`ReportSectionStatus`): exato, zero
 *   verdadeiro, indisponível, sem permissão, amostra, truncado ou aguardando
 *   reconstrução. Só `exact` e `zero` são números completos.
 */

export const REPORT_PRESETS =
  ["7d", "30d", "90d", "12m", "ytd", "all"] as const;
export type ReportPreset = typeof REPORT_PRESETS[number];

export const REPORT_SECTIONS = [
  "accounts",
  "cash",
  "kpis",
  "series",
  "categories",
  "cards",
  "debts",
  "investments",
  "alerts",
] as const;
export type ReportSection = typeof REPORT_SECTIONS[number];

const monthKeySchema = z.string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês: use o formato AAAA-MM.");

export const reportRangeSchema = z.discriminatedUnion("kind", [
  z.object({kind: z.literal("preset"), preset: z.enum(REPORT_PRESETS)})
    .strict(),
  z.object({kind: z.literal("month"), month: monthKeySchema}).strict(),
]);
export type ReportRange = z.infer<typeof reportRangeSchema>;

export const getFinancialReportPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  range: reportRangeSchema,
  /** Blocos pedidos; ausente = todos. Repetição é recusada. */
  sections: z.array(z.enum(REPORT_SECTIONS))
    .min(1, "Informe ao menos um bloco do relatório.")
    .max(REPORT_SECTIONS.length)
    .refine((items) => new Set(items).size === items.length,
      "Bloco do relatório repetido.")
    .optional(),
}).strict();

export type GetFinancialReportPayload = z.infer<
  typeof getFinancialReportPayloadSchema
>;

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
  | "exact"
  | "zero"
  | "unavailable"
  | "sample"
  | "truncated"
  | "rebuild_needed"
  | "not_requested";

export interface ReportSectionResult<T> {
  status: ReportSectionStatus;
  /** Motivo técnico estável (não é texto de interface). */
  reason?: string;
  /** `null` quando o bloco não tem número confiável para entregar. */
  data: T | null;
}

export interface ReportPeriod {
  range: ReportRange;
  /** Primeira data civil incluída; `null` em "tudo" sem nenhum dado. */
  startDate: string | null;
  /** Última data civil incluída (nunca depois de `referenceDate`). */
  endDate: string;
  boundaries: "inclusive";
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
  /**
   * Por que a taxa é `null`: `no_receipts` (recebimentos ≤ 0 na janela) ou
   * `investments_unavailable` (fluxos de investimento sem número confiável).
   * `null` quando a taxa tem valor.
   */
  netContributionRateReason: "no_receipts" | "investments_unavailable" | null;
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
  granularity: "month";
  /**
   * `true` só em "tudo" com mais de 120 meses: a série traz apenas os meses
   * com movimento (os totais continuam exatos).
   */
  sparse: boolean;
  points: SeriesPoint[];
}

export type CategoryClassification =
  | "catalog"
  | "uncategorized"
  | "receivables"
  | "split";

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
  cycleStatus: "open" | "closed";
  paymentStatus: "unpaid" | "partial" | "paid";
  payableCents: number;
  /**
   * Ciclo já fechado (gravado ou com o fechamento alcançado hoje em São
   * Paulo, `isCycleEffectivelyClosed` da P4-A). `false` só para a fatura do
   * ciclo aberto, que ainda recebe compras (M2).
   */
  effectivelyClosed: boolean;
}

export interface CardItem {
  cardId: string;
  name: string;
  status: "active" | "archived";
  limitTotalCents: number;
  limitUsedCents: number;
  limitAvailableCents: number;
  /** Usado ÷ limite; `null` sem limite positivo ou com cartão arquivado. */
  utilizationBasisPoints: number | null;
  /**
   * Fatura atual (P5-C1.1): a próxima obrigação — entre as faturas com saldo
   * que não estão em atraso, a de menor vencimento (empate: competência mais
   * antiga). `null` sem fatura a vencer; nunca uma fatura em atraso.
   */
  currentInvoice: CardInvoiceRef | null;
  /** Saldo pendente do cartão = atraso + fatura atual + futuro. */
  outstandingCents: number;
  /** Futuro: faturas com saldo, fora de atraso, depois da fatura atual. */
  futureCommittedCents: number;
  /** Atraso: fechadas com saldo e vencimento antes de hoje (P4-A). */
  overdueCents: number;
  /**
   * Crédito ainda não aplicado (M3): Σ de `-totalCents` das faturas abertas
   * com total negativo. A P4-A o transporta para a fatura aberta seguinte no
   * fechamento; até lá é só informativo — não é pagamento, não abate outra
   * fatura e não entra em pendente, atraso, atual nem futuro.
   */
  openCreditCents: number;
  dueNext7Cents: number;
  dueNext15Cents: number;
  dueNext30Cents: number;
  purchasesCents: number;
  purchaseCount: number;
  paidCents: number;
  reversedCents: number;
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
    /** Σ `openCreditCents` dos cartões (informativo, M3). */
    openCreditCents: number;
  };
  limits: {
    totalCents: number;
    usedCents: number;
    availableCents: number;
    /** Usado ÷ limite dos cartões ativos; `null` sem limite positivo. */
    utilizationBasisPoints: number | null;
  };
  /**
   * Por cartão (P5-C1.1): os ativos e os arquivados com saldo pendente (a
   * P4-A aceita estornar pagamento de cartão arquivado). Σ `outstandingCents`
   * = `obligations.totalOutstandingCents` e Σ `overdueCents` =
   * `obligations.overdueCents`, no mesmo instantâneo; fora disso o bloco vem
   * `unavailable`.
   */
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
 * nos parciais). A mesma matriz das Rules: o agregado mensal é de todo membro
 * ativo, viewer incluído (P4-D, D-15 — o card "Investimentos" do Dashboard);
 * o patrimônio só de quem lê o domínio (owner, admin, member). Para o viewer,
 * `patrimony`, `evolution` (fechamentos mensais são patrimônio) e
 * `reconciliationDifferenceCents` vêm `null` e o resumo nem é lido; os
 * fluxos da janela vão para todos.
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
  /**
   * Fechamento do valor atual por mês da janela (mês corrente: até hoje).
   * É patrimônio: `null` para quem não lê o patrimônio (viewer), como
   * `patrimony`.
   */
  evolution: Array<{month: string; closingValueCents: number}> | null;
  /**
   * Só em "tudo": patrimônio atual − último fechamento da série. Diferença
   * diferente de zero indica deriva entre as projeções do domínio.
   */
  reconciliationDifferenceCents: number | null;
}

export type ReportAlertCode =
  | "negative_account_balance"
  | "negative_operational_result"
  | "overdue_card_invoices"
  | "card_invoices_due_soon"
  | "overdue_borrowed_loans"
  | "overdue_receivables"
  | "insufficient_base"
  | "projection_rebuild_needed";

export interface ReportAlert {
  code: ReportAlertCode;
  severity: "info" | "warning" | "critical";
  /** Valores objetivos do fato (centavos, contagens). */
  values: Record<string, number>;
}

export interface FinancialReport {
  schemaVersion: 1;
  workspaceType: "PF" | "PJ";
  generatedAt: string;
  timezone: "America/Sao_Paulo";
  currency: "BRL";
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
