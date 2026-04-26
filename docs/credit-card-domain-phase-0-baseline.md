Fase 0 — Baseline técnico do domínio de cartão, compras parceladas e faturas
Status
Este documento congela o comportamento atual do sistema antes da evolução para um domínio financeiro completo de cartão de crédito.
Nenhuma alteração funcional no fluxo de cartão, parcelamento, limite, fatura, pagamento ou relatórios deve começar antes da validação deste baseline.
Objetivo da Fase 0
Entender e documentar o estado atual do sistema para permitir uma evolução segura para o domínio alvo de:
compra no cartão;
parcela financeira;
fatura;
pagamento de fatura;
recomposição de limite;
ledger de limite;
eventos/auditoria de cartão;
projeções de leitura para UI, relatórios e notificações.
Diagnóstico central
O sistema atual possui cadastro de cartões e lançamento de compras parceladas, mas ainda não possui domínio oficial de cartão de crédito.
Atualmente, compras parceladas são representadas como múltiplos documentos na coleção:
```txt
workspaces/{workspaceId}/transactions
```
Cada parcela é uma `Transaction` com:
`type: 'parcelado'`;
`cardId`;
`installments`;
`currentInstallment`;
`isPaid`.
Isso resolve a experiência visual inicial, mas ainda não fecha o ciclo financeiro real de cartão. O sistema não separa oficialmente:
consumo de limite;
obrigação futura;
consolidação em fatura;
saída real de caixa;
pagamento;
recomposição de limite;
estorno;
auditoria específica.
Decisão técnica da Fase 0
O modelo atual deve ser tratado como legado funcional.
Ele não deve ser removido abruptamente. A evolução deve criar um novo domínio paralelo e compatível até que migração, reconciliação, testes e rollout estejam concluídos.
---
Subfase 0.1 — Inventário técnico e congelamento do comportamento atual
1. Tipos globais impactados
Arquivo
`src/types.ts`
Trecho real
```ts
export type TransactionType = 'receita' | 'despesa' | 'investimento' | 'parcelado';
```
```ts
export interface CreditCard {
    id: string;
    name: string;
    brand: string;
    limitTotal: number;
    closingDay: number;
    dueDay: number;
    bestDay?: number;
    status: 'active' | 'blocked' | 'cancelled';
    observations?: string;
    visual: {
        bgType: 'color' | 'gradient' | 'image';
        bgColor: string;
        bgGradientColor?: string;
        bgImage?: string;
        textColor: 'white' | 'black';
        showName: boolean;
        showBrand: boolean;
        showLogo: boolean;
    };
    profileId?: string;
    responsiblePerson?: string;
    recommendedUse?: string;
    defaultCostCenter?: string;
}
```
```ts
export interface Transaction {
    id: number | string;
    type: TransactionType;
    description: string;
    category: string;
    value: number;
    date: string;
    installments?: number;
    currentInstallment?: number;
    cardId?: string;
    walletId?: number;
    userId?: string;
    workspaceId?: string;
    goalId?: string;
    loanId?: string;
    loanMovementId?: string;
    expenseType?: string;
    incomeType?: string;
    paymentMethod?: string;
    isPaid?: boolean;
    profileId?: string;
    supplier?: string;
    costCenter?: string;
    displaySnapshots?: TransactionDisplaySnapshots;
}
```
Diagnóstico
`Transaction` concentra responsabilidades de cartão e parcelamento que deveriam pertencer a entidades próprias do domínio financeiro.
Impacto
Não remover `parcelado`, `cardId`, `installments`, `currentInstallment` ou `isPaid` na Fase 0. Esses campos ainda sustentam telas e relatórios existentes.
---
2. Coleções Firestore atuais identificadas
Coleções principais sob workspace
A partir de `firestore.rules` e das APIs do projeto, o sistema utiliza:
```txt
workspaces/{workspaceId}/transactions
workspaces/{workspaceId}/recurring_expenses
workspaces/{workspaceId}/recurring_occurrences
workspaces/{workspaceId}/credit_cards
workspaces/{workspaceId}/goals
workspaces/{workspaceId}/loans
workspaces/{workspaceId}/loan_movements
workspaces/{workspaceId}/clients
workspaces/{workspaceId}/receivables
workspaces/{workspaceId}/notifications
workspaces/{workspaceId}/split_groups
workspaces/{workspaceId}/split_participants
workspaces/{workspaceId}/split_bills
workspaces/{workspaceId}/split_shares
workspaces/{workspaceId}/split_invites
workspaces/{workspaceId}/settings_catalog
workspaces/{workspaceId}/settings_catalog_uniques
```
Coleções globais
```txt
users/{userId}
users/{userId}/workspaces
workspaces/{workspaceId}
workspaces/{workspaceId}/members
```
Coleções do novo domínio ainda inexistentes
Não existem hoje coleções oficiais para:
```txt
workspaces/{workspaceId}/credit_card_purchases
workspaces/{workspaceId}/credit_card_installments
workspaces/{workspaceId}/credit_card_invoices
workspaces/{workspaceId}/credit_card_invoice_payments
workspaces/{workspaceId}/card_limit_ledger
workspaces/{workspaceId}/card_event_logs
workspaces/{workspaceId}/invoice_views
```
---
3. Índices Firestore atuais
Arquivo
`firestore.indexes.json`
Trecho real
```json
{
  "collectionGroup": "transactions",
  "queryScope": "COLLECTION",
  "fields": [
    {
      "fieldPath": "userId",
      "order": "ASCENDING"
    },
    {
      "fieldPath": "date",
      "order": "DESCENDING"
    },
    {
      "fieldPath": "__name__",
      "order": "DESCENDING"
    }
  ],
  "density": "SPARSE_ALL"
}
```
Diagnóstico
Hoje existe índice composto apenas para `transactions`.
Ainda não existem índices para consultas futuras como:
faturas por cartão e competência;
parcelas por fatura;
compras por cartão;
pagamentos por fatura;
faturas por vencimento e status;
ledger por cartão;
projeções de fatura para UI.
---
Subfase 0.2 — Baseline formal do fluxo legado de cartão e parcelamento
1. Fluxo legado: compra parcelada manual
Arquivo principal
`src/components/TransactionModal.tsx`
Trecho real
```ts
if (activeTab === 'parcelado' && !isEditing && onAddTransactions) {
    const card = creditCards.find(c => String(c.id) === selectedCardId);
    if (!card) {
        alert("Selecione um cartão válido.");
        return;
    }

    const totalInstallments = parseInt(installments);
    const inputVal = parseFloat(value);
    let finalTotal = valueType === 'total' ? inputVal : inputVal * totalInstallments;
    let installmentValue = valueType === 'total' ? parseFloat((inputVal / totalInstallments).toFixed(2)) : inputVal;

    const pDate = new Date(purchaseDate);
    let startMonthOffset = pDate.getDate() > card.closingDay ? 1 : 0;
```
Trecho real de criação das parcelas
```ts
newTransactions.push({
    type: 'parcelado',
    displaySnapshots,
    description: resolvedDescription,
    category,
    value: currentVal,
    date: dueDate.toISOString().split('T')[0],
    installments: totalInstallments,
    currentInstallment: i + 1,
    cardId: card.id,
    isPaid: false,
    supplier: isPJ ? supplier : undefined,
    costCenter: isPJ ? costCenter : undefined
});
```
Comportamento atual
Quando o usuário lança uma compra parcelada manualmente:
O frontend identifica o cartão selecionado.
O frontend calcula o número de parcelas.
O frontend calcula o valor de cada parcela.
O frontend calcula a primeira competência com base em `purchaseDate` e `card.closingDay`.
O frontend calcula o vencimento usando `card.dueDay`.
O frontend cria uma lista de transações.
Cada parcela vira uma `Transaction` separada.
Cada parcela recebe `type: 'parcelado'`.
Cada parcela recebe `cardId`, `installments`, `currentInstallment` e `isPaid: false`.
O lote é enviado para persistência via `onAddTransactions`.
Diagnóstico
O frontend está sendo fonte de verdade para regras financeiras críticas. Isso deve permanecer congelado até existir um serviço de aplicação oficial para criação de compra no cartão.
---
2. Fluxo legado: persistência em lote das parcelas
Arquivo
`src/App.tsx`
Trecho real
```ts
const handleAddTransactions = async (newTransactions: Omit<Transaction, 'id'>[]) => {
    if (!user) return;

    try {
        await createTxBatchMutation.mutateAsync(
            newTransactions.map((transaction) => ({
                ...transaction,
                userId: user.uid,
                workspaceId,
                profileId: workspaceId
            }))
        );

        showNotification(`${newTransactions.length} geradas!`);
        playSound('success');
    } catch (error) {
        console.error("Erro na geração em massa:", error);
        showNotification('Erro na geração em massa.');
    }
};
```
Arquivo
`src/modules/transactions/api.ts`
Trecho real
```ts
export const createTransactionsBatch = async (
  workspaceId: string,
  transactions: Omit<Transaction, "id">[]
): Promise<Transaction[]> => {
```
Comportamento atual
A compra parcelada não cria uma compra original. Ela cria diretamente múltiplos documentos em `transactions`.
Diagnóstico
Não existe hoje:
`purchaseId`;
`invoiceId`;
`idempotencyKey`;
`CardLimitLedger`;
`CreditCardInvoice`;
`CreditCardInvoicePayment`;
validação transacional de limite;
recomposição de limite;
auditoria específica de cartão.
---
3. Fluxo legado: cartão em transação comum
Arquivo
`src/components/TransactionModal.tsx`
Trecho real
```ts
if (activeTab === 'parcelado') {
    transactionData.installments = parseInt(installments, 10);
    transactionData.currentInstallment = isEditing ? transactionToEdit.currentInstallment : 1;
    if (selectedCardId) transactionData.cardId = selectedCardId;
}
```
Diagnóstico
Mesmo quando não está no fluxo batch, cartão e parcelamento continuam como campos opcionais dentro de `Transaction`.
---
4. Fluxo legado: cálculo de limite do cartão
Arquivo
`src/components/CreditCardsView.tsx`
Trecho real
```ts
const getCardLimits = (card: CreditCard) => {
    // Nota: transactions.cardId também deve ser string agora
    const usedLimit = transactions
        .filter(t => (t.type === 'despesa' || t.type === 'parcelado') && String(t.cardId) === String(card.id))
        .reduce((sum, t) => sum + t.value, 0);

    return {
        used: usedLimit,
        available: card.limitTotal - usedLimit
    };
};
```
Comportamento atual
A tela de cartões calcula o limite usado somando transações vinculadas ao cartão.
Diagnóstico
O limite disponível não é uma verdade persistida do domínio. Ele é uma aproximação calculada na UI.
O cálculo atual não considera:
pagamento de fatura;
pagamento parcial;
estorno;
cancelamento;
reversão;
ledger;
fatura fechada;
fatura paga.
---
5. Fluxo legado: lista principal de despesas
Arquivo
`src/App.tsx`
Trecho real
```tsx
{(view === 'receita' || view === 'despesa' || view === 'investimento') && <TransactionsView
            viewType={view}
            transactions={currentMonthTransactions.filter(t =>
                view === 'despesa'
                ? t.type === 'despesa' || t.type === 'parcelado'
                : t.type === view
            )}
```
Arquivo
`src/components/TransactionsView.tsx`
Trechos reais
```ts
const viewTitles = {
    receita: 'Receitas',
    despesa: 'Despesas e Parcelamentos',
    investimento: 'Investimentos',
};
```
```ts
if (viewType === 'despesa') {
    return transaction.type === 'parcelado'
        ? 'Parcelamento'
        : transaction.expenseType || '';
}
```
```tsx
{transaction.type === 'parcelado' && (
    <span className="inline-flex rounded-full bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
        Parcela {transaction.currentInstallment}/{transaction.installments}
    </span>
)}
```
Diagnóstico
A lista principal de despesas exibe parcelas diretamente como itens financeiros principais.
No domínio futuro, a lista principal deve exibir faturas como itens próprios, não cada compra/parcela do cartão.
---
6. Fluxo legado: dashboard e resumo mensal
Arquivo
`src/App.tsx`
Trecho real
```ts
const summaryData: SummaryData = useMemo(() => {
    const inc = currentMonthTransactions.filter(t => t.type === 'receita').reduce((a, t) => a + t.value, 0);
    const exp = currentMonthTransactions.filter(t => t.type === 'despesa' || t.type === 'parcelado').reduce((a, t) => a + t.value, 0);
    const inv = currentMonthTransactions.filter(t => t.type === 'investimento').reduce((a, t) => a + t.value, 0);
    return { balance: inc - exp - inv, income: inc, expenses: exp, investments: inv };
}, [currentMonthTransactions]);
```
Diagnóstico
O dashboard soma `parcelado` como despesa mensal. Isso mistura competência da parcela com saída real de caixa.
---
7. Fluxo legado: relatórios financeiros
Arquivo
`src/modules/reports/logic.ts`
Trechos reais
```ts
const expense = filtered.filter(t => t.type === 'despesa' || t.type === 'parcelado').reduce((sum, t) => sum + t.value, 0);
```
```ts
const operationalExpenses = filtered.filter(t => t.type === 'despesa' || t.type === 'parcelado').reduce((sum, t) => sum + t.value, 0);
```
```ts
transactions.filter(t => t.date.startsWith(currentMonth) && (t.type === 'despesa' || t.type === 'parcelado') && t.cardId).forEach(t => {
    currentCardUsage += t.value;
});
```
Diagnóstico
Os relatórios tratam `parcelado` como despesa e inferem dívida de cartão por transações do mês atual com `cardId`.
Não existe leitura por:
faturas abertas;
faturas fechadas;
faturas vencidas;
pagamentos registrados;
saldo restante;
parcelas futuras;
limite por ledger.
---
8. Fluxo legado: recorrentes com cartão
Arquivo
`src/modules/recurring-expenses/types.ts`
Trecho real
```ts
cartaoIdOpcional?: string;         // id do cartão cadastrado
usarCartaoAutomaticamente?: boolean; // se true, gera compra recorrente no cartão
```
Arquivo
`src/components/RecurringExpenseDetailsView.tsx`
Trechos reais
```ts
const isCreditCard = expense.metodoPagamento === 'cartaoCredito' && expense.usarCartaoAutomaticamente;
```
```ts
const newTransaction: any = {
    id: transactionId,
    description: `${expense.nome} (${new Date(occurrence.dataPrevista).toLocaleString('pt-BR', { month: 'long' })})`,
    value: occurrence.valorPrevisto,
    date: occurrence.dataPrevista,
    category: isPJ ? (expense.tipoEmpresa || 'Contratos') : 'Assinaturas', 
    type: 'despesa', 
    paymentMethod: expense.metodoPagamento === 'cartaoCredito' ? 'Cartão de Crédito' : 'Outro',
    isPaid: markAsPaid,
    profileId: activeWorkspace.id
};
```
```ts
if (isCreditCard && expense.cartaoIdOpcional) {
    newTransaction.cardId = parseInt(expense.cartaoIdOpcional);
}
```
Diagnóstico
Recorrentes pagos com cartão ainda geram transação comum do tipo `despesa`.
Além disso, existe risco de inconsistência de ID porque `cartaoIdOpcional` é `string`, mas é convertido com `parseInt`.
---
9. Fluxo legado: divisão de contas com cartão
Arquivo
`src/components/SplitBillFormModal.tsx`
Trecho real
```ts
integrationData = {
    description: descricao,
    value: parseFloat(valorTotal),
    category: categoria,
    date: data,
    type: formaPagamento === 'cartaoCredito' ? 'parcelado' : 'despesa',
    installments: formaPagamento === 'cartaoCredito' ? parseInt(parcelas) : undefined,
    cardId: formaPagamento === 'cartaoCredito' ? parseInt(cartaoId) : undefined,
    paymentMethod: formaPagamento,
    isPaid: true,
    ...installmentsInfo
};
```
Arquivo
`src/components/SplitGroupDetailsView.tsx`
Trechos reais
```ts
if (integrationData.type === 'parcelado') {
    const card = creditCards.find(c => c.id === integrationData.cardId);
```
```ts
newTransactions.push({
    type: 'parcelado',
    description: `${integrationData.description} (Grupo: ${group.nome})`,
    category: integrationData.category,
    value: currentVal,
    date: dueDate.toISOString().split('T')[0],
    installments: totalInstallments,
    currentInstallment: i + 1,
    cardId: card.id,
    isPaid: false
});
```
Diagnóstico
A divisão de contas replica no frontend a lógica de parcelamento. Esse fluxo também precisará ser migrado para o caso de uso oficial de criação de compra no cartão.
Também existe risco de incompatibilidade de ID por uso de `parseInt(cartaoId)`.
---
10. Fluxo legado: transações recentes
Arquivo
`src/components/RecentTransactions.tsx`
Trechos reais
```tsx
<option value="parcelado">Parceladas</option>
```
```tsx
{(t.type === 'despesa' || t.type === 'parcelado') && (
    <CatalogVisualChip
        visual={visuals.productService}
        fallbackLabel={t.description}
    />
)}
```
```tsx
{t.type === 'parcelado' && (
    <span className="text-xs text-purple-600 dark:text-purple-300 font-medium">
        Parcela {t.currentInstallment}/{t.installments}
    </span>
)}
```
Diagnóstico
O componente de transações recentes também exibe parcelas como transações comuns.
---
11. Fluxo legado: metas e alocação financeira
Arquivo
`src/modules/goals/logic.ts`
Trecho real
```ts
const expenses = periodTransactions.filter(t => t.type === 'despesa' || t.type === 'parcelado').reduce((acc, t) => acc + t.value, 0);
```
Arquivo
`src/modules/allocations/logic.ts`
Trecho real
```ts
transactions.forEach(t => {
    if (t.type === 'despesa' || t.type === 'parcelado') {
        const bucket = CATEGORY_MAP[t.category] || 'estilo_vida';
        if (bucket in buckets) buckets[bucket as AllocationBucket] += t.value;
    } else if (t.type === 'investimento') {
```
Diagnóstico
Metas e alocação financeira também tratam `parcelado` como despesa.
---
12. Fluxo legado: auditoria genérica de transações
Arquivo
`functions/src/triggers/transactions.ts`
Trechos reais
```ts
export const onTransactionWrite = onDocumentWritten(
  "workspaces/{workspaceId}/transactions/{transactionId}",
  async (event) => {
```
```ts
const logsRef = db.collection(`workspaces/${workspaceId}/activity_logs`);
```
Diagnóstico
A auditoria atual nasce de escrita em `transactions`. Ela não representa eventos próprios de cartão, como:
compra lançada;
parcelas geradas;
fatura fechada;
pagamento registrado;
limite consumido;
limite recomposto;
estorno;
reversão.
---
13. Fluxo legado: cron de recorrentes
Arquivo
`functions/src/crons/recurring.ts`
Trechos reais
```ts
const expensesRef = db.collectionGroup("recurring_expenses");
const activeSnap = await expensesRef.where("status", "==", "active").get();
```
```ts
const txRef = workspaceRef.collection("transactions").doc();
batch.set(txRef, {
  id: txRef.id,
  type: "despesa",
  description: data.description || "Despesa Recorrente",
  category: data.category || "Outros",
  value: data.value || 0,
  date: nextDate.toISOString(),
  isPaid: false,
  recurringId: docSnap.id,
```
Diagnóstico
O cron cria `transactions` diretamente.
Há divergência relevante: no frontend, o tipo de status de recorrentes usa `ativo`, `pausado` e `cancelado`, enquanto o cron procura `active`.
---
14. Fluxo legado: regras Firestore
Arquivo
`firestore.rules`
Trechos reais
```js
function isValidTransactionType(value) {
  return value in ['receita', 'despesa', 'investimento', 'parcelado'];
}
```
```js
&& (!data.keys().hasAny(['cardId']) || data.cardId is string)
&& (!data.keys().hasAny(['installments']) || (data.installments is int && data.installments > 0))
&& (!data.keys().hasAny(['currentInstallment']) || (data.currentInstallment is int && data.currentInstallment > 0));
```
```js
match /credit_cards/{docId} {
  allow read: if isMember(workspaceId) || isWorkspaceOwnerByParent(workspaceId);
  allow write: if hasRole(workspaceId, ['owner', 'admin', 'member']) || isWorkspaceOwnerByParent(workspaceId);
}
```
Diagnóstico
As regras reconhecem `parcelado` como tipo válido de transação e permitem campos de cartão dentro de `transactions`.
Não existem regras para as futuras coleções do domínio de cartão.
---
15. Fluxo legado: permissões amplas em módulos relacionados
Arquivo
`firestore.rules`
Trechos reais
```js
match /recurring_expenses/{docId} {
  allow read, write: if signedIn();
}
```
```js
match /split_bills/{docId} {
  allow read, write: if signedIn();
}
```
Diagnóstico
Essas permissões são incompatíveis com SaaS multiworkspace seguro.
Mesmo não sendo exclusivamente de cartão, recorrentes e divisão de contas interagem com cartão e parcelamento. Por isso entram no baseline de risco.
---
Subfase 0.3 — Matriz de dependências e riscos de regressão
1. Matriz de dependências
Área	Arquivo principal	Dependência atual	Severidade
Tipo base	`src/types.ts`	`Transaction` concentra cartão e parcelamento	Crítica
Compra manual	`src/components/TransactionModal.tsx`	Frontend gera parcelas e define regra financeira	Crítica
Persistência	`src/App.tsx`, `src/modules/transactions/api.ts`	Batch cria várias `transactions`	Crítica
Limite	`src/components/CreditCardsView.tsx`	Limite calculado por soma de transações	Crítica
Relatórios	`src/modules/reports/logic.ts`	`parcelado` somado como despesa	Crítica
Firestore Rules	`firestore.rules`	Novo domínio ainda sem proteção	Crítica
Dashboard	`src/App.tsx`	`parcelado` entra como despesa	Alta
Lista de despesas	`src/App.tsx`, `src/components/TransactionsView.tsx`	Parcelas aparecem como despesas principais	Alta
Transações recentes	`src/components/RecentTransactions.tsx`	Parcelas aparecem como transações comuns	Alta
Recorrentes	`src/components/RecurringExpenseDetailsView.tsx`, `functions/src/crons/recurring.ts`	Fluxo cria transações comuns	Alta
Split bills	`src/components/SplitBillFormModal.tsx`, `src/components/SplitGroupDetailsView.tsx`	Replica parcelamento no frontend	Alta
Hooks/cache	`src/modules/transactions/hooks.ts`, `src/modules/credit-cards/hooks.ts`, `src/modules/reports/hooks.ts`	Cache não contempla novo domínio	Alta
Índices	`firestore.indexes.json`	Sem índices de fatura/cartão	Alta
Auditoria	`functions/src/triggers/transactions.ts`	Eventos genéricos demais	Alta
Metas	`src/modules/goals/logic.ts`	`parcelado` entra como despesa	Média/alta
Alocações	`src/modules/allocations/logic.ts`	`parcelado` entra como despesa categorizada	Média/alta
---
2. Hooks e cache impactados
Arquivo
`src/modules/transactions/hooks.ts`
Trecho real
```ts
const transactionKey = (workspaceId: string) => ["transactions", workspaceId] as const;
```
Arquivo
`src/modules/credit-cards/hooks.ts`
Trecho real
```ts
queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) });
```
Arquivo
`src/modules/reports/hooks.ts`
Trecho real
```ts
const dataVersion = `${transactions.length}-${goals.length}-${creditCards.length}-${receivables?.length || 0}-${clients?.length || 0}`;
```
Diagnóstico
As invalidações e snapshots atuais ainda dependem de `transactions` e `creditCards`.
O novo domínio exigirá query keys próprias para:
`creditCardPurchases`;
`creditCardInstallments`;
`creditCardInvoices`;
`creditCardInvoicePayments`;
`cardLimitLedger`;
`cardInvoiceViews`.
---
3. Riscos críticos de regressão
3.1 Dupla contagem
Se faturas reais forem criadas enquanto `parcelado` continuar sendo somado como despesa, o mesmo valor poderá aparecer simultaneamente como:
parcela legada;
item de fatura;
pagamento de fatura;
despesa comum.
3.2 Limite divergente
Enquanto `CreditCardsView` calcular limite por soma de transações, qualquer ledger novo poderá divergir da UI.
3.3 Pagamento de fatura contado como despesa adicional
Se o pagamento da fatura for criado como `Transaction` sem remover ou isolar parcelas do cartão, o caixa será reduzido em duplicidade.
3.4 Migração duplicada
Se as parcelas legadas forem migradas sem campos de controle, a migração poderá recriar compras/faturas duplicadas.
Campos futuros necessários:
`legacyMigrated`;
`legacyPurchaseId`;
`legacyMode`;
`legacyInvoiceId`, se aplicável;
`migrationBatchId`.
3.5 Vazamento cross-tenant
Regras como `allow read, write: if signedIn()` não garantem que o usuário pertence ao workspace.
3.6 Perda de histórico por hard delete
APIs atuais usam exclusão definitiva em entidades financeiras, incluindo transações e cartões. O domínio futuro deve priorizar status, cancelamento, reversão e arquivamento.
3.7 Inconsistência de IDs de cartão
Há fluxos que tratam `cardId` como string e outros que convertem para número com `parseInt`.
3.8 Falta de idempotência
Criação de compra, parcelas e pagamentos ainda não possuem `idempotencyKey`.
3.9 Relatórios incorretos
Os relatórios atuais misturam competência, fatura e caixa.
---
4. Estratégia de isolamento do legado
A evolução deve seguir uma estratégia híbrida controlada:
```txt
Modelo legado
transactions com type='parcelado'
        |
        | permanece em modo compatível
        v
Novo domínio oficial
CreditCardPurchase
CreditCardInstallment
CreditCardInvoice
CreditCardInvoicePayment
CardLimitLedger
CardEventLog
        |
        v
Projeções de leitura para UI
lista de despesas
tela de cartão
relatórios
notificações
dashboard
```
Regra
O legado não deve ser removido de imediato.
Primeiro o novo domínio deve existir, ser testado, reconciliado e validado em homologação.
---
Subfase 0.4 — Critérios objetivos para liberar a Fase 1
1. Critério central de aceite da Fase 0
A Fase 0 só pode ser considerada concluída quando o time tiver clareza documentada sobre:
como o fluxo atual de cartão funciona;
onde `parcelado` é tratado como transação comum;
onde `cardId` influencia UI, relatórios, dashboard e integrações;
onde limite do cartão é calculado por soma de transações;
onde há risco de dupla contagem;
quais arquivos não podem ser alterados sem estratégia de compatibilidade;
quais coleções Firestore existem hoje;
quais regras Firestore protegem ou expõem dados;
quais índices existem e quais ainda faltam;
quais fluxos legados precisam continuar funcionando durante a transição.
---
2. Checklist final da Fase 0
Entregável	Status
Documento de baseline	Concluído
Fluxo legado de compra parcelada	Concluído
Fluxo legado de cartões	Concluído
Fluxo legado de relatórios	Concluído
Fluxo legado de recorrentes	Concluído
Fluxo legado de divisão de contas	Concluído
Mapa de dependências	Concluído
Lista de riscos de regressão	Concluído
Matriz comportamento atual x futuro	Concluído
Regra de congelamento	Concluída
---
3. Arquivos congelados até a Fase 1 ser formalmente desenhada
Os arquivos abaixo não devem receber mudanças funcionais relacionadas a cartão antes da conclusão do desenho da Fase 1:
Arquivo	Motivo
`src/types.ts`	Define `TransactionType` e campos legados de cartão
`src/components/TransactionModal.tsx`	Cria parcelas no frontend
`src/App.tsx`	Orquestra batch, dashboard e lista principal
`src/components/CreditCardsView.tsx`	Calcula limite pela UI
`src/components/TransactionsView.tsx`	Exibe parcelas como despesas
`src/components/RecentTransactions.tsx`	Exibe parcelas como transações recentes
`src/modules/transactions/api.ts`	Persiste o modelo legado
`src/modules/reports/logic.ts`	Soma `parcelado` em relatórios
`src/modules/goals/logic.ts`	Usa `parcelado` como despesa
`src/modules/allocations/logic.ts`	Usa `parcelado` como despesa categorizada
`src/components/RecurringExpenseDetailsView.tsx`	Cria transação comum para recorrente com cartão
`src/components/SplitBillFormModal.tsx`	Monta integração de cartão como `parcelado`
`src/components/SplitGroupDetailsView.tsx`	Replica criação de parcelas
`functions/src/triggers/transactions.ts`	Auditoria genérica de transações
`functions/src/crons/recurring.ts`	Cria transações recorrentes
`firestore.rules`	Ainda não possui regras do novo domínio
`firestore.indexes.json`	Ainda não possui índices do novo domínio
---
4. Critérios para liberar a Fase 1
Critério 1 — Legado preservado
O modelo atual baseado em `transactions` deve permanecer funcional durante o redesenho.
Não remover:
`type: 'parcelado'`;
`cardId`;
`installments`;
`currentInstallment`;
`isPaid`.
Critério 2 — Novo domínio paralelo
A Fase 1 deve criar conceitos novos sem substituir imediatamente o legado.
Entidades esperadas:
`CreditCardPurchase`;
`CreditCardInstallment`;
`CreditCardInvoice`;
`CreditCardInvoicePayment`;
`CardLimitLedger`;
`CardEventLog`.
Critério 3 — Sem dupla contagem
Antes de qualquer implementação funcional, a Fase 1 deve definir como impedir que o mesmo valor apareça simultaneamente como:
parcela legada;
item de fatura;
pagamento de fatura;
despesa comum.
Critério 4 — Separação contábil obrigatória
A Fase 1 deve explicitar a diferença entre:
compra no cartão;
obrigação futura;
fatura consolidada;
pagamento;
saída real de caixa;
recomposição de limite.
Critério 5 — Multiworkspace nativo
Toda entidade futura deve possuir ou herdar escopo de:
`workspaceId`;
`cardId`, quando aplicável;
`createdBy`;
timestamps;
status operacional.
Nenhuma entidade pode nascer sem estratégia de isolamento por workspace.
Critério 6 — Idempotência obrigatória
A Fase 1 deve prever idempotência para:
criação de compra;
edição de compra;
cancelamento de compra;
geração de parcelas;
vínculo de parcelas com faturas;
fechamento de fatura;
pagamento de fatura;
estorno;
recomposição de limite;
migração de legado.
Critério 7 — Auditoria obrigatória
A Fase 1 deve prever trilha de auditoria para:
criação;
edição;
cancelamento;
fechamento;
pagamento;
estorno;
ajuste de limite;
migração;
divergência de reconciliação.
Critério 8 — Projeções para UI
A UI não deve recalcular fatura e limite no browser.
A UI deverá consumir projeções ou leituras estruturadas para:
lista principal;
tela do cartão;
tela de fatura;
relatórios;
notificações;
dashboard.
Critério 9 — Migração futura planejada
A Fase 1 deve considerar que dados legados em `transactions` precisarão ser migrados ou conciliados com segurança.
Critério 10 — Rollout reversível
A Fase 1 deve manter possibilidade de rollout progressivo por workspace.
O novo domínio não deve ser obrigatório para todos os workspaces no primeiro momento.
---
5. Matriz comportamento atual x comportamento futuro
Tema	Comportamento atual	Comportamento futuro
Compra no cartão	Vira uma ou várias `transactions`	`CreditCardPurchase`
Parcela	`Transaction` com `currentInstallment`	`CreditCardInstallment`
Fatura	Não existe entidade oficial	`CreditCardInvoice`
Pagamento de fatura	Não existe fluxo próprio	`CreditCardInvoicePayment`
Limite usado	Soma em `CreditCardsView`	`CardLimitLedger` + projeção
Saída de caixa	`parcelado` entra como despesa	Só pagamento da fatura baixa caixa
Lista principal	Mostra parcelas soltas	Mostra faturas/projeções de fatura
Relatórios	Somam `parcelado` como despesa	Separam competência, fatura e caixa
Recorrentes	Geram `Transaction`	Devem gerar compra/fatura pelo domínio
Split bills	Geram `parcelado` no frontend	Devem chamar serviço de compra
Auditoria	Log genérico de transação	Eventos financeiros de cartão
Segurança	Regras parciais	Regras por coleção, workspace e papel
Idempotência	Ausente no cartão	Obrigatória
Migração	Inexistente	Idempotente e reconciliável
---
6. Ordem segura para iniciar a Fase 1
A Fase 1 deve começar nesta ordem:
Definir os tipos TypeScript do novo domínio em arquivo separado.
Definir invariantes financeiras do domínio.
Definir estados permitidos de compra, parcela, fatura, pagamento e ledger.
Definir relacionamento entre entidades.
Definir política de compatibilidade com `transactions`.
Definir política de projeção para UI.
Definir política de migração do legado.
Definir impacto nas regras Firestore.
Definir impacto nos índices Firestore.
Definir matriz mínima de testes.
A Fase 1 não deve começar alterando UI.
---
7. Regra de congelamento
Durante a Fase 0 e até o início formal da Fase 1, nenhum arquivo de runtime deve ser alterado para mudar comportamento financeiro.
Não alterar ainda:
cálculo de parcelas no frontend;
exibição de `parcelado` na lista;
cálculo de limite em `CreditCardsView`;
soma de `parcelado` em relatórios;
`TransactionType`;
regras Firestore;
Cloud Functions;
APIs de transações;
índices de produção.
Qualquer alteração funcional antes da estratégia de compatibilidade pode causar regressão, dupla contagem ou perda de dados financeiros.
---
8. Decisão final da Fase 0
O sistema atual deve ser classificado como:
```txt
Modelo funcional legado baseado em transactions, com suporte visual a cartões e parcelas, mas sem domínio financeiro oficial de cartão, fatura, pagamento, ledger e auditoria específica.
```
A direção técnica aprovada para evolução é:
```txt
Criar domínio financeiro paralelo, multiworkspace, auditável, idempotente e orientado por agregados, preservando o legado até que migração, projeções e rollout estejam seguros.
```
9. Critério de aceite final
A Fase 0 está concluída quando este documento for revisado e aceito como fonte de verdade para a próxima etapa.
Depois disso, a próxima etapa autorizada é:
```txt
Fase 1 — Redesenho do domínio financeiro
```
A Fase 1 deve começar por modelagem, não por UI.