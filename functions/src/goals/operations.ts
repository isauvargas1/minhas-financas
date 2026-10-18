import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {INVESTMENT_COLLECTIONS} from "../investments/paths";
import {ApplicationError} from "../shared/errors";
import {expiresInDays, RETENTION_DAYS} from "../shared/retention";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import type {
  ArchiveGoalPayload,
  CreateGoalPayload,
  GoalDefinition,
  SetGoalStatusPayload,
  UpdateGoalManualProgressPayload,
  UpdateGoalPayload,
} from "./contracts";

type GoalOperation =
  | "createGoal"
  | "updateGoal"
  | "updateGoalManualProgress"
  | "setGoalStatus"
  | "archiveGoal";

interface IdempotencyReservation {
  ref: admin.firestore.DocumentReference;
  replay?: Record<string, unknown>;
  record?: Record<string, unknown>;
}

export const GOAL_STALE_MESSAGE =
  "A meta foi alterada desde que você a abriu. Recarregue e tente de novo.";
export const GOAL_ARCHIVED_MESSAGE =
  "Esta meta está arquivada e não pode ser alterada.";
export const GOAL_LINKED_ARCHIVE_MESSAGE =
  "Esta meta tem investimentos vinculados. Desvincule ou transfira os " +
  "investimentos para outra meta antes de arquivá-la.";
export const GOAL_LINKED_SOURCE_MESSAGE =
  "Esta meta tem investimentos vinculados. Desvincule ou transfira os " +
  "investimentos antes de mudar a forma de medir o progresso.";
export const GOAL_NOT_MANUAL_MESSAGE =
  "O progresso desta meta é calculado automaticamente e não pode ser " +
  "informado à mão.";

const db = () => admin.firestore();
const workspacePath = (workspaceId: string) => `workspaces/${workspaceId}`;
const goalRef = (workspaceId: string, goalId: string) =>
  db().doc(`${workspacePath(workspaceId)}/goals/${goalId}`);

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
};

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/**
 * Conteúdo da **intenção**, para o `requestHash`. `correlationId` identifica
 * a tentativa, não a intenção: fica fora do hash, para que o reenvio da
 * mesma intenção (duplo clique, retry de rede) seja replay e não conflito
 * (INV-P1-004).
 */
const intentContent = (payload: unknown): unknown => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const {correlationId: _attempt, ...intent} =
    payload as Record<string, unknown>;
  return intent;
};

const reserveIdempotency = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  operation: GoalOperation,
  idempotencyKey: string,
  payload: unknown,
): Promise<IdempotencyReservation> => {
  const keyHash = sha256(`${actor.uid}:${idempotencyKey}`).slice(0, 32);
  const id = `${operation}_${keyHash}`;
  const ref = db().doc(
    `${workspacePath(actor.workspaceId)}/goal_idempotency_keys/${id}`,
  );
  const requestHash = sha256(stableStringify(intentContent(payload)));
  const snapshot = await transaction.get(ref);

  if (snapshot.exists) {
    const data = snapshot.data();
    if (data?.requestHash !== requestHash || data?.actorId !== actor.uid) {
      throw new ApplicationError(
        "idempotency_conflict",
        "Esta solicitação já foi usada com outros dados.",
      );
    }
    if (data?.status === "completed") {
      return {ref, replay: data.result as Record<string, unknown>};
    }
    throw new ApplicationError(
      "idempotency_conflict",
      "Esta solicitação já está em processamento.",
    );
  }

  return {
    ref,
    record: {
      workspaceId: actor.workspaceId,
      actorId: actor.uid,
      operation,
      requestHash,
      idempotencyKeyHash: sha256(idempotencyKey),
    },
  };
};

const completeIdempotency = (
  transaction: admin.firestore.Transaction,
  reservation: IdempotencyReservation,
  result: Record<string, unknown>,
) => {
  transaction.create(reservation.ref, {
    ...reservation.record,
    status: "completed",
    result,
    createdAt: FieldValue.serverTimestamp(),
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    // Marca de TTL (GOAL-14): a reserva só serve a retries; a trilha
    // `goal_audit_logs` e a meta, que são o fato, não expiram.
    expiresAt: expiresInDays(RETENTION_DAYS.idempotencyKeys),
  });
};

/**
 * Trilha append-only da meta. O ID é o da reserva de idempotência: um replay
 * não grava segunda linha. Guarda só o necessário (campos alterados, antes e
 * depois em centavos), sem copiar o documento inteiro.
 */
const writeAudit = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  operation: GoalOperation,
  idempotencyRef: admin.firestore.DocumentReference,
  targetId: string,
  details: Record<string, unknown>,
) => {
  const ref = db().doc(
    `${workspacePath(actor.workspaceId)}/goal_audit_logs/${idempotencyRef.id}`,
  );
  transaction.create(ref, {
    workspaceId: actor.workspaceId,
    actorId: actor.uid,
    actorRole: actor.role,
    operation,
    targetId,
    correlationId: idempotencyRef.id,
    details,
    timestamp: FieldValue.serverTimestamp(),
  });
};

const PRIORITY_RANK: Record<GoalDefinition["priority"], number> = {
  alta: 3,
  media: 2,
  baixa: 1,
};

/**
 * Campos de definição gerenciados pelo domínio. Na edição, todo campo desta
 * lista ausente da definição nova é apagado do documento — nenhum resto da
 * modalidade anterior sobrevive como fonte concorrente.
 */
const OPTIONAL_DEFINITION_FIELDS = [
  "description",
  "progressBasis",
  "businessType",
  "period",
  "costCenter",
  "targetAmountCents",
  "targetBasisPoints",
] as const;

/**
 * Campos publicados pelo domínio patrimonial na meta
 * (`updateGoalProjection`). Saindo de `investment`, todos saem do documento.
 */
const INVESTMENT_PROJECTION_FIELDS = [
  "investmentNetContributionCents",
  "investmentCurrentValueCents",
  "investmentProgressCents",
  "investmentProjectionVersion",
  "investmentCalculationVersion",
  "investmentProjectionDirty",
  "investmentUpdatedBy",
  "investmentUpdatedAt",
] as const;

const definitionFields = (
  goal: GoalDefinition,
): Record<string, unknown> => {
  const fields: Record<string, unknown> = {
    name: goal.name,
    category: goal.category,
    priority: goal.priority,
    priorityRank: PRIORITY_RANK[goal.priority],
    startDate: goal.startDate,
    deadline: goal.deadline,
    horizon: goal.horizon,
    progressSource: goal.progressSource,
    visual: goal.visual,
  };
  for (const key of OPTIONAL_DEFINITION_FIELDS) {
    if (goal[key] !== undefined) fields[key] = goal[key];
  }
  return fields;
};

/** Indicador empresarial, tipo de meta PJ e centro de custo: só em PJ. */
const assertWorkspaceFit = (
  goal: GoalDefinition,
  workspace: admin.firestore.DocumentData,
) => {
  const isPJ = workspace.type === "PJ";
  if (isPJ) return;
  if (
    goal.progressSource === "business_kpi" ||
    goal.businessType !== undefined ||
    goal.costCenter !== undefined
  ) {
    throw new ApplicationError(
      "invalid_payload",
      "Indicadores empresariais e centro de custo só existem em " +
        "workspace empresarial.",
    );
  }
};

const integerOrZero = (value: unknown): number =>
  Number.isSafeInteger(value) ? value as number : 0;

const investmentProgressFor = (
  basis: unknown,
  data: admin.firestore.DocumentData,
): number => basis === "current_value" ?
  integerOrZero(data.investmentCurrentValueCents) :
  integerOrZero(data.investmentNetContributionCents);

/**
 * Existe posição de investimento vinculada à meta? Consulta limitada a um
 * documento, dentro da transação que também lê e escreve a meta. Toda
 * operação patrimonial que muda o conjunto de posições da meta (vínculo,
 * desvínculo, troca, aporte com meta) lê a meta e a escreve
 * (`updateGoalProjection` com `linkChanged`), então ela e o arquivamento (ou
 * a troca de fonte) disputam o mesmo documento: não há estado final com meta
 * arquivada e vínculo aceito.
 */
const hasLinkedPositions = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  goalId: string,
): Promise<boolean> => {
  const snapshot = await transaction.get(
    db()
      .collection(
        `${workspacePath(workspaceId)}/${INVESTMENT_COLLECTIONS.positions}`,
      )
      .where("goalId", "==", goalId)
      .limit(1),
  );
  return !snapshot.empty;
};

/**
 * Releitura de autorização na fase de leitura de cada transação de meta:
 * perfil, workspace (ativo) e membership com o papel. Entre a pré-checagem do
 * kernel e o commit o membro pode ter sido removido ou rebaixado; reler aqui,
 * antes da idempotência e de qualquer escrita, torna a decisão atômica com a
 * mutação — inclusive o replay.
 */
const runGoalTransaction = <T>(
  actor: WorkspaceActor,
  body: (
    transaction: admin.firestore.Transaction,
    workspace: admin.firestore.DocumentData,
  ) => Promise<T>,
): Promise<T> => {
  return db().runTransaction(async (transaction) => {
    const {workspace} = await reassertWorkspaceActor(transaction, actor);
    return body(transaction, workspace);
  });
};

/** Lê a meta para mutação: existe, não está arquivada. */
const readMutableGoal = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  goalId: string,
): Promise<{
  ref: admin.firestore.DocumentReference;
  data: admin.firestore.DocumentData;
}> => {
  const ref = goalRef(workspaceId, goalId);
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", "Meta não encontrada.");
  }
  const data = snapshot.data() ?? {};
  if (data.workspaceId !== workspaceId) {
    throw new ApplicationError("not_found", "Meta não encontrada.");
  }
  if (data.archived === true) {
    throw new ApplicationError(
      "domain_precondition_failed", GOAL_ARCHIVED_MESSAGE,
    );
  }
  return {ref, data};
};

const assertRevision = (
  data: admin.firestore.DocumentData,
  expected: number,
) => {
  if (integerOrZero(data.revision) !== expected) {
    throw new ApplicationError("concurrent_update", GOAL_STALE_MESSAGE);
  }
};

export const executeCreateGoal = async (
  actor: WorkspaceActor,
  payload: CreateGoalPayload,
): Promise<Record<string, unknown>> =>
  runGoalTransaction(actor, async (transaction, workspace) => {
    const reservation = await reserveIdempotency(
      transaction, actor, "createGoal", payload.idempotencyKey, payload,
    );
    if (reservation.replay) return reservation.replay;
    assertWorkspaceFit(payload.goal, workspace);

    const ref = db()
      .collection(`${workspacePath(actor.workspaceId)}/goals`)
      .doc();
    const definition = definitionFields(payload.goal);
    const source = payload.goal.progressSource;
    const persisted: Record<string, unknown> = {
      ...definition,
      status: payload.status,
      archived: false,
      revision: 1,
      workspaceId: actor.workspaceId,
      ...(source === "manual" ?
        {
          manualProgressCents: payload.manualProgressCents,
          manualProgressUpdatedAt: FieldValue.serverTimestamp(),
          manualProgressUpdatedBy: actor.uid,
        } :
        {}),
      ...(source === "investment" ?
        {
          investmentNetContributionCents: 0,
          investmentCurrentValueCents: 0,
          investmentProgressCents: 0,
        } :
        {}),
    };
    const result = {success: true, goalId: ref.id, revision: 1};
    transaction.create(ref, {
      ...persisted,
      statusUpdatedAt: FieldValue.serverTimestamp(),
      createdBy: actor.uid,
      updatedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAudit(transaction, actor, "createGoal", reservation.ref, ref.id, {
      progressSource: source,
      status: payload.status,
      ...(source === "manual" ?
        {afterCents: payload.manualProgressCents} : {}),
    });
    completeIdempotency(transaction, reservation, result);
    return result;
  });

/**
 * Edição da definição. Não toca status (`setGoalStatus`) nem o valor manual
 * de uma meta que continua manual (`updateGoalManualProgress`): uma edição
 * com formulário antigo não desfaz uma mudança concorrente desses campos, e
 * a revisão esperada recusa o formulário desatualizado.
 *
 * Troca de fonte de progresso:
 * - saindo de `investment`: recusada enquanto houver posição vinculada (e a
 *   projeção precisa estar zerada); os campos patrimoniais saem do documento;
 * - entrando em `investment`: projeção começa em zero (o vínculo é feito no
 *   domínio patrimonial, que publica o progresso);
 * - entrando em `manual`: exige o valor inicial informado agora; nada da
 *   fonte anterior é convertido ou somado;
 * - saindo de `manual`: o valor manual sai do documento (fica na trilha).
 * Mudar só a base patrimonial recalcula `investmentProgressCents` na mesma
 * transação (PR-GOAL-01).
 */
export const executeUpdateGoal = async (
  actor: WorkspaceActor,
  payload: UpdateGoalPayload,
): Promise<Record<string, unknown>> =>
  runGoalTransaction(actor, async (transaction, workspace) => {
    const reservation = await reserveIdempotency(
      transaction, actor, "updateGoal", payload.idempotencyKey, payload,
    );
    if (reservation.replay) return reservation.replay;
    const {ref, data: current} = await readMutableGoal(
      transaction, actor.workspaceId, payload.goalId,
    );
    assertRevision(current, payload.expectedRevision);
    assertWorkspaceFit(payload.goal, workspace);

    const from = current.progressSource;
    const to = payload.goal.progressSource;
    const switchingToManual = from !== "manual" && to === "manual";
    if (switchingToManual && payload.manualProgressCents === undefined) {
      throw new ApplicationError(
        "invalid_payload",
        "Informe o valor já acumulado para a meta manual (pode ser zero).",
      );
    }
    if (!switchingToManual && payload.manualProgressCents !== undefined) {
      throw new ApplicationError(
        "invalid_payload",
        to === "manual" ?
          "Para alterar o valor acumulado, use a atualização de progresso." :
          "Só metas manuais recebem valor informado.",
      );
    }
    if (from === "investment" && to !== "investment") {
      const linked = await hasLinkedPositions(
        transaction, actor.workspaceId, payload.goalId,
      );
      if (linked) {
        throw new ApplicationError(
          "domain_precondition_failed", GOAL_LINKED_SOURCE_MESSAGE,
        );
      }
      if (
        integerOrZero(current.investmentNetContributionCents) !== 0 ||
        integerOrZero(current.investmentCurrentValueCents) !== 0
      ) {
        throw new ApplicationError(
          "domain_precondition_failed",
          "A projeção de investimentos desta meta não está zerada. " +
            "Desvincule os investimentos antes de mudar a forma de medir.",
        );
      }
    }

    const definition = definitionFields(payload.goal);
    const update: Record<string, unknown> = {...definition};
    for (const key of OPTIONAL_DEFINITION_FIELDS) {
      if (payload.goal[key] === undefined && current[key] !== undefined) {
        update[key] = FieldValue.delete();
      }
    }
    if (to === "investment") {
      if (from === "investment") {
        update.investmentProgressCents = investmentProgressFor(
          payload.goal.progressBasis, current,
        );
      } else {
        update.investmentNetContributionCents = 0;
        update.investmentCurrentValueCents = 0;
        update.investmentProgressCents = 0;
      }
    } else if (from === "investment") {
      for (const field of INVESTMENT_PROJECTION_FIELDS) {
        update[field] = FieldValue.delete();
      }
    }
    if (switchingToManual) {
      update.manualProgressCents = payload.manualProgressCents;
      update.manualProgressUpdatedAt = FieldValue.serverTimestamp();
      update.manualProgressUpdatedBy = actor.uid;
    } else if (from === "manual" && to !== "manual") {
      update.manualProgressCents = FieldValue.delete();
      update.manualProgressUpdatedAt = FieldValue.delete();
      update.manualProgressUpdatedBy = FieldValue.delete();
    }
    const revision = integerOrZero(current.revision) + 1;
    update.revision = revision;
    update.updatedBy = actor.uid;
    update.updatedAt = FieldValue.serverTimestamp();
    transaction.update(ref, update);

    const changed = Object.keys(definition)
      .filter((key) =>
        stableStringify(current[key]) !== stableStringify(definition[key]))
      .concat(OPTIONAL_DEFINITION_FIELDS.filter((key) =>
        payload.goal[key] === undefined && current[key] !== undefined));
    const result = {success: true, goalId: payload.goalId, revision};
    writeAudit(
      transaction, actor, "updateGoal", reservation.ref, payload.goalId,
      {
        changedFields: [...new Set(changed)].sort(),
        ...(from !== to ?
          {progressSourceFrom: from, progressSourceTo: to} : {}),
        ...(from === "manual" && to !== "manual" ?
          {
            discardedManualProgressCents:
              integerOrZero(current.manualProgressCents),
          } :
          {}),
        ...(switchingToManual ? {afterCents: payload.manualProgressCents} : {}),
      },
    );
    completeIdempotency(transaction, reservation, result);
    return result;
  });

/**
 * Atualização do valor informado de uma meta manual. Só o documento da meta
 * muda: nenhum lançamento, conta, investimento ou quota é tocado.
 */
export const executeUpdateGoalManualProgress = async (
  actor: WorkspaceActor,
  payload: UpdateGoalManualProgressPayload,
): Promise<Record<string, unknown>> =>
  runGoalTransaction(actor, async (transaction) => {
    const reservation = await reserveIdempotency(
      transaction, actor, "updateGoalManualProgress", payload.idempotencyKey,
      payload,
    );
    if (reservation.replay) return reservation.replay;
    const {ref, data: current} = await readMutableGoal(
      transaction, actor.workspaceId, payload.goalId,
    );
    if (current.progressSource !== "manual") {
      throw new ApplicationError(
        "domain_precondition_failed", GOAL_NOT_MANUAL_MESSAGE,
      );
    }
    assertRevision(current, payload.expectedRevision);
    const beforeCents = integerOrZero(current.manualProgressCents);
    const revision = integerOrZero(current.revision) + 1;
    transaction.update(ref, {
      manualProgressCents: payload.manualProgressCents,
      manualProgressUpdatedAt: FieldValue.serverTimestamp(),
      manualProgressUpdatedBy: actor.uid,
      revision,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = {
      success: true,
      goalId: payload.goalId,
      revision,
      manualProgressCents: payload.manualProgressCents,
    };
    writeAudit(
      transaction, actor, "updateGoalManualProgress", reservation.ref,
      payload.goalId,
      {beforeCents, afterCents: payload.manualProgressCents},
    );
    completeIdempotency(transaction, reservation, result);
    return result;
  });

/**
 * Status persistido (botões Retomar/Pausar/Concluir/Cancelar). Patch só do
 * status, sem revisão esperada e sem incrementar a revisão: a revisão protege
 * a definição e o valor manual (o que um formulário edita). Assim, um
 * formulário de edição aberto antes de um clique de status continua válido e,
 * como a edição não carrega status, não desfaz o status gravado.
 */
export const executeSetGoalStatus = async (
  actor: WorkspaceActor,
  payload: SetGoalStatusPayload,
): Promise<Record<string, unknown>> =>
  runGoalTransaction(actor, async (transaction) => {
    const reservation = await reserveIdempotency(
      transaction, actor, "setGoalStatus", payload.idempotencyKey, payload,
    );
    if (reservation.replay) return reservation.replay;
    const {ref, data: current} = await readMutableGoal(
      transaction, actor.workspaceId, payload.goalId,
    );
    const revision = integerOrZero(current.revision);
    transaction.update(ref, {
      status: payload.status,
      statusUpdatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = {
      success: true,
      goalId: payload.goalId,
      revision,
      status: payload.status,
    };
    writeAudit(
      transaction, actor, "setGoalStatus", reservation.ref, payload.goalId,
      {statusFrom: current.status, statusTo: payload.status},
    );
    completeIdempotency(transaction, reservation, result);
    return result;
  });

/**
 * Arquivamento lógico. Preserva o status de evolução (arquivar não é
 * cancelar) e é recusado enquanto houver posição de investimento vinculada:
 * o usuário desvincula ou transfere pelos recursos do domínio patrimonial,
 * que nunca apagam posição nem movimento.
 */
export const executeArchiveGoal = async (
  actor: WorkspaceActor,
  payload: ArchiveGoalPayload,
): Promise<Record<string, unknown>> =>
  runGoalTransaction(actor, async (transaction) => {
    const reservation = await reserveIdempotency(
      transaction, actor, "archiveGoal", payload.idempotencyKey, payload,
    );
    if (reservation.replay) return reservation.replay;
    const {ref, data: current} = await readMutableGoal(
      transaction, actor.workspaceId, payload.goalId,
    );
    const linked = await hasLinkedPositions(
      transaction, actor.workspaceId, payload.goalId,
    );
    if (linked) {
      throw new ApplicationError(
        "domain_precondition_failed", GOAL_LINKED_ARCHIVE_MESSAGE,
      );
    }
    const revision = integerOrZero(current.revision) + 1;
    transaction.update(ref, {
      archived: true,
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: actor.uid,
      archiveReason: payload.reason,
      revision,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = {success: true, goalId: payload.goalId, revision};
    writeAudit(
      transaction, actor, "archiveGoal", reservation.ref, payload.goalId,
      {
        reason: payload.reason,
        status: current.status,
        progressSource: current.progressSource,
      },
    );
    completeIdempotency(transaction, reservation, result);
    return result;
  });
