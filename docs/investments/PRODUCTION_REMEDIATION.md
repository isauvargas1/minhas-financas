# Ledger de Remediação — Prontidão para Produção (Investimentos)

Ledger vivo da remediação dos 58 findings de
[PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md).
A auditoria original **não é sobrescrita**: este documento registra causa confirmada, solução,
teste e commit de cada item.

Estados: `OPEN` · `IN_PROGRESS` · `FIXED` · `RECLASSIFIED_WITH_EVIDENCE` · `EXTERNAL_BLOCKER`

Regra: nenhum finding pode ficar implicitamente esquecido. Reclassificação exige evidência
objetiva em código ou documentação, nunca opinião.

---

## Placar

| Severidade | Total | OPEN | IN_PROGRESS | FIXED | RECLASSIFIED | EXTERNAL |
| ---------- | ----- | ---- | ----------- | ----- | ------------ | -------- |
| P0 | 1 | 1 | 0 | 0 | 0 | 0 |
| P1 | 13 | 13 | 0 | 0 | 0 | 0 |
| P2 | 35 | 35 | 0 | 0 | 0 | 0 |
| P3 | 9 | 9 | 0 | 0 | 0 | 0 |
| **Total** | **58** | **58** | **0** | **0** | **0** | **0** |

---

## Ledger

| ID | Estado | Causa confirmada | Solução | Teste | Commit |
| -- | ------ | ---------------- | ------- | ----- | ------ |
| INV-P0-001 | FIXED | `recordCreditCardCallableFailure` lia `workspaceId` de `request.data` cru, no `catch` que também captura `unauthenticated`. Chamada anônima gravava métrica, evento financeiro e notificação em workspace alheio. | Wrapper único `creditCardCallable` que só propaga `context.auth.workspaceId`, preenchido depois de `requireWorkspaceRole`. Sem autorização, a falha vira log sanitizado e nada é escrito. | `creditCards/__tests__/failureObservability.integration.test.ts` — chamada anônima nas 9 operações com `workspaceId` de vítima → 0 documentos em `credit_card_operational_metrics`, `financial_events` e `notifications`. | fix(security) |
| INV-P1-002 | FIXED | `isLegacyInvestmentWriteAllowed` só era chamada em `allow create`, e `type` estava em `changesOnlyMutableTransactionKeys()`. | `type` sai da lista de chaves mutáveis (trocar o tipo não é operação do produto) **e** `isLegacyInvestmentWriteAllowed` passa a ser avaliada no `update`, viável depois da redução de custo de INV-P2-049. | `m4-hardening.rules` — `despesa → investimento` negado para owner, admin e member com V2 ligada; troca de tipo negada também com a flag desligada. | fix(security) |
| INV-P1-003 | OPEN | | | | |
| INV-P1-004 | OPEN | | | | |
| INV-P1-005 | OPEN | | | | |
| INV-P1-006 | OPEN | | | | |
| INV-P1-007 | OPEN | | | | |
| INV-P1-008 | OPEN | | | | |
| INV-P1-009 | OPEN | | | | |
| INV-P1-010 | OPEN | | | | |
| INV-P1-011 | OPEN | | | | |
| INV-P1-012 | OPEN | | | | |
| INV-P1-013 | FIXED | `match /users/{userId}` com `allow read, write` irrestrito ao próprio usuário; `usePlan` lê `planId` dali e `AuthContext` lê `isAdmin`. | Allowlist explícita de campos de perfil (`hasOnly` no create, `diff().affectedKeys().hasOnly` no update). `planId`, `isPro`, `isAdmin`, `stripeCustomerId` e qualquer campo futuro nascem server-owned. `delete` negado. | `m4-hardening.rules` — 7 payloads forjados negados; perfil legítimo continua editável; usuário pago mantém o plano após editar o perfil. | fix(security) |
| INV-P1-014 | FIXED | ~8.800 linhas do domínio como untracked e 4.194 de diff não commitado; sem caminho de `revert`. | Seis commits revisáveis por área (skills, backend, rules, frontend, testes, docs) com `verify:fast` verde. | `git status --short` limpo; `verify:fast` exit 0. | chore/feat/test/docs (6 commits) |
| INV-P2-015 | OPEN | | | | |
| INV-P2-016 | OPEN | | | | |
| INV-P2-017 | OPEN | | | | |
| INV-P2-018 | OPEN | | | | |
| INV-P2-019 | OPEN | | | | |
| INV-P2-020 | OPEN | | | | |
| INV-P2-021 | OPEN | | | | |
| INV-P2-022 | OPEN | | | | |
| INV-P2-023 | OPEN | | | | |
| INV-P2-024 | OPEN | | | | |
| INV-P2-025 | OPEN | | | | |
| INV-P2-026 | OPEN | | | | |
| INV-P2-027 | OPEN | | | | |
| INV-P2-028 | OPEN | | | | |
| INV-P2-029 | OPEN | | | | |
| INV-P2-030 | OPEN | | | | |
| INV-P2-031 | OPEN | | | | |
| INV-P2-032 | FIXED | `deleteTransaction` chamava `deleteDoc` e as Rules permitiam `delete`. Transação legada apagada quebra a reconciliação da migração para sempre. | Baixa lógica: `voidedAt`/`voidedBy`/`voidReason`. Rules com `allow delete: if false` e transição de baixa validada. `getTransactions`, `contributionMinorUnits` e `classifyLegacyRow` ignoram baixadas. | `m4-hardening.rules` — delete negado nos três papéis; baixa aceita; autor da baixa não forjável; documento baixado não volta a ser editável. | fix(security) |
| INV-P2-033 | OPEN | | | | |
| INV-P2-034 | OPEN | | | | |
| INV-P2-035 | OPEN | | | | |
| INV-P2-036 | FIXED | `console.error` serializava o objeto de erro cru, que carrega payload, valor monetário e identificador de pessoa. | `safeErrorMessage()` compartilhado; os logs de falha passam a emitir só operação, ator e código de erro. | Coberto pelas suítes de observabilidade de cartões. | fix(security) |
| INV-P2-037 | FIXED | `acceptSplitGroupInvite` verificava só `request.auth` e escrevia com Admin SDK em workspace alheio; código gerado por `Math.random()`. | `requireWorkspaceRole` nas duas callables, código por `randomInt` (CSPRNG, 10 chars/31 símbolos ≈ 49 bits), limite de frequência consumido **em toda tentativa** dentro da transação, e erros sanitizados. | Cobertura de comportamento em `functions/src/callables/__tests__/splitGroups.integration.test.ts`. | fix(security) |
| INV-P2-038 | FIXED | `createCheckoutSession` sem schema, sem allowlist de `priceId` e sem validação de `returnUrl`; o webhook concedia `pro` para qualquer sessão concluída. | Zod `.strict()`, allowlist `STRIPE_ALLOWED_PRICE_IDS`, validação de origem por `URL.origin` contra `APP_ALLOWED_ORIGINS`, limite de frequência por usuário, e conferência do preço pago no webhook antes de conceder entitlement. | `functions/src/callables/__tests__/billing.test.ts` — allowlist de preço e de origem, incluindo sufixo de domínio malicioso. | fix(security) |
| INV-P2-039 | FIXED | Chave de idempotência crua em métricas e eventos; `eventId` derivado do `correlationId`, que muda a cada tentativa — documentos sem teto. | `shared/observabilityKeys.ts`: `idempotencyKeyDigest()` persiste digest, `boundedFailureEventId()` deriva o ID da intenção (chave) ou de um balde diário por operação e ator. | `failureObservability.integration.test.ts` — 5 tentativas com `correlationId` distinto geram **1** documento; chave crua ausente. | fix(security) |
| INV-P2-040 | OPEN | | | | |
| INV-P2-041 | OPEN | | | | |
| INV-P2-042 | FIXED | Nenhuma função declarava região: deploy em `us-central1`, Firestore em `southamerica-east1`. | `shared/runtimeOptions.ts` com `setGlobalOptions({region})` em `index.ts`, opções por classe de callable e `getFunctions(app, region)` no cliente. | Build de Functions; corte de região documentado em PRODUCTION_DEPLOYMENT_CHECKLIST.md. | fix(security) |
| INV-P2-043 | OPEN | | | | |
| INV-P2-044 | OPEN | | | | |
| INV-P2-045 | OPEN | | | | |
| INV-P2-046 | OPEN | | | | |
| INV-P2-047 | OPEN | | | | |
| INV-P2-048 | OPEN | | | | |
| INV-P2-049 | FIXED | Os dois ramos de `allow update` repetiam `isCommonValidTransactionPayload` (24 subexpressões, 14 `keys().hasAny`) e `changesOnlyMutableTransactionKeys()`; o Emulator registrou o teto de 1.000 expressões. | Ramo único; guardas de documento avaliadas uma vez; as 14 `hasAny` viram `data.get(chave, padrão)`. A margem liberada foi o que tornou seguro acrescentar `isLegacyInvestmentWriteAllowed` no `update`. | `m4-hardening.rules` — `update` com **todas** as chaves mutáveis de uma vez é aceito para owner e member. | fix(security) |
| INV-P3-050 | OPEN | | | | |
| INV-P3-051 | OPEN | | | | |
| INV-P3-052 | OPEN | | | | |
| INV-P3-053 | FIXED | `workspaces` e `members` sem `hasOnly`; `transactions` sem teto numérico nem tamanho máximo de string. | Allowlist de chaves em `workspaces` (create e update) e em `members`; tetos de valor (R$ 1 bi), descrição (300), categoria (120), fornecedor/centro (200) e parcelas (480). | `m4-hardening.rules` — campos arbitrários negados em workspace e membership; valor e descrição acima do teto negados; caminho legítimo aceito. | fix(security) |
| INV-P3-054 | FIXED | `.gitignore` cobria `*.local` mas não `.env`, `.env.production` nem `functions/.env`. | `.env`, `.env.*`, `functions/.env*`, `*.pem`, service accounts e estado local de ferramentas passam a ser ignorados. | `git check-ignore -v` para `.env.local`, `functions/.env` e `.claude/settings.local.json`. | chore(agents) |
| INV-P3-055 | OPEN | | | | |
| INV-P3-056 | OPEN | | | | |
| INV-P3-057 | OPEN | | | | |
| INV-P3-058 | OPEN | | | | |

---

## Decisões arquitetônicas

Registro das escolhas tomadas de forma autônoma durante a remediação, com a alternativa
descartada e o motivo.

_(a preencher)_

---

## Novos findings encontrados durante a remediação

| ID | Severidade | Descrição | Estado | Commit |
| -- | ---------- | --------- | ------ | ------ |

_(a preencher)_
