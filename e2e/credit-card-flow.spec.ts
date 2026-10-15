import { expect, test, type Page, type Route } from '@playwright/test';

import { createAccountByApi, expectLedgerConsistent, movementsOfAccount, balanceOf } from './support/accounts';
import { callCallable } from './support/callables';
import {
  buyInThePast,
  buyToday,
  CARD_VISUAL,
  cardDoc,
  cardsOf,
  competenceLabel,
  createCardByBackend,
  createCardFor,
  earlyPaymentCycle,
  entriesOf,
  expectCardConsistent,
  invoiceDoc,
  invoicesOf,
  invoiceSummary,
  openCardDetails,
  openCards,
  paymentsOf,
  purchasesOf,
  runClosingToday,
} from './support/cards';
import {
  bodyOf,
  callablePosts,
  cashPeriod,
  dayKey,
  db,
  dialogNamed,
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
  adminSdk,
  defaultCashAccountIdFor,
  seedAccountProfile,
  seedMembership,
  seedOwnedWorkspace,
} from './support/workspaceSeed';

/**
 * P4-A (D-36) — cartões de crédito autoritativos pela interface, no Emulator
 * (Auth, Firestore e Functions reais, sem mocks):
 * - cartão criado e editado pela tela, limite em centavos, clique duplo sem
 *   duplicar;
 * - compra à vista, parcelada e retroativa só pela callable (nunca
 *   `parcelado` em `transactions`), prévia com o aviso retroativo, clique
 *   duplo e reenvio depois de resposta perdida sem duplicar;
 * - fatura fechada pela rotina real; pagamento parcial e antecipado pela
 *   conta escolhida; estorno volta à mesma conta; pagamento total; fatura
 *   aberta não é paga; caixa só no pagamento, fora de despesa;
 * - cancelamento (parcelas abertas), estorno de compra faturada (crédito na
 *   aberta), ajuste manual com compensação, arquivamento recusado com
 *   pendência e aceito sem ela, reativação;
 * - member compra e não administra; viewer só lê; perda de papel com o
 *   diálogo aberto; troca de workspace.
 * Em todos, o limite fecha com o razão e cada fatura com os lançamentos.
 */
let tenant: LoanTenant;
const ws = () => tenant.workspaceId;
const mainAccount = () => defaultCashAccountIdFor(ws());

const CATEGORY = 'Eletrônicos P4-A';

const normalize = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Catálogo do lançamento no cartão (do cliente, fora do domínio): a
 * categoria e os produtos que o member usa — member não cria item novo no
 * catálogo (regra anterior à P4-A).
 */
const MEMBER_PRODUCTS = ['Teclado', 'Mouse'];

const seedCardCategory = async (workspaceId: string, uid: string) => {
  const now = new Date();
  const item = (id: string, group: string, name: string, subtype?: string) => {
    const normalizedName = normalize(name);
    return db().doc(`workspaces/${workspaceId}/settings_catalog/${id}`).set({
      id, workspaceId, group, name, normalizedName,
      ...(subtype ? { transactionSubtype: subtype } : {}),
      dedupeKey: `${group}::${subtype ?? 'all'}::both::${normalizedName}`,
      workspaceScope: 'both', sortOrder: 1, status: 'active',
      createdBy: uid, updatedBy: uid, createdAt: now, updatedAt: now,
    });
  };
  await Promise.all([
    // D-23 (P4-E): a aba Parcelado usa as categorias de despesa.
    item('p4a-card-category', 'category', CATEGORY, 'despesa'),
    ...MEMBER_PRODUCTS.map((name, index) => item(`p4a-product-${index}`, 'product_service', name)),
  ]);
};

const statusNotice = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

const backToDashboard = async (page: Page) => {
  await page.getByRole('link', { name: /Dashboard/i }).click();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 20_000 });
};

const transactionDialog = (page: Page) =>
  page.getByRole('dialog').filter({ has: page.locator('#transaction-modal-title') });

/** Abre o lançamento no cartão e preenche; não envia. */
const fillCardPurchase = async (page: Page, input: {
  cardId: string; description: string; value: string; installments: string; date?: string;
}) => {
  await page.getByRole('button', { name: /Nova Transação/i }).first().click();
  const dialog = transactionDialog(page);
  await dialog.getByRole('button', { name: /^Cartão$/ }).click();
  const form = dialog.locator('form');
  await form.locator('select').first().selectOption(input.cardId);
  await form.getByPlaceholder('Busque, selecione ou digite um novo item...').fill(input.description);
  await form.locator('select').nth(1).selectOption({ label: CATEGORY });
  await form.locator('input[type="date"]').fill(input.date ?? today());
  await form.locator('input[type="number"]').nth(0).fill(input.value);
  await form.locator('input[type="number"]').nth(1).fill(input.installments);
  await expect(dialog.getByTestId('card-purchase-preview')).toBeVisible();
  return dialog;
};

/**
 * Dois envios no mesmo tick (mais rápido que qualquer clique duplo): só a
 * trava síncrona impede o segundo — o botão desabilitado não chega a valer.
 */
const submitTwiceAtOnce = (form: ReturnType<Page['locator']>) =>
  form.evaluate((element) => {
    const target = element as HTMLFormElement;
    target.requestSubmit();
    target.requestSubmit();
  });

const submitPurchase = (dialog: ReturnType<typeof transactionDialog>) =>
  dialog.getByRole('button', { name: 'Revisar e Adicionar Parcelado' });

const purchaseByDescription = async (description: string) => {
  const found = (await purchasesOf(ws())).filter((purchase) => purchase.description === description);
  return found;
};

test.describe('PF', () => {
  test.beforeEach(async () => {
    await resetEmulatorData();
    tenant = await seedLoanTenant('PF', 'p4a');
    await seedCardCategory(ws(), tenant.owner.uid);
  });

  test('cartão: criado e editado pela tela em centavos; envio duplo cria um só', async ({ page }) => {
    await login(page, tenant.owner.email);
    await openCards(page);
    await expect(page.getByText('Nenhum cartão encontrado.')).toBeVisible();

    const creates = callablePosts(page, 'createCreditCard');
    await page.getByRole('button', { name: 'Novo Cartão' }).click();
    const cardForm = page.locator('form#cardForm');
    await cardForm.getByPlaceholder('Ex: Nubank Empresarial').fill('Cartão Roxo');
    await cardForm.locator('input[type="number"]').nth(0).fill('5000.50');
    await cardForm.locator('input[type="number"]').nth(1).fill('10');
    await cardForm.locator('input[type="number"]').nth(2).fill('20');
    await submitTwiceAtOnce(cardForm);
    await expect(cardForm).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText('Cartão Roxo', { exact: true }).first()).toBeVisible();

    // Um envio só: a trava síncrona barra o segundo clique.
    expect(creates).toHaveLength(1);
    const body = bodyOf(creates[0]);
    expect(body).toMatchObject({ workspaceId: ws(), name: 'Cartão Roxo', closingDay: 10, dueDay: 20, limitTotalCents: 500_050 });
    for (const key of ['limitTotal', 'limitUsedCents', 'limitAvailableCents', 'status', 'createdBy']) {
      expect(body).not.toHaveProperty(key);
    }
    const cards = await cardsOf(ws());
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      name: 'Cartão Roxo', status: 'active', limitTotalCents: 500_050, limitUsedCents: 0, limitAvailableCents: 500_050,
      closingDay: 10, dueDay: 20, schemaVersion: 1,
    });

    // Edição: só o que mudou, com a versão lida; limite em centavos.
    const updates = callablePosts(page, 'updateCreditCard');
    await openCardDetails(page, 'Cartão Roxo');
    await page.getByRole('button', { name: 'Editar' }).click();
    await expect(cardForm.locator('input[type="number"]').nth(0)).toHaveValue('5000.50');
    await cardForm.locator('input[type="number"]').nth(0).fill('6000');
    await page.getByRole('button', { name: 'Salvar Cartão' }).click();
    await expect(cardForm).toBeHidden({ timeout: 30_000 });
    expect(updates).toHaveLength(1);
    expect(bodyOf(updates[0])).toMatchObject({ cardId: cards[0].id, changes: { limitTotalCents: 600_000 } });
    expect(Object.keys(bodyOf(updates[0]).changes as Record<string, unknown>)).toEqual(['limitTotalCents']);
    expect(typeof bodyOf(updates[0]).expectedUpdatedAt).toBe('string');
    expect(await cardDoc(ws(), cards[0].id)).toMatchObject({ limitTotalCents: 600_000, limitAvailableCents: 600_000 });
    await expectCardConsistent(ws(), cards[0].id);
  });

  test('compra manual só pela callable: à vista, parcelada e retroativa; nada de parcelado; clique duplo e resposta perdida', async ({ page }) => {
    const cardId = await createCardByBackend(tenant, { name: 'Cartão Compras' });
    await login(page, tenant.owner.email);
    const purchases = callablePosts(page, 'createCreditCardPurchase');

    // À vista (uma parcela).
    let dialog = await fillCardPurchase(page, { cardId, description: 'Fone de ouvido', value: '100', installments: '1' });
    await submitPurchase(dialog).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    expect(bodyOf(purchases[0])).toMatchObject({
      workspaceId: ws(), cardId, description: 'Fone de ouvido', category: CATEGORY,
      purchaseDate: today(), totalCents: 10_000, installmentsCount: 1,
    });
    for (const key of ['type', 'source', 'value', 'installments', 'invoiceId', 'createdBy']) {
      expect(bodyOf(purchases[0])).not.toHaveProperty(key);
    }

    // Parcelada em 3x pelo valor total, com envio duplo: uma compra só.
    dialog = await fillCardPurchase(page, { cardId, description: 'Notebook', value: '100', installments: '3' });
    await submitTwiceAtOnce(dialog.locator('form'));
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    expect(purchases.filter((request) => bodyOf(request).description === 'Notebook')).toHaveLength(1);
    const notebook = await purchaseByDescription('Notebook');
    expect(notebook).toHaveLength(1);
    expect(notebook[0]).toMatchObject({ source: 'manual', status: 'active', totalCents: 10_000, installmentsCount: 3 });
    const installments = (await entriesOf(ws()))
      .filter((entry) => entry.purchaseId === notebook[0].id)
      .sort((a, b) => a.installmentNumber - b.installmentNumber);
    expect(installments.map((entry) => entry.amountCents)).toEqual([3_334, 3_333, 3_333]);

    // Retroativa: a prévia avisa que vai para a fatura aberta; data mantida.
    const oldDate = dayKey(-45);
    dialog = await fillCardPurchase(page, { cardId, description: 'Compra esquecida', value: '90', installments: '3', date: oldDate });
    await expect(dialog.getByTestId('card-purchase-retroactive-warning'))
      .toContainText('A data informada é de uma fatura já fechada');
    await submitPurchase(dialog).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    const retro = (await purchaseByDescription('Compra esquecida'))[0];
    expect(retro).toMatchObject({ purchaseDate: oldDate, retroactive: true });
    const invoices = await invoicesOf(ws());
    for (const entry of (await entriesOf(ws())).filter((item) => item.purchaseId === retro.id)) {
      const invoice = invoices.find((item) => item.id === entry.invoiceId)!;
      expect(invoice.cycleStatus, 'parcela retroativa nunca entra em fatura fechada').toBe('open');
      expect(invoice.closingDate > today()).toBe(true);
    }

    // Resposta perdida: o backend gravou, o navegador não soube; o reenvio do
    // mesmo conteúdo reusa a chave e devolve a mesma compra.
    let lost = false;
    await page.route('**/createCreditCardPurchase', async (route: Route) => {
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort('connectionreset');
        return;
      }
      await route.continue();
    });
    dialog = await fillCardPurchase(page, { cardId, description: 'Cadeira', value: '250', installments: '2' });
    await submitPurchase(dialog).click();
    await expect(dialog.getByRole('alert')).toContainText('Não foi possível confirmar a operação');
    await expect.poll(async () => (await purchaseByDescription('Cadeira')).length).toBe(1);
    await submitPurchase(dialog).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await page.unroute('**/createCreditCardPurchase');
    const chairBodies = purchases.filter((request) => bodyOf(request).description === 'Cadeira');
    expect(chairBodies).toHaveLength(2);
    expect(bodyOf(chairBodies[1]).idempotencyKey).toBe(bodyOf(chairBodies[0]).idempotencyKey);
    expect(await purchaseByDescription('Cadeira')).toHaveLength(1);

    // Nenhum lançamento `parcelado` (nem qualquer espelho de compra) no caixa.
    const transactions = await transactionsOf(ws());
    expect(transactions.filter((item) => item.type === 'parcelado')).toEqual([]);
    expect(transactions.filter((item) => item.cardId || item.creditCardPurchaseId)).toEqual([]);
    const { card } = await expectCardConsistent(ws(), cardId);
    expect(card.limitUsedCents).toBe(10_000 + 10_000 + 9_000 + 25_000);
  });

  test('fatura fechada pela rotina: pagamento parcial e antecipado pela conta escolhida, estorno na mesma conta, total', async ({ page, request }) => {
    const cycle = earlyPaymentCycle();
    const cardId = await createCardByBackend(tenant, { name: 'Cartão Fatura', ...cycle });
    await buyInThePast(tenant, cardId, { description: 'Passagem aérea', totalCents: 30_000 });
    await buyToday(tenant, cardId, { description: 'Livro', totalCents: 4_000 });
    const closing = await runClosingToday();
    expect(closing.closed).toBeGreaterThanOrEqual(1);
    const closed = (await invoicesOf(ws())).find((invoice) => invoice.cycleStatus === 'closed')!;
    const open = (await invoicesOf(ws())).find((invoice) => invoice.cycleStatus === 'open')!;
    expect(closed).toMatchObject({ totalCents: 30_000, paidCents: 0, paymentStatus: 'unpaid' });
    expect(closed.closingDate <= today() && today() < closed.dueDate, 'pagamento antecipado possível').toBe(true);
    expect(open).toMatchObject({ totalCents: 4_000 });

    const token = await tokenOf(request, tenant.owner.email);
    const payer = await createAccountByApi(request, token, ws(), 'Conta pagadora', { openingBalanceCents: 100_000 });

    await login(page, tenant.owner.email);
    await openCards(page);
    await openCardDetails(page, 'Cartão Fatura');
    // Fatura aberta não é paga.
    const openCard = invoiceSummary(page, `Fatura ${competenceLabel(open.competenceMonth)}`);
    await expect(openCard.getByRole('button', { name: 'Aguardando fechamento' })).toBeDisabled();
    // Seções: a fechada e não vencida é a próxima a pagar; a aberta é a do ciclo aberto.
    await expect(page.getByText('Fatura do ciclo aberto', { exact: true })).toBeVisible();
    await expect(page.getByText('Próxima fatura a pagar', { exact: true })).toBeVisible();

    const closedCard = invoiceSummary(page, `Fatura ${competenceLabel(closed.competenceMonth)}`);
    await expect(closedCard).toContainText('Fechada');
    await closedCard.getByRole('button', { name: 'Ver detalhes da fatura' }).click();
    const drawer = page.getByTestId(`credit-card-invoice-details-drawer-${closed.id}`);
    await expect(drawer.getByTestId('card-invoice-total')).toHaveText(/300,00/);
    await expect(drawer.getByTestId('card-invoice-entry')).toContainText('Passagem aérea');

    // Parcial e antecipado, da conta escolhida; envio duplo não duplica.
    const payments = callablePosts(page, 'registerInvoicePayment');
    await drawer.getByRole('button', { name: 'Pagamento parcial' }).click();
    let modal = page.getByRole('dialog', { name: `Pagamento da fatura ${competenceLabel(closed.competenceMonth)}` });
    await modal.getByLabel('Valor a pagar').fill('100');
    await modal.getByLabel('Conta de origem').selectOption(payer);
    await submitTwiceAtOnce(modal.locator('form'));
    await expect(modal).toBeHidden({ timeout: 30_000 });
    await expect(statusNotice(page, 'Pagamento registrado.')).toBeVisible();
    expect(payments).toHaveLength(1);
    expect(bodyOf(payments[0])).toMatchObject({
      cardId, invoiceId: closed.id, cashAccountId: payer, amountCents: 10_000, paymentDate: today(),
    });
    for (const key of ['walletId', 'paymentMethod', 'paidCents']) expect(bodyOf(payments[0])).not.toHaveProperty(key);
    expect(await invoiceDoc(ws(), closed.id)).toMatchObject({ paidCents: 10_000, remainingCents: 20_000, paymentStatus: 'partial' });
    expect(await balanceOf(ws(), payer)).toBe(90_000);
    const payerMovements = await movementsOfAccount(ws(), payer);
    expect(payerMovements.find((movement) => movement.kind === 'credit_card_payment')).toMatchObject({
      amountCents: -10_000, sourceDomain: 'credit_card', sourceId: closed.id,
    });
    expect((await cardDoc(ws(), cardId)).limitUsedCents).toBe(34_000 - 10_000);

    // Estorno do pagamento: volta para a mesma conta; histórico mantido.
    await expect(drawer.getByTestId('card-invoice-payment')).toContainText('Conta pagadora');
    await drawer.getByTestId('card-invoice-payment').getByRole('button', { name: 'Estornar' }).click();
    const reverse = dialogNamed(page, 'Estornar pagamento');
    await expect(reverse).toContainText('Conta do estorno: Conta pagadora');
    await reverse.getByRole('button', { name: 'Estornar pagamento' }).click();
    await expect(reverse).toBeHidden({ timeout: 30_000 });
    await expect(statusNotice(page, 'Pagamento estornado.')).toBeVisible();
    expect(await balanceOf(ws(), payer)).toBe(100_000);
    expect(await invoiceDoc(ws(), closed.id)).toMatchObject({ paidCents: 0, paymentStatus: 'unpaid' });
    const allPayments = await paymentsOf(ws());
    expect(allPayments.map((payment) => payment.kind).sort()).toEqual(['payment', 'reversal']);
    expect(allPayments.find((payment) => payment.kind === 'reversal')).toMatchObject({ cashAccountId: payer });
    await expect(drawer.getByTestId('card-invoice-payment').filter({ hasText: 'Pagamento da fatura' }))
      .toContainText('Estornado');

    // Total pela fatura, da mesma conta: paga, limite volta.
    await drawer.getByRole('button', { name: 'Pagar total' }).click();
    modal = page.getByRole('dialog', { name: `Pagamento da fatura ${competenceLabel(closed.competenceMonth)}` });
    await expect(modal.getByLabel('Valor a pagar')).toHaveValue('300.00');
    await modal.getByLabel('Conta de origem').selectOption(payer);
    await modal.getByRole('button', { name: 'Confirmar pagamento' }).click();
    await expect(modal).toBeHidden({ timeout: 30_000 });
    await expect(drawer.getByTestId('card-invoice-status')).toHaveText('Paga');
    expect(await invoiceDoc(ws(), closed.id)).toMatchObject({ paidCents: 30_000, remainingCents: 0, paymentStatus: 'paid' });
    expect(await balanceOf(ws(), payer)).toBe(70_000);
    expect(await balanceOf(ws(), mainAccount())).toBe(0);

    // Caixa: espelho de liquidação (não é despesa); projeção fora de despesa.
    const mirrors = (await transactionsOf(ws())).filter((item) => item.creditCardPaymentEntry);
    expect(mirrors).toHaveLength(3);
    expect(mirrors.every((item) => item.id.startsWith('cccash_'))).toBe(true);
    await expect.poll(async () => (await cashPeriod(ws())).creditCardPaymentCents, { timeout: 30_000 }).toBe(30_000);
    expect((await cashPeriod(ws())).expenseCents ?? 0).toBe(0);
    const { card } = await expectCardConsistent(ws(), cardId);
    expect(card.limitUsedCents).toBe(4_000);
    await expectLedgerConsistent(ws());
  });

  test('cancelamento, estorno de compra faturada, ajuste manual e arquivamento', async ({ page }) => {
    const cycle = earlyPaymentCycle();
    const cardId = await createCardByBackend(tenant, { name: 'Cartão Ciclo', ...cycle });
    await buyInThePast(tenant, cardId, { description: 'Jaqueta', totalCents: 20_000 });
    await buyToday(tenant, cardId, { description: 'Café', totalCents: 5_000 });
    await runClosingToday();
    const closed = (await invoicesOf(ws())).find((invoice) => invoice.cycleStatus === 'closed')!;
    const open = (await invoicesOf(ws())).find((invoice) => invoice.cycleStatus === 'open')!;
    const emptyCardId = await createCardByBackend(tenant, { name: 'Cartão Reserva' });

    await login(page, tenant.owner.email);
    await openCards(page);
    await openCardDetails(page, 'Cartão Ciclo');

    // Cancelamento: todas as parcelas abertas.
    await invoiceSummary(page, `Fatura ${competenceLabel(open.competenceMonth)}`)
      .getByRole('button', { name: 'Ver detalhes da fatura' }).click();
    let drawer = page.getByTestId(`credit-card-invoice-details-drawer-${open.id}`);
    await drawer.getByTestId('card-invoice-entry').filter({ hasText: 'Café' })
      .getByRole('button', { name: 'Cancelar compra' }).click();
    const cancel = dialogNamed(page, 'Cancelar compra');
    await cancel.getByRole('button', { name: 'Cancelar compra' }).click();
    await expect(cancel).toBeHidden({ timeout: 30_000 });
    expect((await purchaseByDescription('Café'))[0]).toMatchObject({ status: 'cancelled' });
    await drawer.getByRole('button', { name: 'Fechar detalhe da fatura' }).click();

    // Estorno de compra faturada: a fechada não muda; crédito na aberta.
    await invoiceSummary(page, `Fatura ${competenceLabel(closed.competenceMonth)}`)
      .getByRole('button', { name: 'Ver detalhes da fatura' }).click();
    drawer = page.getByTestId(`credit-card-invoice-details-drawer-${closed.id}`);
    await drawer.getByTestId('card-invoice-entry').filter({ hasText: 'Jaqueta' })
      .getByRole('button', { name: 'Estornar compra' }).click();
    const refund = dialogNamed(page, 'Estornar compra');
    await expect(refund).toContainText(`fatura aberta de ${competenceLabel(open.competenceMonth)}`);
    await refund.getByRole('button', { name: 'Estornar compra' }).click();
    await expect(refund).toBeHidden({ timeout: 30_000 });
    expect((await purchaseByDescription('Jaqueta'))[0]).toMatchObject({ status: 'refunded' });
    expect(await invoiceDoc(ws(), closed.id)).toMatchObject({ totalCents: 20_000, cycleStatus: 'closed' });
    expect((await invoiceDoc(ws(), open.id)).totalCents).toBe(-20_000);
    await drawer.getByRole('button', { name: 'Fechar detalhe da fatura' }).click();

    // Ajuste manual em competência fechada: compensado na aberta. Teclado:
    // o foco entra no diálogo, Escape fecha e o foco volta para o botão.
    const adjustmentTrigger = page.getByRole('button', { name: 'Lançar ajuste manual' });
    await adjustmentTrigger.click();
    const adjustment = page.getByRole('dialog', { name: 'Ajuste manual de fatura' });
    await expect(adjustment).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(adjustment).toBeHidden();
    await expect(adjustmentTrigger).toBeFocused();
    await adjustmentTrigger.click();
    await adjustment.getByLabel('Competência da fatura').selectOption(closed.competenceMonth);
    await adjustment.getByLabel('Débito (aumenta a fatura)').check();
    await adjustment.getByLabel('Valor (R$)').fill('15');
    await adjustment.getByLabel(/Motivo/).fill('Tarifa de anuidade lançada pelo banco');
    await expect(adjustment).toContainText(competenceLabel(open.competenceMonth));
    await adjustment.getByRole('button', { name: 'Lançar ajuste' }).click();
    await expect(adjustment).toBeHidden({ timeout: 30_000 });
    await expect(statusNotice(page, `Ajuste lançado na fatura aberta de ${competenceLabel(open.competenceMonth)}.`)).toBeVisible();
    expect(await invoiceDoc(ws(), closed.id)).toMatchObject({ totalCents: 20_000 });
    expect((await invoiceDoc(ws(), open.id)).totalCents).toBe(-20_000 + 1_500);
    await expectCardConsistent(ws(), cardId);

    // Arquivamento recusado com pendência (fatura fechada a pagar).
    await page.getByRole('button', { name: 'Arquivar' }).click();
    let archive = dialogNamed(page, 'Arquivar cartão');
    await archive.getByRole('button', { name: 'Arquivar', exact: true }).click();
    await expect(archive.getByRole('alert')).toContainText('Não é possível arquivar');
    expect((await cardDoc(ws(), cardId)).status).toBe('active');
    await archive.getByRole('button', { name: 'Voltar' }).click();
    await page.getByRole('button', { name: 'Fechar detalhes do cartão' }).click();

    // Sem pendência: arquiva, some da compra manual, reativa.
    await openCardDetails(page, 'Cartão Reserva');
    await page.getByRole('button', { name: 'Arquivar' }).click();
    archive = dialogNamed(page, 'Arquivar cartão');
    await archive.getByRole('button', { name: 'Arquivar', exact: true }).click();
    await expect(archive).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId('card-status')).toHaveText(/Arquivado/i);
    expect(await cardDoc(ws(), emptyCardId)).toMatchObject({ status: 'archived' });
    await page.getByRole('button', { name: 'Fechar detalhes do cartão' }).click();
    await backToDashboard(page);
    await page.getByRole('button', { name: /Nova Transação/i }).first().click();
    await transactionDialog(page).getByRole('button', { name: /^Cartão$/ }).click();
    await expect(transactionDialog(page).locator('form select').first().locator('option', { hasText: 'Cartão Reserva' }))
      .toHaveCount(0);
    await transactionDialog(page).getByRole('button', { name: 'Fechar' }).click();
    await openCards(page);
    await openCardDetails(page, 'Cartão Reserva');
    await page.getByRole('button', { name: 'Reativar' }).click();
    const reactivate = dialogNamed(page, 'Reativar cartão');
    await reactivate.getByRole('button', { name: 'Reativar', exact: true }).click();
    await expect(reactivate).toBeHidden({ timeout: 30_000 });
    expect(await cardDoc(ws(), emptyCardId)).toMatchObject({ status: 'active' });
    // Sem exclusão física em nenhum caminho.
    expect(await cardsOf(ws())).toHaveLength(2);
  });

  test('member compra pela tela e não administra; o servidor recusa o que a tela esconde', async ({ browser, request }) => {
    const cycle = earlyPaymentCycle();
    const cardId = await createCardByBackend(tenant, { name: 'Cartão Equipe', ...cycle });
    await buyInThePast(tenant, cardId, { description: 'Material', totalCents: 8_000 });
    await runClosingToday();

    // Member: compra pela tela; sem botões de administração nem de pagamento.
    const member = await pageAs(browser, tenant.member.email);
    const memberPurchases = callablePosts(member, 'createCreditCardPurchase');
    // Produto novo: o member não cadastra no catálogo; o aviso aparece e nada é enviado.
    const dialog = await fillCardPurchase(member, { cardId, description: 'Produto sem cadastro', value: '120', installments: '2' });
    await submitPurchase(dialog).click();
    await expect(dialog.getByRole('alert')).toContainText('Não foi possível cadastrar este produto ou serviço no catálogo');
    expect(memberPurchases).toHaveLength(0);
    await dialog.getByPlaceholder('Busque, selecione ou digite um novo item...').fill('Teclado');
    await submitPurchase(dialog).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    expect(memberPurchases).toHaveLength(1);
    expect((await purchaseByDescription('Teclado'))[0]).toMatchObject({ createdBy: tenant.member.uid, status: 'active' });
    await openCards(member);
    await expect(member.getByRole('button', { name: 'Novo Cartão' })).toHaveCount(0);
    await openCardDetails(member, 'Cartão Equipe');
    await expect(member.getByRole('heading', { name: 'Administração' })).toHaveCount(0);
    await expect(member.getByRole('button', { name: 'Editar' })).toHaveCount(0);
    await expect(member.getByRole('button', { name: 'Arquivar' })).toHaveCount(0);
    await expect(member.getByRole('button', { name: 'Pagar total' })).toHaveCount(0);
    // O servidor recusa o que a tela esconde.
    const memberToken = await tokenOf(request, tenant.member.email);
    const forbidden = await callCallable(request, memberToken, 'createCreditCard', {
      workspaceId: ws(), idempotencyKey: intentKey('card'), name: 'Forjado', brand: 'Visa',
      closingDay: 10, dueDay: 20, limitTotalCents: 100_000, visual: CARD_VISUAL,
    });
    expect(forbidden.errorStatus).toBe('PERMISSION_DENIED');
    const closed = (await invoicesOf(ws())).find((invoice) => invoice.cycleStatus === 'closed')!;
    const memberPay = await callCallable(request, memberToken, 'registerInvoicePayment', {
      workspaceId: ws(), idempotencyKey: intentKey('pay'), cardId, invoiceId: closed.id,
      cashAccountId: mainAccount(), amountCents: 1_000, paymentDate: today(),
      expectedUpdatedAt: closed.updatedAt.toDate().toISOString(),
    });
    expect(memberPay.errorStatus).toBe('PERMISSION_DENIED');
    await member.context().close();
    await expectCardConsistent(ws(), cardId);
  });

  test('perda de papel com o diálogo aberto; viewer só lê', async ({ browser, request }) => {
    const cardId = await createCardByBackend(tenant, { name: 'Cartão Equipe' });
    await buyToday(tenant, cardId, { description: 'Material', totalCents: 8_000 });

    // Perda de papel com o diálogo aberto: recusado, nada gravado.
    const member = await pageAs(browser, tenant.member.email);
    const late = await fillCardPurchase(member, { cardId, description: 'Mouse', value: '60', installments: '1' });
    await db().doc(`workspaces/${ws()}/members/${tenant.member.uid}`).update({ role: 'viewer' });
    await submitPurchase(late).click();
    await expect(late.getByRole('alert')).toBeVisible({ timeout: 30_000 });
    expect(await purchaseByDescription('Mouse')).toHaveLength(0);
    await member.context().close();

    // Viewer: lê cartão e faturas; não compra nem administra.
    const viewer = await pageAs(browser, tenant.viewer.email);
    await openCards(viewer);
    await openCardDetails(viewer, 'Cartão Equipe');
    await expect(viewer.getByTestId('card-invoice-summary').first()).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Lançar ajuste manual' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Editar' })).toHaveCount(0);
    const viewerToken = await tokenOf(request, tenant.viewer.email);
    const viewerBuy = await callCallable(request, viewerToken, 'createCreditCardPurchase', {
      workspaceId: ws(), idempotencyKey: intentKey('buy'), cardId, description: 'Forjada', category: CATEGORY,
      purchaseDate: today(), totalCents: 1_000, installmentsCount: 1,
    });
    expect(viewerBuy.errorStatus).toBe('PERMISSION_DENIED');
    await viewer.context().close();
    await expectCardConsistent(ws(), cardId);
  });

  test('troca de workspace: cada espaço mostra só os próprios cartões', async ({ page }) => {
    await createCardByBackend(tenant, { name: 'Cartão do Espaço A' });
    const otherOwner = { uid: 'e2e-p4a-owner-b', email: 'e2e-p4a-owner-b@minhas-financas.local' };
    await adminSdk().auth().createUser({ ...otherOwner, password: PASSWORD, emailVerified: true });
    const otherWs = `e2e-p4a-ws-b-${Date.now().toString(36)}`;
    await seedOwnedWorkspace({ ...otherOwner, workspaceId: otherWs, name: 'Empresa Beta E2E', type: 'PJ' });
    await seedAccountProfile(tenant.owner);
    await seedMembership({
      workspaceId: otherWs, uid: tenant.owner.uid, email: tenant.owner.email, role: 'admin',
      name: 'Empresa Beta E2E', type: 'PJ', joinedAt: new Date(Date.now() + 3_600_000),
    });
    await createCardFor({ uid: otherOwner.uid, workspaceId: otherWs }, { name: 'Cartão do Espaço B' });

    await login(page, tenant.owner.email);
    await openCards(page);
    await expect(page.getByText('Cartão do Espaço A', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Cartão do Espaço B', { exact: true })).toHaveCount(0);

    await page.getByText('Olá, Usuário').click();
    await page.getByRole('button', { name: /Empresa Beta E2E/ }).click();
    await openCards(page, 'PJ');
    await expect(page.getByText('Cartão do Espaço B', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Cartão do Espaço A', { exact: true })).toHaveCount(0);
    // Admin do outro espaço administra os cartões dele.
    await expect(page.getByRole('button', { name: 'Novo Cartão Corp' })).toBeVisible();
  });
});
