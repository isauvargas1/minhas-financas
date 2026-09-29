# Autenticação, RBAC e workspaces

Referência do programa de Production Readiness para autenticação, sessão, ciclo de vida de conta, workspaces PF/PJ, memberships, RBAC, convites e administração de plataforma. Baseline auditada: HEAD `9c3ab46`. O estado, a ordem e os IDs canônicos estão no plano mestre, [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md) (§5.1, §5.2, §6 e P1 em §8). O gate do tema é a skill `multi-tenant-security-review`, acompanhada em P1 de `firestore-scale-cost-review`, `ptbr-product-ui-review` e `observability-incident-readiness` (contrato de auditoria), conforme o plano. A exclusão de conta (P8) passa também por `privacy-lgpd-data-lifecycle`.

Rótulos conforme a tabela de classificação do plano: **CURRENT** (existe no HEAD, com `arquivo:linha`), **TARGET** (alvo, não implementado), **GAP** (ID do registro), **DECISION** (§9/§10 do plano) e **EXTERNAL CONFIGURATION REQUIRED** (fora do repositório, estado NÃO VERIFICADO). Controles transversais (App Check, Hosting, segredos, IA) ficam em [SECURITY_MODEL.md](SECURITY_MODEL.md); ameaças em [THREAT_MODEL.md](THREAT_MODEL.md); quotas em [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md); exclusão e exportação em [PRIVACY_LGPD.md](PRIVACY_LGPD.md).

---

## 1. Resumo

| Tema | Classificação | Situação | Evidência / ID |
| --- | --- | --- | --- |
| Login | CURRENT | Só Google por `signInWithPopup`; login e-mail/senha de E2E com credenciais fixas ativado por flag de build | `src/contexts/AuthContext.tsx:83-91`, `:33,94-114,129` |
| Perfil `users/{uid}` | CURRENT | Nenhum cadastro cria o perfil; o único escritor é o webhook Stripe | `functions/src/webhooks/stripe.ts:97-107` |
| Bootstrap | CURRENT | Primeiro workspace criado no cliente quando a listagem volta vazia, com três escritas separadas | `src/contexts/WorkspaceContext.tsx:47-62`; `src/modules/workspaces/api.ts:188,196,199-213` |
| Membership | CURRENT | Criar workspace, adicionar/remover membro e trocar papel são escritas do cliente, sem callable, transação ou auditoria | `src/modules/workspaces/api.ts:182-264` |
| Convite | CURRENT | UID fictício derivado do e-mail; não há token, expiração, e-mail nem aceite | `src/components/MembersManagerModal.tsx:53-66` |
| Anti-escalada nas Rules | CURRENT | Enum de papel, `uid == memberId`, sem autopromoção, `owner` só concedido por owner, com testes no Emulator | `firestore.rules:1021-1041`; `tests/firestore/m4-hardening.rules.integration.test.mjs:257-356` |
| Autoridade de papel | CURRENT | Regime duplo `ownerId` × membership nas Rules e no backend; dois resolvedores de papel | `firestore.rules:27-34`; `functions/src/creditCards/auth.ts:54-101`; `functions/src/investments/infrastructure.ts:158-212` |
| Isolamento entre tenants | CURRENT | Nenhum vazamento cross-tenant encontrado neste domínio; o risco é intra-workspace e de integridade | auditoria `auth-account`; `tests/firestore/m4-hardening.rules.integration.test.mjs:246` |
| Alvo | TARGET | Identidade só do token verificado; callables de ciclo de vida com transação, auditoria e idempotência; membership ativo como fonte única de papel; Rules `write: false` em `members`, índice do usuário e criação de workspace | P1 em [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md#p1--auth-workspaces-rbac-e-ciclo-de-vida-de-conta) |

GAPs do domínio: PR-AUTH-01, PR-AUTH-02, PR-AUTH-03, PR-AUTH-04 e PR-WS-01 a PR-WS-06 (§12).

---

## 2. Autenticação e sessão

| Aspecto | Classificação | Descrição | Evidência / ID |
| --- | --- | --- | --- |
| Provedor | CURRENT | Google via popup; o erro é relançado e a tela não o trata | `src/contexts/AuthContext.tsx:83-91`; `src/components/auth/LoginView.tsx:27-37` |
| Login de teste | CURRENT | `signInForE2E` com e-mail e senha fixos no código e auto-cadastro em `invalid-credential`, exposto quando `VITE_E2E_MODE === 'true'` | `src/contexts/AuthContext.tsx:33,94-114,129` |
| Conexão ao Emulator | CURRENT | Ligada por `VITE_USE_FIREBASE_EMULATORS`, sem garantir que modo E2E implique Emulator | `src/lib/firebase.ts:47-62` |
| Sessão | CURRENT | `onAuthStateChanged`; persistência padrão; sem `setPersistence`, reautenticação nem MFA | `src/contexts/AuthContext.tsx:48-81`; AUTH-17 |
| Gating | CURRENT | `AuthGuard` mostra `LoginView` sem usuário; `WorkspaceProvider` fica fora do guard | `src/App.tsx:686-691,693-706` |
| Verificação de e-mail | CURRENT | Rules aceitam qualquer `request.auth`; o backend só exige `uid`; o checkout usa `token.email` sem checar `email_verified` | `firestore.rules:5-7`; `functions/src/creditCards/auth.ts:36-52`; `functions/src/callables/billing.ts:139` |
| Blocking functions e gatilhos de Auth | CURRENT | Inexistentes | `functions/src/index.ts:13-37` |
| Logout | CURRENT | Só `signOut`, com erro engolido; cache do React Query e histórico de IA no `localStorage` permanecem | `src/contexts/AuthContext.tsx:116-122`; `src/App.tsx:108-115`; `src/modules/reports/hooks.ts:343-358` |
| Mensagens de falha | CURRENT | Popup bloqueado ou falha de rede sem mensagem pt-BR; falha ao carregar workspaces renderiza o pseudo-workspace `loading` | `src/components/auth/LoginView.tsx:28`; `src/contexts/WorkspaceContext.tsx:22-30,76-80` |
| Identidade | TARGET | Identidade vem só do ID token verificado. O wrapper de callable do kernel (D-ORD-02) aplica a política de `email_verified` por callable (§9) e uma allowlist de `sign_in_provider` por ambiente (só Google) | D-06 |
| Provedores por ambiente | TARGET | Só Google; sem e-mail/senha, sem Apple e sem redesign do login. Blocking functions `beforeUserCreated`/`beforeUserSignedIn` recusam provedor fora da allowlist (requer Identity Platform). O login não exige e-mail verificado; a exigência fica nas callables da §9 | D-06; E-03 |
| Política de sessão | TARGET | `auth_time` nos últimos 10 minutos em `transferWorkspaceOwnership` e `archiveWorkspace` (P1) e na exclusão de conta (P8); o frontend reautentica com Google só quando necessário. Sem MFA para usuários comuns; MFA de admin de plataforma em P7 | D-06; E-03 |
| Login de teste | TARGET | Fora do bundle de produção: módulo exclusivo de teste ou custom token do Emulator; build falha se E2E ou Emulator estiverem ligados fora do modo de teste | PR-AUTH-04 (P6) |
| Logout | TARGET | Limpa o `QueryClient` e as chaves locais por usuário/workspace; o histórico de IA sai do `localStorage` | escopo de P1 no plano; PR-AI-04 (P5) |
| Erros | TARGET | Códigos `auth/*` mapeados para pt-BR, com alternativa por redirect quando o popup falha; nunca renderizar o app sem workspace válido | AUTH-10, AUTH-15 |
| GAP | GAP | Login E2E no código de produção | PR-AUTH-04 (P6) |
| GAP | GAP | Sem `email_verified` nem restrição de provedor | AUTH-08, ENTRY-23 (MEDIUM/LOW) |
| GAP | GAP | Sessão sem política, reautenticação ou MFA | AUTH-17 (LOW) |

**DECISION D-06 (tomada, §9.1 do plano):** só Google. `email_verified` exigido em `createWorkspace`, `inviteWorkspaceMember`, `acceptWorkspaceInvite`, `revokeWorkspaceInvite`, `changeWorkspaceMemberRole`, `removeWorkspaceMember`, `transferWorkspaceOwnership` e `archiveWorkspace`; não exigido em `bootstrapAccount`, `updateWorkspaceSettings` e `leaveWorkspace`. `transferWorkspaceOwnership` e `archiveWorkspace` exigem `auth_time` nos últimos 10 minutos. Sem MFA para usuários comuns; MFA administrativa em P7 (E-03).

---

## 3. Conta e perfil `users/{uid}`

| Aspecto | Classificação | Descrição | Evidência / ID |
| --- | --- | --- | --- |
| Criação | CURRENT | Nenhum fluxo de cadastro cria o perfil. O webhook Stripe faz `set(..., {merge: true})` com `planId`, `isPro`, `stripe*` e `subscriptionStatus` | `functions/src/webhooks/stripe.ts:97-107` |
| Rules de perfil | CURRENT | Leitura só do próprio usuário; create/update restritos à allowlist `displayName`, `photoURL`, `phoneNumber`, `email`, `preferences`, `onboarding`, `locale`, `timezone`, `activeWorkspaceId`, `updatedAt`; delete negado | `firestore.rules:151-185,1456-1467` |
| Campos server-owned | CURRENT | `planId`, `isPro`, `isAdmin`, `stripeCustomerId` e status de assinatura não são graváveis pelo cliente, com teste | `firestore.rules:148-157`; `tests/firestore/m4-hardening.rules.integration.test.mjs:768-850` |
| `rate_limits` do usuário | CURRENT | Leitura e escrita negadas ao cliente | `firestore.rules:1472-1474` |
| Leitura | CURRENT | O mesmo documento é lido duas vezes: `getDoc` para `isAdmin` e `onSnapshot` para o plano | `src/contexts/AuthContext.tsx:56-57`; `src/hooks/usePlan.ts:20` |
| Workspace ativo | CURRENT | `activeWorkspaceId` é editável e não é usado; o app guarda o último workspace em `localStorage` | `firestore.rules:155`; `src/contexts/WorkspaceContext.tsx:67,95` |
| Perfil server-owned | TARGET | `bootstrapAccount` cria `users/{uid}` com `email` copiado do token verificado, `createdAt`, `status` (`active`/`suspended`, D-P1-SUSP), `locale` e `timezone`. `email` e `status` saem da allowlist do cliente. O cliente edita só preferências de exibição | PR-AUTH-03 (P1) |
| Aceite legal | TARGET | O registro versionado de aceite (termos e política) é construído em P8 e exigido no cadastro em P9. `bootstrapAccount` é o ponto de integração | PR-AUTH-02 (P9) |
| Fonte única | TARGET | Um único provider de perfil no cliente e uma única fonte de workspace ativo | AUTH-12 (origem de PR-AUTH-03) |
| GAP | GAP | Perfil sem dono server-side | PR-AUTH-03 (P1) |

---

## 4. Bootstrap de conta e do primeiro workspace

### 4.1 CURRENT

1. `listWorkspaces` engole as falhas das três leituras e pode devolver lista vazia (`src/modules/workspaces/api.ts:83-85,103-105,137-139`).
2. Com lista vazia, `WorkspaceProvider` cria "Meu Espaço Pessoal" com ID aleatório e e-mail placeholder `usuario-sem-email@sistema` (`src/contexts/WorkspaceContext.tsx:50-62`).
3. `createWorkspace` grava o workspace e, depois, `members/{uid}` e `users/{uid}/workspaces/{id}` em `Promise.all`, fora de batch (`src/modules/workspaces/api.ts:188,196,199-213`).
4. O onboarding de investimentos é disparado sem aguardar, só para owner (`src/contexts/WorkspaceContext.tsx:117-121`), e o seed de catálogo roda a cada seleção por owner/admin (`src/contexts/WorkspaceContext.tsx:107-116`).

Consequências: duas abas ou uma falha transitória de leitura criam workspaces pessoais duplicados; uma falha entre as escritas deixa workspace sem membership do owner, acessível só pelo fallback `ownerId` (AUTH-03, WS-07). **GAP:** PR-AUTH-03 (P1).

### 4.2 TARGET: `bootstrapAccount`

Callable idempotente chamada uma vez após o login. O cliente só chama e lê o resultado; erro de leitura vira estado de erro, nunca criação.

1. Wrapper do kernel: autenticação (sem exigir `email_verified`, D-06), recusa de conta suspensa, rate limit por usuário, chave de idempotência derivada do `uid`.
2. Numa transação: lê `users/{uid}`. Se o bootstrap já foi concluído, devolve o resultado gravado (replay).
3. Cria `users/{uid}` server-owned (§3).
4. Cria o workspace pessoal com ID determinístico (proposta: `personal_{uid}`), `type` PF, `ownerId = uid` (desnormalizado, D-03), `status: 'active'`.
5. Cria `workspaces/{id}/members/{uid}` com `role: 'owner'`, `status: 'active'` e `email`/`displayName` do token.
6. Cria a entrada do índice do usuário `users/{uid}/workspaces/{id}` (§6.4).
7. Provisiona catálogo e cadastros de investimentos no próprio backend, de forma idempotente, substituindo o seed e o onboarding disparados pelo cliente.
8. Grava o evento de auditoria (`account.bootstrapped`, `workspace.created`) pelo gravador append-only do kernel.

Pendente de **DECISION**: criar automaticamente o workspace PF ou deixar o usuário escolher PF/PJ no onboarding (levantado pela auditoria `auth-account`; ligado a D-22).

---

## 5. Modelo de workspace (PF/PJ)

| Aspecto | Classificação | Descrição | Evidência / ID |
| --- | --- | --- | --- |
| Tipo | CURRENT | `Workspace` com `type` `PF`/`PJ`, `ownerId` opcional, `cnpj`, `myRole` injetado no cliente; tipo duplicado com o campo legado `userId` | `src/modules/workspaces/types.ts:1-33`; `src/types.ts:21-43` |
| Criação | CURRENT | Qualquer usuário autenticado cria workspace com `ownerId == uid`; a allowlist aceita `type`, `userId` e `createdAt`, mas `isValidWorkspacePayload` não valida o enum de `type` | `firestore.rules:108-135,991-994` |
| Efeito de `type` inválido | CURRENT | O backend exige PF/PJ e quebra com outro valor | `functions/src/investments/infrastructure.ts:140-150` |
| Edição | CURRENT | Owner/admin (ou `ownerId`) alteram só `name`, `slug`, `cnpj`, `logoUrl`, `themeColor`, `pjAccentColor`, `currency`, `alertPreferences`, `updatedAt`; `ownerId` e `type` imutáveis pelo cliente | `firestore.rules:101-106,114-117,1004-1008` |
| Exclusão | CURRENT | Não há `allow delete` em `workspaces/{id}` (negado por padrão) nem fluxo de arquivamento | `firestore.rules:990-1009` |
| Falhas de payload | CURRENT | Configurações envia o objeto inteiro (com `id`, `userId` e campos `undefined`) e criar PJ sem CNPJ envia `cnpj: undefined`; o SDK está sem `ignoreUndefinedProperties` | `src/components/SettingsView.tsx:441-469`; `src/components/CreateWorkspaceModal.tsx:33`; `src/lib/firebase.ts:38` |
| Quota | CURRENT | Limite de workspaces só na UI | `src/components/Header.tsx:58`; `src/constants/plans.ts:5-7` |
| `createWorkspace` | TARGET | Callable com Zod estrito (`name`, `type` ∈ {PF, PJ}, `cnpj` conforme D-22, `themeColor`, `idempotencyKey`). Exige `email_verified` (D-06). Numa transação: workspace (`status: 'active'`, `ownerId` desnormalizado), `members/{uid}` owner ativo, índice do usuário, provisionamento e evento de auditoria. P1 não consulta quota nem entitlement; P2 adiciona a quota nesta transação (D-01) | PR-WS-05 (P1); quota em PR-ENT-01 (P2) |
| `updateWorkspaceSettings` | TARGET | Callable com schema estrito dos campos mutáveis e papel owner/admin. Com ela no ar, o cliente perde create/update de `workspaces/{id}` nas Rules, pela política de legado (sem caminho de escrita concorrente) | PR-WS-05 (P1) |
| `archiveWorkspace` | TARGET | Só owner, com `email_verified` e `auth_time` nos últimos 10 minutos (D-06). Grava `status: 'archived'`, `archivedAt` e `archivedBy`; nunca apaga. O documento-pai permanece como marcador, o que impede recriar o mesmo ID sobre subcoleções órfãs (RULES-06) | WS-09 |
| `currency` | TARGET | Somente BRL: o campo gravável e ignorado deixa de ser aceito do cliente | D-16 (tomada, §9.1 do plano) |
| PF com membros e CNPJ | TARGET | Workspaces PF e PJ podem ter membros. CNPJ opcional; se informado, formato e dígitos verificadores são validados; não é globalmente único | D-22 (tomada, §9.1 do plano) |
| GAP | GAP | Criação pelo cliente sem validar `type`, sem quota e com falhas de payload | PR-WS-05 (P1); quota em PR-ENT-01 (P2), conforme D-ORD-05 |

---

## 6. Membership e fontes de autoridade

### 6.1 Coleções (CURRENT)

| Coleção | Campos | Quem grava hoje | Rules |
| --- | --- | --- | --- |
| `workspaces/{wid}/members/{uid}` | `uid`, `email`, `role`, `status`, `displayName`, `photoURL`, `joinedAt`, `createdAt`, `updatedAt` | Cliente (owner/admin), via `addMember`/`updateMemberRole`/`removeMember` (`src/modules/workspaces/api.ts:236-264`) | Allowlist (`firestore.rules:137-142`); `role` ∈ {owner, admin, member, viewer} (`:144-146`); `status` aceita qualquer string (`:1027`); leitura pelo próprio uid ou por membro (`:1011-1014`) |
| `users/{uid}/workspaces/{wid}` (espelho) | `workspaceId`, `role`, `createdAt`, `updatedAt` | O próprio usuário (`src/modules/workspaces/api.ts:19-33,48-57,125-134,207-212`) | Leitura e escrita só por `request.auth.uid == userId`, com qualquer papel do enum (`firestore.rules:1478-1487`) |

### 6.2 Problemas de autoridade (CURRENT)

- **Regime duplo.** `isWorkspaceOwnerByParent` concede poder de owner a quem é `ownerId` quando não há documento de membership ou quando ele está ativo (`firestore.rules:27-34`), e os helpers de leitura e escrita o incluem (`firestore.rules:435-446,452-460`). O backend cai para `ownerId` quando falta o documento (`functions/src/creditCards/auth.ts:90-94`; `functions/src/investments/infrastructure.ts:189-194`).
- **Divergência entre camadas.** As Rules tratam o `ownerId` com membership ativo como owner, qualquer que seja o `role` do documento. O backend devolve o `role` do documento antes de olhar o `ownerId` (`functions/src/creditCards/auth.ts:73-79`). Um `ownerId` com documento `viewer` escreve como owner pelas Rules e é recusado nas callables (WS-10).
- **Resolvedores duplicados.** `getWorkspaceRoleForUser` lê fora de transação (`functions/src/creditCards/auth.ts:54-101`); `authorizeInvestmentTransaction` relê dentro da transação (`functions/src/investments/infrastructure.ts:158-212`). Cartões e metas verificam o papel antes da transação (ENTRY-20).
- **Trancamento do owner.** Um co-owner por papel pode mudar o `status` do documento do `ownerId`; um admin pode criar esse documento, quando ausente, com papel não owner e status inativo. Com status diferente de `active`, o owner perde as Rules e o backend o recusa (`firestore.rules:13-14,27-33,1021-1041`; `functions/src/creditCards/auth.ts:81-87`). **GAP:** PR-WS-04 (P1).
- **Descoberta e papel exibido.** `listWorkspaces` combina espelho, query por `ownerId` e `collectionGroup('members')`. O fallback está morto: não há regra `{path=**}` nem índice de collection group (`src/modules/workspaces/api.ts:106-139`). A cada carga, `ensureOwnerMembership` regrava o documento do owner com `email: ''` e `displayName: 'Owner'` (`src/modules/workspaces/api.ts:35-59,100,158`). `myRole` vem do espelho autogravado (`src/modules/workspaces/api.ts:77-81,150-155`) e controla a UI (`src/contexts/WorkspaceContext.tsx:131-134`). O painel de investimentos relê `members/{uid}` para contornar isso (`src/modules/investments/components/InvestmentOperationsPanel.tsx:62-90`). **GAP:** PR-WS-03 (P1).
- **Escrita parcial determinística.** `addMember` e `updateMemberRole` gravam `members` e depois tentam gravar o espelho de outro usuário, o que as Rules sempre negam; `removeMember` apaga o membership e falha no espelho alheio (`src/modules/workspaces/api.ts:236-264`; `firestore.rules:1478-1486`). **GAP:** PR-WS-02 (P1).
- **Remoção física.** A remoção é `deleteDoc`, sem auditoria (`src/modules/workspaces/api.ts:249-252`; `firestore.rules:1046-1050`). O status `removed` é suportado pelo backend e testado (`functions/src/investments/__tests__/domainV2.integration.test.ts:871-927`), mas o cliente nunca o usa (WS-11).
- **Efeito imediato da remoção.** As Rules leem o membership a cada requisição (`firestore.rules:9-16`) e os resolvedores leem `members/{uid}` a cada chamada, então remover ou inativar o membership corta o acesso sem depender de revogação de token.

### 6.3 TARGET: membership como fonte única

- `workspaces/{wid}/members/{uid}` é a única fonte de papel. `status` é obrigatório e fechado: `active` ou `removed`, com `removedAt` e `removedBy`. Só o backend grava. Rules: `allow write: if false`; leitura pelo próprio uid ou por membro ativo, com `limit` (RULES-11).
- Exatamente um owner canônico ativo por workspace (D-03). `ownerId` continua no workspace só como dado denormalizado desse owner, gravado só na criação (`bootstrapAccount`/`createWorkspace`) e por `transferWorkspaceOwnership`. Nunca é consultado para autorização nem usado como fallback. O helper `isWorkspaceOwnerByParent` e o fallback `ownerId` do backend são removidos (política de legado, §11).
- Resolvedor único no kernel (D-ORD-02), no módulo proposto em [ARCHITECTURE.md](ARCHITECTURE.md) (`functions/src/shared/workspaceAuth.ts`, função `authorizeInTransaction(tx, workspaceId, uid, allowedRoles)`). Ele valida o formato de `workspaceId` (sem `/`, tamanho máximo), exige que o `workspaceId` do payload seja o autorizado, relê `workspaces/{id}` e `members/{uid}` dentro da transação, exige membership `active` e workspace não arquivado, aplica a matriz da operação e é usado por todos os domínios. Substitui `functions/src/creditCards/auth.ts` e `functions/src/investments/infrastructure.ts:158-212` (ENTRY-11, ENTRY-20, WS-15).
- Um único helper nas Rules, baseado no membership ativo.

### 6.4 TARGET: índice do usuário

O índice do usuário passa a ser mantido só pelo backend, na mesma transação que altera o membership. O caminho `users/{uid}/workspaces/{wid}` é mantido, sem renomear a coleção (plano mestre, P1, "Índice do usuário"). Rules: leitura pelo próprio usuário, `write: false`. O índice guarda dados de exibição (nome, tipo, status do vínculo) e não é fonte de papel: a UI lê o papel de `members/{uid}`, que o próprio usuário pode ler. A listagem usa o índice com `limit` e cursor, sem query por `ownerId`, sem `collectionGroup` e sem escrita durante a leitura (WS-12).

---

## 7. Matriz RBAC

### 7.1 CURRENT: Rules e backend

"Sim" nas Rules inclui o `ownerId` pelo regime `isWorkspaceOwnerByParent`. No backend, `requireWorkspaceRole` pode devolver `viewer` (`functions/src/creditCards/auth.ts:30-34,77-78`), mas nenhuma lista de papéis permitidos o inclui, então `viewer` é recusado em todas as callables.

| Operação | owner | admin | member | viewer | Evidência |
| --- | --- | --- | --- | --- | --- |
| Criar workspace | qualquer usuário autenticado | | | | `firestore.rules:991-994` |
| Ler workspace | sim | sim | sim | sim | `firestore.rules:995` |
| Editar configurações do workspace | sim | sim | não | não | `firestore.rules:1004-1008` |
| Ler lista de membros | sim | sim | sim | sim | `firestore.rules:1011-1014` |
| Criar/alterar membership | sim | sim, exceto conceder/alterar `owner` | não | não | `firestore.rules:1021-1041` |
| Alterar o próprio papel | só o `ownerId` | não | não | não | `firestore.rules:1032-1034` |
| Remover membership | sim; documento do owner só pelo `ownerId` | sim, exceto owner | não | não | `firestore.rules:1046-1050` |
| Ler `transactions` | sim | sim | sim | sim | `firestore.rules:1054` |
| Criar `transactions` | sim | sim | sim | não | `firestore.rules:1056-1069` |
| Editar/anular `transactions` | todas | todas | só as próprias | não | `firestore.rules:265-273,1074-1087` |
| Escrever (inclusive apagar) `loans`, `loan_movements`, `clients`, `receivables`, `split_*`, `recurring_*` | sim | sim | sim | não | `firestore.rules:443-446,1097-1105,1351-1369,1384-1402` |
| Cadastro `credit_cards` (inclusive apagar) | sim | sim | não | não | `firestore.rules:966-976,1118` |
| Compra no cartão: criar/editar | sim | sim | sim | não | `functions/src/creditCards/writeStrategy.ts:56,80` |
| Cancelar compra; pagar/estornar/reabrir fatura; migração | sim | sim | não | não | `functions/src/creditCards/writeStrategy.ts:110,156,176,208,283` |
| Fechar fatura; recalcular limite; rebuild de faturas | sim | sim | não | não | `functions/src/creditCards/writeStrategy.ts:140,240,256` (mais `system`) |
| Ler auditoria e métricas de cartão; auditoria de metas | sim | sim | não | não | `firestore.rules:1156-1164,1181-1184` |
| Metas: criar, editar, arquivar | sim | sim | sim | não | `functions/src/goals/callables.ts:76-79` |
| Seed do catálogo; escrita em `settings_catalog` | sim | sim | não | não | `functions/src/goals/callables.ts:80`; `firestore.rules:275-277,382-392` |
| Investimentos: leitura | sim | sim | sim | não | `firestore.rules:452-455` |
| Investimentos: leitura sensível | sim | sim | não | não | `firestore.rules:457-460` |
| Investimentos: onboarding | sim | não | não | não | `functions/src/investments/writeStrategy.ts:59,67` |
| Investimentos: aportes, resgates, liquidações, cancelamento, vínculo com meta | sim | sim | sim | não | `functions/src/investments/writeStrategy.ts:57,129-323,403-449` |
| Investimentos: contas/ativos, estorno, valoração, recálculo, rebuild, backfill, importação, arquivamento | sim | sim | não | não | `functions/src/investments/writeStrategy.ts:58,89,109,349,375,472-609` |
| Rebuild de caixa | sim | sim | não | não | `functions/src/cash/rebuild.ts:252-255` |
| IA (análise e extração) | sim | sim | sim | não | `functions/src/ai/callables.ts:129-133,206-210` |
| Convite de grupo de divisão | sim | sim | sim, se `papel == 'dono'` no grupo (forjável) | não | `functions/src/callables/splitGroups.ts:109-137`; PR-SPLIT-04 (P4) |
| Notificações: marcar como lida | sim | sim | sim | sim | `firestore.rules:1376-1379` |
| Notificações: apagar | sim | sim | não | não | `firestore.rules:1381` |
| Subcoleções sem regra própria (ex.: `activity_logs`, `split_invites`) | leitura | leitura | leitura | leitura | `firestore.rules:1436-1442`; PR-RULES-02 (P6) |
| Checkout de assinatura | qualquer usuário autenticado, sem workspace | | | | `functions/src/callables/billing.ts:96-98,125-126` |

Achados que a matriz evidencia: um admin cria membership com papel `admin` para qualquer UID e rebaixa ou remove outros admins (WS-13); a UI rotula `member` como "Membro (Editor)" e convida como `viewer` por padrão (`src/components/MembersManagerModal.tsx:23-28,61`).

### 7.2 TARGET: ciclo de vida de workspace e membership

Papéis alvo (D-02, tomada): owner, admin, member e viewer; `viewer` é estritamente somente leitura. As operações financeiras seguem as matrizes declarativas de cada domínio (`writeStrategy.ts` e equivalentes), que P1 não altera (`viewer` continua recusado onde hoje é recusado) e que são revisadas em P3–P5 conforme [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md). O escopo do plano, e portanto quem contrata, depende de D-01, pendente e restrita a P2 ([BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md)).

Matriz de gestão (D-04, tomada): ninguém altera o próprio papel; saída voluntária só por `leaveWorkspace`, e o owner transfere a ownership antes.

| Operação (callable) | owner | admin | member | viewer | Observação |
| --- | --- | --- | --- | --- | --- |
| Ler dados e membros do workspace | sim | sim | sim | sim | `viewer` só lê |
| `updateWorkspaceSettings` | sim | sim | não | não | |
| `archiveWorkspace` | sim | não | não | não | `auth_time` nos últimos 10 minutos (D-06) |
| `transferWorkspaceOwnership` | sim | não | não | não | Destino: membro ativo; exatamente um owner canônico (D-03); `auth_time` nos últimos 10 minutos (D-06) |
| `inviteWorkspaceMember` com papel `member` ou `viewer` | sim | sim | não | não | P2 adiciona a quota de membros nesta transação (D-01, PR-ENT-01) |
| `inviteWorkspaceMember` com papel `admin` | sim | não | não | não | D-04 |
| `revokeWorkspaceInvite` | sim | sim, nos convites que poderia criar (`member`/`viewer`) | não | não | D-04 |
| `acceptWorkspaceInvite` | quem foi convidado, autenticado, com e-mail verificado igual ao do convite | | | | §8 |
| `changeWorkspaceMemberRole` entre `member` e `viewer` | sim | sim | não | não | Ninguém altera o próprio papel |
| `changeWorkspaceMemberRole` para ou de `admin` | sim | não | não | não | Admin não promove a admin nem rebaixa outro admin (D-04) |
| Conceder ou retirar `owner` | só por `transferWorkspaceOwnership` | não | não | não | D-03 |
| `removeWorkspaceMember` de `member` ou `viewer` | sim | sim | não | não | Remoção lógica |
| `removeWorkspaceMember` de `admin` | sim | não | não | não | D-04 |
| Remover, rebaixar ou alterar o owner canônico | não | não | não | não | Invariante; o owner não se remove, não sai nem se rebaixa enquanto owner (D-04) |
| `leaveWorkspace` | não; transfere antes | sim | sim | sim | |
| Ler eventos de membership | sim | sim | não | não | |

Invariantes alvo, verificados em teste: (1) existe sempre exatamente um owner canônico ativo (D-03), e `workspace.ownerId` o espelha sem ser fonte de autorização; (2) ninguém altera o próprio papel nem o próprio status, exceto pela saída voluntária; (3) o papel é relido na mesma transação que grava a mudança; (4) toda mudança grava o evento de auditoria na mesma transação; (5) o membership é criado com `uid = request.auth.uid` de quem aceita, nunca com identificador fornecido pelo cliente.

---

## 8. Convites

### 8.1 CURRENT

- O modal gera `fakeUid = newEmail.replace(/[^a-zA-Z0-9]/g, '')` e grava `members/{fakeUid}` com papel `viewer` (`src/components/MembersManagerModal.tsx:53-66`). As Rules aceitam qualquer `memberId` desde que `uid == memberId` (`firestore.rules:1021-1026`). O convidado real nunca ganha acesso, e um admin que conheça o UID de alguém o adiciona sem consentimento. **GAP:** PR-WS-01 (P1).
- Não existe coleção de convites, token, expiração, e-mail, aceite, revogação, transferência de ownership nem saída voluntária (WS-09).
- Os convites de grupo de divisão (`functions/src/callables/splitGroups.ts:100-273`) são de outro domínio: exigem que o usuário já seja membro do workspace e não servem para entrar num workspace. O desenho não deve ser copiado como está: o limite de tentativas e a marcação de expiração são revertidos pelo `throw` dentro da transação (ENTRY-14, em PR-SPLIT-04, P4).
- A tela de Configurações anuncia "Convide pessoas, gerencie permissões" (`src/components/SettingsView.tsx:673`), recurso que não funciona (PR-COMM-03, P9).

### 8.2 TARGET

Coleção `workspaces/{wid}/invites/{inviteId}` com `emailNormalized`, `role`, `tokenHash`, `status` (`pending`, `accepted`, `revoked`, `expired`), `expiresAt`, `createdBy`, `createdAt`, `acceptedBy`, `acceptedAt`, `revokedBy` e `revokedAt`. Rules: leitura por owner/admin, `write: false`. O convidado não lê convites pelas Rules.

1. **Emissão (`inviteWorkspaceMember`).** Owner/admin chama com `workspaceId`, `email`, `role` e `idempotencyKey`. Na transação: `authorizeInTransaction`, matriz da §7.2, verificação de que o e-mail normalizado não é membro ativo, rate limit por ator, geração de token opaco de 256 bits por CSPRNG em base64url (URL-safe), `expiresAt` em 7 dias, persistência apenas do SHA-256 do token (sem pepper) e evento de auditoria. P2 adiciona a quota nesta transação (D-01). O token não vai para log nem para outros membros. O convite pode existir antes de o destinatário ter conta; a emissão não cria membership (sem `fakeUid`).
2. **Entrega.** Link contendo o token (D-05, tomada). O envio real por e-mail transacional depende de E-11 e não é simulado em P1: sem envio mock nem mensagem de "e-mail enviado". No Emulator, o fluxo é testado por um seam exclusivo de teste, fora do bundle e dos exports de produção.
3. **Aceite (`acceptWorkspaceInvite`).** Exige autenticação, `email_verified` e e-mail do token igual a `emailNormalized`. Na transação: busca pelo SHA-256 do token; exige `pending` e não expirado; cria ou reativa `members/{auth.uid}` com o papel do convite; atualiza o índice do usuário; marca o convite `accepted` (uso único); grava auditoria. P2 adiciona a quota nesta transação (D-01). Token inválido, expirado, revogado ou de outro e-mail recebe a mesma resposta genérica em pt-BR, para não permitir enumeração. As tentativas consomem rate limit mesmo quando falham, com o contador gravado fora do caminho que lança erro.
4. **Revogação (`revokeWorkspaceInvite`).** Muda o status para `revoked`, com auditoria.
5. **Expiração.** Verificada no aceite, qualquer que seja o TTL; limpeza por TTL em `expiresAt` declarado em `firestore.indexes.json` (`fieldOverrides`).
6. **Reconvite de removido.** Novo convite; o aceite reativa o membership com o papel do convite.

---

## 9. Callables alvo de ciclo de vida

Todas passam pelo wrapper do kernel (D-ORD-02): autenticação, recusa de conta suspensa (D-P1-SUSP), política de `email_verified` e de `auth_time` (D-06, §2), Zod `.strict()` com IDs sem `/`, rate limit, idempotência, mapeador de erros em pt-BR, ponto de extensão para App Check, gravador de auditoria append-only e logger estruturado com correlation ID. Todas rodam em `southamerica-east1` com opções de runtime declaradas e cobertas pelo teste de contrato (`functions/src/shared/deploymentContract.test.ts`). Nenhuma consulta plano, quota ou entitlement em P1; P2 adiciona a quota dentro das transações de `createWorkspace`, `inviteWorkspaceMember` e `acceptWorkspaceInvite` antes de qualquer deploy remoto (D-01, D-ORD-04).

| Callable | Quem | Efeitos na mesma transação | Substitui (legado) | Milestone |
| --- | --- | --- | --- | --- |
| `bootstrapAccount` | usuário autenticado | perfil, workspace pessoal determinístico, membership owner, índice, provisionamento, auditoria | criação automática em `WorkspaceContext`; `ensureOwnerMembership` | P1 |
| `createWorkspace` | usuário autenticado com e-mail verificado | workspace, membership owner, índice, provisionamento, auditoria | `createWorkspace` do cliente e Rule de create | P1 (P2 adiciona a quota nesta transação, D-01) |
| `updateWorkspaceSettings` | owner, admin | campos mutáveis validados, auditoria | `updateWorkspace` do cliente e Rule de update | P1 |
| `inviteWorkspaceMember` | owner, admin (D-04) | convite com SHA-256 do token, auditoria | `fakeUid` e `addMember` | P1 (P2 adiciona a quota nesta transação, D-01) |
| `acceptWorkspaceInvite` | convidado verificado | membership, índice, convite `accepted`, auditoria | nenhum | P1 (P2 adiciona a quota nesta transação, D-01) |
| `revokeWorkspaceInvite` | owner, admin (D-04) | convite `revoked`, auditoria | nenhum | P1 |
| `changeWorkspaceMemberRole` | owner, admin (D-04) | membership, auditoria | `updateMemberRole` e `syncUserWorkspaceMembership` | P1 |
| `removeWorkspaceMember` | owner, admin (D-04) | `status: 'removed'`, índice, auditoria | `removeMember` (hard delete) | P1 |
| `leaveWorkspace` | admin, member, viewer; o owner transfere antes (D-04) | `status: 'removed'`, índice, auditoria | nenhum | P1 |
| `transferWorkspaceOwnership` | owner, com `auth_time` nos últimos 10 minutos | `ownerId`, papéis de origem e destino, auditoria | comentário em `firestore.rules:996-999` | P1 (D-03) |
| `archiveWorkspace` | owner, com `auth_time` nos últimos 10 minutos | `status: 'archived'`, auditoria | nenhum | P1 |
| `requestAccountDeletion`, `exportAccountData` | o próprio titular | §10.2 | nenhum | P8 |
| Suspensão de conta | operador de plataforma | §10.1 | nenhum | mecanismo em P1; superfície administrativa em P7 |

Eventos de membership vão para `workspaces/{wid}/membership_events` (nome proposto), gravados pelo gravador de auditoria do kernel com ator, alvo, ação, antes/depois, correlation ID e `serverTimestamp`. Rules: leitura por owner/admin, `write: false`. A trilha unificada e sua retenção estão em [OBSERVABILITY.md](OBSERVABILITY.md) e [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md).

---

## 10. Suspensão, revogação e exclusão de conta

### 10.1 Suspensão e revogação

- **CURRENT:** não há `revokeRefreshTokens`, `disabled` nem status de conta em `functions/src` (AUTH-09). Uma conta desativada pelo console mantém o ID token vigente por até cerca de uma hora em Rules e callables.
- **TARGET (D-P1-SUSP, tomada):** `users/{uid}.status` server-owned (`active` | `suspended`). O mecanismo interno via Admin SDK grava `status: 'suspended'`, faz `updateUser({disabled: true})` e `revokeRefreshTokens` e prepara o registro de auditoria para P7. O wrapper recusa conta suspensa em toda callable e ID token emitido antes de `tokensValidAfterTime`. As Rules continuam aceitando o ID token vigente até expirar; D-P1-SUSP define a recusa no backend e não inclui consulta ao status da conta nas Rules. Pelo plano (D-ORD-03), o mecanismo entra em P1. A operação por um administrador de plataforma entra em P7, em PR-ADMIN-01 (P7), que consolida AUTH-09.

### 10.2 Exclusão e exportação de conta (P8)

- **CURRENT:** nenhuma callable, gatilho ou tela (`functions/src/index.ts:13-37`); `users` com delete negado (`firestore.rules:1467`); nenhum delete em `workspaces` (`firestore.rules:990-1009`); a assinatura Stripe fica ligada a `users/{uid}` (`functions/src/webhooks/stripe.ts:97-107`). Apagar o usuário no console deixa perfil, workspaces, memberships e assinatura órfãos. **GAP:** PR-AUTH-01 (P8).
- **TARGET:** `requestAccountDeletion` exige `auth_time` recente e bloqueia enquanto o titular for owner canônico de workspace compartilhado sem transferência. Depois: cancela a assinatura no Stripe (E-06); arquiva os workspaces pessoais; anonimiza os dados pessoais em `users` e `members` e o ator no histórico compartilhado; retém o histórico financeiro pelo prazo legal, sem hard delete; revoga tokens; apaga o usuário do Auth por último; grava auditoria. `exportAccountData` gera a exportação do titular. Pelo plano (D-ORD-03), isso fica em P8, porque depende do modelo final dos domínios (P3–P5) e das callables de transferência, saída e arquivamento de P1. Destino de workspaces, retenção fiscal e anonimização são **DECISION D-07** e D-18. Detalhes em [PRIVACY_LGPD.md](PRIVACY_LGPD.md) e [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md).

---

## 11. Administração de plataforma

- **CURRENT:** o cliente lê `isAdmin` de `users/{uid}` por `getDoc` (`src/contexts/AuthContext.tsx:54-61`). O campo não é autoconcedível (`firestore.rules:148-157`; `tests/firestore/m4-hardening.rules.integration.test.mjs:768-850`). A view `admin` é liberada só no cliente (`src/App.tsx:641`), e o painel é placeholder com valores fixos (`src/components/AdminDashboard.tsx:39,51,63`). Não há custom claim nem callable administrativa.
- **TARGET:** custom claim `platformAdmin` concedido por script Admin SDK auditado, com MFA do operador (E-03, E-04); fora do RBAC de workspace, sem dar acesso a dados de tenant pelas Rules; callables administrativas de menor privilégio com trilha imutável. Implementar ou remover o painel é **DECISION D-10**. **GAP:** PR-ADMIN-01 (P7). Controles em [SECURITY_MODEL.md](SECURITY_MODEL.md).

---

## 12. GAPs

| ID | Sev. | Milestone | Lacuna | Fecha quando |
| --- | --- | --- | --- | --- |
| PR-AUTH-01 | BLOCKER | P8 | Sem exclusão de conta, exportação nem cancelamento da assinatura na saída | §10.2 implementado e testado |
| PR-AUTH-02 | BLOCKER | P9 | Cadastro sem termos, política e aceite server-side versionado | Aceite exigido no cadastro, lido do registro de P8 |
| PR-AUTH-03 | HIGH | P1 | Bootstrap e perfil no cliente, não atômicos nem idempotentes | `bootstrapAccount` (§4.2) |
| PR-AUTH-04 | HIGH | P6 | Login E2E no código de produção e artefato compartilhado | Login de teste fora do bundle; build por ambiente |
| PR-WS-01 | BLOCKER | P1 | Convite inexistente (UID fictício) | §8.2 |
| PR-WS-02 | HIGH | P1 | Mutações de membership no cliente, com escrita parcial e sem auditoria | Callables da §9; Rules `write: false` |
| PR-WS-03 | HIGH | P1 | Fontes concorrentes de papel | §6.3 e §6.4 |
| PR-WS-04 | HIGH | P1 | `ownerId` trancável via `status` | Invariantes da §7.2; teste de trancamento |
| PR-WS-05 | HIGH | P1 | Criação de workspace sem validar `type`, sem quota e com falhas de payload | `createWorkspace`/`updateWorkspaceSettings`; a parte de quota fecha com PR-ENT-01 (P2) |
| PR-WS-06 | HIGH | P1 | Sem testes de membership/workspace | §13 |

Relacionados de outros domínios: PR-ENT-01 (P2, quotas de workspaces e membros; fecha ao fim de P5 por D-ORD-05), PR-ADMIN-01 (P7), PR-AI-04 (P5, histórico de IA e limpeza no logout), PR-APPCHK-01 (P6), PR-SPLIT-04 (P4), PR-COMM-03 (P9).

MEDIUM/LOW de origem tratados neste domínio:

| ID | Lacuna | Tratamento alvo |
| --- | --- | --- |
| AUTH-08 | Qualquer token aceito: sem `email_verified`, restrição de provedor ou blocking function | Política no wrapper; blocking functions (D-06) |
| AUTH-10 | Falhas de login e de carga de workspaces silenciosas | Mapeamento pt-BR; estado de erro |
| AUTH-15 | Textos fora de pt-BR (painel admin em pt-PT, `lang="en"`), marca inconsistente | Revisão com `ptbr-product-ui-review` |
| AUTH-17 | Sem política de sessão, reautenticação ou MFA | D-06 |
| WS-09 | Sem transferência de ownership, saída ou arquivamento | Callables da §9 |
| WS-12 | Listagem com escrita a cada leitura, N+1 e sem `limit` | Índice do usuário paginado (§6.4) |
| WS-13 | Poderes amplos do admin sobre outros admins | D-04; testes negativos |
| WS-14 | `Owner` e e-mail placeholder visíveis; erros silenciosos | Dados do token no backend; `onError` em pt-BR |
| WS-15, ENTRY-11 | `workspaceId` com `/` aceito pelo resolvedor e por 18 callables | Schema único de ID no resolvedor |
| ENTRY-20 | Cartões e metas verificam o papel fora da transação | `authorizeInTransaction` |
| ENTRY-23 | Nenhum entrypoint exige e-mail verificado | Política no wrapper |
| RULES-11 | `members` listável sem `limit` | `list` com teto nas Rules |
| RULES-16 | `members.status` aceita qualquer string | Enum fechado gravado só pelo backend |

---

## 13. Testes

### 13.1 CURRENT

- Anti-escalada: admin não se promove, não concede `owner`, não rebaixa nem apaga o owner; member não altera o próprio papel nem forja `uid` (`tests/firestore/m4-hardening.rules.integration.test.mjs:257-356`).
- Allowlist rejeita campos arbitrários em workspace e membro (`tests/firestore/m4-hardening.rules.integration.test.mjs:857-902`).
- O cliente não se concede plano nem `isAdmin` (`tests/firestore/m4-hardening.rules.integration.test.mjs:768-850`).
- Isolamento de transações e metas entre tenants (`tests/firestore/m4-hardening.rules.integration.test.mjs:246`).
- Matriz de papéis de cartões no backend, pulada sem `FIRESTORE_EMULATOR_HOST` (`functions/src/creditCards/__tests__/rbac.integration.test.ts:154`); membro `removed` recusado em investimentos (`functions/src/investments/__tests__/domainV2.integration.test.ts:871-927`).
- **Legado a substituir:** `tests/firestore/m4-hardening.rules.integration.test.mjs:548-560` consagra a gestão de membros pelo cliente com hard delete.
- E2E cobre só o login de teste (`e2e/authenticated-smoke.spec.ts:3-13`). Não há teste de `src/modules/workspaces`, `WorkspaceContext`, `MembersManagerModal`, espelho, criação de workspace, convites nem bootstrap (PR-WS-06, P1).

### 13.2 TARGET: exigidos para fechar P1

1. Suítes de Rules no Emulator com tenants A e B, cobrindo owner, admin, member, `viewer` (somente leitura, D-02), removido, não membro e não autenticado: negação de escrita do cliente em `members`, `invites`, `membership_events`, índice do usuário e create/update de `workspaces`; leitura cross-tenant negada nos dois sentidos.
2. Integração das callables da §9: matriz permitida e negada (D-04); `workspaceId` com `/` rejeitado; papel forjado no payload ignorado; `email_verified` e `auth_time` conforme D-06; conta suspensa recusada.
3. `bootstrapAccount`: replay idempotente; duas chamadas concorrentes produzem um único workspace pessoal; falha no meio não deixa estado parcial.
4. Convites: reuso de token, token expirado, revogado, e-mail divergente, e-mail não verificado, aceite duplo concorrente, rate limit consumido em tentativa inválida, resposta genérica idêntica nos casos de falha, só o SHA-256 persistido e token ausente dos logs. Quota no limite é teste de P2 (D-01).
5. Invariantes: o owner não sai, não é removido nem é rebaixado; admin não cria, promove, rebaixa nem remove admin; cenário de trancamento de PR-WS-04 negado; duas trocas de papel concorrentes; membro removido durante a chamada é recusado.
6. Toda mutação grava exatamente um evento de auditoria na mesma transação. O teste verifica o estado final e a auditoria, não só o código de resposta.
7. E2E com duas contas no Emulator: convite, aceite, troca de papel, remoção e perda de acesso; logout seguido de login com outro usuário sem dados residuais.
8. As suítes de integração falham, em vez de pular, quando o CI roda sem Emulator (FIRE-13).

---

## 14. Legado a remover em P1

Conforme a política de legado e §7 do [plano mestre](PRODUCTION_READINESS_PLAN.md#7-legado-a-remover), a remoção é provada por busca no código, por Rules que negam o caminho antigo e por testes.

| Legado | Evidência | Substituto |
| --- | --- | --- |
| Convite com `fakeUid`; `addMember`, `removeMember`, `updateMemberRole`, `syncUserWorkspaceMembership` | `src/components/MembersManagerModal.tsx:53-66`; `src/modules/workspaces/api.ts:19-33,236-264` | Callables da §9 |
| `ensureOwnerMembership`, query por `ownerId`, fallback `collectionGroup('members')` | `src/modules/workspaces/api.ts:35-59,86-139` | Índice mantido pelo backend |
| Espelho gravável pelo cliente com `role` usado como `myRole` | `firestore.rules:1478-1487`; `src/modules/workspaces/api.ts:150-155` | Índice `write: false`; papel lido do membership |
| `isWorkspaceOwnerByParent` e fallback `ownerId` no backend; resolvedores duplicados | `firestore.rules:27-34`; `functions/src/creditCards/auth.ts:54-125`; `functions/src/investments/infrastructure.ts:158-212` | Resolvedor único do kernel |
| Create de workspace e escrita de `members` pelo cliente nas Rules; delete físico de membership | `firestore.rules:991-994,1021-1050` | `write: false` |
| `userId` legado; tipos `Workspace` duplicados; placeholders `Owner` e `usuario-sem-email@sistema` | `firestore.rules:110`; `src/types.ts:21-43`; `src/modules/workspaces/api.ts:44,205`; `src/contexts/WorkspaceContext.tsx:58` | Tipo único; dados do token |
| Seed de catálogo e onboarding disparados pelo cliente; criação automática com lista vazia | `src/contexts/WorkspaceContext.tsx:50-62,107-121`; `src/modules/workspaces/hooks.ts:22` | `bootstrapAccount`/`createWorkspace` |
| Contorno `useAuthoritativeRole` | `src/modules/investments/components/InvestmentOperationsPanel.tsx:62-90` | Papel único exposto pelo `WorkspaceContext` |
| Teste que consagra a gestão de membros pelo cliente | `tests/firestore/m4-hardening.rules.integration.test.mjs:548-560` | Testes das callables e negação nas Rules |

---

## 15. Decisões e configuração externa

| ID | Classificação | Tema | Efeito neste documento |
| --- | --- | --- | --- |
| D-01 | DECISION (pendente; bloqueia só P2) | Plano por usuário ou por workspace | Quem contrata; se convites pendentes contam na quota de membros. P1 não aplica quota; P2 a adiciona nas transações de `createWorkspace`, `inviteWorkspaceMember` e `acceptWorkspaceInvite` |
| D-02 | DECISION (tomada, §9.1 do plano) | `viewer` mantido, somente leitura | Coluna `viewer` da §7.2 e enum de papel |
| D-03 | DECISION (tomada, §9.1 do plano) | Exatamente um owner canônico ativo; `ownerId` só desnormalizado | `transferWorkspaceOwnership`, §6.3 e invariantes |
| D-04 | DECISION (tomada, §9.1 do plano) | Poderes de owner e admin na gestão de membros | Matriz da §7.2 |
| D-05 | DECISION (tomada, §9.1 do plano) | Convite por link: token de 256 bits, 7 dias, uso único, SHA-256 sem pepper; envio real depende de E-11 | §8.2 |
| D-06 | DECISION (tomada, §9.1 do plano) | Só Google; `email_verified` e `auth_time` por callable; sem MFA para usuários comuns | §2 e §9 |
| D-P1-SUSP | DECISION (tomada, §9.1 do plano) | Suspensão server-owned com revogação de sessão | §10.1 |
| D-07 | DECISION | Exclusão de conta: destino de workspaces, retenção × eliminação, anonimização | §10.2 |
| D-10 | DECISION | Painel administrativo | §11 |
| D-16 | DECISION (tomada, §9.1 do plano) | Somente BRL | §5 |
| D-22 | DECISION (tomada, §9.1 do plano) | PF e PJ com membros; CNPJ opcional, validado e não único | §5 |

| ID | Classificação | Item deste domínio | Estado |
| --- | --- | --- | --- |
| E-03 | EXTERNAL CONFIGURATION REQUIRED | Só Google habilitado por ambiente (D-06; e-mail/senha e anônimo desabilitados); domínios autorizados sem `localhost` em PROD; proteção contra enumeração de e-mail; templates pt-BR; tela de consentimento OAuth; Identity Platform se houver blocking functions ou MFA; MFA para administradores | NÃO VERIFICADO |
| E-11 | EXTERNAL CONFIGURATION REQUIRED | E-mail transacional para convites, com SPF/DKIM/DMARC no domínio do produto | NÃO VERIFICADO |
| E-02 | EXTERNAL CONFIGURATION REQUIRED | App Check com enforcement nas callables de membership | NÃO VERIFICADO |
| E-04 | EXTERNAL CONFIGURATION REQUIRED | MFA dos operadores humanos que concedem `platformAdmin` | NÃO VERIFICADO |
| E-09 | EXTERNAL CONFIGURATION REQUIRED | Termos e política cobrindo o compartilhamento de dados financeiros com membros convidados e o papel de controlador em workspaces PJ | NÃO VERIFICADO |

O registro de evidência desses itens (valor esperado, data, responsável) fica em [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md) e [PRIVACY_LGPD.md](PRIVACY_LGPD.md), conforme §11 do [plano mestre](PRODUCTION_READINESS_PLAN.md#11-configuração-externa-necessária-external-configuration-required).
