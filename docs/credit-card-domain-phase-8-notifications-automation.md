# Fase 8 — Notificações, alertas e automações

## Status

Fase 8 iniciada.

## Subfase 8.1 — Notificações operacionais a partir de eventos do domínio de cartão

### Status

Concluída como primeira integração entre `financial_events` e `notifications`.

### Arquivos criados

- `functions/src/creditCards/domainNotifications.ts`
- `docs/credit-card-domain-phase-8-notifications-automation.md`

### Arquivos alterados

- `functions/src/creditCards/createPurchase.ts`
- `functions/src/creditCards/closeInvoice.ts`
- `functions/src/creditCards/registerInvoicePayment.ts`
- `functions/src/creditCards/reverseInvoicePayment.ts`
- `functions/src/creditCards/rebuildInvoices.ts`
- `functions/src/creditCards/recalculateCardLimit.ts`
- `src/types.ts`
- `src/components/Header.tsx`

### Eventos cobertos

- `purchase_created`
- `invoice_closed`
- `invoice_payment_posted`
- `invoice_payment_reversed`
- `reconciliation_warning`

### Alertas cobertos

- compra lançada;
- cartão próximo do limite;
- cartão em utilização crítica;
- fechamento de fatura;
- pagamento parcial;
- pagamento total;
- estorno;
- divergência de reconciliação.

### Regra aplicada

Toda notificação criada nesta subfase nasce de um evento real do domínio financeiro.

As notificações gravadas em `notifications` carregam referência para:

- `workspaceId`;
- `domainEventId`;
- `domainEventType`;
- `cardId`;
- `invoiceId`, quando aplicável;
- `purchaseId`, quando aplicável;
- `paymentId`, quando aplicável.

### O que fica para subfases futuras

- fatura próxima do vencimento;
- fatura vencida;
- falha de processamento;
- compra bloqueada por limite insuficiente;
- automações agendadas.

## Subfase 8.2 — Automação de vencimento de faturas

### Status

Concluída como automação agendada inicial de vencimento.

### Arquivo criado

- `functions/src/crons/creditCardInvoices.ts`

### Arquivos alterados

- `functions/src/index.ts`
- `functions/src/creditCards/domainNotifications.ts`
- `src/modules/credit-cards/domain/types.ts`

### Objetivo

Gerar eventos reais de domínio e notificações para faturas próximas do vencimento, faturas vencidas e falhas de processamento da automação.

### Eventos implementados

- `invoice_due_soon`
- `invoice_overdue`
- `processing_failure`

### Regras aplicadas

- a automação roda diariamente às 07:00 no fuso `America/Sao_Paulo`;
- faturas com vencimento em até 3 dias geram evento `invoice_due_soon`;
- faturas vencidas com saldo em aberto geram evento `invoice_overdue`;
- faturas vencidas têm status atualizado para `overdue`;
- `invoice_views` também é atualizado para `overdue`;
- falhas por fatura geram evento `processing_failure`;
- notificações continuam nascendo a partir de eventos de domínio.

### Critério de aceite

A automação é considerada válida quando:

- fatura próxima do vencimento cria `financial_event`;
- fatura próxima do vencimento cria `notification`;
- fatura vencida muda para `overdue`;
- fatura vencida atualiza `invoice_views`;
- fatura vencida cria `financial_event`;
- fatura vencida cria `notification`;
- falha de processamento cria evento e notificação de erro.

## Subfase 8.3 — Notificação de compra bloqueada por limite insuficiente

### Status

Concluída como evento operacional de tentativa de compra acima do limite residual.

### Arquivos criados

- `functions/src/creditCards/purchaseFailureEvents.ts`

### Arquivos alterados

- `functions/src/creditCards/domainNotifications.ts`
- `functions/src/creditCards/callables.ts`
- `src/modules/credit-cards/domain/types.ts`

### Objetivo

Registrar evento e notificação quando uma compra no cartão for bloqueada por limite insuficiente.

### Regra aplicada

A compra bloqueada não cria:

- `credit_card_purchases`;
- `credit_card_installments`;
- `credit_card_invoices`;
- `card_limit_ledger`;
- alteração de limite.

Mesmo assim, a tentativa gera:

- `financial_event` com `eventType: purchase_limit_exceeded`;
- `notification` com `source: credit_card_domain_event`.

### Dados rastreados

O evento registra:

- `workspaceId`;
- `cardId`;
- `idempotencyKey`;
- `correlationId`;
- descrição da compra;
- data da compra;
- quantidade de parcelas;
- valor solicitado;
- limite disponível;
- valor faltante de limite;
- usuário responsável.

### Critério de aceite

Ao tentar lançar uma compra acima do limite disponível:

- a operação continua sendo bloqueada;
- a UI recebe erro de limite insuficiente;
- nenhum documento financeiro de compra é criado;
- nasce `financial_event`;
- nasce `notification`;
- a notificação aparece no sino da aplicação.

## Subfase 8.4 — Checklist final de notificações e automações do domínio de cartão

### Status

Concluída como checklist final de validação da Fase 8.

### Objetivo

Validar que o módulo de notificações passou a operar sobre eventos reais do domínio financeiro de cartão.

### Eventos cobertos na Fase 8

- `purchase_created`
- `purchase_limit_exceeded`
- `invoice_closed`
- `invoice_due_soon`
- `invoice_overdue`
- `invoice_payment_posted`
- `invoice_payment_reversed`
- `reconciliation_warning`
- `processing_failure`

### Alertas e notificações cobertos

- compra lançada;
- compra bloqueada por limite insuficiente;
- cartão próximo do limite;
- cartão em utilização crítica;
- fechamento de fatura;
- fatura próxima do vencimento;
- fatura vencida;
- pagamento parcial;
- pagamento total;
- estorno;
- divergência de reconciliação;
- falha de processamento.

### Checklist obrigatório

#### 1. Compra lançada

Critérios de aceite:

- criar uma compra válida no cartão;
- nasce `financial_event` com `eventType: purchase_created`;
- nasce `notification` com `source: credit_card_domain_event`;
- a notificação contém `workspaceId`;
- a notificação contém `cardId`;
- a notificação contém `purchaseId`;
- a notificação aparece no sino da aplicação.

#### 2. Compra bloqueada por limite insuficiente

Critérios de aceite:

- tentar criar compra acima do limite disponível;
- a operação é bloqueada;
- não nasce `credit_card_purchase`;
- não nasce `credit_card_installment`;
- não nasce alteração de fatura;
- nasce `financial_event` com `eventType: purchase_limit_exceeded`;
- nasce `notification`;
- a notificação contém `workspaceId` e `cardId`;
- a notificação informa limite disponível, valor solicitado ou valor faltante quando esses dados estiverem disponíveis.

#### 3. Cartão próximo do limite

Critérios de aceite:

- criar compra que deixe o cartão com utilização igual ou maior que 75%;
- nasce notificação de cartão próximo do limite;
- a notificação referencia `workspaceId` e `cardId`;
- a notificação aparece no sino.

#### 4. Cartão em utilização crítica

Critérios de aceite:

- criar compra que deixe o cartão com utilização igual ou maior que 90%;
- nasce notificação de utilização crítica;
- a notificação referencia `workspaceId` e `cardId`;
- a notificação aparece no sino.

#### 5. Fechamento de fatura

Critérios de aceite:

- fechar uma fatura;
- nasce `financial_event` com `eventType: invoice_closed`;
- nasce `notification`;
- a notificação contém `workspaceId`, `cardId` e `invoiceId`.

#### 6. Fatura próxima do vencimento

Critérios de aceite:

- existir fatura com saldo em aberto e vencimento em até 3 dias;
- automação cria `financial_event` com `eventType: invoice_due_soon`;
- automação cria `notification`;
- a notificação contém `workspaceId`, `cardId` e `invoiceId`;
- a automação não duplica evento para a mesma fatura/dia.

#### 7. Fatura vencida

Critérios de aceite:

- existir fatura com saldo em aberto e `dueDate` passada;
- automação altera `credit_card_invoices.status` para `overdue`;
- automação atualiza `invoice_views.status` para `overdue`;
- nasce `financial_event` com `eventType: invoice_overdue`;
- nasce `notification`;
- a notificação contém `workspaceId`, `cardId` e `invoiceId`.

#### 8. Pagamento parcial

Critérios de aceite:

- registrar pagamento menor que o saldo da fatura;
- fatura fica `partial_paid`;
- nasce `financial_event` com `eventType: invoice_payment_posted`;
- nasce notificação de pagamento parcial;
- notificação contém `workspaceId`, `cardId`, `invoiceId` e `paymentId`.

#### 9. Pagamento total

Critérios de aceite:

- pagar o saldo total da fatura;
- fatura fica `paid`;
- nasce `financial_event` com `eventType: invoice_payment_posted`;
- nasce notificação de fatura paga;
- notificação contém `workspaceId`, `cardId`, `invoiceId` e `paymentId`.

#### 10. Estorno

Critérios de aceite:

- estornar pagamento de fatura;
- pagamento fica `reversed`;
- nasce `financial_event` com `eventType: invoice_payment_reversed`;
- nasce `notification`;
- notificação contém `workspaceId`, `cardId`, `invoiceId` e `paymentId`.

#### 11. Divergência de reconciliação

Critérios de aceite:

- executar `rebuildCardInvoicesForCard` ou `recalculateCardLimit`;
- nasce `financial_event` com `eventType: reconciliation_warning`;
- nasce `notification`;
- notificação contém `workspaceId` e `cardId`.

#### 12. Falha de processamento

Critérios de aceite:

- uma falha controlada na automação gera `financial_event` com `eventType: processing_failure`;
- nasce `notification` do tipo erro;
- notificação contém `workspaceId`, `cardId` e `invoiceId` quando disponíveis.

### Critério final de aceite da Fase 8

A Fase 8 é considerada aprovada quando:

- `npm run build` passa na pasta `functions`;
- `npm run build` passa na raiz;
- as Functions alteradas são publicadas;
- a automação agendada é publicada;
- todos os eventos acima geram `financial_events`;
- todos os eventos acima geram `notifications`;
- as notificações aparecem no sino da aplicação;
- nenhuma notificação crítica nasce diretamente da UI;
- todas as notificações relevantes carregam `workspaceId`, `cardId`, `invoiceId`, `purchaseId` ou `paymentId` quando aplicável.

### Resultado

Fase 8 considerada tecnicamente concluída após build, deploy e validação manual do checklist.