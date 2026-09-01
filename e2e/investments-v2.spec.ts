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

/**
 * Catálogo mínimo do fluxo simples: carteira, instituição e categoria.
 *
 * Instituições não são semeadas pelo onboarding — o produto espera que o
 * workspace cadastre as suas —, então o teste cria as três por administração.
 */
const SIMPLE_CLASS = 'e2e-class-reserva';
const SIMPLE_INSTITUTION = 'e2e-institution-btg';
const SIMPLE_TYPE = 'e2e-type-renda-fixa';

const seedSimpleCatalog = async () => {
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  const now = sdk.firestore.Timestamp.now();
  const item = (id: string, group: string, name: string, normalizedName: string) => ({
    id, workspaceId: WORKSPACE, group, name, normalizedName,
    dedupeKey: `${group}::all::both::${normalizedName}`,
    workspaceScope: 'both', sortOrder: 1, status: 'active',
    createdBy: UID, updatedBy: UID, createdAt: now, updatedAt: now,
  });
  await Promise.all([
    db.doc(`workspaces/${WORKSPACE}/settings_catalog/${SIMPLE_CLASS}`)
      .set(item(SIMPLE_CLASS, 'investment_class', 'Reserva de emergência', 'reserva de emergencia')),
    db.doc(`workspaces/${WORKSPACE}/settings_catalog/${SIMPLE_INSTITUTION}`)
      .set(item(SIMPLE_INSTITUTION, 'investment_institution', 'BTG', 'btg')),
    db.doc(`workspaces/${WORKSPACE}/settings_catalog/${SIMPLE_TYPE}`)
      .set(item(SIMPLE_TYPE, 'investment_type', 'Renda fixa', 'renda fixa')),
  ]);
};

/** Preenche o formulário simples de "Novo investimento". */
const novoInvestimento = async (
  page: import('@playwright/test').Page,
  descricao: string,
  valor: string,
) => {
  await page.getByRole('button', { name: 'Novo investimento' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel('Carteira').selectOption(SIMPLE_CLASS);
  await dialogo.getByLabel('Instituição').selectOption(SIMPLE_INSTITUTION);
  await dialogo.getByLabel('Descrição').fill(descricao);
  await dialogo.getByLabel('Categoria').selectOption(SIMPLE_TYPE);
  await dialogo.getByLabel('Valor do investimento').fill(valor);
  return dialogo;
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
  await expect(page.getByRole('heading', { name: 'Investimentos' })).toBeVisible();
  // A tela legada de transações nunca mais responde por investimento.
  await expect(page.getByRole('button', { name: 'Nova Transação' })).toHaveCount(0);
  // E a tela profissional deixou de ser o que o usuário comum encontra.
  await expect(page.getByRole('tab', { name: 'Contas' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Ativos e posições' })).toHaveCount(0);
});

test('a tela de investimentos é responsiva e não expõe cadastro técnico', async ({ page }) => {
  await seed(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Investimentos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo investimento' })).toBeVisible();
  // Nenhum termo técnico do domínio na navegação comum.
  for (const termo of ['Quantidade', 'Preço unitário', 'Valorar', 'Reconstruir']) {
    await expect(page.getByText(termo, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('columnheader', { name: 'Descrição' })).toBeVisible();
});

test('o dashboard mostra o mês e o relatório separa aporte de retirada', async ({ page }) => {
  /*
   * Etapa 3, §3.B e §4.
   *
   * O Dashboard voltou a ser o do baseline: quatro cards do mês, sem painel
   * patrimonial. O relatório é onde patrimônio, aporte e retirada aparecem —
   * separados, e sem a taxonomia profissional que o ZIP não tinha.
   */
  await seed(true);
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });

  // O card de Investimentos do baseline continua lá, e o painel patrimonial
  // profissional não — nem o aviso de falha que ele exibia.
  await expect(page.getByText('Investimentos', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Patrimônio de investimentos' })).toHaveCount(0);
  await expect(page.getByText('Não foi possível carregar o resumo patrimonial')).toHaveCount(0);
  await expect(page.getByText('Custo atual', { exact: true })).toHaveCount(0);

  await page.getByText('Relatórios', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patrimônio de investimentos' })).toBeVisible();
  await expect(page.locator('article').filter({ hasText: 'Patrimônio atual' })
    .getByText('R$ 1.100,00')).toBeVisible();
  await expect(page.getByText('Aportes', { exact: true })).toBeVisible();
  await expect(page.getByText('Retiradas', { exact: true })).toBeVisible();

  // Taxonomia profissional não voltou ao relatório (§4.B).
  for (const termo of [
    'Ganho não realizado', 'Renda de investimento', 'Resgate líquido',
    'Por risco', 'Por liquidez', 'Por indexador', 'Por finalidade',
  ]) {
    await expect(page.getByText(termo, { exact: true })).toHaveCount(0);
  }

  await expect(page.getByRole('heading', { name: 'Evolução patrimonial' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Gráficos' }).click();
  await expect(page.getByRole('heading', { name: 'Evolução patrimonial' })).toBeVisible();
});

test('retirada pendente pode ser cancelada sem tocar caixa nem posição', async ({ page }) => {
  /*
   * O mesmo invariante que a tela profissional protegia, agora pelo fluxo
   * simples: um pedido pendente não move nada, cancelá-lo continua não movendo
   * nada, e o registro é preservado em vez de apagado.
   */
  await seed(false);
  await seedSimpleCatalog();
  await login(page);

  const dialogo = await novoInvestimento(page, 'CDB para retirar', '100000');
  await dialogo.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialogo).toHaveCount(0);

  const db = firebaseAdmin().firestore();
  const readPosition = async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_positions`).get()
  ).docs[0]?.data();
  await expect.poll(async () => (await readPosition())?.principalCents ?? 0).toBe(100_000);
  const positionBefore = await readPosition();

  // Retirada ainda não recebida: pedido, não fato.
  const aporte = page.getByRole('row').filter({ hasText: 'CDB para retirar' });
  await aporte.getByRole('button', { name: /Retirar investimento/ }).click();
  const retirada = page.getByRole('dialog');
  await retirada.getByLabel('Valor da retirada').fill('40000');
  await retirada.getByRole('radio', { name: 'Não' }).check();
  await retirada.getByRole('button', { name: 'Confirmar retirada' }).click();
  await expect(retirada).toHaveCount(0);

  const linha = page.getByRole('row').filter({ hasText: 'Retirada' });
  await expect(linha.getByText('Aguardando recebimento', { exact: true })).toBeVisible();
  // O pedido pendente não pode ter alterado o capital da posição.
  expect((await readPosition())?.principalCents).toBe(positionBefore?.principalCents);

  await linha.getByRole('button', { name: /Cancelar lançamento/ }).click();
  const confirmacao = page.getByRole('dialog');
  await confirmacao.getByRole('button', { name: 'Cancelar lançamento' }).click();
  await expect(confirmacao).toHaveCount(0);

  await expect(linha.getByText('Cancelado', { exact: true })).toBeVisible();
  await expect(linha.getByRole('button', { name: /Confirmar recebimento/ })).toHaveCount(0);

  // Nem caixa, nem posição foram tocados; o movimento continua gravado.
  const positionAfter = await readPosition();
  expect(positionAfter?.principalCents).toBe(positionBefore?.principalCents);
  expect(positionAfter?.version).toBe(positionBefore?.version);
  const movement = (await db.collection(`workspaces/${WORKSPACE}/investment_movements`)
    .where('operation', '==', 'redemption').get()).docs[0].data();
  expect(movement.status).toBe('cancelled');
  expect(movement.cashDeltaCents).toBe(0);
  expect(movement.principalDeltaCents).toBe(0);
  expect(typeof movement.cancellationReason).toBe('string');
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

// INV-P1-007 — valoração pelo produto.
//
// A Etapa 3 fecha a decisão do §1: valoração a mercado, posição técnica e
// ganho não realizado não têm superfície na navegação comum. O roteiro de
// interface que existia aqui não descreve mais um caminho executável — foi
// substituído pelo teste da experiência final, abaixo, e o invariante
// financeiro que ele protegia (patrimônio separado do custo, com ganho não
// realizado) continua coberto de ponta a ponta em
// `functions/src/investments/__tests__/m3Lifecycle.integration.test.ts`.
test('valoração a mercado não tem superfície na experiência comum', async ({ page }) => {
  await seed(true);
  await seedCatalog();
  await login(page);
  await expect(page.getByRole('heading', { name: 'Investimentos' })).toBeVisible();

  for (const termo of [
    'Valorar', 'Preço unitário (R$)', 'Registrar valoração',
    'Valorização não realizada', 'Quantidade',
  ]) {
    await expect(page.getByText(termo, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('tab', { name: 'Ativos e posições' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Resumo' })).toHaveCount(0);

  // E o relatório também não expõe ganho não realizado para investimento
  // simples, que nunca recebe preço.
  await page.getByText('Relatórios', { exact: true }).click();
  await expect(page.getByText('Ganho não realizado', { exact: true })).toHaveCount(0);
});

// INV-P1-004 — duplo clique em "Confirmar aporte" precisa gerar **um** fato
// financeiro. A chave de idempotência deriva da intenção aberta, não do clique.
test('duplo clique em Salvar cria um único investimento', async ({ page }) => {
  await seed(false);
  await seedSimpleCatalog();
  await login(page);

  const dialogo = await novoInvestimento(page, 'Aporte com duplo clique', '75000');

  /*
   * Dois cliques no **mesmo tick**, antes de qualquer re-render.
   *
   * Nem `click()` nem `dispatchEvent()` servem aqui, e a razão é a própria
   * trava sendo testada: no primeiro clique o botão fica desabilitado e muda o
   * rótulo para "Salvando...", então o segundo comando não reencontra o
   * locator e o teste esgota o tempo sem nunca exercitar a corrida.
   *
   * Resolver o elemento uma vez e disparar os dois cliques dentro da própria
   * página reproduz exatamente o duplo clique do usuário: os dois eventos
   * chegam ao manipulador antes de o React commitar o estado. A garantia real
   * não é o `disabled` — é a chave de idempotência derivada da intenção.
   */
  const salvar = await dialogo.getByRole('button', { name: 'Salvar' }).elementHandle();
  assert.ok(salvar, 'O botão de salvar precisa existir.');
  await salvar.evaluate((node) => {
    (node as HTMLButtonElement).click();
    (node as HTMLButtonElement).click();
  });
  await expect(dialogo).toHaveCount(0);

  const db = firebaseAdmin().firestore();
  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_movements`)
      .where('operation', '==', 'contribution').get()
  ).size).toBe(1);
  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_positions`).get()
  ).docs[0]?.data()?.principalCents).toBe(75_000);
});

// INV-P1-008 — o diagnóstico de alocação lê os cortes que o backend calcula,
// não categorias de transação. A Etapa 3 o remonta na tela de Investimentos,
// no lugar que o baseline usava: acima dos cards por meta.
test('a faixa de alocação PF aparece na tela e distribui pelas carteiras', async ({ page }) => {
  await seed(true);
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  const now = sdk.firestore.Timestamp.now();
  const corte = (
    id: string, dimension: string, key: string, label: string, cents: number,
  ) => db.doc(`workspaces/${WORKSPACE}/investment_allocation_summaries/${id}`).set({
    id, workspaceId: WORKSPACE, profileType: 'PF', currency: 'BRL',
    dimension, key, label, positionCount: 1,
    principalCents: cents, currentValueCents: cents,
    realizedGainCents: 0, feesCents: 0, taxCents: 0,
    updatedAt: now, updatedBy: UID,
  });
  await Promise.all([
    corte('class-reserva', 'class', 'cls-reserva', 'Reserva de emergência', 66_000),
    corte('class-aposentadoria', 'class', 'cls-aposentadoria', 'Aposentadoria', 44_000),
    corte('goal-unassigned', 'goal', 'unassigned', 'Sem meta', 110_000),
  ]);

  await login(page);
  await expect(page.getByRole('heading', { name: 'Investimentos' })).toBeVisible();

  const faixa = page.getByRole('region', { name: 'Distribuição dos investimentos' });
  await expect(faixa).toBeVisible();
  await expect(faixa.getByText('Reserva de emergência')).toBeVisible();
  await expect(faixa.getByText('Aposentadoria')).toBeVisible();
  // 66.000 de 110.000 = 60,0%; a porcentagem sai do resumo autoritativo.
  await expect(faixa.getByText('60.0%')).toBeVisible();

  // Investimento sem meta continua sendo "Sem meta" — nunca aposentadoria
  // presumida, como o baseline fazia.
  await expect(faixa.getByText('Sem meta')).toBeVisible();

  // E nenhuma aba profissional voltou junto com a faixa.
  await expect(page.getByRole('tab', { name: 'Alocação' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Diagnóstico de alocação' })).toHaveCount(0);

  // A alocação PJ não aparece num workspace PF.
  await expect(
    page.getByRole('heading', { name: 'Alocação do capital da empresa' }),
  ).toHaveCount(0);
});
