import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin') as typeof import('../../functions/node_modules/firebase-admin');

/**
 * Seeds do E2E no modelo de P1 (somente Emulator, projeto local).
 *
 * O backend é a única autoridade sobre conta, workspace e membership; o E2E
 * semeia pelo Admin SDK exatamente as formas que `bootstrapAccount`,
 * `createWorkspace` e o aceite de convite gravariam:
 *
 * - `users/{uid}`: perfil ativo (sem ele toda autorização é negada);
 * - `workspaces/{id}`: `status: 'active'`, `ownerId` só desnormalizado;
 * - `workspaces/{id}/members/{uid}`: única fonte de papel;
 * - `users/{uid}/workspaces/{id}`: índice de listagem, **sem papel**, com
 *   `joinedAt` (a listagem ordena por ele);
 * - P2B.1: `billing_accounts/{uid}` Free e a quota de ownership do titular
 *   (`quota_state/ownership`), e a quota de membros do workspace
 *   (`workspaces/{id}/quota_state/membership`), coerentes com os
 *   workspaces e memberships semeados. Sem esse estado o backend falha
 *   fechado nas operações sujeitas a quota.
 *
 * O seam de convite (`issueInviteTokenForE2E`) roda no processo do
 * Playwright, nunca no bundle do app: grava o ponteiro do hash de um token
 * conhecido para um convite existente, como a emissão faria (D-05).
 */
export const PROJECT_ID = 'minhas-financas-local';

export const configureEmulatorEnvironment = (): void => {
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
};

export const adminSdk = () => {
  configureEmulatorEnvironment();
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  return admin;
};

const now = () => admin.firestore.FieldValue.serverTimestamp();

export interface SeedAccountInput {
  uid: string;
  email: string;
  displayName?: string;
}

const QUOTA_SCHEMA_VERSION = 1;

const ignoreAlreadyExists = (error: unknown): void => {
  const code = (error as { code?: unknown } | null)?.code;
  if (code !== 6 && code !== 'already-exists') throw error;
};

/** Billing Free e quota de ownership, só se ainda não existirem. */
const seedAccountBillingState = async (uid: string) => {
  const db = adminSdk().firestore();
  await db.doc(`billing_accounts/${uid}`).create({
    billingOwnerUid: uid,
    catalogVersion: 1,
    planId: 'free',
    entitlementStatus: 'free',
    subscriptionStatus: 'none',
    graceUntil: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    pendingCheckout: null,
    lastStripeEventId: null,
    lastStripeEventType: null,
    stripeSyncedAt: null,
    createdAt: now(),
    updatedAt: now(),
  }).catch(ignoreAlreadyExists);
  await db.doc(`billing_accounts/${uid}/quota_state/ownership`).create({
    billingOwnerUid: uid,
    activeOwnedWorkspaces: 0,
    schemaVersion: QUOTA_SCHEMA_VERSION,
    updatedAt: now(),
  }).catch(ignoreAlreadyExists);
};

export const seedAccountProfile = async ({ uid, email, displayName }: SeedAccountInput) => {
  await adminSdk().firestore().doc(`users/${uid}`).set({
    uid,
    email: email.toLowerCase(),
    displayName: displayName ?? email,
    photoURL: null,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  });
  await seedAccountBillingState(uid);
};

/**
 * Plano pago ativo no billing semeado (P2B.1), na mesma forma do
 * `seedPaidPlan` das suítes de integração. Para fluxos com mais workspaces
 * ou membros do que o Free comporta; a quota em si é coberta em
 * `functions/src/billing/__tests__`.
 */
export const seedPaidPlan = async (uid: string, planId: 'pro' | 'business') => {
  await seedAccountBillingState(uid);
  await adminSdk().firestore().doc(`billing_accounts/${uid}`).update({
    planId,
    entitlementStatus: 'active',
    subscriptionStatus: 'active',
    updatedAt: now(),
  });
};

export interface SeedWorkspaceInput {
  workspaceId: string;
  ownerId: string;
  name: string;
  type: 'PF' | 'PJ';
  extra?: Record<string, unknown>;
}

export const seedWorkspaceDocument = async (input: SeedWorkspaceInput) => {
  const db = adminSdk().firestore();
  const previous = (await db.doc(`workspaces/${input.workspaceId}`).get()).data();
  const adjustOwned = async (uid: string, delta: number) => {
    await seedAccountBillingState(uid);
    await db.doc(`billing_accounts/${uid}/quota_state/ownership`).update({
      activeOwnedWorkspaces: admin.firestore.FieldValue.increment(delta),
      updatedAt: now(),
    });
  };
  if (previous?.status === 'active' && typeof previous.ownerId === 'string') {
    await adjustOwned(previous.ownerId, -1);
  }
  await adjustOwned(input.ownerId, 1);
  await db.doc(`workspaces/${input.workspaceId}/quota_state/membership`).create({
    workspaceId: input.workspaceId,
    activeMembers: 0,
    pendingReservations: {},
    schemaVersion: QUOTA_SCHEMA_VERSION,
    updatedAt: now(),
  }).catch(ignoreAlreadyExists);
  await db.doc(`workspaces/${input.workspaceId}`).set({
    name: input.name,
    type: input.type,
    ownerId: input.ownerId,
    status: 'active',
    currency: 'BRL',
    cnpj: null,
    createdBy: input.ownerId,
    createdAt: now(),
    updatedAt: now(),
    ...(input.extra ?? {}),
  });
};

export const seedMembership = async (input: {
  workspaceId: string;
  uid: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  name: string;
  type: 'PF' | 'PJ';
  /**
   * Instante de entrada explícito. A listagem ordena por `joinedAt`; quem
   * depende de qual workspace aparece primeiro fixa a ordem aqui, em vez de
   * confiar no relógio do servidor entre gravações seguidas.
   */
  joinedAt?: Date;
}) => {
  const db = adminSdk().firestore();
  const joinedAt = input.joinedAt ? admin.firestore.Timestamp.fromDate(input.joinedAt) : now();
  const wasActive = (await db.doc(`workspaces/${input.workspaceId}/members/${input.uid}`).get())
    .get('status') === 'active';
  if (!wasActive) {
    await db.doc(`workspaces/${input.workspaceId}/quota_state/membership`).set({
      workspaceId: input.workspaceId,
      activeMembers: admin.firestore.FieldValue.increment(1),
      schemaVersion: QUOTA_SCHEMA_VERSION,
      updatedAt: now(),
    }, { merge: true });
  }
  await Promise.all([
    db.doc(`workspaces/${input.workspaceId}/members/${input.uid}`).set({
      uid: input.uid,
      role: input.role,
      status: 'active',
      email: input.email.toLowerCase(),
      displayName: input.email,
      photoURL: null,
      invitedBy: null,
      joinedAt,
      updatedAt: now(),
      removedAt: null,
      removedBy: null,
    }),
    db.doc(`users/${input.uid}/workspaces/${input.workspaceId}`).set({
      workspaceId: input.workspaceId,
      status: 'active',
      name: input.name,
      type: input.type,
      workspaceStatus: 'active',
      joinedAt,
      updatedAt: now(),
    }),
  ]);
};

/** Conta + workspace + owner, na forma exata do backend. */
export const seedOwnedWorkspace = async (input: SeedAccountInput & {
  workspaceId: string;
  name: string;
  type: 'PF' | 'PJ';
  extra?: Record<string, unknown>;
  joinedAt?: Date;
}) => {
  await seedAccountProfile(input);
  await seedWorkspaceDocument({
    workspaceId: input.workspaceId,
    ownerId: input.uid,
    name: input.name,
    type: input.type,
    extra: input.extra,
  });
  await seedMembership({
    workspaceId: input.workspaceId,
    uid: input.uid,
    email: input.email,
    role: 'owner',
    name: input.name,
    type: input.type,
    joinedAt: input.joinedAt,
  });
};

export const issueInviteTokenForE2E = async (
  workspaceId: string,
  inviteId: string,
): Promise<string> => {
  const db = adminSdk().firestore();
  const invite = await db.doc(`workspaces/${workspaceId}/invites/${inviteId}`).get();
  if (!invite.exists) throw new Error('Convite inexistente no Emulator.');
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  await db.doc(`invite_tokens/${hash}`).create({
    workspaceId,
    inviteId,
    createdAt: now(),
    expiresAt: invite.get('expiresAt'),
  });
  return token;
};
