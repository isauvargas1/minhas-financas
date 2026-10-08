import { formatCents, isDayKey, parseBrlToCents } from '../loans/money.ts';
import type { Client, ClientPrivate, Receivable, ReceivableMovement } from './types.ts';

/**
 * Formulários de clientes e recebíveis → payloads das callables (P3-I).
 *
 * Módulo puro. O frontend nunca envia saldo, status, acumulados, autoria nem
 * IDs gerados: só o que foi digitado (valores em centavos inteiros, lidos do
 * texto sem ponto flutuante) e, nas mutações, a versão lida
 * (`expectedUpdatedAt`). As checagens daqui só antecipam o erro em pt-BR; a
 * decisão é do backend (papel, saldo, versão, status, concorrência).
 */

/** Erro de preenchimento detectado antes de chamar o backend. */
export class ClientInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientInputError';
  }
}

/** Os mesmos limites dos contratos do backend. */
export const CLIENT_TEXT_LIMITS = {
  name: 120,
  email: 254,
  phone: 30,
  address: 300,
  notes: 1000,
  document: 18,
} as const;

export const RECEIVABLE_TEXT_LIMITS = {
  description: 200,
  category: 60,
  reason: 300,
} as const;

export const AMOUNT_HINT = 'use vírgula para os centavos, como 1.234,56';

const text = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const limited = (value: string | undefined, label: string, max: number): string | undefined => {
  const trimmed = text(value);
  if (trimmed && trimmed.length > max) {
    throw new ClientInputError(`${label}: até ${max} caracteres.`);
  }
  return trimmed;
};

const required = (value: string | undefined, label: string, max: number): string => {
  const trimmed = limited(value, label, max);
  if (!trimmed) throw new ClientInputError(`${label}: valor obrigatório.`);
  return trimmed;
};

const reasonOf = (reason: string): string =>
  required(reason, 'Motivo', RECEIVABLE_TEXT_LIMITS.reason);

// ----------------------------------------------------------------- clientes

/** Campos do formulário de cliente (texto como digitado). */
export interface ClientForm {
  name: string;
  email: string;
  phone: string;
  document: string;
  notes: string;
}

export type ClientPrivateFormField = Exclude<keyof ClientForm, 'name'>;
export const CLIENT_PRIVATE_FORM_FIELDS: ClientPrivateFormField[] = [
  'email', 'phone', 'document', 'notes',
];

const PRIVATE_LABELS: Record<ClientPrivateFormField, [string, number]> = {
  email: ['E-mail', CLIENT_TEXT_LIMITS.email],
  phone: ['Telefone', CLIENT_TEXT_LIMITS.phone],
  document: ['CPF/CNPJ', CLIENT_TEXT_LIMITS.document],
  notes: ['Observações', CLIENT_TEXT_LIMITS.notes],
};

const privateValue = (form: ClientForm, field: ClientPrivateFormField) =>
  limited(form[field], PRIVATE_LABELS[field][0], PRIVATE_LABELS[field][1]);

/** Payload de `createClient`, sem a chave. Campo vazio não é enviado. */
export const toCreateClientPayload = (
  workspaceId: string,
  form: ClientForm,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    workspaceId,
    name: required(form.name, 'Nome', CLIENT_TEXT_LIMITS.name),
  };
  for (const field of CLIENT_PRIVATE_FORM_FIELDS) {
    const value = privateValue(form, field);
    if (value !== undefined) payload[field] = value;
  }
  return payload;
};

/** Formulário preenchido a partir do que está gravado. */
export const clientFormOf = (client: Client | null, personal: ClientPrivate | null): ClientForm => ({
  name: client?.name ?? '',
  email: personal?.email ?? '',
  phone: personal?.phone ?? '',
  document: personal?.document ?? '',
  notes: personal?.notes ?? '',
});

/**
 * Payload de `updateClient`, sem a chave: só o que mudou em relação ao que foi
 * lido; campo esvaziado vai como `null` (remove). Nada mudou → erro.
 */
export const toUpdateClientPayload = (context: {
  workspaceId: string;
  client: Client;
  personal: ClientPrivate | null;
  form: ClientForm;
}): Record<string, unknown> => {
  const initial = clientFormOf(context.client, context.personal);
  const changes: Record<string, unknown> = {};
  const name = required(context.form.name, 'Nome', CLIENT_TEXT_LIMITS.name);
  if (name !== context.client.name) changes.name = name;
  for (const field of CLIENT_PRIVATE_FORM_FIELDS) {
    const next = privateValue(context.form, field);
    const current = text(initial[field]);
    if (next === current) continue;
    changes[field] = next ?? null;
  }
  if (Object.keys(changes).length === 0) {
    throw new ClientInputError('Nenhuma alteração para salvar.');
  }
  return {
    workspaceId: context.workspaceId,
    clientId: context.client.id,
    expectedUpdatedAt: context.client.version,
    changes,
  };
};

/** Payload de `archiveClient`, sem a chave. */
export const toArchiveClientPayload = (workspaceId: string, client: Client): Record<string, unknown> => ({
  workspaceId,
  clientId: client.id,
  expectedUpdatedAt: client.version,
});

// --------------------------------------------------------------- recebíveis

export interface ReceivableForm {
  description: string;
  clientId: string;
  amount: string;
  dueDate: string;
}

const amountOf = (input: string, label: string, options: { allowZero?: boolean } = {}): number => {
  const cents = parseBrlToCents(input.trim() === '' && options.allowZero ? '0' : input, options);
  if (cents === null) throw new ClientInputError(`${label} inválido: ${AMOUNT_HINT}.`);
  return cents;
};

const dueDateOf = (value: string): string => {
  if (!isDayKey(value)) throw new ClientInputError('Vencimento: informe uma data válida.');
  return value;
};

/** Payload de `createReceivable`, sem a chave. */
export const toCreateReceivablePayload = (
  workspaceId: string,
  form: ReceivableForm,
): Record<string, unknown> => {
  const description = required(form.description, 'Descrição', RECEIVABLE_TEXT_LIMITS.description);
  if (!form.clientId) throw new ClientInputError('Selecione o cliente.');
  return {
    workspaceId,
    clientId: form.clientId,
    description,
    amountCents: amountOf(form.amount, 'Valor'),
    dueDate: dueDateOf(form.dueDate),
  };
};

/**
 * Payload de `updateReceivable`, sem a chave: descrição, vencimento e — só
 * sem recebimento ativo e sem desconto — o valor original. Só o que mudou.
 */
export const toUpdateReceivablePayload = (context: {
  workspaceId: string;
  receivable: Receivable;
  form: ReceivableForm;
  amountLocked: boolean;
}): Record<string, unknown> => {
  const { receivable, form } = context;
  const changes: Record<string, unknown> = {};
  const description = required(form.description, 'Descrição', RECEIVABLE_TEXT_LIMITS.description);
  if (description !== receivable.description) changes.description = description;
  const dueDate = dueDateOf(form.dueDate);
  if (dueDate !== receivable.dueDate) changes.dueDate = dueDate;
  if (!context.amountLocked) {
    const amountCents = amountOf(form.amount, 'Valor');
    if (amountCents !== receivable.amountCents) changes.amountCents = amountCents;
  }
  if (Object.keys(changes).length === 0) {
    throw new ClientInputError('Nenhuma alteração para salvar.');
  }
  return {
    workspaceId: context.workspaceId,
    receivableId: receivable.id,
    expectedUpdatedAt: receivable.version,
    changes,
  };
};

export interface ReceiptForm {
  principal: string;
  interest: string;
  penalty: string;
  discount: string;
  paymentDate: string;
  /**
   * Conta/carteira que recebe o dinheiro (D-30, P3-J). Só vai ao backend
   * quando há dinheiro (principal + juros + multa); desconto não move conta.
   */
  cashAccountId: string;
}

export interface ReceiptAmounts {
  principalCents: number;
  interestCents: number;
  penaltyCents: number;
  discountCents: number;
}

/** Valores do formulário de recebimento; vazio vale zero. */
export const receiptAmountsOf = (form: ReceiptForm): ReceiptAmounts => ({
  principalCents: amountOf(form.principal, 'Principal', { allowZero: true }),
  interestCents: amountOf(form.interest, 'Juros', { allowZero: true }),
  penaltyCents: amountOf(form.penalty, 'Multa', { allowZero: true }),
  discountCents: amountOf(form.discount, 'Desconto', { allowZero: true }),
});

/** Dinheiro que entra no caixa: principal + juros + multa (sem desconto). */
export const receiptCashCents = (amounts: ReceiptAmounts): number =>
  amounts.principalCents + amounts.interestCents + amounts.penaltyCents;

/** Payload de `receiveReceivable`, sem a chave. */
export const toReceivePayload = (context: {
  workspaceId: string;
  receivable: Receivable;
  form: ReceiptForm;
  today: string;
}): Record<string, unknown> => {
  const amounts = receiptAmountsOf(context.form);
  const effect = receiptCashCents(amounts) + amounts.discountCents;
  if (effect === 0) {
    throw new ClientInputError('Informe principal, juros, multa ou desconto maior que zero.');
  }
  if (amounts.principalCents + amounts.discountCents > context.receivable.balanceCents) {
    throw new ClientInputError(
      `Principal mais desconto não pode passar do saldo de ${formatCents(context.receivable.balanceCents)}.`,
    );
  }
  if (!isDayKey(context.form.paymentDate)) {
    throw new ClientInputError('Data do recebimento: informe uma data válida.');
  }
  if (context.form.paymentDate > context.today) {
    throw new ClientInputError('Data do recebimento: não pode ser futura.');
  }
  const hasCash = receiptCashCents(amounts) > 0;
  const cashAccountId = context.form.cashAccountId.trim();
  if (hasCash && !cashAccountId) {
    throw new ClientInputError('Conta/carteira: escolha a conta que recebe o dinheiro.');
  }
  return {
    workspaceId: context.workspaceId,
    receivableId: context.receivable.id,
    expectedUpdatedAt: context.receivable.version,
    ...amounts,
    paymentDate: context.form.paymentDate,
    ...(hasCash ? { cashAccountId } : {}),
  };
};

/** Payload de `reverseReceivableReceipt`, sem a chave. */
export const toReverseReceiptPayload = (context: {
  workspaceId: string;
  receivable: Receivable;
  movement: ReceivableMovement;
  reason: string;
}): Record<string, unknown> => ({
  workspaceId: context.workspaceId,
  receivableId: context.receivable.id,
  movementId: context.movement.id,
  expectedUpdatedAt: context.receivable.version,
  reason: reasonOf(context.reason),
});

/** Payload de `cancelReceivable`, sem a chave. */
export const toCancelReceivablePayload = (context: {
  workspaceId: string;
  receivable: Receivable;
  reason: string;
}): Record<string, unknown> => ({
  workspaceId: context.workspaceId,
  receivableId: context.receivable.id,
  expectedUpdatedAt: context.receivable.version,
  reason: reasonOf(context.reason),
});
