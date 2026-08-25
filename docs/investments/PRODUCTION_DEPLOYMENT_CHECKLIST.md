# Pré-requisitos externos de implantação

Tudo que a remediação **não pode** fazer a partir do repositório porque exige
projeto real, credencial real ou console do Firebase. Cada item traz o motivo,
o comando ou o caminho exato, e como conferir que ficou correto.

Nenhum destes passos foi executado durante a remediação: nenhum deploy, nenhum
acesso a Firebase de produção, nenhum segredo real. Os itens marcados
`EXTERNAL_DEPLOYMENT_PREREQUISITE` no ledger de remediação são exatamente estes.

---

## 1. Segredo do provider de IA (INV-P2-020)

As duas callables de IA declaram `secrets: ["GOOGLE_AI_API_KEY"]`. Sem o
segredo provisionado, o Cloud Functions não o monta no ambiente e as duas
falham de forma controlada, com mensagem em pt-BR — o recurso fica indisponível
sem quebrar o resto.

```bash
firebase functions:secrets:set GOOGLE_AI_API_KEY --project <PROJETO>
```

**Conferência:** `firebase functions:secrets:access GOOGLE_AI_API_KEY` devolve
valor; após o deploy, uma chamada a `analyzeFinancialQuestion` responde em vez
de recusar com "A análise por IA não está configurada neste ambiente".

---

## 2. Cobrança: allowlist de preço e origens (INV-P2-038)

O checkout recusa qualquer `priceId` fora da allowlist e qualquer `returnUrl`
cujo `origin` não esteja na lista. As duas listas são variáveis de ambiente das
Functions, não constantes de código, porque mudam entre projeto de teste e de
produção.

```bash
# IDs de preço do Stripe que concedem o plano pago, separados por vírgula.
firebase functions:secrets:set STRIPE_ALLOWED_PRICE_IDS --project <PROJETO>

# Origens completas para as quais o checkout pode devolver o usuário.
# Exemplo: https://app.exemplo.com.br,https://exemplo.com.br
firebase functions:secrets:set APP_ALLOWED_ORIGINS --project <PROJETO>
```

**Conferência:** um checkout com `priceId` fora da lista responde
"Plano indisponível"; um `returnUrl` de host desconhecido responde
"Endereço de retorno inválido". Ambos **antes** de qualquer chamada ao Stripe.

> Se `STRIPE_ALLOWED_PRICE_IDS` ficar vazio, o checkout falha fechado e o
> webhook **não concede** o plano. É deliberado: sem allowlist não há como
> conferir o que foi pago.

---

## 3. Migração de região das Cloud Functions (INV-P2-042)

O Firestore do projeto está em `southamerica-east1` e as funções subiam em
`us-central1`. O código agora declara a região junto do banco, e o SDK Web do
cliente aponta para a mesma região.

Trocar a região **não é edição no lugar**: o Firebase cria as funções novas e
as antigas continuam existindo até serem apagadas. Sequência segura:

1. Implantar as funções novas:
   ```bash
   npm run deploy:functions
   ```
2. Conferir que respondem em `southamerica-east1`:
   ```bash
   firebase functions:list --project <PROJETO>
   ```
3. Publicar o frontend já apontando para a região nova (o build atual já o faz
   por `src/lib/firebase.ts`).
4. Só depois, apagar as funções antigas de `us-central1`:
   ```bash
   firebase functions:delete <nome> --region us-central1 --project <PROJETO>
   ```

**Ordem importa:** apagar antes de publicar o frontend novo deixa a versão
anterior do aplicativo chamando um endpoint que não existe mais.

O webhook do Stripe também muda de URL. Atualize o endpoint no painel do Stripe
**antes** de apagar a função antiga, e confira a entrega de um evento de teste.

---

## 4. Política de TTL das coleções operacionais (INV-P2-041)

O código passa a gravar `expiresAt` nas coleções operacionais. O campo é apenas
a marca; a remoção é feita pela política de TTL do Firestore, que é
configuração de projeto.

**Nenhuma coleção de fato financeiro recebe `expiresAt`** — movimentos,
valorações, posições, períodos, alocações, transações e trilha de auditoria do
domínio ficam fora por construção. Ativar TTL nelas seria perda de histórico.

Ativar TTL no campo `expiresAt` para:

| Coleção | Retenção |
| ------- | -------- |
| `investment_idempotency_keys` | 90 dias |
| `investment_operational_metrics` | 400 dias |
| `investment_event_logs` | 400 dias |
| `rate_limits` (workspace e usuário) | 2 dias |
| `activity_logs` | 365 dias |

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=investment_idempotency_keys \
  --enable-ttl --project=<PROJETO>
```

Repetir para cada coleção da tabela.

**Conferência:** `gcloud firestore fields ttls list --project=<PROJETO>` lista
as cinco com `ttlConfig.state: ACTIVE`.

---

## 5. Índices compostos

`firestore.indexes.json` declara todos os índices das consultas do produto,
incluindo os novos:

- `investment_movements` por `(accountId, assetId, status, settlementAt)` —
  linha do tempo da reconstrução;
- `investment_valuations` por `(accountId, assetId, effectiveAt)` — idem;
- `investment_movements` por `(migrationId, occurredAt desc)` — rollback;
- `investment_movements` por `(goalId, occurredAt desc)` — movimentações da meta;
- `transactions` por `(date desc)` — janela paginada;
- `cash_report_periods` por `(periodStart desc)` — projeção de caixa;
- `goals` por `(archived)` — filtro no servidor.

```bash
npm run deploy:firestore
```

O script executa as cinco suítes de Rules no Emulator antes de publicar. A
construção dos índices é assíncrona: **aguarde `READY`** antes de liberar o
rollout, senão as consultas correspondentes falham.

**Conferência:** `firebase firestore:indexes --project <PROJETO>` mostra todos
como `READY`.

---

## 6. Backfill da projeção mensal de caixa (INV-P1-011)

A projeção `cash_report_periods` é mantida por delta pelo gatilho de
transações, mas workspaces com histórico anterior ao gatilho começam sem ela — e
o saldo acumulado das metas PJ `caixa_minimo` sairia zerado.

Para cada workspace já existente, executar em **Configurações › Cadastros ›
Operação do domínio patrimonial › Reconstruir o fluxo de caixa mensal**.

**Conferência:** a soma de `netCents` dos períodos bate com o saldo que o
workspace exibia antes do rollout.

---

## 7. Rollout do domínio patrimonial, por workspace

Sequência oficial, toda ela pela área operacional (owner do workspace):

1. **Simular migração** — confere quantas linhas migrariam, sem gravar nada.
2. **Aplicar migração** — cria os movimentos; é retomável e idempotente.
3. **Conferir reconciliação** — principal e resultado realizado precisam bater
   em centavos entre o histórico legado e o domínio.
4. **Habilitar o domínio patrimonial** — só aceita com migração aplicada,
   concluída, não simulada e não revertida.

Se algo sair errado: **Reverter migração** emite uma compensação por movimento,
desliga a flag e libera nova tentativa. Nada é apagado.

---

## 8. Verificações pós-deploy

Só podem ser feitas contra o projeto real:

- **Latência**: comparar o tempo de uma callable de aporte antes e depois da
  migração de região. O esperado é queda expressiva, por deixar de cruzar o
  continente a cada leitura e escrita da transação.
- **IA**: uma chamada a `analyzeFinancialQuestion` responde em vez de recusar.
- **Stripe**: um evento de teste chega ao endpoint da região nova e concede o
  plano apenas para preço da allowlist.
- **TTL**: após a primeira janela, conferir que documentos expirados sumiram das
  coleções operacionais e que **nenhum** fato financeiro foi removido.
- **Deriva**: a rotina diária de deriva não registra divergência relevante nos
  primeiros dias de rollout.

---

## 9. Segredo do CI

O workflow de gate **não usa segredo nenhum**: build, lint, tipos, unitários,
integração no Emulator e E2E rodam com dados sintéticos.

Se um workflow de deploy for adicionado no futuro, ele precisará de
`FIREBASE_TOKEN` ou de Workload Identity Federation — e deve depender do job de
gate, nunca rodar em paralelo com ele.
