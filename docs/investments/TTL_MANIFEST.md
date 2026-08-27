# Manifesto de TTL

Fonte única sobre o que expira e o que **nunca** expira no Firestore deste
projeto.

Existe porque `expiresAt` é apenas uma marca gravada pelo código: quem apaga é
a política de TTL do Firestore, que é configuração de projeto, aplicada por
coleção, no console ou pelo `gcloud`. Sem um manifesto, a decisão de "ativar
TTL onde existe `expiresAt`" é tomada por quem estiver no console — e o campo
já significou coisas diferentes em gravadores diferentes neste repositório
(seção 4), a ponto de a mesma decisão apagar uma trilha que ninguém pretendia
expirar.

- Base de verificação: `functions/src/shared/retention.ts` e todos os pontos de
  escrita de `expiresAt` em `functions/src`.
- Regra que separa as duas listas, herdada de `AGENTS.md`: **fato financeiro,
  contábil ou de auditoria legal nunca expira.**

---

## 1. Regra

Uma coleção só pode receber TTL se as três afirmações forem verdadeiras:

1. o documento é **operacional** — existe para tornar uma execução correta ou
   observável, não para registrar um fato do negócio;
2. apagá-lo **não** impede reconstruir nenhum saldo, posição, período,
   progresso de meta ou relatório;
3. apagá-lo **não** remove evidência exigida por auditoria.

Se qualquer uma falhar, a coleção fica fora — mesmo que o documento seja grande
e cresça rápido.

---

## 2. Coleções que PODEM receber TTL

Cada linha corresponde a um ponto de escrita real de `expiresAt`.

| Coleção | Retenção | Onde o campo é gravado | Por que pode expirar |
| ------- | -------- | ---------------------- | -------------------- |
| `investment_idempotency_keys` | 90 dias | `investments/infrastructure.ts:329` | Reserva de intenção. Sobrevive com folga a qualquer retry plausível; o fato vive em `investment_movements`. |
| `investment_operational_metrics` | 400 dias | `investments/observability.ts:119` | Métrica diária agregada. Não é fonte de reconstrução de nada. |
| `investment_event_logs` | 400 dias | `investments/observability.ts:237` | Log operacional. **Não** é a trilha de auditoria do domínio, que é `investment_audit_logs` e não expira. |
| `investment_drift_reports` | 400 dias | `crons/investmentDrift.ts:260` | Resultado de uma conferência diária. O fato conferido continua nas coleções de origem. |
| `rate_limits` (workspace) | 2 dias | `shared/rateLimit.ts:144` | Contador de janela. Some junto com a janela. |
| `rate_limits` (usuário, `users/{uid}/rate_limits`) | 2 dias | `shared/rateLimit.ts:144` | Idem. |
| `activity_logs` | 365 dias | `triggers/transactions.ts` (`ACTIVITY_LOG_RETENTION_DAYS`) | Trilha de atividade. O fato financeiro correspondente está na transação, que é preservada para sempre. |
| `cash_period_events` | 90 dias | `cash/periods.ts` (`applyCashPeriodWriteOnce`) | Marca de entrega já aplicada pelo gatilho de caixa (INV-P3-001). Sobrevive com folga ao teto de reentrega de um gatilho do Firestore (7 dias). O fato está na transação e no período, que não expiram. |

### Comandos

```bash
for COLECAO in \
  investment_idempotency_keys \
  investment_operational_metrics \
  investment_event_logs \
  investment_drift_reports \
  rate_limits \
  activity_logs \
  cash_period_events
do
  gcloud firestore fields ttls update expiresAt \
    --collection-group="$COLECAO" \
    --enable-ttl \
    --project=<PROJETO>
done
```

**Conferência:** `gcloud firestore fields ttls list --project=<PROJETO>` lista
as sete com `ttlConfig.state: ACTIVE`. `rate_limits` aparece uma vez: a
política é por **grupo de coleção**, e cobre tanto o caminho de workspace
quanto o de usuário.

**`cash_period_events` é a única entrada cuja expiração tem consequência
funcional**, e ela é benigna: apagar a marca antes do fim da janela de
reentrega reabriria a duplicação **daquela** entrega. 90 dias contra um teto de
retry de 7 é folga de mais de dez vezes. Não confundir com a lista da seção 4:
lá o campo não é retenção; aqui é, e o prazo é o que importa.

---

## 3. Coleções que NUNCA podem receber TTL

Nenhuma delas grava `expiresAt`, e nenhuma deve passar a gravar.

### 3.1 Fatos do domínio patrimonial

| Coleção | Por que nunca expira |
| ------- | -------------------- |
| `investment_movements` | Ledger oficial. É a origem de toda reconstrução de posição, período e alocação. |
| `investment_valuations` | Sem as valorações, a reconstrução recompõe custo mas não valor de mercado: a série histórica sai errada. |
| `investment_positions` | Reconstruível, mas é a fonte do progresso patrimonial das metas. |
| `investment_report_periods` | Série mensal publicada. Base do relatório e do painel. |
| `investment_allocation_summaries` | Cortes de alocação PF e PJ. |
| `investment_summaries` | Resumo corrente do workspace. |
| `investment_snapshots` | Checkpoint de operação retomável. Apagar no meio de uma reconstrução a torna não retomável. |
| `investment_accounts`, `investment_assets` | Catálogo referenciado por movimento e posição. |
| `investment_import_batches` | Procedência de aporte importado. |

### 3.2 Fatos contábeis e de caixa

| Coleção | Por que nunca expira |
| ------- | -------------------- |
| `transactions` | Histórico financeiro. `AGENTS.md` proíbe até o hard delete; a exclusão pela interface é baixa lógica (`voidedAt`). |
| `cash_report_periods` | Projeção mensal de caixa, fonte oficial do saldo acumulado. |
| `goals` | Metas e seu progresso publicado. |
| `credit_cards`, `credit_card_purchases`, `credit_card_invoices`, `credit_card_invoice_payments`, `credit_card_installments`, `card_limit_ledger` | Fatura, compra, parcela e movimentação de limite. |
| `loans`, `loan_movements` | Contrato e movimentação de empréstimo. |
| `receivables`, `clients` | Contas a receber. |
| `split_groups`, `split_participants`, `split_bills`, `split_shares` | Rateio acordado entre pessoas. |
| `recurring_expenses`, `recurring_occurrences` | Contrato recorrente e suas ocorrências. |

### 3.3 Trilhas de auditoria

| Coleção | Por que nunca expira |
| ------- | -------------------- |
| `investment_audit_logs` | Trilha do domínio patrimonial: quem operou, quando, com que motivo. |
| `credit_card_audit_logs` | Idem, cartões. |
| `goal_audit_logs` | Idem, metas — inclusive a reconstrução de progresso. |
| `financial_events` | Eventos de domínio consumidos por conciliação. |

---

## 4. Coleções com `expiresAt` que **não** são retenção

Esta é a razão principal de o manifesto existir: `expiresAt` é um nome, não um
contrato. Antes de ativar TTL numa coleção, é preciso conferir o que o campo
significa **naquele** gravador.

| Coleção | Situação |
| ------- | -------- |
| `investment_operation_leases` | **Não existe mais.** `operationLease.ts` foi removido com a coexistência legado ↔ V2, e a coleção não tem gravador. A entrada fica registrada porque a armadilha era real: `expiresAt` ali era o vencimento do lease, não retenção, e ativar TTL apagaria todo lease liberado — junto com a trilha de "quem operou este workspace e quando". Se um lease genérico voltar um dia, a regra é gravar a expiração de retenção num **campo separado** (`retentionExpiresAt`), nunca reaproveitar o vencimento. |
| `investment_snapshots` | Não grava `expiresAt` e **não deve passar a gravar**: é checkpoint de operação retomável (seção 3.1). Apagar no meio de uma reconstrução a torna não retomável. |

---

## 5. Divergências conhecidas

Registradas para não serem redescobertas como se fossem defeito novo.

1. **`activity_logs` usa constante própria.** O prazo de 365 dias é
   `ACTIVITY_LOG_RETENTION_DAYS`, declarado no próprio
   `triggers/transactions.ts`, fora de `RETENTION_DAYS`. Quem auditar só a
   tabela de política não a vê. Não é defeito de comportamento; é de
   descoberta. `cash_period_events`, gravado no mesmo handler, **usa**
   `RETENTION_DAYS.cashPeriodEvents`.
2. **`RETENTION_DAYS.completedCheckpoints` (30 dias) não é usado por ninguém.**
   `investment_snapshots` não recebe `expiresAt` — e não deve receber, porque é
   checkpoint de operação retomável (seção 3.1). A entrada é intenção não
   implementada.
3. **Assimetria entre domínios.** `credit_card_idempotency_keys`,
   `goal_idempotency_keys` e `credit_card_operational_metrics` são da mesma
   classe descartável que os equivalentes de investimentos, e **não** recebem
   `expiresAt`. Crescem sem limite. Não bloqueia rollout — é custo de
   armazenamento, não risco de correção —, e estender a política a elas é
   trabalho de código, não de console.

---

## 6. Verificação depois de ativar

1. `gcloud firestore fields ttls list --project=<PROJETO>` mostra exatamente as
   sete coleções da seção 2 como `ACTIVE`, e **nenhuma** outra.
2. Após a primeira janela, conferir que:
   - documentos vencidos sumiram das coleções da seção 2;
   - a contagem de `investment_movements`, `transactions`, `cash_report_periods`
     e das trilhas de auditoria **não** mudou;
   - `cash_period_events` só perdeu documentos com mais de 90 dias, e o saldo
     acumulado do workspace continua igual ao da soma dos períodos.
3. Uma reconstrução de projeções executada depois da primeira janela de TTL
   fecha nos mesmos valores de antes — prova de que nada necessário à
   reconstrução foi removido.
