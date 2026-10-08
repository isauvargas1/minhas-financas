import { formatCents, formatDayKey } from '../loans/money.ts';
import { ClientInputError } from './payloads.ts';
import type {
  Receivable,
  ReceivableDisplayStatus,
  ReceivableMovement,
} from './types.ts';

/**
 * Apresentação de clientes e recebíveis (P3-I). Módulo puro.
 *
 * Nada aqui calcula saldo, acumulado ou status persistido: tudo vem do
 * documento gravado pelo backend. O que se deriva é leitura — o atraso
 * (função única, pela data civil de São Paulo), rótulos e o que cada papel
 * pode tentar. A autoridade continua no backend: a interface só esconde
 * ações sabidamente inválidas.
 */

/**
 * Em atraso: em aberto com vencimento **antes** de hoje (`AAAA-MM-DD` em
 * America/Sao_Paulo). Comparação de datas civis em texto — nada de
 * `new Date('AAAA-MM-DD')`, que é meia-noite UTC e cai no dia anterior no
 * Brasil. É a mesma regra de `isReceivableOverdue` no backend.
 */
/** Soma dias a uma data civil (`AAAA-MM-DD`), em UTC puro — sem fuso. */
export const addDaysToDayKey = (dayKey: string, days: number): string => {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

export const isReceivableOverdue = (
  receivable: Pick<Receivable, 'status' | 'dueDate'>,
  today: string,
): boolean => receivable.status === 'open' && receivable.dueDate < today;

export const receivableDisplayStatus = (
  receivable: Pick<Receivable, 'status' | 'dueDate'>,
  today: string,
): ReceivableDisplayStatus =>
  isReceivableOverdue(receivable, today) ? 'overdue' : receivable.status;

export const RECEIVABLE_STATUS_LABELS: Record<ReceivableDisplayStatus, string> = {
  open: 'Em aberto',
  overdue: 'Em atraso',
  received: 'Recebido',
  cancelled: 'Cancelado',
};

/** Classes do selo de status (as mesmas cores que a tabela já usava). */
export const RECEIVABLE_STATUS_BADGE: Record<ReceivableDisplayStatus, string> = {
  open: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300',
  received: 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

/** CPF/CNPJ gravado só com dígitos → com pontuação, para exibição. */
export const formatDocument = (document?: string): string => {
  if (!document) return '-';
  if (/^\d{11}$/.test(document)) {
    return document.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  if (/^\d{14}$/.test(document)) {
    return document.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return document;
};

/** Nome do movimento no histórico. */
export const movementLabel = (movement: ReceivableMovement): string =>
  movement.kind === 'receipt' ? 'Recebimento' : 'Estorno de recebimento';

/** Situação do movimento: o original estornado continua no histórico. */
export const movementStateLabel = (
  movement: ReceivableMovement,
  movements: ReceivableMovement[] = [],
): string => {
  if (movement.kind === 'reversal') {
    const original = movements.find((item) => item.id === movement.reversalOf);
    return original ? `Compensa o recebimento de ${formatDayKey(original.date)}` : 'Compensação';
  }
  return movement.reversedBy ? 'Estornado' : 'Ativo';
};

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface ClientPermissions {
  /** Cria, edita e arquiva clientes; lê os dados pessoais (D-24). */
  canManageClients: boolean;
  canSeePrivateData: boolean;
  canCreateReceivable: boolean;
}

/**
 * Cadastro: owner/admin administram e veem dados pessoais; member e viewer
 * só a lista mínima. Recebíveis: owner/admin/member criam; viewer só lê.
 */
export const clientPermissions = (role?: WorkspaceRole | null): ClientPermissions => {
  const admin = role === 'owner' || role === 'admin';
  return {
    canManageClients: admin,
    canSeePrivateData: admin,
    canCreateReceivable: admin || role === 'member',
  };
};

export interface ReceivablePermissions {
  /** Administra este recebível (owner/admin, ou member que o criou). */
  canManage: boolean;
  canReceive: boolean;
  canEdit: boolean;
  canCancel: boolean;
  canReverse: (movement: ReceivableMovement) => boolean;
}

export const receivablePermissions = (
  actor: { role?: WorkspaceRole | null; uid?: string | null },
  receivable?: Receivable | null,
): ReceivablePermissions => {
  const role = actor.role ?? null;
  const canManage = Boolean(receivable) && (
    role === 'owner' || role === 'admin' ||
    (role === 'member' && Boolean(actor.uid) && receivable!.createdBy === actor.uid)
  );
  const open = receivable?.status === 'open';
  const notCancelled = Boolean(receivable) && receivable!.status !== 'cancelled';
  return {
    canManage,
    canReceive: canManage && open,
    canEdit: canManage && notCancelled,
    canCancel: canManage && open,
    canReverse: (movement) => canManage && notCancelled &&
      movement.kind === 'receipt' && movement.reversedBy === null,
  };
};

/** O valor original só muda sem recebimento ativo e sem desconto concedido. */
export const isAmountLocked = (receivable: Receivable): boolean =>
  receivable.activeReceiptCount > 0 ||
  receivable.principalReceivedCents > 0 ||
  receivable.discountGrantedCents > 0;

export const AMOUNT_LOCKED_HINT =
  'O valor original não pode mudar depois de recebimento ou desconto. Estorne os recebimentos para alterá-lo.';

export const CANCEL_WITH_RECEIPTS_HINT =
  'Este recebível tem recebimentos ativos. Estorne-os no histórico antes de cancelar.';

export const ARCHIVE_EXPLANATION =
  'O cliente arquivado continua no histórico dos recebíveis, mas não recebe novos recebíveis. ' +
  'Clientes com recebíveis em aberto não podem ser arquivados: receba ou cancele esses recebíveis antes.';

/** Resumo do recebimento para o histórico e a confirmação de estorno. */
export const movementSummary = (movement: ReceivableMovement): string =>
  `${formatCents(movement.cashCents)} recebido (principal ${formatCents(movement.principalCents)}, ` +
  `juros ${formatCents(movement.interestCents)}, multa ${formatCents(movement.penaltyCents)})` +
  (movement.discountCents > 0 ? `; desconto de ${formatCents(movement.discountCents)}` : '');

export type ClientsErrorKind =
  | 'validation'
  | 'conflict'
  | 'forbidden'
  | 'precondition'
  | 'quota'
  | 'session'
  | 'uncertain';

export interface ClientsErrorView {
  kind: ClientsErrorKind;
  message: string;
  /** O servidor está em outro estado que o exibido: recarregar. */
  refresh: boolean;
}

/** Textos que o SDK de Functions gera sozinho, sem resposta do backend. */
const SDK_DEFAULT_MESSAGE = /^(internal|Response is (not valid JSON object|missing data field)\.)$/;

const UNCERTAIN_MESSAGE =
  'Não foi possível confirmar a operação. Verifique a conexão e tente de novo: o reenvio do mesmo conteúdo não duplica o registro.';

/**
 * Erro da callable → mensagem pt-BR e tratamento. As mensagens do backend já
 * são pt-BR; aqui só se escolhe a mais útil.
 */
export const clientsErrorView = (error: unknown): ClientsErrorView => {
  if (error instanceof ClientInputError) {
    return { kind: 'validation', message: error.message, refresh: false };
  }
  const value = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  const code = typeof value?.code === 'string' ? value.code.replace(/^functions\//, '') : '';
  const raw = typeof value?.message === 'string' ? value.message.trim() : '';
  const message = raw && raw !== code && !SDK_DEFAULT_MESSAGE.test(raw) ? raw : '';
  const details = (value?.details ?? {}) as { issues?: Array<{ message?: unknown }> };
  switch (code) {
    case 'invalid-argument': {
      const issue = details.issues?.find((item) => typeof item.message === 'string');
      return {
        kind: 'validation',
        message: typeof issue?.message === 'string'
          ? issue.message
          : message || 'Revise os dados informados e tente novamente.',
        refresh: false,
      };
    }
    case 'aborted':
      return {
        kind: 'conflict',
        message: message || 'Este registro foi alterado por outra operação. Atualize e tente novamente.',
        refresh: true,
      };
    case 'permission-denied':
      return {
        kind: 'forbidden',
        message: message || 'Você não tem permissão para esta operação neste espaço.',
        refresh: false,
      };
    case 'unauthenticated':
      return { kind: 'session', message: 'Sua sessão expirou. Entre novamente para continuar.', refresh: false };
    case 'resource-exhausted':
      return {
        kind: 'quota',
        message: message || 'O limite desta operação foi atingido. Tente novamente mais tarde.',
        refresh: false,
      };
    case 'not-found':
      return {
        kind: 'conflict',
        message: message || 'Registro não encontrado. Atualize a lista e tente novamente.',
        refresh: true,
      };
    case 'failed-precondition':
      return {
        kind: 'precondition',
        message: message || 'Não foi possível concluir a operação no estado atual. Atualize e tente novamente.',
        refresh: true,
      };
    default:
      return {
        kind: 'uncertain',
        message: code === 'internal' && message ? message : UNCERTAIN_MESSAGE,
        refresh: true,
      };
  }
};
