import { SETTINGS_CATALOG_GROUP_CONFIG } from './constants.ts';
import type {
  SettingsCatalogCreateInput,
  SettingsCatalogGroup,
  SettingsCatalogItem,
  SettingsCatalogListFilters,
  SettingsCatalogTransactionSubtype,
  SettingsCatalogWorkspaceScope,
  SettingsCatalogUpdateInput
} from './types';

const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const MULTIPLE_SPACES_REGEX = /\s+/g;

export const normalizeSettingsCatalogName = (value: string): string => {
  return value
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .trim()
    .replace(MULTIPLE_SPACES_REGEX, ' ')
    .toLowerCase();
};

export const sanitizeOptionalString = (
  value?: string | null
): string | undefined => {
  if (value == null) return undefined;
  const sanitized = value.trim();
  return sanitized.length > 0 ? sanitized : undefined;
};

export const resolveSettingsCatalogWorkspaceScope = (
  group: SettingsCatalogGroup,
  workspaceScope?: SettingsCatalogWorkspaceScope
): SettingsCatalogWorkspaceScope => {
  if (group === 'cost_center') return 'PJ';
  return workspaceScope ?? SETTINGS_CATALOG_GROUP_CONFIG[group].workspaceScope;
};

export const resolveSettingsCatalogTransactionSubtype = (
  group: SettingsCatalogGroup,
  transactionSubtype?: SettingsCatalogTransactionSubtype
): SettingsCatalogTransactionSubtype | undefined => {
  const config = SETTINGS_CATALOG_GROUP_CONFIG[group];

  if (!config.requiresTransactionSubtype) {
    return undefined;
  }

  if (!transactionSubtype) {
    throw new Error('Esse grupo exige subtipo de transação.');
  }

  if (!config.allowedTransactionSubtypes.includes(transactionSubtype)) {
    throw new Error('Subtipo de transação inválido para esse grupo.');
  }

  return transactionSubtype;
};

export const buildSettingsCatalogDedupeKey = (params: {
  group: SettingsCatalogGroup;
  normalizedName: string;
  workspaceScope: SettingsCatalogWorkspaceScope;
  transactionSubtype?: SettingsCatalogTransactionSubtype;
}) => {
  return [
    params.group,
    params.transactionSubtype ?? 'all',
    params.workspaceScope,
    params.normalizedName
  ].join('::');
};

export const buildSettingsCatalogCreateData = (
  input: SettingsCatalogCreateInput,
  workspaceId: string,
  userId: string
): Omit<SettingsCatalogItem, 'id' | 'createdAt' | 'updatedAt'> => {
  const name = input.name.trim();

  if (!name) {
    throw new Error('Nome do cadastro é obrigatório.');
  }

  const workspaceScope = resolveSettingsCatalogWorkspaceScope(
    input.group,
    input.workspaceScope
  );

  const transactionSubtype = resolveSettingsCatalogTransactionSubtype(
    input.group,
    input.transactionSubtype
  );

  const normalizedName = normalizeSettingsCatalogName(name);

  return {
    workspaceId,
    group: input.group,
    name,
    normalizedName,
    dedupeKey: buildSettingsCatalogDedupeKey({
      group: input.group,
      normalizedName,
      workspaceScope,
      transactionSubtype
    }),
    workspaceScope,
    transactionSubtype,
    icon: sanitizeOptionalString(input.icon),
    color: sanitizeOptionalString(input.color),
    stroke:
      typeof input.stroke === 'number' ? input.stroke : undefined,
    sortOrder:
      typeof input.sortOrder === 'number' ? input.sortOrder : Date.now(),
    status: input.status ?? 'active',
    createdBy: userId,
    updatedBy: userId
  };
};

export const buildSettingsCatalogUpdateData = (
  current: SettingsCatalogItem,
  input: SettingsCatalogUpdateInput,
  userId: string
): Omit<SettingsCatalogItem, 'id' | 'createdAt' | 'updatedAt'> => {
  const nextName =
    input.name !== undefined ? input.name.trim() : current.name;

  if (!nextName) {
    throw new Error('Nome do cadastro é obrigatório.');
  }

  const normalizedName = normalizeSettingsCatalogName(nextName);

  const nextIcon =
    input.icon !== undefined
      ? sanitizeOptionalString(input.icon)
      : current.icon;

  const nextColor =
    input.color !== undefined
      ? sanitizeOptionalString(input.color)
      : current.color;

  const nextStroke =
    input.stroke !== undefined
      ? input.stroke ?? undefined
      : current.stroke;

  return {
    workspaceId: current.workspaceId,
    group: current.group,
    name: nextName,
    normalizedName,
    dedupeKey: buildSettingsCatalogDedupeKey({
      group: current.group,
      normalizedName,
      workspaceScope: current.workspaceScope,
      transactionSubtype: current.transactionSubtype
    }),
    workspaceScope: current.workspaceScope,
    transactionSubtype: current.transactionSubtype,
    icon: nextIcon,
    color: nextIcon ? nextColor : undefined,
    stroke: nextIcon ? nextStroke : undefined,
    sortOrder:
      typeof input.sortOrder === 'number'
        ? input.sortOrder
        : current.sortOrder,
    status: input.status ?? current.status,
    createdBy: current.createdBy,
    updatedBy: userId
  };
};

export const sortSettingsCatalogItems = (
  items: SettingsCatalogItem[]
): SettingsCatalogItem[] => {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }

    return a.name.localeCompare(b.name, 'pt-BR', {
      sensitivity: 'base'
    });
  });
};

export const filterSettingsCatalogItems = (
  items: SettingsCatalogItem[],
  filters: SettingsCatalogListFilters = {}
): SettingsCatalogItem[] => {
  const filtered = items.filter((item) => {
    if (filters.group && item.group !== filters.group) return false;

    if (
      filters.transactionSubtype &&
      item.transactionSubtype !== filters.transactionSubtype
    ) {
      return false;
    }

    if (
      filters.workspaceScope &&
      item.workspaceScope !== filters.workspaceScope
    ) {
      return false;
    }

    if (!filters.includeInactive && item.status !== 'active') {
      return false;
    }

    return true;
  });

  return sortSettingsCatalogItems(filtered);
};