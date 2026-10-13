import { createRequire } from 'node:module';
import { expect, type Page } from '@playwright/test';

import { db, today } from './loans';
import { adminSdk, defaultCashAccountIdFor } from './workspaceSeed';

/**
 * Apoio dos E2E de Recorrentes (P4-B, D-12), só no Emulator (Auth, Firestore
 * e Functions reais). A interface usa as callables `createRecurringExpense`,
 * `updateRecurringExpense`, `pauseRecurringExpense`, `resumeRecurringExpense`,
 * `cancelRecurringExpense`, `confirmRecurringOccurrence`,
 * `ignoreRecurringOccurrence` e `retryRecurringOccurrence`; os testes leem o
 * resultado pelo Admin SDK e nunca escrevem nas coleções do domínio por fora.
 *
 * O vencimento exige o tempo passar e o agendador do Emulator não dispara
 * (sem Pub/Sub). Para isso o arranjo chama o próprio código do backend (o
 * `lib` compilado que o emulador de Functions carrega, com o Admin SDK) —
 * a criação com o relógio injetado e a rotina real de geração com a data de
 * hoje. Nada é gravado à mão: o estado vem das mesmas operações
 * transacionais que as callables executam.
 */
type Doc = Record<string, any> & { id: string };

const require = createRequire(import.meta.url);

interface Actor { uid: string; workspaceId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }
interface Clock { now: () => number }

interface RecurringBackend {
  executeCreateRecurringExpense: (actor: Actor, payload: Record<string, unknown>, requestId: string, options?: Clock) =>
    Promise<{ recurringExpenseId: string; nextDueDate: string }>;
  runRecurringGeneration: (options: { today?: string; requestId?: string }) =>
    Promise<{ processed: number; generated: number; awaitingConfirmation: number; attentionRequired: number }>;
}

let backend: RecurringBackend | null = null;

/** Operações do backend compiladas (`functions/lib`), no mesmo Admin SDK. */
const recurringBackend = (): RecurringBackend => {
  adminSdk();
  if (!backend) {
    backend = {
      ...require('../../functions/lib/recurring/contractOperations.js'),
      ...require('../../functions/lib/recurring/scheduler.js'),
    } as RecurringBackend;
  }
  return backend;
};

/** Meio-dia em São Paulo (15:00Z) do dia informado, como nas integrações. */
const clockAt = (day: string): Clock => ({ now: () => Date.parse(`${day}T15:00:00.000Z`) });

/**
 * Categoria de despesa do catálogo (P5-C1, D-37.8): o contrato recorrente
 * guarda o vínculo por ID, e o backend confere grupo, subtipo e estado do item.
 * Gravada no formato autoritativo do catálogo (`schemaVersion` 1).
 */
export const RECURRING_CATEGORY = { id: 'e2e-rec-expense-category', name: 'Contas fixas E2E' } as const;

const catalogName = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

export const seedRecurringCategory = async (workspaceId: string, ownerUid: string): Promise<void> => {
  const now = new Date();
  const normalizedName = catalogName(RECURRING_CATEGORY.name);
  await db().doc(`workspaces/${workspaceId}/settings_catalog/${RECURRING_CATEGORY.id}`).set({
    id: RECURRING_CATEGORY.id, schemaVersion: 1, workspaceId, group: 'category',
    name: RECURRING_CATEGORY.name, normalizedName, transactionSubtype: 'despesa',
    dedupeKey: `category::despesa::both::${normalizedName}`,
    workspaceScope: 'both', sortOrder: 1, status: 'active',
    createdBy: ownerUid, updatedBy: ownerUid, createdAt: now, updatedAt: now,
  });
};

let sequence = 0;
const nextKey = (label: string) => `e2e-rec-${label}-${Date.now().toString(36)}-${sequence += 1}`;

/**
 * Contrato pelo backend (arranjo), criado "ontem" com início ontem e
 * vencimento semanal: o primeiro vencimento (ontem) já foi alcançado e a
 * rotina de hoje o processa. Padrão: Pix na conta padrão, automático.
 */
export const createRecurringFor = async (
  actor: { uid: string; workspaceId: string; role?: Actor['role'] },
  overrides: Record<string, unknown> = {},
  createdOn = yesterday(),
): Promise<string> => {
  await seedRecurringCategory(actor.workspaceId, actor.uid);
  const result = await recurringBackend().executeCreateRecurringExpense(
    { uid: actor.uid, workspaceId: actor.workspaceId, role: actor.role ?? 'owner' },
    {
      workspaceId: actor.workspaceId,
      idempotencyKey: nextKey('contract'),
      name: 'Recorrência Arranjo',
      type: 'subscription',
      description: null,
      amountCents: 4_990,
      frequency: 'weekly',
      billingDay: null,
      startDate: createdOn,
      endDate: null,
      paymentMethod: 'pix',
      executionMode: 'automatic',
      cardId: null,
      cashAccountId: defaultCashAccountIdFor(actor.workspaceId),
      categoryId: RECURRING_CATEGORY.id,
      visual: { color: '#4f46e5', icon: 'Repeat', emoji: null },
      business: null,
      ...overrides,
    },
    nextKey('req'),
    clockAt(createdOn),
  );
  return result.recurringExpenseId;
};

/** A rotina real de geração (o agendador do Emulator não dispara). */
export const runRecurringToday = async () =>
  recurringBackend().runRecurringGeneration({ today: today(), requestId: nextKey('generation') });

export const yesterday = (): string => {
  const [year, month, day] = today().split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

const listOf = async (workspaceId: string, collection: string): Promise<Doc[]> =>
  (await db().collection(`workspaces/${workspaceId}/${collection}`).get())
    .docs.map((doc) => ({ id: doc.id, ...doc.data() }));

export const recurringExpensesOf = (workspaceId: string) => listOf(workspaceId, 'recurring_expenses');
export const occurrencesOf = (workspaceId: string) => listOf(workspaceId, 'recurring_occurrences');
export const recurringEventsOf = (workspaceId: string) => listOf(workspaceId, 'recurring_events');

export const recurringDoc = async (workspaceId: string, id: string): Promise<Record<string, any>> =>
  (await db().doc(`workspaces/${workspaceId}/recurring_expenses/${id}`).get()).data() ?? {};

export const openRecurring = async (page: Page, type: 'PF' | 'PJ' = 'PF') => {
  await page.getByRole('link', { name: type === 'PJ' ? /Contratos & Recorrências/ : /Assinaturas/ }).first().click();
  await expect(page.getByRole('heading', {
    name: type === 'PJ' ? 'Contratos & Recorrências' : 'Gastos Recorrentes', level: 2,
  })).toBeVisible({ timeout: 20_000 });
};

export const openRecurringDetails = async (page: Page, name: string) => {
  await page.getByRole('button', { name: `Detalhes da assinatura ${name}` }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible({ timeout: 20_000 });
};
