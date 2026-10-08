import { formatCents, formatRatePpm } from './money.ts';
import { LoanInputError } from './payloads.ts';
import type {
  Loan,
  LoanAmortization,
  LoanInstallment,
  LoanInterest,
  LoanMovement,
  LoanProfileType,
  LoanStatus,
  LoanType,
  PJCounterpartyType,
  PJLoanClassification,
} from './types.ts';

/**
 * Apresentação de empréstimos (P3-H). Módulo puro.
 *
 * Nada aqui calcula saldo, acumulado, status ou cronograma: tudo vem do
 * contrato gravado pelo backend. O que se deriva é só leitura do que já está
 * lá — rótulos, a próxima parcela (a mesma regra de `deriveLoanStatus` no
 * backend), a sugestão do pagamento e o que cada papel pode tentar. A
 * autoridade continua no backend: a interface só esconde ações sabidamente
 * inválidas.
 */

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  active: 'Em dia',
  overdue: 'Em atraso',
  paid: 'Quitado',
  cancelled: 'Cancelado',
};

export const LOAN_TYPE_LABELS: Record<LoanProfileType, Record<LoanType, string>> = {
  PF: { borrow: 'Peguei emprestado', lend: 'Emprestei dinheiro' },
  PJ: { borrow: 'Empresa tomou (passivo)', lend: 'Empresa concedeu (ativo)' },
};

export const AMORTIZATION_LABELS: Record<LoanAmortization, string> = {
  price: 'Tabela Price',
  sac: 'SAC',
  simple: 'Juros simples',
};

export const COUNTERPARTY_LABELS: Record<PJCounterpartyType, string> = {
  banco: 'Instituição Financeira',
  socio: 'Sócio / Acionista',
  colaborador: 'Colaborador',
  fornecedor: 'Fornecedor',
  cliente: 'Cliente',
  terceiro: 'Terceiro',
};

export const CLASSIFICATION_LABELS: Record<PJLoanClassification, string> = {
  dividas_financeiras: 'Dívidas Financeiras',
  antecipacoes: 'Antecipações',
  emprestimos_colaboradores: 'Empréstimos a Colaboradores',
  capital_giro: 'Capital de Giro',
  outro: 'Outros',
};

export const classificationLabel = (value?: PJLoanClassification): string =>
  value ? CLASSIFICATION_LABELS[value] : 'Não classificado';

/** `Sem juros` · `Juros fixos de R$ 100,00` · `1,99% ao mês · Tabela Price`. */
export const interestLabel = (interest: LoanInterest): string => {
  if (interest.type === 'none') return 'Sem juros';
  if (interest.type === 'fixed') {
    return `Juros fixos de ${formatCents(interest.totalInterestCents)}`;
  }
  const period = interest.ratePeriod === 'monthly' ? 'ao mês' : 'ao ano';
  return `${formatRatePpm(interest.ratePpm)} ${period} · ${AMORTIZATION_LABELS[interest.amortization]}`;
};

/** Contrato que ainda conta como saldo em aberto (ativo ou passivo). */
export const isOpenLoan = (loan: Pick<Loan, 'status'>): boolean =>
  loan.status === 'active' || loan.status === 'overdue';

/**
 * Saldo principal em aberto exibido. Quitado tem saldo zero pelo próprio
 * backend; cancelado não tem saldo em aberto (o principal foi compensado no
 * caixa), embora o contrato guarde o `balanceCents` do momento do
 * cancelamento. É o mesmo recorte dos totais (`status in [active, overdue]`).
 */
export const openBalanceCents = (loan: Pick<Loan, 'status' | 'balanceCents'>): number =>
  isOpenLoan(loan) ? loan.balanceCents : 0;

/** Percentual inteiro do principal já liquidado. */
export const principalProgressPercent = (
  loan: Pick<Loan, 'principalCents' | 'totalPrincipalSettledCents'>,
): number => loan.principalCents > 0
  ? Math.floor((loan.totalPrincipalSettledCents * 100) / loan.principalCents)
  : 0;

export type InstallmentState =
  | 'amortized'
  | 'partial'
  | 'next'
  | 'overdue'
  | 'upcoming'
  | 'cancelled';

export const INSTALLMENT_STATE_LABELS: Record<InstallmentState, string> = {
  amortized: 'Amortizada',
  partial: 'Parcial',
  next: 'Próxima',
  overdue: 'Vencida',
  upcoming: 'A vencer',
  cancelled: 'Cancelada',
};

export interface ScheduleRow extends LoanInstallment {
  state: InstallmentState;
}

/**
 * Cronograma persistido com a situação de cada parcela pelo principal
 * amortizado (`totalPrincipalSettledCents`), na mesma regra de atraso do
 * backend: a parcela em aberto vence no dia seguinte ao vencimento.
 */
export const scheduleRows = (loan: Loan, today: string): ScheduleRow[] => {
  let cumulative = 0;
  let nextAssigned = false;
  return loan.schedule.map((installment) => {
    const before = cumulative;
    cumulative += installment.principalCents;
    let state: InstallmentState;
    if (loan.status === 'cancelled') {
      state = 'cancelled';
    } else if (cumulative <= loan.totalPrincipalSettledCents) {
      state = 'amortized';
    } else {
      const overdue = installment.dueDate < today;
      if (!nextAssigned) {
        nextAssigned = true;
        state = overdue
          ? 'overdue'
          : before < loan.totalPrincipalSettledCents ? 'partial' : 'next';
      } else {
        state = overdue ? 'overdue' : 'upcoming';
      }
    }
    return { ...installment, state };
  });
};

/** Primeira parcela cujo principal ainda não foi todo amortizado. */
export const nextInstallment = (loan: Loan): LoanInstallment | null => {
  if (!isOpenLoan(loan)) return null;
  let cumulative = 0;
  for (const installment of loan.schedule) {
    cumulative += installment.principalCents;
    if (cumulative > loan.totalPrincipalSettledCents) return installment;
  }
  return null;
};

export interface PaymentSuggestion {
  installmentNumber: number;
  principalCents: number;
  interestCents: number;
}

/**
 * Sugestão do pagamento: o principal que falta da próxima parcela (limitado
 * ao saldo) e os juros previstos dela. Só preenche o formulário — usuário e
 * backend trabalham com principal e juros separados.
 */
export const suggestedPayment = (loan: Loan): PaymentSuggestion | null => {
  if (!isOpenLoan(loan)) return null;
  let cumulative = 0;
  for (const installment of loan.schedule) {
    cumulative += installment.principalCents;
    if (cumulative > loan.totalPrincipalSettledCents) {
      return {
        installmentNumber: installment.number,
        principalCents: Math.min(cumulative - loan.totalPrincipalSettledCents, loan.balanceCents),
        interestCents: installment.interestCents,
      };
    }
  }
  return null;
};

const SETTLEMENT_LABELS: Record<LoanType, string> = {
  borrow: 'Pagamento',
  lend: 'Recebimento',
};

/** Nome do movimento no histórico. */
export const movementLabel = (movement: LoanMovement, loanType: LoanType): string => {
  if (movement.kind === 'disbursement') {
    return loanType === 'borrow' ? 'Contratação (principal recebido)' : 'Contratação (principal entregue)';
  }
  if (movement.kind === 'payment') return SETTLEMENT_LABELS[loanType];
  return movement.originalKind === 'disbursement'
    ? 'Cancelamento do contrato'
    : `Estorno de ${SETTLEMENT_LABELS[loanType].toLowerCase()}`;
};

/** Situação do movimento no histórico. */
export const movementStateLabel = (movement: LoanMovement): string => {
  if (movement.kind === 'reversal') return 'Compensação';
  if (movement.reversedBy) {
    return movement.kind === 'disbursement' ? 'Compensado pelo cancelamento' : 'Estornado';
  }
  return 'Ativo';
};

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface LoanPermissions {
  canCreate: boolean;
  /** Administra este contrato (owner/admin, ou member que o criou). */
  canManage: boolean;
  canPay: boolean;
  canCancel: boolean;
  canEditMetadata: boolean;
  canReverse: (movement: LoanMovement) => boolean;
}

/**
 * O que a interface oferece a cada papel (mesma política do backend):
 * owner/admin tudo; member cria e administra só o que registrou; viewer só
 * lê. Sem papel conhecido, nada.
 */
export const loanPermissions = (
  actor: { role?: WorkspaceRole | null; uid?: string | null },
  loan?: Loan | null,
): LoanPermissions => {
  const role = actor.role ?? null;
  const canCreate = role === 'owner' || role === 'admin' || role === 'member';
  const canManage = Boolean(loan) && (
    role === 'owner' || role === 'admin' ||
    (role === 'member' && Boolean(actor.uid) && loan!.createdBy === actor.uid)
  );
  const open = Boolean(loan) && isOpenLoan(loan!);
  const notCancelled = Boolean(loan) && loan!.status !== 'cancelled';
  return {
    canCreate,
    canManage,
    canPay: canManage && open,
    canCancel: canManage && notCancelled,
    canEditMetadata: canManage,
    canReverse: (movement) => canManage && notCancelled &&
      movement.kind === 'payment' && movement.reversedBy === null,
  };
};

export type LoanErrorKind =
  | 'validation'
  | 'conflict'
  | 'forbidden'
  | 'precondition'
  | 'quota'
  | 'session'
  | 'uncertain';

export interface LoanErrorView {
  kind: LoanErrorKind;
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
export const loanErrorView = (error: unknown): LoanErrorView => {
  if (error instanceof LoanInputError) {
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
        message: message || 'Este empréstimo foi alterado por outra operação. Atualize e tente novamente.',
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
        message: 'Este empréstimo não foi encontrado. Atualize a lista e tente novamente.',
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
