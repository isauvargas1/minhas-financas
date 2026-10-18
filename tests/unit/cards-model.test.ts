import assert from 'node:assert/strict';
import test from 'node:test';

import {
  toCardInvoice,
  toCardPayment,
  toCardPurchase,
  toCreditCard,
} from '../../src/modules/cards/adapters.ts';
import {
  dueDateOf,
  firstOpenCompetence,
  isInvoiceOverdue,
  naturalCompetenceOf,
  retroactiveTarget,
} from '../../src/modules/cards/cycle.ts';
import {
  amountInputToCents,
  centsToNumberInput,
  purchasePreview,
  purchaseTotalCents,
  splitCentsEvenly,
  toAdjustmentPayload,
  toCreateCardPurchasePayload,
  toCreateCreditCardPayload,
  toInvoicePaymentPayload,
  toUpdateCreditCardPayload,
} from '../../src/modules/cards/payloads.ts';
import {
  CardInputError,
  canPayInvoice,
  cardPermissions,
  invoiceDisplayStatus,
  openInvoiceCreditNote,
  payableCents,
  selectInvoiceSections,
} from '../../src/modules/cards/presentation.ts';
import { createCardsCallables } from '../../src/modules/cards/callables.ts';
import { isCreditCardPaymentCashMirror } from '../../src/modules/investments/semantics.ts';
import type { Transaction } from '../../src/types.ts';
import type { CardInvoice, CreditCard } from '../../src/modules/cards/types.ts';

/**
 * P4-A — modelo de cartões no frontend: leitura só do formato autoritativo
 * em centavos, calendário espelho do backend (D-36), conversões de texto
 * para centavos sem ponto flutuante, prévia da compra pelo maior resto,
 * situação da fatura com atraso derivado e permissões por papel.
 */

const ts = { seconds: 1_772_000_000, nanoseconds: 123_000_000 };
const VISUAL = {
  bgType: 'color', bgColor: '#1e293b', bgGradientColor: null, bgImage: null,
  textColor: 'white', showName: true, showBrand: true, showLogo: true,
};

const cardDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'card_1', schemaVersion: 1, workspaceId: 'ws', name: 'Cartão', brand: 'Visa',
  status: 'active', limitTotalCents: 500_000, limitUsedCents: 120_001,
  limitAvailableCents: 379_999, closingDay: 25, dueDay: 5, bestDay: null,
  observations: null, responsiblePerson: null, recommendedUse: null, defaultCostCenter: null,
  visual: VISUAL, updatedAt: ts, ...overrides,
});

const card = toCreditCard('card_1', cardDoc()) as CreditCard;

const invoice = (overrides: Partial<CardInvoice> = {}): CardInvoice => ({
  id: 'card_1_2026-03', cardId: 'card_1', competenceMonth: '2026-03',
  closingDate: '2026-03-25', dueDate: '2026-04-05', cycleStatus: 'closed',
  paymentStatus: 'unpaid', totalCents: 30_000, paidCents: 0, remainingCents: 30_000,
  activeEntryCount: 1, version: '2026-03-25T03:00:00.000000000Z', ...overrides,
});

test('adaptadores: só o formato autoritativo em centavos; legado em reais é recusado', () => {
  assert.equal(card.limitUsedCents, 120_001);
  assert.equal(card.version, '2026-02-25T06:13:20.123000000Z');
  assert.equal(toCreditCard('card_1', cardDoc({ limitTotalCents: 5000.5 })), null);
  assert.equal(toCreditCard('card_1', cardDoc({ limitAvailableCents: 1 })), null,
    'disponível incoerente com total − usado');
  assert.equal(toCreditCard('card_1', { ...cardDoc(), schemaVersion: undefined, limitTotal: 5000 }), null);
  assert.equal(toCreditCard('card_1', cardDoc({ status: 'blocked' })), null);
  assert.ok(toCreditCard('card_1', cardDoc({ limitUsedCents: -1_000, limitAvailableCents: 501_000 })),
    'crédito a favor (usado negativo) é válido');
  const invoiceDoc = {
    id: 'card_1_2026-03', schemaVersion: 1, cardId: 'card_1', competenceMonth: '2026-03',
    closingDate: '2026-03-25', dueDate: '2026-04-05', cycleStatus: 'closed',
    paymentStatus: 'partial', totalCents: 30_000, paidCents: 10_000, remainingCents: 20_000,
    activeEntryCount: 2, updatedAt: ts,
  };
  assert.ok(toCardInvoice(invoiceDoc.id, invoiceDoc));
  assert.equal(toCardInvoice(invoiceDoc.id, { ...invoiceDoc, paymentStatus: 'overdue' }), null,
    'atraso nunca é estado persistido');
  assert.equal(toCardInvoice(invoiceDoc.id, { ...invoiceDoc, remainingCents: 1 }), null);
  assert.equal(toCardInvoice(invoiceDoc.id, { ...invoiceDoc, status: 'open', cycleStatus: undefined }), null);
  assert.equal(toCardPurchase('p', { id: 'p', schemaVersion: 1, totalAmount: 10 }), null);
  assert.equal(toCardPayment('x', {
    id: 'x', schemaVersion: 1, cardId: 'c', invoiceId: 'i', kind: 'payment', amountCents: 10,
    paymentDate: '2026-03-26', walletId: 'w',
  }), null, 'pagamento sem conta de origem não é lido');
});

test('calendário espelho do backend: fechamento no dia vai para a próxima, mês curto', () => {
  assert.equal(naturalCompetenceOf('2026-03-24', 25), '2026-03');
  assert.equal(naturalCompetenceOf('2026-03-25', 25), '2026-04');
  assert.equal(naturalCompetenceOf('2026-02-28', 31), '2026-03');
  assert.equal(dueDateOf('2026-03', 25, 5), '2026-04-05');
  assert.equal(dueDateOf('2026-03', 5, 15), '2026-03-15');
  assert.equal(firstOpenCompetence('2026-03-26', 25), '2026-04');
  assert.equal(retroactiveTarget('2026-01-10', '2026-03-20', 25), '2026-03');
  assert.equal(retroactiveTarget('2026-03-20', '2026-03-20', 25), null);
});

test('conversões: texto → centavos sem ponto flutuante; total pela parcela é inteiro', () => {
  assert.equal(amountInputToCents('19.99'), 1999);
  assert.equal(amountInputToCents('0.1'), 10);
  assert.equal(amountInputToCents('1234'), 123_400);
  assert.equal(amountInputToCents('12.345'), null, 'campo numérico: três casas, nunca milhar');
  assert.equal(amountInputToCents('1.234,56'), null, 'campo numérico não usa vírgula');
  assert.equal(amountInputToCents('0'), null);
  assert.equal(amountInputToCents('1e3'), null);
  assert.equal(amountInputToCents('-5'), null);
  assert.equal(amountInputToCents('10.001'), null);
  assert.equal(centsToNumberInput(123_405), '1234.05');
  assert.deepEqual(purchaseTotalCents('33.33', '3', 'installment'), { totalCents: 9_999, installmentsCount: 3 });
  assert.deepEqual(purchaseTotalCents('100', '3', 'total'), { totalCents: 10_000, installmentsCount: 3 });
  assert.equal(purchaseTotalCents('100', '61', 'total'), null, 'teto de 60 parcelas');
  assert.equal(purchaseTotalCents('0.02', '3', 'total'), null, 'parcela abaixo de R$ 0,01');
  assert.deepEqual(splitCentsEvenly(10_000, 3), [3334, 3333, 3333]);
});

test('payload da compra: valor total em centavos, sem origem nem campos em reais', () => {
  const payload = toCreateCardPurchasePayload({
    cardId: 'card_1', description: ' Notebook ', category: 'Equipamentos', purchaseDate: '2026-03-10',
    value: '1500.50', installments: '3', valueType: 'total',
  }, 'ws');
  assert.deepEqual(payload, {
    workspaceId: 'ws', cardId: 'card_1', description: 'Notebook', category: 'Equipamentos',
    purchaseDate: '2026-03-10', totalCents: 150_050, installmentsCount: 3,
  });
  for (const forbidden of ['source', 'totalAmount', 'amountType', 'idempotencyKey']) {
    assert.equal(forbidden in payload, false, forbidden);
  }
  assert.throws(() => toCreateCardPurchasePayload({
    cardId: '', description: 'x', category: 'y', purchaseDate: '2026-03-10', value: '1', installments: '1',
    valueType: 'total',
  }, 'ws'), CardInputError);
});

test('prévia: parcelas pelo maior resto, competência retroativa e limite em centavos', () => {
  const preview = purchasePreview({
    card, value: '100', installments: '3', valueType: 'total', purchaseDate: '2026-01-10',
    today: '2026-03-20',
  });
  assert.ok(preview);
  assert.equal(preview.firstInstallmentCents, 3334);
  assert.equal(preview.otherInstallmentCents, 3333);
  assert.equal(preview.firstCompetence, '2026-03');
  assert.equal(preview.retroactiveTarget, '2026-03');
  assert.equal(preview.availableAfterCents, 379_999 - 10_000);
  assert.equal(preview.insufficientLimit, false);
  const big = purchasePreview({
    card, value: '3800', installments: '1', valueType: 'total', purchaseDate: '2026-03-20',
    today: '2026-03-20',
  });
  assert.equal(big?.insufficientLimit, true);
});

test('cartão: criação e edição só com o que mudou; limite em centavos', () => {
  const form = {
    name: 'Cartão', brand: 'Visa' as const, limitTotal: '5000', closingDay: '25', dueDay: '5', bestDay: '',
    observations: '', visual: { ...VISUAL, bgGradientColor: undefined, bgImage: undefined } as CreditCard['visual'],
  };
  const created = toCreateCreditCardPayload(form, 'ws');
  assert.equal(created.limitTotalCents, 500_000);
  assert.equal('limitUsedCents' in created, false);
  assert.equal('status' in created, false);
  const update = toUpdateCreditCardPayload(card, { ...form, limitTotal: '6000.10' }, 'ws');
  assert.deepEqual(update.changes, { limitTotalCents: 600_010 });
  assert.equal(update.expectedUpdatedAt, card.version);
  assert.throws(() => toUpdateCreditCardPayload(card, form, 'ws'), /Nenhuma alteração/);
});

test('pagamento e ajuste: conta obrigatória; ajuste com sinal e motivo; nada de carteira', () => {
  const payment = toInvoicePaymentPayload({
    workspaceId: 'ws', invoice: invoice(), cashAccountId: 'acc_1', amount: '100.10', paymentDate: '2026-03-26',
  });
  assert.equal(payment.amountCents, 10_010);
  assert.equal(payment.cashAccountId, 'acc_1');
  assert.equal(payment.expectedUpdatedAt, invoice().version);
  assert.equal('walletId' in payment || 'paymentMethod' in payment, false);
  assert.throws(() => toInvoicePaymentPayload({
    workspaceId: 'ws', invoice: invoice(), cashAccountId: '', amount: '1', paymentDate: '2026-03-26',
  }), /conta/);
  const credit = toAdjustmentPayload({
    workspaceId: 'ws', cardId: 'card_1', competenceMonth: '2026-03', amount: '15', direction: 'credit',
    reason: 'Tarifa estornada pelo banco',
  });
  assert.equal(credit.amountCents, -1_500);
  assert.throws(() => toAdjustmentPayload({
    workspaceId: 'ws', cardId: 'card_1', competenceMonth: '2026-03', amount: '15', direction: 'debit',
    reason: '',
  }), /motivo/);
});

test('situação da fatura: ciclo e pagamento separados; vencida derivada; paga continua paga', () => {
  assert.equal(invoiceDisplayStatus(invoice({ cycleStatus: 'open', paymentStatus: 'unpaid' }), '2026-03-20'), 'open');
  assert.equal(invoiceDisplayStatus(invoice({ cycleStatus: 'open', paymentStatus: 'unpaid' }), '2026-03-25'), 'closing');
  assert.equal(invoiceDisplayStatus(invoice(), '2026-04-05'), 'unpaid');
  assert.equal(invoiceDisplayStatus(invoice(), '2026-04-06'), 'overdue');
  assert.equal(invoiceDisplayStatus(invoice({ paymentStatus: 'paid', paidCents: 30_000, remainingCents: 0 }),
    '2026-05-01'), 'paid');
  assert.equal(isInvoiceOverdue({ cycleStatus: 'open', remainingCents: 10, dueDate: '2026-01-01' }, '2026-05-01'),
    false);
  assert.equal(canPayInvoice(invoice({ cycleStatus: 'open' }), '2026-03-20'), false, 'aberta não é paga');
  assert.equal(canPayInvoice(invoice({ cycleStatus: 'open' }), '2026-03-25'), true, 'fechada pela data');
  assert.equal(canPayInvoice(invoice(), '2026-03-26'), true, 'antecipado antes do vencimento');
  assert.equal(payableCents(invoice({ cycleStatus: 'open', totalCents: -500, remainingCents: -500,
    paymentStatus: 'paid' })), 0);
});

const inv = (competenceMonth: string, overrides: Partial<CardInvoice> = {}): CardInvoice => {
  return invoice({
    id: `card_1_${competenceMonth}`, competenceMonth,
    closingDate: `${competenceMonth}-25`, dueDate: `${competenceMonth}-28`,
    ...overrides,
  });
};
const idsOf = (list: CardInvoice[]) => list.map((item) => item.competenceMonth);

test('seções das faturas: fechada não vencida vira a próxima a pagar; ciclo aberto e seguinte separados', () => {
  // Hoje 10/04: a de março (vence 28/03) está vencida; a de abril fechou em 25/04? Não: ainda aberta.
  const today = '2026-04-10';
  const overdue = inv('2026-03', { cycleStatus: 'closed' });
  const closedPaid = inv('2026-02', { cycleStatus: 'closed', paymentStatus: 'paid', paidCents: 30_000, remainingCents: 0 });
  const closedToPay = inv('2026-04', { cycleStatus: 'closed', dueDate: '2026-04-28', closingDate: '2026-04-05' });
  const sections = selectInvoiceSections(
    [inv('2026-05', { cycleStatus: 'open', totalCents: 1_000, remainingCents: 1_000 }),
      inv('2026-06', { cycleStatus: 'open', totalCents: 2_000, remainingCents: 2_000 })],
    [closedToPay, overdue, closedPaid],
    today,
  );
  assert.equal(sections.nextToPay?.competenceMonth, '2026-04');
  assert.equal(sections.openCycle?.competenceMonth, '2026-05');
  assert.equal(sections.followingCycle?.competenceMonth, '2026-06');
  // Vencida e paga ficam no histórico; a próxima a pagar não se repete.
  assert.deepEqual(idsOf(sections.history), ['2026-03', '2026-02']);
});

test('seções das faturas: aberta já efetivamente fechada com saldo é a próxima a pagar', () => {
  const today = '2026-05-26';
  const closing = inv('2026-05', { cycleStatus: 'open', totalCents: 8_000, remainingCents: 8_000 });
  const next = inv('2026-06', { cycleStatus: 'open', totalCents: 500, remainingCents: 500 });
  const sections = selectInvoiceSections([closing, next], [], today);
  assert.equal(sections.nextToPay?.id, closing.id);
  assert.equal(sections.openCycle?.id, next.id);
  assert.equal(sections.followingCycle, null);
  assert.deepEqual(sections.history, []);
});

test('seções das faturas: vence primeiro a de menor vencimento entre fechada e aberta já fechada', () => {
  const today = '2026-05-26';
  const closedLater = inv('2026-04', { cycleStatus: 'closed', dueDate: '2026-06-10' });
  const closingSooner = inv('2026-05', { cycleStatus: 'open', dueDate: '2026-05-30', totalCents: 8_000, remainingCents: 8_000 });
  const sections = selectInvoiceSections([closingSooner], [closedLater], today);
  assert.equal(sections.nextToPay?.id, closingSooner.id);
  assert.deepEqual(idsOf(sections.history), ['2026-04']);
});

test('seções das faturas: vencida não é a próxima a pagar; sem nenhuma, a seção não existe', () => {
  const today = '2026-05-26';
  const overdueOnly = selectInvoiceSections([], [inv('2026-03', { cycleStatus: 'closed' })], today);
  assert.equal(overdueOnly.nextToPay, null);
  assert.equal(overdueOnly.openCycle, null);
  assert.equal(overdueOnly.followingCycle, null);
  assert.deepEqual(idsOf(overdueOnly.history), ['2026-03']);

  // Aberta já fechada sem saldo (crédito) não é a próxima a pagar nem some da tela.
  const credit = inv('2026-05', { cycleStatus: 'open', totalCents: -500, remainingCents: -500 });
  const withCredit = selectInvoiceSections([credit], [], today);
  assert.equal(withCredit.nextToPay, null);
  assert.deepEqual(idsOf(withCredit.history), ['2026-05']);

  const none = selectInvoiceSections([], [], today);
  assert.deepEqual(none, { nextToPay: null, openCycle: null, followingCycle: null, history: [] });
});

test('crédito em fatura aberta: nota só quando aberta e com total negativo', () => {
  const plain = (text: string | null) => (text ?? '').replace(/\u00a0/g, ' ');
  assert.equal(
    plain(openInvoiceCreditNote(invoice({ cycleStatus: 'open', totalCents: -12_345, remainingCents: -12_345 }))),
    'Crédito de R$ 123,45 a transportar para a próxima fatura no fechamento.',
  );
  assert.equal(openInvoiceCreditNote(invoice({ cycleStatus: 'open', totalCents: 0, remainingCents: 0 })), null);
  assert.equal(openInvoiceCreditNote(invoice({ cycleStatus: 'open', totalCents: 500, remainingCents: 500 })), null);
  assert.equal(openInvoiceCreditNote(invoice({ cycleStatus: 'closed', totalCents: -500, remainingCents: 0 })), null);
});

test('permissões: owner/admin administram; member compra; viewer só lê', () => {
  assert.deepEqual(cardPermissions('owner'), { canManage: true, canPurchase: true });
  assert.deepEqual(cardPermissions('admin'), { canManage: true, canPurchase: true });
  assert.deepEqual(cardPermissions('member'), { canManage: false, canPurchase: true });
  assert.deepEqual(cardPermissions('viewer'), { canManage: false, canPurchase: false });
  assert.deepEqual(cardPermissions(null), { canManage: false, canPurchase: false });
});

test('callables: a chave decidida pelo diálogo vai junto; reconciliação sem chave', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const callables = createCardsCallables(async (name, payload) => {
    calls.push([name, payload]);
    return { replayed: false } as never;
  });
  await callables.createCreditCardPurchase({ cardId: 'c' }, 'key-1');
  await callables.registerInvoicePayment({ invoiceId: 'i' }, 'key-2');
  await callables.recalculateCardLimit({ cardId: 'c' });
  assert.deepEqual(calls, [
    ['createCreditCardPurchase', { cardId: 'c', idempotencyKey: 'key-1' }],
    ['registerInvoicePayment', { invoiceId: 'i', idempotencyKey: 'key-2' }],
    ['recalculateCardLimit', { cardId: 'c' }],
  ]);
});

test('espelho de pagamento de fatura: marca de liquidação do cartão', () => {
  const base = {
    category: 'Fatura de cartão', date: '2026-10-06', isPaid: true, workspaceId: 'ws', userId: 'u',
  };
  const payment = {
    ...base, id: 'cccash_1', type: 'despesa', description: 'Pagamento de fatura', value: 300, valueCents: 30_000,
    creditCardPaymentEntry: { cardId: 'card_1', invoiceId: 'card_1_2026-10', paymentId: 'ccpay_1', reversal: false, amountCents: 30_000 },
  } as unknown as Transaction;
  const reversal = {
    ...base, id: 'cccash_2', type: 'receita', description: 'Estorno de pagamento de fatura', value: 100, valueCents: 10_000,
    creditCardPaymentEntry: { cardId: 'card_1', invoiceId: 'card_1_2026-10', paymentId: 'ccpay_2', reversal: true, amountCents: 10_000, reversalOf: 'ccpay_1' },
  } as unknown as Transaction;
  const purchaseLikeExpense = {
    ...base, id: 'manual_1', type: 'despesa', description: 'Mercado', value: 50, valueCents: 5_000,
  } as unknown as Transaction;
  assert.equal(isCreditCardPaymentCashMirror(payment), true);
  assert.equal(isCreditCardPaymentCashMirror(purchaseLikeExpense), false);
  assert.equal(isCreditCardPaymentCashMirror(reversal), true);
});
