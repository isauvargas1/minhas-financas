import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {
  postAccountMovements,
  readPostedMovement,
  readPostingAccounts,
  reversalOfMovement,
} from "../accounts/ledger";
import {loanAccountMovementIdFor} from "../accounts/model";
import {compareCommitTimes} from "../cash/periods";
import {parseIsoInstant} from "../shared/commitTime";
import {saoPauloDayKey} from "../shared/dateKeys";
import {ApplicationError} from "../shared/errors";
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
  PJ_ONLY_LOAN_FIELDS,
  type CancelLoanPayload,
  type CreateLoanPayload,
  type CreateLoanResult,
  type LoanMutationResult,
  type RegisterLoanPaymentPayload,
  type ReverseLoanMovementPayload,
  type UpdateLoanMetadataPayload,
} from "./contracts";
import {
  LOAN_EVENTS_COLLECTION,
  LOAN_SCHEMA_VERSION,
  appendLoanEvent,
  disbursementMovementIdFor,
  financialSnapshot,
  loanCashEntryFor,
  loanCashMirrorDocument,
  loanCashTransactionIdFor,
  loanIdFor,
  loanIntentId,
  loanMovementAccountCents,
  loanMovementDocument,
  loanMovementsRef,
  loansRef,
  paymentMovementIdFor,
  readAuthoritativeLoan,
  readAuthoritativeMovement,
  reversalMovementIdFor,
  type AuthoritativeLoan,
  type AuthoritativeMovement,
  type LoanEventOperation,
  type LoanFinancialState,
} from "./model";
import {
  LoanScheduleError,
  buildLoanSchedule,
  deriveLoanStatus,
} from "./schedule";

/**
 * Operações autoritativas de empréstimos (D-13, P3-G).
 *
 * Cada operação é uma transação do Firestore que faz tudo ou nada:
 *
 * 1. relê a autorização (conta ativa, membership ativo, papel, workspace
 *    ativo) — a pré-checagem do kernel é só filtro;
 * 2. reserva a chave de idempotência do ator; replay devolve o resultado
 *    salvo sem escrita;
 * 3. procura a âncora durável da intenção: na criação, o próprio contrato no
 *    ID `(workspace, ator, chave)`; nas mutações, o evento da intenção em
 *    `loan_events` de qualquer workspace (consulta de grupo, `limit(1)`). A
 *    mesma intenção depois da expiração da chave é replay; a mesma chave com
 *    outro conteúdo, contrato ou workspace é conflito;
 * 4. lê o contrato e exige o schema autoritativo (fora dele: recusa), a
 *    titularidade (`member` só no que criou; `createdBy` gravado pelo
 *    backend) e a versão lida pelo cliente (`expectedUpdatedAt`);
 * 5. aplica as regras do domínio sobre o estado relido, reserva o limite
 *    operacional e só então escreve: contrato, movimento, espelho de caixa,
 *    evento de auditoria, idempotência e limite.
 *
 * O espelho de caixa nasce no mesmo commit do movimento, com ID derivado do
 * movimento e a marca backend-only `loanEntry`. Nada é apagado: estorno e
 * cancelamento são movimentos compensatórios com vínculo `reversalOf` /
 * `reversedBy`. O espelho não consome a quota manual (D-40).
 *
 * Metadados sem alteração efetiva são recusados sem gravar (P3-H): toda
 * operação aceita deixa um evento em `loan_events`, que é a âncora durável da
 * intenção depois que o recibo temporário da chave expira.
 */
export const CREATE_LOAN_OPERATION = "createLoan";
export const REGISTER_LOAN_PAYMENT_OPERATION = "registerLoanPayment";
export const REVERSE_LOAN_MOVEMENT_OPERATION = "reverseLoanMovement";
export const CANCEL_LOAN_OPERATION = "cancelLoan";
export const UPDATE_LOAN_METADATA_OPERATION = "updateLoanMetadata";

/** Viewer só lê. `member` cria e administra só o que criou. */
export const LOAN_ROLES: readonly WorkspaceRole[] =
  ["owner", "admin", "member"];

/**
 * Limite operacional comum às cinco operações: 60 a cada 10 minutos por ator
 * e workspace. Não é quota comercial (o catálogo v1 não define quota de
 * empréstimos). Replay, recusa e falha antes do commit não consomem.
 */
export const LOAN_MUTATION_RATE_LIMIT: RateLimitPolicy = {
  operation: "loanMutation",
  limit: 60,
  windowSeconds: 10 * 60,
};

export const LOAN_IDEMPOTENCY_CONFLICT_MESSAGE =
  "Esta chave de idempotência já foi usada com outros dados.";
export const LOAN_CONFLICT_MESSAGE =
  "Este empréstimo foi alterado por outra operação depois que você o abriu. " +
  "Atualize e tente novamente.";
export const LOAN_NOT_FOUND_MESSAGE = "Empréstimo não encontrado.";
export const INCONSISTENT_LOAN_MESSAGE =
  "Este empréstimo tem dados inconsistentes e não pode ser alterado.";
export const MEMBER_LOAN_OWNERSHIP_MESSAGE =
  "Membros só podem administrar os empréstimos que registraram.";
export const LOAN_CANCELLED_MESSAGE =
  "Empréstimo cancelado não recebe novas operações.";
export const LOAN_ALREADY_CANCELLED_MESSAGE =
  "Este empréstimo já está cancelado.";
export const LOAN_ALREADY_PAID_MESSAGE =
  "Este empréstimo já está quitado: não há principal a liquidar.";
export const PRINCIPAL_ABOVE_BALANCE_MESSAGE =
  "O principal informado é maior que o saldo do empréstimo.";
export const PAYMENT_BEFORE_START_MESSAGE =
  "Data do pagamento: não pode ser anterior à contratação.";
export const MOVEMENT_NOT_FOUND_MESSAGE =
  "Movimento não encontrado neste empréstimo.";
export const MOVEMENT_NOT_REVERSIBLE_MESSAGE =
  "Só pagamentos e recebimentos podem ser estornados. Para desfazer a " +
  "contratação, cancele o empréstimo.";
export const MOVEMENT_ALREADY_REVERSED_MESSAGE =
  "Este movimento já foi estornado.";
export const CANCEL_WITH_PAYMENTS_MESSAGE =
  "Este empréstimo tem pagamentos registrados. Estorne-os antes de " +
  "cancelar o contrato.";
export const LOAN_METADATA_UNCHANGED_MESSAGE =
  "Nenhum dado foi alterado: os valores informados já são os atuais.";
export const PJ_ONLY_LOAN_FIELDS_MESSAGE =
  "Tipo da contraparte, CNPJ/CPF, classificação e centro de custo só podem " +
  "ser informados em espaço PJ.";
const LOAN_INTERNAL_MESSAGE =
  "Não foi possível concluir a operação do empréstimo. Tente novamente.";

const db = () => admin.firestore();

/** Relógio e ponto de falha injetáveis, só para os testes. */
export interface LoanOperationOptions {
  now?: () => number;
  /** Com todas as escritas enfileiradas, antes do commit. */
  beforeCommit?: () => void;
}

const todayOf = (options: LoanOperationOptions): string =>
  saoPauloDayKey(new Date((options.now ?? Date.now)()));

const profileTypeOf = (workspace: admin.firestore.DocumentData): "PF" | "PJ" =>
  workspace.type === "PJ" ? "PJ" : "PF";

const replayResult = <T extends object>(
  stored: Record<string, unknown>,
): T & {replayed: true} => {
  if (typeof stored.loanId !== "string") {
    throw new ApplicationError("internal", LOAN_INTERNAL_MESSAGE);
  }
  return {...(stored as T), replayed: true};
};

// ---------------------------------------------------------------- criação

export const executeCreateLoan = async (
  actor: WorkspaceActor,
  payload: CreateLoanPayload,
  requestId: string,
  options: LoanOperationOptions = {},
): Promise<CreateLoanResult> =>
  db().runTransaction(async (transaction) => {
    const {workspace, role} = await reassertWorkspaceActor(
      transaction,
      actor,
      LOAN_ROLES,
    );
    const profileType = profileTypeOf(workspace);
    if (
      profileType !== "PJ" &&
      PJ_ONLY_LOAN_FIELDS.some((field) => payload[field] !== undefined)
    ) {
      throw new ApplicationError("invalid_payload",
        PJ_ONLY_LOAN_FIELDS_MESSAGE);
    }

    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: CREATE_LOAN_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (reservation.replay) {
      return replayResult<CreateLoanResult>(reservation.replay);
    }

    const loanId = loanIdFor(
      actor.workspaceId,
      actor.uid,
      payload.idempotencyKey,
    );
    const loanRef = loansRef(actor.workspaceId).doc(loanId);
    const existing = await transaction.get(loanRef);
    if (existing.exists) {
      // Chave expirada, contrato preservado: a âncora durável decide.
      if (
        existing.get("schemaVersion") === LOAN_SCHEMA_VERSION &&
        existing.get("requestHash") === reservation.requestHash &&
        existing.get("createdBy") === actor.uid
      ) {
        return {
          loanId,
          movementId: String(existing.get("disbursementMovementId")),
          cashTransactionId: String(existing.get("disbursementTransactionId")),
          replayed: true,
        };
      }
      throw new ApplicationError(
        "idempotency_conflict",
        LOAN_IDEMPOTENCY_CONFLICT_MESSAGE,
      );
    }

    let schedule;
    try {
      schedule = buildLoanSchedule({
        principalCents: payload.principalCents,
        installments: payload.installments,
        firstDueDate: payload.firstDueDate,
        interest: payload.interest,
      });
    } catch (error) {
      if (error instanceof LoanScheduleError) {
        throw new ApplicationError(
          "invalid_payload",
          `Cronograma: ${error.message}`,
        );
      }
      throw error;
    }
    // Conta do principal (D-30), relida no workspace autorizado.
    const accounts = await readPostingAccounts(
      transaction, actor.workspaceId, [payload.cashAccountId]);
    const rateLimit = await reserveRateLimit(
      transaction,
      actor.workspaceId,
      actor.uid,
      LOAN_MUTATION_RATE_LIMIT,
    );

    const derived = deriveLoanStatus({
      cancelled: false,
      balanceCents: payload.principalCents,
      totalPrincipalSettledCents: 0,
      schedule: schedule.installments,
      today: todayOf(options),
    });
    const movementId = disbursementMovementIdFor(loanId);
    const cashTransactionId = loanCashTransactionIdFor(movementId);
    const accountMovementId = loanAccountMovementIdFor(movementId);
    // Recusa conta arquivada antes de qualquer outra escrita.
    postAccountMovements(transaction, accounts, [{
      id: accountMovementId,
      accountId: payload.cashAccountId,
      kind: "loan",
      amountCents: loanMovementAccountCents({
        loanId,
        movementId,
        loanType: payload.type,
        kind: "disbursement",
        reversalOf: null,
        principalCents: payload.principalCents,
        interestCents: 0,
      }),
      effectiveDate: payload.startDate,
      sourceDomain: "loan",
      sourceId: loanId,
      sourceFactId: movementId,
      reversalOf: null,
    }], {
      workspaceId: actor.workspaceId,
      actorUid: actor.uid,
      operation: CREATE_LOAN_OPERATION,
      requestId,
    });
    const state: LoanFinancialState = {
      principalCents: payload.principalCents,
      balanceCents: payload.principalCents,
      totalPrincipalSettledCents: 0,
      totalInterestSettledCents: 0,
      activePaymentCount: 0,
      status: derived.status,
    };

    transaction.create(loanRef, {
      id: loanId,
      schemaVersion: LOAN_SCHEMA_VERSION,
      workspaceId: actor.workspaceId,
      profileType,
      type: payload.type,
      personName: payload.personName,
      ...(payload.personContact === undefined ?
        {} : {personContact: payload.personContact}),
      ...(payload.description === undefined ?
        {} : {description: payload.description}),
      ...Object.fromEntries(PJ_ONLY_LOAN_FIELDS
        .filter((field) => payload[field] !== undefined)
        .map((field) => [field, payload[field]])),
      currency: "BRL",
      ...state,
      interest: payload.interest,
      startDate: payload.startDate,
      firstDueDate: payload.firstDueDate,
      installmentsCount: payload.installments,
      schedule: schedule.installments,
      scheduledInterestCents: schedule.totalInterestCents,
      maturityDate: schedule.maturityDate,
      overdueFrom: derived.overdueFrom,
      disbursementMovementId: movementId,
      disbursementTransactionId: cashTransactionId,
      requestHash: reservation.requestHash,
      revision: 1,
      createdBy: actor.uid,
      updatedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(
      loanMovementsRef(actor.workspaceId).doc(movementId),
      loanMovementDocument({
        id: movementId,
        workspaceId: actor.workspaceId,
        loanId,
        loanType: payload.type,
        kind: "disbursement",
        principalCents: payload.principalCents,
        interestCents: 0,
        date: payload.startDate,
        cashTransactionId,
        cashAccountId: payload.cashAccountId,
        accountMovementId,
        reversalOf: null,
        reason: null,
        actorUid: actor.uid,
        intentId: loanIntentId(actor.uid, payload.idempotencyKey),
        requestHash: reservation.requestHash,
      }),
    );
    transaction.create(
      workspaceRef(actor.workspaceId).collection("transactions")
        .doc(cashTransactionId),
      loanCashMirrorDocument({
        workspaceId: actor.workspaceId,
        profileType,
        actorUid: actor.uid,
        date: payload.startDate,
        cashAccountId: payload.cashAccountId,
        entry: loanCashEntryFor({
          loanId,
          movementId,
          loanType: payload.type,
          kind: "disbursement",
          reversal: false,
          reversalOf: null,
          principalCents: payload.principalCents,
          interestCents: 0,
        }),
      }),
    );
    appendLoanEvent(transaction, {
      workspaceId: actor.workspaceId,
      loanId,
      operation: "loan.created",
      targetKey: loanId,
      actorId: actor.uid,
      actorRole: role,
      profileType,
      intentId: loanIntentId(actor.uid, payload.idempotencyKey),
      requestHash: reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      movementId,
      before: null,
      after: financialSnapshot(state),
      reason: null,
      revision: 1,
    });
    const result = {loanId, movementId, cashTransactionId};
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: CREATE_LOAN_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ---------------------------------------------------------------- mutações

interface MutationPayload {
  idempotencyKey: string;
  loanId: string;
  expectedUpdatedAt: string;
  correlationId?: string;
}

interface LoadedLoan {
  role: WorkspaceRole;
  profileType: "PF" | "PJ";
  reservation: ActorIdempotencyReservation;
  intentId: string;
  loanRef: admin.firestore.DocumentReference;
  data: admin.firestore.DocumentData;
  loan: AuthoritativeLoan;
}

type LoadOutcome = {replay: LoanMutationResult} | {loaded: LoadedLoan};

const assertLoanVersion = (current: Timestamp, expected: string): void => {
  if (compareCommitTimes(current, parseIsoInstant(expected)) !== 0) {
    throw new ApplicationError("concurrent_update", LOAN_CONFLICT_MESSAGE);
  }
};

const loadLoanForMutation = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  payload: MutationPayload,
  operation: string,
  eventOperation: LoanEventOperation,
): Promise<LoadOutcome> => {
  const {workspace, role} = await reassertWorkspaceActor(
    transaction,
    actor,
    LOAN_ROLES,
  );
  const reservation = await reserveActorIdempotency(transaction, {
    uid: actor.uid,
    operation,
    idempotencyKey: payload.idempotencyKey,
    payload: payload as unknown as Record<string, unknown>,
  });
  if (reservation.replay) {
    return {replay: replayResult<LoanMutationResult>(reservation.replay)};
  }

  const intentId = loanIntentId(actor.uid, payload.idempotencyKey);
  const loanRef = loansRef(actor.workspaceId).doc(payload.loanId);
  const snapshot = await transaction.get(loanRef);
  // Âncora da intenção em qualquer workspace: depois da P3-G, cada
  // (intenção, operação) tem no máximo um evento; índice de grupo
  // `loan_events(intentId, operation)`.
  const anchors = await transaction.get(
    db().collectionGroup(LOAN_EVENTS_COLLECTION)
      .where("intentId", "==", intentId)
      .where("operation", "==", eventOperation)
      .limit(1),
  );
  const event = anchors.docs[0];
  if (event) {
    if (
      event.get("requestHash") !== reservation.requestHash ||
      event.get("actorId") !== actor.uid ||
      event.get("workspaceId") !== actor.workspaceId ||
      event.get("loanId") !== payload.loanId
    ) {
      throw new ApplicationError(
        "idempotency_conflict",
        LOAN_IDEMPOTENCY_CONFLICT_MESSAGE,
      );
    }
    const movementId = event.get("movementId");
    return {
      replay: {
        loanId: payload.loanId,
        ...(typeof movementId === "string" ? {movementId} : {}),
        // Só a alteração efetiva de metadados tem evento (a sem efeito é
        // recusada): a âncora encontrada prova `changed: true`.
        ...(eventOperation === "loan.metadata_updated" ? {changed: true} : {}),
        replayed: true,
      },
    };
  }

  if (!snapshot.exists) {
    throw new ApplicationError("not_found", LOAN_NOT_FOUND_MESSAGE);
  }
  const data = snapshot.data() ?? {};
  const loan = readAuthoritativeLoan(loanRef.id, data, actor.workspaceId);
  if (!loan) {
    // Fora do schema autoritativo (sem a marca, outro workspace ou invariante
    // quebrada): falha fechada, nunca "consertado" pela operação.
    throw new ApplicationError("domain_precondition_failed",
      INCONSISTENT_LOAN_MESSAGE, {ineligible: "inconsistent"});
  }
  if (role === "member" && loan.createdBy !== actor.uid) {
    throw new ApplicationError(
      "workspace_role_denied",
      MEMBER_LOAN_OWNERSHIP_MESSAGE,
    );
  }
  assertLoanVersion(loan.updatedAt, payload.expectedUpdatedAt);
  return {
    loaded: {
      role,
      profileType: profileTypeOf(workspace),
      reservation,
      intentId,
      loanRef,
      data,
      loan,
    },
  };
};

const stateOf = (loan: AuthoritativeLoan): LoanFinancialState => ({
  principalCents: loan.principalCents,
  balanceCents: loan.balanceCents,
  totalPrincipalSettledCents: loan.totalPrincipalSettledCents,
  totalInterestSettledCents: loan.totalInterestSettledCents,
  activePaymentCount: loan.activePaymentCount,
  status: loan.status,
});

const assertConsistentState = (state: LoanFinancialState): void => {
  if (
    state.balanceCents < 0 ||
    state.totalPrincipalSettledCents < 0 ||
    state.totalInterestSettledCents < 0 ||
    state.activePaymentCount < 0 ||
    state.balanceCents + state.totalPrincipalSettledCents !==
      state.principalCents
  ) {
    throw new ApplicationError("internal", INCONSISTENT_LOAN_MESSAGE);
  }
};

const loanStatePatch = (
  state: LoanFinancialState,
  overdueFrom: string | null,
  actorUid: string,
  revision: number,
): admin.firestore.DocumentData => ({
  balanceCents: state.balanceCents,
  totalPrincipalSettledCents: state.totalPrincipalSettledCents,
  totalInterestSettledCents: state.totalInterestSettledCents,
  activePaymentCount: state.activePaymentCount,
  status: state.status,
  overdueFrom,
  revision,
  updatedBy: actorUid,
  updatedAt: FieldValue.serverTimestamp(),
});

const reserveLoanRateLimit = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
) => reserveRateLimit(
  transaction,
  actor.workspaceId,
  actor.uid,
  LOAN_MUTATION_RATE_LIMIT,
);

// ------------------------------------------------------------ liquidação

/**
 * Movimento de conta do fato original, relido e conferido (D-30): mesma
 * conta, mesmo empréstimo e o mesmo efeito com sinal que o fato produz.
 * Divergência é falha fechada — compensar outro valor deixaria o saldo
 * errado.
 */
const readOriginalAccountMovement = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  loan: AuthoritativeLoan,
  movement: AuthoritativeMovement,
) => {
  const accountMovement = await readPostedMovement(transaction, workspaceId,
    movement.accountMovementId,
    {accountId: movement.cashAccountId, sourceId: loan.id});
  const expected = loanMovementAccountCents({
    loanId: loan.id,
    movementId: movement.id,
    loanType: loan.type,
    kind: movement.kind,
    reversalOf: null,
    principalCents: movement.principalCents,
    interestCents: movement.interestCents,
  });
  if (
    accountMovement.amountCents !== expected ||
    accountMovement.sourceFactId !== movement.id
  ) {
    throw new ApplicationError("internal", INCONSISTENT_LOAN_MESSAGE);
  }
  return accountMovement;
};

export const executeRegisterLoanPayment = async (
  actor: WorkspaceActor,
  payload: RegisterLoanPaymentPayload,
  requestId: string,
  options: LoanOperationOptions = {},
): Promise<LoanMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadLoanForMutation(
      transaction, actor, payload, REGISTER_LOAN_PAYMENT_OPERATION,
      "loan.payment_registered",
    );
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {loan} = loaded;

    if (loan.status === "cancelled") {
      throw new ApplicationError("domain_precondition_failed",
        LOAN_CANCELLED_MESSAGE);
    }
    if (payload.principalCents > 0 && loan.balanceCents === 0) {
      throw new ApplicationError("domain_precondition_failed",
        LOAN_ALREADY_PAID_MESSAGE);
    }
    if (payload.principalCents > loan.balanceCents) {
      throw new ApplicationError("domain_precondition_failed",
        PRINCIPAL_ABOVE_BALANCE_MESSAGE);
    }
    if (payload.date < loan.startDate) {
      throw new ApplicationError("domain_precondition_failed",
        PAYMENT_BEFORE_START_MESSAGE);
    }
    // Conta da liquidação (D-30), relida no workspace autorizado.
    const accounts = await readPostingAccounts(
      transaction, actor.workspaceId, [payload.cashAccountId]);
    const rateLimit = await reserveLoanRateLimit(transaction, actor);

    const before = stateOf(loan);
    const next: LoanFinancialState = {
      ...before,
      balanceCents: before.balanceCents - payload.principalCents,
      totalPrincipalSettledCents:
        before.totalPrincipalSettledCents + payload.principalCents,
      totalInterestSettledCents:
        before.totalInterestSettledCents + payload.interestCents,
      activePaymentCount: before.activePaymentCount + 1,
    };
    const derived = deriveLoanStatus({
      cancelled: false,
      balanceCents: next.balanceCents,
      totalPrincipalSettledCents: next.totalPrincipalSettledCents,
      schedule: loan.schedule,
      today: todayOf(options),
    });
    next.status = derived.status;
    assertConsistentState(next);

    const movementId = paymentMovementIdFor(loan.id, loaded.intentId);
    const cashTransactionId = loanCashTransactionIdFor(movementId);
    const accountMovementId = loanAccountMovementIdFor(movementId);
    const revision = loan.revision + 1;
    postAccountMovements(transaction, accounts, [{
      id: accountMovementId,
      accountId: payload.cashAccountId,
      kind: "loan",
      amountCents: loanMovementAccountCents({
        loanId: loan.id,
        movementId,
        loanType: loan.type,
        kind: "payment",
        reversalOf: null,
        principalCents: payload.principalCents,
        interestCents: payload.interestCents,
      }),
      effectiveDate: payload.date,
      sourceDomain: "loan",
      sourceId: loan.id,
      sourceFactId: movementId,
      reversalOf: null,
    }], {
      workspaceId: actor.workspaceId,
      actorUid: actor.uid,
      operation: REGISTER_LOAN_PAYMENT_OPERATION,
      requestId,
    });
    transaction.create(
      loanMovementsRef(actor.workspaceId).doc(movementId),
      loanMovementDocument({
        id: movementId,
        workspaceId: actor.workspaceId,
        loanId: loan.id,
        loanType: loan.type,
        kind: "payment",
        principalCents: payload.principalCents,
        interestCents: payload.interestCents,
        date: payload.date,
        cashTransactionId,
        cashAccountId: payload.cashAccountId,
        accountMovementId,
        reversalOf: null,
        reason: null,
        actorUid: actor.uid,
        intentId: loaded.intentId,
        requestHash: loaded.reservation.requestHash,
      }),
    );
    transaction.create(
      workspaceRef(actor.workspaceId).collection("transactions")
        .doc(cashTransactionId),
      loanCashMirrorDocument({
        workspaceId: actor.workspaceId,
        profileType: loan.profileType,
        actorUid: actor.uid,
        date: payload.date,
        cashAccountId: payload.cashAccountId,
        entry: loanCashEntryFor({
          loanId: loan.id,
          movementId,
          loanType: loan.type,
          kind: "payment",
          reversal: false,
          reversalOf: null,
          principalCents: payload.principalCents,
          interestCents: payload.interestCents,
        }),
      }),
    );
    transaction.update(
      loaded.loanRef,
      loanStatePatch(next, derived.overdueFrom, actor.uid, revision),
    );
    appendLoanEvent(transaction, {
      workspaceId: actor.workspaceId,
      loanId: loan.id,
      operation: "loan.payment_registered",
      targetKey: movementId,
      actorId: actor.uid,
      actorRole: loaded.role,
      profileType: loan.profileType,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      movementId,
      before: financialSnapshot(before),
      after: financialSnapshot(next),
      reason: null,
      revision,
    });
    const result = {
      loanId: loan.id,
      movementId,
      cashTransactionId,
      status: next.status,
      balanceCents: next.balanceCents,
    };
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: REGISTER_LOAN_PAYMENT_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// --------------------------------------------------------------- estorno

export const executeReverseLoanMovement = async (
  actor: WorkspaceActor,
  payload: ReverseLoanMovementPayload,
  requestId: string,
  options: LoanOperationOptions = {},
): Promise<LoanMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadLoanForMutation(
      transaction, actor, payload, REVERSE_LOAN_MOVEMENT_OPERATION,
      "loan.movement_reversed",
    );
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {loan} = loaded;
    if (loan.status === "cancelled") {
      throw new ApplicationError("domain_precondition_failed",
        LOAN_CANCELLED_MESSAGE);
    }
    const movementRef = loanMovementsRef(actor.workspaceId)
      .doc(payload.movementId);
    const movement = readAuthoritativeMovement(
      movementRef.id,
      (await transaction.get(movementRef)).data(),
      actor.workspaceId,
      loan.id,
    );
    if (!movement) {
      throw new ApplicationError("not_found", MOVEMENT_NOT_FOUND_MESSAGE);
    }
    if (movement.kind !== "payment") {
      throw new ApplicationError("domain_precondition_failed",
        MOVEMENT_NOT_REVERSIBLE_MESSAGE);
    }
    if (movement.reversedBy !== null) {
      throw new ApplicationError("domain_precondition_failed",
        MOVEMENT_ALREADY_REVERSED_MESSAGE);
    }
    // A conta é a do movimento original (D-30); o cliente não a escolhe.
    const accountMovement = await readOriginalAccountMovement(
      transaction, actor.workspaceId, loan, movement);
    const accounts = await readPostingAccounts(
      transaction, actor.workspaceId, [movement.cashAccountId]);
    const rateLimit = await reserveLoanRateLimit(transaction, actor);

    const before = stateOf(loan);
    const next: LoanFinancialState = {
      ...before,
      balanceCents: before.balanceCents + movement.principalCents,
      totalPrincipalSettledCents:
        before.totalPrincipalSettledCents - movement.principalCents,
      totalInterestSettledCents:
        before.totalInterestSettledCents - movement.interestCents,
      activePaymentCount: before.activePaymentCount - 1,
    };
    const derived = deriveLoanStatus({
      cancelled: false,
      balanceCents: next.balanceCents,
      totalPrincipalSettledCents: next.totalPrincipalSettledCents,
      schedule: loan.schedule,
      today: todayOf(options),
    });
    next.status = derived.status;
    assertConsistentState(next);

    const reversalId = reversalMovementIdFor(movement.id);
    const cashTransactionId = loanCashTransactionIdFor(reversalId);
    const reversalAccountMovementId = loanAccountMovementIdFor(reversalId);
    const revision = loan.revision + 1;
    postAccountMovements(transaction, accounts, [reversalOfMovement(
      accountMovement, reversalAccountMovementId, reversalId)], {
      workspaceId: actor.workspaceId,
      actorUid: actor.uid,
      operation: REVERSE_LOAN_MOVEMENT_OPERATION,
      requestId,
    });
    transaction.create(
      loanMovementsRef(actor.workspaceId).doc(reversalId),
      loanMovementDocument({
        id: reversalId,
        workspaceId: actor.workspaceId,
        loanId: loan.id,
        loanType: loan.type,
        kind: "reversal",
        originalKind: "payment",
        principalCents: movement.principalCents,
        interestCents: movement.interestCents,
        // O estorno corrige o fato: mesmo dia civil do original, para que o
        // mês do original some zero.
        date: movement.date,
        cashTransactionId,
        cashAccountId: movement.cashAccountId,
        accountMovementId: reversalAccountMovementId,
        reversalOf: movement.id,
        reason: payload.reason,
        actorUid: actor.uid,
        intentId: loaded.intentId,
        requestHash: loaded.reservation.requestHash,
      }),
    );
    transaction.update(movementRef, {
      reversedBy: reversalId,
      reversedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(
      workspaceRef(actor.workspaceId).collection("transactions")
        .doc(cashTransactionId),
      loanCashMirrorDocument({
        workspaceId: actor.workspaceId,
        profileType: loan.profileType,
        actorUid: actor.uid,
        date: movement.date,
        cashAccountId: movement.cashAccountId,
        entry: loanCashEntryFor({
          loanId: loan.id,
          movementId: reversalId,
          loanType: loan.type,
          kind: "payment",
          reversal: true,
          reversalOf: movement.id,
          principalCents: movement.principalCents,
          interestCents: movement.interestCents,
        }),
      }),
    );
    transaction.update(
      loaded.loanRef,
      loanStatePatch(next, derived.overdueFrom, actor.uid, revision),
    );
    appendLoanEvent(transaction, {
      workspaceId: actor.workspaceId,
      loanId: loan.id,
      operation: "loan.movement_reversed",
      targetKey: reversalId,
      actorId: actor.uid,
      actorRole: loaded.role,
      profileType: loan.profileType,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      movementId: reversalId,
      before: financialSnapshot(before),
      after: financialSnapshot(next),
      reason: payload.reason,
      revision,
    });
    const result = {
      loanId: loan.id,
      movementId: reversalId,
      cashTransactionId,
      status: next.status,
      balanceCents: next.balanceCents,
    };
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: REVERSE_LOAN_MOVEMENT_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ---------------------------------------------------------- cancelamento

export const executeCancelLoan = async (
  actor: WorkspaceActor,
  payload: CancelLoanPayload,
  requestId: string,
  options: LoanOperationOptions = {},
): Promise<LoanMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadLoanForMutation(
      transaction, actor, payload, CANCEL_LOAN_OPERATION,
      "loan.cancelled",
    );
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {loan} = loaded;
    if (loan.status === "cancelled") {
      throw new ApplicationError("domain_precondition_failed",
        LOAN_ALREADY_CANCELLED_MESSAGE);
    }
    if (loan.activePaymentCount > 0) {
      throw new ApplicationError("domain_precondition_failed",
        CANCEL_WITH_PAYMENTS_MESSAGE);
    }
    const disbursementRef = loanMovementsRef(actor.workspaceId)
      .doc(loan.disbursementMovementId);
    const disbursement = readAuthoritativeMovement(
      disbursementRef.id,
      (await transaction.get(disbursementRef)).data(),
      actor.workspaceId,
      loan.id,
    );
    if (
      !disbursement ||
      disbursement.kind !== "disbursement" ||
      disbursement.reversedBy !== null ||
      disbursement.principalCents !== loan.principalCents
    ) {
      throw new ApplicationError("internal", INCONSISTENT_LOAN_MESSAGE);
    }
    // A conta é a da contratação (D-30); o cliente não a escolhe.
    const accountMovement = await readOriginalAccountMovement(
      transaction, actor.workspaceId, loan, disbursement);
    const accounts = await readPostingAccounts(
      transaction, actor.workspaceId, [disbursement.cashAccountId]);
    const rateLimit = await reserveLoanRateLimit(transaction, actor);

    const before = stateOf(loan);
    const next: LoanFinancialState = {...before, status: "cancelled"};
    const cancellationId = reversalMovementIdFor(disbursement.id);
    const cashTransactionId = loanCashTransactionIdFor(cancellationId);
    const cancellationAccountMovementId =
      loanAccountMovementIdFor(cancellationId);
    const revision = loan.revision + 1;
    postAccountMovements(transaction, accounts, [reversalOfMovement(
      accountMovement, cancellationAccountMovementId, cancellationId)], {
      workspaceId: actor.workspaceId,
      actorUid: actor.uid,
      operation: CANCEL_LOAN_OPERATION,
      requestId,
    });
    transaction.create(
      loanMovementsRef(actor.workspaceId).doc(cancellationId),
      loanMovementDocument({
        id: cancellationId,
        workspaceId: actor.workspaceId,
        loanId: loan.id,
        loanType: loan.type,
        kind: "reversal",
        originalKind: "disbursement",
        principalCents: disbursement.principalCents,
        interestCents: 0,
        date: disbursement.date,
        cashTransactionId,
        cashAccountId: disbursement.cashAccountId,
        accountMovementId: cancellationAccountMovementId,
        reversalOf: disbursement.id,
        reason: payload.reason,
        actorUid: actor.uid,
        intentId: loaded.intentId,
        requestHash: loaded.reservation.requestHash,
      }),
    );
    transaction.update(disbursementRef, {
      reversedBy: cancellationId,
      reversedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(
      workspaceRef(actor.workspaceId).collection("transactions")
        .doc(cashTransactionId),
      loanCashMirrorDocument({
        workspaceId: actor.workspaceId,
        profileType: loan.profileType,
        actorUid: actor.uid,
        date: disbursement.date,
        cashAccountId: disbursement.cashAccountId,
        entry: loanCashEntryFor({
          loanId: loan.id,
          movementId: cancellationId,
          loanType: loan.type,
          kind: "disbursement",
          reversal: true,
          reversalOf: disbursement.id,
          principalCents: disbursement.principalCents,
          interestCents: 0,
        }),
      }),
    );
    transaction.update(loaded.loanRef, {
      ...loanStatePatch(next, null, actor.uid, revision),
      cancellationMovementId: cancellationId,
      cancelledBy: actor.uid,
      cancelledAt: FieldValue.serverTimestamp(),
    });
    appendLoanEvent(transaction, {
      workspaceId: actor.workspaceId,
      loanId: loan.id,
      operation: "loan.cancelled",
      targetKey: cancellationId,
      actorId: actor.uid,
      actorRole: loaded.role,
      profileType: loan.profileType,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      movementId: cancellationId,
      before: financialSnapshot(before),
      after: financialSnapshot(next),
      reason: payload.reason,
      revision,
    });
    const result = {
      loanId: loan.id,
      movementId: cancellationId,
      cashTransactionId,
      status: "cancelled",
    };
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: CANCEL_LOAN_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ------------------------------------------------------------ metadados

export const executeUpdateLoanMetadata = async (
  actor: WorkspaceActor,
  payload: UpdateLoanMetadataPayload,
  requestId: string,
  options: LoanOperationOptions = {},
): Promise<LoanMutationResult> =>
  db().runTransaction(async (transaction) => {
    // Não grava caixa: a janela sem escritas do ledger não se aplica.
    const outcome = await loadLoanForMutation(
      transaction, actor, payload, UPDATE_LOAN_METADATA_OPERATION,
      "loan.metadata_updated",
    );
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {loan, data} = loaded;
    const changes = payload.changes as Record<string, unknown>;
    if (
      loan.profileType !== "PJ" &&
      PJ_ONLY_LOAN_FIELDS.some((field) => changes[field] !== undefined)
    ) {
      throw new ApplicationError("invalid_payload",
        PJ_ONLY_LOAN_FIELDS_MESSAGE);
    }

    const patch: admin.firestore.DocumentData = {};
    const changedFields: string[] = [];
    for (const [field, value] of Object.entries(changes)) {
      if (value === undefined) continue;
      if (value === null) {
        if (data[field] !== undefined) {
          patch[field] = FieldValue.delete();
          changedFields.push(field);
        }
      } else if (data[field] !== value) {
        patch[field] = value;
        changedFields.push(field);
      }
    }
    changedFields.sort();
    if (changedFields.length === 0) {
      // Sem efeito, não há intenção a registrar: recusa sem gravar nada (nem
      // recibo nem evento). Toda alteração aceita tem a âncora durável do seu
      // `loan_events`; um recibo temporário de "nada mudou" expiraria e
      // deixaria a mesma chave livre para outro contrato (P3-H).
      throw new ApplicationError("domain_precondition_failed",
        LOAN_METADATA_UNCHANGED_MESSAGE);
    }
    const rateLimit = await reserveLoanRateLimit(transaction, actor);
    const revision = loan.revision + 1;
    transaction.update(loaded.loanRef, {
      ...patch,
      revision,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendLoanEvent(transaction, {
      workspaceId: actor.workspaceId,
      loanId: loan.id,
      operation: "loan.metadata_updated",
      targetKey: loaded.intentId,
      actorId: actor.uid,
      actorRole: loaded.role,
      profileType: loan.profileType,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      movementId: null,
      // Metadados: só os nomes dos campos alterados, nunca os valores.
      before: null,
      after: null,
      changedFields,
      reason: null,
      revision,
    });
    const result = {loanId: loan.id, changed: true};
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: UPDATE_LOAN_METADATA_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });
