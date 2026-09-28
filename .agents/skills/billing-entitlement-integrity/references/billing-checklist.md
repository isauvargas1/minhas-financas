# Checklist de integridade de billing e entitlements

Aplicar cada item a todo caminho afetado. Citar implementação, Rules, configuração versionada e testes separadamente.

## 1. Catálogo e fonte de verdade de preços

- Existe uma única fonte versionada do catálogo: plano interno → produto Stripe → preço Stripe por ambiente (test/live) → valor em centavos inteiros → moeda (`brl`) → intervalo → entitlements.
- Frontend exibe preços e limites a partir dessa fonte (ou de endpoint do backend derivado dela). Valores literais divergentes em componentes, constantes, docs ou testes são `FAIL`.
- IDs de preço live nunca aparecem em DEV/STAGING; IDs de test nunca em PROD. A seleção do ID por ambiente é explícita e testada.
- O backend aceita somente IDs de preço presentes no catálogo; preço desconhecido, arquivado ou de outro ambiente é rejeitado antes de chamar o Stripe.
- Mudança de preço cria novo Price (Prices do Stripe são imutáveis). A decisão sobre assinantes existentes (mantidos no preço antigo ou migrados) está documentada.
- Impostos e emissão fiscal (NFS-e/ISS, Stripe Tax ou emissor externo): decisão documentada. Ausência de decisão bloqueia lançamento comercial.

## 2. Checkout e Customer Portal

- Checkout e sessão de portal são criados apenas por callable/endpoint autenticado que valida membership ativa e o papel autorizado a contratar para o workspace (definido na matriz RBAC).
- O vínculo assinatura ↔ workspace é definido pelo servidor (`client_reference_id`, `metadata.workspaceId` e `subscription_data.metadata.workspaceId` gravados pelo backend, para que eventos de assinatura e fatura também o carreguem), nunca por e-mail ou dado enviado pelo cliente depois do checkout.
- Um customer Stripe por workspace (ou por entidade pagadora decidida), com mapeamento persistido, único e criado de forma idempotente (transação/lock + `Idempotency-Key` na API Stripe).
- Checkouts concorrentes para o mesmo workspace não resultam em duas assinaturas ativas: há verificação de assinatura existente e deduplicação.
- `success_url`/`cancel_url` vêm de allowlist do servidor. O redirect de sucesso nunca ativa plano; a ativação ocorre somente pelo webhook ou por leitura server-side da sessão confirmada.
- Portal: operações permitidas (troca de plano, cancelamento, atualização de pagamento) configuradas e documentadas; o retorno do portal não altera estado localmente.
- Nenhum dado de cartão trafega ou é armazenado pela aplicação (Checkout/Elements hospedados).

## 3. Webhook

- Endpoint HTTP dedicado verifica a assinatura com `stripe.webhooks.constructEvent` sobre o **raw body** e o segredo do endpoint vindo do Secret Manager. Requisição sem assinatura, com assinatura inválida ou fora da tolerância é rejeitada sem efeito.
- Idempotência por `event.id`: registro persistente consultado e marcado na mesma transação que aplica o efeito. Retenção do registro ≥ 30 dias (eventos ficam disponíveis para listagem e reenvio manual por 30 dias; a reentrega automática em live dura até 3 dias), com TTL definido.
- Ordem: entrega fora de ordem não regride o estado. Preferir reler a assinatura atual via API antes de aplicar; ao comparar `event.created` (resolução de 1 segundo), usar desempate determinístico por versão persistida.
- `checkout.session.completed` só concede entitlement com `payment_status` igual a `paid` (ou `no_payment_required` em trial) ou com a assinatura relida em `active`/`trialing`; com meio de pagamento assíncrono (ex.: boleto), tratar `checkout.session.async_payment_succeeded` e `checkout.session.async_payment_failed`.
- Eventos tratados, no mínimo: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`; `invoice.payment_action_required` quando houver SCA/3DS; `customer.subscription.trial_will_end` quando houver trial; `charge.refunded` e `charge.dispute.created` quando reembolso/disputa afetarem entitlement. Eventos não tratados retornam 2xx, são registrados e não produzem efeito.
- Resposta 2xx somente após persistência. Falha transitória retorna 5xx para reentrega; falha permanente é registrada para análise sem loop infinito.
- O workspace do evento é resolvido por metadata definida pelo servidor e conferida contra o mapeamento customer ↔ workspace; divergência é rejeitada e registrada.
- Replay manual (reenvio pelo Dashboard/CLI) é seguro pela idempotência (o procedimento operacional é avaliado por `observability-incident-readiness`).
- Versão da API Stripe fixada no cliente do servidor e igual à do endpoint configurado.

## 4. Estado canônico e máquina de estados

- Um único documento de estado de assinatura por workspace, gravado exclusivamente pelo backend: plano, status Stripe, `priceId`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `trialEnd`, `graceUntil`, `stripeCustomerId`, `stripeSubscriptionId`, último evento aplicado (`id`, `created`) e timestamps de servidor. Nenhuma cópia concorrente (ex.: plano em `users` e em `workspaces` com semânticas diferentes).
- Todos os status possíveis têm tratamento definido: `trialing`, `active`, `past_due`, `unpaid`, `canceled`, `incomplete`, `incomplete_expired`, `paused`.
- **Upgrade:** entitlement ampliado apenas após confirmação (pagamento ou evento de assinatura atualizado); regra de proration definida.
- **Downgrade:** momento de efeito definido (fim do período ou imediato). Uso acima da nova quota tem comportamento definido (ex.: bloqueio de novas criações e somente leitura do excedente), sem apagar histórico financeiro.
- **Cancelamento:** `cancel_at_period_end` versus imediato definido; acesso até o fim do período; reativação antes do fim tratada.
- **Inadimplência:** `past_due` → grace period com duração definida → restrição; `unpaid`/`canceled` → plano gratuito ou suspensão definida, sem perda de dados; comunicações ao cliente definidas.
- **Trial:** se existir, duração, exigência de meio de pagamento, elegibilidade única por workspace/usuário (anti-abuso) e comportamento no fim.
- **Reembolso/disputa:** política documentada e efeito em entitlement (ex.: disputa aberta → suspensão).
- Toda mudança de plano/status gera registro de auditoria append-only (ator ou evento Stripe, antes/depois, `requestId`/`event.id`, timestamp de servidor).

## 5. Entitlements e enforcement de quotas

- Função pura e versionada deriva entitlements de (plano, status, datas). É usada pelo backend; o frontend apenas exibe.
- Toda quota (workspaces por usuário, membros por workspace, cartões, contas, lançamentos por período, uso de IA etc.) é verificada no backend **na mesma transação** que cria o recurso, com contador ou contagem limitada e consistente.
- Rules negam ao cliente escrita em campos de plano, status, entitlement e contadores. Recurso sujeito a quota criado diretamente pelo cliente é `FAIL`, salvo se as Rules aplicarem o mesmo limite de forma verificável e testada.
- Criações concorrentes no limite não ultrapassam a quota.
- Operações caras (IA, exportações, importações) têm rate limit server-side por plano.
- Mensagens de limite atingido em pt-BR, sem detalhes internos, com próxima ação (ex.: upgrade).

## 6. Segurança de segredos e dados

- `STRIPE_SECRET_KEY` e segredo do webhook somente no backend, via Secret Manager (`defineSecret`). Nunca em `VITE_*`, código, `.env` versionado, logs ou mensagens de erro.
- Chave publicável pode estar no cliente; chave restrita recomendada para o servidor quando aplicável.
- Logs de billing sem dados de cartão, sem payload completo do evento e sem PII desnecessária.

## 7. Testes obrigatórios

1. Unitários: derivação de entitlements para cada combinação plano × status; mapeamento preço → plano por ambiente; rejeição de preço desconhecido; cálculo de grace period.
2. Webhook: assinatura válida aceita; ausente/inválida rejeitada sem efeito; o mesmo evento entregue duas vezes produz um único efeito; entrega fora de ordem não regride estado; eventos concorrentes não perdem atualização; evento de workspace divergente é rejeitado. Fixtures assinadas localmente (`stripe.webhooks.generateTestHeaderString`), sem chamada de rede.
3. Checkout: membro sem papel autorizado é negado; workspace alheio é negado; checkouts concorrentes não geram duas assinaturas.
4. Quotas: criação no limite negada; criações concorrentes no limite não ultrapassam; downgrade com excedente segue a regra definida.
5. Rules (Emulator): cliente não escreve plano, status, entitlement, contador nem registros de eventos.
6. Ciclo de vida (fixtures assinadas): upgrade só amplia após confirmação; downgrade no momento definido; `cancel_at_period_end` mantém acesso até `currentPeriodEnd` e a reativação o desfaz; `past_due` → grace period → restrição → regularização; fim de trial com e sem meio de pagamento; reembolso, disputa e arrependimento aplicam a política definida.
7. Asserções sobre estado persistido, não apenas sobre status HTTP ou mocks.

## 8. Evidência de configuração externa

`docs/production/BILLING_ENTITLEMENTS.md` deve registrar, por ambiente: produtos e preços (IDs, valores, moeda, intervalo), URL do endpoint de webhook, eventos habilitados, versão da API, configuração do Customer Portal, decisão fiscal, data da conferência e responsável. Registro ausente, desatualizado em relação ao catálogo do código ou sem data é `FAIL` para lançamento.
