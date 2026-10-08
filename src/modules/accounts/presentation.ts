import { clientsErrorView, type ClientsErrorView } from '../clients/presentation.ts';
import type {
  CashAccount,
  CashAccountMovement,
  CashAccountType,
  CashTransfer,
} from './types.ts';

/**
 * Textos, permissões e erros de contas/carteiras e transferências (D-30,
 * P3-J). Módulo puro; tudo que aparece ao usuário em pt-BR.
 */
export const ACCOUNT_TYPE_LABELS: Record<CashAccountType, string> = {
  cash: 'Dinheiro',
  checking: 'Conta corrente',
  savings: 'Poupança',
  digital: 'Conta digital',
  other: 'Outra',
};

export const ACCOUNT_STATUS_LABELS: Record<CashAccount['status'], string> = {
  active: 'Ativa',
  archived: 'Arquivada',
};

export const MOVEMENT_KIND_LABELS: Record<CashAccountMovement['kind'], string> = {
  opening_balance: 'Saldo inicial',
  cash_transaction: 'Lançamento',
  loan: 'Empréstimo',
  receivable: 'Recebível',
  credit_card_payment: 'Pagamento de fatura de cartão',
  split: 'Divisão de contas',
  investment: 'Investimento',
  transfer_in: 'Transferência recebida',
  transfer_out: 'Transferência enviada',
  reversal: 'Estorno',
};

/** Origem de um estorno (o movimento compensado é do mesmo domínio). */
const REVERSAL_SOURCE_LABELS: Record<CashAccountMovement['sourceDomain'], string> = {
  account: 'Estorno de saldo inicial',
  cash: 'Estorno de lançamento',
  loan: 'Estorno de empréstimo',
  receivable: 'Estorno de recebível',
  credit_card: 'Estorno de pagamento de fatura de cartão',
  split: 'Estorno de divisão de contas',
  investment: 'Estorno de investimento',
  transfer: 'Estorno de transferência',
};

export const movementKindLabel = (movement: CashAccountMovement): string =>
  movement.kind === 'reversal'
    ? REVERSAL_SOURCE_LABELS[movement.sourceDomain]
    : MOVEMENT_KIND_LABELS[movement.kind];

export const TRANSFER_STATUS_LABELS: Record<CashTransfer['status'], string> = {
  completed: 'Concluída',
  reversed: 'Estornada',
};

/**
 * Quais fatos movem as contas (D-30). P4-C: o título pago pelo Caixa e o
 * reembolso PJ pago na Divisão de contas. P4-D: aporte depositado e retirada
 * recebida de investimentos (o pendente, não). A compra no cartão não move
 * conta — o pagamento da fatura, sim.
 */
export const LEDGER_COVERAGE_NOTE =
  'Os saldos refletem lançamentos manuais, transferências, empréstimos, recebimentos de recebíveis, ' +
  'pagamentos de fatura de cartão, despesas recorrentes pagas, despesas da Divisão de contas pagas pelo ' +
  'Caixa e aportes e retiradas de investimentos já liquidados.';

export const ARCHIVE_WITH_BALANCE_HINT =
  'Só é possível arquivar uma conta com saldo zero. Transfira o saldo para outra conta antes.';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface AccountPermissions {
  /** Criar, renomear, mudar o tipo, arquivar e reativar contas. */
  canManage: boolean;
  /** Transferir entre contas ativas. */
  canTransfer: boolean;
}

/** Mesma matriz do backend: owner/admin administram; member transfere. */
export const accountPermissions = (role?: WorkspaceRole | null): AccountPermissions => ({
  canManage: role === 'owner' || role === 'admin',
  canTransfer: role === 'owner' || role === 'admin' || role === 'member',
});

/** Owner/admin estornam qualquer transferência; member, só as suas. */
export const canReverseTransfer = (
  transfer: CashTransfer,
  role: WorkspaceRole | null | undefined,
  uid: string | null | undefined,
): boolean => {
  if (transfer.status !== 'completed') return false;
  if (role === 'owner' || role === 'admin') return true;
  return role === 'member' && Boolean(uid) && transfer.createdBy === uid;
};

/** Erro de preenchimento detectado antes de chamar o backend. */
export class AccountInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountInputError';
  }
}

/** Erro de callable → mensagem pt-BR (mesma triagem dos demais domínios P3). */
export const accountsErrorView = (error: unknown): ClientsErrorView => {
  if (error instanceof AccountInputError) {
    return { kind: 'validation', message: error.message, refresh: false };
  }
  return clientsErrorView(error);
};
