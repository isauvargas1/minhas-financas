# P5-F — Matriz de cobertura do tempo de trabalho equivalente (REQ-FUT-01)

> **P5-F.1 (2026-11-04):** a matriz continua valendo sem mudança de classe: 105 pontos T, 18 G e 129 em BRL, com a mesma camada (`calculation.ts`, `presentation.ts`, `display.tsx`). Só muda a origem da configuração: em vez de renda e carga digitadas, a camada recebe a estimativa automática (renda elegível do relatório oficial ÷ horas do calendário dos mesmos meses), uma por contexto, do `WorkTimeProvider`. Enquanto a estimativa carrega, falha ou fica indisponível, todos os pontos mostram o BRL de antes. A guarda `tests/unit/work-time-guard.test.ts` mantém as asserções da matriz (`evidence/p5f1/`).

Montada **antes de codificar**, sobre a base `1730a1df` (árvore `3995eb7f`). Saiu de três inventários somente leitura dos pontos onde o frontend formata dinheiro: Dashboard, Transações e Relatórios; Contas, Cartões, Empréstimos e Recebíveis; Recorrências, Investimentos, Metas, Divisão de contas e Outros. Cada ponto foi classificado. A implementação segue esta matriz, e os testes conferem as duas listas: a dos valores convertidos e a dos que ficam em BRL.

## 1. Critério

O modo tempo é só **camada de exibição**. O número continua em centavos inteiros em toda a aplicação. A conversão acontece na hora de renderizar e nunca é gravada, enviada ao backend, usada para filtrar, ordenar, agregar, exportar ou calcular.

| Classe | Decisão | Quando se aplica |
| --- | --- | --- |
| **T** | Converte no modo tempo | Valor informativo de leitura: saldo, total, resumo, KPI, linha de lista informativa |
| **G** | Converte só o rótulo do eixo e o tooltip | Gráfico. Os dados do gráfico continuam em dinheiro |
| **R-IN** | Fica em BRL | Campo de entrada, valor pré-preenchido, rótulo "(R$)" de formulário, prévia dentro de formulário |
| **R-CF** | Fica em BRL | Confirmação ou prévia de operação financeira: transferência, pagamento, recebimento, ajuste, estorno, cancelamento, resgate, vinculação, reembolso |
| **R-CT** | Fica em BRL | Termo contratual ou preço: principal contratado, juros, cronograma, valor original de recebível, limite do cartão, preço de plano |
| **R-HA** | Fica em BRL | Histórico, auditoria ou livro-razão: extrato, trilha de eventos, histórico de movimentos com estornos |
| **R-TX** | Fica em BRL | Texto composto: alerta e insight dos Relatórios, mensagem de erro ou validação, notificação, resposta da IA |
| **R-PV** | Fica em BRL | Prévia visual com dados fictícios (Personalização do tema) |

Regras de apoio:
- **Sem mistura de unidades num mesmo bloco contratual.** Os números de limite do cartão (total, usado e disponível) ficam todos em BRL, porque o limite é parâmetro do emissor e os outros dois derivam dele, lado a lado. Pela mesma razão, os modais de histórico ficam inteiros em BRL.
- **Fallback.** Valor fora do intervalo seguro, valor inválido, preferência ausente ou com falha de leitura: o ponto mostra o mesmo BRL de antes.
- **Ação na linha (revisão independente, M1).** Valor mostrado ao lado de uma ação que move dinheiro sem exibir o valor em reais fica em BRL (R-CF): ação de um clique ou confirmação sem valor. Exceção: a lista de Transações, principal visão informativa, continua convertida, e a confirmação de anulação passa a trazer o valor exato em reais quando o modo tempo está ativo.
- **Frase composta com valor** (nota de crédito da fatura, "crédito de … a compensar") fica em BRL (R-TX), como os alertas e insights.
- **Acesso ao BRL.** No modo tempo, cada valor convertido traz o BRL exato no `title` (mouse) e no texto para leitores de tela. Um aviso abaixo do Header tem o botão "Mostrar em R$". O alternador do Header fica a um toque.
- **Gráficos com dados em reais (`centavos ÷ 100`).** Relatórios, Dashboard e Divisão recebem do adaptador números de exibição. Para o rótulo e o tooltip, o centavo é recuperado com `Math.round(valor × 100)`, que é exato enquanto |centavos| ≤ 10¹⁵ (prova em `tests/unit/work-time-calculation.test.ts`). Acima desse teto, o ponto mostra BRL. Nenhum dado do gráfico muda.

## 2. Matriz por superfície

Os inventários somaram cerca de 280 pontos com valor monetário; os totais por classe estão na seção 3. As linhas citam o arquivo na base `1730a1df`.

### 2.1 Dashboard (`src/App.tsx`, visão `dashboard`)

| Ponto | Local | Classe | Justificativa |
| --- | --- | --- | --- |
| Cards Saldo Atual, Receitas, Despesas e Investimentos | `App.tsx:513-516` → `SummaryCard.tsx:71` | T | Resumo informativo do mês; centavos em `DashboardFigure.cents` |
| Gráfico de distribuição (tooltip) | `TransactionsChart` → `DistributionChart.tsx:62,71,91` | G | Só tooltip no modo tempo. No modo dinheiro o tooltip continua sem formatador, como na base (achado preexistente, fora do escopo) |
| Recorrências: "Mensal" e top 3 | `RecurringDashboardWidget.tsx:55,87` | T | Resumo informativo |
| KPI do widget de relatórios | `ReportsWidget.tsx:72` | T | Número de painel |
| Alerta do widget | `ReportsWidget.tsx:96` | R-TX | Frase composta pelo adaptador |
| Últimas transações | `RecentTransactions.tsx:216` | T | Lista informativa; centavos em `valueCents` |

### 2.2 Transações

| Ponto | Local | Classe | Justificativa |
| --- | --- | --- | --- |
| Chips "Total" e "Média" | `TransactionsView.tsx:492,496` | T | Resumo do filtro. A média em tempo usa a média em centavos arredondada ao centavo, só para exibir |
| Valor da linha (desktop e celular) | `TransactionsView.tsx:612,724` | T | Lista informativa; a anulação a partir da linha confirma com o valor em reais (linha abaixo) |
| Formulário de lançamento: campos, pré-preenchimento e prévia da compra parcelada (total, parcela, limite atual e após) | `TransactionModal.tsx:556,676,1226,1260-1279,1330,1416` | R-IN / R-CF | Entrada e prévia da operação antes do envio |
| Confirmação de anulação de lançamento | `App.tsx:619-634` | R-CF | No modo dinheiro, igual à base (sem valor). No modo tempo, a mensagem traz o valor exato em reais, porque a linha que originou a ação mostra horas (M1) |

### 2.3 Relatórios

| Ponto | Local | Classe | Justificativa |
| --- | --- | --- | --- |
| KPIs monetários (resultado, receitas, despesas, aportes, faturamento, a receber, dívidas) | `ReportsOverview.tsx:205` | T | Número de painel. KPIs percentuais não mudam |
| Insights e descrições dos KPIs | `adapter.ts:214,255,685,692` | R-TX | Frase analítica composta |
| Patrimônio: atual, aportes, retiradas, rendimento, taxas e impostos | `ReportsOverview.tsx:261` | T | Resumo informativo |
| Cartões: limite usado e limite disponível | `ReportsOverview.tsx:307,384` | R-CT | Limite do cartão |
| Cartões: próximas faturas, futuro comprometido, crédito a compensar, a vencer em 30 dias, em atraso; colunas próxima fatura, futuro, atraso e crédito | `ReportsOverview.tsx:314,321,325,333,343,388,392,397` | T | Faturas informativas |
| Frase "crédito de … a compensar" na linha do cartão | `ReportsOverview.tsx:372` | R-TX | Frase composta (L1: sem `title` nem texto para leitor de tela, o valor convertido ficava sem acesso ao BRL) |
| Fluxo mensal: entradas, saídas e resultado | `ReportsOverview.tsx:446,449,452` | T | Tabela informativa |
| Top categorias | `ReportsOverview.tsx:525` | T | Resumo informativo |
| Gráficos: patrimônio, fluxo de caixa, categorias, recebíveis, dívida PF, cartão por período, parcelas 7/15/30 dias, top clientes | `ReportsChartsView.tsx:196-197,240,243,308,347,383,478,481,666,669,712,716` | G | Só eixo e tooltip. No eixo, o rótulo compacto (`≈ 124 h`); só no modo tempo, eixo Y com 80 px e margem esquerda 0 nos gráficos de patrimônio e fluxo de caixa, para o sinal e o `≈` não serem cortados. O texto completo fica no tooltip (M2: o texto longo saía cortado). No modo dinheiro, a largura (padrão) e as margens (−10 e −20) continuam as da base |
| Tabelas: valor por período; compras, pago em faturas, próxima fatura, futuro, em atraso; nota de atraso de arquivados | `ReportsChartsView.tsx:522,559-571,586` | T | Tabelas informativas |
| Painel de alertas | `ReportsAlertsPanel.tsx:134` | R-TX | Frase composta |
| Chat de IA | `ReportsAIChat.tsx` | R-TX | Texto do provedor. A IA não recebe a preferência |

### 2.4 Contas e carteiras

| Ponto | Local | Classe | Justificativa |
| --- | --- | --- | --- |
| Saldo geral e saldo de cada conta | `CashAccountsView.tsx:156,210` | T | Saldo informativo |
| Lista de transferências | `CashAccountsView.tsx:273` | R-HA | Histórico com estado e estorno |
| Confirmação de estorno | `CashAccountsView.tsx:330` | R-CF | Confirmação |
| Extrato (saldo do cabeçalho e movimentos) | `CashAccountStatementModal.tsx:37,53` | R-HA | Livro-razão da conta; o modal fica inteiro em BRL |
| Transferência: revisão, saldo nas opções e campo | `CashTransferModal.tsx:117,140,158` | R-CF / R-IN | Operação |
| Saldo inicial no cadastro | `CashAccountFormModal.tsx:139-145` | R-IN | Entrada |

### 2.5 Cartões e faturas

| Ponto | Local | Classe | Justificativa |
| --- | --- | --- | --- |
| Card da fatura: total, pago e restante | `CreditCardsView.tsx:93,97,101` | T | Fatura informativa |
| Frase do crédito a transportar no card da fatura | `CreditCardsView.tsx:72,106` (`openInvoiceCreditNote`) | R-TX | Frase composta (L1) |
| Valor de cada compra | `CreditCardsView.tsx:600` | T | Lista informativa |
| Reconciliação administrativa do limite | `CreditCardsView.tsx:289` | R-CT | Limite |
| Trilha de eventos | `CreditCardsView.tsx:675` | R-HA | Auditoria |
| Limites no cartão (total, utilizado, disponível, cabeçalho "usado / total") | `CreditCard3D.tsx:91,174,178,182` | R-CT | Limite do emissor e suas derivações, no mesmo bloco |
| Formulário do cartão | `CreditCardForm.tsx:89,260-261` | R-IN | Entrada |
| Fatura detalhada: total, pago e saldo | `CardInvoiceDetailsDrawer.tsx:199,203,207` | T | Fatura informativa |
| Frase do crédito a transportar na fatura detalhada | `CardInvoiceDetailsDrawer.tsx:139,211` (`openInvoiceCreditNote`) | R-TX | Frase composta (L1) |
| Lançamentos da fatura | `CardInvoiceDetailsDrawer.tsx:261` | T | Composição informativa da fatura |
| Pagamentos da fatura | `CardInvoiceDetailsDrawer.tsx:311` | R-HA | Histórico com estorno |
| Painéis de cancelar ou estornar compra e de estornar pagamento | `CardInvoiceDetailsDrawer.tsx:376,401` | R-CF | Confirmação |
| Pagamento da fatura (saldo atual, total, já pago, saldo após, campo, erro) | `CardInvoicePaymentModal.tsx:42,64,108,176,180,185` | R-CF / R-IN / R-TX | Operação |
| Ajuste de limite (campo e efeito) | `CardAdjustmentModal.tsx:156-160,186` | R-IN / R-CF | Operação |

### 2.6 Empréstimos (PF e PJ)

| Ponto | Local | Classe | Justificativa |
| --- | --- | --- | --- |
| Saldo pendente no card | `LoanCard.tsx:60`, `PJLoanCard.tsx:65` | T | Saldo informativo |
| Principal no card | `LoanCard.tsx:64` | R-CT | Principal contratado |
| Totais a receber e a pagar (ativo e passivo); coluna de saldo | `LoansView.tsx:153,157,191`, `PJLoansView.tsx:154,158,203` | T | Totais e saldos informativos |
| Coluna de juros | `PJLoansView.tsx:204` | R-CT | Termo do contrato |
| Detalhes: saldo, principal liquidado ("pagos/recebidos"), total amortizado, juros pagos/recebidos ou acumulados | `LoanDetailsView.tsx:108,115,134`, `PJLoanDetailsView.tsx:132,144,148` | T | Realizado informativo |
| Detalhes: principal contratado, juros, juros previstos, custo total previsto | `LoanDetailsView.tsx:122,126,130`, `PJLoanDetailsView.tsx:140,175,179` | R-CT | Termos e previsão contratual |
| Cronograma | `loans/LoanSchedule.tsx:65,70` | R-CT | Obrigação contratual |
| Histórico de movimentos | `loans/LoanMovementHistory.tsx:99-129` | R-HA | Histórico com estornos |
| Pagamento, estorno, cancelamento e formulários | `loans/LoanPaymentModal.tsx`, `loans/useLoanOperations.tsx:130-151`, `LoanFormModal.tsx`, `PJLoanFormModal.tsx`, `loans/LoanDialog.tsx:293` | R-CF / R-IN | Operação e entrada |

### 2.7 Clientes e recebíveis (PJ)

| Ponto | Local | Classe | Justificativa |
| --- | --- | --- | --- |
| Total a receber, em atraso, próximos 7 dias | `ClientsReceivablesView.tsx:250,259,268` | T | Totais informativos |
| Coluna "Valor" (original) | `ClientsReceivablesView.tsx:325` | R-CT | Valor cobrado do cliente |
| Coluna "Saldo" | `ClientsReceivablesView.tsx:327` | T | Saldo informativo |
| Confirmações de cancelamento e estorno | `ClientsReceivablesView.tsx:511,528` | R-CF | Confirmação |
| Histórico do recebível | `clients/ReceivableHistoryModal.tsx:44-73` | R-HA | Histórico; o modal fica inteiro em BRL |
| Recebimento (campos, saldo, total no caixa, saldo após) | `clients/ReceiptModal.tsx:48,97-176` | R-IN / R-CF | Operação |
| Cadastro do recebível e erro de validação | `ReceivableFormModal.tsx:66,167-176`, `clients/payloads.ts:264` | R-IN / R-TX | Entrada |

### 2.8 Recorrências

| Ponto | Local | Classe | Justificativa |
| --- | --- | --- | --- |
| Custo mensal estimado e totais por meio de pagamento | `RecurringExpensesView.tsx:222,244,261,278` | T | Resumo informativo |
| Valor na lista e no card | `RecurringExpenseList.tsx:75`, `RecurringExpenseCard.tsx:113` | T | Lista informativa |
| Detalhes: valor da recorrência (resumo e bloco), cobranças previstas e histórico recente | `RecurringExpenseDetailsView.tsx:423,676,717` | T | Informativo |
| Ocorrências que aguardam ação (gerar, pagar, confirmar, tentar de novo, ignorar) | `RecurringExpenseDetailsView.tsx:621` | R-CF | As ações partem da linha; "Tentar de novo" confirma sem mostrar o valor (M1) |
| Histórico de reajustes (anterior e novo) | `RecurringExpenseDetailsView.tsx:760,763` | R-HA | Trilha de reajustes |
| Campos de confirmação de ocorrência e de reajuste; formulário | `RecurringExpenseDetailsView.tsx:320,548-552`, `RecurringExpenseFormModal.tsx:273-276` | R-IN | Entrada |

### 2.9 Investimentos

| Ponto | Local | Classe | Justificativa |
| --- | --- | --- | --- |
| Total por meta; chips aportes, retiradas e aporte médio | `SimpleInvestmentsView.tsx:395,526,529,532` | T | Resumo informativo |
| Valor de cada operação na tabela | `SimpleInvestmentsView.tsx:629` | R-CF | Linhas com confirmar, cancelar e desfazer, cuja confirmação mostra só a descrição; também é histórico de movimentos com estornos (M1) |
| Alocação: valor por carteira, "valor · %", total e capital aplicado | `AllocationPanels.tsx:67,99,141,144` | T | Resumo informativo |
| Vinculação a meta | `LinkGoalInvestmentsModal.tsx:155` | R-CF | Operação que altera o progresso da meta |
| Resgate ("valor investido disponível") | `WithdrawInvestmentModal.tsx:141` | R-CF | Operação |
| Formulário e mensagens de erro | `SimpleInvestmentForm.tsx:173,406-411`, `form.ts:134,266,270` | R-IN / R-TX | Entrada |

### 2.10 Metas

| Ponto | Local | Classe | Justificativa |
| --- | --- | --- | --- |
| Card: acumulado, alvo, progresso e consumido (unidade monetária) | `GoalCard.tsx:157-158,189-190,253-254,274-275` | T | Informativo. Margem em pontos-base não muda |
| Detalhes: progresso atual, atual, objetivo, falta acumular, sugestão mensal | `GoalDetailsView.tsx:397,410,414,557,561` | T | Informativo |
| Detalhes: ajuda do progresso manual, antes → depois, movimentos e linha do tempo | `GoalDetailsView.tsx:211,234,461,462,486` | R-IN / R-HA | Entrada e histórico |
| Rodapé "Progresso Atual" da tabela de movimentos | `GoalDetailsView.tsx:472` | R-HA | Faz parte do bloco de histórico. O mesmo número aparece convertido no cabeçalho |
| Formulário (inclusive a prévia "Para atingir" e "/ mês") | `GoalFormModal.tsx:306,638,641,693,705` | R-IN | Prévia dentro do formulário, ligada aos campos em R$ |

### 2.11 Divisão de contas

| Ponto | Local | Classe | Justificativa |
| --- | --- | --- | --- |
| Lista: total e saldo | `SplitGroupList.tsx:59,66,67` | T | Informativo; o saldo usa o mesmo elemento dos demais, com `title` e texto para leitor de tela (L1) |
| Card do grupo: total acumulado, devo, a receber | `SplitGroupCard.tsx:120,127,133` | T | Informativo |
| Detalhes: totais, pendente, eu paguei, a receber, minha dívida e contas | `SplitGroupDetailsView.tsx:295-316,444` | T | Informativo |
| Itens de reembolso (aprovar, rejeitar, cancelar, estornar) | `SplitGroupDetailsView.tsx:402` | R-CF | Fila de aprovação; a confirmação não mostra o valor (M1) |
| Detalhes da conta: valor total | `SplitBillDetailsModal.tsx:188` | T | Informativo; o rateio continua em centavos. A anulação feita a partir do modal confirma com o valor em reais (linha abaixo) |
| Confirmação de anulação da despesa | `SplitBillDetailsModal.tsx:160-164` | R-CF | No modo dinheiro, igual à base (sem valor). No modo tempo, a mensagem traz o valor exato em reais, porque o total no topo do modal mostra horas (M1) |
| Parte de cada participante | `SplitBillDetailsModal.tsx:240` | R-CF | Ao lado de "Registrar recebimento", "Estornar recebimento" e "Perdoar", que agem num clique (M1) |
| Formulário da conta (campo, prévia das partes, diferença) | `SplitBillFormModal.tsx:281,401,419,431` | R-IN | Entrada e prévia do formulário |
| Pagamento de reembolso | `SplitReimbursementPayModal.tsx:73` | R-CF | Operação |
| Gráficos (tooltips) | `SplitGroupCharts.tsx:70,95` | G | Só tooltip |

### 2.12 Outros

| Ponto | Local | Classe | Justificativa |
| --- | --- | --- | --- |
| Preço dos planos | `PricingTable.tsx:111` | R-CT | Preço de assinatura |
| MRR fixo do painel administrativo | `AdminDashboard.tsx:51` | R-CT | Texto fixo de billing, não é finança do usuário |
| Prévia do tema (Header real, gráfico e transações fictícias) | `PersonalizationView.tsx:607-616,648-659` → `Header`, `DistributionChart` e `RecentTransactions` | R-PV | Envolvida em `ForceMoneyDisplay`, que força BRL; o Header da prévia fica sem alternador e sem aviso do modo tempo (L2) |
| Painel de notificações | `NotificationsPanel` | R-TX | Texto gravado pelo backend; a preferência não entra nas notificações |
| Seção "Tempo de trabalho equivalente" | `WorkTimeSettingsView` (nova) | R-IN | A renda é entrada; a prévia usa valor demonstrativo |

## 3. Totais

Contagem dos pontos de renderização implementados (T e G), conferida no diff final, depois das reclassificações da revisão independente (antes: T 112, G 18, BRL 120). Um card com dois números conta dois; uma linha de `.map` conta uma. A coluna "Em BRL" vem das linhas dos inventários, inclusive rótulos de entrada e mensagens com valor.

| Superfície | T | G | Em BRL (R-*) |
| --- | --- | --- | --- |
| Dashboard | 8 | 3 | 1 |
| Transações | 4 | 0 | 9 |
| Relatórios | 21 | 13 | 6 |
| Contas | 2 | 0 | 9 |
| Cartões e faturas | 8 | 0 | 23 |
| Empréstimos | 14 | 0 | 29 |
| Recebíveis | 4 | 0 | 14 |
| Recorrências | 9 | 0 | 8 |
| Investimentos | 8 | 0 | 6 |
| Metas | 14 | 0 | 11 |
| Divisão de contas | 13 | 2 | 8 |
| Outros | 0 | 0 | 5 |
| **Total** | **105** | **18** | **129** |

Os 31 arquivos com pontos T ou G e os 31 arquivos que ficam inteiros em BRL estão listados na guarda `tests/unit/work-time-guard.test.ts`: os primeiros precisam usar `useMoneyDisplay()`, os segundos não podem importar a camada.

## 4. Fora da conversão em qualquer caso

- Filtros, ordenações, buscas, exportações, agregações e totais: continuam em centavos.
- DTOs de operações financeiras, saldos, movimentos, relatórios autoritativos, transações, projeções, ledger e eventos de auditoria: nenhum campo de tempo.
- Backend: nenhuma Function lê a preferência; a conversão não influencia nenhuma operação.
