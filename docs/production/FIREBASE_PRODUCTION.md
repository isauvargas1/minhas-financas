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
| TTL | `expiresAt` gravado pelo código; ativação manual, não versionada | CURRENT | FIRE-08, RULES-13 (MEDIUM) | P6 |
| IAM | Nenhuma service account declarada; IAM remoto não verificado | CURRENT | FIRE-09 (MEDIUM) | P6 |
| Segredos | Secret Manager declarado por função; fallback placeholder no Stripe | CURRENT | PR-BILL-05, PR-AI-02 | P2, P0 |
| Hosting | Só `Cache-Control`; Tailwind Play CDN, Google Fonts e sons do Mixkit carregados em runtime; importmap `esm.sh` publicado no HTML (requisição em runtime não comprovada) | CURRENT | PR-PLAT-03, FIRE-07 | P6 |
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
- **TARGET:** parâmetros não secretos das Functions por ambiente em `.env.<alias>` (`defineString`/`defineList` para `STRIPE_ALLOWED_PRICE_IDS` e `APP_ALLOWED_ORIGINS`) e segredos por projeto via `defineSecret` (§8).
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

`functions/src/index.ts:11` aplica `setGlobalOptions(GLOBAL_FUNCTION_OPTIONS)` antes dos re-exports (`functions/src/index.ts:14-37`).

| Perfil | Constante | Região | Timeout | Memória | maxInstances | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| G (global) | `GLOBAL_FUNCTION_OPTIONS` | southamerica-east1 | padrão da plataforma | padrão da plataforma | 20 | `functions/src/shared/runtimeOptions.ts:41-44` |
| D (domínio) | `DOMAIN_CALLABLE_OPTIONS` | southamerica-east1 | 60 s | 256 MiB | 20 | `functions/src/shared/runtimeOptions.ts:47-52` |
| H (pesada) | `HEAVY_CALLABLE_OPTIONS` | southamerica-east1 | 540 s | 512 MiB | 3 | `functions/src/shared/runtimeOptions.ts:64-69` |
| IA | `AI_CALLABLE_OPTIONS` | southamerica-east1 | 120 s | 256 MiB | 10 | `functions/src/shared/runtimeOptions.ts:72-77` |
| C (cron) | `SCHEDULED_FUNCTION_OPTIONS` | southamerica-east1 | 540 s | 512 MiB | 1 | `functions/src/shared/runtimeOptions.ts:86-91` |

**CURRENT:** nenhum perfil declara `serviceAccount`, `concurrency`, `cpu`, `minInstances`, `enforceAppCheck` ou `retry` (`functions/src/shared/runtimeOptions.ts:41-91`; FIRE-09).

### 3.2 Endpoints exportados (CURRENT)

São 47 endpoints: 42 callables, 3 crons, 1 gatilho Firestore e 1 webhook HTTP. Os wrappers de domínio aplicam o perfil D por padrão: cartões em `functions/src/creditCards/callables.ts:96-110`, metas em `functions/src/goals/callables.ts:44-49` e investimentos em `functions/src/investments/callables.ts:72-81`.

| # | Função | Tipo | Definição | Perfil | Segredos | App Check | Retry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `onTransactionWrite` | Gatilho `onDocumentWritten` em `workspaces/{workspaceId}/transactions/{transactionId}` | `functions/src/triggers/transactions.ts:35-37` | G | — | N/A | Não (padrão da plataforma; FIRE-05) |
| 2 | `createSplitGroupInvite` | Callable | `functions/src/callables/splitGroups.ts:100-101` | D | — | Não | N/A |
| 3 | `acceptSplitGroupInvite` | Callable | `functions/src/callables/splitGroups.ts:177-178` | D | — | Não | N/A |
| 4 | `createCreditCardPurchase` | Callable | `functions/src/creditCards/callables.ts:138` | D | — | Não | N/A |
| 5 | `registerCreditCardInvoicePayment` | Callable | `functions/src/creditCards/callables.ts:145` | D | — | Não | N/A |
| 6 | `reverseCreditCardInvoicePayment` | Callable | `functions/src/creditCards/callables.ts:151` | D | — | Não | N/A |
| 7 | `cancelCreditCardPurchase` | Callable | `functions/src/creditCards/callables.ts:157` | D | — | Não | N/A |
| 8 | `recalculateCardLimit` | Callable | `functions/src/creditCards/callables.ts:163-168` | H | — | Não | N/A |
| 9 | `closeCreditCardInvoice` | Callable | `functions/src/creditCards/callables.ts:170` | D | — | Não | N/A |
| 10 | `reopenCreditCardInvoice` | Callable | `functions/src/creditCards/callables.ts:176` | D | — | Não | N/A |
| 11 | `rebuildCardInvoicesForCard` | Callable | `functions/src/creditCards/callables.ts:182-187` | H | — | Não | N/A |
| 12 | `updateCreditCardPurchase` | Callable | `functions/src/creditCards/callables.ts:189` | D | — | Não | N/A |
| 13 | `createGoal` | Callable | `functions/src/goals/callables.ts:83` | D | — | Não | N/A |
| 14 | `updateGoal` | Callable | `functions/src/goals/callables.ts:89` | D | — | Não | N/A |
| 15 | `archiveGoal` | Callable | `functions/src/goals/callables.ts:95` | D | — | Não | N/A |
| 16 | `seedLegacySettingsCatalog` | Callable | `functions/src/goals/callables.ts:101` | D | — | Não | N/A |
| 17 | `onboardInvestmentWorkspace` | Callable | `functions/src/investments/callables.ts:107` | D | — | Não | N/A |
| 18 | `createInvestmentContribution` | Callable | `functions/src/investments/callables.ts:113` | D | — | Não | N/A |
| 19 | `createSimpleInvestment` | Callable | `functions/src/investments/callables.ts:128` | D | — | Não | N/A |
| 20 | `settleInvestmentContribution` | Callable | `functions/src/investments/callables.ts:134` | D | — | Não | N/A |
| 21 | `withdrawSimpleInvestment` | Callable | `functions/src/investments/callables.ts:140` | D | — | Não | N/A |
| 22 | `settleSimpleWithdrawal` | Callable | `functions/src/investments/callables.ts:146` | D | — | Não | N/A |
| 23 | `createInvestmentRedemption` | Callable | `functions/src/investments/callables.ts:152` | D | — | Não | N/A |
| 24 | `settleInvestmentRedemption` | Callable | `functions/src/investments/callables.ts:158` | D | — | Não | N/A |
| 25 | `reverseInvestmentMovement` | Callable | `functions/src/investments/callables.ts:164` | D | — | Não | N/A |
| 26 | `changeInvestmentGoal` | Callable | `functions/src/investments/callables.ts:170` | D | — | Não | N/A |
| 27 | `linkInvestmentToGoal` | Callable | `functions/src/investments/callables.ts:176` | D | — | Não | N/A |
| 28 | `unlinkInvestmentFromGoal` | Callable | `functions/src/investments/callables.ts:182` | D | — | Não | N/A |
| 29 | `recalculateInvestmentPosition` | Callable | `functions/src/investments/callables.ts:188-193` | H | — | Não | N/A |
| 30 | `recalculateGoalInvestmentProgress` | Callable | `functions/src/investments/callables.ts:195-200` | H | — | Não | N/A |
| 31 | `archiveInvestmentAccount` | Callable | `functions/src/investments/callables.ts:202` | D | — | Não | N/A |
| 32 | `archiveInvestmentAsset` | Callable | `functions/src/investments/callables.ts:208` | D | — | Não | N/A |
| 33 | `saveInvestmentAccount` | Callable | `functions/src/investments/callables.ts:214` | D | — | Não | N/A |
| 34 | `saveInvestmentAsset` | Callable | `functions/src/investments/callables.ts:220` | D | — | Não | N/A |
| 35 | `cancelInvestmentMovement` | Callable | `functions/src/investments/callables.ts:226` | D | — | Não | N/A |
| 36 | `recordInvestmentValuation` | Callable | `functions/src/investments/callables.ts:232` | D | — | Não | N/A |
| 37 | `registerInvestmentImportBatch` | Callable | `functions/src/investments/callables.ts:238` | D | — | Não | N/A |
| 38 | `rebuildInvestmentProjections` | Callable | `functions/src/investments/callables.ts:244-249` | H | — | Não | N/A |
| 39 | `backfillInvestmentWorkspace` | Callable | `functions/src/investments/callables.ts:251-256` | H | — | Não | N/A |
| 40 | `analyzeFinancialQuestion` | Callable | `functions/src/ai/callables.ts:126` | IA | `GOOGLE_AI_API_KEY` (`functions/src/ai/callables.ts:24-29`) | Não | N/A |
| 41 | `extractTransactionFromContent` | Callable | `functions/src/ai/callables.ts:203` | IA | `GOOGLE_AI_API_KEY` | Não | N/A |
| 42 | `createCheckoutSession` | Callable | `functions/src/callables/billing.ts:76-95` | D | `STRIPE_SECRET_KEY`, `STRIPE_ALLOWED_PRICE_IDS`, `APP_ALLOWED_ORIGINS` | Não | N/A |
| 43 | `rebuildCashPeriods` | Callable | `functions/src/cash/rebuild.ts:247-248` | H | — | Não | N/A |
| 44 | `processRecurring` | Cron `every day 02:00`, `America/Sao_Paulo` | `functions/src/crons/recurring.ts:571-579` | C | — | N/A | Não declarado |
| 45 | `processInvestmentDriftScan` | Cron `every day 06:00`, `America/Sao_Paulo` | `functions/src/crons/investmentDrift.ts:325-330` | C | — | N/A | Não declarado |
| 46 | `processCreditCardInvoiceOperationalAlerts` | Cron `every day 07:00`, `America/Sao_Paulo` | `functions/src/crons/creditCardInvoices.ts:315-325` | C | — | N/A | Não declarado |
| 47 | `stripeWebhook` | HTTP `onRequest`, `cors: true` | `functions/src/webhooks/stripe.ts:31-41` | G (só região e segredos) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ALLOWED_PRICE_IDS` | N/A (assinatura Stripe, `functions/src/webhooks/stripe.ts:42-58`) | Reentrega do Stripe; sem deduplicação por `event.id` (PR-BILL-06) |

### 3.3 Contrato de deploy e pacote

- **CURRENT:** `functions/src/shared/deploymentContract.test.ts:63-178` verifica a região de todos os endpoints, timeout e memória de toda callable, fuso e perfil dos 3 crons, o perfil pesado de 5 operações, os segredos declarados por quem lê `process.env` e a ausência de 10 callables legadas de investimento.
- **CURRENT:** o contrato cobre do webhook só a região e os segredos (`functions/src/shared/deploymentContract.test.ts:63-71,137-143`) e do gatilho só a região; não cobre timeout e memória de webhook e gatilho, App Check, retry, `serviceAccount` nem concorrência (FIRE-09). O comentário de `functions/src/shared/runtimeOptions.ts:16-18` confirma que trocar de região cria a função nova e mantém a antiga. As funções antigas em `us-central1` no projeto remoto não estão verificadas (§16, E-01).
- **CURRENT:** os 9 arquivos `functions/src/creditCards/manual*Test.ts` são compilados em `lib/` e entram no pacote de deploy. `generateInviteCodeForTest` é exportado pelo módulo de produção (`functions/src/callables/splitGroups.ts:42`), embora não seja endpoint. O `ignore` do `firebase.json` não exclui testes (`firebase.json:13-19`) (REL-15, ENTRY-22; remoção prevista em P4 pela §7 do plano).
- **TARGET:** todo endpoint novo de P1–P5 usa um dos perfis acima e entra no contrato. O contrato passa a exigir `enforceAppCheck` nas callables, `retry` com corte por idade em todo gatilho de evento (PR-TX-04, P3), `retryConfig` nos crons, `serviceAccount` dedicada por classe, timeout e memória explícitos no webhook e ausência de `cors` no webhook (ENTRY-21).
- **TARGET:** a contagem e a lista de funções usadas em runbooks vêm do build/contrato, nunca de documento (FIRE-14).

---

## 4. App Check

- **CURRENT:** não há `initializeAppCheck` no cliente (`src/lib/firebase.ts:1-64`), nem `enforceAppCheck` ou `consumeAppCheckToken` nas Functions (`functions/src/shared/runtimeOptions.ts:41-91`; nenhuma ocorrência em `functions/src` e `src`). O único controle anti-abuso é o rate limit por ator: IA com 20/h (análise) e 60/h (extração) por workspace+ator (`functions/src/ai/callables.ts:44-48,167-171`) e checkout com 10/h por usuário (`functions/src/callables/billing.ts:70-74`).
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

- **CURRENT:** `firebase.json:5-6` referencia `firestore.rules` (1.490 linhas) e `firestore.indexes.json` (43 índices compostos; `"fieldOverrides": []` em `firestore.indexes.json:806`).
- **CURRENT:** o CI executa as 6 suítes de Rules no Emulator em todo push para `main` e em todo PR (`.github/workflows/quality-gate.yml:10-15,109-110`; `package.json:36`).
- **CURRENT:** só `deploy:firestore` e `deploy:safe` exigem as suítes antes de publicar (`package.json:21-22,24`). `firebase deploy` direto e `npm --prefix functions run deploy` não passam por gate nenhum (`functions/package.json:12`).
- **CURRENT:** não há registro de qual commit está implantado em cada ambiente.
- **TARGET:** Rules e índices são publicados só pelo CD, depois do `quality-gate`, primeiro em STAGING (com smoke das consultas compostas) e depois em PROD. Cada ambiente registra o commit/tag publicado. `fieldOverrides` versiona a TTL (§6) e as isenções de indexação de campos volumosos.
- **GAP:** RULES-14 (dentro de PR-PLAT-01, P6); PR-RULES-02 (catch-all de leitura, P6); PR-CC-08 e PR-RULES-03 (índices ausentes, P4).

---

## 6. TTL

- **CURRENT:** `functions/src/shared/retention.ts:23-47` define `RETENTION_DAYS`. O campo `expiresAt` é gravado em:

  | Coleção (conforme o manifesto) | Ponto de escrita | Prazo |
  | --- | --- | --- |
  | `investment_idempotency_keys` | `functions/src/investments/infrastructure.ts:326` | 90 dias |
  | métricas operacionais de investimentos | `functions/src/investments/observability.ts:119` | 400 dias |
  | `investment_event_logs` | `functions/src/investments/observability.ts:237` | 400 dias |
  | `investment_drift_reports` | `functions/src/crons/investmentDrift.ts:263` | 400 dias |
  | `rate_limits` (workspace e `users/{uid}`) | `functions/src/shared/rateLimit.ts:144` | 2 dias |
  | `activity_logs` | `functions/src/triggers/transactions.ts:111-116` | 365 dias |
  | `cash_period_events` | `functions/src/cash/periods.ts:360` | 90 dias |

- **CURRENT:** a remoção depende de política de TTL ativada à mão por coleção (`functions/src/shared/retention.ts:17-20`), por um loop `gcloud` documentado em `docs/investments/TTL_MANIFEST.md:51-70`, documento OUTDATED segundo a §13 do plano. Não há `fieldOverrides` com `ttl` (`firestore.indexes.json:806`). As instruções divergem: o checklist antigo fala em "sete" grupos (`docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:194`) e o ensaio, em "seis" (`tools/staging/rehearsal.sh:139-142`). As coleções operacionais de cartões e metas não gravam `expiresAt` (FIRE-08).
- **CURRENT:** o comentário de `functions/src/shared/retention.ts:39-46` supõe reentrega de gatilho por 7 dias, mas o gatilho de caixa roda sem retry (FIRE-05).
- **TARGET (P6):** `fieldOverrides` em `firestore.indexes.json` com `{collectionGroup, fieldPath: "expiresAt", ttl: true, indexes: []}` para exatamente as coleções operacionais, publicado junto com os índices. Um teste compara os `fieldOverrides` com a lista declarada no código. As coleções operacionais de cartões e metas passam a gravar `expiresAt` via `RETENTION_DAYS`. Os prazos seguem a D-18 ([DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md)). TTL nunca é ativada em ledger, trilha de auditoria ou fato financeiro.
- **GAP:** FIRE-08, RULES-13 (MEDIUM, P6). A remoção por TTL é definitiva; ver [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md).
- **EXTERNAL CONFIGURATION REQUIRED:** políticas de TTL por ambiente, enquanto não forem versionadas (E-07, §16).

---

## 7. IAM e service accounts

- **CURRENT:** nenhuma função declara `serviceAccount` (`functions/src/shared/runtimeOptions.ts:41-91`; `functions/src/webhooks/stripe.ts:31-41`), então todas rodam com a conta padrão do runtime. Os papéis dessa conta, os membros humanos, o MFA e as chaves de service account do projeto não estão verificados (NÃO VERIFICADO). O deploy sai da estação do desenvolvedor, com credencial pessoal (PR-REL-01).
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
| `GOOGLE_AI_API_KEY` | `analyzeFinancialQuestion`, `extractTransactionFromContent` (`functions/src/ai/callables.ts:24-29`) | Segredo | CURRENT |
| `STRIPE_SECRET_KEY` | `createCheckoutSession` (`functions/src/callables/billing.ts:90-94`), `stripeWebhook` (`functions/src/webhooks/stripe.ts:35-39`) | Segredo | CURRENT |
| `STRIPE_WEBHOOK_SECRET` | `stripeWebhook` (`functions/src/webhooks/stripe.ts:35-39`) | Segredo | CURRENT |
| `STRIPE_ALLOWED_PRICE_IDS` | `createCheckoutSession`, `stripeWebhook` | Configuração por ambiente guardada como segredo | CURRENT |
| `APP_ALLOWED_ORIGINS` | `createCheckoutSession` | Configuração por ambiente guardada como segredo | CURRENT |

- **CURRENT:** `firebase.json:12` desativa o runtime config legado (`disallowLegacyRuntimeConfig: true`). O teste de contrato exige a declaração de cada segredo lido (`functions/src/shared/deploymentContract.test.ts:117-144`).
- **CURRENT:** a chave de IA falha fechada, com mensagem pt-BR (`functions/src/ai/callables.ts:107-116`), e as allowlists vazias recusam tudo (`functions/src/callables/billing.ts:31-35,51-55`). As chaves Stripe, porém, caem em `sk_test_placeholder`/`whsec_placeholder` no escopo do módulo (`functions/src/callables/billing.ts:9`; `functions/src/webhooks/stripe.ts:8-9`), e o webhook ecoa `error.message` na resposta (`functions/src/webhooks/stripe.ts:53-57`).
- **CURRENT:** o Vite neutraliza `process.env.GEMINI_API_KEY`/`API_KEY` no bundle (`vite.config.ts:13-19`). A chave esteve embutida no bundle no passado e a rotação não está comprovada (PR-AI-02; ação E-00, registrada em [SECURITY_MODEL.md](SECURITY_MODEL.md)).
- **CURRENT:** o checklist antigo usa como evidência `firebase functions:secrets:access <NOME>` (`docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:61`), comando que **imprime o valor** do segredo. Não usar. A verificação é feita só por metadados (§16).
- **TARGET:** `defineSecret` sem fallback para `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` e `GOOGLE_AI_API_KEY`. Segredo ausente responde erro genérico, com log estruturado e alerta. O cliente Stripe é instanciado dentro do handler. `STRIPE_ALLOWED_PRICE_IDS` e `APP_ALLOWED_ORIGINS` viram parâmetros por ambiente (`defineList`/`defineString`) ou dados do catálogo versionado de P2. Cada projeto tem seus segredos e uma política de rotação com dono. O procedimento está em [RUNBOOKS.md](RUNBOOKS.md).
- **GAP:** PR-BILL-05 (P2; origem BILL-06, ENTRY-04, FIRE-10), PR-AI-02 (P0, externa imediata). **EXTERNAL CONFIGURATION REQUIRED:** E-05 (§16).

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
- **CURRENT:** não há CSP, HSTS, `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` nem `Permissions-Policy` (`firebase.json:38-57`). O `index.html` carrega em runtime o Tailwind Play CDN (`index.html:8`) e Google Fonts (`index.html:9-11`), e publica um importmap `esm.sh` que inclui `@google/genai@^1.32.0` (`index.html:75-93`; requisição em runtime não comprovada, já que a entrada `/src/main.tsx` é empacotada pelo Vite, `index.html:98`). Os sons de interface vêm de `assets.mixkit.co` (`src/contexts/ThemeContext.tsx:28-43`). `lang="en"` (`index.html:3`).
- **CURRENT:** `build` e `build:e2e` escrevem no mesmo `dist/` (`package.json:9,27`). O bloco `hosting` não tem `predeploy` (`firebase.json:25-58`), e `deploy:hosting` usa as variáveis locais de quem roda (`package.json:25`). A auditoria encontrou um `dist/` local gerado pelo build E2E (REL-05).
- **TARGET (P6):**
  - Headers em `source: "**"`: `Content-Security-Policy` com `script-src 'self'` mais os domínios necessários de Google Auth, APIs e Stripe, `connect-src` restrito e `frame-ancestors 'none'`; `Strict-Transport-Security` (`max-age` ≥ 31536000; `includeSubDomains`); `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` restritiva; `Cross-Origin-Opener-Policy: same-origin-allow-popups`.
  - `no-cache` em todo HTML; `/assets/**` imutável.
  - Tailwind compilado no build, com paridade visual provada por screenshot (D-20); fontes e sons auto-hospedados; sem importmap; entrada única `src/main.tsx`.
  - Build por ambiente só no CD, `outDir` separado para E2E e guarda de modo (§2.2).
  - Domínio próprio com TLS (E-11). Preview channels nunca apontam para dados de PROD.
- **GAP:** PR-PLAT-03 (origem FIRE-06, AUTH-06, PRIV-09, COMM-07), PR-AUTH-04, FIRE-07 (MEDIUM), REL-11 (MEDIUM). Todos em P6.
- **DECISION:** D-20 (Tailwind compilado e critério de paridade). A política de CSP depende do domínio final (E-11).

---

## 11. Cloud Storage

- **CURRENT:** `getStorage` é inicializado e exportado sem uso (`src/lib/firebase.ts:4,39`). O `firebase.json` não tem seção `storage` e não existe `storage.rules` (FIRE-12, LOW).
- **TARGET (P6):** remover a inicialização e o chunk, ou versionar `storage.rules` com deny-all e publicá-las junto com as Rules. `N/A` no gate só com prova de não uso.

---

## 12. Custos, quotas e kill switch

- **CURRENT:** o custo tem teto só por `maxInstances` (§3.1) e por rate limits de IA, checkout e rebuild de caixa (`functions/src/ai/callables.ts:44-48,167-171`; `functions/src/callables/billing.ts:70-74`; `functions/src/cash/rebuild.ts:256-262`). Não há registro versionado de budget nem de alertas de custo. Não há kill switch para desligar uma funcionalidade sem deploy (GAP PR-OBS-02, P7). A IA usa um modelo preview (`functions/src/ai/callables.ts:121`; FIRE-11), e a quota do Gemini não está verificada.
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
- **CURRENT:** as suítes de Rules e a guarda da ferramenta destrutiva lançam erro sem `FIRESTORE_EMULATOR_HOST` (`tests/firestore/adjacent-modules.rules.integration.test.mjs:42-44`; `tests/tools/limpar-investimentos.guard.test.mjs:24-25`). Há testes de integração das Functions que **pulam em silêncio** sem Emulator (`functions/src/creditCards/__tests__/failureObservability.integration.test.ts:46-50`; `functions/src/crons/__tests__/investmentDrift.integration.test.ts:103-105`). `goalProgressRebuild.integration.test.ts` não tem guarda e faz `recursiveDelete` no projeto indicado por `GCLOUD_PROJECT` (`functions/src/investments/__tests__/goalProgressRebuild.integration.test.ts:28,35-38,53`). O script `functions:test:integration` roda sem Emulator (`package.json:15`).
- **CURRENT:** o CI instala `firebase-tools@latest`, sem versão fixa (`.github/workflows/quality-gate.yml:100-101,138-139`), e Java 17 (`.github/workflows/quality-gate.yml:89-92`).
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
| E-05 | Todos | Segredos existentes | `GOOGLE_AI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (e, até P2, `STRIPE_ALLOWED_PRICE_IDS`, `APP_ALLOWED_ORIGINS`), próprios do projeto | NÃO VERIFICADO | `gcloud secrets list --project=<ALIAS>` (só nomes) | — | a designar |
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
