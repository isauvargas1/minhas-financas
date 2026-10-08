import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  toSplitBill,
  toSplitGroup,
  toSplitInvite,
  toSplitParticipant,
  toSplitReimbursement,
  toSplitShare,
} from '../../src/modules/split-bills/adapters.ts';
import { SPLIT_CALLABLES, createSplitCallables } from '../../src/modules/split-bills/callables.ts';
import {
  SplitInputError,
  amountInputToCents,
  bpsToPercentInput,
  centsToAmountInput,
  inputsFromShares,
  isValidInviteCode,
  normalizeInviteCode,
  percentInputToBps,
  previewAllocation,
  requireReason,
  toBillTerms,
  toCreateBillPayload,
  toCreateGroupPayload,
  toCreateReimbursementPayload,
  toExternalParticipantPayload,
  toGroupChanges,
  type SplitBillFormState,
  type SplitGroupFormState,
} from '../../src/modules/split-bills/payloads.ts';
import {
  canCancelReimbursement,
  canEditBill,
  canForgiveShare,
  canSettleShare,
  canVoidBill,
  formatBps,
  groupPermissions,
  participantName,
  shareStatusText,
  splitErrorView,
} from '../../src/modules/split-bills/presentation.ts';
import type { SplitBill, SplitParticipant, SplitShare } from '../../src/modules/split-bills/types.ts';
import { splitGroupsQuotaView } from '../../src/modules/billing/transactionsQuota.ts';
import {
  isOperationalExpense,
  isOperationalIncome,
  operationalExpenseOf,
  summarizeCashFlow,
} from '../../src/modules/investments/semantics.ts';
import type { Transaction } from '../../src/types.ts';

/**
 * P4-C — modelo da Divisão de contas no frontend: prévia do rateio idêntica
 * ao backend (mesmos vetores calculados à mão), formulário → contrato em
 * centavos e basis points sem ponto flutuante, leitura estrita do formato
 * autoritativo (o anterior é recusado), permissões iguais às do backend e
 * o espelho financeiro contado uma vez nos totais de caixa.
 */
interface SharedVector {
  name: string;
  amountCents: number;
  method: 'equal' | 'percentage' | 'fixed';
  participants: { participantId: string; weightBps?: number; amountCents?: number }[];
  expected: Record<string, number>;
}
const VECTORS = (JSON.parse(readFileSync('tests/fixtures/split-allocation-vectors.json', 'utf8')) as {
  vectors: SharedVector[];
}).vectors;

const timestamp = { seconds: 1_790_000_000, nanoseconds: 120_000_000 };

test('P4-C — prévia do rateio: os mesmos vetores do backend, Σ exato', () => {
  assert.ok(VECTORS.length >= 10);
  for (const vector of VECTORS) {
    const preview = previewAllocation(vector);
    assert.equal(preview.ok, true, vector.name);
    assert.deepEqual(preview.shares, vector.expected, vector.name);
    assert.equal(Object.values(preview.shares).reduce((sum, cents) => sum + cents, 0), vector.amountCents);
  }
});

test('P4-C — prévia do rateio: soma que não fecha é recusada, sem tolerância', () => {
  const percent = previewAllocation({ amountCents: 1_000, method: 'percentage', participants: [
    { participantId: 'a', weightBps: 3_333 }, { participantId: 'b', weightBps: 6_666 },
  ] });
  assert.equal(percent.ok, false);
  assert.equal(percent.differenceBps, 1);
  assert.ok('message' in percent && /exatamente 100%/.test(percent.message));
  const fixed = previewAllocation({ amountCents: 1_000, method: 'fixed', participants: [
    { participantId: 'a', amountCents: 500 }, { participantId: 'b', amountCents: 501 },
  ] });
  assert.equal(fixed.ok, false);
  assert.equal(fixed.differenceCents, -1);
  assert.equal(previewAllocation({ amountCents: 1_000, method: 'equal', participants: [] }).ok, false);
  assert.equal(previewAllocation({ amountCents: null, method: 'equal', participants: [{ participantId: 'a' }] }).ok,
    false);
  const many = Array.from({ length: 51 }, (_, index) => ({ participantId: `p${index}` }));
  assert.equal(previewAllocation({ amountCents: 10_000, method: 'equal', participants: many }).ok, false);
  const zero = previewAllocation({ amountCents: 1_000, method: 'percentage', participants: [
    { participantId: 'a', weightBps: 10_000 }, { participantId: 'b', weightBps: 0 },
  ] });
  assert.equal(zero.ok, false);
});

test('P4-C — valores e percentuais por texto, nunca por ponto flutuante', () => {
  assert.equal(amountInputToCents('0.1'), 10);
  assert.equal(amountInputToCents('0.29'), 29);
  assert.equal(amountInputToCents('1234.56'), 123_456);
  for (const bad of ['', '0', '12.345', '-1', 'abc', '1e3']) assert.equal(amountInputToCents(bad), null, bad);
  assert.equal(centsToAmountInput(123_456), '1234.56');
  assert.equal(centsToAmountInput(5), '0.05');
  assert.equal(centsToAmountInput(0), '');
  assert.equal(percentInputToBps('33.33'), 3_333);
  assert.equal(percentInputToBps('33,3'), 3_330);
  assert.equal(percentInputToBps('100'), 10_000);
  assert.equal(percentInputToBps('0.01'), 1);
  for (const bad of ['', '0', '100.01', '101', '33.333', '-5', 'x']) assert.equal(percentInputToBps(bad), null, bad);
  assert.equal(bpsToPercentInput(3_333), '33.33');
  assert.equal(bpsToPercentInput(2_500), '25');
  assert.equal(bpsToPercentInput(1), '0.01');
  assert.equal(formatBps(3_330), '33,3%');
  assert.equal(formatBps(10_000), '100%');
});

test('P4-C — código de convite normalizado como no backend', () => {
  assert.equal(normalizeInviteCode(' abcde-fgh23 '), 'ABCDEFGH23');
  assert.equal(isValidInviteCode('ABCDEFGH23'), true);
  // Fora do alfabeto (I, L, O, 0, 1) ou tamanho errado: inválido.
  for (const bad of ['ABCDEFGHI2', 'ABCDEFGH0Z', 'ABCDEFGH1Z', 'ABCDEFGHL2', 'ABCDEFGHO2', 'ABCDEFGH2', 'ABCDEFGH234']) {
    assert.equal(isValidInviteCode(bad), false, bad);
  }
});

const groupForm = (overrides: Partial<SplitGroupFormState> = {}): SplitGroupFormState => ({
  name: '  Viagem   à praia ', description: '', groupType: 'temporary', businessMode: 'split',
  color: '#4f46e5', icon: 'Users', emoji: '', ...overrides,
});

const billForm = (overrides: Partial<SplitBillFormState> = {}): SplitBillFormState => ({
  description: 'Jantar', category: 'Restaurantes', amount: '100.00', expenseDate: '2026-10-07',
  payerParticipantId: 'spt_a', method: 'equal', participantIds: ['spt_c', 'spt_a', 'spt_b'], inputs: {},
  integrate: false, paymentKind: 'cash', cashAccountId: '', cardId: '', installments: '1', ...overrides,
});

test('P4-C — grupo: payload sem dono nem estado; alteração só do que mudou', () => {
  const payload = toCreateGroupPayload(groupForm());
  assert.deepEqual(payload, { name: 'Viagem à praia', description: null, groupType: 'temporary',
    businessMode: 'split', visual: { color: '#4f46e5', icon: 'Users', emoji: null } });
  assert.equal('ownerUserId' in payload || 'status' in payload, false);
  assert.throws(() => toCreateGroupPayload(groupForm({ name: '   ' })), SplitInputError);
  assert.throws(() => toCreateGroupPayload(groupForm({ name: 'x'.repeat(81) })), SplitInputError);
  const current = { name: 'Viagem à praia', description: null, groupType: 'temporary' as const,
    visual: { color: '#4f46e5', icon: 'Users', emoji: null } };
  assert.deepEqual(toGroupChanges(groupForm(), current), {});
  assert.deepEqual(toGroupChanges(groupForm({ description: 'Julho' }), current), { description: 'Julho' });
  assert.deepEqual(toExternalParticipantPayload('g1', '  Ana  Paula '), { groupId: 'g1', displayName: 'Ana Paula' });
  assert.throws(() => toExternalParticipantPayload('g1', ' '), SplitInputError);
});

test('P4-C — despesa: termos em centavos/basis points; nada autoritativo no payload', () => {
  const equal = toCreateBillPayload('g1', billForm());
  assert.deepEqual(equal, {
    groupId: 'g1', description: 'Jantar', category: 'Restaurantes', amountCents: 10_000,
    expenseDate: '2026-10-07', payerParticipantId: 'spt_a', allocationMethod: 'equal',
    participants: [{ participantId: 'spt_c' }, { participantId: 'spt_a' }, { participantId: 'spt_b' }],
    financialIntegration: 'none', cashAccountId: null, cardId: null, installmentsCount: null,
  });
  const percentage = toBillTerms(billForm({ method: 'percentage', participantIds: ['spt_a', 'spt_b'],
    inputs: { spt_a: '33.33', spt_b: '66.67' } }));
  assert.deepEqual(percentage.participants, [{ participantId: 'spt_a', weightBps: 3_333 },
    { participantId: 'spt_b', weightBps: 6_667 }]);
  assert.throws(() => toBillTerms(billForm({ method: 'percentage', participantIds: ['spt_a', 'spt_b'],
    inputs: { spt_a: '33.33', spt_b: '66.66' } })), /exatamente 100%/);
  const fixed = toBillTerms(billForm({ method: 'fixed', participantIds: ['spt_a', 'spt_b'],
    inputs: { spt_a: '40.01', spt_b: '59.99' } }));
  assert.deepEqual(fixed.participants, [{ participantId: 'spt_a', amountCents: 4_001 },
    { participantId: 'spt_b', amountCents: 5_999 }]);
  assert.throws(() => toBillTerms(billForm({ method: 'fixed', participantIds: ['spt_a', 'spt_b'],
    inputs: { spt_a: '40.01', spt_b: '59.98' } })), /exatamente o valor total/);
  // Integração no mesmo payload: conta do Caixa ou cartão com parcelas.
  const cash = toBillTerms(billForm({ integrate: true, paymentKind: 'cash', cashAccountId: 'acc_1' }));
  assert.equal(cash.financialIntegration, 'cash');
  assert.equal(cash.cashAccountId, 'acc_1');
  assert.throws(() => toBillTerms(billForm({ integrate: true, paymentKind: 'cash' })), /conta/);
  const card = toBillTerms(billForm({ integrate: true, paymentKind: 'card', cardId: 'card_1', installments: '3' }));
  assert.deepEqual([card.financialIntegration, card.cardId, card.installmentsCount], ['card', 'card_1', 3]);
  assert.throws(() => toBillTerms(billForm({ integrate: true, paymentKind: 'card', cardId: 'card_1',
    installments: '61' })), /Parcelas/);
  assert.throws(() => toBillTerms(billForm({ amount: '10.001' })), SplitInputError);
  assert.throws(() => toBillTerms(billForm({ payerParticipantId: '' })), /quem pagou/);
});

const share = (overrides: Partial<SplitShare> = {}): SplitShare => ({
  id: 'sshr_1', billId: 'sbill_1', participantId: 'spt_a', isPayerShare: false, weightBps: null,
  amountDueCents: 3_334, amountSettledCents: 0, status: 'open', settledVia: null, version: 'v1', ...overrides,
});

test('P4-C — edição preserva o método a partir dos rateios gravados', () => {
  const shares = [
    share({ participantId: 'spt_a', weightBps: 3_333, amountDueCents: 3_333 }),
    share({ participantId: 'spt_b', weightBps: 6_667, amountDueCents: 6_667 }),
    share({ participantId: 'spt_x', weightBps: 1, amountDueCents: 0, status: 'voided' }),
  ];
  assert.deepEqual(inputsFromShares('percentage', shares), { spt_a: '33.33', spt_b: '66.67' });
  assert.deepEqual(inputsFromShares('fixed', shares), { spt_a: '33.33', spt_b: '66.67' });
  assert.deepEqual(inputsFromShares('equal', shares), { spt_a: '', spt_b: '' });
});

test('P4-C — reembolso e motivo: validados antes de chamar o backend', () => {
  assert.deepEqual(toCreateReimbursementPayload('g1', { description: 'Táxi', category: '', amount: '87.50',
    expenseDate: '2026-10-06', requesterParticipantId: 'spt_a' }), {
    groupId: 'g1', requesterParticipantId: 'spt_a', description: 'Táxi', category: 'Sem categoria',
    amountCents: 8_750, expenseDate: '2026-10-06',
  });
  assert.throws(() => toCreateReimbursementPayload('g1', { description: 'Táxi', category: 'X', amount: '0',
    expenseDate: '2026-10-06', requesterParticipantId: 'spt_a' }), SplitInputError);
  assert.equal(requireReason('  Pagou em espécie  '), 'Pagou em espécie');
  assert.throws(() => requireReason('  '), /Motivo/);
  assert.throws(() => requireReason('x'.repeat(141)), /140/);
});

const storedGroup = (overrides: Record<string, unknown> = {}) => ({
  id: 'sgrp_1', schemaVersion: 1, name: 'Viagem', description: null, groupType: 'temporary', businessMode: 'split',
  status: 'active', ownerParticipantId: 'spt_owner', ownerUserId: 'uid-owner', createdBy: 'uid-owner',
  visual: { color: '#4f46e5', icon: 'Users', emoji: null },
  counters: { participantCount: 3, activeParticipantCount: 3, billCount: 1, openBillCount: 1, openShareCount: 2,
    openReimbursementCount: 0 },
  totals: { billedCents: 10_000, openCents: 6_666, categoryTotals: { Restaurantes: 10_000 },
    reimbursementTotalCents: 0, reimbursementPendingCents: 0, reimbursementPaidCents: 0 },
  updatedAt: timestamp, ...overrides,
});

test('P4-C — leitura estrita: só o formato autoritativo; o anterior é recusado', () => {
  const group = toSplitGroup('sgrp_1', storedGroup());
  assert.equal(group?.totals.openCents, 6_666);
  assert.equal(toSplitGroup('outro', storedGroup()), null, 'ID divergente');
  assert.equal(toSplitGroup('sgrp_1', storedGroup({ schemaVersion: undefined })), null);
  assert.equal(toSplitGroup('sgrp_1', storedGroup({ totals: { ...storedGroup().totals, openCents: 66.66 } })), null,
    'valor em ponto flutuante');
  // Formato anterior (nome/papel/valores em reais): nada é exibido.
  assert.equal(toSplitGroup('g', { id: 'g', nome: 'Viagem', participantes: [{ nomeExibicao: 'Você' }] }), null);
  assert.equal(toSplitBill('b', { id: 'b', groupId: 'g', valorReal: 90.5, statusPagamento: 'aberto' }), null);
  assert.equal(toSplitShare('s', { id: 's', billId: 'b', valorDevido: 30.17, status: 'aPagar' }), null);
  assert.equal(toSplitShare('s', { id: 's', schemaVersion: 1, billId: 'b', participantId: 'p', isPayerShare: false,
    weightBps: null, amountDueCents: 30.17, amountSettledCents: 0, status: 'open', settledVia: null,
    updatedAt: timestamp }), null);
  assert.equal(toSplitShare('s', { id: 's', schemaVersion: 1, billId: 'b', participantId: 'p', isPayerShare: false,
    weightBps: null, amountDueCents: 3_017, amountSettledCents: 0, status: 'aPagar', settledVia: null,
    updatedAt: timestamp }), null, 'status anterior');
  // Externo: só nome, sem `uid`; membro: `uid` obrigatório, nome não gravado.
  const participant = (overrides: Record<string, unknown>) => ({
    id: 'spt_1', schemaVersion: 1, groupId: 'sgrp_1', kind: 'external', userId: null, displayName: 'Ana',
    role: 'participant', status: 'active', color: '#22c55e',
    balances: { dueCents: 0, paidCents: 0, owesOpenCents: 0, receivableOpenCents: 0 },
    openShareCount: 0, openReceivableCount: 0, openReimbursementCount: 0, updatedAt: timestamp, ...overrides,
  });
  assert.equal(toSplitParticipant('spt_1', participant({}))?.displayName, 'Ana');
  assert.equal(toSplitParticipant('spt_1', participant({ userId: 'uid-1' })), null, 'externo com login');
  assert.equal(toSplitParticipant('spt_1', participant({ role: 'owner' })), null, 'externo dono');
  assert.equal(toSplitParticipant('spt_1', participant({ kind: 'workspace_member', userId: 'uid-1',
    displayName: null }))?.userId, 'uid-1');
  assert.equal(toSplitParticipant('spt_1', participant({ kind: 'workspace_member', userId: null })), null);
  // Convite: só a dica do código, nunca o código.
  const invite = toSplitInvite('sinv_1', { id: 'sinv_1', schemaVersion: 1, groupId: 'sgrp_1', role: 'participant',
    status: 'pending', codeHint: 'X2Z', createdBy: 'uid-owner',
    expiresAt: { toDate: () => new Date('2026-10-14T12:00:00.000Z') } });
  assert.deepEqual(invite, { id: 'sinv_1', groupId: 'sgrp_1', role: 'participant', codeHint: 'X2Z',
    expiresAt: '2026-10-14T12:00:00.000Z', createdBy: 'uid-owner' });
  assert.equal(toSplitReimbursement('r', { id: 'r', schemaVersion: 1, groupId: 'g', requesterParticipantId: 'p',
    requesterUserId: null, description: 'Táxi', category: 'Transporte', amountCents: 87.5, currency: 'BRL',
    expenseDate: '2026-10-06', status: 'requested', createdBy: 'u', paymentDate: null, updatedAt: timestamp }), null);
});

const participant = (overrides: Partial<SplitParticipant>): SplitParticipant => ({
  id: 'spt_x', groupId: 'sgrp_1', kind: 'workspace_member', userId: 'uid-x', displayName: null,
  role: 'participant', status: 'active', color: '#22c55e',
  balances: { dueCents: 0, paidCents: 0, owesOpenCents: 0, receivableOpenCents: 0 },
  openShareCount: 0, openReceivableCount: 0, openReimbursementCount: 0, version: 'v', ...overrides,
});

const bill = (overrides: Partial<SplitBill> = {}): SplitBill => ({
  id: 'sbill_1', groupId: 'sgrp_1', description: 'Jantar', category: 'Restaurantes', amountCents: 9_000,
  expenseDate: '2026-10-04', payerParticipantId: 'spt_payer', payerUserId: 'uid-payer', allocationMethod: 'equal',
  participantIds: ['spt_payer', 'spt_debtor'], financialIntegration: 'none', cashAccountId: null, cardId: null,
  installmentsCount: null, cashTransactionId: null, purchaseId: null, status: 'open', shareCount: 2,
  openShareCount: 1, resolvedShareCount: 0, outstandingCents: 4_500, createdBy: 'uid-payer', version: 'v',
  ...overrides,
});

test('P4-C — permissões iguais às do backend: nunca o devedor; pagador externo só dono/admin', () => {
  const group = { status: 'active' as const };
  const payer = participant({ id: 'spt_payer', userId: 'uid-payer' });
  const debtor = participant({ id: 'spt_debtor', userId: 'uid-debtor' });
  const other = participant({ id: 'spt_other', userId: 'uid-other' });
  const owner = participant({ id: 'spt_owner', userId: 'uid-owner', role: 'owner' });
  const viewerP = participant({ id: 'spt_view', userId: 'uid-view', role: 'viewer' });
  const as = (uid: string, role: 'owner' | 'admin' | 'member' | 'viewer', me: SplitParticipant | null) => {
    const viewer = { uid, role };
    return { viewer, permissions: groupPermissions(viewer, group, me) };
  };
  const payerCtx = as('uid-payer', 'member', payer);
  const debtorCtx = as('uid-debtor', 'member', debtor);
  const otherCtx = as('uid-other', 'member', other);
  const ownerCtx = as('uid-owner', 'member', owner);
  const adminCtx = as('uid-admin', 'admin', null);
  const wsViewer = as('uid-wv', 'viewer', null);
  const groupViewer = as('uid-view', 'member', viewerP);
  assert.equal(canSettleShare(payerCtx.viewer, payerCtx.permissions, bill(), debtor), true);
  assert.equal(canSettleShare(debtorCtx.viewer, debtorCtx.permissions, bill(), debtor), false, 'devedor');
  assert.equal(canSettleShare(otherCtx.viewer, otherCtx.permissions, bill(), debtor), false);
  assert.equal(canSettleShare(ownerCtx.viewer, ownerCtx.permissions, bill(), debtor), true);
  assert.equal(canSettleShare(adminCtx.viewer, adminCtx.permissions, bill(), debtor), true);
  assert.equal(canSettleShare(wsViewer.viewer, wsViewer.permissions, bill(), debtor), false);
  // O dono do grupo não quita a própria dívida.
  assert.equal(canSettleShare(ownerCtx.viewer, ownerCtx.permissions, bill(), owner), false);
  // Pagador externo (sem uid): só dono do grupo ou admin.
  const externalBill = bill({ payerUserId: null });
  assert.equal(canSettleShare(otherCtx.viewer, otherCtx.permissions, externalBill, debtor), false);
  assert.equal(canSettleShare(ownerCtx.viewer, ownerCtx.permissions, externalBill, debtor), true);
  assert.equal(canSettleShare(adminCtx.viewer, adminCtx.permissions, externalBill, debtor), true);
  // Perdoar: dono ou admin; nunca o devedor; o pagador comum não.
  assert.equal(canForgiveShare(payerCtx.viewer, payerCtx.permissions, debtor), false);
  assert.equal(canForgiveShare(ownerCtx.viewer, ownerCtx.permissions, debtor), true);
  assert.equal(canForgiveShare(adminCtx.viewer, adminCtx.permissions, debtor), true);
  assert.equal(canForgiveShare(adminCtx.viewer, adminCtx.permissions,
    participant({ userId: 'uid-admin' })), false);
  // Lançar: participante ou dono do grupo, ou admin; visualizador e viewer do espaço não.
  assert.equal(payerCtx.permissions.canWrite, true);
  assert.equal(groupViewer.permissions.canWrite, false);
  assert.equal(wsViewer.permissions.canWrite, false);
  assert.equal(adminCtx.permissions.canWrite, true);
  assert.equal(groupPermissions(payerCtx.viewer, { status: 'archived' }, payer).canWrite, false, 'arquivado');
  assert.equal(otherCtx.permissions.canManage, false);
  assert.equal(ownerCtx.permissions.canManage, true);
  assert.equal(adminCtx.permissions.canAdministerReimbursements, true);
  assert.equal(ownerCtx.permissions.canAdministerReimbursements, false, 'reembolso é do admin do espaço');
  // Editar/anular: quem lançou, o pagador, o dono ou o admin; anular com fato
  // financeiro: só o pagador (membro) ou o admin.
  assert.equal(canEditBill(otherCtx.viewer, otherCtx.permissions, bill()), false);
  assert.equal(canEditBill(payerCtx.viewer, payerCtx.permissions, bill()), true);
  const withCash = bill({ financialIntegration: 'cash', cashAccountId: 'acc_1', cashTransactionId: 'scash_1' });
  assert.equal(canVoidBill(ownerCtx.viewer, ownerCtx.permissions, withCash), false);
  assert.equal(canVoidBill(payerCtx.viewer, payerCtx.permissions, withCash), true);
  assert.equal(canVoidBill(adminCtx.viewer, adminCtx.permissions, withCash), true);
  assert.equal(canVoidBill(adminCtx.viewer, adminCtx.permissions, bill({ status: 'voided' })), false);
  // Cancelar reembolso: o solicitante enquanto aguarda; depois, só o admin.
  const item = { status: 'requested' as const, requesterParticipantId: 'spt_payer' };
  assert.equal(canCancelReimbursement(payerCtx.viewer, payer, item), true);
  assert.equal(canCancelReimbursement(payerCtx.viewer, payer, { ...item, status: 'approved' }), false);
  assert.equal(canCancelReimbursement(adminCtx.viewer, null, { ...item, status: 'approved' }), true);
  assert.equal(canCancelReimbursement(adminCtx.viewer, null, { ...item, status: 'paid' }), false);
});

test('P4-C — nomes pela identidade, nunca "Você" gravado; textos em pt-BR', () => {
  const members = new Map([['uid-1', { uid: 'uid-1', displayName: 'Maria Souza', email: 'm@example.test' }],
    ['uid-2', { uid: 'uid-2', email: 'joao@example.test' }]]);
  assert.equal(participantName(participant({ userId: 'uid-1' }), members), 'Maria Souza');
  assert.equal(participantName(participant({ userId: 'uid-2' }), members), 'joao@example.test');
  assert.equal(participantName(participant({ userId: 'uid-x' }), members), 'Membro do espaço');
  assert.equal(participantName(participant({ kind: 'external', userId: null, displayName: 'Ana' }), members), 'Ana');
  assert.equal(shareStatusText(share({ status: 'settled', settledVia: 'settlement' }), false),
    'Recebimento registrado');
  assert.equal(shareStatusText(share({ status: 'settled', settledVia: 'payer_self' }), false), 'Pagou a conta');
  assert.equal(shareStatusText(share({ status: 'forgiven' }), false), 'Perdoado');
  assert.equal(shareStatusText(share(), true), 'Você deve');
  assert.equal(splitErrorView(new SplitInputError('Motivo: valor obrigatório.')).message,
    'Motivo: valor obrigatório.');
  assert.equal(splitErrorView({ code: 'functions/resource-exhausted', message: 'Limite de grupos atingido.' })
    .message, 'Limite de grupos atingido.');
});

test('P4-C — callables: os 22 nomes exportados pelo backend, sem escrita direta', async () => {
  const exported = [...readFileSync('functions/src/splitBills/callables.ts', 'utf8')
    .matchAll(/^export const (\w+) = defineCallable\(/gm)].map((match) => match[1]);
  assert.deepEqual([...SPLIT_CALLABLES].sort(), exported.sort());
  assert.equal(SPLIT_CALLABLES.length, 22);
  const index = readFileSync('functions/src/index.ts', 'utf8');
  for (const name of SPLIT_CALLABLES) assert.match(index, new RegExp(`\\b${name}\\b`), name);
  const calls: [string, Record<string, unknown>][] = [];
  const api = createSplitCallables(async (name, payload) => {
    calls.push([name, payload]);
    return { groupId: 'g1' } as never;
  });
  // A chave de idempotência é do formulário (uma por intenção), não do payload.
  await api.settleSplitShare({ workspaceId: 'ws', shareId: 's', expectedUpdatedAt: 'v' }, 'k');
  assert.deepEqual(calls, [['settleSplitShare',
    { workspaceId: 'ws', idempotencyKey: 'k', shareId: 's', expectedUpdatedAt: 'v' }]]);
});

test('P4-C — quota de grupos vem do servidor (sem contar a lista no cliente)', () => {
  const entitlement = (quota: unknown) => ({ limits: { splitGroups: 2 }, splitGroupsQuota: quota }) as never;
  assert.deepEqual(splitGroupsQuotaView(entitlement({ status: 'available', limit: 2, used: null, remaining: null,
    exhausted: true })), { canCreate: false, limit: 2 });
  assert.deepEqual(splitGroupsQuotaView(entitlement({ status: 'available', limit: 10, used: 3, remaining: 7,
    exhausted: false })), { canCreate: true, limit: 10 });
  // Sem leitura disponível, o servidor decide na criação.
  assert.deepEqual(splitGroupsQuotaView(entitlement({ status: 'unavailable', limit: null, used: null,
    remaining: null, exhausted: null })), { canCreate: true, limit: 2 });
});

const mirror = (overrides: Partial<Transaction> & { splitEntry: Transaction['splitEntry'] }): Transaction => ({
  id: 'scash_1', type: 'despesa', description: 'Divisão de contas', category: 'Restaurantes', value: 90,
  valueCents: 9_000, date: '2026-10-04', isPaid: true, cashAccountId: 'acc_1', ...overrides,
}) as Transaction;

test('P4-C — espelho no Caixa: despesa uma vez; compensação anula na mesma categoria', () => {
  const expense = mirror({ splitEntry: { kind: 'bill_expense', groupId: 'g', billId: 'b', reimbursementId: null,
    reversal: false, reversalOf: null, amountCents: 9_000 } });
  const compensation = mirror({ id: 'scash_2', type: 'receita', splitEntry: { kind: 'bill_expense', groupId: 'g',
    billId: 'b', reimbursementId: null, reversal: true, reversalOf: 'scash_1', amountCents: 9_000 } });
  const income: Transaction = { id: 't1', type: 'receita', description: 'Salário', category: 'Salário', value: 1_000,
    valueCents: 100_000, date: '2026-10-01', isPaid: true } as Transaction;
  assert.equal(isOperationalExpense(expense), true);
  assert.equal(isOperationalExpense(compensation), true);
  assert.equal(isOperationalIncome(compensation), false, 'compensação não é receita');
  assert.equal(operationalExpenseOf(expense), 90);
  assert.equal(operationalExpenseOf(compensation), -90);
  const before = summarizeCashFlow([income, expense]);
  assert.equal(before.income, 1_000);
  assert.equal(before.expenses, 90);
  assert.equal(before.balance, 910);
  const after = summarizeCashFlow([income, expense, compensation]);
  assert.equal(after.income, 1_000);
  assert.equal(after.expenses, 0);
  assert.equal(after.balance, 1_000);
});
