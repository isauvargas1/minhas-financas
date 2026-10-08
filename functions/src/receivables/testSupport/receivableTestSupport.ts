import assert from "node:assert/strict";
import {defaultAccountOf} from "../../shared/testSupport/kernelTestSupport";
import {Timestamp} from "firebase-admin/firestore";

import {formatIsoInstant} from "../../shared/commitTime";
import {
  call,
  db,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  json,
  seedLoanTenant,
  today,
} from "../../loans/testSupport/loanTestSupport";
import {
  archiveClient,
  cancelReceivable,
  createClient,
  createReceivable,
  receiveReceivable,
  reverseReceivableReceipt,
  updateClient,
  updateReceivable,
} from "../callables";
import type {
  ClientMutationResult,
  ReceivableMutationResult,
} from "../contracts";

/** Apoio comum das suítes de clientes e recebíveis (P3-I), só no Emulator. */

export type Tenant = Awaited<ReturnType<typeof seedLoanTenant>>;

/** Espaço PJ com owner, admin, dois members e viewer. */
export const seedReceivableTenant = (prefix = "rcv"): Promise<Tenant> =>
  seedLoanTenant("PJ", prefix);

export const PII = {
  name: "Comercial Exemplo Ltda.",
  document: "11.222.333/0001-81",
  documentDigits: "11222333000181",
  email: "Financeiro@Cliente.Example",
  emailNormalized: "financeiro@cliente.example",
  phone: "(11) 98765-4321",
  address: "Rua das Amostras, 100 — São Paulo/SP",
  notes: "Prefere boleto; falar com a diretoria.",
} as const;

/** Valores pessoais que nunca podem aparecer fora de `client_private`. */
export const PII_VALUES = [
  PII.documentDigits, PII.document, PII.emailNormalized, PII.email,
  PII.phone, PII.address, PII.notes,
];

export const clientRef = (workspaceId: string, clientId: string) =>
  db().doc(`workspaces/${workspaceId}/clients/${clientId}`);
export const clientPrivateRef = (workspaceId: string, clientId: string) =>
  db().doc(`workspaces/${workspaceId}/client_private/${clientId}`);
export const receivableRef = (workspaceId: string, receivableId: string) =>
  db().doc(`workspaces/${workspaceId}/receivables/${receivableId}`);
export const movementRef = (workspaceId: string, movementId: string) =>
  db().doc(`workspaces/${workspaceId}/receivable_movements/${movementId}`);
export const transactionRef = (workspaceId: string, id: string) =>
  db().doc(`workspaces/${workspaceId}/transactions/${id}`);

export const read = async (
  ref: FirebaseFirestore.DocumentReference,
): Promise<Record<string, unknown>> => (await ref.get()).data() ?? {};

const versionOf = async (
  ref: FirebaseFirestore.DocumentReference,
): Promise<string> => {
  const updatedAt = (await read(ref)).updatedAt;
  assert.ok(updatedAt instanceof Timestamp, `${ref.path} sem updatedAt`);
  return formatIsoInstant(updatedAt);
};

export const clientVersion = (workspaceId: string, clientId: string) =>
  versionOf(clientRef(workspaceId, clientId));
export const receivableVersion = (workspaceId: string, receivableId: string) =>
  versionOf(receivableRef(workspaceId, receivableId));

export const listOf = async (workspaceId: string, collection: string) =>
  (await db().collection(`workspaces/${workspaceId}/${collection}`).get())
    .docs.map((doc) =>
      ({id: doc.id, ...doc.data()}) as Record<string, unknown>);

export const countOf = async (workspaceId: string, collection: string) =>
  (await db().collection(`workspaces/${workspaceId}/${collection}`).count()
    .get()).data().count;

// ------------------------------------------------------------------ clientes

export const clientPayload = (
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => json({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  name: PII.name,
  document: PII.document,
  email: PII.email,
  phone: PII.phone,
  address: PII.address,
  notes: PII.notes,
  ...overrides,
});

export const newClient = (uid: string, data: Record<string, unknown>) =>
  call<ClientMutationResult>(createClient, uid, data);

export const clientUpdatePayload = async (
  workspaceId: string,
  clientId: string,
  changes: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  clientId,
  expectedUpdatedAt: await clientVersion(workspaceId, clientId),
  changes,
  ...overrides,
});

export const editClient = (uid: string, data: Record<string, unknown>) =>
  call<ClientMutationResult>(updateClient, uid, data);

export const archivePayload = async (
  workspaceId: string,
  clientId: string,
  overrides: Record<string, unknown> = {},
) => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  clientId,
  expectedUpdatedAt: await clientVersion(workspaceId, clientId),
  ...overrides,
});

export const archive = (uid: string, data: Record<string, unknown>) =>
  call<ClientMutationResult>(archiveClient, uid, data);

// ---------------------------------------------------------------- recebíveis

export const receivablePayload = (
  workspaceId: string,
  clientId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => json({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  clientId,
  description: "Consultoria de outubro",
  amountCents: 100_000,
  dueDate: today(),
  ...overrides,
});

export const newReceivable = (uid: string, data: Record<string, unknown>) =>
  call<ReceivableMutationResult>(createReceivable, uid, data);

export const receivableUpdatePayload = async (
  workspaceId: string,
  receivableId: string,
  changes: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  receivableId,
  expectedUpdatedAt: await receivableVersion(workspaceId, receivableId),
  changes,
  ...overrides,
});

export const editReceivable = (uid: string, data: Record<string, unknown>) =>
  call<ReceivableMutationResult>(updateReceivable, uid, data);

export const receivePayload = async (
  workspaceId: string,
  receivableId: string,
  overrides: Record<string, unknown> = {},
) => {
  const base: Record<string, unknown> = {
    workspaceId,
    idempotencyKey: idempotencyKey(),
    receivableId,
    expectedUpdatedAt: await receivableVersion(workspaceId, receivableId),
    principalCents: 40_000,
    interestCents: 0,
    penaltyCents: 0,
    discountCents: 0,
    paymentDate: today(),
    ...overrides,
  };
  // D-30: a conta acompanha o dinheiro; só desconto não informa conta.
  const cash = Number(base.principalCents) + Number(base.interestCents) +
    Number(base.penaltyCents);
  if (!("cashAccountId" in overrides) && cash > 0) {
    base.cashAccountId = defaultAccountOf(workspaceId);
  }
  return json(base);
};

export const receive = (uid: string, data: Record<string, unknown>) =>
  call<ReceivableMutationResult>(receiveReceivable, uid, data);

export const reversePayload = async (
  workspaceId: string,
  receivableId: string,
  movementId: string,
  overrides: Record<string, unknown> = {},
) => json({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  receivableId,
  movementId,
  expectedUpdatedAt: await receivableVersion(workspaceId, receivableId),
  reason: "Recebimento lançado em duplicidade",
  ...overrides,
});

export const reverse = (uid: string, data: Record<string, unknown>) =>
  call<ReceivableMutationResult>(reverseReceivableReceipt, uid, data);

export const cancelPayload = async (
  workspaceId: string,
  receivableId: string,
  overrides: Record<string, unknown> = {},
) => json({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  receivableId,
  expectedUpdatedAt: await receivableVersion(workspaceId, receivableId),
  reason: "Cobrança emitida por engano",
  ...overrides,
});

export const cancel = (uid: string, data: Record<string, unknown>) =>
  call<ReceivableMutationResult>(cancelReceivable, uid, data);

/** Cliente ativo pronto para receber recebíveis. */
export const seedClient = async (tenant: Tenant, overrides = {}) =>
  (await newClient(tenant.owner, clientPayload(tenant.workspaceId, overrides)))
    .clientId;
