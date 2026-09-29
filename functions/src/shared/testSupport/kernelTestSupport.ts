import * as admin from "firebase-admin";
import type {CallableRequest} from "firebase-functions/v2/https";

import type {WorkspaceRole} from "../workspaceAuth";

/**
 * Suporte de teste do kernel (somente testes; fora dos exports e do upload de
 * deploy — `firebase.json` ignora `lib/**\/testSupport/**`).
 */

export const TEST_PROJECT_ID = "minhas-financas-local";

/**
 * Exige o Emulator do Firestore no projeto local.
 *
 * Suíte de integração sem Emulator **falha** em vez de pular (FIRE-13): um CI
 * mal configurado não pode reportar verde sem ter exercitado nada. A
 * verificação do projeto impede que um `GCLOUD_PROJECT` herdado aponte o
 * Admin SDK para um projeto real.
 */
export const requireFirestoreEmulator = (): admin.firestore.Firestore => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST é obrigatório para os testes de integração.",
    );
  }
  const project = process.env.GCLOUD_PROJECT ?? TEST_PROJECT_ID;
  if (project !== TEST_PROJECT_ID) {
    throw new Error(`Projeto de teste inesperado: ${project}.`);
  }
  if (!admin.apps.length) admin.initializeApp({projectId: TEST_PROJECT_ID});
  return admin.firestore();
};

export interface TestTokenOverrides {
  email?: string | null;
  email_verified?: boolean;
  auth_time?: number | null;
  sign_in_provider?: string | null;
}

export const testEmailFor = (uid: string): string =>
  `${uid.toLowerCase()}@teste.minhas-financas.local`;

/**
 * Requisição de callable como o runtime a entrega depois de verificar o ID
 * token: e-mail verificado, login Google recente. Os testes de política
 * sobrescrevem campo a campo.
 */
export const callableRequest = <T = Record<string, unknown>>(
  uid: string | null,
  data: T,
  overrides: TestTokenOverrides = {},
): CallableRequest<T> => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const token: Record<string, unknown> = {
    uid,
    sub: uid,
    email: overrides.email === undefined ? testEmailFor(uid ?? "anon") :
      overrides.email,
    email_verified: overrides.email_verified ?? true,
    auth_time: overrides.auth_time === undefined ? nowSeconds :
      overrides.auth_time,
    firebase: {
      sign_in_provider: overrides.sign_in_provider === undefined ?
        "google.com" :
        overrides.sign_in_provider,
    },
  };
  for (const key of Object.keys(token)) {
    if (token[key] === null) delete token[key];
  }
  return {
    data,
    auth: uid ? {uid, token, rawToken: "test-token"} : undefined,
    rawRequest: {headers: {}},
  } as unknown as CallableRequest<T>;
};

/** Perfil server-owned ativo, como `bootstrapAccount` o deixaria. */
export const seedActiveAccount = async (
  uid: string,
  overrides: Record<string, unknown> = {},
): Promise<void> => {
  const db = requireFirestoreEmulator();
  await db.doc(`users/${uid}`).set({
    uid,
    email: testEmailFor(uid),
    displayName: uid,
    photoURL: null,
    status: "active",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
};

export interface SeedWorkspaceInput {
  workspaceId: string;
  ownerId: string;
  type?: "PF" | "PJ";
  name?: string;
  status?: "active" | "archived";
  extra?: Record<string, unknown>;
}

/** Workspace com o owner canônico já como membership ativo. */
export const seedWorkspace = async (input: SeedWorkspaceInput) => {
  const db = requireFirestoreEmulator();
  await db.doc(`workspaces/${input.workspaceId}`).set({
    name: input.name ?? input.workspaceId,
    type: input.type ?? "PF",
    ownerId: input.ownerId,
    status: input.status ?? "active",
    currency: "BRL",
    cnpj: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(input.extra ?? {}),
  });
  await seedMember(input.workspaceId, input.ownerId, "owner");
};

/** Membership (e entrada do índice do usuário) com o papel informado. */
export const seedMember = async (
  workspaceId: string,
  uid: string,
  role: WorkspaceRole,
  status: "active" | "removed" = "active",
): Promise<void> => {
  const db = requireFirestoreEmulator();
  const workspace = (await db.doc(`workspaces/${workspaceId}`).get()).data();
  await db.doc(`workspaces/${workspaceId}/members/${uid}`).set({
    uid,
    role,
    status,
    email: testEmailFor(uid),
    displayName: uid,
    photoURL: null,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.doc(`users/${uid}/workspaces/${workspaceId}`).set({
    workspaceId,
    status,
    name: workspace?.name ?? workspaceId,
    type: workspace?.type ?? "PF",
    workspaceStatus: workspace?.status ?? "active",
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};
