# Fase 6 — Reestruturação da UI e UX

## Status

Fase 6 iniciada.

## Subfase 6.1 — Prévia de compra no cartão antes da confirmação

### Status

Concluída como melhoria inicial do cadastro de compra no cartão.

### Arquivo alterado

- `src/components/TransactionModal.tsx`

### Objetivo

Melhorar a compreensão do usuário ao lançar uma compra no cartão, antes da confirmação.

### Comportamento implementado

No cadastro de compra no cartão:

- a aba visual passa a aparecer como `Cartão`;
- compra à vista no cartão passa a ser representada por 1 parcela;
- o campo de parcelas aceita mínimo 1;
- a UI mostra primeira fatura prevista;
- a UI mostra vencimento previsto;
- a UI mostra valor total da compra;
- a UI mostra valor médio da parcela;
- a UI mostra limite disponível atual;
- a UI mostra limite após a compra;
- a UI informa que compra no cartão consome limite agora, mas só afeta caixa no pagamento da fatura.

### Regra preservada

O frontend apenas mostra uma prévia.

A validação oficial de limite, fatura, parcelas e domínio continua na Cloud Function `createCreditCardPurchase`.

## Subfase 6.2 — Enriquecer detalhe da fatura com vínculo real da compra original

### Status

Concluída como melhoria visual do detalhe da fatura.

### Arquivos alterados

- `src/modules/credit-cards/persistence/readApi.ts`
- `src/modules/credit-cards/hooks.ts`
- `src/components/CreditCardsView.tsx`

### Objetivo

Substituir o texto genérico `Item da fatura` por dados reais da compra original vinculada à parcela.

### Comportamento implementado

No detalhe da fatura:

- cada parcela usa `purchaseId` para buscar a compra original;
- o item exibe descrição da compra quando disponível;
- o item exibe data da compra;
- o item exibe categoria, fornecedor e centro de custo quando existirem;
- o valor da parcela continua vindo de `credit_card_installments`;
- os pagamentos continuam vindo de `credit_card_invoice_payments`.

### Regra preservada

O frontend apenas enriquece a leitura.

A verdade financeira continua em:

- `credit_card_purchases`;
- `credit_card_installments`;
- `credit_card_invoices`;
- `credit_card_invoice_payments`.
## Subfase 6.3 — Melhorar tela do cartão com fatura atual, próxima fatura, histórico, compras recentes e alerta de limite

### Status

Concluída como reorganização visual da tela de cartão.

### Arquivos alterados

- `src/modules/credit-cards/hooks.ts`
- `src/components/CreditCardsView.tsx`

### Objetivo

Fazer a tela de cartão refletir melhor o domínio real de cartão de crédito.

### Comportamento implementado

No detalhe do cartão:

- faturas passam a ser organizadas em fatura atual, próxima fatura e histórico;
- faturas continuam permitindo ver detalhes;
- pagamento e estorno continuam funcionando;
- cartão passa a mostrar alerta de utilização quando o uso do limite atinge 75% ou 90%;
- compras recentes do cartão passam a ser exibidas;
- compras à vista no cartão aparecem como `À vista no cartão`;
- compras parceladas aparecem com a quantidade de parcelas.

### Regra preservada

A UI apenas organiza e enriquece leituras.

O domínio financeiro continua sendo controlado por:

- `credit_card_purchases`;
- `credit_card_installments`;
- `credit_card_invoices`;
- `credit_card_invoice_payments`;
- `card_limit_snapshots`;
- Cloud Functions.

## Subfase 6.4 — Painel dedicado de detalhe da fatura

### Status

Concluída como separação visual do detalhe de fatura em painel lateral próprio.

### Arquivo alterado

- `src/components/CreditCardsView.tsx`

### Objetivo

Reduzir a complexidade visual do drawer do cartão e dar à fatura um espaço próprio de leitura e operação.

### Comportamento implementado

Na tela de cartões:

- o botão `Ver detalhes da fatura` abre um painel lateral dedicado;
- o painel exibe competência, fechamento, vencimento e status;
- o painel exibe total, pago e saldo;
- o painel reaproveita a listagem de itens e pagamentos da fatura;
- o painel permite pagar a fatura quando houver saldo;
- o painel permite estornar pagamentos pelo histórico;
- os detalhes deixam de ser renderizados inline dentro do card da fatura.

### Regra preservada

A UI continua apenas renderizando leituras e disparando ações.

A verdade financeira permanece no backend e nas coleções oficiais do domínio de cartão.
## Subfase 6.5 — Melhorar lista principal de despesas com status visual de fatura

### Status

Concluída como melhoria visual da lista principal de despesas.

### Arquivos alterados

- `src/modules/credit-cards/compatibility/transactionProjection.ts`
- `src/components/TransactionsView.tsx`

### Objetivo

Fazer a lista principal de despesas comunicar melhor o estado das faturas de cartão.

### Comportamento implementado

Na tela de despesas:

- faturas passam a exibir status visual específico;
- `FATURA` passa a ser exibido como `Fatura Aberta`, `Fatura Fechada`, `Fatura Parcial`, `Fatura Paga` ou `Fatura Vencida`;
- cada status possui cor própria;
- o item da fatura passa a mostrar texto secundário com cartão, status e competência;
- despesas comuns e investimentos não são alterados.

### Regra preservada

A tela continua exibindo projeções vindas de `invoice_views`.

Faturas continuam sem serem gravadas como documentos reais em `transactions`.
## Subfase 6.6 — Revisão final da UI/UX e checklist de aceite

### Status

Concluída como checklist final da Fase 6.

### Objetivo

Validar se a experiência do usuário reflete corretamente o novo domínio de cartão de crédito.

### Princípio de UX validado

O usuário deve compreender intuitivamente que:

- compra no cartão não é despesa paga no momento do lançamento;
- compra no cartão consome limite;
- fatura consolida compras e parcelas;
- pagamento da fatura é a saída real de caixa;
- pagamento da fatura recompõe limite;
- estorno de pagamento reverte caixa e volta a consumir limite.

### Checklist obrigatório de validação

#### 1. Cadastro de compra no cartão

Critérios de aceite:

- a aba aparece como `Cartão`;
- o usuário consegue selecionar um cartão;
- o usuário consegue lançar compra à vista no cartão com 1 parcela;
- o usuário consegue lançar compra parcelada;
- o usuário consegue escolher valor total ou valor da parcela;
- o usuário informa a data da compra;
- a UI mostra a primeira fatura prevista;
- a UI mostra o vencimento previsto;
- a UI mostra limite disponível antes da compra;
- a UI mostra limite após a compra;
- a UI bloqueia confirmação quando o limite é insuficiente;
- ao salvar, a compra entra no novo domínio de cartão.

#### 2. Lista principal de despesas

Critérios de aceite:

- despesas normais continuam aparecendo;
- faturas de cartão aparecem como itens próprios;
- parcelas individuais do cartão não aparecem como despesas principais;
- faturas exibem status visual;
- faturas pagas aparecem como pagas;
- faturas parcialmente pagas aparecem como parciais;
- faturas vencidas aparecem como vencidas;
- faturas não podem ser editadas como transações comuns;
- faturas não podem ser excluídas como transações comuns.

#### 3. Detalhe da fatura

Critérios de aceite:

- o detalhe da fatura abre em painel próprio;
- o painel mostra competência;
- o painel mostra fechamento;
- o painel mostra vencimento;
- o painel mostra status;
- o painel mostra valor total;
- o painel mostra valor pago;
- o painel mostra saldo;
- o painel mostra itens da fatura;
- os itens mostram vínculo com a compra original;
- os itens mostram parcela X/Y;
- o painel mostra pagamentos;
- o painel permite pagar fatura com saldo;
- o painel permite estornar pagamento registrado;
- o histórico permanece visível após pagamento e estorno.

#### 4. Tela do cartão

Critérios de aceite:

- mostra limite total;
- mostra limite utilizado;
- mostra limite disponível;
- mostra alerta de utilização quando aplicável;
- mostra fatura atual;
- mostra próxima fatura quando existir;
- mostra histórico de faturas;
- mostra compras recentes;
- pagamento de fatura atualiza limite;
- estorno de pagamento atualiza limite;
- compras recentes vêm do novo domínio de cartão, não de `transactions`.

#### 5. Caixa, dashboard e dupla contagem

Critérios de aceite:

- compra no cartão não reduz caixa;
- pagamento da fatura reduz caixa;
- estorno do pagamento devolve caixa;
- dashboard não infla receitas e despesas com pares de pagamento/estorno;
- transações técnicas continuam existindo para auditoria;
- lista de despesas não duplica fatura e pagamento no mesmo contexto.

### Critério final de aceite da Fase 6

A Fase 6 é considerada aprovada quando:

- `npm run build` conclui sem erros;
- todos os fluxos acima passam em validação manual;
- não há erro no console durante compra, pagamento ou estorno;
- o usuário consegue entender visualmente a diferença entre compra, fatura e pagamento.

### Resultado

Fase 6 considerada tecnicamente concluída após build sem erros e validação manual do checklist.