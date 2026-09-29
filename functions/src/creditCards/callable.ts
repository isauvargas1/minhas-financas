import {ApplicationError} from "../shared/errors";
import {
  isWorkspaceRole,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";

import {
  getCreditCardBackendWritePlan,
  type CreditCardBackendWriteOperation,
} from "./writeStrategy";

/**
 * Contexto de execução de uma operação de cartão.
 *
 * `actor` vem da pré-checagem do kernel (`resolveWorkspaceActor`, chamada por
 * `defineCallable`). A decisão que vale é a releitura
 * `reassertWorkspaceActor` que cada operação faz na fase de leitura da própria
 * transação: entre a pré-checagem e o commit o membro pode ter sido removido
 * ou rebaixado.
 */
export interface CreditCardOperationContext<TPayload> {
  payload: TPayload;
  actor: WorkspaceActor;
}

interface WorkspaceScoped {
  workspaceId: string;
}

export const CREDIT_CARD_INTERNAL_ERROR_MESSAGE =
  "Erro interno ao processar operação de cartão.";

/**
 * Papéis de membership aceitos pela operação, segundo a matriz de
 * `writeStrategy.ts`. `system` não é papel de membership — as rotinas
 * agendadas não passam por callable — e fica de fora.
 */
export const creditCardWorkspaceRoles = (
  operation: CreditCardBackendWriteOperation,
): WorkspaceRole[] =>
  getCreditCardBackendWritePlan(operation).allowedRoles
    .filter(isWorkspaceRole);

/**
 * Monta o contexto a partir do que o kernel entregou ao handler.
 *
 * O ator é resolvido com o `workspaceId` do próprio payload; a comparação é
 * defesa em profundidade para que nenhuma operação leia um workspace e
 * reavalie a autorização em outro.
 */
export const buildCreditCardOperationContext = <T extends WorkspaceScoped>(
  payload: T,
  actor: WorkspaceActor | null,
): CreditCardOperationContext<T> => {
  if (!actor || actor.workspaceId !== payload.workspaceId) {
    throw new ApplicationError("internal", CREDIT_CARD_INTERNAL_ERROR_MESSAGE);
  }

  return {payload, actor};
};
