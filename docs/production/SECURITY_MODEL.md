# Modelo de segurança

Referência do programa de Production Readiness para os controles de segurança por camada: identidade, App Check, entrypoints do backend, Firestore Rules, isolamento de tenant, segredos, Hosting e cadeia de suprimentos, artefatos de teste, ferramentas operacionais, administração de plataforma e IA. Baseline auditada: HEAD `9c3ab46`; atualizado após a implementação de P1 (código no repositório e testado no Emulator; nada foi implantado, D-ORD-04). Estado, ordem e IDs canônicos estão no plano mestre, [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md) (§5.14, §5.17, §5.18, §5.23, §5.25 e §6). O gate do tema é a skill `multi-tenant-security-review`. Os controles de plataforma (App Check, IAM, Secret Manager, Hosting, ambientes) passam também por `firebase-production-readiness`, e as Rules podem usar como referência complementar o checklist `firebase:firebase-security-rules-auditor`.

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
| Identidade | Google + login E2E fixo; política de `email_verified`, `auth_time` e provedor no wrapper e suspensão com revogação de sessão no backend (P1); sem blocking functions | Blocking functions e provedores por ambiente (E-03); MFA de admin | PR-AUTH-04; AUTH-17 (AUTH-08 e ENTRY-23 corrigidos em P1, pendentes do gate (PLAN §16)) | P1, P6 |
| App Check | Inexistente | Cliente com reCAPTCHA Enterprise; enforcement em callables, Firestore e Auth | PR-APPCHK-01 | P6 |
| Callables | Wrapper único `defineCallable` em todas as callables (P1); workspace e membership no backend; caixa, empréstimos, clientes, recebíveis, recorrentes e títulos de divisão ainda escritos pelo cliente | Callables autoritativas nos domínios ainda escritos pelo cliente | PR-ENT-01 e itens de domínio; ENTRY-11 (schemas de domínio), ENTRY-12, ENTRY-21 (parcial); PR-WS-02 e ENTRY-20 corrigidos em P1, pendentes do gate (PLAN §16) | P1–P5 |
| Firestore Rules | Default deny, domínios server-only, allowlists em `transactions`; `workspaces`, `members`, convites, auditoria, perfil e índice do usuário `write: false` (P1); dez coleções abertas e catch-all de leitura | `write: false` em tudo que é autoritativo; um `match` por coleção; `list` com `limit` | PR-RULES-01, PR-RULES-02, PR-TX-02, PR-REC-01, PR-CC-02 (PR-WS-05 corrigido em P1, pendente do gate (PLAN §16)) | P1–P6 |
| Isolamento de tenant | Por caminho; nenhum vazamento cross-tenant encontrado; negativos A↔B nos dois sentidos para workspace, membros, convites, auditoria e índice (P1) | Negativos A/B em toda operação | Riscos latentes ENTRY-11 (schemas de domínio); RULES-06 corrigido em P1, pendente do gate (PLAN §16) | P1–P6 |
| RBAC | Membership ativo como única fonte de papel nas Rules e no backend; matriz D-04 e resolvedor único relido na transação (P1) | Mantido | PR-WS-03, PR-WS-04 (corrigidos em P1, pendentes do gate (PLAN §16)) | P1 |
| Segredos | Secret Manager por função; chave de IA só no backend | `defineSecret` sem padrão; segredos por ambiente; rotação | PR-BILL-05, PR-AI-02 | P2, P0 |
| Hosting e supply chain | Sem headers de segurança; Tailwind Play CDN, `esm.sh`, Google Fonts | Build sem terceiros em runtime; CSP e headers | PR-PLAT-03; REL-11 | P6 |
| Artefatos de teste | Login E2E e `dist/` compartilhado; `testSupport`, `__tests__` e `*.test.js` fora do deploy das Functions (P1), mas `manual*Test.ts` ainda no pacote | Build e pacote por ambiente, sem código de teste | PR-AUTH-04; REL-15, ENTRY-22 | P6 |
| Ferramentas e acesso operacional | Utilitário de hard delete com override para produção; projeto único | Ferramentas só em Emulator/DEV; IAM mínimo; CD | PR-PLAT-02, PR-PLAT-01; FIRE-09, REL-12 | P6 |
| Admin de plataforma | `isAdmin` lido no cliente; painel placeholder | Custom claim, callables auditadas ou remoção | PR-ADMIN-01 | P7 |
| IA | Chave no backend, Zod na entrada, RBAC, rate limit | Contexto no servidor, schema de saída, quotas, App Check | PR-AI-02, PR-AI-03, PR-AI-05, PR-AI-01 | P0, P2, P5, P8 |

---

## 3. Identidade

Detalhe em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §2 e §10.1.

- **CURRENT (P1):** o wrapper do kernel aplica a política de token por callable (`functions/src/shared/callable.ts:185-215`): `sign_in_provider` na allowlist (`google.com`; `password` só quando `FUNCTIONS_EMULATOR=true`, `:59-64`), `email_verified` nas callables definidas por D-06 e `auth_time` nos últimos 10 minutos em `transferWorkspaceOwnership` e `archiveWorkspace` (`:67`; `functions/src/workspaces/callables.ts:55-59`). Toda callable recusa conta suspensa (`account_suspended`); `suspendAccount` grava `status: 'suspended'`, desativa o usuário no Auth e revoga as sessões (`functions/src/workspaces/suspension.ts:36`), e as Rules também negam dados de workspace e do índice a conta suspensa (`firestore.rules:28-36`). Nas Rules, `signedIn()` continua sendo só `request.auth != null` (`firestore.rules:5-7`) e não há exigência de `email_verified` (D-06 não prevê helper equivalente). O checkout envia `caller.email` ao Stripe sem exigir `email_verified` (`functions/src/callables/billing.ts:151`; P2). Sem blocking functions nem gatilho de Auth (`functions/src/index.ts:14-41`). Login e-mail/senha de E2E com credenciais fixas no `AuthContext` (`src/contexts/AuthContext.tsx:35,113-133`).
- **TARGET:** blocking functions restringem provedores por ambiente. Sem MFA para usuários comuns; MFA obrigatória para administradores de plataforma (P7).
- **GAP:** PR-AUTH-04 (P6); AUTH-17 (parcial: `auth_time` e reautenticação em P1; MFA de admin em P7); a operação de suspensão por administrador é PR-ADMIN-01 (P7), com o mecanismo já em P1 (D-ORD-03); contenção e revogação de sessão em incidente: PR-OBS-02 (P7). AUTH-08 e ENTRY-23 corrigidos em P1, pendentes do gate (PLAN §16).
- **DECISION:** D-06 (tomada, §9.1 do plano). **EXTERNAL CONFIGURATION REQUIRED:** E-03 (NÃO VERIFICADO).

---

## 4. App Check

- **CURRENT:** inexistente. O cliente não chama `initializeAppCheck` (`src/lib/firebase.ts:1-64`); nenhuma opção de runtime declara `enforceAppCheck` (`functions/src/shared/runtimeOptions.ts:41-91`); o teste de contrato não o verifica. Qualquer script com um ID token chama as 52 callables, inclusive as de IA, que têm custo externo (ENTRY-03). O wrapper do kernel tem o ponto de extensão `APP_CHECK_CALLABLE_OPTIONS` (`functions/src/shared/callable.ts:78-81`), vazio, e registra no log de início se a requisição trouxe token (`:251`).
- **TARGET:** `initializeAppCheck` com `ReCaptchaEnterpriseProvider` antes dos demais serviços, com debug token só em Emulator e E2E. `enforceAppCheck: true` nas classes DOMAIN, HEAVY e AI; `consumeAppCheckToken` (proteção contra replay) nas callables de IA e no checkout. Rollout em modo monitor e depois enforce para Firestore e Auth. `functions/src/shared/deploymentContract.test.ts` passa a exigir a opção em toda callable. O webhook Stripe fica fora do App Check, porque é chamado pelo Stripe; ele se autentica pela assinatura (§6.2).
- **GAP:** PR-APPCHK-01 (P6). **EXTERNAL CONFIGURATION REQUIRED:** E-02 (NÃO VERIFICADO). **DECISION D-33:** período de monitoramento, ordem de enforcement e rollback (detalhe em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md)).

---

## 5. Entrypoints do backend

### 5.1 CURRENT

O `functions/src/index.ts` exporta 58 endpoints: 2 gatilhos Firestore, 52 callables (11 de conta, workspace e membership de P1, 9 de cartões, 23 de investimentos, 3 de metas, 2 de IA, 2 de divisão de contas, 1 de checkout, 1 de rebuild de caixa), 3 crons e 1 webhook. Todos em `southamerica-east1` com `maxInstances`; callables e crons declaram timeout e memória por perfil, cobertos por teste de contrato (`functions/src/shared/runtimeOptions.ts:38-107`; `functions/src/shared/deploymentContract.test.ts`); o gatilho `onWorkspaceDisplayChange` declara região, timeout, memória, `maxInstances` e retry (`functions/src/shared/runtimeOptions.ts:101`; `functions/src/shared/deploymentContract.test.ts:205-214`); webhook e gatilho de caixa usam o padrão da plataforma (`functions/src/webhooks/stripe.ts:31-41`; `functions/src/triggers/transactions.ts:35-37`).

O que já está correto e serve de modelo:

| Domínio | Controle | Evidência |
| --- | --- | --- |
| Cartões (9) | Wrapper único `defineCallable`: Zod, pré-checagem `resolveWorkspaceActor` (autenticação, membership ativa, papel da matriz declarativa), depois `runTransaction` com `reassertWorkspaceActor` e `idempotencyKey` obrigatória (mínimo 16) | `functions/src/creditCards/callable.ts:35-62`; `functions/src/creditCards/createPurchase.ts:434`; `functions/src/creditCards/writeStrategy.ts:55-283`; `functions/src/creditCards/contracts.ts:4` |
| Investimentos (23) | Zod com IDs sem `/`; papel relido dentro da transação (`reassertWorkspaceActor`); chave de idempotência presa ao ator, à operação e ao hash do payload; rate limit reservado na transação | `functions/src/investments/contracts.ts:9-17`; `functions/src/investments/operationsV2.ts:677,1032`; `functions/src/investments/infrastructure.ts:151-200` |
| Metas (3) | Zod estrito, matriz de papéis declarativa, pré-checagem do kernel e releitura na transação, `reserveIdempotency` | `functions/src/goals/callables.ts:57-76`; `functions/src/goals/operations.ts:66,219` |
| Observabilidade de falha | Grava só no workspace já autorizado, nunca no `workspaceId` do payload (o wrapper entrega ao registro de falha apenas o workspace autorizado: `functions/src/shared/callable.ts:126-134`) | `functions/src/investments/callables.ts:82-101`; `functions/src/creditCards/observability.ts:214-223` |
| Rate limit | Contador transacional em Firestore, por ator e workspace ou por usuário, com Rules negando o cliente | `functions/src/shared/rateLimit.ts:55-91`; `firestore.rules:808,1386-1388` |
| Checkout | Allowlist de `priceId` e de origem de retorno por comparação de origem completa; falha fechada com listas vazias; rate limit por usuário | `functions/src/callables/billing.ts:31-68,109-134` |
| Convites de divisão | Código por CSPRNG de 10 caracteres; membership do workspace exigida, o que fechou a escalada cross-tenant INV-P2-037 | `functions/src/callables/splitGroups.ts:33-39,106-113,183-191` |

Fraquezas:

| Fraqueza | Evidência | ID |
| --- | --- | --- |
| Sem backend para empréstimos, clientes, recebíveis e títulos de divisão; esses domínios são escritos pelo cliente | `firestore.rules:1276-1295,1310-1329` | PR-LOAN-01, PR-CR-01 (P3); PR-SPLIT-01 (P4); PR-WS-02 corrigido em P1, pendente do gate (PLAN §16) |
| Nenhum plano ou quota verificado no servidor | `src/hooks/usePlan.ts:36-38` | PR-ENT-01 (P2) |
| `workspaceId` aceita `/` nos schemas de domínio de 18 callables; o resolvedor único recusa o ID antes de qualquer leitura (corrigido em P1, pendente do gate (PLAN §16)) | `functions/src/creditCards/contracts.ts:3`; `functions/src/goals/contracts.ts:5`; `functions/src/shared/workspaceAuth.ts:48-64` | ENTRY-11 (schemas de domínio); WS-15 (corrigido em P1, pendente do gate (PLAN §16)) |
| Papel relido dentro da transação em cartões e metas (`reassertWorkspaceActor`), depois da pré-checagem do kernel | `functions/src/creditCards/createPurchase.ts:434`; `functions/src/goals/operations.ts:219` | ENTRY-20 (corrigido em P1, pendente do gate (PLAN §16)) |
| Cartões e metas sem rate limit | `functions/src/creditCards/callables.ts:163-187` | ENTRY-12 |
| Mapeador único de erros (`toHttpsError`) e detalhes sem `role` nem `allowedRoles`; o limite atingido ainda vira `failed-precondition` | `functions/src/shared/errors.ts:141`; `functions/src/shared/rateLimit.ts:122` | ENTRY-21 (parcial: `resource-exhausted` para limite e quota segue em P2) |
| Erros inesperados são logados pelo wrapper antes do mapeamento (P1); métricas e alertas seguem em P7 | `functions/src/shared/callable.ts:314-318`; `functions/src/cash/rebuild.ts:270-272` | PR-OBS-01 (P7) |
| Papel de dono de grupo lido de `split_participants`, gravável por qualquer member; limite de tentativas revertido pelo `throw` | `functions/src/callables/splitGroups.ts:119-137,222-247` | PR-SPLIT-04 (P4) |
| Schema de extração de IA sem `.strict()` | `functions/src/ai/callables.ts:176-194` | PR-AI-05 (P5) |

### 5.2 Webhook Stripe

- **CURRENT:** a assinatura é verificada com `rawBody` (`functions/src/webhooks/stripe.ts:52`), mas com fallback `whsec_placeholder` quando o segredo falta (`functions/src/webhooks/stripe.ts:8-9`). O webhook declara `cors: true` e devolve `error.message` na resposta (`functions/src/webhooks/stripe.ts:40,55-56`). Não há idempotência por `event.id` nem controle de ordem.
- **TARGET e GAP:** [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md). IDs: PR-BILL-05 (fail-open de segredo), PR-BILL-06 (idempotência e ordem), PR-BILL-01 (ciclo de vida), todos em P2; ENTRY-21 (CORS e eco de erro).

### 5.3 Ordem de verificação de toda callable (CURRENT em P1, salvo onde indicado TARGET)

O wrapper do kernel (D-ORD-02, entregue em P1) executa, nesta ordem:

1. App Check (a partir de P6; ponto de extensão desde P1).
2. Autenticação e política de token (§3).
3. Zod `.strict()`: IDs com o schema único (sem `/`, tamanho máximo), dinheiro em centavos inteiros, strings com teto.
4. Pré-checagem `resolveWorkspaceActor` no wrapper e, dentro da transação da mutação, `reassertWorkspaceActor` ([ARCHITECTURE.md](ARCHITECTURE.md)): relê `users/{uid}`, `workspaces/{id}` e `members/{uid}`, exige conta ativa, membership `active` e workspace não arquivado e aplica a matriz declarativa da operação; o `workspaceId` do payload só é solicitado, e o do log é o autorizado.
5. Rate limit por ator e workspace, e por usuário quando o recurso é global (IA).
6. Entitlement e quota (motor de P2, PR-ENT-01). As callables de P1 não consultam quota; P2 a insere nas transações de `createWorkspace`, `inviteWorkspaceMember` e `acceptWorkspaceInvite` (D-01).
7. Reserva de idempotência presa a ator, workspace, operação e hash do payload.
8. Escritas de domínio, projeções e evento de auditoria append-only no mesmo commit.
9. Erros mapeados por um único módulo (`toHttpsError`), com códigos fechados, mensagem em pt-BR, `details` sanitizados e correlation ID de servidor; erro inesperado registrado no logger estruturado antes da conversão. **TARGET:** `resource-exhausted` para limite e quota (P2); hoje o limite responde `failed-precondition`.

---

## 6. Firestore Rules

### 6.1 CURRENT

Base sólida:

- Default deny fora de `workspaces/{id}` e `users/{uid}`: não existe `match` de nível superior genérico (`firestore.rules:1-3,936,1377`).
- Helpers de membership exigem `status == 'active'` e conta ativa (`firestore.rules:28-64`); `workspaces`, `members`, `invites`, `membership_events`, `users/{uid}` e o índice do usuário são `write: false`, com `list` limitado (`firestore.rules:936-976,1377-1402`).
- Domínios de cartões (compras, parcelas, faturas, pagamentos, ledger e snapshot de limite, eventos, visões), metas e investimentos são `write: false`. Investimentos validam conteúdo no `get` e exigem `limit` de até 100 no `list`; `cash_report_periods` exige `limit` de até 600; chaves de idempotência e `cash_period_events` são negadas nos dois sentidos (`firestore.rules:413-415,1046-1275`).
- Allowlist de chaves em `transactions` (`users`, `workspaces` e `members` são server-owned desde P1); `type` de transação imutável; `delete` de `transactions` negado, com baixa lógica (`firestore.rules:97-99,145,1019`).
- Sete suítes de Rules no Emulator, no CI e no `predeploy:rules`, entre elas `tests/firestore/workspaces-p1.rules.integration.test.mjs` (`.github/workflows/quality-gate.yml:74-110`; `package.json:22,37`).

Exposição:

| Grupo | Coleções | Situação | ID |
| --- | --- | --- | --- |
| Escrita livre de member, sem schema, com delete | `recurring_expenses`, `recurring_occurrences`, `loans`, `loan_movements`, `clients`, `receivables`, `split_groups`, `split_participants`, `split_bills`, `split_shares` | `allow write: if canMemberWriteWorkspaceScopedData` (`firestore.rules:1097-1105,1351-1369,1384-1402`) | PR-RULES-01 (P3/P4) |
| Caixa escrito pelo cliente | `transactions` | Create/update pelo cliente em float; espelhos gravados pelo backend editáveis e vínculos de origem forjáveis (`firestore.rules:67-76,243-248,1056-1087`) | PR-TX-01, PR-TX-02 (P3) |
| Configuração de cartão | `credit_cards` | Limite, ciclo e status gravados por owner/admin; delete físico (`firestore.rules:966-988,1118`) | PR-CC-01, PR-CC-02 (P4) |
| Controle de acesso | `workspaces`, `members`, `users/{uid}/workspaces` | **Corrigido em P1 (pendente do gate, PLAN §16):** `write: false`; papel só do membership ativo; sem espelho autogravado nem regime `ownerId` (`firestore.rules:936-976,1377-1402`) | PR-WS-01…PR-WS-05 (corrigidos em P1, pendentes do gate (PLAN §16)) |
| Catch-all de leitura | Toda subcoleção fora de `isBackendOwnedCollection`, hoje `activity_logs` (autor e saldos) e `split_invites` (códigos de convite); `members`, `invites` e `membership_events` (P1) têm bloco próprio e ficam fora do catch-all | Legível por qualquer membro, inclusive `viewer`, sem `limit` (`firestore.rules:791-820,1362-1367`) | PR-RULES-02 (P6) |
| Listagem sem teto | `transactions`, `notifications`, adjacentes, `credit_cards`, `activity_logs` (`members` e o índice do usuário ganharam teto em P1) | Sem `request.query.limit` | RULES-11 |
| Validação fraca | Timestamps livres, strings e mapas sem teto (`members.status` foi corrigido em P1, pendente do gate (PLAN §16): enum gravado só pelo backend) | `firestore.rules:97-99` | RULES-16 |
| Storage | Bucket padrão | `getStorage` exportado sem uso, sem `storage.rules` versionado (`src/lib/firebase.ts:4,39`) | FIRE-12 |
| Testes | Adjacentes, cartões, notificações | Sem teste de escrita nem negação (`tests/firestore/adjacent-modules.rules.integration.test.mjs:129-243` só lê); o índice do usuário passou a ter teste em P1 | PR-REL-02 (P3); RULES-15 |

**Nota do checklist `firebase-security-rules-auditor`:** a auditoria `firestore-rules` da baseline atribuiu **1 (Critical)**; os itens de workspace e membership foram corrigidos em P1, pendentes do gate (PLAN §16). O motivo é o cliente continuar gravando dados financeiros autoritativos sem schema, com hard delete, apesar da base sólida.

### 6.2 TARGET

- Todas as coleções financeiras e de controle com `allow write: if false`, com escrita só por callable. A troca de cada coleção acontece no mesmo milestone do seu callable (risco R-02): `workspaces`, `members`, `invites`, `membership_events` e índice do usuário em P1 (entregue); `transactions`, `loans`, `loan_movements`, `clients` e `receivables` em P3; `recurring_*`, `split_*` e `credit_cards` em P4; `notifications` em P5.
- Escrita direta do cliente só em dados não financeiros do próprio usuário (allowlist de perfil) e no estado de leitura de notificação por usuário, com `hasOnly`, tipos, tetos e `request.time`.
- Um `match` explícito por coleção, `get` e `list` separados, `list` sempre com `request.query.limit`, papel mínimo por coleção e nenhum catch-all. Um teste enumera as coleções usadas pelo código e falha se alguma não tiver regra explícita.
- Um único helper de papel baseado no membership ativo, sem `isWorkspaceOwnerByParent` ([AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §6.3); entregue em P1.
- `storage.rules` com deny-all versionado, ou remoção de `getStorage`.
- Suíte por coleção cobrindo owner, admin, member, `viewer` (somente leitura, D-02), removido, não membro e não autenticado, com create, update, delete, get e list, cross-tenant nos dois sentidos e payload inválido.

---

## 7. Isolamento de tenant

- **CURRENT:** o isolamento é por caminho (`workspaces/{workspaceId}/...`), e as Rules resolvem membership pelo `workspaceId` do caminho. A auditoria não encontrou vazamento cross-tenant nos domínios de conta e workspaces, transações, investimentos, metas, cartões, recorrentes, empréstimos, divisão de contas e clientes/recebíveis. Evidências: `tests/firestore/m4-hardening.rules.integration.test.mjs:246`; suítes `investment-*.rules` e `goals.rules`; `tests/firestore/investment-domain.rules.integration.test.mjs:615-635`; o cron de recorrentes deriva o workspace do caminho (`functions/src/crons/recurring.ts:436`); os convites de divisão exigem membership (`functions/src/callables/splitGroups.ts:106-113`); a observabilidade de falha só grava no workspace autorizado (§5.1); o rate limit é isolado por ator e workspace (`functions/src/shared/__tests__/rateLimit.integration.test.ts`).
- **Riscos latentes (não explorados):**
  - `workspaceId` com `/` apontava para documento aninhado e permitia um pseudo-tenant sob um workspace real, com papel `owner` derivado de um `ownerId` gravado numa coleção sem schema (ENTRY-11, WS-15). Corrigido em P1 (pendente do gate, PLAN §16) no resolvedor: o ID é validado antes da leitura e o `ownerId` não autoriza (`functions/src/shared/workspaceAuth.ts:48-64`; `functions/src/shared/__tests__/workspaceAuth.integration.test.ts:86,132`). Os schemas de domínio ainda aceitam a string até o resolvedor (ENTRY-11).
  - RULES-06 (corrigido em P1, pendente do gate (PLAN §16)): o create de workspace é negado ao cliente (`firestore.rules:944`) e `archiveWorkspace` mantém o documento-pai como marcador, o que impede recriar um ID liberado e assumir subcoleções órfãs (`functions/src/workspaces/lifecycle.ts:394-437`).
  - Criação ilimitada de workspaces multiplica todo limite por workspace (PR-AI-03, P2).

Riscos intra-workspace (o member ou admin é o atacante):

| Risco | Evidência | ID |
| --- | --- | --- |
| Member apaga ou reescreve empréstimos, recebíveis, rateios e recorrências | `firestore.rules:1097-1105,1351-1402` | PR-RULES-01 (P3/P4) |
| Owner/admin editam ou anulam espelhos de caixa gravados pelo backend; member forja vínculo de pagamento de fatura | `firestore.rules:67-76,243-248` | PR-TX-02 (P3) |
| Member marca ocorrências futuras como geradas e o cron deixa de cobrar | `firestore.rules:1102-1105` | PR-REC-01 (P4) |
| Member se declara dono de grupo de divisão | `firestore.rules:1389-1392` | PR-SPLIT-04 (P4) |
| Co-owner ou admin tranca o owner fora do workspace (corrigido em P1, pendente do gate (PLAN §16): ninguém altera o próprio papel e o owner só muda por transferência) | `functions/src/workspaces/rbac.ts:20-50`; `firestore.rules:951-958` | PR-WS-04 (corrigido em P1, pendente do gate (PLAN §16)) |
| Admin cria outros admins e remove admins sem trilha (corrigido em P1, pendente do gate (PLAN §16): admin não gere admin, D-04, e toda mutação gera `membership_events`) | `functions/src/workspaces/rbac.ts:20-50`; `functions/src/shared/audit.ts:58` | WS-13 (corrigido em P1, pendente do gate (PLAN §16)) |
| Qualquer membro lê `activity_logs` e códigos de `split_invites` | `firestore.rules:1436-1442` | PR-RULES-02 (P6) |
| Membro gravava papel falso no próprio espelho e recebia a UI de gestão (corrigido em P1, pendente do gate (PLAN §16): o índice não tem papel e é `write: false`; a UI lê o papel do membership) | `firestore.rules:1398-1402`; `src/modules/workspaces/api.ts:144-168` | PR-WS-03 (corrigido em P1, pendente do gate (PLAN §16)) |
| Categoria criada por um membro injeta instrução no prompt de IA do owner | `functions/src/ai/callables.ts:55-70,93-103` | PR-AI-05 (P5) |
| Histórico de chat de IA no `localStorage` sem `uid`, apagado no logout e na troca de conta desde P1 (`src/lib/sessionCleanup.ts:18-40`); a migração para o servidor segue em P5 | `src/modules/reports/hooks.ts:343-358` | PR-AI-04 (P5) |
| `activity_logs` atribui a alteração ao criador, não ao ator | `functions/src/triggers/transactions.ts:108` | ENTRY-17 |

- **TARGET:** testes negativos com tenants A e B, nos dois sentidos, para toda operação alterada em Rules e callables; `workspaceId` validado no resolvedor antes de qualquer caminho; nenhuma decisão de confiança tomada a partir de campo gravável pelo cliente.

---

## 8. RBAC

Papéis `owner`, `admin`, `member` e `viewer` por membership de workspace, com `viewer` estritamente somente leitura (D-02, tomada). As matrizes atual e alvo, a invariante de um único owner canônico (D-03), os poderes de owner e admin (D-04) e o resolvedor único estão em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §6 e §7.

Pontos de segurança (P1): as Rules negam toda escrita em `members` e a matriz D-04 é aplicada no backend, com testes (`functions/src/workspaces/__tests__/memberships.integration.test.ts:61,98`; `tests/firestore/workspaces-p1.rules.integration.test.mjs:192`). O regime duplo `ownerId` × membership foi removido (PR-WS-03 corrigido em P1, pendente do gate (PLAN §16)). O papel exibido na UI vem do membership ativo (`src/modules/workspaces/api.ts:144-168`), e as decisões de autorização continuam no servidor.

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

- **CURRENT:** `signInForE2E` com credenciais fixas e auto-cadastro fica no `AuthContext` de produção (`src/contexts/AuthContext.tsx:35,113-133,150`). A conexão aos emuladores depende só de variável de build (`src/lib/firebase.ts:47-62`). `build` e `build:e2e` escrevem no mesmo `dist/` (`package.json:9,27`), e o bloco `hosting` não tem predeploy (`firebase.json:25-30`). Nas Functions, nove `manual*Test.ts` são compilados para `lib` e entram no pacote (`functions/src/creditCards/manualCreatePurchaseTest.ts:16-22`); `testSupport/`, `__tests__/` e `*.test.js` são excluídos do deploy por `firebase.json` desde P1 (`firebase.json:9-26`), e um teste de contrato impede que módulos de teste sejam alcançáveis pelo entrypoint (`functions/src/shared/deploymentContract.test.ts:216-246`); `generateInviteCodeForTest` é exportado pelo módulo de produção (`functions/src/callables/splitGroups.ts:42`).
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

- **CURRENT:** `isAdmin` é lido pelo cliente em `users/{uid}` (`src/contexts/AuthContext.tsx:71-80`), não é autoconcedível (`firestore.rules:1377-1381`; `tests/firestore/m4-hardening.rules.integration.test.mjs:912`) e só esconde a view no cliente (`src/App.tsx:649`). O painel é placeholder (`src/components/AdminDashboard.tsx:39,51,63`). Não há custom claim, callable administrativa nem trilha de auditoria de suporte. Hoje, suporte e atendimento ao titular exigiriam editar dados no console com credenciais amplas e sem registro.
- **TARGET:** custom claim `platformAdmin` concedido por script Admin SDK auditado, com MFA do operador. O claim não abre dados de tenant pelas Rules. Callables administrativas de menor privilégio: consulta somente leitura de tenant e assinatura, execução de pedidos de titular, suspensão com revogação. Trilha imutável (proposta: `admin_audit_logs`) com ator, alvo, motivo e correlation ID. Impersonation só se decidida, com break-glass, consentimento e auditoria.
- **GAP:** PR-ADMIN-01 (P7). **DECISION:** D-10 (implementar ou remover o painel). Detalhe funcional em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §11 e operação em [RUNBOOKS.md](RUNBOOKS.md).

---

## 14. Segurança da IA

| Aspecto | Classificação | Descrição | Evidência / ID |
| --- | --- | --- | --- |
| Chave | CURRENT | Só no backend, via segredo declarado; falha fechada | `functions/src/ai/callables.ts:24-29,107-116` |
| Autorização | CURRENT | Owner, admin ou member do workspace, pela pré-checagem do kernel (`workspaceRoles`) e por `reassertWorkspaceActor` na transação | `functions/src/ai/callables.ts:63,182-186,238-242` |
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
| 1 | Negação cross-tenant A/B nos dois sentidos | Rules e callables | Suítes Emulator por coleção e por callable | Parcial: `m4-hardening:246`, suítes de investimentos e metas, leitura de adjacentes; workspace, membros, convites, auditoria e índice cobertos em P1 (`tests/firestore/workspaces-p1.rules.integration.test.mjs:173-339`; `functions/src/workspaces/__tests__/memberships.integration.test.ts:240`) | P1–P5 | `multi-tenant-security-review` |
| 2 | Cliente não escreve dado autoritativo | Rules | Create/update/delete negados por papel | Parcial: investimentos, cartões, metas, workspace, membros, convites, auditoria, perfil e índice (P1); nada em adjacentes (RULES-15) | P1, P3, P4 | `multi-tenant-security-review` |
| 3 | Membership, convites, índice e criação de workspace só pelo backend | Rules e callables | Negação nas Rules e integração das callables | Existe (P1): `tests/firestore/workspaces-p1.rules.integration.test.mjs:183-261`; `functions/src/workspaces/__tests__/` | P1 | `multi-tenant-security-review` |
| 4 | Anti-escalada de papel e invariantes de owner | Rules e callables | Autopromoção, concessão de owner, trancamento do owner, último owner | Existe (P1): `functions/src/workspaces/__tests__/memberships.integration.test.ts:98,184`; `functions/src/workspaces/__tests__/ownership.integration.test.ts:147,171`; `tests/firestore/workspaces-p1.rules.integration.test.mjs:192` | P1 | `multi-tenant-security-review` |
| 5 | Papel relido na transação; membro removido recusado | Callables | Integração com remoção concorrente | Existe (P1): `functions/src/shared/__tests__/workspaceAuth.integration.test.ts:145`; `functions/src/workspaces/__tests__/memberships.integration.test.ts:203,316`; investimentos em `functions/src/investments/__tests__/domainV2.integration.test.ts:893` | P1 | `multi-tenant-security-review` |
| 6 | `workspaceId` e IDs sem `/` | Callables | Teste negativo no resolvedor e em cada schema | Parcial: resolvedor (`functions/src/shared/__tests__/workspaceAuth.integration.test.ts:132`) e schemas de P1 (`functions/src/workspaces/__tests__/workspaceUnits.test.ts:467`) e de investimentos; schemas dos demais domínios em P3–P5 | P1 | `multi-tenant-security-review` |
| 7 | Política de `email_verified` e provedor | Callables e Rules | Token sem e-mail verificado recusado | Existe nas callables (P1): `functions/src/shared/__tests__/kernel.test.ts:584,606,634`; `functions/src/workspaces/__tests__/invites.integration.test.ts:223`; as Rules não exigem e-mail verificado (D-06) | P1 | `multi-tenant-security-review` |
| 8 | Convite de uso único, com expiração e e-mail verificado | Callables | Reuso, expiração, revogação, e-mail divergente, concorrência | Existe (P1): `functions/src/workspaces/__tests__/invites.integration.test.ts:145-349` | P1 | `multi-tenant-security-review` |
| 9 | Idempotência e replay | Callables | Replay devolve o mesmo resultado; payload diferente com a mesma chave é recusado | Parcial: cartões, investimentos, metas e callables de workspace (`functions/src/workspaces/__tests__/workspaceLifecycle.integration.test.ts:155`; `functions/src/workspaces/__tests__/ownership.integration.test.ts:135`) | P1–P5 | `financial-domain-integrity` |
| 10 | Rate limit e quota | Callables | Teto, concorrência no limite, isolamento | Parcial: `rateLimit.integration.test.ts`; quotas não | P2 | `billing-entitlement-integrity` |
| 11 | App Check obrigatório | Functions | `deploymentContract.test.ts` exige `enforceAppCheck` em toda callable | Não existe | P6 | `firebase-production-readiness` |
| 12 | Segredo ausente falha fechada | Functions | Webhook e checkout sem segredo recusam | Parcial: IA (`readApiKey`) e listas do checkout; Stripe não | P2 | `billing-entitlement-integrity` |
| 13 | Webhook autenticado, idempotente e ordenado | Functions | Assinatura inválida, `event.id` repetido, eventos fora de ordem | Não existe | P2 | `billing-entitlement-integrity` |
| 14 | Headers de segurança e ausência de terceiros em runtime | Hosting | Teste de `firebase.json` e verificação do `dist/` | Não existe | P6 | `firebase-production-readiness` |
| 15 | Bundle de produção sem login E2E nem Emulator | Build | Guard de build e busca no artefato | Não existe | P6 | `firebase-production-readiness` |
| 16 | Pacote das Functions sem código de teste | Build | Lista do pacote sem `manual*Test`, `testSupport` e `*.test.js` | Parcial (P1): `functions/src/shared/deploymentContract.test.ts:216-246` cobre `testSupport`, `__tests__` e `*.test.js`; `manual*Test` seguem no pacote | P6 | `regression-release-gate` |
| 17 | Ferramenta destrutiva recusa produção | Tooling | Guarda prova recusa sem override | Invertido: `limpar-investimentos.guard.test.mjs:229` aceita o override | P6 | `firebase-production-readiness` |
| 18 | Nenhum segredo no repositório | CI | Gitleaks com padrões Google, Stripe e service account | Parcial: só `AIza` | P6 | `regression-release-gate` |
| 19 | `list` sempre com `limit` | Rules | Consulta sem `limit` negada | Parcial: investimentos e `cash_report_periods` | P3–P6 | `firestore-scale-cost-review` |
| 20 | Nenhuma coleção sem regra explícita | Rules | Enumeração das coleções usadas pelo código | Não existe | P6 | `multi-tenant-security-review` |
| 21 | IA com contexto do servidor e saída validada | Callables | Contexto forjado ignorado; saída fora do schema recusada | Não existe | P5 | `privacy-lgpd-data-lifecycle` |
| 22 | Ações administrativas exigem claim e geram auditoria | Callables | Sem claim, recusa; com claim, evento imutável | Não existe | P7 | `observability-incident-readiness` |
| 23 | Integração não pula sem Emulator no CI | CI | Execução sem Emulator falha | Parcial: as suítes de P1 e do kernel falham sem Emulator (`functions/src/shared/testSupport/kernelTestSupport.ts:22`); outras suítes ainda usam `skip` (FIRE-13) | P6 | `regression-release-gate` |

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

GAPs de RBAC e membership (PR-WS-01 a PR-WS-06, corrigidos em P1, pendentes do gate (PLAN §16)) estão em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §12. Corrigidos em P1 (pendentes do gate, PLAN §16) entre os MEDIUM/LOW de origem: AUTH-08, ENTRY-20, ENTRY-23, RULES-11, RULES-16, WS-13 e WS-15 (ENTRY-21 parcial; ver [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §12). MEDIUM/LOW de origem tratados aqui: AUTH-08, AUTH-17, ENTRY-11, ENTRY-12, ENTRY-17, ENTRY-20, ENTRY-21, ENTRY-22, ENTRY-23, FIRE-07, FIRE-09, FIRE-10, FIRE-11, FIRE-12, FIRE-13, REL-11, REL-12, REL-15, RULES-11, RULES-15, RULES-16, WS-13, WS-15.

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
