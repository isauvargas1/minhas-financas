# Fase 9 — Relatórios e indicadores

## Status

Fase 9 iniciada.

## Subfase 9.1 — Enriquecer relatórios com dados reais do domínio de cartão

### Status

Concluída como base analítica do novo domínio de cartão.

### Arquivos alterados

- `src/modules/credit-cards/domain/types.ts`
- `src/modules/credit-cards/persistence/readApi.ts`
- `src/modules/reports/types.ts`
- `src/modules/reports/logic.ts`
- `src/modules/reports/api.ts`
- `src/modules/reports/hooks.ts`

### O que já estava correto

- relatórios de caixa já filtravam faturas projetadas;
- relatórios de caixa já filtravam parcelas legadas de cartão;
- relatórios já evitavam dupla contagem de pagamento/estorno;
- dívida de cartão já não era mais inferida por soma simples de `transactions`.

### O que foi adicionado

Os relatórios passam a carregar dados reais de:

- `credit_card_invoices`;
- `credit_card_installments`;
- `credit_card_invoice_payments`.

### Indicadores calculados

Por cartão:

- limite total;
- limite usado;
- limite disponível;
- taxa de utilização;
- saldo da fatura atual;
- saldo futuro comprometido;
- valor em atraso;
- valor a vencer nos próximos 7, 15 e 30 dias;
- pagamentos registrados;
- pagamentos estornados.

No perfil de dívida:

- dívida atual de cartão;
- limite total real;
- limite disponível real;
- faturas abertas;
- parcelas futuras;
- atrasos;
- valores a vencer;
- pagamentos registrados;
- pagamentos estornados.

### Regra preservada

Compra no cartão continua não sendo tratada como saída imediata de caixa.

Pagamento da fatura continua sendo a saída real de caixa.

Os relatórios passam a usar o domínio oficial de cartão sem dupla contagem.

### Próxima subfase

`Subfase 9.2 — Exibir indicadores analíticos de cartão na tela de relatórios`

## Subfase 9.2 — Exibir indicadores analíticos de cartão na UI de relatórios

### Status

Concluída como primeira exposição visual dos indicadores do novo domínio de cartão.

### Arquivos alterados

- `src/components/ReportsOverview.tsx`
- `src/components/ReportsChartsView.tsx`

### Objetivo

Exibir na interface os indicadores analíticos calculados a partir do domínio oficial de cartão.

### Comportamento implementado

Na visão geral de relatórios:

- exibe limite usado atual;
- exibe saldo de faturas abertas;
- exibe saldo futuro comprometido;
- exibe valor a vencer em até 30 dias;
- exibe valor em atraso;
- exibe tabela por cartão com utilização, limite disponível, fatura atual, futuro e atraso.

Na aba de gráficos:

- exibe gráfico de utilização de limite por cartão;
- exibe gráfico de valores a vencer em 7, 15 e 30 dias por cartão.

### Regra preservada

Os relatórios continuam usando o domínio oficial de cartão.

Compra no cartão não é tratada como saída imediata de caixa.

Pagamento da fatura continua sendo a saída real de caixa.

As informações exibidas vêm de:

- `credit_card_invoices`;
- `credit_card_installments`;
- `credit_card_invoice_payments`;
- `card_limit_snapshots` refletidos em `creditCards`.

### Próxima subfase

`Subfase 9.3 — Visões de despesa por competência da compra, pagamento da fatura e cartão`

## Subfase 9.3 — Visões de despesa por competência da compra, pagamento da fatura e cartão

### Status

Concluída como alternância analítica inicial das despesas de cartão.

### Arquivos alterados

- `src/modules/credit-cards/persistence/readApi.ts`
- `src/modules/reports/types.ts`
- `src/modules/reports/logic.ts`
- `src/modules/reports/api.ts`
- `src/modules/reports/hooks.ts`
- `src/components/ReportsChartsView.tsx`

### Objetivo

Permitir que os relatórios diferenciem três visões do cartão:

- competência da compra;
- data do pagamento da fatura;
- análise por cartão.

### Comportamento implementado

Na aba de gráficos dos relatórios:

- a visão `Competência da compra` agrupa compras por mês da compra;
- a visão `Pagamento da fatura` agrupa pagamentos registrados por mês de pagamento;
- a visão `Por cartão` compara compras, pagamentos, fatura aberta, compromisso futuro e utilização.

### Regra preservada

Compra no cartão continua não sendo tratada como saída imediata de caixa.

Pagamento da fatura continua sendo a saída real de caixa.

Os relatórios passam a permitir as duas leituras sem dupla contagem.

## Subfase 9.4 — Checklist final dos relatórios e indicadores

### Status

Concluída como checklist final de validação da Fase 9.

### Objetivo

Validar que relatórios e indicadores passam a refletir o novo domínio de cartão sem inferências simplificadas por `transactions`.

### Regras consolidadas

- Compra no cartão não é saída imediata de caixa.
- Fatura representa obrigação consolidada.
- Pagamento da fatura representa saída real de caixa.
- Estorno de pagamento não deve inflar receitas e despesas.
- Dívida de cartão não deve ser inferida por soma simples de transações.
- Indicadores de cartão devem usar faturas, parcelas, pagamentos e limite real.

### Checklist obrigatório

#### 1. Perfil de dívida

Critérios de aceite:

- `DebtProfile` usa limite total real dos cartões;
- `DebtProfile` usa limite disponível real;
- `DebtProfile` usa limite usado atual;
- dívida de cartão não é calculada somando `transactions`;
- faturas abertas entram no saldo de obrigação;
- parcelas futuras entram no saldo futuro comprometido;
- valores vencidos entram como atraso;
- valores a vencer em 7, 15 e 30 dias são calculados a partir de faturas reais.

#### 2. Indicadores por cartão

Critérios de aceite:

- cada cartão exibe limite total;
- cada cartão exibe limite usado;
- cada cartão exibe limite disponível;
- cada cartão exibe taxa de utilização;
- cada cartão exibe saldo de fatura atual;
- cada cartão exibe saldo futuro comprometido;
- cada cartão exibe valor em atraso;
- cada cartão exibe valores a vencer em 7, 15 e 30 dias;
- pagamentos registrados e estornados são considerados corretamente.

#### 3. Visão de competência da compra

Critérios de aceite:

- compras aparecem no mês da compra;
- compra à vista no cartão aparece como compra do período;
- compra parcelada aparece pelo valor total da compra no mês da compra;
- essa visão não reduz caixa;
- essa visão não duplica pagamento de fatura.

#### 4. Visão por data de pagamento da fatura

Critérios de aceite:

- pagamentos aparecem no mês em que foram realizados;
- pagamento parcial aparece apenas pelo valor pago;
- pagamento total aparece pelo valor pago;
- estorno não infla receita operacional;
- essa visão representa fluxo de caixa real.

#### 5. Visão analítica por cartão

Critérios de aceite:

- relatório mostra compras por cartão;
- relatório mostra pagamentos por cartão;
- relatório mostra fatura aberta por cartão;
- relatório mostra compromisso futuro por cartão;
- relatório mostra utilização por cartão;
- relatório não mistura compra e pagamento como se fossem a mesma coisa.

#### 6. Gráficos

Critérios de aceite:

- gráfico de utilização por cartão aparece quando há cartões;
- gráfico de valores a vencer por cartão aparece quando há faturas;
- gráfico de competência da compra reflete compras do domínio de cartão;
- gráfico de pagamento da fatura reflete pagamentos reais;
- visão por cartão exibe dados coerentes com a tela de cartões.

#### 7. Ausência de dupla contagem

Critérios de aceite:

- compra no cartão não aumenta despesa de caixa;
- pagamento da fatura aumenta despesa de caixa;
- fatura projetada não soma junto com pagamento como despesa duplicada;
- pagamento estornado não deixa receita e despesa infladas;
- parcelas legadas de cartão não contaminam a visão contábil atual.

### Critério final de aceite da Fase 9

A Fase 9 é considerada aprovada quando:

- `npm run build` conclui sem erros;
- relatórios carregam sem erro no console;
- visão geral exibe indicadores de cartão;
- aba de gráficos exibe visões de despesa do cartão;
- dívida de cartão reflete limite real e faturas reais;
- compra no cartão não aparece como saída imediata de caixa;
- pagamento da fatura aparece como saída de caixa;
- não há dupla contagem entre compra, fatura e pagamento.

### Resultado

Fase 9 considerada tecnicamente concluída após build sem erros e validação manual do checklist.

### Próxima fase recomendada

`Fase 10 — Segurança, regras Firestore, índices e hardening multiworkspace`