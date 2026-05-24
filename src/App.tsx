import React, { useState, useEffect, useMemo } from "react";
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
import { useGoals, useCreateGoal, useUpdateGoal, useDeleteGoal } from "./modules/goals/hooks";
import { AdminDashboard } from './components/AdminDashboard';
import { PricingTable } from './modules/billing/components/PricingTable';
import { BillingSuccessModal } from './modules/billing/components/BillingSuccessModal';

import {
    initialProductsServices,
    initialExpenseTypes,
    initialCategoriesSettings,
    initialPaymentTypes,
    initialIncomeTypes,
    initialWallets,
} from "./constants";

import type {
    Transaction,
    TransactionType,
    SummaryData,
    EntityItem,
    Goal,
    CreditCardPurchaseModalInput
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
    useCreateTransaction,
    useCreateTransactionsBatch,
    useUpdateTransaction,
    useDeleteTransaction,
} from "./modules/transactions/hooks";

import {
    useCreditCards,
    useCreateCreditCardPurchaseDomain,
} from "./modules/credit-cards/hooks";

import {
    filterReversedCreditCardInvoicePaymentCashTransactions,
    filterTransactionsForCreditCardCompatibility,
    isCreditCardInvoiceCompatibleTransaction,
    useCreditCardInvoiceTransactionProjections,
} from "./modules/credit-cards/compatibility";
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
    const { activeWorkspace, isLoading } = useWorkspace();
    const workspaceId = activeWorkspace?.id ?? "";
    const { user } = useAuth();

    // Estados de UI
    const [isSidebarExpanded, setIsSidebarExpanded] = useState<boolean>(false);
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [transactionModalDefaultType, setTransactionModalDefaultType] = useState<TransactionType | null>(null);
    const [transactionModalAllowedTypes, setTransactionModalAllowedTypes] = useState<TransactionType[] | null>(null);
    const [notification, setNotification] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
    const [view, setView] = useState<'dashboard' | 'receita' | 'despesa' | 'investimento' | 'settings' | 'cards' | 'personalizacao' | 'goals' | 'goal_details' | 'shared_expenses' | 'split_group_details' | 'recurring' | 'recurring_details' | 'reports' | 'clients_receivables' | 'loans' | 'loan_details' | 'admin' | 'planos'>('dashboard'); const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
    const [currentDate, setCurrentDate] = useState(new Date());

    const openFullTransactionModal = () => {
        setTransactionToEdit(null);
        setTransactionModalDefaultType(null);
        setTransactionModalAllowedTypes(null);
        setIsModalOpen(true);
    };

    const openScopedTransactionModal = (viewType: 'receita' | 'despesa' | 'investimento') => {
        setTransactionToEdit(null);

        if (viewType === 'receita') {
            setTransactionModalDefaultType('receita');
            setTransactionModalAllowedTypes(['receita']);
        } else if (viewType === 'despesa') {
            setTransactionModalDefaultType('despesa');
            setTransactionModalAllowedTypes(['despesa', 'parcelado']);
        } else {
            setTransactionModalDefaultType('investimento');
            setTransactionModalAllowedTypes(['investimento']);
        }

        setIsModalOpen(true);
    };

    const openEditTransactionModal = (transaction: Transaction) => {
        if (isCreditCardInvoiceCompatibleTransaction(transaction)) {
            showNotification('Faturas de cartão devem ser alteradas pela tela de cartão/fatura.');
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
    const createTxMutation = useCreateTransaction(workspaceId);
    const createTxBatchMutation = useCreateTransactionsBatch(workspaceId);
    const updateTxMutation = useUpdateTransaction(workspaceId);
    const deleteTxMutation = useDeleteTransaction(workspaceId);
    const createCreditCardPurchaseMutation = useCreateCreditCardPurchaseDomain();
    const transactions = useMemo(() => transactionsData || [], [transactionsData]);

    const {
        data: creditCardInvoiceTransactionProjectionsData,
    } = useCreditCardInvoiceTransactionProjections(workspaceId);

    const creditCardInvoiceTransactionProjections = useMemo(
        () => creditCardInvoiceTransactionProjectionsData || [],
        [creditCardInvoiceTransactionProjectionsData],
    );

    // 2. Cartões de Crédito (MIGRADO)
    const { data: creditCardsData } = useCreditCards();
    const creditCards = useMemo(() => creditCardsData || [], [creditCardsData]);

    // Estados locais (ainda não migrados)
    // --- GOALS (MIGRADO) ---
    const { data: goalsData } = useGoals();
    const createGoalMutation = useCreateGoal();
    const updateGoalMutation = useUpdateGoal();
    const deleteGoalMutation = useDeleteGoal();
    const goals = useMemo(() => goalsData || [], [goalsData]);
    const [productsServices, setProductsServices] = useState<EntityItem[]>(initialProductsServices);
    const [expenseTypes, setExpenseTypes] = useState<EntityItem[]>(initialExpenseTypes);
    const [categories, setCategories] = useState<EntityItem[]>(initialCategoriesSettings);
    const [paymentTypes, setPaymentTypes] = useState<EntityItem[]>(initialPaymentTypes);
    const [incomeTypes, setIncomeTypes] = useState<EntityItem[]>(initialIncomeTypes);
    const [allWallets, setAllWallets] = useState<EntityItem[]>(initialWallets.map(w => ({ ...w, profileId: 'personal' })));
    const [costCenters, setCostCenters] = useState<EntityItem[]>([]);

    const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
    const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
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

    const wallets = useMemo(() => allWallets.filter(w => (w.profileId || 'personal') === activeWorkspace.id), [allWallets, activeWorkspace.id]);

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
    const handleAddTransaction = async (newTransaction: Omit<Transaction, 'id'>) => {
        if (!user) return;

        try {
            await createTxMutation.mutateAsync({
                ...newTransaction,
                userId: user.uid,
                workspaceId,
                profileId: workspaceId
            });

            showNotification('Transação salva!');
            playSound('success');
        } catch (error) {
            console.error("Erro ao salvar transação:", error);
            showNotification('Erro ao salvar.');
        }
    };

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

    const handleAddCreditCardPurchase = async (purchase: CreditCardPurchaseModalInput): Promise<void> => {
        if (!user) return;

        try {
            const result = await createCreditCardPurchaseMutation.mutateAsync(purchase);

            showNotification(`${result.installmentIds.length} parcela(s) geradas na fatura!`);
            playSound('success');
        } catch (error) {
            const firebaseError = error as {
                message?: string;
                code?: string;
                details?: unknown;
            };

            const issues = (
                firebaseError.details as { issues?: Array<{ path?: unknown[]; message?: string; code?: string }> } | undefined
            )?.issues ?? [];

            console.error('Erro ao criar compra no cartão:', {
                message: firebaseError.message,
                code: firebaseError.code,
                details: firebaseError.details,
                issues,
                purchase,
            });

            console.table(
                issues.map((issue) => ({
                    path: issue.path?.join('.') ?? '',
                    message: issue.message ?? '',
                    code: issue.code ?? '',
                })),
            );

            const failedPreconditionDetails = firebaseError.details as
                | { invoiceId?: string; status?: string }
                | undefined;

            if (
                firebaseError.code === 'functions/failed-precondition' &&
                failedPreconditionDetails?.status &&
                failedPreconditionDetails.status !== 'open'
            ) {
                showNotification(
                    'A data escolhida pertence a uma fatura que não está aberta. Use uma data de fatura aberta ou registre um ajuste.'
                );
                return;
            }

            showNotification('Erro ao criar compra no cartão.');
        }
    };


    const handleUpdateTransaction = async (updated: Transaction) => {
        if (isCreditCardInvoiceCompatibleTransaction(updated)) {
            showNotification('Fatura de cartão não pode ser atualizada como transação comum.');
            return;
        }

        try {
            await updateTxMutation.mutateAsync({
                ...updated,
                workspaceId,
                profileId: updated.profileId ?? workspaceId
            });

            showNotification('Atualizado!');
            playSound('success');
        } catch (error) {
            console.error(error);
            showNotification('Erro ao atualizar.');
        }
    };

    const confirmDeleteTransaction = (t: Transaction) => {
        if (isCreditCardInvoiceCompatibleTransaction(t)) {
            showNotification('Fatura de cartão não pode ser excluída como transação comum.');
            return;
        }

        setTransactionToDelete(t);
        setIsConfirmationOpen(true);
    };

    const handleDeleteTransaction = async () => {
        if (!transactionToDelete) return;

        if (isCreditCardInvoiceCompatibleTransaction(transactionToDelete)) {
            showNotification('Fatura de cartão não pode ser excluída como transação comum.');
            setTransactionToDelete(null);
            setIsConfirmationOpen(false);
            return;
        }

        try {
            await deleteTxMutation.mutateAsync(transactionToDelete.id);
            setTransactionToDelete(null);
            setIsConfirmationOpen(false);
            showNotification('Excluído!');
            playSound('success');
        } catch (error) {
            console.error(error);
            showNotification('Erro ao excluir.');
        }
    };

    const handleSettingsUpdate = (key: string, newData: EntityItem[]) => {
        if (key === 'wallets') {
            const other = allWallets.filter(w => (w.profileId || 'personal') !== activeWorkspace.id);
            setAllWallets([...other, ...newData.map(w => ({ ...w, profileId: activeWorkspace.id }))]);
        } else if (key === 'costCenters') {
            setCostCenters(newData);
        } else {
            switch (key) {
                case 'productsServices': setProductsServices(newData); break;
                case 'expenseTypes': setExpenseTypes(newData); break;
                case 'categories': setCategories(newData); break;
                case 'paymentTypes': setPaymentTypes(newData); break;
                case 'incomeTypes': setIncomeTypes(newData); break;
            }
        }
        showNotification('Configurações salvas!');
        playSound('success');
    };

    const handleSaveGoal = async (goal: Goal) => {
        try {
            if (goalToEdit) {
                // Modo Edição: ID já existe
                await updateGoalMutation.mutateAsync({
                    id: goal.id, // O ID agora é string
                    data: goal
                });
            } else {
                // Modo Criação: Remove ID temporário se houver
                const { id, ...newGoal } = goal;
                await createGoalMutation.mutateAsync(newGoal);
            }
            showNotification('Meta salva com sucesso!');
            playSound('success');
            setIsGoalModalOpen(false); // Fecha o modal
        } catch (e) {
            console.error(e);
            showNotification('Erro ao salvar meta.');
        }
    };

    const handleDeleteGoal = async (id: string) => {
        if (confirm('Tem certeza que deseja excluir esta meta?')) {
            try {
                await deleteGoalMutation.mutateAsync(id);
                showNotification('Meta removida!');
                playSound('success');
                // Se estiver na tela de detalhes, volta para lista
                if (view === 'goal_details') setView('goals');
            } catch (e) {
                console.error(e);
                showNotification('Erro ao excluir meta.');
            }
        }
    };

    const compatibleExpenseTransactions = useMemo(() => {
        const compatibleLegacyTransactions = filterTransactionsForCreditCardCompatibility(
            transactions,
            {
                hideLegacyCardInstallments: true,
                hideCreditCardInvoicePaymentCashTransactions: true,
            },
        );

        return [
            ...compatibleLegacyTransactions,
            ...creditCardInvoiceTransactionProjections,
        ].sort((left, right) => right.date.localeCompare(left.date));
    }, [transactions, creditCardInvoiceTransactionProjections]);

    const effectiveCashFlowTransactions = useMemo(
        () =>
            filterReversedCreditCardInvoicePaymentCashTransactions(
                transactions.filter(
                    (transaction) => !isCreditCardInvoiceCompatibleTransaction(transaction),
                ),
            ),
        [transactions],
    );

    const currentMonthTransactions = useMemo(
        () => transactions.filter((transaction) => isSameMonthYear(transaction.date, currentDate)),
        [transactions, currentDate]
    );

    const currentMonthCashFlowTransactions = useMemo(
        () =>
            effectiveCashFlowTransactions.filter((transaction) =>
                isSameMonthYear(transaction.date, currentDate),
            ),
        [effectiveCashFlowTransactions, currentDate],
    );

    const currentMonthCompatibleExpenseTransactions = useMemo(
        () =>
            compatibleExpenseTransactions.filter((transaction) =>
                isSameMonthYear(transaction.date, currentDate),
            ),
        [compatibleExpenseTransactions, currentDate],
    );

    const summaryData: SummaryData = useMemo(() => {
        const inc = currentMonthCashFlowTransactions.filter(t => t.type === 'receita').reduce((a, t) => a + t.value, 0);
        const exp = currentMonthCashFlowTransactions.filter(t => t.type === 'despesa' || t.type === 'parcelado').reduce((a, t) => a + t.value, 0);
        const inv = currentMonthCashFlowTransactions.filter(t => t.type === 'investimento').reduce((a, t) => a + t.value, 0);

        return { balance: inc - exp - inv, income: inc, expenses: exp, investments: inv };
    }, [currentMonthCashFlowTransactions]);

    if (isLoading) return <div className="flex h-screen items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;

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
                            <SummaryCard title="Investimentos" value={summaryData.investments} trend="Mensal" icon={<ChartBarIcon />} color="indigo" isClickable onClick={() => handleNavigate('investimento')} />
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

                {view === 'reports' && <ReportsView transactions={transactions} goals={goals} creditCards={creditCards} categories={categories} />}
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
                        onLink={() => { }}
                        onDelete={handleDeleteGoal}
                        onAddInvestment={() => setIsModalOpen(true)}
                    />
                )}
                {(view === 'receita' || view === 'despesa' || view === 'investimento') && <TransactionsView
                    viewType={view}
                    transactions={
                        view === 'despesa'
                            ? currentMonthCompatibleExpenseTransactions.filter(
                                t => t.type === 'despesa' || t.type === 'parcelado',
                            )
                            : currentMonthTransactions.filter(t => t.type === view)
                    }
                    onBack={() => setView('dashboard')}
                    onAddTransaction={() => openScopedTransactionModal(view)}
                    onEditTransaction={openEditTransactionModal}
                    onDeleteTransaction={confirmDeleteTransaction}
                    goals={goals}
                />}
                {view === 'settings' && <SettingsView data={{ productsServices, expenseTypes, categories, paymentTypes, incomeTypes, wallets, costCenters }} onUpdate={handleSettingsUpdate} />}

                {view === 'cards' && <CreditCardsView transactions={transactions} />}

                {view === 'personalizacao' && <PersonalizationView onBack={() => setView('settings')} />}
                {view === 'shared_expenses' && <SplitGroupsView onSelectGroup={id => { setSelectedGroupId(id); setView('split_group_details'); }} onCreateGroup={() => { }} />}
                {view === 'split_group_details' && selectedGroupId && <SplitGroupDetailsView groupId={selectedGroupId} onBack={() => setView('shared_expenses')} onAddTransaction={handleAddTransaction} onAddTransactions={handleAddTransactions} creditCards={creditCards} />}
                {view === 'recurring' && <RecurringExpensesView onSelectExpense={id => { setSelectedRecurringExpenseId(id); setView('recurring_details'); }} creditCards={creditCards} categories={categories} onAddTransaction={handleAddTransaction} />}
                {view === 'recurring_details' && selectedRecurringExpenseId && <RecurringExpenseDetailsView expenseId={selectedRecurringExpenseId} onBack={() => setView('recurring')} onAddTransaction={handleAddTransaction} />}
                {view === 'clients_receivables' && activeWorkspace.type === 'PJ' && <ClientsReceivablesView />}

                {view === 'loans' && activeWorkspace.type === 'PJ' && (
                    <PJLoansView
                        onSelectLoan={(l) => { setSelectedLoanId(l.id); setView('loan_details'); }}
                        onAddTransaction={handleAddTransaction}
                    />
                )}
                {view === 'loan_details' && selectedLoanId && activeWorkspace.type === 'PJ' && (
                    <PJLoanDetailsView
                        loanId={selectedLoanId}
                        onBack={() => setView('loans')}
                        onAddTransaction={handleAddTransaction}
                    />
                )}

                {view === 'loans' && activeWorkspace.type === 'PF' && <LoansView onSelectLoan={(l) => { setSelectedLoanId(l.id); setView('loan_details'); }} onAddTransaction={handleAddTransaction} />}
                {view === 'loan_details' && selectedLoanId && activeWorkspace.type === 'PF' && <LoanDetailsView loanId={selectedLoanId} onBack={() => setView('loans')} onAddTransaction={handleAddTransaction} />}
                {view === 'admin' && user?.isAdmin && <AdminDashboard />}
                {view === 'planos' && <PricingTable />}

            </main>

            <TransactionModal
                isOpen={isModalOpen}
                onClose={closeTransactionModal}
                onAddTransaction={handleAddTransaction}
                onAddTransactions={handleAddTransactions}
                onAddCreditCardPurchase={handleAddCreditCardPurchase}
                onUpdateTransaction={handleUpdateTransaction}
                transactionToEdit={transactionToEdit}
                defaultType={transactionModalDefaultType}
                allowedTypes={transactionModalAllowedTypes}
                currentDate={currentDate}
                creditCards={creditCards}
                productsServices={productsServices}
                settingsCategories={categories}
                wallets={wallets}
                expenseTypes={expenseTypes}
                paymentTypes={paymentTypes}
                incomeTypes={incomeTypes}
                goals={goals}
            />
            <ConfirmationModal isOpen={isConfirmationOpen} onClose={() => setIsConfirmationOpen(false)} onConfirm={handleDeleteTransaction} title="Excluir" message="Excluir permanentemente?" />
            <GoalFormModal isOpen={isGoalModalOpen} onClose={() => setIsGoalModalOpen(false)} onSave={handleSaveGoal} goalToEdit={goalToEdit} wallets={wallets} transactions={transactions} />
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
                    <BillingSuccessModal />
                    <AuthGuard>
                        <AppContent />
                    </AuthGuard>
                </WorkspaceProvider>
            </ThemeProvider>
        </AuthProvider>
    </QueryClientProvider>
);

export default App;