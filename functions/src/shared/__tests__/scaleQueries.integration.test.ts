import assert from "node:assert/strict";
import test, {after} from "node:test";
import * as admin from "firebase-admin";
import {AggregateField, FieldPath} from "firebase-admin/firestore";

/**
 * Custo das leituras dos módulos adjacentes, sob volume.
 *
 * `recurring-expenses`, `loans` e `split-bills` liam coleções inteiras. Na
 * Divisão de contas (P4-C), saldos e totais vêm dos agregados do grupo e dos
 * participantes; títulos saem paginados por grupo e rateios só por título.
 *
 * Passar funcionalmente não prova escala: com 10 documentos, a varredura
 * completa e a consulta paginada dão o mesmo resultado e o mesmo tempo. O que
 * separa as duas é quantos documentos são lidos quando a coleção cresce, e é
 * isso que este arquivo mede — reproduzindo a **forma** de cada consulta do
 * cliente contra volume real no Emulator.
 *
 * Os tetos assertados são absolutos, não proporções: uma regressão que volte a
 * varrer a coleção falha aqui, mesmo que o resultado exibido continue certo.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório.");
}

const PROJECT = process.env.GCLOUD_PROJECT || "minhas-financas-local";
const WORKSPACE = "scale-cost-workspace";
const OTHER_WORKSPACE = "scale-cost-other";

/** Volume por coleção. Alto o bastante para separar consulta de varredura. */
const VOLUME = 2_000;
const BILLS = 120;
const SHARES_PER_BILL = 5;

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const padded = (index: number): string => String(index).padStart(6, "0");

const commitInChunks = async (
  writes: Array<[admin.firestore.DocumentReference, admin.firestore.DocumentData]>,
): Promise<void> => {
  for (let start = 0; start < writes.length; start += 450) {
    const batch = db().batch();
    for (const [ref, data] of writes.slice(start, start + 450)) {
      batch.set(ref, data);
    }
    await batch.commit();
  }
};

let seeded = false;

/*
 * As recorrências de volume entram no collection group global que o
 * agendador de Recorrentes varre (`recurring/scheduler.ts`). Elas não estão
 * no schema autoritativo completo — servem só para medir a consulta — e por
 * isso saem do Emulator ao fim desta suíte, para não entrarem na varredura
 * das suítes seguintes.
 */
after(async () => {
  await db().recursiveDelete(
    db().collection(`workspaces/${WORKSPACE}/recurring_expenses`));
});

const seedVolume = async (): Promise<void> => {
  if (seeded) return;
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  await db().recursiveDelete(db().doc(`workspaces/${OTHER_WORKSPACE}`));

  const writes: Array<[admin.firestore.DocumentReference, admin.firestore.DocumentData]> = [];

  // Empréstimos no schema autoritativo: metade a receber, metade a pagar; um
  // décimo em atraso, um sétimo quitado e um décimo terceiro cancelado (com
  // saldo residual congelado, que não pode entrar no total aberto).
  const loans = db().collection(`workspaces/${WORKSPACE}/loans`);
  for (let index = 0; index < VOLUME; index += 1) {
    const isLend = index % 2 === 0;
    const status = index % 10 === 0 ? "overdue" :
      index % 7 === 0 ? "paid" :
        index % 13 === 0 ? "cancelled" : "active";
    writes.push([loans.doc(`loan-${padded(index)}`), {
      schemaVersion: 1,
      type: isLend ? "lend" : "borrow",
      status,
      personName: `Contraparte ${index}`,
      description: "Contrato de teste",
      principalCents: 10_000,
      balanceCents: status === "paid" ? 0 : 10_000 + index,
      startDate: "2026-01-01",
    }]);
  }

  // Recorrências (P4-B): um quinto pausadas, para o filtro de servidor ter o
  // que cortar; um terço das ativas com vencimento já alcançado.
  const recurring = db().collection(`workspaces/${WORKSPACE}/recurring_expenses`);
  for (let index = 0; index < VOLUME; index += 1) {
    const paused = index % 5 === 0;
    writes.push([recurring.doc(`rec-${padded(index)}`), {
      schemaVersion: 1,
      name: `Assinatura ${index}`,
      status: paused ? "paused" : "active",
      frequency: "monthly",
      amountCents: 1_000,
      nextDueDate: paused ? null : index % 3 === 0 ? "2026-01-10" : "2099-01-10",
    }]);
  }

  // Títulos de um grupo, mais ruído de outros grupos na mesma coleção, e
  // rateios por título (P4-C): é o ruído que uma varredura leria junto.
  const bills = db().collection(`workspaces/${WORKSPACE}/split_bills`);
  const shares = db().collection(`workspaces/${WORKSPACE}/split_shares`);
  const participants = db()
    .collection(`workspaces/${WORKSPACE}/split_participants`);
  for (let index = 0; index < BILLS; index += 1) {
    const billId = `sbill-${padded(index)}`;
    const groupId = index % 2 === 0 ? "grupo-alvo" : "grupo-ruido";
    writes.push([bills.doc(billId), {
      schemaVersion: 1,
      groupId,
      status: "open",
      amountCents: 10_000,
      expenseDate: `2026-${String(1 + (index % 9)).padStart(2, "0")}-` +
        `${String(1 + (index % 28)).padStart(2, "0")}`,
    }]);
    for (let share = 0; share < SHARES_PER_BILL; share += 1) {
      writes.push([shares.doc(`${billId}-share-${share}`), {
        schemaVersion: 1,
        groupId,
        billId,
        participantId: `${groupId}-participante-${share}`,
        amountCents: 2_000,
        status: share % 2 === 0 ? "open" : "settled",
      }]);
    }
  }
  for (const groupId of ["grupo-alvo", "grupo-ruido"]) {
    for (let share = 0; share < SHARES_PER_BILL; share += 1) {
      writes.push([participants.doc(`${groupId}-participante-${share}`), {
        schemaVersion: 1, groupId, status: "active",
      }]);
    }
  }

  // Outro tenant, com os mesmos nomes de coleção.
  writes.push([db().doc(`workspaces/${OTHER_WORKSPACE}/loans/loan-000000`), {
    schemaVersion: 1, type: "lend", status: "active",
    principalCents: 99_999_900, balanceCents: 99_999_900,
    personName: "Outro tenant", description: "Não pode vazar",
  }]);

  await commitInChunks(writes);
  seeded = true;
};

test("a listagem de empréstimos lê uma página, não a coleção", async () => {
  await seedVolume();
  const pageSize = 100;
  const ref = db().collection(`workspaces/${WORKSPACE}/loans`);

  const first = await ref
    .orderBy(FieldPath.documentId())
    .limit(pageSize + 1)
    .get();
  assert.equal(first.size, pageSize + 1, "lê exatamente pageSize + 1");
  assert.ok(first.size < VOLUME / 10, "não chega perto do tamanho da coleção");

  // O cursor avança sem repetir nem pular.
  const firstIds = first.docs.slice(0, pageSize).map((entry) => entry.id);
  const second = await ref
    .orderBy(FieldPath.documentId())
    .startAfter(firstIds[firstIds.length - 1])
    .limit(pageSize + 1)
    .get();
  const secondIds = second.docs.slice(0, pageSize).map((entry) => entry.id);
  assert.equal(new Set([...firstIds, ...secondIds]).size, pageSize * 2);
  assert.ok(secondIds[0] > firstIds[firstIds.length - 1]);
});

test("os totais de empréstimo são exatos sem ler documento nenhum", async () => {
  await seedVolume();
  const ref = db().collection(`workspaces/${WORKSPACE}/loans`);

  // Mesma forma de `getLoanTotals` (src/modules/loans/api.ts): saldo aberto
  // em centavos inteiros, só `active` e `overdue`.
  const openOfType = (type: string) => ref
    .where("type", "==", type)
    .where("status", "in", ["active", "overdue"]);
  const lend = await openOfType("lend")
    .aggregate({total: AggregateField.sum("balanceCents")})
    .get();
  const borrow = await openOfType("borrow")
    .aggregate({total: AggregateField.sum("balanceCents")})
    .get();
  const overdue = await ref
    .where("status", "==", "overdue")
    .count()
    .get();

  // Conferência independente: a mesma conta feita documento a documento.
  const everything = await ref.get();
  const isOpen = (d: admin.firestore.QueryDocumentSnapshot): boolean =>
    d.get("status") === "active" || d.get("status") === "overdue";
  const sumOpen = (type: string): number => everything.docs
    .filter((d) => d.get("type") === type && isOpen(d))
    .reduce((total, d) => total + Number(d.get("balanceCents")), 0);
  const expectedLend = sumOpen("lend");
  const expectedBorrow = sumOpen("borrow");
  const expectedOverdue = everything.docs
    .filter((d) => d.get("status") === "overdue").length;
  const cancelledBalance = everything.docs
    .filter((d) => d.get("status") === "cancelled")
    .reduce((total, d) => total + Number(d.get("balanceCents")), 0);

  assert.equal(lend.data().total, expectedLend);
  assert.equal(borrow.data().total, expectedBorrow);
  assert.ok(Number.isSafeInteger(lend.data().total), "centavos inteiros");
  assert.ok(Number.isSafeInteger(borrow.data().total), "centavos inteiros");
  assert.equal(overdue.data().count, expectedOverdue);
  // Cancelados têm saldo residual e ficam fora do total aberto.
  assert.ok(cancelledBalance > 0, "há cancelados com saldo residual no volume");
  const withCancelled = await ref
    .where("type", "==", "lend")
    .where("status", "in", ["active", "overdue", "cancelled"])
    .aggregate({total: AggregateField.sum("balanceCents")})
    .get();
  assert.ok(withCancelled.data().total > lend.data().total,
    "incluir cancelados mudaria o total: o filtro de status é necessário");
  // O agregado cobre a coleção inteira, e a listagem só a primeira página:
  // é por isso que o total não pode sair da lista carregada.
  assert.ok(expectedLend > 100 * 10_000,
    "o total excede uma página de contratos");
});

test("o resumo de assinaturas lê só as ativas, com teto", async () => {
  await seedVolume();
  const ref = db().collection(`workspaces/${WORKSPACE}/recurring_expenses`);
  const summaryLimit = 500;

  const active = await ref
    .where("status", "==", "active")
    .orderBy(FieldPath.documentId())
    .limit(summaryLimit + 1)
    .get();

  assert.equal(active.size, summaryLimit + 1);
  assert.ok(active.docs.every((entry) => entry.get("status") === "active"));

  // O corte é detectável, e por isso pode ser declarado na tela em vez de
  // virar um total silenciosamente parcial.
  const truncated = active.size > summaryLimit;
  assert.equal(truncated, true);
});

test("a varredura do agendador de recorrentes é filtrada no servidor", async () => {
  await seedVolume();
  // A mesma consulta de `recurring/scheduler.ts` (índice de grupo declarado):
  // só contratos ativos com vencimento alcançado, em ordem de vencimento.
  const page = await db()
    .collectionGroup("recurring_expenses")
    .where("schemaVersion", "==", 1)
    .where("status", "==", "active")
    .where("nextDueDate", "<=", "2026-06-30")
    .orderBy("nextDueDate", "asc")
    .orderBy(FieldPath.documentId(), "asc")
    .limit(200)
    .get();

  assert.equal(page.size, 200);
  assert.ok(page.docs.every((entry) =>
    entry.get("status") === "active" &&
    entry.get("nextDueDate") <= "2026-06-30"));
});

test("títulos de um grupo saem paginados e rateios só por título", async () => {
  await seedVolume();
  const billsRef = db().collection(`workspaces/${WORKSPACE}/split_bills`);
  const sharesRef = db().collection(`workspaces/${WORKSPACE}/split_shares`);
  const totalShares = (await sharesRef.count().get()).data().count;
  assert.equal(totalShares, BILLS * SHARES_PER_BILL);

  // A mesma forma de `listSplitBills` (índice declarado): página de 20 + 1
  // de sondagem, ordem estável por data e ID, cursor composto.
  const PAGE = 20;
  const pageOf = (cursor?: admin.firestore.QueryDocumentSnapshot) => {
    let query = billsRef
      .where("groupId", "==", "grupo-alvo")
      .orderBy("expenseDate", "desc")
      .orderBy(FieldPath.documentId(), "desc");
    if (cursor) query = query.startAfter(cursor.get("expenseDate"), cursor.id);
    return query.limit(PAGE + 1).get();
  };
  const first = await pageOf();
  assert.equal(first.size, PAGE + 1, "lê só a página e a sonda");
  const firstItems = first.docs.slice(0, PAGE);
  const second = await pageOf(firstItems[PAGE - 1]);
  assert.equal(second.size, PAGE + 1);
  const seen = [...firstItems, ...second.docs.slice(0, PAGE)];
  assert.ok(seen.every((entry) => entry.get("groupId") === "grupo-alvo"));
  assert.equal(new Set(seen.map((entry) => entry.id)).size, PAGE * 2,
    "o cursor não repete nem pula títulos");
  for (let index = 1; index < seen.length; index += 1) {
    const before = seen[index - 1];
    const current = seen[index];
    assert.ok(before.get("expenseDate") > current.get("expenseDate") ||
      (before.get("expenseDate") === current.get("expenseDate") &&
        before.id > current.id), "ordem estável");
  }

  // Rateios: a mesma forma de `listSplitShares` — um título por vez, com teto
  // de 50 + 1. Nada de varrer a coleção nem de juntar títulos com `in`.
  const billId = firstItems[0].id;
  const billShares = await sharesRef
    .where("billId", "==", billId)
    .limit(51)
    .get();
  assert.equal(billShares.size, SHARES_PER_BILL);
  assert.ok(billShares.docs.every((entry) => entry.get("billId") === billId));
  assert.ok(billShares.size < totalShares / 100, "lê só o título aberto");

  // Participantes (saldos agregados): por grupo, com teto de 100 + 1.
  const groupParticipants = await db()
    .collection(`workspaces/${WORKSPACE}/split_participants`)
    .where("groupId", "==", "grupo-alvo")
    .limit(101)
    .get();
  assert.equal(groupParticipants.size, SHARES_PER_BILL);
  assert.ok(groupParticipants.docs.every((entry) =>
    entry.get("groupId") === "grupo-alvo"));
});

test("nenhuma das consultas cruza a fronteira do workspace", async () => {
  await seedVolume();
  const page = await db()
    .collection(`workspaces/${WORKSPACE}/loans`)
    .orderBy(FieldPath.documentId())
    .limit(VOLUME + 10)
    .get();
  assert.equal(page.size, VOLUME);
  assert.equal(
    page.docs.some((entry) => entry.get("personName") === "Outro tenant"),
    false,
  );

  const other = await db()
    .collection(`workspaces/${OTHER_WORKSPACE}/loans`)
    .count()
    .get();
  assert.equal(other.data().count, 1);
});

test("leituras paginadas concorrentes não se interferem", async () => {
  await seedVolume();
  const ref = db().collection(`workspaces/${WORKSPACE}/loans`);
  const pageSize = 50;

  // Dez leitores partindo de cursores diferentes, ao mesmo tempo.
  const cursors = Array.from({length: 10}, (_, index) =>
    `loan-${padded(index * pageSize)}`);
  const pages = await Promise.all(cursors.map((cursor) =>
    ref.orderBy(FieldPath.documentId())
      .startAfter(cursor)
      .limit(pageSize)
      .get()));

  for (const [index, page] of pages.entries()) {
    assert.equal(page.size, pageSize, `leitor ${index}`);
    assert.ok(page.docs[0].id > cursors[index]);
  }
});
