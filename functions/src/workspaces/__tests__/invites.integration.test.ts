import assert from "node:assert/strict";
import test from "node:test";

import {Timestamp} from "firebase-admin/firestore";

import {
  requireFirestoreEmulator,
  seedActiveAccount,
  seedMember,
  seedPaidPlan,
  seedWorkspace,
  testEmailFor,
} from "../../shared/testSupport/kernelTestSupport";
import {
  acceptWorkspaceInvite,
  bootstrapAccount,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
} from "../callables";
import {generateInviteToken, hashInviteToken} from "../inviteTokens";
import {ACCEPT_RATE_LIMIT, INVITE_UNAVAILABLE_MESSAGE} from "../memberships";
import {issueTestInviteToken} from "../testSupport/inviteTokenSeam";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  indexOf,
  memberOf,
  membershipEvents,
  uniqueId,
} from "../testSupport/p1TestSupport";

requireFirestoreEmulator();

const account = async (prefix: string): Promise<string> => {
  const uid = uniqueId(prefix);
  await seedActiveAccount(uid);
  return uid;
};

const team = async () => {
  const workspaceId = uniqueId("ws-inv");
  const [owner, admin, member, viewer] = await Promise.all([
    account("owner"), account("admin"), account("member"), account("viewer"),
  ]);
  // Quatro membros ativos e vários convites: acima do Free (P2B.1).
  await seedPaidPlan(owner, "business");
  await seedWorkspace({workspaceId, ownerId: owner, type: "PJ"});
  await Promise.all([
    seedMember(workspaceId, admin, "admin"),
    seedMember(workspaceId, member, "member"),
    seedMember(workspaceId, viewer, "viewer"),
  ]);
  return {workspaceId, owner, admin, member, viewer};
};

const invite = async (
  actor: string,
  workspaceId: string,
  email: string,
  role: "admin" | "member" | "viewer" = "member",
) => call<{inviteId: string; expiresAt: string}>(inviteWorkspaceMember, actor, {
  workspaceId,
  email,
  role,
  idempotencyKey: idempotencyKey(),
});

const unavailable = (promise: Promise<unknown>) =>
  expectHttpsError(promise, "not-found", {message: INVITE_UNAVAILABLE_MESSAGE});

test("convite: matriz D-04 de quem convida com qual papel", async () => {
  const {workspaceId, owner, admin, member, viewer} = await team();
  for (const role of ["admin", "member", "viewer"] as const) {
    await invite(owner, workspaceId, `${uniqueId("o")}@x.test`, role);
  }
  for (const role of ["member", "viewer"] as const) {
    await invite(admin, workspaceId, `${uniqueId("a")}@x.test`, role);
  }
  await expectHttpsError(
    invite(admin, workspaceId, `${uniqueId("a")}@x.test`, "admin"),
    "permission-denied",
  );
  for (const uid of [member, viewer]) {
    await expectHttpsError(
      invite(uid, workspaceId, `${uniqueId("m")}@x.test`, "viewer"),
      "permission-denied",
    );
  }
  await expectHttpsError(
    call(inviteWorkspaceMember, owner, {
      workspaceId,
      email: "x@y.test",
      role: "owner",
      idempotencyKey: idempotencyKey(),
    }),
    "invalid-argument",
  );
  await expectHttpsError(
    call(inviteWorkspaceMember, owner, {
      workspaceId,
      email: "x@y.test",
      role: "member",
      idempotencyKey: idempotencyKey(),
    }, {email_verified: false}),
    "permission-denied",
    {reason: "email_not_verified"},
  );
  const invites = await db().collection(`workspaces/${workspaceId}/invites`).get();
  assert.equal(invites.size, 5);
  assert.equal(
    (await membershipEvents(workspaceId, "invite.created")).length,
    5,
  );
});

test("convite não cria membership e não guarda token nem hash", async () => {
  const {workspaceId, owner} = await team();
  const invitee = uniqueId("future");
  const email = testEmailFor(invitee);
  const {inviteId, expiresAt} = await invite(owner, workspaceId, ` ${email.toUpperCase()} `);
  const doc = (await db().doc(`workspaces/${workspaceId}/invites/${inviteId}`)
    .get()).data();
  assert.ok(doc);
  assert.equal(doc.emailNormalized, email);
  assert.equal(doc.status, "pending");
  assert.equal(doc.role, "member");
  assert.equal(doc.createdBy, owner);
  for (const key of Object.keys(doc)) {
    assert.ok(!/token|hash/i.test(key), `campo sensível no convite: ${key}`);
  }
  const ttlMs = new Date(expiresAt).getTime() - Date.now();
  assert.ok(ttlMs > 6.9 * 86400000 && ttlMs <= 7 * 86400000, "7 dias");
  assert.equal((await memberOf(workspaceId, invitee)), undefined);
  // Ponteiro do hash: só o SHA-256 (64 hex) como ID; nada do token.
  const pointers = await db().collection("invite_tokens")
    .where("inviteId", "==", inviteId).get();
  assert.equal(pointers.size, 1);
  assert.match(pointers.docs[0].id, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    Object.keys(pointers.docs[0].data()).sort(),
    ["createdAt", "expiresAt", "inviteId", "workspaceId"],
  );
});

test("aceite: convite antes da conta, membership pelo uid da sessão", async () => {
  const {workspaceId, owner} = await team();
  const invitee = uniqueId("newcomer");
  const {inviteId} = await invite(owner, workspaceId, testEmailFor(invitee), "viewer");
  const token = await issueTestInviteToken(workspaceId, inviteId);

  // A conta nasce depois do convite.
  await call(bootstrapAccount, invitee, {});
  const result = await call<{workspaceId: string; role: string}>(
    acceptWorkspaceInvite,
    invitee,
    {token},
  );
  assert.equal(result.workspaceId, workspaceId);
  assert.equal(result.role, "viewer");

  const member = await memberOf(workspaceId, invitee);
  assert.equal(member?.uid, invitee);
  assert.equal(member?.role, "viewer");
  assert.equal(member?.status, "active");
  assert.equal(member?.invitedBy, owner);
  assert.equal((await indexOf(invitee, workspaceId))?.status, "active");
  const doc = (await db().doc(`workspaces/${workspaceId}/invites/${inviteId}`)
    .get()).data();
  assert.equal(doc?.status, "accepted");
  assert.equal(doc?.acceptedBy, invitee);
  assert.equal(
    (await membershipEvents(workspaceId, "invite.accepted")).length,
    1,
  );

  // Reuso pela mesma pessoa: replay, sem novo evento.
  const replay = await call<{replay: boolean}>(acceptWorkspaceInvite, invitee, {
    token,
  });
  assert.equal(replay.replay, true);
  assert.equal(
    (await membershipEvents(workspaceId, "invite.accepted")).length,
    1,
  );
});

test("aceite: mesma resposta genérica para inválido, expirado, revogado, outro e-mail", async () => {
  const {workspaceId, owner} = await team();
  const invitee = await account("invitee");
  const stranger = await account("stranger");

  await unavailable(call(acceptWorkspaceInvite, invitee, {
    token: generateInviteToken(),
  }));

  const other = await invite(owner, workspaceId, testEmailFor(invitee));
  const otherToken = await issueTestInviteToken(workspaceId, other.inviteId);
  await unavailable(call(acceptWorkspaceInvite, stranger, {token: otherToken}));

  const expired = await invite(owner, workspaceId, testEmailFor(stranger));
  const expiredToken = await issueTestInviteToken(workspaceId, expired.inviteId);
  await db().doc(`workspaces/${workspaceId}/invites/${expired.inviteId}`)
    .update({expiresAt: Timestamp.fromMillis(Date.now() - 1000)});
  await unavailable(
    call(acceptWorkspaceInvite, stranger, {token: expiredToken}),
  );

  const revoked = await invite(owner, workspaceId, testEmailFor(stranger));
  const revokedToken = await issueTestInviteToken(workspaceId, revoked.inviteId);
  await call(revokeWorkspaceInvite, owner, {workspaceId, inviteId: revoked.inviteId});
  await unavailable(
    call(acceptWorkspaceInvite, stranger, {token: revokedToken}),
  );

  // Token malformado não chega ao domínio.
  await expectHttpsError(
    call(acceptWorkspaceInvite, invitee, {token: "curto"}),
    "invalid-argument",
  );
  assert.equal(await memberOf(workspaceId, stranger), undefined);
});

test("aceite exige e-mail verificado", async () => {
  const {workspaceId, owner} = await team();
  const invitee = await account("unverified");
  const {inviteId} = await invite(owner, workspaceId, testEmailFor(invitee));
  const token = await issueTestInviteToken(workspaceId, inviteId);
  await expectHttpsError(
    call(acceptWorkspaceInvite, invitee, {token}, {email_verified: false}),
    "permission-denied",
    {reason: "email_not_verified"},
  );
  assert.equal(await memberOf(workspaceId, invitee), undefined);
});

test("aceite concorrente: um único membership e um único evento", async () => {
  const {workspaceId, owner} = await team();
  const invitee = await account("racer");
  const {inviteId} = await invite(owner, workspaceId, testEmailFor(invitee), "member");
  const token = await issueTestInviteToken(workspaceId, inviteId);
  const results = await Promise.all(Array.from({length: 4}, () =>
    call<{replay: boolean}>(acceptWorkspaceInvite, invitee, {token})));
  assert.equal(results.filter((result) => !result.replay).length, 1);
  assert.equal((await memberOf(workspaceId, invitee))?.status, "active");
  assert.equal(
    (await membershipEvents(workspaceId, "invite.accepted")).length,
    1,
  );
});

test("novo convite substitui o pendente; token antigo deixa de valer", async () => {
  const {workspaceId, owner} = await team();
  const invitee = await account("replaced");
  const first = await invite(owner, workspaceId, testEmailFor(invitee));
  const firstToken = await issueTestInviteToken(workspaceId, first.inviteId);
  const second = await invite(owner, workspaceId, testEmailFor(invitee), "viewer");
  const secondToken = await issueTestInviteToken(workspaceId, second.inviteId);
  await unavailable(call(acceptWorkspaceInvite, invitee, {token: firstToken}));
  const accepted = await call<{role: string}>(acceptWorkspaceInvite, invitee, {
    token: secondToken,
  });
  assert.equal(accepted.role, "viewer");
});

test("membro removido volta só por novo convite, que o reativa", async () => {
  const {workspaceId, owner} = await team();
  const invitee = await account("returning");
  const first = await invite(owner, workspaceId, testEmailFor(invitee), "member");
  const token = await issueTestInviteToken(workspaceId, first.inviteId);
  await call(acceptWorkspaceInvite, invitee, {token});
  await call(removeWorkspaceMember, owner, {workspaceId, memberId: invitee});
  assert.equal((await memberOf(workspaceId, invitee))?.status, "removed");

  // O token antigo não readmite.
  await unavailable(call(acceptWorkspaceInvite, invitee, {token}));

  const second = await invite(owner, workspaceId, testEmailFor(invitee), "viewer");
  const secondToken = await issueTestInviteToken(workspaceId, second.inviteId);
  await call(acceptWorkspaceInvite, invitee, {token: secondToken});
  const member = await memberOf(workspaceId, invitee);
  assert.equal(member?.status, "active");
  assert.equal(member?.role, "viewer");
  assert.equal(member?.removedAt, null);
  assert.equal((await indexOf(invitee, workspaceId))?.status, "active");
});

test("convidar quem já é membro ativo é recusado", async () => {
  const {workspaceId, owner, member} = await team();
  await expectHttpsError(
    invite(owner, workspaceId, testEmailFor(member)),
    "failed-precondition",
  );
});

test("revogação: matriz, idempotência e convite aceito", async () => {
  const {workspaceId, owner, admin, member} = await team();
  const adminInvite = await invite(owner, workspaceId, `${uniqueId("a")}@x.test`, "admin");
  await expectHttpsError(
    call(revokeWorkspaceInvite, admin, {workspaceId, inviteId: adminInvite.inviteId}),
    "permission-denied",
  );
  await expectHttpsError(
    call(revokeWorkspaceInvite, member, {workspaceId, inviteId: adminInvite.inviteId}),
    "permission-denied",
  );
  const memberInvite = await invite(owner, workspaceId, `${uniqueId("m")}@x.test`);
  await call(revokeWorkspaceInvite, admin, {
    workspaceId,
    inviteId: memberInvite.inviteId,
  });
  const repeated = await call<{changed: boolean}>(revokeWorkspaceInvite, admin, {
    workspaceId,
    inviteId: memberInvite.inviteId,
  });
  assert.equal(repeated.changed, false);
  assert.equal(
    (await membershipEvents(workspaceId, "invite.revoked")).length,
    1,
  );

  const invitee = await account("accepted");
  const accepted = await invite(owner, workspaceId, testEmailFor(invitee));
  await call(acceptWorkspaceInvite, invitee, {
    token: await issueTestInviteToken(workspaceId, accepted.inviteId),
  });
  await expectHttpsError(
    call(revokeWorkspaceInvite, owner, {workspaceId, inviteId: accepted.inviteId}),
    "failed-precondition",
  );
});

test("tentativas de aceite consomem o limite mesmo quando falham", async () => {
  const guesser = await account("guesser");
  for (let attempt = 0; attempt < ACCEPT_RATE_LIMIT.limit; attempt += 1) {
    await unavailable(call(acceptWorkspaceInvite, guesser, {
      token: generateInviteToken(),
    }));
  }
  const counter = await db()
    .doc(`users/${guesser}/rate_limits/acceptWorkspaceInvite_${guesser}`).get();
  assert.equal(counter.get("count"), ACCEPT_RATE_LIMIT.limit);
  await expectHttpsError(
    call(acceptWorkspaceInvite, guesser, {token: generateInviteToken()}),
    "failed-precondition",
    {message: /Muitas solicitações/},
  );
});

test("o token nunca aparece em log, auditoria nem resposta", async () => {
  const {workspaceId, owner} = await team();
  const invitee = await account("logged");
  const {inviteId} = await invite(owner, workspaceId, testEmailFor(invitee));
  const token = await issueTestInviteToken(workspaceId, inviteId);
  const captured: string[] = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const capture = (chunk: unknown): boolean => {
    captured.push(String(chunk));
    return true;
  };
  process.stdout.write = capture as typeof process.stdout.write;
  process.stderr.write = capture as typeof process.stderr.write;
  let response: unknown;
  try {
    response = await call(acceptWorkspaceInvite, invitee, {token});
    await unavailable(call(acceptWorkspaceInvite, invitee, {
      token: generateInviteToken(),
    }));
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
  const logs = captured.join("");
  assert.ok(
    logs.includes("acceptWorkspaceInvite"),
    "o log estruturado foi emitido",
  );
  assert.equal(logs.includes(token), false);
  assert.equal(logs.includes(hashInviteToken(token)), false);
  assert.equal(
    logs.includes(testEmailFor(invitee)),
    false,
    "sem e-mail completo",
  );
  assert.equal(JSON.stringify(response).includes(token), false);
  const events = await membershipEvents(workspaceId);
  assert.equal(JSON.stringify(events).includes(token), false);
});
