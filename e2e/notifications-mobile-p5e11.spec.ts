import { createRequire } from 'node:module';

import {
  expect, test,
  type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page,
} from '@playwright/test';

import { emulatorIdToken } from './support/callables';
import {
  adminSdk, clearEmulatorData, seedAccountProfile, seedMembership, seedOwnedWorkspace, seedPaidPlan,
} from './support/workspaceSeed';

/**
 * P5-E1.1 — notificações no celular: os toques no painel agem só no elemento
 * em que o gesto começou. De ponta a ponta no Emulator (Auth, Firestore, Rules
 * e Functions reais; nenhuma interceptação ou simulação de rede).
 *
 * Causa diagnosticada: num toque, o navegador entrega `touchstart`/`touchend`
 * ao elemento tocado e só depois gera o `click` de compatibilidade, com um novo
 * teste de acerto. Quando um aviso arquivado saía da lista com animação (os de
 * baixo subiam), esse `click` caía em outro elemento: o corpo de outro aviso
 * marcava como lido, navegava e fechava o painel (ou o fundo transparente
 * fechava o painel).
 *
 * Correção (`src/lib/pressOrigin.ts`): o navegador continua decidindo se houve
 * clique; o clique de um gesto que cai num "dono" diferente daquele em que o
 * gesto começou (aviso, "Arquivar", "Excluir" ou o fundo) é impedido ali e, se
 * foi toque, reentregue ao dono de origem. Além disso, uma marca já confirmada
 * não volta atrás por causa de uma resposta antiga, e o painel re-renderiza a
 * cada `onExitComplete` para que um aviso arquivado não fique preso no DOM
 * (segunda causa, com regressão determinística em
 * `e2e/notifications-exit-race.spec.ts`).
 *
 * Os 20 casos (os 18 do pedido, mais o 19 e o 20, de clique redirecionado)
 * usam o celular (390×844, toque real com `tap()`), exceto onde indicado
 * (17 e 18 usam também o desktop). Cada caso semeia o próprio
 * workspace, com eventos "de prateleira" gravados pelo BUILDER REAL do
 * backend (`functions/lib/notifications/builder.js`, que exige
 * `npm --prefix functions run build`, feito pelo webServer do Playwright), e
 * confere a UI e o estado privado persistido no Emulator pelo Admin SDK.
 */
test.use({ timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' });

const PASSWORD = 'e2e-password-123456';
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const nodeRequire = createRequire(import.meta.url);
const { buildNotificationDocument } = nodeRequire('../functions/lib/notifications/builder.js') as {
  buildNotificationDocument: (input: Record<string, unknown>) => Record<string, unknown>;
};

// ------------------------------------------------------------------ Emulator

const db = () => adminSdk().firestore();
const timestamp = () => adminSdk().firestore.Timestamp;
type Stamp = InstanceType<ReturnType<typeof timestamp>>;

const pad = (index: number) => String(index).padStart(2, '0');
const unique = () => Date.now().toString(36);

const createAuthUsers = async (users: Array<{ uid: string; email: string }>) => {
  for (const user of users) {
    await adminSdk().auth().createUser({ uid: user.uid, email: user.email, password: PASSWORD, emailVerified: true });
  }
};

const user = (name: string) => ({ uid: `e2e-p5e11-${name}`, email: `e2e-p5e11-${name}@minhas-financas.local` });

/** Tipos em rodízio, cada um com o link e as entidades do contrato (o 00 abre "Metas"). */
const KINDS = [
  { eventType: 'goal_achieved', type: 'success', link: 'goals', entity: (n: string) => ({ goalId: `goal-${n}` }) },
  { eventType: 'loan_overdue', type: 'warning', link: 'loans', entity: (n: string) => ({ loanId: `loan-${n}` }) },
  {
    eventType: 'receivable_overdue', type: 'warning', link: 'clients_receivables',
    entity: (n: string) => ({ receivableId: `receivable-${n}` }),
  },
  {
    eventType: 'recurring_attention_required', type: 'warning', link: 'recurring',
    entity: (n: string) => ({ recurringExpenseId: `recurring-${n}`, occurrenceId: `occurrence-${n}` }),
  },
  {
    eventType: 'recurring_awaiting_confirmation', type: 'info', link: 'recurring',
    entity: (n: string) => ({ recurringExpenseId: `recurring-${n}`, occurrenceId: `occurrence-${n}` }),
  },
] as const;

interface ShelfEvent {
  id: string;
  title: string;
  /** Mais novo = menor `ageMinutes`. */
  ageMinutes: number;
}

/**
 * Eventos pelo builder real do backend e `create` do Admin SDK. Os
 * identificadores de entidade são sintéticos; título e mensagem não têm dado
 * financeiro. Devolve os IDs, na ordem recebida.
 */
const seedShelfEvents = async (workspaceId: string, events: ShelfEvent[]): Promise<string[]> => {
  const batch = db().batch();
  const nowMs = Date.now();
  events.forEach((event, index) => {
    const kind = KINDS[index % KINDS.length];
    const document = buildNotificationDocument({
      id: event.id,
      workspaceId,
      eventType: kind.eventType,
      title: event.title,
      message: `Evento de teste ${pad(index)} registrado no workspace.`,
      type: kind.type,
      link: kind.link,
      createdAtMs: nowMs - event.ageMinutes * 60_000,
      entity: kind.entity(`${event.id}`),
    });
    batch.create(db().doc(`workspaces/${workspaceId}/notifications/${event.id}`), document);
  });
  await batch.commit();
  return events.map((event) => event.id);
};

/** `count` eventos "Aviso <prefixo> NN", do mais novo (00) ao mais antigo; todos com 10+ minutos. */
const shelf = (prefix: string, idPrefix: string, count: number, firstAgeMinutes = 10): ShelfEvent[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${idPrefix}_${pad(index)}`, title: `Aviso ${prefix} ${pad(index)}`, ageMinutes: firstAgeMinutes + index,
  }));

const statesOf = async (workspaceId: string, uid: string) => {
  const snapshot = await db()
    .collection(`workspaces/${workspaceId}/notification_user_states/${uid}/notification_entries`).get();
  return new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
};

/** Marcas verdadeiras de cada estado privado: `{ id: ['dismissed', 'read'] }` (ordenadas). */
const flagsOf = async (workspaceId: string, uid: string): Promise<Record<string, string[]>> =>
  Object.fromEntries([...(await statesOf(workspaceId, uid)).entries()]
    .map(([id, data]) => [id, ['deleted', 'dismissed', 'read'].filter((flag) => data[flag] === true)] as const)
    .sort(([a], [b]) => a.localeCompare(b)));

const eventsOf = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/notifications`).get()).docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, unknown> & { id: string }));

/** O evento compartilhado nunca recebe `read`, `dismissed` nem `deleted`. */
const expectSharedEventsPristine = async (workspaceId: string, total: number) => {
  const events = await eventsOf(workspaceId);
  expect(events, 'os eventos compartilhados continuam todos').toHaveLength(total);
  expect(
    events.filter((event) => ['read', 'readAt', 'dismissed', 'dismissedAt', 'deleted', 'deletedAt'].some((key) => key in event)),
    'nenhum evento compartilhado ganhou estado por usuário',
  ).toHaveLength(0);
};

// ------------------------------------------------------------------ navegador

interface SessionOptions {
  viewport?: { width: number; height: number };
  scheme?: 'light' | 'dark';
  /** Celular de verdade: toque, sem hover (`(hover: none)`). */
  touch?: boolean;
}

const DASHBOARD = /Transações Recentes|Saldo Atual/i;

const login = async (page: Page, email: string) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(DASHBOARD).first()).toBeVisible({ timeout: 45_000 });
};

/** Contexto novo (outro dispositivo) já logado e com o tema pedido. */
const openSession = async (browser: Browser, email: string, options: SessionOptions = {}) => {
  const scheme = options.scheme ?? 'light';
  const context: BrowserContext = await browser.newContext({
    viewport: options.viewport ?? DESKTOP,
    colorScheme: scheme,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    deviceScaleFactor: 1,
    ...(options.touch ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await login(page, email);
  const isDark = async () => /(^|\s)dark(\s|$)/.test((await page.locator('html').getAttribute('class')) ?? '');
  if ((scheme === 'dark') !== (await isDark())) {
    await page.getByRole('button', { name: scheme === 'dark' ? 'Ativar modo escuro' : 'Ativar modo claro' }).click();
  }
  await expect.poll(isDark).toBe(scheme === 'dark');
  return { context, page };
};

const openPhone = (browser: Browser, email: string) =>
  openSession(browser, email, { viewport: PHONE, touch: true, scheme: 'light' });

/**
 * Logout pelo menu lateral do celular (fechado por padrão) e login de outra
 * conta na mesma página, sem recarregar.
 */
const switchAccountOnPhone = async (page: Page, email: string) => {
  const url = new URL(page.url());
  url.searchParams.set('e2eEmail', email);
  url.searchParams.set('e2ePassword', PASSWORD);
  await page.evaluate((next) => window.history.replaceState(null, '', next), url.toString());
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).tap();
  await page.getByRole('complementary', { name: 'Menu principal' }).getByText('Sair', { exact: true }).tap();
  await expect(page.getByTestId('e2e-login-button')).toBeVisible();
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(DASHBOARD).first()).toBeVisible({ timeout: 45_000 });
};

const bell = (page: Page) => page.getByRole('button', { name: /^Notificações/ });
const panelHeading = (page: Page) => page.getByRole('heading', { name: 'Notificações', level: 3 });
const panelOf = (page: Page) => panelHeading(page).locator('xpath=ancestor::div[contains(@class,"shadow-2xl")][1]');
const chip = (page: Page) => panelHeading(page).locator('xpath=following-sibling::span[1]');
const scrollerOf = (page: Page) => panelOf(page).locator('div.overflow-y-auto').first();
const backdrop = (page: Page) => page.locator('div.fixed.inset-0.z-30');
const itemHeading = (page: Page, title: string) => panelOf(page).getByRole('heading', { name: title, level: 4 });
const itemTitles = (page: Page, prefix: string) =>
  page.locator('h4').filter({ hasText: new RegExp(`^${prefix} \\d\\d$`) });
const archiveButton = (page: Page, title: string) => page.getByRole('button', { name: `Arquivar para mim: ${title}` });
const confirmDialog = (page: Page) => page.getByRole('dialog', { name: 'Excluir notificação' });
const anyArchiveButton = (page: Page) => page.getByRole('button', { name: /^Arquivar para mim: / });
const anyDeleteButton = (page: Page) => page.getByRole('button', { name: /^Excluir para mim: / });

/** Títulos `Aviso <prefixo> NN` na lista, na ordem da tela. */
const titlesOnScreen = (page: Page, prefix: string) => itemTitles(page, prefix).allTextContents();

/** Títulos esperados: `Aviso <prefixo> NN` para os índices dados, em ordem. */
const expectedTitles = (prefix: string, indexes: number[]) => indexes.map((index) => `Aviso ${prefix} ${pad(index)}`);

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

const openPanel = async (page: Page) => {
  await bell(page).tap();
  await expect(panelHeading(page)).toBeVisible();
  await expect(page.getByText('Carregando notificações…')).toHaveCount(0);
};

const openPanelWithMouse = async (page: Page) => {
  await bell(page).click();
  await expect(panelHeading(page)).toBeVisible();
  await expect(page.getByText('Carregando notificações…')).toHaveCount(0);
};

const closePanel = async (page: Page) => {
  await page.getByRole('button', { name: 'Fechar notificações' }).tap();
  await expect(panelHeading(page)).toHaveCount(0);
};

const expectPanelOpen = async (page: Page) => {
  await expect(panelHeading(page)).toBeVisible();
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'true');
};

/** Rótulo do sino com o total exato (singular e plural do produto). */
const unreadLabel = (n: number) => {
  if (n === 0) return 'Notificações, nenhuma não lida';
  return `Notificações, ${n} não ${n === 1 ? 'lida' : 'lidas'}`;
};

const expectBell = (page: Page, n: number) => expect(bell(page)).toHaveAccessibleName(unreadLabel(n));

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const spendAnimations = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
  .map((animation) => animation.finished.catch(() => undefined))));

/**
 * Troca de workspace pelo menu da conta. No celular de 390 px esse menu fica
 * oculto (`hidden sm:flex` no cabeçalho): o seletor só existe a partir de
 * 640 px. O teste alarga a janela só para alcançá-lo, com toque, e a devolve ao
 * tamanho do celular antes de qualquer ação sobre as notificações.
 */
const switchWorkspaceWithTouch = async (page: Page, choice: Locator, heading: string) => {
  await page.setViewportSize({ width: 720, height: PHONE.height });
  await page.getByRole('button', { name: 'Abrir menu da conta' }).tap();
  await choice.tap();
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  await page.setViewportSize(PHONE);
  await expect(page.getByRole('button', { name: 'Abrir menu da conta' })).toBeHidden();
};

/** Dono único e workspace próprio por caso. */
const seedOwner = async (name: string, workspaceName: string) => {
  const owner = user(name);
  const ws = `p5e11-${name}-${unique()}`;
  await createAuthUsers([owner]);
  await seedOwnedWorkspace({ uid: owner.uid, email: owner.email, workspaceId: ws, name: workspaceName, type: 'PF' });
  return { owner, ws };
};

test.beforeEach(async () => {
  // Reset pelo endpoint do Emulator, esperando transações pendentes do teste anterior.
  await clearEmulatorData();
});

// ================================================================ 01

test('P5-E1.1 01 — um arquivamento: sai da lista, o sino cai em 1 e só o estado dele é gravado', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c01', 'Casa 01');
  await seedShelfEvents(ws, shelf('U', 'u', 8));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 8);
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso U')).toHaveCount(8);

  await archiveButton(page, 'Aviso U 02').tap();

  await expect(itemHeading(page, 'Aviso U 02')).toHaveCount(0);
  await expect(itemTitles(page, 'Aviso U')).toHaveCount(7);
  await expectBell(page, 7);
  await expect(chip(page).locator('.sr-only')).toHaveText('7 não lidas');
  await expectPanelOpen(page);
  await expect.poll(() => titlesOnScreen(page, 'Aviso U')).toEqual(expectedTitles('U', [0, 1, 3, 4, 5, 6, 7]));

  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ u_02: ['dismissed'] });
  const state = (await statesOf(ws, owner.uid)).get('u_02')!;
  expect(Object.keys(state).sort(), 'só a marca de arquivamento, o carimbo e a expiração').toEqual(['dismissed', 'dismissedAt', 'expiresAt']);
  expect(state.dismissedAt).toBeInstanceOf(timestamp());
  const sharedEvent = (await db().doc(`workspaces/${ws}/notifications/u_02`).get()).data()!;
  expect((state.expiresAt as Stamp).isEqual(sharedEvent.expiresAt as Stamp), 'expiresAt do estado = o do evento').toBe(true);
  await expectSharedEventsPristine(ws, 8);
  await context.close();
});

// ================================================================ 02

test('P5-E1.1 02 — dois arquivamentos rápidos: os dois persistem, o painel continua aberto e nenhum outro aviso é tocado', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c02', 'Casa 02');
  await seedShelfEvents(ws, shelf('D', 'd', 8));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 8);
  await openPanel(page);

  // Dois toques seguidos, sem esperar a lista assentar entre eles.
  await archiveButton(page, 'Aviso D 01').tap();
  await archiveButton(page, 'Aviso D 04').tap();

  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ d_01: ['dismissed'], d_04: ['dismissed'] });
  await expect(itemTitles(page, 'Aviso D')).toHaveCount(6);
  await expect.poll(() => titlesOnScreen(page, 'Aviso D')).toEqual(expectedTitles('D', [0, 2, 3, 5, 6, 7]));
  await expectBell(page, 6);
  await expectPanelOpen(page);
  // O mapa de estados tem exatamente os dois IDs: nenhum outro aviso foi lido.
  expect([...(await statesOf(ws, owner.uid)).keys()].sort()).toEqual(['d_01', 'd_04']);
  await expectSharedEventsPristine(ws, 8);
  await context.close();
});

// ================================================================ 03

test('P5-E1.1 03 — arquivar depois de marcar como lido: guarda as duas marcas e o sino não muda no arquivamento', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c03', 'Casa 03');
  await seedShelfEvents(ws, shelf('R', 'r', 6));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 6);
  await openPanel(page);

  // Tocar no corpo do aviso: marca como lido, navega (o 00 abre "Metas") e fecha o painel.
  await itemHeading(page, 'Aviso R 00').tap();
  await expect(panelHeading(page)).toHaveCount(0);
  await expect(page.getByText(DASHBOARD)).toHaveCount(0);
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ r_00: ['read'] });
  await expectBell(page, 5);

  // Reabre e arquiva esse mesmo aviso.
  await openPanel(page);
  await expect(itemHeading(page, 'Aviso R 00')).toBeVisible();
  await archiveButton(page, 'Aviso R 00').tap();

  await expect(itemHeading(page, 'Aviso R 00')).toHaveCount(0);
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ r_00: ['dismissed', 'read'] });
  const state = (await statesOf(ws, owner.uid)).get('r_00')!;
  expect(Object.keys(state).sort()).toEqual(['dismissed', 'dismissedAt', 'expiresAt', 'read', 'readAt']);
  // Já estava lido: o arquivamento não muda o total.
  await expectBell(page, 5);
  await expect(chip(page).locator('.sr-only')).toHaveText('5 não lidas');
  await expect(itemTitles(page, 'Aviso R')).toHaveCount(5);
  await expectPanelOpen(page);
  await expectSharedEventsPristine(ws, 6);
  await context.close();
});

// ================================================================ 04

test('P5-E1.1 04 — aviso no fim da lista: arquivar o último (depois de rolar) mexe só nele e o painel fica aberto', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c04', 'Casa 04');
  await seedShelfEvents(ws, shelf('L', 'l', 12));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 12);
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso L')).toHaveCount(12);

  // Rola até o último: no celular ele começa fora da área visível da lista.
  const last = archiveButton(page, 'Aviso L 11');
  const scrollerBox = (await scrollerOf(page).boundingBox())!;
  expect((await last.boundingBox())!.y, 'o último começa abaixo da área visível').toBeGreaterThan(scrollerBox.y + scrollerBox.height);
  await last.scrollIntoViewIfNeeded();
  await last.tap();

  await expect(itemHeading(page, 'Aviso L 11')).toHaveCount(0);
  await expect(itemTitles(page, 'Aviso L')).toHaveCount(11);
  await expect.poll(() => titlesOnScreen(page, 'Aviso L')).toEqual(expectedTitles('L', range(0, 10)));
  await expectBell(page, 11);
  await expectPanelOpen(page);
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ l_11: ['dismissed'] });
  await expectSharedEventsPristine(ws, 12);
  await context.close();
});

// ================================================================ 05

test('P5-E1.1 05 — arquivar enquanto a contagem atualiza: contagem final exata, os dois persistidos e a lista certa', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c05', 'Casa 05');
  await seedShelfEvents(ws, shelf('C', 'c', 8));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 8);
  await openPanel(page);

  // Sem interceptar a rede não há como segurar a resposta: o segundo toque sai
  // assim que a releitura da contagem (disparada pelo primeiro) foi enviada,
  // com ela em voo. O que se prova é o estado final, que não pode depender da ordem.
  const countRequest = page.waitForRequest(/getNotificationUnreadCount/);
  await archiveButton(page, 'Aviso C 02').tap();
  await countRequest;
  await archiveButton(page, 'Aviso C 05').tap();

  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ c_02: ['dismissed'], c_05: ['dismissed'] });
  await expectBell(page, 6);
  await expect(chip(page).locator('.sr-only')).toHaveText('6 não lidas');
  await expect(itemTitles(page, 'Aviso C')).toHaveCount(6);
  await expect.poll(() => titlesOnScreen(page, 'Aviso C')).toEqual(expectedTitles('C', [0, 1, 3, 4, 6, 7]));
  await expectPanelOpen(page);
  await expectSharedEventsPristine(ws, 8);
  await context.close();
});

// ================================================================ 06

test('P5-E1.1 06 — arquivar e trocar de workspace: o outro fica intacto e, na volta, o arquivado continua fora', async ({ browser }) => {
  test.setTimeout(300_000);
  const owner = user('c06');
  const suffix = unique();
  const PF = { id: `p5e11-c06-pf-${suffix}`, name: 'Pessoal Seis' };
  const PJ = { id: `p5e11-c06-pj-${suffix}`, name: 'Empresa Seis' };
  await createAuthUsers([owner]);
  await seedOwnedWorkspace({
    uid: owner.uid, email: owner.email, workspaceId: PF.id, name: PF.name, type: 'PF',
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  await seedPaidPlan(owner.uid, 'pro');
  await seedOwnedWorkspace({
    uid: owner.uid, email: owner.email, workspaceId: PJ.id, name: PJ.name, type: 'PJ',
    joinedAt: new Date('2026-01-02T00:00:00.000Z'),
  });
  await seedShelfEvents(PF.id, shelf('PF', 'pf', 4));
  await seedShelfEvents(PJ.id, shelf('PJ', 'pj', 6));

  const { context, page } = await openPhone(browser, owner.email);
  await expect(page.getByRole('heading', { name: 'Minhas Finanças', level: 1 })).toBeVisible();
  await expectBell(page, 4);
  await openPanel(page);
  await archiveButton(page, 'Aviso PF 01').tap();
  await expect(itemHeading(page, 'Aviso PF 01')).toHaveCount(0);
  await expectBell(page, 3);
  await expect.poll(() => flagsOf(PF.id, owner.uid)).toEqual({ pf_01: ['dismissed'] });
  await closePanel(page);

  // PF → PJ: lista e sino do PJ intactos; nada gravado no PJ.
  await switchWorkspaceWithTouch(page, page.getByRole('button', { name: PJ.name }).first(), 'Finanças da Empresa');
  await expectBell(page, 6);
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso PJ')).toHaveCount(6);
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(0);
  expect((await statesOf(PJ.id, owner.uid)).size, 'nenhum estado gravado no PJ').toBe(0);
  await closePanel(page);

  // PJ → PF: o arquivado continua fora e o sino do PF continua certo.
  await switchWorkspaceWithTouch(page, page.getByRole('button', { name: 'Pessoal', exact: true }), 'Minhas Finanças');
  await expectBell(page, 3);
  await openPanel(page);
  await expect.poll(() => titlesOnScreen(page, 'Aviso PF')).toEqual(expectedTitles('PF', [0, 2, 3]));
  await expect(itemHeading(page, 'Aviso PF 01')).toHaveCount(0);
  await expect(itemTitles(page, 'Aviso PJ')).toHaveCount(0);
  expect(await flagsOf(PF.id, owner.uid)).toEqual({ pf_01: ['dismissed'] });
  expect((await statesOf(PJ.id, owner.uid)).size).toBe(0);
  await context.close();
});

// ================================================================ 07

test('P5-E1.1 07 — arquivar e trocar de usuário: o outro membro ainda vê o aviso e o estado é só de quem arquivou', async ({ browser }) => {
  test.setTimeout(300_000);
  const A = user('c07-owner');
  const B = user('c07-member');
  const ws = `p5e11-c07-${unique()}`;
  await createAuthUsers([A, B]);
  await seedOwnedWorkspace({ uid: A.uid, email: A.email, workspaceId: ws, name: 'Casa 07', type: 'PF' });
  await seedAccountProfile({ uid: B.uid, email: B.email });
  await seedMembership({ workspaceId: ws, uid: B.uid, email: B.email, role: 'member', name: 'Casa 07', type: 'PF' });
  await seedShelfEvents(ws, shelf('M', 'm', 6));

  const { context, page } = await openPhone(browser, A.email);
  await expectBell(page, 6);
  await openPanel(page);
  await archiveButton(page, 'Aviso M 03').tap();
  await expect(itemHeading(page, 'Aviso M 03')).toHaveCount(0);
  await expectBell(page, 5);
  await expect.poll(() => flagsOf(ws, A.uid)).toEqual({ m_03: ['dismissed'] });
  await closePanel(page);

  // B (membro do mesmo workspace) vê o aviso, com o sino dele inalterado.
  await switchAccountOnPhone(page, B.email);
  await expectBell(page, 6);
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso M')).toHaveCount(6);
  await expect(itemHeading(page, 'Aviso M 03')).toBeVisible();
  expect((await statesOf(ws, B.uid)).size, 'nenhum estado de B').toBe(0);
  expect(await flagsOf(ws, A.uid), 'os estados são só de A').toEqual({ m_03: ['dismissed'] });
  await closePanel(page);

  // De volta a A: o arquivamento dele continua valendo.
  await switchAccountOnPhone(page, A.email);
  await expectBell(page, 5);
  await openPanel(page);
  await expect.poll(() => titlesOnScreen(page, 'Aviso M')).toEqual(expectedTitles('M', [0, 1, 2, 4, 5]));
  await expectSharedEventsPristine(ws, 6);
  await context.close();
});

// ================================================================ 08

test('P5-E1.1 08 — arquivar e recarregar a página: o arquivado continua fora e o estado persiste', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c08', 'Casa 08');
  await seedShelfEvents(ws, shelf('P', 'p', 6));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 6);
  await openPanel(page);
  await archiveButton(page, 'Aviso P 02').tap();
  await expect(itemHeading(page, 'Aviso P 02')).toHaveCount(0);
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ p_02: ['dismissed'] });

  await page.reload();
  await expect(page.getByText(DASHBOARD).first()).toBeVisible({ timeout: 45_000 });
  await expectBell(page, 5);
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso P')).toHaveCount(5);
  await expect.poll(() => titlesOnScreen(page, 'Aviso P')).toEqual(expectedTitles('P', [0, 1, 3, 4, 5]));
  await expect(itemHeading(page, 'Aviso P 02')).toHaveCount(0);
  expect(await flagsOf(ws, owner.uid)).toEqual({ p_02: ['dismissed'] });
  await context.close();
});

// ================================================================ 09

/**
 * Falha real do Firestore, sem interceptação: o membro perde a membership no
 * Emulator (Admin SDK) com o painel aberto, e a escrita do estado privado é
 * negada pelas Rules (`permission-denied`). O produto mostra o erro em pt-BR,
 * o aviso NÃO some por suposição e nada é gravado. Com a membership de volta,
 * tocar de novo arquiva e persiste.
 *
 * Por que não `context.setOffline`: o app usa TanStack Query com o modo de rede
 * padrão, e uma mutação disparada sem rede fica PAUSADA (não falha) até a rede
 * voltar; não há erro determinístico para observar.
 */
test('P5-E1.1 09 — falha do Firestore: erro em pt-BR, o aviso continua na lista, nada é gravado e, restabelecida a permissão, arquiva', async ({ browser }) => {
  test.setTimeout(300_000);
  const O = user('c09-owner');
  const M = user('c09-member');
  const ws = `p5e11-c09-${unique()}`;
  await createAuthUsers([O, M]);
  await seedOwnedWorkspace({ uid: O.uid, email: O.email, workspaceId: ws, name: 'Casa 09', type: 'PF' });
  await seedAccountProfile({ uid: M.uid, email: M.email });
  await seedMembership({ workspaceId: ws, uid: M.uid, email: M.email, role: 'member', name: 'Casa 09', type: 'PF' });
  await seedShelfEvents(ws, shelf('O', 'o', 6));

  const { context, page } = await openPhone(browser, M.email);
  await expectBell(page, 6);
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso O')).toHaveCount(6);

  // Perda real de permissão: a membership some no Emulator.
  await db().doc(`workspaces/${ws}/members/${M.uid}`).delete();
  await archiveButton(page, 'Aviso O 02').tap();

  await expect(panelOf(page).getByRole('alert'))
    .toHaveText('Você não tem permissão para atualizar notificações neste espaço.');
  await expect(itemHeading(page, 'Aviso O 02'), 'o aviso não some por suposição').toBeVisible();
  await expect(itemTitles(page, 'Aviso O')).toHaveCount(6);
  await expectPanelOpen(page);
  expect((await statesOf(ws, M.uid)).size, 'nada gravado durante a falha').toBe(0);

  // Permissão de volta: tocar de novo arquiva, o erro some e o estado persiste.
  await seedMembership({ workspaceId: ws, uid: M.uid, email: M.email, role: 'member', name: 'Casa 09', type: 'PF' });
  await archiveButton(page, 'Aviso O 02').tap();

  await expect(itemHeading(page, 'Aviso O 02')).toHaveCount(0);
  await expect(panelOf(page).getByRole('alert')).toHaveCount(0);
  await expect.poll(() => flagsOf(ws, M.uid)).toEqual({ o_02: ['dismissed'] });
  await expectBell(page, 5);
  await expect.poll(() => titlesOnScreen(page, 'Aviso O')).toEqual(expectedTitles('O', [0, 1, 3, 4, 5]));
  expect((await statesOf(ws, O.uid)).size, 'o dono não foi afetado').toBe(0);
  await expectSharedEventsPristine(ws, 6);
  await context.close();
});

// ================================================================ 10

test('P5-E1.1 10 — viewer arquivando: persiste, o sino cai em 1 e não existe nenhum botão de excluir', async ({ browser }) => {
  test.setTimeout(300_000);
  const O = user('c10-owner');
  const V = user('c10-viewer');
  const ws = `p5e11-c10-${unique()}`;
  await createAuthUsers([O, V]);
  await seedOwnedWorkspace({ uid: O.uid, email: O.email, workspaceId: ws, name: 'Casa 10', type: 'PF' });
  await seedAccountProfile({ uid: V.uid, email: V.email });
  await seedMembership({ workspaceId: ws, uid: V.uid, email: V.email, role: 'viewer', name: 'Casa 10', type: 'PF' });
  await seedShelfEvents(ws, shelf('V', 'v', 6));

  const { context, page } = await openPhone(browser, V.email);
  await expectBell(page, 6);
  await openPanel(page);
  await expect(anyArchiveButton(page)).toHaveCount(6);
  await expect(anyDeleteButton(page)).toHaveCount(0);

  await archiveButton(page, 'Aviso V 02').tap();

  await expect(itemHeading(page, 'Aviso V 02')).toHaveCount(0);
  await expectBell(page, 5);
  await expect.poll(() => flagsOf(ws, V.uid)).toEqual({ v_02: ['dismissed'] });
  expect((await statesOf(ws, O.uid)).size, 'o dono não foi afetado').toBe(0);
  await expect(anyArchiveButton(page)).toHaveCount(5);
  await expect(anyDeleteButton(page)).toHaveCount(0);
  await expectPanelOpen(page);
  await expectSharedEventsPristine(ws, 6);
  await context.close();
});

// ================================================================ 11

const REST_DOCS = 'projects/minhas-financas-local/databases/(default)/documents';
const COMMIT_URL = `http://127.0.0.1:8080/v1/${REST_DOCS}:commit`;

/** Instante com a precisão de nanossegundos do Firestore, no formato RFC 3339 da API REST. */
const rfc3339 = (stamp: Stamp) =>
  `${new Date(stamp.seconds * 1000).toISOString().slice(0, 19)}.${String(stamp.nanoseconds).padStart(9, '0')}Z`;

/**
 * Escrita direta do estado privado pela API REST do Emulator, como o SDK faria,
 * com o token do usuário e portanto SOB as Rules. `create`: documento novo com a
 * marca e a expiração do evento; senão acrescenta a marca (máscara) a um
 * documento existente. O carimbo é sempre `REQUEST_TIME`, o que as Rules exigem.
 */
const writeMark = (
  request: APIRequestContext,
  token: string,
  target: { ws: string; uid: string; id: string },
  mark: 'dismissed' | 'deleted',
  expiresAt: Stamp | null,
) => request.post(COMMIT_URL, {
  headers: { Authorization: `Bearer ${token}` },
  data: {
    writes: [{
      update: {
        name: `${REST_DOCS}/workspaces/${target.ws}/notification_user_states/${target.uid}/notification_entries/${target.id}`,
        fields: {
          [mark]: { booleanValue: true },
          ...(expiresAt ? { expiresAt: { timestampValue: rfc3339(expiresAt) } } : {}),
        },
      },
      ...(expiresAt ? {} : { updateMask: { fieldPaths: [mark] } }),
      currentDocument: { exists: expiresAt === null },
      updateTransforms: [{ fieldPath: `${mark}At`, setToServerValue: 'REQUEST_TIME' }],
    }],
  },
});

test('P5-E1.1 11 — viewer tentando excluir direto pela API: arquivar passa (200); excluir é recusado (403) e nenhum deleted é gravado', async ({ browser, request }) => {
  test.setTimeout(300_000);
  const O = user('c11-owner');
  const V = user('c11-viewer');
  const ws = `p5e11-c11-${unique()}`;
  await createAuthUsers([O, V]);
  await seedOwnedWorkspace({ uid: O.uid, email: O.email, workspaceId: ws, name: 'Casa 11', type: 'PF' });
  await seedAccountProfile({ uid: V.uid, email: V.email });
  await seedMembership({ workspaceId: ws, uid: V.uid, email: V.email, role: 'viewer', name: 'Casa 11', type: 'PF' });
  await seedShelfEvents(ws, shelf('W', 'w', 6));
  const expiry = async (id: string) => (await db().doc(`workspaces/${ws}/notifications/${id}`).get()).get('expiresAt') as Stamp;

  const viewerToken = await emulatorIdToken(request, V.email, PASSWORD);
  const ownerToken = await emulatorIdToken(request, O.email, PASSWORD);
  const viewer = (id: string) => ({ ws, uid: V.uid, id });
  const owner = (id: string) => ({ ws, uid: O.uid, id });

  // Controle do papel: as MESMAS requisições de exclusão passam para o dono, o que prova
  // que a forma delas é válida e que o 403 do viewer vem da regra de exclusão.
  const ownerCreatesDeleted = await writeMark(request, ownerToken, owner('w_03'), 'deleted', await expiry('w_03'));
  expect(ownerCreatesDeleted.status(), await ownerCreatesDeleted.text()).toBe(200);
  const ownerDismisses = await writeMark(request, ownerToken, owner('w_04'), 'dismissed', await expiry('w_04'));
  expect(ownerDismisses.status(), await ownerDismisses.text()).toBe(200);
  const ownerAddsDeleted = await writeMark(request, ownerToken, owner('w_04'), 'deleted', null);
  expect(ownerAddsDeleted.status(), await ownerAddsDeleted.text()).toBe(200);

  // (a) controle do viewer: criar o estado com `dismissed` é permitido.
  const archive = await writeMark(request, viewerToken, viewer('w_02'), 'dismissed', await expiry('w_02'));
  expect(archive.status(), await archive.text()).toBe(200);
  // (b) mesma forma com `deleted` em outro aviso: recusada.
  const deleteOther = await writeMark(request, viewerToken, viewer('w_03'), 'deleted', await expiry('w_03'));
  expect(deleteOther.status(), await deleteOther.text()).toBe(403);
  // (c) acrescentar `deleted` ao estado criado em (a): recusado.
  const deleteArchived = await writeMark(request, viewerToken, viewer('w_02'), 'deleted', null);
  expect(deleteArchived.status(), await deleteArchived.text()).toBe(403);

  // Persistido: só o arquivamento do viewer; nenhum `deleted` dele.
  const viewerStates = await statesOf(ws, V.uid);
  expect([...viewerStates.keys()]).toEqual(['w_02']);
  expect(Object.keys(viewerStates.get('w_02')!).sort()).toEqual(['dismissed', 'dismissedAt', 'expiresAt']);
  expect([...viewerStates.values()].filter((state) => 'deleted' in state || 'deletedAt' in state)).toHaveLength(0);
  expect(await flagsOf(ws, O.uid), 'o controle do dono gravou as exclusões dele').toEqual({
    w_03: ['deleted'], w_04: ['deleted', 'dismissed'],
  });

  // Na UI do viewer: o aviso de (a) saiu, o de (b) continua visível e não há botão de excluir.
  const { context, page } = await openPhone(browser, V.email);
  await expectBell(page, 5);
  await openPanel(page);
  await expect(itemHeading(page, 'Aviso W 03')).toBeVisible();
  await expect(itemHeading(page, 'Aviso W 02')).toHaveCount(0);
  await expect(itemTitles(page, 'Aviso W')).toHaveCount(5);
  await expect(anyDeleteButton(page)).toHaveCount(0);
  await context.close();
});

// ================================================================ 12

test('P5-E1.1 12 — toque perto do limite do painel: arquivar o aviso cujo botão está colado à borda inferior da lista mexe só nele', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c12', 'Casa 12');
  await seedShelfEvents(ws, shelf('B', 'b', 12));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 12);
  await openPanel(page);
  await spendAnimations(page);

  // Leva o botão do aviso 05 aos últimos 40 px visíveis da lista (sem passar da borda).
  const target = archiveButton(page, 'Aviso B 05');
  await target.scrollIntoViewIfNeeded();
  const before = (await target.boundingBox())!;
  const scrollerBefore = (await scrollerOf(page).boundingBox())!;
  const shift = before.y + before.height - (scrollerBefore.y + scrollerBefore.height - 40);
  await scrollerOf(page).evaluate((node, delta) => { node.scrollTop += delta; }, shift);
  await expect.poll(async () => {
    const box = (await target.boundingBox())!;
    const scroller = (await scrollerOf(page).boundingBox())!;
    return scroller.y + scroller.height - (box.y + box.height);
  }, { message: 'o botão fica nos últimos 80 px da lista, ainda inteiro dentro dela' }).toBeGreaterThanOrEqual(0);
  const box = (await target.boundingBox())!;
  const scroller = (await scrollerOf(page).boundingBox())!;
  const distanceToBottom = scroller.y + scroller.height - (box.y + box.height);
  expect(distanceToBottom, 'botão inteiro dentro da lista').toBeGreaterThanOrEqual(0);
  expect(distanceToBottom, 'botão nos últimos 80 px da lista').toBeLessThanOrEqual(80);

  await target.tap();

  await expect(itemHeading(page, 'Aviso B 05')).toHaveCount(0);
  await expect(itemTitles(page, 'Aviso B')).toHaveCount(11);
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ b_05: ['dismissed'] });
  await expectBell(page, 11);
  await expectPanelOpen(page);
  await expectSharedEventsPristine(ws, 12);
  await context.close();
});

// ================================================================ 13

test('P5-E1.1 13 — painel perto da borda: o painel e todos os botões ficam dentro dos 390 px e arquivar o primeiro funciona', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c13', 'Casa 13');
  await seedShelfEvents(ws, shelf('E', 'e', 8));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 8);
  await openPanel(page);
  await spendAnimations(page);

  const panelBox = (await panelOf(page).boundingBox())!;
  expect(panelBox.x, 'painel não passa da borda esquerda').toBeGreaterThanOrEqual(0);
  expect(panelBox.x + panelBox.width, 'painel não passa da borda direita').toBeLessThanOrEqual(PHONE.width);
  const buttons = anyArchiveButton(page);
  expect(await buttons.count()).toBe(8);
  for (let index = 0; index < 8; index += 1) {
    const box = (await buttons.nth(index).boundingBox())!;
    expect(box.x, `botão Arquivar ${index} dentro da borda esquerda`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `botão Arquivar ${index} dentro da borda direita`).toBeLessThanOrEqual(PHONE.width);
    expect(box.x, `botão Arquivar ${index} dentro do painel`).toBeGreaterThanOrEqual(panelBox.x);
    expect(box.x + box.width, `botão Arquivar ${index} dentro do painel`).toBeLessThanOrEqual(panelBox.x + panelBox.width);
  }
  expect(await horizontalOverflow(page)).toBe(0);

  await archiveButton(page, 'Aviso E 00').tap();

  await expect(itemHeading(page, 'Aviso E 00')).toHaveCount(0);
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ e_00: ['dismissed'] });
  await expect(itemTitles(page, 'Aviso E')).toHaveCount(7);
  await expectBell(page, 7);
  await expectPanelOpen(page);
  await context.close();
});

// ================================================================ 14

test('P5-E1.1 14 — sem rolagem horizontal: o excesso é 0 ao abrir o painel e depois de cada um de 3 arquivamentos', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c14', 'Casa 14');
  await seedShelfEvents(ws, shelf('H', 'h', 8));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 8);
  expect(await horizontalOverflow(page), 'antes de abrir o painel').toBe(0);
  await openPanel(page);
  await spendAnimations(page);
  expect(await horizontalOverflow(page), 'painel aberto').toBe(0);

  let remaining = 8;
  for (const index of [0, 3, 6]) {
    await archiveButton(page, `Aviso H ${pad(index)}`).tap();
    remaining -= 1;
    await expect(itemHeading(page, `Aviso H ${pad(index)}`)).toHaveCount(0);
    await expect(itemTitles(page, 'Aviso H')).toHaveCount(remaining);
    await spendAnimations(page);
    expect(await horizontalOverflow(page), `depois de arquivar ${pad(index)}`).toBe(0);
  }
  await expectBell(page, 5);
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ h_00: ['dismissed'], h_03: ['dismissed'], h_06: ['dismissed'] });
  expect(await horizontalOverflow(page), 'ao final').toBe(0);
  await expectPanelOpen(page);
  await context.close();
});

// ================================================================ 15

test('P5-E1.1 15 — tocar dentro do painel nunca o fecha pelo fundo, nem com o clique redirecionado; o fundo só fecha com gesto iniciado nele', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c15', 'Casa 15');
  await seedShelfEvents(ws, shelf('F', 'f', 4));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 4);
  await openPanel(page);
  await spendAnimations(page);

  // Toques de verdade dentro do painel: título e chip.
  await panelHeading(page).tap();
  await expectPanelOpen(page);
  await chip(page).tap();
  await expectPanelOpen(page);

  // Clique redirecionado: o gesto começou dentro do painel (`pointerdown` no título)
  // e o `click` de compatibilidade cai no fundo. O fundo não pode fechar o painel.
  await expect(backdrop(page)).toHaveCount(1);
  // Como no Chromium, o `click` é um PointerEvent com o mesmo `pointerId` do gesto.
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h3')].find((node) => node.textContent?.trim() === 'Notificações')!;
    heading.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, pointerId: 31, pointerType: 'touch' }));
    document.querySelector('div.fixed.inset-0.z-30')!.dispatchEvent(new PointerEvent('click', {
      bubbles: true, cancelable: true, composed: true, detail: 1, pointerId: 31, pointerType: 'touch',
    }));
  });
  await expectPanelOpen(page);
  await expect(itemTitles(page, 'Aviso F')).toHaveCount(4);

  // Controle: o mesmo par de eventos com o gesto iniciado NO fundo fecha o painel
  // (prova que o clique sintético chega ao manipulador do fundo).
  await page.evaluate(() => {
    const fundo = document.querySelector('div.fixed.inset-0.z-30')!;
    fundo.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, pointerId: 32, pointerType: 'touch' }));
    fundo.dispatchEvent(new PointerEvent('click', {
      bubbles: true, cancelable: true, composed: true, detail: 1, pointerId: 32, pointerType: 'touch',
    }));
  });
  await expect(panelHeading(page)).toHaveCount(0);
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'false');
  expect((await statesOf(ws, owner.uid)).size, 'nenhum estado gravado').toBe(0);
  await context.close();
});

// ================================================================ 16

test('P5-E1.1 16 — fechamento legítimo fora: tocar no fundo longe do painel fecha o painel e não grava nada', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c16', 'Casa 16');
  await seedShelfEvents(ws, shelf('G', 'g', 2));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 2);
  await openPanel(page);
  await spendAnimations(page);

  // O ponto do toque é do fundo transparente, e não do painel.
  const insideBackdrop = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return element !== null && element.matches('div.fixed.inset-0.z-30');
  }, { x: 20, y: 820 });
  expect(insideBackdrop, 'o ponto (20, 820) é o fundo transparente').toBe(true);
  const panelBox = (await panelOf(page).boundingBox())!;
  expect(panelBox.y + panelBox.height, 'o painel termina acima do ponto tocado').toBeLessThan(820);

  await page.touchscreen.tap(20, 820);

  await expect(panelHeading(page)).toHaveCount(0);
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'false');
  await expectBell(page, 2);
  expect((await statesOf(ws, owner.uid)).size, 'nenhum estado gravado').toBe(0);
  await expectSharedEventsPristine(ws, 2);
  await context.close();
});

// ================================================================ 17

test('P5-E1.1 17 — teclado e foco (desktop): Enter e Espaço arquivam, o painel continua aberto e nenhum aviso é aberto por engano', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c17', 'Casa 17');
  await seedShelfEvents(ws, shelf('K', 'k', 6));

  const { context, page } = await openSession(browser, owner.email, { viewport: DESKTOP, scheme: 'light' });
  await expectBell(page, 6);

  // Abre o painel só pelo teclado: Tab desde o início do documento até o sino, e Enter.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let tabs = 0;
  while (tabs < 80) {
    await page.keyboard.press('Tab');
    tabs += 1;
    if (await page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Notificações') ?? false)) break;
  }
  expect(tabs, 'o sino é alcançado por Tab').toBeLessThan(80);
  await expect(bell(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expectPanelOpen(page);
  await expect(page.getByText('Carregando notificações…')).toHaveCount(0);
  await expect(itemTitles(page, 'Aviso K')).toHaveCount(6);

  const focusIsSafe = () => page.evaluate(() => {
    const active = document.activeElement;
    return active === document.body || (active !== null && active.closest('.shadow-2xl') !== null);
  });

  // Enter no botão focado.
  await archiveButton(page, 'Aviso K 00').focus();
  await expect(archiveButton(page, 'Aviso K 00')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(itemHeading(page, 'Aviso K 00')).toHaveCount(0);
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ k_00: ['dismissed'] });
  await expectPanelOpen(page);
  expect(await focusIsSafe(), 'o foco fica no painel ou no corpo da página').toBe(true);

  // Espaço em outro aviso.
  await archiveButton(page, 'Aviso K 03').focus();
  await expect(archiveButton(page, 'Aviso K 03')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(itemHeading(page, 'Aviso K 03')).toHaveCount(0);

  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ k_00: ['dismissed'], k_03: ['dismissed'] });
  await expect.poll(() => titlesOnScreen(page, 'Aviso K')).toEqual(expectedTitles('K', [1, 2, 4, 5]));
  await expectBell(page, 4);
  await expectPanelOpen(page);
  expect(await focusIsSafe(), 'o foco continua no painel ou no corpo da página').toBe(true);
  // Nenhum aviso foi aberto nem lido por engano.
  expect([...(await statesOf(ws, owner.uid)).values()].filter((state) => 'read' in state)).toHaveLength(0);
  await expectSharedEventsPristine(ws, 6);
  await context.close();
});

// ================================================================ 18

test('P5-E1.1 18 — leitura e arquivamento persistidos entre dispositivos: o aviso lido no celular aparece lido no desktop, e arquivado lá sai do celular', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c18', 'Casa 18');
  await seedShelfEvents(ws, shelf('S', 's', 6));

  // Contexto 1: celular. Tocar no corpo do aviso marca como lido.
  const phone = await openPhone(browser, owner.email);
  await expectBell(phone.page, 6);
  await openPanel(phone.page);
  await itemHeading(phone.page, 'Aviso S 00').tap();
  await expect(panelHeading(phone.page)).toHaveCount(0);
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ s_00: ['read'] });
  await expectBell(phone.page, 5);

  // Contexto 2: desktop, mesmo usuário. O aviso aparece como lido e o total é 5.
  const desktop = await openSession(browser, owner.email, { viewport: DESKTOP, scheme: 'light' });
  await expectBell(desktop.page, 5);
  await openPanelWithMouse(desktop.page);
  await expect(itemTitles(desktop.page, 'Aviso S')).toHaveCount(6);
  await expect(chip(desktop.page).locator('.sr-only')).toHaveText('5 não lidas');
  await expect(itemHeading(desktop.page, 'Aviso S 00'), 'lido: título esmaecido').toHaveClass(/text-muted/);
  await expect(itemHeading(desktop.page, 'Aviso S 01'), 'não lido: título em destaque').toHaveClass(/text-on-surface/);

  // Arquiva no desktop.
  await archiveButton(desktop.page, 'Aviso S 00').click();
  await expect(itemHeading(desktop.page, 'Aviso S 00')).toHaveCount(0);
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ s_00: ['dismissed', 'read'] });
  await expectBell(desktop.page, 5);

  // Contexto 1, depois de recarregar: o aviso não aparece e o total é o mesmo.
  await phone.page.reload();
  await expect(phone.page.getByText(DASHBOARD).first()).toBeVisible({ timeout: 45_000 });
  await expectBell(phone.page, 5);
  await openPanel(phone.page);
  await expect(itemHeading(phone.page, 'Aviso S 00')).toHaveCount(0);
  await expect.poll(() => titlesOnScreen(phone.page, 'Aviso S')).toEqual(expectedTitles('S', [1, 2, 3, 4, 5]));
  await expectSharedEventsPristine(ws, 6);
  await desktop.context.close();
  await phone.context.close();
});

// ================================================================ 19 e 20

type RedirectTarget = { title: string; on: 'corpo' | 'arquivar' | 'excluir' } | { on: 'cabecalho' };

/**
 * Reproduz, no navegador real, o clique redirecionado que causava a falha: o
 * gesto começa num elemento (`pointerdown`) e o `click` de compatibilidade (no
 * Chromium, um PointerEvent com o mesmo `pointerId`) cai em outro.
 */
const redirectedClick = (page: Page, input: { downOn: RedirectTarget; clickOn: RedirectTarget; pointerId: number }) =>
  page.evaluate(({ downOn, clickOn, pointerId }) => {
    const find = (target: { title?: string; on: string }): Element => {
      if (target.on === 'cabecalho') {
        return [...document.querySelectorAll('h3')].find((node) => node.textContent?.trim() === 'Notificações')!;
      }
      if (target.on === 'corpo') {
        return [...document.querySelectorAll('h4')].find((node) => node.textContent?.trim() === target.title)!;
      }
      const label = target.on === 'arquivar' ? `Arquivar para mim: ${target.title}` : `Excluir para mim: ${target.title}`;
      return document.querySelector(`button[aria-label="${label}"]`)!;
    };
    find(downOn).dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, composed: true, pointerId, pointerType: 'touch',
    }));
    find(clickOn).dispatchEvent(new PointerEvent('click', {
      bubbles: true, cancelable: true, composed: true, detail: 1, pointerId, pointerType: 'touch',
    }));
  }, input);

test('P5-E1.1 19 — clique redirecionado age no aviso em que o toque começou, nunca no aviso onde caiu', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c19', 'Casa 19');
  await seedShelfEvents(ws, shelf('R', 'r', 4));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 4);
  await openPanel(page);
  await spendAnimations(page);

  // Toque em "Arquivar" do R 00; o click caiu no corpo do R 01: arquiva o R 00 e não abre o R 01.
  await redirectedClick(page, {
    downOn: { title: 'Aviso R 00', on: 'arquivar' }, clickOn: { title: 'Aviso R 01', on: 'corpo' }, pointerId: 41,
  });
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ r_00: ['dismissed'] });
  await expectPanelOpen(page);
  await expect(itemTitles(page, 'Aviso R')).toHaveCount(3);
  await expect(itemHeading(page, 'Aviso R 00')).toHaveCount(0);
  await expectBell(page, 3);

  // Toque no corpo do R 02; o click caiu no corpo do R 03: abre o R 02 (lido, painel fecha), não o R 03.
  await redirectedClick(page, {
    downOn: { title: 'Aviso R 02', on: 'corpo' }, clickOn: { title: 'Aviso R 03', on: 'corpo' }, pointerId: 42,
  });
  await expect(panelHeading(page)).toHaveCount(0);
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ r_00: ['dismissed'], r_02: ['read'] });
  await expectBell(page, 2);
  await context.close();
});

test('P5-E1.1 20 — toque iniciado em área sem dono do painel não aciona "Arquivar" nem "Excluir" onde o clique caiu', async ({ browser }) => {
  test.setTimeout(300_000);
  const { owner, ws } = await seedOwner('c20', 'Casa 20');
  await seedShelfEvents(ws, shelf('S', 's', 4));

  const { context, page } = await openPhone(browser, owner.email);
  await expectBell(page, 4);
  await openPanel(page);
  await spendAnimations(page);

  // Toque no cabeçalho do painel; o click caiu em "Arquivar" do S 01 e em "Excluir" do S 02: nada acontece.
  await redirectedClick(page, { downOn: { on: 'cabecalho' }, clickOn: { title: 'Aviso S 01', on: 'arquivar' }, pointerId: 51 });
  await redirectedClick(page, { downOn: { on: 'cabecalho' }, clickOn: { title: 'Aviso S 02', on: 'excluir' }, pointerId: 52 });
  await expect(confirmDialog(page)).toHaveCount(0);
  await expectPanelOpen(page);
  await expect(itemTitles(page, 'Aviso S')).toHaveCount(4);
  await expectBell(page, 4);
  expect((await statesOf(ws, owner.uid)).size, 'nada arquivado, lido nem excluído').toBe(0);

  // Controle: o gesto iniciado no próprio "Arquivar" do S 01 arquiva só ele.
  await redirectedClick(page, {
    downOn: { title: 'Aviso S 01', on: 'arquivar' }, clickOn: { title: 'Aviso S 01', on: 'arquivar' }, pointerId: 53,
  });
  await expect.poll(() => flagsOf(ws, owner.uid)).toEqual({ s_01: ['dismissed'] });
  await expect(itemTitles(page, 'Aviso S')).toHaveCount(3);
  await expectBell(page, 3);
  await expectPanelOpen(page);
  await context.close();
});
