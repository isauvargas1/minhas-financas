import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {saoPauloMonthKey} from "../shared/dateKeys";
import {
  workspaceMemberRef,
  workspaceRef,
} from "../shared/workspaceAuth";
import {billingAccountRef} from "./model";
import {
  QUOTA_STATE_COLLECTION,
  assertCanonicalOwnerMembership,
  assertWithinQuota,
  canonicalOwnerCandidate,
  entitlementAt,
  quotaStateUnavailable,
  type QuotaEntitlement,
} from "./quota";

/**
 * Quota comercial de lançamentos manuais por mês (P3-D, D-40).
 *
 * `transactionsPerMonth` do plano efetivo do **titular canônico** limita, por
 * workspace, quantos lançamentos manuais são criados no mês civil de
 * `America/Sao_Paulo` do relógio do servidor. Consomem: a criação manual
 * (`createCashTransaction`) e cada linha nova de uma importação
 * (`importCashTransactions`). Não consomem: correção, anulação, replay,
 * recusa, falha antes do commit, espelhos e registros automáticos de outros
 * domínios. A anulação não devolve a unidade. A data financeira do
 * lançamento não importa: o retroativo consome o mês em que foi registrado.
 *
 * Não é o limite operacional de frequência (120 a cada 10 minutos por ator,
 * `rate_limits`), que protege o backend de laços e scripts e vale para
 * qualquer plano.
 *
 * Estado server-only (Rules negam leitura e escrita do cliente em
 * `workspaces/{id}/quota_state/*`), com IDs estáveis:
 *
 * - `quota_state/transactions` — **âncora**: prova que o workspace tem o
 *   contador desde `trackingSince` (`YYYY-MM`). Nasce com o workspace
 *   (`bootstrapAccount`, `createWorkspace`), na mesma transação, com zero.
 *   Workspace sem âncora falha fechado: a ausência de contador **não** é
 *   tratada como consumo zero. Não há inicialização retroativa (P4-D): não
 *   existe workspace anterior à âncora nem lançamento escrito fora das
 *   callables que precisasse ser contado.
 * - `quota_state/transactions_{YYYY-MM}` — unidades usadas no mês. Com a
 *   âncora presente e o mês a partir de `trackingSince`, documento ausente
 *   significa zero: toda unidade consumida grava o documento do mês no
 *   mesmo commit do lançamento. Meses passados não são mais escritos.
 *
 * Duas criações concorrentes leem o mesmo documento do mês; a perdedora é
 * repetida pelo Firestore, relê o contador e é recusada no último slot. O
 * contador não é reconstruído por contagem da coleção a cada operação.
 */
export const TRANSACTION_QUOTA_ANCHOR_ID = "transactions";
export const TRANSACTION_QUOTA_SCHEMA_VERSION = 1;

export type TransactionQuotaOrigin = "workspace_created";

type Snapshot = admin.firestore.DocumentSnapshot;

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonthKey = (value: unknown): value is string =>
  typeof value === "string" && MONTH_KEY.test(value);

export const transactionQuotaMonthId = (monthKey: string): string => {
  if (!isMonthKey(monthKey)) throw quotaStateUnavailable();
  return `${TRANSACTION_QUOTA_ANCHOR_ID}_${monthKey}`;
};

export const transactionQuotaAnchorRef = (
  workspaceId: string,
): admin.firestore.DocumentReference =>
  workspaceRef(workspaceId)
    .collection(QUOTA_STATE_COLLECTION)
    .doc(TRANSACTION_QUOTA_ANCHOR_ID);

export const transactionQuotaMonthRef = (
  workspaceId: string,
  monthKey: string,
): admin.firestore.DocumentReference =>
  workspaceRef(workspaceId)
    .collection(QUOTA_STATE_COLLECTION)
    .doc(transactionQuotaMonthId(monthKey));

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Documento da âncora: só metadados, nenhum valor financeiro. */
export const transactionQuotaAnchorDocument = (input: {
  workspaceId: string;
  trackingSince: string;
  origin: TransactionQuotaOrigin;
  /** Unidades atribuídas ao mês de `trackingSince` na inicialização. */
  initialUsed: number;
}) => {
  if (!isMonthKey(input.trackingSince) || !isCount(input.initialUsed)) {
    throw quotaStateUnavailable();
  }
  return {
    workspaceId: input.workspaceId,
    trackingSince: input.trackingSince,
    origin: input.origin,
    initialUsed: input.initialUsed,
    schemaVersion: TRANSACTION_QUOTA_SCHEMA_VERSION,
    createdAt: FieldValue.serverTimestamp(),
  };
};

export const transactionQuotaMonthDocument = (input: {
  workspaceId: string;
  monthKey: string;
  used: number;
}) => {
  if (!isMonthKey(input.monthKey) || !isCount(input.used)) {
    throw quotaStateUnavailable();
  }
  return {
    workspaceId: input.workspaceId,
    monthKey: input.monthKey,
    used: input.used,
    schemaVersion: TRANSACTION_QUOTA_SCHEMA_VERSION,
    updatedAt: FieldValue.serverTimestamp(),
  };
};

/**
 * Estado inicial de todo workspace novo, na transação que o cria: nenhum
 * lançamento pode existir antes dele, então o contador começa em zero no mês
 * corrente do servidor.
 */
export const createTransactionQuotaAnchor = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  nowMs: number = Date.now(),
): void => {
  transaction.create(
    transactionQuotaAnchorRef(workspaceId),
    transactionQuotaAnchorDocument({
      workspaceId,
      trackingSince: saoPauloMonthKey(new Date(nowMs)),
      origin: "workspace_created",
      initialUsed: 0,
    }),
  );
};

/** Âncora válida: `trackingSince` do workspace informado. */
export const readTransactionQuotaAnchor = (
  anchor: Snapshot,
  workspaceId: string,
): {trackingSince: string} => {
  const trackingSince = anchor.get("trackingSince");
  if (
    !anchor.exists ||
    anchor.get("schemaVersion") !== TRANSACTION_QUOTA_SCHEMA_VERSION ||
    anchor.get("workspaceId") !== workspaceId ||
    !isMonthKey(trackingSince)
  ) {
    throw quotaStateUnavailable();
  }
  return {trackingSince};
};

/**
 * Unidades já usadas no mês. Sem âncora, com mês anterior ao início do
 * rastreio ou com documento incoerente: falha fechado — nunca zero por
 * omissão.
 */
export const readTransactionQuotaUsed = (
  anchor: Snapshot,
  month: Snapshot,
  workspaceId: string,
  monthKey: string,
): number => {
  const {trackingSince} = readTransactionQuotaAnchor(anchor, workspaceId);
  if (!isMonthKey(monthKey) || monthKey < trackingSince) {
    throw quotaStateUnavailable();
  }
  if (!month.exists) return 0;
  const used = month.get("used");
  if (
    month.get("schemaVersion") !== TRANSACTION_QUOTA_SCHEMA_VERSION ||
    month.get("workspaceId") !== workspaceId ||
    month.get("monthKey") !== monthKey ||
    !isCount(used)
  ) {
    throw quotaStateUnavailable();
  }
  return used;
};

/**
 * Estado do contador para leitura (P3-E): nunca lança. Sem âncora, o
 * workspace ainda não tem contador (`not_initialized`); com estado
 * incoerente, a leitura não é confiável (`unavailable`). Em nenhum dos dois
 * o uso vale zero.
 */
export type TransactionQuotaReadStatus =
  | "available"
  | "not_initialized"
  | "unavailable";

export const describeTransactionQuota = (
  anchor: Snapshot,
  month: Snapshot,
  workspaceId: string,
  monthKey: string,
): {status: TransactionQuotaReadStatus; used: number | null} => {
  if (!anchor.exists) return {status: "not_initialized", used: null};
  try {
    return {
      status: "available",
      used: readTransactionQuotaUsed(anchor, month, workspaceId, monthKey),
    };
  } catch {
    return {status: "unavailable", used: null};
  }
};

export interface TransactionQuotaReservation {
  /** Mês consumido (`YYYY-MM`, São Paulo, relógio do servidor). */
  periodKey: string;
  used: number;
  units: number;
  entitlement: QuotaEntitlement;
  /** Grava o contador; chamar depois de todas as leituras da transação. */
  commit(): void;
}

/**
 * Lê titular, billing e contador do mês num único `getAll` e confere
 * `usado + unidades <= transactionsPerMonth` do entitlement efetivo agora.
 * Recusa antes de qualquer escrita; o contador só é gravado por `commit`,
 * no mesmo commit do lançamento.
 */
export const reserveTransactionQuota = async (
  transaction: admin.firestore.Transaction,
  input: {
    actorUid: string;
    workspaceId: string;
    workspace: admin.firestore.DocumentData;
    units: number;
    nowMs: number;
  },
): Promise<TransactionQuotaReservation> => {
  if (!Number.isSafeInteger(input.units) || input.units < 1) {
    throw quotaStateUnavailable();
  }
  const periodKey = saoPauloMonthKey(new Date(input.nowMs));
  const ownerUid = canonicalOwnerCandidate(input.workspace);
  const [ownerMember, billing, anchor, month] = await transaction.getAll(
    workspaceMemberRef(input.workspaceId, ownerUid),
    billingAccountRef(ownerUid),
    transactionQuotaAnchorRef(input.workspaceId),
    transactionQuotaMonthRef(input.workspaceId, periodKey),
  );
  assertCanonicalOwnerMembership(ownerMember);
  const entitlement = entitlementAt(billing, input.nowMs);
  const used = readTransactionQuotaUsed(
    anchor,
    month,
    input.workspaceId,
    periodKey,
  );
  assertWithinQuota({
    resource: "transactionsPerMonth",
    entitlement,
    used,
    adding: input.units,
    periodKey,
    actorIsBillingOwner: input.actorUid === ownerUid,
    ...(input.units > 1 ? {requested: input.units} : {}),
  });
  return {
    periodKey,
    used,
    units: input.units,
    entitlement,
    commit: () => {
      transaction.set(
        transactionQuotaMonthRef(input.workspaceId, periodKey),
        transactionQuotaMonthDocument({
          workspaceId: input.workspaceId,
          monthKey: periodKey,
          used: used + input.units,
        }),
      );
    },
  };
};
