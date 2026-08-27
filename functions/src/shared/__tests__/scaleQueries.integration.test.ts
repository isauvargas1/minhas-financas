import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {AggregateField, FieldPath, Timestamp} from "firebase-admin/firestore";

/**
 * Custo das leituras dos módulos adjacentes, sob volume.
 *
 * `recurring-expenses`, `loans` e `split-bills` liam coleções inteiras. O
 * pior caso era `listSplitSharesByGroup`, que varria `split_shares` do
 * workspace e filtrava em memória — uma vez **por grupo exibido** na lista.
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

const seedVolume = async (): Promise<void> => {
  if (seeded) return;
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  await db().recursiveDelete(db().doc(`workspaces/${OTHER_WORKSPACE}`));

  const writes: Array<[admin.firestore.DocumentReference, admin.firestore.DocumentData]> = [];

  // Empréstimos: metade a receber, metade a pagar; um décimo em atraso.
  const loans = db().collection(`workspaces/${WORKSPACE}/loans`);
  for (let index = 0; index < VOLUME; index += 1) {
    const isLend = index % 2 === 0;
    const overdue = index % 10 === 0;
    writes.push([loans.doc(`loan-${padded(index)}`), {
      type: isLend ? "lend" : "borrow",
      status: overdue ? "overdue" : (index % 7 === 0 ? "paid" : "active"),
      personName: `Contraparte ${index}`,
      description: "Contrato de teste",
      currentBalance: 100,
      startDate: "2026-01-01",
    }]);
  }

  // Assinaturas: um quinto pausadas, para o filtro de servidor ter o que cortar.
  const recurring = db().collection(`workspaces/${WORKSPACE}/recurring_expenses`);
  for (let index = 0; index < VOLUME; index += 1) {
    writes.push([recurring.doc(`rec-${padded(index)}`), {
      nome: `Assinatura ${index}`,
      status: index % 5 === 0 ? "pausado" : "ativo",
      periodo: "mensal",
      valorPadrao: 10,
      gerarDespesaAutomaticamente: index % 3 === 0,
      dataInicio: Timestamp.fromDate(new Date("2026-01-10T12:00:00.000Z")),
    }]);
  }

  // Rateios de um grupo, mais ruído de outros grupos na mesma coleção: é o
  // ruído que a varredura antiga lia junto.
  const bills = db().collection(`workspaces/${WORKSPACE}/split_bills`);
  const shares = db().collection(`workspaces/${WORKSPACE}/split_shares`);
  for (let index = 0; index < BILLS; index += 1) {
    const billId = `bill-${padded(index)}`;
    writes.push([bills.doc(billId), {
      groupId: index < BILLS / 2 ? "grupo-alvo" : "grupo-ruido",
      valorReal: 100,
      statusPagamento: "aberto",
    }]);
    for (let share = 0; share < SHARES_PER_BILL; share += 1) {
      writes.push([shares.doc(`${billId}-share-${share}`), {
        billId,
        participantId: `participante-${share}`,
        valorDevido: 20,
        status: share % 2 === 0 ? "aPagar" : "pago",
      }]);
    }
  }

  // Outro tenant, com os mesmos nomes de coleção.
  writes.push([db().doc(`workspaces/${OTHER_WORKSPACE}/loans/loan-000000`), {
    type: "lend", status: "active", currentBalance: 999_999,
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

  const lend = await ref
    .where("type", "==", "lend")
    .where("status", "in", ["active", "overdue", "cancelled"])
    .aggregate({total: AggregateField.sum("currentBalance")})
    .get();
  const overdue = await ref
    .where("status", "==", "overdue")
    .count()
    .get();

  // Conferência independente: a mesma conta feita documento a documento.
  const everything = await ref.get();
  const expectedLend = everything.docs
    .filter((d) => d.get("type") === "lend" && d.get("status") !== "paid")
    .reduce((total, d) => total + Number(d.get("currentBalance")), 0);
  const expectedOverdue = everything.docs
    .filter((d) => d.get("status") === "overdue").length;

  assert.equal(lend.data().total, expectedLend);
  assert.equal(overdue.data().count, expectedOverdue);
  // O agregado cobre a coleção inteira, e a listagem só a primeira página:
  // é por isso que o total não pode sair da lista carregada.
  assert.ok(expectedLend > 100 * 100, "o total excede uma página de contratos");
});

test("o resumo de assinaturas lê só as ativas, com teto", async () => {
  await seedVolume();
  const ref = db().collection(`workspaces/${WORKSPACE}/recurring_expenses`);
  const summaryLimit = 500;

  const active = await ref
    .where("status", "==", "ativo")
    .orderBy(FieldPath.documentId())
    .limit(summaryLimit + 1)
    .get();

  assert.equal(active.size, summaryLimit + 1);
  assert.ok(active.docs.every((entry) => entry.get("status") === "ativo"));

  // O corte é detectável, e por isso pode ser declarado na tela em vez de
  // virar um total silenciosamente parcial.
  const truncated = active.size > summaryLimit;
  assert.equal(truncated, true);
});

test("a varredura do agendador de recorrentes é filtrada no servidor", async () => {
  await seedVolume();
  const page = await db()
    .collectionGroup("recurring_expenses")
    .where("status", "==", "ativo")
    .where("gerarDespesaAutomaticamente", "==", true)
    .orderBy(FieldPath.documentId())
    .limit(200)
    .get();

  assert.equal(page.size, 200);
  assert.ok(page.docs.every((entry) =>
    entry.get("status") === "ativo" &&
    entry.get("gerarDespesaAutomaticamente") === true));
});

test("os rateios de um grupo saem por consulta indexada, não por varredura", async () => {
  await seedVolume();
  const sharesRef = db().collection(`workspaces/${WORKSPACE}/split_shares`);
  const totalShares = (await sharesRef.count().get()).data().count;
  assert.equal(totalShares, BILLS * SHARES_PER_BILL);

  const groupBills = await db()
    .collection(`workspaces/${WORKSPACE}/split_bills`)
    .where("groupId", "==", "grupo-alvo")
    .orderBy(FieldPath.documentId())
    .limit(301)
    .get();
  const billIds = groupBills.docs.map((entry) => entry.id);
  assert.equal(billIds.length, BILLS / 2);

  // Blocos de 30 — o teto do operador `in`.
  let read = 0;
  const collected: string[] = [];
  for (let start = 0; start < billIds.length; start += 30) {
    const chunk = billIds.slice(start, start + 30);
    const page = await sharesRef
      .where("status", "==", "aPagar")
      .where("billId", "in", chunk)
      .orderBy(FieldPath.documentId())
      .limit(501)
      .get();
    read += page.size;
    page.docs.forEach((entry) => collected.push(entry.get("billId") as string));
  }

  // Só rateios em aberto dos títulos do grupo: nada do outro grupo, nada já
  // quitado. A varredura anterior lia os 600 documentos da coleção.
  const expected = (BILLS / 2) * Math.ceil(SHARES_PER_BILL / 2);
  assert.equal(read, expected);
  assert.ok(read < totalShares / 2, "lê menos da metade da coleção");
  assert.ok(collected.every((billId) => billIds.includes(billId)));
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
