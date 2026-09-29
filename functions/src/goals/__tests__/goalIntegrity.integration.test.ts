import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

import {ApplicationError} from "../../shared/errors";
import {
  callableRequest,
  requireFirestoreEmulator,
  seedActiveAccount,
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {
  resolveWorkspaceActor,
  WORKSPACE_ACCESS_DENIED_MESSAGE,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../../shared/workspaceAuth";
import {createGoal, GOAL_OPERATION_ROLES} from "../callables";
import {
  executeArchiveGoal,
  executeCreateGoal,
} from "../operations";

// Suíte de integração sem Emulator falha em vez de pular.
const firestore = requireFirestoreEmulator();
const getDb = () => firestore;

const PF_WORKSPACE = "goal-integrity-pf";
const OTHER_WORKSPACE = "goal-integrity-other";
const LEGACY_OWNER_WORKSPACE = "goal-integrity-legacy-owner";
const OWNER_A = "goal-owner-a";
const OWNER_B = "goal-owner-b";
const MEMBER_A = "goal-member-a";
const LEGACY_OWNER = "goal-legacy-owner";

const actorFor = (
  workspaceId: string,
  uid: string,
  role: WorkspaceRole = "owner",
): WorkspaceActor => ({workspaceId, uid, role});

/**
 * Estado canônico: perfil ativo, workspace `active` e membership `active`
 * com o papel real — o mesmo que o resolvedor do kernel exige.
 */
const seedGoalWorkspace = async (
  workspaceId: string,
  ownerId: string,
  type: "PF" | "PJ",
) => {
  await seedActiveAccount(ownerId);
  await seedWorkspace({workspaceId, ownerId, type});
};

const resetWorkspace = async (workspaceId: string) => {
  const ref = getDb().doc(`workspaces/${workspaceId}`);
  await getDb().recursiveDelete(ref);
};

const goalPayload = (workspaceId: string, idempotencyKey: string) => ({
  workspaceId,
  idempotencyKey,
  goal: {
    name: "Reserva verificável",
    description: "Meta de teste",
    category: "reserva_emergencia" as const,
    status: "em_andamento" as const,
    priority: "alta" as const,
    targetAmount: 10000,
    startDate: "2026-01-01",
    deadline: "2027-01-01",
    horizon: "curto" as const,
    progressBasis: "net_contributions" as const,
    visual: {
      color: "#6366f1",
      icon: "Target",
      progressBarType: "linear" as const,
    },
  },
});

/** Quantidade de documentos de uma subcoleção do workspace (teste). */
const countOf = async (workspaceId: string, collection: string) =>
  (await getDb().collection(`workspaces/${workspaceId}/${collection}`)
    .count().get()).data().count;

/**
 * Rastro de mutação de meta: cada criação aceita deixa exatamente uma meta,
 * uma chave de idempotência e um registro de auditoria. Uma recusa não deixa
 * nenhum dos três.
 */
const assertGoalWrites = async (workspaceId: string, accepted: number) => {
  assert.equal(await countOf(workspaceId, "goals"), accepted);
  assert.equal(await countOf(workspaceId, "goal_idempotency_keys"), accepted);
  assert.equal(await countOf(workspaceId, "goal_audit_logs"), accepted);
};

const isApplicationError = (code: string) => (error: unknown) =>
  error instanceof ApplicationError && error.code === code;

const isPermissionDenied = (error: unknown) =>
  error instanceof HttpsError && error.code === "permission-denied";

/*
 * Arquivamento de meta sem varredura de `transactions`.
 *
 * A versão anterior lia até 2.001 aportes legados por arquivamento só para
 * registrar quantos eram. O progresso patrimonial já é publicado na própria
 * meta por `updateGoalProjection`, a partir das posições: é ele que a trilha
 * de auditoria passa a guardar, sem custo de leitura e sem tocar em caixa.
 */
test("arquivar preserva o histórico e registra o progresso patrimonial",
  async () => {
    await resetWorkspace(PF_WORKSPACE);
    await seedGoalWorkspace(PF_WORKSPACE, OWNER_A, "PF");
    const actor = actorFor(PF_WORKSPACE, OWNER_A);
    const created = await executeCreateGoal(
      actor,
      goalPayload(PF_WORKSPACE, "goal-archive-0000001"),
    );
    const goalId = String(created.goalId);

    // Progresso publicado pelo domínio patrimonial, como faria um aporte.
    await getDb().doc(`workspaces/${PF_WORKSPACE}/goals/${goalId}`).update({
      investmentProgressCents: 250_000,
    });

    const archived = await executeArchiveGoal(actor, {
      workspaceId: PF_WORKSPACE,
      idempotencyKey: "goal-archive-0000002",
      goalId,
      reason: "Meta concluída no teste",
    });
    assert.equal(archived.archivedProgressCents, 250_000);

    const goal = await getDb()
      .doc(`workspaces/${PF_WORKSPACE}/goals/${goalId}`)
      .get();
    assert.equal(goal.exists, true, "arquivar nunca apaga o documento da meta");
    assert.equal(goal.data()?.archived, true);
    assert.equal(goal.data()?.status, "cancelada");
    assert.equal(goal.data()?.investmentProgressCents, 250_000);

    // Repetir a mesma intenção é replay, não um segundo arquivamento.
    const replay = await executeArchiveGoal(actor, {
      workspaceId: PF_WORKSPACE,
      idempotencyKey: "goal-archive-0000002",
      goalId,
      reason: "Meta concluída no teste",
    });
    assert.deepEqual(replay, archived);
  });

test("RBAC rejeita acesso cruzado nos dois sentidos", async () => {
  await Promise.all([
    resetWorkspace(PF_WORKSPACE),
    resetWorkspace(OTHER_WORKSPACE),
  ]);
  await Promise.all([
    seedGoalWorkspace(PF_WORKSPACE, OWNER_A, "PF"),
    seedGoalWorkspace(OTHER_WORKSPACE, OWNER_B, "PF"),
  ]);
  const roles = GOAL_OPERATION_ROLES.createGoal;

  // Resolvedor canônico: sem membership ativo, nenhum papel.
  const denied = (uid: string, workspaceId: string) => assert.rejects(
    () => resolveWorkspaceActor(uid, workspaceId, roles),
    isApplicationError("workspace_membership_required"),
  );
  await denied(OWNER_A, OTHER_WORKSPACE);
  await denied(OWNER_B, PF_WORKSPACE);

  // E pela callable, com token realista: recusa sem escrever nada.
  const deniedCallable = (uid: string, workspaceId: string) => assert.rejects(
    () => createGoal.run(callableRequest(
      uid,
      goalPayload(workspaceId, `goal-cross-${uid}-0001`),
    )),
    (error: unknown) =>
      isPermissionDenied(error) &&
      (error as HttpsError).message === WORKSPACE_ACCESS_DENIED_MESSAGE,
  );
  await deniedCallable(OWNER_A, OTHER_WORKSPACE);
  await deniedCallable(OWNER_B, PF_WORKSPACE);
  await assertGoalWrites(PF_WORKSPACE, 0);
  await assertGoalWrites(OTHER_WORKSPACE, 0);
});

test("dono conhecido só por workspace.ownerId, sem membership, é recusado",
  async () => {
    await resetWorkspace(LEGACY_OWNER_WORKSPACE);
    await Promise.all([
      seedActiveAccount(LEGACY_OWNER),
      seedActiveAccount(MEMBER_A),
    ]);
    // `ownerId` aponta para quem não tem documento de membership. O campo é
    // denormalizado e nunca autoriza nem serve de fallback.
    await getDb().doc(`workspaces/${LEGACY_OWNER_WORKSPACE}`).set({
      name: LEGACY_OWNER_WORKSPACE,
      type: "PF",
      ownerId: LEGACY_OWNER,
      status: "active",
      currency: "BRL",
      cnpj: null,
    });
    await seedMember(LEGACY_OWNER_WORKSPACE, MEMBER_A, "member");
    const legacyMembership = await getDb()
      .doc(`workspaces/${LEGACY_OWNER_WORKSPACE}/members/${LEGACY_OWNER}`)
      .get();
    assert.equal(legacyMembership.exists, false);

    await assert.rejects(
      () => createGoal.run(callableRequest(
        LEGACY_OWNER,
        goalPayload(LEGACY_OWNER_WORKSPACE, "goal-legacy-owner-0001"),
      )),
      isPermissionDenied,
    );
    await assert.rejects(
      () => resolveWorkspaceActor(
        LEGACY_OWNER,
        LEGACY_OWNER_WORKSPACE,
        GOAL_OPERATION_ROLES.createGoal,
      ),
      isApplicationError("workspace_membership_required"),
    );
    // A releitura transacional também não aceita o `ownerId`.
    await assert.rejects(
      () => executeCreateGoal(
        actorFor(LEGACY_OWNER_WORKSPACE, LEGACY_OWNER, "owner"),
        goalPayload(LEGACY_OWNER_WORKSPACE, "goal-legacy-owner-0002"),
      ),
      isApplicationError("workspace_membership_required"),
    );
    await assertGoalWrites(LEGACY_OWNER_WORKSPACE, 0);

    // Controle: o membro ativo do mesmo workspace cria pela mesma callable.
    const created = await createGoal.run(callableRequest(
      MEMBER_A,
      goalPayload(LEGACY_OWNER_WORKSPACE, "goal-legacy-member-0001"),
    ));
    assert.equal(created.success, true);
    await assertGoalWrites(LEGACY_OWNER_WORKSPACE, 1);
  });

test("ator rebaixado ou removido entre a pré-checagem e a transação é recusado",
  async () => {
    await resetWorkspace(PF_WORKSPACE);
    await Promise.all([
      seedActiveAccount(OWNER_A),
      seedActiveAccount(MEMBER_A),
    ]);
    await seedWorkspace({
      workspaceId: PF_WORKSPACE,
      ownerId: OWNER_A,
      type: "PF",
    });
    await seedMember(PF_WORKSPACE, MEMBER_A, "member");
    const roles = GOAL_OPERATION_ROLES.createGoal;

    // Rebaixamento: a pré-checagem aprovou `member`; antes da transação o
    // papel vira `viewer`, que é somente leitura.
    const demoted = await resolveWorkspaceActor(MEMBER_A, PF_WORKSPACE, roles);
    assert.equal(demoted.role, "member");
    await getDb()
      .doc(`workspaces/${PF_WORKSPACE}/members/${MEMBER_A}`)
      .update({role: "viewer"});
    await assert.rejects(
      () => executeCreateGoal(
        demoted,
        goalPayload(PF_WORKSPACE, "goal-demoted-0000001"),
      ),
      isApplicationError("workspace_role_denied"),
    );
    await assertGoalWrites(PF_WORKSPACE, 0);

    // Remoção: a pré-checagem aprovou o owner; antes da transação o
    // membership deixa de estar ativo.
    const removed = await resolveWorkspaceActor(OWNER_A, PF_WORKSPACE, roles);
    assert.equal(removed.role, "owner");
    await getDb()
      .doc(`workspaces/${PF_WORKSPACE}/members/${OWNER_A}`)
      .update({status: "removed"});
    await assert.rejects(
      () => executeCreateGoal(
        removed,
        goalPayload(PF_WORKSPACE, "goal-removed-0000001"),
      ),
      isApplicationError("workspace_membership_required"),
    );
    await assertGoalWrites(PF_WORKSPACE, 0);
  });

test("perda de acesso também recusa o replay de uma intenção concluída",
  async () => {
    await resetWorkspace(PF_WORKSPACE);
    await seedGoalWorkspace(PF_WORKSPACE, OWNER_A, "PF");
    const actor = actorFor(PF_WORKSPACE, OWNER_A);
    const payload = goalPayload(PF_WORKSPACE, "goal-replay-lost-0001");
    await executeCreateGoal(actor, payload);

    await getDb()
      .doc(`workspaces/${PF_WORKSPACE}/members/${OWNER_A}`)
      .update({status: "removed"});
    await assert.rejects(
      () => executeCreateGoal(actor, payload),
      isApplicationError("workspace_membership_required"),
    );
    await assertGoalWrites(PF_WORKSPACE, 1);
  });
