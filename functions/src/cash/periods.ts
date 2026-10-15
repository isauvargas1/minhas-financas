import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {
  cardPaymentCashEffect,
  readCardPaymentCashEntry,
} from "../cards/cashEffect";
import {loanCashEffect, readLoanCashEntry} from "../loans/cashEffect";
import {CASH_ENTRY_MAX_CENTS} from "./contracts";
import {
  readReceivableCashEntry,
  receivableCashEffect,
} from "../receivables/cashEffect";
import {
  isDayKey,
  saoPauloMonthStart,
} from "../shared/dateKeys";
import {RETENTION_DAYS, expiresInDays} from "../shared/retention";
import {readSplitCashEntry, splitCashEffect} from "../splitBills/cashEffect";
import {
  investmentCashEffect,
  readInvestmentCashEntry,
} from "../investments/cashEffect";

/**
 * Projeção mensal de caixa por workspace (INV-P1-011).
 *
 * `getTransactions` lia a subcoleção **inteira** de transações no fluxo
 * principal — dashboard, relatórios, metas e alocações partiam todos desse
 * mesmo array. Custo e latência lineares no histórico, e o módulo de
 * investimentos agrava a coleção com um espelho por movimento.
 *
 * Paginar por período resolve todos os consumidores **menos um**: o progresso
 * de meta PJ do tipo `caixa_minimo`, que é o saldo de caixa acumulado desde
 * sempre. Um agregado global não se pagina; ele precisa de projeção.
 *
 * Esta é a projeção. Ela é mantida por delta pelo próprio gatilho de escrita
 * de transações, o que a torna exata e incremental: cada escrita aplica
 * `depois − antes`, e uma transação que muda de mês sai de um período e entra
 * no outro. O saldo global passa a ser a soma de um punhado de documentos
 * mensais em vez de uma varredura do histórico.
 *
 * O documento é reconstrutível a partir do próprio ledger de transações
 * (`rebuildCashPeriods`), como exige a integridade do domínio: nenhum
 * acumulador opaco sem caminho de reconstrução.
 */

export const CASH_PERIODS_COLLECTION = "cash_report_periods";

/**
 * Marca de entrega já aplicada (INV-P3-001).
 *
 * O gatilho de transações é entregue **pelo menos** uma vez: o Eventarc
 * reentrega o mesmo `event.id` quando a execução anterior não confirmou a
 * tempo. O período é mantido por `FieldValue.increment`, então uma reentrega
 * somava o mesmo delta de novo e o saldo acumulado do workspace passava a
 * mentir — sem erro, sem log, e sem nada que o distinguisse de um lançamento
 * real. `rebuildCashPeriods` corrigia, mas reconciliação não é defesa: ela é o
 * que se roda **depois** de já se ter percebido a divergência.
 *
 * A defesa é esta coleção. Cada entrega grava um documento cujo ID é o
 * `event.id` **em hash**, na mesma transação em que o delta é aplicado. A
 * segunda entrega encontra a marca e não aplica nada.
 */
export const CASH_PERIOD_EVENTS_COLLECTION = "cash_period_events";

/**
 * Totais de um mês. P3-G (D-13) acrescentou, de forma aditiva, os quatro
 * campos de empréstimos: o principal tomado ou concedido e sua amortização
 * entram como fluxo de principal (`loanPrincipal*`), e os juros como
 * resultado financeiro (`financial*`), nunca em `incomeCents`/`expenseCents`
 * (operacionais). Documentos e marcas de entrega anteriores não têm esses
 * campos: valem zero, que é o valor correto (não havia espelho de
 * empréstimo autoritativo antes da P3-G). `netCents` continua o saldo do
 * mês, com todos os fluxos.
 *
 * P4-A acrescentou, também de forma aditiva, `creditCardPaymentCents`: o
 * pagamento de fatura de cartão é liquidação do cartão (sai do caixa, entra
 * em `netCents`), nunca despesa operacional — a despesa de consumo é a
 * compra, reconhecida no domínio de cartões. Campo ausente vale zero, que é o
 * valor correto: não havia pagamento de fatura autoritativo antes da P4-A.
 *
 * P4-D (D-15) acrescentou `investmentInflowCents`: o principal da retirada
 * de investimento recebida volta ao caixa sem ser receita operacional; o
 * rendimento dela é resultado financeiro (`financialIncomeCents`). O aporte
 * liquidado continua em `investmentOutflowCents`.
 */
export interface CashPeriodDelta {
  incomeCents: number;
  expenseCents: number;
  investmentOutflowCents: number;
  investmentInflowCents: number;
  loanPrincipalInflowCents: number;
  loanPrincipalOutflowCents: number;
  financialIncomeCents: number;
  financialExpenseCents: number;
  creditCardPaymentCents: number;
  netCents: number;
  transactionCount: number;
}

/** Campos somáveis da projeção, na ordem de gravação. */
export const CASH_DELTA_FIELDS = [
  "incomeCents",
  "expenseCents",
  "investmentOutflowCents",
  "investmentInflowCents",
  "loanPrincipalInflowCents",
  "loanPrincipalOutflowCents",
  "financialIncomeCents",
  "financialExpenseCents",
  "creditCardPaymentCents",
  "netCents",
  "transactionCount",
] as const satisfies readonly (keyof CashPeriodDelta)[];

/**
 * Versão do formato do documento mensal: 2 = campos de empréstimos;
 * 3 = pagamento de fatura de cartão (P4-A); 4 = entrada de investimento
 * (P4-D); 5 = detalhe diário (`days`, P5-C1). O leitor do relatório só
 * aceita a versão 5 com Σ dias = mês.
 */
export const CASH_PERIOD_SCHEMA_VERSION = 5;

export const emptyCashPeriodDelta = (): CashPeriodDelta => ({
  incomeCents: 0,
  expenseCents: 0,
  investmentOutflowCents: 0,
  investmentInflowCents: 0,
  loanPrincipalInflowCents: 0,
  loanPrincipalOutflowCents: 0,
  financialIncomeCents: 0,
  financialExpenseCents: 0,
  creditCardPaymentCents: 0,
  netCents: 0,
  transactionCount: 0,
});

const ZERO_DELTA: CashPeriodDelta = Object.freeze(emptyCashPeriodDelta());

/**
 * Lê um delta gravado (marca de entrega, documento mensal): campo ausente ou
 * não inteiro vale zero. A soma é por campo e a lista de campos cresce com o
 * domínio (empréstimos na P3-G, `investmentInflowCents` na P4-D); a leitura
 * não supõe que um documento já tenha um campo — não é compatibilidade com
 * dado antigo, que não existe.
 */
export const normalizeCashPeriodDelta = (
  value: Partial<Record<keyof CashPeriodDelta, unknown>> | undefined,
): CashPeriodDelta => {
  const delta = emptyCashPeriodDelta();
  for (const field of CASH_DELTA_FIELDS) {
    const raw = value?.[field];
    delta[field] = Number.isSafeInteger(raw) ? raw as number : 0;
  }
  return delta;
};

/**
 * Documento de `transactions` fora do contrato único (P5-C2, PR-TX-03): sem
 * `valueCents` inteiro, sem `date` civil válido, com tipo desconhecido (o
 * `parcelado` legado inclusive) ou com marca de domínio ilegível.
 *
 * Nenhum produtor grava esse documento (todo escritor é backend e valida a
 * entrada); se aparecer, nunca vira R$ 0,00 em silêncio: o gatilho o trata
 * como falha permanente e marca a projeção para reconstrução
 * (`contract_violation`), e a reconstrução recusa publicar. A mensagem não
 * leva dado do documento.
 */
export class CashContractViolationError extends Error {
  constructor(readonly field: "valueCents" | "date" | "type" | "marker") {
    super(`transação fora do contrato: ${field}`);
    this.name = "CashContractViolationError";
  }
}

/**
 * Valor da transação em centavos exatos: só `valueCents`, inteiro seguro,
 * não negativo (o sinal vem do tipo ou da marca de domínio) e até o teto da
 * entrada de todo produtor de receita e despesa (`CASH_ENTRY_MAX_CENTS`). Não
 * existe outra representação — sem `value` em reais, sem arredondamento. O
 * espelho de investimento tem o próprio teto (o do movimento), conferido
 * contra a marca em `cashPeriodDeltaFor`.
 */
export const transactionValueCents = (
  data: admin.firestore.DocumentData,
  maxCents: number = CASH_ENTRY_MAX_CENTS,
): number => {
  const cents = data.valueCents;
  if (!Number.isSafeInteger(cents) || (cents as number) < 0 ||
    (cents as number) > maxCents) {
    throw new CashContractViolationError("valueCents");
  }
  return cents as number;
};

/** Receita ou despesa: o tipo de todo documento sem `investmentEntry`. */
const assertOperationalType = (data: admin.firestore.DocumentData): void => {
  if (data.type !== "receita" && data.type !== "despesa") {
    // `investimento` sem a marca, `parcelado` legado ou tipo desconhecido.
    throw new CashContractViolationError("type");
  }
};

/** Baixa lógica (INV-P2-032): o documento permanece, o fato não conta. */
export const isVoidedTransaction = (
  data: admin.firestore.DocumentData,
): boolean => data.voidedAt !== undefined && data.voidedAt !== null;

/**
 * Receita ou despesa ainda não liquidada (D-29, P3-F): pendente, agendada ou
 * vencida sem confirmação. `isPaid: false` é a evidência explícita, gravada
 * pelo backend (`cashEntry.status: pending` e espelho de investimento
 * pendente); todo produtor atual grava `isPaid`. Ausência do campo não é
 * evidência de pendência: é lida como realizada, a mesma regra do frontend
 * (`FINANCIAL_DOMAIN_MODEL.md`).
 */
export const isUnsettledCashEntry = (
  data: admin.firestore.DocumentData,
): boolean => {
  if (data.isPaid === false) return true;
  const entry = data.cashEntry as Record<string, unknown> | undefined;
  return typeof entry === "object" && entry !== null &&
    entry.status === "pending";
};

/**
 * Efeito da transação sobre o caixa **realizado**, em centavos com sinal.
 *
 * D-29 (P3-F): só receita e despesa liquidadas movem o caixa; pendente e
 * agendado não, nem depois do vencimento — o avanço do calendário não cria
 * movimento. A confirmação passa a valer no mês da data efetiva (`date`).
 *
 * Espelha `transactionCashImpactCents` do frontend. O espelho de
 * investimento (P4-D, D-15) é classificado só pela marca backend-only
 * `investmentEntry` (`investmentCashEffect`): aporte liquidado sai como
 * `investmentOutflowCents`, retirada recebida entra como
 * `investmentInflowCents` (principal) e `financialIncomeCents` (rendimento),
 * pendente e cancelado não movem caixa e o estorno compensa.
 *
 * Contrato único (P5-C2), avaliado em todo documento não anulado, com ou
 * sem marca de domínio: fora dele — marca ilegível, `investimento` sem a
 * marca (ou a marca em outro tipo), marca de empréstimo, cartão, recebível
 * ou divisão em tipo diferente de receita/despesa, tipo desconhecido (o
 * `parcelado` legado inclusive: a compra de cartão vive em
 * `credit_card_purchases`), `valueCents` inválido ou acima do teto, ou, no
 * espelho de investimento, diferente do valor da marca — lança
 * `CashContractViolationError`, nunca efeito zero. Só a baixa lógica, o
 * pendente e o investimento pendente/cancelado valem zero por regra.
 */
export const cashPeriodDeltaFor = (
  data: admin.firestore.DocumentData | undefined,
): CashPeriodDelta => {
  if (!data) return ZERO_DELTA;
  if (isVoidedTransaction(data)) return ZERO_DELTA;

  // Espelho de empréstimo (P3-G, D-13): a marca backend-only decide.
  if (data.loanEntry !== undefined) {
    const entry = readLoanCashEntry(data.loanEntry);
    if (!entry) throw new CashContractViolationError("marker");
    assertOperationalType(data);
    transactionValueCents(data);
    return {...emptyCashPeriodDelta(), ...loanCashEffect(entry),
      transactionCount: 1};
  }

  // Pagamento de fatura de cartão (P4-A): liquidação do cartão, fora de
  // receita e despesa operacionais; move só o caixa.
  if (data.creditCardPaymentEntry !== undefined) {
    const entry = readCardPaymentCashEntry(data.creditCardPaymentEntry);
    if (!entry) throw new CashContractViolationError("marker");
    assertOperationalType(data);
    transactionValueCents(data);
    return {...emptyCashPeriodDelta(), ...cardPaymentCashEffect(entry),
      transactionCount: 1};
  }

  // Espelho de recebimento (P3-I, D-39): principal é receita operacional,
  // juros e multa são receita financeira, desconto não move caixa.
  if (data.receivableEntry !== undefined) {
    const entry = readReceivableCashEntry(data.receivableEntry);
    if (!entry) throw new CashContractViolationError("marker");
    assertOperationalType(data);
    transactionValueCents(data);
    return {...emptyCashPeriodDelta(), ...receivableCashEffect(entry),
      transactionCount: 1};
  }

  // Espelho da Divisão de contas (P4-C): título pago pelo Caixa e reembolso
  // PJ pago são despesa operacional; a compensação tem sinal oposto.
  if (data.splitEntry !== undefined) {
    const entry = readSplitCashEntry(data.splitEntry);
    if (!entry) throw new CashContractViolationError("marker");
    assertOperationalType(data);
    transactionValueCents(data);
    return {...emptyCashPeriodDelta(), ...splitCashEffect(entry),
      transactionCount: 1};
  }

  // Espelho de investimento (P4-D, D-15): só a marca do backend decide; o
  // valor exibido (`valueCents`) é o da marca. Pendente e cancelado não
  // movem caixa; o estorno compensa.
  if (data.investmentEntry !== undefined) {
    const entry = readInvestmentCashEntry(data.investmentEntry);
    if (!entry) throw new CashContractViolationError("marker");
    if (data.type !== "investimento") {
      throw new CashContractViolationError("type");
    }
    if (transactionValueCents(data, Number.MAX_SAFE_INTEGER) !==
      entry.amountCents) {
      throw new CashContractViolationError("valueCents");
    }
    if (entry.status !== "settled") return ZERO_DELTA;
    return {...emptyCashPeriodDelta(), ...investmentCashEffect(entry),
      transactionCount: 1};
  }

  assertOperationalType(data);
  const type = data.type as "receita" | "despesa";
  const cents = transactionValueCents(data);
  if (isUnsettledCashEntry(data)) return ZERO_DELTA;

  if (type === "receita") {
    return {
      ...emptyCashPeriodDelta(),
      incomeCents: cents,
      expenseCents: 0,
      investmentOutflowCents: 0,
      netCents: cents,
      transactionCount: 1,
    };
  }
  return {
    ...emptyCashPeriodDelta(),
    incomeCents: 0,
    expenseCents: cents,
    investmentOutflowCents: 0,
    netCents: -cents,
    transactionCount: 1,
  };
};

/**
 * Dia civil da transação (`AAAA-MM-DD`, São Paulo): só `date`, a única data
 * civil do contrato (P5-C2, D-17). Já é a chave do dia — sem instante, sem
 * conversão de fuso. Data impossível ou ausente lança
 * `CashContractViolationError`. O mês da projeção é o prefixo deste dia —
 * dia e mês nunca discordam (P5-C1).
 */
export const cashDayKeyFor = (
  data: admin.firestore.DocumentData,
): string => {
  if (!isDayKey(data.date)) throw new CashContractViolationError("date");
  return data.date;
};

/** Chave mensal da transação (prefixo do dia civil). */
export const cashPeriodKeyFor = (
  data: admin.firestore.DocumentData,
): string => cashDayKeyFor(data).slice(0, 7);

// ------------------------------------------------------------- categorias

/**
 * Projeção por categoria (P5-C1, D-37.8): `cash_category_years`.
 *
 * Um documento por (geração, ano, categoria), com os totais do ano e o
 * detalhe por dia (`days.{MMDD}`), só para receita e despesa operacionais.
 * Nunca um documento com todas as categorias: o tamanho de cada um é
 * limitado pelos dias do ano (≤ 366 × 3 campos), e a quantidade de chaves
 * pelo teto do catálogo (2.000 itens por workspace) mais as três chaves
 * fixas abaixo.
 *
 * A geração existe por causa da reconstrução: a varredura prepara uma
 * geração nova enquanto o gatilho continua alimentando a vigente (e também a
 * preparada, para eventos posteriores ao corte); a publicação troca a
 * geração vigente no mesmo commit que publica os meses. O leitor só lê a
 * geração vigente.
 */
export const CASH_CATEGORY_YEARS_COLLECTION = "cash_category_years";
export const CASH_CATEGORY_SCHEMA_VERSION = 2;
/** Geração inicial: workspace que nunca reconstruiu a projeção. */
export const INITIAL_CATEGORY_GENERATION = "g0";

/** Sem `categoryId` válido: classificação explícita, nunca nome digitado. */
export const CATEGORY_KEY_UNCATEGORIZED = "sem_categoria";
/** Principal recebido de recebível (D-39): receita operacional de domínio. */
export const CATEGORY_KEY_RECEIVABLES = "dominio_recebiveis";
/** Despesa da Divisão de contas (P4-C): despesa operacional de domínio. */
export const CATEGORY_KEY_SPLIT = "dominio_divisao";

export const RESERVED_CATEGORY_KEYS: readonly string[] = [
  CATEGORY_KEY_UNCATEGORIZED,
  CATEGORY_KEY_RECEIVABLES,
  CATEGORY_KEY_SPLIT,
];

export type CashCategoryClassification =
  | "catalog"
  | "uncategorized"
  | "receivables"
  | "split";

/** ID de item do catálogo utilizável como chave (segmento de caminho). */
const CATALOG_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const isCatalogCategoryKey = (value: unknown): value is string =>
  typeof value === "string" &&
  CATALOG_ID_PATTERN.test(value) &&
  !RESERVED_CATEGORY_KEYS.includes(value);

export interface CashCategoryRef {
  categoryKey: string;
  categoryId: string | null;
  classification: CashCategoryClassification;
}

/**
 * Categoria de agregação da transação. A chave é sempre um ID estável:
 * o `categoryId` do catálogo (gravado e validado pelo backend na criação,
 * correção, importação ou recorrência) ou uma das chaves fixas. Renomear a
 * categoria não muda a chave; nenhum texto vira chave.
 */
export const cashCategoryRefFor = (
  data: admin.firestore.DocumentData,
): CashCategoryRef => {
  if (data.receivableEntry !== undefined) {
    return {
      categoryKey: CATEGORY_KEY_RECEIVABLES,
      categoryId: null,
      classification: "receivables",
    };
  }
  if (data.splitEntry !== undefined) {
    return {
      categoryKey: CATEGORY_KEY_SPLIT,
      categoryId: null,
      classification: "split",
    };
  }
  if (isCatalogCategoryKey(data.categoryId)) {
    return {
      categoryKey: data.categoryId,
      categoryId: data.categoryId,
      classification: "catalog",
    };
  }
  return {
    categoryKey: CATEGORY_KEY_UNCATEGORIZED,
    categoryId: null,
    classification: "uncategorized",
  };
};

/**
 * Delta da projeção por categoria. A contagem fica separada por lado: a mesma
 * chave fixa (ex.: `sem_categoria` de uma importação) pode ter receita e
 * despesa no mesmo dia, e um total único seria atribuído aos dois lados.
 */
export interface CashCategoryDelta {
  incomeCents: number;
  expenseCents: number;
  incomeCount: number;
  expenseCount: number;
}

export const CASH_CATEGORY_FIELDS = [
  "incomeCents",
  "expenseCents",
  "incomeCount",
  "expenseCount",
] as const satisfies readonly (keyof CashCategoryDelta)[];

export const emptyCashCategoryDelta = (): CashCategoryDelta => ({
  incomeCents: 0,
  expenseCents: 0,
  incomeCount: 0,
  expenseCount: 0,
});

export const normalizeCashCategoryDelta = (
  value: Partial<Record<keyof CashCategoryDelta, unknown>> | undefined,
): CashCategoryDelta => {
  const delta = emptyCashCategoryDelta();
  for (const field of CASH_CATEGORY_FIELDS) {
    const raw = value?.[field];
    delta[field] = Number.isSafeInteger(raw) ? raw as number : 0;
  }
  return delta;
};

export const cashCategoryYearDocId = (
  generation: string,
  year: string,
  categoryKey: string,
): string => `${generation}__${year}__${categoryKey}`;

export const cashCategoryYearRef = (
  workspaceId: string,
  generation: string,
  year: string,
  categoryKey: string,
): admin.firestore.DocumentReference =>
  admin.firestore().doc(
    `workspaces/${workspaceId}/${CASH_CATEGORY_YEARS_COLLECTION}/` +
      cashCategoryYearDocId(generation, year, categoryKey),
  );

// `|| 0` normaliza `-0`, que viraria "-R$ 0,00" num total somado.
const negate = (delta: CashPeriodDelta): CashPeriodDelta => {
  const result = emptyCashPeriodDelta();
  for (const field of CASH_DELTA_FIELDS) result[field] = -delta[field] || 0;
  return result;
};

const isZero = (delta: CashPeriodDelta): boolean =>
  CASH_DELTA_FIELDS.every((field) => delta[field] === 0);

export const cashPeriodRef = (
  workspaceId: string,
  period: string,
): admin.firestore.DocumentReference =>
  admin.firestore().doc(
    `workspaces/${workspaceId}/${CASH_PERIODS_COLLECTION}/${period}`,
  );

/**
 * Escritor mínimo comum entre `WriteBatch` e `Transaction`.
 *
 * As duas classes expõem `set`, mas com sobrecargas genéricas distintas, e a
 * união delas não é chamável. Declarar só o que é usado mantém as duas
 * compatíveis sem `any`.
 */
export interface CashPeriodWriter {
  set(
    ref: admin.firestore.DocumentReference,
    data: admin.firestore.DocumentData,
    options: admin.firestore.SetOptions,
  ): unknown;
}

export const addCashPeriodDelta = (
  left: CashPeriodDelta,
  right: CashPeriodDelta,
): CashPeriodDelta => {
  const result = emptyCashPeriodDelta();
  for (const field of CASH_DELTA_FIELDS) {
    result[field] = (left[field] ?? 0) + (right[field] ?? 0);
  }
  return result;
};

/**
 * Variação por período de uma escrita de transação, em centavos.
 *
 * Trata os quatro casos do gatilho — criação, alteração, alteração **com troca
 * de mês** e exclusão — com a mesma expressão: retira o efeito de `before` do
 * mês de `before` e soma o efeito de `after` no mês de `after`. Quando o mês
 * não muda, os dois se combinam num único delta. Períodos com delta nulo não
 * aparecem.
 *
 * É o que o gatilho aplica e o que a marca de entrega guarda (P3-B): a
 * reconstrução soma exatamente estes deltas para os eventos posteriores ao
 * corte, sem reler o ledger.
 */
export const cashPeriodDeltasFor = (
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
): Record<string, CashPeriodDelta> => {
  const deltas: Record<string, CashPeriodDelta> = {};
  // Todo documento não anulado tem `date` válido, com ou sem efeito (o
  // pendente inclusive); o anulado não é avaliado.
  const beforeDelta = cashPeriodDeltaFor(before);
  const afterDelta = cashPeriodDeltaFor(after);
  const beforePeriod = before && !isVoidedTransaction(before) ?
    cashPeriodKeyFor(before) : null;
  const afterPeriod = after && !isVoidedTransaction(after) ?
    cashPeriodKeyFor(after) : null;
  if (beforePeriod && !isZero(beforeDelta)) {
    deltas[beforePeriod] = negate(beforeDelta);
  }
  if (afterPeriod && !isZero(afterDelta)) {
    deltas[afterPeriod] = addCashPeriodDelta(
      deltas[afterPeriod] ?? ZERO_DELTA,
      afterDelta,
    );
  }
  for (const [period, delta] of Object.entries(deltas)) {
    if (isZero(delta)) delete deltas[period];
  }
  return deltas;
};

/** Detalhe diário de um mês: `DD` → delta, só com campos não nulos. */
export type CashDayDeltas = Record<string, Partial<CashPeriodDelta>>;

/** Entrada da projeção por categoria tocada por uma escrita. */
export interface CashCategoryWrite extends CashCategoryRef {
  year: string;
  totals: CashCategoryDelta;
  /** `MMDD` → delta, só com campos não nulos. */
  days: Record<string, Partial<CashCategoryDelta>>;
}

/**
 * Plano completo de uma escrita de transação (P5-C1): meses, dias e
 * categorias, todos derivados do **mesmo** par antes/depois. O total do mês
 * é, por construção, a soma dos dias do plano; o total de receita e despesa
 * operacionais do plano é a soma das categorias.
 */
export interface CashWritePlan {
  months: Record<string, CashPeriodDelta>;
  days: Record<string, CashDayDeltas>;
  categories: Record<string, CashCategoryWrite>;
}

const addPartial = <K extends string>(
  target: Partial<Record<K, number>>,
  delta: Record<K, number>,
  fields: readonly K[],
): void => {
  for (const field of fields) {
    // `|| 0` normaliza `-0`.
    const sum = (target[field] ?? 0) + delta[field] || 0;
    if (sum === 0) {
      delete target[field];
    } else {
      target[field] = sum;
    }
  }
};

/**
 * Um lançamento é receita ou despesa, nunca as duas: a contagem do fato vai
 * para o lado do valor (o sinal acompanha criação e desfazimento).
 */
const categoryDeltaOf = (delta: CashPeriodDelta): CashCategoryDelta => {
  const count = Math.sign(delta.transactionCount) || 0;
  return {
    incomeCents: delta.incomeCents,
    expenseCents: delta.expenseCents,
    incomeCount: delta.incomeCents !== 0 ? count : 0,
    expenseCount: delta.expenseCents !== 0 ? count : 0,
  };
};

const isZeroCategory = (delta: CashCategoryDelta): boolean =>
  CASH_CATEGORY_FIELDS.every((field) => delta[field] === 0);

const addToPlan = (
  plan: CashWritePlan,
  data: admin.firestore.DocumentData | undefined,
  sign: 1 | -1,
): void => {
  if (!data) return;
  const base = cashPeriodDeltaFor(data);
  // Documento não anulado exige `date` válido mesmo sem efeito (pendente).
  if (isVoidedTransaction(data)) return;
  const day = cashDayKeyFor(data);
  if (isZero(base)) return;
  const delta = sign === 1 ? base : negate(base);
  const period = day.slice(0, 7);
  plan.months[period] = addCashPeriodDelta(
    plan.months[period] ?? ZERO_DELTA,
    delta,
  );
  const dd = day.slice(8, 10);
  const monthDays = plan.days[period] ?? (plan.days[period] = {});
  addPartial(monthDays[dd] ?? (monthDays[dd] = {}), delta, CASH_DELTA_FIELDS);

  const category = categoryDeltaOf(delta);
  if (isZeroCategory(category)) return;
  const ref = cashCategoryRefFor(data);
  const year = day.slice(0, 4);
  const key = `${year}__${ref.categoryKey}`;
  const entry = plan.categories[key] ?? (plan.categories[key] = {
    ...ref,
    year,
    totals: emptyCashCategoryDelta(),
    days: {},
  });
  for (const field of CASH_CATEGORY_FIELDS) {
    entry.totals[field] = entry.totals[field] + category[field] || 0;
  }
  const mmdd = `${day.slice(5, 7)}${day.slice(8, 10)}`;
  addPartial(entry.days[mmdd] ?? (entry.days[mmdd] = {}), category,
    CASH_CATEGORY_FIELDS);
};

/**
 * Plano da escrita: retira o efeito de `before` (no dia e na categoria de
 * `before`) e soma o de `after` (no dia e na categoria de `after`). Mudança
 * de dia, mês, ano, categoria ou valor sai de um lugar e entra no outro;
 * entradas que se anulam somem do plano.
 */
export const cashWritePlanFor = (
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
): CashWritePlan => {
  const plan: CashWritePlan = {months: {}, days: {}, categories: {}};
  addToPlan(plan, before, -1);
  addToPlan(plan, after, 1);
  for (const [period, delta] of Object.entries(plan.months)) {
    if (isZero(delta)) delete plan.months[period];
  }
  for (const [period, days] of Object.entries(plan.days)) {
    for (const [dd, delta] of Object.entries(days)) {
      if (Object.keys(delta).length === 0) delete days[dd];
    }
    if (Object.keys(days).length === 0) delete plan.days[period];
  }
  for (const [key, entry] of Object.entries(plan.categories)) {
    for (const [mmdd, delta] of Object.entries(entry.days)) {
      if (Object.keys(delta).length === 0) delete entry.days[mmdd];
    }
    if (isZeroCategory(entry.totals) && Object.keys(entry.days).length === 0) {
      delete plan.categories[key];
    }
  }
  return plan;
};

const DAY_OF_MONTH_PATTERN = /^(0[1-9]|[12]\d|3[01])$/;
const MONTH_DAY_PATTERN = /^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;

/**
 * Lê o detalhe diário gravado (`days` do mês): chaves `DD` válidas, campos
 * inteiros; campo ausente vale zero e dia sem nenhum campo não nulo some.
 */
export const readCashDayDeltas = (value: unknown): CashDayDeltas => {
  const days: CashDayDeltas = {};
  if (typeof value !== "object" || value === null) return days;
  for (const [dd, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!DAY_OF_MONTH_PATTERN.test(dd)) continue;
    const delta = normalizeCashPeriodDelta(
      raw as Partial<Record<keyof CashPeriodDelta, unknown>>,
    );
    const partial: Partial<CashPeriodDelta> = {};
    addPartial(partial, delta, CASH_DELTA_FIELDS);
    if (Object.keys(partial).length > 0) days[dd] = partial;
  }
  return days;
};

/** Lê o detalhe diário de uma categoria-ano (`days.{MMDD}`). */
export const readCashCategoryDays = (
  value: unknown,
): Record<string, Partial<CashCategoryDelta>> => {
  const days: Record<string, Partial<CashCategoryDelta>> = {};
  if (typeof value !== "object" || value === null) return days;
  for (const [mmdd, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!MONTH_DAY_PATTERN.test(mmdd)) continue;
    const delta = normalizeCashCategoryDelta(
      raw as Partial<Record<keyof CashCategoryDelta, unknown>>,
    );
    const partial: Partial<CashCategoryDelta> = {};
    addPartial(partial, delta, CASH_CATEGORY_FIELDS);
    if (Object.keys(partial).length > 0) days[mmdd] = partial;
  }
  return days;
};

/** Soma `source` em `target`, dia a dia (dias que se anulam somem). */
export const mergeCashDayDeltas = (
  target: CashDayDeltas,
  source: CashDayDeltas,
): void => {
  for (const [dd, delta] of Object.entries(source)) {
    const day = target[dd] ?? (target[dd] = {});
    addPartial(day, normalizeCashPeriodDelta(delta), CASH_DELTA_FIELDS);
    if (Object.keys(day).length === 0) delete target[dd];
  }
};

/** Soma dos dias, campo a campo. */
export const sumCashDayDeltas = (days: CashDayDeltas): CashPeriodDelta => {
  let total = emptyCashPeriodDelta();
  for (const delta of Object.values(days)) {
    total = addCashPeriodDelta(total, normalizeCashPeriodDelta(delta));
  }
  return total;
};

/**
 * Paridade do mês (P5-C1): Σ dias = total do mês em **todos** os campos.
 * Vale por construção para todo documento escrito pela versão 5; um
 * documento que falhe aqui não pode ser apresentado como exato.
 */
export const cashDaysMatchMonth = (
  days: CashDayDeltas,
  month: CashPeriodDelta,
): boolean => {
  const sum = sumCashDayDeltas(days);
  return CASH_DELTA_FIELDS.every((field) => sum[field] === month[field]);
};

const incrementsOf = (
  delta: Partial<Record<string, number>>,
): Record<string, FieldValue> => Object.fromEntries(
  Object.entries(delta).map(([field, value]) =>
    [field, FieldValue.increment(value as number)]),
);

/**
 * Escreve o mês e os dias dele num único `set` com incrementos: o total e o
 * detalhe diário mudam juntos ou não mudam.
 */
export const writeCashMonth = (
  writer: CashPeriodWriter,
  workspaceId: string,
  period: string,
  delta: CashPeriodDelta,
  days: CashDayDeltas,
): void => {
  writer.set(
    cashPeriodRef(workspaceId, period),
    {
      id: period,
      workspaceId,
      period,
      periodStart: Timestamp.fromDate(saoPauloMonthStart(period)),
      ...Object.fromEntries(CASH_DELTA_FIELDS.map((field) =>
        [field, FieldValue.increment(delta[field])])),
      days: Object.fromEntries(Object.entries(days).map(([dd, dayDelta]) =>
        [dd, incrementsOf(dayDelta)])),
      schemaVersion: CASH_PERIOD_SCHEMA_VERSION,
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
};

/** Escreve uma categoria-ano de uma geração, por incremento. */
export const writeCashCategoryYear = (
  writer: CashPeriodWriter,
  workspaceId: string,
  generation: string,
  entry: CashCategoryWrite,
): void => {
  writer.set(
    cashCategoryYearRef(workspaceId, generation, entry.year,
      entry.categoryKey),
    {
      workspaceId,
      generation,
      year: entry.year,
      categoryKey: entry.categoryKey,
      categoryId: entry.categoryId,
      classification: entry.classification,
      ...incrementsOf(entry.totals as unknown as Record<string, number>),
      days: Object.fromEntries(Object.entries(entry.days).map(
        ([mmdd, dayDelta]) => [mmdd, incrementsOf(dayDelta)])),
      schemaVersion: CASH_CATEGORY_SCHEMA_VERSION,
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
};

/**
 * Meses tocados pelo plano: os de total alterado **e** os que só mudam a
 * distribuição diária (lançamento movido de dia dentro do mesmo mês, com
 * total do mês inalterado).
 */
export const cashPlanPeriods = (plan: CashWritePlan): string[] =>
  [...new Set([...Object.keys(plan.months), ...Object.keys(plan.days)])]
    .sort();

/** Aplica um plano: meses com dias e categorias nas gerações informadas. */
export const writeCashPlan = (
  writer: CashPeriodWriter,
  workspaceId: string,
  plan: CashWritePlan,
  categoryGenerations: readonly string[],
): void => {
  for (const period of cashPlanPeriods(plan)) {
    writeCashMonth(writer, workspaceId, period,
      plan.months[period] ?? ZERO_DELTA, plan.days[period] ?? {});
  }
  for (const generation of categoryGenerations) {
    for (const entry of Object.values(plan.categories)) {
      writeCashCategoryYear(writer, workspaceId, generation, entry);
    }
  }
};

/**
 * Aplica a variação de uma escrita de transação sobre a projeção, sem marca
 * de entrega (uso direto em testes da projeção). O gatilho usa
 * `applyCashPeriodWriteOnce`.
 *
 * Devolve os períodos **efetivamente escritos**.
 */
export const applyCashPeriodWrite = (
  writer: CashPeriodWriter,
  workspaceId: string,
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
  categoryGenerations: readonly string[] = [INITIAL_CATEGORY_GENERATION],
): string[] => {
  const plan = cashWritePlanFor(before, after);
  writeCashPlan(writer, workspaceId, plan, categoryGenerations);
  return cashPlanPeriods(plan);
};

/**
 * Identificador da entrega, derivado do `event.id` por hash.
 *
 * O `event.id` do Eventarc não é segredo, mas também não é grandeza deste
 * domínio: ele carrega o caminho do documento de origem e, com ele, o ID da
 * transação. O hash mantém a propriedade que importa — mesma entrega, mesmo
 * ID; entregas distintas, IDs distintos — sem colocar identificador de dado
 * financeiro no nome de um documento de coleção operacional.
 */
export const cashPeriodEventKey = (eventId: string): string =>
  createHash("sha256").update(eventId).digest("hex").slice(0, 40);

export const cashPeriodEventRef = (
  workspaceId: string,
  eventKey: string,
): admin.firestore.DocumentReference =>
  admin.firestore().doc(
    `workspaces/${workspaceId}/${CASH_PERIOD_EVENTS_COLLECTION}/${eventKey}`,
  );

/**
 * Estado da projeção do workspace e cerca da reconstrução (P3-B, D-38).
 *
 * Um documento por workspace, em `cash_period_events` (negado ao cliente nos
 * dois sentidos). Não é contador: o gatilho só o **lê**; quem o escreve é a
 * publicação da reconstrução e, raramente, o registro de uma falha que exige
 * reconciliação. Por isso não vira documento quente.
 *
 * - `baselineCutoff`: instante de commit do corte da última reconstrução
 *   publicada. A base publicada contém exatamente as escritas do ledger com
 *   commit `<= baselineCutoff`; um evento nesse intervalo que chegar depois da
 *   publicação já está na base e não é somado de novo.
 * - `lastPublishedAt`: commit da publicação. Uma exclusão física entre o
 *   corte e a publicação é ambígua (ver `applyCashPeriodWriteOnce`).
 * - `needsRebuild`: a projeção pode estar divergente (falha permanente,
 *   janela de retry esgotada ou exclusão ambígua). Só uma reconstrução cujo
 *   corte cubra o último incidente (`issueMaxEventTime`) o desliga.
 *
 * Sem `expiresAt`: a TTL das marcas não alcança este documento.
 */
export const CASH_PROJECTION_STATE_ID = "projection_state";

export const cashProjectionStateRef = (
  workspaceId: string,
): admin.firestore.DocumentReference =>
  admin.firestore().doc(
    `workspaces/${workspaceId}/${CASH_PERIOD_EVENTS_COLLECTION}/` +
      CASH_PROJECTION_STATE_ID,
  );

export interface CashCategoryStaging {
  /** Geração em preparação (o `rebuildId` da reconstrução). */
  generation: string;
  /** Corte da reconstrução: a varredura cobre os commits `<=` ele. */
  cutoff: Timestamp;
}

export interface CashProjectionState {
  baselineCutoff: Timestamp | null;
  baselineRebuildId: string | null;
  lastPublishedAt: Timestamp | null;
  needsRebuild: boolean;
  issueCount: number;
  issueMaxEventTime: Timestamp | null;
  /**
   * P5-C1 — geração vigente da projeção por categoria. Sem reconstrução
   * publicada, a inicial (`g0`), mantida pelo gatilho desde o primeiro
   * lançamento.
   */
  categoryGeneration: string;
  /** Geração em preparação por uma reconstrução em andamento. */
  categoryStaging: CashCategoryStaging | null;
  /** Gerações descartadas, ainda com documentos a apagar (≤ 8). */
  categoryGarbage: string[];
}

const timestampOrNull = (value: unknown): Timestamp | null =>
  value instanceof Timestamp ? value : null;

const GENERATION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const isCategoryGeneration = (value: unknown): value is string =>
  typeof value === "string" && GENERATION_PATTERN.test(value);

const readStaging = (value: unknown): CashCategoryStaging | null => {
  if (typeof value !== "object" || value === null) return null;
  const staging = value as Record<string, unknown>;
  return isCategoryGeneration(staging.generation) &&
    staging.cutoff instanceof Timestamp ?
    {generation: staging.generation, cutoff: staging.cutoff} :
    null;
};

export const readCashProjectionState = (
  snapshot: admin.firestore.DocumentSnapshot,
): CashProjectionState => {
  const data = snapshot.data() ?? {};
  return {
    baselineCutoff: timestampOrNull(data.baselineCutoff),
    baselineRebuildId: typeof data.baselineRebuildId === "string" ?
      data.baselineRebuildId :
      null,
    lastPublishedAt: timestampOrNull(data.lastPublishedAt),
    needsRebuild: data.needsRebuild === true,
    issueCount: Number.isSafeInteger(data.issueCount) ?
      (data.issueCount as number) :
      0,
    issueMaxEventTime: timestampOrNull(data.issueMaxEventTime),
    categoryGeneration: isCategoryGeneration(data.categoryGeneration) ?
      data.categoryGeneration :
      INITIAL_CATEGORY_GENERATION,
    categoryStaging: readStaging(data.categoryStaging),
    categoryGarbage: Array.isArray(data.categoryGarbage) ?
      data.categoryGarbage.filter(isCategoryGeneration) :
      [],
  };
};

/**
 * Gerações de categoria que um evento aplicado alimenta: a vigente e, se
 * houver reconstrução em andamento e o evento for posterior ao corte dela,
 * também a preparada — a base da preparada só cobre commits `<=` corte.
 */
export const categoryGenerationsFor = (
  state: CashProjectionState,
  eventTime: Timestamp,
): string[] => {
  const generations = [state.categoryGeneration];
  const staging = state.categoryStaging;
  if (
    staging &&
    staging.generation !== state.categoryGeneration &&
    compareCommitTimes(eventTime, staging.cutoff) > 0
  ) {
    generations.push(staging.generation);
  }
  return generations;
};

/**
 * Ordem entre instantes de commit, com precisão de nanossegundo.
 *
 * `toMillis()` descartaria os microssegundos que o Firestore grava e poderia
 * empatar um evento com o corte que, na verdade, o sucede.
 */
export const compareCommitTimes = (left: Timestamp, right: Timestamp): number =>
  left.seconds !== right.seconds ?
    left.seconds - right.seconds :
    left.nanoseconds - right.nanoseconds;

export type CashProjectionIssueCode =
  | "permanent_failure"
  | "retry_window_exhausted"
  | "ambiguous_delete"
  /** Documento fora do contrato único (P5-C2): nunca efeito zero. */
  | "contract_violation";

export interface CashProjectionIssue {
  code: CashProjectionIssueCode;
  /** Commit da escrita de origem que não entrou com segurança na projeção. */
  eventTime: Timestamp;
  transactionId: string;
}

/** Campos que marcam a projeção como pendente de reconciliação. */
const issuePatch = (
  workspaceId: string,
  state: CashProjectionState,
  issue: CashProjectionIssue,
): admin.firestore.DocumentData => ({
  id: CASH_PROJECTION_STATE_ID,
  workspaceId,
  kind: "cash_projection_state",
  needsRebuild: true,
  issueCount: state.issueCount + 1,
  issueMaxEventTime:
    state.issueMaxEventTime &&
    compareCommitTimes(state.issueMaxEventTime, issue.eventTime) > 0 ?
      state.issueMaxEventTime :
      issue.eventTime,
  lastIssueCode: issue.code,
  lastIssueTransactionId: issue.transactionId,
  lastIssueAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

/**
 * Registra, numa transação própria, que a projeção pode ter divergido.
 *
 * Usado quando o gatilho não consegue aplicar um evento e a nova tentativa
 * não resolveria (erro permanente) ou não virá mais (janela de retry quase
 * esgotada). Não move dinheiro: só torna a divergência visível e exige
 * reconstrução, em vez de deixá-la silenciosa.
 */
export const recordCashProjectionIssue = async (
  workspaceId: string,
  issue: CashProjectionIssue,
): Promise<void> => {
  const ref = cashProjectionStateRef(workspaceId);
  await admin.firestore().runTransaction(async (transaction) => {
    const state = readCashProjectionState(await transaction.get(ref));
    transaction.set(ref, issuePatch(workspaceId, state, issue), {merge: true});
  });
};

export interface CashPeriodEventContext {
  /** Documento de origem, só para diagnóstico da marca. */
  transactionId: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  /** Commit da escrita de origem (`updateTime` ou hora do evento). */
  eventTime: Timestamp;
  /** `createTime` do documento antes da escrita (UPDATE e DELETE). */
  beforeCreateTime?: Timestamp;
}

export type CashPeriodEventOutcomeKind =
  | "applied"
  | "duplicate"
  | "covered_by_rebuild"
  | "ambiguous_delete";

export interface CashPeriodEventOutcome {
  /** `true` só quando esta entrega moveu a projeção. */
  applied: boolean;
  outcome: CashPeriodEventOutcomeKind;
  periods: string[];
}

const readPeriods = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string =>
    typeof item === "string") : [];

/**
 * Aplica a variação **uma única vez por entrega** (INV-P3-001), respeitando a
 * cerca da reconstrução (P3-B).
 *
 * A leitura da marca e do estado, o incremento do período e a criação da marca
 * acontecem na mesma transação do Firestore: ou tudo vale, ou nada vale. Não
 * há janela entre "conferi que ainda não apliquei" e "apliquei". Uma nova
 * tentativa depois de um commit cuja resposta se perdeu encontra a marca e não
 * soma de novo.
 *
 * Com uma base reconstruída publicada:
 * - evento com commit `<=` corte já está na base: grava a marca
 *   `covered_by_rebuild` e não soma;
 * - exclusão física de documento que existia no corte, com commit entre o
 *   corte e a publicação, é **ambígua** (a varredura pode ou não tê-lo visto):
 *   não soma, marca `ambiguous_delete` e liga `needsRebuild`. O produto não
 *   apaga transações (Rules `delete: false`, INV-P2-032); só o Admin SDK fora
 *   do produto chega aqui;
 * - qualquer outro evento soma normalmente.
 *
 * A marca aplicada guarda o instante de commit e os deltas por período: é o
 * que a publicação da reconstrução soma aos eventos posteriores ao corte.
 *
 * `create` em vez de `set` de propósito: se a marca aparecer entre a leitura e
 * o commit — o que a serialização da transação já impede —, a escrita falha em
 * vez de sobrescrever.
 *
 * Custo: duas leituras endereçadas por ID (marca e estado). Nenhuma consulta,
 * nenhum índice, nenhuma varredura.
 */
export const applyCashPeriodWriteOnce = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  eventKey: string,
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
  context: CashPeriodEventContext,
): Promise<CashPeriodEventOutcome> => {
  const markerRef = cashPeriodEventRef(workspaceId, eventKey);
  const stateRef = cashProjectionStateRef(workspaceId);
  const [marker, stateSnapshot] = await transaction.getAll(markerRef, stateRef);
  if (marker.exists) {
    return {
      applied: false,
      outcome: "duplicate",
      periods: readPeriods(marker.data()?.periods),
    };
  }
  const state = readCashProjectionState(stateSnapshot);
  const markerBase = {
    id: eventKey,
    workspaceId,
    entity: "transaction",
    entityId: context.transactionId,
    action: context.action,
    eventTime: context.eventTime,
    ...(context.beforeCreateTime ?
      {beforeCreateTime: context.beforeCreateTime} :
      {}),
    appliedAt: FieldValue.serverTimestamp(),
    // Retenção: marca operacional, não fato financeiro. Ver
    // `docs/investments/TTL_MANIFEST.md`.
    expiresAt: expiresInDays(RETENTION_DAYS.cashPeriodEvents),
  };

  const cutoff = state.baselineCutoff;
  if (cutoff && compareCommitTimes(context.eventTime, cutoff) <= 0) {
    transaction.create(markerRef, {
      ...markerBase,
      outcome: "covered_by_rebuild",
      baselineRebuildId: state.baselineRebuildId,
      periods: [],
    });
    return {applied: false, outcome: "covered_by_rebuild", periods: []};
  }

  if (
    context.action === "DELETE" &&
    cutoff &&
    state.lastPublishedAt &&
    compareCommitTimes(context.eventTime, state.lastPublishedAt) < 0 &&
    (!context.beforeCreateTime ||
      compareCommitTimes(context.beforeCreateTime, cutoff) <= 0)
  ) {
    transaction.create(markerRef, {
      ...markerBase,
      outcome: "ambiguous_delete",
      periods: [],
    });
    transaction.set(stateRef, issuePatch(workspaceId, state, {
      code: "ambiguous_delete",
      eventTime: context.eventTime,
      transactionId: context.transactionId,
    }), {merge: true});
    return {applied: false, outcome: "ambiguous_delete", periods: []};
  }

  const plan = cashWritePlanFor(before, after);
  const categoryGenerations = categoryGenerationsFor(state, context.eventTime);
  writeCashPlan(transaction, workspaceId, plan, categoryGenerations);
  const periods = cashPlanPeriods(plan);
  transaction.create(markerRef, {
    ...markerBase,
    outcome: "applied",
    periods,
    deltas: plan.months,
    // P5-C1: detalhe diário do mesmo delta, somado pela publicação da
    // reconstrução aos dias dos meses (eventos posteriores ao corte).
    dayDeltas: plan.days,
    categoryGenerations,
  });
  return {applied: true, outcome: "applied", periods};
};
