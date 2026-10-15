import {
  expect, test,
  type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page, type Request, type Route,
} from '@playwright/test';

import { emulatorIdToken } from './support/callables';
import { adminSdk, clearEmulatorData, seedAccountProfile, seedMembership, seedOwnedWorkspace, seedPaidPlan } from './support/workspaceSeed';

/**
 * D-18-NOTIF — retenção de 180 dias e "Excluir para mim" das notificações,
 * de ponta a ponta no Emulator (contas, workspaces, Rules e eventos reais;
 * os eventos são gravados pelo Admin SDK, como o produtor do backend).
 *
 * A. Exclusão é individual: some para quem excluiu (recarga, logout/login e
 *    outro dispositivo), fica para os demais membros e o evento compartilhado
 *    não é tocado; o estado de quem excluiu copia o `expiresAt` do evento.
 * B. Viewer não vê "Excluir para mim", mas arquiva e marca como lida; o
 *    servidor (Rules, com token real do Auth Emulator) nega `deleted` ao viewer.
 * C. Expiração e cursores: mais de 50 eventos, com expirados, excluídos,
 *    arquivados e fora do contrato espalhados (inclusive no último documento
 *    de cada página); "Carregar mais" percorre tudo sem pular nem repetir;
 *    página inteira sem nada visível; expiração local sem reload e sem nova
 *    leitura do Firestore.
 * D. Troca de workspace com a exclusão em curso (commit retido): grava só no
 *    workspace da ação.
 * E. UX: desktop e celular, claro e escuro, sem rolagem horizontal, ações
 *    sem hover no celular, teclado, foco, isolamento do clique, falha do
 *    servidor em pt-BR e duplo clique.
 */

const PASSWORD = 'e2e-password-123456';
const A = { uid: 'e2e-d18-a', email: 'e2e-d18-a@minhas-financas.local' };
const B = { uid: 'e2e-d18-b', email: 'e2e-d18-b@minhas-financas.local' };
const V = { uid: 'e2e-d18-v', email: 'e2e-d18-v@minhas-financas.local' };
const PF = { id: 'e2e-d18-pf', name: 'Pessoal Retenção' };
const PJ = { id: 'e2e-d18-pj', name: 'Empresa Retenção' };

const RETENTION_MS = 180 * 86_400_000;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

// ---------------------------------------------------------------- Emulator

const timestamp = () => adminSdk().firestore.Timestamp;
type Stamp = InstanceType<ReturnType<typeof timestamp>>;

// Limpeza pelo endpoint do Emulator (sem disputa com o teste anterior).
const resetEmulatorData = clearEmulatorData;

const createAuthUsers = async (users: Array<{ uid: string; email: string }>) => {
  for (const user of users) {
    await adminSdk().auth().createUser({ uid: user.uid, email: user.email, password: PASSWORD, emailVerified: true });
  }
};

const pad = (index: number) => String(index).padStart(2, '0');
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

interface EventSeed {
  id: string;
  title: string;
  createdAt: string;
  /** Padrão: `createdAt` + 180 dias, como o produtor. `null` omite o campo. */
  expiresAt?: Stamp | string | null;
}

/** Eventos na forma do produtor de cartões, com `expiresAt` Timestamp nativo. */
const seedEvents = async (workspaceId: string, items: EventSeed[]) => {
  const db = adminSdk().firestore();
  for (let from = 0; from < items.length; from += 400) {
    const batch = db.batch();
    for (const item of items.slice(from, from + 400)) {
      const expiresAt = item.expiresAt === undefined
        ? timestamp().fromMillis(Date.parse(item.createdAt) + RETENTION_MS)
        : item.expiresAt;
      batch.set(db.doc(`workspaces/${workspaceId}/notifications/${item.id}`), {
        id: item.id, workspaceId, title: item.title, message: `Mensagem de ${item.title}.`,
        type: 'credit_card', link: 'cards', actionLabel: 'Ver cartões', createdAt: item.createdAt,
        ...(expiresAt === null ? {} : { expiresAt }),
        source: 'credit_card_invoice', domain: 'credit_card', domainEventType: 'invoice_closed',
        cardId: 'card-e2e', invoiceId: `inv-${item.id}`,
      });
    }
    await batch.commit();
  }
};

type Mark = 'read' | 'dismissed' | 'deleted';
const STAMP_FIELD: Record<Mark, string> = { read: 'readAt', dismissed: 'dismissedAt', deleted: 'deletedAt' };

/** Estado privado semeado pelo Admin SDK, no caminho novo (`notification_entries`). */
const seedStates = async (
  workspaceId: string,
  uid: string,
  states: Array<{ id: string; mark: Mark; expiresAt: Stamp }>,
) => {
  const db = adminSdk().firestore();
  const batch = db.batch();
  for (const state of states) {
    batch.set(db.doc(`workspaces/${workspaceId}/notification_user_states/${uid}/notification_entries/${state.id}`), {
      [state.mark]: true, [STAMP_FIELD[state.mark]]: timestamp().now(), expiresAt: state.expiresAt,
    });
  }
  await batch.commit();
};

const statesOf = async (workspaceId: string, uid: string) => {
  const snapshot = await adminSdk().firestore()
    .collection(`workspaces/${workspaceId}/notification_user_states/${uid}/notification_entries`).get();
  return new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
};

const stateDoc = (workspaceId: string, uid: string, id: string) =>
  adminSdk().firestore()
    .doc(`workspaces/${workspaceId}/notification_user_states/${uid}/notification_entries/${id}`).get();

const eventDoc = (workspaceId: string, id: string) =>
  adminSdk().firestore().doc(`workspaces/${workspaceId}/notifications/${id}`).get();

const eventExpiry = async (workspaceId: string, id: string): Promise<Stamp> => {
  const value = (await eventDoc(workspaceId, id)).get('expiresAt');
  expect(value, `evento ${id} com expiresAt Timestamp`).toBeInstanceOf(timestamp());
  return value as Stamp;
};

/** Documento serializável (Timestamps como milissegundos+nanos) para comparar igualdade. */
const plain = (value: unknown): unknown => {
  if (value instanceof timestamp()) return { seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  }
  return value;
};

const STATE_KEYS = new Set(['read', 'readAt', 'dismissed', 'dismissedAt', 'deleted', 'deletedAt', 'expiresAt']);

/** Estado gravado pelo cliente: só campos do contrato e `expiresAt` igual ao do evento. */
const expectStateShape = async (workspaceId: string, uid: string, id: string, marks: Mark[]) => {
  const snapshot = await stateDoc(workspaceId, uid, id);
  expect(snapshot.exists, `estado de ${id} existe`).toBe(true);
  const state = snapshot.data() ?? {};
  const expected = [...marks.flatMap((mark) => [mark, STAMP_FIELD[mark]]), 'expiresAt'].sort();
  expect(Object.keys(state).sort(), `campos do estado de ${id}`).toEqual(expected);
  expect(Object.keys(state).filter((key) => !STATE_KEYS.has(key))).toEqual([]);
  for (const mark of marks) {
    expect(state[mark], `${mark} em ${id}`).toBe(true);
    expect(state[STAMP_FIELD[mark]], `${STAMP_FIELD[mark]} é Timestamp`).toBeInstanceOf(timestamp());
    expect(Math.abs(Date.now() - state[STAMP_FIELD[mark]].toMillis()), 'carimbo do servidor recente')
      .toBeLessThan(10 * 60_000);
  }
  expect(state.expiresAt, 'expiresAt do estado é Timestamp').toBeInstanceOf(timestamp());
  expect(state.expiresAt.isEqual(await eventExpiry(workspaceId, id)), `expiresAt do estado ${id} igual ao do evento`)
    .toBe(true);
};

const FIRESTORE_REST = 'http://127.0.0.1:8080/v1/projects/minhas-financas-local/databases/(default)/documents';

/**
 * Gravação do estado privado como o SDK do app a faria (commit com
 * `REQUEST_TIME` no carimbo), mas direto no Emulator e com o ID token real
 * do usuário no Auth Emulator: as Rules avaliam o papel de verdade.
 */
const commitMarks = async (
  request: APIRequestContext,
  token: string,
  target: { workspaceId: string; uid: string; id: string },
  marks: Mark[],
  options: { create: boolean; expiresAt: Stamp },
) => {
  const name = `projects/minhas-financas-local/databases/(default)/documents/workspaces/${target.workspaceId}`
    + `/notification_user_states/${target.uid}/notification_entries/${target.id}`;
  const fields: Record<string, unknown> = Object.fromEntries(marks.map((mark) => [mark, { booleanValue: true }]));
  if (options.create) fields.expiresAt = { timestampValue: options.expiresAt.toDate().toISOString() };
  const response = await request.post(`${FIRESTORE_REST}:commit`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      writes: [{
        update: { name, fields },
        ...(options.create ? {} : { updateMask: { fieldPaths: Object.keys(fields) } }),
        updateTransforms: marks.map((mark) => ({ fieldPath: STAMP_FIELD[mark], setToServerValue: 'REQUEST_TIME' })),
        currentDocument: { exists: !options.create },
      }],
    },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status(), body: body as { error?: { status?: string } } };
};

// ------------------------------------------------------------ Navegador

const login = async (page: Page, email: string) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
};

/** Logout pela tela e novo login na mesma página. */
const switchAccount = async (page: Page, email: string) => {
  const url = new URL(page.url());
  url.searchParams.set('e2eEmail', email);
  await page.evaluate((next) => window.history.replaceState(null, '', next), url.toString());
  await page.getByText('Sair', { exact: true }).first().click();
  await expect(page.getByTestId('e2e-login-button')).toBeVisible();
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
};

type Scheme = 'light' | 'dark';

interface SessionOptions {
  viewport?: { width: number; height: number };
  scheme?: Scheme;
  /** Celular de verdade: toque, sem hover (`(hover: none)`). */
  touch?: boolean;
}

/** Contexto de navegador novo (outro dispositivo) já logado e com o tema pedido. */
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

const bell = (page: Page) => page.getByRole('button', { name: /^Notificações/ });
const panelHeading = (page: Page) => page.getByRole('heading', { name: 'Notificações', level: 3 });
const itemHeading = (page: Page, title: string) => page.getByRole('heading', { name: title, level: 4 });
const itemTitles = (page: Page, prefix: string) =>
  page.locator('h4').filter({ hasText: new RegExp(`^${prefix} \\d\\d$`) });
const loadMore = (page: Page) => page.getByRole('button', { name: 'Carregar mais' });
const deleteButton = (page: Page, title: string) => page.getByRole('button', { name: `Excluir para mim: ${title}` });
const archiveButton = (page: Page, title: string) => page.getByRole('button', { name: `Arquivar para mim: ${title}` });
const anyDeleteButton = (page: Page) => page.getByRole('button', { name: /^Excluir para mim: / });
const confirmDialog = (page: Page) => page.getByRole('dialog', { name: 'Excluir notificação' });
const confirmButton = (page: Page) => confirmDialog(page).getByRole('button', { name: 'Excluir para mim', exact: true });
const cancelButton = (page: Page) => confirmDialog(page).getByRole('button', { name: 'Cancelar', exact: true });

const DELETE_MESSAGE = 'Excluir esta notificação apenas para você? Ela continuará disponível para os demais membros. Esta ação não poderá ser desfeita.';

const openPanel = async (page: Page) => {
  await bell(page).click();
  await expect(panelHeading(page)).toBeVisible();
};

const closePanel = async (page: Page) => {
  await page.getByRole('button', { name: 'Fechar notificações' }).click();
  await expect(panelHeading(page)).toHaveCount(0);
};

/** Abre o diálogo de exclusão do item e confere o texto. */
const askDeletion = async (page: Page, title: string) => {
  await deleteButton(page, title).click();
  await expect(confirmDialog(page)).toBeVisible();
  await expect(confirmDialog(page)).toContainText(DELETE_MESSAGE);
  await expect(confirmDialog(page)).toHaveAccessibleDescription(DELETE_MESSAGE);
};

const horizontalScroll = (page: Page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

const expectNoHorizontalScroll = async (page: Page, where: string) => {
  const { scrollWidth, clientWidth } = await horizontalScroll(page);
  expect(scrollWidth, `rolagem horizontal (${where}): scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`)
    .toBeLessThanOrEqual(clientWidth);
};

/** Opacidade efetiva: produto das opacidades do elemento e dos ancestrais. */
const effectiveOpacity = (target: Locator) => target.evaluate((node) => {
  let opacity = 1;
  for (let element: Element | null = node; element; element = element.parentElement) {
    opacity *= Number(getComputedStyle(element).opacity);
  }
  return opacity;
});

const reload = async (page: Page) => {
  await page.reload();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
};

/**
 * Commits do Firestore de uma página. `attempted` conta os pedidos com escrita
 * (`update`) no estado de uma notificação; `written` conta só os aceitos pelo
 * servidor (200), isto é, as gravações que de fato aconteceram.
 */
const trackCommits = (page: Page) => {
  const sent: Request[] = [];
  const accepted = new Set<Request>();
  const isCommit = (request: Request) => request.method() === 'POST' && /\/documents:commit/.test(request.url());
  page.on('request', (request) => { if (isCommit(request)) sent.push(request); });
  page.on('response', (response) => {
    if (response.status() === 200 && isCommit(response.request())) accepted.add(response.request());
  });
  const updatesState = (request: Request, stateId: string) => {
    const writes = (request.postDataJSON() as { writes?: Array<{ update?: { name?: string } }> } | null)?.writes ?? [];
    return writes.some((write) => write.update?.name?.endsWith(`/notification_entries/${stateId}`));
  };
  return {
    sent,
    attempted: (stateId: string) => sent.filter((request) => updatesState(request, stateId)).length,
    written: (stateId: string) => sent.filter((request) => accepted.has(request) && updatesState(request, stateId)).length,
  };
};

test.beforeEach(async () => {
  await resetEmulatorData();
});

// ============================================================== A

test('A — excluir para mim é individual: some para quem excluiu, fica para os demais e o evento não muda', async ({ browser }) => {
  test.setTimeout(300_000);
  await createAuthUsers([A, B]);
  await seedOwnedWorkspace({ uid: A.uid, email: A.email, workspaceId: PF.id, name: PF.name, type: 'PF' });
  await seedAccountProfile({ uid: B.uid, email: B.email });
  await seedMembership({ workspaceId: PF.id, uid: B.uid, email: B.email, role: 'member', name: PF.name, type: 'PF' });
  const ids = ['d18_a_0', 'd18_a_1', 'd18_a_2'];
  await seedEvents(PF.id, ids.map((id, index) => ({
    id, title: `Aviso D18 ${pad(index)}`, createdAt: minutesAgo(index + 1),
  })));
  const target = { id: 'd18_a_1', title: 'Aviso D18 01' };

  // O evento compartilhado como foi semeado (dados e versão do documento).
  const seeded = await Promise.all(ids.map(async (id) => {
    const snapshot = await eventDoc(PF.id, id);
    return { id, data: plain(snapshot.data()), updateTime: snapshot.updateTime };
  }));

  const sessionA = await openSession(browser, A.email);
  const sessionB = await openSession(browser, B.email);
  const a = sessionA.page;
  const b = sessionB.page;
  await expect(bell(a)).toHaveAccessibleName('Notificações, 3 não lidas');
  await expect(bell(b)).toHaveAccessibleName('Notificações, 3 não lidas');
  await openPanel(b);
  await expect(itemTitles(b, 'Aviso D18')).toHaveCount(3);
  await closePanel(b);

  // --- A exclui para si, pelo diálogo; antes da confirmação nada é gravado.
  await openPanel(a);
  await expect(itemTitles(a, 'Aviso D18')).toHaveCount(3);
  await askDeletion(a, target.title);
  expect((await statesOf(PF.id, A.uid)).size, 'nada gravado antes de confirmar').toBe(0);
  await expect(itemHeading(a, target.title)).toBeAttached();
  await confirmButton(a).click();
  await expect(confirmDialog(a)).toHaveCount(0);
  await expect(itemHeading(a, target.title)).toHaveCount(0);
  await expect(itemTitles(a, 'Aviso D18')).toHaveCount(2);
  await expect(bell(a)).toHaveAccessibleName('Notificações, 2 não lidas');

  // Estado de A: `deleted`, carimbo do servidor e `expiresAt` igual ao do evento.
  await expectStateShape(PF.id, A.uid, target.id, ['deleted']);
  expect((await statesOf(PF.id, A.uid)).size, 'só o item excluído tem estado').toBe(1);
  expect((await statesOf(PF.id, B.uid)).size, 'B não tem estado criado').toBe(0);

  // --- Recarga: continua oculto e fora da contagem.
  await reload(a);
  await expect(bell(a)).toHaveAccessibleName('Notificações, 2 não lidas');
  await openPanel(a);
  await expect(itemTitles(a, 'Aviso D18')).toHaveCount(2);
  await expect(itemHeading(a, target.title)).toHaveCount(0);
  await closePanel(a);

  // --- Logout e login de A: continua oculto.
  await switchAccount(a, A.email);
  await expect(bell(a)).toHaveAccessibleName('Notificações, 2 não lidas');
  await openPanel(a);
  await expect(itemTitles(a, 'Aviso D18')).toHaveCount(2);
  await expect(itemHeading(a, target.title)).toHaveCount(0);
  await closePanel(a);

  // --- Outro dispositivo de A (contexto novo): continua oculto.
  const device = await openSession(browser, A.email);
  await expect(bell(device.page)).toHaveAccessibleName('Notificações, 2 não lidas');
  await openPanel(device.page);
  await expect(itemTitles(device.page, 'Aviso D18')).toHaveCount(2);
  await expect(itemHeading(device.page, target.title)).toHaveCount(0);
  await device.context.close();

  // --- B (outro contexto de navegador) continua vendo o item, na recarga também.
  await reload(b);
  await expect(bell(b)).toHaveAccessibleName('Notificações, 3 não lidas');
  await openPanel(b);
  await expect(itemTitles(b, 'Aviso D18')).toHaveCount(3);
  await expect(itemHeading(b, target.title)).toBeVisible();
  await closePanel(b);

  // --- O evento compartilhado está intacto: mesmos dados, mesma versão, e B sem estado.
  expect((await adminSdk().firestore().collection(`workspaces/${PF.id}/notifications`).get()).size).toBe(3);
  for (const before of seeded) {
    const after = await eventDoc(PF.id, before.id);
    expect(after.exists, `evento ${before.id} existe`).toBe(true);
    expect(plain(after.data()), `evento ${before.id} igual ao semeado`).toEqual(before.data);
    expect(after.updateTime.isEqual(before.updateTime), `evento ${before.id} não foi regravado`).toBe(true);
  }
  expect((await statesOf(PF.id, B.uid)).size, 'B continua sem estado').toBe(0);
  expect([...(await statesOf(PF.id, A.uid)).keys()]).toEqual([target.id]);

  await sessionA.context.close();
  await sessionB.context.close();
});

// ============================================================== B

test('B — viewer não vê "Excluir para mim", arquiva e marca como lida; o servidor nega `deleted`', async ({ browser, request }) => {
  test.setTimeout(240_000);
  await createAuthUsers([A, V]);
  await seedOwnedWorkspace({ uid: A.uid, email: A.email, workspaceId: PF.id, name: PF.name, type: 'PF' });
  await seedAccountProfile({ uid: V.uid, email: V.email });
  await seedMembership({ workspaceId: PF.id, uid: V.uid, email: V.email, role: 'viewer', name: PF.name, type: 'PF' });
  await seedEvents(PF.id, [0, 1, 2].map((index) => ({
    id: `d18_v_${index}`, title: `Aviso D18 ${pad(index)}`, createdAt: minutesAgo(index + 1),
  })));

  // Controle: o owner, no mesmo workspace, vê as duas ações em todos os itens.
  const owner = await openSession(browser, A.email);
  await openPanel(owner.page);
  await expect(itemTitles(owner.page, 'Aviso D18')).toHaveCount(3);
  await expect(anyDeleteButton(owner.page)).toHaveCount(3);
  await expect(owner.page.getByRole('button', { name: /^Arquivar para mim: / })).toHaveCount(3);
  await owner.context.close();

  const viewer = await openSession(browser, V.email);
  const page = viewer.page;
  await expect(bell(page)).toHaveAccessibleName('Notificações, 3 não lidas');
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso D18')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^Arquivar para mim: / })).toHaveCount(3);
  // O papel é conhecido (o painel e a lista já carregaram); espera a interface assentar.
  await page.waitForTimeout(2_500);
  await expect(anyDeleteButton(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Excluir para mim/ })).toHaveCount(0);

  // --- O viewer arquiva e marca como lida normalmente.
  await archiveButton(page, 'Aviso D18 00').click();
  await expect(itemHeading(page, 'Aviso D18 00')).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 2 não lidas');
  await expectStateShape(PF.id, V.uid, 'd18_v_0', ['dismissed']);
  await expect(anyDeleteButton(page)).toHaveCount(0);
  await itemHeading(page, 'Aviso D18 01').click();
  await expect(panelHeading(page)).toHaveCount(0);
  await expect.poll(async () => (await statesOf(PF.id, V.uid)).get('d18_v_1')?.read).toBe(true);
  await expectStateShape(PF.id, V.uid, 'd18_v_1', ['read']);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 1 não lida');
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso D18')).toHaveCount(2);
  await expect(anyDeleteButton(page)).toHaveCount(0);
  await viewer.context.close();

  // --- Prova no servidor, sem depender da interface (Rules com o papel real).
  const viewerToken = await emulatorIdToken(request, V.email, PASSWORD);
  const ownerToken = await emulatorIdToken(request, A.email, PASSWORD);
  const expiresAt = await eventExpiry(PF.id, 'd18_v_2');
  const forViewer = { workspaceId: PF.id, uid: V.uid, id: 'd18_v_2' };

  const deletedOnly = await commitMarks(request, viewerToken, forViewer, ['deleted'], { create: true, expiresAt });
  expect(deletedOnly.status, JSON.stringify(deletedOnly.body)).toBe(403);
  expect(deletedOnly.body.error?.status).toBe('PERMISSION_DENIED');
  const readAndDeleted = await commitMarks(request, viewerToken, forViewer, ['read', 'deleted'], { create: true, expiresAt });
  expect(readAndDeleted.status, JSON.stringify(readAndDeleted.body)).toBe(403);
  expect(readAndDeleted.body.error?.status).toBe('PERMISSION_DENIED');
  expect((await stateDoc(PF.id, V.uid, 'd18_v_2')).exists, 'nada foi criado pelas tentativas negadas').toBe(false);

  // Controle: o mesmo corpo sem `deleted` (arquivar) o viewer consegue gravar.
  const dismissed = await commitMarks(request, viewerToken, forViewer, ['dismissed'], { create: true, expiresAt });
  expect(dismissed.status, JSON.stringify(dismissed.body)).toBe(200);
  await expectStateShape(PF.id, V.uid, 'd18_v_2', ['dismissed']);
  // Adicionar `deleted` a um estado que já existe também é negado.
  const addDeleted = await commitMarks(request, viewerToken, forViewer, ['deleted'], { create: false, expiresAt });
  expect(addDeleted.status, JSON.stringify(addDeleted.body)).toBe(403);
  expect(addDeleted.body.error?.status).toBe('PERMISSION_DENIED');
  await expectStateShape(PF.id, V.uid, 'd18_v_2', ['dismissed']);

  // Controle: a mesma gravação de `deleted`, feita pelo owner no próprio estado, é aceita.
  const ownerDeleted = await commitMarks(
    request, ownerToken, { workspaceId: PF.id, uid: A.uid, id: 'd18_v_2' }, ['deleted'], { create: true, expiresAt },
  );
  expect(ownerDeleted.status, JSON.stringify(ownerDeleted.body)).toBe(200);
  await expectStateShape(PF.id, A.uid, 'd18_v_2', ['deleted']);
  // O evento continua intacto: nenhum papel o altera.
  expect((await eventDoc(PF.id, 'd18_v_2')).exists).toBe(true);
});

// ============================================================== C

test('C — expiração e cursores: Carregar mais percorre tudo sem pular nem repetir, e só mostra o que vale', async ({ browser }) => {
  test.setTimeout(300_000);
  await createAuthUsers([A]);
  await seedOwnedWorkspace({ uid: A.uid, email: A.email, workspaceId: PF.id, name: PF.name, type: 'PF' });

  // 60 eventos, do mais novo para o mais antigo; os de índice 50 e 51 no mesmo
  // instante (o desempate pelo ID decide a ordem).
  const base = Date.now();
  const raw = Array.from({ length: 60 }, (_, index) => ({
    id: `d18_c_${pad(index)}`,
    title: `Aviso D18 ${pad(index)}`,
    createdAt: new Date(base - (index === 51 ? 50 : index) * 60_000 - 60_000).toISOString(),
  }));
  const byFeedOrder = (left: typeof raw[number], right: typeof raw[number]) =>
    left.createdAt === right.createdAt
      ? (left.id < right.id ? 1 : -1)
      : (left.createdAt < right.createdAt ? 1 : -1);
  const sorted = [...raw].sort(byFeedOrder);

  // Posições (na ordem do painel) dos eventos que não podem aparecer. O 24 é o
  // último documento da primeira página; o 25, a sonda dela; o 49, o último da segunda.
  const deletedAt = [7, 18, 24, 33, 45, 58];
  const expiredAt = [3, 10, 25, 30, 41, 49, 55];
  const archivedAt = [20];
  const invalidAt = [14];
  const hidden = new Set([...deletedAt, ...expiredAt, ...archivedAt, ...invalidAt]);
  const past = timestamp().fromMillis(base - 86_400_000);
  const futureOf = (createdAt: string) => timestamp().fromMillis(Date.parse(createdAt) + RETENTION_MS);

  await seedEvents(PF.id, sorted.map((event, position) => ({
    ...event,
    expiresAt: expiredAt.includes(position)
      ? past
      : invalidAt.includes(position) ? 'sem-timestamp' : futureOf(event.createdAt),
  })));
  await seedStates(PF.id, A.uid, [
    ...deletedAt.map((position) => ({ id: sorted[position].id, mark: 'deleted' as const, expiresAt: futureOf(sorted[position].createdAt) })),
    ...archivedAt.map((position) => ({ id: sorted[position].id, mark: 'dismissed' as const, expiresAt: futureOf(sorted[position].createdAt) })),
  ]);
  expect(sorted[24].createdAt, 'o corte da primeira página não empata').not.toBe(sorted[25].createdAt);
  expect(sorted[50].createdAt, 'empate de horário na terceira página').toBe(sorted[51].createdAt);
  expect(sorted[50].id > sorted[51].id, 'empate desfeito pelo ID, do maior para o menor').toBe(true);

  const titlesOf = (positions: number[]) => positions.filter((position) => !hidden.has(position)).map((position) => sorted[position].title);
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => from + index);
  const page1 = titlesOf(range(0, 25));
  const page2 = titlesOf(range(25, 50));
  const page3 = titlesOf(range(50, 60));
  expect([page1.length, page2.length, page3.length]).toEqual([18, 19, 8]);

  const { context, page } = await openSession(browser, A.email);
  const shown = () => itemTitles(page, 'Aviso D18').allTextContents();

  // --- Primeira página: 18 visíveis de 25 lidos; há mais páginas. O sino e o chip mostram o total exato do servidor (45), não o das páginas carregadas.
  await expect(bell(page)).toHaveAccessibleName('Notificações, 45 não lidas');
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso D18')).toHaveCount(page1.length);
  expect(await shown()).toEqual(page1);
  await expect(loadMore(page)).toBeVisible();
  await expect(page.getByText('45 não lidas')).toBeAttached();

  // --- Segunda página: o cursor vem do último documento lido (o 24, excluído).
  await loadMore(page).click();
  await expect(itemTitles(page, 'Aviso D18')).toHaveCount(page1.length + page2.length);
  expect(await shown()).toEqual([...page1, ...page2]);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 45 não lidas');
  await expect(loadMore(page)).toBeVisible();

  // --- Terceira página: fim do histórico.
  await loadMore(page).click();
  await expect(itemTitles(page, 'Aviso D18')).toHaveCount(page1.length + page2.length + page3.length);
  const all = await shown();
  expect(all).toEqual([...page1, ...page2, ...page3]);
  expect(new Set(all).size, 'nenhum item repetido entre páginas').toBe(all.length);
  expect(all).toHaveLength(45);
  await expect(loadMore(page)).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 45 não lidas');

  // Nenhum expirado, excluído, arquivado ou fora do contrato apareceu.
  for (const position of hidden) {
    expect(all, `posição ${position} (${sorted[position].title}) não deve aparecer`).not.toContain(sorted[position].title);
  }
  // Nada foi gravado só por ler ou filtrar.
  expect((await statesOf(PF.id, A.uid)).size, 'só os estados semeados').toBe(deletedAt.length + archivedAt.length);
  await context.close();
});

test('C — página inteira sem nada visível: o painel avisa e "Carregar mais" procura as anteriores', async ({ browser }) => {
  test.setTimeout(240_000);
  await createAuthUsers([A]);
  await seedOwnedWorkspace({ uid: A.uid, email: A.email, workspaceId: PF.id, name: PF.name, type: 'PF' });

  // As 26 mais recentes (página de 25 + sonda) expiradas ou excluídas por A;
  // depois, 4 válidas.
  const base = Date.now();
  const events = Array.from({ length: 30 }, (_, index) => ({
    id: `d18_n_${pad(index)}`, title: `Aviso D18 ${pad(index)}`, createdAt: new Date(base - (index + 1) * 60_000).toISOString(),
  }));
  const past = timestamp().fromMillis(base - 86_400_000);
  const futureOf = (createdAt: string) => timestamp().fromMillis(Date.parse(createdAt) + RETENTION_MS);
  await seedEvents(PF.id, events.map((event, index) => ({ ...event, expiresAt: index < 13 ? past : futureOf(event.createdAt) })));
  await seedStates(PF.id, A.uid, events.slice(13, 26).map((event) => ({
    id: event.id, mark: 'deleted' as const, expiresAt: futureOf(event.createdAt),
  })));

  const { context, page } = await openSession(browser, A.email);
  // P5-D2: o sino mostra o total exato do servidor. As 4 válidas anteriores
  // contam antes de "Carregar mais", embora nenhuma esteja na primeira página
  // ("Notificações" sem número agora é só o estado de carregamento).
  await expect(bell(page)).toHaveAccessibleName('Notificações, 4 não lidas');
  await openPanel(page);
  await expect(page.getByText('Nada para exibir entre as mais recentes')).toBeVisible();
  await expect(page.getByText('As mais recentes foram arquivadas ou excluídas por você, ou expiraram. Use “Carregar mais” para procurar as anteriores.'))
    .toBeVisible();
  await expect(page.getByText('Tudo limpo por aqui!')).toHaveCount(0);
  await expect(itemTitles(page, 'Aviso D18')).toHaveCount(0);
  await expect(loadMore(page)).toBeVisible();

  await loadMore(page).click();
  await expect(itemTitles(page, 'Aviso D18')).toHaveCount(4);
  expect(await itemTitles(page, 'Aviso D18').allTextContents()).toEqual(events.slice(26).map((event) => event.title));
  await expect(page.getByText('Nada para exibir entre as mais recentes')).toHaveCount(0);
  await expect(loadMore(page)).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 4 não lidas');
  await context.close();
});

test('C — o item expira sozinho com o painel aberto: sem reload e sem nova leitura do Firestore', async ({ browser }) => {
  test.setTimeout(240_000);
  await createAuthUsers([A]);
  await seedOwnedWorkspace({ uid: A.uid, email: A.email, workspaceId: PF.id, name: PF.name, type: 'PF' });
  await seedEvents(PF.id, [0, 1].map((index) => ({
    id: `d18_t_${index}`, title: `Aviso D18 ${pad(index + 1)}`, createdAt: minutesAgo(index + 2),
  })));

  const { context, page } = await openSession(browser, A.email);

  // Leituras ao Emulator do Firestore (consultas e leituras em lote); o corpo do
  // pedido de abertura de escuta (`addTarget`) é uma consulta nova.
  const reads: string[] = [];
  const everything: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:8080/')) return;
    const body = request.postData() ?? '';
    const kind = /:batchGet|:runQuery|:runAggregationQuery/.test(request.url())
      ? 'rpc-leitura'
      : request.method() === 'POST' && body.includes('addTarget') ? 'listen-addTarget' : null;
    everything.push(`${request.method()} ${new URL(request.url()).pathname}${kind ? ` [${kind}]` : ''}`);
    if (kind) reads.push(kind);
  });

  // O evento que expira entra depois do login e é lido na recarga.
  const expiresInMs = 24_000;
  const expiringId = 'd18_t_exp';
  const expiringAt = Date.now() + expiresInMs;
  await seedEvents(PF.id, [{
    id: expiringId, title: 'Aviso D18 00', createdAt: new Date().toISOString(),
    expiresAt: timestamp().fromMillis(expiringAt),
  }]);
  await reload(page);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 3 não lidas');
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso D18')).toHaveCount(3);
  await expect(itemHeading(page, 'Aviso D18 00')).toBeVisible();
  expect(reads.length, 'a leitura da página foi contada (controle do detector)').toBeGreaterThan(0);

  // Marcas para provar que não houve reload nem nova leitura.
  await page.evaluate(() => { (window as unknown as { __d18Alive?: string }).__d18Alive = 'sim'; });
  const readsBefore = reads.length;
  const trafficBefore = everything.length;
  const remaining = expiringAt - Date.now();
  expect(remaining, 'sobra tempo de expiração para a prova (se falhar, a máquina está lenta)').toBeGreaterThan(3_000);

  // Sem reload, sem interação: o item some quando `expiresAt <= agora`.
  await expect(itemHeading(page, 'Aviso D18 00')).toHaveCount(0, { timeout: remaining + 10_000 });
  expect(Date.now() + 1_000, 'sumiu só depois do prazo').toBeGreaterThanOrEqual(expiringAt);
  await expect(itemTitles(page, 'Aviso D18')).toHaveCount(2);
  // P5-D2: a expiração local também relê o total exato pela callable (sem
  // leitura do Firestore pelo navegador): o sino acompanha a lista.
  await expect(bell(page)).toHaveAccessibleName('Notificações, 2 não lidas');
  await expect(panelHeading(page)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __d18Alive?: string }).__d18Alive), 'a página não recarregou').toBe('sim');
  expect(reads.length - readsBefore, `leituras do Firestore durante a expiração (tráfego na janela: ${JSON.stringify(everything.slice(trafficBefore))})`).toBe(0);

  // Expirar é local: nada foi gravado e o evento continua no servidor.
  expect((await statesOf(PF.id, A.uid)).size).toBe(0);
  expect((await eventDoc(PF.id, expiringId)).exists).toBe(true);
  await context.close();
});

test('C — excluir um evento que expirou ou não existe mais: o diálogo avisa em pt-BR, nada é gravado', async ({ browser }) => {
  test.setTimeout(240_000);
  await createAuthUsers([A]);
  await seedOwnedWorkspace({ uid: A.uid, email: A.email, workspaceId: PF.id, name: PF.name, type: 'PF' });
  await seedEvents(PF.id, [1, 2].map((index) => ({
    id: `d18_x_${index}`, title: `Aviso D18 ${pad(index)}`, createdAt: minutesAgo(index + 1),
  })));
  const { context, page } = await openSession(browser, A.email);
  const commits = trackCommits(page);

  // O evento que vai expirar entra depois do login e é lido na recarga.
  const expiringAt = Date.now() + 22_000;
  await seedEvents(PF.id, [{
    id: 'd18_x_0', title: 'Aviso D18 00', createdAt: new Date().toISOString(),
    expiresAt: timestamp().fromMillis(expiringAt),
  }]);
  await reload(page);
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso D18')).toHaveCount(3);

  const EXPIRED = 'Esta notificação expirou e não pode mais ser excluída.';

  // --- Evento apagado no servidor depois de o painel carregar: nada é gravado.
  await askDeletion(page, 'Aviso D18 02');
  await adminSdk().firestore().doc(`workspaces/${PF.id}/notifications/d18_x_2`).delete();
  await confirmButton(page).click();
  await expect(confirmDialog(page).getByRole('alert')).toHaveText(EXPIRED);
  await expect(confirmDialog(page)).toBeVisible();
  await expect(confirmButton(page)).toBeEnabled();
  expect((await statesOf(PF.id, A.uid)).size, 'evento ausente: nada gravado').toBe(0);
  await cancelButton(page).click();
  await expect(confirmDialog(page)).toHaveCount(0);

  // --- Evento que expira com o diálogo aberto: some da lista e a confirmação avisa.
  expect(expiringAt - Date.now(), 'sobra tempo para abrir o diálogo antes de expirar (máquina lenta?)').toBeGreaterThan(2_000);
  await askDeletion(page, 'Aviso D18 00');
  await expect(itemHeading(page, 'Aviso D18 00')).toHaveCount(0, { timeout: expiringAt - Date.now() + 10_000 });
  await expect(confirmDialog(page)).toBeVisible();
  await confirmButton(page).click();
  await expect(confirmDialog(page).getByRole('alert')).toHaveText(EXPIRED);
  await expect(confirmDialog(page)).toBeVisible();
  expect((await statesOf(PF.id, A.uid)).size, 'evento expirado: nada gravado').toBe(0);
  expect(commits.written('d18_x_0'), 'nenhuma escrita aceita para o evento expirado').toBe(0);
  // Cancelar fecha o diálogo e descarta o aviso; o aviso não volta num pedido novo.
  await cancelButton(page).click();
  await expect(confirmDialog(page)).toHaveCount(0);
  await askDeletion(page, 'Aviso D18 01');
  await expect(confirmDialog(page).getByRole('alert')).toHaveCount(0);
  await cancelButton(page).click();
  await expect(confirmDialog(page)).toHaveCount(0);
  await context.close();
});

// ============================================================== D

test('D — troca de workspace no meio da exclusão: a gravação fica no workspace da ação', async ({ page }) => {
  test.setTimeout(300_000);
  await createAuthUsers([A]);
  await seedOwnedWorkspace({
    uid: A.uid, email: A.email, workspaceId: PF.id, name: PF.name, type: 'PF',
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  await seedPaidPlan(A.uid, 'pro');
  await seedOwnedWorkspace({
    uid: A.uid, email: A.email, workspaceId: PJ.id, name: PJ.name, type: 'PJ',
    joinedAt: new Date('2026-01-02T00:00:00.000Z'),
  });
  await seedEvents(PF.id, [0, 1, 2].map((index) => ({
    id: `d18_pf_${index}`, title: `Aviso PF ${pad(index)}`, createdAt: minutesAgo(index + 1),
  })));
  await seedEvents(PJ.id, [0, 1].map((index) => ({
    id: `d18_pj_${index}`, title: `Aviso PJ ${pad(index)}`, createdAt: minutesAgo(index + 1),
  })));
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

  // Confirma a exclusão com o commit retido: a interface espera o servidor.
  await askDeletion(page, 'Aviso PF 01');
  holding = true;
  await confirmButton(page).click();
  await held;
  await expect(confirmButton(page)).toBeDisabled();
  await expect(confirmButton(page)).toHaveAttribute('aria-busy', 'true');
  await expect(itemHeading(page, 'Aviso PF 01')).toBeAttached();
  expect((await statesOf(PF.id, A.uid)).size, 'o servidor ainda não gravou').toBe(0);

  // Com a gravação em curso o diálogo não fecha (Escape é ignorado) e o fundo
  // dele bloqueia o ponteiro: a troca para a empresa é disparada por cliques
  // programáticos no menu da conta, como uma troca vinda de fora da tela.
  await page.keyboard.press('Escape');
  await expect(confirmDialog(page)).toBeVisible();
  await page.getByRole('button', { name: 'Abrir menu da conta' }).evaluate((node) => (node as HTMLElement).click());
  await page.getByRole('button', { name: PJ.name }).first().evaluate((node) => (node as HTMLElement).click());
  holding = false;
  release();
  await expect(page.getByRole('heading', { name: 'Finanças da Empresa', level: 1 })).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName('Notificações, 2 não lidas');
  await expect(confirmDialog(page)).toHaveCount(0);

  // A gravação concluiu no workspace da ação, nunca no outro.
  await expect.poll(async () => (await statesOf(PF.id, A.uid)).get('d18_pf_1')?.deleted).toBe(true);
  await expectStateShape(PF.id, A.uid, 'd18_pf_1', ['deleted']);
  expect((await statesOf(PF.id, A.uid)).size).toBe(1);
  expect((await statesOf(PJ.id, A.uid)).size, 'nada gravado na empresa').toBe(0);

  // O workspace novo não mostra erro nem perde item.
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso PJ')).toHaveCount(2);
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 2 não lidas');
  await closePanel(page);
  await expect(page.getByRole('alert')).toHaveCount(0);

  // De volta ao workspace original: o item excluído continua oculto.
  await page.getByRole('button', { name: 'Abrir menu da conta' }).click();
  await page.getByRole('button', { name: 'Pessoal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Minhas Finanças', level: 1 })).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName('Notificações, 2 não lidas');
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso PF')).toHaveCount(2);
  await expect(itemHeading(page, 'Aviso PF 01')).toHaveCount(0);
  await expect(itemHeading(page, 'Aviso PF 00')).toBeVisible();
  await expect(itemHeading(page, 'Aviso PF 02')).toBeVisible();
  expect((await statesOf(PJ.id, A.uid)).size, 'a empresa segue sem estado').toBe(0);
});

test('D — com a gravação em curso o diálogo não fecha; depois da resposta ele fecha e o foco volta ao sino', async ({ page }) => {
  test.setTimeout(240_000);
  await createAuthUsers([A]);
  await seedOwnedWorkspace({ uid: A.uid, email: A.email, workspaceId: PF.id, name: PF.name, type: 'PF' });
  await seedEvents(PF.id, [0, 1, 2].map((index) => ({
    id: `d18_f_${index}`, title: `Aviso D18 ${pad(index)}`, createdAt: minutesAgo(index + 1),
  })));

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
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso D18')).toHaveCount(3);

  await askDeletion(page, 'Aviso D18 00');
  holding = true;
  await confirmButton(page).click();
  await held;

  // Escape, clique no fundo, "Fechar" e "Cancelar" são ignorados até a resposta.
  await page.keyboard.press('Escape');
  await expect(confirmDialog(page)).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(confirmDialog(page)).toBeVisible();
  await confirmDialog(page).getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(confirmDialog(page)).toBeVisible();
  await cancelButton(page).click();
  await expect(confirmDialog(page)).toBeVisible();
  await expect(confirmButton(page)).toBeDisabled();
  await expect(confirmButton(page)).toHaveAttribute('aria-busy', 'true');
  await expect(itemHeading(page, 'Aviso D18 00')).toBeAttached();
  expect((await statesOf(PF.id, A.uid)).size, 'o servidor ainda não gravou').toBe(0);
  // Enquanto uma exclusão está em curso, não se abre outro pedido.
  await expect(deleteButton(page, 'Aviso D18 01')).toBeDisabled();

  // Depois da resposta o diálogo fecha, o item some e o foco volta ao sino.
  holding = false;
  release();
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(itemHeading(page, 'Aviso D18 00')).toHaveCount(0);
  await expectStateShape(PF.id, A.uid, 'd18_f_0', ['deleted']);
  await expect(bell(page)).toBeFocused();
  await expect(bell(page)).toHaveAccessibleName('Notificações, 2 não lidas');

  // Um pedido novo, cancelado: o foco volta ao botão que o abriu (não ao sino).
  await deleteButton(page, 'Aviso D18 01').focus();
  await page.keyboard.press('Enter');
  await expect(confirmDialog(page)).toBeVisible();
  await expect(cancelButton(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(deleteButton(page, 'Aviso D18 01')).toBeFocused();
  expect((await statesOf(PF.id, A.uid)).size, 'cancelar não grava').toBe(1);
});

// ============================================================== E

const UX_TITLES = ['Aviso UX 00', 'Aviso UX 01', 'Aviso UX 02', 'Aviso UX 03', 'Aviso UX 04'];

const seedUxWorkspace = async () => {
  await createAuthUsers([A]);
  await seedOwnedWorkspace({ uid: A.uid, email: A.email, workspaceId: PF.id, name: PF.name, type: 'PF' });
  await seedEvents(PF.id, UX_TITLES.map((title, index) => ({
    id: `d18_ux_${index}`, title, createdAt: minutesAgo(index + 1),
  })));
};

/** Geometria das ações de um item: contêiner do item e botões. */
const actionsGeometry = (page: Page, title: string) => deleteButton(page, title).evaluate((node) => {
  const item = node.closest('.group');
  const rect = (element: Element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  };
  const archive = item?.querySelector('button[aria-label^="Arquivar para mim"]');
  return { item: item ? rect(item) : null, remove: rect(node), archive: archive ? rect(archive) : null };
});

test('E — desktop e celular, claro e escuro: sem rolagem horizontal, ações certas por dispositivo e diálogo dentro da tela', async ({ browser }) => {
  test.setTimeout(480_000);
  await seedUxWorkspace();
  const combos: Array<{ name: string; viewport: { width: number; height: number }; scheme: Scheme; touch: boolean }> = [
    { name: 'desktop claro', viewport: DESKTOP, scheme: 'light', touch: false },
    { name: 'desktop escuro', viewport: DESKTOP, scheme: 'dark', touch: false },
    { name: 'celular claro', viewport: PHONE, scheme: 'light', touch: true },
    { name: 'celular escuro', viewport: PHONE, scheme: 'dark', touch: true },
  ];
  for (const combo of combos) {
    const { context, page } = await openSession(browser, A.email, combo);
    const title = UX_TITLES[0];
    await expectNoHorizontalScroll(page, `${combo.name}, sem painel`);
    await openPanel(page);
    await expect(itemTitles(page, 'Aviso UX')).toHaveCount(UX_TITLES.length);
    await expect(anyDeleteButton(page)).toHaveCount(UX_TITLES.length);
    await expect(page.getByRole('button', { name: /^Arquivar para mim: / })).toHaveCount(UX_TITLES.length);
    await expectNoHorizontalScroll(page, `${combo.name}, painel aberto`);

    const hoverNone = await page.evaluate(() => matchMedia('(hover: none)').matches);
    expect(hoverNone, `${combo.name}: (hover: none)`).toBe(combo.touch);
    await page.mouse.move(2, 2);
    const geometry = await actionsGeometry(page, title);
    expect(geometry.item && geometry.archive).toBeTruthy();
    const item = geometry.item!;
    const archive = geometry.archive!;
    const remove = geometry.remove;
    const right = (box: { x: number; width: number }) => box.x + box.width;
    const bottom = (box: { y: number; height: number }) => box.y + box.height;
    // As duas ações dentro do item, lado a lado, sem se sobrepor.
    for (const box of [remove, archive]) {
      expect(box.x, `${combo.name}: ação dentro do item (esquerda)`).toBeGreaterThanOrEqual(item.x);
      expect(right(box), `${combo.name}: ação dentro do item (direita)`).toBeLessThanOrEqual(right(item) + 0.5);
      expect(box.y, `${combo.name}: ação dentro do item (topo)`).toBeGreaterThanOrEqual(item.y - 0.5);
      expect(bottom(box), `${combo.name}: ação dentro do item (base)`).toBeLessThanOrEqual(bottom(item) + 0.5);
    }
    expect(right(remove), `${combo.name}: excluir e arquivar não se sobrepõem`).toBeLessThanOrEqual(archive.x + 0.5);

    if (combo.touch) {
      // Celular: sem hover, as ações aparecem sempre, no canto inferior direito.
      await expect.poll(() => effectiveOpacity(deleteButton(page, title)), { message: `${combo.name}: excluir visível sem hover` }).toBe(1);
      await expect.poll(() => effectiveOpacity(archiveButton(page, title)), { message: `${combo.name}: arquivar visível sem hover` }).toBe(1);
      await expect(deleteButton(page, title)).toBeVisible();
      expect(bottom(item) - bottom(archive), `${combo.name}: canto inferior`).toBeLessThanOrEqual(16);
      expect(right(item) - right(archive), `${combo.name}: canto direito`).toBeLessThanOrEqual(16);
      for (const box of [remove, archive]) {
        expect(Math.min(box.width, box.height), `${combo.name}: alvo de toque >= 24px`).toBeGreaterThanOrEqual(24);
      }
    } else {
      // Desktop: aparecem no hover e no foco, no canto superior direito.
      expect(await effectiveOpacity(deleteButton(page, title)), `${combo.name}: excluir oculto sem hover`).toBe(0);
      expect(archive.y - item.y, `${combo.name}: canto superior`).toBeLessThanOrEqual(16);
      expect(right(item) - right(archive), `${combo.name}: canto direito`).toBeLessThanOrEqual(16);
      await itemHeading(page, title).hover();
      await expect.poll(() => effectiveOpacity(deleteButton(page, title))).toBe(1);
      await expect.poll(() => effectiveOpacity(archiveButton(page, title))).toBe(1);
    }

    // O diálogo cabe na tela, sem rolagem horizontal, e Escape o fecha.
    if (combo.touch) await deleteButton(page, title).tap();
    else await deleteButton(page, title).click();
    await expect(confirmDialog(page)).toBeVisible();
    await expect(confirmDialog(page)).toContainText(DELETE_MESSAGE);
    await expect(cancelButton(page)).toBeFocused();
    await expectNoHorizontalScroll(page, `${combo.name}, diálogo aberto`);
    const box = await confirmDialog(page).locator(':scope > div').first().boundingBox();
    expect(box, `${combo.name}: caixa do diálogo`).not.toBeNull();
    expect(box!.x, `${combo.name}: diálogo dentro da tela (esquerda)`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${combo.name}: diálogo dentro da tela (direita)`).toBeLessThanOrEqual(combo.viewport.width);
    expect(box!.y, `${combo.name}: diálogo dentro da tela (topo)`).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, `${combo.name}: diálogo dentro da tela (base)`).toBeLessThanOrEqual(combo.viewport.height);
    await page.keyboard.press('Escape');
    await expect(confirmDialog(page)).toHaveCount(0);
    await expectNoHorizontalScroll(page, `${combo.name}, diálogo fechado`);
    // Cancelar não grava nada.
    expect((await statesOf(PF.id, A.uid)).size, `${combo.name}: nada gravado`).toBe(0);
    await context.close();
  }
});

test('E — teclado e isolamento do clique (desktop): Tab, Enter, foco preso, Escape e foco de volta', async ({ browser }) => {
  test.setTimeout(300_000);
  await seedUxWorkspace();
  const { context, page } = await openSession(browser, A.email, { viewport: DESKTOP, scheme: 'light' });
  const commits = trackCommits(page);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 5 não lidas');

  // --- Abre o painel pelo teclado e chega ao "Excluir para mim" só com Tab.
  await bell(page).focus();
  await page.keyboard.press('Enter');
  await expect(bell(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(itemTitles(page, 'Aviso UX')).toHaveCount(5);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Marcar exibidas como lidas' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Fechar notificações' })).toBeFocused();
  await page.keyboard.press('Tab');
  const firstDelete = deleteButton(page, 'Aviso UX 00');
  await expect(firstDelete).toBeFocused();
  await expect.poll(() => effectiveOpacity(firstDelete)).toBe(1);
  await page.keyboard.press('Tab');
  await expect(archiveButton(page, 'Aviso UX 00')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(firstDelete).toBeFocused();

  // --- Enter abre o diálogo: foco em "Cancelar" e Tab preso dentro.
  await page.keyboard.press('Enter');
  await expect(confirmDialog(page)).toBeVisible();
  await expect(cancelButton(page)).toBeFocused();
  const focusInfo = () => page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const active = document.activeElement;
    return {
      inside: Boolean(dialog && active && dialog.contains(active)),
      name: active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? '',
    };
  });
  const visited = new Set<string>();
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('Tab');
    const info = await focusInfo();
    expect(info.inside, `Tab ${step + 1}: foco dentro do diálogo (${info.name})`).toBe(true);
    visited.add(info.name);
  }
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press('Shift+Tab');
    const info = await focusInfo();
    expect(info.inside, `Shift+Tab ${step + 1}: foco dentro do diálogo (${info.name})`).toBe(true);
    visited.add(info.name);
  }
  expect([...visited].sort(), 'o foco circula pelos três controles do diálogo').toEqual(['Cancelar', 'Excluir para mim', 'Fechar']);

  // --- Escape fecha e o foco volta ao botão de origem; nada foi excluído.
  await page.keyboard.press('Escape');
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(firstDelete).toBeFocused();
  await expect(panelHeading(page)).toBeVisible();
  await expect(itemHeading(page, 'Aviso UX 00')).toBeVisible();
  expect((await statesOf(PF.id, A.uid)).size).toBe(0);

  // --- Clicar em "Excluir para mim" não navega nem marca como lida (stopPropagation).
  const urlBefore = page.url();
  await itemHeading(page, 'Aviso UX 01').hover();
  await deleteButton(page, 'Aviso UX 01').click();
  await expect(confirmDialog(page)).toBeVisible();
  await expect(panelHeading(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Minhas Finanças', level: 1 })).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName('Notificações, 5 não lidas');
  await cancelButton(page).click();
  await expect(confirmDialog(page)).toHaveCount(0);
  // Cancelar pelo mouse também devolve o foco ao botão de origem.
  await expect(deleteButton(page, 'Aviso UX 01')).toBeFocused();
  await page.waitForTimeout(1_500);
  expect(page.url()).toBe(urlBefore);
  await expect(panelHeading(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Minhas Finanças', level: 1 })).toBeVisible();
  expect(commits.sent.length, 'nenhuma gravação só por abrir/cancelar a exclusão').toBe(0);
  expect((await statesOf(PF.id, A.uid)).size, 'nem lida nem excluída').toBe(0);

  // --- Exclui só pelo teclado: Tab até o botão, Enter, Tab até confirmar, Enter.
  await deleteButton(page, 'Aviso UX 02').focus();
  await page.keyboard.press('Enter');
  await expect(cancelButton(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirmButton(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(itemHeading(page, 'Aviso UX 02')).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 4 não lidas');
  // O botão de origem some com o item: o foco volta ao sino.
  await expect(bell(page)).toBeFocused();
  await expectStateShape(PF.id, A.uid, 'd18_ux_2', ['deleted']);
  expect((await statesOf(PF.id, A.uid)).size).toBe(1);
  await context.close();
});

test('E — falha do servidor em pt-BR sem falso sucesso, e duplo clique em confirmar sem gravação dupla (desktop escuro)', async ({ browser }) => {
  test.setTimeout(420_000);
  await seedUxWorkspace();
  const { context, page } = await openSession(browser, A.email, { viewport: DESKTOP, scheme: 'dark' });
  const tracked = trackCommits(page);

  type Mode = 'pass' | 'abort' | 'denied' | 'slow';
  let mode: Mode = 'pass';
  await page.route('**/documents:commit*', async (route: Route) => {
    if (mode === 'abort') {
      await route.abort('failed');
    } else if (mode === 'denied') {
      await route.fulfill({
        status: 403, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } }),
      });
    } else if (mode === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    } else {
      await route.continue();
    }
  });

  await expect(bell(page)).toHaveAccessibleName('Notificações, 5 não lidas');
  await openPanel(page);
  await expect(itemTitles(page, 'Aviso UX')).toHaveCount(5);

  // --- Falha de rede (commit abortado): erro em pt-BR no diálogo, item continua.
  mode = 'abort';
  await askDeletion(page, 'Aviso UX 00');
  await confirmButton(page).click();
  const alert = confirmDialog(page).getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 40_000 });
  const networkMessage = (await alert.innerText()).trim();
  expect(networkMessage, 'mensagem em pt-BR para a falha de rede').toMatch(
    /^(Sem conexão com o servidor\. Verifique sua internet e tente novamente\.|Não foi possível excluir a notificação\. Tente novamente\.)$/,
  );
  await expect(confirmDialog(page)).toBeVisible();
  await expect(confirmButton(page)).toBeEnabled();
  await expect(itemHeading(page, 'Aviso UX 00')).toBeAttached();
  await expect(bell(page)).toHaveAccessibleName('Notificações, 5 não lidas');
  expect((await statesOf(PF.id, A.uid)).size, 'nada gravado na falha').toBe(0);

  // Cancelar descarta o erro; um novo pedido não herda a mensagem anterior.
  await cancelButton(page).click();
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(itemHeading(page, 'Aviso UX 00')).toBeVisible();
  await askDeletion(page, 'Aviso UX 00');
  await expect(confirmDialog(page).getByRole('alert')).toHaveCount(0);
  await cancelButton(page).click();
  await expect(confirmDialog(page)).toHaveCount(0);

  // --- Permissão negada pelo servidor: outra mensagem em pt-BR, item continua.
  mode = 'denied';
  await askDeletion(page, 'Aviso UX 01');
  await confirmButton(page).click();
  await expect(confirmDialog(page).getByRole('alert'))
    .toHaveText('Você não tem permissão para excluir esta notificação.');
  await expect(itemHeading(page, 'Aviso UX 01')).toBeAttached();
  await expect(bell(page)).toHaveAccessibleName('Notificações, 5 não lidas');
  expect((await statesOf(PF.id, A.uid)).size).toBe(0);

  // --- A falha passa: o mesmo diálogo conclui a exclusão.
  mode = 'pass';
  await confirmButton(page).click();
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(itemHeading(page, 'Aviso UX 01')).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 4 não lidas');
  await expectStateShape(PF.id, A.uid, 'd18_ux_1', ['deleted']);

  // --- Duplo clique em confirmar (servidor lento, o diálogo fica aberto entre os cliques).
  mode = 'slow';
  await askDeletion(page, 'Aviso UX 02');
  await confirmButton(page).dblclick();
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(itemHeading(page, 'Aviso UX 02')).toHaveCount(0);
  await page.waitForTimeout(1_500);
  await expectStateShape(PF.id, A.uid, 'd18_ux_2', ['deleted']);
  const doubleClicked = await stateDoc(PF.id, A.uid, 'd18_ux_2');
  expect(doubleClicked.createTime.isEqual(doubleClicked.updateTime), 'duplo clique: o estado foi gravado uma vez só').toBe(true);
  expect(tracked.written('d18_ux_2'), `duplo clique: uma única gravação aceita (pedidos com escrita: ${tracked.attempted('d18_ux_2')})`).toBe(1);
  expect(tracked.attempted('d18_ux_2'), 'duplo clique: um único pedido de gravação').toBe(1);

  // --- Pior caso: dois cliques na mesma tarefa, antes de a interface renderizar o estado ocupado.
  mode = 'pass';
  await askDeletion(page, 'Aviso UX 03');
  await confirmButton(page).evaluate((node) => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(itemHeading(page, 'Aviso UX 03')).toHaveCount(0);
  await page.waitForTimeout(1_500);
  await expectStateShape(PF.id, A.uid, 'd18_ux_3', ['deleted']);
  const raced = await stateDoc(PF.id, A.uid, 'd18_ux_3');
  expect(raced.createTime.isEqual(raced.updateTime), 'cliques simultâneos: o estado foi gravado uma vez só').toBe(true);
  expect(tracked.written('d18_ux_3'), `cliques simultâneos: uma única gravação aceita (pedidos com escrita: ${tracked.attempted('d18_ux_3')})`).toBe(1);
  // Guarda síncrona do diálogo: o segundo clique da mesma tarefa nem chega a pedir gravação.
  expect(tracked.attempted('d18_ux_3'), 'cliques simultâneos: um único pedido de gravação').toBe(1);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 2 não lidas');
  await context.close();
});

test('E — celular (toque): excluir pelo painel, tocar no diálogo e conferir o resultado', async ({ browser }) => {
  test.setTimeout(240_000);
  await seedUxWorkspace();
  const { context, page } = await openSession(browser, A.email, { viewport: PHONE, scheme: 'light', touch: true });
  await expect(bell(page)).toHaveAccessibleName('Notificações, 5 não lidas');
  await bell(page).tap();
  await expect(panelHeading(page)).toBeVisible();
  await expect(itemTitles(page, 'Aviso UX')).toHaveCount(5);

  // Tocar em "Excluir para mim" abre o diálogo, sem marcar como lida nem navegar.
  await deleteButton(page, 'Aviso UX 00').tap();
  await expect(confirmDialog(page)).toBeVisible();
  await expect(panelHeading(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Minhas Finanças', level: 1 })).toBeVisible();
  await cancelButton(page).tap();
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(itemHeading(page, 'Aviso UX 00')).toBeVisible();
  await page.waitForTimeout(1_000);
  expect((await statesOf(PF.id, A.uid)).size, 'tocar em cancelar não grava').toBe(0);

  await deleteButton(page, 'Aviso UX 00').tap();
  await confirmButton(page).tap();
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(itemHeading(page, 'Aviso UX 00')).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName('Notificações, 4 não lidas');
  await expectStateShape(PF.id, A.uid, 'd18_ux_0', ['deleted']);
  await expectNoHorizontalScroll(page, 'celular, depois de excluir');
  await context.close();
});

test('E — celular: o painel e as ações cabem na tela, sem corte nas bordas', async ({ browser }) => {
  test.setTimeout(240_000);
  await seedUxWorkspace();
  for (const scheme of ['light', 'dark'] as const) {
    const { context, page } = await openSession(browser, A.email, { viewport: PHONE, scheme, touch: true });
    await openPanel(page);
    await expect(itemTitles(page, 'Aviso UX')).toHaveCount(UX_TITLES.length);
    await page.waitForTimeout(600);
    const inside = (name: string, box: { x: number; y: number; width: number; height: number } | null) => {
      expect(box, `${scheme}: ${name} tem caixa`).not.toBeNull();
      expect.soft(box!.x, `${scheme}: ${name} sem corte à esquerda (x=${box!.x})`).toBeGreaterThanOrEqual(0);
      expect.soft(box!.x + box!.width, `${scheme}: ${name} sem corte à direita`).toBeLessThanOrEqual(PHONE.width);
    };
    inside('painel', await panelHeading(page).locator('xpath=ancestor::div[contains(@class,"shadow-2xl")][1]').boundingBox());
    for (const title of UX_TITLES) {
      inside(`"Excluir para mim: ${title}"`, await deleteButton(page, title).boundingBox());
      inside(`"Arquivar para mim: ${title}"`, await archiveButton(page, title).boundingBox());
    }
    await context.close();
  }
});
