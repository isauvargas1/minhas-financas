/**
 * Modelo de clientes e recebíveis lido pela interface (D-24, D-39, P3-I).
 *
 * Só o formato autoritativo gravado pelo backend (`schemaVersion: 1`). Valores
 * em centavos inteiros; datas civis `AAAA-MM-DD` (America/Sao_Paulo). O
 * status persistido do recebível é `open | received | cancelled`; "em atraso"
 * não é gravado — é derivado (`isReceivableOverdue`).
 */
export type ClientStatus = 'active' | 'archived';

/** Cadastro compartilhado com o workspace: sem dados pessoais. */
export interface Client {
  id: string;
  name: string;
  status: ClientStatus;
  createdBy: string;
  /** `updatedAt` em ISO com nanossegundos: a versão esperada nas mutações. */
  version: string;
}

/** Dados pessoais (`client_private`): só owner e admin leem. */
export interface ClientPrivate {
  clientId: string;
  document?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export type ReceivableStatus = 'open' | 'received' | 'cancelled';
/** Situação exibida: o status persistido com o atraso derivado. */
export type ReceivableDisplayStatus = 'open' | 'overdue' | 'received' | 'cancelled';

export interface Receivable {
  id: string;
  clientId: string;
  description: string;
  category?: string;
  amountCents: number;
  principalReceivedCents: number;
  discountGrantedCents: number;
  interestReceivedCents: number;
  penaltyReceivedCents: number;
  balanceCents: number;
  activeReceiptCount: number;
  dueDate: string;
  status: ReceivableStatus;
  createdBy: string;
  cancelReason?: string;
  version: string;
}

export type ReceivableMovementKind = 'receipt' | 'reversal';

export interface ReceivableMovement {
  id: string;
  receivableId: string;
  kind: ReceivableMovementKind;
  principalCents: number;
  interestCents: number;
  penaltyCents: number;
  /** Abatimento concedido: reduz o saldo, não é dinheiro recebido. */
  discountCents: number;
  /** Dinheiro do movimento: principal + juros + multa. */
  cashCents: number;
  date: string;
  reversalOf: string | null;
  reversedBy: string | null;
  reason: string | null;
  createdBy: string;
}

/** Totais do servidor (centavos), sobre o saldo dos recebíveis em aberto. */
export interface ReceivableTotals {
  openCents: number;
  overdueCents: number;
  upcomingCents: number;
}

/** Indicadores de recebíveis do relatório PJ, agregados no servidor. */
export interface ReceivableReportData {
  openNotOverdue: { count: number; balanceCents: number };
  overdue: { count: number; balanceCents: number };
  received: { count: number; principalCents: number };
  topClients: Array<{ clientId: string; clientName: string; amountCents: number }>;
  /** A amostra do ranking de clientes atingiu o teto de leitura. */
  topClientsTruncated: boolean;
}
