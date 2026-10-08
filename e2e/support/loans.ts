import { expect, type APIRequestContext, type Browser, type Page, type Request } from '@playwright/test';

import { callCallable, emulatorIdToken } from './callables';
import {
  adminSdk,
  defaultCashAccountIdFor,
  seedAccountProfile,
  seedMembership,
  seedOwnedWorkspace,
  seedPaidPlan,
} from './workspaceSeed';

/**
 * Apoio dos E2E de empréstimos (P3-H), só no Emulator (Auth, Firestore e
 * Functions reais). A interface usa as callables `createLoan`,
 * `registerLoanPayment`, `reverseLoanMovement`, `cancelLoan` e
 * `updateLoanMetadata`; os testes leem o resultado pelo Admin SDK, sem
 * escrever nada em `loans`/`loan_movements` por fora (exceto a troca de papel
 * de um membro, que é o cenário de perda de autorização).
 */
export const PASSWORD = 'e2e-password-123456';

export interface LoanTenant {
  workspaceId: string;
  name: string;
  type: 'PF' | 'PJ';
  owner: { uid: string; email: string };
  member: { uid: string; email: string };
  otherMember: { uid: string; email: string };
  viewer: { uid: string; email: string };
}

export const db = () => adminSdk().firestore();

export const dayKey = (offsetDays = 0): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(Date.now() + offsetDays * 86_400_000));
export const today = () => dayKey(0);

export const addMonths = (key: string, months: number): string => {
  const [year, month, day] = key.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
};

export const resetEmulatorData = async () => {
  const sdk = adminSdk();
  const users = await sdk.auth().listUsers(1000);
  if (users.users.length > 0) await sdk.auth().deleteUsers(users.users.map((user) => user.uid));
  const collections = await sdk.firestore().listCollections();
  await Promise.all(collections.map((collection) => sdk.firestore().recursiveDelete(collection)));
};

export const seedLoanTenant = async (type: 'PF' | 'PJ', prefix: string): Promise<LoanTenant> => {
  const person = (role: string) => ({
    uid: `e2e-${prefix}-${role}`,
    email: `e2e-${prefix}-${role}@minhas-financas.local`,
  });
  const tenant: LoanTenant = {
    // ID único por teste: a limpeza do Emulator apaga os espelhos do teste
    // anterior e o gatilho da projeção processa essas exclusões depois; com o
    // mesmo ID, os deltas negativos cairiam no mês do teste seguinte.
    workspaceId: `e2e-${prefix}-ws-${Date.now().toString(36)}`,
    name: type === 'PJ' ? 'Empresa Empréstimos E2E' : 'Empréstimos PF E2E',
    type,
    owner: person('owner'),
    member: person('member'),
    otherMember: person('member-b'),
    viewer: person('viewer'),
  };
  for (const account of [tenant.owner, tenant.member, tenant.otherMember, tenant.viewer]) {
    await adminSdk().auth().createUser({ ...account, password: PASSWORD, emailVerified: true });
  }
  await seedOwnedWorkspace({ ...tenant.owner, workspaceId: tenant.workspaceId, name: tenant.name, type });
  await seedPaidPlan(tenant.owner.uid, 'business');
  for (const [account, role] of [
    [tenant.member, 'member'], [tenant.otherMember, 'member'], [tenant.viewer, 'viewer'],
  ] as const) {
    await seedAccountProfile(account);
    await seedMembership({
      workspaceId: tenant.workspaceId, uid: account.uid, email: account.email, role,
      name: tenant.name, type,
    });
  }
  return tenant;
};

export const login = async (page: Page, email: string) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
};

/** Página nova (contexto próprio) já autenticada como outro usuário. */
export const pageAs = async (browser: Browser, email: string): Promise<Page> => {
  const context = await browser.newContext({ timezoneId: 'America/Sao_Paulo' });
  const page = await context.newPage();
  await login(page, email);
  return page;
};

export const openLoans = async (page: Page, type: 'PF' | 'PJ') => {
  await page.getByRole('link', { name: type === 'PJ' ? /Empréstimos Corp\./ : /^Empréstimos$/ }).click();
  await expect(page.getByRole('heading', { name: type === 'PJ' ? /Empréstimos & Financiamentos/ : /^Empréstimos$/ }))
    .toBeVisible({ timeout: 20_000 });
};

export const dialogNamed = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name });

export const callablePosts = (page: Page, name: string): Request[] => {
  const posts: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(`/${name}`)) posts.push(request);
  });
  return posts;
};

export const bodyOf = (request: Request): Record<string, unknown> =>
  (JSON.parse(request.postData() ?? '{}') as { data: Record<string, unknown> }).data;

type Doc = Record<string, any> & { id: string };

export const loansOf = async (workspaceId: string): Promise<Doc[]> =>
  (await db().collection(`workspaces/${workspaceId}/loans`).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));

export const loanDoc = async (workspaceId: string, loanId: string): Promise<Record<string, any>> =>
  (await db().doc(`workspaces/${workspaceId}/loans/${loanId}`).get()).data() ?? {};

export const movementsOf = async (workspaceId: string, loanId: string): Promise<Doc[]> =>
  (await db().collection(`workspaces/${workspaceId}/loan_movements`).where('loanId', '==', loanId).get())
    .docs.map((doc) => ({ id: doc.id, ...doc.data() }));

export const transactionsOf = async (workspaceId: string): Promise<Doc[]> =>
  (await db().collection(`workspaces/${workspaceId}/transactions`).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));

/** Projeção oficial do mês (gatilho real das Functions no Emulator). */
export const cashPeriod = async (workspaceId: string, monthKey = today().slice(0, 7)): Promise<Record<string, any>> =>
  (await db().doc(`workspaces/${workspaceId}/cash_report_periods/${monthKey}`).get()).data() ?? {};

export const tokenOf = (request: APIRequestContext, email: string) => emulatorIdToken(request, email, PASSWORD);

let keySequence = 0;
export const intentKey = (label: string) => `e2e-${label}-${Date.now().toString(36)}-${keySequence += 1}`;

/** Contratação pela callable real (atalho de preparação; a tela é testada à parte). */
export const createLoanByApi = async (
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const outcome = await callCallable(request, token, 'createLoan', {
    workspaceId,
    idempotencyKey: intentKey('create'),
    type: 'borrow',
    personName: 'Banco Exemplo',
    principalCents: 300_000,
    cashAccountId: defaultCashAccountIdFor(workspaceId),
    startDate: today(),
    firstDueDate: addMonths(today(), 1),
    installments: 3,
    interest: { type: 'none' },
    ...overrides,
  });
  expect(outcome.status, JSON.stringify(outcome)).toBe(200);
  return String(outcome.result?.loanId);
};

/** Abre o detalhe do contrato pelo cartão da lista. */
export const openLoanByCounterparty = async (page: Page, counterparty: string) => {
  await page.getByRole('heading', { name: counterparty, level: 3 }).first().click();
  await expect(page.getByRole('heading', { name: counterparty, level: 1 })).toBeVisible({ timeout: 20_000 });
};

export const summaryFigure = (page: Page, title: 'Saldo Atual') =>
  page.getByRole('figure').filter({ has: page.getByRole('heading', { name: title }) });

export const summaryCard = (page: Page, title: 'Receitas' | 'Despesas') =>
  page.getByRole('button', { name: new RegExp(`^${title}\\s+R\\$`) });

export const brl = (cents: number) =>
  new RegExp(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(cents / 100).replace(/\s/g, '\\s*').replace(/\$/g, '\\$').replace(/\./g, '\\.'));
