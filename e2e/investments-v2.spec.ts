import { expect, test } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');
const PROJECT = 'minhas-financas-local';
const UID = 'e2e-investments-v2-owner';
const EMAIL = 'e2e-investments-v2@minhas-financas.local';
const PASSWORD = 'e2e-investments-v2-password';
const WORKSPACE = 'e2e-investments-v2-workspace';

const firebaseAdmin = () => {
  process.env.GCLOUD_PROJECT = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  return admin;
};

const seed = async (comProjecoes: boolean) => {
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE}`));
  try { await sdk.auth().deleteUser(UID); } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  await sdk.auth().createUser({ uid: UID, email: EMAIL, password: PASSWORD, emailVerified: true });
  const now = sdk.firestore.Timestamp.now();
  await Promise.all([
    db.doc(`workspaces/${WORKSPACE}`).set({
      // Workspace novo, sem campo `features`: Investimentos abre assim mesmo.
      ownerId: UID, name: 'Patrimônio E2E', type: 'PF',
      createdAt: now, updatedAt: now,
    }),
    db.doc(`workspaces/${WORKSPACE}/members/${UID}`).set({ uid: UID, role: 'owner', status: 'active' }),
    db.doc(`users/${UID}/workspaces/${WORKSPACE}`).set({ workspaceId: WORKSPACE, role: 'owner' }),
  ]);
  if (comProjecoes) {
    await Promise.all([
      db.doc(`workspaces/${WORKSPACE}/investment_summaries/current`).set({
        id: 'current', workspaceId: WORKSPACE, profileType: 'PF', currency: 'BRL',
        positionCount: 1, principalCents: 100_000, currentValueCents: 110_000,
        realizedGainCents: 2_000, unrealizedAppreciationCents: 10_000,
        feesCents: 500, taxCents: 300, updatedAt: now, updatedBy: UID,
      }),
      db.doc(`workspaces/${WORKSPACE}/investment_report_periods/2026-08`).set({
        id: '2026-08', workspaceId: WORKSPACE, profileType: 'PF', currency: 'BRL',
        period: '2026-08', periodStart: now, contributionCents: 100_000,
        redemptionPrincipalCents: 0, realizedGainCents: 0, feesCents: 500,
        taxCents: 300, costDeltaCents: 100_000, currentValueDeltaCents: 110_000,
        cashDeltaCents: -100_800, settledMovementCount: 1,
        closingCurrentValueCents: 110_000,
        updatedAt: now, updatedBy: UID,
      }),
      db.doc(`workspaces/${WORKSPACE}/investment_allocation_summaries/purpose-unassigned`).set({
        id: 'purpose-unassigned', workspaceId: WORKSPACE, profileType: 'PF',
        currency: 'BRL', dimension: 'purpose', key: 'unassigned',
        label: 'Não classificado', positionCount: 1, principalCents: 100_000,
        currentValueCents: 110_000, realizedGainCents: 2_000,
        feesCents: 500, taxCents: 300, updatedAt: now, updatedBy: UID,
      }),
    ]);
  }
};

/** Conta e ativo ativos, para exercitar aporte e resgate pela interface. */
const seedCatalog = async () => {
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  const now = sdk.firestore.Timestamp.now();
  await Promise.all([
    db.doc(`workspaces/${WORKSPACE}/investment_accounts/e2e-account`).set({
      id: 'e2e-account', workspaceId: WORKSPACE, profileType: 'PF',
      name: 'Corretora E2E', institutionName: 'Instituição E2E', currency: 'BRL',
      status: 'active', createdBy: UID, updatedBy: UID, createdAt: now, updatedAt: now,
    }),
    db.doc(`workspaces/${WORKSPACE}/investment_assets/e2e-asset`).set({
      id: 'e2e-asset', workspaceId: WORKSPACE, profileType: 'PF',
      name: 'CDB E2E', symbol: 'CDB', assetType: 'fixed_income',
      allocationPurpose: 'unassigned', currency: 'BRL', status: 'active',
      createdBy: UID, updatedBy: UID, createdAt: now, updatedAt: now,
    }),
  ]);
};

const login = async (page: import('@playwright/test').Page) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
  await page.getByText('Investimentos', { exact: true }).first().click();
};

/*
 * Workspace novo abre Investimentos sem nenhum preparo.
 *
 * Não existe flag, não existe migração e não existe passo em Configurações: o
 * documento do workspace nasce sem o campo `features` e a tela patrimonial é
 * a única superfície de investimentos do produto.
 */
test('workspace novo abre Investimentos sem flag e sem migração', async ({ page }) => {
  await seed(false);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Patrimônio e investimentos' })).toBeVisible();
  // A tela legada de transações nunca mais responde por investimento.
  await expect(page.getByRole('button', { name: 'Nova Transação' })).toHaveCount(0);
});

test('a tela patrimonial é responsiva e cria conta somente via callable', async ({ page }) => {
  await seed(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Patrimônio e investimentos' })).toBeVisible();
  await page.getByRole('tab', { name: 'Contas' }).click();
  await expect(page.getByText('Nenhuma conta encontrada para este filtro.')).toBeVisible();
  await page.getByRole('button', { name: 'Nova conta' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Nome da conta').fill('Conta E2E');
  await page.getByLabel('Instituição').fill('Instituição E2E');
  await page.getByRole('button', { name: 'Salvar conta' }).click();
  await expect(page.getByText('Operação concluída com sucesso.')).toBeVisible();
  await expect.poll(async () => (
    await firebaseAdmin().firestore().collection(
      `workspaces/${WORKSPACE}/investment_accounts`,
    ).where('name', '==', 'Conta E2E').get()
  ).size).toBe(1);
  await expect(page.getByText('Conta E2E')).toBeVisible();
});

test('o patrimônio aparece no dashboard e no relatório sem misturar caixa', async ({ page }) => {
  await seed(true);
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Patrimônio de investimentos' })).toBeVisible();
  await expect(page.locator('article').filter({ hasText: 'Patrimônio atual' })
    .getByText('R$ 1.100,00')).toBeVisible();
  await page.getByText('Relatórios', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patrimônio de investimentos' })).toBeVisible();
  await expect(page.getByText('Principal resgatado')).toBeVisible();
  await expect(page.getByText('Renda de investimento')).toBeVisible();
  await expect(page.getByText('Não classificado')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evolução patrimonial' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Gráficos' }).click();
  await expect(page.getByRole('heading', { name: 'Evolução patrimonial' })).toBeVisible();
});

test('pedido de resgate pendente pode ser cancelado sem tocar caixa nem posição', async ({ page }) => {
  await seed(true);
  await seedCatalog();
  await login(page);
  await expect(page.getByRole('heading', { name: 'Patrimônio e investimentos' })).toBeVisible();

  // Aporte pela interface, exclusivamente via callable.
  await page.getByRole('button', { name: 'Novo aporte' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByLabel('Conta').selectOption({ label: 'Corretora E2E' });
  await page.getByRole('dialog').getByLabel('Ativo').selectOption({ label: 'CDB E2E' });
  await page.getByLabel('Descrição').fill('Aporte E2E');
  await page.getByLabel('Valor principal (R$)').fill('1000');
  await page.getByLabel('Quantidade').fill('1');
  await page.getByRole('button', { name: 'Confirmar aporte' }).click();
  await expect(page.getByText('Operação concluída com sucesso.')).toBeVisible();

  // Solicita resgate parcial a partir da posição.
  await page.getByRole('tab', { name: 'Ativos e posições' }).click();
  await expect(page.getByRole('button', { name: 'Resgatar' })).toBeVisible();
  await page.getByRole('button', { name: 'Resgatar' }).click();
  await page.getByLabel('Principal a resgatar (R$)').fill('400');
  await page.getByLabel('Quantidade a resgatar').fill('0.4');
  await page.getByRole('button', { name: 'Solicitar resgate' }).click();
  await expect(page.getByText('Operação concluída com sucesso.')).toBeVisible();

  const db = firebaseAdmin().firestore();
  const readPosition = async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_positions`).get()
  ).docs[0]?.data();
  // O pedido pendente não pode ter alterado o principal da posição.
  await expect.poll(async () => (await readPosition())?.principalCents ?? 0).toBe(100_000);
  const positionBefore = await readPosition();

  // O pendente aparece como tal e oferece cancelamento.
  await page.getByRole('tab', { name: 'Movimentações' }).click();
  const pending = page.locator('article').filter({ hasText: 'Resgate de investimento' });
  await expect(pending).toContainText('Pendente');
  await expect(pending.getByRole('button', { name: 'Liquidar' })).toBeVisible();
  await pending.getByRole('button', { name: 'Cancelar pedido' }).click();
  await page.getByLabel('Motivo do cancelamento').fill('Pedido desfeito no teste E2E');
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.getByText('Operação concluída com sucesso.')).toBeVisible();

  // Passa a exibir Cancelada e deixa de oferecer liquidação.
  const cancelled = page.locator('article').filter({ hasText: 'Resgate de investimento' });
  await expect(cancelled).toContainText('Cancelada');
  await expect(cancelled.getByRole('button', { name: 'Liquidar' })).toHaveCount(0);
  await expect(cancelled.getByRole('button', { name: 'Cancelar pedido' })).toHaveCount(0);

  // Nem caixa, nem posição, nem meta foram tocados pelo cancelamento.
  const positionAfter = await readPosition();
  expect(positionAfter?.principalCents).toBe(positionBefore?.principalCents);
  expect(positionAfter?.version).toBe(positionBefore?.version);
  const movement = (await db.collection(`workspaces/${WORKSPACE}/investment_movements`)
    .where('operation', '==', 'redemption').get()).docs[0].data();
  expect(movement.status).toBe('cancelled');
  expect(movement.cashDeltaCents).toBe(0);
  expect(movement.principalDeltaCents).toBe(0);
  expect(movement.cancellationReason).toBe('Pedido desfeito no teste E2E');

  // O filtro de canceladas encontra o registro preservado.
  await page.getByLabel('Situação').selectOption('cancelled');
  await expect(page.locator('article').filter({ hasText: 'Resgate de investimento' })).toBeVisible();
  await page.getByLabel('Situação').selectOption('pending');
  await expect(page.getByText('Nenhuma movimentação encontrada para estes filtros.')).toBeVisible();
});

/** Login sem navegar para Investimentos: o lançamento global fica no painel. */
const loginToDashboard = async (page: import('@playwright/test').Page) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
};

test('o lançamento de transação não oferece investimento', async ({ page }) => {
  // O patrimônio é o ledger, e é ele que projeta o espelho de caixa. Um aporte
  // lançado como transação sairia do caixa e nunca chegaria ao patrimônio — as
  // Rules recusam a escrita, e a interface não a oferece.
  await seed(true);
  await loginToDashboard(page);
  await page.getByRole('button', { name: 'Nova Transação' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await expect(page.getByRole('button', { name: 'Receita', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Despesa', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Investimento', exact: true })).toHaveCount(0);
});

// INV-P1-007 — valoração pelo produto. Sem esta superfície, nenhuma posição
// recebia preço: patrimônio era sempre igual a custo e o ganho não realizado
// ficava estruturalmente zero.
test('valoração pela tela separa patrimônio de custo e gera ganho não realizado', async ({ page }) => {
  await seed(true);
  await seedCatalog();
  // O resumo semeado por `seed(true)` descreve outro cenário. Este teste
  // exercita o efeito **da valoração** sobre o resumo, então parte do zero.
  await firebaseAdmin().firestore()
    .doc(`workspaces/${WORKSPACE}/investment_summaries/current`).delete();
  await login(page);
  await expect(page.getByRole('heading', { name: 'Patrimônio e investimentos' })).toBeVisible();

  await page.getByRole('button', { name: 'Novo aporte' }).click();
  await page.getByRole('dialog').getByLabel('Conta').selectOption({ label: 'Corretora E2E' });
  await page.getByRole('dialog').getByLabel('Ativo').selectOption({ label: 'CDB E2E' });
  await page.getByLabel('Descrição').fill('Aporte para valorar');
  await page.getByLabel('Valor principal (R$)').fill('1000');
  await page.getByLabel('Quantidade').fill('100');
  await page.getByRole('button', { name: 'Confirmar aporte' }).click();
  await expect(page.getByText('Operação concluída com sucesso.')).toBeVisible();

  const db = firebaseAdmin().firestore();
  const readPosition = async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_positions`).get()
  ).docs[0]?.data();

  // Antes da valoração, patrimônio e custo coincidem por construção.
  await expect.poll(async () => (await readPosition())?.currentValueCents ?? 0).toBe(100_000);

  await page.getByRole('tab', { name: 'Ativos e posições' }).click();
  await page.getByRole('button', { name: 'Valorar' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Preço unitário (R$)').fill('12');
  await page.getByRole('button', { name: 'Registrar valoração' }).click();
  await expect(page.getByText('Operação concluída com sucesso.')).toBeVisible();

  // 100 unidades a R$ 12,00 = R$ 1.200,00 de patrimônio sobre R$ 1.000,00 de custo.
  await expect.poll(async () => (await readPosition())?.currentValueCents ?? 0).toBe(120_000);
  await expect.poll(async () => (await readPosition())?.principalCents ?? 0).toBe(100_000);
  await expect.poll(async () => (await readPosition())?.unrealizedAppreciationCents ?? 0).toBe(20_000);

  // Valoração não gera caixa: nenhum espelho novo em `transactions`.
  const mirrors = await db.collection(`workspaces/${WORKSPACE}/transactions`).get();
  expect(mirrors.size).toBe(1);

  // E o resumo passa a distinguir patrimônio de custo na tela.
  await page.getByRole('tab', { name: 'Resumo' }).click();
  await expect(page.locator('article').filter({ hasText: 'Valorização não realizada' })
    .getByText('R$ 200,00')).toBeVisible();
});

// INV-P1-004 — duplo clique em "Confirmar aporte" precisa gerar **um** fato
// financeiro. A chave de idempotência deriva da intenção aberta, não do clique.
test('duplo clique em Confirmar aporte cria um único movimento', async ({ page }) => {
  await seed(true);
  await seedCatalog();
  await login(page);
  await expect(page.getByRole('heading', { name: 'Patrimônio e investimentos' })).toBeVisible();

  await page.getByRole('button', { name: 'Novo aporte' }).click();
  await page.getByRole('dialog').getByLabel('Conta').selectOption({ label: 'Corretora E2E' });
  await page.getByRole('dialog').getByLabel('Ativo').selectOption({ label: 'CDB E2E' });
  await page.getByLabel('Descrição').fill('Aporte com duplo clique');
  await page.getByLabel('Valor principal (R$)').fill('750');
  await page.getByLabel('Quantidade').fill('7.5');

  /*
   * Dois cliques no **mesmo tick**, antes de qualquer re-render.
   *
   * Nem `click()` nem `dispatchEvent()` servem aqui, e a razão é a própria
   * trava sendo testada: no primeiro clique o botão fica desabilitado e muda o
   * rótulo para "Processando…", então o segundo comando não reencontra o
   * locator e o teste esgota o tempo sem nunca exercitar a corrida.
   *
   * Resolver o elemento uma vez e disparar os dois cliques dentro da própria
   * página reproduz exatamente o duplo clique do usuário: os dois eventos
   * chegam ao manipulador antes de o React commitar o estado.
   */
  const confirm = await page
    .getByRole('button', { name: 'Confirmar aporte' })
    .elementHandle();
  assert.ok(confirm, 'O botão de confirmação precisa existir.');
  await confirm.evaluate((node) => {
    (node as HTMLButtonElement).click();
    (node as HTMLButtonElement).click();
  });
  await expect(page.getByText('Operação concluída com sucesso.')).toBeVisible();

  const db = firebaseAdmin().firestore();
  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_movements`)
      .where('operation', '==', 'contribution').get()
  ).size).toBe(1);
  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_positions`).get()
  ).docs[0]?.data()?.principalCents).toBe(75_000);
});

// INV-P1-008 — o diagnóstico de alocação vive na tela patrimonial e lê os
// cortes que o backend calcula, não categorias de transação.
test('alocação PF aparece na tela patrimonial', async ({ page }) => {
  await seed(true);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Patrimônio e investimentos' })).toBeVisible();

  await page.getByRole('tab', { name: 'Alocação' }).click();
  await expect(page.getByRole('heading', { name: 'Diagnóstico de alocação' })).toBeVisible();
  await expect(page.getByText('Por finalidade')).toBeVisible();
  await expect(page.getByText('Por meta')).toBeVisible();
  await expect(page.getByText('Por classe')).toBeVisible();
  await expect(page.getByText('Por liquidez')).toBeVisible();
  // A faixa vem do resumo oficial de alocação, não de `transactions`.
  await expect(page.getByText('Não classificado', { exact: true })).toBeVisible();
  // Investimento sem meta não é presumido como aposentadoria: a palavra só
  // aparece no texto explicativo da dimensão, nunca como faixa com valor.
  await expect(page.getByText('Aposentadoria', { exact: true })).toHaveCount(0);
});
