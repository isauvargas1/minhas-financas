import { expect, test, type Page } from '@playwright/test';

import { defaultCashAccountIdFor } from './support/workspaceSeed';
import { callCallable } from './support/callables';
import {
  addMonths,
  bodyOf,
  brl,
  callablePosts,
  cashPeriod,
  createLoanByApi,
  db,
  dialogNamed,
  intentKey,
  loanDoc,
  loansOf,
  login,
  movementsOf,
  openLoanByCounterparty,
  openLoans,
  pageAs,
  resetEmulatorData,
  seedLoanTenant,
  summaryCard,
  summaryFigure,
  today,
  tokenOf,
  transactionsOf,
  type LoanTenant,
} from './support/loans';

/**
 * P3-H — empréstimos PF pela interface, de ponta a ponta no Emulator (Auth,
 * Firestore e Functions reais). A tela só chama as callables; os testes leem
 * o resultado pelo Admin SDK.
 *
 * - criação sem juros, juros fixos e percentual (Price, SAC e simples), com o
 *   cronograma exibido igual ao persistido pelo backend;
 * - pagamento (principal + juros), estorno, quitação, metadados e
 *   cancelamento, com o efeito no caixa: o principal entra/sai do saldo sem
 *   virar receita ou despesa, só os juros viram resultado financeiro;
 * - concorrência (versão), reenvio depois de resposta perdida sem duplicar,
 *   member/viewer e perda de autorização com a tela aberta.
 */
test.use({ timezoneId: 'America/Sao_Paulo' });

let tenant: LoanTenant;

test.beforeEach(async () => {
  await resetEmulatorData();
  tenant = await seedLoanTenant('PF', 'p3h-pf');
});

type CreateInput = {
  type: 'Peguei emprestado' | 'Emprestei dinheiro';
  person: string;
  principal: string;
  installments: string;
  interest?: { kind: 'Valor Fixo (Total)'; total: string } |
    { kind: 'Percentual (%)'; rate: string; period: 'Ao Mês' | 'Ao Ano'; amortization: 'Tabela Price' | 'SAC' | 'Juros simples' };
};

const createThroughUi = async (page: Page, input: CreateInput) => {
  await page.getByRole('button', { name: /Novo Empréstimo/ }).click();
  const dialog = dialogNamed(page, 'Novo Empréstimo');
  await expect(dialog).toBeVisible();
  // PF e PJ separados: nenhum campo exclusivo de PJ no formulário PF.
  await expect(dialog.getByLabel(/CNPJ|Centro de Custo|Classificação|Tipo de Contraparte/i)).toHaveCount(0);
  await dialog.getByRole('radiogroup', { name: 'Natureza' }).getByRole('radio', { name: input.type }).check();
  await dialog.getByLabel(/Pessoa Envolvida/).fill(input.person);
  await dialog.getByLabel(/Valor Principal/).fill(input.principal);
  if (input.installments !== '1') {
    await dialog.getByLabel('Dividir em Parcelas Mensais').check();
    await dialog.getByLabel('Número de Parcelas').fill(input.installments);
  }
  if (input.interest) {
    await dialog.getByLabel('Tipo de Juros').selectOption({ label: input.interest.kind });
    if (input.interest.kind === 'Valor Fixo (Total)') {
      await dialog.getByLabel(/Valor Total \(R\$\)/).fill(input.interest.total);
    } else {
      await dialog.getByLabel(/Percentual \(%\)/).fill(input.interest.rate);
      await dialog.getByLabel('Período da Taxa').selectOption({ label: input.interest.period });
      await dialog.getByLabel(/Amortização/).selectOption({ label: input.interest.amortization });
    }
  }
  await dialog.getByRole('button', { name: 'Salvar Empréstimo' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: input.person, level: 3 })).toBeVisible({ timeout: 20_000 });
};

const loanByPerson = async (person: string) => {
  const loan = (await loansOf(tenant.workspaceId)).find((entry) => entry.personName === person) as
    Record<string, any> | undefined;
  expect(loan, person).toBeTruthy();
  return loan!;
};

const backToDashboard = async (page: Page) => {
  await page.getByRole('link', { name: /Dashboard/i }).click();
  await expect(summaryFigure(page, 'Saldo Atual')).toBeVisible();
};

const expectDashboard = async (page: Page, balanceCents: number) => {
  await backToDashboard(page);
  await expect(summaryCard(page, 'Receitas')).toHaveAccessibleName(/R\$\s*0,00/);
  await expect(summaryCard(page, 'Despesas')).toHaveAccessibleName(/R\$\s*0,00/);
  await expect(summaryFigure(page, 'Saldo Atual')).toContainText(brl(balanceCents));
};

/** Só espelhos do backend no caixa: nenhum lançamento do cliente. */
const expectOnlyBackendMirrors = async (count: number) => {
  const transactions = await transactionsOf(tenant.workspaceId);
  expect(transactions).toHaveLength(count);
  for (const transaction of transactions) {
    expect(transaction.id).toMatch(/^loancash_/);
    expect((transaction as Record<string, unknown>).loanEntry).toBeTruthy();
  }
};

test('PF: criação sem juros e com juros fixos pela tela; principal fora de receita/despesa', async ({ page }) => {
  await login(page, tenant.owner.email);
  const creates = callablePosts(page, 'createLoan');
  await openLoans(page, 'PF');
  await createThroughUi(page, { type: 'Peguei emprestado', person: 'Banco Sem Juros', principal: '3.000,00', installments: '3' });
  await createThroughUi(page, {
    type: 'Emprestei dinheiro', person: 'Amigo Juros Fixos', principal: '1.200,00', installments: '2',
    interest: { kind: 'Valor Fixo (Total)', total: '100,00' },
  });
  expect(bodyOf(creates[0])).toMatchObject({
    workspaceId: tenant.workspaceId, type: 'borrow', personName: 'Banco Sem Juros', principalCents: 300_000,
    installments: 3, interest: { type: 'none' }, startDate: today(), firstDueDate: addMonths(today(), 1),
  });
  expect(bodyOf(creates[1])).toMatchObject({
    type: 'lend', principalCents: 120_000, installments: 2, interest: { type: 'fixed', totalInterestCents: 10_000 },
  });
  for (const body of creates.map(bodyOf)) {
    for (const forbidden of ['balanceCents', 'status', 'schedule', 'createdBy', 'currentBalance', 'profileType']) {
      expect(body).not.toHaveProperty(forbidden);
    }
    expect(String(body.idempotencyKey).length).toBeGreaterThanOrEqual(8);
    // P3-J (D-30): a primeira conta ativa vem escolhida e acompanha o principal.
    expect(body.cashAccountId).toBe(defaultCashAccountIdFor(tenant.workspaceId));
  }
  // Captação entra e concessão sai da conta: 3.000,00 − 1.200,00.
  const account = await db().doc(
    `workspaces/${tenant.workspaceId}/cash_accounts/${defaultCashAccountIdFor(tenant.workspaceId)}`).get();
  expect(account.get('balanceCents')).toBe(300_000 - 120_000);
  const fixed = await loanByPerson('Amigo Juros Fixos');
  expect(fixed.scheduledInterestCents).toBe(10_000);
  expect(fixed.schedule.map((row: any) => row.totalCents)).toEqual([65_000, 65_000]);

  // Cronograma exibido = persistido.
  await openLoanByCounterparty(page, 'Amigo Juros Fixos');
  const rows = page.getByRole('list', { name: 'Parcelas do empréstimo' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(brl(60_000));
  await expect(rows.nth(0)).toContainText(brl(5_000));
  await expect(rows.nth(0)).toContainText(brl(65_000));
  await expect(page.getByTestId('loan-balance')).toHaveText(brl(120_000));
  await expect(page.getByTestId('loan-status')).toHaveText('Em dia');

  // Caixa: 3.000 entram, 1.200 saem; nada vira receita ou despesa.
  await expectOnlyBackendMirrors(2);
  await expectDashboard(page, 300_000 - 120_000);
  await openLoans(page, 'PF');
  await expect(page.getByTestId('loans-total-borrow')).toHaveText(brl(300_000));
  await expect(page.getByTestId('loans-total-lend')).toHaveText(brl(120_000));
});

test('PF: percentual com Price, SAC e juros simples; cronograma do backend na tela', async ({ page }) => {
  await login(page, tenant.owner.email);
  const creates = callablePosts(page, 'createLoan');
  await openLoans(page, 'PF');
  await createThroughUi(page, {
    type: 'Peguei emprestado', person: 'Financeira Price', principal: '10.000,00', installments: '12',
    interest: { kind: 'Percentual (%)', rate: '1,99', period: 'Ao Mês', amortization: 'Tabela Price' },
  });
  await createThroughUi(page, {
    type: 'Peguei emprestado', person: 'Banco SAC', principal: '6.000,00', installments: '6',
    interest: { kind: 'Percentual (%)', rate: '12', period: 'Ao Ano', amortization: 'SAC' },
  });
  await createThroughUi(page, {
    type: 'Emprestei dinheiro', person: 'Primo Simples', principal: '1.000,00', installments: '4',
    interest: { kind: 'Percentual (%)', rate: '2', period: 'Ao Mês', amortization: 'Juros simples' },
  });
  expect(creates.map((request) => bodyOf(request).interest)).toEqual([
    { type: 'percentage', ratePpm: 19_900, ratePeriod: 'monthly', amortization: 'price' },
    { type: 'percentage', ratePpm: 120_000, ratePeriod: 'annual', amortization: 'sac' },
    { type: 'percentage', ratePpm: 20_000, ratePeriod: 'monthly', amortization: 'simple' },
  ]);

  const sac = await loanByPerson('Banco SAC');
  // SAC: amortização constante (R$ 1.000,00) e prestações decrescentes.
  expect(sac.schedule.map((row: any) => row.principalCents)).toEqual(Array(6).fill(100_000));
  const sacTotals = sac.schedule.map((row: any) => row.totalCents);
  expect([...sacTotals].sort((a, b) => b - a)).toEqual(sacTotals);
  const simple = await loanByPerson('Primo Simples');
  expect(simple.scheduledInterestCents).toBe(8_000);
  const price = await loanByPerson('Financeira Price');
  expect(price.schedule).toHaveLength(12);

  await openLoanByCounterparty(page, 'Financeira Price');
  const rows = page.getByRole('list', { name: 'Parcelas do empréstimo' }).getByRole('listitem');
  await expect(rows).toHaveCount(12);
  for (const index of [0, 11]) {
    const row = price.schedule[index];
    await expect(rows.nth(index)).toContainText(brl(row.principalCents));
    await expect(rows.nth(index)).toContainText(brl(row.interestCents));
    await expect(rows.nth(index)).toContainText(brl(row.totalCents));
  }
  await expect(page.getByTestId('loan-interest-scheduled')).toHaveText(brl(price.scheduledInterestCents));
  await expect(page.getByText('1,99% ao mês · Tabela Price').first()).toBeVisible();

  await expectOnlyBackendMirrors(3);
  await expectDashboard(page, 1_000_000 + 600_000 - 100_000);
});

test('PF: pagamento com juros e estorno; saldo cai só pelo principal; juros como resultado financeiro', async ({ page, request }) => {
  const token = await tokenOf(request, tenant.owner.email);
  const loanId = await createLoanByApi(request, token, tenant.workspaceId, { personName: 'Banco Pagamento' });
  await login(page, tenant.owner.email);
  const payments = callablePosts(page, 'registerLoanPayment');
  await openLoans(page, 'PF');
  await openLoanByCounterparty(page, 'Banco Pagamento');

  await page.getByRole('button', { name: 'Registrar pagamento' }).click();
  const dialog = dialogNamed(page, 'Registrar pagamento');
  await expect(dialog.getByText('Valores sugeridos da parcela 1.')).toBeVisible();
  await expect(dialog.getByLabel(/^Principal/)).toHaveValue('1.000,00');
  await expect(dialog.getByLabel(/Juros \(R\$\)/)).toHaveValue('0,00');
  await dialog.getByLabel(/Juros \(R\$\)/).fill('50,00');
  await expect(dialog.getByText(brl(105_000))).toBeVisible();
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Pagamento registrado.' })).toBeVisible();
  expect(bodyOf(payments[0])).toMatchObject({ loanId, principalCents: 100_000, interestCents: 5_000, date: today() });
  expect(String(bodyOf(payments[0]).expectedUpdatedAt)).toMatch(/\.\d{9}Z$/);

  await expect(page.getByTestId('loan-balance')).toHaveText(brl(200_000));
  await expect(page.getByTestId('loan-interest-settled')).toHaveText(brl(5_000));
  const paid = await loanDoc(tenant.workspaceId, loanId);
  expect([paid.balanceCents, paid.totalPrincipalSettledCents, paid.totalInterestSettledCents])
    .toEqual([200_000, 100_000, 5_000]);
  await expectOnlyBackendMirrors(2);
  // Projeção oficial: principal separado; juros como despesa financeira.
  await expect.poll(async () => {
    const period = await cashPeriod(tenant.workspaceId);
    return [period.incomeCents, period.expenseCents, period.loanPrincipalInflowCents,
      period.loanPrincipalOutflowCents, period.financialExpenseCents, period.netCents];
  }, { timeout: 30_000 }).toEqual([0, 0, 300_000, 100_000, 5_000, 195_000]);

  // Estorno com motivo: original visível e marcado; saldo e caixa recompostos.
  const reverse = page.getByRole('button', { name: /^Estornar pagamento de / });
  await expect(reverse).toHaveCount(1);
  await reverse.click();
  const reversal = dialogNamed(page, 'Estornar pagamento');
  await expect(reversal.getByRole('button', { name: 'Confirmar estorno' })).toBeDisabled();
  await reversal.getByLabel(/Motivo do estorno/).fill('Pagamento lançado em duplicidade');
  await reversal.getByRole('button', { name: 'Confirmar estorno' }).click();
  await expect(reversal).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('loan-balance')).toHaveText(brl(300_000));
  await expect(page.getByTestId('loan-interest-settled')).toHaveText(brl(0));
  const history = page.getByRole('list', { name: 'Movimentos do empréstimo' });
  await expect(history.locator('[data-movement-kind="payment"]')).toContainText('Estornado');
  await expect(history.locator('[data-movement-kind="reversal"]')).toContainText('Estorno de pagamento');
  await expect(history.locator('[data-movement-kind="reversal"]')).toContainText('Motivo: Pagamento lançado em duplicidade');
  await expect(page.getByRole('button', { name: /^Estornar / })).toHaveCount(0);
  const movements = await movementsOf(tenant.workspaceId, loanId);
  expect(movements.map((movement: any) => movement.kind).sort()).toEqual(['disbursement', 'payment', 'reversal']);
  await expectOnlyBackendMirrors(3);
  await expect.poll(async () => {
    const period = await cashPeriod(tenant.workspaceId);
    return [period.loanPrincipalOutflowCents, period.financialExpenseCents, period.netCents];
  }, { timeout: 30_000 }).toEqual([0, 0, 300_000]);
  await expectDashboard(page, 300_000);
});

test('PF: quitação, metadados e cancelamento; cancelado fora dos totais', async ({ page, request }) => {
  const token = await tokenOf(request, tenant.owner.email);
  const loanId = await createLoanByApi(request, token, tenant.workspaceId, {
    personName: 'Banco Quitação', personContact: 'antigo@banco.example', type: 'lend',
  });
  await login(page, tenant.owner.email);
  await openLoans(page, 'PF');
  await expect(page.getByTestId('loans-total-lend')).toHaveText(brl(300_000));
  await openLoanByCounterparty(page, 'Banco Quitação');

  // Quitação: principal igual ao saldo → quitado pelo backend.
  await page.getByRole('button', { name: 'Registrar recebimento' }).click();
  const receipt = dialogNamed(page, 'Registrar recebimento');
  await receipt.getByLabel(/^Principal/).fill('3.000,00');
  await receipt.getByLabel(/Juros \(R\$\)/).fill('0');
  await receipt.getByRole('button', { name: 'Registrar' }).click();
  await expect(receipt).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('loan-status')).toHaveText('Quitado');
  await expect(page.getByTestId('loan-balance')).toHaveText(brl(0));
  await expect(page.getByRole('button', { name: 'Registrar recebimento' })).toBeDisabled();

  // Cancelar com recebimento ativo: a interface orienta estornar antes.
  await page.getByRole('button', { name: 'Cancelar empréstimo' }).click();
  const blocked = dialogNamed(page, 'Cancelar empréstimo');
  await expect(blocked.getByRole('alert')).toContainText('Estorne-os no histórico antes de cancelar');
  await expect(blocked.getByRole('button', { name: 'Cancelar empréstimo' })).toBeDisabled();
  await blocked.getByRole('button', { name: 'Voltar' }).click();

  await page.getByRole('button', { name: /^Estornar recebimento de / }).click();
  const reversal = dialogNamed(page, 'Estornar recebimento');
  await reversal.getByLabel(/Motivo do estorno/).fill('Recebimento não compensou');
  await reversal.getByRole('button', { name: 'Confirmar estorno' }).click();
  await expect(reversal).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('loan-status')).toHaveText('Em dia');

  // Metadados: só campos não financeiros; auditoria só com nomes de campos.
  await page.getByRole('button', { name: 'Editar dados' }).click();
  const metadata = dialogNamed(page, 'Editar dados do empréstimo');
  await expect(metadata.getByLabel(/Principal/)).toHaveCount(0);
  await metadata.getByLabel(/Contato/).fill('');
  await metadata.getByLabel(/Descrição/).fill('Reforma da cozinha');
  await metadata.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(metadata).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('Reforma da cozinha')).toBeVisible();
  const events = (await db().collection(`workspaces/${tenant.workspaceId}/loan_events`)
    .where('operation', '==', 'loan.metadata_updated').get()).docs.map((doc) => doc.data());
  expect(events).toHaveLength(1);
  expect(events[0].changedFields).toEqual(['description', 'personContact']);
  expect(JSON.stringify(events[0])).not.toContain('Reforma da cozinha');

  // Cancelamento: explicação, motivo obrigatório, histórico preservado.
  await page.getByRole('button', { name: 'Cancelar empréstimo' }).click();
  const cancel = dialogNamed(page, 'Cancelar empréstimo');
  for (const line of ['histórico do contrato e dos movimentos é preservado', 'compensado no caixa',
    'Pagamentos ativos precisam ser estornados antes', 'O contrato fica cancelado']) {
    await expect(cancel.getByText(line, { exact: false })).toBeVisible();
  }
  await expect(cancel.getByRole('button', { name: 'Cancelar empréstimo' })).toBeDisabled();
  await cancel.getByLabel(/Motivo do cancelamento/).fill('Contrato registrado por engano');
  await cancel.getByRole('button', { name: 'Cancelar empréstimo' }).click();
  await expect(cancel).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('loan-status')).toHaveText('Cancelado');
  await expect(page.getByTestId('loan-balance')).toHaveText('Cancelado');
  await expect(page.getByRole('button', { name: 'Registrar recebimento' })).toBeDisabled();
  for (const action of ['Cancelar empréstimo']) {
    await expect(page.getByRole('button', { name: action })).toHaveCount(0);
  }
  const cancelled = await loanDoc(tenant.workspaceId, loanId);
  expect(cancelled.status).toBe('cancelled');
  // Contratação, recebimento, estorno e cancelamento: nada apagado.
  const movements = await movementsOf(tenant.workspaceId, loanId);
  expect(movements).toHaveLength(4);
  expect(movements.find((movement: any) => movement.kind === 'disbursement')?.reversedBy).toBeTruthy();
  await expectOnlyBackendMirrors(4);

  await openLoans(page, 'PF');
  await expect(page.getByTestId('loans-total-lend')).toHaveText(brl(0));
  await expect(page.getByTestId('loans-total-borrow')).toHaveText(brl(0));
  await expectDashboard(page, 0);
});

test('PF: versão concorrente e reenvio após resposta perdida não duplicam', async ({ page, request }) => {
  const token = await tokenOf(request, tenant.owner.email);
  const loanId = await createLoanByApi(request, token, tenant.workspaceId, { personName: 'Banco Concorrência' });
  await login(page, tenant.owner.email);
  const payments = callablePosts(page, 'registerLoanPayment');
  await openLoans(page, 'PF');
  await openLoanByCounterparty(page, 'Banco Concorrência');
  await page.getByRole('button', { name: 'Registrar pagamento' }).click();
  const dialog = dialogNamed(page, 'Registrar pagamento');
  await expect(dialog.getByLabel(/^Principal/)).toHaveValue('1.000,00');

  // Outra sessão paga antes: a versão lida pela tela fica velha.
  const current = await loanDoc(tenant.workspaceId, loanId);
  const updatedAt = current.updatedAt.toDate().toISOString();
  const nanos = String(current.updatedAt.nanoseconds).padStart(9, '0');
  const other = await callCallable(request, token, 'registerLoanPayment', {
    workspaceId: tenant.workspaceId, idempotencyKey: intentKey('concurrent'), loanId,
    expectedUpdatedAt: `${updatedAt.slice(0, 19)}.${nanos}Z`, date: today(),
    principalCents: 50_000, interestCents: 0, cashAccountId: defaultCashAccountIdFor(tenant.workspaceId),
  });
  expect(other.status, JSON.stringify(other)).toBe(200);
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(dialog.getByRole('alert')).toContainText('alterado por outra operação');
  expect((await movementsOf(tenant.workspaceId, loanId)).filter((m: any) => m.kind === 'payment')).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByTestId('loan-balance')).toHaveText(brl(250_000));

  // Resposta perdida: o servidor grava, o navegador não recebe. O reenvio do
  // mesmo conteúdo usa a mesma chave e devolve o resultado já gravado.
  await page.getByRole('button', { name: 'Registrar pagamento' }).click();
  await expect(dialog.getByLabel(/^Principal/)).toHaveValue('500,00');
  let dropped = false;
  await page.route('**/registerLoanPayment', async (route) => {
    if (dropped) return route.continue();
    dropped = true;
    await route.fetch();
    await route.abort('connectionreset');
  });
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(dialog.getByRole('alert')).toContainText('não duplica');
  await expect.poll(async () => (await movementsOf(tenant.workspaceId, loanId))
    .filter((m: any) => m.kind === 'payment').length).toBe(2);
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page.unroute('**/registerLoanPayment');
  const keys = payments.slice(-2).map((post) => bodyOf(post).idempotencyKey);
  expect(keys[0]).toBe(keys[1]);
  expect((await movementsOf(tenant.workspaceId, loanId)).filter((m: any) => m.kind === 'payment')).toHaveLength(2);
  expect((await loanDoc(tenant.workspaceId, loanId)).balanceCents).toBe(200_000);
  await expectOnlyBackendMirrors(3);
});

test('PF: member administra só o que criou; viewer só lê; perda de papel com a tela aberta', async ({ page, request, browser }) => {
  const ownerToken = await tokenOf(request, tenant.owner.email);
  const memberToken = await tokenOf(request, tenant.member.email);
  await createLoanByApi(request, ownerToken, tenant.workspaceId, { personName: 'Contrato do Titular' });
  const memberLoanId = await createLoanByApi(request, memberToken, tenant.workspaceId, { personName: 'Contrato do Membro' });

  // Member: lê tudo; administra só o próprio contrato.
  await login(page, tenant.member.email);
  await openLoans(page, 'PF');
  await expect(page.getByRole('button', { name: /Novo Empréstimo/ })).toBeVisible();
  await openLoanByCounterparty(page, 'Contrato do Titular');
  for (const action of ['Registrar pagamento', 'Editar dados', 'Cancelar empréstimo']) {
    await expect(page.getByRole('button', { name: action })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Voltar' }).click();
  await openLoanByCounterparty(page, 'Contrato do Membro');
  await expect(page.getByRole('button', { name: 'Registrar pagamento' })).toBeVisible();

  // Viewer: sem nenhuma ação.
  const viewer = await pageAs(browser, tenant.viewer.email);
  await openLoans(viewer, 'PF');
  await expect(viewer.getByRole('button', { name: /Novo Empréstimo/ })).toHaveCount(0);
  await openLoanByCounterparty(viewer, 'Contrato do Membro');
  for (const action of ['Registrar pagamento', 'Editar dados', 'Cancelar empréstimo']) {
    await expect(viewer.getByRole('button', { name: action })).toHaveCount(0);
  }
  await viewer.context().close();

  // Perda de papel com o diálogo aberto: o backend recusa, nada é gravado.
  await page.getByRole('button', { name: 'Registrar pagamento' }).click();
  const dialog = dialogNamed(page, 'Registrar pagamento');
  await db().doc(`workspaces/${tenant.workspaceId}/members/${tenant.member.uid}`).update({ role: 'viewer' });
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(dialog.getByRole('alert')).toContainText('não permite esta operação');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  // Membership removido: a edição de dados também é recusada.
  await db().doc(`workspaces/${tenant.workspaceId}/members/${tenant.member.uid}`).update({ role: 'member', status: 'removed' });
  await page.getByRole('button', { name: 'Editar dados' }).click();
  const metadata = dialogNamed(page, 'Editar dados do empréstimo');
  await metadata.getByLabel(/Descrição/).fill('Tentativa sem acesso');
  await metadata.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(metadata.getByRole('alert')).toContainText('acesso');
  const memberLoan = await loanDoc(tenant.workspaceId, memberLoanId);
  expect([memberLoan.balanceCents, memberLoan.revision, memberLoan.description]).toEqual([300_000, 1, undefined]);
  expect(await movementsOf(tenant.workspaceId, memberLoanId)).toHaveLength(1);
});
