import {
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  where,
} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';

import {db, functions} from '../../lib/firebase';
import {
  SETTINGS_CATALOG_COLLECTION,
  SETTINGS_CATALOG_UNIQUES_COLLECTION
} from './constants';
import {
  buildSettingsCatalogCreateData,
  buildSettingsCatalogUpdateData,
  sortSettingsCatalogItems
} from './utils';
import type {
  SettingsCatalogCreateInput,
  SettingsCatalogItem,
  SettingsCatalogListFilters,
  SettingsCatalogPage,
  SettingsCatalogPageCursor,
  SettingsCatalogUpdateInput
} from './types';

const SETTINGS_CATALOG_PAGE_SIZE = 30;

const settingsCatalogCollection = (workspaceId: string) =>
  collection(db, 'workspaces', workspaceId, SETTINGS_CATALOG_COLLECTION);

const settingsCatalogDoc = (workspaceId: string, id: string) =>
  doc(db, 'workspaces', workspaceId, SETTINGS_CATALOG_COLLECTION, id);

const settingsCatalogUniqueDoc = (
  workspaceId: string,
  dedupeKey: string
) =>
  doc(
    db,
    'workspaces',
    workspaceId,
    SETTINGS_CATALOG_UNIQUES_COLLECTION,
    dedupeKey
  );

function assertValidWorkspaceId(
  workspaceId?: string
): asserts workspaceId is string {
  if (!workspaceId || workspaceId === 'loading') {
    throw new Error('Workspace ID inválido para catálogo.');
  }
}

function assertValidUserId(userId?: string): asserts userId is string {
  if (!userId) {
    throw new Error('Usuário autenticado é obrigatório para catálogo.');
  }
}

const stripUndefined = <T extends Record<string, unknown>>(obj: T) => {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
};

export const seedLegacySettingsCatalog = async (workspaceId: string): Promise<void> => {
  assertValidWorkspaceId(workspaceId);
  const callable = httpsCallable(functions, 'seedLegacySettingsCatalog');
  await callable({
    workspaceId,
    idempotencyKey: `legacy-catalog-seed-v1:${workspaceId}`,
  });
};

/**
 * Teto de itens do catálogo lidos de uma vez.
 *
 * O catálogo é cadastro do workspace, não histórico: alguns milhares de itens
 * já é um cenário extremo. O teto existe para que a consulta seja limitada por
 * construção (INV-P2-034) e para que ultrapassá-lo seja **visível** em vez de
 * silencioso.
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

export const createSettingsCatalogItem = async (
  input: SettingsCatalogCreateInput,
  workspaceId?: string,
  userId?: string
): Promise<SettingsCatalogItem> => {
  assertValidWorkspaceId(workspaceId);
  assertValidUserId(userId);

  const prepared = buildSettingsCatalogCreateData(input, workspaceId, userId);

  return runTransaction(db, async (transaction) => {
    const uniqueRef = settingsCatalogUniqueDoc(
      workspaceId,
      prepared.dedupeKey
    );

    const uniqueSnapshot = await transaction.get(uniqueRef);

    if (uniqueSnapshot.exists()) {
      throw new Error(
        'Já existe um item com esse nome nesse catálogo do workspace.'
      );
    }

    const itemRef = doc(settingsCatalogCollection(workspaceId));

    transaction.set(
      uniqueRef,
      stripUndefined({
        dedupeKey: prepared.dedupeKey,
        catalogItemId: itemRef.id,
        workspaceId,
        group: prepared.group,
        normalizedName: prepared.normalizedName,
        createdBy: userId,
        updatedBy: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );

    transaction.set(
      itemRef,
      stripUndefined({
        ...prepared,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );

    return {
      id: itemRef.id,
      ...prepared,
      createdAt: null,
      updatedAt: null
    } as SettingsCatalogItem;
  });
};

export const updateSettingsCatalogItem = async (
  id: string,
  input: SettingsCatalogUpdateInput,
  workspaceId?: string,
  userId?: string
): Promise<SettingsCatalogItem> => {
  assertValidWorkspaceId(workspaceId);
  assertValidUserId(userId);

  return runTransaction(db, async (transaction) => {
    const itemRef = settingsCatalogDoc(workspaceId, id);
    const itemSnapshot = await transaction.get(itemRef);

    if (!itemSnapshot.exists()) {
      throw new Error('Item de catálogo não encontrado.');
    }

    const current = {
      id: itemSnapshot.id,
      ...(itemSnapshot.data() as Omit<SettingsCatalogItem, 'id'>)
    } as SettingsCatalogItem;

    const next = buildSettingsCatalogUpdateData(current, input, userId);

    const currentUniqueRef = settingsCatalogUniqueDoc(
      workspaceId,
      current.dedupeKey
    );

    const nextUniqueRef = settingsCatalogUniqueDoc(
      workspaceId,
      next.dedupeKey
    );

    if (current.dedupeKey !== next.dedupeKey) {
      const nextUniqueSnapshot = await transaction.get(nextUniqueRef);

      if (nextUniqueSnapshot.exists()) {
        throw new Error(
          'Já existe um item com esse nome nesse catálogo do workspace.'
        );
      }

      transaction.set(
        nextUniqueRef,
        stripUndefined({
          dedupeKey: next.dedupeKey,
          catalogItemId: id,
          workspaceId,
          group: next.group,
          normalizedName: next.normalizedName,
          createdBy: current.createdBy,
          updatedBy: userId,
          createdAt: current.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp()
        })
      );

      transaction.delete(currentUniqueRef);
    } else {
      transaction.set(
        currentUniqueRef,
        stripUndefined({
          dedupeKey: next.dedupeKey,
          catalogItemId: id,
          workspaceId,
          group: next.group,
          normalizedName: next.normalizedName,
          createdBy: current.createdBy,
          updatedBy: userId,
          createdAt: current.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp()
        }),
        { merge: true }
      );
    }

    transaction.set(
      itemRef,
      stripUndefined({
        ...next,
        createdAt: current.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );

    return {
      id,
      ...next,
      createdAt: current.createdAt ?? null,
      updatedAt: null
    } as SettingsCatalogItem;
  });
};

export const deleteSettingsCatalogItem = async (
  id: string,
  workspaceId?: string,
  userId?: string,
): Promise<void> => {
  assertValidWorkspaceId(workspaceId);
  assertValidUserId(userId);

  await runTransaction(db, async (transaction) => {
    const itemRef = settingsCatalogDoc(workspaceId, id);
    const itemSnapshot = await transaction.get(itemRef);

    if (!itemSnapshot.exists()) {
      return;
    }

    const current = itemSnapshot.data() as Omit<SettingsCatalogItem, 'id'>;
    transaction.update(itemRef, {
      status: 'inactive',
      updatedBy: userId,
      updatedAt: serverTimestamp()
    });
  });
};
