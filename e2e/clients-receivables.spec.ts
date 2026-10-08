import { expect, test, type Page } from '@playwright/test';

import {
  bodyOf,
  brl,
  callablePosts,
  cashPeriod,
  db,
  dayKey,
  dialogNamed,
  intentKey,
  login,
  pageAs,
  PASSWORD,
  resetEmulatorData,
  seedLoanTenant,
  summaryCard,
  summaryFigure,
  today,
  tokenOf,
  transactionsOf,
  type LoanTenant,
} from './support/loans';
import { callCallable } from './support/callables';
import {
  cancelByApi,
  clientRow,
  createClientByApi,
  createReceivableByApi,
  docOf,
  listOf,
  movementsOfReceivable,
  openClientsReceivables,
  openClientsTab,
  privateDataRequests,
  receivableByDescription,
  receivableRow,
  receiveByApi,
  versionOf,
} from './support/receivables';
import {
  adminSdk,
  defaultCashAccountIdFor,
  seedAccountProfile,
  seedMembership,
  seedOwnedWorkspace,
} from './support/workspaceSeed';

/**
 * P3-I — clientes e recebíveis pela interface, no Emulator (Auth, Firestore e
 * Functions reais):
 * - cliente: cadastro, edição, dados pessoais só no documento privado,
 *   arquivamento bloqueado com recebível em aberto;
 * - recebível: criação e edição; recebimento parcial, segundo e quitação com
 *   juros, multa e desconto; estorno; cancelamento; atraso derivado;
 * - caixa: um espelho por recebimento com dinheiro (principal + juros +
 *   multa), nenhum para desconto puro, projeção classificada;
 * - RBAC (member, viewer), dados pessoais nunca pedidos por member/viewer,
 *   troca de workspace, perda de papel e de sessão, versão concorrente e
 *   reenvio depois de resposta perdida sem duplicar.
 */
test.use({ timezoneId: 'America/Sao_Paulo' });

let tenant: LoanTenant;
const ws = () => tenant.workspaceId;

test.beforeEach(async () => {
  await resetEmulatorData();
  tenant = await seedLoanTenant('PJ', 'p3i');
});

/** Só espelhos de recebimento no caixa: nenhum lançamento do cliente. */
const expectOnlyReceivableMirrors = async (count: number) => {
  const transactions = await transactionsOf(ws());
  expect(transactions).toHaveLength(count);
  for (const transaction of transactions) {
    expect(transaction.id).toMatch(/^recvcash_/);
    expect((transaction as Record<string, unknown>).receivableEntry).toBeTruthy();
  }
  return transactions;
};

const fillReceipt = async (page: Page, values: Partial<Record<'Principal' | 'Juros' | 'Multa' | 'Desconto', string>>) => {
  const dialog = dialogNamed(page, 'Registrar recebimento');
  await expect(dialog).toBeVisible();
  for (const [label, value] of Object.entries(values)) {
    await dialog.getByLabel(`${label} (R$)`).fill(value);
  }
  return dialog;
};

test('cliente: cadastro e edição pela tela; dados pessoais só no privado; arquivar bloqueado com recebível em aberto', async ({ page, request }) => {
  await login(page, tenant.owner.email);
  await openClientsReceivables(page);
  await openClientsTab(page);

  await page.getByRole('button', { name: 'Novo Cliente' }).click();
  const form = dialogNamed(page, 'Novo Cliente');
  await form.getByLabel(/^Nome/).fill('Comercial Exemplo Ltda.');
  await form.getByLabel('E-mail').fill('Financeiro@Cliente.Example');
  await form.getByLabel('Telefone').fill('(11) 98765-4321');
  await form.getByLabel('CPF/CNPJ').fill('11.222.333/0001-82');
  await form.getByLabel('Observações').fill('Prefere boleto');
  await form.getByRole('button', { name: 'Salvar' }).click();
  // Dígito verificador errado: recusado pelo backend, em pt-BR, sem gravar.
  await expect(form.getByRole('alert')).toContainText('CNPJ/CPF: dígito verificador inválido.');
  expect(await listOf(ws(), 'clients')).toHaveLength(0);
  await form.getByLabel('CPF/CNPJ').fill('11.222.333/0001-81');
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(form).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('status')).toHaveText('Cliente cadastrado.');
  const row = clientRow(page, 'Comercial Exemplo Ltda.');
  await expect(row).toContainText('financeiro@cliente.example');
  await expect(row).toContainText('(11) 98765-4321');
  await expect(row).toContainText('11.222.333/0001-81');

  // D-24: cadastro compartilhado mínimo; dados pessoais no documento privado.
  const [client] = await listOf(ws(), 'clients');
  expect(Object.keys(client).sort()).toEqual([
    'clientId', 'createdAt', 'createdBy', 'id', 'name', 'schemaVersion', 'status', 'updatedAt', 'updatedBy', 'workspaceId',
  ]);
  const personal = await docOf(ws(), 'client_private', client.id);
  expect([personal.document, personal.email, personal.phone, personal.notes])
    .toEqual(['11222333000181', 'financeiro@cliente.example', '(11) 98765-4321', 'Prefere boleto']);
  const created = await listOf(ws(), 'client_events');
  expect(JSON.stringify(created)).not.toContain('11222333000181');
  expect(JSON.stringify(created)).not.toContain('financeiro@cliente.example');

  // Edição: só o que mudou; observação apagada sai do documento privado.
  await row.getByRole('button', { name: /Editar cliente/ }).click();
  const edit = dialogNamed(page, 'Editar Cliente');
  await expect(edit.getByLabel('E-mail')).toHaveValue('financeiro@cliente.example');
  await edit.getByLabel('Telefone').fill('(11) 3333-4444');
  await edit.getByLabel('Observações').fill('');
  await edit.getByRole('button', { name: 'Salvar' }).click();
  await expect(edit).toBeHidden({ timeout: 30_000 });
  await expect(row).toContainText('(11) 3333-4444');
  const edited = await docOf(ws(), 'client_private', client.id);
  expect([edited.phone, edited.notes]).toEqual(['(11) 3333-4444', undefined]);

  // Arquivar com recebível em aberto: bloqueado, com a explicação.
  const token = await tokenOf(request, tenant.owner.email);
  const receivableId = await createReceivableByApi(request, token, ws(), client.id, { description: 'Em aberto' });
  await row.getByRole('button', { name: /Arquivar cliente/ }).click();
  const archive = dialogNamed(page, 'Arquivar cliente');
  await expect(archive.getByRole('alert')).toContainText('1 recebível em aberto');
  await expect(archive.getByRole('button', { name: 'Arquivar cliente' })).toBeDisabled();
  await archive.getByRole('button', { name: 'Voltar' }).click();

  // Sem recebível em aberto: arquiva; continua referenciado; sem ações.
  await cancelByApi(request, token, ws(), receivableId);
  await page.reload();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
  await openClientsReceivables(page);
  await openClientsTab(page);
  await clientRow(page, 'Comercial Exemplo Ltda.').getByRole('button', { name: /Arquivar cliente/ }).click();
  const confirm = dialogNamed(page, 'Arquivar cliente');
  await expect(confirm.getByRole('button', { name: 'Arquivar cliente' })).toBeEnabled();
  await confirm.getByRole('button', { name: 'Arquivar cliente' }).click();
  await expect(confirm).toBeHidden({ timeout: 30_000 });
  const archivedRow = clientRow(page, 'Comercial Exemplo Ltda.');
  await expect(archivedRow).toContainText('Arquivado');
  await expect(archivedRow.getByRole('button')).toHaveCount(0);
  expect((await docOf(ws(), 'clients', client.id)).status).toBe('archived');
  expect((await docOf(ws(), 'receivables', receivableId)).clientId).toBe(client.id);
  // Arquivado não recebe novo recebível: nem aparece na escolha.
  await page.getByRole('button', { name: 'Recebíveis', exact: true }).click();
  await page.getByRole('button', { name: 'Novo Recebível' }).click();
  const newReceivable = dialogNamed(page, 'Novo Recebível');
  await expect(newReceivable.getByText('Cadastre um cliente primeiro.')).toBeVisible();
  await expect(newReceivable.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  expect(await listOf(ws(), 'transactions')).toHaveLength(0);
});

test('recebível: criação e edição pela tela em centavos; valor travado depois de recebimento', async ({ page, request }) => {
  const token = await tokenOf(request, tenant.owner.email);
  await createClientByApi(request, token, ws(), { name: 'Cliente Alfa' });
  await login(page, tenant.owner.email);
  await openClientsReceivables(page);
  await page.getByRole('button', { name: 'Novo Recebível' }).click();
  const form = dialogNamed(page, 'Novo Recebível');
  await form.getByLabel(/^Descrição/).fill('Projeto de implantação');
  await expect(form.getByLabel(/^Cliente/)).toHaveValue(/cli_/);
  await form.getByLabel(/^Valor/).fill('10.50');
  await form.getByLabel(/^Vencimento/).fill(dayKey(20));
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(form.getByRole('alert')).toContainText('vírgula para os centavos');
  await form.getByLabel(/^Valor/).fill('1.500,00');
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect(form).toBeHidden({ timeout: 30_000 });
  const row = receivableRow(page, 'Projeto de implantação');
  await expect(row).toContainText('Cliente Alfa');
  await expect(row).toContainText('Em aberto');
  await expect(row).toContainText(brl(150_000));
  const stored = await receivableByDescription(ws(), 'Projeto de implantação');
  expect([stored.amountCents, stored.balanceCents, stored.status, stored.dueDate])
    .toEqual([150_000, 150_000, 'open', dayKey(20)]);
  expect(stored.value).toBeUndefined();

  // Edição: descrição, vencimento e valor (sem recebimento ainda).
  await row.getByRole('button', { name: /^Editar/ }).click();
  const edit = dialogNamed(page, 'Editar Recebível');
  await expect(edit.getByLabel(/^Valor/)).toHaveValue('1.500,00');
  await edit.getByLabel(/^Descrição/).fill('Implantação fase 1');
  await edit.getByLabel(/^Valor/).fill('1.200,00');
  await edit.getByLabel(/^Vencimento/).fill(dayKey(30));
  await edit.getByRole('button', { name: 'Salvar' }).click();
  await expect(edit).toBeHidden({ timeout: 30_000 });
  const updated = await docOf(ws(), 'receivables', stored.id);
  expect([updated.description, updated.amountCents, updated.balanceCents, updated.dueDate])
    .toEqual(['Implantação fase 1', 120_000, 120_000, dayKey(30)]);

  // Depois de um recebimento: o valor original fica travado na tela.
  await receiveByApi(request, token, ws(), stored.id, { principalCents: 20_000 });
  await page.reload();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
  await openClientsReceivables(page);
  await receivableRow(page, 'Implantação fase 1').getByRole('button', { name: /^Editar/ }).click();
  const locked = dialogNamed(page, 'Editar Recebível');
  await expect(locked.getByLabel(/^Valor/)).toBeDisabled();
  await expect(locked.getByText(/não pode mudar depois de recebimento/)).toBeVisible();
  await locked.getByRole('button', { name: 'Cancelar' }).click();
  await expectOnlyReceivableMirrors(1);
});

test('recebimentos: parcial com juros e multa, quitação com desconto; caixa = principal + juros + multa', async ({ page, request }) => {
  const token = await tokenOf(request, tenant.owner.email);
  const clientId = await createClientByApi(request, token, ws(), { name: 'Cliente Beta' });
  const receivableId = await createReceivableByApi(request, token, ws(), clientId, {
    description: 'Consultoria mensal', amountCents: 100_000, dueDate: dayKey(3),
  });
  await login(page, tenant.owner.email);
  const receipts = callablePosts(page, 'receiveReceivable');
  await openClientsReceivables(page);
  await expect(page.getByTestId('receivables-total-open')).toHaveText(brl(100_000));
  await expect(page.getByTestId('receivables-total-upcoming')).toHaveText(brl(100_000));

  // Parcial: R$ 400 de principal + R$ 10 de juros + R$ 5 de multa.
  await receivableRow(page, 'Consultoria mensal').getByRole('button', { name: /Registrar recebimento/ }).click();
  let dialog = dialogNamed(page, 'Registrar recebimento');
  await expect(dialog.getByLabel('Principal (R$)')).toHaveValue('1.000,00');
  dialog = await fillReceipt(page, { Principal: '400,00', Juros: '10,00', Multa: '5,00' });
  await expect(dialog.getByText('Total que entra no caixa')).toBeVisible();
  await expect(dialog.locator('dd').first()).toHaveText(brl(41_500));
  await expect(dialog.locator('dd').nth(1)).toHaveText(brl(60_000));
  await dialog.getByRole('button', { name: 'Registrar recebimento', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('status')).toHaveText('Recebimento registrado.');
  const row = receivableRow(page, 'Consultoria mensal');
  await expect(row).toContainText(brl(60_000));
  await expect(row).toContainText('Em aberto');

  // Segundo: R$ 500 de principal + R$ 100 de desconto → quitado.
  await row.getByRole('button', { name: /Registrar recebimento/ }).click();
  dialog = await fillReceipt(page, { Principal: '500,00', Desconto: '100,00' });
  await expect(dialog.locator('dd').first()).toHaveText(brl(50_000));
  await expect(dialog.locator('dd').nth(1)).toHaveText(brl(0));
  await dialog.getByRole('button', { name: 'Registrar recebimento', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('status')).toHaveText('Recebimento registrado. O recebível foi quitado.');
  await expect(row).toContainText('Recebido');
  await expect(row.getByRole('button', { name: /Registrar recebimento/ })).toHaveCount(0);
  // Recebido fica fora dos totais.
  await expect(page.getByTestId('receivables-total-open')).toHaveText(brl(0));
  await expect(page.getByTestId('receivables-total-upcoming')).toHaveText(brl(0));

  const stored = await docOf(ws(), 'receivables', receivableId);
  expect([stored.status, stored.balanceCents, stored.principalReceivedCents, stored.discountGrantedCents,
    stored.interestReceivedCents, stored.penaltyReceivedCents]).toEqual(['received', 0, 90_000, 10_000, 1_000, 500]);
  expect(receipts.map((post) => bodyOf(post)).map((body) =>
    [body.principalCents, body.interestCents, body.penaltyCents, body.discountCents]))
    .toEqual([[40_000, 1_000, 500, 0], [50_000, 0, 0, 10_000]]);

  // Exatamente um espelho por recebimento, só com o dinheiro.
  const mirrors = await expectOnlyReceivableMirrors(2);
  expect(mirrors.map((mirror) => mirror.valueCents).sort((a, b) => a - b)).toEqual([41_500, 50_000]);
  for (const mirror of mirrors) {
    expect(mirror.type).toBe('receita');
    expect(JSON.stringify(mirror)).not.toContain('Cliente Beta');
  }
  // Projeção: principal operacional; juros e multa financeiros; desconto fora.
  await expect.poll(async () => (await cashPeriod(ws())).netCents, { timeout: 30_000 }).toBe(91_500);
  const period = await cashPeriod(ws());
  expect([period.incomeCents, period.financialIncomeCents, period.expenseCents])
    .toEqual([90_000, 1_500, 0]);

  // Histórico: desconto à parte, nunca somado ao recebido.
  await row.getByRole('button', { name: /Histórico/ }).click();
  const history = dialogNamed(page, 'Histórico do recebível');
  await expect(history.getByRole('listitem')).toHaveCount(2);
  // Mesma data: a ordem entre os dois segue o ID; localiza-se pelo conteúdo.
  const withDiscount = history.getByRole('listitem').filter({ hasText: /Desconto \(não é dinheiro\)R\$\s*100,00/ });
  await expect(withDiscount).toHaveCount(1);
  await expect(withDiscount).toContainText(/Total recebidoR\$\s*500,00/);
  const withInterest = history.getByRole('listitem').filter({ hasText: /JurosR\$\s*10,00/ });
  await expect(withInterest).toContainText(/MultaR\$\s*5,00/);
  await expect(withInterest).toContainText(/Total recebidoR\$\s*415,00/);
  await history.getByRole('button', { name: 'Fechar', exact: true }).last().click();

  // Dashboard: "Receitas" só com o principal; o saldo com todo o dinheiro.
  await page.getByRole('link', { name: /Dashboard/i }).click();
  await expect(summaryFigure(page, 'Saldo Atual')).toContainText(brl(91_500));
  await expect(summaryCard(page, 'Receitas')).toHaveAccessibleName(/R\$\s*900,00/);
  await expect(summaryCard(page, 'Despesas')).toHaveAccessibleName(/R\$\s*0,00/);
});

test('estorno e cancelamento: compensação no caixa; cancelar só sem recebimento ativo; sem efeito de caixa', async ({ page, request }) => {
  const token = await tokenOf(request, tenant.owner.email);
  const clientId = await createClientByApi(request, token, ws(), { name: 'Cliente Gama' });
  const receivableId = await createReceivableByApi(request, token, ws(), clientId, {
    description: 'Licença anual', amountCents: 80_000,
  });
  await receiveByApi(request, token, ws(), receivableId, { principalCents: 30_000, interestCents: 2_000, discountCents: 5_000 });
  await login(page, tenant.owner.email);
  await openClientsReceivables(page);
  const row = receivableRow(page, 'Licença anual');
  await expect(row).toContainText(brl(45_000));

  // Cancelar com recebimento ativo: bloqueado, com orientação.
  await row.getByRole('button', { name: /Cancelar recebível/ }).click();
  const blocked = dialogNamed(page, 'Cancelar recebível');
  await expect(blocked.getByRole('alert')).toContainText('Estorne-os no histórico');
  await expect(blocked.getByRole('button', { name: 'Cancelar recebível' })).toBeDisabled();
  await blocked.getByRole('button', { name: 'Voltar' }).click();

  // Estorno pelo histórico, com motivo.
  await row.getByRole('button', { name: /Histórico/ }).click();
  const history = dialogNamed(page, 'Histórico do recebível');
  await history.getByRole('button', { name: 'Estornar' }).click();
  const reverse = dialogNamed(page, 'Estornar recebimento');
  await expect(reverse.getByRole('button', { name: 'Confirmar estorno' })).toBeDisabled();
  await reverse.getByLabel(/Motivo do estorno/).fill('Recebimento lançado em duplicidade');
  await reverse.getByRole('button', { name: 'Confirmar estorno' }).click();
  await expect(reverse).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('status')).toHaveText('Estorno registrado. O saldo e o caixa foram recompostos.');
  await expect(row).toContainText(brl(80_000));
  const afterReversal = await docOf(ws(), 'receivables', receivableId);
  expect([afterReversal.balanceCents, afterReversal.principalReceivedCents, afterReversal.discountGrantedCents,
    afterReversal.interestReceivedCents, afterReversal.activeReceiptCount, afterReversal.status])
    .toEqual([80_000, 0, 0, 0, 0, 'open']);
  const movements = await movementsOfReceivable(ws(), receivableId);
  expect(movements.map((movement) => movement.kind).sort()).toEqual(['receipt', 'reversal']);
  expect(movements.find((movement) => movement.kind === 'receipt')?.reversedBy).toBeTruthy();
  const mirrors = await expectOnlyReceivableMirrors(2);
  expect(mirrors.map((mirror) => [mirror.type, mirror.valueCents]).sort())
    .toEqual([['despesa', 32_000], ['receita', 32_000]]);
  await expect.poll(async () => (await cashPeriod(ws())).transactionCount, { timeout: 30_000 }).toBe(2);
  const period = await cashPeriod(ws());
  expect([period.netCents, period.incomeCents, period.financialIncomeCents, period.expenseCents]).toEqual([0, 0, 0, 0]);

  // Cancelamento lógico, sem caixa, terminal.
  await row.getByRole('button', { name: /Cancelar recebível/ }).click();
  const cancel = dialogNamed(page, 'Cancelar recebível');
  await cancel.getByLabel(/Motivo do cancelamento/).fill('Contrato rescindido');
  await cancel.getByRole('button', { name: 'Cancelar recebível' }).click();
  await expect(cancel).toBeHidden({ timeout: 30_000 });
  await expect(row).toContainText('Cancelado');
  for (const action of [/Registrar recebimento/, /^Editar/, /Cancelar recebível/]) {
    await expect(row.getByRole('button', { name: action })).toHaveCount(0);
  }
  await expect(page.getByTestId('receivables-total-open')).toHaveText(brl(0));
  expect((await docOf(ws(), 'receivables', receivableId)).status).toBe('cancelled');
  await expectOnlyReceivableMirrors(2);
  expect(await listOf(ws(), 'receivables')).toHaveLength(1);
});

test('atraso derivado pela data civil de São Paulo; nunca gravado', async ({ page, request }) => {
  const token = await tokenOf(request, tenant.owner.email);
  const clientId = await createClientByApi(request, token, ws(), { name: 'Cliente Delta' });
  await createReceivableByApi(request, token, ws(), clientId, { description: 'Vencido ontem', amountCents: 30_000, dueDate: dayKey(-1) });
  await createReceivableByApi(request, token, ws(), clientId, { description: 'Vence hoje', amountCents: 20_000, dueDate: today() });
  await createReceivableByApi(request, token, ws(), clientId, { description: 'Daqui a 10 dias', amountCents: 10_000, dueDate: dayKey(10) });
  await login(page, tenant.owner.email);
  await openClientsReceivables(page);
  await expect(receivableRow(page, 'Vencido ontem')).toContainText('Em atraso');
  await expect(receivableRow(page, 'Vence hoje')).toContainText('Em aberto');
  await expect(receivableRow(page, 'Daqui a 10 dias')).toContainText('Em aberto');
  await expect(page.getByTestId('receivables-total-open')).toHaveText(brl(60_000));
  await expect(page.getByTestId('receivables-total-overdue')).toHaveText(brl(30_000));
  await expect(page.getByTestId('receivables-total-upcoming')).toHaveText(brl(20_000));
  for (const receivable of await listOf(ws(), 'receivables')) {
    expect(receivable.status).toBe('open');
  }
});

test('RBAC: member só administra o que criou; viewer só lê; dados pessoais nunca pedidos por member/viewer', async ({ page, request, browser }) => {
  const ownerToken = await tokenOf(request, tenant.owner.email);
  const memberToken = await tokenOf(request, tenant.member.email);
  const clientId = await createClientByApi(request, ownerToken, ws(), {
    name: 'Cliente Sigiloso', email: 'sigilo@cliente.example', document: '529.982.247-25', phone: '(21) 99999-0000',
  });
  await createReceivableByApi(request, ownerToken, ws(), clientId, { description: 'Do titular' });
  const memberReceivable = await createReceivableByApi(request, memberToken, ws(), clientId, { description: 'Do membro' });

  // Controle positivo: o owner pede (e recebe) os dados pessoais.
  const ownerPrivate = privateDataRequests(page);
  await login(page, tenant.owner.email);
  await openClientsReceivables(page);
  await openClientsTab(page);
  await expect(clientRow(page, 'Cliente Sigiloso')).toContainText('sigilo@cliente.example');
  expect(ownerPrivate.length).toBeGreaterThan(0);

  // Member: lista mínima, nenhum pedido de dados pessoais, ações só no próprio.
  const member = await browser.newContext({ timezoneId: 'America/Sao_Paulo' }).then((context) => context.newPage());
  const memberPrivate = privateDataRequests(member);
  await login(member, tenant.member.email);
  await openClientsReceivables(member);
  await expect(receivableRow(member, 'Do membro').getByRole('button', { name: /Registrar recebimento/ })).toHaveCount(1);
  for (const action of [/Registrar recebimento/, /^Editar/, /Cancelar recebível/]) {
    await expect(receivableRow(member, 'Do titular').getByRole('button', { name: action })).toHaveCount(0);
  }
  await expect(receivableRow(member, 'Do titular').getByRole('button', { name: /Histórico/ })).toHaveCount(1);
  await openClientsTab(member);
  await expect(member.getByRole('button', { name: 'Novo Cliente' })).toHaveCount(0);
  const memberRow = clientRow(member, 'Cliente Sigiloso');
  await expect(memberRow).toContainText('Restrito');
  await expect(memberRow).not.toContainText('sigilo@cliente.example');
  await expect(memberRow.getByRole('button')).toHaveCount(0);
  await expect(member.getByText('529.982.247-25')).toHaveCount(0);
  expect(memberPrivate, 'member pediu client_private').toHaveLength(0);

  // Viewer: só lê.
  const viewer = await pageAs(browser, tenant.viewer.email);
  const viewerPrivate = privateDataRequests(viewer);
  await openClientsReceivables(viewer);
  await expect(viewer.getByRole('button', { name: 'Novo Recebível' })).toHaveCount(0);
  for (const description of ['Do titular', 'Do membro']) {
    for (const action of [/Registrar recebimento/, /^Editar/, /Cancelar recebível/]) {
      await expect(receivableRow(viewer, description).getByRole('button', { name: action })).toHaveCount(0);
    }
  }
  await openClientsTab(viewer);
  await expect(clientRow(viewer, 'Cliente Sigiloso')).toContainText('Restrito');
  expect(viewerPrivate, 'viewer pediu client_private').toHaveLength(0);
  await viewer.context().close();

  // O backend decide: member não opera o recebível do titular nem pela API.
  const ownerReceivable = await receivableByDescription(ws(), 'Do titular');
  const refused = await callCallable(request, memberToken, 'receiveReceivable', {
    workspaceId: ws(), idempotencyKey: intentKey('refused'), receivableId: ownerReceivable.id,
    expectedUpdatedAt: versionOf(ownerReceivable), principalCents: 1_000, interestCents: 0,
    penaltyCents: 0, discountCents: 0, paymentDate: today(), cashAccountId: defaultCashAccountIdFor(ws()),
  });
  expect(refused.errorStatus).toBe('PERMISSION_DENIED');

  // Perda de papel com o diálogo aberto: recusado, nada gravado.
  await member.getByRole('button', { name: 'Recebíveis', exact: true }).click();
  await receivableRow(member, 'Do membro').getByRole('button', { name: /Registrar recebimento/ }).click();
  const dialog = dialogNamed(member, 'Registrar recebimento');
  await db().doc(`workspaces/${ws()}/members/${tenant.member.uid}`).update({ role: 'viewer' });
  await dialog.getByRole('button', { name: 'Registrar recebimento', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('não permite esta operação');
  expect(await movementsOfReceivable(ws(), memberReceivable)).toHaveLength(0);
  expect(await listOf(ws(), 'transactions')).toHaveLength(0);
  await member.context().close();
});

test('versão concorrente, reenvio após resposta perdida e perda de sessão não duplicam', async ({ page, request }) => {
  const token = await tokenOf(request, tenant.owner.email);
  const clientId = await createClientByApi(request, token, ws(), { name: 'Cliente Épsilon' });
  const receivableId = await createReceivableByApi(request, token, ws(), clientId, { description: 'Concorrido', amountCents: 100_000 });
  await login(page, tenant.owner.email);
  const receipts = callablePosts(page, 'receiveReceivable');
  await openClientsReceivables(page);
  const row = receivableRow(page, 'Concorrido');
  await row.getByRole('button', { name: /Registrar recebimento/ }).click();
  const dialog = await fillReceipt(page, { Principal: '300,00' });

  // Outra sessão recebe antes: a versão lida pela tela fica velha.
  await receiveByApi(request, token, ws(), receivableId, { principalCents: 50_000 });
  await dialog.getByRole('button', { name: 'Registrar recebimento', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('alterado por outra operação');
  expect(await movementsOfReceivable(ws(), receivableId)).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(row).toContainText(brl(50_000));

  // Sessão perdida: o pedido chega sem credencial e é recusado, sem gravar.
  await row.getByRole('button', { name: /Registrar recebimento/ }).click();
  await fillReceipt(page, { Principal: '100,00' });
  await page.route('**/receiveReceivable', async (route) => {
    const headers = { ...route.request().headers() };
    delete headers.authorization;
    await route.continue({ headers });
  });
  await dialog.getByRole('button', { name: 'Registrar recebimento', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Sua sessão expirou');
  await page.unroute('**/receiveReceivable');
  expect(await movementsOfReceivable(ws(), receivableId)).toHaveLength(1);

  // Resposta perdida: o servidor grava, o navegador não recebe. O reenvio do
  // mesmo conteúdo usa a mesma chave e devolve o resultado já gravado.
  let dropped = false;
  await page.route('**/receiveReceivable', async (route) => {
    if (dropped) return route.continue();
    dropped = true;
    await route.fetch();
    await route.abort('connectionreset');
  });
  await dialog.getByRole('button', { name: 'Registrar recebimento', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('não duplica');
  await expect.poll(async () => (await movementsOfReceivable(ws(), receivableId)).length).toBe(2);
  await dialog.getByRole('button', { name: 'Registrar recebimento', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page.unroute('**/receiveReceivable');
  const keys = receipts.slice(-2).map((post) => bodyOf(post).idempotencyKey);
  expect(keys[0]).toBe(keys[1]);
  expect(await movementsOfReceivable(ws(), receivableId)).toHaveLength(2);
  expect((await docOf(ws(), 'receivables', receivableId)).balanceCents).toBe(40_000);
  await expectOnlyReceivableMirrors(2);
});

test('troca de workspace: cada espaço mostra só os próprios clientes e recebíveis', async ({ page, request }) => {
  const token = await tokenOf(request, tenant.owner.email);
  const clientA = await createClientByApi(request, token, ws(), { name: 'Cliente do Espaço A' });
  await createReceivableByApi(request, token, ws(), clientA, { description: 'Recebível do Espaço A' });
  // Segundo espaço PJ, de outro titular, onde o owner do primeiro é admin.
  const otherOwner = { uid: 'e2e-p3i-owner-b', email: 'e2e-p3i-owner-b@minhas-financas.local' };
  await adminSdk().auth().createUser({ ...otherOwner, password: PASSWORD, emailVerified: true });
  const otherWs = `e2e-p3i-ws-b-${Date.now().toString(36)}`;
  await seedOwnedWorkspace({ ...otherOwner, workspaceId: otherWs, name: 'Empresa Beta E2E', type: 'PJ' });
  await seedAccountProfile(tenant.owner);
  await seedMembership({
    workspaceId: otherWs, uid: tenant.owner.uid, email: tenant.owner.email, role: 'admin',
    name: 'Empresa Beta E2E', type: 'PJ', joinedAt: new Date(Date.now() + 3_600_000),
  });
  const otherToken = await tokenOf(request, otherOwner.email);
  const clientB = await createClientByApi(request, otherToken, otherWs, { name: 'Cliente do Espaço B' });
  await createReceivableByApi(request, otherToken, otherWs, clientB, { description: 'Recebível do Espaço B' });

  await login(page, tenant.owner.email);
  await openClientsReceivables(page);
  await expect(receivableRow(page, 'Recebível do Espaço A')).toHaveCount(1);
  await expect(receivableRow(page, 'Recebível do Espaço B')).toHaveCount(0);

  await page.getByText('Olá, Usuário').click();
  await page.getByRole('button', { name: /Empresa Beta E2E/ }).click();
  await openClientsReceivables(page);
  await expect(receivableRow(page, 'Recebível do Espaço B')).toHaveCount(1);
  await expect(receivableRow(page, 'Recebível do Espaço A')).toHaveCount(0);
  await openClientsTab(page);
  await expect(clientRow(page, 'Cliente do Espaço B')).toHaveCount(1);
  await expect(clientRow(page, 'Cliente do Espaço A')).toHaveCount(0);
});
