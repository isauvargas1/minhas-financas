import * as admin from "firebase-admin";
import {FieldPath, FieldValue} from "firebase-admin/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";

import {
  readAuthoritativeReceivable,
  receivablesRef,
} from "../../receivables/model";
import {addDaysToDayKey, isDayKey, saoPauloDayKey} from "../../shared/dateKeys";
import {isContentionAbortedError} from "../../shared/errors";
import {createOperationLogger} from "../../shared/logger";
import {SCHEDULED_FUNCTION_OPTIONS} from "../../shared/runtimeOptions";
import {buildNotificationDocument} from "../builder";
import {NotificationContractError, type NotificationInput} from "../contract";
import {notificationIdFor} from "../ids";
import {notificationPublishLogFields, notificationsRef} from "../publish";
import {dayLabel} from "./common";
import {
  RECEIVABLE_OVERDUE_QUEUE_COLLECTION,
  RECEIVABLE_OVERDUE_WORK_SCHEMA_VERSION,
  firstOverdueDay,
  receivableOverdueDeliveryRef,
} from "./receivableQueue";

/**
 * Produtor `receivable_overdue` (P5-D2.1): rotina a cada 60 minutos
 * (São Paulo) sobre o trabalho pendente durável (`receivableQueue.ts`).
 *
 * Regra: recebível `open`, com saldo, com vencimento válido e `dueDate`
 * anterior a hoje (dia civil de São Paulo) recebe um aviso por episódio
 * (episódio = `dueDate`), sem limite de dias de atraso. A janela de 7 dias da
 * P5-D2 foi substituída.
 *
 * Descoberta: as operações de domínio gravam o item da fila na mesma
 * transação que gravam o recebível, com `runAfterDay` = dia em que fica
 * devido (o seguinte ao vencimento, nunca antes do dia da operação). A
 * rotina não varre recebíveis:
 *
 *   collectionGroup("receivable_overdue_queue")
 *     where runAfterDay <= hoje
 *     orderBy runAfterDay, __name__   (índice de campo único de grupo)
 *
 * O item concluído sai da fila e o que falhou é reagendado, então não há
 * cursor persistido e o custo não cresce com os recebíveis já avisados. O
 * cursor existe só dentro de cada passada da execução; o que a execução já
 * tratou (inclusive a falha que continua devida) nunca é repetido nela.
 * Justiça entre workspaces em duas passadas: na 1ª, cada workspace tem uma
 * cota (`RECEIVABLE_OVERDUE_WORKSPACE_SHARE`); esgotada, o cursor salta o
 * resto daquele workspace no mesmo dia. Se a 1ª passada chega ao fim da fila
 * e ainda há tempo, a 2ª recomeça sem cota e atende o excedente na ordem da
 * fila, sem repetir o que a execução já tratou: nenhum workspace espera
 * outro, e a capacidade ociosa não fica parada. A capacidade é limitada
 * pelo tempo (420 s), não por um número pequeno de páginas.
 *
 * Uma transação por item, com todas as leituras antes de qualquer escrita
 * (item, recebível, confirmação e aviso), revalidando pelo leitor
 * autoritativo com o workspace do caminho. A publicação grava o aviso, a
 * confirmação do episódio e a remoção do item no mesmo commit: nunca há aviso
 * sem confirmação, nem confirmação sem aviso. A confirmação não expira; é ela,
 * e não o aviso (TTL de 180 dias), que impede a reemissão.
 *
 * Falha: o item continua na fila com `attempts`, `lastErrorCode` tipado e o
 * próximo dia de tentativa (`receivableOverdueBackoffDays`): falha
 * transitória volta a cada execução horária e depois todo dia; as demais
 * seguem 1, 2, 4 e 7 dias. Nunca é descartado por número de tentativas; sai
 * um WARN de falha persistente a partir de
 * `RECEIVABLE_OVERDUE_PERSISTENT_ATTEMPTS` (na falha transitória, só depois
 * da fase horária: `receivableOverdueIsPersistent`).
 *
 * Nunca lê `clients` nem `client_private`: o aviso não leva cliente,
 * descrição nem valor, só o ID do recebível e as datas.
 */
export const RECEIVABLE_OVERDUE_OPERATION =
  "processReceivableOverdueNotifications";
export const RECEIVABLE_OVERDUE_PAGE_SIZE = 100;
/**
 * Teto de páginas por execução (as duas passadas somadas): até 20.000 itens
 * lidos. Com transações rápidas é este teto, e não o tempo, que limita.
 */
export const RECEIVABLE_OVERDUE_MAX_PAGES = 200;
/**
 * Itens de um mesmo workspace na 1ª passada de cada execução: um workspace
 * com volume grande (legítimo ou abusivo) não ocupa a capacidade dos demais;
 * o excedente só usa o tempo que sobra, na 2ª passada.
 */
export const RECEIVABLE_OVERDUE_WORKSPACE_SHARE = 500;
export const RECEIVABLE_OVERDUE_CONCURRENCY = 10;
/** Para de iniciar páginas aqui; o tempo limite da rotina é 540 s. */
export const RECEIVABLE_OVERDUE_TIME_BUDGET_MS = 420_000;
/**
 * Para de iniciar itens aqui (a página em curso pode estar lenta): o que
 * sobrar fica devido para a execução seguinte, dentro dos 540 s.
 */
export const RECEIVABLE_OVERDUE_HARD_STOP_MS = 480_000;
/**
 * Dias até a próxima tentativa de uma falha não transitória (fora do
 * contrato, violação do contrato do aviso, desconhecida), pela tentativa
 * que falhou: a 1ª volta na próxima execução (o item continua devido, mas a
 * execução não repete o que já tratou); as seguintes em 1, 2, 4 e depois 7
 * dias.
 */
export const RECEIVABLE_OVERDUE_BACKOFF_DAYS = [0, 1, 2, 4, 7] as const;
/**
 * Falha transitória (indisponibilidade, tempo esgotado, contenção, limite
 * de recurso, erro interno do Firestore): volta a cada execução horária nas
 * primeiras tentativas e depois todo dia, para que uma instabilidade de
 * horas ou dias não adie o aviso além de um dia depois da recuperação.
 */
export const RECEIVABLE_OVERDUE_TRANSIENT_HOURLY_ATTEMPTS = 6;
/**
 * A partir desta tentativa, a falha é sinalizada como persistente. Na falha
 * transitória, só depois da fase horária: uma indisponibilidade de poucas
 * horas não vira alarme.
 */
export const RECEIVABLE_OVERDUE_PERSISTENT_ATTEMPTS = 5;

/** Código tipado da falha: nunca a mensagem do erro. */
export type ReceivableOverdueErrorCode =
  | "receivable_invalid"
  | "contract_violation"
  | "contention"
  | "timeout"
  | "unavailable"
  | "resource_exhausted"
  | "internal"
  | "unknown";

const ERROR_CODE_BY_GRPC: Record<number, ReceivableOverdueErrorCode> = {
  4: "timeout",
  8: "resource_exhausted",
  13: "internal",
  14: "unavailable",
};

const TRANSIENT_ERROR_CODES: ReadonlySet<ReceivableOverdueErrorCode> = new Set([
  "unavailable", "timeout", "contention", "resource_exhausted", "internal",
]);

export const receivableOverdueBackoffDays = (
  attempts: number,
  errorCode: ReceivableOverdueErrorCode,
): number => {
  if (TRANSIENT_ERROR_CODES.has(errorCode)) {
    return attempts <= RECEIVABLE_OVERDUE_TRANSIENT_HOURLY_ATTEMPTS ? 0 : 1;
  }
  return RECEIVABLE_OVERDUE_BACKOFF_DAYS[
    Math.min(Math.max(attempts, 1), RECEIVABLE_OVERDUE_BACKOFF_DAYS.length) - 1
  ];
};

export const receivableOverdueIsPersistent = (
  attempts: number,
  errorCode: ReceivableOverdueErrorCode,
): boolean => attempts >= (TRANSIENT_ERROR_CODES.has(errorCode) ?
  RECEIVABLE_OVERDUE_TRANSIENT_HOURLY_ATTEMPTS + 1 :
  RECEIVABLE_OVERDUE_PERSISTENT_ATTEMPTS);

export const receivableOverdueErrorCode = (
  error: unknown,
): ReceivableOverdueErrorCode => {
  if (error instanceof NotificationContractError) return "contract_violation";
  if (isContentionAbortedError(error)) return "contention";
  const code = typeof error === "object" && error !== null ?
    (error as {code?: unknown}).code : undefined;
  return typeof code === "number" ? ERROR_CODE_BY_GRPC[code] ?? "unknown" :
    "unknown";
};

/** Desfecho da execução, monitorável nos logs (OBSERVABILITY §2.11). */
export type ReceivableOverdueOutcome =
  | "idle"
  | "drained"
  | "backlog"
  | "recoverable_failures"
  | "structural_error";

export interface ReceivableOverdueSummary {
  today: string;
  /**
   * Itens da fila lidos e classificados nesta execução: o item lido além da
   * cota na 1ª passada e atendido na 2ª conta duas vezes; o já tratado,
   * relido na 2ª passada, não conta. `scanned` = soma dos desfechos +
   * `deferred` + `throttled`.
   */
  scanned: number;
  /** Aviso e confirmação gravados no mesmo commit. */
  published: number;
  /** Confirmação do episódio já existia: item removido. */
  alreadyDelivered: number;
  /** Aviso existia sem confirmação: confirmação gravada, item removido. */
  reconciled: number;
  /** Recebido, cancelado, sem saldo ou inexistente: item removido. */
  closed: number;
  /** Ainda não venceu: item reagendado para o dia seguinte ao vencimento. */
  rescheduled: number;
  /** Fora do contrato autoritativo: não publica, segue com backoff. */
  invalid: number;
  /** Outro worker ou o domínio já tinha removido o item. */
  gone: number;
  /** Falha recuperável: o item segue na fila. */
  failed: number;
  /** Falhas sinalizadas como persistentes (`receivableOverdueIsPersistent`). */
  persistentFailures: number;
  /** Falhas registradas que continuam devidas (voltam na execução seguinte). */
  retriedSameDay: number;
  /** Nem o registro da falha foi gravado: o item volta na próxima execução. */
  retryNotRecorded: number;
  pages: number;
  /** Itens lidos e deixados para a execução seguinte (parada rígida). */
  deferred: number;
  /**
   * Itens lidos além da cota do workspace na 1ª passada (os saltados pelo
   * cursor não são lidos nem contados): a 2ª passada os atende se houver
   * tempo; senão ficam para a execução seguinte.
   */
  throttled: number;
  /** Parou por páginas ou tempo com trabalho possivelmente restante. */
  budgetExhausted: boolean;
  /**
   * Itens ainda devidos ao final (contagem agregada): os que não couberam no
   * orçamento, os que falharam na 1ª tentativa e os que chegaram durante a
   * execução. Nulo em erro estrutural ou se a contagem falhar.
   */
  pendingDueAtEnd: number | null;
  /**
   * Sobrou trabalho devido além das falhas que voltam na execução seguinte
   * (tempo ou páginas esgotados, ou chegada durante a execução),
   * independentemente do desfecho: para alertar sobre backlog mesmo num dia
   * com falha. Nulo quando a contagem falha e nada indica backlog.
   */
  backlog: boolean | null;
  durationMs: number;
  outcome: ReceivableOverdueOutcome;
}

/** Entrada do aviso: função pura, sem relógio nem leitura. */
export const receivableOverdueNotification = (input: {
  workspaceId: string;
  receivableId: string;
  dueDate: string;
  today: string;
  createdAtMs: number;
}): NotificationInput => ({
  id: notificationIdFor({
    workspaceId: input.workspaceId,
    domain: "receivable",
    entityId: input.receivableId,
    eventType: "receivable_overdue",
    episode: input.dueDate,
  }),
  workspaceId: input.workspaceId,
  eventType: "receivable_overdue",
  title: "Recebível vencido",
  message: `Foi identificado atraso em ${dayLabel(input.today)} em um ` +
    `recebível com vencimento em ${dayLabel(input.dueDate)}, que tinha ` +
    "saldo a receber.",
  type: "warning",
  link: "clients_receivables",
  createdAtMs: input.createdAtMs,
  entity: {receivableId: input.receivableId},
});

/**
 * Pontos de injeção de falha, só para os testes de recuperação e
 * concorrência: lançar simula a falha; esperar simula outra escrita no meio.
 */
export interface ReceivableOverdueFaults {
  /** Depois da consulta, antes de abrir a transação do item. */
  beforeTransaction?: (item: ReceivableOverdueItemRef) => void | Promise<void>;
  /** Com as escritas do item enfileiradas, antes do commit. */
  beforeCommit?: (item: ReceivableOverdueItemRef) => void;
  /** Depois do commit, antes de contabilizar (resposta perdida). */
  afterCommit?: (item: ReceivableOverdueItemRef) => void | Promise<void>;
}

export interface ReceivableOverdueItemRef {
  workspaceId: string;
  receivableId: string;
}

type ItemResult =
  | {kind: "published"; document: admin.firestore.DocumentData}
  | {kind: "alreadyDelivered" | "reconciled" | "closed" | "rescheduled" |
      "gone"}
  | {kind: "invalid"; attempts: number};

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Workspace do caminho `workspaces/{ws}/receivable_overdue_queue/{id}`. */
const workspaceIdOfItem = (
  ref: admin.firestore.DocumentReference,
): string | null => {
  const workspace = ref.parent.parent;
  return workspace && workspace.parent.id === "workspaces" &&
    workspace.parent.parent === null ? workspace.id : null;
};

/**
 * Referência depois de todo item do workspace na ordem por caminho: cursor
 * para saltar o resto dele. O ID do item é o do recebível, `rcv_` + 40
 * hexadecimais (`receivables/model.ts`), sempre abaixo de U+F8FF.
 */
const afterWorkspaceItems = (workspaceId: string) => admin.firestore().doc(
  `workspaces/${workspaceId}/${RECEIVABLE_OVERDUE_QUEUE_COLLECTION}/\uf8ff`);

/**
 * Campos de reagendamento do item, sem tocar no episódio enfileirado. Com
 * backoff zero, `runAfterDay` (já devido) fica como está.
 */
const retryFields = (
  attempts: number,
  errorCode: ReceivableOverdueErrorCode,
  today: string,
) => {
  const backoffDays = receivableOverdueBackoffDays(attempts, errorCode);
  return {
    attempts,
    lastErrorCode: errorCode,
    lastAttemptAt: FieldValue.serverTimestamp(),
    ...(backoffDays > 0 ?
      {runAfterDay: addDaysToDayKey(today, backoffDays)} : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
};

const processItem = (input: {
  item: ReceivableOverdueItemRef;
  queueRef: admin.firestore.DocumentReference;
  today: string;
  createdAtMs: number;
  runId: string | null;
  faults: ReceivableOverdueFaults;
}): Promise<ItemResult> => {
  const {item, queueRef, today} = input;
  const receivableRef = receivablesRef(item.workspaceId).doc(item.receivableId);
  return admin.firestore().runTransaction(async (transaction) => {
    const [queueSnap, receivableSnap] =
      await transaction.getAll(queueRef, receivableRef);
    if (!queueSnap.exists) return {kind: "gone"} as const;
    if (!receivableSnap.exists) {
      // Recebíveis nunca são apagados: sem fonte de verdade, não há aviso.
      transaction.delete(queueRef);
      return {kind: "closed"} as const;
    }
    const receivable = readAuthoritativeReceivable(
      item.receivableId, receivableSnap.data(), item.workspaceId);
    if (receivable && (receivable.status !== "open" ||
      receivable.balanceCents <= 0)) {
      transaction.delete(queueRef);
      return {kind: "closed"} as const;
    }
    if (!receivable || !isDayKey(receivable.dueDate)) {
      const previous = queueSnap.get("attempts");
      const attempts = (isCount(previous) ? previous : 0) + 1;
      transaction.update(queueRef,
        retryFields(attempts, "receivable_invalid", today));
      return {kind: "invalid", attempts} as const;
    }
    if (receivable.dueDate >= today) {
      transaction.update(queueRef, {
        dueDate: receivable.dueDate,
        runAfterDay: firstOverdueDay(receivable.dueDate),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {kind: "rescheduled"} as const;
    }
    const document = buildNotificationDocument(receivableOverdueNotification({
      workspaceId: item.workspaceId,
      receivableId: item.receivableId,
      dueDate: receivable.dueDate,
      today,
      createdAtMs: input.createdAtMs,
    }));
    const notificationRef = notificationsRef(item.workspaceId).doc(document.id);
    const deliveryRef = receivableOverdueDeliveryRef(
      item.workspaceId, document.id);
    const [deliverySnap, notificationSnap] =
      await transaction.getAll(deliveryRef, notificationRef);
    if (deliverySnap.exists) {
      transaction.delete(queueRef);
      return {kind: "alreadyDelivered"} as const;
    }
    const delivery = {
      schemaVersion: RECEIVABLE_OVERDUE_WORK_SCHEMA_VERSION,
      workspaceId: item.workspaceId,
      receivableId: item.receivableId,
      episode: receivable.dueDate,
      notificationId: document.id,
      origin: notificationSnap.exists ? "reconciled" : "published",
      runId: input.runId,
      deliveredAt: FieldValue.serverTimestamp(),
    };
    if (!notificationSnap.exists) transaction.create(notificationRef, document);
    transaction.create(deliveryRef, delivery);
    transaction.delete(queueRef);
    input.faults.beforeCommit?.(item);
    return notificationSnap.exists ?
      {kind: "reconciled"} as const :
      {kind: "published", document} as const;
  });
};

/** Executa `run` sobre `items` com no máximo `limit` em paralelo. */
const forEachConcurrently = async <T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await run(item);
    }
  };
  await Promise.all(
    Array.from({length: Math.min(limit, items.length)}, lane));
};

export const runReceivableOverdueNotifications = async (options: {
  /** Dia civil de São Paulo; padrão: o dia de `nowMs` (ou do início). */
  today?: string;
  /** Instante de criação dos avisos; padrão: relógio do servidor. */
  nowMs?: number;
  pageSize?: number;
  maxPages?: number;
  concurrency?: number;
  timeBudgetMs?: number;
  hardStopMs?: number;
  workspaceShare?: number;
  /**
   * Correlação da execução nos logs (OBSERVABILITY §4): derivada do
   * instante agendado, a mesma se o Scheduler repetir a execução.
   */
  runId?: string;
  faults?: ReceivableOverdueFaults;
} = {}): Promise<ReceivableOverdueSummary> => {
  const startedAt = Date.now();
  // Um único relógio: o dia de detecção é o dia civil de São Paulo do mesmo
  // instante que carimba os avisos, sem offset fixo.
  const today = options.today ??
    saoPauloDayKey(new Date(options.nowMs ?? startedAt));
  const pageSize = options.pageSize ?? RECEIVABLE_OVERDUE_PAGE_SIZE;
  const maxPages = options.maxPages ?? RECEIVABLE_OVERDUE_MAX_PAGES;
  const concurrency = options.concurrency ?? RECEIVABLE_OVERDUE_CONCURRENCY;
  const timeBudgetMs =
    options.timeBudgetMs ?? RECEIVABLE_OVERDUE_TIME_BUDGET_MS;
  const hardStopMs = options.hardStopMs ?? RECEIVABLE_OVERDUE_HARD_STOP_MS;
  const workspaceShare =
    options.workspaceShare ?? RECEIVABLE_OVERDUE_WORKSPACE_SHARE;
  const shareUsed = new Map<string, number>();
  // Cota da passada corrente: `workspaceShare` na 1ª, sem limite na 2ª.
  let shareLimit = workspaceShare;
  let shareExhausted = false;
  // Itens já tratados nesta execução (processados ou com falha registrada):
  // a 2ª passada não os repete.
  const handled = new Set<string>();
  const faults = options.faults ?? {};
  const runId = options.runId ?? null;
  const log = createOperationLogger({
    operation: RECEIVABLE_OVERDUE_OPERATION,
    runId: options.runId,
  });
  const summary: ReceivableOverdueSummary = {
    today, scanned: 0, published: 0, alreadyDelivered: 0, reconciled: 0,
    closed: 0, rescheduled: 0, invalid: 0, gone: 0, failed: 0,
    persistentFailures: 0, retriedSameDay: 0, retryNotRecorded: 0, pages: 0,
    deferred: 0, throttled: 0, budgetExhausted: false, pendingDueAtEnd: null,
    backlog: false, durationMs: 0, outcome: "idle",
  };
  const due = admin.firestore()
    .collectionGroup(RECEIVABLE_OVERDUE_QUEUE_COLLECTION)
    .where("runAfterDay", "<=", today);
  const ordered = due
    .orderBy("runAfterDay", "asc")
    .orderBy(FieldPath.documentId(), "asc");

  const recordFailure = async (
    doc: admin.firestore.QueryDocumentSnapshot,
    item: ReceivableOverdueItemRef,
    error: unknown,
  ) => {
    const errorCode = receivableOverdueErrorCode(error);
    const previous = doc.get("attempts");
    const attempts = (isCount(previous) ? previous : 0) + 1;
    summary.failed += 1;
    // Só identificadores e o código: nada de cliente, descrição ou valor.
    log.error("receivable_overdue_item_failed", error, {
      ...item, errorCode, attempts,
    });
    try {
      // Pré-condição de versão: se o domínio regravou o item (novo
      // episódio) ou outro worker o concluiu, nada é sobrescrito.
      await doc.ref.update(retryFields(attempts, errorCode, today),
        {lastUpdateTime: doc.updateTime});
    } catch (recordError) {
      summary.retryNotRecorded += 1;
      log.warn("receivable_overdue_retry_not_recorded", {
        ...item, errorCode: receivableOverdueErrorCode(recordError),
      });
      return;
    }
    if (receivableOverdueBackoffDays(attempts, errorCode) === 0) {
      summary.retriedSameDay += 1;
    }
    if (receivableOverdueIsPersistent(attempts, errorCode)) {
      summary.persistentFailures += 1;
      log.warn("receivable_overdue_persistent_failure", {
        ...item, errorCode, attempts,
      });
    }
  };

  const handle = async (doc: admin.firestore.QueryDocumentSnapshot) => {
    if (handled.has(doc.ref.path)) return;
    summary.scanned += 1;
    const workspaceId = workspaceIdOfItem(doc.ref);
    if (!workspaceId) {
      handled.add(doc.ref.path);
      // Só o backend grava a fila, sempre sob um workspace: inalcançável sem
      // corrupção. Sem tenant não há o que revalidar nem onde publicar.
      summary.invalid += 1;
      log.error("receivable_overdue_item_out_of_tenant", null, {
        path: doc.ref.path,
      });
      return;
    }
    const item = {workspaceId, receivableId: doc.id};
    if (Date.now() - startedAt >= hardStopMs) {
      // Item não iniciado: continua devido para a execução seguinte.
      summary.deferred += 1;
      summary.budgetExhausted = true;
      return;
    }
    const used = shareUsed.get(workspaceId) ?? 0;
    if (used >= shareLimit) {
      // Cota do workspace esgotada na 1ª passada: fica para a 2ª, se houver
      // tempo, ou para a execução seguinte.
      summary.throttled += 1;
      shareExhausted = true;
      return;
    }
    shareUsed.set(workspaceId, used + 1);
    handled.add(doc.ref.path);
    try {
      await faults.beforeTransaction?.(item);
      const result = await processItem({
        item,
        queueRef: doc.ref,
        today,
        // Instante da criação, capturado uma única vez por item: as
        // repetições da transação gravam o mesmo documento.
        createdAtMs: options.nowMs ?? Date.now(),
        runId,
        faults,
      });
      await faults.afterCommit?.(item);
      if (result.kind === "invalid") {
        summary.invalid += 1;
        log.warn("receivable_overdue_receivable_invalid", {
          ...item, attempts: result.attempts,
        });
        if (receivableOverdueBackoffDays(result.attempts,
          "receivable_invalid") === 0) {
          summary.retriedSameDay += 1;
        }
        if (receivableOverdueIsPersistent(result.attempts,
          "receivable_invalid")) {
          summary.persistentFailures += 1;
          log.warn("receivable_overdue_persistent_failure", {
            ...item, errorCode: "receivable_invalid", attempts: result.attempts,
          });
        }
        return;
      }
      summary[result.kind] += 1;
      if (result.kind === "published") {
        log.info("notification_published",
          notificationPublishLogFields(result.document, "created"));
      }
    } catch (error) {
      await recordFailure(doc, item, error);
    }
  };

  /**
   * Percorre a fila devida em ordem, em páginas, até o fim (devolve `true`)
   * ou até o tempo ou o teto de páginas da execução (devolve `false`).
   */
  const sweep = async (): Promise<boolean> => {
    // Posição na ordem (`runAfterDay`, caminho) depois da qual continuar.
    let after: [unknown, admin.firestore.DocumentReference] | null = null;
    while (summary.pages < maxPages) {
      // A primeira página da execução sempre começa.
      const elapsed = Date.now() - startedAt;
      if (summary.pages > 0 &&
        (elapsed >= timeBudgetMs || elapsed >= hardStopMs)) {
        return false;
      }
      let query = ordered.limit(pageSize);
      if (after) query = query.startAfter(...after);
      const snapshot = await query.get();
      summary.pages += 1;
      await forEachConcurrently(snapshot.docs, concurrency, handle);
      if (snapshot.size < pageSize) return true;
      const last = snapshot.docs[snapshot.size - 1];
      const lastWorkspace = workspaceIdOfItem(last.ref);
      // Cota esgotada: salta o resto deste workspace no mesmo dia, sem ler
      // os itens dele que não seriam processados nesta passada. O salto
      // também conta como cota esgotada: os itens saltados (não lidos) são
      // excedente que a 2ª passada atende.
      if (lastWorkspace !== null &&
        (shareUsed.get(lastWorkspace) ?? 0) >= shareLimit) {
        shareExhausted = true;
        after = [last.get("runAfterDay"), afterWorkspaceItems(lastWorkspace)];
      } else {
        after = [last.get("runAfterDay"), last.ref];
      }
    }
    return false;
  };
  try {
    let complete = await sweep();
    if (complete && shareExhausted) {
      // Todo workspace já teve a sua cota: o tempo que sobra vai para o
      // excedente, na ordem da fila.
      shareLimit = Number.POSITIVE_INFINITY;
      complete = await sweep();
    }
    // Parou por tempo ou páginas: pode haver trabalho devido não visitado.
    if (!complete) summary.budgetExhausted = true;
  } catch (error) {
    summary.outcome = "structural_error";
    summary.durationMs = Date.now() - startedAt;
    log.error("receivable_overdue_notifications_structural_error", error, {
      ...summary,
    });
    throw error;
  }
  try {
    summary.pendingDueAtEnd = (await due.count().get()).data().count;
  } catch (error) {
    // O trabalho da execução já foi feito: sem a contagem, o resumo fica
    // sem o total pendente, mas a execução não vira erro estrutural.
    log.warn("receivable_overdue_pending_count_failed", {
      errorCode: receivableOverdueErrorCode(error),
    });
  }
  // O excedente da cota só sobra se a 2ª passada não terminou, e então
  // `budgetExhausted` já está ligado.
  summary.backlog = summary.pendingDueAtEnd === null ?
    (summary.budgetExhausted ? true : null) :
    summary.pendingDueAtEnd >
      summary.retriedSameDay + summary.retryNotRecorded;
  summary.durationMs = Date.now() - startedAt;
  if (summary.failed > 0 || summary.invalid > 0) {
    summary.outcome = "recoverable_failures";
  } else if (summary.backlog) {
    summary.outcome = "backlog";
  } else if (summary.scanned > 0) {
    summary.outcome = "drained";
  }
  if (summary.outcome === "recoverable_failures" ||
    summary.outcome === "backlog") {
    log.warn("receivable_overdue_notifications_attention", {...summary});
  }
  log.info("receivable_overdue_notifications_completed", {...summary});
  return summary;
};

export const processReceivableOverdueNotifications = onSchedule(
  {
    ...SCHEDULED_FUNCTION_OPTIONS,
    schedule: "every 60 minutes",
    timeZone: "America/Sao_Paulo",
  },
  async (event) => {
    await runReceivableOverdueNotifications({
      runId: `receivable-overdue-${event.scheduleTime}`,
    });
  },
);
