import { clientsErrorView, type ClientsErrorView } from '../clients/presentation.ts';
import { formatCents } from '../loans/money.ts';
import { formatCompetence, isCycleEffectivelyClosed, isInvoiceOverdue } from './cycle.ts';
import type {
  CardEvent,
  CardInvoice,
  CardInvoiceEntry,
  CardPurchase,
  CreditCard,
} from './types.ts';

/**
 * Textos, permissões e erros do domínio de cartões (P4-A). Módulo puro; tudo
 * que aparece ao usuário em pt-BR. Os valores chegam em centavos e só viram
 * reais na formatação de exibição.
 */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface CardPermissions {
  /** Cadastro, arquivamento, pagamento, estornos, ajuste e reconciliação. */
  canManage: boolean;
  /** Lançar compra manual no cartão. */
  canPurchase: boolean;
}

/** Mesma matriz do backend: owner/admin administram; member lança compras. */
export const cardPermissions = (role?: WorkspaceRole | null): CardPermissions => ({
  canManage: role === 'owner' || role === 'admin',
  canPurchase: role === 'owner' || role === 'admin' || role === 'member',
});

export const CARD_STATUS_LABELS: Record<CreditCard['status'], string> = {
  active: 'Ativo',
  archived: 'Arquivado',
};

export type InvoiceDisplayStatus = 'open' | 'closing' | 'unpaid' | 'partial' | 'paid' | 'overdue';

/**
 * Situação exibida da fatura: o ciclo (aberta/fechada) e o pagamento são
 * estados separados no backend; "vencida" é derivada (nunca gravada) e
 * "fechando" é a fatura cuja data de fechamento chegou antes da rotina.
 */
export const invoiceDisplayStatus = (invoice: CardInvoice, today: string): InvoiceDisplayStatus => {
  if (invoice.cycleStatus === 'open') {
    return isCycleEffectivelyClosed(invoice, today) ? 'closing' : 'open';
  }
  if (invoice.paymentStatus === 'paid') return 'paid';
  if (isInvoiceOverdue(invoice, today)) return 'overdue';
  return invoice.paymentStatus === 'partial' ? 'partial' : 'unpaid';
};

export const INVOICE_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  open: 'Aberta',
  closing: 'Fechada',
  unpaid: 'Fechada',
  partial: 'Paga parcialmente',
  paid: 'Paga',
  overdue: 'Vencida',
};

export const INVOICE_STATUS_BADGE: Record<InvoiceDisplayStatus, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  closing: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  unpaid: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

/** Fatura que aceita pagamento: ciclo fechado (inclusive antes do vencimento) e saldo. */
export const canPayInvoice = (invoice: CardInvoice, today: string): boolean =>
  isCycleEffectivelyClosed(invoice, today) &&
  (invoice.cycleStatus === 'open' ? invoice.totalCents > 0 : invoice.remainingCents > 0);

/** Saldo a pagar exibido: na fatura ainda não fechada pela rotina, o total. */
export const payableCents = (invoice: CardInvoice): number =>
  invoice.cycleStatus === 'open' ? Math.max(invoice.totalCents, 0) : invoice.remainingCents;

export const PURCHASE_STATUS_LABELS: Record<CardPurchase['status'], string> = {
  active: 'Ativa',
  cancelled: 'Cancelada',
  refunded: 'Estornada',
};

/** Descrição de um lançamento da fatura (a compra é resolvida pelo ID). */
export const entryLabel = (entry: CardInvoiceEntry, purchase?: CardPurchase): string => {
  const description = purchase?.description ?? 'Compra';
  switch (entry.kind) {
    case 'installment':
      return entry.installmentsCount && entry.installmentsCount > 1
        ? `${description} (${entry.installmentNumber}/${entry.installmentsCount})`
        : description;
    case 'refund_credit':
      return `Estorno: ${description}`;
    case 'adjustment':
      return entry.requestedCompetence && entry.requestedCompetence !== entry.competenceMonth
        ? `Ajuste da fatura de ${formatCompetence(entry.requestedCompetence)}`
        : 'Ajuste manual';
    case 'carryover_in':
      return 'Crédito transportado da fatura anterior';
    case 'carryover_out':
      return 'Crédito transportado para a próxima fatura';
  }
};

/** Parcela de compra retroativa publicada fora da competência natural. */
export const entryNote = (entry: CardInvoiceEntry): string | null => {
  if (entry.kind === 'adjustment' && entry.reason) return entry.reason;
  if (
    entry.kind === 'installment' &&
    entry.naturalCompetence &&
    entry.naturalCompetence !== entry.competenceMonth
  ) {
    return `Compra retroativa: competência original ${formatCompetence(entry.naturalCompetence)}.`;
  }
  return null;
};

export const RETROACTIVE_WARNING = (target: string): string =>
  `A data informada é de uma fatura já fechada. As parcelas desse período serão lançadas na ` +
  `fatura aberta de ${formatCompetence(target)}; a data da compra é mantida.`;

export const ARCHIVE_EXPLANATION =
  'Arquivar mantém o histórico de compras, faturas e pagamentos. O cartão deixa de aceitar compras ' +
  'novas e pode ser reativado a qualquer momento. Só é possível arquivar sem saldo devedor, sem ' +
  'fatura a pagar e sem parcelas futuras.';

export const ADJUSTMENT_EXPLANATION =
  'O ajuste corrige o valor de uma fatura (tarifa, encargo ou crédito lançado pelo banco). Não é ' +
  'pagamento e não movimenta contas. Em fatura já fechada, a correção entra na próxima fatura aberta.';

export const PAYMENT_EXPLANATION =
  'O pagamento sai da conta escolhida e libera o limite do cartão. Ele quita o cartão: não conta ' +
  'como despesa (as despesas são as compras).';

export const REVERSAL_EXPLANATION =
  'O estorno devolve o valor à mesma conta do pagamento original e volta a consumir o limite. O ' +
  'pagamento original continua no histórico.';

/** Efeito esperado do ajuste, para o usuário conferir antes de confirmar. */
export const adjustmentEffect = (
  amountCents: number,
  requested: string,
  target: string,
): string => {
  const direction = amountCents > 0 ? 'aumenta' : 'reduz';
  const where = requested === target
    ? `a fatura de ${formatCompetence(target)}`
    : `a fatura aberta de ${formatCompetence(target)} (a de ${formatCompetence(requested)} já fechou)`;
  return `${direction === 'aumenta' ? 'Aumenta' : 'Reduz'} em ${formatCents(Math.abs(amountCents))} ${where} ` +
    `e ${amountCents > 0 ? 'consome' : 'libera'} o mesmo valor do limite.`;
};

const EVENT_LABELS: Record<string, string> = {
  'credit_card.created': 'Cartão cadastrado',
  'credit_card.updated': 'Cadastro alterado',
  'credit_card.archived': 'Cartão arquivado',
  'credit_card.reactivated': 'Cartão reativado',
  'credit_card.purchase_created': 'Compra lançada',
  'credit_card.purchase_updated': 'Compra alterada',
  'credit_card.purchase_cancelled': 'Compra cancelada',
  'credit_card.purchase_refunded': 'Compra estornada',
  'credit_card.adjustment_created': 'Ajuste lançado',
  'credit_card.invoice_closed': 'Fatura fechada',
  'credit_card.payment_registered': 'Pagamento registrado',
  'credit_card.payment_reversed': 'Pagamento estornado',
  'credit_card.limit_recalculated': 'Limite reconciliado',
  'credit_card.invoice_rebuilt': 'Fatura reconstruída',
};

export const eventLabel = (event: CardEvent): string => EVENT_LABELS[event.operation] ?? 'Operação';

/** Erro de preenchimento detectado antes de chamar o backend. */
export class CardInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardInputError';
  }
}

/** Erro de callable → mensagem pt-BR (mesma triagem dos demais domínios). */
export const cardsErrorView = (error: unknown): ClientsErrorView => {
  if (error instanceof CardInputError) {
    return { kind: 'validation', message: error.message, refresh: false };
  }
  return clientsErrorView(error);
};
