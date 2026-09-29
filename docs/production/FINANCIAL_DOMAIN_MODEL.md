# Modelo de domínio financeiro

Este documento define o modelo de domínio financeiro alvo do Minhas Finanças e registra, domínio a domínio, o estado auditado, o alvo e as lacunas: política monetária, política temporal, semântica dos movimentos, fonte de verdade e fórmula de reconstrução de cada grandeza, atomicidade e idempotência. Baseline auditada: `main` @ HEAD `9c3ab46`. Programa, IDs, milestones e decisões ficam no plano mestre, [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md); a arquitetura geral está em [ARCHITECTURE.md](ARCHITECTURE.md) e o schema das coleções em [DATA_MODEL.md](DATA_MODEL.md). O gate do tema é a skill `financial-domain-integrity`, complementada por `firestore-scale-cost-review` (consultas e agregados), `multi-tenant-security-review` (Rules e RBAC) e `billing-entitlement-integrity` (quotas).

Rótulos: **CURRENT** existe no HEAD auditado, com evidência `arquivo:linha`; **TARGET** é o alvo, ainda não implementado salvo quando dito; **GAP** aponta o ID do [registro](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers) (BLOCKER/HIGH) ou o ID de origem da auditoria (MEDIUM/LOW); **DECISION** remete à §9 (tomadas) ou §10 (pendentes) do plano; **EXTERNAL CONFIGURATION REQUIRED** é configuração fora do repositório. Este documento não prova implementação: confirme o código no HEAD antes de mudar qualquer coisa.

---

## 1. Escopo, ordem e invariantes

| Tema | Classificação | Conteúdo |
| --- | --- | --- |
| Domínios cobertos | — | Caixa (`transactions`), Cartões, Recorrentes, Divisão de contas, Empréstimos, Clientes/Recebíveis, Investimentos, Metas, Relatórios. |
| Kernel monetário e de datas | DECISION (D-ORD-02) | P1 entrega o módulo `money` (centavos, parse, alocação por maior resto) espelhado no frontend e a política de datas civis. A adoção por domínio acontece em P3–P5 (PR-MONEY-01). |
| Ordem dos domínios | DECISION (D-ORD-01, D-ORD-05) | P3: caixa autoritativo, empréstimos, recebíveis. P4: cartões, recorrentes, divisão de contas, remoção do `parcelado`, PR-INV-01. P5: metas e relatórios. A quota de cada callable nova entra no mesmo milestone. |
| Base a reutilizar | CURRENT | Investimentos: ledger único, centavos/micros, idempotência determinística e projeções no mesmo commit (`functions/src/investments/operationsV2.ts:328-457`). Cartões: 9 callables transacionais (`functions/src/creditCards/callables.ts:102-193`). Metas: callables transacionais com auditoria (`functions/src/goals/operations.ts:64-141`). |

**Invariantes globais (TARGET).** Todo milestone financeiro deve provar estas regras com testes:

1. Todo valor monetário persistido é inteiro em centavos BRL (`*Cents`, `Number.isSafeInteger`). Quantidades e preços unitários usam micros.
2. Toda escrita autoritativa acontece em callable, cron ou trigger com Admin SDK. As Rules da coleção têm `write: false`.
3. Cada grandeza tem uma única fonte de verdade e uma única fórmula de reconstrução, implementada no backend (§5).
4. Uma operação composta é uma única transação Firestore. Nenhum estado dependente (pago, gerado, recebido, quitado) é gravado sem o registro que o justifica no mesmo commit.
5. Toda operação sujeita a retry é idempotente: chave estável por intenção, IDs derivados determinísticos, replay com o mesmo resultado e conflito se o payload divergir.
6. Não há hard delete de histórico financeiro. Cancelamento, estorno e arquivamento são registros compensatórios com vínculo nos dois sentidos.
7. Toda mutação grava um evento append-only com ator, workspace, PF/PJ, antes/depois, motivo e `correlationId`.
8. Datas civis de negócio são chaves `YYYY-MM-DD` em `America/Sao_Paulo`. Instantes são `Timestamp` do servidor (§3).
9. Todo fluxo que afeta cartão passa pelo serviço de compra do domínio de cartões.
10. PF/PJ é explícito: o tipo do workspace é lido no servidor, e um comportamento exclusivo de PJ é validado no backend.
11. Um domínio substituído não deixa write path, reader, fallback, flag nem Rule antiga ([política de legado](PRODUCTION_READINESS_PLAN.md#política-de-legado)).

---

## 2. Política monetária

### 2.1 Regras

| Regra | Classificação | Definição e evidência |
| --- | --- | --- |
| Unidade | TARGET | Centavos inteiros BRL em campos `*Cents`, validados por Zod `z.number().int().safe()` com teto explícito por campo. Não há campo monetário em reais. |
| Unidade (hoje) | CURRENT | Só investimentos seguem a regra (`functions/src/investments/contracts.ts:20-32`; `firestore.rules:491-494`). Os demais domínios gravam reais em float (§2.2). |
| Quantidade e preço unitário | CURRENT (investimentos) → TARGET (geral) | `quantityMicros` e `unitPriceMicros` inteiros (`functions/src/investments/domain.ts:128-162`). |
| Percentuais e taxas | TARGET | Pontos-base inteiros (rateio percentual, margem de meta PJ, juros). O modelo de juros depende de D-13. |
| Parse | TARGET | Só na borda da UI: string para centavos por dígitos, recusando fração de centavo. O backend recebe inteiros. CURRENT como referência: `src/modules/investments/simple/form.ts:36-40` (parse por dígitos) e `functions/src/goals/operations.ts:143-152` (`toMinorUnits` recusa mais de 2 casas). |
| Alocação | TARGET | Uma função `allocate(totalCents, pesos)` por maior resto, com desempate determinístico por índice. A soma é igual ao total por construção. Vale para parcelas de cartão, rateios, parcelas de empréstimo e recorrência rateada. CURRENT: cartões põem o resto na última parcela (`functions/src/creditCards/createPurchase.ts:265-293`); split e empréstimos não distribuem o resto (PR-SPLIT-05, PR-LOAN-06). |
| Arredondamento | TARGET | Só em cálculo derivado (valoração, juros), com uma regra única half-up sobre inteiros e `BigInt` quando o produto passar de 2^53. CURRENT: a valoração de investimentos já segue isso (`functions/src/investments/math.ts:29-42`; versão `investment-v2-cents-micros-half-up` em `functions/src/investments/domain.ts:4-5`). |
| Soma e comparação | TARGET | Sempre em inteiros com verificação de overflow. CURRENT em investimentos: `addExact`/`negateExact` (`functions/src/investments/math.ts:23-27`). |
| Sinal | TARGET | O valor persistido é positivo, e a direção vem do tipo do movimento ou de `cashImpact` (`inflow`/`outflow`/`none`), como já faz o espelho de investimentos (`functions/src/cash/periods.ts:120-149`). |
| Moeda | DECISION (D-16, tomada) | Somente BRL; `Workspace.currency` gravável deixa de ser aceito do cliente. CURRENT: o campo é gravável e nenhum formatador o lê (`src/types.ts:32`; `firestore.rules:102-104,132-133`); investimentos exigem `BRL` (`firestore.rules:487-489`). GAP: MONEY-13 (LOW). |
| Formatação | TARGET | `Intl.NumberFormat('pt-BR', {currency: 'BRL'})` só na exibição. |
| Módulo único | GAP (PR-MONEY-01) | TARGET: `functions/src/shared/money.ts` e `src/lib/money.ts`, com o mesmo contrato e teste de paridade (P1). CURRENT: não existe. Há 12 cópias de `normalizeMoney` nas Functions e 4 no frontend, além de `Math.round(v*100)` e `toFixed`, e os três divergem (1,005 vira 1,01, 100 centavos ou 1,00) (MONEY-11). |

**DECISION D-34 (tomada, §9.1 do plano):** centavos inteiros com `Number.isSafeInteger`; entrada com fração abaixo do centavo é recusada; a divisão usa o maior resto, as partes sempre somam exatamente o total e os empates são resolvidos pelo menor índice primeiro. Hoje metas recusam e cartões arredondam.

### 2.2 Estado por domínio (varredura monetária)

| Domínio | Classificação | Representação e escritor | Evidência | GAP |
| --- | --- | --- | --- | --- |
| Caixa | CURRENT | `value` em reais (int ou float, >0, ≤1e9) gravado pelo cliente. `valueCents` é opcional e só o backend o grava. A projeção converte com `Math.round(value*100)`. | `src/types.ts:164-165`; `firestore.rules:210-212`; `src/components/TransactionModal.tsx:918`; `functions/src/cash/periods.ts:73-80` | PR-TX-01 |
| Cartões | CURRENT | Reais em float em compras, parcelas, faturas, limite e ledger. O Zod aceita qualquer float positivo, `normalizeMoney` arredonda em silêncio e o cliente grava `limitTotal` como int ou float. | `functions/src/creditCards/contracts.ts:18-26`; `functions/src/creditCards/createPurchase.ts:99-100`; `firestore.rules:950-951` | PR-CC-06 |
| Recorrentes | CURRENT | `valorPadrao` vem de `parseFloat`, é gravado sem schema e o cron o copia com `Number(valorPadrao)` para `transactions.value`. | `src/components/RecurringExpenseFormModal.tsx:183`; `functions/src/crons/recurring.ts:333` | PR-REC-06 |
| Divisão de contas | CURRENT | `valorReal`, `valorDevido` e `valorPago` em float. A divisão igual é `total/count` sem arredondamento. | `src/types.ts:332-333,351-352`; `src/modules/split-bills/logic.ts:33-54` | PR-SPLIT-05 |
| Empréstimos | CURRENT | `principalValue`, `currentBalance` e `amount` em float. Cada parcela é arredondada com `toFixed(2)`, sem resto. | `src/modules/loans/types.ts:46-49`; `src/modules/loans/logic.ts:15-36`; `src/modules/loans/pj-logic.ts:34-60` | PR-LOAN-06 |
| Recebíveis | CURRENT | `value` float de `parseFloat`, sem `min`, somado em float. | `src/modules/clients/types.ts:20`; `src/components/ReceivableFormModal.tsx:46,100-101` | PR-CR-04 |
| Investimentos | CURRENT | Centavos e micros inteiros. O espelho em `transactions` grava `value = valueCents/100` junto com `valueCents`. | `functions/src/investments/contracts.ts:20-32`; `functions/src/investments/operationsV2.ts:483-494` | — (espelho: PR-INV-01) |
| Metas | CURRENT | O backend converte com `toMinorUnits`, mas persiste float e centavos lado a lado, e a UI lê o float. | `functions/src/goals/operations.ts:167-185`; `src/modules/goals/projection.ts:18-20` | MONEY-09 (MEDIUM); PR-GOAL-01 |
| Relatórios | CURRENT | Somam `value` float misturado com `cents/100` e comparam alertas em float. | `src/modules/investments/semantics.ts:89-104`; `src/modules/reports/logic.ts:84-91,158-160` | MONEY-10 (MEDIUM); PR-RPT-02 |

---

## 3. Política temporal

### 3.1 Regras

| Regra | Classificação | Definição |
| --- | --- | --- |
| Fuso canônico | DECISION (D-17, tomada) | `America/Sao_Paulo` para toda chave de data civil, em todos os domínios; nunca derivar data civil com `toISOString()`. |
| Data civil de negócio | TARGET | Competência do lançamento, vencimento, recebimento, compra e início/fim de recorrência usam a chave `YYYY-MM-DD`, validada no servidor. O mês de competência (`YYYY-MM`) é derivado dela pela mesma função. |
| Instante | TARGET | `createdAt`, `occurredAt`, `settledAt`, `voidedAt` e `archivedAt` são `Timestamp` do servidor, nunca do relógio do cliente. |
| Um campo por fato | TARGET | Cada fato tem uma data civil. Sai a dupla `date` + `transactionDate` de `transactions` (TX-12). |
| Janelas | TARGET | Um módulo único calcula os limites inclusivos por chave civil no servidor. O frontend só espelha para exibição. |
| Proibido | TARGET | `new Date('YYYY-MM-DD')`, `toISOString().slice(0, 10)` como "hoje" e `new Date(ano, mês, dia)` local como limite de período. |
| Helpers do backend | CURRENT | `saoPauloDayKey`, `saoPauloMonthKey`, `saoPauloDayStart` e `saoPauloMonthStart` (`functions/src/shared/dateKeys.ts:21-58`), usados pela projeção de caixa (`functions/src/cash/periods.ts:153-167`) e pelo cron de recorrentes (`functions/src/crons/recurring.ts:146-147`). |
| Espelho no frontend | CURRENT | `src/modules/reports/dateWindow.ts:16-107`, com fuso fixo e teste (`tests/unit/report-window.test.ts`). |

### 3.2 Definições concorrentes hoje

**GAP.** Hoje convivem três definições de janela de relatório e vários cálculos de "hoje" fora do fuso canônico. A consolidação está em PR-REC-05, que agrupa REC-06, CR-11 e RPTAI-12.

| Contexto | Classificação | Definição atual | Evidência | GAP |
| --- | --- | --- | --- | --- |
| Janela principal de relatório | CURRENT | São Paulo; 7d = −7, 30d = −30 e 12m = −365 dias | `src/modules/reports/dateWindow.ts:95-107` | RPTAI-12 (em PR-REC-05) |
| Janela patrimonial | CURRENT | São Paulo; 7d = −6, 30d = −29 e 12m = início de 12 meses | `src/modules/reports/investments.ts:20-31` | RPTAI-12 |
| Janela das views de cartão | CURRENT | Hora local do navegador | `src/modules/reports/logic.ts:517-553` | RPTAI-12 |
| "Hoje" nos indicadores e na carga de transações | CURRENT | UTC via `toISOString` | `src/modules/reports/logic.ts:290,358`; `src/modules/transactions/api.ts:149-153` | RPTAI-12 |
| Datas de recorrência | CURRENT | Gravadas como meia-noite UTC e lidas pelo cron como o dia anterior | `src/modules/recurring-expenses/api.ts:198-199,224-225`; `functions/src/crons/recurring.ts:146-147` | PR-REC-05 |
| Vencimento de recebível | CURRENT | "Hoje" em UTC e exibição do dia anterior | `src/components/ClientsReceivablesView.tsx:39,121` | CR-11 (em PR-REC-05) |
| Período de meta PJ | CURRENT | Limites em hora local comparados com `new Date(t.date)` em UTC | `src/modules/goals/logic.ts:7-25,41-44` | PR-GOAL-03 |
| Mês da transação na projeção | CURRENT | Usa `transactionDate` antes de `date`. O cliente grava `transactionDate` sem validação de tipo nem de coerência. | `functions/src/cash/periods.ts:153-167`; `firestore.rules:67-76` | TX-12 (MEDIUM) |
| Conversão genérica no frontend | CURRENT | `Timestamp` e `Date` convertidos para data com `toISOString` (UTC) | `src/utils/date.ts:22,29,33` | RPTAI-12 |

---

## 4. Semântica dos movimentos

Cada movimento tem uma classe contábil, e o efeito sobre caixa, patrimônio, passivo e resultado decorre dessa classe, nunca do rótulo exibido na tela. `TransactionType` hoje é `'receita' | 'despesa' | 'investimento' | 'parcelado'` (`src/types.ts:44`).

| Movimento | CURRENT (registro e efeito) | TARGET | GAP |
| --- | --- | --- | --- |
| Receita | `transactions` `receita`, float, gravada pelo cliente. Na projeção, soma em `incomeCents` (`functions/src/cash/periods.ts:100-108`). | Lançamento de caixa em `amountCents`, criado por callable. Entrada de caixa e receita do período. | PR-TX-01 |
| Despesa de consumo | `despesa`. A projeção a conta sempre; o frontend a ignora quando `isPaid === false` (`functions/src/cash/periods.ts:109-117`; `src/modules/investments/semantics.ts:38-41`). | Saída de caixa e despesa. O efeito de `isPaid` depende do regime (DECISION D-29). | PR-TX-03 |
| Aporte | Movimento `contribution` no ledger. O espelho `investimento` tem `cashImpact` de saída e vai para `investmentOutflowCents`, fora das despesas (`functions/src/investments/domain.ts:25-30`; `functions/src/cash/periods.ts:141-149`). | Alocação de patrimônio, não despesa: sai do caixa e entra no principal da posição. | PR-INV-01 (leitura pelo espelho) |
| Resgate de principal | `redemption` liquidado com `principalCents` (custo retirado da posição) e espelho de entrada (`functions/src/investments/contracts.ts:68-72`; `functions/src/cash/periods.ts:131-139`). | Conversão de ativo em caixa, não receita. Reduz o principal da posição. | — |
| Rendimento realizado | `gainCents` ou `lossCents` no resgate, nunca os dois (`functions/src/investments/contracts.ts:93-100`), levados a `realizedGainDeltaCents` (`functions/src/investments/domain.ts:88`). | Resultado financeiro reconhecido na liquidação do resgate, separado do principal. | — |
| Valorização não realizada | A valoração (`investment_valuations`, `unitPriceMicros`) não cria movimento nem espelho de caixa. Muda só `currentValueCents` e `unrealizedAppreciationCents` (`functions/src/investments/operationsV2.ts:2843-2846`; `functions/src/investments/domain.ts:142-143`). | Sem efeito de caixa nem de resultado realizado. Só o patrimônio muda. | — |
| Taxa e imposto de investimento | `feesCents` e `taxCents` no movimento e na posição. Caixa do resgate = principal + ganho − perda − taxas − imposto (`functions/src/investments/domain.ts:83-84`; `functions/src/investments/operationsV2.ts:1358-1362`). | Mantém: deduzidos do caixa do resgate, não viram despesa de consumo. | — |
| Transferência entre contas próprias | Não existe tipo. `'transferencia'` só aparece como forma de pagamento da divisão de contas (`src/types.ts:278-283`). `walletId` é rótulo sem validação (INV-13, CC-12). | Não é receita nem despesa. Só pode ser modelada depois da DECISION D-30 (contas/carteiras e transferências). Até lá, nenhum domínio grava transferência como receita ou despesa. | — |
| Principal de empréstimo | Na contratação, o cliente grava `despesa` "Empréstimos concedidos" (`lend`) ou `receita` "Empréstimos recebidos" (`borrow`), fora de transação (`src/components/LoanFormModal.tsx:75-89`; `src/components/PJLoanFormModal.tsx:86-102`). | Movimento de principal: entrada ou saída de caixa com passivo ou ativo correspondente. Não é receita nem despesa de consumo. | PR-LOAN-03; classificação do principal: DECISION D-13 |
| Parcela de empréstimo | O cliente grava o valor total (principal + juros) como `receita` ou `despesa` (`src/components/LoanDetailsView.tsx:61-74`; `src/components/PJLoanDetailsView.tsx:70-76`). O saldo desconta principal + juros no PF (`src/modules/loans/api.ts:355-357`). | Separar `principalCents` (amortiza o saldo) de `interestCents` (despesa ou receita financeira). Um espelho de caixa pelo total. | PR-LOAN-02, PR-LOAN-06 |
| Recebimento de recebível | Só muda `status` para `paid`, sem caixa (`src/components/ClientsReceivablesView.tsx:115-118`). | Entrada de caixa (`receita` com `origin: 'receivable'`) na mesma transação que muda o recebível para `received`. | PR-CR-03 |
| Compra no cartão | `credit_card_purchases` + parcelas + faturas + ledger de limite, sem caixa (`functions/src/creditCards/createPurchase.ts:434-813`). Caminho legado: `parcelado` em `transactions`, que a projeção conta como saída de caixa (`functions/src/cash/periods.ts:109`). | Passivo do cartão, sem efeito de caixa na compra. O único caminho é o serviço de compra do domínio de cartões. | PR-TX-06 |
| Pagamento de fatura | `credit_card_invoice_payments` + espelho `despesa` em float em `transactions`, na mesma transação (`functions/src/creditCards/registerInvoicePayment.ts:407-429`). | Saída de caixa que liquida o passivo do cartão. O espelho é imutável para o cliente, e a classificação de caixa × competência segue a DECISION de regime. | PR-TX-02 |
| Estorno | Transação: baixa lógica `voidedAt` com delta zero (`functions/src/cash/periods.ts:95`). Pagamento de fatura: espelho `receita` compensatório, sem baixar o espelho original (`functions/src/creditCards/reverseInvoicePayment.ts:447-469`). Investimento: movimento compensatório com vínculo bidirecional (`functions/src/investments/operationsV2.ts:1637-1646,1780-1788`). Estorno de aporte vira `redemption` no espelho, e o espelho do aporte original não muda (`functions/src/investments/operationsV2.ts:1847-1856`). Empréstimo: não existe (PR-LOAN-06). | Registro compensatório com `reversalOf`/`reversedBy`, motivo e ator, na mesma transação dos efeitos derivados. Nunca editar nem apagar o original. | PR-INV-01; PR-LOAN-06 |

---

## 5. Fonte de verdade e reconstrução

### 5.1 Grandezas

| Grandeza | Fonte de verdade e fórmula (TARGET) | CURRENT | GAP |
| --- | --- | --- | --- |
| Caixa do período | Ledger `transactions` em `amountCents`, escrito só pelo backend. `cash_report_periods[mês] = Σ efeito(t)` sobre os `t` não baixados com chave civil no mês. `efeito` é uma única função do backend: receita +, despesa −, aporte −, resgate liquidado +, `none` 0. Reconciliação agendada com alerta. | A projeção existe em centavos, com dedupe por `event.id` (`functions/src/triggers/transactions.ts:35-79`; `functions/src/cash/periods.ts:335-363`). A projeção diverge das três fórmulas do frontend e do log do gatilho (§5.2), e o ledger é escrito pelo cliente em float. | PR-TX-01, PR-TX-03, PR-TX-04 |
| Fatura | `credit_card_invoices`: `totalCents = Σ` parcelas não canceladas alocadas à fatura; `paidCents = Σ` pagamentos − estornos; `remainingCents = totalCents − paidCents ≥ 0`. O ciclo (`open/closed/cancelled`) fica separado do pagamento (`unpaid/partial/paid/overdue`). | Backend autoritativo em float. Um único `status` (`open`, `closed`, `partial_paid`, `paid`, `overdue`, `cancelled`) mistura ciclo e pagamento (`src/modules/credit-cards/domain/types.ts:55-61`; `functions/src/creditCards/registerInvoicePayment.ts:131-138`). O cron de vencidas grava sem reler a fatura (`functions/src/crons/creditCardInvoices.ts:249-276`). | PR-CC-04, PR-CC-05, PR-CC-06 |
| Limite do cartão | `card_limit_snapshots`: `limitAvailableCents = limitTotalCents − Σ card_limit_ledger` (consumo − liberação). O limite total muda só por lançamento de ajuste no ledger. | `limitTotal` vem do documento que o cliente grava. O snapshot só é recalculado por callable manual (`functions/src/creditCards/recalculateCardLimit.ts:190-199`). A tela tem fallback por `transactions` (`src/components/CreditCardsView.tsx:764-771`). | PR-CC-02, CC-13 (em PR-CC-07) |
| Saldo de empréstimo | `balanceCents = principalCents − Σ principal amortizado` nos movimentos não estornados. Status derivado: `paid` se saldo = 0; `overdue` se há parcela vencida em aberto; `cancelled` é terminal. | `currentBalance` em float, gravado pelo cliente. PF desconta principal + juros; PJ reescreve o saldo com um snapshot antigo (`src/modules/loans/api.ts:340-369`; `src/components/PJLoanDetailsView.tsx:88-101`). `overdue` nunca é gravado (PR-LOAN-06). | PR-LOAN-01, PR-LOAN-02, PR-LOAN-06 |
| Recebíveis em aberto | `Σ amountCents` dos recebíveis `open`. O atraso é derivado de `dueDate` < hoje (SP) por uma função única. `received` implica receita vinculada. | O status `paid` fica desvinculado do caixa. `overdue` é um status escolhido à mão no formulário e é o que os relatórios usam, enquanto a tela do domínio deriva o atraso em UTC (`src/components/ReceivableFormModal.tsx:122-131`; `src/modules/reports/logic.ts:163-165,711`; `src/components/ClientsReceivablesView.tsx:39,50`). | PR-CR-03, CR-10 (MEDIUM) |
| Patrimônio | `investment_movements` liquidados e não cancelados são agregados na posição (`principalCents`, `realizedGainCents`, `feesCents`, `taxCents`, `quantityMicros`). `currentValueCents` é o valor da valoração (`quantityMicros × unitPriceMicros`, half-up) ou, sem valoração, `principalCents`. Resumo = Σ posições. | Implementado, com projeções no mesmo commit (`functions/src/investments/math.ts:29-51`; `functions/src/investments/operationsV2.ts:328-457`). A deriva é medida só entre projeções (INV-05). Dashboard e gráfico leem aportes pelo espelho. | PR-INV-01, INV-05 (MEDIUM) |
| Progresso de meta | `investmentProgressCents`: com `net_contributions`, `Σ goalNetContributionDeltaCents`; com `current_value`, `Σ currentValueCents` das posições vinculadas. Meta KPI PJ (se mantida): projeção a partir de `cash_report_periods`. | O progresso patrimonial é publicado pelo ledger (`functions/src/investments/operationsV2.ts:279-326`), mas coexistem campos manuais em float e centavos (`functions/src/goals/operations.ts:155-185`). As metas PJ são calculadas no navegador (`src/modules/goals/logic.ts:30-76`). | PR-GOAL-01, PR-GOAL-03 |

### 5.2 Fórmulas de caixa concorrentes (CURRENT)

| Onde | Regra | Evidência |
| --- | --- | --- |
| Projeção oficial `cashPeriodDeltaFor` | Conta despesa e `parcelado` sem olhar `isPaid`. Investimento sem metadata é sempre saída. Transação baixada tem delta zero. | `functions/src/cash/periods.ts:89-150` |
| `transactionCashImpactCents` (frontend) | Despesa com `isPaid === false` vale 0. Investimento sem metadata só conta se `isPaid !== false`. | `src/modules/investments/semantics.ts:26-49` |
| `summarizeCashFlow` (dashboard) | Receitas e despesas somam `value` float, incluindo itens não pagos. O saldo usa o impacto em centavos/100. O dashboard esconde a projeção de faturas, mas não o `parcelado` legado. | `src/modules/investments/semantics.ts:89-104`; `src/App.tsx:508-516` |
| Relatórios `buildCashAccountingTransactions` | Excluem as projeções de fatura, o `parcelado` legado e os pares pagamento/estorno identificados pela palavra "estorno" na descrição. | `src/modules/reports/logic.ts:35-43`; `src/modules/credit-cards/compatibility/transactionProjection.ts:48-56` |
| Log do gatilho `getSignedBalanceValue` | Float, ignora `isPaid`. | `functions/src/triggers/transactions.ts:21-33` |

**GAP:** PR-TX-03. **TARGET:** uma função de efeito de caixa no backend, usada pelo gatilho ou pela callable, pelo rebuild e pelos agregados. O cliente só lê. Teste de paridade entre a projeção e os valores exibidos. **DECISION:** D-29 (regime de caixa ou competência); via de atualização da projeção: D-38.

---

## 6. Atomicidade e idempotência

### 6.1 Padrão alvo (TARGET)

O fluxo passo a passo de uma callable transacional idempotente está em [ARCHITECTURE.md](ARCHITECTURE.md). Regras de domínio que valem para todas:

- **Uma transação por operação.** A transação grava o documento do domínio, o espelho de caixa (quando houver), a projeção, o evento de auditoria e o registro de idempotência. Uma operação entre domínios chama o *serviço interno* do outro domínio dentro da mesma transação; uma callable nunca chama outra callable.
- **Chave de idempotência.** A chave é gerada uma vez por intenção, ao abrir o formulário, e reutilizada em retries.
  - O documento de idempotência fica no caminho do workspace, com ID `operação + hash(uid, chave)`, `requestHash` sem `correlationId` e `expiresAt`.
  - O registro é reservado antes das pré-condições de domínio, para que um replay devolva o resultado salvo em vez de reavaliar o estado.
  - Payload divergente gera conflito.
  - CURRENT: investimentos seguem esse padrão (`functions/src/investments/infrastructure.ts:73-74,219-327`). Metas também, mas sem `expiresAt` (`functions/src/goals/operations.ts:64-117`). Cartões põem o payload inteiro no hash, inclusive `correlationId`, e não têm TTL (`functions/src/creditCards/idempotency.ts:70-126`).
- **IDs derivados determinísticos**, criados com `create()` para que a duplicidade falhe por construção. Exemplos: parcela e fatura de cartão (`functions/src/creditCards/createPurchase.ts:297-306`), transação do cron recorrente (`functions/src/crons/recurring.ts:352-355`).
- **Concorrência.** O papel é relido dentro da transação (padrão CURRENT `functions/src/investments/infrastructure.ts:152-205`). Edição com `expectedVersion`. Contadores, saldos e limites são lidos e escritos na mesma transação. Documento quente por workspace/mês exige teste de contenção (INV-07).
- **Botão de envio** desabilitado enquanto a chamada está pendente, e a mensagem de erro em pt-BR vem do código retornado pelo backend.

### 6.2 Operações compostas hoje

| Operação | Classificação | Estado | Evidência | GAP |
| --- | --- | --- | --- | --- |
| Compra no cartão | CURRENT | Atômica e idempotente no backend, mas a chave é nova a cada submit. As checagens de cartão ativo e de limite rodam antes da reserva de idempotência, então um replay depois do sucesso pode ser recusado por limite já consumido. | `functions/src/creditCards/createPurchase.ts:434-813,457,495,539`; `src/components/TransactionModal.tsx:787-791,860` | PR-CC-03; a ordem reserva × pré-condição não tem achado próprio (tratar no kernel P1 e em P4) |
| Pagamento e estorno de fatura | CURRENT | Atômicos, com o espelho de caixa no mesmo commit | `functions/src/creditCards/registerInvoicePayment.ts:407-429`; `functions/src/creditCards/reverseInvoicePayment.ts:447-469` | PR-TX-02 (espelho mutável) |
| Movimento de investimento | CURRENT | Atômico: ledger, posição, resumo, período, meta e espelho | `functions/src/investments/operationsV2.ts:279-566` | — |
| Metas (criar, editar, arquivar) | CURRENT | Atômicas, com idempotência e auditoria; o papel é lido fora da transação | `functions/src/goals/operations.ts:64-212`; `functions/src/goals/callables.ts:22-30` | GOAL-13 (LOW) |
| Lançamento de caixa | CURRENT | `addDoc` com ID aleatório, sem chave de idempotência nem guarda de envio | `src/modules/transactions/api.ts:258`; `src/components/TransactionModal.tsx:1416` | PR-TX-01 |
| Projeção de caixa | CURRENT | Dedupe por `event.id` na transação, mas sem retry declarado e sem cerca de versão no rebuild | `functions/src/cash/periods.ts:335-363`; `functions/src/shared/runtimeOptions.ts:41-44`; `functions/src/cash/rebuild.ts:211-235` | PR-TX-04 |
| Contratar empréstimo | CURRENT | Duas escritas soltas (caixa sem await, depois o contrato) com `loanId` temporário | `src/components/LoanFormModal.tsx:47,78-89`; `src/modules/loans/api.ts:214-221` | PR-LOAN-03, PR-LOAN-05 |
| Pagamento de empréstimo PJ | CURRENT | Três escritas: caixa, movimento (transação do cliente) e `updateLoan` com snapshot antigo; há corrida | `src/components/PJLoanDetailsView.tsx:73-101` | PR-LOAN-02 |
| Recebimento | CURRENT | Só troca o status; não há caixa | `src/components/ClientsReceivablesView.tsx:115-118` | PR-CR-03 |
| Geração manual de recorrência | CURRENT | Três escritas (caixa sem await, título de divisão, ocorrência). As Rules negam a transação, mas a ocorrência fica marcada como gerada | `src/components/RecurringExpenseDetailsView.tsx:97-172` | PR-REC-02 |
| Cron de recorrência | CURRENT | Batch com a transação e a ocorrência, mas lê a ocorrência fora da transação e usa `set` em vez de `create()` | `functions/src/crons/recurring.ts:471-521` | REC-10 (MEDIUM) |
| Título de divisão + lançamento | CURRENT | Duas mutações independentes no cliente, sem vínculo nem idempotência | `src/components/SplitGroupDetailsView.tsx:100-166` | PR-SPLIT-03 |
| Exclusões em cascata | CURRENT | Cliente, empréstimo e grupo apagam em lotes não atômicos; o grupo falha no meio por causa dos convites | `src/modules/clients/api.ts:81-89`; `src/modules/loans/api.ts:256-284`; `src/modules/split-bills/api.ts:194-233` | PR-CR-02, PR-LOAN-04, PR-SPLIT-02 |

---

## 7. Domínios

Cada subseção traz CURRENT, TARGET, invariantes, GAP, legado a remover e testes obrigatórios. Os nomes de callables em TARGET são os propostos pela auditoria; o nome final é fixado no milestone. Os testes obrigatórios somam-se aos sete itens comuns da §8.

### 7.1 Caixa (`transactions`) — P3 (PR-TX-06 em P4)

**CURRENT**
- O cliente cria, edita e baixa: `addDoc` (`src/modules/transactions/api.ts:258`), `writeBatch` (`:274-311`), `updateDoc` (`:313-330`) e baixa lógica com `voidedAt` (`:354-359`). Não existe callable de transação (`functions/src/index.ts:14-37`).
- As Rules têm allowlist de chaves (`firestore.rules:67-76`), campos mutáveis sem `type` (`firestore.rules:89-99`), baixa validada (`firestore.rules:255-263`) e `delete: false` (`firestore.rules:1094`). Os tipos aceitos incluem `parcelado` (`firestore.rules:40-42`).
- Há outros escritores no backend: o espelho de investimentos (`functions/src/investments/operationsV2.ts:462-566`), o pagamento e o estorno de fatura (`functions/src/creditCards/registerInvoicePayment.ts:407-429`; `functions/src/creditCards/reverseInvoicePayment.ts:447-469`) e o cron recorrente (`functions/src/crons/recurring.ts:322-355`).
- A projeção `cash_report_periods` é mantida por gatilho idempotente (`functions/src/triggers/transactions.ts:35-79`). O rebuild é uma callable de owner/admin, paginada e com dry-run (`functions/src/cash/rebuild.ts:247-274`).
- A leitura usa páginas de 500, teto de 40 páginas e janela de 12 meses (`src/modules/transactions/api.ts:117-128`).

**TARGET**
- Callables `createCashTransaction`, `updateCashTransaction` e `voidCashTransaction` sobre o wrapper do kernel. Cada uma recebe `amountCents`, `idempotencyKey`, `date` (chave civil) e `expectedVersion` (na edição).
- Na mesma transação: o documento `transactions/{id determinístico}`, um evento append-only em `financial_events` (antes/depois, ator, motivo, `correlationId`), o delta de `cash_report_periods` e a quota `transactionsMonth`.
- Um serviço interno de escrita de caixa é reutilizado por empréstimos, recebíveis, divisão de contas, recorrentes, pagamento de fatura e espelho de investimentos. Cada lançamento carrega `origin` e o ID de origem gravados só pelo backend.
- As Rules ficam com leitura para membro e `write: false`. `type` aceita só `receita`, `despesa` e o espelho `investimento`; `parcelado` sai em P4.
- **DECISION D-35:** correção de lançamento (edição livre, estorno + novo lançamento ou bloqueio por período fechado), inclusive reversão da baixa e aprovação.

**Invariantes:** a soma do efeito das transações não baixadas do mês é igual a `cash_report_periods` do mês. Transação baixada não move caixa e não aceita edição. Vínculos de origem existem no mesmo workspace e só o backend os grava. O cliente não altera espelhos gravados pelo backend.

**GAP:** PR-TX-01 (BLOCKER), PR-TX-02 (BLOCKER), PR-TX-03, PR-TX-04, PR-TX-05, PR-TX-06 (P4), PR-RULES-01 (parte `transactions`), PR-REL-02, PR-ENT-01 (quota; TX-10). MEDIUM/LOW: TX-12 (validação de datas e tamanhos nas Rules), TX-16 (UI fora de pt-BR e `alert()`).

**Legado a remover (P3):** Write path do cliente (`src/modules/transactions/api.ts:250-360`) e Rules de create/update (`firestore.rules:1056-1087`); `value` float junto com `valueCents` (`src/types.ts:164-165`); dupla data `date`/`transactionDate` (`functions/src/cash/periods.ts:153-167`); `profileId` e `walletId` numérico (`firestore.rules:220-223`); campos de vínculo na allowlist do cliente (`firestore.rules:67-76`); fórmulas duplicadas (§5.2); ramo "investimento sem metadata" (`functions/src/cash/periods.ts:141-149`; `firestore.rules:56-58`).

**Testes obrigatórios:** Rules no Emulator negando create, update e baixa a todo papel, inclusive nos espelhos do backend; integração da callable: valor exato em centavos, evento, baixa, replay, duplo envio e edição concorrente com `expectedVersion`; falha injetada entre a transação e a projeção; paridade entre a projeção e os agregados exibidos; virada de mês em São Paulo.

### 7.2 Cartões — P4

**CURRENT**
- Nove callables passam por um wrapper com Zod e papel (`functions/src/creditCards/callables.ts:102-193`), e a matriz de papéis fica em `functions/src/creditCards/writeStrategy.ts:56-208`.
- A compra é uma transação única que bloqueia limite insuficiente (`functions/src/creditCards/createPurchase.ts:434-813,495-505`).
- As Rules têm `write: false` em compras, parcelas, faturas, pagamentos, ledger, snapshots, eventos e views (`firestore.rules:1121-1174`).
- O cadastro `credit_cards` é gravado pelo cliente, com delete físico por owner/admin (`firestore.rules:1107-1119`; `src/modules/credit-cards/api.ts:65-101`).
- O cron diário das 07:00 (São Paulo) marca faturas vencidas e não fecha ciclo (`functions/src/crons/creditCardInvoices.ts:232-350`).
- A UI projeta faturas como pseudo-transações a partir de `invoice_views` com limite de 200 (`src/modules/credit-cards/compatibility/hooks.ts:19-33`).

**TARGET**
- Cadastro por callables `createCreditCard`, `updateCreditCardSettings`, `changeCreditCardLimit`, `changeCreditCardStatus` e `archiveCreditCard`. O snapshot de limite nasce com o cartão, e o limite muda só por ajuste no ledger.
- Campos em centavos: `limitTotalCents`, `totalAmountCents`, `amountCents`, `paidAmountCents`, `remainingAmountCents`. `installmentsCount` tem teto no contrato.
- A fatura tem `lifecycleStatus` (`open`/`closed`/`cancelled`) e `paymentStatus` (`unpaid`/`partial`/`paid`/`overdue`), com fechamento automático idempotente por `closingDate` no cron. Estorno e rebuild nunca reabrem ciclo.
- O cron relê a fatura dentro da transação e usa cursor persistido.
- A chave de idempotência é gerada por intenção.
- O serviço interno de compra atende Divisão (`source: 'split'`) e Recorrentes (`source: 'recurring'`), valores que o contrato já aceita (`functions/src/creditCards/contracts.ts:33-38`).
- **DECISION D-36:** compra retroativa em ciclo fechado, pagamento antecipado, estorno de compra com parcelas em fatura fechada ou paga. Sem ID no plano: `manual_adjustment` e conta de origem do pagamento.

**Invariantes:** a soma das parcelas é igual ao total da compra. O total da fatura é a soma das parcelas não canceladas, e o saldo é o total menos os pagamentos líquidos de estorno, sempre ≥ 0. O limite disponível é o limite total menos o saldo do ledger, e compras concorrentes não o ultrapassam. Cartão com histórico não é apagado.

**GAP:** PR-CC-01 (BLOCKER), PR-CC-02…PR-CC-08, PR-TX-06, PR-ENT-01 (CC-14). MEDIUM: CC-09 (leituras ilimitadas dentro de transação), CC-12 (conta do pagamento não validada), CC-15 (estorno fora de fatura aberta, `policy` ignorada), CC-16 (lacunas de teste). LOW: CC-17, CC-18, CC-19, CC-20.

**Legado a remover (P4):** Delete e escrita cliente de `credit_cards` (`src/modules/credit-cards/api.ts:65-101`; `firestore.rules:1107-1119`); fallback de limite pelo documento do cartão (`functions/src/creditCards/createPurchase.ts:484-493`) e por `transactions` (`src/components/CreditCardsView.tsx:764-797`); fallback `parcelado` do modal (`src/components/TransactionModal.tsx:868-911`); camada `src/modules/credit-cards/compatibility`, com a heurística de "estorno" (`src/modules/credit-cards/compatibility/transactionProjection.ts:35-87`); domínio duplicado sem uso em `src/modules/credit-cards/domain/`; `writeStrategy.ts` do frontend; operação fantasma `migrateLegacyInstallmentsToInvoiceDomain` (`functions/src/creditCards/writeStrategy.ts:281-304`); nove `manual*Test.ts` e o barrel `functions/src/creditCards/index.ts`.

**Testes obrigatórios:** Suíte de Rules de `credit_cards` (hoje inexistente); N compras concorrentes contra o limite e compra acima do limite; cron com pagamento concorrente; duplo envio de compra (E2E); recusa de fração de centavo e alocação do resíduo; estorno que não reabre ciclo.

### 7.3 Recorrentes — P4

**CURRENT**
- O cron `processRecurring` roda às 02:00 (São Paulo) com checkpoint e varredura de 200 × 50 (`functions/src/crons/recurring.ts:417-424,544-557,571-586`).
- A transação gerada tem ID `rec_{id}_{vencimento}` (`functions/src/crons/recurring.ts:352-355`). É uma `despesa` float com `isPaid: false`, ator de sistema e sem cartão (`functions/src/crons/recurring.ts:322-343`).
- A ocorrência é identificada por mês (`functions/src/crons/recurring.ts:239-242`) e é pulada quando já tem `despesaId` (`functions/src/crons/recurring.ts:479-490`).
- O CRUD é feito pelo cliente (`src/modules/recurring-expenses/api.ts:186-239`), com Rules de escrita livre para member (`firestore.rules:1097-1105`).
- A geração manual no cliente perde o lançamento (`src/components/RecurringExpenseDetailsView.tsx:97-172`).

**TARGET**
- Callables `createRecurringExpense`, `updateRecurringExpense`, `pauseRecurringExpense`, `cancelRecurringExpense` e `generateRecurringOccurrence`, além do cron, com Rules `write: false`.
- Campos: `valorPadraoCents`, e `dataInicio`/`dataFim`/`nextDueDate` como chaves civis gravadas pelo servidor.
- Ocorrência `occ_{id}_{YYYY-MM-DD}` = transação `rec_{id}_{YYYY-MM-DD}`, criadas com `create()` na mesma transação.
- Pagamento no cartão chama o serviço de compra (`source: 'recurring'`, chave = ID da ocorrência), grava `purchaseId` e não cria despesa de caixa.
- O status de pagamento é derivado da transação.
- O cron consulta `nextDueDate <= hoje` com índice e emite evento por geração.
- O calendário fica num módulo puro compartilhado.
- **DECISION:** D-12 (frequências e cobrança no cartão).

**Invariantes:** no máximo uma ocorrência por (recorrência, vencimento). Ocorrência "gerada" implica transação ou compra no mesmo commit. `nextDueDate` só é gravado pelo servidor.

**GAP:** PR-REC-01 (BLOCKER), PR-REC-02 (BLOCKER), PR-REC-03 (BLOCKER), PR-REC-04, PR-REC-05, PR-REC-06, PR-RULES-01 (parte recurring), PR-ENT-01 (REC-14). MEDIUM: REC-08 (duas fontes de agenda; pausa recupera períodos), REC-09 (transbordo 31/01 → 03/03), REC-10 (idempotência e concorrência do cron), REC-11 (custo da varredura e N+1), REC-12 (autoria e auditoria), REC-13 (testes).

**Legado a remover (P4):** `handleGenerate` e a escrita do cliente (`src/modules/recurring-expenses/api.ts:186-243,313-330`); hooks mortos de pausa e exclusão; calendário duplicado (`src/modules/recurring-expenses/logic.ts:4-87` × `functions/src/crons/recurring.ts:120-177`); fallback sem `nextDueDate` e parse polimórfico de datas (`functions/src/crons/recurring.ts:145-152,190-227`); `parseInt(cartaoIdOpcional)`; campos sem efeito e normalização mensal ×4 em float.

**Testes obrigatórios:** Semanal e quinzenal em meses com 4 e 5 vencimentos; 31/01 + 1 mês; dado gravado pelo caminho real da UI, sem semear `T12:00Z`; concorrência entre o cron e a geração por callable; cartão e replay; Rules negando escrita.

### 7.4 Divisão de contas — P4

**CURRENT**
- O backend tem só `createSplitGroupInvite` e `acceptSplitGroupInvite` (`functions/src/callables/splitGroups.ts:100-273`). O papel de dono do grupo é lido de `split_participants`, que qualquer member grava (`functions/src/callables/splitGroups.ts:115-137`; `firestore.rules:1389-1392`).
- Títulos, rateios, status e exclusões são escritas do cliente (`src/modules/split-bills/api.ts:137-380,455-460`).
- Os rateios são float, com tolerância de 0,05 (`src/modules/split-bills/logic.ts:33-54`; `src/components/SplitBillFormModal.tsx:88-95`).
- A identidade no grupo é o nome "Você" (`src/components/SplitGroupDetailsView.tsx:62-68`).
- A integração com o cartão está morta por `parseInt` (`src/components/SplitBillFormModal.tsx:166`).

**TARGET**
- Módulo `functions/src/splitBills/` com callables de grupo, participante, título (`createSplitBill`, `updateSplitBill`, `voidSplitBill`), quitação (`settleSplitShare`), reembolso e `archiveSplitGroup`.
- Campos `amountCents`, `valorDevidoCents` e `valorPagoCents`; percentuais em pontos-base; alocação por maior resto.
- Identidade por `uid` e papel de grupo gravado só pelo backend.
- Agregado de saldo por participante.
- Lançamento via serviço de compra (`source: 'split'`, chave derivada do `billId`) ou via serviço de caixa, na mesma operação, com `purchaseId`/`transactionId` no título e estorno propagado.
- Rules `write: false` em `split_*` e `split_invites`.
- **DECISION:** D-14 (participantes externos e fluxo de reembolso PJ).

**Invariantes:** a soma dos rateios é igual ao total do título, sem tolerância. Só o devedor ou um papel autorizado quita. Editar um título não apaga quitações. Um título gera no máximo um lançamento. Nada é apagado: grupo arquivado, título anulado, participante inativo.

**GAP:** PR-SPLIT-01 (BLOCKER), PR-SPLIT-02 (BLOCKER), PR-SPLIT-03 (BLOCKER), PR-SPLIT-04…PR-SPLIT-07, PR-RULES-01 (parte split), PR-ENT-01 (SPLIT-07). MEDIUM: SPLIT-10 (sem idempotência), SPLIT-11 (reembolso PJ quebrado), SPLIT-12 (N+1), SPLIT-13 (sem auditoria), SPLIT-14 (participação exige membership do workspace inteiro). LOW: SPLIT-15, SPLIT-16.

**Legado a remover (P4):** Escritas e hooks do cliente (`src/modules/split-bills/api.ts:137-380`) e Rules de escrita (`firestore.rules:1384-1402`); `parcelado` e `calculateInstallments` (`src/modules/split-bills/logic.ts:73-84`); heurística "Você"; campos duplicados `valorReal`/`valorPadrao` e `statusPagamento`/`reimbursementStatus`; `SharedExpensesView.tsx` sem uso; quota no cliente, categorias mock e testes tautológicos.

**Testes obrigatórios:** Callables invocadas no Emulator: autenticação, papel no grupo, idempotência, concorrência de quitação e alocação em centavos; Rules negando escrita em `split_*`; integração com o cartão e com o caixa; edição com quitação existente.

### 7.5 Empréstimos — P3

**CURRENT**
- Não há backend: uma busca por "loan" em `functions/src` só encontra testes (por exemplo, `functions/src/shared/__tests__/scaleQueries.integration.test.ts`).
- As coleções são `loans` e `loan_movements` (`src/modules/loans/api.ts:25-26`), com Rules de escrita livre para owner, admin e member (`firestore.rules:443-446,1351-1359`).
- Tipos (`src/modules/loans/types.ts`):
  - direção `lend`/`borrow` (`:2`);
  - status `active`/`paid`/`overdue`/`cancelled` (`:3`);
  - movimento `payment`/`receipt`/`adjustment`/`principal` (`:13`);
  - dinheiro em float (`:46-49`).
- O saldo é recalculado numa transação do cliente (`src/modules/loans/api.ts:340-369`). O PJ reescreve o contrato com um snapshot antigo (`src/components/PJLoanDetailsView.tsx:88-101`).
- O vínculo com o caixa usa ID temporário: `src/components/LoanFormModal.tsx:47,84` e `src/modules/loans/api.ts:214-221`.
- A exclusão é em cascata (`src/modules/loans/api.ts:256-284`).
- A leitura é paginada e os totais vêm de agregado (`src/modules/loans/api.ts:132-207`).

**TARGET**
- Callables `createLoan`, `registerLoanPayment`, `reverseLoanMovement`, `cancelLoan` e `updateLoanMetadata`. Uma transação grava:
  - `loans/{id}` com `principalCents`, `balanceCents`, `totalPaidCents`, `totalInterestCents` e `status`;
  - `loan_movements/{id}` com `amountCents`, `principalCents`, `interestCents` e `reversalOf`;
  - o espelho de caixa com `loanId`/`loanMovementId` reais;
  - a idempotência e o evento.
- Um motor único PF/PJ de amortização em centavos no backend (D-13).
- Um job agendado idempotente marca atraso.
- Cancelamento e estorno são movimentos compensatórios.
- As Rules negam escrita em `loans`, `loan_movements` e nos campos `loanId`/`loanMovementId` de `transactions`.
- **DECISION:** D-13; matriz de papéis por operação: D-02. Sem ID no plano: caixa obrigatório na contratação.

**Invariantes:** o saldo é o principal menos o principal amortizado, sempre ≥ 0. O status é derivado. Cada movimento tem exatamente um espelho de caixa pelo mesmo total, no mesmo commit. Nenhum movimento é apagado.

**GAP:** PR-LOAN-01…PR-LOAN-04 (BLOCKER), PR-LOAN-05…PR-LOAN-07, PR-RULES-01 (parte loans), PR-REL-02, PR-ENT-01 (LOAN-15), PR-CR-05 (dados de contrapartes, LOAN-16, P8). MEDIUM: LOAN-10 (sem auditoria), LOAN-11 (falhas silenciosas), LOAN-12 (`totalLoans` fixo em 0 e cancelados somados), LOAN-13 (UI fora de pt-BR), LOAN-14 (sem testes de escrita).

**Legado a remover (P3):** API do cliente (`src/modules/loans/api.ts:208-284,327-372`) e `updateLoan` como escritor de saldo; cadeia `onAddTransaction` dos componentes; IDs `Date.now()`/`pj_loan_`/`pj_mv_`; cascata de exclusão; campos float e o `toCents` que devolve reais (`src/modules/loans/api.ts:186-203`); lógica duplicada PF/PJ (`src/modules/loans/logic.ts` × `src/modules/loans/pj-logic.ts`); stub `totalLoans: 0` (`src/modules/reports/logic.ts:497`).

**Testes obrigatórios:** Atomicidade com falha injetada; N pagamentos paralelos; replay e RBAC; Rules negando escrita e delete; amortização (soma das parcelas = total, PF e PJ); estorno e cancelamento com o caixa compensado.

### 7.6 Clientes/Recebíveis — P3 (PR-CR-05 em P8)

**CURRENT**
- CRUD do cliente sem nenhum backend (`src/modules/clients/api.ts:49-145`) e Rules que só checam papel (`firestore.rules:1361-1369`).
- O `Receivable` tem `value` float (`src/modules/clients/types.ts:20`) e status `pending`/`paid`/`overdue`/`cancelled` (`src/modules/clients/types.ts:22`). `paymentDate` nunca é gravado (`src/modules/clients/types.ts:24`).
- A cascata de exclusão do cliente não é atômica (`src/modules/clients/api.ts:81-89`).
- As leituras não têm `limit` (`src/modules/clients/api.ts:40-41,97-98`).
- Não há nenhum teste do domínio em `tests/`, `e2e/` nem `functions/src` (PR-CR-04).

**TARGET**
- Callables `createClient`, `updateClient`, `archiveClient`, `createReceivable`, `updateReceivable`, `receiveReceivable`, `cancelReceivable` e o estorno do recebimento; `anonymizeClient` fica em P8.
- O recebível passa a ter `amountCents`, `receivedAmountCents`, `dueDate` e `paymentDate` (chaves civis), `status` (`open`/`received`/`cancelled`), `receivedTransactionId`, autoria e `version`.
- `receiveReceivable` cria, na mesma transação, a `receita` com `origin: 'receivable'`. O estorno baixa essa receita.
- O atraso é derivado. Os totais vêm de agregado do backend. A listagem é paginada com índices.
- Há gate PJ e entitlement no servidor.

**Invariantes:** `received` se e somente se existe uma receita vinculada, não baixada, com `receivedAmountCents`, gravada no mesmo commit. `cancelled` é terminal e fica fora dos totais. O `clientId` existe e está ativo no mesmo workspace. Nada é apagado.

**GAP:** PR-CR-01 (BLOCKER), PR-CR-02 (BLOCKER), PR-CR-03, PR-CR-04, PR-CR-05 (P8), PR-RULES-01 (parte clients/receivables), PR-REL-02, PR-ENT-01 (CR-15). MEDIUM: CR-09 (sem auditoria; relógio do cliente), CR-10 (`overdue` gravado × derivado), CR-12 (falhas silenciosas), CR-13 (edição não implementada; last-write-wins), CR-14 (rótulos em inglês). CR-11 está em PR-REC-05. **DECISION:** D-24 (visibilidade de CPF/CNPJ por papel); D-02 (RBAC por operação). Sem ID no plano: recebimento parcial, juros, multa e desconto. Retenção: D-18; exclusão: D-07.

**Legado a remover (P3):** CRUD direto e `cleanPayload` duplicado; Rules de escrita; cascata e `deleteReceivable`; `useUpdateReceivableStatus` com `as any`; status `overdue` persistido; `paid` desvinculado do caixa; agregações no navegador; fallbacks "Cliente Removido"; erro engolido (`catch → []`).

**Testes obrigatórios:** Suíte de Rules nova, incluída no `predeploy:rules`; recebimento idempotente com retry; dois recebimentos simultâneos; arquivamento sem órfãos; agregados em centavos; E2E do fluxo PJ.

### 7.7 Investimentos — P4 (PR-INV-01); P6 (PR-PLAT-02)

**CURRENT (base sólida)**
- 23 callables com wrapper Zod estrito e papel revalidado na transação (`functions/src/investments/callables.ts:71-104`; `functions/src/investments/infrastructure.ts:152-235`).
- Idempotência determinística com TTL de 90 dias para a chave (`functions/src/investments/infrastructure.ts:73-74,219-305`; `functions/src/shared/retention.ts:29`).
- Operações `contribution`, `redemption`, `reversal`, `goal_link` e `goal_unlink`, com status `pending`/`settled`/`cancelled` (`functions/src/investments/domain.ts:16,25-30`). Só o pendente pode ser cancelado, e o estorno é compensatório (`functions/src/investments/operationsV2.ts:1637-1646,2752-2765`).
- Projeções no mesmo commit que o movimento (`functions/src/investments/operationsV2.ts:328-457`).
- Rules `write: false` (`firestore.rules:1190-1352`).
- Callables legadas travadas por teste (`functions/src/shared/deploymentContract.test.ts:155-178`).
- Só a UI simples está montada (`src/App.tsx:94-96`).

**TARGET**
- O ledger continua sendo a única fonte patrimonial.
- Dashboard, gráfico, relatórios e metas leem só as projeções (`investment_summaries`, `investment_report_periods`, alocações e campos de meta).
- O espelho em `transactions` fica reduzido a um fato de caixa em centavos (`valueCents`, `cashImpact`, `status`, `domainMovementId`), sem breakdown patrimonial. O estorno de aporte fica explícito.
- Entitlement e quota são verificados dentro da transação.
- A deriva é medida contra o ledger em todos os tenants.
- Há piso de data e TTL versionado.
- **DECISION:** D-15 (13 callables e regime `quantity` sem UI). Política do papel viewer sobre valores do espelho (INV-04): D-02.

**Invariantes:** a posição é a agregação dos movimentos liquidados. `currentValueCents` é a valoração ou, sem ela, o principal (`functions/src/investments/math.ts:44-51`). O resumo é a soma das posições. Todo movimento liquidado com caixa tem exatamente um espelho. Um estorno acontece uma vez só.

**GAP:** PR-INV-01, PR-PLAT-02 (BLOCKER, P6), PR-ENT-01 (INV-03). MEDIUM: INV-04 (viewer lê valores pelo espelho), INV-05 (deriva só entre projeções), INV-06 (tetos do rebuild), INV-07 (contenção em singletons), INV-10 (rate limit não conta falhas), INV-11 (TTL não versionado), INV-12 (superfície sem UI). LOW: INV-13…INV-18. INV-08 está em PR-GOAL-01 e INV-09 em PR-GOAL-04.

**Legado a remover (P4, [plano §7](PRODUCTION_READINESS_PLAN.md#7-legado-a-remover)):** Fallback `investimento` sem metadata (`functions/src/cash/periods.ts:118-150`; `src/modules/investments/semantics.ts:21-30`); leitura de aportes pelo espelho (`src/App.tsx:540,557`; `src/modules/reports/logic.ts:89`); grupo `investment_type`; regime `quantity` como padrão (`functions/src/investments/simpleMode.ts:48-55`); UI profissional desmontada, se D-15 decidir remover; nomenclatura V2 residual.

**Testes obrigatórios:** Paridade de aportes com estorno de aporte entre dashboard e relatório; entitlement e quota; wrapper `onCall` (Zod + papel); contenção; deriva contra o ledger; suíte de deriva sem `skip` silencioso (INV-16).

### 7.8 Metas — P5

**CURRENT**
- `createGoal`, `updateGoal`, `archiveGoal` e `seedLegacySettingsCatalog` usam Zod estrito, transação, idempotência e `goal_audit_logs` (`functions/src/goals/callables.ts:22-30,76-81`; `functions/src/goals/operations.ts:64-212`).
- O arquivamento é soft (`functions/src/goals/operations.ts:252-287`).
- O progresso patrimonial é publicado pelo ledger (`functions/src/investments/operationsV2.ts:279-326`).
- As Rules têm `write: false` (`firestore.rules:1176-1188`).
- `listGoals` filtra `archived == false`, campo que nunca é gravado, e trunca em 100 (`src/modules/goals/api.ts:33-70`).
- O progresso das metas PJ é calculado no navegador (`src/modules/goals/logic.ts:30-76`).

**TARGET**
- Contrato em centavos (`targetAmountCents`) e uma única projeção de progresso (§5.1).
- `updateGoal` recalcula a projeção na mesma transação.
- `createGoal` grava `archived: false`, e a listagem é paginada com `limit` exigido nas Rules.
- O arquivamento preserva o status anterior e recusa ou desvincula posições (movimentos `goal_unlink`) de forma atômica.
- Investimentos recusam meta arquivada.
- O status é persistido por callable.
- O papel é relido na transação.
- Quota e rate limit no servidor.
- **DECISION D-31:** semântica de `current_value` (mercado × manual) e permanência das metas KPI PJ.

**Invariantes:** o progresso é reconstruível pelo ledger (`recalculateGoalInvestmentProgress`). A UI lê um único campo de progresso. Meta arquivada não recebe vínculo nem aporte.

**GAP:** PR-GOAL-01…PR-GOAL-04, PR-ENT-01 (GOAL-08). MEDIUM: GOAL-07 (contrato em float), GOAL-09 (timeline sobre 20 movimentos), GOAL-10 (sem deriva de meta), GOAL-11 (testes), MONEY-09. LOW: GOAL-12…GOAL-15.

**Legado a remover (P5):** Consulta `legacy` de `listGoals`; campos manuais `currentAmount`/`currentAmountCents`/`currentValue`/`currentValueCents` e os floats do documento; `calculateBusinessGoalProgress`; timeline no cliente; `profileId`; `seedLegacySettingsCatalog` no módulo de metas (`functions/src/goals/operations.ts:289-393`).

**Testes obrigatórios:** `executeUpdateGoal` com troca de base (hoje sem teste); concorrência das callables; arquivar com posições vinculadas; Rules de `goal_audit_logs`, `goal_idempotency_keys` e `list` sem `limit`; E2E criando e editando pela UI, sem seed manual de `archived`.

### 7.9 Relatórios — P5

**CURRENT**
- O snapshot é calculado no navegador sobre até 20.000 transações e 15.000 documentos de cartão (`src/modules/reports/hooks.ts:85-90,130-259`).
- Só o bloco patrimonial vem de projeção (`functions/src/investments/reporting.ts:209-290`; `src/modules/reports/investments.ts:51-149`).
- `cash_report_periods` não é usado pelos relatórios (`src/modules/transactions/cashPeriods.ts:1-60`).
- Os alertas ficam em memória (`src/modules/reports/logic.ts:697-721`; `src/modules/reports/api.ts:207-209`).
- O id `kpi-net-profit` não existe (`src/modules/reports/logic.ts:177-211,707`).

**TARGET**
- Callable `getFinancialReport(workspaceId, range)` com Admin SDK, lendo só projeções em centavos:
  - `cash_report_periods`, estendida por tipo e categoria;
  - `investment_report_periods`;
  - agregados de cartão, recebíveis e empréstimos.
- Janela única em São Paulo, com flags de truncamento e reconciliação.
- A posição do cartão (fatura aberta, compromissos) independe da janela.
- Alertas gerados por job idempotente, com ID determinístico por regra e período, estado de leitura por `uid` e respeito a `alertPreferences`.
- O perfil PF/PJ é lido de `workspace.type` no servidor.
- **DECISION D-37:** regime e definição dos KPIs, como "Taxa de Poupança".

**Invariantes:** todo número exibido é valor de uma projeção oficial ou função determinística dela. O caixa do relatório é igual a `cash_report_periods` do mesmo período. Não há agregação no navegador sobre documentos crus.

**GAP:** PR-RPT-01…PR-RPT-05, PR-TX-03 (RPTAI-05), PR-REC-05 (RPTAI-12). MEDIUM: RPTAI-13 (falhas viram zero), RPTAI-14 ("Insight IA" estático), RPTAI-17 (rótulos fora de pt-BR), MONEY-10. LOW: RPTAI-18. A IA fica em [SECURITY_MODEL.md](SECURITY_MODEL.md) e [PRIVACY_LGPD.md](PRIVACY_LGPD.md).

**Legado a remover (P5):** KPIs, fluxo e categorias no navegador (`src/modules/reports/logic.ts:80-278`); filtros de compatibilidade de cartão; janelas duplicadas; override de `kpi-investments` pelo espelho; alertas efêmeros e `markAlertAsRead` com `console.log`; atraso artificial de 600 ms (`src/modules/reports/api.ts:40-41`).

**Testes obrigatórios:** KPIs e alertas por perfil PF/PJ e por faixa; paridade relatório × projeção; indicadores de fatura com vencimentos futuros; alerta idempotente; E2E da tela.

---

## 8. Testes obrigatórios comuns e prova de remoção de legado

Todo milestone que toca um domínio deste documento entrega, com evidência, os sete itens de "Mandatory tests" da skill `financial-domain-integrity`: (1) criação; (2) edição com histórico preservado; (3) cancelamento ou estorno com vínculo; (4) retry ou entrega duplicada; (5) concorrência; (6) autoridade, com Rules no Emulator negando a escrita do cliente; (7) atomicidade, com falha injetada entre escritas. Também cobre arredondamento de borda, zero, negativo e máximo, virada de dia e de mês em `America/Sao_Paulo` e registros PF e PJ.

A remoção de legado segue o inventário do [plano §7](PRODUCTION_READINESS_PLAN.md#7-legado-a-remover) e só é aceita com três provas: busca no repositório sem referências restantes, Rules que negam o caminho antigo e teste negativo da escrita legada. Dados de teste são ressemeados no Emulator, não migrados.

---

## 9. Decisões e configuração externa

| ID | Classificação | Tema | Afeta |
| --- | --- | --- | --- |
| D-ORD-01, D-ORD-02, D-ORD-05 | DECISION (tomada) | Caixa abre P3, kernel em P1, quotas incrementais | §1, §2, §7 |
| D-12 | DECISION (pendente) | Frequências de recorrência; cartão automático ou por confirmação | §7.3 |
| D-13 | DECISION (pendente) | Amortização (Price, SAC, simples), juros e diferenças PF/PJ | §4, §7.5 |
| D-14 | DECISION (pendente) | Participantes da divisão de contas e reembolso PJ | §7.4 |
| D-15 | DECISION (pendente) | 13 callables e UI profissional de investimentos | §7.7 |
| D-16 | DECISION (tomada, §9.1 do plano) | Somente BRL | §2.1 |
| D-17 | DECISION (tomada, §9.1 do plano) | Fuso `America/Sao_Paulo` para chaves civis | §3 |
| D-34 | DECISION (tomada, §9.1 do plano) | Resíduo de centavo pelo maior resto (empate pelo menor índice) e recusa de fração | §2.1 |
| D-02 | DECISION (tomada para P1, §9.1 do plano) | `viewer` mantido e somente leitura; as matrizes financeiras das callables existentes não mudam em P1 | §4, §7 |
| D-18, D-07 | DECISION (pendente) | Retenção por categoria; exclusão de conta × histórico financeiro | §7.6, P8 |
| D-29, D-30, D-31, D-35, D-36, D-37, D-38, D-13, D-24 | DECISION (pendente) | Regime de caixa × competência (D-29); contas/carteiras e transferências (D-30); `current_value` e metas KPI PJ (D-31); correção de lançamento (D-35); casos de borda de cartão (D-36); KPIs de relatório (D-37); via única da projeção de caixa (D-38); classificação do principal de empréstimo (D-13); visibilidade de PII de clientes (D-24) | §2–§7 |
| D-39, D-36, D-13 | DECISION (pendente) | Recebimento parcial, juros, multa e desconto de recebível (D-39); fechamento automático de fatura, `manual_adjustment` e conta de origem do pagamento (D-36); caixa obrigatório na contratação de empréstimo (D-13) | §7 |
| E-07 | EXTERNAL CONFIGURATION REQUIRED — NÃO VERIFICADO | PITR, backups e TTL (`expiresAt` de chaves de idempotência, eventos e `cash_period_events`) antes de o histórico passar a não ser apagável | §6, §7 |
| E-08 | EXTERNAL CONFIGURATION REQUIRED — NÃO VERIFICADO | Alertas de deriva e reconciliação, truncamento de crons e falhas do gatilho de caixa | §5, §7 |
| E-01 | EXTERNAL CONFIGURATION REQUIRED — NÃO VERIFICADO | Crons (`processRecurring`, faturas, deriva) e índices implantados por ambiente isolado | §7.2, §7.3 |

Todas as decisões deste documento têm ID no plano mestre: pendentes na §10, tomadas na §9 e na §9.1. As pendentes precisam ser tomadas antes do milestone que as consome.
