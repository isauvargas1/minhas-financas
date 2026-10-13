import { expect, test, type Page, type Route } from '@playwright/test';

import { resolveAiChatScope } from '../src/modules/reports/aiChatStorage';
import { callCallable, emulatorIdToken } from './support/callables';
import { adminSdk, seedPaidPlan } from './support/workspaceSeed';

/**
 * P5-A (PR-AI-04) — histórico do chat de IA isolado por usuário e workspace,
 * de ponta a ponta. Autenticação, contas e workspaces são reais no Emulator;
 * só a resposta da IA é simulada, no limite de rede da callable
 * `analyzeFinancialQuestion` (o provedor nunca é chamado e nenhum crédito é
 * consumido). Um `MutationObserver` instalado antes do app registra qualquer
 * quadro em que o chat de um contexto exiba texto de outro — inclusive nós
 * que estejam saindo da tela por animação.
 */

const PASSWORD = 'e2e-password-123456';
const A = { uid: 'e2e-ai-chat-a', email: 'e2e-ai-chat-a@minhas-financas.local' };
const B = { uid: 'e2e-ai-chat-b', email: 'e2e-ai-chat-b@minhas-financas.local' };
const COMPANY = 'Empresa IA E2E';

const SECRET_PF = 'SEGREDO-PF-A';
const SECRET_PJ = 'SEGREDO-PJ-A';
const SLOW_QUESTION = 'PERGUNTA-LENTA-PF';
const SECRET_B = 'SEGREDO-B';

const resetEmulatorData = async () => {
  const sdk = adminSdk();
  const users = await sdk.auth().listUsers(1000);
  if (users.users.length > 0) {
    await sdk.auth().deleteUsers(users.users.map((user) => user.uid));
  }
  const db = sdk.firestore();
  const collections = await db.listCollections();
  await Promise.all(collections.map((collection) => db.recursiveDelete(collection)));
};

const chatKey = (uid: string, workspaceId: string): string => {
  const scope = resolveAiChatScope(uid, workspaceId);
  if (!scope) throw new Error('escopo inválido no teste');
  return scope.key;
};

const login = async (page: Page, email: string) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
};

const chatHeader = (page: Page) => page.getByRole('heading', { name: /^Consultor IA/ });

const openAiChat = async (page: Page) => {
  await page.getByText(/^Relatórios( Empresariais)?$/).first().click();
  await page.getByText('IA Financeira', { exact: true }).click();
  await expect(chatHeader(page)).toBeVisible({ timeout: 30_000 });
};

const switchWorkspace = async (page: Page, label: string) => {
  await page.getByRole('button', { name: 'Abrir menu da conta' }).click();
  await page.getByRole('button', { name: label }).first().click();
};

/**
 * P5-E1: a pergunta só sai depois da confirmação de envio ao provedor de IA;
 * Enter apenas abre o diálogo.
 */
const ask = async (page: Page, question: string) => {
  const input = page.getByPlaceholder(/Digite sua pergunta|Pergunte sobre estratégia/);
  await input.fill(question);
  await input.press('Enter');
  await page
    .getByRole('dialog', { name: 'Enviar pergunta ao assistente de IA' })
    .getByRole('button', { name: 'Enviar pergunta' })
    .click();
};

const localKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).sort());

const storedTexts = (page: Page, key: string) => page.evaluate((storageKey) => {
  const raw = localStorage.getItem(storageKey);
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as { uid: string; workspaceId: string; messages: Array<{ text: string }> };
  return { uid: parsed.uid, workspaceId: parsed.workspaceId, texts: parsed.messages.map((m) => m.text) };
}, key);

/** Observador de vazamento: roda em toda carga de página, antes do app. */
const installLeakObserver = async (page: Page) => {
  await page.addInitScript(({ secretPf, secretPj, slow, secretB }) => {
    const state = window as unknown as {
      __aiChatLeaks: string[];
      __aiChatPhase: 'A' | 'B';
    };
    state.__aiChatLeaks = [];
    state.__aiChatPhase = 'A';
    const check = () => {
      const header = [...document.querySelectorAll('h3')]
        .find((node) => (node.textContent ?? '').startsWith('Consultor IA'));
      if (!header) return;
      const text = document.body?.textContent ?? '';
      const isPJ = (header.textContent ?? '').includes('Empresarial');
      const forbidden = state.__aiChatPhase === 'B'
        ? [secretPf, secretPj, slow]
        : isPJ ? [secretPf, slow, secretB] : [secretPj, secretB, `Resposta simulada: ${slow}`];
      for (const marker of forbidden) {
        if (text.includes(marker)) state.__aiChatLeaks.push(`${state.__aiChatPhase}/${isPJ ? 'PJ' : 'PF'}: ${marker}`);
      }
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
  }, { secretPf: SECRET_PF, secretPj: SECRET_PJ, slow: SLOW_QUESTION, secretB: SECRET_B });
};

const leaks = (page: Page) => page.evaluate(() => (window as unknown as { __aiChatLeaks: string[] }).__aiChatLeaks);

test.beforeEach(async () => {
  await resetEmulatorData();
});

test('histórico do chat de IA isolado por usuário e workspace, com limpeza e respostas atrasadas', async ({ page, request }) => {
  test.setTimeout(240_000);
  const db = adminSdk().firestore();
  for (const user of [A, B]) {
    await adminSdk().auth().createUser({ uid: user.uid, email: user.email, password: PASSWORD, emailVerified: true });
  }

  // A: conta pelo backend, plano Pro (pessoal + empresa) e uma empresa.
  const tokenA = await emulatorIdToken(request, A.email, PASSWORD);
  expect((await callCallable(request, tokenA, 'bootstrapAccount', {})).status).toBe(200);
  await seedPaidPlan(A.uid, 'pro');
  const created = await callCallable(request, tokenA, 'createWorkspace', {
    type: 'PJ', name: COMPANY, idempotencyKey: 'e2e-ai-chat-company',
  });
  expect(created.status, created.errorMessage).toBe(200);
  const pjId = String(created.result?.workspaceId);
  const indexA = await db.collection(`users/${A.uid}/workspaces`).get();
  const pfId = indexA.docs.map((doc) => doc.id).find((id) => id !== pjId);
  expect(pfId).toBeTruthy();
  const tokenB = await emulatorIdToken(request, B.email, PASSWORD);
  expect((await callCallable(request, tokenB, 'bootstrapAccount', {})).status).toBe(200);

  // IA simulada no limite de rede, com atraso controlado para a pergunta lenta.
  let releaseSlow = () => {};
  const slowReleased = new Promise<void>((resolve) => { releaseSlow = resolve; });
  let markSlowRequested = () => {};
  const slowRequested = new Promise<void>((resolve) => { markSlowRequested = resolve; });
  let markSlowAnswered = () => {};
  const slowAnswered = new Promise<void>((resolve) => { markSlowAnswered = resolve; });
  const aiCalls: Array<{ workspaceId: string; question: string }> = [];
  const aiPayloadKeys: string[][] = [];
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
    const body = route.request().postDataJSON() as { data: { workspaceId: string; question: string } };
    aiCalls.push({ workspaceId: body.data.workspaceId, question: body.data.question });
    aiPayloadKeys.push(Object.keys(body.data).sort());
    if (body.data.question.includes(SLOW_QUESTION)) {
      markSlowRequested();
      await slowReleased;
    }
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ result: { answer: `Resposta simulada: ${body.data.question}`, createdAt: new Date().toISOString() } }),
    });
    if (body.data.question.includes(SLOW_QUESTION)) markSlowAnswered();
  });

  await installLeakObserver(page);
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [`lastWorkspaceId_${A.uid}`, pfId!]);

  // 1. PF: conversa privada, gravada só na chave (A, PF).
  await login(page, A.email);
  await openAiChat(page);
  await expect(chatHeader(page)).toHaveText(/^Consultor IA\s*$/);
  await ask(page, `Pergunta ${SECRET_PF}`);
  await expect(page.getByText(`Resposta simulada: Pergunta ${SECRET_PF}`)).toBeVisible();
  expect(await storedTexts(page, chatKey(A.uid, pfId!))).toEqual({
    uid: A.uid, workspaceId: pfId, texts: [`Pergunta ${SECRET_PF}`, `Resposta simulada: Pergunta ${SECRET_PF}`],
  });
  expect(await storedTexts(page, chatKey(A.uid, pjId))).toBeNull();
  expect((await localKeys(page)).filter((key) => key.startsWith('finance_ai_chat_history_')))
    .toEqual([chatKey(A.uid, pfId!)]);

  // 2. PJ: vazio desde a primeira renderização; conversa própria.
  await switchWorkspace(page, COMPANY);
  await expect(chatHeader(page)).toHaveText(/Empresarial/);
  await expect(page.getByText(SECRET_PF)).toHaveCount(0);
  await expect(page.getByText('Como posso ajudar hoje?')).toBeVisible();
  await ask(page, `Pergunta ${SECRET_PJ}`);
  await expect(page.getByText(`Resposta simulada: Pergunta ${SECRET_PJ}`)).toBeVisible();
  expect((await storedTexts(page, chatKey(A.uid, pjId)))?.texts)
    .toEqual([`Pergunta ${SECRET_PJ}`, `Resposta simulada: Pergunta ${SECRET_PJ}`]);

  // 3. De volta ao PF: o histórico certo reaparece.
  await switchWorkspace(page, 'Pessoal');
  await expect(chatHeader(page)).toHaveText(/^Consultor IA\s*$/);
  await expect(page.getByText(`Resposta simulada: Pergunta ${SECRET_PF}`)).toBeVisible();
  await expect(page.getByText(SECRET_PJ)).toHaveCount(0);

  // 4. Recarregar mantém o histórico da mesma conta e workspace.
  await page.reload();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
  await openAiChat(page);
  await expect(page.getByText(`Resposta simulada: Pergunta ${SECRET_PF}`)).toBeVisible();

  // 5. Resposta atrasada: começa no PF, chega com o PJ aberto.
  await ask(page, SLOW_QUESTION);
  await slowRequested;
  await switchWorkspace(page, COMPANY);
  await expect(chatHeader(page)).toHaveText(/Empresarial/);
  releaseSlow();
  await slowAnswered;
  await page.waitForTimeout(500);
  await expect(page.getByText(SLOW_QUESTION)).toHaveCount(0);
  expect((await storedTexts(page, chatKey(A.uid, pjId)))?.texts.join(' ')).not.toContain(SLOW_QUESTION);
  await switchWorkspace(page, 'Pessoal');
  await expect(chatHeader(page)).toHaveText(/^Consultor IA\s*$/);
  // A pergunta interrompida continua no PF; a resposta antiga não entra.
  await expect(page.getByText(SLOW_QUESTION)).toHaveCount(1);
  await expect(page.getByText(`Resposta simulada: ${SLOW_QUESTION}`)).toHaveCount(0);
  expect((await storedTexts(page, chatKey(A.uid, pfId!)))?.texts.join(' ')).not.toContain(`Resposta simulada: ${SLOW_QUESTION}`);
  expect(aiCalls.map((call) => call.workspaceId)).toEqual([pfId, pjId, pfId]);
  // P5-E1: só o contrato novo, sem valores financeiros do navegador.
  for (const keys of aiPayloadKeys) {
    expect(keys).toEqual(['idempotencyKey', 'providerConsent', 'question', 'range', 'workspaceId']);
  }

  // 6. Limpar Histórico: só o escopo atual.
  await page.getByRole('button', { name: /Limpar Histórico/ }).click();
  await expect(page.getByText('Como posso ajudar hoje?')).toBeVisible();
  expect(await storedTexts(page, chatKey(A.uid, pfId!))).toBeNull();
  expect(await storedTexts(page, chatKey(A.uid, pjId))).not.toBeNull();

  // 7. Logout apaga todo histórico local e o dono local; o tema fica.
  const url = new URL(page.url());
  url.searchParams.set('e2eEmail', B.email);
  await page.evaluate((next) => window.history.replaceState(null, '', next), url.toString());
  await page.getByText('Sair', { exact: true }).first().click();
  await expect(page.getByTestId('e2e-login-button')).toBeVisible();
  const afterLogout = await localKeys(page);
  expect(afterLogout.filter((key) => key.startsWith('finance_ai_chat_history_') ||
    key === 'dindin_local_session_owner')).toEqual([]);

  // 8. B entra na mesma página: nada de A em nenhum quadro.
  await page.evaluate(() => { (window as unknown as { __aiChatPhase: string }).__aiChatPhase = 'B'; });
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
  await openAiChat(page);
  await expect(page.getByText('Como posso ajudar hoje?')).toBeVisible();
  await ask(page, `Pergunta ${SECRET_B}`);
  await expect(page.getByText(`Resposta simulada: Pergunta ${SECRET_B}`)).toBeVisible();
  const keysB = (await localKeys(page)).filter((key) => key.startsWith('finance_ai_chat_history_'));
  expect(keysB).toHaveLength(1);
  expect(keysB[0].startsWith(`finance_ai_chat_history_v2:${B.uid}:`)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('dindin_local_session_owner'))).toBe(B.uid);

  expect(await leaks(page)).toEqual([]);
});

test('primeira carga de outra conta apaga os resíduos da sessão anterior antes de abrir', async ({ page, request }) => {
  test.setTimeout(120_000);
  await adminSdk().auth().createUser({ uid: B.uid, email: B.email, password: PASSWORD, emailVerified: true });
  const tokenB = await emulatorIdToken(request, B.email, PASSWORD);
  expect((await callCallable(request, tokenB, 'bootstrapAccount', {})).status).toBe(200);

  // B entra e a sessão fica salva no navegador.
  await login(page, B.email);
  /*
   * Resíduos de A (histórico atual e antigo, dono local A) aparecem no
   * navegador; na recarga, a primeira emissão do Firebase Auth já é B, sem
   * conta anterior nesta aba: o dono local reconhece os resíduos e eles saem.
   */
  const residueKey = chatKey(A.uid, 'ws-de-a');
  await page.evaluate(([key, ownerKey, ownerUid]) => {
    localStorage.setItem(key, JSON.stringify({
      v: 2, uid: ownerUid, workspaceId: 'ws-de-a',
      messages: [{ id: '1', type: 'user', text: 'resíduo privado de A', timestamp: new Date().toISOString() }],
    }));
    localStorage.setItem('finance_ai_chat_history_ws-de-a', '[]');
    localStorage.setItem(ownerKey, ownerUid);
    localStorage.setItem('chave-nao-relacionada', 'fica');
  }, [residueKey, 'dindin_local_session_owner', A.uid]);

  await page.reload();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
  const keys = await localKeys(page);
  expect(keys).not.toContain(residueKey);
  expect(keys).not.toContain('finance_ai_chat_history_ws-de-a');
  expect(keys).toContain('chave-nao-relacionada');
  expect(await page.evaluate(() => localStorage.getItem('dindin_local_session_owner'))).toBe(B.uid);
  await openAiChat(page);
  await expect(page.getByText('resíduo privado de A')).toHaveCount(0);
  await expect(page.getByText('Como posso ajudar hoje?')).toBeVisible();
});
