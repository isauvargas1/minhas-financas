import { expect, test, type Page, type Locator } from '@playwright/test';

import { balanceOf, expectLedgerConsistent } from './support/accounts';
import { callCallable } from './support/callables';
import { createCardFor, purchasesOf } from './support/cards';
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
import {
  createRecurringFor,
  occurrencesOf,
  openRecurring,
  openRecurringDetails,
  recurringDoc,
  RECURRING_CATEGORY,
  recurringExpensesOf,
  runRecurringToday,
  seedRecurringCategory,
  yesterday,
} from './support/recurring';
import {
  adminSdk,
  defaultCashAccountIdFor,
  seedAccountProfile,
  seedMembership,
  seedOwnedWorkspace,
} from './support/workspaceSeed';

/**
 * P4-B (D-12) — Recorrentes autoritativos pela interface, no Emulator
 * (Auth, Firestore e Functions reais, sem mocks):
 * - criar, editar, reajustar, pausar, retomar e cancelar pelas callables, em
 *   centavos, com o modo de execução sempre explícito e envio duplo barrado;
 * - semanal e quinzenal com a projeção pela agenda pura;
 * - automático no Caixa gera despesa pendente (sem mover conta); "pagar"
 *   registra o pagamento pela conta escolhida;
 * - automático no cartão gera uma compra `recurring`; "confirmar antes"
 *   cria a compra com o valor real;
 * - `attention_required` com nova tentativa depois da correção; ignorar;
 * - member administra só as próprias; viewer só lê; perda de permissão;
 *   troca de workspace;
 * - prova de que a geração antiga pelo cliente (`onAddTransaction`) acabou:
 *   nenhuma escrita do cliente em `transactions` nem em `recurring_*`.
 */
let tenant: LoanTenant;
const ws = () => tenant.workspaceId;
const mainAccount = () => defaultCashAccountIdFor(ws());
const owner = () => ({ uid: tenant.owner.uid, workspaceId: ws() });

/** Escritas do SDK do Firestore no navegador (canal `Write`), com o corpo. */
const clientWrites = (page: Page): string[] => {
  const bodies: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('google.firestore.v1.Firestore/Write')) {
      bodies.push(request.postData() ?? '');
    }
  });
  return bodies;
};

const expectNoClientWritesTo = (bodies: string[]) => {
  for (const body of bodies) {
    const decoded = decodeURIComponent(body);
    expect(decoded).not.toMatch(/\/transactions\//);
    expect(decoded).not.toMatch(/\/recurring_(expenses|occurrences|events)\//);
  }
};

/** Dois envios no mesmo tique: só a trava síncrona barra o segundo. */
const submitTwiceAtOnce = (form: Locator) =>
  form.evaluate((element) => {
    const target = element as HTMLFormElement;
    target.requestSubmit();
    target.requestSubmit();
  });

const formDialog = (page: Page) => page.getByRole('dialog').filter({ has: page.locator('#modal-title') });
const occurrenceRow = (page: Page, occurrenceId: string) => page.locator(`[data-occurrence-id="${occurrenceId}"]`);

test.describe('PF', () => {
  test.beforeEach(async () => {
    await resetEmulatorData();
    tenant = await seedLoanTenant('PF', 'p4b');
    await seedRecurringCategory(ws(), tenant.owner.uid);
  });

  test('criar e editar pela tela em centavos, modo explícito; envio duplo cria um só', async ({ page }) => {
    await login(page, tenant.owner.email);
    const writes = clientWrites(page);
    await openRecurring(page);
    const creates = callablePosts(page, 'createRecurringExpense');
    await page.getByRole('button', { name: 'Nova' }).click();
    const dialog = formDialog(page);
    await expect(dialog.getByRole('heading', { name: 'Nova Assinatura' })).toBeVisible();
    await dialog.locator('#nome').fill('Internet Fibra');
    await dialog.locator('#valor').fill('99.90');
    await dialog.locator('#periodo').selectOption('monthly');
    await dialog.locator('#diaCobranca').fill('10');
    await dialog.getByRole('tab', { name: 'Pagamento' }).click();
    await dialog.getByRole('button', { name: /Pix \/ Transf\./ }).click();
    await expect(dialog.locator('#conta-recorrencia')).toHaveValue(mainAccount());
    await expect(dialog.getByRole('radio', { name: 'Automático' })).toBeChecked();
    await expect(dialog.getByText(/Isso não é pagamento/)).toBeVisible();
    // A classificação de despesa (categoria do catálogo, por ID) fica na aba Integrações.
    await dialog.getByRole('tab', { name: 'Integrações' }).click();
    await dialog.locator('#categoria').selectOption({ label: RECURRING_CATEGORY.name });
    await submitTwiceAtOnce(dialog.locator('form#recurringForm'));
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    expect(creates).toHaveLength(1);
    const body = bodyOf(creates[0]);
    expect(body).toMatchObject({
      workspaceId: ws(), name: 'Internet Fibra', amountCents: 9_990, frequency: 'monthly', billingDay: 10,
      paymentMethod: 'pix', executionMode: 'automatic', cashAccountId: mainAccount(), cardId: null,
      categoryId: RECURRING_CATEGORY.id,
    });
    for (const key of ['valorPadrao', 'status', 'nextDueDate', 'source', 'createdBy', 'splitGroupIdOpcional']) {
      expect(body).not.toHaveProperty(key);
    }
    const [contract] = await recurringExpensesOf(ws());
    expect(contract).toMatchObject({ name: 'Internet Fibra', amountCents: 9_990, status: 'active', schemaVersion: 1 });
    await expect(page.getByRole('button', { name: 'Detalhes da assinatura Internet Fibra' })).toBeVisible();

    // Edição: só o que mudou, com a versão lida.
    const updates = callablePosts(page, 'updateRecurringExpense');
    await openRecurringDetails(page, 'Internet Fibra');
    await expect(page.getByText(/99,90/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Editar' }).click();
    await expect(formDialog(page).locator('#valor')).toHaveValue('99.90');
    await formDialog(page).locator('#valor').fill('109.90');
    await formDialog(page).getByRole('button', { name: 'Salvar Alterações' }).click();
    await expect(formDialog(page)).toBeHidden({ timeout: 30_000 });
    expect(updates).toHaveLength(1);
    expect(bodyOf(updates[0])).toMatchObject({ recurringExpenseId: contract.id, changes: { amountCents: 10_990 } });
    expect(Object.keys(bodyOf(updates[0]).changes as Record<string, unknown>)).toEqual(['amountCents']);
    expect(typeof bodyOf(updates[0]).expectedUpdatedAt).toBe('string');

    // Reajuste com motivo: histórico de reajustes pela trilha.
    await page.getByRole('button', { name: 'Reajustar Valor' }).click();
    await page.locator('#reajuste-valor').fill('119.90');
    await page.locator('#reajuste-motivo').fill('Reajuste anual da operadora');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Reajuste anual da operadora' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('cell', { name: /119,90/ })).toBeVisible();
    expect(await recurringDoc(ws(), contract.id)).toMatchObject({ amountCents: 11_990, revision: 3 });
    expectNoClientWritesTo(writes);
  });

  test('semanal e quinzenal: dia de cobrança só nas mensais; projeção pela agenda', async ({ page }) => {
    await login(page, tenant.owner.email);
    await openRecurring(page);
    const creates = callablePosts(page, 'createRecurringExpense');
    await page.getByRole('button', { name: 'Nova' }).click();
    const dialog = formDialog(page);
    await dialog.locator('#nome').fill('Diarista');
    await dialog.locator('#valor').fill('150');
    await dialog.locator('#periodo').selectOption('weekly');
    await expect(dialog.locator('#diaCobranca')).toHaveCount(0);
    await dialog.locator('#dataInicio').fill(today());
    await dialog.getByRole('tab', { name: 'Pagamento' }).click();
    await dialog.getByRole('button', { name: /Pix \/ Transf\./ }).click();
    await dialog.getByRole('radio', { name: 'Confirmar antes' }).check();
    await expect(dialog.getByText(/aguardando a sua confirmação/)).toBeVisible();
    await dialog.getByRole('tab', { name: 'Integrações' }).click();
    await dialog.locator('#categoria').selectOption({ label: RECURRING_CATEGORY.name });
    await dialog.getByRole('button', { name: 'Cadastrar Assinatura' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    expect(bodyOf(creates[0])).toMatchObject({ frequency: 'weekly', billingDay: null,
      executionMode: 'confirmation_required', startDate: today() });

    await createRecurringFor(owner(), { name: 'Quinzena', frequency: 'biweekly', startDate: today() }, today());
    await page.reload();
    await openRecurring(page);
    await openRecurringDetails(page, 'Quinzena');
    // Seis vencimentos projetados, de 15 em 15 dias, sem ocorrência materializada.
    await expect(page.getByText(/^Previsto · Caixa$/)).toHaveCount(6);
    expect(await occurrencesOf(ws())).toHaveLength(0);
  });

  test('pausar, retomar e cancelar pela tela; cancelada não gera mais', async ({ page }) => {
    const id = await createRecurringFor(owner(), { name: 'Academia' });
    await login(page, tenant.owner.email);
    await openRecurring(page);
    await openRecurringDetails(page, 'Academia');
    await page.getByRole('button', { name: 'Pausar' }).click();
    await expect(page.getByText('Pausado', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    expect(await recurringDoc(ws(), id)).toMatchObject({ status: 'paused', nextDueDate: null });
    // Pausada: a rotina não gera.
    await runRecurringToday();
    expect(await occurrencesOf(ws())).toHaveLength(0);
    await page.getByRole('button', { name: 'Retomar' }).click();
    await expect(page.getByText('Ativo', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    // Retomada sem recuperar o vencimento de ontem.
    const resumed = await recurringDoc(ws(), id);
    expect(resumed.status).toBe('active');
    expect(resumed.nextDueDate > today()).toBe(true);
    await page.getByRole('button', { name: 'Cancelar recorrência' }).click();
    const confirm = page.getByRole('dialog', { name: 'Cancelar recorrência' });
    await expect(confirm.getByText(/não é apagado nem revertido/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancelar recorrência' }).click();
    await expect(page.getByText('Cancelado', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
    expect(await recurringDoc(ws(), id)).toMatchObject({ status: 'cancelled', nextDueDate: null });
    await runRecurringToday();
    expect(await occurrencesOf(ws())).toHaveLength(0);
  });

  test('automático no Caixa: despesa pendente sem mover conta; pagar pela ocorrência', async ({ page }) => {
    const balance = await balanceOf(ws(), mainAccount());
    await createRecurringFor(owner(), { name: 'Streaming', amountCents: 3_990 });
    await createRecurringFor(owner(), { name: 'Condomínio', amountCents: 50_000,
      executionMode: 'confirmation_required' });
    await runRecurringToday();
    const entries = await transactionsOf(ws());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ isPaid: false, valueCents: 3_990, dueDate: yesterday(),
      cashEntry: { origin: 'recurring', status: 'pending' } });
    expect(entries[0]).not.toHaveProperty('cardId');
    expect(await balanceOf(ws(), mainAccount())).toBe(balance);

    await login(page, tenant.owner.email);
    const writes = clientWrites(page);
    await openRecurring(page);
    await openRecurringDetails(page, 'Streaming');
    await expect(page.getByText('Despesa pendente no Caixa', { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await openRecurringDetails(page, 'Condomínio');
    const [awaiting] = (await occurrencesOf(ws())).filter((occurrence) => occurrence.status === 'awaiting_confirmation');
    const row = occurrenceRow(page, awaiting.id);
    await expect(row.getByText(/Aguardando confirmação · Caixa/)).toBeVisible();
    const confirms = callablePosts(page, 'confirmRecurringOccurrence');
    await row.getByRole('button', { name: 'Pagar' }).click();
    const panel = page.getByRole('form', { name: 'Registrar como paga agora' });
    await panel.locator('#occurrence-amount').fill('512.30');
    await expect(panel.locator('#occurrence-account')).toHaveValue(mainAccount());
    await panel.locator('#occurrence-paid-date').fill(today());
    await panel.getByRole('button', { name: 'Registrar pagamento' }).click();
    await expect(panel).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText('Paga no Caixa', { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(confirms).toHaveLength(1);
    expect(bodyOf(confirms[0])).toMatchObject({ occurrenceId: awaiting.id, settlement: 'paid', amountCents: 51_230,
      paidDate: today() });
    expect(await balanceOf(ws(), mainAccount())).toBe(balance - 51_230);
    await expectLedgerConsistent(ws());
    const paid = (await transactionsOf(ws())).find((entry) => entry.valueCents === 51_230);
    expect(paid).toMatchObject({ isPaid: true, cashEntry: { origin: 'recurring', status: 'confirmed' } });
    expectNoClientWritesTo(writes);
  });

  test('cartão: automático gera compra `recurring`; confirmar antes usa o valor real', async ({ page }) => {
    const cardId = await createCardFor(owner(), { name: 'Cartão Recorrente', closingDay: 28, dueDay: 5 });
    await createRecurringFor(owner(), { name: 'Software', amountCents: 8_900, paymentMethod: 'credit_card', cardId,
      cashAccountId: null });
    await createRecurringFor(owner(), { name: 'Nuvem', amountCents: 6_000, paymentMethod: 'credit_card', cardId,
      cashAccountId: null, executionMode: 'confirmation_required' });
    await runRecurringToday();
    let purchases = await purchasesOf(ws());
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ source: 'recurring', installmentsCount: 1, totalCents: 8_900,
      purchaseDate: yesterday() });

    await login(page, tenant.owner.email);
    await openRecurring(page);
    await openRecurringDetails(page, 'Nuvem');
    const [awaiting] = (await occurrencesOf(ws())).filter((occurrence) => occurrence.status === 'awaiting_confirmation');
    const row = occurrenceRow(page, awaiting.id);
    await row.getByRole('button', { name: 'Confirmar' }).click();
    const panel = page.getByRole('form', { name: 'Confirmar compra no cartão' });
    await panel.locator('#occurrence-amount').fill('65.00');
    await panel.getByRole('button', { name: 'Confirmar compra' }).click();
    await expect(panel).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText('Compra no cartão', { exact: true })).toBeVisible({ timeout: 30_000 });
    purchases = await purchasesOf(ws());
    expect(purchases).toHaveLength(2);
    expect(purchases.find((purchase) => purchase.totalCents === 6_500)).toMatchObject({ source: 'recurring' });
    // Nada de cartão nem parcelado em `transactions`.
    const entries = await transactionsOf(ws());
    expect(entries.filter((entry) => entry.cardId || entry.type === 'parcelado')).toHaveLength(0);
  });

  test('atenção: cartão arquivado, nova tentativa depois de reativar; ignorar', async ({ page, request }) => {
    const cardId = await createCardFor(owner(), { name: 'Cartão Antigo', closingDay: 28, dueDay: 5 });
    await createRecurringFor(owner(), { name: 'Revista', amountCents: 2_500, paymentMethod: 'credit_card', cardId,
      cashAccountId: null });
    await createRecurringFor(owner(), { name: 'Jornal', amountCents: 1_500, executionMode: 'confirmation_required' });
    const token = await tokenOf(request, tenant.owner.email);
    const card = (await db().doc(`workspaces/${ws()}/credit_cards/${cardId}`).get()).data() ?? {};
    const version = (stamp: { seconds: number; nanoseconds: number }) =>
      `${new Date(stamp.seconds * 1000).toISOString().slice(0, 19)}.${String(stamp.nanoseconds).padStart(9, '0')}Z`;
    const archived = await callCallable(request, token, 'archiveCreditCard', {
      workspaceId: ws(), idempotencyKey: intentKey('archive'), cardId, expectedUpdatedAt: version(card.updatedAt),
    });
    expect(archived.errorStatus).toBeUndefined();
    await runRecurringToday();
    const attention = (await occurrencesOf(ws())).find((occurrence) => occurrence.status === 'attention_required');
    expect(attention).toMatchObject({ attentionCode: 'card_archived', cardPurchaseId: null });
    expect(await purchasesOf(ws())).toHaveLength(0);

    await login(page, tenant.owner.email);
    await openRecurring(page);
    await openRecurringDetails(page, 'Revista');
    const row = occurrenceRow(page, attention!.id);
    await expect(row.getByText(/Requer atenção · Cartão/)).toBeVisible();
    await expect(row.getByText(/O cartão desta recorrência está arquivado/)).toBeVisible();
    // Sem correção, a nova tentativa volta o erro em pt-BR e nada grava.
    await row.getByRole('button', { name: 'Tentar de novo' }).click();
    await page.getByRole('form', { name: 'Tentar de novo' }).getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /arquivado/ })).toBeVisible({ timeout: 30_000 });
    expect(await purchasesOf(ws())).toHaveLength(0);
    const refreshed = (await db().doc(`workspaces/${ws()}/credit_cards/${cardId}`).get()).data() ?? {};
    const reactivated = await callCallable(request, token, 'reactivateCreditCard', {
      workspaceId: ws(), idempotencyKey: intentKey('reactivate'), cardId,
      expectedUpdatedAt: version(refreshed.updatedAt),
    });
    expect(reactivated.errorStatus).toBeUndefined();
    await page.getByRole('form', { name: 'Tentar de novo' }).getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByText('Compra no cartão', { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await purchasesOf(ws())).toHaveLength(1);

    // Ignorar: terminal, sem fato.
    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await openRecurringDetails(page, 'Jornal');
    const [awaiting] = (await occurrencesOf(ws())).filter((occurrence) => occurrence.status === 'awaiting_confirmation');
    await occurrenceRow(page, awaiting.id).getByRole('button', { name: 'Ignorar' }).click();
    await page.getByRole('form', { name: 'Ignorar ocorrência' }).getByRole('button', { name: 'Ignorar' }).click();
    await expect(occurrenceRow(page, awaiting.id).getByText('Ignorada')).toBeVisible({ timeout: 30_000 });
    expect((await occurrencesOf(ws())).find((occurrence) => occurrence.id === awaiting.id)?.status).toBe('ignored');
    expect(await transactionsOf(ws())).toHaveLength(0);
  });

  test('member administra só as próprias; viewer só lê; perda de permissão recusada', async ({ browser, request }) => {
    await createRecurringFor(owner(), { name: 'Do Titular' });
    const memberId = await createRecurringFor({ uid: tenant.member.uid, workspaceId: ws(), role: 'member' },
      { name: 'Do Membro' });

    const member = await pageAs(browser, tenant.member.email);
    await openRecurring(member);
    await expect(member.getByRole('button', { name: 'Nova' })).toBeVisible();
    await openRecurringDetails(member, 'Do Titular');
    await expect(member.getByRole('button', { name: 'Pausar' })).toHaveCount(0);
    await expect(member.getByRole('button', { name: 'Editar' })).toHaveCount(0);
    await member.getByRole('button', { name: 'Voltar', exact: true }).click();
    await openRecurringDetails(member, 'Do Membro');
    await member.getByRole('button', { name: 'Pausar' }).click();
    await expect(member.getByText('Pausado', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    // Perda de permissão com a tela aberta: recusado, nada gravado.
    await db().doc(`workspaces/${ws()}/members/${tenant.member.uid}`).update({ role: 'viewer' });
    await member.getByRole('button', { name: 'Retomar' }).click();
    await expect(member.getByRole('alert')).toBeVisible({ timeout: 30_000 });
    expect((await recurringDoc(ws(), memberId)).status).toBe('paused');
    await member.context().close();

    const viewer = await pageAs(browser, tenant.viewer.email);
    await openRecurring(viewer);
    await expect(viewer.getByRole('button', { name: 'Nova' })).toHaveCount(0);
    await openRecurringDetails(viewer, 'Do Titular');
    for (const name of ['Pausar', 'Editar', 'Reajustar Valor', 'Cancelar recorrência']) {
      await expect(viewer.getByRole('button', { name })).toHaveCount(0);
    }
    const viewerToken = await tokenOf(request, tenant.viewer.email);
    const forged = await callCallable(request, viewerToken, 'createRecurringExpense', {
      workspaceId: ws(), idempotencyKey: intentKey('viewer'), name: 'Forjada', type: 'other', description: null,
      amountCents: 100, frequency: 'weekly', billingDay: null, startDate: today(), endDate: null,
      paymentMethod: 'pix', executionMode: 'automatic', cardId: null, cashAccountId: mainAccount(),
      categoryId: RECURRING_CATEGORY.id, visual: { color: '#4f46e5', icon: 'Bolt', emoji: null }, business: null,
    });
    expect(forged.errorStatus).toBe('PERMISSION_DENIED');
    await viewer.context().close();
    expect(await recurringExpensesOf(ws())).toHaveLength(2);
  });

  test('troca de workspace: cada espaço mostra só as próprias recorrências', async ({ page }) => {
    await createRecurringFor(owner(), { name: 'Recorrência do Espaço A' });
    const otherOwner = { uid: 'e2e-p4b-owner-b', email: 'e2e-p4b-owner-b@minhas-financas.local' };
    await adminSdk().auth().createUser({ ...otherOwner, password: PASSWORD, emailVerified: true });
    const otherWs = `e2e-p4b-ws-b-${Date.now().toString(36)}`;
    await seedOwnedWorkspace({ ...otherOwner, workspaceId: otherWs, name: 'Empresa Beta E2E', type: 'PJ' });
    await seedAccountProfile(tenant.owner);
    await seedMembership({
      workspaceId: otherWs, uid: tenant.owner.uid, email: tenant.owner.email, role: 'admin',
      name: 'Empresa Beta E2E', type: 'PJ', joinedAt: new Date(Date.now() + 3_600_000),
    });
    await createRecurringFor({ uid: otherOwner.uid, workspaceId: otherWs }, { name: 'Contrato do Espaço B' });

    await login(page, tenant.owner.email);
    await openRecurring(page);
    await expect(page.getByText('Recorrência do Espaço A', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Contrato do Espaço B', { exact: true })).toHaveCount(0);
    await page.getByText('Olá, Usuário').click();
    await page.getByRole('button', { name: /Empresa Beta E2E/ }).click();
    await openRecurring(page, 'PJ');
    await expect(page.getByText('Contrato do Espaço B', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Recorrência do Espaço A', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nova' })).toBeVisible();
  });
});
