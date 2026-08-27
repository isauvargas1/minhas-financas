import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {saoPauloMonthKey, saoPauloMonthStart} from "../shared/dateKeys";
import {RETENTION_DAYS, expiresInDays} from "../shared/retention";

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

export interface CashPeriodDelta {
  incomeCents: number;
  expenseCents: number;
  investmentOutflowCents: number;
  netCents: number;
  transactionCount: number;
}

const ZERO_DELTA: CashPeriodDelta = {
  incomeCents: 0,
  expenseCents: 0,
  investmentOutflowCents: 0,
  netCents: 0,
  transactionCount: 0,
};

/**
 * Valor da transação em centavos exatos.
 *
 * `valueCents` é a fonte quando existe — o domínio de investimentos o grava e
 * o considera oficial. Documentos legados só têm `value` em ponto flutuante;
 * arredondar aqui é a única conversão, e ela acontece uma vez por documento.
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
 * Efeito da transação sobre o caixa, em centavos com sinal.
 *
 * Espelha `transactionCashImpactCents` do frontend: o tipo `investimento`
 * nunca decide sozinho, quem decide é `investmentMetadata.cashImpact`. Um
 * resgate pendente não move caixa; um resgate liquidado é entrada; um aporte é
 * saída.
 */
export const cashPeriodDeltaFor = (
  data: admin.firestore.DocumentData | undefined,
): CashPeriodDelta => {
  if (!data) return ZERO_DELTA;
  // Baixa lógica (INV-P2-032): o documento permanece, o fato não conta.
  if (data.voidedAt !== undefined && data.voidedAt !== null) return ZERO_DELTA;

  const cents = transactionValueCents(data);
  const type = String(data.type ?? "");

  if (type === "receita") {
    return {
      incomeCents: cents,
      expenseCents: 0,
      investmentOutflowCents: 0,
      netCents: cents,
      transactionCount: 1,
    };
  }
  if (type === "despesa" || type === "parcelado") {
    return {
      incomeCents: 0,
      expenseCents: cents,
      investmentOutflowCents: 0,
      netCents: -cents,
      transactionCount: 1,
    };
  }
  if (type !== "investimento") return ZERO_DELTA;

  const metadata = data.investmentMetadata as
    | Record<string, unknown>
    | undefined;
  if (metadata) {
    const status = String(metadata.status ?? "");
    // Pendente e cancelado não são fato consumado: não tocam caixa.
    if (status !== "settled" && status !== "reversed") return ZERO_DELTA;
    const impact = String(metadata.cashImpact ?? "");
    if (impact === "none") {
      return {...ZERO_DELTA, transactionCount: 1};
    }
    if (impact === "inflow") {
      return {
        incomeCents: 0,
        expenseCents: 0,
        investmentOutflowCents: 0,
        netCents: cents,
        transactionCount: 1,
      };
    }
  }
  // Aporte: saída de caixa direcionada a investimento, contabilizada à parte
  // das despesas de consumo.
  return {
    incomeCents: 0,
    expenseCents: 0,
    investmentOutflowCents: cents,
    netCents: -cents,
    transactionCount: 1,
  };
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

const negate = (delta: CashPeriodDelta): CashPeriodDelta => ({
  incomeCents: -delta.incomeCents,
  expenseCents: -delta.expenseCents,
  investmentOutflowCents: -delta.investmentOutflowCents,
  netCents: -delta.netCents,
  transactionCount: -delta.transactionCount,
});

const isZero = (delta: CashPeriodDelta): boolean =>
  delta.incomeCents === 0 && delta.expenseCents === 0 &&
  delta.investmentOutflowCents === 0 && delta.netCents === 0 &&
  delta.transactionCount === 0;

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

const writeDelta = (
  writer: CashPeriodWriter,
  workspaceId: string,
  period: string,
  delta: CashPeriodDelta,
): boolean => {
  if (isZero(delta)) return false;
  writer.set(
    cashPeriodRef(workspaceId, period),
    {
      id: period,
      workspaceId,
      period,
      periodStart: Timestamp.fromDate(saoPauloMonthStart(period)),
      incomeCents: FieldValue.increment(delta.incomeCents),
      expenseCents: FieldValue.increment(delta.expenseCents),
      investmentOutflowCents: FieldValue.increment(
        delta.investmentOutflowCents,
      ),
      netCents: FieldValue.increment(delta.netCents),
      transactionCount: FieldValue.increment(delta.transactionCount),
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
  return true;
};

/**
 * Aplica a variação de uma escrita de transação sobre a projeção mensal.
 *
 * Trata os quatro casos do gatilho — criação, alteração, alteração **com troca
 * de mês** e exclusão — com a mesma expressão: retira o efeito de `before` do
 * mês de `before` e soma o efeito de `after` no mês de `after`. Quando o mês
 * não muda, os dois se combinam num único incremento.
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
  const beforePeriod = cashPeriodKeyFor(before);
  const afterPeriod = cashPeriodKeyFor(after);
  const beforeDelta = negate(cashPeriodDeltaFor(before));
  const afterDelta = cashPeriodDeltaFor(after);
  const written: string[] = [];

  if (beforePeriod && beforePeriod === afterPeriod) {
    if (writeDelta(writer, workspaceId, beforePeriod, {
      incomeCents: beforeDelta.incomeCents + afterDelta.incomeCents,
      expenseCents: beforeDelta.expenseCents + afterDelta.expenseCents,
      investmentOutflowCents:
        beforeDelta.investmentOutflowCents + afterDelta.investmentOutflowCents,
      netCents: beforeDelta.netCents + afterDelta.netCents,
      transactionCount:
        beforeDelta.transactionCount + afterDelta.transactionCount,
    })) {
      written.push(beforePeriod);
    }
    return written;
  }
  if (
    beforePeriod &&
    writeDelta(writer, workspaceId, beforePeriod, beforeDelta)
  ) {
    written.push(beforePeriod);
  }
  if (afterPeriod && writeDelta(writer, workspaceId, afterPeriod, afterDelta)) {
    written.push(afterPeriod);
  }
  return written;
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

export interface CashPeriodEventContext {
  /** Documento de origem, só para diagnóstico da marca. */
  transactionId: string;
  action: "CREATE" | "UPDATE" | "DELETE";
}

export interface CashPeriodEventOutcome {
  /** `false` quando a entrega já tinha sido aplicada. */
  applied: boolean;
  periods: string[];
}

const readPeriods = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string =>
    typeof item === "string") : [];

/**
 * Aplica a variação **uma única vez por entrega** (INV-P3-001).
 *
 * A leitura da marca, o incremento do período e a criação da marca acontecem
 * na mesma transação do Firestore: ou os três valem, ou nenhum vale. Não há
 * janela entre "conferi que ainda não apliquei" e "apliquei".
 *
 * `create` em vez de `set` de propósito: se a marca aparecer entre a leitura e
 * o commit — o que a serialização da transação já impede —, a escrita falha em
 * vez de sobrescrever. Falha fechada é o comportamento correto aqui, porque o
 * gatilho é reentregue e uma execução perdida é reparável; um delta a mais,
 * não.
 *
 * Custo: uma leitura por documento, endereçada por ID. Nenhuma consulta, nenhum
 * índice, nenhuma varredura.
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
  const marker = await transaction.get(markerRef);
  if (marker.exists) {
    return {applied: false, periods: readPeriods(marker.data()?.periods)};
  }

  const periods = applyCashPeriodWrite(transaction, workspaceId, before, after);
  transaction.create(markerRef, {
    id: eventKey,
    workspaceId,
    entity: "transaction",
    entityId: context.transactionId,
    action: context.action,
    periods,
    appliedAt: FieldValue.serverTimestamp(),
    // Retenção: marca operacional, não fato financeiro. Ver
    // `docs/investments/TTL_MANIFEST.md`.
    expiresAt: expiresInDays(RETENTION_DAYS.cashPeriodEvents),
  });
  return {applied: true, periods};
};
