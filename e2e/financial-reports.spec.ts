import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { callCallable, emulatorIdToken } from './support/callables';
import { createAccountByApi } from './support/accounts';
import { dayKey, intentKey, today } from './support/loans';
import {
  adminSdk,
  defaultCashAccountIdFor,
  saoPauloMonthKey,
  seedAccountProfile,
  seedMembership,
  seedOwnedWorkspace,
} from './support/workspaceSeed';

/**
 * P5-C1 — relatórios financeiros oficiais, de ponta a ponta no Emulator.
 *
 * Dashboard e Relatórios leem a MESMA callable `getFinancialReport` (Functions
 * reais, Firestore e Auth do Emulator). Os dados são semeados pelos caminhos
 * reais: perfis/workspaces/catálogo pelo Admin SDK no formato do backend e
 * lançamentos/contas pelas callables autoritativas. Nada aqui calcula o
 * relatório no cliente nem o substitui por mock: o único `page.route` é a
 * simulação de falha técnica de rede no teste de estado de erro.
 *
 * Os valores esperados vêm dos centavos semeados (e de um oráculo de janelas
 * civis de São Paulo escrito a partir da regra documentada em
 * `functions/src/reports/window.ts`), nunca da própria tela.
 */

test.use({ timezoneId: 'America/Sao_Paulo' });

const PASSWORD = 'e2e-password-123456';
const OWNER = { uid: 'e2e-p5c1-owner', email: 'e2e-p5c1-owner@minhas-financas.local' };
const OTHER = { uid: 'e2e-p5c1-other', email: 'e2e-p5c1-other@minhas-financas.local' };
const VIEWER = { uid: 'e2e-p5c1-viewer', email: 'e2e-p5c1-viewer@minhas-financas.local' };
// IDs únicos por teste (atribuídos em `seed`): a limpeza do Emulator apaga os
// lançamentos do teste anterior e o gatilho da projeção processa essas
// exclusões depois; com o mesmo ID de workspace, os deltas negativos cairiam
// no teste seguinte.
const WS_PF = { id: '', name: 'Casa Relatórios E2E' };
const WS_PJ = { id: '', name: 'Empresa Relatórios E2E' };
const WS_OTHER = { id: '', name: 'Outro Usuário E2E' };

const CATALOG = {
  incomeType: 'Salário Fixo P5C1',
  incomeCategory: 'Salário P5C1',
  incomeCategoryId: 'p5c1-income-category',
  incomeTypeId: 'p5c1-income-type',
  expenseType: 'Fixa P5C1',
  expenseCategory: 'Moradia P5C1',
  expenseCategoryId: 'p5c1-expense-category',
  expenseTypeId: 'p5c1-expense-type',
};

const db = () => adminSdk().firestore();

/** Texto de moeda como o Intl entrega (com NBSP), para procurar no DOM. */
const brlRaw = (cents: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
/** Mesmo texto com espaço comum, para as asserções do Playwright. */
const brl = (cents: number): string => brlRaw(cents).replace(/ /g, ' ');

const resetEmulatorData = async () => {
  const sdk = adminSdk();
  const users = await sdk.auth().listUsers(1000);
  if (users.users.length > 0) {
    await sdk.auth().deleteUsers(users.users.map((user) => user.uid));
  }
  const collections = await sdk.firestore().listCollections();
  await Promise.all(collections.map((collection) => sdk.firestore().recursiveDelete(collection)));
};

const normalize = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

const seedCatalog = async (workspaceId: string, ownerUid: string) => {
  const now = new Date();
  const items: Array<[string, string, string, string?]> = [
    [CATALOG.incomeTypeId, 'income_type', CATALOG.incomeType],
    [CATALOG.incomeCategoryId, 'category', CATALOG.incomeCategory, 'receita'],
    [CATALOG.expenseTypeId, 'expense_type', CATALOG.expenseType],
    [CATALOG.expenseCategoryId, 'category', CATALOG.expenseCategory, 'despesa'],
  ];
  await Promise.all(items.map(([id, group, name, transactionSubtype]) => {
    const normalizedName = normalize(name);
    return db().doc(`workspaces/${workspaceId}/settings_catalog/${id}`).set({
      id, schemaVersion: 1, workspaceId, group, name, normalizedName,
      ...(transactionSubtype ? { transactionSubtype } : {}),
      dedupeKey: `${group}::${transactionSubtype ?? 'all'}::both::${normalizedName}`,
      workspaceScope: 'both', sortOrder: 1, status: 'active',
      createdBy: ownerUid, updatedBy: ownerUid, createdAt: now, updatedAt: now,
    });
  }));
};

/**
 * Usuários, workspaces (PF e PJ do titular; PF de outro usuário) e catálogo.
 * Ordem de listagem por `joinedAt`: o PF do titular abre primeiro.
 */
const seed = async () => {
  await resetEmulatorData();
  const suffix = Date.now().toString(36);
  WS_PF.id = `e2e-p5c1-pf-${suffix}`;
  WS_PJ.id = `e2e-p5c1-pj-${suffix}`;
  WS_OTHER.id = `e2e-p5c1-other-${suffix}`;
  await Promise.all([OWNER, OTHER, VIEWER].map((user) => adminSdk().auth().createUser({
    uid: user.uid, email: user.email, password: PASSWORD, emailVerified: true,
  })));
  await seedOwnedWorkspace({
    ...OWNER, workspaceId: WS_PF.id, name: WS_PF.name, type: 'PF',
    joinedAt: new Date('2026-01-01T12:00:00Z'),
  });
  await seedOwnedWorkspace({
    ...OWNER, workspaceId: WS_PJ.id, name: WS_PJ.name, type: 'PJ',
    joinedAt: new Date('2026-02-01T12:00:00Z'),
  });
  await seedOwnedWorkspace({
    ...OTHER, workspaceId: WS_OTHER.id, name: WS_OTHER.name, type: 'PF',
  });
  await seedAccountProfile(VIEWER);
  await seedMembership({
    workspaceId: WS_PF.id, uid: VIEWER.uid, email: VIEWER.email, role: 'viewer',
    name: WS_PF.name, type: 'PF',
  });
  await Promise.all([
    seedCatalog(WS_PF.id, OWNER.uid),
    seedCatalog(WS_PJ.id, OWNER.uid),
    seedCatalog(WS_OTHER.id, OTHER.uid),
  ]);
};

const login = async (page: Page, email: string) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
};

/** Logout pela tela e login de outra conta na mesma página (sem recarregar). */
const switchAccount = async (page: Page, email: string) => {
  const url = new URL(page.url());
  url.searchParams.set('e2eEmail', email);
  url.searchParams.set('e2ePassword', PASSWORD);
  await page.evaluate((next) => window.history.replaceState(null, '', next), url.toString());
  await page.getByText('Sair', { exact: true }).first().click();
  await expect(page.getByTestId('e2e-login-button')).toBeVisible();
};

const loginAgain = async (page: Page) => {
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
};

// ------------------------------------------------------------------ semeadura

interface EntryInput {
  workspaceId: string;
  type: 'receita' | 'despesa';
  cents: number;
  date: string;
  description: string;
}

/** Lançamento confirmado pela callable autoritativa, com a categoria por ID. */
const createEntry = async (request: APIRequestContext, token: string, entry: EntryInput) => {
  const income = entry.type === 'receita';
  const outcome = await callCallable(request, token, 'createCashTransaction', {
    workspaceId: entry.workspaceId,
    idempotencyKey: intentKey('p5c1'),
    cashAccountId: defaultCashAccountIdFor(entry.workspaceId),
    type: entry.type,
    description: entry.description,
    categoryId: income ? CATALOG.incomeCategoryId : CATALOG.expenseCategoryId,
    ...(income ? { incomeType: CATALOG.incomeType } : { expenseType: CATALOG.expenseType }),
    amountCents: entry.cents,
    date: entry.date,
  });
  expect(outcome.status, JSON.stringify(outcome)).toBe(200);
};

const ownerToken = (request: APIRequestContext) =>
  emulatorIdToken(request, OWNER.email, PASSWORD);

/**
 * O caixa é projetado por gatilho assíncrono. Antes de abrir a tela, espera
 * pela própria callable (a fonte oficial) refletir os totais semeados, para
 * que a primeira leitura da tela não dependa da corrida com o gatilho.
 */
const waitForProjection = async (
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  expected: { receiptsCents: number; paymentsCents: number },
) => {
  await expect.poll(async () => {
    const outcome = await callCallable(request, token, 'getFinancialReport', {
      workspaceId, range: { kind: 'preset', preset: 'all' }, sections: ['cash'],
    });
    const cash = (outcome.result?.cash as { data?: { receiptsCents?: number; paymentsCents?: number } } | undefined)?.data;
    return `${cash?.receiptsCents ?? 'x'}|${cash?.paymentsCents ?? 'x'}`;
  }).toBe(`${expected.receiptsCents}|${expected.paymentsCents}`);
};

// ------------------------------------------------------------------- telas

/** Card do Dashboard pelo título. */
const dashCard = (page: Page, title: string): Locator =>
  page.locator('.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const dashValue = (page: Page, title: string): Locator => dashCard(page, title).locator('p').first();
const dashLegend = (page: Page, title: string): Locator => dashCard(page, title).locator('span').last();

/** KPI da Visão Geral dos Relatórios pelo rótulo. */
const kpiCard = (page: Page, label: string): Locator =>
  page.getByRole('tabpanel').locator('div.group').filter({ has: page.getByText(label, { exact: true }) });
const kpiValue = (page: Page, label: string): Locator => kpiCard(page, label).locator('h3');

const openReports = async (page: Page) => {
  await page.getByText(/^Relatórios( Empresariais)?$/).first().click();
  await expect(page.getByRole('tab', { name: 'Visão Geral' })).toBeVisible({ timeout: 30_000 });
};

const openDashboard = async (page: Page) => {
  await page.getByText('Dashboard', { exact: true }).first().click();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible();
};

const periodButton = (page: Page) => page.getByRole('button', { name: 'Selecionar período do relatório' });

const selectPeriod = async (page: Page, label: string, preset: string) => {
  const requested = page.waitForRequest((request) =>
    request.method() === 'POST'
    && request.url().endsWith('/getFinancialReport')
    && (request.postData() ?? '').includes(`"preset":"${preset}"`));
  await periodButton(page).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await requested;
  await expect(periodButton(page)).toContainText(label);
};

const switchWorkspace = async (page: Page, label: string, exact = false) => {
  await page.getByRole('button', { name: 'Abrir menu da conta' }).click();
  await page.getByRole('button', { name: label, exact }).first().click();
};

const horizontalOverflow = (page: Page) => page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);

// -------------------------------------------------- oráculo de janelas civis

type Preset = '7d' | '30d' | '90d' | '12m' | 'ytd' | 'all';

/**
 * Primeira data civil incluída (regra de `functions/src/reports/window.ts`,
 * escrita à parte aqui): 7/30/90 datas contando hoje; 12m = dia 1 do mês de
 * 11 meses atrás; ytd = 1º de janeiro; all = sem limite inferior.
 */
const windowStart = (preset: Preset): string | null => {
  const [year, month] = today().split('-').map(Number);
  switch (preset) {
    case '7d': return dayKey(-6);
    case '30d': return dayKey(-29);
    case '90d': return dayKey(-89);
    case '12m': {
      const index = year * 12 + (month - 1) - 11;
      return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
    }
    case 'ytd': return `${year}-01-01`;
    case 'all': return null;
  }
};

const inWindow = (date: string, preset: Preset): boolean => {
  const start = windowStart(preset);
  return (start === null || date >= start) && date <= today();
};

const totalsInWindow = (entries: Array<{ type: string; cents: number; date: string }>, preset: Preset) => {
  const inside = entries.filter((entry) => inWindow(entry.date, preset));
  const sum = (type: string) => inside.filter((entry) => entry.type === type)
    .reduce((total, entry) => total + entry.cents, 0);
  return { receipts: sum('receita'), payments: sum('despesa') };
};

test.beforeEach(async () => {
  await seed();
});

// ---------------------------------------------------------------------- 1. PF

test('PF: Dashboard e Relatórios mostram o mesmo caixa; Saldo Atual é a soma das contas', async ({ page, request }) => {
  const token = await ownerToken(request);
  await createEntry(request, token, {
    workspaceId: WS_PF.id, type: 'receita', cents: 150_000, date: today(), description: 'Salário do mês E2E',
  });
  await createEntry(request, token, {
    workspaceId: WS_PF.id, type: 'despesa', cents: 40_000, date: today(), description: 'Aluguel do mês E2E',
  });
  // Segunda conta com saldo inicial: entra no saldo, não é receita do período.
  await createAccountByApi(request, token, WS_PF.id, 'Reserva E2E', { openingBalanceCents: 25_000 });
  await waitForProjection(request, token, WS_PF.id, { receiptsCents: 150_000, paymentsCents: 40_000 });

  const reportCalls: string[] = [];
  page.on('request', (call) => {
    if (call.method() === 'POST' && call.url().endsWith('/getFinancialReport')) reportCalls.push(call.postData() ?? '');
  });

  await login(page, OWNER.email);

  // Dashboard: mês do seletor (atual). Saldo = soma das contas (150000 − 40000 + 25000).
  await expect(dashValue(page, 'Saldo Atual')).toHaveText(brl(135_000));
  await expect(dashLegend(page, 'Saldo Atual')).toHaveText('Em contas');
  await expect(dashValue(page, 'Receitas')).toHaveText(brl(150_000));
  await expect(dashValue(page, 'Despesas')).toHaveText(brl(40_000));
  await expect(dashValue(page, 'Investimentos')).toHaveText(brl(0));
  // A tela usou a callable oficial, com o intervalo mensal do seletor.
  expect(reportCalls.some((body) => body.includes(`"month":"${saoPauloMonthKey()}"`))).toBe(true);

  // Relatórios (30 dias por padrão): os mesmos números do Dashboard.
  await openReports(page);
  await expect(kpiValue(page, 'Receita Total')).toHaveText(brl(150_000));
  await expect(kpiValue(page, 'Despesa Total')).toHaveText(brl(40_000));
  await expect(kpiValue(page, 'Resultado operacional')).toHaveText(brl(110_000));
  expect(reportCalls.some((body) => body.includes('"preset":"30d"'))).toBe(true);

  // O saldo inicial da segunda conta não vira recebimento: o relatório do
  // período não pode somá-lo à receita.
  await expect(page.getByText(brl(175_000))).toHaveCount(0);

  // Gráficos: título do fluxo mensal do contrato novo.
  await page.getByRole('tab', { name: 'Gráficos' }).click();
  await expect(page.getByRole('heading', { name: 'Fluxo de Caixa Mensal' })).toBeVisible();
});

// ---------------------------------------------------------------------- 2. PJ

test('PJ: rótulos operacionais, margem em percentual pt-BR e sem Faturamento/Lucro', async ({ page, request }) => {
  const token = await ownerToken(request);
  await createEntry(request, token, {
    workspaceId: WS_PJ.id, type: 'receita', cents: 500_000, date: today(), description: 'Recebimento PJ E2E',
  });
  await createEntry(request, token, {
    workspaceId: WS_PJ.id, type: 'despesa', cents: 200_000, date: today(), description: 'Pagamento PJ E2E',
  });
  await waitForProjection(request, token, WS_PJ.id, { receiptsCents: 500_000, paymentsCents: 200_000 });

  await login(page, OWNER.email);
  await switchWorkspace(page, WS_PJ.name);
  await expect(page.getByText('Finanças da Empresa').first()).toBeVisible();
  await expect(dashValue(page, 'Receitas')).toHaveText(brl(500_000));

  await openReports(page);
  await expect(page.getByRole('heading', { name: 'Relatórios Empresariais' })).toBeVisible();
  await expect(kpiValue(page, 'Recebimentos operacionais realizados')).toHaveText(brl(500_000));
  // (500000 − 200000) ÷ 500000 = 60% → "60,00%" (duas casas, vírgula decimal).
  await expect(kpiValue(page, 'Margem operacional de caixa')).toHaveText('60,00%');
  await expect(kpiCard(page, 'Margem operacional de caixa')).toContainText(
    `Resultado operacional de caixa: ${brl(300_000)} · Pagamentos operacionais realizados: ${brl(200_000)}`,
  );
  await expect(page.getByText('Leitura dos indicadores').first()).toBeVisible();
  await expect(page.getByText('Principais categorias de despesa').first()).toBeVisible();

  const body = page.locator('body');
  await expect(body).not.toContainText(/Faturamento|Lucro/);
  await page.getByRole('tab', { name: 'Gráficos' }).click();
  await expect(page.getByRole('heading', { name: 'Evolução de Recebimentos x Pagamentos Operacionais' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Top 5 Clientes por Valor de Recebíveis' })).toBeVisible();
  await expect(body).not.toContainText(/Faturamento|Lucro/);
  // Rótulos substituídos não podem sobreviver em nenhuma das duas abas.
  for (const old of ['Insight Financeiro IA', 'Principais Centros de Custo', 'Fluxo de Caixa (6 Meses)', 'Top 5 Clientes por Faturamento']) {
    await expect(body).not.toContainText(old);
  }
});

// ------------------------------------------------------------------ 3. filtros

test('Relatórios: cada filtro de período reflete a janela civil correta', async ({ page, request }) => {
  const token = await ownerToken(request);
  const entries = [
    { type: 'receita' as const, cents: 1_000, date: dayKey(0), description: 'Receita hoje' },
    { type: 'despesa' as const, cents: 300, date: dayKey(0), description: 'Despesa hoje' },
    // Fora dos 7 dias (hoje − 6 é o limite), dentro dos 30.
    { type: 'receita' as const, cents: 20_000, date: dayKey(-8), description: 'Receita há 8 dias' },
    { type: 'despesa' as const, cents: 5_000, date: dayKey(-8), description: 'Despesa há 8 dias' },
    // Fora dos 30, dentro dos 3 meses.
    { type: 'receita' as const, cents: 300_000, date: dayKey(-40), description: 'Receita há 40 dias' },
    // Dentro de 12 meses.
    { type: 'receita' as const, cents: 4_000_000, date: dayKey(-150), description: 'Receita há 150 dias' },
    // Só em "todo o período" (mais de um ano atrás).
    { type: 'receita' as const, cents: 50_000_000, date: dayKey(-400), description: 'Receita há 400 dias' },
  ];
  for (const entry of entries) {
    await createEntry(request, token, { workspaceId: WS_PF.id, ...entry });
  }
  await waitForProjection(request, token, WS_PF.id, {
    receiptsCents: totalsInWindow(entries, 'all').receipts,
    paymentsCents: totalsInWindow(entries, 'all').payments,
  });

  await login(page, OWNER.email);
  await openReports(page);

  // O padrão da tela é 30 dias (já carregado ao abrir); os demais são escolhidos.
  const periods: Array<[Preset, string]> = [
    ['30d', 'Últimos 30 dias'],
    ['7d', 'Últimos 7 dias'],
    ['90d', 'Últimos 3 meses'],
    ['12m', 'Último Ano'],
    ['ytd', 'Ano Atual (YTD)'],
    ['all', 'Todo o Período'],
  ];
  for (const [preset, label] of periods) {
    // Padrão da tela é 30d: já carregado, a primeira leitura é a da abertura.
    if (preset !== '30d') await selectPeriod(page, label, preset);
    const expected = totalsInWindow(entries, preset);
    await expect(kpiValue(page, 'Receita Total'), `${preset}: receitas`).toHaveText(brl(expected.receipts));
    await expect(kpiValue(page, 'Despesa Total'), `${preset}: despesas`).toHaveText(brl(expected.payments));
    await expect(kpiValue(page, 'Resultado operacional'), `${preset}: resultado`)
      .toHaveText(brl(expected.receipts - expected.payments));
  }

  // Âncoras semânticas, independentes do oráculo: o lançamento de 8 dias atrás
  // fica fora dos 7 dias e dentro dos 30; o de 400 dias só em "todo o período".
  expect(inWindow(dayKey(-8), '7d')).toBe(false);
  expect(inWindow(dayKey(-8), '30d')).toBe(true);
  expect(inWindow(dayKey(-40), '30d')).toBe(false);
  expect(inWindow(dayKey(-40), '90d')).toBe(true);
  expect(inWindow(dayKey(-400), '12m')).toBe(false);
  expect(totalsInWindow(entries, '7d').receipts).toBe(1_000);
  expect(totalsInWindow(entries, '30d').receipts).toBe(21_000);
  expect(totalsInWindow(entries, 'all').receipts).toBe(54_321_000);
});

// --------------------------------------------- 4. troca de workspace e usuário

/**
 * Observador de vazamento (roda em toda carga, antes do app): registra quando
 * um texto proibido aparece enquanto a condição da regra vale.
 */
const installLeakObserver = async (page: Page) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      __leakRules: Array<{ forbidden: string[]; whenPresent?: string; whenAbsent?: string }>;
      __leaks: string[];
    };
    state.__leakRules = [];
    state.__leaks = [];
    const check = () => {
      const text = document.body?.textContent ?? '';
      for (const rule of state.__leakRules) {
        if (rule.whenPresent && !text.includes(rule.whenPresent)) continue;
        if (rule.whenAbsent && text.includes(rule.whenAbsent)) continue;
        for (const marker of rule.forbidden) {
          if (text.includes(marker)) state.__leaks.push(marker);
        }
      }
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
  });
};

const armLeakRules = (
  page: Page,
  rules: Array<{ forbidden: string[]; whenPresent?: string; whenAbsent?: string }>,
) => page.evaluate((next) => {
  (window as unknown as { __leakRules: unknown }).__leakRules = next;
}, rules);

const leaks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __leaks: string[] }).__leaks);

test('troca de workspace e de usuário não deixa números do contexto anterior na tela', async ({ page, request }) => {
  const token = await ownerToken(request);
  const otherToken = await emulatorIdToken(request, OTHER.email, PASSWORD);
  await createEntry(request, token, {
    workspaceId: WS_PF.id, type: 'receita', cents: 70_000, date: today(), description: 'Receita PF privada E2E',
  });
  await createEntry(request, token, {
    workspaceId: WS_PJ.id, type: 'receita', cents: 910_000, date: today(), description: 'Receita PJ privada E2E',
  });
  await createEntry(request, otherToken, {
    workspaceId: WS_OTHER.id, type: 'receita', cents: 330_000, date: today(), description: 'Receita do outro usuário E2E',
  });
  await waitForProjection(request, token, WS_PF.id, { receiptsCents: 70_000, paymentsCents: 0 });
  await waitForProjection(request, token, WS_PJ.id, { receiptsCents: 910_000, paymentsCents: 0 });
  await waitForProjection(request, otherToken, WS_OTHER.id, { receiptsCents: 330_000, paymentsCents: 0 });

  await installLeakObserver(page);
  await login(page, OWNER.email);
  await expect(dashValue(page, 'Receitas')).toHaveText(brl(70_000));
  await openReports(page);
  await expect(kpiValue(page, 'Receita Total')).toHaveText(brl(70_000));
  await openDashboard(page);

  // PF → PJ do mesmo usuário: depois que o cabeçalho é o da empresa, nenhum
  // número nem lançamento do PF pode aparecer.
  await armLeakRules(page, [{
    whenPresent: 'Finanças da Empresa',
    forbidden: [brlRaw(70_000), 'Receita PF privada E2E'],
  }]);
  await switchWorkspace(page, WS_PJ.name);
  await expect(page.getByText('Finanças da Empresa').first()).toBeVisible();
  await expect(dashValue(page, 'Receitas')).toHaveText(brl(910_000));
  await expect(page.getByText('Receita PJ privada E2E').first()).toBeVisible();
  await openReports(page);
  await expect(kpiValue(page, 'Recebimentos operacionais realizados')).toHaveText(brl(910_000));
  expect(await leaks(page)).toEqual([]);

  // PJ → PF, agora dentro dos Relatórios: nada do PJ sobrevive.
  await armLeakRules(page, [{
    whenAbsent: 'Finanças da Empresa',
    forbidden: [brlRaw(910_000), 'Receita PJ privada E2E', 'Recebimentos operacionais realizados'],
  }]);
  await switchWorkspace(page, 'Pessoal', true);
  await expect(page.getByText('Finanças da Empresa')).toHaveCount(0);
  await expect(kpiValue(page, 'Receita Total')).toHaveText(brl(70_000));
  expect(await leaks(page)).toEqual([]);
  await armLeakRules(page, []);

  // Outro usuário, mesma página: depois do logout a tela não tem conteúdo do
  // titular; nada dele pode reaparecer no login seguinte.
  await switchAccount(page, OTHER.email);
  await armLeakRules(page, [{
    forbidden: [
      brlRaw(70_000), brlRaw(910_000), 'Receita PF privada E2E', 'Receita PJ privada E2E',
      'Recebimentos operacionais realizados',
    ],
  }]);
  await loginAgain(page);
  await expect(dashValue(page, 'Receitas')).toHaveText(brl(330_000));
  await openReports(page);
  await expect(kpiValue(page, 'Receita Total')).toHaveText(brl(330_000));
  await expect(page.getByText('Finanças da Empresa')).toHaveCount(0);
  expect(await leaks(page)).toEqual([]);

  // De volta ao titular: o cache é por usuário/workspace, os números dele voltam.
  await armLeakRules(page, []);
  await switchAccount(page, OWNER.email);
  await armLeakRules(page, [{
    forbidden: [brlRaw(330_000), 'Receita do outro usuário E2E'],
  }]);
  await loginAgain(page);
  await expect(dashValue(page, 'Receitas')).toHaveText(brl(70_000));
  expect(await leaks(page)).toEqual([]);
});

// ------------------------------------------------- 4b. faturas de cartão

/** Mês `AAAA-MM` deslocado (aritmética sobre a chave, sem fuso). */
const shiftMonthKey = (month: string, delta: number): string => {
  const [year, number] = month.split('-').map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};

/**
 * Fatura no formato oficial da P4-A (`credit_card_invoices/{cardId}_{AAAA-MM}`),
 * gravada pelo Admin SDK: com o relógio real, a regra D-36 não deixa lançar em
 * fatura já fechada, então a vencida é semeada direto no estado persistido.
 */
const seedInvoice = async (workspaceId: string, cardId: string, input: {
  competenceMonth: string; closingDate: string; dueDate: string;
  cycleStatus: 'open' | 'closed'; totalCents: number;
}) => {
  await db().doc(`workspaces/${workspaceId}/credit_card_invoices/${cardId}_${input.competenceMonth}`).set({
    schemaVersion: 1, workspaceId, cardId, ...input,
    paymentStatus: 'unpaid', paidCents: 0, remainingCents: input.totalCents,
    activeEntryCount: 1, revision: 1, updatedAt: adminSdk().firestore.Timestamp.now(),
  });
};

test('cartões: atraso, próxima fatura a pagar e futuro separados e reconciliáveis; sem fatura a vencer não vira R$ 0,00; arquivado com saldo aparece marcado', async ({ page, request }) => {
  const token = await ownerToken(request);
  const createCard = async (name: string) => {
    const outcome = await callCallable(request, token, 'createCreditCard', {
      workspaceId: WS_PF.id, idempotencyKey: intentKey('p5c11-card'), name, brand: 'Visa',
      closingDay: 25, dueDay: 5, limitTotalCents: 500_000,
      visual: {
        bgType: 'color', bgColor: '#1e293b', bgGradientColor: null, bgImage: null,
        textColor: 'white', showName: true, showBrand: true, showLogo: true,
      },
    });
    expect(outcome.status, JSON.stringify(outcome)).toBe(200);
    return String(outcome.result?.cardId);
  };
  const cardId = await createCard('Cartão Faturas E2E');
  await createCard('Cartão Sem Fatura E2E');
  const archivedId = await createCard('Cartão Arquivado E2E');
  // Competência corrente (fechamento no dia 25, vencimento no dia 5).
  const day = Number(today().slice(8, 10));
  const current = day < 25 ? today().slice(0, 7) : shiftMonthKey(today().slice(0, 7), 1);
  const invoice = (competence: string, cycleStatus: 'open' | 'closed', totalCents: number) => ({
    competenceMonth: competence,
    closingDate: `${competence}-25`,
    dueDate: `${shiftMonthKey(competence, 1)}-05`,
    cycleStatus,
    totalCents,
  });
  // Mesma conta de cartão: antiga vencida 100, corrente 300, futura 200.
  await seedInvoice(WS_PF.id, cardId, invoice(shiftMonthKey(current, -2), 'closed', 10_000));
  await seedInvoice(WS_PF.id, cardId, invoice(current, 'open', 30_000));
  await seedInvoice(WS_PF.id, cardId, invoice(shiftMonthKey(current, 1), 'open', 20_000));
  await db().doc(`workspaces/${WS_PF.id}/credit_cards/${cardId}`).update({
    limitUsedCents: 60_000, limitAvailableCents: 440_000,
  });
  // Cartão arquivado que voltou a dever (estorno de pagamento depois do
  // arquivamento, aceito pela P4-A): vencida de 50.
  await seedInvoice(WS_PF.id, archivedId, invoice(shiftMonthKey(current, -2), 'closed', 5_000));
  await db().doc(`workspaces/${WS_PF.id}/credit_cards/${archivedId}`).update({
    status: 'archived', archivedAt: adminSdk().firestore.Timestamp.now(),
    limitUsedCents: 5_000, limitAvailableCents: 495_000,
  });

  await login(page, OWNER.email);
  await openReports(page);
  const tile = (label: string) => page.locator('div.rounded-xl').filter({ has: page.getByText(label, { exact: true }) });
  await expect(tile('Próximas faturas a pagar')).toContainText(brl(30_000));
  await expect(tile('Futuro comprometido')).toContainText(brl(20_000));
  await expect(tile('Em atraso')).toContainText(brl(15_000));

  const row = page.getByRole('row').filter({ hasText: 'Cartão Faturas E2E' });
  const cells = row.getByRole('cell');
  await expect(cells.nth(3)).toHaveText(brl(30_000));
  await expect(cells.nth(4)).toHaveText(brl(20_000));
  await expect(cells.nth(5)).toHaveText(brl(10_000));
  // O vencimento exibido é o da próxima fatura a pagar, nunca o da vencida; o
  // ciclo ainda aberto é dito como tal.
  const [dueYear, dueMonth] = shiftMonthKey(current, 1).split('-');
  await expect(row).toContainText(`Vence em 05/${dueMonth}/${dueYear} · fatura do ciclo aberto`);
  await expect(page.getByRole('columnheader', { name: 'Próxima fatura a pagar' })).toBeVisible();
  await expect(page.getByText('Vencimento atual')).toHaveCount(0);

  const empty = page.getByRole('row').filter({ hasText: 'Cartão Sem Fatura E2E' });
  await expect(empty).toContainText('Sem fatura a vencer');
  await expect(empty.getByRole('cell').nth(3)).toHaveText('—');
  await expect(empty.getByRole('cell').nth(3)).not.toContainText('R$');

  // Σ das linhas fecha com os quadros: o atraso do arquivado tem linha própria.
  const archived = page.getByRole('row').filter({ hasText: 'Cartão Arquivado E2E' });
  await expect(archived).toContainText('Cartão arquivado · Sem fatura a vencer');
  const archivedCells = archived.getByRole('cell');
  await expect(archivedCells.nth(1)).toHaveText('—');
  await expect(archivedCells.nth(2)).toHaveText('—');
  await expect(archivedCells.nth(3)).toHaveText('—');
  await expect(archivedCells.nth(4)).toHaveText(brl(0));
  await expect(archivedCells.nth(5)).toHaveText(brl(5_000));

  // Gráficos, "Por cartão": a coluna "Em atraso" traz o atraso do cartão ativo;
  // o arquivado fica fora da tabela de consumo, com a nota de reconciliação.
  await page.getByRole('tab', { name: 'Gráficos' }).click();
  await page.getByRole('button', { name: 'Por cartão' }).click();
  await expect(page.getByRole('columnheader', { name: 'Próxima fatura a pagar' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Em atraso' })).toBeVisible();
  const chartRow = page.getByRole('row').filter({ hasText: 'Cartão Faturas E2E' });
  const chartCells = chartRow.getByRole('cell');
  await expect(chartCells.nth(3)).toHaveText(brl(30_000));
  await expect(chartCells.nth(4)).toHaveText(brl(20_000));
  await expect(chartCells.nth(5)).toHaveText(brl(10_000));
  await expect(page.getByRole('row').filter({ hasText: 'Cartão Arquivado E2E' })).toHaveCount(0);
  await expect(page.getByText(`Não inclui ${brl(5_000)} em atraso de cartões arquivados, exibidos na Visão Geral.`)).toBeVisible();
});

// -------------------------------------------------------------------- 5. estados

test.describe('estados do relatório', () => {
  test('zero verdadeiro: sem movimento mostra R$ 0,00 e "Sem movimentação no período."', async ({ page }) => {
    await login(page, OWNER.email);
    for (const title of ['Saldo Atual', 'Receitas', 'Despesas', 'Investimentos']) {
      await expect(dashValue(page, title), title).toHaveText(brl(0));
    }
    await openReports(page);
    await expect(kpiValue(page, 'Receita Total')).toHaveText(brl(0));
    await expect(kpiValue(page, 'Despesa Total')).toHaveText(brl(0));
    await expect(page.getByText('Sem movimentação no período.').first()).toBeVisible();
    // Zero verdadeiro não é indisponível.
    await expect(page.getByText('Aguardando reconstrução dos totais.')).toHaveCount(0);
    await expect(page.getByText('Indisponível no momento.')).toHaveCount(0);
    // Sem investimento nenhum, o painel patrimonial não aparece (como na base).
    await expect(page.getByRole('heading', { name: 'Patrimônio de investimentos' })).toHaveCount(0);
  });

  test('aguardando reconstrução: projeção em versão antiga não mostra número de caixa', async ({ page }) => {
    const month = saoPauloMonthKey();
    // Projeção do mês gravada numa versão de esquema anterior: o backend não a
    // aceita como exata e pede reconstrução.
    await db().doc(`workspaces/${WS_PF.id}/cash_report_periods/${month}`).set({
      workspaceId: WS_PF.id,
      month,
      periodStart: `${month}-01`,
      schemaVersion: 4,
      days: {},
    });
    await login(page, OWNER.email);
    await expect(dashValue(page, 'Receitas')).toHaveText('—');
    await expect(dashLegend(page, 'Receitas')).toHaveText('Aguardando reconstrução dos totais.');
    await expect(dashValue(page, 'Despesas')).toHaveText('—');
    await expect(dashLegend(page, 'Despesas')).toHaveText('Aguardando reconstrução dos totais.');
    // O saldo vem das contas, que não dependem da projeção do caixa.
    await expect(dashValue(page, 'Saldo Atual')).toHaveText(brl(0));

    await openReports(page);
    await expect(kpiValue(page, 'Receita Total')).toHaveText('—');
    await expect(kpiValue(page, 'Despesa Total')).toHaveText('—');
    await expect(page.getByText('Aguardando reconstrução dos totais.').first()).toBeVisible();
    // Nunca um zero no lugar do dado ausente.
    await expect(kpiCard(page, 'Receita Total')).not.toContainText(brl(0));
  });

  test('viewer: lê caixa e aportes, mas não o patrimônio investido', async ({ page, request }) => {
    const token = await ownerToken(request);
    await createEntry(request, token, {
      workspaceId: WS_PF.id, type: 'receita', cents: 88_000, date: today(), description: 'Receita visível ao viewer E2E',
    });
    await waitForProjection(request, token, WS_PF.id, { receiptsCents: 88_000, paymentsCents: 0 });
    // Aporte real (callable) de R$ 100,00 a partir da conta padrão.
    const now = new Date();
    const catalogItem = (id: string, group: string, name: string, subtype?: string) => {
      const normalizedName = normalize(name);
      return db().doc(`workspaces/${WS_PF.id}/settings_catalog/${id}`).set({
        id, schemaVersion: 1, workspaceId: WS_PF.id, group, name, normalizedName,
        ...(subtype ? { transactionSubtype: subtype } : {}),
        dedupeKey: `${group}::${subtype ?? 'all'}::both::${normalizedName}`,
        workspaceScope: 'both', sortOrder: 1, status: 'active',
        createdBy: OWNER.uid, updatedBy: OWNER.uid, createdAt: now, updatedAt: now,
      });
    };
    await Promise.all([
      catalogItem('p5c1-inv-class', 'investment_class', 'Reserva P5C1'),
      catalogItem('p5c1-inv-institution', 'investment_institution', 'Banco P5C1'),
      catalogItem('p5c1-inv-type', 'category', 'Renda fixa P5C1', 'investimento'),
    ]);
    const aporte = await callCallable(request, token, 'createSimpleInvestment', {
      workspaceId: WS_PF.id,
      idempotencyKey: intentKey('p5c1-inv'),
      correlationId: intentKey('p5c1-inv-corr'),
      institutionId: 'p5c1-inv-institution',
      classId: 'p5c1-inv-class',
      typeId: 'p5c1-inv-type',
      description: 'Aporte do viewer E2E',
      valueCents: 10_000,
      settled: true,
      occurredAt: new Date().toISOString(),
      cashAccountId: defaultCashAccountIdFor(WS_PF.id),
    });
    expect(aporte.status, JSON.stringify(aporte)).toBe(200);
    await expect.poll(async () => {
      const outcome = await callCallable(request, token, 'getFinancialReport', {
        workspaceId: WS_PF.id, range: { kind: 'preset', preset: 'all' }, sections: ['investments'],
      });
      const data = (outcome.result?.investments as { data?: { flows?: { contributionsCents?: number } } } | undefined)?.data;
      return data?.flows?.contributionsCents ?? null;
    }).toBe(10_000);

    await login(page, VIEWER.email);
    await expect(dashValue(page, 'Receitas')).toHaveText(brl(88_000));
    // O viewer vê os aportes do mês (fluxo), como o titular.
    await expect(dashValue(page, 'Investimentos')).toHaveText(brl(10_000));

    await openReports(page);
    await expect(kpiValue(page, 'Receita Total')).toHaveText(brl(88_000));
    // Patrimônio não: "—" e a nota; nunca um valor nem zero.
    const patrimony = page.locator('article').filter({ hasText: 'Patrimônio atual' });
    await expect(patrimony).toContainText('—');
    await expect(patrimony).not.toContainText('R$');
    await expect(page.getByText('Sem permissão para ver o patrimônio investido.').first()).toBeVisible();
    await expect(page.locator('article').filter({ hasText: 'Aportes' }).first()).toContainText(brl(10_000));
  });

  test('falha técnica: erro na callable mostra a mensagem em pt-BR, sem números', async ({ page }) => {
    // Simula só a falha técnica do servidor na callable do relatório, desde a
    // primeira leitura. O restante (Auth, Firestore, demais callables) é real.
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    await page.route('**/getFinancialReport', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      await route.fulfill({
        status: 500,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ error: { status: 'INTERNAL', message: 'internal' } }),
      });
    });

    await login(page, OWNER.email);
    const message = 'Não foi possível carregar o relatório. Tente novamente.';
    // Nenhum card mostra número (nem zero): "—" e o motivo na legenda.
    for (const title of ['Saldo Atual', 'Receitas', 'Despesas', 'Investimentos']) {
      await expect(dashValue(page, title), title).toHaveText('—');
      await expect(dashLegend(page, title), title).toHaveText(message);
    }

    await openReports(page);
    await expect(page.getByRole('alert')).toHaveText(message);
    await expect(page.getByText('Receita Total')).toHaveCount(0);
  });
});

// ------------------------------------------ 6. atualização após operação na UI

test('lançamento criado pela UI atualiza Dashboard e Relatórios sem recarregar a página', async ({ page, request }) => {
  const token = await ownerToken(request);
  await createEntry(request, token, {
    workspaceId: WS_PF.id, type: 'receita', cents: 100_000, date: today(), description: 'Receita inicial E2E',
  });
  await waitForProjection(request, token, WS_PF.id, { receiptsCents: 100_000, paymentsCents: 0 });

  await login(page, OWNER.email);
  await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });
  await expect(dashValue(page, 'Receitas')).toHaveText(brl(100_000));
  await expect(dashValue(page, 'Saldo Atual')).toHaveText(brl(100_000));

  await page.getByRole('button', { name: /Nova Transação/i }).first().click();
  const dialog = page.getByRole('dialog').filter({ has: page.locator('#transaction-modal-title') });
  await expect(dialog).toBeVisible();
  const form = dialog.locator('form');
  await expect(form.locator('select').nth(1)).toContainText(CATALOG.incomeCategory, { timeout: 20_000 });
  await form.locator('select').nth(0).selectOption({ label: CATALOG.incomeType });
  await form.locator('select').nth(1).selectOption({ label: CATALOG.incomeCategory });
  await form.locator('input[type="number"]').fill('123.45');
  await form.getByPlaceholder('Ex: Cliente XYZ, Reembolso Empresa...').fill('Receita criada pela UI E2E');
  await form.locator('input[type="date"]').fill(today());
  await dialog.getByRole('button', { name: /Revisar e Adicionar Receita/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Card e saldo se atualizam sozinhos (projeção assíncrona + releitura).
  await expect(dashValue(page, 'Receitas')).toHaveText(brl(112_345));
  await expect(dashValue(page, 'Saldo Atual')).toHaveText(brl(112_345));

  await openReports(page);
  await expect(kpiValue(page, 'Receita Total')).toHaveText(brl(112_345));
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
});

// ------------------------------------------------------------------ 7. mobile

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Relatórios em 390x844: números corretos e sem rolagem horizontal', async ({ page, request }) => {
    const token = await ownerToken(request);
    await createEntry(request, token, {
      workspaceId: WS_PF.id, type: 'receita', cents: 150_000, date: today(), description: 'Receita mobile E2E',
    });
    await createEntry(request, token, {
      workspaceId: WS_PF.id, type: 'despesa', cents: 40_000, date: today(), description: 'Despesa mobile E2E',
    });
    await waitForProjection(request, token, WS_PF.id, { receiptsCents: 150_000, paymentsCents: 40_000 });

    await login(page, OWNER.email);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
    const menu = page.getByRole('complementary', { name: 'Menu principal' });
    await expect(menu).toBeVisible();
    await menu.getByText(/^Relatórios( Empresariais)?$/).first().click();
    await expect(page.getByRole('tab', { name: 'Visão Geral' })).toBeVisible({ timeout: 30_000 });

    await expect(kpiValue(page, 'Receita Total')).toHaveText(brl(150_000));
    await expect(kpiValue(page, 'Despesa Total')).toHaveText(brl(40_000));
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await selectPeriod(page, 'Últimos 7 dias', '7d');
    await expect(kpiValue(page, 'Receita Total')).toHaveText(brl(150_000));
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await page.getByRole('tab', { name: 'Gráficos' }).click();
    await expect(page.getByRole('heading', { name: 'Fluxo de Caixa Mensal' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});
