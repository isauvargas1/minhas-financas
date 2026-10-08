/**
 * Contrato cliente das callables de clientes e recebíveis (P3-I).
 *
 * Módulo puro: não importa o SDK. `api.ts` o liga ao `httpsCallable`; os
 * testes, a um `invoke` falso. A chave de idempotência chega pronta, decidida
 * por intenção no diálogo: o reenvio do mesmo conteúdo usa a mesma chave;
 * conteúdo novo, chave nova. As callables são o único caminho de escrita —
 * as Rules negam toda escrita do cliente em `clients`, `client_private`,
 * `receivables`, `receivable_movements` e nas trilhas de auditoria.
 */
export const CLIENTS_CALLABLES = [
  'createClient',
  'updateClient',
  'archiveClient',
  'createReceivable',
  'updateReceivable',
  'receiveReceivable',
  'reverseReceivableReceipt',
  'cancelReceivable',
] as const;

export type ClientsCallableName = (typeof CLIENTS_CALLABLES)[number];

export type ClientsInvoke = <TResult>(
  name: ClientsCallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

export interface ClientMutationResult {
  clientId: string;
  changed?: boolean;
  status?: string;
  replayed: boolean;
}

export interface ReceivableMutationResult {
  receivableId: string;
  movementId?: string;
  cashTransactionId?: string | null;
  status?: string;
  balanceCents?: number;
  changed?: boolean;
  replayed: boolean;
}

const bind = <TResult>(invoke: ClientsInvoke, name: ClientsCallableName) =>
  (payload: Record<string, unknown>, idempotencyKey: string) =>
    invoke<TResult>(name, { ...payload, idempotencyKey });

export const createClientsCallables = (invoke: ClientsInvoke) => ({
  createClient: bind<ClientMutationResult>(invoke, 'createClient'),
  updateClient: bind<ClientMutationResult>(invoke, 'updateClient'),
  archiveClient: bind<ClientMutationResult>(invoke, 'archiveClient'),
  createReceivable: bind<ReceivableMutationResult>(invoke, 'createReceivable'),
  updateReceivable: bind<ReceivableMutationResult>(invoke, 'updateReceivable'),
  receiveReceivable: bind<ReceivableMutationResult>(invoke, 'receiveReceivable'),
  reverseReceivableReceipt: bind<ReceivableMutationResult>(invoke, 'reverseReceivableReceipt'),
  cancelReceivable: bind<ReceivableMutationResult>(invoke, 'cancelReceivable'),
} satisfies Record<ClientsCallableName, (...args: never[]) => Promise<unknown>>);

export type ClientsCallables = ReturnType<typeof createClientsCallables>;
