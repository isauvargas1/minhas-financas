import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {
  cardPaymentCashEffect,
  readCardPaymentCashEntry,
} from "../cards/cashEffect";
import {loanCashEffect, readLoanCashEntry} from "../loans/cashEffect";
import {
  readReceivableCashEntry,
  receivableCashEffect,
} from "../receivables/cashEffect";
import {saoPauloMonthKey, saoPauloMonthStart} from "../shared/dateKeys";
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
 * (P4-D).
 */
export const CASH_PERIOD_SCHEMA_VERSION = 4;

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
 * Valor da transação em centavos exatos.
 *
 * `valueCents` é a fonte: todo produtor atual o grava. O ramo de `value` em
 * ponto flutuante é a dupla representação ainda registrada em PR-TX-03 (sai
 * com a fórmula única, P5); arredondar aqui é a única conversão, e ela
 * acontece uma vez por documento.
 */
export const transactionValueCents = (
  data: admin.firestore.DocumentData | undefined,
): number => {
  if (!data) return 0;
  if (Number.isSafeInteger(data.valueCents)) return data.valueCents as number;
  const value = Number(data.value ?? 0);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
};

/**
 * Receita ou despesa ainda não liquidada (D-29, P3-F): pendente, agendada ou
 * vencida sem confirmação. `isPaid: false` é a evidência explícita, gravada
 * pelo backend (`cashEntry.status: pending` e espelho de investimento
 * pendente); todo produtor atual grava `isPaid`. Ausência do campo não é
 * evidência de pendência: é lida como realizada, a mesma regra do frontend
 * (fórmula única: PR-TX-03, P5; `FINANCIAL_DOMAIN_MODEL.md`).
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
 * pendente e cancelado não movem caixa e o estorno compensa. Documento
 * `investimento` sem marca válida está fora do contrato: efeito zero.
 * `parcelado` não é gravado por nenhum fluxo (P4-A, P4-B, P4-C: a compra de
 * cartão vive em `credit_card_purchases`); a regra anterior fica só para
 * documento fora do contrato.
 */
export const cashPeriodDeltaFor = (
  data: admin.firestore.DocumentData | undefined,
): CashPeriodDelta => {
  if (!data) return ZERO_DELTA;
  // Baixa lógica (INV-P2-032): o documento permanece, o fato não conta.
  if (data.voidedAt !== undefined && data.voidedAt !== null) return ZERO_DELTA;

  // Espelho de empréstimo (P3-G, D-13): a marca backend-only decide.
  if (data.loanEntry !== undefined) {
    const entry = readLoanCashEntry(data.loanEntry);
    if (!entry) return ZERO_DELTA;
    return {...emptyCashPeriodDelta(), ...loanCashEffect(entry),
      transactionCount: 1};
  }

  // Pagamento de fatura de cartão (P4-A): liquidação do cartão, fora de
  // receita e despesa operacionais; move só o caixa.
  if (data.creditCardPaymentEntry !== undefined) {
    const entry = readCardPaymentCashEntry(data.creditCardPaymentEntry);
    if (!entry) return ZERO_DELTA;
    return {...emptyCashPeriodDelta(), ...cardPaymentCashEffect(entry),
      transactionCount: 1};
  }

  // Espelho de recebimento (P3-I, D-39): principal é receita operacional,
  // juros e multa são receita financeira, desconto não move caixa.
  if (data.receivableEntry !== undefined) {
    const entry = readReceivableCashEntry(data.receivableEntry);
    if (!entry) return ZERO_DELTA;
    return {...emptyCashPeriodDelta(), ...receivableCashEffect(entry),
      transactionCount: 1};
  }

  // Espelho da Divisão de contas (P4-C): título pago pelo Caixa e reembolso
  // PJ pago são despesa operacional; a compensação tem sinal oposto.
  if (data.splitEntry !== undefined) {
    const entry = readSplitCashEntry(data.splitEntry);
    if (!entry) return ZERO_DELTA;
    return {...emptyCashPeriodDelta(), ...splitCashEffect(entry),
      transactionCount: 1};
  }

  // Espelho de investimento (P4-D, D-15): só a marca do backend decide.
  // Pendente e cancelado não movem caixa; o estorno compensa.
  if (data.investmentEntry !== undefined) {
    const entry = readInvestmentCashEntry(data.investmentEntry);
    if (!entry || data.type !== "investimento" || entry.status !== "settled") {
      return ZERO_DELTA;
    }
    return {...emptyCashPeriodDelta(), ...investmentCashEffect(entry),
      transactionCount: 1};
  }

  const cents = transactionValueCents(data);
  const type = String(data.type ?? "");
  const manualType = type === "receita" || type === "despesa";
  if (manualType && isUnsettledCashEntry(data)) {
    return ZERO_DELTA;
  }

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
  if (type === "despesa" || type === "parcelado") {
    return {
      ...emptyCashPeriodDelta(),
      incomeCents: 0,
      expenseCents: cents,
      investmentOutflowCents: 0,
      netCents: -cents,
      transactionCount: 1,
    };
  }
  // `investimento` sem a marca do backend: fora do contrato, efeito zero.
  return ZERO_DELTA;
};

/** Chave mensal da transação, no fuso oficial do produto. */
export const cashPeriodKeyFor = (
  data: admin.firestore.DocumentData | undefined,
): string | undefined => {
  if (!data) return undefined;
  const timestamp = data.transactionDate;
  if (timestamp instanceof Timestamp) {
    return saoPauloMonthKey(timestamp.toDate());
  }
  const dateOnly = typeof data.date === "string" ? data.date : undefined;
  if (!dateOnly) return undefined;
  const parsed = new Date(`${dateOnly}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ?
    undefined :
    saoPauloMonthKey(parsed);
};

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
  const beforePeriod = cashPeriodKeyFor(before);
  const afterPeriod = cashPeriodKeyFor(after);
  if (beforePeriod) deltas[beforePeriod] = negate(cashPeriodDeltaFor(before));
  if (afterPeriod) {
    deltas[afterPeriod] = addCashPeriodDelta(
      deltas[afterPeriod] ?? ZERO_DELTA,
      cashPeriodDeltaFor(after),
    );
  }
  for (const [period, delta] of Object.entries(deltas)) {
    if (isZero(delta)) delete deltas[period];
  }
  return deltas;
};

const writeDelta = (
  writer: CashPeriodWriter,
  workspaceId: string,
  period: string,
  delta: CashPeriodDelta,
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
      schemaVersion: CASH_PERIOD_SCHEMA_VERSION,
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
};

/**
 * Aplica a variação de uma escrita de transação sobre a projeção mensal.
 *
 * Devolve os períodos **efetivamente escritos**, que é o que a marca de
 * entrega registra para diagnóstico e o que uma reconciliação dirigida
 * precisaria reprocessar.
 */
export const applyCashPeriodWrite = (
  writer: CashPeriodWriter,
  workspaceId: string,
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
): string[] => {
  const deltas = cashPeriodDeltasFor(before, after);
  for (const [period, delta] of Object.entries(deltas)) {
    writeDelta(writer, workspaceId, period, delta);
  }
  return Object.keys(deltas);
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

export interface CashProjectionState {
  baselineCutoff: Timestamp | null;
  baselineRebuildId: string | null;
  lastPublishedAt: Timestamp | null;
  needsRebuild: boolean;
  issueCount: number;
  issueMaxEventTime: Timestamp | null;
}

const timestampOrNull = (value: unknown): Timestamp | null =>
  value instanceof Timestamp ? value : null;

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
  };
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
  | "ambiguous_delete";

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

  const deltas = cashPeriodDeltasFor(before, after);
  for (const [period, delta] of Object.entries(deltas)) {
    writeDelta(transaction, workspaceId, period, delta);
  }
  const periods = Object.keys(deltas);
  transaction.create(markerRef, {
    ...markerBase,
    outcome: "applied",
    periods,
    deltas,
  });
  return {applied: true, outcome: "applied", periods};
};
