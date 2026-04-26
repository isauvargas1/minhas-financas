# Fase 3 — Serviços de aplicação e casos de uso

## Status

Fase 3 iniciada.

## Subfase 3.1 — Infraestrutura base das Cloud Functions de cartão

### Status

Concluída.

### Objetivo

Criar a base backend necessária para implementar os casos de uso reais do domínio de cartão sem colocar regra crítica no frontend.

## Arquivos criados

- `functions/src/creditCards/adminPaths.ts`
- `functions/src/creditCards/auth.ts`
- `functions/src/creditCards/callable.ts`
- `functions/src/creditCards/errors.ts`
- `functions/src/creditCards/idempotency.ts`

## Arquivo alterado

- `functions/src/creditCards/index.ts`
- `firestore.rules`

## Decisão principal

As operações críticas de cartão serão executadas por Cloud Functions usando Admin SDK.

O frontend não escreverá diretamente em:

- compras;
- parcelas;
- faturas;
- pagamentos;
- ledger;
- eventos financeiros;
- projeções;
- snapshots de limite;
- chaves de idempotência.

## Idempotência

Foi criada a coleção interna:

`workspaces/{workspaceId}/credit_card_idempotency_keys`

Essa coleção é protegida contra leitura e escrita direta do cliente.

Ela será usada pelas Cloud Functions para impedir duplicidade em operações como:

- criação de compra;
- pagamento de fatura;
- estorno;
- cancelamento;
- rebuild;
- recalculo.

## Segurança

A infraestrutura criada valida:

- usuário autenticado;
- membership no workspace;
- papel do usuário;
- payload;
- operação permitida;
- chave de idempotência.

## O que ainda não foi implementado

Esta subfase ainda não implementa:

- `createCreditCardPurchase`;
- `updateCreditCardPurchase`;
- `cancelCreditCardPurchase`;
- `closeCreditCardInvoice`;
- `registerCreditCardInvoicePayment`;
- `reverseCreditCardInvoicePayment`;
- integração com UI;
- atualização de relatórios;
- alteração no fluxo legado.

## Subfase 3.2 — Implementação backend de createCreditCardPurchase

### Status

Concluída.

### Arquivos criados

- `functions/src/creditCards/createPurchase.ts`
- `functions/src/creditCards/callables.ts`

### Arquivos alterados

- `functions/src/creditCards/index.ts`
- `functions/src/index.ts`

### Objetivo

Criar a primeira Cloud Function real do domínio de cartão, ainda sem integração com a UI.

### Função criada

`createCreditCardPurchase`

### Responsabilidades implementadas

A função:

- valida payload;
- valida usuário autenticado;
- valida papel no workspace;
- valida cartão existente;
- valida cartão ativo;
- valida limite disponível;
- calcula primeira competência da fatura;
- gera parcelas;
- cria ou atualiza faturas abertas;
- vincula parcelas às faturas;
- consome limite;
- registra `card_limit_ledger`;
- atualiza `card_limit_snapshots`;
- cria ou atualiza `invoice_views`;
- registra evento em `financial_events`;
- grava chave de idempotência;
- retorna o mesmo resultado se a chamada for repetida com a mesma chave e payload.

### Coleções escritas

- `credit_card_purchases`
- `credit_card_installments`
- `credit_card_invoices`
- `card_limit_ledger`
- `financial_events`
- `invoice_views`
- `card_limit_snapshots`
- `credit_card_idempotency_keys`

### Observação

Esta subfase ainda não altera `TransactionModal.tsx`.

O frontend ainda não chama esta função.

## Subfase 3.3 — Teste controlado da callable createCreditCardPurchase

### Status

Concluída como teste manual de serviço backend.

### Arquivo criado

`functions/src/creditCards/manualCreatePurchaseTest.ts`

### Arquivo ajustado

`functions/src/creditCards/createPurchase.ts`

### Correção aplicada

A reserva de idempotência foi reposicionada para ocorrer depois das leituras de cartão, snapshot de limite e faturas existentes.

Isso evita leitura após escrita dentro da transação Firestore.

### O que o teste valida

O teste manual:

- roda somente com `FIRESTORE_EMULATOR_HOST`;
- cria workspace de teste;
- cria membro owner;
- cria cartão ativo;
- cria snapshot de limite;
- executa `createCreditCardPurchase`;
- executa a mesma operação novamente com a mesma `idempotencyKey`;
- valida replay idempotente;
- valida criação de compra;
- valida criação de 3 parcelas;
- valida criação de 3 faturas;
- valida criação de ledger;
- valida criação de evento financeiro;
- valida criação de projeções;
- valida limite usado de 1200;
- valida limite disponível de 3800.

### Comandos de teste

Terminal 1:

```bash
firebase emulators:start --only firestore

## Subfase 3.4 — Implementação backend de registerCreditCardInvoicePayment

### Status

Concluída como implementação backend inicial.

### Arquivo criado

`functions/src/creditCards/registerInvoicePayment.ts`

### Arquivos alterados

- `functions/src/creditCards/callables.ts`
- `functions/src/creditCards/index.ts`

### Função criada

`registerCreditCardInvoicePayment`

### Responsabilidades implementadas

A função:

- valida payload;
- valida autenticação;
- valida papel no workspace;
- valida fatura existente;
- bloqueia pagamento em fatura cancelada;
- bloqueia pagamento em fatura já paga;
- bloqueia pagamento acima do saldo restante;
- registra pagamento;
- atualiza valor pago da fatura;
- atualiza saldo restante;
- atualiza status da fatura;
- atualiza projeção da fatura;
- registra ledger de restauração de limite;
- atualiza snapshot de limite;
- registra evento financeiro;
- cria transação de saída de caixa quando aplicável;
- respeita idempotência.

### Observação

A função ainda não atualiza saldo de carteira ou conta específica porque o domínio de `wallets` e `cash_accounts` ainda não foi formalmente integrado ao novo fluxo de cartão.

Nesta etapa, a saída de caixa é registrada como uma `transaction` paga vinculada ao pagamento da fatura.

## Próxima subfase

`Subfase 3.5 — Teste controlado de registerCreditCardInvoicePayment`

Antes de integrar na UI, a função deve ser testada no emulador usando uma fatura criada pela `createCreditCardPurchase`.

## Subfase 3.5 — Teste controlado de registerCreditCardInvoicePayment

### Status

Concluída como teste manual de serviço backend.

### Arquivo criado

`functions/src/creditCards/manualInvoicePaymentTest.ts`

### Arquivo ajustado

`functions/src/creditCards/registerInvoicePayment.ts`

### Correção aplicada

A verificação de idempotência foi reposicionada antes dos bloqueios de fatura cancelada ou paga.

Isso garante que uma repetição da mesma chamada com a mesma `idempotencyKey` retorne o resultado anterior, mesmo se a fatura já tiver sido paga pela primeira execução.

### O que o teste valida

O teste manual:

- roda somente com `FIRESTORE_EMULATOR_HOST`;
- cria workspace de teste;
- cria membro owner;
- cria cartão ativo;
- cria snapshot de limite;
- cria compra de R$ 1.200,00 em 3 parcelas;
- pega a primeira fatura de R$ 400,00;
- paga integralmente a primeira fatura;
- executa o pagamento novamente com a mesma `idempotencyKey`;
- valida replay idempotente;
- valida criação do pagamento;
- valida atualização da fatura para `paid`;
- valida `paidAmount` de 400;
- valida `remainingAmount` de 0;
- valida ledger de restauração;
- valida evento financeiro;
- valida transação de saída de caixa;
- valida limite usado de 800;
- valida limite disponível de 4200.

### Comandos de teste

Terminal 1:

```bash
firebase emulators:start --only firestore --project minhas-financas-local

## Subfase 3.6 — Implementação backend de reverseCreditCardInvoicePayment

### Status

Concluída como implementação backend inicial.

### Arquivo criado

`functions/src/creditCards/reverseInvoicePayment.ts`

### Arquivos alterados

- `functions/src/creditCards/registerInvoicePayment.ts`
- `functions/src/creditCards/callables.ts`
- `functions/src/creditCards/index.ts`

### Função criada

`reverseCreditCardInvoicePayment`

### Responsabilidades implementadas

A função:

- valida payload;
- valida autenticação;
- valida papel no workspace;
- valida pagamento existente;
- valida fatura existente;
- valida snapshot de limite;
- bloqueia estorno de pagamento já estornado;
- bloqueia estorno de pagamento não postado;
- marca pagamento como `reversed`;
- reduz `paidAmount` da fatura;
- aumenta `remainingAmount`;
- recalcula status da fatura;
- atualiza projeção da fatura;
- consome novamente o limite recomposto;
- registra ledger de reversão;
- atualiza snapshot de limite;
- cria transação de reversão de caixa quando aplicável;
- registra evento financeiro;
- respeita idempotência.

## Próxima subfase

`Subfase 3.7 — Teste controlado de reverseCreditCardInvoicePayment`

## Subfase 3.7 — Teste controlado de reverseCreditCardInvoicePayment

### Status

Concluída como teste manual de serviço backend.

### Arquivo criado

`functions/src/creditCards/manualReverseInvoicePaymentTest.ts`

### O que o teste valida

O teste manual:

- roda somente com `FIRESTORE_EMULATOR_HOST`;
- cria workspace de teste;
- cria membro owner;
- cria cartão ativo;
- cria snapshot de limite;
- cria compra de R$ 1.200,00 em 3 parcelas;
- paga integralmente a primeira fatura de R$ 400,00;
- estorna o pagamento;
- executa o estorno novamente com a mesma `idempotencyKey`;
- valida replay idempotente;
- valida pagamento com status `reversed`;
- valida fatura reaberta com status `open`;
- valida `paidAmount` de 0;
- valida `remainingAmount` de 400;
- valida ledger de reversão;
- valida evento financeiro;
- valida transação de reversão de caixa;
- valida limite usado de 1200;
- valida limite disponível de 3800.

### Comandos de teste

Terminal 1:

```bash
firebase emulators:start --only firestore --project minhas-financas-local

## Subfase 3.8 — Implementação backend de cancelCreditCardPurchase

### Status

Concluída como implementação backend inicial.

### Arquivo criado

`functions/src/creditCards/cancelPurchase.ts`

### Arquivos alterados

- `functions/src/creditCards/callables.ts`
- `functions/src/creditCards/index.ts`

### Função criada

`cancelCreditCardPurchase`

### Regra aplicada

Nesta primeira versão, o cancelamento é conservador.

A compra só pode ser cancelada quando:

- a compra está ativa;
- todas as parcelas pertencem ao mesmo workspace e cartão;
- nenhuma parcela possui valor pago;
- nenhuma parcela está paga;
- nenhuma parcela já foi cancelada ou revertida;
- todas as faturas afetadas estão abertas.

### Responsabilidades implementadas

A função:

- valida payload;
- valida autenticação;
- valida papel no workspace;
- valida compra existente;
- valida parcelas da compra;
- valida faturas afetadas;
- cancela a compra;
- cancela as parcelas;
- recalcula faturas afetadas;
- cancela faturas que ficarem sem itens;
- restaura limite;
- registra ledger de restauração;
- atualiza snapshot de limite;
- registra evento financeiro;
- respeita idempotência.

## Próxima subfase

`Subfase 3.9 — Teste controlado de cancelCreditCardPurchase`

## Subfase 3.9 — Teste controlado de cancelCreditCardPurchase

### Status

Concluída como teste manual de serviço backend.

### Arquivo criado

`functions/src/creditCards/manualCancelPurchaseTest.ts`

### O que o teste valida

O teste manual:

- roda somente com `FIRESTORE_EMULATOR_HOST`;
- cria workspace de teste;
- cria membro owner;
- cria cartão ativo;
- cria snapshot de limite;
- cria compra de R$ 1.200,00 em 3 parcelas;
- cancela a compra;
- executa o cancelamento novamente com a mesma `idempotencyKey`;
- valida replay idempotente;
- valida compra com status `cancelled`;
- valida 3 parcelas com status `cancelled`;
- valida 3 faturas recalculadas para valor zero;
- valida 3 faturas com status `cancelled`;
- valida ledger de restauração;
- valida evento financeiro;
- valida limite usado de 0;
- valida limite disponível de 5000.

### Comandos de teste

Terminal 1:

```bash
firebase emulators:start --only firestore --project minhas-financas-local

## Subfase 3.10 — Implementação backend de recalculateCardLimit

### Status

Concluída como implementação backend inicial.

### Arquivo criado

`functions/src/creditCards/recalculateCardLimit.ts`

### Arquivos alterados

- `functions/src/creditCards/callables.ts`
- `functions/src/creditCards/index.ts`

### Função criada

`recalculateCardLimit`

### Responsabilidades implementadas

A função:

- valida payload;
- valida autenticação;
- valida papel no workspace;
- valida cartão existente;
- lê o `card_limit_ledger` do cartão;
- valida lançamentos do ledger;
- soma movimentos de consumo;
- soma movimentos de restauração;
- recalcula limite usado;
- recalcula limite disponível;
- atualiza `card_limit_snapshots`;
- registra evento financeiro de reconciliação;
- respeita idempotência.

### Observação

Esta função não deve ser usada pela UI para cálculo cotidiano.

Ela é uma operação administrativa de reconciliação e manutenção operacional. A UI deve continuar lendo `card_limit_snapshots` e projeções prontas.

## Subfase 3.11 — Teste controlado de recalculateCardLimit

### Status

Concluída como teste manual de serviço backend.

### Arquivo criado

`functions/src/creditCards/manualRecalculateCardLimitTest.ts`

### O que o teste valida

O teste manual:

- roda somente com `FIRESTORE_EMULATOR_HOST`;
- cria workspace de teste;
- cria membro owner;
- cria cartão ativo;
- cria snapshot de limite;
- cria compra de R$ 1.200,00 em 3 parcelas;
- paga integralmente a primeira fatura de R$ 400,00;
- estorna o pagamento de R$ 400,00;
- corrompe propositalmente o snapshot de limite;
- executa `recalculateCardLimit`;
- executa novamente com a mesma `idempotencyKey`;
- valida replay idempotente;
- valida 3 lançamentos no ledger;
- valida `limitUsed` reconstruído como 1200;
- valida `limitAvailable` reconstruído como 3800;
- valida criação de evento financeiro de reconciliação.

### Comandos de teste

Terminal 1:

```bash
firebase emulators:start --only firestore --project minhas-financas-local

## Subfase 3.12 — Implementação backend de closeCreditCardInvoice

### Status

Concluída como implementação backend inicial.

### Arquivo criado

`functions/src/creditCards/closeInvoice.ts`

### Arquivos alterados

- `functions/src/creditCards/callables.ts`
- `functions/src/creditCards/index.ts`

### Função criada

`closeCreditCardInvoice`

### Regra aplicada

Nesta primeira versão, o fechamento é conservador.

A fatura só pode ser fechada quando:

- a fatura existe;
- pertence ao workspace informado;
- pertence ao cartão informado;
- está com status `open`;
- possui pelo menos uma parcela faturável;
- as parcelas pertencem ao mesmo workspace, cartão e fatura.

### Responsabilidades implementadas

A função:

- valida payload;
- valida autenticação;
- valida papel no workspace;
- valida fatura existente;
- carrega parcelas da fatura;
- recalcula total da fatura pelas parcelas faturáveis;
- recalcula saldo restante;
- atualiza status da fatura para `closed`;
- grava `closedAt`;
- atualiza projeção `invoice_views`;
- registra evento financeiro;
- respeita idempotência.

## Próxima subfase

`Subfase 3.13 — Teste controlado de closeCreditCardInvoice`

## Subfase 3.13 — Teste controlado de closeCreditCardInvoice

### Status

Concluída como teste manual de serviço backend.

### Arquivo criado

`functions/src/creditCards/manualCloseInvoiceTest.ts`

### O que o teste valida

O teste manual:

- roda somente com `FIRESTORE_EMULATOR_HOST`;
- cria workspace de teste;
- cria membro owner;
- cria cartão ativo;
- cria snapshot de limite;
- cria compra de R$ 1.200,00 em 3 parcelas;
- pega a primeira fatura de R$ 400,00;
- fecha a primeira fatura;
- executa o fechamento novamente com a mesma `idempotencyKey`;
- valida replay idempotente;
- valida fatura com status `closed`;
- valida `totalAmount` de 400;
- valida `paidAmount` de 0;
- valida `remainingAmount` de 400;
- valida `itemsCount` de 1;
- valida atualização de `invoice_views`;
- valida evento financeiro `invoice_closed`.

### Comandos de teste

Terminal 1:

```bash
firebase emulators:start --only firestore --project minhas-financas-local

## Subfase 3.14 — Implementação backend de reopenCreditCardInvoice

### Status

Concluída como implementação backend inicial.

### Arquivo criado

`functions/src/creditCards/reopenInvoice.ts`

### Arquivos alterados

- `functions/src/creditCards/callables.ts`
- `functions/src/creditCards/index.ts`

### Função criada

`reopenCreditCardInvoice`

### Regra aplicada

Nesta primeira versão, a reabertura é conservadora.

A fatura só pode ser reaberta quando:

- a fatura existe;
- pertence ao workspace informado;
- pertence ao cartão informado;
- está com status `closed`;
- não possui pagamentos registrados;
- possui `paidAmount` igual a zero.

### Responsabilidades implementadas

A função:

- valida payload;
- valida autenticação;
- valida papel no workspace;
- valida fatura existente;
- valida ausência de pagamentos;
- reabre a fatura;
- atualiza projeção `invoice_views`;
- registra evento financeiro;
- respeita idempotência.

## Próxima subfase

`Subfase 3.15 — Teste controlado de reopenCreditCardInvoice`

## Subfase 3.15 — Teste controlado de reopenCreditCardInvoice

### Status

Concluída como teste manual de serviço backend.

### Arquivo criado

`functions/src/creditCards/manualReopenInvoiceTest.ts`

### O que o teste valida

O teste manual:

- roda somente com `FIRESTORE_EMULATOR_HOST`;
- cria workspace de teste;
- cria membro owner;
- cria cartão ativo;
- cria snapshot de limite;
- cria compra de R$ 1.200,00 em 3 parcelas;
- pega a primeira fatura de R$ 400,00;
- fecha a primeira fatura;
- reabre a primeira fatura;
- executa a reabertura novamente com a mesma `idempotencyKey`;
- valida replay idempotente;
- valida fatura com status `open`;
- valida `closedAt` como `null`;
- valida `totalAmount` de 400;
- valida `paidAmount` de 0;
- valida `remainingAmount` de 400;
- valida atualização de `invoice_views`;
- valida evento financeiro `invoice_reopened`.

### Comandos de teste

Terminal 1:

```bash
firebase emulators:start --only firestore --project minhas-financas-local

## Subfase 3.16 — Implementação backend de rebuildCardInvoicesForCard

### Status

Concluída como implementação backend inicial.

### Arquivo criado

`functions/src/creditCards/rebuildInvoices.ts`

### Arquivos alterados

- `functions/src/creditCards/callables.ts`
- `functions/src/creditCards/index.ts`

### Função criada

`rebuildCardInvoicesForCard`

### Regra aplicada

Nesta primeira versão, o rebuild é conservador.

A reconstrução só pode ocorrer quando:

- o cartão existe;
- as parcelas pertencem ao workspace e cartão informados;
- as parcelas possuem competência válida;
- as faturas afetadas não possuem pagamentos ativos;
- as faturas afetadas não estão pagas ou parcialmente pagas.

### Responsabilidades implementadas

A função:

- valida payload;
- valida autenticação;
- valida papel no workspace;
- valida cartão existente;
- carrega parcelas do cartão;
- filtra parcelas por competência opcional;
- agrupa parcelas por competência;
- reconstrói faturas;
- atualiza `invoiceId` das parcelas quando necessário;
- atualiza `invoice_views`;
- cancela faturas sem itens dentro do escopo;
- bloqueia rebuild com pagamentos ativos;
- registra evento financeiro de reconciliação;
- respeita idempotência.

## Subfase 3.17 — Teste controlado de rebuildCardInvoicesForCard

### Status

Implementada como teste manual de serviço backend.

### Arquivo criado

`functions/src/creditCards/manualRebuildInvoicesTest.ts`

### O que o teste valida

O teste manual:

- cria workspace de teste;
- cria membro owner;
- cria cartão ativo;
- cria snapshot de limite;
- cria compra de R$ 1.200,00 em 3 parcelas;
- corrompe a primeira fatura;
- corrompe a projeção da primeira fatura;
- corrompe o vínculo/status/vencimento da primeira parcela;
- executa `rebuildCardInvoicesForCard`;
- executa novamente com a mesma `idempotencyKey`;
- valida replay idempotente;
- valida 3 faturas reconstruídas;
- valida `invoice_views`;
- valida parcela religada à fatura correta;
- valida evento financeiro `reconciliation_warning`.

## Subfase 3.18 — Implementação backend de updateCreditCardPurchase

### Status

Concluída como implementação backend inicial.

### Arquivo criado

`functions/src/creditCards/updatePurchase.ts`

### Arquivos alterados

- `functions/src/creditCards/callables.ts`
- `functions/src/creditCards/index.ts`

### Função criada

`updateCreditCardPurchase`

### Regra aplicada

Nesta primeira versão, a edição é conservadora.

A compra só pode ser editada quando:

- a compra existe;
- a compra está ativa;
- pertence ao workspace informado;
- pertence ao cartão informado;
- todas as parcelas pertencem à compra, cartão e workspace;
- nenhuma parcela está paga;
- nenhuma fatura afetada possui pagamento ativo;
- todas as faturas afetadas existentes estão abertas;
- há limite disponível quando a edição aumenta o valor total.

### Responsabilidades implementadas

A função:

- valida payload;
- valida autenticação;
- valida papel no workspace;
- valida compra existente;
- valida parcelas existentes;
- recalcula valor total;
- recalcula primeira competência;
- reconstrói parcelas da compra;
- cancela parcelas excedentes quando a nova quantidade é menor;
- cria ou atualiza faturas afetadas;
- recalcula totais, saldos e quantidade de itens das faturas;
- ajusta limite pelo delta da compra;
- registra ledger quando há alteração de valor;
- atualiza snapshot de limite;
- registra evento financeiro;
- respeita idempotência.

## Próxima subfase

`Subfase 3.19 — Teste controlado de updateCreditCardPurchase`

## Subfase 3.19 — Teste controlado de updateCreditCardPurchase

### Status

Concluída como teste manual de serviço backend.

### Arquivo criado

`functions/src/creditCards/manualUpdatePurchaseTest.ts`

### Arquivo ajustado

`functions/src/creditCards/updatePurchase.ts`

### Correções aplicadas

- remoção de variáveis não usadas;
- correção de `firstInvoiceCompetence` para usar `newFirstInvoiceCompetence`.

### O que o teste valida

O teste manual:

- roda somente com `FIRESTORE_EMULATOR_HOST`;
- cria workspace de teste;
- cria membro owner;
- cria cartão ativo;
- cria snapshot de limite;
- cria compra de R$ 1.200,00 em 3 parcelas;
- edita a compra para R$ 1.500,00 em 5 parcelas;
- executa a edição novamente com a mesma `idempotencyKey`;
- valida replay idempotente;
- valida 5 parcelas de R$ 300,00;
- valida 5 faturas de R$ 300,00;
- valida 5 projeções de fatura;
- valida limite usado de 1500;
- valida limite disponível de 3500;
- valida ledger de consumo de 300;
- valida evento financeiro `purchase_updated`.

### Comandos de teste

Terminal 1:

```bash
firebase emulators:start --only firestore --project minhas-financas-local