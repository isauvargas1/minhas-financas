# Observabilidade e auditoria

Este documento define como o backend do Minhas Finanças registra, correlaciona, mede e alerta, e como guarda as trilhas de auditoria e roda a reconciliação financeira. Ele parte do HEAD auditado `9c3ab46`, sem nenhuma mudança funcional em relação a ele. Descreve o estado atual (CURRENT), o alvo concreto para este código (TARGET) e as lacunas (GAP), com IDs do [plano mestre](PRODUCTION_READINESS_PLAN.md). O gate do tema é a skill `observability-incident-readiness`. A existência da plataforma de Logging/Monitoring, a retenção e os backups ficam com `firebase-production-readiness`. Este documento também serve de registro versionado de alertas e da configuração externa E-08, que a skill exige.

Rótulos: **CURRENT**, **TARGET**, **GAP**, **DECISION** e **EXTERNAL CONFIGURATION REQUIRED**, com o significado da [classificação do plano mestre](PRODUCTION_READINESS_PLAN.md#classificação-usada-em-docsproduction).

---

## 1. Escopo, fronteiras e milestones

| Tema | Onde fica |
| --- | --- |
| Logging, correlação, métricas, alertas, trilha de auditoria, reconciliação observável, falhas de webhook | Este documento |
| Severidades, papéis, fluxo de incidente, preservação de evidência, comunicação | [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) |
| Procedimentos passo a passo (replay de webhook, rebuild, reparo de deriva) | [RUNBOOKS.md](RUNBOOKS.md) |
| PITR, backups, restore, RTO/RPO | [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md) |
| Projetos, IAM, App Check, TTL, segredos | [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) |
| Fórmula de cada reconciliação e correção dos totais | [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md) |
| Correção e idempotência do webhook Stripe | [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md) |
| Dados pessoais em logs e auditoria, retenção legal | [PRIVACY_LGPD.md](PRIVACY_LGPD.md), [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md) |
| Coleções e índices | [DATA_MODEL.md](DATA_MODEL.md) |

Distribuição por milestone. Ela é coerente com [§8 do plano](PRODUCTION_READINESS_PLAN.md#8-milestones) e [D-ORD-02](PRODUCTION_READINESS_PLAN.md#9-decisões-de-ordenação-e-escopo-tomadas-em-p0):

- **P1:** o kernel entrega o contrato do logger estruturado, o correlation ID de servidor, o mapeador de erros pt-BR e o gravador de auditoria append-only. Os callables novos de P1 já nascem com eles.
- **P2–P5:** cada domínio substituído adota o kernel. O caixa ganha retry e cerca de versão (PR-TX-04) e trilha de auditoria imutável (PR-TX-05), em P3. O webhook ganhou o registro por `event.id` (PR-BILL-06, entregue em P2A).
- **P7:** adoção global, métricas, alertas versionados, consolidação das trilhas legadas, reconciliação com alerta, fila e replay de webhook (PR-OBS-01). O processo de incidentes e as alavancas de contenção (PR-OBS-02) ficam em [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
- **Ambientes:** nenhum alerta pode ser exercitado em projeto remoto antes de P6 ([D-ORD-04](PRODUCTION_READINESS_PLAN.md#9-decisões-de-ordenação-e-escopo-tomadas-em-p0)). A evidência de alerta disparado é colhida em STAGING (E-08).

---

## 2. Estado atual (CURRENT)

### 2.1 O que cada ponto de entrada registra

O backend exporta 91 endpoints: 84 callables, 4 crons, 2 gatilhos e 1 webhook (`functions/src/index.ts`; contagem pelo `lib/index.js` compilado na P4-A). A tabela mostra onde cada ponto de entrada registra sucesso e falha, e se a falha chega ao Cloud Logging.

| Ponto de entrada | Sucesso | Falha | Falha chega ao Cloud Logging? | Evidência | Classificação |
| --- | --- | --- | --- | --- | --- |
| 9 callables de investimentos (23 até a P4-D, D-15) | Métrica diária em shards + `investment_event_logs` (`outcome: completed`) na mesma transação | Com workspace autorizado: métrica `failure` + evento `outcome: failed` em Firestore. Sem workspace autorizado: `console.error` | Não. O erro vira `HttpsError` e o SDK não loga | `functions/src/investments/callables.ts`; `functions/src/investments/infrastructure.ts`; `functions/src/investments/observability.ts` | **CURRENT** |
| 13 callables de cartão (P4-A) | Auditoria append-only em `credit_card_events`, na mesma transação da operação (owner/admin leem); `credit_card_operational_metrics` e `financial_events` foram removidas | Log de fim do wrapper `defineCallable` com código de erro e erro pelo mapeador único (mensagem pt-BR, sem detalhe interno); sem métrica nem notificação | Sim, pelo log do wrapper (início, fim, duração, código, identificador de requisição) | `functions/src/cards/callables.ts`; `functions/src/shared/callable.ts` | CURRENT; métrica e alerta dedicados: P7 |
| 4 callables de `goals/callables.ts` (3 de metas e `seedLegacySettingsCatalog`) | `goal_audit_logs` | Nada: `catch` só converte o erro | Não | `functions/src/goals/callables.ts:53-54`; `functions/src/goals/operations.ts:120-141` | **CURRENT** |
| `rebuildCashPeriods` | Nada | Nada: `catch` só converte o erro | Não | `functions/src/cash/rebuild.ts:270-271` | **CURRENT** |
| 2 callables de IA | Débito de crédito e recibo na transação de admissão; log `ai.credit_consumed` com `periodKey`, `creditCost` e `creditDebitId` (id do recibo `users/{uid}/ai_usage_receipts/{id}`), correlacionado pelo `requestId` do contexto | `console.error` sanitizado (`ai_analysis_failed`, `ai_extraction_failed`) e `callable.end` do kernel | Sim, como texto e como log estruturado | `functions/src/ai/callables.ts:50-58,218-222,256-260` | **CURRENT** |
| 6 callables de contas e transferências (P3-J) | `cash_account_events` append-only na mesma transação; log do kernel (`callable.start`/`callable.end`) só com IDs | Log estruturado do wrapper (`defineCallable`), sem dados pessoais; recusa sem gravação | Sim | `functions/src/accounts/callables.ts`; `functions/src/accounts/__tests__/accountsLifecycle.integration.test.ts` | **CURRENT** |
| 8 callables de clientes e recebíveis (P3-I) | `client_events`/`receivable_events` append-only na mesma transação; log do kernel (`callable.start`/`callable.end`) só com IDs | Log estruturado do wrapper (`defineCallable`), sem dados pessoais; recusa sem gravação | Sim | `functions/src/receivables/callables.ts`; `functions/src/receivables/__tests__/receivableGuards.integration.test.ts` (logs capturados sem PII) | **CURRENT** |
| 2 callables de Split | Nada | `console.error` só com `error.name` | Sim, como texto | `functions/src/callables/splitGroups.ts:91-93` | **CURRENT** |
| `createCheckoutSession` | Trilha `billing_events` (`checkout.created`) na transação da reserva; log `billing.checkout_created` | Log estruturado do wrapper do kernel (`callable.end`) e eventos `billing.*` (`billing.config_missing`, `billing.price_unavailable`, `billing.price_mismatch`), sem valor de segredo | Sim, como log estruturado | `functions/src/shared/callable.ts:302-318`; `functions/src/billing/callables.ts:47-49`; `functions/src/billing/checkout.ts:179-186,471` | **CURRENT** |
| `stripeWebhook` | Recibo `billing_webhook_events/{event.id}` e trilha `billing_events` na mesma transação do efeito; log `billing_webhook.processed` com `outcome` e `durationMs` | Log estruturado `billing_webhook.*` (`stripeEventId` e `stripeEventType` depois da assinatura verificada): falha de entrega `billing_webhook.failed` (ERROR; `errorCode` estável, `outcome: "error"`, `durationMs`, `stripeErrorType` nos erros do Stripe), contenção `billing_webhook.contention` (WARNING; `errorCode: "lease_contention"`), `billing_webhook.signature_missing` e `.signature_invalid`, `billing_webhook.body_too_large` (WARNING; 413 antes da verificação da assinatura) e `billing.config_missing` (ERROR; só os nomes em `names`). Recusa de negócio e evento ignorado gravam recibo `processed` com `outcome` e `reason` e respondem 2xx. Assinatura inválida responde 400 sem ecoar a mensagem do SDK; configuração ausente e falha transitória respondem 500 | Sim, como log estruturado | `functions/src/webhooks/stripe.ts:38-51`; `functions/src/billing/webhook.ts:473-476,870-896` | **CURRENT** |
| `onTransactionWrite` | `activity_logs` (TTL de 365 dias) e marca em `cash_period_events` | Desde P3-B: falha passageira relançada (`retry: true`, até 24 h); permanente, ou perto do fim da janela, liga `needsRebuild` em `projection_state` | Log estruturado próprio, sem valor nem texto: `cash_projection.processed`, `.retry`, `.failed`, `.needs_rebuild`, `.issue_record_failed`, `activity_log.retry`/`.failed`, com `transactionId`, ação, resultado, código de erro e idade do evento | `functions/src/triggers/transactions.ts:270-411`; `functions/src/cash/periods.ts:430-577` | **CURRENT** |
| 3 crons | Resumo em `console.log` com contagens; `truncated` nos crons de recorrentes e faturas (o de faturas, `processCreditCardInvoiceClosing`, tem sinal `truncated` explícito desde a P4-A; o de recorrentes, `processRecurring`, desde a P4-B, também com `truncated` e `backlog`), `inconclusive` na deriva | Cron de faturas: log por operação (`createOperationLogger`), falha por fatura só com identificadores (`credit_card_invoice_close_failed`) e resumo `credit_card_invoice_closing_completed`/`_attention` com contagens e `truncated`; verificado. Cron de recorrentes (P4-B): `createOperationLogger`, falha por vencimento `recurring_due_failed` só com `workspaceId` e `recurringExpenseId`, e resumo `recurring_generation_completed`/`recurring_generation_attention` só com contagens (`scanned`, `processed`, `generated`, `awaitingConfirmation`, `attentionRequired` por código, `ended`, `skipped`, `failed`, `backlog`, `truncated`), sem nome, descrição nem valor. Deriva: `console.error` | Sim, como texto | `functions/src/recurring/scheduler.ts`; `functions/src/cards/closing.ts`; `functions/src/crons/investmentDrift.ts:271,347,368` | **CURRENT** |
| Frontend | — | Só `console.error` do navegador | Não se aplica | `src/App.tsx:269`; `src/contexts/WorkspaceContext.tsx:77` | **CURRENT** |

### 2.2 Logging

- **CURRENT:** o backend não tem logger estruturado. Não há nenhuma ocorrência de `firebase-functions/logger`, `logger/compat` ou `@google-cloud/logging` em `functions/src` e `src`. O backend tem 19 chamadas `console.*` em código de produção (lista da §2.1). O Node formata `console.error(nome, objeto)` como texto, então não existe `jsonPayload` consultável ([C25](PRODUCTION_READINESS_PLAN.md#4-verificação-das-alegações-conhecidas)).
- **CURRENT:** o SDK só registra "Unhandled error" quando o erro **não** é `HttpsError` (`functions/node_modules/firebase-functions/lib/common/providers/https.js:531-532`). Os mapeadores convertem todo erro desconhecido em `HttpsError('internal')` (`functions/src/investments/errors.ts:49-52`, `functions/src/callables/splitGroups.ts:76-98`). Por isso a exceção inesperada nunca aparece no Cloud Logging nem no Error Reporting.
- **CURRENT:** existem helpers de sanitização em `functions/src/shared/observabilityKeys.ts`:
  - `idempotencyKeyDigest` (`:31`), um SHA-256 truncado;
  - `boundedFailureEventId` (`:65`), um ID de falha com cardinalidade limitada;
  - `safeErrorMessage` (`:87-96`), que trunca a mensagem em 500 caracteres e nunca serializa o objeto de erro.

  Só o módulo de investimentos os usa com certeza; o módulo antigo de cartões, que também os usava, foi removido na P4-A; o módulo novo usa o logger compartilhado (`createOperationLogger`) e o mapeador de erros do kernel, não esses helpers.
- **CURRENT:** a sanitização é desigual:
  - o webhook não ecoa a mensagem do SDK nem na resposta nem no log de assinatura inválida (`functions/src/billing/webhook.ts:857-860,892-895`);
  - o cron de faturas antigo (`getErrorMessage` sem truncar, no log e no evento persistido) foi removido na P4-A; a sanitização do `processCreditCardInvoiceClosing` não foi verificada.
- **CURRENT:** alguns pontos seguem uma convenção explícita de não logar valor, descrição ou identificador de pessoa:
  - `functions/src/recurring/scheduler.ts` (P4-B: `recurring_due_failed` só com `workspaceId` e `recurringExpenseId`; os resumos só com contagens);
  - `functions/src/ai/callables.ts:152`;

### 2.3 Correlação

- **CURRENT:** nos callables, o `correlationId` vem sempre do cliente, e não há `requestId` nem trace gerados no servidor. A origem varia por domínio:
  - **Cartões:** rótulo **estático** por tela na tela antiga (`src/components/CreditCardsView.tsx`, reescrita na P4-A; `src/components/TransactionModal.tsx:861`); a correlação do módulo novo é reverificada na P7.
  - **Investimentos:** valor aleatório por tentativa (`src/modules/investments/persistence/intent.ts:89-90`).
  - **Metas:** o ID do documento de idempotência (`functions/src/goals/operations.ts:137`).
  - **`rebuildCashPeriods`:** exige o campo no schema e nunca o usa (`functions/src/cash/rebuild.ts:39`; TX-15).
  - **IA, billing e webhook (P2A, P2B.2):** o `requestId` é gerado no servidor, pelo kernel nas callables e por `randomUUID()` no webhook (`functions/src/webhooks/stripe.ts:30-37`); o log `ai.credit_consumed` carrega nesse contexto o `creditDebitId`, que liga a chamada ao recibo.
  - **Split e gatilho de caixa:** não têm nenhum (o cron de faturas foi reescrito na P4-A; `runId` não verificado). O cron de recorrentes (P4-B) usa `createOperationLogger` com `requestId` `recurring-generation-${scheduleTime}`. O cron de deriva gera `drift-scan-${scheduleTime}` por execução e o grava nos relatórios (`functions/src/crons/investmentDrift.ts:247,332`).
- **CURRENT:** o limite do campo diverge entre as camadas. Investimentos aceitam até 200 caracteres no contrato, e as Rules leem até 128 (INV-15). O contrato antigo de cartões (`functions/src/creditCards/contracts.ts`) saiu na P4-A.

### 2.4 Métricas

- **CURRENT:** não há métrica no Cloud Monitoring. As "métricas" são documentos Firestore por workspace, e desde a P4-A só em investimentos (a de cartões foi removida):

  | Coleção | Formato | Retenção | Evidência |
  | --- | --- | --- | --- |
  | `investment_operational_metrics` | Contador diário por operação e status, 10 shards (`METRIC_SHARDS`), valor em centavos, chave de idempotência só como digest | `expiresAt` com 400 dias | `functions/src/investments/observability.ts:78-128` |
  | `credit_card_operational_metrics` | Removida na P4-A, sem migração (era contador diário sem shard, `amountTotal` em float) | — | — |

- **CURRENT:** a de investimentos é legível só por owner/admin (`firestore.rules`). A UI de cartões deixou de ler métricas (módulo antigo removido na P4-A). Isso é telemetria de produto, não um painel de operação.

### 2.5 Alertas

- **CURRENT:** o repositório não tem política de alerta, dashboard, canal, uptime check nem Terraform (`git ls-files`, sem arquivos de monitoring). A única tabela de alertas sugeridos está num documento OUTDATED que declara "Nada disto é código" (`docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:276-292`). A deriva detectada só produz `console.error("investment_drift_detected")` (`functions/src/crons/investmentDrift.ts:271`).

### 2.6 Trilhas de auditoria existentes

Nomes conferidos no código e nas Rules do HEAD.

| Coleção | Domínio e escritor | Conteúdo | Imutabilidade | Leitura (Rules) | Retenção | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| `goal_audit_logs` | Metas, `writeAudit` na transação do callable | `actorId`, `actorRole`, `operation`, `targetId`, `details` (before/after completos, com texto livre), `correlationId` igual ao ID da idempotência | `transaction.set` com ID da idempotência; Rules `write: false` | owner/admin | Sem `expiresAt` (GOAL-14) | `functions/src/goals/operations.ts:120-141`; `firestore.rules:1181-1184` |
| `credit_card_events` | Cartões (P4-A), na mesma transação da operação | Operação (`operation`), intenção (`intentId`), `cardId` e `occurredAt` (índices `cardId ASC, occurredAt DESC` e grupo `intentId, operation`) | Append-only; Rules `write: false` | owner/admin, `list` com `limit <= 50` | TTL não consta da folha de fatos da P4-A | `functions/src/cards/*.ts`; `firestore.rules` (bloco `credit_card_events`) |
| `financial_events` | Removida na P4-A, sem migração (misturava eventos de domínio, `reconciliation_warning` e `processing_failure` do domínio antigo de cartões; leitura por qualquer membro) | — | — | — | — | — |
| `investment_event_logs` | Investimentos: `outcome: completed` por operação liquidada; `outcome: failed` pela observabilidade | Ator, papel, operação, entidade, `correlationId`, `idempotencyKeyId` | `completed` via `transaction.create`; Rules `write: false` | owner/admin, `list` limitada | `completed`: **sem** `expiresAt`. `failed`: 400 dias | `functions/src/investments/infrastructure.ts:330-360`; `functions/src/investments/observability.ts:216-238`; `firestore.rules:1238-1246` |
| `cash_account_events` | Contas/carteiras e transferências (P3-J), na mesma transação da operação | Operação (`cash_account.created`, `updated`, `archived`, `reactivated`, `cash_transfer.created`, `reversed`), ator, papel, `intentId`, `requestId`, IDs e centavos; sem PII | Append-only; Rules `write: false` | owner/admin, `list` com `limit <= 100` | Sem `expiresAt` (trilha de auditoria: D-18) | `functions/src/accounts/model.ts`; `firestore.rules` (bloco `cash_account_events`) |
| `client_events`, `receivable_events` | Clientes e recebíveis (P3-I), na mesma transação da operação | Operação, ator, papel, intenção, IDs, centavos, status e nomes de campos; nunca PII (documento, e-mail, telefone, endereço, observações) | Append-only; Rules `write: false` | owner/admin, `list` com `limit <= 100` | Sem `expiresAt` (trilha de auditoria: D-18) | `functions/src/receivables/model.ts`; `firestore.rules` (blocos `client_events` e `receivable_events`) |
| `activity_logs` | Caixa: gatilho `onTransactionWrite` | Nomes dos campos alterados e saldo float antes/depois; `userId` do **criador**, não do ator (ENTRY-17) | `set` com ID do evento; `write: false` pelo catch-all | **Qualquer membro**, via catch-all (fora de `isBackendOwnedCollection`) | 365 dias | `functions/src/triggers/transactions.ts:19,103-123`; `firestore.rules:852-877,1436-1441` |
| `investment_drift_reports` | Cron de deriva (operacional, não é auditoria) | Achados por workspace | Rules `write: false` | owner/admin | 400 dias | `functions/src/crons/investmentDrift.ts:240-263`; `firestore.rules:1293-1297` |

- **CURRENT:** `investment_audit_logs` **não existe** no HEAD, nem em `functions/src` nem em `firestore.rules`. Só aparece em documentos OUTDATED (`docs/investments/TTL_MANIFEST.md:44,118`). Hoje a trilha de fato do domínio patrimonial são os eventos `completed` de `investment_event_logs` e os próprios movimentos do ledger.
- **CURRENT:** não têm trilha nenhuma: membership e workspace (PR-WS-02, WS-11), Split (SPLIT-13), ações administrativas (PR-ADMIN-01) e reconstrução de caixa (TX-15).

### 2.7 Reconciliação existente

| Job ou callable | O que compara ou reconstrói | Execução | Saída | Evidência | Classificação |
| --- | --- | --- | --- | --- | --- |
| `processInvestmentDriftScan` | Resumo × soma das posições × último fechamento (não confere o ledger) | Diário às 06:00 (São Paulo); 50 workspaces por execução, em rodízio sobre a coleção global | `investment_drift_reports` + `console.error` | `functions/src/crons/investmentDrift.ts:58,104-146,325-376` | **CURRENT** |
| ~~`recalculateInvestmentPosition`, `recalculateGoalInvestmentProgress`, `rebuildInvestmentProjections`, `backfillInvestmentWorkspace`~~ | Removidas na P4-D (D-15, §19.4 do plano mestre): não há rebuild nem backfill público de projeções de investimento; o reparo operacional contra o ledger e a medição de deriva são trabalho futuro (P6/P7), sem callable hoje | — | — | `functions/src/shared/deploymentContract.test.ts` | **CURRENT** |
| `recalculateCardLimit`, `rebuildCardInvoicesForCard` | Razão do limite e faturas a partir das compras e dos lançamentos (P4-A) | Manual, owner/admin; perfil pesado | A saída de divergência do módulo novo não consta da folha de fatos (o `reconciliation_warning` em `financial_events` saiu com a coleção) | `functions/src/cards/reconciliation.ts`; `functions/src/cards/callables.ts` | **CURRENT (P4-A)** |
| `rebuildCashPeriods` | `cash_report_periods` a partir de `transactions` | Manual, owner/admin, 100/h; cerca de corte contra o gatilho desde P3-B (ENTRY-08 fechado), com recomeço controlado e publicação atômica | Períodos e estado da projeção (`baselineCutoff`, `lastPublishedAt`); sem evento de auditoria (TX-15) | `functions/src/cash/rebuild.ts:410-766` | **CURRENT** |
| `tools/accounts/reconciliar-contas.mjs` (P3-J) | `balanceCents` de cada conta × soma dos seus `cash_account_movements` | Só local, Emulator (recusa sem `FIRESTORE_EMULATOR_HOST` ou com o projeto de produção); dry-run por padrão, `--reparar` corrige; saída 0 (consistente/reparado), 2 (divergência no dry-run), 1 (erro) | Relatório no terminal | `tools/accounts/reconciliar-contas.mjs`; `functions/src/accounts/reconciliation.ts` | **CURRENT** (só ferramenta local; reconciliação agendada: P7) |
| — | Deriva de caixa, cartões, metas, empréstimos, recebíveis, contas × movimentos, Split e Stripe × estado local, em produção e de forma agendada | Não existe (contas × movimentos: só a ferramenta local acima; agendada em P7) | — | `functions/src/index.ts:26-34` (só 3 crons) | **CURRENT** |

### 2.8 Webhook Stripe

- **CURRENT:** o webhook verifica a assinatura sobre `rawBody` (`functions/src/billing/webhook.ts:840-861`), recusa corpo acima de 1 MiB com 413 antes da verificação (`MAX_WEBHOOK_BODY_BYTES`; `functions/src/billing/webhook.ts:844-849`) e, desde P2A:
  - persiste o recibo `billing_webhook_events/{event.id}` (`processing` até o commit do efeito, depois `processed`; TTL de 90 dias; PR-BILL-06 fechado) (`functions/src/billing/webhook.ts:473-476`);
  - responde 2xx às recusas de negócio e aos eventos ignorados, mas grava o recibo `processed` com `outcome` e `reason` (`rejected` ou `ignored`) e um log estruturado, em vez de só uma linha de console. Ainda não há fila de falhas com tentativas e último erro nem como reprocessá-los pelo produto (P7);
  - quando o segredo falta, não há fallback: responde 500 com log `billing.config_missing` (ERROR, só os nomes), sem processar (PR-BILL-05 fechado) (`functions/src/webhooks/stripe.ts:38-51`);
  - falha de entrega: `billing_webhook.failed` (ERROR) com `errorCode` estável (`internal`, `concurrent_update`, `stripe_api_error`, `subscription_cap_exceeded`; função `webhookFailureCode`), `outcome: "error"`, `durationMs`, `stripeEventId`, `stripeEventType` e, para erro do Stripe, `stripeErrorType`; contenção do lease esgotada: `billing_webhook.contention` (WARNING, `errorCode: "lease_contention"`). Em ambos a resposta é 500 e o Stripe reentrega (`functions/src/billing/webhook.ts:784-791,870-896`).
- **CURRENT:** não existe procedimento de replay nem consulta de falhas. A idempotência por `event.id`, que o documento antigo afirmava sem o código ter (`docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:167-169`; FIRE-14), existe desde P2A (`functions/src/billing/webhook.ts:473-476`).

### 2.9 Frontend

- **CURRENT:** o frontend não tem ErrorBoundary, `window.onerror`, handler de `unhandledrejection`, Analytics nem Performance: zero ocorrências de `componentDidCatch|getDerivedStateFromError|window.onerror|unhandledrejection|ErrorBoundary|sentry|firebase/analytics|firebase/performance` em `src`. Quando um chunk falha ao carregar depois de um deploy, a tela fica branca e nada é reportado (FIRE-07).

### 2.10 Testes existentes

- **CURRENT:** estes testes cobrem a observabilidade atual:
  - Os testes de falha e de métrica operacional de cartões (`functions/src/creditCards/__tests__/`) saíram com o módulo antigo na P4-A; a cobertura de falha do módulo novo não foi verificada.
  - `functions/src/investments/__tests__/m3Lifecycle.integration.test.ts`: observabilidade de falha sem vazamento entre tenants.
  - `functions/src/crons/__tests__/investmentDrift.integration.test.ts`: detecção de deriva. Faz skip silencioso sem Emulator (INV-16).
  - `tests/firestore/m4-hardening.rules.integration.test.mjs:207,440-455` e `investment-m3.rules.integration.test.mjs:256-262,280-290`: em `investment_event_logs`, negação de escrita do cliente, isolamento entre tenants e leitura só por owner/admin.
- **CURRENT:** não há teste de logger, correlação, alerta, retry de gatilho, replay de webhook nem trilha de membership (firebase-platform, `existingTests`). Também não há teste de Rules para `activity_logs` e `goal_audit_logs`: nenhuma ocorrência desses nomes em `tests/` e `e2e/` (`financial_events` e `credit_card_audit_logs` foram removidas na P4-A; as coleções de cartões têm suíte própria: `tests/firestore/cards-p4a.rules.integration.test.mjs`).

---

## 3. Contrato de logging (TARGET)

**TARGET (P1 contrato, P7 adoção global):** módulo `functions/src/shared/logging.ts` sobre `firebase-functions/logger`, que grava JSON com `severity`. Todo wrapper de callable, gatilho, cron e webhook passa a usar esse módulo, e `console.*` sai do código de produção.

### 3.1 Campos

| Campo | Obrigatório | Origem e regra |
| --- | --- | --- |
| `event` | Sim | Nome estável em snake_case (`callable_completed`, `callable_failed`, `cron_completed`, `billing_webhook.failed`, `reconciliation_divergence`…). É a chave das métricas da §5 |
| `operation` | Sim | Nome da callable, do cron ou do tipo de evento |
| `outcome` | Sim | `success`, `rejected` (erro de domínio esperado) ou `failed` (erro inesperado) |
| `errorCode` | Na falha | Código canônico do mapeador único (ENTRY-21). Distingue `resource-exhausted` de `failed-precondition` |
| `requestId` | Sim | Gerado no servidor (§4) |
| `logging.googleapis.com/trace` | Quando houver | Derivado de `X-Cloud-Trace-Context` |
| `clientCorrelationId` | Não | Enviado pelo cliente, com no máximo 128 caracteres (alinhado às Rules, INV-15) |
| `workspaceId` | Quando houver | **Só** o workspace já autorizado, nunca o do payload (padrão de `functions/src/investments/callables.ts:86-94`) |
| `actorId` | Quando houver | `uid` do token ou ID de sistema (`system:*`, `stripe`). Nunca e-mail ou nome |
| `actorRole` | Quando houver | Papel resolvido na transação |
| `idempotencyKeyHash` | Quando houver | `idempotencyKeyDigest` (`functions/src/shared/observabilityKeys.ts:31`) |
| `sourceEventId` | Gatilho, cron, webhook | `event.id` do Eventarc ou da Stripe |
| `durationMs` | Sim, no fim | Medido no wrapper |
| `counts` | Crons e jobs | `scanned`, `processed`, `failed`, `truncated` (o formato atual dos resumos) |

### 3.2 Severidade

| Situação | Severidade |
| --- | --- |
| Operação concluída, resumo de cron | `INFO` |
| Rejeição esperada (`invalid-argument`, `permission-denied`, `failed-precondition`, rate limit) | `WARNING` |
| Erro inesperado **antes** de mapear para `HttpsError`, com stack sanitizado | `ERROR` |
| Divergência de reconciliação, segredo ausente, cron truncado | `ERROR` |
| Tentativa cross-tenant (`payload.workspaceId` ≠ contexto autorizado, como em `functions/src/investments/infrastructure.ts:239-248`) | `ERROR` |

### 3.3 Sanitização (TARGET)

- **Proibido:** segredos, tokens, cabeçalho `Authorization`, `rawBody`, assinatura Stripe, payload de callable, valor monetário, descrição ou texto livre, e-mail, nome, CPF/CNPJ, telefone, pergunta ou resposta de IA, conteúdo de comprovante, chave de idempotência crua.
- **Mensagem de erro:** só por `safeErrorMessage` (`functions/src/shared/observabilityKeys.ts:87-96`). O stack só sai com os caminhos de arquivo e sem a mensagem original. O webhook responde com texto genérico (FIRE-10).
- **Volume:** um log por invocação e um resumo por cron. Falha por item em laço é agregada (o formato do cron de faturas antigo saiu na P4-A).
- **Dados pessoais:** `actorId` e `workspaceId` são dados pessoais pseudonimizados. A retenção dos logs segue D-18 e é tratada em [PRIVACY_LGPD.md](PRIVACY_LGPD.md).
- **Regra de erro:** nenhum `catch` em caminho financeiro, de billing ou de segurança converte o erro sem antes logar (ENTRY-13).

---

## 4. Correlation ID de servidor (TARGET)

**TARGET (P1 kernel, P7 cobertura total):**

1. O wrapper único gera `requestId` (UUID) na entrada. O `correlationId` do cliente passa a ser só `clientCorrelationId`.
2. `requestId` vai no log, no registro de idempotência, no evento de domínio, na entrada de auditoria (§7), na métrica de falha e em todo documento gravado na transação que carregue campo de correlação.
3. **Gatilhos:** enquanto existirem, gravam `sourceEventId`. Quando o caixa passar a callables (P3, PR-TX-04), o `requestId` vem do documento escrito pelo callable.
4. **Crons:** geram `runId` por execução e o gravam em cada efeito, inclusive nos alertas de fatura e nos relatórios de deriva.
5. **Webhook:** usa `event.id` como `sourceEventId` e gera `requestId` por entrega (§10).
6. **Erro ao cliente:** `HttpsError.details.requestId`, junto com a mensagem pt-BR do mapeador. O frontend anexa o `requestId` ao reporte de erro (§11). Mostrar esse código na tela é opcional e só entra como mudança mínima de UI aprovada pela `ptbr-product-ui-review`.
7. **Legado a remover (P4, junto com as telas de cartão):** os rótulos estáticos de `TransactionModal.tsx:861` e da tela de cartões antiga (reescrita na P4-A; reverificar).

---

## 5. Métricas (TARGET)

Métricas baseadas em log, derivadas do campo `event` da §3, versionadas em script ou IaC no repositório (FIRE-04). A criação no projeto é **EXTERNAL CONFIGURATION REQUIRED** (E-08).

| Métrica | Tipo | Filtro de log | Rótulos | Milestone |
| --- | --- | --- | --- | --- |
| Erros por callable | Contador | `event="callable_failed"` | `operation`, `errorCode` | P7 |
| Latência por callable | Distribuição | `event` em (`callable_completed`, `callable_failed`), `durationMs` | `operation` | P7 |
| Rejeições por autorização | Contador | `errorCode` em (`permission-denied`, `unauthenticated`) | `operation` | P7 |
| Rate limit atingido | Contador | `errorCode="resource-exhausted"` | `operation` | P7 |
| Execução de cron | Contador + distribuição | `event="cron_completed"` | `operation`, `truncated` | P7 |
| Falha de item em cron | Contador | `counts.failed > 0` | `operation` | P7 |
| Falha de gatilho de caixa | Contador | `event="trigger_failed"` | `operation` | P3 |
| Eventos de webhook | Contador | `event` em (`billing_webhook.processed`, `billing_webhook.failed`, `billing_webhook.contention`, `billing_webhook.signature_invalid`, `billing_webhook.body_too_large`) | `stripeEventType`, `outcome`, `errorCode` | P2A (log), P7 (métrica e alerta) |
| Divergência de reconciliação | Contador | `event="reconciliation_divergence"` | `domain`, `kind` | P7 |
| Consumo de IA | Contador | `event="ai.credit_consumed"` (campos `periodKey`, `creditCost` e `creditDebitId`, correlacionado pelo `requestId` do contexto) | `operation`, `periodKey` | P2B.2 (log), P5 (métrica) |
| Rejeições de App Check | Métrica nativa do App Check | — | serviço | P6 |
| Erro no frontend | Contador | `event="client_error"` (§11) | `kind` | P7 |

**TARGET:** o módulo compartilhado de observabilidade (legado P7 da [§7 do plano](PRODUCTION_READINESS_PLAN.md#7-legado-a-remover)) substitui `functions/src/investments/observability.ts` (a de cartões saiu com `functions/src/creditCards/**` na P4-A). Métricas de operação saem do Firestore por workspace e vão para as métricas baseadas em log. Se o produto quiser manter contadores visíveis ao tenant, a coleção fica em centavos, com shards e `expiresAt`. Eventos de falha operacional saem de `financial_events`.

---

## 6. Alertas (TARGET — EXTERNAL CONFIGURATION REQUIRED E-08)

Nenhum destes alertas existe no HEAD. As condições são valores iniciais a calibrar em STAGING (limiares e SLO: D-28). O destinatário padrão é o **plantão técnico** (escala e canal: D-28). Papéis, canais e contatos ficam em [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md), e os procedimentos citados na coluna "Runbook" ficam em [RUNBOOKS.md](RUNBOOKS.md). Um alerta só conta como pronto com a evidência de ter disparado em STAGING e chegado ao destinatário (coluna "Última verificação" da §13).

| # | Sinal | Condição inicial | Destinatário | Runbook | Milestone | Classificação |
| --- | --- | --- | --- | --- | --- | --- |
| A01 | Erro inesperado em callable | ≥ 5 `callable_failed` com `outcome=failed` em 5 min, ou > 1% das chamadas em 15 min | Plantão técnico | Erro interno em callable (busca por `requestId`) | P7 | TARGET / E-08 |
| A02 | Latência | p95 > 2 s em callable de domínio, ou > 60 s em callable pesada, por 15 min | Plantão técnico | Degradação de latência e contenção | P7 | TARGET / E-08 |
| A03 | Cron não executou | Ausência de `cron_completed` de cada um dos 3 crons em 26 h | Plantão técnico | Cron ausente ou com falha | P7 | TARGET / E-08 |
| A04 | Cron truncado ou com falha de item | `truncated=true` em 2 execuções seguidas, ou `counts.failed > 0` | Plantão técnico | Cron ausente ou com falha | P7 | TARGET / E-08 |
| A05 | Falha do gatilho de caixa | Qualquer `trigger_failed` ou retry esgotado | Plantão técnico | Projeção de caixa divergente e rebuild | P3 | TARGET / E-08 |
| A06 | Divergência financeira | Qualquer `reconciliation_divergence` (investimentos, caixa, cartões, metas, empréstimos, recebíveis) | Plantão técnico + responsável pelo domínio financeiro | Reparo de deriva sem apagar histórico | P7 | TARGET / E-08 |
| A07 | Varredura de reconciliação falhou | Qualquer `reconciliation_scan_failed` (hoje `investment_drift_scan_workspace_failed`) | Plantão técnico | Reparo de deriva sem apagar histórico | P7 | TARGET / E-08 |
| A08 | Webhook Stripe com falha | ≥ 1 `billing_webhook.failed` (ERROR; `errorCode` `internal`, `concurrent_update`, `stripe_api_error` ou `subscription_cap_exceeded`), ou `billing_webhook.contention` (WARNING, `errorCode: "lease_contention"`) repetido para o mesmo `stripeEventId`, ou entrada não resolvida na fila de falhas há mais de 1 h | Plantão técnico + responsável por billing | Falha de webhook e replay | P7 (fila e alerta; o log existe desde P2A) | TARGET / E-08 |
| A09 | Assinatura de webhook inválida | ≥ 3 `billing_webhook.signature_invalid` ou `billing_webhook.signature_missing` em 10 min, ou qualquer pico de `billing_webhook.body_too_large` | Plantão técnico | Falha de webhook e replay; segredo exposto ([INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)) | P7 | TARGET / E-08 |
| A10 | Webhook silencioso | Nenhum `billing_webhook.processed` (nem recibo novo em `billing_webhook_events`) em 24 h com assinaturas ativas | Responsável por billing | Falha de webhook e replay | P7 | TARGET / E-08 |
| A11 | Segredo ou configuração ausente | Qualquer `billing.config_missing` (ERROR, só com os nomes em `names`: segredos Stripe, Prices e `APP_ALLOWED_ORIGINS`). A chave de IA ainda não tem evento próprio: a falha sai como `callable.end` com `domain_precondition_failed` | Plantão técnico | Configuração ausente (E-05) | P7 (alerta; o log existe desde P2A) | TARGET / E-08 |
| A12 | Pico de negação de autorização | > 20 `permission-denied` do mesmo ator em 10 min | Plantão técnico + segurança | Suspeita de abuso ou cross-tenant | P7 | TARGET / E-08 |
| A13 | Tentativa cross-tenant | Qualquer log de `workspaceId` do payload diferente do autorizado | Segurança | Suspeita de abuso ou cross-tenant | P7 | TARGET / E-08 |
| A14 | Rejeição de App Check | Pico acima da linha de base semanal | Segurança | Abuso de API e App Check | P6 (enforcement), P7 (alerta) | TARGET / E-08 |
| A15 | Rate limit de IA e checkout | > 50 `resource-exhausted` por hora | Plantão técnico | Abuso de API e App Check | P7 | TARGET / E-08 |
| A16 | Custo e quota | Budget do projeto a 50/90/100%; quota da API Gemini a 80% | Responsável financeiro + plantão | Estouro de custo | P7 | TARGET / E-08 |
| A17 | Backup | Falha de backup agendado ou export | Plantão técnico | Restore ([BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md), E-07) | P7 | TARGET / E-07, E-08 |
| A18 | Disponibilidade do Hosting | Uptime check falha em 2 regiões por 5 min | Plantão técnico | Indisponibilidade e rollback de deploy | P7 | TARGET / E-08 |
| A19 | Erros no frontend | `client_error` > 3× a linha de base em 15 min, ou pico de `chunk_load_error` após deploy | Plantão técnico | Deploy defeituoso e rollback | P7 | TARGET / E-08 |
| A20 | Ação administrativa de plataforma | Qualquer entrada em `admin_audit_logs` | Segurança | Acesso administrativo (PR-ADMIN-01, D-10) | P7 | TARGET / E-08 |

---

## 7. Trilha de auditoria unificada (TARGET)

### 7.1 Onde grava

O gravador é único e os destinos são por escopo, como em [ARCHITECTURE.md](ARCHITECTURE.md):

- **Gravador (TARGET, P1):** `functions/src/shared/audit.ts`, do kernel. Grava na **mesma transação** do efeito, com `transaction.create` e ID derivado da chave de idempotência. Retry idempotente não duplica registro, e nenhum caminho sobrescreve um registro, ao contrário do `set` atual em `functions/src/goals/operations.ts:131` (o de cartões saiu na P4-A).
- **`workspaces/{workspaceId}/financial_events` (TARGET, P3–P5):** eventos e auditoria dos domínios financeiros. Fica só com eventos de domínio: `processing_failure` sai (§7.6), e a leitura passa a owner/admin (§7.4). Em P3, junto com PR-TX-05, confirma-se o uso da coleção para o caixa, como indica [DATA_MODEL.md](DATA_MODEL.md). A coleção `financial_events` do domínio antigo de cartões foi removida na P4-A, sem migração.
- **`workspaces/{workspaceId}/membership_events` (TARGET, P1):** ciclo de vida de workspace e membership (PR-WS-02, WS-11), detalhado em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md).
- **`admin_audit_logs`, na raiz, server-only (TARGET, P7):** ações de operador de plataforma (PR-ADMIN-01, D-10).
- **Billing (CURRENT, P2A):** o processamento vai para o recibo `billing_webhook_events/{event.id}` (PR-BILL-06) e a mudança de plano para a trilha append-only `billing_accounts/{uid}/billing_events`, gravados na mesma transação do efeito (`functions/src/billing/audit.ts`). A remediação de PR-BILL-06 na auditoria chamava essa trilha de `billing_audit`; D-01 (titular único) fixou o nome e o lugar.

### 7.2 Ações sensíveis cobertas

| Categoria | Ações | Destino | Milestone do escritor | GAP de origem |
| --- | --- | --- | --- | --- |
| Conta e workspace | `bootstrapAccount`, `createWorkspace`, configurações, arquivamento | `membership_events` | P1 | PR-AUTH-03 |
| Membership | Convite criado, aceito, revogado ou expirado; troca de papel; remoção lógica; saída; transferência de ownership | `membership_events` | P1 | PR-WS-02 (WS-11) |
| Billing | Checkout iniciado, assinatura criada, alterada ou cancelada, inadimplência, reembolso, disputa, mudança de entitlement | `billing_webhook_events` + `billing_accounts/{uid}/billing_events` (D-01) | P2A (entregue) | PR-BILL-06 |
| Caixa | Lançamento, edição (antes/depois em centavos), anulação, rebuild com `reason` | `cash_events`: criação desde P3-A (`cash_entry.created`, `functions/src/shared/audit.ts:124`; linha importada com `channel: import` desde P3-D, um evento por linha); correção e anulação desde P3-C (`cash_entry.updated`, `cash_entry.voided`, `functions/src/shared/audit.ts:211`); confirmação de pendente desde P3-F (`cash_entry.confirmed`, antes e depois com estado e vencimento; todo evento grava `entryStatus`), com antes e depois em centavos, motivo, ator, papel, intenção e correlação. O caminho legado do cliente saiu na P4-D (sem escritor de `transactions` no cliente). `financial_events` tem leitura de qualquer membro e formato do domínio de cartões (`firestore.rules`, bloco `financial_events`), então a trilha de caixa ficou separada até a consolidação de P7 | P3 | PR-TX-05 (resolvido na P4-D), TX-15 |
| Empréstimos e recebíveis | Contrato, pagamento, estorno, cancelamento, recebimento, arquivamento | Empréstimos: `loan_events` (P3-G/P3-H, toda escrita passa pelas callables); contas e transferências: `cash_account_events` (P3-J, toda escrita passa pelas callables); clientes e recebíveis: `client_events` e `receivable_events` (P3-I, toda escrita passa pelas callables; só IDs, centavos, status e nomes de campos; logs do kernel só com IDs) | P3 | — (CR-09 e LOAN-10 resolvidos) |
| Cartões | Cadastro, limite, ciclo, status, arquivamento, compras, pagamentos e ajustes | `credit_card_events` (P4-A; toda escrita passa pelas callables) | P4-A (concluída) | PR-CC-02 resolvido na P4-A (plano §19.1) |
| Recorrentes | Criação, edição (com `amountChanged`), pausa, retomada, cancelamento, ocorrência gerada, aguardando, em atenção, confirmada, ignorada e reaberta | `recurring_events` (P4-B; append-only, na mesma transação de cada operação, com ator, papel, operação, intenção, `requestId`, `correlationId`, antes/depois e `reason`) | P4-B (concluída, plano §19.2) | REC-12 resolvido |
| Split | Título, rateio, pagamento, arquivamento | `financial_events` | P4 | SPLIT-13 |
| Metas e investimentos | Ações atuais, migradas para o formato único | `financial_events` | P5 (metas), P7 (consolidação) | GOAL-14 |
| Dados pessoais | Exportação, exclusão de conta ou workspace, anonimização | `membership_events` (workspace) e `admin_audit_logs` (operador) | P8 | PR-AUTH-01 |
| Administração e suporte | Suspensão e revogação de sessão por operador, toda consulta ou ação de operador, replay de webhook, reconciliação disparada por suporte | `admin_audit_logs` | P1 (mecanismo), P7 (superfície) | PR-ADMIN-01 |

### 7.3 Esquema do registro (TARGET)

| Campo | Regra |
| --- | --- |
| `id`, `schemaVersion` | ID determinístico; versão do esquema |
| `workspaceId` | Workspace efetivo, autorizado |
| `action` | `dominio.verbo` (`membership.role_changed`, `cash.transaction_voided`…) |
| `actorType`, `actorId`, `actorRole` | `user`, `system`, `stripe` ou `platform_admin`. `uid` ou ID de sistema. Papel relido na transação |
| `targetType`, `targetId` | Entidade afetada |
| `outcome` | `applied`. Rejeições vão para o log, não para a auditoria |
| `before`, `after` | Diff mínimo dos campos alterados, com dinheiro em centavos e sem texto livre. Resolve o problema de `goal_audit_logs` gravar o documento inteiro (GOAL-14) |
| `reason` | Obrigatório em estorno, anulação, cancelamento, rebuild e ação administrativa |
| `requestId`, `clientCorrelationId`, `idempotencyKeyHash`, `sourceEventId` | Correlação (§4). A chave de idempotência nunca vai crua (a trilha antiga de cartões, que a gravava em claro, foi removida na P4-A) |
| `occurredAt` | `FieldValue.serverTimestamp()` |

### 7.4 Imutabilidade, acesso e índices (TARGET)

- **Gravação:** Rules `allow write: if false` em `financial_events`, `membership_events`, `admin_audit_logs` e na trilha de billing, provadas por teste no Emulator: o cliente não cria, altera nem apaga.
- **Leitura:** só owner/admin, com `limit` obrigatório e cursor, e nenhuma trilha ao alcance do catch-all de leitura. Hoje `activity_logs` é legível por qualquer membro (`firestore.rules:1436-1441`); `financial_events` foi removida na P4-A. Se o produto precisar mostrar eventos a member ou viewer, faz isso por projeção própria, sem abrir a trilha.
- **Índices:** os índices compostos das consultas de auditoria (por `targetId`, `action` e `occurredAt desc`) ficam versionados em `firestore.indexes.json` no mesmo milestone. Essa é a lição de PR-CC-08.

### 7.5 Retenção (DECISION)

- **DECISION D-18 (pendente):** fixa o prazo da trilha de auditoria. Até lá, os registros de auditoria **não** recebem `expiresAt` e ficam fora de toda política de TTL (`functions/src/shared/retention.ts:11-15`).
- **DECISION D-07 (pendente):** resolve o que acontece com o ator de um histórico compartilhado quando a conta é excluída. Anonimizar o `actorId` preserva a trilha. Apagar o registro não é permitido.

### 7.6 Consolidação e legado (TARGET)

Pela [política de legado](PRODUCTION_READINESS_PLAN.md#política-de-legado), cada trilha antiga sai no milestone que a substitui, junto com Rules e índices. Os dados de teste são recriados, não migrados.

| Trilha atual | Substituída por | Milestone |
| --- | --- | --- |
| `activity_logs` (gatilho de caixa) | Evento `cash.*` em `financial_events`, gravado pelo callable (PR-TX-05) | P3 |
| `credit_card_audit_logs` | Removida na P4-A, sem migração; a trilha de cartões é `credit_card_events` | P4-A (concluída) |
| `goal_audit_logs` | `financial_events` com `action` `goal.*` | P7, ou P5 se o escritor for reescrito nas correções de metas |
| `investment_event_logs` `completed` | `financial_events` com `action` `investment.*` | P7 |
| `investment_event_logs` `failed`, `*_operational_metrics` | Logger e métricas baseadas em log (§5) | P7 |
| `processing_failure` e `reconciliation_warning` em `financial_events` | Log `callable_failed` ou `reconciliation_divergence` + alerta (A01, A06). `financial_events` fica só com fatos de domínio | P7 |

A [§7 do plano](PRODUCTION_READINESS_PLAN.md#7-legado-a-remover) já lista estas trilhas como legado de P7. A antecipação de `activity_logs` para P3 (PR-TX-05) e as alternativas P4/P5 desta tabela precisam ser refletidas no plano quando esses milestones forem executados.

---

## 8. Eventos de segurança (TARGET)

| Evento | Fonte | Registro | Alerta |
| --- | --- | --- | --- |
| Chamada não autenticada ou sem papel | Wrapper único | Log `WARNING` com `operation`, `actorId` e `errorCode`. CURRENT: só investimentos registram com certeza (`functions/src/investments/observability.ts:179-185`); o registro do módulo antigo de cartões saiu na P4-A (módulo novo: a verificar) | A12 |
| Workspace do payload diferente do autorizado | Resolvedor único (P1) | Log `ERROR` | A13 |
| Rejeição de App Check | Plataforma (P6) | Métrica nativa | A14 |
| Mudança de papel, ownership, suspensão | Callables de P1 | Auditoria (§7) | Não (consulta) |
| Acesso ou ação de administrador de plataforma | Callables administrativas (D-10) | `admin_audit_logs` | A20 |
| Falha de assinatura de webhook | `stripeWebhook` | Log `billing_webhook.signature_invalid` (WARNING); assinatura ausente: `billing_webhook.signature_missing` | A09 |
| Login e falhas de autenticação | Firebase Auth (Cloud Audit Logs) | **EXTERNAL CONFIGURATION REQUIRED** (E-03, E-08) | A definir com D-06 |

---

## 9. Reconciliação financeira por domínio (TARGET)

A fórmula de cada comparação fica em [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md). Aqui fica a exigência operacional. Todo job:

- roda por cursor persistido ou rodízio, com cobertura de todos os tenants ativos num prazo definido;
- é idempotente;
- grava o resultado em coleção server-only com `runId`;
- emite `reconciliation_divergence` (alerta A06);
- repara por rebuild cercado ou lançamento compensatório, **nunca** apagando histórico.

| Domínio | Fonte oficial × projeção | CURRENT | TARGET | Milestone |
| --- | --- | --- | --- | --- |
| Investimentos | `investment_movements` × posições × resumo × períodos | Resumo × posições, 50 workspaces por dia, só `console.error` (INV-05, READ-17) | Conferir também ledger × posição por amostragem, e movimento × espelho de caixa. Rodízio só sobre workspaces alterados. Alerta | P7 |
| Caixa | `transactions` × `cash_report_periods` | `rebuildCashPeriods` manual com cerca de corte (P3-B) e sinal `needsRebuild` quando o gatilho percebe divergência | Varredura agendada de deriva de caixa, alerta sobre `cash_projection.needs_rebuild`/`.failed`, `reason` e `requestId` persistidos (TX-15) | P3 (job), P7 (alerta) |
| Cartões | Compras, lançamentos, pagamentos e `credit_card_limit_ledger` × faturas e `limitUsedCents` | Só reconciliação manual (`recalculateCardLimit`, `rebuildCardInvoicesForCard`, owner/admin) | Varredura agendada com cursor; divergência vira `reconciliation_divergence` + alerta | P4 (job), P7 (alerta) |
| Metas | Posições vinculadas × progresso da meta | Nenhuma (`recalculateGoalInvestmentProgress` removida na P4-D; reparo futuro, P6/P7) | Conferência na mesma varredura de investimentos | P5 |
| Empréstimos | Movimentos × saldo e status do contrato | Inexistente como varredura agendada; a invariante `balanceCents + totalPrincipalSettledCents = principalCents` é verificada em toda operação (falha fechada) | Varredura agendada acumulados × movimentos | P7 |
| Recebíveis | Recebimento × espelho de caixa vinculado (`recvcash_<hash>`) e saldo × movimentos | Inexistente como varredura agendada; as invariantes do saldo e do status são verificadas em toda operação (documento fora do schema falha fechado) | Varredura agendada acumulados × movimentos × espelhos | P7 |
| Split | Rateios e pagamentos × lançamentos de caixa e cartão | Inexistente | Varredura do novo módulo `splitBills` | P4 |
| Billing | Assinatura na Stripe × estado de assinatura e entitlement local | Inexistente como job: a releitura do Stripe a cada evento, sob lease, existe desde P2A, mas não há varredura periódica | Conciliação periódica via API da Stripe | P7 (job e alerta, PR-OBS-01) |

**TARGET:** superfície operacional para disparar rebuild e reconciliação como suporte, com papel próprio e auditoria. Hoje só owner/admin do workspace dispara, e sem UI montada (FEW-15). Depende de D-10.

---

## 10. Falhas de webhook e replay (CURRENT em P2A; fila e replay TARGET em P7)

O contrato de processamento é o de [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md). Esta seção cobre visibilidade, alerta e replay.

1. **Registro por evento (P2A, PR-BILL-06, CURRENT):** `billing_webhook_events/{event.id}` é server-only, sem payload, e guarda `type`, `livemode`, `stripeCreatedAt`, `billingOwnerUid`, `status` (`processing` até o commit do efeito, `processed` depois), `outcome` (`applied`, `recorded`, `ignored` ou `rejected`, com `reason`), `processedAt` e `expiresAt` (90 dias, TTL). O recibo `processed` é gravado na mesma transação do efeito, e evento repetido não o reaplica. A recusa de negócio deixa de ser só uma linha de console e fica registrada e consultável como `rejected` ou `ignored`.
2. **Respostas (P2A, CURRENT):** 2xx só depois de persistir.
   - Configuração ausente ou inválida responde 500, loga `billing.config_missing` (ERROR, só os nomes) e não processa (PR-BILL-05).
   - Falha transitória responde 500 e loga `billing_webhook.failed` (ERROR) com `errorCode` estável (`internal`, `concurrent_update`, `stripe_api_error`, `subscription_cap_exceeded`), `outcome: "error"`, `durationMs`, `stripeEventId`, `stripeEventType` e, para erro do Stripe, `stripeErrorType`, para o Stripe reenviar. Esgotadas as esperas pelo lease do titular, loga `billing_webhook.contention` (WARNING, `errorCode: "lease_contention"`) e responde 500; contenção nunca vira sucesso.
   - Sucesso loga `billing_webhook.processed` com `outcome` e `durationMs`. Corpo acima de 1 MiB responde 413 e loga `billing_webhook.body_too_large` (WARNING) antes da verificação da assinatura; assinatura ausente ou inválida responde 400 e loga `billing_webhook.signature_missing` ou `.signature_invalid` (WARNING).
3. **Fila de falhas (P7, PR-OBS-01, TARGET):** como o efeito e o recibo `processed` são atômicos, uma falha de entrega deixa no máximo o recibo `processing`, sem tentativas nem último erro, e o log `billing_webhook.failed`. A falha é gravada fora dessa transação em `stripe_event_failures/{event.id}` (nome proposto; server-only), com:
   - `type`, `attempts`, `firstFailedAt`, `lastFailedAt`, `lastErrorCode`, `requestId`;
   - `resolvedAt` e `resolvedBy`, preenchidos quando o evento é processado. A entrada é marcada como resolvida, nunca apagada.

   Essa fila atende a "fila e replay de falhas de webhook" do escopo de P7. A consulta é paginada por `resolvedAt == null` e `lastFailedAt`, com índice versionado. Os alertas são A08–A11.
4. **Replay (P7):** o procedimento fica em [RUNBOOKS.md](RUNBOOKS.md). Há dois caminhos:
   - reenvio pelo painel ou CLI da Stripe (EXTERNAL, E-06);
   - reprocessamento por callable administrativa que relê o evento pela API da Stripe e reaplica pelo mesmo caminho idempotente, com entrada em `admin_audit_logs`. Depende de D-10.

   O replay é provado por teste: um evento que falhou, reprocessado, aplica o efeito uma vez só e marca a entrada da fila como resolvida.
5. **Retenção:** o prazo de `billing_webhook_events` (90 dias, `functions/src/shared/retention.ts:53`) e o da fila seguem D-18, com a política de TTL registrada em E-07. O prazo não pode ser menor que a janela em que a Stripe permite reenviar eventos, valor confirmado em E-06.

---

## 11. Frontend: captura de erros (TARGET)

- **TARGET (P7):** `ErrorBoundary` na raiz com tela de falha em pt-BR. É uma mudança de UI estritamente necessária: substitui a tela branca de hoje e passa pela `ptbr-product-ui-review`. Junto vêm handlers de `error` e `unhandledrejection` e a detecção de falha de carregamento de chunk, com recarga controlada (FIRE-07).
- **TARGET:** o reporte vai para um endpoint first-party com App Check e rate limit, que registra `event="client_error"` pelo logger da §3. O payload leva:
  - nome e mensagem truncados, `kind` e rota sem IDs;
  - versão do build e `requestId` quando houver.

  O payload não leva dados financeiros, texto digitado, e-mail nem conteúdo do estado.
- **DECISION [D-25](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision) (pendente):** usar ferramenta de terceiros no frontend em vez do endpoint próprio. Se for escolhida, entra em [SUBPROCESSORS.md](SUBPROCESSORS.md) e [PRIVACY_LGPD.md](PRIVACY_LGPD.md) antes do uso.

---

## 12. Lacunas (GAP)

| ID | Sev. | Milestone | Lacuna | Evidência (HEAD `9c3ab46`) |
| --- | --- | --- | --- | --- |
| PR-OBS-01 | HIGH | P7 | Sem observabilidade global: `console.*` não estruturado, erros internos invisíveis, `correlationId` estático do cliente, sem métricas nem alertas. Origem: FIRE-04, ENTRY-13, ENTRY-16 | `functions/src/goals/callables.ts:53-54`; `functions/src/cash/rebuild.ts:270-271` |
| PR-OBS-02 | HIGH | P7 | Sem processo de resposta a incidentes nem mecanismos de contenção (interruptor por funcionalidade, modo somente leitura, revogação de sessão); detalhe em [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) | `grep revokeRefreshTokens\|checkRevoked\|setCustomUserClaims\|killSwitch\|readOnlyMode` em `src` e `functions/src`: 0 ocorrências |
| PR-TX-04 | HIGH | P3 | Projeção de caixa diverge em silêncio: gatilho e crons sem retry, documento quente, rebuild sem cerca. Origem: TX-08, FIRE-05, ENTRY-06, ENTRY-08, TX-15 | `functions/src/triggers/transactions.ts:35-37`; `functions/src/shared/runtimeOptions.ts:41-44` |
| PR-TX-05 | HIGH | P3 | Sem trilha imutável de edição e anulação de transação. **Resolvido na P4-D (plano §19.4):** criação, correção e anulação só pelo backend, com trilha em `cash_events`; sai do registro no gate de P4 | `cash_events` (`functions/src/shared/audit.ts`); `firestore.rules` (`transactions` sem escrita do cliente) |
| PR-BILL-06 | HIGH | P2 | Webhook sem registro por `event.id`, sem ordem e sem trilha (fechado em P2A; PLAN §17.3) | `functions/src/billing/webhook.ts:473-476` |
| PR-BILL-05 | HIGH | P2 | Segredos Stripe com fallback placeholder, falha invisível (fechado em P2A; PLAN §17.3) | `functions/src/billing/config.ts:72-88`; `functions/src/webhooks/stripe.ts:38-51` |
| PR-CC-08 | HIGH | P4-A | **Resolvido na P4-A (plano §19.1):** índice `credit_card_events (cardId ASC, occurredAt DESC)` (antes, consulta de `credit_card_audit_logs` sem índice composto) | `firestore.indexes.json` |
| PR-WS-02 | HIGH | P1 | Mutações de membership sem auditoria (WS-11) | `src/modules/workspaces/api.ts:236-264` |
| PR-ADMIN-01 | HIGH | P7 | Sem ações administrativas auditadas | `src/contexts/AuthContext.tsx:55-61` |

As lacunas MEDIUM e LOW abaixo usam o ID de origem da auditoria. O milestone é uma proposta deste documento, e o domínio correspondente a confirma.

| ID | Sev. | Milestone | Lacuna | Evidência |
| --- | --- | --- | --- | --- |
| ENTRY-13 | MEDIUM | P7 | Erros desconhecidos engolidos sem Cloud Logging; 19 `console.*` (parte de PR-OBS-01) | `functions/src/investments/errors.ts:49-52` |
| ENTRY-16 | MEDIUM | P7 | Crons truncados sem alerta; deriva cobre 50 workspaces por dia; sem retry (parte de PR-OBS-01; o cron de faturas ganhou paginação e sinal `truncated` explícito na P4-A) | `functions/src/cards/closing.ts`; `functions/src/crons/investmentDrift.ts:58` |
| ENTRY-17 | MEDIUM | P3 | `activity_logs` atribui a alteração ao criador, não ao ator | `functions/src/triggers/transactions.ts:108` |
| INV-05 | MEDIUM | P7 | Deriva só entre projeções, ciclo lento, sem alerta nem reparo operável | `functions/src/crons/investmentDrift.ts:104-146,271` |
| INV-10 | MEDIUM | P7 | Rate limit não conta falhas; um evento de falha por chave escolhida pelo cliente | `functions/src/shared/observabilityKeys.ts:65-72`; `functions/src/investments/observability.ts:216-238` |
| TX-15 | MEDIUM | P3 | Rebuild de caixa ignora `idempotencyKey`, `correlationId` e `reason` (parte de PR-TX-04) | `functions/src/cash/rebuild.ts:36-41` |
| CC-11 | MEDIUM | P4-A | **Resolvido na P4-A (PR-CC-04, plano §19.1):** `processCreditCardInvoiceClosing` filtra `cycleStatus == open` e `closingDate <= hoje`, pagina por `closingDate, __name__` (200 por página, até 25 páginas) com sinal `truncated` e relê cada fatura na transação | `functions/src/cards/closing.ts` |
| FIRE-08 | MEDIUM | P6 | TTL versionado no repositório desde P1–P4-D (12 `fieldOverrides`); falta publicar e conferir por ambiente (E-07) e cobrir `activity_logs` (D-18) | `firestore.indexes.json` |
| FEW-15 | MEDIUM | P7 | Reconciliação sem superfície operacional; desde a P4-D também sem callable de rebuild de investimentos (reparo medido contra o ledger em P6/P7) | `src/modules/investments/persistence/operationsApi.ts` saiu na P4-D com a superfície profissional (plano §19.4) |
| CR-09 (LOAN-10 resolvido na P3-H) | MEDIUM | P3 | **Resolvido na P3-I:** clientes e recebíveis passam só pelas callables, que gravam `client_events` e `receivable_events` append-only com ator, papel, intenção, IDs, centavos, status e nomes de campos, sem PII, e usam o tempo do servidor. Empréstimos: toda escrita passa pelas callables (Rules negam o cliente), que gravam `loan_events` append-only com ator, papel, intenção, correlação, antes/depois financeiros e motivo, sem dado da contraparte; a rotina `processLoanStatusRefresh` registra `loan.status_refreshed` e loga só IDs | `functions/src/receivables/model.ts` |
| SPLIT-13, REC-12 | MEDIUM | P4 | **REC-12 resolvido na P4-B:** Recorrentes grava `recurring_events` append-only (ator, papel, operação, `requestId`, `correlationId`, antes/depois). Split segue sem auditoria (SPLIT-13, P4-C) | `functions/src/recurring/model.ts` |
| ENTRY-21 | LOW | P1 | Quatro mapeadores de erro; rate limit como `failed-precondition` | `functions/src/shared/rateLimit.ts:121-126` |
| INV-15 | LOW | P1 | `correlationId` com limite divergente entre contrato (200) e Rules (128) | `functions/src/investments/contracts.ts:19`; `firestore.rules:625` |
| GOAL-14 | LOW | P5 | Auditoria de metas sem retenção e com documento inteiro | `functions/src/goals/operations.ts:207-209,244-247` |
| CC-20 | LOW | P4-A (parcial) | Coleções operacionais antigas de cartão (`credit_card_operational_metrics`, `credit_card_idempotency_keys`) removidas na P4-A; o TTL do domínio novo não consta da folha de fatos (reavaliar na P7) | `firestore.indexes.json` |
| INV-16, FIRE-13 | LOW | P7 | Testes de observabilidade e deriva fazem skip sem Emulator | `functions/src/crons/__tests__/investmentDrift.integration.test.ts:105` |

---

## 13. Configuração externa (EXTERNAL CONFIGURATION REQUIRED — E-08)

Registro exigido pela [§11 do plano](PRODUCTION_READINESS_PLAN.md#11-configuração-externa-necessária-external-configuration-required). Nenhum item foi verificado. Cada linha só muda de estado com evidência datada, colhida em STAGING e depois em PROD (P6/P7).

| Item | Valor esperado | Estado | Última verificação | Responsável |
| --- | --- | --- | --- | --- |
| Canais de notificação | Canal do plantão e canais de segurança e billing, com teste de entrega | NÃO VERIFICADO | — | — |
| Métricas baseadas em log | As da §5, criadas por script versionado | NÃO VERIFICADO | — | — |
| Políticas de alerta | A01–A20, com condição, dono e link de runbook | NÃO VERIFICADO | — | — |
| Error Reporting | Ativo e recebendo os erros `ERROR` do logger | NÃO VERIFICADO | — | — |
| Uptime check | Hosting de PROD e STAGING (A18) | NÃO VERIFICADO | — | — |
| Retenção de logs | Bucket com retenção explícita (prazo em D-18); sink com retenção bloqueada para evidência forense | NÃO VERIFICADO | — | — |
| Cloud Audit Logs | Admin Activity revisado; decidir Data Access para Firestore e Secret Manager (custo × forense) | NÃO VERIFICADO | — | — |
| Acesso a logs | Papéis de leitura de log restritos e auditados (E-04) | NÃO VERIFICADO | — | — |
| Budget e quotas | Alertas de budget por projeto; quota e alerta da API Gemini (A16) | NÃO VERIFICADO | — | — |
| Alertas relacionados | Falha de backup (E-07); segredo ausente (E-05); endpoint e eventos do webhook (E-06); métricas de App Check (E-02) | NÃO VERIFICADO | — | — |

---

## 14. Decisões (DECISION)

| Decisão | Estado | Efeito neste documento |
| --- | --- | --- |
| [D-18](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision) | Pendente | Prazos de logs, auditoria, `billing_webhook_events` e métricas |
| [D-07](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision) | Pendente | Anonimização do ator na trilha após exclusão de conta |
| [D-01](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision) | Pendente | Onde vivem a auditoria de billing e o registro de entitlement |
| [D-10](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision) | Pendente | `admin_audit_logs`, replay administrativo e superfície de reconciliação |
| [D-21](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision) | Pendente | Contatos e canal de suporte usados nos destinatários |
| [D-ORD-02](PRODUCTION_READINESS_PLAN.md#9-decisões-de-ordenação-e-escopo-tomadas-em-p0), [D-ORD-04](PRODUCTION_READINESS_PLAN.md#9-decisões-de-ordenação-e-escopo-tomadas-em-p0) | Tomadas | Logger, correlação e auditoria no kernel de P1; alertas só exercitados em STAGING depois de P6 |
| [D-25](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision) | Pendente | Monitoramento de erros do frontend: endpoint próprio (§11) ou terceiro (novo subprocessador) |
| [D-28](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision) | Pendente | Stack de observabilidade, escala e canal de plantão, limiares e SLO iniciais dos alertas (§6) |

---

## 15. Testes obrigatórios (TARGET)

Os testes cobrem o §13 do checklist da skill. Todos rodam no Emulator ou como unitários, e nenhum faz skip silencioso.

1. **Logger (P1):** saída JSON com os campos da §3.1. A sanitização remove segredo, token, e-mail, valor e texto livre. Erro inesperado é logado antes do `HttpsError`.
2. **Correlação (P1/P3):** um callable produz o mesmo `requestId` no log, na idempotência, no evento e na auditoria. O `HttpsError.details.requestId` chega ao cliente.
3. **Auditoria (P1 em diante):** a ação sensível gera um registro completo, e o retry não duplica. As Rules negam create, update e delete do cliente em `financial_events`, `membership_events` e `admin_audit_logs` e limitam a leitura a owner/admin.
4. **Contrato de implantação:** `functions/src/shared/deploymentContract.test.ts` passa a exigir retry em todo `eventTrigger` e `retryConfig` nos crons (FIRE-05/PR-TX-04).
5. **Reconciliação (P3/P4/P7):** uma divergência injetada é detectada, persistida e logada como `reconciliation_divergence`.
6. **Webhook (P2A/P7):** em P2A, segredo ausente responde 500 sem processar e a falha de entrega sai como `billing_webhook.failed` com `errorCode` estável. Em P7, um evento com falha fica consultável na fila de falhas (`stripe_event_failures`), e o replay aplica o efeito uma vez só e marca a entrada como resolvida.
7. **Frontend (P7):** erro de renderização mostra o fallback pt-BR e envia `client_error` sem dados pessoais.

**Critério de saída de P7:** `observability-incident-readiness` em `PASS`, com a matriz de sinais da §6 fechada e a coluna "Última verificação" da §13 preenchida com evidência de STAGING.
