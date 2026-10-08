import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';

import {db, functions} from '../../lib/firebase';
import {
  createSettingsCatalogCallables,
  type SettingsCatalogInvoke,
} from './callables';
import {SETTINGS_CATALOG_COLLECTION} from './constants';
import {sortSettingsCatalogItems} from './utils';
import type {
  SettingsCatalogItem,
  SettingsCatalogListFilters,
  SettingsCatalogPage,
  SettingsCatalogPageCursor,
} from './types';

const SETTINGS_CATALOG_PAGE_SIZE = 30;

const settingsCatalogCollection = (workspaceId: string) =>
  collection(db, 'workspaces', workspaceId, SETTINGS_CATALOG_COLLECTION);

/**
 * Teto de itens do catálogo lidos de uma vez.
 *
 * O catálogo é cadastro do workspace, não histórico: alguns milhares de itens
 * já é um cenário extremo. O teto existe para que a consulta seja limitada por
 * construção (INV-P2-034) e para que ultrapassá-lo seja **visível** em vez de
 * silencioso. Desde a D-23 o backend não deixa o workspace passar deste teto
 * (`SETTINGS_CATALOG_ITEM_LIMIT_PER_WORKSPACE`), então a leitura completa
 * cobre o catálogo inteiro; as Rules limitam a listagem a este teto + 1.
 */
export const SETTINGS_CATALOG_READ_LIMIT = 2000;

export interface SettingsCatalogSnapshot {
  items: SettingsCatalogItem[];
  /** O teto foi atingido: a lista não cobre o catálogo inteiro. */
  truncated: boolean;
}

/**
 * Catálogo completo do workspace, com teto explícito (INV-P2-034).
 *
 * A versão anterior fazia `getDocs(settingsCatalogCollection(workspaceId))` —
 * a coleção inteira, sem `limit` — e filtrava no cliente, embora o próprio
 * arquivo já tivesse um caminho paginado. Custo linear no cadastro, no caminho
 * que alimenta os seletores de categoria de toda transação.
 */
export const listSettingsCatalogSnapshot = async (
  workspaceId?: string
): Promise<SettingsCatalogSnapshot> => {
  if (!workspaceId || workspaceId === 'loading') {
    return {items: [], truncated: false};
  }

  const snapshot = await getDocs(query(
    settingsCatalogCollection(workspaceId),
    orderBy('sortOrder', 'asc'),
    orderBy('normalizedName', 'asc'),
    orderBy(documentId(), 'asc'),
    limit(SETTINGS_CATALOG_READ_LIMIT + 1),
  ));

  const truncated = snapshot.size > SETTINGS_CATALOG_READ_LIMIT;
  const items = snapshot.docs
    .slice(0, SETTINGS_CATALOG_READ_LIMIT)
    .map((itemDoc) => ({
      id: itemDoc.id,
      ...(itemDoc.data() as Omit<SettingsCatalogItem, 'id'>)
    } as SettingsCatalogItem));

  return {items: sortSettingsCatalogItems(items), truncated};
};

export const listSettingsCatalog = async (
  workspaceId?: string
): Promise<SettingsCatalogItem[]> =>
  (await listSettingsCatalogSnapshot(workspaceId)).items;

export const listSettingsCatalogPage = async (
  workspaceId: string | undefined,
  filters: SettingsCatalogListFilters,
  cursor: SettingsCatalogPageCursor | null,
): Promise<SettingsCatalogPage> => {
  if (!workspaceId || workspaceId === 'loading' || !filters.group) {
    return {items: [], nextCursor: null};
  }

  const constraints = [
    where('group', '==', filters.group),
    ...(filters.transactionSubtype
      ? [where('transactionSubtype', '==', filters.transactionSubtype)]
      : []),
    ...(!filters.includeInactive ? [where('status', '==', 'active')] : []),
    orderBy('sortOrder', 'asc'),
    orderBy('normalizedName', 'asc'),
    orderBy(documentId(), 'asc'),
    ...(cursor
      ? [startAfter(cursor.sortOrder, cursor.normalizedName, cursor.id)]
      : []),
    limit(SETTINGS_CATALOG_PAGE_SIZE + 1),
  ];
  const snapshot = await getDocs(query(settingsCatalogCollection(workspaceId), ...constraints));
  const pageDocs = snapshot.docs.slice(0, SETTINGS_CATALOG_PAGE_SIZE);
  const items = pageDocs.map((itemDoc) => ({
    id: itemDoc.id,
    ...(itemDoc.data() as Omit<SettingsCatalogItem, 'id'>),
  } as SettingsCatalogItem));
  const last = pageDocs.at(-1);

  return {
    items,
    nextCursor: snapshot.size > SETTINGS_CATALOG_PAGE_SIZE && last
      ? {
          sortOrder: Number(last.get('sortOrder') ?? 0),
          normalizedName: String(last.get('normalizedName') ?? ''),
          id: last.id,
        }
      : null,
  };
};

/**
 * Mutações do catálogo (D-23): só pelas callables — o cliente não grava
 * `settings_catalog` nem conhece as reservas de nome. Contrato em
 * `callables.ts`.
 */
const invoke: SettingsCatalogInvoke = async <TResult>(
  name: string,
  payload: Record<string, unknown>,
) => (await httpsCallable<Record<string, unknown>, TResult>(functions, name)(payload)).data;

export const settingsCatalogCallables = createSettingsCatalogCallables(invoke);
