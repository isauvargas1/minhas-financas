import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {CreditCardApplicationError} from "../creditCards/errors";
import {INVESTMENT_COLLECTIONS, investmentDoc} from "./paths";

/**
 * Lease de operação pesada por workspace (INV-P2-043).
 *
 * Migração, rollback, backfill e reconstrução são operações **paginadas com
 * checkpoint**: cada chamada retoma o estado da anterior. Duas execuções
 * concorrentes do mesmo workspace liam o mesmo checkpoint, aplicavam a mesma
 * página duas vezes e inflavam os totais — o `runTransaction` protege cada
 * página isoladamente, não a sequência inteira.
 *
 * O lease é um documento no próprio domínio, adquirido dentro da transação da
 * página. Ele expira sozinho: uma execução que morre no meio não deixa o
 * workspace travado para sempre. O dono do lease é identificado por
 * `holderId`, tipicamente o `migrationId`/`rebuildId`, para que a **mesma**
 * execução continue renovando o próprio lease entre páginas.
 */

/** Janela de validade. Uma página nunca dura mais que isto. */
export const OPERATION_LEASE_TTL_SECONDS = 15 * 60;

export type InvestmentLeaseKind =
  | "legacy_migration"
  | "projection_rebuild"
  | "workspace_backfill";

const leaseId = (kind: InvestmentLeaseKind): string => `lease_${kind}`;

const leaseRef = (
  workspaceId: string,
  kind: InvestmentLeaseKind,
): admin.firestore.DocumentReference =>
  investmentDoc(
    workspaceId,
    INVESTMENT_COLLECTIONS.operationLeases,
    leaseId(kind),
  );

export interface AcquireLeaseInput {
  workspaceId: string;
  kind: InvestmentLeaseKind;
  /** Identidade da execução; a mesma execução renova em vez de disputar. */
  holderId: string;
  actorId: string;
  correlationId: string;
}

/**
 * Adquire ou renova o lease **dentro** da transação da página.
 *
 * Devolve a função que grava a renovação. A separação existe porque o
 * Firestore exige **todas** as leituras antes de qualquer escrita numa
 * transação: quem chama pode intercalar outras leituras (o limite de
 * frequência, por exemplo) entre a verificação e a gravação.
 *
 * Falha com mensagem em pt-BR quando outra execução detém o lease e ele ainda
 * não expirou.
 */
export const acquireInvestmentOperationLease = async (
  transaction: admin.firestore.Transaction,
  input: AcquireLeaseInput,
): Promise<() => void> => {
  const ref = leaseRef(input.workspaceId, input.kind);
  const snapshot = await transaction.get(ref);
  const now = Date.now();
  const data = snapshot.data();
  const expiresAtMs = (data?.expiresAt as Timestamp | undefined)?.toMillis() ?? 0;
  const holderId = typeof data?.holderId === "string" ? data.holderId : undefined;

  if (holderId && holderId !== input.holderId && expiresAtMs > now) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Já existe uma operação deste tipo em andamento neste workspace. " +
        "Aguarde a conclusão antes de iniciar outra.",
      {
        kind: input.kind,
        retryAfterSeconds: Math.ceil((expiresAtMs - now) / 1000),
      },
    );
  }

  return () => transaction.set(
    ref,
    {
      id: ref.id,
      workspaceId: input.workspaceId,
      kind: "operation_lease",
      leaseKind: input.kind,
      targetId: input.workspaceId,
      holderId: input.holderId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      acquiredAt: holderId === input.holderId && data?.acquiredAt ?
        data.acquiredAt :
        FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(
        now + OPERATION_LEASE_TTL_SECONDS * 1000,
      ),
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
};

/**
 * Libera o lease ao concluir a operação.
 *
 * O documento permanece, com `holderId` nulo: serve de trilha de quem operou
 * o workspace e quando. Liberar cedo evita esperar o TTL para a próxima
 * execução legítima.
 */
export const releaseInvestmentOperationLease = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  kind: InvestmentLeaseKind,
  holderId: string,
): void => {
  transaction.set(
    leaseRef(workspaceId, kind),
    {
      holderId: null,
      lastHolderId: holderId,
      expiresAt: Timestamp.fromMillis(0),
      releasedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
};
