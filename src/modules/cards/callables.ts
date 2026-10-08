/**
 * Contrato cliente das callables de cartões de crédito (P4-A, D-36).
 *
 * Módulo puro: não importa o SDK. `api.ts` o liga ao `httpsCallable`; os
 * testes, a um `invoke` falso. A chave de idempotência chega pronta, decidida
 * por intenção no diálogo. As callables são o único caminho de escrita — as
 * Rules negam toda escrita do cliente em `credit_cards` e nas demais coleções
 * do domínio.
 */
export const CARDS_CALLABLES = [
  'createCreditCard',
  'updateCreditCard',
  'archiveCreditCard',
  'reactivateCreditCard',
  'createCreditCardPurchase',
  'cancelCreditCardPurchase',
  'refundCreditCardPurchase',
  'createCreditCardInvoiceAdjustment',
  'registerInvoicePayment',
  'reverseInvoicePayment',
  'recalculateCardLimit',
  'rebuildCardInvoicesForCard',
] as const;

export type CardsCallableName = (typeof CARDS_CALLABLES)[number];

export type CardsInvoke = <TResult>(
  name: CardsCallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

export interface CardMutationResult {
  cardId: string;
  status?: 'active' | 'archived';
  changed?: boolean;
  replayed: boolean;
}

export interface CardPurchaseResult {
  purchaseId: string;
  cardId: string;
  firstCompetence?: string;
  retroactive?: boolean;
  status?: 'cancelled' | 'refunded';
  refundedCents?: number;
  replayed: boolean;
}

export interface CardInvoiceResult {
  cardId: string;
  invoiceId: string;
  paymentId?: string;
  entryId?: string;
  competenceMonth?: string;
  compensated?: boolean;
  paymentStatus?: 'unpaid' | 'partial' | 'paid';
  remainingCents?: number;
  replayed: boolean;
}

export interface CardLimitReport {
  cardId: string;
  storedLimitUsedCents: number;
  ledgerLimitUsedCents: number;
  factsLimitUsedCents: number;
  sourcesAgree: boolean;
  consistent: boolean;
  repaired: boolean;
}

export interface InvoiceRebuildReport {
  cardId: string;
  processed: number;
  consistent: number;
  repaired: number;
  divergent: number;
  nextCursor: string | null;
}

const bind = <TResult>(invoke: CardsInvoke, name: CardsCallableName) =>
  (payload: Record<string, unknown>, idempotencyKey: string) =>
    invoke<TResult>(name, { ...payload, idempotencyKey });

/** Reconciliação: idempotente por natureza, sem chave. */
const bindReadOnly = <TResult>(invoke: CardsInvoke, name: CardsCallableName) =>
  (payload: Record<string, unknown>) => invoke<TResult>(name, payload);

export const createCardsCallables = (invoke: CardsInvoke) => ({
  createCreditCard: bind<CardMutationResult>(invoke, 'createCreditCard'),
  updateCreditCard: bind<CardMutationResult>(invoke, 'updateCreditCard'),
  archiveCreditCard: bind<CardMutationResult>(invoke, 'archiveCreditCard'),
  reactivateCreditCard: bind<CardMutationResult>(invoke, 'reactivateCreditCard'),
  createCreditCardPurchase: bind<CardPurchaseResult>(invoke, 'createCreditCardPurchase'),
  cancelCreditCardPurchase: bind<CardPurchaseResult>(invoke, 'cancelCreditCardPurchase'),
  refundCreditCardPurchase: bind<CardPurchaseResult>(invoke, 'refundCreditCardPurchase'),
  createCreditCardInvoiceAdjustment: bind<CardInvoiceResult>(invoke, 'createCreditCardInvoiceAdjustment'),
  registerInvoicePayment: bind<CardInvoiceResult>(invoke, 'registerInvoicePayment'),
  reverseInvoicePayment: bind<CardInvoiceResult>(invoke, 'reverseInvoicePayment'),
  recalculateCardLimit: bindReadOnly<CardLimitReport>(invoke, 'recalculateCardLimit'),
  rebuildCardInvoicesForCard: bindReadOnly<InvoiceRebuildReport>(invoke, 'rebuildCardInvoicesForCard'),
} satisfies Record<CardsCallableName, (...args: never[]) => Promise<unknown>>);

export type CardsCallables = ReturnType<typeof createCardsCallables>;
