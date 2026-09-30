# Billing, assinatura e entitlements

Referência do programa de Production Readiness para cobrança Stripe, catálogo de planos, estado de assinatura, entitlements e quotas do Minhas Finanças. Registra o estado após a etapa P2A (2026-09-29, sobre o working tree derivado do HEAD `main` @ `9c3ab46`) e a P2B.1 (2026-09-30, sobre `ecd3f11`), o alvo que resta e as lacunas, sempre com os IDs do [plano mestre](PRODUCTION_READINESS_PLAN.md). Este documento **não prova implementação**: antes de agir, confirme o código no HEAD. O gate do tema é a skill `billing-entitlement-integrity`, executada com `multi-tenant-security-review` (quem pode contratar e isolamento) e `saas-commercial-readiness` (o que é exibido e prometido ao cliente). A §14 é o registro de evidência de configuração Stripe (E-06) exigido pela skill.

- **Milestone responsável:** P2 ([plano mestre §8](PRODUCTION_READINESS_PLAN.md#8-milestones)). P2A (catálogo, estado canônico, checkout, portal, webhook, Rules e frontend) está concluída ([§17 do plano](PRODUCTION_READINESS_PLAN.md#17-p2a--execução-e-evidências)); P2B.1 (quotas de workspaces e membros, reservas de convite, transferência de ownership, entitlement do workspace pelo owner) está concluída (PLAN §17.8, 2026-09-30); P2B.2 (créditos de IA por plano do owner, idempotência, teto de saída por chamada) está concluída (PLAN §17.9, 2026-09-30). O gate de P2 é P2C. O enforcement de quotas fecha de forma incremental até P5 (D-ORD-05, [§9](PRODUCTION_READINESS_PLAN.md#9-decisões-de-ordenação-e-escopo-tomadas-em-p0)).
- **Decisões:** D-01 e D-08 (parcial) tomadas em [§9.2 do plano](PRODUCTION_READINESS_PLAN.md#92-decisões-de-produto-tomadas-para-p2); D-07 (exclusão de conta, P8) e D-11 (provedor de IA, P5) não bloqueiam P2.
- **Configuração externa:** E-05 (segredos por ambiente), E-06 (Stripe), E-08 (alertas), E-09 (jurídico).

---

## 1. Resumo

| Tema | CURRENT (pós-P2A) | TARGET restante | GAP |
| --- | --- | --- | --- |
| Catálogo | Canônico e versionado no backend (`BILLING_CATALOG_VERSION = 1`), em centavos BRL, mensal, sem trial; `getBillingCatalog` não expõe `priceId` (`functions/src/billing/catalog.ts:16,50,64-104,135`; `functions/src/billing/callables.ts:45`) | Suporte a Prices legados por plano antes de qualquer mudança de preço (D-08) | PR-BILL-04 fechado (PLAN §17.3) |
| Checkout | `createCheckoutSession` `{planId, returnUrl, idempotencyKey}`: Price conferido no Stripe, lock por titular, Customer canônico, recusa de assinatura viva, idempotência (`functions/src/billing/checkout.ts:206,417`) | Conferência do Stripe real (E-06) | PR-BILL-03 fechado (PLAN §17.3) |
| Portal | `createBillingPortalSession` só para o próprio titular (`functions/src/billing/portal.ts:44`) | Configuração do portal no Stripe (E-06) | PR-BILL-02 fechado (PLAN §17.3) |
| Webhook | `stripeWebhook` com assinatura sobre o raw body, recibo por `event.id` (`processing` → `processed`), estado relido no Stripe fora de transação sob lease com geração (P2A.1), 13 tipos de evento e auditoria (`functions/src/webhooks/stripe.ts:26`; `functions/src/billing/webhook.ts:178,401,575,718`) | Reconciliação periódica Stripe × Firestore, fila/replay e alertas (P7) | PR-BILL-01, PR-BILL-06 fechados (PLAN §17.3) |
| Estado canônico | `billing_accounts/{uid}` server-owned, uid = titular (D-01); leitura só do titular; o perfil `users/{uid}` não tem plano. Entitlement do workspace pelo plano do owner via `getWorkspaceEntitlement` (projeção pública, sem ler billing alheio no cliente) (`functions/src/billing/model.ts:29-32,97-118`; `functions/src/billing/workspaceEntitlement.ts:38`; `firestore.rules:1418-1437`) | — | PR-BILL-07 fechado em P2B.1 (PLAN §17.8) |
| Segredos | Secret Manager por função, sem valor padrão, falha fechada; `STRIPE_ALLOWED_PRICE_IDS` removida (`functions/src/billing/config.ts:18-49,72-112`) | Configuração não secreta como parâmetro de ambiente (P6) | PR-BILL-05 fechado (PLAN §17.3); FIRE-10 (P6) |
| Quotas | API de quota `functions/src/billing/quota.ts` aplicada nas transações de conta, workspace, convite, aceite, remoção, saída e transferência (§10) e na admissão de IA (P2B.2); estado `quota_state`, `ai_usage` (do titular) e `ai_usage_receipts` (do ator, `users/{uid}`) backend-only; no cliente, `checkAccountLimit`/`checkWorkspaceLimit` são só ajuda de UX (`src/modules/billing/BillingContext.tsx`) | Lançamentos, grupos e demais domínios em P3–P5 | PR-ENT-01 (parcial) |
| Custo de IA | **P2B.2:** teto mensal `aiCreditsPerMonth` do plano efetivo do **titular** (pool compartilhado por todos os workspaces dele), consumido na mesma transação da autorização, do recibo de idempotência e do rate limit horário; provedor chamado só depois do commit; `maxOutputTokens` 1200 (análise) / 600 (extração) (`functions/src/ai/admission.ts`; `functions/src/ai/policy.ts`) | App Check (P6, PR-APPCHK-01); provedor e tier (P5, D-11) | PR-AI-03 fechado em P2B.2 (PLAN §17.9) |
| Testes | Unitários, integração no Emulator (checkout, webhook, quota com concorrência no último slot, créditos de IA com provedor falso), Rules e cliente (§13) | Quota dos domínios de P3–P5 | PR-BILL-08 fechado (PLAN §17.3) |

---

## 2. Fluxo atual de checkout e webhook

| # | Passo | Evidência | Classificação |
| --- | --- | --- | --- |
| 1 | O usuário autenticado abre "Meu Plano" (view `planos`); a tabela de preços só existe dentro do app. | `src/components/Sidebar.tsx:100-103`; `src/App.tsx:651` | CURRENT |
| 2 | `PricingTable` lê o catálogo do servidor (`getBillingCatalog`) e o documento canônico do titular pelo provider único; exibe preços por `formatCentsBRL`, estados de carregamento e erro do catálogo e "Gerenciar assinatura" para assinante. | `src/modules/billing/BillingContext.tsx:35,58`; `src/modules/billing/components/PricingTable.tsx:32,77,99-101` | CURRENT |
| 3 | `useBillingActions.startCheckout` envia `{planId, returnUrl: window.location.origin, idempotencyKey}` (chave gerada no cliente por tentativa); o cliente nunca envia `priceId`. | `src/modules/billing/hooks.ts:17,46-50`; `src/modules/billing/callables.ts:33-46` | CURRENT |
| 4 | A callable usa o wrapper do kernel (autenticação, Zod estrito, mapeador de erros pt-BR), valida `returnUrl` contra as origens exatas de `APP_ALLOWED_ORIGINS` e confere no Stripe que o Price do plano é ativo, recorrente mensal, em BRL, com valor igual ao do catálogo e do mesmo modo (test/live) da chave; qualquer divergência falha fechado. | `functions/src/billing/callables.ts:52`; `functions/src/billing/checkout.ts:161-187,417` | CURRENT |
| 5 | Reserva transacional: idempotência do kernel em `users/{uid}/idempotency_keys`, conta ativa, recusa de assinatura viva, lock `pendingCheckout` (lease de 90 s) e rate limit de 10/h por titular. | `functions/src/billing/checkout.ts:73,80,206-260` | CURRENT |
| 6 | No Stripe: Customer canônico criado com `Idempotency-Key` (e-mail só se verificado) e vínculo reverso `billing_customers` gravado na mesma transação; recusa de assinatura viva ainda não refletida; expiração de outras sessões abertas (sessão já concluída ⇒ recusa); sessão criada com `Idempotency-Key` derivada do hash da chave e expiração fixada, `client_reference_id`, `metadata`, `subscription_data.metadata.billingOwnerUid`, `locale pt-BR` e só cartão. | `functions/src/billing/checkout.ts:278-310,321-340,442-460`; `functions/src/billing/stripeGateway.ts:250-275` | CURRENT |
| 7 | O commit final grava o lock `open`, o resultado idempotente e o evento `checkout.created`. Nenhum checkout concede entitlement. | `functions/src/billing/checkout.ts:346-380` | CURRENT |
| 8 | No retorno (`?billing=success`), `BillingSuccessModal` não afirma pagamento: mostra "Confirmando seu pagamento", "Pagamento confirmado!" só quando o documento canônico mostra plano pago ativo, ou "Pagamento em processamento" após 90 s. O retorno cancelado não é tratado. | `src/modules/billing/components/BillingSuccessModal.tsx:8,15,40,50` | CURRENT · GAP PR-COMM-03 (P9, tratamento do retorno cancelado e disclosure) |
| 9 | `stripeWebhook` (`onRequest`, sem CORS, 60 s, 256 MiB, `maxInstances` 10) exige `stripe-signature` e verifica com `constructEvent` sobre o raw body; assinatura ausente ou inválida ⇒ 400 sem efeito e sem ecoar erro do SDK; segredo ou Price ausente ou inválido ⇒ 500 sem processar; evento de outro modo ⇒ 400. | `functions/src/webhooks/stripe.ts:26-65`; `functions/src/billing/webhook.ts:480-522`; `functions/src/shared/runtimeOptions.ts:84-89` | CURRENT |
| 10 | Recibo `billing_webhook_events/{event.id}`: `processing` no claim e `processed` só no commit do efeito; o conteúdo do evento nunca é aplicado: as assinaturas do customer são relidas no Stripe **fora de transação**, sob o lease do titular, e o commit, que exige a geração do lease, grava o estado atual em `billing_accounts/{uid}` com a trilha `billing_events` (P2A.1). | `functions/src/billing/webhook.ts:401-510,513-523,575-658,718-752` | CURRENT |
| 11 | O portal (`createBillingPortalSession`) cria a URL no servidor para o `stripeCustomerId` do próprio titular; o retorno não altera estado local. | `functions/src/billing/portal.ts:44-81` | CURRENT |
| 12 | As Rules: o titular ativo faz `get` do próprio `billing_accounts/{uid}`; sem `list`, leitura cruzada ou escrita do cliente; subcoleção, vínculo e recibos negados nos dois sentidos. O perfil `users/{uid}` é `write: false` e sem plano. Testes no Emulator. | `firestore.rules:1371-1431`; `tests/firestore/billing-p2.rules.integration.test.mjs:122-189`; `tests/firestore/m4-hardening.rules.integration.test.mjs:1001` | CURRENT |

---

## 3. Catálogo canônico (D-08; alegação C02 fechada)

Fonte: `functions/src/billing/catalog.ts` (`BILLING_CATALOG_VERSION = 1`). Valores em centavos BRL, cobrança mensal, sem trial (o plano Free substitui o trial). Limites: workspaces próprios ativos / membros ativos por workspace (incluindo o owner) / lançamentos por mês / grupos de divisão / créditos de IA por mês.

| Plano (`planId`) | Nome | `amountCents` | Workspaces | Membros | Lançamentos/mês | Grupos | Créditos de IA/mês | Concessão |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `free` | Gratuito | 0 | 1 | 2 | 50 | 2 | 10 | Padrão: sem assinatura, cancelada ou expirada |
| `pro` | Pro | 2990 | 5 | 10 | 1.000 | 10 | 150 | Só pelo Price configurado em `STRIPE_PRICE_PRO_MONTHLY` |
| `business` | Business | 5990 | 20 | 50 | 10.000 | 100 | 750 | Só pelo Price configurado em `STRIPE_PRICE_BUSINESS_MONTHLY` |

Evidência: `functions/src/billing/catalog.ts:16,50-56,64-104`.

- `BILLING_POLICY`: moeda `brl`, intervalo `month`, `trialDays: 0`, `pastDueGraceDays: 7`, cancelamento `period_end` (`functions/src/billing/catalog.ts:50-60`). Não existem 999 nem 99999 no catálogo.
- `publicBillingCatalog()` devolve `catalogVersion`, moeda e planos (nome, preço, intervalo e limites) sem `priceId` nem `rank`; é o que `getBillingCatalog` entrega ao cliente (`functions/src/billing/catalog.ts:135`; `functions/src/billing/callables.ts:45`).
- O `priceId` de cada plano pago é configuração do ambiente (`STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_BUSINESS_MONTHLY`). Pro e Business com o mesmo Price é configuração inválida (`functions/src/billing/config.ts:96-112`). A concessão só ocorre por Price da configuração (`planIdForPrice`, `functions/src/billing/config.ts:117`): Price desconhecido nunca concede.
- **Mudança de preço:** exige novo Price no Stripe e nova versão do catálogo. Como a concessão usa só o Price configurado, trocar a configuração tira o plano de quem está no Price antigo. Por isso o catálogo v1 não muda de preço até existir suporte a Prices legados por plano (D-08).
- O valor efetivamente cobrado vive no Stripe: **NÃO VERIFICADO** (E-06). O checkout confere o Price no Stripe antes de cada sessão (`functions/src/billing/checkout.ts:161-187`), o que detecta divergência de valor no momento da compra, mas não substitui a conferência da §14.

---

## 4. Estado canônico da assinatura

**Decisão D-01 (tomada em 2026-09-29, [§9.2 do plano](PRODUCTION_READINESS_PLAN.md#92-decisões-de-produto-tomadas-para-p2)):** a assinatura pertence à conta do owner. O owner financia os workspaces de que é owner; o convidado não precisa de plano pago; o plano do owner determina os entitlements do workspace. A transferência de ownership respeitará a capacidade do novo owner (enforcement em P2B). Só o titular contrata e gere a própria assinatura.

**CURRENT:** o estado vive em `billing_accounts/{uid}`, com uid = titular (`billingOwnerUid`). O perfil `users/{uid}` não tem plano nem campos Stripe (`isPro`, `planId` e `stripe*` foram removidos). O `bootstrapAccount` cria o documento Free na mesma transação, de forma idempotente e sem sobrescrever estado existente (`functions/src/workspaces/lifecycle.ts:125,146,176`; `functions/src/billing/model.ts:139,166`).

| Documento | Campos | Escritor | Leitura (Rules) |
| --- | --- | --- | --- |
| `billing_accounts/{uid}` | `billingOwnerUid`, `catalogVersion`, `planId` (efetivo na última avaliação), `entitlementStatus` (`free`\|`active`\|`grace`\|`restricted`\|`pending`), `subscriptionStatus` (`none` + 8 status Stripe), `graceUntil`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `cancelAt`, `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId`, `pendingCheckout` (lock), `lastStripeEventId`, `lastStripeEventType`, `stripeSyncedAt`, `createdAt`, `updatedAt` (`functions/src/billing/model.ts:97-118`) | Só o backend: `bootstrapAccount`, checkout e webhook | `get` do próprio titular ativo; sem `list`, sem leitura cruzada; `write: false` (`firestore.rules:1412-1414`) |
| `billing_customers/{stripeCustomerId}` | Vínculo reverso customer → titular (`billingOwnerUid`, `livemode`), criado na mesma transação que grava `stripeCustomerId` na conta | Só o checkout | Negada nos dois sentidos (`firestore.rules:1424-1426`) |
| `billing_webhook_events/{eventId}` | Recibo idempotente sem payload: `id`, `type`, `livemode`, `stripeCreatedAt`, `billingOwnerUid`, `status` (`processing`\|`processed`; só `processed` encerra o evento), `outcome` (`applied`\|`recorded`\|`ignored`\|`rejected`; `null` em `processing`), `reason`, `processedAt`, `expiresAt`; em `processing`, também `generation` e `claimedAt` (TTL de 90 dias: `functions/src/shared/retention.ts:53`; override em `firestore.indexes.json:858-861`) | Só o webhook | Negada nos dois sentidos (`firestore.rules:1428-1430`) |
| `billing_accounts/{uid}/billing_events/{id}` | Trilha append-only de auditoria (tipos na §6), sem TTL | Só o backend (`functions/src/billing/audit.ts:64`) | Negada nos dois sentidos (`firestore.rules:1416-1421`) |
| `billing_accounts/{uid}/billing_sync/reconciliation` | Lease da reconciliação do titular (P2A.1): `generation` (fencing token monotônico), `holderEventId`, `leaseExpiresAt` (60 s), `acquiredAt`, `updatedAt`; um documento por titular, sem TTL (`functions/src/billing/model.ts:134-163`) | Só o webhook | Negada nos dois sentidos (`firestore.rules:1416-1421`) |

Consequências: o cliente lê só o próprio `billing_accounts/{uid}`; um membro que não é o owner **não** lê o billing do owner. Desde P2B.1 o plano do workspace chega ao cliente por `getWorkspaceEntitlement` (owner canônico + `effectiveEntitlement` no servidor; resposta só com `catalogVersion`, `planId`, `entitlementStatus` e `limits`), e a ajuda de UX dos recursos do workspace usa esse plano (PR-BILL-07 fechado, PLAN §17.8). Não há estado de billing por workspace; o único estado por workspace é a quota de membros (§10).

---

## 5. Máquina de estados

**CURRENT:** todo status que o Stripe pode produzir tem tratamento definido em `resolveEntitlement` (função pura, sem I/O) e a reavaliação por relógio do servidor está em `effectiveEntitlement` (`functions/src/billing/entitlements.ts:71,131`). Parâmetros decididos em D-01/D-08: sem trial, cancelamento no fim do período, grace de 7 dias, sem reembolso automático.

| Status Stripe | `entitlementStatus` / plano efetivo | Parâmetro |
| --- | --- | --- |
| Sem assinatura (`none`), `canceled`, `incomplete_expired` | `free` / Free | — |
| `incomplete` | `pending` / Free: nada é concedido até a confirmação | — |
| `trialing` | `active` / plano do Price | O catálogo não tem trial (`trialDays: 0`); o status é tratado como `active` se o Stripe o produzir |
| `active` | `active` / plano do Price; Free após o fim agendado (`cancel_at`, ou fim do período com `cancel_at_period_end`) | Cancelamento no fim do período pago |
| `past_due` | `grace` / plano do Price até `graceUntil`; depois `restricted` (plano efetivo `free`); Free se o fim agendado já passou | Grace de 7 dias, ancorado na finalização da fatura que falhou e sem avançar no mesmo episódio (`functions/src/billing/reconcile.ts:147-200`) |
| `unpaid` | `restricted` / plano efetivo `free` | — |
| `paused` | `restricted` / plano efetivo `free` | — |
| Price desconhecido, quantidade ≠ 1 ou mais de 1 item | Nunca concede plano; a anomalia é auditada (`functions/src/billing/reconcile.ts:61-91`) | — |

Regras: upgrade só amplia entitlement depois que o estado lido do Stripe pelo webhook mostra a assinatura paga; o checkout nunca concede. Downgrade nunca apaga dados: o excedente bloqueia só novas operações sujeitas à quota (enforcement em P2B). Reembolso e disputa só são registrados, sem mudar entitlement. Toda transição gera registro de auditoria (§6). Proration e momento do downgrade configurados no portal seguem pendentes em D-08 (P9/E-06).

---

## 6. Eventos Stripe

Roteamento em `functions/src/billing/webhook.ts:132-230`; reconciliação em `functions/src/billing/reconcile.ts:147-200`; transições auditadas em `functions/src/billing/reconcile.ts:231-326`.

| Evento | Tratamento (CURRENT) |
| --- | --- |
| `checkout.session.completed` | Só `mode: subscription`; resolve o titular por `billing_customers`, confere com `stripeCustomerId` da conta e com `client_reference_id`/`metadata.billingOwnerUid`; o estado vem das assinaturas relidas no Stripe, não da sessão; limpa o lock `pendingCheckout` da sessão |
| `customer.subscription.created` / `updated` / `deleted` / `paused` / `resumed` | Reconciliam o estado a partir das assinaturas relidas; auditam `subscription.linked`, `billing.state_changed`, `cancellation.scheduled/reverted`, `subscription.canceled`, `grace.started/ended` conforme a transição |
| `invoice.paid` | Reconcilia e audita `payment.succeeded` |
| `invoice.payment_succeeded` | Só reconcilia (mesmo pagamento de `invoice.paid`, sem auditar duas vezes) |
| `invoice.payment_failed` | Reconcilia (`past_due` ⇒ grace) e audita `payment.failed` |
| `invoice.payment_action_required` | Reconcilia e audita `payment.action_required` |
| `charge.refunded` | Só registra `refund.received`; não muda entitlement |
| `charge.dispute.created` / `closed` | Só registram `dispute.received` / `dispute.closed`; não mudam entitlement (o customer é resolvido pela cobrança) |
| Demais tipos e sessões que não são de assinatura | Recibo `ignored`, resposta 200 sem efeito |
| Evento sem customer, customer sem vínculo ou titular divergente | Recibo `rejected` (ou `ignored` sem customer) e, na divergência, evento `anomaly.detected` |

Auditoria (`billing_accounts/{uid}/billing_events`): `checkout.created`, `subscription.linked`, `billing.state_changed`, `grace.started`, `grace.ended`, `cancellation.scheduled`, `cancellation.reverted`, `subscription.canceled`, `payment.succeeded`, `payment.failed`, `payment.action_required`, `refund.received`, `dispute.received`, `dispute.closed`, `anomaly.detected` (`functions/src/billing/audit.ts:24-40`). Os registros não guardam payload do Stripe, e-mail, cartão nem segredo. `checkout.session.async_payment_*` e `customer.subscription.trial_will_end` não são tratados (só cartão e sem trial).

---

## 7. Processamento do webhook e estratégia de ordem

1. **Configuração:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` e os Prices vêm do Secret Manager, sem valor padrão; ausente, vazio ou fora do formato ⇒ 500 com log estruturado (só os nomes) e nada é processado (`functions/src/webhooks/stripe.ts:38-50`; `functions/src/billing/config.ts:72-112`).
2. **Endpoint:** sem CORS; respostas de erro genéricas, sem ecoar erro do SDK (`functions/src/billing/webhook.ts:486-504`).
3. **Assinatura e modo:** `constructEvent` sobre o raw body; evento cujo `livemode` difere do da chave ⇒ 400 (`functions/src/billing/webhook.ts:493-511`).
4. **Idempotência:** recibo `billing_webhook_events/{event.id}` `processed` ⇒ 200 sem efeito, sem Stripe e sem escrita. O recibo `processed` é gravado no mesmo commit do efeito; `processing` nunca vale como processado e é retomado pela reentrega (`functions/src/billing/webhook.ts:401-510,575-658`).
5. **Titular:** resolvido por `billing_customers/{customer}`, conferido com o `stripeCustomerId` da conta e com a metadata do checkout; divergência ⇒ rejeitado, com recibo e anomalia (`functions/src/billing/webhook.ts:336-383`).
6. **Ordem (P2A.1):** o conteúdo do evento nunca é aplicado e nenhuma chamada ao Stripe acontece dentro de transação do Firestore. O claim (transação curta) adquire o lease `billing_accounts/{uid}/billing_sync/reconciliation` com geração nova e validade de 60 s; a leitura do Stripe (lista paginada e assinatura referenciada por ID) acontece fora de transação; o commit relê recibo, conta e lease e só aplica com a mesma geração (fencing token). Assim os commits seguem a ordem das leituras, e um evento antigo ou uma leitura atrasada não regride o estado. Lease ocupado ⇒ espera curta (cerca de 8,5 s) e, esgotada, 500 para reentrega; erro antes do commit libera o lease; queda deixa o lease vencer e a reentrega assume com geração nova (`functions/src/billing/webhook.ts:92-101,401-510,575-752`).
7. **Estado derivado:** assinatura canônica (a viva de maior prioridade, depois plano, depois recência; duplicidade é anomalia), plano só por Price com 1 item e quantidade 1, grace ancorado na fatura que falhou (`functions/src/billing/reconcile.ts:93-200`). Auditoria e recibo na mesma transação.
8. **Resposta:** 200 só depois do commit; falha transitória ⇒ 500 para reentrega do Stripe (`functions/src/billing/webhook.ts:512-521`). Fila e replay de falhas e alertas ficam em P7 ([OBSERVABILITY.md](OBSERVABILITY.md), [RUNBOOKS.md](RUNBOOKS.md)).
9. **Versão da API:** fixa no cliente do servidor (`2026-02-25.clover`, `functions/src/billing/stripeGateway.ts:20`) e igual à do endpoint configurado (E-06).
10. **Reconciliação periódica** Stripe × Firestore, com alerta de divergência, entra em P7.

---

## 8. Checkout, Customer Portal e cancelamento

**`createCheckoutSession` (CURRENT).** Entrada `{planId: 'pro' | 'business', returnUrl, idempotencyKey}` (Zod estrito, sem `priceId`, uid, customer nem status: `functions/src/billing/contracts.ts:17-22`). Usa o wrapper de callable do kernel de P1. Só o próprio titular (uid da sessão), com conta ativa. Resolve o Price pelo plano na configuração do ambiente e o confere no Stripe. Reserva transacional com idempotência, lock `pendingCheckout` (lease de 90 s) e rate limit de 10/h; recusa assinatura viva, inclusive a ainda não refletida no Firestore (releitura no Stripe); cria ou reutiliza o Customer canônico com `Idempotency-Key` (e-mail enviado só se verificado) e vínculo reverso; expira outras sessões abertas do mesmo Customer; cria a sessão com `client_reference_id`, `metadata`, `subscription_data.metadata.billingOwnerUid`, `locale pt-BR` e só cartão. O erro de rate limit chega como `ApplicationError` mapeado pelo kernel, com mensagem pt-BR (`functions/src/shared/rateLimit.ts:121-126`). Evidência: `functions/src/billing/checkout.ts:73-80,161-187,206-260,278-310,321-380,417-489`.

**`createBillingPortalSession` (CURRENT).** Entrada `{returnUrl}`. Só o próprio titular com conta ativa; exige `stripeCustomerId` (senão "Você ainda não tem uma assinatura para gerenciar."); `returnUrl` da allowlist; rate limit de 20/h; URL criada no servidor. O retorno do portal não altera estado local; quem altera é o webhook (`functions/src/billing/portal.ts:31-81`).

**Frontend (mudança mínima, só por contrato alterado):** provider único `BillingProvider` com listener do documento canônico e catálogo por callable, com tratamento de erro no lugar dos 4 listeners antigos; `PricingTable` com preços e limites do catálogo em pt-BR, sem chaves internas, "Plano Gratuito" e "Gerenciar assinatura"; `BillingSuccessModal` com estados confirmando, confirmado e em processamento lidos do servidor; ações em `useBillingActions` com mensagens pt-BR (`src/modules/billing/BillingContext.tsx:42`; `src/modules/billing/components/PricingTable.tsx:32-101`; `src/modules/billing/components/BillingSuccessModal.tsx:8-50`; `src/modules/billing/hooks.ts:17-58`). O `BillingProvider` fica abaixo do `WorkspaceProvider` e só inicia catálogo e listener depois que o `bootstrapAccount` do usuário atual conclui (`isAccountReady`, P2A.1: `src/App.tsx:706-708`; `src/contexts/WorkspaceContext.tsx:115,217`; `src/modules/billing/BillingContext.tsx:44-51`). Layout, classes e identidade preservados. **Ainda aberto:** os links `href="/planos"` recarregam a página e caem no dashboard (`src/components/RecentTransactions.tsx:132`, `src/components/TransactionsView.tsx:415`, `src/components/SplitGroupsView.tsx:120`, BILL-14) e a seção "Plano e assinatura" dentro de Configurações não existe (a gestão é pelo botão da tabela de planos).

**Cancelamento e arrependimento:** o cancelamento é feito no Customer Portal e vale no fim do período pago (D-08). A política pública de cancelamento, reembolso e arrependimento e a identificação do fornecedor são PR-COMM-02 (P9), com validação jurídica em E-09 e D-21. Não há reembolso automático em P2.

---

## 9. Entitlements e quotas: inventário completo

CURRENT geral (pós-P2B.2): os limites vivem no catálogo do backend (§3); workspaces próprios, membros, transferência de ownership e créditos mensais de IA são aplicados no servidor (§10). Lançamentos e grupos seguem só como ajuda de UX no cliente, agora pelo plano do owner do workspace (`checkWorkspaceLimit`), até P3/P4. Os rate limits server-side existentes são uniformes e não dependem de plano. A coluna "Aplicação CURRENT" descreve o HEAD auditado `9c3ab46` (referências a `usePlan`/`plans.ts` são históricas, removidas em P2A); a coluna de limites mostra o catálogo v1 (Free / Pro / Business).

| Recurso | Limite (catálogo v1: Free / Pro / Business) | Aplicação CURRENT | Aplicação TARGET | Milestone | GAP |
| --- | --- | --- | --- | --- | --- |
| Workspaces próprios ativos por titular (owner) | 1 / 5 / 20 | **P2B.1:** contador `activeOwnedWorkspaces` na transação de `bootstrapAccount`, `createWorkspace`, `archiveWorkspace` e `transferWorkspaceOwnership` (`functions/src/workspaces/lifecycle.ts:168-191,288-319,470-504`); UI compara workspaces próprios com o plano da conta (`getAccountUsage`, só UX) | Mantido | P2B.1 (entregue) | — |
| Membros ativos por workspace (incl. owner) | 2 / 10 / 50 | **P2B.1:** `activeMembers` + reservas de convite vigentes na transação de convite, revogação, aceite, remoção, saída e transferência (`functions/src/workspaces/memberships.ts`) | Mantido | P2B.1 (entregue) | — |
| Lançamentos por mês | 50 / 1.000 / 10.000 | Só UI, com duas contagens sobre a janela carregada (`src/components/TransactionsView.tsx:97-116`; `src/components/RecentTransactions.tsx:47-57`); importação em lote sem checagem (`src/App.tsx:276-290`); Rules sem quota (`firestore.rules:1056-1057`) | Callable de lançamento de caixa incrementa `usage` por workspace e mês na mesma transação; D-08 decide se recorrência, empréstimo, recebimento e divisão contam | P3 | PR-ENT-01 (P2→P5), PR-TX-01 |
| Grupos de divisão | 2 / 10 / 100 | Só UI (`src/components/SplitGroupsView.tsx:39`); criação por transação do cliente (`src/modules/split-bills/api.ts:145-147`) | Callable do módulo `splitBills` com contador transacional | P4 | PR-ENT-01 (P2→P5), PR-SPLIT-01 |
| IA: análise | Créditos por mês 10 / 150 / 750 (pool do titular); 1 crédito por chamada; rate limit de 20/h por workspace+ator; `maxOutputTokens` 1200 | **P2B.2:** admissão atômica pelo plano efetivo do owner canônico (`functions/src/ai/admission.ts`); criar workspaces não contorna o teto, que é do titular | Contabilização real de tokens e provedor/tier (P5, D-11); App Check (P6, PR-APPCHK-01) | P2B.2 (entregue) | PR-AI-03 fechado |
| IA: extração | Mesmo pool mensal; 1 crédito por chamada (texto ou documento); rate limit de 60/h por workspace+ator; até ~6 MB por documento; `maxOutputTokens` 600 | **P2B.2:** mesma admissão (`functions/src/ai/callables.ts`, `createAiCallables`) | Idem | P2B.2 (entregue) | PR-AI-03 fechado |
| Checkout | 10/h por titular | Server-side, transacional (`functions/src/billing/checkout.ts:73,206`), com bloqueio de assinatura duplicada (P2A) | Mantido | P2A (entregue) | PR-BILL-03 fechado |
| Cartões de crédito | Não existe no catálogo | Nenhuma; cadastro pelo cliente (`firestore.rules:966-973`, CC-14) | Callable de cadastro verifica a quota, se D-08 definir | P4 | PR-ENT-01 (P2→P5), PR-CC-02 |
| Recorrentes | Não existe | Nenhuma (`src/modules/recurring-expenses/api.ts:186-215`, REC-14) | Callable de criação, se D-08 definir | P4 | PR-ENT-01 (P2→P5), PR-REC-01 |
| Empréstimos | Não existe | Nenhuma (`firestore.rules:1351-1359`, LOAN-15) | Callable `createLoan`, se D-08 definir | P3 | PR-ENT-01 (P2→P5), PR-LOAN-01 |
| Clientes e recebíveis | Não existe | Nenhuma; restrição a PJ só na UI (`src/App.tsx:623`; `firestore.rules:1361-1369`, CR-15) | Callables verificam `type === 'PJ'` e a quota, se D-08 definir | P3 | PR-ENT-01 (P2→P5), PR-CR-01 |
| Metas | Não existe | Nenhuma; callables sem quota nem rate limit (`functions/src/goals/callables.ts:44-56`, GOAL-08) | `createGoal` verifica quota de metas ativas por contador | P5 | PR-ENT-01 (P2→P5); GOAL-08 |
| Investimentos | Não existe | Só rate limit por frequência (`functions/src/investments/rateLimits.ts:26-65`, INV-03) | Verificação de entitlement dentro da transação das callables existentes | P5 | PR-ENT-01 (P2→P5); INV-03 |
| Exportação e importação | Não existe | Exportação inexistente; importação conta como lançamento | Rate limit por plano nas operações caras (exportação em P8) | P3 · P8 | PR-ENT-01 (P2→P5), PR-AUTH-01 |

Recursos sem limite no catálogo atual só ganham quota se D-08 a definir; a regra do plano mestre é que quota existente seja aplicada no backend (princípio 9). A ordem segue D-ORD-05: P2A entregou o motor; P2B entregou o enforcement em workspaces, membros e transferência de ownership (P2B.1) e em IA (P2B.2), lendo o plano do owner (D-01); P3–P5 aplicam a quota em cada callable novo; PR-ENT-01 fecha no fim de P5.

---

## 10. Motor de entitlements e API de quota

**Entregue em P2A (CURRENT):**

- **Função pura** `resolveEntitlement(termos, agora)` em `functions/src/billing/entitlements.ts:71`, sem I/O, coberta por teste para cada status (`functions/src/billing/__tests__/billing.test.ts:218-291`). O frontend só exibe o resultado (`src/modules/billing/entitlement.ts:9`).
- **Reavaliação** `effectiveEntitlement(conta, agora)` (`functions/src/billing/entitlements.ts:131`): o grace e o cancelamento no fim do período vencem sem evento novo do Stripe, então o valor gravado vale só até esses instantes; quem decide acesso chama esta função com o relógio do servidor. `effectiveLimits` (`:157`) devolve os limites do catálogo para o entitlement efetivo. Esta é a API que a quota de P2B consome.
- **Downgrade:** nenhuma exclusão; o estado apenas passa a refletir o plano efetivo.
- **Rules:** o cliente não tem escrita em plano, status, entitlement nem eventos de billing (`firestore.rules:1412-1431`).

**Entregue em P2B.1 (CURRENT, 2026-09-30; detalhes e evidências em [PLAN §17.8](PRODUCTION_READINESS_PLAN.md#178-p2b1--quotas-de-workspaces-e-membros-transferência-e-entitlement-do-workspace-2026-09-30)):**

- **API de quota** `functions/src/billing/quota.ts`: `entitlementAt(billing, agora)` (sempre `effectiveEntitlement`, nunca `planId` cru), `assertWithinQuota`, owner canônico (`ownerId` só vale com membership `active`/`owner`; divergência falha fechado, sem varredura), leitura/gravação dos contadores. Tudo dentro da transação autoritativa já existente.
- **Schema (server-only, `schemaVersion` 1):** `billing_accounts/{ownerUid}/quota_state/ownership` (`billingOwnerUid`, `activeOwnedWorkspaces`, `updatedAt`) e `workspaces/{workspaceId}/quota_state/membership` (`workspaceId`, `activeMembers` incluindo o owner, `pendingReservations` `inviteId → expiresAt`, `updatedAt`). Nascem na mesma transação que cria a conta ou o workspace. Sem migração, varredura ou fallback: estado ausente ou malformado ⇒ `internal` ("Não foi possível verificar os limites do plano. Tente novamente em instantes."); ambientes anteriores a P2B.1 são recriados por seed.
- **Reservas de convite:** cada convite pendente ocupa uma vaga até o mesmo `expiresAt` do convite; o convite exige `ativos + reservas vigentes + 1 <= membersPerWorkspace`; substituir o convite do mesmo e-mail não consome vaga extra; revogação e aceite liberam a reserva no mesmo commit; reservas vencidas saem na próxima operação que regrava o documento (sem cron). O mapa é limitado a 50 (maior `membersPerWorkspace` do catálogo).
- **Aplicação:** `bootstrapAccount` (1 na primeira preparação; restauração do pessoal consome slot), `createWorkspace` (`ativos < workspaces`), `archiveWorkspace` (sempre permitido; libera o slot só na transição), `inviteWorkspaceMember`, `revokeWorkspaceInvite`, `acceptWorkspaceInvite` (plano **atual** do owner; `ativos < membersPerWorkspace`), `removeWorkspaceMember`/`leaveWorkspace` (liberam a vaga), `transferWorkspaceOwnership` (o destino precisa de mais um workspace próprio e da ocupação atual, com reservas vigentes, no plano efetivo dele; a origem pode estar acima da quota). Troca de papel não altera quota.
- **Erro:** `quota_exceeded` → `resource-exhausted`, "Limite do plano atingido. Faça upgrade em Meu Plano para continuar.", detalhes só `resource`, `planId`, `limit`, `used`. Na transferência, mensagem voltada ao destinatário ("O plano do novo titular não comporta este espaço. Para receber a titularidade, ele precisa fazer upgrade em Meu Plano.") e detalhe só `resource`, sem dados da conta de outra pessoa.
- **Concorrência:** criações, convites, aceites e transferências simultâneos no último slot disputam o mesmo documento de contador; só um vence (testado).
- **Downgrade com excedente:** novas criações e aceites acima da quota são negados; nada é apagado nem arquivado; arquivar reduz o excedente.
- **Entitlement do workspace:** `getWorkspaceEntitlement` (qualquer membro ativo) e `getAccountUsage` (uso da própria conta), só leitura (§4).

**Entregue em P2B.2 (CURRENT, 2026-09-30; detalhes e evidências em [PLAN §17.9](PRODUCTION_READINESS_PLAN.md#179-p2b2--créditos-de-ia-por-plano-do-owner-idempotência-e-teto-por-chamada-2026-09-30)):**

- **Pool por billing owner:** o teto mensal `aiCreditsPerMonth` (Free 10, Pro 150, Business 750) é do titular e é compartilhado por todos os workspaces de que ele é owner e por todos os membros autorizados deles. O pagador é o owner canônico lido na transação; depois de uma transferência, os usos seguintes consomem o pool do novo owner. Nenhum pool por executor ou por workspace.
- **Custo por operação:** `AI_CREDIT_COSTS` em `functions/src/ai/policy.ts` — análise, extração de texto e extração de documento custam 1 crédito cada. Os pesos existem só no servidor (nem na projeção pública do catálogo nem no cliente); uma versão futura do catálogo muda os pesos ali.
- **Período:** mês civil de `America/Sao_Paulo` (`saoPauloMonthKey`). Documento novo a cada `YYYY-MM`; sem cron de reset, sem varredura de meses anteriores, sem contador em memória. Meses passados não são regravados.
- **Schema (server-only, `schemaVersion` 1):** `billing_accounts/{ownerUid}/ai_usage/{YYYY-MM}` (`billingOwnerUid`, `monthKey`, `usedCredits`, `schemaVersion`, `updatedAt`; ausente = 0; sem TTL nesta etapa, ciclo de vida em P8) e `users/{actorUid}/ai_usage_receipts/{receiptId}` (`operation`, `actorId`, `workspaceId`, `billingOwnerUid` debitado, `monthKey`, `creditCost`, `requestHash`, `createdAt`, `expiresAt` com TTL de 90 dias em `firestore.indexes.json`). O **uso** é do billing owner (o crédito pertence ao titular); o **recibo** é do ator (a chave de idempotência pertence à intenção de quem a enviou) e continua encontrável depois de troca de plano ou de transferência do workspace. Não há outro caminho de recibo: o inicial, sob `billing_accounts`, foi removido no hardening final, sem migração nem fallback. O recibo nunca guarda pergunta, transcrição, documento, prompt, resposta ou JSON extraído; `receiptId` é hash de ator + chave, e `requestHash` é o SHA-256 da operação e do payload validado, salgado pela própria chave.
- **Admissão atômica** (`functions/src/ai/admission.ts`): numa única transação, relê a autorização do ator, resolve o owner canônico e confirma o membership `owner` ativo, lê o recibo da chave (sob o ator, avaliado primeiro), o billing do titular (`effectiveEntitlement` no relógio do servidor), o uso do mês e o rate limit horário (um `getAll`), e exige `usados + custo <= limite`; grava o contador do owner, o recibo do ator e o rate limit no mesmo commit. Recusa (papel, owner incoerente, chave repetida, rate limit, quota) não grava nada — nem o rate limit. O último crédito disputado por membros de workspaces diferentes do mesmo titular serializa no documento mensal: só uma chamada vence.
- **Idempotência:** `idempotencyKey` obrigatória nos dois contratos (schema compartilhado `idempotencyKeySchema`); o cliente gera uma chave nova por ação intencional. Mesma chave e mesmo conteúdo → "Esta solicitação de IA já foi processada…" (`failed-precondition`), sem novo crédito e sem nova chamada ao provedor; outro conteúdo → conflito (`failed-precondition`); chamadas concorrentes com a mesma chave → no máximo um consumo e uma chamada externa, inclusive em workspaces de owners diferentes. A mesma chave continua idempotente através de transferência de ownership: não debita o owner novo nem de novo o antigo e não chama o provedor; uma chave nova depois da transferência consome o pool do novo owner. A resposta não é guardada para replay (conteúdo pessoal; P5/P8).
- **Política de cobrança:** o crédito representa uma tentativa aceita e enviada ao provedor. Falhas anteriores ao commit (contrato, autenticação, papel, segredo ausente, owner incoerente, rate limit, quota, contenção) não consomem. Depois do commit, timeout, 4xx/5xx, resposta vazia ou JSON inválido **não** devolvem o crédito — teto comercial real sobre tentativas externas, sem fluxo compensatório. Sem reembolso de crédito nesta etapa.
- **Custo por chamada:** `maxOutputTokens` 1200 na análise e 600 na extração (`AI_MAX_OUTPUT_TOKENS`), com o mesmo provedor e modelo; limites de entrada inalterados (pergunta 2.000, transcrição 4.000, documento ~6 MB em base64). O provedor é chamado por um gateway mínimo (`functions/src/ai/gateway.ts`), sempre fora de transação. Créditos continuam provider-agnostic (D-11); contabilização real de tokens não é feita nesta etapa.
- **Downgrade, upgrade e grace:** o uso nunca é apagado; com `usados >= novo limite` as novas chamadas são recusadas; o upgrade libera até o novo teto; em `past_due` dentro do grace vale o limite pago.
- **Erro:** `quota_exceeded` → `resource-exhausted`, "Os créditos de IA deste plano acabaram neste mês. Faça upgrade ou aguarde a renovação mensal.", detalhes só `resource` (`aiCreditsPerMonth`), `planId`, `limit`, `used`, `periodKey` — nada do titular.
- **Consulta:** `getAccountUsage` devolve, só para o próprio titular, `aiCreditsUsed`, `aiCreditsLimit`, `aiCreditsRemaining` e `aiPeriodKey` pelo billing efetivo da própria conta. `getWorkspaceEntitlement` não expõe uso de IA (um membro inferiria o uso de outros workspaces do titular). Sem contador visual nesta etapa.

**TARGET restante:** quotas de lançamentos (P3), grupos de divisão e demais domínios (P3–P5), fechando PR-ENT-01 no fim de P5 (D-ORD-05). IA: App Check (P6, PR-APPCHK-01), provedor/tier e schema da saída (P5, D-11, PR-AI-05), histórico fora do localStorage (P5, PR-AI-04), base legal e transparência (P8, PR-AI-01).

---

## 11. Segredos, configuração e dados enviados ao Stripe

| Item | Estado | Evidência | Classificação |
| --- | --- | --- | --- |
| Configuração por Secret Manager declarada em `secrets` de cada função (padrão atual; `defineSecret` não é usado): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_BUSINESS_MONTHLY`, `APP_ALLOWED_ORIGINS`. Contrato: `createCheckoutSession` (chave, os dois Prices e origens), `createBillingPortalSession` (chave e origens), `getBillingCatalog` (nenhum), `stripeWebhook` (chave, segredo do webhook e os dois Prices) | Existe, coberto por teste de contrato | `functions/src/billing/config.ts:18-45`; `functions/src/shared/deploymentContract.test.ts:125-150` | CURRENT |
| Sem valor padrão: ausente, vazio ou fora do formato falha fechada; `sk_test_placeholder` e `whsec_placeholder` são recusados pelo comprimento mínimo; Pro = Business é inválido; o modo live/test é derivado da chave e eventos de outro modo são recusados (400) | Existe | `functions/src/billing/config.ts:47-49,72-112`; `functions/src/billing/webhook.ts:507-511`; `functions/src/billing/__tests__/billing.test.ts:117-167` | CURRENT (PR-BILL-05 fechado) |
| `STRIPE_ALLOWED_PRICE_IDS` (allowlist plana sem plano associado) | Removida; ausência assertada | `functions/src/shared/deploymentContract.test.ts:127,147` | CURRENT |
| Allowlist de origens de retorno guardada como segredo (`APP_ALLOWED_ORIGINS`) | Existe | `functions/src/billing/config.ts:128-158` | GAP FIRE-10 (TARGET: parâmetro de ambiente, P6) |
| Logs estruturados de billing (`billing.config_missing`, `billing.price_mismatch`, `billing_webhook.*`) sem valores de segredo nem payload | Existe | `functions/src/webhooks/stripe.ts:48`; `functions/src/billing/checkout.ts:161-187`; `functions/src/billing/webhook.ts:486-521` | CURRENT; alertas em P7 (E-08, PR-OBS-01) |
| Perfil de runtime do webhook: `region`, 60 s, 256 MiB, `maxInstances` 10 | Existe | `functions/src/shared/runtimeOptions.ts:84-89` | CURRENT |
| E-mail do usuário enviado ao Stripe ao criar o Customer, só se `email_verified`; `preferred_locales: ['pt-BR']` | Existe | `functions/src/billing/checkout.ts:278-281`; `functions/src/billing/stripeGateway.ts:216-217` | CURRENT; divulgação em [SUBPROCESSORS.md](SUBPROCESSORS.md) e [PRIVACY_LGPD.md](PRIVACY_LGPD.md) (E-09) |
| Dados de cartão | Não trafegam pela aplicação (Checkout hospedado, só cartão) | `functions/src/billing/stripeGateway.ts:262` | CURRENT |
| Segredos por projeto, chave restrita no servidor, sem valor vazio | NÃO VERIFICADO | — | EXTERNAL CONFIGURATION REQUIRED (E-05) |

---

## 12. Legado removido em P2A

Removido no mesmo milestone que substituiu a arquitetura (política de legado do plano mestre). Prova por busca em 2026-09-29, sem ocorrências em `src/`, `functions/src/`, `tests/`, `e2e/` e `firestore.rules`, salvo as asserções negativas indicadas ([PLAN §17.3](PRODUCTION_READINESS_PLAN.md#173-blockers-fechados)).

| Legado | Estado | Substituto |
| --- | --- | --- |
| `src/constants/plans.ts` (catálogo, limites e `priceId` no frontend) | Removido; guarda de ausência em `tests/unit/billing-client.test.ts:226-245` | Catálogo do backend (§3) |
| `src/hooks/usePlan.ts` (um listener por consumidor, sem tratamento de erro) | Removido | `BillingProvider` único (§8) |
| `functions/src/callables/billing.ts` e seu teste (checkout por `priceId` do cliente, allowlist plana, fallbacks) | Removidos | `functions/src/billing/` (§3 a §8) |
| `planId`/`isPro`/`subscriptionStatus`/`stripe*` em `users/{uid}` | Removidos; o teste de Rules nega a escrita (`tests/firestore/m4-hardening.rules.integration.test.mjs:1001`) | `billing_accounts/{uid}` (§4) |
| Webhook que concedia sempre `pro` só para `checkout.session.completed` | Removido | `functions/src/billing/webhook.ts` (§6, §7) |
| Fallbacks `sk_test_placeholder` e `whsec_placeholder`; `STRIPE_ALLOWED_PRICE_IDS` | Removidos; só em testes negativos | Configuração sem padrão (§11) |
| Preço literal `29,90` e `(plan as any).priceId` em `PricingTable` | Removidos | Catálogo do servidor (`formatCentsBRL`) |
| Sucesso inferido de `?billing=success` | Removido | `BillingSuccessModal` lê o estado canônico (§8) |
| `metadata.priceId` sem uso | Removido | `client_reference_id`, `metadata` e `subscription_data.metadata.billingOwnerUid` |

**Ainda a remover (fora de P2A):**

| Legado | Evidência | Substituto |
| --- | --- | --- |
| `checkLimit` como única aplicação de limite e contagens mensais no cliente (agora só ajuda de UX) | `src/modules/billing/BillingContext.tsx:82`; `src/components/RecentTransactions.tsx:57`; `src/components/TransactionsView.tsx:116` | API de quota (§10, P2B); a UI só exibe |
| Métricas de assinatura estáticas no `AdminDashboard` | `src/components/AdminDashboard.tsx:27-62` | Remoção ou agregado server-side (PR-ADMIN-01, P7, D-10) |
| Links `href="/planos"` | `src/components/RecentTransactions.tsx:132`, `src/components/TransactionsView.tsx:415`, `src/components/SplitGroupsView.tsx:120` | `onNavigate('planos')` (BILL-14) |

---

## 13. Testes

**CURRENT (2026-09-29, Emulator `minhas-financas-local`, Stripe falso, sem rede nem credenciais):**

| Suíte | Escopo | Resultado |
| --- | --- | --- |
| `functions/src/billing/__tests__/billing.test.ts` (22) + contrato de deploy | Catálogo, configuração falha fechada e placeholders, Price → plano, `returnUrl` por origem, `resolveEntitlement` por status, reavaliação por relógio, assinatura canônica, grace, transições auditadas, normalização do SDK | 34/34; unitários das Functions 351/351 |
| `functions/src/billing/__tests__/checkout.integration.test.ts` (20) | Bootstrap Free idempotente e concorrente, `planId` sem `priceId`, Customer canônico reutilizado, idempotência por chave e concorrente, checkouts concorrentes sem duas assinaturas, assinatura viva (Firestore e Stripe) bloqueia, sessão anterior expirada, Price divergente falha fechado, `returnUrl` fora da allowlist, falha no Stripe libera o lock, conta suspensa, rate limit por titular, portal sem customer e portal válido | 36/36 com o webhook; 111/111 com workspaces e kernel |
| `functions/src/billing/__tests__/webhook.integration.test.ts` (16) | Assinatura ausente/inválida, segredo ausente ⇒ 500, outro modo, vínculo da assinatura, evento repetido, fora de ordem, eventos concorrentes, upgrade Pro → Business, grace e regularização, cancelamento no fim do período, `unpaid`/`incomplete`/`canceled`, reembolso e disputa sem mudar entitlement, customer/titular divergente, Price desconhecido, evento ignorado, falha transitória ⇒ 500 e reenvio | idem |
| `tests/firestore/billing-p2.rules.integration.test.mjs` (`test:rules:billing`, em `test:integration:emulator` e `predeploy:rules`) | Titular lê o próprio billing; leitura cruzada, anônima e de conta suspensa negadas; sem `list`; cliente nunca cria/altera/apaga; trilha, vínculo e recibos backend-only | 5/5 |
| `tests/firestore/m4-hardening.rules.integration.test.mjs` | Teste INV-P1-013 migrado para `billing_accounts`; o cliente não concede plano | 36/36 |
| `tests/unit/billing-client.test.ts` (`test:unit:billing`, em `verify:fast` e no CI: `.github/workflows/quality-gate.yml:77-78`) | Contrato das callables, checkout sem `priceId` e com chave nova por chamada, exibição de entitlement, ausência do plano legado e de preço fixo | 14/14 |

Também: typecheck, build do frontend e build das Functions OK; lint das Functions com 0 erros. Instabilidade registrada: uma falha do teste de bootstrap concorrente em 11 execuções, sob carga do Emulator ([PLAN §17.2](PRODUCTION_READINESS_PLAN.md#172-validação-2026-09-29)). `verify:all`, E2E e `regression-release-gate` não foram executados nesta etapa.

**P2B.1 (2026-09-30):** `functions/src/billing/__tests__/quotaWorkspaces.integration.test.ts` e `quotaMembers.integration.test.ts` (limites Free/Pro/Business, último slot concorrente em criação, convite, aceite, transferência e bootstrap, replay, arquivamento, downgrade com excedente, grace e cancelamento vencidos, estado ausente, reservas, transferência com e sem capacidade, entitlement do workspace por papel e cross-tenant) — 132/132 com workspaces, checkout e webhook; Rules de `quota_state` em `billing-p2.rules` (7/7); cliente `test:unit:billing` 21/21. Detalhes em [PLAN §17.8](PRODUCTION_READINESS_PLAN.md#178-p2b1--quotas-de-workspaces-e-membros-transferência-e-entitlement-do-workspace-2026-09-30).

**P2B.2 (2026-09-30):** `functions/src/ai/__tests__/aiCredits.integration.test.ts` (28, provedor falso sem rede e sonda que recusa chamada externa dentro de transação: tetos Free/Pro/Business, pool do owner para membros e entre workspaces, outro owner, transferência, último crédito concorrente, downgrade/upgrade/grace, virada de mês em São Paulo, idempotência concorrente, reenvio e conflito, **mesma chave através da transferência** — recusa idempotente sem debitar o owner novo nem de novo o antigo e sem chamar o provedor; conflito com outro conteúdo; chave nova consome o owner novo; mesma chave disputada em workspaces de owners diferentes —, recibo do ator sem conteúdo com TTL, rate limit no mesmo commit, provedor só depois do commit, `maxOutputTokens`, falhas do provedor sem devolução, falhas antes do commit sem consumo, `getAccountUsage`) — com `quotaWorkspaces`, 3/3 rodadas de 44/44 no hardening final; Rules do uso do titular e dos recibos do ator em `billing-p2.rules` (9/9); cliente `test:unit:billing` 31/31 (`tests/unit/ai-client.test.ts`, inclusive a leitura do comprovante aguardada até o fim da chamada). Detalhes em [PLAN §17.9](PRODUCTION_READINESS_PLAN.md#179-p2b2--créditos-de-ia-por-plano-do-owner-idempotência-e-teto-por-chamada-2026-09-30).

**TARGET restante:**

1. Um teste por callable que aplica quota em P3–P5.
2. UI (skill `ptbr-product-ui-review`): estados de limite atingido em pt-BR, no gate de P2.

---

## 14. Registro de evidência de configuração Stripe (E-06)

EXTERNAL CONFIGURATION REQUIRED. Nenhum item pode ser verificado pelo repositório. A conferência é feita por uma pessoa responsável, somente leitura, no Dashboard Stripe. Agentes não acessam o Stripe nem o projeto de produção. Os projetos STAGING e PROD ainda não existem (E-01, D-19), e nada de P1–P5 é implantado em projeto remoto antes do fechamento de P6 (D-ORD-04). Até lá, checkout, portal e webhook são validados no Emulator com Stripe falso e eventos assinados localmente (sem rede nem credenciais). O registro é refeito quando o catálogo do código mudar. Sem registro com data e responsável, o gate `billing-entitlement-integrity` é `FAIL` para lançamento.

Itens comuns aos três ambientes, com a coluna de valor esperado valendo para todos:

| # | Item | Valor esperado |
| --- | --- | --- |
| S1 | Conta e modo | DEV e STAGING em modo test; PROD em modo live. Chave live nunca fora de PROD. |
| S2 | Produtos | Um produto por plano pago do catálogo (Pro e Business); os IDs de Price (não os de produto) vão em `STRIPE_PRICE_PRO_MONTHLY` e `STRIPE_PRICE_BUSINESS_MONTHLY` |
| S3 | Preços | Um Price mensal por plano pago, ativo, recorrente, `currency = brl`; `unit_amount` 2990 (Pro) e 5990 (Business), iguais ao `amountCents` do catálogo (`functions/src/billing/catalog.ts:79,93`); IDs distintos em `STRIPE_PRICE_PRO_MONTHLY` e `STRIPE_PRICE_BUSINESS_MONTHLY`, do mesmo modo (test/live) da chave |
| S4 | Endpoint de webhook | URL de `stripeWebhook` em `southamerica-east1` no projeto do próprio ambiente |
| S5 | Eventos habilitados | Os tratados pelo código (§6): `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Os demais são recebidos e registrados como `ignored` |
| S6 | Versão da API do endpoint | `2026-02-25.clover`, igual à do código |
| S7 | Segredo do endpoint | Guardado como `STRIPE_WEBHOOK_SECRET` no Secret Manager do mesmo projeto (E-05) |
| S8 | Chave do servidor | Restricted key com as permissões mínimas, em `STRIPE_SECRET_KEY` (E-05) |
| S9 | Customer Portal | Cancelamento no fim do período; troca entre Pro e Business só pelos Prices configurados; atualização de meio de pagamento; histórico de faturas; idioma pt-BR; URL de retorno da allowlist; links de termos e privacidade. Proration e momento do downgrade seguem pendentes em D-08 |
| S10 | Cobrança recorrente | Smart Retries, e-mails de cobrança em pt-BR, ação após a última tentativa (D-08). O grace de 7 dias do produto conta a partir da fatura que falhou (§5) |
| S11 | Trial | Sem trial (`trialDays: 0`, D-08): nenhum Price com período de teste |
| S12 | Meios de pagamento | Só cartão (`payment_method_types: ['card']`, `functions/src/billing/stripeGateway.ts:262`); outros meios pendentes em D-08 |
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

Relacionados, registrados em outros documentos: segredos por projeto (E-05, [FIREBASE_PRODUCTION.md](FIREBASE_PRODUCTION.md)), política de TTL de `billing_webhook_events` (E-07), alertas de webhook e de `billing.config_missing` (E-08, [OBSERVABILITY.md](OBSERVABILITY.md)), Stripe como subprocessador e termos de assinatura, cancelamento, reembolso e arrependimento (E-09, [SUBPROCESSORS.md](SUBPROCESSORS.md), [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md)).

---

## 15. Decisões e dependências

| ID | Classificação | O que decide para billing |
| --- | --- | --- |
| D-01 | DECISION (tomada, §9.2 do plano) | A assinatura pertence à conta do owner (`billing_accounts/{uid}`); o owner financia os workspaces de que é owner; o convidado não precisa de plano pago; o plano do owner determina os entitlements do workspace; a transferência de ownership respeita a capacidade do novo owner (aplicado em P2B.1, PLAN §17.8) |
| D-07 | DECISION (não bloqueia P2; bloqueia P8) | Cancelamento da assinatura e destino do customer Stripe na exclusão de conta ou workspace (executado em P8, PR-AUTH-01) |
| D-08 | DECISION (parcialmente tomada, §9.2 do plano) | Tomado: catálogo v1, mensal, sem trial, cancelamento no fim do período, grace de 7 dias, downgrade sem apagar dados, sem reembolso automático em P2. Pendente (P9/E-06): tratamento fiscal (NFS-e/ISS, Stripe Tax), meios além de cartão, plano anual, proration e momento do downgrade no portal, suporte a Prices legados por plano |
| D-11 | DECISION (não bloqueia P2; bloqueia P5, P8) | Créditos de IA provider-agnostic no catálogo; provedor e tier do provedor em P5 |
| D-16 | DECISION (tomada, §9.1 do plano) | Somente BRL; o catálogo usa BRL |
| D-21 | DECISION | Identificação do fornecedor e canal de suporte exibidos no Stripe e no produto |
| D-22 | DECISION (tomada, §9.1 do plano) | Workspaces PF e PJ podem ter membros; CNPJ opcional e não único |
| D-ORD-04 | DECISION (tomada, §9 do plano) | Nenhum artefato de P2 é implantado em projeto remoto antes de P6 |
| D-ORD-05 | DECISION (tomada, §9 do plano) | Ordem incremental de PR-ENT-01 (§9) |

Dependências: P1 entregou as callables de workspace e membership, sem verificação de quota, e o kernel (wrapper, resolvedor de papel, auditoria, logger, módulo `money`); P2A entregou o billing canônico e o motor de entitlements; P2B.1 inseriu a verificação de quota nas transações de `createWorkspace`, `inviteWorkspaceMember`, `acceptWorkspaceInvite` e na transferência de ownership, antes de qualquer deploy remoto (D-01, D-ORD-04); P2B.2 acrescenta os créditos de IA; P6 entrega ambientes isolados, segredos por ambiente e App Check nas callables de billing e IA; P7 entrega alertas, fila e replay de webhook, reconciliação e runbook ([RUNBOOKS.md](RUNBOOKS.md)); P8 cancela a assinatura na saída do titular; P9 publica preços a partir do catálogo e as políticas comerciais.

---

## 16. Registro de GAPs do tema

| ID | Sev. | Milestone | Lacuna | Estado |
| --- | --- | --- | --- | --- |
| PR-BILL-01 | BLOCKER | P2 | Ciclo de vida ausente; plano nunca revogado | Fechado em P2A ([PLAN §17.3](PRODUCTION_READINESS_PLAN.md#173-blockers-fechados)); §5, §6 |
| PR-BILL-02 | BLOCKER | P2 | Sem Customer Portal nem cancelamento | Fechado em P2A; §8 |
| PR-BILL-03 | BLOCKER | P2 | Assinatura duplicada (inclui BILL-09); o escopo por workspace foi substituído por D-01 | Fechado em P2A; §2, §8 |
| PR-BILL-04 | BLOCKER | P2 | Catálogo inconsistente (C02; inclui MONEY-12) | Fechado em P2A; §3 |
| PR-BILL-05 | HIGH | P2 | Segredos com fallback placeholder (inclui ENTRY-04) | Fechado em P2A (falha fechada); FIRE-10 segue em P6; §7, §11 |
| PR-BILL-06 | HIGH | P2 | Sem idempotência por `event.id`, ordem e auditoria (inclui BILL-16) | Fechado em P2A; §7 |
| PR-BILL-07 | HIGH | P2 (P2B) | Entitlement do workspace ainda não derivado do plano do owner: a ajuda de UX lê o billing de quem está vendo; membro não lê o billing do owner. Campos concorrentes e plano em `users/{uid}` removidos em P2A | Fechado em P2B.1 (`getWorkspaceEntitlement`, PLAN §17.8); §4 |
| PR-BILL-08 | HIGH | P2 | Sem testes de comportamento (inclui REL-08) | Fechado em P2A; §13 |
| PR-ENT-01 | BLOCKER | P2 (fecha em P5) | Quotas só no frontend | Aberto (parcial): motor em P2A; workspaces, membros e transferência aplicados em P2B.1; demais domínios em P3–P5; §9, §10 |
| PR-AI-03 | HIGH | P2 (P2B) | Custo de IA sem teto por plano | Fechado em P2B.2 (PLAN §17.9): teto mensal do titular, idempotência por chave, `maxOutputTokens`; App Check segue em PR-APPCHK-01 (P6); §9, §10 |
| E-06 | Externa | P2 | Configuração Stripe (Prices, endpoint, eventos, portal) | Sem conferência; obrigatória para fechar P2 (§14) |
| PR-COMM-02 | BLOCKER | P9 | Política de cancelamento/arrependimento e identificação do fornecedor | Aberto; §8 |
| PR-COMM-03 | HIGH | P9 | Retorno do checkout: o modal já lê o estado do servidor; falta tratar o retorno cancelado e o disclosure comercial (inclui BILL-10, COMM-04) | Parcial em P2A; §2, §8 |
| PR-AUTH-01 | BLOCKER | P8 | Saída do titular sem cancelar a assinatura | Aberto; §15 |
| PR-ADMIN-01 | HIGH | P7 | Métricas de assinatura estáticas no painel admin | Aberto; §12 |
| BILL-11 | MEDIUM | P2 | Textos de billing em pt-PT e chaves internas visíveis (ver também COMM-08) | Corrigido em P2A na tabela de preços, no modal e nas ações de billing; §3, §8 |
| BILL-12 | MEDIUM | P2 | Erro de rate limit do checkout chegava como `internal` | Corrigido: `ApplicationError` mapeado pelo kernel, com mensagem pt-BR (`functions/src/shared/rateLimit.ts:121-126`); §8 |
| BILL-14 | LOW | P2 | Links de upgrade recarregam a página e caem no dashboard | Aberto; §8, §12 |
| BILL-15 | LOW | P2 | `usePlan` com um listener por consumidor e sem tratamento de erro | Corrigido em P2A: `BillingProvider` único (§8) |

Os itens BLOCKER/HIGH seguem o [registro do plano mestre](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers); só saem de lá com evidência registrada na §17 e na §15 do plano. O `regression-release-gate` de P2 ainda não foi executado.
