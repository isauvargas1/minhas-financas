# Pré-requisitos externos de implantação

Tudo que não pode ser resolvido a partir do repositório porque exige projeto
real, credencial real ou console do Firebase. Cada item traz **comando exato**,
**pré-condição**, **evidência esperada**, **rollback** e **risco de executar
fora de ordem**.

Nenhum destes passos foi executado: nenhum deploy, nenhum acesso a Firebase de
produção, nenhum segredo real.

> A política de TTL tem documento próprio: `TTL_MANIFEST.md`. O ensaio em
> ambiente de teste tem o seu: `tools/staging/rehearsal.sh`.

---

## 0. Ordem canônica

Executar nesta ordem. O número entre colchetes é a seção.

```
[1] segredos  →  [2] índices  →  [3] Rules  →  [4] Functions (região nova)
      →  [5] smoke  →  [6] webhook do Stripe  →  [7] TTL
      →  [8] frontend  →  [9] backfill por workspace  →  [10] rollout V2
      →  [11] remoção das Functions antigas
```

Duas inversões são destrutivas e não têm desfazer barato:

- **[11] antes de [8]** deixa a versão publicada do aplicativo chamando um
  endpoint que não existe mais;
- **[11] antes de [6]** derruba o webhook do Stripe: eventos entregues no
  intervalo falham e o plano pago não é concedido.

---

## 1. Segredos

Quatro nomes, quatro consumidores. **Todos** são declarados no `secrets` da
função que os lê — o Cloud Functions só monta o que a função declara, e um
segredo provisionado mas não declarado chega vazio.

| Segredo | Lido por | Se faltar |
| ------- | -------- | --------- |
| `GOOGLE_AI_API_KEY` | `analyzeFinancialQuestion`, `extractTransactionFromContent` | A IA recusa em pt-BR; o resto do produto segue. |
| `STRIPE_SECRET_KEY` | `createCheckoutSession`, `stripeWebhook` | Checkout e webhook inoperantes. |
| `STRIPE_WEBHOOK_SECRET` | `stripeWebhook` | Assinatura do webhook não confere: nenhum evento é aceito. |
| `STRIPE_ALLOWED_PRICE_IDS` | `createCheckoutSession`, `stripeWebhook` | Allowlist vazia ⇒ **nenhum** preço aceito e o plano **não** é concedido. Falha fechada, deliberada. |
| `APP_ALLOWED_ORIGINS` | `createCheckoutSession` | Nenhum `returnUrl` é válido; o checkout não abre. |

```bash
firebase functions:secrets:set GOOGLE_AI_API_KEY      --project <PROJETO>
firebase functions:secrets:set STRIPE_SECRET_KEY      --project <PROJETO>
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET  --project <PROJETO>
# Lista separada por vírgula. Ex.: price_1AbC...,price_1XyZ...
firebase functions:secrets:set STRIPE_ALLOWED_PRICE_IDS --project <PROJETO>
# Origens completas, sem barra final. Ex.: https://app.exemplo.com.br
firebase functions:secrets:set APP_ALLOWED_ORIGINS      --project <PROJETO>
```

- **Pré-condição:** projeto no plano Blaze e Secret Manager habilitado.
- **Evidência:** `firebase functions:secrets:access <NOME> --project <PROJETO>`
  devolve valor para os cinco.
- **Rollback:** `firebase functions:secrets:destroy <NOME> --project <PROJETO>`.
  O código falha fechado sem eles; não há estado corrompido.
- **Fora de ordem:** provisionar **depois** do deploy das Functions exige um
  novo deploy para montar as versões — o segredo não aparece sozinho.

> Nada de valor secreto no Git. `.gitignore` cobre `.env`, `.env.*`,
> `functions/.env*`, `*.pem` e chaves de conta de serviço.

---

## 2. Índices compostos

`firestore.indexes.json` declara os índices de todas as consultas do produto.

```bash
firebase deploy --only firestore:indexes --project <PROJETO>
```

- **Pré-condição:** nenhuma.
- **Evidência:** `firebase firestore:indexes --project <PROJETO>` lista **todos**
  como `READY`. A construção é assíncrona e pode levar minutos a horas conforme
  o volume.
- **Rollback:** apagar um índice não perde dado; só volta a falhar a consulta.
- **Fora de ordem:** liberar tráfego antes de `READY` faz a consulta
  correspondente falhar com `FAILED_PRECONDITION`. Os mais sensíveis:

| Índice | Consulta que quebra sem ele |
| ------ | --------------------------- |
| `recurring_expenses (status, gerarDespesaAutomaticamente, __name__)` — escopo **grupo de coleção** | A varredura diária de despesas recorrentes. Consulta de grupo de coleção **não** ganha índice automático de campo único. |
| `loans (type, status, currentBalance, __name__)` | Os agregados de saldo a receber e a pagar das telas PF e PJ. O campo somado precisa constar do índice: agregação `sum` sobre consulta composta o exige, e o Emulator **não** cobra índice, então isto só falha no projeto real. |
| `loan_movements (loanId, date desc, __name__ desc)` | Histórico de movimentações do contrato. |
| `split_shares (status, billId, __name__)` | Rateios em aberto por grupo. |
| `split_invites (groupId, status, …)` e `(codigoConvite, status, …)` | Convites pendentes e resgate por código. |
| `recurring_occurrences (recurringExpenseId, dataPrevista, __name__)` | Ocorrências da assinatura aberta. |

---

## 3. Rules

```bash
npm run deploy:firestore --project <PROJETO>
```

O script roda as cinco suítes de Rules no Emulator **antes** de publicar, e
publica Rules e índices juntos.

- **Pré-condição:** seção 2 aplicada (ou publicada por este mesmo comando).
- **Evidência:** console → Firestore → Regras mostra o mesmo `firestore.rules`
  do repositório; as suítes passaram no pré-deploy.
- **Rollback:** o console mantém histórico de versões das Rules; reverter é um
  clique e vale imediatamente.
- **Fora de ordem:** publicar Rules **antes** das Functions é seguro. O inverso
  também: nenhuma Function depende de Rules (Admin SDK as ignora).

---

## 4. Functions na região nova

O Firestore está em `southamerica-east1` e as funções subiam em `us-central1`.
As 53 funções declaram a região junto do banco.

```bash
npm run deploy:functions --project <PROJETO>
```

- **Pré-condição:** seção 1 concluída.
- **Evidência:** `firebase functions:list --project <PROJETO>` mostra as 53 em
  `southamerica-east1`. As antigas continuam listadas em `us-central1` —
  **isso é esperado**, trocar região cria função nova.
- **Rollback:** as antigas continuam servindo até a seção 11.
- **Fora de ordem:** nenhum risco em implantar antes do frontend; as duas
  regiões coexistem. O risco está em **remover** cedo (seção 11).

---

## 5. Smoke pós-deploy

Antes de mexer em webhook ou frontend.

- `analyzeFinancialQuestion` responde em vez de recusar por falta de segredo.
- Uma callable transacional (aporte) conclui e a latência cai em relação a
  `us-central1` — o ganho é o motivo da migração.
- As três rotinas agendadas aparecem no Cloud Scheduler em
  `southamerica-east1`, com fuso `America/Sao_Paulo`.

```bash
gcloud scheduler jobs list --location=southamerica-east1 --project=<PROJETO>
```

- **Evidência:** três jobs — `processRecurring` (02:00), `processInvestmentDriftScan`
  (06:00), `processCreditCardInvoiceOperationalAlerts` (07:00).
- **Rollback:** nenhuma escrita foi feita; basta não seguir.

---

## 6. Webhook do Stripe

A URL muda com a região. Atualizar **antes** de remover a função antiga.

- URL antiga: `https://us-central1-<PROJETO>.cloudfunctions.net/stripeWebhook`
- URL nova: `https://southamerica-east1-<PROJETO>.cloudfunctions.net/stripeWebhook`

Sequência sem janela sem webhook:

1. No painel do Stripe, **adicionar** um segundo endpoint com a URL nova, com
   os mesmos eventos do atual. Os dois ficam ativos: a entrega é duplicada, e
   o processamento é idempotente por `event.id`.
2. Enviar um evento de teste para o endpoint novo e conferir entrega `200`.
3. Confirmar tráfego real chegando ao endpoint novo por pelo menos um ciclo.
4. **Desativar** o endpoint antigo (não apagar).
5. Só então a seção 11.

```bash
stripe listen --forward-to \
  https://southamerica-east1-<PROJETO>.cloudfunctions.net/stripeWebhook
stripe trigger checkout.session.completed
```

- **Pré-condição:** seções 1 e 4.
- **Evidência:** no Stripe, entrega `200` no endpoint novo; nos logs da função,
  concessão de plano apenas para preço da allowlist.
- **Rollback:** reativar o endpoint antigo enquanto a função antiga existir.
- **Fora de ordem:** remover a função antiga antes do passo 4 perde eventos. O
  Stripe reentrega com backoff por até ~3 dias, então a perda é recuperável —
  mas o plano pago fica pendente nesse intervalo.

---

## 7. TTL

Ver `TTL_MANIFEST.md`, que é a fonte única do que expira e do que nunca expira.
Resumo operacional: **sete** grupos de coleção recebem TTL em `expiresAt`.

`cash_period_events` entrou na lista com a idempotência do gatilho de caixa
(INV-P3-001) e é a única entrada cuja expiração tem consequência funcional:
apagar a marca antes do fim da janela de reentrega reabriria a duplicação
daquela entrega. O prazo gravado é de 90 dias contra um teto de retry de 7 —
folga de mais de dez vezes. **Não reduzir esse prazo pelo console.**

- **Pré-condição:** seção 4 (o campo passa a ser gravado pelo código novo).
- **Evidência:** `gcloud firestore fields ttls list --project=<PROJETO>` lista
  exatamente as sete como `ACTIVE`.
- **Rollback:** `--disable-ttl` no mesmo comando. O que já foi apagado não
  volta — por isso o manifesto é conferido antes.
- **Fora de ordem:** ativar TTL numa coleção fora da lista apaga dado
  operacional ou histórico, em silêncio.

---

## 8. Frontend

```bash
npm run build && firebase deploy --only hosting --project <PROJETO>
```

O build já aponta para `southamerica-east1` (`src/lib/firebase.ts`).

- **Pré-condição:** seção 4 concluída.
- **Evidência:** no navegador, as chamadas de callable saem para
  `southamerica-east1`.
- **Rollback:** `firebase hosting:rollback`.
- **Fora de ordem:** publicar **antes** das Functions faz o aplicativo chamar
  uma região onde ainda não há função.

---

## 9. Backfill da projeção de caixa, por workspace

Ver `CASH_BACKFILL_RUNBOOK.md`, com simulação, conferência, aplicação e
reconciliação.

- **Pré-condição:** seções 4 e 8.
- **Evidência:** a reconciliação devolvida pela simulação bate com o saldo que
  o workspace exibia antes.
- **Rollback:** reexecutar publica valor absoluto recalculado do ledger; não
  há estado a desfazer.
- **Fora de ordem:** sem o backfill, a meta PJ de caixa mínimo fica com
  progresso zerado até a reconstrução.

---

## 10. Domínio de investimentos

Não há rollout, migração nem flag: o domínio patrimonial é a única arquitetura
de investimentos. Um workspace novo abre **Investimentos** e opera direto —
onboarding, conta, ativo, aporte, valoração, resgate e relatórios.

Ver `INVESTMENTS_SINGLE_DOMAIN_FINALIZATION.md`.

- **Pré-condição:** seções 3, 4 e 8.
- **Evidência:** um workspace sem o campo `features` abre a tela patrimonial e
  registra um aporte; o dashboard e o relatório exibem o patrimônio.
- **Rollback:** somente de código; ver §12 daquele documento.

---

## 11. Remoção das Functions antigas

**Último passo.** Só depois de 6 (endpoint novo confirmado) e 8 (frontend
publicado).

```bash
firebase functions:list --project <PROJETO>   # confirme o que ainda existe
firebase functions:delete <nome> --region us-central1 --project <PROJETO>
```

- **Evidência:** `functions:list` não mostra mais nada em `us-central1`.
- **Rollback:** reimplantar na região antiga (deploy completo com a região
  antiga declarada). Caro e manual — por isso é o último passo.
- **Fora de ordem:** ver seção 0.

---

## 12. Observabilidade e alertas

Nada disto é código; tudo é configuração de projeto.

| O que | Onde | Limiar sugerido |
| ----- | ---- | --------------- |
| Erro das callables do domínio | Cloud Monitoring, métrica de execuções com status ≠ ok | > 1 % em 15 min |
| Falha das rotinas agendadas | Alerta por execução com erro | qualquer ocorrência |
| Deriva patrimonial | Documentos em `investment_drift_reports` com `status: "drift_detected"` | qualquer ocorrência |
| Truncamento das rotinas | Log `recurring_processed` com `truncated: true` | duas execuções seguidas |
| Latência de callable transacional | p95 | acima de 2 s |
| Webhook do Stripe | Entregas com falha no painel do Stripe | qualquer ocorrência |

- **Evidência:** um alerta de teste dispara e chega ao canal configurado.
- **Fora de ordem:** sem alerta, uma falha de agendador é silenciosa — o
  produto continua funcionando e a geração de recorrentes simplesmente não
  acontece.

---

## 13. Segredo do CI

O workflow de gate **não usa segredo nenhum**: build, lint, tipos, unitários,
integração no Emulator e E2E rodam com dados sintéticos.

Um futuro workflow de deploy precisará de `FIREBASE_TOKEN` ou Workload Identity
Federation, e deve **depender** do job de gate, nunca rodar em paralelo com ele.
