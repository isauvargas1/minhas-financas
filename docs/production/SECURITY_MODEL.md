# Modelo de segurança

Referência do programa de Production Readiness para os controles de segurança por camada: identidade, App Check, entrypoints do backend, Firestore Rules, isolamento de tenant, segredos, Hosting e cadeia de suprimentos, artefatos de teste, ferramentas operacionais, administração de plataforma e IA. Baseline auditada: HEAD `9c3ab46`. Estado, ordem e IDs canônicos estão no plano mestre, [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md) (§5.14, §5.17, §5.18, §5.23, §5.25 e §6). O gate do tema é a skill `multi-tenant-security-review`. Os controles de plataforma (App Check, IAM, Secret Manager, Hosting, ambientes) passam também por `firebase-production-readiness`, e as Rules podem usar como referência complementar o checklist `firebase:firebase-security-rules-auditor`.

Rótulos conforme a tabela de classificação do plano: **CURRENT** (existe no HEAD, com `arquivo:linha`), **TARGET** (alvo, não implementado), **GAP** (ID do registro), **DECISION** e **EXTERNAL CONFIGURATION REQUIRED** (fora do repositório, estado NÃO VERIFICADO). A matriz RBAC, o modelo de membership e os convites estão em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md); as ameaças priorizadas, em [THREAT_MODEL.md](THREAT_MODEL.md); a configuração de plataforma, em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md).

---

## 1. Princípios

1. **Duas camadas independentes.** O backend (callables com Admin SDK) é a autoridade das operações críticas. As Firestore Rules são a segunda camada e negam escrita do cliente em dados autoritativos. Cada camada é avaliada como se a outra não existisse; uma não compensa a falha da outra (checklist da skill `multi-tenant-security-review`).
2. **Identidade só do token verificado.** Papel, workspace e titularidade vêm de dados do servidor, nunca de campo enviado pelo cliente nem de controle escondido na UI.
3. **App Check reduz abuso, mas não autoriza.** Nunca substitui autenticação, membership ou RBAC.
4. **Falha fechada.** Segredo ausente, configuração vazia ou schema inválido resultam em recusa, nunca em valor padrão.
5. **Sem terceiros executando na origem autenticada** sem necessidade, e com CSP quando necessário.
6. **Menor privilégio** para pessoas, service accounts, ferramentas e agentes; nada toca produção fora do CD aprovado.

---

## 2. Resumo por camada

| Camada | CURRENT | TARGET | GAP | Milestone |
| --- | --- | --- | --- | --- |
| Identidade | Google + login E2E fixo; sem `email_verified`, revogação ou blocking functions | Política de token no wrapper; provedores por ambiente; revogação | PR-AUTH-04; AUTH-08, ENTRY-23, AUTH-17 | P1, P6 |
| App Check | Inexistente | Cliente com reCAPTCHA Enterprise; enforcement em callables, Firestore e Auth | PR-APPCHK-01 | P6 |
| Callables | Base sólida em cartões, investimentos e metas; resto do domínio sem backend | Wrapper único do kernel em todas as callables | PR-WS-02, PR-ENT-01 e itens de domínio; ENTRY-11, ENTRY-12, ENTRY-20, ENTRY-21 | P1–P5 |
| Firestore Rules | Default deny, domínios server-only, allowlists; dez coleções abertas e catch-all de leitura | `write: false` em tudo que é autoritativo; um `match` por coleção; `list` com `limit` | PR-RULES-01, PR-RULES-02, PR-TX-02, PR-REC-01, PR-CC-02, PR-WS-05 | P1–P6 |
| Isolamento de tenant | Por caminho; nenhum vazamento cross-tenant encontrado | Negativos A/B em toda operação | Riscos latentes ENTRY-11, RULES-06 | P1–P6 |
| RBAC | Rules M4.C anti-escalada; regime duplo `ownerId` × membership | Resolvedor único relido na transação | PR-WS-03, PR-WS-04 | P1 |
| Segredos | Secret Manager por função; chave de IA só no backend | `defineSecret` sem padrão; segredos por ambiente; rotação | PR-BILL-05, PR-AI-02 | P2, P0 |
| Hosting e supply chain | Sem headers de segurança; Tailwind Play CDN, `esm.sh`, Google Fonts | Build sem terceiros em runtime; CSP e headers | PR-PLAT-03; REL-11 | P6 |
| Artefatos de teste | Login E2E e `dist/` compartilhado; testes no pacote das Functions | Build e pacote por ambiente, sem código de teste | PR-AUTH-04; REL-15, ENTRY-22 | P6 |
| Ferramentas e acesso operacional | Utilitário de hard delete com override para produção; projeto único | Ferramentas só em Emulator/DEV; IAM mínimo; CD | PR-PLAT-02, PR-PLAT-01; FIRE-09, REL-12 | P6 |
| Admin de plataforma | `isAdmin` lido no cliente; painel placeholder | Custom claim, callables auditadas ou remoção | PR-ADMIN-01 | P7 |
| IA | Chave no backend, Zod na entrada, RBAC, rate limit | Contexto no servidor, schema de saída, quotas, App Check | PR-AI-02, PR-AI-03, PR-AI-05, PR-AI-01 | P0, P2, P5, P8 |

---

## 3. Identidade

Detalhe em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §2 e §10.1.

- **CURRENT:** nas Rules, `signedIn()` é só `request.auth != null` (`firestore.rules:5-7`). No backend, `requireAuthenticatedUser` exige apenas `uid` e lê `email` do token (`functions/src/creditCards/auth.ts:36-52`). Nenhuma checagem de `email_verified` ou de provedor; o checkout envia `token.email` ao Stripe (`functions/src/callables/billing.ts:139`). Sem blocking functions nem gatilho de Auth (`functions/src/index.ts:13-37`). Sem `revokeRefreshTokens` nem status de conta (AUTH-09). Login e-mail/senha de E2E com credenciais fixas no `AuthContext` (`src/contexts/AuthContext.tsx:94-114`).
- **TARGET:** o wrapper do kernel (D-ORD-02) aplica a política de token: `email_verified` nas callables definidas por D-06, `sign_in_provider` na allowlist do ambiente (só Google), `auth_time` nos últimos 10 minutos em `transferWorkspaceOwnership` e `archiveWorkspace`, recusa de conta suspensa e de token anterior a `tokensValidAfterTime`. Blocking functions restringem provedores por ambiente. Sem MFA para usuários comuns; MFA obrigatória para administradores de plataforma (P7). D-06 define a exigência de `email_verified` por callable e não prevê helper equivalente nas Rules.
- **GAP:** PR-AUTH-04 (P6); AUTH-08, ENTRY-23, AUTH-17; suspensão em PR-ADMIN-01 (P7), com mecanismo em P1 (D-ORD-03); contenção e revogação de sessão em incidente: PR-OBS-02 (P7).
- **DECISION:** D-06 (tomada, §9.1 do plano). **EXTERNAL CONFIGURATION REQUIRED:** E-03 (NÃO VERIFICADO).

---

## 4. App Check

- **CURRENT:** inexistente. O cliente não chama `initializeAppCheck` (`src/lib/firebase.ts:1-64`); nenhuma opção de runtime declara `enforceAppCheck` (`functions/src/shared/runtimeOptions.ts:41-91`); o teste de contrato não o verifica. Qualquer script com um ID token chama as 42 callables, inclusive as de IA, que têm custo externo (ENTRY-03).
- **TARGET:** `initializeAppCheck` com `ReCaptchaEnterpriseProvider` antes dos demais serviços, com debug token só em Emulator e E2E. `enforceAppCheck: true` nas classes DOMAIN, HEAVY e AI; `consumeAppCheckToken` (proteção contra replay) nas callables de IA e no checkout. Rollout em modo monitor e depois enforce para Firestore e Auth. `functions/src/shared/deploymentContract.test.ts` passa a exigir a opção em toda callable. O webhook Stripe fica fora do App Check, porque é chamado pelo Stripe; ele se autentica pela assinatura (§6.2).
- **GAP:** PR-APPCHK-01 (P6). **EXTERNAL CONFIGURATION REQUIRED:** E-02 (NÃO VERIFICADO). **DECISION D-33:** período de monitoramento, ordem de enforcement e rollback (detalhe em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md)).

---

## 5. Entrypoints do backend

### 5.1 CURRENT

O `functions/src/index.ts` exporta 47 endpoints: 1 gatilho Firestore, 42 callables (9 de cartões, 23 de investimentos, 4 de metas, 2 de IA, 2 de divisão de contas, 1 de checkout, 1 de rebuild de caixa), 3 crons e 1 webhook. Todos em `southamerica-east1` com `maxInstances`; callables e crons declaram timeout e memória por perfil, cobertos por teste de contrato (`functions/src/shared/runtimeOptions.ts:38-91`; `functions/src/shared/deploymentContract.test.ts:63-178`); webhook e gatilho de caixa usam o padrão da plataforma (`functions/src/webhooks/stripe.ts:31-41`; `functions/src/triggers/transactions.ts:35-37`).

O que já está correto e serve de modelo:

| Domínio | Controle | Evidência |
| --- | --- | --- |
| Cartões (9) | Wrapper único: Zod, depois `requireWorkspaceRole` (autenticação, membership ativa, papel da matriz declarativa), depois `runTransaction` com `idempotencyKey` obrigatória (mínimo 16) | `functions/src/creditCards/callable.ts:46-68`; `functions/src/creditCards/writeStrategy.ts:55-283`; `functions/src/creditCards/contracts.ts:4` |
| Investimentos (23) | Zod com IDs sem `/`; papel relido dentro da transação; chave de idempotência presa ao ator, à operação e ao hash do payload; rate limit reservado na transação | `functions/src/investments/contracts.ts:10-17`; `functions/src/investments/infrastructure.ts:158-212,249-283` |
| Metas (4) | Zod estrito, matriz de papéis declarativa, transação com `reserveIdempotency` | `functions/src/goals/callables.ts:44-105`; `functions/src/goals/operations.ts:187-191` |
| Observabilidade de falha | Grava só no workspace já autorizado, nunca no `workspaceId` do payload | `functions/src/investments/callables.ts:82-101`; `functions/src/creditCards/observability.ts:214-223` |
| Rate limit | Contador transacional em Firestore, por ator e workspace ou por usuário, com Rules negando o cliente | `functions/src/shared/rateLimit.ts:55-91`; `firestore.rules:862,1472-1474` |
| Checkout | Allowlist de `priceId` e de origem de retorno por comparação de origem completa; falha fechada com listas vazias; rate limit por usuário | `functions/src/callables/billing.ts:31-68,109-134` |
| Convites de divisão | Código por CSPRNG de 10 caracteres; membership do workspace exigida, o que fechou a escalada cross-tenant INV-P2-037 | `functions/src/callables/splitGroups.ts:33-39,106-113,183-191` |

Fraquezas:

| Fraqueza | Evidência | ID |
| --- | --- | --- |
| Sem backend para workspaces/membership, empréstimos, clientes, recebíveis e títulos de divisão; esses domínios são escritos pelo cliente | `src/modules/workspaces/api.ts:182-264`; `firestore.rules:1351-1402` | PR-WS-02 (P1); PR-LOAN-01, PR-CR-01 (P3); PR-SPLIT-01 (P4) |
| Nenhum plano ou quota verificado no servidor | `src/hooks/usePlan.ts:36-38` | PR-ENT-01 (P2) |
| `workspaceId` aceita `/` em 18 callables; o resolvedor interpola o caminho | `functions/src/creditCards/contracts.ts:3`; `functions/src/creditCards/auth.ts:59` | ENTRY-11, WS-15 |
| Papel verificado fora da transação em cartões e metas | `functions/src/creditCards/callable.ts:57-61`; `functions/src/goals/callables.ts:22-30` | ENTRY-20 |
| Cartões e metas sem rate limit | `functions/src/creditCards/callables.ts:163-187` | ENTRY-12 |
| Quatro mapeadores de erro; detalhes expõem `role` e `allowedRoles`; limite atingido vira `failed-precondition` | `functions/src/creditCards/auth.ts:115`; `functions/src/shared/rateLimit.ts:121-126` | ENTRY-21 |
| Erros inesperados convertidos em `HttpsError` sem log | `functions/src/goals/callables.ts:53-55`; `functions/src/cash/rebuild.ts:270-272` | PR-OBS-01 (P7) |
| Papel de dono de grupo lido de `split_participants`, gravável por qualquer member; limite de tentativas revertido pelo `throw` | `functions/src/callables/splitGroups.ts:119-137,222-247` | PR-SPLIT-04 (P4) |
| Schema de extração de IA sem `.strict()` | `functions/src/ai/callables.ts:176-194` | PR-AI-05 (P5) |

### 5.2 Webhook Stripe

- **CURRENT:** a assinatura é verificada com `rawBody` (`functions/src/webhooks/stripe.ts:52`), mas com fallback `whsec_placeholder` quando o segredo falta (`functions/src/webhooks/stripe.ts:8-9`). O webhook declara `cors: true` e devolve `error.message` na resposta (`functions/src/webhooks/stripe.ts:40,55-56`). Não há idempotência por `event.id` nem controle de ordem.
- **TARGET e GAP:** [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md). IDs: PR-BILL-05 (fail-open de segredo), PR-BILL-06 (idempotência e ordem), PR-BILL-01 (ciclo de vida), todos em P2; ENTRY-21 (CORS e eco de erro).

### 5.3 TARGET: ordem de verificação de toda callable

O wrapper do kernel (D-ORD-02, entregue em P1) executa, nesta ordem:

1. App Check (a partir de P6; ponto de extensão desde P1).
2. Autenticação e política de token (§3).
3. Zod `.strict()`: IDs com o schema único (sem `/`, tamanho máximo), dinheiro em centavos inteiros, strings com teto.
4. Abertura da transação e `authorizeInTransaction(tx, workspaceId, uid, allowedRoles)` ([ARCHITECTURE.md](ARCHITECTURE.md)): exige que o `workspaceId` do payload seja o autorizado, relê `workspaces/{id}` e `members/{uid}`, exige membership `active` e workspace não arquivado e aplica a matriz declarativa da operação.
5. Rate limit por ator e workspace, e por usuário quando o recurso é global (IA).
6. Entitlement e quota (motor de P2, PR-ENT-01). As callables de P1 não consultam quota; P2 a insere nas transações de `createWorkspace`, `inviteWorkspaceMember` e `acceptWorkspaceInvite` (D-01).
7. Reserva de idempotência presa a ator, workspace, operação e hash do payload.
8. Escritas de domínio, projeções e evento de auditoria append-only no mesmo commit.
9. Erros mapeados por um único módulo, com códigos canônicos (`resource-exhausted`, `already-exists`, `permission-denied`), mensagem em pt-BR, `details` sanitizados e correlation ID de servidor; erro inesperado registrado no logger estruturado antes da conversão.

---

## 6. Firestore Rules

### 6.1 CURRENT

Base sólida:

- Default deny fora de `workspaces/{id}` e `users/{uid}`: não existe `match` de nível superior genérico (`firestore.rules:1-3,990,1456`).
- Helpers de membership consideram `status` (`firestore.rules:9-24`).
- Domínios de cartões (compras, parcelas, faturas, pagamentos, ledger e snapshot de limite, eventos, visões), metas e investimentos são `write: false`. Investimentos validam conteúdo no `get` e exigem `limit` de até 100 no `list`; `cash_report_periods` exige `limit` de até 600; chaves de idempotência e `cash_period_events` são negadas nos dois sentidos (`firestore.rules:473-477,1121-1349`).
- Allowlists de chaves em `users`, `workspaces`, `members` e `transactions`; `type` de transação imutável; `delete` de `transactions` negado, com baixa lógica (`firestore.rules:67-99,101-185,1094`).
- Seis suítes de Rules no Emulator, no CI e no `predeploy:rules` (`.github/workflows/quality-gate.yml:74-110`; `package.json:21`).

Exposição:

| Grupo | Coleções | Situação | ID |
| --- | --- | --- | --- |
| Escrita livre de member, sem schema, com delete | `recurring_expenses`, `recurring_occurrences`, `loans`, `loan_movements`, `clients`, `receivables`, `split_groups`, `split_participants`, `split_bills`, `split_shares` | `allow write: if canMemberWriteWorkspaceScopedData` (`firestore.rules:1097-1105,1351-1369,1384-1402`) | PR-RULES-01 (P3/P4) |
| Caixa escrito pelo cliente | `transactions` | Create/update pelo cliente em float; espelhos gravados pelo backend editáveis e vínculos de origem forjáveis (`firestore.rules:67-76,243-248,1056-1087`) | PR-TX-01, PR-TX-02 (P3) |
| Configuração de cartão | `credit_cards` | Limite, ciclo e status gravados por owner/admin; delete físico (`firestore.rules:966-988,1118`) | PR-CC-01, PR-CC-02 (P4) |
| Controle de acesso | `workspaces`, `members`, `users/{uid}/workspaces` | Criação de workspace e membership pelo cliente; espelho autogravado; trancamento do owner (`firestore.rules:27-34,991-994,1021-1050,1478-1487`) | PR-WS-01…PR-WS-05 (P1) |
| Catch-all de leitura | Toda subcoleção fora de `isBackendOwnedCollection`, hoje `activity_logs` (autor e saldos) e `split_invites` (códigos de convite) | Legível por qualquer membro, inclusive `viewer`, sem `limit` (`firestore.rules:852-877,1436-1442`) | PR-RULES-02 (P6) |
| Listagem sem teto | `transactions`, `notifications`, `members`, adjacentes, `credit_cards`, `activity_logs` | Sem `request.query.limit` | RULES-11 |
| Validação fraca | Timestamps livres, strings e mapas sem teto, `members.status` com qualquer string | `firestore.rules:67-76,125,134,260,1027` | RULES-16 |
| Storage | Bucket padrão | `getStorage` exportado sem uso, sem `storage.rules` versionado (`src/lib/firebase.ts:4,39`) | FIRE-12 |
| Testes | Adjacentes, cartões, notificações, índice do usuário | Sem teste de escrita nem negação (`tests/firestore/adjacent-modules.rules.integration.test.mjs:129-243` só lê) | PR-REL-02 (P3); RULES-15 |

**Nota do checklist `firebase-security-rules-auditor`:** a auditoria `firestore-rules` atribuiu **1 (Critical)**. O motivo é o cliente continuar gravando dados financeiros autoritativos sem schema, com hard delete, apesar da base sólida.

### 6.2 TARGET

- Todas as coleções financeiras e de controle com `allow write: if false`, com escrita só por callable. A troca de cada coleção acontece no mesmo milestone do seu callable (risco R-02): `workspaces`, `members`, `invites` e índice do usuário em P1; `transactions`, `loans`, `loan_movements`, `clients` e `receivables` em P3; `recurring_*`, `split_*` e `credit_cards` em P4; `notifications` em P5.
- Escrita direta do cliente só em dados não financeiros do próprio usuário (allowlist de perfil) e no estado de leitura de notificação por usuário, com `hasOnly`, tipos, tetos e `request.time`.
- Um `match` explícito por coleção, `get` e `list` separados, `list` sempre com `request.query.limit`, papel mínimo por coleção e nenhum catch-all. Um teste enumera as coleções usadas pelo código e falha se alguma não tiver regra explícita.
- Um único helper de papel baseado no membership ativo, sem `isWorkspaceOwnerByParent` ([AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §6.3).
- `storage.rules` com deny-all versionado, ou remoção de `getStorage`.
- Suíte por coleção cobrindo owner, admin, member, `viewer` (somente leitura, D-02), removido, não membro e não autenticado, com create, update, delete, get e list, cross-tenant nos dois sentidos e payload inválido.

---

## 7. Isolamento de tenant

- **CURRENT:** o isolamento é por caminho (`workspaces/{workspaceId}/...`), e as Rules resolvem membership pelo `workspaceId` do caminho. A auditoria não encontrou vazamento cross-tenant nos domínios de conta e workspaces, transações, investimentos, metas, cartões, recorrentes, empréstimos, divisão de contas e clientes/recebíveis. Evidências: `tests/firestore/m4-hardening.rules.integration.test.mjs:246`; suítes `investment-*.rules` e `goals.rules`; `tests/firestore/investment-domain.rules.integration.test.mjs:615-635`; o cron de recorrentes deriva o workspace do caminho (`functions/src/crons/recurring.ts:436`); os convites de divisão exigem membership (`functions/src/callables/splitGroups.ts:106-113`); a observabilidade de falha só grava no workspace autorizado (§5.1); o rate limit é isolado por ator e workspace (`functions/src/shared/__tests__/rateLimit.integration.test.ts`).
- **Riscos latentes (não explorados):**
  - `workspaceId` com `/` aponta para documento aninhado e pode criar um pseudo-tenant sob um workspace real, com papel `owner` derivado de um `ownerId` gravado numa coleção sem schema (ENTRY-11, WS-15).
  - Com a futura exclusão de workspace, o create aberto permitiria recriar um ID liberado e assumir subcoleções órfãs; o alvo mantém o documento-pai como marcador (RULES-06, em PR-WS-05, P1).
  - Criação ilimitada de workspaces multiplica todo limite por workspace (PR-AI-03, P2).

Riscos intra-workspace (o member ou admin é o atacante):

| Risco | Evidência | ID |
| --- | --- | --- |
| Member apaga ou reescreve empréstimos, recebíveis, rateios e recorrências | `firestore.rules:1097-1105,1351-1402` | PR-RULES-01 (P3/P4) |
| Owner/admin editam ou anulam espelhos de caixa gravados pelo backend; member forja vínculo de pagamento de fatura | `firestore.rules:67-76,243-248` | PR-TX-02 (P3) |
| Member marca ocorrências futuras como geradas e o cron deixa de cobrar | `firestore.rules:1102-1105` | PR-REC-01 (P4) |
| Member se declara dono de grupo de divisão | `firestore.rules:1389-1392` | PR-SPLIT-04 (P4) |
| Co-owner ou admin tranca o owner fora do workspace | `firestore.rules:13-14,27-33,1021-1041` | PR-WS-04 (P1) |
| Admin cria outros admins e remove admins sem trilha | `firestore.rules:1021-1050` | WS-13 |
| Qualquer membro lê `activity_logs` e códigos de `split_invites` | `firestore.rules:1436-1442` | PR-RULES-02 (P6) |
| Membro grava papel falso no próprio espelho e recebe a UI de gestão (as ações falham no servidor) | `firestore.rules:1478-1486` | PR-WS-03 (P1) |
| Categoria criada por um membro injeta instrução no prompt de IA do owner | `functions/src/ai/callables.ts:55-70,93-103` | PR-AI-05 (P5) |
| Histórico de chat de IA vaza entre workspaces e usuários no mesmo navegador | `src/modules/reports/hooks.ts:343-358` | PR-AI-04 (P5) |
| `activity_logs` atribui a alteração ao criador, não ao ator | `functions/src/triggers/transactions.ts:108` | ENTRY-17 |

- **TARGET:** testes negativos com tenants A e B, nos dois sentidos, para toda operação alterada em Rules e callables; `workspaceId` validado no resolvedor antes de qualquer caminho; nenhuma decisão de confiança tomada a partir de campo gravável pelo cliente.

---

## 8. RBAC

Papéis `owner`, `admin`, `member` e `viewer` por membership de workspace, com `viewer` estritamente somente leitura (D-02, tomada). As matrizes atual e alvo, a invariante de um único owner canônico (D-03), os poderes de owner e admin (D-04) e o resolvedor único estão em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §6 e §7.

Pontos de segurança: as Rules M4.C já bloqueiam autopromoção e concessão de `owner` por admin, com testes (`tests/firestore/m4-hardening.rules.integration.test.mjs:257-356`). O regime duplo `ownerId` × membership diverge entre Rules e backend (PR-WS-03, P1). O papel exibido na UI vem de um espelho autogravado e não deve ser usado para nenhuma decisão (PR-WS-03, P1).

---

## 9. Segredos e configuração

### 9.1 CURRENT

- Segredos declarados por função no Secret Manager: `GOOGLE_AI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ALLOWED_PRICE_IDS`, `APP_ALLOWED_ORIGINS` (`functions/src/ai/callables.ts:24-29`; `functions/src/callables/billing.ts:90-94`; `functions/src/webhooks/stripe.ts:35-39`). Runtime config legado desabilitado (`firebase.json:13`).
- A chave de IA não está no cliente: o Vite neutraliza `process.env.API_KEY` e `process.env.GEMINI_API_KEY` (`vite.config.ts:14-19`); `readApiKey` falha fechada (`functions/src/ai/callables.ts:107-116`); guardas estáticas em `tests/unit/ai-backend-only.test.ts:33-90`.
- `.env*`, chaves `.pem` e service accounts estão no `.gitignore` e nunca foram commitados (`.gitignore:30-39`). O frontend só lê `VITE_FIREBASE_*`, que é configuração pública do app web, não segredo (`src/lib/firebase.ts:7-33`).
- `isAllowedReturnUrl` só aceita `http` para `localhost`, e ainda assim só se a origem estiver na allowlist (`functions/src/callables/billing.ts:62-67`). Em PROD, `APP_ALLOWED_ORIGINS` não pode conter `localhost`.

### 9.2 Lacunas

| Lacuna | Evidência | ID |
| --- | --- | --- |
| Fallback `sk_test_placeholder`/`whsec_placeholder`: um segredo de webhook ausente faz o endpoint aceitar eventos assinados com uma constante pública | `functions/src/webhooks/stripe.ts:8-9,52`; `functions/src/callables/billing.ts:9` | PR-BILL-05 (P2) |
| Configuração não secreta (`STRIPE_ALLOWED_PRICE_IDS`, `APP_ALLOWED_ORIGINS`) guardada como segredo; ausência não alertada | `functions/src/callables/billing.ts:90-94` | FIRE-10 |
| Chave Gemini embutida no bundle público entre `39806fb` (2026-01-22) e `92473c8` (2026-08-24), sem rotação comprovada; presença de `GEMINI_API_KEY` em `.env.local` das estações: NÃO VERIFICADO (arquivo não versionado; ver linha 5 da §9.4) | `git show 39806fb:vite.config.ts:14-15`; `vite.config.ts:14-19` | PR-AI-02 (P0); E-00 |
| Um único projeto e o mesmo Secret Manager para desenvolvimento e produção | `.firebaserc:3` | PR-PLAT-01 (P6) |
| Varredura de segredos só procura o padrão `AIza`; sem gitleaks | `tests/unit/ai-backend-only.test.ts:76-89` | FIRE-13, REL-11 |

### 9.3 TARGET

`defineSecret` sem valor padrão, com recusa explícita, log estruturado e alerta quando faltar; Stripe instanciado dentro do handler. Configuração não secreta em `defineString`/`defineList` por alias. Segredos separados por projeto (DEV, STAGING, PROD), contas Stripe test e live separadas, política de rotação registrada (E-05). API key web restrita por referrer e API; chave de IA restrita à API e com quota. Gitleaks no CI com padrões Google, Stripe e service account.

### 9.4 Registro de evidência E-00 (ação externa imediata)

Pela §11 do plano mestre, a evidência de E-00 é registrada aqui. A ação é humana, fora do repositório; agentes não acessam o projeto nem leem `.env*`. Critério de fechamento de PR-AI-02 (P0): todas as linhas com estado VERIFICADO, data e responsável.

| # | Item | Valor esperado | Estado | Data | Responsável | Verificação |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Chaves afetadas | Lista (sem valores) de toda chave Gemini que esteve no bundle entre `39806fb` e `92473c8` ou em `.env.local` | NÃO VERIFICADO | — | a definir | Console GCP, APIs e serviços, Credenciais |
| 2 | Revogação | Todas as chaves da linha 1 excluídas; chamada com elas retorna erro de chave inválida | NÃO VERIFICADO | — | a definir | Console GCP; teste manual fora do repositório |
| 3 | Chaves novas | Uma chave por ambiente (DEV, STAGING, PROD), restrita à Generative Language API, com quota diária | NÃO VERIFICADO | — | a definir | Console GCP, restrições da chave |
| 4 | Secret Manager | `GOOGLE_AI_API_KEY` com a chave nova em cada projeto; versões antigas desabilitadas | NÃO VERIFICADO | — | a definir | Console do Secret Manager (metadados, sem ler o valor) |
| 5 | Estações | `GEMINI_API_KEY` removida dos `.env.local` locais | NÃO VERIFICADO | — | dono de cada estação | Declaração do responsável |
| 6 | Uso no período | Consumo e faturamento da API no período de exposição revisados, sem uso anômalo | NÃO VERIFICADO | — | a definir | Relatório de faturamento e métricas da API |

---

## 10. Hosting e cadeia de suprimentos

- **CURRENT:** o Hosting só define `Cache-Control` (`firebase.json:38-57`); não há CSP, HSTS, `frame-ancestors`, `nosniff`, `Referrer-Policy` nem `Permissions-Policy`. O `index.html` carrega `https://cdn.tailwindcss.com` como script na origem autenticada (`index.html:8`), Google Fonts (`index.html:9-11`) e um importmap `esm.sh` com faixa flutuante para `@google/genai` (`index.html:75-90`), e declara `lang="en"` (`index.html:3`). O Tailwind não é compilado: `src/index.css:1-3` tem diretivas sem pipeline. No CI, `firebase-tools@latest`, actions por tag e não por SHA, sem bloco `permissions` (`.github/workflows/quality-gate.yml:39,79,101,117,139`).
- **Impacto:** um comprometimento do CDN executa JavaScript na mesma origem em que o Firebase Auth guarda o refresh token, com acesso a todos os workspaces da vítima. Sem `frame-ancestors`, a tela de membros fica sujeita a clickjacking.
- **TARGET:** Tailwind compilado no build com prova de paridade visual por screenshot (D-20, R-04); fontes auto-hospedadas; remoção do importmap, do `metadata.json` e do entrypoint duplicado. Headers em `source: '**'`: CSP com `script-src 'self'` e apenas os domínios necessários de Google Auth e Stripe, `frame-ancestors 'none'`, `connect-src` restrito às APIs do Firebase, à região das Functions e ao Stripe; `Strict-Transport-Security` com `max-age` de pelo menos um ano (vale só em domínio próprio, E-11); `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` negando câmera e geolocalização, com microfone liberado só para a própria origem enquanto houver entrada por voz (`src/components/TransactionModal.tsx:723-734`); `Cross-Origin-Opener-Policy: same-origin-allow-popups`, compatível com `signInWithPopup`. Teste de configuração ou E2E verifica os headers. No CI: versões fixas, actions por SHA, `permissions: contents: read`, `npm audit` ou dependency review.
- **GAP:** PR-PLAT-03 (P6); REL-11; FIRE-07 (cache de HTML em rotas reescritas).

---

## 11. Código de teste e E2E no artefato

- **CURRENT:** `signInForE2E` com credenciais fixas e auto-cadastro fica no `AuthContext` de produção (`src/contexts/AuthContext.tsx:33,94-114,129`). A conexão aos emuladores depende só de variável de build (`src/lib/firebase.ts:47-62`). `build` e `build:e2e` escrevem no mesmo `dist/` (`package.json:9,27`), e o bloco `hosting` não tem predeploy (`firebase.json:25-30`). Nas Functions, nove `manual*Test.ts` e `testSupport/` são compilados para `lib` e entram no pacote (`functions/src/creditCards/manualCreatePurchaseTest.ts:16-22`; `firebase.json:12-18`); `generateInviteCodeForTest` é exportado pelo módulo de produção (`functions/src/callables/splitGroups.ts:42`).
- **TARGET:** login de teste num módulo exclusivo de teste ou por custom token do Emulator. Build de produção falha se `VITE_E2E_MODE` ou `VITE_USE_FIREBASE_EMULATORS` estiverem ligados, ou se o `projectId` não corresponder ao ambiente. `outDir` separado para E2E. Build de Hosting só no CI, por ambiente. Pacote das Functions sem testes, sem `testSupport` e com `lib` limpo a cada build.
- **GAP:** PR-AUTH-04 (P6); REL-15, ENTRY-22.

---

## 12. Ferramentas destrutivas e acesso operacional

- **CURRENT:** `tools/investments/limpar-investimentos.mjs` tem um override nomeado para o ID do projeto de produção (`:59`, `:88`) e, com as flags, apaga `investment_movements`, valorações e `transactions` (`:144-149,352,409`). A suíte de guarda trata o override como suportado (`tests/tools/limpar-investimentos.guard.test.mjs:229`). Todo script `deploy:*` fixa o projeto de produção (`package.json:22-26`), que também é o ambiente de desenvolvimento (`.firebaserc:3`). Nenhuma função declara `serviceAccount`, então todas usam a conta padrão (`functions/src/shared/runtimeOptions.ts:41-91`; FIRE-09). As negações do harness contra deploy e ferramentas MCP de escrita estão em `.claude/settings.json` (P0; R-01 do plano), mas são proteção de agente, não de IAM (REL-12). O script de ensaio de STAGING recusa o ID de produção, mas não existe projeto de STAGING (`tools/staging/rehearsal.sh:21-41`).
- **TARGET:** a ferramenta aceita só `FIRESTORE_EMULATOR_HOST` ou IDs de DEV numa allowlist, sem override; a suíte de guarda prova que o ID de produção é sempre recusado. Em PROD, a única operação sobre histórico financeiro é estorno ou cancelamento lógico. Projetos DEV, STAGING e PROD separados; deploy de PROD só pelo CD com aprovação e Workload Identity Federation. Service accounts dedicadas por classe de função, cada uma com o papel mínimo de Firestore e acesso só aos segredos que usa. Nenhuma pessoa ou agente com papel de deploy em PROD.
- **GAP:** PR-PLAT-02 (P6), PR-PLAT-01 (P6), PR-REL-01 (P6); FIRE-09, REL-12.
- **EXTERNAL CONFIGURATION REQUIRED:** E-01, E-04, E-12 (NÃO VERIFICADO).

---

## 13. Administração de plataforma

- **CURRENT:** `isAdmin` é lido pelo cliente em `users/{uid}` (`src/contexts/AuthContext.tsx:54-61`), não é autoconcedível (`firestore.rules:148-157`; `tests/firestore/m4-hardening.rules.integration.test.mjs:768-850`) e só esconde a view no cliente (`src/App.tsx:641`). O painel é placeholder (`src/components/AdminDashboard.tsx:39,51,63`). Não há custom claim, callable administrativa nem trilha de auditoria de suporte. Hoje, suporte e atendimento ao titular exigiriam editar dados no console com credenciais amplas e sem registro.
- **TARGET:** custom claim `platformAdmin` concedido por script Admin SDK auditado, com MFA do operador. O claim não abre dados de tenant pelas Rules. Callables administrativas de menor privilégio: consulta somente leitura de tenant e assinatura, execução de pedidos de titular, suspensão com revogação. Trilha imutável (proposta: `admin_audit_logs`) com ator, alvo, motivo e correlation ID. Impersonation só se decidida, com break-glass, consentimento e auditoria.
- **GAP:** PR-ADMIN-01 (P7). **DECISION:** D-10 (implementar ou remover o painel). Detalhe funcional em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §11 e operação em [RUNBOOKS.md](RUNBOOKS.md).

---

## 14. Segurança da IA

| Aspecto | Classificação | Descrição | Evidência / ID |
| --- | --- | --- | --- |
| Chave | CURRENT | Só no backend, via segredo declarado; falha fechada | `functions/src/ai/callables.ts:24-29,107-116` |
| Autorização | CURRENT | Owner, admin ou member do workspace, via `requireWorkspaceRole` | `functions/src/ai/callables.ts:129-133,206-210` |
| Entrada | CURRENT | Análise com Zod `.strict()` e tetos; extração sem `.strict()`; documento de até cerca de 6 MB em base64 | `functions/src/ai/callables.ts:50-72,173-194` |
| Custo | CURRENT | 20 análises/h e 60 extrações/h por par (workspace, usuário); `maxInstances` 10; sem `maxOutputTokens`, orçamento, App Check ou entitlement | `functions/src/ai/callables.ts:44-48,167-171`; `functions/src/shared/runtimeOptions.ts:72-77` |
| Contexto | CURRENT | Montado e enviado pelo cliente; a pergunta é interpolada entre aspas, sem `systemInstruction`; nomes de categoria escritos por qualquer membro entram no prompt | `functions/src/ai/callables.ts:55-70,93-103`; `src/modules/reports/api.ts:230-246` |
| Saída | CURRENT | Análise em texto livre sem validação, renderizada como nós de texto React (sem `dangerouslySetInnerHTML`); extração com `JSON.parse` sem schema, aplicada ao formulário | `functions/src/ai/callables.ts:146-150,240-249`; `src/components/ReportsAIChat.tsx:70-83`; `src/components/TransactionModal.tsx:651-676` |
| Logs | CURRENT | Sem prompt, resposta ou documento; só operação, ator e código de erro | `functions/src/ai/callables.ts:152-158,251-257` |
| Modelo | CURRENT | `gemini-3-flash-preview` com SDK legado e chave do AI Studio | `functions/src/ai/callables.ts:121,224`; FIRE-11 |
| Contexto no servidor | TARGET | O servidor monta o contexto a partir das projeções oficiais do workspace; `systemInstruction` separada; dados delimitados e tratados como conteúdo não confiável; escopo restrito a perguntas financeiras | PR-AI-05 (P5) |
| Saída validada | TARGET | `responseSchema` na chamada e Zod no backend (tipo em enum, `valueCents` inteiro, data `YYYY-MM-DD`); `finishReason` e bloqueio de segurança tratados | PR-AI-05 (P5) |
| Custo | TARGET | Quota por usuário, por workspace e por plano; `maxOutputTokens`; ledger de uso; App Check com `consumeAppCheckToken`; alerta de orçamento | PR-AI-03 (P2); E-08 |
| Dados enviados ao provedor | TARGET | Provedor e tier com termos de tratamento de dados, minimização e transparência | PR-AI-01 (P8); D-11; E-10; [PRIVACY_LGPD.md](PRIVACY_LGPD.md) |
| Chave histórica | GAP | Exposição passada sem rotação comprovada | PR-AI-02 (P0); §9.4 |
| Histórico local | GAP | Histórico do chat em `localStorage` sem `uid` | PR-AI-04 (P5) |

---

## 15. Matriz de controles alvo verificados por teste

Um controle só conta como implementado quando o teste indicado existe, roda no CI (Emulator para tudo que toca Firebase, sem pular em silêncio) e passa. "Parcial" indica teste existente que cobre só parte do controle.

| # | Controle | Camada | Teste exigido | Teste hoje | Milestone | Skill |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Negação cross-tenant A/B nos dois sentidos | Rules e callables | Suítes Emulator por coleção e por callable | Parcial: `m4-hardening:246`, suítes de investimentos e metas, leitura de adjacentes | P1–P5 | `multi-tenant-security-review` |
| 2 | Cliente não escreve dado autoritativo | Rules | Create/update/delete negados por papel | Parcial: investimentos, cartões, metas; nada em adjacentes (RULES-15) | P1, P3, P4 | `multi-tenant-security-review` |
| 3 | Membership, convites, índice e criação de workspace só pelo backend | Rules e callables | Negação nas Rules e integração das callables | Não existe | P1 | `multi-tenant-security-review` |
| 4 | Anti-escalada de papel e invariantes de owner | Rules e callables | Autopromoção, concessão de owner, trancamento do owner, último owner | Parcial: `m4-hardening:257-356`; trancamento não coberto | P1 | `multi-tenant-security-review` |
| 5 | Papel relido na transação; membro removido recusado | Callables | Integração com remoção concorrente | Parcial: `domainV2.integration.test.ts:871-927` (investimentos) | P1 | `multi-tenant-security-review` |
| 6 | `workspaceId` e IDs sem `/` | Callables | Teste negativo no resolvedor e em cada schema | Parcial: investimentos | P1 | `multi-tenant-security-review` |
| 7 | Política de `email_verified` e provedor | Callables e Rules | Token sem e-mail verificado recusado | Não existe | P1 | `multi-tenant-security-review` |
| 8 | Convite de uso único, com expiração e e-mail verificado | Callables | Reuso, expiração, revogação, e-mail divergente, concorrência | Não existe | P1 | `multi-tenant-security-review` |
| 9 | Idempotência e replay | Callables | Replay devolve o mesmo resultado; payload diferente com a mesma chave é recusado | Parcial: cartões, investimentos, metas | P1–P5 | `financial-domain-integrity` |
| 10 | Rate limit e quota | Callables | Teto, concorrência no limite, isolamento | Parcial: `rateLimit.integration.test.ts`; quotas não | P2 | `billing-entitlement-integrity` |
| 11 | App Check obrigatório | Functions | `deploymentContract.test.ts` exige `enforceAppCheck` em toda callable | Não existe | P6 | `firebase-production-readiness` |
| 12 | Segredo ausente falha fechada | Functions | Webhook e checkout sem segredo recusam | Parcial: IA (`readApiKey`) e listas do checkout; Stripe não | P2 | `billing-entitlement-integrity` |
| 13 | Webhook autenticado, idempotente e ordenado | Functions | Assinatura inválida, `event.id` repetido, eventos fora de ordem | Não existe | P2 | `billing-entitlement-integrity` |
| 14 | Headers de segurança e ausência de terceiros em runtime | Hosting | Teste de `firebase.json` e verificação do `dist/` | Não existe | P6 | `firebase-production-readiness` |
| 15 | Bundle de produção sem login E2E nem Emulator | Build | Guard de build e busca no artefato | Não existe | P6 | `firebase-production-readiness` |
| 16 | Pacote das Functions sem código de teste | Build | Lista do pacote sem `manual*Test`, `testSupport` e `*.test.js` | Não existe | P6 | `regression-release-gate` |
| 17 | Ferramenta destrutiva recusa produção | Tooling | Guarda prova recusa sem override | Invertido: `limpar-investimentos.guard.test.mjs:229` aceita o override | P6 | `firebase-production-readiness` |
| 18 | Nenhum segredo no repositório | CI | Gitleaks com padrões Google, Stripe e service account | Parcial: só `AIza` | P6 | `regression-release-gate` |
| 19 | `list` sempre com `limit` | Rules | Consulta sem `limit` negada | Parcial: investimentos e `cash_report_periods` | P3–P6 | `firestore-scale-cost-review` |
| 20 | Nenhuma coleção sem regra explícita | Rules | Enumeração das coleções usadas pelo código | Não existe | P6 | `multi-tenant-security-review` |
| 21 | IA com contexto do servidor e saída validada | Callables | Contexto forjado ignorado; saída fora do schema recusada | Não existe | P5 | `privacy-lgpd-data-lifecycle` |
| 22 | Ações administrativas exigem claim e geram auditoria | Callables | Sem claim, recusa; com claim, evento imutável | Não existe | P7 | `observability-incident-readiness` |
| 23 | Integração não pula sem Emulator no CI | CI | Execução sem Emulator falha | Parcial: suítes usam `skip` (FIRE-13) | P6 | `regression-release-gate` |

---

## 16. GAPs e configuração externa

| ID | Sev. | Milestone | Camada |
| --- | --- | --- | --- |
| PR-AI-02 | BLOCKER | P0 | Segredos (E-00) |
| PR-PLAT-01 | BLOCKER | P6 | Ambientes e acesso operacional |
| PR-PLAT-02 | BLOCKER | P6 | Ferramenta destrutiva |
| PR-RULES-01 | BLOCKER | P3 | Rules de coleções adjacentes (P4 para recurring e split) |
| PR-APPCHK-01 | HIGH | P6 | App Check |
| PR-PLAT-03 | HIGH | P6 | Hosting e supply chain |
| PR-AUTH-04 | HIGH | P6 | Artefato de teste |
| PR-BILL-05 | HIGH | P2 | Segredos Stripe |
| PR-AI-03 | HIGH | P2 | Custo de IA |
| PR-ADMIN-01 | HIGH | P7 | Admin de plataforma |
| PR-OBS-02 | HIGH | P7 | Contenção de incidentes (revogação de sessão, interruptor por funcionalidade, modo somente leitura) |
| PR-REL-01 | HIGH | P6 | CD e proteção de branch |
| PR-RULES-02 | MEDIUM | P6 | Catch-all de leitura |
| PR-AI-05 | MEDIUM | P5 | Contexto e saída da IA |

GAPs de RBAC e membership (PR-WS-01 a PR-WS-06, P1) estão em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §12. MEDIUM/LOW de origem tratados aqui: AUTH-08, AUTH-17, ENTRY-11, ENTRY-12, ENTRY-17, ENTRY-20, ENTRY-21, ENTRY-22, ENTRY-23, FIRE-07, FIRE-09, FIRE-10, FIRE-11, FIRE-12, FIRE-13, REL-11, REL-12, REL-15, RULES-11, RULES-15, RULES-16, WS-13, WS-15.

| ID | Classificação | Item de segurança | Estado |
| --- | --- | --- | --- |
| E-00 | EXTERNAL CONFIGURATION REQUIRED | Rotação da chave Gemini (§9.4) | NÃO VERIFICADO |
| E-01 | EXTERNAL CONFIGURATION REQUIRED | Projetos DEV, STAGING e PROD isolados | NÃO VERIFICADO |
| E-02 | EXTERNAL CONFIGURATION REQUIRED | App Check: chave reCAPTCHA Enterprise por ambiente, enforcement em Firestore, Functions e Auth | NÃO VERIFICADO |
| E-03 | EXTERNAL CONFIGURATION REQUIRED | Auth: provedores, domínios autorizados sem `localhost` em PROD, proteção contra enumeração, MFA para administradores | NÃO VERIFICADO |
| E-04 | EXTERNAL CONFIGURATION REQUIRED | IAM: service accounts mínimas, MFA humano, sem chaves baixadas, Workload Identity Federation | NÃO VERIFICADO |
| E-05 | EXTERNAL CONFIGURATION REQUIRED | Secret Manager por ambiente e política de rotação; restrição das API keys | NÃO VERIFICADO |
| E-08 | EXTERNAL CONFIGURATION REQUIRED | Alertas de segurança (picos de `permission-denied`, falhas de webhook) e orçamento da API de IA | NÃO VERIFICADO |
| E-10 | EXTERNAL CONFIGURATION REQUIRED | Termos do provedor de IA quanto a retenção e treinamento | NÃO VERIFICADO |
| E-11 | EXTERNAL CONFIGURATION REQUIRED | Domínio próprio e TLS, pré-requisito de HSTS | NÃO VERIFICADO |
| E-12 | EXTERNAL CONFIGURATION REQUIRED | Proteção de `main`, checks obrigatórios, environments com aprovação | NÃO VERIFICADO |

O registro verificável de E-01 a E-05 e E-12 fica em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md); o de E-00, na §9.4 deste documento.
