# Fase 2 — Estratégia de persistência e coleções Firestore

## Status

Fase 2 iniciada.

Esta fase define a estrutura oficial de persistência do novo domínio financeiro de cartão.

## Decisão principal

O novo domínio de cartão não será salvo em uma coleção genérica.

Cada entidade financeira terá coleção própria dentro de:

`workspaces/{workspaceId}`

## Contexto do banco

O banco está vazio no início desta fase.

Por isso:

- não há migração obrigatória de dados históricos;
- o novo domínio poderá ser adotado como fonte oficial;
- a compatibilidade com `transactions` continua existindo apenas por causa do código legado atual;
- o foco é impedir que novos dados de cartão sejam criados no modelo antigo depois da virada de fluxo.

## Coleções oficiais

### Cartões

`workspaces/{workspaceId}/credit_cards`

Responsabilidade:

- cadastro do cartão;
- limite total;
- status;
- regras de fechamento e vencimento;
- metadados visuais e organizacionais.

### Compras

`workspaces/{workspaceId}/credit_card_purchases`

Responsabilidade:

- registrar a compra original;
- controlar valor total;
- controlar quantidade de parcelas;
- registrar origem;
- registrar status da compra.

### Parcelas

`workspaces/{workspaceId}/credit_card_installments`

Responsabilidade:

- representar cada parcela derivada da compra;
- vincular compra, cartão, fatura e competência;
- guardar valor e status da parcela.

### Faturas

`workspaces/{workspaceId}/credit_card_invoices`

Responsabilidade:

- consolidar parcelas por competência;
- controlar total, pago, saldo e status;
- permitir histórico por cartão.

### Pagamentos de fatura

`workspaces/{workspaceId}/credit_card_invoice_payments`

Responsabilidade:

- registrar pagamento total ou parcial;
- vincular conta/carteira;
- controlar estorno;
- permitir recomposição de limite.

### Ledger de limite

`workspaces/{workspaceId}/card_limit_ledger`

Responsabilidade:

- registrar consumo de limite;
- registrar recomposição de limite;
- preservar saldo após movimento;
- permitir reconstrução auditável.

### Eventos financeiros

`workspaces/{workspaceId}/financial_events`

Responsabilidade:

- registrar eventos do domínio de cartão;
- preservar auditoria;
- suportar notificações futuras.

### Projeções de fatura

`workspaces/{workspaceId}/invoice_views`

Responsabilidade:

- fornecer leitura otimizada para UI;
- evitar recomputação pesada no browser;
- permitir lista principal com faturas.

### Snapshots de limite

`workspaces/{workspaceId}/card_limit_snapshots`

Responsabilidade:

- fornecer leitura rápida do limite atual;
- evitar somar ledger no cliente;
- alimentar tela de cartões e dashboard.

## Arquivo criado

`src/modules/credit-cards/persistence/firestorePaths.ts`

Responsabilidade:

- centralizar nomes das coleções;
- centralizar paths Firestore;
- centralizar referências tipadas;
- impedir strings soltas espalhadas pelo sistema.

## Regra de arquitetura

Nenhum novo código do domínio de cartão deve montar paths manualmente com strings soltas.

Use sempre os helpers de:

`src/modules/credit-cards/persistence/firestorePaths.ts`

## Consultas que a Fase 2 deve suportar

A UI precisa conseguir buscar sem full-scan:

- faturas abertas por cartão;
- histórico de faturas por cartão;
- parcelas por fatura;
- compras por cartão;
- pagamentos por fatura;
- snapshot de limite por cartão.

## Índices planejados

A próxima subfase deve criar índices para:

- `credit_card_invoices`: `cardId + status`
- `credit_card_invoices`: `cardId + competenceMonth`
- `credit_card_invoices`: `dueDate + status`
- `credit_card_installments`: `invoiceId + status`
- `credit_card_installments`: `purchaseId`
- `credit_card_installments`: `cardId + competenceMonth`
- `credit_card_purchases`: `cardId + status`
- `credit_card_invoice_payments`: `invoiceId + status`
- `card_limit_ledger`: `cardId + createdAt`

## O que ainda não foi feito

Esta subfase ainda não implementa:

- APIs de leitura;
- APIs de escrita;
- Cloud Functions;
- regras Firestore;
- índices;
- alteração de UI;
- alteração em relatórios;
- migração;
- pagamento de fatura.

## Subfase 2.2 — APIs de leitura orientadas a query

### Status

Concluída.

### Arquivo criado

`src/modules/credit-cards/persistence/readApi.ts`

### Objetivo

Criar leituras Firestore orientadas a query para evitar full-scan no browser.

### Funções criadas

- `getCreditCardInvoiceById`
- `getCardLimitSnapshotByCard`
- `listOpenCreditCardInvoicesByCard`
- `listCreditCardInvoiceHistoryByCard`
- `listCreditCardInvoicesByDueDateAndStatus`
- `listCreditCardInstallmentsByInvoice`
- `listCreditCardInstallmentsByPurchase`
- `listCreditCardInstallmentsByCardAndCompetence`
- `listCreditCardPurchasesByCard`
- `listCreditCardInvoicePaymentsByInvoice`
- `listCreditCardLedgerByCard`
- `listCreditCardInvoiceViewsByStatus`
- `listCreditCardInvoiceViewsByCard`

### Consultas atendidas

A UI passa a ter APIs preparadas para buscar:

- faturas abertas por cartão;
- histórico de faturas por cartão;
- parcelas por fatura;
- parcelas por compra;
- compras por cartão;
- pagamentos por fatura;
- ledger por cartão;
- snapshot de limite por cartão;
- projeções de fatura para listas.

### Observação

Essas funções ainda dependem da criação dos índices compostos na próxima subfase.

## Subfase 2.3 — Índices Firestore do domínio de cartão

### Status

Concluída.

### Arquivo alterado

`firestore.indexes.json`

### Objetivo

Criar os índices compostos necessários para as queries do novo domínio de cartão.

### Índices adicionados

#### Faturas

Coleção:

`credit_card_invoices`

Índices:

- `cardId ASC + status ASC + dueDate ASC`
- `cardId ASC + competenceMonth DESC`
- `cardId ASC + status ASC + competenceMonth DESC`
- `status ASC + dueDate ASC`

Esses índices suportam:

- faturas abertas por cartão;
- histórico de faturas por cartão;
- histórico filtrado por status;
- faturas por vencimento e status.

#### Parcelas

Coleção:

`credit_card_installments`

Índices:

- `invoiceId ASC + installmentNumber ASC`
- `invoiceId ASC + status ASC + installmentNumber ASC`
- `purchaseId ASC + installmentNumber ASC`
- `cardId ASC + competenceMonth ASC + installmentNumber ASC`

Esses índices suportam:

- parcelas por fatura;
- parcelas por fatura e status;
- parcelas por compra;
- parcelas por cartão e competência.

#### Compras

Coleção:

`credit_card_purchases`

Índices:

- `cardId ASC + purchaseDate DESC`
- `cardId ASC + status ASC + purchaseDate DESC`

Esses índices suportam:

- compras por cartão;
- compras por cartão e status;
- histórico de compras recentes.

#### Pagamentos de fatura

Coleção:

`credit_card_invoice_payments`

Índices:

- `invoiceId ASC + paymentDate DESC`
- `invoiceId ASC + status ASC + paymentDate DESC`

Esses índices suportam:

- pagamentos por fatura;
- pagamentos por fatura e status.

#### Ledger de limite

Coleção:

`card_limit_ledger`

Índices:

- `cardId ASC + createdAt DESC`
- `cardId ASC + sourceId ASC + createdAt DESC`

Esses índices suportam:

- histórico do ledger por cartão;
- busca de movimentos por origem.

#### Projeções de fatura

Coleção:

`invoice_views`

Índices:

- `status ASC + dueDate ASC`
- `cardId ASC + competenceMonth DESC`

Esses índices suportam:

- lista de faturas por status;
- histórico/projeções por cartão.

### Observação

Estes índices não alteram comportamento da aplicação por si só.

Eles apenas preparam o Firestore para executar as queries criadas em:

`src/modules/credit-cards/persistence/readApi.ts`

## Subfase 2.4 — Regras Firestore do novo domínio de cartão

### Status

Concluída.

### Arquivo alterado

`firestore.rules`

### Objetivo

Proteger as novas coleções do domínio de cartão com isolamento por workspace e bloqueio de escrita direta do cliente em operações financeiras críticas.

### Coleções protegidas

- `credit_card_purchases`
- `credit_card_installments`
- `credit_card_invoices`
- `credit_card_invoice_payments`
- `card_limit_ledger`
- `financial_events`
- `invoice_views`
- `card_limit_snapshots`

### Regra aplicada

Membros do workspace podem ler os dados do domínio de cartão.

O cliente não pode escrever diretamente nas coleções críticas do novo domínio.

As escritas futuras deverão ocorrer via camada backend/Cloud Functions usando Admin SDK, porque operações como criar compra, gerar parcelas, fechar fatura, pagar fatura, recompor limite e registrar ledger precisam ser transacionais, auditáveis e idempotentes.

### Ajuste importante

O fallback genérico:

`match /{subCollection}/{docId}`

foi ajustado para não liberar acesso indevido às novas coleções críticas do domínio de cartão.

Sem esse ajuste, `owner/admin` ainda poderia escrever nas novas coleções pelo fallback genérico, mesmo com regras específicas bloqueando escrita.

## Subfase 2.5 — Contratos de payload e estratégia de escrita backend

### Status

Concluída.

### Arquivos criados

`functions/src/creditCards/contracts.ts`

`functions/src/creditCards/writeStrategy.ts`

`functions/src/creditCards/index.ts`

### Objetivo

Definir os payloads das futuras Cloud Functions e a estratégia oficial de escrita backend do domínio de cartão.

### Decisão principal

O frontend não escreverá diretamente nas coleções críticas de cartão.

As operações financeiras serão executadas por Cloud Functions usando Admin SDK, validação de payload, verificação de permissão, idempotência e escrita transacional.

### Operações previstas

- `createCreditCardPurchase`
- `updateCreditCardPurchase`
- `cancelCreditCardPurchase`
- `closeCreditCardInvoice`
- `reopenCreditCardInvoice`
- `registerCreditCardInvoicePayment`
- `reverseCreditCardInvoicePayment`
- `recalculateCardLimit`
- `rebuildCardInvoicesForCard`
- `migrateLegacyInstallmentsToInvoiceDomain`

### Contratos de payload

Os payloads das funções callable são definidos com Zod em:

`functions/src/creditCards/contracts.ts`

Toda operação crítica exige:

- `workspaceId`
- `idempotencyKey`
- `correlationId`, quando disponível

### Estratégia de escrita

A matriz de escrita backend está em:

`functions/src/creditCards/writeStrategy.ts`

Ela define, por operação:

- papéis permitidos;
- exigência de autenticação;
- exigência de membership no workspace;
- exigência de idempotência;
- exigência de transação Firestore;
- coleções lidas;
- coleções escritas;
- impacto em ledger;
- impacto em caixa;
- atualização de projeções.

### Observação sobre migração

Como o banco está vazio, a migração de legado não bloqueia o rollout.

Mesmo assim, o contrato de migração permanece definido para segurança futura, homologação ou eventual importação de dados.

## Subfase 2.6 — Encerramento da Fase 2 e checklist para liberar a Fase 3

### Status

Concluída.

### Objetivo

Consolidar a estratégia de persistência do novo domínio financeiro de cartão antes de iniciar a camada de serviços de aplicação.

A Fase 2 não altera o comportamento atual do usuário. Ela prepara a base de dados, leitura, segurança e contratos backend para que a Fase 3 implemente operações financeiras reais de forma segura.

---

## Entregas concluídas na Fase 2

### 1. Coleções oficiais definidas

As coleções oficiais do novo domínio foram definidas dentro de:

`workspaces/{workspaceId}`

Coleções:

- `credit_cards`
- `credit_card_purchases`
- `credit_card_installments`
- `credit_card_invoices`
- `credit_card_invoice_payments`
- `card_limit_ledger`
- `financial_events`
- `invoice_views`
- `card_limit_snapshots`

Decisão:

O domínio de cartão não usará uma coleção genérica única para representar compras, parcelas, faturas, pagamentos e limite.

---

### 2. Paths Firestore centralizados

Arquivo criado:

`src/modules/credit-cards/persistence/firestorePaths.ts`

Responsabilidade:

- centralizar nomes de coleções;
- centralizar referências Firestore;
- evitar strings soltas;
- padronizar acesso dentro de `workspaces/{workspaceId}`;
- expor referências tipadas para as novas entidades.

Regra:

Nenhum novo código do domínio de cartão deve montar paths manualmente.

---

### 3. APIs de leitura orientadas a query

Arquivo criado:

`src/modules/credit-cards/persistence/readApi.ts`

Funções criadas:

- `getCreditCardInvoiceById`
- `getCardLimitSnapshotByCard`
- `listOpenCreditCardInvoicesByCard`
- `listCreditCardInvoiceHistoryByCard`
- `listCreditCardInvoicesByDueDateAndStatus`
- `listCreditCardInstallmentsByInvoice`
- `listCreditCardInstallmentsByPurchase`
- `listCreditCardInstallmentsByCardAndCompetence`
- `listCreditCardPurchasesByCard`
- `listCreditCardInvoicePaymentsByInvoice`
- `listCreditCardLedgerByCard`
- `listCreditCardInvoiceViewsByStatus`
- `listCreditCardInvoiceViewsByCard`

Essas funções preparam a UI para buscar dados por query, sem full-scan no browser.

---

### 4. Índices Firestore definidos

Arquivo alterado:

`firestore.indexes.json`

Índices adicionados para:

- `credit_card_invoices`
- `credit_card_installments`
- `credit_card_purchases`
- `credit_card_invoice_payments`
- `card_limit_ledger`
- `invoice_views`

Esses índices suportam consultas por:

- `cardId`
- `status`
- `dueDate`
- `competenceMonth`
- `invoiceId`
- `purchaseId`
- `paymentDate`
- `createdAt`

---

### 5. Regras Firestore protegendo o novo domínio

Arquivo alterado:

`firestore.rules`

Coleções protegidas:

- `credit_card_purchases`
- `credit_card_installments`
- `credit_card_invoices`
- `credit_card_invoice_payments`
- `card_limit_ledger`
- `financial_events`
- `invoice_views`
- `card_limit_snapshots`

Decisão de segurança:

- membros do workspace podem ler;
- cliente não pode escrever diretamente nas coleções críticas;
- escritas críticas serão feitas por backend/Cloud Functions com Admin SDK;
- fallback genérico foi ajustado para não liberar escrita indevida nas novas coleções.

---

### 6. Contratos backend definidos

Arquivos criados:

`functions/src/creditCards/contracts.ts`

`functions/src/creditCards/writeStrategy.ts`

`functions/src/creditCards/index.ts`

Responsabilidade:

- validar payloads futuros com Zod;
- definir operações críticas;
- definir papéis permitidos;
- definir exigência de autenticação;
- definir exigência de membership;
- definir exigência de idempotência;
- definir exigência de transação Firestore;
- mapear coleções lidas e escritas por operação.

Operações previstas:

- `createCreditCardPurchase`
- `updateCreditCardPurchase`
- `cancelCreditCardPurchase`
- `closeCreditCardInvoice`
- `reopenCreditCardInvoice`
- `registerCreditCardInvoicePayment`
- `reverseCreditCardInvoicePayment`
- `recalculateCardLimit`
- `rebuildCardInvoicesForCard`
- `migrateLegacyInstallmentsToInvoiceDomain`

---

## Critérios de aceite da Fase 2

A Fase 2 é considerada concluída quando todos os itens abaixo estiverem cumpridos.

### Critério 1 — Coleções separadas

Status: concluído.

Cada entidade do domínio possui coleção própria:

| Entidade | Coleção |
|---|---|
| Cartão | `credit_cards` |
| Compra | `credit_card_purchases` |
| Parcela | `credit_card_installments` |
| Fatura | `credit_card_invoices` |
| Pagamento | `credit_card_invoice_payments` |
| Ledger de limite | `card_limit_ledger` |
| Evento financeiro | `financial_events` |
| Projeção de fatura | `invoice_views` |
| Snapshot de limite | `card_limit_snapshots` |

---

### Critério 2 — Persistência escopada por workspace

Status: concluído.

Todas as coleções novas vivem em:

`workspaces/{workspaceId}`

Não há coleção global para dados financeiros do cartão.

---

### Critério 3 — Leituras sem full-scan

Status: concluído.

A UI terá APIs específicas para buscar:

| Necessidade da UI | Função preparada |
|---|---|
| Faturas abertas por cartão | `listOpenCreditCardInvoicesByCard` |
| Histórico de faturas | `listCreditCardInvoiceHistoryByCard` |
| Parcelas por fatura | `listCreditCardInstallmentsByInvoice` |
| Compras por cartão | `listCreditCardPurchasesByCard` |
| Pagamentos por fatura | `listCreditCardInvoicePaymentsByInvoice` |
| Snapshot de limite | `getCardLimitSnapshotByCard` |
| Projeções para lista | `listCreditCardInvoiceViewsByStatus` |

---

### Critério 4 — Índices compatíveis com queries

Status: concluído.

As queries de leitura criadas possuem índices planejados em:

`firestore.indexes.json`

---

### Critério 5 — Escrita crítica bloqueada no cliente

Status: concluído.

O cliente não pode escrever diretamente em:

- compras;
- parcelas;
- faturas;
- pagamentos;
- ledger;
- eventos;
- projeções;
- snapshots.

Essas escritas serão feitas por Cloud Functions.

---

### Critério 6 — Estratégia backend definida

Status: concluído.

As futuras Cloud Functions já possuem:

- contratos de payload;
- validação Zod;
- matriz de escrita;
- papéis permitidos;
- indicação de transação Firestore;
- exigência de idempotência.

---

### Critério 7 — Banco vazio considerado

Status: concluído.

Como o banco está vazio:

- migração de dados legados não bloqueia rollout;
- contrato de migração permanece apenas como proteção futura;
- foco da próxima fase será impedir criação de novos dados no modelo antigo.

---

## O que ainda não foi implementado

A Fase 2 não implementa:

- criação real de compra;
- geração real de parcelas;
- criação real de faturas;
- pagamento de fatura;
- recomposição de limite;
- escrita de ledger;
- atualização de projeções;
- Cloud Functions callable reais;
- integração com UI;
- alteração no `TransactionModal`;
- alteração em relatórios;
- alteração na tela de cartões.

Esses pontos pertencem à Fase 3 e fases posteriores.

---

## Arquivos que continuam congelados

Até a Fase 3 implementar serviços de aplicação, não alterar comportamento financeiro em:

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
- `functions/src/index.ts`

---

## Verificações recomendadas

Antes de iniciar a Fase 3, executar:

```bash
npm run build
