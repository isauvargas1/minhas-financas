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

## Subfase 4.4 — Ajuste visual e travas finais para projeções de fatura

### Status

Concluída como ajuste de compatibilidade visual e proteção de operação.

### Arquivos alterados

- `src/components/TransactionsView.tsx`
- `src/App.tsx`

### Objetivo

Evitar que faturas projetadas sejam apresentadas como parcelas incompletas na lista de despesas e reforçar que projeções de fatura não podem ser excluídas como transações comuns.

### Comportamento implementado

Na tela de despesas:

- projeções de fatura passam a exibir o selo `FATURA`;
- projeções deixam de exibir `PARCELA /`;
- exclusão direta de projeções é bloqueada também no handler interno;
- faturas continuam sendo lidas de `invoice_views`;
- nenhuma fatura é gravada em `transactions`.

### Próxima subfase

`Subfase 4.5 — Validação de consistência visual e atualização controlada de cache após criação de compra`

## Subfase 4.5 — Consistência de cache e leitura de limite pelo novo domínio

### Status

Concluída como ajuste de consistência visual e cache do fluxo híbrido.

### Arquivos alterados

- `src/modules/credit-cards/persistence/readApi.ts`
- `src/modules/credit-cards/hooks.ts`
- `src/components/CreditCardsView.tsx`

### Objetivo

Garantir que, após criar uma compra no cartão pelo novo domínio, a aplicação atualize corretamente:

- projeções de fatura;
- lista de despesas compatível;
- limite usado do cartão;
- limite disponível do cartão.

### Regra aplicada

A tela de cartões passa a preferir `card_limit_snapshots` como fonte de limite usado e limite disponível.

O cálculo legado por `transactions` continua apenas como fallback para cartões antigos sem snapshot.

### Comportamento preservado

Não foram alterados:

- dashboard;
- relatórios;
- recorrentes;
- split bills;
- pagamento de fatura;
- edição visual de compra;
- fluxo legado usado como fallback.

### Próxima subfase

`Subfase 4.6 — Validação visual guiada do fluxo híbrido e checklist de homologação`

## Subfase 4.5 — Consistência de cache e leitura de limite pelo novo domínio

### Status

Concluída como ajuste de consistência visual e cache do fluxo híbrido.

### Arquivos alterados

- `src/modules/credit-cards/persistence/readApi.ts`
- `src/modules/credit-cards/hooks.ts`
- `src/components/CreditCardsView.tsx`

### Objetivo

Garantir que, após criar uma compra no cartão pelo novo domínio, a aplicação atualize corretamente:

- projeções de fatura;
- lista de despesas compatível;
- limite usado do cartão;
- limite disponível do cartão.

### Regra aplicada

A tela de cartões passa a preferir `card_limit_snapshots` como fonte de limite usado e limite disponível.

O cálculo legado por `transactions` continua apenas como fallback para cartões antigos sem snapshot.

### Comportamento preservado

Não foram alterados:

- dashboard;
- relatórios;
- recorrentes;
- split bills;
- pagamento de fatura;
- edição visual de compra;
- fluxo legado usado como fallback.

### Próxima subfase

`Subfase 4.6 — Validação visual guiada do fluxo híbrido e checklist de homologação`
## Subfase 4.6 — Validação visual guiada do fluxo híbrido e checklist de homologação

### Status

Concluída como checklist formal de homologação do fluxo híbrido.

### Objetivo

Validar que o novo domínio de cartão está integrado ao fluxo atual sem quebrar o sistema legado baseado em `transactions`.

### Escopo validado

Esta subfase valida o fluxo:

`TransactionModal → createCreditCardPurchase → novo domínio de cartão → invoice_views → tela de despesas → card_limit_snapshots → tela de cartões`

### Checklist obrigatório

#### 1. Build do frontend

Executar:

```bash
npm run build

## Subfase 4.8 — Validação do pagamento de fatura e proteção contra dupla contagem

### Status

Concluída como proteção de exibição e separação entre competência de fatura e fluxo de caixa.

### Arquivos alterados

- `src/App.tsx`
- `src/components/TransactionsView.tsx`
- `src/components/RecentTransactions.tsx`

### Objetivo

Evitar que a fatura projetada e a transação real de pagamento sejam tratadas como duas despesas equivalentes no mesmo contexto visual.

### Regra aplicada

A tela de despesas trabalha em visão de competência do cartão:

- exibe faturas projetadas vindas de `invoice_views`;
- oculta transactions de pagamento de fatura;
- bloqueia edição/exclusão de faturas projetadas.

O dashboard e transações recentes continuam trabalhando em visão de fluxo de caixa:

- exibem a transaction real do pagamento da fatura;
- o pagamento reduz o saldo/caixa;
- a fatura projetada não entra no resumo de caixa.

### Separação financeira

- Compra no cartão: consome limite.
- Fatura: representa obrigação consolidada.
- Pagamento da fatura: representa saída real de caixa.
- Projeção de fatura: não é documento real em `transactions`.

### Próxima subfase

`Subfase 4.9 — Preparação para detalhe de fatura e histórico de pagamentos`

## Subfase 4.9 — Preparação para detalhe de fatura e histórico de pagamentos

### Status

Concluída como detalhe inicial de fatura dentro da tela de cartões.

### Arquivos alterados

- `src/modules/credit-cards/persistence/readApi.ts`
- `src/modules/credit-cards/hooks.ts`
- `src/components/CreditCardsView.tsx`

### Objetivo

Permitir que o usuário veja a composição de uma fatura e o histórico de pagamentos vinculados a ela, sem usar `transactions` como fonte de verdade do cartão.

### Comportamento implementado

No detalhe do cartão:

- cada fatura possui botão `Ver detalhes`;
- os detalhes exibem itens da fatura a partir de `credit_card_installments`;
- os detalhes exibem pagamentos a partir de `credit_card_invoice_payments`;
- o painel atualiza após pagamento;
- o pagamento continua passando por `registerCreditCardInvoicePayment`.

### Separação de fontes

- Itens da fatura: `credit_card_installments`;
- Pagamentos da fatura: `credit_card_invoice_payments`;
- Saída de caixa: `transactions` com `source: "credit_card_invoice_payment"`;
- Lista de despesas: projeções de `invoice_views`.

### Próxima subfase

`Subfase 4.10 — Preparação para estorno visual de pagamento de fatura`
## Subfase 4.9.1 — Consolidação do detalhe de fatura

### Status

Concluída como ajuste final da Subfase 4.9.

### Arquivos alterados

- `src/modules/credit-cards/persistence/readApi.ts`
- `src/components/CreditCardsView.tsx`

### Ajustes aplicados

- faturas pagas passam a continuar visíveis na seção de faturas do cartão;
- detalhe da fatura deixa de acessar campos inexistentes em `CreditCardInstallment`;
- mensagem vazia da seção de faturas passa a ser neutra;
- botão de pagamento passa a exibir `Fatura paga` quando a fatura já estiver quitada.

### Próxima subfase

`Subfase 4.10 — Preparação para estorno visual de pagamento de fatura`
## Subfase 4.10 — Preparação para estorno visual de pagamento de fatura

### Status

Concluída como integração inicial controlada da UI com `reverseCreditCardInvoicePayment`.

### Arquivos alterados

- `src/modules/credit-cards/invoicePaymentsApi.ts`
- `src/modules/credit-cards/hooks.ts`
- `src/components/CreditCardsView.tsx`

### Objetivo

Permitir que o usuário estorne um pagamento de fatura pela tela de cartões, mantendo o backend como fonte da verdade.

### Comportamento implementado

No detalhe da fatura:

- pagamentos registrados aparecem no histórico;
- pagamentos com status `posted` exibem ação `Estornar`;
- pagamentos com status `reversed` ficam bloqueados;
- o estorno chama `reverseCreditCardInvoicePayment`;
- após sucesso, são invalidados caches de cartões, faturas, pagamentos, itens, projeções e transações.

### O que o backend faz ao estornar

A Cloud Function:

- marca o pagamento como `reversed`;
- atualiza a fatura;
- atualiza `invoice_views`;
- consome novamente o limite no valor estornado;
- registra ledger;
- registra evento financeiro;
- cria transação de reversão de caixa quando aplicável.

### Próxima subfase

`Subfase 4.11 — Validação do estorno e fechamento da Fase 4`
## Subfase 4.11 — Correção de indicadores após estorno de pagamento de fatura

### Status

Concluída como ajuste de leitura gerencial do dashboard.

### Arquivos alterados

- `src/modules/credit-cards/compatibility/transactionProjection.ts`
- `src/App.tsx`

### Problema corrigido

Após estornar um pagamento de fatura, o dashboard exibia:

- o pagamento original como despesa;
- o estorno como receita.

O saldo líquido ficava correto, mas os cards de Receita e Despesa ficavam inflados por lançamentos técnicos.

### Regra aplicada

Quando um pagamento de fatura possui estorno vinculado, o pagamento original e o estorno são removidos da visão gerencial de caixa usada no dashboard.

As transações continuam existindo para histórico e auditoria.

### Comportamento esperado

- pagamento de fatura sem estorno continua entrando como despesa de caixa;
- pagamento estornado deixa de inflar despesas;
- estorno deixa de inflar receitas;
- saldo permanece correto;
- transações recentes continuam exibindo os eventos para rastreabilidade.

## Subfase 4.12 — Checklist final e fechamento da Fase 4

### Status

Concluída como checklist final de estabilização da compatibilidade entre o modelo legado de `transactions` e o novo domínio oficial de cartão.

### Objetivo

Validar que a transição híbrida funciona sem quebrar o sistema existente.

### Fluxos validados

A Fase 4 passa a considerar como fluxo suportado:

1. criação de compra no cartão pelo `TransactionModal`;
2. criação de domínio oficial em `credit_card_purchases`;
3. geração de parcelas em `credit_card_installments`;
4. geração ou atualização de faturas em `credit_card_invoices`;
5. geração de projeções em `invoice_views`;
6. consumo de limite em `card_limit_ledger`;
7. atualização de limite em `card_limit_snapshots`;
8. exibição da fatura na tela de despesas;
9. bloqueio de edição/exclusão da fatura como transação comum;
10. pagamento da fatura pela tela de cartões;
11. geração de saída de caixa em `transactions`;
12. recomposição de limite após pagamento;
13. exibição do histórico de pagamentos;
14. estorno de pagamento pela tela de cartões;
15. reversão de caixa;
16. ajuste visual do dashboard para não inflar receitas/despesas após estorno.

### Critérios de aceite

A Fase 4 só é considerada aprovada quando:

- `npm run build` conclui sem erro;
- nova compra de cartão não cria parcelas legadas em `transactions`;
- compra no cartão consome limite;
- compra no cartão não reduz caixa;
- fatura aparece na tela de despesas;
- fatura é exibida como `FATURA`;
- fatura não pode ser editada como transação comum;
- fatura não pode ser excluída como transação comum;
- pagamento de fatura reduz caixa;
- pagamento de fatura recompõe limite;
- pagamento aparece no histórico da fatura;
- estorno de pagamento reverte caixa;
- estorno de pagamento consome novamente o limite;
- dashboard não infla receitas e despesas com pares de pagamento/estorno;
- transações comuns continuam funcionando;
- receitas e investimentos continuam funcionando;
- relatórios e dashboard não quebram, mesmo que ainda não estejam completamente migrados para o novo domínio.

### Modelo híbrido consolidado

Após a Fase 4, o sistema passa a operar com duas camadas:

#### Camada A — Domínio oficial de cartão

- `credit_cards`
- `credit_card_purchases`
- `credit_card_installments`
- `credit_card_invoices`
- `credit_card_invoice_payments`
- `card_limit_ledger`
- `card_limit_snapshots`
- `invoice_views`
- `financial_events`

#### Camada B — Compatibilidade com o legado

- despesas comuns continuam em `transactions`;
- pagamentos de fatura geram `transactions` reais de caixa;
- faturas aparecem na lista de despesas por projeção;
- parcelas legadas podem continuar existindo sem serem apagadas;
- componentes antigos continuam funcionando durante a transição.

### O que fica fora da Fase 4

A Fase 4 não migra completamente:

- relatórios avançados;
- dashboard analítico completo por competência;
- edição visual de compra de cartão;
- ajuste retroativo em fatura paga;
- seleção de carteira/conta no pagamento de fatura;
- página dedicada de detalhe de fatura;
- fechamento automático de faturas;
- notificações automáticas de vencimento.

Esses itens devem ser tratados nas próximas fases.

### Resultado

Fase 4 considerada tecnicamente concluída após validação manual do checklist e build sem erros.

### Próxima fase recomendada

`Fase 5 — Integração completa de UI, relatórios e experiência operacional de faturas`

