import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');

/**
 * Smoke de regressão do produto inteiro.
 *
 * A unificação do domínio de investimentos tocou Rules, leitura de transações,
 * projeções, relatórios, metas e cadastro. O que este smoke prova é que
 * **nenhuma superfície do produto quebrou** — inclusive as que não têm nada a
 * ver com investimentos, como recorrências, cartões e carteiras.
 *
 * Cada percurso é raso de propósito: profundidade é papel das suítes de
 * domínio. Aqui o que se verifica é que a tela monta, carrega dados e não
 * apresenta erro.
 */

const PROJECT = 'minhas-financas-local';
const PASSWORD = 'e2e-regression-smoke-password';

interface Persona {
  uid: string;
  email: string;
  workspace: string;
  type: 'PF' | 'PJ';
}

const PF: Persona = {
  uid: 'e2e-smoke-pf-owner',
  email: 'e2e-smoke-pf@minhas-financas.local',
  workspace: 'e2e-smoke-pf-workspace',
  type: 'PF',
};

const PJ: Persona = {
  uid: 'e2e-smoke-pj-owner',
  email: 'e2e-smoke-pj@minhas-financas.local',
  workspace: 'e2e-smoke-pj-workspace',
  type: 'PJ',
};

const firebaseAdmin = () => {
  process.env.GCLOUD_PROJECT = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  return admin;
};

/**
 * Semeia um workspace com um exemplar de cada tipo de lançamento, mais um
 * segundo workspace do mesmo dono, para exercitar a troca de workspace.
 */
const seed = async (persona: Persona) => {
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  const secondWorkspace = `${persona.workspace}-secundario`;
  const isPJ = persona.type === 'PJ';

  await Promise.all([
    db.recursiveDelete(db.doc(`workspaces/${persona.workspace}`)),
    db.recursiveDelete(db.doc(`workspaces/${secondWorkspace}`)),
  ]);
  try { await sdk.auth().deleteUser(persona.uid); } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  await sdk.auth().createUser({
    uid: persona.uid, email: persona.email, password: PASSWORD, emailVerified: true,
  });

  const now = sdk.firestore.Timestamp.now();
  const at = (iso: string) => sdk.firestore.Timestamp.fromDate(new Date(iso));
  const today = new Date().toISOString().slice(0, 10);

  const base = {
    userId: persona.uid,
    workspaceId: persona.workspace,
    profileId: persona.workspace,
    isPaid: true,
    createdAt: now,
    updatedAt: now,
  };

  await Promise.all([
    db.doc(`workspaces/${persona.workspace}`).set({
      ownerId: persona.uid,
      name: persona.type === 'PJ' ? 'Empresa Smoke' : 'Pessoal Smoke',
      type: persona.type,
      currency: 'BRL',
      createdAt: now,
      updatedAt: now,
    }),
    db.doc(`workspaces/${persona.workspace}/members/${persona.uid}`).set({
      uid: persona.uid, role: 'owner', status: 'active',
    }),
    db.doc(`users/${persona.uid}/workspaces/${persona.workspace}`).set({
      workspaceId: persona.workspace, role: 'owner',
    }),

    // Segundo workspace, para a troca.
    db.doc(`workspaces/${secondWorkspace}`).set({
      // Sempre PJ: a troca de workspace passa a exercitar também a virada de
      // perfil — rótulos, painéis e leituras mudam entre PF e PJ.
      ownerId: persona.uid, name: 'Segundo Workspace', type: 'PJ',
      currency: 'BRL', createdAt: now, updatedAt: now,
    }),
    db.doc(`workspaces/${secondWorkspace}/members/${persona.uid}`).set({
      uid: persona.uid, role: 'owner', status: 'active',
    }),
    db.doc(`users/${persona.uid}/workspaces/${secondWorkspace}`).set({
      workspaceId: secondWorkspace, role: 'owner',
    }),

    // Receita, despesa e parcelada: os três tipos do fluxo de caixa legado.
    db.doc(`workspaces/${persona.workspace}/transactions/smoke-receita`).set({
      ...base, type: 'receita', description: 'Receita do smoke',
      category: 'Salário', value: 5000, date: today, transactionDate: now,
    }),
    db.doc(`workspaces/${persona.workspace}/transactions/smoke-despesa`).set({
      ...base, type: 'despesa', description: 'Despesa do smoke',
      category: 'Alimentação', value: 250, date: today, transactionDate: now,
    }),
    db.doc(`workspaces/${persona.workspace}/transactions/smoke-parcelado`).set({
      ...base, type: 'parcelado', description: 'Compra parcelada do smoke',
      category: 'Eletrônicos', value: 300, date: today, transactionDate: now,
      installments: 3, currentInstallment: 1,
    }),

    // Recorrência.
    db.doc(`workspaces/${persona.workspace}/recurring_expenses/smoke-recorrencia`).set({
      id: 'smoke-recorrencia', workspaceId: persona.workspace,
      nome: 'Assinatura do smoke', tipo: 'assinatura',
      valorPadrao: 49.9, moeda: 'BRL', periodo: 'mensal', diaCobranca: 10,
      dataInicio: today, metodoPagamento: 'pix',
      gerarDespesaAutomaticamente: false,
      corPrincipal: '#6366f1', icone: 'Repeat', status: 'ativo',
      ...(isPJ ? {tipoEmpresa: 'SaaS' as const, fornecedor: 'Fornecedor do smoke'} : {}),
      createdAt: now, updatedAt: now,
    }),

    // Cartão.
    db.doc(`workspaces/${persona.workspace}/credit_cards/smoke-cartao`).set({
      id: 'smoke-cartao', workspaceId: persona.workspace, name: 'Cartão do smoke',
      brand: 'visa', limitAmount: 5000, closingDay: 10, dueDay: 20,
      status: 'active', createdAt: now, updatedAt: now,
    }),

    // Meta.
    db.doc(`workspaces/${persona.workspace}/goals/smoke-meta`).set({
      id: 'smoke-meta', workspaceId: persona.workspace, name: 'Meta do smoke',
      targetAmount: 10000, currentAmount: 1000, currentAmountCents: 100_000,
      netContributionCents: 100_000, progressBasis: 'net_contributions',
      investmentNetContributionCents: 0, investmentProgressCents: 0,
      status: 'em_andamento', archived: false,
      // Campos obrigatórios do contrato de meta — o cartão os renderiza direto.
      category: isPJ ? 'patrimonio' : 'reserva_emergencia',
      priority: 'alta', horizon: 'medio',
      ...(isPJ ? {businessType: 'caixa_minimo' as const, period: 'mensal' as const} : {}),
      startDate: today, deadline: '2027-12-31',
      visual: { color: '#6366f1', icon: 'Target', emoji: '🎯', progressBarType: 'linear' },
      createdAt: now, updatedAt: now,
    }),

    // Carteira, no catálogo de cadastros.
    db.doc(`workspaces/${persona.workspace}/settings_catalog/smoke-carteira`).set({
      workspaceId: persona.workspace, group: 'wallet', name: 'Carteira do smoke',
      normalizedName: 'carteira do smoke',
      dedupeKey: `${persona.workspace}|wallet|carteira do smoke`,
      workspaceScope: persona.type, sortOrder: 1, status: 'active',
      createdBy: persona.uid, updatedBy: persona.uid, createdAt: now, updatedAt: now,
    }),

    // Projeção mensal de caixa, mantida pelo gatilho em produção.
    db.doc(`workspaces/${persona.workspace}/cash_report_periods/${today.slice(0, 7)}`).set({
      id: today.slice(0, 7), workspaceId: persona.workspace,
      period: today.slice(0, 7), periodStart: at(`${today.slice(0, 7)}-01T03:00:00.000Z`),
      incomeCents: 500_000, expenseCents: 55_000, investmentOutflowCents: 0,
      netCents: 445_000, transactionCount: 3, updatedAt: now,
    }),
  ]);

  await Promise.all([
      db.doc(`workspaces/${persona.workspace}/investment_summaries/current`).set({
        id: 'current', workspaceId: persona.workspace, profileType: persona.type,
        currency: 'BRL', positionCount: 1, principalCents: 200_000,
        currentValueCents: 220_000, realizedGainCents: 0, realizedLossCents: 0,
        feesCents: 0, taxCents: 0, unrealizedAppreciationCents: 20_000,
        updatedAt: now, updatedBy: persona.uid,
      }),
      db.doc(`workspaces/${persona.workspace}/investment_allocation_summaries/purpose-unassigned`).set({
        id: 'purpose-unassigned', workspaceId: persona.workspace,
        profileType: persona.type, currency: 'BRL', dimension: 'purpose',
        key: 'unassigned', label: 'Não classificado', positionCount: 1,
        principalCents: 200_000, currentValueCents: 220_000,
        realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0,
        updatedAt: now, updatedBy: persona.uid,
      }),
      db.doc(`workspaces/${persona.workspace}/investment_report_periods/${today.slice(0, 7)}`).set({
        id: today.slice(0, 7), workspaceId: persona.workspace,
        profileType: persona.type, currency: 'BRL', period: today.slice(0, 7),
        periodStart: at(`${today.slice(0, 7)}-01T03:00:00.000Z`),
        contributionCents: 200_000, redemptionPrincipalCents: 0,
        realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0,
        costDeltaCents: 200_000, currentValueDeltaCents: 220_000,
        cashDeltaCents: -200_000, settledMovementCount: 1,
        closingCurrentValueCents: 220_000, updatedAt: now, updatedBy: persona.uid,
      }),
  ]);
};

/**
 * Exceções não capturadas por página, por teste.
 *
 * Uma falha de renderização em React desmonta a árvore e deixa a tela em
 * branco: sem isto, a asserção seguinte falharia com "element(s) not found" e
 * esconderia a causa real.
 */
const pageErrors = new WeakMap<import('@playwright/test').Page, string[]>();

const login = async (page: import('@playwright/test').Page, persona: Persona) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => { errors.push(error.message); });
  await page.goto(`/?e2eEmail=${encodeURIComponent(persona.email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
};

/** Falhas de renderização aparecem como `role="alert"`; nenhuma é esperada. */
const expectNoPageError = (page: import('@playwright/test').Page) => {
  const errors = pageErrors.get(page) ?? [];
  expect(errors, `Exceção não capturada na página: ${errors.join(' | ')}`).toEqual([]);
};

/**
 * Abre uma área pelo menu e confere que a renderização não quebrou.
 *
 * A verificação vem **antes** de qualquer asserção de conteúdo: uma exceção em
 * React desmonta a árvore e deixa a tela em branco, e sem isto o teste
 * reportaria apenas "element(s) not found".
 */
const openSection = async (page: import('@playwright/test').Page, label: string) => {
  await page.getByText(label, { exact: true }).first().click();
  expectNoPageError(page);
};

const expectNoErrorBanner = async (page: import('@playwright/test').Page) => {
  expectNoPageError(page);

  const alerts = page.getByRole('alert');
  const count = await alerts.count();
  for (let index = 0; index < count; index += 1) {
    const text = (await alerts.nth(index).innerText()).toLowerCase();
    expect(
      text.includes('não foi possível') || text.includes('erro'),
      `Alerta de erro visível: ${text}`,
    ).toBe(false);
  }
};

const walkSurfaces = async (
  page: import('@playwright/test').Page,
  persona: Persona,
) => {
  const isPJ = persona.type === 'PJ';

  // Dashboard: receita, despesa e parcelada chegam pela leitura paginada.
  await expect(page.getByText('Receitas').first()).toBeVisible();
  await expect(page.getByText('Despesas').first()).toBeVisible();
  await expect(page.getByText('Receita do smoke').first()).toBeVisible();
  await expect(page.getByText('Despesa do smoke').first()).toBeVisible();
  await expect(page.getByText('Compra parcelada do smoke').first()).toBeVisible();
  await expectNoErrorBanner(page);

  /*
   * Investimentos: um domínio só, agora com a experiência simples na frente.
   *
   * A tela vale para PF e PJ sem ramo próprio — o que muda entre os dois é o
   * catálogo de carteiras, não a composição da página.
   */
  await openSection(page, 'Investimentos');
  await expect(page.getByRole('heading', { name: 'Investimentos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo investimento' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Descrição' })).toBeVisible();
  await expectNoErrorBanner(page);

  // Metas.
  await openSection(page, isPJ ? 'Metas Empresariais' : 'Metas');
  await expect(page.getByText('Meta do smoke')).toBeVisible();
  await expectNoErrorBanner(page);

  // Cartões.
  await openSection(page, isPJ ? 'Cartões Corporativos' : 'Cartões de Crédito');
  await expect(page.getByText('Cartão do smoke')).toBeVisible();
  await expectNoErrorBanner(page);

  // Recorrências.
  await openSection(page, isPJ ? 'Contratos & Recorrências' : 'Assinaturas');
  await expect(page.getByText('Assinatura do smoke')).toBeVisible();
  await expectNoErrorBanner(page);

  // Relatórios, incluindo a faixa "tudo", que carrega o histórico completo.
  await openSection(page, isPJ ? 'Relatórios Empresariais' : 'Relatórios');
  await expect(page.getByText(isPJ ? 'Faturamento' : 'Receita Total').first()).toBeVisible();
  await expectNoErrorBanner(page);

  // Configurações e cadastros, incluindo carteiras.
  await openSection(page, 'Configurações');
  await page.getByRole('heading', { name: 'Cadastros', exact: true }).click();
  await expect(page.getByText('Produtos e Serviços')).toBeVisible();
  await page.getByText('Carteiras', { exact: true }).first().click();
  await expect(page.getByText('Carteira do smoke').first()).toBeVisible();
  await expectNoErrorBanner(page);

  // Volta ao painel: a navegação inteira permanece funcional.
  await openSection(page, 'Dashboard');
  await expect(page.getByText('Saldo Atual')).toBeVisible();
  await expectNoErrorBanner(page);
};

for (const persona of [PF, PJ]) {
  test(`smoke ${persona.type}`, async ({ page }) => {
    await seed(persona);
    await login(page, persona);
    await walkSurfaces(page, persona);
  });
}

test('troca de workspace mantém o produto funcional', async ({ page }) => {
  await seed(PF);
  await login(page, PF);

  // O workspace ativo é o pessoal, com os lançamentos semeados.
  await expect(page.getByText('Receita do smoke').first()).toBeVisible();

  await page.getByText('Olá, Usuário').click();
  await expect(page.getByText('Perfis Financeiros')).toBeVisible();

  // Troca para o segundo workspace, que é PJ e não tem lançamento nenhum: o
  // produto precisa virar de perfil e lidar com o estado vazio sem erro — a
  // regressão clássica das leituras paginadas.
  await page.getByRole('button', {name: 'Segundo Workspace'}).click();
  await expect(page.getByText('Finanças da Empresa')).toBeVisible();
  await expect(page.getByText('Saldo Atual')).toBeVisible();
  await expect(page.getByText('Receita do smoke')).toHaveCount(0);
  await expectNoErrorBanner(page);

  // E volta, com o histórico do workspace pessoal intacto.
  await page.getByText('Olá, Usuário').click();
  await page.getByRole('button', {name: 'Pessoal', exact: true}).click();
  await expect(page.getByText('Receita do smoke').first()).toBeVisible();
  await expectNoErrorBanner(page);
});
