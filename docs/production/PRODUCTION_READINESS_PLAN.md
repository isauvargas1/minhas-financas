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
3. RBAC owner/admin/member validado server-side por um único resolvedor; Firestore Rules como segunda camada independente que nega escrita do cliente em dados autoritativos.
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
| **P0** | Fundação: instruções, skills, documentação, auditoria, plano | Em fechamento nesta entrega (§14) |
| **P1** | Auth, workspaces, memberships, RBAC, convites, ciclo de vida de conta + kernel compartilhado do backend | Não iniciado |
| **P2** | Billing Stripe, entitlements e quotas | Não iniciado |
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
- **GAP:** PR-AUTH-01, PR-AUTH-02, PR-AUTH-03, PR-AUTH-04.
- **TARGET:** identidade só do token verificado; `bootstrapAccount` idempotente cria perfil server-owned, workspace pessoal determinístico e membership; suspensão com revogação; exclusão/exportação (P8). Sequência do aceite: P1 prepara o `bootstrapAccount` para receber o registro de aceite; P8 define documentos, versões e o registro server-side de aceite e consentimentos; P9 torna o aceite obrigatório no cadastro.

### 5.2 Workspaces/memberships/RBAC/invites — [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md)
- **CURRENT:** criar workspace, adicionar/remover membro e trocar papel são escritas do cliente (`src/modules/workspaces/api.ts:180-273`), sem callable, transação, auditoria ou quota. Rules M4.C validam papel e bloqueiam autopromoção, com testes. Autoridade dupla `ownerId` × membership e dois resolvedores de papel no backend (`functions/src/creditCards/auth.ts`, `functions/src/investments/infrastructure.ts`).
- **GAP:** PR-WS-01…PR-WS-06.
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
- **CURRENT:** chave só no backend (Secret Manager); entrada validada com Zod; RBAC; rate limit por workspace+ator. Saída sem schema; contexto enviado pelo cliente; modelo preview e SDK legado; histórico de chat em localStorage; dados e comprovantes enviados ao Gemini sem transparência. A chave esteve embutida no bundle até ago/2026 e a rotação não está comprovada.
- **GAP:** PR-AI-01…PR-AI-05.

### 5.15 Billing/Stripe — [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md)
- **CURRENT:** callable de checkout com allowlist de preço e de origem e rate limit; webhook com verificação de assinatura, tratando só `checkout.session.completed` e gravando `planId: 'pro'` em `users/{uid}`. Segredos com fallback placeholder. Sem portal, cancelamento, revogação, idempotência por evento ou testes de comportamento.
- **GAP:** PR-BILL-01…PR-BILL-08.

### 5.16 Entitlements/quotas — [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md)
- **CURRENT:** limites só em `src/constants/plans.ts` e `checkLimit` no cliente; backend e Rules desconhecem planos.
- **GAP:** PR-ENT-01, PR-AI-03.

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
- **GAP:** PR-COMM-01…PR-COMM-03, PR-BILL-04.

### 5.23 Admin capabilities — [SECURITY_MODEL.md](SECURITY_MODEL.md), [RUNBOOKS.md](RUNBOOKS.md)
- **CURRENT:** `isAdmin` lido pelo cliente de `users/{uid}` (não autoconcedível, com teste); painel placeholder; nenhuma callable administrativa.
- **GAP:** PR-ADMIN-01 (DECISION D-10).

### 5.24 CI/release process — [RUNBOOKS.md](RUNBOOKS.md), [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md)
- **CURRENT:** CI de qualidade sem segredos em Node 22/24; deploy manual da estação do desenvolvedor para o único projeto; sem CD, proteção de branch evidenciada, versionamento de release ou rollback testado.
- **GAP:** PR-REL-01, PR-REL-02, PR-PLAT-01.

### 5.25 Transversais — plataforma e dinheiro
- **Plataforma (CURRENT):** um único projeto Firebase (`.firebaserc`), usado também como desenvolvimento; Hosting sem headers de segurança; Tailwind Play CDN, Google Fonts e sons do Mixkit carregados de terceiros em runtime; importmap `esm.sh` publicado no HTML (requisição em runtime não comprovada). **GAP:** PR-PLAT-01…PR-PLAT-03, PR-AUTH-04.
- **Dinheiro (CURRENT):** centavos/micros inteiros só em investimentos; metas gravam float e centavos lado a lado; os demais domínios usam reais em float com arredondamentos divergentes. **GAP:** PR-MONEY-01 e itens de cada domínio.

---

## 6. Registro de blockers

Itens BLOCKER e HIGH consolidados, mais quatro MEDIUM (três ligados a alegações da §4 e PR-RULES-02). A evidência mostra as duas primeiras referências dos achados de origem verificados; a lista completa está nos documentos de domínio. Um item só sai deste registro quando o milestone indicado o fechar com evidência e gate `PASS` (atualizar a coluna na §15).

#### Authentication/account lifecycle

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-AUTH-01 | BLOCKER | P8 | Sem exclusão de conta, exportação de dados nem cancelamento de assinatura na saída do titular | `functions/src/index.ts:13-37 - sem auth trigger/callable de conta`<br>`firestore.rules:1467 - users delete false; sem allow delete em workspaces (990-1008)` | AUTH-01, PRIV-02, PRIV-03 · C26 |
| PR-AUTH-02 | BLOCKER | P9 | Cadastro sem Termos de Uso, Política de Privacidade e registro server-side de aceite versionado | `src/components/auth/LoginView.tsx:15-53 - só botão Google e 'Ambiente seguro © 2024'`<br>`grep 'Termos\|Privacidade\|LGPD' em src: 0` | AUTH-02, PRIV-01 · C26 |
| PR-AUTH-03 | HIGH | P1 | Bootstrap de conta e do primeiro workspace no cliente, não atômico e não idempotente; perfil users/{uid} sem dono server-side | `src/contexts/WorkspaceContext.tsx:47-62,117-121`<br>`src/modules/workspaces/api.ts:83-85,103-105,137-139 - erros engolidos` | AUTH-03, AUTH-12, WS-07 |
| PR-AUTH-04 | HIGH | P6 | Login E2E com credenciais fixas no código de produção e artefato de Hosting compartilhado com o build E2E | `src/contexts/AuthContext.tsx:94-114`<br>`src/lib/firebase.ts:47-62 - sem assert E2E=>emulador` | AUTH-13, REL-05 |

#### Workspaces/memberships/RBAC/invites

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-WS-01 | BLOCKER | P1 | Convite de membro inexistente: UID fictício gerado no cliente, sem token, expiração, e-mail ou aceite | `src/components/MembersManagerModal.tsx:53-66 — fakeUid`<br>`firestore.rules:1021-1026 — memberId arbitrário aceito` | WS-01, AUTH-05, RULES-07 · C05 |
| PR-WS-02 | HIGH | P1 | Mutações de membership no cliente, não atômicas, com escrita parcial determinística e sem auditoria | `src/modules/workspaces/api.ts:236-264 — escritas sequenciais`<br>`firestore.rules:1478-1485 — espelho só do próprio uid` | WS-02, FEW-08, WS-11, ENTRY-09 · C04 |
| PR-WS-03 | HIGH | P1 | Fontes concorrentes de papel: espelho autogravado, fallback collectionGroup morto, ownerId × membership e resolvedores duplicados | `src/modules/workspaces/api.ts:61-84 — espelho como fonte`<br>`src/modules/workspaces/api.ts:106-136 — collectionGroup members` | WS-03, WS-10, AUTH-07, READ-14, RULES-18 |
| PR-WS-04 | HIGH | P1 | ownerId pode ser trancado fora do próprio workspace via status (co-owner/admin) | `firestore.rules:13-14 — isMember depende de status`<br>`firestore.rules:27-33 — owner-by-parent falha se o doc existe e está inativo` | WS-04, RULES-08 |
| PR-WS-05 | HIGH | P1 | Criação de workspace pelo cliente sem validar type PF/PJ e com falhas de payload (a quota é tratada em PR-ENT-01) | `firestore.rules:991-994 - allow create`<br>`firestore.rules:108-135 - aceita type/userId, sem enum de type` | AUTH-04, RULES-06, FEW-10, WS-08 |
| PR-WS-06 | HIGH | P1 | Sem testes de membership/workspace (Rules cross-tenant, espelho, convites, criação) | `tests/firestore/m4-hardening.rules.integration.test.mjs:257-355,548-559,857-871 — só casos intra-tenant de papel/membership; nenhum cross-tenant, de espelho, convite ou criação de workspace`<br>`e2e/authenticated-smoke.spec.ts:3-6 — apenas login` | WS-06, AUTH-16 |

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
| PR-AI-03 | HIGH | P2 | Custo de IA sem teto efetivo: limite por workspace contornável, sem entitlement, App Check nem limite de tokens | `functions/src/shared/rateLimit.ts:49-66 — chave por workspace+ator`<br>`functions/src/shared/__tests__/rateLimit.integration.test.ts:67 — 'isolado por ator e por workspace'` | RPTAI-03, ENTRY-10 |
| PR-AI-04 | HIGH | P5 | Histórico do chat de IA em localStorage vaza entre workspaces e usuários; não é limpo no logout | `src/modules/reports/hooks.ts:343 — chave sem uid`<br>`src/modules/reports/hooks.ts:348-358 — load não reseta; save grava estado antigo na chave nova` | RPTAI-08, PRIV-06, AUTH-11 |
| PR-AI-05 | MEDIUM | P5 | Saída da IA sem schema forte e contexto forjável pelo cliente (prompt injection) | `functions/src/ai/callables.ts:146-150,223-249`<br>`src/components/TransactionModal.tsx:651-676` | RPTAI-09, RPTAI-10, MONEY-14 · C20 |

#### Billing/Stripe

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-BILL-01 | BLOCKER | P2 | Ciclo de vida da assinatura ausente: só checkout.session.completed; plano nunca é revogado | `functions/src/webhooks/stripe.ts:60 — único evento tratado`<br>`functions/src/webhooks/stripe.ts:97-107 — grava 'active' fixo` | BILL-02, ENTRY-01 · C03 |
| PR-BILL-02 | BLOCKER | P2 | Sem Customer Portal nem caminho de cancelamento pelo produto | `grep billingPortal em functions/src e src — sem resultado`<br>`src/components/SettingsView.tsx:252,552 — sem seção de plano` | BILL-03, COMM-02 · C03 |
| PR-BILL-03 | BLOCKER | P2 | Checkout permite assinatura duplicada e cobrança em dobro; sem escopo de workspace | `functions/src/callables/billing.ts:136-144 — sem customer existente, sem idempotencyKey`<br>`src/modules/billing/components/PricingTable.tsx:48-63 — não usa usePlan` | BILL-04, ENTRY-05, BILL-09 |
| PR-BILL-04 | BLOCKER | P2 | Catálogo inconsistente: Pro e Business com o mesmo priceId, preço literal na UI e Business nunca concedido | `src/constants/plans.ts:15,26 — mesmo priceId`<br>`src/modules/billing/components/PricingTable.tsx:42 — preço literal` | BILL-05, MONEY-12, COMM-03 · C02 |
| PR-BILL-05 | HIGH | P2 | Segredos Stripe com fallback placeholder (fail-open) | `functions/src/webhooks/stripe.ts:9 — fallback whsec_placeholder`<br>`functions/src/webhooks/stripe.ts:52 — constructEvent com o fallback` | BILL-06, ENTRY-04, FIRE-10 |
| PR-BILL-06 | HIGH | P2 | Webhook sem idempotência por event.id, sem controle de ordem e sem trilha de auditoria | `functions/src/webhooks/stripe.ts:49-110 — sem uso de event.id`<br>`functions/src/webhooks/stripe.ts:97 — set merge direto, sem transação ou registro` | BILL-07, BILL-16 · C03 |
| PR-BILL-07 | HIGH | P2 | Entitlement por usuário, com campos concorrentes e sem RBAC de quem contrata | `functions/src/webhooks/stripe.ts:97-105 — plano em users/{uid}, isPro duplicado`<br>`src/hooks/usePlan.ts:20-26 — lê o plano do usuário que está vendo` | BILL-08 |
| PR-BILL-08 | HIGH | P2 | Checkout e webhook sem testes de comportamento | `functions/src/callables/__tests__/billing.test.ts:1-91 — só helpers`<br>`functions/src/shared/__tests__/rateLimit.integration.test.ts:7 — importa só reserveRateLimit e rateLimitDocumentId (nenhum código de checkout/webhook)` | BILL-13, REL-08 |

#### Entitlements/quotas

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-ENT-01 | BLOCKER | P2 | Quotas de plano aplicadas somente no frontend; nenhum entrypoint ou Rule aplica plano/quota | `src/hooks/usePlan.ts:36-38 — enforcement só no cliente`<br>`src/modules/workspaces/api.ts:196 — workspace criado pelo cliente` | BILL-01, ENTRY-02, WS-05, TX-10, SPLIT-07, FEW-09, INV-03, CC-14, LOAN-15, CR-15, GOAL-08, REC-14 · C01 |

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

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-MONEY-01 | HIGH | P1 | Sem módulo Money único: float em reais na maioria dos domínios e helpers de arredondamento divergentes | `src/components/TransactionModal.tsx:393-394 — EPSILON`<br>`src/components/CreditCardsView.tsx:320 — EPSILON inline` | MONEY-11 |

#### Documentação

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-DOCS-01 | MEDIUM | P0 | README e documentação operacional contradizem o HEAD | `README.md:13 vs firebase.json:25-58`<br>`README.md:47 vs package.json test:integration:emulator` | DOCS-01, REL-14, FIRE-14 · C22 |

---

## 7. Legado a remover

Inventário do que a política de legado (§1) manda remover quando a arquitetura substituta assumir. Nada disso é removido em P0.

| Milestone | Caminho legado / fonte concorrente | Substituto |
| --- | --- | --- |
| P1 | Convite com `fakeUid`; `addMember`/`removeMember`/`updateMemberRole`/`syncUserWorkspaceMembership` no cliente | Callables de convite, aceite, papel e remoção com auditoria |
| P1 | `ensureOwnerMembership` (escrita a cada leitura), query por `ownerId`, fallback `collectionGroup('members')` morto | Índice do usuário mantido pelo backend; `createWorkspace` atômico |
| P1 | Espelho `users/{uid}/workspaces` gravável pelo cliente com `role` usado como `myRole` | Índice `write: false`; papel lido do membership |
| P1 | Regime duplo `ownerId` × membership (`isWorkspaceOwnerByParent`, fallback no backend); resolvedores de papel duplicados | Membership ativo como fonte única; módulo único `functions/src/shared` |
| P1 | Campo legado `userId` em workspace; tipos `Workspace` duplicados; placeholders `Owner` e `usuario-sem-email@sistema` | Tipo único; dados do token verificado |
| P1 | Provisionamento preguiçoso no cliente (`seedLegacySettingsCatalog` a cada seleção, onboarding após create) | Provisionamento idempotente no `bootstrapAccount`/`createWorkspace` |
| P2 | `src/constants/plans.ts` e `checkLimit` como fonte de limites; `planId` por usuário com campos concorrentes | Catálogo versionado no backend; estado de assinatura único; entitlements server-side |
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
- **Kernel (D-ORD-02):** resolvedor único de membership/papel relido dentro da transação, sem fallback `ownerId`; wrapper de callable (autenticação, política de `email_verified`, Zod estrito com IDs sem `/`, rate limit, idempotência, mapeador de erros pt-BR, ponto de extensão para App Check); gravador de auditoria append-only; contrato de logger estruturado e correlation ID; módulo `money` (centavos, parse, alocação por maior resto) espelhado no frontend; política de datas civis em `America/Sao_Paulo`.
- **Domínio:** `bootstrapAccount`, `createWorkspace`, `updateWorkspaceSettings`, convites (token, expiração, e-mail verificado), aceite, revogação, troca de papel, remoção lógica, saída voluntária, transferência de ownership, arquivamento de workspace; Rules `write: false` em `members`, índice do usuário e criação de workspace; suspensão com revogação de sessão; logout limpando estado local.
- **Blockers:** PR-AUTH-03, PR-WS-01…PR-WS-06, PR-MONEY-01 (módulo e política; adoção por domínio em P3–P5).
- **Achados MEDIUM também fechados em P1:** AUTH-08 (política de `email_verified`/provedor), AUTH-09 (suspensão e revogação de sessão no backend; as ferramentas administrativas ficam em PR-ADMIN-01/P7), AUTH-10 (erros de login e de carga em pt-BR), AUTH-11 (logout limpa cache e armazenamento local; a migração do histórico de IA para o servidor fica em PR-AI-04/P5), WS-09, WS-11, WS-13, WS-15.
- **Índice do usuário:** mantém o caminho `users/{uid}/workspaces`, passando a ser gravado só pelo backend (sem renomear a coleção).
- **Depende de decisões:** D-01, D-02, D-03, D-04, D-05, D-06, D-17, D-22, D-34.
- **Skills:** `multi-tenant-security-review`, `firestore-scale-cost-review`, `financial-domain-integrity` (módulo `money`), `firebase-production-readiness` (novos exports de Functions), `ptbr-product-ui-review`, `observability-incident-readiness` (contrato de logging e auditoria), `regression-release-gate`.

### P2 — Billing, entitlements e quotas
- **Objetivo:** ciclo de vida comercial completo e enforcement server-side.
- **Escopo:** catálogo de planos versionado no backend (preço por ambiente, centavos BRL, entitlements); estado de assinatura único gravado só pelo webhook; webhook com `event.id` idempotente, ordem, eventos de assinatura/fatura/reembolso/disputa, grace period e auditoria; checkout sem assinatura duplicada; Customer Portal; segredos sem fallback; função de entitlements; enforcement em workspaces, membros, checkout e IA; API de quota usada pelos callables de P3–P5.
- **Blockers:** PR-BILL-01…PR-BILL-08, PR-AI-03; PR-ENT-01 parcial (fecha em P5, D-ORD-05).
- **Depende de decisões:** D-01, D-07, D-08, D-11.
- **Configuração externa:** E-06.
- **Skills:** `billing-entitlement-integrity`, `multi-tenant-security-review`, `firestore-scale-cost-review`, `firebase-production-readiness` (segredos e exports), `observability-incident-readiness` (auditoria e falhas de webhook), `ptbr-product-ui-review`, `saas-commercial-readiness` (checkout e cancelamento no produto), `regression-release-gate`.

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

---

## 10. Decisões pendentes (DECISION)

| ID | Decisão | Bloqueia | Opções levantadas pela auditoria |
| --- | --- | --- | --- |
| D-01 | Escopo do plano: por usuário (hoje `users/{uid}.planId`) ou por workspace (entidade pagadora) | P1, P2 | Por workspace simplifica PJ faturado por empresa e quotas de membros; definir quem conta no limite de workspaces compartilhados e convites pendentes. |
| D-02 | Modelo de papéis: manter `viewer` (presente em tipos, Rules e backend) ou reduzir para owner/admin/member; matriz de papéis por operação financeira (quem cria, edita, estorna e arquiva em cada domínio) | P1 | A UI rotula `member` como "Membro (Editor)". |
| D-03 | Owner canônico único ou múltiplos owners; regras de transferência e de último owner | P1 | — |
| D-04 | Poderes do admin sobre outros admins (promover, rebaixar, remover) | P1 | — |
| D-05 | UX de convite: link com token por e-mail ou código; expiração; convite para e-mail sem conta; provedor de e-mail transacional | P1 | Exige E-11. |
| D-06 | Provedores de login (só Google, e-mail/senha, Apple), MFA (opcional ou obrigatória para owners/PJ), política de sessão | P1 | E-mail/senha exige verificação, reset e textos pt-BR. |
| D-07 | Exclusão de conta: destino de workspaces próprios e compartilhados, retenção fiscal × eliminação LGPD, anonimização do ator em histórico compartilhado | P2, P8 | Resolver o conflito entre "sem hard delete de histórico" e eliminação a pedido. |
| D-08 | Catálogo comercial: planos, preços, limites, trial, grace period, proration, downgrade com excedente, reembolso, tratamento fiscal (NFS-e/ISS, Stripe Tax) | P2, P9 | Hoje Pro = Business no código. |
| D-09 | Mensagens: remover do produto até existir backend real, ou implementar | P5 | A auditoria recomenda remover no lançamento (funcionalidade simulada exposta). Remover altera a UI e exige aprovação. |
| D-10 | Painel administrativo: implementar com custom claim e callables auditadas, ou remover | P7 | — |
| D-11 | IA: provedor e tier contratual (Vertex AI × chave AI Studio), minimização do payload, consentimento, quotas por plano, envio de comprovantes e voz | P2, P5, P8 | Modelo atual é preview com SDK legado (FIRE-11). |
| D-12 | Recorrentes: frequências suportadas; cobrança no cartão automática no vencimento ou por confirmação | P3, P4 | Hoje semanal/quinzenal perdem cobranças. |
| D-13 | Empréstimos: modelos de amortização (Price, SAC, simples), juros, diferenças PF/PJ classificação contábil do principal (hoje gravado como receita/despesa de consumo) e obrigatoriedade de lançamento de caixa na contratação | P3 | — |
| D-14 | Divisão de contas: participantes precisam ser membros do workspace? participantes externos; fluxo de reembolso PJ | P4 | — |
| D-15 | Investimentos: manter ou remover as 13 callables e a UI profissional sem ponto de montagem | P4 | Política de legado favorece remover se o produto não as oferece. |
| D-16 | Moeda: somente BRL (remover `Workspace.currency` gravável e ignorado) ou multimoeda | P3 | — |
| D-17 | Fuso canônico `America/Sao_Paulo` para chaves de data civil em todos os domínios | P1, P3, P4 | Recomendado; hoje há três definições de janela. |
| D-18 | Prazos de retenção por categoria (conta, dados financeiros, dados de terceiros, logs, auditoria, backups, pós-cancelamento) | P5, P8 | Validar com jurídico. |
| D-19 | Mapeamento de ambientes: o projeto atual `sistema-financeiro-pesso-20698` vira DEV/STAGING e cria-se um PROD novo, ou o contrário | P6 | O código e os documentos já tratam o projeto atual como desenvolvimento; ele contém apenas dados de teste. |
| D-20 | Troca do Tailwind Play CDN por Tailwind compilado, com critério de paridade visual | P6 | Risco de alteração visual; exige comparação por screenshot. |
| D-21 | Identidade jurídica do fornecedor (razão social, CNPJ, endereço), encarregado de dados e canal de suporte | P7, P9 | Necessário para rodapé, páginas legais e LGPD. |
| D-22 | Workspace PF pode ter membros ou compartilhamento é só PJ; CNPJ obrigatório e único para PJ | P1, P9 | — |
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
| D-34 | Política de centavo residual na divisão de valores (maior resto, primeiro ou último item) e recusa de frações abaixo do centavo na entrada | P1 | Parte do módulo `money` do kernel (D-ORD-02). |
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
