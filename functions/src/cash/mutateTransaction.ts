import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {
  assertActiveAccount,
  cashEntryFactId,
  postAccountMovements,
  readPostedMovement,
  readPostingAccounts,
  reversalOfMovement,
  signedCashEntryCents,
  type PostingAccount,
  type PostingAccounts,
} from "../accounts/ledger";
import {
  cashEntryMovementIdFor,
  type CashAccountMovementInput,
} from "../accounts/model";

import {
  CASH_EVENTS_COLLECTION,
  appendCashMutationEvent,
  type CashFinancialSnapshot,
  type CashMutationOperation,
} from "../shared/audit";
import {parseIsoInstant} from "../shared/commitTime";
import {ApplicationError} from "../shared/errors";
import {sha256} from "../shared/hashing";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
  type ActorIdempotencyReservation,
} from "../shared/idempotency";
import {reserveRateLimit, type RateLimitPolicy} from "../shared/rateLimit";
import {
  reassertWorkspaceActor,
  workspaceRef,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {
  settlementOf,
  type CashEntryState,
  type ConfirmCashTransactionPayload,
  type ConfirmCashTransactionResult,
  type UpdateCashTransactionPayload,
  type UpdateCashTransactionResult,
  type VoidCashTransactionPayload,
  type VoidCashTransactionResult,
} from "./contracts";
import {
  CASH_ENTRY_ROLES,
  IDEMPOTENCY_CONFLICT_MESSAGE,
  PJ_ONLY_FIELDS_MESSAGE,
  transactionInstant,
} from "./createTransaction";
import {
  classifyCashEntryEligibility,
  type CashEntryEligibility,
  type CashEntryStatus,
} from "./eligibility";
import {compareCommitTimes} from "./periods";

/**
 * Correção e anulação autoritativas de lançamento (P3-C, D-35) e confirmação
 * de lançamento pendente (P3-F, D-29).
 *
 * Transições permitidas (toda transição é uma operação explícita, com evento
 * na trilha):
 *
 * - pendente → pendente (correção, com motivo);
 * - pendente → confirmado (`confirmCashTransaction`: data efetiva até hoje e
 *   valor liquidado; vencimento preservado; sem nova unidade de quota);
 * - confirmado → confirmado (correção, com motivo);
 * - pendente ou confirmado → anulado (com motivo).
 *
 * Confirmado não volta a pendente, anulado não muda mais, e uma segunda
 * confirmação do mesmo lançamento é recusada: nunca duas liquidações.
 *
 * Cada operação é uma transação do Firestore que faz tudo ou nada:
 *
 * 1. relê a autorização (conta ativa, membership ativo, papel, workspace
 *    ativo) e a janela sem escritas do ledger; `member` só altera o que
 *    registrou;
 * 2. reserva a chave de idempotência do ator; replay devolve o resultado
 *    salvo sem escrita;
 * 3. lê o lançamento e procura o evento desta intenção em `cash_events` de
 *    qualquer workspace (consulta de grupo por `intentId` e operação) — o
 *    evento é a âncora durável depois da retenção da chave: mesmo conteúdo
 *    é replay; outro lançamento, outro workspace ou outro conteúdo é
 *    conflito;
 * 4. confere a elegibilidade (`eligibility.ts`) e a versão lida pelo cliente
 *    (`expectedUpdatedAt` contra `updatedAt`): mudou desde a leitura, recusa
 *    com conflito, sem sobrescrever;
 * 5. reserva o limite operacional, só quando vai gravar;
 * 6. grava a alteração do lançamento, o evento append-only, a conclusão da
 *    chave e o contador, no mesmo commit.
 *
 * Identidade, `createdAt`, autor (`userId`, `createdBy`) e a âncora da
 * criação (`cashEntry.requestHash`) nunca mudam. Nada aqui escreve a projeção
 * mensal: o gatilho `onTransactionWrite` processa a alteração (P3-B). Nenhuma
 * das operações cria lançamento: o documento precisa existir.
 *
 * Conta/carteira (D-30, P3-J), no mesmo commit da operação:
 * - confirmação: aplica o movimento na conta (a registrada ou a informada);
 * - correção de confirmado que muda valor, tipo, data ou conta: compensa o
 *   movimento em vigor (estorno com `reversalOf`, mesma data efetiva) e
 *   aplica o novo; sem mudança de efeito, nenhum movimento;
 * - correção de pendente: só troca a conta gravada (ativa);
 * - anulação de confirmado: compensa o movimento em vigor; nada é apagado.
 * O movimento compensado é relido e conferido com o lançamento; divergência
 * é falha fechada.
 */
export const UPDATE_CASH_TRANSACTION_OPERATION = "updateCashTransaction";
export const CONFIRM_CASH_TRANSACTION_OPERATION = "confirmCashTransaction";
export const VOID_CASH_TRANSACTION_OPERATION = "voidCashTransaction";

/**
 * Limite operacional da correção, da confirmação e da anulação, somadas: 120
 * a cada 10 minutos por ator e workspace. Replay e correção sem mudança não
 * consomem; recusa antes do commit também não. Não é quota comercial (D-40).
 */
export const CASH_ENTRY_MUTATION_RATE_LIMIT: RateLimitPolicy = {
  operation: "mutateCashTransaction",
  limit: 120,
  windowSeconds: 10 * 60,
};

export const CASH_CONFLICT_MESSAGE =
  "Este lançamento foi alterado por outra operação depois que você o " +
  "abriu. Atualize e tente novamente.";
const NOT_FOUND_MESSAGE = "Lançamento não encontrado.";
const VOIDED_MESSAGE =
  "Lançamento anulado não pode ser alterado nem reativado.";
const INELIGIBLE_MESSAGE =
  "Este lançamento não pode ser alterado por esta operação.";
const MEMBER_OWNERSHIP_MESSAGE =
  "Você só pode alterar os lançamentos que você mesmo registrou.";
export const ALREADY_CONFIRMED_MESSAGE =
  "Este lançamento já está confirmado.";
export const CONFIRM_THROUGH_CONFIRMATION_MESSAGE =
  "Para confirmar um lançamento pendente, use a confirmação, com a data e o " +
  "valor efetivos.";
export const CONFIRMED_STAYS_CONFIRMED_MESSAGE =
  "Lançamento confirmado não volta a pendente.";
export const RECEIPT_PAYMENT_METHOD_MESSAGE =
  "Forma de pagamento só se aplica a despesa.";
const INTERNAL_MESSAGE =
  "Não foi possível alterar o lançamento. Tente novamente.";

/** Campos do estado corrigível, na ordem em que aparecem na trilha. */
const STATE_FIELDS = [
  "status",
  "type",
  "description",
  "category",
  "amountCents",
  "date",
  "dueDate",
  "incomeType",
  "expenseType",
  "paymentMethod",
  "supplier",
  "costCenter",
  "cashAccountId",
] as const;

type StateField = typeof STATE_FIELDS[number];
type StateValues = Record<StateField, string | number | undefined>;

/**
 * Retratos visuais do catálogo que deixam de valer quando o campo muda. A UI
 * volta a resolver pelo nome; manter o retrato antigo mostraria o rótulo
 * anterior.
 */
const SNAPSHOT_BY_FIELD: Partial<Record<StateField, string>> = {
  category: "categorySnapshot",
  type: "categorySnapshot",
  expenseType: "expenseTypeSnapshot",
  incomeType: "incomeTypeSnapshot",
  paymentMethod: "paymentMethodSnapshot",
  costCenter: "costCenterSnapshot",
};

/** Pontos de injeção de falha, só para os testes de atomicidade. */
export interface CashMutationFaults {
  /** Com todas as escritas enfileiradas, antes do commit. */
  beforeCommit?: () => void;
}

const db = () => admin.firestore();

const intentIdOf = (uid: string, idempotencyKey: string): string =>
  sha256(`${uid}:${idempotencyKey}`).slice(0, 32);

const textOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const currentValues = (
  data: admin.firestore.DocumentData,
  eligibility: Extract<CashEntryEligibility, {eligible: true}>,
): StateValues => ({
  status: eligibility.status,
  type: eligibility.type,
  description: textOrUndefined(data.description),
  category: textOrUndefined(data.category),
  amountCents: eligibility.amountCents,
  date: eligibility.date,
  dueDate: eligibility.dueDate ?? undefined,
  incomeType: textOrUndefined(data.incomeType),
  expenseType: textOrUndefined(data.expenseType),
  paymentMethod: textOrUndefined(data.paymentMethod),
  supplier: textOrUndefined(data.supplier),
  costCenter: textOrUndefined(data.costCenter),
  cashAccountId: eligibility.cashAccountId,
});

/**
 * Estado depois da correção. No pendente, a data de referência acompanha o
 * vencimento; no confirmado, o vencimento herdado da fase pendente fica como
 * estava (não é corrigível depois da liquidação).
 */
const nextValues = (
  entry: CashEntryState,
  current: StateValues,
): StateValues => {
  const settlement = settlementOf(entry);
  const pending = settlement.status === "pending";
  return {
    status: settlement.status,
    type: entry.type,
    description: entry.description,
    category: entry.category,
    amountCents: entry.amountCents,
    date: pending ? settlement.dueDate : settlement.date,
    dueDate: pending ? settlement.dueDate : current.dueDate,
    incomeType: entry.type === "receita" ? entry.incomeType : undefined,
    expenseType: entry.type === "despesa" ? entry.expenseType : undefined,
    paymentMethod: entry.type === "despesa" ? entry.paymentMethod : undefined,
    supplier: entry.supplier,
    costCenter: entry.costCenter,
    cashAccountId: entry.cashAccountId,
  };
};

const financialSnapshot = (values: StateValues): CashFinancialSnapshot => ({
  status: values.status as CashEntryStatus,
  amountCents: values.amountCents as number,
  type: values.type as "receita" | "despesa",
  date: values.date as string,
  dueDate: typeof values.dueDate === "string" ? values.dueDate : null,
  cashAccountId: typeof values.cashAccountId === "string" ?
    values.cashAccountId : null,
});

/**
 * A versão que o cliente leu precisa ser a atual. Todo escritor atual grava
 * `updatedAt`; um documento sem o campo só casa com `null`, para a comparação
 * nunca supor uma versão. `updatedAt` que não é Timestamp não tem versão
 * confiável e é recusado.
 */
const assertExpectedVersion = (
  current: unknown,
  expected: string | null,
): void => {
  if (current === undefined || current === null) {
    if (expected === null) return;
    throw new ApplicationError("concurrent_update", CASH_CONFLICT_MESSAGE);
  }
  if (!(current instanceof Timestamp)) {
    throw new ApplicationError(
      "domain_precondition_failed",
      INELIGIBLE_MESSAGE,
      {ineligible: "ambiguous_version"},
    );
  }
  if (
    expected === null ||
    compareCommitTimes(current, parseIsoInstant(expected)) !== 0
  ) {
    throw new ApplicationError("concurrent_update", CASH_CONFLICT_MESSAGE);
  }
};

interface LoadedEntry {
  role: WorkspaceRole;
  profileType: "PF" | "PJ";
  reservation: ActorIdempotencyReservation;
  intentId: string;
  entryRef: admin.firestore.DocumentReference;
  data: admin.firestore.DocumentData;
  eligibility: Extract<CashEntryEligibility, {eligible: true}>;
}

type LoadOutcome =
  | {replay: Record<string, unknown>}
  | {loaded: LoadedEntry};

/**
 * Fase de leitura comum às duas operações. Toda recusa acontece aqui, antes
 * de qualquer escrita.
 */
const loadForMutation = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  payload:
    | UpdateCashTransactionPayload
    | ConfirmCashTransactionPayload
    | VoidCashTransactionPayload,
  operation: string,
  eventOperation: CashMutationOperation,
): Promise<LoadOutcome> => {
  const {workspace, role} = await reassertWorkspaceActor(
    transaction,
    actor,
    CASH_ENTRY_ROLES,
  );
  const reservation = await reserveActorIdempotency(transaction, {
    uid: actor.uid,
    operation,
    idempotencyKey: payload.idempotencyKey,
    payload,
  });
  if (reservation.replay) return {replay: reservation.replay};

  const intentId = intentIdOf(actor.uid, payload.idempotencyKey);
  const entryRef = workspaceRef(actor.workspaceId)
    .collection("transactions")
    .doc(payload.transactionId);
  const entry = await transaction.get(entryRef);
  // A chave do ator identifica uma intenção, não um lançamento: a âncora é
  // procurada pela intenção em todos os workspaces, e não só neste
  // lançamento. Depois da P3-D, cada (intenção, operação) tem no máximo um
  // evento; a consulta usa o índice de grupo `cash_events(intentId,
  // operation)` e lê no máximo um documento.
  const anchors = await transaction.get(
    db().collectionGroup(CASH_EVENTS_COLLECTION)
      .where("intentId", "==", intentId)
      .where("operation", "==", eventOperation)
      .limit(1),
  );
  const event = anchors.docs[0];
  if (event) {
    // Chave do ator expirada, intenção já aplicada: a trilha decide. A mesma
    // chave com outro conteúdo, em outro lançamento ou em outro workspace é
    // conflito, nunca replay nem uma segunda aplicação.
    if (
      event.get("requestHash") !== reservation.requestHash ||
      event.get("actorId") !== actor.uid ||
      event.get("workspaceId") !== actor.workspaceId ||
      event.get("transactionId") !== payload.transactionId
    ) {
      throw new ApplicationError(
        "idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE,
      );
    }
    return {
      replay: {
        transactionId: payload.transactionId,
        changed: true,
        revision: Number(event.get("revision") ?? 0),
      },
    };
  }
  if (!entry.exists) {
    throw new ApplicationError("not_found", NOT_FOUND_MESSAGE);
  }
  const data = entry.data() ?? {};
  if (role === "member" && data.userId !== actor.uid) {
    throw new ApplicationError(
      "workspace_role_denied",
      MEMBER_OWNERSHIP_MESSAGE,
    );
  }
  const eligibility = classifyCashEntryEligibility(data, actor.workspaceId);
  if (!eligibility.eligible) {
    throw eligibility.code === "voided" ?
      new ApplicationError("domain_precondition_failed", VOIDED_MESSAGE) :
      new ApplicationError(
        "domain_precondition_failed",
        INELIGIBLE_MESSAGE,
        {ineligible: eligibility.code},
      );
  }
  assertExpectedVersion(data.updatedAt, payload.expectedUpdatedAt);
  return {
    loaded: {
      role,
      profileType: workspace.type === "PJ" ? "PJ" : "PF",
      reservation,
      intentId,
      entryRef,
      data,
      eligibility,
    },
  };
};

/**
 * Marca do domínio de caixa depois da operação: só revisão, estado e o
 * movimento de conta em vigor (a âncora `requestHash` fica intacta). A
 * confirmação registra quem e quando.
 */
const cashEntryPatch = (
  actorId: string,
  revision: number,
  status: "pending" | "confirmed" | "voided",
  accountMovementId: string | null | undefined,
  confirmation = false,
): admin.firestore.UpdateData<admin.firestore.DocumentData> => {
  const patch: admin.firestore.UpdateData<admin.firestore.DocumentData> = {
    "cashEntry.revision": revision,
    "cashEntry.status": status,
  };
  if (confirmation) {
    patch["cashEntry.confirmedAt"] = FieldValue.serverTimestamp();
    patch["cashEntry.confirmedBy"] = actorId;
  }
  // `undefined`: o movimento em vigor não muda.
  if (accountMovementId !== undefined) {
    patch["cashEntry.accountMovementId"] = accountMovementId;
  }
  return patch;
};

/**
 * Efeito de conta de uma operação (D-30): contas relidas, movimentos a
 * gravar e o movimento em vigor depois dela (`undefined` = não muda).
 */
interface AccountPlan {
  accounts: PostingAccounts;
  movements: CashAccountMovementInput[];
  accountMovementId: string | null | undefined;
}

const NO_ACCOUNT_EFFECT: AccountPlan = {
  accounts: new Map(),
  movements: [],
  accountMovementId: undefined,
};

/**
 * Relê e confere o movimento em vigor do lançamento confirmado: mesma conta,
 * mesmo valor com sinal e mesma data efetiva do lançamento. Qualquer
 * divergência é falha fechada — compensar um valor diferente do aplicado
 * deixaria o saldo errado.
 */
const readActiveEntryMovement = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  transactionId: string,
  eligibility: Extract<CashEntryEligibility, {eligible: true}>,
) => {
  // Confirmado sempre tem o movimento em vigor (elegibilidade, D-30).
  if (!eligibility.accountMovementId) {
    throw new ApplicationError("domain_precondition_failed",
      INELIGIBLE_MESSAGE, {ineligible: "ambiguous_account"});
  }
  const movement = await readPostedMovement(transaction, workspaceId,
    eligibility.accountMovementId,
    {accountId: eligibility.cashAccountId, sourceId: transactionId});
  if (
    movement.amountCents !==
      signedCashEntryCents(eligibility.type, eligibility.amountCents) ||
    movement.effectiveDate !== eligibility.date
  ) {
    throw new ApplicationError("domain_precondition_failed",
      INELIGIBLE_MESSAGE, {ineligible: "ambiguous_account"});
  }
  return movement;
};

const applyMovementFor = (
  transactionId: string,
  revision: number,
  values: StateValues,
): CashAccountMovementInput => ({
  id: cashEntryMovementIdFor(transactionId, "apply", revision),
  accountId: values.cashAccountId as string,
  kind: "cash_transaction",
  amountCents: signedCashEntryCents(
    values.type as "receita" | "despesa", values.amountCents as number),
  effectiveDate: values.date as string,
  sourceDomain: "cash",
  sourceId: transactionId,
  sourceFactId: cashEntryFactId(transactionId, revision),
  reversalOf: null,
});

/**
 * Plano de conta da correção. Pendente: só a troca de conta, que precisa
 * estar ativa. Confirmado: compensa o movimento em vigor e aplica o novo
 * quando conta, valor com sinal ou data efetiva mudam.
 */
const planUpdateAccountEffect = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  loaded: LoadedEntry,
  transactionId: string,
  before: StateValues,
  next: StateValues,
  revision: number,
): Promise<AccountPlan> => {
  const nextAccountId = next.cashAccountId as string;
  if (next.status === "pending") {
    if (nextAccountId === before.cashAccountId) return NO_ACCOUNT_EFFECT;
    const accounts = await readPostingAccounts(
      transaction, workspaceId, [nextAccountId]);
    assertActiveAccount(accounts.get(nextAccountId) as PostingAccount);
    return {accounts, movements: [], accountMovementId: undefined};
  }
  const active = await readActiveEntryMovement(
    transaction, workspaceId, transactionId, loaded.eligibility);
  const apply = applyMovementFor(transactionId, revision, next);
  if (
    active.accountId === apply.accountId &&
    active.amountCents === apply.amountCents &&
    active.effectiveDate === apply.effectiveDate
  ) {
    return NO_ACCOUNT_EFFECT;
  }
  const accounts = await readPostingAccounts(transaction, workspaceId,
    [active.accountId, apply.accountId]);
  const movements = [
    reversalOfMovement(active,
      cashEntryMovementIdFor(transactionId, "reverse", revision),
      cashEntryFactId(transactionId, revision)),
    apply,
  ];
  return {accounts, movements, accountMovementId: apply.id};
};

const postPlan = (
  transaction: admin.firestore.Transaction,
  plan: AccountPlan,
  context: {workspaceId: string; actorUid: string; operation: string;
    requestId: string},
): void => {
  if (plan.movements.length === 0) return;
  postAccountMovements(transaction, plan.accounts, plan.movements, context);
};

const replayUpdate = (
  stored: Record<string, unknown>,
): UpdateCashTransactionResult => {
  if (typeof stored.transactionId !== "string") {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return {
    transactionId: stored.transactionId,
    replayed: true,
    changed: stored.changed !== false,
    revision: Number(stored.revision ?? 0),
  };
};

export const executeUpdateCashTransaction = async (
  actor: WorkspaceActor,
  payload: UpdateCashTransactionPayload,
  requestId: string,
  faults: CashMutationFaults = {},
): Promise<UpdateCashTransactionResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadForMutation(
      transaction,
      actor,
      payload,
      UPDATE_CASH_TRANSACTION_OPERATION,
      "cash_entry.updated",
    );
    if ("replay" in outcome) return replayUpdate(outcome.replay);
    const loaded = outcome.loaded;

    const before = currentValues(loaded.data, loaded.eligibility);
    const next = nextValues(payload.entry, before);
    if (
      loaded.profileType !== "PJ" &&
      (next.supplier !== undefined || next.costCenter !== undefined)
    ) {
      throw new ApplicationError("invalid_payload", PJ_ONLY_FIELDS_MESSAGE);
    }
    // A correção mantém o estado: confirmar é outra operação, e confirmado
    // não volta a pendente (D-29).
    if (next.status !== before.status) {
      throw new ApplicationError(
        "domain_precondition_failed",
        before.status === "pending" ?
          CONFIRM_THROUGH_CONFIRMATION_MESSAGE :
          CONFIRMED_STAYS_CONFIRMED_MESSAGE,
        {transition: `${before.status}_to_${next.status}`},
      );
    }
    const changedFields = STATE_FIELDS.filter(
      (field) => before[field] !== next[field],
    );

    if (changedFields.length === 0) {
      // Nada a corrigir: nenhuma escrita no lançamento, na trilha ou no
      // limite. Só a chave é concluída, para o replay devolver o mesmo.
      const result = {
        transactionId: payload.transactionId,
        changed: false,
        revision: loaded.eligibility.revision,
      };
      completeActorIdempotency(transaction, loaded.reservation, {
        uid: actor.uid,
        operation: UPDATE_CASH_TRANSACTION_OPERATION,
        workspaceId: actor.workspaceId,
        requestId,
        result,
      });
      return {...result, replayed: false};
    }

    const revision = loaded.eligibility.revision + 1;
    const plan = await planUpdateAccountEffect(transaction, actor.workspaceId,
      loaded, payload.transactionId, before, next, revision);
    // Última leitura; recusa aqui não escreve nada.
    const rateLimit = await reserveRateLimit(
      transaction,
      actor.workspaceId,
      actor.uid,
      CASH_ENTRY_MUTATION_RATE_LIMIT,
    );

    postPlan(transaction, plan, {
      workspaceId: actor.workspaceId,
      actorUid: actor.uid,
      operation: UPDATE_CASH_TRANSACTION_OPERATION,
      requestId,
    });
    const amountCents = next.amountCents as number;
    const date = next.date as string;
    const pending = next.status === "pending";
    const patch: admin.firestore.UpdateData<admin.firestore.DocumentData> = {
      type: next.type,
      description: next.description,
      category: next.category,
      valueCents: amountCents,
      value: amountCents / 100,
      date,
      isPaid: !pending,
      // Pendente: o vencimento é a data de referência. Confirmado: o
      // vencimento herdado não muda.
      ...(pending ? {dueDate: date} : {}),
      cashAccountId: next.cashAccountId,
      ...cashEntryPatch(
        actor.uid,
        revision,
        next.status as CashEntryStatus,
        plan.accountMovementId,
      ),
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (date !== before.date || loaded.data.transactionDate === undefined) {
      patch.transactionDate = transactionInstant(date);
    }
    for (const field of [
      "incomeType",
      "expenseType",
      "paymentMethod",
      "supplier",
      "costCenter",
    ] as const) {
      patch[field] = next[field] ?? FieldValue.delete();
    }
    if (loaded.data.profileType === undefined) {
      patch.profileType = loaded.profileType;
    }
    if (loaded.data.displaySnapshots !== undefined) {
      for (const field of changedFields) {
        const snapshot = SNAPSHOT_BY_FIELD[field];
        if (snapshot) {
          patch[`displaySnapshots.${snapshot}`] = FieldValue.delete();
        }
      }
    }
    transaction.update(loaded.entryRef, patch);
    appendCashMutationEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "cash_entry.updated",
      actorId: actor.uid,
      actorRole: loaded.role,
      profileType: loaded.profileType,
      transactionId: payload.transactionId,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      reason: payload.reason,
      changedFields,
      before: financialSnapshot(before),
      after: financialSnapshot(next),
      revision,
    });
    const result = {
      transactionId: payload.transactionId,
      changed: true,
      revision,
    };
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: UPDATE_CASH_TRANSACTION_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    faults.beforeCommit?.();
    return {...result, replayed: false};
  });

const replayConfirm = (
  stored: Record<string, unknown>,
): ConfirmCashTransactionResult => {
  if (typeof stored.transactionId !== "string") {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return {
    transactionId: stored.transactionId,
    replayed: true,
    revision: Number(stored.revision ?? 0),
  };
};

/**
 * Confirmação de lançamento pendente (P3-F, D-29): pendente → confirmado.
 *
 * Grava a liquidação — data efetiva (até hoje, já garantido pelo contrato),
 * valor liquidado e, em despesa, a forma de pagamento usada — e mantém o
 * vencimento (`dueDate`). A partir daqui o lançamento move o caixa realizado
 * no mês da data efetiva (`cashPeriodDeltaFor`). Não consome quota: a
 * unidade foi consumida na criação (D-40).
 *
 * Já confirmado é recusado (nunca uma segunda liquidação); anulado também.
 * Confirmação e anulação concorrentes se excluem pela versão lida
 * (`expectedUpdatedAt`): só uma vence, a outra recebe conflito.
 */
export const executeConfirmCashTransaction = async (
  actor: WorkspaceActor,
  payload: ConfirmCashTransactionPayload,
  requestId: string,
  faults: CashMutationFaults = {},
): Promise<ConfirmCashTransactionResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadForMutation(
      transaction,
      actor,
      payload,
      CONFIRM_CASH_TRANSACTION_OPERATION,
      "cash_entry.confirmed",
    );
    if ("replay" in outcome) return replayConfirm(outcome.replay);
    const loaded = outcome.loaded;
    if (loaded.eligibility.status !== "pending") {
      throw new ApplicationError(
        "domain_precondition_failed",
        ALREADY_CONFIRMED_MESSAGE,
        {transition: "confirmed_to_confirmed"},
      );
    }
    if (
      loaded.eligibility.type === "receita" &&
      payload.paymentMethod !== undefined
    ) {
      throw new ApplicationError(
        "invalid_payload",
        RECEIPT_PAYMENT_METHOD_MESSAGE,
      );
    }
    // Conta da liquidação (D-30): a informada ou a registrada no pendente.
    const accountId = payload.cashAccountId ?? loaded.eligibility.cashAccountId;
    const accounts = await readPostingAccounts(
      transaction, actor.workspaceId, [accountId]);

    const rateLimit = await reserveRateLimit(
      transaction,
      actor.workspaceId,
      actor.uid,
      CASH_ENTRY_MUTATION_RATE_LIMIT,
    );

    const before = currentValues(loaded.data, loaded.eligibility);
    const dueDate = loaded.eligibility.dueDate ?? loaded.eligibility.date;
    const after: StateValues = {
      ...before,
      status: "confirmed",
      amountCents: payload.amountCents,
      date: payload.date,
      dueDate,
      paymentMethod: payload.paymentMethod ?? before.paymentMethod,
      cashAccountId: accountId,
    };
    const changedFields = STATE_FIELDS.filter(
      (field) => before[field] !== after[field],
    );
    const revision = loaded.eligibility.revision + 1;
    const apply = applyMovementFor(payload.transactionId, revision, after);
    // Recusa conta arquivada antes de qualquer outra escrita.
    postAccountMovements(transaction, accounts, [apply], {
      workspaceId: actor.workspaceId,
      actorUid: actor.uid,
      operation: CONFIRM_CASH_TRANSACTION_OPERATION,
      requestId,
    });
    const patch: admin.firestore.UpdateData<admin.firestore.DocumentData> = {
      isPaid: true,
      date: payload.date,
      transactionDate: transactionInstant(payload.date),
      dueDate,
      valueCents: payload.amountCents,
      value: payload.amountCents / 100,
      ...(payload.paymentMethod === undefined ?
        {} :
        {paymentMethod: payload.paymentMethod}),
      cashAccountId: accountId,
      ...cashEntryPatch(actor.uid, revision, "confirmed", apply.id,
        true),
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (loaded.data.profileType === undefined) {
      patch.profileType = loaded.profileType;
    }
    if (
      loaded.data.displaySnapshots !== undefined &&
      changedFields.includes("paymentMethod")
    ) {
      patch["displaySnapshots.paymentMethodSnapshot"] = FieldValue.delete();
    }
    transaction.update(loaded.entryRef, patch);
    appendCashMutationEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "cash_entry.confirmed",
      actorId: actor.uid,
      actorRole: loaded.role,
      profileType: loaded.profileType,
      transactionId: payload.transactionId,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      reason: null,
      changedFields,
      before: financialSnapshot(before),
      after: financialSnapshot(after),
      revision,
    });
    const result = {transactionId: payload.transactionId, revision};
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: CONFIRM_CASH_TRANSACTION_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    faults.beforeCommit?.();
    return {...result, replayed: false};
  });

export const executeVoidCashTransaction = async (
  actor: WorkspaceActor,
  payload: VoidCashTransactionPayload,
  requestId: string,
  faults: CashMutationFaults = {},
): Promise<VoidCashTransactionResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadForMutation(
      transaction,
      actor,
      payload,
      VOID_CASH_TRANSACTION_OPERATION,
      "cash_entry.voided",
    );
    if ("replay" in outcome) {
      const stored = outcome.replay;
      if (typeof stored.transactionId !== "string") {
        throw new ApplicationError("internal", INTERNAL_MESSAGE);
      }
      return {
        transactionId: stored.transactionId,
        replayed: true,
        revision: Number(stored.revision ?? 0),
      };
    }
    const loaded = outcome.loaded;
    const revision = loaded.eligibility.revision + 1;
    // Confirmado com conta: o movimento em vigor é compensado (D-30).
    const active = loaded.eligibility.status === "confirmed" ?
      await readActiveEntryMovement(transaction, actor.workspaceId,
        payload.transactionId, loaded.eligibility) :
      null;
    const accounts = active ?
      await readPostingAccounts(transaction, actor.workspaceId,
        [active.accountId]) :
      new Map();

    const rateLimit = await reserveRateLimit(
      transaction,
      actor.workspaceId,
      actor.uid,
      CASH_ENTRY_MUTATION_RATE_LIMIT,
    );

    if (active) {
      postAccountMovements(transaction, accounts, [reversalOfMovement(active,
        cashEntryMovementIdFor(payload.transactionId, "reverse", revision),
        cashEntryFactId(payload.transactionId, revision))], {
        workspaceId: actor.workspaceId,
        actorUid: actor.uid,
        operation: VOID_CASH_TRANSACTION_OPERATION,
        requestId,
      });
    }
    // Baixa lógica: o documento permanece, com quem anulou, quando e por quê.
    // O gatilho retira o efeito do caixa (`cashPeriodDeltaFor` zera anulados).
    transaction.update(loaded.entryRef, {
      voidedAt: FieldValue.serverTimestamp(),
      voidedBy: actor.uid,
      voidReason: payload.reason,
      ...cashEntryPatch(actor.uid, revision, "voided",
        active ? null : undefined),
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const before = financialSnapshot(
      currentValues(loaded.data, loaded.eligibility),
    );
    appendCashMutationEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "cash_entry.voided",
      actorId: actor.uid,
      actorRole: loaded.role,
      profileType: loaded.profileType,
      transactionId: payload.transactionId,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      reason: payload.reason,
      changedFields: ["voidedAt"],
      before,
      after: null,
      revision,
    });
    const result = {transactionId: payload.transactionId, revision};
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: VOID_CASH_TRANSACTION_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    faults.beforeCommit?.();
    return {...result, replayed: false};
  });
