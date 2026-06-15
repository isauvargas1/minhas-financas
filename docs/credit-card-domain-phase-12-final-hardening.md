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

## Subfase 12.7 — Testes de RBAC, replay e concorrência

### Status

Concluída como cobertura automatizada de segurança, idempotência e concorrência do domínio de cartão.

### Arquivos alterados

- `functions/src/creditCards/__tests__/rbac.integration.test.ts`

### Arquivos criados

- `functions/src/creditCards/__tests__/idempotencyReplay.integration.test.ts`
- `functions/src/creditCards/__tests__/concurrency.integration.test.ts`

### Arquivo revisado sem alteração

- `functions/src/creditCards/testSupport/emulatorFirestore.ts`

### Objetivo

Cobrir automaticamente a parte mais sensível da Fase 10: múltiplos usuários, operações repetidas e concorrência em operações financeiras críticas.

### Cenários cobertos

- `member` tentando pagar fatura;
- `member` tentando cancelar compra;
- `member` tentando executar rebuild de faturas;
- usuário fora do workspace tentando criar compra;
- usuário fora do workspace tentando pagar fatura;
- mesma `idempotencyKey` com mesmo payload;
- mesma `idempotencyKey` com payload diferente;
- dois pagamentos simultâneos na mesma fatura;
- dois estornos simultâneos no mesmo pagamento;
- cancelamento de compra com fatura paga.

### Critério de aceite

A subfase é aprovada quando:

- operações não autorizadas são bloqueadas;
- operações duplicadas não duplicam efeitos financeiros;
- replay incompatível é bloqueado;
- concorrência preserva fatura, limite, ledger e caixa;
- `npm run build` passa;
- `npm run test:integration` passa no Firestore Emulator.

## Subfase 12.8 — Testes de edição, fechamento e recálculo

### Status

Concluída como cobertura automatizada dos casos de uso de edição, fechamento, reabertura e recálculo do domínio de cartão.

### Arquivos alterados

- `functions/src/creditCards/updatePurchase.ts`
- `functions/src/creditCards/closeInvoice.ts`
- `functions/src/creditCards/reopenInvoice.ts`

### Arquivos criados

- `functions/src/creditCards/__tests__/updatePurchase.integration.test.ts`
- `functions/src/creditCards/__tests__/closeReopenInvoice.integration.test.ts`
- `functions/src/creditCards/__tests__/recalculateLimit.integration.test.ts`

### Objetivo

Completar a cobertura dos casos de uso obrigatórios da camada de aplicação do domínio de cartão.

### Cenários cobertos

- edição de compra aberta;
- bloqueio de edição quando a fatura afetada já possui pagamento;
- fechamento de fatura sem baixa de caixa;
- reabertura de fatura fechada sem pagamento;
- recálculo de limite a partir do ledger;
- validação de `financial_events`;
- validação de audit logs;
- validação de métricas operacionais.

### Observação sobre edição de fatura fechada

O código atual de `updateCreditCardPurchase` adota uma política conservadora e bloqueia qualquer edição quando uma fatura afetada não está `open`.

Portanto, a edição de compra afetando fatura fechada sob política permitida não foi implementada nesta subfase, porque não existe policy de edição no contrato atual do payload.

Essa capacidade deve ser tratada em uma subfase própria caso a regra de negócio seja confirmada.

### Critério de aceite

A subfase é aprovada quando:

- todos os testes de integração passam no Firestore Emulator;
- estado financeiro permanece consistente após edição, fechamento, reabertura e recálculo;
- fechamento de fatura não cria transação de caixa;
- reabertura de fatura não cria transação de caixa;
- recálculo corrige snapshot de limite com base no ledger;
- eventos, auditoria e métricas são registrados.

## Subfase 12.9 — Escalabilidade dos relatórios e leituras do domínio

### Status

Concluída como filtro por período e fallback de truncamento para leituras do domínio de cartão nos relatórios.

### Estratégia adotada

A estratégia aplicada foi filtro por range do relatório, com limites superiores controlados e alerta de possível truncamento.

Não foram implementados snapshots mensais materializados nesta subfase.

### Arquivos alterados

- `src/modules/reports/types.ts`
- `src/modules/reports/logic.ts`
- `src/modules/credit-cards/persistence/readApi.ts`
- `src/modules/reports/hooks.ts`
- `src/modules/reports/api.ts`

### Arquivos revisados sem alteração

- `firestore.indexes.json`

### Arquivos não criados nesta subfase

- `functions/src/creditCards/reportSnapshots.ts`

### Comportamento implementado

- leituras de compras usam filtro por `purchaseDate`;
- leituras de faturas usam filtro por `dueDate`;
- leituras de parcelas usam filtro por `dueDate`;
- leituras de pagamentos usam filtro por `paymentDate`;
- a query do domínio de cartão passa a depender do período selecionado no relatório;
- os limites fixos antigos foram substituídos por limites superiores controlados;
- quando uma coleção atinge o limite configurado, o snapshot gera alerta de possível truncamento;
- o usuário é orientado a filtrar um período menor quando houver risco de relatório incompleto.

### Critério de aceite

A subfase é aprovada quando:

- relatórios não carregam indefinidamente todas as compras;
- dados de cartão são filtrados por período;
- workspaces grandes não são truncados silenciosamente;
- `npm run build` passa;
- a UI exibe alerta quando alguma coleção atinge o limite configurado.

### Observação sobre snapshots

Snapshots mensais materializados continuam recomendados antes de operação SaaS comercial em larga escala, mas não foram implementados agora para evitar uma nova camada de agregação antes da homologação ampla.

## Subfase 12.10 — Limpeza técnica e documentação final

### Status

Concluída como consolidação operacional de scripts, documentação, comandos oficiais, emuladores, deploy seguro, rollback e matrizes do domínio de cartão.

### Arquivos alterados

- `package.json`
- `functions/package.json`
- `README.md`
- `docs/credit-card-domain-phase-10-security-governance.md`
- `docs/credit-card-domain-phase-12-final-hardening.md`

### Objetivo

Remover ruídos e consolidar documentação técnica para que um novo desenvolvedor consiga instalar, rodar, testar e preparar deploy sem depender de conhecimento informal da conversa.

### Ajustes aplicados

- scripts E2E removidos de `functions/package.json`;
- E2E mantido apenas no `package.json` da raiz;
- comandos oficiais de frontend documentados;
- comandos oficiais de Cloud Functions documentados;
- comandos de Firestore Emulator documentados;
- comando de teste de integração com variáveis de emulador documentado;
- deploy seguro documentado;
- rollback por commit/tag documentado;
- matriz de permissões do domínio de cartão consolidada;
- matriz de coleções do domínio de cartão consolidada;
- README antigo do AI Studio substituído por documentação operacional real do projeto.

### Decisões técnicas

O E2E pertence à raiz porque valida a aplicação completa, usa `playwright.config.ts`, diretório `e2e/` e servidor Vite.

A pasta `functions` mantém apenas scripts de backend:

- build;
- testes unitários;
- testes de integração;
- shell;
- emulador de Functions;
- deploy de Functions;
- logs.

### Checklist final da subfase

- `functions/package.json` não possui scripts E2E;
- `package.json` da raiz mantém E2E;
- README documenta instalação;
- README documenta variáveis de ambiente;
- README documenta build frontend;
- README documenta build backend;
- README documenta Firestore Emulator;
- README documenta testes unitários;
- README documenta testes de integração;
- README documenta E2E;
- README documenta deploy seguro;
- README documenta rollback;
- Fase 10 deixa de estar vazia;
- Fase 10 documenta matriz de permissões;
- Fase 10 documenta matriz de coleções;
- Fase 12 registra a limpeza técnica.

### Critério de aceite

A subfase é aprovada quando:

- `npm run build` passa;
- `npm run functions:build` passa;
- `npm run functions:test:unit` passa;
- com Firestore Emulator aberto, `npm run functions:test:integration:emulator` passa;
- scripts E2E existem somente na raiz;
- novo desenvolvedor consegue identificar claramente comandos de frontend, backend, testes, emuladores, deploy e rollback.

## Subfase 12.11 — E2E final antes de produção

### Status

Concluída como retomada do E2E final do domínio de cartão, usando Firebase Emulators e bloqueando uso de produção.

### Arquivos alterados

- `playwright.config.ts`
- `e2e/credit-card-flow.spec.ts`
- `e2e/authenticated-smoke.spec.ts`
- `src/components/auth/LoginView.tsx`
- `docs/credit-card-domain-phase-12-final-hardening.md`

### Arquivos revisados sem alteração

- `src/lib/firebase.ts`
- `src/contexts/AuthContext.tsx`

### Objetivo

Validar o fluxo real do usuário antes de produção, cobrindo operações de cartão via UI, Firebase Auth Emulator, Firestore Emulator e Functions Emulator.

### Fluxos cobertos

- autenticação E2E com emuladores;
- criação de cartão pelo frontend;
- compra à vista no cartão;
- compra parcelada no cartão;
- cancelamento de compra;
- pagamento total de fatura;
- pagamento parcial de fatura;
- estorno de pagamento;
- ação administrativa bloqueada para `member`;
- ação administrativa visível para `admin`;
- relatório exibindo dados de cartão;
- compra no cartão não contabilizada como saída imediata no caixa;
- fatura exibida na tela principal do cartão.

### Segurança de ambiente

O Playwright injeta:

- `VITE_E2E_MODE=true`;
- `VITE_USE_FIREBASE_EMULATORS=true`;
- `VITE_FIREBASE_PROJECT_ID=minhas-financas-local`.

Os testes usam o Firebase Admin SDK apontando para:

- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`;
- `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`.

Nenhum teste E2E deve usar dados de produção.

### Critério de aceite

A subfase é aprovada quando:

- `npm run test:e2e` inicia Auth, Firestore, Functions e Vite;
- nenhum teste depende de produção;
- fluxos principais passam;
- E2E passa a ser bloqueador do rollout final;
- falhas de E2E impedem deploy de produção.