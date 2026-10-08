import React, { useState, useEffect, useMemo, useRef } from "react";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { WorkspaceProvider, useWorkspace } from "./contexts/WorkspaceContext";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import SummaryCard from "./components/SummaryCard";
import TransactionsChart from "./components/TransactionsChart";
import RecentTransactions from "./components/RecentTransactions";
import TransactionModal from "./components/TransactionModal";
import Notification from "./components/Notification";
import TransactionsView from "./components/TransactionsView";
import ConfirmationModal from "./components/ConfirmationModal";
import SettingsView from "./components/SettingsView";
import CreditCardsView from "./components/CreditCardsView";
import PersonalizationView from "./components/PersonalizationView";
import GoalsView from "./components/GoalsView";
import GoalDetailsView from "./components/GoalDetailsView";
import GoalFormModal from "./components/GoalFormModal";
import SplitGroupsView from "./components/SplitGroupsView";
import SplitGroupDetailsView from "./components/SplitGroupDetailsView";
import RecurringExpensesView from "./components/RecurringExpensesView";
import RecurringExpenseDetailsView from "./components/RecurringExpenseDetailsView";
import RecurringDashboardWidget from "./components/RecurringDashboardWidget";
import ReportsView from "./components/ReportsView";
import ReportsWidget from "./components/ReportsWidget";
import ClientsReceivablesView from "./components/ClientsReceivablesView";
import LoansView from "./components/LoansView";
import LoanDetailsView from "./components/LoanDetailsView";
import PJLoansView from "./components/PJLoansView";
import PJLoanDetailsView from "./components/PJLoanDetailsView";
import { useGoals, useCreateGoal, useUpdateGoal, useArchiveGoal } from "./modules/goals/hooks";
import type { GoalWriteInput } from "./modules/goals/api";
import { AdminDashboard } from './components/AdminDashboard';
import { PricingTable } from './modules/billing/components/PricingTable';
import { BillingSuccessModal } from './modules/billing/components/BillingSuccessModal';
import { BillingProvider } from './modules/billing/BillingContext';

// Paleta de cores dos gráficos de categoria (apresentação). Os cadastros
// do workspace vêm só do catálogo autoritativo (D-23), lido pelos módulos.
import { REPORT_CATEGORY_PALETTE } from "./constants";

import type {
    Transaction,
    TransactionType,
    SummaryData,
    Goal,
} from "./types";

import { WalletIcon, ArrowUpIcon, ArrowDownIcon, ChartBarIcon } from "./components/Icons";
import { isSameMonthYear } from "./utils/date";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCreateNotification } from "./modules/notifications/hooks";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LoginView } from "./components/auth/LoginView";

// --- HOOKS MIGRADOS ---
import {
    useTransactions,
    useCreateCashTransaction,
    useUpdateCashTransaction,
    useConfirmCashTransaction,
    useVoidCashTransaction,
} from "./modules/transactions/hooks";
import {
    cashErrorView,
    isManualCashEntryCandidate,
    REASON_MAX_LENGTH,
    resolveIntentKey,
    toVoidCashPayload,
    type IntentKey,
} from "./modules/transactions/cashEntry";
import { newIdempotencyKey } from "./modules/workspaces/callables";

// P4-A: cartões autoritativos; a compra manual é só a callable.
import { useCreateCardPurchase, useCreditCards } from "./modules/cards/hooks";
import { formatCompetence } from "./modules/cards/cycle";
import {
    investmentEntryOf,
    isCreditCardPaymentCashMirror,
    summarizeCashFlow,
} from "./modules/investments/semantics";
import { investmentMonthKey } from "./modules/investments/dashboard";
import { useInvestmentMonthContribution } from "./modules/investments/simple/api";
const CARD_PAYMENT_MIRROR_MESSAGE =
    'Pagamentos de fatura de cartão são registrados e estornados pela tela de cartões.';
/*
 * P4-D: o cliente não escreve em `transactions`. Lançamento que não é do
 * Caixa manual (espelho de investimento, empréstimo, recebível, Divisão de
 * contas) é alterado só pelo módulo que o gerou.
 */
const INVESTMENT_MIRROR_MESSAGE =
    'Lançamentos de investimento são confirmados, desfeitos ou cancelados pela tela de Investimentos.';
const DOMAIN_MIRROR_MESSAGE =
    'Este lançamento é gerado por outro módulo e só pode ser alterado por ele.';

/*
 * Investimentos tem uma experiência só: a simples (D-15, P4-D).
 */
const SimpleInvestmentsView = React.lazy(
    () => import("./modules/investments/simple/components/SimpleInvestmentsView"),
);
// ----------------------

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5,
            refetchOnWindowFocus: false,
        },
    },
});

const AppContent: React.FC = () => {
    const { theme, toggleMode, playSound } = useTheme();
    const { activeWorkspace, isLoading, loadError, activeWorkspaceRole } = useWorkspace();
    const workspaceId = activeWorkspace?.id ?? "";
    const { user, logout } = useAuth();

    // Estados de UI
    const [isSidebarExpanded, setIsSidebarExpanded] = useState<boolean>(false);
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [transactionModalDefaultType, setTransactionModalDefaultType] = useState<TransactionType | null>(null);
    const [transactionModalAllowedTypes, setTransactionModalAllowedTypes] = useState<TransactionType[] | null>(null);
    const [notification, setNotification] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
    const [view, setView] = useState<'dashboard' | 'receita' | 'despesa' | 'investimento' | 'settings' | 'cards' | 'personalizacao' | 'goals' | 'goal_details' | 'shared_expenses' | 'split_group_details' | 'recurring' | 'recurring_details' | 'reports' | 'clients_receivables' | 'loans' | 'loan_details' | 'admin' | 'planos'>('dashboard');
    const [currentDate, setCurrentDate] = useState(new Date());

    const openFullTransactionModal = () => {
        setTransactionToEdit(null);
        setTransactionModalDefaultType(null);
        setTransactionModalAllowedTypes(null);
        setIsModalOpen(true);
    };

    const openScopedTransactionModal = (viewType: 'receita' | 'despesa') => {
        setTransactionToEdit(null);

        if (viewType === 'receita') {
            setTransactionModalDefaultType('receita');
            setTransactionModalAllowedTypes(['receita']);
        } else {
            setTransactionModalDefaultType('despesa');
            setTransactionModalAllowedTypes(['despesa', 'parcelado']);
        }

        setIsModalOpen(true);
    };

    /** Motivo pelo qual o lançamento não é editável aqui, ou `null`. */
    const nonEditableReason = (transaction: Transaction): string | null => {
        if (isCreditCardPaymentCashMirror(transaction)) return CARD_PAYMENT_MIRROR_MESSAGE;
        if (isManualCashEntryCandidate(transaction)) return null;
        return investmentEntryOf(transaction) ? INVESTMENT_MIRROR_MESSAGE : DOMAIN_MIRROR_MESSAGE;
    };

    const openEditTransactionModal = (transaction: Transaction) => {
        const reason = nonEditableReason(transaction);
        if (reason) {
            showNotification(reason);
            return;
        }

        setTransactionToEdit(transaction);
        setTransactionModalDefaultType(transaction.type);
        setTransactionModalAllowedTypes([transaction.type]);
        setIsModalOpen(true);
    };

    const closeTransactionModal = () => {
        setIsModalOpen(false);
        setTransactionToEdit(null);
        setTransactionModalDefaultType(null);
        setTransactionModalAllowedTypes(null);
    };

    // --- INTEGRACAO COM FIRESTORE (HOOKS) ---

    // 1. Transações
    const { data: transactionsData } = useTransactions(workspaceId);
    // P3-E: lançamento manual confirmado pelas callables autoritativas.
    const createCashMutation = useCreateCashTransaction(workspaceId);
    const updateCashMutation = useUpdateCashTransaction(workspaceId);
    // P3-F: confirmação de pendente (D-29).
    const confirmCashMutation = useConfirmCashTransaction(workspaceId);
    const voidCashMutation = useVoidCashTransaction(workspaceId);
    const createCardPurchaseMutation = useCreateCardPurchase();
    const transactions = useMemo(() => transactionsData || [], [transactionsData]);

    // 2. Cartões de crédito (P4-A): leitura do domínio autoritativo.
    const { data: creditCardsData } = useCreditCards();
    const creditCards = useMemo(() => creditCardsData || [], [creditCardsData]);

    // --- GOALS (MIGRADO) ---
    const { data: goalsData } = useGoals();
    const createGoalMutation = useCreateGoal();
    const updateGoalMutation = useUpdateGoal();
    const archiveGoalMutation = useArchiveGoal();
    const goals = useMemo(() => goalsData || [], [goalsData]);

    const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
    // Anulação autoritativa (P3-E, D-35): confirmação com justificativa.
    const [transactionToVoid, setTransactionToVoid] = useState<Transaction | null>(null);
    const [voidReason, setVoidReason] = useState('');
    const [voidError, setVoidError] = useState<string | null>(null);
    const voidIntentRef = useRef<IntentKey | null>(null);
    const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);

    useEffect(() => {
        if (selectedGoal) {
            const fresh = goals.find(g => g.id === selectedGoal.id);
            if (fresh) setSelectedGoal(fresh);
        }
    }, [goals, selectedGoal]);

    const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);

    const [goalToEdit, setGoalToEdit] = useState<Goal | null>(null);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [selectedRecurringExpenseId, setSelectedRecurringExpenseId] = useState<string | null>(null);
    const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);

    const createNotification = useCreateNotification();

    // Filtros de memória para itens locais

    const showNotification = (message: string) => {
        setNotification({ message, visible: true });
        setTimeout(() => setNotification({ message: '', visible: false }), 3000);
        playSound('notification');
    };

    const handleNavigate = (newView: string) => {
        if (newView.startsWith('report:')) setView('reports');
        else setView(newView as any);
        playSound('click');
    };

    const handleOpenSplitGroup = (groupId: string) => {
        setSelectedGroupId(groupId);
        setView('split_group_details');
    };

    // --- HANDLERS TRANSAÇÕES ---
    /*
     * Lançamento manual confirmado do formulário (P3-E). Só o modal chama.
     * Sem escrita local e sem caminho legado de reserva: a recusa sobe para
     * o modal, que mostra o erro em pt-BR. Recorrentes (P4-B), Empréstimos
     * (P3-G/H) e Divisão de contas (P4-C) gravam o fato só pelo backend.
     */
    const handleCreateManualTransaction = async (
        payload: Record<string, unknown>,
        idempotencyKey: string,
    ) => {
        await createCashMutation.mutateAsync({ payload, idempotencyKey });
        showNotification('Transação salva!');
        playSound('success');
    };

    const handleUpdateManualTransaction = async (
        payload: Record<string, unknown>,
        idempotencyKey: string,
    ) => {
        await updateCashMutation.mutateAsync({ payload, idempotencyKey });
        showNotification('Atualizado!');
        playSound('success');
    };

    const handleConfirmManualTransaction = async (
        payload: Record<string, unknown>,
        idempotencyKey: string,
    ) => {
        await confirmCashMutation.mutateAsync({ payload, idempotencyKey });
        showNotification('Lançamento confirmado!');
        playSound('success');
    };

    /**
     * Compra manual no cartão (P4-A): só a callable `createCreditCardPurchase`.
     * O modal decide a chave por intenção e mostra o erro (pt-BR) no próprio
     * formulário; aqui fica só o aviso de sucesso.
     */
    const handleAddCreditCardPurchase = async (
        payload: Record<string, unknown>,
        idempotencyKey: string,
    ) => {
        const result = await createCardPurchaseMutation.mutateAsync({ payload, idempotencyKey });
        showNotification(result.retroactive && result.firstCompetence
            ? `Compra lançada. Parcelas de fatura já fechada foram para a fatura de ${formatCompetence(result.firstCompetence)}.`
            : 'Compra lançada no cartão.');
        playSound('success');
        return result;
    };


    const confirmDeleteTransaction = (t: Transaction) => {
        const reason = nonEditableReason(t);
        if (reason) {
            showNotification(reason);
            return;
        }
        // Lançamento manual: anulação autoritativa com motivo.
        voidIntentRef.current = null;
        setVoidReason('');
        setVoidError(null);
        setTransactionToVoid(t);
    };

    const closeVoidConfirmation = () => {
        if (voidCashMutation.isPending) return;
        setTransactionToVoid(null);
        setVoidReason('');
        setVoidError(null);
        voidIntentRef.current = null;
    };

    const handleVoidTransaction = async () => {
        if (!transactionToVoid || voidCashMutation.isPending) return;
        setVoidError(null);
        try {
            const payload = toVoidCashPayload({
                workspaceId,
                transactionId: String(transactionToVoid.id),
                updatedAt: transactionToVoid.updatedAt,
                reason: voidReason,
            });
            // Mesmo conteúdo reenviado depois de falha: mesma chave.
            const intent = resolveIntentKey(
                voidIntentRef.current, 'voidCashTransaction', payload, newIdempotencyKey,
            );
            voidIntentRef.current = intent;
            await voidCashMutation.mutateAsync({ payload, idempotencyKey: intent.key });
            setTransactionToVoid(null);
            setVoidReason('');
            voidIntentRef.current = null;
            showNotification('Lançamento anulado.');
            playSound('success');
        } catch (error) {
            setVoidError(cashErrorView(error).message);
        }
    };

    const toGoalWriteInput = (goal: Omit<Goal, 'id'> & { id?: string }): GoalWriteInput => {
        const {
            currentAmount: _currentAmount,
            createdAt: _createdAt,
            updatedAt: _updatedAt,
            id: _id,
            currentAmountCents: _currentAmountCents,
            netContributionCents: _netContributionCents,
            currentValueCents: _currentValueCents,
            targetAmountCents: _targetAmountCents,
            archived: _archived,
            archivedAt: _archivedAt,
            ...writeInput
        } = goal;
        return writeInput;
    };

    const handleSaveGoal = async (
        goal: Omit<Goal, 'id'> & { id?: string },
        idempotencyKey: string,
    ): Promise<Goal> => {
        try {
            const writeInput = toGoalWriteInput(goal);
            let persistedGoal: Goal;
            if (goal.id) {
                persistedGoal = await updateGoalMutation.mutateAsync({
                    id: goal.id,
                    goal: writeInput,
                    idempotencyKey,
                });
            } else {
                persistedGoal = await createGoalMutation.mutateAsync({
                    goal: writeInput,
                    idempotencyKey,
                });
            }
            showNotification('Meta salva com sucesso!');
            playSound('success');
            return persistedGoal;
        } catch (e) {
            console.error(e);
            showNotification('Erro ao salvar meta.');
            throw e;
        }
    };

    const handleDeleteGoal = async (id: string) => {
        if (confirm('Tem certeza que deseja arquivar esta meta? O histórico de aportes será preservado.')) {
            try {
                await archiveGoalMutation.mutateAsync({id, idempotencyKey: crypto.randomUUID()});
                showNotification('Meta arquivada com sucesso!');
                playSound('success');
                // Se estiver na tela de detalhes, volta para lista
                if (view === 'goal_details') setView('goals');
            } catch (e) {
                console.error(e);
                showNotification('Erro ao arquivar meta.');
            }
        }
    };

    const currentMonthTransactions = useMemo(
        () => transactions.filter((transaction) => isSameMonthYear(transaction.date, currentDate)),
        [transactions, currentDate]
    );

    // P4-A: sem projeção de faturas em `transactions`. O espelho do pagamento
    // de fatura entra no saldo e fica fora de receitas e despesas
    // (`summarizeCashFlow`); a compra no cartão vive no domínio de cartões.
    const currentMonthCashFlowTransactions = currentMonthTransactions;

    const summaryData: SummaryData = useMemo(() => {
        return summarizeCashFlow(currentMonthCashFlowTransactions);
    }, [currentMonthCashFlowTransactions]);
    // Card "Investimentos": aporte do mês na projeção oficial do domínio
    // patrimonial (`investment_report_periods`), não no espelho de caixa.
    const { data: investmentMonthCents } = useInvestmentMonthContribution(
        workspaceId, investmentMonthKey(currentDate),
    );

    if (isLoading) return <div className="flex h-screen items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;
    // P1 (AUTH-10): sem workspace válido o app não é renderizado sobre um
    // pseudo-workspace; a falha aparece em pt-BR, com saída da conta.
    if (loadError) return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="max-w-md text-sm text-on-surface" role="alert">{loadError}</p>
            <button type="button" onClick={() => void logout()} className="text-sm font-medium text-primary hover:underline">Sair</button>
        </div>
    );

    return (
        <div className="flex min-h-screen bg-background text-on-surface font-sans">
            <Sidebar isExpanded={isSidebarExpanded} setExpanded={setIsSidebarExpanded} onNavigate={handleNavigate} currentView={view} />
            <main className="flex-1 p-4 lg:p-8 overflow-x-hidden">
                <Header onToggleSidebar={() => setIsSidebarExpanded(!isSidebarExpanded)} isSidebarExpanded={isSidebarExpanded} onToggleDarkMode={toggleMode} isDarkMode={theme.mode === 'dark'} currentDate={currentDate} onCurrentDateChange={setCurrentDate} onNavigate={handleNavigate} onOpenSplitGroup={handleOpenSplitGroup} />

                {view === 'dashboard' && (
                    <div className="flex flex-col gap-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                            <SummaryCard title="Saldo Atual" value={summaryData.balance} trend="Mensal" icon={<WalletIcon />} color={activeWorkspace.type === 'PJ' ? 'purple' : 'blue'} />
                            <SummaryCard title="Receitas" value={summaryData.income} trend="Mensal" icon={<ArrowUpIcon />} color="green" isClickable onClick={() => handleNavigate('receita')} />
                            <SummaryCard title="Despesas" value={summaryData.expenses} trend="Mensal" icon={<ArrowDownIcon />} color="red" isClickable onClick={() => handleNavigate('despesa')} />
                            <SummaryCard title="Investimentos" value={(investmentMonthCents ?? 0) / 100} trend="Mensal" icon={<ChartBarIcon />} color="indigo" isClickable onClick={() => handleNavigate('investimento')} />
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="flex flex-col gap-6">
                                <TransactionsChart transactions={currentMonthCashFlowTransactions} />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <RecurringDashboardWidget />
                                    <ReportsWidget transactions={transactions} goals={goals} creditCards={creditCards} onNavigate={() => handleNavigate('reports')} />
                                </div>
                            </div>
                            <RecentTransactions transactions={transactions} onNewTransaction={openFullTransactionModal} />
                        </div>
                    </div>
                )}

                {view === 'reports' && <ReportsView transactions={transactions} goals={goals} creditCards={creditCards} categories={REPORT_CATEGORY_PALETTE} />}
                {view === 'goals' && (
                    <GoalsView
                        transactions={transactions}
                        onSelectGoal={(g) => { setSelectedGoal(g); setView('goal_details'); }}
                        onOpenGoalModal={(g) => { setGoalToEdit(g || null); setIsGoalModalOpen(true); }}
                    />
                )}
                {view === 'goal_details' && selectedGoal && (
                    <GoalDetailsView
                        goal={selectedGoal}
                        transactions={transactions}
                        onBack={() => setView('goals')}
                        onEdit={g => { setGoalToEdit(g); setIsGoalModalOpen(true); }}
                        onDelete={handleDeleteGoal}
                    />
                )}
                {view === 'investimento' && (
                    <React.Suspense fallback={<div className="p-6 text-sm text-gray-600">Carregando investimentos...</div>}>
                        <SimpleInvestmentsView
                            workspaceId={workspaceId}
                            profileType={activeWorkspace.type}
                            goals={goals}
                            role={activeWorkspaceRole}
                            onBack={() => setView('dashboard')}
                        />
                    </React.Suspense>
                )}
                {(view === 'receita' || view === 'despesa') && <TransactionsView
                    viewType={view}
                    transactions={
                        view === 'despesa'
                            ? currentMonthTransactions.filter(
                                t => t.type === 'despesa' || t.type === 'parcelado',
                            )
                            : currentMonthTransactions.filter(t => t.type === view)
                    }
                    onBack={() => setView('dashboard')}
                    onAddTransaction={() => openScopedTransactionModal(view)}
                    onEditTransaction={openEditTransactionModal}
                    onDeleteTransaction={confirmDeleteTransaction}
                />}
                {view === 'settings' && <SettingsView />}

                {view === 'cards' && <CreditCardsView />}

                {view === 'personalizacao' && <PersonalizationView onBack={() => setView('settings')} />}
                {view === 'shared_expenses' && <SplitGroupsView onSelectGroup={id => { setSelectedGroupId(id); setView('split_group_details'); }} onCreateGroup={() => { }} />}
                {view === 'split_group_details' && selectedGroupId && <SplitGroupDetailsView groupId={selectedGroupId} onBack={() => setView('shared_expenses')} creditCards={creditCards} />}
                {view === 'recurring' && <RecurringExpensesView onSelectExpense={id => { setSelectedRecurringExpenseId(id); setView('recurring_details'); }} creditCards={creditCards} />}
                {view === 'recurring_details' && selectedRecurringExpenseId && <RecurringExpenseDetailsView expenseId={selectedRecurringExpenseId} onBack={() => setView('recurring')} creditCards={creditCards} />}
                {view === 'clients_receivables' && activeWorkspace.type === 'PJ' && <ClientsReceivablesView />}

                {view === 'loans' && activeWorkspace.type === 'PJ' && (
                    <PJLoansView
                        onSelectLoan={(l) => { setSelectedLoanId(l.id); setView('loan_details'); }}
                    />
                )}
                {view === 'loan_details' && selectedLoanId && activeWorkspace.type === 'PJ' && (
                    <PJLoanDetailsView
                        loanId={selectedLoanId}
                        onBack={() => setView('loans')}
                    />
                )}

                {view === 'loans' && activeWorkspace.type === 'PF' && <LoansView onSelectLoan={(l) => { setSelectedLoanId(l.id); setView('loan_details'); }} />}
                {view === 'loan_details' && selectedLoanId && activeWorkspace.type === 'PF' && <LoanDetailsView loanId={selectedLoanId} onBack={() => setView('loans')} />}
                {view === 'admin' && user?.isAdmin && <AdminDashboard />}
                {view === 'planos' && <PricingTable />}

            </main>

            <TransactionModal
                isOpen={isModalOpen}
                onClose={closeTransactionModal}
                onAddCreditCardPurchase={handleAddCreditCardPurchase}
                onCreateManualTransaction={handleCreateManualTransaction}
                onUpdateManualTransaction={handleUpdateManualTransaction}
                onConfirmManualTransaction={handleConfirmManualTransaction}
                transactionToEdit={transactionToEdit}
                defaultType={transactionModalDefaultType}
                allowedTypes={transactionModalAllowedTypes}
                currentDate={currentDate}
                creditCards={creditCards}
                goals={goals}
                onInvestmentSuccess={showNotification}
            />
            <ConfirmationModal
                isOpen={transactionToVoid !== null}
                onClose={closeVoidConfirmation}
                onConfirm={handleVoidTransaction}
                title="Anular lançamento"
                message="O lançamento sai do caixa e continua no histórico, com o motivo informado."
                confirmLabel="Confirmar anulação"
                reason={{
                    label: 'Motivo da anulação',
                    value: voidReason,
                    onChange: setVoidReason,
                    maxLength: REASON_MAX_LENGTH,
                }}
                isBusy={voidCashMutation.isPending}
                error={voidError}
            />
            <GoalFormModal isOpen={isGoalModalOpen} onClose={() => setIsGoalModalOpen(false)} onSave={handleSaveGoal} goalToEdit={goalToEdit} />
            <Notification message={notification.message} isVisible={notification.visible} />
        </div>
    );
};

const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, loading } = useAuth();
    if (loading) return <div className="flex h-screen items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div></div>;
    if (!user) return <LoginView />;
    return <>{children}</>;
};

const App: React.FC = () => (
    <QueryClientProvider client={queryClient}>
        <AuthProvider>
            <ThemeProvider>
                <WorkspaceProvider>
                    {/* Billing depois do bootstrap da conta (WorkspaceProvider). */}
                    <BillingProvider>
                        <BillingSuccessModal />
                        <AuthGuard>
                            <AppContent />
                        </AuthGuard>
                    </BillingProvider>
                </WorkspaceProvider>
            </ThemeProvider>
        </AuthProvider>
    </QueryClientProvider>
);

export default App;
