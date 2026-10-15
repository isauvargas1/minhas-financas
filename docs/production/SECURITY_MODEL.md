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
7. **Dado pessoal a terceiro só o necessário.** O checkout cria o Customer no Stripe com o e-mail do usuário somente se `email_verified` (`functions/src/billing/checkout.ts:278-281`); dados de cartão nunca trafegam pela aplicação (Checkout hospedado).

---

## 2. Resumo por camada

| Camada | CURRENT | TARGET | GAP | Milestone |
| --- | --- | --- | --- | --- |
| Identidade | Google + login E2E fixo; política de `email_verified`, `auth_time` e provedor no wrapper e suspensão com revogação de sessão no backend (P1); sem blocking functions | Blocking functions e provedores por ambiente (E-03); MFA de admin | PR-AUTH-04; AUTH-17 (AUTH-08 e ENTRY-23 fechados em P1 (PLAN §16.4)) | P1, P6 |
| App Check | Inexistente | Cliente com reCAPTCHA Enterprise; enforcement em callables, Firestore e Auth | PR-APPCHK-01 | P6 |
| Callables | Wrapper único `defineCallable` em todas as callables (P1); workspace e membership no backend; empréstimos só por callable desde a P3-H, clientes e recebíveis desde a P3-I (8 callables) e contas/carteiras e transferências desde a P3-J (6 callables); Recorrentes só por callable desde a P4-B (8 callables, `functions/src/recurring/callables.ts`); caixa (produtores de outros domínios) e títulos de divisão ainda escritos pelo cliente | Callables autoritativas nos domínios ainda escritos pelo cliente | PR-ENT-01 e itens de domínio; ENTRY-11 (schemas de domínio), ENTRY-12, ENTRY-21 (parcial); PR-WS-02 e ENTRY-20 fechados em P1 (PLAN §16.4) | P1–P5 |
| Firestore Rules | Default deny, domínios server-only, `transactions` sem escrita do cliente (P4-D); `workspaces`, `members`, convites, auditoria, perfil e índice do usuário `write: false` (P1); coleções adjacentes ainda abertas (clientes e recebíveis fechados na P3-I; contas, movimentos, transferências e eventos de contas fechados na P3-J) e catch-all de leitura | `write: false` em tudo que é autoritativo; um `match` por coleção; `list` com `limit` | PR-RULES-01, PR-RULES-02, (PR-TX-02 resolvido na P4-D, plano §19.4; PR-CC-02 resolvido na P4-A, plano §19.1; PR-REC-01 resolvido na P4-B, plano §19.2; PR-WS-05 fechado em P1 (PLAN §16.4)) | P1–P6 |
| Isolamento de tenant | Por caminho; nenhum vazamento cross-tenant encontrado; negativos A↔B nos dois sentidos para workspace, membros, convites, auditoria e índice (P1) | Negativos A/B em toda operação | Riscos latentes ENTRY-11 (schemas de domínio); RULES-06 fechado em P1 (PLAN §16.4) | P1–P6 |
| RBAC | Membership ativo como única fonte de papel nas Rules e no backend; matriz D-04 e resolvedor único relido na transação (P1) | Mantido | PR-WS-03, PR-WS-04 (fechados em P1, PLAN §16.4) | P1 |
| Segredos | Secret Manager por função; chave de IA só no backend; Stripe sem valor padrão nem fallback, com falha fechada (P2A, `functions/src/billing/config.ts:72-112`) | `defineSecret` sem padrão; segredos por ambiente; rotação; configuração não secreta como parâmetro de ambiente | PR-AI-02; FIRE-10 (P6); PR-BILL-05 fechado em P2A (PLAN §17.3) | P0, P6 |
| Hosting e supply chain | Sem headers de segurança; Google Fonts em runtime (Tailwind Play CDN e `esm.sh` removidos em P2C-H2) | Build sem terceiros em runtime; CSP e headers | PR-PLAT-03; REL-11 | P6 |
| Artefatos de teste | Login E2E e `dist/` compartilhado; `testSupport`, `__tests__` e `*.test.js` fora do deploy das Functions (P1), mas `manual*Test.ts` ainda no pacote | Build e pacote por ambiente, sem código de teste | PR-AUTH-04; REL-15, ENTRY-22 | P6 |
| Ferramentas e acesso operacional | Utilitário de hard delete com override para produção; projeto único | Ferramentas só em Emulator/DEV; IAM mínimo; CD | PR-PLAT-02, PR-PLAT-01; FIRE-09, REL-12 | P6 |
| Admin de plataforma | `isAdmin` lido no cliente; painel placeholder | Custom claim, callables auditadas ou remoção | PR-ADMIN-01 | P7 |
| IA | Chave no backend; payload estrito; RBAC relido na transação; rate limit; contexto montado no servidor e saída validada por schema (P5-E1) | Confirmação por operação antes do envio; rotação da chave (E-00); App Check; alerta de orçamento | PR-AI-02, PR-AI-01 (abertos); PR-AI-05 tratado na P5-E1, milestone não concluída: gate `FAIL` por bloqueadores alheios ao código | P0, P6, P8 |

---

## 3. Identidade

Detalhe em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §2 e §10.1.

- **CURRENT (P1):** o wrapper do kernel aplica a política de token por callable (`functions/src/shared/callable.ts:185-215`): `sign_in_provider` na allowlist (`google.com`; `password` só quando `FUNCTIONS_EMULATOR=true`, `:59-64`), `email_verified` nas callables definidas por D-06 e `auth_time` nos últimos 10 minutos em `transferWorkspaceOwnership` e `archiveWorkspace` (`:67`; `functions/src/workspaces/callables.ts:55-59`). Toda callable recusa conta suspensa (`account_suspended`); `suspendAccount` grava `status: 'suspended'`, desativa o usuário no Auth e revoga as sessões (`functions/src/workspaces/suspension.ts:36`), e as Rules também negam dados de workspace e do índice a conta suspensa (`firestore.rules:28-36`). Nas Rules, `signedIn()` continua sendo só `request.auth != null` (`firestore.rules:5-7`) e não há exigência de `email_verified` (D-06 não prevê helper equivalente). O checkout só envia `caller.email` ao Stripe quando o e-mail é verificado, mas não exige `email_verified` para contratar (`functions/src/billing/checkout.ts:278`; P2A). Sem blocking functions nem gatilho de Auth (`functions/src/index.ts:14-41`). Login e-mail/senha de E2E com credenciais fixas no `AuthContext` (`src/contexts/AuthContext.tsx:35,113-133`).
- **TARGET:** blocking functions restringem provedores por ambiente. Sem MFA para usuários comuns; MFA obrigatória para administradores de plataforma (P7).
- **GAP:** PR-AUTH-04 (P6); AUTH-17 (parcial: `auth_time` e reautenticação em P1; MFA de admin em P7); a operação de suspensão por administrador é PR-ADMIN-01 (P7), com o mecanismo já em P1 (D-ORD-03); contenção e revogação de sessão em incidente: PR-OBS-02 (P7). AUTH-08 e ENTRY-23 fechados em P1 (PLAN §16.4).
- **DECISION:** D-06 (tomada, §9.1 do plano). **EXTERNAL CONFIGURATION REQUIRED:** E-03 (NÃO VERIFICADO).

---

## 4. App Check

- **CURRENT:** inexistente. O cliente não chama `initializeAppCheck` (`src/lib/firebase.ts:1-64`); nenhuma opção de runtime declara `enforceAppCheck` (`functions/src/shared/runtimeOptions.ts:41-91`); o teste de contrato não o verifica. Qualquer script com um ID token chama as 52 callables, inclusive as de IA, que têm custo externo (ENTRY-03). O wrapper do kernel tem o ponto de extensão `APP_CHECK_CALLABLE_OPTIONS` (`functions/src/shared/callable.ts:78-81`), vazio, e registra no log de início se a requisição trouxe token (`:251`).
- **TARGET:** `initializeAppCheck` com `ReCaptchaEnterpriseProvider` antes dos demais serviços, com debug token só em Emulator e E2E. `enforceAppCheck: true` nas classes DOMAIN, HEAVY e AI; `consumeAppCheckToken` (proteção contra replay) nas callables de IA e no checkout. Rollout em modo monitor e depois enforce para Firestore e Auth. `functions/src/shared/deploymentContract.test.ts` passa a exigir a opção em toda callable. O webhook Stripe fica fora do App Check, porque é chamado pelo Stripe; ele se autentica pela assinatura (§6.2).
- **GAP:** PR-APPCHK-01 (P6). **EXTERNAL CONFIGURATION REQUIRED:** E-02 (NÃO VERIFICADO). **DECISION D-33:** período de monitoramento, ordem de enforcement e rollback (detalhe em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md)).

---

## 5. Entrypoints do backend

### 5.1 CURRENT

O `functions/src/index.ts` exporta, recontado no gate de P4 (plano §19.7, sobre os exports carregados de `functions/lib/index.js`), 108 endpoints: 101 callables, 4 agendados, 2 gatilhos Firestore e 1 webhook HTTP. Entre eles estão os 13 de cartões (P4-A; a rotina de faturas é `processCreditCardInvoiceClosing`), os 8 de Recorrentes (P4-B), os 22 da Divisão de contas (P4-C), os 9 de investimentos que sobraram da P4-D (23 → 9; plano §19.4) e os 3 do catálogo de configurações (P4-E, D-23: `createSettingsCatalogItem`, `updateSettingsCatalogItem`, `archiveSettingsCatalogItem`; plano §19.6). O detalhamento a seguir é o da baseline anterior (60 endpoints, 54 callables) e não inclui as callables acrescentadas depois, entre elas as 8 de clientes e recebíveis da P3-I e as 6 de contas e transferências da P3-J: 2 gatilhos Firestore, 54 callables (11 de conta, workspace e membership de P1, 9 de cartões (13 desde a P4-A), 23 de investimentos (9 desde a P4-D), 3 de metas, 2 de IA, 2 de divisão de contas, 3 de billing de P2A — `getBillingCatalog`, `createCheckoutSession`, `createBillingPortalSession` —, 1 de rebuild de caixa), 3 crons e 1 webhook. Todos em `southamerica-east1` com `maxInstances`; callables e crons declaram timeout e memória por perfil, cobertos por teste de contrato (`functions/src/shared/runtimeOptions.ts:38-107`; `functions/src/shared/deploymentContract.test.ts`); o gatilho `onWorkspaceDisplayChange` declara região, timeout, memória, `maxInstances` e retry (`functions/src/shared/runtimeOptions.ts:101`; `functions/src/shared/deploymentContract.test.ts:205-214`); o webhook Stripe declara perfil próprio de runtime (60 s, 256 MiB, `maxInstances` 10: `functions/src/shared/runtimeOptions.ts:84-89`) e o gatilho de caixa usa o padrão da plataforma (`functions/src/triggers/transactions.ts:35-37`).

O que já está correto e serve de modelo:

| Domínio | Controle | Evidência |
| --- | --- | --- |
| Cartões (13, P4-A) | Callables em `functions/src/cards/callables.ts`: Zod estrito, centavos inteiros, papel relido na transação (cadastro, pagamento, ajuste e reconciliação: owner/admin; compras: owner/admin/member, member só as próprias), idempotência por intenção (`reserveActorIdempotency`: chave do ator + hash do payload), rate limit e `expectedUpdatedAt` nas mutações de estado | `functions/src/cards/callables.ts`; `functions/src/cards/common.ts`; `functions/src/cards/contracts.ts` |
| Investimentos (9 desde a P4-D; `reverseInvestmentMovement` só owner/admin) | Zod com IDs sem `/`; papel relido dentro da transação (`reassertWorkspaceActor`); chave de idempotência presa ao ator, à operação e ao hash do payload; rate limit reservado na transação | `functions/src/investments/contracts.ts`; `functions/src/investments/operationsV2.ts`; `functions/src/investments/infrastructure.ts` |
| Contas/carteiras e transferências (6, P3-J, D-30) | `createCashAccount`, `updateCashAccount` (só nome e tipo; o saldo nunca é editável), `archiveCashAccount` (só com saldo 0; sem exclusão física) e `reactivateCashAccount`: owner/admin. `createCashTransfer`: owner/admin/member, contas ativas distintas do mesmo workspace, valor positivo, data ≤ hoje (São Paulo), um commit atômico com duas pernas, nunca receita, despesa nem `transactions`. `reverseCashTransfer`: owner/admin qualquer uma, member só a própria (`createdBy`), movimentos compensatórios; segundo estorno recusado, replay idempotente. Wrapper `defineCallable` com `DOMAIN_CALLABLE_OPTIONS`, Zod `.strict()`; autorização relida na transação; idempotência por intenção (recibo em `users/{uid}/idempotency_keys` e âncora durável no evento, consulta `intentId, operation` com limite 1); `expectedUpdatedAt` com nanossegundos; leitores fail-closed; limites operacionais `cashAccountMutation` e `cashTransferMutation` (60 por 10 minutos por ator; não são cota comercial) | `functions/src/accounts/callables.ts`; `functions/src/accounts/__tests__/accountsLifecycle.integration.test.ts` |
| Clientes e recebíveis (8, P3-I) | Wrapper `defineCallable` com perfil `DOMAIN_CALLABLE_OPTIONS`, Zod `.strict()`; autorização relida na transação (conta ativa, membership ativo, papel, workspace ativo, espaço PJ); `createdBy` gravado pelo backend; idempotência por intenção com âncora durável no evento; `expectedUpdatedAt`; falha fechada fora do schema; limite operacional de 60 por 10 minutos por ator; sem PII em eventos, espelhos, logs nem respostas | `functions/src/receivables/callables.ts`; `functions/src/receivables/common.ts`; `functions/src/receivables/__tests__/receivableGuards.integration.test.ts` |
| Metas (7, P5-B) | Zod estrito, matriz de papéis declarativa (`GOAL_OPERATION_ROLES`), pré-checagem do kernel e releitura na transação nas mutações, idempotência por ator + operação. Mutações `createGoal`, `updateGoal`, `updateGoalManualProgress`, `setGoalStatus`, `archiveGoal`: owner/admin/member; leituras `getGoalsOverview`, `getGoalKpiProgress`: owner/admin/member/viewer (sem escrita). Viewer não muta; as leituras recusam workspace arquivado (limitação do kernel). Implementado na P5-B, aguardando auditoria | `functions/src/goals/callables.ts:36-117`; `functions/src/goals/operations.ts:80,296` |
| Relatório oficial (1, P5-C1) | `getFinancialReport`: Zod estrito (`range` é preset ou `AAAA-MM`; `sections` sem repetição); papel relido na transação do limite de frequência (300 por hora por ator e workspace); mesma matriz das Rules no bloco de investimentos — fluxos, evolução e taxa de aportes líquidos (`investment_report_periods`, legível por todo membro desde a P4-D, D-15) para todos os papéis, patrimônio (`investment_summaries/current`) só para owner, admin e member (para viewer vem `null` e o resumo nem é lido); workspace arquivado e conta suspensa recusados pelo kernel; somente leitura, sem escrita além do contador de frequência. Implementado na P5-C1, aguardando auditoria | `functions/src/reports/callables.ts`; `functions/src/reports/contract.ts`; `functions/src/reports/report.ts` (`REPORT_READER_ROLES`, `INVESTMENT_READER_ROLES`) |
| Observabilidade de falha | Grava só no workspace já autorizado, nunca no `workspaceId` do payload (o wrapper entrega ao registro de falha apenas o workspace autorizado: `functions/src/shared/callable.ts:126-134`) | `functions/src/investments/callables.ts:82-101` |
| Rate limit | Contador transacional em Firestore, por ator e workspace ou por usuário, com Rules negando o cliente | `functions/src/shared/rateLimit.ts:55-91`; `firestore.rules:808,1386-1388` |
| Checkout e portal (P2A) | O cliente envia só `planId`, `returnUrl` e `idempotencyKey` (Zod estrito); o `priceId` vem da configuração do ambiente e é conferido no Stripe (ativo, mensal, BRL, valor do catálogo, mesmo modo) com falha fechada; `returnUrl` por comparação de origem completa contra `APP_ALLOWED_ORIGINS`; só o próprio titular, com conta ativa; lock transacional e idempotência contra assinatura duplicada; rate limit de 10/h (checkout) e 20/h (portal) por titular; e-mail ao Stripe só se verificado; nenhum checkout concede entitlement | `functions/src/billing/contracts.ts:17-25`; `functions/src/billing/checkout.ts:73,161-187,206,278-281,417`; `functions/src/billing/portal.ts:31-81`; `functions/src/billing/config.ts:128-158` |
| Convites de divisão | Código por CSPRNG de 10 caracteres; membership do workspace exigida, o que fechou a escalada cross-tenant INV-P2-037 | `functions/src/callables/splitGroups.ts:33-39,106-113,183-191` |

Fraquezas:

| Fraqueza | Evidência | ID |
| --- | --- | --- |
| Sem backend para os títulos de divisão; o domínio é escrito pelo cliente. Empréstimos (P3-G/P3-H), clientes e recebíveis (P3-I) e contas/carteiras e transferências (P3-J): só backend — callables no `defineCallable`, autorização relida na transação, `member` só no que criou por `createdBy` do backend; a interface só lê e chama as callables | `firestore.rules` (blocos de `split_*`) | PR-SPLIT-01 (P4); PR-LOAN-01 fechado na P3-H; PR-CR-01 fechado na P3-I; PR-WS-02 fechado em P1 (PLAN §16.4) |
| Quota de grupos de divisão aplicada no servidor desde a P4-C; a de lançamentos é aplicada no servidor nas callables de criação e importação desde P3-D (D-40) e, desde a P4-D, cobre o aplicativo inteiro (sem escritor de `transactions` no cliente; investimentos sem quota por decisão); workspaces próprios, membros e créditos de IA já são aplicados no servidor (P2B) | `src/modules/billing/BillingContext.tsx:148`; [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md) §9 | PR-ENT-01 (aberto até P5) |
| `workspaceId` aceita `/` nos schemas de domínio de 18 callables; o resolvedor único recusa o ID antes de qualquer leitura (fechado em P1, PLAN §16.4) | `functions/src/cards/contracts.ts`; `functions/src/goals/contracts.ts:45`; `functions/src/shared/workspaceAuth.ts:48-64` | ENTRY-11 (schemas de domínio); WS-15 (fechado em P1, PLAN §16.4) |
| Papel relido dentro da transação em cartões e metas (`reassertWorkspaceActor`), depois da pré-checagem do kernel | `functions/src/cards/purchaseOperations.ts`; `functions/src/goals/operations.ts:296` | ENTRY-20 (fechado em P1, PLAN §16.4) |
| Metas sem rate limit (as callables de cartões têm rate limit desde a P4-A) | `functions/src/goals/callables.ts` | ENTRY-12 |
| Mapeador único de erros (`toHttpsError`) e detalhes sem `role` nem `allowedRoles`; o limite atingido ainda vira `failed-precondition` | `functions/src/shared/errors.ts:141`; `functions/src/shared/rateLimit.ts:122` | ENTRY-21 (parcial: `resource-exhausted` para limite e quota segue em P2) |
| Erros inesperados são logados pelo wrapper antes do mapeamento (P1); métricas e alertas seguem em P7 | `functions/src/shared/callable.ts:314-318`; `functions/src/cash/rebuild.ts:270-272` | PR-OBS-01 (P7) |
| Papel de dono de grupo lido de `split_participants`, gravável por qualquer member; limite de tentativas revertido pelo `throw` | `functions/src/callables/splitGroups.ts:119-137,222-247` | PR-SPLIT-04 (P4) |
| ~~Schema de extração de IA sem `.strict()`~~ — resolvido no código na P5-E1: schema estrito e validação Zod da resposta; milestone não concluída: gate `FAIL` por bloqueadores alheios ao código | `functions/src/ai/extraction.ts`; `functions/src/ai/callables.ts` | PR-AI-05 (P5-E1) |

### 5.2 Webhook Stripe

- **CURRENT (P2A):** o endpoint não tem CORS e não ecoa erro do SDK. A assinatura é verificada sobre o raw body e é obrigatória: ausente ou inválida ⇒ 400 sem efeito; segredo ou Price ausente ou inválido ⇒ 500 sem processar (não há segredo padrão nem fallback); evento de outro modo (test/live) ⇒ 400 (`functions/src/webhooks/stripe.ts:26-65`; `functions/src/billing/webhook.ts:850-869`). Corpo acima de 1 MiB ⇒ 413 antes da verificação da assinatura, sem calcular o HMAC (`MAX_WEBHOOK_BODY_BYTES`; `functions/src/billing/webhook.ts:844-849`). O recibo `billing_webhook_events/{event.id}` é lido no claim (evento repetido ⇒ 200 sem efeito) e vira `processed` na mesma transação do efeito; o conteúdo do evento nunca é aplicado: o estado é relido no Stripe fora de transação e o commit exige a geração do lease do titular, então evento antigo não regride (`functions/src/billing/webhook.ts:466-575,640-723`). O titular é resolvido por `billing_customers` e conferido com a conta e com a metadata do checkout; divergência ⇒ rejeitado, com recibo e anomalia auditada (`functions/src/billing/webhook.ts:493-522`). Auditoria sem payload, e-mail, cartão nem segredo (`functions/src/billing/audit.ts:24-40`). Falha transitória ⇒ 500 para reentrega.
- **TARGET e GAP:** [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md). PR-BILL-01, PR-BILL-05 e PR-BILL-06 fechados em P2A (PLAN §17.3); ENTRY-21 (CORS e eco de erro) fechado para o webhook. Reconciliação periódica, fila/replay e alertas de falha em P7; alerta de configuração ausente em P7 (E-08).

### 5.3 Ordem de verificação de toda callable (CURRENT em P1, salvo onde indicado TARGET)

O wrapper do kernel (D-ORD-02, entregue em P1) executa, nesta ordem:

1. App Check (a partir de P6; ponto de extensão desde P1).
2. Autenticação e política de token (§3).
3. Zod `.strict()`: IDs com o schema único (sem `/`, tamanho máximo), dinheiro em centavos inteiros, strings com teto.
4. Pré-checagem `resolveWorkspaceActor` no wrapper e, dentro da transação da mutação, `reassertWorkspaceActor` ([ARCHITECTURE.md](ARCHITECTURE.md)): relê `users/{uid}`, `workspaces/{id}` e `members/{uid}`, exige conta ativa, membership `active` e workspace não arquivado e aplica a matriz declarativa da operação; o `workspaceId` do payload só é solicitado, e o do log é o autorizado.
5. Rate limit por ator e workspace, e por usuário quando o recurso é global (IA).
6. Entitlement e quota (motor entregue em P2A: `functions/src/billing/entitlements.ts:131,157`; enforcement em P2B, PR-ENT-01). As callables de P1 não consultam quota; P2B a insere nas transações de `createWorkspace`, `inviteWorkspaceMember`, `acceptWorkspaceInvite` e na transferência de ownership, lendo o plano do owner (D-01).
7. Reserva de idempotência presa a ator, workspace, operação e hash do payload.
8. Escritas de domínio, projeções e evento de auditoria append-only no mesmo commit.
9. Erros mapeados por um único módulo (`toHttpsError`), com códigos fechados, mensagem em pt-BR, `details` sanitizados e correlation ID de servidor; erro inesperado registrado no logger estruturado antes da conversão. **TARGET:** `resource-exhausted` para limite e quota (P2); hoje o limite responde `failed-precondition`.

---

## 6. Firestore Rules

### 6.1 CURRENT

Base sólida:

- Default deny fora de `workspaces/{id}`, `users/{uid}` e `billing_accounts/{uid}` (`get` só do próprio titular; sem `list`, escrita nem leitura cruzada; subcoleção, `billing_customers` e `billing_webhook_events` negados nos dois sentidos, `firestore.rules:1412-1431`): não existe `match` de nível superior genérico (`firestore.rules:1-3,936,1378`).
- Helpers de membership exigem `status == 'active'` e conta ativa (`firestore.rules:28-64`); `workspaces`, `members`, `invites`, `membership_events`, `users/{uid}` e o índice do usuário são `write: false`, com `list` limitado (`firestore.rules:936-976,1377-1402`).
- Domínios de cartões (P4-A: `credit_cards`, compras, faturas, lançamentos, pagamentos, razão do limite e eventos: `get` de membro ativo, `list` com teto, `create, update, delete: if false`; eventos só owner/admin), metas e investimentos são `write: false`. Investimentos validam conteúdo no `get` e exigem `limit` de até 100 no `list`; `investment_report_periods` é legível por qualquer membro ativo, viewer incluído (card do dashboard), enquanto posições, movimentos, ativos e contas ficam só com owner/admin/member e eventos e deriva só com owner/admin; `investment_valuations`, `investment_snapshots` e `investment_import_batches` não têm `match` (negadas a todo cliente, P4-D); `cash_report_periods` exige `limit` de até 600; chaves de idempotência e `cash_period_events` são negadas nos dois sentidos (`firestore.rules`).
- `transactions`: leitura por qualquer membro ativo (viewer incluído) e `create, update, delete: if false` para todo papel (P4-D; `users`, `workspaces` e `members` são server-owned desde P1); a baixa lógica é feita pela callable. Os helpers `hasOnlyClientTransactionKeys`, `isPlainClientTransaction` e `isLedgerWriteFrozen` foram removidos.
- Projeções do relatório (P5-C1): `cash_report_periods` com `get` de membro ativo e `list` com `limit <= 600`, `write: false`; `cash_category_years` e `cash_rebuild_shards` em `isBackendOwnedCollection`, com `read, write: if false` (`firestore.rules:460-461,752-777`). O cliente não lê as projeções por categoria nem os shards; o relatório vem só de `getFinancialReport`.
- Sete suítes de Rules no Emulator, no CI e no `predeploy:rules`, entre elas `tests/firestore/workspaces-p1.rules.integration.test.mjs` (`.github/workflows/quality-gate.yml:74-110`; `package.json:22,37`).

Exposição:

| Grupo | Coleções | Situação | ID |
| --- | --- | --- | --- |
| ~~Escrita livre de member, sem schema, com delete~~ (resolvido) | `recurring_*` (P4-B), `split_*` (P4-C) e `transactions` (P4-D) | `create, update, delete: if false` para todo papel (`firestore.rules:691-693` e blocos `recurring_*` e `split_*`); suítes `recurring-p4b`, `split-p4c` e `transactions-p4d` | PR-RULES-01 resolvido por partes (`clients` e `receivables` na P3-I, contas e transferências na P3-J, as demais na P4-B…P4-D; fechado no gate de P4, plano §19.7) |
| Clientes e recebíveis (P3-I, D-24, D-39) | `clients`, `client_private`, `receivables`, `receivable_movements`, `client_events`, `receivable_events` | `clients`, `receivables` e `receivable_movements`: leitura por membro ativo (`canReadWorkspaceScopedData`), `create`, `update` e `delete` negados a todo papel. `client_private`: `get` e `list` só de owner/admin, `list` com `request.query.limit <= 100`, escrita negada. `client_events` e `receivable_events`: `get` e `list` só de owner/admin (`limit <= 100`), escrita negada. `client_private`, `client_events` e `receivable_events` estão em `isBackendOwnedCollection`: sem isso a regra genérica de subcoleção entregaria PII a member e viewer (provado por mutação). O cliente não cria espelho de recebível: `transactions` não tem escrita do cliente (P4-D). Testado no Emulator e protegido por guarda estático no frontend | — (PR-CR-01 e a parte clients/receivables de PR-RULES-01 fechados; PR-CR-05 segue em P8) |
| Contas/carteiras e transferências (P3-J, D-30) | `cash_accounts`, `cash_account_movements`, `cash_transfers`, `cash_account_events` | As quatro estão em `isBackendOwnedCollection`. `cash_accounts`, `cash_account_movements` e `cash_transfers`: `get`/`list` por membro ativo (viewer incluso), `list` só com `limit <= 100`, `create`, `update` e `delete` negados a todo papel. `cash_account_events`: `get`/`list` só de owner/admin (`limit <= 100`), escrita negada. `transactions` não tem escrita do cliente (P4-D), `walletId` foi removido de todo o código e `'wallet'` saiu de `isValidCatalogGroup`. Testado no Emulator | — |
| Empréstimos (P3-H) | `loans`, `loan_movements`, `loan_events` | Leitura por membro ativo em `loans`/`loan_movements`; `create`, `update` e `delete` negados ao cliente em todo papel (owner, admin, member, viewer), inclusive em lote; `loan_events` server-only com leitura de owner/admin e teto de 100; `loanEntry`, `loanId` e `loanMovementId` fora da allowlist de `transactions` (o cliente não cria espelho nem vínculo). Testado no Emulator (M4) e protegido por guarda estática no frontend | — (PR-LOAN-01, PR-LOAN-07 e a parte loans de PR-RULES-01 fechados) |
| ~~Caixa escrito pelo cliente~~ (resolvido na P4-D) | `transactions` | Antes: create/update pelo cliente em float, espelhos editáveis e vínculos de origem forjáveis. Agora: `create, update, delete: if false` para todo papel, sem escritor no cliente; a janela `quota_state/ledger_write_freeze` e `isLedgerWriteFrozen` foram removidos (§19.4 do plano mestre) | PR-TX-01, PR-TX-02 (resolvidos na P4-D; fechados no gate de P4, plano §19.7) |
| Configuração de cartão | `credit_cards` | Resolvido na P4-A (plano §19.1): `credit_cards` entrou em `isBackendOwnedCollection`; `create, update, delete: if false`; cartão só arquivado, nunca apagado | PR-CC-01, PR-CC-02 (resolvidos na P4-A) |
| Controle de acesso | `workspaces`, `members`, `users/{uid}/workspaces` | **Fechado em P1 (PLAN §16.4):** `write: false`; papel só do membership ativo; sem espelho autogravado nem regime `ownerId` (`firestore.rules:936-976,1377-1402`) | PR-WS-01…PR-WS-05 (fechados em P1, PLAN §16.4) |
| Catch-all de leitura | Toda subcoleção fora de `isBackendOwnedCollection`, hoje `activity_logs` (autor e saldos) e `split_invites` (códigos de convite); `members`, `invites` e `membership_events` (P1) têm bloco próprio e ficam fora do catch-all | Legível por qualquer membro, inclusive `viewer`, sem `limit` (`firestore.rules:791-820,1362-1367`) | PR-RULES-02 (P6) |
| Listagem sem teto | `transactions`, adjacentes, `activity_logs` (`members` e o índice do usuário ganharam teto em P1; `notifications` e `notification_user_states` em P5-D1, `limit <= 50`; `goals`, `limit <= 26`, e `goal_audit_logs`, `limit <= 20`, em P5-B, `firestore.rules:668-681`) | Sem `request.query.limit` | RULES-11 |
| Validação fraca | Timestamps livres, strings e mapas sem teto (`members.status` foi fechado em P1 (PLAN §16.4): enum gravado só pelo backend) | `firestore.rules:97-99` | RULES-16 |
| Storage | Bucket padrão | `getStorage` exportado sem uso, sem `storage.rules` versionado (`src/lib/firebase.ts:4,39`) | FIRE-12 |
| Notificações: estado por usuário (P5-D1; D-18-NOTIF) | `notifications` (evento) e `notification_user_states/{uid}/notification_entries` (estado) | Estado com `read`, `dismissed` e `deleted` (para si), `expiresAt` igual ao do evento e leitura só do dono; evento fechado a todos. Matriz abaixo. Remoção física por TTL depende de E-07 | PR-NOTIF-01 (parcial; contagem exata e produtores implementados na P5-D2, aguardando auditoria) |
| Testes | Adjacentes (cartões têm suíte própria desde a P4-A: `tests/firestore/cards-p4a.rules.integration.test.mjs`; notificações desde a P5-D1: `tests/firestore/notifications-p5d1.rules.integration.test.mjs`, e D-18-NOTIF: `tests/firestore/notifications-d18.rules.integration.test.mjs`; metas desde a P5-B: `tests/firestore/goals-p5b.rules.integration.test.mjs`) | Sem teste de escrita nem negação (`tests/firestore/adjacent-modules.rules.integration.test.mjs:129-243` só lê); o índice do usuário passou a ter teste em P1 | PR-REL-02 (P3); RULES-15 |

**Matriz de notificações (D-18-NOTIF):**

| Papel | Lê o evento e o próprio estado | Marca `read` e `dismissed` (para si) | Marca `deleted` (excluir para si) | Grava estado de outro uid |
| --- | --- | --- | --- | --- |
| Owner | Sim | Sim | Sim | Não |
| Admin | Sim | Sim | Sim | Não |
| Member | Sim | Sim | Sim | Não |
| Viewer | Sim | Sim | **Não**, nem na criação, nem na atualização, nem junto com `read` ou `dismissed` | Não |
| Membro removido, conta suspensa, outro workspace, sem login | Não | Não | Não | Não |

Negativos testados (`tests/firestore/notifications-d18.rules.integration.test.mjs`): viewer não grava `deleted`; `expiresAt` diferente, ausente, em string ou em número é negado; alterar `expiresAt` é negado; remover ou desmarcar `deleted` é negado; `deletedAt` escolhido pelo cliente é negado; o dono não apaga o próprio estado; ler ou gravar o estado de outro usuário é negado; membro removido, usuário suspenso e cliente sem autenticação não leem nem gravam; `items` e o documento intermediário continuam fechados. O evento `notifications` não aceita escrita de ninguém, inclusive owner.

**Produtores e contagem de não lidas (P5-D2, aguardando auditoria independente):**

- Os eventos são gravados só pelo Admin SDK, pelo builder único (`functions/src/notifications/builder.ts`). As Rules não mudaram: nenhum papel cria, altera ou apaga `notifications`.
- Destinatário: todo membro ativo, inclusive `viewer`. Não há evento dirigido. Isso não amplia a exposição: as entidades notificadas (`loans`, `receivables`, `cash_accounts`, `goals`, `recurring_*`) já são legíveis por todo membro ativo (`firestore.rules`, `canReadWorkspaceScopedData`).
- Os campos do evento são textos fixos e identificadores de entidade. Não há dado pessoal (ver [PRIVACY_LGPD.md](PRIVACY_LGPD.md)).
- `getNotificationUnreadCount` (`functions/src/notifications/unreadCount.ts`): exige Auth; o UID vem só do token; a conta ativa, o workspace não arquivado e o membership ativo são relidos dentro da transação das contagens; o limite é de 600 chamadas por hora por usuário e workspace.
- **Controle dos avisos de recebível vencido (P5-D2.1):** `receivable_overdue_queue` (trabalho pendente) e `receivable_overdue_deliveries` (confirmação por episódio) são estado operacional do backend. Estão em `isBackendOwnedCollection` (sem isso, a regra genérica de subcoleção daria leitura a qualquer membro) e têm blocos próprios `allow read, write: if false`. O cliente não cria trabalho, não marca entrega (o que suprimiria o aviso), não apaga confirmação (o que reabriria a reemissão), não altera tentativas nem próxima tentativa. O workspace vem sempre do caminho do item, nunca do conteúdo; a transação relê o recebível no mesmo workspace e só publica nele. Teste de Rules: todos os papéis, removido, suspenso, outro workspace, sem autenticação e workspace arquivado, inclusive consulta de grupo (`tests/firestore/notifications-p5d2.rules.integration.test.mjs`); teste de integração do item forjado em outro workspace (`receivableOverdue.integration.test.ts`, §15.17 e §15.21).

**Nota do checklist `firebase-security-rules-auditor`:** a auditoria `firestore-rules` da baseline atribuiu **1 (Critical)**; os itens de workspace e membership foram fechados em P1 (PLAN §16.4). O motivo é o cliente continuar gravando dados financeiros autoritativos sem schema, com hard delete, apesar da base sólida.

### 6.2 TARGET

- Todas as coleções financeiras e de controle com `allow write: if false`, com escrita só por callable. A troca de cada coleção acontece no mesmo milestone do seu callable (risco R-02): `workspaces`, `members`, `invites`, `membership_events` e índice do usuário em P1 (entregue); `transactions`, `loans` e `loan_movements` em P3, `clients`, `client_private`, `receivables`, `receivable_movements`, `client_events` e `receivable_events` na P3-I (entregue), e `cash_accounts`, `cash_account_movements`, `cash_transfers` e `cash_account_events` na P3-J (entregue); `credit_cards` e todas as coleções `credit_card_*` na P4-A (entregue, plano §19.1); `recurring_*` na P4-B (entregue, plano §19.2) e `split_*` em P4-C; `notifications` em P5.
- Escrita direta do cliente só em dados não financeiros do próprio usuário (allowlist de perfil) e no estado de leitura de notificação por usuário, com `hasOnly`, tipos, tetos e `request.time`.
- Um `match` explícito por coleção, `get` e `list` separados, `list` sempre com `request.query.limit`, papel mínimo por coleção e nenhum catch-all. Um teste enumera as coleções usadas pelo código e falha se alguma não tiver regra explícita.
- Um único helper de papel baseado no membership ativo, sem `isWorkspaceOwnerByParent` ([AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §6.3); entregue em P1.
- `storage.rules` com deny-all versionado, ou remoção de `getStorage`.
- Suíte por coleção cobrindo owner, admin, member, `viewer` (somente leitura, D-02), removido, não membro e não autenticado, com create, update, delete, get e list, cross-tenant nos dois sentidos e payload inválido.

---

## 7. Isolamento de tenant

- **CURRENT:** o isolamento é por caminho (`workspaces/{workspaceId}/...`), e as Rules resolvem membership pelo `workspaceId` do caminho. A auditoria não encontrou vazamento cross-tenant nos domínios de conta e workspaces, transações, investimentos, metas, cartões, recorrentes, empréstimos, divisão de contas e clientes/recebíveis. Evidências: `tests/firestore/m4-hardening.rules.integration.test.mjs:246`; suítes `investment-*.rules` e `goals.rules`; `tests/firestore/investment-domain.rules.integration.test.mjs:615-635`; o agendador de recorrentes deriva o workspace do caminho do contrato (`functions/src/recurring/scheduler.ts`, P4-B; teste `functions/src/recurring/__tests__/recurringIsolation.integration.test.ts`); os convites de divisão exigem membership (`functions/src/callables/splitGroups.ts:106-113`); a observabilidade de falha só grava no workspace autorizado (§5.1); o rate limit é isolado por ator e workspace (`functions/src/shared/__tests__/rateLimit.integration.test.ts`).
- **Riscos latentes (não explorados):**
  - `workspaceId` com `/` apontava para documento aninhado e permitia um pseudo-tenant sob um workspace real, com papel `owner` derivado de um `ownerId` gravado numa coleção sem schema (ENTRY-11, WS-15). Fechado em P1 (PLAN §16.4) no resolvedor: o ID é validado antes da leitura e o `ownerId` não autoriza (`functions/src/shared/workspaceAuth.ts:48-64`; `functions/src/shared/__tests__/workspaceAuth.integration.test.ts:86,132`). Os schemas de domínio ainda aceitam a string até o resolvedor (ENTRY-11).
  - RULES-06 (fechado em P1, PLAN §16.4): o create de workspace é negado ao cliente (`firestore.rules:944`) e `archiveWorkspace` mantém o documento-pai como marcador, o que impede recriar um ID liberado e assumir subcoleções órfãs (`functions/src/workspaces/lifecycle.ts:394-437`).
  - Criação ilimitada de workspaces multiplica todo limite por workspace (PR-AI-03, P2).

Riscos intra-workspace (o member ou admin é o atacante):

| Risco | Evidência | ID |
| --- | --- | --- |
| Member apaga ou reescreve rateios e recorrências (empréstimos fechados na P3-H; clientes e recebíveis na P3-I; contas e transferências na P3-J) | `firestore.rules:1097-1105,1384-1402` | PR-RULES-01 (P4) |
| Member ou viewer lê dados pessoais de clientes | Fechado na P3-I (D-24): a PII fica em `client_private`, legível só por owner/admin; o cadastro compartilhado tem só nome e situação | `firestore.rules` (`client_private`); `tests/firestore/receivables-p3i.rules.integration.test.mjs` |
| ~~Owner/admin editam ou anulam espelhos de caixa gravados pelo backend; member forja vínculo de pagamento de fatura~~ (resolvido na P4-D: `transactions` sem escrita do cliente) | `firestore.rules` (`match /transactions`) | PR-TX-02 (resolvido na P4-D) |
| ~~Member marca ocorrências futuras como geradas e o cron deixa de cobrar~~ — resolvido na P4-B: `recurring_*` negam escrita do cliente | `firestore.rules:979-999`; `tests/firestore/recurring-p4b.rules.integration.test.mjs` | PR-REC-01 (resolvido na P4-B, plano §19.2) |
| Member se declara dono de grupo de divisão | `firestore.rules:1389-1392` | PR-SPLIT-04 (P4) |
| Co-owner ou admin tranca o owner fora do workspace (fechado em P1 (PLAN §16.4): ninguém altera o próprio papel e o owner só muda por transferência) | `functions/src/workspaces/rbac.ts:20-50`; `firestore.rules:951-958` | PR-WS-04 (fechado em P1, PLAN §16.4) |
| Admin cria outros admins e remove admins sem trilha (fechado em P1 (PLAN §16.4): admin não gere admin, D-04, e toda mutação gera `membership_events`) | `functions/src/workspaces/rbac.ts:20-50`; `functions/src/shared/audit.ts:58` | WS-13 (fechado em P1, PLAN §16.4) |
| Qualquer membro lê `activity_logs` e códigos de `split_invites` | `firestore.rules:1436-1442` | PR-RULES-02 (P6) |
| Membro gravava papel falso no próprio espelho e recebia a UI de gestão (fechado em P1 (PLAN §16.4): o índice não tem papel e é `write: false`; a UI lê o papel do membership) | `firestore.rules:1398-1402`; `src/modules/workspaces/api.ts:144-168` | PR-WS-03 (fechado em P1, PLAN §16.4) |
| ~~Categoria criada por um membro injeta instrução no prompt de IA do owner~~ — tratada na P5-E1: categorias entravam como rótulo não confiável, limpo e truncado, fora das instruções de sistema; desde a P5-E1.1 (aguardando auditoria independente) o nome da categoria não vai ao provedor (só "Grupo de despesas N"); P5-E1: milestone não concluída, gate `FAIL` por bloqueadores alheios ao código | `functions/src/ai/analysisContext.ts`; `functions/src/ai/prompts.ts` | PR-AI-05 (P5-E1) |
| Histórico de chat de IA no `localStorage` por usuário e workspace (D-41, P5-A): chave com `uid` e workspace, envelope validado, respostas atrasadas descartadas por geração da sessão, gravação só com o dono local igual ao uid da sessão e limpeza no logout, na troca de conta e em carga nova com outra conta. Não é criptografia: XSS, extensões e acesso ao perfil do navegador leem o conteúdo | `src/modules/reports/aiChatStorage.ts`; `src/modules/reports/aiChatSession.ts`; `src/lib/sessionCleanup.ts:139` | PR-AI-04 (resolvido na P5-A) |
| `activity_logs` atribui a alteração ao criador, não ao ator | `functions/src/triggers/transactions.ts:202` | ENTRY-17 |

- **TARGET:** testes negativos com tenants A e B, nos dois sentidos, para toda operação alterada em Rules e callables; `workspaceId` validado no resolvedor antes de qualquer caminho; nenhuma decisão de confiança tomada a partir de campo gravável pelo cliente.

---

## 8. RBAC

Papéis `owner`, `admin`, `member` e `viewer` por membership de workspace, com `viewer` estritamente somente leitura (D-02, tomada). As matrizes atual e alvo, a invariante de um único owner canônico (D-03), os poderes de owner e admin (D-04) e o resolvedor único estão em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §6 e §7.

Pontos de segurança (P1): as Rules negam toda escrita em `members` e a matriz D-04 é aplicada no backend, com testes (`functions/src/workspaces/__tests__/memberships.integration.test.ts:61,98`; `tests/firestore/workspaces-p1.rules.integration.test.mjs:192`). O regime duplo `ownerId` × membership foi removido (PR-WS-03 fechado em P1 (PLAN §16.4)). O papel exibido na UI vem do membership ativo (`src/modules/workspaces/api.ts:144-168`), e as decisões de autorização continuam no servidor.

Contas/carteiras e transferências (P3-J, D-30): owner e admin criam, editam (nome e tipo), arquivam e reativam contas e leem a trilha `cash_account_events`; owner, admin e member criam transferências; owner e admin estornam qualquer transferência e member só a própria; viewer só lê contas, movimentos e transferências.

Clientes e recebíveis (P3-I, D-24): owner e admin administram clientes (`createClient`, `updateClient`, `archiveClient`) e leem a PII (`client_private`) e as trilhas; member cria recebíveis e administra só os que criou (`createdBy` gravado pelo backend); owner e admin administram todos; viewer só lê; member e viewer veem só a lista mínima de clientes, e a interface nem consulta `client_private` para eles. A matriz por operação está em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §7.1.

---

## 9. Segredos e configuração

### 9.1 CURRENT

- Segredos declarados por função no Secret Manager (padrão atual; `defineSecret` não é usado): `GOOGLE_AI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_BUSINESS_MONTHLY`, `APP_ALLOWED_ORIGINS` (`functions/src/ai/callables.ts:33-38`; `functions/src/billing/config.ts:18-45`; `functions/src/webhooks/stripe.ts:26-30`). Sem valor padrão nem fallback: ausente, vazio ou fora do formato falha fechada, inclusive `sk_test_placeholder` e `whsec_placeholder` (recusados pelo comprimento mínimo); Pro = Business é inválido; o modo live/test é derivado da chave (`functions/src/billing/config.ts:47-49,72-112`). `STRIPE_ALLOWED_PRICE_IDS` foi removida (`functions/src/shared/deploymentContract.test.ts:127,147`). Runtime config legado desabilitado (`firebase.json:13`).
- A chave de IA não está no cliente: o Vite neutraliza `process.env.API_KEY` e `process.env.GEMINI_API_KEY` (`vite.config.ts:14-19`); `readApiKey` falha fechada (`functions/src/ai/callables.ts:131-141`); guardas estáticas em `tests/unit/ai-backend-only.test.ts:33-90`.
- `.env*`, chaves `.pem` e service accounts estão no `.gitignore` e nunca foram commitados (`.gitignore:30-39`). O frontend só lê `VITE_FIREBASE_*`, que é configuração pública do app web, não segredo (`src/lib/firebase.ts:7-33`).
- `isAllowedReturnUrl` só aceita `http` para `localhost`, e ainda assim só se a origem estiver na allowlist (`functions/src/billing/config.ts:134-152`). Em PROD, `APP_ALLOWED_ORIGINS` não pode conter `localhost`.

### 9.2 Lacunas

| Lacuna | Evidência | ID |
| --- | --- | --- |
| Configuração não secreta (`APP_ALLOWED_ORIGINS`, Prices) guardada como segredo; ausência não alertada. O fallback `sk_test_placeholder`/`whsec_placeholder` (PR-BILL-05) foi fechado em P2A | `functions/src/billing/config.ts:18-45` | FIRE-10 (P6); PR-BILL-05 fechado em P2A (PLAN §17.3) |
| Chave Gemini embutida no bundle público entre `39806fb` (2026-01-22) e `92473c8` (2026-08-24), sem rotação comprovada; presença de `GEMINI_API_KEY` em `.env.local` das estações: NÃO VERIFICADO (arquivo não versionado; ver linha 5 da §9.4) | `git show 39806fb:vite.config.ts:14-15`; `vite.config.ts:14-19` | PR-AI-02 (P0); E-00 |
| Um único projeto e o mesmo Secret Manager para desenvolvimento e produção | `.firebaserc:3` | PR-PLAT-01 (P6) |
| Varredura de segredos só procura o padrão `AIza`; sem gitleaks | `tests/unit/ai-backend-only.test.ts:76-89` | FIRE-13, REL-11 |

### 9.3 TARGET

`defineSecret` sem valor padrão, com recusa explícita, log estruturado e alerta quando faltar (P2A já entrega recusa explícita e log estruturado, com o padrão atual de `secrets` por função; o alerta é P7); Stripe instanciado dentro do handler (já é assim em P2A). Configuração não secreta em `defineString`/`defineList` por alias. Segredos separados por projeto (DEV, STAGING, PROD), contas Stripe test e live separadas, política de rotação registrada (E-05). API key web restrita por referrer e API; chave de IA restrita à API e com quota. Gitleaks no CI com padrões Google, Stripe e service account.

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

- **CURRENT:** o Hosting só define `Cache-Control` (`firebase.json:38-57`); não há CSP, HSTS, `frame-ancestors`, `nosniff`, `Referrer-Policy` nem `Permissions-Policy`. O `index.html` carrega Google Fonts (`index.html:8-10`) e declara `lang="pt-BR"` (`index.html:3`). Desde P2C-H2 não há script de terceiro em runtime: o Tailwind é compilado pelo PostCSS do Vite (`postcss.config.js`, `tailwind.config.js`, diretivas em `src/index.css:1-3`) e o importmap `esm.sh` saiu do HTML (PLAN §17.11). No CI, `firebase-tools@latest`, actions por tag e não por SHA, sem bloco `permissions` (`.github/workflows/quality-gate.yml:39,79,101,117,139`).
- **Impacto:** até P2C-H2, um comprometimento do CDN do Tailwind executava JavaScript na mesma origem em que o Firebase Auth guarda o refresh token; sem CSP, qualquer script injetado ainda teria esse alcance. Sem `frame-ancestors`, a tela de membros fica sujeita a clickjacking.
- **TARGET:** fontes auto-hospedadas; remoção do `metadata.json` e do entrypoint duplicado. Tailwind compilado e importmap removido em P2C-H2, com paridade com o CDN emulado: 46 telas, 0 pixel diferente (D-20; R-04 residual). Headers em `source: '**'`: CSP com `script-src 'self'` e apenas os domínios necessários de Google Auth e Stripe, `frame-ancestors 'none'`, `connect-src` restrito às APIs do Firebase, à região das Functions e ao Stripe; `Strict-Transport-Security` com `max-age` de pelo menos um ano (vale só em domínio próprio, E-11); `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` negando câmera e geolocalização, com microfone liberado só para a própria origem enquanto houver entrada por voz (`src/components/TransactionModal.tsx:723-734`); `Cross-Origin-Opener-Policy: same-origin-allow-popups`, compatível com `signInWithPopup`. Teste de configuração ou E2E verifica os headers. No CI: versões fixas, actions por SHA, `permissions: contents: read`, `npm audit` ou dependency review.
- **GAP:** PR-PLAT-03 (P6); REL-11; FIRE-07 (cache de HTML em rotas reescritas).

---

## 11. Código de teste e E2E no artefato

- **CURRENT:** `signInForE2E` com credenciais fixas e auto-cadastro fica no `AuthContext` de produção (`src/contexts/AuthContext.tsx:35,113-133,150`). A conexão aos emuladores depende só de variável de build (`src/lib/firebase.ts:47-62`). `build` e `build:e2e` escrevem no mesmo `dist/` (`package.json:9,27`), e o bloco `hosting` não tem predeploy (`firebase.json:25-30`). Os nove `manual*Test.ts` do módulo de cartões foram removidos com `functions/src/creditCards/**` na P4-A; `testSupport/`, `__tests__/` e `*.test.js` são excluídos do deploy por `firebase.json` desde P1 (`firebase.json:9-26`), e um teste de contrato impede que módulos de teste sejam alcançáveis pelo entrypoint (`functions/src/shared/deploymentContract.test.ts:216-246`); `generateInviteCodeForTest` é exportado pelo módulo de produção (`functions/src/callables/splitGroups.ts:42`).
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
| Chave | CURRENT | Só no backend, via segredo `GOOGLE_AI_API_KEY` declarado nas duas callables de IA; falha fechada. Nenhuma variável `VITE_*` de IA. | `functions/src/ai/callables.ts`; `functions/src/ai/gateway.ts` |
| Autorização | CURRENT | Owner, admin ou member do workspace. Viewer recusado. Conta, workspace, membership e papel relidos na transação de contexto e na admissão. | `functions/src/ai/callables.ts`; `functions/src/ai/policy.ts`; `functions/src/ai/admission.ts` |
| Entrada | CURRENT | Payload estrito nas duas callables: campo fora do contrato (contexto, KPIs, perfil, papel, uid, custo) é recusado com `invalid-argument`, sem crédito. Consultor: pergunta de 3 a 2.000 caracteres e período. Extração: texto de 3 a 4.000 caracteres, ou documento PNG, JPEG, WEBP ou PDF de até 6 MiB de caracteres em base64, com assinatura do arquivo conferida contra o MIME antes da admissão. | `functions/src/ai/callables.ts`; `functions/src/ai/extraction.ts` |
| Confirmação de envio | CURRENT (P5-E1) | `providerConsent` obrigatório, da mesma operação (`ai-provider-share-v1`). Ausente ou de outra operação: `failed-precondition` com `ai_consent_required`, antes de ler dados, admitir, aplicar rate limit ou chamar o provedor. Controle técnico de transparência, não consentimento LGPD. | `functions/src/ai/consent.ts` |
| Custo | CURRENT | Créditos mensais pelo plano do titular, com admissão atômica (P2B.2). Rate limit de 20 análises/h e 60 extrações/h por (workspace, ator). Leitura de contexto limitada a 60/h por (ator, workspace). Teto de saída de 2.048 tokens (análise) e 1.024 (extração), desde a P5-E1. Sem repetição automática do SDK e timeout de 90 s no provedor. Sem App Check nem alerta de orçamento. | `functions/src/ai/policy.ts`; `functions/src/ai/admission.ts`; `functions/src/ai/gateway.ts`; `functions/src/shared/runtimeOptions.ts` |
| Contexto | CURRENT (P5-E1; P5-E1.1) | Montado no servidor a partir do relatório oficial, a mesma fonte de Dashboard e Relatórios, sem campos vindos do cliente. Bloco indisponível nunca vira zero. Sem IDs, nomes de cartão, descrições de compra, contrapartes, nomes de clientes, e-mails ou séries. Categorias de despesa entram só como "Grupo de despesas N" (posição no ranking por valor), sem nome, ID ou chave (P5-E1.1, aguardando auditoria independente); o nome da categoria não sai do servidor, e a pergunta digitada pelo usuário segue inteira. | `functions/src/ai/analysisContext.ts`; `functions/src/ai/callables.ts` |
| Instruções × dados | CURRENT (P5-E1; P5-E1.1) | Instruções fixas do backend em `systemInstruction`, separadas do conteúdo. Pergunta e dados do contexto são tratados como conteúdo não confiável; desde a P5-E1.1 (aguardando auditoria independente) nenhum nome de categoria vai ao contexto (só "Grupo de despesas N"). O delimitador não é a defesa: a autoridade não depende do modelo. O modelo não tem ferramentas nem escrita, e a saída é validada e renderizada como texto. | `functions/src/ai/prompts.ts`; `functions/src/ai/gateway.ts` |
| Saída | CURRENT (P5-E1) | Consultor: texto simples validado (sem caracteres de controle, não vazio, até 8.000 caracteres), renderizado como texto React. Extração: saída do provedor pedida com `responseJsonSchema` e revalidada por Zod estrito; cada campo é `identified`, `missing`, `invalid` ou `ambiguous`; resposta fora do contrato vira erro em pt-BR, sem gravar nada. | `functions/src/ai/extraction.ts`; `functions/src/ai/callables.ts`; `src/components/ReportsAIChat.tsx`; `src/components/TransactionModal.tsx` |
| Logs | CURRENT (P5-E1) | Nunca pergunta, transcrição, documento, resposta, payload ou erro cru. Eventos: `ai.provider_failed` (`providerFailure`, `providerStatus`), `ai.extraction_invalid_response` (`reason`), `ai.extraction_result` (`status`), `ai.credit_consumed`. | `functions/src/ai/callables.ts` |
| Modelo | CURRENT | `gemini-3-flash-preview` (preview, mantido na P5-E1), SDK `@google/genai` ~2.28.0 (o legado `@google/generative-ai` teve suporte encerrado em 2025-11-30) e chave do Google AI Studio. Troca para modelo GA: decisão pendente. | `functions/src/ai/gateway.ts`; `functions/package.json`; FIRE-11 |
| Contexto no servidor | CURRENT (P5-E1; milestone não concluída: gate `FAIL` por bloqueadores alheios ao código) | Ver «Contexto» e «Instruções × dados» acima. | PR-AI-05 (tratado na P5-E1) |
| Saída validada | CURRENT (P5-E1; milestone não concluída: gate `FAIL` por bloqueadores alheios ao código) | Ver «Saída». Valor por string decimal convertido em centavos inteiros via BigInt; datas `AAAA-MM-DD` existentes; sem tipo `parcelado` (só `installments` como intenção). | PR-AI-05 (tratado na P5-E1) |
| Custo restante | TARGET | App Check com `consumeAppCheckToken`; alerta de orçamento e quota da API. Quota por plano e teto de saída já são CURRENT (acima). | PR-APPCHK-01 (P6); E-08 |
| Dados enviados ao provedor | CURRENT → GAP | Confirmação por operação antes de cada envio e contexto mínimo. Termos, tier, DPA, base legal e retenção no provedor: não verificados. | PR-AI-01 (P8); D-11; E-09; E-10; [PRIVACY_LGPD.md](PRIVACY_LGPD.md) |
| Chave histórica | GAP | Exposição passada sem rotação comprovada. Na P5-E1 a rotação não foi executada nem comprovada. | PR-AI-02 (P0); §9.4 |
| Histórico local | CURRENT (D-41, P5-A) | Histórico no `localStorage` por (uid, workspace), isolado na troca de workspace e de conta, sem respostas atrasadas de outro contexto, apagado no logout; isolamento lógico, sem criptografia local nem cópia no servidor | PR-AI-04 (resolvido na P5-A) |

---

## 15. Matriz de controles alvo verificados por teste

Um controle só conta como implementado quando o teste indicado existe, roda no CI (Emulator para tudo que toca Firebase, sem pular em silêncio) e passa. "Parcial" indica teste existente que cobre só parte do controle.

| # | Controle | Camada | Teste exigido | Teste hoje | Milestone | Skill |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Negação cross-tenant A/B nos dois sentidos | Rules e callables | Suítes Emulator por coleção e por callable | Parcial: `m4-hardening:246`, suítes de investimentos e metas, leitura de adjacentes; workspace, membros, convites, auditoria e índice cobertos em P1 (`tests/firestore/workspaces-p1.rules.integration.test.mjs:173-339`; `functions/src/workspaces/__tests__/memberships.integration.test.ts:240`) | P1–P5 | `multi-tenant-security-review` |
| 2 | Cliente não escreve dado autoritativo | Rules | Create/update/delete negados por papel | Parcial: investimentos, `transactions` (P4-D: `tests/firestore/transactions-p4d.rules.integration.test.mjs`), cartões (P4-A: `tests/firestore/cards-p4a.rules.integration.test.mjs`), metas, workspace, membros, convites, auditoria, perfil e índice (P1); clientes e recebíveis (P3-I: `tests/firestore/receivables-p3i.rules.integration.test.mjs`); contas, movimentos, transferências e eventos de contas (P3-J: `tests/firestore/accounts-p3j.rules.integration.test.mjs`); nada nas demais adjacentes (RULES-15) | P1, P3, P4 | `multi-tenant-security-review` |
| 3 | Membership, convites, índice e criação de workspace só pelo backend | Rules e callables | Negação nas Rules e integração das callables | Existe (P1): `tests/firestore/workspaces-p1.rules.integration.test.mjs:183-261`; `functions/src/workspaces/__tests__/` | P1 | `multi-tenant-security-review` |
| 4 | Anti-escalada de papel e invariantes de owner | Rules e callables | Autopromoção, concessão de owner, trancamento do owner, último owner | Existe (P1): `functions/src/workspaces/__tests__/memberships.integration.test.ts:98,184`; `functions/src/workspaces/__tests__/ownership.integration.test.ts:147,171`; `tests/firestore/workspaces-p1.rules.integration.test.mjs:192` | P1 | `multi-tenant-security-review` |
| 5 | Papel relido na transação; membro removido recusado | Callables | Integração com remoção concorrente | Existe (P1): `functions/src/shared/__tests__/workspaceAuth.integration.test.ts:145`; `functions/src/workspaces/__tests__/memberships.integration.test.ts:203,316`; investimentos em `functions/src/investments/__tests__/domainV2.integration.test.ts:893` | P1 | `multi-tenant-security-review` |
| 6 | `workspaceId` e IDs sem `/` | Callables | Teste negativo no resolvedor e em cada schema | Parcial: resolvedor (`functions/src/shared/__tests__/workspaceAuth.integration.test.ts:132`) e schemas de P1 (`functions/src/workspaces/__tests__/workspaceUnits.test.ts:467`) e de investimentos; schemas dos demais domínios em P3–P5 | P1 | `multi-tenant-security-review` |
| 7 | Política de `email_verified` e provedor | Callables e Rules | Token sem e-mail verificado recusado | Existe nas callables (P1): `functions/src/shared/__tests__/kernel.test.ts:584,606,634`; `functions/src/workspaces/__tests__/invites.integration.test.ts:223`; as Rules não exigem e-mail verificado (D-06) | P1 | `multi-tenant-security-review` |
| 8 | Convite de uso único, com expiração e e-mail verificado | Callables | Reuso, expiração, revogação, e-mail divergente, concorrência | Existe (P1): `functions/src/workspaces/__tests__/invites.integration.test.ts:145-349` | P1 | `multi-tenant-security-review` |
| 9 | Idempotência e replay | Callables | Replay devolve o mesmo resultado; payload diferente com a mesma chave é recusado | Parcial: cartões, investimentos, metas e callables de workspace (`functions/src/workspaces/__tests__/workspaceLifecycle.integration.test.ts:155`; `functions/src/workspaces/__tests__/ownership.integration.test.ts:135`) | P1–P5 | `financial-domain-integrity` |
| 10 | Rate limit e quota | Callables | Teto, concorrência no limite, isolamento | Parcial: `rateLimit.integration.test.ts` e rate limit do checkout por titular (`functions/src/billing/__tests__/checkout.integration.test.ts:396`); quotas não (P2B) | P2B | `billing-entitlement-integrity` |
| 11 | App Check obrigatório | Functions | `deploymentContract.test.ts` exige `enforceAppCheck` em toda callable | Não existe | P6 | `firebase-production-readiness` |
| 12 | Segredo ausente falha fechada | Functions | Webhook e checkout sem segredo recusam | Existe (P2A): `functions/src/billing/__tests__/billing.test.ts:117,131,153`; `functions/src/billing/__tests__/checkout.integration.test.ts:130` (checkout e portal); `functions/src/billing/__tests__/webhook.integration.test.ts:106` (endpoint real sem segredo ⇒ 500); IA (`readApiKey`) | P2A | `billing-entitlement-integrity` |
| 13 | Webhook autenticado, idempotente e ordenado | Functions | Assinatura inválida, `event.id` repetido, eventos fora de ordem | Existe (P2A): `functions/src/billing/__tests__/webhook.integration.test.ts:78` (assinatura), `:136` (outro modo), `:167` (evento repetido), `:196` (fora de ordem), `:218` (concorrentes), `:420` (titular divergente); Rules em `tests/firestore/billing-p2.rules.integration.test.mjs:122-189` | P2A | `billing-entitlement-integrity` |
| 14 | Headers de segurança e ausência de terceiros em runtime | Hosting | Teste de `firebase.json` e verificação do `dist/` | Não existe | P6 | `firebase-production-readiness` |
| 15 | Bundle de produção sem login E2E nem Emulator | Build | Guard de build e busca no artefato | Não existe | P6 | `firebase-production-readiness` |
| 16 | Pacote das Functions sem código de teste | Build | Lista do pacote sem `manual*Test`, `testSupport` e `*.test.js` | Parcial (P1): `functions/src/shared/deploymentContract.test.ts:216-246` cobre `testSupport`, `__tests__` e `*.test.js`; `manual*Test` seguem no pacote | P6 | `regression-release-gate` |
| 17 | Ferramenta destrutiva recusa produção | Tooling | Guarda prova recusa sem override | Invertido: `limpar-investimentos.guard.test.mjs:229` aceita o override | P6 | `firebase-production-readiness` |
| 18 | Nenhum segredo no repositório | CI | Gitleaks com padrões Google, Stripe e service account | Parcial: só `AIza` | P6 | `regression-release-gate` |
| 19 | `list` sempre com `limit` | Rules | Consulta sem `limit` negada | Parcial: investimentos, `cash_report_periods` e, na P3-I, `client_private`, `client_events` e `receivable_events` (`limit <= 100`) e, na P3-J, `cash_accounts`, `cash_account_movements`, `cash_transfers` (`limit <= 100`) e `cash_account_events` (owner/admin, `limit <= 100`) | P3–P6 | `firestore-scale-cost-review` |
| 20 | Nenhuma coleção sem regra explícita | Rules | Enumeração das coleções usadas pelo código | Não existe | P6 | `multi-tenant-security-review` |
| 21 | IA com contexto do servidor e saída validada | Callables | Campo de contexto forjado recusado; saída fora do schema recusada | Implementado na P5-E1 (`functions/src/ai/__tests__/aiSecurity.integration.test.ts`, `aiContext.integration.test.ts`); milestone não concluída: gate `FAIL` por bloqueadores alheios ao código | P5 | `privacy-lgpd-data-lifecycle` |
| 22 | Ações administrativas exigem claim e geram auditoria | Callables | Sem claim, recusa; com claim, evento imutável | Não existe | P7 | `observability-incident-readiness` |
| 23 | Integração não pula sem Emulator no CI | CI | Execução sem Emulator falha | Parcial: as suítes de P1 e do kernel falham sem Emulator (`functions/src/shared/testSupport/kernelTestSupport.ts:22`); outras suítes ainda usam `skip` (FIRE-13) | P6 | `regression-release-gate` |

---

## 16. GAPs e configuração externa

| ID | Sev. | Milestone | Camada |
| --- | --- | --- | --- |
| PR-AI-02 | BLOCKER | P0 | Segredos (E-00) |
| PR-PLAT-01 | BLOCKER | P6 | Ambientes e acesso operacional |
| PR-PLAT-02 | BLOCKER | P6 | Ferramenta destrutiva |
| PR-RULES-01 | BLOCKER | P3 | Rules de coleções adjacentes (recurring fechado na P4-B e split em P4-C; clientes e recebíveis fechados na P3-I; contas e transferências fechadas na P3-J) |
| PR-APPCHK-01 | HIGH | P6 | App Check |
| PR-PLAT-03 | HIGH | P6 | Hosting e supply chain |
| PR-AUTH-04 | HIGH | P6 | Artefato de teste |
| PR-AI-03 | HIGH | P2 (P2B) | Custo de IA |
| PR-ADMIN-01 | HIGH | P7 | Admin de plataforma |
| PR-OBS-02 | HIGH | P7 | Contenção de incidentes (revogação de sessão, interruptor por funcionalidade, modo somente leitura) |
| PR-REL-01 | HIGH | P6 | CD e proteção de branch |
| PR-RULES-02 | MEDIUM | P6 | Catch-all de leitura |
| PR-AI-05 | MEDIUM | P5 | Contexto e saída da IA: tratado na P5-E1, milestone não concluída: gate `FAIL` por bloqueadores alheios ao código |

PR-BILL-05 (segredos Stripe) fechado em P2A (PLAN §17.3); FIRE-10 (configuração não secreta como parâmetro de ambiente) segue em P6. GAPs de RBAC e membership (PR-WS-01 a PR-WS-06, fechados em P1 (PLAN §16.4)) estão em [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §12. Fechados em P1 (PLAN §16.4) entre os MEDIUM/LOW de origem: AUTH-08, ENTRY-20, ENTRY-23, RULES-11, RULES-16, WS-13 e WS-15 (ENTRY-21 parcial; ver [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) §12). MEDIUM/LOW de origem tratados aqui: AUTH-08, AUTH-17, ENTRY-11, ENTRY-12, ENTRY-17, ENTRY-20, ENTRY-21, ENTRY-22, ENTRY-23, FIRE-07, FIRE-09, FIRE-10, FIRE-11, FIRE-12, FIRE-13, REL-11, REL-12, REL-15, RULES-11, RULES-15, RULES-16, WS-13, WS-15.

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
