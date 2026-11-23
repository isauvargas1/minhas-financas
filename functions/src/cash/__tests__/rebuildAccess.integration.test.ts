import assert from "node:assert/strict";
import test, {mock} from "node:test";
import * as firebaseAdminFirestore from "firebase-admin/firestore";

// Módulo cru (sem a namespace de getters do `import * as`), para o mock
// substituir `write` onde o logger do kernel o procura.
import functionsLogger = require("firebase-functions/logger");

import {
  CASH_REBUILD_ROLES,
  executeAuthorizedRebuild,
  executeRebuildCashPeriods,
  rebuildCashPeriods,
} from "../rebuild";
import {createOperationLogger} from "../../shared/logger";
import {resolveWorkspaceActor} from "../../shared/workspaceAuth";
import {
  requireFirestoreEmulator,
  seedActiveAccount,
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {
  call,
  expectHttpsError,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";

/**
 * P5-GATE-FINAL — autorização e log da reconstrução do caixa
 * (`rebuildCashPeriods`).
 *
 * MT-01: a reconstrução troca a geração da projeção e as marcas que a
 * estimativa do cliente usa como prova (P5-C1, R3). Só owner e admin do
 * próprio workspace a disparam. Cada recusa é conferida pela árvore inteira
 * dos dois workspaces e da conta do ator: nenhum checkpoint, geração,
 * projeção, marca ou reserva de limite é gravado.
 *
 * OBS-01 e OBS-02: os dois logs internos da reconstrução saem pelo logger
 * do kernel, com a correlação da chamada, e nunca com a mensagem do erro.
 */

const db = (): firebaseAdminFirestore.Firestore => requireFirestoreEmulator();

type Entry = Record<string, unknown>;

interface Tenant {
  workspaceId: string;
  owner: string;
  admin: string;
  member: string;
  viewer: string;
  removed: string;
  suspended: string;
}

const seedTenant = async (type: "PF" | "PJ", prefix: string):
  Promise<Tenant> => {
  const t: Tenant = {
    workspaceId: uniqueId(`${prefix}-ws`),
    owner: uniqueId(`${prefix}-owner`),
    admin: uniqueId(`${prefix}-admin`),
    member: uniqueId(`${prefix}-member`),
    viewer: uniqueId(`${prefix}-viewer`),
    removed: uniqueId(`${prefix}-removed`),
    suspended: uniqueId(`${prefix}-suspended`),
  };
  for (const uid of [t.owner, t.admin, t.member, t.viewer, t.removed]) {
    await seedActiveAccount(uid);
  }
  await seedActiveAccount(t.suspended, {status: "suspended"});
  await seedWorkspace({workspaceId: t.workspaceId, ownerId: t.owner, type});
  await seedMember(t.workspaceId, t.admin, "admin");
  await seedMember(t.workspaceId, t.member, "member");
  await seedMember(t.workspaceId, t.viewer, "viewer");
  await seedMember(t.workspaceId, t.removed, "member", "removed");
  // Suspenso com papel de admin: a conta, não o papel, é que recusa.
  await seedMember(t.workspaceId, t.suspended, "admin");
  for (const [index, valueCents] of [[1, 12_345], [2, 67_890]] as const) {
    await db().doc(`workspaces/${t.workspaceId}/transactions/tx-${index}`)
      .set({
        type: index === 1 ? "receita" : "despesa",
        description: "Lançamento",
        category: "Casa",
        valueCents,
        date: `2026-0${index + 6}-10`,
        userId: t.owner,
        workspaceId: t.workspaceId,
      });
  }
  return t;
};

const payload = (workspaceId: string, dryRun = false) => ({
  workspaceId,
  idempotencyKey: uniqueId("cash-rebuild-access"),
  correlationId: uniqueId("corr-cash-rebuild"),
  pageSize: 100,
  reason: "Reconstrução de teste",
  dryRun,
});

/** Cada documento da árvore (inclusive os de pai ausente), com os dados. */
const treeOf = async (
  root: firebaseAdminFirestore.DocumentReference,
): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  const visit = async (ref: firebaseAdminFirestore.DocumentReference) => {
    const snapshot = await ref.get();
    out[ref.path] = snapshot.exists ? JSON.stringify(snapshot.data()) : "∅";
    for (const collection of await ref.listCollections()) {
      for (const child of await collection.listDocuments()) {
        await visit(child);
      }
    }
  };
  await visit(root);
  return out;
};

const treesOf = async (workspaceIds: string[], uid: string | null) => {
  const roots = workspaceIds.map((id) => db().doc(`workspaces/${id}`));
  if (uid) roots.push(db().doc(`users/${uid}`));
  const trees = await Promise.all(roots.map(treeOf));
  return Object.assign({}, ...trees) as Record<string, string>;
};

/** Chama e confirma a recusa sem nenhuma escrita nos dois tenants. */
const expectRefusedWithoutWrites = async (
  uid: string | null,
  target: string,
  others: string[],
  code: string,
  reason?: string,
) => {
  const before = await treesOf([target, ...others], uid);
  await expectHttpsError(call(rebuildCashPeriods, uid, payload(target)), code,
    reason ? {reason} : {});
  const after = await treesOf([target, ...others], uid);
  assert.deepEqual(after, before, `${uid ?? "anônimo"} gravou algo`);
};

const captureLogs = async (run: () => Promise<unknown>) => {
  const entries: Entry[] = [];
  const spy = mock.method(functionsLogger, "write", (entry: Entry) => {
    entries.push(entry);
  });
  let outcome: unknown;
  try {
    outcome = await run().catch((error: unknown) => error);
  } finally {
    spy.mock.restore();
  }
  return {entries, outcome};
};

// ------------------------------------------------------------ MT-01

test("MT-01: a matriz da reconstrução é owner e admin", () => {
  assert.deepEqual([...CASH_REBUILD_ROLES].sort(), ["admin", "owner"]);
});

test("MT-01: owner e admin reconstroem o próprio workspace e gravam a " +
  "projeção e a reserva do limite", async () => {
  const a = await seedTenant("PF", "mt01ok");
  const owner = await call(rebuildCashPeriods, a.owner,
    payload(a.workspaceId));
  assert.equal(owner.completed, true);
  assert.equal(owner.dryRun, false);
  const admin = await call(rebuildCashPeriods, a.admin,
    payload(a.workspaceId, true));
  assert.equal(admin.completed, true);
  assert.equal(admin.dryRun, true);
  const tree = await treesOf([a.workspaceId], a.owner);
  assert.ok(Object.keys(tree).some((path) =>
    path.includes("/cash_report_periods/2026-07")), "mês publicado");
  assert.ok(Object.keys(tree).some((path) => path.includes("/rate_limits/")),
    "limite reservado");
});

test("MT-01: member, viewer, removido, conta suspensa, anônimo e não membro " +
  "são recusados sem gravar nada", async () => {
  const a = await seedTenant("PF", "mt01deny");
  const outsider = uniqueId("mt01-outsider");
  await seedActiveAccount(outsider);
  await expectRefusedWithoutWrites(a.member, a.workspaceId, [],
    "permission-denied");
  await expectRefusedWithoutWrites(a.viewer, a.workspaceId, [],
    "permission-denied");
  await expectRefusedWithoutWrites(a.removed, a.workspaceId, [],
    "permission-denied");
  await expectRefusedWithoutWrites(a.suspended, a.workspaceId, [],
    "permission-denied", "account_suspended");
  await expectRefusedWithoutWrites(outsider, a.workspaceId, [],
    "permission-denied");
  await expectRefusedWithoutWrites(null, a.workspaceId, [],
    "unauthenticated");
});

test("MT-01: owner e admin de B contra A e de A contra B são recusados, nos " +
  "dois sentidos, sem gravar em nenhum dos dois", async () => {
  const a = await seedTenant("PF", "mt01a");
  const b = await seedTenant("PJ", "mt01b");
  for (const uid of [b.owner, b.admin]) {
    await expectRefusedWithoutWrites(uid, a.workspaceId, [b.workspaceId],
      "permission-denied");
  }
  for (const uid of [a.owner, a.admin]) {
    await expectRefusedWithoutWrites(uid, b.workspaceId, [a.workspaceId],
      "permission-denied");
  }
});

test("MT-01: admin rebaixado a member e owner removido entre a pré-checagem " +
  "e a transação não reconstroem nem reservam o limite", async () => {
  const a = await seedTenant("PF", "mt01race");
  const demoted = await resolveWorkspaceActor(a.admin, a.workspaceId,
    CASH_REBUILD_ROLES);
  assert.equal(demoted.role, "admin");
  await db().doc(`workspaces/${a.workspaceId}/members/${a.admin}`)
    .update({role: "member"});
  let before = await treesOf([a.workspaceId], a.admin);
  await assert.rejects(
    executeAuthorizedRebuild(demoted, payload(a.workspaceId)),
    (error: {code?: string}) => error.code === "workspace_role_denied",
  );
  assert.deepEqual(await treesOf([a.workspaceId], a.admin), before);

  const removed = await resolveWorkspaceActor(a.owner, a.workspaceId,
    CASH_REBUILD_ROLES);
  assert.equal(removed.role, "owner");
  await db().doc(`workspaces/${a.workspaceId}/members/${a.owner}`)
    .update({status: "removed"});
  before = await treesOf([a.workspaceId], a.owner);
  await assert.rejects(
    executeAuthorizedRebuild(removed, payload(a.workspaceId)),
    (error: {code?: string}) =>
      error.code === "workspace_membership_required",
  );
  assert.deepEqual(await treesOf([a.workspaceId], a.owner), before);
});

// ------------------------------------------------------------ OBS-01/02

const SECRET_TEXT = "texto-interpolado-pelo-sdk-0123456789";

test("OBS-01: falha na limpeza sai pelo logger da chamada, com passo e " +
  "código, sem a mensagem, e não impede a publicação", async () => {
  const a = await seedTenant("PF", "obs01");
  const log = createOperationLogger({
    operation: "rebuildCashPeriods",
    requestId: "req-obs01-cleanup",
    workspaceId: a.workspaceId,
  });
  const steps: string[] = [];
  const faults = {
    cleanupStep: (step: string) => {
      steps.push(step);
      throw new Error(`${SECRET_TEXT} ${step}`);
    },
  };
  const published = await captureLogs(() => executeRebuildCashPeriods(
    a.workspaceId, a.owner, payload(a.workspaceId), {log, faults}));
  const simulated = await captureLogs(() => executeRebuildCashPeriods(
    a.workspaceId, a.owner, payload(a.workspaceId, true), {log, faults}));
  assert.equal((published.outcome as Entry).completed, true);
  assert.equal((simulated.outcome as Entry).completed, true);
  assert.deepEqual(steps, ["category_garbage_before", "published_shards",
    "category_garbage_after", "dry_run_shards"]);

  const failures = [...published.entries, ...simulated.entries]
    .filter((entry) => entry.event === "cash_rebuild_cleanup_failed");
  assert.deepEqual(failures.map((entry) => entry.step), steps);
  for (const entry of failures) {
    assert.equal(entry.severity, "WARNING");
    assert.equal(entry.message, "cash_rebuild_cleanup_failed");
    assert.equal(entry.requestId, "req-obs01-cleanup");
    assert.equal(entry.operation, "rebuildCashPeriods");
    assert.equal(entry.workspaceId, a.workspaceId);
    assert.equal(entry.errorCode, "internal");
    assert.equal("errorMessage" in entry, false);
    assert.equal(JSON.stringify(entry).includes(SECRET_TEXT), false,
      "mensagem do erro no log");
  }
});

test("OBS-01: sem o logger da chamada, a reconstrução usa o da operação, " +
  "com o workspace", async () => {
  const a = await seedTenant("PF", "obs01b");
  const {entries} = await captureLogs(() => executeRebuildCashPeriods(
    a.workspaceId, a.owner, payload(a.workspaceId, true), {
      faults: {
        cleanupStep: () => {
          throw new Error(SECRET_TEXT);
        },
      },
    }));
  const failure = entries.find((entry) =>
    entry.event === "cash_rebuild_cleanup_failed");
  assert.ok(failure, "falha registrada");
  assert.equal(failure.operation, "rebuildCashPeriods");
  assert.equal(failure.workspaceId, a.workspaceId);
  assert.equal(JSON.stringify(entries).includes(SECRET_TEXT), false);
});

test("OBS-02: documento fora do contrato é registrado pela callable com a " +
  "correlação da chamada e sem a mensagem", async () => {
  const a = await seedTenant("PF", "obs02");
  // Legado em reais, sem `valueCents`: a reconstrução recusa publicar.
  await db().doc(`workspaces/${a.workspaceId}/transactions/tx-legado`).set({
    type: "receita",
    description: "Lançamento",
    category: "Casa",
    value: 100,
    date: "2026-07-11",
    userId: a.owner,
    workspaceId: a.workspaceId,
  });
  const {entries, outcome} = await captureLogs(() =>
    call(rebuildCashPeriods, a.owner, payload(a.workspaceId)));
  assert.equal((outcome as {code?: string}).code, "failed-precondition");
  const start = entries.find((entry) => entry.event === "callable.start");
  assert.ok(start, "callable.start registrado");
  const violation = entries.find((entry) =>
    entry.event === "cash_rebuild_contract_violation");
  assert.ok(violation, "violação registrada");
  assert.equal(violation.severity, "ERROR");
  assert.equal(violation.requestId, start.requestId);
  assert.equal(typeof violation.requestId, "string");
  assert.equal(violation.actorId, a.owner);
  assert.equal(violation.actorRole, "owner");
  assert.equal(violation.workspaceId, a.workspaceId);
  assert.equal(violation.transactionId, "tx-legado");
  assert.equal(violation.field, "valueCents");
  assert.doesNotMatch(String(violation.stack), /fora do contrato/);
  assert.ok(entries.every((entry) =>
    !JSON.stringify(entry).includes("fora do contrato")));
});
