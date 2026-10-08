# Prontidão da plataforma Firebase/GCP

Este documento detalha o estado e o alvo da plataforma Firebase/Google Cloud do Minhas Finanças: ambientes, inventário de Functions, App Check, Rules e índices (do ponto de vista de deploy), TTL, IAM, segredos, Authentication, Hosting, custos, monitoramento de plataforma e Emulator. No fim está o registro de configuração externa. Baseline auditada: `main` @ HEAD `9c3ab46`. As lacunas usam os IDs do [plano mestre](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers). O gate do tema é a skill `firebase-production-readiness` (checklist em `.agents/skills/firebase-production-readiness/references/firebase-production-checklist.md`). Os milestones fecham com `regression-release-gate`.

> **Regra de operação.** Nenhum agente acessa o projeto `sistema-financeiro-pesso-20698` (CLAUDE.md). As verificações do §16 são feitas por uma pessoa autorizada, somente leitura. Até o fechamento de P6, nenhum artefato de P1–P5 é implantado em projeto remoto (D-ORD-04). Toda validação acontece no Emulator.

Rótulos: **CURRENT** (existe no HEAD, com evidência), **TARGET** (alvo exigido), **GAP** (lacuna com ID), **DECISION** (escolha pendente), **EXTERNAL CONFIGURATION REQUIRED** (fora do repositório, estado `NÃO VERIFICADO` até haver registro).

---

## 1. Visão geral

| Tema | Estado resumido | Classificação | GAP | Milestone |
| --- | --- | --- | --- | --- |
| Ambientes | Um único projeto, que serve de desenvolvimento e é o alvo fixo de todo deploy | CURRENT | PR-PLAT-01 | P6 |
| Runtime das Functions | 47 endpoints em `southamerica-east1`, com perfis por classe e teste de contrato | CURRENT | FIRE-09 (MEDIUM) | P6 |
| App Check | Inexistente em todas as camadas | CURRENT | PR-APPCHK-01 | P6 |
| Deploy de Rules/índices | Gate de Emulator só em `deploy:firestore`/`deploy:safe`; alvo fixo em produção | CURRENT | PR-PLAT-01, PR-REL-01 | P6 |
| TTL | `expiresAt` gravado pelo código; 12 políticas versionadas em `firestore.indexes.json` (falta `activity_logs`, D-18); publicação por ambiente NÃO VERIFICADA (E-07) | CURRENT | FIRE-08, RULES-13 (MEDIUM) | P6 |
| IAM | Nenhuma service account declarada; IAM remoto não verificado | CURRENT | FIRE-09 (MEDIUM) | P6 |
| Segredos | Secret Manager declarado por função; billing sem fallback, falha fechada desde P2A | CURRENT | PR-AI-02; PR-BILL-05 fechado em P2A (PLAN §17.3) | P0 |
| Hosting | Só `Cache-Control`; Google Fonts e sons do Mixkit carregados em runtime. Tailwind compilado no build e importmap `esm.sh` removido em P2C-H2 | CURRENT | PR-PLAT-03, FIRE-07 | P6 |
| Artefato de build | `dist/` compartilhado com o build E2E; login E2E no bundle | CURRENT | PR-AUTH-04 | P6 |
| CD/release | Deploy manual da estação; sem pipeline, proteção de branch ou rollback | CURRENT | PR-REL-01 | P6 |
| Backup/PITR | Nada configurado nem documentado | CURRENT | PR-BKP-01 | P7 |
| Observabilidade de plataforma | `console.*` sem logger estruturado, sem alertas | CURRENT | PR-OBS-01 | P7 |
| Emulator | Projeto `minhas-financas-local`, `singleProjectMode`, CI sem segredos; testes que pulam sem Emulator | CURRENT | FIRE-13, INV-16, REL-09 | P6 |

---

## 2. Ambientes

### 2.1 CURRENT

| Fato | Evidência | Classificação |
| --- | --- | --- |
| `.firebaserc` declara um único alias, `default` = `sistema-financeiro-pesso-20698` | `.firebaserc:1-5` | CURRENT |
| O próprio código trata esse projeto como ambiente de desenvolvimento ("não há alias de staging... o conteúdo é massa de teste") | `tools/investments/limpar-investimentos.mjs:61-67` | CURRENT |
| Os cinco scripts `deploy:*` fixam `--project sistema-financeiro-pesso-20698` | `package.json:22-26` | CURRENT |
| Gate de cada script de deploy: `deploy:firestore` → 6 suítes de Rules no Emulator (`predeploy:rules`); `deploy:functions` → só `verify:fast`; `deploy:safe` → `verify:fast` + integração no Emulator; `deploy:hosting` → só `build`; `deploy:webhook` → só build das Functions | `package.json:20-26` | CURRENT |
| Scripts das Functions sem `--project`, que caem no alias `default` (produção): `serve`, `shell`, `start`, `deploy` e `logs` | `functions/package.json:9-13` | CURRENT |
| O único `predeploy` do `firebase.json` é o build das Functions; o bloco `hosting` não tem `predeploy` | `firebase.json:20-22,25-58` | CURRENT |
| Config web lida só de `VITE_FIREBASE_*` (arquivo local, não versionado), com falha imediata se faltar variável; emuladores ativados por flag de build, sem guarda que impeça um build de produção com `VITE_USE_FIREBASE_EMULATORS`/`VITE_E2E_MODE` | `src/lib/firebase.ts:7-33,47-62` | CURRENT |
| O ensaio `tools/staging/rehearsal.sh` recusa o ID de produção e exige nome com `stag/homolog/dev/test`, mas não existe projeto de staging. Ele chama `deploy:*` com `-- --project`, o que duplica a flag já fixada | `tools/staging/rehearsal.sh:21-41,65,70` | CURRENT |
| O CI não tem job de deploy e não usa segredos | `.github/workflows/quality-gate.yml:7-8,26-165` | CURRENT |
| As proteções do harness (P0) negam `npm run deploy*`, `firebase * deploy*`, `rehearsal.sh`, `functions:log` e as ferramentas MCP do Firebase que escrevem ou apagam. Estão na working tree, ainda sem commit (REL-12) | `.claude/settings.json` (lista `permissions.deny`) | CURRENT |

### 2.2 TARGET

| Ambiente | Projeto | Uso | Deploy | Dados |
| --- | --- | --- | --- | --- |
| Emulator | `minhas-financas-local` (alvo: `demo-minhas-financas`, FIRE-13) | Desenvolvimento, testes, CI | Nenhum | Sintéticos, por seed |
| DEV | Projeto dedicado (D-19) | Integração manual autorizada | CD ou manual autorizado, com alias explícito | Massa de teste descartável |
| STAGING | Projeto dedicado | Ensaio de release, restore, replay de webhook, App Check em modo monitor | Somente CD (environment `staging`) | Sintéticos; nunca cópia de PROD sem anonimização |
| PROD | Projeto dedicado, sem massa de teste (D-19) | Clientes | Somente CD com aprovação humana (environment `production`, E-12) | Reais |

- **TARGET:** `.firebaserc` com aliases `dev`, `staging` e `prod`, sem `default` apontando para PROD. Nenhum ID de projeto fixo em `package.json`, `functions/package.json`, `tools/` ou CI: o alvo chega por variável obrigatória validada contra uma allowlist, com recusa explícita.
- **TARGET:** parâmetros não secretos das Functions por ambiente em `.env.<alias>` (`defineString`/`defineList` para `APP_ALLOWED_ORIGINS` e os Prices `STRIPE_PRICE_PRO_MONTHLY`/`STRIPE_PRICE_BUSINESS_MONTHLY`, hoje guardados como segredo; FIRE-10) e segredos por projeto via `defineSecret` (§8).
- **TARGET:** build do frontend por ambiente, só no CD, com guarda que falha se `VITE_E2E_MODE` ou `VITE_USE_FIREBASE_EMULATORS` estiverem ativos fora do modo de teste, ou se o `projectId` não corresponder ao environment (§10).
- **TARGET:** contas Stripe de teste em DEV/STAGING e live só em PROD (E-06, [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md)).
- **TARGET:** o deploy de PROD depende do `quality-gate` verde e publica uma tag imutável. O rollback republica a tag anterior (ver [RUNBOOKS.md](RUNBOOKS.md)).

### 2.3 GAP e decisões

| ID | Lacuna | Milestone |
| --- | --- | --- |
| PR-PLAT-01 | Sem isolamento DEV/STAGING/PROD; produção é o ambiente de desenvolvimento e o alvo fixo de deploy (origem: FIRE-01, REL-01, REL-03, RULES-14, ENTRY-19) | P6 |
| PR-REL-01 | Sem CD, proteção de branch, versionamento de release ou rollback testado (origem: REL-04, REL-06, REL-13) | P6 |
| PR-AUTH-04 | Login E2E com credenciais fixas no bundle de produção; `dist/` compartilhado com o build E2E (origem: AUTH-13, REL-05) | P6 |
| PR-PLAT-02 | Ferramenta versionada de hard delete do ledger com override para o ID de produção (`tools/investments/limpar-investimentos.mjs:59,88,144-149,352,409`) | P6 |
| REL-12 (MEDIUM) | Negações do harness ainda sem commit; a barreira real deve ser IAM | P6 |

- **DECISION D-19:** o projeto atual vira DEV/STAGING e cria-se um PROD novo, ou o contrário. A auditoria recomenda um PROD novo, sem massa de teste nem funções antigas em `us-central1`.
- **DECISION D-ORD-04 (tomada):** o isolamento fica em P6; até lá, nada de P1–P5 vai para projeto remoto.

---

## 3. Inventário de Functions

### 3.1 Perfis de runtime (CURRENT)

`functions/src/index.ts:11` aplica `setGlobalOptions(GLOBAL_FUNCTION_OPTIONS)` antes dos re-exports (`functions/src/index.ts:14-49`).

| Perfil | Constante | Região | Timeout | Memória | maxInstances | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| G (global) | `GLOBAL_FUNCTION_OPTIONS` | southamerica-east1 | padrão da plataforma | padrão da plataforma | 20 | `functions/src/shared/runtimeOptions.ts:41-44` |
| D (domínio) | `DOMAIN_CALLABLE_OPTIONS` | southamerica-east1 | 60 s | 256 MiB | 20 | `functions/src/shared/runtimeOptions.ts:47-52` |
| H (pesada) | `HEAVY_CALLABLE_OPTIONS` | southamerica-east1 | 540 s | 512 MiB | 3 | `functions/src/shared/runtimeOptions.ts:64-69` |
| IA | `AI_CALLABLE_OPTIONS` | southamerica-east1 | 120 s | 256 MiB | 10 | `functions/src/shared/runtimeOptions.ts:72-77` |
| C (cron) | `SCHEDULED_FUNCTION_OPTIONS` | southamerica-east1 | 540 s | 512 MiB | 1 | `functions/src/shared/runtimeOptions.ts:99-104` |
| WH (webhook) | `STRIPE_WEBHOOK_OPTIONS` | southamerica-east1 | 60 s | 256 MiB | 10 | `functions/src/shared/runtimeOptions.ts:85-90` |
| WI (índice de workspaces) | `WORKSPACE_INDEX_SYNC_OPTIONS` (com `retry: true`) | southamerica-east1 | 120 s | 256 MiB | 5 | `functions/src/shared/runtimeOptions.ts:114-119` |

**CURRENT:** nenhum perfil declara `serviceAccount`, `concurrency`, `cpu`, `minInstances` ou `enforceAppCheck`, e só `WORKSPACE_INDEX_SYNC_OPTIONS` declara `retry` (`functions/src/shared/runtimeOptions.ts:41-119`; FIRE-09).

### 3.2 Endpoints exportados (CURRENT)

`functions/src/index.ts` exporta 62 endpoints na baseline desta tabela (108 endpoints, 101 callables, 4 agendados, 2 gatilhos e 1 webhook, recontados no gate de P4, plano §19.7; P3-J: 87, 80 e 4): 56 callables, 3 crons, 2 gatilhos Firestore e 1 webhook HTTP (a linha 16 da tabela, riscada, não conta; desde a P4-D, as 14 callables de investimentos riscadas saíram do contrato de implantação, 23 → 9, plano §19.4; as linhas 48 a 63 são de P1, P2A e P2B.1). Os wrappers de domínio aplicam o perfil D por padrão: cartões (P4-A) em `functions/src/cards/callables.ts`, metas em `functions/src/goals/callables.ts:44-49` e investimentos em `functions/src/investments/callables.ts`.

| # | Função | Tipo | Definição | Perfil | Segredos | App Check | Retry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `onTransactionWrite` | Gatilho `onDocumentWritten` em `workspaces/{workspaceId}/transactions/{transactionId}` | `functions/src/triggers/transactions.ts:369-411` | G | — | N/A | Sim (P3-B): `retry: true`, 60 s, 256 MiB, 20 instâncias (`functions/src/shared/runtimeOptions.ts:136`), corte por idade em 23 h, coberto pelo contrato de implantação |
| 2 | `createSplitGroupInvite` | Callable | `functions/src/callables/splitGroups.ts:100-101` | D | — | Não | N/A |
| 3 | `acceptSplitGroupInvite` | Callable | `functions/src/callables/splitGroups.ts:177-178` | D | — | Não | N/A |
| 4–12 | ~~`createCreditCardPurchase`, `registerCreditCardInvoicePayment`, `reverseCreditCardInvoicePayment`, `cancelCreditCardPurchase`, `recalculateCardLimit`, `closeCreditCardInvoice`, `reopenCreditCardInvoice`, `rebuildCardInvoicesForCard`, `updateCreditCardPurchase`~~ | Callable | Removidas na P4-A (módulo `functions/src/creditCards/**`). Substituídas pelas 13 callables de `functions/src/cards/callables.ts`: `createCreditCard`, `updateCreditCard`, `archiveCreditCard`, `reactivateCreditCard`, `createCreditCardPurchase`, `updateCreditCardPurchase`, `cancelCreditCardPurchase`, `refundCreditCardPurchase`, `registerInvoicePayment`, `reverseInvoicePayment`, `createCreditCardInvoiceAdjustment`, `recalculateCardLimit`, `rebuildCardInvoicesForCard` (as de reconciliação com perfil pesado) | conferir no contrato de implantação | — | Não | N/A |
| 13 | `createGoal` | Callable | `functions/src/goals/callables.ts:83` | D | — | Não | N/A |
| 14 | `updateGoal` | Callable | `functions/src/goals/callables.ts:89` | D | — | Não | N/A |
| 15 | `archiveGoal` | Callable | `functions/src/goals/callables.ts:95` | D | — | Não | N/A |
| 16 | ~~`seedLegacySettingsCatalog`~~ | Callable | Removido em P1: o provisionamento do workspace é server-side (`functions/src/workspaces/provisioning.ts:155`; PLAN §16) | — | — | — | — |
| 17 | ~~`onboardInvestmentWorkspace`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 18 | ~~`createInvestmentContribution`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 19 | `createSimpleInvestment` | Callable | `functions/src/investments/callables.ts:97` | D | — | Não | N/A |
| 20 | `settleInvestmentContribution` | Callable | `functions/src/investments/callables.ts:105` | D | — | Não | N/A |
| 21 | `withdrawSimpleInvestment` | Callable | `functions/src/investments/callables.ts:113` | D | — | Não | N/A |
| 22 | `settleSimpleWithdrawal` | Callable | `functions/src/investments/callables.ts:121` | D | — | Não | N/A |
| 23 | ~~`createInvestmentRedemption`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 24 | ~~`settleInvestmentRedemption`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 25 | `reverseInvestmentMovement` | Callable | `functions/src/investments/callables.ts:129` | D | — | Não | N/A |
| 26 | `changeInvestmentGoal` | Callable | `functions/src/investments/callables.ts:145` | D | — | Não | N/A |
| 27 | `linkInvestmentToGoal` | Callable | `functions/src/investments/callables.ts:153` | D | — | Não | N/A |
| 28 | `unlinkInvestmentFromGoal` | Callable | `functions/src/investments/callables.ts:161` | D | — | Não | N/A |
| 29 | ~~`recalculateInvestmentPosition`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 30 | ~~`recalculateGoalInvestmentProgress`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 31 | ~~`archiveInvestmentAccount`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 32 | ~~`archiveInvestmentAsset`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 33 | ~~`saveInvestmentAccount`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 34 | ~~`saveInvestmentAsset`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 35 | `cancelInvestmentMovement` | Callable | `functions/src/investments/callables.ts:137` | D | — | Não | N/A |
| 36 | ~~`recordInvestmentValuation`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 37 | ~~`registerInvestmentImportBatch`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 38 | ~~`rebuildInvestmentProjections`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 39 | ~~`backfillInvestmentWorkspace`~~ | Callable | Removida na P4-D (D-15, plano §19.4) | — | — | — | — |
| 40 | `analyzeFinancialQuestion` | Callable | `functions/src/ai/callables.ts:126` | IA | `GOOGLE_AI_API_KEY` (`functions/src/ai/callables.ts:33-38`) | Não | N/A |
| 41 | `extractTransactionFromContent` | Callable | `functions/src/ai/callables.ts:203` | IA | `GOOGLE_AI_API_KEY` | Não | N/A |
| 42 | `createCheckoutSession` | Callable | `functions/src/billing/callables.ts:63-85` | D | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_BUSINESS_MONTHLY`, `APP_ALLOWED_ORIGINS` (`functions/src/billing/config.ts:32-36`) | Não | N/A |
| 43 | `rebuildCashPeriods` | Callable | `functions/src/cash/rebuild.ts:247-248` | H | — | Não | N/A |
| 44 | `processRecurring` | Cron `every day 02:00`, `America/Sao_Paulo` | `functions/src/crons/recurring.ts` (gatilho; a lógica está em `functions/src/recurring/scheduler.ts`, P4-B, plano §19.2) | C | — | N/A | Não declarado. Implantação do cron e dos índices por ambiente isolado: E-01, EXTERNAL CONFIGURATION REQUIRED, NÃO VERIFICADO |
| 45 | `processInvestmentDriftScan` | Cron `every day 06:00`, `America/Sao_Paulo` | `functions/src/crons/investmentDrift.ts:325-330` | C | — | N/A | Não declarado |
| 46 | `processCreditCardInvoiceClosing` (substitui `processCreditCardInvoiceOperationalAlerts`, P4-A) | Cron `every day 00:15`, `America/Sao_Paulo` | `functions/src/cards/closing.ts` | C | — | N/A | Não declarado (cada fatura fecha numa transação idempotente que relê o documento; a execução seguinte retoma o que faltou) |
| 47 | `stripeWebhook` | HTTP `onRequest`, sem CORS | `functions/src/webhooks/stripe.ts:26-29` | WH | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_BUSINESS_MONTHLY` (`functions/src/billing/config.ts:41-45`) | N/A (assinatura Stripe sobre o raw body, `functions/src/billing/webhook.ts:840-861`). Corpo acima de 1 MiB (`MAX_WEBHOOK_BODY_BYTES`) recebe 413 antes da verificação da assinatura, sem calcular o HMAC (`functions/src/billing/webhook.ts:844-849`) | Reentrega do Stripe; deduplicada por `billing_webhook_events/{event.id}` (`functions/src/billing/webhook.ts:473-476`; PR-BILL-06 fechado em P2A) |
| 48 | `bootstrapAccount` | Callable | `functions/src/workspaces/callables.ts:68` | D | — | Não | N/A |
| 49 | `createWorkspace` | Callable | `functions/src/workspaces/callables.ts:76` | D | — | Não | N/A |
| 50 | `updateWorkspaceSettings` | Callable | `functions/src/workspaces/callables.ts:85` | D | — | Não | N/A |
| 51 | `archiveWorkspace` | Callable | `functions/src/workspaces/callables.ts:99` | D | — | Não | N/A |
| 52 | `inviteWorkspaceMember` | Callable | `functions/src/workspaces/callables.ts:116` | D | — | Não | N/A |
| 53 | `acceptWorkspaceInvite` | Callable | `functions/src/workspaces/callables.ts:135` | D | — | Não | N/A |
| 54 | `revokeWorkspaceInvite` | Callable | `functions/src/workspaces/callables.ts:158` | D | — | Não | N/A |
| 55 | `changeWorkspaceMemberRole` | Callable | `functions/src/workspaces/callables.ts:172` | D | — | Não | N/A |
| 56 | `removeWorkspaceMember` | Callable | `functions/src/workspaces/callables.ts:187` | D | — | Não | N/A |
| 57 | `leaveWorkspace` | Callable | `functions/src/workspaces/callables.ts:202` | D | — | Não | N/A |
| 58 | `transferWorkspaceOwnership` | Callable | `functions/src/workspaces/callables.ts:215` | D | — | Não | N/A |
| 59 | `onWorkspaceDisplayChange` | Gatilho `onDocumentUpdated` em `workspaces/{workspaceId}` | `functions/src/workspaces/indexSync.ts:80` | WI | — | N/A | Sim (`retry: true`) |
| 60 | `getBillingCatalog` | Callable | `functions/src/billing/callables.ts:56` | D | — | Não | N/A |
| 61 | `createBillingPortalSession` | Callable | `functions/src/billing/callables.ts:87` | D | `STRIPE_SECRET_KEY`, `APP_ALLOWED_ORIGINS` (`functions/src/billing/config.ts:37-40`) | Não | N/A |
| 62 | `getWorkspaceEntitlement` | Callable | `functions/src/billing/callables.ts:104` | D | — | Não | N/A |
| 63 | `getAccountUsage` | Callable | `functions/src/billing/callables.ts:116` | D | — | Não | N/A |

### 3.3 Contrato de deploy e pacote

- **CURRENT:** `functions/src/shared/deploymentContract.test.ts:63-286` verifica a região de todos os endpoints, timeout e memória de toda callable, fuso e perfil dos 3 crons, o perfil pesado de 5 operações, os segredos declarados por quem lê `process.env`, o perfil das callables de billing e do webhook (P2A), o das callables de P1 e do gatilho `onWorkspaceDisplayChange` (inclusive `retry: true`) e a ausência de 10 callables legadas de investimento.
- **CURRENT:** o contrato cobre do webhook, desde P2A, região, segredos, timeout, memória e `maxInstances` (`functions/src/shared/deploymentContract.test.ts:63-71,139-144,153-172`) e do gatilho `onTransactionWrite` só a região; não cobre timeout e memória desse gatilho, App Check, `serviceAccount` nem concorrência, e o `retry` só do gatilho de índice (FIRE-09). O comentário de `functions/src/shared/runtimeOptions.ts:16-18` confirma que trocar de região cria a função nova e mantém a antiga. As funções antigas em `us-central1` no projeto remoto não estão verificadas (§16, E-01).
- **CURRENT:** os 9 arquivos `functions/src/creditCards/manual*Test.ts` foram removidos na P4-A com o módulo antigo de cartões. `generateInviteCodeForTest` é exportado pelo módulo de produção (`functions/src/callables/splitGroups.ts:42`), embora não seja endpoint. O `ignore` do `firebase.json` não exclui testes (`firebase.json:13-19`) (REL-15, ENTRY-22; remoção prevista em P4 pela §7 do plano).
- **TARGET:** todo endpoint novo de P1–P5 usa um dos perfis acima e entra no contrato. O contrato passa a exigir `enforceAppCheck` nas callables, `retry` com corte por idade em todo gatilho de evento (PR-TX-04, P3), `retryConfig` nos crons, `serviceAccount` dedicada por classe, timeout e memória explícitos no webhook e ausência de `cors` no webhook (ENTRY-21).
- **TARGET:** a contagem e a lista de funções usadas em runbooks vêm do build/contrato, nunca de documento (FIRE-14).

---

## 4. App Check

- **CURRENT:** não há `initializeAppCheck` no cliente (`src/lib/firebase.ts:1-64`), nem `enforceAppCheck` ou `consumeAppCheckToken` nas Functions (`functions/src/shared/runtimeOptions.ts:41-119`; nenhuma ocorrência em `functions/src` e `src`). O único controle anti-abuso é o rate limit por ator: IA com 20/h (análise) e 60/h (extração) por workspace+ator (`functions/src/ai/callables.ts:44-48,167-171`) e checkout com 10/h por usuário (`functions/src/billing/checkout.ts:73-77`).
- **TARGET (P6):**
  1. `initializeAppCheck` com `ReCaptchaEnterpriseProvider` e `isTokenAutoRefreshEnabled` em `src/lib/firebase.ts`, antes de `getFirestore`/`getFunctions`. O debug token vem por variável de ambiente, só no Emulator/E2E, e nunca é versionado.
  2. `enforceAppCheck: true` nos perfis D, H e IA. `consumeAppCheckToken: true` em `analyzeFinancialQuestion`, `extractTransactionFromContent` e `createCheckoutSession`.
  3. Rollout (D-33): métricas em modo monitor em STAGING, enforcement em STAGING e depois em PROD para Functions, Firestore e Authentication (E-02). Rollback: desativar o enforcement no console e registrar no §16.
  4. Asserção no `deploymentContract.test.ts` e E2E funcionando com debug provider.
- **GAP:** PR-APPCHK-01 (origem: FIRE-03, AUTH-14, ENTRY-03). Relacionado: PR-AI-03 (custo de IA sem teto efetivo, P2).
- **DECISION D-33:** rollout do App Check (período de monitoramento, ordem de enforcement em Functions, Firestore e Auth, e critério de rollback), além do provedor (reCAPTCHA Enterprise recomendado) e da lista de callables com proteção contra replay. Bloqueia P6.

---

## 5. Security Rules e índices (plataforma)

A semântica das Rules está em [SECURITY_MODEL.md](SECURITY_MODEL.md); o inventário de índices, em [DATA_MODEL.md](DATA_MODEL.md).

- **CURRENT (P4-E):** `firebase.json:5-6` referencia `firestore.rules` (1.068 linhas; a P4-E removeu os validadores de escrita do catálogo, D-23) e `firestore.indexes.json` (55 índices compostos e 12 `fieldOverrides` de TTL em `expiresAt`; [DATA_MODEL.md](DATA_MODEL.md) §5.1).
- **CURRENT:** o CI executa as 6 suítes de Rules no Emulator em todo push para `main` e em todo PR (`.github/workflows/quality-gate.yml:10-15,109-110`; `package.json:36`).
- **CURRENT:** só `deploy:firestore` e `deploy:safe` exigem as suítes antes de publicar (`package.json:21-22,24`). `firebase deploy` direto e `npm --prefix functions run deploy` não passam por gate nenhum (`functions/package.json:12`).
- **CURRENT:** não há registro de qual commit está implantado em cada ambiente.
- **TARGET:** Rules e índices são publicados só pelo CD, depois do `quality-gate`, primeiro em STAGING (com smoke das consultas compostas) e depois em PROD. Cada ambiente registra o commit/tag publicado. `fieldOverrides` versiona a TTL (§6) e as isenções de indexação de campos volumosos.
- **GAP:** RULES-14 (dentro de PR-PLAT-01, P6); PR-RULES-02 (catch-all de leitura, P6). PR-CC-08 resolvido na P4-A (plano §19.1); PR-RULES-03 resolvido na P4-E (plano §19.6). Versionado não significa publicado: o índice novo só vale depois de implantado em cada ambiente (E-07).

---

## 6. TTL

- **CURRENT:** `functions/src/shared/retention.ts:23-61` define `RETENTION_DAYS`. O campo `expiresAt` é gravado em:

  | Coleção | Ponto de escrita | Prazo | TTL versionado |
  | --- | --- | --- | --- |
  | `idempotency_keys` (callables por ator) | `functions/src/shared/idempotency.ts:95` | 90 dias | Sim (P1) |
  | `investment_idempotency_keys` | `functions/src/investments/infrastructure.ts:232` | 90 dias | Sim (P4-D) |
  | `investment_operational_metrics` | `functions/src/investments/observability.ts:119` | 400 dias | Sim (P4-D) |
  | `investment_event_logs` (só falhas) | `functions/src/investments/observability.ts:237` | 400 dias | Sim (P4-D) |
  | `investment_drift_reports` | `functions/src/crons/investmentDrift.ts:263` | 400 dias | Sim (P4-D) |
  | `rate_limits` (workspace e `users/{uid}`) | `functions/src/shared/rateLimit.ts:173` | 2 dias | Sim (P3-B) |
  | `cash_period_events` | `functions/src/cash/periods.ts:657` | 90 dias | Sim (P3-B) |
  | `billing_webhook_events` | `functions/src/billing/webhook.ts:366` | 90 dias | Sim (P2A) |
  | `ai_usage_receipts` | `functions/src/billing/aiCredits.ts:144` | 90 dias | Sim (P2B.2) |
  | `invites`, `invite_tokens` | `functions/src/workspaces/memberships.ts:237,247` | 7 dias (prazo do convite) | Sim (P1) |
  | `split_invites` | `functions/src/splitBills/participantOperations.ts:287` | 7 dias (prazo do convite) | Sim (P4-C) |
  | `activity_logs` | `functions/src/triggers/transactions.ts:208-210` | 365 dias | **Não** (destino em D-18) |

- **CURRENT (versionado no repositório):** `firestore.indexes.json` declara 12 `fieldOverrides` com `ttl: true` e `indexes: []` em `expiresAt` — todos os grupos da tabela, menos `activity_logs`. Testes conferem parte da lista (`functions/src/cash/__tests__/projection.test.ts`, `functions/src/ai/__tests__/callables.test.ts`, `tests/unit/split-no-client-writes.test.ts`, `functions/src/investments/__tests__/documentContracts.test.ts`). O loop `gcloud` de `docs/investments/TTL_MANIFEST.md:51-70` e as contagens antigas ("sete" grupos em `docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:194`, "seis" em `tools/staging/rehearsal.sh:139-142`) são registros desatualizados (OUTDATED, §13 do plano). As coleções operacionais de metas não gravam `expiresAt` (FIRE-08, GOAL-14); as coleções operacionais antigas de cartões foram removidas na P4-A.
- **CURRENT (P3-B):** o gatilho de caixa roda com `retry: true` (reentrega por até 24 h na 2ª geração) e o comentário de `functions/src/shared/retention.ts:38-49` foi corrigido.
- **NÃO VERIFICADO:** versionado não significa ativo. Nenhuma política foi publicada por agentes; o estado em qualquer projeto é desconhecido (E-07).
- **TARGET (P6):** publicar os `fieldOverrides` versionados junto com os índices em cada ambiente e conferir `ACTIVE`; completar a lista com `activity_logs` se D-18 a mantiver como log operacional. Um teste único compara os `fieldOverrides` com a lista declarada no código. As coleções operacionais de metas passam a gravar `expiresAt` via `RETENTION_DAYS`. Os prazos seguem a D-18 ([DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md)). TTL nunca é ativada em ledger, trilha de auditoria ou fato financeiro.
- **GAP:** FIRE-08, RULES-13 (MEDIUM, P6). A remoção por TTL é definitiva; ver [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md).
- **EXTERNAL CONFIGURATION REQUIRED:** publicação e ativação das políticas de TTL versionadas em cada ambiente (E-07, §16).

---

## 7. IAM e service accounts

- **CURRENT:** nenhuma função declara `serviceAccount` (`functions/src/shared/runtimeOptions.ts:41-119`; `functions/src/webhooks/stripe.ts:26-29`), então todas rodam com a conta padrão do runtime. Os papéis dessa conta, os membros humanos, o MFA e as chaves de service account do projeto não estão verificados (NÃO VERIFICADO). O deploy sai da estação do desenvolvedor, com credencial pessoal (PR-REL-01).
- **TARGET (P6):**
  - Service accounts dedicadas por classe (domínio, pesada, IA, webhook, cron), cada uma só com `roles/datastore.user` e `roles/secretmanager.secretAccessor` nos segredos que usa.
  - A conta padrão do Compute perde o papel Editor.
  - Deploy só pela service account do CD, via Workload Identity Federation, sem chave JSON.
  - Nenhum desenvolvedor ou agente com papel de deploy ou de escrita no Firestore de PROD. Pessoas nomeadas, com MFA, e revisão periódica registrada.
  - Cloud Audit Logs de atividade administrativa ativos; a política de logs de acesso a dados é decidida e registrada.
- **GAP:** FIRE-09 (MEDIUM), PR-REL-01. **EXTERNAL CONFIGURATION REQUIRED:** E-04 (§16).

---

## 8. Secret Manager e parâmetros

| Nome | Consumidores (declaração em `secrets`) | Natureza | Classificação |
| --- | --- | --- | --- |
| `GOOGLE_AI_API_KEY` | `analyzeFinancialQuestion`, `extractTransactionFromContent` (`functions/src/ai/callables.ts:33-38`) | Segredo | CURRENT |
| `STRIPE_SECRET_KEY` | `createCheckoutSession`, `createBillingPortalSession`, `stripeWebhook` (`functions/src/billing/config.ts:32-45`; `functions/src/webhooks/stripe.ts:26-29`) | Segredo | CURRENT |
| `STRIPE_WEBHOOK_SECRET` | `stripeWebhook` (`functions/src/billing/config.ts:41-45`; `functions/src/webhooks/stripe.ts:26-29`) | Segredo | CURRENT |
| `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_BUSINESS_MONTHLY` | `createCheckoutSession`, `stripeWebhook` (`functions/src/billing/config.ts:23-45`) | Configuração por ambiente guardada como segredo (a allowlist plana `STRIPE_ALLOWED_PRICE_IDS` foi removida em P2A) | CURRENT |
| `APP_ALLOWED_ORIGINS` | `createCheckoutSession`, `createBillingPortalSession` (`functions/src/billing/config.ts:32-40`) | Configuração por ambiente guardada como segredo | CURRENT |

- **CURRENT:** `firebase.json:12` desativa o runtime config legado (`disallowLegacyRuntimeConfig: true`). O teste de contrato exige a declaração de cada segredo lido (`functions/src/shared/deploymentContract.test.ts:117-151`).
- **CURRENT:** a chave de IA falha fechada, com mensagem pt-BR (`functions/src/ai/callables.ts:131-141`), e a configuração de billing também falha fechada desde P2A: segredo ausente, vazio ou fora do formato recusa checkout e portal com mensagem pt-BR e faz o webhook responder 500 sem processar, `sk_test_placeholder`/`whsec_placeholder` são recusados pelo comprimento mínimo e `APP_ALLOWED_ORIGINS` vazio recusa (`functions/src/billing/config.ts:72-111,154-158`; `functions/src/webhooks/stripe.ts:38-51`). O webhook não ecoa a mensagem do SDK: assinatura inválida e falha transitória respondem texto fixo (`functions/src/billing/webhook.ts:857-860,892-895`).
- **CURRENT:** o Vite neutraliza `process.env.GEMINI_API_KEY`/`API_KEY` no bundle (`vite.config.ts:13-19`). A chave esteve embutida no bundle no passado e a rotação não está comprovada (PR-AI-02; ação E-00, registrada em [SECURITY_MODEL.md](SECURITY_MODEL.md)).
- **CURRENT:** o checklist antigo usa como evidência `firebase functions:secrets:access <NOME>` (`docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:61`), comando que **imprime o valor** do segredo. Não usar. A verificação é feita só por metadados (§16).
- **TARGET:** `defineSecret` sem fallback para `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` e `GOOGLE_AI_API_KEY`. Segredo ausente responde erro genérico, com log estruturado e alerta. O cliente Stripe é instanciado dentro do handler. `APP_ALLOWED_ORIGINS` e os Prices `STRIPE_PRICE_PRO_MONTHLY`/`STRIPE_PRICE_BUSINESS_MONTHLY` viram parâmetros por ambiente (`defineList`/`defineString`). Desses itens, o Stripe já atende sem fallback, com erro genérico e log estruturado e com o cliente instanciado dentro do handler (P2A, ver acima); restam `defineSecret`, o alerta e os parâmetros por ambiente. Cada projeto tem seus segredos e uma política de rotação com dono. O procedimento está em [RUNBOOKS.md](RUNBOOKS.md).
- **GAP:** PR-AI-02 (P0, externa imediata); FIRE-10 (configuração não secreta guardada como segredo, P6). PR-BILL-05 (origem BILL-06, ENTRY-04, FIRE-10) fechado em P2A (PLAN §17.3). **EXTERNAL CONFIGURATION REQUIRED:** E-05 (§16).

---

## 9. Authentication (plataforma)

A semântica de identidade, sessão e RBAC está em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md).

- **CURRENT:** o código usa só login Google por popup (`src/contexts/AuthContext.tsx:83-91`) e um login e-mail/senha de E2E com credenciais fixas e auto-cadastro, ativo por `VITE_E2E_MODE` (`src/contexts/AuthContext.tsx:94-114`). Não há blocking functions, custom claims, revogação ou triggers de Auth (`functions/src/index.ts:13-37`).
- **CURRENT (NÃO VERIFICADO no console):** provedores habilitados no projeto, domínios autorizados, proteção contra enumeração de e-mail, templates e tela de consentimento OAuth.
- **TARGET:** provedores habilitados iguais aos usados pelo código (D-06); domínios autorizados mínimos por ambiente, sem `localhost` em PROD; proteção contra enumeração ativa; templates pt-BR com domínio próprio (E-11); tela de consentimento OAuth com domínio verificado e URLs de termos e privacidade; MFA para administradores de plataforma (D-06, D-10); chave de API web restrita por referrer e API. Se houver blocking functions ou MFA, upgrade para Identity Platform.
- **GAP:** PR-AUTH-04 (P6). **EXTERNAL CONFIGURATION REQUIRED:** E-03 (§16).

---

## 10. Hosting e artefato

- **CURRENT:** o Hosting serve `dist/` (`firebase.json:26`) com rewrite `**` → `/index.html` (`firebase.json:32-37`). Os headers são só `Cache-Control`: imutável em `/assets/**` e `no-cache` apenas na URL literal `/index.html` (`firebase.json:38-57`). Rotas reescritas recebem o HTML com o cache padrão (FIRE-07).
- **CURRENT:** não há CSP, HSTS, `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` nem `Permissions-Policy` (`firebase.json:38-57`). O `index.html` carrega em runtime Google Fonts (`index.html:8-10`); a entrada única empacotada pelo Vite é `/src/main.tsx` (`index.html:47`). Os sons de interface vêm de `assets.mixkit.co` (`src/contexts/ThemeContext.tsx:28-43`). `lang="pt-BR"` (`index.html:3`). Desde P2C-H2, o CSS é gerado no build: Tailwind 3.4 pelo PostCSS do Vite (`tailwind.config.js`, `postcss.config.js`, `src/index.css`), com a configuração que antes ia no `tailwind.config` global do Play CDN; o script do CDN e o importmap `esm.sh` (sem consumidor no build) saíram do HTML (PLAN §17.11).
- **CURRENT:** `build` e `build:e2e` escrevem no mesmo `dist/` (`package.json:9,27`). O bloco `hosting` não tem `predeploy` (`firebase.json:25-58`), e `deploy:hosting` usa as variáveis locais de quem roda (`package.json:25`). A auditoria encontrou um `dist/` local gerado pelo build E2E (REL-05).
- **TARGET (P6):**
  - Headers em `source: "**"`: `Content-Security-Policy` com `script-src 'self'` mais os domínios necessários de Google Auth, APIs e Stripe, `connect-src` restrito e `frame-ancestors 'none'`; `Strict-Transport-Security` (`max-age` ≥ 31536000; `includeSubDomains`); `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` restritiva; `Cross-Origin-Opener-Policy: same-origin-allow-popups`.
  - `no-cache` em todo HTML; `/assets/**` imutável.
  - Fontes e sons auto-hospedados; entrada única `src/main.tsx` (o `index.tsx` legado ainda existe). Tailwind compilado e remoção do importmap: feitos em P2C-H2, com paridade com o CDN emulado: 46 telas, 0 pixel diferente (D-20; R-04 residual: versão exata do CDN real).
  - Build por ambiente só no CD, `outDir` separado para E2E e guarda de modo (§2.2).
  - Domínio próprio com TLS (E-11). Preview channels nunca apontam para dados de PROD.
- **GAP:** PR-PLAT-03 (origem FIRE-06, AUTH-06, PRIV-09, COMM-07), PR-AUTH-04, FIRE-07 (MEDIUM), REL-11 (MEDIUM). Todos em P6.
- **DECISION:** D-20 executada em P2C-H2 (paridade com o CDN emulado: 46 telas, 0 pixel diferente; R-04 residual). A política de CSP depende do domínio final (E-11).

---

## 11. Cloud Storage

- **CURRENT:** `getStorage` é inicializado e exportado sem uso (`src/lib/firebase.ts:4,39`). O `firebase.json` não tem seção `storage` e não existe `storage.rules` (FIRE-12, LOW).
- **TARGET (P6):** remover a inicialização e o chunk, ou versionar `storage.rules` com deny-all e publicá-las junto com as Rules. `N/A` no gate só com prova de não uso.

---

## 12. Custos, quotas e kill switch

- **CURRENT:** o custo tem teto só por `maxInstances` (§3.1) e por rate limits de IA, checkout e rebuild de caixa (`functions/src/ai/callables.ts:44-48,167-171`; `functions/src/billing/checkout.ts:73-77`; `functions/src/cash/rebuild.ts:256-262`). Não há registro versionado de budget nem de alertas de custo. Não há kill switch para desligar uma funcionalidade sem deploy (GAP PR-OBS-02, P7). A IA usa um modelo preview (`functions/src/ai/callables.ts:121`; FIRE-11), e a quota do Gemini não está verificada.
- **TARGET:** budget por projeto com alertas de 50/90/100% (E-08); chave do Gemini restrita à API e com quota (E-05, E-10); quota de IA por plano no servidor (PR-AI-03, P2); kill switch implementado conforme PR-OBS-02 (P7) e documentado em [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md); modelo e provedor de IA de produção conforme D-11.

---

## 13. Monitoramento de plataforma

- **CURRENT:** não há `firebase-functions/logger` em `functions/src`. Os erros internos convertidos em `HttpsError` não chegam ao Cloud Logging. Não há Error Reporting configurado, uptime check nem alertas versionados (PR-OBS-01; detalhes em [OBSERVABILITY.md](OBSERVABILITY.md)).
- **TARGET (P7):** retenção do Cloud Logging definida (e sink com lock, se exigido); Error Reporting e Cloud Monitoring habilitados; políticas de alerta e canais registrados em [OBSERVABILITY.md](OBSERVABILITY.md), conforme a stack e os limiares decididos em D-28. Este documento registra só a existência da plataforma (E-08, §16).

---

## 14. Backup, PITR e restore

Estado, alvo, RPO/RTO (DECISION D-27) e runbook de restore estão em [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md). Resumo: **CURRENT** nada configurado nem documentado (`firebase.json:2-7`); **GAP** PR-BKP-01 (P7); **EXTERNAL CONFIGURATION REQUIRED** E-07.

---

## 15. Emulator

- **CURRENT:** `firebase.json:59-78` declara os emuladores de Auth (9099), Firestore (8080), Functions (5001) e UI (4000), com `singleProjectMode: true`. Os scripts de teste usam `--project minhas-financas-local` (`package.json:16-19,21,36`), e o E2E sobe os emuladores com o mesmo projeto (`playwright.config.ts:66-89`).
- **CURRENT:** as suítes de Rules e a guarda da ferramenta destrutiva lançam erro sem `FIRESTORE_EMULATOR_HOST` (`tests/firestore/adjacent-modules.rules.integration.test.mjs:42-44`; `tests/tools/limpar-investimentos.guard.test.mjs:24-25`). Há testes de integração das Functions que **pulam em silêncio** sem Emulator (`functions/src/crons/__tests__/investmentDrift.integration.test.ts:103-105`). `goalProgressRebuild.integration.test.ts` não tem guarda e faz `recursiveDelete` no projeto indicado por `GCLOUD_PROJECT` (`functions/src/investments/__tests__/goalProgressRebuild.integration.test.ts:28,35-38,53`). O script `functions:test:integration` roda sem Emulator (`package.json:15`).
- **CURRENT:** o CI instala `firebase-tools@latest`, sem versão fixa (`.github/workflows/quality-gate.yml:100-101,138-139`), e Java 17 (`.github/workflows/quality-gate.yml:89-92`).
- **CURRENT (P2C-H2, PLAN §17.11):**
  - A integração das Functions roda um arquivo por vez no Emulator único (`functions/package.json`, `test:integration` com `--test-concurrency=1`, preso no contrato de deploy). Com arquivos em paralelo, a contenção de lock entre eles aciona um defeito do `BulkWriter` do SDK `@google-cloud/firestore` 7.11.6: a operação reenfileirada depois de `ABORTED` não é reenviada, o `recursiveDelete` da limpeza fica pendente e o `node --test` cancela o arquivo.
  - O build das Functions limpa `lib/` antes do `tsc` (`clean`), e o `typecheck` não apaga `lib/`. Com isso, teste compilado de fonte removida não roda mais.
- **TARGET (P6):** projeto `demo-minhas-financas` no Emulator; uma guarda única, carregada antes de qualquer teste de integração, que falha sem `FIRESTORE_EMULATOR_HOST` ou com projeto diferente do local; remoção dos `skip` condicionais e do script sem Emulator; CI falhando se houver teste pulado; versão fixa da CLI; varredura de segredos (gitleaks) e `npm audit` no gate.
- **GAP:** FIRE-13 (LOW), INV-16 (LOW), REL-09 (MEDIUM), REL-11 (MEDIUM).

---

## 16. Registro de configuração externa

Itens que o repositório não prova. Todos estão em **EXTERNAL CONFIGURATION REQUIRED**, com estado `NÃO VERIFICADO` na baseline. A verificação é somente leitura e feita por pessoa autorizada. Agentes nunca a executam contra PROD. Os valores de segredo nunca são exibidos. Sem registro com data e responsável, o item é `FAIL` no gate `firebase-production-readiness`. Registros canônicos de outros documentos: E-07 detalhado em [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md#8-evidência-exigida-e-07), alertas de E-08 em [OBSERVABILITY.md](OBSERVABILITY.md) e E-12 em [RUNBOOKS.md](RUNBOOKS.md#5-registro-e-12--github) (as linhas abaixo resumem esses registros; em caso de divergência, vale o registro canônico).

| ID | Ambiente | Item | Valor esperado | Estado | Verificação (somente leitura) | Data | Responsável |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E-01 | DEV | Projeto Firebase/GCP DEV | ID registrado (D-19), faturamento Blaze ativo | NÃO VERIFICADO | `firebase projects:list`; `gcloud billing projects describe <DEV>` | — | a designar |
| E-01 | STAGING | Projeto Firebase/GCP STAGING | ID registrado, Blaze ativo, sem dados de PROD | NÃO VERIFICADO | idem, com `<STAGING>` | — | a designar |
| E-01 | PROD | Projeto Firebase/GCP PROD | ID registrado (D-19), Blaze ativo, sem massa de teste | NÃO VERIFICADO | idem, com `<PROD>` | — | a designar |
| E-01 | Todos | Aliases no `.firebaserc` | `dev`, `staging`, `prod`; nenhum `default` apontando para PROD | NÃO VERIFICADO | leitura do `.firebaserc` no commit implantado | — | a designar |
| E-01 | Todos | Local do Firestore `(default)` | `southamerica-east1` | NÃO VERIFICADO | `gcloud firestore databases describe --database="(default)" --project=<ALIAS>` | — | a designar |
| E-01 | STAGING, PROD | Inventário remoto de Functions | exatamente os endpoints do contrato vigente (47 no HEAD `9c3ab46`), todos em `southamerica-east1`; nenhuma função antiga em `us-central1` | NÃO VERIFICADO | `firebase functions:list --project=<ALIAS>` | — | a designar |
| E-02 | STAGING, PROD | App web registrado no App Check | provedor reCAPTCHA Enterprise, chave própria do ambiente, domínios do ambiente | NÃO VERIFICADO | Console Firebase › App Check › Apps | — | a designar |
| E-02 | DEV, CI | Debug tokens | criados por ambiente, guardados fora do repositório | NÃO VERIFICADO | Console › App Check › Gerenciar tokens de depuração | — | a designar |
| E-02 | STAGING, PROD | Métricas antes do enforcement | período observado e percentual de requisições verificadas registrados | NÃO VERIFICADO | Console › App Check › APIs (métricas) | — | a designar |
| E-02 | PROD | Enforcement Firestore | ativo | NÃO VERIFICADO | Console › App Check › APIs › Cloud Firestore | — | a designar |
| E-02 | PROD | Enforcement Authentication | ativo | NÃO VERIFICADO | Console › App Check › APIs › Authentication | — | a designar |
| E-02 | PROD | Enforcement Functions | `enforceAppCheck` no código implantado e métricas sem rejeição legítima | NÃO VERIFICADO | teste de contrato no commit implantado + Console › App Check › APIs | — | a designar |
| E-03 | PROD, STAGING | Provedores de login | iguais aos do código (D-06); Anônimo e E-mail/Senha desativados se não usados | NÃO VERIFICADO | Console › Authentication › Método de login | — | a designar |
| E-03 | PROD | Domínios autorizados | só os domínios do produto; sem `localhost` | NÃO VERIFICADO | Console › Authentication › Configurações › Domínios autorizados | — | a designar |
| E-03 | PROD | Proteção contra enumeração de e-mail | ativa | NÃO VERIFICADO | Console › Authentication › Configurações | — | a designar |
| E-03 | PROD | Templates de e-mail | pt-BR, remetente no domínio próprio (E-11) | NÃO VERIFICADO | Console › Authentication › Modelos | — | a designar |
| E-03 | PROD | Tela de consentimento OAuth | nome e logo do produto, domínio verificado, URLs de termos e privacidade, e-mail de suporte | NÃO VERIFICADO | Console GCP › APIs e serviços › Tela de consentimento OAuth | — | a designar |
| E-03 | PROD | MFA de administradores | obrigatória para contas com papel de plataforma (D-06, D-10) | NÃO VERIFICADO | Console › Authentication (Identity Platform) › MFA | — | a designar |
| E-03 | PROD, STAGING | Chave de API web | restrita por referrer HTTP e APIs permitidas | NÃO VERIFICADO | `gcloud services api-keys list --project=<ALIAS>` (restrições) | — | a designar |
| E-04 | PROD | Membros humanos | pessoas nomeadas, MFA obrigatório, sem Owner/Editor desnecessário, sem papel de deploy fora do CD | NÃO VERIFICADO | `gcloud projects get-iam-policy <PROD>` | — | a designar |
| E-04 | PROD | Conta padrão do Compute | sem papel Editor | NÃO VERIFICADO | `gcloud projects get-iam-policy <PROD>` | — | a designar |
| E-04 | STAGING, PROD | Service account por classe de função | domínio, pesada, IA, webhook e cron com papéis mínimos | NÃO VERIFICADO | `gcloud functions describe <nome> --region=southamerica-east1 --gen2 --project=<ALIAS>` (`serviceAccountEmail`) | — | a designar |
| E-04 | Todos | Chaves de service account | nenhuma chave gerenciada pelo usuário | NÃO VERIFICADO | `gcloud iam service-accounts keys list --iam-account=<SA> --managed-by=user` | — | a designar |
| E-04 | STAGING, PROD | Workload Identity Federation do CD | pool/provider restrito ao repositório e ao environment | NÃO VERIFICADO | `gcloud iam workload-identity-pools list --location=global --project=<ALIAS>` | — | a designar |
| E-04 | PROD | Cloud Audit Logs | atividade administrativa ativa; política de acesso a dados decidida | NÃO VERIFICADO | `gcloud projects get-iam-policy <PROD>` (`auditConfigs`) | — | a designar |
| E-05 | Todos | Segredos existentes | `GOOGLE_AI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_BUSINESS_MONTHLY`, `APP_ALLOWED_ORIGINS`, próprios do projeto | NÃO VERIFICADO | `gcloud secrets list --project=<ALIAS>` (só nomes) | — | a designar |
| E-05 | Todos | Versões | uma versão ativa por segredo; versões anteriores desativadas após rotação | NÃO VERIFICADO | `gcloud secrets versions list <NOME> --project=<ALIAS>` | — | a designar |
| E-05 | Todos | Acesso aos segredos | `secretAccessor` só nas service accounts que os declaram | NÃO VERIFICADO | `gcloud secrets get-iam-policy <NOME> --project=<ALIAS>` | — | a designar |
| E-05 | PROD | Separação test/live do Stripe | chaves live só em PROD; test só em DEV/STAGING (E-06) | NÃO VERIFICADO | metadados e rótulos do segredo; painel Stripe (sem exibir valor) | — | a designar |
| E-05 | Todos | Chave do Gemini | nova após a rotação E-00, restrita à API e com quota | NÃO VERIFICADO | `gcloud services api-keys list --project=<ALIAS>`; registro de E-00 em [SECURITY_MODEL.md](SECURITY_MODEL.md) | — | a designar |
| E-05 | Todos | Política de rotação | periodicidade e dono por segredo registrados | NÃO VERIFICADO | registro neste documento e em [RUNBOOKS.md](RUNBOOKS.md) | — | a designar |
| E-07 | PROD, STAGING | PITR | `pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_ENABLED` | NÃO VERIFICADO | `gcloud firestore databases describe --database="(default)" --project=<ALIAS>` | — | a designar |
| E-07 | PROD | Delete protection | `deleteProtectionState: DELETE_PROTECTION_ENABLED` | NÃO VERIFICADO | idem | — | a designar |
| E-07 | PROD | Backups agendados | frequência, retenção e export isolado conforme D-27 (prazos por categoria em D-18) | NÃO VERIFICADO | `gcloud firestore backups schedules list --database="(default)" --project=<PROD>` | — | a designar |
| E-07 | PROD, STAGING | Políticas de TTL | exatamente as coleções operacionais do §6 | NÃO VERIFICADO | `gcloud firestore fields ttls list --project=<ALIAS>` | — | a designar |
| E-07 | STAGING | Restore ensaiado | registro com data, origem, duração e RPO/RTO medidos | NÃO VERIFICADO | registro em [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md) | — | a designar |
| E-08 | Todos | Budget | budget por projeto com alertas de 50/90/100% e destinatários definidos | NÃO VERIFICADO | `gcloud billing budgets list --billing-account=<CONTA>` | — | a designar |
| E-08 | PROD | Retenção do Cloud Logging | prazo definido (D-18) e sink com lock, se exigido | NÃO VERIFICADO | `gcloud logging buckets describe _Default --location=global --project=<PROD>`; `gcloud logging sinks list --project=<PROD>` | — | a designar |
| E-08 | PROD, STAGING | Error Reporting e Cloud Monitoring | habilitados; canais de notificação criados | NÃO VERIFICADO | Console Cloud Monitoring › Alertas › Canais | — | a designar |
| E-08 | PROD | Políticas de alerta | conforme a tabela de alertas de [OBSERVABILITY.md](OBSERVABILITY.md) | NÃO VERIFICADO | Console Cloud Monitoring › Alertas (registro canônico em OBSERVABILITY.md) | — | a designar |
| E-12 | GitHub | Proteção de `main` | PR obrigatório com revisão; sem push direto nem force-push | NÃO VERIFICADO | `gh api repos/{owner}/{repo}/branches/main/protection` | — | a designar |
| E-12 | GitHub | Checks obrigatórios | "Build e testes unitários (Node 22)", "Build e testes unitários (Node 24)", "Integração e Firestore Rules", "E2E" (`.github/workflows/quality-gate.yml:28,75,113`) | NÃO VERIFICADO | idem (`required_status_checks`) | — | a designar |
| E-12 | GitHub | Environments de deploy | `staging` e `production` com revisores obrigatórios e restrição de branch/tag | NÃO VERIFICADO | `gh api repos/{owner}/{repo}/environments` | — | a designar |
| E-12 | GitHub | Segredos do repositório | nenhuma credencial de PROD; deploy por WIF | NÃO VERIFICADO | `gh secret list`; `gh secret list --env production` (só nomes) | — | a designar |
