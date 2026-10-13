/**
 * Adaptador do formulário de lançamento para as callables autoritativas de
 * caixa (P3-E, P3-F): `createCashTransaction`, `updateCashTransaction`,
 * `confirmCashTransaction` e `voidCashTransaction`.
 *
 * Módulo puro (sem SDK): os testes unitários o exercitam diretamente. Regras
 * que ele garante antes de qualquer chamada:
 *
 * - **centavos exatos**: o valor digitado vira centavos inteiros por leitura
 *   de texto, sem ponto flutuante; mais de duas casas é recusado, não
 *   arredondado;
 * - **só o fluxo elegível vai para a callable**: receita ou despesa manual,
 *   confirmada (data efetiva até hoje em São Paulo) ou pendente (vencimento,
 *   inclusive futuro — agendado, D-29), sem vínculo com outro domínio.
 *   Parcela de cartão, investimento, empréstimo, recorrência e divisão de
 *   contas continuam nos seus caminhos;
 * - **registro, vencimento e confirmação distintos**: pendente leva o
 *   vencimento (`dueDate`); confirmar é operação própria, com a data efetiva
 *   e o valor liquidado, e o vencimento fica preservado no backend;
 * - **contrato estrito**: campo opcional vazio não é enviado; fornecedor e
 *   centro de custo só em espaço PJ;
 * - **conta/carteira** (D-30, P3-J): todo lançamento manual leva a conta
 *   escolhida; sem ela nada é enviado;
 * - **versão completa**: `expectedUpdatedAt` sai do Timestamp do Firestore
 *   com os nanossegundos, sem passar por `Date` (que guarda só
 *   milissegundos).
 */

/** Erro de preenchimento detectado antes de chamar o backend. */
export class CashEntryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashEntryInputError';
  }
}

export type CashEntryType = 'receita' | 'despesa';

/** Dados do formulário comum, como o modal os mantém. */
export interface ManualEntryForm {
  type: CashEntryType;
  description: string;
  /** ID da categoria do catálogo (D-23); o nome é resolvido no backend. */
  categoryId: string;
  /** Texto do campo de valor (`input type="number"`, ponto decimal). */
  amount: string;
  /** `YYYY-MM-DD`. */
  date: string;
  incomeType?: string;
  expenseType?: string;
  paymentMethod?: string;
  supplier?: string;
  costCenter?: string;
  /** Paga/recebida (`true`) ou pendente (`false`, D-29). */
  isPaid?: boolean;
  /** Conta/carteira do lançamento (D-30). */
  cashAccountId?: string;
}

/** Mesmo teto do backend e das Rules: R$ 1.000.000.000,00. */
export const CASH_ENTRY_MAX_CENTS = 100_000_000_000;

export const REASON_MAX_LENGTH = 300;

/**
 * Lê o valor do campo numérico em centavos inteiros. Aceita `123`, `123.4`
 * e `123.45` (o `input type="number"` usa ponto); recusa vazio, sinal,
 * expoente, mais de duas casas, zero e acima do teto.
 */
export const parseDecimalAmountToCents = (input: string): number | null => {
  if (typeof input !== 'string') return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const [, integerPart, decimalPart = ''] = match;
  if (integerPart.length > 12) return null;
  const cents =
    Number(integerPart) * 100 + Number(decimalPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > CASH_ENTRY_MAX_CENTS) {
    return null;
  }
  return cents;
};

/** Hoje (`YYYY-MM-DD`) em `America/Sao_Paulo`, como o backend valida. */
export const saoPauloToday = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

/**
 * Mesmo dia civil de São Paulo `months` meses antes (`YYYY-MM-DD`), com o dia
 * limitado ao fim do mês. Aritmética sobre os campos civis: sem `toISOString`,
 * que deslocaria a data entre 21h e 24h de Brasília.
 */
export const saoPauloMonthsAgo = (months: number, now: Date = new Date()): string => {
  const [year, month, day] = saoPauloToday(now).split('-').map(Number);
  const index = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12 + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return [targetYear, targetMonth, Math.min(day, lastDay)]
    .map((value, position) => String(value).padStart(position === 0 ? 4 : 2, '0'))
    .join('-');
};

const isDayKey = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
};

export const FUTURE_SETTLED_MESSAGE =
  'Lançamento pago ou recebido não pode ter data futura. Para agendar, marque como não pago.';

/**
 * Estado do lançamento manual a partir do formulário (D-29): pago/recebido
 * é confirmado, com a data efetiva até hoje; não pago é pendente, com o
 * vencimento (passado, hoje ou futuro). Pago com data futura é erro de
 * preenchimento — nunca vira agendado sozinho.
 */
export const manualEntryStatus = (
  form: Pick<ManualEntryForm, 'date' | 'isPaid'>,
  today: string = saoPauloToday(),
): 'confirmed' | 'pending' => {
  if (!isDayKey(form.date)) {
    throw new CashEntryInputError('Informe uma data válida.');
  }
  if (form.isPaid === false) return 'pending';
  if (form.date > today) throw new CashEntryInputError(FUTURE_SETTLED_MESSAGE);
  return 'confirmed';
};

/** Vínculos com outros domínios: o mesmo conjunto do backend (P3-C). */
export const PROTECTED_LINK_KEYS = [
  'cardId',
  // Espelho de pagamento de fatura de cartão (P4-A): estornado só pela tela
  // de cartões.
  'creditCardPaymentEntry',
  'loanId',
  'loanMovementId',
  // Espelho de empréstimo do backend (P3-G/P3-H): alterado só pelas callables
  // de empréstimo.
  'loanEntry',
  // Espelho de recebimento de recebível (P3-I): alterado só pelas callables
  // de recebíveis.
  'receivableEntry',
  // Espelho de caixa de investimento (P4-D): desfeito só pelas callables de
  // investimentos.
  'investmentEntry',
  'receivableId',
  'clientId',
  // Espelho da Divisão de contas (P4-C): título pago pelo Caixa e pagamento
  // de reembolso, desfeitos só pelas callables da Divisão de contas.
  'splitEntry',
] as const;

const isFilled = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '';

export interface StoredEntry {
  type?: unknown;
  isPaid?: unknown;
  source?: unknown;
  userId?: unknown;
  voidedAt?: unknown;
  cashEntry?: unknown;
  [key: string]: unknown;
}

/** Documento com a marca do backend: só as callables o alteram (Rules). */
export const isAuthoritativeCashEntry = (stored: object): boolean => {
  const entry = stored as StoredEntry;
  return typeof entry.cashEntry === 'object' && entry.cashEntry !== null;
};

/** Lançamento ainda não liquidado (D-29): pendente, agendado ou vencido. */
export const isPendingCashEntry = (stored: object): boolean =>
  (stored as StoredEntry).isPaid === false;

/**
 * O lançamento existente pode ser corrigido, confirmado ou anulado pelas
 * callables? Mesma triagem estrutural do backend, sem substituí-lo: o
 * backend decide de novo. Só o lançamento do Caixa (`cashEntry` com origem
 * `manual` ou `recurring`), pendente ou confirmado; ficam fora espelhos e
 * vínculos de outros domínios, anulados e todo documento sem a marca — desde
 * a P4-D nenhum escritor grava receita ou despesa sem ela.
 */
export const isManualCashEntryCandidate = (stored: object): boolean => {
  const entry = stored as StoredEntry;
  if (entry.type !== 'receita' && entry.type !== 'despesa') return false;
  if (isFilled(entry.voidedAt)) return false;
  if (PROTECTED_LINK_KEYS.some((key) => isFilled(entry[key]))) return false;
  if (!isAuthoritativeCashEntry(entry)) return false;
  const marker = entry.cashEntry as Record<string, unknown>;
  // P4-B: o lançamento gerado por Recorrentes (`recurring`) é do Caixa como
  // outro qualquer — o pendente é pago pela confirmação.
  return (marker.status === 'confirmed' || marker.status === 'pending') &&
    (marker.origin === 'manual' || marker.origin === 'recurring');
};

/** Versão lida (`updatedAt`) em ISO com nanossegundos, ou `null`. */
export const expectedUpdatedAtOf = (updatedAt: unknown): string | null => {
  if (updatedAt === undefined || updatedAt === null) return null;
  const value = updatedAt as { seconds?: unknown; nanoseconds?: unknown };
  if (
    typeof value.seconds !== 'number' ||
    typeof value.nanoseconds !== 'number' ||
    !Number.isSafeInteger(value.seconds) ||
    !Number.isInteger(value.nanoseconds) ||
    value.nanoseconds < 0 ||
    value.nanoseconds > 999_999_999
  ) {
    throw new CashEntryInputError(
      'Não foi possível ler a versão deste lançamento. Atualize a página e tente de novo.',
    );
  }
  const base = new Date(value.seconds * 1000).toISOString().slice(0, 19);
  return `${base}.${String(value.nanoseconds).padStart(9, '0')}Z`;
};

const text = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Estado do lançamento no formato do contrato (`cashEntryStateSchema`):
 * confirmado leva `date` (efetiva); pendente leva `dueDate` (vencimento).
 */
export const toCashEntryState = (
  form: ManualEntryForm,
  isPJ: boolean,
  today: string = saoPauloToday(),
): Record<string, unknown> => {
  const status = manualEntryStatus(form, today);
  const amountCents = parseDecimalAmountToCents(form.amount);
  if (amountCents === null) {
    throw new CashEntryInputError(
      'Informe um valor maior que zero, com no máximo duas casas decimais.',
    );
  }
  if (!isPJ && (text(form.supplier) || text(form.costCenter))) {
    throw new CashEntryInputError(
      'Fornecedor e centro de custo só podem ser informados em espaço PJ.',
    );
  }
  const categoryId = text(form.categoryId);
  if (!categoryId) {
    throw new CashEntryInputError('Escolha a categoria do lançamento.');
  }
  const cashAccountId = text(form.cashAccountId);
  if (!cashAccountId) {
    throw new CashEntryInputError('Escolha a conta ou carteira do lançamento.');
  }
  const typeFields: Record<string, string | undefined> = form.type === 'receita'
    ? { incomeType: text(form.incomeType) }
    : {
      expenseType: text(form.expenseType),
      paymentMethod: text(form.paymentMethod),
    };
  const optional: Record<string, string | undefined> = {
    ...typeFields,
    supplier: isPJ ? text(form.supplier) : undefined,
    costCenter: isPJ ? text(form.costCenter) : undefined,
  };
  return {
    type: form.type,
    description: form.description.trim(),
    categoryId,
    amountCents,
    cashAccountId,
    status,
    ...(status === 'pending' ? { dueDate: form.date } : { date: form.date }),
    ...Object.fromEntries(
      Object.entries(optional).filter(([, value]) => value !== undefined),
    ),
  };
};

/** Payload de `createCashTransaction`, sem a chave. */
export const toCreateCashPayload = (
  form: ManualEntryForm,
  context: { workspaceId: string; isPJ: boolean },
): Record<string, unknown> => ({
  workspaceId: context.workspaceId,
  ...toCashEntryState(form, context.isPJ),
});

const reasonOf = (reason: string): string => {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new CashEntryInputError('Informe o motivo da alteração.');
  }
  if (trimmed.length > REASON_MAX_LENGTH) {
    throw new CashEntryInputError(
      `O motivo pode ter até ${REASON_MAX_LENGTH} caracteres.`,
    );
  }
  return trimmed;
};

/** Payload de `updateCashTransaction`, sem a chave. */
export const toUpdateCashPayload = (
  form: ManualEntryForm,
  context: {
    workspaceId: string;
    isPJ: boolean;
    transactionId: string;
    updatedAt: unknown;
    reason: string;
  },
): Record<string, unknown> => ({
  workspaceId: context.workspaceId,
  transactionId: context.transactionId,
  expectedUpdatedAt: expectedUpdatedAtOf(context.updatedAt),
  reason: reasonOf(context.reason),
  entry: toCashEntryState(form, context.isPJ),
});

export const CONFIRM_ONLY_SETTLEMENT_MESSAGE =
  'Para confirmar, altere só valor, data e forma de pagamento. Salve antes as outras correções, com o lançamento ainda pendente.';

/** Campos que a confirmação não altera (D-29): só a liquidação muda. */
const DESCRIPTIVE_KEYS = [
  'type', 'description', 'categoryId', 'incomeType', 'expenseType',
  'supplier', 'costCenter',
] as const;

/**
 * Payload de `confirmCashTransaction`, sem a chave: data efetiva (até hoje),
 * valor liquidado e, em despesa, a forma de pagamento usada. Se o formulário
 * também mudou campos descritivos, a confirmação é recusada aqui: correção e
 * confirmação são operações distintas, e nada é descartado em silêncio.
 */
export const toConfirmCashPayload = (
  form: ManualEntryForm,
  context: {
    workspaceId: string;
    isPJ: boolean;
    transactionId: string;
    updatedAt: unknown;
    stored: Record<string, unknown>;
  },
  today: string = saoPauloToday(),
): Record<string, unknown> => {
  const state = toCashEntryState({ ...form, isPaid: true }, context.isPJ, today);
  const changed = DESCRIPTIVE_KEYS.some((key) => {
    const stored = typeof context.stored[key] === 'string'
      ? (context.stored[key] as string).trim() || undefined
      : undefined;
    return stored !== state[key];
  });
  if (changed) throw new CashEntryInputError(CONFIRM_ONLY_SETTLEMENT_MESSAGE);
  return {
    workspaceId: context.workspaceId,
    transactionId: context.transactionId,
    expectedUpdatedAt: expectedUpdatedAtOf(context.updatedAt),
    date: state.date,
    amountCents: state.amountCents,
    ...(form.type === 'despesa' && typeof state.paymentMethod === 'string'
      ? { paymentMethod: state.paymentMethod }
      : {}),
    // Conta usada na liquidação (D-30): a escolhida no formulário.
    cashAccountId: state.cashAccountId,
  };
};

/** Payload de `voidCashTransaction`, sem a chave. */
export const toVoidCashPayload = (context: {
  workspaceId: string;
  transactionId: string;
  updatedAt: unknown;
  reason: string;
}): Record<string, unknown> => ({
  workspaceId: context.workspaceId,
  transactionId: context.transactionId,
  expectedUpdatedAt: expectedUpdatedAtOf(context.updatedAt),
  reason: reasonOf(context.reason),
});

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export interface IntentKey {
  fingerprint: string;
  key: string;
}

/**
 * Chave de idempotência por intenção: o mesmo conteúdo reenviado (depois de
 * uma falha ou resposta incerta) reusa a chave; conteúdo diferente é outra
 * intenção e ganha chave nova. Nenhum reenvio automático acontece aqui.
 */
export const resolveIntentKey = (
  previous: IntentKey | null,
  operation: string,
  payload: Record<string, unknown>,
  generate: () => string,
): IntentKey => {
  const fingerprint = stable({ operation, payload });
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: generate() };
};

export type CashErrorKind =
  | 'validation'
  | 'conflict'
  | 'forbidden'
  | 'voided'
  | 'ineligible'
  | 'quota'
  | 'idempotency'
  | 'session'
  | 'uncertain';

export interface CashErrorView {
  kind: CashErrorKind;
  message: string;
}

const INELIGIBLE_MESSAGES: Record<string, string> = {
  linked_to_other_domain:
    'Este lançamento pertence a outro módulo (cartão, empréstimo, recorrência, divisão ou investimento) e é alterado por lá.',
  unsupported_type:
    'Este tipo de lançamento não pode ser alterado por aqui.',
  unsupported_origin:
    'Este lançamento foi gerado automaticamente e não pode ser alterado por aqui.',
  backend_owned:
    'Este lançamento foi gerado automaticamente e não pode ser alterado por aqui.',
  system_author:
    'Este lançamento foi gerado automaticamente e não pode ser alterado por aqui.',
  pending:
    'Lançamentos pendentes ainda não podem ser alterados por aqui.',
};

const LEGACY_AMBIGUOUS_MESSAGE =
  'Este lançamento antigo tem um formato que não pode ser corrigido com segurança. Nada foi alterado.';

/** Textos que o SDK de Functions gera sozinho, sem resposta do backend. */
const SDK_DEFAULT_MESSAGE = /^(internal|Response is (not valid JSON object|missing data field)\.)$/;

const UNCERTAIN_MESSAGE =
  'Não foi possível confirmar a operação. Verifique a conexão e tente salvar de novo: o reenvio do mesmo conteúdo não duplica o lançamento.';

/**
 * Traduz o erro da callable para a interface. As mensagens do backend já são
 * pt-BR; aqui só se escolhe a mais útil e o tipo de tratamento.
 */
export const cashErrorView = (error: unknown): CashErrorView => {
  if (error instanceof CashEntryInputError) {
    return { kind: 'validation', message: error.message };
  }
  const value = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  } | null;
  const code = typeof value?.code === 'string'
    ? value.code.replace(/^functions\//, '')
    : '';
  /*
   * Sem corpo de erro do servidor (rede, proxy, resposta inválida) o SDK põe
   * na mensagem o próprio código ou um texto fixo em inglês. Só a mensagem
   * que o backend escreveu (pt-BR) chega à interface; o resto vira o texto
   * padrão de cada caso.
   */
  const rawMessage = typeof value?.message === 'string' ? value.message.trim() : '';
  const message = rawMessage && rawMessage !== code && !SDK_DEFAULT_MESSAGE.test(rawMessage)
    ? rawMessage
    : '';
  const details = (value?.details ?? {}) as {
    issues?: Array<{ message?: unknown }>;
    ineligible?: unknown;
  };
  switch (code) {
    case 'invalid-argument': {
      const issue = details.issues?.find((item) => typeof item.message === 'string');
      return {
        kind: 'validation',
        message: typeof issue?.message === 'string'
          ? issue.message
          : message || 'Revise os dados informados e tente novamente.',
      };
    }
    case 'aborted':
      return {
        kind: 'conflict',
        message: message ||
          'Este lançamento foi alterado por outra operação. Atualize e tente novamente.',
      };
    case 'permission-denied':
      return {
        kind: 'forbidden',
        message: message || 'Você não tem permissão para esta operação neste espaço.',
      };
    case 'unauthenticated':
      return { kind: 'session', message: 'Sua sessão expirou. Entre novamente para continuar.' };
    case 'resource-exhausted':
      return {
        kind: 'quota',
        message: message || 'O limite desta operação foi atingido. Tente novamente mais tarde.',
      };
    case 'not-found':
      return {
        kind: 'conflict',
        message: 'Este lançamento não foi encontrado. Atualize a lista e tente novamente.',
      };
    case 'failed-precondition': {
      if (typeof details.ineligible === 'string') {
        return {
          kind: 'ineligible',
          message: INELIGIBLE_MESSAGES[details.ineligible] ?? LEGACY_AMBIGUOUS_MESSAGE,
        };
      }
      if (/anulado/i.test(message)) return { kind: 'voided', message };
      if (/idempotência|em processamento/i.test(message)) {
        return { kind: 'idempotency', message };
      }
      return {
        kind: 'validation',
        message: message ||
          'Não foi possível concluir a operação no estado atual. Atualize a lista e tente novamente.',
      };
    }
    default:
      // Rede, timeout, `unavailable`, `internal` sem mensagem útil: o
      // resultado é incerto e o reenvio do mesmo conteúdo é seguro.
      return {
        kind: 'uncertain',
        message: code === 'internal' && message ? message : UNCERTAIN_MESSAGE,
      };
  }
};

/**
 * O que recarregar depois de uma falha (P3-E). Só a falha que indica estado
 * do servidor diferente do exibido recarrega a lista (conflito, já anulado,
 * inelegível, idempotência, resultado incerto); a quota esgotada recarrega só
 * o indicador. Validação, papel e sessão não mudam o que foi lido, e
 * recarregar a janela de lançamentos a cada tentativa recusada seria custo
 * sem efeito.
 */
export type CashRefreshScope = 'state' | 'quota' | 'none';

export const cashRefreshScope = (error: unknown): CashRefreshScope => {
  const code = (error as { code?: unknown } | null)?.code;
  // Pré-condição do domínio (já confirmado, transição inválida, janela de
  // manutenção): o estado do servidor é outro que o exibido.
  if (code === 'functions/failed-precondition' || code === 'failed-precondition') {
    return 'state';
  }
  switch (cashErrorView(error).kind) {
    case 'conflict':
    case 'voided':
    case 'ineligible':
    case 'idempotency':
    case 'uncertain':
      return 'state';
    case 'quota':
      return 'quota';
    default:
      return 'none';
  }
};
