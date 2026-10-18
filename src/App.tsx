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
import {
    useGoals,
    useInvestmentGoalOptions,
    useCreateGoal,
    useUpdateGoal,
    useUpdateGoalManualProgress,
    useSetGoalStatus,
    useArchiveGoal,
} from "./modules/goals/hooks";
import { goalErrorView, type GoalSubmission } from "./modules/goals/model";
import { AdminDashboard } from './components/AdminDashboard';
import { PricingTable } from './modules/billing/components/PricingTable';
import { BillingSuccessModal } from './modules/billing/components/BillingSuccessModal';
import { BillingProvider } from './modules/billing/BillingContext';

// Paleta de cores dos gráficos de categoria (apresentação). Os cadastros
// do workspace vêm só do catálogo autoritativo (D-23), lido pelos módulos.
import { REPORT_CATEGORY_PALETTE } from "./constants";

import type {
    Transaction,
    TransactionFormType,
    Goal,
    GoalStatus,
} from "./types";

import { WalletIcon, ArrowUpIcon, ArrowDownIcon, ChartBarIcon } from "./components/Icons";
import { isSameMonthYear } from "./utils/date";
import { useFinancialReport, useFinancialReportLiveRefresh } from "./modules/reports/hooks";
import { toDashboardSummary, type DashboardFigure } from "./modules/reports/adapter";
import { centsToDisplay } from "./modules/reports/format";
import { monthRange } from "./modules/reports/range";
import { REPORT_LOAD_ERROR_MESSAGE } from "./modules/reports/official";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
} from "./modules/investments/semantics";
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

/** Blocos do relatório que o Dashboard usa (mês do seletor do Header). */
const DASHBOARD_REPORT_SECTIONS = ['accounts', 'cash', 'investments', 'kpis'] as const;

/** Número do card, ou "—" com o estado do relatório no lugar da legenda. */
const summaryFigure = (figure: DashboardFigure, trend: string) => figure.cents === null
    ? { value: 0, displayValue: '—', trend: figure.message ?? trend }
    : { value: centsToDisplay(figure.cents), trend };

const AppContent: React.FC = () => {
    const { theme, toggleMode, playSound } = useTheme();
    const { activeWorkspace, isLoading, loadError, activeWorkspaceRole } = useWorkspace();
    const workspaceId = activeWorkspace?.id ?? "";
    const { user, logout } = useAuth();

    // Estados de UI
    const [isSidebarExpanded, setIsSidebarExpanded] = useState<boolean>(false);
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [transactionModalDefaultType, setTransactionModalDefaultType] = useState<TransactionFormType | null>(null);
    const [transactionModalAllowedTypes, setTransactionModalAllowedTypes] = useState<TransactionFormType[] | null>(null);
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
    const { data: transactionsData, invalidCount: invalidTransactionsCount } = useTransactions(workspaceId);
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

    // --- GOALS (P5-B) ---
    // A lista paginada só carrega nas telas de metas; os seletores de aporte e
    // vínculo (e o cache do relatório) usam só metas de investimento.
    const { data: goalsListData } = useGoals({ enabled: view === 'goals' || view === 'goal_details' });
    const goalsList = useMemo(() => goalsListData || [], [goalsListData]);
    // P5-B.1 — metas de investimento por página (sem teto fixo); as telas de
    // aporte pedem as próximas por `investmentGoalPaging.loadMore`.
    const { goals, paging: investmentGoalPaging } = useInvestmentGoalOptions();
    const createGoalMutation = useCreateGoal();
    const updateGoalMutation = useUpdateGoal();
    const updateGoalManualProgressMutation = useUpdateGoalManualProgress();
    const setGoalStatusMutation = useSetGoalStatus();
    const archiveGoalMutation = useArchiveGoal();
    // Intenção por operação: o mesmo conteúdo reenviado depois de falha reusa a chave.
    const goalIntentRef = useRef<Record<string, IntentKey | null>>({});

    const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);
    // Anulação autoritativa (P3-E, D-35): confirmação com justificativa.
    const [transactionToVoid, setTransactionToVoid] = useState<Transaction | null>(null);
    const [voidReason, setVoidReason] = useState('');
    const [voidError, setVoidError] = useState<string | null>(null);
    const voidIntentRef = useRef<IntentKey | null>(null);
    const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);

    useEffect(() => {
        if (selectedGoal) {
            const fresh = goalsList.find(g => g.id === selectedGoal.id);
            if (fresh && fresh !== selectedGoal) setSelectedGoal(fresh);
        }
    }, [goalsList, selectedGoal]);

    const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);

    const [goalToEdit, setGoalToEdit] = useState<Goal | null>(null);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [selectedRecurringExpenseId, setSelectedRecurringExpenseId] = useState<string | null>(null);
    const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);

    // Relatório oficial do mês escolhido no Header: cards e gráfico do Dashboard.
    const dashboardRange = useMemo(() => monthRange(currentDate), [currentDate]);
    const dashboardReport = useFinancialReport(
        dashboardRange, DASHBOARD_REPORT_SECTIONS, { enabled: view === 'dashboard' },
    );
    const dashboard = useMemo(
        () => toDashboardSummary(
            dashboardReport.data,
            dashboardReport.isError
                ? dashboardReport.error?.message || REPORT_LOAD_ERROR_MESSAGE
                : undefined,
        ),
        [dashboardReport.data, dashboardReport.isError, dashboardReport.error],
    );
    // O caixa é projetado por gatilho assíncrono: relê o relatório quando o
    // documento do mês corrente ou do mês escolhido muda.
    useFinancialReportLiveRefresh(
        workspaceId,
        dashboardRange.kind === 'month' ? dashboardRange.month : undefined,
    );

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

    /** Chave de idempotência por intenção; `done` zera a intenção depois do sucesso. */
    const goalIntent = (operation: string, payload: Record<string, unknown>) => {
        const intent = resolveIntentKey(
            goalIntentRef.current[operation] ?? null, operation, payload, newIdempotencyKey,
        );
        goalIntentRef.current[operation] = intent;
        return { key: intent.key, done: () => { goalIntentRef.current[operation] = null; } };
    };

    const handleSaveGoal = async (
        submission: GoalSubmission,
        idempotencyKey: string,
    ): Promise<void> => {
        try {
            if (submission.kind === 'update') {
                await updateGoalMutation.mutateAsync({
                    input: {
                        goalId: submission.goalId,
                        expectedRevision: submission.expectedRevision,
                        goal: submission.goal,
                        manualProgressCents: submission.manualProgressCents,
                    },
                    idempotencyKey,
                });
            } else {
                await createGoalMutation.mutateAsync({
                    input: {
                        goal: submission.goal,
                        status: submission.status,
                        manualProgressCents: submission.manualProgressCents,
                    },
                    idempotencyKey,
                });
            }
            showNotification('Meta salva com sucesso!');
            playSound('success');
        } catch (e) {
            console.error(e);
            showNotification('Erro ao salvar meta.');
            throw e;
        }
    };

    /** Muda o status pelo backend (sem atualização otimista); devolve o erro em pt-BR ou `null`. */
    const handleGoalStatus = async (goal: Goal, status: GoalStatus): Promise<string | null> => {
        const intent = goalIntent('setGoalStatus', { goalId: goal.id, status });
        try {
            await setGoalStatusMutation.mutateAsync({
                input: { goalId: goal.id, status },
                idempotencyKey: intent.key,
            });
            intent.done();
            showNotification('Status da meta atualizado.');
            playSound('success');
            return null;
        } catch (e) {
            console.error(e);
            const message = goalErrorView(e).message;
            showNotification('Erro ao atualizar o status da meta.');
            return message;
        }
    };

    /** Atualiza o valor acumulado de meta manual; devolve o erro em pt-BR ou `null`. */
    const handleGoalManualProgress = async (goal: Goal, manualProgressCents: number): Promise<string | null> => {
        const intent = goalIntent('updateGoalManualProgress', {
            goalId: goal.id, expectedRevision: goal.revision, manualProgressCents,
        });
        try {
            await updateGoalManualProgressMutation.mutateAsync({
                input: { goalId: goal.id, expectedRevision: goal.revision, manualProgressCents },
                idempotencyKey: intent.key,
            });
            intent.done();
            showNotification('Valor acumulado atualizado.');
            playSound('success');
            return null;
        } catch (e) {
            console.error(e);
            return goalErrorView(e).message;
        }
    };

    /** Arquiva a meta; devolve a mensagem do backend (ex.: investimentos vinculados) ou `null`. */
    const handleDeleteGoal = async (id: string): Promise<string | null> => {
        if (!confirm('Tem certeza que deseja arquivar esta meta? O histórico de aportes será preservado.')) {
            return null;
        }
        const intent = goalIntent('archiveGoal', { goalId: id });
        try {
            await archiveGoalMutation.mutateAsync({
                input: { goalId: id, reason: 'Arquivada pelo usuário' },
                idempotencyKey: intent.key,
            });
            intent.done();
            showNotification('Meta arquivada com sucesso!');
            playSound('success');
            // Se estiver na tela de detalhes, volta para lista
            if (view === 'goal_details') setView('goals');
            return null;
        } catch (e) {
            console.error(e);
            showNotification('Erro ao arquivar meta.');
            return goalErrorView(e).message;
        }
    };

    const currentMonthTransactions = useMemo(
        () => transactions.filter((transaction) => isSameMonthYear(transaction.date, currentDate)),
        [transactions, currentDate]
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
                <Header onToggleSidebar={() => setIsSidebarExpanded(!isSidebarExpanded)} isSidebarExpanded={isSidebarExpanded} onToggleDarkMode={toggleMode} isDarkMode={theme.mode === 'dark'} currentDate={currentDate} onCurrentDateChange={setCurrentDate} onNavigate={handleNavigate} />

                {view === 'dashboard' && (
                    <div className="flex flex-col gap-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                            <SummaryCard title="Saldo Atual" {...summaryFigure(dashboard.balance, 'Em contas')} icon={<WalletIcon />} color={activeWorkspace.type === 'PJ' ? 'purple' : 'blue'} />
                            <SummaryCard title="Receitas" {...summaryFigure(dashboard.income, 'Mensal')} icon={<ArrowUpIcon />} color="green" isClickable onClick={() => handleNavigate('receita')} />
                            <SummaryCard title="Despesas" {...summaryFigure(dashboard.expenses, 'Mensal')} icon={<ArrowDownIcon />} color="red" isClickable onClick={() => handleNavigate('despesa')} />
                            <SummaryCard title="Investimentos" {...summaryFigure(dashboard.investments, 'Mensal')} icon={<ChartBarIcon />} color="indigo" isClickable onClick={() => handleNavigate('investimento')} />
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="flex flex-col gap-6">
                                <TransactionsChart summary={dashboard} />
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <RecurringDashboardWidget />
                                    <ReportsWidget onNavigate={() => handleNavigate('reports')} />
                                </div>
                            </div>
                            <RecentTransactions transactions={transactions} onNewTransaction={openFullTransactionModal} />
                        </div>
                    </div>
                )}

                {view === 'reports' && <ReportsView categories={REPORT_CATEGORY_PALETTE} />}
                {view === 'goals' && (
                    <GoalsView
                        onSelectGoal={(g) => { setSelectedGoal(g); setView('goal_details'); }}
                        onOpenGoalModal={(g) => { setGoalToEdit(g || null); setIsGoalModalOpen(true); }}
                    />
                )}
                {view === 'goal_details' && selectedGoal && (
                    <GoalDetailsView
                        goal={selectedGoal}
                        onBack={() => setView('goals')}
                        onEdit={g => { setGoalToEdit(g); setIsGoalModalOpen(true); }}
                        onDelete={handleDeleteGoal}
                        onUpdateStatus={handleGoalStatus}
                        onUpdateManualProgress={handleGoalManualProgress}
                    />
                )}
                {view === 'investimento' && (
                    <React.Suspense fallback={<div className="p-6 text-sm text-gray-600">Carregando investimentos...</div>}>
                        <SimpleInvestmentsView
                            workspaceId={workspaceId}
                            profileType={activeWorkspace.type}
                            goals={goals}
                            goalPaging={investmentGoalPaging}
                            role={activeWorkspaceRole}
                            onBack={() => setView('dashboard')}
                        />
                    </React.Suspense>
                )}
                {(view === 'receita' || view === 'despesa') && <TransactionsView
                    viewType={view}
                    invalidCount={invalidTransactionsCount}
                    transactions={
                        view === 'despesa'
                            ? currentMonthTransactions.filter(t => t.type === 'despesa')
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
                goalPaging={investmentGoalPaging}
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
