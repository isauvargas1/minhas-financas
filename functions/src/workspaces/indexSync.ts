import * as admin from "firebase-admin";
import {FieldPath, FieldValue} from "firebase-admin/firestore";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";

import {createOperationLogger} from "../shared/logger";
import {WORKSPACE_INDEX_SYNC_OPTIONS} from "../shared/runtimeOptions";
import {
  userWorkspaceIndexRef,
  workspaceRef,
} from "../shared/workspaceAuth";
import {workspaceDisplayOf} from "./model";

/**
 * Propagação dos dados de exibição para o índice dos membros.
 *
 * O índice `users/{uid}/workspaces/{id}` guarda `name`, `type` e
 * `workspaceStatus` para que a listagem de workspaces seja uma única consulta,
 * sem hidratar cada workspace (N+1). Renomear ou arquivar precisa refletir no
 * índice de todos os membros ativos, e esse fan-out cresce com o número de
 * membros; por isso não cabe na transação da callable. Ela atualiza só a
 * entrada do próprio ator; este gatilho atualiza as demais.
 *
 * Limites: páginas de `PAGE_SIZE` membros ativos, ordenadas por ID, com
 * cursor; lote de escrita por página. O conteúdo gravado é lido do workspace
 * **no momento da execução**, e não do evento: duas renomeações rápidas cujos
 * gatilhos rodem fora de ordem terminam com o nome atual. Com isso a execução
 * é idempotente e o `retry` pode refazê-la do início.
 */
export const INDEX_SYNC_PAGE_SIZE = 200;

export const syncWorkspaceIndexEntries = async (
  workspaceId: string,
): Promise<{updated: number; pages: number}> => {
  const db = admin.firestore();
  const snapshot = await workspaceRef(workspaceId).get();
  if (!snapshot.exists) return {updated: 0, pages: 0};
  const display = workspaceDisplayOf(snapshot.data() ?? {});
  let cursor: string | null = null;
  let updated = 0;
  let pages = 0;
  for (;;) {
    let query = workspaceRef(workspaceId).collection("members")
      .where("status", "==", "active")
      .orderBy(FieldPath.documentId())
      .limit(INDEX_SYNC_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    pages += 1;
    const batch = db.batch();
    for (const member of page.docs) {
      batch.set(userWorkspaceIndexRef(member.id, workspaceId), {
        name: display.name,
        type: display.type,
        workspaceStatus: display.status,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    await batch.commit();
    updated += page.size;
    if (page.size < INDEX_SYNC_PAGE_SIZE) break;
    cursor = page.docs[page.docs.length - 1].id;
  }
  return {updated, pages};
};

/** Só nome, tipo e status afetam o índice; outras edições não disparam nada. */
export const indexDisplayChanged = (
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
): boolean => {
  if (!before || !after) return false;
  const previous = workspaceDisplayOf(before);
  const next = workspaceDisplayOf(after);
  return previous.name !== next.name ||
    previous.type !== next.type ||
    previous.status !== next.status;
};

export const onWorkspaceDisplayChange = onDocumentUpdated(
  {document: "workspaces/{workspaceId}", ...WORKSPACE_INDEX_SYNC_OPTIONS},
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!indexDisplayChanged(before, after)) return;
    const workspaceId = event.params.workspaceId;
    const log = createOperationLogger({
      operation: "syncWorkspaceIndexEntries",
      requestId: event.id,
      workspaceId,
    });
    const startedAt = Date.now();
    try {
      const result = await syncWorkspaceIndexEntries(workspaceId);
      log.info("trigger.end", {
        outcome: "ok",
        updated: result.updated,
        pages: result.pages,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      log.error("trigger.end", error, {
        outcome: "error",
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  },
);
