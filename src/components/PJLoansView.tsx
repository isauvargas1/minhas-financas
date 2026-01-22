
import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useLoans, useCreateLoan } from '../modules/loans/hooks.ts';
import { Loan, LoanType, LoanStatus } from '../modules/loans/types.ts';
import { HandshakeIcon, PlusIcon, SearchIcon, FilterIcon, LayoutGridIcon, ListIcon, WarningIcon, TrendingUpIcon, ArrowDownIcon, BriefcaseIcon } from './Icons.tsx';
import PJLoanCard from './PJLoanCard.tsx';
import PJLoanFormModal from './PJLoanFormModal.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface PJLoansViewProps {
    onSelectLoan: (loan: Loan) => void;
    onAddTransaction: (t: any) => void;
}

const PJLoansView: React.FC<PJLoansViewProps> = ({ onSelectLoan, onAddTransaction }) => {
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
        if (!loans) return { assets: 0, liabilities: 0, overdue: 0 };
        return {
            assets: loans.filter(l => l.type === 'lend' && l.status !== 'paid').reduce((a, b) => a + b.currentBalance, 0),
            liabilities: loans.filter(l => l.type === 'borrow' && l.status !== 'paid').reduce((a, b) => a + b.currentBalance, 0),
            overdue: loans.filter(l => l.status === 'overdue').length
        };
    }, [loans]);

    const handleSaveLoan = (newLoan: Loan) => {
        createLoanMutation.mutate(newLoan, {
            onSuccess: () => {
                playSound('success');
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
                        Empréstimos & Financiamentos
                    </h2>
                    <p className="text-sm text-muted">Gestão de passivos financeiros e adiantamentos concedidos</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                    <div className="relative flex-1 min-w-[200px]">
                        <input
                            type="text"
                            placeholder="Buscar credor, devedor ou projeto..."
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
                            <option value="borrow">Empresa Tomou (Passivo)</option>
                            <option value="lend">Empresa Concedeu (Ativo)</option>
                        </select>
                        <div className="w-px h-4 bg-border mx-1"></div>
                        <select 
                            value={filterStatus} 
                            onChange={(e) => setFilterStatus(e.target.value as any)}
                            className="text-sm bg-transparent border-none text-on-surface focus:ring-0 cursor-pointer"
                        >
                            <option value="all">Todos Status</option>
                            <option value="active">Ativos</option>
                            <option value="overdue">Em Atraso</option>
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
                        <PlusIcon className="mr-2 h-4 w-4" /> Nova Operação
                    </button>
                </div>
            </div>

            {/* Business KPI Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg"><ArrowDownIcon className="w-6 h-6" /></div>
                    <div><p className="text-[10px] font-bold text-muted uppercase">Total em Dívidas (Passivo)</p><p className="text-lg font-bold text-red-600">{formatCurrency(stats.liabilities)}</p></div>
                </div>
                <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 rounded-lg"><TrendingUpIcon className="w-6 h-6" /></div>
                    <div><p className="text-[10px] font-bold text-muted uppercase">A Receber (Ativo)</p><p className="text-lg font-bold text-green-600">{formatCurrency(stats.assets)}</p></div>
                </div>
                <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400 rounded-lg"><WarningIcon className="w-6 h-6" /></div>
                    <div><p className="text-[10px] font-bold text-muted uppercase">Alertas de Atraso</p><p className="text-lg font-bold text-yellow-600">{stats.overdue} operações</p></div>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-6">
                {viewMode === 'card' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {filteredLoans.map(loan => (
                            <PJLoanCard key={loan.id} loan={loan} onClick={() => onSelectLoan(loan)} />
                        ))}
                    </div>
                ) : (
                    <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-background text-muted uppercase font-bold text-[10px] border-b border-border">
                                <tr>
                                    <th className="px-4 py-3">Contraparte / Projeto</th>
                                    <th className="px-4 py-3 text-center">Tipo</th>
                                    <th className="px-4 py-3 text-right">Saldo Devedor/Credor</th>
                                    <th className="px-4 py-3 text-center">Juros</th>
                                    <th className="px-4 py-3 text-center">Vencimento Final</th>
                                    <th className="px-4 py-3 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {filteredLoans.map(loan => (
                                    <tr key={loan.id} onClick={() => onSelectLoan(loan)} className="hover:bg-background/50 transition-colors cursor-pointer group">
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col">
                                                <p className="font-bold text-on-surface">{loan.personName}</p>
                                                <p className="text-[10px] text-muted uppercase flex items-center gap-1">
                                                    <BriefcaseIcon className="w-2.5 h-2.5" /> {loan.costCenter || 'S/ Centro de Custo'}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${loan.type === 'lend' ? 'border-green-200 text-green-700 bg-green-50' : 'border-red-200 text-red-700 bg-red-50'}`}>
                                                {loan.type === 'lend' ? 'Ativo' : 'Passivo'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-on-surface">{formatCurrency(loan.currentBalance)}</td>
                                        <td className="px-4 py-3 text-center text-xs">
                                            {loan.interestType === 'none' ? 'Isento' : `${loan.interestValue}${loan.interestBasis === 'monthly' ? '% a.m.' : loan.interestBasis === 'annual' ? '% a.a.' : ' Fixo'}`}
                                        </td>
                                        <td className="px-4 py-3 text-center text-muted">{new Date(loan.expectedPayoffDate).toLocaleDateString('pt-BR')}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                loan.status === 'active' ? 'bg-blue-100 text-blue-700' :
                                                loan.status === 'paid' ? 'bg-green-100 text-green-700' :
                                                loan.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                                            }`}>{loan.status === 'overdue' ? 'Em Atraso' : loan.status}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {filteredLoans.length === 0 && (
                    <div className="text-center py-24 bg-gray-50 dark:bg-dark-200/50 rounded-2xl border-2 border-dashed border-border">
                        <div className="w-16 h-16 bg-background rounded-full flex items-center justify-center mx-auto mb-4 border border-border">
                            <HandshakeIcon className="w-8 h-8 text-muted" />
                        </div>
                        <h3 className="text-lg font-bold text-on-surface mb-1">Nenhuma operação corporativa</h3>
                        <p className="text-sm text-muted">Registre seus empréstimos bancários ou adiantamentos.</p>
                        <button onClick={() => setIsFormOpen(true)} className="mt-4 text-primary font-bold text-sm hover:underline">+ Cadastrar Primeiro</button>
                    </div>
                )}
            </div>

            <PJLoanFormModal 
                isOpen={isFormOpen} 
                onClose={() => setIsFormOpen(false)} 
                onSave={handleSaveLoan}
                onAddTransaction={onAddTransaction}
            />
        </div>
    );
};

export default PJLoansView;
