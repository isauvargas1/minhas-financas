import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { createAccountByApi } from './support/accounts';
import { axeViolations } from './support/axe';
import { callCallable, runPagedCallable } from './support/callables';
import { brl, db, intentKey, login, PASSWORD, resetEmulatorData, summaryFigure, tokenOf } from './support/loans';
import { versionOf } from './support/receivables';
import { adminSdk, seedAccountProfile, seedMembership, seedOwnedWorkspace, seedPaidPlan } from './support/workspaceSeed';

/**
 * P5-F.1-R3 (B03) — a estimativa de tempo de trabalho com receitas desconsideradas só converte quando a
 * projeção mensal contém exatamente o conteúdo lido de cada desconsiderada (marcas de aplicação), de ponta a
 * ponta no Emulator (Auth, Firestore, Functions e Rules reais; dados sintéticos).
 *
 * Cada cenário registra, dentro da página, TODO valor convertido que o saldo do Dashboard e a prévia da hora
 * mostram durante a transição (`MutationObserver`) e afirma que só aparecem valores de estados consistentes:
 * o saldo convertido pela renda certa do estado, ou em reais. Nenhum prazo aprova a conversão.
 *
 * a. edição da desconsiderada em outra sessão (outro usuário): nunca o valor novo com o total velho;
 * b. marca quebrada: reais e, depois do tempo de interface, "estimativa em atualização" (acessível, celular);
 * c. reconstrução (owner) recupera a marca e a conversão volta com o valor certo;
 * d. incluir e tirar uma receita da lista de exclusões pessoais: a prova é refeita nas duas direções;
 * e. a desconsiderada sai da janela da estimativa e volta: nunca desconto duplo nem falta de desconto.
 * f. (P5-F.1-R3.1, R3-AUD-01) com a estimativa provada na tela, uma leitura nova sem prova (marca quebrada e receita
 *    nova no mês escolhido): o saldo novo fica em reais, nunca convertido pela estimativa anterior, e a reconstrução
 *    traz a conversão com a renda nova.
 * g. (P5-F.1-R3.2, RR-R31-05) sem desconsiderada e com uma base: sem conexão, a conversão sai; a prévia aberta de novo
 *    com o cache aquecido não converte antes de um retorno do servidor, nem passado o tempo de interface; com a conexão
 *    de volta, a conversão certa volta sozinha.
 */

test.use({ timezoneId: 'America/Sao_Paulo' });

const A = { uid: 'e2e-b03-a', email: 'e2e-b03-a@minhas-financas.local' };
const M = { uid: 'e2e-b03-m', email: 'e2e-b03-m@minhas-financas.local' };
/** Centavos por dia de trabalho de 8 h a R$ 25,00 por hora. */
const A_DAY_CENTS = 8 * 2_500;
const OPENING_CENTS = 100_000;
const SEVEN_DAYS = 'W:08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60';
const CATALOG = { incomeType: 'Salário B03', incomeCategory: 'Renda B03' };
/** O texto fixo de `ESTIMATE_UPDATING` (src/modules/work-time/messages.ts). */
const UPDATING_TEXT = 'A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais. Enquanto isso, os valores ficam em reais.';
const NBSP = ' ';

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

// --------------------------------------------------------------- cálculos

/** Reais formatados como texto. */
const brlText = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
const roundedMinutes = (cents: number, workMinutes: number, incomeCents: number) =>
  Number((2n * BigInt(cents) * BigInt(workMinutes) + BigInt(incomeCents)) / (2n * BigInt(incomeCents)));
/** Texto do tempo como `formatWorkTime`: `≈ 776 h`, `≈ 14 h 5 min`. */
const workTimeText = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours.toLocaleString('pt-BR')}${NBSP}h`);
  if (rest > 0) parts.push(`${rest}${NBSP}min`);
  return `≈${NBSP}${parts.join(NBSP)}`;
};
const timeRegex = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return new RegExp(`≈\\s${hours.toLocaleString('pt-BR').replace('.', '\\.')}\\sh${rest ? `\\s${rest}\\smin` : ''}(?!\\s?\\d)`);
};
const hourlyCents = (income: number, workMinutes: number) =>
  Number((2n * BigInt(income) * 60n + BigInt(workMinutes)) / (2n * BigInt(workMinutes)));

// ------------------------------------------------------------------ preparo

const preferencePath = (uid: string) => `users/${uid}/private_preferences/work_time_equivalent`;
const storedPreference = async (uid: string) => (await db().doc(preferencePath(uid)).get()).data() ?? null;
const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

const seedCatalog = async (workspaceId: string, uid: string) => {
  const now = new Date();
  const items: Array<[string, string, string, string?]> = [
    ['b03-income-type', 'income_type', CATALOG.incomeType],
    ['b03-income-category', 'category', CATALOG.incomeCategory, 'receita'],
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
): Promise<string> => {
  const outcome = await callCallable(request, seeded.token, 'createCashTransaction', {
    workspaceId: seeded.workspaceId, idempotencyKey: intentKey(`b03-${description}`), cashAccountId: seeded.accountId,
    type: 'receita', description, categoryId: 'b03-income-category', incomeType: CATALOG.incomeType, amountCents, date,
  });
  expect(outcome.status, JSON.stringify(outcome)).toBe(200);
  return String(outcome.result?.transactionId);
};

/** Correção do lançamento pela callable oficial (valor e data), com a versão atual lida do servidor. */
const editIncome = async (
  request: APIRequestContext, seeded: Seeded, transactionId: string, description: string, amountCents: number, date: string,
) => {
  const current = (await db().doc(`workspaces/${seeded.workspaceId}/transactions/${transactionId}`).get()).data() ?? {};
  const outcome = await callCallable(request, seeded.token, 'updateCashTransaction', {
    workspaceId: seeded.workspaceId, idempotencyKey: intentKey(`b03-edit-${amountCents}-${date}`), transactionId,
    expectedUpdatedAt: versionOf(current), reason: 'Correção de valor e data (E2E B03)',
    entry: {
      type: 'receita', description, categoryId: 'b03-income-category', incomeType: CATALOG.incomeType, amountCents, date,
      cashAccountId: seeded.accountId,
    },
  });
  expect(outcome.status, JSON.stringify(outcome)).toBe(200);
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

const markPath = (workspaceId: string, transactionId: string) => `workspaces/${workspaceId}/cash_projection_marks/${transactionId}`;

/** A marca do lançamento existe (o gatilho a grava na mesma transação do delta). */
const waitForMark = async (workspaceId: string, transactionId: string) => {
  await expect.poll(async () => (await db().doc(markPath(workspaceId, transactionId)).get()).exists, {
    timeout: 45_000, message: `marca de ${transactionId}`,
  }).toBe(true);
};

interface Tenant { pf: Seeded; member: Seeded; baseCents: number; incomeCents: number; workMinutes: number }

/** Dono A e membro M no mesmo espaço pessoal; três meses de salário que dão exatamente R$ 25,00 por hora. */
const seedTenant = async (request: APIRequestContext): Promise<Tenant> => {
  const suffix = Date.now().toString(36);
  const pfId = `e2e-b03-pf-${suffix}`;
  for (const user of [A, M]) {
    await adminSdk().auth().createUser({ ...user, password: PASSWORD, emailVerified: true });
  }
  await seedOwnedWorkspace({ ...A, workspaceId: pfId, name: 'Pessoal B03', type: 'PF' });
  await seedPaidPlan(A.uid, 'business');
  await seedAccountProfile(M);
  await seedMembership({ workspaceId: pfId, uid: M.uid, email: M.email, role: 'member', name: 'Pessoal B03', type: 'PF' });
  await seedCatalog(pfId, A.uid);
  const token = await tokenOf(request, A.email);
  const pf = { token, workspaceId: pfId, accountId: await createAccountByApi(request, token, pfId, 'Conta B03', { openingBalanceCents: OPENING_CENTS }) };
  const member = { token: await tokenOf(request, M.email), workspaceId: pfId, accountId: pf.accountId };
  const expected: Record<string, number> = {};
  for (const month of habitualMonths()) {
    expected[month] = daysIn(month) * A_DAY_CENTS;
    await createIncome(request, pf, `${month}-05`, expected[month], `Salário ${month}`);
  }
  await waitForReceipts(pfId, expected);
  const lastMonth = habitualMonths()[2];
  return { pf, member, baseCents: expected[lastMonth], incomeCents: habitualDays() * A_DAY_CENTS, workMinutes: habitualDays() * 480 };
};

/** Preferência v2 gravada como o cliente gravaria. */
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
    updatedAt: adminSdk().firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
};

const startOn = async (page: Page, uid: string, workspaceId: string) => {
  await page.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value);
  }, [`lastWorkspaceId_${uid}`, workspaceId]);
};

/** Posição (`a` ou `b`) da âncora ou da cadeia da geração dada, com o que a marca guarda nela. */
const markOfGeneration = async (workspaceId: string, transactionId: string, generationId: string) => {
  const mark = (await db().doc(markPath(workspaceId, transactionId)).get()).data() as {
    anchors?: Record<string, { g?: string }>; chains?: Record<string, { g?: string; broken?: string | null }>;
  } | undefined;
  const slot = (['a', 'b'] as const).find((candidate) => mark?.anchors?.[candidate]?.g === generationId || mark?.chains?.[candidate]?.g === generationId);
  expect(slot, `âncora ou cadeia da geração ${generationId} em ${JSON.stringify(mark)}`).toBeDefined();
  return { slot: slot as 'a' | 'b', anchor: mark?.anchors?.[slot as 'a' | 'b'] ?? null, chain: mark?.chains?.[slot as 'a' | 'b'] ?? null };
};

/** Posição (`a` ou `b`) da cadeia da marca que pertence à geração vigente dos meses da projeção. */
const currentMarkSlot = async (workspaceId: string, transactionId: string, month: string) => {
  const generation = (await db().doc(`workspaces/${workspaceId}/cash_report_periods/${month}`).get()).data()?.projectionGeneration as { id?: string } | undefined;
  const mark = (await db().doc(markPath(workspaceId, transactionId)).get()).data() as { chains?: Record<string, { g?: string; cut?: unknown; broken?: string | null }> } | undefined;
  const slot = (['a', 'b'] as const).find((candidate) => mark?.chains?.[candidate]?.g === generation?.id);
  expect(slot, `cadeia da geração ${generation?.id} em ${JSON.stringify(mark)}`).toBeDefined();
  return { slot: slot as 'a' | 'b', generationId: String(generation?.id), chain: mark?.chains?.[slot as 'a' | 'b'] };
};

// --------------------------------------------------------------- seletores

const notice = (page: Page) => page.getByTestId('work-time-notice');
const balanceCard = (page: Page) => summaryFigure(page, 'Saldo Atual');
const saveButton = (page: Page) => page.getByTestId('work-time-save');
const previewHourly = (page: Page) => page.getByTestId('work-time-preview-hourly');
const previewError = (page: Page) => page.getByTestId('work-time-preview-error');

/**
 * O saldo do Dashboard vem do relatório oficial, que só é relido quando muda o documento mensal do mês corrente ou
 * do mês escolhido no topo. Com o mês anterior escolhido, as mudanças da projeção desse mês também o atualizam.
 */
const selectLastMonth = async (page: Page) => {
  await page.getByRole('button', { name: 'Mês anterior' }).click();
  await expect(balanceCard(page)).toBeVisible({ timeout: 20_000 });
};

const openDashboard = async (page: Page) => {
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(balanceCard(page)).toBeVisible({ timeout: 20_000 });
};

const openWorkTimeSettings = async (page: Page) => {
  await page.getByText('Configurações', { exact: true }).first().click();
  await page.getByRole('button', { name: /Tempo de trabalho equivalente/ }).click();
  await expect(page.getByRole('heading', { name: 'Tempo de trabalho equivalente', level: 2 })).toBeVisible({ timeout: 20_000 });
};

// ------------------------------------------------------------- registrador

interface Recorded { balance: string[]; hourly: string[]; notice: string[] }

/**
 * Registra, dentro da página, cada valor distinto que o saldo do Dashboard (`tempo|…` quando convertido,
 * `reais|…` quando não), a prévia da hora e o aviso do topo mostram, na ordem em que apareceram.
 */
const startRecording = (page: Page) => page.evaluate(() => {
  const state = window as unknown as { __b03: { balance: string[]; hourly: string[]; notice: string[] } };
  state.__b03 = { balance: [], hourly: [], notice: [] };
  const push = (list: string[], text: string | undefined) => {
    if (text && list[list.length - 1] !== text) list.push(text);
  };
  const read = () => {
    const figure = [...document.querySelectorAll('[role="figure"], figure')].find((node) => (node.textContent ?? '').includes('Saldo Atual'));
    if (figure) {
      const converted = figure.querySelector('[data-work-time] [aria-hidden="true"]');
      if (converted) push(state.__b03.balance, `tempo|${(converted.textContent ?? '').trim()}`);
      else {
        const money = /-?R\$\s?[\d.]+,\d{2}/.exec(figure.textContent ?? '');
        if (money) push(state.__b03.balance, `reais|${money[0]}`);
      }
    }
    push(state.__b03.hourly, document.querySelector('[data-testid="work-time-preview-hourly"]')?.textContent?.trim());
    push(state.__b03.notice, document.querySelector('[data-testid="work-time-notice"]')?.textContent?.trim());
  };
  read();
  new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
});

const recorded = (page: Page): Promise<Recorded> => page.evaluate(() => {
  const state = window as unknown as { __b03: Recorded };
  return { balance: [...state.__b03.balance], hourly: [...state.__b03.hourly], notice: [...state.__b03.notice] };
});

const attachRecorded = async (label: string, value: Recorded) => {
  await test.info().attach(`valores-${label}`, { body: JSON.stringify(value, null, 2), contentType: 'application/json' });
  console.log(`[valores-${label}] ${JSON.stringify(value)}`);
};

/**
 * Afirma que o saldo só apareceu convertido por uma das estimativas permitidas (`minutes`) ou em um dos
 * valores em reais permitidos (`balances`), e que a prévia da hora só mostrou uma das horas permitidas.
 */
const expectOnlyConsistent = (
  seen: Recorded,
  allowed: { minutes: number[]; balances: number[]; hourly?: number[] },
) => {
  const times = new Set(allowed.minutes.map((minutes) => norm(workTimeText(minutes))));
  const moneys = new Set(allowed.balances.map((cents) => norm(brlText(cents))));
  expect(seen.balance.length, 'o registrador viu o saldo').toBeGreaterThan(0);
  const offenders = seen.balance.filter((entry) => {
    const [kind, text] = [entry.slice(0, entry.indexOf('|')), norm(entry.slice(entry.indexOf('|') + 1))];
    return kind === 'tempo' ? !times.has(text) : !moneys.has(text);
  });
  expect(offenders, `saldo mostrado fora dos estados consistentes: ${JSON.stringify(seen.balance)}`).toEqual([]);
  if (allowed.hourly) {
    const hourlies = new Set(allowed.hourly.map((cents) => norm(brlText(cents))));
    const stray = seen.hourly.filter((text) => !hourlies.has(norm(text)));
    expect(stray, `hora mostrada fora dos estados consistentes: ${JSON.stringify(seen.hourly)}`).toEqual([]);
  }
};

const lastBalance = (seen: Recorded) => seen.balance[seen.balance.length - 1] ?? '';

// =================================================================== testes

test.beforeEach(async () => {
  await resetEmulatorData();
});

test('B03-a: receita desconsiderada editada por outro usuário: o saldo nunca converte o valor novo com o total velho e volta a converter certo', async ({ page, request }) => {
  test.setTimeout(300_000);
  const tenant = await seedTenant(request);
  const lastMonth = habitualMonths()[2];
  const description = 'Comissão B03 editada';
  // M (membro do mesmo espaço) lança a receita; A a desconsidera e acompanha a tela.
  const extraId = await createIncome(request, tenant.member, `${lastMonth}-15`, 50_000, description);
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents + 50_000 });
  await waitForMark(tenant.pf.workspaceId, extraId);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time', excludedIncomeIds: extraId });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await selectLastMonth(page);

  // Estados consistentes: a renda da estimativa é sempre a oficial sem a desconsiderada (R$ 25,00/h); só o
  // saldo muda a cada edição.
  const amounts = [50_000, 300_000, 120_000, 450_000];
  const balances = amounts.map((amount) => OPENING_CENTS + tenant.incomeCents + amount);
  const minutesOf = (balance: number) => roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents);
  await expect(balanceCard(page)).toContainText(timeRegex(minutesOf(balances[0])), { timeout: 60_000 });
  await startRecording(page);

  // Outro usuário corrige o valor três vezes em seguida, sem esperar o gatilho entre elas.
  for (const amount of amounts.slice(1)) await editIncome(request, tenant.member, extraId, description, amount, `${lastMonth}-15`);
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents + amounts[3] });
  await expect(balanceCard(page)).toContainText(timeRegex(minutesOf(balances[3])), { timeout: 60_000 });

  const seen = await recorded(page);
  await attachRecorded('b03-a', seen);
  expectOnlyConsistent(seen, { minutes: balances.map(minutesOf), balances });
  expect(lastBalance(seen).startsWith('tempo|'), 'termina convertido').toBe(true);
  expect(norm(lastBalance(seen).slice(6))).toBe(norm(workTimeText(minutesOf(balances[3]))));
  expect(await storedPreference(A.uid), 'a estimativa não grava nada').toMatchObject({ excludedIncomeIds: extraId, displayMode: 'time' });
});

/** Cenário das marcas quebradas: a desconsiderada de R$ 500,00 tem a cadeia da geração vigente marcada como `pending_overflow`. */
const seedBrokenMark = async (request: APIRequestContext) => {
  const tenant = await seedTenant(request);
  const lastMonth = habitualMonths()[2];
  const extraId = await createIncome(request, tenant.pf, `${lastMonth}-15`, 50_000, 'Comissão B03 marca quebrada');
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents + 50_000 });
  await waitForMark(tenant.pf.workspaceId, extraId);
  const before = await currentMarkSlot(tenant.pf.workspaceId, extraId, lastMonth);
  await db().doc(markPath(tenant.pf.workspaceId, extraId)).update({ [`chains.${before.slot}.broken`]: 'pending_overflow' });
  const after = await currentMarkSlot(tenant.pf.workspaceId, extraId, lastMonth);
  expect(after.chain, 'a geração (g) e o corte (cut) seguem os vigentes').toMatchObject({ g: before.generationId, broken: 'pending_overflow' });
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time', excludedIncomeIds: extraId });
  return { tenant, extraId, lastMonth, balance: OPENING_CENTS + tenant.incomeCents + 50_000, brokenSlot: after.slot, generationId: after.generationId };
};

/** Largura útil: nada do alerta passa da janela, a página não rola na horizontal e o texto não é cortado. */
const expectFitsViewport = async (page: Page, target: Locator, width: number) => {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box, 'alerta com caixa visível').not.toBeNull();
  expect(box!.x, 'alerta dentro da janela (esquerda)').toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, 'alerta dentro da janela (direita)').toBeLessThanOrEqual(width + 0.5);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'sem rolagem horizontal da página').toBeLessThanOrEqual(0);
  const clipped = await target.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(clipped, 'texto do alerta sem corte').toBeLessThanOrEqual(0);
  const fontSize = await target.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(fontSize, 'tamanho de letra legível').toBeGreaterThanOrEqual(14);
};

/**
 * Teclado no estado "em atualização" (revisão pt-BR da R3, M-02). A partir do título do painel, Tab chega a "Tentar
 * de novo", com foco visível (anel de foco), e Enter e Espaço o acionam: cada um pede de novo o relatório oficial, e
 * o foco continua no botão.
 */
const expectKeyboardRetry = async (page: Page, retry: Locator, label: string) => {
  await page.getByRole('heading', { name: 'Tempo de trabalho equivalente', level: 2 }).click();
  // O formulário tem rotinas, feriados e o calendário do mês antes do bloco da estimativa: até 400 Tabs.
  let reached = false;
  let presses = 0;
  while (presses < 400 && !reached) {
    await page.keyboard.press('Tab');
    presses += 1;
    reached = await retry.evaluate((node) => node === document.activeElement);
  }
  expect(reached, `${label}: Tab chega a "Tentar de novo" (${presses} Tabs)`).toBe(true);
  await test.info().attach(`b03-b-teclado-${label}`, { body: JSON.stringify({ tabs: presses }), contentType: 'application/json' });
  expect(await retry.evaluate((node) => node.matches(':focus-visible')), `${label}: foco visível`).toBe(true);
  const ring = await retry.evaluate((node) => getComputedStyle(node).boxShadow);
  expect(ring, `${label}: anel de foco desenhado`).not.toBe('none');
  for (const key of ['Enter', 'Space']) {
    const report = page.waitForRequest((sent) => sent.url().includes('getFinancialReport'), { timeout: 15_000 });
    await page.keyboard.press(key);
    await report;
    await expect.poll(() => retry.evaluate((node) => node === document.activeElement), { message: `${label}: foco continua no botão depois de ${key}` }).toBe(true);
  }
};

test('B03-b: marca quebrada: não converte, mostra reais e, depois do tempo de interface, "estimativa em atualização" acessível e legível no celular', async ({ page, request }) => {
  test.setTimeout(300_000);
  const { tenant, balance } = await seedBrokenMark(request);
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await expect(balanceCard(page)).toContainText(brl(balance), { timeout: 30_000 });
  await startRecording(page);

  // Nos Dashboard: sem prova, nada de tempo; o aviso do topo diz que está calculando e os valores seguem em reais.
  await expect(notice(page)).toContainText('Calculando a estimativa de tempo de trabalho: enquanto isso, os valores ficam em reais.', { timeout: 30_000 });
  await expect(page.locator('[data-work-time]')).toHaveCount(0);

  // Em Configurações: sem hora estimada; depois do tempo de interface, a mensagem fixa, com "Tentar de novo".
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveCount(0);
  const failure = previewError(page);
  await expect(failure).toContainText(UPDATING_TEXT, { timeout: 60_000 });
  await expect(failure.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await expect(previewHourly(page)).toHaveCount(0);
  await expect(failure).not.toContainText(/permission|insufficient|firestore|firebase|pending_overflow|broken/i);

  // Acessibilidade no estado de erro (desktop), inclusive por teclado.
  const settingsViolations = await axeViolations(page, '[data-testid="work-time-settings"]');
  expect(settingsViolations, JSON.stringify(settingsViolations, null, 2)).toEqual([]);
  await expectKeyboardRetry(page, failure.getByRole('button', { name: 'Tentar de novo' }), 'desktop');
  await expect(failure).toContainText(UPDATING_TEXT);
  await expect(previewHourly(page)).toHaveCount(0);

  // Celular 375x812: legível, sem corte e sem violações.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(failure).toContainText(UPDATING_TEXT);
  await expectFitsViewport(page, failure, 375);
  const retry = failure.getByRole('button', { name: 'Tentar de novo' });
  const retryBox = await retry.boundingBox();
  expect(retryBox!.x + retryBox!.width, '"Tentar de novo" dentro da janela').toBeLessThanOrEqual(375.5);
  await test.info().attach('b03-b-alvo-tentar-de-novo', { body: JSON.stringify(retryBox), contentType: 'application/json' });
  const mobileViolations = await axeViolations(page, '[data-testid="work-time-settings"]');
  expect(mobileViolations, JSON.stringify(mobileViolations, null, 2)).toEqual([]);
  await expectKeyboardRetry(page, retry, 'celular');
  await expect(failure).toContainText(UPDATING_TEXT);
  await expect(previewHourly(page)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('b03-b-celular-375x812.png') });

  // Volta ao tamanho de computador para chegar ao menu lateral.
  await page.setViewportSize({ width: 1280, height: 720 });

  // Dashboard: o aviso do topo explica que está indisponível e os valores continuam em reais.
  await openDashboard(page);
  await expect(notice(page)).toContainText('Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais.', { timeout: 30_000 });
  await expect(page.locator('[data-work-time]')).toHaveCount(0);
  await expect(balanceCard(page)).toContainText(brl(balance));

  const seen = await recorded(page);
  await attachRecorded('b03-b', seen);
  expect(seen.balance.filter((entry) => entry.startsWith('tempo|')), 'nenhum valor convertido sem prova').toEqual([]);
  expectOnlyConsistent(seen, { minutes: [], balances: [balance] });
});

test('B03-c: depois da marca quebrada, a reconstrução do owner recupera a prova e a estimativa volta a converter com o valor certo', async ({ page, request }) => {
  test.setTimeout(360_000);
  const { tenant, extraId, lastMonth, balance, generationId } = await seedBrokenMark(request);
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await expect(balanceCard(page)).toContainText(brl(balance), { timeout: 30_000 });
  await startRecording(page);
  await openWorkTimeSettings(page);
  const failure = previewError(page);
  await expect(failure).toContainText(UPDATING_TEXT, { timeout: 60_000 });
  await expect(previewHourly(page)).toHaveCount(0);

  // O owner reconstrói a projeção (até concluir).
  const rebuilt = await runPagedCallable(request, tenant.pf.token, 'rebuildCashPeriods', {
    workspaceId: tenant.pf.workspaceId, pageSize: 300, reason: 'Reconstrução da projeção (E2E B03)', dryRun: false,
  }, 'e2e-b03-rebuild');
  expect(rebuilt.result?.completed, JSON.stringify(rebuilt)).toBe(true);
  // Evidência: a geração dos meses mudou e a marca tem âncora e cadeia sãs na nova posição.
  const month = (await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${lastMonth}`).get()).data();
  expect(month?.projectionGeneration?.id, 'geração nova publicada').not.toBe(generationId);
  expect(month?.incomeCents, 'a reconstrução não muda o total').toBe(tenant.baseCents + 50_000);
  const fresh = await markOfGeneration(tenant.pf.workspaceId, extraId, String(month?.projectionGeneration?.id));
  expect(fresh.anchor?.g, 'âncora da geração nova gravada pela varredura').toBe(month?.projectionGeneration?.id);
  expect(fresh.chain?.broken ?? null, 'a cadeia da geração nova não está quebrada').toBeNull();

  // A estimativa volta sozinha; se o aviso ainda estiver na tela, "Tentar de novo" basta (sem recarregar a página).
  let retries = 0;
  await expect(async () => {
    if (await failure.isVisible()) {
      retries += 1;
      await failure.getByRole('button', { name: 'Tentar de novo' }).click();
    }
    await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
  await test.info().attach('b03-c-tentativas', { body: `Cliques em "Tentar de novo": ${retries}`, contentType: 'text/plain' });
  await expect(failure).toHaveCount(0);

  // No Dashboard, o saldo converte com a renda sem a desconsiderada (R$ 25,00/h).
  await openDashboard(page);
  const minutes = roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents);
  await expect(balanceCard(page)).toContainText(timeRegex(minutes), { timeout: 60_000 });
  const seen = await recorded(page);
  await attachRecorded('b03-c', seen);
  expectOnlyConsistent(seen, { minutes: [minutes], balances: [balance], hourly: [2_500] });
  expect(norm(lastBalance(seen).slice(6))).toBe(norm(workTimeText(minutes)));
});

test('B03-d: incluir e tirar uma receita da lista de exclusões pessoais refaz a prova e mantém o valor certo nas duas direções', async ({ page, request }) => {
  test.setTimeout(360_000);
  const tenant = await seedTenant(request);
  const lastMonth = habitualMonths()[2];
  const extraId = await createIncome(request, tenant.pf, `${lastMonth}-15`, 50_000, 'Comissão B03 exclusão');
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents + 50_000 });
  await waitForMark(tenant.pf.workspaceId, extraId);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time', excludedIncomeIds: '' });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await selectLastMonth(page);

  const balance = OPENING_CENTS + tenant.incomeCents + 50_000;
  const withExtra = tenant.incomeCents + 50_000;
  const minutesIncluded = roundedMinutes(balance, tenant.workMinutes, withExtra);
  const minutesExcluded = roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents);
  expect(minutesIncluded).not.toBe(minutesExcluded);
  const hourlyIncluded = hourlyCents(withExtra, tenant.workMinutes);
  expect(hourlyIncluded).not.toBe(2_500);
  await expect(balanceCard(page)).toContainText(timeRegex(minutesIncluded), { timeout: 60_000 });
  await startRecording(page);

  const togglePanel = async (action: 'uncheck' | 'check', hourly: number) => {
    await openWorkTimeSettings(page);
    await expect(previewHourly(page)).toHaveText(brl(action === 'uncheck' ? hourlyIncluded : 2_500), { timeout: 60_000 });
    await page.getByTestId('work-time-income-panel-open').click();
    const panel = page.getByRole('dialog', { name: 'Receitas consideradas' });
    const item = panel.getByTestId(`income-item-${extraId}`);
    await expect(item).toContainText(action === 'uncheck' ? 'Considerada na estimativa.' : 'Desconsiderada por você', { timeout: 30_000 });
    await item.getByRole('checkbox')[action]();
    await panel.getByRole('button', { name: 'Concluir' }).click();
    await expect(previewHourly(page)).toHaveText(brl(hourly), { timeout: 60_000 });
    await saveButton(page).click();
    await expect(page.getByText('Alterações salvas.')).toBeVisible({ timeout: 20_000 });
  };

  // Tirar da estimativa (desconsiderar): a hora volta a R$ 25,00 e o saldo converte pela renda sem a receita.
  await togglePanel('uncheck', 2_500);
  expect((await storedPreference(A.uid))?.excludedIncomeIds).toBe(extraId);
  await openDashboard(page);
  await expect(balanceCard(page)).toContainText(timeRegex(minutesExcluded), { timeout: 60_000 });

  // Incluir de volta: a hora e o saldo voltam aos valores com a receita.
  await togglePanel('check', hourlyIncluded);
  expect((await storedPreference(A.uid))?.excludedIncomeIds).toBe('');
  await openDashboard(page);
  await expect(balanceCard(page)).toContainText(timeRegex(minutesIncluded), { timeout: 60_000 });

  const seen = await recorded(page);
  await attachRecorded('b03-d', seen);
  expectOnlyConsistent(seen, { minutes: [minutesIncluded, minutesExcluded], balances: [balance], hourly: [2_500, hourlyIncluded] });
  expect(seen.balance.filter((entry) => entry.startsWith('tempo|')).length, 'o saldo foi convertido nos dois estados').toBeGreaterThanOrEqual(2);
});

test('B03-e: a receita desconsiderada sai da janela da estimativa e volta: o mês antigo só deixa de descontar quando projeção e marca mudam juntas', async ({ page, request }) => {
  test.setTimeout(360_000);
  const tenant = await seedTenant(request);
  const lastMonth = habitualMonths()[2];
  const description = 'Comissão B03 muda de mês';
  const extra = 300_000;
  const extraId = await createIncome(request, tenant.pf, `${lastMonth}-15`, extra, description);
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents + extra });
  await waitForMark(tenant.pf.workspaceId, extraId);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time', excludedIncomeIds: extraId });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await selectLastMonth(page);

  // Em qualquer estado consistente a renda da estimativa é a de três meses de salário (R$ 25,00/h): dentro da
  // janela, a projeção tem a receita e o desconto a tira; fora dela, a projeção não a tem e não há o que tirar.
  // Desconto duplo daria uma renda menor; falta de desconto, uma maior. Nenhum dos dois pode aparecer.
  const balance = OPENING_CENTS + tenant.incomeCents + extra;
  const minutes = roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents);
  const doubled = roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents - extra);
  const missing = roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents + extra);
  expect(new Set([minutes, doubled, missing]).size, 'os estados errados são distinguíveis').toBe(3);
  await expect(balanceCard(page)).toContainText(timeRegex(minutes), { timeout: 60_000 });
  await startRecording(page);

  // Sai da janela: a data passa para hoje (mês corrente, fora dos três meses completos).
  await editIncome(request, tenant.pf, extraId, description, extra, saoPauloToday());
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents, [currentMonth()]: extra });
  await expect(balanceCard(page)).toContainText(timeRegex(minutes), { timeout: 60_000 });
  // Dá tempo de a escuta e a prova refeita (marca e meses) acontecerem e confere o estado em reais/tempo.
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 60_000 });

  // Volta para a janela.
  await editIncome(request, tenant.pf, extraId, description, extra, `${lastMonth}-15`);
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents + extra, [currentMonth()]: 0 });
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 60_000 });
  await openDashboard(page);
  await expect(balanceCard(page)).toContainText(timeRegex(minutes), { timeout: 60_000 });

  const seen = await recorded(page);
  await attachRecorded('b03-e', seen);
  expectOnlyConsistent(seen, { minutes: [minutes], balances: [balance], hourly: [2_500] });
  expect(seen.balance.filter((entry) => entry.startsWith('tempo|')).length, 'o saldo foi convertido').toBeGreaterThanOrEqual(1);
  expect((await storedPreference(A.uid))?.excludedIncomeIds, 'a exclusão continua a mesma').toBe(extraId);
});

/**
 * P5-F.1-R3.1 (R3-AUD-01): a última estimativa provada nunca aparece como a atual. Com a estimativa provada na tela, a
 * cadeia da marca da desconsiderada fica quebrada e outra sessão lança uma receita no mês escolhido: a leitura nova
 * (outro saldo, outra renda) não tem prova, na mesma identidade da estimativa (conta, espaço, preferência) e sem falha
 * de leitura. O saldo novo aparece em reais, nunca convertido pela renda anterior (o que a R3 mostrava até o tempo de
 * interface); o tempo de interface só troca o texto. A reconstrução do owner traz a prova e a conversão volta com a
 * renda nova.
 */
test('B03-f (R3.1): leitura nova sem prova: o saldo novo fica em reais e nunca é convertido pela estimativa anterior; a reconstrução traz a conversão certa', async ({ page, request }) => {
  test.setTimeout(360_000);
  const tenant = await seedTenant(request);
  const lastMonth = habitualMonths()[2];
  const extraId = await createIncome(request, tenant.pf, `${lastMonth}-15`, 50_000, 'Comissão B03 R3.1');
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents + 50_000 });
  await waitForMark(tenant.pf.workspaceId, extraId);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time', excludedIncomeIds: extraId });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await selectLastMonth(page);

  // Estados consistentes: antes, o saldo pela renda sem a desconsiderada (R$ 25,00/h); depois, o saldo novo pela renda
  // com a receita nova. O estado inseguro da R3: o saldo novo convertido pela renda anterior.
  const late = 30_000;
  const before = OPENING_CENTS + tenant.incomeCents + 50_000;
  const after = before + late;
  const minutesBefore = roundedMinutes(before, tenant.workMinutes, tenant.incomeCents);
  const minutesAfter = roundedMinutes(after, tenant.workMinutes, tenant.incomeCents + late);
  const minutesUnsafe = roundedMinutes(after, tenant.workMinutes, tenant.incomeCents);
  expect(new Set([minutesBefore, minutesAfter, minutesUnsafe]).size, 'os três estados são distinguíveis').toBe(3);
  const hourlyAfter = hourlyCents(tenant.incomeCents + late, tenant.workMinutes);
  expect(hourlyAfter).not.toBe(2_500);
  const unsafe = `tempo|${norm(workTimeText(minutesUnsafe))}`;
  const normalized = (seen: Recorded) => seen.balance.map((entry) => `${entry.slice(0, entry.indexOf('|'))}|${norm(entry.slice(entry.indexOf('|') + 1))}`);
  await expect(balanceCard(page)).toContainText(timeRegex(minutesBefore), { timeout: 60_000 });
  await startRecording(page);

  // A cadeia da geração vigente da marca fica quebrada; outra sessão lança uma receita no mês escolhido.
  const current = await currentMarkSlot(tenant.pf.workspaceId, extraId, lastMonth);
  await db().doc(markPath(tenant.pf.workspaceId, extraId)).update({ [`chains.${current.slot}.broken`]: 'pending_overflow' });
  await createIncome(request, tenant.pf, `${lastMonth}-16`, late, 'Receita B03 R3.1 sem prova');
  await waitForReceipts(tenant.pf.workspaceId, { [lastMonth]: tenant.baseCents + 50_000 + late });

  // O saldo novo aparece em reais, sem nenhum valor convertido; o topo diz que os valores ficam em reais. Convertido,
  // o cartão também traz os reais no rótulo acessível: quem prova os reais é o registrador (o último valor mostrado é
  // `reais|…`) com a contagem zero de valores convertidos.
  await expect(balanceCard(page)).toContainText(brl(after), { timeout: 60_000 });
  await expect.poll(async () => normalized(await recorded(page)).at(-1), { timeout: 60_000, message: 'o saldo novo, em reais' })
    .toBe(`reais|${norm(brlText(after))}`);
  await expect(page.locator('[data-work-time]')).toHaveCount(0);
  await expect(notice(page)).toContainText(
    /Calculando a estimativa de tempo de trabalho: enquanto isso, os valores ficam em reais\.|Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais\./,
  );
  const midway = await recorded(page);
  await attachRecorded('b03-f-sem-prova', midway);
  expect(normalized(midway), 'o saldo novo nunca convertido pela renda anterior').not.toContain(unsafe);

  // Em Configurações: sem hora estimada; depois do tempo de interface, "estimativa em atualização" (só o texto muda).
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveCount(0);
  const failure = previewError(page);
  await expect(failure).toContainText(UPDATING_TEXT, { timeout: 60_000 });
  await expect(failure.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await expect(failure).not.toContainText(/permission|insufficient|firestore|firebase|pending_overflow|broken/i);
  await expect(previewHourly(page)).toHaveCount(0);

  // O owner reconstrói a projeção (até concluir): a prova volta e a conversão também, com a renda nova.
  const rebuilt = await runPagedCallable(request, tenant.pf.token, 'rebuildCashPeriods', {
    workspaceId: tenant.pf.workspaceId, pageSize: 300, reason: 'Reconstrução da projeção (E2E B03-f)', dryRun: false,
  }, 'e2e-b03f-rebuild');
  expect(rebuilt.result?.completed, JSON.stringify(rebuilt)).toBe(true);
  const month = (await db().doc(`workspaces/${tenant.pf.workspaceId}/cash_report_periods/${lastMonth}`).get()).data();
  expect(month?.projectionGeneration?.id, 'geração nova publicada').not.toBe(current.generationId);
  expect(month?.incomeCents, 'a reconstrução não muda o total').toBe(tenant.baseCents + 50_000 + late);
  let retries = 0;
  await expect(async () => {
    if (await failure.isVisible()) {
      retries += 1;
      await failure.getByRole('button', { name: 'Tentar de novo' }).click();
    }
    await expect(previewHourly(page)).toHaveText(brl(hourlyAfter), { timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
  await test.info().attach('b03-f-tentativas', { body: `Cliques em "Tentar de novo": ${retries}`, contentType: 'text/plain' });
  await expect(failure).toHaveCount(0);

  await openDashboard(page);
  await expect(balanceCard(page)).toContainText(timeRegex(minutesAfter), { timeout: 60_000 });
  const seen = await recorded(page);
  await attachRecorded('b03-f', seen);
  expect(normalized(seen), 'o saldo novo nunca convertido pela renda anterior').not.toContain(unsafe);
  expectOnlyConsistent(seen, { minutes: [minutesBefore, minutesAfter], balances: [before, after], hourly: [hourlyAfter] });
  expect(norm(lastBalance(seen).slice(6))).toBe(norm(workTimeText(minutesAfter)));
  expect(await storedPreference(A.uid), 'a estimativa não grava nada').toMatchObject({ excludedIncomeIds: extraId, displayMode: 'time' });
});

/**
 * P5-F.1-R3.2 (RR-R31-05): sem desconsiderada e com uma base (a "leitura única" que a R3.1 provava sem o servidor), a
 * estimativa só converte com a projeção confirmada por um retorno do servidor. Com a estimativa provada na tela, a
 * conexão cai: o SDK passa a servir só do cache local, a conversão sai e o saldo fica em reais (na R3.1, a conversão
 * ficava). Ainda sem conexão, a prévia de Configurações aberta de novo usa o cache aquecido do React Query e não
 * converte antes de um retorno do servidor, nem passado o tempo de interface (na R3.1, mostrava a hora na abertura).
 * Com a conexão de volta, a conversão certa volta sozinha, sem recarregar a página nem tocar em "Tentar de novo".
 */
test('B03-g (R3.2, RR-R31-05): sem conexão, a conversão sai e a prévia aberta de novo com o cache aquecido não converte; com a conexão de volta, a conversão certa volta', async ({ page, request, context }) => {
  test.setTimeout(300_000);
  const tenant = await seedTenant(request);
  await seedPreference(A.uid, tenant.pf.workspaceId, { displayMode: 'time', excludedIncomeIds: '' });
  await startOn(page, A.uid, tenant.pf.workspaceId);
  await login(page, A.email);
  await selectLastMonth(page);
  const balance = OPENING_CENTS + tenant.incomeCents;
  const minutes = roundedMinutes(balance, tenant.workMinutes, tenant.incomeCents);
  await expect(balanceCard(page)).toContainText(timeRegex(minutes), { timeout: 60_000 });
  // A prévia de Configurações aberta uma vez com a conexão: o módulo da tela carregado e o cache aquecido.
  await openWorkTimeSettings(page);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 60_000 });
  await openDashboard(page);
  await expect(balanceCard(page)).toContainText(timeRegex(minutes), { timeout: 60_000 });
  await startRecording(page);

  // A conexão cai: o saldo volta a reais (nenhum valor convertido) e o topo diz que os valores ficam em reais.
  await context.setOffline(true);
  await expect.poll(async () => lastBalance(await recorded(page)).startsWith('reais|'), {
    timeout: 60_000, message: 'sem conexão, o saldo em reais',
  }).toBe(true);
  await expect(page.locator('[data-work-time]')).toHaveCount(0);
  await expect(notice(page)).toContainText(
    /Calculando a estimativa de tempo de trabalho: enquanto isso, os valores ficam em reais\.|Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais\./,
  );

  // A prévia aberta de novo, ainda sem conexão: o cache aquecido não converte; passado o tempo de interface, só o texto
  // muda para "em atualização", com "Tentar de novo".
  await openWorkTimeSettings(page);
  await expect(page.getByTestId('work-time-preview-loading').or(previewError(page))).toBeVisible({ timeout: 30_000 });
  await expect(previewHourly(page)).toHaveCount(0);
  const failure = previewError(page);
  await expect(failure).toContainText(UPDATING_TEXT, { timeout: 60_000 });
  await expect(failure.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await expect(previewHourly(page)).toHaveCount(0);
  const offline = await recorded(page);
  await attachRecorded('b03-g-sem-conexao', offline);
  expect(offline.hourly, 'nenhuma hora estimada sem a confirmação do servidor').toEqual([]);
  // O registro começa no saldo convertido de antes da queda; do primeiro valor em reais em diante, nenhum convertido.
  const drop = offline.balance.findIndex((entry) => entry.startsWith('reais|'));
  expect(drop, `sem conexão, o saldo passou a reais: ${JSON.stringify(offline.balance)}`).toBeGreaterThan(0);
  expect(offline.balance.slice(drop).filter((entry) => entry.startsWith('tempo|')), 'nenhum saldo convertido depois da queda').toEqual([]);

  // A conexão volta: o retorno do servidor confirma a base e a conversão volta sozinha.
  await context.setOffline(false);
  await expect(previewHourly(page)).toHaveText(brl(2_500), { timeout: 60_000 });
  await expect(failure).toHaveCount(0);
  await openDashboard(page);
  await expect(balanceCard(page)).toContainText(timeRegex(minutes), { timeout: 60_000 });
  const seen = await recorded(page);
  await attachRecorded('b03-g', seen);
  expectOnlyConsistent(seen, { minutes: [minutes], balances: [balance], hourly: [2_500] });
  expect(seen.balance.at(0)?.startsWith('tempo|'), 'antes da queda, convertido').toBe(true);
  expect(seen.balance.some((entry) => entry.startsWith('reais|')), 'sem conexão, em reais').toBe(true);
  expect(seen.balance.at(-1)?.startsWith('tempo|'), 'com a conexão de volta, convertido de novo').toBe(true);
  expect(await storedPreference(A.uid), 'a estimativa não grava nada').toMatchObject({ excludedIncomeIds: '', displayMode: 'time' });
});
