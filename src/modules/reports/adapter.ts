import type {
    CardsReport,
    CategoryItem,
    DebtsReport,
    FinancialReport,
    InvestmentsReport,
    ReportAlert,
    ReportSectionResult,
} from './official.ts';
import {
    basisPointsToDisplay,
    centsToDisplay,
    formatBasisPoints,
    formatCents,
} from './format.ts';
import { rangeLabel } from './range.ts';
import type {
    CashFlowSummary,
    ClientMetric,
    CreditCardExpenseByCardItem,
    CreditCardExpenseByPeriodItem,
    CreditCardExpenseReportViews,
    CreditCardReportIndicator,
    DebtProfile,
    ExpenseCategoryBreakdown,
    FinancialAlert,
    FinancialKPI,
    FinancialReportSnapshot,
    InvestmentOverview,
    ReceivableStatusMetric,
    ReportBlockKey,
    ReportBlockView,
    ReportCoverage,
    ReportViewModel,
} from './types.ts';

/**
 * Relatório oficial (DTO do backend) → modelos das telas (P5-C1, D-37).
 *
 * Módulo puro. Os valores chegam em centavos inteiros e razões em
 * pontos-base; aqui só se formata e se organiza para a tela. Nenhum
 * indicador é recalculado e dado ausente nunca vira zero: o bloco sem número
 * (indisponível, sem permissão, aguardando reconstrução) vira texto de estado
 * (`ReportBlockView`) e os campos numéricos correspondentes ficam fora da
 * tela. As únicas somas feitas aqui são de inteiros já entregues pelo
 * backend, dentro do mesmo bloco (cartões e recebíveis), para a apresentação.
 */

export const REPORT_MESSAGES = {
    unavailable: 'Indisponível no momento.',
    transient: 'Indisponível no momento. Tente novamente em instantes.',
    inconsistent: 'Indisponível: há dados inconsistentes que impedem o cálculo.',
    sourceLimit: 'Indisponível: o volume de dados excede o limite desta consulta.',
    patrimonyForbidden: 'Sem permissão para ver o patrimônio investido.',
    investmentsUnavailable: 'Indisponível: dados de investimentos indisponíveis no momento.',
    rebuild: 'Aguardando reconstrução dos totais.',
    truncated: 'Parcial: limite de leitura atingido.',
    partialSources: 'Parcial: alguns dados estão indisponíveis.',
    sample: 'Valores calculados sobre uma amostra, não sobre o total.',
    empty: 'Sem movimentação no período.',
    noReceipts: 'Indisponível: sem recebimentos no período.',
    cardsNote: 'Compras no cartão aparecem na visão de consumo; o pagamento da fatura é a saída de caixa.',
    topClientsSample: 'Ranking calculado sobre os 500 vencimentos mais recentes.',
    cashFlowLimit: 'Exibindo os 12 meses mais recentes do período.',
    loading: 'Carregando…',
    noValue: '—',
} as const;

/** Linhas da tabela de fluxo mensal. */
export const CASH_FLOW_TABLE_LIMIT = 12;

const withNumbers = (note: string | null = null): ReportBlockView =>
    ({ status: 'exact', hasNumbers: true, message: null, note });

const withoutNumbers = (
    status: ReportBlockView['status'],
    message: string,
): ReportBlockView => ({ status, hasNumbers: false, message, note: null });

/**
 * Motivo estável do servidor → texto do bloco indisponível (P5-C2 L-5). Só a
 * falha passageira de leitura convida a tentar de novo; dado inconsistente e
 * limite da consulta não mudam com nova tentativa. Motivo ausente ou
 * desconhecido fica com o texto neutro. O motivo técnico nunca é exibido.
 */
const UNAVAILABLE_REASON_MESSAGES: Readonly<Record<string, string>> = {
    temporarily_unavailable: REPORT_MESSAGES.transient,
    invoice_document_invalid: REPORT_MESSAGES.inconsistent,
    invoice_classification_parity: REPORT_MESSAGES.inconsistent,
    card_document_invalid: REPORT_MESSAGES.inconsistent,
    balance_out_of_range: REPORT_MESSAGES.inconsistent,
    card_limit_exceeded: REPORT_MESSAGES.sourceLimit,
    due_window_exceeded: REPORT_MESSAGES.sourceLimit,
    too_many_periods: REPORT_MESSAGES.sourceLimit,
};

const unavailableMessage = (reason: string | undefined): string =>
    (reason !== undefined && Object.hasOwn(UNAVAILABLE_REASON_MESSAGES, reason)
        ? UNAVAILABLE_REASON_MESSAGES[reason]
        : REPORT_MESSAGES.unavailable);

/** Estado de apresentação de um bloco do DTO. */
export const blockViewOf = <T>(
    section: ReportSectionResult<T> | undefined,
): ReportBlockView => {
    if (!section) return withoutNumbers('not_requested', REPORT_MESSAGES.unavailable);
    const hasData = section.data !== null && section.data !== undefined;
    switch (section.status) {
        case 'exact':
        case 'zero':
            return hasData
                ? { ...withNumbers(), status: section.status }
                : withoutNumbers('unavailable', REPORT_MESSAGES.unavailable);
        case 'sample':
            return hasData
                ? { ...withNumbers(REPORT_MESSAGES.sample), status: 'sample' }
                : withoutNumbers('unavailable', REPORT_MESSAGES.unavailable);
        case 'truncated':
            return hasData
                ? {
                    ...withNumbers(section.reason === 'partial_sources'
                        ? REPORT_MESSAGES.partialSources
                        : REPORT_MESSAGES.truncated),
                    status: 'truncated',
                }
                : withoutNumbers('unavailable', REPORT_MESSAGES.unavailable);
        case 'rebuild_needed':
            return withoutNumbers('rebuild_needed', REPORT_MESSAGES.rebuild);
        case 'unavailable':
            return withoutNumbers('unavailable', unavailableMessage(section.reason));
        case 'not_requested':
        default:
            return withoutNumbers(section.status, REPORT_MESSAGES.unavailable);
    }
};

/** Dados do bloco só quando há números (completos ou parciais sinalizados). */
const numbersOf = <T>(
    section: ReportSectionResult<T> | undefined,
    view: ReportBlockView,
): T | null => (view.hasNumbers && section ? section.data : null);

/** Texto para lista sem itens: estado do bloco ou "sem movimentação". */
export const blockEmptyText = (view: ReportBlockView): string =>
    view.hasNumbers
        ? REPORT_MESSAGES.empty
        : view.message ?? REPORT_MESSAGES.unavailable;

const stateText = (view: ReportBlockView): string =>
    view.message ?? REPORT_MESSAGES.unavailable;

// ----------------------------------------------------------------------- KPIs

type KpiBase = Omit<FinancialKPI, 'value' | 'formattedValue'>;

const joinText = (...parts: Array<string | null | undefined>): string | undefined => {
    const text = parts.filter((part): part is string => Boolean(part)).join(' ');
    return text || undefined;
};

const moneyKpi = (
    base: KpiBase,
    cents: number | null,
    view: ReportBlockView,
    unavailable: string = stateText(view),
): FinancialKPI => cents === null
    ? { ...base, description: unavailable, trend: undefined, value: null, formattedValue: REPORT_MESSAGES.noValue }
    : {
        ...base,
        description: joinText(base.description, view.note),
        value: centsToDisplay(cents),
        formattedValue: formatCents(cents),
    };

const ratioKpi = (
    base: KpiBase,
    basisPoints: number | null,
    description: string | undefined,
    unavailable: string,
): FinancialKPI => basisPoints === null
    ? { ...base, description: unavailable, value: null, formattedValue: REPORT_MESSAGES.noValue }
    : {
        ...base,
        description,
        value: basisPointsToDisplay(basisPoints),
        formattedValue: formatBasisPoints(basisPoints),
    };

const base = (
    id: string,
    label: string,
    nature: FinancialKPI['nature'],
    description?: string,
): KpiBase => ({ id, label, description, trend: 'stable', period: 'custom', nature });

interface KpiInputs {
    dto: FinancialReport;
    blocks: ReportCoverage;
}

const buildPersonalKpis = ({ dto, blocks }: KpiInputs): FinancialKPI[] => {
    const cash = numbersOf(dto.cash, blocks.cash);
    const flows = numbersOf(dto.investments, blocks.investments)?.flows ?? null;
    const kpis = numbersOf(dto.kpis, blocks.kpis);

    const resultKpi = moneyKpi(
        base('kpi-balance', 'Resultado operacional', 'caixa'),
        cash ? cash.operationalResultCents : null,
        blocks.cash,
    );
    const balance: FinancialKPI = cash
        ? {
            ...resultKpi,
            description: joinText(`Fluxo líquido total: ${formatCents(cash.netFlowCents)}`, blocks.cash.note),
            // Sinal do valor, não comparação com o período anterior.
            trend: cash.operationalResultCents >= 0 ? 'up' : 'down',
            trendBasis: 'sign',
        }
        : resultKpi;

    const rate = kpis ? kpis.netContributionRateBasisPoints : null;
    // O motivo vem do servidor: sem recebimentos ou investimentos sem número.
    const rateReason = !kpis
        ? stateText(blocks.kpis)
        : kpis.netContributionRateReason === 'investments_unavailable'
            ? (blocks.investments.status !== 'not_requested' && !blocks.investments.hasNumbers
                ? stateText(blocks.investments)
                : REPORT_MESSAGES.investmentsUnavailable)
            : REPORT_MESSAGES.noReceipts;

    return [
        moneyKpi(base('kpi-income', 'Receitas Totais', 'caixa'),
            cash ? cash.receiptsCents : null, blocks.cash),
        moneyKpi(base('kpi-expenses', 'Despesas Totais', 'caixa'),
            cash ? cash.paymentsCents : null, blocks.cash),
        moneyKpi(base('kpi-investments', 'Investimentos', 'contribuicao'),
            flows ? flows.contributionsCents : null, blocks.investments),
        balance,
        ratioKpi(
            base('kpi-net-contribution-rate', 'Taxa de Aportes Líquidos', 'indicador',
                'Aportes líquidos sobre os recebimentos operacionais'),
            rate,
            'Aportes líquidos sobre os recebimentos operacionais',
            rateReason,
        ),
    ];
};

const buildBusinessKpis = ({ dto, blocks }: KpiInputs): FinancialKPI[] => {
    const cash = numbersOf(dto.cash, blocks.cash);
    const kpis = numbersOf(dto.kpis, blocks.kpis);
    const debts = numbersOf(dto.debts, blocks.debts);
    const margin = kpis ? kpis.operationalMarginBasisPoints : null;
    const marginDescription = cash
        ? `Resultado operacional de caixa: ${formatCents(cash.operationalResultCents)} · Pagamentos operacionais realizados: ${formatCents(cash.paymentsCents)}`
        : undefined;

    return [
        moneyKpi(base('kpi-gross-revenue', 'Recebimentos operacionais realizados', 'caixa'),
            cash ? cash.receiptsCents : null, blocks.cash),
        ratioKpi(
            base('kpi-profit-margin', 'Margem operacional de caixa', 'indicador'),
            margin,
            marginDescription,
            kpis ? REPORT_MESSAGES.noReceipts : stateText(blocks.kpis),
        ),
        moneyKpi(base('kpi-receivables-total', 'Contas a Receber', undefined),
            debts ? debts.receivables.openCents : null, blocks.debts),
        moneyKpi(base('kpi-debt-total', 'Dívida Bancária', undefined),
            debts ? debts.loansBorrowed.balanceCents : null, blocks.debts),
    ];
};

// ----------------------------------------------------------- séries e categorias

const monthLabel = (period: string): string => {
    const [year, month] = period.split('-').map(Number);
    if (!year || !month) return period;
    return new Date(year, month - 1, 2).toLocaleDateString('pt-BR', {
        month: 'short',
        year: 'numeric',
    });
};

const CLASSIFICATION_NAMES: Record<string, string> = {
    uncategorized: 'Sem categoria',
    receivables: 'Recebimentos de clientes',
    split: 'Divisão de contas',
};

/** Nome exibido da classificação: nome atual do catálogo ou rótulo fixo. */
export const categoryDisplayName = (item: CategoryItem): string => {
    if (item.classification === 'catalog') return item.name?.trim() || 'Categoria removida';
    return CLASSIFICATION_NAMES[item.classification] ?? 'Sem categoria';
};

const toCategories = (items: CategoryItem[]): ExpenseCategoryBreakdown[] =>
    items.map((item) => ({
        categoryId: item.categoryId ?? item.categoryKey,
        categoryName: categoryDisplayName(item),
        totalAmount: centsToDisplay(item.amountCents),
        percentageOfTotal: item.shareBasisPoints === null
            ? null
            : basisPointsToDisplay(item.shareBasisPoints),
    }));

// -------------------------------------------------------------------- cartões

/**
 * Classes disjuntas do saldo pendente por cartão: próxima fatura a pagar = próxima
 * obrigação não vencida; futuro = demais faturas com saldo fora de atraso; atraso = vencidas
 * com saldo; os três somam o saldo pendente (`outstandingCents`).
 * `openInvoiceBalance` é `null` quando o cartão não tem próxima fatura a pagar.
 */
const sumCents = (values: number[]): number => values.reduce((sum, value) => sum + value, 0);

const toIndicators = (cards: CardsReport): CreditCardReportIndicator[] =>
    cards.cards.map((card) => ({
        cardId: card.cardId,
        cardName: card.name,
        status: card.status,
        limitTotal: centsToDisplay(card.limitTotalCents),
        limitUsed: centsToDisplay(card.limitUsedCents),
        limitAvailable: centsToDisplay(card.limitAvailableCents),
        utilizationRate: card.utilizationBasisPoints === null
            ? null
            : basisPointsToDisplay(card.utilizationBasisPoints),
        openInvoiceBalance: card.currentInvoice ? centsToDisplay(card.currentInvoice.payableCents) : null,
        futureCommittedBalance: centsToDisplay(card.futureCommittedCents),
        overdueAmount: centsToDisplay(card.overdueCents),
        dueBuckets: {
            next7Days: centsToDisplay(card.dueNext7Cents),
            next15Days: centsToDisplay(card.dueNext15Cents),
            next30Days: centsToDisplay(card.dueNext30Cents),
        },
        registeredPaymentsAmount: centsToDisplay(card.paidCents),
        reversedPaymentsAmount: centsToDisplay(card.reversedCents),
        currentInvoiceId: card.currentInvoice?.invoiceId,
        currentInvoiceDueDate: card.currentInvoice?.dueDate,
        currentInvoiceStatus: card.currentInvoice
            ? (card.currentInvoice.cycleStatus === 'open' ? 'open' : card.currentInvoice.paymentStatus)
            : undefined,
        currentInvoiceOpenCycle: card.currentInvoice
            ? card.currentInvoice.cycleStatus === 'open' && !card.currentInvoice.effectivelyClosed
            : undefined,
        openCreditAmount: centsToDisplay(card.openCreditCents),
    }));

const emptyDebtProfile = (): DebtProfile => ({
    totalCreditCardDebt: 0,
    totalLoans: 0,
    utilizationRate: null,
    creditCardLimitUsed: 0,
    creditCardTotalLimit: 0,
    creditCardAvailableLimit: 0,
    creditCardOpenInvoiceBalance: 0,
    creditCardFutureCommittedBalance: 0,
    creditCardOverdueAmount: 0,
    creditCardArchivedOverdueAmount: 0,
    creditCardOpenCreditAmount: 0,
    creditCardDueNext7Days: 0,
    creditCardDueNext15Days: 0,
    creditCardDueNext30Days: 0,
    registeredInvoicePaymentsAmount: 0,
    reversedInvoicePaymentsAmount: 0,
    creditCardIndicators: [],
});

const toDebtProfile = (
    cards: CardsReport | null,
    debts: DebtsReport | null,
): DebtProfile => {
    const profile = emptyDebtProfile();
    if (debts) profile.totalLoans = centsToDisplay(debts.loansBorrowed.balanceCents);
    if (!cards) return profile;
    const indicators = toIndicators(cards);
    return {
        ...profile,
        totalCreditCardDebt: centsToDisplay(cards.obligations.totalOutstandingCents),
        utilizationRate: cards.limits.utilizationBasisPoints === null
            ? null
            : basisPointsToDisplay(cards.limits.utilizationBasisPoints),
        creditCardLimitUsed: centsToDisplay(cards.limits.usedCents),
        creditCardTotalLimit: centsToDisplay(cards.limits.totalCents),
        creditCardAvailableLimit: centsToDisplay(cards.limits.availableCents),
        creditCardOpenInvoiceBalance: centsToDisplay(
            sumCents(cards.cards.map((card) => card.currentInvoice?.payableCents ?? 0))),
        creditCardFutureCommittedBalance: centsToDisplay(
            sumCents(cards.cards.map((card) => card.futureCommittedCents))),
        creditCardOverdueAmount: centsToDisplay(cards.obligations.overdueCents),
        creditCardArchivedOverdueAmount: centsToDisplay(sumCents(
            cards.cards.filter((card) => card.status === 'archived').map((card) => card.overdueCents))),
        creditCardOpenCreditAmount: centsToDisplay(cards.obligations.openCreditCents),
        creditCardDueNext7Days: centsToDisplay(cards.obligations.dueNext7Cents),
        creditCardDueNext15Days: centsToDisplay(cards.obligations.dueNext15Cents),
        creditCardDueNext30Days: centsToDisplay(cards.obligations.dueNext30Cents),
        registeredInvoicePaymentsAmount: centsToDisplay(cards.payments.paidCents),
        reversedInvoicePaymentsAmount: centsToDisplay(cards.payments.reversedCents),
        creditCardIndicators: indicators,
    };
};

const sortPeriodsDesc = <T extends { period: string }>(items: T[]): T[] =>
    [...items].sort((left, right) => right.period.localeCompare(left.period));

const toCardExpenseViews = (
    cards: CardsReport | null,
    pointsAsc: CashFlowSummary[],
): CreditCardExpenseReportViews => {
    const purchaseCompetence: CreditCardExpenseByPeriodItem[] = cards
        ? sortPeriodsDesc(cards.purchaseSeries.map((entry) => ({
            period: entry.month,
            label: monthLabel(entry.month),
            amount: centsToDisplay(entry.netCents),
            count: entry.count,
        })))
        : [];
    const invoicePaymentDate: CreditCardExpenseByPeriodItem[] = sortPeriodsDesc(
        pointsAsc.map((point) => ({
            period: point.month,
            label: monthLabel(point.month),
            amount: point.cardPayments,
            count: null,
        })));
    // Visão de consumo e pagamento por cartão: só os ativos. O arquivado com
    // saldo pendente aparece nos indicadores (Visão Geral), com o atraso.
    const cardAnalytics: CreditCardExpenseByCardItem[] = cards
        ? cards.cards.filter((card) => card.status === 'active').map((card) => ({
            cardId: card.cardId,
            cardName: card.name,
            purchaseAmount: centsToDisplay(card.purchasesCents),
            purchaseCount: card.purchaseCount,
            // Pago líquido de estorno (soma de inteiros do mesmo cartão).
            paidAmount: centsToDisplay(card.paidCents - card.reversedCents),
            openInvoiceBalance: card.currentInvoice ? centsToDisplay(card.currentInvoice.payableCents) : null,
            futureCommittedBalance: centsToDisplay(card.futureCommittedCents),
            overdueAmount: centsToDisplay(card.overdueCents),
            utilizationRate: card.utilizationBasisPoints === null
                ? null
                : basisPointsToDisplay(card.utilizationBasisPoints),
        }))
        : [];
    return { purchaseCompetence, invoicePaymentDate, cardAnalytics };
};

// ----------------------------------------------------------------- PJ e alertas

const RECEIVABLE_COLORS = { onTime: '#f59e0b', received: '#10b981', overdue: '#ef4444' } as const;

const toReceivablesStatus = (debts: DebtsReport): ReceivableStatusMetric[] => {
    const receivables = debts.receivables;
    return [
        {
            status: 'Em dia',
            count: receivables.openCount - receivables.overdueCount,
            totalValue: centsToDisplay(receivables.openCents - receivables.overdueCents),
            color: RECEIVABLE_COLORS.onTime,
        },
        {
            status: 'Recebido',
            count: receivables.receivedCount,
            totalValue: centsToDisplay(receivables.receivedCents),
            color: RECEIVABLE_COLORS.received,
        },
        {
            status: 'Em atraso',
            count: receivables.overdueCount,
            totalValue: centsToDisplay(receivables.overdueCents),
            color: RECEIVABLE_COLORS.overdue,
        },
    ];
};

const plural = (count: number, one: string, many: string): string =>
    `${count} ${count === 1 ? one : many}`;

const valueOf = (alert: ReportAlert, key: string): number | null => {
    const value = alert.values?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** Título e mensagem em pt-BR de cada alerta objetivo (D-37.9). */
export const alertTexts = (alert: ReportAlert): { title: string; message: string } => {
    const money = (key: string) => {
        const cents = valueOf(alert, key);
        return cents === null ? null : formatCents(cents);
    };
    const count = (key: string) => valueOf(alert, key);
    switch (alert.code) {
        case 'negative_account_balance': {
            const accounts = count('negativeAccountCount');
            const total = money('totalBalanceCents');
            return {
                title: 'Saldo negativo em conta',
                message: accounts !== null && total !== null
                    ? `${plural(accounts, 'conta está', 'contas estão')} com saldo negativo. Saldo total das contas: ${total}.`
                    : 'Há contas com saldo negativo.',
            };
        }
        case 'negative_operational_result': {
            const result = money('operationalResultCents');
            const receipts = money('receiptsCents');
            const payments = money('paymentsCents');
            return {
                title: 'Resultado operacional negativo',
                message: result !== null && receipts !== null && payments !== null
                    ? `Os pagamentos operacionais (${payments}) superaram os recebimentos operacionais (${receipts}) no período. Resultado: ${result}.`
                    : 'Os pagamentos operacionais superaram os recebimentos operacionais no período.',
            };
        }
        case 'overdue_card_invoices': {
            const invoices = count('overdueCount');
            const total = money('overdueCents');
            return {
                title: 'Faturas de cartão vencidas',
                message: invoices !== null && total !== null
                    ? `${plural(invoices, 'fatura vencida soma', 'faturas vencidas somam')} ${total}.`
                    : 'Há faturas de cartão vencidas.',
            };
        }
        case 'card_invoices_due_soon': {
            const total = money('dueNext7Cents');
            return {
                title: 'Faturas de cartão a vencer',
                message: total !== null
                    ? `Faturas de cartão com vencimento nos próximos 7 dias somam ${total}.`
                    : 'Há faturas de cartão com vencimento nos próximos 7 dias.',
            };
        }
        case 'overdue_borrowed_loans': {
            const loans = count('overdueCount');
            const total = money('overdueBalanceCents');
            return {
                title: 'Empréstimos em atraso',
                message: loans !== null && total !== null
                    ? `${plural(loans, 'empréstimo tomado está em atraso', 'empréstimos tomados estão em atraso')}, com saldo em atraso de ${total}.`
                    : 'Há empréstimos tomados em atraso.',
            };
        }
        case 'overdue_receivables': {
            const receivables = count('overdueCount');
            const total = money('overdueCents');
            return {
                title: 'Recebíveis em atraso',
                message: receivables !== null && total !== null
                    ? `${plural(receivables, 'recebível está em atraso', 'recebíveis estão em atraso')}, somando ${total}.`
                    : 'Há recebíveis em atraso.',
            };
        }
        case 'insufficient_base':
            return {
                title: 'Base insuficiente',
                message: 'Não há recebimentos realizados no período; os indicadores proporcionais ficam indisponíveis.',
            };
        case 'projection_rebuild_needed':
            return {
                title: 'Totais aguardando reconstrução',
                message: 'Os totais de caixa estão aguardando reconstrução. Os valores voltam a aparecer quando ela terminar.',
            };
        default:
            return {
                title: 'Alerta financeiro',
                message: 'Há um alerta sem descrição disponível nesta versão.',
            };
    }
};

const toAlerts = (items: ReportAlert[], generatedAt: string): FinancialAlert[] =>
    items.map((alert) => ({
        id: alert.code,
        ...alertTexts(alert),
        severity: alert.severity,
        createdAt: generatedAt,
    }));

// ---------------------------------------------------------------- investimentos

const toInvestmentOverview = (data: InvestmentsReport): InvestmentOverview => ({
    contributions: centsToDisplay(data.flows.contributionsCents),
    redeemedPrincipal: centsToDisplay(data.flows.redemptionsPrincipalCents),
    realizedGain: centsToDisplay(data.flows.realizedGainCents),
    realizedLoss: centsToDisplay(data.flows.realizedLossCents),
    realizedResult: centsToDisplay(data.flows.realizedResultCents),
    fees: centsToDisplay(data.flows.feesCents),
    taxes: centsToDisplay(data.flows.taxCents),
    cost: data.patrimony ? centsToDisplay(data.patrimony.costCents) : null,
    currentValue: data.patrimony ? centsToDisplay(data.patrimony.currentValueCents) : null,
    unrealizedGain: data.patrimony ? centsToDisplay(data.patrimony.unrealizedResultCents) : null,
    evolution: data.evolution === null ? null : data.evolution.map((entry) => ({
        period: entry.month,
        currentValue: centsToDisplay(entry.closingValueCents),
    })),
    reconciliationDifferenceCents: data.reconciliationDifferenceCents,
});

// --------------------------------------------------------------------- adaptador

export interface ReportAdapterResult {
    snapshot: FinancialReportSnapshot;
    view: ReportViewModel;
}

const buildCoverage = (dto: FinancialReport): ReportCoverage => {
    const debts = blockViewOf(dto.debts);
    const topClientsRaw = dto.debts.data ? blockViewOf(dto.debts.data.topClients) : debts;
    const topClients: ReportBlockView = !debts.hasNumbers
        ? debts
        : topClientsRaw.status === 'sample'
            ? { ...topClientsRaw, note: REPORT_MESSAGES.topClientsSample }
            : topClientsRaw;
    const coverage = {
        accounts: blockViewOf(dto.accounts),
        cash: blockViewOf(dto.cash),
        kpis: blockViewOf(dto.kpis),
        series: blockViewOf(dto.series),
        categories: blockViewOf(dto.categories),
        cards: blockViewOf(dto.cards),
        debts,
        investments: blockViewOf(dto.investments),
        alerts: blockViewOf(dto.alerts),
        topClients,
    } satisfies Record<ReportBlockKey, ReportBlockView>;
    return coverage;
};

const toCashFlowAscending = (
    series: FinancialReport['series'],
    view: ReportBlockView,
): CashFlowSummary[] => {
    const data = numbersOf(series, view);
    if (!data) return [];
    return data.points.map((point) => ({
        month: point.month,
        totalIncome: centsToDisplay(point.receiptsCents),
        totalExpenses: centsToDisplay(point.paymentsCents),
        operationalResult: centsToDisplay(point.operationalResultCents),
        cardPayments: centsToDisplay(point.cardPaymentsCents),
        netCashFlow: centsToDisplay(point.netFlowCents),
        partial: point.partial,
    }));
};

/**
 * Monta o snapshot que as telas e o chat de IA já consumem e o modelo de
 * apresentação (estados por bloco, notas fixas) a partir do DTO oficial.
 */
export const toReportSnapshot = (
    dto: FinancialReport,
    workspaceType: 'PF' | 'PJ',
): ReportAdapterResult => {
    const blocks = buildCoverage(dto);
    const isPJ = workspaceType === 'PJ';
    const kpis = isPJ
        ? buildBusinessKpis({ dto, blocks })
        : buildPersonalKpis({ dto, blocks });

    const cards = numbersOf(dto.cards, blocks.cards);
    const debts = numbersOf(dto.debts, blocks.debts);
    const investments = numbersOf(dto.investments, blocks.investments);
    const categories = numbersOf(dto.categories, blocks.categories);
    const alerts = numbersOf(dto.alerts, blocks.alerts);

    const cashFlowAscending = toCashFlowAscending(dto.series, blocks.series);
    const cashFlow = [...cashFlowAscending].reverse();
    const debtProfile = toDebtProfile(cards, debts);
    const investmentOverview = investments ? toInvestmentOverview(investments) : undefined;

    const topClientsData = debts ? numbersOf(debts.topClients, blocks.topClients) : null;
    const topClients: ClientMetric[] | undefined = isPJ && topClientsData
        ? topClientsData.map((client) => ({
            clientId: client.clientId,
            clientName: client.name?.trim() || 'Cliente',
            totalValue: centsToDisplay(client.amountCents),
            percentage: client.shareBasisPoints === null
                ? null
                : basisPointsToDisplay(client.shareBasisPoints),
        }))
        : undefined;
    const receivablesStatus = isPJ && debts ? toReceivablesStatus(debts) : undefined;

    const differenceCents = investments?.reconciliationDifferenceCents ?? null;
    const investmentNote = investments && investments.patrimony === null
        ? REPORT_MESSAGES.patrimonyForbidden
        : differenceCents !== null && differenceCents !== 0
            ? `Há diferença de ${formatCents(differenceCents)} entre o patrimônio atual e a evolução histórica. Solicite a reconstrução das projeções antes de tomar decisões.`
            : null;

    const insightKpi = kpis.find((kpi) =>
        kpi.id === (isPJ ? 'kpi-profit-margin' : 'kpi-net-contribution-rate'));
    const hasInsightValue = insightKpi !== undefined && insightKpi.value !== null;
    const insightReason = insightKpi?.description ?? REPORT_MESSAGES.unavailable;
    const insight = isPJ
        ? hasInsightValue
            ? `Margem operacional de caixa de ${insightKpi.formattedValue} no período.`
            : `Margem operacional de caixa: ${insightReason}`
        : hasInsightValue
            ? `Aportes líquidos de ${insightKpi.formattedValue} dos recebimentos operacionais no período.`
            : `Aportes líquidos sobre os recebimentos operacionais: ${insightReason}`;

    const snapshot: FinancialReportSnapshot = {
        workspaceType,
        coverage: blocks,
        generatedAt: dto.generatedAt,
        periodLabel: rangeLabel(dto.period.range),
        range: dto.period.range,
        kpis,
        cashFlow,
        expenseCategories: categories ? toCategories(categories.expense) : [],
        debtProfile,
        creditCardIndicators: debtProfile.creditCardIndicators,
        creditCardExpenseReportViews: toCardExpenseViews(cards, cashFlowAscending),
        investmentOverview,
        topClients,
        receivablesStatus,
        alerts: alerts ? toAlerts(alerts.items, dto.generatedAt) : [],
    };

    const view: ReportViewModel = {
        blocks,
        investmentsPermitted: dto.permissions.investments,
        cashFlowRows: cashFlow.slice(0, CASH_FLOW_TABLE_LIMIT),
        cashFlowNote: cashFlow.length > CASH_FLOW_TABLE_LIMIT ? REPORT_MESSAGES.cashFlowLimit : null,
        cardsNote: REPORT_MESSAGES.cardsNote,
        purchaseSeriesNote: cards && cards.purchaseSeriesStartMonth
            ? `Compras exibidas a partir de ${monthLabel(cards.purchaseSeriesStartMonth)}.`
            : null,
        topClientsNote: blocks.topClients.hasNumbers ? blocks.topClients.note : null,
        investmentNote,
        insight,
    };
    return { snapshot, view };
};

// ------------------------------------------------------------------- Dashboard

/** Número do card do Dashboard, ou o texto de estado que ocupa o lugar dele. */
export interface DashboardFigure {
    cents: number | null;
    message: string | null;
}

export interface DashboardChartItem {
    name: string;
    kind: 'income' | 'expense' | 'investment' | 'cardPayment';
    value: number;
}

export interface DashboardSummary {
    balance: DashboardFigure;
    income: DashboardFigure;
    expenses: DashboardFigure;
    investments: DashboardFigure;
    /** `null` enquanto o gráfico não tem números; `chartMessage` diz o porquê. */
    chart: DashboardChartItem[] | null;
    chartMessage: string | null;
}

const figure = <T>(
    section: ReportSectionResult<T> | undefined,
    view: ReportBlockView,
    pick: (data: T) => number,
): DashboardFigure => {
    const data = numbersOf(section, view);
    return data
        ? { cents: pick(data), message: null }
        : { cents: null, message: stateText(view) };
};

/**
 * Cards e gráfico do Dashboard a partir do relatório do mês. Sem relatório
 * (carregando ou falha) nenhum card mostra número: o texto de estado ocupa o
 * lugar dele.
 */
export const toDashboardSummary = (
    dto: FinancialReport | undefined,
    pendingMessage: string = REPORT_MESSAGES.loading,
): DashboardSummary => {
    if (!dto) {
        const pending: DashboardFigure = { cents: null, message: pendingMessage };
        return {
            balance: pending, income: pending, expenses: pending, investments: pending,
            chart: null, chartMessage: pendingMessage,
        };
    }
    const blocks = buildCoverage(dto);
    const cash = numbersOf(dto.cash, blocks.cash);
    const investments = numbersOf(dto.investments, blocks.investments);
    const chart: DashboardChartItem[] | null = cash ? [
        { name: 'Receitas', kind: 'income', value: centsToDisplay(cash.receiptsCents) },
        { name: 'Despesas', kind: 'expense', value: centsToDisplay(cash.paymentsCents) },
        ...(investments
            ? [{
                name: 'Investimentos',
                kind: 'investment' as const,
                value: centsToDisplay(investments.flows.contributionsCents),
            }]
            : []),
        { name: 'Faturas de cartão', kind: 'cardPayment', value: centsToDisplay(cash.cardPaymentsCents) },
    ] : null;
    return {
        balance: figure(dto.accounts, blocks.accounts, (data) => data.totalBalanceCents),
        income: figure(dto.cash, blocks.cash, (data) => data.receiptsCents),
        expenses: figure(dto.cash, blocks.cash, (data) => data.paymentsCents),
        investments: figure(dto.investments, blockViewOf(dto.investments),
            (data) => data.flows.contributionsCents),
        chart,
        chartMessage: chart ? null : stateText(blocks.cash),
    };
};
