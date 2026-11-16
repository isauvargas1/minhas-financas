import { deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { db } from '../../lib/firebase';
import {
  parseWorkTimePreference,
  workTimePreferenceFields,
  workTimePreferencePathSegments,
  type WorkTimeDisplayMode,
  type WorkTimePreference,
} from './contract';

/**
 * Leitura e escrita da preferência privada de tempo de trabalho equivalente
 * (P5-F). Só o próprio documento do usuário; as Rules negam qualquer outro.
 */

export type WorkTimePreferenceSnapshot = (
  | { status: 'absent' }
  | { status: 'valid'; preference: WorkTimePreference }
  | { status: 'invalid' }
) & {
  /** Gravação desta aba ainda não confirmada pelo servidor (estado otimista do SDK). */
  pendingWrites: boolean;
};

const preferenceRef = (uid: string) => {
  const [users, owner, collection, id] = workTimePreferencePathSegments(uid);
  return doc(db, users, owner, collection, id);
};

/**
 * Escuta o documento do próprio usuário: uma leitura ao abrir e uma por
 * mudança (inclusive de outra aba ou outro dispositivo), sem polling.
 */
export const subscribeWorkTimePreference = (
  uid: string,
  onNext: (snapshot: WorkTimePreferenceSnapshot) => void,
  onError: (error: unknown) => void,
): (() => void) =>
  onSnapshot(
    preferenceRef(uid),
    (snapshot) => {
      const pendingWrites = snapshot.metadata.hasPendingWrites;
      if (!snapshot.exists()) {
        onNext({ status: 'absent', pendingWrites });
        return;
      }
      const preference = parseWorkTimePreference(snapshot.data({ serverTimestamps: 'estimate' }));
      onNext(preference ? { status: 'valid', preference, pendingWrites } : { status: 'invalid', pendingWrites });
    },
    onError,
  );

/** Grava a preferência inteira (cria ou substitui). */
export const saveWorkTimePreference = (uid: string, preference: WorkTimePreference): Promise<void> =>
  setDoc(preferenceRef(uid), { ...workTimePreferenceFields(preference), updatedAt: serverTimestamp() });

/**
 * Troca só o modo de exibição. A atualização parcial preserva a renda e a
 * carga gravadas por outra aba no meio do caminho.
 */
export const saveWorkTimeDisplayMode = (uid: string, displayMode: WorkTimeDisplayMode): Promise<void> =>
  updateDoc(preferenceRef(uid), { displayMode, updatedAt: serverTimestamp() });

/** Apaga a preferência: a renda deixa de existir no servidor. */
export const deleteWorkTimePreference = (uid: string): Promise<void> => deleteDoc(preferenceRef(uid));
