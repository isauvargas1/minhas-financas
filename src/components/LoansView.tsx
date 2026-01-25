
import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useLoans, useCreateLoan } from '../modules/loans/hooks.ts';
import { Loan, LoanType, LoanStatus } from '../modules/loans/types.ts';
// Added TrendingUpIcon and ArrowDownIcon to the imports below
import { HandshakeIcon, PlusIcon, SearchIcon, FilterIcon, LayoutGridIcon, ListIcon, WarningIcon, TrendingUpIcon, ArrowDownIcon } from './Icons.tsx';
import LoanCard from './LoanCard.tsx';
import LoanFormModal from './LoanFormModal.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface LoansViewProps {
    onSelectLoan: (loan: Loan) => void;
    onAddTransaction: (t: any) => void;
}

const LoansView: React.FC<LoansViewProps> = ({ onSelectLoan, onAddTransaction }) => {
    const { data: loans, isLoading } = useLoans();
    const createLoanMutation = useCreateLoan();
    const { playSound } = useTheme();
    const { activeWorkspace } = useWorkspace();
    const MotionDiv = motion.div as any;

    const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<'all' | LoanType>('all');
    const [filterStatus, setFilterStatus] = useState<'all' | LoanStatus>('all');
    const [isFormOpen, setIsFormOpen] = useState(false);

    const filteredLoans = useMemo(() => {
        if (!loans) return [];
        return loans.filter(l => {
            const matchesSearch = l.personName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                 l.description.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesType = filterType === 'all' || l.type === filterType;
            const matchesStatus = filterStatus === 'all' || l.status === filterStatus;
            return matchesSearch && matchesType && matchesStatus;
        });
    }, [loans, searchQuery, filterType, filterStatus]);

    const stats = useMemo(() => {
        if (!loans) return { lend: 0, borrow: 0, overdue: 0 };
        return {
            lend: loans.filter(l => l.type === 'lend' && l.status !== 'paid').reduce((a, b) => a + b.currentBalance, 0),
            borrow: loans.filter(l => l.type === 'borrow' && l.status !== 'paid').reduce((a, b) => a + b.currentBalance, 0),
            overdue: loans.filter(l => l.status === 'overdue').length
        };
    }, [loans]);

    const handleSaveLoan = (newLoan: Loan) => {
        createLoanMutation.mutate(newLoan, {
            onSuccess: () => {
                playSound('success');
                // Initial Transaction is handled inside LoanFormModal or here.
                // Re-triggering of list is handled by react-query.
            }
        });
    };

    const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;

    return (
        <div className="h-full flex flex-col animate-fade-in">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-on-surface flex items-center gap-2">
                        <HandshakeIcon className="h-6 w-6 text-primary" />
                        Empréstimos
                    </h2>
                    <p className="text-sm text-muted">Controle de valores emprestados e tomados</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                    <div className="relative flex-1 min-w-[200px]">
                        <input
                            type="text"
                            placeholder="Buscar pessoa ou descrição..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 border border-border rounded-lg bg-surface text-sm focus:ring-2 focus:ring-primary outline-none text-on-surface"
                        />
                        <SearchIcon className="absolute left-3 top-2.5 text-muted h-4 w-4" />
                    </div>

                    <div className="flex items-center gap-2 bg-surface p-1 rounded-lg border border-border">
                        <div className="flex items-center px-2 text-muted">
                            <FilterIcon className="h-4 w-4" />
                        </div>
                        <select 
                            value={filterType} 
                            onChange={(e) => setFilterType(e.target.value as any)}
                            className="text-sm bg-transparent border-none text-on-surface focus:ring-0 cursor-pointer"
                        >
                            <option value="all">Todos os Tipos</option>
                            <option value="lend">Eu Emprestei</option>
                            <option value="borrow">Eu Peguei</option>
                        </select>
                        <div className="w-px h-4 bg-border mx-1"></div>
                        <select 
                            value={filterStatus} 
                            onChange={(e) => setFilterStatus(e.target.value as any)}
                            className="text-sm bg-transparent border-none text-on-surface focus:ring-0 cursor-pointer"
                        >
                            <option value="all">Todos Status</option>
                            <option value="active">Ativos</option>
                            <option value="overdue">Atrasados</option>
                            <option value="paid">Quitados</option>
                        </select>
                    </div>

                    <div className="flex bg-surface rounded-lg p-1 border border-border">
                        <button 
                            onClick={() => setViewMode('card')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'card' ? 'bg-primary/10 text-primary' : 'text-muted hover:text-on-surface'}`}
                        >
                            <LayoutGridIcon className="h-5 w-5" />
                        </button>
                        <button 
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted hover:text-on-surface'}`}
                        >
                            <ListIcon className="h-5 w-5" />
                        </button>
                    </div>

                    <button 
                        onClick={() => setIsFormOpen(true)}
                        className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-md transition-colors whitespace-nowrap"
                    >
                        <PlusIcon className="mr-2 h-4 w-4" /> Novo Empréstimo
                    </button>
                </div>
            </div>

            {/* Stats Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 rounded-lg"><TrendingUpIcon className="w-6 h-6" /></div>
                    <div><p className="text-[10px] font-bold text-muted uppercase">A Receber</p><p className="text-lg font-bold text-green-600">{formatCurrency(stats.lend)}</p></div>
                </div>
                <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg"><ArrowDownIcon className="w-6 h-6" /></div>
                    <div><p className="text-[10px] font-bold text-muted uppercase">A Pagar</p><p className="text-lg font-bold text-red-600">{formatCurrency(stats.borrow)}</p></div>
                </div>
                <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400 rounded-lg"><WarningIcon className="w-6 h-6" /></div>
                    <div><p className="text-[10px] font-bold text-muted uppercase">Atrasados</p><p className="text-lg font-bold text-yellow-600">{stats.overdue} contratos</p></div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-6">
                {viewMode === 'card' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {filteredLoans.map(loan => (
                            <LoanCard key={loan.id} loan={loan} onClick={() => onSelectLoan(loan)} />
                        ))}
                    </div>
                ) : (
                    <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-background text-muted uppercase font-bold text-[10px] border-b border-border">
                                <tr>
                                    <th className="px-4 py-3">Pessoa / Descrição</th>
                                    <th className="px-4 py-3 text-center">Tipo</th>
                                    <th className="px-4 py-3 text-right">Saldo Atual</th>
                                    <th className="px-4 py-3 text-center">Progresso</th>
                                    <th className="px-4 py-3 text-center">Vencimento</th>
                                    <th className="px-4 py-3 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {filteredLoans.map(loan => (
                                    <tr key={loan.id} onClick={() => onSelectLoan(loan)} className="hover:bg-background/50 transition-colors cursor-pointer group">
                                        <td className="px-4 py-3"><p className="font-bold text-on-surface">{loan.personName}</p><p className="text-xs text-muted truncate max-w-[200px]">{loan.description}</p></td>
                                        <td className="px-4 py-3 text-center"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${loan.type === 'lend' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{loan.type === 'lend' ? 'Emprestei' : 'Peguei'}</span></td>
                                        <td className="px-4 py-3 text-right font-bold text-on-surface">{formatCurrency(loan.currentBalance)}</td>
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex items-center gap-2 justify-center">
                                                <div className="w-12 h-1.5 bg-background rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (loan.totalPaidReceived / (loan.principalValue + (loan.interestType === 'fixed' ? loan.interestValue || 0 : 0))) * 100)}%` }}></div></div>
                                                <span className="text-[10px] text-muted">{Math.round((loan.totalPaidReceived / (loan.principalValue || 1)) * 100)}%</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center text-muted">{new Date(loan.expectedPayoffDate).toLocaleDateString('pt-BR')}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                loan.status === 'active' ? 'bg-blue-100 text-blue-700' :
                                                loan.status === 'paid' ? 'bg-green-100 text-green-700' :
                                                loan.status === 'overdue' ? 'bg-red-100 text-red-700' :
                                                loan.status === 'cancelled' ? 'bg-gray-100 text-gray-500' : 'bg-gray-100 text-gray-500'
                                            }`}>{loan.status}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {filteredLoans.length === 0 && (
                    <div className="text-center py-20 bg-gray-50 dark:bg-dark-200/50 rounded-xl border-2 border-dashed border-border">
                        <p className="text-muted">Nenhum empréstimo encontrado.</p>
                    </div>
                )}
            </div>

            <LoanFormModal 
                isOpen={isFormOpen} 
                onClose={() => setIsFormOpen(false)} 
                onSave={handleSaveLoan}
                onAddTransaction={onAddTransaction}
            />
        </div>
    );
};

export default LoansView;
