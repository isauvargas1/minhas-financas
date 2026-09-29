# Autenticação, RBAC e workspaces

Referência do programa de Production Readiness para autenticação, sessão, ciclo de vida de conta, workspaces PF/PJ, memberships, RBAC, convites e administração de plataforma. Baseline auditada: HEAD `9c3ab46`; atualizado após a implementação de P1 (código no repositório e testado no Emulator; nada foi implantado, D-ORD-04). O estado, a ordem e os IDs canônicos estão no plano mestre, [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md) (§5.1, §5.2, §6 e P1 em §8). O gate do tema é a skill `multi-tenant-security-review`, acompanhada em P1 de `firestore-scale-cost-review`, `ptbr-product-ui-review` e `observability-incident-readiness` (contrato de auditoria), conforme o plano. A exclusão de conta (P8) passa também por `privacy-lgpd-data-lifecycle`.

Rótulos conforme a tabela de classificação do plano: **CURRENT** (existe no HEAD, com `arquivo:linha`), **TARGET** (alvo, não implementado), **GAP** (ID do registro), **DECISION** (§9/§10 do plano) e **EXTERNAL CONFIGURATION REQUIRED** (fora do repositório, estado NÃO VERIFICADO). **Fechado em P1 (PLAN §16.4)** marca um GAP fechado no repositório, sem implantação remota. Controles transversais (App Check, Hosting, segredos, IA) ficam em [SECURITY_MODEL.md](SECURITY_MODEL.md); ameaças em [THREAT_MODEL.md](THREAT_MODEL.md); quotas em [BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md); exclusão e exportação em [PRIVACY_LGPD.md](PRIVACY_LGPD.md).

---

## 1. Resumo

| Tema | Classificação | Situação | Evidência / ID |
| --- | --- | --- | --- |
| Login | CURRENT | Só Google por `signInWithPopup`, com falhas de login em pt-BR (AUTH-10); login e-mail/senha de E2E com credenciais fixas ativado por flag de build (PR-AUTH-04, P6) | `src/contexts/AuthContext.tsx:102-110`, `:35,113-133,150`; `src/components/auth/LoginView.tsx:8-26,30-37` |
| Perfil `users/{uid}` | CURRENT | Perfil mínimo criado e mantido só pelo backend (`bootstrapAccount`): `uid`, `email`, `displayName`, `photoURL`, `status`, `createdAt`, `updatedAt`. O webhook Stripe ainda acrescenta os campos de plano (P2). As Rules negam toda escrita do cliente | `functions/src/workspaces/model.ts:17-20`; `functions/src/workspaces/lifecycle.ts:152-168`; `firestore.rules:1377-1381`; `functions/src/webhooks/stripe.ts:97-107` |
| Bootstrap | CURRENT | `bootstrapAccount` cria, numa única transação, perfil, workspace pessoal PF já provisionado, membership owner, índice do usuário e auditoria; repetir é leitura pura. O cliente só chama a callable e lê: falha de carga vira estado de erro, nunca criação | `functions/src/workspaces/lifecycle.ts:106-215`; `src/contexts/WorkspaceContext.tsx:105`; `src/App.tsx:544-551` |
| Membership | CURRENT | Criar workspace, convidar, aceitar, revogar, trocar papel, remover, sair, transferir e arquivar são 11 callables do kernel, transacionais e auditadas em `membership_events`. O cliente não escreve em `workspaces`, `members`, `invites` nem no índice do usuário | `functions/src/workspaces/callables.ts:68-232`; `functions/src/workspaces/memberships.ts:104-604`; `firestore.rules:936-976,1398-1402` |
| Convite | CURRENT | `workspaces/{wid}/invites` vinculado ao e-mail normalizado, com papel e expiração de 7 dias; token de 256 bits do qual só o SHA-256 é persistido (`invite_tokens`); aceite pelo `uid` da sessão, com e-mail verificado. O envio ao convidado depende de E-11 e não é simulado: o token em claro é descartado no backend | `functions/src/workspaces/memberships.ts:104,231`; `functions/src/workspaces/inviteTokens.ts:13-15`; `functions/src/workspaces/callables.ts:116-133` |
| Anti-escalada | CURRENT | As Rules negam toda escrita em `members`; a matriz D-04 (ninguém altera o próprio papel, admin não gere admin, `owner` só muda por transferência) é aplicada no backend e coberta por testes de matriz e de Rules | `functions/src/workspaces/rbac.ts:20-50`; `firestore.rules:951-958`; `functions/src/workspaces/__tests__/memberships.integration.test.ts:61,98`; `tests/firestore/m4-hardening.rules.integration.test.mjs:609` |
| Autoridade de papel | CURRENT | `workspaces/{id}/members/{uid}` com `status: 'active'` é a única fonte de papel, nas Rules e no backend. `ownerId` é só desnormalizado e nunca autoriza; o resolvedor é único e relido na transação; conta `suspended` não autoriza | `functions/src/shared/workspaceAuth.ts:121-214`; `firestore.rules:28-64` |
| Isolamento entre tenants | CURRENT | Por caminho, com negativos A↔B nos dois sentidos nas Rules e nas callables; o resolvedor recusa membership ausente com a mesma resposta de um workspace inexistente | `tests/firestore/workspaces-p1.rules.integration.test.mjs:173,192,339`; `functions/src/shared/__tests__/workspaceAuth.integration.test.ts:65`; `functions/src/workspaces/__tests__/memberships.integration.test.ts:240` |
| Pendências fora de P1 | TARGET | Quota e entitlement nas transações de criação, convite e aceite (P2); App Check e login de teste fora do bundle (P6); operação administrativa da suspensão e claim `platformAdmin` (P7); exclusão e exportação de conta (P8); aceite legal (P8/P9); envio do convite por e-mail transacional (E-11) | [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md#p1--auth-workspaces-rbac-e-ciclo-de-vida-de-conta) |

GAPs abertos do domínio: PR-AUTH-01, PR-AUTH-02 e PR-AUTH-04. Fechados em P1 (PLAN §16.4): PR-AUTH-03 e PR-WS-01 a PR-WS-06 (§12).

---

## 2. Autenticação e sessão

| Aspecto | Classificação | Descrição | Evidência / ID |
| --- | --- | --- | --- |
| Provedor | CURRENT | Google via popup; o erro é relançado e a tela o traduz para pt-BR (popup bloqueado, falha de rede, conta desativada; fechar a janela não gera mensagem) | `src/contexts/AuthContext.tsx:102-110`; `src/components/auth/LoginView.tsx:8-26,30-37` |
| Login de teste | CURRENT | `signInForE2E` com e-mail e senha fixos no código e auto-cadastro em `invalid-credential`, exposto quando `VITE_E2E_MODE === 'true'` | `src/contexts/AuthContext.tsx:35,113-133,150` |
| Conexão ao Emulator | CURRENT | Ligada por `VITE_USE_FIREBASE_EMULATORS`, sem garantir que modo E2E implique Emulator | `src/lib/firebase.ts:47-62` |
| Sessão | CURRENT | `onAuthStateChanged`; persistência padrão; sem `setPersistence` nem MFA. A reautenticação existe só onde o backend exige login recente: `withRecentLogin` reautentica com o Google e repete a chamada uma vez (transferência de titularidade) | `src/contexts/AuthContext.tsx:64-99`; `src/modules/workspaces/errors.ts:46-59`; `src/components/MembersManagerModal.tsx:96`; AUTH-17 |
| Gating | CURRENT | `AuthGuard` mostra `LoginView` sem usuário; `WorkspaceProvider` fica fora do guard | `src/App.tsx:694-699,701-714` |
| Verificação de e-mail | CURRENT | Política no wrapper do kernel, por callable (D-06): `assertTokenPolicy` exige provedor da allowlist, `email_verified` e `auth_time` conforme a operação. As Rules não exigem e-mail verificado (só `request.auth` e conta ativa). O checkout envia `caller.email` ao Stripe sem exigir `email_verified` (P2) | `functions/src/shared/callable.ts:59-64,185-215`; `functions/src/workspaces/callables.ts:55-59`; `functions/src/callables/billing.ts:151` |
| Blocking functions e gatilhos de Auth | CURRENT | Inexistentes; a suspensão usa o Admin SDK (`disabled` e `revokeRefreshTokens`), sem gatilho de Auth | `functions/src/index.ts:14-41`; `functions/src/workspaces/suspension.ts:76-77` |
| Logout | CURRENT | `signOut` com erro registrado e, no `finally`, limpeza do cache do React Query e das chaves locais por usuário/workspace (`lastWorkspaceId_*`, histórico do chat de IA, conversas locais). A mesma limpeza roda na troca de conta sem logout. A preferência de tema fica (é do dispositivo) | `src/contexts/AuthContext.tsx:57-68,135-143`; `src/lib/sessionCleanup.ts:18-40`; `tests/unit/session-cleanup.test.ts` |
| Mensagens de falha | CURRENT | Falhas de login em pt-BR; falha ao carregar a conta ou os workspaces mostra estado de erro em pt-BR com saída da conta, e o app não renderiza sobre o pseudo-workspace `loading` (AUTH-10) | `src/components/auth/LoginView.tsx:8-26`; `src/contexts/WorkspaceContext.tsx:36-37,97-145`; `src/App.tsx:544-551` |
| Identidade | CURRENT | Identidade só do ID token verificado (`callerFromRequest`). O wrapper de callable do kernel (D-ORD-02) aplica por callable a política de `email_verified` e de `auth_time` e uma allowlist de `sign_in_provider`: `google.com`, mais `password` apenas quando `FUNCTIONS_EMULATOR=true` (E2E no Emulator) | `functions/src/shared/callable.ts:59-64,160-215`; `functions/src/shared/__tests__/kernel.test.ts:497,548,584,606,634` |
| Provedores por ambiente | TARGET | Só Google; sem e-mail/senha, sem Apple e sem redesign do login. A allowlist do backend (linha "Identidade") já recusa outros provedores; falta habilitar só Google por ambiente e as blocking functions `beforeUserCreated`/`beforeUserSignedIn` (requer Identity Platform). O login não exige e-mail verificado; a exigência fica nas callables da §9 | D-06; E-03 |
| Política de sessão | CURRENT | `auth_time` nos últimos 10 minutos em `transferWorkspaceOwnership` e `archiveWorkspace` (erro `recent_login_required`, com `reason` para o cliente); o frontend reautentica com Google só quando necessário (`withRecentLogin`, ligado à transferência; `archiveWorkspace` não tem tela). Sem MFA para usuários comuns; MFA de admin de plataforma em P7 | `functions/src/shared/callable.ts:66-67,203-214`; `functions/src/workspaces/callables.ts:56-59,99-114,215-232`; `src/modules/workspaces/errors.ts:46-59`; D-06; E-03 |
| Login de teste | TARGET | Fora do bundle de produção: módulo exclusivo de teste ou custom token do Emulator; build falha se E2E ou Emulator estiverem ligados fora do modo de teste | PR-AUTH-04 (P6) |
| Logout | TARGET | O histórico do chat de IA sai do `localStorage` e passa a viver no servidor (hoje só é apagado no logout e na troca de conta) | PR-AI-04 (P5) |
| Erros | TARGET | Alternativa por redirect quando o popup é bloqueado (hoje a tela orienta permitir pop-ups); textos fora de pt-BR no painel administrativo | AUTH-15 |
| GAP | GAP | Login E2E no código de produção | PR-AUTH-04 (P6) |
| GAP | GAP | **Fechado em P1 (PLAN §16.4).** Sem `email_verified` nem restrição de provedor | AUTH-08, ENTRY-23: `functions/src/shared/callable.ts:185-215`; `functions/src/shared/__tests__/kernel.test.ts:584-634` |
| GAP | GAP | Sessão: a política de `auth_time` e a reautenticação para operações irreversíveis foram fechadas em P1 (PLAN §16.4); persistência de sessão e MFA de admin seguem abertas | AUTH-17 (LOW; P7) |

**DECISION D-06 (tomada, §9.1 do plano):** só Google. `email_verified` exigido em `createWorkspace`, `inviteWorkspaceMember`, `acceptWorkspaceInvite`, `revokeWorkspaceInvite`, `changeWorkspaceMemberRole`, `removeWorkspaceMember`, `transferWorkspaceOwnership` e `archiveWorkspace`; não exigido em `bootstrapAccount`, `updateWorkspaceSettings` e `leaveWorkspace`. `transferWorkspaceOwnership` e `archiveWorkspace` exigem `auth_time` nos últimos 10 minutos. Sem MFA para usuários comuns; MFA administrativa em P7 (E-03). Implementado nas políticas `VERIFIED` e `VERIFIED_RECENT` de `functions/src/workspaces/callables.ts:55-232` e coberto pelos testes de integração de `functions/src/workspaces/__tests__/`.

---

## 3. Conta e perfil `users/{uid}`

| Aspecto | Classificação | Descrição | Evidência / ID |
| --- | --- | --- | --- |
| Criação | CURRENT | `bootstrapAccount` cria `users/{uid}` na primeira chamada, com `email`, `displayName` e `photoURL` copiados do token verificado e `status: 'active'`; nas chamadas seguintes só sincroniza a identidade se mudou. Um perfil sem `status` criado antes pelo webhook Stripe é inicializado. O webhook faz `set(..., {merge: true})` com `planId`, `isPro`, `stripe*` e `subscriptionStatus` | `functions/src/workspaces/lifecycle.ts:110-168`; `functions/src/webhooks/stripe.ts:97-107`; `functions/src/workspaces/__tests__/account.integration.test.ts:55,200` |
| Rules de perfil | CURRENT | Leitura só do próprio usuário (inclusive suspenso, para a interface descobrir o status); create, update e delete negados ao cliente | `firestore.rules:1377-1381`; `tests/firestore/workspaces-p1.rules.integration.test.mjs:244` |
| Campos server-owned | CURRENT | O documento inteiro é server-owned: `status`, `email`, `planId`, `isPro`, `isAdmin`, `stripeCustomerId` e status de assinatura não são graváveis pelo cliente, com teste | `firestore.rules:1377-1381`; `tests/firestore/m4-hardening.rules.integration.test.mjs:912,986,1001` |
| `rate_limits` do usuário | CURRENT | Leitura e escrita negadas ao cliente | `firestore.rules:1386-1388` |
| `idempotency_keys` do usuário | CURRENT | Chaves de idempotência das callables do kernel em `users/{uid}/idempotency_keys/{operação}_{hash}`, com `expiresAt` de 90 dias; leitura e escrita negadas ao cliente | `functions/src/shared/idempotency.ts:37-48`; `firestore.rules:1391-1393` |
| Leitura | CURRENT | O mesmo documento é lido duas vezes: `getDoc` para `isAdmin` e `onSnapshot` para o plano | `src/contexts/AuthContext.tsx:75-83`; `src/hooks/usePlan.ts:20` |
| Workspace ativo | CURRENT | `activeWorkspaceId` deixou de ser gravável (o perfil é server-owned) e não é usado; o app guarda o último workspace em `localStorage` por usuário (`lastWorkspaceId_<uid>`), apagado no logout, e o membership ativo decide o acesso na abertura | `src/contexts/WorkspaceContext.tsx:39,46-53,81,118-127`; `src/lib/sessionCleanup.ts:18-23` |
| Perfil server-owned | CURRENT | `bootstrapAccount` cria `users/{uid}` com o contrato mínimo `uid`, `email` (do token verificado), `displayName`, `photoURL`, `status` (`active`/`suspended`, D-P1-SUSP), `createdAt` e `updatedAt`. `locale` e `timezone` **não** fazem parte de P1 (o fuso canônico das datas civis é `America/Sao_Paulo`, D-17). O cliente não edita mais o perfil: `email` e `status` saíram da allowlist e a própria allowlist deixou de existir (`write: false`) | `functions/src/workspaces/model.ts:17-20`; `functions/src/workspaces/lifecycle.ts:152-168`; `firestore.rules:1377-1381` |
| Aceite legal | TARGET | O registro versionado de aceite (termos e política) é construído em P8 e exigido no cadastro em P9. `bootstrapAccount` é o ponto de integração | PR-AUTH-02 (P9) |
| Fonte única | TARGET | Um único provider de perfil no cliente (hoje o perfil é lido duas vezes: `getDoc` para `isAdmin` e `onSnapshot` para o plano). A fonte única de workspace ativo já vale: o `WorkspaceContext` | AUTH-12 (PR-AUTH-03 fechado em P1 (PLAN §16.4)) |
| GAP | GAP | **Fechado em P1 (PLAN §16.4).** Perfil sem dono server-side | PR-AUTH-03: `functions/src/workspaces/lifecycle.ts:106-215`; `tests/firestore/workspaces-p1.rules.integration.test.mjs:244` |

---

## 4. Bootstrap de conta e do primeiro workspace

### 4.1 Baseline removido em P1

Saíram do código, com busca sem ocorrências em `src/`, `functions/src/`, `firestore.rules`, `e2e/` e `tests/`: a listagem que engolia falhas e devolvia lista vazia, a criação automática do primeiro workspace no `WorkspaceProvider` (com e-mail placeholder), o `createWorkspace` do cliente com escritas separadas, `ensureOwnerMembership` e o seed do catálogo e o onboarding de investimentos disparados pelo cliente. **GAP PR-AUTH-03: Fechado em P1 (PLAN §16.4)** (§12).

### 4.2 CURRENT: `bootstrapAccount`

Callable chamada uma vez após o login (`functions/src/workspaces/callables.ts:68-74`, domínio em `functions/src/workspaces/lifecycle.ts:106-215`). O cliente só chama e lê o resultado; erro de leitura vira estado de erro, nunca criação (`src/contexts/WorkspaceContext.tsx:97-145`).

1. Wrapper do kernel: autenticação e provedor da allowlist, payload vazio estrito, sem exigir `email_verified` (D-06) e sem exigir perfil prévio (`requireActiveAccount: false`); a conta suspensa é recusada dentro da transação.
2. Numa transação: lê `users/{uid}`. Se a conta já existe e há ao menos um workspace ativo no índice, devolve `created: false` e só sincroniza `email`, `displayName` e `photoURL` se mudaram (replay = leitura pura).
3. Cria (ou inicializa, quando o webhook Stripe criou antes um perfil sem `status`) `users/{uid}` server-owned (§3).
4. Cria o workspace pessoal PF "Meu Espaço Pessoal", com `ownerId = uid` (desnormalizado, D-03), `status: 'active'` e moeda BRL. O ID vem do Firestore (`newWorkspaceRef()`), **não** é determinístico: a idempotência vem da disputa pelo documento `users/{uid}`, que toda chamada lê e todo caminho de criação escreve.
5. Cria `workspaces/{id}/members/{uid}` com `role: 'owner'`, `status: 'active'` e identidade copiada do token.
6. Cria a entrada do índice do usuário `users/{uid}/workspaces/{id}` (§6.4).
7. Provisiona catálogo e cadastros de investimentos na mesma transação (`provisionWorkspaceDefaults`, `functions/src/workspaces/provisioning.ts:155`): catálogo geral padrão (categorias de despesa, receita e investimento, formas de pagamento e carteiras; centros de custo só em PJ; `GENERAL_CATALOG_SEEDS`, `:59`) e padrões de investimento (`writeNewWorkspaceInvestmentDefaults`, `functions/src/investments/onboarding.ts:203`: catálogo de investimentos, conta e ativo padrão). Só `transaction.create`, sem leituras; uma falha aborta a criação, sem sucesso parcial. O cliente não provisiona mais nada: `seedLegacySettingsCatalog` (callable e wrapper) e as chamadas a `onboardInvestmentWorkspace` do `WorkspaceContext` e do `useCreateWorkspace` foram removidos. `onboardInvestmentWorkspace` segue como operação convergente do domínio de investimentos (`functions/src/investments/onboarding.ts:240`), sem papel no ciclo de vida do workspace.
8. Grava os eventos de auditoria `account.bootstrapped` (só na primeira inicialização) e `workspace.created` em `membership_events` (§9).

Testes: `functions/src/workspaces/__tests__/account.integration.test.ts` (criação completa, repetição, chamadas concorrentes, falha no meio sem estado parcial, conta sem workspace ativo, conta suspensa) e `functions/src/workspaces/__tests__/provisioning.integration.test.ts`. Não há rate limit nem chave de idempotência do cliente em `bootstrapAccount`.

Conta sem nenhum workspace ativo (saiu de todos ou arquivou o pessoal) recebe um novo espaço pessoal pelo mesmo caminho (`reason: 'personal_workspace_restored'`).

Pendente de **DECISION**: criar automaticamente o workspace PF ou deixar o usuário escolher PF/PJ no onboarding (levantado pela auditoria `auth-account`; ligado a D-22). P1 manteve a criação automática do PF e a interface inalterada; o PJ nasce depois, por `createWorkspace`.

---

## 5. Modelo de workspace (PF/PJ)

| Aspecto | Classificação | Descrição | Evidência / ID |
| --- | --- | --- | --- |
| Tipo | CURRENT | `Workspace` com `type` `PF`/`PJ`, `ownerId` só informativo, `cnpj`, `themeColor`, `alertPreferences` e `myRole` lido do membership ativo; o tipo duplicado e o campo legado `userId` foram removidos | `src/modules/workspaces/types.ts:21-37`; `src/types.ts:19` |
| Criação | CURRENT | Só pela callable `createWorkspace`; as Rules negam create, update e delete de `workspaces/{id}` ao cliente | `functions/src/workspaces/lifecycle.ts:222-290`; `firestore.rules:936-944` |
| Validação de `type` | CURRENT | O contrato Zod estrito aceita só `PF`/`PJ`; nenhum outro valor chega ao documento | `functions/src/workspaces/contracts.ts:34,61-67`; `functions/src/workspaces/__tests__/workspaceLifecycle.integration.test.ts:80` |
| Edição | CURRENT | Owner e admin, só por `updateWorkspaceSettings`, com allowlist estrita (`name`, `cnpj`, `themeColor`, `alertPreferences`); `ownerId`, `type`, `status` e moeda não são editáveis. Renomear atualiza o índice do ator na transação, e o gatilho `onWorkspaceDisplayChange` propaga aos demais membros, por página | `functions/src/workspaces/lifecycle.ts:303-386`; `functions/src/workspaces/contracts.ts:69-75`; `functions/src/workspaces/indexSync.ts:31,80` |
| Exclusão | CURRENT | Não há delete: `archiveWorkspace` grava `status: 'archived'` e o documento-pai permanece como marcador, o que impede recriar o mesmo ID sobre subcoleções órfãs (RULES-06). Workspace arquivado segue legível pelos membros ativos e não aceita escrita do cliente nas Rules. Exclusão de conta e de workspace ficam em P8 | `functions/src/workspaces/lifecycle.ts:394-437`; `firestore.rules:58-64,943-944`; `tests/firestore/m4-hardening.rules.integration.test.mjs:1395` |
| Payload | CURRENT | Zod `.strict()` em todas as callables; o cliente omite campos ausentes do payload (`compact`) e CNPJ vazio vira `null`; `ownerId`, `userId`, `id`, `status` e `currency` não são aceitos do cliente | `functions/src/workspaces/contracts.ts:52-125`; `src/modules/workspaces/callables.ts:42` |
| Quota | CURRENT | Limite de workspaces só na UI | `src/components/Header.tsx:58`; `src/constants/plans.ts:5-7` |
| `createWorkspace` | CURRENT | Callable com Zod estrito (`name`, `type` ∈ {PF, PJ}, `cnpj` conforme D-22, `themeColor`, `idempotencyKey`). Exige `email_verified` e conta ativa (D-06). Numa transação: reserva de idempotência por ator, workspace (`status: 'active'`, `ownerId` desnormalizado), `members/{uid}` owner ativo, índice do usuário, provisionamento (§4.2, item 7) e evento `workspace.created`. P1 não consulta quota nem entitlement; P2 adiciona a quota nesta transação (D-01) | `functions/src/workspaces/callables.ts:76-83`; `functions/src/workspaces/lifecycle.ts:222-290`; PR-WS-05 (fechado em P1, PLAN §16.4); quota em PR-ENT-01 (P2) |
| `updateWorkspaceSettings` | CURRENT | Callable com schema estrito dos campos mutáveis e papel owner/admin, relido na transação; sem alteração devolve `updated: false` e não audita. Com ela no ar, o cliente perdeu create/update de `workspaces/{id}` nas Rules (política de legado: sem caminho de escrita concorrente) | `functions/src/workspaces/callables.ts:85-92`; `functions/src/workspaces/lifecycle.ts:303-386`; `tests/firestore/workspaces-p1.rules.integration.test.mjs:183` |
| `archiveWorkspace` | CURRENT | Só owner, com `email_verified` e `auth_time` nos últimos 10 minutos (D-06). Grava `status: 'archived'`, `archivedAt` e `archivedBy`; nunca apaga. Repetir sobre um workspace já arquivado pelo owner devolve o mesmo resultado, sem nova auditoria. A callable está no contrato do cliente e não tem tela própria | `functions/src/workspaces/callables.ts:99-114`; `functions/src/workspaces/lifecycle.ts:394-437`; `functions/src/workspaces/__tests__/workspaceLifecycle.integration.test.ts:260` |
| `currency` | CURRENT | Somente BRL: o documento nasce com `currency: 'BRL'` e nenhuma callable aceita o campo | `functions/src/workspaces/lifecycle.ts:74`; `functions/src/workspaces/contracts.ts:69-75`; D-16 (tomada, §9.1 do plano) |
| PF com membros e CNPJ | CURRENT | Workspaces PF e PJ podem ter membros. CNPJ opcional e só em PJ; se informado, formato e dígitos verificadores são validados; não é globalmente único | `functions/src/workspaces/lifecycle.ts:44-60`; `functions/src/workspaces/cnpj.ts:25`; `functions/src/workspaces/__tests__/workspaceLifecycle.integration.test.ts:117`; D-22 (tomada, §9.1 do plano) |
| GAP | GAP | **Fechado em P1 (PLAN §16.4).** Criação pelo cliente sem validar `type`, sem quota e com falhas de payload | PR-WS-05 (P1): `functions/src/workspaces/lifecycle.ts:222`; a quota fecha com PR-ENT-01 (P2), conforme D-ORD-05 |

---

## 6. Membership e fontes de autoridade

### 6.1 Coleções (CURRENT)

Todas são server-owned: as Rules negam a escrita do cliente em cada uma (`firestore.rules:936-976,1398-1402`).

| Coleção | Campos | Quem grava | Rules |
| --- | --- | --- | --- |
| `workspaces/{wid}/members/{uid}` | `uid`, `email`, `role`, `status` (`active`/`removed`), `displayName`, `photoURL`, `invitedBy`, `joinedAt`, `updatedAt`, `removedAt`, `removedBy` (`functions/src/workspaces/model.ts:88-114`) | Só o backend: aceite de convite, troca de papel, remoção lógica, saída e transferência (`functions/src/workspaces/memberships.ts:231-604`) | `write: false`; `get` do próprio uid com conta ativa ou de membro ativo; `list` de membro ativo com `limit <= 200` (`firestore.rules:951-958`) |
| `users/{uid}/workspaces/{wid}` (índice) | `workspaceId`, `status` do vínculo, `name`, `type`, `workspaceStatus`, `joinedAt`, `updatedAt`; **sem papel** (`functions/src/workspaces/model.ts:121-129`) | Só o backend, na mesma transação que altera o membership; o gatilho `onWorkspaceDisplayChange` propaga nome, tipo e status aos demais membros (`functions/src/workspaces/indexSync.ts:31,80`) | `write: false`; `get` e `list` só do próprio usuário com conta ativa, `list` com `limit <= 50` (`firestore.rules:1398-1402`) |
| `workspaces/{wid}/invites/{inviteId}` | Ver §8.2; sem token nem hash | Só o backend (`functions/src/workspaces/memberships.ts:104-367`) | `write: false`; leitura de owner/admin, `list` com `limit <= 100` (`firestore.rules:962-967`) |
| `invite_tokens/{sha256(token)}` | `workspaceId`, `inviteId`, `createdAt`, `expiresAt` | Só o backend | Sem `match`: negado por padrão ao cliente |
| `workspaces/{wid}/membership_events/{eventId}` | Ver §9 | Só o backend, na mesma transação da mudança (`functions/src/shared/audit.ts:58`) | `write: false`; leitura de owner/admin, `list` com `limit <= 100` (`firestore.rules:971-976`) |

### 6.2 Problemas de autoridade da baseline (fechados em P1, PLAN §16.4)

- **Regime duplo.** Removido (PR-WS-03). `isWorkspaceOwnerByParent` e o fallback `ownerId` do backend não existem mais; Rules e backend usam só o membership ativo (`firestore.rules:28-64`; `functions/src/shared/workspaceAuth.ts:121-153`; `functions/src/shared/__tests__/workspaceAuth.integration.test.ts:86`).
- **Divergência entre camadas.** Removida (WS-10): as duas camadas leem o mesmo documento de membership e o papel do documento vale igualmente nas Rules e nas callables.
- **Resolvedores duplicados.** Substituídos por `resolveWorkspaceActor` (pré-checagem no wrapper) e `reassertWorkspaceActor` (releitura dentro da transação da mutação), usados por cartões, metas, investimentos, caixa, IA, divisão e pelas callables de P1 (ENTRY-20). `functions/src/creditCards/auth.ts` deixou de existir.
- **Trancamento do owner.** Fechado (PR-WS-04): ninguém altera o próprio papel ou status, o documento do owner não é rebaixável nem removível por outro papel, e a titularidade só muda por `transferWorkspaceOwnership`. Rules `write: false` em `members` (`functions/src/workspaces/__tests__/memberships.integration.test.ts:98,184`; `functions/src/workspaces/__tests__/ownership.integration.test.ts:171`; `tests/firestore/workspaces-p1.rules.integration.test.mjs:192`).
- **Descoberta e papel exibido.** Fechado (PR-WS-03): a listagem lê o índice mantido pelo backend, por página, sem query por `ownerId`, sem `collectionGroup` e sem escrita durante a leitura. O papel do workspace ativo vem de `members/{uid}` ativo, relido a cada seleção (`loadWorkspace`), e não do índice, que não guarda papel (`src/modules/workspaces/api.ts:131-168`; `src/contexts/WorkspaceContext.tsx:97-145`). O contorno `useAuthoritativeRole` do painel de investimentos foi removido (busca sem ocorrências).
- **Escrita parcial determinística.** Fechada (PR-WS-02): toda mutação de membership é uma transação do Admin SDK que grava membership, índice e auditoria juntos.
- **Remoção física.** Fechada (WS-11): a remoção é lógica (`status: 'removed'`, `removedAt`, `removedBy`) e gera `member.removed` ou `member.left` (`functions/src/workspaces/model.ts:133-148`; `functions/src/workspaces/memberships.ts:436-525`).
- **Efeito imediato da remoção (CURRENT).** As Rules leem o membership e o perfil a cada requisição (`firestore.rules:28-56`) e os resolvedores leem `members/{uid}` a cada chamada, então remover ou inativar o membership corta o acesso sem depender de revogação de token (`functions/src/workspaces/__tests__/memberships.integration.test.ts:203`).

### 6.3 CURRENT: membership como fonte única

- `workspaces/{wid}/members/{uid}` é a única fonte de papel. `status` é fechado: `active` ou `removed`, com `removedAt` e `removedBy` (`functions/src/workspaces/model.ts:36,133-148`). Só o backend grava. Rules: `allow write: if false`; `get` do próprio documento (conta ativa) ou de membro ativo; `list` de membro ativo com `limit <= 200` (`firestore.rules:951-958`; RULES-11 e RULES-16 tratados).
- Exatamente um owner canônico ativo por workspace (D-03): nasce em `bootstrapAccount`/`createWorkspace` e só muda por `transferWorkspaceOwnership`, que rebaixa a origem a admin, promove o destino e atualiza `ownerId` na mesma transação; transferências concorrentes nunca deixam zero nem dois owners (`functions/src/workspaces/memberships.ts:536-604`; `functions/src/workspaces/__tests__/ownership.integration.test.ts:57,147`). `ownerId` é só dado denormalizado: nunca é consultado para autorização nem serve de fallback.
- Resolvedor único no kernel (D-ORD-02), em `functions/src/shared/workspaceAuth.ts`: `evaluateWorkspaceAccess` (`:121`) exige conta ativa (`users/{uid}.status == 'active'`), membership `active`, papel na lista da operação e workspace não arquivado, com a mesma resposta para membership ausente e para workspace inexistente; `resolveWorkspaceActor` (`:162`) é a pré-checagem do wrapper; `reassertWorkspaceActor` (`:190`) relê perfil, workspace e membership dentro da transação da mutação. O formato do `workspaceId` (sem `/`, tamanho máximo, sem IDs reservados) é validado antes de qualquer leitura (`functions/src/shared/ids.ts:22-37`) (ENTRY-11, WS-15). Os schemas Zod de alguns domínios ainda aceitam qualquer string, e o resolvedor a recusa antes de ler; a unificação dos schemas acompanha P3–P5.
- Um único helper nas Rules, baseado no membership ativo com conta ativa (`isMember`, `hasRole`, `hasWriteRole`: `firestore.rules:28-64`).

### 6.4 CURRENT: índice do usuário

O índice do usuário é mantido só pelo backend, na mesma transação que altera o membership. O caminho `users/{uid}/workspaces/{wid}` foi mantido, sem renomear a coleção (plano mestre, P1, "Índice do usuário"). Rules: leitura pelo próprio usuário com conta ativa, `list` com `limit <= 50` e `write: false` (`firestore.rules:1398-1402`). O índice guarda dados de exibição (`name`, `type`, `workspaceStatus`) e o status do vínculo, não guarda papel e não autoriza nada: a UI lê o papel de `members/{uid}`, que o próprio usuário pode ler.

A listagem filtra `status == 'active'` e `workspaceStatus == 'active'`, ordena por `joinedAt` e usa um índice composto (`firestore.indexes.json:806`), com `limit` de 50 (o teto das Rules) e cursor `startAfter` no snapshot, sob demanda: "Carregar mais espaços" só aparece quando existe próxima página. Não há query por `ownerId`, `collectionGroup` nem escrita durante a leitura (WS-12) (`src/modules/workspaces/api.ts:69,112-142`; `src/contexts/WorkspaceContext.tsx:105-106,178`; `src/components/Header.tsx:354`). A lista de membros segue o mesmo padrão, com `limit` de 200 (`firestore.indexes.json:824`; `src/modules/workspaces/api.ts:170-196`; `src/modules/workspaces/hooks.ts:34`). Renomear ou arquivar um workspace atualiza o índice do ator na transação e o dos demais membros pelo gatilho `onWorkspaceDisplayChange`, em páginas de 200 (`functions/src/workspaces/indexSync.ts:29-109`). Testes: `tests/firestore/workspaces-p1.rules.integration.test.mjs:261,339`; `e2e/workspace-pagination.spec.ts:63`; `functions/src/workspaces/__tests__/workspaceLifecycle.integration.test.ts:306`.

---

## 7. Matriz RBAC

### 7.1 CURRENT: Rules e backend

"Sim" nas Rules significa membro ativo com conta ativa no papel indicado; o `ownerId` não concede nada (o regime `isWorkspaceOwnerByParent` foi removido em P1). No backend, `evaluateWorkspaceAccess` recusa com `workspace_role_denied` qualquer papel fora da lista da operação (`functions/src/shared/workspaceAuth.ts:121-153`), então `viewer` continua recusado em toda callable cuja matriz não o inclui. As linhas de domínio (P3–P5) mantêm a evidência da baseline: os números de linha de `firestore.rules` nelas podem ter mudado e são reconferidos ao tocar cada domínio.

| Operação | owner | admin | member | viewer | Evidência |
| --- | --- | --- | --- | --- | --- |
| Criar workspace (só por `createWorkspace`) | qualquer usuário autenticado com e-mail verificado e conta ativa | | | | `functions/src/workspaces/callables.ts:76-83`; `firestore.rules:944` |
| Ler workspace | sim | sim | sim | sim | `firestore.rules:943` |
| Editar configurações do workspace (só por `updateWorkspaceSettings`) | sim | sim | não | não | `functions/src/workspaces/callables.ts:85-92`; `firestore.rules:944` |
| Ler lista de membros | sim | sim | sim | sim | `firestore.rules:951-956` |
| Criar/alterar membership (só por callable; matriz D-04 da §7.2) | sim | sim, só `member`/`viewer` | não | não | `functions/src/workspaces/rbac.ts:20-50`; `firestore.rules:956` |
| Alterar o próprio papel | não | não | não | não | `functions/src/workspaces/memberships.ts:397-399` |
| Remover membership (remoção lógica) | sim, exceto o próprio owner | sim, só `member`/`viewer` | não | não | `functions/src/workspaces/memberships.ts:436-479` |
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
| Escrita em `settings_catalog` (o seed pelo cliente foi removido; o backend semeia na criação do workspace) | sim | sim | não | não | `firestore.rules:219-221,1330-1342`; `functions/src/workspaces/provisioning.ts:97` |
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
| Checkout de assinatura | qualquer usuário autenticado com conta ativa, sem workspace | | | | `functions/src/callables/billing.ts:96-98,125-126` |

Achados da baseline fechados em P1 (PLAN §16.4): o admin que criava membership com papel `admin` para qualquer UID e rebaixava ou removia outros admins (WS-13) não tem mais esse poder (D-04, §7.2), e o convite não usa mais UID fornecido pelo cliente. A UI rotula `member` como "Membro (Editor)" e convida como `viewer` por padrão (`src/components/MembersManagerModal.tsx:23-28,80`), sem alteração visual.

### 7.2 CURRENT (P1): ciclo de vida de workspace e membership

Papéis (D-02, tomada; implementados em `functions/src/workspaces/rbac.ts:20-50` e reavaliados na transação de cada callable): owner, admin, member e viewer; `viewer` é estritamente somente leitura. As operações financeiras seguem as matrizes declarativas de cada domínio (`writeStrategy.ts` e equivalentes), que P1 não altera (`viewer` continua recusado onde hoje é recusado) e que são revisadas em P3–P5 conforme [FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md). O escopo do plano, e portanto quem contrata, depende de D-01, pendente e restrita a P2 ([BILLING_ENTITLEMENTS.md](BILLING_ENTITLEMENTS.md)).

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
| Ler eventos de membership | sim | sim | não | não | `firestore.rules:971-976` |

Invariantes, verificados em teste (`functions/src/workspaces/__tests__/memberships.integration.test.ts:98,184,316,344`; `functions/src/workspaces/__tests__/ownership.integration.test.ts:57,147,171`): (1) existe sempre exatamente um owner canônico ativo (D-03), e `workspace.ownerId` o espelha sem ser fonte de autorização; (2) ninguém altera o próprio papel nem o próprio status, exceto pela saída voluntária; (3) o papel é relido na mesma transação que grava a mudança; (4) toda mudança grava o evento de auditoria na mesma transação; (5) o membership é criado com `uid = request.auth.uid` de quem aceita, nunca com identificador fornecido pelo cliente.

---

## 8. Convites

### 8.1 CURRENT

- O convite por UID fictício e a gravação de `members/{fakeUid}` pelo cliente foram removidos, e as Rules negam toda escrita em `members`. **GAP PR-WS-01: Fechado em P1 (PLAN §16.4).** O modal chama `inviteWorkspaceMember` com o e-mail digitado e o papel `viewer`, e mostra "Convite registrado" (`src/components/MembersManagerModal.tsx:68-83`). `acceptWorkspaceInvite`, `revokeWorkspaceInvite`, `leaveWorkspace` e `archiveWorkspace` existem no contrato do cliente (`src/modules/workspaces/callables.ts:15-30`), sem tela própria; transferência de ownership, saída e arquivamento existem no backend (WS-09 fechado).
- Os convites de grupo de divisão (`functions/src/callables/splitGroups.ts`) são de outro domínio: exigem que o usuário já seja membro do workspace e não servem para entrar num workspace. O desenho não deve ser copiado como está: o limite de tentativas e a marcação de expiração são revertidos pelo `throw` dentro da transação (ENTRY-14, em PR-SPLIT-04, P4).
- A tela de Configurações anuncia "Convide pessoas, gerencie permissões" (`src/components/SettingsView.tsx:668`). O convite é registrado, mas sem e-mail transacional (E-11) o destinatário não o recebe (PR-COMM-03, P9).

### 8.2 CURRENT

Coleção `workspaces/{wid}/invites/{inviteId}` com `inviteId`, `workspaceId`, `emailNormalized`, `role` (`admin`, `member` ou `viewer`), `status` (`pending`, `accepted` ou `revoked`), `expiresAt`, `createdBy`, `createdAt`, `updatedAt`, `acceptedBy`, `acceptedAt`, `revokedBy`, `revokedAt` e `revokedReason` (`functions/src/workspaces/memberships.ts:175-189`; `functions/src/workspaces/model.ts:37`). O convite **não** guarda o token nem o seu hash: o SHA-256 do token é o ID do ponteiro `invite_tokens/{hash}` (`workspaceId`, `inviteId`, `createdAt`, `expiresAt`), que só o backend lê (`functions/src/workspaces/memberships.ts:190-195`). A expiração não é um status persistido: é verificada por `expiresAt` no aceite. Rules: leitura por owner/admin (`limit <= 100`), `write: false`; `invite_tokens` não tem `match` e fica negado. O convidado não lê convites pelas Rules (`firestore.rules:962-967`).

1. **Emissão (`inviteWorkspaceMember`).** Owner/admin chama com `workspaceId`, `email`, `role` e `idempotencyKey`, com `email_verified`. Na transação: reserva de idempotência por ator, releitura da autorização, matriz D-04 (`canInvite`), verificação de que o e-mail normalizado não é membro ativo, rate limit de 30 convites por hora por ator e workspace, revogação (`revokedReason: 'replaced'`) do convite pendente anterior do mesmo e-mail, `expiresAt` em 7 dias, persistência apenas do SHA-256 do token e evento `invite.created`. O token é 256 bits de CSPRNG em base64url (43 caracteres). Ele não vai para log, resposta, auditoria nem outros membros; a resposta traz `inviteId` e `expiresAt`. O convite pode existir antes de o destinatário ter conta; a emissão não cria membership. P2 adiciona a quota nesta transação (D-01). (`functions/src/workspaces/memberships.ts:72-220`; `functions/src/workspaces/inviteTokens.ts:13-20`.)
2. **Entrega (EXTERNAL CONFIGURATION REQUIRED, E-11).** O desenho é um link contendo o token (D-05, tomada), mas o envio por e-mail transacional depende de E-11 e não é simulado: sem envio mock nem mensagem de "e-mail enviado" (o E2E verifica que a tela não afirma envio: `e2e/workspace-membership.spec.ts:121`). Hoje o token em claro é gerado e descartado no handler (`functions/src/workspaces/callables.ts:122-132`) e nenhuma resposta o entrega, então o aceite só é alcançável nos testes. No Emulator, o fluxo é testado por um seam exclusivo de teste (`functions/src/workspaces/testSupport/inviteTokenSeam.ts`), fora do bundle e dos exports de produção: `testSupport/` é ignorado no deploy (`firebase.json`) e o teste de contrato o verifica (`functions/src/shared/deploymentContract.test.ts:216-246`).
3. **Aceite (`acceptWorkspaceInvite`).** Exige autenticação, `email_verified`, conta ativa e token no formato de 43 caracteres base64url. O rate limit (10 tentativas por hora por usuário) é consumido em transação própria antes do aceite, então a tentativa inválida gasta orçamento mesmo quando falha. Na transação: resolve o convite pelo SHA-256 do token; exige `pending`, não expirado, e-mail da sessão igual a `emailNormalized` e workspace não arquivado; cria ou reativa `members/{auth.uid}` com o papel do convite (o `uid` é sempre o da sessão); atualiza o índice; marca o convite `accepted` (uso único: dois aceites concorrentes disputam o mesmo documento e só um vence); grava `invite.accepted`. Token inválido, expirado, revogado, de outro e-mail ou de workspace arquivado recebe a mesma resposta genérica em pt-BR (`not_found`: "Este convite é inválido, expirou ou já foi utilizado."). Repetir o mesmo aceite devolve o resultado (`replay: true`); depois de uma remoção o token não readmite. P2 adiciona a quota nesta transação (D-01). (`functions/src/workspaces/memberships.ts:56-86,231-316`; `functions/src/workspaces/callables.ts:135-156`.)
4. **Revogação (`revokeWorkspaceInvite`).** Owner/admin (o admin só nos convites que poderia emitir) muda o status para `revoked`, com `invite.revoked`; repetir é no-op, e um convite já aceito não pode ser revogado (`functions/src/workspaces/memberships.ts:319-367`).
5. **Expiração.** Verificada no aceite, qualquer que seja o TTL. A limpeza por TTL em `expiresAt` de `invites`, `invite_tokens` e `idempotency_keys` está declarada em `firestore.indexes.json` (`fieldOverrides`, `:838-857`); a política de TTL só passa a existir quando o índice for implantado (EXTERNAL CONFIGURATION REQUIRED, E-01/E-07: NÃO VERIFICADO).
6. **Reconvite de removido.** Novo convite; o aceite reativa o membership com o papel do convite (`functions/src/workspaces/__tests__/invites.integration.test.ts:265`).

Testes: `functions/src/workspaces/__tests__/invites.integration.test.ts` (matriz de emissão, ausência de token e hash no convite, resposta genérica idêntica, e-mail não verificado, aceite concorrente, rate limit consumido em tentativa inválida, token fora de log, auditoria e resposta).

---

## 9. Callables de ciclo de vida

As 11 callables de P1 (`functions/src/workspaces/callables.ts:68-232`) passam pelo wrapper `defineCallable` (`functions/src/shared/callable.ts:231`, D-ORD-02), que aplica, nesta ordem: identificador de requisição do servidor e log estruturado (`functions/src/shared/logger.ts:107`), autenticação e política de token (`email_verified`, `auth_time`, provedor; D-06, §2), Zod `.strict()` com IDs sem `/`, conta ativa (D-P1-SUSP) e, nas operações por workspace, a pré-checagem canônica do papel. Idempotência e auditoria acontecem dentro da transação do domínio (`functions/src/shared/idempotency.ts:37`, `functions/src/shared/audit.ts:58`). Os erros saem por um mapeador único (`ApplicationError`, `functions/src/shared/errors.ts:67`, e `toHttpsError`, `:141`, com códigos fechados e mensagens em pt-BR), e há um ponto de extensão para App Check, vazio até P6 (`APP_CHECK_CALLABLE_OPTIONS`, `functions/src/shared/callable.ts:78-81`). O `workspaceId` do payload é só "solicitado": o campo `workspaceId` do log só é preenchido depois da pré-checagem ou de `trustWorkspace`, chamado pelo handler depois da autorização transacional (`archiveWorkspace`, `transferWorkspaceOwnership`, `acceptWorkspaceInvite`) (`functions/src/shared/callable.ts:257,273`; `functions/src/shared/__tests__/kernelTenantLog.integration.test.ts`). Rate limit por ator existe em `inviteWorkspaceMember` (30 por hora) e `acceptWorkspaceInvite` (10 por hora); as demais callables de P1 não têm rate limit. Todas rodam em `southamerica-east1` com as opções de `DOMAIN_CALLABLE_OPTIONS`, cobertas pelo teste de contrato (`functions/src/shared/deploymentContract.test.ts`). Nenhuma consulta plano, quota ou entitlement em P1; P2 adiciona a quota dentro das transações de `createWorkspace`, `inviteWorkspaceMember` e `acceptWorkspaceInvite` antes de qualquer deploy remoto (D-01, D-ORD-04). O domínio está em `functions/src/workspaces/lifecycle.ts` (bootstrap `:106`, criação `:222`, configurações `:303`, arquivamento `:394`) e `functions/src/workspaces/memberships.ts` (convite `:104`, aceite `:231`, revogação `:319`, troca de papel `:385`, remoção `:436`, saída `:485`, transferência `:536`).

| Callable | Quem | Efeitos na mesma transação | Substituiu (removido em P1) | Milestone |
| --- | --- | --- | --- | --- |
| `bootstrapAccount` | usuário autenticado | perfil, workspace pessoal PF, membership owner, índice, provisionamento, auditoria | criação automática em `WorkspaceContext`; `ensureOwnerMembership` | P1 |
| `createWorkspace` | usuário autenticado com e-mail verificado | workspace, membership owner, índice, provisionamento, auditoria | `createWorkspace` do cliente e Rule de create | P1 (P2 adiciona a quota nesta transação, D-01) |
| `updateWorkspaceSettings` | owner, admin | campos mutáveis validados, auditoria | `updateWorkspace` do cliente e Rule de update | P1 |
| `inviteWorkspaceMember` | owner, admin (D-04) | convite com SHA-256 do token, auditoria | `fakeUid` e `addMember` | P1 (P2 adiciona a quota nesta transação, D-01) |
| `acceptWorkspaceInvite` | convidado verificado | membership, índice, convite `accepted`, auditoria | nenhum | P1 (P2 adiciona a quota nesta transação, D-01) |
| `revokeWorkspaceInvite` | owner, admin (D-04) | convite `revoked`, auditoria | nenhum | P1 |
| `changeWorkspaceMemberRole` | owner, admin (D-04) | membership, auditoria | `updateMemberRole` e `syncUserWorkspaceMembership` | P1 |
| `removeWorkspaceMember` | owner, admin (D-04) | `status: 'removed'`, índice, auditoria | `removeMember` (hard delete) | P1 |
| `leaveWorkspace` | admin, member, viewer; o owner transfere antes (D-04) | `status: 'removed'`, índice, auditoria | nenhum | P1 |
| `transferWorkspaceOwnership` | owner, com `auth_time` nos últimos 10 minutos | `ownerId`, papéis de origem e destino, auditoria | nenhum | P1 (D-03) |
| `archiveWorkspace` | owner, com `auth_time` nos últimos 10 minutos | `status: 'archived'`, auditoria | nenhum | P1 |
| `requestAccountDeletion`, `exportAccountData` | o próprio titular | §10.2 | nenhum | P8 |
| Suspensão de conta | operador de plataforma | §10.1 | nenhum | mecanismo em P1; superfície administrativa em P7 |

Eventos de membership vão para `workspaces/{wid}/membership_events` (`functions/src/shared/audit.ts:58`), gravados com `transaction.create` na mesma transação da mudança, com ID derivado de `requestId`, operação e alvo: cada efeito é auditado uma vez, e o replay de idempotência não regrava. Campos: `operation` (`account.bootstrapped`, `workspace.created`, `workspace.settings_updated`, `workspace.archived`, `invite.created`, `invite.accepted`, `invite.revoked`, `member.role_changed`, `member.removed`, `member.left`, `ownership.transferred`: `functions/src/shared/audit.ts:20-31`), `actorId`, `actorRole`, `targetId`, `before`, `after`, `reason`, `requestId` (correlation ID gerado no servidor) e `createdAt` do servidor. Rules: leitura por owner/admin, `write: false` (`firestore.rules:971-976`). A idempotência por ator (`users/{uid}/idempotency_keys`) cobre `createWorkspace`, `inviteWorkspaceMember` e `transferWorkspaceOwnership`; as demais operações são naturalmente idempotentes (repetir é no-op). A trilha unificada e sua retenção estão em [OBSERVABILITY.md](OBSERVABILITY.md) e [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md).

---

## 10. Suspensão, revogação e exclusão de conta

### 10.1 Suspensão e revogação

- **CURRENT (D-P1-SUSP, tomada):** `users/{uid}.status` é server-owned (`active` | `suspended`). `suspendAccount` (`functions/src/workspaces/suspension.ts:36`) grava `status: 'suspended'` e o evento `account.suspended` em `platform_audit_events` na mesma transação e, depois, faz `updateUser({disabled: true})` e `revokeRefreshTokens`; se um passo do Auth falhar, repetir a operação o refaz sem nova auditoria. Ela não é exportada como callable. Toda callable do kernel recusa conta suspensa (`account_suspended`, `functions/src/shared/workspaceAuth.ts:96-106`), e as Rules também negam leitura e escrita de dados de workspace e do índice do usuário a conta `suspended` (`hasActiveAccount`, `firestore.rules:28-36`, usado por `isMember`), o que fecha a janela do ID token ainda vigente (cerca de uma hora); o próprio usuário continua lendo o perfil suspenso (`firestore.rules:1380`). Testes: `functions/src/workspaces/__tests__/account.integration.test.ts:210,221`; `tests/firestore/workspaces-p1.rules.integration.test.mjs:290`; `tests/firestore/m4-hardening.rules.integration.test.mjs:1289`.
- **TARGET:** a operação por um administrador de plataforma (tela, custom claim, MFA) entra em P7, em PR-ADMIN-01 (P7), que consolida AUTH-09; o registro em `platform_audit_events` já prepara a trilha administrativa. Pelo plano (D-ORD-03), o mecanismo entrou em P1.

### 10.2 Exclusão e exportação de conta (P8)

- **CURRENT:** nenhuma callable, gatilho ou tela (`functions/src/index.ts:14-41`); `users` com delete negado (`firestore.rules:1381`); nenhum delete em `workspaces` (`firestore.rules:944`); a assinatura Stripe fica ligada a `users/{uid}` (`functions/src/webhooks/stripe.ts:97-107`). Apagar o usuário no console deixa perfil, workspaces, memberships e assinatura órfãos. **GAP:** PR-AUTH-01 (P8).
- **TARGET:** `requestAccountDeletion` exige `auth_time` recente e bloqueia enquanto o titular for owner canônico de workspace compartilhado sem transferência. Depois: cancela a assinatura no Stripe (E-06); arquiva os workspaces pessoais; anonimiza os dados pessoais em `users` e `members` e o ator no histórico compartilhado; retém o histórico financeiro pelo prazo legal, sem hard delete; revoga tokens; apaga o usuário do Auth por último; grava auditoria. `exportAccountData` gera a exportação do titular. Pelo plano (D-ORD-03), isso fica em P8, porque depende do modelo final dos domínios (P3–P5) e das callables de transferência, saída e arquivamento, já entregues em P1. Destino de workspaces, retenção fiscal e anonimização são **DECISION D-07** e D-18. Detalhes em [PRIVACY_LGPD.md](PRIVACY_LGPD.md) e [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md).

---

## 11. Administração de plataforma

- **CURRENT:** o cliente lê `isAdmin` de `users/{uid}` por `getDoc` (`src/contexts/AuthContext.tsx:71-80`). O campo não é autoconcedível (`firestore.rules:1377-1381`; `tests/firestore/m4-hardening.rules.integration.test.mjs:912`). A view `admin` é liberada só no cliente (`src/App.tsx:649`), e o painel é placeholder com valores fixos (`src/components/AdminDashboard.tsx:39,51,63`). Não há custom claim nem callable administrativa.
- **TARGET:** custom claim `platformAdmin` concedido por script Admin SDK auditado, com MFA do operador (E-03, E-04); fora do RBAC de workspace, sem dar acesso a dados de tenant pelas Rules; callables administrativas de menor privilégio com trilha imutável. Implementar ou remover o painel é **DECISION D-10**. **GAP:** PR-ADMIN-01 (P7). Controles em [SECURITY_MODEL.md](SECURITY_MODEL.md).

---

## 12. GAPs

| ID | Sev. | Milestone | Lacuna | Fecha quando |
| --- | --- | --- | --- | --- |
| PR-AUTH-01 | BLOCKER | P8 | Sem exclusão de conta, exportação nem cancelamento da assinatura na saída | §10.2 implementado e testado |
| PR-AUTH-02 | BLOCKER | P9 | Cadastro sem termos, política e aceite server-side versionado | Aceite exigido no cadastro, lido do registro de P8 |
| PR-AUTH-03 | HIGH | P1 | **Fechado em P1 (PLAN §16.4).** Bootstrap e perfil no cliente, não atômicos nem idempotentes | `bootstrapAccount` (§4.2): `functions/src/workspaces/lifecycle.ts:106-215`; `functions/src/workspaces/__tests__/account.integration.test.ts:116,146` |
| PR-AUTH-04 | HIGH | P6 | Login E2E no código de produção e artefato compartilhado | Login de teste fora do bundle; build por ambiente |
| PR-WS-01 | BLOCKER | P1 | **Fechado em P1 (PLAN §16.4).** Convite inexistente (UID fictício) | §8.2: `functions/src/workspaces/memberships.ts:104,231`; `functions/src/workspaces/__tests__/invites.integration.test.ts` |
| PR-WS-02 | HIGH | P1 | **Fechado em P1 (PLAN §16.4).** Mutações de membership no cliente, com escrita parcial e sem auditoria | Callables da §9; Rules `write: false` (`firestore.rules:951-958`) |
| PR-WS-03 | HIGH | P1 | **Fechado em P1 (PLAN §16.4).** Fontes concorrentes de papel | §6.3 e §6.4: `functions/src/shared/workspaceAuth.ts:121-214` |
| PR-WS-04 | HIGH | P1 | **Fechado em P1 (PLAN §16.4).** `ownerId` trancável via `status` | Invariantes da §7.2; `tests/firestore/workspaces-p1.rules.integration.test.mjs:192` |
| PR-WS-05 | HIGH | P1 | **Fechado em P1 (PLAN §16.4).** Criação de workspace sem validar `type`, sem quota e com falhas de payload | `createWorkspace`/`updateWorkspaceSettings`: `functions/src/workspaces/lifecycle.ts:222,303`; a parte de quota fecha com PR-ENT-01 (P2) |
| PR-WS-06 | HIGH | P1 | **Fechado em P1 (PLAN §16.4).** Sem testes de membership/workspace | §13.1 |

Relacionados de outros domínios: PR-ENT-01 (P2, quotas de workspaces e membros; fecha ao fim de P5 por D-ORD-05), PR-ADMIN-01 (P7), PR-AI-04 (P5, histórico de IA e limpeza no logout), PR-APPCHK-01 (P6), PR-SPLIT-04 (P4), PR-COMM-03 (P9).

MEDIUM/LOW de origem tratados neste domínio:

| ID | Lacuna | Tratamento |
| --- | --- | --- |
| AUTH-08 | Qualquer token aceito: sem `email_verified`, restrição de provedor ou blocking function | **Fechado em P1 (PLAN §16.4)** no wrapper (`functions/src/shared/callable.ts:185-215`); blocking functions seguem em E-03 (D-06) |
| AUTH-10 | Falhas de login e de carga de workspaces silenciosas | **Fechado em P1 (PLAN §16.4):** mapeamento pt-BR e estado de erro (`src/components/auth/LoginView.tsx:8-26`; `src/App.tsx:544-551`) |
| AUTH-15 | Textos fora de pt-BR (painel admin em pt-PT, `lang="en"`), marca inconsistente | Revisão com `ptbr-product-ui-review` |
| AUTH-17 | Sem política de sessão, reautenticação ou MFA | Parcial: `auth_time` e reautenticação para operações irreversíveis em P1; persistência de sessão e MFA de admin seguem abertas (D-06; P7) |
| WS-09 | Sem transferência de ownership, saída ou arquivamento | **Fechado em P1 (PLAN §16.4):** callables da §9 |
| WS-12 | Listagem com escrita a cada leitura, N+1 e sem `limit` | **Fechado em P1 (PLAN §16.4):** índice do usuário paginado (§6.4) |
| WS-13 | Poderes amplos do admin sobre outros admins | **Fechado em P1 (PLAN §16.4):** D-04 (`functions/src/workspaces/rbac.ts:20-50`), com testes negativos |
| WS-14 | `Owner` e e-mail placeholder visíveis; erros silenciosos | **Fechado em P1 (PLAN §16.4):** identidade do token no backend (`functions/src/workspaces/model.ts:67-71`); erros em pt-BR (`src/modules/workspaces/errors.ts:38-44`) |
| WS-15, ENTRY-11 | `workspaceId` com `/` aceito pelo resolvedor e por 18 callables | **Fechado em P1 (PLAN §16.4)** no resolvedor, que valida o ID antes de qualquer leitura (`functions/src/shared/workspaceAuth.ts:48-64`; `functions/src/shared/__tests__/workspaceAuth.integration.test.ts:132`); a unificação dos schemas de domínio acompanha P3–P5 |
| ENTRY-20 | Cartões e metas verificam o papel fora da transação | **Fechado em P1 (PLAN §16.4):** `reassertWorkspaceActor` na transação (`functions/src/creditCards/createPurchase.ts:434`; `functions/src/goals/operations.ts:219`) |
| ENTRY-23 | Nenhum entrypoint exige e-mail verificado | **Fechado em P1 (PLAN §16.4)** no wrapper para as callables de workspace e membership (D-06); outras callables seguem a política de cada domínio |
| RULES-11 | `members` listável sem `limit` | **Fechado em P1 (PLAN §16.4):** `list` com teto (`firestore.rules:955`) |
| RULES-16 | `members.status` aceita qualquer string | **Fechado em P1 (PLAN §16.4):** enum `active`/`removed` gravado só pelo backend (`functions/src/workspaces/model.ts:36`) |

---

## 13. Testes

### 13.1 CURRENT

- Rules no Emulator: `tests/firestore/workspaces-p1.rules.integration.test.mjs` cobre tenants A e B, owner, admin, member, viewer, removido, suspenso, sem perfil e não autenticado: leitura de workspace só por membership ativo com conta ativa (`:173`), cliente sem create, update nem delete de workspace (`:183`), `members` com teto e sem escrita (`:192`), convites e auditoria só para owner/admin (`:226`), perfil (`:244`), índice do usuário sem papel e com teto (`:261`), coleções server-only (`:280`), viewer e conta suspensa (`:290`), workspace arquivado (`:301`) e paginação por cursor acima de 50 e de 200 (`:339`).
- `tests/firestore/m4-hardening.rules.integration.test.mjs`: gestão de membros negada até para o owner (`:609`), criação e delete de workspace e escrita do índice negados (`:655`), perfil sem escrita do cliente (`:912,986,1001`), conta suspensa (`:1289`), membership sem perfil (`:1355`) e workspace arquivado (`:1395`). O teste que consagrava a gestão de membros pelo cliente foi substituído.
- Integração das callables no Emulator (`functions/src/workspaces/__tests__/`): `account`, `workspaceLifecycle`, `invites`, `memberships`, `ownership`, `provisioning` e `workspaceUnits`; kernel em `functions/src/shared/__tests__/` (`workspaceAuth.integration`, `kernelTenantLog.integration`, `kernel.test.ts`). As suítes de integração do kernel e de P1 falham, em vez de pular, quando não há Emulator (`functions/src/shared/testSupport/kernelTestSupport.ts:22`).
- Frontend: `tests/unit/workspace-callables.test.ts` (contrato das 11 callables) e `tests/unit/session-cleanup.test.ts`. E2E com duas contas no Emulator: `e2e/workspace-membership.spec.ts:53,121` (primeiro login prepara a conta e o logout não vaza dados; convite, aceite, troca de papel, remoção e perda de acesso) e `e2e/workspace-pagination.spec.ts:63`. `e2e/authenticated-smoke.spec.ts:3-13` cobre o login de teste.
- Matriz de papéis de cartões (`functions/src/creditCards/__tests__/rbac.integration.test.ts:269`) e membro `removed` recusado em investimentos (`functions/src/investments/__tests__/domainV2.integration.test.ts:893`).

### 13.2 Exigidos para fechar P1 (atendidos em 13.1)

1. Suítes de Rules no Emulator com tenants A e B, cobrindo owner, admin, member, `viewer` (somente leitura, D-02), removido, não membro e não autenticado: negação de escrita do cliente em `members`, `invites`, `membership_events`, índice do usuário e create/update de `workspaces`; leitura cross-tenant negada nos dois sentidos.
2. Integração das callables da §9: matriz permitida e negada (D-04); `workspaceId` com `/` rejeitado; papel forjado no payload ignorado; `email_verified` e `auth_time` conforme D-06; conta suspensa recusada.
3. `bootstrapAccount`: replay idempotente; duas chamadas concorrentes produzem um único workspace pessoal; falha no meio não deixa estado parcial.
4. Convites: reuso de token, token expirado, revogado, e-mail divergente, e-mail não verificado, aceite duplo concorrente, rate limit consumido em tentativa inválida, resposta genérica idêntica nos casos de falha, só o SHA-256 persistido e token ausente dos logs. Quota no limite é teste de P2 (D-01).
5. Invariantes: o owner não sai, não é removido nem é rebaixado; admin não cria, promove, rebaixa nem remove admin; cenário de trancamento de PR-WS-04 negado; duas trocas de papel concorrentes; membro removido durante a chamada é recusado.
6. Toda mutação grava exatamente um evento de auditoria na mesma transação. O teste verifica o estado final e a auditoria, não só o código de resposta.
7. E2E com duas contas no Emulator: convite, aceite, troca de papel, remoção e perda de acesso; logout seguido de login com outro usuário sem dados residuais.
8. As suítes de integração falham, em vez de pular, quando o CI roda sem Emulator (FIRE-13).

Estado: os itens 1 a 7 foram atendidos em P1 pelos testes de 13.1. O item 8 vale para as suítes de P1 e do kernel; as demais suítes de integração seguem em FIRE-13 (P6).

---

## 14. Legado removido em P1

Conforme a política de legado e §7 do [plano mestre](PRODUCTION_READINESS_PLAN.md#7-legado-a-remover), a remoção é provada por busca no código (sem ocorrências em `src/`, `functions/src/`, `firestore.rules`, `e2e/` e `tests/`), por Rules que negam o caminho antigo e por testes.

| Legado | Evidência da remoção | Substituto |
| --- | --- | --- |
| Convite com `fakeUid`; `addMember`, `removeMember`, `updateMemberRole`, `syncUserWorkspaceMembership` | Busca sem ocorrências; `firestore.rules:951-958` | Callables da §9 |
| `ensureOwnerMembership`, query por `ownerId`, fallback `collectionGroup('members')` | Busca sem ocorrências; `src/modules/workspaces/api.ts:112-142` lê só o índice | Índice mantido pelo backend |
| Espelho gravável pelo cliente com `role` usado como `myRole` | `firestore.rules:1398-1402` (`write: false`); índice sem papel (`functions/src/workspaces/model.ts:121-129`); `myRole` vem de `loadWorkspace` (`src/modules/workspaces/api.ts:144-168`) | Índice `write: false`; papel lido do membership |
| `isWorkspaceOwnerByParent` e fallback `ownerId` no backend; resolvedores duplicados | `firestore.rules:28-64`; `functions/src/shared/workspaceAuth.ts:121-214`; `functions/src/creditCards/auth.ts` não existe mais | Resolvedor único do kernel |
| Create de workspace e escrita de `members` pelo cliente nas Rules; delete físico de membership | `firestore.rules:936-958` | `write: false` |
| `userId` legado; tipos `Workspace` duplicados; placeholders `Owner` e `usuario-sem-email@sistema` | `src/types.ts:19` reexporta só `WorkspaceType`; `src/modules/workspaces/types.ts:21-37`; busca sem os placeholders | Tipo único; dados do token (`functions/src/workspaces/model.ts:67-71`) |
| Seed de catálogo e onboarding disparados pelo cliente; criação automática com lista vazia | `src/contexts/WorkspaceContext.tsx:97-145`; `src/modules/workspaces/hooks.ts:11-25`; `seedLegacySettingsCatalog` removido (callable e wrapper) | `bootstrapAccount`/`createWorkspace` com `functions/src/workspaces/provisioning.ts` |
| Contorno `useAuthoritativeRole` | Busca sem ocorrências | Papel único exposto pelo `WorkspaceContext` |
| Teste que consagra a gestão de membros pelo cliente | Substituído por `tests/firestore/m4-hardening.rules.integration.test.mjs:609` e `tests/firestore/workspaces-p1.rules.integration.test.mjs:192` | Testes das callables e negação nas Rules |

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
