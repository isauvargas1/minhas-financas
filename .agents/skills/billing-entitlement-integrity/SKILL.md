---
name: billing-entitlement-integrity
description: Gate bloqueante de integridade de billing SaaS, assinatura Stripe, entitlements e quotas. Use sempre que uma tarefa criar, alterar, revisar ou aprovar produtos/preços Stripe, catálogo de planos, checkout, Customer Portal, assinatura, webhook Stripe (verificação de assinatura, idempotência, replay, ordem de eventos), upgrade, downgrade, cancelamento, reativação, inadimplência, trial, grace period, reembolso, disputa, entitlements, quotas, limites por plano, rate limits comerciais ou qualquer leitura/escrita do estado de plano/assinatura de um workspace — no frontend, Functions, Rules, jobs, scripts ou testes.
---

# Billing and Entitlement Integrity

Atue como gate bloqueante. Inspecione código, configuração, Rules, testes e a evidência versionada de configuração do Stripe; nunca aprove por descrição, nome de variável ou intenção.

## Fronteiras com outras skills

- **Esta skill:** correção do ciclo de vida comercial de ponta a ponta — catálogo → checkout → Stripe → webhook → estado canônico da assinatura → derivação de entitlements → enforcement server-side de quotas → exibição.
- `multi-tenant-security-review`: quem pode iniciar checkout/portal e isolamento entre workspaces. Execute em conjunto quando callables, Rules ou membership mudarem.
- `financial-domain-integrity`: dados financeiros do usuário. Não cobre billing SaaS, exceto valores de billing persistidos ou exibidos em relatórios do usuário.
- `firebase-production-readiness`: Secret Manager, ambientes e runtime das Functions. Esta skill exige que chave Stripe e segredo do webhook estejam lá, mas não audita a plataforma.
- `observability-incident-readiness`: alertas, fila de falhas e runbook operacional de webhooks. Esta skill prova que replay é seguro.
- `saas-commercial-readiness`: página de preços, disclosure e UX de contratação/cancelamento. Esta skill prova que preço exibido = preço cobrado = entitlement concedido.

## Workflow

1. Ler integralmente [references/billing-checklist.md](references/billing-checklist.md).
2. Inventariar o catálogo em todos os lugares do repositório (constantes do frontend, backend, variáveis de ambiente, docs, seeds, testes): plano interno, produto, preço, valor em centavos, moeda, intervalo, ambiente (test/live) e entitlements. Qualquer divergência é `FAIL`.
3. Traçar o fluxo real: seleção de plano → callable de checkout (autenticação, membership, papel, workspace) → Stripe → webhook (assinatura verificada sobre o raw body) → persistência do estado canônico (fonte única) → derivação de entitlements → enforcement em callables/Rules → exibição.
4. Construir a máquina de estados de assinatura efetivamente suportada e confrontá-la com os eventos Stripe tratados e com os estados que o Stripe pode produzir.
5. Exercitar duplicidade, replay, entrega fora de ordem, concorrência (dois checkouts, webhook concorrente com upgrade, criações simultâneas no limite de quota) e falha parcial.
6. Avaliar cada item do checklist com evidência. Executar os testes relevantes (unitários e Emulator). Stripe apenas em modo test, com fixtures assinadas localmente; nunca chaves live.
7. Se implementação for pedida, corrigir todas as falhas e adicionar os testes exigidos. Em revisão, permanecer somente leitura.

## Política de decisão

- **Escopo da avaliação.** Em mudança ou fechamento de milestone, avaliar integralmente toda seção do checklist exercitada pelos caminhos alterados, toda invariante que o diff possa violar e todo item que o plano mestre (`docs/production/PRODUCTION_READINESS_PLAN.md` §6, §8 e §11) atribui ao milestone corrente ou a milestones anteriores. Itens atribuídos a milestone posterior e não afetados pelo diff ficam fora do escopo desta execução e são listados em "Fora do escopo desta avaliação" com o ID do plano (PR-\*, E-\*, D-\*); não são `N/A` nem `PASS`, e o veredito declara o escopo a que se aplica. Isso não é ressalva: dentro do escopo, qualquer falha ou evidência ausente é `FAIL`. Em release para STAGING/PROD, no lançamento e em P10, o escopo é o checklist integral e qualquer pendência é `FAIL`.
- `FAIL` se qualquer entitlement ou quota for aplicado apenas no cliente; se plano, status de assinatura, entitlement ou contador de quota for gravável pelo cliente; se o webhook não verificar a assinatura; se evento puder produzir efeito duplicado ou regredir estado por ordem de entrega; se preço/plano divergir entre fontes; se estado de assinatura possível não tiver tratamento definido; se ativação depender de redirect de sucesso do checkout; se segredo estiver fora do backend; se faltar teste obrigatório.
- Configuração que vive fora do repositório (Dashboard Stripe: produtos, preços, endpoint, eventos habilitados, versão da API, Customer Portal, impostos) exige evidência versionada em `docs/production/BILLING_ENTITLEMENTS.md` (valor esperado, valor conferido, ambiente, data, responsável). Sem ela, `FAIL` no fechamento de P2, em release para STAGING/PROD e no lançamento.
- Ausência de evidência obrigatória é `FAIL`. `N/A` somente com prova de que o item não se aplica (ex.: produto sem trial, comprovado pelo catálogo e pelo código).
- Não existe “PASS com ressalvas”. `PASS` somente quando todos os itens aplicáveis passarem com evidência do repositório atual e verificação executada.

## Saída obrigatória

Começar exatamente com `PASS — Billing and entitlement integrity` ou `FAIL — Billing and entitlement integrity`.

Em seguida:

- **Escopo:** fluxos, callables, webhook, Rules, telas e testes avaliados.
- **Catálogo:** tabela plano → produto → preço (test/live) → valor em centavos/moeda/intervalo → entitlements → fonte de cada dado, com divergências marcadas.
- **Máquina de estados:** estados suportados, transições, evento Stripe que causa cada transição e efeito em entitlements.
- **Matriz de evidência:** uma linha por seção do checklist com `PASS`, `FAIL` ou `N/A` e referência arquivo:linha ou saída de teste.
- **Replay e concorrência:** cenários exercitados e resultado.
- **Achados bloqueantes:** cenário concreto, impacto comercial/segurança e remediação.
- **Fora do escopo desta avaliação:** itens do checklist atribuídos a milestone posterior e não afetados pelo diff, com o ID do plano; vazio em release e em P10.
- **Verificação:** comandos e testes executados, com resultado.
