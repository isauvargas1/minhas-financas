import React, { useState, useEffect, useMemo, useCallback } from "react";

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

import {
  initialTransactions,
  initialProductsServices,
  initialExpenseTypes,
  initialCategoriesSettings,
  initialPaymentTypes,
  initialIncomeTypes,
  initialWallets,
  initialCreditCards,
  initialGoals,
} from "./constants";

import type {
  Transaction,
  TransactionType,
  SummaryData,
  EntityItem,
  CreditCard,
  Goal,
} from "./types";

// ✅ Corrige o erro do "Loan" mesmo se o re-export do types der problema:
import type { Loan } from "./modules/loans/types";

import { WalletIcon, ArrowUpIcon, ArrowDownIcon, ChartBarIcon } from "./components/Icons";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCreateNotification } from "./modules/notifications/hooks";

import { AuthProvider, useAuth } from "./contexts/AuthContext";

import {
  useTransactions,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
} from "./modules/transactions/hooks";

import { LoginView } from "./components/auth/LoginView";



const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5,
            refetchOnWindowFocus: false,
        },
    },
});

const AppContent: React.FC = () => {
    // Hooks de Contexto
    const { theme, toggleMode, playSound } = useTheme();
    const { activeWorkspace, isLoading } = useWorkspace();
    const workspaceId = activeWorkspace?.id ?? "";

    
    // Hooks de Estado
    const [isSidebarExpanded, setIsSidebarExpanded] = useState<boolean>(false);
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    
    // --- LÓGICA CONECTADA AO FIRESTORE ---
    const { user } = useAuth();
    
const { data: transactionsData, isLoading: isTransactionsLoading } = useTransactions(workspaceId);

const createTxMutation = useCreateTransaction(workspaceId);
const updateTxMutation = useUpdateTransaction(workspaceId);
const deleteTxMutation = useDeleteTransaction(workspaceId);


    // 3. Define a lista de transações (vinda do banco)
    const transactions = useMemo(() => transactionsData || [], [transactionsData]);

    // Outros estados locais (Goals, Cards, Settings) ainda mockados por enquanto
    const [allGoals, setAllGoals] = useState<Goal[]>(initialGoals.map(g => ({ ...g, profileId: 'personal' })));
    const [allCreditCards, setAllCreditCards] = useState<CreditCard[]>(initialCreditCards.map(c => ({ ...c, profileId: 'personal' })));
    
    const [productsServices, setProductsServices] = useState<EntityItem[]>(initialProductsServices);
    const [expenseTypes, setExpenseTypes] = useState<EntityItem[]>(initialExpenseTypes);
    const [categories, setCategories] = useState<EntityItem[]>(initialCategoriesSettings);
    const [paymentTypes, setPaymentTypes] = useState<EntityItem[]>(initialPaymentTypes);
    const [incomeTypes, setIncomeTypes] = useState<EntityItem[]>(initialIncomeTypes);
    const [allWallets, setAllWallets] = useState<EntityItem[]>(initialWallets.map(w => ({ ...w, profileId: 'personal' })));
    const [costCenters, setCostCenters] = useState<EntityItem[]>([]);

    const [notification, setNotification] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
    const [view, setView] = useState<'dashboard' | 'receita' | 'despesa' | 'investimento' | 'settings' | 'cards' | 'personalizacao' | 'goals' | 'goal_details' | 'shared_expenses' | 'split_group_details' | 'recurring' | 'recurring_details' | 'reports' | 'clients_receivables' | 'loans' | 'loan_details'>('dashboard');
    const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
    const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
    const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
    const [currentDate, setCurrentDate] = useState(new Date());

    const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
    const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
    const [goalToEdit, setGoalToEdit] = useState<Goal | null>(null);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [selectedRecurringExpenseId, setSelectedRecurringExpenseId] = useState<string | null>(null);
    const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);

    const createNotification = useCreateNotification();

    // Filtros de memória para itens que ainda são locais
    const goals = useMemo(() => allGoals.filter(g => (g.profileId || 'personal') === activeWorkspace.id), [allGoals, activeWorkspace.id]);
    const creditCards = useMemo(() => allCreditCards.filter(c => (c.profileId || 'personal') === activeWorkspace.id), [allCreditCards, activeWorkspace.id]);
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

    // --- HANDLERS CONECTADOS AO FIRESTORE ---

    const handleAddTransaction = async (newTransaction: Omit<Transaction, 'id'>) => {
        if (!user) return;
        try {
           await createTxMutation.mutateAsync({
  ...newTransaction,
  userId: user.uid,
  profileId: workspaceId
});
            
            // Lógica local para atualizar Metas visualmente (Investimentos)
            if (newTransaction.type === 'investimento' && newTransaction.goalId) {
                setAllGoals(allGoals.map(g => g.id === newTransaction.goalId ? { ...g, currentAmount: g.currentAmount + newTransaction.value } : g));
            }
            
            showNotification('Transação salva!');
            playSound('success');
        } catch (error) {
            console.error(error);
            showNotification('Erro ao salvar.');
        }
    };

    const handleAddTransactions = async (newTransactions: Omit<Transaction, 'id'>[]) => {
        if (!user) return;
        try {
            // Salva em paralelo (Batch logic simplificada)
            await Promise.all(newTransactions.map(t => 
  createTxMutation.mutateAsync({
    ...t,
    userId: user.uid,
    profileId: workspaceId
  })
));

            showNotification(`${newTransactions.length} geradas!`);
            playSound('success');
        } catch (error) {
            console.error(error);
            showNotification('Erro na geração em massa.');
        }
    };

    const handleUpdateTransaction = async (updated: Transaction) => {
        try {
            await updateTxMutation.mutateAsync(updated);
            showNotification('Atualizado!');
            playSound('success');
        } catch (error) {
            console.error(error);
            showNotification('Erro ao atualizar.');
        }
    };

    const confirmDeleteTransaction = (t: Transaction) => { setTransactionToDelete(t); setIsConfirmationOpen(true); };

    const handleDeleteTransaction = async () => {
        if (transactionToDelete) {
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
        }
    };

    // --- FIM DOS HANDLERS FIRESTORE ---

    const handleSettingsUpdate = (key: string, newData: EntityItem[]) => {
        if (key === 'wallets') {
            const other = allWallets.filter(w => (w.profileId || 'personal') !== activeWorkspace.id);
            setAllWallets([...other, ...newData.map(w => ({ ...w, profileId: activeWorkspace.id }))]);
        } else if (key === 'costCenters') {
            setCostCenters(newData);
        } else {
            switch(key) {
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

    const handleSaveGoal = (goal: Goal) => {
        const gWithProfile = { ...goal, profileId: activeWorkspace.id };
        if (allGoals.some(g => g.id === goal.id)) setAllGoals(allGoals.map(g => g.id === goal.id ? gWithProfile : g));
        else setAllGoals([...allGoals, gWithProfile]);
        showNotification('Meta salva!');
        playSound('success');
    };

    const handleDeleteGoal = (id: number) => {
        setAllGoals(allGoals.filter(g => g.id !== id));
        showNotification('Meta removida!');
    };

    const currentMonthTransactions = useMemo(() => transactions.filter(t => {
        const d = new Date(t.date);
        const adj = new Date(d.getTime() + d.getTimezoneOffset() * 60000);
        return adj.getMonth() === currentDate.getMonth() && adj.getFullYear() === currentDate.getFullYear();
    }), [transactions, currentDate]);

    const summaryData: SummaryData = useMemo(() => {
        const inc = currentMonthTransactions.filter(t => t.type === 'receita').reduce((a, t) => a + t.value, 0);
        const exp = currentMonthTransactions.filter(t => t.type === 'despesa' || t.type === 'parcelado').reduce((a, t) => a + t.value, 0);
        const inv = currentMonthTransactions.filter(t => t.type === 'investimento').reduce((a, t) => a + t.value, 0);
        return { balance: inc - exp - inv, income: inc, expenses: exp, investments: inv };
    }, [currentMonthTransactions]);

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
                                <TransactionsChart transactions={currentMonthTransactions} />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <RecurringDashboardWidget />
                                    <ReportsWidget transactions={transactions} goals={goals} creditCards={creditCards} onNavigate={() => handleNavigate('reports')} />
                                </div>
                            </div>
                            <RecentTransactions transactions={transactions} onNewTransaction={() => setIsModalOpen(true)} />
                        </div>
                    </div>
                )}

                {view === 'reports' && <ReportsView transactions={transactions} goals={goals} creditCards={creditCards} categories={categories} />}
                {view === 'goals' && <GoalsView goals={goals} transactions={transactions} onDeleteGoal={handleDeleteGoal} onSelectGoal={g => { setSelectedGoal(g); setView('goal_details'); }} onOpenGoalModal={g => { setGoalToEdit(g || null); setIsGoalModalOpen(true); }} />}
                {view === 'goal_details' && selectedGoal && <GoalDetailsView goal={selectedGoal} transactions={transactions} onBack={() => setView('goals')} onEdit={g => { setGoalToEdit(g); setIsGoalModalOpen(true); }} onLink={() => {}} onDelete={handleDeleteGoal} onUpdateStatus={(g, s) => setAllGoals(allGoals.map(x => x.id === g.id ? { ...x, status: s } : x))} onAddInvestment={() => setIsModalOpen(true)} />}
                
                {(view === 'receita' || view === 'despesa' || view === 'investimento') && <TransactionsView viewType={view} transactions={currentMonthTransactions.filter(t => view === 'despesa' ? t.type === 'despesa' || t.type === 'parcelado' : t.type === view)} onBack={() => setView('dashboard')} onAddTransaction={() => setIsModalOpen(true)} onEditTransaction={t => { setTransactionToEdit(t); setIsModalOpen(true); }} onDeleteTransaction={confirmDeleteTransaction} goals={goals} />}
                {view === 'settings' && <SettingsView data={{ productsServices, expenseTypes, categories, paymentTypes, incomeTypes, wallets, costCenters }} onUpdate={handleSettingsUpdate} />}
                {view === 'cards' && <CreditCardsView cards={creditCards} transactions={transactions} onAddCard={c => setAllCreditCards([...allCreditCards, { ...c, profileId: activeWorkspace.id }])} onUpdateCard={c => setAllCreditCards(allCreditCards.map(x => x.id === c.id ? c : x))} onDeleteCard={id => setAllCreditCards(allCreditCards.filter(x => x.id !== id))} />}
                {view === 'personalizacao' && <PersonalizationView onBack={() => setView('settings')} />}
                {view === 'shared_expenses' && <SplitGroupsView onSelectGroup={id => { setSelectedGroupId(id); setView('split_group_details'); }} onCreateGroup={() => {}} />}
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

            </main>

            <TransactionModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onAddTransaction={handleAddTransaction} onAddTransactions={handleAddTransactions} onUpdateTransaction={handleUpdateTransaction} transactionToEdit={transactionToEdit} defaultType={null} currentDate={currentDate} creditCards={creditCards} productsServices={productsServices} settingsCategories={categories} wallets={wallets} expenseTypes={expenseTypes} paymentTypes={paymentTypes} incomeTypes={incomeTypes} goals={goals} />
            <ConfirmationModal isOpen={isConfirmationOpen} onClose={() => setIsConfirmationOpen(false)} onConfirm={handleDeleteTransaction} title="Excluir" message="Excluir permanentemente?" />
            <GoalFormModal isOpen={isGoalModalOpen} onClose={() => setIsGoalModalOpen(false)} onSave={handleSaveGoal} goalToEdit={goalToEdit} wallets={wallets} transactions={transactions} />
            <Notification message={notification.message} isVisible={notification.visible} />
        </div>
    );
};

// Componente de proteção de rota (Auth Guard)

const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    if (!user) {
        return <LoginView />;
    }

    return <>{children}</>;
};

// Componente App atualizado
const App: React.FC = () => (
    <QueryClientProvider client={queryClient}>
        <AuthProvider>
            <ThemeProvider>
                <WorkspaceProvider>
                    <AuthGuard>
                        <AppContent />
                    </AuthGuard>
                </WorkspaceProvider>
            </ThemeProvider>
        </AuthProvider>
    </QueryClientProvider>
);

export default App;