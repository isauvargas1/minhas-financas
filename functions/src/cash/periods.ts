import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {saoPauloMonthKey, saoPauloMonthStart} from "../shared/dateKeys";

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
): void => {
  if (isZero(delta)) return;
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
};

/**
 * Aplica a variação de uma escrita de transação sobre a projeção mensal.
 *
 * Trata os quatro casos do gatilho — criação, alteração, alteração **com troca
 * de mês** e exclusão — com a mesma expressão: retira o efeito de `before` do
 * mês de `before` e soma o efeito de `after` no mês de `after`. Quando o mês
 * não muda, os dois se combinam num único incremento.
 */
export const applyCashPeriodWrite = (
  writer: CashPeriodWriter,
  workspaceId: string,
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
): void => {
  const beforePeriod = cashPeriodKeyFor(before);
  const afterPeriod = cashPeriodKeyFor(after);
  const beforeDelta = negate(cashPeriodDeltaFor(before));
  const afterDelta = cashPeriodDeltaFor(after);

  if (beforePeriod && beforePeriod === afterPeriod) {
    writeDelta(writer, workspaceId, beforePeriod, {
      incomeCents: beforeDelta.incomeCents + afterDelta.incomeCents,
      expenseCents: beforeDelta.expenseCents + afterDelta.expenseCents,
      investmentOutflowCents:
        beforeDelta.investmentOutflowCents + afterDelta.investmentOutflowCents,
      netCents: beforeDelta.netCents + afterDelta.netCents,
      transactionCount:
        beforeDelta.transactionCount + afterDelta.transactionCount,
    });
    return;
  }
  if (beforePeriod) writeDelta(writer, workspaceId, beforePeriod, beforeDelta);
  if (afterPeriod) writeDelta(writer, workspaceId, afterPeriod, afterDelta);
};
