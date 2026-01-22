
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Loan } from '../modules/loans/types.ts';
import { DynamicIcon, UsersIcon, CalendarIcon, WarningIcon } from './Icons.tsx';
import { useTheme } from '../ThemeContext.tsx';

interface LoanCardProps {
    loan: Loan;
    onClick: () => void;
}

const LoanCard: React.FC<LoanCardProps> = ({ loan, onClick }) => {
    const { playSound } = useTheme();
    const MotionDiv = motion.div as any;

    const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    const progress = useMemo(() => {
        const totalToSettle = loan.principalValue + (loan.interestType === 'fixed' ? loan.interestValue || 0 : 0);
        if (totalToSettle <= 0) return 100;
        return Math.min(100, (loan.totalPaidReceived / totalToSettle) * 100);
    }, [loan]);

    return (
        <MotionDiv
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ y: -4, boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)" }}
            onClick={() => { playSound('click'); onClick(); }}
            className={`bg-surface rounded-card border border-border shadow-sm overflow-hidden flex flex-col cursor-pointer transition-all duration-300 ${loan.status === 'overdue' ? 'border-red-300' : 'hover:border-primary/50'}`}
        >
            <div className={`h-1.5 w-full ${loan.type === 'lend' ? 'bg-green-500' : 'bg-red-500'}`}></div>
            
            <div className="p-5 flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm ${loan.type === 'lend' ? 'bg-green-600' : 'bg-red-600'}`}>
                        <DynamicIcon name={loan.type === 'lend' ? 'ArrowUp' : 'ArrowDown'} size={20} />
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                            loan.status === 'active' ? 'bg-blue-100 text-blue-700' :
                            loan.status === 'paid' ? 'bg-green-100 text-green-700' :
                            loan.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                        }`}>{loan.status}</span>
                        {loan.status === 'overdue' && <span className="flex items-center gap-1 text-red-600 text-[9px] font-bold"><WarningIcon className="w-3 h-3" /> ATRASADO</span>}
                    </div>
                </div>

                <div className="mb-4">
                    <h3 className="font-bold text-on-surface text-lg truncate group-hover:text-primary transition-colors">{loan.personName}</h3>
                    <p className="text-xs text-muted line-clamp-1">{loan.description}</p>
                </div>

                <div className="mt-auto space-y-4">
                    <div className="flex justify-between items-end">
                        <div>
                            <span className="text-[10px] text-muted uppercase font-bold block mb-0.5">Saldo Pendente</span>
                            <span className="text-xl font-black text-on-surface">{formatCurrency(loan.currentBalance)}</span>
                        </div>
                        <div className="text-right">
                            <span className="text-[10px] text-muted uppercase font-bold block mb-0.5">Principal</span>
                            <span className="text-sm font-bold text-muted">{formatCurrency(loan.principalValue)}</span>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex justify-between text-[10px] font-bold text-muted uppercase">
                            <span>Quitação</span>
                            <span>{Math.round(progress)}%</span>
                        </div>
                        <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-border/50">
                            <MotionDiv className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 1 }} />
                        </div>
                    </div>

                    <div className="pt-3 border-t border-border flex justify-between items-center text-[10px] font-medium text-muted">
                        <span className="flex items-center gap-1"><CalendarIcon className="w-3 h-3" /> Fim: {new Date(loan.expectedPayoffDate).toLocaleDateString('pt-BR')}</span>
                        <span className="flex items-center gap-1"><DynamicIcon name="Coins" size={12} /> {loan.hasInstallments ? `${loan.installmentsCount}x` : 'Única'}</span>
                    </div>
                </div>
            </div>
        </MotionDiv>
    );
};

export default LoanCard;
