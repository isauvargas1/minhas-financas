/**
 * Modelo de leitura de cartões de crédito (P4-A, D-36), tal como o backend
 * grava (`schemaVersion: 1`). Valores em centavos inteiros; datas civis
 * `YYYY-MM-DD` e competências `YYYY-MM` em São Paulo. Nada aqui é escrito
 * pelo cliente: toda escrita é das callables.
 */
export type CreditCardBrand = 'Visa' | 'Mastercard' | 'Elo' | 'Amex';
export type CreditCardStatus = 'active' | 'archived';

export type CreditCardVisualBgType = 'color' | 'gradient' | 'image';
export type CreditCardVisualTextColor = 'white' | 'black';

export interface CreditCardVisual {
  bgType: CreditCardVisualBgType;
  bgColor: string;
  bgGradientColor?: string;
  bgImage?: string;
  textColor: CreditCardVisualTextColor;
  showName: boolean;
  showBrand: boolean;
  showLogo: boolean;
}

export interface CreditCard {
  id: string;
  name: string;
  brand: CreditCardBrand;
  status: CreditCardStatus;
  /** Limite total, usado (pode ser negativo: crédito a favor) e disponível. */
  limitTotalCents: number;
  limitUsedCents: number;
  limitAvailableCents: number;
  closingDay: number;
  dueDay: number;
  bestDay?: number;
  observations?: string;
  responsiblePerson?: string;
  recommendedUse?: string;
  defaultCostCenter?: string;
  visual: CreditCardVisual;
  /** Versão do cadastro (`updatedAt`) para editar, arquivar e reativar. */
  version: string;
}

export type CardPurchaseStatus = 'active' | 'cancelled' | 'refunded';
export type CardPurchaseSource = 'manual' | 'recurring' | 'split';

export interface CardPurchase {
  id: string;
  cardId: string;
  description: string;
  category: string;
  supplier?: string;
  costCenter?: string;
  purchaseDate: string;
  totalCents: number;
  installmentsCount: number;
  status: CardPurchaseStatus;
  source: CardPurchaseSource;
  refundedCents: number;
  /** Competência da primeira parcela vigente (já com a regra retroativa). */
  firstCompetence: string;
  retroactive: boolean;
  createdBy: string;
  version: string;
}

export type InvoiceCycleStatus = 'open' | 'closed';
export type InvoicePaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface CardInvoice {
  id: string;
  cardId: string;
  competenceMonth: string;
  closingDate: string;
  dueDate: string;
  cycleStatus: InvoiceCycleStatus;
  paymentStatus: InvoicePaymentStatus;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  activeEntryCount: number;
  /** Versão (`updatedAt`) para pagar e estornar pagamento. */
  version: string;
}

export type CardEntryKind =
  | 'installment'
  | 'adjustment'
  | 'refund_credit'
  | 'carryover_in'
  | 'carryover_out';

export interface CardInvoiceEntry {
  id: string;
  cardId: string;
  invoiceId: string;
  competenceMonth: string;
  kind: CardEntryKind;
  /** Centavos com sinal: débito positivo, crédito negativo. */
  amountCents: number;
  status: 'active' | 'cancelled';
  purchaseId?: string;
  installmentNumber?: number;
  installmentsCount?: number;
  naturalCompetence?: string;
  requestedCompetence?: string;
  reason?: string;
}

export type CardPaymentKind = 'payment' | 'reversal';

export interface CardPayment {
  id: string;
  cardId: string;
  invoiceId: string;
  kind: CardPaymentKind;
  amountCents: number;
  paymentDate: string;
  cashAccountId: string;
  reversalOf?: string;
  reversedBy?: string;
}

export interface CardEvent {
  id: string;
  cardId: string;
  operation: string;
  actorId: string;
  amountCents?: number;
  occurredAtMillis: number;
}
