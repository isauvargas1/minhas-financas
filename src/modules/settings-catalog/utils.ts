import type {
  SettingsCatalogItem,
  SettingsCatalogListFilters
} from './types';

/*
 * Leitura do catálogo no cliente: busca, ordenação e recorte. Nome
 * normalizado, chave de unicidade e escopo são derivados só pelo backend
 * (D-23, `functions/src/settingsCatalog/model.ts`); a normalização daqui serve
 * apenas à busca e à comparação de rótulos na tela.
 */

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