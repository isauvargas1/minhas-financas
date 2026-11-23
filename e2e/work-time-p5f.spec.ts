import { adminAuth, adminFirestore } from './support/adminModules';
import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';

import { createAccountByApi, openCashAccounts } from './support/accounts';
import { axeViolations } from './support/axe';
import { callCallable } from './support/callables';
import { brl, db, intentKey, login, PASSWORD, resetEmulatorData, summaryFigure, tokenOf } from './support/loans';
import { createClientByApi, createReceivableByApi, docOf, versionOf } from './support/receivables';
import { adminSdk, seedAccountProfile, seedMembership, seedOwnedWorkspace, seedPaidPlan } from './support/workspaceSeed';

/**
 * P5-F (REQ-FUT-01), evoluída na P5-F.1 — tempo de trabalho equivalente com
 * renda automática, de ponta a ponta no Emulator (Auth, Firestore, Functions
 * e Rules reais; dados sintéticos).
 *
 * - Desativado por padrão: sem preferência, nada muda na interface.
 * - Primeira ativação pelo assistente (cancelar não grava nada), alternância
 *   pelo Header, persistência entre recargas e "dispositivos".
 * - A renda vem das receitas oficiais: lançamentos criados pela callable
 *   `createCashTransaction` nos três meses completos anteriores, com valores
 *   que dão exatamente R$ 25,00 por hora numa rotina de 8 h por dia, todos os
 *   dias (trabalho em feriados). Sem renda digitada.
 * - A preferência é do usuário: vale em PF e PJ; outra conta no mesmo
 *   navegador não vê a configuração nem a estimativa de quem saiu; outra aba
 *   acompanha; desativar guarda, excluir apaga tudo.
 * - Receitas consideradas, memória de cálculo, PJ com confirmação, mês atual,
 *   edição com prévia, falha de gravação, refazer o assistente e atualização
 *   automática após um lançamento.
 * - Nada derivado (renda, minutos, valor da hora) é gravado; a IA não recebe
 *   a configuração.
 */

test.use({ timezoneId: 'America/Sao_Paulo' });

const A = { uid: 'e2e-p5f-a', email: 'e2e-p5f-a@minhas-financas.local' };
const M = { uid: 'e2e-p5f-m', email: 'e2e-p5f-m@minhas-financas.local' };
const COMPANY = 'Empresa P5F';
/** Centavos por dia de trabalho de 8 h a R$ 25,00 por hora (A) e a R$ 20,00 (M). */
const A_DAY_CENTS = 8 * 2_500;
const M_DAY_CENTS = 8 * 2_000;
const OPENING_CENTS = 100_000;
const FIELDS = [
  'schemaVersion', 'enabled', 'displayMode', 'estimateMode', 'historyMonths', 'incomeWorkspaceId', 'allowBusinessIncome',
  'excludedIncomeIds', 'routines', 'worksOnHolidays', 'uf', 'municipality', 'localHolidays', 'exceptions', 'updatedAt',
];
const SEVEN_DAYS = 'W:08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60';
const CATALOG = { incomeType: 'Salário P5F', incomeCategory: 'Renda P5F' };

// ------------------------------------------------------------------ datas

const saoPauloToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const shiftMonth = (month: string, offset: number) => {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};
const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const currentMonth = () => saoPauloToday().slice(0, 7);
/** Os três meses completos anteriores ao mês corrente, do mais antigo ao mais recente. */
const habitualMonths = () => [3, 2, 1].map((offset) => shiftMonth(currentMonth(), -offset));
const habitualDays = () => habitualMonths().reduce((sum, month) => sum + daysIn(month), 0);
const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** Título de mês como na tela: só a primeira letra maiúscula (`Outubro de 2026`). */
const monthHeadingText = (month: string) => {
  const name = MONTHS_PT[Number(month.slice(5, 7)) - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${month.slice(0, 4)}`;
};
/** Texto curto do tempo, como `formatWorkTime`: `≈ 776 h`, `≈ 14 h 5 min`. */
const timeText = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return new RegExp(`≈\\s${hours.toLocaleString('pt-BR').replace('.', '\\.')}\\sh${rest ? `\\s${rest}\\smin` : ''}(?!\\s?\\d)`);
};
/** Reais formatados como texto (o `brl` das utilidades devolve uma expressão regular). */
const brlText = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const roundedMinutes = (cents: number, workMinutes: number, incomeCents: number) =>
  Number((2n * BigInt(cents) * BigInt(workMinutes) + BigInt(incomeCents)) / (2n * BigInt(incomeCents)));

// ------------------------------------------------------------------ preparo

const preferencePath = (uid: string) => `users/${uid}/private_preferences/work_time_equivalent`;
const storedPreference = async (uid: string) => (await db().doc(preferencePath(uid)).get()).data() ?? null;
const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

const seedCatalog = async (workspaceId: string, uid: string) => {
  const now = new Date();
  const items: Array<[string, string, string, string?]> = [
    ['p5f1-income-type', 'income_type', CATALOG.incomeType],
    ['p5f1-income-category', 'category', CATALOG.incomeCategory, 'receita'],
  ];
  await Promise.all(items.map(([id, group, name, transactionSubtype]) => db().doc(`workspaces/${workspaceId}/settings_catalog/${id}`).set({
    id, schemaVersion: 1, workspaceId, group, name, normalizedName: normalize(name),
    ...(transactionSubtype ? { transactionSubtype } : {}),
    dedupeKey: `${group}::${transactionSubtype ?? 'all'}::both::${normalize(name)}`,
    workspaceScope: 'both', sortOrder: 1, status: 'active',
    createdBy: uid, updatedBy: uid, createdAt: now, updatedAt: now,
  })));
};

interface Seeded { token: string; workspaceId: string; accountId: string }

/** Receita confirmada pela callable oficial (o mesmo caminho da interface). */
const createIncome = async (
  request: APIRequestContext, seeded: Seeded, date: string, amountCents: number, description: string,
  extra: Record<string, unknown> = {},
): Promise<string> => {
  const outcome = await callCallable(request, seeded.token, 'createCashTransaction', {
    workspaceId: seeded.workspaceId, idempotencyKey: intentKey(`p5f1-${description}`), cashAccountId: seeded.accountId,
    type: 'receita', description, categoryId: 'p5f1-income-category', incomeType: CATALOG.incomeType, amountCents,
    ...(extra.status === 'pending' ? {} : { date }), ...extra,
  });
  expect(outcome.status, JSON.stringify(outcome)).toBe(200);
  return String(outcome.result?.transactionId);
};

/** Espera a projeção de caixa (gatilho assíncrono) chegar ao total esperado de cada mês. */
const waitForReceipts = async (workspaceId: string, expected: Record<string, number>) => {
  for (const [month, cents] of Object.entries(expected)) {
    await expect.poll(async () => {
      const data = (await db().doc(`workspaces/${workspaceId}/cash_report_periods/${month}`).get()).data();
      return typeof data?.incomeCents === 'number' ? data.incomeCents : 0;
    }, { timeout: 45_000, message: `projeção de ${month}` }).toBe(cents);
  }
};

interface Tenant { pf: Seeded; pj: Seeded; mine: Seeded | null; incomeCents: number; workMinutes: number }

const seedTenant = async (request: APIRequestContext, options: { withM?: boolean } = {}): Promise<Tenant> => {
  const suffix = Date.now().toString(36);
  const pfId = `e2e-p5f-pf-${suffix}`;
  const pjId = `e2e-p5f-pj-${suffix}`;
  for (const user of [A, M]) {
    await adminAuth.getAuth(adminSdk()).createUser({ ...user, password: PASSWORD, emailVerified: true });
  }
  await seedOwnedWorkspace({ ...A, workspaceId: pfId, name: 'Pessoal P5F', type: 'PF' });
  await seedOwnedWorkspace({ ...A, workspaceId: pjId, name: COMPANY, type: 'PJ' });
  await seedPaidPlan(A.uid, 'business');
  // M é membro do workspace pessoal de A: mesmo workspace, outra pessoa.
  await seedAccountProfile(M);
  await seedMembership({ workspaceId: pfId, uid: M.uid, email: M.email, role: 'member', name: 'Pessoal P5F', type: 'PF' });
  for (const id of [pfId, pjId]) await seedCatalog(id, A.uid);
  const token = await tokenOf(request, A.email);
  const pf = { token, workspaceId: pfId, accountId: await createAccountByApi(request, token, pfId, 'Conta P5F', { openingBalanceCents: OPENING_CENTS }) };
  const pj = { token, workspaceId: pjId, accountId: await createAccountByApi(request, token, pjId, 'Caixa Empresa P5F', { openingBalanceCents: 35_200 }) };
  const expected: Record<string, number> = {};
  for (const month of habitualMonths()) {
    expected[month] = daysIn(month) * A_DAY_CENTS;
    await createIncome(request, pf, `${month}-05`, expected[month], `Salário ${month}`);
  }
  await waitForReceipts(pfId, expected);
  let mine: Seeded | null = null;
  if (options.withM) {
    const mineId = `e2e-p5f-m-pf-${suffix}`;
    await seedOwnedWorkspace({ ...M, workspaceId: mineId, name: 'Pessoal de M', type: 'PF' });
    await seedPaidPlan(M.uid, 'business');
    await seedCatalog(mineId, M.uid);
    const mToken = await tokenOf(request, M.email);
    mine = { token: mToken, workspaceId: mineId, accountId: await createAccountByApi(request, mToken, mineId, 'Conta de M') };
    const expectedM: Record<string, number> = {};
    for (const month of habitualMonths()) {
      expectedM[month] = daysIn(month) * M_DAY_CENTS;
      await createIncome(request, mine, `${month}-05`, expectedM[month], `Salário M ${month}`);
    }
    await waitForReceipts(mineId, expectedM);
  }
  return { pf, pj, mine, incomeCents: habitualDays() * A_DAY_CENTS, workMinutes: habitualDays() * 480 };
};

/** Preferência v2 gravada como o cliente gravaria (atalho de preparação; o assistente é testado no primeiro teste). */
const seedPreference = async (uid: string, incomeWorkspaceId: string, overrides: Record<string, unknown> = {}) => {
  await db().doc(preferencePath(uid)).set({
    schemaVersion: 2,
    enabled: true,
    displayMode: 'time',
    estimateMode: 'habitual',
    historyMonths: 3,
    incomeWorkspaceId,
    allowBusinessIncome: false,
    excludedIncomeIds: '',
    routines: SEVEN_DAYS,
    worksOnHolidays: true,
    uf: '',
    municipality: '',
    localHolidays: '',
    exceptions: '',
    updatedAt: (adminSdk(), adminFirestore.FieldValue).serverTimestamp(),
    ...overrides,
  });
};

const startOn = async (page: Page, uid: string, workspaceId: string) => {
  await page.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value);
  }, [`lastWorkspaceId_${uid}`, workspaceId]);
};

// --------------------------------------------------------------- seletores

const timeToggle = (page: Page) => page.getByRole('button', { name: 'Mostrar valores em tempo de trabalho' });
const notice = (page: Page) => page.getByTestId('work-time-notice');
const balanceCard = (page: Page) => summaryFigure(page, 'Saldo Atual');
const converted = (page: Page) => page.locator('[data-work-time]');
const enableSwitch = (page: Page) => page.getByRole('switch', { name: 'Ativar tempo de trabalho equivalente' });
const saveButton = (page: Page) => page.getByTestId('work-time-save');
const previewHourly = (page: Page) => page.getByTestId('work-time-preview-hourly');
const wizardStep = (page: Page) => page.getByTestId('work-time-wizard-step');

const openDashboard = async (page: Page) => {
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(balanceCard(page)).toBeVisible({ timeout: 20_000 });
};

const openWorkTimeSettings = async (page: Page) => {
  await page.getByText('Configurações', { exact: true }).first().click();
  await page.getByRole('button', { name: /Tempo de trabalho equivalente/ }).click();
  await expect(page.getByRole('heading', { name: 'Tempo de trabalho equivalente', level: 2 })).toBeVisible({ timeout: 20_000 });
};

const switchWorkspace = async (page: Page, label: string) => {
  await page.getByRole('button', { name: 'Abrir menu da conta' }).click();
  await page.getByRole('button', { name: label }).first().click();
};

/**
 * Troca de conta na MESMA página: a tela de login lê o e-mail da URL ao montar.
 * `onLoginScreen` roda com a sessão anterior já encerrada, antes de entrar.
 */
const logoutTo = async (page: Page, email: string, onLoginScreen: () => Promise<void> = async () => {}) => {
  const url = new URL(page.url());
  url.searchParams.set('e2eEmail', email);
  url.searchParams.set('e2ePassword', PASSWORD);
  await page.evaluate((next) => window.history.replaceState(null, '', next), url.toString());
  await page.getByText('Sair', { exact: true }).first().click();
  await expect(page.getByTestId('e2e-login-button')).toBeVisible();
  await onLoginScreen();
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
};

/** Assistente até a etapa E, com a rotina de 8 h todos os dias e trabalho em feriados. */
const wizardToIncome = async (page: Page) => {
  await page.getByTestId('work-time-start').click();
  await expect(wizardStep(page)).toHaveText('Apresentação');
  await expect(page.getByTestId('work-time-wizard')).toContainText('O FênixGran pode mostrar aproximadamente quantas horas de trabalho correspondem');
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(wizardStep(page)).toHaveText('Rotina de trabalho');
  await expect(wizardStep(page)).toBeFocused();
  await page.getByRole('checkbox', { name: 'Sábado' }).check();
  await page.getByRole('checkbox', { name: 'Domingo' }).check();
  await expect(page.getByTestId('routine-0-weekly-total')).toContainText(/56\sh/);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(wizardStep(page)).toHaveText('Feriados e localização');
  await expect(page.getByTestId('wizard-coverage')).toContainText('só os feriados nacionais entram automaticamente');
  await page.getByTestId('wizard-works-on-holidays').click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(wizardStep(page)).toHaveText('Exceções da jornada');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(wizardStep(page)).toHaveText('Receitas consideradas');
};

test.beforeEach(async () => {
  await resetEmulatorData();
});

test('desativado por padrão; assistente na primeira ativação, cancelar não grava, alternância e persistência entre sessões e dispositivos', async ({ page, request, browser }) => {
  test.setTimeout(300_000);
  const browserLogs = watchBrowserLogs(page);
  const tenant = await seedTenant(request);
  const leaks = derivedNeedles(tenant);
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  const balance = OPENING_CENTS + tenant.incomeCents;

  // 1. Padrão: tudo em reais, sem alternador e sem aviso.
  await expect(balanceCard(page)).toContainText(brl(balance), { timeout: 20_000 });
  await expect(timeToggle(page)).toHaveCount(0);
  await expect(notice(page)).toHaveCount(0);
  await expect(converted(page)).toHaveCount(0);

  // 2. Primeira ativação: apresentação e assistente; cancelar não grava nada.
  await openWorkTimeSettings(page);
  await expect(page.getByTestId('work-time-intro')).toContainText('Os valores em reais nunca mudam');
  await wizardToIncome(page);
  await expect(page.getByTestId('work-time-wizard-estimate-hourly')).toHaveText(brl(2_500), { timeout: 30_000 });
  await expect(page.getByTestId('wizard-income-count')).toContainText('3 lançamentos de receita considerados', { timeout: 30_000 });
  await expect(page.getByTestId('work-time-wizard-estimate')).toContainText(brl(tenant.incomeCents));
  const wizardViolations = await axeViolations(page, '[data-testid="work-time-wizard"]');
  expect(wizardViolations, JSON.stringify(wizardViolations, null, 2)).toEqual([]);
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByTestId('work-time-intro')).toBeVisible();
  expect(await storedPreference(A.uid), 'cancelar não grava configuração parcial').toBeNull();

  // 3. De novo, até o fim: resumo, modo tempo e gravação do contrato v2 exato.
  await wizardToIncome(page);
  await expect(page.getByTestId('work-time-wizard-estimate-hourly')).toHaveText(brl(2_500), { timeout: 30_000 });
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(wizardStep(page)).toHaveText('Resumo');
  await page.getByTestId('work-time-wizard-display').click();
  await page.getByTestId('work-time-wizard-save').click();
  await expect(page.getByText('Tudo pronto: a configuração foi salva.')).toBeVisible();
  const stored = await storedPreference(A.uid);
  expect(Object.keys(stored ?? {}).sort()).toEqual([...FIELDS].sort());
  expect(stored).toMatchObject({
    schemaVersion: 2, enabled: true, displayMode: 'time', estimateMode: 'habitual', historyMonths: 3,
    incomeWorkspaceId: tenant.pf.workspaceId, allowBusinessIncome: false, excludedIncomeIds: '',
    routines: SEVEN_DAYS, worksOnHolidays: true, localHolidays: '', exceptions: '',
  });
  expect(carriesDerived(stored, leaks), 'nada derivado no documento').toBe(false);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  await expect(enableSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(timeToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(notice(page)).toContainText('estimativa aproximada', { timeout: 30_000 });
  const settingsViolations = await axeViolations(page, '[data-testid="work-time-settings"]');
  expect(settingsViolations, JSON.stringify(settingsViolations, null, 2)).toEqual([]);

  // 4. Dashboard no modo tempo: a mesma estimativa em todos os pontos, reais exatos acessíveis.
  await openDashboard(page);
  const balanceTime = balanceCard(page).locator('[data-work-time]');
  const balanceMinutes = roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents);
  await expect(balanceTime).toContainText(timeText(balanceMinutes), { timeout: 30_000 });
  await expect(balanceTime).toHaveAttribute('title', new RegExp(`^${brl(balance).source} · tempo de trabalho estimado$`));
  await expect(page.locator('body')).not.toContainText(brl(2_500));
  // Os valores de receita da lista usam um verde que já não tem contraste suficiente no modo
  // dinheiro (achado anterior à P5-F.1). Prova: essas células têm as mesmas violações nos dois
  // modos; todos os outros pontos convertidos ficam sem violação.
  const incomeCells = '.text-green-600';
  const cardViolations = await axeViolations(page, `[data-work-time]:not(${incomeCells} > [data-work-time])`);
  expect(cardViolations, JSON.stringify(cardViolations, null, 2)).toEqual([]);
  const ruleIds = (violations: Array<{ id: string }>) => violations.map((violation) => violation.id).sort();
  const incomeInTime = ruleIds(await axeViolations(page, incomeCells));

  // 5. Alternância pelo Header e pelo aviso: grava só o modo, sem tocar no resto.
  await timeToggle(page).click();
  await expect(timeToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(balanceCard(page)).toContainText(brl(balance));
  await expect(balanceCard(page).locator('[data-work-time]')).toHaveCount(0);
  expect(ruleIds(await axeViolations(page, incomeCells)), 'a conversão não muda a acessibilidade dessas células').toEqual(incomeInTime);
  await expect(notice(page)).toHaveCount(0);
  await expect.poll(async () => (await storedPreference(A.uid))?.displayMode).toBe('money');
  expect(await storedPreference(A.uid)).toMatchObject({ routines: SEVEN_DAYS, enabled: true });
  await timeToggle(page).click();
  await expect(balanceTime).toContainText(timeText(balanceMinutes));
  await notice(page).getByRole('button', { name: 'Mostrar em R$' }).click();
  await expect(balanceCard(page)).toContainText(brl(balance));
  await timeToggle(page).click();
  await expect(balanceTime).toContainText(timeText(balanceMinutes));

  // 6. Contas: o saldo informativo converte; a transferência (confirmação) fica em reais.
  await openCashAccounts(page);
  await expect(page.getByTestId('accounts-total').locator('[data-work-time]')).toContainText(timeText(balanceMinutes));
  await page.getByRole('button', { name: /Nova transferência/ }).click();
  const transferDialog = page.getByRole('dialog', { name: 'Nova transferência' });
  await expect(transferDialog.getByRole('option', { name: /Conta P5F/ }).first()).toHaveText(brl(balance));
  await expect(transferDialog.locator('[data-work-time]')).toHaveCount(0);
  await expect(transferDialog.getByLabel('Valor (R$)')).toBeVisible();
  await transferDialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(transferDialog).toHaveCount(0);

  // 7. Persistência: recarga e outro dispositivo (contexto novo) mantêm a preferência e a estimativa.
  await page.reload();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
  await expect(balanceCard(page).locator('[data-work-time]')).toContainText(timeText(balanceMinutes), { timeout: 30_000 });
  const device = await browser.newContext({ timezoneId: 'America/Sao_Paulo' });
  const devicePage = await device.newPage();
  watchBrowserLogs(devicePage, browserLogs);
  await startOn(devicePage, A.uid, tenant.pf.workspaceId);
  await login(devicePage, A.email);
  await expect(balanceCard(devicePage).locator('[data-work-time]')).toContainText(timeText(balanceMinutes), { timeout: 30_000 });
  await expect(timeToggle(devicePage)).toHaveAttribute('aria-pressed', 'true');
  await device.close();
  expectNoDerivedInLogs(browserLogs, leaks);
});

test('a preferência vale em PF e PJ; outra conta no mesmo navegador não vê configuração, estimativa nem valores convertidos', async ({ page, request }) => {
  test.setTimeout(300_000);
  const browserLogs = watchBrowserLogs(page);
  const tenant = await seedTenant(request, { withM: true });
  await seedPreference(A.uid, tenant.pf.workspaceId);
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await startOn(page, M.uid, tenant.pf.workspaceId);
  const balance = OPENING_CENTS + tenant.incomeCents;
  const balanceMinutes = roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents);
  // Observador do DOM: qualquer aparição, mesmo de um quadro, do valor da hora,
  // da renda ou da conversão do saldo de A, ou de valor convertido enquanto M
  // estiver sem preferência.
  await page.addInitScript(({ hourly, income, aBalanceTime }) => {
    const state = window as unknown as { __p5fLeaks: string[]; __p5fPhase: 'A' | 'M' | 'M-own' };
    state.__p5fLeaks = [];
    state.__p5fPhase = 'A';
    const aTime = new RegExp(aBalanceTime);
    const check = () => {
      if (state.__p5fPhase === 'A') return;
      const text = document.body?.textContent ?? '';
      if (text.includes(hourly)) state.__p5fLeaks.push('valor da hora de A no texto');
      if (text.includes(income)) state.__p5fLeaks.push('renda elegível de A no texto');
      if (aTime.test(text)) state.__p5fLeaks.push('conversão do saldo com a estimativa de A');
      if (state.__p5fPhase === 'M' && document.querySelector('[data-work-time]')) state.__p5fLeaks.push('valor convertido');
      if (state.__p5fPhase === 'M' && document.querySelector('[data-testid="work-time-notice"]')) state.__p5fLeaks.push('aviso do modo tempo');
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  }, { hourly: brlText(2_500), income: brlText(tenant.incomeCents), aBalanceTime: timeText(balanceMinutes).source });
  await login(page, A.email);

  // PF e PJ: a mesma estimativa, valores de cada workspace.
  await expect(balanceCard(page).locator('[data-work-time]')).toContainText(timeText(balanceMinutes), { timeout: 30_000 });
  await switchWorkspace(page, COMPANY);
  await expect(page.getByText(COMPANY).first()).toBeVisible({ timeout: 20_000 });
  await expect(balanceCard(page).locator('[data-work-time]')).toContainText(/≈\s14\sh\s5\smin/, { timeout: 30_000 });
  await expect(timeToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await switchWorkspace(page, 'Pessoal');
  await expect(balanceCard(page).locator('[data-work-time]')).toContainText(timeText(balanceMinutes), { timeout: 30_000 });

  // A sai; M (membro do mesmo workspace) entra na mesma página, sem recarregar.
  await logoutTo(page, M.email, async () => {
    await expect(converted(page)).toHaveCount(0);
    await page.evaluate(() => { (window as unknown as { __p5fPhase: string }).__p5fPhase = 'M'; });
  });
  await expect(balanceCard(page)).toContainText(brl(balance), { timeout: 20_000 });
  await expect(timeToggle(page)).toHaveCount(0);
  await expect(notice(page)).toHaveCount(0);
  await openWorkTimeSettings(page);
  await expect(page.getByTestId('work-time-intro')).toBeVisible();
  await expect(enableSwitch(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __p5fLeaks: string[] }).__p5fLeaks)).toEqual([]);

  // M configura a própria (fonte padrão: o PF de que M é dono; R$ 20,00 por hora).
  await page.evaluate(() => { (window as unknown as { __p5fPhase: string }).__p5fPhase = 'M-own'; });
  await wizardToIncome(page);
  await expect(page.getByLabel('De qual espaço vem a sua renda?')).toHaveValue(tenant.mine!.workspaceId);
  await expect(page.getByTestId('work-time-wizard-estimate-hourly')).toHaveText(brl(2_000), { timeout: 30_000 });
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByTestId('work-time-wizard-display').click();
  await page.getByTestId('work-time-wizard-save').click();
  await expect(page.getByText('Tudo pronto: a configuração foi salva.')).toBeVisible();
  await openDashboard(page);
  const mMinutes = roundedMinutes(balance, habitualDays() * 480, habitualDays() * M_DAY_CENTS);
  await expect(balanceCard(page).locator('[data-work-time]')).toContainText(timeText(mMinutes), { timeout: 30_000 });
  expect(await storedPreference(M.uid)).toMatchObject({ incomeWorkspaceId: tenant.mine!.workspaceId });
  expect(await storedPreference(A.uid), 'a de A não muda').toMatchObject({ incomeWorkspaceId: tenant.pf.workspaceId, routines: SEVEN_DAYS });

  // De volta a A: a conversão é a de A, nunca a de M.
  expect(await page.evaluate(() => (window as unknown as { __p5fLeaks: string[] }).__p5fLeaks)).toEqual([]);
  await page.evaluate(() => { (window as unknown as { __p5fPhase: string }).__p5fPhase = 'A'; });
  await logoutTo(page, A.email);
  await switchWorkspace(page, 'Pessoal');
  await expect(balanceCard(page).locator('[data-work-time]')).toContainText(timeText(balanceMinutes), { timeout: 30_000 });
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });

  // Respostas atrasadas: A recarrega a página e os relatórios que A pede ficam retidos até A sair;
  // só então seguem para o servidor, e as respostas chegam com M na tela de entrada ou já dentro.
  // O que chega depois da troca não aparece para M (o observador acusaria a hora, a renda ou a
  // conversão de A), e M vê só a própria conversão.
  let releaseHeld = () => {};
  const held = new Promise<void>((resolve) => { releaseHeld = resolve; });
  const heldAt: number[] = [];
  const releasedAt: number[] = [];
  const slowReports = async (route: Route) => {
    heldAt.push(Date.now());
    await Promise.race([held, new Promise((resolve) => setTimeout(resolve, 60_000))]);
    releasedAt.push(Date.now());
    await route.continue().catch(() => undefined);
  };
  await page.route('**/getFinancialReport', slowReports);
  await page.reload();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => heldAt.length, { message: 'A pediu relatórios antes de sair', timeout: 30_000 }).toBeGreaterThan(0);
  let switchedAt = 0;
  await logoutTo(page, M.email, async () => {
    switchedAt = Date.now();
    await page.evaluate(() => { (window as unknown as { __p5fPhase: string }).__p5fPhase = 'M-own'; });
    releaseHeld();
  });
  await expect(balanceCard(page).locator('[data-work-time]')).toContainText(timeText(mMinutes), { timeout: 30_000 });
  await page.unroute('**/getFinancialReport', slowReports);
  expect(switchedAt).toBeGreaterThan(0);
  expect(heldAt.some((at) => at < switchedAt), 'relatório pedido por A antes da troca').toBe(true);
  expect(releasedAt.length).toBeGreaterThan(0);
  expect(releasedAt.every((at) => at >= switchedAt), 'as respostas retidas só seguiram depois da troca de conta').toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __p5fLeaks: string[] }).__p5fLeaks)).toEqual([]);
  expectNoDerivedInLogs(browserLogs, derivedNeedles(tenant));
});

test('outra aba acompanha; desativar mantém os dados e excluir apaga toda a configuração', async ({ page, request }) => {
  test.setTimeout(300_000);
  const browserLogs = watchBrowserLogs(page);
  const tenant = await seedTenant(request);
  await seedPreference(A.uid, tenant.pf.workspaceId, { exceptions: 'O2026-01-02', localHolidays: '01-25' });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  const balance = OPENING_CENTS + tenant.incomeCents;
  const balanceMinutes = roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents);
  await expect(balanceCard(page).locator('[data-work-time]')).toContainText(timeText(balanceMinutes), { timeout: 30_000 });
  const second = await page.context().newPage();
  watchBrowserLogs(second, browserLogs);
  await second.goto('/');
  await expect(balanceCard(second).locator('[data-work-time]')).toContainText(timeText(balanceMinutes), { timeout: 45_000 });

  // A troca de modo numa aba chega à outra pelo listener, sem recarregar.
  await timeToggle(page).click();
  await expect(balanceCard(second)).toContainText(brl(balance), { timeout: 20_000 });
  await expect(timeToggle(second)).toHaveAttribute('aria-pressed', 'false');
  await timeToggle(second).click();
  await expect(balanceCard(page).locator('[data-work-time]')).toContainText(timeText(balanceMinutes), { timeout: 20_000 });

  // Desativar: os valores voltam a reais nas duas abas; a configuração fica guardada.
  await openWorkTimeSettings(page);
  await expect(enableSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await enableSwitch(page).click();
  await saveButton(page).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible();
  await expect(timeToggle(page)).toHaveCount(0);
  await expect(timeToggle(second)).toHaveCount(0, { timeout: 20_000 });
  await expect(balanceCard(second)).toContainText(brl(balance));
  expect(await storedPreference(A.uid)).toMatchObject({ enabled: false, routines: SEVEN_DAYS, exceptions: 'O2026-01-02' });

  // Reativar volta ao que estava.
  await enableSwitch(page).click();
  await saveButton(page).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible();
  await expect(timeToggle(second)).toHaveCount(1, { timeout: 20_000 });
  await enableSwitch(page).click();
  await saveButton(page).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible();

  // Sem rede: salvar e excluir recusam na hora, com mensagem, sem prender a tela nem o modal; nada muda no servidor.
  const offlineMessage = page.getByText('Sem conexão com a internet. Conecte-se e tente de novo.');
  await enableSwitch(page).click();
  await page.context().setOffline(true);
  await saveButton(page).click();
  await expect(offlineMessage).toBeVisible();
  await expect(saveButton(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Excluir meus dados' }).click();
  const offlineDialog = page.getByRole('dialog', { name: 'Excluir dados do tempo de trabalho' });
  await offlineDialog.getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(offlineDialog).toBeHidden();
  await expect(offlineMessage).toBeVisible();
  await page.context().setOffline(false);
  expect(await storedPreference(A.uid)).toMatchObject({ enabled: false, routines: SEVEN_DAYS });
  await page.getByRole('button', { name: 'Descartar alterações' }).click();

  // Excluir: confirmação, documento apagado (rotina, feriados locais, exceções e escolhas), tudo em reais.
  await page.getByRole('button', { name: 'Excluir meus dados' }).click();
  const dialog = page.getByRole('dialog', { name: 'Excluir dados do tempo de trabalho' });
  await expect(dialog).toContainText('A rotina, os feriados locais, as exceções e as escolhas de renda serão apagados');
  await dialog.getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(page.getByText('Seus dados de tempo de trabalho foram excluídos.')).toBeVisible();
  await expect.poll(() => storedPreference(A.uid)).toBeNull();
  const leftovers = await db().collection(`users/${A.uid}/private_preferences`).listDocuments();
  expect(leftovers.map((ref) => ref.id), 'nenhum outro documento do recurso').toEqual([]);
  await expect(page.getByTestId('work-time-intro')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
  await expect(timeToggle(page)).toHaveCount(0);
  await expect(converted(page)).toHaveCount(0);
  await expect(balanceCard(page)).toContainText(brl(balance));
  expectNoDerivedInLogs(browserLogs, derivedNeedles(tenant));
});

test('a IA não recebe a configuração e o modo tempo não grava nada fora do documento privado', async ({ page, request }) => {
  test.setTimeout(240_000);
  const browserLogs = watchBrowserLogs(page);
  const tenant = await seedTenant(request);
  // Uma receita fora da janela: o total anual da categoria (agregado oficial) deixa de coincidir com a soma da janela.
  const outside = shiftMonth(currentMonth(), -4);
  await createIncome(request, tenant.pf, `${outside}-05`, 12_345, 'Receita fora do período');
  await waitForReceipts(tenant.pf.workspaceId, { [outside]: 12_345 });
  const leaks = derivedNeedles(tenant);
  await seedPreference(A.uid, tenant.pf.workspaceId);
  await startOn(page, A.uid, tenant.pf.workspaceId);
  const aiPayloads: string[] = [];
  await page.route('**/analyzeFinancialQuestion', async (route: Route) => {
    const origin = route.request().headers().origin ?? '*';
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': route.request().headers()['access-control-request-headers'] ?? '*',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    aiPayloads.push(route.request().postData() ?? '');
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ result: { answer: 'Resposta simulada.', createdAt: new Date().toISOString() } }),
    });
  });
  await login(page, A.email);
  const balance = OPENING_CENTS + tenant.incomeCents + 12_345;
  await expect(balanceCard(page).locator('[data-work-time]'))
    .toContainText(timeText(roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents)), { timeout: 30_000 });

  // Relatórios no modo tempo a 360 px: o texto para leitor de tela de cada valor fica contido na tabela
  // com rolagem própria e não alarga a página.
  await page.getByText(/^Relatórios( Empresariais)?$/).first().click();
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator('table [data-work-time]').first()).toBeAttached({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBe(0);
  if (viewport) await page.setViewportSize(viewport);

  // Pergunta à IA no modo tempo: o payload leva só o contrato da análise.
  await page.getByText('IA Financeira', { exact: true }).click();
  const input = page.getByPlaceholder(/Digite sua pergunta|Pergunte sobre estratégia/);
  await input.fill('Quanto gastei este mês?');
  await input.press('Enter');
  await page.getByRole('dialog', { name: 'Enviar pergunta ao assistente de IA' })
    .getByRole('button', { name: 'Enviar pergunta' }).click();
  await expect(page.getByText('Resposta simulada.')).toBeVisible({ timeout: 20_000 });
  expect(aiPayloads).toHaveLength(1);
  const sent = JSON.parse(aiPayloads[0]) as { data: Record<string, unknown> };
  expect(Object.keys(sent.data).sort()).toEqual(['idempotencyKey', 'providerConsent', 'question', 'range', 'workspaceId']);
  for (const forbidden of [...leaks.texts, 'workTime', 'private_preferences', 'routines', 'excludedIncomeIds', 'W:08:00', '≈']) {
    expect(aiPayloads[0], `payload da IA com "${forbidden}"`).not.toContain(forbidden);
  }
  const history = await page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('finance_ai_chat_history_')).map(([, value]) => value).join('\n'));
  for (const needle of leaks.texts) expect(history).not.toContain(needle);

  // Alternar várias vezes não grava nada convertido nem derivado fora do documento privado.
  await openDashboard(page);
  for (let round = 0; round < 3; round += 1) {
    await timeToggle(page).click();
    await expect(timeToggle(page)).toHaveAttribute('aria-pressed', round % 2 === 0 ? 'false' : 'true');
  }
  const offenders: string[] = [];
  // `listDocuments` também devolve pais inexistentes que só têm subcoleções; `get()` os pularia.
  const scan = async (ref: ReturnType<ReturnType<typeof db>['collection']>): Promise<void> => {
    for (const docRef of await ref.listDocuments()) {
      const snapshot = await docRef.get();
      const path = docRef.path;
      const data = snapshot.exists ? JSON.stringify(snapshot.data()) : '';
      const privateDoc = path === preferencePath(A.uid);
      if (!privateDoc && /workTime|work_time|equivalentMinutes|hourlyRate|excludedIncomeIds|incomeWorkspaceId|worksOnHolidays/.test(data)) offenders.push(path);
      if (snapshot.exists && carriesDerived(snapshot.data(), leaks)) offenders.push(`${path} (valor derivado)`);
      for (const child of await docRef.listCollections()) await scan(child);
    }
  };
  for (const root of await db().listCollections()) await scan(root);
  expect(offenders).toEqual([]);
  expect(Object.keys((await storedPreference(A.uid)) ?? {}).sort()).toEqual([...FIELDS].sort());
  expect(localStorageKeysWithPreference(await page.evaluate(() => Object.entries(localStorage)), leaks)).toEqual([]);
  expectNoDerivedInLogs(browserLogs, leaks);
});

test('receitas consideradas: regras automáticas, exclusão só na estimativa, PJ com confirmação, mês atual e memória de cálculo', async ({ page, request }) => {
  test.setTimeout(300_000);
  const tenant = await seedTenant(request);
  const lastMonth = habitualMonths()[2];
  // No último mês completo: um bônus extraordinário, uma receita prevista, uma anulada e um empréstimo tomado.
  const bonusId = await createIncome(request, tenant.pf, `${lastMonth}-20`, 120_000, 'Bônus extraordinário');
  await createIncome(request, tenant.pf, `${lastMonth}-21`, 50_000, 'Receita prevista', { status: 'pending', dueDate: `${lastMonth}-28` });
  const voidedId = await createIncome(request, tenant.pf, `${lastMonth}-22`, 70_000, 'Lançada em duplicidade');
  const voidedDoc = (await db().doc(`workspaces/${tenant.pf.workspaceId}/transactions/${voidedId}`).get()).data() ?? {};
  const voided = await callCallable(request, tenant.pf.token, 'voidCashTransaction', {
    workspaceId: tenant.pf.workspaceId, idempotencyKey: intentKey('p5f1-void'), transactionId: voidedId,
    expectedUpdatedAt: versionOf(voidedDoc), reason: 'Lançada em duplicidade',
  });
  expect(voided.status, JSON.stringify(voided)).toBe(200);
  const loan = await callCallable(request, tenant.pf.token, 'createLoan', {
    workspaceId: tenant.pf.workspaceId, idempotencyKey: intentKey('p5f1-loan'), type: 'borrow', personName: 'Banco P5F',
    principalCents: 300_000, cashAccountId: tenant.pf.accountId, startDate: `${lastMonth}-23`,
    firstDueDate: `${shiftMonth(currentMonth(), 1)}-10`, installments: 1, interest: { type: 'none' },
  });
  expect(loan.status, JSON.stringify(loan)).toBe(200);
  const official = daysIn(lastMonth) * A_DAY_CENTS + 120_000;
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: official });
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'money' });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await openWorkTimeSettings(page);

  const withBonus = tenant.incomeCents + 120_000;
  const hourly = (income: number, minutes: number) => Number((2n * BigInt(income) * 60n + BigInt(minutes)) / (2n * BigInt(minutes)));
  await expect(previewHourly(page)).toHaveText(brl(hourly(withBonus, tenant.workMinutes)), { timeout: 30_000 });

  // Painel: a receita prevista e o empréstimo aparecem com o motivo; a anulada não aparece; o mês confere com o oficial.
  await page.getByTestId('work-time-income-panel-open').click();
  const panel = page.getByRole('dialog', { name: 'Receitas consideradas' });
  await expect(panel.getByTestId(`income-item-${bonusId}`)).toContainText('Considerada na estimativa.', { timeout: 30_000 });
  await expect(panel).toContainText('Ainda não efetivada: não entra.');
  await expect(panel).toContainText('Valor de empréstimo não é renda: não entra.');
  await expect(panel).not.toContainText('Lançada em duplicidade');
  await expect(panel.getByTestId(`income-reconciliation-${lastMonth}`)).toContainText(`Confere com o relatório oficial: ${brlText(official)}`);
  const panelViolations = await axeViolations(page, '[data-testid="work-time-income-panel"]');
  expect(panelViolations, JSON.stringify(panelViolations, null, 2)).toEqual([]);
  // Desconsiderar o bônus: só a estimativa muda, e só depois de salvar.
  await panel.getByRole('checkbox', { name: /Considerar Bônus extraordinário/ }).uncheck();
  await expect(panel.getByTestId(`income-item-${bonusId}`)).toContainText('Desconsiderada por você');
  await panel.getByRole('button', { name: 'Concluir' }).click();
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  await expect(page.getByTestId('work-time-unsaved')).toBeVisible();
  expect((await storedPreference(A.uid))?.excludedIncomeIds, 'nada gravado antes de salvar').toBe('');
  await saveButton(page).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible();
  expect((await storedPreference(A.uid))?.excludedIncomeIds).toBe(bonusId);
  const bonus = (await db().doc(`workspaces/${tenant.pf.workspaceId}/transactions/${bonusId}`).get()).data() ?? {};
  expect(bonus, 'o lançamento original não muda').toMatchObject({ valueCents: 120_000, type: 'receita', isPaid: true });
  expect(bonus.voidedAt ?? null).toBeNull();

  // Memória de cálculo: modo, meses, desconsideradas, horas, data de atualização, limitações e o aviso pedido.
  await page.getByTestId('work-time-preview-details').click();
  const details = page.getByRole('dialog', { name: 'Como este valor foi calculado?' });
  await expect(details.getByTestId('work-time-disclaimer')).toHaveText(
    'Este valor é uma estimativa baseada nas receitas registradas e na jornada de trabalho configurada. Ele pode variar conforme sua renda, férias, feriados, horas extras e outras alterações na rotina. Não representa necessariamente seu salário líquido nem o custo real do seu trabalho.',
  );
  await expect(details).toContainText('Habitual: últimos 3 meses completos');
  await expect(details).toContainText('Você desconsiderou 1 receita');
  await expect(details).toContainText('Atualizado em');
  await expect(details.getByTestId('work-time-details-hourly')).toContainText(brl(2_500));
  const detailsViolations = await axeViolations(page, '[data-testid="work-time-details"]');
  expect(detailsViolations, JSON.stringify(detailsViolations, null, 2)).toEqual([]);
  await details.getByRole('button', { name: 'Entendi' }).click();

  // Restaurar padrão volta a considerar o bônus.
  await page.getByTestId('work-time-income-panel-open').click();
  await panel.getByRole('button', { name: 'Restaurar padrão' }).click();
  await panel.getByRole('button', { name: 'Concluir' }).click();
  await expect(previewHourly(page)).toHaveText(brl(hourly(withBonus, tenant.workMinutes)), { timeout: 30_000 });
  await page.getByRole('button', { name: 'Descartar alterações' }).click();

  // PJ: sem confirmação, indisponível; com ela, estimativa identificada como empresarial.
  await page.getByLabel('De qual espaço vem a sua renda?').selectOption(tenant.pj.workspaceId);
  await expect(page.getByText(/Faturamento de empresa \(PJ\) não é necessariamente renda pessoal/)).toBeVisible();
  await expect(page.getByTestId('work-time-preview-unavailable')).toContainText('A fonte escolhida é um espaço PJ', { timeout: 30_000 });
  await page.getByTestId('settings-income-allow-business').check();
  await expect(page.getByTestId('work-time-preview')).toContainText(`${COMPANY} (PJ)`, { timeout: 30_000 });
  await expect(page.getByTestId('work-time-preview-unavailable')).toContainText('Não há receitas efetivadas nos meses considerados');
  await page.getByRole('button', { name: 'Descartar alterações' }).click();

  // Mês atual: só o que já foi efetivado neste mês, marcado como incompleto.
  await createIncome(request, tenant.pf, saoPauloToday(), 80_000, 'Comissão do mês');
  await waitForReceipts(tenant.pf.workspaceId, { [currentMonth()]: 80_000 });
  await page.getByRole('radio', { name: /Mês atual:/ }).check();
  await expect(page.getByTestId('work-time-preview')).toContainText('mês incompleto', { timeout: 30_000 });
  await page.getByTestId('work-time-preview-details').click();
  await expect(details.getByTestId('work-time-note-current_month_incomplete')).toContainText('O mês atual ainda não terminou');
  await details.getByRole('button', { name: 'Entendi' }).click();
});

test('Configurações: prévia antes de salvar, falha de gravação preserva a anterior, escala e exceções mudam a estimativa, refazer o assistente', async ({ page, request }) => {
  test.setTimeout(300_000);
  const tenant = await seedTenant(request);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'money' });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  // Falha de leitura do relatório oficial: a prévia avisa em pt-BR (sem o texto do SDK), não inventa
  // valor e, de volta a rede, "Tentar de novo" traz a estimativa.
  const failReport = (route: Route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'internal failure' } }),
  });
  await page.route('**/getFinancialReport', failReport);
  await login(page, A.email);
  await openWorkTimeSettings(page);
  await expect(page.getByTestId('work-time-preview-error')).toContainText('Não foi possível carregar o relatório. Tente novamente.', { timeout: 30_000 });
  await expect(page.getByTestId('work-time-preview-error')).not.toContainText('internal');
  await expect(previewHourly(page)).toHaveCount(0);
  await page.unroute('**/getFinancialReport', failReport);
  await page.getByTestId('work-time-preview-error').getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  const before = await storedPreference(A.uid);

  // Tirar o domingo: menos horas, hora mais cara — só na prévia, até salvar.
  await page.getByRole('checkbox', { name: 'Domingo' }).first().uncheck();
  const sundays = habitualMonths().reduce((count, month) => {
    let total = 0;
    for (let day = 1; day <= daysIn(month); day += 1) {
      if (new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, day)).getUTCDay() === 0) total += 1;
    }
    return count + total;
  }, 0);
  const minutesWithoutSunday = tenant.workMinutes - sundays * 480;
  const hourlyWithoutSunday = Number((2n * BigInt(tenant.incomeCents) * 60n + BigInt(minutesWithoutSunday)) / (2n * BigInt(minutesWithoutSunday)));
  await expect(previewHourly(page)).toHaveText(brl(hourlyWithoutSunday), { timeout: 30_000 });
  expect(await storedPreference(A.uid), 'a prévia não grava').toEqual(before);

  // Falha de gravação (conta suspensa: as Rules negam): mensagem e configuração anterior intacta.
  await db().doc(`users/${A.uid}`).update({ status: 'suspended' });
  await saveButton(page).click();
  await expect(page.getByText('Não foi possível salvar agora. A configuração anterior continua valendo.', { exact: false })).toBeVisible({ timeout: 20_000 });
  expect(await storedPreference(A.uid)).toEqual(before);
  // A gravação recusada desta aba não é "mudança em outra aba": nenhum aviso falso de conflito.
  await expect(page.getByText('A configuração foi alterada em outra aba ou dispositivo.', { exact: false })).toHaveCount(0);
  await db().doc(`users/${A.uid}`).update({ status: 'active' });
  await saveButton(page).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible({ timeout: 20_000 });
  expect((await storedPreference(A.uid))?.routines).toBe('W:08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,-');

  // Férias no calendário, só pelo teclado: no dia 1, a seta para a esquerda leva ao último dia do
  // mês anterior (o último completo); cada seta anda um dia ou uma semana, sem perder passos, e
  // Enter marca o início e depois o fim.
  const lastMonth = habitualMonths()[2];
  const calendarGrid = page.getByTestId('settings-exceptions-calendar');
  const focusedDate = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.date ?? null);
  await expect(calendarGrid.locator('button[tabindex="0"]')).toHaveAttribute('data-date', `${currentMonth()}-01`);
  await calendarGrid.locator('button[tabindex="0"]').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('settings-exceptions-month')).toHaveText(new RegExp(`^${monthHeadingText(lastMonth)} · `));
  await expect.poll(focusedDate).toBe(`${lastMonth}-${String(daysIn(lastMonth)).padStart(2, '0')}`);
  for (let day = daysIn(lastMonth); day > 10; day -= 1) await page.keyboard.press('ArrowLeft');
  await expect.poll(focusedDate).toBe(`${lastMonth}-10`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await expect.poll(focusedDate).toBe(`${lastMonth}-03`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(focusedDate).toBe(`${lastMonth}-12`);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('De', { exact: true })).toHaveValue(`${lastMonth}-10`);
  await expect(page.getByLabel('Até (opcional)')).toHaveValue(`${lastMonth}-12`);
  await page.getByRole('button', { name: 'Incluir exceção' }).click();
  await expect(page.getByTestId('settings-exceptions-list')).toContainText(`Férias de 10/${lastMonth.slice(5, 7)}/${lastMonth.slice(0, 4)} a 12/`);
  await saveButton(page).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible();
  expect((await storedPreference(A.uid))?.exceptions).toBe(`F${lastMonth}-10/${lastMonth}-12`);

  // Refazer o assistente sem apagar: cancelar mantém tudo como estava.
  const saved = await storedPreference(A.uid);
  await page.getByTestId('work-time-redo').click();
  await expect(page.getByTestId('work-time-wizard-progress')).toContainText('Refazer assistente');
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(page.getByRole('checkbox', { name: 'Domingo' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(enableSwitch(page)).toBeVisible();
  expect(await storedPreference(A.uid)).toEqual(saved);

  // Refazer até salvar: o assistente parte do que está salvo e a mudança feita nele passa a valer.
  await page.getByTestId('work-time-redo').click();
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(page.getByRole('checkbox', { name: 'Sábado' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Sábado' }).uncheck();
  for (const step of ['Feriados e localização', 'Exceções da jornada', 'Receitas consideradas', 'Resumo']) {
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(wizardStep(page)).toHaveText(step);
  }
  await page.getByTestId('work-time-wizard-save').click();
  await expect(page.getByText('Tudo pronto: a configuração foi salva.')).toBeVisible();
  const redone = await storedPreference(A.uid);
  expect(redone?.routines).toBe('W:08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,-,-');
  expect(redone?.exceptions, 'as férias salvas continuam').toBe(saved?.exceptions);
  expect(redone?.incomeWorkspaceId).toBe(saved?.incomeWorkspaceId);
});

test('atualização automática: uma receita nova entra na estimativa do mês atual sem recarregar', async ({ page, request }) => {
  test.setTimeout(240_000);
  const tenant = await seedTenant(request);
  await createIncome(request, tenant.pf, saoPauloToday(), 100_000, 'Primeira do mês');
  await waitForReceipts(tenant.pf.workspaceId, { [currentMonth()]: 100_000 });
  await seedPreference(A.uid, tenant.pf.workspaceId, { estimateMode: 'current_month' });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  const monthMinutes = daysIn(currentMonth()) * 480;
  const balanceBefore = OPENING_CENTS + tenant.incomeCents + 100_000;
  await expect(balanceCard(page).locator('[data-work-time]'))
    .toContainText(timeText(roundedMinutes(balanceBefore, monthMinutes, 100_000)), { timeout: 30_000 });
  // No modo tempo, o aviso do topo diz que a base é o mês atual, ainda incompleto.
  await expect(notice(page)).toContainText('Base: o mês atual, ainda incompleto; a renda pode variar até o fim do mês.');
  // Outra sessão lança mais uma receita hoje: a projeção muda, os relatórios são relidos e a estimativa também.
  await createIncome(request, tenant.pf, saoPauloToday(), 100_000, 'Segunda do mês');
  const balanceAfter = balanceBefore + 100_000;
  await expect(balanceCard(page).locator('[data-work-time]'))
    .toContainText(timeText(roundedMinutes(balanceAfter, monthMinutes, 200_000)), { timeout: 45_000 });
});

test('atualização automática: receita retroativa no espaço da renda, com outro espaço ativo, muda a estimativa sem recarregar', async ({ page, request }) => {
  test.setTimeout(240_000);
  const tenant = await seedTenant(request);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'money' });
  // O espaço ativo é o PJ; a renda vem do PF: nada do PF passa pelo listener do Dashboard.
  await startOn(page, A.uid, tenant.pj.workspaceId);
  await login(page, A.email);
  await expect(page.getByText(COMPANY).first()).toBeVisible({ timeout: 20_000 });
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  // Outra sessão lança, no PF, uma receita no último mês completo (retroativa): a projeção daquele mês muda.
  const lastMonth = habitualMonths()[2];
  const officialBefore = (await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${lastMonth}`).get()).data()?.incomeCents as number;
  const retroId = await createIncome(request, tenant.pf, `${lastMonth}-15`, 50_000, 'Comissão retroativa');
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 50_000 });
  const hourlyAfter = Number((2n * BigInt(tenant.incomeCents + 50_000) * 60n + BigInt(tenant.workMinutes)) / (2n * BigInt(tenant.workMinutes)));
  await expect(previewHourly(page)).toHaveText(brl(hourlyAfter), { timeout: 30_000 });
  expect(await storedPreference(A.uid), 'a releitura não grava nada').toMatchObject({ incomeWorkspaceId: tenant.pf.workspaceId });

  // A pessoa desconsidera essa receita e salva: a hora volta a R$ 25,00.
  await page.getByTestId('work-time-income-panel-open').click();
  const panel = page.getByRole('dialog', { name: 'Receitas consideradas' });
  const retroItem = panel.getByTestId(`income-item-${retroId}`);
  await expect(retroItem).toContainText('Considerada na estimativa.', { timeout: 30_000 });
  await retroItem.getByRole('checkbox').uncheck();
  await expect(retroItem).toContainText('Desconsiderada por você');
  await panel.getByRole('button', { name: 'Concluir' }).click();
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  await saveButton(page).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible({ timeout: 20_000 });
  expect((await storedPreference(A.uid))?.excludedIncomeIds).toBe(retroId);
  // Daqui ao fim, a prévia só pode mostrar R$ 25,00: nem a receita anulada somada, nem descontada
  // duas vezes, nem por um quadro (a base e as exclusões são relidas juntas).
  await page.evaluate(() => {
    const state = window as unknown as { __p5fHourly: string[] };
    state.__p5fHourly = [];
    const read = () => {
      const text = document.querySelector('[data-testid="work-time-preview-hourly"]')?.textContent?.trim() ?? '';
      if (text && state.__p5fHourly[state.__p5fHourly.length - 1] !== text) state.__p5fHourly.push(text);
    };
    read();
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  // Outra sessão anula a receita desconsiderada: o total oficial cai e o item anulado deixa de ser
  // descontado (sem desconto em dobro). A memória de cálculo mostra a renda oficial inteira e a nota
  // de que a desconsiderada não muda mais a estimativa.
  const retroDoc = (await db().doc(`workspaces/${tenant.pf.workspaceId}/transactions/${retroId}`).get()).data() ?? {};
  const voided = await callCallable(request, tenant.pf.token, 'voidCashTransaction', {
    workspaceId: tenant.pf.workspaceId, idempotencyKey: intentKey('p5f1-void-retro'), transactionId: retroId,
    expectedUpdatedAt: versionOf(retroDoc), reason: 'Lançada por engano',
  });
  expect(voided.status, JSON.stringify(voided)).toBe(200);
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore });
  await page.getByTestId('work-time-preview-details').click();
  const details = page.getByRole('dialog', { name: 'Como este valor foi calculado?' });
  await expect(details.getByTestId('work-time-note-exclusions_ignored')).toBeVisible({ timeout: 30_000 });
  await expect(details).toContainText(`Total de receitas elegíveis: ${brlText(tenant.incomeCents)}.`, { timeout: 30_000 });
  await expect(details.getByTestId('work-time-details-hourly')).toContainText(brl(2_500));
  await details.getByRole('button', { name: 'Entendi' }).click();
  await expect(previewHourly(page)).toHaveText(brl(2_500));
  const seenHourly = await page.evaluate(() => (window as unknown as { __p5fHourly: string[] }).__p5fHourly);
  expect(seenHourly.map((text) => text.replace(/\s+/g, ' ')), 'nenhum valor intermediário na prévia').toEqual([brlText(2_500).replace(/\s+/g, ' ')]);
});

test('sem espaço PF próprio: nenhuma fonte pré-selecionada; contagem, prévia e painel esperam a escolha', async ({ page, request }) => {
  test.setTimeout(180_000);
  const tenant = await seedTenant(request);
  // M é só membro do PF de A: não tem espaço próprio, e nada é escolhido por M.
  await seedPaidPlan(M.uid, 'business');
  await startOn(page, M.uid, tenant.pf.workspaceId);
  await login(page, M.email);
  await openWorkTimeSettings(page);
  await wizardToIncome(page);
  const source = page.getByLabel('De qual espaço vem a sua renda?');
  await expect(source).toHaveValue('');
  await expect(source.locator('option:checked')).toHaveText('Escolha um espaço');
  await expect(page.getByTestId('wizard-income-count')).toHaveText('Escolha o espaço da renda para contar os lançamentos de receita.');
  await expect(page.getByTestId('work-time-wizard-estimate-hourly')).toHaveCount(0);
  await expect(page.getByTestId('work-time-wizard-income-panel')).toBeDisabled();
  // Continuar sem fonte: a etapa pede a escolha e não avança.
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Escolha de qual espaço vem a sua renda.', { exact: true })).toBeVisible();
  await expect(wizardStep(page)).toHaveText('Receitas consideradas');
  // Com a fonte escolhida (o PF de A, de que M é membro), contagem, prévia e painel funcionam.
  await source.selectOption(tenant.pf.workspaceId);
  await expect(page.getByTestId('work-time-wizard-estimate-hourly')).toHaveText(brl(2_500), { timeout: 30_000 });
  await expect(page.getByTestId('wizard-income-count')).toContainText('3 lançamentos de receita considerados', { timeout: 30_000 });
  await expect(page.getByTestId('work-time-wizard-income-panel')).toBeEnabled();
  await page.getByTestId('work-time-wizard-income-panel').click();
  const panel = page.getByRole('dialog', { name: 'Receitas consideradas' });
  await expect(panel).toContainText('Considerada na estimativa.', { timeout: 30_000 });
  await expect(panel).not.toContainText('Carregando as receitas do período');
  await panel.getByRole('button', { name: 'Concluir' }).click();
  expect(await storedPreference(M.uid), 'nada gravado antes de salvar').toBeNull();
});

test('Configurações: a troca do modo pelo Header durante uma edição entra no rascunho e não é desfeita ao salvar', async ({ page, request }) => {
  test.setTimeout(180_000);
  const tenant = await seedTenant(request);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'money' });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  const modeRadio = (name: string) => page.getByRole('radio', { name });
  await expect(modeRadio('Reais (R$)')).toBeChecked();
  // Edição em curso, ainda não salva: tirar o domingo.
  await page.getByRole('checkbox', { name: 'Domingo' }).first().uncheck();
  await expect(page.getByTestId('work-time-unsaved')).toBeVisible();
  // A pessoa liga o modo tempo pelo Header, sem sair de Configurações.
  await expect(timeToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await timeToggle(page).click();
  await expect(timeToggle(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
  await expect.poll(async () => (await storedPreference(A.uid))?.displayMode, { timeout: 20_000 }).toBe('time');
  // O rascunho adota o modo novo (a pessoa não tinha mexido nele), a edição continua e nada acusa "outra aba".
  await expect(modeRadio('Tempo de trabalho')).toBeChecked({ timeout: 20_000 });
  await expect(page.getByRole('checkbox', { name: 'Domingo' }).first()).not.toBeChecked();
  await expect(page.getByTestId('work-time-unsaved')).toBeVisible();
  await expect(page.getByText('A configuração foi alterada em outra aba ou dispositivo', { exact: false })).toHaveCount(0);
  // Salvar grava a edição e mantém o modo escolhido no Header.
  await saveButton(page).click();
  await expect(page.getByText('Alterações salvas.')).toBeVisible({ timeout: 20_000 });
  const saved = await storedPreference(A.uid);
  expect(saved?.displayMode).toBe('time');
  expect(String(saved?.routines).split(',').at(-1), 'domingo sem trabalho').toBe('-');
  await expect(timeToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('A configuração foi alterada em outra aba ou dispositivo', { exact: false })).toHaveCount(0);
});

test('falha na leitura das receitas desconsideradas: mensagem fixa em pt-BR, nada do SDK, e "Tentar de novo"', async ({ page, request }) => {
  test.setTimeout(180_000);
  const tenant = await seedTenant(request);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'money' });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  await page.getByTestId('work-time-income-panel-open').click();
  const panel = page.getByRole('dialog', { name: 'Receitas consideradas' });
  const lastMonth = habitualMonths()[2];
  const salary = panel.getByRole('checkbox', { name: new RegExp(`Considerar Salário ${lastMonth}`) });
  await expect(salary).toBeChecked({ timeout: 30_000 });
  // A conta fica suspensa: as Rules negam a leitura por id da exclusão nova.
  await db().doc(`users/${A.uid}`).update({ status: 'suspended' });
  await salary.click();
  // A leitura falha: o painel não monta a lista sem a estimativa e pede para fechar e tentar de novo.
  await expect(panel.getByRole('alert')).toHaveText('A estimativa não carregou, então a lista ainda não pode ser montada. Feche e tente de novo.', { timeout: 30_000 });
  await panel.getByRole('button', { name: 'Concluir' }).click();
  const failure = page.getByTestId('work-time-preview-error');
  await expect(failure).toContainText('Não foi possível conferir as receitas desconsideradas agora. Tente de novo.', { timeout: 30_000 });
  await expect(failure).not.toContainText(/permission|insufficient|firestore|firebase/i);
  await expect(previewHourly(page)).toHaveCount(0);
  // De volta a conta, "Tentar de novo" traz a estimativa sem o salário desconsiderado; nada foi gravado.
  await db().doc(`users/${A.uid}`).update({ status: 'active' });
  await failure.getByRole('button', { name: 'Tentar de novo' }).click();
  const without = tenant.incomeCents - daysIn(lastMonth) * A_DAY_CENTS;
  const hourlyWithout = Number((2n * BigInt(without) * 60n + BigInt(tenant.workMinutes)) / (2n * BigInt(tenant.workMinutes)));
  await expect(previewHourly(page)).toHaveText(brl(hourlyWithout), { timeout: 30_000 });
  expect((await storedPreference(A.uid))?.excludedIncomeIds, 'nada gravado antes de salvar').toBe('');
});

// Contrato da P5-F.1-R3.1 (R3-AUD-01). Desde a R1, este teste afirmava que, com a releitura em falha e uma receita
// nova ainda não lida, a prévia seguia com a hora anterior (R$ 25,00) e o aviso de leitura anterior: a conversão
// anterior aparecia enquanto a sincronização não confirmava o estado atual. Agora, sem essa confirmação, nada é
// convertido (o erro do relatório, com "Tentar de novo"), e o "Tentar de novo" com o relatório de volta traz a receita
// nova, como antes. O aviso de leitura anterior continua, para o estado atual confirmado pela escuta (a projeção de
// volta ao que a última leitura trouxe). As asserções de texto, de ausência de detalhe interno e de recuperação seguem
// abaixo. Justificativa: docs/production/evidence/p5f1-r31/testes-substituidos.md.
test('releitura que falha: sem confirmar a receita nova, nada convertido e erro com "Tentar de novo", que a traz com o relatório de volta; com a projeção de volta à última leitura, a estimativa volta com o aviso', async ({ page, request }) => {
  test.setTimeout(300_000);
  const tenant = await seedTenant(request);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time' });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  const hourlyOf = (income: number) => Number((2n * BigInt(income) * 60n + BigInt(tenant.workMinutes)) / (2n * BigInt(tenant.workMinutes)));
  const hourlyX = hourlyOf(tenant.incomeCents + 50_000);
  const hourlyXZ = hourlyOf(tenant.incomeCents + 80_000);
  expect(new Set([2_500, hourlyX, hourlyXZ]).size, 'as horas de cada estado são distinguíveis').toBe(3);
  // Daqui em diante, cada estado da prévia (hora mostrada, erro, aviso de leitura anterior) é registrado com a hora do navegador.
  await page.evaluate(() => {
    const state = window as unknown as { __p5fPreview: { at: number; hourly: string; error: boolean; stale: boolean }[] };
    state.__p5fPreview = [];
    const read = () => {
      const entry = {
        at: Date.now(),
        hourly: document.querySelector('[data-testid="work-time-preview-hourly"]')?.textContent?.trim() ?? '',
        error: document.querySelector('[data-testid="work-time-preview-error"]') !== null,
        stale: document.querySelector('[data-testid="work-time-preview-refresh-failed"]') !== null,
      };
      const last = state.__p5fPreview[state.__p5fPreview.length - 1];
      if (!last || last.hourly !== entry.hourly || last.error !== entry.error || last.stale !== entry.stale) state.__p5fPreview.push(entry);
    };
    read();
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const now = () => page.evaluate(() => Date.now());
  // O relatório oficial passa a falhar; outra sessão lança uma receita retroativa na janela.
  const failReport = (route: Route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'internal failure' } }),
  });
  await page.route('**/getFinancialReport', failReport);
  const lastMonth = habitualMonths()[2];
  const officialBefore = (await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${lastMonth}`).get()).data()?.incomeCents as number;
  await createIncome(request, tenant.pf, `${lastMonth}-16`, 50_000, 'Retroativa sem releitura');
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 50_000 });
  // Fase 1. A releitura falha e a sincronização não confirma o estado atual: nenhuma hora, nem a anterior. O erro do
  // relatório em pt-BR, sem detalhe interno, com "Tentar de novo"; no topo, os valores ficam em reais.
  const failure = page.getByTestId('work-time-preview-error');
  const stale = page.getByTestId('work-time-preview-refresh-failed');
  await expect(failure).toContainText('Não foi possível carregar o relatório. Tente novamente.', { timeout: 45_000 });
  await expect(failure).not.toContainText(/internal|INTERNAL/);
  await expect(failure.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await expect(previewHourly(page)).toHaveCount(0);
  await expect(stale).toHaveCount(0);
  await expect(notice(page)).toContainText('Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações.');
  await expect(converted(page)).toHaveCount(0);
  // Fase 2. De volta o relatório, o "Tentar de novo" do erro traz a receita nova; o erro some e nenhum aviso fica.
  await page.unroute('**/getFinancialReport', failReport);
  const retriedAt = await now();
  await failure.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(previewHourly(page)).toHaveText(brl(hourlyX), { timeout: 30_000 });
  await expect(failure).toHaveCount(0);
  await expect(stale).toHaveCount(0);
  await expect(notice(page)).not.toContainText('Não foi possível atualizar a estimativa com os lançamentos mais recentes');
  // Fase 3. O relatório volta a falhar e outra sessão lança mais uma receita: de novo o erro, sem hora.
  await page.route('**/getFinancialReport', failReport);
  const failedAgainAt = await now();
  const secondId = await createIncome(request, tenant.pf, `${lastMonth}-17`, 20_000, 'Retroativa anulada');
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 70_000 });
  await expect(failure).toContainText('Não foi possível carregar o relatório. Tente novamente.', { timeout: 45_000 });
  await expect(previewHourly(page)).toHaveCount(0);
  await expect(stale).toHaveCount(0);
  // Outra sessão anula essa receita: a projeção volta ao que a última leitura trouxe. A escuta confirma o estado atual,
  // e a estimativa volta com o aviso imediato de que a releitura falhou, sem detalhe interno; o topo também.
  const voidedAt = await now();
  const secondDoc = (await db().doc(`workspaces/${tenant.pf.workspaceId}/transactions/${secondId}`).get()).data() ?? {};
  const voided = await callCallable(request, tenant.pf.token, 'voidCashTransaction', {
    workspaceId: tenant.pf.workspaceId, idempotencyKey: intentKey('p5f1-r31-void'), transactionId: secondId,
    expectedUpdatedAt: versionOf(secondDoc), reason: 'Lançada por engano',
  });
  expect(voided.status, JSON.stringify(voided)).toBe(200);
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 50_000 });
  await expect(stale).toContainText('Não foi possível atualizar a estimativa com os lançamentos mais recentes agora. Ela usa a última leitura.', { timeout: 45_000 });
  await expect(stale).not.toContainText(/internal|INTERNAL/);
  await expect(previewHourly(page)).toHaveText(brl(hourlyX));
  await expect(failure).toHaveCount(0);
  await expect(notice(page)).toContainText('Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações.');
  // Fase 4. De volta o relatório, o "Tentar de novo" do aviso relê: o aviso some e a hora continua a oficial.
  await page.unroute('**/getFinancialReport', failReport);
  await stale.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(stale).toHaveCount(0, { timeout: 30_000 });
  await expect(previewHourly(page)).toHaveText(brl(hourlyX), { timeout: 30_000 });
  await expect(notice(page)).not.toContainText('Não foi possível atualizar a estimativa com os lançamentos mais recentes');
  // Fase 5. Uma receita nova depois disso chega à estimativa: a sincronização confirma e a conversão volta normalmente.
  await createIncome(request, tenant.pf, `${lastMonth}-18`, 30_000, 'Retroativa com releitura');
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 80_000 });
  await expect(previewHourly(page)).toHaveText(brl(hourlyXZ), { timeout: 45_000 });
  await expect(failure).toHaveCount(0);
  await expect(stale).toHaveCount(0);
  // O registro: nos dois intervalos de erro (do erro até o "Tentar de novo" e até a anulação), nenhuma hora; o aviso
  // de leitura anterior só com a hora confirmada pela escuta; as horas novas só sem aviso e sem erro.
  const states = await page.evaluate(() => (window as unknown as { __p5fPreview: { at: number; hourly: string; error: boolean; stale: boolean }[] }).__p5fPreview);
  await test.info().attach('previa-releitura-que-falha', { body: JSON.stringify(states, null, 2), contentType: 'application/json' });
  console.log(`[previa-releitura-que-falha] ${JSON.stringify(states)}`);
  const spaced = (text: string) => text.replace(/\s+/g, ' ');
  const firstError = states.findIndex((entry) => entry.error);
  expect(firstError, `o primeiro erro apareceu: ${JSON.stringify(states)}`).toBeGreaterThan(0);
  const secondError = states.findIndex((entry) => entry.error && entry.at >= failedAgainAt);
  expect(secondError, `o segundo erro apareceu: ${JSON.stringify(states)}`).toBeGreaterThan(firstError);
  const unconfirmed = [
    ...states.slice(firstError).filter((entry) => entry.at < retriedAt),
    ...states.slice(secondError).filter((entry) => entry.at < voidedAt),
  ];
  expect(unconfirmed.filter((entry) => entry.hourly !== ''), `nenhuma hora sem confirmar a receita nova: ${JSON.stringify(states)}`).toEqual([]);
  expect(states.filter((entry) => entry.stale && spaced(entry.hourly) !== spaced(brlText(hourlyX))), 'aviso só com a hora confirmada').toEqual([]);
  expect(states.filter((entry) => [hourlyX, hourlyXZ].some((cents) => spaced(entry.hourly) === spaced(brlText(cents))) && entry.error), 'hora nova nunca junto do erro').toEqual([]);
  expect(states.filter((entry) => spaced(entry.hourly) === spaced(brlText(hourlyXZ)) && entry.stale), 'a hora da última receita sem aviso').toEqual([]);
  expect(states.some((entry) => entry.stale), 'o aviso de leitura anterior apareceu').toBe(true);
});

test('mutação nesta aba: anular em Receitas a receita desconsiderada não junta o item anulado com o total velho', async ({ page, request }) => {
  test.setTimeout(240_000);
  const tenant = await seedTenant(request);
  // Preparo (outra sessão): uma receita de R$ 500,00 no último mês completo, desconsiderada.
  const lastMonth = habitualMonths()[2];
  const officialBefore = (await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${lastMonth}`).get()).data()?.incomeCents as number;
  const extraId = await createIncome(request, tenant.pf, `${lastMonth}-15`, 50_000, 'Comissão desconsiderada');
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 50_000 });
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'money', excludedIncomeIds: extraId });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await expect(balanceCard(page)).toBeVisible({ timeout: 20_000 });
  // Desde já, toda prévia da hora que aparecer na página é registrada.
  await page.evaluate(() => {
    const state = window as unknown as { __p5fHourly: string[] };
    state.__p5fHourly = [];
    const read = () => {
      const text = document.querySelector('[data-testid="work-time-preview-hourly"]')?.textContent?.trim() ?? '';
      if (text && state.__p5fHourly[state.__p5fHourly.length - 1] !== text) state.__p5fHourly.push(text);
    };
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  // Nesta aba: Receitas do último mês completo, anular a receita desconsiderada.
  await page.getByRole('button', { name: 'Mês anterior' }).click();
  await page.getByRole('button', { name: /^Receitas\s+R\$/ }).click();
  const row = page.locator('tr').filter({ hasText: 'Comissão desconsiderada' });
  await row.getByRole('button', { name: 'Deletar' }).click();
  const voidDialog = page.getByRole('dialog').filter({ hasText: 'Anular lançamento' });
  await voidDialog.getByLabel('Motivo da anulação').fill('Lançada por engano');
  await voidDialog.getByRole('button', { name: 'Confirmar anulação' }).click();
  await expect(voidDialog).toBeHidden({ timeout: 30_000 });
  await expect(row).toHaveCount(0);
  expect((await db().doc(`workspaces/${tenant.pf.workspaceId}/transactions/${extraId}`).get()).get('voidedAt')).toBeTruthy();

  // Logo depois, a prévia: o total oficial ainda tem os R$ 500,00 (o gatilho da projeção é assíncrono),
  // então a exclusão continua valendo até a base nova chegar. Nada de R$ 500,00 somados a mais.
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore });
  // Depois da base nova: a receita anulada não muda mais a estimativa, e a renda é a oficial inteira.
  await page.getByTestId('work-time-preview-details').click();
  const details = page.getByRole('dialog', { name: 'Como este valor foi calculado?' });
  await expect(details.getByTestId('work-time-note-exclusions_ignored')).toBeVisible({ timeout: 30_000 });
  await expect(details).toContainText(`Total de receitas elegíveis: ${brlText(tenant.incomeCents)}.`, { timeout: 30_000 });
  await expect(details.getByTestId('work-time-details-hourly')).toContainText(brl(2_500));
  await details.getByRole('button', { name: 'Entendi' }).click();
  await expect(previewHourly(page)).toHaveText(brl(2_500));
  const seenHourly = await page.evaluate(() => (window as unknown as { __p5fHourly: string[] }).__p5fHourly);
  expect(seenHourly.map((text) => text.replace(/\s+/g, ' ')), 'nenhum valor intermediário na prévia').toEqual([brlText(2_500).replace(/\s+/g, ' ')]);
  expect(await storedPreference(A.uid), 'a sincronização não grava nada').toMatchObject({ excludedIncomeIds: extraId, displayMode: 'money' });
});
test('falha na leitura da preferência com a escuta já aberta: aviso fixo em pt-BR, valores em reais e "Tentar de novo"', async ({ page, request }) => {
  test.setTimeout(180_000);
  const tenant = await seedTenant(request);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time' });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  const logs = watchBrowserLogs(page);
  await login(page, A.email);
  await expect(converted(page).first()).toBeVisible({ timeout: 30_000 });
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  // A conta fica suspensa e o documento muda (outro dispositivo grava): a escuta aberta recebe a recusa das Rules.
  await db().doc(`users/${A.uid}`).update({ status: 'suspended' });
  await db().doc(preferencePath(A.uid)).update({ worksOnHolidays: false, updatedAt: (adminSdk(), adminFirestore.FieldValue).serverTimestamp() });
  const failure = page.getByRole('alert').filter({ hasText: 'Não foi possível carregar sua preferência agora.' });
  await expect(failure).toHaveText(/^Não foi possível carregar sua preferência agora\. Enquanto isso, os valores continuam em reais\.\s*Tentar de novo$/, { timeout: 30_000 });
  await expect(failure).not.toContainText(/permission|insufficient|firestore|firebase/i);
  await expect(converted(page)).toHaveCount(0);
  expect(logs.filter((line) => line.startsWith('Falha ao ler a preferência')), 'só o código do erro no log').toEqual(['Falha ao ler a preferência de tempo de trabalho permission-denied']);
  // De volta a conta, "Tentar de novo" abre a escuta de novo e a configuração volta, com o que o outro dispositivo gravou.
  await db().doc(`users/${A.uid}`).update({ status: 'active' });
  await failure.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(failure).toHaveCount(0, { timeout: 30_000 });
  await expect(previewHourly(page)).toBeVisible({ timeout: 30_000 });
  expect(await storedPreference(A.uid), 'nada regravado pela falha').toMatchObject({ displayMode: 'time', worksOnHolidays: false });
});

test('escuta das projeções encerrada: os valores voltam a reais, sem a ressalva de leitura anterior; abrir Configurações a reabre, a conversão volta e a estimativa em uso volta a acompanhar outras sessões', async ({ page, request }) => {
  test.setTimeout(240_000);
  const tenant = await seedTenant(request);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time' });
  // O espaço ativo é o PJ (sem lançamentos); a renda vem do PF: o saldo do PJ em tempo só muda com a hora.
  await startOn(page, A.uid, tenant.pj.workspaceId);
  await login(page, A.email);
  await expect(page.getByText(COMPANY).first()).toBeVisible({ timeout: 20_000 });
  const pjBalance = 35_200;
  const pjMinutes = roundedMinutes(pjBalance, tenant.workMinutes, tenant.incomeCents);
  await expect(balanceCard(page).locator('[data-work-time]')).toContainText(timeText(pjMinutes), { timeout: 30_000 });
  const stale = 'Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações.';
  const unavailable = 'Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações.';
  const approximate = 'Valores em tempo de trabalho equivalente: uma estimativa aproximada, não o valor exato.';
  await expect(notice(page)).not.toContainText(stale);
  // A conta fica suspensa e outra sessão toca a projeção de um mês da janela no PF: a escuta aberta da
  // estimativa em uso recebe a recusa das Rules e é encerrada (o SDK não a reabre). Sem o retorno do servidor nada
  // é confirmado, também com uma base e nenhuma desconsiderada (P5-F.1-R3.2, RR-R31-05): os valores voltam a reais,
  // sem conversão pela leitura anterior, e o topo diz que a estimativa está indisponível.
  const [firstMonth, , lastMonth] = habitualMonths();
  await db().doc(`users/${A.uid}`).update({ status: 'suspended' });
  await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${firstMonth}`)
    .update({ updatedAt: (adminSdk(), adminFirestore.FieldValue).serverTimestamp() });
  await expect(notice(page)).toContainText(unavailable, { timeout: 30_000 });
  await expect(page.locator('[data-work-time]')).toHaveCount(0);
  await expect(balanceCard(page)).toContainText(brl(pjBalance));
  await expect(notice(page)).not.toContainText(stale);
  // De volta a conta, a pessoa segue o aviso e abre Configurações: a escuta da prévia recebe o
  // servidor e reabre a da estimativa em uso, que não tem botão próprio.
  await db().doc(`users/${A.uid}`).update({ status: 'active' });
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  await expect(notice(page)).toContainText(approximate, { timeout: 30_000 });
  await expect(notice(page)).not.toContainText(stale);
  // De volta ao Dashboard, sem a prévia: o saldo convertido de novo e uma receita retroativa de outra sessão no PF
  // chega à estimativa em uso.
  await openDashboard(page);
  await expect(balanceCard(page).locator('[data-work-time]')).toContainText(timeText(pjMinutes), { timeout: 30_000 });
  const officialBefore = (await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${lastMonth}`).get()).data()?.incomeCents as number;
  await createIncome(request, tenant.pf, `${lastMonth}-16`, 50_000, 'Retroativa depois da reabertura');
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: officialBefore + 50_000 });
  await expect(balanceCard(page).locator('[data-work-time]'))
    .toContainText(timeText(roundedMinutes(pjBalance, tenant.workMinutes, tenant.incomeCents + 50_000)), { timeout: 45_000 });
  await expect(notice(page)).not.toContainText(stale);
});

/** Grava cada estado da prévia de Configurações e cada texto do aviso do topo, na ordem (P5-F.1-R3.2, ADV-01). */
const recordEstimateStates = (page: Page) => page.evaluate(() => {
  const state = window as unknown as { __p5fStates: { preview: string[]; notice: string[] } };
  state.__p5fStates = { preview: [], notice: [] };
  const push = (list: string[], value: string) => {
    if (list[list.length - 1] !== value) list.push(value);
  };
  const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const read = () => {
    const loading = text('work-time-preview-loading');
    const error = text('work-time-preview-error');
    const hourly = text('work-time-preview-hourly');
    const unavailable = text('work-time-preview-unavailable');
    push(state.__p5fStates.preview, loading !== null ? `calculando|${loading}`
      : error !== null ? `erro|${error}`
        : hourly !== null ? `hora|${hourly}`
          : unavailable !== null ? `indisponivel|${unavailable}` : 'nenhum');
    push(state.__p5fStates.notice, text('work-time-notice') ?? 'nenhum');
  };
  read();
  new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
});
const recordedEstimateStates = (page: Page) =>
  page.evaluate(() => (window as unknown as { __p5fStates: { preview: string[]; notice: string[] } }).__p5fStates);

/**
 * P5-F.1-R3.2 (ADV-01): a estimativa indisponível por um motivo decidido antes das receitas (aqui, a fonte PJ sem a
 * confirmação da receita empresarial) não converte e aparece como está, com o motivo real, também sem conexão; a que
 * depende das receitas espera a prova, como a que converte (F-08 e ADV-R3-01, na unidade). A estimativa em uso (renda do PF) converte; a prévia de Configurações, com a fonte trocada para o espaço PJ
 * sem a confirmação da receita empresarial, mostra o motivo. A conexão cai: a estimativa em uso perde a conversão (o
 * sinal de que o SDK passou a servir só do cache local), e a prévia continua com o motivo, sem "calculando" nem "em
 * atualização", por mais que o tempo de interface (30 s). Antes da correção, o retorno só do cache local tirava a
 * confirmação da projeção e a prévia trocava o motivo por "calculando" e, depois, por "em atualização". Com a conexão de
 * volta, a conversão da estimativa em uso volta e o motivo continua; nada é gravado.
 */
test('ADV-01 (R3.2): sem conexão, a estimativa indisponível continua com o motivo real, sem "calculando" nem "em atualização"; a conversão em uso sai e volta com a conexão', async ({ page, request, context }) => {
  test.setTimeout(300_000);
  const tenant = await seedTenant(request);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time' });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  const approximate = 'Valores em tempo de trabalho equivalente: uma estimativa aproximada, não o valor exato.';
  const unavailable = 'Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações.';
  const reason = 'Estimativa indisponível. A fonte escolhida é um espaço PJ. Confirme que quer usar a receita empresarial, ou escolha um espaço PF.';
  await expect(notice(page)).toContainText(approximate, { timeout: 60_000 });
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 60_000 });
  await page.getByLabel('De qual espaço vem a sua renda?').selectOption(tenant.pj.workspaceId);
  await expect(page.getByTestId('work-time-preview-unavailable')).toHaveText(reason, { timeout: 30_000 });
  await expect(notice(page)).toContainText(approximate);
  await recordEstimateStates(page);

  // Sem conexão: a estimativa em uso perde a conversão; a prévia indisponível fica como está, passado o tempo de
  // interface (a estimativa em uso, que esperava a prova, passa a "indisponível agora" no topo).
  await context.setOffline(true);
  await expect(notice(page)).not.toContainText(approximate, { timeout: 60_000 });
  await page.waitForTimeout(35_000);
  await expect(notice(page)).toContainText(unavailable);
  await expect(page.getByTestId('work-time-preview-unavailable')).toHaveText(reason);
  const offline = await recordedEstimateStates(page);
  await test.info().attach('adv-01-sem-conexao', { body: JSON.stringify(offline, null, 2), contentType: 'application/json' });
  console.log(`[estados-adv-01-sem-conexao] ${JSON.stringify(offline)}`);
  expect(offline.preview, 'sem conexão, a prévia só mostrou o motivo real').toEqual([`indisponivel|${reason}`]);
  expect(offline.notice[0], 'antes da queda, a estimativa em uso convertia').toContain(approximate);
  expect(offline.notice.slice(1).some((entry) => entry.includes(approximate)), 'sem conexão, nenhuma conversão em uso').toBe(false);

  // A conexão volta: a conversão da estimativa em uso volta sozinha, e a prévia continua com o motivo.
  await context.setOffline(false);
  await expect(notice(page)).toContainText(approximate, { timeout: 60_000 });
  await expect(page.getByTestId('work-time-preview-unavailable')).toHaveText(reason);
  const seen = await recordedEstimateStates(page);
  await test.info().attach('adv-01', { body: JSON.stringify(seen, null, 2), contentType: 'application/json' });
  console.log(`[estados-adv-01] ${JSON.stringify(seen)}`);
  expect(seen.preview, 'do começo ao fim, a prévia só mostrou o motivo real').toEqual([`indisponivel|${reason}`]);
  await page.getByRole('button', { name: 'Descartar alterações' }).click();
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  expect(await storedPreference(A.uid), 'nada gravado').toMatchObject({
    incomeWorkspaceId: tenant.pf.workspaceId, allowBusinessIncome: false, displayMode: 'time',
  });
});


test('RR-R32-11 (P5-GATE-FINAL): a estimativa que parou antes de calcular os meses não diz "nenhuma" desconsiderada, feriado ou exceção na memória de cálculo', async ({ page, request }) => {
  test.setTimeout(240_000);
  const tenant = await seedTenant(request);
  // A pessoa tem uma folga e uma receita desconsiderada na janela, e a fonte é o espaço PJ sem a confirmação: a
  // estimativa para antes de calcular os meses (motivo decidido antes das receitas).
  const month = habitualMonths()[1];
  const excludedId = await createIncome(request, tenant.pj, `${month}-12`, 30_000, 'Serviço desconsiderado');
  await seedPreference(A.uid, tenant.pj.workspaceId, {
    displayMode: 'money', allowBusinessIncome: false, excludedIncomeIds: excludedId, exceptions: `O${month}-10`, worksOnHolidays: false,
  });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await openWorkTimeSettings(page);
  const reason = 'Estimativa indisponível. A fonte escolhida é um espaço PJ. Confirme que quer usar a receita empresarial, ou escolha um espaço PF.';
  await expect(page.getByTestId('work-time-preview-unavailable')).toHaveText(reason, { timeout: 60_000 });
  await page.getByTestId('work-time-preview-details').click();
  const details = page.getByRole('dialog', { name: 'Como este valor foi calculado?' });
  await expect(details).toContainText('Estimativa indisponível: A fonte escolhida é um espaço PJ.');
  await expect(details).toContainText('As receitas desconsideradas não foram aplicadas: a estimativa parou antes de calcular os meses.');
  await expect(details).toContainText('Feriados, férias, folgas e exceções não foram aplicados: a estimativa parou antes de calcular os meses.');
  for (const falseClaim of ['Você não desconsiderou nenhuma receita.', 'Feriados que tiraram dias de trabalho', 'nenhuma no período']) {
    await expect(details).not.toContainText(falseClaim);
  }
  const detailsViolations = await axeViolations(page, '[data-testid="work-time-details"]');
  expect(detailsViolations, JSON.stringify(detailsViolations, null, 2)).toEqual([]);
  await details.getByRole('button', { name: 'Entendi' }).click();
  expect(await storedPreference(A.uid), 'nada gravado').toMatchObject({ excludedIncomeIds: excludedId, exceptions: `O${month}-10` });
});

// ------------------------------------------------------------- vazamentos

/** Valores derivados da estimativa de A, que só podem existir em memória. */
const derivedNeedles = (tenant: Tenant) => ({
  numbers: [tenant.incomeCents, tenant.workMinutes],
  /** Em reais formatados: comparados em qualquer texto (documentos, payloads, logs e armazenamento local). */
  money: [brlText(tenant.incomeCents), brlText(2_500)],
  /** Todas as formas, só para logs, payloads e armazenamento local (em documentos, ids poderiam conter os dígitos). */
  texts: [brlText(tenant.incomeCents), brlText(2_500), String(tenant.incomeCents), String(tenant.workMinutes)],
});

/** Algum valor folha igual a um derivado (número exato ou texto em reais que o contém). Carimbos de tempo ficam de fora. */
const carriesDerived = (value: unknown, needles: ReturnType<typeof derivedNeedles>): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof (value as { toMillis?: unknown }).toMillis === 'function') return false;
  if (typeof value === 'number') return needles.numbers.includes(value);
  if (typeof value === 'string') return needles.money.some((needle) => value.includes(needle));
  if (Array.isArray(value)) return value.some((item) => carriesDerived(item, needles));
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some((item) => carriesDerived(item, needles));
  return false;
};

/** Console e erros não tratados de cada página do teste, para provar que nada derivado chega aos logs do navegador. */
const watchBrowserLogs = (page: Page, lines: string[] = []): string[] => {
  page.on('console', (message) => lines.push(message.text()));
  page.on('pageerror', (error) => lines.push(String(error)));
  return lines;
};

const expectNoDerivedInLogs = (lines: string[], needles: ReturnType<typeof derivedNeedles>) => {
  const joined = lines.join('\n');
  for (const needle of needles.texts) expect(joined, `log do navegador com "${needle}"`).not.toContain(needle);
  expect(joined).not.toMatch(/W:08:00|excludedIncomeIds|incomeWorkspaceId/);
};

/** Chaves locais com qualquer dado da preferência (deve ser nenhuma). */
const localStorageKeysWithPreference = (entries: Array<[string, string]>, needles: ReturnType<typeof derivedNeedles>) =>
  entries.filter(([key, value]) => /work.?time|private_preferences/i.test(key)
    || needles.texts.some((needle) => value.includes(needle)) || /W:08:00|excludedIncomeIds/.test(value))
    .map(([key]) => key);

// ------------------------------------------------------------------ P5-F.1-R1

/** Grava, na página, cada valor da hora que a prévia mostra (para provar que nenhum estado intermediário aparece). */
const recordPreviewHourly = (page: Page) => page.evaluate(() => {
  const state = window as unknown as { __p5fHourly: string[] };
  state.__p5fHourly = [];
  const read = () => {
    const text = document.querySelector('[data-testid="work-time-preview-hourly"]')?.textContent?.trim() ?? '';
    if (text && state.__p5fHourly[state.__p5fHourly.length - 1] !== text) state.__p5fHourly.push(text);
  };
  read();
  new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
});
const recordedPreviewHourly = async (page: Page) =>
  (await page.evaluate(() => (window as unknown as { __p5fHourly: string[] }).__p5fHourly)).map((text) => text.replace(/\s+/g, ' '));

test('B01 (P5-F.1-R1): recebimento de cliente desconsiderado e estornado em outra sessão: a exclusão perde o efeito e a prévia nunca desconta duas vezes', async ({ page, request }) => {
  test.setTimeout(360_000);
  const tenant = await seedTenant(request);
  // Clientes e recebíveis existem só em espaço PJ: a renda vem do PJ, com a confirmação de renda empresarial,
  // e o faturamento dos três meses é o mesmo da jornada de referência (R$ 25,00 por hora).
  const workspaceId = tenant.pj.workspaceId;
  const billed: Record<string, number> = {};
  for (const month of habitualMonths()) {
    billed[month] = daysIn(month) * A_DAY_CENTS;
    await createIncome(request, tenant.pj, `${month}-05`, billed[month], `Faturamento ${month}`);
  }
  await waitForReceipts(workspaceId, billed);
  const lastMonth = habitualMonths()[2];
  const officialBefore = billed[lastMonth];
  // Um recebimento de cliente de R$ 1.000,00 no último mês completo, pelas callables oficiais.
  const clientId = await createClientByApi(request, tenant.pj.token, workspaceId, { name: 'Cliente P5F1-R1' });
  const receivableId = await createReceivableByApi(request, tenant.pj.token, workspaceId, clientId, {
    description: 'Projeto P5F1-R1', amountCents: 100_000, dueDate: saoPauloToday(),
  });
  const received = await callCallable(request, tenant.pj.token, 'receiveReceivable', {
    workspaceId, idempotencyKey: intentKey('p5f1r1-receive'), receivableId,
    expectedUpdatedAt: versionOf(await docOf(workspaceId, 'receivables', receivableId)),
    principalCents: 100_000, interestCents: 0, penaltyCents: 0, discountCents: 0, paymentDate: `${lastMonth}-15`,
    cashAccountId: tenant.pj.accountId,
  });
  expect(received.status, JSON.stringify(received)).toBe(200);
  const movementId = String(received.result?.movementId);
  const mirrorId = `recvcash_${movementId.slice('rmv_'.length)}`;
  await waitForReceipts(workspaceId, { [lastMonth]: officialBefore + 100_000 });
  expect((await db().doc(`workspaces/${workspaceId}/transactions/${mirrorId}`).get()).exists, 'o espelho de caixa do recebimento').toBe(true);
  // A pessoa já tinha desconsiderado esse recebimento na estimativa.
  await seedPreference(A.uid, workspaceId, { displayMode: 'money', allowBusinessIncome: true, excludedIncomeIds: mirrorId });
  await startOn(page, A.uid, workspaceId);
  await login(page, A.email);
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  await recordPreviewHourly(page);

  // Outra sessão estorna o recebimento: o total oficial do mês volta ao de antes.
  const reversed = await callCallable(request, tenant.pj.token, 'reverseReceivableReceipt', {
    workspaceId, idempotencyKey: intentKey('p5f1r1-reverse'), receivableId,
    expectedUpdatedAt: versionOf(await docOf(workspaceId, 'receivables', receivableId)), movementId, reason: 'Recebido por engano',
  });
  expect(reversed.status, JSON.stringify(reversed)).toBe(200);
  await waitForReceipts(workspaceId, { [lastMonth]: officialBefore });
  // A estimativa acha o estorno pelo identificador oficial: a exclusão perde o efeito, e a renda é a mesma.
  await page.getByTestId('work-time-preview-details').click();
  const details = page.getByRole('dialog', { name: 'Como este valor foi calculado?' });
  await expect(details.getByTestId('work-time-note-exclusions_reversed')).toBeVisible({ timeout: 30_000 });
  await expect(details).toContainText(`Total de receitas elegíveis: ${brlText(tenant.incomeCents)}.`);
  await expect(details.getByTestId('work-time-details-hourly')).toContainText(brl(2_500));
  await details.getByRole('button', { name: 'Entendi' }).click();
  // No painel, o recebimento aparece estornado, com a explicação de que a exclusão não tira nada.
  await page.getByTestId('work-time-income-panel-open').click();
  const panel = page.getByRole('dialog', { name: 'Receitas consideradas' });
  await expect(panel.getByTestId(`income-item-${mirrorId}`)).toContainText(
    'Você o desconsiderou, mas a exclusão não tira nada da estimativa: o estorno já anula o valor.', { timeout: 30_000 });
  await panel.getByRole('button', { name: 'Concluir' }).click();
  await expect(previewHourly(page)).toHaveText(brl(2_500));
  // Do começo ao fim, só R$ 25,00: nunca o estorno somado ao total com a exclusão ainda aplicada.
  expect(await recordedPreviewHourly(page), 'nenhum valor intermediário na prévia').toEqual([brlText(2_500).replace(/\s+/g, ' ')]);
  // Nada foi gravado na preferência nem no recebimento pela estimativa.
  expect((await storedPreference(A.uid))?.excludedIncomeIds).toBe(mirrorId);
});

test('B02 (P5-F.1-R1): acrescentar uma rotina válida não reduz as horas; rotinas que se cruzam com intervalo são recusadas com aviso acessível', async ({ page, request }) => {
  test.setTimeout(240_000);
  const tenant = await seedTenant(request);
  // 08:00–12:00 e 13:00–17:00, sem intervalo, todos os dias: 8 h por dia, como a jornada de referência.
  const halves = ['08:00-12:00/0', '13:00-17:00/0'].map((day) => `W:${Array(7).fill(day).join(',')}`).join(';');
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'money', routines: halves });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  const before = await storedPreference(A.uid);

  // O exemplo do parecer: 09:00–11:00 com 90 min de intervalo, de segunda a sexta, dentro da manhã sem
  // intervalo. Antes, as horas desses dias caíam de 8 h para 6 h 30 min; agora continuam 8 h.
  await page.getByRole('button', { name: 'Adicionar outra rotina' }).click();
  const third = page.getByTestId('routine-2');
  const template = third.getByRole('group', { name: 'Jornada para aplicar a vários dias' });
  await template.getByLabel('Início').fill('09:00');
  await template.getByLabel('Fim').fill('11:00');
  await template.getByLabel('Intervalo (min)').fill('90');
  await third.getByRole('button', { name: 'Aplicar aos dias marcados' }).click();
  await expect(page.getByTestId('routines-ambiguity')).toHaveCount(0);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  await expect(saveButton(page)).toBeEnabled();

  // 11:00–14:00 com 60 min de intervalo cruza a pausa do almoço: não dá para saber onde cai o intervalo.
  await template.getByLabel('Início').fill('11:00');
  await template.getByLabel('Fim').fill('14:00');
  await template.getByLabel('Intervalo (min)').fill('60');
  await third.getByRole('button', { name: 'Aplicar aos dias marcados' }).click();
  const alert = page.getByTestId('routines-ambiguity');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText(/A Rotina 1, a Rotina 2 e a Rotina 3 se cruzam em [a-zç-]+, \d{2}\/\d{2}\/\d{4}, e há intervalo no trecho em comum/);
  await expect(alert).toContainText('não dá para saber onde cai a pausa, então as horas não podem ser calculadas com segurança');
  // A rotina ambígua não entra no rascunho: salvar fica bloqueado, nada é gravado, e a prévia continua a da
  // última rotina válida (como em qualquer rotina inválida).
  await expect(saveButton(page)).toBeDisabled();
  await expect(previewHourly(page)).toHaveText(brl(2_500));
  expect(await storedPreference(A.uid), 'nada é gravado').toEqual(before);
  for (const selector of ['[data-testid="routine-2"]', '[data-testid="routines-ambiguity"]']) {
    const violations = await axeViolations(page, selector);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }

  // Sem a terceira rotina, tudo volta.
  await third.getByRole('button', { name: 'Remover rotina 3' }).click();
  await expect(page.getByTestId('routines-ambiguity')).toHaveCount(0);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  await page.getByRole('button', { name: 'Descartar alterações' }).click();

  // Uma configuração ambígua já gravada (por exemplo, antes desta correção, em outro dispositivo): o motor
  // de calendário a recusa, a estimativa fica indisponível, sem valor da hora, e o editor mostra o aviso.
  const ambiguous = `${halves};W:${[...Array(5).fill('11:00-14:00/60'), '-', '-'].join(',')}`;
  await db().doc(preferencePath(A.uid)).update({ routines: ambiguous });
  await page.reload();
  await openWorkTimeSettings(page);
  await expect(page.getByTestId('work-time-preview-unavailable'))
    .toContainText('rotinas se cruzam e há intervalo no trecho em comum', { timeout: 30_000 });
  await expect(previewHourly(page)).toHaveCount(0);
  await expect(page.getByTestId('routines-ambiguity')).toContainText('se cruzam em');

  // Revisão 4 da R1 (Q02): aberta assim, sem nenhuma edição, a tela não está em edição. O título é o do valor em
  // uso, sem "Nada foi salvo ainda." nem "Descartar alterações", e salvar fica desabilitado.
  const preview = page.getByTestId('work-time-preview');
  const notEditing = async () => {
    await expect(preview).toContainText('Valor estimado da sua hora');
    await expect(preview).not.toContainText('Prévia com as alterações');
    await expect(page.getByTestId('work-time-unsaved')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Descartar alterações' })).toHaveCount(0);
    await expect(saveButton(page)).toBeDisabled();
  };
  await notEditing();

  // P5-F.1-R2A (S03): mudar só a jornada para aplicar a vários dias, sem aplicar, não é edição. A tela continua fora
  // de edição, com o mesmo aviso.
  const savedThird = page.getByTestId('routine-2');
  const savedTemplateEnd = savedThird.getByRole('group', { name: 'Jornada para aplicar a vários dias' }).getByLabel('Fim');
  await expect(savedTemplateEnd).toHaveValue('14:00');
  await savedTemplateEnd.fill('15:00');
  await expect(savedTemplateEnd).toHaveValue('15:00');
  await notEditing();
  await expect(page.getByTestId('routines-ambiguity')).toContainText('se cruzam em');

  // Uma edição de verdade, que continua com o cruzamento (aplicar 11:00–15:00 com 60 min), põe a tela em edição;
  // "Descartar alterações" volta à configuração gravada, com a jornada em 14:00, e tira a tela da edição. Nada é gravado.
  await savedThird.getByRole('button', { name: 'Aplicar aos dias marcados' }).click();
  await expect(preview).toContainText('Prévia com as alterações');
  await expect(page.getByTestId('work-time-unsaved')).toBeVisible();
  await expect(page.getByTestId('routines-ambiguity')).toContainText('se cruzam em');
  await expect(saveButton(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Descartar alterações' }).click();
  await notEditing();
  await expect(savedTemplateEnd).toHaveValue('14:00');
  await expect(page.getByTestId('routines-ambiguity')).toContainText('se cruzam em');
  expect((await storedPreference(A.uid))?.routines, 'nada é gravado').toBe(ambiguous);

  // P5-F.1-R2A (S03): a digitação inválida é edição. Apagar o "Fim" de segunda na rotina 3 põe a tela em edição, com a
  // mensagem do problema na rotina; "Descartar alterações" volta ao gravado. Nada é gravado.
  const mondayEnd = savedThird.getByRole('group', { name: 'Segunda-feira' }).getByLabel('Fim');
  await expect(mondayEnd).toHaveValue('14:00');
  await mondayEnd.fill('');
  await expect(preview).toContainText('Prévia com as alterações');
  await expect(page.getByTestId('work-time-unsaved')).toBeVisible();
  await expect(savedThird.getByRole('alert')).toHaveText('Rotina 3, segunda-feira: Use horários no formato 08:00.');
  await expect(saveButton(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Descartar alterações' }).click();
  await notEditing();
  await expect(mondayEnd).toHaveValue('14:00');
  expect((await storedPreference(A.uid))?.routines, 'nada é gravado').toBe(ambiguous);

  // Corrigida em outro dispositivo, a configuração gravada entra na tela, sem o aviso de conflito.
  await db().doc(preferencePath(A.uid)).update({ routines: halves });
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 30_000 });
  await expect(page.getByTestId('routines-ambiguity')).toHaveCount(0);
  await expect(page.getByText('A configuração foi alterada em outra aba ou dispositivo')).toHaveCount(0);
  await notEditing();
});

test('B02 (revisão da R1, N07): a folga que deixa as rotinas sem cálculo seguro é recusada em Configurações, com aviso acessível junto do botão de salvar', async ({ page, request }) => {
  test.setTimeout(180_000);
  const tenant = await seedTenant(request);
  // Segunda 20:00–24:00 e 22:00–02:00 com 30 min, e terça 00:00–08:00: a janela com intervalo fica coberta pelas outras.
  const routines = ['W:20:00-00:00/0,-,-,-,-,-,-', 'W:22:00-02:00/30,-,-,-,-,-,-', 'W:-,00:00-08:00/0,-,-,-,-,-'].join(';');
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'money', routines });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await openWorkTimeSettings(page);
  await expect(page.getByTestId('routines-ambiguity')).toHaveCount(0);
  await expect(page.getByTestId('work-time-calendar-ambiguity')).toHaveCount(0);
  const before = await storedPreference(A.uid);

  // A próxima terça depois de hoje e a segunda antes dela.
  const shift = (iso: string, days: number) => {
    const date = new Date(`${iso}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const today = saoPauloToday();
  const tuesday = shift(today, ((2 - new Date(`${today}T12:00:00Z`).getUTCDay() + 7) % 7) || 7);
  const monday = shift(tuesday, -1);
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

  // Uma folga nessa terça tira a janela que cobria o trecho depois da meia-noite de segunda.
  await page.getByLabel('Tipo de exceção').selectOption({ label: 'Folga' });
  await page.getByLabel('De', { exact: true }).fill(tuesday);
  await page.getByRole('button', { name: 'Incluir exceção' }).click();
  const alert = page.getByTestId('work-time-calendar-ambiguity');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toHaveText(`A Rotina 1 e a Rotina 2 se cruzam em segunda-feira, ${br(monday)}, e há intervalo no trecho em comum. Com a folga de terça-feira, ${br(tuesday)}, o horário sem intervalo que cobria esse trecho não acontece: não dá para saber onde cai a pausa, então as horas não podem ser calculadas com segurança. Ajuste os horários das rotinas ou essa exceção.`);
  await expect(page.getByTestId('routines-ambiguity')).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();
  expect(await storedPreference(A.uid), 'nada é gravado').toEqual(before);
  const violations = await axeViolations(page, '[data-testid="work-time-calendar-ambiguity"]');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);

  // Sem a folga, o aviso some.
  await page.getByRole('button', { name: /^Remover: Folga/ }).click();
  await expect(alert).toHaveCount(0);
});

test('S01 (P5-F.1-R2A): a jornada reduzida que deixa o dia seguinte sem cálculo seguro é recusada em Configurações, e a gravada assim deixa a estimativa indisponível', async ({ page, request }) => {
  test.setTimeout(240_000);
  const tenant = await seedTenant(request);
  const shift = (iso: string, days: number) => {
    const date = new Date(`${iso}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  // Segunda 20:00–06:00 e terça 00:00–08:00, sem intervalo. A primeira segunda do mês passado (na janela da
  // estimativa) reduzida a 8 h: das 20:00 à meia-noite cabem 4 h, e as horas da terça dependem de quando foram as outras.
  const routines = 'W:20:00-06:00/0,00:00-08:00/0,-,-,-,-,-';
  const previousMonth = shiftMonth(currentMonth(), -1);
  const monday = shift(`${previousMonth}-01`, (8 - new Date(`${previousMonth}-01T12:00:00Z`).getUTCDay()) % 7);
  const tuesday = shift(monday, 1);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'money', routines, exceptions: `R${monday}=480` });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await openWorkTimeSettings(page);
  const message = `Com a jornada reduzida de segunda-feira, ${br(monday)}, não dá para confirmar que parte do horário que passa da meia-noite (Rotina 1) foi trabalhada, e por isso as horas de terça-feira, ${br(tuesday)}, não podem ser calculadas com segurança. Troque a jornada reduzida desse dia por uma alteração de escala ou ajuste os horários das rotinas.`;

  // Gravada assim (antes desta correção, ou em outro dispositivo): a estimativa fica indisponível, sem valor da hora, e
  // o aviso aparece junto do botão de salvar. A tela não está em edição, e salvar fica desabilitado.
  await expect(page.getByTestId('work-time-preview-unavailable')).toHaveText('Estimativa indisponível. Em algum dia do período, o dia anterior tem jornada reduzida num horário que passa da meia-noite, e não dá para confirmar que parte dele foi trabalhada: as horas desse dia não podem ser calculadas com segurança. Ajuste as exceções ou as rotinas em Configurações.', { timeout: 30_000 });
  await expect(previewHourly(page)).toHaveCount(0);
  const alert = page.getByTestId('work-time-calendar-ambiguity');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toHaveText(message);
  await expect(page.getByTestId('routines-ambiguity')).toHaveCount(0);
  const preview = page.getByTestId('work-time-preview');
  await expect(preview).toContainText('Valor estimado da sua hora');
  await expect(page.getByTestId('work-time-unsaved')).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();
  const violations = await axeViolations(page, '[data-testid="work-time-calendar-ambiguity"]');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  // No calendário de exceções, a terça fica sem horas, com a causa no nome acessível.
  const monthHeading = page.getByTestId('settings-exceptions-month');
  await monthHeading.locator('..').getByRole('button', { name: 'Mês anterior' }).click();
  await expect(monthHeading).toContainText('horas sem cálculo seguro');
  const tuesdayCell = page.getByTestId('settings-exceptions-calendar').locator(`[data-date="${tuesday}"]`);
  await expect(tuesdayCell).toContainText('horas sem cálculo seguro: jornada reduzida na véspera');
  await expect(tuesdayCell).toContainText('?');

  // Sem a jornada reduzida, a estimativa volta e salvar grava a correção.
  await page.getByRole('button', { name: /^Remover: Jornada reduzida/ }).click();
  await expect(alert).toHaveCount(0);
  await expect(previewHourly(page)).toHaveText(/^R\$\s?\d/, { timeout: 30_000 });
  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).click();
  await expect.poll(async () => (await storedPreference(A.uid))?.exceptions, { timeout: 20_000 }).toBe('');
  await expect(saveButton(page)).toBeDisabled();

  // Incluir de novo 8 h de jornada reduzida nessa segunda é recusado na hora, e nada é gravado; com 10 h (o turno
  // inteiro: a redução não corta nada), é aceito.
  const before = await storedPreference(A.uid);
  const addReduced = async (hours: string) => {
    await page.getByLabel('Tipo de exceção').selectOption({ label: 'Jornada reduzida' });
    await page.getByLabel('De', { exact: true }).fill(monday);
    await page.getByLabel('Horas', { exact: true }).fill(hours);
    await page.getByLabel('Minutos', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Incluir exceção' }).click();
  };
  await addReduced('8');
  await expect(alert).toHaveText(message);
  await expect(previewHourly(page)).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();
  expect(await storedPreference(A.uid), 'nada é gravado').toEqual(before);
  await page.getByRole('button', { name: /^Remover: Jornada reduzida/ }).click();
  await addReduced('10');
  await expect(alert).toHaveCount(0);
  await expect(previewHourly(page)).toHaveText(/^R\$\s?\d/, { timeout: 30_000 });
  await expect(saveButton(page)).toBeEnabled();
});
