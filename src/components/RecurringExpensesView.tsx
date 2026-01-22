
import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useRecurringExpenses, useCreateRecurringExpense, useUpdateRecurringExpense } from '../modules/recurring-expenses/hooks.ts';
import { RecurringExpense } from '../modules/recurring-expenses/types.ts';
import { RepeatIcon, PlusIcon, SearchIcon, FilterIcon, LayoutGridIcon, ListIcon, CreditCardIcon, DynamicIcon, FileInvoiceIcon } from './Icons.tsx';
import { useTheme } from '../ThemeContext.tsx';
import RecurringExpenseCard from './RecurringExpenseCard.tsx';
import RecurringExpenseList from './RecurringExpenseList.tsx';
import RecurringExpenseFormModal from './RecurringExpenseFormModal.tsx';
import { CreditCard, EntityItem, Transaction } from '../types.ts';
import { useWorkspace } from '../WorkspaceContext.tsx';

interface RecurringExpensesViewProps {
    onSelectExpense: (id: string) => void;
    creditCards: CreditCard[];
    categories: EntityItem[];
    onAddTransaction: (transaction: Omit<Transaction, 'id'>) => void;
}

const containerVariants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.05
        }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
};

const RecurringExpensesView: React.FC<RecurringExpensesViewProps> = ({ onSelectExpense, creditCards, categories, onAddTransaction }) => {
    const { data: expenses, isLoading } = useRecurringExpenses();
    const createExpenseMutation = useCreateRecurringExpense();
    const updateExpenseMutation = useUpdateRecurringExpense();
    const { playSound } = useTheme();
    const MotionDiv = motion.div as any;
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';

    const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('ativo');
    const [filterType, setFilterType] = useState<string>('todos');

    // Modal State
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [expenseToEdit, setExpenseToEdit] = useState<RecurringExpense | null>(null);

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    // Calculate Summary
    const summary = useMemo(() => {
        if (!expenses) return { totalMonthly: 0, activeCount: 0, byMethod: {} };

        let totalMonthly = 0;
        let activeCount = 0;
        const byMethod: Record<string, number> = {};

        expenses.forEach(curr => {
            if (curr.status !== 'ativo') return;
            
            activeCount++;

            const val = curr.valorPadrao || 0;

            let monthlyValue = val;
            if (curr.periodo === 'semanal') monthlyValue *= 4;
            if (curr.periodo === 'quinzenal') monthlyValue *= 2;
            if (curr.periodo === 'anual') monthlyValue /= 12;
            if (curr.periodo === 'bimestral') monthlyValue /= 2;
            if (curr.periodo === 'trimestral') monthlyValue /= 3;
            if (curr.periodo === 'semestral') monthlyValue /= 6;
            
            totalMonthly += monthlyValue;

            const method = curr.metodoPagamento || 'outros';
            byMethod[method] = (byMethod[method] || 0) + monthlyValue;
        });

        return { totalMonthly, activeCount, byMethod };
    }, [expenses]);

    // Filter Logic
    const filteredExpenses = useMemo(() => {
        if (!expenses) return [];
        return expenses.filter(e => {
            const name = e.nome || '';
            const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesStatus = filterStatus === 'todos' || e.status === filterStatus;
            const matchesType = filterType === 'todos' || e.tipo === filterType;
            return matchesSearch && matchesStatus && matchesType;
        });
    }, [expenses, searchQuery, filterStatus, filterType]);

    const handleSaveExpense = (expense: RecurringExpense) => {
        if (expenseToEdit) {
            updateExpenseMutation.mutate({ id: expense.id, data: expense });
        } else {
            createExpenseMutation.mutate(expense);
        }
        playSound('success');
    };

    const openCreateModal = () => {
        setExpenseToEdit(null);
        setIsFormOpen(true);
        playSound('click');
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col animate-fade-in">
            {/* Header */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-on-surface flex items-center gap-2">
                        {isPJ ? (
                            <FileInvoiceIcon className="h-6 w-6 text-primary" />
                        ) : (
                            <RepeatIcon className="h-6 w-6 text-primary" />
                        )}
                        {isPJ ? 'Contratos & Recorrências' : 'Gastos Recorrentes'}
                    </h2>
                    <p className="text-sm text-muted">
                        {isPJ ? 'Gerencie contratos fixos e recorrências da empresa' : 'Gerencie suas assinaturas e contas fixas'}
                    </p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[180px]">
                        <input
                            type="text"
                            placeholder="Buscar..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 border border-border rounded-lg bg-surface text-sm focus:ring-2 focus:ring-primary outline-none text-on-surface"
                            aria-label="Buscar assinaturas"
                        />
                        <div className="absolute left-3 top-2.5 text-muted">
                            <SearchIcon className="h-4 w-4" />
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex items-center gap-2 bg-surface p-1 rounded-lg border border-border">
                        <div className="flex items-center px-2 text-muted">
                            <FilterIcon className="h-4 w-4" />
                        </div>
                        <select 
                            value={filterStatus} 
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="text-sm bg-transparent border-none text-on-surface focus:ring-0 cursor-pointer py-1.5"
                            aria-label="Filtrar por status"
                        >
                            <option value="ativo">Ativos</option>
                            <option value="pausado">Pausados</option>
                            <option value="cancelado">Cancelados</option>
                            <option value="todos">Todos Status</option>
                        </select>
                        <div className="w-px h-4 bg-border mx-1"></div>
                        <select 
                            value={filterType} 
                            onChange={(e) => setFilterType(e.target.value)}
                            className="text-sm bg-transparent border-none text-on-surface focus:ring-0 cursor-pointer py-1.5"
                            aria-label="Filtrar por tipo"
                        >
                            <option value="todos">Todos Tipos</option>
                            <option value="assinatura">Assinaturas</option>
                            <option value="contaFixa">Contas Fixas</option>
                            <option value="servico">Serviços</option>
                        </select>
                    </div>

                    {/* View Toggle */}
                    <div className="flex bg-surface rounded-lg p-1 border border-border">
                        <button 
                            onClick={() => setViewMode('card')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'card' ? 'bg-primary/10 text-primary' : 'text-muted hover:text-on-surface'}`}
                            aria-label="Visualização em grade"
                        >
                            <LayoutGridIcon className="h-5 w-5" />
                        </button>
                        <button 
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted hover:text-on-surface'}`}
                            aria-label="Visualização em lista"
                        >
                            <ListIcon className="h-5 w-5" />
                        </button>
                    </div>

                    <button 
                        className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-md transition-colors whitespace-nowrap"
                        onClick={openCreateModal}
                    >
                        <PlusIcon className="mr-2 h-4 w-4" />
                        Nova
                    </button>
                </div>
            </div>

            {/* Summary Panel */}
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
                <MotionDiv 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-primary rounded-card p-4 text-white shadow-md relative overflow-hidden"
                >
                    <div className="relative z-10">
                        <p className="text-white/80 text-sm font-medium mb-1">Custo Mensal Estimado</p>
                        <h3 className="text-2xl font-bold">{formatCurrency(summary.totalMonthly)}</h3>
                        <p className="text-xs text-white/70 mt-2">{summary.activeCount} {isPJ ? 'contratos' : 'serviços'} ativos</p>
                    </div>
                    {isPJ ? (
                        <FileInvoiceIcon className="absolute right-[-10px] bottom-[-10px] w-24 h-24 text-white opacity-10" />
                    ) : (
                        <RepeatIcon className="absolute right-[-10px] bottom-[-10px] w-24 h-24 text-white opacity-10" />
                    )}
                </MotionDiv>

                <MotionDiv 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-surface rounded-card p-4 shadow-sm border border-border flex items-center gap-4"
                >
                    <div className="p-3 rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-300">
                        <CreditCardIcon className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm text-muted font-medium">Cartão de Crédito</p>
                        <p className="text-lg font-bold text-on-surface">
                            {formatCurrency(summary.byMethod['cartaoCredito'] || 0)}
                        </p>
                    </div>
                </MotionDiv>

                <MotionDiv 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-surface rounded-card p-4 shadow-sm border border-border flex items-center gap-4"
                >
                    <div className="p-3 rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-900/20 dark:text-teal-300">
                        <DynamicIcon name="BrandPix" className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm text-muted font-medium">Pix / Débito</p>
                        <p className="text-lg font-bold text-on-surface">
                            {formatCurrency((summary.byMethod['pix'] || 0) + (summary.byMethod['debitoConta'] || 0))}
                        </p>
                    </div>
                </MotionDiv>

                <MotionDiv 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="bg-surface rounded-card p-4 shadow-sm border border-border flex items-center gap-4"
                >
                    <div className="p-3 rounded-lg bg-gray-50 text-gray-600 dark:bg-dark-200 dark:text-gray-300">
                        <DynamicIcon name="Barcode" className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm text-muted font-medium">Boleto / Outros</p>
                        <p className="text-lg font-bold text-on-surface">
                            {formatCurrency((summary.byMethod['boleto'] || 0) + (summary.byMethod['outros'] || 0))}
                        </p>
                    </div>
                </MotionDiv>
            </div>

            {/* List/Grid Content */}
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-6">
                {viewMode === 'card' ? (
                    <MotionDiv 
                        variants={containerVariants}
                        initial="hidden"
                        animate="show"
                        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
                    >
                        {filteredExpenses.map(expense => (
                            <motion.div key={expense.id} variants={itemVariants} layout>
                                <RecurringExpenseCard 
                                    expense={expense}
                                    onClick={() => onSelectExpense(expense.id)}
                                />
                            </motion.div>
                        ))}
                    </MotionDiv>
                ) : (
                    <MotionDiv 
                        variants={containerVariants}
                        initial="hidden"
                        animate="show"
                    >
                        <RecurringExpenseList 
                            expenses={filteredExpenses}
                            onSelect={onSelectExpense}
                        />
                    </MotionDiv>
                )}

                {filteredExpenses.length === 0 && (
                    <div className="text-center py-20 bg-background rounded-card border-2 border-dashed border-border">
                        <p className="text-muted">Nenhuma assinatura encontrada com os filtros atuais.</p>
                        <button className="mt-2 text-primary font-medium hover:underline" onClick={() => { setFilterStatus('todos'); setFilterType('todos'); setSearchQuery(''); }}>
                            Limpar filtros
                        </button>
                    </div>
                )}
            </div>

            <RecurringExpenseFormModal 
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                onSave={handleSaveExpense}
                expenseToEdit={expenseToEdit}
                creditCards={creditCards}
                categories={categories}
            />
        </div>
    );
};

export default RecurringExpensesView;
