# Fase 1 — Redesenho do domínio financeiro de cartão

## Status

Fase 1 concluída como modelagem inicial do novo domínio financeiro de cartão.

Esta fase não altera comportamento de UI, Firestore, relatórios, Cloud Functions ou regras de segurança.

## Decisão principal

O sistema passará a tratar cartão de crédito como domínio financeiro próprio, separado de `transactions`.

O modelo legado `Transaction.type === 'parcelado'` ainda existe no código, mas não será mais o destino final da evolução.

## Contexto do banco de dados

O banco de dados está vazio no momento desta fase.

Por isso:

- não há migração obrigatória de dados legados reais;
- não há necessidade imediata de rotina pesada de reconciliação histórica;
- a compatibilidade com legado permanece necessária por causa do código atual;
- o foco passa a ser impedir que novos lançamentos sejam criados no modelo antigo quando o novo domínio entrar em operação.

## Entidades do novo domínio

### CreditCard

Representa o cartão como ativo financeiro.

Campos planejados:

- `id`
- `workspaceId`
- `name`
- `brand`
- `status`
- `limitTotal`
- `limitUsed`
- `limitAvailable`
- `closingDay`
- `dueDay`
- `bestDay`
- `billingCycleStatus`
- metadados visuais e organizacionais

### CreditCardPurchase

Representa a compra original feita no cartão.

Responsabilidades:

- registrar o evento de consumo de crédito;
- guardar valor total;
- guardar quantidade de parcelas;
- guardar origem da compra;
- vincular usuário criador;
- preservar status operacional.

### CreditCardInstallment

Representa cada parcela derivada de uma compra.

Responsabilidades:

- guardar número da parcela;
- guardar competência;
- guardar valor;
- vincular à compra;
- vincular à fatura;
- representar obrigação mensal.

### CreditCardInvoice

Representa a fatura de um ciclo do cartão.

Responsabilidades:

- consolidar parcelas de uma competência;
- controlar valor total;
- controlar valor pago;
- controlar saldo restante;
- controlar status financeiro.

### CreditCardInvoicePayment

Representa pagamento total ou parcial da fatura.

Responsabilidades:

- registrar saída de caixa;
- registrar conta/carteira usada;
- recompor limite;
- permitir estorno controlado;
- carregar chave de idempotência.

### CardLimitLedger

Representa o livro-razão de limite.

Responsabilidades:

- registrar consumo de limite;
- registrar recomposição de limite;
- preservar saldo após movimento;
- permitir auditoria e reconstrução.

### CardEventLog

Representa eventos do domínio financeiro de cartão.

Responsabilidades:

- registrar criação;
- edição;
- cancelamento;
- fechamento de fatura;
- pagamento;
- estorno;
- migração;
- divergência de reconciliação.

## Arquivos criados na Fase 1

### Tipos do domínio

`src/modules/credit-cards/domain/types.ts`

Define:

- `CreditCardPurchase`
- `CreditCardInstallment`
- `CreditCardInvoice`
- `CreditCardInvoicePayment`
- `CardLimitLedger`
- `CardEventLog`
- projeções de leitura
- snapshots de limite

### Invariantes

`src/modules/credit-cards/domain/invariants.ts`

Define regras como:

- dinheiro precisa ser válido;
- competência deve usar `YYYY-MM`;
- soma das parcelas deve fechar com total da compra;
- saldo da fatura deve ser igual a total menos pago;
- pagamento precisa de idempotência;
- limite disponível precisa bater com total menos usado.

### Contratos de casos de uso

`src/modules/credit-cards/domain/use-cases.ts`

Define contratos para:

- criar compra;
- editar compra;
- cancelar compra;
- reconstruir parcelas;
- anexar parcelas a faturas;
- fechar fatura;
- reabrir fatura;
- registrar pagamento;
- estornar pagamento;
- recalcular limite;
- reconstruir faturas;
- migrar legado, quando aplicável.

### Cálculos puros

`src/modules/credit-cards/domain/calculations.ts`

Define funções para:

- calcular primeira competência;
- calcular fechamento;
- calcular vencimento;
- distribuir parcelas;
- gerar parcelas;
- agrupar parcelas por competência;
- montar faturas;
- recalcular faturas;
- calcular impacto no limite;
- reconstruir snapshot de limite pelo ledger.

### Compatibilidade

`src/modules/credit-cards/domain/compatibility.ts`

Define política para convivência com o modelo atual baseado em `transactions`.

Como o banco está vazio, a estratégia atual é:

`empty_database_no_data_migration`

Isso significa:

- não há migração obrigatória antes do rollout;
- a compatibilidade existe para proteger a transição de código;
- o foco é impedir criação de novos dados no modelo antigo depois que o novo domínio estiver pronto.

## Diferenças financeiras explícitas

| Conceito | Representação no novo domínio |
|---|---|
| Consumo de limite | `CardLimitLedger` com `direction: consume` |
| Obrigação futura | `CreditCardInstallment` |
| Consolidação mensal | `CreditCardInvoice` |
| Saída de caixa | `CreditCardInvoicePayment` |
| Recomposição de limite | `CardLimitLedger` com `direction: restore` |

## Regra contábil oficial

Compra no cartão:

- consome limite;
- não baixa caixa;
- gera compra;
- gera parcela;
- entra em fatura.

Fechamento de fatura:

- consolida obrigação;
- não baixa caixa.

Pagamento da fatura:

- baixa caixa;
- reduz saldo da fatura;
- recompõe limite no valor pago.

Pagamento parcial:

- baixa caixa parcialmente;
- recompõe limite apenas no valor pago;
- mantém fatura aberta ou parcialmente paga.

Estorno:

- precisa gerar evento formal;
- precisa preservar histórico;
- não deve depender de hard delete.

## Decisão sobre legado

Como não há dados no banco:

- não será implementada migração pesada agora;
- o caso de uso de migração permanece como contrato futuro;
- a política de compatibilidade permanece ativa;
- o novo domínio poderá ser adotado como fonte oficial sem reconciliação histórica inicial.

## Arquivos que ainda não devem ser alterados

Enquanto a Fase 2 não definir persistência, não alterar comportamento financeiro em:

- `src/components/TransactionModal.tsx`
- `src/components/CreditCardsView.tsx`
- `src/components/TransactionsView.tsx`
- `src/components/RecentTransactions.tsx`
- `src/App.tsx`
- `src/modules/transactions/api.ts`
- `src/modules/reports/logic.ts`
- `src/modules/goals/logic.ts`
- `src/modules/allocations/logic.ts`
- `src/components/RecurringExpenseDetailsView.tsx`
- `src/components/SplitBillFormModal.tsx`
- `src/components/SplitGroupDetailsView.tsx`
- `functions/src/triggers/transactions.ts`
- `functions/src/crons/recurring.ts`
- `firestore.rules`
- `firestore.indexes.json`

## Critérios de aceite da Fase 1

A Fase 1 está concluída quando:

- os tipos do novo domínio existem;
- as invariantes financeiras existem;
- os contratos de casos de uso existem;
- os cálculos puros existem;
- a compatibilidade com código legado está definida;
- a migração de dados está marcada como não obrigatória por banco vazio;
- a diferença entre compra, parcela, fatura, pagamento, limite e caixa está formalizada;
- nenhum fluxo antigo foi quebrado.

## Próxima fase autorizada

A próxima etapa é:

`Fase 2 — Estratégia de persistência e coleções Firestore`

A Fase 2 deve definir:

- coleções novas;
- caminhos Firestore;
- índices;
- regras de segurança;
- estratégia de escrita;
- estratégia de leitura;
- separação entre dados operacionais e projeções para UI.

A Fase 2 ainda não deve começar pela interface.