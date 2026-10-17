import assert from 'node:assert/strict';
import test from 'node:test';

import {
  toClient,
  toClientPrivate,
  toReceivable,
  toReceivableMovement,
  versionOf,
} from '../../src/modules/clients/adapters.ts';
import { CLIENTS_CALLABLES, createClientsCallables } from '../../src/modules/clients/callables.ts';
import {
  ClientInputError,
  receiptAmountsOf,
  receiptCashCents,
  toArchiveClientPayload,
  toCancelReceivablePayload,
  toCreateClientPayload,
  toCreateReceivablePayload,
  toReceivePayload,
  toReverseReceiptPayload,
  toUpdateClientPayload,
  toUpdateReceivablePayload,
} from '../../src/modules/clients/payloads.ts';
import {
  addDaysToDayKey,
  clientPermissions,
  clientsErrorView,
  formatDocument,
  isAmountLocked,
  isReceivableOverdue,
  movementStateLabel,
  receivableDisplayStatus,
  receivablePermissions,
  RECEIVABLE_STATUS_LABELS,
} from '../../src/modules/clients/presentation.ts';
import type { Client, Receivable, ReceivableMovement } from '../../src/modules/clients/types.ts';

/**
 * P3-I — o frontend de clientes e recebíveis lê um único formato (o
 * autoritativo do backend), deriva o atraso pela data civil e monta payloads
 * em centavos inteiros, sem campo autoritativo.
 */

const timestamp = { seconds: 1_790_000_000, nanoseconds: 123_456_789 };
const VERSION = '2026-09-21T14:13:20.123456789Z';

const clientDoc = (overrides: Record<string, unknown> = {}) => ({
  clientId: 'cli_1', schemaVersion: 1, workspaceId: 'ws-1', name: 'Comercial Exemplo',
  status: 'active', createdBy: 'u-admin', updatedBy: 'u-admin', updatedAt: timestamp, ...overrides,
});

const receivableDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'rcv_1', schemaVersion: 1, workspaceId: 'ws-1', clientId: 'cli_1', description: 'Consultoria',
  currency: 'BRL', amountCents: 100_000, principalReceivedCents: 0, discountGrantedCents: 0,
  interestReceivedCents: 0, penaltyReceivedCents: 0, balanceCents: 100_000, activeReceiptCount: 0,
  dueDate: '2026-10-05', status: 'open', revision: 1, createdBy: 'u-member', updatedAt: timestamp,
  ...overrides,
});

const movementDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'rmv_1', schemaVersion: 1, receivableId: 'rcv_1', kind: 'receipt', principalCents: 90_000,
  interestCents: 1_500, penaltyCents: 500, discountCents: 10_000, cashCents: 92_000,
  date: '2026-10-05', cashTransactionId: 'recvcash_1', reversalOf: null, reversedBy: null,
  reason: null, createdBy: 'u-member', ...overrides,
});

test('P3-I — leitura: só o formato autoritativo; modelo antigo e estado impossível recusados', () => {
  assert.equal(versionOf(timestamp), VERSION);
  assert.deepEqual(toClient('cli_1', clientDoc()), {
    id: 'cli_1', name: 'Comercial Exemplo', status: 'active', createdBy: 'u-admin', version: VERSION,
  });
  // Cliente antigo (CNPJ no documento compartilhado, `inactive`, sem marca).
  assert.equal(toClient('old', { name: 'Antigo', cnpj: '11222333000181', status: 'inactive' }), null);
  assert.equal(toClient('cli_1', clientDoc({ status: 'inactive' })), null);
  assert.equal(toClient('outro', clientDoc()), null, 'clientId diferente do ID');
  assert.deepEqual(toClientPrivate('cli_1', { schemaVersion: 1, clientId: 'cli_1', email: 'a@b.co' }),
    { clientId: 'cli_1', document: undefined, email: 'a@b.co', phone: undefined, address: undefined, notes: undefined });

  const receivable = toReceivable('rcv_1', receivableDoc());
  assert.equal(receivable?.balanceCents, 100_000);
  assert.equal(receivable?.version, VERSION);
  for (const broken of [
    { value: 1000, status: 'pending', schemaVersion: undefined },
    { status: 'overdue' },
    { status: 'paid' },
    { status: 'pending' },
    { balanceCents: 99_999 },
    { amountCents: 1000.5, balanceCents: 1000.5 },
    { status: 'received' },
    { status: 'open', principalReceivedCents: 100_000, balanceCents: 0 },
    { status: 'cancelled', activeReceiptCount: 1 },
    { dueDate: '05/10/2026' },
    { id: 'outro' },
  ]) {
    assert.equal(toReceivable('rcv_1', receivableDoc(broken)), null, JSON.stringify(broken));
  }

  assert.equal(toReceivableMovement('rmv_1', movementDoc())?.cashCents, 92_000);
  for (const broken of [
    { cashCents: 102_000 },
    { kind: 'reversal' },
    { principalCents: 0, interestCents: 0, penaltyCents: 0, discountCents: 0, cashCents: 0 },
    { principalCents: -1 },
  ]) {
    assert.equal(toReceivableMovement('rmv_1', movementDoc(broken)), null, JSON.stringify(broken));
  }
});

const receivableOf = (overrides: Record<string, unknown> = {}): Receivable =>
  toReceivable('rcv_1', receivableDoc(overrides)) as Receivable;

test('P3-I — atraso derivado pela data civil; vence hoje ainda em dia', () => {
  assert.equal(isReceivableOverdue({ status: 'open', dueDate: '2026-10-04' }, '2026-10-05'), true);
  assert.equal(isReceivableOverdue({ status: 'open', dueDate: '2026-10-05' }, '2026-10-05'), false);
  assert.equal(isReceivableOverdue({ status: 'received', dueDate: '2026-01-01' }, '2026-10-05'), false);
  assert.equal(isReceivableOverdue({ status: 'cancelled', dueDate: '2026-01-01' }, '2026-10-05'), false);
  assert.equal(receivableDisplayStatus({ status: 'open', dueDate: '2025-12-31' }, '2026-01-01'), 'overdue');
  assert.deepEqual(RECEIVABLE_STATUS_LABELS,
    { open: 'Em aberto', overdue: 'Em atraso', received: 'Recebido', cancelled: 'Cancelado' });
  assert.equal(addDaysToDayKey('2026-12-28', 7), '2027-01-04');
  assert.equal(addDaysToDayKey('2028-02-27', 2), '2028-02-29');
  assert.equal(formatDocument('11222333000181'), '11.222.333/0001-81');
  assert.equal(formatDocument('52998224725'), '529.982.247-25');
  assert.equal(formatDocument(undefined), '-');
});

test('P3-I — permissões: dados pessoais só owner/admin; member só o que criou; viewer lê', () => {
  for (const role of ['owner', 'admin'] as const) {
    assert.deepEqual(clientPermissions(role),
      { canManageClients: true, canSeePrivateData: true, canCreateReceivable: true });
  }
  assert.deepEqual(clientPermissions('member'),
    { canManageClients: false, canSeePrivateData: false, canCreateReceivable: true });
  assert.deepEqual(clientPermissions('viewer'),
    { canManageClients: false, canSeePrivateData: false, canCreateReceivable: false });
  assert.equal(clientPermissions(null).canSeePrivateData, false);

  const own = receivableOf();
  const receipt = toReceivableMovement('rmv_1', movementDoc()) as ReceivableMovement;
  const member = receivablePermissions({ role: 'member', uid: 'u-member' }, own);
  assert.equal(member.canReceive && member.canEdit && member.canCancel, true);
  assert.equal(member.canReverse(receipt), true);
  const other = receivablePermissions({ role: 'member', uid: 'u-other' }, own);
  assert.equal(other.canManage || other.canReceive || other.canReverse(receipt), false);
  const viewer = receivablePermissions({ role: 'viewer', uid: 'u-member' }, own);
  assert.equal(viewer.canManage, false);
  const received = receivablePermissions({ role: 'owner', uid: 'x' },
    receivableOf({ status: 'received', balanceCents: 0, principalReceivedCents: 100_000, activeReceiptCount: 1 }));
  assert.equal(received.canReceive || received.canCancel, false);
  assert.equal(received.canEdit, true);
  const cancelled = receivablePermissions({ role: 'owner', uid: 'x' }, receivableOf({ status: 'cancelled' }));
  assert.equal(cancelled.canEdit || cancelled.canReverse(receipt), false);
  assert.equal(receivablePermissions({ role: 'owner' }, own).canReverse({ ...receipt, reversedBy: 'rmv_2' }), false);
  assert.equal(isAmountLocked(own), false);
  assert.equal(isAmountLocked(receivableOf({ discountGrantedCents: 1, balanceCents: 99_999 })), true);
  const reversal = toReceivableMovement('rmv_2', movementDoc({ kind: 'reversal', reversalOf: 'rmv_1' })) as ReceivableMovement;
  assert.equal(movementStateLabel(reversal, [receipt, reversal]), 'Compensa o recebimento de 05/10/2026');
  assert.equal(movementStateLabel({ ...receipt, reversedBy: 'rmv_2' }), 'Estornado');
});

const client: Client = { id: 'cli_1', name: 'Comercial Exemplo', status: 'active', createdBy: 'u', version: VERSION };

test('P3-I — payloads de cliente: campos vazios não vão; edição só com o que mudou; limpar é null', () => {
  assert.deepEqual(toCreateClientPayload('ws-1', {
    name: '  Comercial  ', email: ' contato@exemplo.com ', phone: '', document: '', notes: '',
  }), { workspaceId: 'ws-1', name: 'Comercial', email: 'contato@exemplo.com' });
  assert.throws(() => toCreateClientPayload('ws-1', { name: ' ', email: '', phone: '', document: '', notes: '' }),
    (error: unknown) => error instanceof ClientInputError && /Nome/.test((error as Error).message));
  const personal = { clientId: 'cli_1', email: 'a@b.co', phone: '(11) 9999-0000' };
  assert.deepEqual(toUpdateClientPayload({
    workspaceId: 'ws-1', client, personal,
    form: { name: 'Comercial Exemplo', email: '', phone: '(11) 9999-0000', document: '11.222.333/0001-81', notes: '' },
  }), {
    workspaceId: 'ws-1', clientId: 'cli_1', expectedUpdatedAt: VERSION,
    changes: { email: null, document: '11.222.333/0001-81' },
  });
  assert.throws(() => toUpdateClientPayload({
    workspaceId: 'ws-1', client, personal,
    form: { name: 'Comercial Exemplo', email: 'a@b.co', phone: '(11) 9999-0000', document: '', notes: '' },
  }), /Nenhuma alteração/);
  assert.deepEqual(toArchiveClientPayload('ws-1', client),
    { workspaceId: 'ws-1', clientId: 'cli_1', expectedUpdatedAt: VERSION });
});

test('P3-I — payloads de recebível: centavos sem ponto flutuante; nada autoritativo', () => {
  assert.deepEqual(toCreateReceivablePayload('ws-1', {
    description: ' Consultoria ', clientId: 'cli_1', amount: '1.234,56', dueDate: '2027-01-10',
  }), { workspaceId: 'ws-1', clientId: 'cli_1', description: 'Consultoria', amountCents: 123_456, dueDate: '2027-01-10' });
  for (const amount of ['10.50', '1,234', '-5', '0', '', 'abc', '1e3']) {
    assert.throws(() => toCreateReceivablePayload('ws-1', {
      description: 'X', clientId: 'cli_1', amount, dueDate: '2027-01-10',
    }), ClientInputError, amount);
  }
  assert.throws(() => toCreateReceivablePayload('ws-1', { description: 'X', clientId: '', amount: '1,00', dueDate: '2027-01-10' }), /cliente/);
  const open = receivableOf();
  assert.deepEqual(toUpdateReceivablePayload({
    workspaceId: 'ws-1', receivable: open, amountLocked: false,
    form: { description: 'Consultoria', clientId: 'cli_1', amount: '500,00', dueDate: '2026-11-01' },
  }).changes, { dueDate: '2026-11-01', amountCents: 50_000 });
  // Valor travado: não vai, mesmo se o campo mudar.
  assert.deepEqual(toUpdateReceivablePayload({
    workspaceId: 'ws-1', receivable: open, amountLocked: true,
    form: { description: 'Outra', clientId: 'cli_1', amount: '1,00', dueDate: '2026-10-05' },
  }).changes, { description: 'Outra' });
});

test('P3-I — recebimento: principal + desconto até o saldo; caixa = principal + juros + multa', () => {
  const open = receivableOf();
  const form = {
    principal: '900,00', interest: '', penalty: '', discount: '100,00', paymentDate: '2026-10-05',
    cashAccountId: 'acc_caixa',
  };
  const payload = toReceivePayload({ workspaceId: 'ws-1', receivable: open, form, today: '2026-10-05' });
  assert.deepEqual(payload, {
    workspaceId: 'ws-1', receivableId: 'rcv_1', expectedUpdatedAt: VERSION,
    principalCents: 90_000, interestCents: 0, penaltyCents: 0, discountCents: 10_000, paymentDate: '2026-10-05',
    cashAccountId: 'acc_caixa',
  });
  // P3-J (D-30): com dinheiro, a conta é obrigatória; só desconto não a envia.
  assert.throws(() => toReceivePayload({ workspaceId: 'ws-1', receivable: open,
    form: { ...form, cashAccountId: '' }, today: '2026-10-05' }), /Conta\/carteira/);
  const discountOnly = toReceivePayload({ workspaceId: 'ws-1', receivable: open,
    form: { ...form, principal: '' }, today: '2026-10-05' });
  assert.equal('cashAccountId' in discountOnly, false, 'desconto não move conta');
  assert.equal(receiptCashCents(receiptAmountsOf(form)), 90_000, 'desconto não entra no caixa');
  assert.equal(receiptCashCents(receiptAmountsOf({ ...form, interest: '15,00', penalty: '5,00' })), 92_000);
  assert.throws(() => toReceivePayload({ workspaceId: 'ws-1', receivable: open,
    form: { ...form, principal: '900,01' }, today: '2026-10-05' }), /saldo de R\$\s1\.000,00/);
  assert.throws(() => toReceivePayload({ workspaceId: 'ws-1', receivable: open,
    form: { ...form, principal: '', discount: '' }, today: '2026-10-05' }), /maior que zero/);
  assert.throws(() => toReceivePayload({ workspaceId: 'ws-1', receivable: open,
    form: { ...form, paymentDate: '2026-10-06' }, today: '2026-10-05' }), /futura/);
  // Só juros: aceito (não abate o saldo).
  assert.equal(toReceivePayload({ workspaceId: 'ws-1', receivable: open,
    form: { principal: '', interest: '10,00', penalty: '', discount: '', paymentDate: '2026-10-01',
      cashAccountId: 'acc_caixa' },
    today: '2026-10-05' }).interestCents, 1_000);
  const receipt = toReceivableMovement('rmv_1', movementDoc()) as ReceivableMovement;
  assert.deepEqual(toReverseReceiptPayload({ workspaceId: 'ws-1', receivable: open, movement: receipt, reason: ' Duplicado ' }),
    { workspaceId: 'ws-1', receivableId: 'rcv_1', movementId: 'rmv_1', expectedUpdatedAt: VERSION, reason: 'Duplicado' });
  assert.throws(() => toCancelReceivablePayload({ workspaceId: 'ws-1', receivable: open, reason: '  ' }), /Motivo/);
});

test('P3-I — callables: os oito nomes, chave sempre anexada', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const callables = createClientsCallables(async (name, payload) => {
    calls.push([name, payload]);
    return { replayed: false } as never;
  });
  assert.deepEqual(Object.keys(callables).sort(), [...CLIENTS_CALLABLES].sort());
  await callables.receiveReceivable({ receivableId: 'rcv_1' }, 'chave-1');
  assert.deepEqual(calls, [['receiveReceivable', { receivableId: 'rcv_1', idempotencyKey: 'chave-1' }]]);
});

test('P3-I — erros: pt-BR do backend preservado; resultado incerto orienta reenvio', () => {
  assert.equal(clientsErrorView({ code: 'functions/failed-precondition',
    message: 'Este cliente tem recebíveis em aberto. Receba ou cancele esses recebíveis antes de arquivar o cliente.' }).message,
  'Este cliente tem recebíveis em aberto. Receba ou cancele esses recebíveis antes de arquivar o cliente.');
  assert.equal(clientsErrorView({ code: 'functions/invalid-argument', message: 'x',
    details: { issues: [{ message: 'E-mail: inválido.' }] } }).message, 'E-mail: inválido.');
  assert.equal(clientsErrorView({ code: 'functions/aborted', message: 'aborted' }).refresh, true);
  assert.match(clientsErrorView({ code: 'functions/internal', message: 'internal' }).message, /não duplica/);
  assert.deepEqual(clientsErrorView(new ClientInputError('Selecione o cliente.')),
    { kind: 'validation', message: 'Selecione o cliente.', refresh: false });
});
