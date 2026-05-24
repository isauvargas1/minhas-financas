# Fase 7 — Regra contábil e integração com caixa

## Status

Fase 7 iniciada.

## Subfase 7.1 — Blindagem contábil dos relatórios

### Status

Concluída como ajuste de leitura contábil dos relatórios.

### Arquivo alterado

- `src/modules/reports/logic.ts`

### Objetivo

Garantir que relatórios financeiros não tratem compra no cartão como saída imediata de caixa.

### O que já estava correto antes desta subfase

- compra no cartão consome limite;
- compra no cartão não cria transaction de caixa;
- fechamento de fatura não baixa caixa;
- pagamento de fatura cria saída de caixa;
- pagamento parcial recompõe limite proporcionalmente;
- estorno de pagamento reverte caixa e consome novamente o limite;
- lista de despesas exibe faturas, não compras individuais.

### Ajustes aplicados

Os relatórios passam a usar uma visão contábil filtrada de `transactions`.

Essa visão remove:

- projeções de fatura;
- parcelas legadas de cartão;
- pares de pagamento/estorno de fatura já revertidos.

Além disso, o perfil de dívida de cartão passa a usar `limitUsed` / `limitAvailable` dos cartões, e não soma de `transactions`.

### Regra contábil consolidada

- Compra no cartão: compromisso financeiro e consumo de limite.
- Fatura: obrigação consolidada.
- Pagamento da fatura: saída real de caixa.
- Estorno de pagamento: reversão de caixa e retorno do limite consumido.
- Relatórios: devem considerar caixa real, não compras do cartão como se fossem despesas pagas.

### Próxima subfase

`Subfase 7.2 — Validação contábil de relatórios, dashboard e fluxo de caixa`

## Subfase 7.2 — Correção de cache dos relatórios após compras, pagamentos e estornos

### Status

Concluída como ajuste de consistência de cache dos relatórios.

### Arquivo alterado

- `src/modules/reports/hooks.ts`

### Problema corrigido

O cache dos relatórios usava apenas a quantidade de registros para montar `dataVersion`.

Isso era insuficiente para o novo domínio de cartão, porque uma compra no cartão pode alterar `limitUsed` e `limitAvailable` sem alterar a quantidade de cartões.

### Ajuste aplicado

A assinatura de cache dos relatórios passa a considerar:

- valor, data, tipo, origem e vínculo de cartão das transações;
- limite total, usado e disponível dos cartões;
- dados relevantes de metas;
- dados relevantes de contas a receber;
- dados relevantes de clientes.

### Regra preservada

Relatórios continuam usando funções puras de cálculo em `src/modules/reports/logic.ts`.

A regra contábil da Fase 7 permanece:

- compra no cartão não é saída imediata de caixa;
- pagamento da fatura é saída de caixa;
- estorno reverte caixa;
- dívida de cartão vem do limite usado do cartão.

## Subfase 7.3 — Checklist final de aceite contábil

### Status

Concluída como checklist final de validação da regra contábil e integração com caixa.

### Objetivo

Validar que o sistema separa corretamente compromisso financeiro, fatura, pagamento e fluxo de caixa real.

### Checklist obrigatório

#### 1. Compra no cartão

Critérios de aceite:

- compra no cartão consome limite;
- compra no cartão cria `credit_card_purchases`;
- compra no cartão cria `credit_card_installments`;
- compra no cartão cria ou atualiza `credit_card_invoices`;
- compra no cartão cria ou atualiza `invoice_views`;
- compra no cartão cria `card_limit_ledger`;
- compra no cartão atualiza `card_limit_snapshots`;
- compra no cartão não cria saída de caixa;
- compra no cartão não aumenta despesas de caixa em relatórios.

#### 2. Fechamento de fatura

Critérios de aceite:

- fechamento consolida obrigação;
- fechamento altera status da fatura conforme regra;
- fechamento atualiza projeção de leitura;
- fechamento não baixa caixa;
- fechamento não recompõe limite;
- fechamento não cria `transaction`.

#### 3. Pagamento total de fatura

Critérios de aceite:

- pagamento cria `credit_card_invoice_payments`;
- pagamento atualiza `paidAmount`;
- pagamento zera `remainingAmount`;
- pagamento altera status da fatura para `paid`;
- pagamento cria saída de caixa em `transactions`;
- pagamento recompõe limite no valor pago;
- pagamento cria ledger de restauração;
- pagamento aparece no histórico da fatura;
- relatório considera o pagamento como saída de caixa.

#### 4. Pagamento parcial de fatura

Critérios de aceite:

- pagamento parcial baixa caixa apenas no valor pago;
- pagamento parcial recompõe limite apenas no valor pago;
- fatura permanece com saldo em aberto;
- fatura fica como `partial_paid`;
- relatório considera apenas o valor efetivamente pago;
- limite disponível aumenta somente proporcionalmente ao pagamento.

#### 5. Estorno de pagamento

Critérios de aceite:

- estorno marca pagamento como `reversed`;
- estorno gera reversão de caixa;
- estorno reduz `paidAmount`;
- estorno aumenta `remainingAmount`;
- estorno consome novamente limite no valor estornado;
- estorno registra ledger;
- estorno registra evento financeiro;
- dashboard não infla receitas e despesas com o par pagamento/estorno;
- relatório não trata estorno como receita operacional comum.

#### 6. Relatórios

Critérios de aceite:

- relatórios não tratam compra no cartão como saída imediata de caixa;
- relatórios consideram pagamento de fatura como saída de caixa;
- relatórios não inflam receita/despesa quando há estorno de pagamento;
- perfil de dívida do cartão usa `limitUsed` ou `limitAvailable`, não soma de `transactions`;
- parcelas legadas de cartão não entram como caixa quando houver visão contábil filtrada.

#### 7. Dashboard

Critérios de aceite:

- compra no cartão não reduz saldo;
- pagamento de fatura reduz saldo;
- estorno de pagamento devolve saldo;
- par pagamento/estorno não deixa Receita e Despesa infladas;
- transações técnicas continuam existindo para auditoria.

### Resultado esperado

A Fase 7 é considerada aprovada quando:

- `npm run build` conclui sem erros;
- compra no cartão não baixa caixa;
- fechamento de fatura não baixa caixa;
- pagamento de fatura baixa caixa;
- pagamento parcial baixa caixa proporcionalmente;
- pagamento e estorno atualizam limite corretamente;
- relatórios não tratam compra no cartão como saída imediata de caixa;
- dashboard e relatórios não apresentam dupla contagem.

### Próxima fase recomendada

`Fase 8 — Segurança, regras Firestore, índices e endurecimento multiworkspace`