import { expect, test, type Locator, type Page } from '@playwright/test';

import { balanceOf, expectLedgerConsistent } from './support/accounts';
import {
  bodyOf,
  callablePosts,
  login,
  pageAs,
  resetEmulatorData,
  seedLoanTenant,
  transactionsOf,
  type LoanTenant,
} from './support/loans';
import {
  addSplitExternalByApi,
  addSplitMemberByApi,
  createSplitBillByApi,
  createSplitGroupByApi,
  openSplit,
  openSplitGroup,
  sharesOfBill,
  splitBillsOf,
  splitDoc,
  splitGroupsOf,
  splitParticipantsOf,
  splitReimbursementsOf,
} from './support/split';
import { defaultCashAccountIdFor } from './support/workspaceSeed';

/**
 * P4-C (D-14) — Divisão de contas autoritativa pela interface, no Emulator
 * (Auth, Firestore e Functions reais, sem mocks):
 * - criar grupo; incluir participante externo (só nome) e membro do espaço;
 *   lançar despesa com divisão igual exata e o pagamento no Caixa no mesmo
 *   commit; envio duplo cria um só;
 * - "Registrar recebimento" só para o pagador/dono/admin — nunca o devedor —
 *   e sem mover o Caixa; estorno do recebimento;
 * - anular despesa lançada no Caixa: compensação na mesma conta, histórico
 *   preservado;
 * - viewer do espaço só lê;
 * - PJ: reembolso solicitado pelo membro; owner aprova, paga pelo Caixa e
 *   estorna o pagamento (volta a aprovado).
 * Em todos: nenhuma escrita do cliente em `transactions` nem em `split_*`.
 */
let tenant: LoanTenant;
const ws = () => tenant.workspaceId;
const mainAccount = () => defaultCashAccountIdFor(ws());

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
    expect(decoded).not.toMatch(/\/split_[a-z_]+\//);
  }
};

/** Dois envios no mesmo tique: só a trava síncrona barra o segundo. */
const submitTwiceAtOnce = (form: Locator) =>
  form.evaluate((element) => {
    const target = element as HTMLFormElement;
    target.requestSubmit();
    target.requestSubmit();
  });

const billDialog = (page: Page) => page.getByRole('dialog').filter({ has: page.locator('#split-bill-details-title') });
const formDialog = (page: Page) => page.getByRole('dialog').filter({ has: page.locator('#modal-title') });
const confirmDialog = (page: Page) =>
  page.getByRole('dialog').filter({ has: page.locator('#confirmation-modal-title') });

test.describe('PF', () => {
  test.beforeEach(async () => {
    await resetEmulatorData();
    tenant = await seedLoanTenant('PF', 'p4c');
  });

  test('criar grupo, incluir externo e membro; despesa igual exata no Caixa; envio duplo cria um só',
    async ({ page }) => {
      await login(page, tenant.owner.email);
      const writes = clientWrites(page);
      await openSplit(page);
      const groupPosts = callablePosts(page, 'createSplitGroup');
      await page.getByRole('button', { name: 'Novo Grupo' }).click();
      await page.getByPlaceholder('Ex: Casa Praia, República...').fill('Viagem à praia');
      await submitTwiceAtOnce(page.locator('form#splitGroupForm'));
      await expect(page.locator('form#splitGroupForm')).toBeHidden({ timeout: 30_000 });
      expect(groupPosts).toHaveLength(1);
      const groupBody = bodyOf(groupPosts[0]);
      expect(groupBody).toMatchObject({ workspaceId: ws(), name: 'Viagem à praia', businessMode: 'split' });
      for (const key of ['ownerUserId', 'ownerParticipantId', 'status', 'counters', 'totals']) {
        expect(groupBody).not.toHaveProperty(key);
      }
      const [group] = await splitGroupsOf(ws());
      expect(group).toMatchObject({ name: 'Viagem à praia', status: 'active', ownerUserId: tenant.owner.uid });

      await openSplitGroup(page, 'Viagem à praia');
      await page.getByRole('button', { name: 'Configurações e Participantes' }).click();
      const settings = page.getByRole('dialog', { name: 'Configurações do Grupo' });
      await expect(settings).toBeVisible();
      await settings.getByLabel('Nome do participante externo').fill('Fulana Externa');
      await settings.getByLabel('Nome do participante externo').locator('xpath=..')
        .getByRole('button', { name: 'Adicionar' }).click();
      await expect(settings.getByText('Fulana Externa')).toBeVisible({ timeout: 20_000 });
      await settings.getByLabel('Membro do espaço').selectOption({ label: tenant.member.email });
      await settings.getByLabel('Membro do espaço').locator('xpath=..')
        .getByRole('button', { name: 'Adicionar' }).click();
      await expect.poll(async () => (await splitParticipantsOf(ws()))
        .some((item) => item.userId === tenant.member.uid), { timeout: 20_000 }).toBe(true);
      await expect(settings.getByLabel('Membro do espaço').locator('option', { hasText: tenant.member.email }))
        .toHaveCount(0);
      await settings.getByRole('button', { name: 'Fechar' }).click();
      const participants = await splitParticipantsOf(ws());
      const external = participants.find((item) => item.kind === 'external');
      expect(external).toMatchObject({ displayName: 'Fulana Externa', userId: null, role: 'participant' });
      expect(participants.find((item) => item.userId === tenant.member.uid)).toMatchObject({
        kind: 'workspace_member', displayName: null, role: 'participant',
      });

      const before = await balanceOf(ws(), mainAccount());
      const billPosts = callablePosts(page, 'createSplitBill');
      await page.getByRole('button', { name: 'Nova Despesa' }).click();
      const dialog = formDialog(page);
      await expect(dialog.getByRole('heading', { name: 'Nova Conta Compartilhada' })).toBeVisible();
      await dialog.locator('#split-bill-description').fill('Jantar na praia');
      await dialog.locator('#split-bill-amount').fill('100.00');
      await expect(dialog.locator('#integrate')).toBeChecked();
      await expect(dialog.locator('#split-bill-account')).toHaveValue(mainAccount());
      // Prévia exata: 33,34 + 33,33 + 33,33 (o centavo vai para a menor posição pelo ID).
      await expect(dialog.getByText(/^R\$\s33,34$/)).toHaveCount(1);
      await expect(dialog.getByText(/^R\$\s33,33$/)).toHaveCount(2);
      await submitTwiceAtOnce(dialog.locator('form#splitBillForm'));
      await expect(dialog).toBeHidden({ timeout: 30_000 });

      expect(billPosts).toHaveLength(1);
      const billBody = bodyOf(billPosts[0]);
      expect(billBody).toMatchObject({
        workspaceId: ws(), description: 'Jantar na praia', amountCents: 10_000, allocationMethod: 'equal',
        financialIntegration: 'cash', cashAccountId: mainAccount(), cardId: null, installmentsCount: null,
      });
      expect((billBody.participants as unknown[]).length).toBe(3);
      for (const item of billBody.participants as Record<string, unknown>[]) {
        expect(Object.keys(item)).toEqual(['participantId']);
      }

      const [bill] = await splitBillsOf(ws());
      expect(bill).toMatchObject({ status: 'open', amountCents: 10_000, financialIntegration: 'cash' });
      const shares = await sharesOfBill(ws(), bill.id);
      expect(shares.map((share) => share.amountDueCents).sort()).toEqual([3_333, 3_333, 3_334]);
      expect(shares.reduce((sum, share) => sum + share.amountDueCents, 0)).toBe(10_000);
      const mirror = (await transactionsOf(ws())).find((entry) => entry.id === bill.cashTransactionId);
      expect(mirror).toMatchObject({ type: 'despesa', valueCents: 10_000, cashAccountId: mainAccount() });
      expect(mirror?.splitEntry).toMatchObject({ kind: 'bill_expense', billId: bill.id, reversal: false });
      await expect.poll(() => balanceOf(ws(), mainAccount())).toBe(before - 10_000);
      await expectLedgerConsistent(ws());

      await expect(page.getByRole('heading', { name: 'Jantar na praia', level: 4 })).toBeVisible();
      await expect(page.getByText('PENDENTE', { exact: true })).toBeVisible();
      await expect(page.getByText(/^R\$\s100,00$/).first()).toBeVisible();
      expectNoClientWritesTo(writes);
    });

  test('Registrar recebimento: pagador registra, devedor não; não move o Caixa; estorno', async ({
    page, browser, request,
  }) => {
    const { groupId, ownerParticipantId } = await createSplitGroupByApi(request, tenant.owner.email, ws(),
      { name: 'Casa de praia' });
    const memberId = await addSplitMemberByApi(request, tenant.owner.email, ws(), groupId, tenant.member.uid);
    const billId = await createSplitBillByApi(request, tenant.owner.email, ws(), groupId, ownerParticipantId,
      [ownerParticipantId, memberId], { description: 'Mercado', amountCents: 9_000 });
    const before = await balanceOf(ws(), mainAccount());

    // O devedor vê a própria dívida e não registra o recebimento.
    const memberPage = await pageAs(browser, tenant.member.email);
    await openSplit(memberPage);
    await openSplitGroup(memberPage, 'Casa de praia');
    await memberPage.getByRole('heading', { name: 'Mercado', level: 4 }).click();
    const memberDialog = billDialog(memberPage);
    await expect(memberDialog.getByText('Você deve')).toBeVisible();
    await expect(memberDialog.getByRole('button', { name: 'Registrar recebimento' })).toHaveCount(0);
    await expect(memberDialog.getByRole('button', { name: 'Perdoar' })).toHaveCount(0);
    await memberPage.context().close();

    await login(page, tenant.owner.email);
    const writes = clientWrites(page);
    await openSplit(page);
    await openSplitGroup(page, 'Casa de praia');
    await page.getByRole('heading', { name: 'Mercado', level: 4 }).click();
    const dialog = billDialog(page);
    await expect(dialog.getByText('Pagou a conta')).toBeVisible();
    const settles = callablePosts(page, 'settleSplitShare');
    await dialog.getByRole('button', { name: 'Registrar recebimento' }).click();
    await expect(dialog.getByText('Recebimento registrado')).toBeVisible({ timeout: 20_000 });
    expect(settles).toHaveLength(1);
    const [memberShare] = (await sharesOfBill(ws(), billId)).filter((share) => share.participantId === memberId);
    expect(memberShare).toMatchObject({ status: 'settled', settledVia: 'settlement', amountSettledCents: 4_500 });
    expect((await splitDoc(ws(), 'split_bills', billId)).status).toBe('settled');
    // Registrar recebimento é fato da Divisão: não movimenta o Caixa.
    expect(await balanceOf(ws(), mainAccount())).toBe(before);
    expect((await transactionsOf(ws())).filter((entry) => entry.splitEntry)).toHaveLength(0);

    await dialog.getByRole('button', { name: 'Estornar recebimento' }).click();
    await expect(dialog.getByRole('button', { name: 'Registrar recebimento' })).toBeVisible({ timeout: 20_000 });
    const [reverted] = (await sharesOfBill(ws(), billId)).filter((share) => share.participantId === memberId);
    expect(reverted).toMatchObject({ status: 'open', amountSettledCents: 0 });
    expect((await splitDoc(ws(), 'split_bills', billId)).status).toBe('open');
    expect(await balanceOf(ws(), mainAccount())).toBe(before);
    expectNoClientWritesTo(writes);
  });

  test('anular despesa lançada no Caixa: compensação na mesma conta; histórico preservado', async ({
    page, request,
  }) => {
    const { groupId, ownerParticipantId } = await createSplitGroupByApi(request, tenant.owner.email, ws(),
      { name: 'Churrasco' });
    const externalId = await addSplitExternalByApi(request, tenant.owner.email, ws(), groupId, 'Beltrano');
    const before = await balanceOf(ws(), mainAccount());
    const billId = await createSplitBillByApi(request, tenant.owner.email, ws(), groupId, ownerParticipantId,
      [ownerParticipantId, externalId], {
        description: 'Carnes', amountCents: 12_345, financialIntegration: 'cash', cashAccountId: mainAccount(),
      });
    await expect.poll(() => balanceOf(ws(), mainAccount())).toBe(before - 12_345);

    await login(page, tenant.owner.email);
    const writes = clientWrites(page);
    await openSplit(page);
    await openSplitGroup(page, 'Churrasco');
    await page.getByRole('heading', { name: 'Carnes', level: 4 }).click();
    const dialog = billDialog(page);
    await expect(dialog.getByText('Lançada no Caixa')).toBeVisible();
    await dialog.getByRole('button', { name: 'Anular Despesa' }).click();
    await expect(dialog.getByText(/compensado por um estorno na mesma conta/)).toBeVisible();
    const voids = callablePosts(page, 'voidSplitBill');
    await dialog.getByRole('button', { name: 'Confirmar Anulação' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    expect(voids).toHaveLength(1);

    const bill = await splitDoc(ws(), 'split_bills', billId);
    expect(bill.status).toBe('voided');
    const entries = (await transactionsOf(ws())).filter((entry) => entry.splitEntry?.billId === billId);
    expect(entries).toHaveLength(2);
    const reversal = entries.find((entry) => entry.splitEntry.reversal);
    expect(reversal).toMatchObject({ type: 'receita', valueCents: 12_345, cashAccountId: mainAccount() });
    expect(reversal?.splitEntry.reversalOf).toBe(bill.cashTransactionId);
    await expect.poll(() => balanceOf(ws(), mainAccount())).toBe(before);
    await expectLedgerConsistent(ws());
    // A despesa continua no histórico, anulada, e sai dos totais do grupo.
    await expect(page.getByRole('heading', { name: 'Carnes', level: 4 })).toBeVisible();
    await expect(page.getByText('ANULADA', { exact: true })).toBeVisible();
    const group = await splitDoc(ws(), 'split_groups', groupId);
    expect(group.totals).toMatchObject({ billedCents: 0, openCents: 0 });
    expectNoClientWritesTo(writes);
  });

  test('viewer do espaço só lê: não cria grupo, não lança, não administra', async ({ page, request }) => {
    const { groupId, ownerParticipantId } = await createSplitGroupByApi(request, tenant.owner.email, ws(),
      { name: 'Condomínio' });
    await createSplitBillByApi(request, tenant.owner.email, ws(), groupId, ownerParticipantId,
      [ownerParticipantId], { description: 'Água' });
    await login(page, tenant.viewer.email);
    const writes = clientWrites(page);
    await openSplit(page);
    await expect(page.getByRole('button', { name: 'Novo Grupo' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeDisabled();
    await openSplitGroup(page, 'Condomínio');
    await expect(page.getByRole('heading', { name: 'Água', level: 4 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova Despesa' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Editar Grupo' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Configurações e Participantes' }).click();
    await expect(page.getByText('Adicionar Participante')).toHaveCount(0);
    await page.getByRole('button', { name: 'Fechar' }).click();
    await page.getByRole('heading', { name: 'Água', level: 4 }).click();
    const dialog = billDialog(page);
    await expect(dialog.getByRole('button', { name: 'Anular Despesa' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Registrar recebimento' })).toHaveCount(0);
    expectNoClientWritesTo(writes);
  });
});

test.describe('PJ', () => {
  test.beforeEach(async () => {
    await resetEmulatorData();
    tenant = await seedLoanTenant('PJ', 'p4c-pj');
  });

  test('reembolso: membro solicita; owner aprova, paga pelo Caixa e estorna', async ({ page, browser, request }) => {
    const { groupId } = await createSplitGroupByApi(request, tenant.owner.email, ws(),
      { name: 'Reembolsos Comercial', businessMode: 'reimbursement' });
    await addSplitMemberByApi(request, tenant.owner.email, ws(), groupId, tenant.member.uid);

    const memberPage = await pageAs(browser, tenant.member.email);
    const memberWrites = clientWrites(memberPage);
    await openSplit(memberPage, 'PJ');
    await memberPage.getByRole('button', { name: /Reembolsos$/ }).click();
    await openSplitGroup(memberPage, 'Reembolsos Comercial');
    const requests = callablePosts(memberPage, 'createSplitReimbursement');
    await memberPage.getByRole('button', { name: 'Solicitar Reembolso' }).click();
    const form = formDialog(memberPage);
    await expect(form.getByRole('heading', { name: 'Solicitar Reembolso' })).toBeVisible();
    await expect(form.locator('#split-bill-payer')).toBeDisabled();
    await form.locator('#split-bill-description').fill('Táxi até o cliente');
    await form.locator('#split-bill-amount').fill('87.50');
    await submitTwiceAtOnce(form.locator('form#splitBillForm'));
    await expect(form).toBeHidden({ timeout: 30_000 });
    expect(requests).toHaveLength(1);
    expect(bodyOf(requests[0])).toMatchObject({ amountCents: 8_750, description: 'Táxi até o cliente' });
    const [item] = await splitReimbursementsOf(ws());
    expect(item).toMatchObject({ status: 'requested', requesterUserId: tenant.member.uid, amountCents: 8_750 });
    await expect(memberPage.getByText('Solicitado', { exact: true })).toBeVisible();
    // Quem pede não aprova nem paga.
    await expect(memberPage.getByRole('button', { name: 'Aprovar' })).toHaveCount(0);
    expectNoClientWritesTo(memberWrites);
    await memberPage.context().close();

    await login(page, tenant.owner.email);
    const writes = clientWrites(page);
    await openSplit(page, 'PJ');
    await page.getByRole('button', { name: /Reembolsos$/ }).click();
    await openSplitGroup(page, 'Reembolsos Comercial');
    await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
    await confirmDialog(page).getByRole('button', { name: 'Aprovar', exact: true }).click();
    await expect(page.getByText('Aprovado', { exact: true })).toBeVisible({ timeout: 20_000 });

    const before = await balanceOf(ws(), mainAccount());
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    const pay = page.getByRole('dialog', { name: 'Pagar Reembolso' });
    await expect(pay.locator('#split-pay-account')).toHaveValue(mainAccount());
    const pays = callablePosts(page, 'paySplitReimbursement');
    await submitTwiceAtOnce(pay.locator('form'));
    await expect(pay).toBeHidden({ timeout: 30_000 });
    expect(pays).toHaveLength(1);
    await expect(page.getByText('Pago', { exact: true })).toBeVisible({ timeout: 20_000 });
    const paid = await splitDoc(ws(), 'split_reimbursements', item.id);
    expect(paid).toMatchObject({ status: 'paid', cashAccountId: mainAccount() });
    const payment = (await transactionsOf(ws())).find((entry) => entry.id === paid.cashTransactionId);
    expect(payment).toMatchObject({ type: 'despesa', valueCents: 8_750, description: 'Reembolso de despesa' });
    expect(payment?.splitEntry).toMatchObject({ kind: 'reimbursement_payment', reimbursementId: item.id });
    await expect.poll(() => balanceOf(ws(), mainAccount())).toBe(before - 8_750);

    await page.getByRole('button', { name: 'Estornar Pagamento', exact: true }).click();
    await confirmDialog(page).getByRole('button', { name: 'Estornar Pagamento', exact: true }).click();
    await expect(page.getByText('Aprovado', { exact: true })).toBeVisible({ timeout: 20_000 });
    const reverted = await splitDoc(ws(), 'split_reimbursements', item.id);
    expect(reverted).toMatchObject({ status: 'approved', cashTransactionId: null, paymentDate: null });
    const entries = (await transactionsOf(ws())).filter((entry) => entry.splitEntry?.reimbursementId === item.id);
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.splitEntry.reversal)).toMatchObject({ type: 'receita', valueCents: 8_750 });
    await expect.poll(() => balanceOf(ws(), mainAccount())).toBe(before);
    await expectLedgerConsistent(ws());
    expectNoClientWritesTo(writes);
  });
});
