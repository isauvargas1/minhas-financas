import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {defaultAccountOf} from "../../shared/testSupport/kernelTestSupport";
import {formatIsoInstant} from "../../shared/commitTime";
import {executeRebuildCashPeriods} from "../../cash/rebuild";
import {
  deliverMirror,
  ledgerTruth,
  monthOf,
  projectedTotals,
  seedLoanTenant,
  shiftDays,
  today,
} from "../../loans/testSupport/loanTestSupport";
import {
  DEFAULT_INCOME_CATEGORY_ID,
  seedDefaultCategories,
} from "../../settingsCatalog/testSupport/categorySeeds";
import {
  call,
  expectHttpsError,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {updateCashTransaction, voidCashTransaction} from "../../cash/callables";
import {
  CLIENT_ALREADY_ARCHIVED_MESSAGE,
  CLIENT_HAS_OPEN_RECEIVABLES_MESSAGE,
  CLIENT_UNCHANGED_MESSAGE,
} from "../clientOperations";
import {PJ_ONLY_MESSAGE} from "../common";
import {
  CANCEL_WITH_RECEIPTS_MESSAGE,
  RECEIPT_ABOVE_BALANCE_MESSAGE,
  RECEIVABLE_ALREADY_CANCELLED_MESSAGE,
  RECEIVABLE_ALREADY_RECEIVED_MESSAGE,
  RECEIVABLE_AMOUNT_LOCKED_MESSAGE,
  RECEIVABLE_CANCELLED_MESSAGE,
  RECEIVABLE_CLIENT_ARCHIVED_MESSAGE,
  RECEIVABLE_MOVEMENT_ALREADY_REVERSED_MESSAGE,
  RECEIVABLE_UNCHANGED_MESSAGE,
} from "../operations";
import {
  PII,
  PII_VALUES,
  archive,
  archivePayload,
  cancel,
  cancelPayload,
  clientPayload,
  clientPrivateRef,
  clientRef,
  clientUpdatePayload,
  countOf,
  editClient,
  editReceivable,
  listOf,
  movementRef,
  newClient,
  newReceivable,
  read,
  receivablePayload,
  receivableRef,
  receivableUpdatePayload,
  receive,
  receivePayload,
  reverse,
  reversePayload,
  seedClient,
  seedReceivableTenant,
  transactionRef,
} from "../testSupport/receivableTestSupport";

const containsPii = (value: unknown): string | undefined => {
  const text = JSON.stringify(value);
  return PII_VALUES.find((pii) => text.includes(pii));
};

test("P3-I — cliente: cadastro mínimo compartilhado, dados pessoais só no " +
  "documento privado, evento sem PII, replay sem duplicar", async () => {
  const tenant = await seedReceivableTenant("rcv-client");
  const payload = clientPayload(tenant.workspaceId);
  const created = await newClient(tenant.owner, payload);
  assert.equal(created.replayed, false);
  assert.match(created.clientId, /^cli_[0-9a-f]{40}$/);
  assert.equal(containsPii(created), undefined, "resposta sem PII");

  const shared = await read(clientRef(tenant.workspaceId, created.clientId));
  // D-24: exatamente os campos compartilhados — nem hash da intenção, que
  // cobre os dados pessoais e permitiria testar candidatos a CPF/CNPJ.
  assert.deepEqual(Object.keys(shared).sort(), [
    "clientId", "createdAt", "createdBy", "name", "schemaVersion", "status",
    "updatedAt", "updatedBy", "workspaceId",
  ]);
  assert.equal(shared.name, PII.name);
  assert.equal(shared.status, "active");
  assert.equal(shared.createdBy, tenant.owner);
  assert.equal(containsPii(shared), undefined, "documento compartilhado");

  const personal = await read(
    clientPrivateRef(tenant.workspaceId, created.clientId));
  assert.equal(personal.document, PII.documentDigits);
  assert.equal(personal.email, PII.emailNormalized);
  assert.equal(personal.phone, PII.phone);
  assert.equal(personal.address, PII.address);
  assert.equal(personal.notes, PII.notes);

  const events = await listOf(tenant.workspaceId, "client_events");
  assert.equal(events.length, 1);
  assert.equal(events[0].operation, "client.created");
  assert.equal(containsPii(events), undefined, "evento sem valores pessoais");
  assert.equal(JSON.stringify(events).includes(PII.name), false);
  assert.deepEqual(events[0].changedFields,
    ["name", "document", "email", "phone", "address", "notes"]);

  const replay = await newClient(tenant.owner, payload);
  assert.deepEqual([replay.clientId, replay.replayed],
    [created.clientId, true]);
  assert.equal(await countOf(tenant.workspaceId, "clients"), 1);

  // Mesma chave, outro conteúdo: conflito.
  await expectHttpsError(newClient(tenant.owner, {...payload, name: "Outro"}),
    "failed-precondition");
  // Sem dados pessoais: o documento privado existe, vazio.
  const bare = await newClient(tenant.admin, clientPayload(tenant.workspaceId, {
    document: undefined, email: undefined, phone: undefined,
    address: undefined, notes: undefined, name: "Cliente Sem Contato",
  }));
  const barePrivate = await read(
    clientPrivateRef(tenant.workspaceId, bare.clientId));
  for (const field of ["document", "email", "phone", "address", "notes"]) {
    assert.equal(barePrivate[field], undefined, field);
  }
  // Documento com dígito verificador errado e e-mail inválido: recusados.
  await expectHttpsError(newClient(tenant.owner, clientPayload(
    tenant.workspaceId, {document: "11.222.333/0001-82"})), "invalid-argument");
  await expectHttpsError(newClient(tenant.owner, clientPayload(
    tenant.workspaceId, {email: "sem-arroba"})), "invalid-argument");
  // Campo autoritativo vindo do cliente: schema estrito recusa.
  await expectHttpsError(newClient(tenant.owner, clientPayload(
    tenant.workspaceId, {status: "archived"})), "invalid-argument");
  await expectHttpsError(newClient(tenant.owner, clientPayload(
    tenant.workspaceId, {createdBy: tenant.member})), "invalid-argument");
});

test("P3-I — cliente: edição de nome e dados privados, limpeza de campo, " +
  "sem efeito recusada, versão concorrente recusada", async () => {
  const tenant = await seedReceivableTenant("rcv-client-edit");
  const clientId = await seedClient(tenant);
  const edited = await editClient(tenant.admin, await clientUpdatePayload(
    tenant.workspaceId, clientId, {name: "Comercial Renomeado Ltda.",
      phone: null, notes: "Atualizado"}));
  assert.equal(edited.changed, true);
  assert.equal((await read(clientRef(tenant.workspaceId, clientId))).name,
    "Comercial Renomeado Ltda.");
  const personal = await read(clientPrivateRef(tenant.workspaceId, clientId));
  assert.equal(personal.phone, undefined);
  assert.equal(personal.notes, "Atualizado");
  assert.equal(personal.email, PII.emailNormalized);
  const updateEvent = (await listOf(tenant.workspaceId, "client_events"))
    .find((event) => event.operation === "client.updated");
  assert.deepEqual(updateEvent?.changedFields, ["name", "notes", "phone"]);
  assert.equal(JSON.stringify(updateEvent).includes("Atualizado"), false);

  await expectHttpsError(editClient(tenant.owner, await clientUpdatePayload(
    tenant.workspaceId, clientId, {email: PII.email})),
  "failed-precondition", {message: CLIENT_UNCHANGED_MESSAGE});
  const stale = await clientUpdatePayload(tenant.workspaceId, clientId,
    {address: "Outra rua"});
  await editClient(tenant.owner, await clientUpdatePayload(tenant.workspaceId,
    clientId, {address: "Rua concorrente"}));
  await expectHttpsError(editClient(tenant.owner, stale), "aborted");
});

test("P3-I — recebível: criação sem caixa; recebimentos parciais com juros, " +
  "multa e desconto; quitação; caixa = principal + juros + multa",
async () => {
  const tenant = await seedReceivableTenant("rcv-life");
  const clientId = await seedClient(tenant);
  const created = await newReceivable(tenant.member,
    receivablePayload(tenant.workspaceId, clientId, {amountCents: 100_000}));
  assert.match(created.receivableId, /^rcv_[0-9a-f]{40}$/);
  const id = created.receivableId;
  let doc = await read(receivableRef(tenant.workspaceId, id));
  assert.equal(doc.status, "open");
  assert.equal(doc.balanceCents, 100_000);
  assert.equal(doc.createdBy, tenant.member);
  assert.equal(doc.schemaVersion, 1);
  assert.equal(containsPii(doc), undefined, "recebível sem PII do cliente");
  for (const field of ["value", "paymentDate", "overdue", "pending", "paid"]) {
    assert.equal(field in doc, false, field);
  }
  // Criar não move caixa.
  assert.equal(await countOf(tenant.workspaceId, "transactions"), 0);

  // 1º: principal parcial.
  const first = await receive(tenant.member, await receivePayload(
    tenant.workspaceId, id, {principalCents: 30_000}));
  assert.equal(first.status, "open");
  assert.equal(first.balanceCents, 70_000);
  // 2º: principal + juros + multa.
  const second = await receive(tenant.member, await receivePayload(
    tenant.workspaceId, id, {principalCents: 20_000, interestCents: 1_500,
      penaltyCents: 800}));
  assert.equal(second.balanceCents, 50_000);
  // 3º: quitação com desconto (R$ 450 pagos + R$ 50 de desconto).
  const third = await receive(tenant.member, await receivePayload(
    tenant.workspaceId, id, {principalCents: 45_000, discountCents: 5_000}));
  assert.equal(third.status, "received");
  assert.equal(third.balanceCents, 0);

  doc = await read(receivableRef(tenant.workspaceId, id));
  assert.deepEqual([doc.principalReceivedCents, doc.discountGrantedCents,
    doc.interestReceivedCents, doc.penaltyReceivedCents,
    doc.activeReceiptCount], [95_000, 5_000, 1_500, 800, 3]);

  const mirrors = await listOf(tenant.workspaceId, "transactions");
  assert.equal(mirrors.length, 3, "um espelho por recebimento com dinheiro");
  const cash = mirrors.reduce((total, m) => total + Number(m.valueCents), 0);
  assert.equal(cash, 30_000 + 20_000 + 1_500 + 800 + 45_000,
    "o desconto não entra no caixa");
  const third$ = await read(transactionRef(tenant.workspaceId,
    third.cashTransactionId as string));
  assert.equal(third$.valueCents, 45_000);
  assert.equal(third$.type, "receita");
  assert.equal(third$.description, "Recebimento de recebível");
  assert.equal(third$.category, "Recebíveis");
  assert.equal(
    (third$.receivableEntry as Record<string, unknown>).discountCents, 5_000);
  for (const mirror of mirrors) {
    assert.equal(containsPii(mirror), undefined, "espelho sem PII");
    assert.equal(JSON.stringify(mirror).includes(PII.name), false);
    assert.equal(JSON.stringify(mirror).includes("Consultoria"), false,
      "espelho sem a descrição do recebível");
  }
  // Projeção: principal = receita operacional; juros + multa = financeira.
  for (const result of [first, second, third]) {
    await deliverMirror(tenant.workspaceId, result.cashTransactionId as string);
  }
  const truth = await ledgerTruth(tenant.workspaceId);
  const month = truth[monthOf(today())];
  assert.equal(month.incomeCents, 95_000);
  assert.equal(month.financialIncomeCents, 2_300);
  assert.equal(month.netCents, 97_300);
  assert.equal(month.expenseCents, 0);
  assert.deepEqual(await projectedTotals(tenant.workspaceId), truth);

  // Quitado: nada mais a receber.
  await expectHttpsError(receive(tenant.member, await receivePayload(
    tenant.workspaceId, id, {principalCents: 1})),
  "failed-precondition", {message: RECEIVABLE_ALREADY_RECEIVED_MESSAGE});
  // Movimentos: três fatos imutáveis com o detalhamento.
  const movements = await listOf(tenant.workspaceId, "receivable_movements");
  assert.equal(movements.length, 3);
  const discounted = movements.find((m) => m.discountCents === 5_000);
  assert.equal(discounted?.cashCents, 45_000);
  // O espelho não é corrigido nem anulado pelo caixa manual.
  await seedDefaultCategories(tenant.workspaceId);
  const mirrorVersion = formatIsoInstant(third$.updatedAt as Timestamp);
  await expectHttpsError(call(updateCashTransaction, tenant.owner, {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId: third.cashTransactionId,
    expectedUpdatedAt: mirrorVersion,
    reason: "Tentativa pelo caixa manual",
    entry: {type: "receita", description: "Outro",
      categoryId: DEFAULT_INCOME_CATEGORY_ID, amountCents: 1, date: today(),
      cashAccountId: defaultAccountOf(tenant.workspaceId)},
  }), "failed-precondition");
  await expectHttpsError(call(voidCashTransaction, tenant.owner, {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId: third.cashTransactionId,
    expectedUpdatedAt: mirrorVersion,
    reason: "Tentativa pelo caixa manual",
  }), "failed-precondition");
  const intact = await read(transactionRef(tenant.workspaceId,
    third.cashTransactionId as string));
  assert.equal(intact.valueCents, 45_000);
  assert.equal(intact.voidedAt, undefined);
});

test("P3-I — exemplo D-39: saldo R$ 1.000, paga R$ 900 com R$ 100 de " +
  "desconto; caixa recebe R$ 900; desconto puro não gera espelho",
async () => {
  const tenant = await seedReceivableTenant("rcv-d39");
  const clientId = await seedClient(tenant);
  const {receivableId} = await newReceivable(tenant.owner, receivablePayload(
    tenant.workspaceId, clientId, {amountCents: 100_000}));
  const paid = await receive(tenant.owner, await receivePayload(
    tenant.workspaceId, receivableId, {principalCents: 90_000,
      discountCents: 10_000}));
  assert.equal(paid.status, "received");
  const mirror = await read(transactionRef(tenant.workspaceId,
    paid.cashTransactionId as string));
  assert.equal(mirror.valueCents, 90_000);

  const other = await newReceivable(tenant.owner, receivablePayload(
    tenant.workspaceId, clientId, {amountCents: 10_000}));
  const discountOnly = await receive(tenant.owner, await receivePayload(
    tenant.workspaceId, other.receivableId, {principalCents: 0,
      discountCents: 2_500}));
  assert.equal(discountOnly.cashTransactionId, null);
  assert.equal(discountOnly.balanceCents, 7_500);
  assert.equal(await countOf(tenant.workspaceId, "transactions"), 1);
  // Principal + desconto acima do saldo: recusado sem gravar.
  await expectHttpsError(receive(tenant.owner, await receivePayload(
    tenant.workspaceId, other.receivableId, {principalCents: 7_000,
      discountCents: 501})),
  "failed-precondition", {message: RECEIPT_ABOVE_BALANCE_MESSAGE});
  // Centavo: o último centavo quita.
  await receive(tenant.owner, await receivePayload(tenant.workspaceId,
    other.receivableId, {principalCents: 7_499}));
  const last = await receive(tenant.owner, await receivePayload(
    tenant.workspaceId, other.receivableId, {principalCents: 1}));
  assert.deepEqual([last.status, last.balanceCents], ["received", 0]);
  // Sem efeito, float, negativo e data futura: recusados pelo schema.
  for (const overrides of [
    {principalCents: 0},
    {principalCents: 10.5},
    {principalCents: -1},
    {paymentDate: shiftDays(today(), 1)},
  ]) {
    const third = await newReceivable(tenant.owner, receivablePayload(
      tenant.workspaceId, clientId));
    await expectHttpsError(receive(tenant.owner, await receivePayload(
      tenant.workspaceId, third.receivableId, overrides)), "invalid-argument");
  }
  await expectHttpsError(newReceivable(tenant.owner, receivablePayload(
    tenant.workspaceId, clientId, {amountCents: 100_000_000_001})),
  "invalid-argument");
  await expectHttpsError(newReceivable(tenant.owner, receivablePayload(
    tenant.workspaceId, clientId, {amountCents: 1999.99})), "invalid-argument");
});

test("P3-I — estorno: restaura principal, desconto, juros, multa, saldo e " +
  "caixa; segundo estorno recusado; replay idempotente", async () => {
  const tenant = await seedReceivableTenant("rcv-rev");
  const clientId = await seedClient(tenant);
  const {receivableId} = await newReceivable(tenant.owner, receivablePayload(
    tenant.workspaceId, clientId, {amountCents: 50_000}));
  const paid = await receive(tenant.owner, await receivePayload(
    tenant.workspaceId, receivableId, {principalCents: 45_000,
      interestCents: 900, penaltyCents: 300, discountCents: 5_000}));
  assert.equal(paid.status, "received");

  const payload = await reversePayload(tenant.workspaceId, receivableId,
    paid.movementId as string);
  const reversed = await reverse(tenant.owner, payload);
  assert.deepEqual([reversed.status, reversed.balanceCents], ["open", 50_000]);
  const doc = await read(receivableRef(tenant.workspaceId, receivableId));
  assert.deepEqual([doc.principalReceivedCents, doc.discountGrantedCents,
    doc.interestReceivedCents, doc.penaltyReceivedCents,
    doc.activeReceiptCount], [0, 0, 0, 0, 0]);
  const original = await read(movementRef(tenant.workspaceId,
    paid.movementId as string));
  assert.equal(original.reversedBy, reversed.movementId);
  const compensation = await read(movementRef(tenant.workspaceId,
    reversed.movementId as string));
  assert.deepEqual([compensation.kind, compensation.reversalOf,
    compensation.date, compensation.reason],
  ["reversal", paid.movementId, original.date,
    "Recebimento lançado em duplicidade"]);
  const mirror = await read(transactionRef(tenant.workspaceId,
    reversed.cashTransactionId as string));
  assert.deepEqual([mirror.type, mirror.valueCents], ["despesa", 46_200]);

  for (const id of [paid.cashTransactionId, reversed.cashTransactionId]) {
    await deliverMirror(tenant.workspaceId, id as string);
  }
  const truth = await ledgerTruth(tenant.workspaceId);
  const month = truth[monthOf(original.date as string)];
  for (const field of ["incomeCents", "financialIncomeCents", "netCents",
    "expenseCents", "financialExpenseCents"] as const) {
    assert.equal(month[field], 0, `fato + estorno somam zero em ${field}`);
  }
  assert.equal(month.transactionCount, 2, "os dois documentos permanecem");
  assert.deepEqual(await projectedTotals(tenant.workspaceId), truth);

  const replay = await reverse(tenant.owner, payload);
  assert.deepEqual([replay.replayed, replay.movementId],
    [true, reversed.movementId]);
  await expectHttpsError(reverse(tenant.owner, await reversePayload(
    tenant.workspaceId, receivableId, paid.movementId as string)),
  "failed-precondition",
  {message: RECEIVABLE_MOVEMENT_ALREADY_REVERSED_MESSAGE});
  await expectHttpsError(reverse(tenant.owner, await reversePayload(
    tenant.workspaceId, receivableId, reversed.movementId as string)),
  "failed-precondition");
  assert.equal(await countOf(tenant.workspaceId, "receivable_movements"), 2);
  assert.equal(await countOf(tenant.workspaceId, "transactions"), 2);
});

test("P3-I — cancelamento lógico: recusado com recebimento ativo; sem caixa; " +
  "terminal; histórico preservado", async () => {
  const tenant = await seedReceivableTenant("rcv-cancel");
  const clientId = await seedClient(tenant);
  const {receivableId} = await newReceivable(tenant.owner, receivablePayload(
    tenant.workspaceId, clientId, {amountCents: 20_000}));
  const paid = await receive(tenant.owner, await receivePayload(
    tenant.workspaceId, receivableId, {principalCents: 5_000}));
  await expectHttpsError(cancel(tenant.owner, await cancelPayload(
    tenant.workspaceId, receivableId)),
  "failed-precondition", {message: CANCEL_WITH_RECEIPTS_MESSAGE});
  await reverse(tenant.owner, await reversePayload(tenant.workspaceId,
    receivableId, paid.movementId as string));
  const before = await countOf(tenant.workspaceId, "transactions");
  const cancelled = await cancel(tenant.owner, await cancelPayload(
    tenant.workspaceId, receivableId));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(await countOf(tenant.workspaceId, "transactions"), before,
    "cancelar não grava caixa");
  const doc = await read(receivableRef(tenant.workspaceId, receivableId));
  assert.equal(doc.cancelReason, "Cobrança emitida por engano");
  assert.equal(await countOf(tenant.workspaceId, "receivable_movements"), 2);
  // Terminal: nada reativa.
  await expectHttpsError(receive(tenant.owner, await receivePayload(
    tenant.workspaceId, receivableId)),
  "failed-precondition", {message: RECEIVABLE_CANCELLED_MESSAGE});
  await expectHttpsError(editReceivable(tenant.owner,
    await receivableUpdatePayload(tenant.workspaceId, receivableId,
      {description: "reabrir"})),
  "failed-precondition", {message: RECEIVABLE_CANCELLED_MESSAGE});
  await expectHttpsError(cancel(tenant.owner, await cancelPayload(
    tenant.workspaceId, receivableId)),
  "failed-precondition", {message: RECEIVABLE_ALREADY_CANCELLED_MESSAGE});
  const events = await listOf(tenant.workspaceId, "receivable_events");
  assert.deepEqual(events.map((event) => event.operation).sort(), [
    "receivable.cancelled", "receivable.created",
    "receivable.receipt_reversed", "receivable.received",
  ]);
  assert.equal(containsPii(events), undefined);
});

test("P3-I — edição: descrição, categoria e vencimento; valor só sem " +
  "recebimento ativo; sem efeito recusada", async () => {
  const tenant = await seedReceivableTenant("rcv-edit");
  const clientId = await seedClient(tenant);
  const {receivableId} = await newReceivable(tenant.owner, receivablePayload(
    tenant.workspaceId, clientId, {amountCents: 30_000, category: "Serviços"}));
  const amount = await editReceivable(tenant.owner,
    await receivableUpdatePayload(tenant.workspaceId, receivableId, {
      amountCents: 35_000, dueDate: shiftDays(today(), 10), category: null,
      description: "Consultoria ajustada"}));
  assert.deepEqual([amount.balanceCents, amount.status], [35_000, "open"]);
  let doc = await read(receivableRef(tenant.workspaceId, receivableId));
  assert.equal(doc.category, undefined);
  assert.equal(doc.description, "Consultoria ajustada");
  const paid = await receive(tenant.owner, await receivePayload(
    tenant.workspaceId, receivableId, {principalCents: 10_000}));
  await expectHttpsError(editReceivable(tenant.owner,
    await receivableUpdatePayload(tenant.workspaceId, receivableId,
      {amountCents: 40_000})),
  "failed-precondition", {message: RECEIVABLE_AMOUNT_LOCKED_MESSAGE});
  // Corrigir vencimento continua possível.
  await editReceivable(tenant.owner, await receivableUpdatePayload(
    tenant.workspaceId, receivableId, {dueDate: shiftDays(today(), -3)}));
  await expectHttpsError(editReceivable(tenant.owner,
    await receivableUpdatePayload(tenant.workspaceId, receivableId,
      {dueDate: shiftDays(today(), -3)})),
  "failed-precondition", {message: RECEIVABLE_UNCHANGED_MESSAGE});
  // Depois do estorno, o valor volta a ser editável.
  await reverse(tenant.owner, await reversePayload(tenant.workspaceId,
    receivableId, paid.movementId as string));
  await editReceivable(tenant.owner, await receivableUpdatePayload(
    tenant.workspaceId, receivableId, {amountCents: 40_000}));
  doc = await read(receivableRef(tenant.workspaceId, receivableId));
  assert.deepEqual([doc.amountCents, doc.balanceCents], [40_000, 40_000]);
  // Campos autoritativos vindos do cliente: recusados.
  for (const changes of [{status: "received"}, {balanceCents: 0},
    {principalReceivedCents: 1}]) {
    await expectHttpsError(editReceivable(tenant.owner,
      await receivableUpdatePayload(tenant.workspaceId, receivableId,
        changes)), "invalid-argument");
  }
});

test("P3-I — arquivar cliente: bloqueado com recebível em aberto; arquivado " +
  "não recebe novo recebível; histórico continua referenciado", async () => {
  const tenant = await seedReceivableTenant("rcv-archive");
  const clientId = await seedClient(tenant);
  const {receivableId} = await newReceivable(tenant.owner, receivablePayload(
    tenant.workspaceId, clientId, {amountCents: 10_000}));
  await expectHttpsError(archive(tenant.owner, await archivePayload(
    tenant.workspaceId, clientId)),
  "failed-precondition", {message: CLIENT_HAS_OPEN_RECEIVABLES_MESSAGE});
  await receive(tenant.owner, await receivePayload(tenant.workspaceId,
    receivableId, {principalCents: 10_000}));
  const archived = await archive(tenant.admin, await archivePayload(
    tenant.workspaceId, clientId));
  assert.equal(archived.status, "archived");
  assert.equal((await read(clientRef(tenant.workspaceId, clientId))).status,
    "archived");
  assert.equal((await read(receivableRef(tenant.workspaceId, receivableId)))
    .clientId, clientId);
  await expectHttpsError(newReceivable(tenant.owner, receivablePayload(
    tenant.workspaceId, clientId)),
  "failed-precondition", {message: RECEIVABLE_CLIENT_ARCHIVED_MESSAGE});
  await expectHttpsError(archive(tenant.owner, await archivePayload(
    tenant.workspaceId, clientId)),
  "failed-precondition", {message: CLIENT_ALREADY_ARCHIVED_MESSAGE});
  // Nenhuma exclusão física.
  assert.equal(await countOf(tenant.workspaceId, "clients"), 1);
  assert.equal(await countOf(tenant.workspaceId, "client_private"), 1);
});

test("P3-I — somente espaço PJ", async () => {
  const pf = await seedLoanTenant("PF", "rcv-pf");
  await expectHttpsError(newClient(pf.owner, clientPayload(pf.workspaceId)),
    "failed-precondition", {message: PJ_ONLY_MESSAGE});
});

test("P3-I — reconstrução do caixa reproduz exatamente a classificação dos " +
  "recebimentos", async () => {
  const tenant = await seedReceivableTenant("rcv-rebuild");
  const clientId = await seedClient(tenant);
  const a = await newReceivable(tenant.owner, receivablePayload(
    tenant.workspaceId, clientId, {amountCents: 80_000,
      dueDate: shiftDays(today(), -40)}));
  const b = await newReceivable(tenant.owner, receivablePayload(
    tenant.workspaceId, clientId, {amountCents: 20_000}));
  const r1 = await receive(tenant.owner, await receivePayload(
    tenant.workspaceId, a.receivableId, {principalCents: 50_000,
      interestCents: 2_000, penaltyCents: 1_000,
      paymentDate: shiftDays(today(), -35)}));
  const r2 = await receive(tenant.owner, await receivePayload(
    tenant.workspaceId, b.receivableId, {principalCents: 15_000,
      discountCents: 5_000}));
  const r3 = await reverse(tenant.owner, await reversePayload(
    tenant.workspaceId, b.receivableId, r2.movementId as string));
  for (const id of [r1.cashTransactionId, r2.cashTransactionId,
    r3.cashTransactionId]) {
    await deliverMirror(tenant.workspaceId, id as string);
  }
  const truth = await ledgerTruth(tenant.workspaceId);
  assert.deepEqual(await projectedTotals(tenant.workspaceId), truth);
  const earlier = truth[monthOf(shiftDays(today(), -35))];
  assert.deepEqual([earlier.incomeCents, earlier.financialIncomeCents,
    earlier.netCents], [50_000, 3_000, 53_000]);

  const rebuild = (dryRun: boolean) => executeRebuildCashPeriods(
    tenant.workspaceId, tenant.owner, {
      workspaceId: tenant.workspaceId,
      idempotencyKey: idempotencyKey(),
      correlationId: "corr-rcv-rebuild",
      pageSize: 50,
      reason: "Reconciliação P3-I",
      dryRun,
    });
  const simulated = await rebuild(true) as Record<string, unknown>;
  assert.equal((simulated.divergence as {divergentPeriods: number})
    .divergentPeriods, 0);
  const published = await rebuild(false) as Record<string, unknown>;
  assert.equal(published.completed, true);
  assert.deepEqual(await projectedTotals(tenant.workspaceId), truth);
});
