import { expect, test, type Page } from '@playwright/test';

import { callCallable } from './support/callables';
import { createCardByBackend, purchasesOf } from './support/cards';
import {
  bodyOf,
  callablePosts,
  db,
  intentKey,
  login,
  pageAs,
  PASSWORD,
  resetEmulatorData,
  seedLoanTenant,
  today,
  tokenOf,
  transactionsOf,
  type LoanTenant,
} from './support/loans';
import { adminSdk, seedAccountProfile, seedMembership } from './support/workspaceSeed';

/**
 * P4-E (D-23) — catálogo de configurações pela interface, no Emulator (Auth,
 * Firestore e Functions reais, sem mocks):
 * - owner cria, renomeia, inativa e reativa em Configurações › Cadastros, só
 *   pelas callables; nome repetido mostra a mensagem do backend com o
 *   formulário preservado; categorias com Receitas, Despesas e Investimentos,
 *   sem Parcelados; centro de custo só em PJ;
 * - a aba Parcelado do lançamento usa as categorias de despesa e cria a
 *   compra pelo domínio de cartões, sem `transactions` do tipo parcelado;
 * - admin administra; member e viewer só leem, sem ações; perda de papel
 *   com o diálogo aberto; o backend recusa member e outro tenant.
 */
test.use({ timezoneId: 'America/Sao_Paulo' });

let tenant: LoanTenant;
const ws = () => tenant.workspaceId;

const NAME_PLACEHOLDER = 'Ex.: Cartão corporativo, Fornecedor A, Alimentação...';
const FORBIDDEN_PAYLOAD_KEYS = ['userId', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt',
  'dedupeKey', 'normalizedName', 'workspaceScope'];

const catalogOf = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/settings_catalog`).get()).docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, any>));

const locksOf = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/settings_catalog_uniques`).get()).docs
    .map((doc) => doc.data() as Record<string, any>);

const openCadastros = async (page: Page) => {
  await page.getByText('Configurações', { exact: true }).first().click();
  await page.getByRole('heading', { name: 'Cadastros', exact: true }).click();
  await expect(page.getByText('Produtos e Serviços').first()).toBeVisible({ timeout: 20_000 });
};

const openSection = async (page: Page, title: string) => {
  await page.getByRole('main').getByText(title, { exact: true }).first().click();
};

const itemCard = (page: Page, name: string) =>
  page.getByRole('main').locator('article').filter({ has: page.getByText(name, { exact: true }) });

const fillAndSubmit = async (page: Page, name: string, submit: 'Criar cadastro' | 'Salvar alterações') => {
  await page.getByPlaceholder(NAME_PLACEHOLDER).fill(name);
  await page.getByRole('button', { name: submit }).click();
};

/** Admin do workspace (o tenant semeado tem owner, member e viewer). */
const seedAdmin = async (t: LoanTenant) => {
  const adminUser = { uid: `${t.owner.uid}-admin`, email: t.owner.email.replace('-owner@', '-admin@') };
  await adminSdk().auth().createUser({ ...adminUser, password: PASSWORD, emailVerified: true });
  await seedAccountProfile(adminUser);
  await seedMembership({ workspaceId: t.workspaceId, uid: adminUser.uid, email: adminUser.email,
    role: 'admin', name: t.name, type: t.type });
  return adminUser;
};

test.describe('PJ', () => {
  test.beforeEach(async () => {
    await resetEmulatorData();
    tenant = await seedLoanTenant('PJ', 'p4e');
  });

  test('owner: cria, recusa nome repetido, renomeia, inativa e reativa só pelas callables; aba Parcelado usa despesa', async ({ page }) => {
    test.setTimeout(150_000);
    // O cartão existe antes do login (a lista de cartões é lida na entrada).
    const cardId = await createCardByBackend(tenant, { name: 'Cartão P4-E' });
    await login(page, tenant.owner.email);
    await openCadastros(page);
    // PJ tem centro de custo.
    await expect(page.getByRole('main').getByText('Centros', { exact: true })).toHaveCount(1);

    await openSection(page, 'Categorias');
    const main = page.getByRole('main');
    for (const tab of ['Receitas', 'Despesas', 'Investimentos']) {
      await expect(main.getByRole('button', { name: tab, exact: true })).toBeVisible();
    }
    await expect(main.getByRole('button', { name: 'Parcelados', exact: true })).toHaveCount(0);

    // Criação em Despesas.
    const creates = callablePosts(page, 'createSettingsCatalogItem');
    await main.getByRole('button', { name: 'Despesas', exact: true }).click();
    await main.getByRole('button', { name: 'Novo cadastro' }).first().click();
    await fillAndSubmit(page, 'Material de Escritório P4-E', 'Criar cadastro');
    await expect(page.getByRole('button', { name: 'Criar cadastro' })).toHaveCount(0, { timeout: 30_000 });
    await expect(itemCard(page, 'Material de Escritório P4-E')).toBeVisible();
    expect(creates).toHaveLength(1);
    const body = bodyOf(creates[0]);
    expect(body).toMatchObject({ workspaceId: ws(), group: 'category', name: 'Material de Escritório P4-E',
      transactionSubtype: 'despesa', status: 'active' });
    expect(typeof body.idempotencyKey).toBe('string');
    for (const key of FORBIDDEN_PAYLOAD_KEYS) expect(body).not.toHaveProperty(key);
    let catalog = await catalogOf(ws());
    expect(catalog).toHaveLength(1);
    const created = catalog[0];
    expect(created).toMatchObject({ group: 'category', transactionSubtype: 'despesa', workspaceScope: 'both',
      normalizedName: 'material de escritorio p4-e', createdBy: tenant.owner.uid, status: 'active', schemaVersion: 1 });
    expect((await locksOf(ws())).map((lock) => lock.catalogItemId)).toEqual([created.id]);

    // Nome repetido (acento e caixa): mensagem do backend, formulário preservado.
    await main.getByRole('button', { name: 'Novo cadastro' }).first().click();
    await fillAndSubmit(page, 'material de escritorio p4-e', 'Criar cadastro');
    await expect(page.getByRole('alert').filter({ hasText: 'Já existe um cadastro com esse nome neste grupo.' }))
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByPlaceholder(NAME_PLACEHOLDER)).toHaveValue('material de escritorio p4-e');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    expect(await catalogOf(ws())).toHaveLength(1);

    // Renomear: o mesmo documento, reserva movida.
    const updates = callablePosts(page, 'updateSettingsCatalogItem');
    await itemCard(page, 'Material de Escritório P4-E').getByRole('button', { name: 'Editar' }).click();
    await fillAndSubmit(page, 'Papelaria P4-E', 'Salvar alterações');
    await expect(itemCard(page, 'Papelaria P4-E')).toBeVisible({ timeout: 30_000 });
    expect(bodyOf(updates[0])).toMatchObject({ itemId: created.id, changes: { name: 'Papelaria P4-E' } });
    expect(typeof bodyOf(updates[0]).expectedUpdatedAt).toBe('string');
    catalog = await catalogOf(ws());
    expect(catalog.map((item) => [item.id, item.name])).toEqual([[created.id, 'Papelaria P4-E']]);
    expect(catalog[0].createdBy).toBe(tenant.owner.uid);
    expect((await locksOf(ws())).map((lock) => lock.dedupeKey))
      .toEqual(['category::despesa::both::papelaria p4-e']);

    // Inativar: some da lista ativa; documento e reserva permanecem.
    const archives = callablePosts(page, 'archiveSettingsCatalogItem');
    await itemCard(page, 'Papelaria P4-E').getByRole('button', { name: 'Inativar' }).click();
    await expect(page.getByText('O nome continua reservado: para usá-lo de novo, reative este cadastro.'))
      .toBeVisible();
    await page.getByRole('button', { name: 'Inativar item' }).click();
    await expect(page.getByText('“Papelaria P4-E” foi inativado com sucesso.')).toBeVisible({ timeout: 30_000 });
    expect(archives).toHaveLength(1);
    await expect(itemCard(page, 'Papelaria P4-E')).toHaveCount(0);
    expect((await catalogOf(ws()))[0]).toMatchObject({ id: created.id, status: 'inactive' });
    expect(await locksOf(ws())).toHaveLength(1);

    // Reativar pela edição (status Ativo).
    await main.getByText('Exibir inativos').click();
    await itemCard(page, 'Papelaria P4-E').getByRole('button', { name: 'Editar' }).click();
    await page.getByRole('button', { name: 'Ativo', exact: true }).click();
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByText('Cadastro atualizado com sucesso.')).toBeVisible({ timeout: 30_000 });
    expect(bodyOf(updates[updates.length - 1]).changes).toEqual({ status: 'active' });
    expect((await catalogOf(ws()))[0].status).toBe('active');

    // Uma categoria de receita, para provar o recorte da aba Parcelado.
    await main.getByRole('button', { name: 'Receitas', exact: true }).click();
    await main.getByRole('button', { name: 'Novo cadastro' }).first().click();
    await fillAndSubmit(page, 'Consultoria P4-E', 'Criar cadastro');
    await expect(itemCard(page, 'Consultoria P4-E')).toBeVisible({ timeout: 30_000 });

    // Aba Parcelado: categorias de despesa; compra pelo domínio de cartões.
    await page.getByRole('link', { name: /Dashboard/i }).click();
    await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 20_000 });
    const purchases = callablePosts(page, 'createCreditCardPurchase');
    await page.getByRole('button', { name: /Nova Transação/i }).first().click();
    const dialog = page.getByRole('dialog').filter({ has: page.locator('#transaction-modal-title') });
    await dialog.getByRole('button', { name: /^Cartão$/ }).click();
    const form = dialog.locator('form');
    await form.locator('select').first().selectOption(cardId);
    const categorySelect = form.locator('select').nth(1);
    await expect(categorySelect.locator('option', { hasText: 'Papelaria P4-E' })).toHaveCount(1);
    await expect(categorySelect.locator('option', { hasText: 'Consultoria P4-E' })).toHaveCount(0);
    await form.getByPlaceholder('Busque, selecione ou digite um novo item...').fill('Caderno P4-E');
    await categorySelect.selectOption({ label: 'Papelaria P4-E' });
    await form.locator('input[type="date"]').fill(today());
    await form.locator('input[type="number"]').nth(0).fill('120');
    await form.locator('input[type="number"]').nth(1).fill('3');
    await dialog.getByRole('button', { name: 'Revisar e Adicionar Parcelado' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    expect(purchases).toHaveLength(1);
    expect(bodyOf(purchases[0])).toMatchObject({ cardId, category: 'Papelaria P4-E', installmentsCount: 3 });
    const stored = (await purchasesOf(ws())).filter((purchase) => purchase.description === 'Caderno P4-E');
    expect(stored).toHaveLength(1);
    expect((await transactionsOf(ws())).filter((entry) => entry.type === 'parcelado')).toEqual([]);
    // O produto novo digitado pelo owner virou cadastro pelo backend.
    expect((await catalogOf(ws())).some((item) => item.group === 'product_service' && item.name === 'Caderno P4-E'))
      .toBe(true);
    for (const item of await catalogOf(ws())) expect(item.transactionSubtype).not.toBe('parcelado');
  });
});

test.describe('PF', () => {
  test.beforeEach(async () => {
    await resetEmulatorData();
    tenant = await seedLoanTenant('PF', 'p4e');
  });

  test('admin administra; member e viewer só leem; perda de papel com o diálogo aberto; backend recusa member e outro tenant', async ({ page, request, browser }) => {
    test.setTimeout(150_000);
    const adminUser = await seedAdmin(tenant);

    // Admin cria pela tela; PF não tem centro de custo.
    await login(page, adminUser.email);
    await openCadastros(page);
    await expect(page.getByRole('main').getByText('Centros', { exact: true })).toHaveCount(0);
    await page.getByRole('main').getByRole('button', { name: 'Novo cadastro' }).first().click();
    await fillAndSubmit(page, 'Assinaturas P4-E', 'Criar cadastro');
    await expect(itemCard(page, 'Assinaturas P4-E')).toBeVisible({ timeout: 30_000 });
    const [item] = await catalogOf(ws());
    expect(item).toMatchObject({ group: 'product_service', workspaceScope: 'both', createdBy: adminUser.uid });

    // Envio duplo no mesmo instante: uma intenção (mesma chave), um cadastro.
    const doubleCreates = callablePosts(page, 'createSettingsCatalogItem');
    await page.getByRole('main').getByRole('button', { name: 'Novo cadastro' }).first().click();
    await page.getByPlaceholder(NAME_PLACEHOLDER).fill('Envio Duplo P4-E');
    await page.locator('form').filter({ has: page.getByPlaceholder(NAME_PLACEHOLDER) }).evaluate((element) => {
      const form = element as HTMLFormElement;
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(itemCard(page, 'Envio Duplo P4-E')).toBeVisible({ timeout: 30_000 });
    expect(new Set(doubleCreates.map((request) => bodyOf(request).idempotencyKey)).size).toBe(1);
    expect((await catalogOf(ws())).filter((entry) => entry.name === 'Envio Duplo P4-E')).toHaveLength(1);

    // Member e viewer: veem o cadastro, sem nenhuma ação.
    for (const email of [tenant.member.email, tenant.viewer.email]) {
      const reader = await pageAs(browser, email);
      await openCadastros(reader);
      await expect(itemCard(reader, 'Assinaturas P4-E')).toBeVisible();
      for (const action of ['Novo cadastro', 'Criar primeiro item', 'Editar', 'Inativar']) {
        await expect(reader.getByRole('main').getByRole('button', { name: action })).toHaveCount(0);
      }
      await reader.context().close();
    }

    // O backend decide: member não cria; owner de outro tenant não alcança.
    const memberToken = await tokenOf(request, tenant.member.email);
    const memberCreate = await callCallable(request, memberToken, 'createSettingsCatalogItem', {
      workspaceId: ws(), idempotencyKey: intentKey('member-catalog'), group: 'product_service', name: 'Do membro',
    });
    expect(memberCreate.errorStatus).toBe('PERMISSION_DENIED');
    const other = await seedLoanTenant('PF', 'p4e-outro');
    const otherToken = await tokenOf(request, other.owner.email);
    const crossTenant = await callCallable(request, otherToken, 'createSettingsCatalogItem', {
      workspaceId: ws(), idempotencyKey: intentKey('cross-catalog'), group: 'product_service', name: 'Invasor',
    });
    expect(crossTenant.errorStatus).toBe('PERMISSION_DENIED');
    expect(crossTenant.errorMessage).toBe('Você não tem acesso a este espaço de trabalho.');

    // Perda de papel com o formulário aberto: recusado, nada gravado.
    await page.getByRole('main').getByRole('button', { name: 'Novo cadastro' }).first().click();
    await page.getByPlaceholder(NAME_PLACEHOLDER).fill('Depois do rebaixamento');
    await db().doc(`workspaces/${ws()}/members/${adminUser.uid}`).update({ role: 'member' });
    await page.getByRole('button', { name: 'Criar cadastro' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'não permite esta operação' }))
      .toBeVisible({ timeout: 30_000 });
    expect((await catalogOf(ws())).map((entry) => entry.name).sort()).toEqual(['Assinaturas P4-E', 'Envio Duplo P4-E']);
  });
});
