# Backup, restore e recuperação de desastres

Este documento registra o estado e o alvo de backup, restore e recuperação de desastres (DR) do Minhas Finanças: controles do Firestore, RPO/RTO, runbook de restore, cenários de DR, interação com a LGPD e evidências exigidas. Baseline auditada: `main` @ HEAD `9c3ab46`. As lacunas usam os IDs do [plano mestre](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers). O gate do mecanismo (PITR, backups, restore testado) é a skill `firebase-production-readiness`. O gate de RPO/RTO, runbooks e exercícios de DR é `observability-incident-readiness`. Os prazos de retenção em backups passam também por `privacy-lgpd-data-lifecycle`.

> **Regra de operação.** Nenhum agente acessa o projeto `sistema-financeiro-pesso-20698` (CLAUDE.md). Todo comando deste documento é **TARGET**, executado por pessoa autorizada, primeiro em STAGING. `<PROJECT_ID>` é o ID do projeto GCP do ambiente (STAGING no ensaio), nunca um alias do `.firebaserc`. Nenhum restore foi feito até hoje.

Rótulos: **CURRENT**, **TARGET**, **GAP**, **DECISION**, **EXTERNAL CONFIGURATION REQUIRED** (conforme o [plano mestre](PRODUCTION_READINESS_PLAN.md#classificação-usada-em-docsproduction)).

---

## 1. Escopo

| Ativo | Onde vive (CURRENT) | Como se recupera | Classificação |
| --- | --- | --- | --- |
| Dados do produto | Firestore `(default)`, único banco, regional em `southamerica-east1` (`firebase.json:2-4`) | PITR, backups agendados e export (§4) | CURRENT (sem proteção) / TARGET |
| Usuários (identidade) | Firebase Authentication, login Google (`src/contexts/AuthContext.tsx:83-91`) | Não é coberto por backup do Firestore; ver cenário 6 (§7) | CURRENT / DECISION |
| Código de Functions, Rules, índices e Hosting | Git (`functions/src`, `firestore.rules`, `firestore.indexes.json`, `firebase.json`) | Redeploy de uma tag anterior pelo CD (P6) | CURRENT sem tags nem rollback (PR-REL-01) |
| Segredos | Secret Manager, declarados por função (ver [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md)) | Versões do Secret Manager e rotação ([RUNBOOKS.md](RUNBOOKS.md)) | CURRENT |
| Estado de assinatura | Stripe é a origem; o webhook grava `planId` em `users/{uid}` (`functions/src/webhooks/stripe.ts:97-107`) | Ressincronização com o Stripe (P2) | TARGET |
| Cloud Storage | Não usado (`src/lib/firebase.ts:4,39` inicializa sem uso) | N/A | CURRENT |

---

## 2. Estado atual

| Fato | Evidência | Classificação |
| --- | --- | --- |
| Nenhuma configuração ou documentação de PITR, backup agendado, export, delete protection, RPO/RTO ou restore. `firebase.json` declara só banco, local, Rules e índices | `firebase.json:2-7`; a busca por `backup`/`pitr` no repositório só encontra `docs/production/`, as skills e as instruções de agente | CURRENT |
| A ordem canônica do checklist antigo não tem passo de backup | `docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:20-25` | CURRENT |
| O checklist antigo reconhece que o dado removido por TTL "não volta" | `docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:205-206` | CURRENT |
| A TTL remove definitivamente os documentos marcados com `expiresAt`, e a ativação é manual, por coleção | `functions/src/shared/retention.ts:17-20`; lista em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md#6-ttl) | CURRENT |
| Coleções financeiras aceitam hard delete pelo cliente: `recurring_*`, `credit_cards`, `loans`, `loan_movements`, `clients`, `receivables`, `split_*` | `firestore.rules:1097-1105,1118,1351-1369,1384-1402` | CURRENT |
| Ferramenta versionada apaga o ledger de investimentos e aceita override para o ID de produção | `tools/investments/limpar-investimentos.mjs:59,88,144-149,352,409` | CURRENT |
| Não existe projeto de STAGING para ensaiar restore | `.firebaserc:1-5` | CURRENT |
| A única detecção automática de divergência compara projeções patrimoniais entre si, cobre 50 workspaces por execução, grava relatório em `investment_drift_reports` (TTL de 400 dias) e emite `console.error`, sem alerta | `functions/src/crons/investmentDrift.ts:58,104-146,239-276,325-376` | CURRENT |
| Não há modo somente leitura nem kill switch para congelar escritas durante um restore (PR-OBS-02) | busca por kill switch, modo somente leitura ou manutenção em `functions/src` e `src`: nenhuma ocorrência; ver [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) | CURRENT |

**GAP:** PR-BKP-01 (BLOCKER, P7; origem FIRE-02 · C24).

---

## 3. Classificação dos dados para recuperação

A capacidade de recuperação depende de existir uma fonte de verdade da qual a grandeza possa ser reconstruída. Onde não existe, só PITR ou backup recuperam o dado.

| Grupo | Coleções | Quem escreve (CURRENT) | Reconstruível a partir de | Ferramenta CURRENT | Se perdido ou corrompido |
| --- | --- | --- | --- | --- | --- |
| Ledger patrimonial | `investment_movements`, `investment_valuations`, `investment_accounts`, `investment_assets` | Backend (23 callables; [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md#3-inventário-de-functions)) | — (é a fonte) | — | Só PITR/backup |
| Projeções patrimoniais | posições, resumos, séries mensais, alocação, progresso de metas | Backend, no mesmo commit do ledger | Ledger | `rebuildInvestmentProjections`, `recalculateInvestmentPosition`, `recalculateGoalInvestmentProgress`, `backfillInvestmentWorkspace` (`functions/src/investments/callables.ts:188-200,244-256`). A UI que as chama não está montada (`src/components/SettingsView.tsx:741-752`) | Rebuild |
| Caixa | `transactions` | Cliente, mais espelhos gravados pelo backend (PR-TX-01, PR-TX-02) | — (é a fonte) | — | Só PITR/backup |
| Projeção de caixa | `cash_report_periods` | Gatilho `onTransactionWrite` (`functions/src/triggers/transactions.ts:35-37`) | `transactions` | `rebuildCashPeriods`, com simulação (`dryRun`) e saída de reconciliação (`functions/src/cash/rebuild.ts:55,117-245`), sem UI montada | Rebuild |
| Cartões (movimento) | `credit_card_purchases`, `credit_card_installments`, `credit_card_invoices`, `credit_card_invoice_payments`, `card_limit_ledger` | Backend (9 callables) | Parcial: faturas e limite a partir de compras e pagamentos | `rebuildCardInvoicesForCard`, `recalculateCardLimit` (`functions/src/creditCards/callables.ts:163-187`), acionáveis pela UI (`src/components/CreditCardsView.tsx:673-674`) | Compras e pagamentos só por PITR/backup; faturas e limite por rebuild |
| Cartões (cadastro) | `credit_cards` | Cliente, com hard delete (`firestore.rules:1118`; PR-CC-01) | — | — | Só PITR/backup |
| Metas | `goals`, `goal_audit_logs` | Callables (`functions/src/goals/callables.ts:83-105`) | Só o progresso patrimonial | `recalculateGoalInvestmentProgress` | Documento da meta só por PITR/backup |
| Domínios ainda no cliente | `loans`, `loan_movements`, `clients`, `receivables`, `split_groups`, `split_participants`, `split_bills`, `split_shares`, `recurring_expenses`, `recurring_occurrences` | Cliente, sem schema e com delete (PR-RULES-01) | — | Nenhuma | **Só PITR/backup; maior exposição** |
| Workspaces e membership | `workspaces`, `members`, `users/{uid}/workspaces` | Cliente (PR-WS-02) | O espelho do usuário deriva de `members` (TARGET, P1) | — | PITR/backup |
| Perfil e plano | `users/{uid}` | Webhook Stripe (`functions/src/webhooks/stripe.ts:97-107`) | Stripe (TARGET, P2) | — | PITR/backup ou ressincronização com o Stripe (P2) |
| Trilhas e eventos | `financial_events`, `credit_card_audit_logs`, `goal_audit_logs`, `investment_event_logs` (exceto eventos de falha) | Backend | — (auditoria não se reconstrói) | — | Só PITR/backup |
| Operacionais com TTL | `rate_limits`, `investment_idempotency_keys`, `investment_operational_metrics`, `cash_period_events`, `investment_drift_reports`, `activity_logs` (365 dias) e eventos de falha em `investment_event_logs` (400 dias) | Backend | Não precisam de recuperação | — | Descartáveis após o prazo |
| Operacionais sem TTL | `credit_card_idempotency_keys`, `goal_idempotency_keys`, `credit_card_operational_metrics` (sem `expiresAt`) | Backend | Não precisam de recuperação | — | Descartáveis, mas crescem sem expurgo |

**TARGET:** ao fim de P3–P5 todo domínio financeiro tem ledger ou eventos append-only no backend, e toda projeção tem rebuild idempotente e reconciliação somente leitura (ver [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md) e [OBSERVABILITY.md](OBSERVABILITY.md)). Assim o restore passa a ser necessário só para perda da própria fonte de verdade.

---

## 4. Controles alvo

| Controle | TARGET | Ambiente | Classificação |
| --- | --- | --- | --- |
| PITR | Habilitado no `(default)`, com janela de 7 dias e granularidade de minuto | PROD e STAGING | TARGET · EXTERNAL CONFIGURATION REQUIRED (E-07) · DECISION D-27 |
| Backup diário | Agendamento diário com retenção conforme D-18 e D-27 (proposta: 7 dias) | PROD | TARGET · E-07 · DECISION D-18, D-27 |
| Backup semanal | Agendamento semanal com retenção conforme D-18 e D-27 (proposta: 14 semanas) | PROD | TARGET · E-07 · DECISION D-18, D-27 |
| Delete protection | Ativa no banco `(default)` | PROD | TARGET · E-07 |
| Export isolado | Export periódico para bucket regional em **projeto separado**, com retenção bloqueada e IAM próprio, para proteger contra comprometimento do projeto de PROD | PROD | DECISION D-27 (decidir em P7) |
| Export do Authentication | Export periódico dos usuários, que contém dados pessoais, ou aceite do risco documentado | PROD | DECISION D-27 (P7, com `privacy-lgpd-data-lifecycle`) |
| TTL versionada | `fieldOverrides` com `ttl: true` só nas coleções operacionais; nunca em ledger ou auditoria | Todos | TARGET (P6; FIRE-08) |
| Alerta de falha de backup | Política de alerta com destinatário e runbook | PROD | TARGET · E-08 ([OBSERVABILITY.md](OBSERVABILITY.md)) |
| Parametrização do banco | O ID do banco fica configurável no frontend, nas Functions e no `firebase.json`, hoje fixos em `(default)` (`firebase.json:3`; `src/lib/firebase.ts:38`) | Todos | TARGET (P7), necessário para restauração total (§6, passo 6b) |
| Reconciliação somente leitura por banco | Job ou script que compara fontes e projeções em qualquer banco (inclusive o restaurado), sem escrever | STAGING, PROD | TARGET (P7) |

---

## 5. RPO e RTO

**DECISION D-27** (proposta a aprovar em P7). Os valores dependem de E-07 estar ativo e são confirmados pelo ensaio em STAGING.

| Cenário | RPO proposto | RTO proposto | Base |
| --- | --- | --- | --- |
| Corrupção lógica ou exclusão detectada dentro de 7 dias | ≤ 5 min antes do evento | ≤ 4 h para restauração parcial validada | PITR |
| Evento detectado depois da janela de PITR | ≤ 24 h (backup diário) ou ≤ 7 dias (backup semanal) | ≤ 8 h | Backups agendados |
| Deploy defeituoso sem escrita incorreta | 0 | ≤ 1 h (republicar a tag anterior) | CD com rollback (P6) |
| Comprometimento de credenciais | Igual à corrupção lógica | Contenção ≤ 1 h; restore conforme escopo | Rotação, revogação e PITR |
| Indisponibilidade regional | Depende do export isolado (D-27) | Recuperação do provedor, ou ≤ 24 h se o restore em outra região for viável | Export isolado |

---

## 6. Runbook de restore

**TARGET** (P7). Deve ser exercitado em STAGING antes de ser considerado válido e repetido no ensaio completo de P10. Dono: responsável de plataforma, a designar em [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

**Pré-condições:** E-07 ativo e registrado (§8); incidente declarado conforme [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md); acesso de restore concedido temporariamente a pessoa nomeada, com registro (acesso de emergência, D-32); este runbook ensaiado em STAGING há no máximo um ciclo de release.

1. **Conter.** Congelar as escritas: ativar o modo somente leitura (TARGET; hoje inexistente) e pausar os jobs do Cloud Scheduler das três rotinas, com nomes conferidos por `gcloud scheduler jobs list --location=southamerica-east1 --project=<PROJECT_ID>` e pausa por `gcloud scheduler jobs pause <JOB> --location=southamerica-east1 --project=<PROJECT_ID>`. O Stripe reentrega os eventos recusados durante a janela. Registrar o instante da detecção.
2. **Delimitar.** Definir o instante T0 (último estado bom) e o escopo (workspaces e coleções), usando `financial_events`, trilhas de auditoria, `activity_logs`, `investment_drift_reports` e, a partir de P7, o Cloud Logging estruturado.
3. **Preservar evidência.** Exportar o estado atual antes de qualquer mudança: `gcloud firestore export gs://<BUCKET_FORENSE>/<INCIDENTE> --database="(default)" --project=<PROJECT_ID>`.
4. **Restaurar para um banco novo.** Nunca sobrescrever o `(default)` diretamente.
   - Dentro da janela de PITR: `gcloud firestore export gs://<BUCKET>/<ID> --snapshot-time=<T0> --database="(default)" --project=<PROJECT_ID>`, depois `gcloud firestore databases create --database=restore-<AAAAMMDD> --location=southamerica-east1 --project=<PROJECT_ID>` e `gcloud firestore import gs://<BUCKET>/<ID> --database=restore-<AAAAMMDD> --project=<PROJECT_ID>`.
   - A partir de backup: `gcloud firestore backups list --location=southamerica-east1 --project=<PROJECT_ID>` e `gcloud firestore databases restore --source-backup=projects/<PROJECT_ID>/locations/southamerica-east1/backups/<ID> --destination-database=restore-<AAAAMMDD> --project=<PROJECT_ID>`.
5. **Validar o banco restaurado** (somente leitura):
   - contagens por coleção nos workspaces do escopo;
   - reconciliação financeira: ledger patrimonial × posições e resumos (mesma regra de `compareInvestmentProjections`, `functions/src/crons/investmentDrift.ts:104`); `transactions` × `cash_report_periods` (mesma soma da simulação de `rebuildCashPeriods`, `functions/src/cash/rebuild.ts:55,194`); compras e pagamentos × faturas × `card_limit_ledger`; metas × posições vinculadas;
   - **GAP:** hoje essas conferências existem só como callables sobre o `(default)` e não validam outro banco. A reconciliação por banco é TARGET (§4).
6. **Cortar** (DECISION por incidente, registrada no incidente):
   - (a) **Restauração parcial** (padrão): reescrever no `(default)` só os documentos afetados, a partir do banco restaurado, por script auditado com Admin SDK. Antes, exportar esses mesmos documentos do `(default)` para permitir o rollback. Depois, rodar os rebuilds das projeções afetadas (§3) e registrar a operação em trilha append-only.
   - (b) **Restauração total:** apontar a aplicação para o banco restaurado. Exige o ID do banco parametrizado (§4), Rules e índices publicados no banco novo e deploy pelo CD.
7. **Reaplicar o que aconteceu depois de T0:**
   - eliminações LGPD executadas após T0, a partir do registro de solicitações de titular mantido fora do banco restaurado (P8; §9);
   - estado de assinatura, ressincronizado com o Stripe pelos eventos registrados e pela API (P2);
   - operações financeiras legítimas após T0, identificadas por eventos e trilhas e reprocessadas pelas callables idempotentes, ou comunicadas aos titulares conforme [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
8. **Reabrir.** Retomar os jobs (`gcloud scheduler jobs resume ...`), desligar o modo somente leitura e acompanhar reconciliação e alertas por 24 h.
9. **Rollback do restore.** Se o corte falhar, reimportar os documentos exportados no passo 6a (ou voltar a apontar para o `(default)`, no caso 6b). O `(default)` original permanece preservado pelo export do passo 3.
10. **Registrar** em §8 e §10 (data, origem, duração, RPO/RTO medidos, resultado da reconciliação, falhas) e no postmortem.

**Critério de sucesso:** reconciliação sem divergência nos workspaces do escopo, eliminações reaplicadas, estado de assinatura igual ao do Stripe e RTO/RPO medidos dentro do aprovado.

---

## 7. Cenários de DR

| # | Cenário | Vetores no HEAD | Detecção: CURRENT → TARGET | Estratégia | Pré-requisitos |
| --- | --- | --- | --- | --- | --- |
| 1 | Corrupção lógica | Rebuild de caixa que publica valores absolutos sem cerca de versão (PR-TX-04); cron de faturas que sobrescreve com leitura desatualizada (PR-CC-04); escrita livre de member em coleções adjacentes (PR-RULES-01); espelhos de caixa editáveis (PR-TX-02) | Só a deriva entre projeções patrimoniais (`functions/src/crons/investmentDrift.ts:104-146`; INV-05) → reconciliação por domínio com alerta (P7) | Fonte íntegra: rebuild da projeção. Fonte corrompida: restauração parcial a partir de PITR (§6) | E-07; reconciliação por banco; PR-OBS-01 |
| 2 | Exclusão acidental ou maliciosa | Hard delete pelo cliente (PR-CC-01, PR-LOAN-04, PR-CR-02, PR-SPLIT-02); ferramenta de limpeza do ledger (PR-PLAT-02); TTL ativada em coleção errada (FIRE-08); exclusão do banco | Nenhuma trilha de exclusão nos domínios do cliente → Rules negando delete (P3/P4) e alerta de exclusão em massa (P7) | Restauração parcial dos documentos apagados. Exclusão do banco impedida pela delete protection. Se o banco for apagado, restore do backup ou do export isolado. Confirmar no ensaio se os backups sobrevivem à exclusão do banco | E-07; export isolado (D-27); P3/P4 |
| 3 | Indisponibilidade regional | Firestore e Functions só em `southamerica-east1` (`firebase.json:4`; `functions/src/shared/runtimeOptions.ts:38`; `src/lib/firebase.ts:43`) | Sem uptime check → uptime check e alerta (E-08) | DECISION D-27: aceitar a dependência regional (RTO do provedor) ou manter export isolado em outro local e restaurar em outra região. A viabilidade tem de ser confirmada na documentação oficial e no ensaio antes de adotar. Comunicação aos clientes conforme [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) | Export isolado; parametrização de banco e de região |
| 4 | Comprometimento de conta ou credenciais | Deploy com credencial pessoal no único projeto (PR-REL-01, PR-PLAT-01); chave Gemini exposta no passado (PR-AI-02); fallback de segredo Stripe (PR-BILL-05); um Owner comprometido pode apagar banco e backups do mesmo projeto | Nenhum alerta de IAM → Cloud Audit Logs com alerta (E-04, E-08) | Revogar sessões e chaves e rotacionar segredos ([RUNBOOKS.md](RUNBOOKS.md)); avaliar a integridade por reconciliação; restaurar do export isolado se backups ou banco forem afetados | E-00, E-04, E-05; export isolado |
| 5 | Deploy defeituoso de Rules, Functions ou índices | Deploy manual sem tag nem rollback (PR-REL-01); `deploy:functions` sem integração (`package.json:23`); `firebase deploy` direto sem gate | Reclamação de usuário → smoke pós-deploy e alertas (P6/P7) | Republicar a tag anterior pelo CD ([RUNBOOKS.md](RUNBOOKS.md)). Rules: republicar o arquivo da tag anterior. Índices: nunca remover sem conferir consumidores; aguardar o estado READY. Se houve escrita incorreta, seguir o cenário 1 | P6 (CD, tags, STAGING) |
| 6 | Perda de usuários do Authentication | Exclusão ou comprometimento da identidade; os dados ficam órfãos porque o `uid` muda | Nenhuma → alerta de exclusão em massa (P7) | DECISION D-27: export periódico dos usuários (dados pessoais) ou aceite do risco; o vínculo de dados por `uid` é reatribuído por callable administrativa auditada (PR-ADMIN-01) | D-10, D-27; P7/P8 |

---

## 8. Evidência exigida (E-07)

Registro canônico de E-07 (espelhado em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md#16-registro-de-configuração-externa)). Todos os itens estão em **EXTERNAL CONFIGURATION REQUIRED**, com estado `NÃO VERIFICADO`. A verificação é somente leitura, feita por pessoa autorizada.

| ID | Ambiente | Item | Valor esperado | Estado | Verificação | Data | Responsável |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E-07 | PROD, STAGING | PITR | `pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_ENABLED` | NÃO VERIFICADO | `gcloud firestore databases describe --database="(default)" --project=<PROJECT_ID>` | — | a designar |
| E-07 | PROD | Delete protection | `deleteProtectionState: DELETE_PROTECTION_ENABLED` | NÃO VERIFICADO | idem | — | a designar |
| E-07 | PROD | Backups agendados | diário e semanal, com retenção conforme D-18 e D-27 | NÃO VERIFICADO | `gcloud firestore backups schedules list --database="(default)" --project=<PROD>` | — | a designar |
| E-07 | PROD | Backup recente | último backup com menos de 24 h | NÃO VERIFICADO | `gcloud firestore backups list --location=southamerica-east1 --project=<PROD>` | — | a designar |
| E-07 | PROD, STAGING | Políticas de TTL | exatamente as coleções operacionais ([FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md#6-ttl)); nenhuma em ledger ou auditoria | NÃO VERIFICADO | `gcloud firestore fields ttls list --project=<PROJECT_ID>` | — | a designar |
| E-07 | PROD | Export isolado (se decidido) | bucket em projeto separado, retenção bloqueada, IAM próprio, export recente | NÃO VERIFICADO | `gcloud storage buckets describe gs://<BUCKET>` (política de retenção) | — | a designar |
| E-07 | PROD | Alerta de falha de backup | política ativa com destinatário (E-08) | NÃO VERIFICADO | registro em [OBSERVABILITY.md](OBSERVABILITY.md) | — | a designar |
| E-07 | STAGING | Restore ensaiado | registro completo em §10 dentro do ciclo definido | NÃO VERIFICADO | §10 deste documento | — | a designar |

Sem esses registros, os gates `firebase-production-readiness` e `observability-incident-readiness` emitem `FAIL`.

---

## 9. LGPD e backups

- **CURRENT:** não há política de retenção para dados pessoais nem regra para backups (PRIV-08; ver [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md)).
- **TARGET:** o prazo máximo em que um dado eliminado permanece em PITR (7 dias) e em backups (retenção da D-18) é definido e comunicado na Política de Privacidade (E-09; [PRIVACY_LGPD.md](PRIVACY_LGPD.md)).
- **TARGET (P8):** todo restore reaplica, antes de reabrir o serviço, as eliminações executadas depois de T0 (§6, passo 7). O registro de solicitações de titular fica fora do banco restaurável, ou em armazenamento append-only não revertido pelo restore.
- **TARGET:** backups e exports não servem a nenhuma outra finalidade. O acesso é restrito e auditado. Uma retenção bloqueada (export isolado) nunca excede o prazo comunicado ao titular.
- **DECISION D-07** (conflito entre histórico financeiro e eliminação) e **D-18** (prazos) condicionam a retenção de backups. **DECISION D-21:** encarregado e canal para comunicar incidentes que envolvam restauração de dados pessoais.

---

## 10. Registro de exercícios de restore e DR

**TARGET:** ensaio de restore em STAGING em P7 (cenários 1 e 2, no mínimo), repetido no ensaio completo de P10 e depois em periodicidade a definir (DECISION em P7). Nenhum exercício foi realizado.

| Data | Ambiente | Cenário | Origem (backup ou T0 de PITR) | Duração | RPO medido | RTO medido | Reconciliação | Falhas encontradas | Ações | Responsável |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — | — | — | — | — |

---

## 11. Lacunas e dependências

| ID | Lacuna | Milestone |
| --- | --- | --- |
| PR-BKP-01 | Sem PITR, backups agendados, delete protection ou procedimento de restore (FIRE-02 · C24) | P7 |
| PR-PLAT-01 | Sem STAGING para ensaiar o restore; produção usada como desenvolvimento | P6 |
| PR-PLAT-02 | Ferramenta de hard delete do ledger com override para produção | P6 |
| PR-REL-01 | Sem CD, tags ou rollback, que o cenário 5 exige | P6 |
| PR-OBS-01 | Sem alertas nem logs estruturados, o que atrasa a detecção e alonga o RPO efetivo | P7 |
| PR-OBS-02 | Sem processo de incidente nem mecanismos de contenção (modo somente leitura, interruptor por funcionalidade) para congelar escritas durante o restore | P7 |
| PR-RULES-01, PR-CC-01, PR-LOAN-04, PR-CR-02, PR-SPLIT-02 | Hard delete pelo cliente, o que torna o backup a única recuperação | P3, P4 |
| PR-TX-04 | Projeção de caixa sem retry nem cerca de versão | P3 |
| PR-ADMIN-01 | Sem capacidade administrativa auditada para executar restauração parcial e reatribuições | P7 |
| FIRE-08 (MEDIUM) | TTL não versionada; ativação errada apaga dado sem volta | P6 |
| INV-05 (MEDIUM) | Deriva medida só entre projeções | P7 |

Decisões relacionadas: D-07, D-10, D-18, D-19, D-21, D-27 (RPO/RTO, política de backup, export isolado, janela de PITR e periodicidade do ensaio de restore), D-32 (acesso de emergência). Configuração externa: E-04, E-05, E-07, E-08, E-09.
