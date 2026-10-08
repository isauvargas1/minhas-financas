import assert from "node:assert/strict";
import test from "node:test";

import {Timestamp} from "firebase-admin/firestore";

import {splitCashEffect, readSplitCashEntry} from "../cashEffect";
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  acceptSplitInvitePayloadSchema,
  createSplitBillPayloadSchema,
  createSplitGroupPayloadSchema,
  forgiveSplitSharePayloadSchema,
  paySplitReimbursementPayloadSchema,
  updateSplitBillPayloadSchema,
} from "../contracts";
import {
  readAuthoritativeBill,
  readAuthoritativeParticipant,
  readAuthoritativeShare,
  splitInviteIdFor,
  splitMemberParticipantIdFor,
} from "../model";
import {generateInviteCode} from "../participantOperations";
import {reconstructGroupAggregates} from "../reconciliation";

/**
 * Contratos, leitores e efeito de caixa da Divisão de contas (P4-C).
 * Contratos estritos: nada autoritativo vem do cliente (dono, papel,
 * estado, valores dos rateios no modo igual/percentual, `userName`).
 */
const base = {workspaceId: "ws-1", idempotencyKey: "idem-split-1"};
const bill = {
  ...base,
  groupId: "sgr_1",
  description: "Jantar",
  category: "Alimentação",
  amountCents: 10_000,
  expenseDate: "2026-10-01",
  payerParticipantId: "spt_a",
  allocationMethod: "equal",
  participants: [{participantId: "spt_a"}, {participantId: "spt_b"}],
  financialIntegration: "none",
  cashAccountId: null,
  cardId: null,
  installmentsCount: null,
};

test("grupo: campos autoritativos e formato antigo são recusados", () => {
  const group = {...base, name: "Viagem", description: null,
    groupType: "temporary", businessMode: "split",
    visual: {color: "#6366f1", icon: "Users", emoji: null}};
  assert.equal(createSplitGroupPayloadSchema.safeParse(group).success, true);
  for (const extra of [{ownerUserId: "u1"}, {status: "archived"},
    {ativo: true}, {nome: "X"}, {createdBy: "u1"}]) {
    assert.equal(createSplitGroupPayloadSchema.safeParse({...group, ...extra})
      .success, false, JSON.stringify(extra));
  }
  assert.equal(createSplitGroupPayloadSchema.safeParse({...group,
    groupType: "fixo"}).success, false);
});

test("título: centavos inteiros, rateio exato e destino coerente", () => {
  assert.equal(createSplitBillPayloadSchema.safeParse(bill).success, true);
  const invalid: Record<string, unknown>[] = [
    {amountCents: 100.5},
    {amountCents: 0},
    {expenseDate: "2026-02-30"},
    {allocationMethod: "percentage",
      participants: [{participantId: "spt_a", weightBps: 5_000},
        {participantId: "spt_b", weightBps: 4_999}]},
    {allocationMethod: "fixed",
      participants: [{participantId: "spt_a", amountCents: 5_000},
        {participantId: "spt_b", amountCents: 5_001}]},
    {financialIntegration: "cash"},
    {financialIntegration: "card", cardId: "card_1"},
    {financialIntegration: "none", cashAccountId: "acc_1"},
    {shares: []},
    {status: "settled"},
    {payerUserId: "u1"},
    {valorReal: 100},
  ];
  for (const change of invalid) {
    assert.equal(createSplitBillPayloadSchema.safeParse({...bill, ...change})
      .success, false, JSON.stringify(change));
  }
  assert.equal(createSplitBillPayloadSchema.safeParse({...bill,
    financialIntegration: "card", cardId: "card_1", installmentsCount: 3})
    .success, true);
});

test("edição: metadados e/ou termos; vazio é recusado", () => {
  const update = {...base, billId: "sbl_1",
    expectedUpdatedAt: "2026-10-01T12:00:00.000000000Z"};
  assert.equal(updateSplitBillPayloadSchema.safeParse(update).success, false);
  assert.equal(updateSplitBillPayloadSchema.safeParse({...update,
    metadata: {}}).success, false);
  assert.equal(updateSplitBillPayloadSchema.safeParse({...update,
    metadata: {category: "Lazer"}}).success, true);
});

test("aceite: só o código, normalizado; `userName` não existe", () => {
  const parsed = acceptSplitInvitePayloadSchema.parse({...base,
    code: " abcd-efgh 23 "});
  assert.equal(parsed.code, "ABCDEFGH23");
  assert.equal(acceptSplitInvitePayloadSchema.safeParse({...base,
    code: "ABCDEFGH23", userName: "Você"}).success, false);
  assert.equal(acceptSplitInvitePayloadSchema.safeParse({...base,
    code: "ABC"}).success, false);
  // `0`, `O`, `1`, `I` e `L` não existem no alfabeto (ditado sem ambiguidade).
  assert.equal(acceptSplitInvitePayloadSchema.safeParse({...base,
    code: "ABCDEFGH0O"}).success, false);
});

test("perdão exige motivo; pagamento exige conta e data", () => {
  const share = {...base, shareId: "ssh_1",
    expectedUpdatedAt: "2026-10-01T12:00:00.000000000Z"};
  assert.equal(forgiveSplitSharePayloadSchema.safeParse(share).success, false);
  assert.equal(forgiveSplitSharePayloadSchema.safeParse({...share,
    reason: "   "}).success, false);
  assert.equal(forgiveSplitSharePayloadSchema.safeParse({...share,
    reason: "Acerto"}).success, true);
  const pay = {...base, reimbursementId: "srb_1",
    expectedUpdatedAt: "2026-10-01T12:00:00.000000000Z"};
  assert.equal(paySplitReimbursementPayloadSchema.safeParse(pay).success,
    false);
  assert.equal(paySplitReimbursementPayloadSchema.safeParse({...pay,
    cashAccountId: "acc_1", paymentDate: "2026-10-02"}).success, true);
});

test("código do convite: 10 caracteres do alfabeto, CSPRNG, sem repetição",
  () => {
    const codes = new Set<string>();
    for (let index = 0; index < 2_000; index += 1) {
      const code = generateInviteCode();
      assert.equal(code.length, INVITE_CODE_LENGTH);
      assert.ok([...code].every((char) => INVITE_CODE_ALPHABET.includes(char)));
      codes.add(code);
    }
    assert.equal(codes.size, 2_000);
    // O ID deriva do código e do workspace: nunca o código em claro.
    const id = splitInviteIdFor("ws-1", "ABCDEFGH23");
    assert.match(id, /^sinv_[0-9a-f]{40}$/);
    assert.notEqual(id, splitInviteIdFor("ws-2", "ABCDEFGH23"));
    assert.equal(id.includes("ABCDEFGH23"), false);
  });

const now = Timestamp.fromMillis(Date.parse("2026-10-07T15:00:00.000Z"));

const participantDoc = (overrides: Record<string, unknown> = {}) => ({
  id: "spt_a", schemaVersion: 1, workspaceId: "ws-1", groupId: "sgr_1",
  kind: "workspace_member", userId: "u1", displayName: null, role: "owner",
  status: "active", color: "#6366f1",
  balances: {dueCents: 0, paidCents: 0, owesOpenCents: 0,
    receivableOpenCents: 0},
  openShareCount: 0, openReceivableCount: 0, openReimbursementCount: 0,
  revision: 1, updatedAt: now, ...overrides,
});

test("participante: externo só com nome, sem login e sem papel de dono", () => {
  assert.ok(readAuthoritativeParticipant("spt_a", participantDoc(), "ws-1"));
  const external = participantDoc({kind: "external", userId: null,
    displayName: "Carla", role: "participant"});
  assert.ok(readAuthoritativeParticipant("spt_a", external, "ws-1"));
  for (const change of [{role: "owner"}, {role: "viewer"},
    {userId: "u2"}, {displayName: null}]) {
    assert.equal(readAuthoritativeParticipant("spt_a",
      {...external, ...change}, "ws-1"), null, JSON.stringify(change));
  }
  // Membro sem `userId` ou formato antigo: fora do schema.
  assert.equal(readAuthoritativeParticipant("spt_a",
    participantDoc({userId: null}), "ws-1"), null);
  assert.equal(readAuthoritativeParticipant("spt_a",
    {...participantDoc(), papel: "dono", nomeExibicao: "Você",
      schemaVersion: undefined}, "ws-1"), null);
  // A identidade é o `uid`: ID determinístico por (workspace, grupo, uid).
  assert.equal(splitMemberParticipantIdFor("ws-1", "sgr_1", "u1"),
    splitMemberParticipantIdFor("ws-1", "sgr_1", "u1"));
  assert.notEqual(splitMemberParticipantIdFor("ws-1", "sgr_1", "u1"),
    splitMemberParticipantIdFor("ws-1", "sgr_2", "u1"));
});

const billDoc = (overrides: Record<string, unknown> = {}) => ({
  id: "sbl_1", schemaVersion: 1, workspaceId: "ws-1", groupId: "sgr_1",
  description: "Jantar", category: "Alimentação",
  categoryBucket: "Alimentação", amountCents: 10_000, currency: "BRL",
  expenseDate: "2026-10-01", payerParticipantId: "spt_a", payerUserId: "u1",
  allocationMethod: "equal", participantIds: ["spt_a", "spt_b"],
  financialIntegration: "none", cashAccountId: null, cardId: null,
  installmentsCount: null, cashTransactionId: null, purchaseId: null,
  status: "open", shareCount: 2, openShareCount: 1, resolvedShareCount: 0,
  outstandingCents: 5_000, termsRevision: 1, createdBy: "u1", revision: 1,
  updatedAt: now, ...overrides,
});

test("título: estado derivado e destino coerentes no leitor", () => {
  assert.ok(readAuthoritativeBill("sbl_1", billDoc(), "ws-1"));
  for (const change of [
    {status: "settled"},
    {openShareCount: 0},
    {outstandingCents: 0},
    {categoryBucket: "Outra"},
    {financialIntegration: "cash"},
    {financialIntegration: "card", cardId: "c1", purchaseId: "p1",
      installmentsCount: 0},
    {financialIntegration: "cash", cashAccountId: "a1",
      cashTransactionId: "t1", payerUserId: null},
    {amountCents: 100.5},
  ]) {
    assert.equal(readAuthoritativeBill("sbl_1", billDoc(change), "ws-1"),
      null, JSON.stringify(change));
  }
  assert.ok(readAuthoritativeBill("sbl_1", billDoc({categoryBucket: "Outras"}),
    "ws-1"));
});

const shareDoc = (overrides: Record<string, unknown> = {}) => ({
  id: "ssh_1", schemaVersion: 1, workspaceId: "ws-1", groupId: "sgr_1",
  billId: "sbl_1", participantId: "spt_b", isPayerShare: false,
  weightBps: null, amountDueCents: 5_000, amountSettledCents: 0,
  status: "open", settledVia: null, termsRevision: 1, revision: 1,
  updatedAt: now, ...overrides,
});

test("rateio: estado × valores coerentes; a parte do pagador nunca fica aberta",
  () => {
    assert.ok(readAuthoritativeShare("ssh_1", shareDoc(), "ws-1"));
    assert.ok(readAuthoritativeShare("ssh_1", shareDoc({status: "settled",
      amountSettledCents: 5_000, settledVia: "settlement"}), "ws-1"));
    assert.ok(readAuthoritativeShare("ssh_1", shareDoc({isPayerShare: true,
      status: "settled", amountSettledCents: 5_000, settledVia: "payer_self"}),
    "ws-1"));
    for (const change of [
      {isPayerShare: true},
      {amountSettledCents: 100},
      {status: "settled", amountSettledCents: 4_999, settledVia: "settlement"},
      {status: "settled", amountSettledCents: 5_000, settledVia: "payer_self"},
      {status: "forgiven", amountSettledCents: 5_000},
      {amountDueCents: 0},
    ]) {
      assert.equal(readAuthoritativeShare("ssh_1", shareDoc(change), "ws-1"),
        null, JSON.stringify(change));
    }
  });

test("efeito de caixa: despesa operacional; fato + compensação somam zero",
  () => {
    const entry = {domainVersion: 1, kind: "bill_expense", groupId: "sgr_1",
      billId: "sbl_1", reimbursementId: null, reversal: false,
      reversalOf: null, amountCents: 12_345, currency: "BRL"};
    const fact = readSplitCashEntry(entry);
    const reversal = readSplitCashEntry({...entry, reversal: true,
      reversalOf: "scash_1"});
    assert.ok(fact && reversal);
    assert.deepEqual(splitCashEffect(fact), {expenseCents: 12_345,
      netCents: -12_345});
    assert.deepEqual(splitCashEffect(reversal), {expenseCents: -12_345,
      netCents: 12_345});
    for (const change of [{billId: null}, {reimbursementId: "srb_1"},
      {reversal: true}, {amountCents: 0}, {amountCents: 1.5},
      {kind: "parcelado"}, {domainVersion: 2}]) {
      assert.equal(readSplitCashEntry({...entry, ...change}), null,
        JSON.stringify(change));
    }
    assert.ok(readSplitCashEntry({...entry, kind: "reimbursement_payment",
      billId: null, reimbursementId: "srb_1"}));
  });

test("reconstrução: agregados a partir das fontes, sem anulados", () => {
  const participants = [
    readAuthoritativeParticipant("spt_a", participantDoc(), "ws-1"),
    readAuthoritativeParticipant("spt_b", participantDoc({id: "spt_b",
      userId: "u2", role: "participant"}), "ws-1"),
  ];
  const bills = [
    readAuthoritativeBill("sbl_1", billDoc(), "ws-1"),
    readAuthoritativeBill("sbl_2", billDoc({id: "sbl_2", status: "voided",
      openShareCount: 0, outstandingCents: 0}), "ws-1"),
  ];
  const shares = [
    readAuthoritativeShare("ssh_a", shareDoc({id: "ssh_a",
      participantId: "spt_a", isPayerShare: true, status: "settled",
      amountSettledCents: 5_000, settledVia: "payer_self"}), "ws-1"),
    readAuthoritativeShare("ssh_b", shareDoc({id: "ssh_b"}), "ws-1"),
    readAuthoritativeShare("ssh_v", shareDoc({id: "ssh_v", billId: "sbl_2",
      status: "voided"}), "ws-1"),
  ];
  assert.ok(participants.every(Boolean) && bills.every(Boolean) &&
    shares.every(Boolean));
  const result = reconstructGroupAggregates({
    participants: participants as NonNullable<typeof participants[number]>[],
    bills: bills as NonNullable<typeof bills[number]>[],
    shares: shares as NonNullable<typeof shares[number]>[],
    reimbursements: [],
  });
  assert.equal(result.totals.billedCents, 10_000);
  assert.equal(result.totals.openCents, 5_000);
  assert.deepEqual(result.totals.categoryTotals, {"Alimentação": 10_000});
  assert.equal(result.counters.billCount, 1);
  assert.equal(result.counters.openShareCount, 1);
  assert.deepEqual(result.participants.get("spt_a")?.balances,
    {dueCents: 5_000, paidCents: 10_000, owesOpenCents: 0,
      receivableOpenCents: 5_000});
  assert.deepEqual(result.participants.get("spt_b")?.balances,
    {dueCents: 5_000, paidCents: 0, owesOpenCents: 5_000,
      receivableOpenCents: 0});
  assert.equal(result.bills.get("sbl_1")?.dueSumCents, 10_000);
});
