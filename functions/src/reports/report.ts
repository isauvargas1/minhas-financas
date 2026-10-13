import * as admin from "firebase-admin";

import {CARD_PURCHASES_COLLECTION} from "../cards/model";
import {
  cashProjectionStateRef,
  emptyCashPeriodDelta,
  readCashProjectionState,
} from "../cash/periods";
import {INVESTMENT_COLLECTIONS} from "../investments/paths";
import {saoPauloDayKey} from "../shared/dateKeys";
import {ApplicationError, isContentionAbortedError} from "../shared/errors";
import type {OperationLogger} from "../shared/logger";
import type {WorkspaceActor, WorkspaceRole} from "../shared/workspaceAuth";
import {readAccountsSection} from "./accounts";
import {alertSourcesComplete, buildReportAlerts} from "./alerts";
import {
  cashReportOf,
  cashWindowOf,
  isZeroCash,
  readAllMonths,
  readMonths,
  seriesPointsOf,
  type StoredMonth,
} from "./cash";
import {readCardsSection} from "./cards";
import {readCategoriesSection} from "./categories";
import {
  REPORT_SECTIONS,
  type FinancialReport,
  type GetFinancialReportPayload,
  type KpiReport,
  type ReportSection,
  type ReportSectionResult,
} from "./contract";
import {readDebtsSection} from "./debts";
import {marginBasisPoints, netContributionRateBasisPoints} from "./formulas";
import {readInvestmentsSection} from "./investments";
import {resolveReportWindow, type ResolvedWindow} from "./window";

/**
 * Relatório financeiro autoritativo (P5-C1, D-37): o mesmo contrato para o
 * Dashboard e os Relatórios. Só leituras limitadas das projeções oficiais e
 * dos domínios autoritativos; nenhuma transação é lida.
 *
 * Permissão por domínio, a mesma matriz das Rules: o agregado mensal de
 * investimentos (`investment_report_periods`) e a projeção de caixa são de
 * todo membro ativo, viewer incluído (P4-D, D-15); por isso fluxos e taxa
 * de aportes líquidos vão para todos. Patrimônio
 * (`investment_summaries/current`), evolução patrimonial e reconciliação só
 * para quem lê o domínio (owner, admin, member — `canReadInvestmentDomain`);
 * para o viewer eles vêm `null` e o resumo nem é lido.
 */

/** Papéis que leem o relatório: todo membro ativo (viewer só lê). */
export const REPORT_READER_ROLES: readonly WorkspaceRole[] =
  ["owner", "admin", "member", "viewer"];

/** Papéis que leem o patrimônio do domínio de investimentos (Rules). */
export const INVESTMENT_READER_ROLES: readonly WorkspaceRole[] =
  ["owner", "admin", "member"];

/** Acima disto, a série de "tudo" traz só os meses com movimento. */
export const MAX_DENSE_SERIES_MONTHS = 120;

const db = () => admin.firestore();

const notRequested = <T>(): ReportSectionResult<T> =>
  ({status: "not_requested", data: null});

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Taxa de aportes líquidos (D-37.5) e o motivo quando indisponível. */
const netContributionRateOf = (
  flows: {contributionsCents: number; redemptionsPrincipalCents: number} | null,
  receiptsCents: number,
): Pick<KpiReport,
  "netContributionRateBasisPoints" | "netContributionRateReason"> => {
  if (!flows) {
    return {
      netContributionRateBasisPoints: null,
      netContributionRateReason: "investments_unavailable",
    };
  }
  const rate = netContributionRateBasisPoints(
    flows.contributionsCents, flows.redemptionsPrincipalCents, receiptsCents);
  return {
    netContributionRateBasisPoints: rate,
    netContributionRateReason: rate === null ? "no_receipts" : null,
  };
};

/**
 * "Todo o período" começa no mês mais antigo com dado em qualquer domínio do
 * relatório, não só no caixa: a compra no cartão e o aporte não dependem de
 * lançamento de caixa (D-37.3, D-37.5). Duas leituras limitadas a 1
 * documento (primeira compra, primeiro período de investimento).
 */
const firstDomainMonth = async (
  workspaceId: string,
): Promise<string | null> => {
  const [purchase, investment] = await Promise.all([
    db().collection(`workspaces/${workspaceId}/${CARD_PURCHASES_COLLECTION}`)
      .orderBy("purchaseDate").limit(1).get(),
    db().collection(
      `workspaces/${workspaceId}/${INVESTMENT_COLLECTIONS.reportPeriods}`)
      .orderBy("periodStart").limit(1).get(),
  ]);
  const candidates = [
    String(purchase.docs[0]?.get("purchaseDate") ?? "").slice(0, 7),
    investment.docs[0]?.id ?? "",
  ].filter((month) => MONTH_KEY.test(month)).sort();
  return candidates[0] ?? null;
};

/** Falha de conferência das categorias que merece uma releitura. */
const CATEGORY_PARITY_REASONS = ["category_parity", "category_cash_parity"];
const isCategoryParityFailure = (
  section: ReportSectionResult<unknown>,
): boolean => section.status === "rebuild_needed" &&
  CATEGORY_PARITY_REASONS.includes(section.reason ?? "");

const earliest = (...months: Array<string | null>): string | null =>
  months.filter((month): month is string => month !== null).sort()[0] ??
  null;

/**
 * Leitores dos blocos de domínio independentes do caixa. A produção usa os
 * padrões; o parâmetro existe para os testes injetarem falha de leitura
 * (P5-C2, L8) sem gancho global nem mock do SDK.
 */
export interface ReportReaders {
  accounts: typeof readAccountsSection;
  cards: typeof readCardsSection;
  investments: typeof readInvestmentsSection;
  debts: typeof readDebtsSection;
}

export const DEFAULT_REPORT_READERS: ReportReaders = {
  accounts: readAccountsSection,
  cards: readCardsSection,
  investments: readInvestmentsSection,
  debts: readDebtsSection,
};

export interface FinancialReportOptions {
  readers?: Partial<ReportReaders>;
  log?: OperationLogger;
  /**
   * Não lê o ranking de clientes por amostra (PJ), mesmo com `debts`
   * pedido: o contexto do consultor de IA (P5-E1) usa só os agregados de
   * dívidas e recebíveis, nunca nomes de clientes.
   */
  omitTopClients?: boolean;
}

/**
 * Códigos gRPC de falha passageira do Firestore (Admin SDK): CANCELLED,
 * UNKNOWN, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, ABORTED, INTERNAL e
 * UNAVAILABLE. Só eles (e a contenção) tornam um bloco indisponível.
 */
const RECOVERABLE_READ_CODES = new Set([1, 2, 4, 8, 10, 13, 14]);

/**
 * Falha de leitura isolável por bloco (P5-C2, L8): infraestrutura
 * passageira, que uma nova consulta pode resolver. Todo o resto continua
 * derrubando a chamada — erro de domínio ou de autorização
 * (`ApplicationError`), erro sem código (invariante financeira quebrada,
 * defeito de programa) e código gRPC estrutural ou de acesso
 * (PERMISSION_DENIED, FAILED_PRECONDITION como índice ausente,
 * INVALID_ARGUMENT, NOT_FOUND...): nunca vira bloco indisponível.
 */
export const isRecoverableReadError = (error: unknown): boolean => {
  if (error instanceof ApplicationError) return false;
  if (isContentionAbortedError(error)) return true;
  if (typeof error !== "object" || error === null) return false;
  const code = (error as {code?: unknown}).code;
  return typeof code === "number" && RECOVERABLE_READ_CODES.has(code);
};

/**
 * Lê um bloco independente e, se a leitura falhar de forma recuperável,
 * devolve `unavailable` com motivo fixo — nunca zero, nunca lista vazia,
 * nunca a mensagem do SDK. O código vai para o log, sem dado.
 */
const isolateSectionRead = async <T>(
  section: string,
  read: () => Promise<ReportSectionResult<T>>,
  log: OperationLogger | undefined,
): Promise<ReportSectionResult<T>> => {
  try {
    return await read();
  } catch (error) {
    if (!isRecoverableReadError(error)) throw error;
    log?.warn("financial_report.section_unavailable", {
      section,
      errorCode: String((error as {code?: unknown}).code ?? "aborted"),
    });
    return {status: "unavailable", reason: "temporarily_unavailable",
      data: null};
  }
};

export const executeGetFinancialReport = async (
  actor: WorkspaceActor,
  payload: GetFinancialReportPayload,
  now: Date = new Date(),
  options: FinancialReportOptions = {},
): Promise<FinancialReport> => {
  const readers: ReportReaders = {...DEFAULT_REPORT_READERS,
    ...options.readers};
  const {log} = options;
  const workspaceId = actor.workspaceId;
  const today = saoPauloDayKey(now);
  const requested = new Set<ReportSection>(payload.sections ?? REPORT_SECTIONS);
  const canReadInvestments = INVESTMENT_READER_ROLES.includes(actor.role);
  const wants = (...sections: ReportSection[]) =>
    sections.some((section) => requested.has(section));

  const needsCash = wants("cash", "kpis", "series", "categories", "alerts");
  const allTime = payload.range.kind === "preset" &&
    payload.range.preset === "all";

  /** Workspace, estado da projeção, janela e meses do caixa. */
  const readCashCore = async () => {
    const [workspaceSnapshot, stateSnapshot] = await db().getAll(
      db().doc(`workspaces/${workspaceId}`),
      cashProjectionStateRef(workspaceId),
    );
    const workspaceType: "PF" | "PJ" =
      workspaceSnapshot.data()?.type === "PJ" ? "PJ" : "PF";
    const state = readCashProjectionState(stateSnapshot);
    let resolved: ResolvedWindow;
    let months = new Map<string, StoredMonth>();
    let tooManyPeriods = false;
    if (allTime) {
      const [all, otherFirst] = await Promise.all([
        readAllMonths(workspaceId),
        firstDomainMonth(workspaceId),
      ]);
      if (all.ok) months = all.months;
      else tooManyPeriods = true;
      resolved = resolveReportWindow(payload.range, today,
        earliest(all.ok ? all.firstMonth : null, otherFirst));
    } else {
      resolved = resolveReportWindow(payload.range, today);
      if (needsCash) {
        months = await readMonths(workspaceId,
          resolved.months.map((slice) => slice.month));
      }
    }
    const cashWindow = cashWindowOf(resolved.months, months);
    const cashUnavailable: ReportSectionResult<never> | null =
      tooManyPeriods ?
        {status: "unavailable", reason: "too_many_periods", data: null} :
        state.needsRebuild || !cashWindow.consistent ?
          {status: "rebuild_needed",
            reason: state.needsRebuild ? "projection_needs_rebuild" :
              "projection_parity", data: null} :
          null;
    return {workspaceType, state, resolved, months, cashWindow,
      cashUnavailable};
  };
  type CashCore = Awaited<ReturnType<typeof readCashCore>>;

  const categoriesOf = async (
    core: CashCore,
  ): Promise<FinancialReport["categories"]> => {
    if (!wants("categories")) return notRequested();
    if (core.cashUnavailable) return core.cashUnavailable;
    return readCategoriesSection({
      workspaceId,
      generation: core.state.categoryGeneration,
      months: core.resolved.months,
      receiptsCents: core.cashWindow.totals.incomeCents,
      paymentsCents: core.cashWindow.totals.expenseCents,
    });
  };

  // Caixa e categorias são lidos em momentos diferentes: um gatilho entre as
  // leituras, ou a troca de geração publicada pela reconstrução, pode fazer
  // a conferência falhar sem a projeção estar errada. Antes de declarar
  // reconstrução, relê o núcleo e as categorias uma vez; todos os blocos de
  // caixa saem da mesma leitura final.
  let core = await readCashCore();
  let categories = await categoriesOf(core);
  if (isCategoryParityFailure(categories)) {
    core = await readCashCore();
    categories = await categoriesOf(core);
  }
  const {workspaceType, resolved, months, cashWindow, cashUnavailable} = core;

  // ------------------------------------------------------------- caixa
  const cashStatus = cashUnavailable?.status ??
    (isZeroCash(cashWindow.totals) ? "zero" : "exact");
  const cashData = cashUnavailable ? null :
    cashReportOf(cashWindow.totals);
  const cash: FinancialReport["cash"] = !needsCash ? notRequested() :
    cashUnavailable ?? {status: cashStatus, data: cashData};

  // --------------------------------------------------------- blocos
  const needsInvestments = wants("investments", "kpis");
  const needsCards = wants("cards", "debts", "alerts");
  const needsAccounts = wants("accounts", "alerts");
  // Blocos independentes do caixa: a falha passageira de um deles o deixa
  // `unavailable` sem derrubar os demais (L8); erro de autorização, de
  // domínio ou invariante quebrada continua derrubando a chamada.
  const [accounts, cards, investments] = await Promise.all([
    needsAccounts ?
      isolateSectionRead("accounts",
        () => readers.accounts(workspaceId), log) :
      Promise.resolve(notRequested<never>()),
    needsCards ?
      isolateSectionRead("cards", () => readers.cards({
        workspaceId, today,
        startDate: resolved.period.future ? null : resolved.period.startDate,
        endDate: resolved.period.endDate,
        months: resolved.months,
      }), log) :
      Promise.resolve(notRequested<never>()),
    needsInvestments ?
      isolateSectionRead("investments", () => readers.investments({
        workspaceId, months: resolved.months, allTime,
        includePatrimony: canReadInvestments,
      }), log) :
      Promise.resolve(notRequested<never>()),
  ]);
  const cardsUsable = cards.status === "exact" || cards.status === "zero";
  let debts: FinancialReport["debts"] = notRequested();
  // Empréstimos e recebíveis exatos alimentam os alertas mesmo quando o
  // bloco de dívidas vem parcial por falta de cartões (os alertas de cartão
  // dependem do próprio bloco de cartões, e a cobertura parcial é declarada).
  let debtsForAlerts: FinancialReport["debts"] = notRequested();
  if (wants("debts", "alerts")) {
    debts = await isolateSectionRead("debts", () => readers.debts({
      workspaceId, today,
      // Ranking por amostra (até 500 leituras): só quando o bloco de dívidas
      // é pedido em PJ — `alerts` usa os agregados, nunca o ranking.
      includeTopClients: workspaceType === "PJ" && requested.has("debts") &&
        options.omitTopClients !== true,
      cardObligationsCents: cardsUsable && cards.data ?
        cards.data.obligations.totalOutstandingCents :
        null,
    }), log);
    debtsForAlerts = debts;
    // Sem o bloco de cartões, as obrigações de cartão vêm `null`: empréstimos
    // e recebíveis seguem exatos, mas o bloco não é um total completo.
    if (!cardsUsable && (debts.status === "exact" || debts.status === "zero")) {
      debts = {status: "truncated", reason: "partial_sources",
        data: debts.data};
    }
  }

  // -------------------------------------------------------------- KPIs
  const investmentFlows = investments.status === "exact" ||
    investments.status === "zero" ? investments.data?.flows ?? null : null;
  const kpis: FinancialReport["kpis"] = !wants("kpis") ? notRequested() :
    cashUnavailable ?? {
      status: cashStatus,
      data: {
        operationalMarginBasisPoints: marginBasisPoints(
          cashWindow.totals.incomeCents - cashWindow.totals.expenseCents,
          cashWindow.totals.incomeCents,
        ),
        ...netContributionRateOf(
          investmentFlows, cashWindow.totals.incomeCents),
      },
    };

  // ------------------------------------------------------------- série
  let series: FinancialReport["series"] = notRequested();
  if (wants("series")) {
    if (cashUnavailable) {
      series = cashUnavailable;
    } else {
      const sparse = resolved.months.length > MAX_DENSE_SERIES_MONTHS;
      const points = seriesPointsOf(cashWindow).filter((point) =>
        !sparse || months.has(point.month));
      series = {
        status: cashStatus,
        data: {granularity: "month", sparse, points},
      };
    }
  }

  // ----------------------------------------------------------- alertas
  let alerts: FinancialReport["alerts"] = notRequested();
  if (wants("alerts")) {
    const cashForAlerts = cashUnavailable ?? {status: cashStatus,
      data: cashData ?? cashReportOf(emptyCashPeriodDelta())};
    const items = buildReportAlerts({
      accounts,
      cash: cashForAlerts,
      cards,
      debts: debtsForAlerts,
    });
    // Caixa indisponível também é fonte incompleta (P5-D2): sem ele, as
    // condições de resultado operacional e de base não foram avaliadas, e a
    // ausência de alertas não pode virar "tudo certo".
    const complete = alertSourcesComplete(
      [accounts, cashForAlerts, cards, debts]);
    alerts = complete ?
      {status: items.length === 0 ? "zero" : "exact", data: {items}} :
      {status: "truncated", reason: "partial_sources", data: {items}};
  }

  return {
    schemaVersion: 1,
    workspaceType,
    generatedAt: now.toISOString(),
    timezone: "America/Sao_Paulo",
    currency: "BRL",
    referenceDate: today,
    period: resolved.period,
    permissions: {investments: canReadInvestments},
    accounts: requested.has("accounts") ? accounts : notRequested(),
    cash,
    kpis,
    series,
    categories,
    cards: requested.has("cards") ? cards : notRequested(),
    debts: requested.has("debts") ? debts : notRequested(),
    investments: requested.has("investments") ? investments : notRequested(),
    alerts,
  };
};
