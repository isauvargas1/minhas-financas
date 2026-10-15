import * as admin from "firebase-admin";

import {
  assertActiveAccount,
  cashEntryFactId,
  postAccountMovements,
  readPostingAccounts,
  signedCashEntryCents,
  type PostingAccount,
} from "../accounts/ledger";
import {cashEntryMovementIdFor} from "../accounts/model";
import {reserveTransactionQuota} from "../billing/transactionQuota";
import {appendCashEvent} from "../shared/audit";
import {ApplicationError} from "../shared/errors";
import {sha256, stableStringify} from "../shared/hashing";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
} from "../shared/idempotency";
import {reserveRateLimit, type RateLimitPolicy} from "../shared/rateLimit";
import {
  reassertWorkspaceActor,
  workspaceRef,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import type {
  CashImportItem,
  CashImportItemStatus,
  ImportCashTransactionsPayload,
  ImportCashTransactionsResult,
} from "./contracts";
import {
  CASH_ENTRY_ROLES,
  PJ_ONLY_FIELDS_MESSAGE,
  cashEntryDocument,
  type CashCreateOptions,
  type CashEntryInput,
} from "./createTransaction";
import {
  UNCATEGORIZED,
  readEntryCategories,
  resolveEntryCategory,
  type ResolvedEntryCategory,
} from "./categories";

/**
 * Importação autoritativa de lançamentos manuais confirmados (P3-D, D-40).
 *
 * Cada lote é **uma** transação do Firestore, tudo ou nada:
 *
 * 1. relê a autorização (mesma matriz da criação: owner, admin, member);
 * 2. reserva a chave de idempotência do lote; replay devolve o resultado
 *    salvo sem escrita e sem consumo;
 * 3. lê o lançamento de cada linha no ID determinístico
 *    `(workspace, ator, importação, linha)`. Linha já importada com o mesmo
 *    conteúdo é reconhecida e não é criada de novo nem consome quota; com
 *    outro conteúdo, o lote inteiro é recusado;
 * 4. reserva o limite operacional do lote e **todas** as unidades de quota
 *    das linhas novas de uma vez: se não couberem, nada é criado;
 * 5. cria os lançamentos (mesmo documento da criação unitária, marcado com o
 *    canal `import`), um evento `cash_entry.created` por linha, um movimento
 *    `cash_transaction` por linha nova na conta do lote (D-30, P3-J) com o
 *    saldo novo da conta, a conclusão da chave e os contadores, no mesmo
 *    commit. Linha já importada não move a conta de novo.
 *
 * A atomicidade é **por lote**, não da importação inteira: um arquivo maior
 * que `CASH_IMPORT_MAX_ITEMS` linhas é enviado em vários lotes, cada um com
 * a própria chave e o mesmo `importId`. A retomada é segura porque a
 * identidade da linha não depende do lote: refazer um lote que falhou, ou
 * reenviar lotes já aplicados com outra chave, só cria o que falta. Nenhuma
 * chamada de rede externa acontece dentro da transação.
 */
export const IMPORT_CASH_TRANSACTIONS_OPERATION = "importCashTransactions";

/**
 * Limite operacional da importação: 12 lotes a cada 10 minutos, por ator e
 * workspace (até 600 linhas, cerca de 1 linha por segundo). Cada linha é uma
 * entrega do gatilho que incrementa o documento mensal da projeção; acima de
 * ~1 escrita/s sustentada no mesmo documento a contenção cresce (P3-B). Como
 * na criação, não é a quota comercial; replay e recusa antes do commit não
 * consomem.
 */
export const CASH_IMPORT_RATE_LIMIT: RateLimitPolicy = {
  operation: "importCashTransactions",
  limit: 12,
  windowSeconds: 10 * 60,
};

export const IMPORT_LINE_CONFLICT_MESSAGE =
  "Uma linha desta importação já foi registrada com outros dados. Revise o " +
  "arquivo e envie a importação novamente.";

const INTERNAL_MESSAGE =
  "Não foi possível importar os lançamentos. Tente novamente.";

const db = () => admin.firestore();

/** ID da linha: o ator entra no hash, como na criação unitária. */
export const cashImportTransactionId = (
  workspaceId: string,
  uid: string,
  importId: string,
  lineId: string,
): string =>
  "cashimp_" +
  sha256(`${workspaceId}:${uid}:${importId}:${lineId}`).slice(0, 40);

/** Agrupa as linhas de uma importação sem gravar o `importId` em claro. */
export const cashImportRef = (
  workspaceId: string,
  uid: string,
  importId: string,
): string => sha256(`cash-import:${workspaceId}:${uid}:${importId}`)
  .slice(0, 32);

/**
 * Hash do conteúdo da linha: reconhece a mesma linha em outro lote. A conta
 * do lote entra no hash: a mesma linha reenviada para outra conta é
 * conflito, nunca "já importada".
 */
export const cashImportItemHash = (
  workspaceId: string,
  importId: string,
  cashAccountId: string,
  item: CashImportItem,
): string => sha256(stableStringify({
  operation: IMPORT_CASH_TRANSACTIONS_OPERATION,
  workspaceId,
  importId,
  cashAccountId,
  item,
}));

const toEntryInput = (
  item: CashImportItem,
  cashAccountId: string,
  category: ResolvedEntryCategory,
): CashEntryInput => {
  // `lineId` identifica a linha; não faz parte do lançamento.
  const {lineId: _lineId, ...entry} = item;
  void _lineId;
  return {
    ...entry,
    cashAccountId,
    category: category.name,
    categoryId: category.categoryId,
  };
};

/**
 * Categoria de cada linha nova (D-37.8): o ID informado, conferido no
 * catálogo; linha sem ID fica "Sem categoria". Erro aponta a linha.
 */
const resolveLineCategories = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  lines: Array<{transactionId: string; item: CashImportItem}>,
): Promise<Map<string, ResolvedEntryCategory>> => {
  const ids = lines.flatMap((line) =>
    line.item.categoryId === undefined ? [] : [line.item.categoryId]);
  const items = await readEntryCategories(transaction, workspaceId, ids);
  const resolved = new Map<string, ResolvedEntryCategory>();
  for (const line of lines) {
    const categoryId = line.item.categoryId;
    if (categoryId === undefined) {
      resolved.set(line.transactionId, UNCATEGORIZED);
      continue;
    }
    try {
      resolved.set(line.transactionId, resolveEntryCategory(
        categoryId, items.get(categoryId), line.item.type));
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw new ApplicationError(error.code, error.message,
          {lineId: line.item.lineId});
      }
      throw error;
    }
  }
  return resolved;
};

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** Resumo em pt-BR do resultado do lote. */
export const importSummaryMessage = (
  created: number,
  alreadyImported: number,
): string => {
  const createdText = plural(
    created,
    "lançamento importado",
    "lançamentos importados",
  );
  const existingText = plural(
    alreadyImported,
    "já estava registrado",
    "já estavam registrados",
  );
  if (created === 0) return `Nenhum lançamento novo: ${existingText}.`;
  if (alreadyImported === 0) return `${createdText}.`;
  return `${createdText}; ${existingText}.`;
};

const replayImport = (
  stored: Record<string, unknown>,
): ImportCashTransactionsResult => {
  if (
    typeof stored.importId !== "string" ||
    !Array.isArray(stored.items) ||
    typeof stored.message !== "string"
  ) {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return {
    ...(stored as unknown as ImportCashTransactionsResult),
    replayed: true,
  };
};

export const executeImportCashTransactions = async (
  actor: WorkspaceActor,
  payload: ImportCashTransactionsPayload,
  requestId: string,
  options: CashCreateOptions = {},
): Promise<ImportCashTransactionsResult> =>
  db().runTransaction(async (transaction) => {
    const {workspace, role} = await reassertWorkspaceActor(
      transaction,
      actor,
      CASH_ENTRY_ROLES,
    );
    const profileType = workspace.type === "PJ" ? "PJ" : "PF";
    if (profileType !== "PJ") {
      const pjOnly = payload.items.find((item) =>
        item.supplier !== undefined || item.costCenter !== undefined);
      if (pjOnly) {
        throw new ApplicationError(
          "invalid_payload",
          PJ_ONLY_FIELDS_MESSAGE,
          {lineId: pjOnly.lineId},
        );
      }
    }

    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: IMPORT_CASH_TRANSACTIONS_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (reservation.replay) return replayImport(reservation.replay);

    const importRef = cashImportRef(
      actor.workspaceId,
      actor.uid,
      payload.importId,
    );
    const lines = payload.items.map((item) => {
      const transactionId = cashImportTransactionId(
        actor.workspaceId,
        actor.uid,
        payload.importId,
        item.lineId,
      );
      return {
        item,
        transactionId,
        ref: workspaceRef(actor.workspaceId)
          .collection("transactions")
          .doc(transactionId),
        hash: cashImportItemHash(
          actor.workspaceId, payload.importId, payload.cashAccountId, item),
      };
    });
    const snapshots = await transaction.getAll(
      ...lines.map((line) => line.ref),
    );
    const statuses: CashImportItemStatus[] = snapshots.map((snapshot, i) => {
      if (!snapshot.exists) return "created";
      const entry = snapshot.get("cashEntry") as
        | Record<string, unknown>
        | undefined;
      if (
        entry?.requestHash === lines[i].hash &&
        entry?.importRef === importRef &&
        snapshot.get("userId") === actor.uid
      ) {
        return "already_imported";
      }
      throw new ApplicationError(
        "idempotency_conflict",
        IMPORT_LINE_CONFLICT_MESSAGE,
        {lineId: lines[i].item.lineId},
      );
    });
    const fresh = lines.filter((_, i) => statuses[i] === "created");
    // Conta do lote (D-30): relida no workspace autorizado e ativa.
    const accounts = await readPostingAccounts(
      transaction, actor.workspaceId, [payload.cashAccountId]);
    assertActiveAccount(
      accounts.get(payload.cashAccountId) as PostingAccount);
    const categories = await resolveLineCategories(
      transaction, actor.workspaceId, fresh);

    const rateLimit = await reserveRateLimit(
      transaction,
      actor.workspaceId,
      actor.uid,
      CASH_IMPORT_RATE_LIMIT,
    );
    // Últimas leituras: todas as unidades novas de uma vez, ou nenhuma.
    const quota = fresh.length === 0 ?
      null :
      await reserveTransactionQuota(transaction, {
        actorUid: actor.uid,
        workspaceId: actor.workspaceId,
        workspace,
        units: fresh.length,
        nowMs: (options.now ?? Date.now)(),
      });

    if (fresh.length > 0) {
      postAccountMovements(transaction, accounts, fresh.map((line) => ({
        id: cashEntryMovementIdFor(line.transactionId, "apply", 1),
        accountId: payload.cashAccountId,
        kind: "cash_transaction" as const,
        amountCents: signedCashEntryCents(line.item.type,
          line.item.amountCents),
        effectiveDate: line.item.date,
        sourceDomain: "cash" as const,
        sourceId: line.transactionId,
        sourceFactId: cashEntryFactId(line.transactionId, 1),
        reversalOf: null,
      })), {
        workspaceId: actor.workspaceId,
        actorUid: actor.uid,
        operation: IMPORT_CASH_TRANSACTIONS_OPERATION,
        requestId,
      });
    }
    for (const line of fresh) {
      transaction.create(line.ref, cashEntryDocument({
        actorUid: actor.uid,
        workspaceId: actor.workspaceId,
        profileType,
        entry: toEntryInput(line.item, payload.cashAccountId,
          categories.get(line.transactionId) ?? UNCATEGORIZED),
        requestHash: line.hash,
        origin: {
          kind: "manual",
          quotaPeriod: (quota as {periodKey: string}).periodKey,
        },
        accountMovementId:
          cashEntryMovementIdFor(line.transactionId, "apply", 1),
        importRef,
      }));
      appendCashEvent(transaction, {
        workspaceId: actor.workspaceId,
        operation: "cash_entry.created",
        actorId: actor.uid,
        actorRole: role,
        profileType,
        transactionId: line.transactionId,
        requestHash: line.hash,
        requestId,
        channel: "import",
        entryStatus: "confirmed",
      });
    }
    const created = fresh.length;
    const alreadyImported = lines.length - created;
    const result = {
      importId: payload.importId,
      created,
      alreadyImported,
      periodKey: quota?.periodKey ?? null,
      items: lines.map((line, i) => ({
        lineId: line.item.lineId,
        transactionId: line.transactionId,
        status: statuses[i],
      })),
      message: importSummaryMessage(created, alreadyImported),
    };
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: IMPORT_CASH_TRANSACTIONS_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    quota?.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });
