/**
 * Estorno de um recebimento de cliente desconsiderado (P5-F.1-R1, B01). Módulo sem React e sem
 * Firebase, imports com extensão `.ts`.
 *
 * O backend grava o recebimento e o estorno como espelhos de caixa com IDs determinísticos
 * (`functions/src/receivables/model.ts`): o movimento do recebimento é `rmv_<h>` e o espelho dele,
 * `recvcash_<h>`; o estorno de um movimento é `rmv_` + os 40 primeiros hexadecimais do SHA-256 de
 * `<movimento>:reversal`, e o espelho do estorno, `recvcash_` + os mesmos 40. Um recebimento tem no
 * máximo um estorno, sempre total e na data do próprio recebimento, e nenhum dos dois espelhos muda
 * depois de gravado (marca `receivableEntry`, só do backend).
 *
 * Então, para cada recebimento desconsiderado, o ID do estorno é conhecido sem consulta nova: a
 * leitura por id lê o recebimento e o possível estorno juntos, na mesma consulta. A paridade da
 * derivação com o backend é provada por fixture compartilhada
 * (`tests/fixtures/receivable-reversal-ids.json`), conferida dos dois lados.
 */

import { transactionFingerprint } from './projectionProof.ts';

const MIRROR = /^recvcash_([0-9a-f]{40})$/;

/** Movimento do recebimento cujo espelho de caixa é `mirrorId`, ou `null` se o ID não é de um espelho de recebimento. */
export const receiptMovementIdOfMirror = (mirrorId: string): string | null => {
  const match = MIRROR.exec(mirrorId);
  return match ? `rmv_${match[1]}` : null;
};

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** ID do movimento de estorno de `movementId` (`reversalMovementIdFor` do backend). */
export const reversalMovementIdOf = async (movementId: string): Promise<string> =>
  `rmv_${(await sha256Hex(`${movementId}:reversal`)).slice(0, 40)}`;

/** ID do espelho de caixa do estorno do recebimento cujo espelho é `mirrorId`, ou `null` (não é recebimento). */
export const reversalMirrorIdOf = async (mirrorId: string): Promise<string | null> => {
  const movementId = receiptMovementIdOfMirror(mirrorId);
  if (movementId === null) return null;
  return `recvcash_${(await reversalMovementIdOf(movementId)).slice('rmv_'.length)}`;
};

/** Lançamentos desconsiderados lidos por id, com o estorno de cada recebimento que já foi estornado. */
export interface ExcludedRead {
  found: ReadonlyArray<object>;
  missing: readonly string[];
  /** Espelho do estorno encontrado, pelo ID do recebimento desconsiderado. */
  reversals: Readonly<Record<string, object>>;
  /**
   * P5-F.1-R3 (B03): impressão digital do conteúdo bruto de cada lançamento lido (desconsiderados e espelhos de
   * estorno), por id; `null` quando o conteúdo não pôde ser serializado (a prova falha).
   */
  fingerprints: Readonly<Record<string, string | null>>;
  /** P5-F.1-R3: o espelho do estorno de cada recebimento desconsiderado, lido ou não (a marca dele entra na prova). */
  reversalIds: Readonly<Record<string, string>>;
}

/**
 * Leitura por id injetada: os encontrados, os ids que não existem e o conteúdo bruto de cada encontrado, como o
 * servidor o guardou (a impressão digital é dele, não do normalizado).
 */
export type ReadByIds = (
  workspaceId: string,
  ids: readonly string[],
) => Promise<{ found: ReadonlyArray<object>; missing: readonly string[]; raw?: Readonly<Record<string, object>> }>;

/**
 * Lê os desconsiderados e, na mesma leitura, o espelho do estorno de cada um que é espelho de
 * recebimento. Os pares (recebimento, estorno) vão primeiro e lado a lado, sem repetir nenhum ID, para
 * caírem na mesma consulta `in` (lotes de 30, um número par, lidos em sequência): cada par vem da mesma
 * consulta. Um ID que já entrou como estorno de outro (por exemplo, o espelho de um estorno na própria lista)
 * não abre um par novo: estorno não tem estorno.
 */
export const pairedReadIds = (pairs: ReadonlyArray<readonly [string, string]>, unique: readonly string[]): string[] => {
  // Primeiro os pares cujo lançamento não é o espelho do estorno de outro da lista (revisão independente 2, M07):
  // o espelho de um estorno listado antes do próprio recebimento entra no par dele, lado a lado.
  const mirrors = new Set(pairs.map(([, reversalId]) => reversalId));
  const ordered = [...pairs.filter(([id]) => !mirrors.has(id)), ...pairs.filter(([id]) => mirrors.has(id))];
  const placed = new Set<string>();
  const list: string[] = [];
  for (const [id, reversalId] of ordered) {
    if (placed.has(id) || placed.has(reversalId)) continue;
    list.push(id, reversalId);
    placed.add(id);
    placed.add(reversalId);
  }
  for (const id of unique) {
    if (placed.has(id)) continue;
    list.push(id);
    placed.add(id);
  }
  return list;
};

export const readExcludedIncome = async (
  readByIds: ReadByIds,
  workspaceId: string,
  ids: readonly string[],
): Promise<ExcludedRead> => {
  const unique = [...new Set(ids)];
  const excluded = new Set(unique);
  const derived = await Promise.all(unique.map(async (id) => [id, await reversalMirrorIdOf(id)] as const));
  const pairs = derived.filter((entry): entry is readonly [string, string] => entry[1] !== null);
  const read = await readByIds(workspaceId, pairedReadIds(pairs, unique));
  const idOf = (document: object) => String((document as { id?: unknown }).id);
  const byId = new Map(read.found.map((document) => [idOf(document), document]));
  const reversals: Record<string, object> = {};
  const reversalIds: Record<string, string> = {};
  for (const [id, reversalId] of pairs) {
    reversalIds[id] = reversalId;
    const reversal = byId.get(reversalId);
    if (reversal) reversals[id] = reversal;
  }
  // Sem o conteúdo bruto, nenhuma impressão; um tipo desconhecido também dá `null`: a prova falha, nunca passa.
  const fingerprints: Record<string, string | null> = {};
  for (const document of read.found) {
    const id = idOf(document);
    const raw = read.raw?.[id];
    try {
      fingerprints[id] = raw === undefined ? null : await transactionFingerprint(raw as Record<string, unknown>);
    } catch {
      fingerprints[id] = null;
    }
  }
  // Os itens são só os desconsiderados; o estorno lido junto fica em `reversals`.
  return {
    found: read.found.filter((document) => excluded.has(idOf(document))),
    missing: read.missing.filter((id) => excluded.has(id)),
    reversals,
    fingerprints,
    reversalIds,
  };
};
