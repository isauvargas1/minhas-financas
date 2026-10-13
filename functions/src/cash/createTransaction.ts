import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {
  assertActiveAccount,
  cashEntryFactId,
  postAccountMovements,
  readPostingAccounts,
  signedCashEntryCents,
} from "../accounts/ledger";
import {cashEntryMovementIdFor} from "../accounts/model";
import {reserveTransactionQuota} from "../billing/transactionQuota";
import {appendCashEvent} from "../shared/audit";
import {ApplicationError} from "../shared/errors";
import {sha256} from "../shared/hashing";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
} from "../shared/idempotency";
import {MONEY_CURRENCY} from "../shared/money";
import {reserveRateLimit, type RateLimitPolicy} from "../shared/rateLimit";
import {
  reassertWorkspaceActor,
  workspaceRef,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {
  settlementOf,
  type CashEntrySettlement,
  type CreateCashTransactionPayload,
  type CreateCashTransactionResult,
} from "./contracts";
import {readEntryCategories, resolveEntryCategory} from "./categories";

/**
 * Criação autoritativa de lançamento manual (P3-A, PR-TX-01), confirmado ou
 * pendente (P3-F, D-29).
 *
 * Uma transação do Firestore faz tudo ou nada:
 *
 * 1. relê a autorização (conta ativa, membership ativo, papel, workspace
 *    ativo) — a pré-checagem do kernel é só filtro;
 * 2. reserva a chave de idempotência do ator (`users/{uid}/idempotency_keys`);
 *    um replay devolve o resultado salvo sem nenhuma escrita;
 * 3. lê o lançamento no ID determinístico `(workspace, ator, chave)`, que é a
 *    âncora durável da intenção: depois da retenção da chave (90 dias), a
 *    mesma intenção ainda não cria um segundo fato;
 * 4. reserva uma unidade do limite operacional do ator no workspace
 *    (`CASH_ENTRY_RATE_LIMIT`), só para uma criação de fato;
 * 5. reserva uma unidade da quota comercial do mês (P3-D, D-40): titular
 *    canônico, entitlement efetivo dele agora e contador do workspace no mês
 *    de São Paulo do relógio do servidor (`billing/transactionQuota.ts`).
 *    Pendente e agendado consomem na criação como o confirmado; a
 *    confirmação posterior não consome de novo (P3-F);
 * 6. cria o lançamento, o evento append-only de auditoria, a conclusão da
 *    chave e os dois contadores.
 *
 * P3-J (D-30): a conta informada é relida na transação (existe no workspace
 * e está ativa). Confirmado: o movimento `cash_transaction` e o saldo novo da
 * conta entram no mesmo commit (receita soma, despesa subtrai). Pendente: a
 * conta fica gravada e o saldo só muda na confirmação.
 *
 * Nada aqui toca projeção ou outro domínio. A projeção mensal continua
 * com o gatilho `onTransactionWrite`, que já é idempotente por entrega
 * (INV-P3-001); trocar essa via é D-38. O valor autoritativo é `valueCents`
 * (a data civil é `date`); não há `value` em reais nem `transactionDate`.
 */
export const CREATE_CASH_TRANSACTION_OPERATION = "createCashTransaction";

/** Mesma matriz da escrita de transações nas Rules: viewer só lê. */
export const CASH_ENTRY_ROLES: readonly WorkspaceRole[] = [
  "owner",
  "admin",
  "member",
];

export const CASH_ENTRY_DOMAIN_VERSION = 1;

/**
 * Limite operacional de criação (P3-B): 120 lançamentos a cada 10 minutos,
 * por ator e workspace.
 *
 * Protege o backend de chamadas excessivas — um laço de cliente, um script —
 * sem atrapalhar o uso normal: digitar um lançamento leva segundos, e 120 em
 * 10 minutos é uma sessão intensa de lançamentos manuais. **Não** é a quota
 * comercial `transactionsPerMonth` (D-40, `billing/transactionQuota.ts`),
 * que limita o mês do workspace pelo plano do titular.
 *
 * A reserva acontece dentro da transação da criação, depois da releitura da
 * autorização, do replay de idempotência e da âncora durável:
 * - replay (pela chave ou pelo lançamento) não consome nem é barrado;
 * - recusa por autorização, contrato ou conflito não consome;
 * - falha antes do commit desfaz o contador junto com o resto.
 * O contador vive em `workspaces/{wid}/rate_limits` (negado ao cliente), com
 * `expiresAt` de 2 dias.
 */
export const CASH_ENTRY_RATE_LIMIT: RateLimitPolicy = {
  operation: "createCashTransaction",
  limit: 120,
  windowSeconds: 10 * 60,
};

export const IDEMPOTENCY_CONFLICT_MESSAGE =
  "Esta chave de idempotência já foi usada com outros dados.";

export const PJ_ONLY_FIELDS_MESSAGE =
  "Fornecedor e centro de custo só podem ser informados em espaço PJ.";

const INTERNAL_MESSAGE =
  "Não foi possível registrar o lançamento. Tente novamente.";

const db = () => admin.firestore();

/**
 * ID do lançamento: hash de `(workspace, ator, chave)`.
 *
 * O ator entra no hash porque a chave é escolhida pelo cliente: a chave de um
 * membro nunca colide com o lançamento de outro.
 */
export const cashTransactionId = (
  workspaceId: string,
  uid: string,
  idempotencyKey: string,
): string =>
  "cash_" + sha256(`${workspaceId}:${uid}:${idempotencyKey}`).slice(0, 40);

/** Lançamento validado: o que a criação, a importação e a correção gravam. */
export interface CashEntryInput {
  type: "receita" | "despesa";
  /** Conta/carteira do lançamento (D-30). */
  cashAccountId: string;
  description: string;
  /**
   * Retrato do nome da categoria, resolvido pelo backend no catálogo (ou
   * "Sem categoria"); nunca o texto do cliente (P5-C1, D-37.8).
   */
  category: string;
  /** ID estável do item do catálogo; `null` = sem categoria. */
  categoryId: string | null;
  amountCents: number;
  status?: "confirmed" | "pending";
  date?: string;
  dueDate?: string;
  incomeType?: string;
  expenseType?: string;
  paymentMethod?: string;
  supplier?: string;
  costCenter?: string;
}

const typeSpecificFields = (
  entry: CashEntryInput,
): Record<string, string> => {
  if (entry.type === "receita") {
    return entry.incomeType === undefined ?
      {} :
      {incomeType: entry.incomeType};
  }
  return {
    ...(entry.expenseType === undefined ?
      {} :
      {expenseType: entry.expenseType}),
    ...(entry.paymentMethod === undefined ?
      {} :
      {paymentMethod: entry.paymentMethod}),
  };
};

/**
 * Campos de estado e datas (D-29). Confirmado: `isPaid: true` e `date` é a
 * data efetiva. Pendente: `isPaid: false`, `dueDate` é o vencimento e `date`
 * repete o vencimento como data de referência — é por ela que as listas e
 * filtros por mês mostram a previsão. Sem efeito no caixa realizado enquanto
 * pendente (`cashPeriodDeltaFor`).
 */
export const settlementFields = (
  settlement: CashEntrySettlement,
): admin.firestore.DocumentData => settlement.status === "pending" ?
  {
    date: settlement.dueDate,
    dueDate: settlement.dueDate,
    isPaid: false,
  } :
  {
    date: settlement.date,
    isPaid: true,
  };

/**
 * Origem do lançamento criado pelo backend:
 *
 * - `manual`: criação unitária (P3-A, P3-F) e linha de importação (P3-D),
 *   que consomem a quota mensal (D-40) e gravam o mês consumido;
 * - `recurring`: gerado por uma ocorrência de despesa recorrente (P4-B), com
 *   o vínculo backend-only `recurringEntry` e sem quota (D-40: geração
 *   recorrente não consome `transactionsPerMonth`).
 */
export type CashEntryOrigin =
  | {kind: "manual"; quotaPeriod: string}
  | {kind: "recurring"; recurringExpenseId: string; occurrenceId: string};

export const CASH_RECURRING_ENTRY_VERSION = 1;

/**
 * Documento do lançamento criado pelo backend: o mesmo na criação unitária
 * (P3-A, P3-F), em cada linha da importação (P3-D) e na geração de
 * Recorrentes (P4-B). Autor, workspace, PF/PJ, centavos, moeda, estado e a
 * marca `cashEntry` vêm do servidor. `userId` é o responsável pelo
 * lançamento (o ator, ou o responsável pelo contrato recorrente) — é por ele
 * que `member` corrige, confirma e anula; `createdBy` é quem executou.
 */
export const cashEntryDocument = (input: {
  actorUid: string;
  /** Responsável (`userId`); omitido, é o próprio ator. */
  ownerUid?: string;
  workspaceId: string;
  profileType: "PF" | "PJ";
  entry: CashEntryInput;
  requestHash: string;
  origin: CashEntryOrigin;
  /** Movimento de conta aplicado (só no confirmado, D-30). */
  accountMovementId: string | null;
  /** Linha de importação: canal e referência (hash) da importação. */
  importRef?: string;
}): admin.firestore.DocumentData => {
  const {entry, origin} = input;
  const valueCents = entry.amountCents;
  const settlement = settlementOf(entry);
  return {
    type: entry.type,
    description: entry.description,
    category: entry.category,
    ...(entry.categoryId === null ? {} : {categoryId: entry.categoryId}),
    valueCents,
    ...settlementFields(settlement),
    workspaceId: input.workspaceId,
    profileId: input.workspaceId,
    profileType: input.profileType,
    userId: input.ownerUid ?? input.actorUid,
    ...typeSpecificFields(entry),
    ...(entry.supplier === undefined ? {} : {supplier: entry.supplier}),
    ...(entry.costCenter === undefined ? {} : {costCenter: entry.costCenter}),
    cashAccountId: entry.cashAccountId,
    cashEntry: {
      domainVersion: CASH_ENTRY_DOMAIN_VERSION,
      origin: origin.kind,
      status: settlement.status,
      currency: MONEY_CURRENCY,
      requestHash: input.requestHash,
      // Mês da quota que esta criação consumiu (D-40); a geração recorrente
      // não consome quota.
      quotaPeriod: origin.kind === "manual" ? origin.quotaPeriod : null,
      // Movimento de conta em vigor (D-30); `null` enquanto pendente.
      accountMovementId: input.accountMovementId,
      ...(input.importRef === undefined ?
        {} :
        {channel: "import", importRef: input.importRef}),
    },
    // Vínculo com a ocorrência de origem: só o backend grava (Rules).
    ...(origin.kind === "recurring" ? {
      recurringEntry: {
        domainVersion: CASH_RECURRING_ENTRY_VERSION,
        recurringExpenseId: origin.recurringExpenseId,
        occurrenceId: origin.occurrenceId,
      },
    } : {}),
    createdBy: input.actorUid,
    updatedBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
};

/** Relógio e ponto de falha injetáveis, só para os testes. */
export interface CashCreateOptions {
  /** Relógio do servidor (mês da quota). */
  now?: () => number;
  /** Com todas as escritas enfileiradas, antes do commit. */
  beforeCommit?: () => void;
}

const replayResult = (
  stored: Record<string, unknown>,
): CreateCashTransactionResult => {
  if (typeof stored.transactionId !== "string") {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return {transactionId: stored.transactionId, replayed: true};
};

export const executeCreateCashTransaction = async (
  actor: WorkspaceActor,
  payload: CreateCashTransactionPayload,
  requestId: string,
  options: CashCreateOptions = {},
): Promise<CreateCashTransactionResult> =>
  db().runTransaction(async (transaction) => {
    const {workspace, role} = await reassertWorkspaceActor(
      transaction,
      actor,
      CASH_ENTRY_ROLES,
    );
    const profileType = workspace.type === "PJ" ? "PJ" : "PF";
    if (
      profileType !== "PJ" &&
      (payload.supplier !== undefined || payload.costCenter !== undefined)
    ) {
      throw new ApplicationError("invalid_payload", PJ_ONLY_FIELDS_MESSAGE);
    }

    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: CREATE_CASH_TRANSACTION_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (reservation.replay) return replayResult(reservation.replay);

    const transactionId = cashTransactionId(
      actor.workspaceId,
      actor.uid,
      payload.idempotencyKey,
    );
    const entryRef = workspaceRef(actor.workspaceId)
      .collection("transactions")
      .doc(transactionId);
    const existing = await transaction.get(entryRef);
    if (existing.exists) {
      // Reserva expirada, lançamento preservado: a âncora durável decide.
      // Documento sem `cashEntry` (criado por outro caminho com este ID) ou
      // com outra intenção é conflito, nunca sobrescrita.
      const entry = existing.get("cashEntry") as
        | Record<string, unknown>
        | undefined;
      if (
        entry?.requestHash === reservation.requestHash &&
        existing.get("userId") === actor.uid
      ) {
        return {transactionId, replayed: true};
      }
      throw new ApplicationError(
        "idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE,
      );
    }

    // Conta do lançamento (D-30): no workspace autorizado e ativa, também
    // no pendente — a confirmação a usa.
    const accounts = await readPostingAccounts(
      transaction, actor.workspaceId, [payload.cashAccountId]);
    assertActiveAccount(accounts.get(payload.cashAccountId) as
      Parameters<typeof assertActiveAccount>[0]);
    // Categoria do catálogo (D-37.8): mesmo workspace, mesmo tipo, ativa.
    const categories = await readEntryCategories(
      transaction, actor.workspaceId, [payload.categoryId]);
    const category = resolveEntryCategory(
      payload.categoryId, categories.get(payload.categoryId), payload.type);

    const rateLimit = await reserveRateLimit(
      transaction,
      actor.workspaceId,
      actor.uid,
      CASH_ENTRY_RATE_LIMIT,
    );
    // Últimas leituras da transação; recusa aqui não escreve nada.
    const quota = await reserveTransactionQuota(transaction, {
      actorUid: actor.uid,
      workspaceId: actor.workspaceId,
      workspace,
      units: 1,
      nowMs: (options.now ?? Date.now)(),
    });

    const settlement = settlementOf(payload);
    const accountMovementId = settlement.status === "confirmed" ?
      cashEntryMovementIdFor(transactionId, "apply", 1) : null;
    if (settlement.status === "confirmed" && accountMovementId) {
      postAccountMovements(transaction, accounts, [{
        id: accountMovementId,
        accountId: payload.cashAccountId,
        kind: "cash_transaction",
        amountCents: signedCashEntryCents(payload.type, payload.amountCents),
        effectiveDate: settlement.date,
        sourceDomain: "cash",
        sourceId: transactionId,
        sourceFactId: cashEntryFactId(transactionId, 1),
        reversalOf: null,
      }], {
        workspaceId: actor.workspaceId,
        actorUid: actor.uid,
        operation: CREATE_CASH_TRANSACTION_OPERATION,
        requestId,
      });
    }
    transaction.create(entryRef, cashEntryDocument({
      actorUid: actor.uid,
      workspaceId: actor.workspaceId,
      profileType,
      entry: {
        ...payload,
        category: category.name,
        categoryId: category.categoryId,
      },
      requestHash: reservation.requestHash,
      origin: {kind: "manual", quotaPeriod: quota.periodKey},
      accountMovementId,
    }));
    appendCashEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "cash_entry.created",
      actorId: actor.uid,
      actorRole: role,
      profileType,
      transactionId,
      requestHash: reservation.requestHash,
      requestId,
      entryStatus: settlement.status,
    });
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: CREATE_CASH_TRANSACTION_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result: {transactionId},
    });
    rateLimit.commit();
    quota.commit();
    options.beforeCommit?.();
    return {transactionId, replayed: false};
  });
