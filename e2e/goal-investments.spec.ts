import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';

/**
 * Integração final entre Metas e Investimentos (Etapa 3, §2, §11 e §12).
 *
 * Percorre o roteiro PF em runtime: abrir a meta, aportar de dentro dela com a
 * meta já travada, confirmar o depósito, vincular retroativamente um
 * investimento que nasceu sem meta, remover o vínculo, retirar e confirmar o
 * recebimento.
 *
 * A cada passo o teste confere o **ledger e o progresso publicado**, não só a
 * tela: uma meta que mostra progresso sem movimento liquidado é pior que uma
 * que não mostra nada. E confere o que **não** pode acontecer — aporte não vira
 * despesa, resgate não vira receita operacional, pendente não move nada.
 */

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');

const PROJECT = 'minhas-financas-local';
const UID = 'e2e-goal-investments-owner';
const EMAIL = 'e2e-goal-investments@minhas-financas.local';
const PASSWORD = 'e2e-goal-investments-password';
const WORKSPACE = 'e2e-goal-investments-workspace';
const GOAL = 'e2e-goal-reserva';

const CARTEIRA = 'goal-catalog-class';
const INSTITUICAO = 'goal-catalog-institution';
const CATEGORIA = 'goal-catalog-type';

const sdk = () => {
  process.env.GCLOUD_PROJECT = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  return admin;
};

const catalogo = (
  id: string, group: string, name: string, normalizedName: string,
  transactionSubtype?: string,
) => ({
  id,
  workspaceId: WORKSPACE,
  group,
  name,
  normalizedName,
  ...(transactionSubtype ? { transactionSubtype } : {}),
  dedupeKey: `${group}::${transactionSubtype ?? 'all'}::both::${normalizedName}`,
  workspaceScope: 'both',
  sortOrder: 1,
  status: 'active',
  createdBy: UID,
  updatedBy: UID,
});

test.beforeEach(async () => {
  const firebaseAdmin = sdk();
  const db = firebaseAdmin.firestore();
  await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE}`));
  try {
    await firebaseAdmin.auth().deleteUser(UID);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  await firebaseAdmin.auth().createUser({
    uid: UID, email: EMAIL, password: PASSWORD, emailVerified: true,
  });
  const now = firebaseAdmin.firestore.Timestamp.now();
  const stamps = { createdAt: now, updatedAt: now };

  await Promise.all([
    db.doc(`workspaces/${WORKSPACE}`).set({
      ownerId: UID, name: 'Metas e Investimentos', type: 'PF', ...stamps,
    }),
    db.doc(`workspaces/${WORKSPACE}/members/${UID}`).set({
      uid: UID, role: 'owner', status: 'active',
    }),
    db.doc(`users/${UID}/workspaces/${WORKSPACE}`).set({
      workspaceId: WORKSPACE, role: 'owner',
    }),
    db.doc(`workspaces/${WORKSPACE}/goals/${GOAL}`).set({
      id: GOAL,
      workspaceId: WORKSPACE,
      profileId: WORKSPACE,
      name: 'Reserva de emergência',
      description: 'Seis meses de despesas.',
      category: 'patrimonio',
      status: 'em_andamento',
      priority: 'alta',
      targetAmount: 10_000,
      targetAmountCents: 1_000_000,
      currentAmount: 0,
      startDate: '2026-01-01',
      deadline: '2026-12-31',
      horizon: 'medio',
      progressBasis: 'net_contributions',
      archived: false,
      visual: { color: '#4f46e5', icon: 'target', emoji: '🎯', progressBarType: 'linear' },
      createdBy: UID,
      updatedBy: UID,
      ...stamps,
    }),
    db.doc(`workspaces/${WORKSPACE}/settings_catalog/${CARTEIRA}`).set({
      ...catalogo(CARTEIRA, 'investment_class', 'Reserva de emergência', 'reserva de emergencia'),
      ...stamps,
    }),
    db.doc(`workspaces/${WORKSPACE}/settings_catalog/${INSTITUICAO}`).set({
      ...catalogo(INSTITUICAO, 'investment_institution', 'BTG', 'btg'), ...stamps,
    }),
    db.doc(`workspaces/${WORKSPACE}/settings_catalog/${CATEGORIA}`).set({
      ...catalogo(CATEGORIA, 'category', 'Renda fixa', 'renda fixa', 'investimento'), ...stamps,
    }),
  ]);
});

const login = async (page: Page) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
};

const abrirMeta = async (page: Page) => {
  await page.getByText('Metas', { exact: true }).first().click();
  await page.getByText('Reserva de emergência').first().click();
  await expect(page.getByRole('heading', { name: 'Histórico de investimentos' })).toBeVisible();
};

/**
 * Investimentos não tem item de menu: o caminho é o card do Dashboard.
 *
 * É assim desde o baseline — o card "Investimentos" é clicável e leva à tela.
 */
const abrirInvestimentos = async (page: Page) => {
  await page.getByText('Dashboard', { exact: true }).first().click();
  await expect(page.getByText('Saldo Atual')).toBeVisible();
  await page.getByText('Investimentos', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Investimentos' })).toBeVisible();
};

/** Preenche o formulário simples já aberto. */
const preencher = async (
  page: Page,
  { descricao, valor, depositado }: { descricao: string; valor: string; depositado: boolean },
) => {
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel('Carteira de investimento').selectOption({ label: 'Reserva de emergência' });
  await dialogo.getByLabel('Instituição').selectOption({ label: 'BTG' });
  await dialogo.getByLabel('Descrição').fill(descricao);
  await dialogo.getByLabel('Categoria').selectOption({ label: 'Renda fixa' });
  await dialogo.getByLabel('Valor do investimento').fill(valor);
  await dialogo.getByRole('radio', { name: depositado ? 'Sim' : 'Não' }).check();
  await dialogo.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialogo).toHaveCount(0);
};

const progresso = async (): Promise<number> => {
  const goal = await sdk().firestore().doc(`workspaces/${WORKSPACE}/goals/${GOAL}`).get();
  const value = goal.data()?.investmentProgressCents;
  return typeof value === 'number' ? value : 0;
};

const transacoes = async () => {
  const snapshot = await sdk().firestore()
    .collection(`workspaces/${WORKSPACE}/transactions`).get();
  return snapshot.docs.map((entry) => entry.data());
};

test('Novo Aporte pela meta abre o formulário com a meta travada', async ({ page }) => {
  await login(page);
  await abrirMeta(page);

  await page.getByRole('button', { name: 'Novo Aporte' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();

  // A meta correta já vem escolhida e não pode ser trocada aqui (§2.A).
  const meta = dialogo.getByLabel('Meta', { exact: true });
  await expect(meta).toBeDisabled();
  await expect(meta).toContainText('Reserva de emergência');
  await expect(dialogo.getByText('Este aporte já vai para esta meta.')).toBeVisible();

  // Pendente: a meta não pode se mover antes da liquidação (§2.E).
  await preencher(page, { descricao: 'Aporte pendente da meta', valor: '30000', depositado: false });
  await expect(page.getByText('Investimento registrado como pendente.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Aporte pendente', exact: true })).toBeVisible();
  await expect.poll(progresso, { timeout: 20_000 }).toBe(0);
  // Espelho pendente não move caixa.
  for (const transacao of await transacoes()) {
    expect(transacao.isPaid).toBe(false);
  }

  // Confirmado: a meta se move **uma** vez, pelo capital aportado.
  await abrirInvestimentos(page);
  const linha = page.getByRole('row').filter({ hasText: 'Aporte pendente da meta' });
  await linha.getByRole('button', { name: /Confirmar depósito/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar depósito' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(progresso, { timeout: 20_000 }).toBe(30_000);

  // A tabela de investimentos mostra o aporte como entrada de patrimônio.
  await expect(linha.getByText('Depositado', { exact: true })).toBeVisible();
  await expect(linha.getByText('+ R$ 300,00')).toBeVisible();

  // O histórico da meta fala a língua do usuário, não a do domínio.
  await abrirMeta(page);
  await expect(page.getByRole('cell', { name: 'Aporte depositado', exact: true })).toBeVisible();
  for (const tecnico of ['contribution', 'settled', 'redemption']) {
    await expect(page.getByText(tecnico, { exact: true })).toHaveCount(0);
  }

  // O aporte reduz caixa e não vira despesa.
  const espelhos = await transacoes();
  expect(espelhos.length).toBe(1);
  expect(espelhos[0].type).toBe('investimento');
  expect(espelhos[0].isPaid).toBe(true);
});

test('Vincular Existente liga e Remover da meta desfaz, sem apagar movimento', async ({ page }) => {
  await login(page);

  // Um investimento que nasce sem meta.
  await abrirInvestimentos(page);
  await page.getByRole('button', { name: 'Novo investimento' }).click();
  await preencher(page, { descricao: 'CDB sem meta', valor: '50000', depositado: true });
  await expect(page.getByText('Investimento registrado como depositado.')).toBeVisible();
  await expect.poll(progresso, { timeout: 20_000 }).toBe(0);

  await abrirMeta(page);
  await page.getByRole('button', { name: 'Vincular Existente' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByText('CDB sem meta')).toBeVisible();

  await dialogo.getByRole('button', { name: 'Vincular' }).click();
  await expect(dialogo.getByText('Nenhum investimento disponível')).toBeVisible();
  await expect.poll(progresso, { timeout: 20_000 }).toBe(50_000);

  // Já vinculado não volta a aparecer como candidato (§2.C).
  await expect(dialogo.getByRole('button', { name: 'Remover da meta' })).toBeVisible();

  await dialogo.getByRole('button', { name: 'Remover da meta' }).click();
  await expect.poll(progresso, { timeout: 20_000 }).toBe(0);

  // Nada foi apagado: vínculo e desvínculo são movimentos próprios no ledger.
  const movimentos = await sdk().firestore()
    .collection(`workspaces/${WORKSPACE}/investment_movements`).get();
  const operacoes = movimentos.docs.map((entry) => entry.get('operation'));
  expect(operacoes).toContain('goal_link');
  expect(operacoes).toContain('goal_unlink');
  expect(operacoes).toContain('contribution');
});

test('retirada reduz a meta pelo capital e nunca vira receita operacional', async ({ page }) => {
  await login(page);
  await abrirMeta(page);
  await page.getByRole('button', { name: 'Novo Aporte' }).click();
  await preencher(page, { descricao: 'Aporte da meta', valor: '100000', depositado: true });
  await expect.poll(progresso, { timeout: 20_000 }).toBe(100_000);

  await abrirInvestimentos(page);
  const linha = page.getByRole('row').filter({ hasText: 'Aporte da meta' });
  await linha.getByRole('button', { name: /Retirar investimento/ }).click();
  const retirada = page.getByRole('dialog');
  await expect(retirada).toBeVisible();
  await retirada.getByLabel('Valor da retirada').fill('40000');
  await retirada.getByRole('radio', { name: 'Não' }).check();
  await retirada.getByRole('button', { name: 'Confirmar retirada' }).click();
  await expect(retirada).toHaveCount(0);

  // Pendente: nada de definitivo acontece (§2.E).
  await expect.poll(progresso, { timeout: 20_000 }).toBe(100_000);

  const linhaRetirada = page.getByRole('row').filter({ hasText: 'Retirada' }).first();
  await expect(linhaRetirada.getByText('Aguardando recebimento', { exact: true })).toBeVisible();
  // E o sinal da retirada nunca é de entrada dentro de Investimentos (§0.A).
  await expect(linhaRetirada.getByText('+ R$ 400,00')).toHaveCount(0);
  await expect(linhaRetirada.getByText('− R$ 400,00')).toBeVisible();

  await linhaRetirada.getByRole('button', { name: /Confirmar recebimento/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar recebimento' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Liquidada: a meta é reduzida pelo capital, uma vez só.
  await expect.poll(progresso, { timeout: 20_000 }).toBe(60_000);

  // O principal resgatado entra no caixa e **não** vira receita operacional.
  const espelhos = await transacoes();
  expect(espelhos.every((espelho) => espelho.type === 'investimento')).toBe(true);
  expect(espelhos.some((espelho) => espelho.type === 'receita')).toBe(false);
  const resgate = espelhos.find(
    (espelho) => espelho.investmentMetadata?.investmentOperation === 'redemption',
  );
  expect(resgate?.investmentMetadata?.cashImpact).toBe('inflow');

  // O relatório separa aporte de retirada.
  await page.getByText('Relatórios', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patrimônio de investimentos' })).toBeVisible();
  await expect(page.getByText('Aportes', { exact: true })).toBeVisible();
  await expect(page.getByText('Retiradas', { exact: true })).toBeVisible();
});
