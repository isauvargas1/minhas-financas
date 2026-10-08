import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {
  updateCashTransaction,
  voidCashTransaction,
} from "../../cash/callables";
import {formatIsoInstant} from "../../shared/commitTime";
import {rateLimitDocumentId} from "../../shared/rateLimit";
import {
  defaultAccountOf,
  seedActiveAccount,
  seedMember,
} from "../../shared/testSupport/kernelTestSupport";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  INCONSISTENT_LOAN_MESSAGE,
  LOAN_IDEMPOTENCY_CONFLICT_MESSAGE,
  LOAN_METADATA_UNCHANGED_MESSAGE,
  LOAN_MUTATION_RATE_LIMIT,
  MEMBER_LOAN_OWNERSHIP_MESSAGE,
} from "../operations";
import {runLoanStatusRefresh} from "../statusRefresh";
import {
  cancel,
  cancelPayload,
  countOf,
  create,
  createPayload,
  loanEvents,
  loanRef,
  metadataPayload,
  pay,
  payPayload,
  readLoan,
  readMirror,
  reverse,
  reversePayload,
  seedLoanTenant,
  shiftDays,
  today,
  updateMetadata,
} from "../testSupport/loanTestSupport";

/**
 * P3-G/P3-H — autorização, isolamento, idempotência (inclusive metadados),
 * limite operacional, falha fechada fora do schema e
 * atraso diário do domínio de empréstimos.
 */
db();

test("P3-G — RBAC: viewer só lê; member administra só o que criou; owner e " +
  "admin administram tudo", async () => {
  const tenant = await seedLoanTenant("PF", "rbac");
  await expectHttpsError(create(tenant.viewer,
    createPayload(tenant.workspaceId)), "permission-denied");
  const own = await create(tenant.member, createPayload(tenant.workspaceId));
  const version = await readLoan(tenant.workspaceId, own.loanId);

  // Outro member: nenhuma operação sobre o contrato alheio.
  for (const attempt of [
    async () => pay(tenant.otherMember,
      await payPayload(tenant.workspaceId, own.loanId)),
    async () => cancel(tenant.otherMember,
      await cancelPayload(tenant.workspaceId, own.loanId)),
    async () => updateMetadata(tenant.otherMember, await metadataPayload(
      tenant.workspaceId, own.loanId, {description: "Alterado por outro"})),
  ]) {
    await expectHttpsError(attempt(), "permission-denied",
      {message: MEMBER_LOAN_OWNERSHIP_MESSAGE});
  }
  await expectHttpsError(pay(tenant.viewer,
    await payPayload(tenant.workspaceId, own.loanId)), "permission-denied");
  const untouched = await readLoan(tenant.workspaceId, own.loanId);
  assert.deepEqual(untouched.updatedAt, version.updatedAt);

  // O próprio member, o admin e o owner administram.
  const memberPaid = await pay(tenant.member,
    await payPayload(tenant.workspaceId, own.loanId));
  assert.equal(memberPaid.balanceCents, 200_000);
  const adminPaid = await pay(tenant.admin,
    await payPayload(tenant.workspaceId, own.loanId));
  assert.equal(adminPaid.balanceCents, 100_000);
  const ownerReversed = await reverse(tenant.owner, await reversePayload(
    tenant.workspaceId, own.loanId, adminPaid.movementId as string));
  assert.equal(ownerReversed.balanceCents, 200_000);
  const roles = (await loanEvents(tenant.workspaceId))
    .map((event) => event.actorRole).sort();
  assert.deepEqual(roles, ["admin", "member", "member", "owner"]);

  // `createdBy` nunca vem do cliente: o contrato do member é do member.
  assert.equal(untouched.createdBy, tenant.member);
});

test("P3-G — nenhum tenant opera o empréstimo do outro, nos dois " +
  "sentidos", async () => {
  const a = await seedLoanTenant("PF", "xa");
  const b = await seedLoanTenant("PF", "xb");
  const loanA = await create(a.owner, createPayload(a.workspaceId));
  const loanB = await create(b.owner, createPayload(b.workspaceId));
  for (const [attacker, victim, victimLoan] of [
    [a, b, loanB.loanId], [b, a, loanA.loanId],
  ] as const) {
    const before = await readLoan(victim.workspaceId, victimLoan);
    // Pelo workspace da vítima: não é membro.
    await expectHttpsError(pay(attacker.owner,
      await payPayload(victim.workspaceId, victimLoan)), "permission-denied");
    // Pelo próprio workspace com o ID alheio: o contrato não existe ali.
    await expectHttpsError(pay(attacker.owner, {
      ...(await payPayload(victim.workspaceId, victimLoan)),
      workspaceId: attacker.workspaceId,
    }), "not-found");
    await expectHttpsError(updateMetadata(attacker.owner, {
      ...(await metadataPayload(victim.workspaceId, victimLoan,
        {description: "Invasão"})),
      workspaceId: attacker.workspaceId,
    }), "not-found");
    assert.deepEqual(await readLoan(victim.workspaceId, victimLoan), before);
  }
  assert.equal((await loanEvents(a.workspaceId)).length, 1);
  assert.equal((await loanEvents(b.workspaceId)).length, 1);
});

test("P3-G — conta suspensa, workspace arquivado e membership removido são " +
  "recusados", async () => {
  const tenant = await seedLoanTenant("PF", "lock");
  const loan = await create(tenant.member, createPayload(tenant.workspaceId));
  const payload = await payPayload(tenant.workspaceId, loan.loanId);

  await seedActiveAccount(tenant.member, {status: "suspended"});
  await expectHttpsError(pay(tenant.member, payload), "permission-denied");
  await seedActiveAccount(tenant.member);

  await seedMember(tenant.workspaceId, tenant.member, "member", "removed");
  await expectHttpsError(pay(tenant.member, payload), "permission-denied");
  await expectHttpsError(create(tenant.member,
    createPayload(tenant.workspaceId)), "permission-denied");
  await seedMember(tenant.workspaceId, tenant.member, "member");

  await db().doc(`workspaces/${tenant.workspaceId}`)
    .update({status: "archived"});
  await expectHttpsError(pay(tenant.owner, await payPayload(tenant.workspaceId,
    loan.loanId)), "failed-precondition");
  await expectHttpsError(create(tenant.owner,
    createPayload(tenant.workspaceId)), "failed-precondition");
  await db().doc(`workspaces/${tenant.workspaceId}`).update({status: "active"});

  const fresh = await readLoan(tenant.workspaceId, loan.loanId);
  assert.equal(fresh.balanceCents, 300_000);
  assert.equal(await countOf(tenant.workspaceId, "loan_movements"), 1);
});

test("P3-G — idempotência: replay, conflito da mesma chave e âncora durável " +
  "depois da expiração", async () => {
  const tenant = await seedLoanTenant("PF", "idem");
  const payload = createPayload(tenant.workspaceId);
  const first = await create(tenant.owner, payload);
  const replay = await create(tenant.owner, payload);
  assert.equal(replay.replayed, true);
  assert.equal(replay.loanId, first.loanId);
  await expectHttpsError(create(tenant.owner, {...payload,
    principalCents: 300_001}), "failed-precondition",
  {message: LOAN_IDEMPOTENCY_CONFLICT_MESSAGE});
  assert.equal(await countOf(tenant.workspaceId, "loans"), 1);

  const other = await create(tenant.owner, createPayload(tenant.workspaceId));
  const paymentPayload = await payPayload(tenant.workspaceId, first.loanId);
  const paid = await pay(tenant.owner, paymentPayload);
  const paidReplay = await pay(tenant.owner, paymentPayload);
  assert.equal(paidReplay.replayed, true);
  assert.equal(paidReplay.movementId, paid.movementId);
  await expectHttpsError(pay(tenant.owner, {...paymentPayload,
    principalCents: 1}), "failed-precondition",
  {message: LOAN_IDEMPOTENCY_CONFLICT_MESSAGE});

  // Expiração da chave do ator (TTL): a trilha da intenção decide.
  const keys = await db().collection(`users/${tenant.owner}/idempotency_keys`)
    .get();
  await Promise.all(keys.docs.map((doc) => doc.ref.delete()));
  const afterExpiry = await pay(tenant.owner, paymentPayload);
  assert.equal(afterExpiry.replayed, true);
  assert.equal(afterExpiry.movementId, paid.movementId);
  // A mesma chave em outro contrato continua conflito, nunca segundo efeito.
  await expectHttpsError(pay(tenant.owner, {
    ...(await payPayload(tenant.workspaceId, other.loanId)),
    idempotencyKey: paymentPayload.idempotencyKey,
  }), "failed-precondition", {message: LOAN_IDEMPOTENCY_CONFLICT_MESSAGE});
  const recreated = await create(tenant.owner, payload);
  assert.equal(recreated.replayed, true, "criação: âncora no próprio contrato");
  assert.equal((await readLoan(tenant.workspaceId, first.loanId)).balanceCents,
    200_000);
  assert.equal((await readLoan(tenant.workspaceId, other.loanId)).balanceCents,
    300_000);

  // Mesma intenção concorrente: um único efeito.
  const concurrent = createPayload(tenant.workspaceId);
  const outcomes = await Promise.allSettled(Array.from({length: 4}, () =>
    create(tenant.member, concurrent)));
  const fulfilled = outcomes.filter((o) => o.status === "fulfilled") as
    PromiseFulfilledResult<{loanId: string; replayed: boolean}>[];
  assert.ok(fulfilled.length >= 1);
  assert.equal(new Set(fulfilled.map((o) => o.value.loanId)).size, 1);
  assert.equal(fulfilled.filter((o) => !o.value.replayed).length, 1);
  assert.equal(await countOf(tenant.workspaceId, "loans"), 3);
  assert.equal(await countOf(tenant.workspaceId, "transactions"), 4);
});

test("P3-G — limite operacional: recusa sem gravar; replay não " +
  "consome", async () => {
  const tenant = await seedLoanTenant("PF", "rate");
  const payload = createPayload(tenant.workspaceId);
  const loan = await create(tenant.owner, payload);
  const counter = db().doc(`workspaces/${tenant.workspaceId}/rate_limits/` +
    rateLimitDocumentId(LOAN_MUTATION_RATE_LIMIT, tenant.owner));
  const stored = (await counter.get()).data();
  assert.equal(stored?.count, 1);
  await counter.update({count: LOAN_MUTATION_RATE_LIMIT.limit});
  const error = await expectHttpsError(pay(tenant.owner,
    await payPayload(tenant.workspaceId, loan.loanId)), "failed-precondition",
  {message: /Muitas solicitações/});
  assert.ok(Number((error.details as Record<string, unknown>)
    ?.retryAfterSeconds) > 0);
  assert.equal((await readLoan(tenant.workspaceId, loan.loanId)).balanceCents,
    300_000);
  assert.equal(await countOf(tenant.workspaceId, "loan_movements"), 1);
  // Replay da criação passa: não é barrado nem consome.
  const replay = await create(tenant.owner, payload);
  assert.equal(replay.replayed, true);
  assert.equal((await counter.get()).get("count"),
    LOAN_MUTATION_RATE_LIMIT.limit);
});

test("P3-G — o espelho do empréstimo não é corrigido nem anulado pelo caixa " +
  "manual", async () => {
  const tenant = await seedLoanTenant("PF", "mirror");
  const loan = await create(tenant.owner, createPayload(tenant.workspaceId));
  const mirror = await readMirror(tenant.workspaceId, loan.cashTransactionId);
  const version = formatIsoInstant(mirror.updatedAt as Timestamp);
  await expectHttpsError(call(updateCashTransaction, tenant.owner, {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId: loan.cashTransactionId,
    expectedUpdatedAt: version,
    reason: "Tentativa pelo caixa manual",
    entry: {type: "receita", description: "Outro", category: "Outros",
      amountCents: 1, date: today(),
      cashAccountId: defaultAccountOf(tenant.workspaceId)},
  }), "failed-precondition");
  await expectHttpsError(call(voidCashTransaction, tenant.owner, {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId: loan.cashTransactionId,
    expectedUpdatedAt: version,
    reason: "Tentativa pelo caixa manual",
  }), "failed-precondition");
  const after = await readMirror(tenant.workspaceId, loan.cashTransactionId);
  assert.equal(after.valueCents, 300_000);
  assert.equal(after.voidedAt, undefined);
});

test("P3-H — fora do schema autoritativo: falha fechada, mesmo para o " +
  "owner, sem alterar nada", async () => {
  const tenant = await seedLoanTenant("PF", "schema");
  const created = await create(tenant.owner,
    createPayload(tenant.workspaceId));
  const loans = db().collection(`workspaces/${tenant.workspaceId}/loans`);
  // Sem a marca (só o Admin SDK grava aqui) e com a invariante quebrada.
  await loans.doc("sem-marca").set({type: "borrow", personName: "Fulano",
    principalCents: 1_000, balanceCents: 1_000, status: "active",
    updatedAt: Timestamp.now()});
  const broken = await readLoan(tenant.workspaceId, created.loanId);
  await loans.doc("invariante").set({...broken, id: "invariante",
    balanceCents: broken.balanceCents - 1});
  const snapshots = Object.fromEntries(await Promise.all(
    ["sem-marca", "invariante"].map(async (id) =>
      [id, (await loanRef(tenant.workspaceId, id).get()).data()])));

  for (const loanId of ["sem-marca", "invariante"]) {
    for (const uid of [tenant.owner, tenant.admin]) {
      const version = formatIsoInstant(
        (await loanRef(tenant.workspaceId, loanId).get()).get("updatedAt"));
      const error = await expectHttpsError(pay(uid, {
        workspaceId: tenant.workspaceId,
        idempotencyKey: idempotencyKey(),
        loanId,
        expectedUpdatedAt: version,
        cashAccountId: defaultAccountOf(tenant.workspaceId),
        date: today(),
        principalCents: 100,
        interestCents: 0,
      }), "failed-precondition", {message: INCONSISTENT_LOAN_MESSAGE});
      assert.equal((error.details as Record<string, unknown>)?.ineligible,
        "inconsistent");
    }
    assert.deepEqual((await loanRef(tenant.workspaceId, loanId).get()).data(),
      snapshots[loanId]);
  }
  assert.equal(await countOf(tenant.workspaceId, "loan_movements"), 1);
});

test("P3-H — metadados: replay antes e depois da expiração, mesma chave em " +
  "outro contrato, contrato alterado entre tentativas, sem efeito e " +
  "concorrência", async () => {
  const tenant = await seedLoanTenant("PJ", "meta-idem");
  const first = await create(tenant.member, createPayload(tenant.workspaceId));
  const second = await create(tenant.member, createPayload(tenant.workspaceId));
  const metadataEvents = async () => (await loanEvents(tenant.workspaceId))
    .filter((event) => event.operation === "loan.metadata_updated");
  const expireKeys = async () => {
    const keys = await db()
      .collection(`users/${tenant.member}/idempotency_keys`).get();
    await Promise.all(keys.docs.map((doc) => doc.ref.delete()));
  };

  const intent = await metadataPayload(tenant.workspaceId, first.loanId,
    {costCenter: "Matriz", description: "Giro renegociado"});
  const applied = await updateMetadata(tenant.member, intent);
  assert.deepEqual(applied, {loanId: first.loanId, changed: true,
    replayed: false});

  // Antes da expiração: o recibo devolve o mesmo resultado, sem escrita; a
  // mesma chave em outro contrato é conflito pelo recibo.
  assert.deepEqual(await updateMetadata(tenant.member, intent),
    {loanId: first.loanId, changed: true, replayed: true});
  const elsewhere = {
    ...(await metadataPayload(tenant.workspaceId, second.loanId,
      {costCenter: "Matriz", description: "Giro renegociado"})),
    idempotencyKey: intent.idempotencyKey,
  };
  await expectHttpsError(updateMetadata(tenant.member, elsewhere),
    "failed-precondition", {message: LOAN_IDEMPOTENCY_CONFLICT_MESSAGE});

  // O contrato muda entre as tentativas (liquidação): o replay continua
  // replay, não conflito de versão nem segunda alteração.
  await pay(tenant.member, await payPayload(tenant.workspaceId, first.loanId));
  await updateMetadata(tenant.member, await metadataPayload(tenant.workspaceId,
    first.loanId, {costCenter: "Filial"}));
  assert.equal((await updateMetadata(tenant.member, intent)).replayed, true);

  // Depois da expiração: a âncora durável (evento só com nomes de campos)
  // decide. Mesmo resultado; o valor posterior ("Filial") não é desfeito.
  await expireKeys();
  assert.deepEqual(await updateMetadata(tenant.member, intent),
    {loanId: first.loanId, changed: true, replayed: true});
  assert.equal((await readLoan(tenant.workspaceId, first.loanId)).costCenter,
    "Filial");

  // Mesma chave em outro contrato depois da expiração: a âncora decide —
  // conflito, nunca segundo efeito.
  await expectHttpsError(updateMetadata(tenant.member, elsewhere),
    "failed-precondition", {message: LOAN_IDEMPOTENCY_CONFLICT_MESSAGE});
  assert.equal((await readLoan(tenant.workspaceId, second.loanId)).costCenter,
    undefined);

  const events = await metadataEvents();
  assert.equal(events.length, 2, "uma por alteração efetiva");
  for (const event of events) {
    assert.equal(JSON.stringify(event).includes("Giro renegociado"), false);
    assert.equal(JSON.stringify(event).includes("Matriz"), false);
  }

  // Sem efeito: recusa sem recibo, sem evento e sem nova versão; repetir
  // (antes ou depois de qualquer expiração) recusa de novo.
  const versionBefore = (await readLoan(tenant.workspaceId, first.loanId))
    .updatedAt;
  const noop = await metadataPayload(tenant.workspaceId, first.loanId,
    {costCenter: "Filial"});
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await expectHttpsError(updateMetadata(tenant.member, noop),
      "failed-precondition", {message: LOAN_METADATA_UNCHANGED_MESSAGE});
    await expireKeys();
  }
  assert.deepEqual((await readLoan(tenant.workspaceId, first.loanId))
    .updatedAt, versionBefore);
  assert.equal((await db().collection(`users/${tenant.member}/idempotency_keys`)
    .get()).size, 0);
  assert.equal((await metadataEvents()).length, 2);

  // Concorrência da mesma intenção: um único efeito e um único evento.
  const concurrent = await metadataPayload(tenant.workspaceId, second.loanId,
    {classification: "capital_giro"});
  const outcomes = await Promise.allSettled(Array.from({length: 4}, () =>
    updateMetadata(tenant.member, concurrent)));
  const fulfilled = outcomes.filter((o) => o.status === "fulfilled") as
    PromiseFulfilledResult<{changed?: boolean; replayed: boolean}>[];
  assert.ok(fulfilled.length >= 1);
  assert.equal(fulfilled.filter((o) => !o.value.replayed).length, 1);
  assert.ok(fulfilled.every((o) => o.value.changed === true));
  assert.equal((await metadataEvents())
    .filter((event) => event.loanId === second.loanId).length, 1);
});

test("P3-G — atraso: derivado na operação e marcado pela rotina diária, " +
  "idempotente", async () => {
  const tenant = await seedLoanTenant("PF", "late");
  // Primeira parcela vencida há 10 dias; a segunda vence daqui a ~20.
  const late = await create(tenant.owner, createPayload(tenant.workspaceId, {
    startDate: shiftDays(today(), -40),
    firstDueDate: shiftDays(today(), -10),
  }));
  assert.equal((await readLoan(tenant.workspaceId, late.loanId)).status,
    "overdue");
  // Pagar a parcela vencida tira do atraso.
  const cured = await pay(tenant.owner, await payPayload(tenant.workspaceId,
    late.loanId, {principalCents: 100_000, interestCents: 0}));
  assert.equal(cured.status, "active");

  const dueToday = await create(tenant.owner,
    createPayload(tenant.workspaceId, {firstDueDate: today()}));
  const fresh = await readLoan(tenant.workspaceId, dueToday.loanId);
  assert.equal(fresh.status, "active");
  assert.equal(fresh.overdueFrom, shiftDays(today(), 1));

  const tomorrow = shiftDays(today(), 1);
  const first = await runLoanStatusRefresh({today: tomorrow, pageSize: 2});
  assert.ok(first.updated >= 1);
  const marked = await readLoan(tenant.workspaceId, dueToday.loanId);
  assert.equal(marked.status, "overdue");
  assert.equal(marked.updatedBy, "system:loan-status");
  const refreshEvents = (await loanEvents(tenant.workspaceId))
    .filter((event) => event.operation === "loan.status_refreshed");
  assert.equal(refreshEvents.length, 1);
  assert.equal(refreshEvents[0].after.status, "overdue");
  // O contrato curado ainda está em dia amanhã (próxima parcela no mês que
  // vem): a rotina não o tocou.
  assert.equal((await readLoan(tenant.workspaceId, late.loanId)).status,
    "active");

  // Segunda execução no mesmo dia: nada a gravar para este contrato.
  await runLoanStatusRefresh({today: tomorrow});
  const again = await readLoan(tenant.workspaceId, dueToday.loanId);
  assert.equal(again.revision, marked.revision);
  assert.equal((await loanEvents(tenant.workspaceId))
    .filter((event) => event.operation === "loan.status_refreshed").length, 1);
});
