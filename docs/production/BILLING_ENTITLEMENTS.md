# Billing, assinatura e entitlements

Referência do programa de Production Readiness para cobrança Stripe, catálogo de planos, estado de assinatura, entitlements e quotas do Minhas Finanças. Registra o que existe no HEAD auditado (`main` @ `9c3ab46`), o alvo concreto para este código e as lacunas, sempre com os IDs do [plano mestre](PRODUCTION_READINESS_PLAN.md). Este documento **não prova implementação**: antes de agir, confirme o código no HEAD. O gate do tema é a skill `billing-entitlement-integrity`, executada com `multi-tenant-security-review` (quem pode contratar e isolamento) e `saas-commercial-readiness` (o que é exibido e prometido ao cliente). A §14 é o registro de evidência de configuração Stripe (E-06) exigido pela skill.

- **Milestone responsável:** P2 ([plano mestre §8](PRODUCTION_READINESS_PLAN.md#8-milestones)). O enforcement de quotas fecha de forma incremental até P5 (D-ORD-05, [§9](PRODUCTION_READINESS_PLAN.md#9-decisões-de-ordenação-e-escopo-tomadas-em-p0)).
- **Decisões que bloqueiam P2:** D-01, D-07, D-08 ([§10](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision)); D-11 para quotas de IA.
- **Configuração externa:** E-05 (segredos por ambiente), E-06 (Stripe), E-08 (alertas), E-09 (jurídico).

---

## 1. Resumo

| Tema | CURRENT (HEAD `9c3ab46`) | TARGET | GAP |
| --- | --- | --- | --- |
| Catálogo | Só no frontend; Pro e Business com o mesmo `priceId` e preço literal (`src/constants/plans.ts:15,26`; `src/modules/billing/components/PricingTable.tsx:42`) | Catálogo único versionado no backend, por `planKey`, com `amountCents` em BRL e `priceId` por ambiente | PR-BILL-04 |
| Checkout | Callable autenticada com Zod estrito, allowlist de preço e origem, rate limit 10/h (`functions/src/callables/billing.ts:96-134`) | Callable por workspace, papel autorizado, customer único e bloqueio de assinatura duplicada | PR-BILL-03 |
| Webhook | Assinatura verificada; só `checkout.session.completed`; grava `planId: 'pro'` (`functions/src/webhooks/stripe.ts:52,60,97-107`) | Ciclo de vida completo, idempotente por `event.id`, ordenado, auditado | PR-BILL-01, PR-BILL-06 |
| Estado canônico | `users/{uid}` com `planId`, `isPro`, `subscriptionStatus` fixo `'active'` (`functions/src/webhooks/stripe.ts:97-107`) | Um documento server-owned por entidade pagadora (D-01) | PR-BILL-07 |
| Portal e cancelamento | Inexistentes (grep `billingPortal` sem resultado; `src/components/SettingsView.tsx:252,552`) | Customer Portal por callable e seção "Plano e assinatura" | PR-BILL-02 |
| Segredos | Declarados por função, com fallback `whsec_placeholder`/`sk_test_placeholder` (`functions/src/webhooks/stripe.ts:8-9`; `functions/src/callables/billing.ts:9`) | `defineSecret` sem fallback, falha fechada | PR-BILL-05 |
| Quotas | Só `checkLimit` no cliente (`src/hooks/usePlan.ts:36-38`) | Verificação no backend na mesma transação da criação | PR-ENT-01 |
| Custo de IA | Rate limit fixo por workspace+ator (`functions/src/ai/callables.ts:44-48,167-171`) | Quota por plano e por entidade pagadora, teto de tokens | PR-AI-03 |
| Testes | Só helpers, contrato de segredos e Rules de campos de plano | Webhook, checkout, quotas e concorrência no Emulator | PR-BILL-08 |

---

## 2. Fluxo CURRENT de checkout e webhook

| # | Passo | Evidência | Classificação |
| --- | --- | --- | --- |
| 1 | O usuário autenticado abre "Meu Plano" (view `planos`); a tabela de preços só existe dentro do app. | `src/components/Sidebar.tsx:100-103`; `src/App.tsx:642` | CURRENT |
| 2 | `PricingTable` percorre `PLANS` do frontend, exibe preço literal e envia `(plan as any).priceId`. Não lê o plano atual. | `src/modules/billing/components/PricingTable.tsx:36-48` | CURRENT · GAP PR-BILL-04 |
| 3 | `useCheckout` chama `createCheckoutSession({priceId, returnUrl: window.location.origin})`. | `src/modules/billing/hooks.ts:22-31` | CURRENT |
| 4 | A callable exige `request.auth`, valida `{priceId, returnUrl}` com Zod `.strict()`, recusa allowlist vazia (`billing_price_allowlist_missing`), preço fora da allowlist e `returnUrl` fora das origens exatas de `APP_ALLOWED_ORIGINS`. | `functions/src/callables/billing.ts:14-17,51-68,96-123` | CURRENT (manter) |
| 5 | Rate limit de 10 checkouts por hora por usuário, reservado em transação em `users/{uid}/rate_limits`. | `functions/src/callables/billing.ts:70-74,125-134`; `functions/src/shared/rateLimit.ts:80-89` | CURRENT (manter) |
| 6 | `stripe.checkout.sessions.create` em `mode: 'subscription'`, só cartão, `customer_email` do token, `metadata {userId, priceId}`, retorno com `?billing=success`/`?billing=canceled`. Sem customer existente, `Idempotency-Key`, `workspaceId`, `client_reference_id` ou `subscription_data.metadata`. | `functions/src/callables/billing.ts:136-144` | CURRENT · GAP PR-BILL-03 (BILL-09) |
| 7 | No retorno, `BillingSuccessModal` abre só por `?billing=success` e afirma "Pagamento Aprovado!" sem ler o servidor; o retorno cancelado não é tratado. | `src/modules/billing/components/BillingSuccessModal.tsx:8-10,31-36`; `src/App.tsx:698` | CURRENT · GAP PR-COMM-03 (BILL-10) |
| 8 | `stripeWebhook` (`onRequest`, `cors: true`) exige o header `stripe-signature` e verifica com `constructEvent` sobre `req.rawBody`; em erro, ecoa `error.message` na resposta. | `functions/src/webhooks/stripe.ts:31-58` | CURRENT · GAP BILL-16 |
| 9 | Só `checkout.session.completed` é tratado. Exige `metadata.userId` e `payment_status === 'paid'` (sessões `no_payment_required` nunca concedem), relê os line items pela API e confere contra a allowlist. Qualquer outro evento responde 2xx sem efeito. | `functions/src/webhooks/stripe.ts:22-29,60-93,110` | CURRENT · GAP PR-BILL-01 |
| 10 | Grava por `set(..., {merge: true})`, fora de transação e sem registro do evento, em `users/{uid}`: `planId: 'pro'`, `isPro: true`, `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId`, `subscriptionStatus: 'active'`, `updatedAt`. | `functions/src/webhooks/stripe.ts:97-107` | CURRENT · GAP PR-BILL-06, PR-BILL-07 |
| 11 | `usePlan` abre um `onSnapshot` em `users/{uid}` por componente consumidor (4), mapeia `planId` para `PLANS`, ignora `subscriptionStatus` e `isPro` e não trata erro. | `src/hooks/usePlan.ts:13-33`; `src/components/Header.tsx:36`; `src/components/SplitGroupsView.tsx:36`; `src/components/RecentTransactions.tsx:43`; `src/components/TransactionsView.tsx:95` | CURRENT · GAP BILL-15 |
| 12 | As Rules restringem a escrita do cliente em `users/{uid}` a uma allowlist de perfil: `planId`, `isPro`, `isAdmin` e campos Stripe são server-owned, `delete` é negado e `rate_limits` é negado nos dois sentidos. Há teste no Emulator. | `firestore.rules:148-157,1456-1474`; `tests/firestore/m4-hardening.rules.integration.test.mjs:766-851` | CURRENT (base a manter) |

---

## 3. Catálogo CURRENT (alegação C02)

| Plano (`id`) | `priceId` no frontend | Preço exibido | workspaces | members | transactionsMonth | splitGroups | Concessão pelo webhook | Definição |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FREE (`free`) | — | R$ 0 | 1 | 2 | 50 | 2 | Padrão quando `planId` está ausente (`src/hooks/usePlan.ts:23,26`) | `src/constants/plans.ts:2-11`; `PricingTable.tsx:42` |
| PRO (`pro`) | `price_1TAyyCJvdLQmRJDshibLb4QF` ("COLOQUE O ID REAL AQUI") | R$ 29,90 (literal) | 5 | 10 | 1000 | 10 | Sempre `'pro'` quando algum preço pago está na allowlist (`functions/src/webhooks/stripe.ts:81-99`) | `src/constants/plans.ts:12-22`; `PricingTable.tsx:42` |
| BUSINESS (`business`) | O mesmo `priceId` do PRO | R$ 29,90 (literal) | 999 | 999 | 99999 | 999 | Nunca: o webhook não conhece `business` | `src/constants/plans.ts:23-33`; `PricingTable.tsx:42` |

Fatos CURRENT adicionais:

- O backend conhece apenas a allowlist plana `STRIPE_ALLOWED_PRICE_IDS`, sem mapear preço para plano (`functions/src/callables/billing.ts:31-35`). O `priceId` do frontend é o mesmo em todos os ambientes, então num projeto cuja allowlist tenha outro ID o checkout responde "Plano indisponível." (`functions/src/callables/billing.ts:117-118`).
- A tabela mostra 999 como "Ilimitado", 99999 cru e a chave interna em inglês (`PricingTable.tsx:73`, BILL-11); "Plano Atual" fica fixo no Free e "Fazer Upgrade" nos pagos, qualquer que seja o plano do usuário (`PricingTable.tsx:49,57-63`).
- Não existe no código valor em centavos, moeda, intervalo ou versão de catálogo. O valor efetivamente cobrado vive no Stripe: **NÃO VERIFICADO** (E-06).

**TARGET — catálogo único (PR-BILL-04, P2).** Módulo versionado em `functions/src/billing/` com, por plano: `planKey` (`free`, `pro`, `business` ou o que D-08 definir), nome em pt-BR, `amountCents` inteiro, `currency: 'brl'`, `interval`, `priceId` por ambiente (parâmetro do projeto, não constante do bundle), `entitlements` com limite numérico ou `null` explícito para ilimitado, e `catalogVersion`. O frontend lê o catálogo por callable de leitura (ex.: `getBillingCatalog`, nome a confirmar em P2) e envia `planKey`, nunca `priceId`. O webhook mapeia `priceId → planKey` pelo mesmo catálogo. Um teste compara o catálogo com a configuração do ambiente. Mudança de preço cria novo Price no Stripe; a regra para assinantes existentes é parte de D-08.

---

## 4. Estado canônico da assinatura

**CURRENT:** o plano vive em `users/{uid}`, com `planId` e `isPro` redundantes (`isPro` nunca é lido), `subscriptionStatus` gravado uma única vez como `'active'` e limites por workspace avaliados pelo plano de quem está vendo (`functions/src/webhooks/stripe.ts:97-105`; `src/hooks/usePlan.ts:20-26`). O limite de workspaces conta participações em workspaces de terceiros (`src/components/Header.tsx:58`). Não há `workspaceId` nem checagem de papel no checkout (`functions/src/callables/billing.ts:125-126,143`). GAP: PR-BILL-07.

**DECISION D-01 — entidade pagadora.**

| Opção | Documento canônico | Consequência |
| --- | --- | --- |
| Por workspace (recomendada pela auditoria; o plano mestre registra que simplifica PJ e quotas de membros) | `workspaces/{workspaceId}/billing/subscription` | Quotas de membros, lançamentos e grupos ficam no tenant. Exige regra para o limite de workspaces por titular. |
| Por usuário (modelo atual) | Documento server-owned sob `users/{uid}` | Um member Free num workspace Pro fica limitado pelo próprio plano (BILL-08). |
| Conta de faturamento separada | Coleção de contas pagadoras + vínculo com workspaces | Mais flexível; mais estado a manter consistente. |

Sub-decisões a registrar junto de D-01: quem pode contratar e gerir (só owner, ou owner e admin); como contam workspaces compartilhados e convites pendentes no limite.

**TARGET (supondo a opção por workspace; ajustar o caminho se D-01 decidir outra):**

| Documento | Campos | Escritor | Leitura (Rules) |
| --- | --- | --- | --- |
| `workspaces/{workspaceId}/billing/subscription` | `planKey`, `status`, `priceId`, `stripeCustomerId`, `stripeSubscriptionId`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `trialEnd`, `graceUntil`, `livemode`, `catalogVersion`, `lastEventId`, `lastEventCreated`, `updatedAt` (servidor) | Só o webhook (e o job de reconciliação de P7) | owner/admin; `write: false` |
| `workspaces/{workspaceId}/billing/entitlements` | `planKey`, `status` resumido, limites efetivos, uso corrente, `updatedAt` | Só o backend | Membro ativo; `write: false` |
| `stripe_events/{eventId}` (raiz) | `type`, `created`, `livemode`, `workspaceId`, `outcome`, `processedAt`, `expiresAt` (TTL) | Só o webhook | Nenhuma |
| `billing_customers/{stripeCustomerId}` (raiz) | `workspaceId`, `createdBy`, `createdAt` | Checkout, de forma idempotente | Nenhuma |
| Trilha de auditoria de billing | antes/depois, `event.id` ou ator, `requestId`, timestamp de servidor | Gravador append-only do kernel de P1 (D-ORD-02) | Conforme P1/P7 |

Dois documentos em `billing/` porque as Rules autorizam leitura por documento, não por campo: IDs Stripe não devem chegar a qualquer membro. Os dois precisam de regra explícita: hoje o catch-all de subcoleções concede leitura a qualquer membro para toda coleção fora de `isBackendOwnedCollection` (`firestore.rules:852-877,1436-1442`; o fim do catch-all é PR-RULES-02, em P6). As coleções de raiz ficam negadas por construção, porque as Rules só casam `workspaces/{id}` e `users/{uid}` (`firestore.rules:1-3,990,1456`); o milestone de billing adiciona teste de negação. Ao fechar P2, `planId`, `isPro`, `subscriptionStatus` e `stripe*` saem de `users/{uid}` ([plano mestre §7](PRODUCTION_READINESS_PLAN.md#7-legado-a-remover)).

---

## 5. Máquina de estados alvo

**CURRENT:** só existe o estado `'active'`, gravado no checkout e nunca alterado (`functions/src/webhooks/stripe.ts:105`). Cancelamento, inadimplência, reembolso e disputa mantêm o plano pago indefinidamente. GAP: PR-BILL-01.

**TARGET:** todo status que o Stripe pode produzir tem tratamento definido. Parâmetros comerciais são DECISION D-08.

| Status Stripe | Situação | Entitlement efetivo (TARGET) | Parâmetro (DECISION) |
| --- | --- | --- | --- |
| `incomplete` | Primeira cobrança pendente (ex.: autenticação 3DS) | Nada é concedido; mantém o plano anterior | — |
| `incomplete_expired` | Primeira cobrança não concluída no prazo do Stripe | Plano anterior; assinatura encerrada | — |
| `trialing` | Avaliação | Plano contratado até `trialEnd` | Existência, duração, exigência de cartão, elegibilidade única: D-08 |
| `active` | Em dia | Plano contratado | Proration em upgrade/downgrade: D-08 |
| `past_due` | Renovação falhou; Stripe em retentativa | Plano mantido até `graceUntil`; depois, restrição | Duração do grace period: D-08 |
| `unpaid` | Retentativas esgotadas | Free ou suspensão, sem perda de dados | Estado final: D-08 |
| `canceled` | Encerrada | Free a partir do fim; excedente só leitura | Imediato × fim do período: D-08 |
| `paused` | Pausada | Free enquanto pausada | Uso de pausa: D-08 |

Regras TARGET: upgrade só amplia entitlement após confirmação (pagamento ou `customer.subscription.updated`); downgrade bloqueia novas criações acima da quota e deixa o excedente somente leitura, sem apagar histórico financeiro (princípio 6 do plano mestre); disputa e reembolso têm efeito definido em D-08; toda transição gera registro de auditoria.

---

## 6. Eventos Stripe

| Evento | CURRENT | TARGET |
| --- | --- | --- |
| `checkout.session.completed` | Concede `'pro'` (`functions/src/webhooks/stripe.ts:60-107`) | Confirma o vínculo `billing_customers` ↔ workspace pela metadata definida no servidor; o estado vem da subscription relida pela API |
| `checkout.session.async_payment_succeeded` / `_failed` | Não tratado | Só se D-08 aprovar meios assíncronos (Pix, boleto) |
| `customer.subscription.created` / `updated` | Não tratado | Atualiza o estado canônico a partir da subscription relida; ignora evento com `created` anterior a `lastEventCreated` |
| `customer.subscription.deleted` | Não tratado | `canceled` → Free; histórico preservado |
| `customer.subscription.trial_will_end` | Não tratado | Aviso ao cliente, se D-08 tiver trial |
| `customer.subscription.paused` / `resumed` | Não tratado | Só se D-08 usar pausa |
| `invoice.paid` | Não tratado | `active`; atualiza `currentPeriodEnd`; limpa `graceUntil` |
| `invoice.payment_failed` | Não tratado | `past_due`; define `graceUntil` |
| `invoice.payment_action_required` | Não tratado | Pendência de autenticação comunicada em pt-BR |
| `charge.refunded` | Não tratado | Auditoria; efeito em entitlement conforme D-08 |
| `charge.dispute.created` / `closed` | Não tratado | Auditoria; suspensão conforme D-08 |
| Demais tipos | 2xx sem efeito (`functions/src/webhooks/stripe.ts:110`) | 2xx, registrados em `stripe_events` com `outcome: 'ignored'` |

---

## 7. Processamento alvo do webhook (TARGET)

1. Segredos por `defineSecret`, sem fallback. Segredo ausente ou vazio responde 500, gera log estruturado e não processa (PR-BILL-05). Cliente Stripe criado sob demanda dentro do handler.
2. Remover `cors: true`. Resposta de erro genérica, sem ecoar `error.message` (`functions/src/webhooks/stripe.ts:40,55-56`; BILL-16, FIRE-10).
3. `constructEvent` sobre `req.rawBody` (mantido) e recusa de evento cujo `livemode` difere do esperado para o projeto (BILL-16).
4. Numa transação: `create` de `stripe_events/{event.id}`; se já existir, responde 2xx sem efeito (replay seguro).
5. Resolve o workspace por `billing_customers/{customer}` e confere com `subscription.metadata.workspaceId` gravada pelo servidor. Divergência é registrada e rejeitada.
6. Compara `event.created` com `lastEventCreated`, ou relê a subscription na API antes de aplicar. Entrega fora de ordem não regride o estado.
7. Deriva o estado (§5), grava `billing/subscription`, recalcula `billing/entitlements` e registra auditoria na mesma transação.
8. Responde 2xx só depois do commit. Falha transitória responde 5xx para reentrega do Stripe; falha permanente é registrada sem loop. Fila e replay de falhas e alertas ficam em P7 ([OBSERVABILITY.md](OBSERVABILITY.md), [RUNBOOKS.md](RUNBOOKS.md)).
9. Versão da API mantida fixa no cliente do servidor (`2026-02-25.clover`, `functions/src/webhooks/stripe.ts:12`; `functions/src/callables/billing.ts:11`) e igual à do endpoint configurado (E-06).
10. Um job de reconciliação Stripe × Firestore, com alerta de divergência, entra em P7.

---

## 8. Checkout, Customer Portal e cancelamento (TARGET)

**`createCheckoutSession` (refatorada, P2).** Entrada `{workspaceId, planKey, interval}`. Usa o wrapper de callable do kernel de P1 (autenticação, Zod estrito, IDs sem `/`, mapeador de erros pt-BR, ponto de App Check). Relê membership e papel na transação; o papel autorizado vem de D-01. Mantém allowlist de origem e rate limit (§2). Resolve `priceId` pelo catálogo do ambiente. Cria ou reutiliza um customer por entidade pagadora, em transação e com `Idempotency-Key`. Recusa se já houver assinatura `active`, `trialing`, `past_due` ou `incomplete` e orienta ao Portal. Define `client_reference_id` e `subscription_data.metadata {workspaceId, actorUid}`, `locale: 'pt-BR'`, meios de pagamento conforme D-08 e `success_url` com `{CHECKOUT_SESSION_ID}`. O rate limit hoje chega ao cliente como `internal`, porque `CreditCardApplicationError` não é `HttpsError` (`functions/src/shared/rateLimit.ts:121-126`; `functions/src/creditCards/errors.ts:17`, BILL-12); o mapeador de P1 resolve.

**`createBillingPortalSession` (nova, P2).** Mesmas validações de papel. Usa o customer do mapeamento persistido e `returnUrl` da allowlist. O retorno do Portal não altera estado local; quem altera é o webhook.

**Frontend (mudança mínima, só por contrato alterado):** preços e limites vindos do catálogo do servidor, com rótulos pt-BR (BILL-11); plano atual marcado pelo estado do servidor; um único provider de entitlements com tratamento de erro no lugar dos 4 listeners (BILL-15); links `href="/planos"` trocados por `onNavigate('planos')` (`src/components/RecentTransactions.tsx:132`, `src/components/TransactionsView.tsx:415`, `src/components/SplitGroupsView.tsx:120`, BILL-14); retorno de checkout com estados pendente, ativo e falhou lidos do servidor (PR-COMM-03); seção "Plano e assinatura" com status, próxima cobrança, cancelar e gerenciar pagamento (PR-BILL-02).

**Cancelamento e arrependimento:** executados pelo Portal. O comportamento (fim do período ou imediato) é D-08. A política pública de cancelamento, reembolso e arrependimento e a identificação do fornecedor são PR-COMM-02 (P9), com validação jurídica em E-09 e D-21.

---

## 9. Entitlements e quotas: inventário completo

CURRENT geral: os limites existem só em `src/constants/plans.ts:1-33` e são aplicados por `checkLimit`, uma comparação local (`src/hooks/usePlan.ts:36-38`). O backend não lê `planId` fora da escrita do webhook (`functions/src/webhooks/stripe.ts:98`) e as Rules não aplicam limite de plano. Os rate limits server-side existentes são uniformes e não dependem de plano.

| Recurso | Limite hoje (Free / Pro / Business) | Aplicação CURRENT | Aplicação TARGET | Milestone | GAP |
| --- | --- | --- | --- | --- | --- |
| Workspaces por titular | 1 / 5 / 999 | Só UI, contando participações (`src/components/Header.tsx:58`); criação por `setDoc` do cliente (`src/modules/workspaces/api.ts:196`); Rules sem quota (`firestore.rules:991-994`) | `createWorkspace` (callable de P1, sem verificação de quota) recebe em P2 a verificação da quota dentro da mesma transação, com contador por titular ou entidade pagadora (D-01, D-22) | P2 | PR-ENT-01 (P2→P5), PR-WS-05 |
| Membros por workspace | 2 / 10 / 999 | Nenhuma, nem na UI (`src/components/MembersManagerModal.tsx:60-66`); Rules sem quota (`firestore.rules:1021`) | Callables de convite e aceite (P1) não verificam quota; P2 insere nas mesmas transações a contagem de membros ativos e convites pendentes (D-01) | P2 | PR-ENT-01 (P2→P5), PR-WS-01 |
| Lançamentos por mês | 50 / 1000 / 99999 | Só UI, com duas contagens sobre a janela carregada (`src/components/TransactionsView.tsx:97-116`; `src/components/RecentTransactions.tsx:47-57`); importação em lote sem checagem (`src/App.tsx:276-290`); Rules sem quota (`firestore.rules:1056-1057`) | Callable de lançamento de caixa incrementa `usage` por workspace e mês na mesma transação; D-08 decide se recorrência, empréstimo, recebimento e divisão contam | P3 | PR-ENT-01 (P2→P5), PR-TX-01 |
| Grupos de divisão | 2 / 10 / 999 | Só UI (`src/components/SplitGroupsView.tsx:39`); criação por transação do cliente (`src/modules/split-bills/api.ts:145-147`) | Callable do módulo `splitBills` com contador transacional | P4 | PR-ENT-01 (P2→P5), PR-SPLIT-01 |
| IA: análise | 20/h por workspace+ator, igual para todos | Rate limit fixo (`functions/src/ai/callables.ts:44-48`; `functions/src/shared/rateLimit.ts:49-66`); contornável criando workspaces | Quota por plano e por entidade pagadora, `maxOutputTokens`, registro de uso de tokens; valores em D-11; App Check em P6 (PR-APPCHK-01) | P2 | PR-AI-03 (P2) |
| IA: extração | 60/h por workspace+ator, até ~6 MB por chamada | `functions/src/ai/callables.ts:167-174` | Idem | P2 | PR-AI-03 (P2) |
| Checkout | 10/h por usuário | Server-side, transacional (`functions/src/callables/billing.ts:70-74`) | Mantido; mais bloqueio de assinatura duplicada | P2 | PR-BILL-03 |
| Cartões de crédito | Não existe no catálogo | Nenhuma; cadastro pelo cliente (`firestore.rules:966-973`, CC-14) | Callable de cadastro verifica a quota, se D-08 definir | P4 | PR-ENT-01 (P2→P5), PR-CC-02 |
| Recorrentes | Não existe | Nenhuma (`src/modules/recurring-expenses/api.ts:186-215`, REC-14) | Callable de criação, se D-08 definir | P4 | PR-ENT-01 (P2→P5), PR-REC-01 |
| Empréstimos | Não existe | Nenhuma (`firestore.rules:1351-1359`, LOAN-15) | Callable `createLoan`, se D-08 definir | P3 | PR-ENT-01 (P2→P5), PR-LOAN-01 |
| Clientes e recebíveis | Não existe | Nenhuma; restrição a PJ só na UI (`src/App.tsx:623`; `firestore.rules:1361-1369`, CR-15) | Callables verificam `type === 'PJ'` e a quota, se D-08 definir | P3 | PR-ENT-01 (P2→P5), PR-CR-01 |
| Metas | Não existe | Nenhuma; callables sem quota nem rate limit (`functions/src/goals/callables.ts:44-56`, GOAL-08) | `createGoal` verifica quota de metas ativas por contador | P5 | PR-ENT-01 (P2→P5); GOAL-08 |
| Investimentos | Não existe | Só rate limit por frequência (`functions/src/investments/rateLimits.ts:26-65`, INV-03) | Verificação de entitlement dentro da transação das callables existentes | P5 | PR-ENT-01 (P2→P5); INV-03 |
| Exportação e importação | Não existe | Exportação inexistente; importação conta como lançamento | Rate limit por plano nas operações caras (exportação em P8) | P3 · P8 | PR-ENT-01 (P2→P5), PR-AUTH-01 |

Recursos sem limite no catálogo atual só ganham quota se D-08 a definir; a regra do plano mestre é que quota existente seja aplicada no backend (princípio 9). A ordem segue D-ORD-05: P2 entrega o motor e o enforcement em workspaces, membros, checkout e IA; P3–P5 aplicam a quota em cada callable novo; PR-ENT-01 fecha no fim de P5.

---

## 10. Motor de entitlements e API de quota (TARGET)

- **Função pura** `resolveEntitlements(planKey, status, datas, catalogVersion)` em `functions/src/billing/`, sem I/O e coberta por teste para cada combinação plano × status. O frontend só exibe o resultado.
- **API de quota** para os callables de P3–P5: lê `billing/entitlements` e o contador de uso dentro da transação da criação, incrementa o contador no mesmo commit e nega com `resource-exhausted` e mensagem pt-BR com próxima ação ("Limite do plano atingido. Faça upgrade em Meu Plano."). Contadores em documento server-only por workspace e período (caminho definido em P2 conforme D-01), nunca contagem sobre a lista carregada no cliente.
- **Concorrência:** duas criações simultâneas no limite não ultrapassam a quota (transação com releitura do contador).
- **Downgrade:** nenhuma exclusão; o excedente fica somente leitura e novas criações são negadas.
- **Rules:** cliente sem escrita em plano, status, entitlements, contadores e eventos de billing.

---

## 11. Segredos, configuração e dados enviados ao Stripe

| Item | Estado | Evidência | Classificação |
| --- | --- | --- | --- |
| Segredos declarados por função (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ALLOWED_PRICE_IDS`, `APP_ALLOWED_ORIGINS`) e cobertos por teste de contrato | Existe | `functions/src/callables/billing.ts:90-94`; `functions/src/webhooks/stripe.ts:35-39`; `functions/src/shared/deploymentContract.test.ts:117-143` | CURRENT |
| Fallback literal `sk_test_placeholder` e `whsec_placeholder` | Existe (fail-open) | `functions/src/webhooks/stripe.ts:8-9`; `functions/src/callables/billing.ts:9` | GAP PR-BILL-05 |
| Allowlist de preços e origens guardadas como segredo | Existe | `functions/src/callables/billing.ts:31-49,90-94` | GAP FIRE-10 (TARGET: parâmetros de ambiente) |
| Eventos de log `billing_price_allowlist_missing`, `stripe_webhook_session_without_user`, `stripe_webhook_session_not_paid`, `stripe_webhook_price_not_entitled` em `console.*` | Existe | `functions/src/callables/billing.ts:111`; `functions/src/webhooks/stripe.ts:65,73,87` | CURRENT; alertas em P7 (E-08, PR-OBS-01) |
| Perfil de runtime do webhook | Só `region` e o teto global `maxInstances: 20`; sem `timeoutSeconds`/`memory` explícitos, fora do teste "toda callable declara tempo limite e memória" | `functions/src/webhooks/stripe.ts:31-41`; `functions/src/shared/runtimeOptions.ts:41-44`; `functions/src/shared/deploymentContract.test.ts:89-100` | CURRENT; TARGET: perfil explícito em P2/P6 |
| E-mail do usuário enviado ao Stripe como `customer_email` | Existe | `functions/src/callables/billing.ts:139` | CURRENT; divulgação em [SUBPROCESSORS.md](SUBPROCESSORS.md) e [PRIVACY_LGPD.md](PRIVACY_LGPD.md) (E-09) |
| Dados de cartão | Não trafegam pela aplicação (Checkout hospedado) | `functions/src/callables/billing.ts:136-144` | CURRENT |
| Segredos por projeto, chave restrita no servidor, sem valor vazio | NÃO VERIFICADO | — | EXTERNAL CONFIGURATION REQUIRED (E-05) |

---

## 12. Legado a remover em P2

| Legado | Evidência | Substituto |
| --- | --- | --- |
| Catálogo, limites e `priceId` no frontend | `src/constants/plans.ts:1-33` | Catálogo do backend (§3) |
| `checkLimit` como enforcement e contagens mensais no cliente | `src/hooks/usePlan.ts:36-38`; `src/components/RecentTransactions.tsx:47-57`; `src/components/TransactionsView.tsx:97-116` | API de quota (§10); UI só exibe |
| `planId`/`isPro`/`subscriptionStatus`/`stripe*` em `users/{uid}` | `functions/src/webhooks/stripe.ts:97-106` | Estado canônico (§4) |
| Allowlist plana sem plano associado | `functions/src/callables/billing.ts:31-35`; `functions/src/webhooks/stripe.ts:81-84` | Mapa `priceId → planKey` |
| Fallbacks placeholder | `functions/src/webhooks/stripe.ts:8-9`; `functions/src/callables/billing.ts:9` | `defineSecret` com falha fechada |
| Preço literal e `(plan as any).priceId` | `src/modules/billing/components/PricingTable.tsx:42,48` | Catálogo do servidor |
| Sucesso inferido de `?billing=success` | `src/modules/billing/components/BillingSuccessModal.tsx:9` | Tela que lê o estado no servidor |
| `metadata.priceId` sem uso | `functions/src/callables/billing.ts:143` | `client_reference_id` e `subscription_data.metadata` |
| Métricas de assinatura estáticas no `AdminDashboard` | `src/components/AdminDashboard.tsx:27-62` | Remoção ou agregado server-side (PR-ADMIN-01, P7, D-10) |
| Links `href="/planos"` | `src/components/RecentTransactions.tsx:132` e demais (§8) | `onNavigate('planos')` |

A remoção é provada por busca no código, Rules que negam o caminho antigo e testes (política de legado do plano mestre).

---

## 13. Testes

**CURRENT (existentes):**

- `functions/src/callables/__tests__/billing.test.ts:1-91`: só helpers puros (parsing das allowlists e `isAllowedReturnUrl`).
- `functions/src/shared/deploymentContract.test.ts:117-143`: segredos declarados por `createCheckoutSession` e `stripeWebhook`.
- `tests/firestore/m4-hardening.rules.integration.test.mjs:766-851`: o cliente não grava `planId`, `isPro` nem `stripeCustomerId` e não lê o perfil de outro usuário.
- `functions/src/shared/__tests__/rateLimit.integration.test.ts`: cobre `reserveRateLimit`; `reserveUserRateLimit`, usado pelo checkout, não é testado (a linha 7 importa `reserveRateLimit` e `rateLimitDocumentId`, sem `reserveUserRateLimit`).
- Não há teste de `stripeWebhook`, de `createCheckoutSession` integrado, de quotas, de concorrência no limite nem de `usePlan`/`PricingTable`/`BillingSuccessModal`. GAP PR-BILL-08.

**TARGET (obrigatórios para PASS de P2), todos no Emulator e sem rede, com fixtures assinadas localmente (`stripe.webhooks.generateTestHeaderString`) e asserções sobre o estado persistido:**

1. Unitários: `resolveEntitlements` para cada plano × status; mapa `priceId → planKey` por ambiente; preço desconhecido rejeitado; cálculo de `graceUntil`.
2. Webhook: sem assinatura e assinatura inválida rejeitadas sem efeito; segredo ausente responde 500 sem processar; mesmo `event.id` duas vezes produz um efeito; entrega fora de ordem não regride; `livemode` divergente rejeitado; workspace divergente rejeitado; cada evento da §6 produz a transição da §5.
3. Checkout e Portal: membro sem papel autorizado negado; workspace alheio negado; dois checkouts concorrentes não criam duas assinaturas; assinante ativo é enviado ao Portal; erro de rate limit chega como mensagem pt-BR.
4. Quotas: criação no limite negada; criações concorrentes no limite não ultrapassam; downgrade com excedente segue §10. Um teste por callable que aplica quota em P2–P5.
5. Rules: cliente não lê `billing/subscription` como member, não escreve em `billing/*`, `stripe_events`, `billing_customers` nem contadores. Nova suíte incluída em `test:integration:emulator` e em `predeploy:rules`.
6. UI (skill `ptbr-product-ui-review`): estados de plano, pendente, ativo, falhou e limite atingido em pt-BR.

---

## 14. Registro de evidência de configuração Stripe (E-06)

EXTERNAL CONFIGURATION REQUIRED. Nenhum item pode ser verificado pelo repositório. A conferência é feita por uma pessoa responsável, somente leitura, no Dashboard Stripe. Agentes não acessam o Stripe nem o projeto de produção. Os projetos STAGING e PROD ainda não existem (E-01, D-19), e nada de P1–P5 é implantado em projeto remoto antes do fechamento de P6 (D-ORD-04). Até lá, o webhook é validado só com fixtures no Emulator. O registro é refeito quando o catálogo do código mudar. Sem registro com data e responsável, o gate `billing-entitlement-integrity` é `FAIL` para lançamento.

Itens comuns aos três ambientes, com a coluna de valor esperado valendo para todos:

| # | Item | Valor esperado |
| --- | --- | --- |
| S1 | Conta e modo | DEV e STAGING em modo test; PROD em modo live. Chave live nunca fora de PROD. |
| S2 | Produtos | Um produto por plano pago do catálogo (D-08), IDs registrados no catálogo do ambiente |
| S3 | Preços | Um Price por plano e intervalo, `currency = brl`, `unit_amount` igual ao `amountCents` do catálogo |
| S4 | Endpoint de webhook | URL de `stripeWebhook` em `southamerica-east1` no projeto do próprio ambiente |
| S5 | Eventos habilitados | Os da §6 que D-08 tornar aplicáveis; no mínimo `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.dispute.created` |
| S6 | Versão da API do endpoint | `2026-02-25.clover`, igual à do código |
| S7 | Segredo do endpoint | Guardado como `STRIPE_WEBHOOK_SECRET` no Secret Manager do mesmo projeto (E-05) |
| S8 | Chave do servidor | Restricted key com as permissões mínimas, em `STRIPE_SECRET_KEY` (E-05) |
| S9 | Customer Portal | Cancelamento (modo D-08), troca de plano, atualização de meio de pagamento, histórico de faturas, idioma pt-BR, URL de retorno da allowlist, links de termos e privacidade |
| S10 | Cobrança recorrente | Smart Retries, e-mails de cobrança em pt-BR, ação após a última tentativa (D-08) |
| S11 | Trial | Conforme D-08, ou ausente e comprovado pelo catálogo |
| S12 | Meios de pagamento | Conforme D-08 (hoje só cartão no código) |
| S13 | Impostos e emissão fiscal | Stripe Tax ou emissor de NFS-e conforme D-08 |
| S14 | Dados públicos do negócio | Razão social, e-mail de suporte, descritor da fatura do cartão (D-21) |
| S15 | Alerta de falha de entrega | Notificação de falha do endpoint ativa e ligada ao canal de E-08 |

Estado por ambiente (preencher "Valor conferido", "Data" e "Responsável" na conferência):

| # | DEV: valor conferido | DEV: estado | STAGING: valor conferido | STAGING: estado | PROD: valor conferido | PROD: estado | Data | Responsável |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S2 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S3 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S4 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S5 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S6 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S7 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S8 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S9 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S10 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S11 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S12 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S13 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S14 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |
| S15 | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | NÃO VERIFICADO | — | — |

Relacionados, registrados em outros documentos: segredos por projeto (E-05, [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md)), política de TTL de `stripe_events` (E-07), alertas de webhook e de `billing_price_allowlist_missing` (E-08, [OBSERVABILITY.md](OBSERVABILITY.md)), Stripe como subprocessador e termos de assinatura, cancelamento, reembolso e arrependimento (E-09, [SUBPROCESSORS.md](SUBPROCESSORS.md), [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md)).

---

## 15. Decisões e dependências

| ID | Classificação | O que decide para billing |
| --- | --- | --- |
| D-01 | DECISION (pendente; bloqueia só P2) | Entidade pagadora, caminho do estado canônico, quem contrata e gere, contagem de workspaces compartilhados e convites. Removida das dependências de P1 (§9.1 do plano) |
| D-07 | DECISION | Cancelamento da assinatura e destino do customer Stripe na exclusão de conta ou workspace (executado em P8, PR-AUTH-01) |
| D-08 | DECISION | Planos, preços, intervalos, limites, trial, grace period, proration, downgrade com excedente, reembolso, disputa, meios de pagamento, fiscal |
| D-11 | DECISION | Quotas de IA por plano e tier do provedor |
| D-16 | DECISION (tomada, §9.1 do plano) | Somente BRL; o catálogo alvo usa BRL |
| D-21 | DECISION | Identificação do fornecedor e canal de suporte exibidos no Stripe e no produto |
| D-22 | DECISION (tomada, §9.1 do plano) | Workspaces PF e PJ podem ter membros; CNPJ opcional e não único |
| D-ORD-04 | DECISION (tomada, §9 do plano) | Nenhum artefato de P2 é implantado em projeto remoto antes de P6 |
| D-ORD-05 | DECISION (tomada, §9 do plano) | Ordem incremental de PR-ENT-01 (§9) |

Dependências: P1 entrega as callables de workspace e membership, sem verificação de quota, e o kernel (wrapper, resolvedor de papel, auditoria, logger, módulo `money`); P2 insere a verificação de quota nas transações de `createWorkspace`, `inviteWorkspaceMember` e `acceptWorkspaceInvite` antes de qualquer deploy remoto (D-01, D-ORD-04); P6 entrega ambientes isolados, segredos por ambiente e App Check nas callables de billing e IA; P7 entrega alertas, fila e replay de webhook, reconciliação e runbook ([RUNBOOKS.md](RUNBOOKS.md)); P8 cancela a assinatura na saída do titular; P9 publica preços a partir do catálogo e as políticas comerciais.

---

## 16. Registro de GAPs do tema

| ID | Sev. | Milestone | Lacuna | Seção |
| --- | --- | --- | --- | --- |
| PR-BILL-01 | BLOCKER | P2 | Ciclo de vida ausente; plano nunca revogado | §5, §6 |
| PR-BILL-02 | BLOCKER | P2 | Sem Customer Portal nem cancelamento | §8 |
| PR-BILL-03 | BLOCKER | P2 | Assinatura duplicada; sem escopo de workspace (inclui BILL-09) | §2, §8 |
| PR-BILL-04 | BLOCKER | P2 | Catálogo inconsistente (C02; inclui MONEY-12) | §3 |
| PR-BILL-05 | HIGH | P2 | Segredos com fallback placeholder (inclui ENTRY-04, FIRE-10) | §7, §11 |
| PR-BILL-06 | HIGH | P2 | Sem idempotência por `event.id`, ordem e auditoria (inclui BILL-16) | §7 |
| PR-BILL-07 | HIGH | P2 | Entitlement por usuário, campos concorrentes, sem RBAC | §4 |
| PR-BILL-08 | HIGH | P2 | Sem testes de comportamento (inclui REL-08) | §13 |
| PR-ENT-01 | BLOCKER | P2 (fecha em P5) | Quotas só no frontend | §9, §10 |
| PR-AI-03 | HIGH | P2 | Custo de IA sem teto por plano | §9 |
| PR-COMM-02 | BLOCKER | P9 | Política de cancelamento/arrependimento e identificação do fornecedor | §8 |
| PR-COMM-03 | HIGH | P9 | Modal de pagamento aprovado sem confirmação (inclui BILL-10, COMM-04) | §2, §8 |
| PR-AUTH-01 | BLOCKER | P8 | Saída do titular sem cancelar a assinatura | §15 |
| PR-ADMIN-01 | HIGH | P7 | Métricas de assinatura estáticas no painel admin | §12 |
| BILL-11 | MEDIUM | P2 | Textos de billing em pt-PT e chaves internas visíveis (ver também COMM-08) | §3, §8 |
| BILL-12 | MEDIUM | P2 | Erro de rate limit do checkout chega como `internal` | §8 |
| BILL-14 | LOW | P2 | Links de upgrade recarregam a página e caem no dashboard | §8 |
| BILL-15 | LOW | P2 | `usePlan` com um listener por consumidor e sem tratamento de erro | §2, §8 |

Os itens BLOCKER/HIGH seguem o [registro do plano mestre](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers); só saem de lá com evidência e gate `PASS` registrados na §15 do plano.
