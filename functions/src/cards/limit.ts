import * as admin from "firebase-admin";

import {
  cardLimitPatch,
  cardsRef,
  limitLedgerDocument,
  limitLedgerIdFor,
  limitLedgerRef,
  type AuthoritativeCard,
  type LimitLedgerKind,
} from "./model";

/**
 * Livro do limite (P4-A): todo fato que consome ou devolve limite grava um
 * lançamento com sinal (positivo consome) e o derivado do cartão
 * (`limitUsedCents`, `limitAvailableCents`) no mesmo commit. O ID é
 * determinístico pelo fato de origem: a repetição do mesmo fato aborta no
 * `create` em vez de duplicar. Valor zero não grava nada. Devolve o limite
 * usado depois do lançamento.
 */
export const postCardLimit = (
  transaction: admin.firestore.Transaction,
  card: AuthoritativeCard,
  input: {
    kind: LimitLedgerKind;
    amountCents: number;
    sourceKey: string;
    sourceId: string;
    actorUid: string;
    operation: string;
    requestId: string;
  },
): number => {
  const limitUsedAfter = card.limitUsedCents + input.amountCents;
  if (input.amountCents === 0) return limitUsedAfter;
  const id = limitLedgerIdFor(input.sourceKey);
  transaction.create(limitLedgerRef(card.workspaceId).doc(id),
    limitLedgerDocument({
      id,
      workspaceId: card.workspaceId,
      cardId: card.id,
      kind: input.kind,
      amountCents: input.amountCents,
      sourceId: input.sourceId,
      limitUsedAfterCents: limitUsedAfter,
      actorUid: input.actorUid,
      operation: input.operation,
      requestId: input.requestId,
    }));
  transaction.update(cardsRef(card.workspaceId).doc(card.id),
    cardLimitPatch(card, limitUsedAfter));
  return limitUsedAfter;
};
