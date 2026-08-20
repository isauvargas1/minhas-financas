import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp
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
  SettingsCatalogUpdateInput
} from './types';

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

export const listSettingsCatalog = async (
  workspaceId?: string
): Promise<SettingsCatalogItem[]> => {
  if (!workspaceId || workspaceId === 'loading') return [];

  const snapshot = await getDocs(settingsCatalogCollection(workspaceId));

  const items = snapshot.docs.map((itemDoc) => {
    return {
      id: itemDoc.id,
      ...(itemDoc.data() as Omit<SettingsCatalogItem, 'id'>)
    } as SettingsCatalogItem;
  });

  return sortSettingsCatalogItems(items);
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
  workspaceId?: string
): Promise<void> => {
  assertValidWorkspaceId(workspaceId);

  await runTransaction(db, async (transaction) => {
    const itemRef = settingsCatalogDoc(workspaceId, id);
    const itemSnapshot = await transaction.get(itemRef);

    if (!itemSnapshot.exists()) {
      return;
    }

    const current = itemSnapshot.data() as Omit<SettingsCatalogItem, 'id'>;
    const uniqueRef = settingsCatalogUniqueDoc(
      workspaceId,
      current.dedupeKey
    );

    transaction.delete(itemRef);
    transaction.delete(uniqueRef);
  });
};
