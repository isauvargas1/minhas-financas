# Retenção e ciclo de vida de dados

Política de retenção e de ciclo de vida dos dados do Minhas Finanças: o que expira, o que nunca expira, como se exclui, arquiva, cancela ou estorna, e como a eliminação a pedido do titular convive com a proibição de apagar histórico financeiro. O documento registra o estado auditado no HEAD `9c3ab46` e remete ao [plano mestre](PRODUCTION_READINESS_PLAN.md) para IDs, milestones e decisões. O gate do tema é da skill `privacy-lgpd-data-lifecycle`. Os mecanismos de plataforma (TTL configurado, PITR, backups) também passam por `firebase-production-readiness`. Este documento não é parecer jurídico: todo prazo legal citado é referência a confirmar pelo jurídico (E-09).

## 1. Regras de leitura

- Rótulos: **CURRENT**, **TARGET**, **GAP**, **DECISION** e **EXTERNAL CONFIGURATION REQUIRED**, como definidos no [plano mestre](PRODUCTION_READINESS_PLAN.md#classificação-usada-em-docsproduction).
- Invariante do produto (AGENTS.md): não há hard delete de histórico financeiro. Invariante do código (**CURRENT**): "fato financeiro necessário para auditoria ou reconstrução nunca expira" e nenhum desses documentos recebe `expiresAt` (`functions/src/shared/retention.ts:11-15`).
- Prazos de retenção por categoria ainda não definidos são **DECISION D-18**. A resolução entre histórico financeiro e eliminação LGPD é **DECISION D-07**. Exclusão e exportação de conta e de workspace ficam em P8 (D-ORD-03).
- O inventário de coleções e escritores está em [DATA_MODEL.md](DATA_MODEL.md). O inventário de dados pessoais e as bases legais estão em [PRIVACY_LGPD.md](PRIVACY_LGPD.md). Backups e restore estão em [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md).

## 2. Mecanismos CURRENT

### 2.1 `RETENTION_DAYS`

`functions/src/shared/retention.ts:23-61` define a política das coleções operacionais. `expiresAt` é só a marca: quem apaga é a política de TTL do Firestore, que é configuração de projeto (`functions/src/shared/retention.ts:17-20`).

| Chave | Dias | Uso no HEAD |
| --- | --- | --- |
| `idempotencyKeys` | 90 | `idempotency_keys` das callables por ator (`functions/src/shared/idempotency.ts:95`) e `investment_idempotency_keys` (`functions/src/investments/infrastructure.ts:232`) |
| `operationalMetrics` | 400 | `investment_operational_metrics` (`functions/src/investments/observability.ts:119`) |
| `eventLogs` | 400 | Eventos de **falha** em `investment_event_logs` (`functions/src/investments/observability.ts:231-237`) e `investment_drift_reports` (`functions/src/crons/investmentDrift.ts:263`) |
| `rateLimits` | 2 | `rate_limits` de workspace e de usuário (`functions/src/shared/rateLimit.ts:173`) |
| `completedCheckpoints` | 30 | **Sem uso**: só a definição (`functions/src/shared/retention.ts:37`) |
| `cashPeriodEvents` | 90 | `cash_period_events` (`functions/src/cash/periods.ts:657`) |
| `billingWebhookEvents` | 90 | `billing_webhook_events` (recibo do webhook, P2A; `functions/src/billing/webhook.ts:366`) |
| `aiUsageReceipts` | 90 | `users/{uid}/ai_usage_receipts` (recibo de débito de crédito de IA, P2B.2; `functions/src/billing/aiCredits.ts:144`) |

Fora da tabela, `activity_logs` recebe `expiresAt` de 365 dias por constante própria (`functions/src/triggers/transactions.ts:25,221`), e os convites têm prazo de negócio no próprio `expiresAt`: 7 dias nos convites de workspace (`INVITE_TTL_DAYS`, `functions/src/workspaces/inviteTokens.ts:14`) e em `split_invites` (`SPLIT_INVITE_TTL_MS`, `functions/src/splitBills/model.ts:125`).

### 2.2 Ativação do TTL

- **CURRENT (versionado no repositório):** 12 políticas de TTL em `expiresAt` versionadas em `firestore.indexes.json` (`fieldOverrides`): `idempotency_keys`, `invite_tokens`, `invites`, `split_invites`, `billing_webhook_events`, `ai_usage_receipts`, `cash_period_events`, `rate_limits` e, desde a P4-D, `investment_idempotency_keys`, `investment_operational_metrics`, `investment_event_logs` (só eventos de falha têm `expiresAt`) e `investment_drift_reports` (teste: `functions/src/investments/__tests__/documentContracts.test.ts`). A publicação é deploy de índices, fora do escopo dos agentes; `docs/investments/TTL_MANIFEST.md` é registro histórico.
- **CURRENT (lacunas de cobertura):** `activity_logs` grava `expiresAt` (365 dias) sem política de TTL declarada — o destino dessa trilha (log operacional com TTL ou registro com outro prazo) depende de D-18 (RULES-13, READ-18); `goal_idempotency_keys` não grava `expiresAt` (GOAL-14, P5); `notifications` não tem retenção (PR-NOTIF-01, P5).
- **CURRENT:** o plano mestre classifica `TTL_MANIFEST.md` como OUTDATED (§13). Divergências conferidas no HEAD:
  - o manifesto chama `investment_audit_logs` de trilha de auditoria de investimentos (`docs/investments/TTL_MANIFEST.md:44,118`), mas nenhum código em `functions/src` grava essa coleção; ela só aparece em testes de Rules como coleção removida (`tests/firestore/investment-redemptions.rules.integration.test.mjs:221`);
  - as linhas de código citadas no manifesto estão deslocadas (ex.: `infrastructure.ts:329` × `232` no HEAD);
  - o comentário de `retention.ts` remetia a ativação ao `PRODUCTION_DEPLOYMENT_CHECKLIST.md`, também OUTDATED; desde a P4-D.1 aponta para os `fieldOverrides` e para este documento (`functions/src/shared/retention.ts:17-20`);
  - o ensaio de STAGING fala em "seis coleções" e cita `investment_operation_leases`, já removida (FIRE-08).
- **EXTERNAL CONFIGURATION REQUIRED:** versionado no repositório não significa ativo. A publicação das 12 políticas e o estado delas em qualquer projeto são NÃO VERIFICADOS (E-07); nenhuma foi publicada por esta etapa nem pelas anteriores. Enquanto o TTL não estiver ativo, os documentos com `expiresAt` não são apagados.

### 2.3 Semântica de `expiresAt` que exige atenção

- **CURRENT:** `investment_event_logs` mistura dois tipos de documento. Os eventos de sucesso, que são a trilha de auditoria do domínio, não têm `expiresAt` (`recordInvestmentEvent`, `functions/src/investments/infrastructure.ts:236-267`). Os eventos de falha têm 400 dias (`functions/src/investments/observability.ts:231-237`). O TTL só remove documentos que têm o campo, então a política nessa coleção apaga apenas falhas. A mistura é frágil: um `expiresAt` acrescentado por engano ao evento de sucesso apagaria a trilha.
- **CURRENT:** a política de TTL vale por grupo de coleção. Uma política em `rate_limits` cobre `workspaces/{id}/rate_limits` e `users/{uid}/rate_limits`.
- **CURRENT (P3-B):** `onTransactionWrite` declara `retry: true`, e a reentrega do Eventarc dura até 24 horas na 2ª geração. O comentário de `cashPeriodEvents` foi corrigido (`functions/src/shared/retention.ts:38-49`). As marcas também servem à reconstrução em andamento, que soma as posteriores ao corte e recomeça depois de 24 horas. 90 dias cobrem as duas janelas com folga.

### 2.4 Coleções operacionais sem `expiresAt`

| Coleção | Evidência | Origem |
| --- | --- | --- |
| `credit_card_idempotency_keys` | Removida na P4-A, sem migração (idempotência no kernel compartilhado `reserveActorIdempotency`) | CC-20 |
| `credit_card_operational_metrics` | Removida na P4-A, sem migração | CC-20 |
| `goal_idempotency_keys` | `functions/src/goals/operations.ts:76` | GOAL-14 |
| `notifications` | `functions/src/cards/closing.ts:161,227` (notificações de fatura, P4-A) | PR-NOTIF-01 |
| ~~`split_invites` (`expiraEm` string ISO, sem TTL)~~ | Resolvido na P4-C: o modelo antigo (`functions/src/callables/splitGroups.ts`) saiu; o convite grava `expiresAt` (`Timestamp`) com TTL declarado | SPLIT-16 |

`goal_audit_logs` também cresce sem prazo e grava before/after completos, inclusive texto livre (`functions/src/goals/operations.ts:207-209,244-247`, GOAL-14). Por ser trilha de auditoria, não entra em TTL sem decisão de prazo (D-18).

## 3. Semântica de exclusão CURRENT por domínio

| Domínio / coleção | O que "excluir" faz hoje | Evidência | Rules | GAP |
| --- | --- | --- | --- | --- |
| `transactions` | Baixa lógica (`voidedAt`, `voidedBy`, `voidReason`) feita só pelo backend (`voidCashTransaction`); espelhos de outros domínios são compensados pelo próprio domínio | `functions/src/cash/mutateTransaction.ts:863` | `create, update, delete: if false` para todo papel (`firestore.rules:691-693`, P4-D) | — (PR-TX-01 resolvido na P4-D, plano §19.4) |
| `investment_*` | Nenhum delete: cancelamento só de pendente e estorno compensatório (na mesma conta do Caixa, P4-D) | `functions/src/investments/operationsV2.ts:419,1270` (`executeReverseInvestmentMovement`, `executeCancelInvestmentMovement`) | `write: false` (`firestore.rules:796-934`) | — |
| Compras, faturas, lançamentos, pagamentos e razão de limite de cartão | Nenhum delete; cancelamento lógico e estorno por callable; lançamentos e pagamentos imutáveis (P4-A) | `functions/src/cards/callables.ts` | `create, update, delete: if false` (`firestore.rules`, prefixo `credit_card_`) | — |
| `credit_cards` | Arquivamento e reativação (`status` `active\|archived`); nunca apagado (P4-A) | `functions/src/cards/callables.ts` | `create, update, delete: if false` | PR-CC-01 resolvido na P4-A (plano §19.1) |
| `goals` | Arquivamento lógico (`archived`, `archivedAt`, `archivedBy`, `archiveReason`, `status: 'cancelada'`) | `functions/src/goals/operations.ts:273-277` | `write: false` (`firestore.rules:1178`) | PR-GOAL-04; GOAL-12 |
| `settings_catalog`, `settings_catalog_uniques`, `settings_catalog_events` | Inativação (`status: 'inactive'`) e reativação pelas callables do catálogo (D-23, P4-E); documento e reserva do nome permanecem; a reserva só sai quando o próprio item é renomeado; trilha append-only | `functions/src/settingsCatalog/operations.ts` (`executeArchiveSettingsCatalogItem`, `executeUpdateSettingsCatalogItem`) | `create, update, delete: if false` no catálogo; reservas e trilha `read, write: if false` | — |
| `loans`, `loan_movements` | Nunca apagados (P3-H): cancelamento e estorno são movimentos compensatórios; a interface não tem ação de excluir; as Rules negam `delete` ao cliente em todo papel | `functions/src/loans/operations.ts`; `firestore.rules` (blocos `loans`/`loan_movements`) | Nenhum papel apaga | — (PR-LOAN-04 resolvido) |
| `clients`, `client_private`, `receivables`, `receivable_movements`, `client_events`, `receivable_events` | Nunca apagados (P3-I): cliente arquivado (`archiveClient`, recusado com recebível em aberto), recebível cancelado (`cancelReceivable`, motivo obrigatório, sem recebimento ativo) e recebimento estornado por movimento compensatório; a interface não tem ação de excluir; as Rules negam toda escrita do cliente | `functions/src/receivables/`; `firestore.rules` (blocos das seis coleções) | Nenhum papel escreve | — (PR-CR-02 resolvido; eliminação e anonimização de dados de terceiros em P8, PR-CR-05) |
| `split_*` | Nunca apagados (P4-C): grupo arquivado só sem pendências, participante inativado, título anulado com compensação, quitação e pagamento de reembolso estornados por fato compensatório, convite revogado ou expirado | `functions/src/splitBills/groupOperations.ts:277`, `participantOperations.ts:321,602`, `billOperations.ts:992`, `shareOperations.ts:350`, `reimbursementOperations.ts:554` | `create, update, delete: if false` (`firestore.rules`, blocos `split_*` a partir da linha 1064) | — (PR-SPLIT-02 resolvido na P4-C, plano §19.3) |
| `recurring_expenses`, `recurring_occurrences`, `recurring_events` | Nunca apagados (P4-B): contrato `paused`, `ended` ou `cancelled` permanece; ocorrências e trilha append-only preservadas; a interface não tem ação de excluir | `functions/src/recurring/contractOperations.ts` | `delete: if false` para todo papel (`firestore.rules:979-999`) | — (PR-RULES-01, parte recurring, resolvido na P4-B) |
| `members` e `users/{uid}/workspaces` | Hard delete do membership e tentativa de apagar o índice de outro usuário (negada) | `src/modules/workspaces/api.ts:249-252` | `firestore.rules:1046-1050,1486` | PR-WS-02 (WS-11) |
| `notifications` | "Arquivar" é hard delete, permitido só a owner/admin | `src/modules/notifications/api.ts:68-71` | `firestore.rules:1381` | PR-NOTIF-01 (NOTIF-03) |
| `workspaces` | Sem exclusão, arquivamento ou encerramento | Sem `allow delete` (`firestore.rules:990-1008`) | — | PR-AUTH-01; WS-09 |
| `users/{uid}` e conta no Auth | Sem exclusão de conta, exportação ou cancelamento da assinatura | `firestore.rules:1467`; `functions/src/index.ts:13-37` | `delete: false` | PR-AUTH-01 |
| Ferramenta `limpar-investimentos.mjs` | Hard delete do ledger, com override para o projeto de produção | `tools/investments/limpar-investimentos.mjs:59,88,143-148,352,409` | Admin SDK, fora das Rules | PR-PLAT-02 |
| `localStorage` (chat de IA, Mensagens) | Persiste sem prazo; o logout só chama `signOut` | `src/modules/reports/hooks.ts:341-358`; `src/modules/messages/api.ts:29-66`; `src/contexts/AuthContext.tsx:116-122` | — | PR-AI-04, PR-MSG-01 |

## 4. Política de retenção TARGET por categoria

"Prazo" é o tempo de guarda depois do fim da finalidade ou do vínculo. Onde o HEAD já fixa um prazo técnico, ele aparece como referência CURRENT, a confirmar em D-18. Nenhum prazo legal é afirmado sem validação jurídica (E-09).

| Categoria | Dados / coleções | Prazo | Mecanismo TARGET | Milestone |
| --- | --- | --- | --- | --- |
| Conta | Usuário no Firebase Auth, sessões | Enquanto a conta existir; após a exclusão, só o que D-07 reter | Callable de exclusão com reautenticação: revoga sessões e exclui o usuário do Auth | P8 (PR-AUTH-01) |
| Perfil | `users/{uid}` (nome, e-mail, foto, telefone, preferências) | Até a exclusão da conta: **DECISION D-18** | Eliminação ou anonimização no job de exclusão | P1 (perfil server-owned), P8 |
| Membership | `members`, `users/{uid}/workspaces`, convites, `membership_events` | Vínculo ativo; registro removido e convite expirado: **DECISION D-18** (o convite expira em 7 dias, D-05) | Remoção lógica (`status`), convite com `expiresAt` e TTL, trilha append-only | P1 (PR-WS-01, PR-WS-02), P8 |
| Dados financeiros do workspace | `transactions`, `cash_report_periods`, domínio de cartões, `investment_*` (fatos), `goals`, `loans`, `loan_movements`, `receivables`, `receivable_movements`, `recurring_*`, `split_*` | Nunca expiram enquanto o workspace existir (regra CURRENT de `retention.ts:11-15`). Após encerramento ou pedido de eliminação: **DECISION D-18** (obrigação fiscal a confirmar, E-09) e **D-07** | Arquivamento, cancelamento e estorno (§5); job de eliminação do workspace inteiro ao fim da retenção | P3–P5 (semântica), P8 (eliminação) |
| Dados de terceiros | `client_private` (documento, e-mail, telefone, endereço e observações; P3-I, D-24: leitura só owner/admin; o cadastro compartilhado `clients` tem só nome e situação), contrapartes em `loans` (`personName`, `personContact`, `cnpjCpf`), nomes de participantes em `split_*`, textos livres | Enquanto necessários à finalidade do workspace: **DECISION D-18** | Anonimização sob pedido preservando valores; eliminação junto com o workspace | P8 (PR-CR-05, LOAN-16; D-14) |
| Auditoria | `goal_audit_logs`, `credit_card_events` (P4-A), `settings_catalog_events` (P4-E: IDs, grupo, escopo, ator e campos alterados, sem o nome digitado), eventos de sucesso em `investment_event_logs`, trilha de caixa `cash_events` (P3-A: criação de lançamento, sem valor nem texto livre; P3-C: correção e anulação com antes/depois só em centavos, tipo e data, mais o motivo digitado pelo usuário, que pode conter dado pessoal), `membership_events`, `client_events` e `receivable_events` (P3-I: só IDs, centavos, status e nomes de campos, sem PII), auditoria de billing, `admin_audit_logs`; destino de `activity_logs` | **DECISION D-18** (vinculado à obrigação legal). `activity_logs` tem 365 dias no HEAD | Imutável; ator anonimizado na exclusão de conta (D-07); TTL ou job só depois de definido o prazo; diff mínimo sem texto livre (GOAL-14) | P3, P7, P8 |
| Chaves de idempotência | `*_idempotency_keys` de todos os domínios e das callables novas | 90 dias (referência CURRENT, `retention.ts:29`) | `expiresAt` em todas, TTL versionado; ID de documento determinístico para que a expiração da chave não reabra duplicidade (padrão de investimentos) | P1–P5 (callables novas), P6 (TTL) |
| Rate limits | `rate_limits` (workspace e usuário) | 2 dias (CURRENT, `retention.ts:35`); política de TTL declarada em `firestore.indexes.json` (P3-B) | Aplicar a política no ambiente (P6, E-07) | P6 |
| Marcas de entrega e checkpoints | `cash_period_events` (marcas; o documento `projection_state` não expira); `system/*` (um documento por job; `job_checkpoints` saiu com o cron antigo de recorrentes na P4-B) | 90 dias para marcas, com a política de TTL declarada em `firestore.indexes.json` (P3-B); cursores sem prazo | Remover ou implementar `completedCheckpoints` (sem uso) | P3, P6 |
| Eventos de webhook | `billing_webhook_events/{event.id}` (criado em P2A; `expiresAt` em `functions/src/billing/webhook.ts:366`) | **DECISION D-18**, acima da janela de reentrega do Stripe | `expiresAt` + TTL, gravado na mesma transação que aplica o efeito | P2A (PR-BILL-06 fechado); ativação do TTL em P6 |
| Recibos de consumo de IA | `users/{uid}/ai_usage_receipts/{id}` (P2B.2; só metadados e hash da intenção, nunca pergunta, documento nem resposta) | 90 dias (CURRENT, `retention.ts:60`), acima de qualquer retry plausível da mesma chave | `expiresAt` + TTL declarado em `firestore.indexes.json` (CURRENT); ativação do TTL no ambiente em P6 (E-07) | P2B.2 (entregue); P6 |
| Estado de billing e quota sem prazo | `billing_accounts/{uid}/ai_usage/{YYYY-MM}` (créditos de IA usados no mês), `billing_accounts/{uid}/quota_state/ownership`, `workspaces/{id}/quota_state/membership`, `workspaces/{id}/quota_state/transactions` e `transactions_{YYYY-MM}` (âncora e lançamentos usados no mês, P3-D) e `billing_accounts/{uid}/billing_sync/reconciliation` (lease do webhook) | Sem `expiresAt` e sem TTL: contadores e lease de estado vivo, backend-only. O ciclo de vida do contador mensal de IA e do estado de quota na exclusão de conta e de workspace fica para P8 (D-07, D-18) | Definição e eliminação junto com a conta ou o workspace, sem apagar histórico financeiro | P8 |
| Métricas e eventos operacionais | `investment_operational_metrics`, falhas em `investment_event_logs`, `investment_drift_reports` (`credit_card_operational_metrics` foi removida na P4-A) | 400 dias (CURRENT em investimentos, com TTL versionado desde a P4-D; ativação: E-07); unificação: **DECISION D-18** | Observabilidade unificada com `expiresAt` e TTL em todos | P7 (PR-OBS-01) |
| Notificações | `notifications` e estado de leitura por usuário | **DECISION D-18** (a auditoria sugere 90 ou 180 dias) | `expiresAt` + TTL; dispensa por usuário em vez de delete | P5 (PR-NOTIF-01) |
| Logs de aplicação | Cloud Logging das Functions | **DECISION D-18**; sem dados pessoais além de identificadores | Logger estruturado e sanitizado; retenção dos buckets de log: **EXTERNAL E-08** | P7 (PR-OBS-01) |
| Registros de acesso | Data, hora e IP de acesso à aplicação | Referência: Lei 12.965/2014 (Marco Civil da Internet), art. 15, guarda por 6 meses — **a confirmar pelo jurídico (E-09)** | Registro de acesso com sigilo e acesso restrito, eliminado ao fim do prazo. **CURRENT:** o código não grava IP nem user agent (busca por `rawRequest.ip`, `x-forwarded-for` e `userAgent` em `functions/src` e `src`: zero ocorrências); os registros da plataforma estão NÃO VERIFICADOS (E-08) | P7, P8 |
| Aceite e solicitações de titular | Registro de aceite versionado; `dsr_requests` | **DECISION D-18** (prova de cumprimento) | Coleções server-only e imutáveis | P8, P9 (PR-AUTH-02, PR-PRIV-01) |
| Backups e PITR | Cópias do banco inteiro | **DECISION D-27** (janela de PITR, frequência, retenção e export isolado) e D-18 (prazo por categoria) | §8 | P7 (PR-BKP-01, E-07) |
| Dados após cancelamento ou inatividade | Workspace e conta sem assinatura ativa ou sem uso | **DECISION D-18**, com D-08 para downgrade com excedente | Estado de assinatura único (P2); aviso prévio e job de encerramento idempotente (P8). **CURRENT:** o webhook trata 13 tipos de evento e rebaixa o plano por grace period e restrição, com dados preservados (`functions/src/billing/webhook.ts:190-300`; `functions/src/billing/entitlements.ts`) | P2A (PR-BILL-01 fechado), P8 |
| Armazenamento local | Histórico do chat de IA, Mensagens, preferências | Sessão; necessidade de banner/CMP: **DECISION D-26** | Nada financeiro persistido no navegador; limpeza no logout e na troca de workspace | P5 (PR-AI-04, PR-MSG-01) |
| Terceiros | Payloads ao Gemini (comprovantes, voz, perguntas); e-mail e customer no Stripe | Conforme termos do provedor | Minimização; tier sem treinamento: **EXTERNAL E-10** (D-11); cancelamento no Stripe na exclusão: **EXTERNAL E-06** | P8 (PR-AI-01) |

## 5. Semântica alvo: arquivar, cancelar, estornar

Nenhuma coleção de histórico financeiro aceita delete, nem pelo cliente nem por callable. Toda operação abaixo é callable transacional, idempotente e auditada, e as Rules negam delete (**TARGET**).

| Entidade | Operação alvo | Campos mínimos | Milestone · GAP |
| --- | --- | --- | --- |
| Transação de caixa | Anulação lógica com motivo; correção auditada sem bloqueio por período (D-35, tomada em P3-C) | `voidedAt`, `voidedBy`, `voidReason` (já CURRENT, `firestore.rules:255-263`); pelo backend, `voidCashTransaction`/`updateCashTransaction` com evento em `cash_events` (P3-C, plano §18.3) | P3 · PR-TX-01, PR-TX-05 |
| Workspace | `archiveWorkspace`; encerramento; eliminação em P8 com tombstone do documento pai | `status`, `archivedAt`, `archivedBy` | P1 (WS-09), P8 (PR-AUTH-01) |
| Membership | Remoção lógica, saída voluntária, transferência de ownership | `status: 'removed'`, `removedAt`, `removedBy` (o `status` já é aceito em `firestore.rules:9-16`) | P1 · PR-WS-02 |
| Cartão | Arquivar (`archived`) e reativar; nunca apagar (implementado na P4-A) | `status` | P4-A · PR-CC-01 resolvido |
| Recorrência | Pausar, retomar e cancelar (terminal; `ended` ao fim da agenda); contrato, ocorrências e trilha preservados, nada apagado nem revertido (implementado na P4-B) | `status` (`active`, `paused`, `ended`, `cancelled`) | P4-B · PR-RULES-01 (parte recurring) e PR-REC-01 resolvidos |
| Divisão de contas | Grupo arquivado, título anulado, rateio versionado, participante inativado | `archivedAt`, `voidedAt`, `status` | P4 · PR-SPLIT-02 |
| Empréstimo | `cancelLoan` (ação "Cancelar empréstimo", que substituiu "Excluir"); movimento estornado por `reverseLoanMovement` (backend P3-G; interface P3-H) | Movimento compensatório vinculado (`reversalOf`/`reversedBy`) e espelho de caixa compensatório; trilha em `loan_events` sem `expiresAt` (D-18) | P3 · PR-LOAN-04 resolvido |
| Recebível e cliente | Recebível cancelado (recebido só volta por estorno do recebimento); cliente arquivado; PII em `client_private` anonimizada sob pedido (P8) | `status: 'cancelled'` com motivo no evento; `status: 'archived'`; trilhas `receivable_events` e `client_events` sem PII e sem `expiresAt` (D-18) | P3 · PR-CR-02 resolvido na P3-I; P8 · PR-CR-05 |
| Meta | Arquivamento preservando o status anterior e tratando posições vinculadas | `archivedFromStatus` | P5 · PR-GOAL-04 |
| Notificação | Dispensa por usuário; expurgo só por TTL | `dismissedAt` no estado do usuário | P5 · PR-NOTIF-01 |

Pela política de legado do plano, cada milestone remove no mesmo escopo o caminho de delete do cliente e troca as Rules para `delete: false`, com teste que prova a negação.

## 6. Conflito entre histórico financeiro e eliminação LGPD (DECISION D-07)

**DECISION D-07 (pendente, bloqueia P2 e P8):** destino dos workspaces próprios e compartilhados na exclusão de conta, retenção fiscal × eliminação LGPD e anonimização do ator em histórico compartilhado.

A regra "sem hard delete de histórico" protege a integridade do ledger enquanto o workspace opera. Ela não autoriza guardar dados pessoais sem base legal depois do fim da finalidade: a eliminação a pedido não é bloqueada pela invariante quando não houver obrigação legal de retenção. Abordagem recomendada para a decisão, a validar com o jurídico (E-09):

1. **Workspace cujo único titular pede a eliminação:** o workspace é eliminado inteiro (documento e todas as subcoleções) por um job no servidor. Antes, é oferecida a exportação. Se houver obrigação legal de guarda, a eliminação espera o fim do prazo (item 3). O documento pai vira tombstone para que o ID não seja recriado por terceiro e herde subcoleções órfãs (RULES-06).
2. **Workspace compartilhado:** o membership do titular vira removido. Nos registros que precisam permanecer (transações, movimentos, trilhas), identificadores e nomes do ator (`userId`, `createdBy`, `actorId`, `displayName`, e-mail) são substituídos por pseudônimo irreversível. Se o titular for o último owner, a transferência de ownership é pré-requisito (D-03).
3. **Retenção bloqueada por obrigação legal:** o que a lei obrigar a guardar (ex.: registros fiscais, registros de acesso) fica marcado com base legal e prazo, com acesso restrito e uso bloqueado para outras finalidades. O job elimina ao fim do prazo.
4. **Dados de terceiros:** clientes, contrapartes e participantes são anonimizados sob pedido, preservando valores e vínculos financeiros (PR-CR-05; D-14 para participantes externos).
5. **Efeitos fora do Firestore:** cancelamento da assinatura e tratamento do customer no Stripe; exclusão do usuário no Auth; limpeza de dados em subprocessadores conforme contrato ([SUBPROCESSORS.md](SUBPROCESSORS.md)).

Requisitos do job (**TARGET**, P8): executado no servidor após autenticação recente; idempotente sob retry; paginado e limitado por execução; auditado com evento que não contém os dados eliminados; isolado por tenant; coberto por teste no Emulator para owner único, workspace compartilhado e retenção bloqueada.

## 7. TTL versionado

- **CURRENT (P1–P4-D, versionado no repositório):** `firestore.indexes.json` declara um `fieldOverride` com `ttl: true` e `indexes: []` em `expiresAt` para os 12 grupos de coleção da §2.2, no formato abaixo. Testes conferem parte da lista: `cash_period_events` e `rate_limits` (`functions/src/cash/__tests__/projection.test.ts`), `ai_usage_receipts` (`functions/src/ai/__tests__/callables.test.ts`), `split_invites` (`tests/unit/split-no-client-writes.test.ts`) e as quatro coleções operacionais de investimentos (`functions/src/investments/__tests__/documentContracts.test.ts`; INV-11, resolvido na P4-D).

```json
{
  "collectionGroup": "rate_limits",
  "fieldPath": "expiresAt",
  "ttl": true,
  "indexes": []
}
```

- **TARGET (P6, configuração externa):** publicar as políticas versionadas junto com índices e Rules em cada ambiente e conferir o estado `ACTIVE` (E-07; FIRE-08, RULES-13). Até lá, versionado não significa ativo.
- **TARGET (P5/P6, cobertura):** `goal_idempotency_keys` com `expiresAt` e TTL (GOAL-14); `notifications` com `expiresAt` e TTL (PR-NOTIF-01); `activity_logs` com TTL declarado se D-18 a mantiver como log operacional (RULES-13, READ-18).
- **TARGET (P7):** eventos de falha saem de `investment_event_logs` para a coleção operacional unificada, para que a trilha de auditoria não compartilhe grupo de coleção com dados descartáveis.
- **TARGET (P6):** um teste único compara todos os `fieldOverrides` com a tabela de retenção, e outro garante que nenhum escritor de fato financeiro grava `expiresAt` (hoje há só os testes parciais acima).
- **Regra:** nenhuma coleção de fato financeiro ou de auditoria recebe TTL. Prazos de negócio por categoria continuam dependentes de D-18 (§4); a política de TTL só executa o prazo que a decisão fixar.
- `TTL_MANIFEST.md` não é referência operacional; a lista válida é a deste documento e a de [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md).
- A exclusão por TTL é assíncrona. Nenhum fluxo pode depender de o documento sumir no instante de `expiresAt`: leituras que importam checam o prazo.

## 8. Interação com backups e PITR

- **CURRENT:** não há PITR, backup agendado, export nem delete protection (`firebase.json:2-7`; PR-BKP-01). O checklist antigo reconhece que dado apagado "não volta" (`docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:205-208`), e o TTL remove em definitivo.
- **TARGET (P7):** janela de PITR e retenção de backups definidas em D-27 (compatível com D-18) e configuradas por E-07. Dados eliminados continuam nos backups até a expiração deles, e o prazo máximo é informado na política de privacidade.
- **TARGET (P7/P8):** o restore não pode reintroduzir dados eliminados. O job de eliminação mantém um registro mínimo do que eliminou (IDs de tenant/documento e data, sem conteúdo), e o runbook de restore reaplica essas eliminações antes de liberar o banco restaurado ([BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md)).
- O TTL não atua sobre backups; a expiração nos backups é a retenção do próprio backup.

## 9. GAPs

| ID | Sev. | Milestone | Lacuna de ciclo de vida |
| --- | --- | --- | --- |
| PR-AUTH-01 | BLOCKER | P8 | Sem exclusão de conta, exportação e cancelamento na saída do titular |
| PR-AI-01 | BLOCKER | P8 | Dados e comprovantes enviados ao Gemini sem base legal nem retenção contratual comprovada |
| PR-BKP-01 | BLOCKER | P7 | Sem PITR, backups, delete protection nem restore |
| PR-CR-02 | BLOCKER | P3 | **Resolvido na P3-I:** hard delete de clientes e recebíveis removido (arquivamento e cancelamento lógicos; empréstimos e movimentos resolvidos na P3-H, PR-LOAN-04) |
| PR-SPLIT-02, PR-CC-01 | BLOCKER | P4 | **Resolvidos** (fechados no gate de P4, plano §19.7): hard delete de cartão removido na P4-A (plano §19.1) e de divisão de contas na P4-C (plano §19.3) |
| PR-RULES-01 | BLOCKER | P3/P4 | **Resolvido por partes** (P3; P4-B, P4-C e P4-D, plano §19.2–§19.4; fechado no gate de P4, plano §19.7): as coleções financeiras adjacentes negam escrita e delete ao cliente |
| PR-PLAT-02 | BLOCKER | P6 | Ferramenta versionada de hard delete do ledger com override para produção |
| PR-CR-05 | HIGH | P8 | Dados pessoais de terceiros sem ciclo de vida. Parcial na P3-I: cadastro compartilhado mínimo e PII em `client_private` só para owner/admin (D-24); exportação, eliminação, anonimização e retenção seguem em P8 (D-07, D-18) |
| PR-PRIV-01 | HIGH | P8 | Sem canal do titular nem divulgação de subprocessadores |
| PR-TX-05 | HIGH | P3 → P4 | **Resolvido na P4-D** (plano §19.4; fechado no gate de P4, plano §19.7): toda escrita de `transactions` é do backend, com trilha append-only do domínio sem TTL (`cash_events` e as trilhas de empréstimos, recebíveis, contas, cartões, recorrentes, Divisão e investimentos). `activity_logs` (365 dias) é log operacional, com destino em D-18 |
| PR-WS-02 | HIGH | P1 | Remoção de membro é hard delete, sem auditoria (WS-11) |
| PR-BILL-06 | HIGH | P2 | Sem armazenamento de eventos Stripe nem auditoria de plano (fechado em P2A: `billing_webhook_events` e `billing_events`; PLAN §17.3) |
| PR-NOTIF-01 | HIGH | P5 | Notificações sem retenção; arquivar = hard delete |
| PR-AI-04 | HIGH | P5 | Histórico de IA no `localStorage`, sem limpeza no logout |
| PR-MSG-01 | HIGH | P5 | Mensagens persistidas só no `localStorage` |
| PR-TX-04 | HIGH | P3 | Gatilho sem retry; premissa de reentrega do comentário de retenção errada (FIRE-05). Parcial em P3-B: `retry: true`, comentário corrigido e TTL das marcas declarado (PLAN §18.2) |
| PR-GOAL-04 | HIGH | P5 | Arquivar meta ignora posições vinculadas |

MEDIUM/LOW de origem: PRIV-08 (sem política de retenção de dados pessoais), RULES-13, FIRE-08, READ-18 (TTL versionado para 12 grupos; faltam a publicação por ambiente, E-07, e a cobertura de `activity_logs`, `goal_idempotency_keys` e `notifications`), INV-11 (resolvido na P4-D: TTL versionado das quatro coleções operacionais de investimentos), CC-20 (resolvido na P4-A: coleções removidas), GOAL-14 (`goal_idempotency_keys` sem `expiresAt`), SPLIT-16 (resolvido na P4-C: `split_invites` com `expiresAt` e TTL), WS-09 (sem arquivamento de workspace), ENTRY-17 (trilha atribui a alteração ao criador), AUTH-11 (logout sem limpeza, em PR-AI-04), LOAN-16 (contrapartes sem ciclo de vida, em PR-CR-05), GOAL-12.

## 10. Decisões e configuração externa

| ID | Tema | Estado |
| --- | --- | --- |
| D-07 | Histórico financeiro × eliminação LGPD; destino dos workspaces; anonimização do ator | DECISION pendente (P2, P8) |
| D-18 | Prazos por categoria (§4), inclusive backups e pós-cancelamento | DECISION pendente (P5, P8) |
| D-27 | RPO/RTO, política de backup e janela de PITR | DECISION pendente (P7) |
| D-01, D-08 | Entidade pagadora e downgrade/cancelamento, que definem o que acontece com os dados após o fim da assinatura | DECISION pendente (P2) |
| D-03, D-05 | Owner canônico único; convite válido por 7 dias | DECISION tomada (§9.1 do plano) |
| D-09, D-11, D-14, D-21 | Mensagens, IA, participantes externos, encarregado e canal | DECISION pendente |
| D-ORD-03 | Exclusão e exportação em P8 | DECISION tomada |

| ID | Item EXTERNAL CONFIGURATION REQUIRED | Ambiente | Valor esperado | Estado | Data | Responsável |
| --- | --- | --- | --- | --- | --- | --- |
| E-07 | Publicação e ativação das políticas de TTL versionadas em `firestore.indexes.json` | DEV, STAGING, PROD | Exatamente os grupos versionados (§2.2), `ACTIVE` | NÃO VERIFICADO | — | — |
| E-07 | PITR, backups agendados com retenção e delete protection | STAGING, PROD | Janela e retenção de D-27 | NÃO VERIFICADO | — | — |
| E-08 | Retenção dos buckets de log e sinks | Todos | Prazo de D-18; registros de acesso conforme parecer | NÃO VERIFICADO | — | — |
| E-09 | Parecer sobre prazos legais (fiscal, Marco Civil, pós-exclusão) e política publicada | — | Tabela §4 validada | NÃO VERIFICADO | — | — |
| E-10 | Termos do provedor de IA quanto a retenção e treinamento | — | Tier sem treinamento e retenção compatível | NÃO VERIFICADO | — | — |

## 11. Testes obrigatórios (TARGET)

- Rules no Emulator negando delete em toda coleção de histórico, para todos os papéis, e negando escrita de `expiresAt` pelo cliente.
- Integração das operações de arquivamento, cancelamento e estorno: idempotência sob retry, ausência de órfãos, reconstrução de saldos idêntica antes e depois.
- Job de eliminação e anonimização (P8): owner único, workspace compartilhado, último owner, retenção bloqueada, isolamento entre tenants, retry, e prova de que nenhum outro tenant foi tocado.
- Teste de contrato de TTL: `fieldOverrides` × tabela de retenção; nenhum fato financeiro com `expiresAt`.
- Ensaio em STAGING (P7): restore seguido da reaplicação das eliminações registradas.
