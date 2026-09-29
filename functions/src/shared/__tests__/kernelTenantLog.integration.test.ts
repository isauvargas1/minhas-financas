import assert from "node:assert/strict";
import test, {mock} from "node:test";

// Módulo cru (sem a namespace de getters do `import * as`), para o mock
// substituir `write` onde o logger do kernel o procura.
import functionsLogger = require("firebase-functions/logger");
import {z} from "zod";

import {
  archiveWorkspace,
  updateWorkspaceSettings,
} from "../../workspaces/callables";
import {
  call,
  expectHttpsError,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {defineCallable} from "../callable";
import {
  requireFirestoreEmulator,
  seedActiveAccount,
  seedWorkspace,
} from "../testSupport/kernelTestSupport";

requireFirestoreEmulator();

/**
 * Tenant no log estruturado do kernel (P1).
 *
 * O `workspaceId` do payload é só o workspace **solicitado**. O campo
 * `workspaceId` do contexto de log é o workspace **autorizado**: pela
 * pré-checagem do resolvedor canônico ou, nas operações que autorizam dentro
 * da transação, por `trustWorkspace` depois do commit. Quem não tem acesso não
 * consegue fazer o próprio pedido aparecer nos logs do tenant de outra pessoa.
 */
type Entry = Record<string, unknown>;

const captureLogs = async (run: () => Promise<unknown>): Promise<Entry[]> => {
  const entries: Entry[] = [];
  const spy = mock.method(functionsLogger, "write", (entry: Entry) => {
    entries.push(entry);
  });
  try {
    await run().catch(() => undefined);
  } finally {
    spy.mock.restore();
  }
  return entries;
};

const endOf = (entries: Entry[]): Entry => {
  const end = entries.find((entry) => entry.event === "callable.end");
  assert.ok(end, "callable.end registrado");
  return end;
};

const assertNoTenant = (entries: Entry[], victim: string) => {
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.equal(entry.workspaceId, null, `${String(entry.event)} com tenant`);
    assert.equal(JSON.stringify(entry).includes(victim), false);
  }
};

const victimWorkspace = async () => {
  const workspaceId = uniqueId("victim-ws");
  const owner = uniqueId("victim-owner");
  await seedActiveAccount(owner);
  await seedWorkspace({workspaceId, ownerId: owner, type: "PJ"});
  return {workspaceId, owner};
};

const probe = defineCallable({
  operation: "kernelTenantProbe",
  schema: z.object({workspaceId: z.string().min(1)}).strict(),
  handler: async () => ({ok: true}),
});

test("callable sem pré-checagem não registra o workspace do payload",
  async () => {
    const uid = uniqueId("probe");
    await seedActiveAccount(uid);
    const victim = uniqueId("victim-ws");
    const entries = await captureLogs(
      () => call(probe, uid, {workspaceId: victim}),
    );
    assert.equal(endOf(entries).outcome, "ok");
    assertNoTenant(entries, victim);
  });

test("pré-checagem recusada não contamina o log com o tenant alheio",
  async () => {
    const {workspaceId} = await victimWorkspace();
    const intruder = uniqueId("intruder");
    await seedActiveAccount(intruder);
    const entries = await captureLogs(() => expectHttpsError(
      call(updateWorkspaceSettings, intruder, {workspaceId, name: "Invadido"}),
      "permission-denied",
    ));
    assert.equal(endOf(entries).errorCode, "workspace_membership_required");
    assertNoTenant(entries, workspaceId);
  });

test("pré-checagem aceita registra o workspace autorizado", async () => {
  const {workspaceId, owner} = await victimWorkspace();
  const entries = await captureLogs(() =>
    call(updateWorkspaceSettings, owner, {workspaceId, name: "Renomeado"}));
  const end = endOf(entries);
  assert.equal(end.outcome, "ok");
  assert.equal(end.workspaceId, workspaceId);
  assert.equal(end.actorRole, "owner");
});

test("autorização transacional: tenant só depois do commit", async () => {
  const {workspaceId, owner} = await victimWorkspace();
  const intruder = uniqueId("intruder-archive");
  await seedActiveAccount(intruder);
  const denied = await captureLogs(() => expectHttpsError(
    call(archiveWorkspace, intruder, {workspaceId}),
    "permission-denied",
  ));
  assertNoTenant(denied, workspaceId);

  const allowed = await captureLogs(() =>
    call(archiveWorkspace, owner, {workspaceId}));
  const end = endOf(allowed);
  assert.equal(end.outcome, "ok");
  assert.equal(end.workspaceId, workspaceId);
  assert.equal(end.actorRole, "owner");
  // O início é registrado antes da autorização: continua sem tenant.
  const start = allowed.find((entry) => entry.event === "callable.start");
  assert.equal(start?.workspaceId, null);
});
