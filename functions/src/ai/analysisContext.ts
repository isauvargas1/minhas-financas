import type {
  AccountsReport,
  CardsReport,
  CashReport,
  CategoriesReport,
  DebtsReport,
  FinancialReport,
  InvestmentsReport,
  KpiReport,
  ReportAlert,
  ReportPeriod,
  ReportSectionResult,
  ReportSectionStatus,
} from "../reports/contract";

/**
 * Contexto financeiro mínimo enviado ao consultor de IA (D-11.1, D-37).
 *
 * Módulo PURO (sem Firestore, sem rede): recebe o relatório financeiro
 * oficial (`FinancialReport`) e devolve só o necessário para a análise.
 *
 * Regras:
 * - Toda grandeza monetária vem dos campos `*Cents` (inteiros) e toda razão
 *   dos `*BasisPoints`; a formatação em BRL é feita no fim, só com
 *   aritmética inteira (nunca `toFixed` em valor monetário).
 * - A cobertura de cada bloco é preservada. Bloco `unavailable`,
 *   `rebuild_needed`, `not_requested` ou com `data === null` NÃO leva nenhum
 *   número ao contexto (nunca um zero no lugar). `sample` e `truncated` levam
 *   os números com a etiqueta de parcial; `zero` é zero verdadeiro.
 * - Minimização: sem IDs, nomes de cartões, clientes (`topClients`), séries
 *   mensais nem `generatedAt`. Nenhum texto livre de registro vai ao
 *   contexto: o nome de categoria é digitado pelo usuário e pode conter dado
 *   pessoal (sanitizar não é anonimizar), então as categorias de despesa
 *   entram só como "Grupo de despesas N" (posição no ranking por valor), sem
 *   nome, ID nem chave.
 * - Regras de interpretação (vão para o prompt em outra camada; aqui só se
 *   evita misturar campos): pagamento de fatura de cartão NÃO é despesa
 *   operacional; resultado operacional de caixa NÃO é lucro contábil;
 *   empréstimo concedido e recebível em aberto NÃO são dívida nem dinheiro
 *   recebido.
 */

/** Versão do formato do contexto (muda se a estrutura mudar). */
export const ANALYSIS_CONTEXT_VERSION = 2;

/**
 * Blocos do relatório que o consultor pede (sem `series`: séries mensais
 * não vão ao contexto).
 */
export const ANALYSIS_REPORT_SECTIONS = [
  "accounts",
  "cash",
  "kpis",
  "categories",
  "cards",
  "debts",
  "investments",
  "alerts",
] as const;

/** Quantidade de categorias de despesa enviadas. */
export const ANALYSIS_TOP_CATEGORIES = 5;

export type CoverageLabel =
  | "completo"
  | "sem movimento"
  | "parcial (amostra)"
  | "parcial (leitura truncada)"
  | "indisponível"
  | "aguardando reconstrução"
  | "não solicitado";

/** Bloco do contexto: cobertura sempre presente; `data` só com números. */
export interface AnalysisBlock<T> {
  coverage: CoverageLabel;
  /** `null` quando o bloco não tem nenhum número a entregar. */
  data: T | null;
}

export interface AnalysisPeriod {
  label: string;
  startDate: string | null;
  endDate: string;
  referenceDate: string;
  dayCount: number;
}

export interface AnalysisLoanBucket {
  balanceCents: number;
  count: number;
  overdueBalanceCents: number;
  overdueCount: number;
}

/** Recebíveis comerciais (agregados; nenhum cliente nem ID). */
export interface AnalysisReceivables {
  openCents: number;
  openCount: number;
  overdueCents: number;
  overdueCount: number;
  dueNext30Cents: number;
  receivedCents: number;
  receivedCount: number;
}

/** Categoria de despesa identificada só pela posição no ranking por valor. */
export interface AnalysisCategory {
  /** Posição 1..N no ranking por valor (sem nome, ID nem chave). */
  rank: number;
  amountCents: number;
  shareBasisPoints: number | null;
}

export interface AnalysisAlert {
  code: ReportAlert["code"];
  severity: ReportAlert["severity"];
  values: Record<string, number>;
}

export type AnalysisPatrimony =
  | {
    permitted: true;
    currentValueCents: number;
    costCents: number;
    unrealizedResultCents: number;
  }
  | {permitted: false};

export interface AnalysisContext {
  version: typeof ANALYSIS_CONTEXT_VERSION;
  /** Sempre `report.workspaceType` (nunca outra fonte). */
  workspaceType: "PF" | "PJ";
  period: AnalysisPeriod;
  accounts: AnalysisBlock<AccountsReport>;
  /**
   * Caixa: `cardPaymentsCents` (pagamento de fatura) é saída de caixa, não
   * despesa operacional; `operationalResultCents` não é lucro contábil.
   */
  cash: AnalysisBlock<CashReport>;
  kpis: AnalysisBlock<KpiReport>;
  categories: AnalysisBlock<{topExpenses: AnalysisCategory[]}>;
  /** Só agregados: nenhum item de `cards[]` nem série de compras. */
  cards: AnalysisBlock<{
    purchases: CardsReport["purchases"];
    payments: CardsReport["payments"];
    obligations: CardsReport["obligations"];
    limits: CardsReport["limits"];
  }>;
  debts: AnalysisBlock<{
    loansBorrowed: AnalysisLoanBucket;
    loansLent: AnalysisLoanBucket;
    cardObligationsCents: number | null;
    receivables: AnalysisReceivables;
  }>;
  investments: AnalysisBlock<{
    flows: InvestmentsReport["flows"];
    patrimony: AnalysisPatrimony;
  }>;
  alerts: AnalysisBlock<{items: AnalysisAlert[]}>;
}

const COVERAGE_LABELS: Record<ReportSectionStatus, CoverageLabel> = {
  exact: "completo",
  zero: "sem movimento",
  sample: "parcial (amostra)",
  truncated: "parcial (leitura truncada)",
  unavailable: "indisponível",
  rebuild_needed: "aguardando reconstrução",
  not_requested: "não solicitado",
};

/** Traduz o status de cobertura do relatório para o rótulo em pt-BR. */
export const coverageLabelOf = (
  status: ReportSectionStatus,
): CoverageLabel => COVERAGE_LABELS[status];

const assertSafeInteger = (value: number, what: string): void => {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${what}: esperado inteiro seguro, recebido ${value}.`);
  }
};

const groupThousands = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Formata centavos inteiros em BRL por aritmética inteira (sem `toFixed`).
 * Ex.: 123456 -> "R$ 1.234,56"; -1000 -> "-R$ 10,00".
 */
export const formatCentsBRL = (cents: number): string => {
  assertSafeInteger(cents, "Valor em centavos");
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const rest = abs % 100;
  const reais = (abs - rest) / 100;
  const body = `R$ ${groupThousands(String(reais))},` +
    String(rest).padStart(2, "0");
  return negative ? `-${body}` : body;
};

/**
 * Formata pontos-base inteiros como percentual com 2 casas.
 * Ex.: 1234 -> "12,34%"; -50 -> "-0,50%".
 */
export const formatBasisPoints = (basisPoints: number): string => {
  assertSafeInteger(basisPoints, "Pontos-base");
  const negative = basisPoints < 0;
  const abs = Math.abs(basisPoints);
  const rest = abs % 100;
  const whole = (abs - rest) / 100;
  const body = `${groupThousands(String(whole))},` +
    `${String(rest).padStart(2, "0")}%`;
  return negative ? `-${body}` : body;
};

/** Os mesmos rótulos do seletor de período dos Relatórios. */
const PRESET_LABELS: Record<string, string> = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 3 meses",
  "12m": "Últimos 12 meses",
  "ytd": "Ano Atual",
  "all": "Todo o Período",
};

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Rótulo do período em pt-BR (preset ou "outubro de 2026"). */
export const periodLabelOf = (period: ReportPeriod): string => {
  const range = period.range;
  if (range.kind === "preset") return PRESET_LABELS[range.preset];
  const [year, month] = range.month.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} de ${year}`;
};

/**
 * Projeta um bloco do relatório. Sem número confiável (`unavailable`,
 * `rebuild_needed`, `not_requested` ou `data === null`) devolve só a
 * cobertura; um bloco que se diz completo/parcial mas veio sem dados é
 * tratado como "indisponível" (nunca "completo" sem números).
 */
const projectBlock = <T, U>(
  result: ReportSectionResult<T>,
  project: (data: T) => U,
): AnalysisBlock<U> => {
  const withoutNumbers = result.status === "unavailable" ||
    result.status === "rebuild_needed" ||
    result.status === "not_requested";
  if (withoutNumbers) {
    return {coverage: coverageLabelOf(result.status), data: null};
  }
  if (result.data === null || result.data === undefined) {
    return {coverage: coverageLabelOf("unavailable"), data: null};
  }
  return {
    coverage: coverageLabelOf(result.status),
    data: project(result.data),
  };
};

/**
 * Dívidas sem as obrigações de cartão (fonte de cartões indisponível) não
 * são um total completo: nunca "completo" nem "sem movimento". O relatório
 * já marca o bloco como truncado; esta guarda mantém a regra no contexto.
 */
type DebtsBlock = AnalysisContext["debts"];

const withPartialCardObligations = (block: DebtsBlock): DebtsBlock => {
  const partial = block.data !== null &&
    block.data.cardObligationsCents === null &&
    (block.coverage === "completo" || block.coverage === "sem movimento");
  return partial ?
    {coverage: coverageLabelOf("truncated"), data: block.data} :
    block;
};

const pickLoanBucket = (
  bucket: DebtsReport["loansBorrowed"],
): AnalysisLoanBucket => ({
  balanceCents: bucket.balanceCents,
  count: bucket.count,
  overdueBalanceCents: bucket.overdueBalanceCents,
  overdueCount: bucket.overdueCount,
});

/**
 * Maiores despesas por categoria, SEM nome, ID nem chave: o nome e a chave
 * da categoria nunca são lidos. A ordenação é estável só por valor
 * decrescente: empates mantêm a ordem do relatório oficial (valor e chave da
 * categoria), que já vem ordenado.
 */
const topExpenseCategories = (
  data: CategoriesReport,
): AnalysisCategory[] =>
  data.expense
    .map((item) => ({
      amountCents: item.amountCents,
      shareBasisPoints: item.shareBasisPoints,
    }))
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, ANALYSIS_TOP_CATEGORIES)
    .map((item, index) => ({rank: index + 1, ...item}));

/** Rótulo genérico do grupo de despesas na posição `rank` do ranking. */
export const analysisCategoryGroupLabel = (rank: number): string =>
  `Grupo de despesas ${rank}`;

/**
 * Constrói o contexto mínimo a partir do relatório oficial.
 *
 * Mapeamento de campos (nomes reais de `contract.ts`): caixa usa `financial`
 * (`incomeCents`/`expenseCents`/`resultCents`) e `patrimonial`; cartões usam
 * `purchases`, `payments`, `obligations` e `limits`; dívidas usam
 * `loansBorrowed`, `loansLent`, `cardObligationsCents` e `receivables`.
 * O patrimônio só entra com `permissions.investments === true` e
 * `patrimony !== null`; `evolution` e `reconciliationDifferenceCents`
 * nunca entram.
 */
export const buildAnalysisContext = (
  report: FinancialReport,
): AnalysisContext => {
  const canReadPatrimony = report.permissions.investments === true;
  return {
    version: ANALYSIS_CONTEXT_VERSION,
    workspaceType: report.workspaceType,
    period: {
      label: periodLabelOf(report.period),
      startDate: report.period.startDate,
      endDate: report.period.endDate,
      referenceDate: report.referenceDate,
      dayCount: report.period.dayCount,
    },
    accounts: projectBlock(report.accounts, (data) => ({
      totalBalanceCents: data.totalBalanceCents,
      accountCount: data.accountCount,
      negativeAccountCount: data.negativeAccountCount,
    })),
    cash: projectBlock(report.cash, (data) => ({
      receiptsCents: data.receiptsCents,
      paymentsCents: data.paymentsCents,
      operationalResultCents: data.operationalResultCents,
      financial: {
        incomeCents: data.financial.incomeCents,
        expenseCents: data.financial.expenseCents,
        resultCents: data.financial.resultCents,
      },
      patrimonial: {
        investmentOutflowCents: data.patrimonial.investmentOutflowCents,
        investmentInflowCents: data.patrimonial.investmentInflowCents,
        loanPrincipalInflowCents: data.patrimonial.loanPrincipalInflowCents,
        loanPrincipalOutflowCents: data.patrimonial.loanPrincipalOutflowCents,
      },
      cardPaymentsCents: data.cardPaymentsCents,
      netFlowCents: data.netFlowCents,
      transactionCount: data.transactionCount,
    })),
    kpis: projectBlock(report.kpis, (data) => ({
      operationalMarginBasisPoints: data.operationalMarginBasisPoints,
      netContributionRateBasisPoints: data.netContributionRateBasisPoints,
      netContributionRateReason: data.netContributionRateReason,
    })),
    categories: projectBlock(report.categories, (data) => ({
      topExpenses: topExpenseCategories(data),
    })),
    cards: projectBlock(report.cards, (data) => ({
      purchases: {
        netCents: data.purchases.netCents,
        count: data.purchases.count,
      },
      payments: {
        paidCents: data.payments.paidCents,
        reversedCents: data.payments.reversedCents,
        netCents: data.payments.netCents,
      },
      obligations: {...data.obligations},
      limits: {...data.limits},
    })),
    debts: withPartialCardObligations(projectBlock(report.debts, (data) => ({
      loansBorrowed: pickLoanBucket(data.loansBorrowed),
      loansLent: pickLoanBucket(data.loansLent),
      cardObligationsCents: data.cardObligationsCents,
      receivables: {
        openCents: data.receivables.openCents,
        openCount: data.receivables.openCount,
        overdueCents: data.receivables.overdueCents,
        overdueCount: data.receivables.overdueCount,
        dueNext30Cents: data.receivables.dueNext30Cents,
        receivedCents: data.receivables.receivedCents,
        receivedCount: data.receivables.receivedCount,
      },
    }))),
    investments: projectBlock(report.investments, (data) => ({
      flows: {...data.flows},
      patrimony: canReadPatrimony && data.patrimony !== null ?
        {
          permitted: true as const,
          currentValueCents: data.patrimony.currentValueCents,
          costCents: data.patrimony.costCents,
          unrealizedResultCents: data.patrimony.unrealizedResultCents,
        } :
        {permitted: false as const},
    })),
    alerts: projectBlock(report.alerts, (data) => ({
      items: data.items.map((item) => ({
        code: item.code,
        severity: item.severity,
        values: {...item.values},
      })),
    })),
  };
};

const NOT_CALCULABLE = "não calculável";
const UNAVAILABLE = "indisponível";

const NET_CONTRIBUTION_REASONS: Record<string, string> = {
  no_receipts: "sem recebimentos no período",
  investments_unavailable: "investimentos indisponíveis",
};

const renderLoanBucket = (
  bucket: AnalysisLoanBucket,
  balanceKey: string,
): Record<string, string | number> => ({
  [balanceKey]: formatCentsBRL(bucket.balanceCents),
  quantidade: bucket.count,
  saldoVencido: formatCentsBRL(bucket.overdueBalanceCents),
  quantidadeVencida: bucket.overdueCount,
});

const renderAlertValue = (key: string, value: number): string | number => {
  if (key.endsWith("Cents")) return formatCentsBRL(value);
  assertSafeInteger(value, `Valor do alerta "${key}"`);
  return value;
};

type Rendered = Record<string, unknown>;

/** Cobertura primeiro; os números só entram quando o bloco os tem. */
const renderBlock = <T>(
  block: AnalysisBlock<T>,
  render: (data: T) => Rendered,
): Rendered => {
  if (block.data === null) return {cobertura: block.coverage};
  return {cobertura: block.coverage, ...render(block.data)};
};

/**
 * Renderiza o contexto como bloco de dados para o prompt: JSON com chaves
 * em português, valores monetários formatados em BRL, razões em percentual
 * e contagens como inteiros. Blocos sem dados mostram só a cobertura.
 */
export const renderAnalysisData = (context: AnalysisContext): string => {
  const rendered: Rendered = {
    versao: context.version,
    perfil: context.workspaceType,
    periodo: {
      rotulo: context.period.label,
      dataInicial: context.period.startDate,
      dataFinal: context.period.endDate,
      dataReferencia: context.period.referenceDate,
      quantidadeDias: context.period.dayCount,
    },
    contas: renderBlock(context.accounts, (d) => ({
      saldoTotal: formatCentsBRL(d.totalBalanceCents),
      quantidadeContas: d.accountCount,
      contasNegativas: d.negativeAccountCount,
    })),
    caixa: renderBlock(context.cash, (d) => ({
      recebimentos: formatCentsBRL(d.receiptsCents),
      pagamentos: formatCentsBRL(d.paymentsCents),
      resultadoOperacional: formatCentsBRL(d.operationalResultCents),
      financeiro: {
        receitas: formatCentsBRL(d.financial.incomeCents),
        despesas: formatCentsBRL(d.financial.expenseCents),
        resultado: formatCentsBRL(d.financial.resultCents),
      },
      patrimonial: {
        saidaInvestimentos:
          formatCentsBRL(d.patrimonial.investmentOutflowCents),
        entradaInvestimentos:
          formatCentsBRL(d.patrimonial.investmentInflowCents),
        entradaPrincipalEmprestimos:
          formatCentsBRL(d.patrimonial.loanPrincipalInflowCents),
        saidaPrincipalEmprestimos:
          formatCentsBRL(d.patrimonial.loanPrincipalOutflowCents),
      },
      pagamentosFaturaCartao: formatCentsBRL(d.cardPaymentsCents),
      fluxoLiquido: formatCentsBRL(d.netFlowCents),
      quantidadeLancamentos: d.transactionCount,
    })),
    indicadores: renderBlock(context.kpis, (d) => {
      const rate = d.netContributionRateBasisPoints;
      const reason = d.netContributionRateReason === null ?
        undefined :
        NET_CONTRIBUTION_REASONS[d.netContributionRateReason];
      const out: Rendered = {
        margemOperacional: d.operationalMarginBasisPoints === null ?
          NOT_CALCULABLE :
          formatBasisPoints(d.operationalMarginBasisPoints),
        taxaAportesLiquidos: rate === null ?
          NOT_CALCULABLE :
          formatBasisPoints(rate),
      };
      if (rate === null && reason !== undefined) {
        out.motivoTaxaAportesLiquidos = reason;
      }
      return out;
    }),
    categorias: renderBlock(context.categories, (d) => ({
      maioresDespesas: d.topExpenses.map((item) => ({
        grupo: analysisCategoryGroupLabel(item.rank),
        valor: formatCentsBRL(item.amountCents),
        participacao: item.shareBasisPoints === null ?
          NOT_CALCULABLE :
          formatBasisPoints(item.shareBasisPoints),
      })),
    })),
    cartoes: renderBlock(context.cards, (d) => ({
      comprasLiquidas: {
        valor: formatCentsBRL(d.purchases.netCents),
        quantidade: d.purchases.count,
      },
      pagamentosFatura: {
        pago: formatCentsBRL(d.payments.paidCents),
        estornado: formatCentsBRL(d.payments.reversedCents),
        liquido: formatCentsBRL(d.payments.netCents),
      },
      obrigacoes: {
        ciclosAbertos: formatCentsBRL(d.obligations.openCyclesCents),
        fechadasNaoPagas: formatCentsBRL(d.obligations.closedUnpaidCents),
        emAtraso: formatCentsBRL(d.obligations.overdueCents),
        quantidadeEmAtraso: d.obligations.overdueCount,
        quantidadeParcialmentePagas: d.obligations.partiallyPaidCount,
        restanteParcialmentePagas:
          formatCentsBRL(d.obligations.partiallyPaidRemainingCents),
        vencendoEm7Dias: formatCentsBRL(d.obligations.dueNext7Cents),
        vencendoEm15Dias: formatCentsBRL(d.obligations.dueNext15Cents),
        vencendoEm30Dias: formatCentsBRL(d.obligations.dueNext30Cents),
        totalEmAberto: formatCentsBRL(d.obligations.totalOutstandingCents),
        creditoNaoAplicado: formatCentsBRL(d.obligations.openCreditCents),
      },
      limites: {
        total: formatCentsBRL(d.limits.totalCents),
        usado: formatCentsBRL(d.limits.usedCents),
        disponivel: formatCentsBRL(d.limits.availableCents),
        utilizacao: d.limits.utilizationBasisPoints === null ?
          NOT_CALCULABLE :
          formatBasisPoints(d.limits.utilizationBasisPoints),
      },
    })),
    dividas: renderBlock(context.debts, (d) => ({
      emprestimosTomados: renderLoanBucket(d.loansBorrowed, "saldoDevedor"),
      emprestimosConcedidos:
        renderLoanBucket(d.loansLent, "saldoAReceber"),
      obrigacoesCartao: d.cardObligationsCents === null ?
        UNAVAILABLE :
        formatCentsBRL(d.cardObligationsCents),
      recebiveis: {
        emAberto: formatCentsBRL(d.receivables.openCents),
        quantidadeEmAberto: d.receivables.openCount,
        vencidos: formatCentsBRL(d.receivables.overdueCents),
        quantidadeVencidos: d.receivables.overdueCount,
        vencendoEm30Dias: formatCentsBRL(d.receivables.dueNext30Cents),
        recebido: formatCentsBRL(d.receivables.receivedCents),
        quantidadeRecebida: d.receivables.receivedCount,
      },
    })),
    investimentos: renderBlock(context.investments, (d) => ({
      fluxos: {
        aportes: formatCentsBRL(d.flows.contributionsCents),
        resgatesPrincipal:
          formatCentsBRL(d.flows.redemptionsPrincipalCents),
        aportesLiquidos: formatCentsBRL(d.flows.netContributionsCents),
        ganhoRealizado: formatCentsBRL(d.flows.realizedGainCents),
        perdaRealizada: formatCentsBRL(d.flows.realizedLossCents),
        resultadoRealizado: formatCentsBRL(d.flows.realizedResultCents),
        taxas: formatCentsBRL(d.flows.feesCents),
        impostos: formatCentsBRL(d.flows.taxCents),
      },
      patrimonio: d.patrimony.permitted ?
        {
          valorAtual: formatCentsBRL(d.patrimony.currentValueCents),
          custo: formatCentsBRL(d.patrimony.costCents),
          resultadoNaoRealizado:
            formatCentsBRL(d.patrimony.unrealizedResultCents),
        } :
        "sem permissão",
    })),
    alertas: renderBlock(context.alerts, (d) => ({
      itens: d.items.map((item) => ({
        codigo: item.code,
        severidade: item.severity,
        valores: Object.fromEntries(
          Object.entries(item.values)
            .map(([key, value]) => [key, renderAlertValue(key, value)]),
        ),
      })),
    })),
  };
  return JSON.stringify(rendered, null, 2);
};
