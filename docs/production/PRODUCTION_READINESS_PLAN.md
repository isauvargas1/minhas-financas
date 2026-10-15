# Plano mestre de Production Readiness

Documento mestre do programa que leva o backend do Minhas Finanças a ficar tecnicamente pronto para uso comercial em produção. Todo trabalho do programa parte daqui. Os demais documentos de `docs/production/` detalham cada tema e remetem aos IDs deste plano.

- **Baseline auditada:** `main` @ `9c3ab462071f3e8e44c5b2975da9e2c2086ca631` (2026-09-27).
- **Milestone atual:** P0 — fundação e documentação (ver §2 e §14).
- **Regra de leitura:** este plano registra estado auditado, alvo e lacunas. Ele **não prova** implementação. Antes de qualquer mudança, confirme o código real no HEAD.
- **Identidade do produto (registrada na P5-D2):** nome oficial **FênixGran**, slogan "Sua grana em uma nova fase". `DINDIN` e `minhas-financas` seguem como identificadores técnicos e históricos; sem rebranding visual até as fases de UI/UX aprovadas, e sem renomear repositório, project ID do Firebase, coleções, funções publicáveis, variáveis internas estáveis ou identificadores de billing (ver `AGENTS.md`).

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
| **P2** | Billing Stripe, entitlements e quotas | Em andamento — P2A (billing canônico, catálogo e lifecycle Stripe) concluída em 2026-09-29 e endurecida em P2A.1 (§17, §17.7); P2B.1 (quotas de workspaces e membros, transferência de ownership, entitlement do workspace pelo owner) concluída em 2026-09-30 (§17.8); P2B.2 (créditos de IA por plano do owner, idempotência, teto de saída e contenção como `aborted`) concluída em 2026-09-30 (§17.9); P2C (gate de P2) executada em 2026-10-02 — `regression-release-gate` **FAIL** (§17.10); P2C-H2 removeu os bloqueadores técnicos (Tailwind local, E2E de checkout e portal, causa raiz do travamento de `simpleMode`, `lib/` limpo, evidência visual; §17.11): gate **A (conclusão técnica) PASS**, gate **B (prontidão comercial/produção) FAIL**. **Tecnicamente concluída; fechamento formal pendente de E-06 e PR-AI-02/E-00** (ações externas). E-06 — EXTERNAL CONFIGURATION REQUIRED |
| **P3** | Caixa autoritativo (transactions), Empréstimos, Clientes/Recebíveis, contas/carteiras e transferências (D-30) | **Concluída no escopo próprio** — P3-A…P3-J entregues (§18.1–§18.10); D-13, D-24, D-29, D-30, D-35, D-38, D-39 e D-40 tomadas e implementadas. **Fechamento global do ledger depende da convergência P4 e dos gates transversais explicitamente atribuídos a P5/P7/P8** (dependências abaixo). PR-TX-03 parcial; PR-TX-01, PR-TX-02 e PR-TX-05 entregues no escopo da P3 e abertos na parte da P4. |
| **P4** | Convergência de Recorrentes, Divisão de contas, Cartões e Transações | **Concluída** em 2026-10-08 — P4-A (cartões de crédito autoritativos em centavos, D-36, faturas, limite e integração com contas) concluída em 2026-10-06 (§19.1); P4-B (recorrentes autoritativos, D-12, geração segura e integração com Caixa e Cartões) concluída em 2026-10-07 (§19.2); P4-C (Divisão de contas autoritativa, D-14, rateio exato, reembolso PJ e integração com Caixa e Cartões) concluída em 2026-10-07 (§19.3); P4-D (D-15: Investimentos definitivos, superfície única, integração com contas e fechamento dos escritores de `transactions` no cliente) concluída em 2026-10-07 (§19.4); P4-E (D-23: catálogo de configurações backend-authoritative, unicidade transacional, Rules somente leitura e PR-RULES-03) concluída em 2026-10-07 (§19.6). Gate final da P4 executado em 2026-10-08 (§19.7): **P4 GATE PASSED**, `regression-release-gate` **PASS**. |
| **P5** | Metas, Relatórios, Notificações, Mensagens, IA | **Em andamento** — P5-A (isolamento do histórico do chat de IA, PR-AI-04, D-41) implementada em 2026-10-08 e aguardando auditoria independente (§20.1); P5-D1 (correção da infraestrutura de notificações: estado privado por usuário, Rules, paginação, sem polling; parte de PR-NOTIF-01) implementada em 2026-10-08 e aguardando auditoria independente (§20.2); P5-B (consolidação do domínio de Metas, PR-GOAL-01…04, D-31) implementada em 2026-10-09 (§20.3) e complementada na P5-B.1 após a auditoria independente (§20.4), aguardando nova auditoria independente; P5-C1 (relatórios financeiros e Dashboard autoritativos, D-37 aprovada integralmente em 2026-10-09) implementada em 2026-10-10 (§20.5) e complementada na P5-C1.1 após a auditoria independente (§20.6: fatura atual, futuro e atraso do cartão classificados sem sobreposição; corrida do I07 testada), aguardando nova auditoria independente; P5-C2 (contrato único de `transactions`, PR-TX-03; M2, M3, L5 e L8; desenho da D-18) implementada em 2026-10-11 (§20.7), aguardando auditoria independente; D-18-NOTIF (retenção de 180 dias e exclusão individual das notificações, com Q-1, L-4 e L-5 residuais da P5-C2) implementada em 2026-10-11 (§20.8), aguardando auditoria independente, com TTL declarado e não publicado (E-07); P5-D2 (notificações persistentes por produtores oficiais, contagem exata de não lidas e fim da falsa leitura dos Relatórios; PR-NOTIF-01 e PR-RPT-04) implementada em 2026-10-11 (§20.9), aguardando auditoria independente; P5-D2.1 (avisos de recebível vencido sem limite de dias, D-42: fila durável na transação do domínio, confirmação por episódio sem TTL, rotina horária com recuperação e cota por workspace) implementada em 2026-10-12 (§20.10), aguardando auditoria independente; P5-E1 (consolidação da IA, D-11.1–D-11.4: contexto autoritativo do backend, confirmação antes de cada envio, extração estruturada e SDK atual) implementada no working tree em 2026-10-12 (§20.11) e **não concluída**: gate `FAIL` por bloqueadores alheios ao código (porta 8080 presa por um emulador órfão e falha intermitente preexistente das notificações no celular); P5-E1.1 (minimização adicional do contexto da IA, estabilização do arquivamento no celular e gate de regressão) implementada em 2026-10-13 (§20.12), aguardando auditoria independente; P5-E2, P5-F e o gate da P5 não iniciados. |
| **P6** | Hardening Firebase e segurança (ambientes, App Check, Hosting, IAM, CD) | Não iniciado |
| **P7** | Observabilidade, auditoria, backup/restore, incidentes, admin/suporte | Não iniciado |
| **P8** | Privacidade/LGPD e ciclo de vida de dados | Não iniciado |
| **P9** | Cadastro, landing, preços, páginas legais, prontidão comercial | Não iniciado |
| **P10** | Auditoria adversarial e gate completo de produção | Não iniciado |

**Dependências herdadas da P3** (nenhuma é dada como resolvida pela P3):
- **P4 — convergência: entregue na P4-A…P4-E.** Cartões (P4-A, §19.1), Recorrentes (P4-B, §19.2), Divisão de contas (P4-C, §19.3, sem `parcelado`) e Investimentos (P4-D, §19.4) gravam o fato só pelo backend e movem a conta no mesmo commit; correção e baixa de lançamento de outro domínio não são feitas pelo cliente (a tela mostra aviso e as Rules negam toda escrita em `transactions` desde a P4-D). PR-TX-01, PR-TX-02, PR-TX-05 e PR-TX-06 resolvidos (fechados no gate de P4, §19.7); a tela de contas cita todos os produtores do livro-razão. A dupla `value`/`valueCents` e `date`/`transactionDate` (PR-TX-03) sai com a fórmula única (P5). O catálogo de configurações também é só do backend desde a P4-E (D-23, §19.6). A P4 foi concluída no gate de 2026-10-08 (§19.7).
- **P5 — relatórios:** fórmulas de relatório no navegador, log do gatilho e stubs (perfil de dívida, ranking de clientes por amostra) — PR-TX-03 (parte de relatórios), PR-RPT-*.
- **P7 — operação:** reconciliação agendada (acumulados × movimentos × espelhos × saldos de contas) e detector de deriva da projeção (PR-TX-04). Hoje existe só a ferramenta local `tools/accounts/reconciliar-contas.mjs`, restrita ao Emulator.
- **P8 — dados:** ciclo de vida dos dados de terceiros de clientes (PR-CR-05, D-07, D-18).

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
| C06 | Autorização interna insegura em Split Bills | **RESOLVIDA na P4-C (§19.3)** | `functions/src/callables/splitGroups.ts:115-137`; `firestore.rules:1389-1392` | A escalada cross-tenant (INV-P2-037) já está fechada. **Resolvida na P4-C (§19.3):** papel de dono e de participante gravados só pelo backend e relidos na transação; identidade pelo `uid`; aceite de convite com rate limit que conta as falhas. | PR-SPLIT-04 |
| C07 | Loans com autoridade financeira no cliente | **CONFIRMADA** | `src/modules/loans/api.ts:340-369`; `src/components/PJLoanDetailsView.tsx:88-101`; `firestore.rules:1351-1359` | Não há nenhum backend de empréstimos. **Resolvida na P3-H (§18.8):** autoridade só no backend; as linhas citadas não existem mais. | PR-LOAN-01 |
| C08 | Concorrência de saldo em empréstimos PJ | **CONFIRMADA** | `src/components/PJLoanDetailsView.tsx:90-101`; `src/modules/loans/api.ts:227-241,355-357` | Resulta em dupla dedução ou lost update. **Resolvida na P3-H (§18.8).** | PR-LOAN-02 |
| C09 | Operações caixa/empréstimo não atômicas | **CONFIRMADA** | `src/components/LoanFormModal.tsx:78-89`; `src/components/PJLoanDetailsView.tsx:73-101` | Os vínculos `loanId`/`loanMovementId` usam IDs temporários que nunca batem com os documentos gravados. **Resolvida na P3-H (§18.8).** | PR-LOAN-03, PR-LOAN-05 |
| C10 | Hard deletes financeiros | **RESOLVIDA na P4-C (§19.3)** (era PARCIAL) | `src/modules/loans/api.ts:262,280`; `src/modules/clients/api.ts:81-89,144`; `firestore.rules:1118` | **Desatualizada para `transactions`:** exclusão virou baixa lógica (`voidedAt`), Rules negam delete (`firestore.rules:1094`) e há teste. **Resolvida para split_* na P4-C (§19.3)** (arquivamento, inativação, anulação compensatória; Rules negam `delete`); **resolvida para clients e receivables na P3-I (§18.9)**, **para `credit_cards` na P4-A (§19.1)** e **para recurring_* na P4-B (§19.2)** (cancelamento terminal sem exclusão; Rules negam `delete`) (arquivamento/reativação; Rules negam `delete`); sem exclusão física (arquivamento e cancelamento lógicos, estorno compensatório), Rules negam `delete` a todo papel. | PR-LOAN-04 (resolvido na P3-H: empréstimos sem delete), PR-CR-02 (resolvido na P3-I), PR-SPLIT-02, PR-CC-01, PR-RULES-01 |
| C11 | Clients/Receivables com escrita direta e órfãos | **CONFIRMADA** | `src/modules/clients/api.ts:59-144`; `firestore.rules:1361-1369` | **Resolvida na P3-I (§18.9):** escrita só pelas 8 callables de `functions/src/receivables/`; Rules negam `create`/`update`/`delete` nas seis coleções; cascata e hard delete removidos; as linhas citadas eram do modelo removido. | PR-CR-01, PR-CR-02 (resolvidos) |
| C12 | Recorrente com integração incorreta de `cardId` | **CONFIRMADA** | `src/components/RecurringExpenseDetailsView.tsx:119-121` (`parseInt`); `functions/src/crons/recurring.ts:322-343` | O cron ignora o cartão e gera despesa de caixa. **Resolvida na P4-B (§19.2):** a recorrência no cartão gera compra P4-A pela primitiva do domínio de cartões; as linhas citadas eram do modelo removido. | PR-REC-04 |
| C13 | Ocorrência marcada sem transação confirmada | **CONFIRMADA** | `src/components/RecurringExpenseDetailsView.tsx:98-125,169-170`; `firestore.rules:67-76` | A transação é sempre negada pelas Rules (chave `id` fora da allowlist) e a ocorrência fica "gerada" com `despesaId` fantasma; o cron pula o mês para sempre. **Resolvida na P4-B (§19.2):** `handleGenerate` removido; ocorrência `generated` só no mesmo commit do fato, pelas callables e pela rotina. | PR-REC-02 |
| C14 | `recurring_occurrences` controlável pelo cliente | **CONFIRMADA** | `firestore.rules:1102-1105` | Exposição intra-workspace (membership bloqueia cross-tenant). **Resolvida na P4-B (§19.2):** `create, update, delete: if false` nas três coleções `recurring_*`, com teste de Rules. | PR-REC-01 |
| C15 | Split/Recurring fora do domínio de cartões | **RESOLVIDA na P4-B/P4-C (§19.2, §19.3)** | `src/components/SplitGroupDetailsView.tsx:123-157`; `src/components/SplitBillFormModal.tsx:166` | O ramo de cartão do Split hoje é descartado em silêncio por erro de tipo (`parseInt` × id string); corrigido o tipo, geraria parcelas legadas `parcelado` fora de fatura e limite. **Resolvida para Recorrentes na P4-B (§19.2) e para a Divisão de contas na P4-C (§19.3)** (compra P4-A com `source: "split"`, fatura e limite, no mesmo commit do título). | PR-SPLIT-03, PR-REC-04, PR-TX-06 |
| C16 | Exclusão física de cartão | **RESOLVIDA na P4-A (§19.1)** | `firestore.rules` (`credit_cards`: `create, update, delete: if false`); `functions/src/cards/cardOperations.ts` (arquivar/reativar) | Confirmada na auditoria (HEAD `9c3ab46`); o módulo `src/modules/credit-cards/` foi removido. | PR-CC-01 |
| C17 | Notifications com API incompatível com Rules e leitura não limitada | **PARCIAL → RESOLVIDA na P5-D1 (§20.2)**: leitura paginada com `limit <= 50` nas Rules, sem polling; `create` morto e exclusão removidos | `src/modules/notifications/api.ts:24-25,44`; `firestore.rules:1372-1381`; `src/modules/notifications/hooks.ts:16` | Leitura sem `limit` + polling de 30 s: verdadeiro. Incompatibilidade só em `create` (código morto) e em arquivar para member/viewer; `list` e `markAsRead` são compatíveis. | PR-NOTIF-01 |
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
- **CURRENT:** os fluxos da P3 — lançamento manual (criação, correção, anulação, pendente/agendado e confirmação), importação, empréstimos, recebíveis, contas e transferências — gravam só pelo backend, em centavos, com idempotência, eventos append-only e Rules que negam ao cliente as marcas do backend (§18.1–§18.10). Contas/carteiras autoritativas `cash_accounts` com saldo do backend e livro-razão imutável `cash_account_movements` (D-30, P3-J). A exclusão é lógica (`voidedAt`) e o delete é negado pelas Rules. A projeção `cash_report_periods` é mantida por gatilho com retry e cerca de corte (D-38) e segue a regra do caixa realizado (D-29). Cartões (P4-A), Recorrentes (P4-B), Divisão de contas (P4-C) e Investimentos (P4-D, §19.4) gravam o fato só pelo backend, com a marca do domínio e o movimento de conta (D-30) quando há dinheiro. **Desde a P4-D nenhum escritor de `transactions` existe no cliente** e as Rules negam `create, update, delete` a todo papel; a adoção `legacy_manual`, a inicialização retroativa da quota e a janela `ledger_write_freeze` saíram junto com o caminho do cliente.
- **GAP:** PR-TX-04 (P7). PR-TX-03 resolvido na P5-C2 (§20.7, aguardando auditoria independente): contrato único sem `value`, `transactionDate` nem `parcelado`; documento fora do contrato é violação, nunca zero. PR-TX-01, PR-TX-02, PR-TX-05 e PR-TX-06 resolvidos na P4 (saem no gate).
- **TARGET:** callables de lançamento/edição/anulação em centavos, idempotentes, com evento append-only; Rules `write: false`; classificação de caixa única no backend.

### 5.4 Credit Cards — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT (P4-A, §19.1):** domínio único `functions/src/cards/` em centavos inteiros: cadastro, compras, parcelas, faturas, lançamentos de fatura, pagamentos, razão do limite e auditoria escritos só por 13 callables (Zod estrito, papel relido na transação, idempotência por intenção, `expectedUpdatedAt`) e pela rotina diária de fechamento; Rules negam escrita do cliente em todas as coleções `credit_card*`, inclusive `credit_cards`. Arquivamento/reativação no lugar de exclusão. D-36 tomada e implementada (ciclo × pagamento, retroativa, antecipado, cancelamento × estorno, ajuste, conta de origem). Pagamento move a conta (D-30) no mesmo commit, com espelho de liquidação fora de despesa (`creditCardPaymentCents`). Modelo antigo, migração e camada de compatibilidade removidos.
- **GAP:** relatórios de cartão no navegador (P5). PR-TX-06 e PR-SPLIT-03 resolvidos na P4-C (§19.3): a Divisão de contas compra pela primitiva do domínio (`source: "split"`) e nenhum fluxo grava `parcelado` com `cardId` em `transactions`. PR-CC-01…PR-CC-08 resolvidos na P4-A, fechados no gate de P4 (§19.7). Recorrentes já compra pela primitiva do domínio (`source: "recurring"`, P4-B, §19.2).
- **TARGET:** única entrada de compra também para Split (`source: "split"` já previsto no backend); relatórios server-side (P5).

### 5.5 Recurring Expenses — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT (P4-B, §19.2):** domínio único `functions/src/recurring/` em centavos inteiros: contratos, ocorrências (identidade = recorrência + vencimento, ID determinístico) e trilha append-only escritos só por 8 callables (Zod estrito, papel relido na transação, idempotência por intenção, `expectedUpdatedAt`) e pela rotina diária `processRecurring` (collection group seletivo, paginada, teto por contrato e por workspace, uma transação por vencimento). D-12 tomada e implementada: frequências semanal (+7), quinzenal (+15) e mensais com `billingDay` âncora; `executionMode` explícito; cartão gera compra P4-A à vista (`source: "recurring"`); fora do cartão gera despesa pendente no Caixa ou registra como paga (move a conta, D-30). Rules negam escrita do cliente em `recurring_*`; agenda pura idêntica no frontend e no backend.
- **GAP:** PR-REC-01…PR-REC-06 resolvidos na P4-B, fechados no gate de P4 (§19.7); implantação do cron e dos índices por ambiente (E-01); alertas sobre `failed`/`truncated`/`backlog` (P7).
- **TARGET:** relatórios server-side tratando a despesa recorrente pela origem (P5).

### 5.6 Split Bills — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT (P4-C, §19.3; D-14 tomada):** módulo backend `functions/src/splitBills/` com 22 callables; grupos, participantes (membro do workspace ou externo só com nome), convites por código CSPRNG, títulos, rateios em centavos (maior resto, Σ exato), quitação/perdão/estorno como fatos da Divisão, reembolso PJ e quota `splitGroups` no servidor; integração com Caixa ou Cartões no mesmo commit; arquivamento, inativação e anulação compensatória, sem hard delete; Rules negam toda escrita do cliente em `split_*`.
- **GAP:** nenhum PR-SPLIT aberto (PR-SPLIT-01…07 resolvidos na P4-C; fechados no gate de P4, §19.7).
- **TARGET:** atingido para o escopo da P4; relatórios server-side seguem na P5.

### 5.7 Loans — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT (P3-G backend + P3-H interface):** só o schema autoritativo (`schemaVersion: 1`) existe. Callables `createLoan`, `registerLoanPayment`, `reverseLoanMovement`, `cancelLoan` e `updateLoanMetadata`, cada uma numa transação que grava contrato, movimento, espelho de caixa, idempotência e auditoria; telas PF/PJ só leem e chamam as callables; Rules negam qualquer escrita do cliente em `loans`/`loan_movements`; totais por agregado de `balanceCents` (§18.7, §18.8).
- **GAP:** PR-LOAN-01…PR-LOAN-07 resolvidos (§18.8). Restam LOAN-12 (relatórios de P5) e LOAN-16 (ciclo de vida das contrapartes, P8), além da reconciliação agendada (P7).
- **TARGET:** atingido no módulo; relatórios e reconciliação seguem nos milestones próprios.

### 5.8 Clients/Receivables — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT (P3-I):** só o modelo autoritativo (`schemaVersion: 1`). Oito callables em `functions/src/receivables/`, cada mutação numa transação com autorização relida, idempotência por intenção, versão esperada e trilha append-only (`client_events`, `receivable_events`) sem dados pessoais; recebimento com movimento e espelho de caixa no mesmo commit; Rules negam escrita do cliente nas seis coleções; dados pessoais só em `client_private` (D-24); interface com o mesmo visual, só leitura paginada e agregados do servidor.
- **GAP:** PR-CR-01…PR-CR-04 resolvidos (§18.9). Restam PR-CR-05 (ciclo de vida dos dados de terceiros, P8), o agregado de ranking de clientes no servidor para os relatórios (P5) e a reconciliação agendada acumulados × movimentos × espelhos (P7).
- **TARGET:** atingido no módulo; relatórios, reconciliação e ciclo de vida seguem nos milestones próprios.

### 5.9 Investments — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT (P4-D, D-15 tomada, §19.4):** Investimentos permanece; a experiência simples (`SimpleInvestmentsView`) é a única; 9 callables públicas (registrar, confirmar aporte, retirar, confirmar retirada, desfazer, cancelar pendente, vincular/desvincular/trocar meta), regime único por valor, ledger `investment_movements` e projeções (`investment_positions`, `investment_summaries`, `investment_report_periods`, `investment_allocation_summaries`) como fonte patrimonial única; fato liquidado move a conta do Caixa (`cash_accounts`, kind `investment`) no mesmo commit; o espelho em `transactions` é só caixa, classificado pela marca backend-only `investmentEntry`; superfície profissional, 14 callables, onboarding, valoração, importação, backfill/rebuild, `walletId` e `investment_type` removidos; sem quota nem feature gate (todos os planos).
- **GAP:** PR-PLAT-02 (P6). PR-INV-01 resolvido (fechado no gate de P4, §19.7); PR-ENT-01 sem parcela de investimentos (decisão explícita: sem quota).
- **TARGET:** atingido na P4-D; deriva medida contra o ledger e reparo operacional ficam na P6/P7.

### 5.10 Goals — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT (P5-B, D-31, §20.3, aguardando auditoria independente):** uma fonte de progresso por meta (`progressSource`: `manual`, `investment` ou `business_kpi`), centavos inteiros e margem em pontos-base; 7 callables (criar, editar com revisão esperada, atualizar valor manual, mudar status, arquivar; contagem e indicadores PJ para leitura) com Zod estrito, transação, papel relido, idempotência e trilha; arquivamento lógico recusado com posição vinculada; investimentos recusam meta arquivada ou não patrimonial na transação; indicadores PJ calculados no servidor sobre `cash_report_periods` e `cash_accounts` (regime de caixa realizado, sem cartão — D-37); lista paginada por cursor com teto nas Rules e contagem exata no servidor.
- **GAP:** PR-ENT-01 (sem quota de metas), ENTRY-12 (sem rate limit), GOAL-14 parcial (chaves com TTL de 90 dias; trilha sem TTL, D-18), D-37 (compras no cartão nos indicadores e demais KPIs; indicador por centro de custo — hoje o centro de custo é informativo e os indicadores usam os valores gerais da empresa, P5-B.1). O teto de 100 metas de investimento no seletor e nos nomes de Investimentos foi removido na P5-B.1 (§20.4: páginas por cursor sob demanda e nomes resolvidos por ID), e o formulário PJ passou a oferecer meta manual ("Valor informado").

### 5.11 Reports — [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)
- **CURRENT (P5-C1, D-37, §20.5, aguardando auditoria independente):** Dashboard e Relatórios leem só a callable `getFinancialReport` (Zod estrito, papel relido, limite de taxa, período civil de São Paulo e PF/PJ resolvidos no servidor), em centavos inteiros e pontos-base, com metadado de cobertura por bloco (`exact`, `zero`, `unavailable`, `sample`, `truncated`, `rebuild_needed`, `not_requested`); o que o papel não lê vem `null` dentro do bloco (patrimônio, evolução e reconciliação de investimentos para o viewer). Fontes: `cash_accounts` (saldo), `cash_report_periods` v5 com detalhe diário (caixa realizado), `cash_category_years` (categorias por ID, por geração), domínio de cartões (duas visões; por cartão, atraso, fatura atual e futuro disjuntos e reconciliados com o bloco — P5-C1.1, §20.6), empréstimos e recebíveis (separados), domínio de investimentos (`investment_summaries`, `investment_report_periods` com `daily`). Nenhuma fórmula financeira no navegador; alertas objetivos e efêmeros (sem persistência). Releitura ao vivo pelo documento do mês corrente/escolhido, agrupada em 2 s e com orçamento de até 100 releituras por hora (`src/modules/reports/liveRefresh.ts`).
- **P5-D2 (§20.9, aguardando auditoria independente):** a falsa leitura (`markAlertAsRead`, ocultação local) foi removida; os alertas do relatório são rotulados "Condições do período", sem botão de leitura e com "Calculado em", e continuam calculados e não persistidos (D-37.9). Fontes incompletas (inclusive o caixa indisponível) nunca dão "Tudo certo". Os fatos objetivos correspondentes viram notificações persistentes pelos produtores do domínio (§5.12), nunca pela consulta do relatório.
- **GAP:** parte de IA do PR-RPT-03 e do PR-RPT-05 implementada no código na P5-E1 (§20.11), com a milestone não concluída por bloqueadores alheios ao código (gate `FAIL`; bloqueadores tratados na P5-E1.1, §20.12, aguardando auditoria independente); ranking de clientes PJ por amostra de 500 vencimentos (marcado `sample`). PR-RPT-04 implementado na P5-D2, aguardando auditoria independente.
- **TARGET:** atingido para PR-RPT-04 (sem persistência paralela; o relatório segue em `getFinancialReport`).

### 5.12 Notifications — [DATA_MODEL.md](DATA_MODEL.md)
- **CURRENT:** produtor real só no domínio de cartões (Admin SDK, ID determinístico, evento sem estado). Desde a P5-D1 (§20.2): evento backend-owned (nenhum papel grava), páginas de 25 por cursor com `limit <= 50` nas Rules, sem polling nem listener. Desde a D-18-NOTIF (§20.8): `expiresAt` de 180 dias no evento, estado privado em `notification_user_states/{uid}/notification_entries/{id}` (lida, arquivada e excluída para si, com o mesmo `expiresAt`), exclusão individual só para owner/admin/member, oculto após o vencimento; TTL declarado em `firestore.indexes.json`, não publicado (E-07).
- **P5-D2 (§20.9, aguardando auditoria independente):** motor único em `functions/src/notifications/` (contrato, builder validado, ID determinístico por workspace/domínio/entidade/tipo/episódio, publicação idempotente); produtores `loan_overdue`, `receivable_overdue`, `cash_account_negative_balance`, `goal_achieved`, `recurring_awaiting_confirmation` e `recurring_attention_required`, além dos de cartões (D-36, preservados); contagem exata de não lidas pela callable `getNotificationUnreadCount` (agregações numa transação somente leitura, instante do banco, sem `Math.max`).
- **P5-D2.1 (§20.10, aguardando auditoria independente):** `receivable_overdue` sem limite de dias (D-42). Trabalho pendente durável por workspace (`receivable_overdue_queue`), gravado pelas operações de recebíveis na mesma transação; confirmação por episódio sem TTL (`receivable_overdue_deliveries`), gravada no mesmo commit do aviso; rotina horária com recuperação de falhas e backoff, sem cursor global. Substitui a janela de 7 dias e o cursor `system/receivable_overdue_notifications` da P5-D2.
- **GAP:** PR-NOTIF-01 tecnicamente resolvido na P5-D2, aguardando auditoria independente; ativação do TTL por ambiente (E-07). Fora: divisão de contas (bloqueador de entrega dirigida, §20.9) e decisões pendentes (meta atingida pelo progresso; vencimento próximo de empréstimo e recebível).

### 5.13 Messages — [DATA_MODEL.md](DATA_MODEL.md)
- **CURRENT:** simulado em localStorage com threads e usuários fixos, exposto no Header.
- **GAP:** PR-MSG-01 (DECISION D-09).

### 5.14 AI — [SECURITY_MODEL.md](SECURITY_MODEL.md), [PRIVACY_LGPD.md](PRIVACY_LGPD.md)
- **CURRENT:** chave só no backend (Secret Manager); entrada validada com Zod; RBAC; rate limit por workspace+ator; teto mensal de créditos pelo plano do titular, idempotência por chave e `maxOutputTokens` por chamada, com o provedor chamado só depois do commit do crédito (P2B.2, §17.9). Saída sem schema; contexto enviado pelo cliente; modelo preview e SDK legado; histórico de chat no `localStorage` por usuário e workspace, apagado no logout (D-41, P5-A, §20.1); dados e comprovantes enviados ao Gemini sem transparência. A chave esteve embutida no bundle até ago/2026 e a rotação não está comprovada.
- **GAP:** PR-AI-01 (P8), PR-AI-02 (P0, ação externa). PR-AI-05 resolvido no código na P5-E1 (§20.11; milestone não concluída por bloqueadores alheios ao código da P5-E1 (gate `FAIL`: porta 8080 e falha intermitente preexistente das notificações); bloqueadores tratados na P5-E1.1, §20.12, aguardando auditoria independente; nomes de categoria fora do contexto da IA na P5-E1.1). PR-AI-04 resolvido na P5-A (§20.1, aguardando auditoria independente); PR-AI-03 fechado em P2B.2 (§17.9); App Check em PR-APPCHK-01 (P6).

### 5.15 Billing/Stripe — [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md)
- **CURRENT (P2A entregue, §17):** catálogo canônico versionado no backend (`functions/src/billing/catalog.ts:16`); estado canônico `billing_accounts/{uid}` gravado só pelo backend; `createCheckoutSession` sem assinatura duplicada, `createBillingPortalSession` e webhook com recibo idempotente por `event.id`, ordem por releitura no Stripe fora de transação (lease com geração, P2A.1), grace period e auditoria; segredos sem fallback (falha fechada); Rules que negam escrita do cliente; frontend com provider único. Testes de comportamento no Emulator (§17.2).
- **GAP:** nenhum de billing no código. PR-BILL-01…06 e PR-BILL-08 fechados em P2A (§17.3); PR-BILL-07 fechado em P2B.1 (`getWorkspaceEntitlement`, §17.8). E-06 (configuração Stripe) segue sem conferência.

### 5.16 Entitlements/quotas — [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md)
- **CURRENT (P2B.1):** motor de entitlements de P2A (`functions/src/billing/entitlements.ts:71,131,157`) e API de quota `functions/src/billing/quota.ts`, aplicada na transação de `bootstrapAccount`, `createWorkspace`, `archiveWorkspace`, convite, revogação, aceite, remoção, saída e transferência de ownership, pelo plano efetivo do owner (§17.8); créditos mensais de IA pelo plano efetivo do titular, na admissão atômica das duas callables de IA (§17.9). Lançamentos (`transactionsPerMonth`, P3-D…P3-F) e grupos de divisão (`splitGroups`, P4-C) passaram ao servidor; desde a P4-D nenhum lançamento entra em `transactions` fora das callables, então a quota de lançamentos cobre o aplicativo inteiro. Investimentos não têm quota nem feature gate no catálogo v1 (decisão registrada na P4-D, §19.4).
- **GAP:** PR-ENT-01 (P5: demais domínios). PR-AI-03 fechado em P2B.2 (§17.9).

### 5.17 Firestore Rules — [SECURITY_MODEL.md](SECURITY_MODEL.md)
- **CURRENT:** 1.490 linhas com default deny fora de `workspaces/` e `users/`, helpers de membership com status, domínios de investimentos/cartão/metas server-only com teto de `limit`, allowlists em `users`, `workspaces`, `members` e `transactions`, 6 suítes no Emulator e no CI. Dez coleções financeiras adjacentes aceitam qualquer escrita de member, sem schema; catch-all de leitura em subcoleções.
- **GAP:** PR-RULES-01 e PR-RULES-02. (PR-CC-02 resolvido na P4-A, §19.1; PR-REC-01 resolvido na P4-B, §19.2; PR-TX-02 resolvido na P4-D, §19.4: `transactions` sem escrita do cliente; PR-RULES-03 resolvido na P4-E, §19.6: catálogo somente leitura no cliente, reservas e trilha fechadas, índice versionado.)

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
- **Plataforma (CURRENT):** um único projeto Firebase (`.firebaserc`), usado também como desenvolvimento; Hosting sem headers de segurança; Google Fonts e sons do Mixkit carregados de terceiros em runtime. Tailwind Play CDN e importmap `esm.sh` removidos em P2C-H2: CSS compilado no build do Vite (§17.11). **GAP:** PR-PLAT-01…PR-PLAT-03, PR-AUTH-04.
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
| PR-TX-01 | BLOCKER | P3 → P4 | Lançamentos de caixa autoritativos no cliente. **Entregue no escopo da P3** (§18.1–§18.10): todo fluxo da P3 — lançamento manual (criação, correção, anulação, pendente/agendado e confirmação), importação, empréstimos, recebíveis, contas e transferências — grava só pelo backend, em centavos, com idempotência e auditoria; nenhuma tela ou módulo da P3 usa os escritores diretos (guarda `tests/unit/accounts-no-client-writes.test.ts`, inventário fechado). **P4-D (§19.4) — resolvido:** os escritores diretos restantes (`createTransaction`, `updateTransaction`, `deleteTransaction`, `useCreateTransaction`, `useUpdateTransaction`, `useDeleteTransaction`, `buildTransactionPayload`) foram removidos; o investimento grava só pelo backend (D-15); lançamento de outro módulo mostra aviso em pt-BR em vez de ser escrito; as Rules negam `create, update, delete` em `transactions` a qualquer papel (`tests/firestore/transactions-p4d.rules.integration.test.mjs`); a guarda `accounts-no-client-writes` exige inventário vazio de escritores. Fechado no gate de P4 (§19.7). **Recorrentes saiu do inventário na P4-B (§19.2):** o fato é gravado só pelo backend (`onAddTransaction` removido das telas de Recorrentes; guarda `tests/unit/recurring-no-client-writes.test.ts`). **Divisão de contas saiu do inventário na P4-C (§19.3):** título, pagamento de reembolso e compensações gravam o fato só pelo backend; `useCreateTransactionsBatch`/`createTransactionsBatch` e `handleAddTransactions` removidos, Split fora de `handleAddTransaction` (guarda `tests/unit/split-no-client-writes.test.ts`) | `firestore.rules — match /transactions/{docId}: create, update, delete: if false`<br>`src/modules/transactions/api.ts` (só leitura) | TX-01, FEW-01, RULES-01, MONEY-01, TX-11 |
| PR-TX-02 | BLOCKER | P3 → P4 | Espelhos de caixa gravados pelo backend editáveis/anuláveis pelo cliente e vínculos de origem forjáveis. **Entregue no escopo da P3:** as marcas dos produtores da P3 — `cashEntry` (P3-A/C/F), `loanEntry` (P3-G/H), `receivableEntry` (P3-I) e `cashAccountId` (P3-J) — só o backend grava; o cliente não as cria nem altera (`isPlainClientTransaction`, allowlist do cliente, testes de Rules). P4-B fechou `recurringEntry`; **P4-C (§19.3)** fechou `splitEntry` (marca backend-only em `isPlainClientTransaction`) e tirou `cardId`, `installments` e `currentInstallment` da allowlist do cliente. **P4-D (§19.4) — resolvido:** `transactions` sem escrita do cliente (nenhum tipo, inclusive `investimento`; nenhum espelho editável, anulável ou apagável); `investmentEntry` é marca backend-only; `hasOnlyClientTransactionKeys`, `isPlainClientTransaction` e os demais helpers do caminho do cliente saíram. Fechado no gate de P4 (§19.7) | `firestore.rules — match /transactions/{docId}` | RULES-02, CC-02, TX-05, TX-06 |
| PR-TX-03 | HIGH | P3 → P4/P5 | Fórmulas de caixa concorrentes e dupla representação monetária. Parcial: P3-F (§18.6, D-29) alinhou projeção, `transactionCashImpactCents` e `summarizeCashFlow` no caixa realizado; os produtores da P3 decidem por `valueCents` e pela data civil `date`, e o livro-razão de contas (P3-J) é só em centavos inteiros, sem campo float novo. **Aberto, com dependência registrada (sem adaptador permanente):** os espelhos da P3 ainda gravam `value` em reais e `transactionDate` porque leitores compartilhados com os produtores da P4 (lista, dashboard, semântica de investimentos) leem esses campos — saem na P4, quando todos os produtores gravarem `valueCents`; relatórios no navegador e log do gatilho ficam na P5. P4-C: os espelhos da Divisão gravam `valueCents` e `splitEntry.amountCents` (a compensação com sinal pelo `reversal`), com `value` só como cópia de exibição, como os demais espelhos; leitores inertes do tipo `parcelado` (filtro "Parceladas", gráfico, rótulos, prévia da Personalização, `cash/periods.ts`, gatilho, `semantics.ts`, metas) seguem sem escritor possível e saem com a fórmula única. **P4-D (§19.4):** o espelho de investimento grava `valueCents` e `investmentEntry.amountCents`; `value` é só cópia de apresentação e nenhum leitor de investimento o usa (PR-INV-01, teste). **Dependência registrada (P5):** `value` em reais segue como apresentação nos espelhos, e os fallbacks por `value` em `transactionValueCents`/`transactionCashImpactCents` para receita/despesa sem `valueCents` não têm mais produtor (todo escritor grava `valueCents`); saem com a fórmula única dos relatórios. **P5-C1 (§20.5):** a fórmula de caixa do navegador (`summarizeCashFlow` e helpers) e os leitores de histórico completo saíram; Dashboard e Relatórios leem só o relatório do servidor. **Resolvido na P5-C2 (§20.7), aguardando auditoria independente:** nenhum produtor grava `value` nem `transactionDate`; `parcelado` não existe em `transactions`; o leitor autoritativo e o do frontend aceitam só o contrato único (`valueCents` inteiro até o teto, `date` civil, tipo coerente com a marca) e tratam o resto como violação, nunca R$ 0,00; guarda de schema sobre todos os produtores no Emulator, mutações e busca no código (`docs/production/evidence/p5c2/`). Até a P5-C1, ficavam `value` como apresentação nos espelhos, os fallbacks por `value` e os leitores inertes de `parcelado` | `functions/src/cash/createTransaction.ts:224`, `functions/src/loans/model.ts:390`, `functions/src/receivables/model.ts:457 — value = valueCents / 100`<br>`src/modules/investments/semantics.ts:45,67,149` | TX-04, MONEY-02, RPTAI-05 |
| PR-TX-04 | HIGH | P3 | Projeção oficial de caixa pode divergir em silêncio: gatilho e crons sem retry, documento quente, rebuild sem cerca de versão. Parcial: P3-B entregou retry do gatilho, cerca de corte e publicação atômica (§18.2); faltam detector agendado de deriva (P7) e crons (P4); o documento mensal fica como contenção aceita dentro das quotas de D-08 | `functions/src/triggers/transactions.ts:35-37,70-79`<br>`functions/src/shared/runtimeOptions.ts:41-44 — sem retry` | TX-08, FIRE-05, ENTRY-06, ENTRY-08, TX-15 |
| PR-TX-05 | HIGH | P3 → P4 | Sem trilha de auditoria imutável das edições e anulações de transação. **Entregue no escopo da P3:** criação, correção, anulação, confirmação e importação (`cash_events`), empréstimos (`loan_events`), clientes e recebíveis (`client_events`, `receivable_events`) e contas e transferências (`cash_account_events`), append-only e só pelo backend. Cartão (P4-A, `credit_card_events`), recorrência (P4-B, `recurring_events`) e Divisão de contas (P4-C, `split_events`, sem nomes nem texto livre) têm trilha append-only só do backend. **P4-D (§19.4) — resolvido:** investimento registra a trilha do domínio (`investment_event_logs`) e o movimento de conta na auditoria do livro-razão; os escritores diretos do cliente saíram. Fechado no gate de P4 (§19.7) | `firestore.rules` — eventos com escrita negada | TX-09, TX-13 |
| PR-TX-06 | HIGH | P4 | **Resolvido na P4-C (§19.3); fechado no gate de P4 (§19.7):** as Rules não aceitam mais o tipo `parcelado` (`isValidTransactionType`) nem `cardId`, `installments` ou `currentInstallment` do cliente; nenhum fluxo grava esses campos em `transactions` (a Divisão lança a compra no domínio de cartões); Rules `m4-hardening`, `investment-domain` e `split-p4c` e guardas estáticas. Os leitores inertes de `parcelado` ficam registrados em PR-TX-03. **Parcial na P4-A (§19.1):** chaves de fatura/compatibilidade removidas e lançamento manual sem `parcelado`; `parcelado` com `cardId` segue gravável só para Divisão de contas (P4-C). **P4-B (§19.2):** nenhum fluxo de Recorrentes cria `parcelado` nem `cardId` em `transactions` (compra no domínio de cartões; guarda estática). Tipo legado parcelado e campos de fatura ainda graváveis em transactions (fonte concorrente ao domínio de cartões) | `firestore.rules:40-41 — 'parcelado' aceito`<br>`firestore.rules:67-75 — cardId/creditCardInvoiceId/creditCardCompatibility graváveis` | FEW-07, CC-04, MONEY-06 · C15 |

#### Credit Cards

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-CC-01 | BLOCKER | P4 | **Resolvido na P4-A (§19.1); fechado no gate de P4 (§19.7).** Exclusão física do cartão pelo cliente, deixando compras, faturas e ledger órfãos | `firestore.rules:1118`<br>`src/modules/credit-cards/api.ts:97-101` | CC-01 · C16 |
| PR-CC-02 | HIGH | P4 | **Resolvido na P4-A (§19.1); fechado no gate de P4 (§19.7).** Configuração autoritativa do cartão (limite, ciclo, status) gravada pelo cliente, em float e sem reconciliação | `firestore.rules:942-988 — limitTotal/closingDay/dueDay/status graváveis`<br>`src/modules/credit-cards/api.ts:82-95 — updateDoc direto` | CC-03, RULES-05 |
| PR-CC-03 | HIGH | P4 | **Resolvido na P4-A (§19.1); fechado no gate de P4 (§19.7).** Chave de idempotência gerada por tentativa: envio duplo duplica compra | `src/components/TransactionModal.tsx:787-791,860 — randomUUID por submit`<br>`src/components/TransactionModal.tsx:793-865 — handleSubmit sem guarda de in-flight` | CC-05, FEW-11 |
| PR-CC-04 | HIGH | P4 | **Resolvido na P4-A (§19.1); fechado no gate de P4 (§19.7).** Cron de faturas vencidas sobrescreve status/valores com leitura desatualizada e reprocessa o backlog global diariamente | `functions/src/crons/creditCardInvoices.ts:354-359 — invoice vem da página`<br>`functions/src/crons/creditCardInvoices.ts:249-276 — transaction.update sem transaction.get(invoiceRef)` | CC-06, ENTRY-07, READ-09, CC-11 |
| PR-CC-05 | HIGH | P4 | **Resolvido na P4-A (§19.1); fechado no gate de P4 (§19.7).** Máquina de estados da fatura mistura ciclo (aberta/fechada) com pagamento | `functions/src/creditCards/registerInvoicePayment.ts:131-138`<br>`functions/src/creditCards/reverseInvoicePayment.ts:145-155` | CC-07 |
| PR-CC-06 | HIGH | P4 | **Resolvido na P4-A (§19.1); fechado no gate de P4 (§19.7).** Dinheiro em float (reais) em todo o domínio de cartões, arredondando fração de centavo em silêncio | `functions/src/creditCards/contracts.ts:18-26 — z.number().positive() sem cents/max`<br>`functions/src/creditCards/contracts.ts:86-89 — installmentsCount sem max` | CC-08, MONEY-03, ENTRY-18 |
| PR-CC-07 | HIGH | P4 | **Resolvido na P4-A (§19.1); fechado no gate de P4 (§19.7).** Consultas de fatura truncadas: ordem asc+limit esconde as atuais, itens limitados a 50, relatório pede 5000 e recebe 200 | `src/modules/reports/hooks.ts:85-90 — limites de 5000 e 2500`<br>`src/modules/credit-cards/persistence/readApi.ts:69-72 — Math.min(limit, 200)` | READ-04, READ-05, READ-06, CC-13 |
| PR-CC-08 | HIGH | P4 | **Resolvido na P4-A (§19.1); fechado no gate de P4 (§19.7).** Índice composto ausente para credit_card_audit_logs (cardId ASC, occurredAt DESC) | `src/modules/credit-cards/persistence/readApi.ts:464-482 — where cardId e orderBy occurredAt desc`<br>`src/components/CreditCardsView.tsx:725 — consumidor` | READ-03, RULES-10, CC-10 |

#### Recurring Expenses

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-REC-01 | BLOCKER | P4 | **Resolvido na P4-B (§19.2); fechado no gate de P4 (§19.7):** `create, update, delete: if false` em `recurring_*` para todos os papéis, leitura de membro com teto, `nextDueDate` só do backend (teste de Rules `recurring-p4b`). recurring_expenses e recurring_occurrences graváveis por qualquer member, sem schema, e tratadas como autoritativas pelo cron | `firestore.rules:1097-1105 — allow write sem schema`<br>`functions/src/crons/recurring.ts:258-260 — nextDueDate do documento é confiado` | REC-01, RULES-04 · C14 |
| PR-REC-02 | BLOCKER | P4 | **Resolvido na P4-B (§19.2); fechado no gate de P4 (§19.7):** `handleGenerate` removido; ocorrência gerada só no mesmo commit do fato (callables e rotina), provado com falha injetada antes do commit. Geração manual perde o lançamento e marca a ocorrência como gerada/paga sem transação confirmada | `src/components/RecurringExpenseDetailsView.tsx:97-172 — fluxo completo`<br>`src/components/RecurringExpenseDetailsView.tsx:107-108 — id no payload` | REC-02, TX-03, FEW-05 · C13 |
| PR-REC-03 | BLOCKER | P4 | **Resolvido na P4-B (§19.2); fechado no gate de P4 (§19.7):** identidade recorrência + vencimento com ID determinístico criado com `create()`; semanal (+7) e quinzenal (+15) testadas, inclusive com várias ocorrências no mesmo mês. Ocorrência identificada por mês: frequências semanal e quinzenal perdem cobranças | `functions/src/crons/recurring.ts:239-242 — recurringOccurrenceId por competência`<br>`functions/src/crons/recurring.ts:479-490 — pula e avança` | REC-03 |
| PR-REC-04 | HIGH | P4 | **Resolvido na P4-B (§19.2); fechado no gate de P4 (§19.7):** compra P4-A à vista pela primitiva do domínio de cartões (`source: "recurring"`), limite, fatura e razão; `cardId` validado no servidor. Recorrência paga no cartão não passa pelo domínio de cartões; integração de cardId quebrada (parseInt/NaN) | `functions/src/crons/recurring.ts:322-343 — sem card`<br>`src/components/RecurringExpenseDetailsView.tsx:119-121 — parseInt` | REC-04 · C12, C15 |
| PR-REC-05 | HIGH | P4 | **Resolvido na P4-B (§19.2); fechado no gate de P4 (§19.7):** datas civis `YYYY-MM-DD` validadas no servidor; agenda pura idêntica no frontend e no backend, com vetores calculados à mão e varredura FE × BE. Datas gravadas em meia-noite UTC e lidas como D-1 em São Paulo (vencimentos e atrasos) | `src/modules/recurring-expenses/api.ts:198-199,224-225 — new Date(YYYY-MM-DD) em UTC`<br>`functions/src/crons/recurring.ts:146-147 — Timestamp lido com saoPauloDayKey` | REC-06, CR-11, RPTAI-12 |
| PR-REC-06 | HIGH | P4 | **Resolvido na P4-B (§19.2); fechado no gate de P4 (§19.7):** `amountCents` inteiro validado por Zod (teto do Caixa), sem `parseFloat`; histórico de valores pela trilha append-only, sem `adjustments` em reais. valorPadrao em float, sem validação server-side, copiado cru para o ledger pelo cron | `src/components/RecurringExpenseFormModal.tsx:183`<br>`src/components/RecurringExpenseDetailsView.tsx:130-131,176` | REC-07, MONEY-07, ENTRY-15 |

#### Split Bills

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-SPLIT-01 | BLOCKER | P4 | **Resolvido na P4-C (§19.3); fechado no gate de P4 (§19.7):** 22 callables com Zod estrito, transação, idempotência por intenção e auditoria; `create, update, delete: if false` em todo `split_*` para todos os papéis (Rules `split-p4c`); invariantes de soma, estado e agregados testadas. Autoridade financeira de Split no cliente, sem schema nem invariantes (títulos, rateios, status, reembolso) | `firestore.rules:1384-1402`<br>`src/modules/split-bills/api.ts:293-320,322-355,377-380,455-460` | SPLIT-01, FEW-02 |
| PR-SPLIT-02 | BLOCKER | P4 | **Resolvido na P4-C (§19.3); fechado no gate de P4 (§19.7):** sem exclusão física: grupo arquivado (só sem pendências), participante inativado, título anulado com compensação, convite revogado ou expirado por TTL; Rules negam `delete`. Hard delete de grupos, títulos, rateios e participantes; exclusão de grupo falha no meio | `src/modules/split-bills/api.ts:194-233 — deleteSplitGroup; limit 300 em 218-226`<br>`src/modules/split-bills/api.ts:357-375 — deleteSplitBill` | SPLIT-02, FEW-06 · C10 |
| PR-SPLIT-03 | BLOCKER | P4 | **Resolvido na P4-C (§19.3); fechado no gate de P4 (§19.7):** lançamento P3 no Caixa (com movimento da conta) ou compra P4-A (`source: "split"`, fatura e limite) no mesmo commit do título, pela primitiva de cada domínio; anulação compensa ou cancela/estorna; falha injetada antes do commit não deixa nada; replay e âncora durável sem duplicar. Integração caixa/cartão fora dos domínios autoritativos, não atômica e sem idempotência (hoje descartada em silêncio) | `src/components/SplitGroupDetailsView.tsx:100-106 — duas mutações independentes`<br>`src/components/SplitGroupDetailsView.tsx:123-166 — handleIntegration` | SPLIT-03, REC-05 · C15 |
| PR-SPLIT-04 | HIGH | P4 | **Resolvido na P4-C (§19.3); fechado no gate de P4 (§19.7):** papel do workspace e do grupo relidos na transação; identidade pelo `uid` (D-14); nunca o devedor quita; convite com código CSPRNG guardado só como hash, uso único e rate limit que conta as falhas. Autorização interna insegura: papel de dono do grupo forjável, identidade por nome de exibição, limite de tentativas revertido | `functions/src/callables/splitGroups.ts:115-137`<br>`firestore.rules:1389-1392` | SPLIT-06, FEW-14, ENTRY-14, SPLIT-09 · C06 |
| PR-SPLIT-05 | HIGH | P4 | **Resolvido na P4-C (§19.3); fechado no gate de P4 (§19.7):** centavos e basis points inteiros, maior resto (D-34), Σ exato sem tolerância, mesma regra na prévia da tela com vetores compartilhados calculados à mão. Rateios e parcelas em float com dízima, calculados só no cliente | `src/modules/split-bills/logic.ts:33-54,63-68,73-84`<br>`src/components/SplitBillFormModal.tsx:88-95` | SPLIT-04, MONEY-05 |
| PR-SPLIT-06 | HIGH | P4 | **Resolvido na P4-C (§19.3); fechado no gate de P4 (§19.7):** termos só antes de quitação, perdão ou fato; depois, só descrição e categoria; a edição preserva método, valores gravados e quitações. Editar título zera pagamentos e troca o método de divisão | `src/components/SplitBillFormModal.tsx:56-58 — setMetodoDivisao('igual'), manualInputs zerados`<br>`src/components/SplitBillFormModal.tsx:131-147 — status recalculado sem olhar sharesToEdit` | SPLIT-05 |
| PR-SPLIT-07 | HIGH | P4 | **Resolvido na P4-C (§19.3); fechado no gate de P4 (§19.7):** unitários de alocação e contratos, 7 suítes de integração no Emulator, Rules `split-p4c`, unitários e guarda do frontend, E2E e mutações (§19.3). Testes do domínio insuficientes ou tautológicos | `functions/src/callables/__tests__/splitGroups.integration.test.ts:39-93`<br>`tests/firestore/adjacent-modules.rules.integration.test.mjs:204-222 — só leitura` | SPLIT-08 |

#### Loans

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-LOAN-01 | BLOCKER | P3 | Autoridade financeira de empréstimos no cliente (saldo, status, cronograma) e Rules sem validação. **Resolvido (P3-H, §18.8):** saldo, status e cronograma só do backend; a interface só lê e chama as callables; Rules negam `create`/`update`/`delete` em `loans`/`loan_movements` a todo papel (teste de Rules M4) e a guarda estática impede escritores no frontend | `firestore.rules` (blocos `loans`/`loan_movements`: `allow create, update, delete: if false`)<br>`tests/unit/loans-no-client-writes.test.ts` | LOAN-01, MONEY-04 · C07 |
| PR-LOAN-02 | BLOCKER | P3 | Pagamento PJ com escrita dupla concorrente: dupla dedução ou lost update do saldo. **Resolvido (P3-H, §18.8):** PF e PJ pagam por `registerLoanPayment` (transação, versão lida, saldo só pelo principal); a tela antiga e seu `updateLoan` foram removidos; conflito de versão e reenvio após resposta perdida testados no E2E | `functions/src/loans/operations.ts`<br>`e2e/loans-pf.spec.ts` (versão concorrente e reenvio) | LOAN-02, FEW-03 · C08 |
| PR-LOAN-03 | BLOCKER | P3 | Caixa e empréstimo gravados em escritas separadas (não atômico, sem idempotência). **Resolvido (P3-H, §18.8):** contratação só por `createLoan` (contrato, fato inicial, espelho, evento e idempotência num commit); a interface não cria lançamento (`onAddTransaction` removido; `loanId`/`loanMovementId` fora da allowlist de `transactions`) | `functions/src/loans/operations.ts`<br>`src/components/LoanFormModal.tsx`; `src/components/PJLoanFormModal.tsx` | LOAN-03, TX-07 · C09 |
| PR-LOAN-04 | BLOCKER | P3 | Hard delete de contrato e movimentos pelo cliente, em cascata não atômica. **Resolvido (P3-H, §18.8):** "Excluir" virou "Cancelar empréstimo" (`cancelLoan`, compensatório, motivo obrigatório); `deleteLoan` e a cascata foram removidos; Rules negam `delete` a todo papel | `src/components/loans/useLoanOperations.tsx`<br>`firestore.rules` (blocos `loans`/`loan_movements`) | LOAN-05, READ-01 · C10 |
| PR-LOAN-05 | HIGH | P3 | Vínculo loanId/loanMovementId da transação de caixa sempre quebrado (IDs temporários do cliente). **Resolvido (P3-H, §18.8):** IDs determinísticos do backend e vínculo backend-only `loanEntry`; IDs `Date.now()` removidos do frontend de empréstimos (guarda estática) | `functions/src/loans/model.ts`<br>`tests/unit/loans-no-client-writes.test.ts` | LOAN-04 |
| PR-LOAN-06 | HIGH | P3 | Valores em float e máquina de estados/amortização incoerentes; sem estorno de movimento. **Resolvido (P3-H, §18.8):** centavos e taxa inteira do backend à tela (conversão sem ponto flutuante, precisão excessiva recusada); motor único do backend (o motor antigo do frontend foi removido); status derivado; estorno pela interface com motivo | `src/modules/loans/money.ts`; `src/modules/loans/adapters.ts`<br>`functions/src/loans/schedule.ts` | LOAN-06, LOAN-07, LOAN-09 |
| PR-LOAN-07 | HIGH | P3 | RBAC: member tem os mesmos poderes de owner/admin sobre empréstimos. **Resolvido (P3-H, §18.8):** backend (owner/admin tudo; member só o que criou por `createdBy`; viewer só lê; relido na transação); Rules sem escrita do cliente; interface com as mesmas permissões e recusa em pt-BR na perda de papel com a tela aberta (E2E) | `functions/src/loans/operations.ts`<br>`src/modules/loans/presentation.ts` (`loanPermissions`)<br>`e2e/loans-pf.spec.ts` | LOAN-08 |

#### Clients/Receivables

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-CR-01 | BLOCKER | P3 | Recebíveis e clientes gravados diretamente pelo cliente, com Rules sem schema. **Resolvido (P3-I, §18.9):** escrita só pelas callables (`createClient`, `updateClient`, `archiveClient`, `createReceivable`, `updateReceivable`, `receiveReceivable`, `reverseReceivableReceipt`, `cancelReceivable`) com schema estrito e autorização relida na transação; Rules `allow create, update, delete: if false` em `clients`, `client_private`, `receivables`, `receivable_movements`, `client_events`, `receivable_events`; guarda estático `tests/unit/clients-no-client-writes.test.ts` | `firestore.rules:1366-1369 — receivables: allow write: canMemberWriteWorkspaceScopedData`<br>`firestore.rules:1361-1364 — clients: idem` | CR-01 · C11 |
| PR-CR-02 | BLOCKER | P3 | Hard delete de recebíveis e clientes (inclusive por member) e cascata não atômica que gera órfãos. **Resolvido (P3-I, §18.9):** "Excluir cliente" virou "Arquivar cliente" (recusado com recebível em aberto; arquivado continua referenciado); recebível só por cancelamento lógico ou estorno compensatório; `deleteClient`, `deleteReceivable` e a cascata removidos; Rules negam `delete` | `src/modules/clients/api.ts:142-145 — deleteReceivable = deleteDoc`<br>`src/modules/clients/api.ts:82,87-89 — deleteDoc do cliente + batch.delete dos recebíveis` | CR-02, CR-03 · C10, C11 |
| PR-CR-03 | HIGH | P3 | Recebimento não gera transação de caixa; status paid é fonte de verdade concorrente. **Resolvido (P3-I, §18.9, D-39):** `receiveReceivable` grava movimento e espelho de caixa (`receivableEntry`, principal + juros + multa) no mesmo commit; status `open`/`received`/`cancelled` derivado do saldo pelo backend; atraso derivado, nunca gravado | `src/components/ClientsReceivablesView.tsx:115-118 — só status`<br>`src/modules/clients/hooks.ts:99-106 — update parcial 'as any'` | CR-04, FEW-13 |
| PR-CR-04 | HIGH | P3 | Dinheiro em float, leituras sem limit e domínio sem nenhum teste. **Resolvido (P3-I, §18.9):** centavos inteiros da tela ao servidor (sem `parseFloat`); leituras paginadas com cursor ou com teto e totais por agregado do servidor; testes de unidade, integração, Rules, E2E e mutações | `src/components/ReceivableFormModal.tsx:46 — parseFloat(amount)`<br>`src/components/ReceivableFormModal.tsx:100-101 — type number, step 0.01, sem min` | CR-05, MONEY-08, CR-06, CR-08 |
| PR-CR-05 | HIGH | P8 | Dados pessoais de terceiros (CPF/CNPJ, e-mail, telefone) sem minimização nem ciclo de vida. **Parcial (P3-I, D-24):** dados pessoais só em `client_private`, lidos só por owner/admin, fora de recebíveis, movimentos, eventos, espelhos, logs e respostas. **Continua em P8:** exportação, eliminação/anonimização e retenção (D-07, D-18) | `src/components/ClientFormModal.tsx:42,72-107 — coleta de e-mail, telefone, CPF/CNPJ e observações`<br>`src/modules/clients/types.ts:3-10 — campos pessoais (inclusive duplicados cnpj/document, address)` | CR-07, PRIV-07, LOAN-16 |

#### Investments

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-INV-01 | HIGH | P4 | Fonte concorrente de Investimentos/aportes a partir do espelho em transactions. **P4-D (§19.4) — resolvido:** o card do dashboard lê o aporte do mês de `investment_report_periods` (líquido do estorno, mês da liquidação em America/Sao_Paulo); o espelho é classificado só pela marca `investmentEntry` (estorno de aporte compensa o aporte, nunca vira retirada); documento `investimento` sem marca válida tem efeito zero no backend e no frontend; nenhum leitor patrimonial usa `transactions`. Fechado no gate de P4 (§19.7) | `src/modules/investments/dashboard.ts`, `src/modules/investments/semantics.ts — investmentEntryOf`<br>`functions/src/investments/cashEffect.ts`, `functions/src/cash/periods.ts` | INV-02 |

#### Goals

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-GOAL-01 | HIGH | P5 | **Resolvido na P5-B (§20.3, D-31.2), aguardando auditoria independente:** `current_value` = valor atual das posições vinculadas, publicado pelo domínio patrimonial; trocar a base recalcula `investmentProgressCents` na mesma transação; sem campo manual concorrente. progressBasis current_value com duas semânticas; opção da UI sempre falha e troca de base não recalcula | `functions/src/goals/contracts.ts:70-76 — exige currentValue para current_value`<br>`functions/src/goals/operations.ts:156-165,180-181 — progresso manual em currentAmountCents` | GOAL-01, GOAL-02, INV-08 |
| PR-GOAL-02 | HIGH | P5 | **Resolvido na P5-B (§20.3, D-31.5), aguardando auditoria independente:** `archived: false` na criação; lista por cursor (25 + sonda) com `limit <= 26` nas Rules; contagem exata por `getGoalsOverview`; consulta legada removida. listGoals filtra archived==false (campo nunca gravado) e trunca em 100 | `functions/src/goals/operations.ts:167-185,196-206 — persistência sem archived`<br>`src/modules/goals/api.ts:47-55 — archived==false + fallback limit(100) por documentId` | GOAL-03, READ-19 |
| PR-GOAL-03 | HIGH | P5 | **Resolvido na P5-B (§20.3, D-31.3), aguardando auditoria independente:** `getGoalKpiProgress` no servidor sobre `cash_report_periods` e `cash_accounts`, em centavos e pontos-base, períodos civis de São Paulo, sem truncamento; `logic.ts` removido. Compras no cartão fora (D-37). Progresso de metas PJ automáticas calculado no cliente, em float, sobre janela truncada | `src/modules/goals/logic.ts:7-25 — limites de período em horário local`<br>`src/modules/goals/logic.ts:41-44 — new Date(t.date) (UTC) comparado com start/end locais` | GOAL-04 |
| PR-GOAL-04 | HIGH | P5 | **Resolvido na P5-B (§20.3, D-31.4/5), aguardando auditoria independente:** arquivar recusa posição vinculada (consulta na transação, serializada com o vínculo pela escrita da meta); investimentos recusam meta arquivada ou não patrimonial; status persiste por `setGoalStatus`. Arquivar meta ignora posições vinculadas; investimentos aceitam meta arquivada; botões de status não persistem | `functions/src/goals/operations.ts:260-279 — nenhuma leitura de posições; status cancelada`<br>`functions/src/investments/infrastructure.ts:363-381 — assertWorkspaceDocument sem checagem de archived` | GOAL-05, INV-09, GOAL-06 |

#### Reports

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-RPT-01 | HIGH | P5 | **Resolvido na P5-C1 (§20.5) e corrigido na P5-C1.1 (§20.6), aguardando auditoria independente:** obrigações de cartão do domínio oficial (ciclo aberto, fechadas sem pagamento, vencidas, parciais, a vencer em 7/15/30 dias), sem janela até hoje; por cartão, atraso, fatura atual e futuro disjuntos e reconciliados com o bloco (a auditoria achou a fatura vencida exibida como "atual"). Indicadores de fatura e vencimentos ignoram faturas e parcelas futuras | `src/modules/reports/hooks.ts:174-194 — {startDate, endDate: hoje} para invoices/installments`<br>`src/modules/reports/logic.ts:51-57 — endDate = saoPauloDayKey()` | RPTAI-04 |
| PR-RPT-02 | HIGH | P5 | **Resolvido na P5-C1 (§20.5), aguardando auditoria independente:** relatório e Dashboard pela callable `getFinancialReport` sobre projeções e agregações limitadas (tabela de custo em `docs/production/evidence/p5c1/CUSTO.md`); leitores de histórico completo removidos. Agregação no cliente sobre datasets amplos: carga lê até 20 mil transações e relê tudo a cada mutação | `src/modules/transactions/api.ts:121,127,183-205`<br>`src/modules/reports/hooks.ts:85-90,165-199` | RPTAI-06, READ-08, TX-14 |
| PR-RPT-03 | HIGH | P5 | **Resolvido (P5-C1, §20.5; parte de IA no código na P5-E1, §20.11, milestone não concluída por bloqueadores alheios ao código da P5-E1 (gate `FAIL`: porta 8080 e falha intermitente preexistente das notificações); bloqueadores tratados na P5-E1.1, §20.12, aguardando auditoria independente), aguardando auditoria independente:** alertas objetivos do servidor, widget PJ com a margem operacional de caixa; na P5-E1 a persona PF/PJ e o perfil do contexto vêm do tipo do workspace lido pelo backend (o cliente não informa PF/PJ). Id kpi-net-profit inexistente: alerta crítico PJ morto, IA sempre em persona PF, widget PJ vazio | `src/modules/reports/logic.ts:177-211 — ids PJ`<br>`src/modules/reports/logic.ts:707 — find('kpi-net-profit')` | RPTAI-07 |
| PR-RPT-04 | MEDIUM | P5 | **Resolvido na P5-D2 (§20.9), aguardando auditoria independente:** `markAlertAsRead` (só `console.log`) e a ocultação local removidos; alertas rotulados "Condições do período", sem botão de leitura, com "Calculado em"; fontes incompletas (inclusive caixa indisponível) nunca dão "Tudo certo"; os fatos objetivos viram notificações persistentes pelos produtores do domínio. Na P5-C1 os alertas passaram a ser objetivos e calculados no servidor, sem persistência (D-37.9). Alertas de relatórios efêmeros, sem persistência, entrega ou histórico; preferências decorativas | `src/modules/reports/hooks.ts:320-339`<br>`src/modules/reports/api.ts:207-209` | RPTAI-11 · C19 |
| PR-RPT-05 | HIGH | P5 | **Resolvido (P5-C1, §20.5; handler de IA no código na P5-E1, §20.11, milestone não concluída por bloqueadores alheios ao código da P5-E1 (gate `FAIL`: porta 8080 e falha intermitente preexistente das notificações); bloqueadores tratados na P5-E1.1, §20.12, aguardando auditoria independente), aguardando auditoria independente:** relatório coberto na P5-C1; na P5-E1 os handlers de IA ganharam testes de contrato, segurança, contexto com oráculo e créditos no Emulator. Lógica de relatórios e handler de IA sem testes | `grep 'modules/reports' em *.test.* → só tests/unit/report-window.test.ts e tests/unit/investment-reporting.test.ts`<br>`functions/src/ai/__tests__/callables.test.ts:38-127 — sem handler` | RPTAI-19 |

#### Notifications

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-NOTIF-01 | HIGH | P5 | Notificações sem limit/paginação, com polling de 30 s e sem retenção; create morto e arquivar negado a member — **parcial na P5-D1 (§20.2)**: limit/cursor, fim do polling, estado privado por usuário, arquivar sem exclusão e remoção do create morto entregues; **retenção de 180 dias e exclusão individual implementadas na D-18-NOTIF (§20.8)**, aguardando auditoria independente, com TTL declarado e não publicado (E-07); **tecnicamente resolvido na P5-D2 (§20.9), aguardando auditoria independente:** contagem exata (`getNotificationUnreadCount`) e produtores aprovados (empréstimos, recebíveis, contas, metas, recorrentes; cartões preservados); seguem fora a ativação do TTL (E-07), a divisão de contas (bloqueador de entrega dirigida) e as decisões pendentes da §20.9 | `src/modules/notifications/api.ts:24-25 — orderBy sem limit`<br>`src/modules/notifications/hooks.ts:16 — refetchInterval 30000` | NOTIF-01, READ-07, NOTIF-03, FEW-16, NOTIF-09 · C17 |

#### Messages

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-MSG-01 | HIGH | P5 | Mensagens é funcionalidade simulada (localStorage/mock) exposta em produção | `src/components/Header.tsx:255-274 — painel exposto`<br>`src/modules/messages/api.ts:148-154 — usuários falsos` | MSG-01, COMM-05 · C18 |

#### AI

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-AI-01 | BLOCKER | P8 | Dados financeiros, comprovantes e transcrições de voz enviados ao Gemini sem base legal, transparência nem contrato/tier comprovado | `functions/src/ai/callables.ts:227-238 — inlineData do documento enviado ao modelo`<br>`src/components/TransactionModal.tsx:686-705 — upload de comprovante` | RPTAI-01, PRIV-05 |
| PR-AI-02 | BLOCKER | P0 | Chave Gemini foi embutida no bundle público no passado; rotação não comprovada (ação externa imediata) | `git show 39806fb:vite.config.ts:14-15 — JSON.stringify(env.GEMINI_API_KEY)`<br>`vite.config.ts:14-19 — comentário confirma exposição anterior` | RPTAI-02 |
| PR-AI-04 | HIGH | P5 | **Resolvido na P5-A (§20.1, D-41), aguardando auditoria independente:** histórico no `localStorage` por (uid, workspace) com envelope validado, sessão com geração contra respostas tardias, gravação só com o dono local igual ao uid e limpeza no logout, na troca de conta e em carga nova com outra conta (`src/modules/reports/aiChatStorage.ts`, `src/modules/reports/aiChatSession.ts`, `src/lib/sessionCleanup.ts`; testes `tests/unit/ai-chat-history.test.ts`, `e2e/ai-chat-isolation.spec.ts`). Achado original: histórico do chat de IA em localStorage vaza entre workspaces e usuários; não é limpo no logout | `src/modules/reports/hooks.ts:343 — chave sem uid`<br>`src/modules/reports/hooks.ts:348-358 — load não reseta; save grava estado antigo na chave nova` | RPTAI-08, PRIV-06, AUTH-11 |
| PR-AI-05 | MEDIUM | P5 | **Resolvido no código na P5-E1 (§20.11, D-11.1 e D-11.4); milestone não concluída por bloqueadores alheios ao código da P5-E1 (gate `FAIL`: porta 8080 e falha intermitente preexistente das notificações); bloqueadores tratados na P5-E1.1, §20.12, aguardando auditoria independente; desde a P5-E1.1 o nome das categorias não vai ao provedor:** contexto montado só pelo backend a partir do relatório oficial (payload estrito recusa valores do cliente), instruções de sistema separadas dos dados, resposta do consultor validada e exibida como texto, extração com schema estrito revalidado por Zod e preenchimento só de campos identificados (`functions/src/ai/{callables,analysisContext,prompts,extraction}.ts`; testes `aiSecurity`, `aiContext`, `extraction.test`). Achado original: saída da IA sem schema forte e contexto forjável pelo cliente (prompt injection) | `functions/src/ai/callables.ts:146-150,223-249`<br>`src/components/TransactionModal.tsx:651-676` | RPTAI-09, RPTAI-10, MONEY-14 · C20 |

#### Billing/Stripe

Nenhum aberto: PR-BILL-01…06 e PR-BILL-08 fechados em P2A (§17.3); PR-BILL-07 fechado em P2B.1 (§17.8).

#### Entitlements/quotas

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-ENT-01 | BLOCKER | P3–P5 (D-ORD-05) | Quotas de lançamentos, grupos de divisão e demais domínios ainda só no frontend (ajuda de UX). P2 entregou catálogo, motor de entitlements e enforcement server-side de workspaces, membros, transferência e créditos de IA (§17.8, §17.9); `usePlan.ts` foi removido. P3-D (§18.4, D-40) aplica `transactionsPerMonth` no servidor nas callables de criação e importação; P3-E (§18.5) leva a criação manual confirmada da interface para a callable e o indicador para o contador do backend (`getWorkspaceEntitlement.transactionsQuota`); P3-F (§18.6) leva o pendente e o agendado manuais para a callable, que consome na criação; enquanto os escritores legados restantes gravarem em `transactions`, a quota de lançamentos não está protegida no aplicativo inteiro. **Parte `splitGroups` resolvida na P4-C (§19.3):** criar e reativar reservam vaga no servidor contra o plano efetivo do titular (Free 2, Pro 10, Business 100), arquivar libera, downgrade nunca apaga, a última vaga sob concorrência é admitida uma vez, mensagens distintas para titular e não titular; `checkWorkspaceLimit` saiu do cliente e a tela lê `getWorkspaceEntitlement.splitGroupsQuota`. **P4-D (§19.4):** sem escritor de `transactions` no cliente, a quota de lançamentos vale para o aplicativo inteiro; **Investimentos: sem quota nem feature gate em todos os planos** (decisão explícita do catálogo v1; aporte, retirada e espelho não consomem `transactionsPerMonth`, D-40, teste) | `src/hooks/usePlan.ts:36-38 — enforcement só no cliente`<br>`src/modules/workspaces/api.ts:196 — workspace criado pelo cliente` | BILL-01, ENTRY-02, WS-05, TX-10, SPLIT-07, FEW-09, INV-03, CC-14, LOAN-15, CR-15, GOAL-08, REC-14 · C01 |

#### Firestore Rules

| ID | Sev. | Milestone | Blocker | Evidência (HEAD `9c3ab46`) | Achados de origem |
| --- | --- | --- | --- | --- | --- |
| PR-RULES-01 | BLOCKER | P3 (transactions, loans, clients, receivables); P4 (recurring, split) | **Resolvido: parte recurring na P4-B (§19.2), parte split na P4-C (§19.3) e parte `transactions` na P4-D (§19.4); fechado no gate de P4 (§19.7).** As coleções adjacentes negam escrita ao cliente (suítes `recurring-p4b`, `split-p4c` e `transactions-p4d`). Dez coleções financeiras adjacentes com escrita livre de member, sem schema e com hard delete | `firestore.rules:1097-1105 — recurring_*`<br>`firestore.rules:1351-1369 — loans, loan_movements, clients, receivables` | RULES-03, FEW-02, FEW-04, TX-02 · C10, C14 |
| PR-RULES-02 | MEDIUM | P6 | Catch-all de leitura em subcoleções libera por padrão qualquer membro (inclusive futuras mensagens privadas) | `firestore.rules:852-877 — lista de negação por prefixo`<br>`firestore.rules:1436-1442 — catch-all read` | RULES-09, MSG-02 |
| PR-RULES-03 | HIGH | P4 | Query do catálogo de settings sem índice composto versionado; renomear item é negado pelas Rules. **Resolvido na P4-E (§19.6, D-23):** índice `sortOrder, normalizedName, __name__` versionado em `firestore.indexes.json`, coberto pela guarda `tests/unit/settings-catalog-no-client-writes.test.ts`; renomear passa pela callable `updateSettingsCatalogItem` (reserva nova e liberação da antiga na mesma transação, testado no Emulator); Rules negam toda escrita do cliente (`tests/firestore/settings-catalog-p4e.rules.integration.test.mjs`). Fechado no gate de P4 (§19.7) | `src/modules/settings-catalog/api.ts` (`listSettingsCatalogSnapshot`)<br>`functions/src/settingsCatalog/operations.ts` | READ-02, RULES-12, FEW-12 |

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
| PR-PLAT-03 | HIGH | P6 | Hosting sem headers de segurança; recursos de terceiros em runtime (Google Fonts, sons do Mixkit). Parcial em P2C-H2 (§17.11): Tailwind Play CDN e importmap `esm.sh` removidos, CSS compilado no build | `firebase.json:38-57 — headers só com Cache-Control`<br>`index.html:9-11 — Google Fonts` | FIRE-06, AUTH-06, PRIV-09, COMM-07 |

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
| PR-REL-02 | HIGH | P3 | Domínios com escrita financeira pelo cliente sem nenhum teste (Rules de escrita, integração, unit, E2E). **Estado após a P4-D (fechamento formal no gate de P4):** nenhum domínio financeiro aceita escrita do cliente; empréstimos, clientes e recebíveis (P3), contas (P3-J), cartões (P4-A), recorrentes (P4-B), Divisão de contas (P4-C) e `transactions` (P4-D) têm suíte de Rules no Emulator negando a escrita, além de integração e E2E das callables. O helper `canMemberWriteWorkspaceScopedData` ficou sem uso nas Rules | Evidência original (já não vale): escrita livre por `canMemberWriteWorkspaceScopedData` e `recurring` com write liberado. Hoje: `firestore.rules:241-243` (helper sem chamada); `tests/firestore/*.rules.integration.test.mjs` | REL-07, RULES-15 |

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
| P3 → P4 | ~~Escrita de `transactions` pelo cliente~~ — **removida**: dos fluxos da P3 (P3-E…P3-J), de Recorrentes (P4-B, §19.2), da Divisão de contas (P4-C, §19.3) e, na P4-D (§19.4), de investimento e dos lançamentos de outros módulos; os escritores diretos não existem mais e as Rules negam `create, update, delete` a todo papel (guarda com inventário vazio e `transactions-p4d.rules`). Campo `value` float ainda gravado pelos espelhos para os leitores compartilhados (PR-TX-03) | Callables de caixa em `amountCents`; leitores só de `valueCents` depois da convergência P4 |
| P3 (removido na P3-J) | Grupo genérico `wallet` do catálogo (`settings_catalog`), `walletId` em lançamentos, `initialWallets`, `walletSnapshot`, seção "Carteiras" das configurações e semeadura no provisionamento | Contas autoritativas `cash_accounts` com saldo e livro-razão (D-30); conta padrão "Carteira principal" provisionada pelo backend. Prova: guarda `tests/unit/accounts-no-client-writes.test.ts`, Rules sem `'wallet'` nem `'walletId'`, provisionamento sem o grupo (§18.10) |
| P3 | ~~CRUD de loans e loan_movements no cliente; `deleteLoan` em cascata~~ — removido na P3-H (§18.8). ~~CRUD de clients e receivables no cliente; `deleteClient` em cascata~~ — removido na P3-I (§18.9) | Empréstimos: callables transacionais e `cancelLoan` (entregue). Clients/receivables: callables, arquivamento lógico do cliente, cancelamento lógico e estorno compensatório do recebível (entregue na P3-I) |
| P4 | ~~Tipo `parcelado` com `cardId` em `transactions`~~ — sem escritor: Recorrentes deixou de gravá-lo na P4-B (§19.2) e a Divisão de contas na P4-C (§19.3), e as Rules não o aceitam mais (leitores inertes registrados em PR-TX-03); ~~módulo antigo da Divisão (`logic.ts`, CRUD do cliente, `SharedExpensesView.tsx`, `functions/src/callables/splitGroups.ts`)~~ — removido na P4-C (§19.3); ~~camada `src/modules/credit-cards/compatibility`; fallback de limite por transações~~ — removidos na P4-A (§19.1) | Somente `credit_card_*` (`invoice_views` também removida na P4-A). Prova: guarda `tests/unit/cards-no-client-writes.test.ts`, Rules e busca no código (§19.1) |
| P4 | ~~CRUD e delete de `credit_cards` pelo cliente~~ — removido na P4-A (§19.1); `writeStrategy.ts` divergente no frontend; arquivos `manual*Test.ts` no bundle | Callables de cadastro/arquivamento (entregues na P4-A); remoção do código de teste do deploy |
| P4 (removido na P4-B) | ~~Geração manual de recorrência no cliente (`handleGenerate`); ocorrência por mês; `recurring_*` graváveis; CRUD de `src/modules/recurring-expenses/`; `adjustments` em reais; Split na recorrência; `onAddTransaction` em Recorrentes~~ | Callables + rotina autoritativas; ocorrência por vencimento (§19.2). Prova: guarda `tests/unit/recurring-no-client-writes.test.ts`, Rules `recurring-p4b` e busca no código |
| P4 | Split client-authoritative; `parseInt(cartaoId)`; parcelas legadas no cliente | Módulo `splitBills` backend usando caixa e cartões |
| P4 (removido na P4-D) | ~~Fallback `type 'investimento'` sem metadata; grupo `investment_type`; leitura de aportes pelo espelho em `transactions`; `walletId`; superfície profissional não montada (componentes, `operationsApi`, 14 callables, onboarding, valoração, importação, backfill e rebuild públicos)~~ | Projeções oficiais de investimentos e espelho só de caixa com `investmentEntry` (§19.4). Prova: guarda `tests/unit/investment-surface-guard.test.ts` (por import), `deploymentContract`, Rules e busca no código |
| P4 (removido na P4-D) | ~~Adoção `legacy_manual` do caminho do cliente; inicialização retroativa da quota (`cash/quotaBackfill.ts`); janela `quota_state/ledger_write_freeze` e a releitura dela em todos os escritores~~ — sem produtor depois do fechamento de `transactions` | Só o lançamento do Caixa com `cashEntry` é elegível; âncora da quota nasce com o workspace (§19.4) |
| P5 | ~~Progresso de metas PJ no cliente; campos de progresso duplicados (float + centavos)~~ — removidos na P5-B (§20.3): `logic.ts`, `projection.ts`, `toMinorUnits`, `currentAmount`/`currentAmountCents`/`currentValue*`/`targetAmount`/`isAutomatic`, consulta legada e `profileId` da meta | Fonte única por meta em centavos (entregue na P5-B) |
| P5 | Relatórios agregados no navegador; alertas em memória; `markAlertAsRead` com `console.log` | `getFinancialReport` e alertas persistidos |
| P5 | ~~`createNotification` morto no cliente; estado de lido compartilhado; hard delete de notificação~~ — removidos na P5-D1 (§20.2) | Escrita só backend e estado por usuário (entregues na P5-D1); TTL (D-18) |
| P5 | Messages simulado em localStorage | Remoção ou backend real (D-09) |
| P5 | ~~Histórico do chat de IA em localStorage sem uid~~ — formato antigo removido na P5-A (§20.1; D-41: o histórico fica no navegador, por usuário e workspace); contexto montado pelo cliente | Contexto server-side |
| P6 | Login E2E com credenciais fixas no `AuthContext`; `dist/` compartilhado com build E2E | Módulo de teste isolado/custom token do Emulator; build por ambiente |
| P6 | Google Fonts e sons do Mixkit carregados de terceiros, entrypoint duplicado `index.tsx` na raiz. Tailwind Play CDN e importmap `esm.sh` **removidos em P2C-H2** (§17.11) | Fontes e sons auto-hospedados, `src/main.tsx`; Tailwind compilado e dependências empacotadas já feitos |
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
- **Divisão:** P2A (catálogo, estado canônico, checkout, portal, webhook, Rules, frontend) concluída — §17; P2B.1 (API de quota; workspaces próprios, membros com reserva de vaga por convite, transferência de ownership pela capacidade do novo owner; entitlement público do workspace pelo owner; frontend conta × workspace) concluída — §17.8; P2B.2 (créditos de IA por plano do owner com pool do titular, idempotência por chave, teto de saída por chamada; contenção de transação como `aborted`) concluída — §17.9; P2C (gate de P2 em ambiente limpo) executada em 2026-10-02: correções F1, A1–A5, B1–B3, limite de corpo do webhook, isolamento de testes de recorrentes e calendário de E2E; gate **FAIL** pelos bloqueadores de §17.10. P2C-H2 (2026-10-02) fechou os bloqueadores técnicos 1, 2, 5 e 6 (§17.11): gate A técnico PASS; gate B FAIL só por itens externos (E-06, PR-AI-02/E-00) e comerciais de P9.
- **Blockers:** PR-BILL-01…PR-BILL-08, PR-AI-03; PR-ENT-01 parcial (fecha em P5, D-ORD-05). Fechados em P2A: PR-BILL-01…06 e PR-BILL-08 (§17.3); em P2B.1: PR-BILL-07 (§17.8); em P2B.2: PR-AI-03 (§17.9). Aberto: PR-ENT-01 (P3–P5).
- **Depende de decisões:** D-01 e D-08 (parcial) tomadas em §9.2; D-07 e D-11 não bloqueiam P2 (§9.2).
- **Configuração externa:** E-06 (sem conferência; obrigatória para fechar P2).
- **Skills:** `billing-entitlement-integrity`, `multi-tenant-security-review`, `firestore-scale-cost-review`, `firebase-production-readiness` (segredos e exports), `observability-incident-readiness` (auditoria e falhas de webhook), `ptbr-product-ui-review`, `saas-commercial-readiness` (checkout e cancelamento no produto), `regression-release-gate`.
- **Estado:** ver §17

### P3 — Caixa autoritativo, Empréstimos e Clientes/Recebíveis
- **Objetivo:** tornar o caixa autoritativo no backend e levar empréstimos e recebíveis para operações atômicas sobre ele (D-ORD-01).
- **Escopo:** callables de lançamento, edição e anulação de `transactions` em `amountCents`, com evento append-only e trilha de auditoria; Rules `write: false` para `transactions`; espelhos de outros domínios protegidos; fórmula de caixa única; retry idempotente e cerca de versão na projeção; domínio de empréstimos no backend; domínio de clientes/recebíveis no backend com recebimento que gera a receita na mesma transação; remoção do write path do cliente e dos campos float; testes de Rules de escrita, integração, concorrência e E2E dos fluxos.
- **Blockers:** PR-TX-01…PR-TX-05, PR-LOAN-01…PR-LOAN-07, PR-CR-01…PR-CR-04, PR-RULES-01 (transactions, loans, clients, receivables), PR-REL-02 (esses domínios).
- **Depende de decisões:** D-12, D-13, D-16, D-17, D-24, D-29, D-30, D-35, D-38, D-39, D-40.
- **Skills:** `financial-domain-integrity`, `multi-tenant-security-review`, `firestore-scale-cost-review`, `ptbr-product-ui-review`, `billing-entitlement-integrity` (quotas), `regression-release-gate`.
- **Estado:** **P3 — implementação funcional própria concluída; fechamento global do ledger depende da convergência P4 e dos gates transversais explicitamente atribuídos a P5/P7/P8.** P3-A (núcleo autoritativo de criação de lançamento) entregue em §18.1; P3-B (confiabilidade da projeção, D-38) em §18.2; P3-C (correção e anulação autoritativas, D-35) em §18.3; P3-D (quota mensal autoritativa, D-40, importação em lotes e âncora de idempotência da correção) em §18.4; P3-E (caixa manual pela interface, leitura de quota e inicialização endurecida) em §18.5; P3-F (D-29: pendentes, agendados e confirmação pelo backend, caixa realizado único e janela sem escritas na inicialização da quota) em §18.6; P3-G (D-13: núcleo autoritativo de empréstimos PF/PJ no backend) em §18.7; P3-H (empréstimos exclusivamente no schema autoritativo: interface PF/PJ pelas callables, escritores e motor antigos removidos, Rules fechadas) em §18.8; P3-I (D-24 e D-39: clientes e recebíveis autoritativos no backend, recebimento com caixa atômico, estorno e cancelamento, interface pelas callables e remoção do modelo antigo) em §18.9; P3-J (D-30: contas/carteiras autoritativas com livro-razão, transferências com estorno e fechamento técnico do caixa da P3) em §18.10. Dependências herdadas: §2.

### P4 — Convergência de Recorrentes, Divisão de contas, Cartões e Transações
- **Objetivo:** uma única fonte de verdade para cartões e caixa, com recorrentes e divisão de contas usando os domínios autoritativos.
- **Escopo:** cadastro de cartão por callables com arquivamento; centavos; idempotência estável por intenção; cron de faturas com releitura transacional e cursor; máquina de estados de fatura; consultas de fatura corretas; índices ausentes; recorrentes por callables/cron com ocorrência por data e compra via domínio de cartões; módulo backend de divisão de contas; remoção do tipo `parcelado`, da camada de compatibilidade de cartões e dos fallbacks de investimento em `transactions`; índice e Rules do catálogo.
- **Blockers:** PR-CC-01…PR-CC-08, PR-REC-01…PR-REC-06, PR-SPLIT-01…PR-SPLIT-07, PR-TX-06, PR-INV-01, PR-RULES-01 (recurring, split), PR-RULES-03 (todos resolvidos na P4-A…P4-E e fechados no gate de P4, §19.7).
- **Depende de decisões:** D-12 (tomada na P4-B), D-14 (tomada na P4-C), D-15 (tomada na P4-D), D-17, D-23 (tomada na P4-E), D-36 (tomada na P4-A).
- **Skills:** as mesmas de P3.
- **Estado:** **concluída** em 2026-10-08 (gate final, §19.7: P4 GATE PASSED). P4-A (cartões de crédito autoritativos, D-36, faturas, limite e integração com contas) entregue em §19.1; P4-B (recorrentes autoritativos, D-12, geração segura e integração com Caixa e Cartões) entregue em §19.2; P4-C (Divisão de contas autoritativa, D-14, rateio exato, reembolso PJ e integração com Caixa e Cartões) entregue em §19.3; P4-D (D-15: Investimentos definitivos, superfície única, integração com contas e fechamento dos escritores de `transactions` no cliente) entregue em §19.4; P4-E (D-23: catálogo de configurações backend-authoritative, unicidade transacional, renomear atômico, inativar/reativar, Rules somente leitura e PR-RULES-03) entregue em §19.6.

### P5 — Metas, Relatórios, Notificações, Mensagens e IA
- **Objetivo:** módulos adjacentes lendo apenas projeções oficiais, sem agregação no navegador nem funcionalidades simuladas.
- **Estado:** em andamento. P5-A (PR-AI-04, D-41) implementada em 2026-10-08, aguardando auditoria independente (§20.1); P5-D1 (infraestrutura de notificações, parte de PR-NOTIF-01) implementada em 2026-10-08, aguardando auditoria independente (§20.2); P5-B (Metas, PR-GOAL-01…04, D-31) implementada em 2026-10-09 (§20.3) e complementada na P5-B.1 após a auditoria independente (§20.4: metas de investimento além da centésima, meta manual em PJ, centro de custo informativo), aguardando nova auditoria independente; P5-C1 (relatórios e Dashboard autoritativos, D-37) implementada em 2026-10-10 (§20.5) e complementada na P5-C1.1 após a auditoria independente (§20.6), aguardando nova auditoria independente; P5-C2 (contrato único de `transactions`, PR-TX-03, M2, M3, L5, L8 e desenho da D-18) implementada em 2026-10-11 (§20.7), aguardando auditoria independente; D-18-NOTIF (retenção de notificações e exclusão individual) implementada em 2026-10-11 (§20.8), aguardando auditoria independente, TTL não publicado (E-07); P5-D2 (produtores oficiais, contagem exata, Relatórios sem falsa leitura) implementada em 2026-10-11 (§20.9), aguardando auditoria independente; P5-D2.1 (avisos de recebível vencido sem limite de dias, D-42) implementada em 2026-10-12 (§20.10), aguardando auditoria independente; P5-E1 (consolidação da IA, D-11.1–D-11.4) implementada no working tree em 2026-10-12 (§20.11) e não concluída, com gate `FAIL` por bloqueadores alheios ao código; P5-E1.1 (minimização adicional, estabilização mobile e gate de regressão) implementada em 2026-10-13 (§20.12), aguardando auditoria independente; P5-E2, P5-F e o gate não iniciados.
- **Escopo:** correções de metas e projeção única; `getFinancialReport` server-side; alertas persistidos; notificações com `limit`, cursor, TTL e estado de leitura por usuário; decisão e execução sobre Mensagens; IA com contexto montado no servidor, `responseSchema` + Zod, histórico no navegador isolado por usuário e workspace (D-41, P5-A), modelo e SDK suportados; fechamento de PR-ENT-01 com quotas em todos os callables.
- **Blockers:** PR-GOAL-01…PR-GOAL-04, PR-RPT-01…PR-RPT-05, PR-NOTIF-01, PR-MSG-01, PR-AI-04, PR-AI-05, PR-ENT-01.
- **Dependência:** se D-09 decidir implementar Mensagens, a remoção do catch-all de leitura (PR-RULES-02) é antecipada de P6 para P5, antes de existir qualquer dado privado de mensagem.
- **Depende de decisões:** D-09, D-11, D-18. D-31 e D-37 tomadas (§9.4; D-37 aprovada em parte na P5-B, §20.3, e integralmente em 2026-10-09, implementada na P5-C1, §20.5).
- **Requisito futuro associado:** REQ-FUT-01 (visualização por tempo de trabalho, §9.3), candidato a entrar junto às melhorias de Relatórios/UX, só por pedido explícito.
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

### 9.3 Requisitos de produto futuros (registrados, não implementados)

Registrados para planejamento. Não fazem parte de nenhum milestone em execução e não autorizam mudança de UI fora do escopo de quem os implementar.

| ID | Requisito | Planejamento |
| --- | --- | --- |
| REQ-FUT-01 | **Visualização financeira por tempo de trabalho** (registrado em P2C-H2, 2026-10-02). Preferência **opcional** em Configurações: o usuário informa uma renda de referência e as horas trabalhadas no período, e o sistema calcula o valor equivalente por hora. Nas visões financeiras, um alternador troca a exibição entre dinheiro e tempo de trabalho (ex.: "R$ 482,35" ↔ "≈ 11 h 30 min de trabalho"). **O dinheiro continua sendo a fonte de verdade**: a conversão é só camada de visualização, nunca é persistida em lançamento, saldo, relatório ou evento financeiro, e não entra em cálculo autoritativo (valores em centavos inteiros; a divisão e o arredondamento acontecem só na apresentação). Considerar: privacidade da renda informada (dado pessoal sensível ao contexto: visível só ao próprio usuário, nunca a outros membros do workspace, fora de logs e do contexto enviado à IA sem consentimento; exportação e exclusão em P8); persistência da preferência por usuário (não por workspace), com origem e Rules definidas na implementação; desligada por padrão; UX em pt-BR com formatação de horas e minutos, aviso de que é uma estimativa e estado vazio quando a preferência não existe. | Depois da estabilização dos módulos financeiros centrais (P3 e P4, que tornam caixa, cartões e recorrentes autoritativos) e antes da homologação final (P10); preferencialmente junto às melhorias de Relatórios/UX de P5. Skills previstas: `financial-domain-integrity` (garantir que nada da conversão vire autoridade), `privacy-lgpd-data-lifecycle`, `multi-tenant-security-review` (isolamento da preferência), `ptbr-product-ui-review`. |


### 9.4 Decisões de produto tomadas para P5

| ID | Decisão | Consequência |
| --- | --- | --- |
| D-11.1 | **Contexto financeiro da IA autoritativo no backend (2026-10-12, P5-E1; aprovada pelo usuário).** O navegador não determina nenhum valor financeiro: envia só pergunta, período, chave de idempotência e confirmação; o backend lê o relatório oficial com o papel relido e monta o contexto mínimo. | Implementada no código na P5-E1 (§20.11); milestone não concluída por bloqueadores alheios ao código da P5-E1 (gate `FAIL`: porta 8080 e falha intermitente preexistente das notificações): `analyzeFinancialQuestion` com payload estrito, `executeGetFinancialReport` (sem série e sem ranking de clientes), `functions/src/ai/analysisContext.ts` (centavos, cobertura por bloco, sem IDs/nomes). |
| D-11.2 | **Provedor Google mantido (2026-10-12, P5-E1; aprovada pelo usuário).** Modelo, SDK, API, termos comerciais e garantias de dados verificados antes de trocar componentes. | SDK migrado para `@google/genai ~2.28.0`; modelo `gemini-3-flash-preview` mantido; troca para GA pendente de conferência ao vivo e avaliação em STAGING (§10, D-11 residual); termos/DPA/região externos (E-09, E-10). Evidência: `evidence/p5e1/provedor-referencias.md`. |
| D-11.3 | **Transparência e ação afirmativa antes de cada envio (2026-10-12, P5-E1; aprovada pelo usuário).** Minimização e controles específicos para documento e voz. | Confirmação versionada por operação (`ai-provider-share-v1`) exigida pelo backend antes de qualquer leitura ou crédito; diálogos acessíveis no chat e no formulário (documento com nome/tipo/tamanho; voz com aviso do reconhecimento do navegador e confirmação do texto). Não é consentimento LGPD (P8, PR-AI-01). |
| D-11.4 | **Resposta da IA validada e sem autoridade financeira (2026-10-12, P5-E1; aprovada pelo usuário).** Contrato de créditos por plano preservado; nenhum conteúdo extraído cria ou altera lançamento automaticamente. | Extração com `responseJsonSchema` revalidada por Zod estrito (estados por campo, valor em centavos por BigInt, datas reais, sem `parcelado`); formulário preenche só campos identificados e salva só pelo botão e pelas callables oficiais; política P2B.2 de créditos inalterada. |
| D-09 | **Mensagens (2026-10-12; aprovada pelo usuário).** Remover o módulo simulado de Mensagens do produto. | **Executada somente na P5-E2** (não iniciada); nada foi removido na P5-E1. |
| D-41 | **Histórico do chat de IA (2026-10-08, P5-A).** O DINDIN mantém o histórico da IA no navegador (`localStorage`), isolado por usuário autenticado e workspace, com limpeza no logout. Substitui a recomendação documental anterior (histórico só em memória ou server-side). | Implementada na P5-A (§20.1): chave `finance_ai_chat_history_v2:<uid>:<workspaceId>` e envelope validado; respostas atrasadas de outro contexto descartadas; limpeza no logout, na troca de conta e em carga nova com outra conta; nenhum armazenamento server-side do histórico. Isolamento lógico, sem criptografia local. Transparência, base legal, retenção e direitos do titular sobre o histórico seguem em P8 (PR-AI-01, D-18). |
| D-42 | **Avisos de recebível vencido (2026-10-12, P5-D2.1; aprovada pelo usuário).** Todo recebível `open`, com `balanceCents > 0`, `dueDate` válida e anterior a hoje (dia civil de São Paulo) é elegível a um único aviso `receivable_overdue` por episódio, **sem limite de dias**: criado antes e vencido depois, cadastrado já vencido (semanas, meses ou anos), parcialmente recebido, não processado antes por falha ou orçamento, ou com vencimento alterado para o passado. Episódio = `dueDate` oficial (mesmo da P5-D2): novo vencimento pode abrir episódio novo; o mesmo vencimento, não; vencimento já avisado e restaurado não reemite. Não avisa: recebido, cancelado, saldo zero, vence hoje, futuro, fora do contrato. Recebimento parcial não gera segundo aviso. Quitação ou cancelamento antes da publicação tiram a elegibilidade. Estorno que reabre reavalia: com confirmação do episódio não duplica; sem ela, emite. A unicidade vale também depois do TTL de 180 dias do aviso. | Substitui a decisão nº 1 da P5-D2 ("recebível com vencimento há mais de 7 dias nunca avisa", §20.9) e a janela [hoje − 7, hoje − 1]. Implementada na P5-D2.1 (§20.10) com fila durável, confirmação por episódio e recuperação; aguardando auditoria independente. |
| D-37 | **Relatórios e Dashboard (aprovada em parte na P5-B; integralmente em 2026-10-09, P5-C1).** 37.1 Saldo Atual = Σ `cash_accounts.balanceCents`. 37.2 Caixa realizado, com recebimentos, pagamentos, resultado financeiro, fluxos patrimoniais e fluxo líquido total separados. 37.3 Cartão em duas visões (caixa e consumo); compra e pagamento da fatura nunca contados duas vezes; limite nunca soma em saldo. 37.4 PJ: "Recebimentos operacionais realizados", "Pagamentos operacionais realizados", "Resultado operacional de caixa", "Margem operacional de caixa" (pontos-base; denominador zero → indisponível; sem limiar fixo de 15%), "Saldo disponível em contas"; Metas PJ e Relatórios compartilham funções puras; D-31 inalterada. 37.5 Investimentos do domínio de investimentos; "Taxa de Aportes Líquidos" = aportes líquidos ÷ recebimentos operacionais × 100 na mesma janela, negativa permitida, sem teto, denominador zero → indisponível. 37.6 Dívidas separadas; recebíveis não são dívida; indisponível não é zero. 37.7 Períodos civis exatos de São Paulo (7/30/90 dias contando hoje; 12 meses móveis documentados; ano corrente; todo o período limitado); sem rateio de valores mensais; sem varrer o ledger; projeções diárias, incrementais, idempotentes e reconstruíveis. 37.8 Categorias por ID estável; nome não é chave; nenhum ID inventado de texto; classificação explícita de fatos de domínio; nenhum documento único com todas as categorias; categorias ≠ centros de custo. 37.9 Alertas objetivos, sem persistência e sem limiar inventado; "Insight Financeiro IA" renomeado. 37.10 Metadado de cobertura em todo bloco; o cliente nunca troca ausência por zero. | Implementada na P5-C1 (§20.5): `getFinancialReport`, `cash_report_periods` v5 com `days`, `cash_category_years` por geração, reconstrução v5, categoria por ID em criação, edição, importação e recorrentes, Dashboard e Relatórios lendo só o relatório. Aguardando auditoria independente. PR-RPT-04 (P5-D2) e a parte de IA do PR-RPT-03/05 (P5-E1) seguem abertos. |
| D-31 | **Metas (2026-10-09, P5-B).** D-31.1: meta manual com progresso informado em centavos inteiros, validado no backend e auditado, sem lançamento, conta, investimento nem quota. D-31.2: meta vinculada a investimentos tem progresso só das projeções patrimoniais oficiais, sem sobrescrita manual. D-31.3: metas PJ automáticas calculadas no servidor a partir de dados oficiais, excluídos pendentes, empréstimos, pagamento de fatura, espelhos/duplicidades, movimentos patrimoniais e dados truncados. D-31.4: meta com posição vinculada ativa não pode ser arquivada; posições e movimentos nunca são apagados. D-31.5: botões de status persistem; a lista suporta mais de 100 metas com cursor, limites e isolamento por workspace. | Implementada na P5-B (§20.3): `progressSource` explícito (uma fonte por meta, sem fallback; troca de fonte auditada, sem reaproveitar progresso), `revision` para edição e valor manual, `setGoalStatus`, `archiveGoal` com bloqueio por vínculo, guarda de meta no domínio patrimonial, `getGoalKpiProgress` (regime de caixa realizado; personalizado só com meses inteiros) e `getGoalsOverview`. Aguardando auditoria independente. |
---

## 10. Decisões pendentes (DECISION)

| ID | Decisão | Bloqueia | Opções levantadas pela auditoria |
| --- | --- | --- | --- |
| D-07 | Exclusão de conta: destino de workspaces próprios e compartilhados, retenção fiscal × eliminação LGPD, anonimização do ator em histórico compartilhado | P8 | Resolver o conflito entre "sem hard delete de histórico" e eliminação a pedido. |
| D-08 | Parcialmente tomada (§9.2); pendente: tratamento fiscal (NFS-e/ISS, Stripe Tax), meios além de cartão, plano anual, proration e momento do downgrade configurados no portal, suporte a Prices legados por plano | P9 | Catálogo v1 em `functions/src/billing/catalog.ts`. |
| D-09 | Mensagens: remover do produto até existir backend real, ou implementar | P5 | **Tomada em 2026-10-12 (§9.4): remover; execução na P5-E2.** A auditoria recomenda remover no lançamento (funcionalidade simulada exposta). |
| D-10 | Painel administrativo: implementar com custom claim e callables auditadas, ou remover | P7 | — |
| D-11 | IA: provedor e tier contratual (Vertex AI × chave AI Studio), minimização do payload, consentimento, quotas por plano, envio de comprovantes e voz | P5, P8 | **Tomada em parte em 2026-10-12 (D-11.1…D-11.4, §9.4; P5-E1, §20.11).** Residual: troca do modelo preview `gemini-3-flash-preview` por GA (candidatos `gemini-3.5-flash-lite`, `gemini-3.8-flash`) após conferência ao vivo e avaliação em STAGING; Gemini API paga × Vertex/Agent Platform (Cloud DPA com anexo LGPD, multi-região); base legal e registro formal em P8 (PR-AI-01); termos e região externos (E-09, E-10). SDK legado já substituído. |
| D-12 | Recorrentes: frequências suportadas; cobrança no cartão automática no vencimento ou por confirmação | P3, P4 | **Tomada na P4-B (§19.2), implementada e testada:** semanal (+7 dias civis), quinzenal (+15), mensal, bimestral, trimestral, semestral e anual com `billingDay` âncora (mês curto cai no último dia e o seguinte volta à âncora; sem `setMonth`); `executionMode` explícito (`automatic` \| `confirmation_required`, a tela sugere Automático); cartão automático gera compra P4-A à vista com `source: "recurring"`, por confirmação aceita o valor real; fora do cartão, automático gera despesa pendente no Caixa sem mover conta e a confirmação escolhe pendente ou paga (move a conta, D-30); conta/cartão padrão ativos e do mesmo workspace, substituíveis na confirmação; geração não consome `transactionsPerMonth` (D-40); impedimento de domínio vira `attention_required` com nova tentativa manual; retomada sem recuperar o intervalo pausado; cancelamento terminal sem apagar nem reverter. |
| D-13 | Empréstimos: modelos de amortização (Price, SAC, simples), juros, diferenças PF/PJ classificação contábil do principal (hoje gravado como receita/despesa de consumo) e obrigatoriedade de lançamento de caixa na contratação | P3 | **Tomada em P3-G (§18.7), implementada e testada no backend; concluída no módulo em P3-H (§18.8): interface PF/PJ, Rules e totais no schema autoritativo.** Principal é movimento de principal: `borrow` entra no caixa e aumenta o passivo; `lend` sai do caixa e aumenta o ativo a receber; nunca receita nem despesa operacional. Caixa obrigatório na contratação, no mesmo commit. Parcela com `principalCents` e `interestCents` separados: o saldo cai só pelo principal; juros são despesa financeira (`borrow`) ou receita financeira (`lend`); o espelho movimenta o total. Centavos inteiros; taxa inteira em partes por milhão; juros `none`, `fixed` (total) ou `percentage` com Price, SAC ou simples escolhidos explicitamente; anual nominal → mensal proporcional sem arredondar a taxa; maior resto (D-34) na divisão de centavos. Motor único PF/PJ; campos PJ só em workspace PJ, validados pelo servidor. Esta versão registra contratação já ocorrida (`startDate` ≤ hoje); vencimentos podem ser futuros. |
| D-14 | Divisão de contas: participantes precisam ser membros do workspace? participantes externos; fluxo de reembolso PJ | P4 | **Tomada na P4-C (§19.3), implementada e testada:** participante é `workspace_member` (`userId` validado contra membership ativo owner/admin/member; identidade pelo `uid`, nunca por nome) ou `external` (só nome, sem login nem contato); papéis do grupo owner/participant/viewer; viewer do workspace lê e não participa; convite por código CSPRNG (10 caracteres) com validade, uso único, rate limit que conta as falhas, idempotência e auditoria; reembolso só em PJ (`requested` → `approved` → `paid`, ou `rejected`/`cancelled`), pagamento integral pelo Caixa e estorno que volta a `approved`. |
| D-15 | Investimentos: manter ou remover as 13 callables e a UI profissional sem ponto de montagem | P4 | **Tomada na P4-D (§19.4), implementada e testada:** Investimentos permanece como produto; a experiência simples é a única UX; a superfície profissional não montada foi removida (componentes, `operationsApi`, 14 callables, onboarding, valoração, importação, backfill e rebuild públicos); o ledger patrimonial e as projeções são a fonte única; o espelho em `transactions` é só caixa (`investmentEntry`); aporte depositado e retirada recebida movem a conta do Caixa (D-30) no mesmo commit; `walletId`, `investment_type` e os fallbacks sem marca foram removidos; sem quota nem feature gate. |
| D-18 | Prazos de retenção por categoria (conta, dados financeiros, dados de terceiros, logs, auditoria, backups, pós-cancelamento) | P5, P8 | Validar com jurídico. **Notificações — decidida (D-18-NOTIF, 2026-10-11) e implementada (§20.8):** 180 dias desde a criação do evento no servidor; vencida, sai da interface com ou sem remoção física; owner/admin/member excluem só para si (viewer não); todos leem, marcam como lida e arquivam para si; a exclusão individual não apaga o evento, o estado dos demais nem registro financeiro ou de auditoria e persiste entre recarga, dispositivo e login. TTL declarado, ativação pendente (E-07). As demais categorias seguem pendentes. |
| D-19 | Mapeamento de ambientes: o projeto atual `sistema-financeiro-pesso-20698` vira DEV/STAGING e cria-se um PROD novo, ou o contrário | P6 | O código e os documentos já tratam o projeto atual como desenvolvimento; ele contém apenas dados de teste. |
| D-20 | Troca do Tailwind Play CDN por Tailwind compilado, com critério de paridade visual | P6 | **Executada em P2C-H2** (§17.11): Tailwind 3.4 local com a mesma configuração do CDN. Paridade antes/depois com o CDN emulado (CSS gerado das classes do DOM vivo, como o Play CDN faz): 46 telas, 0 pixel diferente. O CDN real é negado neste ambiente; conferir a versão exata embutida nele é o risco R-04 residual. |
| D-21 | Identidade jurídica do fornecedor (razão social, CNPJ, endereço), encarregado de dados e canal de suporte | P7, P9 | Necessário para rodapé, páginas legais e LGPD. |
| D-23 | Catálogo de configurações (`settings_catalog`): escrita por callables ou mantida no cliente com Rules estritas (schema, sem delete) | P4 | **Tomada na P4-E (§19.6), implementada e testada:** mutações backend-authoritative por callables (`createSettingsCatalogItem`, `updateSettingsCatalogItem` — renomear, aparência, inativar e reativar —, `archiveSettingsCatalogItem`), só owner/admin, papel relido na transação; domínio próprio `functions/src/settingsCatalog/` (grupos, subtipos `receita`/`despesa`/`investimento`, normalização, chave de unicidade, escopo PF/PJ derivado do workspace, IDs de semente); item + reserva de nome na mesma transação; sem exclusão; o cliente só lê e as Rules negam toda escrita; reservas e trilha fechadas. |
| D-24 | Visibilidade de dados pessoais de clientes (CPF/CNPJ, e-mail, telefone) por papel: todos os membros ou só owner/admin | P3, P8 | **Tomada na P3-I (§18.9), implementada e testada:** só owner/admin. Cadastro compartilhado mínimo (`clients`: `clientId`, `workspaceId`, `name`, `status`, autoria, timestamps, `schemaVersion`); documento, e-mail, telefone, endereço e observações em `client_private` (Rules: owner/admin, listagem com teto); member e viewer veem só a lista mínima e a interface nem consulta os dados pessoais. Ciclo de vida (exportação, eliminação, retenção) continua P8 (PR-CR-05). |
| D-25 | Monitoramento de erros do frontend: serviço de terceiro (novo subprocessador) ou coleta própria via backend | P7 | Afeta SUBPROCESSORS.md e a política de privacidade. |
| D-26 | Política de cookies e armazenamento local: necessidade de banner/CMP conforme o inventário final de trackers | P8, P9 | Hoje não há analytics; há armazenamento local de chat de IA, preferências e sessão do Firebase Auth. |
| D-27 | RPO e RTO por serviço (Firestore, Functions, Auth, Stripe), política de backup (frequência, retenção, export para projeto/bucket isolado), janela de PITR compatível e periodicidade do ensaio de restore | P7 | Base para BACKUP_RESTORE_DR.md e para o exercício de restore. |
| D-28 | Stack de observabilidade (Cloud Logging/Monitoring nativos ou ferramenta adicional), escala de plantão e SLOs/limiares dos alertas | P7 | Define a tabela de alertas de OBSERVABILITY.md e o processo de INCIDENT_RESPONSE.md. |
| D-29 | Regime de caixa × competência e semântica única de saldo (efeito de `isPaid`, pendentes, anulados) | P3 | **Tomada em P3-F (§18.6), implementada e testada: regime de caixa realizado.** Só o lançamento confirmado, não anulado, com data efetiva até hoje em São Paulo, move o caixa, no mês da data efetiva e pelo valor liquidado. Pendente (vencimento hoje ou passado) e agendado (vencimento futuro) não movem; o vencido continua pendente até ser confirmado ou anulado. O vencimento (`dueDate`) é preservado na confirmação, que grava a data efetiva; a anulação mantém o histórico. Investimentos (`investmentMetadata`) e cartões (`parcelado`, P4) mantêm contratos próprios. Legado ambíguo não é convertido em confirmado. Competência (accrual) não é adotada. |
| D-30 | Contas/carteiras e transferências entre contas como tipo de movimento próprio | P3 | **Tomada na P3-J (§18.10), implementada e testada:** contas autoritativas `cash_accounts` (dinheiro, conta corrente, poupança, conta digital, outra) com `balanceCents` gravado só pelo backend e livro-razão imutável `cash_account_movements` (tipo, valor com sinal, origem, data efetiva, ator, operação); saldo inicial opcional como movimento `opening_balance` (não é receita, despesa nem quota); saldo negativo permitido; arquivamento só com saldo zero, sem exclusão; transferência como tipo próprio (`createCashTransfer`/`reverseCashTransfer`): duas pernas de efeito global zero, nunca receita, despesa nem `transactions`; estorno compensatório. Lançamentos manuais, importação, empréstimos e recebíveis movem a conta no mesmo commit; recorrência, divisão de contas, cartões e investimentos ficam para a P4. |
| D-31 | Metas: semântica de `progressBasis current_value` e das metas KPI PJ | P5 | **Tomada em 2026-10-09 (§9.4) e implementada na P5-B (§20.3), aguardando auditoria independente.** |
| D-32 | Tempos de resposta por severidade, página de status e acesso de emergência (break-glass) | P7 | Base de INCIDENT_RESPONSE.md. |
| D-33 | Rollout do App Check: período de monitoramento, ordem de enforcement (Functions, Firestore, Auth) e critério de rollback | P6 | Ver FIREBASE_PRODUCTION.md. |
| D-35 | Correção de lançamento: edição livre, estorno + novo lançamento, ou bloqueio após fechamento de período | P3 | **Tomada em P3-C (§18.3): correção por edição auditada e anulação lógica com motivo, sem bloqueio por período.** Identidade, criação, autor e âncora da criação preservados; cada correção grava em `cash_events` antes e depois em centavos, campos alterados, ator, papel, motivo, intenção e correlação; o anulado permanece, sai do caixa e não é corrigido nem reativado; nada é apagado e nenhum estorno de outro domínio é feito. A devolução de quota na anulação fica em D-40. |
| D-36 | Casos de borda de cartão: compra retroativa em ciclo fechado, pagamento antecipado, estorno de compra parcelada, fechamento automático de fatura, ajuste manual (`manual_adjustment`) e conta de origem do pagamento | P4 | **Tomada na P4-A (§19.1), implementada e testada:** retroativa mantém `purchaseDate` e lança as parcelas de ciclo fechado na primeira fatura aberta (aviso na prévia; fatura fechada nunca alterada); fatura fechada pode ser paga antes do vencimento, aberta não; `cycleStatus` e `paymentStatus` separados, `overdue` só derivado, paga continua paga; fechamento diário com releitura transacional, paginado e idempotente; cancelamento lógico só com todas as parcelas em faturas abertas, senão crédito imutável na fatura aberta; ajuste só owner/admin, com sinal, motivo e sem saldo negativo, compensado na primeira aberta quando a competência já fechou; pagamento exige conta ativa (sem carteira, método externo nem `manual_adjustment`), move a conta no mesmo commit e o estorno volta à mesma conta. |
| D-37 | Definição e regime dos KPIs de relatório (ex.: taxa de poupança, lucro líquido PJ) | P5 | **Tomada (2026-10-09):** aprovada em parte na P5-B (§20.3) e integralmente, com as diretrizes 37.1–37.10, antes da P5-C1; registro em §9.4 e implementação em §20.5. |
| D-38 | Via única de atualização da projeção de caixa: no commit da callable ou por gatilho com retry idempotente | P3 | **Tomada em P3-B (§18.2): gatilho com retry idempotente, mais cerca de corte na reconstrução.** A projeção no commit da callable foi descartada enquanto houver escritores que não passam por ela (cliente legado, espelhos, cron). Garantias provadas por teste em §18.2. Nenhum cenário ficou bloqueado pelos escritores legados; as limitações documentadas (descarte depois de 24 h sem registro possível, recomeço sob edição contínua, teto de 498 meses) não dependem deles. |
| D-40 | Quota de lançamentos (`transactionsPerMonth`, D-08): mês de referência (data de criação × data do lançamento em São Paulo); o que consome (espelhos de investimento e de fatura, recorrentes, parcelas, empréstimos, recebíveis, divisão de contas, importação); se a anulação devolve a unidade (D-35 tomada em P3-C sem decidir isso); retroativo e excedente após downgrade | P3 | **Tomada em P3-D (§18.4): quota mensal por workspace, pelo plano efetivo do titular canônico (Free 50, Pro 1.000, Business 10.000), no mês civil de São Paulo da criação pelo relógio do servidor.** Consomem a criação manual confirmada e cada linha nova de importação; não consomem correção, anulação, replay, falha antes do commit, espelhos e registros automáticos de outros domínios; a anulação não devolve; retroativo consome o mês do registro; downgrade e transferência só valem para novas criações. Aplicada em `createCashTransaction` e `importCashTransactions`. Desde P3-E (§18.5) a interface cria receita e despesa paga pela callable e o indicador vem do contador do backend; os escritores legados restantes (outros domínios) ainda não passam pela quota. **Estendida em P3-F (§18.6):** o lançamento pendente ou agendado consome uma unidade na criação, no mês de registro em São Paulo pelo relógio do servidor; a confirmação não consome (mesmo em outro mês); correção, anulação e replay não consomem nem devolvem. |
| D-39 | Recebíveis: recebimento parcial, juros, multa e desconto | P3 | **Tomada na P3-I (§18.9), implementada e testada:** recebimento parcial; principal, juros, multa e desconto explícitos; juros e multa não abatem o saldo; desconto abate o saldo e não é dinheiro; caixa = principal + juros + multa (principal como receita operacional, juros e multa como resultado financeiro); `balance = amount − principalRecebido − desconto`; `received` se e somente se saldo 0; `cancelled` terminal e só sem recebimento ativo; atraso derivado (`open` e vencimento antes de hoje em São Paulo). |

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
| R-04 | Compilar o Tailwind muda a aparência da UI autenticada. | Comparação por screenshot antes/depois em viewports mobile e desktop (skill `ptbr-product-ui-review`). Em P2C-H2 o Tailwind foi compilado com a mesma linha 3.4 e a mesma configuração do CDN. Comparado ao "antes" emulado (CSS gerado das classes do DOM vivo, como o Play CDN faz), deu 0 pixel diferente em 46 telas (`docs/production/evidence/p2c-h2/paridade-cdn-emulado.json`). Resta conferir com o CDN real (versão embutida), num ambiente que o alcance (§17.11). Rollback: reverter `index.html`, `tailwind.config.js`, `postcss.config.js` e as três dependências de build. |
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
| 2026-10-02 | P2 | P2C executada sobre o HEAD `37d8780` em container limpo (§17.10). As quatro correções de P2C já estavam no HEAD; patch avulso retirado. Revisões das skills sem veredito em P2 acharam e esta etapa corrigiu, com teste: F1 (uso agregado de IA exposto a não titular), A1–A5 (código cru da plataforma, upgrade oferecido a quem não é titular, interpolação vazia, estado da conta, acessibilidade), B1–B3 (sinais do webhook e da IA) e o limite de corpo do webhook; docs alinhados (B-1). Validação: `verify:fast` verde (360 / 174 / 128 / 35), integração 366/366 e Rules 98/98 no `verify:all` nº 2; no nº 3, 17 cancelados por travamento de carga do Emulator em `simpleMode` (isolado 50/50); E2E sem 4 specs por CDN negado pela política de rede. `regression-release-gate` **FAIL**; P2 segue em andamento. E-06 — EXTERNAL CONFIGURATION REQUIRED. P3 não iniciado. |
| 2026-10-02 | P2 | P2C-H2 (§17.11) sobre o HEAD `37d8780` + working tree. **Tailwind local**: o build do Vite com PostCSS substitui o Play CDN, sai o importmap `esm.sh` sem consumidor e `lang` passa a `pt-BR`; paridade com o CDN emulado em 46 telas, com 0 pixel diferente. **E2E de checkout e portal** com fronteira Stripe simulada: 4 testes, só `planId`, carregamento, falhas, redirecionamento, portal e conta sem estado confiável. **Travamento de `simpleMode`**: causa raiz no `BulkWriter` do SDK 7.11.6 sob contenção entre arquivos; a integração passa a rodar um arquivo por vez, preso no contrato. Também: `lib/` das Functions limpo no build; teste de janela de relatório corrigido para `America/Sao_Paulo`; evidência visual, contraste e axe em `docs/production/evidence/p2c-h2/`. `verify:all` verde: Functions 362, frontend 174/128/35, integração 366, guarda 15, Rules 98, E2E 45/45; 0 skip e 0 cancelado. Gate **A (técnico) PASS**; gate **B (comercial/produção) FAIL** por E-06, PR-AI-02/E-00 e itens de P6–P9. P2 tecnicamente concluída, com fechamento formal pendente de ações externas. REQ-FUT-01 registrado (§9.3). P3 não iniciado. |
| 2026-10-03 | UX-H1 (estabilização de interface; não é milestone) | V-01…V-06 corrigidos, só no frontend (§17.12): ícones Lucide visíveis (o `stroke` só vai ao Tabler); menu mobile acima do Header, que fecha ao navegar, com toque fora e Esc, e foco de teclado; nomes acessíveis em pt-BR no Header; contraste AA em 5 temas (alerta 5,91:1, token `primary-on-dark` no escuro); carregamento só no botão acionado, bloqueio visível e plano em vigor destacado pelo entitlement canônico. Testes: `test:unit:ui` 5, `pricing-table-state` 8, E2E `ux-navigation-a11y` 7 e asserções novas em billing; `verify:fast` verde; E2E completo 52/52; mutação provada; 9 localizadores ambíguos de Investimentos corrigidos com `exact`. axe: tela de planos sem violações (antes: `button-name` crítico e contraste). `ptbr-product-ui-review` PASS no estado final. Achados novos fora do escopo: V-07…V-10. Integração e Rules não repetidas (sem mudança de backend). P2 continua tecnicamente concluída, com E-06 e PR-AI-02/E-00 externos. REQ-FUT-01 mantido. P3 não iniciado. |
| 2026-10-03 | P3 | P3-A (§18.1): callable `createCashTransaction` (receita ou despesa manual confirmada) com schema estrito, `amountCents`, data civil de São Paulo até hoje, autorização relida na transação, idempotência por intenção (chave do ator + ID determinístico do lançamento), evento `cash_events` sem valor nem texto livre e marca `cashEntry` imutável pelo cliente nas Rules. Testes: contrato 8, integração 16, Rules +2 (100/100), implantação +1; integração completa 382/382; 6 mutações detectadas. Quota bloqueada por D-40 (nova); edição e anulação por D-35; projeção por D-38. Frontend não migrado. Skills: segurança multi-tenant e custo PASS; integridade financeira FAIL pelo que falta em P3. P3 em andamento. |
| 2026-10-03 | P3 | P3-B (§18.2): D-38 tomada — gatilho de caixa com `retry: true`, falha classificada (passageira relançada; permanente ou perto do fim da janela de 24 h registrada em `needsRebuild`) e cerca de corte na reconstrução, com publicação numa única transação que soma as marcas posteriores ao corte e recusa acima de 500 escritas; limite operacional de 120 criações/10 min por ator e workspace na `createCashTransaction`, sem consumo em replay ou falha; TTL declarado para `cash_period_events` e `rate_limits`. Testes: unitário 6, recuperação 8, cerca 20, limite 6, contrato +1; 11 mutações detectadas. Skills: custo PASS; integridade financeira FAIL pelo que falta em P3. P3 em andamento. |
| 2026-10-03 | P3 | P3-C (§18.3): D-35 tomada — correção por edição auditada e anulação lógica com motivo, sem bloqueio por período. Callables `updateCashTransaction` e `voidCashTransaction` no kernel, com schemas estritos e separados, `amountCents`, data civil de São Paulo, `expectedUpdatedAt` (conflito em pt-BR), autorização relida na transação (member só o próprio, viewer nunca), idempotência por intenção com âncora durável em `cash_events` (antes/depois em centavos, campos, motivo, intenção, correlação), limite de 120/10 min sem consumo em replay e elegibilidade por evidência positiva (lançamento da callable e legado manual inequívoco, adotado; espelhos, vínculos e ambíguos recusados). Testes: contrato 7, integração 21, Rules +1 (101/101), implantação +2 callables; integração completa 437/437; 15 mutações detectadas. Skills: segurança multi-tenant PASS; integridade financeira FAIL pelo que falta em P3. Frontend não migrado; quota em D-40. P3 em andamento. |
| 2026-10-04 | P3 | P3-D (§18.4): D-40 tomada — quota mensal de lançamentos manuais por workspace, pelo plano efetivo do titular canônico (Free 50, Pro 1.000, Business 10.000), no mês de registro em São Paulo pelo relógio do servidor; contador server-only (`quota_state/transactions_{YYYY-MM}`) com âncora criada junto com o workspace e falha fechada sem ela; consumo na mesma transação de `createCashTransaction` e da nova `importCashTransactions` (lotes de até 50, atômicos por lote, identidade estável por linha, retomada segura). Inicialização conservadora de workspaces antigos só no Emulator. Lacuna de idempotência da P3-C comprovada (chave reaproveitada em outro lançamento ou workspace após a expiração) e corrigida com âncora por intenção em `cash_events` (consulta de grupo, índice declarado). Testes: unitários 7, integração 41, Rules +1; integração completa 478/478, Rules 102/102; 17 mutações detectadas. Skills: segurança multi-tenant e custo PASS; billing e integridade financeira FAIL pelo caminho legado do cliente, que ainda cria sem quota. Frontend não migrado; P3 em andamento. |
| 2026-10-04 | P3 | P3-E (§18.5): criação, correção e anulação manuais confirmadas pela interface passam pelas callables de caixa (centavos exatos sem ponto flutuante, chave por intenção reusada no reenvio, duplo envio bloqueado, `expectedUpdatedAt` com nanossegundos, motivo obrigatório, erros em pt-BR, sem gravação local nem fallback); `getWorkspaceEntitlement.transactionsQuota` com uso só para o titular e indicador da UI pelo contador do backend (desconhecido não bloqueia); inicialização endurecida (recusa sem `createdAt`, ambíguo, teto e mudança concorrente; auditoria administrativa só no Emulator); rajada de importação sem perda nem duplicação (600 linhas, 1.200 entregas). `verify:all` PASS: integração 488/488, Rules 102/102, E2E 58/58; 14 mutações detectadas. Skills: segurança multi-tenant, custo e UI pt-BR PASS; integridade financeira e billing FAIL pelos escritores legados restantes e Rules ainda abertas. P3 em andamento. |
| 2026-10-04 | P3 | P3-F (§18.6): D-29 tomada — caixa realizado: só o lançamento confirmado, não anulado, com data efetiva até hoje em São Paulo move o caixa; pendente e agendado não; vencido segue pendente; vencimento preservado na confirmação. `createCashTransaction` aceita pendente (`status`, `dueDate`); nova `confirmCashTransaction` (data efetiva, valor liquidado, evento `cash_entry.confirmed`, sem quota); correção mantém o estado; anulação de pendente. Pendente consome quota na criação (D-40 estendida). `cashPeriodDeltaFor`, saldo e cards do frontend na mesma regra; reconstrução com relatório de divergência. Cerca da inicialização: falha demonstrada (4 cenários) e corrigida com janela sem escritas verificável (Rules + callables) e releitura por `updateTime`. Frontend: pendente e agendado pelas callables, confirmação pela edição. Testes: unitários das Functions 399, integração 511/511, Rules 103/103, E2E 60/60, frontend caixa 13; 16 mutações detectadas. Skills: segurança multi-tenant, custo e UI pt-BR PASS; integridade financeira e billing FAIL pelos escritores legados restantes. P3 em andamento. |
| 2026-10-05 | P3 | P3-G (§18.7): D-13 tomada — núcleo autoritativo de empréstimos PF/PJ no backend. Callables `createLoan`, `registerLoanPayment`, `reverseLoanMovement`, `cancelLoan` e `updateLoanMetadata`; contrato e movimentos com `schemaVersion: 1` em centavos e taxa inteira (ppm); motor único Price/SAC/simples/fixo/sem juros com maior resto; contratação com espelho de caixa obrigatório no mesmo commit; saldo reduzido só pelo principal; juros como resultado financeiro; estorno e cancelamento compensatórios; status derivado e rotina diária de atraso; auditoria `loan_events` sem dados da contraparte; projeção com campos de principal de empréstimo e resultado financeiro (aditivos, reconstrutíveis). Rules negam ao cliente falsificar, alterar ou apagar documento autoritativo; legado e telas inalterados. Testes: unitários das Functions 414/414, integração 531/531, Rules 104/104, E2E 60/60, frontend investimentos 175/175; 19 mutações detectadas. Skills: segurança multi-tenant, custo Firestore e privacidade PASS; integridade financeira e billing FAIL no escopo de P3 (caminho legado da interface e produtores de outros domínios). P3 em andamento. |
| 2026-10-05 | P3 | P3-H (§18.8): empréstimos só no schema autoritativo, sem migração nem coexistência (não há dados reais). Interface PF/PJ pelas callables com o mesmo visual da P3-G (comparação antes/depois); modelo único no frontend, conversões em centavos e taxa inteira sem ponto flutuante, reenvio seguro após falha incerta; escritores do cliente, motor de cronograma, modais antigos e análise de legado removidos; Rules negam qualquer escrita em `loans`/`loan_movements`; totais por agregado de `balanceCents` (cancelado fora); metadados sem efeito não gravam nada. Testes: `verify:all` PASS — unitários das Functions 414/414, empréstimos 21/21, integração 532/532, Rules 104/104, E2E 68/68; 14 mutações detectadas. Skills: segurança multi-tenant, custo Firestore, privacidade e UI pt-BR PASS; integridade financeira FAIL no escopo de P3 (LOAN-12, PR-TX-03, P7, D-39), sem achado na fatia. PR-LOAN-01…07 resolvidos. P3 em andamento. |
| 2026-10-05 | P3 | P3-I (§18.9): D-24 e D-39 tomadas, implementadas e testadas — clientes e recebíveis autoritativos no backend (8 callables), dados pessoais só em `client_private` (owner/admin), recebível em centavos com saldo, acumulados e status derivados no servidor, atraso derivado, recebimento parcial com juros, multa e desconto e espelho de caixa no mesmo commit, estorno compensatório, cancelamento lógico, arquivamento de cliente; Rules negam escrita nas seis coleções; interface pelas callables com o mesmo visual; modelo antigo removido sem migração; PR-CR-01…PR-CR-04 resolvidos, PR-CR-05 parcial (P8). `verify:all` PASS (integração 556, Rules 110, E2E 76); 26/26 mutações detectadas. |
| 2026-10-06 | P3 | P3-J (§18.10): D-30 tomada, implementada e testada — contas/carteiras autoritativas (`cash_accounts`) com saldo só do backend e livro-razão imutável (`cash_account_movements`), saldo inicial como movimento próprio, arquivamento só com saldo zero, teto de 100 contas por workspace, transferência e estorno de efeito global zero (6 callables); lançamento manual, importação, empréstimos e recebíveis movem a conta no mesmo commit; grupo genérico `wallet` removido sem migração; Configurações › Contas e carteiras e escolha de conta nos formulários; PR-TX-01/02/03/05 revistos e dependências P4/P5/P7/P8 separadas em §2. `verify:all` verde (integração 575, Rules 115, E2E 83); 35/35 mutações detectadas. **P3 — implementação funcional própria concluída; fechamento global do ledger depende da convergência P4 e dos gates transversais explicitamente atribuídos a P5/P7/P8.** P4 não iniciada. |
| 2026-10-06 | P4 | P4-A (§19.1): D-36 tomada, implementada e testada — cartões de crédito autoritativos em centavos no backend (13 callables e rotina diária de fechamento com releitura transacional), ciclo e pagamento separados, `overdue` derivado, retroativa na primeira fatura aberta, pagamento antecipado de fatura fechada pela conta escolhida (D-30) no mesmo commit, estorno na mesma conta, cancelamento × estorno de compra, ajuste manual com compensação, arquivamento no lugar de exclusão, Rules backend-only em todas as coleções `credit_card*`, modelo antigo, migração e camada de compatibilidade removidos; lançamento manual no cartão só pela callable, sem `parcelado`. PR-CC-01…PR-CC-08 resolvidos (saem no gate de P4); PR-TX-06 parcial. `verify:all` PASS (Functions 412 + 570, Rules 120, E2E 87); mutações 36/36. Recorrentes, Divisão de contas e P5 não iniciados. |
| 2026-10-07 | P4 | P4-B (§19.2): D-12 tomada, implementada e testada — recorrentes autoritativos em centavos no backend (8 callables e rotina diária `processRecurring` só como gatilho, com consulta seletiva paginada, tetos e retomada), ocorrência por recorrência + vencimento com ID determinístico, `executionMode` explícito, fato no domínio dono (despesa P3 pendente ou paga, compra P4-A à vista `source: "recurring"`), atenção com código seguro e nova tentativa, pausa/retomada sem recuperar o intervalo, cancelamento terminal, edição só do futuro; agenda pura idêntica no frontend e no backend; Rules negam escrita do cliente em `recurring_*`; módulo antigo, `handleGenerate`, Split na recorrência e `onAddTransaction` removidos sem migração. PR-REC-01…06 resolvidos; PR-TX-06 parcial só por Divisão de contas. `verify:all` PASS (unitários das Functions 416, integração 607, Rules 125, E2E 95); mutações 36/36; revisões: integridade financeira FAIL só no escopo global (Divisão de contas, P4-C; relatórios, P5), multi-tenant PASS, escala/custo PASS, UI pt-BR PASS. |
| 2026-10-07 | P4 | P4-C (§19.3): D-14 tomada, implementada e testada — Divisão de contas autoritativa no backend (22 callables), participante membro do workspace (`uid` validado) ou externo (só nome), convite por código CSPRNG guardado só como hash, rateio exato em centavos e basis points (maior resto, vetores compartilhados), quitação/perdão/estorno como fatos da Divisão (nunca o devedor), título com Caixa ou Cartão no mesmo commit e anulação compensatória, reembolso PJ com pagamento integral pelo Caixa e estorno, quota `splitGroups` no servidor; Rules negam toda escrita em `split_*`; `parcelado`/`cardId`/parcelas fora de `transactions`; módulo antigo removido. PR-SPLIT-01…07, PR-TX-06 e PR-RULES-01 resolvidos; PR-ENT-01 parte `splitGroups`. P4 não concluída (D-15, D-23). |
| 2026-10-07 | P4 | P4-D (§19.4): D-15 tomada, implementada e testada — Investimentos mantido com a experiência simples como única superfície (9 callables; 14 removidas com onboarding, rebuild e backfill), fato liquidado movimenta a conta do Caixa no mesmo commit (estorno na mesma conta; pendente sem conta), ledger e projeções como fonte patrimonial única (card do dashboard pela projeção mensal; espelho só de caixa com a marca `investmentEntry`), sem `walletId`, `investment_type` nem fallback sem marca; `transactions` fechada a toda escrita do cliente e caminho legado do Caixa removido (`legacy_manual`, backfill de quota, janela de congelamento); 10 índices sem consumidor removidos e TTL das coleções operacionais de investimentos versionado; sem quota nem feature gate. PR-INV-01, PR-TX-01, PR-TX-02 e PR-TX-05 resolvidos; PR-TX-03 e PR-ENT-01 atualizados. P4 não concluída (D-23 e gate). |
| 2026-10-07 | P4 | P4-D.1 (§19.5): fechamento documental pós-D-15 — LAUNCH_CHECKLIST 3.12/3.13 e linhas correlatas no estado real; INV-11 resolvido e TTL descrito como versionado × publicado × D-18; afirmações falsas de TTL e referências deslocadas corrigidas; comentários que supunham dados legados reescritos (só texto). Sem mudança funcional. P4 segue aberta só por D-23 e pelo gate. |
| 2026-10-07 | P4 | P4-E (§19.6): D-23 tomada, implementada e testada — catálogo de configurações backend-authoritative: domínio `functions/src/settingsCatalog/` (grupos, subtipos `receita`/`despesa`/`investimento`, normalização, chave de unicidade, escopo PF/PJ derivado, IDs de semente `seed_<hash>`), callables `createSettingsCatalogItem`, `updateSettingsCatalogItem` (renomear, aparência, inativar/reativar) e `archiveSettingsCatalogItem` só para owner/admin com releitura na transação, item + reserva de nome + trilha no mesmo commit, renomear atômico, sem exclusão; Rules: catálogo só leitura no cliente (`limit <= 2001`), reservas e trilha fechadas; índice da leitura completa; `parcelado` fora do catálogo (aba Parcelado usa despesa), Recorrentes pelo catálogo, mock do `App` removido. PR-RULES-03 resolvido. `verify:all` PASS (Functions 443 + 603, frontend 516, Rules 144, E2E 103); mutações 12/12 com efeito detectadas. P4 não concluída: resta só o gate. |
| 2026-10-08 | P4 | Gate final da P4 (§19.7) sobre o checkpoint `0d97901` (tag `checkpoint-p4e-audited-2026-10-08`): **P4 GATE PASSED**. Correções: trilha do gatilho de `transactions` pela classificação autoritativa em centavos (o leitor de `investmentMetadata`, removido na D-15, saiu), helper morto das Rules e quatro helpers P4 sem uso removidos, documentação CURRENT corrigida. Suíte transversal nova (6 cenários entre domínios), 14/14 mutações efetivas mortas, evidência visual base × gate sem mudança. `verify:all` **PASS** em 24 min (2026-10-08T17:37:10Z–18:01:44Z), depois da última mudança funcional: typecheck; lint das Functions com 0 erros (204 avisos, os mesmos da base); builds do frontend e das Functions; unitários das Functions 443; unitários do frontend 516; integração das Functions no Emulator 609 (603 + 6 da suíte transversal); ferramentas 17; Rules 144 em 15 suítes; E2E 103. Nenhum teste pulado, `only`, repetido ou instável. Revisões PASS e `regression-release-gate` PASS. **P4 concluída**; P5 não iniciada. |
| 2026-10-08 | P5 | P5-A (§20.1): D-41 tomada pelo usuário (histórico da IA no navegador, por usuário e workspace, apagado no logout) e implementada — chave `finance_ai_chat_history_v2:<uid>:<workspaceId>` com envelope validado, sessões com geração contra respostas tardias, dono local para resíduos de outra conta e para abas antigas, formato antigo só expurgado; sem mudança visual (12 capturas idênticas à base). 35 testes unitários novos (hooks reais) + 3, 2 E2E novos, 16/16 mutações efetivas mortas; `verify:all` PASS; revisões multi-tenant, privacidade e pt-BR PASS; `regression-release-gate` PASS. PR-AI-04 resolvido, aguardando auditoria independente. |
| 2026-10-08 | P5 | P5-D1 (§20.2): infraestrutura de notificações corrigida — evento backend-owned (nenhum papel grava; `list` com `limit <= 50`), estado de lida/arquivada por usuário em `notification_user_states/{uid}/items/{id}` com Rules estritas, páginas de 25 por cursor, fim do polling de 30 s, arquivar sem exclusão, `createNotification` e `NotificationBell` removidos. PR-NOTIF-01 segue aberto (TTL/D-18, contagem exata P5-D2, produtores). Aguardando auditoria independente. |
| 2026-10-09 | P5 | P5-B (§20.3): D-31 registrada (D-31.1…D-31.5) e implementada; D-37 aprovada só em parte (regime de caixa realizado, backend como fonte, nomes dos indicadores). Metas com uma fonte de progresso explícita (`manual`, `investment`, `business_kpi`), centavos inteiros e margem em pontos-base; 7 callables com Zod estrito, transação, papel relido, idempotência (reserva com TTL de 90 dias) e trilha; troca de fonte sem reaproveitar progresso; arquivamento lógico recusado com posição vinculada e investimentos recusando meta arquivada ou não patrimonial na transação; indicadores PJ no servidor sobre `cash_report_periods` e `cash_accounts`; lista por cursor com teto de 26 nas Rules (`goals` em `isBackendOwnedCollection`) e contagem exata no servidor; `logic.ts` e `projection.ts` removidos. Mutações 28/28 mortas. Validação da P5-B verde; gate global FAIL só pelo débito herdado da D-18 (TTL de notificações). Aguardando auditoria independente; P5-C, P5-D2, P5-E e P5-F não iniciadas. |
| 2026-10-09 | P5 | P5-B.1 (§20.4): complementação da P5-B após a auditoria independente — metas de investimento além da centésima selecionáveis e vinculáveis (seletor por páginas sob demanda, sem teto fixo; nomes de metas fora das páginas resolvidos por ID), meta manual também no formulário PJ ("Valor informado", sem indicador nem base patrimonial) e centro de custo declarado informativo (indicadores PJ usam os valores gerais da empresa; segmentação na D-37/P5-C). Só frontend e testes; backend, Rules e índices inalterados. `verify:all` 2.071 testes, 0 falha; mutações 12/12. Gate global segue FAIL só pelo débito herdado da D-18. Aguardando auditoria independente; P5-C1 não iniciada. |
| 2026-10-10 | P5 | P5-C1 (§20.5): D-37 aprovada integralmente (37.1–37.10) e implementada — Dashboard e Relatórios leem só a callable `getFinancialReport` (Zod estrito, papel relido na transação do limite de 300/h, período civil de São Paulo e PF/PJ no servidor, centavos e pontos-base em BigInt, cobertura por bloco); projeção de caixa v5 com detalhe diário e projeção por categoria por ID e por geração, reconstrução v5 com publicação atômica; cartão em duas visões, dívidas e recebíveis separados, investimentos do próprio domínio (patrimônio, evolução e reconciliação fora do viewer); fórmulas, janelas e leitores de histórico do navegador removidos; releitura ao vivo com orçamento. `verify:all` PASS (2.188 testes, 0 falha, 0 skip); mutações 34/35 (I07 justificado) + 6/6; evidência visual antes/depois em 34 capturas por árvore. PR-RPT-01/02 resolvidos e PR-RPT-03/05 parciais, aguardando auditoria independente; PR-RPT-04 (P5-D2), IA (P5-E1) e PR-TX-03 abertos; P5 não concluída. |
| 2026-10-10 | P5 | P5-C1.1 (§20.6): complementação da P5-C1 após a auditoria independente — a fatura vencida deixava de aparecer como "atual" e a corrente deixava de ir para o futuro: por cartão, atraso (`isInvoiceOverdue`), fatura atual (próxima obrigação de menor vencimento e competência, nunca vencida) e futuro disjuntos, Σ = pendente do cartão e Σ dos cartões = agregados do bloco, numa transação somente leitura; cartão arquivado com saldo listado e marcado; "—" sem fatura atual; teto de vencimentos 3 × 50 provado. I07 testado pela callable com barreira controlada (rebaixamento → papel novo, remoção → recusa; log com o papel relido). Revisão adversarial: 0 BLOCKER/HIGH, 3 MEDIUM e 8 LOW — M1 e L1–L4, L6, L7 corrigidos; M2, M3, L5, L8 registrados. `verify:all` PASS (2.215 testes, 0 falha, 0 skip); mutações 18/18; evidência antes/depois em 16 capturas por árvore. Índice Git regularizado (deleção staged de `investments.ts`). Gate global segue FAIL só pelo débito herdado da D-18. Aguardando auditoria independente; P5-C2 não iniciada. |
| 2026-10-11 | P5 | P5-C2 (§20.7): contrato único de `transactions` — `valueCents` inteiro até o teto, `date` civil única, tipo coerente com a marca; `value`, `transactionDate` e `parcelado` removidos de todo produtor e leitor, sem migração; documento fora do contrato vira `contract_violation` (gatilho) e recusa da reconstrução, nunca R$ 0,00; frontend exclui e avisa. M2 (rótulos de fatura com `effectivelyClosed`), M3 (crédito não aplicado só informado; índice novo, 70 compostos), L5 (coluna "Em atraso") e L8 (só falha passageira vira bloco indisponível; alertas de empréstimo preservados). D-18: desenho técnico pronto, prazo pendente de aprovação. Revisão adversarial (Opus): 0 BLOCKER/HIGH, 3 MEDIUM e 5 LOW corrigidos. `verify:all` PASS (2.282 testes, 0 falha, 0 skip); mutações 38/38; evidência visual em 48 capturas por árvore (28 telas idênticas). PR-TX-03 resolvido, aguardando auditoria independente; P5 não concluída. |
| 2026-10-11 | P5 | D-18-NOTIF (§20.8): retenção de notificações decidida (180 dias desde a criação do evento no servidor) e implementada — `expiresAt` Timestamp no evento (mesmo instante do `createdAt`, retry não prorroga), estado privado em `notification_entries` com `expiresAt` copiado e marcas monotônicas (`read`, `dismissed`, `deleted`), "Excluir para mim" só owner/admin/member pelas Rules, oculto após o vencimento por relógio local; dois `fieldOverrides` de TTL declarados, não publicados (E-07); Q-1, L-4 e L-5 residuais da P5-C2. Aguardando auditoria independente. |
| 2026-10-11 | P5 | P5-D2 (§20.9): identidade FênixGran registrada (sem rebranding nem renomeação técnica); motor único de notificações no backend (contrato, builder estrito, ID determinístico por workspace/domínio/entidade/tipo/episódio, `create` idempotente) e produtores oficiais `loan_overdue`, `receivable_overdue` (janela de 7 dias, rotina com cursor persistido de retomada), `cash_account_negative_balance`, `goal_achieved` e `recurring_*`, com cartões (D-36) preservados; sem reemissão depois do TTL pela condição de emissão de cada produtor; textos no passado, sem dado pessoal nem valor; correlação por `sourceEventId`/`runId`. Contagem exata de não lidas pela callable `getNotificationUnreadCount` (duas agregações numa transação somente leitura no `readTime` do servidor, `asOf` com nanossegundos, negativo é erro, sem `Math.max`), "?" quando indisponível, sem polling. Relatórios: falsa leitura removida, "Condições do período" com "Calculado em" e completude que inclui o caixa (PR-RPT-04 resolvido, aguardando auditoria). PR-NOTIF-01 tecnicamente resolvido, aguardando auditoria; divisão de contas bloqueada (entrega dirigida) e decisões pendentes (meta pelo progresso, vencimento próximo) registradas; TTL não publicado (E-07); D-18 geral e lista da P7 inalteradas. Revisão independente: 0 BLOCKER, 0 HIGH; MEDIUM e LOW corrigidos ou registrados. Nada publicado. |
| 2026-10-12 | P5 | P5-D2.1 (§20.10): D-42 aprovada pelo usuário e implementada — `receivable_overdue` sem limite de dias, um aviso por episódio (`dueDate`), sem reemissão depois do TTL. As 5 operações de recebíveis enfileiram ou retiram o trabalho na mesma transação (`receivable_overdue_queue`, `runAfterDay = max(vencimento + 1, dia da operação)`); rotina horária com transação por item (revalida o recebível; aviso + confirmação durável sem TTL + remoção do item no mesmo commit), falha registrada no item com pré-condição de versão e backoff por classe, nunca descartada; capacidade por tempo e teto de páginas, justiça em duas passadas (cota de 500 por workspace na 1ª). Removidos a janela de 7 dias, a consulta de grupo de `receivables` com o seu índice e o cursor `system/receivable_overdue_notifications`. Rules negam as duas coleções a todos os papéis. Três rodadas de revisão independente (0 BLOCKER; 1 HIGH, 2 MEDIUM e os LOW corrigidos; a última "aprovável"); 53/53 mutantes mortos; benchmark de 100 a 50.000 com conjuntos exatos; `verify:all` 2.630/2.630. Sem commit, push ou deploy. |
| 2026-10-12 | P5 | P5-E1 (§20.11): D-11.1–D-11.4 e D-09 aprovadas pelo usuário (§9.4). Consultor com contexto montado só pelo backend a partir do relatório oficial, com o papel relido, sem série e sem ranking de clientes: centavos inteiros, cobertura por bloco, indisponível nunca vira zero e nenhum ID ou nome. Payload estrito, sem nenhum valor do cliente. Confirmação de envio versionada por operação, exigida antes de qualquer leitura, crédito ou chamada ao provedor; diálogos acessíveis no chat, no comprovante e na voz em duas etapas. Extração com `responseJsonSchema` revalidado por Zod estrito: estados por campo, valor por BigInt, datas reais, sem `parcelado` e sem gravação automática. SDK `@google/genai` no lugar do legado, com instrução de sistema separada, tempo limite de 90 s, sem repetição automática e erros sem a mensagem do SDK. Política de créditos P2B.2 inalterada. Revisão independente: 0 BLOCKER e 0 HIGH; todos os MEDIUM e LOW tratados. Integração 941/941, Rules 273/273 e unitários 639 + 763; E2E 167/169 numa cópia com só as portas trocadas, com o teste novo corrigido (11/11) e uma falha intermitente preexistente das notificações que reproduz na base. Mutações: 42 sobre a árvore final, 41 mortas e 1 equivalente justificado (F08). Gate `FAIL` por bloqueadores alheios ao código: `verify:all` como está não roda (porta 8080 presa por emulador órfão) e há a falha preexistente. Rotação da chave não executada. P5-E1 não concluída. |
| 2026-10-13 | P5 | P5-E1.1 (§20.12): nomes de categoria fora do contexto da IA ("Grupo de despesas N" pela posição; `ANALYSIS_CONTEXT_VERSION = 2`), diálogo de transparência fiel ao payload, falha intermitente do celular corrigida nas duas causas (clique de compatibilidade redirecionado e saída presa do framer-motion 10.16.4), marcas confirmadas que não voltam atrás e acessibilidade do diálogo; repetições 80/80 na árvore final; 54 mutantes mortos; três revisões Opus (a última sem BLOCKER, HIGH ou MEDIUM); `npm run verify:all` como está com saída 0 (2.883 testes); gate `PASS`. Aguardando auditoria independente. Sem commit, push ou deploy. |
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
| Documentos com `STRIPE_ALLOWED_PRICE_IDS` | **Resolvido em P2C** (§17.10): README e `docs/production/*` alinhados aos segredos e ao estado canônico atuais | — |
| `tools/staging/rehearsal.sh` | Não inspecionado nesta etapa | P6 |
| Instabilidade de Emulator | **Resolvido em P2C-H2** (§17.11): o travamento de `simpleMode` vinha do `BulkWriter` do SDK 7.11.6, que não reenvia operação reenfileirada após `ABORTED`, acionado por contenção de lock entre arquivos paralelos no mesmo Emulator. A integração das Functions passou a rodar um arquivo por vez (`--test-concurrency=1`, preso no contrato de deploy). Antes, em P2C, a corrida entre as suítes de recorrentes já tinha sido corrigida | — |
| `BulkWriter` sem reenvio após `ABORTED` (SDK `@google-cloud/firestore` 7.11.6) | Risco para código de produção que use `recursiveDelete`/`BulkWriter` sob contenção: a operação pode ficar pendente sem erro. Hoje só os testes usam (§17.11) | Jobs de exclusão e retenção: P8 (não depender da repetição do `BulkWriter`; ou atualizar o SDK com teste de contenção) |
| Paridade visual do Tailwind compilado com o Play CDN (R-04) | Antes/depois com o CDN emulado: 46 telas, 0 pixel diferente, nenhuma classe do DOM ausente do build (§17.11). Residual: a versão exata do Tailwind embutida no CDN real não foi exercida (host negado) | Conferência opcional com o CDN real num ambiente que o alcance: P6 |
| Achados de acessibilidade do painel V-07…V-10 | Encontrados no axe da UX-H1 em telas não tocadas: contraste nos cards e chips do painel, `<select>` de "Transações Recentes" sem nome (crítico), setores do Recharts sem texto alternativo e ícone de "Empréstimos" com desenho de recurso (§17.12) | COMM-06 / LAUNCH_CHECKLIST 8.9 (P9) ou etapa de UX autorizada |
| Achados pré-existentes V-01…V-06 | **Corrigidos em UX-H1** (§17.12): ícones visíveis nos três pacotes, menu mobile acima do Header e fechando ao navegar, botões do Header com nome acessível, contraste AA nos elementos medidos em 5 temas e carregamento só no botão acionado, com o plano em vigor destacado. Registro original em §17.11 | — |
| Contenção do webhook (P2A.1) | Espera por lease ocupado dentro da requisição (até cerca de 8,5 s) e validade de 60 s: a queda de uma entrega deixa os eventos do mesmo titular em 500 até o lease vencer, e o Stripe reentrega. Customer com mais de 500 assinaturas falha fechado (500) até o Stripe desistir (§17.7) | Alertas sobre `billing_webhook.contention`, `billing_webhook.lease_taken_over` e `billing_webhook.failed`: P7 |
| E2E `workspace-membership` dependente de ordem | **Resolvido** (correção no HEAD `722cd1c`, `src/contexts/WorkspaceContext.tsx:171`): os dois cenários passaram no E2E completo da P2C (§17.10) | — |
| E2E final de P2A.1 | **Resolvido**: `e2e/billing-bootstrap.spec.ts` passou no E2E completo da P2C (§17.10) | — |

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
| `users/{actorUid}/ai_usage_receipts/{receiptId}` | `operation`, `actorId`, `workspaceId`, `billingOwnerUid` (titular debitado), `monthKey`, `creditCost`, `requestHash`, `createdAt`, `expiresAt` | **Actor-scoped:** a chave de idempotência é da intenção de quem a enviou, não do owner vigente; o recibo continua encontrável depois de troca de plano ou de transferência do workspace. `receiptId` = SHA-256 de ator + chave; `requestHash` = SHA-256 da operação e do payload validado, salgado pela própria chave. Nunca pergunta, transcrição, base64, comprovante, prompt, resposta ou JSON extraído. TTL de 90 dias (`RETENTION_DAYS.aiUsageReceipts`; `firestore.indexes.json`, collection group `ai_usage_receipts`, `expiresAt`) |

O uso mensal é **billing-owner-scoped** (o crédito pertence ao titular); o recibo é **actor-scoped**. Não existe outro caminho de recibo: o caminho inicial sob `billing_accounts/{ownerUid}/ai_usage_receipts` foi removido no hardening final, sem migração nem fallback (não há dados reais). Evidência: `functions/src/billing/aiCredits.ts:46-53,130-146`; `functions/src/shared/retention.ts:54-60`.

**Admissão atômica** (`functions/src/ai/admission.ts:91-179`, substitui `consumeAiRateLimit`). Uma única transação: releitura do ator (`reassertWorkspaceActor`, papel inalterado) → owner canônico (`canonicalOwnerCandidate`) → um `getAll` com o recibo da chave (sob o ator), membership do owner, billing do owner, uso do mês e rate limit horário → recibo primeiro (conflito ou já processada, qualquer que seja o owner atual) → `assertCanonicalOwnerMembership` → `entitlementAt` no relógio do servidor → rate limit existente (`reserveRateLimitFromSnapshot`, `functions/src/shared/rateLimit.ts`) → `usados + custo <= aiCreditsPerMonth` → grava o uso do owner, cria o recibo do ator (com o `billingOwnerUid` debitado) e confirma o rate limit no mesmo commit. Toda recusa lança antes da primeira escrita: nenhum rate limit consumido com quota recusada, nenhuma quota consumida com autorização recusada. O documento mensal do titular serializa o último crédito.

**Quota.** O pool é do billing owner (D-01): todos os workspaces de que ele é owner e todos os membros autorizados deles; após uma transferência, os usos seguintes consomem o pool do novo owner. Free 10, Pro 150, Business 750 (catálogo, sem mudança). Downgrade não apaga o uso e recusa com `usados >= novo limite`; upgrade libera até o novo teto; grace mantém o teto pago. `QuotaResource` inclui `aiCreditsPerMonth`; `quota_exceeded` → `resource-exhausted`, "Os créditos de IA deste plano acabaram neste mês. Faça upgrade ou aguarde a renovação mensal.", detalhes só `resource`, `planId`, `limit`, `used` e `periodKey`, nada do titular (`functions/src/billing/quota.ts:76-89,104-126`). Custo por operação em `AI_CREDIT_COSTS` (análise, extração de texto e de documento: 1 crédito cada; `functions/src/ai/policy.ts:31-35`), só no servidor.

**Idempotência.** `idempotencyKey` obrigatória nos dois contratos, pelo schema compartilhado `idempotencyKeySchema` (`functions/src/ai/callables.ts:77,152,158`); o cliente gera uma chave nova por ação intencional. Mesma chave e mesmo conteúdo ⇒ `failed-precondition` "Esta solicitação de IA já foi processada. Faça uma nova solicitação para consultar novamente.", sem crédito e sem provedor; outro conteúdo ⇒ `failed-precondition` "Esta chave de idempotência já foi usada com outros dados."; chamadas concorrentes com a mesma chave ⇒ no máximo um consumo e uma chamada externa, inclusive quando disputam workspaces de owners diferentes (o recibo do ator serializa). Como o recibo é do ator, a mesma chave continua idempotente através de transferência de ownership e de troca de plano: não debita o owner novo nem de novo o antigo e não chama o provedor; uma **chave nova** depois da transferência consome o pool do novo owner. A resposta não é guardada para replay (conteúdo pessoal; P5/P8).

**Provedor e custo por chamada.** Ordem fixa: contrato e pré-checagem (kernel) → segredo (`productionAiDependencies`, antes da admissão) → admissão → provedor por um gateway mínimo (`functions/src/ai/gateway.ts`), **sempre fora de transação**. `maxOutputTokens` 1200 na análise e 600 na extração (`AI_MAX_OUTPUT_TOKENS`, `functions/src/ai/policy.ts:40-43`), com o mesmo modelo (`gemini-3-flash-preview`) e o mesmo SDK; limites de entrada e `MAX_DOCUMENT_BASE64` inalterados. Os testes montam as callables pela mesma fábrica da produção (`createAiCallables`) com provedor falso. **Política de cobrança desta versão:** o crédito representa a tentativa aceita e enviada ao provedor. Falha anterior ao commit (contrato, autenticação, papel, segredo ausente, owner incoerente, chave repetida, rate limit, quota, contenção) não consome; depois do commit, timeout, 4xx/5xx, resposta vazia e JSON inválido **não** devolvem o crédito. Sem reembolso de crédito nem fluxo compensatório.

**Uso da própria conta.** `getAccountUsage` acrescenta `aiCreditsUsed`, `aiCreditsLimit`, `aiCreditsRemaining` (nunca negativo) e `aiPeriodKey`, só do próprio titular e pelo billing efetivo da própria conta (`functions/src/billing/workspaceEntitlement.ts:67-108`). `getWorkspaceEntitlement` não expõe uso de IA: um membro inferiria o uso de outros workspaces do titular.

**Frontend.** Contrato puro `src/modules/ai/callables.ts` (chave nova por ação, `AI_CREDITS_EXHAUSTED_MESSAGE`, `isAiCreditsExhausted`) ligado ao SDK em `src/modules/ai/api.ts`; `askFinanceAI` (`src/modules/reports/api.ts`) e `TransactionModal` usam os wrappers e mostram a mensagem de créditos esgotados. No comprovante (hardening final), a leitura do arquivo virou Promise (`src/modules/ai/documentFile.ts`, `readFileAsBase64`) e o `handleFileUpload` aguarda leitura e extração no mesmo `try/catch/finally`: `isAILoading` — que desabilita "Escanear Comprovante" e "Falar Transação" — só volta a `false`, e o input só é limpo, depois do fim real da chamada; o mesmo `catch` cobre erro de leitura, erro da callable e créditos esgotados. Antes, com `onload` assíncrono solto, o `finally` liberava os botões enquanto a extração ainda rodava. O fluxo de voz não mudou. O tipo `AccountUsage` recebeu os campos novos, sem superfície visual. Histórico de IA e `localStorage` (PR-AI-04) e schema da saída (PR-AI-05) intocados.

**Mudança visual:** nenhuma de layout, classe ou componente. Só texto: a resposta do chat e o status do modal mostram a mensagem de créditos esgotados (nesse caso o status fica 6 s em vez de 3 s); contenção nos modais de workspace mostra a mensagem do backend em vez da genérica. Correção de estado, sem mudança visual: a barra de carregamento e o bloqueio dos botões de IA do comprovante passam a durar a chamada inteira.

**Rules e índices.** `billing_accounts/{uid}/{document=**}` já nega leitura e escrita do uso mensal (comentário explícito em `firestore.rules:1431-1438`); regra explícita backend-only para `users/{userId}/ai_usage_receipts/{receiptId}` (`firestore.rules:1402-1409`): nem o próprio usuário lê, lista ou grava, e leitura cruzada continua negada. Nenhuma regra de collection group alcança `ai_usage` ou `ai_usage_receipts`. Um override de TTL novo (collection group, vale para o caminho do ator); nenhum índice composto.

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
| Hardening final (recibo por ator e carregamento do comprovante): `aiCredits` (28, com 4 novos: mesma chave e mesmo conteúdo depois da transferência — recusa idempotente, sem debitar A nem B e sem chamar o provedor; mesma chave com outro conteúdo — conflito sem consumo; chave nova — consome B; mesma chave disputada em workspaces de owners diferentes — um consumo e uma chamada) + `quotaWorkspaces`, 3 rodadas | 3/3 rodadas com 44/44 |
| Hardening final: `test:rules:billing` (uso mensal do titular e recibos do ator separados; recibo negado ao próprio ator, ao titular debitado, a conta suspensa e a anônimo em get, list, collection group, create, update e delete, com controle positivo do próprio perfil) | 9/9 |
| Hardening final: unitários de IA, kernel e contrato de deploy / cliente `test:unit:billing` (3 novos: leitura do comprovante só resolve no `onload`, rejeita em erro, cancelamento e arquivo vazio; ordem `loading → leitura → extração → catch → finally` no `handleFileUpload`) / typecheck | 81/81 / 31/31 / OK; lint sem aviso novo |
| `verify:all`, integração completa, E2E, build de produção, `regression-release-gate` | **Não executados**, por instrução (P2C, em ambiente limpo) |

**Blocker fechado.**

| ID | Sev. | Blocker de origem | Evidência do fechamento | Achados de origem |
| --- | --- | --- | --- | --- |
| PR-AI-03 | HIGH | Custo de IA sem teto efetivo: limite por workspace contornável, sem entitlement, App Check nem limite de tokens | `functions/src/ai/admission.ts:86-171 — teto mensal do titular na mesma transação da autorização, do recibo e do rate limit`<br>`functions/src/ai/policy.ts:31-43 — custo por operação e maxOutputTokens`<br>`functions/src/ai/callables.ts:209-227,244-275 — provedor só depois do commit`<br>`functions/src/ai/__tests__/aiCredits.integration.test.ts` (24 testes). App Check segue em PR-APPCHK-01 (P6) | RPTAI-03, ENTRY-10 |

**Separados (não resolvidos aqui):** PR-AI-01 → P8; PR-AI-04 e PR-AI-05 → P5; PR-ENT-01 → P3–P5; PR-APPCHK-01 → P6; E-06 → configuração externa ainda necessária para fechar P2 comercialmente. P2 não está concluída: o gate é P2C.

**Riscos residuais:** falha do provedor depois do commit consome o crédito (política deliberada desta versão); a resposta não é reenviada para a mesma chave; `ai_usage` sem TTL (P8); sem contabilização real de tokens (P5, D-11); sem App Check (P6).

**Rollback:** reverter o diff de P2B.2 remove créditos, recibos, gateway e `idempotencyKey`; os documentos `ai_usage` e `ai_usage_receipts` ficam sem leitor (dados de Emulator). O mapeamento de contenção para `aborted` é independente e pode ser revertido sozinho. Nada foi implantado.

**Skill:** `billing-entitlement-integrity` (escopo P2B.2, 2026-09-30): **PASS**. Teto mensal real e server-side pelo plano efetivo do titular, na mesma transação da autorização, do recibo e do rate limit; pool por billing owner (membros, workspaces, transferência); último crédito concorrente com uma única vencedora (repetido 5 vezes); nenhuma segunda chamada ao provedor para a mesma chave; `maxOutputTokens` por chamada; `ai_usage` e `ai_usage_receipts` backend-only (Rules testadas); a corrida de transferências só aceita `permission-denied` ou `aborted`, nunca `internal`. Fora do escopo: checkout, portal, webhook e máquina de estados do Stripe (sem mudança), E-06, D-08 residual, FIRE-10, PR-ENT-01 restante (P3–P5), PR-APPCHK-01 (P6), PR-AI-01 (P8), PR-AI-04 e PR-AI-05 (P5).

**Skill (hardening final, 2026-09-30, sobre o HEAD `904b62e`):** `billing-entitlement-integrity` sobre o diff do recibo por ator e do carregamento do comprovante: **PASS**. A mesma chave continua idempotente através da transferência de ownership (sem segundo consumo nem segunda chamada ao provedor, 3/3 rodadas); não existe outro caminho de recibo; `users/{uid}/ai_usage_receipts` é server-only (Rules 9/9); o carregamento do comprovante só termina depois da leitura e da extração; nenhuma regressão nas suítes de P2B.2 executadas. Mesmo "Fora do escopo" acima. P2 não está concluída; P2C não foi iniciada.

### 17.10 P2C — gate de P2: correções, validação integral e decisão (2026-10-02)

Sobre o HEAD `37d8780` (= `origin/main`), branch `ccr-d6cb80b8-paxbt2`, em container Cloud limpo (Node 22.22, Java 21, firebase-tools 15.32.1, Firestore Emulator 1.22.0, Playwright 1.60). Base do gate: `e862fa9` (fechamento de P1). Nada foi implantado, commitado ou enviado; Firebase só no Emulator `minhas-financas-local`; Stripe e provedor de IA falsos, sem rede. P3 não foi iniciado.

**Estado inicial.** As quatro correções de P2C já estavam no HEAD e não foram reimplementadas: `isLoading=true` no logout (`src/contexts/WorkspaceContext.tsx:171`); E2E de troca de usuário com bootstrap de B retido e fixture Pro (`e2e/workspace-membership.spec.ts`, `seedPaidPlan` em `e2e/support/workspaceSeed.ts`); deriva com workspace e cursor exclusivos (`zz-p2c-drift-000/001`); reconstrução concorrente aceitando só `isContentionAbortedError`. O `p2c_rebuild_concurrency.patch` da raiz era artefato já aplicado (`git apply --check -R` limpo) e foi retirado.

**Revisões especializadas (só as superfícies sem veredito em P2).** Até P2B.2 só `billing-entitlement-integrity` tinha veredito em P2; o gate exige as demais. Achados reais de P2 corrigidos nesta etapa, com teste:

| Achado | Skill | Correção |
| --- | --- | --- |
| F1 — `details.used` dos créditos de IA (pool agregado do titular) devolvido a membro de outro espaço | multi-tenant | `assertWithinQuota`/`quotaExceeded` exigem `actorIsBillingOwner`; não titular não recebe `used` (`functions/src/billing/quota.ts`; chamadas em `lifecycle.ts`, `memberships.ts`, `ai/admission.ts`) |
| A2/C1 — "Faça upgrade" para quem não é o titular (o limite é do plano do titular, D-01) | ptbr, saas | mensagens próprias para não titular (convite, aceite, IA); avisos de limite em Transações, Recentes e Divisão só oferecem upgrade ao owner |
| A1/C2 — 429/409 da plataforma exibidos como código cru e como "créditos esgotados" | ptbr, saas | `workspaceErrorMessage` recusa token sem espaço (parte pura em `src/modules/workspaces/errorMessages.ts`); `isAiCreditsExhausted` exige `details.resource = 'aiCreditsPerMonth'`; a mensagem exibida é a do backend |
| A3 — "plano  está ativa" | ptbr | `BillingSuccessModal` sem interpolação vazia |
| A4/C3 — tabela de planos ignorava o estado da conta | ptbr, saas | ações só com `accountStatus === 'ready'`; erro de carga explícito |
| A5 — acessibilidade dos estados novos | ptbr | `role="dialog"`, `aria-*`, foco no botão, `role="status"`/`aria-live`, `role="alert"`, nome do spinner |
| Webhook sem limite de corpo | firebase-prod | 413 acima de 1 MiB antes do HMAC (`MAX_WEBHOOK_BODY_BYTES`) |
| B2 — falha do webhook sem código estável; logs de decisão dentro da transação | observability | `webhookFailureCode` (`lease_contention`, `subscription_cap_exceeded`, `stripe_api_error`, `concurrent_update`, `internal`), `outcome`, `durationMs`; `deferTransactionLogs` emite só a tentativa que comitou |
| B3 — débito de IA sem correlação | observability | `ai.credit_consumed` com `creditDebitId` (id do recibo; chave sem "receipt" por causa do sanitizador) |
| B1 — sinais sem teste | observability | testes de log (falha, contenção, 413, `billing.config_missing`, sinal único pós-commit, correlação de IA), trilha com `stripeEventId`/`requestId`, Rules update/delete da trilha |
| B-1 — docs com `STRIPE_ALLOWED_PRICE_IDS` e plano em `users/{uid}` | billing | README e `docs/production/*` alinhados; nomes reais de eventos em OBSERVABILITY/RUNBOOKS/INCIDENT_RESPONSE; reconciliação/fila/replay reatribuídos a P7 |

Mudança visual: nenhuma de layout ou classe; só texto (mensagens para não titular, aviso de erro da conta) e atributos de acessibilidade.

**Regressão encontrada na validação (pré-existente, de teste).** O `verify:all` nº 1 falhou em 5 testes de recorrentes: `recurring.integration.test.ts` e o teste do corpo do gatilho em `schedulerHandlers.integration.test.ts` rodavam em paralelo (`node --test`) sobre a mesma varredura global (`collectionGroup("recurring_expenses")`) e o mesmo checkpoint `job_checkpoints/recurring_expenses`; cada varredura gerava lançamentos das assinaturas da outra. Produção não é afetada (`maxInstances: 1`, contrato testado). Correção: o teste do gatilho foi movido, com as mesmas asserções, para `recurring.integration.test.ts` (sequencial no arquivo), limpando o mundo antes e o próprio workspace depois. Código de produção inalterado.

**Regressão de calendário em E2E (pré-existente, de teste).** `e2e/investments-v2.spec.ts` semeava a projeção no período fixo `2026-08`; o relatório abre na janela de 30 dias (`src/components/ReportsView.tsx:40`) e, a partir de outubro de 2026, o mês saía da série e "Evolução patrimonial" não aparecia. A seed passou a usar o mês corrente de `America/Sao_Paulo`; asserções inalteradas (8/8 no spec isolado).

**Ambiente (impedimentos comprovados, sem mudança no repositório).**
- O `firebase-tools` 15.32.1 envia toda requisição do cliente `apiv2` pelo `HTTPS_PROXY` e ignora `NO_PROXY` (`lib/apiv2.js:56-60,242-244`); o proxy do container responde `403 request blocked` para `127.0.0.1`, e o registro do gatilho Firestore derrubava os emuladores do E2E. Contorno só do ambiente: proxy local que aplica o `NO_PROXY` (loopback direto; o resto continua no proxy do agente, com a política de egress intacta).
- Playwright 1.60 espera o Chromium 1223; o container tem o 1194 (Chromium 141). O headless shell instalado foi mapeado no caminho esperado.
- A política de egress nega `cdn.tailwindcss.com` (também `esm.sh`, `cdn.jsdelivr.net`, `unpkg.com`): o `index.html` carrega o Tailwind em runtime (PR-PLAT-03, P6). Sem CSS, 4 specs falham: `regression-smoke` ×3 ("tailwind is not defined" na página) e `workspace-pagination` (overlay `fixed inset-0` sem tamanho). Passavam no E2E 40/40 de P1 (§16.3).
- O Playwright encerra o CLI dos emuladores, mas o Java do Firestore fica órfão entre execuções; encerrado manualmente antes de cada rodada.

**Validação (Emulator `minhas-financas-local`; logs fora do repositório).**

| Execução | Resultado |
| --- | --- |
| Linha de base no HEAD `37d8780`, antes das correções | `verify:fast` verde (Functions 358, frontend 174 + 128 + 31; lint 0 erros, 1.967 avisos contra 1.971 na base `e862fa9`); integração 359/359, guarda 15/15, Rules 98/98. O "364/364" de §17.9 contava 6 testes compilados obsoletos do `callables/billing.test.ts` removido em P2A, deixados em `functions/lib` num ambiente sujo (358 + 6) |
| Direcionadas após as correções | Functions unitários 360/360; billing + IA + deriva + reconstrução 120/120 e, após o adiamento dos logs, billing + IA 114/114; Rules de billing 9/9; crons + `scaleQueries` em paralelo 26/26; cliente `test:unit:billing` 35/35; `investments-v2` 8/8 |
| `verify:all` nº 1 | `verify:fast` verde; integração 361/366 — 5 falhas da corrida de recorrentes descrita acima; E2E não executado (encadeamento) |
| `verify:all` nº 2 (código de Functions final) | typecheck 0 erros; lint 0 erros (1.967 avisos, nenhum novo); build de produção e E2E; Functions 360/360; frontend 174/174, 128/128, 35/35; integração 366/366; guarda 15/15; Rules 98/98 (goals 5, investments 7, investment-domain 19, investment-m3 7, m4 36, adjacent 5, workspaces 10, billing 9); E2E 36/41 — `investments-v2:173` (calendário, corrigido depois) e as 4 de CSS |
| `verify:all` nº 3 (estado final) | `verify:fast` idêntico ao nº 2; integração 349/366 com **17 cancelados** em `simpleMode.integration.test.ts` (investimentos, sem mudança em P2): uma chamada direta ao executor ficou pendente sem handle ativo ("Promise resolution is still pending but the event loop has already resolved"), com 104 `Transaction lock timeout` no `firestore-debug.log` da rodada; isolado, o arquivo passou 50/50. Rules e E2E não executados (encadeamento) |
| E2E final no estado definitivo (`npm run test:e2e`) | 37/41: passam `billing-bootstrap`, `workspace-membership` (troca de usuário com bootstrap retido e fixture Pro) e `investments-v2` corrigido; falham só as 4 specs dependentes do CSS de `cdn.tailwindcss.com` ("tailwind is not defined" ×3; overlay sem tamanho ×1) |

Nenhum teste `skipped`/`todo`; nenhuma referência ao projeto de produção nos logs. Sem cobertura configurada nem baseline versionado; comparação por contagem com o gate de P1 (§16.3): Functions unitários 328 → 360 (−6 do legado removido em P2A), frontend 174 → 174 + 128 + 35, integração 252 → 366, Rules 89 → 98, E2E 40 → 41.

**Falhas conhecidas de integração.** (1) Deriva: com workspace e cursor exclusivos, passou em todas as rodadas (integração inicial, `verify:all` 1–3, direcionadas). (2) Reconstrução concorrente com `isContentionAbortedError`: posição e meta passaram em todas as rodadas; o classificador de produção (`functions/src/shared/errors.ts`) não foi ampliado.

**Skills de domínio (estado final).**

| Skill | Veredito | Fundamento |
| --- | --- | --- |
| `billing-entitlement-integrity` | **FAIL** | Código e testes sem bloqueio (catálogo, checkout, portal, webhook, máquina de estados, quotas, Rules, segredos); B-1 (docs) resolvido. Único motivo: E-06 sem evidência versionada (§14 de BILLING_ENTITLEMENTS), exigida pela skill para fechar P2 |
| `multi-tenant-security-review` | PASS (escopo P2) | F1 corrigido e testado (membro após downgrade, antigo titular após transferência, admin e convidado no limite); isolamento, papel relido na transação, Rules backend-only (billing 9/9, com update/delete da trilha negados) |
| `firestore-scale-cost-review` | PASS (escopo P2) | Sem query nova sem limite, sem índice composto novo, Stripe e provedor fora de transação, TTLs versionados; testes de concorrência e paginação verdes |
| `firebase-production-readiness` | **FAIL** | Limite de corpo do webhook corrigido; segue PR-AI-02/E-00 (P0): rotação da chave Gemini sem evidência — item de milestone anterior, que a skill não deixa fora do escopo |
| `observability-incident-readiness` | PASS (escopo P2) | B1–B3 corrigidos com teste; nomes reais em OBSERVABILITY/RUNBOOKS/INCIDENT_RESPONSE; alertas, fila/replay e reconciliação periódica em P7 (PR-OBS-01, E-08) |
| `ptbr-product-ui-review` | **FAIL** | A1–A5 corrigidos; falta a evidência visual exigida (screenshots antes/depois, desktop e mobile, teclado no modal), impossível sem o Tailwind no ambiente. A6 (LOW) segue como risco: "Fazer Upgrade"/"Gerenciar assinatura" com capitalização mista, rate limit do checkout "aguarde alguns instantes" numa janela de 1 h, "Endereço de retorno inválido." sem próxima ação, "2 membros por espaço" sem dizer que o titular conta |
| `saas-commercial-readiness` | **FAIL** | C1–C3 corrigidos; seguem C4 (portal S9 de E-06) e C5 (nenhum E2E clica em "Fazer Upgrade"/"Gerenciar assinatura" com fronteira Stripe simulada) |

`financial-domain-integrity` não se aplica ao diff de P2C: nenhum cálculo, dado ou evento financeiro mudou; as alterações em testes de recorrentes e investimentos são de isolamento e de calendário, com as mesmas asserções.

**`regression-release-gate`: FAIL** (base `e862fa9`, merge-base `e862fa9`, HEAD `37d8780` + worktree). Sem skip/`only`, sem timeout novo, sem mudança em scripts, CI, Rules, índices ou `firebase.json` sobre o HEAD; asserções só acrescentadas (o teste movido mantém as 5; `ai-client` troca 6 asserções pelo contrato mais estrito); legado de billing ausente do código. Bloqueadores para PASS:
1. E2E completo verde: 4 specs dependem de `cdn.tailwindcss.com`, negado pela política de rede deste ambiente — liberar o host (ou rodar no CI/Codespaces) e reexecutar `npm run test:e2e`; impedimento ambiental comprovado não autoriza PASS. **Resolvido em P2C-H2** (Tailwind local; §17.11).
2. Integração sem cancelamentos: o travamento de `simpleMode` sob carga paralela no Emulator (pré-existente, fora de P2) precisa de causa raiz ou de estabilização da infraestrutura de teste sem mascarar falha. **Resolvido em P2C-H2** (causa raiz no `BulkWriter`; integração um arquivo por vez; §17.11).
3. E-06 (Stripe) com evidência versionada — ação externa.
4. PR-AI-02/E-00 (rotação da chave Gemini) com evidência — ação externa.
5. C5: E2E de checkout e portal com fronteira Stripe simulada (proposta: seam exclusivo de teste, fora do bundle e dos exports de produção, no padrão do `inviteTokenSeam`). **Resolvido em P2C-H2** sem seam, por interceptação de rede no navegador (`e2e/billing-checkout-portal.spec.ts`; §17.11).
6. Evidência visual pt-BR (screenshots desktop/mobile e teclado), com o CSS disponível. **Resolvido em P2C-H2** (`docs/production/evidence/p2c-h2/`; §17.11).

**Estado:** P2 permanece em andamento. Implementação técnica de P2 sem bloqueio conhecido no código; fechamento depende dos itens acima. **E-06 — EXTERNAL CONFIGURATION REQUIRED.** Nada é declarado pronto para cobrança real, comercialização ou produção.

**Riscos residuais:** logs de decisão do webhook só saem depois do commit (falha da transação é registrada pela entrega, sem os detalhes da tentativa); falha do provedor de IA depois do commit consome o crédito (política de P2B.2); `ai_usage` sem TTL (P8); sem App Check (P6); `functions:test:unit` roda sobre `lib/` sem limpar (risco de evidência em ambiente sujo; **resolvido em P2C-H2**, §17.11: o build das Functions limpa `lib/`); A6 (LOW).

**Rollback:** reverter o diff de P2C devolve as mensagens únicas de quota (com `used` para qualquer ator), o webhook sem limite de corpo e sem `errorCode`, os logs dentro da transação e o teste do gatilho em `schedulerHandlers`; nenhum dado ou schema muda. Nada foi implantado.

### 17.11 P2C-H2 — estabilização técnica, E2E de billing e evidência visual (2026-10-02)

Sobre o HEAD `37d8780` (= `origin/main`) + working tree da P2C, branch `ccr-d6cb80b8-paxbt2`, no mesmo container (Node 22.22, Java 21, firebase-tools 15.32.1, Firestore Emulator 1.22.0, Playwright 1.60). Nada foi implantado, commitado ou enviado; Firebase só no Emulator `minhas-financas-local`; Stripe e provedor de IA falsos; dados só sintéticos. P3 não foi iniciado. Objetivo: remover os bloqueadores técnicos 1, 2, 5 e 6 do gate da P2C (§17.10) sem tocar nos externos (3 e 4).

**H2-1 — Tailwind local (antecipa a parte de CSS de PR-PLAT-03; executa D-20).**
- `tailwind.config.js` e `postcss.config.js` novos; `tailwindcss` 3.4.19, `postcss` 8.5.28 e `autoprefixer` 10.6.1 em `devDependencies` (lockfile: 64 pacotes novos, só de build; atualizações de patch em `browserslist`, `caniuse-lite`, `postcss` e `nanoid`).
- O tema é o mesmo do `tailwind.config` global que o `index.html` declarava para o Play CDN, transferido sem mudança: `darkMode: 'class'`, Poppins, cores semânticas nas variáveis CSS, legado `dark-*`, raio `card`. Varredura de classes: nenhuma classe montada por interpolação nem vinda de dados, então sem safelist.
- `index.html`: saem o script `cdn.tailwindcss.com`, o `tailwind.config` em runtime e o importmap `esm.sh`; `lang="pt-BR"`. O importmap não tinha consumidor: o build do Vite não declara `external`, empacota todos os módulos, e a aplicação roda inteira no E2E com `esm.sh` negado pela política de rede. Ficam as fontes do Google Fonts e o `<style>` inline das variáveis do tema.
- `src/index.css` (já no HEAD, importado por `src/main.tsx`) passa a ser processado. Antes as diretivas chegavam cruas ao navegador e eram ignoradas; agora `body` recebe `bg-background text-on-surface`, as mesmas cores do contêiner raiz (`src/App.tsx:555`).
- Efeito: as 4 specs que falhavam por "tailwind is not defined"/overlay sem tamanho (`regression-smoke` ×3, `workspace-pagination`) passam sem o host liberado.
- **Paridade visual:**
  - O CDN real não carrega neste ambiente (host negado), e o `dist` anterior não tinha CSS próprio.
  - O "antes" foi emulado como o Play CDN faz: o CSS do Tailwind 3.4 é gerado a partir das classes presentes no DOM vivo, com a mesma configuração e sem processar o `src/index.css`, e trocado pelo CSS do build na mesma página e no mesmo estado. As duas capturas são comparadas pixel a pixel, depois de dois quadros iguais seguidos (a pizza do Recharts anima em JavaScript).
  - Resultado: 46 telas, **0 pixel diferente**, nenhuma classe do DOM ausente do build (`paridade-cdn-emulado.json`).
  - Não há empate de especificidade que dependa da ordem das folhas de estilo: a classe `.card` do `<style>` inline só aparece em `SummaryCard.tsx:50`, sem utilitário em conflito.
  - Resta só a versão exata do Tailwind embutida no CDN (mesma linha 3.4): risco R-04, residual.

**H2-2 — E2E de checkout e portal (C5).** `e2e/billing-checkout-portal.spec.ts`, 4 testes. Auth, `bootstrapAccount`, catálogo, listener do documento canônico e Rules são reais; só a fronteira do provedor é simulada, por interceptação de rede no navegador no formato do protocolo de callable, com destinos falsos (`checkout.stripe.test`, `billing.stripe.test`). Nenhum seam no bundle nem nos exports de produção; contrato do backend inalterado; as suítes com Stripe falso no backend continuam separadas (`functions/src/billing/__tests__`).
- Conta Free: nome da callable; payload só com `planId`, `returnUrl` e `idempotencyKey` nova por tentativa, nunca Price ID; 429 da plataforma ⇒ mensagem genérica pt-BR; recusa do backend ⇒ mensagem do backend; resposta retida ⇒ botões travados e spinner "Carregando"; sucesso ⇒ redirecionamento.
- Assinante: "Gerenciar assinatura" chama só o portal com `{returnUrl}`; erro do backend exibido; depois redireciona; nenhuma chamada de checkout.
- Conta sem estado confiável: conta suspensa, leitura negada pelas Rules ⇒ alerta, contratação e gestão desabilitadas, cliques forçados sem chamada.
- Callable real sem Stripe configurado: falha fechada, "Cobrança indisponível no momento. Tente novamente mais tarde.", sem redirecionamento, plano segue Free.
- **Limite documentado:** o carregamento antes do primeiro snapshot não é isolável em E2E, porque reter o canal de escuta do Firestore bloqueia a aplicação inteira (o WebChannel serializa as requisições). Esse estado fica no guarda unitário de `tests/unit/billing-client.test.ts`.

**H2-3 — travamento de `simpleMode` sob carga (bloqueador 2 da P2C): causa raiz e correção.**
- **Causa:** defeito do `BulkWriter` do SDK `@google-cloud/firestore` 7.11.6. No modo `flush`, uma operação reenfileirada depois de `ABORTED` nunca é reenviada. O `recursiveDelete` da limpeza dos testes fica pendente sem handle ativo, e o `node --test` cancela o arquivo ("Promise resolution is still pending but the event loop has already resolved").
- **Gatilho:** contenção de lock entre arquivos de integração rodando em paralelo no mesmo Emulator. O `node --test` usa por padrão `availableParallelism − 1` (3 aqui). Diagnóstico com log interno do SDK por processo, fora do repositório.
- **Evidência (subconjunto pesado: `simpleMode` + suítes de investimentos):**

| Rodada | Resultado | `Transaction lock timeout` | Duração |
| --- | --- | --- | --- |
| `simpleMode` isolado | 50/50 | 1 | — |
| concorrência 1 | 173/173 | 53 | 140 s |
| concorrência 2 | 44 cancelados | 54 | 86 s |
| concorrência 3 | 173/173 | 74 | 100 s |
| concorrência 8 | 4 falhas + 28 cancelados | 151 | 105 s |
| concorrência 8, instrumentada | 2 falhas + 41 cancelados | 121 | — |

- **Correção:** `test:integration` das Functions roda um arquivo por vez no Emulator único (`--test-concurrency=1`). O contrato de deploy (`functions/src/shared/deploymentContract.test.ts`) prende a flag. Nenhum retry, timeout ou skip; código de produção inalterado. Integração oficial com a correção: 366/366, guarda 15/15, Rules 98/98, 0 cancelados, 327 s, com 85 lock timeouts no log absorvidos pelas transações.
- **Risco residual:** os jobs de exclusão de P8 não podem depender da repetição do `BulkWriter`. Registrado em §17.4.

**H2-4 — testes compilados obsoletos em `functions/lib` (risco residual da P2C).**
- `build` das Functions passa a `npm run clean && tsc`: `clean` apaga só `lib/`.
- `typecheck` próprio (`tsc --noEmit`), que não apaga `lib`; o `typecheck` da raiz passa a chamá-lo.
- `test:unit` e `test:integration` continuam começando por `npm run build`.
- Prova: um `.test.js` fantasma em `lib/` levava `functions:test:unit` a 361; com o build limpo, 360. Dois testes de contrato novos prendem os scripts.

**H2-5 — evidência visual (dados sintéticos; `docs/production/evidence/p2c-h2/`).**
Captura por Playwright contra o build E2E e o Emulator: desktop 1440×900 e mobile 390×844, esquema claro e escuro do sistema (o tema segue `prefers-color-scheme` quando não há tema salvo), locale pt-BR. O script de captura ficou fora do repositório; o repositório guarda só o resultado.

| Arquivo | Conteúdo |
| --- | --- |
| `01-planos-free-{desktop,mobile}-{claro,escuro}.png` | Tabela de planos da conta Free: "Plano Atual" e "Fazer Upgrade" |
| `02-planos-erro-desktop-claro.png`, `02-planos-erro-mobile-escuro.png` | Falha da plataforma (429) no upgrade: alerta "Não foi possível iniciar o pagamento. Tente novamente." |
| `03-planos-carregando-desktop-claro.png` | Checkout em andamento: botões pagos travados com spinner "Carregando" |
| `04-planos-foco-teclado-desktop-claro.png` | Navegação por Tab até "Fazer Upgrade", com anel de foco visível |
| `05-planos-assinante-desktop-claro.png`, `05-planos-assinante-mobile-escuro.png` | Assinante Pro: "Plano Gratuito" e "Gerenciar assinatura" |
| `06-modal-confirmado-desktop-claro.png`, `06-modal-confirmado-mobile-escuro.png` | Retorno `?billing=success` com o plano confirmado pelo servidor: modal "Pagamento confirmado!" com foco inicial em "Começar a usar"; Enter fecha |
| `07-transacoes-{desktop-claro,desktop-escuro,mobile-claro}.png` | Tabela financeira (Despesas e Parcelamentos) com lançamentos sintéticos "(exemplo)" |
| `08-modal-nova-transacao-desktop-{claro,escuro}.png` | Modal "Nova Transação" (tema compartilhado) |
| `09-menu-mobile-aberto-mobile-{claro,escuro}.png` | Menu lateral no mobile depois de navegar (achados V-02 e V-03 abaixo) |
| `contrast.json` | Razões de contraste medidas na página |
| `paridade-cdn-emulado.json` | Paridade antes (CDN emulado) × depois (build) em 46 telas |
| `axe.json` | Violações do axe-core 4.13 (WCAG 2.0/2.1 A e AA) por tela |

- **Contraste (WCAG 2.1, texto normal ≥ 4,5:1):** todas as medições passam. Título 16,98 (claro) e 17,74 (escuro); preço 17,74 e 14,68; "Fazer Upgrade" 6,29; item de limite 4,83 e 5,78. O botão desabilitado ("Plano Atual"/"Plano Gratuito") fica fora do critério, que isenta componentes inativos.
- **Teclado:** o Tab alcança "Fazer Upgrade" com foco visível; o modal de confirmação recebe o foco no botão e fecha com Enter.
- **Tema escuro:** aplicado em tabela de planos, alerta, modal, tabela financeira e formulário; sem texto ilegível.
- **Responsividade:** cards, filtros e formulário empilham no mobile; sem rolagem horizontal da página.
- **Problemas induzidos pelo CSS:** nenhum. Nenhuma correção de CSS foi necessária.
- **Limites da evidência:**
  - Não há screenshot anterior de referência, porque o CDN é negado neste ambiente (ver H2-1).
  - A fonte Poppins não carrega no navegador do container (Google Fonts responde `ERR_EMPTY_RESPONSE`), e as imagens usam o fallback `sans-serif`.
  - O campo de data nativo mostra `mm/dd/yyyy`: o formato vem do ICU do headless shell, não da aplicação.
  - O vencimento "03/10/2026" vem da seed (dia UTC); não é defeito do produto.

**Achados pré-existentes (não induzidos pelo CSS; registrados, não corrigidos, por regra de UI inalterada).**
| ID | Sev. | Achado | Causa | Destino |
| --- | --- | --- | --- | --- |
| V-01 | MEDIUM | Ícones do pacote lucide renderizam sem traço (invisíveis) no menu, no Header e nos filtros | `AppIcon` passa `stroke={undefined}` quando o pacote não é Tabler (`src/components/Icons.tsx:268`). O `...rest` do lucide-react 0.263.1 sobrescreve o `stroke: currentColor` padrão. Não depende do CSS: o atributo some do SVG, e o `Loader2` importado direto aparece normalmente. Correção proposta: só passar `stroke` para o Tabler | **Corrigido em UX-H1 (§17.12).** Origem do registro: Correção de UI fora do escopo de P2C-H2 ("UI inalterada"); próxima etapa com mudança visual autorizada (P5/UX) |
| V-02 | LOW | No mobile, navegar pelo menu não o fecha; ele cobre o conteúdo até o usuário tocar no botão de novo | `handleNavigate` não altera `isSidebarExpanded` (`src/App.tsx:244-248`) | **Corrigido em UX-H1 (§17.12).** Origem do registro: Idem |
| V-03 | MEDIUM | Com o menu mobile aberto, o título e os botões do Header aparecem por cima dele e interceptam o toque nos primeiros itens: "Dashboard" não é clicável pelo menu no mobile (Playwright: o Header "intercepts pointer events") | Header `relative z-30` e menu `fixed z-30`: com o mesmo z-index, vence a ordem no DOM (`src/components/Header.tsx:157`, `src/components/Sidebar.tsx:113`) | **Corrigido em UX-H1 (§17.12).** Origem do registro: Idem |
| V-05 | HIGH | Três botões de ícone do Header (notificações, mensagens e alternância de tema, `src/components/Header.tsx:115,236,279`) sem nome acessível: axe `button-name`, crítico, na tela de planos | Botão só com ícone, sem `aria-label` nem texto; com V-01, o ícone também não aparece | **Corrigido em UX-H1 (§17.12).** Origem do registro: Funil WCAG AA: COMM-06, LAUNCH_CHECKLIST 8.9 (P9). O `aria-label` não muda nada visualmente e pode ser antecipado com autorização |
| V-06 | MEDIUM | Contraste abaixo de 4,5:1: alerta de erro da tabela de planos no claro (`text-red-600` sobre `bg-red-50`, 4,41:1); no escuro, "/mês" (`text-gray-500` sem variante escura), título "Minhas Finanças" e "Hoje" (`text-primary`) | Classes anteriores a P2: a P2C só acrescentou `role="alert"` ao mesmo elemento | **Corrigido em UX-H1 (§17.12).** Origem do registro: COMM-06, LAUNCH_CHECKLIST 8.9 (P9); exige mudança visual autorizada |
| V-04 | LOW | No checkout em andamento, os dois botões pagos mostram spinner, não só o clicado; o plano pago atual do assinante não tem marcação própria (os dois cards pagos mostram "Gerenciar assinatura") | `isLoading` único em `PricingTable` (`src/modules/billing/components/PricingTable.tsx:98-107`); desenho de P2A | **Corrigido em UX-H1 (§17.12).** Origem do registro: Junta-se a A6 (§17.10), P9 |

**Regressão de teste encontrada na validação (pré-existente, de horário).** `tests/unit/investment-reporting.test.ts` montava as chaves de dia em UTC, mas o recorte do produto usa `America/Sao_Paulo` (INV-P2-048). Entre 21:00 e 23:59 de Brasília, o dia "excluído" da janela de 7 dias caía dentro dela (falhou às 21:04 BRT: 300 ≠ 200). Os dois testes de janela passaram a usar `shiftSaoPauloDays`, com as mesmas asserções; 174/174 no mesmo horário.

**Validação (Emulator `minhas-financas-local`; logs fora do repositório).**
Ordem pedida: direcionadas → typecheck/lint/build → integração e Rules → E2E direcionado → `verify:all`. O Java do Firestore que o Playwright deixa órfão foi encerrado entre rodadas, só o desta tarefa. Nenhum teste `skipped`, `todo` ou cancelado; nenhuma referência ao projeto de produção.

| Etapa | Resultado |
| --- | --- |
| Direcionadas | `test:unit:billing` 35/35; `test:unit:p1` 128/128; `test:unit:investments` 174/174 depois da correção de horário (antes 173/174, falha descrita acima); typecheck 0 erros; spec de checkout e portal 4/4; `regression-smoke` e `workspace-pagination` sem CDN |
| `verify:fast` (109 s) | typecheck da raiz e das Functions 0 erros; lint das Functions 0 erros e 1.967 avisos (igual à P2C, nenhum novo); build de produção (CSS 86,6 kB, 13,2 kB gzip; só os avisos antigos de chunk); build das Functions; Functions 362/362 (360 + 2 de contrato); frontend 174/174, 128/128, 35/35 |
| `test:integration:emulator` (330 s) | integração 366/366 com concorrência 1, 0 cancelados; guarda 15/15; Rules 98/98 (goals 5, investments 7, investment-domain 19, investment-m3 7, m4 36, adjacent 5, workspaces 10, billing 9) |
| E2E direcionado (63 s) | 9/9: `billing-checkout-portal` 4, `regression-smoke` 3, `workspace-pagination` 1, `billing-bootstrap` 1 |
| **`npm run verify:all`** (640 s, exit 0) | `verify:fast` idêntico; integração 366/366, guarda 15/15, Rules 98/98; **E2E 45/45** (41 da P2C + 4 novos), inclusive as 4 specs que dependiam do CDN |
| Evidência visual e acessibilidade | 19 capturas e `contrast.json` (H2-5); paridade antes/depois com o CDN emulado em 46 telas (desktop claro/escuro, mobile; painel, listas, modais, todas as seções do menu, planos, erro, assinante, confirmação): 0 pixel diferente e nenhuma classe do DOM ausente do build (`paridade-cdn-emulado.json`); axe-core 4.13 (WCAG 2.0/2.1 A e AA): região da tabela de planos Free e assinante (claro) e modal de confirmação sem violação; erro no claro e planos no escuro só com contraste pré-existente (V-06); página inteira com os botões do Header sem nome (V-05); `lang="pt-BR"` confirmado |
| `npm audit` (raiz) | 9 achados, todos com a mesma versão na base; nenhum introduzido pela P2C-H2 |

Comparação com a P2C (§17.10): Functions unitários 360 → 362; integração 366 (cancelados 17 → 0); E2E 37/41 → 45/45; demais contagens iguais.

**Skills de domínio (estado final; só as superfícies tocadas pela P2C-H2).** `multi-tenant-security-review`, `firestore-scale-cost-review` e `observability-incident-readiness` não foram reexecutadas: a P2C-H2 não muda Rules, callables, autorização, queries, índices, listeners, logs nem alertas. Ficam os vereditos da P2C (§17.10).

| Skill | Veredito | Fundamento |
| --- | --- | --- |
| `ptbr-product-ui-review` | PASS (escopo P2C-H2 e estados introduzidos em P2) | Nenhuma mudança de layout, classe ou texto na P2C-H2. Paridade antes/depois com o "antes" emulado (CSS do Tailwind 3.4 gerado das classes do DOM vivo, como o Play CDN fazia, trocado pelo CSS do build na mesma página): 46 telas em desktop claro/escuro e mobile, **0 pixel diferente**, nenhuma classe do DOM ausente do build (`paridade-cdn-emulado.json`). Sem empate de especificidade dependente da ordem (`.card` só em `SummaryCard.tsx:50`, sem utilitário em conflito). Estados de P2 verificados nas capturas: carregamento, erro, sucesso, foco inicial e Enter no modal, Tab até o upgrade com foco visível, contraste AA nos textos da tabela, pt-BR e responsividade. Achados pré-existentes registrados com destino: V-01…V-04 (UX, P5/P9) e V-05/V-06 (WCAG do funil, COMM-06, P9). Nenhum foi introduzido em P2 nem na P2C-H2. A regra de UI inalterada e a ordem de corrigir só o que o CSS causou impedem a correção nesta etapa |
| `saas-commercial-readiness` | **FAIL** (só itens externos e de P9) | C5 resolvido (E2E de checkout e portal); C1–C3 seguem corrigidos; `lang="pt-BR"`; contraste, teclado e axe nas telas de contratação: axe 4.13 sem violação na região dos planos (Free e assinante) nem no modal; os pré-existentes V-05 e V-06 (botões do Header sem nome; contraste do alerta e do tema escuro) pertencem a COMM-06 / LAUNCH_CHECKLIST 8.9 (P9). Segue C4: configuração do Customer Portal (S9 de E-06), externa. Landing, preços públicos, páginas legais, footer, suporte e SEO são P9 (PR-COMM-*) e ficam fora do escopo |
| `billing-entitlement-integrity` | **FAIL** (só E-06) | Sem achado no código e nos testes: catálogo, checkout, portal, webhook, máquina de estados, quotas, Rules e segredos (integração 366/366, Rules de billing 9/9, cliente 35/35), e agora a interface (E2E 4/4). Backend de billing inalterado na P2C-H2. Único motivo: E-06 sem evidência versionada, exigida pela skill para fechar P2 |
| `firebase-production-readiness` | **FAIL** (só PR-AI-02/E-00) | Na P2C-H2: o `index.html` não tem mais script de terceiro em runtime; build das Functions com `lib/` limpo; integração determinística (um arquivo por vez); nenhum segredo nem referência ao projeto de produção no diff; `firebase.json`, runtime e exports inalterados. `npm audit` da raiz: 9 achados (2 críticos, 5 altos), todos com a mesma versão na base. O `picomatch` 2.3.2 novo (via Tailwind) fica fora da faixa afetada (4.0.0–4.0.3), então nenhum foi introduzido. Segue PR-AI-02/E-00 (rotação da chave Gemini, ação externa de P0) |
| `privacy-lgpd-data-lifecycle` | PASS (escopo P2C-H2) | Dois terceiros saíram do navegador (Tailwind Play CDN, `esm.sh`). Código e bundle só referenciam Google Fonts e Mixkit, que são as linhas 10 e 12 de SUBPROCESSORS, atualizado com a §7 de remoções. Nenhuma coleta nova. REQ-FUT-01 está só documentado, com privacidade da renda definida. Bases legais, aceite, direitos, retenção e validação jurídica são P8 (fora do escopo) |
| `financial-domain-integrity` | PASS (escopo P2C-H2) | Só teste: as janelas de 7 e 30 dias de `tests/unit/investment-reporting.test.ts` deixam `toISOString().slice(0, 10)` (padrão que o checklist reprova) e usam a função única de dia de `America/Sao_Paulo`, com as mesmas asserções. Nenhum cálculo, dado, evento ou escrita financeira mudou (`src/modules/reports/investments.ts` e `dateWindow.ts` inalterados); 174/174 no horário que falhava. REQ-FUT-01 mantém o dinheiro como fonte de verdade |

**`regression-release-gate` — avaliado em duas partes, como pedido.**

*A — conclusão técnica de P2* (código, testes, Emulator, E2E e evidência visual; os itens externos ficam em B por instrução do usuário): **PASS**.
- Escopo Git: base `e862fa9` (= merge-base), HEAD `37d8780` + working tree (54 arquivos rastreados modificados e 1 removido — o patch avulso da P2C, único staged —, 26 não rastreados: 22 de evidência e 4 de código).
- Proibições: sem skip/`only`/`fixme`; nenhum timeout aumentado em teste existente (os do spec novo seguem `billing-bootstrap`); nenhum retry; asserções só acrescentadas ou mantidas; Rules, índices, `firebase.json` e CI inalterados; nenhuma referência ao projeto de produção.
- Execução: ver tabela de validação acima.
- Superfícies inesperadas: UI sem mudança de layout, classe ou texto na P2C-H2 (provado pela paridade de 46 telas com 0 pixel diferente); contratos de backend inalterados.
- Os achados V-01…V-06 são pré-existentes, documentados e com destino. Não bloqueiam A: nenhum foi introduzido em P2 nem na P2C-H2, a regra de UI inalterada impede corrigi-los aqui, e V-05/V-06 pertencem ao WCAG do funil (COMM-06, P9).

*B — prontidão comercial e de produção:* **FAIL**.
- E-06 — EXTERNAL CONFIGURATION REQUIRED: Prices, endpoint, eventos, Customer Portal e versão da API conferidos no Stripe, com registro em BILLING_ENTITLEMENTS §14.
- PR-AI-02/E-00: rotação da chave Gemini, pendente.
- C4: configuração do portal (parte de E-06).
- Superfície pública e legal de P9; ambientes, App Check, headers e CD de P6; observabilidade operacional de P7; LGPD de P8.
- Nada está pronto para cobrança real, comercialização ou produção.

**Estado de P2:**
- Tecnicamente concluída; o fechamento formal depende de E-06 e PR-AI-02/E-00 (ações externas).
- P3 não foi iniciado e só começa por pedido explícito.
- Recomendação: P3 pode ser iniciado em paralelo à pendência externa, porque não depende de E-06. E-06 e PR-AI-02 seguem rastreados como bloqueadores de release (§11).

**Riscos residuais:**
- R-04 residual: o "antes" emulado deu 0 pixel diferente, mas a versão exata do Tailwind embutida no CDN real não foi exercida.
- `BulkWriter` sem reenvio após `ABORTED`: os jobs de P8 não podem depender dele.
- V-01…V-06: achados pré-existentes de UX e acessibilidade.
- `npm audit` da raiz: 9 achados pré-existentes (2 críticos e 5 altos, em dependências transitivas de Firebase/gRPC/protobuf e de build: `vite`, `rollup`, `picomatch` 4); revisão de dependências em P6.
- A fonte Poppins depende do Google Fonts (PR-PLAT-03).
- O carregamento antes do primeiro snapshot de billing só tem cobertura unitária.

**Rollback:** reverter o diff da P2C-H2. Isso devolve:
- o Play CDN e o importmap no `index.html`, sem as dependências de build e sem `tailwind.config.js`/`postcss.config.js`;
- a integração paralela e o build sem `clean`;
- o spec de E2E removido;
- os testes de janela em UTC.

Nenhum dado, schema, Rule, índice ou contrato muda. Nada foi implantado.

### 17.12 UX-H1 — correções de interface, navegação e acessibilidade (2026-10-03)

Sobre o HEAD `37d8780` + working tree da P2C-H2 (§17.11), na mesma branch. Corrige os achados V-01…V-06 registrados na P2C-H2. Só frontend: nenhum contrato, Rule, índice, callable, dado monetário, entitlement ou backend mudou. Nada foi implantado, commitado ou enviado; Firebase só no Emulator `minhas-financas-local`; dados sintéticos. P3 não foi iniciado.

| Achado | Correção | Evidência |
| --- | --- | --- |
| V-01 — ícones lucide invisíveis | O `AppIcon` passa a cada pacote só a propriedade que ele entende: `stroke` (espessura) só ao Tabler, `weight` só ao Phosphor, nada disso ao Lucide (`src/components/iconPackProps.ts`, usado em `src/components/Icons.tsx`). Carregamento dinâmico, fallback, `DynamicIcon`, espessura e cores do tema inalterados | Unitário com os componentes reais dos três pacotes (`tests/unit/icon-pack-props.test.ts`, 5); E2E da pintura real dos SVGs (traço ou preenchimento com cor e área) no menu, no Header e nos cards, nos pacotes Lucide, Tabler e Phosphor |
| V-02 — menu mobile não fechava ao navegar | No mobile, escolher uma seção fecha o menu; tocar fora (backdrop transparente) e Esc também fecham. Pelo teclado, o foco entra no primeiro item ao abrir e volta ao botão de menu com Esc. No desktop o hover continua mandando (compacto × expandido) (`src/components/Sidebar.tsx`) | E2E: abre, navega, fecha; toque fora e Esc sem trocar a tela; foco em "Dashboard" ao abrir pelo teclado, Tab segue no menu, Esc devolve o foco; desktop compacto, expande no hover e não fecha ao navegar |
| V-03 — Header sobre o menu aberto | No mobile, menu `z-50` e backdrop `z-40` acima do Header (`z-30`); no desktop, `lg:z-30` como antes. Fechado, o menu fica `max-lg:invisible`: não recebe clique nem foco (a transição de 300 ms segue) | E2E: o ponto central de "Dashboard" pertence ao menu e o clique é real, sem `force`; com o menu fechado, o conteúdo recebe cliques |
| V-05 — botões do Header sem nome | `aria-label` em pt-BR: "Notificações"/"Mensagens" (com "N não lida(s)"), "Ativar modo escuro"/"Ativar modo claro", "Abrir menu"/"Fechar menu" (com `aria-expanded` e `aria-controls`); avatar da conta como botão de teclado ("Abrir/Fechar menu da conta", `aria-expanded`, Enter/Espaço); `type="button"`; menu lateral como "Menu principal". Nenhuma mudança visual | E2E: nomes, `aria-expanded`, alternância de tema e menu da conta pelo teclado; nenhum botão visível do Header sem nome; axe sem `button-name` |
| V-06 — contraste | Alerta de erro da tabela de planos: `text-red-700` (4,41 → 5,91:1). "/mês" no escuro: `dark:text-gray-400` (5,78:1). Título, "Hoje", marca e item ativo do menu: no escuro, `dark:text-primary-on-dark`, um tom mais claro da própria cor do espaço (`color-mix` com branco, token novo em `tailwind.config.js`), porque a cor primária vem do espaço (`WorkspaceContext.tsx:94`) e não muda com o modo | Medição axe com cor e fundo em 5 temas (padrão claro/escuro, Midnight, Emerald, Sunrise) × Free/assinante: 0 falhas (`contraste-temas.json`); "Hoje" no escuro 2,99 → 6,73:1, título 2,99 → 6,73:1 |
| V-04 — feedback da tabela de planos | Carregamento só no botão acionado; os demais pagos seguem bloqueados durante a requisição, com o bloqueio visível (`disabled:opacity-60`, `cursor-not-allowed`, só nos botões pagos), e o hook ignora uma segunda ação em andamento (trava síncrona). O plano pago em vigor, lido do entitlement exibido do documento canônico, ganha borda, selo "Plano atual" e `aria-current` (`src/modules/billing/pricingTableState.ts`, `PricingTable.tsx`, `hooks.ts`). Contratos de Checkout e Portal inalterados | Unitário com 8 estados (`pricing-table-state.test.ts`: acionado, bloqueio, Free, ativo, carência, carência vencida, carregando, erro); E2E: clique duplo gera um pedido, carregamento só no acionado (checkout e portal), botão bloqueado com opacidade 0,6, Pro destacado e Business não |

**Testes provados contra o defeito:** com o comportamento antigo reintroduzido temporariamente (`stroke: undefined` no Lucide, menu `z-30`, sem fechar ao navegar), o E2E falhou nos testes do Lucide ("sem traço nem preenchimento") e da navegação mobile (clique interceptado). Restaurado, passou.

**Validação (Emulator `minhas-financas-local`; logs fora do repositório).** Mudança só de frontend: integração das Functions (366) e Rules (98) não foram repetidas, porque nenhum backend, contrato, Rule ou dependência mudou.

| Etapa | Resultado |
| --- | --- |
| Unitários direcionados | `test:unit:ui` 5/5 (novo); `test:unit:billing` 43/43 (35 + 8 de `pricing-table-state`) |
| `npm run verify:fast` (estado final) | typecheck da raiz e das Functions 0 erros; lint das Functions 0 erros e 1.967 avisos (iguais); build de produção (só os avisos antigos de chunk); build e unitários das Functions 362/362; frontend 174/174, 128/128, 43/43 e 5/5 |
| E2E direcionado | `ux-navigation-a11y` 7/7 (novo); `billing-checkout-portal` 4/4 com as asserções novas |
| **`npm run test:e2e` completo** (estado final) | **52/52** (45 anteriores + 7 novos), 0 skip |
| Mutação | Com o comportamento antigo reintroduzido, o E2E falhou nos testes de Lucide e de navegação mobile; restaurado, passou |

**Regressão de teste encontrada (pré-existente, de localizador).**
- No primeiro E2E completo, `investments-simple:295` e `investments-v2:169` falharam com `strict mode violation`.
- Causa: `getByRole('heading', { name: 'Investimentos' })` casa por substring com "Distribuição dos investimentos". O título da tela só resolve sozinho quando o painel de alocação ainda não renderizou, e isso depende de os dados já estarem em cache pelo painel.
- Isolados, os dois specs passaram 17/17; a UX-H1 não toca Investimentos.
- Correção: as 9 ocorrências, em 5 specs, passaram a usar `exact: true`, um alvo mais preciso, com a mesma asserção e sem timeout novo. O E2E completo seguinte passou 52/52.

**Acessibilidade (axe-core 4.13, WCAG 2.0/2.1 A e AA; `docs/production/evidence/ux-h1/axe.json`).**
- Tela de planos, comparada com `docs/production/evidence/p2c-h2/axe.json`:

| Tela de planos | P2C-H2 | UX-H1 |
| --- | --- | --- |
| Página (claro) | `button-name` ×3 (crítico) | sem violações |
| Página (escuro) | `button-name` ×3, `color-contrast` ×5 | sem violações |
| Região, escuro | `color-contrast` ×3 ("/mês") | sem violações |
| Erro (claro) | `color-contrast` ×1 (alerta 4,41:1) | sem violações |
| Mobile (claro/escuro) e assinante (claro/escuro/mobile) | — | sem violações |

- O painel, auditado pela primeira vez na UX-H1, tem achados pré-existentes fora dos componentes tocados (V-07…V-09, em riscos).
- Contraste medido em 5 temas × 2 estados: 0 falhas (`contraste-temas.json`).

**Evidência visual** (`docs/production/evidence/ux-h1/`, separada das capturas da P2C-H2):

| Arquivo | O que mostra |
| --- | --- |
| `01-painel-icones-desktop-{claro,escuro}.png` | Ícones visíveis no menu, no Header e nos cards |
| `02-menu-desktop-expandido-{claro,escuro}.png` | Menu expandido no hover, com o item ativo legível no escuro |
| `03-planos-free-desktop-{claro,escuro}.png` | Tabela de planos da conta Free |
| `04-planos-erro-desktop-claro.png` | Alerta de erro com 5,91:1 |
| `05-planos-carregando-so-no-acionado-desktop-claro.png` | Carregamento só no botão acionado e bloqueio visível dos botões pagos |
| `06-menu-mobile-aberto-{claro,escuro}.png` | Menu mobile acima do Header |
| `07-menu-mobile-fechado-apos-navegar-{claro,escuro}.png` | Menu fechado depois de navegar |
| `08-planos-assinante-{desktop-claro,desktop-escuro,mobile-escuro}.png` | Plano atual destacado |
| `09-transacoes-desktop-{claro,escuro}.png` | Tabela financeira com os ícones dos filtros |

**Revisão de UI (`ptbr-product-ui-review`, limitada ao diff da UX-H1):** executada uma vez, sobre o diff da UX-H1, o conteúdo renderizado (capturas em `docs/production/evidence/ux-h1/`), o axe e os E2E.
- Todas as mudanças visuais são as pedidas (V-01…V-06). Nenhum redesign, mudança de layout ou reorganização de navegação.
- Textos novos em pt-BR, com concordância ("1 não lida", "2 não lidas"), e nenhum detalhe interno exposto.
- A revisão achou dois problemas no estado revisado:
  1. Teclado no mobile: com o menu aberto, Tab ia para o conteúdo atrás do backdrop, porque o menu vem antes do `main` no DOM.
  2. O botão pago bloqueado durante a requisição parecia clicável.
- Os dois foram corrigidos (foco entra no primeiro item ao abrir e volta ao botão de menu com Esc; `disabled:opacity-60 disabled:cursor-not-allowed` só nos botões pagos) e cobertos por E2E.
- **Veredito sobre o estado final: PASS — revisão de UI de produto em PT-BR.**

**Riscos residuais:**
- Achados novos fora do escopo (telas não tocadas, registrados como V-07…V-10 em COMM-06 / LAUNCH_CHECKLIST 8.9, P9):
  - V-07: contraste no painel ("Mensal" dos cards, rótulos de 10 px do Diagnóstico, chips de categoria em Recentes);
  - V-08: `<select>` de filtro de "Transações Recentes" sem nome acessível (axe crítico);
  - V-09: setores do gráfico Recharts sem texto alternativo;
  - V-10: ícone de "Empréstimos" mostra o desenho tracejado de recurso, porque o nome mapeado não existe no Lucide 0.263 nem no Tabler 3.2.
- O menu mobile não prende o foco: depois de "Sair", o Tab segue para o conteúdo. É aceitável num menu não modal; o Esc devolve o foco ao botão.
- `primary-on-dark` usa `color-mix` (Chrome 111+, Safari 16.2+, Firefox 113+). Em navegador antigo, a regra é ignorada e volta o `text-primary`, com o contraste anterior.
- A6 segue em P9: "Plano atual" (selo novo, caixa de frase) convive com "Plano Atual" (botão Free, existente).
- O CI ganhou um passo (`test:unit:ui`).
- A trava síncrona do hook só tem prova indireta: o E2E de clique duplo gera um pedido, mas não há teste unitário de hook.

**Rollback:** reverter o diff da UX-H1 (componentes `Icons`, `Sidebar`, `Header`, `PricingTable`, hook de billing, `iconPackProps.ts`, `pricingTableState.ts`, token `primary-on-dark`, testes e o passo de CI). Nenhum dado, contrato ou Rule muda.

---

## 18. P3 — execução e evidências

### 18.1 P3-A — núcleo autoritativo de criação de lançamentos (2026-10-03)

Sobre o HEAD `37d8780` + working tree da UX-H1 (§17.12, ZIP `dindin-minhas-financas-ux-h1-2026-10-03.zip`, SHA-256 `7b30e80b…4c80`, conferido), na mesma branch. P0–P2 e a UX-H1 estão preservados: só o backend de caixa, as Rules, os testes e a documentação mudaram. O frontend não mudou e não foi migrado. Nada foi implantado, commitado ou enviado; Firebase só no Emulator `minhas-financas-local`; dados sintéticos. **P3 não está concluída**, e esta entrega não fecha nenhum blocker sozinha.

**Escopo entregue.** Uma callable que cria receita ou despesa manual comum, já ocorrida e confirmada:
- contrato: `functions/src/cash/contracts.ts`;
- executor transacional: `functions/src/cash/createTransaction.ts:117-221`;
- callable `createCashTransaction`: `functions/src/cash/callables.ts:30`, exportada em `functions/src/index.ts:38`;
- trilha `cash_events`: `appendCashEvent` em `functions/src/shared/audit.ts:124-144`, com o mesmo gravador de `membership_events`;
- Rules: bloco `cash_events` (`firestore.rules:991-996`) e marca `cashEntry` em `isPlainClientTransaction` (`firestore.rules:186-192`);
- contrato de implantação: 60 s, 256 MiB, 20 instâncias, sem segredo.

Fora do escopo, de propósito: pendente e agendado (D-29); transferência (D-30); parcela e cartão (P4); investimento; empréstimo e recebível; edição e anulação (D-35); troca da projeção (D-38); quota (D-40); troca do frontend.

**Contrato (`createCashTransaction`).** Os dois ramos (`receita`, `despesa`) são `.strict()`.

| Campo | Regra |
| --- | --- |
| `workspaceId` | Schema de caminho do kernel. É só a entrada do resolvedor: o caminho gravado sai do ator autorizado |
| `idempotencyKey` | Obrigatória, 8–128 caracteres, uma por intenção |
| `type` | `receita` ou `despesa`. `investimento`, `parcelado` e qualquer outro são recusados |
| `amountCents` | Inteiro seguro, de 1 até 100.000.000.000 (R$ 1 bilhão, o mesmo teto das Rules). Sem coerção: `"100"`, `10.5`, `0.1 + 0.2`, `NaN`, `Infinity`, `0` e `-0` são recusados |
| `date` | `AAAA-MM-DD` existente, de `2000-01-01` até hoje em `America/Sao_Paulo` (lançamento confirmado é fato ocorrido) |
| `description` (≤ 300), `category` (≤ 120) | Obrigatórios, aparados, sem caractere de controle |
| `incomeType` (só receita); `expenseType` e `paymentMethod` (só despesa) | Opcionais, ≤ 120 |
| `supplier`, `costCenter` | Opcionais, ≤ 200, **só em espaço PJ**, conferido pelo tipo persistido do workspace |
| Qualquer outro campo | Recusado. Exemplos: `value`, `valueCents`, `userId`, `profileId`, `profileType`, `isPaid`, `role`, `goalId`, `cardId`, `walletId`, `loanId`, `loanMovementId`, `receivableId`, `installments`, `source`, `creditCard*`, `investmentMetadata`, `cashEntry`, `voidedAt`, `createdBy` |

- Resposta: `{transactionId, replayed}`.
- Erros pelo mapeador único, em pt-BR: `invalid-argument`, `unauthenticated`, `permission-denied` (com `reason: account_suspended` quando cabe), `failed-precondition` (workspace arquivado, conflito de idempotência), `aborted` (contenção).

**Fato gravado** (`workspaces/{wid}/transactions/cash_<sha256(wid:uid:chave)[0:40]>`, com `transaction.create`):
- campos: `type`, `description`, `category`, `valueCents` (autoritativo), `value = valueCents/100` (derivado, só para os leitores atuais, nunca entrada), `date`, `transactionDate` (meio-dia de São Paulo do mesmo dia civil), `isPaid: true`, `workspaceId`, `profileId`, `profileType` (do workspace), `userId`, `createdBy` e `updatedBy` (do token), `createdAt` e `updatedAt` (do servidor), e os opcionais do tipo;
- `cashEntry: {domainVersion: 1, origin: "manual", status: "confirmed", currency: "BRL", requestHash}`;
- nenhum vínculo de outro domínio.

**Invariantes provados por teste.**
1. Autorização relida dentro da transação: conta ativa, membership ativo, papel owner/admin/member e workspace ativo. A pré-checagem do kernel é só filtro.
2. Usuário, workspace, PF/PJ e papel vêm do token e do estado persistido, nunca do payload.
3. Lançamento, evento de auditoria e conclusão da chave saem num único commit; uma falha em qualquer ponto não deixa nenhum dos três.
4. A mesma chave com o mesmo conteúdo devolve o mesmo `transactionId` (`replayed: true`) sem nenhuma escrita.
5. A mesma chave com outro conteúdo é recusada, inclusive com outro workspace do mesmo ator.
6. Expirada a chave do ator (TTL de 90 dias), o ID determinístico do lançamento continua sendo a âncora: o replay ainda devolve o mesmo fato, e outro conteúdo ainda é conflito.
7. Um documento alheio no mesmo ID (sem `cashEntry`) nunca é sobrescrito.
8. A mesma intenção concorrente gera um único lançamento; intenções distintas concorrentes não se perdem.
9. A auditoria (`cash_entry.created`) registra ator, papel, PF/PJ, lançamento, `requestHash` e `requestId`, sem valor, descrição, categoria ou data.
10. O fato entra na projeção existente: `cashPeriodKeyFor` atribui o mês civil de São Paulo, inclusive no último dia, e `cashPeriodDeltaFor` dá receita ou despesa exata em centavos. Aplicada como o gatilho faz, uma reentrega não soma de novo.
11. O cliente não cria documento com `cashEntry`, nem edita, anula, apaga ou desmarca um lançamento com essa marca. O controle prova que é a marca que nega: o mesmo documento sem ela segue o caminho legado.

**Decisões técnicas desta entrega.**
- **Trilha em `cash_events`, e não em `financial_events`.** `financial_events` tem leitura de qualquer membro, viewer incluído (`canReadWorkspaceScopedData`), e guarda o formato do domínio de cartões, com valores no `payload`. Restringir a leitura mexeria em cartões (P4). `cash_events` usa o contrato de `membership_events` (owner/admin leem, ninguém escreve). As trilhas são consolidadas em P7 (ARCHITECTURE §2.4).
- **Duas camadas de idempotência**, cada uma com seu papel:
  - a chave do ator do kernel (`users/{uid}/idempotency_keys`, 90 dias) recusa reuso com outro conteúdo em qualquer workspace;
  - o ID determinístico do lançamento é a âncora permanente da intenção.
- **Sem limite de frequência nesta entrega.** A exposição é a mesma do caminho legado do cliente, que segue aberto. O limite entra com a quota (D-40), antes da troca do frontend.
- **Projeção pelo gatilho existente** (D-38 em aberto): a callable não grava `cash_report_periods`, para não criar uma segunda via de projeção.

**Quota de lançamentos: bloqueio registrado (D-40, §10).**
- A semântica de `transactionsPerMonth` não está definida. Os pontos em aberto:
  - o mês conta pela data de criação ou pela data do lançamento?
  - espelhos, recorrentes, parcelas, empréstimos, recebíveis, divisão e importação consomem a quota?
  - a anulação devolve a unidade (depende de D-35)?
- A UI de hoje conta lançamentos com data no mês corrente, espelhos incluídos (`src/components/TransactionsView.tsx:97-121`), e não é autoridade.
- Conforme o pedido, nenhum contador provisório foi gravado e nada conta a coleção inteira. Logo, idempotência e quota não interagem nesta entrega: um replay não consome nada porque não há consumo.

**Testes.**

| Suíte | Resultado |
| --- | --- |
| `functions/src/cash/__tests__/contracts.test.ts` (unitário, novo) | 8/8. Cobre: valores válidos e inválidos, data no limite de hoje em São Paulo e futura, ano bissexto, 28 campos autoritativos ou de vínculo nos dois tipos, tipos fora do escopo, campos cruzados entre tipos, textos e IDs |
| `functions/src/cash/__tests__/createTransaction.integration.test.ts` (Emulator, novo) | 16/16. Cobre: receita PF e despesa PJ nos três papéis; projeção e reentrega; contrato inválido sem efeito; PJ-only; sem sessão, provedor fora da política, não membro, removido, viewer, suspenso; arquivado; dois tenants nos dois sentidos; papel revogado e rebaixado depois da pré-checagem; replay; conflito (inclusive outro workspace); chave expirada; documento alheio no ID; 6 chamadas concorrentes da mesma intenção; 4 intenções concorrentes; falha no commit sem efeito parcial |
| `tests/firestore/m4-hardening.rules.integration.test.mjs` (+2) | 38/38. `cash_events`: owner e admin leem até 100; member, viewer e removido não leem; outro tenant não lê, nos dois sentidos; ninguém cria, altera ou apaga. `cashEntry`: create, edição, anulação, delete e desmarcação negados a owner, admin e member; controle sem a marca aceito |
| `functions/src/shared/deploymentContract.test.ts` (+1) | Perfil de domínio e nenhum segredo |

**Testes provados contra o defeito.** Cada mutação foi reintroduzida e depois desfeita:

| Mutação | Teste que falhou |
| --- | --- |
| Ramo `receita` sem `.strict()` | Unitário: 2 testes |
| Sem a âncora durável | Integração: teste da chave expirada |
| Sem a releitura transacional da autorização | Integração: papel revogado |
| Auditoria fora da transação | Integração: 8 testes |
| Rules sem `cashEntry` | Rules: teste da marca |
| `cash_events` legível por membro | Rules: teste da auditoria |

**Validação** (Emulator `minhas-financas-local`; logs fora do repositório):

| Etapa | Resultado |
| --- | --- |
| `npm run verify:fast` | Typecheck da raiz e das Functions: 0 erros. Lint das Functions: 0 erros e 1.967 avisos, os mesmos de antes (os arquivos novos não têm aviso). Build de produção. Unitários das Functions 371/371 (362 + 9). Frontend: 174/174, 128/128, 43/43 e 5/5 |
| `npm run test:integration:emulator` | Functions 382/382 (366 + 16 novos); ferramenta de limpeza 15/15; Rules 100/100 em 8 suítes (98 + 2 novos: goals 5, investments 7, investment-domain 19, investment-m3 7, m4 38, adjacent 5, workspaces 10, billing 9). Depois dos últimos ajustes (PF/PJ no evento, tenants nos dois sentidos, `role` no contrato), reexecutados: build, unitários de contrato e de implantação 24/24, integração de caixa 16/16 e Rules M4 38/38; lint e typecheck sem mudança |
| E2E | Não executado: o frontend não mudou, nenhuma tela lê `cash_events` e nenhum documento do produto tem `cashEntry`. As Rules alteradas foram cobertas pelas 8 suítes de Rules. O último E2E completo (52/52) é o da UX-H1 |

**Revisões especializadas** (escopo P3-A; o `regression-release-gate` não foi executado, porque P3 não está concluída):
- `multi-tenant-security-review`: **PASS**. Identidade vem do token. A autorização é relida na transação. Matriz testada: owner, admin e member criam; viewer não. Dois tenants, nos dois sentidos, na callable e nas Rules. Campos forjados recusados. Idempotência ligada a ator, workspace, operação e payload. Rules independentes do backend.
- `firestore-scale-cost-review`: **PASS**. Nenhuma consulta nem listener. Custo constante por criação: 8 leituras e 3 escritas na callable, mais 1 leitura e 3 escritas do gatilho existente. Replay: 7 leituras e nenhuma escrita. IDs por hash, sem hotspot sequencial. TTL versionado da chave do ator. `cash_events` retido como auditoria (D-18). Listagem com teto 100 testada. O documento mensal quente da projeção é anterior a esta entrega e segue em PR-TX-04.
- `financial-domain-integrity`: **FAIL** no escopo de P3, como se espera de uma entrega parcial. A fatia P3-A não teve achado: centavos inteiros, data civil de São Paulo, idempotência, concorrência, atomicidade (lançamento + auditoria + chave), histórico append-only, PF/PJ explícito e compatibilidade com a reconstrução. O gate bloqueia pelo que ainda falta em P3: (1) segundo escritor em `transactions`, o caminho legado do cliente (PR-TX-01/02); (2) sem testes de edição e anulação, porque as operações não existem (D-35); (3) duas representações por fato (`value`/`valueCents`, `date`/`transactionDate`), mantidas pelos leitores atuais (PR-TX-03); (4) projeção assíncrona por gatilho sem retry de plataforma (PR-TX-04, D-38).
- `billing-entitlement-integrity`: não executada, porque a quota não foi implementada (D-40).

**O que falta para PR-TX-01…05.**

| ID | Entregue em P3-A | Falta |
| --- | --- | --- |
| PR-TX-01 (BLOCKER) | Callable de criação com schema estrito, centavos, idempotência por intenção, ID determinístico e auditoria | Trocar o frontend para a callable (chave por intenção de formulário, envio em voo bloqueado, erros pt-BR); definir o destino do lote do cliente (`createTransactionsBatch`, `src/modules/transactions/api.ts:274`); remover `addDoc`/`writeBatch`/`updateDoc`/baixa do cliente e o `create`/`update` das Rules (`write: false`); quota (D-40); E2E dos fluxos reais |
| PR-TX-02 (BLOCKER) | O lançamento da callable não é editável nem anulável pelo cliente (`cashEntry`) | Proteger os demais espelhos (fatura, recorrentes) e tirar os campos de vínculo da allowlist do cliente; fecha com o `write: false` |
| PR-TX-03 (HIGH) | Fato compatível com `cashPeriodDeltaFor` e com os leitores atuais | Fórmula única entre a projeção, o dashboard, os relatórios e o log; remover `value` em reais e a data dupla |
| PR-TX-04 (HIGH) | Nada (a via de projeção não mudou) | D-38: retry idempotente ou projeção no commit, cerca de versão no rebuild, documento quente |
| PR-TX-05 (HIGH) | Trilha append-only da criação (`cash_events`) | Edição e anulação com antes e depois em centavos e motivo (D-35) |

**Riscos residuais.**
- **Dois escritores em `transactions` até a troca.** O caminho legado do cliente segue aberto, e só o lançamento da callable é protegido. É o estado esperado de uma entrega parcial; a remoção do legado acontece na troca do frontend, no mesmo marco de P3 (Política de legado).
- **Lançamento da callable sem correção.** Ninguém edita nem anula um lançamento `cashEntry`. Sem impacto hoje, porque o produto não o cria. Por isso o frontend não pode trocar de caminho antes de D-35.
- **Reuso de chave depois de 90 dias em outro workspace do mesmo ator** cria um segundo lançamento. A chave é gerada por intenção, então o caso é teórico.
- `value` em reais e `transactionDate` continuam gravados por compatibilidade com os leitores atuais (PR-TX-03). O instante é o meio-dia de São Paulo; o cliente legado grava meio-dia UTC. As duas formas caem no mesmo dia civil, e as consultas ordenam por `date`.
- Sem limite de frequência e sem quota na callable (D-40).
- `cash_events` sem TTL: trilha de auditoria, prazo por D-18.
- Nada disso é implantado antes de P6 (D-ORD-04).

**Critérios para a próxima entrega de P3.**
1. D-35 e D-40 decididas, e D-29 decidida se a entrega incluir pendentes.
2. Callables de edição e anulação no mesmo kernel, com `expectedVersion`, idempotência e evento em `cash_events` (antes e depois em centavos, motivo).
3. Quota de lançamentos atômica na mesma transação, por contador do titular, sem contar a coleção, com concorrência no último slot e replay sem consumo.
4. Troca do frontend de uma vez (criar, editar, anular), sem mudança visual; remoção do write path do cliente e Rules `write: false` em `transactions`, com testes de Rules e E2E dos fluxos reais.
5. Decisão e implementação de D-38, e o plano de convergência de PR-TX-03.

**Rollback:** reverter o diff da P3-A:
- remover `functions/src/cash/{contracts,createTransaction,callables}.ts` e os dois testes novos;
- desfazer os acréscimos em `shared/audit.ts`, `shared/ids.ts` (export), `index.ts` e `deploymentContract.test.ts`;
- remover o bloco `cash_events` e a marca `cashEntry` das Rules, e os 2 testes de Rules.

Não há dado nem contrato do frontend a reverter.

### 18.2 P3-B — confiabilidade do caixa, recuperação de falhas e projeção mensal (2026-10-03)

Sobre o HEAD `37d8780` + working tree da P3-A (§18.1), na mesma branch. O ZIP `dindin-minhas-financas-p3a-2026-10-03.zip` (SHA-256 `bc213e17…08b1`) foi extraído e comparado com o checkout: idênticos fora dos arquivos ignorados. P0–P2, a UX-H1 e a P3-A estão preservados.

Só backend, configuração de TTL, testes e documentação mudaram. Frontend e Rules não mudaram. Nada foi implantado, commitado ou enviado; Firebase só no Emulator `minhas-financas-local`; dados sintéticos. **P3 não está concluída.**

**Problema encontrado.**

| # | Defeito | Efeito | Código anterior |
| --- | --- | --- | --- |
| 1 | O gatilho `onTransactionWrite` rodava sem `retry` | Qualquer falha (contenção esgotada, indisponibilidade, timeout) descartava o evento: o delta nunca entrava na projeção, sem log e sem sinal | `functions/src/triggers/transactions.ts:35` |
| 2 | A reconstrução publicava o acumulado por cima da projeção, sem cerca | Perdia o delta de quem mudasse uma página já lida. Somava duas vezes o evento entregue depois da publicação (escrita anterior ao corte com gatilho atrasado) | `functions/src/cash/rebuild.ts:200-240` |
| 3 | A publicação era um `WriteBatch` único de até 600 meses + órfãos | Passava das 500 escritas de um commit; falhava inteira e sem mensagem clara | mesma rotina |
| 4 | A leitura dos períodos existentes era feita fora de transação e sem `limit` | Sem serialização frente ao gatilho | mesma rotina |
| 5 | `createCashTransaction` não tinha limite operacional | Laço de cliente ou script sem freio | `functions/src/cash/createTransaction.ts` |

**Decisão D-38 (tomada nesta entrega): projeção por gatilho com retry idempotente, mais cerca de corte na reconstrução.**
- **Por que não a projeção no commit da callable.** Ainda há escritores legados (cliente com `addDoc`/`writeBatch`/`updateDoc`/baixa, espelho de investimentos, pagamento de fatura, cron de recorrentes) que não passam por `createCashTransaction`. Só o gatilho vê todas as escritas; projetar no commit exigiria a migração completa do frontend e dos produtores.
- **Gatilho.**
  - Opções: `retry: true` (`TRANSACTION_WRITE_TRIGGER_OPTIONS`, `functions/src/shared/runtimeOptions.ts`), 60 s, 256 MiB, 20 instâncias.
  - Lógica isolada em `handleTransactionWrite` (`functions/src/triggers/transactions.ts`); o wrapper só extrai o instante de commit (`after.updateTime`, ou `event.time` com microssegundos na exclusão) e o `createTime` anterior.
- **Política de retry efetiva.**
  - O Eventarc reentrega por até 24 h, com backoff exponencial de 10 a 600 s (2ª geração).
  - Falha passageira (gRPC 1, 2, 4, 6, 8, 10, 13, 14 e transação invalidada) é registrada em log e **relançada**.
  - Falha permanente — ou passageira com o evento a mais de 23 h do commit (`RETRY_GIVE_UP_AGE_SECONDS`) — é registrada no estado da projeção (`needsRebuild`, `issueCount`, `issueMaxEventTime`, `lastIssueCode`) e encerra a execução. Se nem o registro for possível, o erro original é relançado.
  - Falha permanente só na trilha `activity_logs`, com a projeção aplicada, gera só log de erro: o caixa está certo.
  - Nenhum log leva valor, descrição ou categoria; só IDs, ação, resultado, código de erro e idade do evento.
- **Marca de entrega** (`cash_period_events/{hash(event.id)}`, na mesma transação do delta). Passa a guardar:
  - `eventTime` (commit da escrita);
  - `outcome`: `applied`, `covered_by_rebuild` ou `ambiguous_delete`;
  - `deltas` por período;
  - `beforeCreateTime`.

  A reentrega encontra a marca e não soma (INV-P3-001, preservado).
- **Estado da projeção e cerca** (`cash_period_events/projection_state`, um documento por workspace, negado ao cliente):
  - `baselineCutoff`, `baselineRebuildId`, `lastPublishedAt`, `needsRebuild` e os campos de incidente;
  - o gatilho só o **lê** (uma leitura a mais por entrega); quem escreve é a publicação e, raramente, o registro de incidente. Não é documento quente.
- **Regras do gatilho:**
  - evento com commit `<= baselineCutoff` já está na base: marca `covered_by_rebuild`, não soma;
  - exclusão física de documento que existia no corte, com commit entre o corte e a publicação: ambígua; não soma, marca `ambiguous_delete` e liga `needsRebuild`;
  - os demais somam.
- **Reconstrução** (`functions/src/cash/rebuild.ts`):
  - o corte é o commit do checkpoint (`cutoff: serverTimestamp`);
  - na varredura, documento com `createTime > cutoff` é ignorado (o gatilho o soma); `createTime <= cutoff < updateTime` faz a reconstrução **recomeçar** com corte novo, sem publicar; `updateTime <= cutoff` entra;
  - o checkpoint avança por transação condicionada a `rebuildId` e cursor;
  - checkpoint com mais de 24 h, ou anterior à cerca, recomeça.
- **Publicação**, numa transação. Lê o checkpoint, o estado, as marcas com `eventTime > cutoff` (até 200) e todos os meses que vai gravar. Depois:
  - soma os deltas das marcas `applied`;
  - recomeça se houver mais de 200 marcas ou uma exclusão ambígua;
  - recusa, antes de escrever, se passar de 500 escritas;
  - grava meses e órfãos, registra o corte no estado e apaga o checkpoint.
- **Simulação (`dryRun`):** checkpoint próprio; devolve a conferência do que a publicação gravaria agora e nunca toca em períodos nem no estado.

**Garantias comprovadas por teste (Emulator).**

| Situação | Resultado | Teste |
| --- | --- | --- |
| Criação, edição, troca de mês e baixa lógica | Uma soma por escrita, com deltas na marca | `projectionRecovery` |
| Reentrega e 6 entregas simultâneas do mesmo evento | Uma soma | `projectionRecovery` |
| Falha antes da projeção / dentro da transação | Relançada; nada gravado; a nova tentativa soma uma vez | `projectionRecovery` |
| Commit feito e falha depois (resposta perdida, trilha) | Relançada; a nova tentativa não soma de novo e grava a trilha | `projectionRecovery` |
| Falha permanente; falha passageira no fim da janela | Registrada em `needsRebuild`, sem relançar | `projectionRecovery` |
| Execução inicial, retomada por cursor, repetição, órfão | Base igual ao ledger; corte constante durante a execução | `rebuildFence` |
| Simulação intercalada com a execução real | Nada publicado; checkpoint real intacto | `rebuildFence` |
| Criação durante a varredura (posição lida e não lida), gatilho antes | A publicação soma as duas marcas | `rebuildFence` |
| Edição de documento ainda não lido | Recomeça com corte novo; depois, base correta | `rebuildFence` |
| Edição de página lida, gatilho antes / depois da publicação | Somada pela publicação / somada sobre a base | `rebuildFence` |
| Escrita anterior ao corte com gatilho entregue depois da publicação | `covered_by_rebuild`, sem dupla contagem | `rebuildFence` |
| Duas execuções concorrentes; publicação concorrente com 3 entregas (3 rodadas) | Consistentes; quem perde a disputa não escreve | `rebuildFence` |
| Entrega iniciada **dentro** da transação de publicação | Serializada, nenhum delta apagado | `rebuildFence` |
| Corte já superado por base mais nova | Não publica | `rebuildFence` |
| Falha durante a publicação | Nenhum mês, estado ou checkpoint alterado; a nova tentativa publica | `rebuildFence` |
| Teto de escritas | 500 escritas publicam (498 meses), 501 são recusadas antes de qualquer escrita; orçamento reduzido idem | `rebuildFence` |
| Checkpoint | 500 meses cabem; 601 são recusados sem truncar | `rebuildFence` |
| Exclusão física durante a varredura / pendente na janela | Recomeça / `ambiguous_delete` + `needsRebuild`, nas duas ordens; reconstrução posterior corrige e desliga | `rebuildFence` |
| Incidente registrado | Só um corte posterior a ele desliga `needsRebuild` | `rebuildFence` |

**Testes provados contra o defeito.** 11 mutações, cada uma detectada pelo teste esperado:

| Mutação | Teste que pegou |
| --- | --- |
| Sem `covered_by_rebuild` | Evento anterior ao corte |
| Publicação sem os deltas das marcas | 3 testes |
| Varredura sem recomeçar | Edição não lida |
| Varredura sem ignorar criações | Criação na varredura |
| Gatilho engolindo falha passageira | 3 testes |
| Trilha com ID não determinístico | 2 testes |
| Limite que não consome | 5 testes |
| Limite antes do replay | Replay no teto |
| Sem a regra de exclusão ambígua | Exclusão pendente |
| Publicação ignorando exclusão | Exclusão na varredura |
| Gatilho sem `retry` | Contrato de implantação |

- **Serialização da publicação:** com todas as leituras da publicação fora da transação, o teste falhou 3/3 (delta apagado); com as leituras transacionais, passou 3/3. A leitura explícita dos meses ainda inexistentes não é necessária no Emulator (a consulta transacional da coleção e a faixa das marcas já serializam) e fica como defesa em profundidade.

**Limite operacional da criação (`CASH_ENTRY_RATE_LIMIT`).**
- 120 criações a cada 10 minutos, por ator e workspace, reservadas com `reserveRateLimit` **dentro** da transação, depois da autorização, do replay e da âncora durável:
  - replay não consome nem é barrado;
  - recusa e falha antes do commit não consomem;
  - no último slot, só uma intenção nova passa.
- Excedido: `failed-precondition` com "Muitas solicitações em pouco tempo…" e `retryAfterSeconds`.
- **Não** substitui a quota comercial `transactionsPerMonth` (D-40).
- Custo: uma leitura e uma escrita a mais por criação; o contador serializa só as criações simultâneas do mesmo ator.

**Limites e custo.**
- Por escrita no ledger, no gatilho: 2 leituras por ID (marca + estado; antes, 1) e as mesmas escritas (1–2 meses, marca, trilha).
- Por criação pela callable: 9 leituras e 4 escritas. Replay: 7 leituras e nenhuma escrita.
- Por página da reconstrução: `pageSize` leituras + 3, e 1 escrita.
- Publicação: até 2 + 201 + 603 leituras e até 500 escritas, num commit.
- Contenção dos meses: cada lançamento incrementa 1–2 documentos mensais do workspace. O teto prático é de cerca de 1 escrita/s sustentada por documento; a quota de D-08 (10.000 lançamentos/mês no Business ≈ 0,004/s) fica longe dele, e rajadas são absorvidas pela repetição da transação e pelo retry do gatilho.
- Retenção: marcas (90 dias) e contadores de limite (2 dias) passam a ter a política de TTL declarada em `firestore.indexes.json`. O estado da projeção não tem `expiresAt`.

**Limitações documentadas (não garantidas).**
- Uma falha que persiste por 24 h e impede até o registro do incidente (Firestore indisponível o dia inteiro) é descartada pelo Eventarc. Fica só o log de erro `cash_projection.issue_record_failed`.
- Não há detector agendado de deriva de caixa: a divergência fica visível por `needsRebuild` quando o gatilho a percebe; o alerta sobre os logs e a varredura periódica são de P7.
- Sob edição contínua de documentos ainda não lidos, a reconstrução pode recomeçar repetidamente. Ela nunca publica errado, mas pode não terminar; em workspace muito ativo, rodar numa janela calma. O SDK 7.11.6 limita `readTime` a 60 s, então a leitura por instante fixo não resolve uma varredura em várias chamadas.
- Mais de 498 meses com movimento não cabem numa publicação atômica e são recusados (o produto aceita datas desde 2000; 498 meses são 41 anos).
- O documento mensal continua sendo ponto de contenção para importações em massa (acima de ~1 escrita/s sustentada no mesmo mês).
- Resta de PR-TX-04: os crons de recorrentes (P4) e o detector de deriva (P7).

**Validação.**

Emulator `minhas-financas-local`; logs fora do repositório. As contagens abaixo são do estado final.

| Etapa | Resultado |
| --- | --- |
| Direcionados | Existentes afetados: `periods`, `createTransaction`, `goalSingleSource` e `simpleMode`, 76/76 com o instante de commit nos auxiliares. Novos: `projection` 6/6, `projectionRecovery` 8/8, `rebuildFence` 20/20 e limite operacional 6/6 |
| `npm run verify:fast` | Typecheck da raiz e das Functions: 0 erros. Lint das Functions: 0 erros e 1.961 avisos (eram 1.967; nenhum aviso nos arquivos novos, e o gatilho e a reconstrução perderam os 6 que tinham). Build de produção. Unitários das Functions 378/378. Frontend: 174/174, 128/128, 43/43 e 5/5 |
| `npm run test:integration:emulator` | Functions 416/416 (382 + 34 novos). Ferramenta de limpeza 15/15. Rules 100/100 em 8 suítes (goals 5, investments 7, investment-domain 19, investment-m3 7, m4 38, adjacent 5, workspaces 10, billing 9), sem mudança nas Rules |
| Mutação | 11 mutações detectadas, mais a prova de serialização da publicação (3/3 com as leituras transacionais; falha 3/3 com elas fora da transação) |
| E2E | Não executado. O frontend não mudou e o contrato que ele lê (`cash_report_periods` ordenado por `periodStart`, sem os checkpoints) é o mesmo |

- **Teste instável encontrado e corrigido.** A primeira execução final falhou num teste novo (415/416). A asserção procurava `"5000"` no JSON do estado, e os nanossegundos de um Timestamp continham esses dígitos. O mesmo defeito latente existia no teste de auditoria da P3-A (hash hex e nanossegundos). Os dois passaram a conferir a lista exata de campos, o que é mais estrito e determinístico. Na execução seguinte, tudo verde.

**Revisões especializadas** (uma vez cada, sobre o código estabilizado):
- `financial-domain-integrity`: **FAIL** no escopo de P3, pelos mesmos itens ainda abertos da P3, e não pela P3-B. A fatia P3-B não teve achado: idempotência por entrega preservada; retry com falha classificada; cerca de corte; publicação atômica; reconstrução comparada ao ledger em todas as ordens testadas; falhas injetadas sem efeito parcial; 11 mutações detectadas. O gate bloqueia por: (1) segundo escritor e autoridade em ponto flutuante nos documentos do cliente legado (PR-TX-01/02/03); (2) sem edição e anulação autoritativas para testar (D-35); (3) sem detector agendado de deriva (a divergência percebida liga `needsRebuild`, mas o descarte da plataforma sem registro possível só deixa log).
- `firestore-scale-cost-review`: **PASS** depois de duas correções feitas na própria revisão: leitura dos períodos na publicação com `limit` (recusa acima de 600) e política de TTL declarada para `cash_period_events` e `rate_limits` em `firestore.indexes.json`, com teste unitário. Nenhuma consulta nova sem limite; a consulta de marcas usa o índice automático de campo único `eventTime`; nenhum listener; custo constante por evento e por criação; publicação limitada a um commit de 500 escritas; contadores de limite sem crescimento (um documento por ator e workspace).
- `multi-tenant-security-review`: não executada. A autorização não mudou: o limite operacional usa o ator já autorizado, e as coleções novas estão sob `cash_period_events` e `rate_limits`, que já são negadas ao cliente.

**Riscos residuais e próxima entrega.**
- D-29, D-35 e D-40 seguem abertas e são pré-requisito da troca do frontend.
- O escritor legado do cliente continua em `transactions` (PR-TX-01/02). A cerca garante a projeção apesar dele, mas a autoridade financeira ainda não é só do backend.
- A trilha da reconstrução (TX-15: `reason`/`correlationId` sem evento de auditoria) continua aberta.
- Próxima entrega de P3: decidir D-35/D-40 (e D-29 se entrar pendente) e entregar edição e anulação, quota e a troca do frontend com `write: false`, conforme §18.1.

**Rollback:** reverter o diff da P3-B. Isso inclui:
- `triggers/transactions.ts`, `cash/periods.ts`, `cash/rebuild.ts`, `cash/createTransaction.ts`;
- `runtimeOptions.ts`, `retention.ts` (comentário), `firestore.indexes.json` (2 TTL);
- os testes novos e os 4 auxiliares de teste com `eventTime`.

Com `retry: false`, o gatilho volta a descartar o evento na falha. As marcas e o estado gravados não precisam ser removidos: o código anterior ignora os campos novos.

### 18.3 P3-C — edição e anulação autoritativas de lançamentos (2026-10-03)

Sobre o HEAD `37d8780` + working tree da P3-B (§18.2), na mesma branch. O ZIP `dindin-minhas-financas-p3b-2026-10-03.zip` (SHA-256 `7967b355…f683`) foi extraído e comparado com o checkout: idênticos fora dos arquivos ignorados. P0–P2, a UX-H1, a P3-A e a P3-B estão preservados.

Mudaram só o backend de caixa, os testes (Functions e um teste de Rules) e a documentação. Frontend e Rules não mudaram. Nada foi implantado, commitado ou enviado; Firebase só no Emulator `minhas-financas-local`; dados sintéticos. **P3 não está concluída**: o frontend ainda grava pelo caminho legado, e a quota (D-40) não existe.

**Decisão D-35 (tomada nesta entrega): correção por edição auditada e anulação lógica com motivo, sem bloqueio por período.**
- **Correção.** Quem tem permissão corrige os campos financeiros e descritivos do contrato: tipo (receita ↔ despesa), descrição, categoria, `amountCents`, data civil, tipo de receita ou despesa, forma de pagamento, e fornecedor e centro de custo (só PJ). Não mudam:
  - a identidade do documento;
  - `createdAt`;
  - o autor original (`userId`, `createdBy`);
  - a âncora da criação (`cashEntry.requestHash`).
- **Trilha da correção.** Cada correção com mudança grava um evento imutável `cash_entry.updated` em `cash_events`, com:
  - lançamento, ator, papel e PF/PJ;
  - instante do servidor e motivo;
  - campos alterados;
  - estado financeiro antes e depois (`amountCents`, `type`, `date`);
  - ID da intenção, `requestHash`, `requestId` e `correlationId`.

  O evento não copia o documento, a descrição nem a categoria.
- **Anulação.** Lógica, com motivo obrigatório. O documento permanece, com `voidedAt` (servidor), `voidedBy` e `voidReason`, e o valor histórico intacto. O evento é `cash_entry.voided` (estado antes; depois `null`). O anulado sai do caixa (a projeção existente zera anulados), não é corrigido e não é reativado: não há operação de reativação, e a correção e a nova anulação são recusadas. Nada é apagado.
- **Não decidido aqui:** fechamento de período (nenhuma trava inventada), estorno em outros domínios (os vínculos são recusados) e se a anulação devolve unidade de quota (D-40).
- **Por que edição auditada e não estorno + novo lançamento.** O produto não tem fechamento de período (nada a preservar além da trilha), e o estorno dobraria documentos, projeção e quota para um caso que a trilha com antes e depois já reconstrói.

**Escopo entregue.**
- Contratos estritos e separados: `updateCashTransactionPayloadSchema` e `voidCashTransactionPayloadSchema` (`functions/src/cash/contracts.ts:165-177`). O estado corrigido usa união discriminada por tipo (`:149-162`). `expectedUpdatedAt` é um instante ISO com até 9 casas, ou `null` (`:129`).
- Elegibilidade por evidência positiva: `classifyCashEntryEligibility` (`functions/src/cash/eligibility.ts:213-233`).
- Executores transacionais: `executeUpdateCashTransaction` e `executeVoidCashTransaction` (`functions/src/cash/mutateTransaction.ts:336-542`), com a fase de leitura comum em `loadForMutation` (`:219-294`).
- Callables `updateCashTransaction` e `voidCashTransaction` no kernel (`functions/src/cash/callables.ts:61-80`), exportadas em `functions/src/index.ts`. Mesmo perfil de implantação da criação; o contrato de implantação cobre as três.
- Trilha: `appendCashMutationEvent` e o ID determinístico por intenção (`functions/src/shared/audit.ts:165-242`).
- Instante ISO com nanossegundos: `functions/src/shared/commitTime.ts`, compartilhado com o gatilho (`parseCloudEventTime`).

**Contrato final.**

| Item | Correção (`updateCashTransaction`) | Anulação (`voidCashTransaction`) |
| --- | --- | --- |
| Entrada | `workspaceId`, `idempotencyKey`, `transactionId`, `expectedUpdatedAt`, `reason` (1–300), `correlationId?`, `entry` (estado completo) | Os mesmos, sem `entry` |
| Recusado no schema | Qualquer chave fora do contrato: `userId`, `role`, `createdBy`, `updatedAt`, `cashEntry`, `valueCents`, `value`, `isPaid`, `source`, `profileType`, `walletId`, parcelas e todos os vínculos de outros domínios; `amountCents` não inteiro, ≤ 0 ou acima de R$ 1 bilhão; data futura, inválida ou antes de 2000 em São Paulo; tipo diferente de receita/despesa | Idem, mais qualquer estado novo (`entry`, `amountCents`, `voidedAt`, `voidedBy`) |
| Papéis | owner e admin: qualquer lançamento elegível; member: só os que registrou (`userId`); viewer: nunca | Idem |
| Resultado | `{transactionId, replayed, changed, revision}` | `{transactionId, replayed, revision}` |
| Efeito | Estado corrigido substitui o anterior: opcional omitido é removido; campos do outro tipo saem; retrato visual de campo alterado sai (a UI volta a resolver pelo nome); `transactionDate` só é recalculado (meio-dia de São Paulo) se a data mudou; `isPaid: true`; `profileType` gravado se faltava | `voidedAt`, `voidedBy`, `voidReason`, `updatedBy`, `updatedAt`, `cashEntry.status: voided` |
| Sem mudança | Nada é gravado no lançamento, na trilha ou no limite; só a chave é concluída (`changed: false`) | — |

- `value` (reais) continua espelhando `amountCents / 100` por compatibilidade com os leitores atuais (PR-TX-03); a autoridade é `valueCents`.
- Erros em pt-BR:
  - "Lançamento não encontrado.";
  - "Lançamento anulado não pode ser alterado nem reativado.";
  - "Este lançamento não pode ser alterado por esta operação." (com o código de inelegibilidade em `details`);
  - "Você só pode alterar os lançamentos que você mesmo registrou.";
  - o conflito de versão ("Este lançamento foi alterado por outra operação depois que você o abriu. Atualize e tente novamente.");
  - as mensagens do kernel para papel, conta suspensa, workspace arquivado, idempotência e limite.

**Ordem dentro da transação** (tudo ou nada):
1. Relê a autorização (`reassertWorkspaceActor`): conta ativa, membership ativo, papel em owner/admin/member, workspace ativo.
2. Reserva a chave do ator; replay devolve o resultado salvo, sem escrita.
3. Lê o lançamento e o evento da intenção. Se o evento existe, é a âncora durável: com o mesmo conteúdo (`requestHash`) e o mesmo ator, o replay vale mesmo depois da expiração da chave; com outro conteúdo, é conflito de chave.
4. Não encontrado; member com autor diferente; inelegível; versão divergente. Toda recusa acontece aqui, antes de qualquer escrita.
5. Reserva o limite operacional só quando vai gravar.
6. No mesmo commit: o lançamento, o evento (`transaction.create`), a conclusão da chave e o contador.

**Concorrência e versão.**
- O SDK web não expõe `updateTime`. A versão é o `updatedAt` do servidor, que todo escritor grava: a callable, o cliente legado e os espelhos.
- O cliente envia o `updatedAt` que leu, em ISO com nanossegundos. Diferente do atual, a operação é recusada com `aborted` e a mensagem de conflito, sem sobrescrever.
- Legado sem `updatedAt` só casa com `null`. `updatedAt` que não é Timestamp é inelegível (`ambiguous_version`).
- Duas correções simultâneas, ou correção simultânea com anulação: uma vence, a outra conflita (correção × anulação testada em 3 rodadas). Nunca as duas.
- **Limitação:** no documento legado, a versão vale o que vale o escritor legado. As Rules não obrigam `updatedAt == request.time`, então um cliente adulterado pode regravar uma versão antiga. Isso não amplia o que ele já pode fazer pelo caminho legado, e fecha com o `write: false` da troca do frontend.

**Idempotência e trilha.**
- A chave do ator (`users/{uid}/idempotency_keys`) liga intenção, operação e conteúdo:
  - mesmo conteúdo: replay, sem escrita nem evento novo;
  - conteúdo diferente: recusa "Esta chave de idempotência já foi usada com outros dados.".
- O ID do evento é `sha256(intenção:operação:lançamento)`, gravado com `create`. Uma mesma intenção nunca gera dois eventos.
- Com a chave expirada (retenção), o evento existente responde como replay se o conteúdo for o mesmo; outro conteúdo com a mesma chave continua recusado. A chave reaproveitada para **outro** lançamento depois da retenção é uma intenção nova, como na criação (P3-A); como a chave é gerada por intenção, o caso é teórico.
- Os eventos de criação (`cash_entry.created`) não mudaram. `cash_events` continua sem TTL (D-18), separado de `financial_events`, com leitura de owner/admin e `write: false`.
- Nenhum log operacional leva valor, descrição, categoria ou motivo: o kernel registra só operação, IDs, papel, resultado e duração.

**Limite operacional.** `CASH_ENTRY_MUTATION_RATE_LIMIT` (`mutateTransaction.ts:74`): 120 correções e anulações somadas a cada 10 minutos, por ator e workspace, com o mecanismo de `reserveRateLimit`.
- Replay, correção sem mudança e recusa antes do commit não consomem.
- Não é a quota `transactionsPerMonth` (D-40, aberta). Nenhuma das operações cria lançamento: o documento precisa existir. Nada aqui decide se a anulação devolve unidade de quota.

**Elegibilidade e legado.**
- **Elegível:**
  - lançamento da callable (`cashEntry` com origem `manual`, `status: confirmed`, BRL, `valueCents` inteiro, data civil);
  - legado já adotado (origem `legacy_manual`);
  - legado manual inequívoco: só chaves que o caminho do cliente grava, nenhum vínculo, autor humano, confirmado (`isPaid: true`; receita sem `isPaid`, como o formulário legado grava), `value` que vira centavos **sem arredondamento** e `transactionDate` no mesmo dia civil de `date`, quando existir.
- **Adoção do legado.** A primeira correção ou anulação grava `valueCents` e `cashEntry {origin: legacy_manual, revision, adoptedAt, adoptedBy}`, sem `requestHash`, porque não houve intenção de criação no backend. Carteira, instante e retratos não alterados são preservados.
- **Recusado com código nomeado, sem tocar no documento:**
  - `workspace_mismatch`;
  - `voided`;
  - `unsupported_type`, para investimento e parcelado;
  - `linked_to_other_domain`: cartão, fatura, empréstimo, meta, investimento, recorrente, recebível, cliente, divisão ou parcela ≠ 1;
  - `unsupported_origin`: recorrente, pagamento de fatura ou outra origem;
  - `backend_owned`: espelho com `valueCents` sem `cashEntry`;
  - `unknown_fields`;
  - `system_author`, `invalid_author`, `pending`;
  - `ambiguous_payment_state`, `ambiguous_value`, `ambiguous_date`, `ambiguous_version`.
- A ausência de `cashEntry` não torna nada elegível; documento de origem desconhecida não é convertido.
- **Legados que não podem ser migrados pelas callables:** pendentes (D-29), valores com fração de centavo, datas em formato livre ou divergentes do instante, autores de sistema, origens não manuais, chaves desconhecidas e qualquer documento com vínculo. Sem dados reais de produção, eles são recriados por seed/Emulator (Política de legado). Se houver dados reais antes da troca do frontend, eles exigem um backfill guardado e reconciliado (contagem e soma por mês e PF/PJ), fora destas callables.
- **Efeito no produto atual.** Depois da adoção, o documento tem `cashEntry`/`valueCents`, e as Rules impedem o cliente de editá-lo ou anulá-lo. O frontend ainda não chama as callables, então isso só acontece por chamada direta. A troca do frontend precisa usar as callables para todo lançamento elegível.
- **Tipo.** A callable aceita trocar receita ↔ despesa. As Rules do cliente continuam proibindo a troca de tipo no caminho legado (INV-P1-002, que protege contra a conversão para investimento, recusada aqui no schema).

**Garantias comprovadas por teste (Emulator).**

| Situação | Resultado | Teste |
| --- | --- | --- |
| Correção de receita em PF (valor, mês, descrição, tipo de receita) | Identidade, criação, autor e `requestHash` preservados; revisão 2; evento com antes/depois em centavos, campos, ator, papel, motivo, intenção e correlação; lista exata de chaves do evento | `mutateTransaction` |
| Despesa PJ trocada para receita | Campos de despesa e centro de custo removidos; evento com tipo antes/depois | idem |
| Correção sem mudança | Nada gravado, sem evento, sem consumo | idem |
| Anulação | Documento permanece com ator, instante e motivo; valor histórico intacto; fora do caixa | idem |
| Anulado corrigido, reanulado ou reativado | Recusado; documento e trilha intactos | idem + Rules |
| Projeção (gatilho real) | Criação, correção de valor/mês/tipo e anulação: projeção igual ao ledger em cada passo; a reconstrução chega ao mesmo caixa | idem |
| Dinheiro inválido; campos autoritativos e vínculos forjados; fornecedor/centro de custo em PF | `invalid-argument`, sem efeito | idem |
| Matriz de papéis | owner e admin corrigem e anulam qualquer elegível; member só o próprio; viewer e não autenticado nunca; autoria nunca muda | idem |
| Conta suspensa, membro removido, workspace arquivado | Recusados, sem efeito | idem |
| Entre workspaces, nos dois sentidos, e ID de outro tenant no próprio workspace | `permission-denied` / `not-found`, sem efeito | idem |
| Revogação e rebaixamento depois da pré-checagem | Recusados pela releitura na transação | idem |
| Replay, chave com outro conteúdo, chave expirada | Uma escrita e um evento; conflito de chave; com a chave expirada, a trilha responde ao mesmo conteúdo e recusa outro | idem |
| Versão desatualizada; escrita do cliente legado depois da leitura | Conflito em pt-BR, sem sobrescrever | idem |
| Duas correções simultâneas; correção × anulação (3 rodadas) | Uma vence; um evento; estado coerente | idem |
| Falha injetada antes do commit | Nenhuma alteração, evento, chave ou consumo; a mesma intenção aplica depois | idem |
| Limite no teto | Recusa sem efeito; replay passa sem consumir | idem |
| Replay da criação depois de corrigir e anular | Mesmo ID, nenhum lançamento novo, estado final intacto | idem |
| Espelhos e lançamentos de outros domínios | Recusados com o código certo, intactos | idem |
| Legado inequívoco (despesa, receita sem `isPaid`) | Corrigido/anulado e adotado; carteira, instante e retrato não alterado preservados | idem |
| Legado ambíguo (fração de centavo, pendente, sem estado, chave desconhecida, data divergente, espelho, outro perfil, autor de sistema, versão não Timestamp) | Recusado com código, intacto | idem |
| Contratos e elegibilidade sem Firestore | Schema, ISO com nanossegundos, centavos exatos, classificação | `mutationContracts` |
| Cliente sobre os estados da P3-C (legado adotado, anulado pelo backend) | Não corrige, não reativa, não troca o estado, não apaga, não grava `cash_events` | Rules `m4-hardening` |

**Testes provados contra o defeito.** 15 mutações, todas detectadas:

| Mutação | Teste que pegou |
| --- | --- |
| member altera lançamento de outro | Matriz de papéis |
| Sem pré-condição de versão | 4 testes (versão, simultâneas, correção × anulação, legado ambíguo) |
| Anulado elegível | Classificação (unitário) |
| Vínculo protegido aceito | Outros domínios + classificação |
| Replay consome limite | Replay + limite no teto |
| Centavos com arredondamento | Legado ambíguo + centavos exatos + classificação |
| Sem âncora da trilha | Replay com chave expirada |
| Releitura aceita viewer | Revogação depois da pré-checagem |
| Correção sem mudança grava | Correção sem mudança |
| Anulado fica no caixa (`cashPeriodDeltaFor`) | Anulação + projeção |
| Legado com chave desconhecida aceito | Legado ambíguo + classificação |
| Trilha sem ID por intenção | Replay com chave expirada |
| Sem a regra PJ de fornecedor | Campos forjados |
| Autoria sobrescrita | Correção de receita + matriz de papéis |
| Âncora da trilha sem comparar o conteúdo | Chave expirada reusada com outro conteúdo |

- **Mutação M3 (anulado elegível).** No lançamento da callable, a defesa em profundidade (`cashEntry.status`) continua recusando, por isso o teste de integração não falha. A regra de `voidedAt` no legado é pega pelo unitário.

**Custo.**
- Por correção ou anulação com escrita: 7 leituras (autorização 3, chave, lançamento, evento, limite) e 4 escritas (lançamento, evento, chave, contador). O gatilho existente acrescenta 2 leituras e 3–4 escritas.
- Replay: 4 leituras e nenhuma escrita. Pela âncora da trilha: 6 leituras e nenhuma escrita. Correção sem mudança: 6 leituras e 1 escrita.
- Nenhuma consulta e nenhum listener novos; nenhum índice novo. IDs por hash, sem hotspot sequencial.

**Validação.**

Emulator `minhas-financas-local`; logs fora do repositório. As contagens abaixo são da execução final, sobre o código final.

| Etapa | Resultado |
| --- | --- |
| Direcionados | `mutationContracts` 7/7. `mutateTransaction` 21/21. Suítes de caixa existentes (`contracts`, `createTransaction`, `periods`, `projection`, `projectionRecovery`, `rebuildFence`) e contrato de implantação: 118/118 junto com as novas |
| `npm run verify:fast` | Typecheck da raiz e das Functions: 0 erros. Lint das Functions: 0 erros e 1.961 avisos (sem mudança; nenhum aviso nos arquivos novos ou alterados). Build de produção. Unitários das Functions 385/385 (378 + 7). Frontend: 174/174, 128/128, 43/43 e 5/5 |
| `npm run test:integration:emulator` | Functions 437/437 (416 + 21). Ferramenta de limpeza 15/15. Rules 101/101 em 8 suítes (goals 5, investments 7, investment-domain 19, investment-m3 7, m4 39 com o teste novo, adjacent 5, workspaces 10, billing 9), sem mudança nas Rules |
| Mutação | 15 mutações detectadas (14 na primeira rodada; a 15ª depois da correção da âncora, com as duas mutações da âncora repetidas) |
| E2E | Não executado. O frontend não mudou, não chama as callables novas, e as Rules que ele usa não mudaram |

**Autorrevisão.** Corrigido antes do fechamento:
- **Âncora da trilha.** Com a chave expirada, a mesma chave com outro conteúdo respondia como replay do conteúdo antigo. Passou a comparar `requestHash` e ator, como a âncora da criação (P3-A), com teste e mutação.
- **Cobertura.** Faltava chamada não autenticada nas callables novas e teste de Rules para os estados produzidos (legado adotado, anulado pelo backend). Os dois foram acrescentados.
- **Testes.** Duas expectativas erradas no próprio teste novo:
  - investimento é recusado como tipo, antes do vínculo;
  - o auxiliar de seed usava `FieldValue.delete()` num `set` sem `merge`.

**Revisões especializadas** (uma vez cada, sobre o código estabilizado):

- `financial-domain-integrity`: **FAIL** no escopo de P3, pelos itens ainda abertos da P3, e não pela P3-C. A fatia P3-C não ficou com achado depois da autorrevisão:
  - centavos inteiros e conversão exata do legado;
  - data civil de São Paulo;
  - correção e anulação com histórico preservado, sem hard delete e sem reativação;
  - antes e depois em centavos na trilha append-only;
  - idempotência por intenção com âncora durável;
  - versão contra atualização perdida;
  - atomicidade (lançamento + evento + chave + contador) com falha injetada;
  - concorrência correção × correção e correção × anulação;
  - projeção e reconstrução iguais ao ledger depois de corrigir valor, mês e tipo e de anular;
  - PF/PJ explícito;
  - 15 mutações detectadas.

  O gate bloqueia por:
  1. o caminho legado do cliente continua escrevendo em `transactions` (cria, edita e anula sem centavos e sem trilha), mantido por decisão desta entrega (PR-TX-01/02/05);
  2. duas representações por fato (`value`/`valueCents`, `date`/`transactionDate`), que a P3-C ainda grava para os leitores atuais (PR-TX-03);
  3. sem detector agendado de deriva (P7).
- `multi-tenant-security-review`: **PASS** no escopo da P3-C.
  - Identidade: só do token verificado.
  - `workspaceId`: validado pela pré-checagem do kernel e pela releitura na transação; o documento com `workspaceId`/`profileId` de outro workspace é recusado (`workspace_mismatch`).
  - Papéis:
    - matriz owner/admin/member/viewer e não autenticado, testada;
    - member só altera o próprio;
    - removido, suspenso, arquivado, revogado e rebaixado depois da pré-checagem: todos recusados.
  - Entre tenants:
    - os dois sentidos testados;
    - ID de outro tenant no próprio workspace dá `not-found`;
    - o não membro é recusado antes de qualquer leitura do documento, sem enumeração.
  - Entrada:
    - schemas estritos, sem atribuição em massa;
    - o patch é montado de uma allowlist.
  - Idempotência ligada a ator, operação e conteúdo, inclusive depois da expiração da chave.
  - Rules como camada independente: o cliente não altera o legado adotado nem o anulado pelo backend e não grava `cash_events`, com teste novo de Rules; `cash_events` é lido só por owner/admin, nos dois tenants (teste da P3-A).
  - Trilha com ator, papel, workspace, alvo, `requestId`, correlação e instante do servidor.
  - Nenhum segredo e nenhum Storage tocados.
  - Achados da própria revisão, corrigidos antes do veredito:
    - âncora da trilha sem comparar o conteúdo;
    - ausência de teste de chamada não autenticada nas callables novas;
    - ausência de teste de Rules para os estados que a P3-C produz.
- `firestore-scale-cost-review`: não executada, sem justificativa para ela:
  - nenhuma consulta, listener ou índice novo;
  - leituras e escritas constantes por operação (acima);
  - o contador de limite reutiliza `rate_limits`, com o TTL já declarado na P3-B;
  - `cash_events` cresce um documento por correção ou anulação, como a criação.

**O que falta para PR-TX-01…05.**

| ID | Entregue até P3-C | Falta |
| --- | --- | --- |
| PR-TX-01 (BLOCKER) | Criação, correção e anulação no backend, com schema estrito, centavos, idempotência por intenção, versão e auditoria | Trocar o frontend para as três callables (chave por intenção, envio em voo bloqueado, `expectedUpdatedAt` lido do documento, conflito e erros em pt-BR); destino do lote (`createTransactionsBatch`); remover `addDoc`/`writeBatch`/`updateDoc`/baixa do cliente e o `create`/`update` das Rules (`write: false`); quota (D-40); E2E dos fluxos reais |
| PR-TX-02 (BLOCKER) | Lançamento da callable e legado adotado ficam fora do cliente (`cashEntry`) | Proteger os demais espelhos (fatura, recorrentes) e tirar os vínculos da allowlist do cliente; fecha com o `write: false` |
| PR-TX-03 (HIGH) | Sem mudança | Fórmula única; remover `value` em reais e a data dupla (a P3-C ainda grava `value` e `transactionDate` por compatibilidade) |
| PR-TX-04 (HIGH) | Sem mudança desde a P3-B | Crons (P4) e detector de deriva (P7) |
| PR-TX-05 (HIGH) | Trilha append-only de criação, correção e anulação feitas pelo backend, com antes e depois em centavos, motivo, intenção e correlação | O caminho legado do cliente edita e anula sem trilha até o `write: false`; trilha da reconstrução (TX-15) |

**Riscos residuais e decisões abertas.**
- O caminho legado do cliente continua escrevendo em `transactions`: cria, edita e anula sem trilha e sem centavos (PR-TX-01/02/05). O brief manteve esse caminho; ele sai na troca do frontend.
- D-29 (pendentes), D-30 (transferências), D-40 (quota, inclusive a devolução na anulação), TX-15, E-06, PR-AI-02/E-00, P4–P10 e REQ-FUT-01 seguem abertos.
- O motivo é texto livre do usuário e fica em `cash_events` sem TTL (owner/admin leem). Ele pode conter dado pessoal digitado; a retenção segue D-18 e o ciclo de vida de LGPD (P8).
- Nada disso é implantado antes de P6 (D-ORD-04).

**Próxima entrega de P3 (escopo).** Decidir D-40 (e D-29 se entrar pendente), implementar a quota atômica na criação e trocar o frontend de uma vez para criar, corrigir e anular pelas callables, sem mudança visual. Remover o write path do cliente e aplicar as Rules `write: false` em `transactions`, com testes de Rules e E2E dos fluxos reais.

**Rollback:** reverter o diff da P3-C:
- remover `functions/src/cash/{eligibility,mutateTransaction}.ts`, `functions/src/shared/commitTime.ts` e os dois testes novos;
- desfazer os acréscimos em `cash/contracts.ts`, `cash/callables.ts`, `cash/createTransaction.ts` (exports), `shared/audit.ts`, `shared/ids.ts`, `triggers/transactions.ts` (import do parser), `index.ts` e `deploymentContract.test.ts`;
- remover o teste de Rules P3-C.

Documentos já adotados guardam `cashEntry`/`valueCents` e ficam fora do cliente; em ambiente sem dados reais, recriar por seed.

### 18.4 P3-D — quota mensal autoritativa, importação segura e idempotência da correção (2026-10-04)

**Estado inicial.** Sobre o HEAD `37d8780` + working tree da P3-C (§18.3), na mesma branch. O ZIP `dindin-minhas-financas-p3c-2026-10-03.zip` (SHA-256 `843708f3…e420`) foi extraído e comparado com o checkout: idênticos fora dos arquivos ignorados. P0–P2, a UX-H1 e a P3-A/B/C estão preservados.

**Escopo e limites.**
- Mudaram o backend de caixa e de billing, um índice composto, os testes (Functions e um teste de Rules) e a documentação. Frontend e Rules não mudaram.
- Nada foi implantado, commitado ou enviado; Firebase só no Emulator `minhas-financas-local`; dados sintéticos.
- **P3 não está concluída**: o frontend ainda grava pelo caminho legado, então a quota protege só as callables novas, não o aplicativo inteiro.

**Decisão D-40 (tomada nesta entrega): quota mensal de lançamentos manuais por workspace, pelo plano efetivo do titular canônico.**
- **Limites:** Free 50, Pro 1.000, Business 10.000 por mês (catálogo v1, sem mudança de catálogo nem de preço).
- **Período:** mês civil de `America/Sao_Paulo` da criação efetiva, pelo relógio do servidor no momento da transação, não pela data financeira. Um lançamento retroativo consome o mês em que foi registrado.
- **Consomem:** a criação manual de receita ou despesa confirmada (`createCashTransaction`) e cada linha **nova** de uma importação bem-sucedida (`importCashTransactions`).
- **Não consomem:**
  - correção e anulação;
  - replay (pela chave ou pela âncora durável);
  - recusa e falha antes do commit;
  - linha de importação já registrada;
  - espelhos e registros automáticos de cartões, investimentos, empréstimos, recebíveis, divisão e recorrências (as regras comerciais deles ficam nos marcos de cada domínio).
- **A anulação não devolve** a unidade consumida na criação.
- **Downgrade e transferência:**
  - o downgrade não apaga nem desfaz nada, só barra novas criações acima do limite vigente;
  - a transferência de titularidade passa a aplicar o plano do novo titular e mantém o contador e o histórico do workspace;
  - nenhuma das duas é bloqueada pelo uso do mês.
- **Não é o limite operacional.** O limite de frequência (120 criações ou correções a cada 10 minutos por ator, e 12 lotes de importação a cada 10 minutos) protege o backend de laços e scripts e vale para qualquer plano.

**Contador autoritativo** (`functions/src/billing/transactionQuota.ts`):
- **Estado server-only, com IDs estáveis e `schemaVersion` 1** (as Rules já negavam `workspaces/{id}/quota_state/*`; teste novo de Rules cobre os documentos novos):
  - `workspaces/{id}/quota_state/transactions`, a âncora: `trackingSince` (`YYYY-MM`), `origin` (`workspace_created` ou `backfill`) e `initialUsed`;
  - `workspaces/{id}/quota_state/transactions_{YYYY-MM}`, as unidades usadas no mês.
- **A âncora nasce com o workspace**, na mesma transação de `bootstrapAccount` (inclusive a restauração do espaço pessoal) e de `createWorkspace` (`functions/src/workspaces/lifecycle.ts:224,327`). A transferência não toca no contador.
- **Ordem na criação** (`functions/src/cash/createTransaction.ts`):
  1. relê a autorização;
  2. confere a chave e a âncora durável do lançamento;
  3. reserva o limite operacional;
  4. com `reserveTransactionQuota` (`transactionQuota.ts:209`), lê num único `getAll` o membership do titular canônico, o billing dele, a âncora e o contador do mês;
  5. reavalia o entitlement com o relógio do servidor (`entitlementAt`, o mesmo motor da P2B, sem segunda autoridade de plano);
  6. confere `usado + 1 <= limite`;
  7. grava o contador no mesmo commit do lançamento, do evento e do recibo.

  O lançamento leva `cashEntry.quotaPeriod`, o mês consumido.
- **Concorrência no último slot:** as criações leem o mesmo documento do mês; a perdedora é repetida, relê e é recusada. Nenhuma contagem da coleção, nenhuma leitura de lançamentos.
- **Mensagens em pt-BR:**
  - para o titular: "Este espaço atingiu o limite de lançamentos do seu plano neste mês. Faça upgrade em Meu Plano ou aguarde o início do próximo mês.";
  - para o não titular, sem sugerir upgrade da própria conta e sem o uso nos detalhes: "Este espaço atingiu o limite mensal de lançamentos do plano do titular. Fale com o titular do espaço ou aguarde o início do próximo mês.".

  O código é `resource-exhausted`. Os detalhes trazem `resource`, `planId`, `limit` e `periodKey`; `used` vai só para o titular, e `requested` aparece na importação.
- **Estado ausente ou incoerente falha fechado** com "Não foi possível verificar os limites do plano…": sem âncora, âncora de outro workspace, mês anterior ao rastreio, contador malformado, billing ausente ou titular incoerente. **A ausência do contador nunca vale como consumo zero.**

**Inicialização de workspaces anteriores à P3-D** (`functions/src/cash/quotaBackfill.ts`, só Emulator):
- Workspace sem âncora não cria pela callable até ser inicializado.
- O procedimento lê o mês corrente do ledger por `createdAt`, paginado: página de até 500, teto de 20.000 documentos e recusa sem gravar acima do teto. Classifica cada documento pelo critério **conservador** e cria a âncora (`origin: backfill`, `initialUsed`) e o contador do mês com o valor contado.
- **O que conta:** lançamento da callable ou importado, legado adotado, legado do cliente confirmado e, por precaução, o pendente (D-29 segue aberta). O anulado também conta, porque a anulação não devolve.
- **O que não conta:** espelho de backend, vínculo com outro domínio, origem automática e autor de sistema.
- **Modos:** simulação (`dryRun`) e execução idempotente; com a âncora presente, nada é gravado e o relatório mostra a divergência entre ledger e contador.
- Recusa qualquer ambiente que não seja o Emulator `minhas-financas-local` e não é exportado como Function.
- **Pré-requisito obrigatório do rollout:** enquanto o caminho legado do cliente gravar em `transactions`, ele cria lançamentos fora do contador (testado: a reconciliação mostra divergência 1). A inicialização em ambiente real só vale junto com a troca do frontend e as Rules `write: false`, e com um runner autorizado para STAGING/PROD (P6). Documentos sem `createdAt` do servidor não entram na leitura por mês.

**Importação autoritativa** (`importCashTransactions`; contrato em `functions/src/cash/contracts.ts`, executor em `functions/src/cash/importTransactions.ts:154`):
- **Entrada:** `workspaceId`, `idempotencyKey` (do lote), `importId` (da importação inteira, gerado pelo cliente), `correlationId?` e `items` (1 a **50** por lote).
- **Cada item:** `lineId` estável (até 64 caracteres `[A-Za-z0-9_-]`, único no lote), mais o mesmo contrato estrito da criação — sem autor, centavos autoritativos, vínculos, parcelas, `isPaid`, origem ou campo desconhecido. Fornecedor e centro de custo só em PJ (o lote inteiro é recusado, com `lineId` nos detalhes).
- **Identidade de cada linha:** `cashimp_` + hash de `(workspace, ator, importId, lineId)`. A linha guarda o hash do próprio conteúdo (`cashEntry.requestHash`), o canal (`channel: import`) e a referência da importação (`importRef`).
- **Linha já existente:** com o mesmo conteúdo é reconhecida (`already_imported`), sem nova escrita nem consumo; com outro conteúdo, o lote inteiro é recusado ("Uma linha desta importação já foi registrada com outros dados…"). A identidade não depende do lote, então a proteção contra duplicação vale enquanto o lançamento existir (lançamentos não são apagados), além da chave do lote (90 dias).
- **Quota:** todas as unidades novas do lote de uma vez (`requested`). Se não couberem, nada é criado.
- **Atomicidade por lote, não da importação inteira.** Um arquivo maior é enviado em vários lotes com o mesmo `importId`; refazer um lote que falhou ou reenviar lotes já aplicados só cria o que falta.
- **Resultado:** `importId`, `replayed`, `created`, `alreadyImported`, `periodKey`, a lista por linha (`lineId`, `transactionId`, `status`) e um resumo em pt-BR (por exemplo, "2 lançamentos importados; 2 já estavam registrados.").
- **Auditoria:** um evento `cash_entry.created` por linha, com `channel: import`.
- Nenhuma chamada externa dentro da transação. Até 62 leituras (com a pré-checagem do kernel) e 103 escritas por lote de 50.
- **O que a importação não migra.** O `createTransactionsBatch` atual do frontend só gera parcelas de cartão (`type: parcelado`, `cardId`), do domínio de cartões (P4), em `TransactionModal` e `SplitGroupDetailsView`. Essas parcelas são recusadas por este contrato e não migram para ele.

**Idempotência da correção e da anulação (lacuna da P3-C comprovada e corrigida).**
- **Contrato:** a chave é do **ator** e identifica **uma** intenção de **uma** operação.
  - Enquanto o recibo existe (90 dias): mesmo conteúdo é replay; outro conteúdo, outro lançamento ou outro workspace é conflito.
  - Depois da expiração, a âncora é a trilha `cash_events`.
- **Lacuna comprovada:** a âncora era procurada só pelo ID `(intenção, operação, lançamento)`. Com o recibo expirado, a mesma chave reaproveitada em **outro lançamento** ou **outro workspace** era aplicada como intenção nova. Os testes novos falharam 2/7 antes da correção.
- **Correção:** `loadForMutation` procura o evento da intenção em todos os workspaces, por consulta de grupo `cash_events where intentId == … and operation == … limit 1`, com o índice composto de grupo `(intentId, operation)` declarado em `firestore.indexes.json`. Mesmo conteúdo, ator, workspace e lançamento é replay; qualquer outro é conflito.
  - Nenhum payload financeiro novo é guardado: o evento já é append-only e permanente (sem TTL, D-18).
  - Os eventos já gravados continuam servindo de âncora.
  - Se D-18 vier a definir prazo para `cash_events`, a garantia passa a valer por esse prazo.
- **Correção sem mudança** não grava evento, porque não há efeito a proteger. Depois da expiração ela é reavaliada:
  - lançamento igual: a mesma resposta (`changed: false`), sem escrita;
  - lançamento alterado desde a versão lida: conflito de versão.

  Em nenhum caso há efeito duplicado.
- **Concorrência:** com a mesma chave, só uma aplicação e um evento; depois da expiração, o replay legítimo e as reutilizações indevidas em paralelo não gravam nada.

**Garantias comprovadas por teste (Emulator).**

| Situação | Resultado | Suíte |
| --- | --- | --- |
| Limites Free, Pro e Business | A última unidade passa; a seguinte é recusada com detalhes exatos | `transactionQuota` |
| Não titular no limite | Mensagem para procurar o titular, sem `used` e sem "upgrade" | `transactionQuota` |
| Dois workspaces do mesmo titular | Contadores independentes | `transactionQuota` |
| Último milissegundo do mês e primeiro do seguinte em São Paulo | Mês corrente cheio; mês novo do zero; `quotaPeriod` de cada lançamento | `transactionQuota` |
| Retroativo (data de agosto registrada em outubro) | Consome outubro | `transactionQuota` |
| 5 criações simultâneas na última unidade | Uma passa; contador no teto; uma linha no ledger | `transactionQuota` |
| Replay pela chave e pela âncora, inclusive com a quota cheia | Sem consumo | `transactionQuota` |
| Falha injetada antes do commit | Sem consumo nem lançamento; a mesma intenção aplica depois | `transactionQuota` |
| Correção e anulação | Sem consumo e sem devolução | `transactionQuota` |
| Downgrade com uso 60 > 50 | Criação recusada; dados intactos; correção possível | `transactionQuota` |
| Transferência Free → Pro e Pro → Free | Plano do novo titular; contador mantido; transferência não bloqueada | `transactionQuota` |
| Suspensa, removido, viewer, arquivado | Recusados sem consumo | `transactionQuota` |
| Estado de quota ausente ou incoerente (6 formas) | `internal`, sem lançamento | `transactionQuota` |
| Workspace novo (bootstrap e `createWorkspace`) | Âncora do mês em zero; primeira criação conta 1 | `transactionQuota` |
| Limite operacional cheio | Recusa sem tocar a quota; outro ator cria | `transactionQuota` |
| Dois titulares | Nada de uso ou plano de outro titular; acesso cruzado negado | `transactionQuota` |
| Lote válido PJ | 3 linhas, auditadas, contadas, com canal e referência | `importTransactions` |
| Lote vazio, excessivo, linha inválida (com caminho), repetida, forjada, PJ-only em PF | `invalid-argument`, nada gravado | `importTransactions` |
| Viewer, não membro, não autenticado, dois sentidos entre tenants, removido, suspenso, rebaixado na transação, arquivado | Recusados, nada gravado | `importTransactions` |
| Quota insuficiente para o lote | Nenhuma linha; `requested`; as que cabem passam | `importTransactions` |
| Repetição do lote; chave com outros dados | Replay idêntico; conflito | `importTransactions` |
| Lotes sobrepostos; linha com outro conteúdo; outra importação | Só as novas contam; lote inteiro recusado; outra identidade | `importTransactions` |
| Arquivo de 120 linhas em 3 lotes, o 2º falha | Atomicidade por lote; retomada completa; reenvio sem duplicar | `importTransactions` |
| Lotes concorrentes sobrepostos; nas últimas unidades | Soma de `created` = ledger = contador; só o que cabe | `importTransactions` |
| Linha importada | Corrigível e anulável sem consumo; entra na projeção uma vez, igual ao ledger, com reentrega | `importTransactions` |
| Limite da importação no teto | Recusa; replay passa sem consumir | `importTransactions` |
| Legado sem âncora | Falha fechado; simulação conta 6 de 10 pelo critério; execução inicializa; idempotente; divergência visível | `quotaBackfill` |
| Legado com 49 no mês | Só 1 criação a mais | `quotaBackfill` |
| Teto de leitura e paginação | Acima do teto nada é gravado; no teto exato pagina e conta | `quotaBackfill` |
| Mesma chave e mesmo conteúdo após expiração (correção e anulação) | Replay | `mutationIdempotency` |
| Mesma chave e outro conteúdo, outro lançamento, outro workspace | Conflito, antes e depois da expiração | `mutationIdempotency` |
| Correção sem mudança após expiração | Mesma resposta sem escrita; conflito se o lançamento mudou | `mutationIdempotency` |
| Concorrência na mesma chave | Um efeito, um evento | `mutationIdempotency` |
| Âncoras de criação e histórico | `requestHash`, `quotaPeriod` e `createdAt` intactos | `mutationIdempotency` |
| Cliente sobre a âncora e o contador | Não lê, não grava, não apaga, não altera | Rules `billing-p2` |

**Testes provados contra o defeito.** 17 mutações, todas detectadas:

| Mutação | Testes que pegaram |
| --- | --- |
| Sem checagem de limite | 12 (quota e importação) |
| Contador não gravado | 14 |
| Sem âncora vale zero | 3 (unitário, inicialização, estado ausente) |
| Mensagem de titular para todos | 3 |
| Relógio do servidor ignorado | Virada de mês |
| Replay consome | Replay |
| Workspace criado sem âncora | Workspace novo |
| Lote consome uma unidade | 7 |
| Linha com outro conteúdo aceita | Lotes sobrepostos |
| Identidade da linha pela chave do lote | 3 (sobreposição, retomada, concorrência) |
| Linha já importada consome | 2 |
| Âncora da correção só no lançamento (lacuna da P3-C) | Outro lançamento, outro workspace |
| Inicialização não conservadora (sem pendentes) | 2 |
| Simulação grava | Inicialização |
| Inicialização sem teto | Teto de leitura |
| Plano do ator em vez do titular | 5 |
| Âncora de criação consome quota | Replay |

**Custo.**
- **Criação:** 13 leituras, contando a pré-checagem do kernel (antes 9), e 5 escritas (antes 4): o membership do titular, o billing, a âncora e o contador entram no mesmo `getAll`. Replay sem mudança.
- **Correção e anulação:** a leitura do evento por ID virou uma consulta de grupo de igualdade com `limit 1`, que custa uma leitura mesmo vazia; o custo total não muda.
- **Importação de *n* linhas:** *n* + 12 leituras (com a pré-checagem do kernel) e 2*n* + 3 escritas por lote (*n* ≤ 50), mais uma entrega do gatilho por linha.
- **Contenção:** o contador mensal é um documento por workspace e mês, com no máximo 10.000 incrementos/mês no Business. O limite de 12 lotes a cada 10 minutos mantém a importação de um ator perto de 1 escrita/s no documento mensal da projeção (P3-B).
- **Crescimento:** um contador por workspace e mês, sem TTL. É registro de uso comercial, como `ai_usage`; o ciclo de vida fica em P8.
- **Índices:** o índice de grupo novo só indexa os eventos de correção e anulação, os únicos com `intentId`.

**Validação.**

Emulator `minhas-financas-local`; logs fora do repositório. As contagens abaixo são da execução final, sobre o código final.

| Etapa | Resultado |
| --- | --- |
| Direcionados | `p3dContracts` 7/7. `transactionQuota` 18/18. `importTransactions` 13/13. `quotaBackfill` 3/3. `mutationIdempotency` 7/7, que falhou 2/7 antes da correção da âncora. Suítes da P3-A/C afetadas: `createTransaction` e `mutateTransaction` verdes, com a asserção exata de `cashEntry` acrescida de `quotaPeriod` |
| `npm run verify:fast` | Typecheck da raiz e das Functions: 0 erros. Lint das Functions: 0 erros e 1.961 avisos (sem mudança; nenhum aviso nos arquivos novos ou alterados). Build de produção. Unitários das Functions 392/392 (385 + 7). Frontend: 174/174, 128/128, 43/43 e 5/5 |
| `npm run test:integration:emulator` | Functions 478/478 (437 + 41). Ferramenta de limpeza 15/15. Rules 102/102 em 8 suítes (goals 5, investments 7, investment-domain 19, investment-m3 7, m4 39, adjacent 5, workspaces 10, billing 10 com o teste novo), sem mudança nas Rules |
| Mutação | 17 mutações detectadas. As 4 da importação foram repetidas sobre o código final, depois do ajuste do limite operacional |
| E2E | Não executado. O frontend não mudou e não chama as callables novas. Rules e projeção lidas pela UI são as mesmas; o índice novo só serve ao backend |

**Autorrevisão e revisões.** Corrigido antes do fechamento:
- **Limite operacional da importação.** Era de 30 lotes a cada 10 minutos; ficou em 12, pela contenção do documento mensal da projeção.
- **Testes negativos da importação.** Faltavam membro removido, conta suspensa, rebaixamento dentro da transação, workspace arquivado e os dois sentidos entre tenants.
- **Efeito na projeção.** Faltava o teste da linha importada na projeção, com reentrega e comparação com o ledger.
- **Testes.** Duas expectativas dos testes novos foram ajustadas ao contrato correto: as chaves dos detalhes de quota não têm `reason`, e o seed da P3-C de `isPaid` foi refeito.

**Revisões especializadas** (uma vez cada, sobre o código estabilizado):

- **`billing-entitlement-integrity`: FAIL**, no escopo da P3-D.
  - **A fatia implementada passa:**
    - mesmo motor de entitlement (`entitlementAt`), sem segunda autoridade de plano;
    - verificação e contador na mesma transação da criação, com concorrência no limite testada;
    - downgrade e transferência com regra definida e testada;
    - mensagens em pt-BR com próxima ação, e o não titular orientado ao titular;
    - contador negado ao cliente nas Rules, com teste;
    - estado ausente falha fechado;
    - importação limitada por plano (unidades) e por frequência;
    - 17 mutações detectadas.
  - **O gate bloqueia porque o recurso sujeito a quota ainda é criado diretamente pelo cliente:** `addDoc` e `writeBatch` em `src/modules/transactions/api.ts:258,274`, permitidos pelo `create` das Rules de `transactions`.
  - **Remediação:** a troca do frontend para as callables com `write: false` (próxima entrega).
  - **Fora do escopo desta avaliação:** checkout, webhook, portal, segredos e evidência externa do Stripe (P2, sem mudança; E-06).
- **`financial-domain-integrity`: FAIL** no escopo de P3, pelos itens ainda abertos da P3, e não pela P3-D.
  - **A fatia P3-D não ficou com achado depois da autorrevisão:**
    - importação atômica por lote;
    - identidade por linha estável entre lotes;
    - retomada sem duplicar;
    - falha injetada sem efeito;
    - concorrência sobre linhas sobrepostas e nas últimas unidades;
    - linha importada corrigível, anulável e somada uma vez na projeção, igual ao ledger;
    - âncora de idempotência da correção e da anulação sem segunda aplicação entre lançamentos ou workspaces;
    - centavos inteiros e data civil de São Paulo.
  - **Achado da própria revisão, corrigido antes do veredito:** faltava teste do efeito derivado da importação na projeção.
  - **O gate bloqueia por:**
    1. o caminho legado do cliente continua escrevendo em `transactions` (PR-TX-01/02/05);
    2. duas representações por fato (`value`/`valueCents`, `date`/`transactionDate`, PR-TX-03);
    3. sem detector agendado de deriva (P7).
- **`firestore-scale-cost-review`: PASS** depois de uma correção feita na própria revisão.
  - **Correção:** o limite da importação caiu de 30 para 12 lotes a cada 10 minutos, para que um ator não sustente mais de ~1 escrita/s no documento mensal da projeção.
  - **Consultas:**
    - nenhuma consulta de cliente nova;
    - a consulta de grupo é só do backend, de igualdade sobre um hash do ator com `limit 1`, servida pelo índice composto declarado;
    - nenhuma contagem de coleção.
  - **Custo:** constante por criação e por lote.
  - **Crescimento:** contador limitado a um documento por workspace e mês.
  - **Inicialização:** paginada com cursor, teto e recusa acima dele; cobre a fronteira de página no Emulator.
- **`multi-tenant-security-review`: PASS**, depois de acrescentar, na própria revisão, os testes negativos da importação: removido, suspenso, rebaixado dentro da transação, arquivado e os dois sentidos entre tenants.
  - **Importação:** token verificado; `workspaceId` relido na transação; viewer e não membro recusados; atribuição em massa impossível pelo schema estrito e pela allowlist do documento.
  - **Idempotência:** a chave está ligada a ator, operação e conteúdo, e a identidade da linha inclui workspace e ator.
  - **Consulta de grupo:** só acha eventos do próprio ator (hash do uid) e nunca devolve dado de outro workspace (conflito genérico, ou replay só para o mesmo workspace e lançamento).
  - **Quota sem vazamento entre titulares:** o uso vai só para o titular, e o membro de A não cria em B.
  - **Rules:** o contador e a âncora ficam fora do cliente, com teste.

**Riscos residuais e dependências da troca da interface.**
- **A quota não está protegida no aplicativo inteiro.** O frontend legado ainda cria lançamentos direto no Firestore (`addDoc`, `writeBatch`), sem contador. A quota autoritativa vale só para `createCashTransaction` e `importCashTransactions` até a troca do frontend com `write: false`.
- **Indicadores e mensagens do frontend precisam mudar na troca.** Hoje a UI conta lançamentos pela **data financeira** no mês carregado, espelhos incluídos (`src/components/TransactionsView.tsx:97-121`; `src/components/RecentTransactions.tsx:47-57`) e mostra mensagens próprias de limite.
  - Na troca, o consumo exibido deve vir do contador do backend, pelo mês de registro e só com o que consome.
  - Isso exige uma leitura server-side do uso do workspace, por exemplo um campo em `getWorkspaceEntitlement`, que ainda não existe.
  - As mensagens de limite passam a ser as do backend.
- **Workspaces existentes sem âncora** não criam pela callable até serem inicializados. O procedimento existe só para o Emulator; o runner autorizado para STAGING/PROD é de P6, depois da troca do frontend.
- **Abertos:** D-29 (pendentes, agendados, competência), D-30 (contas e transferências), TX-15, E-06, PR-AI-02/E-00, os achados de acessibilidade pendentes, P4–P10 e REQ-FUT-01 (visualização financeira por tempo de trabalho).

**Próxima entrega de P3 (escopo).** Integrar a UI às operações autoritativas, de uma vez e sem mudança visual:
- criar, corrigir e anular pelas três callables (chave por intenção, envio em voo bloqueado, `expectedUpdatedAt` lido do documento, conflitos e erros em pt-BR);
- importação pelo contrato em lotes, se a funcionalidade for exposta;
- indicador de consumo e mensagens de limite vindos do backend;
- decidir o destino das parcelas de cartão hoje geradas por `createTransactionsBatch` (P4);
- remover o write path do cliente e aplicar as Rules `write: false` em `transactions`, com testes de Rules e E2E dos fluxos reais;
- inicializar os workspaces existentes pelo procedimento desta entrega no mesmo rollout.

**Rollback:** reverter o diff da P3-D:
- remover `billing/transactionQuota.ts`, `cash/importTransactions.ts`, `cash/quotaBackfill.ts` e os cinco testes novos;
- desfazer os acréscimos em `billing/quota.ts`, `cash/createTransaction.ts`, `cash/contracts.ts`, `cash/callables.ts`, `cash/mutateTransaction.ts`, `workspaces/lifecycle.ts`, `shared/audit.ts`, `shared/ids.ts`, `index.ts`, `deploymentContract.test.ts`, `createTransaction.integration.test.ts`, `kernelTestSupport.ts`, `firestore.indexes.json` (índice de grupo) e no teste de Rules `billing-p2`.

As âncoras e os contadores gravados ficam sem leitor e podem ser ignorados. Sem os contadores, a criação volta a não ter quota comercial.

### 18.5 P3-E — caixa manual pela interface e preparação segura da migração (2026-10-04)

**Estado inicial.** Sobre o HEAD `37d8780` + working tree da P3-D (§18.4), na mesma branch. O ZIP `dindin-minhas-financas-p3d-2026-10-04.zip` (SHA-256 `436b026f…bffe`) foi extraído e comparado com o checkout: idênticos fora dos arquivos ignorados, inclusive os não rastreados. As quatro callables de caixa, `transactionQuota.ts`, a inicialização e §18.4 estavam como entregues. P0–P2, a UX-H1 e a P3-A/B/C/D estão preservados.

**Escopo e limites.**
- Mudaram o frontend do formulário de lançamento (criação, correção e anulação manuais), o indicador de quota, a leitura de quota no backend, a inicialização de workspaces antigos, os testes (unitários, integração, E2E) e a documentação. Rules e índices não mudaram.
- Sem mudança visual além do estritamente necessário: o campo "Motivo da correção" na correção autoritativa, a confirmação "Anular lançamento" com motivo e a mensagem de erro dentro do formulário. Botões, textos de limite e navegação são os de antes.
- Nada foi implantado, commitado ou enviado; Firebase só no Emulator `minhas-financas-local`; dados sintéticos.
- **P3 não está concluída**: produtores de outros domínios e a despesa pendente continuam no caminho legado do cliente, então as Rules de `transactions` ainda não podem negar a escrita do cliente.

**Fluxos migrados (pela interface, sem fallback local).**
- **Criação** de receita e de despesa paga com data até hoje em São Paulo, pelo formulário comum (`src/components/TransactionModal.tsx`), via `createCashTransaction`:
  - adaptador puro e tipado (`src/modules/transactions/cashEntry.ts`): valor em texto decimal → centavos inteiros exatos (`parseDecimalAmountToCents`, sem ponto flutuante, até 12 dígitos inteiros e 2 decimais, teto igual ao do backend); opcionais vazios omitidos; fornecedor e centro de custo só em PJ; campos de tipo só do tipo;
  - chave de idempotência **por intenção** (`resolveIntentKey`): o reenvio do mesmo conteúdo reusa a chave; conteúdo novo ou nova abertura do formulário gera outra. O cliente nunca gera chave nova para reenviar uma operação de resultado incerto;
  - duplo envio bloqueado por referência síncrona e botão desabilitado durante o envio;
  - o ID é o do servidor; depois do sucesso, invalidação das consultas de lançamentos, dependentes e do entitlement do workspace (`src/modules/transactions/hooks.ts`);
  - nenhuma gravação local no Firestore e nenhum fallback para o caminho legado quando a callable falha.
  - **política de intenção:** depois de erro, o formulário fica aberto com o mesmo conteúdo e a mesma chave, e a mensagem orienta a salvar de novo (o reenvio não duplica). Fechar o formulário encerra a intenção: uma nova abertura é uma operação nova, com chave nova, porque dois lançamentos idênticos e legítimos não podem ser fundidos. A anulação segue a mesma regra e é idempotente por estado (anular de novo recebe "já anulado").
- **Correção** de lançamento elegível (da callable ou legado manual inequívoco, `isManualCashEntryCandidate`, espelho conservador da elegibilidade do backend), via `updateCashTransaction`:
  - envia o estado completo e `expectedUpdatedAt` com **nanossegundos** (`expectedUpdatedAtOf`, a partir de `seconds`/`nanoseconds` do `Timestamp`, sem `Date.toISOString`);
  - motivo obrigatório (D-35), até 300 caracteres;
  - lançamento confirmado não volta a pendente por aqui (D-29 aberta): recusa local em pt-BR.
- **Anulação** de lançamento elegível, via `voidCashTransaction`: confirmação com justificativa obrigatória (`ConfirmationModal` com motivo); o lançamento sai da tela só depois da resposta do servidor (leitura já ignora `voidedAt`).
- **Erros** (`cashErrorView`): conflito de versão, perda de autorização, sessão, quota, já anulado, outro domínio, legado ambíguo, idempotência e resultado incerto viram orientação em pt-BR. Sem corpo de erro do servidor, o SDK põe o código ou um texto em inglês na mensagem; isso nunca chega à interface (achado e corrigido nesta entrega).

**Fluxos que continuam no caminho legado (escritores ativos, um a um).**
| Produtor | Caminho | Motivo |
| --- | --- | --- |
| Despesa pendente e lançamento com data futura no formulário | `onAddTransaction` → `addDoc` (`src/modules/transactions/api.ts:258`) | D-29 aberta (pendentes, agendados, competência) |
| Correção de lançamento não elegível (pendente, outro domínio, formato ambíguo para o cliente) | `onUpdateTransaction` → `updateDoc` | Fora do contrato da correção autoritativa |
| Baixa de lançamento não elegível | baixa lógica do cliente (`voidedAt`) | Idem |
| Compra parcelada sem cartão de domínio | `createTransactionsBatch` (`writeBatch`) | Cartões (P4) |
| Divisão de contas: integração e reembolso | `SplitGroupDetailsView` → `handleAddTransaction` | Divisão (P4) |
| Confirmação de ocorrência recorrente | `RecurringExpenseDetailsView` → `handleAddTransaction` | Recorrentes (P4) |
| Empréstimos PF/PJ | `LoanDetailsView`/`PJLoanDetailsView`, `LoansView`/`PJLoansView` | Empréstimos (P3, D-13) |
| Espelhos do backend (investimentos, fatura, cron recorrente) | Admin SDK | Já autoritativos no backend; fora do contrato manual |

Os produtores de outros domínios usam `handleAddTransaction`, que não foi alterado: nenhum fluxo de outro domínio chega à callable manual.

**Leitura da quota no backend** (`getWorkspaceEntitlement` → `transactionsQuota`; `functions/src/billing/workspaceEntitlement.ts`):
- `status` (`available` | `not_initialized` | `unavailable`), `periodKey` (mês de São Paulo pelo relógio do servidor), `limit`, `used`, `remaining`, `exhausted`;
- um único `getAll` (billing do titular, âncora e contador do mês); qualquer membro ativo do workspace (o wrapper relê a membership);
- **visibilidade por papel** (P2B): `used` e `remaining` só para o titular; os demais papéis recebem só `exhausted`; workspace sem âncora → `not_initialized`; estado incoerente → `unavailable`; nos dois casos `used`, `remaining` e `exhausted` são `null` (desconhecido nunca é zero);
- o indicador da interface (`src/modules/billing/transactionsQuota.ts`) desabilita "Nova Transação" só quando o backend informa `exhausted: true`; desconhecido não bloqueia. É ajuda de UX: o backend decide de novo em cada criação. As mensagens distintas para titular ("Upgrade!") e não titular ("Peça ao titular do espaço.") são as de antes. A contagem local pela data financeira foi removida de `TransactionsView` e `RecentTransactions`;
- atualização depois de criar (invalidação do entitlement) e na troca de workspace ou de titularidade (chave da consulta por usuário e workspace; a transferência já invalidava o prefixo).

**Inicialização de workspaces antigos endurecida** (`functions/src/cash/quotaBackfill.ts`, só Emulator):
- **Documento sem `createdAt` do servidor**: a leitura do mês por `createdAt` não o vê. A inicialização agora mede o histórico inteiro por agregação (`count` total × `count` com `createdAt` Timestamp) e, havendo documento sem data, **recusa** (`blocked`, `undated_documents`), sem inferir o mês pela data financeira. A auditoria administrativa (`auditUndatedTransactions`, varredura por ID com orçamento, teto 200.000) lista amostras para decisão; só com `acceptUndatedAsConsumed` explícito os documentos sem data contam no mês corrente (conservador: consomem).
- **Documento ambíguo** (origem desconhecida, autor ausente ou não textual, chave fora da allowlist legada): recusa (`ambiguous_documents`), salvo `acceptAmbiguousAsConsumed`.
- **Teto de custo**: acima do teto da leitura mensal, recusa (`limit_exceeded`) sem gravar.
- **Cerca de concorrência**: a gravação recontará, dentro da transação, o mês e o histórico; qualquer criação, importação ou documento novo entre a leitura e a gravação → `concurrent_change`, nada gravado.
- Simulação com relatório (`history`, `breakdown`, `blockers`, notas em pt-BR); execução idempotente (âncora presente → nada gravado, divergência reportada); nenhuma quota extra silenciosa (sem âncora não há criação).
- **Pré-requisito operacional:** a inicialização real precisa do frontend migrado, dos produtores legados remanescentes tratados e de um runner autorizado para STAGING/PROD (P6). Nenhum runner de produção foi criado.

**Rajada de importação** (`functions/src/cash/__tests__/importBurst.integration.test.ts`, Emulator):
- 12 lotes × 50 linhas de 2 atores (plano Business), concorrentes; lotes abortados por contenção repetidos com a mesma chave;
- depois, 1.200 entregas (cada evento duas vezes) ao gatilho da projeção com paralelismo 20 (o `maxInstances` do gatilho);
- resultado: 600 lançamentos, quota 600, 600 eventos e projeção igual ao ledger nos 3 meses; nenhuma perda nem duplicação; 0 lotes abortados, 0 entregas com falha, 1.200 entregas em ~19 s.
- **Limite médio × concorrência instantânea × capacidade testada:** o limite operacional é de 12 lotes a cada 10 minutos por ator (média ≤ 1 lote/50 s); a concorrência instantânea possível é de 12 lotes simultâneos por ator; a capacidade testada é 2 atores × 6 lotes simultâneos e 20 entregas paralelas no mesmo documento mensal, no Emulator. Não é prova de capacidade do Firestore real, que limita ~1 escrita/s sustentada por documento; o gatilho repete com recuo (P3-B). Nenhuma correção foi necessária; quota comercial inalterada.

**Testes provados contra o defeito.** 14 mutações, todas detectadas (código restaurado e recompilado depois de cada uma):
- **frontend** (`tests/unit/cash-entry.test.ts`): centavos com três casas aceitas; chave nova a cada envio; estado desconhecido bloqueando; mensagem crua do SDK exibida; versão com milissegundos em vez de nanossegundos; campo PJ aceito em PF; conflito sem recarregar a lista;
- **backend** (Emulator): uso exato para qualquer papel; workspace sem âncora como uso zero; fronteira do esgotamento (`>` no lugar de `>=`); documento sem data não bloqueando; documento ambíguo não bloqueando; cerca sem recontagem; aceite de documentos sem data sem consumo.
- Uma mutação inicial de PJ era equivalente (a guarda anterior já recusava) e foi trocada por uma que remove a guarda; uma da cerca não compilava e foi refeita compilável.

**Testes novos e ajustados.**
- **Unitários do frontend** (`tests/unit/cash-entry.test.ts`, 11, script `test:unit:cash` em `verify:fast`): vetores de centavos (zero, negativo, três casas, notação científica, teto), elegibilidade e "hoje" em São Paulo, candidatos à correção, versão com nanossegundos, payloads estritos (opcionais omitidos, PJ só em PJ), chave por intenção, mapeamento de erros (incluindo textos do SDK), escopo de recarga, indicador de quota e cliente das callables.
- **Integração no Emulator:** `quotaRead` (5: papéis, atualização depois de criação e importação, não inicializado e incoerente, isolamento entre titulares, transferência), `quotaBackfillHardening` (4: sem `createdAt`, ambíguo, mudança concorrente no mês e no histórico, orçamento da auditoria) e `importBurst` (1); ajustes de forma exata em `quotaMembers`, `aiCredits`, `quotaBackfill` e `p3dContracts`.
- **E2E** (`e2e/cash-manual-entries.spec.ts`, 6, Emulator com Auth, Firestore e Functions reais, fuso de São Paulo): criação com duplo envio e reenvio incerto (mesma chave, um lançamento, quota +1 uma vez) e despesa pendente no caminho atual; correção com conflito, versão com nanossegundos e motivo obrigatório, e anulação com justificativa; quota esgotada para titular e para membro (com recusa do backend); espaço sem contador (tela livre, backend fechado) com troca de espaço sem vazamento; perda de acesso entre abrir e salvar. As seeds do E2E passaram a criar a âncora da quota, como `createWorkspace` (`e2e/support/workspaceSeed.ts`).

**Validação (resultados atuais, desta entrega).**
- `npm run verify:all` integral: **PASS** (código de saída 0).
  - `verify:fast`: typecheck do frontend e das Functions; lint das Functions com 0 erros (1.961 avisos, nenhum nos arquivos da P3-E); build do frontend e das Functions; unitários das Functions 392/392; frontend: investimentos 174/174, P1 128/128, billing 43/43, UI 5/5, caixa 11/11.
  - `test:integration:emulator`: integração das Functions **488/488**; guarda da ferramenta de limpeza 15/15; Rules 102/102 (metas 5, investimentos 7, domínio de investimentos 19, M3 7, M4 39, adjacentes 5, workspaces 10, billing 10).
  - `test:e2e`: **58/58**.
- Os números históricos da P3-D (integração 478, Rules 102) foram substituídos pelos acima; nenhuma suíte com `skip`/`only`, nenhum timeout aumentado, nenhuma repetição artificial.
- Evidência visual (spec temporário, removido depois da captura): 2/2, desktop e celular.

**Autorrevisão e revisões.** Corrigido antes do fechamento:
- **Mensagem crua do SDK na interface:** sem resposta do servidor (rede, proxy, resposta inválida), o SDK de Functions põe o código (`internal`) ou um texto fixo em inglês na mensagem, e o formulário mostraria "internal". Agora só a mensagem escrita pelo backend chega à tela; o resto vira o texto padrão em pt-BR de cada caso (teste unitário com os três textos do SDK).
- **Lista e quota desatualizadas depois de falha:** depois de conflito, "já anulado" ou resultado incerto, a lista não era recarregada e reabrir a correção repetiria o conflito até recarregar a página. As três operações passaram a recarregar lista, dependentes e quota conforme o tipo de falha (`cashRefreshScope`); quota esgotada recarrega só o indicador, e validação, papel e sessão não recarregam nada (custo sem efeito).
- **Foco do motivo da anulação:** o modal de confirmação não gerencia foco; com o motivo obrigatório, o foco passou a começar no campo (`autoFocus`), e Tab segue para Cancelar e Confirmar (sequência registrada no E2E de evidência).
- **Três testes antigos** fixavam o contrato anterior: dois estruturais com os destinos de escrita e a contagem local (`investment-transaction-entry.test.ts`, `billing-client.test.ts`) e o da P2C que fixava as chaves exatas do entitlement (`aiCredits.integration.test.ts`, achado F1). Foram atualizados para o contrato novo, com asserções mais fortes: destinos autoritativos e legados explícitos, proibição de contagem local na lista e, no entitlement, as chaves exatas de `transactionsQuota`, `used`/`remaining` nulos para o membro e nenhum campo de uso de IA.

**Revisões especializadas** (uma vez cada, no escopo da P3-E):
- **`financial-domain-integrity`: FAIL** no escopo de P3, pelos itens ainda abertos, e não pela fatia P3-E (cujos dois achados foram corrigidos acima). O gate bloqueia por: escritores legados do cliente ainda ativos e Rules que aceitam a escrita do cliente em `transactions` (PR-TX-01/02/05); duas representações por fato (`value`/`valueCents`, `date`/`transactionDate`, PR-TX-03); sem detector agendado de deriva (P7).
- **`multi-tenant-security-review`: PASS** no escopo da P3-E. Leitura da quota relê a membership na transação, monta os caminhos só do `workspaceId` validado e devolve `used` só ao titular canônico; testes negativos nos dois sentidos (titular de A como membro de B não vê o uso de B; não membro recebe `permission-denied`); callables do formulário sem decisão de autorização no cliente; perda de acesso entre abrir e salvar recusada (E2E); inicialização e auditoria recusam fora do Emulator e não são exportadas.
- **`billing-entitlement-integrity`: FAIL**, pelo mesmo motivo estrutural da P3-D: recurso sujeito a quota ainda pode ser criado diretamente pelo cliente (caminho legado e Rules sem `write: false`). Na fatia: leitura num `getAll`, visibilidade por papel testada, indicador sem contagem local, desconhecido não bloqueia, mensagens do backend em pt-BR distintas para titular e não titular, contador igual ao ledger na rajada.
- **`firestore-scale-cost-review`: PASS** depois da correção do recarregamento por tipo de falha. Leitura de quota: +2 documentos no mesmo `getAll`, custo constante. Inicialização: agregação `count` (~1 leitura por 1.000 entradas de índice; ~200 no teto de 200.000) e recontagem constante na transação. Auditoria administrativa: até 200.000 documentos por execução, só Emulator. Nenhum índice novo (campos simples).
- **`ptbr-product-ui-review`: PASS** no diff de interface da P3-E. Textos em pt-BR, sem detalhe interno; estados de envio (botão desabilitado e `aria-busy`), erro (alerta no formulário, dados preservados) e sucesso; evidência em desktop e celular, variante legada ao lado da autoritativa no mesmo viewport e com os mesmos dados (`docs/production/evidence/p3e/`). A compilação do baseline P3-D para comparação lado a lado foi bloqueada pela política de permissões do ambiente; as superfícies inalteradas foram conferidas pelo diff e pela evidência versionada da P2C (`docs/production/evidence/p2c-h2/08-modal-nova-transacao-desktop-claro.png`). Achados de acessibilidade anteriores (sem Escape e sem contenção de foco no modal de confirmação; "Excluir permanentemente?" na baixa legada, que é lógica) permanecem registrados e fora do escopo.

**Requisitos para fechar as Rules de `transactions` (`write: false` do cliente).**
1. migrar ou decidir cada escritor da tabela acima (D-29 para pendentes; P4 para cartões, recorrentes e divisão; D-13/P3 para empréstimos — feito na P3-H, §18.8);
2. inicializar os workspaces existentes pelo procedimento endurecido, com auditoria prévia dos documentos sem `createdAt`;
3. Rules de `transactions` com leitura para membro e escrita negada a todo papel, testadas, junto com a remoção do write path do cliente no mesmo milestone.

**Ordem de rollout recomendada.** Functions (leitura de quota e callables) → inicialização dos workspaces (runner autorizado, P6) → frontend → migração dos produtores restantes → Rules `write: false` → remoção do legado.

**Riscos e decisões abertas.**
- A quota protege a criação manual confirmada pela interface, mas não os produtores legados remanescentes, que ainda gravam sem contador.
- Workspaces sem âncora mostram o estado desconhecido e não criam pela callable até a inicialização: em ambiente real, o frontend desta entrega só pode ir junto com a inicialização.
- **Abertos:** D-29 (pendentes, agendados, competência), D-30 (contas e transferências), TX-15, E-06, PR-AI-02/E-00, os achados de acessibilidade pendentes, P4–P10 e REQ-FUT-01.

**Rollback.** Reverter o diff da P3-E:
- frontend: remover `src/modules/transactions/cashEntry.ts`, `cashCallables.ts`, `cashApi.ts` e `src/modules/billing/transactionsQuota.ts`; desfazer os acréscimos em `TransactionModal.tsx`, `ConfirmationModal.tsx`, `App.tsx`, `TransactionsView.tsx`, `RecentTransactions.tsx`, `src/modules/transactions/hooks.ts`, `src/types.ts` e `src/modules/billing/types.ts` (a criação, a correção e a baixa voltam ao caminho legado e o indicador à contagem local);
- backend: desfazer `transactionsQuota` em `workspaceEntitlement.ts`, `describeTransactionQuota` em `transactionQuota.ts`, a reescrita de `cash/quotaBackfill.ts` e o `export` de `LEGACY_CLIENT_KEYS` em `cash/eligibility.ts`;
- testes e configuração: remover `tests/unit/cash-entry.test.ts`, `e2e/cash-manual-entries.spec.ts`, `quotaRead`, `quotaBackfillHardening` e `importBurst`; desfazer os ajustes em `quotaMembers`, `aiCredits`, `quotaBackfill`, `p3dContracts`, `investment-transaction-entry`, `billing-client`, `e2e/support/workspaceSeed.ts` e o script `test:unit:cash` em `package.json`.

Nada foi gravado fora do Emulator; não há dado a reverter.

### 18.6 P3-F — D-29, lançamentos pendentes e agendados, consistência do saldo e segurança do backfill (2026-10-04)

**Estado inicial.** Sobre o HEAD `37d8780` + working tree da P3-E (§18.5), na mesma branch. O ZIP `dindin-minhas-financas-p3e-2026-10-04.zip` (SHA-256 `3f779f7d…fa0a`) foi extraído e comparado com o checkout: idênticos fora dos arquivos ignorados, inclusive os não rastreados. P0–P2, a UX-H1 e a P3-A/B/C/D/E estão preservados; nenhum arquivo da P3-E foi removido.

**Escopo e limites.**
- Mudaram o backend de caixa (contratos, criação, correção, confirmação, anulação, elegibilidade, projeção, reconstrução, inicialização da quota e a nova janela sem escritas), as Rules de `transactions` (só a janela), o formulário de lançamento, a regra de caixa realizado no dashboard, os testes e a documentação. Índices não mudaram.
- Sem redesign: a receita ganhou a pergunta "Essa receita já foi recebida?" (a despesa já tinha "Essa despesa já foi paga?") para distinguir registro, vencimento e confirmação; a confirmação de um pendente mostra o vencimento e o botão "Confirmar pagamento"/"Confirmar recebimento" no lugar do motivo; a linha de receita pendente ganhou a marca "Pendente" (a despesa já tinha a coluna de status). Evidência em `docs/production/evidence/p3f/`.
- Nada foi implantado, commitado ou enviado; Firebase só no Emulator `minhas-financas-local`; dados sintéticos. Nenhuma reconstrução nem inicialização em ambiente real; nenhum runner de produção.
- **P3 não está concluída**: produtores de outros domínios e a correção/baixa de lançamento não elegível continuam no caminho legado do cliente; empréstimos, recebíveis e P4 não foram iniciados.

**Decisão D-29 (tomada nesta entrega, implementada e testada): regime de caixa realizado.**
- Realizado × previsto: só move o caixa o lançamento **confirmado**, não anulado, com data efetiva até hoje em São Paulo, no mês da data efetiva e pelo valor liquidado. Pendente e agendado são previsão e não movem o caixa.
- O vencido continua pendente até ser confirmado ou anulado; nada muda de estado pela passagem do tempo. "Agendado" (vencimento futuro) e "vencido" (vencimento passado) são rótulos derivados de `dueDate` × hoje.
- O vencimento (`dueDate`) é preservado na confirmação, que grava a data efetiva em `date`; a anulação é lógica e mantém o histórico.
- Investimentos (`investmentMetadata`) e cartões (`parcelado`, domínio de P4) mantêm contratos próprios, sem mudança.
- Legado ambíguo não é convertido em confirmado. Competência (accrual) não foi adotada.

**Estados e transições implementados** (`functions/src/cash/contracts.ts:80-302`; `functions/src/cash/mutateTransaction.ts`):

| Estado | Documento | Entra por | Sai por |
| --- | --- | --- | --- |
| `pending` (inclui agendado e vencido) | `cashEntry.status: pending`, `isPaid: false`, `dueDate` (até 10 anos à frente, não antes de 2000), `date` = `dueDate` | `createCashTransaction` com `status: pending` e `dueDate`; legado manual com `isPaid: false` explícito, adotado na primeira operação | `confirmCashTransaction` → `confirmed`; `voidCashTransaction` → anulado; `updateCashTransaction` corrige valor, vencimento e campos descritivos sem mudar o estado |
| `confirmed` | `cashEntry.status: confirmed`, `isPaid: true`, `date` = data efetiva (≤ hoje), `dueDate` mantido quando veio de pendente, `cashEntry.confirmedAt`/`confirmedBy` | criação confirmada; confirmação do pendente | `voidCashTransaction` → anulado; `updateCashTransaction` corrige sem voltar a pendente |
| anulado | `voidedAt`, `voidedBy`, `voidReason` (lógico, sem apagar) | `voidCashTransaction` (de pendente ou confirmado) | nenhuma (sem reativação) |

- O cliente nunca envia `isPaid`; o servidor o deriva do estado. Combinações inválidas são recusadas em pt-BR pelo schema estrito (confirmado com data futura, pendente sem vencimento, pendente com data efetiva, vencimento em confirmado, data inexistente).
- **Confirmação** (`confirmCashTransaction`, nova callable no kernel): `transactionId`, `expectedUpdatedAt`, data efetiva até hoje, `amountCents` liquidado e `paymentMethod` opcional (só despesa; em receita é recusado); sem motivo e sem quota. Na mesma transação: autorização relida, janela sem escritas, idempotência por intenção com âncora em `cash_events`, limite de frequência, versão, estado relido (`pending`), patch e evento `cash_entry.confirmed` com antes e depois (estado, valor, tipo, data e vencimento).
- **Recusas de transição:** confirmar o que não está pendente ("Este lançamento já está confirmado.", `details.transition: confirmed_to_confirmed`); confirmar ou corrigir anulado; pendente → confirmado pela correção ("Para confirmar um lançamento pendente, use a confirmação, com a data e o valor efetivos."); confirmado → pendente ("Lançamento confirmado não volta a pendente."). Confirmação e anulação concorrentes: só uma vence (versão e estado relidos na transação); nenhuma escrita parcial antes do commit.
- **Idempotência:** chave do ator por intenção; replay devolve o resultado gravado sem efeito; a mesma chave com outro conteúdo, lançamento ou workspace é conflito. O cliente nunca gera chave nova para reenviar uma operação de resultado incerto (P3-E).
- **RBAC:** owner e admin operam em qualquer lançamento do workspace; member só nos próprios; viewer nunca; membro removido, conta suspensa e workspace arquivado recusados; autorização relida dentro da transação.

**Quota (D-40 estendida).** O pendente ou agendado consome uma unidade na criação, no mês de registro em São Paulo pelo relógio do servidor. A confirmação não consome, mesmo em outro mês (teste: criado em outubro, confirmado em novembro → contador de outubro 1, de novembro 0). Correção, anulação e replay não consomem nem devolvem. Quota esgotada recusa a criação do pendente sem gravar nada.

**Saldo e projeção.**
- **Definição única de caixa realizado:** `cashPeriodDeltaFor` zera receita e despesa pendentes (`isPaid === false` ou `cashEntry.status === 'pending'`; `functions/src/cash/periods.ts:90-124`). A confirmação entra no mês da data efetiva com o valor liquidado; corrigir a data efetiva move o delta entre meses; anular o pendente não tem o que devolver. Marca por evento, retry do gatilho, cerca de corte e publicação atômica da reconstrução (P3-B) não mudaram.
- **Frontend sem segunda autoridade:** `transactionCashImpactCents` e `summarizeCashFlow` (`src/modules/investments/semantics.ts:38-118`) replicam a mesma regra só para exibição; a projeção do backend continua a autoridade.
- **Divergências investigadas:**
  - corrigidas: card de receitas do dashboard somava receita não recebida; o saldo do frontend contava receita pendente; a projeção contava despesa e receita pendentes;
  - documentadas, fora do escopo: os relatórios (`buildCashAccountingTransactions`, P5) ignoram `isPaid` e não foram reescritos; o total da tabela de lançamentos soma as linhas listadas, inclusive pendentes, cada uma marcada "Pendente" (registro, não saldo); `parcelado` segue a regra do domínio de cartões (P4); receita legada sem `isPaid` com data futura continua contada (ambígua, recusada pela correção; exige reconciliação); lançamento legado de outro domínio pago com data futura conta no mês futuro; o log do gatilho ignora `isPaid` (só log).
  - efeito em outros domínios, pela regra de campo: a ocorrência recorrente gerada pelo cron (`isPaid: false`) deixa de mover o caixa até ser marcada como paga.
- **Reconciliação no Emulator:** projeção gravada pela regra anterior → simulação da reconstrução (`dryRun`) informa `divergence` (períodos divergentes, líquido gravado × reconstruído, amostra limitada a 24, teto de 600 períodos; `functions/src/cash/rebuild.ts:345-397`) → reconstrução publica → nova simulação sem divergência (teste "projeção pela regra antiga…"). **Projeções existentes precisam dessa reconstrução** no rollout; nenhuma reconstrução foi executada fora do Emulator.

**Cerca da inicialização da quota (backfill).**
- **Falha demonstrada antes da correção** (`quotaBackfillFence`, 4/4 falhando no contrato da P3-E): mudança de classificação com a mesma contagem (`source: recurring`), pendente que vira confirmado durante a inicialização, mudança de autoria/origem que decide o consumo (`userId` de sistema) e exclusão + inclusão preservando a contagem. Nos quatro, a inicialização gravava `initialized` com a classificação lida antes da mudança (ex.: `counted: 3` com um documento já fora do consumo). A recontagem por agregação da P3-E não detecta mudança que preserva contagens.
- **Correção:**
  - **janela sem escritas verificável** (`workspaces/{id}/quota_state/ledger_write_freeze`, server-only; `functions/src/cash/ledgerFreeze.ts`): enquanto existe, as Rules negam create/update do cliente em `transactions` (`firestore.rules:202-204,1014,1033`) e todas as callables de caixa recusam na transação (`assertLedgerWritable`, mensagem pt-BR, `details.ledgerFrozen`);
  - a execução **exige a janela aberta e assentada** (60 s, para esgotar escritas em voo) e recusa sem ela (`write_freeze_required`, `write_freeze_settling`); a simulação sem janela só anota;
  - na transação de gravação: a mesma janela (`createTime` do servidor igual ao lido antes da varredura — janela fechada e reaberta é detectada), as contagens do mês e do histórico, e a **releitura do conjunto varrido comparando o `updateTime` do servidor**, em blocos de 300 (`scannedSetUnchanged`); qualquer diferença → `concurrent_change`, nada gravado;
  - não depende de contagens nem de relógio do cliente; simulação, teto de leitura, auditoria de documentos sem data e restrição ao Emulator mantidos; nenhum runner de produção.
- **Custo proporcional:** a transação grava 2 documentos (âncora e contador) e relê no máximo o conjunto varrido (padrão 2.000, teto 20.000 documentos, em blocos de 300); com a janela aberta, nenhum escritor bloqueado disputa esses documentos.
- **Garantia real.**
  - Automatizada: com a janela, edição, exclusão e inclusão por qualquer escritor (inclusive Admin SDK) entre a leitura e a gravação são detectadas e recusadas; sem a janela, a execução recusa.
  - Operacional: abrir a janela, aguardar o assentamento, simular, executar e fechar. Os escritores do backend de outros domínios (espelho de investimentos, fatura, cron recorrente) não consultam a janela; a releitura por `updateTime` e as contagens os detectam e a inicialização falha fechado (repetir).
  - Lacuna estrutural: criação legada **depois** da inicialização não passa pelo contador (divergência visível no relatório de execução idempotente; teste "criação depois da inicialização…"); só desaparece com o fim dos escritores legados (`write: false`).

**Escritores legados restantes** (o pendente e o agendado manuais saíram desta lista):

| Produtor | Caminho | Dono |
| --- | --- | --- |
| Correção de lançamento não elegível (outro domínio, formato ambíguo) | `onUpdateTransaction` → `updateDoc` | fora do contrato manual |
| Baixa de lançamento não elegível | baixa lógica do cliente (`voidedAt`) | idem |
| Compra parcelada sem cartão de domínio | `createTransactionsBatch` (`writeBatch`) | P4 |
| Divisão de contas: integração e reembolso | `SplitGroupDetailsView` → `handleAddTransaction` | P4 |
| Confirmação de ocorrência recorrente | `RecurringExpenseDetailsView` → `handleAddTransaction` | P4 |
| Empréstimos PF/PJ | `LoanDetailsView`/`PJLoanDetailsView`, `LoansView`/`PJLoansView` | P3 (D-13) |
| Espelhos do backend (investimentos, fatura, cron recorrente) | Admin SDK | já autoritativos; fora do contrato manual |

- **Restrição extra nas Rules para o lançamento manual legado: não implementada, por não ser comprovadamente segura.** Todo campo que distinguiria um lançamento manual de um produtor de outro domínio (`source`, `loanId`, `splitGroupId`, `recurringId`, `cardId`, `installments`, `type`) é gravado pelo próprio cliente; negar o "manual" pelas Rules seria contornado omitindo ou forjando esses campos, e negar os outros quebraria os produtores legítimos que ainda gravam pelo cliente. `loanId`/`splitGroupId` do cliente não são prova de origem. A única restrição comprovável é a janela sem escritas (positiva e negativa testadas). A quota **não** é inviolável no aplicativo inteiro.
- **Condições para `write: false` em `transactions`:** (1) migrar ou decidir cada produtor da tabela acima (P4 para cartões, recorrentes e divisão; P3/D-13 para empréstimos — feito na P3-H, §18.8); (2) inicializar os workspaces existentes com a janela sem escritas e auditoria prévia; (3) reconstruir as projeções pela regra D-29; (4) Rules de `transactions` com leitura para membro e escrita negada a todo papel, testadas, com a remoção do write path do cliente no mesmo milestone.

**Testes provados contra o defeito.** 16 mutações, todas detectadas (código restaurado e recompilado depois de cada uma):
- backend (Emulator): projeção somando pendente; confirmação apagando o vencimento; segunda confirmação aceita; pendente sem consumo de quota; correção mudando o estado; janela ignorada nas mutações; legado pago no futuro adotado; inicialização sem a janela (a primeira versão não compilava e foi refeita compilável); cerca sem `updateTime`; confirmação com data futura;
- Rules: janela ausente na criação;
- frontend (unitários): pago com data futura aceito; confirmação descartando correção em silêncio; receita pendente no saldo; card de receitas somando pendente; legado pago no futuro como candidato.

**Testes novos e ajustados.**
- **Unitários das Functions:** `d29Contracts` (7: contratos de criação, combinações inválidas, correção e importação, confirmação, regra do caixa realizado, virada de mês por deltas, contratos de cartões e investimentos preservados); `mutationContracts` ajustado à elegibilidade D-29 (legado pendente elegível, novos ambíguos); contrato de implantação com `confirmCashTransaction`.
- **Integração no Emulator:** `d29Lifecycle` (16: pendente e agendado sem mover o caixa; confirmação com data efetiva, valor liquidado e vencimento preservado; pendente de um mês confirmado no seguinte; confirmação dupla; confirmação × anulação concorrentes; falha antes do commit e reenvio; correção do pendente e transições recusadas; anulação do pendente; forma de pagamento na receita; RBAC; isolamento entre tenants; janela sem escritas; quota; legado pendente adotado; legado ambíguo; reconciliação da projeção pela regra antiga); `quotaBackfillFence` (7: os 4 cenários concorrentes, sem janela, janela fechada/reaberta, criação depois da inicialização); `quotaBackfill` e `quotaBackfillHardening` passaram a abrir a janela; `createTransaction` e `mutateTransaction` ajustados a `entryStatus` e aos snapshots com estado e vencimento; `recurring.integration` ajustado à D-29 (pendente zero, paga conta).
- **Rules** (`m4-hardening`, +1): com a janela, owner, admin e member não criam, não alteram e não anulam; o cliente não abre nem fecha a janela (nem em outro espaço); antes e depois da janela, criação e alteração voltam (positivos), inclusive um lote legado de 24 parcelas num único commit (a leitura extra não estoura o limite de acessos das Rules).
- **Unitários do frontend** (`cash-entry`, 13): estado pelo formulário, candidatos com pendente, payload de confirmação sem descarte silencioso, mensagens do backend para confirmação repetida e janela de manutenção, caixa realizado na tela; `investment-transaction-entry` com as rotas novas.
- **E2E** (`cash-pending-entries`, 2, novo; `cash-manual-entries` ajustado): receita a receber, receita agendada e despesa a pagar pela tela, sem crédito nem débito no dashboard, quota +3; confirmação pela edição com data efetiva, valor liquidado, vencimento preservado, sem motivo e sem quota; recusas locais em pt-BR (confirmação com outra correção; pago com data futura).

**Validação (resultados atuais, desta entrega).**
- `npm run verify:all` integral sobre o working tree final: **PASS** (código de saída 0).
  - `verify:fast`: typecheck do frontend e das Functions; lint das Functions com 0 erros (1.961 avisos, mesmo total da P3-E, nenhum nos trechos da P3-F); build do frontend e das Functions; unitários das Functions **399/399**; frontend: investimentos 174/174, P1 128/128, billing 43/43, UI 5/5, caixa 13/13.
  - `test:integration:emulator`: integração das Functions **511/511**; guarda da ferramenta de limpeza 15/15; Rules **103/103** (metas 5, investimentos 7, domínio de investimentos 19, M3 7, M4 40, adjacentes 5, workspaces 10, billing 10).
  - `test:e2e`: **60/60**.
- Uma execução integral anterior (sobre a árvore antes das duas correções de teste descritas abaixo) terminou com integração 509/511 e foi descartada como evidência; as correções foram validadas por execução direcionada (`d29Lifecycle` 3 × 16/16; `d29Lifecycle` + `recurring` 27/27) e depois pela execução integral acima.
- Os números históricos da P3-E (integração 488, Rules 102, E2E 58) foram substituídos pelos acima; nenhuma suíte com `skip`/`only`, nenhum timeout aumentado, nenhuma repetição artificial.
- Execuções direcionadas durante a entrega: cerca da inicialização antes da correção 0/4 e depois 14/14 (`quotaBackfill`, `quotaBackfillFence`, `quotaBackfillHardening`); Rules M4 40/40 com o lote de 24 parcelas.
- Evidência visual (spec temporário, removido depois da captura): 2/2, desktop e celular, 12 capturas em `docs/production/evidence/p3f/`.

**Autorrevisão e revisões.** Corrigido ou provado antes do fechamento:
- **Grupo de rádios sem nome acessível:** a pergunta nova "Essa receita já foi recebida?" (e a da despesa, da qual a confirmação passou a depender) era um rótulo solto; o leitor de tela anunciava só "Sim"/"Não". Agora cada grupo é `role="radiogroup"` com `aria-labelledby` na pergunta, sem mudança visual; o E2E seleciona pelos grupos nomeados. Teclado: Tab chega ao grupo, seta troca a opção (o rótulo da data muda junto) e Tab segue para a data (sequência registrada na evidência).
- **Limite de acessos das Rules:** a janela acrescenta um `exists()` em cada escrita do cliente em `transactions`; um lote legado de 24 parcelas num único commit foi provado aceito no Emulator (teste de Rules).
- **Mensagens novas do backend na interface:** confirmação repetida e janela de manutenção chegam em pt-BR, sem código nem detalhe interno, e recarregam a lista (teste unitário).
- **Teste novo com rejeição sem handler:** na primeira execução integral, `d29Lifecycle` falhou uma vez por `unhandledRejection` (a tentativa seguinte era criada antes de a anterior ser tratada, enquanto o payload era montado); passava nas execuções direcionadas por acaso de tempo. Os dois laços do arquivo com esse padrão passaram a criar cada tentativa só depois da anterior; o produto não mudou.
- **Teste de recorrentes no regime anterior:** `recurring.integration` ("a assinatura vencida vira despesa válida e visível para a projeção de caixa") fixava que a ocorrência gerada pelo cron com `isPaid: false` saía do caixa (−R$ 3.200,00). Pela D-29 ela não move o caixa enquanto não paga. O teste passou a exigir as duas coisas: delta zero enquanto pendente e −R$ 3.200,00 no mês do vencimento quando marcada como paga; a verificação do mês (`cashPeriodKeyFor`), que é a regressão que o teste tranca, foi mantida.
- **Isolamento nos dois sentidos:** o teste de tenant cruzado da confirmação passou a atacar A a partir de B e B a partir de A.
- **Efeito em outros domínios** (documentado, não é defeito): a ocorrência recorrente gerada pelo cron com `isPaid: false` deixa de mover a projeção até ser marcada como paga, pela mesma regra de campo.

**Revisões especializadas** (uma vez cada, no escopo da P3-F):
- **`financial-domain-integrity`: FAIL** no escopo de P3, pelos itens ainda abertos, e não pela fatia P3-F. Na fatia: definição única de caixa realizado no backend, com o frontend só replicando; estados, transições e trilha com antes e depois; criação, correção, confirmação, anulação, replay, falha antes do commit, concorrência confirmação × anulação e reconciliação da projeção testados no Emulator; contratos de investimentos e cartões preservados. Bloqueiam: escritores legados do cliente ativos e Rules que aceitam a escrita do cliente em `transactions` fora da janela (PR-TX-01/02/05); duas representações por fato (`value`/`valueCents`, `date`/`transactionDate`) e relatórios de P5 que ignoram `isPaid` (PR-TX-03); projeções existentes divergentes até a reconstrução (operacional); sem detector agendado de deriva (P7).
- **`multi-tenant-security-review`: PASS** no escopo da P3-F. `confirmCashTransaction` toma a identidade do contexto verificado, valida `workspaceId`, relê membership, papel, conta e workspace dentro da transação e monta o caminho só do workspace validado; member só nos próprios, viewer nunca (teste de RBAC); nenhum tenant confirma o pendente do outro (teste nos dois sentidos de identidade); a âncora de idempotência recusa a mesma chave em outro lançamento ou workspace; a janela é server-only (o cliente não a abre nem a fecha, nem em outro espaço; teste de Rules) e é verificada nas duas camadas, Rules e callables, de forma independente.
- **`billing-entitlement-integrity`: FAIL**, pelo mesmo motivo estrutural da P3-D/P3-E: recurso sujeito a quota ainda pode ser criado diretamente pelo cliente pelos produtores legados (Rules sem `write: false`). Na fatia: o pendente consome na mesma transação da criação, a confirmação não consome (teste com virada de mês), correção, anulação e replay não consomem nem devolvem, quota esgotada recusa o pendente sem gravar, mensagens em pt-BR; nenhum campo de quota é gravável pelo cliente.
- **`firestore-scale-cost-review`: PASS.** Custo por ação: criação pendente = criação da P3-D + 1 leitura (janela); confirmação = reafirmação do ator (membership, workspace, perfil), janela, chave do ator, âncora por intenção (consulta de grupo com `limit(1)`, índice existente), lançamento e limite de frequência, com 4 escritas (lançamento, evento, chave, limite) e o delta do gatilho em até 2 períodos; Rules: +1 leitura de documento por escrita do cliente em `transactions`; simulação da reconstrução: leitura dos períodos gravados limitada a 600 + estados; inicialização: transação com 2 escritas e releitura de até o conjunto varrido (padrão 2.000, teto 20.000) em blocos de 300, só no Emulator. Nenhuma consulta nova sem limite, nenhum índice novo, nenhum listener novo.
- **`ptbr-product-ui-review`: PASS** nas interações novas da P3-F (pergunta de recebimento da receita, rótulos de data, aviso de vencimento, botão de confirmação, marca "Pendente" na receita, recusas locais e mensagens novas do backend). Textos em pt-BR, sem detalhe interno; estados de envio, erro (alerta no formulário, dados preservados) e sucesso como na P3-E; desktop e celular em `docs/production/evidence/p3f/`; comparação com o baseline versionado da P3-E (`docs/production/evidence/p3e/desktop-01-nova-transacao.png`, em que a receita só tinha "Data de Recebimento"). O rótulo "Quando foi pago?" da despesa é anterior e não foi alterado. Achados de acessibilidade anteriores continuam registrados e fora do escopo.
- **`regression-release-gate`: FAIL** (P3 não está sendo fechada). As etapas executáveis passaram no working tree final (`verify:fast`, integração com Emulator, Rules e E2E, acima), sem `skip`/`only`, sem timeout aumentado e sem asserção relaxada (os dois testes ajustados ganharam asserções; o de recorrentes segue a D-29 com cobertura maior). O gate bloqueia porque `financial-domain-integrity` e `billing-entitlement-integrity` estão em FAIL e porque a superfície tocada também exige `firebase-production-readiness` (novo export `confirmCashTransaction`) e `observability-incident-readiness` (evento `cash_entry.confirmed`, relatório de divergência da reconstrução), que não foram executadas nesta entrega.

**Rollout recomendado.** Functions (callables, janela e regra da projeção) → janela sem escritas por workspace e inicialização da quota (runner autorizado, P6) → reconstrução das projeções pela regra D-29 (simulação, reconstrução, nova simulação) → frontend → produtores restantes → `write: false`. O frontend da P3-F nunca pode chegar antes das Functions: ele envia `status`/`dueDate` e chama `confirmCashTransaction`, que o backend anterior recusa (o frontend anterior continua compatível com as Functions novas, porque `status` ausente é confirmado).

**Riscos e decisões abertas.**
- A quota cobre os lançamentos manuais da interface, mas não os produtores legados restantes.
- Projeções gravadas pela regra anterior divergem até a reconstrução; relatórios (P5) ainda contam pendentes.
- O total da tabela de lançamentos inclui pendentes (marcados), enquanto os cards mostram o realizado.
- **Abertos:** D-13 (empréstimos), D-30 (contas e transferências), D-39 (recebíveis), E-06, PR-AI-02/E-00, TX-15, os achados de acessibilidade pendentes (sem Escape e sem contenção de foco no modal de confirmação; "Excluir permanentemente?" na baixa legada), P4–P10 e REQ-FUT-01.

**Rollback.** Reverter o diff da P3-F:
- backend: remover `functions/src/cash/ledgerFreeze.ts` e `confirmCashTransaction` (`callables.ts`, `index.ts`, `mutateTransaction.ts`); desfazer `status`/`dueDate` e o refinamento de estado em `contracts.ts`, a criação pendente em `createTransaction.ts`, a elegibilidade D-29 em `eligibility.ts`, `entryStatus` e os snapshots em `shared/audit.ts`, a regra de pendente em `periods.ts`, `divergence` em `rebuild.ts`, a janela e a releitura em `quotaBackfill.ts` e `assertLedgerWritable` em `importTransactions.ts`;
- Rules: remover `isLedgerWriteFrozen` e as duas condições em `transactions`;
- frontend: desfazer `TransactionModal.tsx`, `App.tsx`, `TransactionsView.tsx`, `semantics.ts`, `cashEntry.ts`, `cashCallables.ts`, `cashApi.ts`, `hooks.ts` e `types.ts` (pendente e agendado voltam ao caminho legado);
- testes e evidência: remover `d29Contracts`, `d29Lifecycle`, `quotaBackfillFence`, `e2e/cash-pending-entries.spec.ts` e `docs/production/evidence/p3f/`; desfazer os ajustes nos demais testes.
- Dados: nada foi gravado fora do Emulator. Num ambiente real, depois de um rollback, uma nova reconstrução volta a projeção à regra anterior.

### 18.7 P3-G — D-13 e núcleo autoritativo de empréstimos PF/PJ (2026-10-05)

**Estado inicial.** Sobre o HEAD `37d8780` + working tree da P3-F (§18.6), na mesma branch. O ZIP `dindin-minhas-financas-p3f-2026-10-04.zip` (SHA-256 `ba1f3dc4…650b`) foi extraído e comparado com o checkout: idênticos, inclusive os não rastreados (0 diferenças, nenhum arquivo a mais). Presentes: `functions/src/cash/ledgerFreeze.ts`, `confirmCashTransaction`, a regra D-29 em `functions/src/cash/periods.ts`, `e2e/cash-pending-entries.spec.ts` e §18.6. P0–P2, UX-H1 e P3-A/B/C/D/E/F preservados.

**Escopo e limites.**
- Entregue: o domínio autoritativo de empréstimos no backend (contratos, motor, operações, rotina de atraso, auditoria; a análise de legado entregue aqui foi removida na P3-H), a extensão aditiva da projeção de caixa, a proteção do schema novo nas Rules, testes e documentação. Correções documentais da P3-F: empréstimos deixaram de ser associados à D-30 (contas e transferências) e os resumos de billing passaram a registrar que pendente e agendado manuais já passam pela callable desde a P3-F.
- Não entregue, de propósito: troca das telas PF/PJ e fechamento da escrita do cliente em `loans`/`loan_movements` (entregues na P3-H, sem migração: não há dados reais); recebíveis (D-39), P4 e D-30 não foram iniciados. Nenhum dado real, nenhum deploy, nenhum commit; Firebase só no Emulator `minhas-financas-local`.
- Frontend: uma única mudança fora das telas de empréstimos — os cards "Receitas" e "Despesas" do dashboard excluem o espelho de empréstimo (o saldo o inclui), para que o principal não infle receita ou despesa operacional (`src/modules/investments/semantics.ts`, `src/types.ts`). Sem mudança visual; sem efeito em documentos sem `loanEntry`.

**Decisão D-13 (tomada, implementada e testada no backend).**
- `borrow`: o principal recebido é entrada de caixa e aumento de passivo; `lend`: o principal entregue é saída de caixa e aumento de ativo a receber. Nunca receita operacional nem despesa de consumo.
- Contratação com o fato de caixa obrigatório no mesmo commit; não há contrato ativo sem espelho.
- Liquidação: `borrow` paga (saída), `lend` recebe (entrada); `principalCents` e `interestCents` separados; o saldo cai só pelo principal; juros são despesa financeira (`borrow`) ou receita financeira (`lend`); o espelho movimenta `principalCents + interestCents` (R$ 1.000 + R$ 100 movem R$ 1.100 no caixa e R$ 1.000 no saldo).
- Centavos inteiros (`Number.isSafeInteger`, teto de R$ 1 bilhão por valor); taxa inteira em partes por milhão (1% = 10.000), nunca float.
- Juros `none`, `fixed` (total em centavos) ou `percentage` com amortização `price`, `sac` ou `simple` escolhida explicitamente; `monthly` = taxa nominal do mês; `annual` = nominal anual convertida para a mensal proporcional (`anual / 12` no denominador, sem arredondar a taxa).
- Price: prestação aproximadamente constante, juros sobre o saldo anterior, última parcela fecha o saldo exato. SAC: amortização constante pelo maior resto, juros sobre o saldo, prestações decrescentes. Simples: amortização pelo maior resto, juros sobre o principal original (total arredondado uma vez, dividido pelo maior resto). Fixo: total de juros pelo maior resto. Sem juros: só principal.
- Datas civis em São Paulo; `startDate` ≤ hoje (contratação já ocorrida); vencimentos podem ser futuros; aritmética de meses sobre a chave civil, recuando ao último dia do mês.
- Motor único PF/PJ; `counterpartyType`, `cnpjCpf` (com dígitos verificadores), `classification` e `costCenter` só em workspace PJ, validados pelo servidor; a classificação PJ não muda a fórmula.

**Modelo autoritativo** (`functions/src/loans/model.ts`; contrato e movimentos nas coleções existentes, marcados com `schemaVersion: 1`):
- contrato `loans/{loan_<hash>}`: `workspaceId`, `profileType`, `type`, `createdBy`/`updatedBy`, `createdAt`/`updatedAt`, `revision`, `principalCents`, `balanceCents`, `totalPrincipalSettledCents`, `totalInterestSettledCents`, `activePaymentCount`, `status`, `overdueFrom`, `interest`, `startDate`, `firstDueDate`, `installmentsCount`, `schedule` (embutido; teto de 360 parcelas ≈ 36 KB, longe do limite de 1 MiB), `scheduledInterestCents`, `maturityDate`, vínculos com a contratação, metadados PF/PJ; sem `currentBalance`, `principalValue` ou `amount`;
- movimento `loan_movements/{lmv_<hash>}`: `kind` (`disbursement`/`payment`/`reversal`), `principalCents`, `interestCents`, `totalCents`, `date`, `cashTransactionId`, `reversalOf`/`reversedBy`, `reason`, `intentId`, `requestHash`, `createdBy`;
- espelho `transactions/{loancash_<hash>}` com a marca backend-only `loanEntry` e descrição genérica;
- auditoria `loan_events/{id}` (nova coleção server-only).
- Saldo autoritativo = principal − principal liquidado não estornado; status derivado por função determinística (`deriveLoanStatus`): `cancelled` terminal; `paid` com saldo zero; `overdue` com saldo positivo e parcela vencida (vencimento antes de hoje) cujo principal acumulado excede o principal liquidado; senão `active`.

**Operações** (`functions/src/loans/operations.ts`; callables em `functions/src/loans/callables.ts`, exportadas em `functions/src/index.ts`):
- **Em comum:** schema estrito; autorização relida na transação (conta ativa, membership ativo, papel, workspace ativo); janela sem escritas do ledger nas que gravam caixa; chave de idempotência do ator (replay sem escrita; mesma chave com outro conteúdo = conflito); âncora durável da intenção (o próprio contrato na criação; `loan_events(intentId, operation)` de qualquer workspace nas mutações, índice de grupo); versão lida (`expectedUpdatedAt`) nas mutações; limite operacional de 60 operações a cada 10 minutos por ator e workspace (mecanismo existente; replay, recusa e falha não consomem); nenhuma quota comercial nova; espelhos não consomem `transactionsPerMonth` (D-40).
- `createLoan`: gera o ID antes dos vínculos; grava contrato, fato inicial, espelho, evento e idempotência no mesmo commit.
- `registerLoanPayment`: principal + juros separados, total > 0, principal ≤ saldo, data entre a contratação e hoje, contrato não cancelado; atualiza acumulados, saldo, `activePaymentCount` e status; grava movimento, espelho e evento.
- `reverseLoanMovement`: só pagamento ainda não estornado; movimento compensatório com `reversalOf`, `reversedBy` no original, espelho compensatório no mesmo dia civil do original (o mês do original soma zero); restaura saldo, juros, status e caixa; segundo estorno recusado; replay devolve o mesmo resultado.
- `cancelLoan`: só sem pagamento ativo (orienta estornar antes); compensa o principal da contratação no caixa; contrato `cancelled` (terminal), cronograma, eventos e vínculos preservados; não aceita nova liquidação. O saldo segue a fórmula (não há liquidação), e o status exclui o contrato dos saldos em aberto.
- `updateLoanMetadata`: só `personName`, `personContact`, `description` e campos PJ; termos financeiros, saldo e status não passam (schema estrito); auditoria só com os nomes dos campos alterados; sem mudança, nada é gravado.
- **Rotina diária** `processLoanStatusRefresh` (`functions/src/loans/statusRefresh.ts`): consulta de grupo só de contratos autoritativos ativos com `overdueFrom <= hoje` (índice declarado), páginas de 200, até 25 por execução, transação por contrato e evento `loan.status_refreshed` com ID por revisão (idempotente). Não implantada.

**Caixa e projeção.** `cashPeriodDeltaFor` lê `loanEntry` antes de `type`: principal em `loanPrincipalInflowCents`/`loanPrincipalOutflowCents`, juros em `financialIncomeCents`/`financialExpenseCents`, `netCents` com tudo, `incomeCents`/`expenseCents` intactos; estorno com sinal oposto; marca inválida não conta. Campos novos aditivos (`CASH_PERIOD_SCHEMA_VERSION = 2`); documentos e marcas de entrega antigos valem zero neles; a reconstrução usa a mesma lista de campos e reproduz os totais. Investimentos, cartões e caixa manual sem mudança. Cash eligibility e inicialização da quota tratam `loanEntry` explicitamente (vínculo de outro domínio; espelho de backend, não conta).

**RBAC e isolamento.** owner/admin administram qualquer empréstimo; member cria e administra só o que criou (`createdBy` gravado pelo backend; nunca aceito do cliente); viewer só lê; membership removido, conta suspensa e workspace arquivado recusados; tenants testados nos dois sentidos (workspace alheio → `permission-denied`; ID alheio no próprio workspace → `not-found`). Documento legado sem `createdBy` não vira "do member": o backend recusa mutar qualquer legado (falha fechada, inclusive owner/admin).

**PII.** Nome, contato e CNPJ/CPF da contraparte ficam só no contrato. O espelho usa descrição genérica e o vínculo por ID; `loan_events` não copia valores de metadados pessoais; logs (kernel e rotina) só têm IDs; a análise do legado devolve só IDs e motivos. O motivo de estorno/cancelamento é texto livre do usuário, guardado no movimento e na auditoria.

**Legado e plano de migração — superado na P3-H (§18.8).** A P3-G partiu da premissa, incorreta, de que havia dados anteriores a preservar. O DINDIN ainda está em desenvolvimento e não tem dados reais: na P3-H a análise de legado foi apagada (com o seu teste), não há migração, backfill nem coexistência de formatos, e o schema autoritativo substituiu diretamente o modelo anterior em backend, interface e Rules. O backend recusa qualquer documento fora do schema (falha fechada).

**Rules (estado da P3-G, substituído na P3-H).** Na P3-G, as Rules protegiam só o documento autoritativo (`hasAuthoritativeLoanKeys`/`hasAuthoritativeLoanMovementKeys`) e o cliente ainda gravava o formato anterior. Na P3-H essas funções foram removidas e `loans`/`loan_movements` passaram a `allow create, update, delete: if false` para todo papel; `loanId`/`loanMovementId` saíram da allowlist de `transactions` (§18.8).

**Testes provados contra o defeito.** 19 mutações, todas detectadas (código restaurado e recompilado depois de cada uma): juros reduzindo o saldo; espelho da contratação fora da data; principal como receita operacional (a primeira versão não compilava e foi refeita); segundo estorno aceito; cancelamento com pagamento ativo; member operando contrato alheio; sem controle de versão; principal acima do saldo; SAC com juros sobre o principal original; taxa anual arredondada antes; âncora durável ignorada; janela ignorada na liquidação; cancelamento sem compensar o caixa; limite não gravado (refeita compilável); PF aceitando campo PJ; Rules permitindo alterar contrato autoritativo; Rules permitindo rebaixar movimento autoritativo; Rules permitindo apagar movimento autoritativo; card de receitas somando espelho. A mutação "Rules permitindo alterar contrato autoritativo" **sobreviveu** na primeira execução: o teste não cobria o rebaixamento por exclusão das chaves; o teste foi reforçado (contrato e movimento) e as duas mutações passaram a ser detectadas.

**Testes novos.**
- Unitários das Functions: `loans/__tests__/schedule.test.ts` (9: arredondamento e taxa racional, Price, SAC, simples, fixo e sem juros, invariantes em escala com 360 parcelas e valor máximo, datas civis, entradas inválidas, status derivado), com vetores de uma implementação independente em `decimal.Decimal`; `loans/__tests__/loanContracts.test.ts` (5: CPF/CNPJ, criação estrita, liquidação e metadados, efeito de caixa e simetria do estorno, projeção pela marca e marcas forjadas); contrato de implantação (+1: callables de empréstimo; rotinas agendadas 3 → 4).
- Integração no Emulator: `loanLifecycle` (11: borrow PF atômico sem receita nem quota; lend PJ com Price, campos PJ e anual SAC; PF sem campos PJ e entradas inválidas; liquidação principal + juros e lend; regras da liquidação e quitação; pagamentos paralelos; estorno com replay e segunda reversão; cancelamento válido e recusado; metadados; falha antes do commit; reconstrução do caixa) e `loanGuards` (9: RBAC; tenants nos dois sentidos; suspensa, arquivado, removido; idempotência, conflito, âncora após expiração e mesma intenção concorrente; limite operacional; janela sem escritas; espelho protegido do caixa manual; legado recusado e analisado — substituído na P3-H por falha fechada fora do schema e idempotência de metadados; atraso e rotina diária).
- Rules (`m4-hardening`, +1): falsificação, alteração, rebaixamento e exclusão de contrato e movimento autoritativos negados a owner, admin e member; formato anterior do cliente seguia aceito na P3-G (removido na P3-H); `loan_events` só owner/admin e com teto; espelho e `loanEntry` negados ao cliente.
- Frontend (`investment-semantics`, +1): espelho de empréstimo fora dos cards operacionais e dentro do saldo.
- Ajustados ao formato versionado da projeção (os quatro campos novos com zero, asserção igual ou mais completa): `projection.test.ts`, `d29Contracts.test.ts`, `createTransaction.integration.test.ts` e `rebuildFence.integration.test.ts` (tipos e reconciliação da simulação).

**Validação (resultados atuais, desta entrega).**
- `npm run verify:all` integral sobre o working tree final: **PASS** (código de saída 0).
  - `verify:fast`: typecheck do frontend e das Functions; lint das Functions com 0 erros (1.961 avisos, mesmo total da P3-F; nenhum em `functions/src/loans/`); build do frontend e das Functions; unitários das Functions **414/414**; frontend: investimentos 175/175, P1 128/128, billing 43/43, UI 5/5, caixa 13/13.
  - `test:integration:emulator`: integração das Functions **531/531** (inclui `loanLifecycle` 11 e `loanGuards` 9); guarda da ferramenta de limpeza 15/15; Rules **104/104** (metas 5, investimentos 7, domínio de investimentos 19, M3 7, M4 41, adjacentes 5, workspaces 10, billing 10).
  - `test:e2e`: **60/60**. Executado porque a P3-G toca superfícies compartilhadas com os fluxos existentes (projeção de caixa, reconstrução, classificadores de quota e elegibilidade, Rules, exports das Functions e cards do dashboard).
- Execuções descartadas como evidência: (1) uma integral anterior terminou com integração 529/531 — dois testes de integração comparavam a forma antiga do delta da projeção; foram completados com os quatro campos novos em zero (asserção igual ou mais completa) e revalidados; (2) uma integral seguinte passou em tudo até as Rules (unitários 414, integração 531, Rules 104), mas o E2E não chegou a rodar: o Emulator encerrou na carga dos gatilhos porque o firebase-tools encaminha as próprias requisições de loopback pelo `HTTPS_PROXY` do contêiner e o encaminhador local estava parado. Ambiente, não produto: com o encaminhador local restabelecido, a execução integral acima passou sem alteração de código.
- Os números históricos da P3-F (unitários 399, integração 511, Rules 103) foram substituídos pelos acima; nenhuma suíte com `skip`/`only`, nenhum timeout aumentado, nenhuma repetição artificial.
- Execuções direcionadas durante a entrega: `schedule` 9/9 e `loanContracts` 5/5 (unitários); `loanLifecycle` + `loanGuards` 20/20 (Emulator); Rules M4 41/41 após o reforço do teste de rebaixamento; 19 mutações, cada uma com a suíte direcionada falhando e o código restaurado e recompilado depois.

**Autorrevisão.** Corrigido ou provado antes do fechamento:
- **Rebaixamento de documento autoritativo pelas Rules:** a mutação que removia a checagem de `resource.data` no update sobreviveu — o teste só tentava alterar campos, não apagar todas as chaves autoritativas num único update. Teste reforçado para contrato e movimento; mutações detectadas.
- **Principal mínimo por parcela:** com principal menor que o número de parcelas o cronograma teria parcelas vazias; o motor e o contrato passaram a exigir ao menos 1 centavo por parcela.
- **Espelhos e classificadores de caixa:** a marca `loanEntry` passou a constar explicitamente como vínculo de outro domínio (correção/anulação manual recusadas) e como espelho de backend na inicialização da quota (não conta), com teste.

**Revisões especializadas** (uma vez cada, limitadas ao diff da P3-G):
- **`financial-domain-integrity`: FAIL** no escopo de P3, pelo que continua aberto, e não pela fatia P3-G. Na fatia: autoridade só no backend para o schema novo, motor exato com vetores independentes, contratação com caixa no mesmo commit, saldo só pelo principal, juros como resultado financeiro, estorno e cancelamento compensatórios, status derivado, idempotência, concorrência, falha injetada, Rules negando a escrita do cliente no documento autoritativo e reconstrução do caixa reproduzindo os efeitos. Bloqueiam: a interface ainda grava empréstimos e o espelho legado pelo cliente (segundo escritor do domínio até a troca do frontend; PR-LOAN-01…07); relatórios de P5 sem a classificação nova; dupla representação `value`/`valueCents` no espelho (PR-TX-03); sem reconciliação agendada acumulados × movimentos (P7).
- **`multi-tenant-security-review`: PASS** no escopo da superfície autoritativa nova. Identidade só do token, `workspaceId` validado e coerente com caminho e documento (`readAuthoritativeLoan` exige o mesmo workspace), membership/papel/conta/workspace relidos na transação, `member` limitado por `createdBy` do backend, viewer sem escrita, tenants nos dois sentidos, conta suspensa, workspace arquivado e membership removido testados; âncora de idempotência presa a ator, workspace e contrato; Rules independentes do backend negam falsificar, alterar, rebaixar e apagar documento autoritativo e restringem `loan_events` a owner/admin. Fora desta avaliação: o RBAC do legado (PR-LOAN-07), que fecha com a troca da interface.
- **`firestore-scale-cost-review`: PASS.** Custo por operação constante: criação ≈ 7 leituras e 6 escritas; liquidação ≈ 8 leituras (incluindo a consulta de grupo `loan_events` com `limit(1)`) e 6 escritas; estorno e cancelamento ≈ 9 leituras e 7 escritas; metadados ≈ 7 leituras e 4 escritas; mais o gatilho da projeção por espelho (marca + 1 a 2 períodos). Contrato com cronograma embutido ≤ ~36 KB (teto de 360 parcelas). Rotina de atraso: consulta de grupo seletiva com índice, ≤ 25 × 200 contratos por execução, 1 leitura + até 2 escritas por contrato alterado. Análise do legado limitada (≤ 2.000 contratos, ≤ 20.000 movimentos) e só no Emulator. Dois índices compostos novos, ambos com consumidor; nenhum listener novo; auditoria sem TTL por ser trilha financeira (D-18).
- **`privacy-lgpd-data-lifecycle`: PASS** no escopo da P3-G. Inventário atualizado (`PRIVACY_LGPD.md`, linhas 9 e 10 e §6); dados da contraparte só no contrato, nunca no espelho, em `loan_events`, nos logs ou na análise (teste de integração procura nome, contato e descrição no espelho e na auditoria); correção pelo fluxo oficial (`updateLoanMetadata`) auditada só com nomes de campos; CNPJ/CPF validado e restrito a PJ. Fora desta avaliação (P8): exportação, eliminação e anonimização de contrapartes (PR-CR-05/LOAN-16, D-07), retenção por categoria (D-18) e a cópia do nome feita pelo caminho legado da interface.
- **`billing-entitlement-integrity`: FAIL**, executada porque `functions/src/cash/quotaBackfill.ts` mudou (classificação do espelho de empréstimo). Na fatia: o espelho não consome `transactionsPerMonth` (teste de integração e unitário), nenhuma quota nova, nenhum campo de quota gravável pelo cliente. O FAIL é o mesmo estrutural da P3-D/E/F: produtores de outros domínios ainda criam lançamentos pelo cliente, fora da quota (Rules sem `write: false` em `transactions`).
- **`regression-release-gate`: não executado**, por instrução desta etapa (não é fechamento de P3).

**Estado de PR-LOAN-01…PR-LOAN-07 ao fim da P3-G.** Parciais (backend resolvido; interface e Rules abertas). Todos resolvidos na P3-H (§18.8).

**Riscos e decisões abertas.**
- (Encerrado na P3-H.) A interface usava o formato anterior; desde a P3-H só existe o schema autoritativo.
- Relatórios de P5 ainda tratam o espelho como receita/despesa (`buildCashAccountingTransactions`) e mantêm o stub `totalLoans: 0` (LOAN-12).
- A rotina de atraso altera `updatedAt`: um cliente com a versão antiga recebe conflito e precisa reler (comportamento correto, documentado).
- Sem reconciliação agendada entre acumulados do contrato e movimentos (P7).
- **Abertos:** D-30 (contas e transferências, independente de empréstimos), D-39 (recebíveis), E-06, PR-AI-02/E-00, TX-15, os achados de acessibilidade pendentes, P4–P10 e REQ-FUT-01 — Visualização financeira por tempo de trabalho.

**Rollback.** Reverter o diff da P3-G: remover `functions/src/loans/` e os exports em `functions/src/index.ts`; desfazer os campos de empréstimo e a lista de campos em `functions/src/cash/periods.ts` e `rebuild.ts`, `loanEntry` em `cash/eligibility.ts` e `cash/quotaBackfill.ts`, os IDs em `shared/ids.ts`, o teste de implantação, os blocos de `loans`/`loan_movements`/`loan_events` em `firestore.rules`, os dois índices novos, `isLoanCashMirror` no frontend e os testes novos e ajustados. Nada foi gravado fora do Emulator.

### 18.8 P3-H — empréstimos só no schema autoritativo: interface PF/PJ pelas callables e remoção do modelo antigo (2026-10-05)

**Estado inicial.** Sobre o HEAD `37d8780` + working tree da P3-G (§18.7), na mesma branch. O ZIP `dindin-minhas-financas-p3g-2026-10-05.zip` (SHA-256 `96925945…032c`) foi extraído e comparado com o checkout: idênticos. Presentes e preservados: `functions/src/loans/`, as cinco callables, `loanEntry`, `loan_events`, `processLoanStatusRefresh`, a D-13 e a §18.7.

**Premissa corrigida.** O DINDIN não tem dados reais. A P3-G tinha mantido a interface antiga e uma análise de legado para uma migração futura; a P3-H removeu essa premissa por inteiro: sem migração, backfill, compatibilidade de schema, modo somente leitura ou modelo duplo. Documento fora do schema é recusado pelo backend (falha fechada, `INCONSISTENT_LOAN_MESSAGE`, inclusive para owner/admin) e ignorado pela interface (só o ID vai para o console).

**Escopo e limites.**
- Entregue: modelo único no frontend, telas PF/PJ pelas cinco callables, remoção dos escritores, do motor e da análise antigos, Rules fechadas para escrita do cliente, totais em centavos por agregado do servidor, idempotência de metadados endurecida e documentada, testes (unitários, integração, Rules, E2E, mutações), evidência visual e documentação.
- Não iniciados, por instrução: recebíveis (D-39), D-30, P4. Nenhum dado real, deploy, commit ou push; Firebase só no Emulator `minhas-financas-local`.

**Modelo único do frontend** (`src/modules/loans/types.ts`, `adapters.ts`): `Loan` e `LoanMovement` espelham o contrato `schemaVersion: 1` — `principalCents`, `balanceCents`, acumulados liquidados, `status`, `overdueFrom`, `interest` (`none`/`fixed`/`percentage` com `ratePpm`, período e amortização), `schedule` persistido, datas civis, `version` com a precisão total de `updatedAt` (nanossegundos), autoria e metadados PF/PJ. Sem union types, sem `currentBalance`, `principalValue`, float, status ou cronograma calculados no cliente. `toLoan`/`toLoanMovement` são estritos: qualquer invariante quebrada devolve `null`.

**Conversões puras** (`src/modules/loans/money.ts`, sem `parseFloat`): BRL → centavos por expressão regular (milhar com ponto, até 2 decimais; precisão excedente recusada; teto R$ 1 bilhão); juros fixos → centavos; percentual → `ratePpm` inteiro (até 4 decimais; 0 < taxa ≤ 100%). Datas civis e formatação pt-BR na borda.

**Telas** (`src/components/`), com o mesmo layout e as mesmas classes da P3-G (o frontend autenticado não muda de aparência; comparação antes/depois em `docs/production/evidence/p3h/antes/`):
- Criação (`LoanFormModal` PF, `PJLoanFormModal` PJ): mesmos blocos, rótulos e estilos do formulário anterior. Natureza "Emprestei dinheiro"/"Peguei emprestado" (PF) e "Empresa tomou (passivo)"/"Empresa concedeu (ativo)" (PJ) no mesmo seletor segmentado, agora com rádios nativos; valor principal; data de início/contratação; **primeiro vencimento** (substitui "quitação prevista", hoje derivada); "Tipo de juros" (sem juros, percentual, valor fixo) e, no percentual, taxa, período (mês/ano) e **amortização** (Price, SAC ou simples, escolha obrigatória); "Dividir em parcelas" com a quantidade (até 360). "Forma de pagamento" saiu (fora do contrato). PJ mantém classificação contábil, dados da contraparte (tipo, CNPJ/CPF, contato) e centro de custo; PF não envia nenhum campo PJ (`toCreateLoanPayload`). As notas de fluxo foram corrigidas: o principal entra/sai do caixa e não é receita nem despesa.
- Detalhe (`LoanDetailsView`, `PJLoanDetailsView`): mesma estrutura; só campos autoritativos (saldo pendente = `balanceCents`, principal liquidado, juros previstos e pagos/recebidos, taxa e amortização, status em pt-BR); em PJ, classificação, contraparte e documento sob o centro de custo. O cronograma persistido continua na lista de parcelas (`loans/LoanSchedule.tsx`), agora com principal e juros de cada parcela além do total e da situação; o histórico (`loans/LoanMovementHistory.tsx`) mostra contratação, pagamentos/recebimentos e estornos com data, principal, juros, total, situação e a relação estorno ↔ original; o original estornado continua visível (texto e borda tracejada) e não oferece segundo estorno.
- Ações (`loans/useLoanOperations.tsx` e diálogos sobre `loans/LoanDialog.tsx`, que reproduz as molduras anteriores): pagamento/recebimento no diálogo de movimento PF/PJ ("Registrar Pagamento"/"Novo Lançamento"), com principal, juros e data (sugestão da próxima parcela, editável) e o total do lançamento; o botão fica desabilitado quando o contrato não está em aberto e oculto para quem não administra. Estorno e cancelamento no visual do `ConfirmationModal` que a exclusão usava, com motivo obrigatório; o lixo "Excluir" virou "Cancelar empréstimo" (explica que nada é apagado, que o principal é compensado no caixa e que pagamentos ativos precisam ser estornados antes). "Editar dados"/"Editar Operação" (o botão PJ já existia, sem função) só com campos não financeiros. Após sucesso, recarrega contrato, movimentos e dependentes de caixa.
- Reenvio seguro: cada diálogo guarda o contrato como estava ao abrir; um reenvio depois de falha incerta usa o mesmo payload, a mesma `expectedUpdatedAt` e a mesma chave, e um conflito real continua visível. Defeito encontrado no desenho (o refresh mudava a versão e geraria nova chave, podendo duplicar um pagamento) e provado corrigido pelo E2E "versão concorrente e reenvio".

**Totais** (`src/modules/loans/api.ts` `getLoanTotals`): `sum('balanceCents')` com `type ==` e `status in ['active','overdue']` e `count()` de `overdue`, por agregado do servidor (índice `type, status, balanceCents`); `paid` e `cancelled` fora; centavos inteiros; nenhuma leitura da coleção. O cálculo antigo por `currentBalance` e o índice correspondente foram removidos.

**RBAC na interface** (`loanPermissions` em `presentation.ts`): owner/admin tudo; member cria e administra só o que criou (`createdBy`); viewer só lê (sem botões de criação ou ação). A perda de papel com a tela aberta é recusada pelo backend (relê o papel na transação) e a mensagem pt-BR orienta a recarregar.

**Escritores e motor removidos** (busca no código e guarda estático `tests/unit/loans-no-client-writes.test.ts`): `addDoc`/`updateDoc`/`deleteDoc`/`setDoc`/`writeBatch`/`runTransaction` em `loans`/`loan_movements`; `createMovement`, `updateLoan`, `deleteLoan`; espelho `onAddTransaction` das telas; IDs `Date.now()`; saldo/status persistidos pelo cliente; `generateInstallmentPlan` e `generatePJAmortizationPlan` (`logic.ts`, `pj-logic.ts`); `LoanMovementModal` e `PJLoanMovementModal`; `functions/src/loans/legacyAnalysis.ts` e o seu teste; `loanId`/`loanMovementId` do tipo `Transaction` e das allowlists de `transactions` nas Rules e em `LEGACY_CLIENT_KEYS`.

**Rules finais** (`firestore.rules`): `loans` e `loan_movements` com `allow read: if canReadWorkspaceScopedData(workspaceId)` e `allow create, update, delete: if false` para todo papel; `loan_events` leitura owner/admin com teto de 100 e escrita negada; transações do cliente não aceitam `loanEntry`, `loanId` nem `loanMovementId`. As funções `hasAuthoritativeLoanKeys`/`hasAuthoritativeLoanMovementKeys` da P3-G foram removidas (sem escrita do cliente, não há o que validar).

**Idempotência de metadados (garantia final).** `updateLoanMetadata` usa o recibo do ator (sem escrita até concluir) e a âncora durável `loan_events(intentId, operation)`. Alteração sem efeito é recusada com `domain_precondition_failed` ("Nenhum dado foi alterado…") e não grava nada (nem recibo, nem evento): não há evento falso de mudança e não é preciso âncora nova. Provado em integração: replay antes da expiração (recibo) e depois dela (âncora, `changed: true`); mesma chave em outro contrato = conflito, antes e depois da expiração; contrato alterado entre as tentativas (liquidação) = o replay continua replay, sem segunda alteração nem conflito de versão, e o valor posterior não é desfeito; chamadas concorrentes com a mesma chave = um efeito e um evento; eventos só com nomes de campos.

**Arquivos.**
- Criados: `src/modules/loans/{money,adapters,payloads,presentation,callables}.ts`; `src/components/loans/{LoanDialog,LoanTermsFields,LoanSchedule,LoanMovementHistory,LoanPaymentModal,LoanReasonModal,LoanMetadataModal,useLoanOperations}.tsx`; `tests/unit/{loan-input,loan-model,loans-no-client-writes}.test.ts`; `e2e/support/loans.ts`, `e2e/loans-pf.spec.ts`, `e2e/loans-pj.spec.ts`; `docs/production/evidence/p3h/` (capturas "depois", "antes" e `axe-e-teclado.json`).
- Reescritos/alterados: `src/modules/loans/{types,api,hooks}.ts`; telas `LoansView`, `PJLoansView`, `LoanCard`, `PJLoanCard`, `LoanFormModal`, `PJLoanFormModal`, `LoanDetailsView`, `PJLoanDetailsView`; `src/App.tsx`; `src/types.ts`; `src/modules/transactions/{cashEntry,hooks}.ts`; `src/modules/investments/semantics.ts` e `src/modules/reports/{logic,api}.ts` (espelho de empréstimo fora de receita/despesa operacional nos relatórios; total de dívida em centavos); `functions/src/loans/{operations,callables,model}.ts`; `functions/src/cash/eligibility.ts`; testes de integração `loanGuards`, `loanLifecycle`, `scaleQueries`; Rules M4 e adjacentes; `firestore.rules`; `firestore.indexes.json`; `package.json` (`test:unit:loans` em `verify:fast`); `.github/workflows/quality-gate.yml`; documentos de `docs/production/`.
- Removidos: `functions/src/loans/legacyAnalysis.ts`; `src/modules/loans/logic.ts`, `pj-logic.ts`; `src/components/LoanMovementModal.tsx`, `PJLoanMovementModal.tsx`.

**Validação (resultados desta entrega).**
- `npm run verify:all` integral sobre o working tree final: **PASS** (código de saída 0).
  - `verify:fast`: typecheck do frontend e das Functions; lint das Functions com 0 erros (1.961 avisos, o mesmo total da P3-G; um aviso novo de comprimento de linha no teste de escala foi corrigido e o lint revalidado); build do frontend e das Functions; unitários das Functions **414/414**; frontend: investimentos 175/175, P1 128/128, billing 43/43, UI 5/5, caixa 13/13, **empréstimos 21/21** (conversões 8, modelo e apresentação 9, guarda estático 4).
  - `test:integration:emulator`: integração das Functions **532/532** (`loanLifecycle` 11, `loanGuards` 10, `scaleQueries` 7 no schema autoritativo); guarda da ferramenta de limpeza 15/15; Rules **104/104** (metas 5, investimentos 7, domínio de investimentos 19, M3 7, M4 41, adjacentes 5, workspaces 10, billing 10).
  - `test:e2e`: **68/68** (inclui os 8 novos de empréstimos: PF 6, PJ 2).
- Os números da P3-G (unitários 414, integração 531, Rules 104, E2E 60) não são resultados desta entrega; nenhuma suíte com `skip`/`only`, nenhum timeout aumentado, nenhuma repetição artificial.
- Execuções direcionadas durante a entrega: integração de empréstimos 21/21; Rules M4 41/41 e adjacentes 5/5; `scaleQueries` 7/7 (também depois do ajuste de lint); E2E de empréstimos 8/8 em cada rodada sobre a interface final; captura de evidências 1/1.

**Mutações** (`mutate-p3h`, cada uma aplicada, suíte direcionada executada, código restaurado e recompilado):
14 mutações, todas **detectadas**:
- H1 Rules: cliente cria contrato · H2 Rules: cliente altera movimento · H3 Rules: `loanId` volta à allowlist de transações → Rules M4 falham.
- H4 a API do cliente volta a gravar empréstimo (`addDoc`) · H5 totais somam `principalCents` em vez de `balanceCents` · H6 cancelado entra nos totais do servidor · H12 o frontend volta a criar espelho de caixa → guarda estático falha.
- H7 cancelado entra no saldo exibido · H8 juros reduzem o saldo exibido · H11 member administra contrato alheio na interface → unitários falham.
- H9 juros reduzem o saldo no backend · H10 member altera contrato alheio no backend · H13 metadados sem efeito gravam recibo → integração no Emulator falha.
- H14 o diálogo reenvia com a versão recarregada (nova chave) → E2E "versão concorrente e reenvio" falha (as duas chamadas usam chaves diferentes).
- Depois da restauração visual (abaixo), H4–H8, H11, H12 e H14 foram reexecutadas sobre a interface final: todas detectadas.

**Evidência visual e acessibilidade.** Capturas "antes" (base P3-G extraída do ZIP, dados sintéticos no formato antigo; 32 em `evidence/p3h/antes/`) e "depois" (64 em `evidence/p3h/`): PF e PJ, desktop 1440×900 e celular 390×844, claro e escuro; lista, criação, detalhe, cronograma/histórico, pagamento e, só no depois, estorno, cancelamento e edição de dados. Diferenças visíveis restantes, todas exigidas pelo contrato: status e rótulos em pt-BR (antes "ACTIVE", "CANCELLED", "PAID", "PENDING"), campos novos (primeiro vencimento, taxa/período/amortização, juros previstos e pagos, principal e juros por parcela e por movimento), campos que deixaram de existir (quitação prevista e forma de pagamento no formulário, método previsto no detalhe), "Cancelar empréstimo"/"Editar dados" no lugar da lixeira, botão de pagamento desabilitado fora de contrato em aberto e oculto para quem não administra, e totais sem o cancelado (antes R$ 11.600,00 a pagar, somando o cancelado; depois o saldo aberto em centavos). Sem rolagem horizontal em nenhuma combinação. axe-core 4.13 (WCAG 2.0/2.1 A e AA): **diálogos sem violações**; teclado registrado em `axe-e-teclado.json` (foco inicial no título, Tab preso no diálogo, rádios por setas, Escape fecha e devolve o foco). As violações de contraste restantes nas listas e nos detalhes vêm de classes da P3-G mantidas por instrução de não alterar o visual (valores verde/amarelo-600 dos totais, cabeçalho teal e avatar, verde/vermelho-600 de valores e situações no histórico, cinza-400 e chips verde/cinza das parcelas); a auditoria da base (`antes/axe-antes.json`) mostra as mesmas classes violando antes da P3-H. Ficam registradas para uma estabilização de interface dedicada.

**Autorrevisão.** Corrigido ou provado antes do fechamento:
- **Reenvio após falha incerta:** o refresh depois do erro mudava `expectedUpdatedAt`, gerando chave nova e risco de pagamento duplicado; o diálogo passou a guardar o contrato como estava ao abrir (E2E e mutação H14).
- **Fidelidade visual:** a primeira versão das telas mudou espaçamentos, tamanhos de fonte, posição de botões, a grade histórico/cronograma, o cronograma (lista → tabela) e as molduras dos diálogos. A comparação com a base levou a restaurar classes e estrutura da P3-G (`LoanDialog` com as molduras PF/PJ de formulário e de movimento e a do `ConfirmationModal`; cronograma de volta à lista de parcelas); os E2E foram ajustados aos rótulos da base sem afrouxar asserções (contagem e conteúdo das parcelas, juros previstos por `data-testid`, botão desabilitado em vez de ausente quando o contrato não está em aberto).
- **Teste de escala:** `scaleQueries.integration.test.ts` ainda semeava e somava `currentBalance`; passou ao schema autoritativo (`balanceCents`, `active`/`overdue`, cancelados com saldo residual fora do total) e o mesmo foi feito no teste de Rules dos módulos adjacentes.
- **Captura de evidência:** uma captura pegou um cartão no meio da animação; a captura passou a esperar as animações finitas antes do screenshot.

**Revisões especializadas** (uma vez cada, limitadas ao diff da P3-H):
- **`financial-domain-integrity`: FAIL** no escopo de P3, que continua aberto; nenhum achado bloqueante na fatia P3-H. Na fatia: autoridade só no backend (escritores do cliente removidos, Rules negando qualquer escrita, guarda estático), schema único, centavos e taxa inteira da tela ao servidor, saldo só pelo principal (mutações H8/H9), juros como resultado financeiro, cancelado fora dos totais (H6/H7), estorno e cancelamento compensatórios sem hard delete, idempotência e concorrência (inclusive reenvio pela interface, H14), totais por agregado reconciliados com a soma documento a documento sob volume, e legado removido com prova por busca. Bloqueiam o escopo P3: o gráfico de perfil de dívida dos relatórios ainda mostra "Empréstimos" pelo stub `totalLoans: 0` (LOAN-12, P5); dupla representação `value`/`valueCents` nos lançamentos (PR-TX-03); sem reconciliação agendada acumulados × movimentos (P7); recebíveis (D-39) não iniciados.
- **`multi-tenant-security-review`: PASS.** Rules (`loans`/`loan_movements` sem escrita para nenhum papel; leitura por `canReadWorkspaceScopedData`; `loan_events` só owner/admin com teto) e backend (papel relido na transação, `member` limitado por `createdBy`, documento fora do schema recusado) como camadas independentes; teste de Rules com owner/admin/member/viewer negados em criar, alterar, mesclar, apagar, lote e transação, leituras permitidas aos quatro e negadas ao outro tenant; agregados negados nos dois sentidos entre tenants; E2E de member, viewer e perda de papel com a tela aberta; mutações H1–H3, H10, H11 detectadas.
- **`firestore-scale-cost-review`: PASS.** Sem listener; lista paginada por ID (101 leituras por página), detalhe 1 leitura + página de movimentos (101), totais por 3 agregados com índice `loans(type, status, balanceCents)` (o índice de `currentBalance` saiu), histórico pelo índice `loan_movements(loanId, date, __name__)`; após cada callable, recarga limitada às páginas abertas, aos 3 agregados e aos dependentes de caixa; metadados sem efeito não gravam nada; testes de escala (2.000 contratos, cancelados com saldo residual fora do total) e de isolamento no Emulator.
- **`privacy-lgpd-data-lifecycle`: PASS** no escopo da P3-H. Contraparte só no contrato (criação e `updateLoanMetadata`), PF sem campos PJ, espelho genérico, `loan_events` só com nomes de campos, console do cliente só com IDs, nenhum armazenamento local; a interface deixou de copiar o nome da contraparte para o caixa (linha 10 de `PRIVACY_LGPD.md` encerrada). Fora desta avaliação (P8): exportação, eliminação e anonimização de contrapartes (LOAN-16, D-07) e retenção por categoria (D-18).
- **`ptbr-product-ui-review`: PASS** (executada uma vez, depois da restauração visual). Conteúdo em pt-BR (status antes em inglês), erros do backend mapeados sem mensagem bruta do SDK, estados de carregamento, vazio, erro e sucesso anunciados, diálogos com foco e teclado corretos e sem violações de axe, sem rolagem horizontal; comparação antes/depois com mudanças só onde o contrato exige; contrastes restantes pré-existentes e inalterados (auditoria da base).
- **`billing-entitlement-integrity`: não executada.** Billing, planos, quotas e entitlements não mudaram; a única mudança perto deles (`LEGACY_CLIENT_KEYS` sem `loanId`/`loanMovementId`) só afeta documentos que `PROTECTED_LINK_KEYS` já classificava.
- **`regression-release-gate`: não executado**, por instrução desta etapa (não é fechamento de P3).

**Estado de PR-LOAN-01…PR-LOAN-07.** Resolvidos (§6), com a evidência acima: autoridade, concorrência, atomicidade, sem hard delete, vínculo de caixa, centavos/estorno e RBAC.

**Riscos residuais.**
- Relatórios de P5: o stub `totalLoans: 0` (LOAN-12) segue; os relatórios já excluem o espelho de receita/despesa operacional.
- Sem reconciliação agendada entre acumulados do contrato e movimentos (P7).
- Ciclo de vida das contrapartes (exportação, eliminação, anonimização; LOAN-16, D-07, D-18) em P8.
- Contraste pré-existente nos cards de resumo (verde/amarelo 600) e no cabeçalho, fora do escopo (sem mudança visual).
- **Abertos e preservados:** D-30, D-39, E-06, PR-AI-02/E-00, TX-15, P4–P10 e REQ-FUT-01 — Visualização financeira por tempo de trabalho.

**Rollback.** Reverter o diff da P3-H restaura a P3-G (interface antiga e Rules que aceitavam o formato anterior do cliente). Nada foi gravado fora do Emulator.

### 18.9 P3-I — clientes e recebíveis autoritativos, D-24, D-39, caixa atômico e remoção do modelo antigo (2026-10-05)

**Ponto de partida.** Working tree idêntico ao ZIP da P3-H (`dindin-minhas-financas-p3h-2026-10-05.zip`). Não há dados reais: o modelo antigo de clientes e recebíveis foi **removido**, não migrado; dados de teste são recriados pelas callables no Emulator. Nenhuma migração, backfill, schema duplo, adaptador, modo somente leitura antigo ou CRUD antigo preservado.

**Decisões tomadas** (implementadas e provadas por testes; §10):
- **D-24:** dados pessoais de clientes só para owner/admin. `clients/{clientId}` tem exatamente `clientId`, `workspaceId`, `name`, `status` (`active`|`archived`), `createdBy`, `createdAt`, `updatedBy`, `updatedAt` e `schemaVersion: 1`; documento, e-mail, telefone, endereço e observações ficam em `client_private/{clientId}` (Rules: `get` owner/admin, `list` owner/admin com `limit <= 100`, escrita negada). Defeito encontrado e corrigido durante a entrega: a primeira versão guardava no cadastro compartilhado o hash da intenção, calculado sobre o payload com CPF/CNPJ — um member poderia testar candidatos de documento contra o hash. O hash saiu do cadastro; a âncora durável da criação passou a ser o evento `client.created` (owner/admin) — provado pela asserção das chaves exatas do documento e pela mutação I10.
- **D-39:** recebível com `amountCents`, `principalReceivedCents`, `discountGrantedCents`, `interestReceivedCents`, `penaltyReceivedCents`, `balanceCents`, `activeReceiptCount`, `dueDate` civil e `status` (`open`|`received`|`cancelled`). Invariantes: `balance = amount − principalRecebido − desconto`, `balance ≥ 0`, `received` se e somente se saldo 0, `cancelled` terminal e só sem recebimento ativo, centavos inteiros. **Atraso não é persistido:** `open` com `dueDate` antes de hoje em São Paulo, função única no backend (`isReceivableOverdue`, `functions/src/receivables/model.ts`) e no frontend (`src/modules/clients/presentation.ts`). Juros e multa não abatem o saldo; desconto abate o saldo e não é dinheiro; caixa = principal + juros + multa. Exemplo provado em integração: saldo R$ 1.000, recebe R$ 900 com R$ 100 de desconto → caixa R$ 900, saldo 0, `received`.

**Backend** (`functions/src/receivables/`: `contracts.ts`, `model.ts`, `common.ts`, `clientOperations.ts`, `operations.ts`, `cashEffect.ts`, `callables.ts`; exportadas em `functions/src/index.ts`; o codebase passa a 81 endpoints e 74 callables):
- Clientes: `createClient`, `updateClient`, `archiveClient` (owner/admin). Recebíveis: `createReceivable`, `updateReceivable`, `receiveReceivable`, `reverseReceivableReceipt`, `cancelReceivable` (owner/admin; member só nos que criou, por `createdBy` gravado pelo backend; viewer nunca). Perfil `DOMAIN_CALLABLE_OPTIONS`; só espaço PJ (o tipo vem do workspace persistido).
- Toda mutação: uma transação; autorização relida dentro dela (conta ativa, membership ativo, papel, workspace ativo, PJ); schema `.strict()` (status, saldo, acumulados, autoria, IDs e timestamps recusados); IDs determinísticos do backend; idempotência por intenção (recibo `users/{uid}/idempotency_keys` + âncora durável no evento da operação, consulta de grupo `intentId, operation` com `limit(1)`; mesma chave com outro conteúdo = conflito, antes e depois da expiração); `expectedUpdatedAt` com nanossegundos; documento fora do schema = falha fechada; relógio do servidor; trilhas append-only `client_events`/`receivable_events` com ator, papel, intenção, `requestId`, antes/depois em centavos e só nomes de campos; logs só com IDs.
- `archiveClient` recusa com recebível em aberto (consulta na transação, `limit 1`); arquivado não recebe novo recebível e continua referenciado. `updateReceivable`: descrição, categoria e vencimento; valor só sem recebimento ativo e sem desconto. `receiveReceivable`: algum efeito; principal + desconto ≤ saldo; movimento imutável `receivable_movements/rmv_*` e, havendo dinheiro, espelho `transactions/recvcash_*` no mesmo commit (desconto puro não gera espelho). `reverseReceivableReceipt`: movimento compensatório com `reversalOf`/`reversedBy`, restaura principal, desconto, juros, multa e saldo, rederiva o status e compensa o espelho no mesmo commit; segundo estorno recusado. `cancelReceivable`: lógico, com motivo, recusado com recebimento ativo, sem caixa, sem reativação.
- Caixa: marca `receivableEntry` com descrição genérica e só IDs; projeção (`functions/src/cash/periods.ts`): principal → `incomeCents`, juros + multa → `financialIncomeCents`, `netCents` = principal + juros + multa, desconto fora; a reconstrução usa a mesma função (provado em integração). `receivableEntry` em `PROTECTED_LINK_KEYS` (o caixa manual não corrige nem anula o espelho) e em `BACKEND_MIRROR_KEYS` (não consome a quota mensal, D-40).
- Limites operacionais `clientMutation` e `receivableMutation` (60/10 min por ator; replay, recusa e falha antes do commit não consomem). Nenhuma quota comercial, preço ou plano novo. Janela sem escritas no ledger: recebimento com dinheiro e estorno recusados; desconto puro, criação, edição e cancelamento seguem.

**Rules e índices.** `clients`, `receivables`, `receivable_movements`: leitura de membro ativo; `create`, `update`, `delete` negados a todo papel. `client_private`, `client_events`, `receivable_events`: só owner/admin, listagem com teto, escrita negada; os três entraram em `isBackendOwnedCollection` — sem isso a regra genérica de subcoleção entregaria dados pessoais a member e viewer (mutação R1). `isPlainClientTransaction` lista `receivableEntry` como marca do backend e a allowlist de lançamentos do cliente não a aceita. Índices novos: `receivables(clientId, status)`, `(status, dueDate, balanceCents)`, `(status, balanceCents)`, `(status, principalReceivedCents)`; `receivable_movements(receivableId, date DESC, __name__ DESC)`; `clients(status, name)`; grupo `client_events` e `receivable_events` `(intentId, operation)`. A base não tinha índice de clientes/recebíveis a remover.

**Interface** (mesmo visual; comparação antes/depois em `docs/production/evidence/p3i/antes/` e `docs/production/evidence/p3i/`):
- Módulo novo `src/modules/clients/{types,adapters,payloads,presentation,callables,api,hooks}.ts`: só leitura (páginas por cursor com desempate por ID, teto na lista de clientes ativos, agregados `sum`/`count` do servidor), nenhum listener; escrita só pelas callables, chave por intenção reusada no reenvio; diálogos guardam o registro como estava ao abrir.
- Telas `ClientsReceivablesView`, `ClientFormModal`, `ReceivableFormModal` reescritas com as mesmas classes; diálogos novos em `src/components/clients/` (`ClientsDialog` reproduz a moldura dos modais do módulo e a do `ConfirmationModal`). Lista com descrição, cliente, vencimento, valor original, **saldo**, status derivado (Em aberto / Em atraso / Recebido / Cancelado) e ações. "Marcar Recebido" virou "Registrar recebimento" (principal sugerido = saldo, juros, multa, desconto, data; total que entra no caixa e saldo após). Histórico com data, principal, juros, multa, desconto ("não é dinheiro"), total recebido e relação de estorno. "Excluir cliente" virou "Arquivar cliente", com a explicação e o bloqueio quando há recebível em aberto. Cancelar e estornar com motivo obrigatório. Cartões pelo saldo aberto do servidor.
- Member e viewer: lista mínima de clientes ("Restrito" nas colunas de contato e documento) e a interface **não consulta** `client_private` (provado por E2E que inspeciona os pedidos do navegador ao Firestore, mutação E2).
- Mudanças visíveis restantes, todas exigidas pelo contrato: coluna "Saldo", status em pt-BR (antes "PENDING", "PAID", "OVERDUE", "CANCELLED"), totais pelo saldo (antes pelo valor original, somando o recebido parcial), seletor "Status" fora do formulário, datas corretas (antes um dia antes: "hoje" em UTC, CR-11), selo "Arquivado", "Restrito" para member/viewer, ações acessíveis também por foco (antes só no hover) e com nome acessível.
- Semântica do caixa no frontend (`src/modules/investments/semantics.ts`): `operationalIncomeOf` conta só o principal do espelho; estorno não é despesa operacional; "Receitas" do dashboard e relatórios seguem a projeção do backend.
- Relatórios (`src/modules/reports/{logic,api,hooks}.ts`, `ReportsView`, `ReportsWidget`): "Contas a Receber" pelo saldo aberto do servidor; situação (Em aberto, Em atraso, Recebido) por agregados; inadimplência pela contagem derivada; ranking de clientes pelo valor original dos não cancelados numa amostra com teto de 500 (aviso de ranking parcial no teto) — **dívida P5:** agregado por cliente no servidor.

**Removido** (busca no código, guarda estático `tests/unit/clients-no-client-writes.test.ts` que varre o disco, Rules): `addDoc`/`updateDoc`/`deleteDoc`/`writeBatch` de clientes e recebíveis, `cleanPayload` do módulo, `useUpdateReceivableStatus` (com `as any`), `useDeleteClient`, `useDeleteReceivable`, `deleteClient`/`deleteReceivable` e a cascata, `value` em reais, `parseFloat`, status `pending`/`paid`/`overdue` persistidos, `catch => []`, `new Date('AAAA-MM-DD')`/`toISOString().split('T')` para vencimento, Rules `canMemberWriteWorkspaceScopedData` em `clients`/`receivables`. A ferramenta `tools/investments/limpar-investimentos.mjs` passou a proteger também `client_private`, `client_events`, `receivable_movements` e `receivable_events`.

**Testes novos.**
- Functions: `receivableContracts.test.ts` (7), `receivableLifecycle.integration.test.ts` (10), `receivableGuards.integration.test.ts` (14): clientes, PII, recebíveis, parcial, juros, multa, desconto, quitação, estorno, cancelamento, atraso derivado, RBAC, cross-tenant nos dois sentidos, conta suspensa, membership removido, workspace arquivado, idempotência antes e depois da expiração, concorrência (recebimentos simultâneos acima do saldo, recebimento × cancelamento, recebimento × valor, arquivar × criar recebível), falha antes do commit e reenvio depois do commit, limite operacional, janela sem escritas, falha fechada fora do schema (inclusive `overdue` gravado e o formato antigo), movimento de outro recebível, logs e respostas sem dados pessoais, reconstrução do caixa.
- Rules: `tests/firestore/receivables-p3i.rules.integration.test.mjs` (6): escrita negada a todos os papéis nas seis coleções; dados pessoais e auditoria só owner/admin com teto; isolamento nos dois sentidos e sem autenticação; formatos exatos de consulta do frontend (cursores atravessando página, agregados exatos); lançamento do cliente não forja nem altera espelho de recebimento.
- Frontend: `tests/unit/clients-model.test.ts` e `tests/unit/clients-no-client-writes.test.ts` (16: modelo e apresentação 9, guarda estático 7, `test:unit:clients` em `verify:fast` e no CI).
- E2E: `e2e/clients-receivables.spec.ts` (8): cadastro/edição/arquivamento (bloqueado e permitido); criação/edição em centavos e valor travado; parcial com juros e multa, quitação com desconto, exatamente um espelho por recebimento com dinheiro e projeção classificada; estorno e cancelamento; atraso derivado; RBAC member/viewer sem pedidos de dados pessoais; perda de papel e de sessão; versão concorrente e reenvio após resposta perdida com a mesma chave; troca de workspace.

**Validação (resultados desta entrega).**
- `npm run verify:all` integral sobre o working tree final: **PASS** (código de saída 0).
  - `verify:fast`: typecheck do frontend e das Functions; lint das Functions com 0 erros (1.961 avisos, o mesmo total da P3-H; os arquivos novos não têm nenhum); build do frontend e das Functions; unitários das Functions **422/422**; frontend: investimentos 175/175, P1 128/128, billing 43/43, UI 5/5, caixa 13/13, empréstimos 21/21, **clientes e recebíveis 16/16**.
  - `test:integration:emulator`: integração das Functions **556/556** (`receivableLifecycle` 10, `receivableGuards` 14); guarda da ferramenta de limpeza 15/15; Rules **110/110** (metas 5, investimentos 7, domínio de investimentos 19, M3 7, M4 41, adjacentes 5, workspaces 10, billing 10, **recebíveis 6**).
  - `test:e2e`: **76/76** (inclui os 8 novos de clientes e recebíveis).
- Os números da P3-H (unitários 414, integração 532, Rules 104, E2E 68) são só referência; nenhuma suíte com `skip`/`only`, nenhum timeout aumentado, nenhuma repetição artificial.
- Execuções direcionadas durante a entrega: integração de recebíveis 23/23 e 24/24; unitários de contratos 7/7; Rules de recebíveis 5/5; E2E de clientes e recebíveis 8/8 (uma asserção de ordem entre dois recebimentos da mesma data foi tornada determinística, localizando o item pelo conteúdo); suítes adjacentes do frontend depois da mudança de semântica do caixa (empréstimos 21, caixa 13, investimentos 175, UI 5, P1 128).

**Mutações** (`mutate-p3i`, cada uma aplicada, suíte direcionada executada, código restaurado): **26 de 26 detectadas**.
- Backend (integração no Emulator, e unidade quando indicado): I1 desconto entra no caixa (unidade + integração) · I2 juros abatem o saldo · I3 principal + desconto acima do saldo · I4 member opera recebível alheio · I5 arquivar com recebível em aberto · I6 cancelar com recebimento ativo · I7 estorno duplo · I8 valor alterável depois de recebimento · I9 dado pessoal no cadastro compartilhado · I10 hash da intenção no cadastro compartilhado · I11 recebimento ignora a âncora durável · I12 reconstrução classifica juros como receita operacional (unidade + integração).
- Rules: R1 `client_private` fora de `isBackendOwnedCollection` (PII pela regra genérica) · R2 member altera recebível · R3 auditoria sem teto · R4 lançamento aceita `receivableEntry` · R5 member lê dados pessoais pelo bloco próprio.
- Frontend (unidade/guarda): F1 API volta a gravar direto · F2 totais pelo valor original · F3 vence hoje conta como atraso · F4 member vê dados pessoais · F5 espelho inteiro como receita operacional · F6 desconto no total do caixa · F7 `parseFloat` volta ao formulário.
- E2E: E1 diálogo segue o registro recarregado (a intenção muda e o conflito de versão deixa de aparecer) · E2 member pede `client_private` (pedido do navegador detectado).

**Evidência visual e acessibilidade.** Capturas "antes" (base P3-H extraída do ZIP, dados sintéticos no formato antigo; 16 em `evidence/p3i/antes/`) e "depois" (44 em `evidence/p3i/`): desktop 1440×900 e celular 390×844, claro e escuro; listas de recebíveis e clientes, novo cliente, novo recebível e, só no depois, edição de cliente, recebimento, histórico, cancelamento bloqueado, arquivamento bloqueado, estorno e a lista de clientes vista por member. Sem rolagem horizontal da página em nenhuma combinação. axe-core 4.13 (WCAG 2.0/2.1 A e AA): **todos os diálogos sem violações** (a base tinha `label`, `select-name` e `button-name` nos formulários e nos botões de ação, corrigidos); teclado em `axe-e-teclado.json` (foco inicial no título, Tab e Shift+Tab presos, Escape fecha e devolve o foco, ações da linha visíveis ao receber foco). Violações de contraste restantes nas listas vêm de classes mantidas da base (cabeçalho teal e menu da conta, data vencida `text-red-500`, telefone `opacity-70`, aba ativa no escuro), presentes igualmente em `antes/axe-antes.json`. Um contraste introduzido (botão "Estornar" no escuro) foi corrigido antes da captura final.

**Ambiente.** O firebase-tools (`apiv2`) envia toda requisição, inclusive as do próprio Emulator em `127.0.0.1`, pelo `HTTPS_PROXY`, ignorando `NO_PROXY`; o proxy da sessão passou a recusar esse tráfego e o Emulator com Functions não subia. As execuções com Emulator usaram, só no processo do Firebase CLI, um encaminhador local que respeita `NO_PROXY` (destinos locais diretos; qualquer outro destino continua pelo proxy da sessão). Nada no repositório mudou por causa disso.

**Revisões especializadas** (uma vez cada, limitadas à fatia P3-I):
- **`financial-domain-integrity`: FAIL** no escopo de P3, que continua aberto; nenhum achado bloqueante na fatia P3-I. Na fatia: fonte única (recebível autoritativo e movimentos no backend; caixa só pelo espelho do mesmo commit), centavos e datas civis, semântica (principal operacional, juros e multa financeiros, desconto fora do caixa), estorno e cancelamento compensatórios sem exclusão, idempotência e concorrência com testes, totais pelo saldo reconstruíveis, reconstrução do caixa igual à projeção, legado removido com prova por busca, Rules e guarda. Bloqueiam o escopo P3: PR-TX-03 (dupla representação `value`/`valueCents` nos lançamentos), ausência de reconciliação agendada acumulados × movimentos × espelhos (P7) e os stubs de relatório de P5 (perfil de dívida, ranking de clientes por amostra); D-30 aberta.
- **`multi-tenant-security-review`: PASS.** Backend (papel, membership, conta, workspace ativo e PJ relidos na transação; `createdBy` do servidor; recebível, movimento e cliente presos ao workspace autorizado; IDs alheios = não encontrado) e Rules (escrita negada, PII e auditoria só owner/admin, catch-all fechado) como camadas independentes; testes de dois tenants nos dois sentidos, sem autenticação, member/viewer, removido, suspenso, arquivado, payload com ID de outro recebível, concorrência e replay; mutações I4, R1–R5, F4, E2.
- **`firestore-scale-cost-review`: PASS.** Sem listener; listas por cursor (`name`/`dueDate`/`date` + ID) com `limit` de página + 1; clientes ativos com teto de 500; dados pessoais e nomes por `in` em blocos de 30; cartões por 3 agregados e relatório por 3 agregados + amostra de 500 + até 5 nomes; arquivamento com consulta `limit 1` na transação; âncora de grupo seletiva (`intentId`) com `limit 1`; recebimento ≈ 6 escritas + gatilho do caixa; idempotência e limites com TTL existente; índices compostos versionados; cursores atravessando página testados no Emulator.
- **`privacy-lgpd-data-lifecycle`: PASS** no escopo da P3-I. Inventário atualizado (`PRIVACY_LGPD.md`, linhas 7 e 8, inclusive texto livre); dados pessoais só em `client_private` e só para owner/admin (Rules, E2E sem pedido do navegador, mutações I9, I10, R1, R5, F4, E2); nenhum dado pessoal em recebíveis, movimentos, eventos, espelhos, logs ou respostas (asserções de integração com captura de log); nenhum armazenamento local. Fora desta avaliação (P8): exportação, eliminação e anonimização de clientes e retenção por categoria (PR-CR-05, D-07, D-18, E-09).
- **`ptbr-product-ui-review`: PASS.** Conteúdo em pt-BR (status antes em inglês), erros do backend mapeados sem mensagem bruta do SDK, estados de carregamento, vazio, erro e sucesso, diálogos com foco e teclado corretos e sem violações de axe, sem rolagem horizontal; comparação antes/depois com mudanças só onde o contrato exige; contrastes restantes pré-existentes e inalterados.
- **`billing-entitlement-integrity`: não executada.** Planos, preços, quotas comerciais e entitlements não mudaram; o espelho de recebimento só entra em `BACKEND_MIRROR_KEYS` (não consome a quota manual, como os demais espelhos) e os limites novos são operacionais.
- **`regression-release-gate`: não executado**, por instrução desta etapa (não é fechamento de P3).

**Estado de PR-CR-01…PR-CR-05.** PR-CR-01…PR-CR-04 resolvidos (§6). PR-CR-05 parcial (D-24 feita) e continua em P8.

**Riscos residuais.**
- Ranking de clientes do relatório por amostra com teto (aviso no teto); agregado por cliente no servidor fica para P5.
- Sem reconciliação agendada entre acumulados do recebível, movimentos e espelhos (P7).
- Ciclo de vida dos dados de terceiros (exportação, eliminação, anonimização, retenção; PR-CR-05, D-07, D-18) em P8.
- Texto livre (descrição, categoria, motivos) pode conter dado pessoal digitado pelo usuário e é visível aos membros.
- Contraste pré-existente nas listas (classes da base), fora do escopo por não haver mudança visual.
- **Abertos e preservados:** D-30, E-06, PR-AI-02/E-00, TX-15, P4–P10 e REQ-FUT-01 — Visualização financeira por tempo de trabalho.

**Rollback.** Reverter o diff da P3-I restaura a P3-H (tela e Rules antigas de clientes/recebíveis). Nada foi gravado fora do Emulator.

### 18.10 P3-J — D-30, contas/carteiras autoritativas, transferências e fechamento técnico do caixa da P3 (2026-10-06)

**Ponto de partida.** Working tree idêntico ao ZIP da P3-I (`dindin-minhas-financas-p3i-2026-10-05.zip`). Não há dados reais: o grupo genérico `wallet` do catálogo foi **removido**, não migrado; dados de teste são recriados pelas callables e pelos seeds do Emulator. Nenhuma migração, backfill de carteira antiga, compatibilidade de schema, modo somente leitura antigo ou dupla autoridade.

**Decisão D-30** (tomada, implementada e testada; §10): contas/carteiras autoritativas com saldo do backend e livro-razão imutável; transferência como tipo de movimento próprio, de efeito global zero, nunca receita, despesa nem `transactions`.

**Modelo** (`functions/src/accounts/model.ts`, todos `[B]`, só o backend grava):
- `cash_accounts/{acc_*}`: `schemaVersion: 1`, `workspaceId`, `name` (≤ 80), `accountType` (`cash`, `checking`, `savings`, `digital`, `other`), `status` (`active`|`archived`), `balanceCents` inteiro com sinal (negativo permitido; |saldo| ≤ R$ 1 trilhão), `currency`, autoria e timestamps, `lastMovementAt`. Conta padrão "Carteira principal" (`acc_` + hash de `{workspaceId}:default`) criada pelo provisionamento do workspace com o evento `cash_account.created`. **Teto operacional de 100 contas por workspace** (ativas e arquivadas; contagem relida na transação), porque a lista, as escolhas de conta e o saldo geral leem até 100 contas (teto de listagem das Rules).
- `cash_account_movements/{acm_*}`: fato imutável — `accountId`, `kind` (`opening_balance`, `cash_transaction`, `loan`, `receivable`, `transfer_in`, `transfer_out`, `reversal`), `amountCents` com sinal (nunca zero), `effectiveDate` civil, `sourceDomain`/`sourceId`/`sourceFactId`, `reversalOf`, `actorId`, `operation`, `requestId`, sem dado pessoal. IDs determinísticos por fato.
- `cash_transfers/{trf_*}` (origem, destino, valor, data, descrição opcional, `status` `completed`|`reversed`, `createdBy`, pernas e estorno) e `cash_account_events` (auditoria append-only).
- Primitiva única do livro-razão (`functions/src/accounts/ledger.ts`): fase de leitura (contas relidas no workspace autorizado, falha fechada fora do schema) e fase de escrita que cria os movimentos e grava o saldo absoluto novo **no mesmo commit**; recusa conta arquivada para qualquer movimento, valor zero ou não inteiro e saldo fora do teto.

**Callables** (6, perfil `DOMAIN_CALLABLE_OPTIONS`; o codebase passa a **87 endpoints e 80 callables**): `createCashAccount` (saldo inicial opcional → movimento `opening_balance` no mesmo commit; não é receita, despesa nem quota), `updateCashAccount` (só nome e tipo; o saldo nunca é editável), `archiveCashAccount` (só com saldo zero; sem exclusão), `reactivateCashAccount` — owner/admin; `createCashTransfer` (owner/admin/member; contas diferentes, ativas e do mesmo workspace; valor positivo; data até hoje em São Paulo; um commit com as duas pernas) e `reverseCashTransfer` (owner/admin qualquer, member só a própria; movimentos compensatórios; segundo estorno recusado; replay idempotente). Schema `.strict()`, autorização relida dentro da transação, idempotência por intenção (recibo do ator + âncora durável no evento, consulta de grupo `intentId, operation` com `limit 1`), `expectedUpdatedAt` com nanossegundos, limites operacionais `cashAccountMutation` e `cashTransferMutation` (60/10 min por ator).

**Produtores da P3 no livro-razão (mesmo commit do fato):**
- Lançamento manual: todo lançamento carrega `cashAccountId`; confirmado move a conta (receita +, despesa −), pendente não move até a confirmação (que pode informar outra conta); correção que muda valor, tipo, conta ou data compensa o efeito antigo e aplica o novo; anulação compensa. Lançamento antigo sem conta exige escolha explícita na confirmação ("Conta: informe a conta usada na liquidação.").
- Importação: `cashAccountId` do lote; replay não duplica; quota D-40 inalterada.
- Empréstimos: captação soma e concessão subtrai o principal; cada liquidação usa a conta informada (principal + juros); estorno e cancelamento usam a conta do movimento original; D-13 mantida.
- Recebíveis: conta obrigatória quando há dinheiro; movimento = principal + juros + multa; desconto não move conta; estorno na conta original; D-39 mantida.
- **Invariante global** (provado em integração): Σ saldos das contas = Σ saldos iniciais + Σ efeito de caixa (`netCents`) dos produtores da P3 desde a P3-J; transferências somam zero; saldo inicial e transferência ficam fora de receitas, despesas e quota.

**Não convergido (P4), sem falsa garantia.** Recorrência, divisão de contas, cartões/parcelado, correção e baixa de lançamento não elegível e investimento continuam gravando `transactions` pelos escritores diretos e **não movem contas**; a tela de contas diz isso ("Os saldos refletem lançamentos manuais, transferências, empréstimos e recebimentos de recebíveis. Recorrências, divisão de contas, cartões e investimentos ainda não movimentam as contas."). Só a escolha de conta foi ligada onde a P3 a exige; cartões, recorrência e divisão não foram tocados.

**Rules e índices.** As quatro coleções entram em `isBackendOwnedCollection`; `cash_accounts`, `cash_account_movements`, `cash_transfers`: leitura de membro ativo (viewer incluído) com `limit <= 100`, criação, alteração e exclusão negadas a todo papel; `cash_account_events`: só owner/admin, com teto. O cliente não grava `cashAccountId` em lançamento (`isPlainClientTransaction`), `walletId` saiu das allowlists e `'wallet'` de `isValidCatalogGroup`. As Rules de escrita do cliente em `transactions` permanecem só para os produtores da P4. Índices novos: `cash_account_movements (accountId, effectiveDate DESC, __name__ DESC)` e grupo `cash_account_events (intentId, operation)`.

**Interface** (mesmo visual nas telas existentes; comparação em `docs/production/evidence/p3j/antes/` e `docs/production/evidence/p3j/`):
- Configurações ganha o cartão "Contas e carteiras" (no lugar da seção "Carteiras" do catálogo): saldo por conta pelo `balanceCents`, "Saldo geral" somado no servidor (`getAggregateFromServer`), aviso de cobertura, nova conta, edição, arquivamento (bloqueado com saldo, com a explicação), reativação, extrato paginado por cursor e transferências com revisão antes de enviar ("Confirmar transferência") e histórico paginado com estorno (motivo obrigatório).
- Escolha de conta ("Conta/carteira") no lançamento manual e na confirmação de pendente, na contratação e na liquidação de empréstimo e no recebimento; a primeira conta ativa vem marcada na criação; a conta já vinculada aparece mesmo arquivada, marcada "(arquivada)".
- Módulo `src/modules/accounts/` só lê (sem listener) e escreve só pelas callables, com chave por intenção reusada no reenvio e trava síncrona contra envio duplo.

**Removido** (busca no código, guarda `tests/unit/accounts-no-client-writes.test.ts` que varre o disco, Rules): grupo `wallet` do catálogo (constantes, tipos, adaptadores, apresentação, semeadura no provisionamento), `walletId`, `initialWallets`, `walletSnapshot`, prop `wallets` de `App`, `SettingsView`, `TransactionModal` e `GoalFormModal`, seção "Carteiras". A ferramenta `tools/investments/limpar-investimentos.mjs` passou a proteger as quatro coleções novas. Fica, por pertencer ao domínio de cartões (P4, D-36, conta de origem do pagamento de fatura), o campo `walletId` da origem de pagamento de fatura em `functions/src/creditCards/` — não é o grupo do catálogo e não foi tocado.

**PR-TX-03 e escritores diretos (§19 e §20 do pedido).** Os fluxos da P3 decidem por `valueCents` e pela data civil `date`; o livro-razão é só em centavos inteiros; nenhum campo float novo. Os espelhos da P3 ainda gravam `value`/`transactionDate` para leitores compartilhados com os produtores da P4 — dependência registrada no PR-TX-03, sem adaptador permanente. Inventário dos escritores diretos: `useCreateTransaction`, `useCreateTransactionsBatch`, `useUpdateTransaction`, `useDeleteTransaction` (`src/modules/transactions/{api,hooks}.ts`), consumidos só por `src/App.tsx` para recorrência, divisão de contas, parcelado/cartão, correção e baixa de não elegível e investimento — todos P4; nenhuma tela ou módulo da P3 os usa (guarda com inventário fechado). PR-TX-01, PR-TX-02 e PR-TX-05 atualizados em §6 sem chamar de "legado" o caminho atual da P4.

**Reconciliação local.** `tools/accounts/reconciliar-contas.mjs --workspace=<id> [--reparar]`: só no Emulator (recusa sem `FIRESTORE_EMULATOR_HOST` ou com o projeto de produção), simulação por padrão (código 2 quando diverge), `--reparar` regrava o saldo esperado em transação. Reconciliação agendada fica para a P7.

**Defeitos encontrados e corrigidos durante a entrega.**
- `createCashAccount` com saldo inicial falhava com `internal` no runtime das Functions: `admin.firestore.Timestamp` chega `undefined` pelo namespace, embora a integração (que chama a função exportada) passasse. O E2E pegou; correção pela API modular e guarda estática nova no backend da P3 (mutação F6).
- Clique duplo na transferência: o segundo envio respondia tarde e o `onDone` atrasado fechava o diálogo seguinte (estorno). Trava síncrona nos modais de contas (mutação E1).
- Auto-seleção de conta perdida com a lista em cache: o efeito de abertura do formulário pai rodava depois do efeito do seletor e zerava a escolha. Corrigido no componente compartilhado, para todos os formulários (mutação E2).
- Revisão de escala: lista, escolhas e saldo geral só eram corretos com até 100 contas e nada garantia o teto — teto exato no backend (mutação J10).
- Revisão multi-tenant: a suíte de Rules de contas cobria só o sentido B → A; acrescentados A → B e acesso sem autenticação.

**Testes novos.**
- Functions: `accountsLifecycle.integration.test.ts` (11) e `accountsProducers.integration.test.ts` (8): saldo inicial positivo, zero e negativo; contrato estrito e saldo não editável; papéis; replay antes e depois da expiração da chave; arquivamento e reativação; transferência e estorno com efeito zero; segundo estorno; concorrência na mesma conta; falha antes do commit; isolamento nos dois sentidos; teto de contas e corrida pela última vaga; lançamento manual, pendente, confirmação, correção, anulação; importação; empréstimos; recebíveis; semântica global; reconciliação.
- Rules: `tests/firestore/accounts-p3j.rules.integration.test.mjs` (5).
- Ferramenta: `tests/tools/reconciliar-contas.guard.test.mjs` (2).
- Frontend: `tests/unit/accounts-model.test.ts` e `tests/unit/accounts-no-client-writes.test.ts` (16: modelo 7, guardas 9; `test:unit:accounts` em `verify:fast` e no CI).
- E2E: `e2e/cash-accounts.spec.ts` (7) e asserções novas em `loans-pf.spec.ts`.

**Validação (resultados desta entrega).**
- `npm run verify:all` integral sobre o working tree final: **PASS** (código de saída 0).
  - `verify:fast`: typecheck do frontend e das Functions; lint das Functions com 0 erros (1.961 avisos, o mesmo total da P3-I; os arquivos novos não têm nenhum); build do frontend e das Functions; unitários das Functions **423/423**; frontend: investimentos 175/175, P1 128/128, billing 43/43, UI 5/5, caixa 13/13, empréstimos 21/21, clientes e recebíveis 16/16, **contas 16/16**.
  - `test:integration:emulator`: integração das Functions **575/575** (`accountsLifecycle` 11, `accountsProducers` 8); guarda da ferramenta de limpeza 15/15; **reconciliação de contas 2/2**; Rules **115/115** (metas 5, investimentos 7, domínio de investimentos 19, M3 7, M4 41, adjacentes 5, workspaces 10, billing 10, recebíveis 6, **contas 5**).
  - `test:e2e`: **83/83** (inclui os 7 novos de contas).
- Os números da P3-I (integração 556, Rules 110, E2E 76) são só referência; nenhuma suíte com `skip`/`only`, nenhum timeout aumentado, nenhuma repetição artificial.
- Execuções direcionadas durante a entrega: E2E de contas 7/7 (depois das três correções descritas acima) e suítes E2E adjacentes 39/39 (caixa manual e pendentes, empréstimos PF e PJ, clientes e recebíveis, membros, smoke, navegação, cartões); integração completa intermediária 573/573 e Rules 114/114; unitários das Functions 423/423.

**Mutações** (`mutate-p3j`, cada uma aplicada, suíte direcionada executada, código restaurado): **35 de 35 detectadas** (oito mutantes não compilavam no TypeScript estrito; foram reescritos de forma equivalente e reexecutados).
- Livro-razão e contas (integração no Emulator): J1 conta arquivada aceita movimento · J2 saldo não acompanha o movimento · J3 member administra contas · J4 viewer transfere · J5 member estorna transferência alheia · J6 segundo estorno aceito · J7 arquivar com saldo · J8 saldo inicial classificado como lançamento · J9 estorno ignora a âncora durável · J10 teto de contas com folga de uma.
- Produtores (integração): C1 pendente move a conta · C2 troca de conta sem compensar a antiga · C3 anulação sem compensar · C4 importação não move a conta · L1 liquidação sem juros na conta · L2 estorno de empréstimo sem compensar a conta · V1 desconto move a conta · V2 estorno de recebimento sem compensar a conta.
- Rules: R1 member altera saldo · R2 cliente cria movimento · R3 transferências sem teto de listagem · R4 auditoria lida por qualquer membro · R5 coleções fora de `isBackendOwnedCollection` (regra genérica).
- Ferramenta: T1 reparo não regrava o saldo.
- Frontend e guardas (unidade): F1 viewer transfere na tela · F2 member estorna transferência alheia na tela · F3 payload leva saldo · F4 saldo inicial zero vira movimento · F5 grupo `wallet` volta · F6 `admin.firestore.Timestamp` como valor no backend · F7 lançamento sem conta · F8 recebimento só com desconto envia conta · F9 liquidação de empréstimo sem conta.
- E2E: E1 clique duplo sem trava síncrona (dois pedidos) · E2 auto-seleção perdida com a lista em cache.

**Revisões especializadas** (uma vez cada, limitadas à fatia P3-J):
- **`financial-domain-integrity`: FAIL** no escopo global do caixa, que depende da P4; nenhum achado bloqueante na fatia P3-J. Na fatia: fonte única do saldo (conta só pelo backend, movimento e saldo no mesmo commit, saldo = soma dos movimentos, reconciliação local), centavos inteiros com sinal e datas civis, semântica (saldo inicial e transferência fora de receita/despesa/quota; desconto fora da conta; juros na conta da liquidação), estornos compensatórios sem exclusão, idempotência (antes e depois da expiração da chave) e concorrência com testes, falha injetada antes do commit sem efeito parcial, Rules negando escrita, legado `wallet` removido com prova por busca, guarda e Rules. Bloqueiam o escopo global: produtores da P4 fora do livro-razão (sem garantia de saldo completo, declarado na tela), dupla `value`/`valueCents` (PR-TX-03) e ausência de reconciliação agendada (P7).
- **`multi-tenant-security-review`: PASS.** Backend (papel relido na transação; contas lidas no caminho do workspace autorizado com `workspaceId` conferido no leitor; âncora de idempotência conferida contra ator e workspace; member só estorna a própria) e Rules (escrita negada a todo papel; leitura de membro ativo com teto; auditoria só owner/admin; catch-all fechado) como camadas independentes. Achado da revisão, corrigido: a suíte de Rules cobria só B → A; acrescentados A → B e sem autenticação. Testes de dois tenants nos dois sentidos no backend e nas Rules, viewer, removido, perda de papel com a tela aberta, replay e concorrência; mutações J3–J5, R1–R5, F1, F2.
- **`firestore-scale-cost-review`: PASS.** Sem listener; lista de contas e saldo geral limitados a 100 e exatos pelo teto do backend (achado da revisão, corrigido com contagem na transação; mutação J10); extrato e transferências por cursor (data + ID) com página de 50; índice composto do extrato e índice de grupo da âncora; agregado `sum` com teto; cada fato acrescenta 1 movimento + 1 atualização de saldo por conta tocada (importação: uma atualização por conta por lote); histórico financeiro retido por política, idempotência e limites com TTL existente; nenhum índice de `walletId` a remover.
- **`ptbr-product-ui-review`: PASS.** Conteúdo em pt-BR, erros do backend mapeados sem mensagem bruta, estados de carregamento, vazio, erro e sucesso; trava contra envio duplo; foco e teclado nos diálogos; sem rolagem horizontal em desktop/celular, claro/escuro. Mudanças visíveis só onde o contrato exige: cartão "Contas e carteiras" e campo "Conta/carteira" nos formulários (comparação antes/depois). Três problemas de acessibilidade introduzidos e corrigidos antes da captura final (lista de definição inválida na revisão da transferência; verde do extrato no claro; ações da lista no escuro). Restam violações pré-existentes da base, com as mesmas contagens em `antes/axe-antes.json` ou nas evidências anteriores (rótulos e selects do formulário de lançamento, cabeçalho teal, menu da conta, título PJ do empréstimo).
- **`billing-entitlement-integrity`: não executada.** Planos, preços, quotas e entitlements não mudaram; o saldo inicial e a transferência não consomem a quota D-40, e os limites novos são operacionais.

**Fechamento da P3.** **P3 — implementação funcional própria concluída; fechamento global do ledger depende da convergência P4 e dos gates transversais explicitamente atribuídos a P5/P7/P8.** P4 não foi iniciada.

**Riscos residuais.**
- Saldos de conta não cobrem recorrência, divisão de contas, cartões e investimentos até a P4 (aviso na tela).
- Dupla representação `value`/`valueCents` e `date`/`transactionDate` nos espelhos (PR-TX-03) até a P4.
- Sem reconciliação agendada contas × movimentos × espelhos (P7); só a ferramenta local.
- Teto de 100 contas por workspace (operacional, documentado).
- **Abertos e preservados:** E-06, PR-AI-02/E-00, TX-15, P4–P10 e REQ-FUT-01 — Visualização financeira por tempo de trabalho.

**Rollback.** Reverter o diff da P3-J restaura a P3-I (catálogo com `wallet`, sem contas). Nada foi gravado fora do Emulator.

---

## 19. P4 — execução e evidências

### 19.1 P4-A — cartões de crédito autoritativos, D-36, centavos, faturas, limite e integração com contas (2026-10-06)

**Ponto de partida.** Working tree idêntico ao ZIP da P3-J (`dindin-minhas-financas-p3j-2026-10-06.zip`, SHA-256 `bf5b5109…2251`). Não há dados reais: o domínio antigo de cartões (float, CRUD do cliente, camada de compatibilidade, migração) foi **removido**, não migrado; dados de teste são recriados pelas callables e pelo Emulator. Recorrentes, Divisão de contas e P5 não foram iniciados.

**Decisão D-36** (tomada, implementada e testada; §10): compra retroativa mantém `purchaseDate` e lança as parcelas de ciclo fechado na primeira fatura aberta (aviso na prévia; fatura fechada nunca alterada); fatura fechada pode ser paga antes do vencimento, aberta não; `cycleStatus` (`open`/`closed`) e `paymentStatus` (`unpaid`/`partial`/`paid`) separados, `overdue` só derivado (fechada, saldo > 0, vencimento < hoje em São Paulo), paga continua paga; fechamento diário com releitura transacional, paginado e idempotente; cancelamento lógico só com todas as parcelas em faturas abertas, senão estorno com crédito imutável na fatura aberta e parcelas futuras canceladas; ajuste só owner/admin, em centavos com sinal, motivo obrigatório, sem deixar o saldo negativo e compensado na primeira fatura aberta quando a competência já fechou; pagamento exige conta ativa (D-30), sem carteira, método externo nem `manual_adjustment`, move a conta no mesmo commit e o estorno volta à mesma conta.

**Modelo** (`functions/src/cards/model.ts`, `schemaVersion: 1`, todos `[B]`, só o backend grava, em transação):
- `credit_cards/{card_*}`: cadastro com `limitTotalCents`, `limitUsedCents`, `limitAvailableCents` (inteiros; usado negativo = crédito a favor), dias de fechamento/vencimento, perfil, visual, `status` `active`/`archived` (nunca apagado), `revision` e versão por `updatedAt`. Teto de 50 cartões por workspace (ativos e arquivados), contado na transação.
- `credit_card_purchases/{ccp_*}`: `source` `manual`/`recurring`/`split` decidida pelo backend (o cliente não envia), `status` `active`/`cancelled`/`refunded`, `totalCents`, `installmentsCount` (1–60), `purchaseDate`, `firstCompetence`, `retroactive`.
- `credit_card_invoices/{cardId}_{AAAA-MM}`: competência, fechamento, vencimento, `cycleStatus`, `paymentStatus`, `totalCents = Σ lançamentos ativos`, `paidCents`, `remainingCents`, `activeEntryCount`.
- `credit_card_invoice_entries/{cce_*}`: lançamentos imutáveis — `installment`, `refund_credit`, `adjustment`, `carryover_out`/`carryover_in` (transporte de saldo negativo no fechamento) — com competência natural (retroativa), competência pedida (ajuste compensado), motivo e cancelamento lógico.
- `credit_card_invoice_payments/{ccpay_*}`: `payment` e `reversal` (histórico imutável), conta, movimento da conta, espelho de caixa e vínculo `reversedBy`.
- `credit_card_limit_ledger/{ccl_*}`: razão do limite; invariante `limitUsedCents = Σ razão = Σ lançamentos ativos − (Σ pagamentos − Σ estornos)`.
- `credit_card_events`: auditoria append-only (ator, papel, workspace, operação, intenção, `requestId`, `correlationId`, antes/depois, `occurredAt`).
- Parcelas pelo maior resto no backend (D-34), teto de 60; nada de ponto flutuante.

**Callables** (13, `functions/src/cards/callables.ts`, wrapper `defineCallable`, Zod estrito, papel relido na transação, idempotência por intenção com âncora durável, rate limit, `expectedUpdatedAt` nas mutações de estado, erros pt-BR): `createCreditCard`, `updateCreditCard`, `archiveCreditCard`, `reactivateCreditCard` (owner/admin; limite nunca abaixo do usado; dias travados com fatura aberta com lançamento; arquivar recusado com saldo devedor, crédito a favor, parcelas abertas ou fatura fechada a pagar); `createCreditCardPurchase`, `updateCreditCardPurchase` (valor, data e parcelas só com todas as parcelas abertas), `cancelCreditCardPurchase`, `refundCreditCardPurchase` (owner/admin/member; member só as próprias); `registerInvoicePayment`, `reverseInvoicePayment`, `createCreditCardInvoiceAdjustment` (owner/admin); `recalculateCardLimit`, `rebuildCardInvoicesForCard` (owner/admin, perfil pesado; reparo só quando as duas fontes concordam, fatura fechada divergente só reportada). O codebase passa a **91 endpoints e 84 callables** (4 agendados).

**Rotina** `processCreditCardInvoiceClosing` (`every day 00:15`, `America/Sao_Paulo`, substitui o cron antigo, PR-CC-04): collection group seletivo (`schemaVersion`, `cycleStatus == open`, `closingDate <= hoje`, ordem `closingDate, __name__`), páginas de 200 até 25, sinal `truncated`; cada fatura fecha numa transação que a relê (idempotente; duas execuções simultâneas fecham uma vez); notificações "Fatura fechada" na mesma transação e "vence em 3 dias"/"vencida" uma vez por ID determinístico. O pagamento também fecha tardiamente a fatura cuja data chegou.

**Caixa e contas (D-30).** O pagamento grava, no mesmo commit, o pagamento, a fatura, o razão do limite, o movimento `credit_card_payment` (domínio `credit_card`) na conta escolhida, o espelho `transactions/cccash_*` (`creditCardPaymentEntry`, tipo `despesa`; estorno `receita`), a auditoria e a idempotência. Projeção `cash_report_periods` (`CASH_PERIOD_SCHEMA_VERSION = 3`): `creditCardPaymentCents` ± e `netCents` ∓, nunca `expenseCents` — a despesa de consumo é a compra, no domínio de cartões. A compra não toca o caixa. No frontend o espelho fica fora de receitas e despesas operacionais e das listas de lançamentos (aparece no extrato da conta e na fatura). **Dependência P5:** relatórios tratarem `creditCardPaymentCents` como liquidação e definirem o regime das compras no cartão.

**Rules e índices.** `credit_cards` entrou em `isBackendOwnedCollection` (as demais pelo prefixo `credit_card_`); todas com `get` de membro ativo, `list` com teto (cartões ≤ 50; compras, faturas, lançamentos e pagamentos ≤ 501, a sonda de corte; razão ≤ 201) e `create, update, delete: if false`; auditoria só owner/admin (≤ 50). `transactions`: o cliente não grava `creditCardPaymentEntry` (nem num espelho só com a marca), `creditCardInvoiceId`, `creditCardPurchaseId` e `creditCardInstallment`. Removidos os blocos de `card_limit_ledger`, `card_limit_snapshots`, `invoice_views` e `financial_events`. Índices: 59 compostos e 7 `fieldOverrides`; cartões com 18 compostos, incluindo `credit_card_events (cardId ASC, occurredAt DESC)` (PR-CC-08) e os dois collection group da rotina.

**Interface** (mesmas telas e classes; comparação em `docs/production/evidence/p4a/antes/` e `docs/production/evidence/p4a/`, desktop claro/escuro e celular):
- Lançamento manual no cartão (`TransactionModal`) só pela callable `createCreditCardPurchase`: valor total em centavos, prévia com primeira fatura, vencimento, parcelas e aviso de compra retroativa; chave por intenção reusada no reenvio e trava síncrona; nenhum `parcelado` criado.
- `CreditCardsView`, `CreditCardForm`, `CreditCard3D` em centavos pelas callables; "Excluir" virou "Arquivar"/"Reativar" (diálogo de confirmação com a recusa explicada); "Fechar/Reabrir fatura" saíram (fechamento é da rotina, D-36); fatura aberta mostra "Aguardando fechamento" desabilitado; competências em `MM/AAAA`.
- Pagamento com "Conta de origem" (`CashAccountSelect`) no lugar de "Método de pagamento"; estorno informa a conta; ajuste manual novo (owner/admin) com efeito previsto antes de confirmar; administração com "Recalcular limite", "Reconstruir faturas" e "Auditoria recente". Modais de pagamento e ajuste com foco, Tab preso, Escape e retorno de foco.
- Módulo `src/modules/cards/` só lê (`getDocs`, sem listener), sempre com teto e sonda `limit + 1` que vira corte visível; histórico de faturas por cursor.

**Removido** (busca no código, guarda `tests/unit/cards-no-client-writes.test.ts` que varre o disco, Rules): `src/modules/credit-cards/**` (CRUD do cliente, `compatibility/`, `persistence/readApi.ts`, adaptadores float), `functions/src/creditCards/**` (9 callables antigas, observabilidade própria, idempotência própria), `functions/src/crons/creditCardInvoices.ts`, callable `migrateLegacyInstallments`, origem `migration`, `deleteCreditCard`, `normalizeMoney` dos cartões, `limitTotal`/`limitUsed` em reais, coleções `credit_card_installments`, `card_limit_ledger`, `card_limit_snapshots`, `invoice_views`, `financial_events`, `credit_card_audit_logs`, `credit_card_operational_metrics`, `credit_card_idempotency_keys`, as chaves de compatibilidade em `transactions` e "Métricas operacionais" da tela (métricas ficam no log).

**Defeitos encontrados e corrigidos durante a entrega.**
- `useCardsIntentKey` devolvia um objeto novo a cada renderização; o efeito de abertura dos diálogos zerava a intenção a cada erro exibido e o reenvio ganhava outra chave. Identidade estável (`useMemo`) e guarda estática.
- Valor digitado `12.345` num campo numérico virava R$ 12.345,00 (leitura em formato brasileiro de um campo com ponto decimal). Leitura estrita do campo numérico.
- Member que digitava produto novo no lançamento no cartão: o catálogo recusa (só administradores cadastram) e o envio falhava sem aviso. Mensagem pt-BR no modal (vale também para despesa).
- Linha "Limite utilizado/disponível" acrescentada ao detalhe do cartão sem necessidade: retirada para manter a tela da base.
- Revisões: cobertura de isolamento das faturas (pagamento, estorno, ajuste, conta de outro workspace, nos dois sentidos) e falha injetada antes do commit do pagamento acrescentadas; checagens redundantes (arquivar com fatura fechada a pagar; marca do espelho nas Rules) ganharam testes próprios (mutações K16 e R5).

**Testes novos.**
- Functions: `cardModel.test.ts` (11), `cardsPurchases.integration.test.ts` (10), `cardsInvoices.integration.test.ts` (10), `cardsLifecycle.integration.test.ts` (5): calendário D-36, maior resto, retroativa, cancelamento × estorno, edição, pagamento antecipado/parcial/total e fechamento tardio, estorno na mesma conta, ajuste com compensação, transporte de crédito, rotina paginada e concorrente, alertas, reconciliação, arquivamento (inclusive sob deriva), papéis, isolamento nos dois sentidos, replay e conflito de chave, último limite concorrente, falha antes do commit (compra e pagamento).
- Rules: `tests/firestore/cards-p4a.rules.integration.test.mjs` (5); `m4-hardening` e `investment-domain` adaptados.
- Frontend: `tests/unit/cards-model.test.ts` (11) e `tests/unit/cards-no-client-writes.test.ts` (14) — `test:unit:cards` em `verify:fast`.
- E2E: `e2e/credit-card-flow.spec.ts` reescrito (7) e smoke de regressão com o cartão pela operação autoritativa; apoio `e2e/support/cards.ts` (fatura fechada pelo próprio backend com relógio injetado e pela rotina real).

**Validação (resultados desta entrega).**
- `npm run verify:all` integral sobre o working tree final: **PASS** (código de saída 0).
  - `verify:fast`: typecheck do frontend e das Functions; lint das Functions com 0 erros (295 avisos — a remoção do módulo antigo levou embora a maior parte dos 1.961 da P3-J; os arquivos de `functions/src/cards/` não têm nenhum); build do frontend e das Functions; unitários das Functions **412/412**; frontend: investimentos 175, P1 128, billing 43, UI 5, caixa 13, empréstimos 21, clientes 16, contas 16 e **cartões 25** (`test:unit:cards`, novo), todos verdes.
  - `test:integration:emulator`: integração das Functions **570/570** (cartões: `cardModel` 11, `cardsPurchases` 10, `cardsInvoices` 10, `cardsLifecycle` 5); guarda da ferramenta de limpeza 15/15; reconciliação de contas 2/2; Rules **120/120** (metas 5, investimentos 7, domínio de investimentos 19, M3 7, M4 41, adjacentes 5, workspaces 10, billing 10, recebíveis 6, contas 5, **cartões 5**).
  - `test:e2e`: **87/87** (inclui os 7 de cartões reescritos e o smoke de regressão com o cartão autoritativo).
- Os números da P3-J (integração 575, Rules 115, E2E 83) são só referência; a integração caiu para 570 porque as suítes do módulo antigo de cartões saíram com ele. Nenhuma suíte com `skip`/`only`, nenhum timeout aumentado, nenhuma repetição artificial (o teste de papéis que passava de 45 s foi dividido em dois, não teve o tempo aumentado).
- Execuções direcionadas durante a entrega: integração de cartões 36/36 depois dos testes acrescentados nas revisões; Rules de cartões 5/5; E2E de cartões 7/7 e smoke 3/3 (com as correções descritas acima).
- Evidência visual: `docs/production/evidence/p4a/antes/` (base P3-J, 18 capturas) e `docs/production/evidence/p4a/` (24 capturas), com `antes-relatorio.json` e `depois-relatorio.json` (rolagem horizontal zero; axe).

**Mutações** (`mutate-p4a`, cada uma aplicada, suíte direcionada executada, código restaurado): **36 de 36 detectadas**. K4 e K19 não compilavam no TypeScript estrito e foram reescritos de forma equivalente; K16 e R5 sobreviveram na primeira rodada por atingirem checagens redundantes e foram detectados depois dos testes próprios; E2 sobreviveu ao clique duplo real (o botão já desabilitava) e foi detectado com dois envios no mesmo tick.
- Backend (integração no Emulator): K1 member administra cartões · K2 viewer compra · K3 compra sem checar o limite · K4 parcela retroativa em fatura fechada · K5 resto fora do maior resto · K6 cancelamento com parcela fechada · K7 pagamento de fatura aberta · K8 pagamento acima do saldo · K9 pagamento não move a conta · K10 estorno sem compensar a conta · K11 estorno sem checar o limite · K12 ajuste deixa saldo negativo · K13 ajuste reescreve fatura fechada · K14 limite abaixo do usado · K15 ciclo alterado com lançamentos · K16 arquivar com fatura a pagar · K17 arquivar com parcelas abertas · K18 teto de cartões com folga · K19 pagamento vira despesa na projeção · K20 pago com saldo · K21 teto de 61 parcelas.
- Rules: R1 member altera cartão · R2 cliente cria lançamento de fatura · R3 faturas sem teto · R4 auditoria lida por qualquer membro · R5 cliente forja espelho de pagamento · R6 razão com teto maior.
- Frontend e guardas: F1 campo numérico lido como milhar · F2 member administra na tela · F3 fatura aberta pagável · F4 vencida deixa de ser derivada · F5 chave nova por clique · F6 intenção sem identidade estável · F7 lançamento manual cria `parcelado`.
- E2E: E1 compra com chave nova a cada envio (resposta perdida duplicaria) · E2 pagamento sem trava síncrona.

**Revisões especializadas** (uma vez cada, limitadas à P4-A; sem gate final de P4):
- **`financial-domain-integrity`: FAIL** no escopo global, pelo item "todo fluxo que afeta cartão passa pelo domínio de cartões": Recorrentes e Divisão de contas ainda gravam `parcelado` com `cardId` pelo cliente (P4-B/P4-C, PR-TX-06 parcial) e os relatórios seguem no navegador (P5). **Nenhum achado bloqueante na fatia P4-A:** fonte única (só o backend grava; Rules negam o cliente em todas as coleções, com teste), centavos inteiros e datas civis de São Paulo, atomicidade composta provada com falha injetada antes do commit (compra e pagamento: nada gravado, repetição cria um efeito só), idempotência com âncora durável e conflito de chave, concorrência (último limite, rotina simultânea), histórico imutável (cancelamento lógico, crédito compensatório, pagamento e estorno ligados), totais reconstruíveis (limite = razão = lançamentos − pagamentos líquidos; fatura = soma dos lançamentos), reconciliação com reparo só quando as fontes concordam, semântica sem dupla contagem (a compra é a despesa; o pagamento é liquidação, fora de despesa no backend e no frontend, com teste), PF e PJ, legado removido com busca, Rules e guarda.
- **`multi-tenant-security-review`: PASS.** Backend: wrapper com pré-checagem do workspace e papel relido dentro de toda transação (inclusive `loadCardForMutation`/`loadPurchaseForMutation`); todos os IDs do payload resolvidos no caminho do workspace autorizado e leitores que conferem `workspaceId` e `cardId`; conta de origem lida no workspace do ator; rotina deriva o tenant do caminho e confere o campo; idempotência pelo ator e pelo hash do payload (com o `workspaceId`), âncora conferida contra ator e hash; member só altera as próprias compras; viewer não escreve. Rules testadas como se o backend não existisse. Testes: isolamento nos dois sentidos (cartão, compra, fatura, pagamento, estorno, ajuste e conta de outro workspace), `workspaceId` forjado (`permission-denied`), membro removido, sem autenticação, auditoria só owner/admin; E2E de perda de papel com o diálogo aberto e troca de workspace. Auditoria com ator, papel, operação, intenção, `requestId`, `correlationId` e instante do servidor.
- **`firestore-scale-cost-review`: FAIL** por um único item preexistente e atribuído à P5: `notifications` não tem retenção (PR-NOTIF-01; prazo depende de D-18), e a rotina de cartões grava até três avisos por fatura e ciclo, como o módulo antigo. **Os demais itens da fatia passam:** leituras do frontend só `getDocs`, sempre com teto e sonda de corte visível, histórico por cursor; índices compostos para todas as consultas (inclusive PR-CC-08) e nenhum índice antigo sobrando; transações com leituras limitadas (parcelas ≤ 60, faturas abertas com teto, `limit(1)` na checagem de fatura a pagar) e escrita máxima de ~125 documentos na compra de 60 parcelas; reconciliação por agregação e reconstrução paginada (≤ 50); rotina por consulta seletiva (só o que vence no dia), paginada, retomável e com corte sinalizado — a correção não depende dela (fechamento efetivo pela data e fechamento tardio no pagamento); idempotência e rate limit pelo kernel, com TTL.
- **`ptbr-product-ui-review`: PASS.** Conteúdo em pt-BR, inclusive erros do backend (mapeados sem mensagem bruta); estados de carregamento, vazio, erro, corte e sucesso; trava síncrona contra envio duplo (provada com dois envios no mesmo tick); antes/depois com os mesmos dados, viewports e temas: mudanças só as exigidas pelo contrato (conta de origem no pagamento, arquivar/reativar no lugar de excluir, fatura aberta não pagável, fim do fechamento manual, competência em `MM/AAAA` para casar com os avisos novos, ajuste manual, aviso de catálogo); a linha de limite acrescentada sem necessidade foi retirada; nomes acessíveis nos botões de grade/lista (sem efeito visual). Axe sem violações novas (diálogos novos com zero; as de formulário e contraste já existiam na base); sem rolagem horizontal em desktop e celular; Escape, foco inicial, Tab preso e retorno de foco nos modais de cartão (E2E).
- **`billing-entitlement-integrity`: não executada.** Planos, preços, quotas e entitlements não mudaram; cartões não consomem a quota D-40 e os tetos novos são operacionais.

**Blockers** (§6): PR-CC-01…PR-CC-08 resolvidos com a evidência acima e saem do registro no gate de P4; PR-TX-06 **parcial** (o tipo `parcelado` com `cardId` segue gravável pelo cliente para Recorrentes e Divisão de contas, P4-B/P4-C); C10/C16 resolvidos para `credit_cards`. Recorrentes (PR-REC-*) e Divisão de contas (PR-SPLIT-*) **não** foram tratados.

**Riscos residuais.**
- `parcelado` de Recorrentes e Divisão de contas fora do domínio de cartões até a P4-B/P4-C: entra como despesa, não consome limite nem aparece na fatura.
- Relatórios no navegador (P5): pagamento de fatura como liquidação e regime das compras no cartão.
- Notificações da rotina sem retenção (PR-NOTIF-01, D-18).
- Tetos operacionais documentados: 50 cartões por workspace, 60 parcelas, 500 itens por lista com sinal de corte.
- **Abertos e preservados:** D-12, D-14, D-15, D-23, E-06, PR-AI-02/E-00, TX-15, REQ-FUT-01 — Visualização financeira por tempo de trabalho, e P5–P10.

**Rollback.** Reverter o diff da P4-A restaura a P3-J (domínio antigo de cartões). Nada foi gravado fora do Emulator.

### 19.2 P4-B — recorrentes autoritativos, D-12, geração segura e integração com Caixa e Cartões (2026-10-07)

**Ponto de partida.** Working tree idêntico ao ZIP da P4-A (`dindin-minhas-financas-p4a-2026-10-06.zip`, SHA-256 `1086b2c4…5126`); P0–P4-A, D-36, `functions/src/cards/`, `cash_accounts` e o domínio de caixa da P3 preservados (só as extensões descritas abaixo). Não há dados reais: o módulo antigo de recorrentes (CRUD do cliente, float, ocorrência por competência, geração manual no navegador, cron fora de transação, Split na recorrência) foi **removido**, não migrado; dados de teste são recriados pelas callables e pelo Emulator. Divisão de contas (P4-C), D-14, D-15, D-23 e P5 não foram iniciados.

**Decisão D-12** (tomada, implementada e testada; §10): frequências `weekly` (+7 dias civis), `biweekly` (+15 dias civis), `monthly`, `bimonthly`, `quarterly`, `semiannual` e `annual`; as mensais e múltiplas usam `billingDay` (1–31) como âncora, mês curto cai no último dia e o mês seguinte volta à âncora (cada vencimento é calculado da âncora, nunca do anterior; sem `setMonth`); o primeiro vencimento mensal é o dia-âncora do mês de início se ainda não passou, senão o do mês seguinte. `executionMode` explícito em todo contrato (`automatic` | `confirmation_required`; a tela sugere "Automático"). Cartão: automático gera uma compra P4-A à vista com `source: "recurring"`; com confirmação, espera o usuário e aceita o valor real. Fora do cartão: automático gera a despesa **pendente** no Caixa (sem mover conta); a confirmação escolhe "gerar como pendente" ou "registrar como paga agora" (move a conta no mesmo commit, D-30). Nenhum segundo ledger. Geração e confirmação **não** consomem `transactionsPerMonth` (D-40); há rate limit operacional por ator.

**Modelo** (`functions/src/recurring/model.ts`, `schemaVersion: 1`, todos `[B]`, só o backend grava, em transação):
- `recurring_expenses/{rec_*}`: contrato com `amountCents` (inteiro, teto do Caixa), `currency: "BRL"`, `frequency`, `billingDay`, `startDate`/`endDate` (`YYYY-MM-DD`), `paymentMethod`, `executionMode`, `cardId` (só cartão) ou `cashAccountId` (só fora do cartão), categoria, visual, campos PJ, `status` `active`/`paused`/`ended`/`cancelled` (nunca apagado), `nextDueDate` (não nulo ⇔ ativo), `lastProcessedDueDate`, `openOccurrenceCount`, `createdBy`, `revision` e versão por `updatedAt`. Teto de 500 contratos por workspace, contado na transação.
- `recurring_occurrences/{rocc_*}`: identidade = recorrência + vencimento; ID determinístico `rocc_` + SHA-256(`workspaceId:recurringExpenseId:dueDate`), criado com `create()`. Estados `awaiting_confirmation`, `generated` (exatamente um fato no domínio de destino), `ignored`, `attention_required` (com código seguro). O futuro não é materializado: a tela projeta os próximos vencimentos pela agenda pura.
- `recurring_events`: trilha append-only (ator, papel, operação, intenção, `requestId`, `correlationId`, antes/depois, `amountChanged`, motivo, `occurredAt`); o "Histórico de Reajustes" vem dela, sem o array `adjustments` em reais.
- Agenda pura e idêntica no backend (`functions/src/recurring/schedule.ts`) e no frontend (`src/modules/recurring/schedule.ts`), aritmética civil inteira sem `Date`; vetores calculados à mão (`tests/fixtures/recurring-schedule-vectors.json`) e varredura FE × BE (PR-REC-05).

**Callables** (8, `functions/src/recurring/callables.ts`, wrapper `defineCallable`, Zod estrito, papel relido na transação, idempotência por intenção com âncora durável, rate limit, auditoria, erros pt-BR, logs só com identificadores): `createRecurringExpense`, `updateRecurringExpense` (só o futuro: recalcula `nextDueDate`; recusa mudar a agenda com vencimento atrasado pendente; `expectedUpdatedAt` obrigatório; motivo opcional), `pauseRecurringExpense`, `resumeRecurringExpense` (primeiro vencimento ≥ o dia da retomada; o intervalo pausado não é recuperado), `cancelRecurringExpense` (terminal; nada apagado nem revertido; ocorrência aberta de contrato cancelado só pode ser ignorada), `confirmRecurringOccurrence`, `ignoreRecurringOccurrence`, `retryRecurringOccurrence` (pode trocar de cartão ou conta). RBAC: owner/admin tudo; member cria e administra só as próprias; viewer só lê; conta suspensa, membro removido e workspace arquivado recusados. O codebase passa a **99 endpoints e 92 callables** (4 agendados).

**Rotina** `processRecurring` (`every day 02:00`, `America/Sao_Paulo`; `functions/src/crons/recurring.ts` só dispara, a lógica está em `functions/src/recurring/scheduler.ts` e `generation.ts`): collection group seletivo (`schemaVersion`, `status == active`, `nextDueDate <= hoje`, ordem `nextDueDate, __name__`), páginas de 200 até 25, cursor; até 12 vencimentos por contrato e 500 por workspace por execução (o excedente é `backlog`, retomado de forma determinística na execução seguinte); sinais `truncated`, `backlog`, `failed` e atenção por código no log. Cada vencimento é uma transação que relê contrato, ocorrência e workspace e grava ocorrência, fato, evento e avanço do contrato no mesmo commit. Impedimento de domínio (cartão indisponível ou arquivado, limite insuficiente, conta indisponível ou arquivada, workspace arquivado) vira `attention_required` com código, sem fato parcial, e nova tentativa manual; falha transitória não grava nada e a execução seguinte retoma sem duplicar.

**Caixa e Cartões.** No Caixa o fato é um lançamento P3 (`transactions/cash_*`, ID determinístico por ocorrência, `cashEntry.origin: "recurring"`, `quotaPeriod: null`, marca backend-only `recurringEntry`, `userId` = criador do contrato), elegível às callables P3 (confirmar, corrigir, anular); anular o lançamento não reescreve a ocorrência nem faz o vencimento voltar. No cartão o fato é uma compra P4-A pela mesma primitiva da compra manual (`prepareCardPurchase`/`commitCardPurchase`, extraídas de `functions/src/cards/purchaseOperations.ts`): fatura com retroatividade D-36, reserva de limite, razão do limite e evento; `source: "recurring"` e vínculo só pelo backend (a callable pública continua só `manual`); valor, data e parcelas da compra gerada travados; cancelar/estornar continua do domínio de cartões. PJ: fornecedor e centro de custo chegam ao fato.

**Rules e índices.** `recurring_expenses`, `recurring_occurrences` e `recurring_events` (prefixo `recurring_` em `isBackendOwnedCollection`): `get` de membro ativo (viewer incluído), `list` com teto (contratos ≤ 501, ocorrências ≤ 101, trilha ≤ 50) e `create, update, delete: if false` (PR-REC-01). `transactions`: o cliente não grava a marca `recurringEntry` nem altera ou apaga o lançamento gerado; o formato antigo (`source: "recurring"`, `recurringId`) é negado. Índices: CG `recurring_expenses (schemaVersion, status, nextDueDate, __name__)`, `recurring_occurrences (recurringExpenseId, status, dueDate DESC, __name__ DESC)` (histórico por cursor) e `(recurringExpenseId, status, dueDate, __name__)` (ocorrências que pedem ação), `recurring_events (recurringExpenseId, amountChanged, occurredAt DESC, __name__ DESC)`; os índices antigos saíram.

**Interface** (mesmas telas e classes; comparação em `docs/production/evidence/p4b/antes/` e `docs/production/evidence/p4b/`, desktop claro/escuro e celular):
- Formulário pelas callables: valor em centavos, frequências Quinzenal e Bimestral, dia de cobrança só nas mensais, cartão ou conta (`CashAccountSelect`) conforme a forma de pagamento, "Execução no vencimento" (Automático / Confirmar antes) com texto explicativo, categoria na aba Integrações, campos PJ; trava síncrona e chave por intenção; Split removido.
- Detalhes: ações só por callable (Gerar/Provisionar, Pagar, Confirmar, Tentar de novo, Ignorar, Pausar/Retomar, "Cancelar recorrência" com confirmação), vencimentos projetados ("Previsto · Caixa/Cartão"), ocorrências que pedem ação (teto com corte sinalizado), histórico por cursor ("Carregar mais") com estado, valor e referência do fato (o valor exibido é o do fato, fonte oficial), reajustes pela trilha (corte sinalizado), linha "Execução".
- Lista, cartão e widget: estimativa mensal em centavos, status "Encerrados", selo "Ocorrência aguardando ação" no lugar do selo de Split, "Nova" só para quem pode criar; `onAddTransaction` saiu.

**Removido** (busca no código, guarda `tests/unit/recurring-no-client-writes.test.ts` que varre o disco inclusive arquivos não rastreados, Rules): `src/modules/recurring-expenses/**`, `handleGenerate`, `onAddTransaction` em Recorrentes, Split na recorrência, `adjustments` em reais, campos e enums pt-BR do contrato antigo, ocorrência por competência, lançamento `rec_{id}_{vencimento}` em float, `recurringId`/`source: "recurring"` em `transactions`, checkpoint e varredura 200 × 50 do cron antigo, `functions/src/crons/recurringSchedule.test.ts` e a integração antiga do cron, índices antigos e as Rules de escrita livre para member. Recorrentes saiu do inventário de escritores diretos de `transactions` (PR-TX-01); as Rules globais de `transactions` **ainda não** foram fechadas (Divisão de contas).

**Defeitos encontrados e corrigidos durante a entrega.**
- O contrato validava `visual.icon` contra uma lista fechada, mas o seletor da tela usa nomes livres do catálogo de ícones (`Bolt`, `IconCloud`): criação recusada. Validação por padrão de nome (`RECURRING_ICON_PATTERN`), sem caminho nem caractere especial.
- O resumo da rotina levava um mapa aninhado (atenção por código) que o logger estruturado recusa: achatado em `attention_<código>`.
- O aviso da tela de contas dizia que recorrências não movem contas; a despesa recorrente paga move. Texto corrigido (com asserção no unitário de contas) e citação atualizada na documentação.
- Revisões: faltavam testes de isolamento das callables de ocorrência (nos dois sentidos) e de cartão/conta de outro workspace; as ocorrências vinham numa lista única das 24 mais recentes (uma ocorrência antiga ainda pendente ficaria fora da tela e o resto do histórico inalcançável): agora há a consulta das que pedem ação, filtrada no servidor com teto e corte sinalizado, e o histórico das resolvidas por cursor ("Carregar mais"), com o estado dos fatos lido uma vez por página; reajustes ganharam sinal de corte; o histórico exibia o valor da ocorrência em vez do valor atual do fato (fonte oficial); faltavam falha injetada antes do commit na geração (ponto `beforeCommit` em `processDueOccurrence`/`runRecurringGeneration`, só para testes), anulação do lançamento gerado pelo Caixa, propagação dos campos PJ e teto + 1 centavo.
- Contraste no escuro dos elementos novos (rótulo do modo de execução selecionado, "Editar", "Pausar/Retomar"): token `primary-on-dark` da UX-H1, aplicado também ao "Reajustar Valor" da mesma linha para manter a linha uniforme.
- O primeiro `verify:all` falhou em 1 de 607 integrações: o teste "pausa durante a geração" exigia que a pausa sempre vencesse, mas a pausa leva a versão lida antes e, quando a geração grava primeiro, é recusada com `concurrent_update` (concorrência otimista correta, sem efeito parcial). O mesmo pressuposto existia em "cancelamento concorrente com confirmação" (a confirmação muda o contador do contrato). Os dois testes passaram a afirmar as duas ordens válidas, cada uma com estado exato e código de erro, e o `verify:all` foi refeito do zero.
- Mutações: cinco mutantes (R3, R12, R21, R24, R27) não compilavam no TypeScript estrito e foram reescritos de forma equivalente; todos detectados.

**Testes novos.**
- Functions: `schedule.test.ts` (9) e `recurringContracts.test.ts` (8) (unitários); `recurringLifecycle` (11), `recurringCash` (8), `recurringCard` (6), `recurringConcurrency` (9), `recurringScheduler` (6), `recurringIsolation` (2) e `recurringIntegrity` (6) (integração no Emulator): agenda D-12, criação, edição só do futuro, pausa/retomada sem recuperar o intervalo, cancelamento terminal, término, Caixa automático pendente e "registrar como paga", cartão automático e por confirmação, atenção e nova tentativa, ignorar, quota D-40 intocada, PJ, papéis, isolamento nos dois sentidos, replay e conflito de chave, concorrência (agendador × agendador, × confirmação, × edição, × pausa, × cancelamento, último centavo do limite), falha antes do commit (geração, confirmação no cartão, pagamento no Caixa), anulação pelo Caixa, rotina paginada com teto, backlog e retomada.
- Cartões e Caixa adaptados: `mutationContracts`, `p3dContracts`, `mutateTransaction` (formato antigo vira `unsupported_origin`), `scaleQueries` (consulta da rotina).
- Rules: `tests/firestore/recurring-p4b.rules.integration.test.mjs` (5, inclusive fronteira de página e cursor nas consultas exatas do frontend); `workspaces-p1` e `adjacent-modules` adaptados.
- Frontend: `tests/unit/recurring-schedule.test.ts`, `recurring-model.test.ts` e `recurring-no-client-writes.test.ts` — `test:unit:recurring` (22) em `verify:fast` e no workflow de qualidade (que também passou a rodar `test:unit:cards`).
- E2E: `e2e/recurring-flow.spec.ts` (8) e smoke de regressão com a recorrência pela operação autoritativa; apoio `e2e/support/recurring.ts`.

**Validação (resultados desta entrega).**
- `npm run verify:all` integral sobre o working tree final: **PASS** (código de saída 0).
  - `verify:fast`: typecheck do frontend e das Functions; lint das Functions com 0 erros (283 avisos, contra 295 na P4-A; os arquivos de `functions/src/recurring/`, inclusive testes e apoio, não têm nenhum); build do frontend e das Functions; unitários das Functions **416/416**; frontend: investimentos 175, P1 128, billing 43, UI 5, caixa 13, empréstimos 21, clientes 16, contas 16, cartões 25 e **recorrentes 22** (`test:unit:recurring`, novo), todos verdes.
  - `test:integration:emulator`: integração das Functions **607/607** (recorrentes: `recurringLifecycle` 11, `recurringCash` 8, `recurringCard` 6, `recurringConcurrency` 9, `recurringScheduler` 6, `recurringIsolation` 2, `recurringIntegrity` 6); guarda da ferramenta de limpeza 15/15; reconciliação de contas 2/2; Rules **125/125** (metas 5, investimentos 7, domínio de investimentos 19, M3 7, M4 41, adjacentes 5, workspaces 10, billing 10, recebíveis 6, contas 5, cartões 5, **recorrentes 5**).
  - `test:e2e`: **95/95** (inclui os 8 de recorrentes e o smoke de regressão com a recorrência criada pela operação autoritativa).
- O primeiro `verify:all` desta entrega terminou com 606/607 na integração (corrida do teste de pausa, descrita acima); depois da correção do teste, a execução integral foi refeita do zero e é a registrada aqui. Os números da P4-A (unitários 412, integração 570, Rules 120, E2E 87) são só referência. Nenhuma suíte com `skip`/`only`, nenhum timeout aumentado, nenhuma repetição artificial.
- Execuções direcionadas durante a entrega: suíte de recorrentes no Emulator 72/72 (unitários e integração, mais `mutationContracts` do Caixa) depois das correções das revisões; concorrência 9/9 em três execuções seguidas depois da correção da corrida; Rules de recorrentes 5/5; E2E de recorrentes, smoke e contas 18/18.
- Evidência visual: `docs/production/evidence/p4b/antes/` (base P4-A, 15 capturas) e `docs/production/evidence/p4b/` (24 capturas), com `antes-relatorio.json` e `depois-relatorio.json` (rolagem horizontal zero em todas; axe WCAG 2.0/2.1 A e AA).

**Mutações** (`mutate-p4b`, cada uma aplicada, suíte direcionada executada, código restaurado): **36 de 36 detectadas.** R3, R12, R21, R24 e R27 não compilavam no TypeScript estrito (variável ou import sem uso) e foram reescritos de forma equivalente (a guarda continua no código, mas nunca dispara); todos detectados na nova rodada.
- Backend (integração no Emulator): R1 mês curto sem voltar ao dia-âncora · R2 quinzenal com passo de 14 dias · R3 primeiro vencimento mensal antes do início · R4 ocorrência identificada pela competência · R5 geração sem reler o vencimento esperado · R6 automático no Caixa nasce pago · R7 lançamento recorrente conta na quota manual · R8 compra recorrente parcelada · R9 compra gerada gravada como manual · R10 cartão arquivado vira falha transitória, sem atenção · R11 workspace arquivado gera fato · R12 ledger em manutenção não barra a geração · R13 confirmação de ocorrência já gerada · R14 cancelada ainda confirma · R15 contador de ações abertas não desce · R16 member administra recorrência alheia · R17 viewer escreve · R18 retomada recupera o intervalo pausado · R19 edição não recalcula o vencimento · R20 edição com atraso aceita · R21 versão lida ignorada · R22 cancelamento mantém o próximo vencimento · R23 âncora durável ignorada · R24 sem teto por contrato · R25 contrato reaparecido processado de novo · R26 compra gerada aceita edição financeira · R27 origem recorrente sem vínculo aceita no Caixa.
- Rules: R28 member cria contrato pelo cliente · R29 ocorrências sem teto de listagem.
- Frontend e guardas: F1 formulário força Automático · F2 valor por ponto flutuante · F3 member administra recorrência alheia na tela · F4 dia de cobrança enviado na semanal · F5 agenda da tela diverge (quinzenal de 14) · F6 escrita do cliente volta ao módulo.
- E2E: E1 formulário sem trava síncrona de duplo clique.

**Revisões especializadas** (uma vez cada, limitadas à P4-B; sem gate final de P4):
- **`financial-domain-integrity`: FAIL** no escopo global, pelo mesmo item da P4-A: "todo fluxo que afeta cartão passa pelo domínio de cartões" — Divisão de contas ainda grava `parcelado` com `cardId` pelo cliente (P4-C, PR-TX-06 parcial) — e os relatórios seguem no navegador (P5). **Nenhum achado bloqueante na fatia P4-B** depois das correções acima: fonte única (só o backend grava contratos, ocorrências, trilha e fatos; Rules negam o cliente, com teste), fato no domínio dono (lançamento P3 ou compra P4-A; nenhum segundo ledger, nenhum `parcelado`), centavos inteiros e datas civis de São Paulo com agenda idêntica no frontend e no backend, atomicidade provada com falha injetada antes do commit (geração no Caixa e no cartão, confirmação no cartão, "registrar como paga": nada gravado e a repetição cria um efeito só), idempotência com âncora durável e conflito de chave, concorrência (agendador × agendador, × confirmação, × edição, × pausa, × cancelamento, último centavo do limite), histórico imutável (cancelamento terminal, anulação do fato pelo Caixa sem reescrever a ocorrência), quota D-40 intocada, PF e PJ (campos PJ no fato), legado removido com busca, Rules e guarda.
- **`multi-tenant-security-review`: PASS.** Wrapper com pré-checagem do workspace e papel relido dentro de toda transação (`loadContractForMutation`, `loadOccurrenceForAction`, geração); todos os IDs do payload resolvidos no caminho do workspace autorizado e leitores que conferem `workspaceId`; cartão e conta lidos no workspace do ator; rotina deriva o tenant do caminho; idempotência pelo ator e pelo hash do payload; member só administra as próprias; viewer só lê; conta suspensa, membro removido e workspace arquivado recusados. Testes: isolamento nos dois sentidos para confirmar, ignorar, tentar de novo e editar (workspace forjado → `permission-denied`; ID de outro tenant no próprio workspace → `not_found`; cartão/conta de outro workspace na criação, edição e nova tentativa), Rules como se o backend não existisse (escrita negada para todos os papéis, leitura de membro com teto, nada atravessa o workspace, membro removido não lê, vínculo `recurringEntry` não forjável), E2E de member/viewer, perda de permissão e troca de workspace. Logs só com identificadores.
- **`firestore-scale-cost-review`: PASS.** Leituras do frontend só `getDocs`, sempre com teto e sonda de corte visível: contratos por cursor (100), ativas ≤ 500, ocorrências que pedem ação ≤ 50 filtradas no servidor, histórico por cursor (24 por página) com fatos por ID em lotes de 30 uma vez por página, reajustes ≤ 20; índices compostos para cada consulta (guarda estática confere as formas) e nenhum índice antigo sobrando; rotina por consulta seletiva (só o que vence no dia), paginada, com teto por contrato e por workspace, retomável e com corte e backlog sinalizados; uma transação por vencimento com leituras limitadas (contrato, ocorrência, workspace e o necessário do fato) e ~4 a 8 escritas; criação conta os contratos do workspace por agregação na transação (teto 500); idempotência e rate limit pelo kernel, com TTL. Crescimento: no máximo uma ocorrência por vencimento alcançado (≤ 52/ano por contrato semanal) e eventos por operação; retenção do histórico financeiro segue a decisão transversal D-18 (P8), como os demais domínios financeiros. Fronteira de página e cursor testados no Emulator (Rules) e consulta da rotina em `scaleQueries`.
- **`ptbr-product-ui-review`: PASS.** Conteúdo em pt-BR, inclusive erros do backend (mapeados sem mensagem bruta) e estados de carregamento, vazio, erro, corte e sucesso; trava síncrona contra envio duplo (E2E e mutação E1); antes/depois com dados equivalentes, mesmos viewports e temas: mudanças só as exigidas pelo contrato (modo de execução, cartão ou conta, dia de cobrança só nas mensais, frequências novas, ações por callable, ocorrências e projeção, cancelamento com confirmação, selo de ação pendente no lugar do de Split, "Encerrados") e a correção do rótulo "Serviço"; contraste dos elementos novos corrigido com o token existente; os nós de contraste restantes são classes que já existiam na base, em número igual ou menor (detalhes: 6 → 1 no claro, 13 → 2 no escuro); sem rolagem horizontal em desktop e celular.
- **`billing-entitlement-integrity`: não executada.** Planos, preços, quotas e entitlements não mudaram; a geração não consome a quota D-40 (teste e mutação R7) e os tetos novos são operacionais.

**Blockers** (§6): PR-REC-01…PR-REC-06 resolvidos com a evidência acima e saem do registro no gate de P4; PR-TX-06 continua **parcial** só por Divisão de contas (nenhum fluxo de Recorrentes cria `parcelado` nem `cardId` em `transactions`; guarda estática); PR-TX-01 sem Recorrentes no inventário de escritores diretos. Divisão de contas (PR-SPLIT-*) **não** foi tratada.

**Riscos residuais.**
- Divisão de contas ainda grava `transactions` (inclusive `parcelado` com `cardId`) pelo cliente até a P4-C; Rules globais de `transactions` abertas para ela.
- Relatórios no navegador (P5): a despesa recorrente é um lançamento do Caixa e a compra recorrente é uma compra de cartão, cada uma no seu domínio; o tratamento por origem nos relatórios server-side é da P5.
- Agendador depende da implantação por ambiente (E-01) e de alerta sobre `failed`/`truncated`/`backlog` (P7).
- Tetos operacionais documentados: 500 contratos por workspace, 12 vencimentos por contrato e 500 por workspace por execução, 50 ocorrências que pedem ação por tela com corte sinalizado.
- **Abertos e preservados:** D-14, D-15, D-23, D-18, E-06, PR-AI-02/E-00, TX-15, REQ-FUT-01 — Visualização financeira por tempo de trabalho, e P5–P10.

**Rollback.** Reverter o diff da P4-B restaura a P4-A (módulo antigo de recorrentes). Nada foi gravado fora do Emulator.

### 19.3 P4-C — Divisão de contas autoritativa, D-14, rateio exato, reembolso PJ e integração com Caixa e Cartões (2026-10-07)

**Ponto de partida.** Working tree idêntico ao ZIP da P4-B (`dindin-minhas-financas-p4b-2026-10-07.zip`, SHA-256 `fc6e1dc0…a0ba`); P0–P4-B, D-12, D-36, `functions/src/cards/`, `functions/src/recurring/`, `cash_accounts` e o domínio de caixa da P3 preservados (só as extensões descritas abaixo). Não há dados reais: o módulo antigo da Divisão de contas (CRUD do cliente, float, "Você", exclusão em cascata, `parcelado` com `cardId` gravado pelo cliente, quota no cliente, categorias mock) foi **removido**, não migrado; dados de teste são recriados pelas callables e pelo Emulator. D-15, D-23 e P5 não foram iniciados; Investimentos intocados.

**Decisão D-14** (tomada, implementada e testada; §10): participante `workspace_member` (`userId` validado na transação contra membership ativo owner/admin/member; identidade pelo `uid`, nunca por nome) ou `external` (só nome, sem login nem contato); papéis do grupo `owner`/`participant`/`viewer`; o viewer do workspace lê e não participa. Convite por código CSPRNG (`crypto.randomInt`, 10 caracteres do alfabeto sem ambíguos) mostrado uma vez; o documento é `sinv_` + hash(`workspaceId:invite:código`) e guarda só `codeHint`; validade de 7 dias com TTL, uso único, papel fixo, até 20 pendentes por grupo, rate limit de geração (10/h) e de aceite (10 em 15 min, contando as tentativas que falham), resposta genérica para código inválido, expirado ou revogado, idempotência e auditoria. Reembolso só em workspace PJ: `requested` → `approved` → `paid` (ou `rejected`/`cancelled`).

**Modelo** (`functions/src/splitBills/model.ts`, `schemaVersion: 1`, todos `[B]`, só o backend grava, em transação):
- `split_groups/{sgr_*}`: nome, descrição, tipo, modo `split`/`reimbursement`, `active`/`archived` (nunca apagado), dono (`ownerUserId`, `ownerParticipantId`), visual, contadores e totais em centavos (faturado, em aberto, por categoria até 50 chaves + "Outras", reembolsos), `revision` e versão por `updatedAt`.
- `split_participants/{spt_*}`: ID determinístico por usuário (ou por intenção, no externo); papel; `active`/`inactive`; saldos agregados (devido, pago, a pagar em aberto, a receber em aberto) e contadores; até 50 ativos e 100 registros por grupo.
- `split_bills/{sbl_*}` e `split_shares/{ssh_*}`: valor, data civil, pagador, método `equal`/`percentage`/`fixed`, integração `none`/`cash`/`card` e o vínculo com o fato; rateios `open`/`settled` (`payer_self`, `settlement`, `zero`)/`forgiven`/`voided`, com `amountDueCents`, `amountSettledCents` e `weightBps`. Até 50 rateios por título e 1.000 títulos em aberto por grupo.
- `split_reimbursements/{srb_*}`: pedido PJ, solicitante, valor, data civil, estado, conta e data do pagamento, sequência de pagamento (IDs novos a cada pagamento/estorno).
- `split_events/{sev_*}`: trilha append-only (ator, papel, operação, intenção, `requestId`, `correlationId`, antes/depois, sem nomes nem texto livre) e âncora durável de idempotência por (operação, intenção).
- Agregados reconstruíveis (`functions/src/splitBills/reconciliation.ts`); toda suíte de integração confere a reconstrução depois de cada cenário.

**Callables** (22, `functions/src/splitBills/callables.ts`, wrapper `defineCallable`, Zod estrito, papel do workspace e do grupo relidos na transação, idempotência por intenção com âncora durável, rate limit, auditoria, erros pt-BR, resultado só com identificadores): grupo (`createSplitGroup`, `updateSplitGroup`, `archiveSplitGroup`, `reactivateSplitGroup`), participantes e convites (`createSplitGroupInvite`, `revokeSplitGroupInvite`, `acceptSplitGroupInvite`, `addWorkspaceSplitParticipant`, `addExternalSplitParticipant`, `deactivateSplitParticipant`), títulos e rateios (`createSplitBill`, `updateSplitBill`, `voidSplitBill`, `settleSplitShare`, `reverseSplitShareSettlement`, `forgiveSplitShare`) e reembolso (`createSplitReimbursement`, `approveSplitReimbursement`, `rejectSplitReimbursement`, `cancelSplitReimbursement`, `paySplitReimbursement`, `reverseReimbursementPayment`). A callable antiga (`functions/src/callables/splitGroups.ts`, 2 endpoints) saiu. O codebase passa a **119 endpoints e 112 callables** (4 agendados).

**Rateio e regras de ação.**
- Rateio exato (`functions/src/splitBills/allocation.ts`): igual (maior resto), percentual (basis points inteiros somando exatamente 10.000) e fixo (Σ = valor), participantes ordenados pelo ID por comparação de unidades de código, empate de restos para a menor posição; Σ rateios = valor por construção, sem tolerância. A prévia da tela reproduz a regra; os vetores calculados à mão (`tests/fixtures/split-allocation-vectors.json`, 11) são lidos pelos dois lados.
- Registrar/estornar recebimento: o pagador (participante ativo do grupo), o dono do grupo ou owner/admin do workspace, **nunca o devedor**; com pagador externo, só dono ou owner/admin. Perdoar exige motivo (guardado só no rateio) e é do dono ou owner/admin. Quitação, perdão e estorno são fatos só da Divisão: não movem o Caixa.
- Edição (PR-SPLIT-06): termos (valor, data, pagador, rateio, integração) só antes de qualquer quitação, perdão ou fato financeiro; depois, só descrição e categoria; a edição preserva o método e os valores gravados. Anulação: recusada com quitação ou perdão; compensa no Caixa ou cancela/estorna a compra.

**Caixa e Cartões.** `cash`: lançamento no Caixa `transactions/scash_*` (ID determinístico por título; `source: "split"` e marca backend-only `splitEntry`; despesa confirmada com `valueCents`; movimento da conta no mesmo commit, D-30; fora das callables de correção/anulação do Caixa e da quota manual D-40; responsável o pagador, executor o ator); a anulação grava a compensação (`receita` com `splitEntry.reversal`, mesma conta, data original) e o movimento inverso. `card`: compra P4-A pela primitiva da compra manual (`prepareCardPurchase`/`commitCardPurchase`, `source: "split"`, fatura com retroatividade D-36, reserva de limite e razão); a anulação cancela (sem fatura fechada) ou estorna com crédito (`prepareCardPurchaseReversal`); as callables de cartões recusam alterar, cancelar ou estornar a compra da Divisão (`PURCHASE_SPLIT_MANAGED_MESSAGE`). Só o próprio pagador membro, ou owner/admin por ele (membership do pagador relida), integra; pagador externo não integra. Reembolso PJ: pagamento integral grava a despesa P3 confirmada (descrição genérica "Reembolso de despesa", sem nome nem texto livre) e o movimento da conta; o estorno compensa na mesma conta e volta o item para `approved`. Nenhum fluxo grava `parcelado` em `transactions`; a quota D-40 não é consumida pelos espelhos.

**Quota `splitGroups`** (Free 2, Pro 10, Business 100; `functions/src/splitBills/quota.ts`): criar e reativar reservam vaga em `quota_state/split_groups` na mesma transação, pelo plano efetivo do titular canônico (`assertWithinQuota`); arquivar libera (só sem pendências); só grupos ativos contam; downgrade nunca apaga (grupos seguem lançando; criar e reativar ficam bloqueados); a última vaga sob concorrência é admitida uma vez; mensagens distintas para titular e não titular; `getWorkspaceEntitlement.splitGroupsQuota` (uso e restante só para o titular) alimenta o aviso da tela; `checkWorkspaceLimit` saiu do cliente.

**Rules e índices.** `split_groups`, `split_participants`, `split_bills`, `split_reimbursements` (`list` ≤ 101), `split_shares` (≤ 51), `split_invites` (`get`/`list` ≤ 21 só para owner/admin ou para quem criou, exigindo o filtro de autor) e `split_events` (só owner/admin, ≤ 50): `create, update, delete: if false` (prefixo `split_` em `isBackendOwnedCollection`). `transactions`: o tipo `parcelado` e as chaves `cardId`, `installments` e `currentInstallment` saíram do que o cliente grava; `splitEntry` é marca backend-only (o espelho não é editável nem anulável pelo cliente). Índices: `split_groups (status, createdAt DESC, __name__ DESC)`, `split_bills` e `split_reimbursements (groupId, expenseDate DESC, __name__ DESC)`, `split_invites (groupId, status, expiresAt, __name__)` e `(groupId, createdBy, status, expiresAt, __name__)`; TTL em `split_invites.expiresAt`; os índices antigos de convite saíram.

**Interface** (mesmas telas e classes; comparação em `docs/production/evidence/p4c/antes/` (base P4-B) e `docs/production/evidence/p4c/depois/`, desktop claro/escuro e celular, com os mesmos dados):
- Lista: aviso de limite pela quota do servidor (`getWorkspaceEntitlement.splitGroupsQuota`; texto do titular com "Fazer Upgrade" e do não titular), totais pelos agregados do grupo (sem N+1), arquivar/reativar com confirmação; "Entrar" só com o código.
- Formulário de grupo: erros do backend no próprio formulário em pt-BR, status desabilitado na criação, modo de reembolso só em PJ; trava síncrona.
- Detalhes do grupo: "Eu paguei", "A receber" e "Minha dívida" pelos saldos agregados do participante; despesas e reembolsos por cursor ("Carregar mais"); ações de reembolso (Aprovar, Pagar, Rejeitar, Cancelar, Estornar Pagamento) com confirmação; o pagador aparece pelo nome do cadastro do membro (nunca "Você"; a marca "Você" só identifica o próprio usuário pelo `uid`).
- Formulário de despesa: categoria do catálogo canônico (`useTransactionCatalogOptions('despesa')`, sem categorias mock), conta do Caixa (D-30) ou cartão com parcelas, integração só para o pagador ou admin (texto explica quando não pode), prévia exata do rateio com "Diferença", termos travados com aviso quando já há quitação, perdão ou fato, método e valores preservados na edição; trava síncrona.
- Detalhes da despesa: "Registrar recebimento", "Estornar recebimento" e "Perdoar" (com motivo) só para quem pode — nunca o devedor —, anulação com o efeito no Caixa ou no Cartão descrito, nota de que registrar recebimento não move o Caixa.
- Configurações: incluir membro do espaço (participante/visualizador) ou externo (só nome), remover com confirmação, convite mostrado uma vez com copiar e revogar, arquivar/reativar, sair do grupo.
- Reembolso PJ: "Solicitar Reembolso" (membro só para si), modal "Pagar Reembolso" (conta e data).
- Acessibilidade: sumiram as violações críticas da base (`label`, `select-name`, `button-name`); Escape fecha o formulário de despesa, os detalhes e as configurações (na base não fechava) e o foco fica preso no formulário; nós de contraste iguais ou menores que a base em todos os modais (os restantes são classes que já existiam); rolagem horizontal zero nas 42 capturas. O formulário de grupo continua sem fechar por Escape, como na base.
- Os cinco modais da Divisão passaram a ser renderizados em portal (`document.body`), sem mudança visual: no celular o modal de configurações, mais alto com o contrato novo, ficava sob o cabeçalho (o formulário de despesa já ficava na base).

**Removido** (busca no código, guarda `tests/unit/split-no-client-writes.test.ts` que varre o disco inclusive arquivos não rastreados, Rules): escritas e hooks do cliente em `src/modules/split-bills/**`, `src/modules/split-bills/logic.ts`, `src/components/SharedExpensesView.tsx`, `functions/src/callables/splitGroups.ts` e sua integração, tipos antigos em `src/types.ts`, heurística "Você" e `nomeExibicao`, campos em reais e status antigos, `parcelado`/parcelas pelo cliente, `onAddTransaction(s)` na Divisão, `handleAddTransactions`, `useCreateTransactionsBatch`/`createTransactionsBatch` e o `writeBatch` do módulo de transações, `checkWorkspaceLimit`/`WorkspaceLimitKey`, categorias mock (catálogo canônico `useTransactionCatalogOptions('despesa')`), o comentário obsoleto do `App.tsx`, os índices antigos e as Rules de escrita livre. A Divisão saiu do inventário de escritores diretos de `transactions` (PR-TX-01).

**Defeitos encontrados e corrigidos durante a entrega.**
- `scaleQueries` ainda media o modelo antigo de rateios (filtro `status == aPagar` com `in` por blocos): reescrito para as consultas novas (títulos do grupo por cursor de 20 + sonda, rateios por título ≤ 50, participantes ≤ 100), com tetos absolutos.
- Formulários de grupo, despesa e pagamento de reembolso travavam só pelo estado assíncrono (`isSaving`/`isPending`): dois envios no mesmo tique passavam (o backend deduplicaria pela chave, mas o segundo podia mostrar erro de operação em andamento). Trava síncrona (`useRef`), provada no E2E e pela mutação E1.
- Concorrência: o teste de rajada supunha que todas as quitações simultâneas no mesmo grupo passariam; o Emulator aborta parte delas (`ABORTED`, disputa pelo documento do grupo, que concentra os agregados). O teste passou a afirmar o comportamento correto — cada operação entra inteira ou não entra, com código retentável e agregados exatos — e conclui as restantes em sequência; nenhum retry artificial nem timeout alterado.
- Mutações: B05 (pagador removido do espaço ou rebaixado a viewer ainda integrava no Caixa) e B20 (âncora durável ignorando o hash do payload) sobreviveram na primeira rodada; o código estava correto, faltavam testes — dois testes novos (membership do pagador relida; mesma chave com outros dados depois de expirado o recibo). B14 não compilava no TypeScript estrito e foi reescrito de forma equivalente.
- Revisão financeira: a edição dos termos que lança o fato no Caixa antes de qualquer quitação (caminho suportado pelo backend) não tinha teste; teste novo (fato no mesmo commit, conta movida, termos travados depois).
- Revisão de billing: as Rules do contador `quota_state/split_groups` não tinham asserção própria; a suíte `split-p4c` passou a provar que nenhum papel lê nem grava o contador.
- O primeiro `verify:all` falhou em 2 de 649 integrações: os testes de contrato de `getWorkspaceEntitlement` em `aiCredits` e `quotaMembers` fixavam o formato da resposta sem `splitGroupsQuota`, campo novo da P4-C. Foram atualizados com o valor esperado completo (uso e restante para o titular, `null` para quem não é titular) e o `verify:all` foi refeito do zero.
- Evidência visual: dois elementos novos sem variante escura de contraste (rótulo "Conta" e marca "(externo)"), corrigidos com `dark:text-gray-400`; o modal de configurações coberto pelo cabeçalho no celular, corrigido com portal (acima).

**Testes novos.**
- Functions: `splitAllocation.test.ts` (8, com os 11 vetores compartilhados) e `splitContracts.test.ts` (11) (unitários); `splitLifecycle` (7), `splitFinancial` (9), `splitQuota` (4), `splitParticipants` (8), `splitAuthorization` (7), `splitReimbursement` (3) e `splitConcurrency` (7) (integração no Emulator, 45): criação, edição antes e depois de fatos, anulação com compensação no Caixa e cancelamento/estorno no cartão, quitação, perdão e estorno, reembolso PJ completo, quota com titular e não titular, downgrade e última vaga, convites (hash, uso único, expiração, revogação, rate limit que conta falhas, outro workspace), papéis (viewer, visualizador do grupo, membro removido), isolamento nos dois sentidos, falha injetada antes do commit (título com Caixa, grupo, pagamento de reembolso), replay, conflito de chave pelo recibo e pela âncora, corridas; reconstrução dos agregados conferida em cada cenário. A integração antiga `functions/src/callables/__tests__/splitGroups.integration.test.ts` saiu; `scaleQueries` adaptado.
- Rules: `tests/firestore/split-p4c.rules.integration.test.mjs` (7: escrita negada a todos os papéis inclusive no formato antigo e no contador de quota; leitura nas consultas exatas do frontend com teto; convite só owner/admin ou autor; trilha só owner/admin; cross-tenant e membro removido; `splitEntry`/`parcelado`/`cardId`/parcelas negados em `transactions`; cursor composto e sonda) — `test:rules:split` no `test:integration:emulator` e no `predeploy:rules`; `workspaces-p1`, `adjacent-modules`, `m4-hardening` e `investment-domain` adaptados.
- Frontend: `tests/unit/split-model.test.ts` (14) e `split-no-client-writes.test.ts` (9, varre o disco) — `test:unit:split` (23) em `verify:fast`; `billing-client.test.ts` adaptado.
- E2E: `e2e/split-flow.spec.ts` (5) e apoio `e2e/support/split.ts`.

**Validação (resultados desta entrega).**
- `npm run verify:all` integral sobre o working tree final: **PASS** (código de saída 0).
  - `verify:fast`: typecheck do frontend e das Functions; lint das Functions com 0 erros (281 avisos, contra 283 na P4-B; os arquivos de `functions/src/splitBills/`, inclusive testes e apoio, não têm nenhum); build do frontend e das Functions; unitários das Functions **435/435**; frontend: investimentos 175, P1 128, billing 43, UI 5, caixa 13, empréstimos 21, clientes 16, contas 16, cartões 25, recorrentes 22 e **Divisão 23** (`test:unit:split`, novo), todos verdes.
  - `test:integration:emulator`: integração das Functions **649/649** (Divisão: `splitLifecycle` 7, `splitFinancial` 9, `splitQuota` 4, `splitParticipants` 8, `splitAuthorization` 7, `splitReimbursement` 3, `splitConcurrency` 7); guarda da ferramenta de limpeza 15/15; reconciliação de contas 2/2; Rules **132/132** (metas 5, investimentos 7, domínio de investimentos 19, M3 7, M4 41, adjacentes 5, workspaces 10, billing 10, recebíveis 6, contas 5, cartões 5, recorrentes 5, **Divisão 7**).
  - `test:e2e`: **100/100** (inclui os 5 da Divisão).
- O primeiro `verify:all` desta entrega terminou com 647/649 na integração (testes de contrato do entitlement, descritos acima); depois da correção, a execução integral foi refeita do zero e é a registrada aqui. Os números da P4-B (unitários 416, integração 607, Rules 125, E2E 95) são só referência. Nenhuma suíte com `skip`/`only`, nenhum timeout aumentado, nenhuma repetição artificial.
- Execuções direcionadas durante a entrega: integração da Divisão 45/45 (depois dos testes novos), `scaleQueries` 7/7, Rules da Divisão 7/7, entitlement (`aiCredits` + `quotaMembers`) 48/48, E2E da Divisão 5/5 (antes e depois do portal), unitários da Divisão 23/23.
- Evidência visual: `docs/production/evidence/p4c/antes/` (base P4-B, 21 capturas) e `docs/production/evidence/p4c/depois/` (21 capturas), com `antes-relatorio.json` e `depois-relatorio.json` (rolagem horizontal zero em todas; axe WCAG 2.0/2.1 A e AA nos modais; Escape e foco).

**Mutações** (cada uma aplicada, suíte direcionada executada, código restaurado e conferido por hash): **43 de 43 detectadas** (na primeira rodada, B05 e B20 sobreviveram e B14 não compilava; ver defeitos).
- Rateio (unitário): U01 ordem invertida · U02 percentual aceito abaixo de 100% · U03 fixo aceito abaixo do total · U04 peso zero · U05 participante duplicado · U06 divisão igual com peso extra.
- Backend (integração): B01 devedor quita · B02 participante quita sem ser o pagador · B03 participante perdoa · B04 integra por outro sem ser admin · B05 pagador fora do espaço integra · B06 termos editáveis depois do fato · B07 anulação com recebimento registrado · B08 anulação sem compensar o Caixa · B09 arquivamento com pendências · B10 arquivar não libera vaga · B11 última vaga sem limite · B12 reembolso em PF · B13 convite expirado aceito · B14 viewer do espaço incluído · B15 membro pede reembolso por outro · B16 membro aprova/paga · B17 estorno volta a solicitado · B18 agregado sem sinal · B19 cartões cancelam a compra da Divisão · B20 âncora ignora o hash · B21 lançamento em grupo arquivado.
- Rules: R01 membro quita pelo cliente · R02 member lista convites de todos.
- Frontend e guardas: F01 ordem por `localeCompare` · F02 percentual por `padStart` · F03 empate para a maior posição · F04 tolerância no percentual · F05 devedor registra · F06 participante perdoa · F07 compensação sem sinal · F08 compensação vira receita · F09 leitor aceita float · F10 fixo por ponto flutuante · F11 código com hífen · F12 quota ignorada · F13 grupo arquivado lança.
- E2E: E1 formulário de despesa sem trava síncrona.

**Revisões especializadas** (uma vez cada, limitadas à P4-C; sem gate final de P4):
- **`financial-domain-integrity`: FAIL** no escopo global, por itens fora da P4-C: o tipo `investimento` legado ainda é gravado pelo cliente em `transactions` (D-15), os relatórios seguem no navegador (P5) e restam leitores inertes de `parcelado` (PR-TX-03). **Nenhum achado bloqueante na fatia P4-C** depois das correções acima: fonte única (só o backend grava grupos, participantes, convites, títulos, rateios, reembolsos, trilha e os fatos; Rules negam o cliente, com teste), fato no domínio dono (lançamento P3 com movimento da conta ou compra P4-A; nenhum `parcelado`, nenhum segundo ledger), centavos e basis points inteiros com Σ exato e a mesma regra na tela, quitação/perdão/estorno como fatos só da Divisão, anulação compensatória sem apagar, atomicidade com falha injetada antes do commit, idempotência pelo recibo e pela âncora durável (com conflito de chave nos dois níveis), concorrência (mesmo rateio, rajada no grupo, participantes simultâneos, última vaga), agregados reconstruídos a partir das fontes em todos os cenários, PF e PJ (reembolso só PJ), legado removido com busca, Rules e guarda.
- **`multi-tenant-security-review`: PASS.** Wrapper com pré-checagem do workspace e papel do workspace e do grupo relidos dentro de toda transação; IDs resolvidos no caminho do workspace autorizado; identidade pelo `uid`; membership do membro incluído e do pagador integrado relida; convite: código CSPRNG guardado só como hash por workspace, uso único, validade, rate limit que conta as falhas e resposta genérica; viewer do workspace só lê; membro removido perde o acesso na hora. Testes: isolamento nos dois sentidos (IDs de outro workspace → `not_found`; ator sem membership → recusado; código de outro espaço não existe), Rules como se o backend não existisse (escrita negada a todos os papéis, leitura com teto, convite só owner/admin ou autor, trilha só owner/admin, nada atravessa o workspace, membro removido não lê, `splitEntry` não forjável) e E2E de devedor, viewer e PJ. Logs e trilha só com identificadores.
- **`firestore-scale-cost-review`: PASS.** Leituras só `getDocs`, sempre com teto e sonda: grupos ativos ≤ 100, arquivados por cursor de 50, participantes ≤ 100, títulos e reembolsos por cursor de 20 (`expenseDate`, ID), rateios por título ≤ 50, convites ≤ 20; totais e saldos pelos agregados do grupo e do participante, sem N+1 nos cartões (READ-15); índices compostos para cada consulta (guarda confere as formas) e nenhum índice antigo; transações com leituras limitadas (grupo, participantes envolvidos ≤ 51 por `getAll`, quota, conta ou cartão) e escritas proporcionais aos rateios (≤ 50); contagem de convites pendentes por agregação com teto; TTL nos convites; tetos por grupo (50 ativos, 100 registros, 1.000 títulos em aberto, 50 categorias no agregado). Contenção conhecida e documentada: o documento do grupo serializa as escritas do mesmo grupo (teste de rajada). Retenção do histórico segue D-18 (P8). Medição em `scaleQueries` e fronteira de página nas Rules.
- **`ptbr-product-ui-review`: PASS.** Conteúdo em pt-BR, inclusive erros do backend (mapeados sem mensagem bruta) e estados de vazio, carregamento, corte e sucesso; 21 + 21 capturas com dados equivalentes e os mesmos viewports e temas: mudanças só as exigidas pelo contrato (listadas em Interface) e as correções de contraste e de sobreposição; violações críticas da base removidas, contraste igual ou menor, Escape e foco melhores, rolagem horizontal zero; trava síncrona provada (E2E e mutação E1).
- **`billing-entitlement-integrity`: PASS** no escopo da P4-C (quota `splitGroups`): fonte única no catálogo do backend (2/10/100, exibição pela tabela de planos e pelo entitlement), enforcement na transação de criar e reativar com contador do backend, liberação no arquivamento, última vaga sob concorrência, downgrade sem apagar, mensagens pt-BR de titular (com upgrade) e não titular, Rules negando o contador e os grupos ao cliente (teste), `checkWorkspaceLimit` removido; `BILLING_ENTITLEMENTS.md` atualizado. Fora do escopo desta avaliação (não alterados pelo diff; cobertos no gate de P2 e pela regressão do `verify:all`): checkout, portal, webhook e ciclo de vida Stripe; configuração externa E-* (P9/P10).
- **`privacy-lgpd-data-lifecycle`: não executada**: o participante externo guarda só o nome informado (sem login, e-mail ou telefone), condição do pedido para dispensá-la; a trilha e os espelhos não guardam nomes nem texto livre (teste).

**Blockers** (§6): PR-SPLIT-01…PR-SPLIT-07 e PR-TX-06 resolvidos com a evidência acima e saem do registro no gate de P4; PR-RULES-01 resolvido (parte split); PR-ENT-01 com a parte `splitGroups` resolvida; PR-TX-01, PR-TX-02, PR-TX-03 e PR-TX-05 atualizados (Divisão fora do inventário; abertos por investimento, D-15, e pela fórmula única).

**Riscos residuais.**
- O documento do grupo concentra os agregados: escritas no mesmo grupo se serializam; numa rajada, a transação que não obtém a vez falha inteira com código retentável (teste de concorrência) e o usuário repete. Contenção aceita no volume esperado de um grupo; se necessário, agregados fragmentados ficam para quando houver medição.
- Edição de descrição/categoria depois do fato não propaga para o lançamento do Caixa nem para a compra (cada domínio mantém o seu registro; o vínculo é por ID).
- Leitores inertes do tipo `parcelado` (telas e fórmulas compartilhadas) seguem sem escritor possível; saem com a fórmula única (PR-TX-03).
- Nomes de membros vêm do cadastro de membros do workspace; o externo guarda só o nome que o titular informar (dado de terceiro mínimo, retenção D-18).
- Relatórios no navegador (P5): o espelho da Divisão entra como despesa uma vez, e a compensação com sinal negativo na mesma categoria.
- **Abertos e preservados:** D-15, D-23, D-18, E-06, PR-AI-02/E-00, TX-15, REQ-FUT-01 — Visualização financeira por tempo de trabalho, e P5–P10. P4 não está concluída.

**Rollback.** Reverter o diff da P4-C restaura a P4-B (módulo antigo da Divisão). Nada foi gravado fora do Emulator.

### 19.4 P4-D — D-15: Investimentos definitivos, superfície única, integração com contas e fechamento dos escritores de `transactions` (2026-10-07)

**Ponto de partida.** Working tree idêntico ao ZIP da P4-C (`dindin-minhas-financas-p4c-2026-10-07.zip`, SHA-256 `b6333875…e03b`); P0–P4-C, D-12, D-14, D-30, D-36 e o caixa da P3 preservados (só as extensões descritas abaixo). Não há dados reais: a superfície profissional, os fallbacks, a adoção do caminho do cliente e a inicialização retroativa foram **removidos**, não migrados; dados de teste são recriados pelas callables e pelo Emulator. D-23 e P5 não foram iniciados.

**Decisão D-15** (tomada, implementada e testada; §10): Investimentos permanece como produto; a experiência simples (`SimpleInvestmentsView`, `SimpleInvestmentForm`/`NewInvestmentModal`, `WithdrawInvestmentModal`, `ConfirmMovementModal`) é a única UX; o ledger `investment_movements` e as projeções (`investment_positions`, `investment_summaries`, `investment_report_periods`, `investment_allocation_summaries`) são a fonte patrimonial única; o espelho em `transactions` é só caixa; o fato liquidado move a conta do Caixa (D-30); sem quota nem feature gate em nenhum plano.

**Superfície oficial** (9 callables, `functions/src/investments/callables.ts`, wrapper `defineCallable`, papéis da matriz `writeStrategy.ts` relidos na transação): `createSimpleInvestment`, `settleInvestmentContribution`, `withdrawSimpleInvestment`, `settleSimpleWithdrawal`, `reverseInvestmentMovement` (owner/admin), `cancelInvestmentMovement`, `changeInvestmentGoal`, `linkInvestmentToGoal`, `unlinkInvestmentFromGoal`. **Removidas (14):** `onboardInvestmentWorkspace`, `createInvestmentContribution`, `createInvestmentRedemption`, `settleInvestmentRedemption`, `saveInvestmentAccount`, `archiveInvestmentAccount`, `saveInvestmentAsset`, `archiveInvestmentAsset`, `recordInvestmentValuation`, `registerInvestmentImportBatch`, `recalculateInvestmentPosition`, `recalculateGoalInvestmentProgress`, `rebuildInvestmentProjections`, `backfillInvestmentWorkspace` — com `onboarding.ts`, `backfill.ts`, `rebuild.ts` e `projectionRebuild.ts`. A reconstrução não ficou nem interna: sem chamador, ela era código morto; o reparo operacional medido contra o ledger é da P6/P7. O codebase passa a **105 endpoints e 98 callables** (4 agendados).

**Modelo.** Regime único por valor (`trackingMode: "value"`, valor atual = capital; sem valoração, quantidade na interface nem ganho não realizado). Ativo com carteira (`investment_class`) e categoria (`category`/`investimento`) fotografadas, só `active`; conta técnica por instituição (`institutionId`), só `active`; posição com `realizedLossCents`; movimento liquidado de aporte, retirada ou estorno com `cashAccountId` e `accountMovementId` (ausentes no pendente, no cancelado e no vínculo de meta); `walletId`, `importBatchId`, `expectedSettlementAt`, valoração, snapshot e lote de importação saíram (contratos, Rules, índices e `paths`). O provisionamento semeia só as carteiras de investimento padrão (PF: Reserva de emergência, Aposentadoria, Objetivos; PJ: Caixa e liquidez, Reserva operacional, Expansão); o primeiro investimento cria conta, ativo e posição.

**Integração com contas** (`functions/src/investments/cash.ts`; livro-razão P3-J): aporte depositado exige `cashAccountId` e grava o movimento da conta (kind `investment`, `sourceDomain` `investment`, ID derivado do movimento) no mesmo commit do fato, da posição, das projeções, da meta, do espelho, da auditoria e da idempotência; retirada recebida exige a conta de destino e entra com principal + rendimento; pendente não move conta e recusa `cashAccountId` — a conta é escolhida na confirmação (conta ativa); o estorno compensa o movimento original na **mesma** conta (relido e conferido: conta, origem, valor), datado no dia do estorno; cancelar pendente não move nada; conta arquivada recusa fato e compensação; saldo = Σ movimentos (conferido nos testes); saldo negativo é permitido (só o teto absoluto do livro-razão).

**Espelho de caixa** (`transactions/investment_*`, substituído por inteiro a cada escrita): `type: "investimento"`, `valueCents`, `value` (apresentação), `source: "investment"`, conta e movimento quando liquidado e a marca backend-only `investmentEntry` (`domainVersion`, `movementId`, `operation`, `reversal`, `reversalOf`, `status`, `principalCents`, `gainCents`, `amountCents`, `currency`). A escrita confere que o efeito líquido do espelho é exatamente o movimento da conta. Sem `goalId`, `investmentMetadata`, principal resgatado/remanescente nem `settlementDate`. Projeção de caixa (`cash_report_periods`, versão 4): aporte → `investmentOutflowCents`; retirada → `investmentInflowCents` (principal) + `financialIncomeCents` (rendimento), nunca receita operacional; pendente/cancelado → zero; estorno → compensação; documento `investimento` sem marca válida → zero (backend e frontend). Não consome `transactionsPerMonth` (D-40).

**Fonte patrimonial única (PR-INV-01).** O card "Investimentos" do dashboard lê `investment_report_periods/{AAAA-MM}.contributionCents` (líquido do estorno, mês da liquidação em America/Sao_Paulo) por consulta de `documentId` com `limit(1)`; nada patrimonial lê `transactions`. Metas: vincular, desvincular e trocar preservados; o vínculo mora no movimento, nunca no espelho (D-31 não aberta).

**Rules e índices.** `transactions`: leitura de todo membro ativo; `create, update, delete: if false` para todo papel — nenhum escritor do cliente existe mais (os helpers do caminho do cliente saíram). Catálogo: `investment_type`, `investment_risk`, `investment_liquidity`, `investment_indexer` e `investment_strategy` saíram; ficam `investment_class` (escopo do perfil) e `investment_institution`. `investment_report_periods` passa a ser legível por todo membro ativo, viewer incluído, para o card do dashboard (o mesmo valor que o viewer já via pelo espelho); posições, movimentos, ativos e contas seguem owner/admin/member. Valoração, snapshot e lote de importação sem regra (negados). Índices: 10 removidos sem consulta consumidora (2 de valoração, contas, ativos, posição por conta, ativo e meta, movimento por conta+ativo e o de deriva); ficam 6 de investimentos, todos com leitor (movimentos 4, posições 1, alocação 1). Retenção: as quatro coleções operacionais que já gravavam `expiresAt` (`investment_idempotency_keys` 90 dias, `investment_operational_metrics`, `investment_event_logs` — só falhas — e `investment_drift_reports`, 400 dias) passam a ter TTL versionado em `firestore.indexes.json` (54 índices compostos, 12 TTLs); fatos, posições e projeções não expiram.

**Interface** (mesmas telas e classes; mudanças só do contrato): "Carteira de investimentos" (classificação patrimonial) separada de "Conta de origem"/"Conta de destino" (Caixa); conta pedida só quando há liquidação (novo depositado, confirmar depósito, retirada recebida, confirmar recebimento), preenchida quando há exatamente uma conta ativa; desfazer informa a conta da compensação ("O valor volta para a conta …" / "O valor sai novamente da conta …"); travas síncronas nos três formulários; o card do dashboard pela projeção; lançamento de outro módulo mostra aviso em pt-BR em vez de ser editado ou apagado; Configurações › Cadastros sem os grupos técnicos; na tela Contas e carteiras, a nota de cobertura passa a citar a Divisão de contas e os aportes e retiradas de investimentos liquidados entre os produtores que movimentam as contas (a frase anterior, "ainda não movimentam as contas", ficou falsa).

**Removido** (busca, guardas e Rules): `src/modules/investments/components/*` (7) e `persistence/operationsApi.ts`; `onboardInvestmentWorkspace` e leitores de contas/ativos do frontend; `investment_type`, risco, liquidez, indexador, estratégia e o mecanismo de seção "avançada"; `walletId` em todo o código; `createTransaction`/`updateTransaction`/`deleteTransaction` e hooks, `buildTransactionPayload`, os handlers do `App.tsx` e o modal de exclusão direta; no caixa, a adoção `legacy_manual`, `cash/quotaBackfill.ts` e `cash/ledgerFreeze.ts` (com a releitura da janela em todos os escritores de caixa, empréstimos, recebíveis, cartões e recorrentes) e o `entryKind` da trilha — sem produtor depois do fechamento de `transactions`.

**Defeitos encontrados e corrigidos durante a entrega.**
- Contrato novo (conta obrigatória no fato liquidado) quebrou 5 testes de `simpleMode` que criavam aportes depositados sem conta e um que esperava `goalId` no espelho; as fixtures passaram a informar a conta padrão do workspace e a asserção passou a exigir o espelho sem meta e com `source: "investment"`.
- `loanLifecycle` fixava os totais da projeção de caixa sem `investmentInflowCents` (versão 4); atualizado com o valor esperado (zero).
- Suítes de Rules: fixtures com `Timestamp` do Admin SDK no payload do cliente e movimento liquidado sem `settlementAt`/`settledBy` (a avaliação estourava o limite de expressões em vez de negar pelo motivo certo); corrigidas com conversão explícita e o documento completo.
- `recurringScheduler` simulava falha passageira com a janela `ledger_write_freeze`, que saiu com o caminho legado; a falha passou a ser provocada por ID determinístico de lançamento já ocupado (mesmo comportamento observado: ocorrência `failed` e nova tentativa).
- E2E: `investments-simple` afirmava a ausência de "Conta de origem" (contrato anterior) e `investments-v2` dependia do percentual de alocação semeado com dados antigos; ambos refeitos para o contrato da P4-D.
- O primeiro `verify:all` terminou com 100/101 no E2E: `cash-accounts` esperava a nota antiga da tela Contas e carteiras ("…Divisão de contas e investimentos ainda não movimentam as contas"), falsa desde a P4-C para a Divisão e desde a P4-D para investimentos; o texto já tinha sido atualizado (com teste unitário), faltava o E2E. Ele passou a afirmar a nota nova e a ausência da antiga, e a execução integral foi refeita do zero.
- Revisão financeira: não havia teste de integração de investimento em workspace PJ com conta; teste novo (contexto PJ fotografado em posição, resumo e período; conta do PJ movida; nada no PF).
- Revisão de escala: as quatro coleções operacionais de investimentos gravavam `expiresAt` sem política de TTL versionada, e o índice de deriva não tinha consulta consumidora; TTL versionado, índice removido e teste unitário que fixa os dois (`documentContracts.test.ts`).

**Testes novos ou reescritos.**
- Functions: `investments/__tests__/investmentCash.integration.test.ts` (21, Emulator: conta no mesmo commit para aporte e retirada; pendente sem conta e confirmação com conta; estorno na conta original; cancelamento sem movimento; conta arquivada e de outro workspace sem escrita parcial; falha injetada depois da leitura da conta; replay; aportes concorrentes; espelho sem patrimônio nem meta e documento forjado sem efeito; meta pelo movimento; sem quota; aporte do mês oficial e corte em America/Sao_Paulo; viewer recusado; reconstrução de posições, resumo, período, contas e espelhos a partir do ledger; PJ); `cashEffect.test.ts` (efeito de caixa por marca; sem marca, zero); `documentContracts.test.ts` (conta só no fato liquidado com dinheiro; TTL e índices); `domainV2.test.ts` (conta exigida/recusada; `walletId` fora dos contratos); `writeStrategy.test.ts` (livro-razão declarado nos fatos com dinheiro; cancelamento sem projeção nem conta); `deploymentContract.test.ts` (só as 9 callables).
- Rules: `tests/firestore/transactions-p4d.rules.integration.test.mjs` (8: nenhum papel cria lançamento em `transactions`, de tipo algum; nenhum altera, anula ou apaga o espelho de investimento nem lançamento de outro domínio; todo membro ativo lê, removido e outro workspace não; domínio patrimonial sem escrita e sem movimento para o viewer; agregado mensal do card legível na consulta exata do frontend, viewer incluído; valoração, snapshot e lote de importação inexistentes; catálogo recusa os grupos técnicos e aceita carteira e instituição); suítes de contas, cartões, metas, investimentos, M3, M4, recebíveis, Divisão e workspaces atualizadas para as Rules fechadas.
- Frontend: `tests/unit/investment-surface-guard.test.ts` (9, varre o disco: módulos, componentes e callables removidos não voltam; nenhum `walletId` nem `investment_type`; nada patrimonial lê o espelho; card pela projeção; conta só na liquidação); `investment-simple-form`, `investment-simple-guards`, `investment-transaction-entry`, `investment-semantics`, `investment-goal-link`, `cash-entry` e as guardas `*-no-client-writes` atualizadas.
- Removidas com a superfície que exercitavam: 7 suítes de integração de investimentos (59 testes — `domainV2.integration`, `goalProgressRebuild`, `goalSingleSource`, `m3Lifecycle`, `m7Reports`, `pagedRunContract`, `rebuildConcurrency`), todas dirigidas por executores removidos (aporte e resgate profissionais, valoração, importação, recálculo, rebuild, backfill), e as 3 do backfill de quota do Caixa. O comportamento que continua existindo — vínculo, troca e desvínculo de meta, estorno, cancelamento, períodos mensais, ganho e perda realizados, replay e concorrência — está coberto por `simpleMode` e `investmentCash` (integração) e por `reporting.test`, `domainV2.test` e `writeStrategy.test` (unitários).
- E2E: `e2e/investments-accounts.spec.ts` (4: com duas contas, o aporte depositado exige a conta de origem e move só ela; pendente não move conta e confirmar, retirar, desfazer e cancelar movem a conta certa; duplo clique em "Confirmar depósito" liquida e move a conta uma vez; o servidor decide papel, workspace e conta — member, viewer, outro tenant e conta arquivada) e `e2e/investment-operations.spec.ts` reescrito (faixa PJ, sem administração técnica, reconstrução do caixa pelo runtime, callables profissionais inexistentes no runtime, recusa do servidor para papel sem autoridade); `investment-onboarding.spec.ts` removido com o onboarding.

**Validação (resultados desta entrega).**
- `npm run verify:all` integral sobre o working tree final: **PASS** (código de saída 0).
  - `verify:fast`: typecheck do frontend e das Functions; lint das Functions com 0 erros (204 avisos, contra 281 na P4-C: os arquivos removidos levaram avisos antigos); build do frontend e das Functions; unitários das Functions **436/436**; frontend: investimentos 187, P1 128, billing 43, UI 5, caixa 13, empréstimos 21, clientes 16, contas 16, cartões 25, recorrentes 22, Divisão 23.
  - `test:integration:emulator`: integração das Functions **586/586** (P4-C: 649 — saíram 73 testes da superfície removida, as 7 suítes de investimentos com 59 e as 3 do backfill de quota com 14, e 15 de caminhos removidos: regime quantitativo (3), grupo histórico `investment_type` (2), aporte profissional em posição existente (3), onboarding (1), janela sem escritas no caixa, em empréstimos e em recebíveis (3), adoção `legacy_manual` (2) e recálculo de meta (1); entraram `investmentCash` com 21 e 4 recusas explícitas do contrato novo); guarda da ferramenta de limpeza 15/15; reconciliação de contas 2/2; Rules **140/140** (metas 5, resgates 7, domínio de investimentos 19, M3 7, M4 41, adjacentes 5, workspaces 10, billing 10, recebíveis 6, contas 5, cartões 5, recorrentes 5, Divisão 7, `transactions-p4d` 8).
  - `test:e2e`: **101/101 (inclui os 4 de `investments-accounts` e `cash-accounts` com a nota nova)**.
- O primeiro `verify:all` desta entrega terminou com 100/101 no E2E (`cash-accounts`, descrito acima); depois da correção, a execução integral foi refeita do zero e é a registrada aqui.
- Os números da P4-C (unitários 435, integração 649, Rules 132, E2E 100) são só referência. Nenhuma suíte usa `skip` ou `only`, nenhum timeout foi aumentado e nenhuma asserção foi enfraquecida.
- Execuções direcionadas durante a entrega: `investmentCash` 20/20 e depois 21/21 (com o teste PJ), `documentContracts` 11/11 (TTL), mutações 12/12, evidência visual 1/1 em cada árvore.
- Endpoints: **105 endpoints e 98 callables** (4 agendados), contados no build das Functions.

**Mutações** (cada uma aplicada, suíte direcionada executada, código restaurado e conferido por hash; nenhuma deixou de compilar): **12 de 12 detectadas.**
- M01 contrato aceita fato liquidado sem conta · M02 executor aceita fato liquidado sem conta · M03 aporte depositado sem movimento de conta · M04 retirada recebida sem movimento de conta · M05 estorno em outra conta · M06 card "Investimentos" somando o espelho · M07 investimento sem marca com efeito no caixa (backend) · M08 idem no frontend · M09 Rules liberando `create` de `investimento` · M10 escritor genérico `createTransaction` reintroduzido no cliente · M11 investimento consumindo a quota mensal de lançamentos · M12 callable profissional (`recordInvestmentValuation`) reexportada.

**Evidência visual** (`docs/production/evidence/p4d/antes/` — base P4-C — e `depois/`, 32 + 32 capturas com dados equivalentes criados pela callable de cada árvore: duas contas do Caixa, um investimento depositado e um pendente; desktop 1440×900 e celular 390×844, claro e escuro; painel, lista, novo depositado, novo pendente, confirmar depósito, retirar, desfazer e Contas e carteiras; `antes-relatorio.json` e `depois-relatorio.json`). Rolagem horizontal zero nas 64 telas; axe WCAG 2.0/2.1 A e AA sem violação nos 32 diálogos; Escape fecha todos; foco inicial e depois de 6 Tabs dentro do diálogo. Comparação por pixel: lista idêntica; no painel, a única diferença é o gráfico de pizza capturado em pontos diferentes da animação (até 0,55%; no celular, 0%); as demais diferenças são só as do contrato — "Carteira de investimentos" no novo investimento, "Conta de origem" no novo depositado e na confirmação, "Conta de destino" na retirada recebida, texto "O valor sai da conta escolhida…", no desfazer "O valor volta para a conta Carteira principal." e, em Contas e carteiras, a nota de cobertura nova (uma linha a mais no celular) e o saldo da conta: na base a "Carteira principal" ficava em R$ 0,00 com o aporte depositado; na P4-D mostra −R$ 1.000,00 (o fato liquidado move a conta). Nenhum resíduo profissional.

**Revisões especializadas** (uma vez cada, limitadas à P4-D; sem gate final de P4):
- **`financial-domain-integrity`: FAIL** no escopo global, só por itens fora da P4-D e já registrados: relatórios e gráfico calculados no navegador (P5), leitores inertes de `parcelado` e `value` em reais como apresentação (PR-TX-03), e reparo operacional das projeções de investimento medido contra o ledger (sem callable desde a remoção do rebuild morto; P6/P7). No escopo de D-15 todos os itens passam com evidência: centavos inteiros e datas pela chave de São Paulo; aporte como alocação (saída de investimento, nunca despesa), retirada como retorno de capital mais resultado financeiro (nunca receita operacional), sem valorização não realizada; autoridade só nas 9 callables e Rules negando `transactions` e o domínio patrimonial; fato, posição, projeções, meta, conta, espelho, auditoria e idempotência no mesmo commit (falha injetada sem escrita parcial); replay e concorrência; estorno compensatório na mesma conta e cancelamento sem exclusão; fonte patrimonial única e reconstrução das projeções, das contas e do espelho a partir do ledger (teste); PF e PJ; legado removido com busca, guardas, Rules e mutações.
- **`multi-tenant-security-review`: PASS.** `defineCallable` com pré-checagem do workspace e papel relido na transação (`functions/src/investments/callables.ts:97-161`); conta do Caixa lida pelo caminho do workspace autorizado (`functions/src/accounts/ledger.ts:61-85`; conta de outro workspace = `not_found`, nada escrito); estorno relê o movimento de conta do original e confere conta, origem e valor (`functions/src/investments/cash.ts:127-153`); Rules: `transactions` com leitura de membro ativo e `create, update, delete: if false` (`firestore.rules:691-693`), `investment_report_periods` legível por membro ativo, viewer incluído, só para o agregado do card (`firestore.rules:911-922`), demais coleções patrimoniais sem viewer e sem escrita; Emulator com dois tenants, removido, viewer, member, admin e owner (Rules `transactions-p4d` 8; integração `investmentCash`, `simpleMode`; E2E `investments-accounts` "o servidor decide papel, workspace e conta").
- **`firestore-scale-cost-review`: PASS.** Sem listener; o card lê um documento por mês exibido (`documentId ==` com `limit(1)`, cache de 60 s, invalidado pela mutação); listas com cursor e teto (`src/modules/investments/persistence/readApi.ts`); contas pelo hook compartilhado com teto. Escrita por fato liquidado constante: movimento, posição, resumo, período (mais até 24 períodos posteriores no fato retroativo), alocações, meta (se houver), espelho, movimento e saldo da conta, trilha, idempotência e métrica — nada cresce com o histórico; o espelho dispara o gatilho de caixa já existente (marca de entrega + período). Índices: 6 de investimentos, todos com consulta; 10 removidos sem consumidor; TTL versionado nas 4 coleções operacionais (achado desta revisão, corrigido; teste unitário).
- **`ptbr-product-ui-review`: PASS.** Rótulos, ajudas, validações e o aviso da compensação em pt-BR; erros do backend pelo mapeador `src/modules/investments/errors.ts` (sem mensagem bruta; conta inexistente cai na frase genérica, conta arquivada mostra a pré-condição em pt-BR); 32 + 32 capturas acima com mudanças só do contrato (rótulos de conta, textos da compensação e a nota de cobertura de Contas e carteiras, que ficara falsa); E2E de investimentos e de contas verdes.
- **`billing-entitlement-integrity`: PASS** no escopo da P4-D: investimentos sem quota e sem feature gate em nenhum plano (catálogo do backend sem chave de investimento; o espelho não chama `reserveTransactionQuota` — teste e mutação M11); a quota `transactionsPerMonth` continua só nas callables de criação e importação do Caixa, com âncora `workspace_created` e falha fechada sem âncora (`functions/src/billing/transactionQuota.ts`); com `transactions` fechada às escritas do cliente, nenhum recurso sujeito a quota é criado fora do backend. Fora do escopo: itens do catálogo e do Stripe de P2/P10 não afetados.
- **`privacy-lgpd-data-lifecycle`: não executada**: nenhum dado pessoal novo (a conta é referência por ID; a trilha guarda só identificadores e centavos).

**Blockers** (§6): PR-INV-01, PR-TX-01, PR-TX-02 e PR-TX-05 resolvidos com a evidência acima e saem do registro no gate de P4; PR-TX-03 atualizado (o espelho de investimento decide por `valueCents` e pela marca; `value` em reais e os leitores inertes de `parcelado` seguem para a fórmula única da P5); PR-ENT-01 com a parte de investimentos resolvida (sem quota nem feature gate) e a de lançamentos válida para o aplicativo inteiro (sem escritor do cliente); PR-RULES-01 com a parte `transactions` resolvida. **Os escritores globais de `transactions` foram eliminados:** nenhum caminho do cliente grava, corrige ou apaga lançamento; todos os produtores (Caixa, importação, empréstimos, recebíveis, cartões, recorrentes, Divisão e investimentos) são callables ou rotinas do backend.

**Progresso.** P4: P4-A, P4-B, P4-C e P4-D concluídas; restam D-23 (catálogo de configurações) e o gate de P4 — P4 não está concluída. Geral: P0–P3 concluídas; P4 em fechamento; P5–P10 não iniciadas.

**Riscos residuais.**
- Sem reparo operacional das projeções de investimento: a rotina agendada de deriva compara projeções entre si (posições × resumo × fechamento) e só reporta; a reconstrução contra o ledger (provada em teste) vira ferramenta de operação na P6/P7. Até lá, divergência se resolve por PITR/backup.
- Saldo negativo de conta é permitido (só o teto absoluto do livro-razão), como nos demais produtores do Caixa.
- O agregado mensal de aportes (`investment_report_periods`) é legível pelo viewer — o mesmo valor que ele já via pelo espelho em `transactions`; posições, movimentos, ativos e contas continuam fora do viewer.
- Relatórios e gráfico ainda calculam no navegador a partir do espelho (P5); o efeito de caixa sai da marca e coincide com o movimento da conta (teste), mas a fórmula única é da P5.
- `tools/investments/limpar-investimentos.mjs` (PR-PLAT-02, P6) ainda lista as coleções removidas e a opção de lançamentos de investimento sem marca; ferramenta destrutiva preservada como está até a P6.
- Campos de taxa e imposto do movimento ficam sempre zerados no regime simples (o produto não os coleta nem os inventa).
- **Abertos e preservados:** D-23, D-18, E-06, PR-AI-02/E-00, PR-PLAT-02, REQ-FUT-01 — Visualização financeira por tempo de trabalho, e P5–P10.

**Rollback.** Reverter o diff da P4-D restaura a P4-C (superfície profissional desmontada, callables removidas, escritores do cliente e Rules de `transactions` abertas ao cliente, caminho `legacy_manual`, índices e sem TTL de investimentos). Não há dados reais nem migração; nada foi gravado fora do Emulator, e Rules, índices, TTL e Functions não foram publicados.

### 19.5 P4-D.1 — fechamento documental e consistência pós-D-15 (2026-10-07)

**Ponto de partida.** Working tree idêntico ao ZIP da P4-D (`dindin-minhas-financas-p4d-2026-10-07.zip`, SHA-256 `03daa78c…f910ec`; conferido arquivo a arquivo). Escopo só de documentação e comentários: nenhuma lógica, contrato, Rule, índice, teste, UX, billing ou quota foi alterado; D-15 não foi reaberta; D-23, D-31, D-18 e P5–P10 não foram tocados.

**Inconsistências corrigidas** (a fonte de verdade foi o código da P4-D):
- `LAUNCH_CHECKLIST.md`: 3.12 (Divisão de contas) e 3.13 (`parcelado` e leitura concorrente de investimentos) passam a CURRENT / ATENDIDO NO REPOSITÓRIO (sem implantação), com a evidência da P4-C e da P4-D; 3.1, 3.4, 3.6, 3.9, 3.10 e 1.16 com evidência atual (TTL versionado, `transactions` sem escrita do cliente, convergência da P4 entregue, pendências reais em PR-TX-03/PR-TX-04 e no gate).
- INV-11: resolvido na P4-D (TTL versionado das quatro coleções operacionais de investimentos) em `FINANCIAL_DOMAIN_MODEL.md`, `DATA_MODEL.md` e `DATA_RETENTION_LIFECYCLE.md`; a lacuna restante de TTL foi descrita com o ID certo: `activity_logs` grava `expiresAt` sem política declarada (D-18; RULES-13, READ-18), `goal_idempotency_keys` sem `expiresAt` (GOAL-14), `notifications` (PR-NOTIF-01) e a publicação por ambiente (E-07).
- `DATA_RETENTION_LIFECYCLE.md`: §7 separada em CURRENT (12 políticas versionadas, testes parciais) e TARGET (publicação, cobertura, teste único, P7); §2 com as linhas de código atuais e a distinção versionado × publicado × prazo de negócio (D-18); §3 sem `split_*` em hard delete nem autoria de `transactions` no cliente; §9 com PR-SPLIT-02, PR-RULES-01, PR-TX-05, SPLIT-16, CC-20 e INV-11 no estado real; E-07 como publicação das políticas versionadas.
- Afirmações falsas de TTL em `FIREBASE_PRODUCTION.md` ("não há `fieldOverrides` com `ttl`"), `RUNBOOKS.md` ("nenhum `fieldOverrides`"), `BACKUP_RESTORE_DR.md`, `PRIVACY_LGPD.md` e `OBSERVABILITY.md` (FIRE-08) corrigidas; tabela de TTL de `FIREBASE_PRODUCTION.md` §6 com a coluna "TTL versionado".
- Plano mestre: §2 (dependência "P4 — convergência" ainda dizia que Divisão e investimentos gravavam pelo cliente), PR-RULES-01 (parte `transactions` na P4-D) e PR-REL-02 (evidência atual, fechamento formal no gate de P4). Também `SECURITY_MODEL.md` (linha de exposição do `split_*`), `FINANCIAL_DOMAIN_MODEL.md` (`parcelado` da Divisão, quantidade e preço unitário, P4-D concluída) e referências de linha de `firestore.indexes.json` e das Rules deslocadas pelas mudanças de índices.
- Comentários de código (só texto, prova abaixo) que supunham dados ou caminhos legados reais: `src/modules/transactions/api.ts` (`transactionDate` "em documentos legados" e uma "segunda consulta" que não existe), `hooks.ts`, `TransactionModal.tsx`, `src/types.ts`, `functions/src/cash/{callables,contracts,mutateTransaction,periods,rebuild}.ts`, `functions/src/investments/reporting.ts`, `functions/src/shared/{audit,ids,retention,runtimeOptions}.ts` (este citava o `backfill.ts` removido).

**Achados apenas relatados (fora do escopo documental).** O helper `canMemberWriteWorkspaceScopedData` está definido em `firestore.rules:241-243` sem nenhuma chamada; a mensagem visível "Este lançamento antigo tem um formato que não pode ser corrigido com segurança." (`src/modules/transactions/cashEntry.ts:431`) é o texto genérico de recusa por inelegibilidade e menciona "antigo" (mudar é UX); `src/modules/goals/api.ts:40-60` mantém uma segunda consulta para metas sem o campo `archived` (domínio de metas, D-31/P5); `tools/investments/limpar-investimentos.mjs` ainda lista coleções removidas (PR-PLAT-02, P6). Nenhum JSON de índice inconsistente.

**Validação.** `git diff --check` limpo; arquivos de código alterados só em comentários, provado por comparação da AST impressa sem comentários (tipos incluídos) e da transpilação sem comentários contra a base P4-D, com controle negativo que detecta mudança real; `firestore.rules` e `firestore.indexes.json` sem nenhuma alteração; `npm run verify:fast` executado nesta etapa: **PASS** (código de saída 0) — typecheck, lint das Functions com 0 erros (204 avisos, os mesmos da P4-D: os comentários novos não criaram aviso), builds do frontend e das Functions, unitários das Functions 436/436 e do frontend 499/499 (investimentos 187, P1 128, billing 43, UI 5, caixa 13, empréstimos 21, clientes 16, contas 16, cartões 25, recorrentes 22, Divisão 23). Integração, Rules e E2E não foram reexecutados: nenhum arquivo executável mudou.

**Estado.** D-15 continua implementada (código idêntico ao da P4-D); P4-C continua concluída; P4 continua aberta só por D-23 e pelo gate. **Rollback:** reverter este diff documental e de comentários.

### 19.6 P4-E — D-23: catálogo de configurações definitivo e backend-authoritative (2026-10-07)

**Ponto de partida.** Working tree idêntico ao ZIP da P4-D.1 (`dindin-minhas-financas-p4d1-2026-10-07.zip`, SHA-256 `c092bfce…e3fcf`; conferido arquivo a arquivo). Não há dados reais: a escrita do catálogo pelo cliente, os validadores de catálogo nas Rules, o subtipo `parcelado` do catálogo, as listas mock de categorias do `App` e o helper `legacyCatalogSeedDocumentId` foram **removidos**, não migrados; dados de teste são recriados pelas callables, pelo provisionamento e pelo Emulator. P0–P4-D.1, D-12, D-14, D-15, D-30 e D-36 preservados; P5 não foi iniciada.

**Decisão D-23** (tomada, implementada e testada; §10): as mutações do catálogo de configurações são backend-authoritative. O cliente só lê `settings_catalog`; não cria, não altera, não inativa nem reativa itens e não conhece `settings_catalog_uniques`. Só owner e admin administram (o papel é relido na transação); member e viewer consultam. Inativar não é excluir.

**Domínio** `functions/src/settingsCatalog/` (Investimentos e o provisionamento consomem; nenhum dos dois é dono):
- `model.ts`: grupos canônicos (`product_service`, `expense_type`, `category`, `payment_method`, `income_type`, `cost_center`, `investment_class`, `investment_institution` — sem `wallet`, `investment_type` nem cadastros profissionais), subtipos de `category` (`receita`, `despesa`, `investimento`), normalização, chave de unicidade `grupo::subtipo|all::escopo::nome normalizado`, escopo derivado do workspace (`cost_center` só PJ; `investment_class` = perfil; demais `both`), IDs (`cat_<hash>` por intenção, `seed_<hash>` determinístico das sementes, reserva `lock_<hash>` — o nome pode conter `/`), leitura autoritativa que recusa documento incoerente, documentos de item e reserva, trilha `settings_catalog_events` sem texto livre e teto de 2.000 itens por workspace (o mesmo da leitura completa do frontend).
- `contracts.ts`: Zod `.strict()`; nome 1–120 sem caractere de controle; ícone `^[A-Za-z][A-Za-z0-9]{0,79}$`; cor `#RGB`/`#RRGGBB`; espessura 1–4 em passos de 0,5; ordenação inteira 0–9.999.999.999.999; status `active`/`inactive`; cor e espessura só com ícone; subtipo obrigatório em categoria e proibido nos demais. Escopo, nome normalizado, chave, autoria, datas e IDs não são aceitos.
- `operations.ts` e `callables.ts`: `createSettingsCatalogItem`, `updateSettingsCatalogItem` (renomear, aparência, ordenação, inativar e reativar) e `archiveSettingsCatalogItem`, pelo `defineCallable` (auth, Zod, conta ativa, pré-checagem owner/admin), com papel, membership e workspace ativo relidos na transação, idempotência por ator e chave, limite operacional `settingsCatalogMutation` (120 em 10 min), versão lida (`expectedUpdatedAt`) nas mutações, erros pt-BR e logs sem texto livre. Não há callable de exclusão.
- `seeds.ts`: catálogo padrão (22 itens gerais em PF, 25 em PJ, mais 3 carteiras de investimento do perfil) gravado por `provisionWorkspaceDefaults` na mesma transação da criação do workspace, no mesmo formato das callables e com a reserva de cada nome. `legacyCatalogSeedDocumentId` → `catalogSeedDocumentId`; o prefixo dos IDs semeados passou de `legacy_`/`investment_default_` para `seed_` (sem dados reais, sem backfill); Investimentos classifica as categorias padrão pelo ID semeado, com o mapa de classe técnica tipado pelos nomes das sementes.

**Unicidade, renomear, inativar e reativar.** Criação: o item e a reserva nascem no mesmo commit; nome repetido (acentos, caixa e espaços) falha com `already-exists` e mensagem pt-BR que orienta a reativar quando o dono do nome está inativo. Renomear: relê o item e a reserva atual (que precisa ser dele), confere a nova chave, reserva a nova e libera a antiga no mesmo commit, atualizando o mesmo documento — ID, `createdBy` e `createdAt` preservados; só grafia mantém a reserva. Inativar mantém documento e reserva. Reativar (edição do status) revalida workspace, grupo, escopo coerente com o perfil, versão, estado e a posse da reserva.

**Concorrência e idempotência** (Emulator): criações simultâneas do mesmo nome, dois renomear para a mesma chave, renomear A→B contra criar B, inativar × editar na mesma versão — exatamente uma operação vence, a outra falha de forma determinística e as reservas ficam coerentes; papel perdido ou membership removido entre a pré-checagem e o commit é recusado pela releitura; workspace arquivado é recusado. Mesma chave e mesmo conteúdo devolvem o resultado salvo; mesma chave com conteúdo diferente é conflito; falha antes do commit não deixa item, reserva, evento nem chave; retry depois do commit com a chave expirada não duplica (o evento de criação ancora o replay; a edição esbarra na versão). O frontend reusa a chave enquanto o conteúdo do diálogo não muda.

**Rules e índices.** `settings_catalog`: `get` e `list` (`limit <= 2001`) por membro ativo; `create, update, delete: if false` para todo papel. `settings_catalog_uniques` e `settings_catalog_events`: `read, write: if false`. As três na lista `isBackendOwnedCollection`, para a catch-all não reabrir a listagem. Os validadores de escrita do catálogo saíram (`firestore.rules` com 1.068 linhas). Índice novo `settings_catalog (sortOrder, normalizedName, __name__)` para a leitura completa; os 4 da paginação seguem com consumidor; guarda que confere consulta × índice. **PR-RULES-03 resolvido** (índice versionado, renomear pela callable, Rules negando o caminho antigo).

**Frontend.** `src/modules/settings-catalog/api.ts` lê pelo Firestore e muta só pelas callables (`callables.ts`, módulo puro); sem `runTransaction`, `setDoc`, `updateDoc`, `deleteDoc` nem `serverTimestamp`; o payload leva só a intenção. Cadastros: owner/admin veem "Novo cadastro", "Editar" e "Inativar"; member/viewer veem a lista sem ações. Mudanças visíveis, todas exigidas pelo contrato: aba "Parcelados" removida das categorias (Receitas, Despesas, Investimentos); mensagem de erro do backend dentro do formulário, que continua preenchido; texto da confirmação de inativação corrigido ("O nome continua reservado: para usá-lo de novo, reative este cadastro." no lugar da afirmação falsa de que a chave era liberada); botão de confirmar desabilitado durante o envio. A aba "Parcelado" do lançamento continua (compra pelo domínio de cartões) e usa as categorias de despesa. Recorrentes classificam pelas categorias de despesa do catálogo (antes, lista mock do `App`); Divisão de contas já usava. O cadastro inline de produto no lançamento usa a callable (owner/admin) e mantém a recusa para member. Saíram do `App` os estados mock de catálogo e as props mortas.

**Testes.** `npm run verify:all` executado do zero nesta etapa: **PASS** (código de saída 0, 21 min) — typecheck, lint das Functions com 0 erros (204 avisos, os mesmos da base), builds do frontend e das Functions; unitários das Functions 443/443 (+6 do modelo e dos contratos do catálogo, +1 do contrato de implantação); frontend 516/516 (+17 da P4-E: `settings-catalog-model` e as guardas `settings-catalog-no-client-writes`, incluindo consulta × índice); integração no Emulator 603/603 (+17 do catálogo, PF e PJ: criação por owner/admin, member/viewer/sem login/removido/workspace arquivado negados, papel perdido e membership removido entre a pré-checagem e o commit, isolamento A↔B, contrato estrito, nome repetido, criações simultâneas, renomear e só grafia, renomear para nome ocupado, versão antiga, dois renomear para a mesma chave, renomear × criar, inativar/reativar, reativação revalidada, inativar × editar concorrentes, replay, conflito de chave, chave expirada, falha antes do commit, teto de 2.000 itens; provisionamento conferindo formato autoritativo e reserva de cada semente); ferramentas 17/17; Rules 144/144 (+4 da suíte `settings-catalog-p4e`; as suítes `accounts-p3j`, `investment-domain`, `m4-hardening`, `transactions-p4d` e `workspaces-p1` passaram a exigir negação de escrita do cliente no catálogo, sem nenhum controle positivo de escrita); E2E 103/103 (+2 de `e2e/settings-catalog.spec.ts`: owner cria, recusa nome repetido com o formulário preservado, renomeia, inativa e reativa só pelas callables, envio duplo sem duplicar, aba Parcelado com categoria de despesa criando compra sem `transactions` do tipo parcelado, admin administra, member/viewer sem ações, perda de papel com o formulário aberto, recusa do backend a member e a outro tenant, centro de custo só em PJ; `credit-card-flow` passou a semear a categoria do cartão como despesa). Evidência visual antes/depois e roteiro por teclado em `docs/production/evidence/p4e/`.

**Mutações dirigidas** (12 dirigidas; 11 detectadas na primeira rodada; a de idempotência na criação sobreviveu por ser **equivalente** — a âncora durável (ID determinístico do item + evento de criação com o hash do pedido) devolve o mesmo replay mesmo sem a reserva — e foi reescrita no caminho de edição (M10b), onde foi detectada: 12/12 com efeito detectadas): member permitido; sem releitura do workspace na transação; criação sem reserva; renomear sem mover a reserva; inativar apagando a reserva; cliente gravando `settings_catalog`; cliente gravando reservas; `parcelado` como subtipo; contrato aceitando `updatedBy`; idempotência omitida; centro de custo em PF; escritor direto no frontend. Cada mutação compila, é revertida e conferida por hash.

**Revisões (uma vez).** `multi-tenant-security-review` **PASS** (identidade do token, `workspaceId` validado e conferido no documento, owner/admin relido na transação, contratos estritos, item + reserva + evento no mesmo commit, versão lida, reserva conferida antes de ser liberada, Rules independentes negando toda escrita do cliente e fechando reservas e trilha, A↔B, removido e anônimo testados no Emulator); `firestore-scale-cost-review` **PASS** (leitura completa limitada a 2.001 com teto de itens no backend, paginação de 31 com cursor, 5 índices com consumidor e guarda, criar = 5 escritas, renomear ≤ 8, inativar = 4, contagem na transação ≤ 2 leituras de agregação, trilha limitada pela taxa e retida como auditoria, sem listener, N+1, varredura ou cron novo); `financial-domain-integrity` **PASS** no escopo da P4-E (catálogo de classificação, sem valor monetário: fonte única no backend, sem exclusão, fatos antigos não reescritos, PF/PJ explícitos, legado removido com busca, guardas e Rules; criação, edição, inativação/reativação, replay, concorrência, autoridade e falha antes do commit testadas); `ptbr-product-ui-review` **PASS** (textos novos em pt-BR, erros do backend sem detalhe interno, mudanças visuais só as exigidas e comprovadas antes/depois, transbordo 0, axe sem violação nova, roteiro por teclado; Escape que não fecha o formulário e as violações axe do seletor de ícones são pré-existentes e idênticas na base). `billing-entitlement-integrity` e `privacy-lgpd-data-lifecycle` não se aplicam: nenhuma quota, plano ou dado pessoal novo (a trilha não guarda o nome digitado).

**Riscos.** O índice novo e as Rules só valem depois de publicados em cada ambiente (E-07; deploy fora do escopo dos agentes). A ferramenta `tools/investments/limpar-investimentos.mjs` (PR-PLAT-02) não conhece `settings_catalog_events` (não a apaga). A trilha do catálogo não tem leitura pela interface.

**Rollback.** Reverter o diff da P4-E (código, Rules, índice e documentação). Sem dados reais, não há migração a desfazer; ambientes de teste são recriados pelo Emulator.

**Estado.** D-23 tomada e implementada; P4-A…P4-E concluídas; **P4 não está concluída: resta só o gate de P4, não executado.** P5–P10 não iniciadas.
- **Abertos e preservados:** D-18, D-31, E-06, PR-AI-02/E-00, PR-PLAT-02, REQ-FUT-01 — Visualização financeira por tempo de trabalho, e P5–P10.

### 19.7 Gate final da P4 — auditoria integrada de Cartões, Recorrentes, Divisão de contas, Investimentos e Catálogo (2026-10-08)

**Base.** Branch `integration/p4-finalization-2026-10-08`, commit `0d979012ad484a6a3d536af9ebf3c66cf4dc8042`, tree `429472e5c5d070969538b7d7783056e9fe66203d`, tag `checkpoint-p4e-audited-2026-10-08` (equivalente ao ZIP P4-E, SHA-256 `1f8cbc37…6d132`), working tree limpo. O diff do gate é medido contra esse commit. Não houve commit, push, deploy nem operação em ambiente remoto.

**Resultado: P4 GATE PASSED.** P4-A, P4-B, P4-C, P4-D e P4-E aprovadas em conjunto; nenhum BLOCKER P4 aberto; `regression-release-gate` **PASS**.

**Por módulo.**
- **P4-A Cartões (D-36):** 13 callables pelo kernel, papel relido na transação, idempotência por ator e chave com âncora durável (`credit_card_events` por intenção); ciclo e pagamento separados, `overdue` só derivado; compra, parcela, fatura, pagamento, estorno de pagamento, ajuste e reembolso só no domínio; pagamento e estorno movem a conta (D-30) no mesmo commit, o estorno na conta do original; rotina de fechamento paginada com releitura. Concorrência nova: duas quitações integrais da mesma fatura com a mesma versão — uma vence (`p4CrossDomain`).
- **P4-B Recorrentes (D-12):** 8 callables e `processRecurring` (consulta seletiva paginada, catch-up de 12 vencimentos, 500 por workspace); ocorrência = recorrência + vencimento com `create()` e releitura do `nextDueDate`; automática fora do cartão gera despesa pendente sem mover conta; confirmação paga move a conta; cartão pela primitiva P4-A; datas civis de São Paulo; sem quota manual.
- **P4-C Divisão de contas (D-14):** 22 callables; papel do workspace e do grupo relidos; identidade por `uid`; centavos e basis points com maior resto; título no Caixa ou no cartão no mesmo commit; reembolso PJ pago move a conta; quota `splitGroups` na transação, downgrade não apaga. Concorrência nova: dois pagamentos do mesmo reembolso — um vence.
- **P4-D Investimentos (D-15):** 9 callables (`createSimpleInvestment`, `settleInvestmentContribution`, `withdrawSimpleInvestment`, `settleSimpleWithdrawal`, `reverseInvestmentMovement`, `cancelInvestmentMovement`, `changeInvestmentGoal`, `linkInvestmentToGoal`, `unlinkInvestmentFromGoal`), contados nos exports carregados; experiência simples única; ledger patrimonial e projeções como fonte; aporte/retirada liquidados e estornos movem a conta, o estorno na conta do original (teste novo com segunda conta); `gainCents` separado; sem `walletId`, `investment_type` ou leitor patrimonial em `transactions`; Dashboard pela projeção `investment_report_periods`; sem quota de Investimentos. Concorrência nova: dois estornos do mesmo aporte — um vence; arquivar conta × aportar nela — nunca os dois.
- **P4-E Catálogo (D-23):** 3 callables, só owner/admin (relido); member e viewer leem; unicidade por reserva `lock_<hash>`; renomear move a reserva; inativar mantém a reserva; reativar pela edição de status; `parcelado` fora dos subtipos (mutante G15 morto); a aba de compra parcelada do lançamento (rótulo "Cartão", tipo interno `parcelado`) usa categorias de despesa; sementes `seed_<hash>`; PR-RULES-03 resolvido. Item inativo recusado em fato novo e histórico resolvível pela fotografia do nome (teste novo).

**Autoridades.** Caixa: `cash_accounts` + `cash_account_movements` (saldo = soma dos movimentos; `runCashAccountReconciliation`). Cartões: compras, faturas, pagamentos, estornos, limite e ciclo em `functions/src/cards/`. Empréstimos e recebíveis: livros próprios. Investimentos: `investment_movements` + posições, resumos e `investment_report_periods`. `transactions`: espelho/registro de caixa escrito só pelo backend, com a marca do domínio (`creditCardPaymentEntry`, `recurringEntry`/`cashEntry`, `splitEntry`, `investmentEntry`, `loanEntry`, `receivableEntry`); nenhum leitor de autoridade o usa. Conta = livro-razão = espelho, por conta, provado no teste transversal com cinco produtores.

**Escritores do cliente.** Só `notifications` (marcar como lida e apagar; não financeiro, PR-NOTIF-01, P5). Nenhuma escrita do browser em `transactions`, `settings_catalog`, `settings_catalog_uniques`, contas, cartões, recorrentes, divisão, investimentos, empréstimos ou recebíveis (busca por `addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|increment|arrayUnion|deleteField|uploadBytes` em `src/`).

**Correções do gate (BLOCKER P4).**
1. **Leitor de campo removido na D-15.** A trilha `activity_logs` do gatilho de `transactions` calculava o efeito em caixa por `getSignedBalanceValue`, que somava `value` em reais e lia `investmentMetadata` — campo sem produtor desde a P4-D; a retirada de investimento aparecia como saída. Agora usa a mesma classificação da projeção (`cashPeriodDeltaFor`, marcas de domínio, pendente e baixa lógica), em centavos (`details.netCentsBefore`/`netCentsAfter`), em `functions/src/triggers/transactions.ts`. A trilha não tem consumidor; o campo trocou de nome junto com a unidade.
2. **Helper morto nas Rules.** `canMemberWriteWorkspaceScopedData` (sem nenhuma chamada desde a P4-D) removido; sem mudança de semântica.
3. **Helpers P4 sem nenhum uso.** `buildVisualSnapshotFromCatalogItem` (snapshot "persistido na transação", resto do escritor de `transactions` do cliente removido na P4-D), `getSettingsCatalogSectionByKey`, `investmentIdempotencyKeyHash` e `invoiceStateSnapshot` removidos, com os imports que ficaram sem uso.
4. **Documentação CURRENT.** LAUNCH_CHECKLIST 3.4, 3.10 e 3.13 (D-23 não é mais destino dos leitores de `parcelado`; linhas das Rules; 55 compostos); contagem de endpoints (108: 101 callables, 4 agendados, 2 gatilhos e 1 webhook) em SECURITY_MODEL, FIREBASE_PRODUCTION e ARCHITECTURE; PR-TX-06 e o tipo `parcelado` em FINANCIAL_DOMAIN_MODEL; cobertura de Rules e helpers em DATA_MODEL; trilha do gatilho em OBSERVABILITY, DATA_MODEL, FIREBASE_PRODUCTION, INCIDENT_RESPONSE e SECURITY_MODEL; blockers P4 fechados (este registro).

**Blockers encerrados neste gate** (permanecem no registro §6 marcados como fechados, para rastreabilidade): PR-CC-01…PR-CC-08, PR-REC-01…PR-REC-06, PR-SPLIT-01…PR-SPLIT-07, PR-TX-01, PR-TX-02, PR-TX-05, PR-TX-06, PR-INV-01, PR-RULES-01 (partes recurring, split e `transactions`) e PR-RULES-03. Continuam abertos, com milestone próprio: PR-TX-03 (P5), PR-TX-04 (P7), PR-REL-02 (cobertura de escrita de `activity_logs`), PR-RULES-02 (P6), PR-PLAT-02 (P6).

**Testes novos.** `functions/src/shared/__tests__/p4CrossDomain.integration.test.ts` (6 cenários, só interfaces entre domínios): caixa com cartão, recorrente pendente e confirmada, título, reembolso PJ, aporte, retirada e estorno em segunda conta, sem quota manual e com a trilha do gatilho; `transactions` forjado sem efeito em saldo, posição, resumo, fatura ou limite; catálogo inativo; RBAC uniforme (viewer, membership removido depois da pré-checagem, member em operação administrativa, papel do ator mentido) sem nenhuma escrita; IDs de outro workspace recusados em nove integrações sem escrita em A nem em B; concorrência (fatura, estorno de aporte, reembolso, conta arquivada × aporte).

**Mutações do gate** (14 efetivas, 14 mortas; cada uma compila, é revertida e conferida por hash): cliente cria em `transactions` (Rules); owner/admin gravam `settings_catalog` (Rules); posição lida dos espelhos de `transactions`; pagamento de fatura consumindo `transactionsPerMonth`; conta resolvida por ID global sem conferir workspace (IDOR); aporte sem reler membership; recorrente sem releitura do vencimento e com ID não determinístico; quitação de rateio sem versão e sem estado; papel do ator aceito sem membership ativo; mesma chave com outro conteúdo virando replay; movimento sem atualizar o saldo; estorno de aporte em outra conta; trilha do gatilho voltando a `value` em reais; `parcelado` como subtipo do catálogo. Três primeiras versões eram equivalentes e foram reescritas: retirada sem a guarda de principal (a de quantidade e a validação do estado da posição recusam), ocorrência já gerada não reconhecida (o `create()` determinístico recusa) e rateio sem conferir estado (a versão lida recusa) — defesa em profundidade.

**Evidência visual** (`docs/production/evidence/p4-gate/`): 38 capturas (Cartões, Recorrentes, Rateios & Reembolsos, Investimentos, Cadastros e seis diálogos) em desktop e celular, claro e escuro; base × gate só com ruído de antialiasing (igual ao de duas capturas da mesma árvore); rolagem horizontal 0; medições de axe, foco e Escape idênticas às da base; nenhum erro da aplicação no console.

**Validação.** `verify:all` integral depois da última mudança funcional: `verify:all` **PASS** em 24 min (2026-10-08T17:37:10Z–18:01:44Z), depois da última mudança funcional: typecheck; lint das Functions com 0 erros (204 avisos, os mesmos da base); builds do frontend e das Functions; unitários das Functions 443; unitários do frontend 516; integração das Functions no Emulator 609 (603 + 6 da suíte transversal); ferramentas 17; Rules 144 em 15 suítes; E2E 103. Nenhum teste pulado, `only`, repetido ou instável.

**Revisões (uma vez, estado final).** `financial-domain-integrity` **PASS**; `multi-tenant-security-review` **PASS**; `firestore-scale-cost-review` **PASS**; `billing-entitlement-integrity` **PASS** (quotas tocadas pela P4: D-40, `splitGroups`, sem quota de Investimentos, downgrade sem perda); `ptbr-product-ui-review` **PASS** (sem mudança renderizada; base × gate idênticos); `observability-incident-readiness` **PASS** no escopo da trilha alterada e das trilhas de auditoria P4; `regression-release-gate` **PASS**. `firebase-production-readiness` não se aplica ao diff (sem ambiente, runtime, segredo nem publicação; Rules e índices versionados ≠ publicados, E-07).

**Dívidas futuras preservadas.**
- **P5:** fórmula única e leitores de relatório/dashboard sobre `transactions` (PR-TX-03: `value`/`valueCents`, `date`/`transactionDate`, leitores de `parcelado`, card "Saldo Atual" = fluxo do mês por `summarizeCashFlow`), metas PJ somando `transactions.value` (D-31), relatórios server-side (PR-RPT-*, D-37), notificações (PR-NOTIF-01, inclusive a exclusão física pelo cliente), prompt de IA que ainda lista `parcelado` (PR-AI-05), mocks de pré-visualização (`MOCK_TRANSACTIONS`, paleta de categorias de relatório).
- **P6:** catch-all de leitura de subcoleção e `transactions`/`loans`/`clients` sem teto de listagem nas Rules (PR-RULES-02; `activity_logs` legível por membro), App Check, IAM, `tools/investments/limpar-investimentos.mjs` (PR-PLAT-02; ainda lê `investmentMetadata` e conhece o projeto de produção).
- **P7:** reconciliação agendada e detector de deriva (PR-TX-04), alertas (D-28), ENTRY-17 (`activity_logs` com o responsável, não o ator; a trilha autoritativa é `cash_events`), observabilidade e repair jobs.
- **P8:** retenção (D-18), ciclo de vida dos dados de terceiros (PR-CR-05, D-07).
- **P9:** acessibilidade das telas P4, igual à base anterior à P4 (contraste; botões sem nome nos seletores de ícone e cor; rótulos sem `htmlFor` e `<select>` sem nome em novo cartão, novo rateio e "Nova Transação"; Escape que não fecha os diálogos de cartão, recorrência, rateio e cadastro) — LAUNCH_CHECKLIST 8.9 ou etapa de UX autorizada; landing, preços e páginas legais.
- **P10:** auditoria adversarial e gate completo de produção.
- **Externos/decisões:** E-06, PR-AI-02/E-00, D-18, D-31, REQ-FUT-01; E-07 (publicação de Rules e índices por ambiente).

**Riscos.** Rules, índice e a trilha do gatilho só valem depois de publicados (E-07; deploy fora do escopo dos agentes). A trilha `activity_logs` muda de campo (`balanceBefore/After` em reais → `netCentsBefore/After` em centavos) sem consumidor; documentos antigos ficam até o TTL de 365 dias.

**Rollback.** Reverter o diff do gate contra `0d97901` (gatilho, helper das Rules, helpers sem uso, suíte transversal, evidência e documentação). Sem dados reais nem migração.

**Estado.** **P4 — CONCLUÍDA** em 2026-10-08. Próxima fase recomendada: P5 (não iniciada).


---

## 20. P5 — execução e evidências

### 20.1 P5-A — isolamento do histórico do chat de IA (2026-10-08)

Sobre o checkpoint `f0c172b` (tag `milestone-p4-complete-2026-10-08`), sem commit. Escopo autorizado: só PR-AI-04. Decisão do usuário registrada como **D-41** (§9.4): **o DINDIN mantém o histórico da IA no navegador, isolado por usuário e workspace, com limpeza no logout** — substitui a recomendação anterior de histórico só em memória ou server-side.

**Problema confirmado (HEAD `f0c172b`).** Chave `finance_ai_chat_history_${workspaceId}` sem usuário; a carga de um workspace sem histórico não zerava o estado e o salvamento gravava o histórico anterior na chave nova; respostas atrasadas entravam no contexto que estivesse aberto; "Limpar Histórico" não impedia que uma resposta pendente recriasse mensagens; a limpeza de conta dependia só da conta anterior da mesma aba (`previousUid`), sem cobrir a carga nova do aplicativo com outra conta; a leitura assíncrona do perfil podia restabelecer o usuário anterior.

**Arquitetura entregue.**
- `src/modules/reports/aiChatStorage.ts` (módulo puro, única porta do armazenamento): escopo só por `resolveAiChatScope(uid, workspaceId)`, que recusa vazio, `loading`, `undefined`, `null`, espaços, caracteres de controle e texto mal formado; chave `finance_ai_chat_history_v2:<uid>:<workspaceId>` com as partes escapadas (`encodeURIComponent`), injetiva mesmo com `:`, `%` ou `_` nos identificadores; envelope `{v: 2, uid, workspaceId, messages}` validado na leitura (chaves exatas, tipos `user`/`ai`, id, texto, horário, escopo igual ao da chave) — conteúdo inválido nunca vira histórico e a chave do próprio escopo é apagada; leitura, gravação e remoção sem lançar (`SecurityError`, `QuotaExceededError`, armazenamento ausente); expurgo idempotente do formato antigo sem usuário, que nunca é lido (expurgo, não migração).
- `src/modules/reports/aiChatSession.ts`: um registro por escopo, hidratado do armazenamento uma única vez e antes de qualquer gravação; geração por sessão (fechar a sessão — troca de workspace ou de conta, desmontagem — e limpar avançam a geração e descartam pendentes); época global (logout, troca de conta, outra aba); toda resposta e todo erro levam o escopo, a geração, a época e o id da requisição capturados no envio e só entram se ainda forem os atuais; gravação só quando o dono local é o uid do escopo; sem armazenamento, o chat segue em memória por escopo. O hook `useScopedAiChat` lê por `useSyncExternalStore` o registro do escopo da renderização atual — a troca de workspace não mostra o histórico anterior nem por um quadro.
- `src/modules/reports/hooks.ts` (`useFinanceAIChat`): escopo = uid da sessão do Firebase Auth (`useAuth`) + workspace ativo, só quando o workspace foi carregado para esse uid (`activeWorkspaceUid`, novo em `src/contexts/WorkspaceContext.tsx`); sem escopo, nada é lido, gravado nem enviado.
- `src/components/ReportsAIChat.tsx`: `key` por sessão no `AnimatePresence` (a animação de saída não mantém mensagens de outro workspace na tela) e rascunho do campo por sessão. Nenhuma mudança visual.
- `src/lib/sessionCleanup.ts` + `src/contexts/AuthContext.tsx`: dono local (`dindin_local_session_owner`; só identifica dados, não autoriza nada) e `reconcileLocalSession` a cada emissão do Firebase Auth — troca de conta na aba (inclusive logout): tudo do usuário sai, como na P1; carga nova sem sessão: saem as conversas e o dono local (a preferência `lastWorkspaceId_<uid>` fica); carga nova com a conta X e dono diferente ou ausente: sai tudo que não é de X. Sessões do chat em memória invalidadas no logout, na troca de conta e quando outra aba muda o dono local (evento `storage`). A leitura do perfil de uma emissão antiga não aplica mais o usuário anterior (geração da emissão).
- Inalterados: backend de IA, provedor, modelo, prompts, contratos das callables, créditos, rate limits, Rules, índices, relatórios.

**Limites declarados.** `localStorage` não é criptografado nem cofre: o isolamento é lógico, por sessão; scripts da mesma origem (XSS), extensões do navegador e quem acessa o perfil do navegador leem o conteúdo. Não há cópia no servidor. Sem prazo de expiração (D-18). Uma pergunta já enviada pode ter consumido crédito no servidor; descartar a resposta tardia não cancela a operação nem devolve o crédito. Transparência, base legal, retenção e direitos do titular sobre o histórico: P8 (PR-AI-01, D-18).

**Testes.** Unitários com hooks React reais (`react-test-renderer@18.2.0`, devDependency nova na mesma versão do React; sem DOM): `tests/unit/ai-chat-history.test.ts`, 29 cenários — os 25 pedidos (chaves por uid e por workspace, separadores sem colisão, carga, vazio, PF → PJ, PJ → PF, A → B, A → B → A, logout, primeira carga com resíduos, formato antigo não lido, limpar só o escopo, resposta tardia após troca de workspace, de conta, limpeza e PF → PJ → PF, erro tardio, desmontagem, JSON inválido e envelopes de outro uid ou workspace, armazenamento indisponível ou recusando, persistência após recarga, nenhuma gravação antes da hidratação, StrictMode, nenhuma renderização com texto de outro contexto) e mais quatro (sem escopo, dono local de outra conta, logout em outra aba, resíduo que preserva só o que é da conta); `tests/unit/ai-chat-history-guard.test.ts`, 6 guardas estáticas (o nome do histórico só no módulo de armazenamento e na limpeza da sessão; nenhuma chave montada só com o workspace; chat sem `localStorage` direto; leitura e gravação só da chave do escopo; escopo pela sessão autenticada e pelo workspace carregado para ela; chave injetiva); `tests/unit/session-cleanup.test.ts`, +3 (dono local, reconciliação, resíduo por conta). E2E: `e2e/ai-chat-isolation.spec.ts`, 2 cenários no Emulator com duas contas reais, PF e PJ, IA simulada no limite de rede, resposta atrasada controlada e `MutationObserver` (PF → PJ → PF, recarga, resposta que chega com o PJ aberto, limpar, logout, login de outra conta na mesma página; primeira carga de outra conta com resíduos); `e2e/workspace-membership.spec.ts` passou a criar o histórico no formato atual (o formato antigo deixou de ser tratado como válido).

**Mutações** (cada uma compila, roda a suíte unitária e é revertida e conferida por hash): 16 efetivas, 16 mortas no código final: chave sem uid; fechar a sessão sem invalidar; limpar sem invalidar; reset sem época nem descarte; gravação sem conferir o dono local; envelope aceito sem conferir o escopo; primeira carga ignorando o dono local; troca ou desmontagem sem fechar a sessão; snapshot preso ao escopo anterior; expurgo apagando o formato atual; tipo de mensagem não validado; partes da chave sem escape; hidratação do histórico de outra conta local; resíduo preservando chaves de outra conta; carga sem sessão mantendo as conversas; posse por prefixo sem o separador. As três primeiras versões de "fechar", "limpar" e "reset" (só sem a geração ou a época) eram equivalentes — o conjunto de pendentes com ids únicos já descarta a resposta (defesa em profundidade) — e foram reescritas removendo todas as camadas. No E2E, a mutação "fechar a sessão não invalida" faz a resposta atrasada reaparecer no PF e o teste falha; arquivo restaurado por hash.

**Evidência visual** (`docs/production/evidence/p5a/`): 12 capturas do chat (PF vazio, PF com conversa, PJ logo depois da troca e PF de volta, em desktop claro e escuro; vazio e com conversa no celular claro e escuro) com o mesmo roteiro na base e na P5-A: **0 pixel diferente**; rolagem horizontal 0 nas duas árvores. O E2E registra com `MutationObserver` todo quadro com texto de outro contexto: nenhum.

**Validação.** `verify:all` integral depois da última mudança de código (2026-10-08 20:33:58Z → 20:57:44Z, rc 0): Functions unit 443, frontend unit 554 (516 + 38 novos), integração no Emulator 609, tools 17, Rules 144 em 15 suítes, E2E 105 (103 + 2 novos), lint 0 erros (204 avisos); nenhum `not ok`, nenhum skip ou `only`, sem timeout ou retry aumentado. No contêiner, os emuladores rodam por um proxy local de loopback (o `firebase-tools` ignora `NO_PROXY`); infraestrutura de teste, fora do repositório.

**Revisões.** `multi-tenant-security-review` **PASS**; `privacy-lgpd-data-lifecycle` **PASS** (escopo: armazenamento local e ciclo de sessão; transparência, base legal, retenção e direitos do titular ficam em P8); `ptbr-product-ui-review` **PASS**; `regression-release-gate` **PASS**.

**Fechado:** PR-AI-04 (implementado e testado; aguardando auditoria independente antes do commit). **Não fechados (fora do escopo):** PR-AI-05, PR-AI-01, D-11, PR-MSG-01 e as demais subetapas da P5.

**Outros achados (registrados, sem ampliar o escopo).** (1) A mensagem de falha inesperada do chat, "Erro ao consultar a IA. Verifique sua chave API ou tente novamente.", cita chave de API (detalhe interno e instrução que não se aplica ao usuário); mantida literalmente — só aparece numa exceção fora do tratamento de `askFinanceAI` — e fica para a P5-E1. (2) No celular, o menu da conta (troca de workspace) não aparece (`hidden sm:flex`): etapa de UX. (3) Ao trocar de workspace, os Relatórios recarregam e desmontam o chat; uma resposta pendente é descartada mesmo ao voltar ao mesmo workspace (igual à base; o crédito já pode ter sido consumido). (4) A tabela do §15 tinha uma linha em branco antes do registro do gate da P4, que quebrava a renderização dessa linha; corrigida neste registro.

**Riscos.** Gravação de duas abas da mesma conta no mesmo workspace: a última vence (mesmo dono, sem vazamento). A janela da troca de conta sem logout ainda mostra a interface da conta anterior até a leitura do perfil da nova (comportamento anterior); o histórico local já está apagado e bloqueado nesse intervalo.

**Rollback.** Reverter o diff da P5-A sobre `f0c172b` (módulos `aiChatStorage`/`aiChatSession`, hook, componente, `sessionCleanup`, `AuthContext`, `WorkspaceContext`, testes, E2E, evidência, documentação e a devDependency `react-test-renderer`). Sem dados reais nem migração; históricos locais no formato novo seriam ignorados pelo código anterior.

**Estado.** P5-A implementada — aguardando auditoria independente. P5-B…P5-F e o gate da P5 não iniciados.

### 20.2 P5-D1 — infraestrutura de notificações: estado privado, Rules, paginação e fim do polling (2026-10-08)

Sobre `f0c172b` + P5-A (árvore auditada `4b0addab`), sem commit. Escopo autorizado: só a correção da infraestrutura existente de notificações (parte de PR-NOTIF-01). Fora do escopo, por decisão expressa do usuário: TTL/retenção (D-18 segue pendente), exclusão LGPD, novos produtores, e-mail/push, preferências por destinatário, contagem exata (P5-D2), P5-B, P5-C, P5-E e P5-F.

**Problemas confirmados (base).** (1) `read` único no evento compartilhado: um membro marcava como lida para todos (NOTIF-02); (2) "arquivar" era `deleteDoc` do evento (owner/admin) — exclusão física para todos (NOTIF-03); (3) leitura da coleção inteira sem `limit` e erro convertido em lista vazia; (4) polling de 30 s da coleção inteira num Header sempre montado. Além disso: `createNotification` morto no cliente e componente `NotificationBell.tsx` sem uso.

**Arquitetura entregue.**
- Evento `workspaces/{ws}/notifications/{id}`: backend-owned. Rules: `get` por membro ativo; `list` por membro ativo com `request.query.limit <= 50`; `create, update, delete: if false` para todo papel. `notifications` e `notification_user_states` entraram em `isBackendOwnedCollection` (a catch-all não reabre nada). O produtor de cartões (`functions/src/cards/closing.ts`) deixou de gravar `read`; IDs determinísticos, dedupe, textos pt-BR e contexto do workspace preservados.
- Estado privado `workspaces/{ws}/notification_user_states/{uid}/items/{notificationId}`: um documento por (usuário, notificação), nunca um mapa. Só `read`/`readAt` e `dismissed`/`dismissedAt`. Rules: só o dono (`request.auth.uid == stateOwner`) e membro ativo (perfil ativo + membership ativo); `list` com `limit <= 50`; criação só para notificação existente e em workspace ativo; chaves exatas; cada marca nasce `true` com carimbo `request.time` e depois não muda nem some; `delete: false`; documento intermediário `notification_user_states/{uid}` fechado (`read, write: if false`). Viewer marca o próprio estado (dado não financeiro do próprio usuário); removido, suspenso, outro uid, outro workspace e sem autenticação não alcançam nada.
- Cliente: `src/modules/notifications/model.ts` (regras puras: escopo, chave de cache, forma do evento e do estado, página, contagem, mensagens), `feed.ts` (React Query sem Firebase: `useInfiniteQuery` por `['notifications', workspaceId, uid]`, sem `refetchInterval` e sem listener, `staleTime` de 1 min, releitura ao abrir o painel e ao voltar o foco só com dado vencido, fechar o painel volta à primeira página, sem novas tentativas em `permission-denied`), `api.ts` (página de 25 com `limit 26`, cursor `createdAt desc, __name__ desc`, estado dos itens da página numa consulta `in`; marcar/arquivar em transação que relê o estado e não regrava marca existente, em lotes de 10) e `hooks.ts` (escopo = uid do Firebase Auth + workspace carregado para esse uid). Ações presas ao escopo do clique: o resultado confirmado entra só no cache desse escopo; erro de ação só aparece no próprio escopo; falha relê só esse escopo.
- Interface (mudanças mínimas, requeridas pelo contrato): "Marcar todas lidas" → "Marcar exibidas como lidas" (marca só as não lidas exibidas; desabilitado durante a marcação); "Carregar mais"; carregando, erro com "Tentar novamente" (permissão negada não vira "nenhuma notificação"), "nada para exibir entre as mais recentes" quando a primeira página foi toda arquivada; aviso de falha de ação; nomes acessíveis "Fechar notificações" e "Arquivar para mim: <título>"; arquivar visível também ao foco do teclado. Contagem: não lidas entre as carregadas; com mais páginas, "N+" no sino e no contador e "entre as mais recentes" no nome acessível — nunca apresentada como total. Contagem exata: projeção no servidor (P5-D2).
- Removidos: `createNotification`/`useCreateNotification` e o uso em `App.tsx`, `deleteNotification` e os hooks de compatibilidade, `NotificationBell.tsx`, o polling de 30 s, a Rule de update de `read` e a de delete. Nenhum dado migrado (sem dados reais; dados de teste recriados por seed).

**Custo** (estimativas; leituras das Rules contadas como leituras faturadas; P = 25):
- montagem do Header (por escopo): 1 consulta de eventos (≤ 26 documentos, mínimo 1) + 1 consulta de estados (≤ 25, mínimo 1) + 2 leituras das Rules em cada → ≤ 55 leituras, 0 escrita;
- abrir o painel: 0 com dado de menos de 1 min; senão, igual à montagem (uma página só);
- "Carregar mais": ≤ 55 leituras por página;
- marcar uma: 1 leitura do estado (+2 das Rules) e 1 escrita (+6 acessos das Rules: 5 fixos + a notificação) ≈ 9 leituras e 1 escrita; já lida em outra aba: ≈ 3 leituras, 0 escrita;
- "Marcar exibidas como lidas" com U não lidas: ⌈U/10⌉ transações, ≈ 4U + 5 leituras e U escritas por lote (U = 25: 3 lotes, ≈ 115 leituras e 25 escritas);
- arquivar: ≈ 9 leituras e 1 escrita;
- várias abas: cada aba tem o seu cache e custa a sua montagem; sem polling nem listener; foco relê só a aba focada e só com dado vencido.
- Comparação: antes, cada aba aberta relia a coleção inteira a cada 30 s (N leituras por ciclo; com N = 500, ~60 mil leituras por hora por aba).
- Teto de acesso das Rules por lote: medido no Emulator, 15 criações passam e 16 são negadas (5 acessos fixos + 1 por criação, teto de 20); o cliente usa lotes de 10.

**Testes.** Novos: `tests/unit/notifications-model.test.ts` (13: escopo, chave por workspace e uid, evento do produtor sem estado, estado ignorado no evento, página com sonda e cursor, documento inválido sem perder o cursor, visíveis sem arquivadas, contagem que não se apresenta como total, aplicação só nos alvos, volta à primeira página, lotes, mensagens pt-BR); `tests/unit/notifications-feed.test.ts` (12, hooks React reais com React Query: primeira página por escopo, dois usuários independentes, dois workspaces independentes, marcar de novo sem escrita, arquivar persistente em nova sessão, troca de workspace durante a marcação, erro de ação só no próprio escopo, permissão negada como erro e sem repetição, mais de 50 com carregar mais, três no mesmo instante no corte da página, sem polling, ação confirmada sem releitura); `tests/unit/notifications-guard.test.ts` (8 guardas estáticas); `tests/firestore/notifications-p5d1.rules.integration.test.mjs` (24 no Emulator: os 18 cenários pedidos e mais suspenso, arquivado, notificação inexistente, lote do cliente e teto medido, listagem do próprio estado com teto, sem autenticação); `e2e/notifications-private-state.spec.ts` (3: dois usuários reais com 55 notificações, empate no corte, arquivar persistente na recarga e no logout/login; troca de workspace com commit retido e sem releitura automática com relógio avançado 5 min; percurso só pelo teclado). Atualizados: `m4-hardening` (marcação em workspace arquivado pelo estado privado; evento fechado) e `cardsInvoices.integration.test.ts` (alertas sem `read`, ID determinístico, estado do usuário preservado na nova rodada).

**Mutações** (cada uma aplicada, a suíte rodada e o arquivo restaurado e conferido por hash; rodada final no estado entregue): **Rules 15/15 mortas** pela suíte `notifications-p5d1` + `m4-hardening` no Emulator — listagem do evento sem teto; `update` de `read` no evento; delete por owner/admin; `notifications` fora de `isBackendOwnedCollection`; `notification_user_states` fora da lista; estado sem conferir o uid; estado sem membership ativo; campos extras; carimbo do cliente; marca gravada mutável; delete do estado; estado de notificação inexistente; marcação em workspace arquivado; listagem do estado sem teto; documento intermediário legível. **Frontend 16/16 mortas** pelos unitários (modelo, hooks, guardas) — chave de cache sem uid; polling de 30 s; erro de leitura como lista vazia; novas tentativas em `permission-denied`; ação que relê todos os escopos; erro de ação exibido em outro escopo; cursor na sonda (pula um); arquivada visível; contagem da página como total; transação que regrava marca; escopo sem o dono do workspace carregado; consulta de estados sem limite; consulta sem desempate por ID; fechar o painel sem voltar à primeira página; produtor gravando `read`; lote acima do teto de acesso.

**Evidência visual** (`docs/production/evidence/p5d1/`): mesmo roteiro na base (P5-A) e na P5-D1, desktop e celular, claro e escuro: vazio, com notificações, depois de arquivar e 30 notificações (topo e fim; na P5-D1 também depois de "Carregar mais"). Diferenças só no painel: o texto da ação (0,04–0,05% da tela) e a paginação (contador "25+" e "Carregar mais"). axe no Header com o painel aberto: 1 violação (`button-name`, o "X" sem nome) → 0; rolagem horizontal 0.

**Validação.** `verify:all` integral depois da última mudança de código (2026-10-08 22:53:14Z → 23:16:50Z, rc 0): typecheck, lint das Functions, builds; Functions unit 443; frontend unit 587 (554 + 33 novos); integração no Emulator 609; tools 17; Rules 168 em 16 suítes (144 + 24 da nova `test:rules:notifications`, registrada em `test:integration:emulator` e `predeploy:rules`); E2E 108 (105 + 3). Total 1.932, 0 falha, 0 skip. Testes da P5-A incluídos e verdes (chat de IA 35, limpeza de sessão em `test:unit:p1`, `e2e/ai-chat-isolation.spec.ts`). CI: passo `npm run test:unit:notifications` acrescentado em `.github/workflows/quality-gate.yml`; a suíte de Rules entra pela `test:integration:emulator`, que o CI já roda. `git diff --check` limpo.

**Revisões.** `multi-tenant-security-review` **PASS**; `privacy-lgpd-data-lifecycle` **PASS** no escopo (inventário, minimização, isolamento; retenção, eliminação e exportação ficam em D-18/P8, excluídas desta etapa); `ptbr-product-ui-review` **PASS**; `firestore-scale-cost-review` **FAIL por um único item**: retenção — `notifications` segue sem TTL e `notification_user_states` nasce sem TTL, porque o prazo depende da D-18, pendente e excluída desta etapa por decisão expressa do usuário (o mesmo item que a §19.1 já atribuíra à P5); todos os demais itens passam. Por isso o `regression-release-gate` não emite PASS para a P5-D1: todas as execuções obrigatórias estão verdes, mas a skill de custo exigida pela superfície está em FAIL nesse item. O gate da P5 depende da D-18.

**Fechado na P5-D1 (aguardando auditoria independente):** NOTIF-02 (leitura compartilhada), NOTIF-03 (arquivar = exclusão), NOTIF-05 (sem testes de Rules), leitura não limitada e polling (C17). **PR-NOTIF-01 continua aberto**: TTL/retenção de `notifications` e de `notification_user_states` (D-18), contagem exata por projeção (P5-D2), produtores de metas, recorrentes e divisão, NOTIF-04.

**Pendências registradas para a P5-D2 e depois.** Projeção de contagem exata de não lidas por usuário (o badge hoje é "entre as mais recentes"); TTL do evento e do estado com o mesmo prazo (D-18); eliminação do estado na exclusão de conta (P8); avaliar `createdAt` como `Timestamp` de servidor no produtor (hoje string ISO do relógio da Function).

**Outros achados (registrados, sem ampliar o escopo).** (1) No celular (390 px), o painel abre parcialmente fora da tela, à esquerda (`absolute right-0` relativo ao sino), igual na base; corrigir exige mudar o layout. (2) Os itens do painel não são focáveis pelo teclado (marcar como lida ao abrir um aviso só pelo mouse; "Marcar exibidas como lidas" cobre o teclado); Escape não fecha o painel — ambos anteriores. (3) Classes `hover:text-error` sem a cor `error` no tema (sem efeito), anteriores. (4) `test:unit:settings-catalog` (P4-E) e `test:unit:ai-chat` (P5-A) rodam no `verify:fast`, mas não têm passo no CI (`quality-gate.yml`); não alterados aqui para não mexer em escopos já aprovados.

**Riscos.** Contagem parcial: com mais de 25 notificações recentes, não lidas mais antigas não aparecem no sino até "Carregar mais" (declarado no nome acessível, "entre as mais recentes"). Arquivar todas as da primeira página deixa o painel com "nada para exibir" e "Carregar mais". Lote de marcação parcial (falha no 2º lote) relê o escopo e mostra o erro; repetir é idempotente.

**Rollback.** Reverter o diff da P5-D1 sobre a árvore da P5-A (Rules, produtor de cartões, módulo `src/modules/notifications/`, Header, painel, `App.tsx`, `src/types.ts`, testes, E2E, evidência e documentação) e restaurar `NotificationBell.tsx`. Estados privados gravados ficariam órfãos e sem leitor (sem dados reais).

**Estado.** P5-D1 implementada — aguardando auditoria independente. P5-B, P5-C, P5-D2, P5-E, P5-F e o gate da P5 não iniciados.

### 20.3 P5-B — consolidação definitiva do domínio de Metas (2026-10-09)

Sobre `f0c172b` + P5-A + P5-D1 (árvore auditada `c2a8bd30`), sem commit. Escopo autorizado: só P5-B — PR-GOAL-01…PR-GOAL-04 conforme as decisões D-31 aprovadas (§9.4). D-37 aprovada só em parte (regime de caixa realizado, backend como fonte, nomes dos indicadores); fórmulas, limiares, competência, redução de custos e compras no cartão seguem pendentes (§10). Fora do escopo: caixa, cartões, recorrentes, divisão, empréstimos, recebíveis, IA, chat da P5-A, notificações da P5-D1, billing, planos, créditos, quotas, landing, P5-C/D2/E/F e REQ-FUT-01.

**Problemas confirmados (base).** (1) `progressBasis current_value` com duas semânticas, opção da UI sempre recusada e troca de base sem recálculo (PR-GOAL-01); (2) `listGoals` filtrando `archived == false` (campo nunca gravado), consulta legada e teto de 100 (PR-GOAL-02); (3) indicadores PJ calculados no navegador, em float, com datas locais × UTC, semestral caindo no personalizado, janela truncada e "lucro" contábil (PR-GOAL-03); (4) arquivar ignorava posições vinculadas e forçava `cancelada`, investimentos aceitavam meta arquivada e os botões de status não persistiam (PR-GOAL-04); (5) formulário descartava o "valor atual" (`currentAmount`) e convertia por `parseFloat`; contadores calculados da página e misturando "atingiu o alvo" com status.

**Arquitetura entregue.**
- Uma fonte por meta, explícita (`progressSource`): `manual` (`manualProgressCents`, informado e auditado), `investment` (`investmentProgressCents`, publicado pelo domínio patrimonial na base `progressBasis`) ou `business_kpi` (calculado no servidor, nada persistido). Sem fallback entre fontes; documento fora do contrato é descartado na leitura.
- Contrato (`functions/src/goals/contracts.ts`): Zod estrito, centavos inteiros seguros (teto R$ 100 bi), margem em pontos-base (1..10.000), datas civis `AAAA-MM-DD` reais (impossíveis recusadas), regras por fonte (manual sem base/indicador/período; investimentos com base; PJ com indicador e período, saldo sem período, margem só em pontos-base).
- Operações (`functions/src/goals/operations.ts`), todas em transação com papel relido, idempotência por ator+operação (replay devolve o mesmo resultado; dados diferentes → conflito) e trilha `goal_audit_logs` (`transaction.create`, ID = reserva): `createGoal` (`archived: false`, `revision: 1`, `priorityRank`); `updateGoal` (revisão esperada; não toca status nem valor manual; troca de fonte sem reaproveitar nem somar progresso, auditada com `progressSourceFrom/To` e `discardedManualProgressCents`; sair de investimentos recusado com posição vinculada; mudar a base recalcula na mesma transação); `updateGoalManualProgress` (só manual; antes/depois na trilha; nenhum lançamento, conta, investimento ou quota); `setGoalStatus` (patch só do status, não incrementa a revisão, para não invalidar uma edição aberta); `archiveGoal` (lógico, com `archivedAt/By/Reason`, preserva o status, recusado com posição vinculada).
- Investimentos (`functions/src/investments/operationsV2.ts`, mudança mínima): `assertGoalAcceptsInvestmentLink` recusa, dentro da transação, meta arquivada e meta não patrimonial em vínculo, troca para a meta de destino, aporte com meta (pendente e liquidado) e liquidação que nomeia meta; desvincular continua livre. `updateGoalProjection(..., linkChanged)` escreve a meta mesmo com deltas zerados quando o conjunto de posições muda — vínculo e arquivamento disputam o mesmo documento (serialização provada por teste de posição zerada e por corrida com 4 concorrentes). Posições e movimentos nunca são apagados. Aporte pendente que nomeia uma meta não impede o arquivamento; a liquidação é então recusada e o pendente pode ser cancelado.
- Indicadores PJ (`functions/src/goals/kpi.ts`, `getGoalKpiProgress`, até 25 metas): regime de caixa realizado sobre `cash_report_periods/{AAAA-MM}` (`incomeCents`/`expenseCents`, que já excluem pendentes, principal de empréstimo, juros, pagamento de fatura e investimentos; recebimento entra uma vez pelo espelho do recebível) e soma de `cash_accounts.balanceCents`. "Recebimentos operacionais realizados", "Resultado operacional de caixa", "Margem operacional de caixa" (BigInt, meio-para-longe-do-zero; sem recebimentos → indisponível), "Saldo disponível em contas" (saldo atual, não fluxo) e "Limite de despesas operacionais" (consumo do limite; no prazo, cumprida = dentro do limite). Mensal, trimestral, semestral e anual no calendário civil de São Paulo; personalizado só com meses inteiros (até 36), senão indisponível com mensagem pt-BR — a necessidade de dados diários fica registrada. Compras no cartão de crédito não entram (dependência da D-37; nota na interface). Indisponível, por meta e com motivo em pt-BR: projeção de caixa marcada para reconstrução (`needsRebuild`), página acima de 60 meses distintos (só as metas excedentes), margem fora do intervalo calculável, sem recebimentos (margem) ou sem contas (saldo).
- Leitura: `getGoalsOverview` (contagem exata no servidor, total e por status); lista por cursor (`priorityRank desc, createdAt desc, __name__ desc`, 25 + sonda); seletor e nomes de metas de investimento (`progressSource == investment`, páginas de 25 por cursor até 100 — a mesma capacidade da base, ordem alfabética); histórico do valor manual (owner/admin, até 20).
- Rules: `goals` com `get` por membro ativo e `list` com `limit <= 26`, escrita negada; `goals` entrou em `isBackendOwnedCollection` (sem isso a catch-all neutralizava o teto); `goal_audit_logs` só owner/admin em workspace ativo, `limit <= 20`; `goal_idempotency_keys` fechada. Índices: os 3 de `goals` (lista, seletor, contagem por status) e o de `goal_audit_logs` (histórico). Retenção: a reserva `goal_idempotency_keys` grava `expiresAt` de 90 dias (`RETENTION_DAYS.idempotencyKeys`) e o TTL está declarado em `fieldOverrides` (13 grupos versionados; GOAL-14 parcial); a trilha e a meta não expiram (prazo da trilha na D-18).
- RBAC: owner, admin e member gerenciam; viewer só lê (lista, contagem e indicadores). Workspace arquivado: metas legíveis pelas Rules; as callables de leitura seguem a regra do kernel e recusam (limitação registrada).
- Interface (mudanças mínimas, requeridas pelo contrato): botões de status persistem (sem atualização otimista; confete só após sucesso); meta manual com "Atualizar valor acumulado" e histórico para owner/admin; formulário com "Informado por mim" e "Valor já acumulado (R$)" (corrige o defeito do valor descartado), valores digitados como texto pt-BR e convertidos por dígitos; contadores do servidor; "Carregar mais metas"; selo "ALVO ATINGIDO" separado de "CONCLUÍDA"; rótulos e nota de regime de caixa nos indicadores PJ; erro de arquivamento com investimentos vinculados mostrado em pt-BR com o caminho de desvincular/transferir; meta PJ de investimentos ganhou o bloco de vínculo (único caminho para desvincular antes de arquivar). Os cartões mantêm reais inteiros.
- Removidos: `src/modules/goals/logic.ts`, `src/modules/goals/projection.ts`, `toMinorUnits`, floats e os campos `targetAmount`, `currentAmount`, `currentAmountCents`, `currentValue`, `currentValueCents`, `netContributionCents`, `isAutomatic`, `startDateTimestamp`, `deadlineTimestamp` e `profileId` da meta; consulta legada sem `archived`; leitura de transações e de projeções de caixa no cliente para metas. Nada migrado (sem dados reais; testes semeiam o formato novo).

**Custo** (estimativas; leituras das Rules contadas como leituras faturadas; página P = 25; kernel = perfil, workspace e membership, 3 leituras):
- abrir Metas: página da lista ≤ 26 documentos + ~3 das Rules; `getGoalsOverview` = 5 agregações `count` (1 leitura por até 1.000 entradas de índice cada) + 3 do kernel; indicadores PJ da página = até 25 metas (`getAll`) + estado da projeção + até 60 meses distintos (tipicamente 1–12) + 1 agregação `sum` das contas (só se houver meta de saldo) + 3 do kernel. Total típico ≤ ~75 leituras, 0 escrita, independente do número total de metas;
- "Carregar mais metas": ≤ 29 leituras por página; com mais de 100 metas o custo por página não cresce (cursor por valores, sem offset);
- criar, editar, valor manual, status e arquivar: 1 transação = 3 do kernel + 1 da reserva de idempotência (+1 da meta nas edições; +1 consulta limitada a 1 posição ao arquivar ou sair de investimentos) e 3 escritas (meta, reserva, trilha); replay = 4 leituras, 0 escrita;
- vínculo/desvínculo/troca/primeira liquidação vinculada: +1 escrita na meta mesmo com deltas zero (serialização); demais operações patrimoniais inalteradas;
- histórico manual (owner/admin): ≤ 20 documentos; seletor e nomes de metas de investimento: até 4 páginas de 26 (≤ 104 leituras) uma vez por sessão de tela, com cache do React Query; sem listener nem polling em nenhuma leitura de metas.
- Comparação: antes, a lista lia até 100 metas (mais uma consulta legada) e o indicador PJ somava no navegador as transações carregadas (até 12 meses) a cada renderização.

**Testes.** Novos:
- `functions/src/goals/__tests__/goalsP5b.integration.test.ts` (28 no Emulator, com efeito real nos documentos, na trilha, nas posições e nas projeções): criação manual; valores inválidos sem escrita; progresso manual com revisão e trilha antes/depois, sem lançamento, saldo ou quota alterados; duas atualizações na mesma revisão; meta não manual recusa valor informado; edição; trocas manual ↔ investimentos ↔ indicador PJ sem aproveitar progresso; projeção patrimonial não zerada bloqueando a troca; indicador e centro de custo só em PJ; as duas bases patrimoniais e a troca recalculada; vínculo, troca e aporte recusando meta manual; vínculo de posição zerada escrevendo a meta; status persistido e auditado; status × edição; arquivar sem vínculo, com vínculo, depois de desvincular e depois de transferir; meta arquivada recusando vínculo, transferência, aporte e liquidação; corrida de 4 concorrentes; idempotência (replay, conflito, mesma chave em outra operação, `expiresAt` ~90 dias); RBAC; isolamento; workspace arquivado e rebaixamento; mais de 100 metas; indicadores PJ de ponta a ponta com empréstimo, juros, pendente, recebível e aporte reais; períodos civis, fronteira do mês, margem sem receita, orçamento de meses e `needsRebuild`.
- `functions/src/goals/__tests__/kpi.test.ts` (8) e `integrity.test.ts` reescrito (1 → 7): janela civil de São Paulo, personalizado, margem BigInt, soma exata, componentes por tipo, contrato estrito, uma fonte por meta, valor manual na criação, TTL da reserva.
- `tests/firestore/goals-p5b.rules.integration.test.mjs` (15 no Emulator): leitura por papel (4), cursor com teto, sem limite/acima de 26, não membro e IDs parecidos, removido e suspenso, anônimo, escrita direta (meta e progresso) negada a todos, trilha owner/admin ≤ 20, chaves de idempotência fechadas, workspace arquivado, rebaixamento admin → viewer, catch-all e collection group.
- `tests/unit/goals-model.test.ts` (40) e `tests/unit/goals-guard.test.ts` (8), no novo `test:unit:goals` (em `verify:fast` e no CI).
- `e2e/goals-p5b.spec.ts` (13): manual PF, edição, status com recarga, alvo atingido ≠ concluída, arquivar, vínculo bloqueando e desvínculo liberando, paginação, PJ (faturamento e margem indisponível), troca PF/PJ, viewer, estado vazio, formulário desatualizado.
- Atualizados: `goalIntegrity`, `goalOperationalSurface`, `simpleMode` e `investmentCash` (formato novo; "Meta não encontrada."), `tests/unit/investment-reporting.test.ts`, `goals.rules` (agora com a nova suíte em `test:rules:goals`), E2E `goal-contributions`, `goal-investments` e `regression-smoke` (semeadura no formato novo).

Os 32 cenários obrigatórios estão todos cobertos: 1–7, 10–13, 16, 18–23 e 25 na integração e no contrato; 8–9 nas duas bases e na troca; 14–15 e 17 na recusa e na corrida com meta arquivada; 24 em `kpi.test.ts`, `goals-model` e na integração PJ; 26–30 na integração PJ e em `kpi.test.ts`; 31 em "mais de 100 metas" (contagem exata por status sob paginação) e no E2E de paginação; 32 nas suítes de investimentos sem regressão (unitários 187, `simpleMode`, `investmentCash`, Rules e E2E de investimentos verdes).

**Validação.** `verify:all` integral depois da última mudança de código (2026-10-09 12:41:43Z → 13:08:44Z, rc 0): typecheck, lint das Functions (0 erro; 201 avisos, abaixo dos 204 da P5-D1), builds; Functions unit 457 (443 + 14); frontend unit 635 (587 + 48); integração no Emulator 637 (609 + 28); tools 17; Rules 183 em 16 suítes (168 + 15); E2E 121 (108 + 13). Total 2.050, 0 falha, 0 skip. Testes da P5-A e da P5-D1 incluídos e verdes. CI: passo `npm run test:unit:goals` em `.github/workflows/quality-gate.yml`; a integração e as Rules entram pela `test:integration:emulator`, que o CI já roda. `git diff --check` limpo. Ajustes depois da rodada anterior, todos sem efeito funcional: `'goals'` reposicionado na lista `isBackendOwnedCollection` (a guarda da P5-D1 fixa as notificações no fim), espaços finais removidos em linhas tocadas e quebra de linhas longas nos testes novos (títulos idênticos).

**Mutações** (cada uma aplicada, a suíte rodada e o arquivo restaurado e conferido por SHA-256; script `mutate-p5b.py` fora do repositório; mutante que não compila conta como inconclusivo, nunca como morto). Rodadas anteriores: preliminar 21/24 (2 inconclusivas por símbolo sem uso, reescritas; F03 sobreviveu e virou teste) e 28/28 às 11:55 — mas a reserva de idempotência ganhou o TTL às 12:04, então a rodada que vale é a seguinte. **Rodada final, depois da última alteração funcional e sobre a árvore validada pelo `verify:all`: 30/30 mortas (2026-10-09 13:09:12Z → 13:41:06Z)**, os 7 arquivos mutados restaurados com o mesmo SHA-256 da árvore validada:
- backend (integração e unitários das metas no Emulator), 22: criação sem `archived: false`; arquivar ignorando posição vinculada; valor manual sem revisão esperada; arquivar forçando `cancelada`; status incrementando a revisão; troca de base recalculando com a base antiga; saída do manual mantendo o valor manual; investimentos aceitando meta arquivada; investimentos aceitando meta não patrimonial; vínculo sem valor sem escrever a meta; margem com denominador não positivo; semestre com limite errado; dia civil em UTC; recebimentos somando principal de empréstimo; faturamento virando resultado; viewer mudando status; orçamento de meses ignorado; projeção em reconstrução ignorada; margem fora do intervalo aceita; saída de investimentos mantendo metadados patrimoniais; reserva de idempotência com prazo errado; TTL de `goal_idempotency_keys` desligado nos índices;
- Rules (`test:rules:goals` no Emulator), 5: lista de metas sem teto; `goals` fora de `isBackendOwnedCollection` (catch-all reabre); trilha legível por qualquer membro; trilha sem teto; owner/admin escrevendo meta direto;
- frontend (`test:unit:goals`), 3: investimento recuando para valor manual/alvo; reais aceitando fração de centavo; limite de despesas no prazo usando "atingido".

**Evidência visual** (`docs/production/evidence/p5b/`, build E2E contra o Emulator, mesmo roteiro e mesmos valores na base e na P5-B): 28 capturas da base e 32 da P5-B — vazio, lista, detalhe, formulário, paginação (topo, fim e, só na P5-B, depois de "Carregar mais metas") e indicadores PJ, em desktop 1440×900 e celular 390×844, claro e escuro. Layout, cores, ícones, cartões, formulário e estados vazios iguais; diferenças só as exigidas pelo contrato (contadores do servidor, selo "ALVO ATINGIDO" separado de "CONCLUÍDA", datas civis sem o dia a menos da base, percentual pt-BR, rótulos D-37, 25 metas + "Carregar mais metas"); `diferencas-pixels.txt` por captura. Rolagem horizontal 0 nas duas árvores; axe-core: formulário de 17 violações para 0, detalhe sem `button-name`; as violações de `color-contrast` da paleta existente são as mesmas da base.

**Revisões.**
- Revisão independente do diff (subagente Opus, somente leitura) — achados corrigidos antes do fechamento: MEDIUM — leitura de meses dos indicadores sem orçamento por chamada (agora até 60 meses distintos; excedentes indisponíveis), projeção de caixa em reconstrução tratada como dado válido, seletor de metas de investimento com capacidade menor que a da base (passou a páginas de 25 até 100); LOW — margem sem verificação de faixa, metadados patrimoniais mantidos ao sair de investimentos, IDs reservados do Firestore aceitos, mensagem "Meta não encontrado." na guarda nova. Revisão do frontend: ritmo final do limite de despesas, cartões em reais inteiros, rótulo "Investimento". Revisão documental: linhas desatualizadas em OBSERVABILITY, ARCHITECTURE e FINANCIAL_DOMAIN_MODEL, contagens de TTL (12 → 13) e citações de linha.
- Skills de domínio sobre o estado final: `financial-domain-integrity` PASS; `multi-tenant-security-review` PASS; `ptbr-product-ui-review` PASS; `firestore-scale-cost-review` PASS no escopo da P5-B e FAIL na avaliação cumulativa do working tree por um item herdado da P5-D1 (`notifications`/`notification_user_states` sem TTL, dependente da D-18 — não é regressão da P5-B); `billing-entitlement-integrity` não acionada (nenhum arquivo de billing, planos, entitlements ou quotas no diff; teste de que criar meta manual não altera `quota_state`).
- `regression-release-gate`: validação da P5-B verde (ver Testes), nenhuma regressão nova; **gate global FAIL** pelo débito herdado da D-18 acima. Itens que dependem do usuário: D-37 (restante), D-18 e REQ-FUT-01.

**Riscos e pendências.** D-37 (compras no cartão nos indicadores; fórmulas, limiares e competência dos demais KPIs) e D-18 (prazo de `goal_audit_logs`; GOAL-14 parcial — as chaves de idempotência já expiram por TTL) seguem abertas; publicação do TTL por ambiente (E-07); sem quota de metas (PR-ENT-01) nem rate limit (ENTRY-12); metas de investimento carregadas até 100 na tela de investimentos; período personalizado só com meses inteiros; leituras recusadas em workspace arquivado; busca por nome só entre as metas carregadas (aviso na tela). *(Atualização: o teto de 100 metas de investimento foi removido na P5-B.1, §20.4.)*

**Rollback.** Reverter o diff da P5-B sobre a árvore da P5-D1 (`functions/src/goals/`, a guarda e o `linkChanged` em `operationsV2.ts`, Rules, índices, `src/modules/goals/`, componentes de metas, `App.tsx`, `src/types.ts`, testes, E2E, evidência e documentação) e restaurar `logic.ts` e `projection.ts`. Metas gravadas no formato novo ficariam sem leitor no formato antigo (sem dados reais).

**Estado.** P5-B implementada — aguardando auditoria independente. P5-C, P5-D2, P5-E, P5-F e o gate da P5 não iniciados.

### 20.4 P5-B.1 — complementação de Metas após a auditoria independente (2026-10-09)

Sobre a árvore auditada da P5-B (`bf70a089`, reproduzida com índice Git temporário antes de qualquer alteração), sem commit. Escopo autorizado: só as três inconsistências apontadas pela auditoria. Fora do escopo: P5-C1 e demais subetapas, D-37 (nenhum indicador por centro de custo nem agregado novo), backend de metas e domínio patrimonial (nenhuma mudança necessária), Rules e índices (os existentes servem).

**1. Metas de investimento além da centésima.**
- Causa: `listInvestmentGoalOptions` (`src/modules/goals/api.ts`) acumulava páginas de 25 até `INVESTMENT_GOAL_OPTIONS_MAX = 100` e parava. A 101ª meta ativa de investimento (em ordem de nome) não entrava no seletor do aporte (`SimpleInvestmentForm`, usado pelo "Novo investimento" e pelo modal de lançamento) e não podia ser vinculada; uma posição ligada a ela aparecia como "Meta removida" no filtro e seu valor caía no card "Sem Meta Definida".
- Correção: `listInvestmentGoalOptionsPage` lê **uma** página por chamada (25 + sonda, cursor `name` + ID, `archived == false`, `progressSource == investment` — o mesmo índice e o mesmo teto das Rules); `useInvestmentGoalOptions` virou consulta infinita e expõe `paging` (`hasMore`, `loadMore`, `isLoadingMore`); o seletor mostra "Mostrando N metas; carregue mais para ver as demais." e "Carregar mais metas" só quando há mais páginas. Sem teto fixo e sem carregar tudo: cada página só vem quando o usuário pede. Nomes de metas fora das páginas carregadas são resolvidos por ID (`listActiveInvestmentGoalsByIds`: `documentId in` em lotes de 25 com `limit`, só meta de investimento não arquivada) — apenas os IDs das linhas carregadas, das faixas da alocação (até 10) e da meta já selecionada. A meta escolhida nunca some do seletor (`buildGoalSelectOptions`). Relatórios recebem a mesma lista, mas só a usam na chave de cache (`getFinancialReportSnapshot` não a lê): sem efeito no resultado.
- Custo: abrir o aporte = 1 página (≤ 26 leituras) em vez de até 4 (≤ 104); cada "Carregar mais metas" = ≤ 26; nomes por ID = 1 consulta por lote de 25 IDs efetivamente exibidos e ainda não carregados; sem listener nem polling. Rules: `goals` `list` com `limit <= 26` cobre também a busca por ID (teste novo nega sem limite, acima de 26 e de outro workspace).

**2. Meta manual em PJ.**
- Causa: o contrato do backend aceita `progressSource: manual` em PF e PJ, mas `formProgressSource` (`src/modules/goals/model.ts`) só devolvia `investment` ou `business_kpi` no perfil PJ, e o formulário empresarial não tinha opção manual.
- Correção (só frontend): `formProgressSource` decide "Informado por mim" antes do perfil; o formulário PJ ganhou o objetivo "Valor informado" no mesmo grid dos indicadores, com "Valor já acumulado (R$)" (zero vale) na criação e na troca para manual; a meta manual não envia `businessType`, `progressBasis` nem `period`; o centro de custo segue como metadado. Edição, atualização do valor ("Atualizar valor acumulado" no detalhe PJ, que já existia), troca de modalidade (sem reaproveitar progresso, auditada no backend) e arquivamento usam as callables da P5-B, sem mudança. Progresso manual não cria lançamento, movimento de conta nem aporte (provado na integração e no E2E).

**3. Centro de custo.**
- Causa: `costCenter` é persistido, mas `functions/src/goals/kpi.ts` não o usa — o detalhe mostrava só o nome do centro, sugerindo segmentação.
- Correção (só texto): formulário PJ com "Informativo: não filtra os indicadores automáticos, que usam os valores gerais da empresa."; detalhe com "Centro de custo: <nome>" e, nos indicadores, "O centro de custo é informativo: este indicador usa os valores gerais da empresa, sem filtrar por centro de custo." Indicador por centro de custo continua reservado à D-37/P5-C (guarda estática confirma que `kpi.ts` não lê `costCenter`).

**Testes.** Novos ou ampliados:
- `tests/unit/goals-model.test.ts` (+8): "Valor informado" em PJ cria meta manual sem `businessType`/`progressBasis`/`period`, com centavos e zero aceito; indicador e investimentos seguem disponíveis; edição de meta manual PJ não reenvia valor nem indicador; troca indicador ↔ manual; nota do centro de custo; 210 metas de investimento por cursor alcançam a 101ª, 125ª e 201ª sem teto e sem repetir; sonda e cursor da página; junção de metas por ID.
- `tests/unit/goals-guard.test.ts` (+3): sem `INVESTMENT_GOAL_OPTIONS_MAX` nem laço acumulando páginas, consulta com `startAfter` e `limit(26)`, busca por ID em lotes com `limit` e só metas ativas de investimento, App passando a paginação às duas telas de aporte; formulário PJ com o objetivo manual; centro de custo informativo e `kpi.ts` sem `costCenter`.
- `tests/unit/investment-simple-form.test.ts` (+2) e `investment-simple-summary.test.ts` (+2): meta selecionada fora da página nunca some do seletor; só os IDs não carregados (linhas e alocação) são buscados; card usa o nome resolvido por ID.
- `functions/src/goals/__tests__/goalsP5b.integration.test.ts` (+1, Emulator): meta manual PJ com centro de custo — criar (zero), atualizar valor (trilha antes/depois), editar, trocar para indicador (descarte auditado) e de volta (valor novo obrigatório), pausar e arquivar (escrita recusada depois), sem lançamento, movimento de conta ou posição.
- `tests/firestore/goals-p5b.rules.integration.test.mjs` (+1, Emulator): busca de metas por ID — membro em lotes de 25; sem limite, acima de 26, dono de outro workspace e workspace alheio negados.
- `e2e/goals-investment-options.spec.ts` (novo, 2): com 205 metas de investimento, a 101ª exige quatro "Carregar mais metas", o botão some na última página (206 opções), aportes vinculados à 101ª, 125ª e 201ª gravam movimentos liquidados com o `goalId` certo; depois de recarregar, a meta 150 aparece pelo nome no card da alocação e no filtro, sem "Meta removida".
- `e2e/goals-p5b.spec.ts` (+2): meta manual PJ criada pelo formulário ("Valor informado", centro de custo, valor inicial zero), valor atualizado no detalhe, edição com a modalidade preservada, arquivamento, sem lançamento, movimento ou aporte; detalhe de indicador com a nota do centro de custo informativo.

**Validação.** `verify:all` integral depois da última mudança de código (2026-10-09 16:53:22Z → 17:21:56Z, rc 0): typecheck, lint das Functions (0 erro; 201 avisos, os mesmos da P5-B), builds; Functions unit 457; frontend unit 650 (635 + 15); integração no Emulator 638 (637 + 1); tools 17; Rules 184 em 16 suítes (183 + 1); E2E 125 (121 + 4). Total 2.071, 0 falha, 0 skip. Antes do `verify:all`, as suítes de Metas e Investimentos rodaram direcionadas: os 4 E2E novos falharam na primeira execução por defeito do próprio teste (rótulo "Salvar Meta" do formulário PJ e espera da página pedida no seletor), corrigidos no teste e verdes na reexecução; os 33 E2E existentes de investimentos, metas e regressão, verdes. Scripts e CI: os testes novos entram por `test:unit:goals`/`test:unit:investments` (`verify:fast` e CI), pela integração/Rules da `test:integration:emulator` e pelo `test:e2e`. `git diff --check` limpo.

**Mutações** (cada uma aplicada, a suíte rodada e o arquivo restaurado e conferido por SHA-256; script `mutate-p5b1.py` fora do repositório), depois da última alteração funcional (2026-10-09 16:40:25Z → 16:42:20Z): **12/12 mortas**, 9 arquivos restaurados com o mesmo hash —
- frontend (`test:unit:goals` + `test:unit:investments`), 10: seletor parando na 1ª página; teto de 100 reintroduzido; hook sem próxima página; PJ voltando a ignorar "Valor informado"; meta manual PJ enviando `businessType`; formulário PJ sem o objetivo manual; seletor perdendo a meta selecionada fora da página; nomes por ID ignorando a alocação; busca por ID devolvendo meta arquivada; detalhe sem a nota do centro de custo (M02, M03, M09 e M10 mortos por guardas estáticas; o comportamento de M03 também é coberto pelo E2E);
- Rules (`test:rules:goals` no Emulator), 1: teto da listagem de metas subindo para 30;
- backend (integração no Emulator), 1: contrato aceitando `businessType` em meta manual.

**Evidência visual** (`docs/production/evidence/p5b1/`, mesmo roteiro e mesmos dados na árvore auditada e na P5-B.1, desktop e celular, claro e escuro): 28 capturas antes e 36 depois — lista PJ, formulário PJ (com e sem "Valor informado"), detalhe da meta manual PJ e o painel de atualização, detalhe de indicador com centro de custo, tela de Investimentos e seletor de metas com 130 metas (antes: 101 opções, sem a 101ª; depois: 26 na abertura e 126 após quatro páginas, com a 101ª selecionada). Lista PJ e Investimentos sem diferença (0,00%); as demais diferenças são só as descritas acima. Rolagem horizontal 0; axe do formulário PJ 0 nas duas árvores.

**Revisões.** `financial-domain-integrity` PASS; `multi-tenant-security-review` PASS; `ptbr-product-ui-review` PASS; `firestore-scale-cost-review` PASS no escopo da P5-B.1 e FAIL na avaliação cumulativa pelo item herdado da P5-D1 (TTL de `notifications`/`notification_user_states`, D-18); `billing-entitlement-integrity` não acionada. Revisão adversarial por modelo de maior capacidade não acionada (sem mudança de backend, Rules, autorização ou concorrência; a leitura nova tem teste de Rules nos dois sentidos). `regression-release-gate`: validação técnica da P5-B.1 verde, nenhuma regressão nova; **gate global FAIL** pelo débito herdado da D-18. Subagentes: inventário de consumidores e varredura documental (Haiku); integração das telas de Investimentos (Sonnet, interrompido por limite de sessão da API depois de criar os helpers puros e o repasse inicial — o restante foi concluído e revisado pelo modelo principal).

**Riscos e pendências.** Seletor por "Carregar mais metas" (sem busca por nome no servidor: o nome não tem campo normalizado e criar um seria mudança de schema fora do escopo); quem tem centenas de metas de investimento precisa paginar até a desejada. Pendências anteriores inalteradas: D-37 (restante), D-18 (TTL de notificações e da trilha de metas), PR-ENT-01, ENTRY-12, REQ-FUT-01.

**Rollback.** Reverter o diff da P5-B.1 sobre a árvore `bf70a089` (`src/modules/goals/api.ts`, `hooks.ts`, `model.ts`, `GoalFormModal`, `GoalDetailsView`, `App.tsx`, `TransactionModal`, componentes e helpers de investimentos simples, testes, E2E, evidência e documentação). Nenhum dado gravado muda de formato.

**Estado.** P5-B.1 implementada — aguardando auditoria independente. P5-C1 e as demais subetapas não iniciadas.

### 20.5 P5-C1 — relatórios financeiros e Dashboard autoritativos (2026-10-09 a 2026-10-10)

Sobre `f0c172b` + P5-A + P5-D1 + P5-B + P5-B.1 (árvore de partida `8befe373`, reproduzida com índice Git temporário), sem commit. Escopo autorizado: só a P5-C1, sob a D-37 aprovada integralmente pelo usuário em 2026-10-09 (diretrizes 37.1–37.10, §9.4). Fora do escopo: P5-C2, P5-D2 (PR-RPT-04), P5-E (parte de IA do PR-RPT-03/05), P5-F, PR-TX-03 (só a parte de relatórios avançou), débito de TTL da D-18 e o gate da P5.

**Arquitetura.**
- Callable única `getFinancialReport({workspaceId, range, sections?})` (`functions/src/reports/`): Zod estrito; `range` preset (`7d`, `30d`, `90d`, `12m`, `ytd`, `all`) ou mês `AAAA-MM`; período civil de São Paulo e PF/PJ resolvidos no servidor; papéis owner/admin/member/viewer com papel relido na transação do limite de frequência (300/h por ator e workspace); workspace arquivado e conta suspensa recusados pelo kernel; DTO em centavos inteiros e pontos-base (BigInt, meio-para-longe-do-zero; denominador ≤ 0 → indisponível); metadado de cobertura por bloco (`exact`, `zero`, `unavailable`, `sample`, `truncated`, `rebuild_needed`, `not_requested`). Perfil próprio de runtime (60 s, 1 GiB, até 20 instâncias).
- Projeções: `cash_report_periods` v5 com `days.{DD}` no mesmo `set`, transação e marca de entrega do gatilho (paridade Σ dias = mês conferida na leitura); `cash_category_years/{geração}__{AAAA}__{categoria}` v2 (totais + `days.{MMDD}` com valores e contagens separadas por lado), alimentada pelo gatilho na geração vigente e na preparada; reconstrução v5 com shards diários (TTL 7 dias), página limitada (400 docs, 450 transforms), publicação atômica com tetos de 500 escritas e ~9 MiB, troca de geração no mesmo commit e limpeza das gerações descartadas (até 10 × 400 após a publicação).
- Categoria por ID (D-37.8) em criação, edição, importação e recorrentes; nome é snapshot; fatos de domínio com chave fixa (`sem_categoria`, `dominio_recebiveis`, `dominio_divisao`).
- Investimentos só do domínio de investimentos (D-37.5): fluxos por `investment_report_periods` (`daily` nos meses parciais) para todo membro (matriz das Rules, D-15); patrimônio, evolução e reconciliação só owner/admin/member.
- Frontend: Dashboard e Relatórios leem só o relatório; cache por uid/workspace/papel/faixa/blocos; invalidação após operações financeiras e pelo documento do mês corrente/escolhido (agrupada em 2 s, com orçamento de 40 releituras seguidas e reposição de 1 por minuto — `src/modules/reports/liveRefresh.ts`). Removidos `src/modules/reports/logic.ts`, `investments.ts`, `src/modules/transactions/cashPeriods.ts`, leitores de histórico completo, helpers de janela do navegador e a fórmula de caixa do navegador (`summarizeCashFlow` e 11 helpers).

**Revisão independente (modelo de maior capacidade, somente leitura) e correções.** 1 BLOCKER, 2 HIGH, 8 MEDIUM e 10 LOW — corrigidos: teste 26 desatualizado (B1); "tudo" começando só no caixa e zerando compras de cartão (H1 — início pelo mês mais antigo de caixa, compras e investimentos; teste 11b); custo do Dashboard e ranking PJ lido sem necessidade (H2 — widget só com `cash`/`kpis`/`alerts`, ranking só com `debts` pedido em PJ; tabela de custo refeita); contagem de categoria nos dois lados (M1 — projeção v2 com contagens separadas); leitura não simultânea de caixa e categorias (M2 — releitura única antes de `rebuild_needed`); evolução patrimonial ao viewer (M3 — `null`); listener só do mês corrente e sem agrupamento (M4/M5); motivo errado da taxa de aportes (M6 — `netContributionRateReason`); utilização calculada no cliente (M7 — `limits.utilizationBasisPoints` no servidor); memória da callable (M8 — perfil de 1 GiB; capacidade real na P6); mensagens de erro (L1), comentários e ramos mortos (L2, status `forbidden` removido), divergência falsa na simulação (L3), limpeza pós-publicação (L4), amostra exata de 500 (L9). Não corrigidos e registrados: L5 (atraso de empréstimo pelo status do job), L6 (leituras de "tudo" sem caixa pedido), L7 (rótulos de período existentes), L8 (cor do gráfico por nome, apresentação), L10 (card "Saldo Atual" no Dashboard PJ, nome da D-37.1).

**Testes.** Backend: relatório no Emulator 34 (`financialReport.integration`: 01–23, 11b, 20b; `financialReportAccess.integration`: 24, 24b, 25, 25b, 26–30 — saldo, pendente e confirmação, anulação e correção, troca de dia/mês/ano/categoria, renomear categoria, bordas exatas de 7/30/90 dias, 12 meses/ano/mês, mês futuro, "tudo" multidomínio, cartão nas duas visões, fatura vencida, empréstimo, recebível, transferência, reconciliação, PJ, Metas PJ × relatório, reconstrução pendente, paridade dias × mês e categorias × caixa, base insuficiente, réplica, concorrência, investimentos com rendimento e perda realizados, viewer, papel e isolamento A↔B pela callable, workspace arquivado, limite de frequência, reconstrução v5 com e sem escrita depois do corte); categoria por ID 15 (`categoryLink.integration`); unitários de janela e fórmulas 12, projeção diária 10 e espelhos de caixa 6 (substituem os testes das fórmulas removidas do navegador). Rules: 12 cenários (`reports-p5c1.rules`, A↔B nos dois sentidos, removido, suspenso, arquivado, anônimo, consulta de grupo, documentos intactos). Frontend: adaptador 18, faixas/cache/callable 6, agendador de releitura 6, fuso 1 novo. E2E: 10 em `financial-reports.spec.ts` (PF e PJ, todos os filtros, troca de workspace e de usuário, zero verdadeiro sem painel patrimonial, reconstrução, viewer, falha técnica, atualização sem recarregar, celular).

**Validação.** `verify:all` **PASS** sobre a árvore final (`8c09ec97`, índice temporário), 2026-10-10T17:18:32Z–17:50:59Z: typecheck do frontend e das Functions; lint das Functions 0 erro e 201 avisos (os mesmos da base; os 3 introduzidos foram corrigidos); build do frontend e das Functions; Functions unitários 490; frontend unitários 663; integração das Functions no Emulator 687; ferramentas 17; Rules 196 em 17 suítes (inclui `test:rules:reports`, 12); E2E 135 — 2.188 testes, 0 falha, 0 skip. Rodada pré-final (15:59:27Z–16:32:01Z) também verde; depois dela só entraram testes mais fortes (24b, A → B), a ocultação do painel patrimonial em zero verdadeiro, a remoção de uma nota, comentários e documentação. `git diff --check` limpo. Projeto do Emulator `minhas-financas-local`; nenhum acesso a produção.

**Mutações.** 35 mutantes sobre o código final (2026-10-10T16:59:29Z–17:17:58Z, cópia isolada; repositório conferido por SHA-256 antes e depois): 34 mortos, todos por asserção específica (unitários do backend 10, frontend 9, integração no Emulator 13, Rules 2), 0 inválido; sobrevive I07 (releitura do ator na transação do limite de frequência: a diferença só aparece numa janela de corrida não reproduzível sem mocks; a releitura é a mesma do kernel). Mais 6 mutantes do agendador de releitura (`liveRefresh.ts`), todos mortos. Nenhum mutante deixou de compilar.

**Evidência visual.** `docs/production/evidence/p5c1/` (`LEIAME.md`, `diferencas-pixels.txt`, `antes-relatorio.json`, `depois-relatorio.json`): 34 capturas por árvore, PF e PJ, desktop e celular, claro e escuro, mesmo roteiro e dados na P5-B.1 e na P5-C1. Dashboard 0,17–0,65% (Saldo Atual = Σ contas com legenda "Em contas", "Faturas de cartão", rótulos do widget); Relatórios 3–15% (rótulos D-37.4, tabela e gráfico só com os meses da janela, marcados como parciais, "—" na utilização sem limite, sem "Grau de Endividamento" por limiar inventado, "Leitura dos indicadores"); Visão Geral PF no celular 0,00%. Rolagem horizontal 0 nas 32 capturas das duas árvores; axe sem violação nova; sequência de teclado idêntica antes e depois. Na própria rodada, a captura revelou dois ajustes, ambos feitos: o painel "Patrimônio de investimentos" volta a ficar oculto sem investimento (zero verdadeiro, como na base) e o card "Investimentos" perde uma nota que a base não tinha.

**Custo.** `docs/production/evidence/p5c1/CUSTO.md`: Dashboard ≈ 71 leituras por carga (duas chamadas); Relatórios PF 30 dias ≈ 87, 12 meses ≈ 132, todo o período (5 anos) ≈ 299; PJ + amostra de até 501 recebíveis; releitura ao vivo com orçamento de até 100 por hora (≤ 200 chamadas/h no Dashboard, abaixo do limite de 300/h); gatilho +1 a +2 escritas por evento (categoria-ano), sem leitura extra. Antes: até 20.000 transações por carga, relidas a cada mutação (PR-RPT-02).

**Revisões.** `financial-domain-integrity` PASS; `multi-tenant-security-review` PASS; `ptbr-product-ui-review` PASS; `firestore-scale-cost-review` PASS no escopo (cumulativa FAIL só pelo TTL de `notifications`/`notification_user_states`, D-18, fora do escopo); `firebase-production-readiness` PASS no escopo (global FAIL pelos itens externos herdados, nenhum introduzido); `billing-entitlement-integrity` e `privacy-lgpd-data-lifecycle` não acionadas; `regression-release-gate`: validação da P5-C1 PASS, gate global FAIL só pelos débitos herdados acima. A revisão final própria (modelo principal) achou e corrigiu, antes da validação final: comentário de `report.ts` que ainda dava a evolução patrimonial ao viewer; três linhas acima de 80 colunas e espaços no fim de linha em `DistributionChart.tsx` (`git diff --check`); cobertura entre tenants só num sentido (callable 26 e Rules 6 agora tentam A → B e B → A); rendimento e perda realizados sem teste no relatório depois da remoção das fórmulas do navegador (integração 24b); status `forbidden` ainda citado no plano e na arquitetura; releitura ao vivo sem teto, que com escrita contínua esgotaria o limite de 300 chamadas/h do Dashboard (orçamento em `liveRefresh.ts`, 6 unitários e 6 mutantes mortos).

**Riscos e pendências.** Não corrigidos e registrados: L5, L6, L7, L8 e L10 da revisão independente; mutante I07 (releitura do ator) sobrevive porque a diferença só aparece numa janela de corrida não reproduzível sem mocks. Pré-existente e fora do escopo: Enter e Espaço não abrem o seletor de período (`ReportPeriodSelect`, igual na base). Capacidade real da callable (memória × concorrência) na P6. Desvio de processo: o índice Git real tem a deleção staged de `src/modules/reports/investments.ts`, feita por um subagente com `git rm --cached`; coincide com a remoção pretendida e não foi desfeita (reset/restore proibidos). Pedidos automáticos de commit/push recusados. Fora do escopo e abertos: PR-RPT-04 (P5-D2), parte de IA do PR-RPT-03/05 (P5-E1), PR-TX-03 (só a parte de relatórios avançou), débito de TTL da D-18 e o gate da P5.

**Rollback.** Reverter o diff da P5-C1 sobre a árvore `8befe373` (backend `functions/src/reports/`, `cash/periods.ts`, `cash/rebuild.ts`, `cash/categories.ts` e categoria por ID; Rules; índices; frontend de relatórios e formulários; testes; E2E; documentação). Sem dado real: projeções v4 → v5 e categoria v1 → v2 exigem reconstrução no Emulator (a leitura marca `rebuild_needed` até lá).

**Estado.** P5-C1 implementada — aguardando auditoria independente. PR-RPT-04 (P5-D2) e a parte de IA do PR-RPT-03/05 (P5-E1) abertos; PR-TX-03 não resolvido; marco P5 não concluído.

### 20.6 P5-C1.1 — complementação após a auditoria independente: fatura atual do cartão e corrida do I07 (2026-10-10)

Sobre a árvore auditada da P5-C1 (`a7e89e0d`; HEAD `f0c172b`, branch `integration/p4-finalization-2026-10-08`), reproduzida com índice Git temporário antes de qualquer alteração. Sem commit. Escopo autorizado: só esta complementação. Fora do escopo, sem nenhuma alteração: P5-A, P5-D1, P5-B/B.1, projeções diárias de caixa e por categoria, domínio patrimonial de Investimentos, regras de lançamentos, Billing e quotas, IA, notificações e TTL, REQ-FUT-01, PR-TX-03 e P5-C2.

**Índice Git.** A deleção staged de `src/modules/reports/investments.ts` (§20.5, "Desvio de processo") foi regularizada só com `git update-index --cacheinfo` para o blob do HEAD. Antes, conferi que não havia outra entrada staged. Arquivos, HEAD, branch e refs ficaram intactos; o índice real termina sem nada staged.

**Defeito.** `cards.ts` escolhia a "fatura atual" com `orderBy("dueDate").limit(1)` sobre as faturas com saldo. Com uma fatura vencida, ela virava a "atual", e `futureCommittedCents = pendente − atual` jogava a corrente no futuro. Na árvore auditada, com o exemplo vencida 100 / corrente 300 / futura 200, a tela mostrava:
- "Faturas abertas R$ 100,00";
- "Futuro R$ 500,00";
- o vencimento da vencida como "Vencimento atual".

**Contrato (D-37.3; compatível com a P4-A).** O saldo pendente são as faturas `unpaid`/`partial`. Cada uma cai em uma classe só:
- **Atraso:** fechada e vencimento antes de hoje (SP), exatamente `isInvoiceOverdue`.
- **Fatura atual (próxima obrigação):** entre as demais, a de menor (vencimento, competência). É:
  - a fechada que aguarda pagamento; ou
  - sem ela, a aberta com saldo de menor vencimento, incluindo a aberta cujo fechamento já chegou antes da rotina;
  - nunca uma vencida;
  - `null` quando não há candidata.
- **Futuro:** as demais.

Paridade e casos especiais:
- **Por cartão:** atraso + atual + futuro = pendente.
- **No bloco:** Σ pendente = `totalOutstandingCents` e Σ atraso = `overdueCents`. A lista de cartões, os agregados de obrigações e as classes de todos os cartões são lidos numa só transação somente leitura.
- **Dado inconsistente:** componente negativo, Σ que não fecha (fatura de cartão inexistente ou `cycleStatus` inválido) ou candidata fora do schema deixam o bloco `unavailable`.
- **Fatura paga ou com crédito:** fora das classes. O crédito só abate a seguinte no fechamento (P4-A).
- **Cartão arquivado:** classificado como os demais e listado por cartão só com saldo pendente (a P4-A aceita estornar pagamento de cartão arquivado), sem utilização. Os limites somam só os ativos.

Nada é gravado nem migrado; movimentos, pagamentos e fechamento ficam intactos. O contrato completo está em `docs/production/FINANCIAL_DOMAIN_MODEL.md`.

**Implementação.**
- **Backend:**
  - `functions/src/reports/cards.ts`: `classifyCard` faz 4 leituras por cartão (pendente, atraso e as duas candidatas, limitadas a 1 documento); `readObligations` é a transação somente leitura do bloco; a paridade do bloco foi incluída; `DUE_WINDOW_LIMIT` passou a 3 × 50, com o pior caso provado por teste.
  - `functions/src/reports/contract.ts`: documentação do contrato.
  - `functions/src/reports/callables.ts`: o papel relido vai para o log (`trustWorkspace`).
- **Índice:** `credit_card_invoices [cardId, paymentStatus, dueDate]` virou `[cardId, cycleStatus, paymentStatus, dueDate, competenceMonth]`, porque o antigo só servia à consulta removida. Continuam 69 compostos.
- **Frontend (mínimo):**
  - "Faturas abertas" passou a "Faturas atuais", "Fatura aberta" a "Fatura atual" e "Sem fatura aberta" a "Sem fatura a vencer".
  - Sem fatura atual, aparece "—" e nunca R$ 0,00.
  - O cartão arquivado com saldo traz "Cartão arquivado · …" e "—" em utilização e limite disponível.
  - A tabela analítica "Por cartão" lista só os ativos.
  - Arquivos: `adapter.ts`, `types.ts`, `official.ts` (comentários), `ReportsOverview.tsx`, `ReportsChartsView.tsx`.

**I07 (corrida entre a pré-checagem e a admissão).** A barreira controlada é um gancho de uso único em `admin.firestore().runTransaction`: a primeira transação do caminho da callable é a de admissão (a pré-checagem do kernel usa `getAll`). O teste 26b exercita a callable exportada:
- **Rebaixamento:** o member é rebaixado a viewer na barreira. A chamada é servida como viewer:
  - patrimônio, evolução e reconciliação vêm `null`;
  - os fluxos e a taxa de investimentos (direitos do viewer, D-15) ficam;
  - o limite de frequência é consumido uma vez;
  - o log registra `viewer`.
- **Remoção:** o admin é removido na barreira. A resposta é `permission-denied`, sem consumir o limite.
- **Garantias do teste:** a barreira dispara uma vez, e o teste prova que a pré-checagem leu o papel antigo antes dela (falha alto se surgir transação antes da pré-checagem).
- **Escopo:** nenhuma mudança de autorização nem de arquitetura de autenticação.

**Revisão adversarial independente (Opus, somente leitura).** Achados: 0 BLOCKER, 0 HIGH, 3 MEDIUM e 8 LOW.

Corrigidos:
- **M1:** cartão arquivado com saldo, após estorno de pagamento, deixava o bloco incoerente: o atraso aparecia no quadro e em nenhuma linha, e o bloco sumia quando só existia o arquivado.
- **L1:** agregados lidos fora do instantâneo.
- **L2:** fatura com `cycleStatus` inválido ia em silêncio para o futuro.
- **L3:** teto da janela de vencimentos assumia 2 faturas por cartão; o mês curto permite 3.
- **L4:** faltava oráculo fatura a fatura com `isInvoiceOverdue`.
- **L6:** log com o papel da pré-checagem.
- **L7:** o 26b não provava o papel lido pela pré-checagem, e o mutante de remoção da releitura não compilava.

Registrados, sem alteração:
- **M2:** rótulo "Fatura atual" diverge da tela de Cartões entre o fechamento e o vencimento. Decisão de produto; a tela de Cartões não foi tocada.
- **M3:** crédito de fatura aberta não abate o futuro antes do fechamento. Comportamento da P4-A, já presente na P5-C1; netar o crédito pede decisão.
- **L5:** a tabela "Por cartão" dos Gráficos não tem coluna de atraso, que segue no quadro e na coluna da Visão Geral; acrescentar a coluna seria mudança de UI não estritamente necessária.
- **L8:** falha de leitura de cartões derruba a chamada inteira (padrão anterior).

**Testes.**
- **Integração no Emulator:**
  - `cardClassification`: 19 testes, todos com o oráculo da P4-A. Cobrem o exemplo adversarial e os 13 casos pedidos (só corrente; vencida + corrente; duas vencidas + corrente; corrente parcialmente paga; só parcelas futuras; todas pagas; sem fatura; arquivado, sem e com saldo; estorno de compra; estorno de pagamento vencido e não vencido; mesmo vencimento com competências diferentes; virada de mês e de ano em SP; paridade com dois cartões), mais dado inconsistente, candidata fora do schema, `cycleStatus` inválido e fatura de cartão inexistente.
  - `financialReportAccess` 26b.
- **Unitários:** `cardsDueWindow` (todos os pares de dia de fechamento e vencimento, 5 anos) e `report-adapter` (33).
- **E2E:** `financial-reports` com cartões vencida / atual / futura, sem fatura e arquivado com saldo; Σ linhas = quadros.

**Validação.** `verify:all` **PASS** sobre a árvore final de código (`5b76ab43`, índice temporário), 2026-10-10T21:47:47Z–22:20:26Z: typecheck do frontend e das Functions; lint das Functions 0 erro e 201 avisos (os mesmos da base); build do frontend e das Functions; Functions unitários 492; frontend unitários 666; integração das Functions no Emulator 708; ferramentas 17; Rules 196 em 17 suítes; E2E 136 — 2.215 testes, 0 falha, 0 skip (P5-C1: 2.188). Depois dela só entrou documentação. Rodadas dirigidas anteriores também verdes (relatórios e cartões no Emulator 68/68 e 20/20; E2E de Relatórios 11/11). `git diff --check` limpo contra o HEAD e contra a árvore auditada.

**Mutações.** 18 mutantes sobre o código final (2026-10-10T21:29:47Z–21:44:16Z, cópia isolada; repositório conferido por SHA-256 antes e depois), 18 mortos, todos por asserção específica, nenhum inválido: integração no Emulator 13 — I07 (papel da pré-checagem decide), I07b (sem releitura do ator) e I08 (log com o papel antigo) pela asserção do 26b; C01 (fatura atual = vencimento mais antigo de qualquer pendente, o defeito original), C02 (toda fechada em atraso), C03 (desempate invertido), C04 (futuro sem descontar o atraso), C05 (sem conferência de paridade), C06 (vencimento no próprio dia em atraso), C07 (candidata fora do schema ignorada), C08 (sem paridade do bloco), C09 (arquivado com saldo fora da lista), C10 (arquivado com utilização); unitário do backend 1 — C11 (teto de vencimentos com 2 por cartão); unitários do frontend 2 — F10 (sem fatura atual vira R$ 0,00), F13 (arquivado na visão analítica); E2E 2 — F11 (limite disponível no arquivado: recebeu "R$ 4.950,00" onde se esperava "—"), F12 (sem a marca "Cartão arquivado"). Rodada anterior à revisão (10 mutantes): 10 mortos; o I07b, que não compilava (TS6133), foi corrigido e morto. Não mutado: a leitura fora do instantâneo único (efeito só sob corrida; o teste 18 exercita leituras simultâneas a escritas e confere a paridade em todas).

**Evidência visual.** `docs/production/evidence/p5c11/` (`LEIAME.md`, `diferencas-pixels.txt`, `antes-relatorio.json`, `depois-relatorio.json`): 16 capturas por árvore, desktop e celular, claro e escuro (Visão Geral, tabela por cartão, Gráficos "Por cartão" e tela de Cartões), mesmo roteiro e dados.
- O "antes" reproduz o defeito e a incoerência do arquivado (quadro R$ 150,00 × linhas R$ 100,00).
- O "depois" mostra atual R$ 300,00, futuro R$ 200,00 e atraso R$ 150,00, com Σ das linhas = quadros.
- Tela de Cartões 0,00%.
- Rolagem horizontal 0; axe sem violação nova.

**Custo.** Em `docs/production/evidence/p5c1/CUSTO.md`, a linha `cards` passa a ter:
- 4 leituras de classificação por cartão, ativo ou arquivado, mais 3 da janela por cartão listado;
- teto de 151 vencimentos.

Os cenários realistas não mudam (Dashboard ≈ 74, Relatórios PF 30 dias ≈ 90). O pior caso continua em 50 × 7 leituras.

**Revisões.** `financial-domain-integrity` PASS; `multi-tenant-security-review` PASS; `ptbr-product-ui-review` PASS; `firestore-scale-cost-review` PASS no escopo (cumulativa FAIL só pelo TTL de `notifications`/`notification_user_states`, D-18, fora do escopo); `billing-entitlement-integrity`, `privacy-lgpd-data-lifecycle`, `firebase-production-readiness` e `observability-incident-readiness` não acionadas (nenhum arquivo dessas superfícies; a correção do campo `actorRole` do log está coberta por testes); `regression-release-gate`: validação da P5-C1.1 PASS, gate global FAIL só pelo débito herdado da D-18.

**Riscos e pendências.**
- M2, M3, L5 e L8, acima.
- Pré-existentes e fora do escopo: o TTL da D-18 (gate global), o `ReportPeriodSelect` (Enter/Espaço) e a capacidade real da callable (P6).

**Rollback.** Reverter o diff da P5-C1.1 sobre `a7e89e0d`: `cards.ts`, `contract.ts`, `callables.ts`, o índice de `credit_card_invoices`, o frontend de relatórios, os testes, o E2E e a documentação. Sem dado gravado: nada a migrar.

**Estado.** P5-C1.1 implementada — aguardando auditoria independente. P5-C2 e as demais subetapas não iniciadas; marco P5 não concluído.

### 20.7 P5-C2 — contrato único de Transações e saneamento de M2, M3, L5 e L8 (2026-10-10 a 2026-10-11)

Sobre a árvore auditada da P5-C1.1 (`57070629`, ZIP `93231d22…9ab6b`; HEAD `f0c172b`, branch `integration/p4-finalization-2026-10-08`), reproduzida com índice Git temporário antes de qualquer alteração; o índice real termina sem nada staged. Sem commit, push, merge ou deploy. Escopo autorizado: a P5-C2 (consolidação definitiva dos contratos de `transactions`), o saneamento de M2, M3, L5 e L8 registrados na §20.6 e a preparação da decisão de retenção de notificações (D-18). Fora do escopo, sem alteração: P5-D2, P5-E, P5-F, IA (o prompt de preenchimento do formulário ainda cita `parcelado`/`value`, só como campo do formulário) e o domínio patrimonial.

**Contrato único de `workspaces/{ws}/transactions`.** Gravado só pelo backend (Rules inalteradas: `create, update, delete: if false`):
- `valueCents` inteiro seguro ≥ 0, até `CASH_ENTRY_MAX_CENTS` em receita/despesa; no espelho de investimento, igual ao valor da marca (`investmentEntry.amountCents`);
- `date` `AAAA-MM-DD` (dia civil de São Paulo), a única data, exigida em todo documento não anulado, inclusive no pendente (`date` = vencimento, D-29);
- `type` `receita` | `despesa` | `investimento` (este só com `investmentEntry`; empréstimo, fatura, recebível e divisão só como receita/despesa);
- `createdAt`/`updatedAt` Timestamp.

Removidos do documento persistido, sem migração, dual-read nem backfill (não há dado real): `value` em reais, `transactionDate` e o tipo `parcelado`. Produtores ajustados: caixa manual (`createTransaction`, correção e confirmação), importação, Recorrentes (via `cashEntryDocument`), espelhos de pagamento/estorno de fatura, empréstimo, recebível, Divisão de contas e investimento. A aba de compra parcelada do formulário (rótulo "Cartão", chave `parcelado` só em `TransactionFormType`) continua criando a compra por `createCreditCardPurchase`, no domínio de Cartões.

**Dado inválido nunca vira R$ 0,00.**
- **Backend:** `cashPeriodDeltaFor` lança `CashContractViolationError` (`valueCents`, `date`, `type` ou `marker`) para todo documento não anulado fora do contrato, com ou sem marca de domínio. O gatilho trata a violação como falha permanente e registra `contract_violation` (`needsRebuild` → relatório `rebuild_needed`). A reconstrução recusa publicar, com mensagem pt-BR, e registra em log o ID do documento e o campo.
- **Frontend:** `normalizeTransactionData` aplica as mesmas regras; o documento fora do contrato é excluído e contado ("N lançamento(s) com dados inconsistentes não exibido(s).").
- **Valor e data:** reais só derivados na apresentação (`transactionAmount = valueCents / 100`); somas em centavos; sem fallback por `transactionDate`; início da janela de lançamentos no dia civil de São Paulo (`saoPauloMonthsAgo`, antes `toISOString`).

**M2 — coerência dos rótulos de fatura.**
- O DTO ganhou `CardInvoiceRef.effectivelyClosed` (`isCycleEffectivelyClosed` no servidor).
- **Relatórios:** "Próximas faturas a pagar" no quadro e "Próxima fatura a pagar" nas colunas; " · ciclo aberto" só quando a fatura é do ciclo aberto e não está efetivamente fechada; "Sem fatura a vencer" mantido.
- **Cartões:** "Próxima fatura a pagar", "Fatura do ciclo aberto", "Fatura do ciclo seguinte" e "Histórico"; vencidas no histórico, com o selo.

**M3 — crédito não aplicado, só transparência.**
- `CardItem.openCreditCents` e `obligations.openCreditCents` = Σ de `-totalCents` das faturas abertas com total negativo, lidos na transação do bloco (1 agregação a mais por cartão; índice `credit_card_invoices [cardId, cycleStatus, totalCents]`, 70 compostos).
- Não entra em pendente, atraso, atual nem futuro; não muda limite, caixa nem eventos; o crédito segue transportado só no fechamento (P4-A).
- Telas: nota sob "Futuro comprometido", " · crédito de R$ X a compensar" na linha do cartão e "Crédito de R$ X a transportar para a próxima fatura no fechamento." na fatura aberta.

**L5.** Coluna "Em atraso" na tabela "Por cartão" (Gráficos), com o `overdueCents` autoritativo e R$ 0,00 verdadeiro. Cartão arquivado fora da tabela de consumo, com a nota "Não inclui R$ X em atraso de cartões arquivados, exibidos na Visão Geral.". No celular, a tabela rola no próprio contêiner, sem rolagem horizontal da página.

**L8 — degradação controlada.**
- Os blocos independentes (`accounts`, `cards`, `investments`, `debts`) são lidos por `isolateSectionRead`. Só falha passageira de leitura (gRPC 1, 2, 4, 8, 10, 13, 14 e contenção) vira `unavailable`/`temporarily_unavailable`, com log do bloco e do código, sem a mensagem.
- `ApplicationError`, erro sem código, PERMISSION_DENIED, UNAUTHENTICATED, FAILED_PRECONDITION e INVALID_ARGUMENT derrubam a chamada. Sem catch genérico; o caixa não é isolado.
- Com cartões indisponíveis, Dívidas vem `truncated`/`partial_sources` com `cardObligationsCents: null`; os alertas de empréstimo e de recebível continuam emitidos, e o bloco de alertas declara cobertura parcial.
- Leitores injetáveis por parâmetro tipado só para teste.

**D-18 — retenção de notificações.** Desenho técnico completo em `docs/production/DATA_RETENTION_LIFECYCLE.md` §4.1: `expiresAt` calculado pelo produtor, cópia no estado privado pelas Rules, dois `fieldOverrides`, paginação com filtro lógico, idempotência, custo, testes, TTL declarado × publicado e backups. Proposta de 180 dias (90 viável; mínimo de 30 pela janela dos produtores). **Prazo não aprovado; nada implementado.** Pronto para autorização.

**Revisão adversarial independente (Opus, somente leitura).** 0 BLOCKER, 0 HIGH, 3 MEDIUM, 6 LOW, 1 questão.

Corrigidos:
- **M-1:** com cartões indisponíveis, os alertas de empréstimo e recebível sumiam.
- **M-2:** documento com marca de domínio não validava tipo nem valor.
- **M-3:** o frontend aceitava `investimento` sem marca.
- **L-1:** pendente com data inválida passava em silêncio.
- **L-2:** teto do valor (era o teto seguro do JavaScript; passou ao teto do produto e, no investimento, ao valor da marca).
- **L-3:** recusa da reconstrução sem o ID do documento no log.
- **L-5 (parte):** nota "Parcial" no gráfico PJ de recebíveis.
- **L-6:** janela de lançamentos em UTC.

Registrados, sem alteração:
- **L-4:** documento com `date` não textual não volta da consulta e não é contado; a contagem é da janela, não do mês; os lançamentos recentes do Dashboard excluem sem aviso. O backend registra a violação pelo gatilho.
- **L-5 (parte):** "no momento" também aparece quando a indisponibilidade de cartões é estrutural.
- **Q-1:** em Relatórios, a fatura do ciclo aberto pode aparecer como "Próxima fatura a pagar · ciclo aberto"; em Cartões, ela é a "Fatura do ciclo aberto". Conforme o contrato pedido para M2.

**Testes novos ou reescritos.**
- **Integração no Emulator:**
  - `transactionsContract` (15): guarda de schema autoverificada sobre os documentos gravados por todos os produtores — caixa manual, importação, recorrente, cartão (compra 3x sem `transactions`, pagamento e estorno), investimento, empréstimo, recebível e divisão. Também cobre conciliação de todos os produtores, virada de ano, teto de valor, documento fora do contrato (`contract_violation`), cursor e isolamento PF/PJ.
  - `reportResilience` (L8, 10).
  - `cardClassification` M3-01…04 e oráculo de `effectivelyClosed`/`openCreditCents`.
  - Caixa: `periods`, `projectionRecovery`, `rebuildFence`, `d29Lifecycle` e `p4CrossDomain` com violações, anulado/pendente, correção retroativa e recusa da reconstrução.
- **Unitários:**
  - `dayProjection`: espelhos canônicos, marca com tipo e valor, teto do produto, pendente com data inválida.
  - `tests/unit/transactions-contract.test.ts`: 23 testes, incluindo coerência tipo/marca/teto e a janela no dia civil de São Paulo.
  - `report-adapter` e `cards-model`.
- **E2E:** `financial-reports` (rótulos M2, coluna "Em atraso", nota dos arquivados) e `credit-card-flow`.
- **Fixtures:** as sementes de Rules que imitam documentos do backend passaram ao contrato. Os payloads de ataque do cliente continuam no formato antigo, para provar que ele segue negado.

**Validação.** `verify:all` **PASS** sobre o código final (árvore `a9d20db4`, índice temporário), 2026-10-11T01:16:28Z–01:48:45Z. Depois dela só entrou documentação.
- **Estáticos:** typecheck do frontend e das Functions; lint das Functions com 0 erro e 199 avisos (a base tinha 201); build do frontend e das Functions.
- **Testes:** 2.282, 0 falha, 0 skip (P5-C1.1: 2.215).
  - Functions unitários: 500.
  - Frontend unitários: 685.
  - Integração das Functions no Emulator: 748.
  - Ferramentas: 17.
  - Rules: 196 em 17 suítes.
  - E2E: 136.
- **`git diff --check`:** limpo.
- **Rodadas dirigidas anteriores:** a primeira integração completa (745/748) acusou três testes antigos que ainda esperavam `value` ou efeito zero; foram ajustados ao contrato (endurecidos, nunca relaxados).

**Mutações.** 38 mutantes válidos sobre o código final, numa cópia isolada (repositório conferido por SHA-256 antes e depois), 38 mortos por asserção específica:
- **Unitários das Functions (8):** valor inválido vira zero, `parcelado` como despesa, pendente move caixa, espelho de investimento com outro tipo, marca sem validação, teto, valor ≠ marca e pendente com data inválida.
- **Integração no Emulator (18):**
  - fallbacks por `value` e por `transactionDate` em UTC;
  - violação sem `contract_violation`, reconstrução ignorando o documento;
  - produtores voltando a gravar `value`, `transactionDate` ou tipo errado;
  - M2 `effectivelyClosed` fixo, M3 crédito omitido e compensação prematura, vencida como atual;
  - L8 catch genérico, permissão mascarada, Dívidas exatas, obrigação zero, log com a mensagem, alertas suprimidos;
  - revalidação de membership removida.
- **Frontend (10):** leitura por `value`, `parcelado` aceito, inválido como zero, arredondamento, investimento sem marca, janela em UTC, "ciclo aberto" indevido, vencida como próxima a pagar, nota de crédito suprimida e atraso de arquivado omitido.
- **E2E (2):** aba de compra parcelada desviada para o caixa; coluna "Em atraso" sem o valor.
- **Inválidas:** três primeiras versões que não compilavam (M01, L03, L07), reescritas e mortas; não contam.

**Evidência visual.** `docs/production/evidence/p5c2/` (`LEIAME.md`, `diferencas-pixels.txt`, relatórios e 48 capturas por árvore), mesmo roteiro e dados em `57070629` e na P5-C2:
- 28 telas com 0,00%: listas PF e PJ, criação, edição, aba de compra parcelada, tela de Cartões e estado indisponível;
- mudanças só nos rótulos e notas de M2, M3 e L5;
- rolagem horizontal 0, axe sem violação nova, foco preso no diálogo e Escape, acionamento por teclado.

Durante a captura, dois ajustes para não alterar a interface fora do necessário:
- o contêiner vazio da linha da lista, removido junto com o selo morto de parcela, foi restaurado (deslocava 2 px);
- a nota de crédito ganhou o contraste exigido.

**Custo.** `CUSTO.md`: +1 agregação por cartão (Dashboard ≈ 77, Relatórios PF 30 dias ≈ 93, teto 50 × 8); o isolamento L8 não acrescenta leitura.

**Revisões.**
- `financial-domain-integrity` **PASS** no escopo da P5-C2: autoridade única em centavos, violação tipada em vez de zero, produtores canônicos provados pela guarda, conciliação e mutações, remoção provada por busca (`prova-remocao.txt`), Rules negando o caminho antigo.
- `multi-tenant-security-review` **PASS**: sem mudança de autorização; L8 não mascara permissão, membership nem isolamento (L8-04, L8-09; mutante da revalidação morto).
- `ptbr-product-ui-review` **PASS**: textos em pt-BR; só as mudanças pedidas; 28 telas idênticas; axe sem violação nova; teclado.
- `firestore-scale-cost-review` **PASS** no escopo (índice declarado, +1 agregação limitada por cartão, sem listener novo) e **FAIL** na avaliação cumulativa pelo TTL de `notifications`/`notification_user_states` (D-18).
- `privacy-lgpd-data-lifecycle` **PASS** no escopo (logs novos só com IDs e códigos) e **FAIL** cumulativo pela D-18 sem prazo aprovado.
- `observability-incident-readiness`, acionada pelo logging tocado: **PASS** no escopo (`financial_report.section_unavailable`, `cash_rebuild_contract_violation` e o código `contract_violation` estruturados, sem dado pessoal); alertas e métricas são P7.
- `billing-entitlement-integrity` e `firebase-production-readiness`: não acionadas.
- `regression-release-gate`: validação técnica da P5-C2 verde, nenhuma regressão nova; **gate global FAIL** pelo débito herdado da D-18.

**Subagentes (modelos pedidos à ferramenta).**
- Inventário de `transactions`: Haiku.
- Backend (produtores), frontend (contrato), testes de caixa, UI de M2/M3/L5/L8 e guarda de schema: Sonnet.
- Revisão adversarial independente: Opus.
- Documentação CURRENT: Haiku.

A integração, as correções da revisão, as decisões de contrato, as mutações, a evidência e a validação ficaram com o modelo principal.

**Riscos e pendências.**
- D-18 aguardando a decisão do prazo.
- L-4, L-5 (parte) e Q-1, acima.
- PR-TX-04 (detector de deriva, P7).
- Pré-existentes: contraste e nomes de `select` nas telas tocadas (axe, sem violação nova).

**Rollback.** Reverter o diff da P5-C2 sobre `57070629`:
- leitor de caixa, gatilho e reconstrução;
- produtores, contrato e leitores do frontend;
- relatórios (`cards.ts`, `report.ts`, `contract.ts`, `callables.ts`) e telas;
- o índice `credit_card_invoices [cardId, cycleStatus, totalCents]`;
- testes, E2E e documentação.

Sem dado gravado: nada a migrar.

**Estado.** P5-C2 implementada — aguardando auditoria independente. PR-TX-03 resolvido na P5-C2, aguardando auditoria; D-18 pronta para autorização, não concluída. P5-D2, P5-E, P5-F e o gate da P5 não iniciados; marco P5 não concluído.

### 20.8 D-18-NOTIF — retenção de 180 dias, exclusão individual e fechamento da infraestrutura de notificações (2026-10-11)

Sobre a árvore da P5-C2 (`dad5c72c`, ZIP `8120c08a…1f9015`; HEAD `f0c172b`, branch `integration/p4-finalization-2026-10-08`), reproduzida com índice Git temporário antes de qualquer alteração; o índice real termina sem nada staged. Sem commit, push, merge ou deploy. Implementação autorizada só no código local e no Emulator; nada foi publicado (Rules, índices ou TTL). Fora do escopo, sem alteração: P5-D2 (contagem exata e demais produtores), regras de fechamento e pagamento de fatura, prazos de auditoria, billing, transações, dados pessoais em geral e backups.

**Decisão D-18-NOTIF (aprovada pelo usuário).**
- Retenção de 180 dias contados da criação do evento no servidor.
- Vencida, a notificação sai da interface, com ou sem remoção física.
- Owner, admin e member podem excluir antes do prazo, só para si; viewer não pode (nem owner apaga o evento compartilhado).
- Todos os leitores, inclusive viewer, marcam como lida e arquivam para si.
- A exclusão individual não apaga o evento, o estado dos demais membros nem registro financeiro ou de auditoria, e persiste entre recarga, dispositivo e novo login.
- A D-18 geral continua aberta para as demais categorias.

**Contrato.**
- Evento `workspaces/{ws}/notifications/{id}`: só o backend grava; `createdAt` (texto ISO, ordenação) e `expiresAt` (Timestamp nativo) do mesmo instante, `expiresAt = createdAt + 180 × 24 h` (`RETENTION_DAYS.notifications`, `expiresAfterDays`).
- Estado privado em `workspaces/{ws}/notification_user_states/{uid}/notification_entries/{id}` (substitui `items`, sem migração nem leitura dupla):
  - campos `read`/`readAt`, `dismissed`/`dismissedAt`, `deleted`/`deletedAt` e `expiresAt`, obrigatório e cópia exata do evento;
  - cada marca nasce `true` com o carimbo do servidor e nunca muda nem some;
  - "Excluir para mim" é a marca `deleted` (tombstone individual), sem `deleteDoc` e sem segunda coleção;
  - precedência visual `deleted` > `dismissed` > `read`; excluída nunca conta como não lida.

**Produtor (Cartões).** `functions/src/cards/closing.ts`:
- o fechamento lê o aviso na transação antes de qualquer escrita e só o cria se ausente (`transaction.create`; antes `set`), então um retry nunca prorroga nem recria;
- vencimento próximo e atraso mantêm `.create()` com ALREADY_EXISTS ignorado;
- as janelas (3 e 7 dias) são menores que a retenção, então nada é reemitido depois dos 180 dias;
- nenhuma regra de fechamento, pagamento, competência, vencimento ou valor mudou. Custo: +1 leitura por fatura fechada.

**Rules.**
- Evento: `get`/`list` (limit ≤ 50) por membro ativo; `create, update, delete: if false` para todos.
- Estado: só o próprio uid, membro ativo e conta ativa; escrita só em workspace ativo; forma estrita (`hasOnly`).
- Criação: exige evento existente e não expirado, com `expiresAt` idêntico (`get` do evento). Atualização: exige `expiresAt` inalterado e `request.time` anterior a ele.
- `deleted` novo só com papel owner/admin/member relido do membership (`hasRole`); `deleted` já gravado é mantido para qualquer papel. `delete` negado.
- Custo medido no Emulator: 5 acessos fixos + 1 por estado criado; 15 criações por lote passam e 16 são recusadas (afirmado no teste); o cliente grava lotes de 10.

**Frontend.**
- Oculta excluídas, arquivadas e expiradas.
- Relógio local por `setTimeout` até a próxima expiração entre as carregadas, rearmado em disparo antecipado; sem polling.
- Cursor sobre o último documento bruto; páginas de 25 + 1 podem mostrar menos de 25.
- Evento sem `expiresAt` Timestamp fica fora do contrato.
- Ações:
  - "Arquivar para mim" para todos.
  - "Excluir para mim" para owner, admin e member, com papel e uid do mesmo `activeWorkspace`; o botão some enquanto o papel é desconhecido.
  - Confirmação acessível: foco inicial em "Cancelar", Tab preso, Escape, `aria-describedby`; o foco volta ao botão ou, depois de excluir, ao sino.
  - O diálogo não fecha durante a gravação; o resultado só vale para o mesmo pedido e escopo.
  - Mensagem própria quando o evento expirou e nada foi gravado.
- No celular (sem hover) as ações ficam sempre visíveis; no desktop seguem no hover/foco.
- Correção necessária no celular: o painel, ancorado à direita do sino, ficava quase todo fora da tela quando o cabeçalho quebrava a linha (x = −268 a 52 em 390 px, já na P5-C2), o que deixaria "Excluir para mim" inalcançável. Agora, só quando há transbordo, ele é deslocado para dentro da tela (`useKeepInsideViewport`); no desktop nada muda.
- Guarda síncrona contra dois cliques na mesma tarefa: um único pedido de gravação.
- Erros em pt-BR, sem falso sucesso.

**TTL.** Dois `fieldOverrides` em `firestore.indexes.json` (`notifications` e `notification_entries`, `expiresAt`, `ttl: true`, `indexes: []`); 16 grupos versionados. **Implementado e declarado, não publicado:** a remoção física só passa a valer depois da publicação por ambiente e da confirmação `ACTIVE` (E-07, P6). Sem job de varredura nem Function agendada. O Emulator não executa TTL: os testes simulam a remoção pelo Admin SDK e não provam a remoção física.

**Ajustes residuais da P5-C2 (localizados, sem regra financeira).**
- **Q-1:** em Relatórios, a fatura do ciclo aberto passa a "· fatura do ciclo aberto", o mesmo nome de Cartões; só texto.
- **L-4:**
  - o aviso de lançamentos inconsistentes diz "nos meses carregados" (a contagem é da janela, não do mês);
  - o comentário de `invalidCount` registra que documento sem `date` textual não volta da consulta e é detectado pelo gatilho (`contract_violation`), com dois casos novos no teste de integração (`date` Timestamp e numérico);
  - sem varredura no cliente; a conferência completa depende do detector de deriva da P7 (PR-TX-04);
  - os lançamentos recentes do Dashboard seguem excluindo sem aviso (registrado).
- **L-5:** a indisponibilidade dos blocos de relatório distingue falha passageira ("Indisponível no momento. Tente novamente em instantes."), dado inconsistente ("Indisponível: há dados inconsistentes que impedem o cálculo.") e limite da consulta ("Indisponível: o volume de dados excede o limite desta consulta."), pelos 8 motivos estáveis do backend; o motivo técnico nunca aparece; a nota "Parcial" deixou de dizer "no momento".

**Teste preexistente dependente do horário (P5-C1, corrigido de forma localizada).** Na 1ª rodada do `verify:all` (10h30 UTC), 4 testes de `financialReportAccess.integration.test.ts` falharam com "A data informada em occurredAt está no futuro.": o helper `noonToday()` gerava o meio-dia de São Paulo (15h UTC) do dia corrente, no futuro antes desse horário. O helper passou a limitar o instante a agora, no mesmo dia civil. Asserções inalteradas; o arquivo passou às 10h42 UTC (10/10) e na rodada completa.

**Validação final** (Emulator `minhas-financas-local`; nenhum acesso à produção):
- `verify:fast`: typecheck, lint das Functions, builds do frontend e das Functions e 1.215 unitários (505 das Functions e 710 do frontend), 0 falhas e 0 skips.
- `test:integration:emulator`:
  - 757 de integração das Functions;
  - 17 das ferramentas;
  - 233 de Rules, entre eles 61 de notificações (24 da P5-D1 e 37 da D-18);
  - 0 falhas e 0 skips.
- `test:e2e`: 149 testes. Primeira rodada completa: 148 passaram e 1 falhou.
  - **A falha:** o teste de teclado das notificações estourou 45 s no `beforeEach`, no reset do Emulator e não no corpo.
  - **Causa:** chamadas `getFinancialReport` do teste anterior ainda terminavam no Emulator de Functions e disputavam documentos com o `recursiveDelete`.
  - **Diagnóstico:** isolado, o arquivo passou 9/9 vezes; a segunda rodada completa, sem mudança, passou 149/149.
  - **3ª rodada, limpeza pelo endpoint oficial do Emulator:** 147/149. O endpoint recusou a limpeza (HTTP 409, transação aberta) logo depois de dois testes cujas chamadas ainda terminavam no servidor. Isso confirma a causa.
  - **Correção:** `clearEmulatorData` (`e2e/support/workspaceSeed.ts`), usado nas duas specs de notificações, espera o Emulator aceitar a limpeza, só no 409 e com teto de 30 s; outro status falha na hora. É sincronização com o fim do teste anterior; nenhuma asserção, teste ou timeout de teste mudou.
  - **4ª rodada, com a sincronização:** 148/149. Os 16 testes de notificações passaram.
    - A falha foi em `loans-pf.spec.ts` (preexistente, fora do escopo): "Saldo Atual" do Dashboard ainda em R$ 0,00 depois de 12 s.
    - Log: logo depois dos `createLoan`, três `getFinancialReport` levaram 8,3 s a 10,3 s (≈ 0,1 s no normal), ou seja, latência do Emulator sob carga.
    - O mesmo arquivo passou 18/18 isolado (3 repetições) e passou nas três rodadas completas anteriores. Registrado como risco do ambiente E2E.
  - **5ª rodada completa, código final:** 149/149 (12,7 min).
- Total: 2.371 testes (2.222 de Node + 149 de E2E), contra a linha de base de 2.282. Os 89 a mais são os novos:
  - 5 unitários de retenção;
  - 9 de integração do produtor;
  - 37 de Rules;
  - 24 unitários de notificações;
  - 1 de L-5;
  - 13 de E2E.
- Também: `git diff --check` limpo (índice temporário) e prova de remoção (`prova-remocao.txt`).


**Revisão adversarial independente (Opus, somente leitura).** 0 BLOCKER, 1 HIGH, 1 MEDIUM, 6 LOW e 3 questões.

Corrigidos:
- **H-1:** a spec E2E de notificações ainda estava no contrato antigo no snapshot revisado; foi migrada e está passando.
- **M-1:** diálogo fechável durante a gravação, com retorno de foco e erro vazando entre pedidos. Agora o diálogo não fecha durante a gravação, o resultado só vale para o mesmo pedido e escopo, e abrir um pedido limpa erro, aviso e foco.
- **L-1:** relógio não rearmava depois de disparo antecipado.
- **L-3:** exclusão sem gravação tratada como sucesso; agora tem resultado próprio, `expired`, com aviso em pt-BR.
- **L-4:** `aria-describedby` no diálogo.
- **L-5:** testes tautológicos ou incompletos reforçados (retenção sem helper local, título da concorrência, orçamento 15/16 afirmado, estado com `expiresAt`) e comentário corrigido.
- **L-6:** comentário que afirmava TTL ativo.

Respondidas e registradas, sem alteração:
- **L-2 / risco:** relógio do cliente muito atrasado.
- **Q-1:** evento vencido legível pelo SDK até o TTL; não é fronteira de confidencialidade.
- **Q-2:** documentação, atualizada nesta etapa.
- **Q-3:** mudança no celular, necessária para alcançar as ações sem hover.

**Agente E (E2E e evidência) achou mais dois defeitos, ambos corrigidos:**
- o painel fora da tela no celular (pré-existente, agravado pelo segundo botão);
- dois cliques na mesma tarefa geravam duas gravações; a E2E passou a contar os pedidos.

**Registrado, sem alteração:** no desktop, as ações em hover cobrem o horário do item, como já acontecia com um botão.

**Mutações.** Os mutantes rodaram numa cópia isolada do working tree (`git archive`; repositório conferido por SHA-256 antes e depois). Ao todo, 38 mutantes válidos, 38 mortos por asserção específica, todos restaurados:
- **Rules no Emulator (12):** viewer exclui, `deleted` liberado em estado existente, `expiresAt` diferente do evento, `expiresAt` alterado, evento expirado, estado expirado atualizável, `deleted` removível, `deletedAt` do cliente, campo extra, `delete` do estado, estado de outro uid e owner apagando o evento.
- **Integração no Emulator (6):** aviso regravado no fechamento, `expiresAt` de outro instante, `expiresAt` em texto, retenção de 90 dias, vencimento/atraso com `set` e `date` não textual aceito (L-4).
- **Unitário das Functions (1):** aritmética do helper.
- **Frontend (15):**
  - visibilidade: excluída visível, expirada visível;
  - marcação: estado sem `expiresAt`, evento expirado marcado, evento sem `expiresAt` aceito, marca repetida regravada;
  - botão de excluir: viewer com o botão, papel de outra conta;
  - cursor tirado da lista filtrada;
  - temporizador nunca agenda ou não rearma;
  - confirmação no escopo errado;
  - exclusão sem gravação como sucesso;
  - L-5: dado inconsistente dito passageiro e "Parcial" com "no momento".
- **E2E (4):** viewer com o botão, Q-1 sem "fatura do", painel não trazido para a tela no celular e guarda contra dois cliques.

Inválidas ou refeitas, sem contar:
- C01 na 1ª versão: não compilava.
- C04 na 1ª rodada: sobreviveu porque o teste espelhava a constante; o teste passou a fixar os 180 dias aprovados, e a rodada nova o matou.
- Rodada 0 de frontend: a suíte travava depois de falhar. Foi corrigida com `afterEach`, e todos os mutantes foram refeitos.

**Evidência visual.** `docs/production/evidence/d18/` (`LEIAME.md`, `CUSTO.md`, `diferencas-pixels.txt`, relatórios, `mutacoes.json`, `prova-remocao.txt` e capturas: 14 no antes, 30 no depois):
- desktop: 0,00% no painel, na lista e no viewer;
- só o botão novo aparece no hover (0,01%);
- celular: o painel passa a caber na tela;
- rolagem horizontal 0;
- axe sem violação com o diálogo assentado;
- teclado: foco preso, Escape e retorno do foco.

**Custo.** `CUSTO.md`:
- Rules: 5 acessos fixos + 1 por criação (medido);
- +1 leitura por fatura fechada;
- 0 leitura no timer de expiração;
- TTL sem leitura, quando ativo.

**Riscos e pendências.**
- TTL não publicado (E-07): até a ativação nada é removido fisicamente; a ocultação vale na interface.
- Evento vencido continua legível por acesso direto ao SDK por membro do workspace até a remoção pelo TTL (não é fronteira de confidencialidade; o membro já o lia).
- Relógio do cliente muito atrasado perto do vencimento faz as Rules recusarem a marcação com mensagem de permissão (raro; o servidor decide).
- Contagem exata e demais produtores (P5-D2); prazos das demais categorias (D-18).
- Backups e PITR (D-27) guardam itens expirados pelo prazo deles.

**Rollback.** Reverter o diff da D-18-NOTIF sobre `dad5c72c`:
- `retention.ts`, `closing.ts`;
- os blocos de notificações de `firestore.rules`;
- os dois `fieldOverrides`;
- o módulo de notificações, `Header`, `NotificationsPanel` e `ConfirmationModal` (`manageFocus`, opcional);
- os ajustes Q-1/L-4/L-5;
- testes, E2E e documentação.

Sem dado real: nada a migrar. Como o TTL nunca foi publicado, não há política a desativar.

**Estado.** D-18-NOTIF implementada — aguardando auditoria independente. Ativação do TTL pendente (E-07). PR-NOTIF-01 segue parcial (P5-D2). P5-D2, P5-E, P5-F e o gate da P5 não iniciados; marco P5 não concluído.

### 20.9 P5-D2 — alertas financeiros persistentes, produtores oficiais e contagem exata de notificações (2026-10-11)

Sobre a árvore da D-18-NOTIF (`7c3913f6`, ZIP `baa576d5…e497`; HEAD `f0c172b`, branch `integration/p4-finalization-2026-10-08`), reproduzida com índice Git temporário antes de qualquer alteração; o índice real termina sem nada staged. Sem commit, push, merge ou deploy. Nada publicado: Rules inalteradas; índices e TTL só declarados. Fora do escopo, sem alteração: P5-E1/E2, P5-F, P6–P10, reforma da arquitetura financeira, mensagens entre usuários, rebranding e qualquer envio externo (e-mail, SMS, push, WhatsApp).

**Identidade do produto.** Nome **FênixGran**, slogan "Sua grana em uma nova fase", registrados no `AGENTS.md` e no cabeçalho deste plano. Sem rebranding visual. Repositório, project ID, coleções, Functions publicáveis, variáveis internas estáveis e identificadores de billing não foram renomeados.

**Matriz de elegibilidade.** Checkpoint de arquitetura antes dos produtores; o resumo está em [DATA_MODEL.md](DATA_MODEL.md) §7. Evento notificável é fato de domínio com instante próprio, persistido; alerta contextual de relatório é condição do período, calculada e não persistida (D-37.9). Nenhuma consulta de relatório grava notificação.

| Evento | Fonte autoritativa | Emissão | Episódio do ID | Sem reemissão depois do TTL |
| --- | --- | --- | --- | --- |
| `loan_overdue` | `loans.status` (D-13) | gatilho de escrita: antes ≠ `overdue`, depois = `overdue` | `overdueFrom` | só na transição; reentrega do Eventarc por até 24 h |
| `receivable_overdue` | `receivables` `open` (saldo > 0), atraso derivado | rotina diária 06:45 (São Paulo), `dueDate` em [hoje − 7, hoje − 1] (*substituído na P5-D2.1, §20.10: sem limite de dias, fila durável e rotina horária*) | `dueDate` | janela de 7 dias menor que os 180 de retenção (*substituído: confirmação durável por episódio*) |
| `cash_account_negative_balance` | `cash_accounts.balanceCents` | gatilho: antes ≥ 0, depois < 0 (criação não emite) | instante do commit | só na transição |
| `goal_achieved` | `goals.status` | gatilho: transição para `alcancada` | instante do commit | só na transição |
| `recurring_awaiting_confirmation` / `recurring_attention_required` | `recurring_occurrences` | gatilho de criação da ocorrência | `occurrenceId` | a ocorrência é criada uma única vez |
| `invoice_closed`, `invoice_due_soon`, `invoice_overdue` | faturas (D-36, preservados) | rotina de cartões | formato `cc<tipo>_<hash>` | fechamento transacional; janelas de 3 e 7 dias |

**Decisões de emissão com consequência de produto** (tomadas dentro do modelo de domínio existente, sem regra nova; revisáveis pelo usuário):
1. Recebível criado ou editado com vencimento há mais de 7 dias nunca avisa. *Substituída pela D-42 na P5-D2.1 (§20.10): o atraso avisa sem limite de dias, uma vez por episódio.*
2. Empréstimo criado já em atraso avisa: a criação é a transição de inexistente para `overdue`.
3. Meta: o episódio é o commit, então alternar entre alcançada e em andamento emite a cada vez.
4. Conta criada com saldo negativo não avisa; só a passagem de ≥ 0 para < 0.
5. Recorrentes: um aviso por ocorrência criada em `awaiting_confirmation` ou `attention_required`; mudanças posteriores de status não emitem.
6. Estorno que volta o empréstimo a `overdue` com o mesmo `overdueFrom` cai no mesmo ID enquanto o aviso existe; depois da remoção física pelo TTL, a nova transição é fato novo e emite.

**Pendentes de decisão (não implementados, sem regra inventada):**
- **Meta atingida pelo progresso:** investimentos oscilam em torno de 100%. Opções: A, não notificar (atual); B, só metas manuais, na transição de abaixo para acima do alvo; C, todas, com histerese.
- **Vencimento próximo de empréstimo e recebível:** exige limiar ainda não decidido.
- **`invoice_closed` no fechamento por pagamento** (`invoiceOperations.ts:283-325`): lacuna conhecida; o pagamento é ato do próprio usuário.
- **Divisão de contas — bloqueador de entrega dirigida.** O evento é do workspace, participante externo não tem conta e quitação declarada não é caixa. Proposta: evento com destinatário (`audienceUid`), Rules e consulta próprias e extensão da fórmula de contagem. Fica fora da P5-D2.
- **Falhas técnicas** (callable, rotina, reconstrução, NOTIF-04): P7.

**Motor** (`functions/src/notifications/`):
- `contract.ts` (contrato congelado: 9 tipos, domínio, link, campos de entidade por domínio, título ≤ 80 e mensagem ≤ 300), `builder.ts` (validação estrita), `ids.ts` (`prefixo_sha256(ws:domínio:entidade:tipo:episódio)[0:32]`, segmento inválido vira `NotificationContractError`) e `publish.ts` (`create`; ALREADY_EXISTS é sucesso).
- O documento autoritativo gravado pela operação do domínio é o registro durável; o gatilho é o consumidor idempotente (sem outbox separado).
- `publishProduced`: violação de contrato é registrada e não relançada (a reentrega produziria o mesmo documento inválido); qualquer outro erro é relançado para o retry.
- Gatilhos com `NOTIFICATION_TRIGGER_OPTIONS`: `southamerica-east1`, 60 s, 256 MiB, até 20 instâncias, `retry: true`. Rotina de recebíveis (*substituída na P5-D2.1, §20.10: fila durável por workspace, rotina horária, sem cursor persistido*): grupo de coleção paginado, 200 × 25 páginas por execução, com cursor persistido de retomada (`system/receivable_overdue_notifications`, só backend, salvo a cada página): os já avisados continuam na consulta, então a execução seguinte continua do último processado até o fim da janela e dá a volta até ele; cursor fora da janela ou malformado é descartado; janela inteira percorrida zera o cursor.
- `createdAt` = instante do commit do domínio (gatilhos) ou da primeira criação (rotina); `expiresAt` = `createdAt` + 180 dias. Retry nunca prorroga.
- Textos em pt-BR, no passado e datados pela detecção ("Foi identificado atraso em DD/MM/AAAA…"): o aviso não afirma o estado atual. Sem nome, documento, valor ou descrição; nada lido de `client_private`. Tipo `warning` nos atrasos e nos recorrentes; `success` na meta.
- Cartões: `closing.ts` só passa pelo builder; o aviso de fechamento é montado depois de `applyInvoiceClose`, com `slot.next.totalCents` (sem segundo cálculo do total).

**Contagem exata** (`getNotificationUnreadCount`, `unreadCount.ts`):
- `não_lidas = |eventos com expiresAt > t| − |estados do usuário com expiresAt > t|`, numa única transação somente leitura: primeiro o ator (perfil, workspace e membership); `t` é o `readTime` dessa leitura, dado pelo servidor; depois as duas agregações `count()` filtradas por `t`. A callable confere que o `readTime` das agregações é igual a `t` e devolve `asOf` em RFC 3339 com nanossegundos.
- As pré-condições da fórmula valem pelas Rules (inalteradas) e pelo produtor (ver [DATA_MODEL.md](DATA_MODEL.md) §7).
- Resultado negativo é violação de invariante: log `notification_unread_count_invariant_violated` e erro `internal` em pt-BR; nunca `Math.max(0, …)`.
- Qualquer papel, inclusive viewer; uid só do token; membership relido na transação; workspace arquivado e membro removido recusados. Limite de 600 chamadas por hora por (workspace, uid).
- Índices: `expiresAt` ascendente de coleção nos overrides de TTL de `notifications` e `notification_entries`, mais o grupo de `receivables` (*removido na P5-D2.1, §20.10; trocado pelo override de `runAfterDay` da fila*). **Ordem de implantação:** índices antes das Functions ([FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) §5). A igualdade de `readTime` foi verificada só no Emulator; conferir em STAGING (falha fechada: "?" e nunca número errado).

**Frontend** (mudança mínima):
- Sino com o total exato do servidor; rótulo "Notificações, N não lidas"; indisponível é "?" com "total de não lidas indisponível", nunca zero.
- Releitura ao surgir o escopo, ao abrir o painel, no foco (dado com mais de 1 minuto), depois de cada ação, quando a primeira página traz IDs novos e quando um item carregado expira no relógio local. Sem polling e sem listener. Cache por (workspace, uid).
- **Relatórios (PR-RPT-04):** `markAlertAsRead` (só `console.log`) e a ocultação local removidos. O bloco virou "Condições do período", sem botão de leitura e com "Calculado em DD/MM/AAAA". As condições só se dizem completas quando todas as fontes foram avaliadas, inclusive o caixa (`report.ts`, `alertSourcesComplete`). Valores financeiros inalterados.

**Observabilidade.** Logs só com identificadores e contagens ([OBSERVABILITY.md](OBSERVABILITY.md) §2.11). Os gatilhos registram `sourceEventId` (o `event.id` do Eventarc, igual em cada reentrega); a rotina de recebíveis registra `runId = receivable-overdue-<scheduleTime>`. Notificação ao usuário não é alerta interno.

**Defeitos achados e corrigidos durante a execução:**
- **D1 (agente de testes):** a primeira versão da callable lia o banco 1 s no passado. Recusava perfil, workspace ou membership criados no último segundo e escondia a marca recém-gravada. Agora `t` é o `readTime` da própria leitura do ator, verificado no Emulator; testes §17.9b e §17.9c e 41 esperas artificiais removidas.
- O total do aviso de fechamento era recalculado antes das escritas; passou a vir de `slot.next.totalCents` depois do fechamento.
- A contagem não acompanhava a expiração local de um item carregado; agora é relida quando o relógio local dispara depois de `expiresAt`.
- `axe-core` era usado pela E2E sem estar declarado; entrou como `devDependency` (^4.14.0).
- O axe 4.14 acusa `label-content-name-mismatch` no seletor de mês e no sino, botões que já existiam na árvore base. A spec F aceita só esses dois nós, resolvidos na página, com anotação; a correção exigiria mudar rótulos do cabeçalho (fora do escopo).
- Correlação dos gatilhos e da rotina ausente (achada na revisão de observabilidade); adicionada com teste.
- Na 2ª rodada completa do `verify:all`, a E2E `notifications-retention-d18.spec.ts` (cenário C, linha 610) falhou: ela afirmava `Notificações` sem número, o significado da D-18 (zero entre as carregadas). Na P5-D2 esse rótulo é o estado de carregamento, e o total exato do cenário é 4. Na 1ª rodada a asserção passava por corrida com o carregamento. Ela passou a afirmar "Notificações, 4 não lidas", que é mais forte; o arquivo passou 39/39 em 3 repetições.
- **Corrida de prontidão do E2E (falha da 1ª spec, `ai-chat-isolation`, nas rodadas 4 e 5).** `bootstrapAccount` respondia 404: o Playwright começava a suíte quando a UI do Emulator (`:4000`) respondia, e não quando as Functions estavam registradas. Medido com sondagem: a UI responde cerca de 7 s antes de os callables existirem. Com seis Functions a mais, a P5-D2 alongou essa janela. Correção na configuração do E2E, sem retry nem timeout maior: o servidor dos emuladores só é dado como pronto na linha "All emulators ready!" (`wait.stdout`), impressa depois do registro de todas as Functions. `url` saiu, porque o Playwright resolve `url` e `wait` em corrida; quem já tem os emuladores de pé usa `E2E_START_EMULATORS=false`, como diz o RUNBOOKS.
- `cash-accounts.spec.ts` (versão concorrente do estorno) falhou uma vez, na rodada 4. O backend respondeu o conflito esperado (`concurrent_update`) em 27 ms, mas a tela só sai de "Enviando…" depois de reler contas, movimentos, transferências e dependentes (`onError` → `refresh()`, desenho da P3-J, sem mudança na P5-D2), e essa releitura passou de 12 s com a suíte inteira carregando o Emulator. Isolado, passou 24/24, e passou nas rodadas 1, 2 e 5. Fica registrado como latência do ambiente E2E; mesmo padrão da `loans-pf` na D-18.
- O teste de integração §16.14 falhou uma vez nas validações dirigidas: a busca de palavras proibidas serializava o aviso inteiro, e os nanossegundos de `expiresAt` podem conter "1000000", a mesma sequência do alvo da meta em centavos. Os instantes agora entram como texto ISO e todos os campos continuam verificados. O aviso nunca levou o valor.
- A rotina de recebíveis recomeçava do início a cada execução: com mais de 5.000 recebíveis na janela, os mesmos seriam relidos todo dia e os demais nunca visitados (achado #2 da revisão e item "retomada" do §14). Corrigida com o cursor persistido e a volta na janela; teste §14 de retomada, Rules do documento de cursor e teste de concorrência (entregas simultâneas e duas execuções simultâneas).

**Revisão independente (Opus, somente leitura).** "Aprovado com ressalvas": 0 BLOCKER, 0 HIGH, 1 MEDIUM, 5 LOW, 6 INFO.
- Corrigidos:
  - **#1 (MEDIUM):** os testes de concorrência só verificavam limites. Agora cada resultado é comparado por igualdade com um oráculo calculado exatamente no `asOf` a partir do `createTime` de cada escrita (`asOf` com nanossegundos).
  - **#3:** textos que afirmavam o estado atual reescritos no passado, datados pela detecção.
  - **#4:** caixa indisponível deixava "Tudo certo por aqui!"; o caixa entrou na completude, com teste (`alertsCoverage.integration.test.ts`).
  - **#6:** identidade inválida virava mensagem envenenada; agora é violação de contrato, registrada e não relançada.
  - **#12:** atrasos e recorrentes com ícone de sistema; tipo `warning`.
  - **#11:** escopo em andamento na revisão; a E2E e este plano foram concluídos depois.
  - **#2 (LOW):** a rotina de recebíveis recomeçava do início; agora retoma do cursor persistido e dá a volta na janela.
- Mantido, com justificativa: **#5** (segunda leitura da contagem no foco só quando a primeira página traz evento novo; mantém badge e lista coerentes).
- **Revisão do delta posterior (Opus, somente leitura)** — cursor, correlação, testes novos e ajuste da E2E da D-18. Resultado: "aprovado com ressalvas", 0 BLOCKER, 0 HIGH, 6 LOW e 3 INFO, todos tratados:
  - teste da volta passou a provar o limite superior (`scanned`, `notified` e `existing` exatos);
  - teste de descarte de cursor fora da janela ou malformado;
  - cursor salvo a cada página, com teste de falha injetada na 3ª consulta de página (`mock.method(Query.prototype, "get")`, só a falha é simulada);
  - correlação provada nos quatro gatilhos exportados, chamados com `event.id`;
  - concorrência da rotina afirmando uma única criação nos logs;
  - DATA_MODEL (inventário de `system/{doc}` e campos do cursor), cabeçalho da rotina e OBSERVABILITY (WARN em `truncated` e `runId` repetido na reexecução do Scheduler, registrados como decisão);
  - o marcador de validação deste plano.
- Residuais e decisões: **#2, resíduo** (o orçamento continua de 5.000 por execução: acima de cerca de 35.000 recebíveis abertos e vencidos na janela de 7 dias, somados todos os workspaces, algum pode não ser visitado a tempo; `truncated` é registrado e vira alerta na P7); **#7** (conferência de `readTime` em STAGING); **#8** (ordem de implantação, registrada); **#9** (workspace arquivado mostra "?"; inalcançável pela interface, que não abre workspace arquivado); **#10** (decisões registradas acima).

**Validação final** (Emulator `minhas-financas-local`; nenhum acesso à produção). `verify:all` integral depois da última mudança (2026-10-11, 21:49:25Z → 22:22:50Z, saída 0):
- `verify:fast`: typecheck, lint das Functions, builds do frontend e das Functions e 1.296 unitários (561 das Functions e 735 do frontend); 0 falhas, 0 skips. O lint segue com 202 avisos, nenhum erro e nenhum aviso em arquivo da P5-D2 (os 4 de `deploymentContract.test.ts` estão em linhas anteriores).
- `test:integration:emulator`: 838 de integração das Functions, 17 das ferramentas e 256 de Rules, entre elas 84 de notificações (24 da P5-D1, 37 da D-18 e 23 da P5-D2); 0 falhas, 0 skips.
- `test:e2e`: 158/158 (13,9 min).
- Total: 2.565 testes (2.407 de Node + 158 de E2E), contra a linha de base de 2.371 da D-18 (2.222 + 149). Os 194 a mais são todos novos, sem remoção nem `skip`/`only`:
  - 56 unitários das Functions;
  - 25 unitários do frontend;
  - 81 de integração;
  - 23 de Rules;
  - 9 de E2E.

  Dois testes de contagem parcial foram reescritos para a contagem exata (`notifications-feed`, `notifications-model`), e as asserções antigas de "contagem como mínimo" deram lugar às do total exato.
- Rodadas anteriores, todas registradas:
  - 1ª: 4 falhas da spec F (`label-content-name-mismatch` do axe 4.14, débito anterior), tratadas com a lista restrita.
  - 2ª: 1 falha da asserção da D-18 (corrigida).
  - 3ª: interrompida de propósito, para incorporar a revisão do delta.
  - 4ª: 2 falhas (corrida de prontidão e latência do estorno, descritas acima).
  - 5ª, só E2E: 1 falha (a mesma corrida), que levou à correção da prontidão.
- Também:
  - `git diff --check` limpo (índice temporário);
  - índice real sem nada staged;
  - `npm audit --package-lock-only` idêntico ao da base: 17 vulnerabilidades, as mesmas;
  - prova de remoção em `docs/production/evidence/p5d2/prova-remocao.txt`.
- **Skills de domínio** (escopo P5-D2, itens de milestones posteriores listados com o ID do plano): `financial-domain-integrity`, `firestore-scale-cost-review`, `multi-tenant-security-review`, `privacy-lgpd-data-lifecycle`, `observability-incident-readiness`, `firebase-production-readiness` e `ptbr-product-ui-review`: PASS. `regression-release-gate`: PASS.

**Mutações** (cópia isolada do working tree por `git archive`; repositório conferido por SHA-256 antes e depois; um Emulator por vez). Ao todo, 38 mutantes válidos, 38 mortos por asserção específica, todos restaurados (`docs/production/evidence/p5d2/mutacoes.json`, com a asserção que matou cada um):
- **Unitários das Functions (5):** ID aleatório, workspace fora da identidade, `expiresAt` do relógio da execução, campo extra na entidade, gatilhos sem retry (contrato de implantação).
- **Integração no Emulator (27):**
  - produtores: episódio do recebível pelo dia da execução, janela maior que a retenção, guarda de transição do empréstimo neutralizada, recebido gerando atraso, saldo positivo gerando aviso, nome da pessoa no texto, total da fatura somado de novo, recorrência gerada virando aviso, episódio da meta com o relógio;
  - consulta de relatório gravando notificação; caixa indisponível fora da completude;
  - contagem: `Math.max(0, …)`, limite de 25, arquivada contando, excluída contando, expirado contando, estados de outro workspace, estados de outro sujeito, autorização removida;
  - correlação: gatilho sem `sourceEventId` do evento, rotina sem `runId` do agendamento;
  - retomada: rotina ignorando o cursor salvo, rotina sem a volta na janela, volta sem o limite do cursor, cursor salvo só no fim (execução interrompida perde o progresso);
  - publicação com `set` no lugar de `create`; gatilho de conta sem passar o `event.id`.
- **Rules (1):** viewer com `deleted`.
- **Frontend (5):** indisponível como zero, cache sem uid, cache sem workspace, ação sem releitura da contagem, botão de leitura falsa de volta.
- Inválidos, sem contar: I03, I13 e I15 na 1ª rodada não compilavam (variável ou import sem uso) e foram reescritos. Os mutantes de `receivables.ts` e de correlação foram refeitos sobre a versão final (cursor salvo a cada página).

**E2E** (`e2e/notifications-p5d2.spec.ts`, 9 testes):
- **A:** dois usuários, o mesmo evento, contagem exata por pessoa acima de 25 e exclusão só para quem excluiu.
- **B:** viewer vê, arquiva (a contagem cai) e não exclui; eventos reais sem valor nem nome.
- **C:** meta concluída pela interface gera exatamente uma notificação; painel e contagem refletem sem recarregar.
- **D:** Relatórios sem botão de leitura; o aviso persistente grava o estado privado oficial.
- **E:** outro workspace e outra conta nunca herdam contagem nem lista.
- **F (4 combinações):** desktop e celular, claro e escuro; badge com número, "9+" e "?", painel, link, relatório, teclado, axe e rolagem horizontal 0.
- As specs da D-18 e do estado privado passaram a afirmar a contagem exata (mais forte, não mais fraca).

**Evidência visual.** `docs/production/evidence/p5d2/` (24 capturas no antes, 28 no depois, relatórios e `diferencas-pixels.txt`): sino e painel com 0,00% a 0,33% de diferença (rótulo e chip com o total); Relatórios com as mudanças pedidas; estado "?" novo.

**Custo.**
- Gatilhos: 1 invocação por escrita no documento observado e 1 `create` só na transição; nenhuma leitura extra.
- Rotina de recebíveis: 1 consulta paginada por dia (até 25 páginas de 200), 1 tentativa de `create` por recebível visitado, 1 leitura do cursor e até 26 escritas dele (uma por página e uma final). *Substituído na P5-D2.1 (§20.10, `evidence/p5d21/custos.md`).*
- Contagem: 3 leituras de autorização na pré-checagem, 1 leitura e 1 escrita do limite, 3 leituras na releitura e 1 leitura por bloco de até 1.000 entradas de índice em cada agregação.

**Riscos e pendências.**
- TTL não publicado (E-07): nada é removido fisicamente até a ativação; a ocultação vale na interface e na contagem.
- Perda de entrega depois de 24 h de falhas contínuas do Eventarc: detectável por reconciliação (P7), não por alerta de notificação.
- Rotina de recebíveis acima de cerca de 35.000 recebíveis vencidos e abertos na janela de 7 dias (todos os workspaces): algum pode não ser visitado a tempo (resíduo do #2; `truncated`, alerta na P7). *Substituído na P5-D2.1 (§20.10): o trabalho não visitado segue na fila e é processado nas execuções seguintes.*
- `readTime` em produção a conferir em STAGING.
- `npm audit`: 17 vulnerabilidades preexistentes (11 altas, 2 críticas); `axe-core` não aparece entre elas.
- Decisões pendentes acima; D-18 geral aberta para as demais categorias; lista da P7 inalterada.

**Rollback.** Reverter o diff da P5-D2 sobre `7c3913f6`: `functions/src/notifications/` (contrato, builder, IDs, publicação, produtores e contagem), `cards/closing.ts`, `reports/report.ts`, `runtimeOptions.ts`, exports de `index.ts`, os índices novos de `firestore.indexes.json`, o frontend de notificações e Relatórios, `axe-core` no `package.json`, testes, E2E e documentação. Sem dado real: nada a migrar. Nada foi publicado.

**Estado.** P5-D2 implementada — aguardando auditoria independente. PR-RPT-04 resolvido na P5-D2 e PR-NOTIF-01 tecnicamente resolvido, ambos aguardando auditoria; ativação do TTL pendente (E-07). P5-E, P5-F e o gate da P5 não iniciados; marco P5 não concluído.

### 20.10 P5-D2.1 — avisos de recebível vencido sem limite de dias: cobertura integral, recuperação durável, idempotência e escala (2026-10-12)

Sobre a árvore da P5-D2 (`2ddcd26f`, ZIP `3fcd7824…3eee6`; HEAD `f0c172b`, branch `integration/p4-finalization-2026-10-08`), conferida com índice Git temporário antes de qualquer alteração; o índice real termina sem nada staged. Sem commit, push, merge ou deploy; nada publicado (Rules, índices e Functions só no repositório). Escopo: só o produtor `receivable_overdue` e a integração mínima nas operações de recebíveis. Sem tipo de alerta novo, sem envio externo, sem mudança de interface. Fora do escopo, sem alteração: os demais produtores, P5-E, P5-F, P6–P10 e as decisões pendentes da §20.9.

**Decisão (D-42, §9.4, aprovada pelo usuário).** Todo recebível `open`, com `balanceCents > 0`, `dueDate` válida e anterior a hoje (dia civil de São Paulo) recebe um aviso `receivable_overdue` por episódio (`dueDate`), sem limite de dias e sem reemissão depois do TTL de 180 dias do aviso. Substitui a decisão nº 1 da P5-D2 e a janela [hoje − 7, hoje − 1] (§20.9, preservada como histórico).

**Problemas corrigidos (não só removendo o filtro):**
- **A** — vencido há mais de 7 dias nunca avisava: a elegibilidade não tem janela; o trabalho nasce com o recebível, na mesma transação.
- **B** — falha de publicação deixava o cursor avançar: não há cursor persistido; o item só sai da fila no commit que grava aviso e confirmação; a falha fica registrada no próprio item.
- **C** — deduplicação pela existência do aviso (o TTL apaga): confirmação durável por episódio, sem TTL.
- **D** — escala: a rotina revisitava os já avisados todo dia; agora o item concluído sai da fila e o histórico nunca é lido.

**Arquitetura** (checkpoint antes do núcleo; detalhe em [DATA_MODEL.md](DATA_MODEL.md) §4.7 e §7):
- **Descoberta (atômica com o domínio).** As 5 operações de recebíveis (`create`, `update`, `receive`, `reverseReceipt`, `cancel`) chamam `syncReceivableOverdueWork` (`functions/src/notifications/producers/receivableQueue.ts`) na mesma transação, depois de gravar o recebível e sem leitura extra.
  - Forma elegível (aberto, saldo > 0, vencimento válido): `set` de `workspaces/{ws}/receivable_overdue_queue/{receivableId}` com `runAfterDay = max(vencimento + 1, dia civil da operação)` (`dueQueueDay`). Vencimento futuro espera o dia seguinte; vencimento já passado entra no dia da operação, sem furar a fila de quem já esperava.
  - Fora da forma (recebido, cancelado, saldo zero): `delete`.
  - Só escreve quando muda a forma ou o vencimento; recebimento parcial que mantém o aberto e edição só da descrição não escrevem (preservam tentativas e backoff).
  - A passagem do tempo não exige escrita. Nenhum gatilho pós-commit, logo nenhuma janela de 24 h do Eventarc.
- **Processamento.** `processReceivableOverdueNotifications`, a cada 60 min (`America/Sao_Paulo`): `collectionGroup("receivable_overdue_queue")` com `runAfterDay <= hoje`, ordenado por `runAfterDay` e `__name__`, páginas de 100 com cursor só dentro da execução. Uma transação por item lê item e recebível, depois confirmação e aviso, todos antes de qualquer escrita, e revalida pelo leitor autoritativo com o workspace do caminho:
  - item sumiu → nada;
  - recebível inexistente → remove o item (recebíveis nunca são apagados: sem fonte de verdade, não há aviso);
  - recebido, cancelado ou sem saldo → remove o item;
  - fora do contrato → não publica, mantém o item com backoff (`receivable_invalid`);
  - ainda não venceu → reagenda para o dia seguinte ao vencimento atual;
  - confirmação do episódio existe → remove o item;
  - aviso existe sem confirmação (publicação anterior da P5-D2) → grava só a confirmação (`origin: reconciled`) e remove o item, sem regravar o aviso (`createdAt` e `expiresAt` preservados);
  - caso contrário → `create` do aviso + `create` da confirmação + `delete` do item, no mesmo commit.
- **Recuperação.** Falha da transação: `update` do item fora dela, com pré-condição de versão (`lastUpdateTime`, para não sobrescrever um episódio novo gravado pelo domínio), registrando `attempts + 1`, `lastErrorCode` tipado e o próximo dia. Falha não transitória: próxima execução e depois 1, 2, 4 e 7 dias. Falha transitória (`unavailable`, `timeout`, `contention`, `resource_exhausted`, `internal`): volta a cada execução horária nas 6 primeiras tentativas e depois uma vez por dia. Nunca descarta por tentativas; WARN de falha persistente a partir da 5ª tentativa (7ª nos transitórios). Se o registro também falhar, o item continua devido. Falha transitória dentro da transação é repetida antes pelo SDK (até 5 tentativas, medido).
- **Capacidade e justiça.** A capacidade é limitada pelo tempo e por um teto de 200 páginas por execução (até 20.000 itens lidos; com transações rápidas, é o teto que limita), não por um número pequeno de itens: novas páginas até 420 s, novos itens até 480 s (parada rígida por item; o resto fica devido), tempo limite 540 s, `maxInstances: 1`, 10 transações simultâneas. Justiça em duas passadas: na 1ª, cada workspace processa no máximo 500 itens e, esgotada a cota, o cursor salta o restante desse workspace no mesmo dia (`startAfter(runAfterDay, workspaces/{ws}/receivable_overdue_queue/\uf8ff)`), sem índice novo; se a 1ª passada chega ao fim da fila e ainda há tempo e páginas, a 2ª recomeça sem cota e atende o excedente na ordem da fila, sem repetir o que a execução já tratou. Nenhum workspace espera o excedente de outro, e a capacidade ociosa não fica parada. Volume concentrado num workspace só atrasa os avisos dos demais quando a capacidade inteira se esgota; não há perda, duplicidade nem efeito financeiro.
- **Idempotência e concorrência.** ID determinístico do aviso (o mesmo da P5-D2) e da confirmação. Dois workers, retry do Scheduler, resposta perdida depois do commit e quitação concorrente se resolvem pela serialização da transação: o segundo encontra o item removido ou a confirmação.
- **Dia civil.** `today` = dia de São Paulo do mesmo instante que carimba o aviso (`saoPauloDayKey`), sem offset fixo.
- **Retenção.** Fila: só enquanto há trabalho, inclusive a espera até um vencimento futuro (até 10 anos, pelo contrato do recebível). Confirmação: sem TTL, vinculada ao recebível (nunca apagado), eliminada com o workspace (P8). Ambas só com identificadores e datas ([DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md)).
- **Workspace arquivado:** publica (o fato ocorreu; precedente de recorrentes; leitura pelas Rules da D-18).
- **Recebíveis anteriores à P5-D2.1:** não há dado real (política de legado do §1); dados de desenvolvimento e teste são recriados por seed ou Emulator, sem backfill.

**Removido (legado substituído):** janela de 7 dias (`RECEIVABLE_OVERDUE_ALERT_DAYS`), consulta de grupo sobre `receivables` e o seu índice composto (`schemaVersion`/`status`/`dueDate`), cursor global `system/receivable_overdue_notifications` e os 3 testes do cursor (substituídos pelos de fila e recuperação). Prova em `docs/production/evidence/p5d21/prova-remocao.txt`; o caminho antigo segue negado pelas Rules (teste).

**Segurança.** As duas coleções entraram em `isBackendOwnedCollection` (sem isso, a regra genérica de subcoleção daria leitura a qualquer membro) e têm blocos `allow read, write: if false`. Teste de Rules: owner, admin, member, viewer, removido, suspenso, outro workspace, sem autenticação e workspace arquivado, em leitura, listagem, contagem, criação, alteração de tentativas e de próxima tentativa, marca de entrega forjada e remoção de confirmação; consulta de grupo e caminho antigo negados; dados intactos depois das tentativas. Integração: item forjado em outro workspace não lê nem publica fora do caminho. Risco residual de capacidade compartilhada registrado no [THREAT_MODEL.md](THREAT_MODEL.md) (T-23).

**Domínio financeiro.** Valores, saldos, recebimentos, estornos, caixa, projeção, ledger, quota e limite operacional inalterados; a transação financeira só ganhou a escrita do item (estado operacional). Teste de domínio intocado (instantâneo byte a byte, sem as coleções operacionais) e reconciliação do ledger.

**Defeito achado e corrigido durante a execução.** O benchmark do código final, com um cenário concentrado novo (90% dos itens num workspace), mostrou que a cota fixa por execução não aproveitava a capacidade ociosa: 18.000 itens de um único workspace levavam 36 execuções (36 horas) com a fila vazia de resto, e os itens adiados pela cota eram relidos a cada execução (cerca de 19 leituras por aviso). A cota passou a valer só na 1ª passada; a 2ª atende o excedente com o tempo que sobra, sem repetir o que a execução já tratou (testes §15.35, §15.37 e §15.38; mutantes M48–M51).

**Contrato do aviso** inalterado: tipo, domínio, link, campos de entidade, textos em pt-BR datados pela detecção, sem nome, valor ou descrição; ID determinístico da P5-D2.

**Observabilidade** ([OBSERVABILITY.md](OBSERVABILITY.md) §2.11). Resumo de toda execução com `runId`, contadores (`published`, `alreadyDelivered`, `reconciled`, `closed`, `rescheduled`, `invalid`, `gone`, `failed`, `persistentFailures`, `retriedSameDay`, `retryNotRecorded`, `deferred`, `throttled`), `pendingDueAtEnd` (`count()`, nula se falhar, sem virar erro estrutural), `backlog` e `outcome` (`idle`, `drained`, `backlog`, `recoverable_failures`, `structural_error`). Por item, só IDs e códigos. Alerta de backlog e de falha persistente: P7.

**Testes** (todos no Emulator `minhas-financas-local`):
- `receivableOverdue.integration.test.ts` (novo, 56): §15.1–§15.41 (cobertura sem limite de dias, fronteiras do dia, parcial, quitado, cancelado, mudanças de vencimento, estornos, reexecução, falhas transitórias e não transitórias, persistência, fila retroativa, contagem falha, parada rígida no início e no meio da página, cancelamento e quitação durante o processamento, replay, justiça entre workspaces em duas passadas (ordem de atendimento, 2ª passada sem repetir falha e sem começar fora do tempo, salto na fronteira da página, salto só no mesmo dia e workspace), backlog com falha transitória e com contagem falha, invariante de cobertura depois de sequências de operações, fora do contrato, item malformado, workspace arquivado, isolamento A/B, dia civil às 22h30), §10 (deduplicação depois do TTL: aviso apagado 181 dias depois, sem reemissão), §14 (domínio intocado), §16.2–§16.5 (resposta perdida, dois workers, corrida real com quitações, backlog multi-workspace, reconciliação de aviso da P5-D2), §11 (custo instrumentado), §18 (sinais) e §17 (declaração de índice e Rules).
- `receivableQueue.test.ts` (novo): tabela de decisão da sincronização, ordem da fila, guarda estática (lista fechada de arquivos que referenciam `receivables`; 5 escritas em `operations.ts`, cada uma seguida da sincronização; reconhecimento dos padrões).
- `producers.test.ts`: limites, backoff por classe, limiar de persistência, códigos de erro.
- `producers.integration.test.ts`: §16.8 reescrito para "sem limite de dias" (−1, −7, −8, −30); reexecução, §16.12, §16.17, §16.19, §16.20 e concorrência pelas asserções de fila e confirmação; os 3 testes do cursor removidos com o cursor.
- `notifications-p5d2.rules.integration.test.mjs`: matriz de negação das duas coleções.

**Revisão independente (Opus, somente leitura), em três rodadas** (registro em `docs/production/evidence/p5d21/revisao-independente.md`):
- **Rodada 1** (`2ddcd26f` → `e530c5e3`): "aprovável com ressalvas", 0 BLOCKER, 0 HIGH, 1 MEDIUM, 5 LOW, 7 INFO.
  - **M1 (MEDIUM):** vencimento retroativo furava a fila global. Corrigido com `dueQueueDay`; teste §15.23.
  - **L1:** recebíveis anteriores à milestone não entram na fila; documentado (sem backfill pela política de legado).
  - **L2:** nada impedia um escritor novo de `receivables` sem sincronizar a fila; guarda estática.
  - **L3:** falha do `count()` final virava erro estrutural; contagem isolada, WARN próprio (§15.24).
  - **L4:** desfecho de falha escondia o backlog; campo `backlog` e WARN persistente também para fora do contrato (§15.25).
  - **L5:** backoff em dias para falha transitória; volta horária nas 6 primeiras tentativas (§15.10b).
  - **INFO:** parada rígida por item (I1, §15.26), JSDoc órfão (I4), contagem de testes (I5), retenção da espera (I6) corrigidos; I2, I3 e I7 registrados.
- **Rodada 2** (delta `e530c5e3` → `74e8e46b`): "aprovável com ressalvas", 0 BLOCKER, 0 HIGH, 1 MEDIUM, 2 LOW, 7 INFO.
  - **D1 (MEDIUM):** resíduo de M1 — capacidade fixa de 2.000 itens por execução, sem justiça entre workspaces. Corrigido: capacidade limitada por tempo (até 200 páginas), cota de 500 por workspace com salto do cursor (§15.35), risco residual no THREAT_MODEL e no INCIDENT_RESPONSE.
  - **D2 (LOW):** `backlog` confundia falha transitória com backlog de capacidade; contador `retriedSameDay` e `backlog` nulo quando desconhecido (§15.36).
  - **D3 (LOW):** falsos negativos da guarda; guarda ampliada e invariante de cobertura no Emulator (§15.34).
  - **INFO:** janela da meia-noite e datas fixas nos testes (dia relativo), WARN persistente dos transitórios na 7ª tentativa, parada no meio da página (§15.26b), comentário, reuso de `todayOf` e este §20.10 corrigidos; §16.3b registrado como teste de fumaça (a corrida forçada está nos testes de falha injetada entre leitura e commit).
- **Rodada 3** (`74e8e46b` → `568d380c`, com as duas passadas; confirmação em `18dedc9d`): "não aprovável" de início, 0 BLOCKER, 1 HIGH, 3 LOW, 5 INFO; "aprovável" depois das correções, sem defeito funcional novo.
  - **R3-1 (HIGH):** o salto do cursor sem leitura não ligava a cota esgotada; quando o 500º item de um workspace fechava uma página cheia (workspace único ou primeiro na ordem, como numa importação de vencidos), a 2ª passada não rodava e voltavam 500 itens por execução. Corrigido; teste §15.39; mutante M52.
  - **LOW:** salto testado só com dias distintos (§15.40 no mesmo dia, mutante M53); margem curta do §15.26b (2.000 ms); guarda estática sem `` collection(`…/receivables`) `` (padrão ampliado, comentários ignorados, rótulo de classificação "receivables" listado com justificativa).
  - **INFO:** semântica de `scanned` e `throttled` documentada, comentários alinhados (com transações rápidas, é o teto de 200 páginas que limita), contagem falha com orçamento esgotado testada (§15.41); prioridade estática pelo ID do workspace no mesmo dia e ausência de prazo por chamada ao Firestore registradas como risco residual.

**Validação final** (Emulator `minhas-financas-local`; nenhum acesso à produção). `verify:all` integral depois da última mudança (2026-10-12, 09:28:38Z → 10:14:31Z, saída 0):
- `verify:fast`: typecheck, lint das Functions (0 erros; 202 avisos, os mesmos da base, nenhum em arquivo da P5-D2.1), builds do frontend e das Functions; 573 unitários das Functions e 735 do frontend; 0 falhas, 0 skips.
- `test:integration:emulator`: 891 de integração das Functions, 17 das ferramentas e 256 de Rules (84 de notificações); 0 falhas, 0 skips.
- `test:e2e`: 158/158 (18,2 min).
- Total: 2.630 testes (2.472 de Node + 158 de E2E), contra a linha de base de 2.565 da P5-D2. Os 65 a mais: 12 unitários das Functions (3 em `producers.test.ts`, 9 em `receivableQueue.test.ts`) e 53 de integração (56 novos em `receivableOverdue.integration.test.ts`, menos os 3 do cursor removido). No arquivo de Rules da P5-D2, o teste do cursor `system/receivable_overdue_notifications` deu lugar ao da P5-D2.1, que nega as duas coleções novas a todos os papéis e continua negando o caminho antigo (a contagem de Rules não muda). Sem `skip`/`only`; nenhuma asserção antiga enfraquecida (o §16.8 passou a exigir aviso também em −8 e −30 dias).
- Rodada anterior, registrada: o 1º `verify:all` parou em `test:unit:notifications` (1 falha em `tests/unit/notifications-guard.test.ts:108`). A guarda exige que `isBackendOwnedCollection` termine em `'notifications', 'notification_user_states'`, e as coleções novas tinham entrado depois delas. As coleções foram movidas para antes, sem mudança de semântica e sem tocar o teste; os 3 mutantes de Rules foram refeitos.
- Também: `git diff --check` limpo (índice temporário); índice real sem nada staged; `package.json`, lockfiles, `src/` e `e2e/` intocados (`npm audit` idêntico ao da base); prova de remoção regenerada (`evidence/p5d21/prova-remocao.txt`).
- **Skills de domínio** (escopo P5-D2.1; itens de milestones posteriores listados com o ID do plano em `evidence/p5d21/VEREDITOS.md`): `financial-domain-integrity`, `firestore-scale-cost-review`, `multi-tenant-security-review`, `privacy-lgpd-data-lifecycle`, `observability-incident-readiness`, `firebase-production-readiness` e `ptbr-product-ui-review`: PASS. `regression-release-gate`: PASS.

**Mutações** (cópia isolada do working tree por `git archive` com índice temporário; arquivos-alvo conferidos por SHA-256 na cópia e no repositório antes e depois; um Emulator por vez; `docs/production/evidence/p5d21/mutacoes.json`, com o teste que matou cada um). Rodada final sobre a árvore final (`8343761a`, Functions; os 3 de Rules refeitos em `c856f9ea`, depois da reordenação da lista de coleções do backend): **53 mutantes válidos, 53 mortos, 0 sobreviventes, 0 inválidos**, todos restaurados:
- **Integração no Emulator (42):**
  - cobertura e episódio: janela de 7 dias reintroduzida, cadastro já vencido sem enfileirar, vence hoje já avisa, episódio pelo dia de detecção, dia em UTC;
  - recuperação: falha remove o item, falha empurra a tentativa para nunca, descarte depois de 5 tentativas, fora do contrato descartado, registro da falha sem pré-condição de versão;
  - idempotência: publica sem confirmação, deduplicação pela existência do aviso, confirmação com `expiresAt`, confirmação sem o aviso, publicado continua na fila, reconciliação que regrava o aviso, dois workers sem revalidar;
  - domínio: quitação ou cancelamento sem retirar o trabalho, worker sem revalidar status e saldo, saldo comparado errado, recebimento parcial que reescreve o trabalho, edição que ignora o novo vencimento, estorno que não devolve o trabalho, worker que grava no recebível;
  - isolamento e privacidade: workspace tirado do conteúdo do item, confirmação com a descrição;
  - capacidade e justiça: cursor da execução removido, parada depois da primeira página, parada rígida ignorada, sem cota por workspace, cota sem o salto do cursor, sem a 2ª passada, 2ª passada repetindo itens já tratados, 2ª passada ignorando o orçamento de tempo, 2ª passada interrompida sem sinalizar orçamento esgotado, salto na fronteira da página sem acionar a 2ª passada (R3-1), salto pulando o dia inteiro (R3-2);
  - observabilidade: erro estrutural engolido, desfecho sem sinalizar fora do contrato, falha da contagem como erro estrutural, backlog escondido pelo desfecho, fora do contrato persistente sem o WARN.
- **Unitários (7):** primeiro dia de atraso igual ao vencimento, cancelado com saldo elegível, backoff que nunca cresce, fila retroativa sem o dia do enfileiramento, falha transitória com backoff em dias, transitória persistente já na 5ª tentativa, cancelamento sem sincronizar a fila (guarda estática).
- **Rules (3):** fila fora de `isBackendOwnedCollection`, confirmação legível por membro, cliente gravando trabalho pendente.
- **Estático (1):** TTL declarado sobre as confirmações.
- Rodadas anteriores, registradas: a 1ª e a 2ª foram interrompidas (correção do harness, que deixava `node --test` órfão contra o Emulator seguinte); a 2ª revelou M05, M06 e M12 sem compilar (reescritos) e M09 sobrevivente (teste §15.33 adicionado). Na 3ª (47 mutantes, árvore anterior às duas passadas), M14, M20 e M21 não compilaram depois das correções da rodada 2 de revisão (variável sem uso e código inalcançável) e foram reescritos e mortos na 4ª. A 5ª refez todos sobre a árvore final, com M48–M53 novos.

**Escala e custo** (`docs/production/evidence/p5d21/escala.json`, `custos.md` e `LEIAME.md`; rotina final contra o Emulator, até a fila esvaziar; 10 workspaces, vencimentos de ontem a 3 anos atrás, 1% fora do contrato, histórico de até 10.000 episódios já entregues):

| Recebíveis | Execuções | Publicados / esperados | Conjunto de IDs | Leituras por aviso | Execução ociosa |
| --- | --- | --- | --- | --- | --- |
| 100 | 2 | 99 / 99 | igual | 5,1 | 2 leituras |
| 1.000 | 2 | 990 / 990 | igual | 5,1 | 2 leituras |
| 5.000 | 2 | 4.950 / 4.950 | igual | 5,1 | 2 leituras |
| 10.000 | 2 | 9.900 / 9.900 | igual | 5,5 | 2 leituras |
| 50.000 | 9 | 49.500 / 49.500 | igual | 7,2 | 2 leituras |
| 20.000 concentrados num workspace | 3 | 19.800 / 19.800 | igual | 7,0 | 2 leituras |

- Por aviso publicado: 5 leituras (consulta, item, recebível, confirmação, aviso) e 3 escritas num commit; nenhuma leitura proporcional ao histórico (execução ociosa: 2 leituras; 48 por dia).
- Operações de domínio: no máximo 1 escrita extra na mesma transação, nenhuma leitura extra.
- Teto por execução: 20.000 leituras de consulta (200 páginas), 10 transações simultâneas; os fora do contrato ficam na fila com backoff, sem bloquear os demais.
- No cenário concentrado, os 9 workspaces leves foram atendidos por inteiro já na 1ª execução.

**Riscos e pendências.**
- Capacidade compartilhada: volume concentrado num workspace só atrasa os avisos dos demais quando a capacidade inteira da execução se esgota (cota de 500 na 1ª passada; só atraso). Com mais de cerca de 33 workspaces, cada um com 500 ou mais itens devidos no mesmo dia, o teto de 200 páginas se esgota e a prioridade no mesmo dia é estática pelo ID do workspace (espera limitada a cerca de max(nᵢ)/500 execuções). Alerta de `backlog` persistente e runbook de contenção: P7.
- Sem prazo por chamada ao Firestore: uma transação iniciada até 480 s, com as repetições do SDK, mais o `count()` final, pode passar de 540 s com o Firestore degradado; o trabalho não concluído segue devido.
- Commit do domínio intercalado entre as leituras e o commit do worker: coberto pela serialização do Firestore e pelos testes de item obsoleto e de quitação durante o processamento.
- Mesma data devida: ordem pelo caminho (workspace e ID); atrasa no máximo uma execução enquanto o volume couber na capacidade.
- Execução que atravessa a meia-noite usa o dia do início no texto do aviso; sem efeito de correção.
- Recebíveis anteriores à P5-D2.1 não estão na fila (sem dado real; sem backfill).
- Índice de grupo de `runAfterDay` precisa estar implantado antes da Function (ordem de implantação, [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md)); sem ele, a rotina sai em `structural_error` sem tocar a fila.
- Pendências da §20.9 inalteradas (TTL E-07, `readTime` em STAGING, decisões pendentes); lista da P7 ampliada só com o alerta de backlog desta rotina.

**Rollback.** Reverter o diff da P5-D2.1 sobre `2ddcd26f`: `receivableQueue.ts`, `receivables.ts`, as 5 chamadas em `receivables/operations.ts`, as duas coleções nas Rules, o override de `runAfterDay` (e a volta do índice de grupo de `receivables`), o comentário de `index.ts`, os testes, a evidência e a documentação. Sem dado real a migrar; a fila e as confirmações de teste são descartáveis. Nada foi publicado.

**Estado.** P5-D2.1 implementada — aguardando auditoria independente. D-42 implementada; PR-NOTIF-01 segue tecnicamente resolvido e aguardando auditoria; ativação do TTL pendente (E-07). P5-E, P5-F e o gate da P5 não iniciados; marco P5 não concluído.

### 20.11 P5-E1 — Consolidação da Inteligência Artificial: autoridade financeira, segurança, privacidade e extração estruturada (2026-10-12)

**Base.** Árvore da P5-D2.1 (`91ed2c58`, ZIP `23dee767…e7e2`; HEAD `f0c172b`). Foi conferida com um índice Git temporário antes de qualquer alteração. O índice real termina sem nada staged.

**O que não foi feito:**
- Sem commit, push, merge, rebase, reset, tag ou deploy.
- Nada publicado: Rules, índices e `firebase.json` inalterados em relação à base.
- Nenhum segredo lido, criado ou alterado.
- Nenhuma chamada real ao Google nas suítes.

**Fora do escopo, sem alteração:** Mensagens (D-09, só na P5-E2), P5-F, P6–P10, rebranding, planos e preços, arquitetura financeira e novo provedor.

**Decisões aprovadas pelo usuário (§9.4):**
- **D-11.1:** contexto financeiro autoritativo do backend.
- **D-11.2:** provedor Google mantido, com verificação documental do modelo, do SDK, da API, dos termos e das garantias.
- **D-11.3:** transparência e ação afirmativa antes de cada envio, minimização e controles específicos para documento e voz.
- **D-11.4:** resposta validada estruturalmente, contrato de créditos preservado e nenhuma gravação financeira automática.
- **D-09:** remoção de Mensagens aprovada, mas executada só na P5-E2.

**Problemas corrigidos:**
- **PR-AI-05, contexto forjável.** O navegador montava KPIs, categorias e alertas, e o backend os repassava ao modelo.
- **PR-AI-05, saída sem schema.** A extração devolvia JSON livre, aplicado ao formulário por `any` e com correspondência aproximada de categoria. O tipo `parcelado` era aceito.
- **Sem transparência nem ação afirmativa.** Nada avisava antes de enviar ao provedor: pergunta, comprovante e transcrição saíam direto.
- **SDK legado.** `@google/generative-ai`, sem suporte desde 2025-11-30, sem instrução de sistema separada, sem tempo limite e sem schema de resposta.
- **Mensagens erradas.** "Verifique sua chave API" aparecia ao usuário, e falhas do provedor chegavam como erro interno genérico.

**Arquitetura** (checkpoint antes do núcleo; detalhe em [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY_MODEL.md](SECURITY_MODEL.md) e [PRIVACY_LGPD.md](PRIVACY_LGPD.md)):

- **Consultor (`analyzeFinancialQuestion`).** O payload é estrito: só `workspaceId`, `idempotencyKey`, `question` (3 a 2.000 caracteres), `range` (contrato dos Relatórios) e `providerConsent`. Ordem de execução:
  1. Contrato e pré-checagem do kernel.
  2. Confirmação de envio.
  3. Segredo.
  4. Transação de contexto: relê conta, workspace, membership e papel na matriz da IA, e reserva o limite próprio de leitura (60 por hora por ator e workspace).
  5. `executeGetFinancialReport`: mesma fonte e mesmo cálculo dos Relatórios, com o papel relido, sem série e sem o ranking de clientes (`omitTopClients`).
  6. Contexto mínimo e partes do pedido, montados antes da admissão.
  7. `admitAiCall`, inalterada.
  8. Provedor.
  9. Validação da resposta.

  O que vai ao modelo:
  - centavos inteiros formatados por aritmética inteira, e pontos-base;
  - cobertura por bloco: "indisponível" nunca vira zero, e dívidas sem obrigações de cartão nunca saem "completo" nem "sem movimento";
  - nenhum ID, nome de cartão, descrição, contraparte, cliente ou e-mail;
  - até 5 categorias, como rótulo não confiável;
  - patrimônio só com `permissions.investments` do relatório.
- **Extração (`extractTransactionFromContent`):**
  - Payload estrito por `kind`.
  - Assinatura do arquivo (bytes iniciais) conferida antes da admissão.
  - `responseJsonSchema` revalidado por Zod estrito.
  - Cada campo volta como `identified`, `missing`, `invalid` ou `ambiguous`, e o resultado como `complete`, `partial` ou `refused`.
  - Valor por string decimal → BigInt, com ausente ≠ zero.
  - Datas existentes, de 2000-01-01 até hoje + 366 (São Paulo).
  - Sem `parcelado`: só `installments` como intenção.
  - Nada é gravado.
- **Confirmação de envio:**
  - Formato `{version: "ai-provider-share-v1", operation, confirmed: true}`.
  - Ausente ou de outra operação: `ai_consent_required` antes de qualquer leitura, crédito, limite ou chamada ao provedor.
  - É controle técnico, **não** consentimento LGPD (P8, PR-AI-01).
- **Prompt injection:**
  - A instrução de sistema é fixa, fica no backend e vai separada dos dados (`systemInstruction` × `contents`).
  - Pergunta e categorias são marcadas como dado não confiável.
  - A autoridade não depende do modelo: sem ferramentas e sem escrita; a saída é validada e exibida como texto.
  - Matriz em `evidence/p5e1/matriz-prompts.md`.
- **Provedor.** Verificação documental em `evidence/p5e1/provedor-referencias.md` ([D] lido direto, [B] por busca, a conferir ao vivo):
  - SDK `@google/genai ~2.28.0`.
  - Tempo limite de 90 s, abaixo dos 120 s da callable.
  - Sem repetição automática do SDK.
  - `thinkingLevel: LOW`; tetos de saída de 2.048 e 1.024 tokens.
  - `MAX_TOKENS` anexa aviso de resposta interrompida.
  - Erros classificados sem a mensagem do SDK.
  - Modelo `gemini-3-flash-preview` mantido. A troca para um modelo GA é decisão pendente: exige conferência ao vivo e avaliação em STAGING.
  - Chave só no Secret Manager (`secrets`). Rotação **não** executada (PR-AI-02/E-00).
- **Créditos:**
  - Política P2B.2 preservada (`admission.ts` sem diff).
  - Recusas antes da admissão não cobram.
  - Falha depois da admissão não devolve o crédito, com mensagem pt-BR transparente (`ai_provider_failed`).
- **Frontend.** Mudança mínima de UI, só onde o contrato exigia:
  - `AiShareConsentDialog`, acessível (foco preso, Escape, `aria`), com 4 variantes.
  - Chat com confirmação por pergunta e chave nova na confirmação.
  - Modal com validação local do arquivo, voz em duas confirmações, confirmação presa ao escopo em que abriu, token de escopo e trava de duplo envio.
  - Preenchimento só dos campos `identified`; categoria por igualdade normalizada; compra no cartão continua no cartão; toda troca de aba é avisada.
  - Sem salvamento automático.
  - Cliente com tempo limite de 125 s e uma única repetição, só em `unavailable` ou falha de rede, com a mesma chave.

**Removido:**
- `@google/generative-ai`;
- `buildPrompt` e o contexto montado pelo cliente (`FinancialQuestionContext`);
- `applyAIData(any)` e a correspondência aproximada de categoria;
- a mensagem "Verifique sua chave API";
- os `console.error` com objeto de erro da IA.

Busca no código: só restam a guarda negativa `tests/unit/ai-backend-only.test.ts` e o comentário histórico em `gateway.ts`.

**Testes** (Emulator `minhas-financas-local`; provedor falso injetado; nenhuma chamada real ao Google):
Os casos dos §13 a §16 do pedido estão cobertos, rastreáveis pelos IDs:

- **§13, segurança:** `aiSecurity.integration.test.ts`, 28 testes. Cobre S01–S26 e também C03 (segredo ausente), C04/C05 (intenção duplicada, concorrente e reenviada), C07 (membership perdida ou rebaixamento entre a pré-checagem e o contexto, com barreira real), C12/C13 (falha do relatório ou do contexto), C14 (limite de leitura de contexto) e C15 (tipo de arquivo falso).
- **§14, extração:**
  - `extraction.test.ts`, 25 testes: schema estrito, chaves desconhecidas, valor por BigInt, ausente ≠ zero, teto, precisão, datas inexistentes e fora da faixa, parcelas, descrição, ambíguos, recusado, parcial e completo;
  - testes de partes e assinatura em `callables.test.ts`;
  - `ai-extraction-form.test.ts`, novo no `test:unit:billing`;
  - E2E de documento e de voz.
- **§15, contexto:** `aiContext.integration.test.ts`, 22 testes. Cobre X01–X29, com oráculo à mão e lista fechada de campos (`ALLOWED_SHAPE`), e inclui falha real do leitor de cartões (código gRPC 14).
- **§16, créditos:** `aiCredits.integration.test.ts`, 30 testes, adaptados ao contrato novo, mais C03–C15.
- **Unitários:**
  - `callables.test.ts`, 23 testes: contrato, confirmação, partes do pedido, gateway real com SDK falso, `MAX_TOKENS` e falha sem a mensagem;
  - `analysisContext.test.ts`, 31 testes;
  - no frontend: `ai-client.test.ts`, `ai-chat-history.test.ts` e `ai-backend-only.test.ts`.
- **E2E:**
  - `ai-consent-extraction.spec.ts`, novo, 11 testes: diálogos, teclado, axe, 360 px, HTML como texto, erros pt-BR, documento, voz em duas etapas e descarte por troca de aba ou fechamento;
  - `ai-chat-isolation.spec.ts`, atualizado, 2 testes.

**Mutações** (`evidence/p5e1/mutacoes.json`; cópia isolada do working tree por índice temporário, arquivos-alvo conferidos por SHA-256 antes e depois, Emulator em portas próprias):
Duas rodadas registradas em `mutacoes.json`:

- **Rodada 1:** 37 mutantes válidos.
- **Rodada final, sobre a árvore final:** 42 mutantes sobre a árvore `6fca66bc`, 41 mortos (cada morte conferida no log por uma asserção que falhou) e 0 inválidos. As âncoras de F01 e F02 foram atualizadas para o código revisado. O M28 foi reescrito porque não compilava (TS18047). Inclui 5 mutantes das correções da revisão:
  - M28: guarda de dívidas;
  - M29: aviso de `MAX_TOKENS`;
  - F11: repetição em `deadline-exceeded`;
  - F12: compra saindo da aba "Cartão";
  - F13: tempo limite do cliente.
- **Equivalente justificado:** F08. A geração da sessão do chat é redundante com a limpeza de pendentes; o F10, que remove as duas proteções, morre.

**Revisão independente** (Opus, somente leitura; `evidence/p5e1/revisao-independente.md`). Veredito "aprovável com ressalvas": 0 BLOCKER, 0 HIGH, 3 MEDIUM, 7 LOW e 4 INFO. Todos os MEDIUM e LOW foram tratados, com teste:
- **M1:** tempo limite do cliente e repetição em `deadline-exceeded`.
- **M2:** a extração tirava a compra da aba "Cartão".
- **M3:** dívidas sem obrigações de cartão; o caminho real já estava protegido, e foram acrescentados a guarda no contexto e o teste com falha real do leitor.

**Validação final:**
Toda no Emulator `minhas-financas-local`, sem nenhum acesso à produção; detalhe em `evidence/p5e1/execucoes.md`.

- **`npm run verify:fast`, no repositório:** saída 0.
  - Lint com 0 erros e 201 avisos (base: 202).
  - 639 unitários das Functions e 763 do frontend.
  - 0 falhas e 0 skips.
- **Integração das Functions:** 941/941, a partir do `functions/lib` oficial, em portas próprias.
- **Ferramentas e Rules:** 273/273, numa cópia isolada do working tree em que só os números de porta mudaram.
- **E2E na mesma cópia:** 167/169. Das duas falhas:
  - uma era defeito do teste novo (pergunta não redigitada antes de confirmar), já corrigido: 11/11 na nova execução;
  - a outra é intermitente e preexistente em `notifications-p5d2.spec.ts:832` no celular. Reproduz na árvore base: 1 falha em 16 execuções, contra 3 em 20 na P5-E1, e não há diff no código envolvido.
- **Total:** 2.785 testes, contra 2.630 na base. Nenhum removido ou ignorado.
- **`git diff --check`:** limpo.
- **Segurança e dependências:**
  - bundle sem chave, sem `VITE_*` de IA e sem SDK do provedor;
  - `npm audit` das Functions idêntico ao da base.
- **`npm run verify:all` como está:** não executado. Um Firestore Emulator órfão (PID 7545, de antes destas execuções) prende a porta 8080. Encerrá-lo foi recusado nesta sessão e depende de decisão do usuário.
- **Skills de domínio:** todas `PASS` no escopo (`evidence/p5e1/VEREDITOS.md`).
- **`regression-release-gate`: `FAIL`.** Bloqueadores:
  - **(a)** `verify:all` como está, por causa da porta 8080;
  - **(b)** a falha intermitente preexistente das notificações no celular.

  Nenhum dos dois é defeito do código da P5-E1.

**Riscos e pendências:**
- **Achado preexistente, fora do escopo:** falha intermitente das notificações no celular, uma disputa entre o toque e a releitura do painel, para o milestone dono das notificações.
- **Externas:**
  - PR-AI-01 (base legal e registro, P8);
  - PR-AI-02/E-00 (rotação);
  - E-09 (DPA e transferência);
  - E-10 (tier, retenção, ZDR, região);
  - billing tier e limites do projeto no Google;
  - App Check (P6).
- **Decisões abertas:**
  - modelo GA (D-11 residual);
  - Gemini API paga × Vertex;
  - `engines.node`.
- **Recomendação comercial, não implementada:** o crédito consumido numa falha do provedor não é devolvido. A política P2B.2 foi mantida.
- **Custos** (`evidence/p5e1/custos.md`):
  - cerca de 101 leituras e 4 escritas por pergunta de 30 dias;
  - 11 leituras e 3 escritas por extração;
  - custo máximo de provedor de cerca de US$ 0,007 por pergunta.

**Rollback.** Reverter o diff da P5-E1 sobre `91ed2c58`:
- `functions/src/ai/*`;
- a opção `omitTopClients` em `reports/report.ts`;
- `functions/package.json` e o lockfile (volta do SDK legado);
- os arquivos do frontend listados;
- testes, evidências e documentação.

Sem dado a migrar; nada foi publicado.

**Estado.** **P5-E1 NÃO CONCLUÍDA — BLOQUEADORES IDENTIFICADOS.** A implementação, os testes, as mutações, a revisão independente e a documentação estão completos no working tree. O gate fica em `FAIL` só pelos bloqueadores (a) e (b) acima. Sem commit, push ou deploy. P5-E2, P5-F e o gate da P5 não iniciados; marco P5 não concluído.

### 20.12 P5-E1.1 — Minimização adicional, estabilização mobile e gate de regressão (2026-10-13)

**Base.** Árvore auditada da P5-E1 (`43ffbfa1`, extraída com `git archive`; HEAD `f0c172b`). O registro da §20.11 continua como está: a P5-E1 terminou em `FAIL`, e esta seção não o altera. Árvore final da P5-E1.1, por índice Git temporário: `0857533f`. O índice real termina sem nada staged.

**O que não foi feito:**
- Sem commit, push, merge, rebase, reset, tag ou deploy.
- Nada publicado: Rules, índices, `firebase.json`, exports e opções das Functions, dependências e lockfiles sem diff contra a base.
- Nenhum segredo lido, criado ou alterado.
- Nenhuma chamada real ao Google: o gateway de IA é falso nas suítes, no Emulator `minhas-financas-local`.
- Nenhum acesso ao projeto de produção.

**Fora do escopo, sem alteração:** P5-E2 (Mensagens, D-09), P5-F, P6–P10, rebranding, troca de provedor ou de modelo, política de créditos.

**(A) Minimização do contexto da análise.** Evidência em `evidence/p5e11/minimizacao-contexto-v2.md`.
- **Problema.** Na v1, o contexto enviava ao Google o nome livre de até 5 categorias de despesa. Esse nome é digitado pelo usuário e pode conter dado pessoal, e sanitizar não é anonimizar.
- **Decisão.** O campo foi excluído, não filtrado:
  - as categorias entram como "Grupo de despesas N", com N de 1 a 5 pela posição no ranking por valor (empates na ordem do relatório oficial);
  - não vai nome, ID, chave, hash nem mapa de reconstrução;
  - `buildAnalysisContext` não lê nome nem chave, o que é provado por um teste com getters que lançam erro;
  - valores, participações, teto de 5 e cobertura não mudam.
- **`ANALYSIS_CONTEXT_VERSION = 2`**, sem leitor nem payload da v1. Saíram `sanitizeUntrustedLabel`, `ANALYSIS_CATEGORY_LABEL_MAX`, o rótulo "Sem categoria" do contexto e as regex do sanitizador.
- **Instrução de sistema.** O modelo nunca afirma, deduz ou inventa nomes de categoria nem associa um grupo a um nome citado na pergunta (`prompts.ts:44-50`).
  - Limite: o modelo real não foi testado.
  - O que está provado é que o nome não sai do servidor.
- **Transparência.** O diálogo da análise lista o que vai ao provedor: valores agregados, grupos por posição, alertas, valores a receber, indicadores, movimentações de investimentos, patrimônio conforme a permissão e tipo do espaço. Lista também o que não vai e avisa que a pergunta segue como foi digitada e pode conter dados pessoais.
  - Nenhuma afirmação de anonimização.
  - Confirmação técnica (`ai-provider-share-v1`) inalterada e distinta de consentimento LGPD.
  - Sem caixa pré-marcada.
- **Testes:**
  - `aiMinimization.integration.test.ts`, P01–P28 no Emulator: nomes com CPF, CNPJ, e-mail, telefone ou nome próprio; ranking, teto e empate; PF e PJ; patrimônio sem permissão; cobertura indisponível e parcial; sem confirmação; confirmação de outra operação; chamadas simultâneas;
  - `analysisContext.test.ts` e `aiContext.integration.test.ts` (lista fechada `ALLOWED_SHAPE`);
  - `ai-share-contract.test.ts`, no frontend;
  - E2E do diálogo.

**(B) Falha intermitente do celular** (`notifications-p5d2.spec.ts:832`, `toHaveCount(7)` recebendo 8 na linha 971). Diagnóstico instrumentado em `evidence/p5e11/diagnostico-notificacoes.md`. Duas causas, ambas defeitos reais do app, preexistentes e dependentes de tempo:
1. **Clique de compatibilidade redirecionado.** Depois de um toque, o navegador gera o `click` com um novo teste de acerto. Com a lista animando, ele caía no aviso vizinho, que era marcado como lido e aberto, o painel fechava e o arquivamento tocado se perdia.
   - **Correção:** `src/lib/pressOrigin.ts`. O clique de um gesto que cai num "dono" (`data-press-target`) diferente daquele em que o gesto começou é impedido ali.
   - Num toque ou caneta, ele é reentregue ao dono de origem, com o foco junto (`preventScroll`).
   - Num mouse, numa origem sem dono ou num dono que saiu da página, ele só é impedido.
   - Passam intocados: teclado (`detail 0`), outro ponteiro e gesto com mais de 1 s.
   - O navegador continua decidindo se houve clique.
2. **Aviso arquivado preso no DOM.** É um defeito do `AnimatePresence` do framer-motion 10.16.4: o `useForceUpdate` usa um contador capturado num render anterior.
   - Uma saída que começa entre o fim da anterior e o render adiado nunca é removida. O aviso fica invisível, com 65 px de espaço, e continua clicável.
   - **Correção:** o painel re-renderiza a cada `onExitComplete`, com atualização funcional, mantendo o `layout` original.
   - A hipótese anterior, do `MeasureLayout`, foi refutada pelo código, pelas repetições e por uma reprodução determinística fora do app.
- **Também corrigido:**
  - marca confirmada (lida, arquivada ou excluída) não volta atrás por resposta antiga: `keepConfirmedNotificationMarks` como `structuralSharing` do feed, só para o mesmo ID e a mesma expiração;
  - o fundo do painel recebeu a mesma proteção de origem.
- **Sem mudança em:** Rules, TTL, índices, estado privado, paginação, contagem, permissões e visual. A diferença de pixels foi de 0,00% em todas as 24 capturas do painel e do sino, antes e depois.
- **Testes:**
  - `notifications-mobile-p5e11.spec.ts`: 20 casos, os 18 do §9.3 mais o 19 e o 20, de clique redirecionado;
  - `notifications-exit-race.spec.ts`: regressão determinística, que empacota o painel real e remove o segundo aviso exatamente na janela, em 10 rodadas;
  - `press-origin.test.ts`, com 13 testes, além da guarda, do modelo e do feed.
- **Repetições oficiais** da spec original, sem alteração (SHA-256 começando com `08fd3057`), sem retries, esperas ou timeouts novos (`evidence/p5e11/repeticoes-mobile.md`):
  - rodadas 1 a 3, com falhas, todas registradas;
  - rodada 4 (antes do foco na reentrega): 80/80;
  - **rodada 5, árvore final: 80/80, com 40 consecutivas no tema claro e 40 no escuro.**

**Acessibilidade do diálogo de IA.** O axe acusava `scrollable-region-focusable`: a 360 px desde antes, e a 390 px com o texto maior. Correção mínima: o corpo do diálogo e a citação longa ficam focáveis só quando rolam (`ResizeObserver`). O E2E confere:
- axe a 390 e a 360 px;
- a ordem do Tab (Fechar → corpo → Cancelar);
- a citação longa.

Nenhuma mudança visual.

**(C) Porta 8080 e Emulator** (`evidence/p5e11/ambiente-porta-8080.md`):
- O órfão da P5-E1 (PID 7545) já não existia: a máquina virtual foi reiniciada às 09:13Z. Nenhum sinal enviado.
- Depois de cada E2E, o Playwright deixa a JVM do Firestore Emulator órfã. Cada uma foi encerrada só com identidade, propriedade e ausência de uso comprovadas (processos da mesma execução e conexões TCP), por SIGTERM ao PID (`encerramentos-emulator.txt`).
- Nenhum `pkill`, `killall`, `e2e:kill-ports` ou SIGKILL em Emulator. Os desvios anteriores às 12:41Z, como o `kill -9` no proxy de loopback do próprio script, estão divulgados e substituídos por wrappers seguros.

**Mutações** (`evidence/p5e11/mutacoes.md`): 54 mutantes, 54 mortos (cada morte conferida no log por uma asserção reprovada), 0 sobreviventes e 0 inválidos, com a restauração conferida por SHA-256 em todos, cobrindo privacidade, roteamento do clique, fusão de marcas, remoção no fim da saída, diálogo e E2E. A restauração foi conferida por SHA-256. O R05 sobreviveu na passada 1 e morreu na 2, depois de novos casos de teclado.

**Revisões independentes** (Opus, somente leitura; `evidence/p5e11/revisao-independente.md`):
- **Rodada 1, desenho A:** 3 MEDIUM e 7 LOW, todos tratados. O M1 deixou de existir com o roteamento do clique.
- **Rodada 2, retrato das 13:44Z:** 0 BLOCKER, 0 HIGH, 2 MEDIUM e 8 LOW.
  - O M1 foi corrigido com a regressão determinística.
  - O M2 foi tratado no fechamento.
  - L1, L3, L4, L6, L7 e L8 foram corrigidos.
  - L2 e L5 ficam como riscos residuais.
- **Rodada 3, árvore final, com o `verify:all` em curso:** 0 BLOCKER, 0 HIGH, 0 MEDIUM e 4 LOW.
  - N1 (caneta que se comporta como mouse), N2 (foco quando o dono é o corpo do aviso) e N3 (a regressão determinística sem controle positivo) ficam como riscos residuais, com a correção recomendada. Aplicá-las mudaria código ou testes depois do `verify:all`.
  - N4 (riscos citados onde não estavam) foi corrigido nas evidências.
  - Q14 e Q15 (gate integral na árvore final e regressão em módulo não relacionado) fechadas como OK depois do `verify:all`.

**Validação final:** Detalhe em `evidence/p5e11/execucoes.md`.
- **`npm run verify:all`, no repositório como está:** saída 0, das 14:58:50Z às 15:43:50Z.
  - Unitários: 661 das Functions e 789 do frontend.
  - No Emulator: 969 de integração e 273 de ferramentas e Rules.
  - E2E: 191.
  - Total: 2.883 testes, contra 2.785 da P5-E1, com 0 falhas e 0 skips.
  - Lint: 0 erros e 201 avisos, os mesmos da base.
- **Primeira execução:** interrompida pelo limite de 30 minutos do executor em segundo plano, sem falha de teste. Está registrada e não conta.
- **Pré-teste dirigido** das três specs da P5-E1.1: 33/33.
- **Repetições, rodada 5:** 80/80.
- **`git diff --check`:** limpo. O índice real está sem nada staged.
- **Desvio de processo registrado:** Emulators simultâneos entre 13:36Z e 13:44:31Z (mutantes de integração na porta 8180 e E2E em cópias na 8280), contra a regra de coordenação. Nenhum resultado do gate veio dessa janela.

**Skills:** `PASS`, no escopo da milestone, em `privacy-lgpd-data-lifecycle`, `multi-tenant-security-review`, `financial-domain-integrity`, `firestore-scale-cost-review` (opção `structuralSharing` do feed), `firebase-production-readiness` e na revisão de UI em pt-BR (`evidence/p5e11/VEREDITOS.md`). Billing, observabilidade e comercial não se aplicam, com fundamento registrado. **`regression-release-gate`: `PASS`.** Os dois bloqueadores da P5-E1 foram tratados: o `verify:all` rodou como está, com saída 0, e a variante celular passou 80/80 na árvore final.

**Riscos residuais:**
- Dois caminhos raros do framer-motion 10.16.4 escapam da correção (L2): um item que volta à lista durante a própria saída e uma saída antiga que termina depois de uma nova. No painel são improváveis, porque as marcas só ligam e a transição é uniforme.
- A reentrega pode ir a um aviso que já está saindo (L5). O efeito é repetir um arquivamento idempotente, navegar para o aviso arquivado ou, no "Excluir para mim", abrir a confirmação de um aviso que está saindo, que pode ser cancelada.
- Caneta que se comporta como mouse (N1): deslizar para fora de "Arquivar" e soltar em menos de 1 s arquiva o aviso; antes, o mesmo gesto o abria (soltando sobre ele) ou não fazia nada (soltando fora). Correção recomendada: só reentregar quando o `pointerup` estiver no dono de origem.
- Foco depois da reentrega ao corpo do aviso, que é um `div` (N2): fica no botão em que caiu o `mousedown`; com teclado físico, o próximo Enter age nele. Correção recomendada: `blur()` se o elemento ativo ficar fora do dono.
- A regressão determinística não tem controle positivo na suíte (N3). Hoje a não vacuidade vem dos mutantes R13r, R14r e R16r, com o framer-motion fixado em 10.16.4.
- `ReportsAIChat` e `MessagesPanel` também usam `AnimatePresence` e não receberam a correção. O `MessagesPanel` sai na P5-E2.
- O foco cai no `body` se o conteúdo deixa de rolar com a região focada, por exemplo ao girar o aparelho. O Tab volta ao diálogo.
- A regra dos grupos não foi testada com o modelo real.
- Débito de contraste da P5-D2 (badge e tema escuro do painel): idêntico antes e depois, para as fases de UI/UX aprovadas.

**Pendências externas:**
- PR-AI-02/E-00: rotação da chave;
- E-09: DPA e transferência internacional;
- E-10: tier, retenção, ZDR e região;
- PR-AI-01: base legal, na P8;
- testes em STAGING;
- modelo estável (GA);
- política de devolução de créditos em falha do provedor, decisão comercial;
- P5-E2, P5-F e os gates P6–P10.

**Rollback.** Reverter o diff da P5-E1.1 sobre `43ffbfa1`:
- `functions/src/ai/analysisContext.ts` e `prompts.ts`;
- `src/components/AiShareConsentDialog.tsx`, `NotificationsPanel.tsx` e `Header.tsx`;
- `src/lib/pressOrigin.ts`;
- `src/modules/notifications/model.ts` e `feed.ts`;
- os testes, as specs e o `package.json`;
- documentação e evidências.

Sem dado a migrar; nada foi publicado.

**Estado.** **P5-E1.1 IMPLEMENTADA — AGUARDANDO AUDITORIA INDEPENDENTE.** O registro da P5-E1 (§20.11) permanece como está: ela terminou em `FAIL`, e os bloqueadores foram tratados nesta milestone. Sem commit, push ou deploy. A P5-E2, a P5-F e o gate da P5 não foram iniciados; o marco P5 não está concluído.
