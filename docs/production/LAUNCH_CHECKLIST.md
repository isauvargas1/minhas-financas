# Checklist de lançamento comercial

Lista verificável de tudo o que precisa estar comprovado antes de abrir o Minhas Finanças ao público e cobrar por ele. Cobre todas as áreas do programa de Production Readiness, não só o funil comercial. O estado foi levantado sobre o HEAD auditado (`main` @ `9c3ab46`) e os IDs vêm do [plano mestre](PRODUCTION_READINESS_PLAN.md) (registro [§6](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers), decisões [§9–§10](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision), configuração externa [§11](PRODUCTION_READINESS_PLAN.md#11-configuração-externa-necessária-external-configuration-required)). O gate do funil comercial é a skill `saas-commercial-readiness`. O checklist completo é assinado em P10, com `regression-release-gate` e todas as skills do projeto em `PASS`. Este documento não é parecer jurídico: os itens jurídicos exigem validação externa registrada na §11.

## Como usar

- **Estado:** `ATENDIDO` só com evidência comprovada no HEAD (`caminho:linha`, saída de teste ou registro externo com data e responsável). Todo o resto é `PENDENTE`. Não existe estado intermediário.
- **Classificação** de cada linha: **CURRENT** (já existe no HEAD, com evidência), **GAP** (lacuna registrada, com ID PR-* ou ID de origem MEDIUM/LOW), **TARGET** (requisito de lançamento sem lacuna registrada), **DECISION** (depende de escolha pendente em D-xx), **EXTERNAL CONFIGURATION REQUIRED** (abreviado **EXTERNAL**; configuração fora do repositório, estado NÃO VERIFICADO até haver registro).
- **Skill:** skill do projeto que emite o `PASS` do item. Linhas `ATENDIDO` são reverificadas em P10 sobre o HEAD final.
- Os números de item (1.1, 1.2…) são locais a este documento e não substituem os IDs do plano mestre.

**Resumo em `9c3ab46`:** 126 itens; 13 ATENDIDO e 113 PENDENTE (100 nas §1–§10 e os 13 registros jurídicos e de identidade da §11). Decisão atual: **NO-GO**.

---

## 1. Plataforma e ambientes

| # | Item verificável | Classificação | Estado | Referência | Milestone | Skill | Evidência exigida (ou comprovada) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | Firestore e Functions na mesma região `southamerica-east1`, garantida por teste de contrato | CURRENT | ATENDIDO | — | P10 (reverificar) | `firebase-production-readiness` | `firebase.json:4`; `functions/src/shared/runtimeOptions.ts:38-44`; `functions/src/index.ts:11`; `functions/src/shared/deploymentContract.test.ts:63-71` |
| 1.2 | Callables e crons com timeout, memória e `maxInstances` declarados; crons em `America/Sao_Paulo` | CURRENT | ATENDIDO | — | P10 (reverificar) | `firebase-production-readiness` | `functions/src/shared/runtimeOptions.ts:46-91`; `functions/src/shared/deploymentContract.test.ts:73-100` |
| 1.3 | Webhook Stripe e gatilho `onTransactionWrite` com perfil de runtime explícito, cobertos pelo teste de contrato | TARGET | PENDENTE | — | P6 | `firebase-production-readiness` | Hoje não declaram timeout nem memória: o webhook declara só região e segredos (`functions/src/webhooks/stripe.ts:31-41`) e o gatilho herda região e o teto global `maxInstances: 20` (`functions/src/triggers/transactions.ts:35-37`; `functions/src/shared/runtimeOptions.ts:41-44`); exigido: asserção no teste de contrato |
| 1.4 | Projetos DEV, STAGING e PROD isolados, com aliases e sem produção como default | GAP | PENDENTE | PR-PLAT-01, E-01, D-19 | P6 | `firebase-production-readiness` | `.firebaserc` com aliases; registro E-01 em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) |
| 1.5 | Nenhum script com projeto fixo; deploy só por CD com aprovação | GAP | PENDENTE | PR-PLAT-01, PR-REL-01, E-12 | P6 | `firebase-production-readiness` | Pipeline versionado; `package.json` sem `--project` fixo (hoje `package.json:22-26`) |
| 1.6 | App Check no cliente e enforcement em callables, Firestore e Auth | GAP | PENDENTE | PR-APPCHK-01, E-02, D-33 | P6 | `firebase-production-readiness`, `multi-tenant-security-review` | `initializeAppCheck` e `enforceAppCheck` no código, com teste; registro E-02 |
| 1.7 | Hosting com CSP, HSTS, `frame-ancestors` e demais headers; sem Tailwind Play CDN, Google Fonts, sons do Mixkit nem importmap `esm.sh`; paridade visual comprovada | GAP | PENDENTE | PR-PLAT-03, D-20, R-04 | P6 | `firebase-production-readiness`, `ptbr-product-ui-review` | Headers em `firebase.json`; `index.html` sem terceiros (hoje `index.html:8-11,75-93`; `src/contexts/ThemeContext.tsx:28-43`); screenshots antes/depois |
| 1.8 | Login E2E com credenciais fixas fora do bundle de produção; artefato de Hosting por ambiente | GAP | PENDENTE | PR-AUTH-04 | P6 | `firebase-production-readiness` | Busca no artefato de produção sem `signInForE2E` (hoje `src/contexts/AuthContext.tsx:94-114`) |
| 1.9 | Ferramenta de hard delete do ledger removida ou restrita a Emulator/DEV | GAP | PENDENTE | PR-PLAT-02 | P6 | `firebase-production-readiness`, `financial-domain-integrity` | Hoje `tools/investments/limpar-investimentos.mjs:59,88`; teste que prova a recusa |
| 1.10 | Segredos de servidor declarados por função; runtime config legado desabilitado; chave de IA fora do bundle | CURRENT | ATENDIDO | — | P10 (reverificar) | `firebase-production-readiness` | `functions/src/ai/callables.ts:24-29`; `functions/src/callables/billing.ts:90-94`; `functions/src/webhooks/stripe.ts:35-39`; `firebase.json:12`; `vite.config.ts:14-19`; `tests/unit/ai-backend-only.test.ts:33-90` |
| 1.11 | Nenhum arquivo de segredo versionado | CURRENT | ATENDIDO | — | P10 (reverificar) | `firebase-production-readiness` | `.gitignore:30-39`; `git ls-files` sem `.env*` (auditoria) |
| 1.12 | Segredos provisionados por ambiente, com falha fechada e sem placeholder | GAP | PENDENTE | PR-BILL-05, E-05 | P2 (código) · P6 (provisionamento) | `billing-entitlement-integrity`, `firebase-production-readiness` | `defineSecret` sem fallback (hoje `functions/src/webhooks/stripe.ts:8-9`); teste de recusa; registro E-05 |
| 1.13 | Chave Gemini exposta no passado rotacionada e revogada | GAP | PENDENTE | PR-AI-02, E-00, D-ORD-06 | P0 (ação externa imediata) | `firebase-production-readiness` | Registro E-00 em [SECURITY_MODEL.md](SECURITY_MODEL.md) com data e responsável |
| 1.14 | IAM de privilégio mínimo, MFA humano, sem chaves baixadas, Workload Identity Federation no CD | EXTERNAL | PENDENTE | E-04 | P6 | `firebase-production-readiness` | Registro E-04 |
| 1.15 | Auth: provedores aprovados, domínios sem `localhost` em PROD, anti-enumeração, templates pt-BR, MFA para admins | EXTERNAL | PENDENTE | E-03, D-06 | P6 | `firebase-production-readiness`, `multi-tenant-security-review` | Registro E-03 |
| 1.16 | Políticas de TTL versionadas no repositório e ativas por ambiente | GAP | PENDENTE | FIRE-08, RULES-13, E-07 | P6 | `firebase-production-readiness` | `fieldOverrides` em `firestore.indexes.json` (hoje vazio: `firestore.indexes.json:806`) |
| 1.17 | Índices compostos completos, sem ausentes e sem órfãos | GAP | PENDENTE | PR-CC-08, PR-RULES-03, RULES-17, D-23 | P4 | `firestore-scale-cost-review` | `firestore.indexes.json` conferido contra as queries |
| 1.18 | Testes de integração falham, e não pulam, sem Emulator | GAP | PENDENTE | FIRE-13, REL-09 | P6 | `regression-release-gate` | Suítes sem skip silencioso |
| 1.19 | Budget e alertas de custo por projeto | EXTERNAL | PENDENTE | E-08 | P7 | `observability-incident-readiness` | Registro E-08 |

## 2. Segurança e isolamento de tenant

| # | Item verificável | Classificação | Estado | Referência | Milestone | Skill | Evidência exigida (ou comprovada) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2.1 | Rules com default deny fora de `workspaces/` e `users/` | CURRENT | ATENDIDO | — | P10 (reverificar) | `multi-tenant-security-review` | `firestore.rules:1-3,990,1456` |
| 2.2 | Cliente não concede a si plano, admin nem campos Stripe em `users/{uid}` | CURRENT | ATENDIDO | — | P10 (reverificar) | `multi-tenant-security-review`, `billing-entitlement-integrity` | `firestore.rules:148-157,1456-1467`; `tests/firestore/m4-hardening.rules.integration.test.mjs:766-851` |
| 2.3 | Resolvedor único de papel relido na transação; membership ativo como fonte única | GAP | PENDENTE | PR-WS-03, D-ORD-02 | P1 | `multi-tenant-security-review` | Kernel de P1 com testes; busca sem os resolvedores duplicados |
| 2.4 | Convite real: token de uso único, expiração, e-mail verificado e aceite | GAP | PENDENTE | PR-WS-01, D-05, E-11 | P1 | `multi-tenant-security-review` | Callables de convite com teste; sem `fakeUid` |
| 2.5 | Mutações de membership por callable atômica e auditada; owner não pode ser trancado | GAP | PENDENTE | PR-WS-02, PR-WS-04, D-03, D-04 | P1 | `multi-tenant-security-review` | Testes de concorrência e de Rules |
| 2.6 | Bootstrap de conta e criação de workspace no backend, idempotentes | GAP | PENDENTE | PR-AUTH-03, PR-WS-05, D-22 | P1 | `multi-tenant-security-review` | `bootstrapAccount`/`createWorkspace` com teste; Rules negando criação pelo cliente |
| 2.7 | Testes cross-tenant de membership, convites e criação | GAP | PENDENTE | PR-WS-06 | P1 | `multi-tenant-security-review` | Suítes no Emulator |
| 2.8 | Suspensão de conta, revogação de sessão e política de e-mail verificado | GAP | PENDENTE | AUTH-09, AUTH-08, D-06 | P1 | `multi-tenant-security-review` | Callable de suspensão com revogação e teste |
| 2.9 | Catch-all de leitura de subcoleções removido | GAP | PENDENTE | PR-RULES-02 | P6 | `multi-tenant-security-review` | Rules sem o catch-all (hoje `firestore.rules:1436-1442`), com teste |
| 2.10 | Admin de plataforma por custom claim, com callables auditadas, ou painel removido | GAP | PENDENTE | PR-ADMIN-01, D-10 | P7 | `multi-tenant-security-review`, `observability-incident-readiness` | Sem `isAdmin` lido do Firestore no cliente (hoje `src/contexts/AuthContext.tsx:55-61`) |
| 2.11 | Histórico de chat de IA sem vazamento entre workspaces e usuários; logout limpa estado local | GAP | PENDENTE | PR-AI-04 | P5 | `privacy-lgpd-data-lifecycle`, `multi-tenant-security-review` | Histórico fora do localStorage, com teste |
| 2.12 | Varredura de segurança adversarial sobre o HEAD final sem achado BLOCKER/HIGH | TARGET | PENDENTE | Registro §6 | P10 | `multi-tenant-security-review` | Relatório da varredura |

## 3. Integridade financeira por domínio

| # | Item verificável | Classificação | Estado | Referência | Milestone | Skill | Evidência exigida (ou comprovada) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3.1 | Investimentos: ledger único no backend, centavos/micros, idempotência, papel relido na transação, Rules server-only | CURRENT | ATENDIDO | — | P10 (reverificar) | `financial-domain-integrity` | `functions/src/investments/callables.ts:71-104`; `functions/src/investments/infrastructure.ts:152-205`; `firestore.rules:1190-1349` |
| 3.2 | Cartões: compras, parcelas, faturas, pagamentos e ledger de limite escritos só pelo backend | CURRENT | ATENDIDO | — | P10 (reverificar) | `financial-domain-integrity` | `functions/src/creditCards/callables.ts:102-193`; `firestore.rules:1121-1174` |
| 3.3 | Metas: callables com Zod, transação, idempotência e audit log | CURRENT | ATENDIDO | — | P10 (reverificar) | `financial-domain-integrity` | `functions/src/goals/callables.ts:22-30`; `functions/src/goals/operations.ts:64-141,187-212` |
| 3.4 | `transactions`: exclusão física negada pelas Rules (baixa lógica) | CURRENT | ATENDIDO | — | P10 (reverificar) | `financial-domain-integrity` | `firestore.rules:1094`; `tests/firestore/m4-hardening.rules.integration.test.mjs:708-767` |
| 3.5 | Módulo `money` em centavos e política de datas civis `America/Sao_Paulo` | GAP | PENDENTE | PR-MONEY-01, D-17, D-34 | P1 | `financial-domain-integrity` | Módulo e testes; adoção por domínio em P3–P5 |
| 3.6 | Caixa autoritativo no backend em `amountCents`, fórmula única, projeção com retry idempotente e auditoria | GAP | PENDENTE | PR-TX-01…PR-TX-05, D-16, D-29, D-30, D-35, D-38 | P3 | `financial-domain-integrity`, `firestore-scale-cost-review` | Callables, Rules `write: false`, testes de concorrência e E2E |
| 3.7 | Empréstimos no backend, atômicos com o caixa | GAP | PENDENTE | PR-LOAN-01…PR-LOAN-07, D-13 | P3 | `financial-domain-integrity` | Callables transacionais com teste de corrida |
| 3.8 | Clientes e recebíveis no backend; recebimento gera receita na mesma transação | GAP | PENDENTE | PR-CR-01…PR-CR-04, D-24 | P3 | `financial-domain-integrity` | Callables e testes |
| 3.9 | As dez coleções adjacentes com escrita negada ao cliente e testes de escrita | GAP | PENDENTE | PR-RULES-01, PR-REL-02 | P3 · P4 | `multi-tenant-security-review`, `financial-domain-integrity` | Rules e suítes no Emulator |
| 3.10 | Cartões: cadastro por callable com arquivamento, centavos, idempotência estável, fatura correta | GAP | PENDENTE | PR-CC-01…PR-CC-08, D-36 | P4 | `financial-domain-integrity` | Callables, índices e testes |
| 3.11 | Recorrentes por callables e cron, ocorrência por data, cobrança via domínio de cartões | GAP | PENDENTE | PR-REC-01…PR-REC-06, D-12 | P4 | `financial-domain-integrity` | Testes de frequência semanal e quinzenal |
| 3.12 | Divisão de contas em módulo backend com alocação por maior resto | GAP | PENDENTE | PR-SPLIT-01…PR-SPLIT-07, D-14 | P4 | `financial-domain-integrity` | Callables e testes |
| 3.13 | Tipo `parcelado` e leitura concorrente de investimentos removidos de `transactions` | GAP | PENDENTE | PR-TX-06, PR-INV-01, D-15 | P4 | `financial-domain-integrity` | Busca no código e Rules |
| 3.14 | Metas com progresso único em centavos, listagem correta e arquivamento consistente | GAP | PENDENTE | PR-GOAL-01…PR-GOAL-04, D-31 | P5 | `financial-domain-integrity` | Testes |
| 3.15 | Relatórios server-side sobre projeções; alertas persistidos; testes | GAP | PENDENTE | PR-RPT-01…PR-RPT-05, D-37 | P5 | `financial-domain-integrity`, `firestore-scale-cost-review` | `getFinancialReport` com teste |
| 3.16 | Notificações com `limit`, cursor, TTL e estado de leitura por usuário | GAP | PENDENTE | PR-NOTIF-01 | P5 | `firestore-scale-cost-review` | Queries paginadas e Rules |
| 3.17 | Mensagens removidas ou com backend real | GAP | PENDENTE | PR-MSG-01, D-09 | P5 | `ptbr-product-ui-review` | Busca sem o mock (hoje `src/modules/messages/api.ts:4-66`) ou backend testado |
| 3.18 | IA com saída validada por schema e contexto montado no servidor | GAP | PENDENTE | PR-AI-05 | P5 | `privacy-lgpd-data-lifecycle` | `responseSchema` + Zod, com teste |
| 3.19 | Legado do plano mestre §7 removido em cada milestone, provado por busca, Rules e testes | TARGET | PENDENTE | [§7](PRODUCTION_READINESS_PLAN.md#7-legado-a-remover) | P1–P7 | `financial-domain-integrity` | Checklist "Domain replacement and legacy removal" em PASS |

## 4. Billing e entitlements

Detalhe em [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md).

| # | Item verificável | Classificação | Estado | Referência | Milestone | Skill | Evidência exigida (ou comprovada) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4.1 | Webhook verifica a assinatura Stripe sobre o raw body | CURRENT | ATENDIDO | — | P10 (reverificar) | `billing-entitlement-integrity` | `functions/src/webhooks/stripe.ts:42-58` |
| 4.2 | Checkout com allowlist de preço e de origem (falha fechada) e rate limit | CURRENT | ATENDIDO | — | P10 (reverificar) | `billing-entitlement-integrity` | `functions/src/callables/billing.ts:109-134` |
| 4.3 | Catálogo único: preço exibido = preço cobrado = entitlement concedido | GAP | PENDENTE | PR-BILL-04, D-08 | P2 | `billing-entitlement-integrity` | Catálogo no backend com teste contra a configuração do ambiente |
| 4.4 | Ciclo de vida completo da assinatura (todos os status Stripe tratados) | GAP | PENDENTE | PR-BILL-01 | P2 | `billing-entitlement-integrity` | Testes por evento e por status |
| 4.5 | Webhook idempotente por `event.id`, ordenado e auditado | GAP | PENDENTE | PR-BILL-06 | P2 | `billing-entitlement-integrity` | Testes de replay e de ordem invertida |
| 4.6 | Checkout por workspace e papel, sem assinatura duplicada | GAP | PENDENTE | PR-BILL-03 | P2 | `billing-entitlement-integrity`, `multi-tenant-security-review` | Teste de checkouts concorrentes |
| 4.7 | Customer Portal e cancelamento pelo produto | GAP | PENDENTE | PR-BILL-02 | P2 | `billing-entitlement-integrity` | Callable de Portal e seção "Plano e assinatura" |
| 4.8 | Estado canônico único da assinatura, gravado só pelo backend | GAP | PENDENTE | PR-BILL-07, D-01 | P2 | `billing-entitlement-integrity` | Documento canônico e Rules com teste |
| 4.9 | Quotas verificadas no backend, na transação da criação | GAP | PENDENTE | PR-ENT-01, D-ORD-05 | P2 → P5 | `billing-entitlement-integrity` | Um teste por callable com quota, inclusive concorrência no limite |
| 4.10 | Custo de IA com teto por plano e por entidade pagadora | GAP | PENDENTE | PR-AI-03, D-11 | P2 | `billing-entitlement-integrity` | Quota e limite de tokens com teste |
| 4.11 | Testes de comportamento de webhook, checkout e quotas | GAP | PENDENTE | PR-BILL-08 | P2 | `billing-entitlement-integrity` | Suítes no Emulator com fixtures assinadas localmente |
| 4.12 | Configuração Stripe de PROD (live) registrada e conferida | EXTERNAL | PENDENTE | E-06 | P2 · P10 | `billing-entitlement-integrity` | [BILLING_ENTITLEMENTS.md §14](BILLING_ENTITLEMENTS.md#14-registro-de-evidência-de-configuração-stripe-e-06) preenchida com data e responsável |
| 4.13 | Tratamento fiscal (NFS-e/ISS ou Stripe Tax) decidido e configurado | DECISION | PENDENTE | D-08, E-06 | P2 · P9 | `billing-entitlement-integrity` | Decisão registrada no plano mestre §10 |
| 4.14 | Assinatura cancelada na exclusão de conta ou workspace | GAP | PENDENTE | PR-AUTH-01, D-07 | P8 | `billing-entitlement-integrity`, `privacy-lgpd-data-lifecycle` | Teste do fluxo de exclusão |

## 5. Observabilidade e incidentes

| # | Item verificável | Classificação | Estado | Referência | Milestone | Skill | Evidência exigida (ou comprovada) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5.1 | Logger estruturado, correlation ID de servidor, erros internos visíveis no Cloud Logging | GAP | PENDENTE | PR-OBS-01, D-ORD-02 | P7 (contrato de logging em P1) | `observability-incident-readiness` | Busca sem `console.*` nos entrypoints; teste do mapeador |
| 5.2 | Políticas de alerta, canais, retenção de logs e sinks | EXTERNAL | PENDENTE | E-08, D-28 | P7 | `observability-incident-readiness` | Registro E-08 em [OBSERVABILITY.md](OBSERVABILITY.md) |
| 5.3 | Projeção oficial de caixa sem divergência silenciosa (retry idempotente, cerca de versão) | GAP | PENDENTE | PR-TX-04, D-38 | P3 | `observability-incident-readiness`, `financial-domain-integrity` | Testes de reentrega e de rebuild concorrente |
| 5.4 | Jobs de reconciliação financeira por domínio, com alerta | TARGET | PENDENTE | — | P7 | `observability-incident-readiness` | Jobs versionados e alerta ativo |
| 5.5 | Fila e replay de falhas de webhook, com runbook | TARGET | PENDENTE | PR-BILL-06 (P2) | P7 | `observability-incident-readiness`, `billing-entitlement-integrity` | Runbook em [RUNBOOKS.md](RUNBOOKS.md) exercitado em STAGING |
| 5.6 | Trilha de auditoria consolidada das ações sensíveis | TARGET | PENDENTE | D-ORD-02 | P7 | `observability-incident-readiness` | Gravador append-only com teste |
| 5.7 | Processo de incidentes com severidades, papéis, contatos, canal e tempos de resposta; mecanismos de contenção (interruptor por funcionalidade, modo somente leitura, revogação de sessão) | GAP | PENDENTE | PR-OBS-02, D-21, D-28, D-32 | P7 | `observability-incident-readiness` | [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) com contatos preenchidos e alavancas de contenção testadas |
| 5.8 | Drill de incidente executado em STAGING | TARGET | PENDENTE | — | P10 | `observability-incident-readiness` | Registro do drill com data |

## 6. Backup e disaster recovery

| # | Item verificável | Classificação | Estado | Referência | Milestone | Skill | Evidência exigida (ou comprovada) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 6.1 | PITR, backups agendados com retenção e delete protection no Firestore de PROD | GAP | PENDENTE | PR-BKP-01, E-07, D-18, D-27 | P7 | `firebase-production-readiness` | Registro E-07 em [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md) |
| 6.2 | Restore ensaiado em STAGING, validado por reconciliação financeira | GAP | PENDENTE | PR-BKP-01 | P7 (repetido em P10) | `firebase-production-readiness`, `observability-incident-readiness` | Registro do ensaio com tempos medidos |
| 6.3 | RPO e RTO definidos e aprovados | DECISION | PENDENTE | D-27 | P7 | `observability-incident-readiness` | Valores aprovados em [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md) |
| 6.4 | Reaplicação das eliminações LGPD após restore documentada | TARGET | PENDENTE | D-07 | P8 | `privacy-lgpd-data-lifecycle` | Procedimento em [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md) |

## 7. Privacidade e LGPD

| # | Item verificável | Classificação | Estado | Referência | Milestone | Skill | Evidência exigida (ou comprovada) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 7.1 | Exclusão de conta e de workspace com anonimização e retenções legais; exportação dos dados | GAP | PENDENTE | PR-AUTH-01, D-07 | P8 | `privacy-lgpd-data-lifecycle` | Callables com teste |
| 7.2 | Canal do titular, controlador e encarregado identificados | GAP | PENDENTE | PR-PRIV-01, D-21, E-09 | P8 | `privacy-lgpd-data-lifecycle` | Canal publicado; registro E-09 |
| 7.3 | Subprocessadores e transferência internacional divulgados | GAP | PENDENTE | PR-PRIV-01, E-09, E-10 | P8 | `privacy-lgpd-data-lifecycle` | [SUBPROCESSORS.md](SUBPROCESSORS.md) coerente com o código e política publicada |
| 7.4 | IA: base legal, transparência, minimização do payload e tier contratual | GAP | PENDENTE | PR-AI-01, D-11, E-10 | P8 | `privacy-lgpd-data-lifecycle` | Aviso na UI, contrato registrado |
| 7.5 | Dados de terceiros (clientes, contrapartes, participantes) minimizados e com ciclo de vida | GAP | PENDENTE | PR-CR-05 | P8 | `privacy-lgpd-data-lifecycle` | Schema mínimo e anonimização |
| 7.6 | Aceite de Termos e Política registrado no servidor, versionado | GAP | PENDENTE | PR-AUTH-02 | P8 (registro) · P9 (cadastro) | `privacy-lgpd-data-lifecycle` | Registro server-side com teste |
| 7.7 | Retenção implementada por categoria de dado | DECISION | PENDENTE | D-18 | P8 | `privacy-lgpd-data-lifecycle` | [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md) aprovado |
| 7.8 | Terceiros no navegador eliminados ou divulgados (Tailwind Play CDN, Google Fonts, sons do Mixkit, importmap `esm.sh`, Web Speech) | GAP | PENDENTE | PR-PLAT-03 (PRIV-09), D-26 | P6 · P8 | `privacy-lgpd-data-lifecycle` | `index.html` sem terceiros ou aviso publicado |
| 7.9 | Inventário de dados pessoais coerente com o código | TARGET | PENDENTE | — | P8 | `privacy-lgpd-data-lifecycle` | [PRIVACY_LGPD.md](PRIVACY_LGPD.md) validado |

## 8. Funil comercial

| # | Item verificável | Classificação | Estado | Referência | Milestone | Skill | Evidência exigida (ou comprovada) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 8.1 | Landing pública no domínio de produção, com proposta de valor verificável | GAP | PENDENTE | PR-COMM-01 | P9 | `saas-commercial-readiness` | Rota pública com E2E (hoje o visitante só vê o login: `src/App.tsx:686-690`) |
| 8.2 | Página de preços pública lendo o catálogo do backend, com renovação, cancelamento, reembolso, arrependimento e impostos | GAP | PENDENTE | PR-COMM-01, PR-BILL-04, D-08 | P9 | `saas-commercial-readiness`, `billing-entitlement-integrity` | Preços idênticos ao catálogo e ao Stripe |
| 8.3 | Cadastro com aceite de Termos e Política, verificação e mensagens pt-BR | GAP | PENDENTE | PR-AUTH-02 | P9 | `saas-commercial-readiness`, `privacy-lgpd-data-lifecycle` | E2E do cadastro (hoje `src/components/auth/LoginView.tsx:15-53`) |
| 8.4 | Checkout com resumo do contrato; sucesso exibido só após confirmação do servidor | GAP | PENDENTE | PR-COMM-03 | P9 | `saas-commercial-readiness`, `billing-entitlement-integrity` | Hoje `src/modules/billing/components/BillingSuccessModal.tsx:8-10,31-36` |
| 8.5 | Cancelamento pelo mesmo meio da contratação; política de arrependimento publicada | GAP | PENDENTE | PR-COMM-02, PR-BILL-02 | P9 (Portal em P2) | `saas-commercial-readiness` | E2E do cancelamento |
| 8.6 | Canal de suporte com prazo de resposta, FAQ mínima e comunicação de indisponibilidade | DECISION | PENDENTE | D-21, D-32, E-11 | P9 | `saas-commercial-readiness` | Páginas publicadas |
| 8.7 | Termos, Privacidade, Cookies e Cancelamento/Reembolso publicados com versão e data, acessíveis de landing, cadastro, rodapé e produto | GAP | PENDENTE | PR-AUTH-02, PR-COMM-02, E-09 | P9 | `saas-commercial-readiness`, `privacy-lgpd-data-lifecycle` | Rotas públicas e §11 validada |
| 8.8 | Rodapé institucional: razão social, CNPJ, endereço físico e eletrônico, links legais e de suporte, ano corrente | GAP | PENDENTE | PR-COMM-01, PR-COMM-02, D-21 | P9 | `saas-commercial-readiness` | Hoje só "Ambiente seguro © 2024" (`src/components/auth/LoginView.tsx:50-52`) |
| 8.9 | Acessibilidade WCAG 2.1 AA no funil (`lang="pt-BR"`, foco, teclado, labels, `aria-label`) com verificação automatizada | GAP | PENDENTE | COMM-06 | P9 | `saas-commercial-readiness`, `ptbr-product-ui-review` | axe via Playwright e verificação manual (hoje `index.html:3` com `lang="en"`) |
| 8.10 | SEO técnico: title e description únicos, canonical, Open Graph, favicon, `robots.txt`, `sitemap.xml`, 404 própria, páginas autenticadas com `noindex` | GAP | PENDENTE | COMM-06 | P9 | `saas-commercial-readiness` | Hoje só `<title>` (`index.html:7`) e rewrite catch-all em `firebase.json` |
| 8.11 | Nenhuma afirmação sobre recurso inexistente, simulado ou placeholder (convites, Mensagens, "Insight Financeiro IA", painel admin) | GAP | PENDENTE | PR-COMM-03, PR-MSG-01, RPTAI-14, D-09 | P5 · P9 | `saas-commercial-readiness` | Mapa afirmação → código → teste |
| 8.12 | Natureza do serviço explícita: não é instituição financeira, não recomenda investimento, IA não é aconselhamento | TARGET | PENDENTE | E-09 | P9 | `saas-commercial-readiness` | Texto publicado e validado (§11) |
| 8.13 | Marca única em todas as superfícies e registro de marca | EXTERNAL | PENDENTE | E-11 | P9 | `saas-commercial-readiness` | Hoje três nomes: "Minhas Finanças" (`index.html:7`), "Arquiteto Financeiro" (`src/components/auth/LoginView.tsx:20`), "Finace Dashboard 21" (`metadata.json:5`) |
| 8.14 | Domínio próprio com TLS; e-mail transacional com SPF, DKIM e DMARC | EXTERNAL | PENDENTE | E-11 | P9 | `saas-commercial-readiness` | Registro E-11 |
| 8.15 | Tela de consentimento OAuth com homepage e URLs de política e termos | EXTERNAL | PENDENTE | E-03 | P6 · P9 | `saas-commercial-readiness` | Registro E-03 após as páginas públicas existirem |

## 9. Release e CI

| # | Item verificável | Classificação | Estado | Referência | Milestone | Skill | Evidência exigida (ou comprovada) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 9.1 | CI de qualidade sem segredos: typecheck, lint, builds, unitários, integração e Rules no Emulator (projeto `minhas-financas-local`) e E2E | CURRENT | ATENDIDO | — | P10 (reverificar) | `regression-release-gate` | `.github/workflows/quality-gate.yml:26-160`; `package.json:36-38` |
| 9.2 | Proteção de `main` com checks obrigatórios; environments com aprovação | EXTERNAL | PENDENTE | E-12, PR-REL-01 | P6 | `regression-release-gate` | Registro E-12 em [RUNBOOKS.md](RUNBOOKS.md) |
| 9.3 | Versionamento de release e rollback testado | GAP | PENDENTE | PR-REL-01 | P6 | `firebase-production-readiness` | Rollback executado em STAGING |
| 9.4 | Suítes de Rules de todos os domínios com escrita no CI e no `predeploy:rules` | GAP | PENDENTE | PR-REL-02 | P3 (P4 e P5 para os demais domínios) | `regression-release-gate` | `package.json` e workflow atualizados |
| 9.5 | README e documentação operacional coerentes com o HEAD | GAP | PENDENTE | PR-DOCS-01 | P0 | `regression-release-gate` | Gate de P0 em PASS registrado no plano mestre §15 |
| 9.6 | Auditoria integral repetida sobre o HEAD final; registro §6 sem BLOCKER/HIGH abertos | TARGET | PENDENTE | [§6](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers) | P10 | `regression-release-gate` | Relatório de P10 |
| 9.7 | Ensaio completo em STAGING: deploy por CD, restore, rollback, replay de webhook e drill | TARGET | PENDENTE | — | P10 | `firebase-production-readiness` | Registro do ensaio |
| 9.8 | Teste de carga e custo | TARGET | PENDENTE | — | P10 | `firestore-scale-cost-review` | Relatório com metas atingidas |
| 9.9 | Todas as skills do projeto em PASS sobre o HEAD final | TARGET | PENDENTE | — | P10 | `regression-release-gate` | Saída de cada skill |

## 10. UI e pt-BR

| # | Item verificável | Classificação | Estado | Referência | Milestone | Skill | Evidência exigida (ou comprovada) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10.1 | Todo texto visível em pt-BR, sem pt-PT, inglês ou chaves internas | GAP | PENDENTE | COMM-08, BILL-11, AUTH-15, RPTAI-17 | P2 · P5 · P7 · P9 | `ptbr-product-ui-review` | Hoje `src/modules/billing/hooks.ts:13,36`; `src/components/AdminDashboard.tsx:24,27`; `src/modules/billing/components/PricingTable.tsx:73` |
| 10.2 | Erros do backend mapeados para mensagens pt-BR (sem `internal` nem mensagem crua) | GAP | PENDENTE | BILL-12, ENTRY-21, D-ORD-02 | P1 | `ptbr-product-ui-review` | Mapeador do kernel com teste (hoje `src/modules/billing/hooks.ts:40`) |
| 10.3 | UI autenticada visualmente inalterada fora das mudanças indispensáveis | TARGET | PENDENTE | D-20, R-04 | P1–P9 | `ptbr-product-ui-review` | Screenshots antes/depois por milestone |
| 10.4 | Estados de carregamento, vazio, erro e sucesso tratados nas superfícies alteradas | TARGET | PENDENTE | BILL-15, AUTH-10 | P1–P9 | `ptbr-product-ui-review` | Revisão da skill por milestone |

---

## 11. Registro de validação jurídica e identidade do fornecedor

EXTERNAL CONFIGURATION REQUIRED. Nenhum item pode ser validado pelo repositório nem por agentes. Os estados NÃO VALIDADO, NÃO DEFINIDO e NÃO VERIFICADO equivalem a `PENDENTE`. Cada linha só vira ATENDIDO com responsável, data e versão aprovada. As skills `saas-commercial-readiness` e `privacy-lgpd-data-lifecycle` tratam linha sem registro como `FAIL` (R-05).

| # | Item | Referência | Estado | Versão aprovada | Data | Responsável |
| --- | --- | --- | --- | --- | --- | --- |
| 11.1 | Termos de Uso | E-09, PR-AUTH-02 | NÃO VALIDADO | — | — | — |
| 11.2 | Política de Privacidade (bases legais, subprocessadores, transferência internacional, retenção, direitos) | E-09, D-18 | NÃO VALIDADO | — | — | — |
| 11.3 | Política de Cookies e armazenamento local | E-09, D-26 | NÃO VALIDADO | — | — | — |
| 11.4 | Termos de assinatura: renovação, cancelamento, reembolso e direito de arrependimento (CDC art. 49) | E-09, D-08, PR-COMM-02 | NÃO VALIDADO | — | — | — |
| 11.5 | Identificação do fornecedor para comércio eletrônico (razão social, CNPJ, endereço; Decreto 7.962/2013) | D-21 | NÃO DEFINIDO | — | — | — |
| 11.6 | Encarregado de dados e canal do titular | D-21, E-09 | NÃO DEFINIDO | — | — | — |
| 11.7 | DPAs com Google (Firebase/GCP, Gemini) e Stripe; mecanismo de transferência internacional | E-09, E-10 | NÃO VALIDADO | — | — | — |
| 11.8 | Papel de controlador/operador sobre dados de terceiros (clientes, contrapartes, participantes) | E-09, PR-CR-05 | NÃO VALIDADO | — | — | — |
| 11.9 | IA: base legal, aviso ou opt-in, avaliação de impacto para comprovantes e voz | E-09, E-10, D-11 | NÃO VALIDADO | — | — | — |
| 11.10 | Aviso de natureza do serviço (não é consultoria de investimento; IA não é aconselhamento) | E-09 | NÃO VALIDADO | — | — | — |
| 11.11 | Comunicação de incidente com dados pessoais à ANPD e aos titulares (prazo a confirmar) | E-09 | NÃO VALIDADO | — | — | — |
| 11.12 | Registro e disponibilidade da marca | E-11 | NÃO VERIFICADO | — | — | — |
| 11.13 | Tratamento fiscal das assinaturas (NFS-e/ISS) | D-08 | NÃO DEFINIDO | — | — | — |

---

## 12. Critério de GO

- **GO** exige, ao mesmo tempo: todas as linhas das §1–§11 em `ATENDIDO` com a evidência indicada; P10 em `PASS` ([plano mestre §8](PRODUCTION_READINESS_PLAN.md#8-milestones)); registro §6 sem BLOCKER nem HIGH abertos; todos os itens E-00…E-12 com evidência, data e responsável; todas as decisões D-xx que afetam o lançamento tomadas e registradas na §10 do plano mestre.
- Qualquer linha `PENDENTE` significa **NO-GO**. Não existe GO com ressalvas, exceção temporária ou aceite de risco por fora deste documento.
- Linhas hoje `ATENDIDO` voltam a ser verificadas no HEAD final de P10; regressão as devolve para `PENDENTE`.
- Este checklist só é atualizado com evidência nova. Mudança de estado sem evidência invalida a assinatura abaixo.

### Assinatura (P10)

| Papel | Nome | Data | Decisão |
| --- | --- | --- | --- |
| Responsável técnico | — | — | — |
| Responsável de produto | — | — | — |
| Jurídico | — | — | — |
