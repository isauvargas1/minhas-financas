# Fase 4 — Estratégia de compatibilidade com o modelo atual

## Status

Fase 4 iniciada.

## Subfase 4.1 — Camada de projeção compatível entre faturas e Transaction

### Status

Concluída como fundação de compatibilidade.

### Objetivo

Criar uma camada híbrida para permitir que o restante do sistema continue trabalhando com `Transaction`, enquanto o domínio oficial de cartão passa a expor faturas por meio de projeções compatíveis.

### Decisão principal

Faturas de cartão não serão gravadas como documentos reais na coleção `transactions`.

A compatibilidade será feita em leitura, a partir de `invoice_views`.

### Arquivos criados

- `src/modules/credit-cards/compatibility/transactionProjection.ts`
- `src/modules/credit-cards/compatibility/hooks.ts`
- `src/modules/credit-cards/compatibility/index.ts`

### Arquivos alterados

- `src/types.ts`
- `src/modules/credit-cards/index.ts`
- `src/modules/credit-cards/persistence/readApi.ts`

### Modelo híbrido

A camada de compatibilidade passa a permitir:

- manter despesas comuns em `transactions`;
- manter compras de cartão no novo domínio;
- converter `invoice_views` em objetos compatíveis com `Transaction`;
- ocultar parcelas legadas de cartão quando a tela estiver pronta para usar faturas;
- ocultar transações de pagamento de fatura em listas onde elas poderiam causar dupla contagem.

### O que ainda não foi alterado

Esta subfase ainda não altera:

- `App.tsx`
- `TransactionsView.tsx`
- `RecentTransactions.tsx`
- `ReportsView`
- `TransactionModal.tsx`
- fluxo legado de criação de parcelado

### Próxima subfase

`Subfase 4.2 — Integração controlada da lista de despesas com projeções de fatura`

Essa subfase deve ligar a camada compatível na tela principal de despesas, com opção reversível e sem quebrar componentes antigos.

## Subfase 4.2 — Integração controlada da lista de despesas com projeções de fatura

### Status

Concluída como integração visual controlada da lista de despesas.

### Arquivos alterados

- `src/App.tsx`
- `src/components/TransactionsView.tsx`
- `src/modules/credit-cards/persistence/readApi.ts`

### Objetivo

Fazer a tela de despesas exibir faturas de cartão a partir de `invoice_views`, sem gravar faturas como documentos reais em `transactions`.

### Regra aplicada

A integração foi limitada à tela de despesas.

Continuam usando `transactions` original:

- dashboard;
- relatórios;
- metas;
- tela de cartões;
- widgets;
- recorrentes;
- divisão de contas;
- modal de transação.

### Comportamento implementado

Na tela de despesas:

- despesas comuns continuam vindo de `transactions`;
- faturas de cartão vêm de `invoice_views`;
- parcelas legadas de cartão são ocultadas da lista compatível;
- transações de pagamento de fatura são ocultadas da lista compatível;
- faturas projetadas não podem ser editadas como transação comum;
- faturas projetadas não podem ser excluídas como transação comum;
- faturas projetadas não contam como transações reais para limite do plano.

### Reversibilidade

A mudança é reversível.

Para voltar ao comportamento anterior, basta fazer `TransactionsView` receber novamente `currentMonthTransactions` no bloco da tela de despesas em `src/App.tsx`.

Nenhum dado oficial é perdido, porque as projeções não são persistidas em `transactions`.

## Próxima subfase

`Subfase 4.3 — Desvio controlado da criação de compras de cartão para a Cloud Function createCreditCardPurchase`

Essa subfase deve impedir que novas compras de cartão continuem nascendo como `Transaction.type === "parcelado"` quando houver cartão selecionado.

## Subfase 4.3 — Desvio controlado da criação de compras de cartão para createCreditCardPurchase

### Status

Concluída como integração inicial do modal com o novo domínio oficial de cartão.

### Arquivos criados

- `src/modules/credit-cards/purchasesApi.ts`

### Arquivos alterados

- `src/modules/credit-cards/hooks.ts`
- `src/types.ts`
- `src/App.tsx`
- `src/components/TransactionModal.tsx`

### Objetivo

Impedir que novas compras de cartão continuem nascendo como múltiplas transações `parcelado` quando a Cloud Function `createCreditCardPurchase` estiver disponível.

### Regra aplicada

O fluxo de criação de `parcelado` passa a priorizar o novo domínio:

1. se `onAddCreditCardPurchase` existir, o modal chama `createCreditCardPurchase`;
2. se não existir, o modal mantém o fallback legado com `onAddTransactions`.

### Comportamento preservado

O legado não foi removido.

Isso mantém a transição reversível em homologação e evita quebra em fluxos ainda não migrados, como recorrentes e divisão de contas.

### O que muda

Novas compras manuais de cartão passam a criar:

- `credit_card_purchases`;
- `credit_card_installments`;
- `credit_card_invoices`;
- `card_limit_ledger`;
- `card_limit_snapshots`;
- `invoice_views`;
- `financial_events`.

### O que não muda ainda

Ainda não foram alterados:

- relatórios;
- dashboard;
- recorrentes;
- split bills;
- edição visual de compra de cartão;
- pagamento de fatura pela UI;
- tela dedicada de faturas.

### Próxima subfase

`Subfase 4.4 — Bloqueio de edição/exclusão legada para novas projeções e validação visual do fluxo híbrido`