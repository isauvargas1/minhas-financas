# Arquitetura

Referência da arquitetura do Minhas Finanças para o programa de Production Readiness: camadas, kernel compartilhado do backend, padrão de operação financeira autoritativa, mapa de autoridade por domínio, topologia de ambientes, política de legado e princípios de interface. Baseline auditada: `main` @ HEAD `9c3ab46`. Estado, blockers, milestones e decisões ficam no plano mestre [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md); este documento detalha o "como" e remete aos IDs de lá. Não há skill própria de arquitetura: o gate é `regression-release-gate` combinado com as skills da camada tocada (§11), em especial `financial-domain-integrity` (autoridade financeira) e `multi-tenant-security-review` (autorização, Rules e callables).

Rótulos: **CURRENT** (existe no HEAD, com evidência `arquivo:linha`), **TARGET**, **GAP** (ID `PR-*` para BLOCKER/HIGH, ID de origem da auditoria para MEDIUM/LOW), **DECISION** (`D-*`) e **EXTERNAL CONFIGURATION REQUIRED** (`E-*`), conforme a [classificação do plano](PRODUCTION_READINESS_PLAN.md#classificação-usada-em-docsproduction). TARGET não é implementação: confirme o código no HEAD antes de agir.

---

## 1. Visão de camadas

**TARGET** — fluxo de dados entre as camadas:

```text
Navegador — SPA React servida pelo Hosting
  ├─ leitura : Firestore SDK, só do workspace ativo, com limit + cursor ou read model do backend
  └─ escrita : httpsCallable em southamerica-east1, com token de App Check (P6)
                 │
Cloud Functions v2 — Node 24, southamerica-east1, Admin SDK
  ├─ callables : wrapper do kernel (§2) → serviço de domínio → runTransaction
  ├─ triggers  : retry ligado + idempotência por event.id
  ├─ crons     : só o conjunto elegível, cursor persistido, releitura transacional
  └─ webhook   : Stripe → stripe_events/{event.id} → estado único de assinatura
                 │
Firestore (southamerica-east1) — workspaces/{workspaceId}/..., users/{uid}
  └─ Security Rules: segunda camada — leitura por membro ativo com limit; write:false em dado autoritativo
Secret Manager (por projeto) · Terceiros: Stripe, provedor de IA (Gemini)
```

| Camada | CURRENT (evidência) | TARGET | GAP |
| --- | --- | --- | --- |
| Cliente React | React 18.2, Vite 6, TypeScript ~5.8, TanStack Query 5 e Firebase JS SDK 12 (`package.json:46,48,52,62-63`); callables na mesma região do backend (`src/lib/firebase.ts:45`); escreve direto no Firestore em caixa, empréstimos, recebíveis, recorrentes, divisão, cadastro de cartão, workspaces e membros (§4); Tailwind Play CDN e importmap `esm.sh` em runtime (`index.html:8,75-84`) | Escrita só por `httpsCallable`; leitura paginada ou de read model; parse monetário na borda (`src/lib/money.ts`); App Check inicializado antes dos demais serviços; nenhum script de terceiro em runtime | PR-TX-01, PR-RULES-01, PR-PLAT-03, PR-APPCHK-01 |
| Callables | 42 callables entre 47 endpoints (`functions/src/index.ts:14-37`), região e perfis de runtime por classe (`functions/src/shared/runtimeOptions.ts:38-91`), cobertos por teste de contrato (`functions/src/shared/deploymentContract.test.ts:63-178`); três wrappers distintos por domínio (§2.2) | Wrapper único do kernel em toda callable; callables autoritativas para workspace/membership, caixa, empréstimos, recebíveis, recorrentes, divisão e cadastro de cartão | PR-WS-02, PR-TX-01, PR-LOAN-01, PR-CR-01, PR-REC-01, PR-SPLIT-01, PR-CC-02 |
| Triggers e crons | `onTransactionWrite` idempotente por `event.id`, sem retry (`functions/src/triggers/transactions.ts:35-79`); 3 crons em `America/Sao_Paulo`, paginados, sem retry (`functions/src/crons/recurring.ts:571-586`, `functions/src/crons/creditCardInvoices.ts:315-438`, `functions/src/crons/investmentDrift.ts:325-376`) | Retry com idempotência; releitura transacional antes de mudar status; cursor persistido; cerca de versão em rebuild; alerta por métrica | PR-TX-04, PR-CC-04, ENTRY-16 |
| Webhook | `stripeWebhook` verifica a assinatura e trata só `checkout.session.completed` (`functions/src/webhooks/stripe.ts:52,60`); sem timeout/memória próprios e com `cors: true` (`functions/src/webhooks/stripe.ts:31-41`) | Processador de eventos idempotente e ordenado (ver [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md)) | PR-BILL-01, PR-BILL-06, FIRE-09 |
| Firestore | `(default)` em `southamerica-east1` (`firebase.json:2-7`); dados de tenant em `workspaces/{workspaceId}/...`; coleções top-level de backend sem regra, portanto negadas ao cliente (`functions/src/crons/recurring.ts:84`); 43 índices compostos e `fieldOverrides` vazio (`firestore.indexes.json:2-806`) | Mesmo particionamento; todos os índices e TTL versionados e conferidos por teste contra as queries | READ-11, RULES-13 |
| Security Rules | Default deny fora de `workspaces/` e `users/` (`firestore.rules:1-3,990,1456`); cartões, metas e investimentos server-only (`firestore.rules:1121-1352`); dez coleções adjacentes graváveis por member sem schema (`firestore.rules:1097-1105,1351-1369,1384-1402`); catch-all de leitura (`firestore.rules:1436-1442`) | Segunda camada independente (§5) | PR-RULES-01, PR-RULES-02 |
| Secret Manager | Cinco segredos declarados por função e runtime config legado desabilitado (`functions/src/ai/callables.ts:24-29`, `functions/src/callables/billing.ts:90-94`, `functions/src/webhooks/stripe.ts:35-39`, `firebase.json:12`); fallback placeholder (`functions/src/webhooks/stripe.ts:8-9`) | `defineSecret` sem fallback, por projeto; configuração não secreta como parâmetro por ambiente | PR-BILL-05, FIRE-10 |
| Hosting | SPA `dist`, rewrite `**` → `/index.html`, só `Cache-Control` (`firebase.json:25-58`) | CSP, HSTS, `frame-ancestors` e demais headers; no-cache para todo HTML; rotas públicas (P9) | PR-PLAT-03, FIRE-07, PR-COMM-01 |
| Auth | Google por `signInWithPopup` (`src/contexts/AuthContext.tsx:83-91`) e login E2E com credenciais fixas por flag (`src/contexts/AuthContext.tsx:94-114`); backend não checa `email_verified` nem provedor (`functions/src/creditCards/auth.ts:36-52`) | Identidade só do token verificado; política de provedores e verificação (D-06); claim `platformAdmin` | PR-AUTH-04, AUTH-08, PR-ADMIN-01 |
| Terceiros | Stripe (`functions/package.json:22`); Gemini pelo SDK legado `@google/generative-ai` (`functions/package.json:24`) com modelo preview (`functions/src/ai/callables.ts:118-123`); Cloud Storage inicializado sem uso (`src/lib/firebase.ts:4,39`) | Provedor e tier de IA decididos (D-11); Storage removido do cliente ou com Rules versionadas | FIRE-11, FIRE-12, PR-AI-01 |
| CI | `quality-gate.yml` sem segredos: typecheck, lint, builds, unitários, integração e 6 suítes de Rules no Emulator, E2E (`.github/workflows/quality-gate.yml:26-162`); nenhum job de deploy | CD por ambiente com aprovação (P6) | PR-REL-01 |

---

## 2. Kernel compartilhado do backend (P1, D-ORD-02)

Todos os milestones P2–P5 criam callables. O kernel é construído em P1 e consumido por todas elas; construir domínio sem ele gera retrabalho (justificativa em [D-ORD-02](PRODUCTION_READINESS_PLAN.md#9-decisões-de-ordenação-e-escopo-tomadas-em-p0)).

**CURRENT** — já existe base em `functions/src/shared/`: `FUNCTIONS_REGION` e perfis de runtime (`functions/src/shared/runtimeOptions.ts:38-91`), rate limit transacional (`functions/src/shared/rateLimit.ts:55-155`), `RETENTION_DAYS`/`expiresInDays` (`functions/src/shared/retention.ts:23-50`), digests e mensagem de erro sanitizada (`functions/src/shared/observabilityKeys.ts:31-96`) e chaves de data em São Paulo (`functions/src/shared/dateKeys.ts:21-26`). O restante está espalhado por domínio.

**TARGET** — módulos do kernel (nomes de arquivo sugeridos pela auditoria ou propostos aqui; o nome final é fixado em P1):

| Módulo | Responsabilidade |
| --- | --- |
| `functions/src/shared/workspaceAuth.ts` | Resolvedor único de membership/papel, com variante transacional |
| `functions/src/shared/callable.ts` (proposto) | Wrapper de callable |
| `functions/src/shared/idempotency.ts` (proposto) | Reserva, conclusão e replay de chave de idempotência |
| `functions/src/shared/audit.ts` (proposto) | Gravador de auditoria append-only |
| `functions/src/shared/logging.ts` | Logger estruturado e `requestId` de servidor |
| `functions/src/shared/errors.ts` (proposto) | Mapeador único de erros com mensagens pt-BR |
| `functions/src/shared/money.ts` + `src/lib/money.ts` | Dinheiro em centavos inteiros, mesmo contrato no front e no back |
| `functions/src/shared/dateKeys.ts` + espelho no front | Política de datas civis em `America/Sao_Paulo` |

### 2.1 Resolvedor único de membership e papel

- **CURRENT:** `requireWorkspaceRole` vive no módulo de cartões (`functions/src/creditCards/auth.ts:103-125`) e é importado por investimentos, metas, IA, divisão e rebuild de caixa (`functions/src/investments/callables.ts:4`, `functions/src/goals/callables.ts:28`, `functions/src/ai/callables.ts:129`, `functions/src/callables/splitGroups.ts:109`, `functions/src/cash/rebuild.ts:252`). Investimentos têm cópia transacional (`functions/src/investments/infrastructure.ts:152-205`). Ambos caem para `ownerId` quando não há membership (`functions/src/creditCards/auth.ts:73-94`); as Rules repetem o regime duplo (`firestore.rules:27-34`). Cartões e metas checam o papel fora da transação (`functions/src/creditCards/callable.ts:57-61`).
- **TARGET:** `authorizeInTransaction(tx, workspaceId, uid, allowedRoles)` lê `workspaces/{id}` e `members/{uid}` dentro da transação da mutação; exige membership `active`, papel na matriz declarada da operação e workspace não arquivado; sem fallback `ownerId`. `workspaceId` do payload precisa ser igual ao autorizado (padrão já existente em `functions/src/investments/infrastructure.ts:239-248`). As Rules usam um helper equivalente, sem owner-by-parent. O conjunto de papéis segue D-02.
- **GAP:** PR-WS-03, PR-WS-04, WS-10, ENTRY-20.

### 2.2 Wrapper de callable

- **CURRENT:** três wrappers com contratos diferentes (`functions/src/creditCards/callables.ts:96-136`, `functions/src/investments/callables.ts:71-104`, `functions/src/goals/callables.ts:44-105`); IA, checkout, divisão e rebuild tratam erros por conta própria. Quatro mapeadores de erro, rate limit devolvido como `failed-precondition` e detalhes expondo `role/allowedRoles` (`functions/src/investments/errors.ts:49-52`, `functions/src/shared/rateLimit.ts:121-126`, `functions/src/creditCards/auth.ts:115`). `workspaceId` aceita `/` em 18 callables (`functions/src/creditCards/contracts.ts:3`, `functions/src/goals/contracts.ts:5`); só investimentos rejeitam (`functions/src/investments/contracts.ts:9-17`). Nenhum `enforceAppCheck` (`functions/src/shared/runtimeOptions.ts:41-91`).
- **TARGET:** toda callable é declarada pelo wrapper, que aplica em ordem:
  1. opções de runtime da classe (`DOMAIN_CALLABLE_OPTIONS`, `HEAVY_CALLABLE_OPTIONS`, `AI_CALLABLE_OPTIONS`);
  2. ponto de App Check (`enforceAppCheck`, e `consumeAppCheckToken` em IA e checkout), ativado em P6;
  3. autenticação e política de `email_verified`/provedor (D-06);
  4. Zod `.strict()` com esquema de ID sem `/`, `*Cents` como `int().safe()` com teto, strings com tamanho máximo;
  5. geração de `requestId` e contexto de log;
  6. transação com `authorizeInTransaction`, rate limit, idempotência e entitlement (§3);
  7. mapeamento único de erros: códigos estáveis (`invalid-argument`, `permission-denied`, `not-found`, `failed-precondition`, `resource-exhausted` para rate limit e quota, `aborted` para conflito) e mensagem pt-BR sem detalhes internos;
  8. log estruturado do resultado.
- **GAP:** ENTRY-11, ENTRY-21, ENTRY-23, FEW-18; ativação de App Check em P6 (PR-APPCHK-01).

### 2.3 Idempotência

- **CURRENT:** três implementações de reserva/replay com hash do payload (`functions/src/creditCards/idempotency.ts:70-115`, `functions/src/investments/infrastructure.ts:219-305`, `functions/src/goals/operations.ts:64-118`), em coleções por domínio (`firestore.rules:1171,1186,1300`); TTL de 90 dias para chaves (`functions/src/shared/retention.ts:29`). `rebuildCashPeriods` valida `idempotencyKey` e não o usa (`functions/src/cash/rebuild.ts:38`). No front, a compra de cartão gera chave por tentativa (`src/components/TransactionModal.tsx:787-791`), enquanto investimentos usam chave estável por intenção (`src/modules/investments/persistence/intent.ts:79-90`).
- **TARGET:** contrato único, igual ao já provado em cartões e investimentos: documento determinístico por (workspace, operação, hash de `uid:chave`); `requestHash` sem `correlationId`; reserva e conclusão na mesma transação da mutação; replay devolve o resultado salvo; payload divergente gera conflito; `expiresAt` por `RETENTION_DAYS`. Documentos de domínio usam IDs derivados da chave, gravados com `create()`, para que a duplicata falhe mesmo depois do TTL. O cliente gera a chave por intenção de formulário e bloqueia envio em voo.
- **GAP:** PR-CC-03, PR-TX-01, TX-15.

### 2.4 Gravador de auditoria append-only

- **CURRENT:** trilhas separadas por domínio: `financial_events` e `credit_card_audit_logs` (cartões), `goal_audit_logs`, `investment_event_logs` (`firestore.rules:1146,1156,1181,1238`). O `activity_logs` do gatilho de caixa atribui a alteração ao criador do documento, não ao ator (`functions/src/triggers/transactions.ts:94-123`). Caixa, empréstimos, recebíveis, divisão, recorrentes, workspace e membership não têm trilha.
- **TARGET:** uma função chamada dentro da transação grava evento imutável com `operation`, `actorId` (uid do token), `actorRole`, `before`/`after` em centavos, `reason`, `requestId` e `occurredAt` do servidor. Destinos: `workspaces/{id}/financial_events` (financeiro), `workspaces/{id}/membership_events` (membership) e `admin_audit_logs` (plataforma, P7). Rules: leitura só owner/admin, escrita negada. As trilhas existentes são consolidadas em P7.
- **GAP:** PR-TX-05, PR-WS-02, PR-BILL-06, PR-ADMIN-01, ENTRY-17.

### 2.5 Logger estruturado e correlation ID

- **CURRENT:** nenhum uso de `firebase-functions/logger`; erros internos viram `HttpsError` sem log (`functions/src/goals/callables.ts:49-55`); métricas e falhas gravadas em Firestore por módulo (`functions/src/investments/observability.ts:83-128`, `functions/src/creditCards/observability.ts:72-101`); `correlationId` definido pelo cliente: rótulo estático em cartões (`src/components/TransactionModal.tsx:861`), aleatório por tentativa em investimentos (`src/modules/investments/persistence/intent.ts:89-90`).
- **TARGET:** P1 fixa o contrato de `functions/src/shared/logging.ts` sobre `firebase-functions/logger`: `operation`, `workspaceId`, `actorId`, `requestId` gerado no servidor (devolvido nos detalhes do erro), trace, `errorCode`, `durationMs`; erro inesperado logado com stack sanitizado antes do mapeamento; nenhum payload financeiro ou dado pessoal no log. O ID enviado pelo cliente, se mantido, é só atributo auxiliar. Métricas, alertas e remoção da observabilidade duplicada ficam em P7 ([OBSERVABILITY.md](OBSERVABILITY.md)).
- **GAP:** PR-OBS-01 (P7), ENTRY-13.

### 2.6 Módulo money

- **CURRENT:** centavos e micros inteiros só em investimentos (`functions/src/investments/math.ts:12-45`, `functions/src/investments/contracts.ts:20-32`, `src/modules/investments/simple/form.ts:36-40`); metas convertem com `toMinorUnits` e gravam float ao lado (`functions/src/goals/operations.ts:143-152,167-185`); cartões arredondam com `normalizeMoney` (`functions/src/creditCards/createPurchase.ts:99-100`) e o front tem arredondamentos divergentes (`src/components/TransactionModal.tsx:393-394`, `src/components/CreditCardsView.tsx:320`).
- **TARGET:** `functions/src/shared/money.ts` e `src/lib/money.ts` com o mesmo contrato: parse de string para centavos recusando fração de centavo, soma exata com `Number.isSafeInteger`, alocação por maior resto, formatação pt-BR só na exibição, moeda BRL (D-16); regra de lint contra `parseFloat`/`toFixed` em campo monetário. P1 entrega o módulo; a adoção acontece por domínio em P3–P5. Semântica em [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md).
- **GAP:** PR-MONEY-01 (P1), MONEY-13.

### 2.7 Política de datas civis

- **CURRENT:** o backend já calcula chaves `YYYY-MM-DD`/`YYYY-MM` em `America/Sao_Paulo` (`functions/src/shared/dateKeys.ts:11,21-26`), usadas por caixa, investimentos e crons; o front tem cópia só em relatórios (`src/modules/reports/dateWindow.ts:16,26`). Coexistem três definições de janela e fusos mistos (`src/modules/reports/logic.ts:358,517-553`) e datas de recorrência gravadas à meia-noite UTC (`src/modules/recurring-expenses/api.ts:198-199`).
- **TARGET:** data civil persistida como date-key `YYYY-MM-DD` em `America/Sao_Paulo`; instante como timestamp do servidor; uma única definição de janela no backend, espelhada no front; nenhum `toISOString()` para derivar dia. Fuso canônico pendente de D-17 (recomendado).
- **GAP:** PR-REC-05, PR-GOAL-03, RPTAI-12.

### 2.8 Entitlements (entregue em P2, consumido pelo wrapper)

- **CURRENT:** limites de plano só no cliente (`src/hooks/usePlan.ts:36-38`); os rate limits do servidor não dependem de plano (`functions/src/shared/rateLimit.ts:55-155`).
- **TARGET:** `resolveEntitlements(plano, status, datas)` no backend e checagem de quota dentro da transação que cria o recurso, com contadores por workspace e período; cada callable nova de P3–P5 declara sua quota no wrapper.
- **GAP:** PR-ENT-01 (P2, fecha em P5 conforme D-ORD-05), PR-AI-03.

---

## 3. Padrão de operação financeira autoritativa

**CURRENT (referências a seguir):** a criação de compra de cartão grava compra, parcelas, faturas, ledger, snapshot, evento, notificação, auditoria e chave de idempotência numa única transação (`functions/src/creditCards/createPurchase.ts:434-813`); o ledger de investimentos grava posição, resumo, período e espelho de caixa no mesmo commit do movimento (`functions/src/investments/operationsV2.ts:328-566`).

**TARGET** — fluxo de toda mutação financeira:

1. **Cliente.** Converte a entrada para centavos com `src/lib/money.ts`, gera `idempotencyKey` por intenção, desabilita o envio em voo e chama a callable. Nunca grava no Firestore.
2. **Wrapper, fora da transação.** App Check, autenticação, Zod estrito, `requestId`, contexto de log (§2.2).
3. **Transação Admin SDK (`runTransaction`), leituras primeiro.** `authorizeInTransaction` (membership e papel relidos); documento de idempotência (replay ou conflito); contador de rate limit; entitlement/quota; estado atual do agregado (contrato, fatura, saldo, versão).
4. **Invariantes.** Máquina de estados, saldo e limite derivados no servidor, soma de parcelas/rateios igual ao total em centavos, `expectedVersion` quando é edição (TX-13), período fechado não é reescrito.
5. **Escritas no mesmo commit.** Documentos de domínio com IDs determinísticos (`create()`); lançamento de caixa pelo serviço de caixa quando há efeito financeiro; projeções/agregados afetados; evento de auditoria; notificação, se houver; conclusão da chave de idempotência com o resultado.
6. **Pós-commit.** Log estruturado com o resultado e a duração; resposta com DTO em centavos. Falha: erro mapeado em pt-BR, com `requestId`.
7. **Segunda camada.** As Rules negam a escrita direta do cliente em todas as coleções tocadas (§5).

**Regras de composição (TARGET):**

- Um domínio não grava documentos de outro diretamente. Caixa, cartões e divisão expõem serviços de domínio que recebem a `Transaction` do chamador; a callable é um adaptador fino. **CURRENT:** `executeCreateCreditCardPurchase` abre a própria transação (`functions/src/creditCards/createPurchase.ts:427-434`), então hoje não pode ser composto na transação de recorrentes ou divisão, embora o contrato já aceite `source` `recurring` e `split` (`functions/src/creditCards/contracts.ts:33-36`).
- Espelhos de caixa gravados por outro domínio levam vínculo de origem server-only e só são anulados pela callable do domínio de origem (PR-TX-02).
- Correção é estorno compensatório mais novo lançamento. Não existe hard delete de histórico financeiro; cadastro é arquivado.
- Quando uma composição não couber numa transação, cada etapa usa chave determinística derivada da operação de origem e estado pendente reconciliável. Nunca há escrita parcial sem rastro.

**Processamento assíncrono (TARGET):**

- **Gatilhos:** `retry` ligado, marca write-once por `event.id` na mesma transação (padrão existente em `functions/src/cash/periods.ts:335-366`).
- **Projeção de caixa:** uma única via de escrita. A escolha entre atualizar `cash_report_periods` no commit da callable (padrão de investimentos) ou manter o gatilho com retry é **DECISION D-38** (P3; remediação de PR-TX-04).
- **Crons:** consultam só o conjunto elegível com índice, relêem o documento dentro da transação antes de mudar status (PR-CC-04), persistem cursor, declaram retry e registram resumo com flag de truncamento.
- **Rebuilds:** cerca de versão ou lease contra escritas concorrentes, idempotência efetiva e evento de auditoria (ENTRY-08, TX-15).
- **Webhook Stripe:** `stripe_events/{event.id}` gravado na transação que aplica o efeito, ordem por `created`, resposta 2xx só após persistir (PR-BILL-06).

**Testes obrigatórios por operação (TARGET, Emulator):** RBAC por papel e cross-tenant; replay idempotente; duplo envio concorrente; concorrência com outra operação no mesmo agregado; fração de centavo e payload fora do schema rejeitados; Rules negando a escrita direta; E2E do fluxo real da UI. A ausência dessa matriz nos domínios escritos pelo cliente é o GAP PR-REL-02, fechado em P3 para caixa, empréstimos e recebíveis; recorrentes e divisão recebem a matriz em P4 (PR-SPLIT-07 cobre a divisão).

---

## 4. Mapa de autoridade por domínio

Fonte de verdade é o documento ou ledger que prevalece em divergência; projeções e espelhos são derivados. Detalhe por domínio em [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md), [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) e [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md).

| Domínio | Fonte de verdade | Quem escreve hoje (CURRENT) | Quem escreve no alvo (TARGET) | Milestone | GAP |
| --- | --- | --- | --- | --- | --- |
| Perfil | `users/{uid}` | Cliente (allowlist de perfil) e webhook (plano) (`firestore.rules:148-157,1456-1467`; `functions/src/webhooks/stripe.ts:97-106`) | `bootstrapAccount` cria perfil server-owned; cliente edita só preferências por allowlist | P1 | PR-AUTH-03 |
| Workspace | `workspaces/{id}` | Cliente, três escritas independentes (`src/modules/workspaces/api.ts:182-213`; `firestore.rules:991-994`) | `createWorkspace`, `updateWorkspaceSettings`, `archiveWorkspace` | P1 | PR-WS-05, PR-AUTH-03 |
| Membership e convites | `workspaces/{id}/members/{uid}` | Cliente, com UID fictício no convite (`src/modules/workspaces/api.ts:236-265`; `src/components/MembersManagerModal.tsx:53-66`; `firestore.rules:1010-1051`) | `inviteWorkspaceMember`, `acceptWorkspaceInvite`, `revokeWorkspaceInvite`, `changeWorkspaceMemberRole`, `removeWorkspaceMember`, `leaveWorkspace`, `transferWorkspaceOwnership`; convites em `workspaces/{id}/invites` | P1 | PR-WS-01, PR-WS-02 |
| Índice do usuário | derivado de `members` | Próprio usuário grava `users/{uid}/workspaces` com `role` (`firestore.rules:1476-1486`) | Só backend, mantendo o caminho `users/{uid}/workspaces` com `write: false` nas Rules; papel sempre lido do membership | P1 | PR-WS-03 |
| Assinatura | estado único por entidade pagadora (D-01) | Webhook grava `planId: 'pro'` em `users/{uid}` (`functions/src/webhooks/stripe.ts:97-107`) | Só o webhook, em documento server-owned (ex.: `workspaces/{id}/billing/subscription`) | P2 | PR-BILL-01, PR-BILL-07 |
| Quotas | entitlement derivado da assinatura | Só a UI compara limites (`src/hooks/usePlan.ts:36-38`) | Callables checam a quota na transação | P2 (fecha em P5) | PR-ENT-01 |
| Caixa | `workspaces/{id}/transactions` | Cliente (`src/modules/transactions/api.ts:258,284,323,354`; `firestore.rules:1053-1095`) e espelhos de backend (`functions/src/investments/operationsV2.ts:462-566`, `functions/src/creditCards/registerInvoicePayment.ts:407-428`, `functions/src/crons/recurring.ts:322-355`) | `createCashTransaction`, `updateCashTransaction`, `voidCashTransaction` em `amountCents` e serviço de caixa para os outros domínios; tipo `parcelado` removido em P4 | P3 | PR-TX-01, PR-TX-02, PR-TX-06 |
| Projeção de caixa | derivada de `transactions` | Backend: gatilho e rebuild (`functions/src/triggers/transactions.ts:35-79`; `functions/src/cash/rebuild.ts:247-274`) | Backend, com fórmula única, retry/cerca e reconciliação | P3 | PR-TX-03, PR-TX-04 |
| Empréstimos | `loans` + ledger `loan_movements` | Cliente, com saldo recalculado no navegador (`src/modules/loans/api.ts:221,238,262-283,340-369`; `firestore.rules:1351-1358`) | `createLoan`, `registerLoanPayment`, `reverseLoanMovement`, `cancelLoan`, `updateLoanMetadata` | P3 | PR-LOAN-01, PR-LOAN-02, PR-LOAN-03, PR-LOAN-04 |
| Clientes e recebíveis | `clients`, `receivables` | Cliente (`src/modules/clients/api.ts:59,74,82,123,138,144`; `firestore.rules:1361-1368`) | `createClient`, `updateClient`, `archiveClient`, `createReceivable`, `updateReceivable`, `receiveReceivable` (gera a receita na mesma transação), `cancelReceivable` | P3 | PR-CR-01, PR-CR-02, PR-CR-03 |
| Cadastro de cartão | `credit_cards` + `card_limit_snapshots` | Cliente owner/admin, inclusive delete (`src/modules/credit-cards/api.ts:77,92,100`; `firestore.rules:1107-1118`) | `createCreditCard`, `updateCreditCardSettings`, `changeCreditCardLimit`, `changeCreditCardStatus`, `archiveCreditCard` | P4 | PR-CC-01, PR-CC-02 |
| Compras, faturas e limite | `credit_card_*`, `card_limit_ledger` | Backend: 9 callables (`functions/src/creditCards/callables.ts:142-193`; `firestore.rules:1121-1174`) | Backend, em centavos, com máquina de estados de fatura e cron com releitura | P4 | PR-CC-04, PR-CC-05, PR-CC-06 |
| Recorrentes | `recurring_expenses`, `recurring_occurrences` | Cliente sem schema e cron (`src/modules/recurring-expenses/api.ts:207,230,238,327`; `firestore.rules:1097-1105`; `functions/src/crons/recurring.ts:459-521`) | Callables + cron; ocorrência por data; `generateRecurringOccurrence`; cartão via serviço de compra (`source: recurring`) | P4 | PR-REC-01, PR-REC-02, PR-REC-04, PR-RULES-01 |
| Divisão de contas | `split_*` | Cliente; backend só cria/aceita convite (`src/modules/split-bills/api.ts:145,194-232,296`; `firestore.rules:1384-1401`; `functions/src/callables/splitGroups.ts:100-191`) | Módulo `functions/src/splitBills/`: `createSplitBill`, `updateSplitBill`, `settleSplitShare`, `voidSplitBill`, reembolso; papel de grupo lido no servidor | P4 | PR-SPLIT-01, PR-SPLIT-03, PR-SPLIT-04 |
| Investimentos | ledger `investment_movements` | Backend: 23 callables (`functions/src/investments/callables.ts:71-104`; `firestore.rules:1190-1352`) | Mantido; leituras só das projeções oficiais; fallbacks e superfície sem uso removidos (D-15) | P4 (ferramenta destrutiva: P6) | PR-INV-01, PR-PLAT-02 |
| Metas | `goals` | Backend: callables com Zod, transação e idempotência (`functions/src/goals/callables.ts:22-30,76-81`; `firestore.rules:1176-1188`) | Mantido; projeção única de progresso em centavos; metas PJ lidas de projeção de caixa | P5 | PR-GOAL-01, PR-GOAL-03 |
| Relatórios e alertas | projeções server-side | Navegador agrega transações e cartões (`src/modules/reports/hooks.ts:130-259`); alertas em memória (`src/modules/reports/logic.ts:697-721`) | `getFinancialReport` sobre projeções; alertas persistidos por job idempotente | P5 | PR-RPT-02, PR-RPT-04 |
| Notificações | `notifications` | Backend produz (`functions/src/creditCards/domainNotifications.ts:263-297`); cliente altera `read` e apaga (`firestore.rules:1371-1381`) | Só backend escreve em `notifications`; estado de leitura e arquivamento em documento por usuário, gravado pelo próprio | P5 | PR-NOTIF-01 |
| Mensagens | nenhuma | Mock em `localStorage` (`src/modules/messages/api.ts:30-66`) | Remoção ou backend real (D-09) | P5 | PR-MSG-01 |
| IA | contexto derivado das projeções | Contexto montado pelo cliente (`src/modules/reports/api.ts:230-246`); histórico em `localStorage` (`src/modules/reports/hooks.ts:343`) | Contexto e histórico no servidor; saída validada | P5 | PR-AI-04, PR-AI-05 |
| Catálogo de configurações | `settings_catalog` | Cliente owner/admin com schema validado (`src/modules/settings-catalog/api.ts:192,250,344`; `firestore.rules:1404-1433`) | Callables ou escrita do cliente com Rules estritas (schema, sem delete), conforme **DECISION D-23**; índice versionado e rename corrigido | P4 | PR-RULES-03 |
| Administração da plataforma | claim `platformAdmin` | `isAdmin` lido pelo cliente (`src/contexts/AuthContext.tsx:55-61`) | Custom claim e callables auditadas, ou remoção do painel (D-10) | P7 | PR-ADMIN-01 |

---

## 5. Firestore Rules como segunda camada

Detalhe em [SECURITY_MODEL.md](SECURITY_MODEL.md) e [DATA_MODEL.md](DATA_MODEL.md).

- **CURRENT:** membership com status nos helpers (`firestore.rules:9-24`); allowlists em `users`, `workspaces`, `members` e `transactions` (`firestore.rules:67-98,100-135,148-157`); `list` limitado só em investimentos e `cash_report_periods` (`firestore.rules:474-476,1280-1282`); 6 suítes de Rules no Emulator (`package.json:21`).
- **TARGET:**
  - `allow write: if false` em toda coleção financeira e de controle: `transactions`, `loans`, `loan_movements`, `clients`, `receivables`, `recurring_*`, `split_*`, `credit_cards`, `workspaces`, `members`, `invites`, índice do usuário, `notifications`.
  - Escrita do cliente só em dado não financeiro do próprio usuário (preferências em `users/{uid}`, documento de estado de leitura de notificações do próprio usuário) e, se D-23 mantiver a escrita no cliente, no catálogo de configurações, sempre com `hasOnly`, tipos, tetos e `request.time`.
  - `delete: false` em todo histórico.
  - `list` exige `request.query.limit` em todas as coleções de workspace (READ-10).
  - Um `match` explícito por coleção, sem catch-all (PR-RULES-02, P6).
  - Membership ativo como único regime de papel.
  - Suíte por coleção com todos os papéis e cross-tenant.
- **Regra de transição:** Rules e UI de um domínio mudam no mesmo milestone, com E2E do fluxo real antes e depois (R-02).

---

## 6. Topologia de ambientes

| Ambiente | CURRENT | TARGET |
| --- | --- | --- |
| Emulator | Projeto `minhas-financas-local` para integração, Rules e E2E (`package.json:21,36`; `firebase.json:59-78`, `singleProjectMode`); o ID não tem o prefixo `demo-` (FIRE-13) | Obrigatório para todo teste Firebase; projeto `demo-*`; CI falha se o Emulator não estiver ativo |
| DEV | Não existe separado: o único projeto é também o ambiente de desenvolvimento (`.firebaserc:3`) | Projeto próprio, dados de seed, ferramentas destrutivas permitidas só aqui e no Emulator |
| STAGING | Não existe; `tools/staging/rehearsal.sh:21-41` recusa produção, mas não há alias | Projeto próprio; ensaio de deploy, restore, rollback e replay de webhook antes de PROD |
| PROD | `sistema-financeiro-pesso-20698` como `default` e alvo fixo de todos os `deploy:*` (`package.json:22-26`); `functions/package.json:12` sem `--project` | Sem `default`; deploy só por CD com aprovação e Workload Identity Federation; segredos e parâmetros próprios |

- **GAP:** PR-PLAT-01 (P6), PR-PLAT-02 (P6), PR-AUTH-04 (P6), ENTRY-19, RULES-14.
- **DECISION:** D-19 define qual projeto vira PROD. Tomada: D-ORD-04 — nenhum artefato de P1–P5 vai para projeto remoto antes do fechamento de P6; até lá, só Emulator. O risco residual é R-01.
- Detalhe operacional em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) e [RUNBOOKS.md](RUNBOOKS.md).

---

## 7. Política de legado aplicada por domínio

Regra completa em [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md#política-de-legado) e inventário em [§7 do plano](PRODUCTION_READINESS_PLAN.md#7-legado-a-remover). Não há dados reais: compatibilidade que só preserva dados de teste não é mantida, e os ambientes são ressemeados (R-03).

**Prova de remoção exigida (TARGET):** busca no código sem ocorrência do caminho antigo; Rules que negam o caminho antigo, com teste; teste de contrato que impede a volta de exports removidos. **CURRENT (precedente):** o teste de contrato já trava as callables legadas de investimento e metas (`functions/src/shared/deploymentContract.test.ts:155-178`).

| Domínio | O que sai quando o substituto entra | Milestone |
| --- | --- | --- |
| Workspaces e membership | Escritas do cliente em workspace/membros/índice; `fakeUid`; `ensureOwnerMembership`; fallback `collectionGroup('members')`; fallback `ownerId` no backend e nas Rules; resolvedores duplicados | P1 |
| Billing | `src/constants/plans.ts` e `checkLimit` como fonte de limite; `planId`/`isPro` em `users/{uid}`; fallbacks placeholder de segredo | P2 |
| Caixa, empréstimos, recebíveis | `addDoc`/`writeBatch`/`updateDoc` em `transactions`; campo `value` float; CRUD e cascatas de `loans`, `clients`, `receivables` no cliente | P3 |
| Cartões, recorrentes, divisão, investimentos | Tipo `parcelado` e camada `credit-cards/compatibility`; CRUD/delete de `credit_cards`; geração manual de recorrência no cliente; Split no cliente; fallback `type 'investimento'` e leitura de aportes pelo espelho; arquivos `manual*Test.ts` no pacote de deploy (REL-15) | P4 |
| Metas, relatórios, notificações, Mensagens, IA | Campos de progresso duplicados; agregação no navegador; alertas em memória; `createNotification` morto; Mensagens simulado (D-09); histórico de IA em `localStorage` | P5 |
| Plataforma | Login E2E no bundle; Tailwind Play CDN e `esm.sh`; ferramenta destrutiva com override para produção | P6 |
| Observabilidade e admin | Observabilidade duplicada por módulo; `isAdmin` lido no cliente | P7 |

---

## 8. Interface e pt-BR

- **TARGET:** a UI autenticada fica visualmente inalterada. Muda só o necessário para integração, estado, validação, segurança ou contrato alterado pelo backend, com a menor alteração possível: trocar escrita direta por callable, exibir erro mapeado, desabilitar envio em voo. Sem redesign, ajuste estético ou reorganização de navegação.
- **TARGET:** todo texto visível em pt-BR, inclusive mensagens de erro do backend, que saem do mapeador do kernel (§2.2) e nunca como `error.message` cru.
- **CURRENT (desvios):** documento em `lang="en"` (`index.html:3`); texto pt-PT no checkout (`src/modules/billing/hooks.ts:34`) e `error.message` cru exibido (`src/modules/billing/hooks.ts:40`); painel administrativo em pt-PT (`src/components/AdminDashboard.tsx:39,51,63`). GAP: FEW-18, AUTH-15, TX-16, WS-14.
- **DECISION com efeito visual:** D-20 (Tailwind compilado, com paridade por screenshot; risco R-04, ligado a PR-PLAT-03 em P6) e D-09 (remover Mensagens altera o Header e exige aprovação).
- Gate: `ptbr-product-ui-review` em toda mudança renderizada.

---

## 9. Decisões com impacto na arquitetura

**DECISION (pendentes, ver [§10 do plano](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision)):**

| ID | Efeito na arquitetura |
| --- | --- |
| D-01 | Onde vive o estado de assinatura e contra quem a quota é contada |
| D-02 | Matriz de papéis do resolvedor e das Rules (com ou sem `viewer`) |
| D-03 | Invariantes de owner no resolvedor e papel de `ownerId` |
| D-06 | Política de provedor e `email_verified` no wrapper |
| D-09 | Remoção de Mensagens ou novo backend |
| D-10 | Existência da camada administrativa (`platformAdmin`) |
| D-11 | Provedor de IA, SDK e fluxo de dados para terceiros |
| D-15 | Superfície profissional de investimentos mantida ou removida |
| D-16 | BRL fixo no módulo money ou multimoeda |
| D-17 | Fuso canônico da política de datas |
| D-19 | Mapeamento dos projetos DEV/STAGING/PROD |
| D-20 | Build de CSS e paridade visual |
| D-23 | Catálogo de configurações por callable ou cliente com Rules estritas |
| D-29 | Função única de efeito de caixa (regime de caixa × competência) |
| D-33 | Rollout do App Check no wrapper, em Firestore e em Auth |
| D-34 | Contrato de alocação do resíduo e recusa de fração no módulo money |
| D-35 | Correção de lançamento e trilha de auditoria de caixa |
| D-38 | Via única de atualização da projeção de caixa |

**DECISION (tomadas):** D-ORD-01 (caixa autoritativo abre P3), D-ORD-02 (kernel em P1), D-ORD-04 (nada remoto antes de P6), D-ORD-05 (quotas incrementais P2–P5).

---

## 10. Configuração externa

**EXTERNAL CONFIGURATION REQUIRED** — nada disto é verificável pelo repositório. Registro de valor esperado, estado, data e responsável no documento indicado no [§11 do plano](PRODUCTION_READINESS_PLAN.md#11-configuração-externa-necessária-external-configuration-required).

| ID | Item com efeito arquitetural | Estado |
| --- | --- | --- |
| E-01 | Projetos DEV/STAGING/PROD, aliases, faturamento por projeto | NÃO VERIFICADO |
| E-02 | App Check por ambiente e enforcement em Firestore, Functions e Auth | NÃO VERIFICADO |
| E-03 | Provedores de Auth, domínios autorizados, MFA para admins | NÃO VERIFICADO |
| E-04 | Service accounts de privilégio mínimo, Workload Identity Federation | NÃO VERIFICADO |
| E-05 | Secret Manager por ambiente e rotação | NÃO VERIFICADO |
| E-06 | Stripe: preços test/live, endpoint e eventos do webhook, Customer Portal | NÃO VERIFICADO |
| E-07 | PITR, backups, delete protection e TTL no Firestore PROD | NÃO VERIFICADO |
| E-08 | Alertas, retenção de logs e budget | NÃO VERIFICADO |
| E-12 | Proteção de `main` e environments com aprovação no GitHub | NÃO VERIFICADO |

---

## 11. Mapa de skills por camada

Toda skill emite só `PASS` ou `FAIL`; o fechamento de milestone exige `regression-release-gate` em `PASS` junto das skills da superfície tocada.

| Camada ou tema | Skill |
| --- | --- |
| Dinheiro, eventos, saldos, projeções, relatórios, remoção de legado financeiro | `financial-domain-integrity` |
| Auth, workspace, membership, RBAC, callables, Rules, Storage | `multi-tenant-security-review` |
| Queries, listeners, schema, índices, agregados, crons sobre coleções | `firestore-scale-cost-review` |
| Stripe, catálogo, assinatura, webhook, entitlements, quotas | `billing-entitlement-integrity` |
| Ambientes, `firebase.json`, runtime de Functions, App Check, segredos, IAM, backup | `firebase-production-readiness` |
| Logging, correlação, auditoria, alertas, reconciliação, incidentes | `observability-incident-readiness` |
| Dados pessoais, terceiros (IA, Stripe), retenção, exclusão, exportação | `privacy-lgpd-data-lifecycle` |
| Superfície pública, preços, páginas legais, cadastro | `saas-commercial-readiness` |
| Qualquer conteúdo renderizado, erros exibidos, paridade visual | `ptbr-product-ui-review` |
| Fechamento de milestone, commit importante, release, PR | `regression-release-gate` |

---

## 12. Documentos relacionados

[FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md) · [AUTH_RBAC_WORKSPACES.md](AUTH_RBAC_WORKSPACES.md) · [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md) · [DATA_MODEL.md](DATA_MODEL.md) · [SECURITY_MODEL.md](SECURITY_MODEL.md) · [THREAT_MODEL.md](THREAT_MODEL.md) · [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) · [OBSERVABILITY.md](OBSERVABILITY.md) · [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md) · [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md) · [RUNBOOKS.md](RUNBOOKS.md)
