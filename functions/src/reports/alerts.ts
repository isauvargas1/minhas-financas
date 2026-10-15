import type {
  AccountsReport,
  CardsReport,
  CashReport,
  DebtsReport,
  ReportAlert,
  ReportSectionResult,
} from "./contract";

/**
 * Alertas objetivos do relatório (P5-C1, D-37.9): só fatos verificáveis dos
 * blocos já calculados — nenhum limiar inventado, nenhum indicador
 * inexistente, nenhuma persistência (alertas persistidos e notificações são
 * da P5-D2). O texto em pt-BR é da interface; aqui vão o código, a
 * severidade e os valores do fato.
 */

const SEVERITY_ORDER = {critical: 0, warning: 1, info: 2} as const;

const usable = <T>(section: ReportSectionResult<T>): T | null =>
  section.status === "exact" || section.status === "zero" ?
    section.data :
    null;

export const buildReportAlerts = (input: {
  accounts: ReportSectionResult<AccountsReport>;
  cash: ReportSectionResult<CashReport>;
  cards: ReportSectionResult<CardsReport>;
  debts: ReportSectionResult<DebtsReport>;
}): ReportAlert[] => {
  const alerts: ReportAlert[] = [];
  const accounts = usable(input.accounts);
  if (accounts && accounts.negativeAccountCount > 0) {
    alerts.push({
      code: "negative_account_balance",
      severity: accounts.totalBalanceCents < 0 ? "critical" : "warning",
      values: {
        totalBalanceCents: accounts.totalBalanceCents,
        negativeAccountCount: accounts.negativeAccountCount,
      },
    });
  }
  if (input.cash.status === "rebuild_needed") {
    alerts.push({
      code: "projection_rebuild_needed",
      severity: "warning",
      values: {},
    });
  }
  const cash = usable(input.cash);
  if (cash && cash.operationalResultCents < 0) {
    alerts.push({
      code: "negative_operational_result",
      severity: "warning",
      values: {
        operationalResultCents: cash.operationalResultCents,
        receiptsCents: cash.receiptsCents,
        paymentsCents: cash.paymentsCents,
      },
    });
  }
  if (cash && cash.receiptsCents <= 0) {
    alerts.push({
      code: "insufficient_base",
      severity: "info",
      values: {receiptsCents: cash.receiptsCents},
    });
  }
  const cards = usable(input.cards);
  if (cards && cards.obligations.overdueCount > 0) {
    alerts.push({
      code: "overdue_card_invoices",
      severity: "critical",
      values: {
        overdueCents: cards.obligations.overdueCents,
        overdueCount: cards.obligations.overdueCount,
      },
    });
  }
  if (cards && cards.obligations.dueNext7Cents > 0) {
    alerts.push({
      code: "card_invoices_due_soon",
      severity: "info",
      values: {dueNext7Cents: cards.obligations.dueNext7Cents},
    });
  }
  const debts = usable(input.debts);
  if (debts && debts.loansBorrowed.overdueCount > 0) {
    alerts.push({
      code: "overdue_borrowed_loans",
      severity: "critical",
      values: {
        overdueBalanceCents: debts.loansBorrowed.overdueBalanceCents,
        overdueCount: debts.loansBorrowed.overdueCount,
      },
    });
  }
  if (debts && debts.receivables.overdueCount > 0) {
    alerts.push({
      code: "overdue_receivables",
      severity: "warning",
      values: {
        overdueCents: debts.receivables.overdueCents,
        overdueCount: debts.receivables.overdueCount,
      },
    });
  }
  return alerts.sort((left, right) =>
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]);
};

/** Fontes que o cálculo dos alertas não conseguiu ler por inteiro. */
export const alertSourcesComplete = (
  sections: ReadonlyArray<ReportSectionResult<unknown>>,
): boolean => sections.every((section) =>
  section.status === "exact" || section.status === "zero" ||
  section.status === "rebuild_needed");
