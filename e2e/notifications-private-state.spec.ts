import { expect, test, type Page, type Route } from '@playwright/test';

import { adminSdk, clearEmulatorData, seedAccountProfile, seedMembership, seedOwnedWorkspace, seedPaidPlan } from './support/workspaceSeed';

/**
 * P5-D1 (PR-NOTIF-01) — notificações de ponta a ponta no Emulator, com contas,
 * workspaces, Rules e eventos reais (gravados pelo Admin SDK, como o
 * produtor do backend).
 *
 * D-18-NOTIF: o estado privado fica em
 * `workspaces/{ws}/notification_user_states/{uid}/notification_entries/{id}` e
 * todo evento nasce com `expiresAt` (Timestamp nativo, 180 dias depois de
 * `createdAt`, como o produtor); o estado gravado pelo cliente copia o
 * `expiresAt` do evento. A retenção, a exclusão para si e a UX da exclusão
 * têm spec própria: `notifications-retention-d18.spec.ts`.
 *
 * 1. Dois usuários do mesmo workspace: leitura e arquivamento são de cada
 *    um; o evento compartilhado não muda; o arquivamento persiste na recarga
 *    e no logout/login; mais de 50 notificações paginadas por "Carregar
 *    mais", com empate de horário no corte da página; a contagem do sino é o
 *    total exato do servidor (P5-D2), também acima das 25 notificações carregadas.
 * 2. Troca de workspace com a marcação em curso (commit retido no limite de
 *    rede): só o workspace da ação é gravado; sem polling — um evento novo só
 *    aparece quando o painel é aberto com o dado vencido.
 *
 * As Rules negam listagem sem limite ou acima de 50: o painel funcionando
 * contra o Emulator prova que toda consulta do app é limitada.
 */

const PASSWORD = 'e2e-password-123456';
const A = { uid: 'e2e-notif-a', email: 'e2e-notif-a@minhas-financas.local' };
const B = { uid: 'e2e-notif-b', email: 'e2e-notif-b@minhas-financas.local' };
const PF = { id: 'e2e-notif-pf', name: 'Pessoal Avisos' };
const PJ = { id: 'e2e-notif-pj', name: 'Empresa Avisos' };

// Limpeza pelo endpoint do Emulator (sem disputa com o teste anterior).
const resetEmulatorData = clearEmulatorData;

const pad = (index: number) => String(index).padStart(2, '0');

/** Retenção das notificações (D-18-NOTIF): 180 dias a partir de `createdAt`. */
const RETENTION_MS = 180 * 86_400_000;

/**
 * Eventos na forma do produtor de cartões (sem estado de leitura), com
 * `expiresAt` Timestamp nativo (sem ele o cliente ignora o documento).
 */
const seedNotifications = async (
  workspaceId: string,
  items: Array<{ id: string; title: string; createdAt: string }>,
) => {
  const sdk = adminSdk();
  const db = sdk.firestore();
  const batch = db.batch();
  for (const item of items) {
    batch.set(db.doc(`workspaces/${workspaceId}/notifications/${item.id}`), {
      id: item.id, workspaceId, title: item.title, message: `Mensagem de ${item.title}.`,
      type: 'credit_card', link: 'cards', actionLabel: 'Ver cartões', createdAt: item.createdAt,
      expiresAt: sdk.firestore.Timestamp.fromMillis(Date.parse(item.createdAt) + RETENTION_MS),
      source: 'credit_card_invoice', domain: 'credit_card', domainEventType: 'invoice_closed',
      cardId: 'card-e2e', invoiceId: `inv-${item.id}`,
    });
  }
  await batch.commit();
};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const login = async (page: Page, email: string) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
};

/** Logout pela tela e login de outra conta na mesma página. */
const switchAccount = async (page: Page, email: string) => {
  const url = new URL(page.url());
  url.searchParams.set('e2eEmail', email);
  await page.evaluate((next) => window.history.replaceState(null, '', next), url.toString());
  await page.getByText('Sair', { exact: true }).first().click();
  await expect(page.getByTestId('e2e-login-button')).toBeVisible();
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
};

const bell = (page: Page) => page.getByRole('button', { name: /^Notificações/ });
const panelHeading = (page: Page) => page.getByRole('heading', { name: 'Notificações', level: 3 });
const itemTitles = (page: Page, prefix: string) =>
  page.locator('h4').filter({ hasText: new RegExp(`^${prefix} \\d\\d$`) });
const loadMore = (page: Page) => page.getByRole('button', { name: 'Carregar mais' });

const openPanel = async (page: Page) => {
  await bell(page).click();
  await expect(panelHeading(page)).toBeVisible();
};

const closePanel = async (page: Page) => {
  await page.getByRole('button', { name: 'Fechar notificações' }).click();
  await expect(panelHeading(page)).toHaveCount(0);
};

const statesOf = async (workspaceId: string, uid: string) => {
  const snapshot = await adminSdk().firestore()
    .collection(`workspaces/${workspaceId}/notification_user_states/${uid}/notification_entries`).get();
  return new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
};

const STATE_KEYS = new Set(['read', 'readAt', 'dismissed', 'dismissedAt', 'deleted', 'deletedAt', 'expiresAt']);

/**
 * Todo estado privado gravado pelo cliente tem só os campos do contrato e o
 * `expiresAt` (Timestamp) igual ao do evento compartilhado.
 */
const expectStatesKeepEventExpiry = async (workspaceId: string, uid: string) => {
  const db = adminSdk().firestore();
  const states = await statesOf(workspaceId, uid);
  expect(states.size, 'há estado para conferir').toBeGreaterThan(0);
  for (const [id, state] of states) {
    expect(Object.keys(state).filter((key) => !STATE_KEYS.has(key)), `campos fora do contrato em ${id}`).toEqual([]);
    const event = await db.doc(`workspaces/${workspaceId}/notifications/${id}`).get();
    const eventExpiry = event.get('expiresAt');
    expect(eventExpiry, `evento ${id} com expiresAt Timestamp`).toBeInstanceOf(adminSdk().firestore.Timestamp);
    expect(state.expiresAt, `estado ${id} com expiresAt Timestamp`).toBeInstanceOf(adminSdk().firestore.Timestamp);
    expect(state.expiresAt.isEqual(eventExpiry), `expiresAt do estado ${id} igual ao do evento`).toBe(true);
  }
};

const sharedEvents = async (workspaceId: string) =>
  (await adminSdk().firestore().collection(`workspaces/${workspaceId}/notifications`).get()).docs;

test.beforeEach(async () => {
  await resetEmulatorData();
});

test('estado privado por usuário, arquivar só para mim, paginação acima de 50 e contagem honesta', async ({ page }) => {
  test.setTimeout(240_000);
  for (const user of [A, B]) {
    await adminSdk().auth().createUser({ uid: user.uid, email: user.email, password: PASSWORD, emailVerified: true });
  }
  await seedOwnedWorkspace({ uid: A.uid, email: A.email, workspaceId: PF.id, name: PF.name, type: 'PF' });
  await seedAccountProfile({ uid: B.uid, email: B.email });
  await seedMembership({ workspaceId: PF.id, uid: B.uid, email: B.email, role: 'viewer', name: PF.name, type: 'PF' });

  // 55 eventos; os de índice 24, 25 e 26 no mesmo instante (o corte da
  // primeira página cai no meio do empate).
  const tie = minutesAgo(25);
  await seedNotifications(PF.id, Array.from({ length: 55 }, (_, index) => ({
    id: `e2e_n_${pad(index)}`,
    title: `Aviso PF ${pad(index)}`,
    createdAt: index >= 24 && index <= 26 ? tie : minutesAgo(index + 1),
  })));

  // --- A: primeira página (25 carregadas), contagem exata do servidor (55), carregar mais.
  await login(page, A.email);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 55 não lidas');
  await expect(bell(page)).toContainText('9+');
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(25);
  await expect(page.getByText('55 não lidas')).toBeAttached();
  await loadMore(page).click();
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(50);
  await loadMore(page).click();
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(55);
  await expect(loadMore(page)).toHaveCount(0);
  const titles = await itemTitles(page, 'Aviso PF').allTextContents();
  expect(new Set(titles).size, 'nenhum evento repetido entre páginas').toBe(55);
  for (const tied of ['Aviso PF 24', 'Aviso PF 25', 'Aviso PF 26']) {
    expect(titles.filter((title) => title === tied)).toHaveLength(1);
  }
  await expect(bell(page)).toHaveAccessibleName('Notificações, 55 não lidas');

  // --- A abre um aviso (marca lida, vai para Cartões e fecha o painel).
  await page.getByRole('heading', { name: 'Aviso PF 00', level: 4 }).click();
  await expect(panelHeading(page)).toHaveCount(0);
  await expect.poll(async () => (await statesOf(PF.id, A.uid)).get('e2e_n_00')?.read).toBe(true);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 54 não lidas');

  // Fechar o painel voltou o cache à primeira página; "Marcar exibidas como
  // lidas" marca só o que está na tela.
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(25);
  await page.getByRole('button', { name: 'Marcar exibidas como lidas' }).click();
  await expect.poll(async () => (await statesOf(PF.id, A.uid)).size).toBe(25);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 30 não lidas');
  await loadMore(page).click();
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(50);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 30 não lidas');
  await loadMore(page).click();
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(55);
  await page.getByRole('button', { name: 'Marcar exibidas como lidas' }).click();
  await expect(bell(page)).toHaveAccessibleName('Notificações, nenhuma não lida');
  await expect.poll(async () => [...(await statesOf(PF.id, A.uid)).values()].filter((s) => s.read === true).length)
    .toBe(55);
  await page.getByRole('button', { name: 'Arquivar para mim: Aviso PF 01' }).click();
  await expect(page.getByRole('heading', { name: 'Aviso PF 01', level: 4 })).toHaveCount(0);
  await expect.poll(async () => (await statesOf(PF.id, A.uid)).get('e2e_n_01')?.dismissed).toBe(true);
  await expectStatesKeepEventExpiry(PF.id, A.uid);

  // O evento compartilhado não mudou: nenhum `read`/`dismissed`/`deleted`, nenhum apagado.
  const shared = await sharedEvents(PF.id);
  expect(shared).toHaveLength(55);
  expect(shared.filter((doc) => 'read' in doc.data() || 'dismissed' in doc.data() || 'deleted' in doc.data()))
    .toHaveLength(0);

  // --- Recarga: lidas e arquivada persistem.
  await page.reload();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
  await expect(bell(page)).toHaveAccessibleName('Notificações, nenhuma não lida');
  await openPanel(page);
  await expect(page.getByRole('heading', { name: 'Aviso PF 00', level: 4 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aviso PF 01', level: 4 })).toHaveCount(0);
  await closePanel(page);

  // --- B (viewer) no mesmo workspace: tudo não lido, inclusive a arquivada por A.
  await switchAccount(page, B.email);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 55 não lidas');
  await openPanel(page);
  await expect(page.getByRole('heading', { name: 'Aviso PF 01', level: 4 })).toBeVisible();
  await page.getByRole('heading', { name: 'Aviso PF 02', level: 4 }).click();
  await expect(panelHeading(page)).toHaveCount(0);
  await expect.poll(async () => (await statesOf(PF.id, B.uid)).get('e2e_n_02')?.read).toBe(true);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 54 não lidas');
  expect((await statesOf(PF.id, B.uid)).size, 'só a marcação do próprio viewer').toBe(1);
  await expectStatesKeepEventExpiry(PF.id, B.uid);
  expect((await statesOf(PF.id, A.uid)).get('e2e_n_02')?.dismissed).toBeUndefined();

  // --- A de novo (logout/login): o arquivamento continua.
  await switchAccount(page, A.email);
  await expect(bell(page)).toHaveAccessibleName('Notificações, nenhuma não lida');
  await openPanel(page);
  await expect(page.getByRole('heading', { name: 'Aviso PF 00', level: 4 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aviso PF 01', level: 4 })).toHaveCount(0);
});

test('troca de workspace com marcação em curso e nenhuma releitura automática', async ({ page }) => {
  test.setTimeout(180_000);
  await adminSdk().auth().createUser({ uid: A.uid, email: A.email, password: PASSWORD, emailVerified: true });
  await seedOwnedWorkspace({
    uid: A.uid, email: A.email, workspaceId: PF.id, name: PF.name, type: 'PF',
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  await seedPaidPlan(A.uid, 'pro');
  await seedOwnedWorkspace({
    uid: A.uid, email: A.email, workspaceId: PJ.id, name: PJ.name, type: 'PJ',
    joinedAt: new Date('2026-01-02T00:00:00.000Z'),
  });
  await seedNotifications(PF.id, [0, 1, 2].map((index) => ({
    id: `pf_${index}`, title: `Aviso PF ${pad(index)}`, createdAt: minutesAgo(index + 1),
  })));
  await seedNotifications(PJ.id, [0, 1].map((index) => ({
    id: `pj_${index}`, title: `Aviso PJ ${pad(index)}`, createdAt: minutesAgo(index + 1),
  })));

  // Relógio controlado: o tempo segue normal até ser avançado de propósito.
  await page.clock.install();
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [`lastWorkspaceId_${A.uid}`, PF.id]);

  // Commit do Firestore retido no limite de rede até a liberação.
  let release = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  let markHeld = () => {};
  const held = new Promise<void>((resolve) => { markHeld = resolve; });
  let holding = false;
  await page.route('**/documents:commit*', async (route: Route) => {
    if (holding) {
      markHeld();
      await released;
    }
    await route.continue();
  });

  await login(page, A.email);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 3 não lidas');
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(3);
  holding = true;
  const markDisplayed = page.getByRole('button', { name: 'Marcar exibidas como lidas' });
  await markDisplayed.click();
  await held;
  // Enquanto a marcação está em curso, a ação fica protegida contra repetição.
  await expect(markDisplayed).toBeDisabled();
  await closePanel(page);

  // Troca para a empresa com o commit de PF ainda retido. O SDK do Firestore
  // serializa as operações do cliente: a abertura da empresa espera o commit.
  await page.getByRole('button', { name: 'Abrir menu da conta' }).click();
  await page.getByRole('button', { name: PJ.name }).first().click();
  holding = false;
  release();
  await expect(page.getByRole('heading', { name: 'Finanças da Empresa', level: 1 })).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName('Notificações, 2 não lidas');

  await expect.poll(async () => (await statesOf(PF.id, A.uid)).size).toBe(3);
  await expectStatesKeepEventExpiry(PF.id, A.uid);
  expect((await statesOf(PJ.id, A.uid)).size, 'nada gravado na empresa').toBe(0);
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso PJ')).toHaveCount(2);
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 2 não lidas');
  await closePanel(page);

  // Sem polling: um evento novo não aparece sozinho, nem depois de minutos.
  await seedNotifications(PJ.id, [{ id: 'pj_new', title: 'Aviso PJ 99', createdAt: new Date().toISOString() }]);
  await page.clock.fastForward('05:00');
  await page.waitForTimeout(1_500);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 2 não lidas');
  // Abrir o painel com o dado vencido relê a primeira página.
  await openPanel(page);
  await expect(page.getByRole('heading', { name: 'Aviso PJ 99', level: 4 })).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName('Notificações, 3 não lidas');
  await closePanel(page);

  // De volta a PF: o estado confirmado da ação está lá.
  await page.getByRole('button', { name: 'Abrir menu da conta' }).click();
  // O workspace pessoal aparece no menu como "Pessoal".
  await page.getByRole('button', { name: 'Pessoal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Minhas Finanças', level: 1 })).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName('Notificações, nenhuma não lida');
});

test('painel operado só pelo teclado: abrir, arquivar, carregar mais e marcar exibidas', async ({ page }) => {
  test.setTimeout(180_000);
  await adminSdk().auth().createUser({ uid: A.uid, email: A.email, password: PASSWORD, emailVerified: true });
  await seedOwnedWorkspace({ uid: A.uid, email: A.email, workspaceId: PF.id, name: PF.name, type: 'PF' });
  await seedNotifications(PF.id, Array.from({ length: 30 }, (_, index) => ({
    id: `kb_${pad(index)}`, title: `Aviso PF ${pad(index)}`, createdAt: minutesAgo(index + 1),
  })));

  await login(page, A.email);
  await bell(page).focus();
  await page.keyboard.press('Enter');
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(25);

  // Ordem do Tab: ação do cabeçalho, fechar, excluir para mim e arquivar de
  // cada item (D-18-NOTIF: A é owner, então vê as duas ações), carregar mais.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Marcar exibidas como lidas' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Fechar notificações' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Excluir para mim: Aviso PF 00' })).toBeFocused();
  await page.keyboard.press('Tab');
  const firstArchive = page.getByRole('button', { name: 'Arquivar para mim: Aviso PF 00' });
  await expect(firstArchive).toBeFocused();
  // O botão que aparece ao passar o mouse também aparece com o foco do teclado.
  // (A opacidade agora está no contêiner das ações: vale a opacidade efetiva.)
  await expect.poll(() => firstArchive.evaluate((node) => {
    let opacity = 1;
    for (let element: Element | null = node; element; element = element.parentElement) {
      opacity *= Number(getComputedStyle(element).opacity);
    }
    return opacity;
  })).toBe(1);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Aviso PF 00', level: 4 })).toHaveCount(0);
  await expect.poll(async () => (await statesOf(PF.id, A.uid)).get('kb_00')?.dismissed).toBe(true);
  await expectStatesKeepEventExpiry(PF.id, A.uid);

  await loadMore(page).focus();
  await page.keyboard.press('Enter');
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(29);
  await expect(loadMore(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Marcar exibidas como lidas' }).focus();
  await page.keyboard.press('Enter');
  await expect(bell(page)).toHaveAccessibleName('Notificações, nenhuma não lida');
  await expect.poll(async () => [...(await statesOf(PF.id, A.uid)).values()].filter((s) => s.read === true).length)
    .toBe(29);
  await expectStatesKeepEventExpiry(PF.id, A.uid);

  await page.getByRole('button', { name: 'Fechar notificações' }).focus();
  await page.keyboard.press('Enter');
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'false');
});
