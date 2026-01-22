
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Loan } from '../modules/loans/types.ts';
import { BriefcaseIcon, BuildingIcon, WarningIcon, DynamicIcon } from './Icons.tsx';
import { useTheme } from '../ThemeContext.tsx';
import { getPJLoanClassificationLabel } from '../modules/loans/pj-logic.ts';

interface PJLoanCardProps {
    loan: Loan;
    onClick: () => void;
}

const PJLoanCard: React.FC<PJLoanCardProps> = ({ loan, onClick }) => {
    const { playSound } = useTheme();
    const MotionDiv = motion.div as any;

    const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    const progress = useMemo(() => {
        // PJ simple progress: (Total Paid / (Principal + Estimated Interest))
        // We simulate a total cost for progress purposes
        const totalPrincipal = loan.principalValue;
        if (totalPrincipal <= 0) return 100;
        return Math.min(100, (loan.totalPaidReceived / totalPrincipal) * 100);
    }, [loan]);

    const isLiab = loan.type === 'borrow';

    return (
        <MotionDiv
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4, boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)" }}
            onClick={() => { playSound('click'); onClick(); }}
            className={`bg-surface rounded-card border border-border shadow-sm overflow-hidden flex flex-col cursor-pointer transition-all duration-300 ${loan.status === 'overdue' ? 'border-red-300' : 'hover:border-primary/50'}`}
        >
            <div className="p-4 bg-background/50 border-b border-border flex justify-between items-center">
                <span className="text-[9px] font-black uppercase tracking-widest text-muted">{getPJLoanClassificationLabel(loan.classification)}</span>
                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${
                    loan.status === 'active' ? 'border-blue-200 text-blue-700 bg-blue-50' :
                    loan.status === 'paid' ? 'border-green-200 text-green-700 bg-green-50' :
                    loan.status === 'overdue' ? 'border-red-200 text-red-700 bg-red-50' : 'bg-gray-100 text-gray-500'
                }`}>
                    {loan.status === 'overdue' ? 'ATRASADO' : loan.status}
                </span>
            </div>
            
            <div className="p-5 flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                        <h3 className="font-bold text-on-surface text-lg leading-tight group-hover:text-primary transition-colors truncate">{loan.personName}</h3>
                        <p className="text-[11px] text-muted flex items-center gap-1.5 mt-0.5">
                            <BriefcaseIcon className="w-3 h-3" /> {loan.costCenter || 'S/ Centro de Custo'}
                        </p>
                    </div>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm flex-shrink-0 ${isLiab ? 'bg-red-600' : 'bg-green-600'}`}>
                        <DynamicIcon name={isLiab ? 'ArrowDown' : 'ArrowUp'} size={20} />
                    </div>
                </div>

                <div className="space-y-4 mt-auto">
                    <div className="flex justify-between items-end">
                        <div>
                            <span className="text-[10px] text-muted uppercase font-bold block mb-0.5">{isLiab ? 'Saldo Devedor' : 'Saldo a Receber'}</span>
                            <span className="text-xl font-black text-on-surface">{formatCurrency(loan.currentBalance)}</span>
                        </div>
                        <div className="text-right">
                            <span className="text-[10px] text-muted uppercase font-bold block mb-0.5">Vencimento</span>
                            <span className="text-xs font-bold text-on-surface">{new Date(loan.expectedPayoffDate).toLocaleDateString('pt-BR')}</span>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex justify-between text-[9px] font-black text-muted uppercase tracking-wider">
                            <span>Amortização</span>
                            <span>{Math.round(progress)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-background rounded-full overflow-hidden border border-border/50">
                            <MotionDiv className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 1 }} />
                        </div>
                    </div>
                </div>
            </div>
        </MotionDiv>
    );
};

export default PJLoanCard;
