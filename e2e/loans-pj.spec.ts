import { expect, test, type Page } from '@playwright/test';

import {
  bodyOf,
  brl,
  callablePosts,
  cashPeriod,
  createLoanByApi,
  db,
  dialogNamed,
  loanDoc,
  loansOf,
  login,
  movementsOf,
  openLoanByCounterparty,
  openLoans,
  resetEmulatorData,
  seedLoanTenant,
  tokenOf,
  transactionsOf,
  type LoanTenant,
} from './support/loans';

/**
 * P3-H — empréstimos PJ pela interface, no Emulator: mesmo motor e mesmas
 * callables do PF, com os campos gerenciais (tipo de contraparte, CNPJ/CPF,
 * classificação, centro de custo) validados no formulário e no backend.
 */
test.use({ timezoneId: 'America/Sao_Paulo' });

let tenant: LoanTenant;

test.beforeEach(async () => {
  await resetEmulatorData();
  tenant = await seedLoanTenant('PJ', 'p3h-pj');
});

type PJInput = {
  nature: 'Empresa tomou (passivo)' | 'Empresa concedeu (ativo)';
  name: string;
  counterparty?: string;
  document?: string;
  classification?: string;
  costCenter?: string;
  principal: string;
  installments: string;
  rate: string;
  period: 'Ao Mês (% a.m.)' | 'Ao Ano (% a.a.)';
  amortization: 'Tabela Price' | 'SAC' | 'Juros simples';
};

const fillPJForm = async (page: Page, input: PJInput) => {
  const dialog = dialogNamed(page, 'Registro de Operação Financeira');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radiogroup', { name: /Tipo de Operação/ }).getByRole('radio', { name: input.nature }).check();
  if (input.classification) {
    await dialog.getByLabel('Classificação Contábil').selectOption({ label: input.classification });
  }
  await dialog.getByLabel(/Nome \/ Razão Social/).fill(input.name);
  if (input.counterparty) await dialog.getByLabel('Tipo de Contraparte').selectOption({ label: input.counterparty });
  if (input.document) await dialog.getByLabel(/CNPJ \/ CPF/).fill(input.document);
  if (input.costCenter) await dialog.getByLabel(/Centro de Custo/).fill(input.costCenter);
  await dialog.getByLabel(/Valor Principal/).fill(input.principal);
  if (input.installments !== '1') {
    await dialog.getByLabel('Amortização em Parcelas Periódicas').check();
    await dialog.getByLabel('Quantidade de Parcelas').fill(input.installments);
  }
  await dialog.getByLabel('Tipo de Juros').selectOption({ label: 'Percentual (%)' });
  await dialog.getByLabel(/Taxa \(%\)/).fill(input.rate);
  await dialog.getByLabel('Base de Cálculo').selectOption({ label: input.period });
  await dialog.getByRole('combobox', { name: /Amortização/ }).selectOption({ label: input.amortization });
  return dialog;
};

const createPJ = async (page: Page, input: PJInput) => {
  await page.getByRole('button', { name: /Nova Operação/ }).click();
  const dialog = await fillPJForm(page, input);
  await dialog.getByRole('button', { name: 'Salvar registro' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: input.name, level: 3 })).toBeVisible({ timeout: 20_000 });
};

test('PJ: CNPJ e CPF válidos, classificação e centro de custo; Price, SAC e simples', async ({ page }) => {
  await login(page, tenant.owner.email);
  const creates = callablePosts(page, 'createLoan');
  await openLoans(page, 'PJ');

  // CNPJ com dígito verificador errado: recusado no formulário, sem chamada.
  await page.getByRole('button', { name: /Nova Operação/ }).click();
  const invalid = await fillPJForm(page, {
    nature: 'Empresa tomou (passivo)', name: 'Banco Corporativo', counterparty: 'Instituição Financeira',
    document: '11.222.333/0001-82', classification: 'Capital de Giro', costCenter: 'Operacional',
    principal: '50.000,00', installments: '24', rate: '1,5', period: 'Ao Mês (% a.m.)', amortization: 'Tabela Price',
  });
  await invalid.getByRole('button', { name: 'Salvar registro' }).click();
  await expect(invalid.getByRole('alert')).toContainText('dígito verificador');
  expect(creates).toHaveLength(0);
  await invalid.getByLabel(/CNPJ \/ CPF/).fill('11.222.333/0001-81');
  await invalid.getByRole('button', { name: 'Salvar registro' }).click();
  await expect(invalid).toBeHidden({ timeout: 30_000 });

  await createPJ(page, {
    nature: 'Empresa concedeu (ativo)', name: 'Colaboradora SAC', counterparty: 'Colaborador',
    document: '529.982.247-25', classification: 'Empréstimos a Colaboradores', costCenter: 'RH',
    principal: '6.000,00', installments: '6', rate: '12', period: 'Ao Ano (% a.a.)', amortization: 'SAC',
  });
  await createPJ(page, {
    nature: 'Empresa tomou (passivo)', name: 'Fornecedor Simples', principal: '3.000,00',
    installments: '3', rate: '2', period: 'Ao Mês (% a.m.)', amortization: 'Juros simples',
  });

  expect(bodyOf(creates[0])).toMatchObject({
    type: 'borrow', personName: 'Banco Corporativo', counterpartyType: 'banco', cnpjCpf: '11222333000181',
    classification: 'capital_giro', costCenter: 'Operacional', principalCents: 5_000_000, installments: 24,
    interest: { type: 'percentage', ratePpm: 15_000, ratePeriod: 'monthly', amortization: 'price' },
  });
  expect(bodyOf(creates[1])).toMatchObject({
    type: 'lend', counterpartyType: 'colaborador', cnpjCpf: '52998224725',
    classification: 'emprestimos_colaboradores', costCenter: 'RH',
    interest: { type: 'percentage', ratePpm: 120_000, ratePeriod: 'annual', amortization: 'sac' },
  });
  expect(bodyOf(creates[2])).not.toHaveProperty('cnpjCpf');
  const loans = await loansOf(tenant.workspaceId) as Array<Record<string, any>>;
  expect(loans.map((loan) => loan.profileType)).toEqual(['PJ', 'PJ', 'PJ']);
  const bank = loans.find((loan) => loan.personName === 'Banco Corporativo')!;
  expect([bank.cnpjCpf, bank.classification, bank.costCenter]).toEqual(['11222333000181', 'capital_giro', 'Operacional']);

  await openLoanByCounterparty(page, 'Banco Corporativo');
  await expect(page.getByTestId('loan-document')).toHaveText('11.222.333/0001-81');
  await expect(page.getByText('Capital de Giro').first()).toBeVisible();
  await expect(page.getByText('1,5% ao mês · Tabela Price')).toBeVisible();
  const rows = page.getByRole('list', { name: 'Parcelas do empréstimo' }).getByRole('listitem');
  await expect(rows).toHaveCount(24);
  await expect(rows.nth(23)).toContainText(brl(bank.schedule[23].totalCents));

  await openLoans(page, 'PJ');
  await expect(page.getByTestId('loans-total-borrow')).toHaveText(brl(5_000_000 + 300_000));
  await expect(page.getByTestId('loans-total-lend')).toHaveText(brl(600_000));
  for (const transaction of await transactionsOf(tenant.workspaceId)) {
    expect(transaction.id).toMatch(/^loancash_/);
    // Espelho com descrição genérica: nada da contraparte no caixa.
    expect(JSON.stringify(transaction)).not.toMatch(/Banco Corporativo|11222333000181|52998224725/);
  }
});

test('PJ: pagamento com principal e juros da parcela, estorno, metadados e cancelamento', async ({ page, request }) => {
  const token = await tokenOf(request, tenant.owner.email);
  const loanId = await createLoanByApi(request, token, tenant.workspaceId, {
    personName: 'Banco Capital de Giro', principalCents: 1_200_000, installments: 12,
    counterpartyType: 'banco', cnpjCpf: '11222333000181', classification: 'capital_giro',
    interest: { type: 'percentage', ratePpm: 20_000, ratePeriod: 'monthly', amortization: 'price' },
  });
  const created = await loanDoc(tenant.workspaceId, loanId);
  const first = created.schedule[0];
  await login(page, tenant.owner.email);
  const payments = callablePosts(page, 'registerLoanPayment');
  await openLoans(page, 'PJ');
  await openLoanByCounterparty(page, 'Banco Capital de Giro');

  // Sugestão = parcela 1 persistida; principal e juros separados.
  await page.getByRole('button', { name: 'Novo Lançamento' }).click();
  const dialog = dialogNamed(page, 'Registrar Pagamento (Passivo)');
  await dialog.getByRole('button', { name: 'Confirmar Registro' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  expect(bodyOf(payments[0])).toMatchObject({ principalCents: first.principalCents, interestCents: first.interestCents });
  await expect(page.getByTestId('loan-balance')).toHaveText(brl(1_200_000 - first.principalCents));
  await expect(page.getByTestId('loan-interest-settled')).toHaveText(brl(first.interestCents));
  await expect.poll(async () => {
    const period = await cashPeriod(tenant.workspaceId);
    return [period.expenseCents, period.loanPrincipalOutflowCents, period.financialExpenseCents];
  }, { timeout: 30_000 }).toEqual([0, first.principalCents, first.interestCents]);

  // Estorno restaura saldo e juros.
  await page.getByRole('button', { name: /^Estornar pagamento de / }).click();
  const reversal = dialogNamed(page, 'Estornar pagamento');
  await reversal.getByLabel(/Motivo do estorno/).fill('Débito em conta revertido pelo banco');
  await reversal.getByRole('button', { name: 'Confirmar estorno' }).click();
  await expect(reversal).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('loan-balance')).toHaveText(brl(1_200_000));
  await expect(page.getByTestId('loan-interest-settled')).toHaveText(brl(0));

  // Metadados PJ: documento validado no formulário; só nomes de campos na auditoria.
  await page.getByRole('button', { name: 'Editar Operação' }).click();
  const metadata = dialogNamed(page, 'Editar Dados da Operação');
  await metadata.getByLabel('Classificação Contábil').selectOption({ label: 'Dívidas Financeiras' });
  await metadata.getByLabel('Centro de Custo').fill('Filial Sul');
  await metadata.getByLabel(/CNPJ \/ CPF/).fill('529.982.247-24');
  await metadata.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(metadata.getByRole('alert')).toContainText('dígito verificador');
  await metadata.getByLabel(/CNPJ \/ CPF/).fill('529.982.247-25');
  await metadata.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(metadata).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('loan-document')).toHaveText('529.982.247-25');
  const updated = await loanDoc(tenant.workspaceId, loanId);
  expect([updated.classification, updated.costCenter, updated.cnpjCpf, updated.principalCents])
    .toEqual(['dividas_financeiras', 'Filial Sul', '52998224725', 1_200_000]);
  const [event] = (await db().collection(`workspaces/${tenant.workspaceId}/loan_events`)
    .where('operation', '==', 'loan.metadata_updated').get()).docs.map((doc) => doc.data());
  expect(event.changedFields).toEqual(['classification', 'cnpjCpf', 'costCenter']);
  expect(JSON.stringify(event)).not.toMatch(/52998224725|Filial Sul/);

  // Cancelamento: sem pagamentos ativos, compensa o principal no caixa.
  await page.getByRole('button', { name: 'Cancelar empréstimo' }).click();
  const cancel = dialogNamed(page, 'Cancelar empréstimo');
  await cancel.getByLabel(/Motivo do cancelamento/).fill('Operação não liberada pelo banco');
  await cancel.getByRole('button', { name: 'Cancelar empréstimo' }).click();
  await expect(cancel).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('loan-status')).toHaveText('Cancelado');
  expect((await movementsOf(tenant.workspaceId, loanId)).map((m: any) => m.kind).sort())
    .toEqual(['disbursement', 'payment', 'reversal', 'reversal']);
  await expect.poll(async () => (await cashPeriod(tenant.workspaceId)).netCents, { timeout: 30_000 }).toBe(0);
  await openLoans(page, 'PJ');
  await expect(page.getByTestId('loans-total-borrow')).toHaveText(brl(0));
});
