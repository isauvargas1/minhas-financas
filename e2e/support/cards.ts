import { createRequire } from 'node:module';
import { expect, type Page } from '@playwright/test';

import { db, dayKey, today, type LoanTenant } from './loans';
import { adminSdk } from './workspaceSeed';

/**
 * Apoio dos E2E de cartões (P4-A, D-36), só no Emulator (Auth, Firestore e
 * Functions reais). A interface usa as callables `createCreditCard`,
 * `updateCreditCard`, `archiveCreditCard`, `reactivateCreditCard`,
 * `createCreditCardPurchase`, `cancelCreditCardPurchase`,
 * `refundCreditCardPurchase`, `registerInvoicePayment`,
 * `reverseInvoicePayment` e `createCreditCardInvoiceAdjustment`; os testes
 * leem o resultado pelo Admin SDK e nunca escrevem nas coleções de cartões
 * por fora.
 *
 * Fatura fechada exige o tempo passar. Para isso o arranjo chama o próprio
 * código do backend (o `lib` compilado que o emulador de Functions carrega,
 * com o Admin SDK, no mesmo Emulator) com o relógio injetado no dia da
 * compra — o mesmo seam das suítes de integração —, e depois a rotina real
 * de fechamento com a data de hoje. Nada é gravado à mão: o estado vem das
 * mesmas operações transacionais que as callables executam.
 */
type Doc = Record<string, any> & { id: string };

const require = createRequire(import.meta.url);

interface Actor { uid: string; workspaceId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }
interface Clock { now: () => number }

interface CardsBackend {
  executeCreateCreditCard: (actor: Actor, payload: Record<string, unknown>, requestId: string, options?: Clock) =>
    Promise<{ cardId: string }>;
  executeCreateCreditCardPurchase: (actor: Actor, payload: Record<string, unknown>, requestId: string, options?: Clock) =>
    Promise<{ purchaseId: string }>;
  runCreditCardInvoiceClosing: (options: { today?: string; requestId?: string }) =>
    Promise<{ closed: number; truncated: boolean }>;
}

let backend: CardsBackend | null = null;

/** Operações do backend compiladas (`functions/lib`), no mesmo Admin SDK. */
const cardsBackend = (): CardsBackend => {
  adminSdk();
  if (!backend) {
    backend = {
      ...require('../../functions/lib/cards/cardOperations.js'),
      ...require('../../functions/lib/cards/purchaseOperations.js'),
      ...require('../../functions/lib/cards/closing.js'),
    } as CardsBackend;
  }
  return backend;
};

/** Meio-dia em São Paulo (15:00Z) do dia informado, como nas integrações. */
const clockAt = (day: string): Clock => ({ now: () => Date.parse(`${day}T15:00:00.000Z`) });

let sequence = 0;
const nextKey = (label: string) => `e2e-card-${label}-${Date.now().toString(36)}-${sequence += 1}`;

export const CARD_VISUAL = {
  bgType: 'color', bgColor: '#1e293b', bgGradientColor: null, bgImage: null,
  textColor: 'white', showName: true, showBrand: true, showLogo: true,
};

/**
 * Dias de fechamento e vencimento em que a fatura do mês já fechou e ainda
 * não venceu hoje (pagamento antecipado possível), para qualquer dia do mês:
 * - dias 4–25: fecha dois dias atrás e vence daqui a dois;
 * - dias 1–3: fechou dia 28 do mês anterior e vence dia 5;
 * - dias 26–31: fechou dia 24 e vence dia 3 do mês seguinte.
 */
export const earlyPaymentCycle = (day = today()): { closingDay: number; dueDay: number } => {
  const d = Number(day.slice(8, 10));
  if (d >= 4 && d <= 25) return { closingDay: d - 2, dueDay: d + 2 };
  return d < 4 ? { closingDay: 28, dueDay: 5 } : { closingDay: 24, dueDay: 3 };
};

/** Cartão pelo backend (arranjo), em nome do owner do workspace. */
export const createCardFor = async (
  owner: { uid: string; workspaceId: string },
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const result = await cardsBackend().executeCreateCreditCard(
    { uid: owner.uid, workspaceId: owner.workspaceId, role: 'owner' },
    {
      workspaceId: owner.workspaceId, idempotencyKey: nextKey('card'), name: 'Cartão Arranjo',
      brand: 'Visa', closingDay: 25, dueDay: 5, limitTotalCents: 500_000, visual: CARD_VISUAL, ...overrides,
    },
    nextKey('req'),
  );
  return result.cardId;
};

/** Cartão pelo backend (arranjo); a criação pela tela é testada à parte. */
export const createCardByBackend = (tenant: LoanTenant, overrides: Record<string, unknown> = {}) =>
  createCardFor({ uid: tenant.owner.uid, workspaceId: tenant.workspaceId }, overrides);

/**
 * Compra feita no passado (relógio do backend no dia da compra): oito dias
 * atrás cai, com `earlyPaymentCycle`, na competência que já fechou hoje.
 */
export const buyInThePast = async (
  tenant: LoanTenant,
  cardId: string,
  input: { description: string; totalCents: number; installmentsCount?: number; daysAgo?: number },
): Promise<string> => {
  const purchaseDate = dayKey(-(input.daysAgo ?? 8));
  const result = await cardsBackend().executeCreateCreditCardPurchase(
    { uid: tenant.owner.uid, workspaceId: tenant.workspaceId, role: 'owner' },
    {
      workspaceId: tenant.workspaceId, idempotencyKey: nextKey('purchase'), cardId,
      description: input.description, category: 'Compras E2E', purchaseDate,
      totalCents: input.totalCents, installmentsCount: input.installmentsCount ?? 1,
    },
    nextKey('req'),
    clockAt(purchaseDate),
  );
  return result.purchaseId;
};

/** Compra de hoje pelo backend (relógio real): cai na fatura aberta. */
export const buyToday = async (
  tenant: LoanTenant,
  cardId: string,
  input: { description: string; totalCents: number; installmentsCount?: number },
): Promise<string> => {
  const result = await cardsBackend().executeCreateCreditCardPurchase(
    { uid: tenant.owner.uid, workspaceId: tenant.workspaceId, role: 'owner' },
    {
      workspaceId: tenant.workspaceId, idempotencyKey: nextKey('purchase'), cardId,
      description: input.description, category: 'Compras E2E', purchaseDate: today(),
      totalCents: input.totalCents, installmentsCount: input.installmentsCount ?? 1,
    },
    nextKey('req'),
  );
  return result.purchaseId;
};

/** A rotina real de fechamento (o agendador do Emulator não dispara). */
export const runClosingToday = async () =>
  cardsBackend().runCreditCardInvoiceClosing({ today: today(), requestId: nextKey('closing') });

const listOf = async (workspaceId: string, collection: string): Promise<Doc[]> =>
  (await db().collection(`workspaces/${workspaceId}/${collection}`).get())
    .docs.map((doc) => ({ id: doc.id, ...doc.data() }));

export const cardsOf = (workspaceId: string) => listOf(workspaceId, 'credit_cards');
export const purchasesOf = (workspaceId: string) => listOf(workspaceId, 'credit_card_purchases');
export const invoicesOf = (workspaceId: string) => listOf(workspaceId, 'credit_card_invoices');
export const entriesOf = (workspaceId: string) => listOf(workspaceId, 'credit_card_invoice_entries');
export const paymentsOf = (workspaceId: string) => listOf(workspaceId, 'credit_card_invoice_payments');
export const limitLedgerOf = (workspaceId: string) => listOf(workspaceId, 'credit_card_limit_ledger');

export const cardDoc = async (workspaceId: string, cardId: string): Promise<Record<string, any>> =>
  (await db().doc(`workspaces/${workspaceId}/credit_cards/${cardId}`).get()).data() ?? {};

export const invoiceDoc = async (workspaceId: string, invoiceId: string): Promise<Record<string, any>> =>
  (await db().doc(`workspaces/${workspaceId}/credit_card_invoices/${invoiceId}`).get()).data() ?? {};

/**
 * Invariantes do limite e das faturas, em centavos inteiros:
 * - limite usado = soma do razão do limite = parcelas/ajustes ativos −
 *   (pagamentos − estornos de pagamento); disponível = total − usado;
 * - em cada fatura, total = soma dos lançamentos ativos e restante =
 *   total − pago; nada de `overdue` gravado.
 */
export const expectCardConsistent = async (workspaceId: string, cardId: string) => {
  const card = await cardDoc(workspaceId, cardId);
  const ledger = (await limitLedgerOf(workspaceId)).filter((entry) => entry.cardId === cardId);
  const entries = (await entriesOf(workspaceId)).filter((entry) => entry.cardId === cardId);
  const payments = (await paymentsOf(workspaceId)).filter((payment) => payment.cardId === cardId);
  const invoices = (await invoicesOf(workspaceId)).filter((invoice) => invoice.cardId === cardId);
  const sum = (items: Doc[]) => items.reduce((total, item) => total + item.amountCents, 0);
  const active = entries.filter((entry) => entry.status === 'active');
  const paid = sum(payments.filter((payment) => payment.kind === 'payment')) -
    sum(payments.filter((payment) => payment.kind === 'reversal'));
  expect(Number.isSafeInteger(card.limitUsedCents)).toBe(true);
  expect(card.limitUsedCents, 'limite usado ≠ razão do limite').toBe(sum(ledger));
  expect(card.limitUsedCents, 'limite usado ≠ lançamentos − pagamentos').toBe(sum(active) - paid);
  expect(card.limitAvailableCents).toBe(card.limitTotalCents - card.limitUsedCents);
  for (const invoice of invoices) {
    const own = active.filter((entry) => entry.invoiceId === invoice.id);
    expect(invoice.totalCents, `total da fatura ${invoice.id}`).toBe(sum(own));
    expect(invoice.remainingCents).toBe(invoice.totalCents - invoice.paidCents);
    expect(['unpaid', 'partial', 'paid']).toContain(invoice.paymentStatus);
    expect(['open', 'closed']).toContain(invoice.cycleStatus);
  }
  return { card, invoices, entries, payments };
};

export const openCards = async (page: Page, type: 'PF' | 'PJ' = 'PF') => {
  await page.getByRole('link', { name: type === 'PJ' ? /Cartões Corporativos/ : /Cartões de Crédito/ }).click();
  await expect(page.getByRole('heading', { name: type === 'PJ' ? 'Cartões Corporativos' : 'Meus Cartões', level: 2 }))
    .toBeVisible({ timeout: 20_000 });
};

export const openCardDetails = async (page: Page, cardName: string) => {
  await page.getByText(cardName, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Detalhes do Cartão' })).toBeVisible({ timeout: 20_000 });
};

export const invoiceSummary = (page: Page, competenceLabel: string | RegExp) =>
  page.getByTestId('card-invoice-summary').filter({ hasText: competenceLabel });

/** `2026-10` → `10/2026`, como a tela (`formatCompetence`). */
export const competenceLabel = (monthKey: string): string => `${monthKey.slice(5, 7)}/${monthKey.slice(0, 4)}`;
