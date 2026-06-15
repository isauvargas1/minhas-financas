# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: credit-card-flow.spec.ts >> Fluxos E2E do domínio de cartão >> owner executa compra, pagamento, estorno, cancelamento e valida relatórios sem saída imediata
- Location: e2e/credit-card-flow.spec.ts:471:3

# Error details

```
Test timeout of 180000ms exceeded.
```

```
Error: locator.click: Test timeout of 180000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: /Pagar total/i }).first()

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]: F
      - generic [ref=e7]: Finanças
    - navigation [ref=e8]:
      - list [ref=e9]:
        - listitem [ref=e10]:
          - link "Dashboard" [ref=e11] [cursor=pointer]:
            - /url: "#"
            - img [ref=e13]
            - generic [ref=e18]: Dashboard
        - listitem [ref=e19]:
          - link "Empréstimos" [ref=e20] [cursor=pointer]:
            - /url: "#"
            - img [ref=e22]
            - generic [ref=e25]: Empréstimos
        - listitem [ref=e26]:
          - link "Cartões de Crédito" [ref=e27] [cursor=pointer]:
            - /url: "#"
            - img [ref=e29]
            - generic [ref=e31]: Cartões de Crédito
        - listitem [ref=e32]:
          - link "Metas" [ref=e33] [cursor=pointer]:
            - /url: "#"
            - img [ref=e35]
            - generic [ref=e39]: Metas
        - listitem [ref=e40]:
          - link "Dividir Gastos" [ref=e41] [cursor=pointer]:
            - /url: "#"
            - img [ref=e43]
            - generic [ref=e48]: Dividir Gastos
        - listitem [ref=e49]:
          - link "Assinaturas" [ref=e50] [cursor=pointer]:
            - /url: "#"
            - img [ref=e52]
            - generic [ref=e57]: Assinaturas
        - listitem [ref=e58]:
          - link "Relatórios" [ref=e59] [cursor=pointer]:
            - /url: "#"
            - img [ref=e61]
            - generic [ref=e64]: Relatórios
        - listitem [ref=e65]:
          - link "Meu Plano" [ref=e66] [cursor=pointer]:
            - /url: "#"
            - img [ref=e68]
            - generic [ref=e71]: Meu Plano
        - listitem [ref=e72]:
          - link "Configurações" [ref=e73] [cursor=pointer]:
            - /url: "#"
            - img [ref=e75]
            - generic [ref=e78]: Configurações
    - button "Sair" [ref=e80] [cursor=pointer]:
      - img
      - generic [ref=e83]: Sair
  - main [ref=e84]:
    - generic [ref=e86]:
      - heading "Minhas Finanças" [level=1] [ref=e89]
      - generic [ref=e90]:
        - button "Mês anterior" [ref=e91] [cursor=pointer]:
          - img [ref=e92]
        - generic [ref=e95]:
          - button "Selecionar Mês e Ano" [ref=e96] [cursor=pointer]:
            - generic [ref=e97]: Junho de 2026
            - img [ref=e98]
          - button "Hoje" [ref=e101] [cursor=pointer]
        - button "Próximo mês" [ref=e102] [cursor=pointer]:
          - img [ref=e103]
      - generic [ref=e105]:
        - button "3" [ref=e107] [cursor=pointer]:
          - img [ref=e108]
          - generic [ref=e111]: "3"
        - button [ref=e113] [cursor=pointer]:
          - img [ref=e114]
        - button [ref=e118] [cursor=pointer]:
          - img [ref=e119]
        - generic [ref=e121]:
          - generic [ref=e122] [cursor=pointer]:
            - generic [ref=e123]: Olá, Usuário
            - generic [ref=e124]: PESSOAL
          - generic [ref=e125] [cursor=pointer]: U
    - generic [ref=e126]:
      - generic [ref=e127]:
        - generic [ref=e128]:
          - heading "Meus Cartões" [level=2] [ref=e129]
          - paragraph [ref=e130]: Gerencie seus limites e faturas
        - generic [ref=e131]:
          - generic [ref=e132]:
            - textbox "Buscar..." [ref=e133]
            - img [ref=e135]
          - generic [ref=e138]:
            - button [ref=e139] [cursor=pointer]:
              - img [ref=e140]
            - button [ref=e145] [cursor=pointer]:
              - img [ref=e146]
          - button "Novo Cartão" [ref=e147] [cursor=pointer]:
            - img [ref=e148]
            - text: Novo Cartão
      - generic [ref=e152] [cursor=pointer]:
        - generic [ref=e153]:
          - generic [ref=e154]:
            - generic [ref=e155]: Cartão Fluxo E2E
            - img [ref=e157]
          - generic [ref=e161]:
            - img [ref=e165]
            - generic [ref=e169]: "**** **** **** 1234"
            - generic [ref=e170]:
              - generic [ref=e171]: Usuario
              - generic [ref=e172]: Visa
        - generic [ref=e175]:
          - generic [ref=e176]:
            - generic [ref=e177]:
              - generic [ref=e178]: Limite Total
              - generic [ref=e179]: R$ 5.000,00
            - generic [ref=e180]:
              - generic [ref=e181]: Utilizado
              - generic [ref=e182]: R$ 400,00
            - generic [ref=e183]:
              - generic [ref=e184]: Disponível
              - generic [ref=e185]: R$ 4.600,00
          - generic [ref=e188]:
            - generic [ref=e189]:
              - generic [ref=e190]: Fechamento
              - generic [ref=e191]: Dia 1
            - generic [ref=e192]:
              - generic [ref=e193]: Melhor Dia
              - generic [ref=e194]: Dia 2
      - generic [ref=e196]:
        - generic [ref=e197]:
          - heading "Detalhes do Cartão" [level=3] [ref=e198]
          - button "Fechar detalhes do cartão" [ref=e199] [cursor=pointer]:
            - img [ref=e200]
        - generic [ref=e205] [cursor=pointer]:
          - generic [ref=e206]:
            - generic [ref=e207]:
              - generic [ref=e208]: Cartão Fluxo E2E
              - img [ref=e210]
            - generic [ref=e214]:
              - img [ref=e218]
              - generic [ref=e222]: "**** **** **** 1234"
              - generic [ref=e223]:
                - generic [ref=e224]: Usuario
                - generic [ref=e225]: Visa
          - generic [ref=e228]:
            - generic [ref=e229]:
              - generic [ref=e230]:
                - generic [ref=e231]: Limite Total
                - generic [ref=e232]: R$ 5.000,00
              - generic [ref=e233]:
                - generic [ref=e234]: Utilizado
                - generic [ref=e235]: R$ 400,00
              - generic [ref=e236]:
                - generic [ref=e237]: Disponível
                - generic [ref=e238]: R$ 4.600,00
            - generic [ref=e241]:
              - generic [ref=e242]:
                - generic [ref=e243]: Fechamento
                - generic [ref=e244]: Dia 1
              - generic [ref=e245]:
                - generic [ref=e246]: Melhor Dia
                - generic [ref=e247]: Dia 2
        - generic [ref=e248]:
          - generic [ref=e249]:
            - generic [ref=e251]: Ativo
            - generic [ref=e252]:
              - paragraph [ref=e253]: Fechamento
              - paragraph [ref=e254]: Dia 1
            - generic [ref=e255]:
              - paragraph [ref=e256]: Vencimento
              - paragraph [ref=e257]: Dia 10
          - generic [ref=e258]:
            - heading "Faturas" [level=4] [ref=e259]:
              - img [ref=e260]
              - text: Faturas
            - generic [ref=e262]: Nenhuma fatura encontrada para este cartão.
          - generic [ref=e263]:
            - heading "Administração" [level=4] [ref=e264]
            - generic [ref=e265]:
              - button "Recalcular limite" [ref=e266] [cursor=pointer]
              - button "Rebuild de faturas" [ref=e267] [cursor=pointer]
            - group [ref=e268]:
              - generic "Audit logs recentes" [ref=e269] [cursor=pointer]
            - group [ref=e270]:
              - generic "Métricas operacionais" [ref=e271] [cursor=pointer]
          - generic [ref=e272]:
            - button "Editar" [ref=e273] [cursor=pointer]:
              - img [ref=e274]
              - text: Editar
            - button "Excluir" [ref=e277] [cursor=pointer]:
              - img [ref=e278]
              - text: Excluir
```

# Test source

```ts
  439 | };
  440 | 
  441 | const openInvoiceDetailsByIndex = async (page: Page, index: number): Promise<void> => {
  442 |   await page.getByRole('button', { name: /Ver detalhes da fatura/i }).nth(index).click();
  443 | 
  444 |   await expect(page.getByText('Detalhe da fatura')).toBeVisible({
  445 |     timeout: 20_000,
  446 |   });
  447 | };
  448 | 
  449 | const closeInvoiceDetails = async (page: Page): Promise<void> => {
  450 |   await page.getByLabel('Fechar detalhe da fatura').click();
  451 | 
  452 |   await expect(page.getByText('Detalhe da fatura')).toHaveCount(0, {
  453 |     timeout: 20_000,
  454 |   });
  455 | };
  456 | 
  457 | const closeCardDetails = async (page: Page): Promise<void> => {
  458 |   await page.getByLabel('Fechar detalhes do cartão').click();
  459 | 
  460 |   await expect(page.getByText('Detalhes do Cartão')).toHaveCount(0, {
  461 |     timeout: 20_000,
  462 |   });
  463 | };
  464 | 
  465 | test.describe('Fluxos E2E do domínio de cartão', () => {
  466 |   test.beforeEach(async () => {
  467 |     await resetEmulatorData();
  468 |     await seedWorkspace();
  469 |   });
  470 | 
  471 |   test('owner executa compra, pagamento, estorno, cancelamento e valida relatórios sem saída imediata', async ({ page }) => {
  472 |     test.setTimeout(180_000);
  473 | 
  474 |     await loginAs(page, OWNER_EMAIL);
  475 | 
  476 |     const card = await createCardThroughUi(page, 'Cartão Fluxo E2E');
  477 | 
  478 |     await createCreditCardPurchaseThroughUi(page, {
  479 |       cardId: card.id,
  480 |       description: 'Compra cancelável E2E',
  481 |       amount: '50',
  482 |       installments: '1',
  483 |     });
  484 | 
  485 |     await openCardDetails(page, card.name);
  486 |     await openInvoiceDetailsByIndex(page, 0);
  487 | 
  488 |     page.once('dialog', async (dialog) => {
  489 |       await dialog.accept('Cancelamento E2E');
  490 |     });
  491 | 
  492 |     await page.getByRole('button', { name: /Cancelar compra/i }).first().click();
  493 | 
  494 |     await waitUntil(
  495 |       () =>
  496 |         findWorkspaceCollectionDoc<{ description?: string; status?: string }>(
  497 |           'credit_card_purchases',
  498 |           (data) => data.description === 'Compra cancelável E2E' && data.status === 'cancelled'
  499 |         ),
  500 |       'Cancelamento de compra não foi refletido no domínio.'
  501 |     );
  502 | 
  503 |     await closeInvoiceDetails(page);
  504 |     await closeCardDetails(page);
  505 | 
  506 |     await createCreditCardPurchaseThroughUi(page, {
  507 |       cardId: card.id,
  508 |       description: 'Compra à vista E2E',
  509 |       amount: '100',
  510 |       installments: '1',
  511 |     });
  512 | 
  513 |     await createCreditCardPurchaseThroughUi(page, {
  514 |       cardId: card.id,
  515 |       description: 'Compra parcelada E2E',
  516 |       amount: '300',
  517 |       installments: '3',
  518 |     });
  519 | 
  520 |     await expect(
  521 |       page.getByRole('button', { name: /Despesas\s+R\$\s*0,00/i })
  522 |     ).toBeVisible({
  523 |       timeout: 20_000,
  524 |     });
  525 | 
  526 |     await navigateBySidebar(page, /Relatórios/i);
  527 | 
  528 |     await expect(page.getByText(/Indicadores de Cartão de Crédito/i)).toBeVisible({
  529 |       timeout: 30_000,
  530 |     });
  531 | 
  532 |     await expect(page.getByText(card.name).first()).toBeVisible({
  533 |       timeout: 30_000,
  534 |     });
  535 | 
  536 |     await openCardDetails(page, card.name);
  537 |     await expect(page.getByText(/Fatura/i).first()).toBeVisible();
  538 | 
> 539 |     await page.getByRole('button', { name: /Pagar total/i }).first().click();
      |                                                                      ^ Error: locator.click: Test timeout of 180000ms exceeded.
  540 |     await page.getByRole('button', { name: /Confirmar pagamento/i }).click();
  541 | 
  542 |     await waitUntil(
  543 |       () =>
  544 |         findWorkspaceCollectionDoc<{ status?: string; paidAmount?: number }>(
  545 |           'credit_card_invoices',
  546 |           (data) => data.status === 'paid' && Number(data.paidAmount || 0) > 0
  547 |         ),
  548 |       'Pagamento total não marcou a fatura como paga.'
  549 |     );
  550 | 
  551 |     await openInvoiceDetailsByIndex(page, 1);
  552 | 
  553 |     await page.getByRole('button', { name: /Pagamento parcial/i }).click();
  554 | 
  555 |     const paymentModal = page.getByText('Pagamento de fatura').locator('xpath=ancestor::div[contains(@class, "rounded-2xl")]');
  556 | 
  557 |     await paymentModal.locator('input[type="number"]').fill('40');
  558 |     await paymentModal.getByRole('button', { name: /Confirmar pagamento/i }).click();
  559 | 
  560 |     await waitUntil(
  561 |       () =>
  562 |         findWorkspaceCollectionDoc<{ status?: string; paidAmount?: number; remainingAmount?: number }>(
  563 |           'credit_card_invoices',
  564 |           (data) =>
  565 |             data.status === 'partial_paid' &&
  566 |             Number(data.paidAmount || 0) === 40 &&
  567 |             Number(data.remainingAmount || 0) > 0
  568 |         ),
  569 |       'Pagamento parcial não deixou a fatura como partial_paid.'
  570 |     );
  571 | 
  572 |     await expect(page.getByRole('button', { name: /Estornar/i })).toBeVisible({
  573 |       timeout: 30_000,
  574 |     });
  575 | 
  576 |     page.once('dialog', async (dialog) => {
  577 |       await dialog.accept();
  578 |     });
  579 | 
  580 |     await page.getByRole('button', { name: /Estornar/i }).click();
  581 | 
  582 |     await waitUntil(
  583 |       () =>
  584 |         findWorkspaceCollectionDoc<{ status?: string }>(
  585 |           'credit_card_invoice_payments',
  586 |           (data) => data.status === 'reversed'
  587 |         ),
  588 |       'Estorno não atualizou o pagamento para reversed.'
  589 |     );
  590 |   });
  591 | 
  592 |   test('member não visualiza ações administrativas do domínio de cartão', async ({ page }) => {
  593 |     await seedPermissionCard();
  594 | 
  595 |     await loginAs(page, MEMBER_EMAIL);
  596 | 
  597 |     await openCardDetails(page, CARD_PERMISSION_NAME);
  598 | 
  599 |     await expect(page.getByText('Administração')).toHaveCount(0);
  600 |     await expect(page.getByRole('button', { name: /Recalcular limite/i })).toHaveCount(0);
  601 |     await expect(page.getByRole('button', { name: /Rebuild de faturas/i })).toHaveCount(0);
  602 |   });
  603 | 
  604 |   test('admin visualiza ações administrativas permitidas do domínio de cartão', async ({ page }) => {
  605 |     await seedPermissionCard();
  606 | 
  607 |     await loginAs(page, ADMIN_EMAIL);
  608 | 
  609 |     await openCardDetails(page, CARD_PERMISSION_NAME);
  610 | 
  611 |     await expect(page.getByText('Administração')).toBeVisible({
  612 |       timeout: 20_000,
  613 |     });
  614 |     await expect(page.getByRole('button', { name: /Recalcular limite/i })).toBeVisible();
  615 |     await expect(page.getByRole('button', { name: /Rebuild de faturas/i })).toBeVisible();
  616 |   });
  617 | });
```