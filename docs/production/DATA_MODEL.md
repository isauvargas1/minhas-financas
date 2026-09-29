# Modelo de dados Firestore

Inventário do modelo de dados Firestore do Minhas Finanças: coleções, escritores, Rules, índices, retenção, paginação, Notifications e Messages. O documento registra o estado auditado no HEAD `9c3ab46` (atualizado após a implementação de P1: código no repositório e testado no Emulator, nada implantado) e o alvo por coleção, e remete ao [plano mestre](PRODUCTION_READINESS_PLAN.md) para IDs, milestones e decisões. O gate do tema é da skill `firestore-scale-cost-review`. Rules e isolamento também passam por `multi-tenant-security-review`, e retenção por `privacy-lgpd-data-lifecycle` (ver [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md)).

## 1. Convenções

- Rótulos: **CURRENT** (existe no HEAD, com evidência `caminho:linha`), **TARGET** (alvo, não implementado), **GAP** (ID `PR-*` do [registro](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers) para BLOCKER/HIGH; ID de origem da auditoria para MEDIUM/LOW), **DECISION** (§9/§10 do plano) e **EXTERNAL CONFIGURATION REQUIRED** (§11 do plano).
- **Escritor cliente** é o SDK web sujeito às Rules. **Escritor backend** é o Admin SDK em callable, gatilho, cron ou webhook, que não passa pelas Rules.
- Referências de Rules apontam para `firestore.rules`. Referências de índice apontam para a linha da chave `collectionGroup` em `firestore.indexes.json`.
- Papéis nos helpers de Rules (**CURRENT**): `isMember` = membership `active` com conta ativa (`users/{uid}.status == 'active'`), sem regime por `ownerId` (`firestore.rules:28-46`). `canReadWorkspaceScopedData` = qualquer membro ativo, inclusive `viewer` (`firestore.rules:379-381`). `canWriteWorkspaceScopedData` = owner/admin (`firestore.rules:383-385`). `canMemberWriteWorkspaceScopedData` = owner/admin/member (`firestore.rules:387-389`). `canReadInvestmentDomain` = owner/admin/member (`firestore.rules:393-395`). `canReadSensitiveInvestmentDomain` = owner/admin (`firestore.rules:397-399`). As escritas por papel exigem também workspace não arquivado (`firestore.rules:58-64`).

## 2. Princípios do modelo alvo (TARGET)

1. Toda coleção financeira ou de controle tem `allow write: if false`. A escrita passa por callable com Zod estrito, `*Cents` inteiros, idempotência, transação e auditoria ([ARCHITECTURE.md](ARCHITECTURE.md)). O cliente escreve diretamente só dados não financeiros do próprio usuário (perfil com allowlist e, no alvo, o estado de leitura de notificação).
2. Cada coleção tem `match` explícito. `get` e `list` ficam separados, e `list` exige `request.query.limit`. O catch-all de subcoleção deixa de existir (PR-RULES-02).
3. Nenhum hard delete de histórico financeiro. Exclusão vira arquivamento, cancelamento ou estorno ([DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md)).
4. Toda query composta tem índice versionado, com teste que confere a cobertura. TTL e isenções de indexação ficam em `fieldOverrides`.
5. Leitura de lista usa `orderBy` estável + `__name__` + `startAfter` + `limit`. Telas financeiras leem projeções agregadas pelo backend, nunca a coleção bruta.
6. Papel efetivo vem só do membership ativo, sem regime paralelo por `ownerId` (P1, PR-WS-03, PR-WS-04; entregue em P1).

## 3. Árvore de coleções (CURRENT)

Não há `match` top-level genérico: fora de `workspaces/`, `users/` e `billing_accounts/` (só o `get` do próprio titular) tudo é negado ao cliente (`firestore.rules:1-3`, `936`, `1378`, `1412`). Legenda: **[C]** escrito pelo cliente, **[B]** escrito pelo backend, **[C+B]** ambos, **(catch-all)** sem `match` próprio, lido por qualquer membro via `firestore.rules:1362-1367`.

```text
users/{uid}                                  [B]  perfil server-owned (bootstrapAccount); sem plano (P2A)
  rate_limits/{id}                           [B]
  idempotency_keys/{id}                      [B]  idempotência por ator das callables do kernel (P1)
  workspaces/{workspaceId}                   [B]  índice de participação do usuário (sem papel)
billing_accounts/{uid}                       [B]  estado canônico de assinatura do titular (P2A); cliente só faz get do próprio
  billing_events/{eventId}                   [B]  trilha append-only de billing (sem TTL; negada ao cliente)
billing_customers/{stripeCustomerId}         [B]  vínculo reverso customer → titular (negado ao cliente)
billing_webhook_events/{eventId}             [B]  recibo idempotente do webhook, TTL 90 dias (negado ao cliente)
job_checkpoints/{job}                        [B]  cursor do cron de recorrentes (sem Rule → negado)
system/{doc}                                 [B]  cursor do cron de deriva (sem Rule → negado)
invite_tokens/{sha256}                       [B]  ponteiro do hash do token de convite (sem Rule → negado)
platform_audit_events/{id}                   [B]  auditoria de suspensão de conta (sem Rule → negado)
workspaces/{workspaceId}                     [B]
  members/{uid}                              [B]
  invites/{inviteId} | membership_events/{eventId}   [B]
  transactions/{id}                          [C+B]
  activity_logs/{id}                         [B]  (catch-all)
  cash_report_periods/{yyyy-mm}              [B]
  cash_period_events/{eventKey}              [B]
  recurring_expenses/{id}                    [C+B]
  recurring_occurrences/{id}                 [C+B]
  credit_cards/{id}                          [C]
  credit_card_purchases | credit_card_installments | credit_card_invoices
  credit_card_invoice_payments | card_limit_ledger | card_limit_snapshots
  financial_events | invoice_views | credit_card_audit_logs
  credit_card_operational_metrics | credit_card_idempotency_keys   [B]
  goals | goal_audit_logs | goal_idempotency_keys                   [B]
  investment_accounts | investment_assets | investment_movements
  investment_positions | investment_valuations | investment_snapshots
  investment_event_logs | investment_import_batches | investment_operational_metrics
  investment_drift_reports | investment_idempotency_keys | investment_summaries
  investment_report_periods | investment_allocation_summaries       [B]
  loans/{id} | loan_movements/{id}           [C]
  clients/{id} | receivables/{id}            [C]
  split_groups | split_bills | split_shares  [C]
  split_participants/{id}                    [C+B]
  split_invites/{id}                         [B]  (catch-all)
  settings_catalog/{id}                      [C+B]
  settings_catalog_uniques/{dedupeKey}       [C+B]
  notifications/{id}                         [B]  (+ cliente altera `read` e apaga)
  rate_limits/{id}                           [B]  (catch-all, negado por isBackendOwnedCollection)
```

Evidência dos caminhos sem Rule própria: `functions/src/crons/recurring.ts:84` (`job_checkpoints/recurring_expenses`), `functions/src/crons/investmentDrift.ts:66` (`system/investment_drift_scan`), `functions/src/triggers/transactions.ts:103` (`activity_logs`), `functions/src/callables/splitGroups.ts:144-146` (`split_invites`), `functions/src/shared/rateLimit.ts:55-70` (`rate_limits` de workspace), `functions/src/workspaces/model.ts:33,61-62` (`invite_tokens`) e `functions/src/workspaces/suspension.ts:27,58` (`platform_audit_events`). A lista de negação por prefixo está em `firestore.rules:791-821`.

## 4. Inventário por coleção

Colunas: finalidade; escritor **CURRENT**; Rules **CURRENT**; índices compostos; retenção **CURRENT**; **TARGET** com escritor, milestone e GAP.

### 4.1 Raiz e usuário

| Coleção | Finalidade | Escritor CURRENT | Rules CURRENT | Índices | Retenção CURRENT | TARGET · milestone · GAP |
| --- | --- | --- | --- | --- | --- | --- |
| `users/{uid}` | Perfil mínimo server-owned (`uid`, `email`, `displayName`, `photoURL`, `status`, `createdAt`, `updatedAt`) e `isAdmin`; **sem plano** (`planId`, `isPro`, `stripe*` e `subscriptionStatus` saíram em P2A) | Backend: `bootstrapAccount` cria e sincroniza o perfil (`functions/src/workspaces/lifecycle.ts:110-168`); `suspendAccount` grava `status` (`functions/src/workspaces/suspension.ts:36`). O cliente só lê (`src/contexts/AuthContext.tsx:75-79`) | Leitura só do próprio uid; create, update e delete negados (`firestore.rules:1378-1381`) | — | Sem prazo; sem exclusão | Mantido; `locale` e `timezone` não fazem parte do contrato de P1. O plano vive em `billing_accounts/{uid}` (P2A, D-01, abaixo). `isAdmin` vira custom claim (P7, PR-ADMIN-01). Exclusão em P8 (PR-AUTH-01). PR-AUTH-03 fechado em P1 (PLAN §16.4) |
| `billing_accounts/{uid}` | Estado canônico de assinatura do titular (uid = billing owner, D-01): `billingOwnerUid`, `catalogVersion`, `planId`, `entitlementStatus`, `subscriptionStatus`, `graceUntil`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `cancelAt`, `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId`, `pendingCheckout`, `lastStripeEventId`, `lastStripeEventType`, `stripeSyncedAt`, `createdAt`, `updatedAt` | Backend: `bootstrapAccount` cria o Free na mesma transação (`functions/src/workspaces/lifecycle.ts:125,146,176`); checkout e webhook atualizam (`functions/src/billing/model.ts:97-118`) | `get` do próprio titular com conta ativa; sem `list`; create, update e delete negados (`firestore.rules:1412-1414`) | — | Sem prazo; sem exclusão (histórico financeiro) | Mantido; entitlement do workspace derivado do plano do owner (P2B, PR-BILL-07). Cancelamento na saída do titular em P8 (PR-AUTH-01) |
| `billing_accounts/{uid}/billing_events` | Trilha de auditoria append-only de billing (`checkout.created`, `subscription.linked`, `billing.state_changed`, `grace.started/ended`, `cancellation.scheduled/reverted`, `subscription.canceled`, `payment.*`, `refund.received`, `dispute.*`, `anomaly.detected`), sem payload, e-mail, cartão nem segredo | Backend, `transaction.create` com ID determinístico (`functions/src/billing/audit.ts:56-89`) | `read, write: false` (`firestore.rules:1416-1421`) | — | Sem `expiresAt`, sem TTL (histórico financeiro) | Mantido; alertas e reconciliação em P7 |
| `billing_customers/{stripeCustomerId}` | Vínculo reverso customer Stripe → titular (`billingOwnerUid`, `livemode`) | Backend: checkout, na mesma transação que grava `stripeCustomerId` na conta (`functions/src/billing/checkout.ts:283-310`) | `read, write: false` (`firestore.rules:1424-1426`) | — | Sem prazo | Mantido |
| `billing_webhook_events/{eventId}` | Recibo idempotente de cada evento do Stripe (`id`, `type`, `livemode`, `stripeCreatedAt`, `billingOwnerUid`, `outcome`, `reason`, `processedAt`, `expiresAt`); sem payload | Backend: webhook, na mesma transação do efeito (`functions/src/billing/webhook.ts:288-320`) | `read, write: false` (`firestore.rules:1428-1430`) | — | `expiresAt` 90 dias (`functions/src/shared/retention.ts:53`); TTL declarado (`firestore.indexes.json:858-861`) | Mantido; criação do TTL no ambiente é EXTERNAL CONFIGURATION (E-07) |
| `users/{uid}/rate_limits` | Contador de frequência sem workspace (checkout e aceite de convite) | Backend (`functions/src/shared/rateLimit.ts:80-90`; `functions/src/workspaces/callables.ts:143`) | `read, write: false` (`firestore.rules:1386-1388`) | — | `expiresAt` 2 dias (`functions/src/shared/rateLimit.ts:144`) | Manter. TTL versionado (P6, RULES-13) |
| `users/{uid}/idempotency_keys` | Reserva de idempotência por ator das callables do kernel (`createWorkspace`, `inviteWorkspaceMember`, `transferWorkspaceOwnership`) | Backend (`functions/src/shared/idempotency.ts:37-97`) | `read, write: false` (`firestore.rules:1391-1393`) | — | `expiresAt` 90 dias (`functions/src/shared/idempotency.ts:95`; `functions/src/shared/retention.ts:29`); TTL declarado (`firestore.indexes.json:840`) | Manter. Conferir o TTL no deploy (P6, RULES-13) |
| `users/{uid}/workspaces` | Índice de participação (`name`, `type`, `workspaceStatus`, status do vínculo, `joinedAt`, `updatedAt`); **sem papel** | Backend, na mesma transação que altera o membership; o gatilho `onWorkspaceDisplayChange` propaga nome, tipo e status (`functions/src/workspaces/model.ts:88-148`; `functions/src/workspaces/indexSync.ts:31,80`) | `get` e `list` só do próprio uid com conta ativa; `list` com `limit <= 50`; `write: false` (`firestore.rules:1398-1402`) | `firestore.indexes.json:806` | Sem prazo; vínculo removido fica com `status: 'removed'` | Mantido; papel lido do membership (P1, PR-WS-03 fechado; RULES-18) |
| `job_checkpoints/{job}` | Cursor persistido do cron de recorrentes | Backend (`functions/src/crons/recurring.ts:84,391`) | Sem Rule: negado | — | Sem `expiresAt` | Manter server-only |
| `system/{doc}` | Cursor do rodízio de deriva de investimentos | Backend (`functions/src/crons/investmentDrift.ts:66`) | Sem Rule: negado | — | Sem `expiresAt` | Manter server-only |
| `platform_audit_events/{id}` | Auditoria de suspensão de conta (`account.suspended`) | Backend (`functions/src/workspaces/suspension.ts:27,58-73`) | Sem Rule: negado | — | Sem `expiresAt` (prazo: D-18) | Trilha administrativa unificada em P7 (PR-ADMIN-01) |

### 4.2 Workspace e membership

| Coleção | Finalidade | Escritor CURRENT | Rules CURRENT | Índices | Retenção CURRENT | TARGET · milestone · GAP |
| --- | --- | --- | --- | --- | --- | --- |
| `workspaces/{id}` | Tenant PF/PJ, `ownerId` desnormalizado, preferências | Backend: `bootstrapAccount` e `createWorkspace` criam (`functions/src/workspaces/lifecycle.ts:106-290`), `updateWorkspaceSettings` edita (`:303`), `archiveWorkspace` arquiva (`:394`) e `transferWorkspaceOwnership` atualiza `ownerId` (`functions/src/workspaces/memberships.ts:536`) | `read` de membro ativo; `create, update, delete: false` (`firestore.rules:943-944`); workspace arquivado não aceita escrita do cliente nas subcoleções (`firestore.rules:58-64`) | — | Sem prazo; arquivamento lógico (`status: 'archived'`), sem exclusão | `status` (`active` \| `archived`); `ownerId` só desnormalizado, nunca fonte de autorização (D-03); moeda fixa BRL (D-16). Quota adicionada em P2 na transação de `createWorkspace` (D-01, PR-ENT-01). Exclusão em P8 com tombstone que impede reuso do ID (RULES-06). PR-WS-05 fechado em P1 (PLAN §16.4) |
| `members/{uid}` | Membership e papel: única fonte de papel (D-03) | Backend: convite aceito, troca de papel, remoção lógica, saída e transferência (`functions/src/workspaces/memberships.ts:231-604`) | `write: false`; `get` do próprio uid (conta ativa) ou de membro ativo; `list` de membro ativo com `limit <= 200` (`firestore.rules:951-958`) | `firestore.indexes.json:824` (`status`, `joinedAt`) | Remoção lógica (`status: 'removed'`, `removedAt`, `removedBy`); sem exclusão | Mantido (P1; PR-WS-01, PR-WS-02 e PR-WS-04 fechados) |
| `invites/{inviteId}` | Convite vinculado a e-mail normalizado, com papel e expiração de 7 dias; sem token nem hash | Backend (`functions/src/workspaces/memberships.ts:104-367`) | Leitura de owner/admin, `list` com `limit <= 100`; `write: false` (`firestore.rules:962-967`) | — | `expiresAt` de 7 dias; TTL declarado (`firestore.indexes.json:852`) | Mantido; quota de membros em P2 (D-01); envio por e-mail depende de E-11 (P1, PR-WS-01 fechado) |
| `invite_tokens/{sha256(token)}` (top-level) | Ponteiro do hash do token para o convite (`workspaceId`, `inviteId`); só o hash é persistido | Backend (`functions/src/workspaces/model.ts:33,61-62`; `functions/src/workspaces/memberships.ts:190-195`) | Sem Rule: negado ao cliente | — | `expiresAt` de 7 dias; TTL declarado (`firestore.indexes.json:846`) | Manter server-only (P1, D-05) |
| `membership_events/{eventId}` | Auditoria append-only de conta, workspace, convite, papel, remoção, saída e transferência | Backend, na mesma transação da mudança (`functions/src/shared/audit.ts:58`) | Leitura de owner/admin, `list` com `limit <= 100`; `write: false` (`firestore.rules:971-976`) | — | Sem `expiresAt` (prazo: D-18) | Mantido; unificação da trilha em P7 (PR-OBS-01; P1, PR-WS-02 fechado) |

### 4.3 Caixa

| Coleção | Finalidade | Escritor CURRENT | Rules CURRENT | Índices | Retenção CURRENT | TARGET · milestone · GAP |
| --- | --- | --- | --- | --- | --- | --- |
| `transactions` | Lançamentos de caixa (fonte do caixa) e espelhos de outros domínios | Cliente: `addDoc`, `writeBatch`, `updateDoc` e baixa lógica (`src/modules/transactions/api.ts:258,284,323,355`). Backend grava espelhos: investimentos (`functions/src/investments/operationsV2.ts:462-493`), pagamento e estorno de fatura (`functions/src/creditCards/registerInvoicePayment.ts:407-428`, `functions/src/creditCards/reverseInvoicePayment.ts:452-465`), cron de recorrentes (`functions/src/crons/recurring.ts:337`) | Create/update por owner/admin/member (member só nas próprias), allowlist, `value` int ou float até 1e9, `type` imutável, investimento negado (`firestore.rules:40-98`, `202-263`, `1053-1087`); `delete: false` (`1094`) | Nenhum composto versionado | Nunca expira; baixa lógica `voidedAt` | Callables de lançamento, edição e anulação em `amountCents`, com evento append-only; `write: false` (P3, PR-TX-01, PR-TX-02, PR-TX-05). Remover `parcelado` e campos de fatura (P4, PR-TX-06) |
| `activity_logs` | Trilha de atividade gerada pelo gatilho de transações | Backend (`functions/src/triggers/transactions.ts:103-121`) | Catch-all: leitura por qualquer membro, escrita negada (`firestore.rules:1436-1442`) | — | `expiresAt` 365 dias (`functions/src/triggers/transactions.ts:19,114`) | Substituída ou reclassificada pela trilha append-only com ator real (P3, PR-TX-05; ENTRY-17). Leitura restrita (PR-RULES-02). Prazo: D-18 |
| `cash_report_periods` | Projeção mensal oficial de caixa | Backend: gatilho e rebuild (`functions/src/triggers/transactions.ts:71-80`, `functions/src/cash/periods.ts:31`, `functions/src/cash/rebuild.ts:208-235`) | `get` por membro; `list` com `limit <= 600`; `write: false` (`firestore.rules:1277-1284`) | — | Nunca expira | Fórmula de caixa única, retry idempotente e cerca de versão no rebuild (P3, PR-TX-03, PR-TX-04) |
| `cash_period_events` | Marca de entrega por evento (idempotência do gatilho) | Backend (`functions/src/cash/periods.ts:335-362`) | `read, write: false` (`firestore.rules:1289-1291`) | — | `expiresAt` 90 dias (`functions/src/cash/periods.ts:360`) | Manter. TTL versionado (P6, RULES-13) |

### 4.4 Cartões de crédito

| Coleção | Finalidade | Escritor CURRENT | Rules CURRENT | Índices | Retenção CURRENT | TARGET · milestone · GAP |
| --- | --- | --- | --- | --- | --- | --- |
| `credit_cards` | Cadastro e configuração autoritativa (limite, ciclo, status) | Cliente: `addDoc`/`updateDoc`/`deleteDoc` (`src/modules/credit-cards/api.ts:77,92,100`) | Create/update owner/admin com allowlist, `limitTotal` float, `limitUsed`/`limitAvailable` travados (`firestore.rules:918-988`, `1107-1116`); delete owner/admin (`1118`) | — | Hard delete | Callables de cadastro e arquivamento em centavos; `write: false` (P4, PR-CC-01, PR-CC-02) |
| `credit_card_purchases`, `credit_card_installments`, `credit_card_invoices`, `credit_card_invoice_payments`, `card_limit_ledger`, `card_limit_snapshots`, `invoice_views`, `financial_events` | Compras, parcelas, faturas, pagamentos, ledger e snapshot de limite, read model de faturas, eventos de domínio | Backend: 9 callables com Zod, transação e idempotência (`functions/src/creditCards/callables.ts:138-189`; coleções em `functions/src/creditCards/adminPaths.ts:3-16`) e cron de faturas | Leitura por membro, `write: false` (`firestore.rules:1121-1154`, `1166-1169`) | invoices: `firestore.indexes.json:4,22,36,54` + collection group `592`; installments `68,82,100,114`; purchases `132,146`; payments `164,178`; ledger `196,210`; invoice_views `228,242` | Nunca expiram | Manter backend; centavos (P4, PR-CC-06); máquina de estados da fatura (PR-CC-05); cron com releitura e cursor (PR-CC-04); consultas corretas (PR-CC-07); remover `invoice_views` de compatibilidade se sem consumidor (READ-05) |
| `credit_card_audit_logs` | Trilha de auditoria do domínio | Backend (`functions/src/creditCards/adminPaths.ts:11`) | Leitura owner/admin, `write: false` (`firestore.rules:1156-1159`) | **Ausente** (PR-CC-08) | Nunca expira | Índice `cardId ASC, occurredAt DESC` (P4, PR-CC-08) |
| `credit_card_operational_metrics` | Métrica operacional diária | Backend | Leitura owner/admin, `write: false` (`firestore.rules:1161-1164`) | — | Sem `expiresAt` (CC-20) | `expiresAt` e TTL; observabilidade unificada (P7, PR-OBS-01) |
| `credit_card_idempotency_keys` | Reserva de idempotência | Backend | `read, write: false` (`firestore.rules:1171-1174`) | — | Sem `expiresAt` (CC-20) | `expiresAt` e TTL (FIRE-08) |

### 4.5 Recorrentes, divisão de contas, empréstimos e recebíveis

| Coleção | Finalidade | Escritor CURRENT | Rules CURRENT | Índices | Retenção CURRENT | TARGET · milestone · GAP |
| --- | --- | --- | --- | --- | --- | --- |
| `recurring_expenses` | Contrato recorrente | Cliente (`src/modules/recurring-expenses/api.ts:207,230,238`); o cron lê e atualiza (`functions/src/crons/recurring.ts:419-424`, `459-521`) | Escrita livre de owner/admin/member, sem schema, inclui delete (`firestore.rules:1097-1100`) | Collection group `firestore.indexes.json:694` | Hard delete | Callables + cron, `write: false`, arquivamento (P4, PR-REC-01, PR-RULES-01). Query do cron por `nextDueDate <= hoje` com índice (READ-12) |
| `recurring_occurrences` | Ocorrência gerada; marcador de idempotência do cron | Cliente `setDoc` merge (`src/modules/recurring-expenses/api.ts:327`) e cron (`functions/src/crons/recurring.ts:459-521`) | Escrita livre de member (`firestore.rules:1102-1105`) | `firestore.indexes.json:752` | Fica órfã quando a recorrência é apagada | Server-only, ocorrência por data com ID determinístico (P4, PR-REC-01, PR-REC-02, PR-REC-03) |
| `split_groups`, `split_bills`, `split_shares` | Grupos, títulos e rateios | Cliente: `runTransaction`, `writeBatch`, `updateDoc`, cascatas de delete (`src/modules/split-bills/api.ts:145,194-233,296,325,357-375,379,458`) | Escrita livre de member, sem schema, inclui delete (`firestore.rules:1384-1387`, `1394-1402`) | — | Hard delete em cascata | Módulo backend `splitBills`, centavos, arquivamento e anulação; `write: false` (P4, PR-SPLIT-01, PR-SPLIT-02, PR-SPLIT-05) |
| `split_participants` | Participante e papel no grupo | Cliente (`src/modules/split-bills/api.ts:145,249-260`) e backend no aceite de convite (`functions/src/callables/splitGroups.ts:249`) | Escrita livre de member (`firestore.rules:1389-1392`) | — | Hard delete ao sair | Papel lido no servidor; inativação em vez de delete (P4, PR-SPLIT-04) |
| `split_invites` | Convite com código e expiração | Backend (`functions/src/callables/splitGroups.ts:144-167`) | Catch-all: leitura por qualquer membro (expõe `codigoConvite`), escrita negada (`firestore.rules:1436-1442`) | `firestore.indexes.json:770,788` | `expiraEm` string ISO de 7 dias, sem `expiresAt` (`functions/src/callables/splitGroups.ts:140-142,164`) | Rule explícita de leitura restrita (PR-RULES-02); `expiresAt` com TTL e revogação (SPLIT-16) |
| `loans`, `loan_movements` | Contrato e movimentos de empréstimo | Cliente: `addDoc`, `updateDoc`, `runTransaction` que recalcula saldo, cascata de delete (`src/modules/loans/api.ts:221,238,257-284,340-369`) | Escrita livre de member, sem schema, inclui delete (`firestore.rules:1351-1359`) | loans `firestore.indexes.json:712`; loan_movements `734` | Hard delete em cascata | `createLoan`, `registerLoanPayment`, `reverseLoanMovement`, `cancelLoan` numa transação com espelho de caixa; `write: false` (P3, PR-LOAN-01…PR-LOAN-04) |
| `clients`, `receivables` | Clientes (dados pessoais de terceiros) e contas a receber | Cliente (`src/modules/clients/api.ts:59,74,78-90,123,138,142-145`) | Escrita livre de member, sem schema, inclui delete (`firestore.rules:1361-1369`) | — | Hard delete; cascata não atômica | Callables com `amountCents`; recebimento que gera a receita na mesma transação; arquivamento e anonimização do cliente; `write: false` (P3, PR-CR-01…PR-CR-04; P8, PR-CR-05) |

### 4.6 Metas e investimentos

| Coleção | Finalidade | Escritor CURRENT | Rules CURRENT | Índices | Retenção CURRENT | TARGET · milestone · GAP |
| --- | --- | --- | --- | --- | --- | --- |
| `goals` | Metas e progresso publicado | Backend: callables com transação e idempotência (`functions/src/goals/operations.ts`); arquivamento lógico (`273-277`) | Leitura por membro, `write: false` (`firestore.rules:1176-1179`) | — | Nunca expira; arquivamento `archived`/`status` | Projeção única em centavos; `listGoals` paginado (P5, PR-GOAL-01…PR-GOAL-04) |
| `goal_audit_logs` | Trilha de auditoria de metas | Backend (`functions/src/goals/operations.ts:128-129`) | Leitura owner/admin, `write: false` (`firestore.rules:1181-1184`) | — | Sem `expiresAt`; guarda before/after completos (GOAL-14) | Diff mínimo sem texto livre; prazo D-18 |
| `goal_idempotency_keys` | Reserva de idempotência | Backend (`functions/src/goals/operations.ts:72`) | `read, write: false` (`firestore.rules:1186-1188`) | — | Sem `expiresAt` (GOAL-14) | `expiresAt` e TTL |
| 14 coleções `investment_*` (ver árvore) | Ledger (`investment_movements`), catálogo, posições, valorações, projeções, checkpoints, eventos, métricas, deriva, idempotência | Backend: 23 callables com Zod, papel relido na transação, centavos/micros (`functions/src/investments/callables.ts:107-251`; nomes em `functions/src/investments/paths.ts:3-21`) | `get` com validação de schema, `list` com `limit <= 100`, `write: false`; tier sensível (snapshots, event logs, import batches, métricas, deriva) só owner/admin (`firestore.rules:473-477`, `1190-1349`); `investment_summaries` só `get` de `current` (`1304-1329`); idempotência `read, write: false` (`1300-1302`) | movements `firestore.indexes.json:256,502,520,538,610,676`; valuations `282,636`; positions `304,462,480,560`; accounts `426`; assets `444`; allocation `574`; drift `658` | Fatos nunca expiram; `expiresAt` em idempotência 90 dias, métricas 400 dias, eventos de falha 400 dias, deriva 400 dias (§5.4) | Manter (base sólida). Leitura só por projeções oficiais; remover fallbacks em `transactions` (P4, PR-INV-01; D-15) |

### 4.7 Catálogo, notificações e controle operacional

| Coleção | Finalidade | Escritor CURRENT | Rules CURRENT | Índices | Retenção CURRENT | TARGET · milestone · GAP |
| --- | --- | --- | --- | --- | --- | --- |
| `settings_catalog` | Categorias, tipos, carteiras, classes de investimento | Cliente `runTransaction` (`src/modules/settings-catalog/api.ts:182,240,334`); o backend semeia o catálogo padrão na criação do workspace, na mesma transação (`functions/src/workspaces/provisioning.ts:97`, `functions/src/investments/onboarding.ts:203`); o seed pelo cliente (`seedLegacySettingsCatalog`, callable e wrapper) foi removido em P1 | Escrita owner/admin com allowlist e imutáveis; `delete: false`; leitura por membro (`firestore.rules:219-376`, `1330-1342`) | `firestore.indexes.json:322,348,370,400`; **ausente** para a leitura sem `group` (PR-RULES-03) | Nunca expira; exclusão = `status: 'inactive'` | Índice e correção do rename (P4, PR-RULES-03; RULES-12). Seed no `bootstrapAccount`/`createWorkspace` entregue em P1. Callable ou Rules estritas: DECISION D-23 (P4) |
| `settings_catalog_uniques` | Reserva de nome único | Cliente e seed do backend na criação do workspace (mesmas evidências) | Create/update owner/admin com allowlist; `delete: false` (`firestore.rules:1344-1359`) | — | Nunca expira | Idem |
| `notifications` | Notificações in-app por workspace | Backend: domínio de cartões (§7) | Leitura por membro sem `limit`; `create: false`; update só de `read` por qualquer membro; delete owner/admin (`firestore.rules:1371-1382`) | — | Sem `expiresAt` | §7 (P5, PR-NOTIF-01) |
| `rate_limits` (workspace) | Contador de frequência por workspace e ator | Backend (`functions/src/shared/rateLimit.ts:55-70`) | Negado pela lista `isBackendOwnedCollection` (`firestore.rules:808`) e escrita `false` no catch-all | — | `expiresAt` 2 dias (`functions/src/shared/rateLimit.ts:144`) | Rule explícita `read, write: false` quando o catch-all sair (PR-RULES-02) |

### 4.8 Coleções a criar (TARGET)

Nomes propostos pela auditoria. O milestone confirma nome e schema antes de implementar; nada abaixo existe no HEAD (`invites` e `membership_events`, de P1, foram implementados e estão na §4.2; as coleções de billing de P2A foram implementadas e estão na §4.1: `billing_accounts`, `billing_events`, `billing_customers` e `billing_webhook_events`, que saíram desta tabela).

| Coleção proposta | Finalidade | Escritor | Milestone · GAP/DECISION |
| --- | --- | --- | --- |
| Evento append-only por mutação de caixa | Antes/depois em centavos, ator, motivo, `correlationId` | Backend | P3 · PR-TX-05 (a auditoria propõe reutilizar `financial_events`; trilha definida por D-35, P3) |
| Estado de leitura por usuário (ex.: `workspaces/{id}/notification_reads/{uid}`) | `lastReadAt` e dispensadas por usuário | Próprio uid, com schema nas Rules | P5 · PR-NOTIF-01 (NOTIF-02) |
| Alertas persistidos (`workspaces/{id}/alerts` ou `notifications`) | Alertas de relatório com ID determinístico por regra e período | Backend | P5 · PR-RPT-04 |
| Registro de aceite versionado | Aceite de termos e política por uid e versão | Backend | P8 (registro) e P9 (cadastro) · PR-AUTH-02 |
| `dsr_requests` | Solicitações de titular com prazo e auditoria | Backend | P8 · PR-PRIV-01 |
| `admin_audit_logs` | Trilha imutável de ações administrativas | Backend | P7 · PR-ADMIN-01 · D-10 |

## 5. Índices

### 5.1 CURRENT

`firestore.indexes.json` tem 45 índices compostos e 4 TTLs em `fieldOverrides` (`firestore.indexes.json:838-862`). Dois são `COLLECTION_GROUP`, ambos para crons: `credit_card_invoices (status, dueDate, __name__)` (`firestore.indexes.json:592`, consumido por `functions/src/crons/creditCardInvoices.ts:341-349`) e `recurring_expenses (status, gerarDespesaAutomaticamente, __name__)` (`firestore.indexes.json:694`, consumido por `functions/src/crons/recurring.ts:418-424`).

| Coleção | Qtde | Linhas | Observação |
| --- | --- | --- | --- |
| `credit_card_invoices` | 5 | 4, 22, 36, 54, 592 | 22, 36 e 54 sem consumidor em produção (READ-11) |
| `credit_card_installments` | 4 | 68, 82, 100, 114 | 114 sem consumidor (READ-11) |
| `credit_card_purchases` | 2 | 132, 146 | — |
| `credit_card_invoice_payments` | 2 | 164, 178 | — |
| `card_limit_ledger` | 2 | 196, 210 | Ambos sem consumidor (READ-11) |
| `invoice_views` | 2 | 228, 242 | 242 sem consumidor (RULES-17, READ-11) |
| `investment_movements` | 6 | 256, 502, 520, 538, 610, 676 | — |
| `investment_positions` | 4 | 304, 462, 480, 560 | — |
| `investment_valuations` | 2 | 282, 636 | — |
| `investment_accounts`, `investment_assets`, `investment_allocation_summaries` | 3 | 426, 444, 574 | — |
| `investment_drift_reports` | 1 | 658 | Sem consumidor: gravado só por ID (RULES-17) |
| `settings_catalog` | 4 | 322, 348, 370, 400 | Todos começam por `group` |
| `recurring_expenses` | 1 | 694 | Collection group |
| `recurring_occurrences` | 1 | 752 | — |
| `loans`, `loan_movements` | 2 | 712, 734 | Agregado e página de movimentos |
| `split_invites` | 2 | 770, 788 | — |
| `workspaces` (índice do usuário) | 1 | 806 | `status`, `workspaceStatus`, `joinedAt`; consumido por `src/modules/workspaces/api.ts:112-117` (P1) |
| `members` | 1 | 824 | `status`, `joinedAt`; consumido por `src/modules/workspaces/api.ts:170-174` (P1) |

As funções de leitura de cartão que usariam os índices sem consumidor existem, mas não têm chamador (`src/modules/credit-cards/persistence/readApi.ts:108,150,171,216,234,338,358`, READ-11). Exemplos conferidos no HEAD: `orderBy('competenceMonth','desc')` em `readApi.ts:159` e `orderBy('createdAt','desc')` em `readApi.ts:346`, ambos dentro dessas funções.

### 5.2 GAP

| Item | Evidência | ID | Milestone |
| --- | --- | --- | --- |
| Índice ausente `credit_card_audit_logs (cardId ASC, occurredAt DESC)` | `src/modules/credit-cards/persistence/readApi.ts:464-482` (`where cardId` + `orderBy occurredAt desc`); consumidor `src/components/CreditCardsView.tsx:725` | PR-CC-08 (HIGH) | P4 |
| Índice ausente para `settings_catalog` ordenado por `sortOrder, normalizedName, __name__` sem filtro | `src/modules/settings-catalog/api.ts:115-121`; todos os índices do grupo começam por `group` | PR-RULES-03 (HIGH) | P4 |
| Índices sem consumidor | Tabela §5.1 | RULES-17, READ-11 (LOW/MEDIUM) | Remover junto com o consumidor morto (política de legado) |
| TTL e isenções parcialmente versionados: P1 declarou os TTLs de `invites`, `invite_tokens` e `idempotency_keys` e P2A o de `billing_webhook_events`; o restante da tabela de retenção segue sem TTL versionado | `firestore.indexes.json:838-862`; `functions/src/shared/retention.ts:17-20` | RULES-13, FIRE-08, INV-11, READ-18 (MEDIUM/LOW) | P6 (TTL versionado no escopo do P6) |
| Nenhum gate confere queries contra `firestore.indexes.json`; o Emulator não exige índice composto | READ-11; `tests/unit/investment-simple-rows.test.ts:219-231` é a única menção, em comentário | READ-11 (MEDIUM) | Ao tocar a superfície (P3–P5) e P6 |

### 5.3 TARGET

- Cada callable ou tela nova declara suas queries, e um teste extrai as queries do código e confere a cobertura em `firestore.indexes.json`. O índice entra no mesmo commit da query (AGENTS.md).
- `fieldOverrides` declara `expiresAt` com `ttl: true` e `indexes: []` em cada coleção da tabela de retenção (P1 já declarou `invites`, `invite_tokens` e `idempotency_keys`; P2A, `billing_webhook_events`), além de isenção para mapas volumosos (`details`, `displaySnapshots`). O desenho está em [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md#7-ttl-versionado-target).
- O deploy de índices passa por STAGING antes de PROD, com espera da construção (P6, PR-PLAT-01; RULES-14). **EXTERNAL CONFIGURATION REQUIRED:** criação e conferência dos índices por ambiente, estado NÃO VERIFICADO (E-01, E-07).

## 6. Paginação, leituras e listeners

### 6.1 CURRENT

As Rules impõem `request.query.limit` em `investment_*` (`firestore.rules:413-415`), em `cash_report_periods` (`firestore.rules:1205-1207`) e, desde P1, em `members` (até 200), `invites` e `membership_events` (até 100) e no índice do usuário (até 50) (`firestore.rules:955,965,974,1401`). As demais coleções aceitam `list` sem limite (READ-10, RULES-11).

| Superfície | Padrão CURRENT | Evidência | GAP |
| --- | --- | --- | --- |
| Transações | Janela de 12 meses, 500 por página, até 40 páginas (até 20.000 documentos); anuladas filtradas no cliente; relê tudo a cada mutação | `src/modules/transactions/api.ts:118-127,185-205`; `src/modules/transactions/hooks.ts:17-27` | PR-RPT-02 (READ-08) |
| Projeção de caixa | `limit 600` com `truncated` | `src/modules/transactions/cashPeriods.ts:66-101` | — |
| Investimentos | Cursor + `limit <= 100` | `src/modules/investments/persistence/readApi.ts:51-64,196-230` | — |
| Empréstimos, recorrentes, divisão, catálogo | Cursor + limit; totais de loans por `getAggregateFromServer` | `src/modules/loans/api.ts:130-150,163-206`; `src/modules/recurring-expenses/api.ts:126-174`; `src/modules/split-bills/api.ts:109-128`; `src/modules/settings-catalog/api.ts:108-170` | N+1 nos cards de grupo (READ-15) |
| Cartões (readApi) | Limite padrão 50, teto 200, sem cursor; relatório pede 5.000 e recebe 200 | `src/modules/credit-cards/persistence/readApi.ts:67-80`; `src/modules/reports/hooks.ts:85-90` | PR-CC-07 |
| Sem `limit` | `clients`, `receivables`, `credit_cards`, `card_limit_snapshots` | `src/modules/clients/api.ts:41,98`; `src/modules/credit-cards/api.ts:53`; `src/modules/credit-cards/persistence/readApi.ts:120` | PR-CR-04 (READ-16) |
| Notificações | Coleção inteira + polling de 30 s | §7 | PR-NOTIF-01 |
| Metas | Duas queries com `limit(100)`, sem cursor nem aviso | `src/modules/goals/api.ts:47-62` | PR-GOAL-02 (READ-19) |
| Descoberta de workspaces | Índice do usuário mantido pelo backend: uma consulta paginada por cursor (50 por página, sob demanda) e `members` paginado (200 por página); sem `collectionGroup` nem escrita no caminho de leitura | `src/modules/workspaces/api.ts:69,112-142,170-196` | PR-WS-03 (fechado em P1 (PLAN §16.4); READ-14) |
| Listeners | Único `onSnapshot`: `usePlan`, um por consumidor e sem callback de erro | `src/hooks/usePlan.ts:20-33` | BILL-15 |
| Crons | Faturas: collection group sem cursor persistido, reprocessa o backlog vencido; recorrentes: sem filtro de data; deriva: 50 workspaces por execução | `functions/src/crons/creditCardInvoices.ts:341-349`; `functions/src/crons/recurring.ts:418-424`; `functions/src/crons/investmentDrift.ts:58` | PR-CC-04; READ-12; READ-17 |
| Transações de cartão | Leituras sem teto dentro de uma transação (ledger inteiro, todas as faturas do cartão) | `functions/src/creditCards/recalculateCardLimit.ts:147-160`; `functions/src/creditCards/rebuildInvoices.ts:300-316` | READ-13 |

### 6.2 TARGET

- Toda Rule de `list` de workspace exige `request.query.limit <= N`, com teste de N+1 no Emulator.
- Listas usam cursor e sinal de truncamento visível. Dashboard, relatórios e metas leem `cash_report_periods`, projeções de investimentos e agregados de cartão, recebíveis e empréstimos mantidos pelo backend (P3–P5).
- Crons processam só o conjunto elegível (ex.: `nextDueDate <= hoje`, faturas por janela fechada), com checkpoint persistido ou fan-out por workspace.
- Sem polling de coleção inteira e sem leitura global no caminho quente.

## 7. Notifications

**CURRENT**
- Único produtor real: o domínio de cartões, pelo Admin SDK, na mesma transação do evento e com ID determinístico (`functions/src/creditCards/domainNotifications.ts:262-297`). Falhas autorizadas de callable de cartão também geram notificação, sem deduplicação nem rate limit (`functions/src/creditCards/observability.ts:266-296`, NOTIF-04).
- Schema: `read: false` único por documento e `createdAt` como string ISO do relógio da Function (`functions/src/creditCards/domainNotifications.ts:281,284`). Não há `expiresAt`, e `RETENTION_DAYS` não cobre a coleção (`functions/src/shared/retention.ts:23-47`).
- Leitura da coleção inteira, sem `limit`, com erro convertido em lista vazia (`src/modules/notifications/api.ts:18-34`), polling de 30 s (`src/modules/notifications/hooks.ts:16`) num Header sempre montado (`src/components/Header.tsx:50`).
- Marcar como lida: `updateDoc`, e "marcar todas" por `writeBatch` sem teto de 500 (`src/modules/notifications/api.ts:51-66`). "Arquivar" é `deleteDoc` (`src/modules/notifications/api.ts:68-71`; `src/modules/notifications/hooks.ts:58-70`), que as Rules só permitem a owner/admin (`firestore.rules:1381`).
- `createNotification` no cliente é código morto e seria negado (`src/modules/notifications/api.ts:37-49`; `src/App.tsx:231`; `firestore.rules:1374`). Tipos de meta, recorrente e divisão não têm produtor (`src/modules/notifications/types.ts:1-8`).

**TARGET** (P5)
- Escrita só pelo backend, por um outbox de domínio generalizado a partir de `enqueueCreditCardDomainNotifications`, com schema fixo: `domain`, `severity`, `title` e `message` em pt-BR, `link`, `createdAt` como Timestamp de servidor, `expiresAt`, valores formatados a partir de centavos.
- Leitura com `limit <= 50` e cursor (`createdAt desc`, `__name__`). Rules exigem `limit` e negam `create`, `update` e `delete` no documento compartilhado.
- Estado de leitura e de arquivamento por usuário, num documento próprio gravável só pelo dono e com schema nas Rules (§4.8). Contador de não lidas por agregado limitado ou contador do backend. Fim do polling da lista completa.
- Retenção por TTL em `expiresAt`, versionada em `fieldOverrides`. Se a query filtrar por destinatário, o índice composto entra em `firestore.indexes.json`.
- Falhas de callable deduplicadas por janela e sujeitas a rate limit (NOTIF-04).

**GAP:** PR-NOTIF-01 (HIGH, P5). MEDIUM/LOW de origem: NOTIF-02 (leitura compartilhada), NOTIF-04, NOTIF-05 (sem testes de Rules), NOTIF-06, NOTIF-07, NOTIF-08, NOTIF-09.

**DECISION:** prazo de retenção (D-18); destinatário por papel ou por uid; domínios emissores no lançamento; canais além do in-app (e-mail/push exigiriam E-11).

## 8. Messages

**CURRENT:** funcionalidade simulada. Threads e mensagens ficam em `localStorage` com chave `app_chat_threads`/`app_chat_messages` sufixada só pelo `workspaceId`, sem uid (`src/modules/messages/api.ts:29-66`). Há threads e usuários fixos (`src/modules/messages/api.ts:5-27,148-154`), remetente sempre `me` (`src/modules/messages/api.ts:86-93`) e presença "Online" fixa (`src/components/MessagesPanel.tsx:240`). O painel está exposto no Header (`src/components/Header.tsx:255-274`). Não existe coleção, Rule, Function nem teste.

**TARGET (DECISION D-09):** a auditoria recomenda remover Mensagens no lançamento (módulo, painel, badge e modal), o que altera a UI e exige aprovação. Se D-09 optar por implementar: callables com Admin SDK, coleção com Rules por participante, membros reais de `members`, retenção definida em D-18, testes no Emulator e limpeza das chaves locais.

**GAP:** PR-MSG-01 (HIGH, P5). Pré-requisito de segurança: com o catch-all atual, uma coleção de mensagens sem entrada em `isBackendOwnedCollection` seria legível por qualquer membro, porque as Rules concedem por OR (MSG-02 em PR-RULES-02, MEDIUM, P6).

## 9. Armazenamento fora do Firestore

| Armazenamento | CURRENT | Evidência | TARGET · GAP |
| --- | --- | --- | --- |
| `localStorage`: histórico do chat de IA | Chave `finance_ai_chat_history_${workspaceId}`, sem uid; apagada no logout e na troca de conta desde P1, mas persiste no navegador entre sessões | `src/modules/reports/hooks.ts:341-358`; `src/lib/sessionCleanup.ts:18-40`; `src/contexts/AuthContext.tsx:57-68,135-143` | Histórico em memória ou server-side por (workspace, uid) com retenção (P5, PR-AI-04); a limpeza no logout foi entregue em P1 |
| `localStorage`: último workspace | Chave `lastWorkspaceId_<uid>`, por usuário; apagada no logout e na troca de conta | `src/contexts/WorkspaceContext.tsx:39,81`; `src/lib/sessionCleanup.ts:18-23` | Manter (preferência não essencial; o membership ativo decide o acesso) |
| `localStorage`: Messages | §8 | `src/modules/messages/api.ts:29-66` | PR-MSG-01 |
| Cloud Storage | SDK inicializado, sem uso e sem `storage` em `firebase.json` | `src/lib/firebase.ts:39`; `firebase.json:1-7` | Remover ou versionar Rules antes de usar (FIRE-12) |

## 10. Testes exigidos (TARGET)

- Uma suíte de Rules por coleção, no Emulator, com owner, admin, member, viewer, não membro e membro removido; create, update, delete, get e list; cross-tenant; payload inválido; `list` com `limit` N+1. Hoje não há cobertura de escrita para `credit_cards`, `loans`, `loan_movements`, `clients`, `receivables`, `split_*`, `recurring_*`, `notifications`, `settings_catalog_uniques`, `activity_logs` e `split_invites` (RULES-15, em PR-REL-02).
- Teste que enumera as coleções usadas pelo código e falha se alguma cair no catch-all (RULES-09, PR-RULES-02).
- Teste de cobertura de índices contra `firestore.indexes.json` (READ-11) e teste que compara `fieldOverrides` com a tabela de retenção.
- Integração no Emulator das callables que substituem cada escritor cliente, com idempotência, concorrência e prova de remoção do caminho antigo (política de legado do plano).

## 11. Referências

- [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers): registro, §7 (legado), §8 (milestones), §10 (decisões), §11 (configuração externa).
- [ARCHITECTURE.md](ARCHITECTURE.md), [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md), [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md), [SECURITY_MODEL.md](SECURITY_MODEL.md), [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md), [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md).
