import { versionOf } from '../clients/adapters.ts';
import { clientsErrorView, type ClientsErrorView } from '../clients/presentation.ts';
import type {
  SettingsCatalogCreateInput,
  SettingsCatalogItem,
  SettingsCatalogStatus,
  SettingsCatalogTransactionSubtype,
} from './types.ts';
import type { TransactionFormType } from '../../types.ts';

/**
 * Contrato cliente das callables do catálogo de configurações (D-23, P4-E).
 *
 * Módulo puro: não importa o SDK. `api.ts` o liga ao `httpsCallable`; os
 * testes, a um `invoke` falso. As callables são o único caminho de escrita —
 * as Rules negam toda escrita do cliente em `settings_catalog` e todo acesso
 * a `settings_catalog_uniques`. O payload leva só a intenção: grupo, nome,
 * subtipo da categoria, aparência e status. Escopo PF/PJ, nome normalizado,
 * chave de unicidade, autoria e datas são do backend.
 */
export const SETTINGS_CATALOG_CALLABLES = [
  'createSettingsCatalogItem',
  'updateSettingsCatalogItem',
  'archiveSettingsCatalogItem',
] as const;

export type SettingsCatalogCallableName = (typeof SETTINGS_CATALOG_CALLABLES)[number];

export type SettingsCatalogInvoke = <TResult>(
  name: SettingsCatalogCallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

export interface SettingsCatalogMutationResult {
  itemId: string;
  status: SettingsCatalogStatus;
  changed?: boolean;
  replayed: boolean;
}

const bind = (invoke: SettingsCatalogInvoke, name: SettingsCatalogCallableName) =>
  (payload: Record<string, unknown>, idempotencyKey: string) =>
    invoke<SettingsCatalogMutationResult>(name, { ...payload, idempotencyKey });

export const createSettingsCatalogCallables = (invoke: SettingsCatalogInvoke) => ({
  createSettingsCatalogItem: bind(invoke, 'createSettingsCatalogItem'),
  updateSettingsCatalogItem: bind(invoke, 'updateSettingsCatalogItem'),
  archiveSettingsCatalogItem: bind(invoke, 'archiveSettingsCatalogItem'),
} satisfies Record<SettingsCatalogCallableName, (...args: never[]) => Promise<unknown>>);

export type SettingsCatalogCallables = ReturnType<typeof createSettingsCatalogCallables>;

/** Só owner e admin administram o catálogo; member e viewer consultam. */
export const settingsCatalogPermissions = (role?: string | null) => ({
  canManage: role === 'owner' || role === 'admin',
});

/**
 * Subtipo de categoria que serve a um tipo de lançamento.
 *
 * A compra parcelada é despesa no cartão (`createCreditCardPurchase`): a aba
 * "Parcelado" usa as categorias de despesa. O catálogo não tem subtipo
 * `parcelado`.
 */
export const categorySubtypeForTransactionType = (
  type?: TransactionFormType | null,
): SettingsCatalogTransactionSubtype | null => {
  if (!type) return null;
  return type === 'parcelado' ? 'despesa' : type;
};

/** Erro de preenchimento detectado antes de chamar o backend. */
export class SettingsCatalogInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsCatalogInputError';
  }
}

const trimmedName = (name: string): string => {
  const value = name.trim();
  if (!value) throw new SettingsCatalogInputError('Informe o nome do cadastro.');
  return value;
};

/** Valores do formulário de Cadastros. */
export interface SettingsCatalogFormValues {
  name: string;
  icon?: string | null;
  color?: string | null;
  stroke?: number | null;
  status?: SettingsCatalogStatus;
}

/** Criação: grupo, nome, subtipo (só categoria), aparência e status. */
export const buildCreateCatalogPayload = (
  workspaceId: string,
  input: SettingsCatalogCreateInput,
): Record<string, unknown> => {
  const icon = input.icon || undefined;
  return {
    workspaceId,
    group: input.group,
    name: trimmedName(input.name),
    ...(input.group === 'category' && input.transactionSubtype
      ? { transactionSubtype: input.transactionSubtype }
      : {}),
    ...(icon ? { icon } : {}),
    ...(icon && input.color ? { color: input.color } : {}),
    ...(icon && typeof input.stroke === 'number' ? { stroke: input.stroke } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
};

const versionOrThrow = (item: SettingsCatalogItem): string => {
  const version = versionOf(item.updatedAt);
  if (!version) {
    throw new SettingsCatalogInputError(
      'Este cadastro ainda está sendo salvo. Atualize a lista e tente novamente.',
    );
  }
  return version;
};

/**
 * Edição: só o que mudou em relação ao item lido, com a versão lida.
 * Remover o ícone envia `null` (cor e espessura saem junto). Devolve `null`
 * quando nada mudou — não há o que enviar.
 */
export const buildUpdateCatalogPayload = (
  workspaceId: string,
  item: SettingsCatalogItem,
  values: SettingsCatalogFormValues,
): Record<string, unknown> | null => {
  const name = trimmedName(values.name);
  const icon = values.icon || undefined;
  const color = icon ? values.color || undefined : undefined;
  const stroke = icon && typeof values.stroke === 'number' ? values.stroke : undefined;
  const status = values.status ?? item.status;
  const changes: Record<string, unknown> = {};
  if (name !== item.name) changes.name = name;
  if (icon !== item.icon) changes.icon = icon ?? null;
  if (icon && color !== item.color) changes.color = color ?? null;
  if (icon && stroke !== item.stroke) changes.stroke = stroke ?? null;
  if (status !== item.status) changes.status = status;
  if (Object.keys(changes).length === 0) return null;
  return {
    workspaceId,
    itemId: item.id,
    expectedUpdatedAt: versionOrThrow(item),
    changes,
  };
};

export const buildArchiveCatalogPayload = (
  workspaceId: string,
  item: SettingsCatalogItem,
): Record<string, unknown> => ({
  workspaceId,
  itemId: item.id,
  expectedUpdatedAt: versionOrThrow(item),
});

const callableCodeOf = (error: unknown): string => {
  const value = error as { code?: unknown } | null;
  return typeof value?.code === 'string' ? value.code.replace(/^functions\//, '') : '';
};

/** O nome já está reservado por outro item do mesmo recorte. */
export const isSettingsCatalogDuplicateError = (error: unknown): boolean =>
  callableCodeOf(error) === 'already-exists';

/**
 * Erro da callable → mensagem pt-BR. As mensagens do backend já são pt-BR;
 * nome repetido (`already-exists`) é conflito com o estado do servidor.
 */
export const settingsCatalogErrorView = (error: unknown): ClientsErrorView => {
  if (error instanceof SettingsCatalogInputError) {
    return { kind: 'validation', message: error.message, refresh: false };
  }
  if (isSettingsCatalogDuplicateError(error)) {
    const value = error as { message?: unknown } | null;
    const message = typeof value?.message === 'string' ? value.message.trim() : '';
    return {
      kind: 'conflict',
      message: message || 'Já existe um cadastro com esse nome neste grupo.',
      refresh: true,
    };
  }
  return clientsErrorView(error);
};
