# Fase 12 — Fechamento das Lacunas do Domínio de Cartão

## Status

Fase 12 iniciada.

## Subfase 12.1 — Correção crítica de RBAC nas operações sensíveis

### Status

Concluída como correção de segurança para operações críticas.

### Arquivos alterados

- `functions/src/creditCards/writeStrategy.ts`
- `functions/src/creditCards/testSupport/emulatorFirestore.ts`

### Arquivo criado

- `functions/src/creditCards/__tests__/rbac.integration.test.ts`

### Objetivo

Corrigir permissões do domínio de cartão para impedir que usuários com papel `member` executem operações financeiras críticas.

### Ajustes aplicados

- `cancelCreditCardPurchase` passa a exigir `owner` ou `admin`;
- `registerCreditCardInvoicePayment` passa a exigir `owner` ou `admin`;
- `member` continua autorizado a criar compra no cartão;
- teste de integração valida bloqueios por papel;
- teste de integração valida usuário fora do workspace.

### Critério de aceite

A subfase é aprovada quando:

- `member` consegue criar compra;
- `member` não consegue pagar fatura;
- `member` não consegue cancelar compra;
- `member` não consegue estornar pagamento;
- `member` não consegue fechar fatura;
- `member` não consegue reabrir fatura;
- `member` não consegue recalcular limite;
- `member` não consegue executar rebuild;
- `owner/admin` continuam autorizados;
- usuário fora do workspace é bloqueado;
- `npm run test:integration` passa no Firestore Emulator.

## Subfase 12.2 — Pagamento parcial real na UI

### Status

Concluída como exposição do pagamento parcial de fatura na interface.

### Arquivo alterado

- `src/components/CreditCardsView.tsx`

### Objetivo

Permitir que o usuário registre pagamento parcial de fatura pela UI, usando o backend oficial do domínio de cartão.

### Comportamento implementado

- pagamento total continua disponível como atalho;
- pagamento parcial passa a ter ação explícita;
- usuário informa valor a pagar;
- usuário informa data do pagamento;
- usuário informa método de pagamento;
- valor precisa ser maior que zero;
- valor não pode ultrapassar o saldo da fatura;
- confirmação clara é exibida antes de executar;
- duplo clique continua protegido pela trava local de operação crítica.

### Regra preservada

A UI não calcula o estado oficial da fatura.

A UI apenas envia `amount`, `paymentDate` e `paymentMethod` para a Cloud Function.

O backend continua responsável por:

- baixar caixa;
- atualizar `paidAmount`;
- atualizar `remainingAmount`;
- definir status da fatura;
- recompor limite proporcionalmente;
- registrar ledger;
- registrar evento financeiro;
- registrar auditoria;
- registrar métricas.

### Critério de aceite

A subfase é aprovada quando:

- usuário consegue pagar parte da fatura pela UI;
- fatura fica `partial_paid`;
- saldo restante aparece corretamente;
- limite recompõe apenas no valor pago;
- caixa baixa apenas o valor pago;
- pagamento total continua funcionando;
- duplo clique não gera chamada duplicada;
- `npm run build` passa.

## Subfase 12.3 — Robustez do formulário de cartão sem visual

### Status

Concluída como correção de compatibilidade para cartões antigos ou criados por scripts sem o campo `visual`.

### Arquivos alterados

- `src/modules/credit-cards/domain/types.ts`
- `src/types.ts`
- `src/components/CreditCardForm.tsx`
- `src/components/CreditCard3D.tsx`

### Objetivo

Evitar quebra ao exibir ou editar cartões que não possuam metadados visuais.

### Comportamento implementado

- `CreditCardVisual` passa a ser um tipo explícito do domínio;
- `CreditCard.visual` passa a ser opcional no frontend;
- o formulário aplica visual padrão quando `cardToEdit.visual` não existe;
- o card visual também aplica fallback antes de renderizar;
- cartões novos continuam sendo salvos com visual padrão;
- cartões antigos sem visual podem ser abertos e editados normalmente.

### Critério de aceite

A subfase é aprovada quando:

- cartão antigo sem `visual` aparece na lista sem quebrar a tela;
- cartão antigo sem `visual` abre no formulário de edição;
- edição preserva dados existentes;
- novo cartão continua com visual padrão;
- `npm run build` passa.

## Subfase 12.4 — Ações administrativas restritas na tela do cartão/fatura

### Status

Concluída como exposição controlada de ações administrativas do domínio de cartão.

### Arquivos criados

- `src/modules/credit-cards/persistence/callableApi.ts`

### Arquivos alterados

- `src/modules/credit-cards/domain/types.ts`
- `src/modules/credit-cards/persistence/firestorePaths.ts`
- `src/modules/credit-cards/persistence/readApi.ts`
- `src/modules/credit-cards/hooks.ts`
- `src/contexts/WorkspaceContext.tsx`
- `src/components/CreditCardsView.tsx`

### Objetivo

Expor ações administrativas já existentes no backend somente para usuários `owner` e `admin`.

### Ações expostas

- fechar fatura;
- reabrir fatura;
- cancelar compra;
- recalcular limite;
- executar rebuild de faturas;
- visualizar audit logs;
- visualizar métricas operacionais.

### Regras aplicadas

- `member` não vê ações administrativas;
- ações críticas pedem confirmação ou motivo;
- fechamento, reabertura, cancelamento, recálculo e rebuild chamam Cloud Functions;
- frontend não escreve diretamente em fatura, compra, limite, ledger, eventos, auditoria ou métricas;
- audit logs e métricas são apenas leitura administrativa protegida por Firestore Rules.

### Critério de aceite

A subfase é aprovada quando:

- `owner/admin` visualizam ações administrativas;
- `member` não visualiza ações administrativas;
- ações administrativas exigem confirmação ou motivo;
- Cloud Functions continuam gerando eventos, auditoria, notificações e métricas;
- `npm run build` passa.

## Subfase 12.5 — Migração legada formal

### Status

Dispensada para o rollout inicial.

### Decisão

A implementação de `migrateLegacyInstallmentsToInvoiceDomain` não será feita neste momento porque o sistema ainda está em desenvolvimento, não possui usuários reais e os dados existentes são dados de teste que serão apagados antes do uso em produção.

### Justificativa

A migração legada só é necessária quando existem transações parceladas antigas em `transactions` que precisam ser preservadas e convertidas para o novo domínio oficial de cartão.

Como a produção começará com base limpa, implementar uma migração agora adicionaria complexidade sem benefício imediato.

### Regra preservada

A decisão não altera a arquitetura do domínio de cartão.

O novo domínio continua sendo a fonte oficial para:

- compras no cartão;
- parcelas;
- faturas;
- pagamentos;
- ledger de limite;
- eventos;
- auditoria;
- métricas.

### Condição para reativar esta subfase

Esta subfase volta a ser obrigatória se ocorrer qualquer uma das situações abaixo:

- houver usuários reais usando o modelo antigo;
- houver dados antigos de `transactions` parceladas que precisem ser preservados;
- for criada uma rotina de importação de dados externos;
- for necessário migrar uma base de produção ou homologação com histórico financeiro real;
- o sistema passar a aceitar onboarding de usuários vindos de versões anteriores.

### Critério de aceite para rollout inicial

A subfase é considerada resolvida para o rollout inicial quando:

- a base de produção começar limpa;
- dados de teste forem removidos antes da liberação;
- novas compras no cartão forem criadas apenas pelo novo domínio;
- relatórios não dependerem de dados legados;
- não existir necessidade de converter `transactions` antigas em faturas.

## Subfase 12.6 — Métricas e eventos de falha

### Status

Concluída como observabilidade de falhas em operações críticas do domínio de cartão.

### Arquivos alterados

- `functions/src/creditCards/observability.ts`
- `functions/src/creditCards/callables.ts`

### Arquivo criado

- `functions/src/creditCards/__tests__/failureObservability.integration.test.ts`

### Objetivo

Registrar falhas controladas de operações críticas do domínio de cartão, preservando rastreabilidade por workspace, operação, usuário, correlação e idempotência.

### Comportamento implementado

- falhas em callables críticas registram métrica operacional com `status: failure`;
- falhas com `workspaceId` rastreável geram `financial_event` do tipo `processing_failure`;
- falhas com `workspaceId` rastreável geram notificação de erro via evento de domínio;
- falhas sem `workspaceId` não tentam gravar Firestore e são registradas em log estruturado;
- falha na própria observabilidade não interrompe a conversão do erro original para `HttpsError`.

### Operações cobertas

- criação de compra;
- edição de compra;
- cancelamento de compra;
- fechamento de fatura;
- reabertura de fatura;
- pagamento de fatura;
- estorno de pagamento;
- recálculo de limite;
- rebuild de faturas.

### Dados registrados

- `workspaceId`;
- operação;
- status `failure`;
- `actorId`;
- `cardId`;
- `invoiceId`;
- `purchaseId`;
- `paymentId`;
- `amount`, quando aplicável;
- `correlationId`;
- `idempotencyKey`;
- código da falha;
- mensagem segura da falha.

### Critério de aceite

A subfase é aprovada quando:

- falha controlada gera métrica `failure`;
- falha relevante gera `financial_event` `processing_failure`;
- falha relevante gera notificação de erro;
- `correlationId` e `idempotencyKey` são preservados;
- nenhum detalhe sensível é exposto ao frontend;
- `npm run build` passa;
- `npm run test:integration` passa no Firestore Emulator.