# Fase 11 — Testes, qualidade e observabilidade

## Status

Fase 11 iniciada.

## Subfase 11.1 — Base de testes automatizados de consistência do domínio

### Status

Concluída como primeira camada de testes unitários puros do domínio de cartão.

### Arquivos criados

- `functions/src/creditCards/testSupport/domainConsistency.ts`
- `functions/src/creditCards/__tests__/domainConsistency.test.ts`
- `docs/credit-card-domain-phase-11-tests-observability.md`

### Arquivo alterado

- `functions/package.json`

### Objetivo

Criar a primeira base automatizada para validar invariantes financeiros do domínio de cartão antes do rollout.

### Consistências cobertas

- soma das parcelas igual ao total da compra;
- soma dos itens igual ao total da fatura;
- soma dos pagamentos postados igual ao `paidAmount`;
- limite disponível igual ao limite total menos consumo líquido;
- normalização monetária para evitar divergência por centavos.

### Regra preservada

Esses testes não alteram comportamento de produção.

Eles servem como base para os próximos testes de integração com Firestore Emulator e Cloud Functions.

### Próxima subfase

`Subfase 11.2 — Testes unitários de competência, parcelas e alocação em faturas`

## Subfase 11.2 — Testes unitários de competência, parcelas e alocação em faturas

### Status

Concluída como cobertura unitária das regras de agendamento da compra no cartão.

### Arquivo criado

- `functions/src/creditCards/__tests__/purchaseSchedule.test.ts`

### Arquivo alterado

- `functions/src/creditCards/createPurchase.ts`

### Objetivo

Validar as regras puras usadas na criação de compra no cartão antes de avançar para testes de integração.

### Regras cobertas

- compra até o fechamento cai na competência do mês da compra;
- compra após o fechamento cai na próxima competência;
- virada de ano é tratada corretamente;
- parcelas ajustam centavos na última parcela;
- compra à vista no cartão gera uma única parcela;
- compra parcelada gera competências sequenciais;
- parcelas são vinculadas às faturas corretas;
- fechamento e vencimento usam data segura em meses curtos.

### Regra preservada

Os testes usam helpers puros do domínio.

Nenhuma escrita em Firestore é executada nesta subfase.

## Subfase 11.3 — Testes unitários de pagamento parcial, estorno e recomposição de limite

### Status

Concluída como cobertura unitária do ciclo de pagamento de fatura.

### Arquivos criados

- `functions/src/creditCards/testSupport/paymentLifecycle.ts`
- `functions/src/creditCards/__tests__/paymentLifecycle.test.ts`

### Objetivo

Validar regras financeiras puras relacionadas ao pagamento, estorno e limite do cartão.

### Regras cobertas

- pagamento parcial reduz saldo e mantém fatura parcial;
- pagamento total zera saldo e marca fatura como paga;
- pagamento acima do saldo é bloqueado;
- pagamento em fatura paga é bloqueado;
- estorno total de pagamento parcial reabre fatura;
- estorno parcial de fatura paga deixa fatura parcial;
- estorno acima do valor pago é bloqueado;
- pagamento recompõe limite proporcionalmente;
- estorno consome novamente limite no valor estornado;
- valores inválidos são bloqueados.

### Regra preservada

Os testes validam regras puras sem executar escrita em Firestore.

As Cloud Functions continuam sendo a fonte real de execução das operações críticas em produção.

## Subfase 11.4 — Base de integração com Firestore Emulator e seed multiworkspace

### Status

Concluída como infraestrutura inicial para testes de integração do domínio de cartão.

### Arquivos criados

- `functions/src/creditCards/testSupport/emulatorFirestore.ts`
- `functions/src/creditCards/__tests__/emulatorSmoke.integration.test.ts`

### Arquivo alterado

- `functions/package.json`

### Objetivo

Preparar uma base segura para testes de integração com Firestore Emulator, sem depender do ambiente de produção.

### Comportamento implementado

- inicialização do Admin SDK apontando para o Firestore Emulator;
- limpeza de workspace de teste;
- seed de workspace;
- seed de membro owner;
- seed de cartão;
- seed de snapshot de limite;
- teste smoke validando isolamento e leitura dos documentos criados.

### Regra preservada

Essa subfase ainda não executa Cloud Functions completas.

Ela prepara o ambiente para os próximos testes de integração do ciclo real:

- criação de compra;
- pagamento de fatura;
- estorno;
- rebuild;
- reconciliação.

### Como executar

Em um terminal, iniciar o emulador:

```bash
firebase emulators:start --only firestore --project minhas-financas-local

## Subfase 11.5 — Teste de integração da criação de compra no cartão

### Status

Concluída como primeiro teste de integração do fluxo real de compra no cartão.

### Arquivo criado

- `functions/src/creditCards/__tests__/createPurchase.integration.test.ts`

### Arquivo alterado

- `functions/src/creditCards/createPurchase.ts`, apenas se `executeCreateCreditCardPurchase` ainda não estivesse exportado.

### Objetivo

Validar que a criação de compra no cartão grava corretamente todos os documentos do domínio no Firestore Emulator.

### Fluxo validado

- criação de `credit_card_purchases`;
- criação de `credit_card_installments`;
- criação de `credit_card_invoices`;
- criação de `invoice_views`;
- criação de `card_limit_ledger`;
- atualização de `card_limit_snapshots`;
- criação de `financial_events`;
- criação de `credit_card_audit_logs`;
- criação de `notifications`.

### Consistências validadas

- soma das parcelas fecha com o total da compra;
- parcelas são alocadas nas faturas corretas;
- faturas refletem total, saldo e quantidade de itens;
- limite usado aumenta pelo valor total da compra;
- limite disponível reduz proporcionalmente;
- evento financeiro registra `actorId`;
- auditoria registra ação e usuário;
- notificação nasce do evento de domínio.

### Regra preservada

O teste roda apenas no Firestore Emulator.

Nenhum dado de produção é acessado.

## Subfase 11.6 — Teste de integração de pagamento parcial e total de fatura

### Status

Concluída como teste de integração do ciclo de pagamento de fatura.

### Arquivo criado

- `functions/src/creditCards/__tests__/registerInvoicePayment.integration.test.ts`

### Arquivo alterado

- `functions/src/creditCards/registerInvoicePayment.ts`, apenas se `executeRegisterCreditCardInvoicePayment` ainda não estivesse exportado.

### Objetivo

Validar que pagamentos parciais e totais de fatura atualizam corretamente o domínio financeiro no Firestore Emulator.

### Fluxo validado

- pagamento parcial de fatura;
- atualização de `paidAmount`;
- atualização de `remainingAmount`;
- status `partial_paid`;
- recomposição parcial de limite;
- pagamento do saldo restante;
- status `paid`;
- atualização de `invoice_views`;
- criação de pagamentos;
- criação de transações de caixa;
- criação de ledger de recomposição;
- criação de eventos financeiros;
- criação de audit logs;
- criação de notificações.

### Consistências validadas

- soma dos pagamentos equivale ao valor pago da fatura;
- pagamento parcial recompõe limite apenas no valor pago;
- pagamento total zera saldo da fatura;
- caixa registra saída apenas pelos pagamentos efetivos;
- evento financeiro registra `actorId`;
- auditoria registra ação e usuário;
- notificação nasce do evento de domínio.

### Regra preservada

O teste roda apenas no Firestore Emulator.

Nenhum dado de produção é acessado.

## Subfase 11.7 — Teste de integração de estorno de pagamento de fatura

### Status

Concluída como teste de integração do estorno de pagamento de fatura.

### Arquivo criado

- `functions/src/creditCards/__tests__/reverseInvoicePayment.integration.test.ts`

### Arquivo alterado

- `functions/src/creditCards/reverseInvoicePayment.ts`, apenas se `executeReverseCreditCardInvoicePayment` ainda não estivesse exportado.

### Objetivo

Validar que o estorno de pagamento de fatura atualiza corretamente o domínio financeiro no Firestore Emulator.

### Fluxo validado

- criação de compra;
- pagamento total da primeira fatura;
- estorno do pagamento;
- atualização do pagamento para `reversed`;
- reabertura da fatura;
- atualização de `invoice_views`;
- consumo novamente do limite;
- criação de ledger de estorno;
- criação de transação de caixa reversa;
- criação de evento financeiro;
- criação de audit log;
- criação de notificação.

### Consistências validadas

- fatura volta de `paid` para `open`;
- `paidAmount` volta para zero;
- `remainingAmount` volta ao saldo original;
- limite usado volta ao valor anterior ao pagamento;
- caixa recebe transação reversa;
- ledger registra `direction: consume`;
- ledger registra `sourceType: reversal`;
- evento financeiro registra `actorId`;
- auditoria registra motivo do estorno;
- notificação nasce do evento de domínio.

### Regra preservada

O teste roda apenas no Firestore Emulator.

Nenhum dado de produção é acessado.

## Subfase 11.8 — Teste de integração de cancelamento de compra e recomposição de limite

### Status

Concluída como teste de integração do cancelamento de compra no cartão.

### Arquivo criado

- `functions/src/creditCards/__tests__/cancelPurchase.integration.test.ts`

### Arquivo alterado

- `functions/src/creditCards/cancelPurchase.ts`, apenas se `executeCancelCreditCardPurchase` ainda não estivesse exportado.

### Objetivo

Validar que o cancelamento de compra no cartão atualiza corretamente o domínio financeiro no Firestore Emulator.

### Fluxo validado

- criação de compra;
- consumo inicial de limite;
- cancelamento da compra;
- atualização da compra para `cancelled`;
- cancelamento das parcelas;
- ajuste das faturas afetadas;
- ajuste de `invoice_views`;
- recomposição do limite;
- criação de ledger de recomposição;
- criação de evento financeiro;
- criação de audit log.

### Consistências validadas

- compra cancelada não permanece ativa;
- todas as parcelas da compra ficam canceladas;
- faturas afetadas são zeradas/canceladas quando ficam sem itens;
- limite usado volta para zero;
- limite disponível volta ao limite total;
- ledger registra recomposição;
- evento financeiro registra `actorId`;
- auditoria registra motivo e política;
- cancelamento não cria transação de caixa.

### Regra preservada

O teste roda apenas no Firestore Emulator.

Nenhum dado de produção é acessado.

## Subfase 11.9 — Teste de integração de rebuild de projeções e consistência pós-reconciliação

### Status

Concluída como teste de integração de reconstrução de faturas e projeções.

### Arquivo criado

- `functions/src/creditCards/__tests__/rebuildInvoices.integration.test.ts`

### Arquivo alterado

- `functions/src/creditCards/rebuildInvoices.ts`, apenas se `executeRebuildCardInvoicesForCard` ainda não estivesse exportado.

### Objetivo

Validar que o rebuild de faturas corrige projeções inconsistentes sem acessar produção.

### Fluxo validado

- criação de compra;
- geração inicial de parcelas e faturas;
- simulação de inconsistência em parcela;
- simulação de inconsistência em fatura;
- simulação de fatura obsoleta;
- execução de rebuild;
- correção da parcela;
- reconstrução de faturas válidas;
- cancelamento de fatura obsoleta;
- correção de `invoice_views`;
- criação de evento financeiro;
- criação de audit log;
- criação de notificação.

### Consistências validadas

- parcelas voltam ao `invoiceId` correto;
- parcelas projetadas voltam para `invoiced`;
- faturas reconstruídas refletem a soma real das parcelas;
- faturas obsoletas são canceladas;
- `invoice_views` acompanha o estado das faturas;
- evento financeiro registra reconciliação;
- auditoria registra motivo;
- notificação nasce do evento de domínio.

### Regra preservada

O teste roda apenas no Firestore Emulator.

Nenhum dado de produção é acessado.

## Subfase 11.10 — Observabilidade mínima com métricas por workspace

### Status

Concluída como primeira camada de métricas operacionais do domínio de cartão.

### Arquivo criado

- `functions/src/creditCards/observability.ts`

### Arquivos alterados

- `functions/src/creditCards/adminPaths.ts`
- `functions/src/creditCards/createPurchase.ts`
- `functions/src/creditCards/cancelPurchase.ts`
- `functions/src/creditCards/registerInvoicePayment.ts`
- `functions/src/creditCards/reverseInvoicePayment.ts`
- `functions/src/creditCards/recalculateCardLimit.ts`
- `functions/src/creditCards/rebuildInvoices.ts`
- `firestore.rules`

### Objetivo

Criar uma camada mínima de observabilidade por workspace para operações críticas do domínio de cartão.

### Coleção criada

- `workspaces/{workspaceId}/credit_card_operational_metrics`

### Métricas registradas

Por data, operação e status:

- quantidade de operações;
- valor total quando aplicável;
- último usuário responsável;
- último cartão afetado;
- última fatura afetada;
- última compra afetada;
- último pagamento afetado;
- último `correlationId`;
- última `idempotencyKey`.

### Operações cobertas

- criação de compra;
- cancelamento de compra;
- pagamento de fatura;
- estorno de pagamento;
- rebuild de faturas;
- recálculo de limite.

### Segurança

- cliente não pode criar, editar ou excluir métricas;
- leitura das métricas fica restrita a `owner/admin`;
- métricas são gravadas pelo backend dentro da mesma transação da operação crítica.

### Regra preservada

As métricas não são fonte de verdade financeira.

A fonte de verdade continua sendo:

- compras;
- parcelas;
- faturas;
- pagamentos;
- ledger;
- snapshots;
- eventos financeiros;
- audit logs.

### Próxima subfase

`Subfase 11.11 — Testes de integração para validar métricas operacionais`

## Subfase 11.11 — Testes de integração para validar métricas operacionais

### Status

Concluída como cobertura de integração da observabilidade mínima do domínio de cartão.

### Arquivo criado

- `functions/src/creditCards/__tests__/operationalMetrics.integration.test.ts`

### Arquivo alterado

- `functions/src/creditCards/testSupport/emulatorFirestore.ts`

### Objetivo

Validar que operações críticas do domínio de cartão gravam métricas agregadas por workspace no Firestore Emulator.

### Fluxo validado

- criação de compra;
- pagamento de fatura;
- estorno de pagamento;
- cancelamento de compra;
- rebuild de faturas.

### Métricas validadas

- `purchase_created`;
- `invoice_payment_posted`;
- `invoice_payment_reversed`;
- `purchase_cancelled`;
- `card_invoices_rebuilt`.

### Consistências validadas

- métricas são gravadas no workspace correto;
- métricas usam domínio `credit_card`;
- contadores são incrementados corretamente;
- valores financeiros são somados em `amountTotal` quando aplicável;
- últimos vínculos operacionais são preservados;
- `lastActorId` é registrado;
- `lastCorrelationId` é registrado;
- `lastIdempotencyKey` é registrado.

### Regra preservada

As métricas não são fonte de verdade financeira.

A fonte de verdade continua sendo o domínio oficial:

- compras;
- parcelas;
- faturas;
- pagamentos;
- ledger;
- snapshots;
- eventos financeiros;
- audit logs.

O teste roda apenas no Firestore Emulator.

cd /workspaces/minhas-financas/functions
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=minhas-financas-local npm run test:integration

## Subfase 11.13 — Base E2E para fluxos principais do cartão

### Status

Concluída como infraestrutura inicial de testes E2E.

### Arquivos criados

- `playwright.config.ts`
- `e2e/app-smoke.spec.ts`
- `e2e/credit-card-flow.spec.ts`

### Arquivo alterado

- `package.json`

### Objetivo

Criar a base de testes E2E para validar fluxos reais do usuário antes do rollout.

### Cobertura implementada nesta subfase

- inicialização do Playwright;
- execução contra app Vite local;
- smoke test de carregamento da aplicação;
- estrutura inicial para fluxos E2E do cartão.

### Fluxos reservados para próximas subfases

- compra à vista no cartão;
- compra parcelada;
- pagamento total;
- pagamento parcial;
- estorno;
- migração de legado.

### Regra preservada

Esta subfase não altera regra financeira, backend, Firestore Rules ou layout da aplicação.

Ela apenas adiciona infraestrutura de qualidade para validar a UI real.

## Subfase 11.14 — Base E2E autenticada com Firebase Emulators

### Status

Concluída como base autenticada para testes E2E reais.

### Arquivos alterados

- `src/lib/firebase.ts`
- `src/contexts/AuthContext.tsx`
- `src/components/auth/LoginView.tsx`
- `playwright.config.ts`

### Arquivo criado

- `e2e/authenticated-smoke.spec.ts`

### Objetivo

Permitir testes E2E autenticados sem usar produção, conectando o frontend aos Firebase Emulators.

### Comportamento implementado

- frontend conecta em Auth Emulator, Firestore Emulator e Functions Emulator quando `VITE_USE_FIREBASE_EMULATORS=true`;
- login E2E por e-mail/senha fica disponível apenas quando `VITE_E2E_MODE=true`;
- teste E2E autentica usuário de teste;
- aplicação logada deve carregar a navegação principal.

### Segurança

O login E2E não aparece em produção.

O botão só é renderizado quando a aplicação é iniciada com `VITE_E2E_MODE=true`.

### Próxima subfase

`Subfase 11.15 — E2E de compra à vista e compra parcelada no cartão`