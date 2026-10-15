import { expect, test, type Page } from '@playwright/test';

import {
  accountByName,
  accountMovementsOf,
  accountRow,
  balanceOf,
  createAccountByApi,
  expectLedgerConsistent,
  movementsOfAccount,
  openCashAccounts,
  transferByApi,
  transferRow,
  transfersOf,
} from './support/accounts';
import { callCallable } from './support/callables';
import {
  addMonths,
  bodyOf,
  brl,
  callablePosts,
  createLoanByApi,
  db,
  dialogNamed,
  intentKey,
  loanDoc,
  login,
  movementsOf as loanMovementsOf,
  openLoanByCounterparty,
  openLoans,
  pageAs,
  PASSWORD,
  resetEmulatorData,
  seedLoanTenant,
  summaryCard,
  today,
  tokenOf,
  transactionsOf,
  type LoanTenant,
} from './support/loans';
import {
  createClientByApi,
  createReceivableByApi,
  docOf,
  movementsOfReceivable,
  openClientsReceivables,
  receivableRow,
  receiveByApi,
  versionOf,
} from './support/receivables';
import {
  adminSdk,
  defaultCashAccountIdFor,
  saoPauloMonthKey,
  seedAccountProfile,
  seedMembership,
  seedOwnedWorkspace,
  transactionsQuotaMonthPath,
} from './support/workspaceSeed';

/**
 * P3-J (D-30) — contas/carteiras autoritativas pela interface, no Emulator
 * (Auth, Firestore e Functions reais, sem mocks):
 * - conta padrão provisionada; criação com saldo inicial (movimento
 *   `opening_balance`, fora de receita/despesa e da quota); segunda conta;
 * - transferência revisada antes de enviar, clique duplo sem duplicar,
 *   estorno compensatório, reenvio idempotente e segundo estorno recusado;
 * - lançamento manual na conta escolhida; pendente só move na confirmação;
 *   correção que troca de conta compensa e reaplica; anulação compensa;
 * - empréstimo, liquidação e recebível com conta, saldos atualizados;
 *   estornos voltam na conta original; desconto não move conta;
 * - member/viewer, perda de papel com o diálogo aberto, troca de workspace;
 * - conta arquivada: só com saldo zero, some das escolhas, recusa movimento;
 * - resposta perdida e sessão perdida sem duplicar.
 * Em todos, o livro-razão fecha: saldo de cada conta = soma dos movimentos.
 */
test.use({ timezoneId: 'America/Sao_Paulo' });

let tenant: LoanTenant;
const ws = () => tenant.workspaceId;
const mainAccount = () => defaultCashAccountIdFor(ws());

const CATALOG = {
  incomeType: 'Serviço P3-J',
  incomeCategory: 'Consultoria P3-J',
  expenseType: 'Fixa P3-J',
  expenseCategory: 'Moradia P3-J',
  paymentMethod: 'Pix P3-J',
};

const normalize = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

const seedCatalog = async (workspaceId: string, uid: string) => {
  const now = new Date();
  const items: Array<[string, string, string, string?]> = [
    ['p3j-income-type', 'income_type', CATALOG.incomeType],
    ['p3j-income-category', 'category', CATALOG.incomeCategory, 'receita'],
    ['p3j-expense-type', 'expense_type', CATALOG.expenseType],
    ['p3j-expense-category', 'category', CATALOG.expenseCategory, 'despesa'],
    ['p3j-payment', 'payment_method', CATALOG.paymentMethod],
  ];
  await Promise.all(items.map(([id, group, name, transactionSubtype]) => {
    const normalizedName = normalize(name);
    return db().doc(`workspaces/${workspaceId}/settings_catalog/${id}`).set({
      id, schemaVersion: 1, workspaceId, group, name, normalizedName,
      ...(transactionSubtype ? { transactionSubtype } : {}),
      dedupeKey: `${group}::${transactionSubtype ?? 'all'}::both::${normalizedName}`,
      workspaceScope: 'both', sortOrder: 1, status: 'active',
      createdBy: uid, updatedBy: uid, createdAt: now, updatedAt: now,
    });
  }));
};

const statusNotice = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

const backToDashboard = async (page: Page) => {
  await page.getByRole('link', { name: /Dashboard/i }).click();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 20_000 });
};

const transactionDialog = (page: Page) =>
  page.getByRole('dialog').filter({ has: page.locator('#transaction-modal-title') });

const accountSelect = (page: Page) => transactionDialog(page).locator('form').getByLabel(/^Conta\/carteira/);

const reload = async (page: Page) => {
  await page.reload();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
};

test.describe('PF', () => {
  test.beforeEach(async () => {
    await resetEmulatorData();
    tenant = await seedLoanTenant('PF', 'p3j');
  });

  test('contas: saldo inicial fora de receita/despesa; transferência revisada; clique duplo e estorno sem duplicar', async ({ page, request }) => {
    await login(page, tenant.owner.email);
    await openCashAccounts(page);

    // Conta padrão provisionada; transferir exige duas contas ativas.
    await expect(page.getByTestId('account-row')).toHaveCount(1);
    await expect(accountRow(page, 'Carteira principal')).toContainText(brl(0));
    await expect(page.getByTestId('accounts-total')).toHaveText(brl(0));
    await expect(page.getByRole('button', { name: 'Nova transferência' })).toBeDisabled();
    // A nota cita os produtores do livro-razão: desde a P4-D, aportes e retiradas
    // liquidados de investimentos também movimentam a conta, e nenhum fica de fora.
    await expect(page.getByText(/aportes e retiradas de investimentos já liquidados/)).toBeVisible();
    await expect(page.getByText(/ainda não movimentam as contas/)).toHaveCount(0);

    // Nova conta com saldo inicial; formato inválido recusado antes do backend.
    const creates = callablePosts(page, 'createCashAccount');
    await page.getByRole('button', { name: 'Nova conta' }).click();
    const form = dialogNamed(page, 'Nova conta');
    await form.getByLabel('Nome da conta').fill('Conta corrente Banco X');
    await form.getByLabel('Tipo').selectOption({ label: 'Conta corrente' });
    await form.getByLabel('Saldo inicial (opcional)').fill('mil e quinhentos');
    await form.getByRole('button', { name: 'Salvar' }).click();
    await expect(form.getByRole('alert')).toContainText('Saldo inicial: use o formato 1.234,56');
    expect(creates).toHaveLength(0);
    await form.getByLabel('Saldo inicial (opcional)').fill('1.500,00');
    await form.getByRole('button', { name: 'Salvar' }).click();
    await expect(form).toBeHidden({ timeout: 30_000 });
    await expect(statusNotice(page, 'Conta criada.')).toBeVisible();
    expect(bodyOf(creates[0])).toMatchObject({
      workspaceId: ws(), name: 'Conta corrente Banco X', accountType: 'checking', openingBalanceCents: 150_000,
    });
    expect(bodyOf(creates[0])).not.toHaveProperty('balanceCents');

    const checking = await accountByName(ws(), 'Conta corrente Banco X');
    expect(checking).toMatchObject({
      schemaVersion: 1, workspaceId: ws(), accountType: 'checking', status: 'active',
      balanceCents: 150_000, createdBy: tenant.owner.uid,
    });
    expect((await movementsOfAccount(ws(), checking.id)).map((movement) =>
      [movement.kind, movement.amountCents, movement.sourceDomain])).toEqual([['opening_balance', 150_000, 'account']]);
    await expect(accountRow(page, 'Conta corrente Banco X')).toContainText(brl(150_000));
    await expect(page.getByTestId('accounts-total')).toHaveText(brl(150_000));
    // Saldo inicial não é lançamento: nem receita, nem despesa, nem quota.
    expect(await transactionsOf(ws())).toHaveLength(0);
    expect((await db().doc(transactionsQuotaMonthPath(ws(), saoPauloMonthKey())).get()).get('used')).toBeUndefined();

    // Transferência: revisão com origem, destino e valor antes de enviar.
    const transfers = callablePosts(page, 'createCashTransfer');
    await page.getByRole('button', { name: 'Nova transferência' }).click();
    const transferForm = dialogNamed(page, 'Nova transferência');
    await transferForm.getByLabel('Conta de origem').selectOption(checking.id);
    await transferForm.getByLabel('Conta de destino').selectOption(mainAccount());
    await transferForm.getByLabel('Valor (R$)').fill('400,00');
    await transferForm.getByLabel('Descrição (opcional)').fill('Saque para despesas');
    await transferForm.getByRole('button', { name: 'Revisar' }).click();
    const review = dialogNamed(page, 'Confirmar transferência');
    await expect(review).toContainText('Conta corrente Banco X');
    await expect(review).toContainText('Carteira principal');
    await expect(review.getByText(brl(40_000))).toBeVisible();
    await expect(review).toContainText('não é receita nem despesa');
    expect(transfers).toHaveLength(0);

    // Clique duplo no mesmo tick: um pedido só (o segundo envio é barrado
    // antes do próximo render) e uma transferência só.
    await review.locator('form').evaluate((formElement: HTMLFormElement) => {
      formElement.requestSubmit();
      formElement.requestSubmit();
    });
    await expect(review).toBeHidden({ timeout: 30_000 });
    await expect(statusNotice(page, 'Transferência registrada.')).toBeVisible();
    expect(transfers).toHaveLength(1);
    expect(bodyOf(transfers[0])).toMatchObject({
      sourceAccountId: checking.id, destinationAccountId: mainAccount(), amountCents: 40_000,
      date: today(), description: 'Saque para despesas',
    });
    const [transfer] = await transfersOf(ws());
    expect(await transfersOf(ws())).toHaveLength(1);
    expect(transfer).toMatchObject({ status: 'completed', amountCents: 40_000, reversal: null });
    await expect(accountRow(page, 'Conta corrente Banco X')).toContainText(brl(110_000));
    await expect(accountRow(page, 'Carteira principal')).toContainText(brl(40_000));
    await expect(page.getByTestId('accounts-total')).toHaveText(brl(150_000));
    const row = transferRow(page, 'Conta corrente Banco X → Carteira principal');
    await expect(row).toContainText('Concluída');
    await expect(row).toContainText('Saque para despesas');

    // Estorno: motivo obrigatório; movimentos compensatórios; volta à origem.
    const reversals = callablePosts(page, 'reverseCashTransfer');
    await row.getByRole('button', { name: 'Estornar' }).click();
    const confirm = dialogNamed(page, 'Estornar transferência');
    await expect(confirm).toContainText('O valor volta para a conta de origem.');
    await expect(confirm.getByRole('button', { name: 'Confirmar estorno' })).toBeDisabled();
    await confirm.getByLabel(/Motivo do estorno/).fill('Valor lançado errado');
    await confirm.getByRole('button', { name: 'Confirmar estorno' }).click();
    await expect(confirm).toBeHidden({ timeout: 30_000 });
    await expect(row).toContainText('Estornada');
    await expect(row).toContainText('Motivo do estorno: Valor lançado errado');
    await expect(row.getByRole('button', { name: 'Estornar' })).toHaveCount(0);
    await expect(accountRow(page, 'Conta corrente Banco X')).toContainText(brl(150_000));
    await expect(accountRow(page, 'Carteira principal')).toContainText(brl(0));

    // Reenvio do mesmo pedido: devolve o resultado gravado; nova intenção: recusada.
    const token = await tokenOf(request, tenant.owner.email);
    const replay = await callCallable(request, token, 'reverseCashTransfer', bodyOf(reversals[0]));
    expect(replay.status, JSON.stringify(replay)).toBe(200);
    expect(replay.result).toMatchObject({ transferId: transfer.id, status: 'reversed', replayed: true });
    const reversed = await docOf(ws(), 'cash_transfers', transfer.id);
    const second = await callCallable(request, token, 'reverseCashTransfer', {
      workspaceId: ws(), idempotencyKey: intentKey('second-reversal'), transferId: transfer.id,
      expectedUpdatedAt: versionOf(reversed), reason: 'Segunda tentativa',
    });
    expect(second.errorStatus).toBe('FAILED_PRECONDITION');
    expect(second.errorMessage).toBe('Esta transferência já foi estornada.');

    const transferMovements = (await accountMovementsOf(ws())).filter((movement) => movement.sourceDomain === 'transfer');
    expect(transferMovements.map((movement) => movement.kind).sort())
      .toEqual(['reversal', 'reversal', 'transfer_in', 'transfer_out']);
    expect(transferMovements.reduce((total, movement) => total + movement.amountCents, 0)).toBe(0);
    expect(await expectLedgerConsistent(ws())).toEqual({ 'Carteira principal': 0, 'Conta corrente Banco X': 150_000 });

    // Extrato: os movimentos do livro-razão, com o saldo autoritativo.
    await accountRow(page, 'Conta corrente Banco X').getByRole('button', { name: 'Extrato' }).click();
    const statement = dialogNamed(page, 'Extrato da conta');
    for (const label of ['Saldo inicial', 'Transferência enviada', 'Estorno de transferência']) {
      await expect(statement.locator('li').filter({ hasText: label })).toHaveCount(1);
    }
    await expect(statement.locator('li')).toHaveCount(3);
    // Escape fecha o diálogo (a moldura também tem o X "Fechar").
    await page.keyboard.press('Escape');
    await expect(statement).toBeHidden();

    // Nada disso é receita nem despesa no caixa.
    await backToDashboard(page);
    await expect(summaryCard(page, 'Receitas')).toHaveAccessibleName(/R\$\s*0,00/);
    await expect(summaryCard(page, 'Despesas')).toHaveAccessibleName(/R\$\s*0,00/);
    expect(await transactionsOf(ws())).toHaveLength(0);
  });

  test('lançamentos: conta escolhida no formulário; pendente só move na confirmação; troca de conta e anulação compensam', async ({ page, request }) => {
    await seedCatalog(ws(), tenant.owner.uid);
    const token = await tokenOf(request, tenant.owner.email);
    const digital = await createAccountByApi(request, token, ws(), 'Conta digital', { accountType: 'digital' });
    await login(page, tenant.owner.email);
    const creates = callablePosts(page, 'createCashTransaction');
    const confirms = callablePosts(page, 'confirmCashTransaction');

    // Receita confirmada na conta escolhida (a primeira ativa vem marcada).
    await page.getByRole('button', { name: /Nova Transação/i }).first().click();
    const form = transactionDialog(page).locator('form');
    await expect(form.locator('select').nth(1)).toContainText(CATALOG.incomeCategory, { timeout: 20_000 });
    await form.locator('select').nth(0).selectOption({ label: CATALOG.incomeType });
    await form.locator('select').nth(1).selectOption({ label: CATALOG.incomeCategory });
    await form.locator('input[type="number"]').fill('250');
    await form.getByPlaceholder('Ex: Cliente XYZ, Reembolso Empresa...').fill('Receita P3-J conta');
    await form.locator('input[type="date"]').fill(today());
    await expect(accountSelect(page)).toHaveValue(mainAccount());
    await accountSelect(page).selectOption({ label: 'Conta digital' });
    await transactionDialog(page).getByRole('button', { name: /Revisar e Adicionar Receita/i }).click();
    await expect(transactionDialog(page)).toBeHidden({ timeout: 30_000 });
    expect(bodyOf(creates[0])).toMatchObject({ type: 'receita', amountCents: 25_000, cashAccountId: digital });
    const income = (await transactionsOf(ws())).find((entry) => entry.description === 'Receita P3-J conta')!;
    expect(income.cashAccountId).toBe(digital);
    expect(await balanceOf(ws(), digital)).toBe(25_000);
    expect((await movementsOfAccount(ws(), digital)).map((movement) =>
      [movement.kind, movement.amountCents, movement.sourceId])).toEqual([['cash_transaction', 25_000, income.id]]);

    // Despesa pendente: grava a conta, mas não move saldo.
    await page.getByRole('button', { name: /Nova Transação/i }).first().click();
    const expenseDialog = transactionDialog(page);
    await expenseDialog.getByRole('button', { name: /^Despesa$/ }).click();
    const expenseForm = expenseDialog.locator('form');
    await expect(expenseForm.locator('select').nth(1)).toContainText(CATALOG.expenseCategory, { timeout: 20_000 });
    await expenseForm.locator('select').nth(0).selectOption({ label: CATALOG.expenseType });
    await expenseForm.locator('select').nth(1).selectOption({ label: CATALOG.expenseCategory });
    await expenseForm.getByPlaceholder('Ex: Conta de Luz, Manutenção...').fill('Aluguel P3-J');
    await expenseForm.locator('input[type="number"]').fill('80');
    await expenseForm.locator('select').nth(2).selectOption({ label: CATALOG.paymentMethod });
    await expenseForm.getByRole('radiogroup', { name: 'Essa despesa já foi paga?' }).getByRole('radio', { name: 'Não' }).check();
    await expenseForm.locator('input[type="date"]').fill(today());
    await expect(accountSelect(page)).toHaveValue(mainAccount());
    await expenseDialog.getByRole('button', { name: /Revisar e Adicionar Despesa/i }).click();
    await expect(expenseDialog).toBeHidden({ timeout: 30_000 });
    expect(bodyOf(creates[1])).toMatchObject({ type: 'despesa', status: 'pending', cashAccountId: mainAccount() });
    const expense = (await transactionsOf(ws())).find((entry) => entry.description === 'Aluguel P3-J')!;
    expect(expense.cashAccountId).toBe(mainAccount());
    expect(await balanceOf(ws(), mainAccount())).toBe(0);
    expect(await movementsOfAccount(ws(), mainAccount())).toHaveLength(0);

    // Confirmação: a conta da liquidação pode mudar; só agora o saldo move.
    await summaryCard(page, 'Despesas').click();
    await page.locator('tr').filter({ hasText: 'Aluguel P3-J' }).getByRole('button', { name: 'Editar' }).click();
    const confirmDialog = transactionDialog(page);
    await confirmDialog.locator('form').getByLabel('Sim', { exact: true }).check();
    await expect(accountSelect(page)).toHaveValue(mainAccount());
    await accountSelect(page).selectOption({ label: 'Conta digital' });
    await confirmDialog.locator('form input[type="date"]').fill(today());
    await confirmDialog.getByRole('button', { name: 'Confirmar pagamento' }).click();
    await expect(confirmDialog).toBeHidden({ timeout: 30_000 });
    expect(bodyOf(confirms[0])).toMatchObject({ transactionId: expense.id, cashAccountId: digital });
    expect((await docOf(ws(), 'transactions', expense.id)).cashAccountId).toBe(digital);
    expect(await balanceOf(ws(), digital)).toBe(25_000 - 8_000);
    expect(await balanceOf(ws(), mainAccount())).toBe(0);
    await page.getByRole('button', { name: 'Voltar ao dashboard' }).click();

    // Correção que troca de conta: compensa na antiga, aplica na nova.
    await summaryCard(page, 'Receitas').click();
    const incomeRow = page.locator('tr').filter({ hasText: 'Receita P3-J conta' });
    await incomeRow.getByRole('button', { name: 'Editar' }).click();
    const editDialog = transactionDialog(page);
    await expect(accountSelect(page)).toHaveValue(digital);
    await accountSelect(page).selectOption({ label: 'Carteira principal' });
    await editDialog.getByLabel(/Motivo da correção/).fill('Conta errada');
    await editDialog.getByRole('button', { name: 'Salvar Alterações' }).click();
    await expect(editDialog).toBeHidden({ timeout: 30_000 });
    // Saldo negativo é permitido: a conta digital pagou a despesa.
    expect(await balanceOf(ws(), digital)).toBe(-8_000);
    expect(await balanceOf(ws(), mainAccount())).toBe(25_000);
    const incomeMovements = (await accountMovementsOf(ws())).filter((movement) => movement.sourceId === income.id);
    expect(incomeMovements.map((movement) => [movement.accountId === digital ? 'digital' : 'principal',
      movement.kind, movement.amountCents]).sort()).toEqual([
      ['digital', 'cash_transaction', 25_000], ['digital', 'reversal', -25_000], ['principal', 'cash_transaction', 25_000],
    ]);

    // Anulação: compensa o efeito ativo na conta atual.
    await incomeRow.getByRole('button', { name: 'Deletar' }).click();
    const voidDialog = page.getByRole('dialog').filter({ hasText: 'Anular lançamento' });
    await voidDialog.getByLabel('Motivo da anulação').fill('Lançado em duplicidade');
    await voidDialog.getByRole('button', { name: 'Confirmar anulação' }).click();
    await expect(voidDialog).toBeHidden({ timeout: 30_000 });
    await expect.poll(() => balanceOf(ws(), mainAccount())).toBe(0);
    expect(await expectLedgerConsistent(ws())).toEqual({ 'Carteira principal': 0, 'Conta digital': -8_000 });

    // A tela de contas mostra o saldo negativo e o saldo geral do servidor.
    await page.getByRole('button', { name: 'Voltar ao dashboard' }).click();
    await openCashAccounts(page);
    await expect(accountRow(page, 'Conta digital')).toContainText(brl(-8_000));
    await expect(page.getByTestId('accounts-total')).toHaveText(brl(-8_000));
  });

  test('RBAC: member transfere e estorna só a própria; viewer só lê; perda de papel com o diálogo aberto', async ({ page, request, browser }) => {
    const ownerToken = await tokenOf(request, tenant.owner.email);
    const memberToken = await tokenOf(request, tenant.member.email);
    const viewerToken = await tokenOf(request, tenant.viewer.email);
    const contaB = await createAccountByApi(request, ownerToken, ws(), 'Conta B', { openingBalanceCents: 50_000 });
    const ownerTransfer = await transferByApi(request, ownerToken, ws(), contaB, mainAccount(), 10_000);

    // Member: transfere pela tela; não administra contas; estorna só a sua.
    const member = await pageAs(browser, tenant.member.email);
    await openCashAccounts(member);
    await expect(member.getByRole('button', { name: 'Nova conta' })).toHaveCount(0);
    for (const action of ['Editar', 'Arquivar', 'Reativar']) {
      await expect(member.getByTestId('account-row').getByRole('button', { name: action })).toHaveCount(0);
    }
    await expect(transferRow(member, 'Conta B → Carteira principal').getByRole('button', { name: 'Estornar' })).toHaveCount(0);
    await member.getByRole('button', { name: 'Nova transferência' }).click();
    const memberForm = dialogNamed(member, 'Nova transferência');
    await memberForm.getByLabel('Conta de origem').selectOption(contaB);
    await memberForm.getByLabel('Conta de destino').selectOption(mainAccount());
    await memberForm.getByLabel('Valor (R$)').fill('50,00');
    await memberForm.getByRole('button', { name: 'Revisar' }).click();
    await dialogNamed(member, 'Confirmar transferência').getByRole('button', { name: 'Confirmar transferência' }).click();
    await expect(statusNotice(member, 'Transferência registrada.')).toBeVisible({ timeout: 30_000 });
    const memberTransfer = (await transfersOf(ws())).find((entry) => entry.createdBy === tenant.member.uid)!;
    expect(memberTransfer).toMatchObject({ amountCents: 5_000, status: 'completed' });
    await expect(member.getByTestId('transfer-row').getByRole('button', { name: 'Estornar' })).toHaveCount(1);

    // O backend decide: member não cria conta nem estorna a do titular.
    const memberCreate = await callCallable(request, memberToken, 'createCashAccount', {
      workspaceId: ws(), idempotencyKey: intentKey('member-account'), name: 'Conta do membro', accountType: 'cash',
    });
    expect(memberCreate.errorStatus).toBe('PERMISSION_DENIED');
    const ownerTransferDoc = await docOf(ws(), 'cash_transfers', ownerTransfer);
    const memberReverse = await callCallable(request, memberToken, 'reverseCashTransfer', {
      workspaceId: ws(), idempotencyKey: intentKey('member-reverse'), transferId: ownerTransfer,
      expectedUpdatedAt: versionOf(ownerTransferDoc), reason: 'Tentativa do membro',
    });
    expect(memberReverse.errorStatus).toBe('PERMISSION_DENIED');
    expect(memberReverse.errorMessage).toBe('Você só pode estornar as transferências que você mesmo registrou.');

    // Viewer: só lê saldos, extrato e histórico.
    const viewer = await pageAs(browser, tenant.viewer.email);
    await openCashAccounts(viewer);
    await expect(accountRow(viewer, 'Conta B')).toContainText(brl(50_000 - 10_000 - 5_000));
    for (const action of ['Nova conta', 'Nova transferência', 'Estornar', 'Editar', 'Arquivar']) {
      await expect(viewer.getByRole('button', { name: action })).toHaveCount(0);
    }
    await accountRow(viewer, 'Conta B').getByRole('button', { name: 'Extrato' }).click();
    await expect(dialogNamed(viewer, 'Extrato da conta').locator('li')).toHaveCount(3);
    const viewerTransfer = await callCallable(request, viewerToken, 'createCashTransfer', {
      workspaceId: ws(), idempotencyKey: intentKey('viewer-transfer'), sourceAccountId: contaB,
      destinationAccountId: mainAccount(), amountCents: 1_000, date: today(),
    });
    expect(viewerTransfer.errorStatus).toBe('PERMISSION_DENIED');
    await viewer.context().close();

    // Perda de papel com a confirmação aberta: recusado, nada gravado.
    await member.getByRole('button', { name: 'Nova transferência' }).click();
    const lateForm = dialogNamed(member, 'Nova transferência');
    await lateForm.getByLabel('Conta de origem').selectOption(contaB);
    await lateForm.getByLabel('Conta de destino').selectOption(mainAccount());
    await lateForm.getByLabel('Valor (R$)').fill('10,00');
    await lateForm.getByRole('button', { name: 'Revisar' }).click();
    const lateReview = dialogNamed(member, 'Confirmar transferência');
    await db().doc(`workspaces/${ws()}/members/${tenant.member.uid}`).update({ role: 'viewer' });
    await lateReview.getByRole('button', { name: 'Confirmar transferência' }).click();
    await expect(lateReview.getByRole('alert')).toContainText('não permite esta operação');
    expect(await transfersOf(ws())).toHaveLength(2);
    expect(await expectLedgerConsistent(ws())).toEqual({ 'Carteira principal': 15_000, 'Conta B': 35_000 });
    await member.context().close();

    // Controle positivo: o owner estorna qualquer transferência pela tela.
    await login(page, tenant.owner.email);
    await openCashAccounts(page);
    await expect(page.getByTestId('transfer-row').getByRole('button', { name: 'Estornar' })).toHaveCount(2);
  });

  test('troca de workspace: cada espaço mostra só as próprias contas e o próprio saldo geral', async ({ page, request }) => {
    const token = await tokenOf(request, tenant.owner.email);
    await createAccountByApi(request, token, ws(), 'Conta do Espaço A', { openingBalanceCents: 12_345 });
    const otherOwner = { uid: 'e2e-p3j-owner-b', email: 'e2e-p3j-owner-b@minhas-financas.local' };
    await adminSdk().auth().createUser({ ...otherOwner, password: PASSWORD, emailVerified: true });
    const otherWs = `e2e-p3j-ws-b-${Date.now().toString(36)}`;
    await seedOwnedWorkspace({ ...otherOwner, workspaceId: otherWs, name: 'Empresa Beta E2E', type: 'PJ' });
    await seedAccountProfile(tenant.owner);
    await seedMembership({
      workspaceId: otherWs, uid: tenant.owner.uid, email: tenant.owner.email, role: 'admin',
      name: 'Empresa Beta E2E', type: 'PJ', joinedAt: new Date(Date.now() + 3_600_000),
    });
    const otherToken = await tokenOf(request, otherOwner.email);
    await createAccountByApi(request, otherToken, otherWs, 'Conta do Espaço B', { openingBalanceCents: 70_000 });

    await login(page, tenant.owner.email);
    await openCashAccounts(page);
    await expect(accountRow(page, 'Conta do Espaço A')).toHaveCount(1);
    await expect(accountRow(page, 'Conta do Espaço B')).toHaveCount(0);
    await expect(page.getByTestId('accounts-total')).toHaveText(brl(12_345));

    await page.getByText('Olá, Usuário').click();
    await page.getByRole('button', { name: /Empresa Beta E2E/ }).click();
    await openCashAccounts(page);
    await expect(accountRow(page, 'Conta do Espaço B')).toHaveCount(1);
    await expect(accountRow(page, 'Conta do Espaço A')).toHaveCount(0);
    await expect(page.getByTestId('accounts-total')).toHaveText(brl(70_000));
    // Admin do outro espaço administra as contas dele.
    await expect(page.getByRole('button', { name: 'Nova conta' })).toBeVisible();
  });

  test('conta arquivada: só com saldo zero; some das escolhas; recusa movimento; reativada volta a aceitar', async ({ page, request }) => {
    await seedCatalog(ws(), tenant.owner.uid);
    const token = await tokenOf(request, tenant.owner.email);
    const old = await createAccountByApi(request, token, ws(), 'Conta antiga', { openingBalanceCents: 10_000 });
    await login(page, tenant.owner.email);
    await openCashAccounts(page);

    // Com saldo: arquivamento bloqueado, com a explicação.
    await accountRow(page, 'Conta antiga').getByRole('button', { name: 'Arquivar' }).click();
    const blocked = dialogNamed(page, 'Arquivar conta');
    await expect(blocked.getByRole('alert')).toContainText('Só é possível arquivar uma conta com saldo zero.');
    await expect(blocked.getByRole('button', { name: 'Arquivar', exact: true })).toBeDisabled();
    await blocked.getByRole('button', { name: 'Voltar' }).click();

    // Saldo zerado por transferência: arquiva; histórico mantido.
    await transferByApi(request, token, ws(), old, mainAccount(), 10_000);
    await reload(page);
    await openCashAccounts(page);
    await accountRow(page, 'Conta antiga').getByRole('button', { name: 'Arquivar' }).click();
    const archive = dialogNamed(page, 'Arquivar conta');
    await archive.getByRole('button', { name: 'Arquivar', exact: true }).click();
    await expect(archive).toBeHidden({ timeout: 30_000 });
    await expect(statusNotice(page, 'Conta arquivada.')).toBeVisible();
    const archivedRow = accountRow(page, 'Conta antiga');
    await expect(archivedRow).toContainText('Arquivada');
    await expect(archivedRow.getByRole('button', { name: 'Editar' })).toHaveCount(0);
    await expect(archivedRow.getByRole('button', { name: 'Reativar' })).toBeVisible();
    expect(await docOf(ws(), 'cash_accounts', old)).toMatchObject({ status: 'archived', balanceCents: 0 });
    expect(await movementsOfAccount(ws(), old)).toHaveLength(2);
    // Uma conta ativa só: não há transferência possível.
    await expect(page.getByRole('button', { name: 'Nova transferência' })).toBeDisabled();

    // Some da escolha de conta do lançamento manual.
    await backToDashboard(page);
    await page.getByRole('button', { name: /Nova Transação/i }).first().click();
    await expect(accountSelect(page)).toHaveValue(mainAccount());
    await expect(accountSelect(page).locator('option', { hasText: 'Conta antiga' })).toHaveCount(0);
    await transactionDialog(page).getByRole('button', { name: 'Fechar' }).click();
    await expect(transactionDialog(page)).toBeHidden();

    // O backend recusa qualquer movimento nela, em pt-BR, sem gravar.
    const refusals = await Promise.all([
      callCallable(request, token, 'createCashTransaction', {
        workspaceId: ws(), idempotencyKey: intentKey('archived-entry'), cashAccountId: old, type: 'receita',
        description: 'Na conta arquivada', categoryId: 'p3j-income-category', incomeType: CATALOG.incomeType,
        amountCents: 1_000, date: today(),
      }),
      callCallable(request, token, 'createCashTransfer', {
        workspaceId: ws(), idempotencyKey: intentKey('archived-transfer'), sourceAccountId: mainAccount(),
        destinationAccountId: old, amountCents: 1_000, date: today(),
      }),
      callCallable(request, token, 'createLoan', {
        workspaceId: ws(), idempotencyKey: intentKey('archived-loan'), type: 'borrow', personName: 'Banco Arquivado',
        principalCents: 1_000, cashAccountId: old, startDate: today(), firstDueDate: addMonths(today(), 1), installments: 1,
        interest: { type: 'none' },
      }),
    ]);
    for (const refusal of refusals) {
      expect(refusal.errorStatus, JSON.stringify(refusal)).toBe('FAILED_PRECONDITION');
      expect(refusal.errorMessage).toContain('está arquivada e não aceita movimentos');
    }
    expect(await transactionsOf(ws())).toHaveLength(0);
    expect(await transfersOf(ws())).toHaveLength(1);
    expect(await movementsOfAccount(ws(), old)).toHaveLength(2);

    // Reativada: volta a aceitar movimentos.
    await page.getByText('Configurações', { exact: true }).first().click();
    await page.getByText('Contas e carteiras', { exact: true }).click();
    await accountRow(page, 'Conta antiga').getByRole('button', { name: 'Reativar' }).click();
    await dialogNamed(page, 'Reativar conta').getByRole('button', { name: 'Reativar', exact: true }).click();
    await expect(statusNotice(page, 'Conta reativada.')).toBeVisible({ timeout: 30_000 });
    await transferByApi(request, token, ws(), mainAccount(), old, 2_500);
    expect(await expectLedgerConsistent(ws())).toEqual({ 'Carteira principal': 7_500, 'Conta antiga': 2_500 });
  });

  test('resposta perdida, sessão perdida e versão concorrente não duplicam a transferência nem o estorno', async ({ page, request }) => {
    const token = await tokenOf(request, tenant.owner.email);
    const reserve = await createAccountByApi(request, token, ws(), 'Conta reserva', { openingBalanceCents: 100_000 });
    await login(page, tenant.owner.email);
    const transfers = callablePosts(page, 'createCashTransfer');
    await openCashAccounts(page);

    const openReview = async (amount: string) => {
      await page.getByRole('button', { name: 'Nova transferência' }).click();
      const form = dialogNamed(page, 'Nova transferência');
      await form.getByLabel('Conta de origem').selectOption(reserve);
      await form.getByLabel('Conta de destino').selectOption(mainAccount());
      await form.getByLabel('Valor (R$)').fill(amount);
      await form.getByRole('button', { name: 'Revisar' }).click();
      return dialogNamed(page, 'Confirmar transferência');
    };

    // Sessão perdida: o pedido chega sem credencial e é recusado, sem gravar.
    let review = await openReview('250,00');
    await page.route('**/createCashTransfer', async (route) => {
      const headers = { ...route.request().headers() };
      delete headers.authorization;
      await route.continue({ headers });
    });
    await review.getByRole('button', { name: 'Confirmar transferência' }).click();
    await expect(review.getByRole('alert')).toContainText('Sua sessão expirou');
    await page.unroute('**/createCashTransfer');
    expect(await transfersOf(ws())).toHaveLength(0);
    await review.getByRole('button', { name: 'Voltar' }).click();
    await dialogNamed(page, 'Nova transferência').getByRole('button', { name: 'Cancelar' }).click();

    // Resposta perdida: o servidor grava, o navegador não recebe. O reenvio do
    // mesmo conteúdo usa a mesma chave e devolve o resultado já gravado.
    review = await openReview('250,00');
    let dropped = false;
    await page.route('**/createCashTransfer', async (route) => {
      if (dropped) return route.continue();
      dropped = true;
      await route.fetch();
      await route.abort('connectionreset');
    });
    await review.getByRole('button', { name: 'Confirmar transferência' }).click();
    await expect(review.getByRole('alert')).toContainText('não duplica');
    await expect.poll(async () => (await transfersOf(ws())).length).toBe(1);
    await review.getByRole('button', { name: 'Confirmar transferência' }).click();
    await expect(review).toBeHidden({ timeout: 30_000 });
    await page.unroute('**/createCashTransfer');
    const keys = transfers.slice(-2).map((post) => bodyOf(post).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(await transfersOf(ws())).toHaveLength(1);
    expect(await expectLedgerConsistent(ws())).toEqual({ 'Carteira principal': 25_000, 'Conta reserva': 75_000 });

    // Versão concorrente: outra sessão estorna antes; a tela é recusada.
    const [transfer] = await transfersOf(ws());
    await transferRow(page, 'Conta reserva → Carteira principal').getByRole('button', { name: 'Estornar' }).click();
    const confirm = dialogNamed(page, 'Estornar transferência');
    await confirm.getByLabel(/Motivo do estorno/).fill('Estorno pela tela');
    const concurrent = await callCallable(request, token, 'reverseCashTransfer', {
      workspaceId: ws(), idempotencyKey: intentKey('concurrent-reversal'), transferId: transfer.id,
      expectedUpdatedAt: versionOf(transfer), reason: 'Estorno de outra sessão',
    });
    expect(concurrent.status, JSON.stringify(concurrent)).toBe(200);
    await confirm.getByRole('button', { name: 'Confirmar estorno' }).click();
    await expect(confirm.getByRole('alert')).toContainText('alterada por outra operação');
    const reversals = (await accountMovementsOf(ws())).filter((movement) => movement.kind === 'reversal');
    expect(reversals).toHaveLength(2);
    expect(await expectLedgerConsistent(ws())).toEqual({ 'Carteira principal': 0, 'Conta reserva': 100_000 });
  });
});

test.describe('PJ', () => {
  test.beforeEach(async () => {
    await resetEmulatorData();
    tenant = await seedLoanTenant('PJ', 'p3j-pj');
  });

  test('empréstimo e recebível com conta: principal, liquidação em outra conta, estornos na conta original, desconto fora', async ({ page, request }) => {
    const token = await tokenOf(request, tenant.owner.email);
    const pjAccount = await createAccountByApi(request, token, ws(), 'Conta PJ');

    // Captação na Conta PJ: o principal entra nela, sem virar receita.
    const loanId = await createLoanByApi(request, token, ws(), {
      personName: 'Banco Conta PJ', principalCents: 300_000, installments: 3, cashAccountId: pjAccount,
    });
    expect(await balanceOf(ws(), pjAccount)).toBe(300_000);

    // Liquidação pela tela, paga pela carteira principal: principal + juros saem dela.
    await login(page, tenant.owner.email);
    const payments = callablePosts(page, 'registerLoanPayment');
    await openLoans(page, 'PJ');
    await openLoanByCounterparty(page, 'Banco Conta PJ');
    await page.getByRole('button', { name: 'Novo Lançamento' }).click();
    const payment = dialogNamed(page, 'Registrar Pagamento (Passivo)');
    const payer = payment.getByLabel('Conta/carteira que paga');
    // A liquidação informa a própria conta, que pode diferir da contratação.
    await expect(payer).toHaveValue(mainAccount());
    await expect(payer.locator('option', { hasText: 'Conta PJ' })).toHaveCount(1);
    await payment.getByLabel('Juros / Taxas').fill('50,00');
    await payment.getByRole('button', { name: 'Confirmar Registro' }).click();
    await expect(payment).toBeHidden({ timeout: 30_000 });
    expect(bodyOf(payments[0])).toMatchObject({ loanId, principalCents: 100_000, interestCents: 5_000, cashAccountId: mainAccount() });
    expect(await balanceOf(ws(), mainAccount())).toBe(-105_000);
    expect(await balanceOf(ws(), pjAccount)).toBe(300_000);

    // Estorno da liquidação: volta na conta original da liquidação.
    const paid = (await loanMovementsOf(ws(), loanId)).find((movement) => movement.kind === 'payment')!;
    expect(paid.cashAccountId).toBe(mainAccount());
    const reversedLoan = await callCallable(request, token, 'reverseLoanMovement', {
      workspaceId: ws(), idempotencyKey: intentKey('loan-reverse'), loanId,
      expectedUpdatedAt: versionOf(await loanDoc(ws(), loanId)), movementId: paid.id, reason: 'Pagamento em duplicidade',
    });
    expect(reversedLoan.status, JSON.stringify(reversedLoan)).toBe(200);
    expect(await balanceOf(ws(), mainAccount())).toBe(0);

    // Recebível: recebimento pela tela na Conta PJ = principal + juros + multa.
    const clientId = await createClientByApi(request, token, ws(), { name: 'Cliente Conta PJ' });
    const receivableId = await createReceivableByApi(request, token, ws(), clientId, {
      description: 'Projeto com conta', amountCents: 100_000,
    });
    const receipts = callablePosts(page, 'receiveReceivable');
    await openClientsReceivables(page);
    await receivableRow(page, 'Projeto com conta').getByRole('button', { name: /Registrar recebimento/ }).click();
    const receipt = dialogNamed(page, 'Registrar recebimento');
    await receipt.getByLabel('Principal (R$)').fill('400,00');
    await receipt.getByLabel('Juros (R$)').fill('10,00');
    await receipt.getByLabel('Multa (R$)').fill('5,00');
    await receipt.getByLabel('Conta/carteira que recebe').selectOption({ label: 'Conta PJ' });
    await receipt.getByRole('button', { name: 'Registrar recebimento', exact: true }).click();
    await expect(receipt).toBeHidden({ timeout: 30_000 });
    expect(bodyOf(receipts[0])).toMatchObject({ principalCents: 40_000, interestCents: 1_000, penaltyCents: 500, cashAccountId: pjAccount });
    expect(await balanceOf(ws(), pjAccount)).toBe(300_000 + 41_500);

    // Desconto puro: quita parte do saldo sem mover conta nenhuma.
    await receiveByApi(request, token, ws(), receivableId, { discountCents: 10_000 });
    expect(await balanceOf(ws(), pjAccount)).toBe(341_500);
    expect(await balanceOf(ws(), mainAccount())).toBe(0);

    // Estorno do recebimento com dinheiro: sai da conta original.
    const cashReceipt = (await movementsOfReceivable(ws(), receivableId))
      .find((movement) => movement.kind === 'receipt' && movement.cashAccountId === pjAccount)!;
    const reversedReceipt = await callCallable(request, token, 'reverseReceivableReceipt', {
      workspaceId: ws(), idempotencyKey: intentKey('receipt-reverse'), receivableId,
      expectedUpdatedAt: versionOf(await docOf(ws(), 'receivables', receivableId)), movementId: cashReceipt.id,
      reason: 'Recebimento estornado',
    });
    expect(reversedReceipt.status, JSON.stringify(reversedReceipt)).toBe(200);

    // Livro-razão por origem: cada fato no seu domínio, com estornos ligados.
    const balances = await expectLedgerConsistent(ws());
    expect(balances).toEqual({ 'Carteira principal': 0, 'Conta PJ': 300_000 });
    const movements = await accountMovementsOf(ws());
    expect(movements.map((movement) => [movement.sourceDomain, movement.kind, movement.amountCents])
      .sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      ['loan', 'loan', -105_000], ['loan', 'loan', 300_000], ['loan', 'reversal', 105_000],
      ['receivable', 'receivable', 41_500], ['receivable', 'reversal', -41_500],
    ].sort((a, b) => String(a).localeCompare(String(b))));
    for (const reversal of movements.filter((movement) => movement.kind === 'reversal')) {
      expect(movements.some((movement) => movement.id === reversal.reversalOf)).toBe(true);
    }

    // Os estornos vieram de outra sessão: a lista é relida ao recarregar.
    await reload(page);
    await openCashAccounts(page);
    await expect(accountRow(page, 'Conta PJ')).toContainText(brl(300_000));
    await expect(accountRow(page, 'Carteira principal')).toContainText(brl(0));
    await expect(page.getByTestId('accounts-total')).toHaveText(brl(300_000));
  });
});
