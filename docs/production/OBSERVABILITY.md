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
- **P2–P5:** cada domínio substituído adota o kernel. O caixa ganha retry e cerca de versão (PR-TX-04) e trilha de auditoria imutável (PR-TX-05), em P3. O webhook ganha o registro por `event.id` (PR-BILL-06, em P2).
- **P7:** adoção global, métricas, alertas versionados, consolidação das trilhas legadas, reconciliação com alerta, fila e replay de webhook (PR-OBS-01). O processo de incidentes e as alavancas de contenção (PR-OBS-02) ficam em [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
- **Ambientes:** nenhum alerta pode ser exercitado em projeto remoto antes de P6 ([D-ORD-04](PRODUCTION_READINESS_PLAN.md#9-decisões-de-ordenação-e-escopo-tomadas-em-p0)). A evidência de alerta disparado é colhida em STAGING (E-08).

---

## 2. Estado atual (CURRENT)

### 2.1 O que cada ponto de entrada registra

O backend exporta 47 endpoints: 42 callables, 3 crons, 1 gatilho e 1 webhook (`functions/src/index.ts:14-37`). A tabela mostra onde cada ponto de entrada registra sucesso e falha, e se a falha chega ao Cloud Logging.

| Ponto de entrada | Sucesso | Falha | Falha chega ao Cloud Logging? | Evidência | Classificação |
| --- | --- | --- | --- | --- | --- |
| 23 callables de investimentos | Métrica diária em shards + `investment_event_logs` (`outcome: completed`) na mesma transação | Com workspace autorizado: métrica `failure` + evento `outcome: failed` em Firestore. Sem workspace autorizado: `console.error` | Não. O erro vira `HttpsError` e o SDK não loga | `functions/src/investments/callables.ts:81-104`; `functions/src/investments/infrastructure.ts:330-360`; `functions/src/investments/observability.ts:169-238` | **CURRENT** |
| 9 callables de cartão | Métrica, `credit_card_audit_logs` e, conforme a operação, `financial_events` | Métrica `failure` + `financial_events` `processing_failure` + notificação ao workspace | Não, salvo chamada não autorizada | `functions/src/creditCards/callables.ts:110-136`; `functions/src/creditCards/observability.ts:205-297` | **CURRENT** |
| 4 callables de `goals/callables.ts` (3 de metas e `seedLegacySettingsCatalog`) | `goal_audit_logs` | Nada: `catch` só converte o erro | Não | `functions/src/goals/callables.ts:53-54`; `functions/src/goals/operations.ts:120-141` | **CURRENT** |
| `rebuildCashPeriods` | Nada | Nada: `catch` só converte o erro | Não | `functions/src/cash/rebuild.ts:270-271` | **CURRENT** |
| 2 callables de IA | Nada | `console.error` sanitizado. Erro inesperado sai com `errorCode: "unknown"` | Sim, como texto | `functions/src/ai/callables.ts:151-159,252` | **CURRENT** |
| 2 callables de Split | Nada | `console.error` só com `error.name` | Sim, como texto | `functions/src/callables/splitGroups.ts:91-93` | **CURRENT** |
| `createCheckoutSession` | Nada | `console.error` só quando a allowlist falta | Parcial | `functions/src/callables/billing.ts:111` | **CURRENT** |
| `stripeWebhook` | Nada | Linha de console. Recusa de negócio responde 2xx. Falha de assinatura ecoa `error.message` no log e na resposta | Sim, como texto | `functions/src/webhooks/stripe.ts:53-57,64-92` | **CURRENT** |
| `onTransactionWrite` | `activity_logs` (TTL de 365 dias) e marca em `cash_period_events` | Nada. Sem retry, o evento é descartado | Sem log próprio | `functions/src/triggers/transactions.ts:35-37,103-123`; `functions/src/cash/periods.ts:335-366` | **CURRENT** |
| 3 crons | Resumo em `console.log` com contagens; `truncated` nos crons de recorrentes e faturas, `inconclusive` na deriva | Cron de faturas: `console.error` por item, com mensagem crua. Deriva: `console.error` | Sim, como texto | `functions/src/crons/recurring.ts:584`; `functions/src/crons/creditCardInvoices.ts:129-133,406-411,433-438`; `functions/src/crons/investmentDrift.ts:271,347,368` | **CURRENT** |
| Frontend | — | Só `console.error` do navegador | Não se aplica | `src/App.tsx:269`; `src/contexts/WorkspaceContext.tsx:77` | **CURRENT** |

### 2.2 Logging

- **CURRENT:** o backend não tem logger estruturado. Não há nenhuma ocorrência de `firebase-functions/logger`, `logger/compat` ou `@google-cloud/logging` em `functions/src` e `src`. O backend tem 19 chamadas `console.*` em código de produção (lista da §2.1). O Node formata `console.error(nome, objeto)` como texto, então não existe `jsonPayload` consultável ([C25](PRODUCTION_READINESS_PLAN.md#4-verificação-das-alegações-conhecidas)).
- **CURRENT:** o SDK só registra "Unhandled error" quando o erro **não** é `HttpsError` (`functions/node_modules/firebase-functions/lib/common/providers/https.js:531-532`). Os mapeadores convertem todo erro desconhecido em `HttpsError('internal')` (`functions/src/creditCards/errors.ts:81-84`, `functions/src/investments/errors.ts:49-52`, `functions/src/callables/splitGroups.ts:76-98`). Por isso a exceção inesperada nunca aparece no Cloud Logging nem no Error Reporting.
- **CURRENT:** existem helpers de sanitização em `functions/src/shared/observabilityKeys.ts`:
  - `idempotencyKeyDigest` (`:31`), um SHA-256 truncado;
  - `boundedFailureEventId` (`:65`), um ID de falha com cardinalidade limitada;
  - `safeErrorMessage` (`:87-96`), que trunca a mensagem em 500 caracteres e nunca serializa o objeto de erro.

  Só os módulos de investimentos e de cartões os usam.
- **CURRENT:** a sanitização é desigual:
  - o webhook loga e devolve `error.message` cru (`functions/src/webhooks/stripe.ts:55-56`);
  - o cron de faturas usa `getErrorMessage`, que devolve `error.message` (ou `String(error)`) sem truncar (`functions/src/crons/creditCardInvoices.ts:85-91`), no log (`:131,410`) e no evento persistido (`:149`).
- **CURRENT:** alguns pontos seguem uma convenção explícita de não logar valor, descrição ou identificador de pessoa:
  - `functions/src/crons/recurring.ts:582-584`;
  - `functions/src/ai/callables.ts:152`;
  - `functions/src/creditCards/observability.ts:216-221`.

### 2.3 Correlação

- **CURRENT:** nos callables, o `correlationId` vem sempre do cliente, e não há `requestId` nem trace gerados no servidor. A origem varia por domínio:
  - **Cartões:** rótulo **estático** por tela (`src/components/CreditCardsView.tsx:901,939,965,990,1013,1034,1055`; `src/components/TransactionModal.tsx:861`).
  - **Investimentos:** valor aleatório por tentativa (`src/modules/investments/persistence/intent.ts:89-90`).
  - **Metas:** o ID do documento de idempotência (`functions/src/goals/operations.ts:137`).
  - **`rebuildCashPeriods`:** exige o campo no schema e nunca o usa (`functions/src/cash/rebuild.ts:39`; TX-15).
  - **IA, Split, billing, webhook, gatilho e crons de recorrentes e de faturas:** não têm nenhum. O cron de deriva gera `drift-scan-${scheduleTime}` por execução e o grava nos relatórios (`functions/src/crons/investmentDrift.ts:247,332`).
- **CURRENT:** o limite do campo diverge entre as camadas. Investimentos aceitam até 200 caracteres no contrato, e as Rules leem até 128 (INV-15). Cartões aceitam qualquer tamanho a partir de 8 (`functions/src/creditCards/contracts.ts:5`).

### 2.4 Métricas

- **CURRENT:** não há métrica no Cloud Monitoring. As "métricas" são documentos Firestore por workspace, e só em dois domínios:

  | Coleção | Formato | Retenção | Evidência |
  | --- | --- | --- | --- |
  | `investment_operational_metrics` | Contador diário por operação e status, 10 shards (`METRIC_SHARDS`), valor em centavos, chave de idempotência só como digest | `expiresAt` com 400 dias | `functions/src/investments/observability.ts:78-128` |
  | `credit_card_operational_metrics` | Contador diário sem shard, `amountTotal` em float | Sem `expiresAt` | `functions/src/creditCards/observability.ts:72-103` |

- **CURRENT:** ambas são legíveis só por owner/admin (`firestore.rules:1161-1164,1256-1269`). A UI de cartões lê as métricas do próprio tenant (`src/modules/credit-cards/hooks.ts:610-625`). Isso é telemetria de produto, não um painel de operação.

### 2.5 Alertas

- **CURRENT:** o repositório não tem política de alerta, dashboard, canal, uptime check nem Terraform (`git ls-files`, sem arquivos de monitoring). A única tabela de alertas sugeridos está num documento OUTDATED que declara "Nada disto é código" (`docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:276-292`). A deriva detectada só produz `console.error("investment_drift_detected")` (`functions/src/crons/investmentDrift.ts:271`).

### 2.6 Trilhas de auditoria existentes

Nomes conferidos no código e nas Rules do HEAD.

| Coleção | Domínio e escritor | Conteúdo | Imutabilidade | Leitura (Rules) | Retenção | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| `goal_audit_logs` | Metas, `writeAudit` na transação do callable | `actorId`, `actorRole`, `operation`, `targetId`, `details` (before/after completos, com texto livre), `correlationId` igual ao ID da idempotência | `transaction.set` com ID da idempotência; Rules `write: false` | owner/admin | Sem `expiresAt` (GOAL-14) | `functions/src/goals/operations.ts:120-141`; `firestore.rules:1181-1184` |
| `credit_card_audit_logs` | Cartões, `recordCreditCardAuditLog` em 9 operações | Ator, ação (enum de 9), entidade, vínculos, `reason`, `correlationId`, **`idempotencyKey` crua** | `transaction.set` com ID derivado; Rules `write: false` | owner/admin (query sem índice: PR-CC-08) | Sem `expiresAt` | `functions/src/creditCards/auditLogs.ts:8-17,80-106`; `firestore.rules:1156-1159` |
| `financial_events` | Cartões: eventos de domínio (`purchase_created`, `invoice_closed`…), `reconciliation_warning` e `processing_failure` misturados | Payload do evento; na falha, `errorMessage` | `transaction.set`; Rules `write: false` | **Qualquer membro**, inclusive viewer | Sem `expiresAt` | `functions/src/creditCards/adminPaths.ts:10`; `functions/src/creditCards/observability.ts:266-282`; `firestore.rules:1146-1149` |
| `investment_event_logs` | Investimentos: `outcome: completed` por operação liquidada; `outcome: failed` pela observabilidade | Ator, papel, operação, entidade, `correlationId`, `idempotencyKeyId` | `completed` via `transaction.create`; Rules `write: false` | owner/admin, `list` limitada | `completed`: **sem** `expiresAt`. `failed`: 400 dias | `functions/src/investments/infrastructure.ts:330-360`; `functions/src/investments/observability.ts:216-238`; `firestore.rules:1238-1246` |
| `activity_logs` | Caixa: gatilho `onTransactionWrite` | Nomes dos campos alterados e saldo float antes/depois; `userId` do **criador**, não do ator (ENTRY-17) | `set` com ID do evento; `write: false` pelo catch-all | **Qualquer membro**, via catch-all (fora de `isBackendOwnedCollection`) | 365 dias | `functions/src/triggers/transactions.ts:19,103-123`; `firestore.rules:852-877,1436-1441` |
| `investment_drift_reports` | Cron de deriva (operacional, não é auditoria) | Achados por workspace | Rules `write: false` | owner/admin | 400 dias | `functions/src/crons/investmentDrift.ts:240-263`; `firestore.rules:1293-1297` |

- **CURRENT:** `investment_audit_logs` **não existe** no HEAD, nem em `functions/src` nem em `firestore.rules`. Só aparece em documentos OUTDATED (`docs/investments/TTL_MANIFEST.md:44,118`). Hoje a trilha de fato do domínio patrimonial são os eventos `completed` de `investment_event_logs` e os próprios movimentos do ledger.
- **CURRENT:** não têm trilha nenhuma: membership e workspace (PR-WS-02, WS-11), conteúdo de `transactions` (PR-TX-05), empréstimos (LOAN-10), clientes e recebíveis (CR-09), Split (SPLIT-13), recorrentes (REC-12), configuração de cartão (PR-CC-02), billing (PR-BILL-06), ações administrativas (PR-ADMIN-01) e reconstrução de caixa (TX-15).

### 2.7 Reconciliação existente

| Job ou callable | O que compara ou reconstrói | Execução | Saída | Evidência | Classificação |
| --- | --- | --- | --- | --- | --- |
| `processInvestmentDriftScan` | Resumo × soma das posições × último fechamento (não confere o ledger) | Diário às 06:00 (São Paulo); 50 workspaces por execução, em rodízio sobre a coleção global | `investment_drift_reports` + `console.error` | `functions/src/crons/investmentDrift.ts:58,104-146,325-376` | **CURRENT** |
| `recalculateInvestmentPosition`, `recalculateGoalInvestmentProgress`, `rebuildInvestmentProjections`, `backfillInvestmentWorkspace` | Reconstroem projeções a partir do ledger, com cerca e lease | Manual, owner/admin; sem UI montada (FEW-15) | Projeções | `functions/src/investments/callables.ts:188-251`; `functions/src/investments/writeStrategy.ts:472,497,518,541` | **CURRENT** |
| `recalculateCardLimit`, `rebuildCardInvoicesForCard` | Snapshot de limite e faturas a partir das compras | Manual, owner/admin | `financial_events` `reconciliation_warning` + notificação | `functions/src/creditCards/callables.ts:163-187`; `functions/src/creditCards/recalculateCardLimit.ts:278,290`; `functions/src/creditCards/rebuildInvoices.ts:664,676` | **CURRENT** |
| `rebuildCashPeriods` | `cash_report_periods` a partir de `transactions` | Manual, owner/admin, 100/h; sem cerca contra o gatilho (ENTRY-08) | Períodos (sem evento nem log) | `functions/src/cash/rebuild.ts:113,247-273` | **CURRENT** |
| — | Deriva de caixa, cartões, metas, empréstimos, recebíveis, Split e Stripe × estado local | Não existe | — | `functions/src/index.ts:26-34` (só 3 crons) | **CURRENT** |

### 2.8 Webhook Stripe

- **CURRENT:** o webhook verifica a assinatura sobre `rawBody` (`functions/src/webhooks/stripe.ts:52`), mas:
  - não persiste `event.id` (PR-BILL-06);
  - responde 2xx às recusas de negócio (sessão sem usuário, não paga, preço fora da allowlist), deixando só uma linha de console (`:64-92`). O evento sai da fila de reentrega da Stripe e não há como listá-lo ou reprocessá-lo pelo produto;
  - quando o segredo falta, cai no fallback `whsec_placeholder` em vez de falhar fechado (PR-BILL-05).
- **CURRENT:** não existe procedimento de replay nem consulta de falhas. O documento antigo afirma idempotência por `event.id` que o código não tem (`docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:167-169`; FIRE-14).

### 2.9 Frontend

- **CURRENT:** o frontend não tem ErrorBoundary, `window.onerror`, handler de `unhandledrejection`, Analytics nem Performance: zero ocorrências de `componentDidCatch|getDerivedStateFromError|window.onerror|unhandledrejection|ErrorBoundary|sentry|firebase/analytics|firebase/performance` em `src`. Quando um chunk falha ao carregar depois de um deploy, a tela fica branca e nada é reportado (FIRE-07).

### 2.10 Testes existentes

- **CURRENT:** estes testes cobrem a observabilidade atual:
  - `functions/src/creditCards/__tests__/failureObservability.integration.test.ts` e `operationalMetrics.integration.test.ts`: métrica, evento e notificação de falha; chamada não autorizada não grava. Fazem skip sem Emulator (`failureObservability.integration.test.ts:46-50`; FIRE-13).
  - `functions/src/investments/__tests__/m3Lifecycle.integration.test.ts`: observabilidade de falha sem vazamento entre tenants.
  - `functions/src/crons/__tests__/investmentDrift.integration.test.ts`: detecção de deriva. Faz skip silencioso sem Emulator (INV-16).
  - `tests/firestore/m4-hardening.rules.integration.test.mjs:207,440-455` e `investment-m3.rules.integration.test.mjs:256-262,280-290`: em `investment_event_logs`, negação de escrita do cliente, isolamento entre tenants e leitura só por owner/admin.
- **CURRENT:** não há teste de logger, correlação, alerta, retry de gatilho, replay de webhook nem trilha de membership (firebase-platform, `existingTests`). Também não há teste de Rules para `financial_events`, `activity_logs`, `goal_audit_logs` e `credit_card_audit_logs`: nenhuma ocorrência desses nomes em `tests/` e `e2e/`.

---

## 3. Contrato de logging (TARGET)

**TARGET (P1 contrato, P7 adoção global):** módulo `functions/src/shared/logging.ts` sobre `firebase-functions/logger`, que grava JSON com `severity`. Todo wrapper de callable, gatilho, cron e webhook passa a usar esse módulo, e `console.*` sai do código de produção.

### 3.1 Campos

| Campo | Obrigatório | Origem e regra |
| --- | --- | --- |
| `event` | Sim | Nome estável em snake_case (`callable_completed`, `callable_failed`, `cron_completed`, `webhook_event_failed`, `reconciliation_divergence`…). É a chave das métricas da §5 |
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
- **Volume:** um log por invocação e um resumo por cron. Falha por item em laço é agregada (o formato atual de `functions/src/crons/creditCardInvoices.ts:406-411` sai).
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
7. **Legado a remover (P4, junto com as telas de cartão):** os rótulos estáticos de `CreditCardsView.tsx` e `TransactionModal.tsx:861`.

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
| Eventos de webhook | Contador | `event` em (`webhook_event_processed`, `webhook_event_failed`, `webhook_signature_invalid`) | `type`, `outcome` | P2 (log), P7 (alerta) |
| Divergência de reconciliação | Contador | `event="reconciliation_divergence"` | `domain`, `kind` | P7 |
| Consumo de IA | Contador | `event="callable_completed"` em callables de IA | `operation` | P5 |
| Rejeições de App Check | Métrica nativa do App Check | — | serviço | P6 |
| Erro no frontend | Contador | `event="client_error"` (§11) | `kind` | P7 |

**TARGET:** o módulo compartilhado de observabilidade (legado P7 da [§7 do plano](PRODUCTION_READINESS_PLAN.md#7-legado-a-remover)) substitui `functions/src/creditCards/observability.ts` e `functions/src/investments/observability.ts`. Métricas de operação saem do Firestore por workspace e vão para as métricas baseadas em log. Se o produto quiser manter contadores visíveis ao tenant, a coleção fica em centavos, com shards e `expiresAt`. Eventos de falha operacional saem de `financial_events`.

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
| A08 | Webhook Stripe com falha | ≥ 1 `webhook_event_failed`, ou entrada não resolvida em `stripe_event_failures` há mais de 1 h | Plantão técnico + responsável por billing | Falha de webhook e replay | P2 (registro), P7 (alerta) | TARGET / E-08 |
| A09 | Assinatura de webhook inválida | ≥ 3 `webhook_signature_invalid` em 10 min | Plantão técnico | Falha de webhook e replay; segredo exposto ([INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)) | P7 | TARGET / E-08 |
| A10 | Webhook silencioso | Nenhum evento em `stripe_events` em 24 h com assinaturas ativas | Responsável por billing | Falha de webhook e replay | P7 | TARGET / E-08 |
| A11 | Segredo ou configuração ausente | Qualquer `secret_missing` (Stripe, IA, allowlist; hoje `billing_price_allowlist_missing`) | Plantão técnico | Configuração ausente (E-05) | P2, P7 | TARGET / E-08 |
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

- **Gravador (TARGET, P1):** `functions/src/shared/audit.ts`, do kernel. Grava na **mesma transação** do efeito, com `transaction.create` e ID derivado da chave de idempotência. Retry idempotente não duplica registro, e nenhum caminho sobrescreve um registro, ao contrário do `set` atual em `functions/src/goals/operations.ts:131` e `functions/src/creditCards/auditLogs.ts:87`.
- **`workspaces/{workspaceId}/financial_events` (TARGET, P3–P5):** eventos e auditoria dos domínios financeiros. Fica só com eventos de domínio: `processing_failure` sai (§7.6), e a leitura passa a owner/admin (§7.4). Em P3, junto com PR-TX-05, confirma-se o uso da coleção para o caixa, como indica [DATA_MODEL.md](DATA_MODEL.md).
- **`workspaces/{workspaceId}/membership_events` (TARGET, P1):** ciclo de vida de workspace e membership (PR-WS-02, WS-11), detalhado em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md).
- **`admin_audit_logs`, na raiz, server-only (TARGET, P7):** ações de operador de plataforma (PR-ADMIN-01, D-10).
- **Billing (TARGET, P2):** o processamento vai para `stripe_events/{event.id}` (PR-BILL-06) e a mudança de plano para uma trilha append-only no mesmo formato. A remediação de PR-BILL-06 na auditoria chama essa trilha de `billing_audit`. Onde ela fica depende de D-01 (entidade pagadora) e é fixado em P2.

### 7.2 Ações sensíveis cobertas

| Categoria | Ações | Destino | Milestone do escritor | GAP de origem |
| --- | --- | --- | --- | --- |
| Conta e workspace | `bootstrapAccount`, `createWorkspace`, configurações, arquivamento | `membership_events` | P1 | PR-AUTH-03 |
| Membership | Convite criado, aceito, revogado ou expirado; troca de papel; remoção lógica; saída; transferência de ownership | `membership_events` | P1 | PR-WS-02 (WS-11) |
| Billing | Checkout iniciado, assinatura criada, alterada ou cancelada, inadimplência, reembolso, disputa, mudança de entitlement | `stripe_events` + trilha de billing (D-01) | P2 | PR-BILL-06 |
| Caixa | Lançamento, edição (antes/depois em centavos), anulação, rebuild com `reason` | `financial_events` | P3 | PR-TX-05, TX-15 |
| Empréstimos e recebíveis | Contrato, pagamento, estorno, cancelamento, recebimento, arquivamento | `financial_events` | P3 | LOAN-10, CR-09 |
| Cartões | Cadastro, limite, ciclo, status, arquivamento, além das 9 ações atuais | `financial_events` | P4 | PR-CC-02 |
| Recorrentes e Split | Configuração, geração, título, rateio, pagamento, arquivamento | `financial_events` | P4 | REC-12, SPLIT-13 |
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
| `requestId`, `clientCorrelationId`, `idempotencyKeyHash`, `sourceEventId` | Correlação (§4). A chave de idempotência nunca vai crua; hoje `credit_card_audit_logs` a grava em claro (`functions/src/creditCards/auditLogs.ts:102`) |
| `occurredAt` | `FieldValue.serverTimestamp()` |

### 7.4 Imutabilidade, acesso e índices (TARGET)

- **Gravação:** Rules `allow write: if false` em `financial_events`, `membership_events`, `admin_audit_logs` e na trilha de billing, provadas por teste no Emulator: o cliente não cria, altera nem apaga.
- **Leitura:** só owner/admin, com `limit` obrigatório e cursor, e nenhuma trilha ao alcance do catch-all de leitura. Hoje `financial_events` e `activity_logs` são legíveis por qualquer membro (`firestore.rules:1146-1149,1436-1441`). Se o produto precisar mostrar eventos a member ou viewer, faz isso por projeção própria, sem abrir a trilha.
- **Índices:** os índices compostos das consultas de auditoria (por `targetId`, `action` e `occurredAt desc`) ficam versionados em `firestore.indexes.json` no mesmo milestone. Essa é a lição de PR-CC-08.

### 7.5 Retenção (DECISION)

- **DECISION D-18 (pendente):** fixa o prazo da trilha de auditoria. Até lá, os registros de auditoria **não** recebem `expiresAt` e ficam fora de toda política de TTL (`functions/src/shared/retention.ts:11-15`).
- **DECISION D-07 (pendente):** resolve o que acontece com o ator de um histórico compartilhado quando a conta é excluída. Anonimizar o `actorId` preserva a trilha. Apagar o registro não é permitido.

### 7.6 Consolidação e legado (TARGET)

Pela [política de legado](PRODUCTION_READINESS_PLAN.md#política-de-legado), cada trilha antiga sai no milestone que a substitui, junto com Rules e índices. Os dados de teste são recriados, não migrados.

| Trilha atual | Substituída por | Milestone |
| --- | --- | --- |
| `activity_logs` (gatilho de caixa) | Evento `cash.*` em `financial_events`, gravado pelo callable (PR-TX-05) | P3 |
| `credit_card_audit_logs` | `financial_events` com `action` `card.*` | P7, ou P4 se o escritor for reescrito na convergência de cartões |
| `goal_audit_logs` | `financial_events` com `action` `goal.*` | P7, ou P5 se o escritor for reescrito nas correções de metas |
| `investment_event_logs` `completed` | `financial_events` com `action` `investment.*` | P7 |
| `investment_event_logs` `failed`, `*_operational_metrics` | Logger e métricas baseadas em log (§5) | P7 |
| `processing_failure` e `reconciliation_warning` em `financial_events` | Log `callable_failed` ou `reconciliation_divergence` + alerta (A01, A06). `financial_events` fica só com fatos de domínio | P7 |

A [§7 do plano](PRODUCTION_READINESS_PLAN.md#7-legado-a-remover) já lista estas trilhas como legado de P7. A antecipação de `activity_logs` para P3 (PR-TX-05) e as alternativas P4/P5 desta tabela precisam ser refletidas no plano quando esses milestones forem executados.

---

## 8. Eventos de segurança (TARGET)

| Evento | Fonte | Registro | Alerta |
| --- | --- | --- | --- |
| Chamada não autenticada ou sem papel | Wrapper único | Log `WARNING` com `operation`, `actorId` e `errorCode`. CURRENT: só investimentos e cartões registram hoje (`functions/src/investments/observability.ts:179-185`; `functions/src/creditCards/observability.ts:216-221`) | A12 |
| Workspace do payload diferente do autorizado | Resolvedor único (P1) | Log `ERROR` | A13 |
| Rejeição de App Check | Plataforma (P6) | Métrica nativa | A14 |
| Mudança de papel, ownership, suspensão | Callables de P1 | Auditoria (§7) | Não (consulta) |
| Acesso ou ação de administrador de plataforma | Callables administrativas (D-10) | `admin_audit_logs` | A20 |
| Falha de assinatura de webhook | `stripeWebhook` | Log `webhook_signature_invalid` | A09 |
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
| Caixa | `transactions` × `cash_report_periods` | Só `rebuildCashPeriods` manual, sem cerca (PR-TX-04) | Varredura agendada de deriva de caixa, rebuild com cerca de versão e lease, `reason` e `requestId` persistidos (TX-15) | P3 (job), P7 (alerta) |
| Cartões | Compras, parcelas, pagamentos e `card_limit_ledger` × faturas, `invoice_views` e `card_limit_snapshots` | Só recálculo manual com `reconciliation_warning` | Varredura agendada com cursor; `reconciliation_warning` vira `reconciliation_divergence` + alerta | P4 (job), P7 (alerta) |
| Metas | Posições vinculadas × progresso da meta | `recalculateGoalInvestmentProgress` manual | Conferência na mesma varredura de investimentos | P5 |
| Empréstimos | Movimentos × saldo e status do contrato | Inexistente (domínio 100% cliente) | Varredura do novo backend | P3 |
| Recebíveis | Recebimento × receita de caixa vinculada | Inexistente | Varredura do novo backend | P3 |
| Split | Rateios e pagamentos × lançamentos de caixa e cartão | Inexistente | Varredura do novo módulo `splitBills` | P4 |
| Billing | Assinatura na Stripe × estado de assinatura e entitlement local | Inexistente | Conciliação periódica via API da Stripe | P2 (job), P7 (alerta) |

**TARGET:** superfície operacional para disparar rebuild e reconciliação como suporte, com papel próprio e auditoria. Hoje só owner/admin do workspace dispara, e sem UI montada (FEW-15). Depende de D-10.

---

## 10. Falhas de webhook e replay (TARGET)

O contrato de processamento é o de [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md). Esta seção cobre visibilidade, alerta e replay.

1. **Registro por evento (P2, PR-BILL-06):** `stripe_events/{event.id}` é server-only e nasce por `create` na mesma transação do efeito, com `type`, `livemode`, `created`, `outcome` (`processed` ou `ignored`, com motivo) e `processedAt`. Evento repetido não reaplica o efeito. A recusa de negócio deixa de ser só uma linha de console (`functions/src/webhooks/stripe.ts:64-92`) e fica registrada e consultável como `ignored`.
2. **Respostas (P2):** 2xx só depois de persistir.
   - Segredo ausente responde 500, loga `secret_missing` e não processa (PR-BILL-05).
   - Falha transitória responde 5xx e loga `webhook_event_failed` com `sourceEventId`, `type` e `errorCode`, para a Stripe reenviar.
3. **Fila de falhas (P7):** como o efeito e o registro de `stripe_events` são atômicos, uma falha não deixa documento ali. A falha é gravada fora dessa transação em `stripe_event_failures/{event.id}` (nome proposto; server-only), com:
   - `type`, `attempts`, `firstFailedAt`, `lastFailedAt`, `lastErrorCode`, `requestId`;
   - `resolvedAt` e `resolvedBy`, preenchidos quando o evento é processado. A entrada é marcada como resolvida, nunca apagada.

   Essa fila atende a "fila e replay de falhas de webhook" do escopo de P7. A consulta é paginada por `resolvedAt == null` e `lastFailedAt`, com índice versionado. Os alertas são A08–A11.
4. **Replay (P7):** o procedimento fica em [RUNBOOKS.md](RUNBOOKS.md). Há dois caminhos:
   - reenvio pelo painel ou CLI da Stripe (EXTERNAL, E-06);
   - reprocessamento por callable administrativa que relê o evento pela API da Stripe e reaplica pelo mesmo caminho idempotente, com entrada em `admin_audit_logs`. Depende de D-10.

   O replay é provado por teste: um evento que falhou, reprocessado, aplica o efeito uma vez só e marca a entrada da fila como resolvida.
5. **Retenção:** o prazo de `stripe_events` e da fila segue D-18, com a política de TTL registrada em E-07. O prazo não pode ser menor que a janela em que a Stripe permite reenviar eventos, valor confirmado em E-06.

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
| PR-TX-05 | HIGH | P3 | Sem trilha imutável de edição e anulação de transação | `src/modules/transactions/api.ts:313-330`; `functions/src/triggers/transactions.ts:103-123` |
| PR-BILL-06 | HIGH | P2 | Webhook sem registro por `event.id`, sem ordem e sem trilha | `functions/src/webhooks/stripe.ts:49-110` |
| PR-BILL-05 | HIGH | P2 | Segredos Stripe com fallback placeholder, falha invisível | `functions/src/webhooks/stripe.ts:8-9,52` |
| PR-CC-08 | HIGH | P4 | Consulta de `credit_card_audit_logs` sem índice composto | `src/modules/credit-cards/persistence/readApi.ts:464-482` |
| PR-WS-02 | HIGH | P1 | Mutações de membership sem auditoria (WS-11) | `src/modules/workspaces/api.ts:236-264` |
| PR-ADMIN-01 | HIGH | P7 | Sem ações administrativas auditadas | `src/contexts/AuthContext.tsx:55-61` |

As lacunas MEDIUM e LOW abaixo usam o ID de origem da auditoria. O milestone é uma proposta deste documento, e o domínio correspondente a confirma.

| ID | Sev. | Milestone | Lacuna | Evidência |
| --- | --- | --- | --- | --- |
| ENTRY-13 | MEDIUM | P7 | Erros desconhecidos engolidos sem Cloud Logging; 19 `console.*` (parte de PR-OBS-01) | `functions/src/creditCards/errors.ts:81-84` |
| ENTRY-16 | MEDIUM | P7 | Crons truncados sem alerta; deriva cobre 50 workspaces por dia; sem retry (parte de PR-OBS-01) | `functions/src/crons/creditCardInvoices.ts:33,433-438`; `functions/src/crons/investmentDrift.ts:58` |
| ENTRY-17 | MEDIUM | P3 | `activity_logs` atribui a alteração ao criador, não ao ator | `functions/src/triggers/transactions.ts:108` |
| INV-05 | MEDIUM | P7 | Deriva só entre projeções, ciclo lento, sem alerta nem reparo operável | `functions/src/crons/investmentDrift.ts:104-146,271` |
| INV-10 | MEDIUM | P7 | Rate limit não conta falhas; um evento de falha por chave escolhida pelo cliente | `functions/src/shared/observabilityKeys.ts:65-72`; `functions/src/investments/observability.ts:216-238` |
| TX-15 | MEDIUM | P3 | Rebuild de caixa ignora `idempotencyKey`, `correlationId` e `reason` (parte de PR-TX-04) | `functions/src/cash/rebuild.ts:36-41` |
| CC-11 | MEDIUM | P4 | Cron de faturas sem cursor persistido entre execuções (revarre a janela inteira todo dia); alerta só via `truncated` no log (parte de PR-CC-04) | `functions/src/crons/creditCardInvoices.ts:31-42,341-348` |
| FIRE-08 | MEDIUM | P6 | TTL não versionado (`fieldOverrides` vazio) | `firestore.indexes.json` |
| FEW-15 | MEDIUM | P7 | Reconciliação sem superfície operacional | `src/modules/investments/persistence/operationsApi.ts:94-182` |
| LOAN-10, CR-09 | MEDIUM | P3 | Empréstimos e recebíveis sem trilha, ator ou timestamp de servidor | `src/modules/loans/api.ts:216-219`; `src/modules/clients/api.ts:55-56` |
| SPLIT-13, REC-12 | MEDIUM | P4 | Split e recorrentes sem auditoria | `functions/src/crons/recurring.ts:337,584` |
| ENTRY-21 | LOW | P1 | Quatro mapeadores de erro; rate limit como `failed-precondition` | `functions/src/shared/rateLimit.ts:121-126` |
| INV-15 | LOW | P1 | `correlationId` com limite divergente entre contrato (200) e Rules (128) | `functions/src/investments/contracts.ts:19`; `firestore.rules:625` |
| GOAL-14 | LOW | P5 | Auditoria de metas sem retenção e com documento inteiro | `functions/src/goals/operations.ts:207-209,244-247` |
| CC-20 | LOW | P4 | Coleções operacionais de cartão sem TTL | `functions/src/creditCards/idempotency.ts:117-126` |
| INV-16, FIRE-13 | LOW | P7 | Testes de observabilidade e deriva fazem skip sem Emulator | `functions/src/crons/__tests__/investmentDrift.integration.test.ts:105`; `functions/src/creditCards/__tests__/failureObservability.integration.test.ts:46-50` |

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
| [D-18](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision) | Pendente | Prazos de logs, auditoria, `stripe_events` e métricas |
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
6. **Webhook (P2/P7):** um evento com falha fica consultável em `stripe_event_failures`, e o replay aplica o efeito uma vez só e marca a entrada como resolvida. Segredo ausente responde 500 sem processar.
7. **Frontend (P7):** erro de renderização mostra o fallback pt-BR e envia `client_error` sem dados pessoais.

**Critério de saída de P7:** `observability-incident-readiness` em `PASS`, com a matriz de sinais da §6 fechada e a coluna "Última verificação" da §13 preenchida com evidência de STAGING.
