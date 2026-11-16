import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { axeViolations } from './support/axe';
import { callCallable } from './support/callables';
import { addMonths, db, dayKey, intentKey, login, PASSWORD, resetEmulatorData, today, tokenOf } from './support/loans';
import { adminSdk, defaultCashAccountIdFor, seedOwnedWorkspace, seedPaidPlan } from './support/workspaceSeed';
import { versionOf } from './support/receivables';

/**
 * P5-GATE-FINAL (FIRESTORE-01) — leituras de lançamentos sem a janela de 12 meses, pela interface, com Auth,
 * Firestore, Functions e Rules reais no Emulator. Os lançamentos são criados pela callable de importação, o
 * caminho autoritativo do backend.
 *
 * - "Transações Recentes" mostra as 9 mais recentes dos últimos 12 meses, diz na legenda que a ordenação por
 *   coluna vale só para elas, e o filtro por tipo traz as mais recentes daquele tipo.
 * - Inclusão, correção e anulação nesta aba atualizam a lista do mês e o widget, sem recarregar a página.
 * - A lista de Receitas lê o mês do Header inteiro por cursor (mais de 500 lançamentos), inclusive um mês
 *   anterior à antiga janela de 12 meses, que antes aparecia vazio.
 * - FIRESTORE-08: quando o teto de leitura do widget (10 páginas de 10) acaba sem reunir 9 lançamentos válidos,
 *   o widget mostra os que reuniu e avisa que não são as 9 mais recentes.
 */

test.use({ timezoneId: 'America/Sao_Paulo' });

const OWNER = { uid: 'e2e-p5g-reads-owner', email: 'e2e-p5g-reads-owner@minhas-financas.local' };
const CATALOG = {
  incomeType: 'Salário P5G',
  incomeCategory: 'Salário P5G',
  expenseType: 'Fixa P5G',
  expenseCategory: 'Moradia P5G',
};

const normalize = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

const seedCatalog = async (workspaceId: string) => {
  const now = new Date();
  const items: Array<[string, string, string, string?]> = [
    ['p5g-income-type', 'income_type', CATALOG.incomeType],
    ['p5g-income-category', 'category', CATALOG.incomeCategory, 'receita'],
    ['p5g-expense-type', 'expense_type', CATALOG.expenseType],
    ['p5g-expense-category', 'category', CATALOG.expenseCategory, 'despesa'],
  ];
  await Promise.all(items.map(([id, group, name, transactionSubtype]) => db().doc(`workspaces/${workspaceId}/settings_catalog/${id}`).set({
    id, schemaVersion: 1, workspaceId, group, name, normalizedName: normalize(name),
    ...(transactionSubtype ? { transactionSubtype } : {}),
    dedupeKey: `${group}::${transactionSubtype ?? 'all'}::both::${normalize(name)}`,
    workspaceScope: 'both', sortOrder: 1, status: 'active',
    createdBy: OWNER.uid, updatedBy: OWNER.uid, createdAt: now, updatedAt: now,
  })));
};

interface Seeded { token: string; workspaceId: string }

const seed = async (request: APIRequestContext): Promise<Seeded> => {
  await resetEmulatorData();
  // ID único: a limpeza do Emulator apaga os lançamentos do teste anterior e o gatilho processa as exclusões depois.
  const workspaceId = `e2e-p5g-reads-${Date.now().toString(36)}`;
  await adminSdk().auth().createUser({ ...OWNER, password: PASSWORD, emailVerified: true });
  await seedOwnedWorkspace({ ...OWNER, workspaceId, name: 'Leituras P5G', type: 'PF' });
  await seedPaidPlan(OWNER.uid, 'business');
  await seedCatalog(workspaceId);
  return { token: await tokenOf(request, OWNER.email), workspaceId };
};

interface Line { description: string; type: 'receita' | 'despesa'; amountCents: number; date: string }

/** Lançamentos confirmados pela callable de importação, em lotes de 50 (o teto do contrato). */
const importLines = async (request: APIRequestContext, seeded: Seeded, lines: Line[]) => {
  for (let start = 0; start < lines.length; start += 50) {
    const items = lines.slice(start, start + 50).map((line, index) => ({
      lineId: `l${start + index}`,
      type: line.type,
      description: line.description,
      amountCents: line.amountCents,
      date: line.date,
      ...(line.type === 'receita'
        ? { categoryId: 'p5g-income-category', incomeType: CATALOG.incomeType }
        : { categoryId: 'p5g-expense-category', expenseType: CATALOG.expenseType }),
    }));
    const outcome = await callCallable(request, seeded.token, 'importCashTransactions', {
      workspaceId: seeded.workspaceId, idempotencyKey: intentKey('p5g-import'), importId: intentKey('p5g-lote'),
      cashAccountId: defaultCashAccountIdFor(seeded.workspaceId), items,
    });
    expect(outcome.status, JSON.stringify(outcome)).toBe(200);
  }
};

/** As 9 que o widget precisa mostrar, lidas pelo Admin SDK na mesma ordem da consulta (`date` desc, id desc). */
const expectedRecent = async (workspaceId: string, type: 'receita' | 'despesa' | null = null) => {
  // O início da janela do widget: o mesmo dia de 12 meses atrás (`saoPauloMonthsAgo(12)`).
  const since = addMonths(today(), -12);
  const docs = (await db().collection(`workspaces/${workspaceId}/transactions`).get()).docs
    .map((document) => ({ id: document.id, ...(document.data() as Record<string, unknown>) }) as Record<string, unknown> & { id: string })
    .filter((row) => typeof row.date === 'string' && row.date >= since && !row.voidedAt && (type === null || row.type === type))
    .sort((a, b) => (a.date !== b.date ? (String(a.date) < String(b.date) ? 1 : -1) : a.id < b.id ? 1 : -1));
  return docs.slice(0, 9).map((row) => String(row.description));
};

const widget = (page: Page): Locator =>
  page.getByRole('heading', { name: 'Transações Recentes' }).locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]');

const widgetDescriptions = async (page: Page): Promise<string[]> => {
  const cells = widget(page).locator('tbody tr td:first-child');
  const texts = await cells.allInnerTexts();
  return texts.map((text) => text.split('\n')[0].trim());
};

const expectWidget = async (page: Page, expected: string[]) => {
  await expect.poll(() => widgetDescriptions(page), { timeout: 30_000 }).toEqual(expected);
};

const transactionDialog = (page: Page) =>
  page.getByRole('dialog').filter({ has: page.locator('#transaction-modal-title') });

const openIncomeList = async (page: Page) => {
  await page.getByRole('button', { name: /^Receitas\s+R\$/i }).click();
  await expect(page.getByRole('button', { name: /Nova Transação/i }).first()).toBeVisible();
};

const backToDashboard = async (page: Page) => {
  await page.getByRole('button', { name: 'Voltar ao dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Transações Recentes' })).toBeVisible();
};

const rowOf = (page: Page, description: string) => page.locator('tr').filter({ hasText: description });

const brlText = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

test('FIRESTORE-01 (P5-GATE-FINAL): o widget mostra as 9 mais recentes, diz que a ordenação vale só para elas e filtra por tipo', async ({ page, request }) => {
  test.setTimeout(240_000);
  const seeded = await seed(request);
  // 12 lançamentos nos últimos 12 dias; os 3 mais antigos valem mais que todos os 9 recentes. Um de 13 meses
  // atrás vale mais ainda. Só os 9 recentes aparecem, em qualquer ordenação.
  const lines: Line[] = Array.from({ length: 12 }, (_, index) => ({
    description: `Recente P5G ${String(index + 1).padStart(2, '0')}`,
    type: index % 4 === 1 ? 'despesa' : 'receita',
    amountCents: index < 9 ? 10_000 + ((index * 7) % 9) * 1_000 : 900_000 + index,
    date: dayKey(-(index + 1)),
  }));
  lines.push({ description: 'Antigo P5G grande', type: 'receita', amountCents: 9_900_000, date: addMonths(today(), -13) });
  await importLines(request, seeded, lines);

  await login(page, OWNER.email);
  await expect(widget(page).getByText('Mostra até as 9 mais recentes dos últimos 12 meses. Ordenar por coluna reorganiza só as exibidas.')).toBeVisible();
  const recentNine = lines.slice(0, 9);
  await expectWidget(page, recentNine.map((line) => line.description));
  expect(await expectedRecent(seeded.workspaceId)).toEqual(recentNine.map((line) => line.description));

  // Ordenação por valor: as mesmas 9, reordenadas; nenhum dos lançamentos maiores e mais antigos entra.
  const sortByValue = widget(page).getByRole('button', { name: 'Valor' });
  await sortByValue.click();
  const ascending = [...recentNine].sort((a, b) => a.amountCents - b.amountCents || 0);
  await expect.poll(async () => (await widgetDescriptions(page)).sort()).toEqual(recentNine.map((line) => line.description).sort());
  const shownAscending = await widgetDescriptions(page);
  const amountOf = (description: string) => lines.find((line) => line.description === description)?.amountCents ?? -1;
  expect(shownAscending.map(amountOf)).toEqual(ascending.map((line) => line.amountCents));
  await sortByValue.click();
  const shownDescending = await widgetDescriptions(page);
  expect(shownDescending.map(amountOf)).toEqual([...ascending].reverse().map((line) => line.amountCents));
  for (const excluded of [...lines.slice(9).map((line) => line.description)]) {
    await expect(widget(page).getByText(excluded)).toHaveCount(0);
  }

  // Filtro por tipo: as despesas mais recentes dos 12 meses (3 delas, de 12 lançamentos).
  await widget(page).locator('select').selectOption('despesa');
  const despesas = lines.filter((line) => line.type === 'despesa').map((line) => line.description);
  await expect.poll(async () => (await widgetDescriptions(page)).sort()).toEqual([...despesas].sort());
  expect((await expectedRecent(seeded.workspaceId, 'despesa')).sort()).toEqual([...despesas].sort());
  await widget(page).locator('select').selectOption('todas');
  await expect.poll(async () => (await widgetDescriptions(page)).sort()).toEqual(recentNine.map((line) => line.description).sort());

  // A legenda nova não traz violação de acessibilidade ao widget (o select sem nome é o V-08 já registrado, P9).
  const violations = (await axeViolations(page, 'main', [])).filter((violation) =>
    violation.nodes.some((node) => /Ordenar por coluna/.test(node.html)));
  expect(violations).toEqual([]);
});

test('FIRESTORE-01 (P5-GATE-FINAL): inclusão, correção e anulação nesta aba atualizam a lista do mês e o widget', async ({ page, request }) => {
  test.setTimeout(300_000);
  const seeded = await seed(request);
  // 9 receitas de hoje e uma de 2 dias atrás: o widget mostra as 9 de hoje.
  const todays: Line[] = Array.from({ length: 9 }, (_, index) => ({
    description: `Hoje P5G ${index + 1}`, type: 'receita', amountCents: 20_000 + index * 100, date: today(),
  }));
  const older: Line = { description: 'Anteontem P5G', type: 'receita', amountCents: 30_000, date: dayKey(-2) };
  await importLines(request, seeded, [...todays, older]);

  await login(page, OWNER.email);
  await expectWidget(page, await expectedRecent(seeded.workspaceId));
  await expect(widget(page).getByText(older.description)).toHaveCount(0);

  // Anulação na lista do mês: sai da lista e do widget; o lançamento de 2 dias atrás entra como o 9º.
  await openIncomeList(page);
  const voided = todays[4].description;
  await rowOf(page, voided).getByRole('button', { name: 'Deletar' }).click();
  const voidDialog = page.getByRole('dialog').filter({ hasText: 'Anular lançamento' });
  await voidDialog.getByLabel('Motivo da anulação').fill('Lançado em duplicidade');
  await voidDialog.getByRole('button', { name: 'Confirmar anulação' }).click();
  await expect(voidDialog).toBeHidden({ timeout: 30_000 });
  await expect(rowOf(page, voided)).toHaveCount(0);
  await backToDashboard(page);
  const afterVoid = await expectedRecent(seeded.workspaceId);
  expect(afterVoid).toContain(older.description);
  expect(afterVoid).not.toContain(voided);
  await expectWidget(page, afterVoid);

  // Inclusão pela lista: a receita nova (de hoje) entra no widget e tira de lá a de 2 dias atrás.
  await openIncomeList(page);
  await page.getByRole('button', { name: /Nova Transação/i }).first().click();
  const form = transactionDialog(page).locator('form');
  await expect(form.locator('select').nth(1)).toContainText(CATALOG.incomeCategory, { timeout: 20_000 });
  await form.locator('select').nth(0).selectOption({ label: CATALOG.incomeType });
  await form.locator('select').nth(1).selectOption({ label: CATALOG.incomeCategory });
  await form.locator('input[type="number"]').fill('412.34');
  await form.getByPlaceholder('Ex: Cliente XYZ, Reembolso Empresa...').fill('Nova P5G');
  await form.locator('input[type="date"]').fill(today());
  await transactionDialog(page).getByRole('button', { name: /Revisar e Adicionar Receita/i }).click();
  await expect(transactionDialog(page)).toBeHidden({ timeout: 30_000 });
  await expect(rowOf(page, 'Nova P5G')).toHaveCount(1, { timeout: 30_000 });
  await backToDashboard(page);
  const afterCreate = await expectedRecent(seeded.workspaceId);
  expect(afterCreate).toContain('Nova P5G');
  expect(afterCreate).not.toContain(older.description);
  await expectWidget(page, afterCreate);

  // Correção pela lista: o valor novo aparece na lista e no widget.
  await openIncomeList(page);
  const corrected = todays[0].description;
  await rowOf(page, corrected).getByRole('button', { name: 'Editar' }).click();
  const dialog = transactionDialog(page);
  await dialog.locator('form input[type="number"]').fill('150.25');
  await dialog.getByLabel(/Motivo da correção/).fill('Valor digitado errado');
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(rowOf(page, corrected)).toContainText(brlText(15_025), { timeout: 30_000 });
  await backToDashboard(page);
  await expect(widget(page).locator('tr').filter({ hasText: corrected })).toContainText(brlText(15_025), { timeout: 30_000 });
  await expectWidget(page, await expectedRecent(seeded.workspaceId));
});

test('FIRESTORE-01 (P5-GATE-FINAL): a lista do mês lê o mês inteiro por cursor, inclusive antes da antiga janela de 12 meses', async ({ page, request }) => {
  test.setTimeout(420_000);
  const seeded = await seed(request);
  const monthStart = `${addMonths(today(), -13).slice(0, 7)}-01`;
  const oldMonth = Array.from({ length: 520 }, (_, index): Line => ({
    description: `Mês antigo P5G ${String(index + 1).padStart(3, '0')}`, type: 'receita', amountCents: 100 + index,
    date: `${monthStart.slice(0, 8)}${String(1 + (index % 28)).padStart(2, '0')}`,
  }));
  const current: Line[] = [
    { description: 'Mês atual P5G 1', type: 'receita', amountCents: 5_000, date: today() },
    { description: 'Mês atual P5G 2', type: 'receita', amountCents: 7_000, date: today() },
    { description: 'Despesa do mês P5G', type: 'despesa', amountCents: 1_000, date: today() },
  ];
  await importLines(request, seeded, [...oldMonth, ...current]);

  await login(page, OWNER.email);
  await openIncomeList(page);
  await expect(page.getByText('2 de 2 registros')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Total ${brlText(12_000)}`)).toBeVisible();
  await expect(rowOf(page, 'Despesa do mês P5G')).toHaveCount(0);

  for (let step = 0; step < 13; step += 1) await page.getByRole('button', { name: 'Mês anterior' }).click();
  const total = oldMonth.reduce((sum, line) => sum + line.amountCents, 0);
  await expect(page.getByText('520 de 520 registros')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(`Total ${brlText(total)}`)).toBeVisible();
  await expect(page.getByText('Nenhuma transação encontrada.')).toHaveCount(0);
  await expect(page.getByText(/não incluem todos/)).toHaveCount(0);
  // Sem repetição nem omissão: cada descrição aparece uma vez.
  const descriptions = (await page.locator('tbody tr').allInnerTexts()).map((text) => /Mês antigo P5G \d{3}/.exec(text)?.[0]).filter(Boolean);
  expect(descriptions).toHaveLength(520);
  expect(new Set(descriptions).size).toBe(520);
  // O gatilho de caixa termina de processar as 523 importações antes do fim do teste: nenhuma carga de fundo
  // sobra para o teste seguinte do mesmo grupo (nem para o desligamento do Emulator).
  for (const [month, cents] of [[monthStart.slice(0, 7), total], [today().slice(0, 7), 12_000]] as const) {
    await expect.poll(async () => (await db().doc(`workspaces/${seeded.workspaceId}/cash_report_periods/${month}`).get())
      .get('incomeCents') ?? 0, { timeout: 120_000, message: `projeção de ${month}` }).toBe(cents);
  }
});

test('FIRESTORE-08 (P5-GATE-FINAL): com anuladas demais entre as recentes, o widget avisa que não reuniu as 9 e não as apresenta como completas', async ({ page, request }) => {
  test.setTimeout(420_000);
  const seeded = await seed(request);
  // Em `date` desc: 3 válidos hoje, 100 anulados anteontem e 10 válidos três dias atrás. O widget lê 10 páginas de 10
  // (os 3 válidos e 97 anulados), chega ao teto com 3 dos 9 e não lê os 10 mais antigos.
  const valid: Line[] = Array.from({ length: 3 }, (_, index) => ({
    description: `Válido recente P5G ${index + 1}`, type: 'receita', amountCents: 1_000 + index, date: today(),
  }));
  const toVoid: Line[] = Array.from({ length: 100 }, (_, index) => ({
    description: `Anulado P5G ${String(index + 1).padStart(3, '0')}`, type: 'receita', amountCents: 500 + index, date: dayKey(-2),
  }));
  const older: Line[] = Array.from({ length: 10 }, (_, index) => ({
    description: `Válido antigo P5G ${String(index + 1).padStart(2, '0')}`, type: 'receita', amountCents: 2_000 + index, date: dayKey(-3),
  }));
  await importLines(request, seeded, [...valid, ...toVoid, ...older]);
  const docs = (await db().collection(`workspaces/${seeded.workspaceId}/transactions`).get()).docs;
  const voidIds = docs.filter((document) => String(document.get('description')).startsWith('Anulado P5G ')).map((document) => document.id);
  expect(voidIds).toHaveLength(100);
  for (const transactionId of voidIds) {
    const current = (await db().doc(`workspaces/${seeded.workspaceId}/transactions/${transactionId}`).get()).data() ?? {};
    const voided = await callCallable(request, seeded.token, 'voidCashTransaction', {
      workspaceId: seeded.workspaceId, idempotencyKey: intentKey('p5g-void'), transactionId,
      expectedUpdatedAt: versionOf(current), reason: 'Lançado em duplicidade',
    });
    expect(voided.status, JSON.stringify(voided)).toBe(200);
  }

  await login(page, OWNER.email);
  const notice = 'Não foi possível reunir as 9 mais recentes: veja a lista completa em Receitas ou Despesas.';
  await expect(widget(page).getByText(notice)).toBeVisible({ timeout: 30_000 });
  // As linhas da tabela: os 3 válidos que o teto alcançou e o aviso (uma linha da própria tabela), nada mais.
  await expect.poll(async () => (await widgetDescriptions(page)).sort(), { timeout: 30_000 })
    .toEqual([...valid.map((line) => line.description), notice].sort());
  for (const line of [...toVoid.slice(0, 3), ...older.slice(0, 3)]) await expect(widget(page).getByText(line.description)).toHaveCount(0);
  // As 9 de verdade incluem 6 dos antigos, que o teto não alcançou: por isso o aviso.
  expect((await expectedRecent(seeded.workspaceId)).slice(0, 3).sort()).toEqual(valid.map((line) => line.description).sort());
  expect(await expectedRecent(seeded.workspaceId)).toHaveLength(9);

  // O gatilho de caixa termina de processar as importações e as anulações antes do fim do teste.
  const byMonth = new Map<string, number>();
  for (const line of [...valid, ...older]) byMonth.set(line.date.slice(0, 7), (byMonth.get(line.date.slice(0, 7)) ?? 0) + line.amountCents);
  for (const [month, cents] of byMonth) {
    await expect.poll(async () => (await db().doc(`workspaces/${seeded.workspaceId}/cash_report_periods/${month}`).get())
      .get('incomeCents') ?? 0, { timeout: 120_000, message: `projeção de ${month}` }).toBe(cents);
  }
});
