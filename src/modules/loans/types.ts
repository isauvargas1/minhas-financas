/**
 * Modelo único de empréstimos no frontend (P3-H).
 *
 * É o contrato autoritativo `schemaVersion: 1` que o backend grava (D-13,
 * P3-G) — não existe outro formato. Todos os valores são centavos inteiros e
 * a taxa é inteiro em partes por milhão (1% = 10.000). Saldo, acumulados,
 * status, atraso e cronograma vêm prontos do backend: a interface só os
 * exibe. Datas civis são `AAAA-MM-DD` em São Paulo.
 */
export type LoanType = 'borrow' | 'lend';
export type LoanStatus = 'active' | 'overdue' | 'paid' | 'cancelled';
export type LoanProfileType = 'PF' | 'PJ';
export type LoanRatePeriod = 'monthly' | 'annual';
export type LoanAmortization = 'price' | 'sac' | 'simple';
export type LoanInterestType = 'none' | 'fixed' | 'percentage';

export type LoanInterest =
  | { type: 'none' }
  | { type: 'fixed'; totalInterestCents: number }
  | {
      type: 'percentage';
      ratePpm: number;
      ratePeriod: LoanRatePeriod;
      amortization: LoanAmortization;
    };

export const PJ_COUNTERPARTY_TYPES = [
  'banco', 'socio', 'colaborador', 'fornecedor', 'cliente', 'terceiro',
] as const;
export type PJCounterpartyType = (typeof PJ_COUNTERPARTY_TYPES)[number];

export const PJ_LOAN_CLASSIFICATIONS = [
  'dividas_financeiras', 'antecipacoes', 'emprestimos_colaboradores',
  'capital_giro', 'outro',
] as const;
export type PJLoanClassification = (typeof PJ_LOAN_CLASSIFICATIONS)[number];

/** Parcela do cronograma persistido pelo backend. */
export interface LoanInstallment {
  number: number;
  dueDate: string;
  principalCents: number;
  interestCents: number;
  totalCents: number;
}

export interface Loan {
  id: string;
  workspaceId: string;
  profileType: LoanProfileType;
  type: LoanType;
  personName: string;
  personContact?: string;
  description?: string;
  /** Só em PJ. */
  counterpartyType?: PJCounterpartyType;
  cnpjCpf?: string;
  classification?: PJLoanClassification;
  costCenter?: string;

  principalCents: number;
  balanceCents: number;
  totalPrincipalSettledCents: number;
  totalInterestSettledCents: number;
  activePaymentCount: number;
  status: LoanStatus;
  /** Primeiro dia de atraso da parcela em aberto (backend), ou `null`. */
  overdueFrom: string | null;

  interest: LoanInterest;
  startDate: string;
  firstDueDate: string;
  installmentsCount: number;
  schedule: LoanInstallment[];
  scheduledInterestCents: number;
  maturityDate: string;

  createdBy: string;
  updatedBy?: string;
  /** `updatedAt` em ISO-8601 com nanossegundos: a versão lida. */
  version: string;
  revision: number;
}

export type LoanMovementKind = 'disbursement' | 'payment' | 'reversal';

export interface LoanMovement {
  id: string;
  loanId: string;
  kind: LoanMovementKind;
  /** No estorno: o tipo do fato estornado. */
  originalKind?: 'disbursement' | 'payment';
  principalCents: number;
  interestCents: number;
  totalCents: number;
  date: string;
  cashDirection: 'in' | 'out';
  cashTransactionId: string;
  reversalOf: string | null;
  reversedBy: string | null;
  reason: string | null;
  createdBy: string;
}
