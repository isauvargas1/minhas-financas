import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import test from "node:test";

import {Timestamp} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

import {
  seedLoanTenant,
  type LoanTenant,
} from "../../loans/testSupport/loanTestSupport";
import {
  seedActiveAccount,
  seedMember,
} from "../../shared/testSupport/kernelTestSupport";
import {
  call,
  db,
  expectHttpsError,
} from "../../workspaces/testSupport/p1TestSupport";
import {buildNotificationDocument} from "../builder";
import {publishNotification} from "../publish";
import {
  NOTIFICATION_UNREAD_COUNT_RATE_LIMIT,
  UNREAD_COUNT_UNAVAILABLE_MESSAGE,
  getNotificationUnreadCount,
  type NotificationUnreadCount,
} from "../unreadCount";
import {
  APPROVED_RETENTION_MS,
  DAY_MS,
  EVENT_TYPE_CYCLE,
  eventDocumentFor,
  expectedUnread,
  fixtureExpiresAtMs,
  notificationRef,
  rateLimitRef,
  seedFixtures,
  sleep,
  stateDocumentFor,
  stateRef,
  type Fixture,
  type Mark,
} from "../testSupport/notificationTestSupport";

/**
 * P5-D2 (PR-NOTIF-01) — contagem exata de não lidas, contra o Emulator.
 *
 * ORÁCULO INDEPENDENTE. Cada cenário define fixtures em JS (eventos com a
 * data de criação e as marcas por usuário) e o esperado sai de um filtro
 * simples sobre ELAS (`expectedUnread`) ou de uma constante escrita à mão.
 * Nenhum teste relê o Firestore para calcular o esperado, e nenhum usa a
 * fórmula de produção (contagem de eventos menos contagem de estados).
 *
 * Os eventos são gravados pelo builder real e os estados respeitam o
 * contrato (mesmo `expiresAt` do evento e ao menos uma marca), exceto nos
 * cenários que violam o invariante de propósito.
 *
 * SEMÂNTICA DO INSTANTE. A callable relê o ator e lê as duas agregações
 * numa única transação somente leitura; o instante é o `readTime` do
 * próprio banco (devolvido em `asOf`). Toda escrita confirmada antes da
 * chamada já está nele: nenhum teste espera entre semear e contar, e os
 * testes 9, 9b e 9c cobram isso (evento publicado, marca recém-gravada e
 * workspace/membership recém-criados aparecem na chamada seguinte).
 *
 * LIMITAÇÕES DO EMULATOR. O Emulator não executa a política de TTL (a
 * remoção física é simulada apagando documentos), não exige índices de
 * consulta (o teste 30 verifica a declaração estaticamente) e não mede
 * custo de leitura (o teste 31 documenta o custo e exercita o limite).
 */

db();

const callCount = (uid: string | null, workspaceId: string) =>
  call<NotificationUnreadCount>(getNotificationUnreadCount, uid,
    {workspaceId});

const live = (
  index: number,
  marks: Fixture["marks"] = {},
  prefix = "ev",
): Fixture => ({
  id: `${prefix}-${String(index).padStart(5, "0")}`,
  // Pelo menos 1 min no passado e a dezenas de dias de expirar.
  createdAtMs: Date.now() - (index % 60) * DAY_MS - 60_000,
  marks,
});

const expired = (
  index: number,
  marks: Fixture["marks"] = {},
  extra: Partial<Fixture> = {},
  prefix = "old",
): Fixture => ({
  id: `${prefix}-${String(index).padStart(5, "0")}`,
  // Criado há 181 dias e mais: `expiresAt` venceu há 1 dia ou mais.
  createdAtMs: Date.now() - APPROVED_RETENTION_MS - DAY_MS -
    index * 3_600_000,
  marks,
  ...extra,
});

const lives = (count: number, marks?: (i: number) => Fixture["marks"]) =>
  Array.from({length: count}, (_, i) => live(i, marks ? marks(i) : {}));

/** Confere resultado e metadados da resposta; devolve o resultado. */
const assertCount = async (
  uid: string,
  workspaceId: string,
  fixtures: Fixture[],
  label = uid,
): Promise<NotificationUnreadCount> => {
  const before = Date.now();
  const result = await callCount(uid, workspaceId);
  const expected = expectedUnread(fixtures, uid, Date.now());
  assert.equal(result.unreadCount, expected, `${label}: total não lido`);
  assert.ok(Number.isSafeInteger(result.unreadCount) &&
    result.unreadCount >= 0, `${label}: inteiro não negativo`);
  assertAsOf(result, before);
  return result;
};

const assertAsOf = (result: NotificationUnreadCount, callStartMs: number) => {
  assert.deepEqual(Object.keys(result).sort(), ["asOf", "unreadCount"],
    "resposta só com total e instante");
  assert.match(result.asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/,
    "asOf é RFC 3339 com nanossegundos (instante exato do banco)");
  const asOfMs = Date.parse(result.asOf);
  assert.ok(asOfMs <= Date.now(), "asOf não está no futuro");
  // Mesmo relógio (Emulator local): o instante do banco não é anterior ao
  // início da chamada além de uma folga de relógio.
  assert.ok(asOfMs >= callStartMs - 1_000, "asOf é recente");
};

const tenantFor = (prefix: string): Promise<LoanTenant> =>
  seedLoanTenant("PF", prefix);

const httpsCodeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    assert.ok(error instanceof HttpsError, String(error));
    return error.code;
  }
};

const removeEventDoc = (workspaceId: string, id: string) =>
  notificationRef(workspaceId, id).delete();

/** Marca lida/arquivada/excluída para o usuário, como o cliente grava. */
const markState = async (
  workspaceId: string,
  uid: string,
  fixture: Fixture,
  marks: Mark[],
) => {
  const expiresAt = (await notificationRef(workspaceId, fixture.id).get())
    .get("expiresAt");
  await stateRef(workspaceId, uid, fixture.id)
    .set(stateDocumentFor(marks, expiresAt), {merge: true});
  fixture.marks[uid] = [...new Set([...(fixture.marks[uid] ?? []), ...marks])];
};

// ------------------------------------------------------------------ 1–9

test("§17.1 nenhuma notificação: zero verdadeiro para todos os papéis",
  async () => {
    const t = await tenantFor("uc01");
    for (const uid of [t.owner, t.admin, t.member, t.viewer]) {
      const result = await assertCount(uid, t.workspaceId, []);
      assert.equal(result.unreadCount, 0);
    }
  });

test("§17.2 uma notificação não lida conta 1", async () => {
  const t = await tenantFor("uc02");
  const fixtures = [live(1)];
  await seedFixtures(t.workspaceId, fixtures);
  const result = await assertCount(t.member, t.workspaceId, fixtures);
  assert.equal(result.unreadCount, 1);
});

test("§17.3 uma notificação lida deixa de contar, só para quem leu",
  async () => {
    const t = await tenantFor("uc03");
    const fixtures = [live(1, {[t.owner]: ["read"]})];
    await seedFixtures(t.workspaceId, fixtures);
    assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
      .unreadCount, 0);
    assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
      .unreadCount, 1);
  });

test("§17.4 uma notificação arquivada deixa de contar", async () => {
  const t = await tenantFor("uc04");
  const fixtures = [live(1, {[t.owner]: ["dismissed"]}), live(2)];
  await seedFixtures(t.workspaceId, fixtures);
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 1);
});

test("§17.5 uma notificação excluída para si deixa de contar", async () => {
  const t = await tenantFor("uc05");
  const fixtures = [live(1, {[t.member]: ["deleted"]}), live(2)];
  await seedFixtures(t.workspaceId, fixtures);
  assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
    .unreadCount, 1);
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 2, "a exclusão é individual");
});

test("§17.6 vários estados sobre o mesmo evento: lida, arquivada e " +
  "excluída juntas contam como um único evento fora das não lidas",
async () => {
  const t = await tenantFor("uc06");
  const fixtures = [
    live(1, {[t.owner]: ["read", "dismissed", "deleted"],
      [t.admin]: ["read"], [t.member]: ["dismissed", "deleted"]}),
    live(2, {[t.owner]: ["read"]}),
    live(3),
  ];
  await seedFixtures(t.workspaceId, fixtures);
  // Constantes à mão: owner 1 (só o 3), admin 2, member 2, viewer 3.
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 1);
  assert.equal((await assertCount(t.admin, t.workspaceId, fixtures))
    .unreadCount, 2);
  assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
    .unreadCount, 2);
  assert.equal((await assertCount(t.viewer, t.workspaceId, fixtures))
    .unreadCount, 3);
});

test("§17.7 dois usuários com leituras diferentes: cada um vê o próprio " +
  "total e a marca de um não altera o outro", async () => {
  const t = await tenantFor("uc07");
  const fixtures = lives(10, (i) => ({
    ...(i < 3 ? {[t.owner]: ["read"] as Mark[]} : {}),
    ...(i >= 3 ? {[t.admin]: ["dismissed"] as Mark[]} : {}),
  }));
  await seedFixtures(t.workspaceId, fixtures);
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 7);
  assert.equal((await assertCount(t.admin, t.workspaceId, fixtures))
    .unreadCount, 3);
  assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
    .unreadCount, 10);
});

test("§17.8 viewer lê, marca como lida e arquiva, e a contagem dele " +
  "segue a regra (a exclusão é negada pelas Rules, suítes D-18 e P5-D2)",
async () => {
  const t = await tenantFor("uc08");
  const fixtures = [
    live(1, {[t.viewer]: ["read"]}),
    live(2, {[t.viewer]: ["dismissed"]}),
    live(3, {[t.viewer]: ["read", "dismissed"]}),
    live(4), live(5), live(6),
  ];
  await seedFixtures(t.workspaceId, fixtures);
  assert.equal((await assertCount(t.viewer, t.workspaceId, fixtures))
    .unreadCount, 3);
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 6, "a marca do viewer não altera o owner");
});

test("§17.9 evento recém-criado: confirmado antes da chamada, entra no " +
  "total já na chamada seguinte", async () => {
  const t = await tenantFor("uc09");
  const fixtures = [live(1), live(2), live(3, {[t.owner]: ["read"]})];
  await seedFixtures(t.workspaceId, fixtures);
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 2);

  const fresh = live(99);
  const committedAt = Date.now();
  const outcome = await publishNotification(
    eventDocumentFor(t.workspaceId, fresh));
  assert.equal(outcome, "created");
  fixtures.push(fresh);
  // Logo depois da confirmação, sem esperar: o instante do banco é
  // posterior à publicação.
  const immediate = await assertCount(t.owner, t.workspaceId, fixtures);
  assert.equal(immediate.unreadCount, 3);
  assert.ok(Date.parse(immediate.asOf) >= committedAt - 1_000);
});

test("§17.9b marca recém-gravada (lida, arquivada, excluída para si) sai " +
  "do total já na chamada seguinte", async () => {
  const t = await tenantFor("uc09b");
  const fixtures = [live(1), live(2), live(3), live(4)];
  await seedFixtures(t.workspaceId, fixtures);
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 4);
  for (const [index, mark] of [[0, "read"], [1, "dismissed"],
    [2, "deleted"]] as const) {
    fixtures[index] = {...fixtures[index],
      marks: {...fixtures[index].marks, [t.owner]: [mark]}};
    // Só o estado (o evento já existe), com o `expiresAt` do evento.
    await stateRef(t.workspaceId, t.owner, fixtures[index].id).create(
      stateDocumentFor([mark], Timestamp.fromMillis(
        fixtureExpiresAtMs(fixtures[index]))));
    const result = await assertCount(t.owner, t.workspaceId, fixtures);
    assert.equal(result.unreadCount, 3 - index, `depois de ${mark}`);
  }
});

test("§17.9c workspace e membership recém-criados: a primeira chamada já " +
  "autoriza e conta (sem erro transitório)", async () => {
  const t = await tenantFor("uc09c");
  const fixtures = [live(1), live(2)];
  await seedFixtures(t.workspaceId, fixtures);
  const fresh = await tenantFor("uc09c-novo");
  await seedMember(fresh.workspaceId, t.owner, "viewer");
  assert.equal((await callCount(t.owner, fresh.workspaceId)).unreadCount, 0,
    "membership aceito agora já autoriza");
  assert.equal((await callCount(fresh.owner, fresh.workspaceId)).unreadCount,
    0, "dono do workspace recém-criado");
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 2);
});

// ----------------------------------------------------------------- 10–14

test("§17.10 evento expirado logicamente (expiresAt passado, ainda no " +
  "banco) não conta, nem com estado", async () => {
  const t = await tenantFor("uc10");
  const fixtures = [
    live(1), live(2), live(3, {[t.owner]: ["read"]}),
    expired(1), expired(2), expired(3, {[t.owner]: ["read"]}),
  ];
  await seedFixtures(t.workspaceId, fixtures);
  // Os expirados continuam fisicamente lá.
  const stored = await db().collection(
    `workspaces/${t.workspaceId}/notifications`).count().get();
  assert.equal(stored.data().count, 6);
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 2);
  assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
    .unreadCount, 3);
});

test("§17.11 evento removido fisicamente: apagar o evento expirado não " +
  "muda o total", async () => {
  const t = await tenantFor("uc11");
  const fixtures = [live(1), live(2), expired(1), expired(2), expired(3)];
  await seedFixtures(t.workspaceId, fixtures);
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 2);
  for (const fixture of fixtures.filter((f) => f.id.startsWith("old-"))) {
    await removeEventDoc(t.workspaceId, fixture.id);
  }
  const stored = await db().collection(
    `workspaces/${t.workspaceId}/notifications`).count().get();
  assert.equal(stored.data().count, 2, "expirados removidos");
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 2);
});

test("§17.12 estado privado removido pelo TTL: apagar os estados " +
  "expirados não muda o total", async () => {
  const t = await tenantFor("uc12");
  const fixtures = [
    live(1, {[t.owner]: ["read"]}), live(2),
    expired(1, {[t.owner]: ["read"]}),
    expired(2, {[t.owner]: ["dismissed"], [t.admin]: ["deleted"]}),
  ];
  await seedFixtures(t.workspaceId, fixtures);
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 1);
  // O TTL do estado (mesmo expiresAt do evento) só pode alcançar estados de
  // eventos já expirados.
  for (const fixture of fixtures.filter((f) => f.id.startsWith("old-"))) {
    for (const uid of Object.keys(fixture.marks)) {
      await stateRef(t.workspaceId, uid, fixture.id).delete();
    }
    fixture.statesRemoved = true;
  }
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 1);
  assert.equal((await assertCount(t.admin, t.workspaceId, fixtures))
    .unreadCount, 2);
});

test("§17.13 evento expirado removido antes do estado: o estado órfão " +
  "já expirado não conta nem derruba a contagem", async () => {
  const t = await tenantFor("uc13");
  const fixtures = [
    live(1, {[t.owner]: ["read"]}), live(2), live(3),
    expired(1, {[t.owner]: ["read"]}),
    expired(2, {[t.owner]: ["dismissed"]}),
  ];
  await seedFixtures(t.workspaceId, fixtures);
  // Remove só os eventos expirados; os estados (também expirados) ficam.
  for (const fixture of fixtures.filter((f) => f.id.startsWith("old-"))) {
    await removeEventDoc(t.workspaceId, fixture.id);
    fixture.eventRemoved = true;
  }
  const states = await db().collection(
    `workspaces/${t.workspaceId}/notification_user_states/${t.owner}/` +
    "notification_entries").count().get();
  assert.equal(states.data().count, 3, "os estados permanecem");
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 2);
  assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
    .unreadCount, 3);
});

test("§17.14 estado expirado antes da remoção física do evento: os dois " +
  "lados já expirados saem da contagem juntos", async () => {
  const t = await tenantFor("uc14");
  const fixtures = [
    live(1), live(2, {[t.owner]: ["read"]}),
    expired(1, {[t.owner]: ["read"]}),
    expired(2, {[t.owner]: ["dismissed"], [t.member]: ["deleted"]}),
    expired(3),
  ];
  await seedFixtures(t.workspaceId, fixtures);
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 1);
  assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
    .unreadCount, 2);
});

// ---------------------------------------------------------------- 15–17

test("§17.15 mais de 25 notificações: o total não é o da primeira página",
  async () => {
    const t = await tenantFor("uc15");
    const fixtures = lives(40, (i) =>
      i % 5 === 0 ? {[t.owner]: ["read"] as Mark[]} : {});
    await seedFixtures(t.workspaceId, fixtures);
    const result = await assertCount(t.owner, t.workspaceId, fixtures);
    assert.equal(result.unreadCount, 32, "40 − 8 lidas");
    assert.ok(result.unreadCount > 25);
  });

test("§17.16 mais de 100 notificações: o total não é o da página nem o " +
  "do teto de listagem", async () => {
  const t = await tenantFor("uc16");
  const fixtures = lives(130, (i) =>
    i % 4 === 0 ? {[t.owner]: ["dismissed"] as Mark[]} : {});
  await seedFixtures(t.workspaceId, fixtures);
  const result = await assertCount(t.owner, t.workspaceId, fixtures);
  assert.equal(result.unreadCount, 97, "130 − 33 arquivadas");
  assert.ok(result.unreadCount > 50 && result.unreadCount < 130);
});

test("§17.17 mais de 1.000 notificações: o total ultrapassa o bloco de " +
  "1.000 entradas de índice de cada agregação", async () => {
  const t = await tenantFor("uc17");
  const fixtures: Fixture[] = [
    ...Array.from({length: 1_003}, (_, i) => live(i, {
      ...(i % 3 === 0 ? {[t.owner]: ["read"] as Mark[]} : {}),
      ...(i % 7 === 0 ? {[t.admin]: ["deleted"] as Mark[]} : {}),
    })),
    ...Array.from({length: 200}, (_, i) => expired(i, i % 2 === 0 ?
      {[t.owner]: ["read"] as Mark[]} : {})),
  ];
  assert.ok(fixtures.length > 1_000);
  await seedFixtures(t.workspaceId, fixtures);
  // À mão: i % 3 === 0 em 0..1002 são 335; i % 7 === 0 são 144.
  const owner = await assertCount(t.owner, t.workspaceId, fixtures);
  assert.equal(owner.unreadCount, 1_003 - 335);
  const admin = await assertCount(t.admin, t.workspaceId, fixtures);
  assert.equal(admin.unreadCount, 1_003 - 144);
  assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
    .unreadCount, 1_003);
});

// ---------------------------------------------------------------- 18–23

test("§17.18 membro removido: a chamada é recusada e nenhum total sai",
  async () => {
    const t = await tenantFor("uc18");
    const fixtures = lives(5);
    await seedFixtures(t.workspaceId, fixtures);
    assert.equal((await assertCount(t.otherMember, t.workspaceId, fixtures))
      .unreadCount, 5, "controle: membro ativo");
    await seedMember(t.workspaceId, t.otherMember, "member", "removed");
    const error = await expectHttpsError(
      callCount(t.otherMember, t.workspaceId), "permission-denied");
    assert.ok(!("unreadCount" in ((error.details ?? {}) as object)),
      "nenhum total na recusa");
  });

test("§17.19 workspace arquivado: a chamada é recusada com o motivo, sem " +
  "total", async () => {
  const t = await tenantFor("uc19");
  await seedFixtures(t.workspaceId, lives(3));
  await db().doc(`workspaces/${t.workspaceId}`).update({status: "archived"});
  await expectHttpsError(callCount(t.owner, t.workspaceId),
    "failed-precondition", {reason: "workspace_archived"});
});

test("§17.20 usuário suspenso: a chamada é recusada, sem total", async () => {
  const t = await tenantFor("uc20");
  await seedFixtures(t.workspaceId, lives(3));
  await seedActiveAccount(t.member, {status: "suspended"});
  await expectHttpsError(callCount(t.member, t.workspaceId),
    "permission-denied", {reason: "account_suspended"});
  // Os demais membros seguem normais.
  assert.equal((await callCount(t.owner, t.workspaceId)).unreadCount, 3);
});

test("§17.21 troca de workspace: o mesmo usuário recebe o total de cada " +
  "workspace, sem reaproveitar o outro", async () => {
  const a = await tenantFor("uc21a");
  const b = await tenantFor("uc21b");
  await seedMember(b.workspaceId, a.member, "member");
  const fixturesA = lives(8, (i) =>
    i < 3 ? {[a.member]: ["read"] as Mark[]} : {});
  const fixturesB = lives(12, (i) =>
    i < 10 ? {[a.member]: ["dismissed"] as Mark[]} : {});
  await seedFixtures(a.workspaceId, fixturesA);
  await seedFixtures(b.workspaceId, fixturesB);
  for (let round = 0; round < 2; round += 1) {
    assert.equal((await assertCount(a.member, a.workspaceId, fixturesA))
      .unreadCount, 5);
    assert.equal((await assertCount(a.member, b.workspaceId, fixturesB))
      .unreadCount, 2);
  }
  // Usuário de A não tem acesso a B.
  await expectHttpsError(callCount(a.owner, b.workspaceId),
    "permission-denied");
});

test("§17.22 troca de usuário: cada usuário recebe só o próprio total, " +
  "em qualquer ordem de chamada", async () => {
  const t = await tenantFor("uc22");
  const fixtures = lives(9, (i) => ({
    ...(i < 4 ? {[t.owner]: ["read"] as Mark[]} : {}),
    ...(i >= 4 && i < 6 ? {[t.admin]: ["read"] as Mark[]} : {}),
  }));
  await seedFixtures(t.workspaceId, fixtures);
  for (const uid of [t.owner, t.admin, t.owner, t.member, t.admin]) {
    await assertCount(uid, t.workspaceId, fixtures);
  }
  assert.equal((await callCount(t.owner, t.workspaceId)).unreadCount, 5);
  assert.equal((await callCount(t.admin, t.workspaceId)).unreadCount, 7);
  assert.equal((await callCount(t.member, t.workspaceId)).unreadCount, 9);
});

test("§17.23 alteração de papel: member → viewer continua contando; " +
  "removido nega; reativado volta a contar com os estados que tinha",
async () => {
  const t = await tenantFor("uc23");
  const fixtures = lives(6, (i) =>
    i < 2 ? {[t.member]: ["read"] as Mark[]} : {});
  await seedFixtures(t.workspaceId, fixtures);
  assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
    .unreadCount, 4);
  await seedMember(t.workspaceId, t.member, "viewer");
  assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
    .unreadCount, 4, "viewer lê o mesmo total");
  await seedMember(t.workspaceId, t.member, "member", "removed");
  await expectHttpsError(callCount(t.member, t.workspaceId),
    "permission-denied");
  await seedMember(t.workspaceId, t.member, "admin");
  assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
    .unreadCount, 4, "o papel não muda o estado do usuário");
});

// ---------------------------------------------------------------- 24–27

interface Observation {
  unreadCount: number;
  asOf: string;
}

interface Observed {
  sequential: Observation[];
  burst: Observation[];
}

const countsOf = (observed: Observed): number[] =>
  [...observed.sequential, ...observed.burst].map((item) => item.unreadCount);

/** `asOf` (RFC 3339 com nanossegundos) em segundos e nanossegundos. */
const instantOf = (asOf: string): {seconds: number; nanos: number} => {
  const match = /^(.*T\d{2}:\d{2}:\d{2})\.(\d{9})Z$/.exec(asOf);
  assert.ok(match, `asOf com nanossegundos: ${asOf}`);
  return {seconds: Date.parse(`${match[1]}Z`) / 1000, nanos: Number(match[2])};
};

const atOrBefore = (
  time: Timestamp,
  at: {seconds: number; nanos: number},
): boolean => time.seconds < at.seconds ||
  (time.seconds === at.seconds && time.nanoseconds <= at.nanos);

/**
 * Oráculo EXATO no instante `asOf`, documento a documento (não é a fórmula
 * de produção): um evento conta para `uid` se já tinha sido criado até
 * `asOf` (`createTime` do commit), ainda não expirava em `asOf` e o usuário
 * não tinha estado criado até `asOf`. Lê só metadados de commit depois que
 * todas as escritas terminaram.
 */
const exactOracle = async (
  workspaceId: string,
  uid: string,
  eventIds: string[],
): Promise<(asOf: string) => number> => {
  const events = await Promise.all(eventIds.map((id) =>
    notificationRef(workspaceId, id).get()));
  const states = await Promise.all(eventIds.map((id) =>
    stateRef(workspaceId, uid, id).get()));
  return (asOf) => {
    const at = instantOf(asOf);
    let unread = 0;
    events.forEach((event, index) => {
      if (!event.exists || !event.createTime) return;
      if (!atOrBefore(event.createTime, at)) return;
      const expiresAt = event.get("expiresAt") as Timestamp;
      if (atOrBefore(expiresAt, at)) return;
      const state = states[index];
      if (state.exists && state.createTime &&
        atOrBefore(state.createTime, at)) return;
      unread += 1;
    });
    return unread;
  };
};

/** Cada leitura observada é igual ao oráculo exato no seu `asOf`. */
const assertExactAtAsOf = (
  observed: Observed,
  oracle: (asOf: string) => number,
) => {
  for (const item of [...observed.sequential, ...observed.burst]) {
    assert.equal(item.unreadCount, oracle(item.asOf),
      `total exato no instante ${item.asOf}`);
  }
};

/**
 * Executa as escritas escalonadas enquanto a contagem é chamada em sequência
 * (uma "aba") e em rajada paralela (outras "abas"), tudo sobrepostos.
 */
const observe = async (
  uid: string,
  workspaceId: string,
  writes: Array<{delayMs: number; run: () => Promise<unknown>}>,
): Promise<Observed> => {
  const sequential: Observation[] = [];
  const burst: Observation[] = [];
  const writers = writes.map(async (write) => {
    await sleep(write.delayMs);
    await write.run();
  });
  const sequentialTab = (async () => {
    for (let i = 0; i < 12; i += 1) {
      sequential.push(await callCount(uid, workspaceId));
      await sleep(250);
    }
  })();
  const burstTab = (async () => {
    await sleep(600);
    const results = await Promise.all(Array.from({length: 6}, () =>
      callCount(uid, workspaceId)));
    for (const result of results) burst.push(result);
  })();
  await Promise.all([...writers, sequentialTab, burstTab]);
  return {sequential, burst};
};

const assertWithin = (values: number[], min: number, max: number) => {
  for (const value of values) {
    assert.ok(Number.isSafeInteger(value) && value >= 0,
      `inteiro não negativo: ${value}`);
    assert.ok(value >= min && value <= max,
      `resultado ${value} fora de [${min}, ${max}]`);
  }
};

test("§17.24 leitura concorrente: marcas como lida intercaladas com a " +
  "contagem ficam entre o mínimo e o máximo, nunca erram nem ficam " +
  "negativas, e o final bate com o oráculo", async () => {
  const t = await tenantFor("uc24");
  const fixtures = lives(20);
  await seedFixtures(t.workspaceId, fixtures);
  const marked = fixtures.slice(0, 8);
  const observed = await observe(t.owner, t.workspaceId, marked.map(
    (fixture, i) => ({
      delayMs: i * 250,
      run: () => markState(t.workspaceId, t.owner, fixture, ["read"]),
    })));
  assertWithin(countsOf(observed), 20 - 8, 20);
  for (let i = 1; i < observed.sequential.length; i += 1) {
    assert.ok(observed.sequential[i].unreadCount <=
      observed.sequential[i - 1].unreadCount,
    "só marcas: o total não aumenta");
  }
  assertExactAtAsOf(observed, await exactOracle(t.workspaceId, t.owner,
    fixtures.map((fixture) => fixture.id)));
  const final = await assertCount(t.owner, t.workspaceId, fixtures);
  assert.equal(final.unreadCount, 12);
  assert.equal((await assertCount(t.admin, t.workspaceId, fixtures))
    .unreadCount, 20, "a marca do owner não afeta o admin");
});

test("§17.25 criação concorrente: publicações paralelas (inclusive " +
  "repetidas) intercaladas com a contagem; sem duplicar nem perder",
async () => {
  const t = await tenantFor("uc25");
  const fixtures = lives(10);
  await seedFixtures(t.workspaceId, fixtures);
  const created = Array.from({length: 8}, (_, i) => live(500 + i));
  const observed = await observe(t.member, t.workspaceId, created.flatMap(
    (fixture, i) => [
      // Cada evento é publicado duas vezes em paralelo (retry/reentrega).
      {delayMs: i * 250, run: () => publishNotification(
        eventDocumentFor(t.workspaceId, fixture))},
      {delayMs: i * 250, run: () => publishNotification(
        eventDocumentFor(t.workspaceId, fixture))},
    ]));
  assertWithin(countsOf(observed), 10, 18);
  for (let i = 1; i < observed.sequential.length; i += 1) {
    assert.ok(observed.sequential[i].unreadCount >=
      observed.sequential[i - 1].unreadCount,
    "só criações: o total não diminui");
  }
  fixtures.push(...created);
  assertExactAtAsOf(observed, await exactOracle(t.workspaceId, t.member,
    fixtures.map((fixture) => fixture.id)));
  assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
    .unreadCount, 18);
});

test("§17.26 exclusão concorrente: exclusões para si e marcas intercaladas " +
  "com criações e com a contagem, de dois usuários", async () => {
  const t = await tenantFor("uc26");
  const fixtures = lives(24);
  await seedFixtures(t.workspaceId, fixtures);
  const created = Array.from({length: 4}, (_, i) => live(700 + i));
  const writes = [
    ...fixtures.slice(0, 6).map((fixture, i) => ({
      delayMs: i * 200,
      run: () => markState(t.workspaceId, t.owner, fixture, ["deleted"]),
    })),
    ...fixtures.slice(6, 10).map((fixture, i) => ({
      delayMs: 100 + i * 300,
      run: () => markState(t.workspaceId, t.owner, fixture,
        ["dismissed", "read"]),
    })),
    // Outro usuário exclui outros eventos: não pode mexer no owner.
    ...fixtures.slice(10, 16).map((fixture, i) => ({
      delayMs: i * 150,
      run: () => markState(t.workspaceId, t.admin, fixture, ["deleted"]),
    })),
    ...created.map((fixture, i) => ({
      delayMs: 50 + i * 400,
      run: () => publishNotification(
        eventDocumentFor(t.workspaceId, fixture)),
    })),
  ];
  const observed = await observe(t.owner, t.workspaceId, writes);
  // Do ponto de vista do owner: 24 − (6 + 4) = 14 no mínimo, 14 + 4 no máximo.
  assertWithin(countsOf(observed), 24 - 10, 24 + 4);
  fixtures.push(...created);
  assertExactAtAsOf(observed, await exactOracle(t.workspaceId, t.owner,
    fixtures.map((fixture) => fixture.id)));
  const owner = await assertCount(t.owner, t.workspaceId, fixtures);
  assert.equal(owner.unreadCount, 18);
  assert.equal((await assertCount(t.admin, t.workspaceId, fixtures))
    .unreadCount, 28 - 6);
});

test("§17.27 reprocessamento do mesmo evento (publicação repetida e " +
  "gatilho reentregue) não muda a contagem", async () => {
  const t = await tenantFor("uc27");
  const fixtures = lives(4, (i) =>
    i === 0 ? {[t.owner]: ["read"] as Mark[]} : {});
  await seedFixtures(t.workspaceId, fixtures);
  const extra = live(40);
  const first = await publishNotification(
    eventDocumentFor(t.workspaceId, extra));
  const second = await publishNotification(
    eventDocumentFor(t.workspaceId, extra));
  const third = await publishNotification(
    eventDocumentFor(t.workspaceId, extra));
  assert.deepEqual([first, second, third], ["created", "exists", "exists"]);
  fixtures.push(extra);
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 4);
  const stored = (await notificationRef(t.workspaceId, extra.id).get())
    .data();
  // Nova entrega com instante posterior não regrava nem prorroga o evento.
  const retried = buildNotificationDocument({
    id: extra.id,
    workspaceId: t.workspaceId,
    eventType: "loan_overdue",
    title: "Outro texto",
    message: "Outra mensagem.",
    type: "info",
    link: "loans",
    createdAtMs: Date.now() + 3 * DAY_MS,
    entity: {loanId: "loan-outro"},
  });
  assert.equal(await publishNotification(retried), "exists");
  assert.deepEqual((await notificationRef(t.workspaceId, extra.id).get())
    .data(), stored, "o documento original permanece");
  assert.equal((await assertCount(t.owner, t.workspaceId, fixtures))
    .unreadCount, 4);
});

// ---------------------------------------------------------------- 28–29

test("§17.28 invariante violado (estado sem evento ou com expiração " +
  "futura para evento expirado): erro interno, nunca zero nem total " +
  "limitado", async () => {
  const t = await tenantFor("uc28");
  // Estado órfão: o evento nunca existiu, mas o estado vale para o futuro.
  const orphan = live(1, {[t.owner]: ["read"]});
  orphan.eventRemoved = true;
  await seedFixtures(t.workspaceId, [orphan]);
  const first = await expectHttpsError(callCount(t.owner, t.workspaceId),
    "internal", {message: UNREAD_COUNT_UNAVAILABLE_MESSAGE});
  assert.ok(!("unreadCount" in ((first.details ?? {}) as object)),
    "nenhum total na resposta de erro");
  // Outro usuário, sem estado, não é afetado pelo desvio do owner.
  assert.equal((await callCount(t.member, t.workspaceId)).unreadCount, 0);

  // Evento expirado cujo estado ganhou expiresAt futuro (copiado errado).
  const t2 = await tenantFor("uc28b");
  const dead = expired(1);
  await seedFixtures(t2.workspaceId, [dead]);
  await stateRef(t2.workspaceId, t2.owner, dead.id).set(stateDocumentFor(
    ["read"], Timestamp.fromMillis(Date.now() + 30 * DAY_MS)));
  await expectHttpsError(callCount(t2.owner, t2.workspaceId), "internal",
    {message: UNREAD_COUNT_UNAVAILABLE_MESSAGE});
});

test("§17.28b falha da consulta (transação de leitura indisponível): " +
  "erro interno com a mensagem pt-BR, nunca zero", async () => {
  const t = await tenantFor("uc28c");
  await seedFixtures(t.workspaceId, lives(3));
  const firestore = db() as unknown as {
    runTransaction: (...args: unknown[]) => Promise<unknown>;
  };
  const original = firestore.runTransaction;
  firestore.runTransaction = (...args: unknown[]) => {
    const options = args[1] as {readOnly?: boolean} | undefined;
    if (options?.readOnly) {
      return Promise.reject(Object.assign(
        new Error("Firestore indisponível (simulado)"), {code: 14}));
    }
    return original.apply(firestore, args);
  };
  try {
    await expectHttpsError(callCount(t.owner, t.workspaceId), "internal",
      {message: UNREAD_COUNT_UNAVAILABLE_MESSAGE});
  } finally {
    firestore.runTransaction = original;
  }
  assert.equal((await callCount(t.owner, t.workspaceId)).unreadCount, 3,
    "restabelecida a consulta, o total real volta");
});

test("§17.29 falha de permissão: sem autenticação, não membro, membro " +
  "removido, workspace inexistente e payload com campos extras ou " +
  "inválidos", async () => {
  const a = await tenantFor("uc29a");
  const b = await tenantFor("uc29b");
  await seedFixtures(a.workspaceId, lives(3));
  assert.equal(await httpsCodeOf(callCount(null, a.workspaceId)),
    "unauthenticated");
  assert.equal(await httpsCodeOf(callCount(b.owner, a.workspaceId)),
    "permission-denied", "não membro de A (dono de B)");
  assert.equal(await httpsCodeOf(callCount(a.owner, b.workspaceId)),
    "permission-denied");
  assert.equal(await httpsCodeOf(callCount(a.owner, "ws-inexistente-uc29")),
    "permission-denied", "sem oráculo de existência");
  // Contrato estrito: nada de uid, papel ou campo extra vindo do cliente.
  for (const payload of [
    {workspaceId: a.workspaceId, uid: b.owner},
    {workspaceId: a.workspaceId, role: "owner"},
    {workspaceId: a.workspaceId, userId: a.member},
    {workspaceId: a.workspaceId, asOf: new Date().toISOString()},
    {},
    {workspaceId: 123},
    {workspaceId: ""},
    {workspaceId: "a/b"},
  ]) {
    assert.equal(await httpsCodeOf(call(getNotificationUnreadCount, a.owner,
      payload)), "invalid-argument", JSON.stringify(payload));
  }
  // Controle: com o payload correto, tudo certo.
  assert.equal((await callCount(a.owner, a.workspaceId)).unreadCount, 3);
});

// ---------------------------------------------------------------- 30–32

test("§17.30 índices insuficientes: firestore.indexes.json declara TTL e " +
  "o índice ascendente de coleção em expiresAt para notifications e " +
  "notification_entries (o Emulator não exige índice, então a verificação " +
  "é estática; o gate de implantação publica o arquivo)", () => {
  const file = path.resolve(__dirname, "..", "..", "..", "..",
    "firestore.indexes.json");
  const config = JSON.parse(readFileSync(file, "utf8")) as {
    fieldOverrides: Array<{
      collectionGroup: string;
      fieldPath: string;
      ttl?: boolean;
      indexes: Array<{order?: string; queryScope?: string}>;
    }>;
  };
  for (const group of ["notifications", "notification_entries"]) {
    const overrides = config.fieldOverrides.filter((item) =>
      item.collectionGroup === group && item.fieldPath === "expiresAt");
    assert.equal(overrides.length, 1, `${group}: um único override`);
    const [override] = overrides;
    assert.equal(override.ttl, true, `${group}: TTL declarado`);
    assert.ok(override.indexes.some((index) =>
      index.order === "ASCENDING" && index.queryScope === "COLLECTION"),
    `${group}: índice ascendente de coleção em expiresAt`);
  }
});

test("§17.31 custos e limites: o limite de frequência (600/h por usuário " +
  "e workspace) bloqueia a chamada seguinte sem afetar outro usuário; o " +
  "custo é 1 leitura por 1.000 entradas de índice em cada agregação",
async () => {
  // Custo por chamada (documentado em unreadCount.ts): duas agregações
  // `count()` na mesma transação somente leitura (1 leitura por até 1.000
  // entradas de índice de `expiresAt`, em cada coleção), 3 leituras de
  // autorização, 3 da pré-checagem e 1 leitura + 1 escrita do limite. O
  // Emulator não mede leituras; aqui se verifica o teto e o isolamento.
  assert.deepEqual(
    [NOTIFICATION_UNREAD_COUNT_RATE_LIMIT.limit,
      NOTIFICATION_UNREAD_COUNT_RATE_LIMIT.windowSeconds],
    [600, 3_600]);
  const t = await tenantFor("uc31");
  const fixtures = lives(5);
  await seedFixtures(t.workspaceId, fixtures);
  const ref = rateLimitRef(t.workspaceId, t.owner,
    NOTIFICATION_UNREAD_COUNT_RATE_LIMIT);
  await assertCount(t.owner, t.workspaceId, fixtures);
  assert.equal((await ref.get()).get("count"), 1, "consumo registrado");
  await ref.set({count: NOTIFICATION_UNREAD_COUNT_RATE_LIMIT.limit},
    {merge: true});
  await assert.rejects(callCount(t.owner, t.workspaceId),
    (error: unknown) => error instanceof HttpsError &&
      error.code === "failed-precondition" &&
      /Muitas solicitações em pouco tempo/.test(error.message));
  assert.equal((await ref.get()).get("count"),
    NOTIFICATION_UNREAD_COUNT_RATE_LIMIT.limit,
    "a chamada recusada não consome além do teto");
  // Outro usuário do mesmo workspace tem o próprio limite.
  assert.equal((await assertCount(t.member, t.workspaceId, fixtures))
    .unreadCount, 5);
  // O mesmo usuário em outro workspace também tem o próprio contador.
  const other = await tenantFor("uc31b");
  await seedMember(other.workspaceId, t.owner, "member");
  assert.equal((await callCount(t.owner, other.workspaceId)).unreadCount, 0);
});

test("§17.32 contador global igual ao total real verificável: conjunto " +
  "misto grande com resultado conhecido pelas fixtures", async () => {
  const t = await tenantFor("uc32");
  // 1.000 eventos vivos (índice 0..999) e 150 expirados, em rodízio dos nove
  // tipos. Pelo resto da divisão do índice por 10:
  //   owner  — 0,1: lida; 2: arquivada; 3: excluída; 4: lida + arquivada;
  //            5..9: sem marca → 500 não lidas;
  //   admin  — múltiplos de 5: lida → 800 não lidas;
  //   viewer — índice < 100: lida → 900 não lidas;
  //   member — nenhuma marca → 1.000.
  // Os 150 expirados (alguns com estado) não entram no total de ninguém.
  const ownerMarks = (i: number): Mark[] => {
    const digit = i % 10;
    if (digit <= 1) return ["read"];
    if (digit === 2) return ["dismissed"];
    if (digit === 3) return ["deleted"];
    if (digit === 4) return ["read", "dismissed"];
    return [];
  };
  const fixtures: Fixture[] = [
    ...Array.from({length: 1_000}, (_, i) => live(i, {
      ...(ownerMarks(i).length ? {[t.owner]: ownerMarks(i)} : {}),
      ...(i % 5 === 0 ? {[t.admin]: ["read"] as Mark[]} : {}),
      ...(i < 100 ? {[t.viewer]: ["read"] as Mark[]} : {}),
    })),
    ...Array.from({length: 150}, (_, i) => expired(i, {
      [t.owner]: ["read"], [t.viewer]: ["dismissed"],
    })),
  ];
  await seedFixtures(t.workspaceId, fixtures,
    (index) => EVENT_TYPE_CYCLE[index % EVENT_TYPE_CYCLE.length]);
  const results = {
    owner: await assertCount(t.owner, t.workspaceId, fixtures),
    admin: await assertCount(t.admin, t.workspaceId, fixtures),
    viewer: await assertCount(t.viewer, t.workspaceId, fixtures),
    member: await assertCount(t.member, t.workspaceId, fixtures),
  };
  assert.equal(results.owner.unreadCount, 500);
  assert.equal(results.admin.unreadCount, 800);
  assert.equal(results.viewer.unreadCount, 900);
  assert.equal(results.member.unreadCount, 1_000);
});
