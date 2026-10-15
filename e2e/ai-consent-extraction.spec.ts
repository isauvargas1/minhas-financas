import { mkdirSync } from 'node:fs';

import { expect, test, type Locator, type Page, type Request } from '@playwright/test';

import { axeViolations } from './support/axe';
import {
  adminSdk,
  seedOwnedWorkspace,
} from './support/workspaceSeed';

/**
 * P5-E1 — confirmação de envio ao provedor de IA e extração tipada, de ponta
 * a ponta. Autenticação, workspace e catálogo são reais no Emulator; só as
 * callables de IA (`analyzeFinancialQuestion` e `extractTransactionFromContent`)
 * são simuladas no limite de rede com `page.route`: o Google nunca é chamado e
 * nenhum crédito é consumido.
 *
 * Prova: nada sai do navegador antes do botão de envio do diálogo (cancelar,
 * Escape e clique fora não enviam); o payload é exatamente o contrato do
 * backend, sem valores financeiros; só campos `identified` preenchem o
 * formulário e nada é salvo; resposta tardia de outro escopo é descartada; e o
 * diálogo é acessível por teclado.
 */

test.use({ timezoneId: 'America/Sao_Paulo' });

const PASSWORD = 'e2e-password-123456';
const OWNER = { uid: 'e2e-p5e1-owner', email: 'e2e-p5e1-owner@minhas-financas.local' };
const WORKSPACE = { id: 'e2e-p5e1-main', name: 'Espaço IA E2E' };

// Capturas de evidência só quando pedidas (E2E_CAPTURE_DIR); não são asserções.
const CAPTURE_DIR = process.env.E2E_CAPTURE_DIR ?? '';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };
const NARROW = { width: 360, height: 740 };

const CATALOG = {
  incomeCategory: 'Salário E2E',
  expenseCategory: 'Moradia E2E',
};

const ANALYSIS_KEYS = ['idempotencyKey', 'providerConsent', 'question', 'range', 'workspaceId'];
const DOCUMENT_KEYS = ['dataBase64', 'idempotencyKey', 'kind', 'mimeType', 'providerConsent', 'workspaceId'];
const TEXT_KEYS = ['idempotencyKey', 'kind', 'providerConsent', 'transcript', 'workspaceId'];

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const db = () => adminSdk().firestore();

const normalize = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

const resetEmulatorData = async () => {
  const sdk = adminSdk();
  const users = await sdk.auth().listUsers(1000);
  if (users.users.length > 0) {
    await sdk.auth().deleteUsers(users.users.map((user) => user.uid));
  }
  const collections = await sdk.firestore().listCollections();
  await Promise.all(collections.map((collection) => sdk.firestore().recursiveDelete(collection)));
};

const seedCatalog = async (workspaceId: string) => {
  const now = new Date();
  const items: Array<[string, string, string, string?]> = [
    ['p5e1-income-category', 'category', CATALOG.incomeCategory, 'receita'],
    ['p5e1-expense-category', 'category', CATALOG.expenseCategory, 'despesa'],
  ];
  await Promise.all(items.map(([id, group, name, transactionSubtype]) => {
    const normalizedName = normalize(name);
    return db().doc(`workspaces/${workspaceId}/settings_catalog/${id}`).set({
      id, schemaVersion: 1, workspaceId, group, name, normalizedName,
      ...(transactionSubtype ? { transactionSubtype } : {}),
      dedupeKey: `${group}::${transactionSubtype ?? 'all'}::both::${normalizedName}`,
      workspaceScope: 'both', sortOrder: 1, status: 'active',
      createdBy: OWNER.uid, updatedBy: OWNER.uid, createdAt: now, updatedAt: now,
    });
  }));
};

test.beforeEach(async () => {
  await resetEmulatorData();
  await adminSdk().auth().createUser({
    uid: OWNER.uid, email: OWNER.email, password: PASSWORD, emailVerified: true,
  });
  await seedOwnedWorkspace({
    ...OWNER, workspaceId: WORKSPACE.id, name: WORKSPACE.name, type: 'PF',
  });
  await seedCatalog(WORKSPACE.id);
});

const login = async (page: Page) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(OWNER.email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
};

// --- Callables de IA simuladas ----------------------------------------------

type CallableData = Record<string, unknown>;
type Reply =
  | { result: unknown }
  | { error: { status: string; message: string; details?: unknown }; httpStatus: number };

const mockAi = async (
  page: Page,
  name: 'analyzeFinancialQuestion' | 'extractTransactionFromContent',
  respond: (data: CallableData, count: number) => Promise<Reply> | Reply,
) => {
  const requests: CallableData[] = [];
  await page.route(`**/${name}`, async (route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': request.headers().origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const data = (request.postDataJSON() as { data: CallableData }).data;
    requests.push(data);
    const reply = await respond(data, requests.length);
    await route.fulfill({
      status: 'error' in reply ? reply.httpStatus : 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify('error' in reply ? { error: reply.error } : { result: reply.result }),
    });
  });
  return requests;
};

const analysisAnswer = (answer: string) => ({
  result: {
    answer,
    createdAt: new Date().toISOString(),
    workspaceType: 'PF',
    period: {
      label: 'Últimos 30 dias', startDate: '2026-09-13', endDate: '2026-10-12',
      referenceDate: '2026-10-12', dayCount: 30,
    },
    coverage: {},
  },
});

const missing = { state: 'missing' };
const identified = (value: unknown) => ({ state: 'identified', value });
const extractionOf = (
  status: 'complete' | 'partial' | 'refused',
  fields: Record<string, unknown>,
) => ({
  result: {
    extraction: {
      schemaVersion: 1,
      status,
      fields: {
        operation: missing, description: missing, amountCents: missing, date: missing,
        categoryHint: missing, supplier: missing, costCenterHint: missing, installments: missing,
        ...fields,
      },
    },
  },
});

/** Chamadas das callables oficiais de lançamento: a IA nunca grava. */
const watchSaves = (page: Page) => {
  const saves: string[] = [];
  page.on('request', (request: Request) => {
    if (request.method() !== 'POST') return;
    if (/\/(createCashTransaction|createCreditCardPurchase|updateCashTransaction|confirmCashTransaction|importTransactions)$/
      .test(request.url())) {
      saves.push(request.url());
    }
  });
  return saves;
};

const savedTransactions = async () =>
  (await db().collection(`workspaces/${WORKSPACE.id}/transactions`).get()).size;

// --- Capturas e verificações de layout --------------------------------------

const captureBoth = async (page: Page, name: string) => {
  if (CAPTURE_DIR === '') return;
  mkdirSync(CAPTURE_DIR, { recursive: true });
  const original = page.viewportSize() ?? DESKTOP;
  for (const [label, size] of [['desktop', DESKTOP], ['mobile', MOBILE]] as const) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${CAPTURE_DIR}/${name}-${label}.png` });
  }
  await page.setViewportSize(original);
};

/** Nenhuma rolagem horizontal na página nem no cartão do diálogo, a 360 px. */
const expectNoHorizontalOverflow = async (page: Page, dialog: Locator) => {
  const original = page.viewportSize() ?? DESKTOP;
  await page.setViewportSize(NARROW);
  await page.waitForTimeout(150);
  const page_ = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(page_.scroll).toBeLessThanOrEqual(page_.inner);
  const box = await dialog.evaluate((element) => ({
    scroll: element.scrollWidth, client: element.clientWidth,
    right: element.getBoundingClientRect().right, left: element.getBoundingClientRect().left,
  }));
  expect(box.scroll).toBeLessThanOrEqual(box.client);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(NARROW.width);
  await page.setViewportSize(original);
};

const expectNoAxeViolations = async (page: Page) => {
  const violations = await axeViolations(page, '[data-testid="ai-share-dialog"]');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
};

/**
 * P5-E1.1: no celular (390 px) e em tela estreita (360 px) o corpo do diálogo
 * pode rolar. Enquanto rola, ele é alcançável pelo teclado (focável), e o axe
 * não acusa violação nesses tamanhos.
 */
const expectReachableWhenScrolling = async (page: Page, dialog: Locator) => {
  const original = page.viewportSize() ?? DESKTOP;
  const body = dialog.locator('.overflow-y-auto.min-h-0').first();
  for (const size of [MOBILE, NARROW]) {
    await page.setViewportSize(size);
    await expect.poll(() => body.evaluate((node) =>
      (node.scrollHeight > node.clientHeight + 1) === (node.getAttribute('tabindex') === '0'))).toBe(true);
    await expectNoAxeViolations(page);
  }
  // A 360 px o texto da análise rola: o corpo entra no Tab, entre "Fechar" e "Cancelar".
  await expect(body).toHaveAttribute('tabindex', '0');
  const cancel = dialog.getByRole('button', { name: 'Cancelar' });
  await cancel.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(body).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Fechar' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(body).toBeFocused();
  await cancel.focus();
  await page.setViewportSize(original);
};

// --- Chat dos Relatórios ----------------------------------------------------

const openAiChat = async (page: Page) => {
  await page.getByText(/^Relatórios( Empresariais)?$/).first().click();
  await page.getByText('IA Financeira', { exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Consultor IA/ })).toBeVisible({ timeout: 30_000 });
};

const consentDialog = (page: Page, title: string) =>
  page.getByRole('dialog', { name: title });

const ANALYSIS_TITLE = 'Enviar pergunta ao assistente de IA';
const DOCUMENT_TITLE = 'Enviar comprovante para leitura por IA';
const VOICE_START_TITLE = 'Preencher por voz';
const VOICE_SEND_TITLE = 'Enviar texto reconhecido à IA';

test('diálogo de análise: pergunta longa rola na citação, que fica alcançável pelo teclado', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP);
  const requests = await mockAi(page, 'analyzeFinancialQuestion', () => analysisAnswer('Resposta simulada E2E.'));
  await login(page);
  await openAiChat(page);

  const input = page.getByPlaceholder('Digite sua pergunta sobre suas finanças...');
  const question = `Quanto gastei com mercado neste período? ${'Detalhe a resposta por semana e por tipo de despesa. '.repeat(20)}`.trim();
  await input.fill(question);
  await input.press('Enter');
  const dialog = consentDialog(page, ANALYSIS_TITLE);
  await expect(dialog).toBeVisible();
  const quote = dialog.locator('p.max-h-32');
  await expect(quote).toHaveText(question);
  await expect.poll(() => quote.evaluate((node) => node.scrollHeight > node.clientHeight + 1)).toBe(true);
  await expect(quote).toHaveAttribute('tabindex', '0');
  await expectNoAxeViolations(page);

  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();
  expect(requests).toHaveLength(0);
});

test('chat: cancelar e Escape não enviam; confirmar envia só o contrato, e o duplo clique vira um envio', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP);
  const requests = await mockAi(page, 'analyzeFinancialQuestion', () => analysisAnswer('Resposta simulada E2E.'));
  await login(page);
  await openAiChat(page);

  const input = page.getByPlaceholder('Digite sua pergunta sobre suas finanças...');
  const question = 'Quanto gastei com mercado neste período?';
  const dialog = consentDialog(page, ANALYSIS_TITLE);

  // Enter só abre o diálogo; nada é enviado.
  await input.fill(question);
  await input.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(question, { exact: true })).toBeVisible();
  await expect(dialog.getByText(/período: Últimos 30 dias\./)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Enviar pergunta' })).toBeEnabled();
  await expect(dialog.getByText(/Cada envio usa 1 crédito de IA do plano/)).toBeVisible();
  await expect(dialog.getByText(/não inclui os nomes das categorias/)).toBeVisible();
  await expect(dialog.getByText(/grupos de despesas identificados só pela posição/)).toBeVisible();
  await expect(dialog.getByText(/A pergunta que você digitou vai inteira/)).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page, dialog.first());
  await expectReachableWhenScrolling(page, dialog.first());
  await captureBoth(page, 'dialogo-analise');

  // Cancelar mantém o rascunho e não envia.
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();
  await expect(input).toHaveValue(question);
  await expect(input).toBeFocused();

  // Escape cancela do mesmo modo.
  await input.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(input).toHaveValue(question);

  // Clique fora (no fundo escurecido) cancela.
  await input.press('Enter');
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();

  // Pergunta sugerida também passa pelo diálogo.
  await input.fill('');
  await page.getByRole('button', { name: 'Como está minha saúde financeira?' }).click();
  await expect(dialog.getByText('Como está minha saúde financeira?', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  await expect(dialog).toBeHidden();

  await page.waitForTimeout(400);
  expect(requests).toHaveLength(0);

  // Confirmar envia exatamente o contrato, com duplo clique = uma requisição.
  // O campo foi limpo para o teste da sugestão: a pergunta volta a ser digitada.
  await input.fill(question);
  await input.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Enviar pergunta' }).dblclick();
  await expect(page.getByText('Resposta simulada E2E.')).toBeVisible();
  expect(requests).toHaveLength(1);
  const data = requests[0];
  expect(Object.keys(data).sort()).toEqual(ANALYSIS_KEYS);
  expect(data).toMatchObject({
    workspaceId: WORKSPACE.id,
    question,
    providerConsent: { version: 'ai-provider-share-v1', operation: 'analysis', confirmed: true },
  });
  expect(data.range).toEqual({ kind: 'preset', preset: expect.stringMatching(/^(7d|30d|90d|12m|ytd|all)$/) });
  expect(String(data.idempotencyKey)).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  for (const forbidden of ['context', 'kpis', 'topCategories', 'alerts', 'profileType', 'role', 'uid']) {
    expect(data).not.toHaveProperty(forbidden);
  }
  await expect(input).toHaveValue('');

  // Cada pergunta confirmada leva uma chave nova.
  await input.fill('Onde posso economizar?');
  await input.press('Enter');
  await dialog.getByRole('button', { name: 'Enviar pergunta' }).click();
  await expect(page.getByText('Resposta simulada E2E.')).toHaveCount(2);
  expect(requests).toHaveLength(2);
  expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
});

test('chat: erro do provedor mostra a mensagem do backend como resposta', async ({ page }) => {
  test.setTimeout(120_000);
  const message = 'O serviço de IA falhou depois de aceitar o pedido; o crédito foi contabilizado. Tente novamente.';
  const requests = await mockAi(page, 'analyzeFinancialQuestion', () => ({
    httpStatus: 400,
    error: { status: 'FAILED_PRECONDITION', message, details: { reason: 'ai_provider_failed' } },
  }));
  await login(page);
  await openAiChat(page);
  const input = page.getByPlaceholder('Digite sua pergunta sobre suas finanças...');
  await input.fill('Pergunta que vai falhar');
  await input.press('Enter');
  await consentDialog(page, ANALYSIS_TITLE).getByRole('button', { name: 'Enviar pergunta' }).click();
  await expect(page.getByText(message)).toBeVisible();
  // failed-precondition nunca é repetido.
  await page.waitForTimeout(1200);
  expect(requests).toHaveLength(1);
});

test('chat: HTML ativo na resposta aparece como texto literal, sem elementos nem script', async ({ page }) => {
  test.setTimeout(120_000);
  const payload = '<script>window.__xss=1</script><img src=x onerror="window.__xss=2"> **ok**';
  await mockAi(page, 'analyzeFinancialQuestion', () => analysisAnswer(payload));
  await login(page);
  await openAiChat(page);
  const input = page.getByPlaceholder('Digite sua pergunta sobre suas finanças...');
  await input.fill('Pergunta para testar HTML na resposta');
  await input.press('Enter');
  await consentDialog(page, ANALYSIS_TITLE).getByRole('button', { name: 'Enviar pergunta' }).click();
  const bubble = page.locator('div.rounded-2xl').filter({ hasText: '<script>window.__xss=1</script>' }).last();
  await expect(bubble).toBeVisible();
  // Texto literal: as marcações aparecem como caracteres, e `**ok**` vira só negrito.
  await expect(bubble).toContainText('<script>window.__xss=1</script><img src=x onerror="window.__xss=2"> ok');
  await expect(bubble.locator('script, img, iframe, a')).toHaveCount(0);
  await expect(bubble.locator('strong')).toHaveText('ok');
  await page.waitForTimeout(500);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

// --- Assistente do formulário de lançamento ----------------------------------

const transactionDialog = (page: Page) =>
  page.getByRole('dialog').filter({ has: page.locator('#transaction-modal-title') });

const openNewTransaction = async (page: Page) => {
  await page.getByRole('button', { name: /Nova Transação/i }).first().click();
  await expect(transactionDialog(page)).toBeVisible();
  // O catálogo carregou: as opções de categoria da aba atual existem.
  await expect(transactionDialog(page).locator('form').locator('select').nth(1))
    .toContainText(CATALOG.incomeCategory, { timeout: 20_000 });
};

const fileInput = (page: Page) => transactionDialog(page).locator('input[type="file"]');
const notice = (page: Page) => page.getByTestId('ai-assistant-notice');

const choosePng = (page: Page, name = 'comprovante.png') =>
  fileInput(page).setInputFiles({ name, mimeType: 'image/png', buffer: TINY_PNG });

test('documento: arquivo inválido ou vazio não abre envio; PNG válido pede confirmação e preenche só o identificado', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP);
  const requests = await mockAi(page, 'extractTransactionFromContent', () => extractionOf('partial', {
    operation: identified('expense'),
    description: identified('Mercado do bairro'),
    categoryHint: identified('  MORADIA e2e '),
  }));
  const saves = watchSaves(page);
  await login(page);
  await openNewTransaction(page);
  const modal = transactionDialog(page);
  const consent = consentDialog(page, DOCUMENT_TITLE);

  // O seletor só aceita os tipos que o backend lê.
  await expect(fileInput(page)).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,application/pdf');

  // Tipo fora da lista e arquivo vazio: mensagem local, nenhum diálogo, nenhuma requisição.
  await fileInput(page).setInputFiles({ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('texto') });
  await expect(notice(page)).toHaveText('Formato não suportado. Envie uma imagem PNG, JPEG ou WEBP, ou um PDF.');
  await expect(consent).toBeHidden();
  await fileInput(page).setInputFiles({ name: 'vazio.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
  await expect(notice(page)).toHaveText('Arquivo vazio. Escolha outro arquivo.');
  await expect(consent).toBeHidden();
  await fileInput(page).setInputFiles({
    name: 'grande.png', mimeType: 'image/png', buffer: Buffer.alloc(4_718_593, 1),
  });
  await expect(notice(page)).toHaveText('Arquivo grande demais para leitura por IA (máximo de 4,5 MB).');
  await expect(consent).toBeHidden();
  expect(requests).toHaveLength(0);

  // PNG válido: diálogo com nome, tipo e tamanho; cancelar não envia.
  await choosePng(page);
  await expect(consent).toBeVisible();
  await expect(consent.getByText(`comprovante.png · PNG · ${TINY_PNG.length} B`)).toBeVisible();
  await expect(consent.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page, consent.first());
  await captureBoth(page, 'dialogo-comprovante');
  await consent.getByRole('button', { name: 'Cancelar' }).click();
  await expect(consent).toBeHidden();
  await expect(modal).toBeVisible();
  await page.waitForTimeout(400);
  expect(requests).toHaveLength(0);

  // Confirmar (duplo clique): uma requisição com o contrato exato.
  await choosePng(page);
  await consent.getByRole('button', { name: 'Enviar comprovante' }).dblclick();
  await expect(notice(page)).toHaveText(/^Sugestão parcial aplicada\. Confira: valor, data\./);
  expect(requests).toHaveLength(1);
  const data = requests[0];
  expect(Object.keys(data).sort()).toEqual(DOCUMENT_KEYS);
  expect(data).toMatchObject({
    kind: 'document',
    workspaceId: WORKSPACE.id,
    mimeType: 'image/png',
    dataBase64: TINY_PNG.toString('base64'),
    providerConsent: { version: 'ai-provider-share-v1', operation: 'extraction_document', confirmed: true },
  });
  expect(String(data.idempotencyKey)).toMatch(/^[A-Za-z0-9_-]{8,128}$/);

  // Só o identificado foi preenchido: despesa, descrição e categoria; valor e data seguem vazios.
  const form = modal.locator('form');
  await expect(form.getByRole('button', { name: /Revisar e Adicionar Despesa/i })).toBeVisible();
  await expect(form.getByPlaceholder('Ex: Conta de Luz, Manutenção...')).toHaveValue('Mercado do bairro');
  await expect(form.locator('select').nth(1)).toHaveValue('p5e1-expense-category');
  await expect(form.locator('input[type="number"]')).toHaveValue('');
  await expect(form.locator('input[type="date"]')).toHaveValue('');
  await captureBoth(page, 'painel-sugestao-parcial');
  await expectNoHorizontalOverflow(page, modal);

  // Nada foi salvo: nenhuma callable de lançamento e nenhum documento novo.
  expect(saves).toEqual([]);
  expect(await savedTransactions()).toBe(0);
});

test('documento: sugestão completa converte centavos sem ponto flutuante e avisa categoria sem correspondência', async ({ page }) => {
  test.setTimeout(120_000);
  await mockAi(page, 'extractTransactionFromContent', () => extractionOf('complete', {
    operation: identified('expense'),
    description: identified('Aluguel de outubro'),
    amountCents: identified(115),
    date: identified('2026-10-03'),
    categoryHint: identified('Categoria que não existe'),
  }));
  const saves = watchSaves(page);
  await login(page);
  await openNewTransaction(page);
  await choosePng(page);
  await consentDialog(page, DOCUMENT_TITLE).getByRole('button', { name: 'Enviar comprovante' }).click();
  await expect(notice(page)).toHaveText(
    'Sugestão aplicada. Revise todos os campos antes de salvar. Categoria sugerida não encontrada; escolha manualmente. O formulário mudou para a aba Despesa.',
  );
  const form = transactionDialog(page).locator('form');
  await expect(form.locator('input[type="number"]')).toHaveValue('1.15');
  await expect(form.locator('input[type="date"]')).toHaveValue('2026-10-03');
  await expect(form.getByPlaceholder('Ex: Conta de Luz, Manutenção...')).toHaveValue('Aluguel de outubro');
  // Categoria sem correspondência: o campo não é alterado.
  await expect(form.locator('select').nth(1)).toHaveValue('');
  expect(saves).toEqual([]);
  expect(await savedTransactions()).toBe(0);
});

test('documento: resposta recusada não preenche nada', async ({ page }) => {
  test.setTimeout(120_000);
  await mockAi(page, 'extractTransactionFromContent', () => extractionOf('refused', {
    // Mesmo que viesse algo identificado, `refused` não preenche.
    description: identified('Não deve aparecer'),
  }));
  const saves = watchSaves(page);
  await login(page);
  await openNewTransaction(page);
  const form = transactionDialog(page).locator('form');
  await choosePng(page);
  await consentDialog(page, DOCUMENT_TITLE).getByRole('button', { name: 'Enviar comprovante' }).click();
  await expect(notice(page)).toHaveText('Não identificamos uma operação financeira. Nenhum campo foi preenchido.');
  await expect(form.getByRole('button', { name: /Revisar e Adicionar Receita/i })).toBeVisible();
  await expect(form.getByPlaceholder('Ex: Cliente XYZ, Reembolso Empresa...')).toHaveValue('');
  await expect(form.locator('input[type="number"]')).toHaveValue('');
  expect(saves).toEqual([]);
  expect(await savedTransactions()).toBe(0);
});

test('documento: trocar de aba antes da resposta descarta a sugestão', async ({ page }) => {
  test.setTimeout(120_000);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requests = await mockAi(page, 'extractTransactionFromContent', async () => {
    await gate;
    return extractionOf('complete', {
      operation: identified('expense'),
      description: identified('Não deve aparecer'),
      amountCents: identified(9900),
      date: identified('2026-10-03'),
    });
  });
  await login(page);
  await openNewTransaction(page);
  const modal = transactionDialog(page);
  await choosePng(page);
  await consentDialog(page, DOCUMENT_TITLE).getByRole('button', { name: 'Enviar comprovante' }).click();
  await expect.poll(() => requests.length).toBe(1);

  // A pessoa muda de aba enquanto a resposta não chega.
  await modal.getByRole('button', { name: /^Despesa$/ }).click();
  release();
  await expect(notice(page)).toHaveText('A sugestão da IA foi descartada porque o formulário mudou.');
  const form = modal.locator('form');
  await expect(form.getByPlaceholder('Ex: Conta de Luz, Manutenção...')).toHaveValue('');
  await expect(form.locator('input[type="number"]')).toHaveValue('');
  await expect(form.getByRole('button', { name: /Revisar e Adicionar Despesa/i })).toBeVisible();
});

test('documento: fechar o formulário antes da resposta descarta a sugestão ao reabrir', async ({ page }) => {
  test.setTimeout(120_000);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requests = await mockAi(page, 'extractTransactionFromContent', async () => {
    await gate;
    return extractionOf('complete', {
      operation: identified('expense'),
      description: identified('Não deve aparecer'),
      amountCents: identified(9900),
    });
  });
  await login(page);
  await openNewTransaction(page);
  await choosePng(page);
  await consentDialog(page, DOCUMENT_TITLE).getByRole('button', { name: 'Enviar comprovante' }).click();
  await expect.poll(() => requests.length).toBe(1);
  await transactionDialog(page).getByRole('button', { name: 'Fechar' }).click();
  await expect(transactionDialog(page)).toBeHidden();
  release();
  await page.waitForTimeout(500);
  await openNewTransaction(page);
  const form = transactionDialog(page).locator('form');
  await expect(form.getByPlaceholder('Ex: Cliente XYZ, Reembolso Empresa...')).toHaveValue('');
  await expect(form.locator('input[type="number"]')).toHaveValue('');
  await expect(notice(page)).toHaveCount(0);
});

test('documento: falha depois da admissão mostra a mensagem do backend e não repete', async ({ page }) => {
  test.setTimeout(120_000);
  const message = 'O serviço de IA falhou depois de aceitar o pedido; o crédito foi contabilizado. Tente novamente.';
  const requests = await mockAi(page, 'extractTransactionFromContent', () => ({
    httpStatus: 400,
    error: { status: 'FAILED_PRECONDITION', message, details: { reason: 'ai_provider_failed' } },
  }));
  const saves = watchSaves(page);
  await login(page);
  await openNewTransaction(page);
  await choosePng(page);
  await consentDialog(page, DOCUMENT_TITLE).getByRole('button', { name: 'Enviar comprovante' }).click();
  await expect(notice(page)).toHaveText(message);
  await expect(notice(page)).toHaveAttribute('role', 'alert');
  await page.waitForTimeout(1200);
  expect(requests).toHaveLength(1);
  // O formulário segue editável e nada foi salvo.
  await expect(transactionDialog(page).getByRole('button', { name: 'Escanear Comprovante' })).toBeEnabled();
  expect(saves).toEqual([]);
});

test('teclado: Tab preso no diálogo, Escape fecha sem enviar e o foco volta ao botão de origem', async ({ page }) => {
  test.setTimeout(120_000);
  const requests = await mockAi(page, 'extractTransactionFromContent', () => extractionOf('refused', {}));
  await login(page);
  await openNewTransaction(page);
  const modal = transactionDialog(page);
  const scan = modal.getByRole('button', { name: 'Escanear Comprovante' });

  const chooser = page.waitForEvent('filechooser');
  await scan.click();
  await (await chooser).setFiles({ name: 'comprovante.png', mimeType: 'image/png', buffer: TINY_PNG });
  const consent = consentDialog(page, DOCUMENT_TITLE);
  await expect(consent).toBeVisible();
  await expect(consent).toHaveAttribute('aria-modal', 'true');
  await expect(consent).toHaveAttribute('aria-describedby', /.+/);

  const inside = () => consent.evaluate((element) => element.contains(document.activeElement));
  await expect(consent.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  // Tab percorre Fechar, Cancelar e Enviar sem sair do diálogo.
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('Tab');
    expect(await inside()).toBe(true);
  }
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await inside()).toBe(true);
  }
  await consent.getByRole('button', { name: 'Cancelar' }).focus();
  await page.keyboard.press('Tab');
  await expect(consent.getByRole('button', { name: 'Enviar comprovante' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(consent.getByRole('button', { name: 'Fechar' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(consent.getByRole('button', { name: 'Enviar comprovante' })).toBeFocused();

  // Escape fecha só o diálogo (o formulário segue aberto), sem enviar.
  await page.keyboard.press('Escape');
  await expect(consent).toBeHidden();
  await expect(modal).toBeVisible();
  await expect(scan).toBeFocused();
  await page.waitForTimeout(400);
  expect(requests).toHaveLength(0);
});

// --- Voz ----------------------------------------------------------------------

/** Reconhecedor de fala falso: `start()` emite `onstart` e depois o resultado. */
const installFakeSpeechRecognition = async (page: Page, transcript: string) => {
  await page.addInitScript((spoken) => {
    class FakeSpeechRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (window as unknown as { __speechStarted: number }).__speechStarted =
          ((window as unknown as { __speechStarted?: number }).__speechStarted ?? 0) + 1;
        setTimeout(() => this.onstart?.(), 10);
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: spoken }]] });
          this.onend?.();
        }, 400);
      }
      stop() { this.onend?.(); }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeechRecognition;
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeSpeechRecognition;
  }, transcript);
};

const speechStarts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __speechStarted?: number }).__speechStarted ?? 0);

test('voz: o microfone só abre depois da confirmação e o texto só é enviado depois da segunda', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP);
  const spoken = 'recebi mil e duzentos reais do cliente ontem';
  await installFakeSpeechRecognition(page, spoken);
  const requests = await mockAi(page, 'extractTransactionFromContent', () => extractionOf('complete', {
    operation: identified('income'),
    description: identified('Pagamento de cliente'),
    amountCents: identified(120_000),
    date: identified('2026-10-11'),
    categoryHint: identified('salario e2e'),
  }));
  const saves = watchSaves(page);
  await login(page);
  await openNewTransaction(page);
  const modal = transactionDialog(page);
  const voice = modal.getByRole('button', { name: /Falar Transação/ });

  // Cancelar a primeira confirmação: o microfone não abre.
  const start = consentDialog(page, VOICE_START_TITLE);
  await voice.click();
  await expect(start).toBeVisible();
  await expect(start.getByText(/A gravação não usa créditos; o envio do texto usa 1 crédito de IA do plano\./)).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page, start.first());
  await captureBoth(page, 'dialogo-voz-inicio');
  await start.getByRole('button', { name: 'Cancelar' }).click();
  await expect(start).toBeHidden();
  await expect(voice).toBeFocused();
  expect(await speechStarts(page)).toBe(0);

  // Confirmar: grava, mostra o texto reconhecido e pede a segunda confirmação.
  await voice.click();
  await start.getByRole('button', { name: 'Iniciar gravação' }).click();
  const send = consentDialog(page, VOICE_SEND_TITLE);
  await expect(send).toBeVisible();
  expect(await speechStarts(page)).toBe(1);
  await expect(send.getByText(spoken, { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page, send.first());
  await captureBoth(page, 'dialogo-voz-envio');
  expect(requests).toHaveLength(0);

  // Cancelar a segunda: nada é enviado.
  await send.getByRole('button', { name: 'Cancelar' }).click();
  await expect(send).toBeHidden();
  await page.waitForTimeout(400);
  expect(requests).toHaveLength(0);

  // Gravar de novo e enviar.
  await voice.click();
  await start.getByRole('button', { name: 'Iniciar gravação' }).click();
  await expect(send).toBeVisible();
  await send.getByRole('button', { name: 'Enviar texto' }).dblclick();
  await expect(notice(page)).toHaveText('Sugestão aplicada. Revise todos os campos antes de salvar.');
  expect(requests).toHaveLength(1);
  expect(Object.keys(requests[0]).sort()).toEqual(TEXT_KEYS);
  expect(requests[0]).toMatchObject({
    kind: 'text',
    workspaceId: WORKSPACE.id,
    transcript: spoken,
    providerConsent: { version: 'ai-provider-share-v1', operation: 'extraction_text', confirmed: true },
  });
  const form = modal.locator('form');
  await expect(form.locator('input[type="number"]')).toHaveValue('1200.00');
  await expect(form.locator('input[type="date"]')).toHaveValue('2026-10-11');
  await expect(form.getByPlaceholder('Ex: Cliente XYZ, Reembolso Empresa...')).toHaveValue('Pagamento de cliente');
  await expect(form.locator('select').nth(1)).toHaveValue('p5e1-income-category');
  expect(saves).toEqual([]);
  expect(await savedTransactions()).toBe(0);
});
