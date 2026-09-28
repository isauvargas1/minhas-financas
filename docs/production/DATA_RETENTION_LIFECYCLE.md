# Retenção e ciclo de vida de dados

Política de retenção e de ciclo de vida dos dados do Minhas Finanças: o que expira, o que nunca expira, como se exclui, arquiva, cancela ou estorna, e como a eliminação a pedido do titular convive com a proibição de apagar histórico financeiro. O documento registra o estado auditado no HEAD `9c3ab46` e remete ao [plano mestre](PRODUCTION_READINESS_PLAN.md) para IDs, milestones e decisões. O gate do tema é da skill `privacy-lgpd-data-lifecycle`. Os mecanismos de plataforma (TTL configurado, PITR, backups) também passam por `firebase-production-readiness`. Este documento não é parecer jurídico: todo prazo legal citado é referência a confirmar pelo jurídico (E-09).

## 1. Regras de leitura

- Rótulos: **CURRENT**, **TARGET**, **GAP**, **DECISION** e **EXTERNAL CONFIGURATION REQUIRED**, como definidos no [plano mestre](PRODUCTION_READINESS_PLAN.md#classificação-usada-em-docsproduction).
- Invariante do produto (AGENTS.md): não há hard delete de histórico financeiro. Invariante do código (**CURRENT**): "fato financeiro necessário para auditoria ou reconstrução nunca expira" e nenhum desses documentos recebe `expiresAt` (`functions/src/shared/retention.ts:11-15`).
- Prazos de retenção por categoria ainda não definidos são **DECISION D-18**. A resolução entre histórico financeiro e eliminação LGPD é **DECISION D-07**. Exclusão e exportação de conta e de workspace ficam em P8 (D-ORD-03).
- O inventário de coleções e escritores está em [DATA_MODEL.md](DATA_MODEL.md). O inventário de dados pessoais e as bases legais estão em [PRIVACY_LGPD.md](PRIVACY_LGPD.md). Backups e restore estão em [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md).

## 2. Mecanismos CURRENT

### 2.1 `RETENTION_DAYS`

`functions/src/shared/retention.ts:23-47` define a política das coleções operacionais. `expiresAt` é só a marca: quem apaga é a política de TTL do Firestore, que é configuração de projeto (`functions/src/shared/retention.ts:17-20`).

| Chave | Dias | Uso no HEAD |
| --- | --- | --- |
| `idempotencyKeys` | 90 | `investment_idempotency_keys` (`functions/src/investments/infrastructure.ts:326`) |
| `operationalMetrics` | 400 | `investment_operational_metrics` (`functions/src/investments/observability.ts:119`) |
| `eventLogs` | 400 | Eventos de **falha** em `investment_event_logs` (`functions/src/investments/observability.ts:231-237`) e `investment_drift_reports` (`functions/src/crons/investmentDrift.ts:263`) |
| `rateLimits` | 2 | `rate_limits` de workspace e de usuário (`functions/src/shared/rateLimit.ts:144`) |
| `completedCheckpoints` | 30 | **Sem uso**: só a definição (`functions/src/shared/retention.ts:37`) |
| `cashPeriodEvents` | 90 | `cash_period_events` (`functions/src/cash/periods.ts:360`) |

Fora da tabela, `activity_logs` recebe `expiresAt` de 365 dias por constante própria (`functions/src/triggers/transactions.ts:19,114`).

### 2.2 Ativação do TTL

- **CURRENT:** nenhuma política de TTL está versionada. `firestore.indexes.json` tem `"fieldOverrides": []` (`firestore.indexes.json:806`), e `firebase.json` não tem configuração de TTL (`firebase.json:2-7`). A única instrução de ativação é um laço manual de `gcloud firestore fields ttls update` por coleção em `docs/investments/TTL_MANIFEST.md:51-70`.
- **CURRENT:** o plano mestre classifica `TTL_MANIFEST.md` como OUTDATED (§13). Divergências conferidas no HEAD:
  - o manifesto chama `investment_audit_logs` de trilha de auditoria de investimentos (`docs/investments/TTL_MANIFEST.md:44,118`), mas nenhum código em `functions/src` grava essa coleção; ela só aparece em testes de Rules como coleção removida (`tests/firestore/investment-redemptions.rules.integration.test.mjs:221`);
  - as linhas de código citadas no manifesto estão deslocadas (ex.: `infrastructure.ts:329` × `326` no HEAD);
  - o comentário de `retention.ts` remete a ativação ao `PRODUCTION_DEPLOYMENT_CHECKLIST.md` (`functions/src/shared/retention.ts:17-20`), também OUTDATED;
  - o ensaio de STAGING fala em "seis coleções" e cita `investment_operation_leases`, já removida (FIRE-08).
- **EXTERNAL CONFIGURATION REQUIRED:** o estado das políticas de TTL em qualquer projeto é NÃO VERIFICADO (E-07). Enquanto o TTL não estiver ativo, os documentos com `expiresAt` não são apagados.

### 2.3 Semântica de `expiresAt` que exige atenção

- **CURRENT:** `investment_event_logs` mistura dois tipos de documento. Os eventos de sucesso, que são a trilha de auditoria do domínio, não têm `expiresAt` (`functions/src/investments/infrastructure.ts:330-360`). Os eventos de falha têm 400 dias (`functions/src/investments/observability.ts:231-237`). O TTL só remove documentos que têm o campo, então a política nessa coleção apaga apenas falhas. A mistura é frágil: um `expiresAt` acrescentado por engano ao evento de sucesso apagaria a trilha.
- **CURRENT:** a política de TTL vale por grupo de coleção. Uma política em `rate_limits` cobre `workspaces/{id}/rate_limits` e `users/{uid}/rate_limits`.
- **CURRENT:** o comentário de `cashPeriodEvents` supõe reentrega do gatilho por até 7 dias (`functions/src/shared/retention.ts:39-46`), mas `onTransactionWrite` não declara retry (`functions/src/triggers/transactions.ts:35-37`). O prazo de 90 dias continua seguro; a premissa do comentário está errada (FIRE-05, em PR-TX-04).

### 2.4 Coleções operacionais sem `expiresAt`

| Coleção | Evidência | Origem |
| --- | --- | --- |
| `credit_card_idempotency_keys` | `functions/src/creditCards/idempotency.ts:117-126` | CC-20, FIRE-08 |
| `credit_card_operational_metrics` | `functions/src/creditCards/observability.ts:81-96` | CC-20, FIRE-08 |
| `goal_idempotency_keys` | `functions/src/goals/operations.ts:110-117` | GOAL-14 |
| `notifications` | `functions/src/creditCards/domainNotifications.ts:275-296` | PR-NOTIF-01 |
| `split_invites` (`expiraEm` é string ISO de negócio, não retenção) | `functions/src/callables/splitGroups.ts:140-142,164` | SPLIT-16 |

`goal_audit_logs` também cresce sem prazo e grava before/after completos, inclusive texto livre (`functions/src/goals/operations.ts:207-209,244-247`, GOAL-14). Por ser trilha de auditoria, não entra em TTL sem decisão de prazo (D-18).

## 3. Semântica de exclusão CURRENT por domínio

| Domínio / coleção | O que "excluir" faz hoje | Evidência | Rules | GAP |
| --- | --- | --- | --- | --- |
| `transactions` | Baixa lógica (`voidedAt`, `voidedBy`, `voidReason`) | `src/modules/transactions/api.ts:355` | Baixa validada; `delete: false` (`firestore.rules:255-263,1094`) | Correto como semântica; autoria no cliente (PR-TX-01) |
| `investment_*` | Nenhum delete: cancelamento só de pendente e estorno compensatório | `functions/src/investments/operationsV2.ts:1637-1646,2752-2765` | `write: false` (`firestore.rules:1190-1349`) | — |
| Compras, faturas, pagamentos e ledger de cartão | Nenhum delete; cancelamento e estorno por callable | `functions/src/creditCards/callables.ts:138-189` | `write: false` (`firestore.rules:1121-1174`) | — |
| `credit_cards` | Hard delete por owner/admin, deixando compras, faturas e ledger órfãos | `src/modules/credit-cards/api.ts:97-101` | `firestore.rules:1118` | PR-CC-01 |
| `goals` | Arquivamento lógico (`archived`, `archivedAt`, `archivedBy`, `archiveReason`, `status: 'cancelada'`) | `functions/src/goals/operations.ts:273-277` | `write: false` (`firestore.rules:1178`) | PR-GOAL-04; GOAL-12 |
| `settings_catalog` | Inativação (`status: 'inactive'`) | `src/modules/settings-catalog/api.ts:354` | `delete: false` (`firestore.rules:1415,1433`) | — |
| `loans`, `loan_movements` | Hard delete do contrato e depois, em lotes, dos movimentos | `src/modules/loans/api.ts:257-284` | Livre para member (`firestore.rules:1351-1359`) | PR-LOAN-04 |
| `clients`, `receivables` | Hard delete; o cliente é apagado antes da cascata não atômica dos recebíveis | `src/modules/clients/api.ts:78-90,142-145` | Livre para member (`firestore.rules:1361-1369`) | PR-CR-02 |
| `split_*` | Hard delete em cascata; editar título apaga e recria rateios; sair apaga o participante | `src/modules/split-bills/api.ts:194-233,257-260,333-342,357-375` | Livre para member (`firestore.rules:1384-1402`) | PR-SPLIT-02 |
| `recurring_expenses` | Hard delete; ocorrências ficam órfãs | `src/modules/recurring-expenses/api.ts:235-239` | Livre para member (`firestore.rules:1097-1105`) | PR-RULES-01 |
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
| Membership | `members`, `users/{uid}/workspaces`, convites, `membership_events` | Vínculo ativo; registro removido e convite expirado: **DECISION D-18** (expiração do convite em D-05) | Remoção lógica (`status`), convite com `expiresAt` e TTL, trilha append-only | P1 (PR-WS-01, PR-WS-02), P8 |
| Dados financeiros do workspace | `transactions`, `cash_report_periods`, domínio de cartões, `investment_*` (fatos), `goals`, `loans`, `loan_movements`, `receivables`, `recurring_*`, `split_*` | Nunca expiram enquanto o workspace existir (regra CURRENT de `retention.ts:11-15`). Após encerramento ou pedido de eliminação: **DECISION D-18** (obrigação fiscal a confirmar, E-09) e **D-07** | Arquivamento, cancelamento e estorno (§5); job de eliminação do workspace inteiro ao fim da retenção | P3–P5 (semântica), P8 (eliminação) |
| Dados de terceiros | `clients` (CPF/CNPJ, e-mail, telefone, observações), contrapartes em `loans` (`personName`, `personContact`, `cnpjCpf`), nomes de participantes em `split_*`, textos livres | Enquanto necessários à finalidade do workspace: **DECISION D-18** | Anonimização sob pedido preservando valores; eliminação junto com o workspace | P8 (PR-CR-05, LOAN-16; D-14) |
| Auditoria | `goal_audit_logs`, `credit_card_audit_logs`, eventos de sucesso em `investment_event_logs`, trilha de caixa (P3), `membership_events`, auditoria de billing, `admin_audit_logs`; destino de `activity_logs` | **DECISION D-18** (vinculado à obrigação legal). `activity_logs` tem 365 dias no HEAD | Imutável; ator anonimizado na exclusão de conta (D-07); TTL ou job só depois de definido o prazo; diff mínimo sem texto livre (GOAL-14) | P3, P7, P8 |
| Chaves de idempotência | `*_idempotency_keys` de todos os domínios e das callables novas | 90 dias (referência CURRENT, `retention.ts:29`) | `expiresAt` em todas, TTL versionado; ID de documento determinístico para que a expiração da chave não reabra duplicidade (padrão de investimentos) | P1–P5 (callables novas), P6 (TTL) |
| Rate limits | `rate_limits` (workspace e usuário) | 2 dias (CURRENT, `retention.ts:35`) | TTL versionado | P6 |
| Marcas de entrega e checkpoints | `cash_period_events`; `job_checkpoints`, `system/*` (um documento por job) | 90 dias para marcas (CURRENT); cursores sem prazo | TTL versionado; remover ou implementar `completedCheckpoints` (sem uso) | P3, P6 |
| Eventos de webhook | `stripe_events/{event.id}` (a criar) | **DECISION D-18**, acima da janela de reentrega do Stripe | `expiresAt` + TTL, gravado na mesma transação que aplica o efeito | P2 (PR-BILL-06) |
| Métricas e eventos operacionais | `investment_operational_metrics`, falhas em `investment_event_logs`, `investment_drift_reports`, `credit_card_operational_metrics` | 400 dias (CURRENT em investimentos); unificação: **DECISION D-18** | Observabilidade unificada com `expiresAt` e TTL em todos | P7 (PR-OBS-01) |
| Notificações | `notifications` e estado de leitura por usuário | **DECISION D-18** (a auditoria sugere 90 ou 180 dias) | `expiresAt` + TTL; dispensa por usuário em vez de delete | P5 (PR-NOTIF-01) |
| Logs de aplicação | Cloud Logging das Functions | **DECISION D-18**; sem dados pessoais além de identificadores | Logger estruturado e sanitizado; retenção dos buckets de log: **EXTERNAL E-08** | P7 (PR-OBS-01) |
| Registros de acesso | Data, hora e IP de acesso à aplicação | Referência: Lei 12.965/2014 (Marco Civil da Internet), art. 15, guarda por 6 meses — **a confirmar pelo jurídico (E-09)** | Registro de acesso com sigilo e acesso restrito, eliminado ao fim do prazo. **CURRENT:** o código não grava IP nem user agent (busca por `rawRequest.ip`, `x-forwarded-for` e `userAgent` em `functions/src` e `src`: zero ocorrências); os registros da plataforma estão NÃO VERIFICADOS (E-08) | P7, P8 |
| Aceite e solicitações de titular | Registro de aceite versionado; `dsr_requests` | **DECISION D-18** (prova de cumprimento) | Coleções server-only e imutáveis | P8, P9 (PR-AUTH-02, PR-PRIV-01) |
| Backups e PITR | Cópias do banco inteiro | **DECISION D-27** (janela de PITR, frequência, retenção e export isolado) e D-18 (prazo por categoria) | §8 | P7 (PR-BKP-01, E-07) |
| Dados após cancelamento ou inatividade | Workspace e conta sem assinatura ativa ou sem uso | **DECISION D-18**, com D-08 para downgrade com excedente | Estado de assinatura único (P2); aviso prévio e job de encerramento idempotente (P8). **CURRENT:** o webhook só trata `checkout.session.completed` (`functions/src/webhooks/stripe.ts:60`), então cancelamento não produz efeito nenhum | P2 (PR-BILL-01), P8 |
| Armazenamento local | Histórico do chat de IA, Mensagens, preferências | Sessão; necessidade de banner/CMP: **DECISION D-26** | Nada financeiro persistido no navegador; limpeza no logout e na troca de workspace | P5 (PR-AI-04, PR-MSG-01) |
| Terceiros | Payloads ao Gemini (comprovantes, voz, perguntas); e-mail e customer no Stripe | Conforme termos do provedor | Minimização; tier sem treinamento: **EXTERNAL E-10** (D-11); cancelamento no Stripe na exclusão: **EXTERNAL E-06** | P8 (PR-AI-01) |

## 5. Semântica alvo: arquivar, cancelar, estornar

Nenhuma coleção de histórico financeiro aceita delete, nem pelo cliente nem por callable. Toda operação abaixo é callable transacional, idempotente e auditada, e as Rules negam delete (**TARGET**).

| Entidade | Operação alvo | Campos mínimos | Milestone · GAP |
| --- | --- | --- | --- |
| Transação de caixa | Anulação; correção de período fechado por estorno + novo lançamento | `voidedAt`, `voidedBy`, `voidReason` (já CURRENT, `firestore.rules:255-263`) | P3 · PR-TX-01, PR-TX-05 |
| Workspace | `archiveWorkspace`; encerramento; eliminação em P8 com tombstone do documento pai | `status`, `archivedAt`, `archivedBy` | P1 (WS-09), P8 (PR-AUTH-01) |
| Membership | Remoção lógica, saída voluntária, transferência de ownership | `status: 'removed'`, `removedAt`, `removedBy` (o `status` já é aceito em `firestore.rules:9-16`) | P1 · PR-WS-02 |
| Cartão | Arquivar ou `cancelled`; nunca apagar | `status` (enum já existe em `firestore.rules:879-881`) | P4 · PR-CC-01 |
| Recorrência | Pausar, cancelar, arquivar; ocorrências preservadas | `status`, `archivedAt` | P4 · PR-RULES-01, PR-REC-01 |
| Divisão de contas | Grupo arquivado, título anulado, rateio versionado, participante inativado | `archivedAt`, `voidedAt`, `status` | P4 · PR-SPLIT-02 |
| Empréstimo | `cancelLoan`; movimento estornado por `reverseLoanMovement` | Movimento compensatório vinculado | P3 · PR-LOAN-04 |
| Recebível e cliente | Recebível cancelado (recebido só volta por estorno); cliente arquivado, com PII anonimizada sob pedido | `status: 'cancelled'`, `cancelledAt`, `cancelledBy`, motivo; `archivedAt` | P3 · PR-CR-02; P8 · PR-CR-05 |
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

## 7. TTL versionado (TARGET)

- `firestore.indexes.json` passa a declarar um `fieldOverride` por grupo de coleção com `expiresAt`, publicado junto com índices e Rules (P6; RULES-13, FIRE-08, INV-11, READ-18). Formato previsto, a validar contra a CLI no P6:

```json
{
  "collectionGroup": "rate_limits",
  "fieldPath": "expiresAt",
  "ttl": true,
  "indexes": []
}
```

- Grupos de coleção com TTL: `rate_limits`, `cash_period_events`, todas as `*_idempotency_keys`, as métricas e eventos operacionais (inclusive `credit_card_operational_metrics` após receber `expiresAt`), `investment_drift_reports`, `notifications` (P5), convites (`split_invites` e os convites de workspace do P1), `stripe_events` (P2) e `activity_logs` se D-18 a mantiver como log operacional.
- Nenhuma coleção de fato financeiro ou de auditoria recebe TTL. Eventos de falha saem de `investment_event_logs` para a coleção operacional unificada (P7), para que a trilha de auditoria não compartilhe grupo de coleção com dados descartáveis.
- A tabela de retenção vira código: um teste compara os `fieldOverrides` com a lista de coleções com prazo, e outro garante que nenhum escritor de fato financeiro grava `expiresAt`. `TTL_MANIFEST.md` deixa de ser referência operacional; a lista válida é a deste documento e a de [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md).
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
| PR-LOAN-04, PR-CR-02 | BLOCKER | P3 | Hard delete de empréstimos, movimentos, clientes e recebíveis |
| PR-SPLIT-02, PR-CC-01 | BLOCKER | P4 | Hard delete de divisão de contas e de cartão |
| PR-RULES-01 | BLOCKER | P3/P4 | Dez coleções adjacentes com delete livre para member |
| PR-PLAT-02 | BLOCKER | P6 | Ferramenta versionada de hard delete do ledger com override para produção |
| PR-CR-05 | HIGH | P8 | Dados pessoais de terceiros sem minimização nem ciclo de vida |
| PR-PRIV-01 | HIGH | P8 | Sem canal do titular nem divulgação de subprocessadores |
| PR-TX-05 | HIGH | P3 | Sem trilha imutável de edição e anulação; `activity_logs` expira em 365 dias |
| PR-WS-02 | HIGH | P1 | Remoção de membro é hard delete, sem auditoria (WS-11) |
| PR-BILL-06 | HIGH | P2 | Sem armazenamento de eventos Stripe nem auditoria de plano |
| PR-NOTIF-01 | HIGH | P5 | Notificações sem retenção; arquivar = hard delete |
| PR-AI-04 | HIGH | P5 | Histórico de IA no `localStorage`, sem limpeza no logout |
| PR-MSG-01 | HIGH | P5 | Mensagens persistidas só no `localStorage` |
| PR-TX-04 | HIGH | P3 | Gatilho sem retry; premissa de reentrega do comentário de retenção errada (FIRE-05) |
| PR-GOAL-04 | HIGH | P5 | Arquivar meta ignora posições vinculadas |

MEDIUM/LOW de origem: PRIV-08 (sem política de retenção de dados pessoais), RULES-13, FIRE-08, INV-11, READ-18 (TTL não versionado e incompleto), CC-20 e GOAL-14 (coleções sem `expiresAt`), SPLIT-16 (convites sem TTL), WS-09 (sem arquivamento de workspace), ENTRY-17 (trilha atribui a alteração ao criador), AUTH-11 (logout sem limpeza, em PR-AI-04), LOAN-16 (contrapartes sem ciclo de vida, em PR-CR-05), GOAL-12.

## 10. Decisões e configuração externa

| ID | Tema | Estado |
| --- | --- | --- |
| D-07 | Histórico financeiro × eliminação LGPD; destino dos workspaces; anonimização do ator | DECISION pendente (P2, P8) |
| D-18 | Prazos por categoria (§4), inclusive backups e pós-cancelamento | DECISION pendente (P5, P8) |
| D-27 | RPO/RTO, política de backup e janela de PITR | DECISION pendente (P7) |
| D-01, D-08 | Entidade pagadora e downgrade/cancelamento, que definem o que acontece com os dados após o fim da assinatura | DECISION pendente (P2) |
| D-03, D-05, D-09, D-11, D-14, D-21 | Último owner, expiração de convite, Mensagens, IA, participantes externos, encarregado e canal | DECISION pendente |
| D-ORD-03 | Exclusão e exportação em P8 | DECISION tomada |

| ID | Item EXTERNAL CONFIGURATION REQUIRED | Ambiente | Valor esperado | Estado | Data | Responsável |
| --- | --- | --- | --- | --- | --- | --- |
| E-07 | Políticas de TTL por grupo de coleção (até estarem versionadas) | DEV, STAGING, PROD | Exatamente os grupos da §7, `ACTIVE` | NÃO VERIFICADO | — | — |
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
