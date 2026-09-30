# Plano mestre de Production Readiness

Documento mestre do programa que leva o backend do Minhas Finanças a ficar tecnicamente pronto para uso comercial em produção. Todo trabalho do programa parte daqui. Os demais documentos de `docs/production/` detalham cada tema e remetem aos IDs deste plano.

- **Baseline auditada:** `main` @ `9c3ab462071f3e8e44c5b2975da9e2c2086ca631` (2026-09-27).
- **Milestone atual:** P0 — fundação e documentação (ver §2 e §14).
- **Regra de leitura:** este plano registra estado auditado, alvo e lacunas. Ele **não prova** implementação. Antes de qualquer mudança, confirme o código real no HEAD.

## Classificação usada em `docs/production/`

| Rótulo | Significado |
| --- | --- |
| **CURRENT** | Comportamento que existe no HEAD auditado, com evidência `arquivo:linha`. |
| **TARGET** | Estado exigido para produção comercial. Ainda não implementado, salvo quando marcado como CURRENT. |
| **GAP** | Diferença entre CURRENT e TARGET, com ID do registro (§6) quando for BLOCKER/HIGH. |
| **DECISION** | Escolha de produto, comercial ou técnica ainda pendente (§10) ou já tomada (§9). |
| **EXTERNAL CONFIGURATION REQUIRED** | Configuração fora do repositório (console Firebase/GCP, Stripe, DNS, GitHub, jurídico) que exige registro de evidência (§11). |

Severidade: **BLOCKER** impede uso comercial em produção; **HIGH** é defeito sério a corrigir antes do lançamento; **MEDIUM**/**LOW** ficam nos documentos de domínio.

---

## 1. Direção de arquitetura

Referência completa: [ARCHITECTURE.md](ARCHITECTURE.md). Princípios que todo milestone deve respeitar:

1. SaaS multiworkspace real, com isolamento rigoroso de tenant em `workspaces/{workspaceId}/...`.
2. Operações financeiras críticas autoritativas **exclusivamente** no backend (callables com Admin SDK, schema estrito, transação, idempotência, auditoria).
3. RBAC owner/admin/member/viewer (viewer somente leitura) validado server-side por um único resolvedor; Firestore Rules como segunda camada independente que nega escrita do cliente em dados autoritativos.
4. Valores monetários em centavos inteiros (`*Cents`, `Number.isSafeInteger`), sem autoridade financeira em ponto flutuante.
5. Operações compostas transacionais; idempotência em toda operação sujeita a retry; concorrência explicitamente testada.
6. Nenhum hard delete de histórico financeiro; cancelamento, estorno e arquivamento como registros compensatórios.
7. Eventos e auditoria suficientes para reconstrução e investigação; nenhuma fonte de verdade financeira concorrente.
8. Queries paginadas com `limit` e cursor; índices e TTL versionados no repositório.
9. Quotas e entitlements validados server-side.
10. DEV/STAGING/PROD isolados; nenhum segredo no cliente ou no repositório; Emulator obrigatório nos testes Firebase.
11. UI autenticada visualmente inalterada; mudança de UI só quando indispensável para integração, estado, validação, segurança ou contrato.
12. Todo conteúdo visível ao usuário em pt-BR.

### Política de legado

Não existem dados reais de produção. Compatibilidade com código, schema ou fluxo legado **não** é preservada quando existe apenas para manter dados de desenvolvimento/teste. Ao substituir uma arquitetura, o milestone remove, no mesmo escopo, o write path antigo, readers, fallbacks, adapters, flags, Rules e índices sem uso, Functions órfãs e fontes de verdade concorrentes. Dados de teste são recriados por seed/Emulator, não migrados. A remoção é provada por busca no código, Rules que negam o caminho antigo e testes (checklist "Domain replacement and legacy removal" da skill `financial-domain-integrity`).

---

## 2. Estado do programa

| Milestone | Escopo | Estado |
| --- | --- | --- |
| **P0** | Fundação: instruções, skills, documentação, auditoria, plano | Concluído (§14) |
| **P1** | Auth, workspaces, memberships, RBAC, convites, ciclo de vida de conta + kernel compartilhado do backend | Concluído — `regression-release-gate` `PASS` em 2026-09-29 (§16.3); blockers fechados (§16.4) |
| **P2** | Billing Stripe, entitlements e quotas | Em andamento — P2A (billing canônico, catálogo e lifecycle Stripe) concluída em 2026-09-29 e endurecida em P2A.1 (§17, §17.7); P2B.1 (quotas de workspaces e membros, transferência de ownership, entitlement do workspace pelo owner) concluída em 2026-09-30 (§17.8); P2B.2 (créditos de IA por plano do owner, idempotência, teto de saída e contenção como `aborted`) concluída em 2026-09-30 (§17.9); P2C (gate de P2) pendente |
| **P3** | Caixa autoritativo (transactions), Empréstimos, Clientes/Recebíveis | Não iniciado |
| **P4** | Convergência de Recorrentes, Divisão de contas, Cartões e Transações | Não iniciado |
| **P5** | Metas, Relatórios, Notificações, Mensagens, IA | Não iniciado |
| **P6** | Hardening Firebase e segurança (ambientes, App Check, Hosting, IAM, CD) | Não iniciado |
| **P7** | Observabilidade, auditoria, backup/restore, incidentes, admin/suporte | Não iniciado |
| **P8** | Privacidade/LGPD e ciclo de vida de dados | Não iniciado |
| **P9** | Cadastro, landing, preços, páginas legais, prontidão comercial | Não iniciado |
| **P10** | Auditoria adversarial e gate completo de produção | Não iniciado |

Nenhum milestone começa sem pedido explícito. Nenhum artefato de P1–P5 pode ser implantado em qualquer projeto remoto antes do fechamento de P6 (ver D-ORD-04).

---

## 3. Baseline auditada

A auditoria do HEAD foi feita em 2026-09-27, somente leitura, por 17 auditores de domínio e 4 varreduras transversais (escritas do cliente e callables, leituras/listeners/índices, representação monetária, entrypoints do backend). Cada alegação da §4 foi julgada pelo auditor e por um verificador independente; cada achado BLOCKER recebeu um verificador cético encarregado de refutá-lo. Foram 97 agentes no total. Uma amostra das evidências centrais (C03, C05, C10, C14, C16, C18, PR-BILL-05, PR-PLAT-02) foi reconferida diretamente no código.

- **Achados brutos:** 351 (49 BLOCKER, 114 HIGH, 138 MEDIUM, 50 LOW), com sobreposição entre auditores e varreduras.
- **Registro consolidado (§6):** 94 itens canônicos — 30 BLOCKER, 60 HIGH e 4 MEDIUM (PR-RPT-04, PR-AI-05 e PR-DOCS-01, ligados a alegações da §4, e PR-RULES-02). Um deles (PR-OBS-02) foi identificado durante a redação de P0, sem achado bruto correspondente. MEDIUM e LOW restantes estão nos documentos de domínio, com o ID do achado de origem.
- **Nenhum BLOCKER foi refutado** pelos verificadores céticos. Dos 49 achados BLOCKER brutos, 33 foram confirmados como descritos e 16 julgados PARTIAL (núcleo confirmado, escopo ou cenário impreciso); 6 receberam sugestão de severidade menor, a reavaliar no milestone correspondente sem remover o item do registro.
- **Base sólida já existente (CURRENT):** o domínio de investimentos é único e autoritativo no backend (ledger `investment_movements`, centavos/micros inteiros, idempotência, projeções no mesmo commit, Rules server-only); compras, faturas, pagamentos e ledger de limite de cartão são escritos só pelo backend; metas usam callables transacionais; todas as Functions ficam em `southamerica-east1` com `maxInstances` global (`functions/src/shared/runtimeOptions.ts:41-44`; `functions/src/index.ts:11`), callables e crons têm timeout e memória por perfil, e isso é protegido por teste de contrato (`functions/src/shared/deploymentContract.test.ts`) — o webhook Stripe (`functions/src/webhooks/stripe.ts:31-41`) e o gatilho de caixa (`functions/src/triggers/transactions.ts:35-37`) usam os padrões da plataforma para timeout e memória; segredos de servidor vivem no Secret Manager; há CI com typecheck, lint, builds, unitários, integração e 6 suítes de Rules no Emulator e E2E Playwright (`.github/workflows/quality-gate.yml`).

Os dados brutos da auditoria (por domínio) foram usados para redigir os documentos de `docs/production/`; os IDs de origem (ex.: `LOAN-02`, `READ-07`) aparecem nas tabelas para rastreabilidade.

---

## 4. Verificação das alegações conhecidas

Cada alegação recebida no início do programa foi confirmada ou refutada contra o HEAD. "Nuance" registra a parte que não se sustenta ou que está desatualizada.

| # | Alegação | Veredito | Evidência principal | Nuance | Registro |
| --- | --- | --- | --- | --- | --- |
| C01 | Limites de plano aplicados só no frontend | **CONFIRMADA** | `src/hooks/usePlan.ts:36-38`; `src/components/Header.tsx:58`; `firestore.rules:991-994` | A concessão do plano é server-side (webhook) e as Rules impedem o cliente de gravar `planId`; a aplicação dos limites não é. O limite de membros nem na UI existe. | PR-ENT-01 |
| C02 | Pro e Business com preço inconsistente | **CONFIRMADA** | `src/constants/plans.ts:15,26` (mesmo `priceId`); `src/modules/billing/components/PricingTable.tsx:42` (R$ 29,90 fixo); `functions/src/webhooks/stripe.ts:83-84,98` | O webhook concede sempre `pro`; Business nunca é concedido. | PR-BILL-04 |
| C03 | Lifecycle Stripe incompleto | **CONFIRMADA** | `functions/src/webhooks/stripe.ts:60` (único tipo tratado: `checkout.session.completed`) | A assinatura do webhook é verificada; faltam eventos de assinatura/fatura, portal, idempotência por `event.id` e ordem. | PR-BILL-01, PR-BILL-02, PR-BILL-06 |
| C04 | Gestão de membership não atômica | **PARCIAL** (pior que o descrito) | `src/modules/workspaces/api.ts:236-264`; `firestore.rules:1478-1485` | A segunda escrita (espelho de outro usuário) é **sempre** negada pelas Rules: escrita parcial determinística. Falso apenas "sem validação server-side": as Rules validam enum de papel, autopromoção e owner, com testes. | PR-WS-02 |
| C05 | Convite/membro com UID fictício no frontend | **CONFIRMADA** | `src/components/MembersManagerModal.tsx:53-66`; `firestore.rules:1021-1026` | — | PR-WS-01 |
| C06 | Autorização interna insegura em Split Bills | **CONFIRMADA** | `functions/src/callables/splitGroups.ts:115-137`; `firestore.rules:1389-1392` | A escalada cross-tenant (INV-P2-037) já está fechada; o papel de dono do grupo continua forjável por qualquer member e a identidade usa nome de exibição. | PR-SPLIT-04 |
| C07 | Loans com autoridade financeira no cliente | **CONFIRMADA** | `src/modules/loans/api.ts:340-369`; `src/components/PJLoanDetailsView.tsx:88-101`; `firestore.rules:1351-1359` | Não há nenhum backend de empréstimos. | PR-LOAN-01 |
| C08 | Concorrência de saldo em empréstimos PJ | **CONFIRMADA** | `src/components/PJLoanDetailsView.tsx:90-101`; `src/modules/loans/api.ts:227-241,355-357` | Resulta em dupla dedução ou lost update. | PR-LOAN-02 |
| C09 | Operações caixa/empréstimo não atômicas | **CONFIRMADA** | `src/components/LoanFormModal.tsx:78-89`; `src/components/PJLoanDetailsView.tsx:73-101` | Os vínculos `loanId`/`loanMovementId` usam IDs temporários que nunca batem com os documentos gravados. | PR-LOAN-03, PR-LOAN-05 |
| C10 | Hard deletes financeiros | **PARCIAL** | `src/modules/loans/api.ts:262,280`; `src/modules/clients/api.ts:81-89,144`; `firestore.rules:1118` | **Desatualizada para `transactions`:** exclusão virou baixa lógica (`voidedAt`), Rules negam delete (`firestore.rules:1094`) e há teste. **Verdadeira** para loans, loan_movements, receivables, clients, split_*, credit_cards e recurring_*. | PR-LOAN-04, PR-CR-02, PR-SPLIT-02, PR-CC-01, PR-RULES-01 |
| C11 | Clients/Receivables com escrita direta e órfãos | **CONFIRMADA** | `src/modules/clients/api.ts:59-144`; `firestore.rules:1361-1369` | — | PR-CR-01, PR-CR-02 |
| C12 | Recorrente com integração incorreta de `cardId` | **CONFIRMADA** | `src/components/RecurringExpenseDetailsView.tsx:119-121` (`parseInt`); `functions/src/crons/recurring.ts:322-343` | O cron ignora o cartão e gera despesa de caixa. | PR-REC-04 |
| C13 | Ocorrência marcada sem transação confirmada | **CONFIRMADA** | `src/components/RecurringExpenseDetailsView.tsx:98-125,169-170`; `firestore.rules:67-76` | A transação é sempre negada pelas Rules (chave `id` fora da allowlist) e a ocorrência fica "gerada" com `despesaId` fantasma; o cron pula o mês para sempre. | PR-REC-02 |
| C14 | `recurring_occurrences` controlável pelo cliente | **CONFIRMADA** | `firestore.rules:1102-1105` | Exposição intra-workspace (membership bloqueia cross-tenant). | PR-REC-01 |
| C15 | Split/Recurring fora do domínio de cartões | **CONFIRMADA** | `src/components/SplitGroupDetailsView.tsx:123-157`; `src/components/SplitBillFormModal.tsx:166` | O ramo de cartão do Split hoje é descartado em silêncio por erro de tipo (`parseInt` × id string); corrigido o tipo, geraria parcelas legadas `parcelado` fora de fatura e limite. | PR-SPLIT-03, PR-REC-04, PR-TX-06 |
| C16 | Exclusão física de cartão | **CONFIRMADA** | `firestore.rules:1118`; `src/modules/credit-cards/api.ts:97-101`; `src/components/CreditCardsView.tsx:1071-1076` | — | PR-CC-01 |
| C17 | Notifications com API incompatível com Rules e leitura não limitada | **PARCIAL** | `src/modules/notifications/api.ts:24-25,44`; `firestore.rules:1372-1381`; `src/modules/notifications/hooks.ts:16` | Leitura sem `limit` + polling de 30 s: verdadeiro. Incompatibilidade só em `create` (código morto) e em arquivar para member/viewer; `list` e `markAsRead` são compatíveis. | PR-NOTIF-01 |
| C18 | Messages em localStorage/mock | **CONFIRMADA** | `src/modules/messages/api.ts:4-66,146-203` | Não existe coleção, Rule, Function nem teste. | PR-MSG-01 |
| C19 | Alertas de Reports não persistidos | **CONFIRMADA** | `src/modules/reports/logic.ts:697-721`; `src/modules/reports/api.ts:207-209` | `markAlertAsRead` só faz `console.log`. | PR-RPT-04 |
| C20 | Output de IA sem schema forte | **CONFIRMADA** | `functions/src/ai/callables.ts:122-150,223-249`; `src/components/TransactionModal.tsx:651-676` | A entrada é validada por Zod; a saída não. | PR-AI-05 |
| C21 | Admin Dashboard com placeholders | **CONFIRMADA** | `src/components/AdminDashboard.tsx:39,51,63` | Sem nenhuma callable administrativa; textos em pt-PT. | PR-ADMIN-01 |
| C22 | README desatualizado | **CONFIRMADA** | `git show 9c3ab46:README.md` linhas 13 e 47 × `firebase.json:25-58` e `package.json:36` | Os comandos da tabela de gates existiam, mas a linha de `test:integration:emulator` citava cinco suítes de Rules (são seis); o README também negava o Hosting e deixava um bloco de código aberto. Corrigido em P0. | PR-DOCS-01 |
| C23 | Ausência de App Check | **CONFIRMADA** | `src/lib/firebase.ts:1-64`; `functions/src/shared/runtimeOptions.ts:41-91` | Nenhuma ocorrência de `initializeAppCheck`/`enforceAppCheck`. | PR-APPCHK-01 |
| C24 | Ausência de backup/restore | **CONFIRMADA** | `firebase.json:2-7`; `docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:20-25` | Sem PITR, backup agendado, delete protection ou runbook. | PR-BKP-01 |
| C25 | Ausência de observabilidade global | **CONFIRMADA** | `functions/src/creditCards/errors.ts:78-83`; `functions/src/goals/callables.ts:49-55` | Existem métricas/eventos por módulo (investimentos, cartões) gravados em Firestore; não há logger estruturado, correlação de servidor, métricas nem alertas. | PR-OBS-01, PR-OBS-02 |
| C26 | Ausência de lifecycle LGPD | **CONFIRMADA** | `src/components/auth/LoginView.tsx:15-53`; `firestore.rules:1467`; `functions/src/index.ts:13-37` | Há TTL técnico em coleções operacionais (`functions/src/shared/retention.ts`), mas nenhuma política de dados pessoais. | PR-AUTH-01, PR-AUTH-02, PR-PRIV-01 |

**Descartadas por desatualização (total ou parcial):** nenhuma alegação foi integralmente refutada. Estão desatualizadas: hard delete de `transactions` (C10); ausência de validação server-side de membership (C04 — as Rules validam); escalada cross-tenant em Split (C06 — corrigida); incompatibilidade de `list`/`markAsRead` de notificações (C17); ausência total de retenção (C26 — há TTL técnico).

**Achados adicionais relevantes não previstos na lista:** ambiente de produção usado como desenvolvimento e alvo fixo de deploy (PR-PLAT-01); ferramenta versionada de hard delete do ledger com override para produção (PR-PLAT-02); chave Gemini embutida no bundle no passado, sem rotação comprovada (PR-AI-02); espelhos de caixa gravados pelo backend editáveis pelo cliente (PR-TX-02); frequências semanal/quinzenal de recorrentes perdendo cobranças (PR-REC-03); checkout que permite assinatura duplicada (PR-BILL-03); segredos Stripe com fallback placeholder (PR-BILL-05); Tailwind Play CDN, Google Fonts e sons do Mixkit carregados de terceiros em runtime e importmap `esm.sh` publicado no HTML de produção, sem CSP (PR-PLAT-03); ownerId trancável fora do workspace (PR-WS-04); índices compostos ausentes (PR-CC-08, PR-RULES-03).

---

## 5. Estado por domínio

Resumo auditado por domínio. O detalhe (CURRENT/TARGET/GAP completos, MEDIUM/LOW) está no documento indicado.

### 5.1 Authentication/account lifecycle — [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md)
- **CURRENT:** login só Google (`signInWithPopup`), mais um login e-mail/senha de E2E com credenciais fixas ativado por flag de build (`src/contexts/AuthContext.tsx:94-114`). Não há blocking functions, custom claims, verificação de e-mail, revogação, desativação, reautenticação nem exclusão de conta. O perfil `users/{uid}` só é criado pelo webhook Stripe (`functions/src/webhooks/stripe.ts:97-106`). As Rules impedem o cliente de gravar campos de plano/admin, com teste.
- **CURRENT (P1, §16):** `bootstrapAccount` cria numa transação perfil server-owned, workspace pessoal já provisionado, membership owner, índice e auditoria (`functions/src/workspaces/lifecycle.ts:106`); suspensão com Auth desativado e revogação de sessões (`functions/src/workspaces/suspension.ts:36`); toda callable do kernel recusa conta suspensa e as Rules negam leitura/escrita de dados de workspace a conta `suspended` (`firestore.rules:31-45`). O texto acima descreve o baseline de P0.
- **GAP:** PR-AUTH-01, PR-AUTH-02, PR-AUTH-04 (PR-AUTH-03 fechado em P1, PLAN §16.4).
- **TARGET:** identidade só do token verificado; `bootstrapAccount` idempotente cria perfil server-owned, workspace pessoal determinístico e membership; suspensão com revogação; exclusão/exportação (P8). Sequência do aceite: P1 prepara o `bootstrapAccount` para receber o registro de aceite; P8 define documentos, versões e o registro server-side de aceite e consentimentos; P9 torna o aceite obrigatório no cadastro.

### 5.2 Workspaces/memberships/RBAC/invites — [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md)
- **CURRENT:** criar workspace, adicionar/remover membro e trocar papel são escritas do cliente (`src/modules/workspaces/api.ts:180-273`), sem callable, transação, auditoria ou quota. Rules M4.C validam papel e bloqueiam autopromoção, com testes. Autoridade dupla `ownerId` × membership e dois resolvedores de papel no backend (`functions/src/creditCards/auth.ts`, `functions/src/investments/infrastructure.ts`).
- **CURRENT (P1, §16):** 11 callables de conta/workspace/membership no kernel (`functions/src/workspaces/callables.ts:68-232`); resolvedor único por membership ativo relido na transação (`functions/src/shared/workspaceAuth.ts:121-214`); Rules `write: false` em workspace, members, convites, auditoria e índice (`firestore.rules:936-976,1398-1402`); listas paginadas por cursor sob demanda (`src/modules/workspaces/api.ts:69,131,190`). O texto acima descreve o baseline de P0.
- **GAP:** nenhum de P1 (PR-WS-01…PR-WS-06 fechados em P1, PLAN §16.4). A quota de workspaces/membros é P2 (D-01).
- **TARGET:** callables de ciclo de vida de workspace e membership; convites com token de uso único vinculado ao e-mail verificado; membership ativo como fonte única de papel; índice do usuário mantido pelo backend.

### 5.3 Transactions/cash — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT:** `workspaces/{id}/transactions` é criado, editado e anulado pelo cliente (`src/modules/transactions/api.ts:257-360`), com `value` float. A exclusão é lógica (`voidedAt`) e o delete é negado pelas Rules. O backend mantém `cash_report_periods` por gatilho idempotente (`functions/src/triggers/transactions.ts`, `functions/src/cash/periods.ts`), com uma fórmula de caixa diferente das três fórmulas do frontend (dashboard, relatórios, lista) e da usada no log do próprio gatilho.
- **GAP:** PR-TX-01…PR-TX-06.
- **TARGET:** callables de lançamento/edição/anulação em centavos, idempotentes, com evento append-only; Rules `write: false`; classificação de caixa única no backend.

### 5.4 Credit Cards — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT:** compras, parcelas, faturas, pagamentos, ledger e snapshot de limite são escritos só por 9 callables com Zod, transação e idempotência; Rules bloqueiam o cliente nessas coleções. O cadastro `credit_cards` continua gravado e **apagado fisicamente** pelo cliente. Dinheiro em float com 12 cópias de `normalizeMoney`.
- **GAP:** PR-CC-01…PR-CC-08, PR-TX-06.
- **TARGET:** cadastro de cartão via callables (arquivar, nunca apagar); centavos; máquina de estados de fatura separando ciclo e pagamento; única entrada de compra para Split e Recorrentes.

### 5.5 Recurring Expenses — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT:** cron `processRecurring` (Admin SDK, paginado, checkpoint, fuso de São Paulo) gera despesa de caixa em float e ignora o cartão. A geração manual na tela é client-side, sempre negada pelas Rules e ainda assim marca a ocorrência como gerada. `recurring_expenses` e `recurring_occurrences` aceitam qualquer escrita de member.
- **GAP:** PR-REC-01…PR-REC-06.
- **TARGET:** callables + cron autoritativos; ocorrência por data; cobrança no cartão via `createCreditCardPurchase` (source `recurring`); centavos e datas civis em `America/Sao_Paulo`.

### 5.6 Split Bills — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT:** grupos, participantes, títulos, rateios, pagamentos e exclusões são escritos pelo cliente; o backend tem só criar/aceitar convite (`functions/src/callables/splitGroups.ts`). Float sem centavos, hard delete em cascata, integração caixa/cartão fora dos domínios autoritativos.
- **GAP:** PR-SPLIT-01…PR-SPLIT-07.
- **TARGET:** módulo backend `splitBills` com alocação por maior resto em centavos, arquivamento, RBAC de grupo lido no servidor e lançamentos via domínios de caixa e cartão.

### 5.7 Loans — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT:** 100% cliente; nenhum código de backend. Saldo e status calculados no navegador; três escritas independentes por pagamento; corrida PJ; hard delete em cascata; vínculo com caixa quebrado.
- **GAP:** PR-LOAN-01…PR-LOAN-07.
- **TARGET:** callables `createLoan`, `registerLoanPayment`, `reverseLoanMovement`, `cancelLoan` numa única transação que grava contrato, movimento, espelho de caixa, idempotência e auditoria.

### 5.8 Clients/Receivables — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT:** CRUD 100% cliente (`src/modules/clients/api.ts`), Rules só checam papel, float, hard delete com cascata não atômica, "Marcar Recebido" não gera caixa, leitura sem `limit`, nenhum teste. Dados pessoais de terceiros (CPF/CNPJ, e-mail, telefone).
- **GAP:** PR-CR-01…PR-CR-05.
- **TARGET:** callables com `amountCents`, recebimento que cria a receita na mesma transação, arquivamento de cliente com anonimização sob pedido.

### 5.9 Investments — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT:** domínio único e autoritativo: 23 callables com wrapper Zod, papel revalidado na transação, idempotência determinística, centavos/micros, projeções no mesmo commit; Rules negam escrita do cliente; callables legadas removidas com teste de contrato. Restam: leitura concorrente de "Investimentos" pelo espelho em `transactions`, fallbacks legados (`type 'investimento'` sem metadata, grupo `investment_type`), 13 callables profissionais sem UI, sem entitlement, pendências de M8 (ingestão CSV, deriva medida contra o ledger).
- **GAP:** PR-INV-01, PR-PLAT-02, PR-ENT-01 (parcela de investimentos).
- **TARGET:** manter o ledger; projeções oficiais como única leitura; remover fallbacks e superfície sem uso (DECISION D-15).

### 5.10 Goals — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT:** escritas por callables com Zod, transação, idempotência e audit log; progresso patrimonial publicado pelo domínio de investimentos. Campos de progresso concorrentes (float e centavos lado a lado), `progressBasis current_value` inconsistente, `listGoals` dependente de campo nunca gravado, botões de status sem efeito.
- **GAP:** PR-GOAL-01…PR-GOAL-04.

### 5.11 Reports — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT:** relatórios de caixa, categorias, cartões e recebíveis calculados no navegador sobre até 20.000 transações e sobre documentos de cartão pedidos com limites que somam 15.000, mas truncados a 200 por coleção (`src/modules/credit-cards/persistence/readApi.ts:69-72`, PR-CC-07), com semântica divergente de `cash_report_periods`. Apenas o bloco patrimonial vem de projeção server-side. Alertas efêmeros.
- **GAP:** PR-RPT-01…PR-RPT-05.
- **TARGET:** `getFinancialReport` server-side sobre projeções em centavos; alertas persistidos por job idempotente.

### 5.12 Notifications — [DATA_MODEL.md](DATA_MODEL.md)
- **CURRENT:** produtor real só no domínio de cartões (Admin SDK, ID determinístico). Frontend lê a coleção inteira com polling de 30 s; sem TTL; estado de lido compartilhado por workspace; arquivar = hard delete.
- **GAP:** PR-NOTIF-01.

### 5.13 Messages — [DATA_MODEL.md](DATA_MODEL.md)
- **CURRENT:** simulado em localStorage com threads e usuários fixos, exposto no Header.
- **GAP:** PR-MSG-01 (DECISION D-09).

### 5.14 AI — [SECURITY_MODEL.md](SECURITY_MODEL.md), [PRIVACY_LGPD.md](PRIVACY_LGPD.md)
- **CURRENT:** chave só no backend (Secret Manager); entrada validada com Zod; RBAC; rate limit por workspace+ator; teto mensal de créditos pelo plano do titular, idempotência por chave e `maxOutputTokens` por chamada, com o provedor chamado só depois do commit do crédito (P2B.2, §17.9). Saída sem schema; contexto enviado pelo cliente; modelo preview e SDK legado; histórico de chat em localStorage; dados e comprovantes enviados ao Gemini sem transparência. A chave esteve embutida no bundle até ago/2026 e a rotação não está comprovada.
- **GAP:** PR-AI-01 (P8), PR-AI-02 (P0, ação externa), PR-AI-04 e PR-AI-05 (P5). PR-AI-03 fechado em P2B.2 (§17.9); App Check em PR-APPCHK-01 (P6).

### 5.15 Billing/Stripe — [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md)
- **CURRENT (P2A entregue, §17):** catálogo canônico versionado no backend (`functions/src/billing/catalog.ts:16`); estado canônico `billing_accounts/{uid}` gravado só pelo backend; `createCheckoutSession` sem assinatura duplicada, `createBillingPortalSession` e webhook com recibo idempotente por `event.id`, ordem por releitura no Stripe fora de transação (lease com geração, P2A.1), grace period e auditoria; segredos sem fallback (falha fechada); Rules que negam escrita do cliente; frontend com provider único. Testes de comportamento no Emulator (§17.2).
- **GAP:** nenhum de billing no código. PR-BILL-01…06 e PR-BILL-08 fechados em P2A (§17.3); PR-BILL-07 fechado em P2B.1 (`getWorkspaceEntitlement`, §17.8). E-06 (configuração Stripe) segue sem conferência.

### 5.16 Entitlements/quotas — [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md)
- **CURRENT (P2B.1):** motor de entitlements de P2A (`functions/src/billing/entitlements.ts:71,131,157`) e API de quota `functions/src/billing/quota.ts`, aplicada na transação de `bootstrapAccount`, `createWorkspace`, `archiveWorkspace`, convite, revogação, aceite, remoção, saída e transferência de ownership, pelo plano efetivo do owner (§17.8); créditos mensais de IA pelo plano efetivo do titular, na admissão atômica das duas callables de IA (§17.9). Lançamentos e grupos de divisão seguem só como ajuda de UX pelo plano do workspace (`checkWorkspaceLimit`) até P3/P4 (D-ORD-05).
- **GAP:** PR-ENT-01 (P3–P5). PR-AI-03 fechado em P2B.2 (§17.9).

### 5.17 Firestore Rules — [SECURITY_MODEL.md](SECURITY_MODEL.md)
- **CURRENT:** 1.490 linhas com default deny fora de `workspaces/` e `users/`, helpers de membership com status, domínios de investimentos/cartão/metas server-only com teto de `limit`, allowlists em `users`, `workspaces`, `members` e `transactions`, 6 suítes no Emulator e no CI. Dez coleções financeiras adjacentes aceitam qualquer escrita de member, sem schema; catch-all de leitura em subcoleções.
- **GAP:** PR-RULES-01…PR-RULES-03, PR-TX-02, PR-CC-02, PR-REC-01.

### 5.18 App Check — [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md)
- **CURRENT:** inexistente em todas as camadas.
- **GAP:** PR-APPCHK-01.

### 5.19 Observability — [OBSERVABILITY.md](OBSERVABILITY.md)
- **CURRENT:** métricas e eventos de falha gravados em Firestore por workspace (investimentos com shards/TTL; cartões sem), resumos de cron em `console.*`, `correlationId` definido pelo cliente (rótulo estático em cartões, valor aleatório por tentativa em investimentos, chave de idempotência em metas) sem ID de requisição do servidor, erros internos convertidos em `HttpsError` e invisíveis no Cloud Logging.
- **GAP:** PR-OBS-01, PR-OBS-02, PR-TX-04.

### 5.20 Backup/restore — [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md)
- **CURRENT:** nada configurado nem documentado.
- **GAP:** PR-BKP-01.

### 5.21 Privacy/LGPD — [PRIVACY_LGPD.md](PRIVACY_LGPD.md), [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md), [SUBPROCESSORS.md](SUBPROCESSORS.md)
- **CURRENT:** sem política, termos, aceite, exportação, exclusão, canal do titular ou divulgação de subprocessadores; TTL técnico em coleções operacionais.
- **GAP:** PR-AUTH-01, PR-AUTH-02, PR-PRIV-01, PR-CR-05, PR-AI-01.

### 5.22 Landing/commercial/legal — [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md)
- **CURRENT:** nenhuma superfície pública; visitante vê só a tela de login; `index.html` com `lang="en"`; tabela de preços interna com valores fixos que o billing não implementa.
- **GAP:** PR-COMM-01…PR-COMM-03 (PR-BILL-04 fechado em P2A: preços e limites da tabela vêm do catálogo do backend, §17.3).

### 5.23 Admin capabilities — [SECURITY_MODEL.md](SECURITY_MODEL.md), [RUNBOOKS.md](RUNBOOKS.md)
- **CURRENT:** `isAdmin` lido pelo cliente de `users/{uid}` (não autoconcedível, com teste); painel placeholder; nenhuma callable administrativa.
- **GAP:** PR-ADMIN-01 (DECISION D-10).

### 5.24 CI/release process — [RUNBOOKS.md](RUNBOOKS.md), [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md)
- **CURRENT:** CI de qualidade sem segredos em Node 22/24; deploy manual da estação do desenvolvedor para o único projeto; sem CD, proteção de branch evidenciada, versionamento de release ou rollback testado.
- **GAP:** PR-REL-01, PR-REL-02, PR-PLAT-01.

### 5.25 Transversais — plataforma e dinheiro
- **Plataforma (CURRENT):** um único projeto Firebase (`.firebaserc`), usado também como desenvolvimento; Hosting sem headers de segurança; Tailwind Play CDN, Google Fonts e sons do Mixkit carregados de terceiros em runtime; importmap `esm.sh` publicado no HTML (requisição em runtime não comprovada). **GAP:** PR-PLAT-01…PR-PLAT-03, PR-AUTH-04.
- **Dinheiro (CURRENT):** módulo `money` único em centavos (`functions/src/shared/money.ts`, espelhado em `src/lib/money.ts`, vetores compartilhados em `tests/fixtures/money-vectors.json`) e datas civis em `America/Sao_Paulo` (`functions/src/shared/dateKeys.ts`), entregues em P1. A adoção por domínio segue pendente: metas gravam float e centavos lado a lado; os demais domínios usam reais em float. **GAP:** itens de adoção de cada domínio (P3–P5); PR-MONEY-01 fechado em P1 quanto ao módulo e à política (PLAN §16.4).

---

## 6. Registro de blockers

Itens BLOCKER e HIGH consolidados, mais quatro MEDIUM (três ligados a alegações da §4 e PR-RULES-02). A evidência mostra as duas primeiras referências dos achados de origem verificados; a lista completa está nos documentos de domínio. Um item só sai deste registro quando o milestone indicado o fechar com evidência e gate `PASS` (atualizar a coluna na §15).

#### Authentication/account lifecycle

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-AUTH-01 | BLOCKER | P8 | Sem exclusão de conta, exportação de dados nem cancelamento de assinatura na saída do titular | `functions/src/index.ts:13-37 - sem auth trigger/callable de conta`<br>`firestore.rules:1467 - users delete false; sem allow delete em workspaces (990-1008)` | AUTH-01, PRIV-02, PRIV-03 · C26 |
| PR-AUTH-02 | BLOCKER | P9 | Cadastro sem Termos de Uso, Política de Privacidade e registro server-side de aceite versionado | `src/components/auth/LoginView.tsx:15-53 - só botão Google e 'Ambiente seguro © 2024'`<br>`grep 'Termos\|Privacidade\|LGPD' em src: 0` | AUTH-02, PRIV-01 · C26 |
| PR-AUTH-04 | HIGH | P6 | Login E2E com credenciais fixas no código de produção e artefato de Hosting compartilhado com o build E2E | `src/contexts/AuthContext.tsx:94-114`<br>`src/lib/firebase.ts:47-62 - sem assert E2E=>emulador` | AUTH-13, REL-05 |

#### Workspaces/memberships/RBAC/invites

Nenhum item aberto. PR-WS-01…PR-WS-06 foram fechados em P1 e saíram deste registro. A evidência de cada um está em §16.4.

#### Transactions/cash

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-TX-01 | BLOCKER | P3 | Lançamentos de caixa autoritativos no cliente, sem callable, schema server-side, idempotência nem valor em centavos | `src/modules/transactions/api.ts:258 — addDoc (ID aleatório)`<br>`src/modules/transactions/api.ts:274-311 — writeBatch cliente` | TX-01, FEW-01, RULES-01, MONEY-01, TX-11 |
| PR-TX-02 | BLOCKER | P3 | Espelhos de caixa gravados pelo backend continuam editáveis/anuláveis pelo cliente e vínculos de origem são forjáveis | `firestore.rules:67-76 — allowlist inclui vínculos de backend`<br>`firestore.rules:243-248 — isPlainClientTransaction só com campos de investimento` | RULES-02, CC-02, TX-05, TX-06 |
| PR-TX-03 | HIGH | P3 | Fórmulas de caixa concorrentes entre projeção backend, dashboard, relatórios e log | `functions/src/cash/periods.ts:85,109-117,141-149`<br>`src/modules/investments/semantics.ts:27-48` | TX-04, MONEY-02, RPTAI-05 |
| PR-TX-04 | HIGH | P3 | Projeção oficial de caixa pode divergir em silêncio: gatilho e crons sem retry, documento quente, rebuild sem cerca de versão | `functions/src/triggers/transactions.ts:35-37,70-79`<br>`functions/src/shared/runtimeOptions.ts:41-44 — sem retry` | TX-08, FIRE-05, ENTRY-06, ENTRY-08, TX-15 |
| PR-TX-05 | HIGH | P3 | Sem trilha de auditoria imutável das edições e anulações de transação | `src/modules/transactions/api.ts:313-330`<br>`firestore.rules:89-99` | TX-09, TX-13 |
| PR-TX-06 | HIGH | P4 | Tipo legado parcelado e campos de fatura ainda graváveis em transactions (fonte concorrente ao domínio de cartões) | `firestore.rules:40-41 — 'parcelado' aceito`<br>`firestore.rules:67-75 — cardId/creditCardInvoiceId/creditCardCompatibility graváveis` | FEW-07, CC-04, MONEY-06 · C15 |

#### Credit Cards

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-CC-01 | BLOCKER | P4 | Exclusão física do cartão pelo cliente, deixando compras, faturas e ledger órfãos | `firestore.rules:1118`<br>`src/modules/credit-cards/api.ts:97-101` | CC-01 · C16 |
| PR-CC-02 | HIGH | P4 | Configuração autoritativa do cartão (limite, ciclo, status) gravada pelo cliente, em float e sem reconciliação | `firestore.rules:942-988 — limitTotal/closingDay/dueDay/status graváveis`<br>`src/modules/credit-cards/api.ts:82-95 — updateDoc direto` | CC-03, RULES-05 |
| PR-CC-03 | HIGH | P4 | Chave de idempotência gerada por tentativa: envio duplo duplica compra | `src/components/TransactionModal.tsx:787-791,860 — randomUUID por submit`<br>`src/components/TransactionModal.tsx:793-865 — handleSubmit sem guarda de in-flight` | CC-05, FEW-11 |
| PR-CC-04 | HIGH | P4 | Cron de faturas vencidas sobrescreve status/valores com leitura desatualizada e reprocessa o backlog global diariamente | `functions/src/crons/creditCardInvoices.ts:354-359 — invoice vem da página`<br>`functions/src/crons/creditCardInvoices.ts:249-276 — transaction.update sem transaction.get(invoiceRef)` | CC-06, ENTRY-07, READ-09, CC-11 |
| PR-CC-05 | HIGH | P4 | Máquina de estados da fatura mistura ciclo (aberta/fechada) com pagamento | `functions/src/creditCards/registerInvoicePayment.ts:131-138`<br>`functions/src/creditCards/reverseInvoicePayment.ts:145-155` | CC-07 |
| PR-CC-06 | HIGH | P4 | Dinheiro em float (reais) em todo o domínio de cartões, arredondando fração de centavo em silêncio | `functions/src/creditCards/contracts.ts:18-26 — z.number().positive() sem cents/max`<br>`functions/src/creditCards/contracts.ts:86-89 — installmentsCount sem max` | CC-08, MONEY-03, ENTRY-18 |
| PR-CC-07 | HIGH | P4 | Consultas de fatura truncadas: ordem asc+limit esconde as atuais, itens limitados a 50, relatório pede 5000 e recebe 200 | `src/modules/reports/hooks.ts:85-90 — limites de 5000 e 2500`<br>`src/modules/credit-cards/persistence/readApi.ts:69-72 — Math.min(limit, 200)` | READ-04, READ-05, READ-06, CC-13 |
| PR-CC-08 | HIGH | P4 | Índice composto ausente para credit_card_audit_logs (cardId ASC, occurredAt DESC) | `src/modules/credit-cards/persistence/readApi.ts:464-482 — where cardId e orderBy occurredAt desc`<br>`src/components/CreditCardsView.tsx:725 — consumidor` | READ-03, RULES-10, CC-10 |

#### Recurring Expenses

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-REC-01 | BLOCKER | P4 | recurring_expenses e recurring_occurrences graváveis por qualquer member, sem schema, e tratadas como autoritativas pelo cron | `firestore.rules:1097-1105 — allow write sem schema`<br>`functions/src/crons/recurring.ts:258-260 — nextDueDate do documento é confiado` | REC-01, RULES-04 · C14 |
| PR-REC-02 | BLOCKER | P4 | Geração manual perde o lançamento e marca a ocorrência como gerada/paga sem transação confirmada | `src/components/RecurringExpenseDetailsView.tsx:97-172 — fluxo completo`<br>`src/components/RecurringExpenseDetailsView.tsx:107-108 — id no payload` | REC-02, TX-03, FEW-05 · C13 |
| PR-REC-03 | BLOCKER | P4 | Ocorrência identificada por mês: frequências semanal e quinzenal perdem cobranças | `functions/src/crons/recurring.ts:239-242 — recurringOccurrenceId por competência`<br>`functions/src/crons/recurring.ts:479-490 — pula e avança` | REC-03 |
| PR-REC-04 | HIGH | P4 | Recorrência paga no cartão não passa pelo domínio de cartões; integração de cardId quebrada (parseInt/NaN) | `functions/src/crons/recurring.ts:322-343 — sem card`<br>`src/components/RecurringExpenseDetailsView.tsx:119-121 — parseInt` | REC-04 · C12, C15 |
| PR-REC-05 | HIGH | P4 | Datas gravadas em meia-noite UTC e lidas como D-1 em São Paulo (vencimentos e atrasos) | `src/modules/recurring-expenses/api.ts:198-199,224-225 — new Date(YYYY-MM-DD) em UTC`<br>`functions/src/crons/recurring.ts:146-147 — Timestamp lido com saoPauloDayKey` | REC-06, CR-11, RPTAI-12 |
| PR-REC-06 | HIGH | P4 | valorPadrao em float, sem validação server-side, copiado cru para o ledger pelo cron | `src/components/RecurringExpenseFormModal.tsx:183`<br>`src/components/RecurringExpenseDetailsView.tsx:130-131,176` | REC-07, MONEY-07, ENTRY-15 |

#### Split Bills

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-SPLIT-01 | BLOCKER | P4 | Autoridade financeira de Split no cliente, sem schema nem invariantes (títulos, rateios, status, reembolso) | `firestore.rules:1384-1402`<br>`src/modules/split-bills/api.ts:293-320,322-355,377-380,455-460` | SPLIT-01, FEW-02 |
| PR-SPLIT-02 | BLOCKER | P4 | Hard delete de grupos, títulos, rateios e participantes; exclusão de grupo falha no meio | `src/modules/split-bills/api.ts:194-233 — deleteSplitGroup; limit 300 em 218-226`<br>`src/modules/split-bills/api.ts:357-375 — deleteSplitBill` | SPLIT-02, FEW-06 · C10 |
| PR-SPLIT-03 | BLOCKER | P4 | Integração caixa/cartão fora dos domínios autoritativos, não atômica e sem idempotência (hoje descartada em silêncio) | `src/components/SplitGroupDetailsView.tsx:100-106 — duas mutações independentes`<br>`src/components/SplitGroupDetailsView.tsx:123-166 — handleIntegration` | SPLIT-03, REC-05 · C15 |
| PR-SPLIT-04 | HIGH | P4 | Autorização interna insegura: papel de dono do grupo forjável, identidade por nome de exibição, limite de tentativas revertido | `functions/src/callables/splitGroups.ts:115-137`<br>`firestore.rules:1389-1392` | SPLIT-06, FEW-14, ENTRY-14, SPLIT-09 · C06 |
| PR-SPLIT-05 | HIGH | P4 | Rateios e parcelas em float com dízima, calculados só no cliente | `src/modules/split-bills/logic.ts:33-54,63-68,73-84`<br>`src/components/SplitBillFormModal.tsx:88-95` | SPLIT-04, MONEY-05 |
| PR-SPLIT-06 | HIGH | P4 | Editar título zera pagamentos e troca o método de divisão | `src/components/SplitBillFormModal.tsx:56-58 — setMetodoDivisao('igual'), manualInputs zerados`<br>`src/components/SplitBillFormModal.tsx:131-147 — status recalculado sem olhar sharesToEdit` | SPLIT-05 |
| PR-SPLIT-07 | HIGH | P4 | Testes do domínio insuficientes ou tautológicos | `functions/src/callables/__tests__/splitGroups.integration.test.ts:39-93`<br>`tests/firestore/adjacent-modules.rules.integration.test.mjs:204-222 — só leitura` | SPLIT-08 |

#### Loans

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-LOAN-01 | BLOCKER | P3 | Autoridade financeira de empréstimos no cliente (saldo, status, cronograma) e Rules sem validação | `firestore.rules:1351-1359 — allow write: if canMemberWriteWorkspaceScopedData`<br>`src/modules/loans/api.ts:209-241 — createLoan/updateLoan gravam o payload do cliente` | LOAN-01, MONEY-04 · C07 |
| PR-LOAN-02 | BLOCKER | P3 | Pagamento PJ com escrita dupla concorrente: dupla dedução ou lost update do saldo | `src/components/PJLoanDetailsView.tsx:88-101`<br>`src/modules/loans/api.ts:355-357` | LOAN-02, FEW-03 · C08 |
| PR-LOAN-03 | BLOCKER | P3 | Caixa e empréstimo gravados em escritas separadas (não atômico, sem idempotência) | `src/components/LoanFormModal.tsx:78-90`<br>`src/components/PJLoanFormModal.tsx:89-103` | LOAN-03, TX-07 · C09 |
| PR-LOAN-04 | BLOCKER | P3 | Hard delete de contrato e movimentos pelo cliente, em cascata não atômica | `src/modules/loans/api.ts:256-284 — deleteDoc + batch.delete em laço`<br>`firestore.rules:1353,1358 — write inclui delete para member` | LOAN-05, READ-01 · C10 |
| PR-LOAN-05 | HIGH | P3 | Vínculo loanId/loanMovementId da transação de caixa sempre quebrado (IDs temporários do cliente) | `src/components/LoanFormModal.tsx:47,84 — loanId = Date.now()`<br>`src/components/PJLoanFormModal.tsx:54,95` | LOAN-04 |
| PR-LOAN-06 | HIGH | P3 | Valores em float e máquina de estados/amortização incoerentes; sem estorno de movimento | `src/modules/loans/types.ts:13,46-49`<br>`src/modules/loans/logic.ts:15-35` | LOAN-06, LOAN-07, LOAN-09 |
| PR-LOAN-07 | HIGH | P3 | RBAC: member tem os mesmos poderes de owner/admin sobre empréstimos | `firestore.rules:443-446,1351-1359`<br>`src/modules/loans/types.ts:34-65 — Loan sem createdBy/updatedBy` | LOAN-08 |

#### Clients/Receivables

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-CR-01 | BLOCKER | P3 | Recebíveis e clientes gravados diretamente pelo cliente, com Rules sem schema | `firestore.rules:1366-1369 — receivables: allow write: canMemberWriteWorkspaceScopedData`<br>`firestore.rules:1361-1364 — clients: idem` | CR-01 · C11 |
| PR-CR-02 | BLOCKER | P3 | Hard delete de recebíveis e clientes (inclusive por member) e cascata não atômica que gera órfãos | `src/modules/clients/api.ts:142-145 — deleteReceivable = deleteDoc`<br>`src/modules/clients/api.ts:82,87-89 — deleteDoc do cliente + batch.delete dos recebíveis` | CR-02, CR-03 · C10, C11 |
| PR-CR-03 | HIGH | P3 | Recebimento não gera transação de caixa; status paid é fonte de verdade concorrente | `src/components/ClientsReceivablesView.tsx:115-118 — só status`<br>`src/modules/clients/hooks.ts:99-106 — update parcial 'as any'` | CR-04, FEW-13 |
| PR-CR-04 | HIGH | P3 | Dinheiro em float, leituras sem limit e domínio sem nenhum teste | `src/components/ReceivableFormModal.tsx:46 — parseFloat(amount)`<br>`src/components/ReceivableFormModal.tsx:100-101 — type number, step 0.01, sem min` | CR-05, MONEY-08, CR-06, CR-08 |
| PR-CR-05 | HIGH | P8 | Dados pessoais de terceiros (CPF/CNPJ, e-mail, telefone) sem minimização nem ciclo de vida | `src/components/ClientFormModal.tsx:42,72-107 — coleta de e-mail, telefone, CPF/CNPJ e observações`<br>`src/modules/clients/types.ts:3-10 — campos pessoais (inclusive duplicados cnpj/document, address)` | CR-07, PRIV-07, LOAN-16 |

#### Investments

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-INV-01 | HIGH | P4 | Fonte concorrente de Investimentos/aportes a partir do espelho em transactions | `functions/src/investments/operationsV2.ts:1848-1855 — estorno de aporte → 'redemption'`<br>`src/modules/investments/semantics.ts:21-24,51-57 — só conta contribution` | INV-02 |

#### Goals

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-GOAL-01 | HIGH | P5 | progressBasis current_value com duas semânticas; opção da UI sempre falha e troca de base não recalcula | `functions/src/goals/contracts.ts:70-76 — exige currentValue para current_value`<br>`functions/src/goals/operations.ts:156-165,180-181 — progresso manual em currentAmountCents` | GOAL-01, GOAL-02, INV-08 |
| PR-GOAL-02 | HIGH | P5 | listGoals filtra archived==false (campo nunca gravado) e trunca em 100 | `functions/src/goals/operations.ts:167-185,196-206 — persistência sem archived`<br>`src/modules/goals/api.ts:47-55 — archived==false + fallback limit(100) por documentId` | GOAL-03, READ-19 |
| PR-GOAL-03 | HIGH | P5 | Progresso de metas PJ automáticas calculado no cliente, em float, sobre janela truncada | `src/modules/goals/logic.ts:7-25 — limites de período em horário local`<br>`src/modules/goals/logic.ts:41-44 — new Date(t.date) (UTC) comparado com start/end locais` | GOAL-04 |
| PR-GOAL-04 | HIGH | P5 | Arquivar meta ignora posições vinculadas; investimentos aceitam meta arquivada; botões de status não persistem | `functions/src/goals/operations.ts:260-279 — nenhuma leitura de posições; status cancelada`<br>`functions/src/investments/infrastructure.ts:363-381 — assertWorkspaceDocument sem checagem de archived` | GOAL-05, INV-09, GOAL-06 |

#### Reports

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-RPT-01 | HIGH | P5 | Indicadores de fatura e vencimentos ignoram faturas e parcelas futuras | `src/modules/reports/hooks.ts:174-194 — {startDate, endDate: hoje} para invoices/installments`<br>`src/modules/reports/logic.ts:51-57 — endDate = saoPauloDayKey()` | RPTAI-04 |
| PR-RPT-02 | HIGH | P5 | Agregação no cliente sobre datasets amplos: carga lê até 20 mil transações e relê tudo a cada mutação | `src/modules/transactions/api.ts:121,127,183-205`<br>`src/modules/reports/hooks.ts:85-90,165-199` | RPTAI-06, READ-08, TX-14 |
| PR-RPT-03 | HIGH | P5 | Id kpi-net-profit inexistente: alerta crítico PJ morto, IA sempre em persona PF, widget PJ vazio | `src/modules/reports/logic.ts:177-211 — ids PJ`<br>`src/modules/reports/logic.ts:707 — find('kpi-net-profit')` | RPTAI-07 |
| PR-RPT-04 | MEDIUM | P5 | Alertas de relatórios efêmeros, sem persistência, entrega ou histórico; preferências decorativas | `src/modules/reports/hooks.ts:320-339`<br>`src/modules/reports/api.ts:207-209` | RPTAI-11 · C19 |
| PR-RPT-05 | HIGH | P5 | Lógica de relatórios e handler de IA sem testes | `grep 'modules/reports' em *.test.* → só tests/unit/report-window.test.ts e tests/unit/investment-reporting.test.ts`<br>`functions/src/ai/__tests__/callables.test.ts:38-127 — sem handler` | RPTAI-19 |

#### Notifications

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-NOTIF-01 | HIGH | P5 | Notificações sem limit/paginação, com polling de 30 s e sem retenção; create morto e arquivar negado a member | `src/modules/notifications/api.ts:24-25 — orderBy sem limit`<br>`src/modules/notifications/hooks.ts:16 — refetchInterval 30000` | NOTIF-01, READ-07, NOTIF-03, FEW-16, NOTIF-09 · C17 |

#### Messages

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-MSG-01 | HIGH | P5 | Mensagens é funcionalidade simulada (localStorage/mock) exposta em produção | `src/components/Header.tsx:255-274 — painel exposto`<br>`src/modules/messages/api.ts:148-154 — usuários falsos` | MSG-01, COMM-05 · C18 |

#### AI

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-AI-01 | BLOCKER | P8 | Dados financeiros, comprovantes e transcrições de voz enviados ao Gemini sem base legal, transparência nem contrato/tier comprovado | `functions/src/ai/callables.ts:227-238 — inlineData do documento enviado ao modelo`<br>`src/components/TransactionModal.tsx:686-705 — upload de comprovante` | RPTAI-01, PRIV-05 |
| PR-AI-02 | BLOCKER | P0 | Chave Gemini foi embutida no bundle público no passado; rotação não comprovada (ação externa imediata) | `git show 39806fb:vite.config.ts:14-15 — JSON.stringify(env.GEMINI_API_KEY)`<br>`vite.config.ts:14-19 — comentário confirma exposição anterior` | RPTAI-02 |
| PR-AI-04 | HIGH | P5 | Histórico do chat de IA em localStorage vaza entre workspaces e usuários; não é limpo no logout | `src/modules/reports/hooks.ts:343 — chave sem uid`<br>`src/modules/reports/hooks.ts:348-358 — load não reseta; save grava estado antigo na chave nova` | RPTAI-08, PRIV-06, AUTH-11 |
| PR-AI-05 | MEDIUM | P5 | Saída da IA sem schema forte e contexto forjável pelo cliente (prompt injection) | `functions/src/ai/callables.ts:146-150,223-249`<br>`src/components/TransactionModal.tsx:651-676` | RPTAI-09, RPTAI-10, MONEY-14 · C20 |

#### Billing/Stripe

Nenhum aberto: PR-BILL-01…06 e PR-BILL-08 fechados em P2A (§17.3); PR-BILL-07 fechado em P2B.1 (§17.8).

#### Entitlements/quotas

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-ENT-01 | BLOCKER | P2 | Quotas de plano aplicadas somente no frontend; nenhum entrypoint ou Rule aplica plano/quota (P2A entregou o catálogo e o motor de entitlements; o enforcement é P2B; `usePlan.ts` foi removido) | `src/hooks/usePlan.ts:36-38 — enforcement só no cliente`<br>`src/modules/workspaces/api.ts:196 — workspace criado pelo cliente` | BILL-01, ENTRY-02, WS-05, TX-10, SPLIT-07, FEW-09, INV-03, CC-14, LOAN-15, CR-15, GOAL-08, REC-14 · C01 |

#### Firestore Rules

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-RULES-01 | BLOCKER | P3 (transactions, loans, clients, receivables); P4 (recurring, split) | Dez coleções financeiras adjacentes com escrita livre de member, sem schema e com hard delete | `firestore.rules:1097-1105 — recurring_*`<br>`firestore.rules:1351-1369 — loans, loan_movements, clients, receivables` | RULES-03, FEW-02, FEW-04, TX-02 · C10, C14 |
| PR-RULES-02 | MEDIUM | P6 | Catch-all de leitura em subcoleções libera por padrão qualquer membro (inclusive futuras mensagens privadas) | `firestore.rules:852-877 — lista de negação por prefixo`<br>`firestore.rules:1436-1442 — catch-all read` | RULES-09, MSG-02 |
| PR-RULES-03 | HIGH | P4 | Query do catálogo de settings sem índice composto versionado; renomear item é negado pelas Rules | `src/modules/settings-catalog/api.ts:115-121 — três orderBy sem where`<br>`src/modules/settings-catalog/hooks.ts:61 — consumidor useSettingsCatalog` | READ-02, RULES-12, FEW-12 |

#### App Check

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-APPCHK-01 | HIGH | P6 | App Check ausente no cliente, nas callables e no enforcement de Firestore/Auth | `src/lib/firebase.ts:1-64 — sem initializeAppCheck`<br>`functions/src/shared/runtimeOptions.ts:41-91 — sem enforceAppCheck` | FIRE-03, AUTH-14, ENTRY-03 · C23 |

#### Observability

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-OBS-01 | HIGH | P7 | Sem observabilidade global: console.* não estruturado, erros internos invisíveis, correlationId definido pelo cliente, sem métricas nem alertas | `rg 'firebase-functions/logger' functions/src → 0 ocorrências`<br>`functions/node_modules/firebase-functions/lib/common/providers/https.js:531-532 — só loga o que não é HttpsError; erro convertido em HttpsError não é logado` | FIRE-04, ENTRY-13, ENTRY-16 · C25 |
| PR-OBS-02 | HIGH | P7 | Sem processo de resposta a incidentes (severidades, papéis, contatos) nem mecanismos de contenção (interruptor por funcionalidade, modo somente leitura, revogação de sessão) | `grep revokeRefreshTokens\|checkRevoked\|setCustomUserClaims\|killSwitch\|readOnlyMode em src/ e functions/src: 0 ocorrências`<br>`docs/production/INCIDENT_RESPONSE.md — lacuna registrada na redação de P0` | Lacuna identificada em P0 (sem achado bruto) · C25 |

#### Backup/restore

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-BKP-01 | BLOCKER | P7 | Sem PITR, backups agendados, delete protection ou procedimento de restore do Firestore | `firebase.json:2-7 — só database/location/rules/indexes`<br>`docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:20-25 — ordem canônica sem backup` | FIRE-02 · C24 |

#### Firebase platform

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-PLAT-01 | BLOCKER | P6 | Sem isolamento DEV/STAGING/PROD: o projeto de produção é o ambiente de desenvolvimento e alvo fixo de todo deploy | `.firebaserc:3 — default: sistema-financeiro-pesso-20698 (único)`<br>`package.json:22-26 — deploy:firestore/functions/safe/hosting/webhook com --project sistema-financeiro-pesso-20698` | FIRE-01, REL-01, REL-03, RULES-14, ENTRY-19 |
| PR-PLAT-02 | BLOCKER | P6 | Utilitário versionado faz hard delete do ledger de investimentos com override para o projeto de produção | `tools/investments/limpar-investimentos.mjs:59 — PROJETO_PRODUCAO`<br>`tools/investments/limpar-investimentos.mjs:88 — OVERRIDE_FLAG` | INV-01, REL-02 |
| PR-PLAT-03 | HIGH | P6 | Hosting sem headers de segurança; recursos de terceiros em runtime (Tailwind Play CDN, Google Fonts, sons do Mixkit) e importmap esm.sh publicado no HTML | `firebase.json:38-57 — headers só com Cache-Control`<br>`index.html:8 — <script src=https://cdn.tailwindcss.com>` | FIRE-06, AUTH-06, PRIV-09, COMM-07 |

#### Privacy/LGPD

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-PRIV-01 | HIGH | P8 | Sem canal do titular, identificação do controlador/encarregado e divulgação de subprocessadores/transferência internacional | `grep -rniE 'mailto\|suporte@\|contato@\|encarregado\|\bdpo\b' src index.html — zero`<br>`src/components/auth/LoginView.tsx:50-52 — rodapé sem contato` | PRIV-04, PRIV-05 · C26 |

#### Landing/commercial/legal

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-COMM-01 | HIGH | P9 | Sem landing pública, preços públicos, rodapé institucional ou rotas públicas | `src/App.tsx:686-690 — !user → LoginView`<br>`src/App.tsx:642 — PricingTable só autenticado` | COMM-01, COMM-06 |
| PR-COMM-02 | BLOCKER | P9 | Sem política de cancelamento/arrependimento e sem identificação do fornecedor | `functions/src/webhooks/stripe.ts:60 — único evento tratado`<br>`grep billingPortal\|customer.subscription em functions/src e src — zero` | COMM-02 |
| PR-COMM-03 | HIGH | P9 | Recursos anunciados sem implementação real (convites, Mensagens) e modal de pagamento aprovado sem confirmação | `src/components/SettingsView.tsx:673 — 'Convide pessoas, gerencie permissões'`<br>`src/components/MembersManagerModal.tsx:53-63 — fakeUid = e-mail sem símbolos` | COMM-05, COMM-04, BILL-10 · C18 |

#### Admin capabilities

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-ADMIN-01 | HIGH | P7 | Nenhuma capacidade administrativa/suporte server-side; identidade admin via campo Firestore lido no cliente; painel placeholder | `src/contexts/AuthContext.tsx:55-61 — isAdmin via getDoc no cliente`<br>`grep setCustomUserClaims\|platformAdmin\|impersonat — zero` | ADMIN-02, ADMIN-01, AUTH-09 · C21 |

#### CI/release process

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-REL-01 | HIGH | P6 | Sem pipeline de CD, proteção de branch, versionamento de release ou rollback testado; deploy manual da estação | `.github/workflows/quality-gate.yml — nenhum job de deploy`<br>`package.json:23,25,26 — deploy:functions/hosting/webhook sem Emulator` | REL-04, REL-06, REL-13 |
| PR-REL-02 | HIGH | P3 | Domínios com escrita financeira pelo cliente sem nenhum teste (Rules de escrita, integração, unit, E2E) | `firestore.rules:1351-1402 — allow write: canMemberWriteWorkspaceScopedData (inclui delete)`<br>`firestore.rules:1097-1105 — recurring com write liberado` | REL-07, RULES-15 |

#### Representação monetária

Nenhum item aberto. PR-MONEY-01 foi fechado em P1 quanto ao módulo e à política e saiu deste registro. A evidência está em §16.4. A adoção por domínio continua nos itens de P3–P5 (§5.25).

#### Documentação

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-DOCS-01 | MEDIUM | P0 | README e documentação operacional contradizem o HEAD | `README.md:13 vs firebase.json:25-58`<br>`README.md:47 vs package.json test:integration:emulator` | DOCS-01, REL-14, FIRE-14 · C22 |

---

## 7. Legado a remover

Inventário do que a política de legado (§1) manda remover quando a arquitetura substituta assumir. Nada disso é removido em P0. As seis linhas de P1 foram removidas em P1, com prova por busca em §16. Os itens de billing removidos em P2A estão marcados abaixo, com prova por busca em §17.3.

| Milestone | Caminho legado / fonte concorrente | Substituto |
| --- | --- | --- |
| P1 | Convite com `fakeUid`; `addMember`/`removeMember`/`updateMemberRole`/`syncUserWorkspaceMembership` no cliente | Callables de convite, aceite, papel e remoção com auditoria |
| P1 | `ensureOwnerMembership` (escrita a cada leitura), query por `ownerId`, fallback `collectionGroup('members')` morto | Índice do usuário mantido pelo backend; `createWorkspace` atômico |
| P1 | Espelho `users/{uid}/workspaces` gravável pelo cliente com `role` usado como `myRole` | Índice `write: false`; papel lido do membership |
| P1 | Regime duplo `ownerId` × membership (`isWorkspaceOwnerByParent`, fallback no backend); resolvedores de papel duplicados | Membership ativo como fonte única; módulo único `functions/src/shared` |
| P1 | Campo legado `userId` em workspace; tipos `Workspace` duplicados; placeholders `Owner` e `usuario-sem-email@sistema` | Tipo único; dados do token verificado |
| P1 | Provisionamento preguiçoso no cliente (`seedLegacySettingsCatalog` a cada seleção, onboarding após create) | Provisionamento idempotente no `bootstrapAccount`/`createWorkspace` |
| P2 (removido em P2A) | `src/constants/plans.ts`, `src/hooks/usePlan.ts` e `functions/src/callables/billing.ts` (checkout por `priceId` do cliente, `STRIPE_ALLOWED_PRICE_IDS`); `planId`/`isPro`/`stripe*` em `users/{uid}`; webhook que concedia sempre `pro`; fallbacks `sk_test_placeholder`/`whsec_placeholder`; preço literal `29,90` e `priceId` no frontend | Catálogo versionado no backend (`functions/src/billing/catalog.ts`); estado único `billing_accounts/{uid}`. Prova: busca sem ocorrências em `src/`, `functions/src/`, `tests/`, `e2e/` e `firestore.rules` de `isPro`, `constants/plans`, `usePlan`, `priceId`/`price_`/`29,90` (só `src/`) e dos placeholders e de `STRIPE_ALLOWED_PRICE_IDS` fora de testes negativos (§17.3) |
| P2 (P2B) | `checkLimit` como única aplicação de limites (hoje só ajuda de UX) | Enforcement server-side nas callables (API de quota); a UI só exibe. **P2B.1:** `checkLimit` removido; workspaces próprios e membros aplicados no servidor; a UI usa `checkAccountLimit` (conta) e `checkWorkspaceLimit` (workspace) só como ajuda de UX; lançamentos e grupos em P3/P4 (§17.8) |
| P3 | Escrita de `transactions` pelo cliente (`addDoc`/`writeBatch`/`updateDoc`) e campo `value` float | Callables de caixa em `amountCents` |
| P3 | CRUD de loans, loan_movements, clients e receivables no cliente; `deleteLoan`/`deleteClient` em cascata | Callables transacionais; cancelamento/arquivamento |
| P4 | Tipo `parcelado` com `cardId` em `transactions`; camada `src/modules/credit-cards/compatibility`; fallback de limite por transações | Somente `credit_card_*` e `invoice_views` |
| P4 | CRUD e delete de `credit_cards` pelo cliente; `writeStrategy.ts` divergente no frontend; arquivos `manual*Test.ts` no bundle | Callables de cadastro/arquivamento; remoção do código de teste do deploy |
| P4 | Geração manual de recorrência no cliente; ocorrência por mês; `recurring_*` graváveis | Callables + cron; ocorrência por data |
| P4 | Split client-authoritative; `parseInt(cartaoId)`; parcelas legadas no cliente | Módulo `splitBills` backend usando caixa e cartões |
| P4 | Fallback `type 'investimento'` sem metadata; grupo `investment_type`; leitura de aportes pelo espelho em `transactions` | Projeções oficiais de investimentos |
| P5 | Progresso de metas PJ no cliente; campos de progresso duplicados (float + centavos) | Projeção única em centavos |
| P5 | Relatórios agregados no navegador; alertas em memória; `markAlertAsRead` com `console.log` | `getFinancialReport` e alertas persistidos |
| P5 | `createNotification` morto no cliente; estado de lido compartilhado; hard delete de notificação | Escrita só backend; estado por usuário; TTL |
| P5 | Messages simulado em localStorage | Remoção ou backend real (D-09) |
| P5 | Histórico do chat de IA em localStorage; contexto montado pelo cliente | Contexto e histórico server-side |
| P6 | Login E2E com credenciais fixas no `AuthContext`; `dist/` compartilhado com build E2E | Módulo de teste isolado/custom token do Emulator; build por ambiente |
| P6 | Tailwind Play CDN, importmap `esm.sh`, Google Fonts e sons do Mixkit carregados de terceiros, entrypoint duplicado `index.tsx` na raiz | Tailwind compilado, dependências empacotadas, fontes e sons auto-hospedados, `src/main.tsx` |
| P6 | Ferramenta `tools/investments/limpar-investimentos.mjs` com override para produção | Remoção ou restrição a Emulator/DEV |
| P6 | Scripts `serve`, `shell`, `start`, `deploy` e `logs` de `functions/package.json` sem `--project` (caem no projeto padrão, que é produção) | Scripts por ambiente explícito, ou remoção em favor dos scripts da raiz com `minhas-financas-local` |
| P7 | Observabilidade duplicada por módulo (`creditCards/observability.ts`, `investments/observability.ts`) | Logger e métricas compartilhados |
| P7 | Trilhas de auditoria separadas por domínio (`goal_audit_logs`, `credit_card_audit_logs`, eventos em `investment_event_logs`, `activity_logs`) e eventos operacionais (`processing_failure`, `reconciliation_warning`) misturados em `financial_events` | Trilha de auditoria append-only unificada e eventos operacionais separados, conforme OBSERVABILITY.md |
| P7 | `AdminDashboard` placeholder e `isAdmin` lido no cliente | Custom claim e callables administrativas auditadas, ou remoção (D-10) |

---

## 8. Milestones

Cada milestone termina somente com: testes direcionados verdes, remoção provada do legado substituído, plano atualizado com evidências, `regression-release-gate` em `PASS` e `PASS` das skills de domínio exigidas pela superfície tocada. As listas de skills abaixo são o mínimo; prevalece a tabela de `regression-release-gate` pela superfície efetivamente tocada, e cada skill avalia o escopo definido em sua seção "Escopo da avaliação" (quando houver).

### P0 — Fundação e documentação
- **Objetivo:** organizar instruções, skills, documentação e plano a partir de auditoria do HEAD, sem mudança funcional.
- **Escopo:** `CLAUDE.md` global; revisão das skills existentes; skill `ptbr-product-ui-review` instalada; cinco skills novas; `docs/production/`; proteções do harness contra deploy/merge/produção; correção do README (PR-DOCS-01).
- **Ação externa imediata (fora do repositório):** rotacionar a chave Gemini e registrar a evidência (PR-AI-02).
- **Saída:** §14.

### P1 — Auth, workspaces, RBAC e ciclo de vida de conta
- **Objetivo:** identidade e autorização autoritativas no backend e kernel compartilhado para os milestones seguintes.
- **Kernel (D-ORD-02):** resolvedor único de membership/papel relido dentro da transação, sem fallback `ownerId`; wrapper de callable (autenticação, política de `email_verified`, Zod estrito com IDs sem `/`, rate limit, idempotência, mapeador de erros pt-BR, ponto de extensão para App Check; sem consulta a plano, quota ou entitlement, que P2 acrescenta — D-01); gravador de auditoria append-only; contrato de logger estruturado e correlation ID; módulo `money` (centavos, parse, alocação por maior resto) espelhado no frontend; política de datas civis em `America/Sao_Paulo`.
- **Domínio:** `bootstrapAccount`, `createWorkspace`, `updateWorkspaceSettings`, convites (token, expiração, e-mail verificado), aceite, revogação, troca de papel, remoção lógica, saída voluntária, transferência de ownership, arquivamento de workspace; Rules `write: false` em `members`, índice do usuário e criação de workspace; suspensão com revogação de sessão; logout limpando estado local.
- **Blockers:** PR-AUTH-03, PR-WS-01…PR-WS-06, PR-MONEY-01 (módulo e política; adoção por domínio em P3–P5). Todos fechados em 2026-09-29 (§16.4).
- **Achados MEDIUM também fechados em P1:** AUTH-08 (política de `email_verified`/provedor), AUTH-09 (suspensão e revogação de sessão no backend; as ferramentas administrativas ficam em PR-ADMIN-01/P7), AUTH-10 (erros de login e de carga em pt-BR), AUTH-11 (logout limpa cache e armazenamento local; a migração do histórico de IA para o servidor fica em PR-AI-04/P5), WS-09, WS-11, WS-13, WS-15.
- **Índice do usuário:** mantém o caminho `users/{uid}/workspaces`, passando a ser gravado só pelo backend (sem renomear a coleção).
- **Depende de decisões:** nenhuma pendente. Tomadas: D-02, D-03, D-04, D-05, D-06, D-16, D-17, D-22, D-34 e D-P1-SUSP (§9.1). P1 **não** depende de D-01 e não contém quota, plano provisório, fallback de entitlement nem motor parcial; P2 adiciona quota/entitlement nas mesmas transações de `createWorkspace`, `inviteWorkspaceMember` e `acceptWorkspaceInvite`.
- **Skills:** `multi-tenant-security-review`, `firestore-scale-cost-review`, `financial-domain-integrity` (módulo `money`), `firebase-production-readiness` (novos exports de Functions), `ptbr-product-ui-review`, `observability-incident-readiness` (contrato de logging e auditoria), `regression-release-gate`.
- **Estado:** ver §16 (execução, evidências, decisões de fechamento e rollback).

### P2 — Billing, entitlements e quotas
- **Objetivo:** ciclo de vida comercial completo e enforcement server-side.
- **Escopo:** catálogo de planos versionado no backend (preço por ambiente, centavos BRL, entitlements); estado de assinatura único gravado só pelo webhook; webhook com `event.id` idempotente, ordem, eventos de assinatura/fatura/reembolso/disputa, grace period e auditoria; checkout sem assinatura duplicada; Customer Portal; segredos sem fallback; função de entitlements; enforcement em workspaces, membros, checkout e IA; API de quota usada pelos callables de P3–P5.
- **Divisão:** P2A (catálogo, estado canônico, checkout, portal, webhook, Rules, frontend) concluída — §17; P2B.1 (API de quota; workspaces próprios, membros com reserva de vaga por convite, transferência de ownership pela capacidade do novo owner; entitlement público do workspace pelo owner; frontend conta × workspace) concluída — §17.8; P2B.2 (créditos de IA por plano do owner com pool do titular, idempotência por chave, teto de saída por chamada; contenção de transação como `aborted`) concluída — §17.9; P2C (gate de P2 em ambiente limpo) pendente.
- **Blockers:** PR-BILL-01…PR-BILL-08, PR-AI-03; PR-ENT-01 parcial (fecha em P5, D-ORD-05). Fechados em P2A: PR-BILL-01…06 e PR-BILL-08 (§17.3); em P2B.1: PR-BILL-07 (§17.8); em P2B.2: PR-AI-03 (§17.9). Aberto: PR-ENT-01 (P3–P5).
- **Depende de decisões:** D-01 e D-08 (parcial) tomadas em §9.2; D-07 e D-11 não bloqueiam P2 (§9.2).
- **Configuração externa:** E-06 (sem conferência; obrigatória para fechar P2).
- **Skills:** `billing-entitlement-integrity`, `multi-tenant-security-review`, `firestore-scale-cost-review`, `firebase-production-readiness` (segredos e exports), `observability-incident-readiness` (auditoria e falhas de webhook), `ptbr-product-ui-review`, `saas-commercial-readiness` (checkout e cancelamento no produto), `regression-release-gate`.
- **Estado:** ver §17

### P3 — Caixa autoritativo, Empréstimos e Clientes/Recebíveis
- **Objetivo:** tornar o caixa autoritativo no backend e levar empréstimos e recebíveis para operações atômicas sobre ele (D-ORD-01).
- **Escopo:** callables de lançamento, edição e anulação de `transactions` em `amountCents`, com evento append-only e trilha de auditoria; Rules `write: false` para `transactions`; espelhos de outros domínios protegidos; fórmula de caixa única; retry idempotente e cerca de versão na projeção; domínio de empréstimos no backend; domínio de clientes/recebíveis no backend com recebimento que gera a receita na mesma transação; remoção do write path do cliente e dos campos float; testes de Rules de escrita, integração, concorrência e E2E dos fluxos.
- **Blockers:** PR-TX-01…PR-TX-05, PR-LOAN-01…PR-LOAN-07, PR-CR-01…PR-CR-04, PR-RULES-01 (transactions, loans, clients, receivables), PR-REL-02 (esses domínios).
- **Depende de decisões:** D-12, D-13, D-16, D-17, D-24, D-29, D-30, D-35, D-38, D-39.
- **Skills:** `financial-domain-integrity`, `multi-tenant-security-review`, `firestore-scale-cost-review`, `ptbr-product-ui-review`, `billing-entitlement-integrity` (quotas), `regression-release-gate`.

### P4 — Convergência de Recorrentes, Divisão de contas, Cartões e Transações
- **Objetivo:** uma única fonte de verdade para cartões e caixa, com recorrentes e divisão de contas usando os domínios autoritativos.
- **Escopo:** cadastro de cartão por callables com arquivamento; centavos; idempotência estável por intenção; cron de faturas com releitura transacional e cursor; máquina de estados de fatura; consultas de fatura corretas; índices ausentes; recorrentes por callables/cron com ocorrência por data e compra via domínio de cartões; módulo backend de divisão de contas; remoção do tipo `parcelado`, da camada de compatibilidade de cartões e dos fallbacks de investimento em `transactions`; índice e Rules do catálogo.
- **Blockers:** PR-CC-01…PR-CC-08, PR-REC-01…PR-REC-06, PR-SPLIT-01…PR-SPLIT-07, PR-TX-06, PR-INV-01, PR-RULES-01 (recurring, split), PR-RULES-03.
- **Depende de decisões:** D-12, D-14, D-15, D-17, D-23, D-36.
- **Skills:** as mesmas de P3.

### P5 — Metas, Relatórios, Notificações, Mensagens e IA
- **Objetivo:** módulos adjacentes lendo apenas projeções oficiais, sem agregação no navegador nem funcionalidades simuladas.
- **Escopo:** correções de metas e projeção única; `getFinancialReport` server-side; alertas persistidos; notificações com `limit`, cursor, TTL e estado de leitura por usuário; decisão e execução sobre Mensagens; IA com contexto montado no servidor, `responseSchema` + Zod, histórico fora do localStorage, modelo e SDK suportados; fechamento de PR-ENT-01 com quotas em todos os callables.
- **Blockers:** PR-GOAL-01…PR-GOAL-04, PR-RPT-01…PR-RPT-05, PR-NOTIF-01, PR-MSG-01, PR-AI-04, PR-AI-05, PR-ENT-01.
- **Dependência:** se D-09 decidir implementar Mensagens, a remoção do catch-all de leitura (PR-RULES-02) é antecipada de P6 para P5, antes de existir qualquer dado privado de mensagem.
- **Depende de decisões:** D-09, D-11, D-18, D-31, D-37.
- **Skills:** `financial-domain-integrity`, `firestore-scale-cost-review`, `ptbr-product-ui-review`, `privacy-lgpd-data-lifecycle` (IA), `regression-release-gate`.

### P6 — Hardening Firebase e segurança
- **Objetivo:** plataforma pronta para produção.
- **Escopo:** projetos DEV/STAGING/PROD isolados com aliases e sem produção como default; App Check no cliente e enforcement em callables, Firestore e Auth; Hosting com CSP/HSTS/`frame-ancestors`/demais headers (com `Permissions-Policy` compatível com a decisão sobre entrada por voz, D-11), Tailwind compilado, fontes e sons auto-hospedados e sem `esm.sh` (com prova de paridade visual por screenshot); login E2E fora do bundle de produção e artefato por ambiente; remoção/restrição da ferramenta destrutiva; fim do catch-all de leitura; service accounts de privilégio mínimo; segredos por ambiente e fail-closed; TTL versionado; pipeline de CD com aprovação, proteção de branch e rollback.
- **Blockers:** PR-PLAT-01…PR-PLAT-03, PR-APPCHK-01, PR-AUTH-04, PR-RULES-02, PR-REL-01.
- **Depende de decisões:** D-19, D-20, D-33.
- **Configuração externa:** E-01…E-05, E-12.
- **Skills:** `firebase-production-readiness`, `multi-tenant-security-review`, `ptbr-product-ui-review` (paridade visual), `regression-release-gate`.

### P7 — Observabilidade, auditoria, backup, incidentes e admin
- **Objetivo:** operar, investigar e recuperar.
- **Escopo:** logger estruturado global e correlation ID de servidor; métricas e alertas versionados; trilhas de auditoria consolidadas; jobs de reconciliação financeira com alerta; fila e replay de falhas de webhook; PITR, backups agendados, delete protection e restore ensaiado em STAGING; resposta a incidentes e DR com RTO/RPO; capacidades administrativas com custom claim e auditoria (ou remoção do painel).
- **Blockers:** PR-OBS-01, PR-OBS-02, PR-BKP-01, PR-ADMIN-01.
- **Depende de decisões:** D-10, D-21, D-25, D-27, D-28, D-32.
- **Configuração externa:** E-07, E-08.
- **Skills:** `observability-incident-readiness`, `firebase-production-readiness`, `regression-release-gate`.

### P8 — Privacidade/LGPD e ciclo de vida de dados
- **Objetivo:** atender direitos do titular e obrigações de transparência sobre o modelo de dados final.
- **Escopo:** inventário de dados pessoais; exclusão de conta e de workspace com anonimização e retenções legais, incluindo tombstone do documento-pai para impedir recriação/tomada de workspace excluído (RULES-06); exportação; canal do titular; registro server-side de aceite e consentimentos (consumido pelo cadastro em P9); política de retenção implementada; subprocessadores e transferência internacional; minimização dos dados enviados à IA e a terceiros; dados de terceiros (clientes, contrapartes, participantes).
- **Blockers:** PR-AUTH-01, PR-CR-05, PR-AI-01, PR-PRIV-01.
- **Depende de decisões:** D-07, D-11, D-18, D-24, D-26.
- **Configuração externa:** E-09, E-10.
- **Skills:** `privacy-lgpd-data-lifecycle`, `multi-tenant-security-review`, `regression-release-gate`.

### P9 — Cadastro, landing, preços, páginas legais e prontidão comercial
- **Objetivo:** funil público verdadeiro e completo.
- **Escopo:** rotas públicas (landing, preços, termos, privacidade, cookies, contato) servidas pelo Hosting; preços lidos do catálogo do backend; aceite versionado no cadastro; cancelamento e arrependimento; rodapé institucional; SEO técnico; acessibilidade do funil; remoção de qualquer afirmação sobre recurso inexistente.
- **Blockers:** PR-AUTH-02, PR-COMM-01…PR-COMM-03.
- **Depende de decisões:** D-08, D-21, D-22, D-26.
- **Configuração externa:** E-10, E-11.
- **Skills:** `saas-commercial-readiness`, `ptbr-product-ui-review`, `privacy-lgpd-data-lifecycle`, `billing-entitlement-integrity`, `regression-release-gate`.

### P10 — Auditoria adversarial e gate completo de produção
- **Objetivo:** provar prontidão.
- **Escopo:** repetição integral desta auditoria sobre o HEAD final (mesma metodologia da §3); varredura de segurança; todas as skills em `PASS`; ensaio completo em STAGING (deploy por CD, restore, rollback, replay de webhook, drill de incidente); teste de carga e custo; [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) assinado.
- **Saída:** registro §6 sem BLOCKER/HIGH abertos e todos os itens EXTERNAL com evidência.

---

## 9. Decisões de ordenação e escopo (tomadas em P0)

| ID | Decisão | Justificativa (evidência) |
| --- | --- | --- |
| D-ORD-01 | A autoridade de `transactions` (caixa) sai de P4 e passa a abrir P3. P4 mantém a convergência de cartões, recorrentes e divisão e a remoção do `parcelado`. | Empréstimos e recebíveis exigem gravar movimento e caixa na mesma transação de backend (PR-LOAN-03, PR-CR-03); hoje só o cliente grava `transactions` (`src/modules/transactions/api.ts:257-311`). Fazer P3 antes de ter um escritor de caixa no backend obrigaria a criar um caminho provisório e depois removê-lo. |
| D-ORD-02 | P1 inclui o kernel compartilhado do backend (autorização, wrapper, idempotência, auditoria, logger/correlação, dinheiro, datas). | Todos os milestones seguintes criam callables. Hoje há dois resolvedores de papel (`functions/src/creditCards/auth.ts:73-79`, `functions/src/investments/infrastructure.ts:189-194`), 12 cópias de `normalizeMoney` (MONEY-11) e nenhum logger estruturado (FIRE-04). Construir sem o kernel gera retrabalho em cada domínio. |
| D-ORD-03 | Exclusão e exportação de conta/workspace ficam em P8, não em P1. P1 entrega bootstrap, perfil, suspensão e revogação. | A exclusão precisa percorrer todos os domínios financeiros com seu modelo final (P3–P5) e respeitar retenções legais; implementá-la antes geraria uma cascata sobre schemas que serão substituídos. |
| D-ORD-04 | O isolamento de ambientes permanece em P6, com a regra: nenhum artefato de P1–P5 é implantado em projeto remoto antes do fechamento de P6. Toda validação até lá é feita no Emulator. | Não há dados reais; o risco de manter o isolamento em P6 é só de deploy acidental, mitigado pelas negações do harness (`.claude/settings.json`) e pela proibição em `CLAUDE.md`. |
| D-ORD-05 | PR-ENT-01 fecha de forma incremental: P2 entrega o motor de entitlements e o enforcement em workspaces, membros, checkout e IA; P3–P5 aplicam a quota em cada callable novo; o item fecha ao final de P5. | Quotas de lançamentos, grupos e recebíveis dependem de callables que só existirão em P3–P5. |
| D-ORD-06 | A rotação da chave Gemini (PR-AI-02) é ação externa imediata, independente de milestone. | Exposição histórica no bundle público (`vite.config.ts:14-19` documenta a remoção); não há evidência de rotação. |

### 9.1 Decisões de produto tomadas para P1

| ID | Decisão | Consequência |
| --- | --- | --- |
| D-02 | Mantém `viewer`. Papéis: owner/admin/member/viewer; `viewer` é estritamente somente leitura. | As matrizes de permissão financeira das callables existentes não mudam em P1 (`viewer` continua recusado onde hoje é recusado). |
| D-03 | Exatamente um owner canônico ativo por workspace. `workspace.ownerId` é campo apenas desnormalizado. | `ownerId` nunca é fonte de autorização nem fallback; só `bootstrapAccount`/`createWorkspace` (criação) e `transferWorkspaceOwnership` o alteram. A autorização vem sempre de `workspaces/{id}/members/{uid}` ativo. |
| D-04 | OWNER: convida admin/member/viewer; promove e rebaixa entre admin/member/viewer; remove admin/member/viewer; transfere ownership; não se remove, não sai nem se rebaixa enquanto owner. ADMIN: convida só member/viewer; alterna member↔viewer; remove member/viewer; não cria admin, não promove a admin, não rebaixa nem remove outro admin e não toca o owner. MEMBER e VIEWER: sem gestão de membros. | Ninguém altera o próprio papel; saída voluntária só por `leaveWorkspace` (o owner transfere antes). |
| D-05 | Convite por link com token opaco CSPRNG de 256 bits, URL-safe (base64url), válido por 7 dias, de uso único e vinculado ao e-mail normalizado; o convite pode existir antes de o destinatário ter conta. | Persiste-se só o SHA-256 do token, sem pepper; o token nunca aparece em logs. Resposta genérica em pt-BR para token inválido, expirado, revogado ou de outro e-mail (sem enumeração). Sem fakeUid; membership criado só no aceite, com `request.auth.uid`. O envio real de e-mail depende de E-11 e não é simulado em P1 (sem envio mock nem mensagem de "e-mail enviado"). No Emulator, o fluxo é testado por um seam exclusivo de teste, fora do bundle e dos exports de produção. |
| D-06 | Login só com Google (sem e-mail/senha, sem Apple, sem redesign do login). E-mail verificado (`email_verified`) exigido em convites e mutações sensíveis: `createWorkspace`, `inviteWorkspaceMember`, `acceptWorkspaceInvite`, `revokeWorkspaceInvite`, `changeWorkspaceMemberRole`, `removeWorkspaceMember`, `transferWorkspaceOwnership`, `archiveWorkspace`. Não exigido em `bootstrapAccount`, `updateWorkspaceSettings` e `leaveWorkspace`. | `transferWorkspaceOwnership` e `archiveWorkspace` exigem autenticação recente (`auth_time` nos últimos 10 minutos); o frontend reautentica com Google só quando necessário. Sem MFA para usuários comuns; MFA administrativa fica em P7 (E-03). |
| D-P1-SUSP | `users/{uid}.status` é server-owned (`active` \| `suspended`); o backend recusa conta suspensa em toda callable. | Mecanismo interno via Admin SDK: grava o status, desativa o usuário no Auth, executa `revokeRefreshTokens` e prepara o registro de auditoria para P7. A superfície administrativa (painel/ferramentas) fica em P7 (PR-ADMIN-01). |
| D-16 | Somente BRL. | Sem multimoeda; o `Workspace.currency` gravável e ignorado deixa de ser aceito do cliente. |
| D-17 | Datas civis em `America/Sao_Paulo`. | Nunca derivar data civil com `toISOString()`. A política entra no kernel de P1; a adoção por domínio segue em P3–P4. |
| D-22 | Workspaces PF e PJ podem ter membros. | CNPJ opcional; se informado, formato e dígitos verificadores são validados; não é globalmente único. |
| D-34 | Centavos inteiros; frações abaixo do centavo recusadas na entrada; `Number.isSafeInteger`. | Divisão pelo maior resto; as partes sempre somam exatamente o total; empates resolvidos pelo menor índice primeiro. |

D-01 foi removida das dependências de P1 e tomada depois, no início de P2 (§9.2). P1 não cria quota, plano provisório, fallback de entitlement nem motor parcial. P2 adiciona o enforcement de quota/entitlement dentro das mesmas transações de `createWorkspace`, `inviteWorkspaceMember` e `acceptWorkspaceInvite` antes de qualquer deploy remoto; nada de P1 é implantado antes do fechamento de P6 (D-ORD-04).

### 9.2 Decisões de produto tomadas para P2

Tomadas em 2026-09-29, no início de P2A.

| ID | Decisão | Consequência |
| --- | --- | --- |
| D-01 | A assinatura pertence à conta do owner (`billing_accounts/{uid}`, uid = titular/billing owner). O owner financia os workspaces de que é owner; o convidado não precisa de plano pago; o plano do owner determina os entitlements do workspace. A transferência de ownership respeitará a capacidade do novo owner. | Só o titular contrata e gere a própria assinatura e lê o próprio billing. Não há estado de billing por workspace. O enforcement (workspaces próprios ativos, membros ativos por workspace, capacidade do novo owner) é P2B. |
| D-08 | Catálogo em centavos BRL, cobrança mensal, sem trial (o Free substitui o trial). FREE 0: 1 workspace próprio ativo, 2 membros ativos por workspace (incl. owner), 50 lançamentos/mês, 2 grupos, 10 créditos de IA/mês. PRO 2990: 5 / 10 / 1.000 / 10 / 150. BUSINESS 5990: 20 / 50 / 10.000 / 100 / 750. Cancelamento no fim do período pago; grace de 7 dias em `past_due`. Downgrade nunca apaga dados; o excedente após downgrade bloqueia só novas operações sujeitas à quota. Sem reembolso automático em P2; arrependimento e reembolso jurídico em P9. Fonte: `functions/src/billing/catalog.ts` (`BILLING_CATALOG_VERSION = 1`). | Parcialmente tomada. Pendentes: tratamento fiscal (NFS-e/ISS, Stripe Tax), meios além de cartão, plano anual, proration e momento do downgrade configurados no portal (P9/E-06). Mudança de preço exige novo Price; como a concessão usa só o Price configurado, trocar a configuração tira o plano de quem está no Price antigo. Por isso o catálogo v1 não muda de preço até existir suporte a Prices legados por plano. |
| D-07 | Não bloqueia P2. | Exclusão de conta (destino dos workspaces, cancelamento da assinatura, retenção fiscal × LGPD) fica em P8. |
| D-11 | Não bloqueia P2. | IA com créditos provider-agnostic no catálogo (`aiCreditsPerMonth`); provedor e tier contratual em P5. |

---

## 10. Decisões pendentes (DECISION)

| ID | Decisão | Bloqueia | Opções levantadas pela auditoria |
| --- | --- | --- | --- |
| D-07 | Exclusão de conta: destino de workspaces próprios e compartilhados, retenção fiscal × eliminação LGPD, anonimização do ator em histórico compartilhado | P8 | Resolver o conflito entre "sem hard delete de histórico" e eliminação a pedido. |
| D-08 | Parcialmente tomada (§9.2); pendente: tratamento fiscal (NFS-e/ISS, Stripe Tax), meios além de cartão, plano anual, proration e momento do downgrade configurados no portal, suporte a Prices legados por plano | P9 | Catálogo v1 em `functions/src/billing/catalog.ts`. |
| D-09 | Mensagens: remover do produto até existir backend real, ou implementar | P5 | A auditoria recomenda remover no lançamento (funcionalidade simulada exposta). Remover altera a UI e exige aprovação. |
| D-10 | Painel administrativo: implementar com custom claim e callables auditadas, ou remover | P7 | — |
| D-11 | IA: provedor e tier contratual (Vertex AI × chave AI Studio), minimização do payload, consentimento, quotas por plano, envio de comprovantes e voz | P5, P8 | Modelo atual é preview com SDK legado (FIRE-11). |
| D-12 | Recorrentes: frequências suportadas; cobrança no cartão automática no vencimento ou por confirmação | P3, P4 | Hoje semanal/quinzenal perdem cobranças. |
| D-13 | Empréstimos: modelos de amortização (Price, SAC, simples), juros, diferenças PF/PJ classificação contábil do principal (hoje gravado como receita/despesa de consumo) e obrigatoriedade de lançamento de caixa na contratação | P3 | — |
| D-14 | Divisão de contas: participantes precisam ser membros do workspace? participantes externos; fluxo de reembolso PJ | P4 | — |
| D-15 | Investimentos: manter ou remover as 13 callables e a UI profissional sem ponto de montagem | P4 | Política de legado favorece remover se o produto não as oferece. |
| D-18 | Prazos de retenção por categoria (conta, dados financeiros, dados de terceiros, logs, auditoria, backups, pós-cancelamento) | P5, P8 | Validar com jurídico. |
| D-19 | Mapeamento de ambientes: o projeto atual `sistema-financeiro-pesso-20698` vira DEV/STAGING e cria-se um PROD novo, ou o contrário | P6 | O código e os documentos já tratam o projeto atual como desenvolvimento; ele contém apenas dados de teste. |
| D-20 | Troca do Tailwind Play CDN por Tailwind compilado, com critério de paridade visual | P6 | Risco de alteração visual; exige comparação por screenshot. |
| D-21 | Identidade jurídica do fornecedor (razão social, CNPJ, endereço), encarregado de dados e canal de suporte | P7, P9 | Necessário para rodapé, páginas legais e LGPD. |
| D-23 | Catálogo de configurações (`settings_catalog`): escrita por callables ou mantida no cliente com Rules estritas (schema, sem delete) | P4 | Hoje o cliente grava e o renomear é negado pelas Rules (PR-RULES-03); a escolha define se o catálogo entra no kernel de callables. |
| D-24 | Visibilidade de dados pessoais de clientes (CPF/CNPJ, e-mail, telefone) por papel: todos os membros ou só owner/admin | P3, P8 | Hoje qualquer membro vê (CR-07). |
| D-25 | Monitoramento de erros do frontend: serviço de terceiro (novo subprocessador) ou coleta própria via backend | P7 | Afeta SUBPROCESSORS.md e a política de privacidade. |
| D-26 | Política de cookies e armazenamento local: necessidade de banner/CMP conforme o inventário final de trackers | P8, P9 | Hoje não há analytics; há armazenamento local de chat de IA, preferências e sessão do Firebase Auth. |
| D-27 | RPO e RTO por serviço (Firestore, Functions, Auth, Stripe), política de backup (frequência, retenção, export para projeto/bucket isolado), janela de PITR compatível e periodicidade do ensaio de restore | P7 | Base para BACKUP_RESTORE_DR.md e para o exercício de restore. |
| D-28 | Stack de observabilidade (Cloud Logging/Monitoring nativos ou ferramenta adicional), escala de plantão e SLOs/limiares dos alertas | P7 | Define a tabela de alertas de OBSERVABILITY.md e o processo de INCIDENT_RESPONSE.md. |
| D-29 | Regime de caixa × competência e semântica única de saldo (efeito de `isPaid`, pendentes, anulados) | P3 | Hoje o backend ignora `isPaid` e o cliente zera não pagas (MONEY-02). |
| D-30 | Contas/carteiras e transferências entre contas como tipo de movimento próprio | P3 | Não existe tipo de transferência (`src/types.ts:44`). |
| D-31 | Metas: semântica de `progressBasis current_value` e das metas KPI PJ | P5 | Ver PR-GOAL-01 e PR-GOAL-03. |
| D-32 | Tempos de resposta por severidade, página de status e acesso de emergência (break-glass) | P7 | Base de INCIDENT_RESPONSE.md. |
| D-33 | Rollout do App Check: período de monitoramento, ordem de enforcement (Functions, Firestore, Auth) e critério de rollback | P6 | Ver FIREBASE_PRODUCTION.md. |
| D-35 | Correção de lançamento: edição livre, estorno + novo lançamento, ou bloqueio após fechamento de período | P3 | Define a trilha de auditoria de PR-TX-05. |
| D-36 | Casos de borda de cartão: compra retroativa em ciclo fechado, pagamento antecipado, estorno de compra parcelada, fechamento automático de fatura, ajuste manual (`manual_adjustment`) e conta de origem do pagamento | P4 | Define a máquina de estados de PR-CC-05. |
| D-37 | Definição e regime dos KPIs de relatório (ex.: taxa de poupança, lucro líquido PJ) | P5 | Base de `getFinancialReport` (PR-RPT-02, PR-RPT-03). |
| D-38 | Via única de atualização da projeção de caixa: no commit da callable ou por gatilho com retry idempotente | P3 | Fecha PR-TX-04. |
| D-39 | Recebíveis: recebimento parcial, juros, multa e desconto | P3 | Define o contrato de `receiveReceivable` (PR-CR-03). |

---

## 11. Configuração externa necessária (EXTERNAL CONFIGURATION REQUIRED)

Nenhum destes itens pode ser verificado pelo repositório. Cada um precisa de registro em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) ou no documento indicado, com valor esperado, estado verificado, data e responsável.

| ID | Item | Onde registrar |
| --- | --- | --- |
| E-00 | **Imediato:** rotacionar a chave Gemini exposta no passado e revogar a anterior | [SECURITY_MODEL.md](SECURITY_MODEL.md) |
| E-01 | Projetos Firebase/GCP DEV, STAGING e PROD; aliases em `.firebaserc`; faturamento Blaze por projeto | [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) |
| E-02 | App Check: chave reCAPTCHA Enterprise por ambiente, registro do app e enforcement em Firestore, Functions e Auth | [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) |
| E-03 | Authentication: provedores, domínios autorizados sem `localhost` em PROD, proteção contra enumeração, templates pt-BR, tela de consentimento OAuth, MFA para admins | [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) |
| E-04 | IAM: service accounts de privilégio mínimo, MFA humano, sem chaves baixadas, Workload Identity Federation para CD | [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) |
| E-05 | Secret Manager por ambiente (Stripe, webhook, IA, origens permitidas) e política de rotação | [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) |
| E-06 | Stripe: produtos e preços test/live, endpoint de webhook, eventos habilitados, versão da API, Customer Portal, impostos | [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md) |
| E-07 | Firestore PROD: PITR, backups agendados com retenção, delete protection, políticas de TTL | [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md) |
| E-08 | Cloud Monitoring/Logging: políticas de alerta, canais, retenção de logs e sinks; budget com alertas | [OBSERVABILITY.md](OBSERVABILITY.md) |
| E-09 | Jurídico: Política de Privacidade, Termos, Cookies, bases legais, DPAs com subprocessadores, mecanismo de transferência internacional, encarregado | [PRIVACY_LGPD.md](PRIVACY_LGPD.md), [SUBPROCESSORS.md](SUBPROCESSORS.md) |
| E-10 | Termos do provedor de IA quanto a retenção e treinamento; contratação de tier adequado | [SUBPROCESSORS.md](SUBPROCESSORS.md) |
| E-11 | Domínio próprio, TLS no Hosting, e-mail transacional com SPF/DKIM/DMARC, registro de marca | [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) |
| E-12 | GitHub: proteção de `main`, checks obrigatórios, environments com aprovação para deploy | [RUNBOOKS.md](RUNBOOKS.md) |

---

## 12. Riscos e rollback

| ID | Risco | Mitigação |
| --- | --- | --- |
| R-01 | O único projeto Firebase é ao mesmo tempo desenvolvimento e alvo fixo de todos os scripts `deploy:*`. Um deploy acidental publica código ou Rules em fase intermediária. | Negações em `.claude/settings.json` (deploy, merge, push, ferramentas MCP de escrita e de exclusão; demais ferramentas MCP do Firebase exigem confirmação); proibição em `CLAUDE.md`; D-ORD-04; P6. |
| R-02 | Trocar Rules para `write: false` antes de existir o callable correspondente quebra fluxos da UI. | Cada domínio troca Rules e UI no mesmo milestone, com E2E do fluxo real antes e depois. |
| R-03 | Remover legado sem migração deixa dados de teste do projeto atual incompatíveis. | Não há dados reais; ambientes são ressemeados. Scripts de limpeza recusam produção. |
| R-04 | Compilar o Tailwind muda a aparência da UI autenticada. | Comparação por screenshot antes/depois em viewports mobile e desktop (skill `ptbr-product-ui-review`). |
| R-05 | Itens jurídicos (LGPD, CDC, comércio eletrônico) exigem parecer externo. | As skills tratam a ausência de validação jurídica registrada como `FAIL`. |
| R-06 | Chave Gemini exposta no passado ainda válida. | E-00. |
| R-07 | Auditoria feita por agentes pode conter imprecisões pontuais. | Cada milestone reconfirma no código os itens que vai fechar (regra de leitura no topo). |

**Rollback de P0:** P0 altera somente documentação, skills, `CLAUDE.md`, `README.md` e `.claude/settings.json`. Reverter o commit de P0 restaura o estado anterior sem efeito no produto.

**Rollback de P1:** nada de P1 é implantado antes de P6 (D-ORD-04), então o rollback é só de código: reverter os commits de P1 restaura callables, Rules e frontend anteriores. Não há migração de dados: workspaces de teste são recriados por `bootstrapAccount`/`createWorkspace` ou pelas sementes do Emulator. Reverter parcialmente (por exemplo, só o provisionamento) exige reverter também a remoção das chamadas de provisionamento do cliente, ou workspaces novos nasceriam sem cadastros padrão.

---

## 13. Documentação existente

| Documento | Classificação | Observação |
| --- | --- | --- |
| `README.md` | Corrigido em P0 | Antes: afirmava que `firebase.json` não tinha Hosting e citava cinco suítes de Rules. |
| `docs/investments/EXECPLAN.md` | HISTORICAL (seções datadas) / OUTDATED (cabeçalho de estado) | O estado de milestones foi substituído por este plano. |
| `docs/investments/PRODUCTION_READINESS_AUDIT.md` | HISTORICAL | Retrato do commit `c754cfa`. |
| `docs/investments/PRODUCTION_READINESS_AUDIT_FINAL.md`, `PRODUCTION_REMEDIATION.md` | OUTDATED | Marcam como corrigidos itens cuja superfície foi desmontada; o veredito "tecnicamente pronto" não vale para o HEAD. |
| `docs/investments/INVESTMENTS_SINGLE_DOMAIN_FINALIZATION.md` | HISTORICAL | Contagens de funções e índices desatualizadas (HEAD: 47 endpoints, 43 índices). |
| `docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md` | OUTDATED | Comandos `npm run deploy:* --project <PROJETO>` não trocam o projeto alvo (REL-03). Não usar. |
| `docs/investments/OPERATIONAL_LIMITS.md`, `TTL_MANIFEST.md`, `CASH_BACKFILL_RUNBOOK.md` | OUTDATED | Citam constantes, coleções e telas inexistentes no HEAD. |
| `docs/credit-card-domain-phase-*.md` (12) | HISTORICAL | Registros de fase; `src/modules/allocations/logic.ts` não existe mais, e `migrateLegacyInstallmentsToInvoiceDomain` sobrevive só como entrada sem callable em `functions/src/creditCards/writeStrategy.ts:281-304` e `src/modules/credit-cards/writeStrategy.ts:280` (legado a remover em P4). |

Documentos OUTDATED não devem orientar implementação nem operação. Os runbooks válidos passam a viver em [RUNBOOKS.md](RUNBOOKS.md).

---

## 14. P0 — execução e evidências

- **Skills do projeto:** fonte canônica em `.agents/skills/` (compartilhada com Codex), links em `.claude/skills/`. Revisadas: `financial-domain-integrity` (autoridade, atomicidade e remoção de legado sem dados reais), `firestore-scale-cost-review`, `multi-tenant-security-review`, `regression-release-gate` (comandos do projeto e matriz de skills por superfície). Instalada: `ptbr-product-ui-review`. Criadas: `billing-entitlement-integrity`, `firebase-production-readiness`, `privacy-lgpd-data-lifecycle`, `observability-incident-readiness`, `saas-commercial-readiness`. Os rascunhos e a cópia duplicada em `tools/codex-skill-drafts/` e `.claude/skills/regression-release-gate/` foram substituídos pela fonte única.
- **Proteções do harness:** `.claude/settings.json` mantém as negações anteriores e passa a negar também: `git merge`, `git push` sem argumentos e via `-C`, `gh pr merge`; `npm run deploy*` e variantes (`run-script`, `exec`), `firebase deploy` em qualquer forma, scripts `serve`/`shell`/`start`/`logs` de `functions/package.json` e o ensaio de STAGING; comandos `firebase` que leem ou alteram projeto remoto (`use`, `auth:*`, `functions:secrets:*`, `functions:config:*`, `functions:log`, `firestore:databases:*`, `firestore:indexes`, `hosting:*` e outros) e qualquer comando que cite o projeto de produção; `gcloud` e `gsutil`; `npm run dev`/`npm run preview` (o app local conecta ao projeto de produção); a ferramenta `limpar-investimentos.mjs`; leitura de `.env*` e de arquivos de service account; e todas as ferramentas MCP do Firebase que leem ou escrevem projeto. As demais ferramentas MCP do Firebase (documentação) exigem confirmação. Os mesmos limites estão em `CLAUDE.md` e, para Codex, em `AGENTS.md`.
- **Escopo das skills novas:** cada skill nova declara "Escopo da avaliação" — no fechamento de milestone avalia o que o diff exercita e tudo que o plano atribui ao milestone corrente ou anteriores; itens de milestones posteriores são listados à parte com ID; em release e em P10 o checklist é integral.
- **Revisões independentes de P0:** revisão das skills e instruções (35 achados; aplicados os procedentes, sem redução de critério) e checagem factual de todos os documentos (878 afirmações conferidas, 818 corretas; 93 correções aplicadas). Decisões antes sem ID foram numeradas (D-23 a D-39) e o item PR-OBS-02 foi incluído.
- **Validação (working tree final, 2026-09-28, Node 22.17.0, 2 CPUs/7,9 GB):**
  - Nenhum arquivo de produto alterado: `git diff HEAD` vazio para `src/`, `functions/`, `tests/`, `e2e/`, Rules, índices, `firebase.json`, `.firebaserc`, manifests, `index.html`, `vite.config.ts`, `playwright.config.ts` e `.github/`. Sob `tools/` só saiu `tools/codex-skill-drafts/` (rascunhos de skills, agora instalados).
  - `npm run verify:all` (10m32s, exit 0): typecheck OK; lint das Functions 0 erros (2.076 avisos preexistentes); build do frontend e das Functions OK; unitários das Functions 103/103 e do frontend 174/174; integração das Functions no Emulator 174/174; guarda da ferramenta de limpeza 15/15; Rules no Emulator 74/74 (goals 5, investments 7, investment-domain 19, investment-m3 7, m4 31, adjacent 5); E2E 37/37. Nenhum teste skipped.
  - Execuções anteriores no mesmo dia: `verify:fast` (exit 0, mesmos números) e `test:integration:emulator` (exit 0, mesmos números). A primeira execução de `test:e2e` teve 36/37: `e2e/investments-simple.spec.ts:138` falhou em 37 ms com `browser.newContext: Target page, context or browser has been closed`, antes de executar código do teste, com 9 agentes, emuladores e Chromium concorrendo por memória. Reexecução isolada do spec: 9/9. Suíte completa com a máquina ociosa: 37/37, e de novo 37/37 no `verify:all`. Classificado como ambiental (mesma classe do flake de memória do renderer registrado como INV-P2-044 em `vite.config.ts:29`), sem mudança de código no diff.
  - O Playwright deixa um Firestore Emulator órfão ao terminar (porta 8080); foi encerrado após cada execução. Comportamento preexistente, coberto por `npm run e2e:kill-ports`.

---

## 15. Registro de progresso

| Data | Milestone | Entrada |
| --- | --- | --- |
| 2026-09-27 | P0 | Auditoria do HEAD `9c3ab46`; registro §6 criado (30 BLOCKER, 60 HIGH); skills, `CLAUDE.md`, proteções e `docs/production/` entregues. Validação em 2026-09-28: `verify:all` verde sobre o working tree final (§14); `regression-release-gate` executado no fechamento. |
| 2026-09-29 | P1 | Lacunas de fechamento resolvidas (provisionamento server-side transacional, tenant confiável no log, erros no contrato compartilhado, paginação por cursor, contrato cliente das 11 callables, limpeza de legado); skills `PASS` no escopo; gate `FAIL` por E2E sem execução completa verde (§16.2). P1 permanece em andamento. |
| 2026-09-29 | P1 | `verify:all` nº 3 verde aceito como evidência (sem mudança funcional depois dele); `regression-release-gate` `FAIL`: a suíte unitária nova `test:unit:p1` roda em `verify:fast`, mas não no CI (§16.3). P1 permanece em andamento. |
| 2026-09-29 | P1 | `test:unit:p1` foi ligado ao job `build-and-unit` do CI, nas versões Node 22 e 24, e passou 128/128. Só o workflow e este plano mudaram. P1 permanece em andamento e aguarda apenas a reexecução do `regression-release-gate` (§16.3). |
| 2026-09-29 | P1 | `regression-release-gate` reexecutado: **PASS** (§16.3). P1 **concluído**. PR-AUTH-03, PR-WS-01…PR-WS-06 e PR-MONEY-01 fechados e retirados de §6, com a evidência em §16.4. P2 não foi iniciado. |
| 2026-09-29 | P2 | P2A concluída: catálogo canônico, `billing_accounts/{uid}`, checkout sem duplicidade, Customer Portal, webhook idempotente e ordenado, segredos sem fallback, Rules e frontend sobre o estado canônico; PR-BILL-01…06 e PR-BILL-08 fechados e retirados de §6 (§17). P2B não iniciada. |
| 2026-09-29 | P2 | P2A.1 (hardening da P2A): webhook sem I/O externo dentro de transação (claim → leitura do Stripe fora de transação → commit com lease e geração), recibo `processing`/`processed`, `listSubscriptions` paginado, `BillingProvider` só depois do bootstrap da conta; 26 `max-len` de testes de P2A corrigidos (§17.7). P2B não iniciada; PR-BILL-07 segue aberto. |
| 2026-09-30 | P2 | P2B.1 concluída: API de quota server-side (`functions/src/billing/quota.ts`), estado `quota_state` backend-only, quota de workspaces próprios e de membros com reservas de convite, transferência de ownership pela capacidade do novo owner, `getWorkspaceEntitlement`/`getAccountUsage` e frontend conta × workspace; PR-BILL-07 fechado e retirado de §6 (§17.8). PR-ENT-01 (P3–P5) e PR-AI-03 (P2B.2) seguem abertos. P2B.2 não iniciada. |
| 2026-09-30 | P2 | P2B.2 concluída: créditos mensais de IA pelo plano efetivo do titular (pool por billing owner), admissão atômica (autorização, owner canônico, uso do mês, recibo de idempotência, rate limit e crédito no mesmo commit), `idempotencyKey` obrigatória, provedor só depois do commit e fora de transação, `maxOutputTokens` 1200/600, `getAccountUsage` com uso de IA do próprio titular; contenção de transação passa a `aborted` (`concurrent_update`), nunca `internal`. PR-AI-03 fechado e retirado de §6 (§17.9). Abertos: PR-ENT-01 (P3–P5); E-06 para fechar P2. P2C (gate de P2) não iniciada. |

---

## 16. P1 — execução e evidências

**Estado:** Concluído em 2026-09-29. Todas as lacunas de código de P1 foram resolvidas e todas as skills aplicáveis emitiram `PASS` no escopo do diff. `verify:all` terminou verde (§16.2). O `regression-release-gate` emitiu `FAIL` por uma lacuna de CI e, depois da correção, `PASS` (§16.3). Os blockers de P1 saíram de §6, com a evidência em §16.4. Nada foi implantado (D-ORD-04); toda validação foi feita no Emulator `minhas-financas-local`.

### 16.1 Fechamento (2026-09-29)

O kernel, o ciclo de vida de conta/workspace, convites, membership, suspensão, auditoria, `money`/datas, Rules server-owned, integração do frontend e testes já estavam implementados no working tree e foram preservados. O fechamento tratou só as lacunas comprovadas no código:

| Lacuna | Resolução | Evidência |
| --- | --- | --- |
| Provisionamento de workspace disparado pelo cliente (`seedLegacySettingsCatalog` a cada seleção; `onboardInvestmentWorkspace` no bootstrap e após `createWorkspace`) | `provisionWorkspaceDefaults` grava catálogo geral e padrões de investimento **na mesma transação** de `bootstrapAccount`/`createWorkspace`; só `transaction.create`, sem leituras (ID novo); falha aborta a criação; retry e concorrência herdados da idempotência de `createWorkspace` e da disputa de `users/{uid}` no bootstrap. Builders reutilizados: seeds de investimento e documentos de conta/ativo saem de `investments/onboarding.ts` (fonte única para o provisionamento e para a operação convergente); as categorias de investimento do catálogo geral derivam de `INVESTMENT_CATEGORY_SEEDS` | `functions/src/workspaces/provisioning.ts:59,155`; `functions/src/workspaces/lifecycle.ts:193,259`; `functions/src/investments/onboarding.ts:203,240`; `functions/src/workspaces/__tests__/provisioning.integration.test.ts` (PF/PJ, retry concorrente, falha injetada sem estado parcial e retry convergente, bootstrap concorrente) |
| `workspaceId` do payload registrado como tenant antes da autorização | O kernel separa `requestedWorkspaceId` (só entrada do resolvedor, nunca logado) do tenant confiável; o contexto de log recebe `workspaceId` apenas após `resolveWorkspaceActor` ou por `trustWorkspace`, chamado pelo handler depois da autorização transacional (arquivamento, transferência, aceite). Sem pré-checagem nova: a semântica de replay de transferência/arquivamento não mudou | `functions/src/shared/callable.ts:257,273`; `functions/src/workspaces/callables.ts:99-114,135-157,215-232`; `functions/src/shared/__tests__/kernelTenantLog.integration.test.ts` |
| `new HttpsError` em handlers do kernel | `billing.ts` e `splitGroups.ts` migrados para `ApplicationError` com os mesmos códigos HTTPS (novo código fechado `already_exists`); regras comerciais e de Split inalteradas; teste-guarda impede `new HttpsError` em produção fora do mapeador | `functions/src/callables/billing.ts:115-129`; `functions/src/callables/splitGroups.ts`; `functions/src/shared/errors.ts`; `functions/src/shared/__tests__/kernel.test.ts` ("produção não constrói HttpsError fora do mapeador único") |
| Listas de workspaces (50) e membros (200) sem cursor | Paginação por cursor (`startAfter` no último snapshot; página = teto das Rules; empate de `joinedAt` desempatado pelo ID), sob demanda: custo constante por abertura. O controle "Carregar mais espaços/membros" só aparece quando existe próxima página; abaixo do teto a interface é idêntica (screenshots HEAD × working tree idênticos pixel a pixel no modal de membros, desktop 1280×800 e mobile 390×844, e no menu do seletor, desktop; o seletor não é exibido a 390 px em nenhuma das versões) | `src/modules/workspaces/api.ts:69,131,190`; `src/modules/workspaces/hooks.ts:34`; `src/contexts/WorkspaceContext.tsx:106,178`; `tests/firestore/workspaces-p1.rules.integration.test.mjs:339` (120 entradas/450 membros, três páginas, sem repetição); `e2e/workspace-pagination.spec.ts` |
| Wrappers cliente ausentes | Contrato das 11 callables em módulo puro (`acceptWorkspaceInvite`, `revokeWorkspaceInvite`, `leaveWorkspace`, `archiveWorkspace` incluídos, sem tela própria: a superfície visual fica para o fluxo que as consumir; e-mail de convite depende de E-11 e não é simulado) | `src/modules/workspaces/callables.ts:15,73`; `tests/unit/workspace-callables.test.ts` (nomes = exports do backend; chaves = schemas Zod estritos) |
| Limpeza | Removidos o callable órfão `seedLegacySettingsCatalog` (backend, contrato, wrapper) e as chamadas de provisionamento do cliente; teste renomeado ("owner cria membership arbitrário pelo cliente") | Busca sem ocorrências em `src/`, `functions/src/`, `firestore.rules`, `e2e/`, `tests/`: `fakeUid`, `syncUserWorkspaceMembership`, `ensureOwnerMembership`, `collectionGroup('members')`, `isWorkspaceOwnerByParent`, `seedLegacySettingsCatalog`, `addMember`, `updateMemberRole`; `where("ownerId")` só em asserções administrativas de testes |

**Premissas corrigidas no fechamento:**
- `tests/unit/money.test.ts` e `tests/unit/session-cleanup.test.ts` (P1) não estavam em nenhum script e nunca rodavam no gate; passaram a rodar em `test:unit:p1`, incluído em `verify:fast`.
- `onboardInvestmentWorkspace` continua exportada como operação convergente do domínio de investimentos (E2E e integração a exercitam). Seu único consumidor de UI, `InvestmentOnboardingCard`, não é montado em nenhuma tela (`src/components/SettingsView.tsx:740` só o cita em comentário); a remoção ou reintegração é decisão do domínio de investimentos, fora de P1.
- As Rules já negavam conta `suspended` (`firestore.rules:28-45`); o texto que dizia o contrário foi corrigido nos documentos de referência.
- O perfil `users/{uid}` de P1 não tem `locale`/`timezone`; a documentação foi alinhada ao contrato real.
- O e2e `goal-contributions` esperava o seed lazy de carteiras ao abrir a UI; a espera foi removida (comportamento substituído) e a cobertura do provisionamento passou para o caminho real em `e2e/workspace-membership.spec.ts` (workspace criado por `createWorkspace` já tem catálogo PJ e conta de investimento).

**Riscos residuais (fora de P1, com dono):** quota de workspaces/membros e `resource-exhausted` no rate limit (P2, D-01; ENTRY-21 parcial); App Check (P6); e-mail do convite (E-11); schemas de `workspaceId` de outros domínios ainda com `min(1)` — o resolvedor canônico recusa `/` (P3–P5); `manual*Test.ts` de cartões no pacote de Functions (P4).

### 16.2 Validação

Ambiente: Node 22, 2 CPUs, 7,9 GB sem swap; Emulator `minhas-financas-local`. Lint das Functions: 0 erros; avisos 1.987 no início do fechamento → **1.971** (baseline pré-P1: 2.076). Nenhum teste skipped, `only` ou timeout alterado.

| Etapa | Resultado |
| --- | --- |
| Testes direcionados (durante o fechamento) | Integração P1 + goals + investimentos no Emulator 155/155; Rules P1 10/10; unitários Functions 328/328; unitários P1 do frontend 128/128 |
| `verify:all` nº 1 | Tudo verde até as Rules; E2E 38/40: `workspace-pagination.spec.ts` (bug do próprio teste ao fechar o menu, corrigido) e `workspace-membership.spec.ts:121` (`page.reload: Page crashed`) |
| `verify:all` nº 2 (final) | typecheck, lint, builds OK; unitários Functions 328/328, investimentos 174/174, P1 128/128; integração 252/252; guarda de limpeza 15/15; Rules goals 5, investments 7, investment-domain 19, investment-m3 7, m4 36, adjacent 5, workspaces 10 (todas verdes); E2E **39/40**: `workspace-membership.spec.ts:121` com `locator.click: Target crashed` no mesmo ponto (após `page.reload()`) |
| `verify:all` nº 3 (2026-09-29, exit 0, 11m45s, log `/tmp/p1-verify-all.log`) | typecheck 0 erros; lint das Functions 0 erros e 1.971 avisos (baseline 2.076); builds do frontend e das Functions OK; unitários Functions 328/328, investimentos 174/174, P1 128/128; integração 252/252; guarda de limpeza 15/15; Rules goals 5, investments 7, investment-domain 19, investment-m3 7, m4 36, adjacent 5, workspaces 10 (89/89); E2E **40/40** (4,3 min), incluindo `workspace-membership.spec.ts:121`. Nenhum skipped/falha/crash. Memória disponível no início: 4.381 MB. Sem mudança de código, timeout, retry ou configuração. |
| Diagnóstico | Os dois specs de workspace isolados: 3/3. Rodada completa com amostragem de memória: 14/40, com 13 falhas de crash de renderer/navegador espalhadas por specs não relacionados; memória disponível caiu de 4.480 MB para 763 MB, com processos duplicados do servidor do VS Code e um `playwright test-server` da IDE ativos durante a rodada. Nenhum `oom_kill` registrado no cgroup, portanto a causa ambiental não está provada |
| Comparação visual | Screenshots HEAD × working tree (build E2E, mesma semente): modal de membros idêntico pixel a pixel em 1280×800 e 390×844; menu do seletor idêntico em 1280×800 |

**Skills (escopo do diff de P1):** `multi-tenant-security-review` PASS; `firestore-scale-cost-review` PASS; `ptbr-product-ui-review` PASS; `financial-domain-integrity` PASS; `billing-entitlement-integrity` PASS (só a migração de erro; P2 fora do escopo); `firebase-production-readiness` PASS (remoção de export; P6 fora do escopo); `observability-incident-readiness` PASS (contrato de log; registro do alvo não confiável de tentativas negadas como evento de segurança fica para P7). `regression-release-gate`: **FAIL** (§16.3).

### 16.3 Gate de regressão (2026-09-29)

Base `60f2b7d` (fechamento de P0) → `HEAD` `35314b1`; worktree com alteração só neste plano. O `verify:all` nº 3 (log criado às 14:52:33 e encerrado às 15:04:18 UTC, depois do commit `HEAD` das 14:25:53) foi aceito como evidência: desde o início da rodada, o único arquivo versionado alterado é este plano, sem arquivos untracked. No log: typecheck OK; lint 0 erros; builds OK; unitários 328 + 174 + 128; integração 252; guarda de limpeza 15; Rules 89; E2E 40/40; nenhum skipped, falha ou crash; Emulator só em `minhas-financas-local`, sem referência ao projeto de produção. No diff: nenhum skip/`only`, nenhuma perda líquida de asserções em testes modificados, timeouts novos só nos specs novos (no padrão de 20–60 s já usado), scripts alterados só por adição (`test:unit:p1`, `test:rules:workspaces`) e busca de legado sem ocorrências.

**Bloqueador (FAIL):** a suíte unitária nova `test:unit:p1` (`tests/unit/money.test.ts`, `session-cleanup.test.ts`, `workspace-callables.test.ts`; 128 testes) está em `verify:fast` (`package.json:15`), mas não no CI. O job de unitários de `.github/workflows/quality-gate.yml:68-72` executa só `functions:test:unit` e `test:unit:investments`, e não chama `verify:fast`. O checklist do gate (§3) exige que toda suíte unitária nova esteja ligada aos scripts oficiais **e** ao CI. Sem isso, uma regressão no espelho `src/lib/money.ts` (PR-MONEY-01), na limpeza de sessão (AUTH-11) ou no contrato cliente das 11 callables passaria no CI. `test:rules:workspaces` não tem essa lacuna: roda dentro de `test:integration:emulator`, que o CI executa.

**Correção do bloqueador (2026-09-29):** `test:unit:p1` agora roda no CI, no passo "Testes unitários de dinheiro, sessão e workspaces" (`.github/workflows/quality-gate.yml:74-75`). O passo fica no job `build-and-unit`, logo depois de `test:unit:investments`, e por isso roda nas duas versões da matriz, Node 22 e 24. Aproveita a instalação, o cache e a política de falha que o job já tinha. O workflow continua válido: foi reinterpretado com o `js-yaml` que já está em `functions/node_modules`, com três jobs e o passo novo no índice 10. `npm run test:unit:p1` passou 128/128 (Node 22, 0 falhas, 0 skipped). A mudança se limita ao workflow e a este plano. Nenhum código funcional, teste, Rule ou script foi alterado, e por isso o `verify:all` nº 3 continua valendo como evidência.

**Reexecução do gate (2026-09-29): PASS.** O worktree tinha só duas alterações sobre `HEAD` `35314b1`: `.github/workflows/quality-gate.yml` (+3 linhas) e este plano. Nenhum arquivo untracked. Fora do diretório de dependências e dos artefatos de build, esses dois são os únicos arquivos modificados depois do início do `verify:all` nº 3 (14:52:33 UTC), e por isso o `verify:all` nº 3 continua valendo. O log confirma: 328, 174, 128, 252, 15 e 89 testes passando nas suítes do Node, e E2E 40/40. Nenhum `fail`, `skipped` ou `todo`. Só aparece o Emulator `minhas-financas-local`, com zero ocorrências do projeto de produção.

- O workflow foi reinterpretado com `js-yaml`. O passo `npm run test:unit:p1` é o índice 10 do job `build-and-unit`, que roda na matriz Node 22/24 com `fail-fast: false`.
- O passo não tem `if:` nem `continue-on-error`, e o workflow inteiro não tem `|| true` nem `set +e`. O único `if:` do arquivo é o `if: failure()` do upload de artefatos do E2E, que já existia.
- O script `test:unit:p1` (`package.json:15`) continua com os três arquivos e roda em `verify:fast`. A reexecução passou 128/128, sem falhas, `skipped` ou `todo`.
- A mudança não toca nenhuma superfície que exija skill de domínio além das que já emitiram `PASS` sobre o diff funcional (§16.2). Nenhum blocker novo de P1.

### 16.4 Blockers fechados (2026-09-29)

Os itens abaixo saíram de §6 com o gate `PASS` (§16.3). A evidência é do `HEAD` `35314b1` e foi validada pelo `verify:all` nº 3 (§16.2).

| ID | Sev. | Blocker de origem | Evidência do fechamento | Achados de origem |
| --- | --- | --- | --- | --- |
| PR-AUTH-03 | HIGH | Bootstrap de conta e do primeiro workspace no cliente, não atômico e não idempotente; perfil users/{uid} sem dono server-side | `functions/src/workspaces/lifecycle.ts:106-218 — bootstrap transacional e idempotente`<br>`functions/src/workspaces/provisioning.ts:155 — provisionamento na mesma transação`<br>`src/contexts/WorkspaceContext.tsx:105 — cliente só chama o callable` | AUTH-03, AUTH-12, WS-07 |
| PR-WS-01 | BLOCKER | Convite de membro inexistente: UID fictício gerado no cliente, sem token, expiração, e-mail ou aceite | `functions/src/workspaces/memberships.ts:104,231 — convite com hash do token, aceite pelo uid da sessão e e-mail verificado`<br>`functions/src/workspaces/inviteTokens.ts:13-15 — 256 bits, 7 dias` | WS-01, AUTH-05, RULES-07 · C05 |
| PR-WS-02 | HIGH | Mutações de membership no cliente, não atômicas, com escrita parcial determinística e sem auditoria | `functions/src/workspaces/memberships.ts:385,436,485,536 — papel, remoção, saída e transferência transacionais com auditoria`<br>`firestore.rules:951-958 — members write false` | WS-02, FEW-08, WS-11, ENTRY-09 · C04 |
| PR-WS-03 | HIGH | Fontes concorrentes de papel: espelho autogravado, fallback collectionGroup morto, ownerId × membership e resolvedores duplicados | `functions/src/shared/workspaceAuth.ts:121-214 — resolvedor único, sem fallback ownerId`<br>`src/modules/workspaces/api.ts:148-152 — papel lido só do membership ativo` | WS-03, WS-10, AUTH-07, READ-14, RULES-18 |
| PR-WS-04 | HIGH | ownerId pode ser trancado fora do próprio workspace via status (co-owner/admin) | `firestore.rules:9-45 — sem regime ownerId; isMember exige conta ativa`<br>`tests/firestore/workspaces-p1.rules.integration.test.mjs:192 — trancamento do owner negado` | WS-04, RULES-08 |
| PR-WS-05 | HIGH | Criação de workspace pelo cliente sem validar type PF/PJ e com falhas de payload (a quota é tratada em PR-ENT-01, P2) | `functions/src/workspaces/lifecycle.ts:222 — createWorkspace com Zod estrito, PF/PJ e CNPJ`<br>`firestore.rules:936-945 — create/update/delete false` | AUTH-04, RULES-06, FEW-10, WS-08 |
| PR-WS-06 | HIGH | Sem testes de membership/workspace (Rules cross-tenant, espelho, convites, criação) | `functions/src/workspaces/__tests__/*.integration.test.ts — conta, ciclo de vida, convites, membros, ownership, provisionamento`<br>`tests/firestore/workspaces-p1.rules.integration.test.mjs — cross-tenant A↔B, viewer, suspenso, paginação; e2e/workspace-membership.spec.ts` | WS-06, AUTH-16 |
| PR-MONEY-01 | HIGH | Sem módulo Money único: float em reais na maioria dos domínios e helpers de arredondamento divergentes. Fechado quanto ao módulo e à política; a adoção por domínio segue em P3–P5 | `functions/src/shared/money.ts:87,122 — parse e alocação por maior resto`<br>`src/lib/money.ts:67,88 — espelho no frontend`<br>`tests/unit/money.test.ts — em test:unit:p1, no CI` | MONEY-11 |

Os documentos de referência de `docs/production/` marcavam esses itens como "pendente do gate (PLAN §16)". As referências foram normalizadas em 2026-09-29 e agora dizem "fechado em P1 (PLAN §16.4)".

---

## 17. P2A — execução e evidências

**Estado:** P2A concluída em 2026-09-29 no código e nos testes direcionados; P2 permanece em andamento. Entregue: catálogo canônico, estado `billing_accounts/{uid}`, checkout sem assinatura duplicada, Customer Portal, webhook idempotente e ordenado, segredos sem fallback, Rules e frontend sobre o estado canônico. Não iniciada: **P2B** (motor de quota aplicado nas callables, entitlement do workspace pelo owner e IA). Não foram rodados nesta etapa, por instrução: `verify:all`, E2E e `regression-release-gate`. Nada foi implantado (D-ORD-04); toda validação foi feita no Emulator `minhas-financas-local`, com Stripe falso, sem rede nem credenciais.

### 17.1 Arquitetura entregue

Módulo `functions/src/billing/`:

| Peça | Resumo | Evidência |
| --- | --- | --- |
| Catálogo | Versionado (`BILLING_CATALOG_VERSION = 1`); `BILLING_POLICY`: BRL, mensal, `trialDays` 0, `pastDueGraceDays` 7, cancelamento `period_end`; `publicBillingCatalog()` não expõe `priceId`. Planos em centavos (workspaces próprios ativos / membros ativos por workspace incl. owner / lançamentos por mês / grupos / créditos de IA por mês): FREE 0 — 1/2/50/2/10; PRO 2990 — 5/10/1.000/10/150; BUSINESS 5990 — 20/50/10.000/100/750. Sem 999 nem 99999 | `functions/src/billing/catalog.ts:16,50,64-104,135` |
| Configuração | Secret Manager declarado em `secrets` de cada função (padrão atual; `defineSecret` não é usado): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_BUSINESS_MONTHLY`, `APP_ALLOWED_ORIGINS`. Sem valor padrão: ausente, vazio ou fora do formato (inclusive `sk_test_placeholder`/`whsec_placeholder`, pelo comprimento mínimo) falha fechada; Pro = Business é inválido; modo live/test derivado da chave. `STRIPE_ALLOWED_PRICE_IDS` removida | `functions/src/billing/config.ts:18-49,72-88,96-112`; `functions/src/shared/deploymentContract.test.ts:125-150` |
| Estado canônico | `billing_accounts/{uid}` (uid = titular, D-01): `billingOwnerUid`, `catalogVersion`, `planId` (efetivo na última avaliação), `entitlementStatus` (free\|active\|grace\|restricted\|pending), `subscriptionStatus` (none + 8 status Stripe), `graceUntil`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `cancelAt`, `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId`, `pendingCheckout` (lock), `lastStripeEventId`, `lastStripeEventType`, `stripeSyncedAt`, `createdAt`, `updatedAt`. Auxiliares backend-only: `billing_customers/{stripeCustomerId}` (vínculo reverso), `billing_webhook_events/{eventId}` (recibo sem payload, `status` `processing`\|`processed` desde P2A.1, TTL `expiresAt` de 90 dias), `billing_accounts/{uid}/billing_events/{id}` (trilha append-only, sem TTL) e `billing_accounts/{uid}/billing_sync/reconciliation` (lease com geração, P2A.1, §17.7) | `functions/src/billing/model.ts:29-38,103-163`; `functions/src/shared/retention.ts:53`; `firestore.indexes.json:858-861` |
| Entitlements | `resolveEntitlement` puro: sem assinatura, `canceled` e `incomplete_expired` ⇒ Free; `active`/`trialing` ⇒ plano do Price (Free após fim agendado); `past_due` ⇒ plano até `graceUntil`, depois `restricted`; `unpaid`/`paused` ⇒ `restricted`; `incomplete` ⇒ `pending`; Price desconhecido nunca concede. `effectiveEntitlement(conta, agora)` reavalia grace e cancelamento no relógio do servidor (API para P2B); `effectiveLimits` | `functions/src/billing/entitlements.ts:71,131,157` |
| Reconciliação | Assinatura canônica: a viva de maior prioridade, depois plano, depois recência (duplicidade é anomalia); plano só por Price com 1 item e quantidade 1; grace ancorado na finalização da fatura que falhou e que não avança no mesmo episódio; transições auditadas | `functions/src/billing/reconcile.ts:61,93-133,147-200,231` |
| Checkout | `createCheckoutSession` `{planId: pro\|business, returnUrl, idempotencyKey}`. Valida `returnUrl` pela allowlist; confere o Price no Stripe (ativo, recorrente mensal, BRL, valor = catálogo, mesmo modo) e falha fechado; reserva transacional (idempotência do kernel em `users/{uid}/idempotency_keys`, conta ativa, recusa assinatura viva, lock `pendingCheckout` com lease de 90 s, rate limit de 10/h); Customer canônico criado com `Idempotency-Key` e vínculo reverso na mesma transação; no Stripe, recusa assinatura viva ainda não refletida e expira outras sessões abertas (sessão já concluída ⇒ recusa); cria a sessão com `Idempotency-Key` derivada do hash da chave e expiração fixada; `client_reference_id`, `metadata` e `subscription_data.metadata.billingOwnerUid`; `locale pt-BR`; só cartão; o commit final grava lock `open`, resultado idempotente e o evento `checkout.created`. Nenhum checkout concede entitlement | `functions/src/billing/checkout.ts:73,80,161-187,206,283-310,321-340,346-380,417`; `functions/src/billing/stripeGateway.ts:250-275` |
| Portal | `createBillingPortalSession` `{returnUrl}`: só o próprio titular, conta ativa, `stripeCustomerId` obrigatório (senão "Você ainda não tem uma assinatura para gerenciar."), allowlist de retorno, rate limit de 20/h, URL criada no servidor | `functions/src/billing/portal.ts:31-43,44-81` |
| Webhook | `stripeWebhook` sem CORS, 60 s/256 MiB/`maxInstances` 10. Assinatura sobre o raw body obrigatória (400 sem efeito, sem ecoar erro do SDK); segredo ausente ⇒ 500 sem processar; evento de outro modo ⇒ 400; recibo `billing_webhook_events/{event.id}` (`processed` ⇒ 200 sem efeito; `processing` nunca vale como processado). **Ordem (protocolo em fases de P2A.1, §17.7):** o conteúdo do evento nunca é aplicado; um claim em transação curta adquire o lease do titular com geração nova; as assinaturas do customer são relidas no Stripe (lista paginada e assinatura referenciada por ID) fora de transação; o commit só aplica com a mesma geração, então os commits seguem a ordem das leituras e um evento antigo não regride. O titular é resolvido por `billing_customers`, conferido com `stripeCustomerId` da conta e com a metadata do checkout (divergência ⇒ rejeitado, com recibo e anomalia). Falha transitória ⇒ 500 para reentrega | `functions/src/webhooks/stripe.ts:26-65`; `functions/src/billing/webhook.ts:401-510,513-523,575-658,718-801`; `functions/src/shared/runtimeOptions.ts:84-89` |
| Eventos tratados | `checkout.session.completed`, `customer.subscription.created/updated/deleted/paused/resumed`, `invoice.paid`, `invoice.payment_succeeded` (só reconcilia), `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded` e `charge.dispute.created/closed` (reembolso e disputa só registrados, sem mudar entitlement); demais ⇒ recibo `ignored`. Auditoria: `subscription.linked`, `billing.state_changed`, `grace.started/ended`, `cancellation.scheduled/reverted`, `subscription.canceled`, `payment.succeeded/failed/action_required`, `refund.received`, `dispute.received/closed`, `anomaly.detected`, sem payload, e-mail, cartão nem segredo | `functions/src/billing/webhook.ts:132-230`; `functions/src/billing/audit.ts:24-40` |
| Callables e bootstrap | `getBillingCatalog`, `createCheckoutSession`, `createBillingPortalSession` (exports explícitos). `bootstrapAccount` cria o billing Free na mesma transação, idempotente, sem sobrescrever estado existente | `functions/src/billing/callables.ts:45,52,76`; `functions/src/index.ts:27-32`; `functions/src/workspaces/lifecycle.ts:125,146,176` |
| Rules | Blocos `billing_accounts`, `billing_customers` e `billing_webhook_events`: o titular ativo faz `get` do próprio documento; sem `list`, sem leitura cruzada, sem escrita do cliente; subcoleções, vínculo e recibos negados nos dois sentidos. O perfil `users/{uid}` não tem mais plano | `firestore.rules:1412-1431`; `firestore.rules:1371-1385` |
| Frontend | `src/modules/billing/`: `BillingContext.tsx` (provider único, abaixo do `WorkspaceProvider`, com listener do documento canônico e catálogo por callable só depois do bootstrap da conta — P2A.1), `entitlement.ts` (só exibição), `callables.ts`/`api.ts`, `hooks.ts` (`useBillingActions`). `PricingTable` com preços do catálogo (`formatCentsBRL`), rótulos pt-BR e "Gerenciar assinatura" para assinante; `BillingSuccessModal` com estados confirmando, confirmado (só quando o documento canônico mostra plano pago ativo) e em processamento (após 90 s); `checkLimit` é só ajuda de UX | `src/modules/billing/BillingContext.tsx:42-51,60,90`; `src/modules/billing/api.ts:47`; `src/modules/billing/components/PricingTable.tsx:77,99-101`; `src/modules/billing/components/BillingSuccessModal.tsx:8,15,40,50`; `src/App.tsx:706-708` |

Mudança visual apenas nos textos e estados estritamente necessários: preços e limites vindos do catálogo em pt-BR, sem chaves internas; botão "Gerenciar assinatura" / "Plano Gratuito"; estados de carregamento e erro do catálogo; estados do modal. Layout, classes e identidade preservados.

### 17.2 Validação (2026-09-29)

Emulator `minhas-financas-local`, Stripe falso, sem rede nem credenciais.

| Suíte | Resultado |
| --- | --- |
| `functions/src/billing/__tests__/billing.test.ts` + contrato de deploy | 34/34; unitários das Functions completos 351/351 |
| `checkout.integration.test.ts` (20) + `webhook.integration.test.ts` (16) | 36/36; com as suítes de workspaces e do kernel: 111/111 |
| Rules `tests/firestore/billing-p2.rules.integration.test.mjs` (script `test:rules:billing`, incluído em `test:integration:emulator` e `predeploy:rules`) | 5/5 |
| Rules `m4-hardening` (teste INV-P1-013 migrado para `billing_accounts`) | 36/36 |
| Rules de workspaces | 10/10 |
| Cliente `tests/unit/billing-client.test.ts` (script `test:unit:billing`, em `verify:fast` e no CI `.github/workflows/quality-gate.yml:77-78`) | 14/14 |
| typecheck; build do frontend; build das Functions | OK |
| Lint das Functions | 0 erros; 1.993 avisos (baseline de P1: 1.971; +22 `max-len` só em títulos de teste) |
| `verify:all`, E2E, `regression-release-gate` | **Não rodados** nesta etapa, por instrução |

**Instabilidade observada:** 1 falha em 11 execuções do teste "bootstrap cria billing Free válido, idempotente e sob concorrência" (`functions/src/billing/__tests__/checkout.integration.test.ts:72`; erro `internal` após 16,9 s, com três bootstraps concorrentes, a suíte de webhook em paralelo e cerca de 0,9 GB livres). Não reproduzida nas 8 execuções seguintes; o teste de concorrência de P1 (5 bootstraps) passou em todas. Classificada como contenção do Emulator sob carga, sem mudança de teste; acompanhar no gate.

### 17.3 Blockers fechados

Os itens abaixo saíram de §6 no código e nos testes direcionados de P2A. O `regression-release-gate` de P2 ainda não foi executado; o fechamento formal só se completa com o gate de P2.

| ID | Sev. | Blocker de origem | Evidência do fechamento | Achados de origem |
| --- | --- | --- | --- | --- |
| PR-BILL-01 | BLOCKER | Ciclo de vida da assinatura ausente: só checkout.session.completed; plano nunca é revogado | `functions/src/billing/webhook.ts:178-288 — roteamento de 13 tipos de evento; demais ignorados com recibo`<br>`functions/src/billing/reconcile.ts:147-200 — estado derivado da assinatura relida`<br>`functions/src/billing/entitlements.ts:71,131 — revogação por status, grace e fim de período`<br>`functions/src/billing/__tests__/webhook.integration.test.ts` | BILL-02, ENTRY-01 · C03 |
| PR-BILL-02 | BLOCKER | Sem Customer Portal nem caminho de cancelamento pelo produto | `functions/src/billing/portal.ts:44 — createBillingPortalSession do próprio titular`<br>`functions/src/billing/callables.ts:76`<br>`src/modules/billing/components/PricingTable.tsx:99-101 — "Gerenciar assinatura"` | BILL-03, COMM-02 · C03 |
| PR-BILL-03 | BLOCKER | Checkout permite assinatura duplicada e cobrança em dobro; sem escopo de workspace | `functions/src/billing/checkout.ts:206,283-310,321-340 — lock transacional, Customer canônico e expiração de sessões concorrentes`<br>`functions/src/billing/checkout.ts:417 — recusa assinatura viva; idempotência por idempotencyKey`<br>`functions/src/billing/__tests__/checkout.integration.test.ts` (20 testes). O escopo por workspace foi substituído pela decisão D-01: a assinatura pertence ao titular (§9.2) | BILL-04, ENTRY-05, BILL-09 |
| PR-BILL-04 | BLOCKER | Catálogo inconsistente: Pro e Business com o mesmo priceId, preço literal na UI e Business nunca concedido | `functions/src/billing/catalog.ts:16,64-104 — catálogo v1 em centavos`<br>`functions/src/billing/config.ts:96-112 — Price por plano, Pro = Business inválido`<br>`src/modules/billing/components/PricingTable.tsx:77 — formatCentsBRL do catálogo` | BILL-05, MONEY-12, COMM-03 · C02 |
| PR-BILL-05 | HIGH | Segredos Stripe com fallback placeholder (fail-open) | `functions/src/billing/config.ts:47-49,72-88 — sem padrão, formato validado, placeholders recusados`<br>`functions/src/webhooks/stripe.ts:38-50 — configuração inválida ⇒ 500 sem processar`<br>`functions/src/shared/deploymentContract.test.ts:125-150`. Fail-open fechado; FIRE-10 (configuração não secreta como parâmetro de ambiente) segue para P6 | BILL-06, ENTRY-04, FIRE-10 |
| PR-BILL-06 | HIGH | Webhook sem idempotência por event.id, sem controle de ordem e sem trilha de auditoria | `functions/src/billing/webhook.ts:401-510,575-658 — recibo por event.id: processing no claim, processed no commit do efeito (P2A.1)`<br>`functions/src/billing/webhook.ts:513-523,591-608 — estado relido no Stripe fora de transação; commit só com a geração do lease (ordem, P2A.1)`<br>`functions/src/billing/audit.ts:24-40,64 — trilha append-only` | BILL-07, BILL-16 · C03 |
| PR-BILL-08 | HIGH | Checkout e webhook sem testes de comportamento | `functions/src/billing/__tests__/checkout.integration.test.ts` (20) e `webhook.integration.test.ts` (16)<br>`functions/src/billing/__tests__/billing.test.ts`; `tests/firestore/billing-p2.rules.integration.test.mjs`; `tests/unit/billing-client.test.ts` (§17.2) | BILL-13, REL-08 |

**Prova de remoção do legado (busca em 2026-09-29):** sem ocorrências, em `src/`, `functions/src/`, `tests/`, `e2e/` e `firestore.rules`, de `isPro` (exceto asserções negativas em `tests/`), `constants/plans` e `usePlan` (exceto a guarda de ausência em `tests/unit/billing-client.test.ts`), `sk_test_placeholder` e `whsec_placeholder` (só em testes negativos e no comentário de `functions/src/billing/config.ts:14-15`) e `STRIPE_ALLOWED_PRICE_IDS` (só na asserção de ausência em `functions/src/shared/deploymentContract.test.ts:127,147`). `priceId`, `price_` e `29,90` não ocorrem em `src/`. Removidos: `src/constants/plans.ts`, `src/hooks/usePlan.ts`, `functions/src/callables/billing.ts` e seu teste, o webhook que concedia sempre `pro`, o checkout por `priceId` do cliente e `users.planId`/`isPro`.

### 17.4 Abertos e riscos residuais

| Item | Situação | Dono |
| --- | --- | --- |
| PR-BILL-07, PR-ENT-01, PR-AI-03 | PR-BILL-07 fechado e quotas de workspaces/membros/transferência aplicadas em P2B.1 (§17.8); PR-AI-03 fechado em P2B.2 (§17.9). Segue: quotas dos domínios de P3–P5 (PR-ENT-01) | P3–P5 |
| E-06 | Configuração Stripe (Prices, endpoint, eventos, portal, versão da API) sem conferência; obrigatória para fechar P2 | Responsável externo ([BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md) §14) |
| D-08 residual | Tratamento fiscal, meios além de cartão, plano anual, proration e momento do downgrade no portal; Prices legados por plano | P9 / E-06 |
| FIRE-10 | Configuração não secreta ainda passa por Secret Manager | P6 |
| Documentos com `STRIPE_ALLOWED_PRICE_IDS` | Referências em `README.md`, `FIREBASE_PRODUCTION.md`, `SUBPROCESSORS.md` e `THREAT_MODEL.md` não atualizadas nesta etapa, por escopo documental | Próxima revisão documental |
| `tools/staging/rehearsal.sh` | Não inspecionado nesta etapa | P6 |
| Instabilidade de Emulator | Uma falha em 11 execuções sob carga (§17.2) | Acompanhar no gate |
| Contenção do webhook (P2A.1) | Espera por lease ocupado dentro da requisição (até cerca de 8,5 s) e validade de 60 s: a queda de uma entrega deixa os eventos do mesmo titular em 500 até o lease vencer, e o Stripe reentrega. Customer com mais de 500 assinaturas falha fechado (500) até o Stripe desistir (§17.7) | Alertas sobre `billing_webhook.contention`, `billing_webhook.lease_taken_over` e `billing_webhook.failed`: P7 |
| E2E `workspace-membership` dependente de ordem | "primeiro login … logout não vaza dados" falha em `e2e/workspace-membership.spec.ts:115` quando roda depois de outro spec, já no HEAD `83bb307` (sem P2A.1); passa isolado. Causa provável: depois do logout, `isLoading` fica `false` e o app autenticado aparece por um instante antes do bootstrap da conta seguinte (`src/contexts/WorkspaceContext.tsx:159-170`); o teste lê o índice cedo demais. Correção mínima sugerida: voltar `isLoading` a `true` no logout (fora do escopo de P2A.1, §17.7) | Gate de P2 |
| E2E final de P2A.1 | A versão final de `e2e/billing-bootstrap.spec.ts` não foi reexecutada isoladamente por falta de memória no container; a 2ª execução cobre um superconjunto das asserções dela (§17.7) | Gate de P2 |

### 17.5 Rollback

Reverter o diff de P2A restaura o billing anterior (checkout por `priceId`, webhook que concedia `pro`, plano em `users/{uid}`). Não há dados reais nem migração: contas de teste são recriadas por `bootstrapAccount` e pelo Emulator. Nada foi implantado (D-ORD-04), então não há rollback remoto.

P2A.1: reverter o diff volta ao webhook de transação única, com o Stripe lido dentro da transação, e ao `BillingProvider` acima do bootstrap. O documento `billing_accounts/{uid}/billing_sync/reconciliation` e o campo `status` do recibo ficam sem leitor; são dados de Emulator, recriados por seed.

### 17.6 Skills

- `billing-entitlement-integrity` (escopo P2A, 2026-09-29): **PASS**. Escopo avaliado: catálogo, configuração, estado canônico, checkout, portal, webhook, Rules, bootstrap e frontend de billing (§17.1), com as suítes de §17.2.
  - Catálogo: fonte única `functions/src/billing/catalog.ts`; o Price do ambiente é conferido contra valor, moeda, intervalo e modo antes do checkout; a UI exibe o catálogo do servidor; Pro e Business distintos na configuração e no webhook.
  - Máquina de estados: os 8 status do Stripe e "sem assinatura" mapeados por função pura; grace de 7 dias, cancelamento no fim do período e reativação testados com eventos assinados.
  - Replay e concorrência: evento repetido (inclusive concorrente) com um único efeito; evento antigo entregue depois não regride; eventos concorrentes convergem; checkouts concorrentes deixam uma única sessão pagável; falha transitória responde 500 e o reenvio aplica.
  - N/A com prova: trial (`trialDays` 0, sem `trial_*` no código), pagamento assíncrono (só cartão), papel no workspace para contratar (D-01: a conta é do titular; o contrato não aceita `workspaceId`).
  - Fora do escopo desta avaliação: PR-BILL-07, PR-ENT-01 e PR-AI-03 (P2B); E-06 (configuração externa, obrigatória para fechar P2); D-08 residual (fiscal, proration e momento do downgrade no portal, Prices legados; P9/E-06); FIRE-10 (P6); PR-COMM-02/03 (P9).
- `billing-entitlement-integrity` (escopo P2A.1, 2026-09-29): **PASS**. Escopo: diff de P2A.1 (§17.7) — webhook em fases, recibo, lease, paginação, sonda de transação, `BillingProvider` após o bootstrap e reformatação dos testes.
  - Nenhuma chamada ao Stripe dentro de transação: as callbacks de claim, commit e liberação do lease só fazem leituras e escritas no Firestore; o Stripe é lido fora delas (`functions/src/billing/webhook.ts:513-523,678-706,724-732`). A sonda recusou e registraria qualquer violação em checkout, portal e webhook: 0 em 46 testes de integração.
  - Replay e concorrência: recibo `processed` ⇒ 200 sem Stripe e sem escrita; entregas simultâneas do mesmo evento ⇒ um efeito; eventos simultâneos do titular ⇒ serializados pelo lease; leitura atrasada ou evento antigo recusados pela geração; queda antes e depois do Stripe e lease vencido recuperados; erro do Stripe mantém `processing` e devolve o lease.
  - Primeiro login: catálogo e listener só depois do bootstrap (E2E em duas execuções; guarda estática no cliente).
  - Fora do escopo desta avaliação: PR-BILL-07, PR-ENT-01 e PR-AI-03 (P2B); E-06; D-08 residual; FIRE-10.
- `regression-release-gate`, `verify:all` e E2E: não executados nesta etapa, por instrução; obrigatórios no fechamento de P2.

### 17.7 P2A.1 — hardening do webhook e do bootstrap × billing (2026-09-29)

Só o hardening da P2A já entregue: sem reimplementar billing, sem quotas, sem mudança de preço, plano, regra comercial, Rules ou índices. **P2B não iniciada; PR-BILL-07 segue aberto para P2B** (§17.4). Nada foi implantado; validação só no Emulator `minhas-financas-local`, Stripe falso, sem rede nem credenciais.

**Fragilidades confirmadas no HEAD `83bb307`:**

- **A. I/O externo dentro de transação.** `functions/src/billing/webhook.ts:399-402` (HEAD) chamava `listSubscriptions` e `retrieveSubscription` no callback de `runTransaction`: chamada externa repetida a cada retry do SDK e conta do titular presa durante o I/O. Checkout e portal já chamavam o Stripe fora de transação.
- **B. Corrida bootstrap × billing.** `src/App.tsx:705` (HEAD) montava o `BillingProvider` acima do `WorkspaceProvider`: catálogo e listener de `billing_accounts/{uid}` começavam com o Auth, antes do `bootstrapAccount`. No primeiro login, a Rule `hasActiveAccount()` negava a leitura e o listener morria sem ser refeito.

| Peça | Resumo | Evidência |
| --- | --- | --- |
| Protocolo em fases | *claim* (transação curta: recibo, vínculo, conta e lease; recibo `processing`) → leitura do Stripe **fora de transação** → *commit* (transação curta: relê recibo, conta e lease e exige a geração; estado, trilha, recibo `processed` e liberação do lease no mesmo commit). Evento que não depende do Stripe (ignorado, rejeitado, reembolso, disputa) termina no claim | `functions/src/billing/webhook.ts:401-510,513-523,575-658,718-752` |
| Lease e geração | `billing_accounts/{uid}/billing_sync/reconciliation` (backend-only pela Rule curinga de `billing_accounts`): `generation` monotônica como fencing token, `holderEventId`, validade de 60 s. Ocupado ⇒ esperas de 50 ms a 1 s (cerca de 8,5 s no total) e depois 500. Erro antes do commit ⇒ lease devolvido e recibo `processing`. Queda ⇒ o lease vence e a reentrega assume com geração nova; o commit tardio de quem perdeu a geração é recusado (`superseded`) | `functions/src/billing/model.ts:134-163`; `functions/src/billing/webhook.ts:92-101,471-509,595-609,661-752`; `firestore.rules:1416-1418` |
| Recibo | `status` `processing`\|`processed`; só `processed` encerra o evento. Repetição de `processed` ⇒ 200 sem Stripe e sem escrita | `functions/src/billing/webhook.ts:342-373,409-411` |
| Paginação | `listSubscriptions` lê todas as páginas (100 por página, mesmos parâmetros e `expand`); acima de 500 assinaturas por customer falha fechada, sem decidir com lista truncada | `functions/src/billing/stripeGateway.ts:186,295-307` |
| Bootstrap × billing | O `WorkspaceProvider` expõe `isAccountReady`: o UID confirmado pelo `bootstrapAccount`, zerado no logout e na falha do bootstrap. O `BillingProvider`, agora abaixo dele, só liga catálogo e listener com a conta pronta. Sem write path novo e sem segundo bootstrap | `src/contexts/WorkspaceContext.tsx:82,113-115,147,164,217`; `src/modules/billing/BillingContext.tsx:36-51`; `src/App.tsx:706-708` |
| Sonda de teste | `AsyncLocalStorage` em todo `runTransaction` das suítes de billing; o Stripe falso recusa e registra qualquer chamada feita dentro de transação (vale para checkout, portal e webhook) | `functions/src/billing/testSupport/transactionProbe.ts`; `functions/src/billing/testSupport/fakeStripe.ts` |

**Mudança visual:** nenhuma. A troca de ordem dos providers não gera DOM; componentes, textos e classes são os mesmos.

**Validação (2026-09-29).** Emulator `minhas-financas-local`, Stripe falso, sem rede nem credenciais.

| Suíte | Resultado |
| --- | --- |
| Unitários das Functions: `billing.test.ts`, `stripeGateway.test.ts` (novo: SDK real com `fetch` falso, paginação e teto) e contrato de deploy | 36/36 |
| Integração com a sonda de transação: `webhook.integration.test.ts` (16), `webhookReconciliation.integration.test.ts` (novo, 10) e `checkout.integration.test.ts` (20) | 46/46, em duas execuções; a última, sequencial, sobre o código final |
| Cliente `test:unit:billing` (nova guarda: `BillingProvider` dentro do `WorkspaceProvider`, catálogo e listener condicionados a `isAccountReady`) | 15/15 |
| `test:unit:p1` e `test:unit:investments` (guardas que leem `App.tsx`) | 128/128 e 174/174 |
| typecheck do frontend e das Functions | OK |
| E2E `e2e/billing-bootstrap.spec.ts` (novo; resposta do `bootstrapAccount` retida por 2 s) | Duas execuções. Nas duas, para A (primeiro login, sem `users/{uid}`) e para B (conta nova, depois do logout de A, sem recarregar): nenhuma leitura de `billing_accounts/{uid}` nem chamada de `getBillingCatalog` antes da resposta do bootstrap; Free sem recarregar; catálogo carregado; listener vivo (estado gravado pelo backend aparece sem recarregar); B sem o plano de A; A, já existente, com o próprio plano. A 1ª execução falhou só numa checagem de rede que contava qualquer POST do canal do Firestore citando `billing_accounts/A` depois do login de B. É retransmissão do transporte do SDK na troca de credencial, sem listener do app. A checagem foi trocada por "nenhum listener de billing com erro durante a sessão": um listener de A vivo na sessão de B seria negado pelas Rules. A 2ª execução passou por completo e satisfez um superconjunto das asserções da versão final, que só removeu a checagem de transporte e restringiu a de erros à janela de cada sessão. A versão final não foi reexecutada isoladamente: o container ficou sem memória, com processos encerrados por SIGTERM |
| E2E `authenticated-smoke` e `workspace-membership` (convite, aceite, troca de papel e remoção) | Passaram |
| E2E `workspace-membership` ("primeiro login … logout não vaza dados") | Falha pré-existente, não introduzida por P2A.1: falha em `:115` quando roda depois de outro spec, também no HEAD `83bb307`; passa isolado nos dois (HEAD 24,7 s; P2A.1 20,1 s). Ver §17.4 |
| Lint das Functions (projeto inteiro) | 0 erros antes e depois. Avisos: 1.993 → 1.967, nenhum novo por arquivo e regra; saíram os 26 `max-len` dos testes de P2A (`billing.test.ts` 8, `checkout.integration.test.ts` 9, `webhook.integration.test.ts` 9), corrigidos só com quebra de linha: tokens idênticos ao HEAD e títulos idênticos. Os 3 de `deploymentContract.test.ts` são anteriores a P2A. Medição final com as mesmas regras sem o parser type-aware (a memória do container não comportava o type-aware); validada no HEAD, que reproduz exatamente o baseline (0/1.993) |
| `verify:all` e `regression-release-gate` | Não executados, por instrução |

**Limpeza:** nenhum comentário inline ainda atribuía billing a `users/{uid}` (busca em `src/`, `functions/src/`, `firestore.rules`, `tests/`, `e2e/`); os que citam o perfil registram a remoção. `listSubscriptions` agora pagina (tabela acima). `listOpenCheckoutSessions` segue com uma página de 100, mitigada pelo lock do checkout e pela expiração das sessões concorrentes.

**PR-BILL-07** permanece aberto e atribuído a P2B; nenhum entitlement do owner do workspace foi implementado. (Fechado depois em P2B.1, §17.8.)

### 17.8 P2B.1 — quotas de workspaces e membros, transferência e entitlement do workspace (2026-09-30)

Sobre o HEAD `ecd3f11`. Só P2B.1: sem créditos de IA (P2B.2), sem quotas de lançamentos, divisão, empréstimos, cartões, metas ou investimentos (P3–P5, D-ORD-05). Nada foi implantado; validação só no Emulator `minhas-financas-local`. **Ambientes de teste anteriores a P2B.1 precisam ser recriados** (seed/Emulator): não há migração, reconstrução por varredura nem fallback, e contas ou workspaces sem estado de quota falham fechado.

**Schema de quota (server-only; `schemaVersion` 1).**

| Documento | Campos | Invariante |
| --- | --- | --- |
| `billing_accounts/{ownerUid}/quota_state/ownership` | `billingOwnerUid`, `activeOwnedWorkspaces`, `schemaVersion`, `updatedAt` | Workspaces `active` cujo owner canônico é o titular. Nasce com 1 no primeiro `bootstrapAccount` |
| `workspaces/{workspaceId}/quota_state/membership` | `workspaceId`, `activeMembers` (inclui o owner, ≥ 1), `pendingReservations` (`inviteId → expiresAt`), `schemaVersion`, `updatedAt` | Nasce com `1` e `{}` na mesma transação que cria o workspace. O mapa tem no máximo `MAX_PENDING_RESERVATIONS` = 50 (maior `membersPerWorkspace` do catálogo): um convite só nasce com `ativos + reservas + 1 <= limite`; acima disso a leitura falha fechado |

Evidência: `functions/src/billing/quota.ts:53-81,225-268,283-385`. Estado ausente, `schemaVersion` diferente, contador inválido, mapa acima do teto, billing ausente ou `ownerId` sem membership `owner` ativo ⇒ `internal` com "Não foi possível verificar os limites do plano. Tente novamente em instantes." (`quota.ts:70,90`).

**Estratégia de reservas de convite.** Cada convite pendente reserva uma vaga até o mesmo `expiresAt` do convite. Reservas vencidas (`expiresAt <= agora`, o mesmo critério do aceite) saem do cálculo e do mapa na próxima operação que regrava o documento (convite, revogação, aceite, remoção, saída), sem cron (`quota.ts:318-335`). A operação que encerra um convite (substituição do mesmo e-mail, revogação, aceite) remove a reserva dele no mesmo commit. O documento é regravado inteiro (`transaction.set`), sem caminho de campo com `FieldValue.delete`.

**Operações (todas na transação autoritativa já existente, com `effectiveEntitlement` no relógio do servidor; nunca `planId` cru).**

| Operação | Regra | Evidência |
| --- | --- | --- |
| `bootstrapAccount` | Primeira preparação: billing Free + ownership 1 + membership `1/{}` no mesmo commit. Restauração do pessoal: relê billing e ownership, exige `ativos < limite`, incrementa. Conta ativa sem estado de quota ⇒ `internal` | `functions/src/workspaces/lifecycle.ts:168-191,219` |
| `createWorkspace` | Relê conta, billing e ownership; exige `ativos < limites.workspaces`; incrementa; cria a quota de membros. Replay pela chave devolve o resultado salvo sem incrementar | `lifecycle.ts:288-319` |
| `archiveWorkspace` | Sempre permitido; só `active → archived` decrementa (nunca abaixo de 0); replay não decrementa; a quota do workspace não é apagada | `lifecycle.ts:470-504` |
| `inviteWorkspaceMember` | Owner canônico, billing do owner e quota no mesmo `getAll`; descarta reservas vencidas e as dos convites substituídos; exige `ativos + reservas + 1 <= membersPerWorkspace`; grava a reserva com o `expiresAt` do convite. Rate limit, idempotência e auditoria preservados | `functions/src/workspaces/memberships.ts:170-205` |
| `revokeWorkspaceInvite` | Remove a reserva; repetir não mexe na quota | `memberships.ts:442-450` |
| `acceptWorkspaceInvite` | Plano atual do owner. Não membro: exige `ativos < membersPerWorkspace`, converte reserva em membro. Já membro: só libera a reserva. Downgrade entre convite e aceite pode recusar o aceite, sem apagar nada | `memberships.ts:326-372` |
| `removeWorkspaceMember`, `leaveWorkspace` | `active → removed` decrementa no mesmo commit; replay não decrementa; estado diferente de `active`/`removed` ⇒ não encontrado | `memberships.ts:473-485,576-590,642-646` |
| `changeWorkspaceMemberRole` | Não altera quota | — |
| `transferWorkspaceOwnership` | Uma leitura para destino, owner canônico, ownership dos dois, billing do destino e quota do workspace. O destino precisa de `ativos próprios + 1 <= workspaces` e de `ativos + reservas vigentes <= membersPerWorkspace` do plano efetivo dele; senão `quota_exceeded` sem mudança parcial. A origem pode estar acima da quota. Decrementa a origem, incrementa o destino, troca papéis e `ownerId` no mesmo commit. O billing da origem não é lido (não decide nada nesta operação) | `memberships.ts:679-758` |

**Owner canônico.** `workspace.ownerId` só aponta o candidato; vale apenas com membership `active`/`owner` desse uid, lido na mesma transação. Divergência falha fechado, sem adivinhar outro owner e sem varrer membros; não autoriza ninguém (`quota.ts:174-215`).

**Erro de quota.** Código `quota_exceeded` → `resource-exhausted` (`functions/src/shared/errors.ts:28,54`). Mensagem: "Limite do plano atingido. Faça upgrade em Meu Plano para continuar."; detalhes só `resource`, `planId`, `limit`, `used` (`quota.ts:58,100-106`). Na transferência quem precisa de capacidade é o destinatário: mensagem própria ("O plano do novo titular não comporta este espaço. Para receber a titularidade, ele precisa fazer upgrade em Meu Plano.") e detalhe só `resource`, sem plano nem uso da conta de outra pessoa (`quota.ts:66,108`). `domain_precondition_failed` não é usado para quota. O frontend trata `functions/resource-exhausted` como erro de negócio (`src/modules/workspaces/errors.ts:14-23`).

**Entitlement do workspace (PR-BILL-07).** `getWorkspaceEntitlement({workspaceId})`: qualquer membership ativo (inclusive `viewer`), leitura em transação somente leitura: resolvedor canônico, owner canônico, billing do owner, `effectiveEntitlement` no relógio do servidor. Resposta só `catalogVersion`, `planId`, `entitlementStatus`, `limits`; sem Stripe IDs, uid do owner ou `graceUntil`. Não membro e workspace inexistente recebem a mesma recusa. As Rules não ganharam leitura do billing do owner. `getAccountUsage({})` devolve só o `activeOwnedWorkspaces` do próprio usuário, para a ajuda de UX de "criar espaço" (o documento de quota segue backend-only). Ambas sem segredo, com o perfil de domínio (`functions/src/billing/workspaceEntitlement.ts:38-83`; `functions/src/billing/callables.ts:104-124`; `functions/src/index.ts:27-35`).

**Frontend.** `BillingProvider` separa **conta** (`accountEntitlement`, `accountPlan`, `accountUsage`, `checkAccountLimit`: Header/criação de espaço, tabela de preços, portal, modal de sucesso) e **workspace** (`workspaceEntitlement`, `checkWorkspaceLimit`: Transações, Recentes e Divisão de contas). `checkLimit`/`currentPlan` removidos, sem alias. As consultas têm chave com uid (e workspace): trocar de workspace refaz; logout/login não reaproveita; foco na janela refaz no máximo a cada 60 s, sem polling; criação e transferência invalidam as consultas (`src/modules/billing/BillingContext.tsx:72-167`; `src/modules/billing/queryKeys.ts`; `src/modules/workspaces/hooks.ts`). Lançamentos e grupos seguem só como ajuda de UX até P3/P4.

**Mudança visual:** nenhuma de layout, texto ou classe. Muda só a fonte do número: o botão "Adicionar empresa" passa a comparar workspaces **próprios** ativos com o plano da conta (antes, participações carregadas na página); os avisos de limite de lançamentos e grupos usam o plano do owner do workspace ativo. Mensagens de quota do backend passam a aparecer nos modais existentes em vez da mensagem genérica.

**Rules.** `quota_state` entrou em `isBackendOwnedCollection` (`firestore.rules:816-821`): a regra catch-all de subcoleção deixa de conceder leitura a membros; escrita já era negada. `billing_accounts/{uid}/quota_state` segue negado pela regra curinga de `billing_accounts` (`firestore.rules:1423-1425`).

**Custo e escala.** Nenhuma contagem de coleção, `get().size`, varredura, índice novo, trigger, cron ou sharding: contadores em documento único atualizados na própria transação (mutações administrativas de baixa frequência). Leituras extras por operação: 2–4 documentos. As leituras da transferência e do convite foram agrupadas num `getAll` depois que a corrida de transferências mostrou mais abortos por contenção com cinco idas ao banco (2 `internal` em cerca de 15 corridas; depois do agrupamento, 40/40 recusas limpas, igual ao HEAD).

**Validação (Emulator `minhas-financas-local`).**

| Suíte | Resultado |
| --- | --- |
| Novas: `functions/src/billing/__tests__/quotaWorkspaces.integration.test.ts` (Free/Pro/Business, último slot concorrente, replay, arquivamento e replay, downgrade com excedente, grace e cancelamento vencidos, estado ausente, bootstrap concorrente e restauração, transferência com e sem capacidade, reservas na capacidade do destino, origem acima da quota, transferências concorrentes, transferência × criação no último slot) e `quotaMembers.integration.test.ts` (owner conta, reserva, limite, substituição, revogação e replay, reserva vencida, aceite e replay, downgrade entre convite e aceite, remoção/saída e replay, troca de papel, convites e aceites concorrentes no último slot, estado ausente e owner incoerente, entitlement Free/Pro/Business, membro Free em Business, owner Business em workspace Free, viewer, transferência muda o plano, não membro = inexistente, grace/cancelamento no relógio do servidor, `getAccountUsage`) | Com as suítes de workspaces, checkout e webhook: 132/132 |
| Suítes P1 de workspaces | Fixtures de RBAC com 4 membros ou 2 workspaces receberam plano pago explícito (`seedPaidPlan`), sem mudar asserções; o teste de falha no meio do bootstrap passou a provar também a ausência de billing e quota |
| Integração completa das Functions (concorrência 2) | 315/331; as falhas: 2 por `quota_state` semeado numa checagem de "nada gravado" de investimentos (corrigido: coleção semeada), 1 corrida de transferência cuja perdedora esgotou os retries sob carga (asserção ajustada: recusa `permission-denied` ou aborto `internal`, contadores sempre conferidos) e falhas de carga em investimentos/cron (contenção em aportes concorrentes, 11 cancelados em `m3Lifecycle`, fatia do drift scan). Reexecutados isolados: `domainV2` 20/20, `m3Lifecycle` 13/13, `schedulerHandlers` 3/3 |
| Unitários das Functions (inclui `kernel.test.ts` com o novo código e contrato de deploy das duas callables) | 355/355 |
| Rules `test:rules:billing` (2 novos: quota do workspace e do titular backend-only, com controle positivo da catch-all) / `test:rules:workspaces` / `test:rules:m4` | 7/7 / 10/10 / 36/36 |
| Cliente `test:unit:billing` (6 novos: contrato, chaves por uid/workspace, provider, consumidores conta × workspace, invalidação, `resource-exhausted`) / `test:unit:p1` / `test:unit:investments` | 21/21 / 128/128 / 174/174 |
| typecheck (frontend, `e2e/`, Functions); build do frontend e das Functions | OK |
| Lint das Functions nos arquivos tocados | Avisos idênticos ao HEAD por arquivo e regra (0 novos); os `max-len` dos testes novos foram quebrados |
| `verify:all`, E2E, `regression-release-gate` | **Não executados**, por instrução. Os seeds do E2E (`e2e/support/workspaceSeed.ts`) foram levados ao schema novo, sem execução |

**Blocker fechado.**

| ID | Sev. | Blocker de origem | Evidência do fechamento | Achados de origem |
| --- | --- | --- | --- | --- |
| PR-BILL-07 | HIGH | Entitlement do workspace não derivado do plano do owner: a ajuda de UX lia o billing de quem via; membro não lê o billing do owner | `functions/src/billing/workspaceEntitlement.ts:38-67 — projeção pública pelo owner canônico`<br>`functions/src/billing/quota.ts:139-148 — effectiveEntitlement no relógio do servidor`<br>`src/modules/billing/BillingContext.tsx — checkWorkspaceLimit pelo plano do workspace`<br>`functions/src/billing/__tests__/quotaMembers.integration.test.ts` (entitlement) | BILL-08 |

**Abertos:** PR-ENT-01 (P3–P5: lançamentos, divisão e demais domínios; o enforcement desta etapa cobre workspaces, membros e transferência); PR-AI-03 (P2B.2); E-06 (obrigatória para fechar P2). **Riscos residuais:** sob carga, a perdedora de uma corrida de transferência pode receber `internal` (aborto por contenção, sem efeito parcial) em vez da recusa por papel; falhas de carga de investimentos/cron na integração completa paralela ficam para o gate de P2.

**Limpeza:** o comentário de `functions/src/workspaces/model.ts` que atribuía campos de cobrança ao perfil `users/{uid}` agora aponta `billing_accounts/{uid}`; o de `functions/src/workspaces/callables.ts` deixou de dizer que nenhuma callable consulta quota.

**Rollback:** reverter o diff de P2B.1 remove a quota e as duas callables; os documentos `quota_state` ficam sem leitor e são dados de Emulator (recriados por seed). Nada foi implantado.

**Skill:** `billing-entitlement-integrity` (escopo P2B.1, 2026-09-30): **PASS**. Quota atômica na transação autoritativa; plano efetivo do owner governa o workspace; concorrência no último slot coberta (criação, convite, aceite, transferência, transferência × criação, bootstrap); transferência correta e sem efeito parcial; `quota_state` inacessível ao cliente; PR-BILL-07 resolvido; nenhuma quota de P3–P5 implementada. Fora do escopo: PR-AI-03 (P2B.2), PR-ENT-01 restante (P3–P5), E-06, D-08 residual, FIRE-10.

### 17.9 P2B.2 — créditos de IA por plano do owner, idempotência e teto por chamada (2026-09-30)

Sobre o HEAD `f3d47ce`. Só P2B.2: sem P3, sem quotas de lançamentos ou divisão (PR-ENT-01, P3–P5), sem troca de provedor ou modelo (P5, D-11) e sem PR-AI-01, PR-AI-04 ou PR-AI-05. Nada foi implantado; validação só no Emulator `minhas-financas-local`, com provedor falso e sem rede.

**Hardening da contenção (risco residual de §17.8).** Confirmado no SDK (`@google-cloud/firestore` 7.11.6, `build/src/transaction.js:397-420,582-600`): `runTransaction` repete o callback em `ABORTED` (gRPC 10) até 5 tentativas e depois rejeita com o último erro, que o mapeador único convertia em `internal`. A repetição das suítes mostrou uma segunda assinatura: depois de um `Transaction lock timeout` no commit, a nova tentativa do SDK reabre a transação com `retryTransaction` (`transaction.js:479-481`) e o Emulator (`cloud-firestore-emulator` 1.20.2) a recusa com `BAD_REQUEST` → `INVALID_ARGUMENT` "Transaction is invalid or closed." (`EmulatorTransactionManager.reuseExisting`), que o SDK não repete (só repete `INVALID_ARGUMENT` com "transaction has expired"). Contenção (`isContentionAbortedError`) passa a ser só: código numérico 10, ou código numérico 3 cuja mensagem diz que a própria transação foi invalidada (a forma do Emulator e a de produção, "The referenced transaction has expired or is no longer valid"). Sai `aborted` com "Os dados foram alterados por outra operação. Atualize e tente novamente.", sem stack nem detalhe do Firestore, e código de log estável `concurrent_update` (`functions/src/shared/errors.ts`). Qualquer outro erro — inclusive outro `INVALID_ARGUMENT` — continua `internal`; sem retry manual, sem timeout maior; a atomicidade da transferência não mudou. O frontend de workspace trata `functions/aborted` como erro de negócio (`src/modules/workspaces/errors.ts:14-26`). A corrida de transferências (3 rodadas) aceita para a perdedora só `permission-denied` ou `aborted` e confere owner único, `ownerId`, papéis e contadores (`functions/src/billing/__tests__/quotaWorkspaces.integration.test.ts:345-379`).

**Schema (server-only; `schemaVersion` 1).**

| Documento | Campos | Invariante |
| --- | --- | --- |
| `billing_accounts/{ownerUid}/ai_usage/{YYYY-MM}` | `billingOwnerUid`, `monthKey`, `usedCredits`, `schemaVersion`, `updatedAt` | Mês civil de `America/Sao_Paulo` (`saoPauloMonthKey`). Ausente = 0; a primeira chamada aceita do mês o cria; regravado inteiro na admissão; meses anteriores nunca são lidos nem regravados. Presente e incoerente ⇒ `internal` (falha fechado). Sem cron de reset e sem TTL nesta etapa (ciclo de vida em P8) |
| `billing_accounts/{ownerUid}/ai_usage_receipts/{receiptId}` | `operation`, `actorId`, `workspaceId`, `monthKey`, `creditCost`, `requestHash`, `createdAt`, `expiresAt` | `receiptId` = SHA-256 de ator + chave; `requestHash` = SHA-256 da operação e do payload validado, salgado pela própria chave. Nunca pergunta, transcrição, base64, comprovante, prompt, resposta ou JSON extraído. TTL de 90 dias (`RETENTION_DAYS.aiUsageReceipts`; `firestore.indexes.json`, `ai_usage_receipts.expiresAt`) |

Evidência: `functions/src/billing/aiCredits.ts`; `functions/src/shared/retention.ts:54-60`.

**Admissão atômica** (`functions/src/ai/admission.ts:86-171`, substitui `consumeAiRateLimit`). Uma única transação: releitura do ator (`reassertWorkspaceActor`, papel inalterado) → owner canônico (`canonicalOwnerCandidate`) → um `getAll` com membership do owner, billing do owner, uso do mês, recibo da chave e rate limit horário → `assertCanonicalOwnerMembership` → `entitlementAt` no relógio do servidor → recibo (conflito ou já processada) → rate limit existente (`reserveRateLimitFromSnapshot`, `functions/src/shared/rateLimit.ts`) → `usados + custo <= aiCreditsPerMonth` → grava o uso, cria o recibo e confirma o rate limit no mesmo commit. Toda recusa lança antes da primeira escrita: nenhum rate limit consumido com quota recusada, nenhuma quota consumida com autorização recusada. O documento mensal do titular serializa o último crédito.

**Quota.** O pool é do billing owner (D-01): todos os workspaces de que ele é owner e todos os membros autorizados deles; após uma transferência, os usos seguintes consomem o pool do novo owner. Free 10, Pro 150, Business 750 (catálogo, sem mudança). Downgrade não apaga o uso e recusa com `usados >= novo limite`; upgrade libera até o novo teto; grace mantém o teto pago. `QuotaResource` inclui `aiCreditsPerMonth`; `quota_exceeded` → `resource-exhausted`, "Os créditos de IA deste plano acabaram neste mês. Faça upgrade ou aguarde a renovação mensal.", detalhes só `resource`, `planId`, `limit`, `used` e `periodKey`, nada do titular (`functions/src/billing/quota.ts:76-89,104-126`). Custo por operação em `AI_CREDIT_COSTS` (análise, extração de texto e de documento: 1 crédito cada; `functions/src/ai/policy.ts:31-35`), só no servidor.

**Idempotência.** `idempotencyKey` obrigatória nos dois contratos, pelo schema compartilhado `idempotencyKeySchema` (`functions/src/ai/callables.ts:77,152,158`); o cliente gera uma chave nova por ação intencional. Mesma chave e mesmo conteúdo ⇒ `failed-precondition` "Esta solicitação de IA já foi processada. Faça uma nova solicitação para consultar novamente.", sem crédito e sem provedor; outro conteúdo ⇒ `failed-precondition` "Esta chave de idempotência já foi usada com outros dados."; chamadas concorrentes com a mesma chave ⇒ no máximo um consumo e uma chamada externa. A resposta não é guardada para replay (conteúdo pessoal; P5/P8).

**Provedor e custo por chamada.** Ordem fixa: contrato e pré-checagem (kernel) → segredo (`productionAiDependencies`, antes da admissão) → admissão → provedor por um gateway mínimo (`functions/src/ai/gateway.ts`), **sempre fora de transação**. `maxOutputTokens` 1200 na análise e 600 na extração (`AI_MAX_OUTPUT_TOKENS`, `functions/src/ai/policy.ts:40-43`), com o mesmo modelo (`gemini-3-flash-preview`) e o mesmo SDK; limites de entrada e `MAX_DOCUMENT_BASE64` inalterados. Os testes montam as callables pela mesma fábrica da produção (`createAiCallables`) com provedor falso. **Política de cobrança desta versão:** o crédito representa a tentativa aceita e enviada ao provedor. Falha anterior ao commit (contrato, autenticação, papel, segredo ausente, owner incoerente, chave repetida, rate limit, quota, contenção) não consome; depois do commit, timeout, 4xx/5xx, resposta vazia e JSON inválido **não** devolvem o crédito. Sem reembolso de crédito nem fluxo compensatório.

**Uso da própria conta.** `getAccountUsage` acrescenta `aiCreditsUsed`, `aiCreditsLimit`, `aiCreditsRemaining` (nunca negativo) e `aiPeriodKey`, só do próprio titular e pelo billing efetivo da própria conta (`functions/src/billing/workspaceEntitlement.ts:67-108`). `getWorkspaceEntitlement` não expõe uso de IA: um membro inferiria o uso de outros workspaces do titular.

**Frontend.** Contrato puro `src/modules/ai/callables.ts` (chave nova por ação, `AI_CREDITS_EXHAUSTED_MESSAGE`, `isAiCreditsExhausted`) ligado ao SDK em `src/modules/ai/api.ts`; `askFinanceAI` (`src/modules/reports/api.ts`) e `TransactionModal` usam os wrappers e mostram a mensagem de créditos esgotados. No comprovante, o erro da chamada passa a ser capturado dentro do `onload` (antes escapava do `catch`). O tipo `AccountUsage` recebeu os campos novos, sem superfície visual. Histórico de IA e `localStorage` (PR-AI-04) e schema da saída (PR-AI-05) intocados.

**Mudança visual:** nenhuma de layout, classe ou componente. Só texto: a resposta do chat e o status do modal mostram a mensagem de créditos esgotados (nesse caso o status fica 6 s em vez de 3 s); contenção nos modais de workspace mostra a mensagem do backend em vez da genérica.

**Rules e índices.** Sem regra nova: `billing_accounts/{uid}/{document=**}` já nega leitura e escrita, e nenhuma regra de collection group alcança `ai_usage` e `ai_usage_receipts` (comentário explícito em `firestore.rules:1422-1429`). Um override de TTL novo; nenhum índice composto.

**Custo e escala.** Por chamada aceita: 8 leituras (3 na releitura do ator, 5 no `getAll`) em 2 idas ao banco, mais 3 escritas no commit. Sem índice novo, varredura, contagem de coleção, cron ou trigger. O documento mensal do titular é o ponto de serialização do pool, compatível com o volume de IA (20/h e 60/h por ator e workspace); sob contenção extrema a perdedora recebe `aborted`, sem consumo.

**Validação (Emulator `minhas-financas-local`, provedor falso, sem rede).**

| Suíte | Resultado |
| --- | --- |
| Nova `functions/src/ai/__tests__/aiCredits.integration.test.ts` (24): tetos Free/Pro/Business, primeiro uso cria o mês, custo 1 por operação, último crédito disputado por 4 chamadas de dois workspaces (uma vence; perdedoras só `resource-exhausted`/`aborted`), limite sem chamada ao provedor nem escrita, pool do owner para membro, dois workspaces do mesmo owner, outro owner = outro pool, transferência troca o pagador, downgrade, upgrade, grace e grace vencido, virada de mês em São Paulo com o mês anterior imutável, mesma chave concorrente (1 crédito, 1 chamada), reenvio e conflito, recibo sem conteúdo e com TTL, rate limit horário, crédito + recibo + rate limit no mesmo commit (mesmo `serverTimestamp`), provedor só depois do commit e fora de transação, `maxOutputTokens` 1200/600, falha do provedor, resposta vazia e JSON inválido mantêm o crédito, falhas antes do commit sem consumo, `getAccountUsage` × `getWorkspaceEntitlement` | Com `quotaMembers`, `quotaWorkspaces` (corrida de transferências endurecida) e `rateLimit`: 62/62 |
| Estabilidade da concorrência: `aiCredits` + `quotaWorkspaces` repetidos | 1ª série (só ABORTED classificado): 2 de 3 rodadas verdes; na 3ª a perdedora da corrida de transferências recebeu `internal` — `INVALID_ARGUMENT` "Transaction is invalid or closed." do Emulator, a segunda assinatura descrita acima. Depois da correção do classificador: 5/5 rodadas com 40/40; duas perdedoras de transferência registradas como `concurrent_update` (`WARNING`, sem `internal`). Os únicos `internal` do log vêm dos testes que exigem falha fechada (provedor falhando, owner incoerente, estado de quota ausente). Depois da correção, também: `quotaMembers` + `rateLimit` 22/22 e `test:rules:billing` 8/8 |
| Rules `test:rules:billing` (1 novo: uso e recibos de IA backend-only para titular, membro executor e anônimo; get, list, collection group, create, update, delete) | 8/8 |
| Unitários das Functions (novos: contratos com `idempotencyKey`, custos, tetos, gateway real com SDK falso, TTL; contenção no mapeador único) | 364/364 (inclui a transação invalidada como contenção e os negativos de `INVALID_ARGUMENT`; uma execução anterior acusou 1 falha do próprio teste novo — a regex recusava o `status` canônico "ABORTED" do JSON do `HttpsError` —, corrigida no teste) |
| Cliente `test:unit:billing` (7 novos em `tests/unit/ai-client.test.ts`: chaves dos schemas, chave nova por ação, mensagem de créditos, `functions/aborted`, ausência de custo, modelo, teto e credencial no cliente) / `test:unit:p1` / `test:unit:investments` (guarda do modal atualizada para os wrappers) | 28/28 / 128/128 / 174/174 |
| typecheck (frontend, `e2e/`, Functions) | OK |
| Lint das Functions nos arquivos tocados | 0 erros; avisos idênticos ao HEAD (dois `max-len` preexistentes em `ai/callables.ts` e `shared/rateLimit.ts`); 0 novos |
| `verify:all`, integração completa, E2E, build de produção, `regression-release-gate` | **Não executados**, por instrução (P2C, em ambiente limpo) |

**Blocker fechado.**

| ID | Sev. | Blocker de origem | Evidência do fechamento | Achados de origem |
| --- | --- | --- | --- | --- |
| PR-AI-03 | HIGH | Custo de IA sem teto efetivo: limite por workspace contornável, sem entitlement, App Check nem limite de tokens | `functions/src/ai/admission.ts:86-171 — teto mensal do titular na mesma transação da autorização, do recibo e do rate limit`<br>`functions/src/ai/policy.ts:31-43 — custo por operação e maxOutputTokens`<br>`functions/src/ai/callables.ts:209-227,244-275 — provedor só depois do commit`<br>`functions/src/ai/__tests__/aiCredits.integration.test.ts` (24 testes). App Check segue em PR-APPCHK-01 (P6) | RPTAI-03, ENTRY-10 |

**Separados (não resolvidos aqui):** PR-AI-01 → P8; PR-AI-04 e PR-AI-05 → P5; PR-ENT-01 → P3–P5; PR-APPCHK-01 → P6; E-06 → configuração externa ainda necessária para fechar P2 comercialmente. P2 não está concluída: o gate é P2C.

**Riscos residuais:** falha do provedor depois do commit consome o crédito (política deliberada desta versão); o reenvio da mesma chave depois de uma transferência de ownership é cobrado do novo titular (o recibo é por titular); a resposta não é reenviada para a mesma chave; `ai_usage` sem TTL (P8); sem contabilização real de tokens (P5, D-11); sem App Check (P6).

**Rollback:** reverter o diff de P2B.2 remove créditos, recibos, gateway e `idempotencyKey`; os documentos `ai_usage` e `ai_usage_receipts` ficam sem leitor (dados de Emulator). O mapeamento de contenção para `aborted` é independente e pode ser revertido sozinho. Nada foi implantado.

**Skill:** `billing-entitlement-integrity` (escopo P2B.2, 2026-09-30): **PASS**. Teto mensal real e server-side pelo plano efetivo do titular, na mesma transação da autorização, do recibo e do rate limit; pool por billing owner (membros, workspaces, transferência); último crédito concorrente com uma única vencedora (repetido 5 vezes); nenhuma segunda chamada ao provedor para a mesma chave; `maxOutputTokens` por chamada; `ai_usage` e `ai_usage_receipts` backend-only (Rules testadas); a corrida de transferências só aceita `permission-denied` ou `aborted`, nunca `internal`. Fora do escopo: checkout, portal, webhook e máquina de estados do Stripe (sem mudança), E-06, D-08 residual, FIRE-10, PR-ENT-01 restante (P3–P5), PR-APPCHK-01 (P6), PR-AI-01 (P8), PR-AI-04 e PR-AI-05 (P5).
