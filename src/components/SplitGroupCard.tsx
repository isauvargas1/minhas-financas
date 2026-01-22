
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { SplitGroup } from '../types.ts';
import { useSplitBills, useSplitGroupShares, useSplitParticipants } from '../modules/split-bills/hooks.ts';
import { DynamicIcon, UsersIcon, EditIcon, DeleteIcon } from './Icons.tsx';
import { useTheme } from '../ThemeContext.tsx';

interface SplitGroupCardProps {
    group: SplitGroup;
    onClick: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
}

const SplitGroupCard: React.FC<SplitGroupCardProps> = ({ group, onClick, onEdit, onDelete }) => {
    const { playSound } = useTheme();
    const { data: bills } = useSplitBills(group.id);
    const { data: participants } = useSplitParticipants(group.id);
    const { data: shares } = useSplitGroupShares(group.id);
    const MotionDiv = motion.div as any;

    const myParticipantId = useMemo(() => {
        if (!participants) return null;
        return participants.find(p => p.nomeExibicao === 'Você')?.id;
    }, [participants]);

    const isOwner = useMemo(() => {
        if (!participants) return false;
        const me = participants.find(p => p.nomeExibicao === 'Você');
        return me?.papel === 'dono';
    }, [participants]);

    const summary = useMemo(() => {
        if (!bills || !shares || !myParticipantId) {
            return { totalGroup: 0, myDebt: 0, myCredit: 0 };
        }

        const totalGroup = bills.reduce((acc, b) => acc + (b.valorReal || 0), 0);
        
        let myDebt = 0;
        let myCredit = 0;

        const myShares = shares.filter(s => s.participantId === myParticipantId);
        myDebt = myShares
            .filter(s => s.status === 'aPagar')
            .reduce((acc, s) => acc + s.valorDevido, 0);

        const myBills = bills.filter(b => b.pagadorPrincipalId === myParticipantId);
        const myBillIds = myBills.map(b => b.id);
        
        const othersSharesOfMyBills = shares.filter(s => 
            myBillIds.includes(s.billId) && s.participantId !== myParticipantId
        );

        myCredit = othersSharesOfMyBills
            .filter(s => s.status === 'aPagar')
            .reduce((acc, s) => acc + s.valorDevido, 0);
            
        return { totalGroup, myDebt, myCredit };
    }, [bills, shares, myParticipantId]);

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    return (
        <MotionDiv 
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.02, y: -4, boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)" }}
            transition={{ duration: 0.2 }}
            onClick={() => {
                onClick();
                playSound('click');
            }}
            className={`bg-white dark:bg-dark-100 rounded-xl p-0 shadow-sm border border-gray-100 dark:border-gray-700 cursor-pointer group flex flex-col relative overflow-hidden ${!group.ativo ? 'opacity-75 grayscale-[0.5]' : ''}`}
        >
            {/* Top Color Bar */}
            <div className="h-2 w-full" style={{ backgroundColor: group.corPrincipal }}></div>
            
            <div className="p-5 flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                     <div className="flex items-center gap-3">
                        <div 
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm flex-shrink-0"
                            style={{ backgroundColor: group.corPrincipal }}
                        >
                            {group.emojiOpcional ? <span className="text-xl">{group.emojiOpcional}</span> : <DynamicIcon name={group.icone} size={20} />}
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-1">
                                {group.nome}
                            </h3>
                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                <span className={`px-1.5 py-0.5 rounded font-bold uppercase ${
                                    group.tipo === 'fixo' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300' : 'bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-300'
                                }`}>
                                    {group.tipo}
                                </span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                    <UsersIcon className="h-3 w-3" /> {participants?.length || 0}
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-1">
                        {!group.ativo && (
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] uppercase font-bold rounded mr-1">Encerrado</span>
                        )}
                        {/* Action Buttons (Only visible on hover or always if mobile) */}
                        {isOwner && (
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {onEdit && (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); onEdit(); }}
                                        className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-dark-200 rounded-md transition-colors"
                                        title="Editar Grupo"
                                    >
                                        <EditIcon className="w-4 h-4" />
                                    </button>
                                )}
                                {onDelete && (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                                        className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                                        title="Excluir Grupo"
                                    >
                                        <DeleteIcon className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Period Summary */}
                <div className="mt-auto space-y-3">
                    <div className="flex justify-between items-center text-sm border-t border-gray-100 dark:border-gray-800 pt-3">
                        <span className="text-gray-500 dark:text-gray-400">Total acumulado</span>
                        <span className="font-bold text-gray-800 dark:text-white">{formatCurrency(summary.totalGroup)}</span>
                    </div>
                    
                    <div className="flex gap-2">
                        <div className="flex-1 bg-red-50 dark:bg-red-900/10 rounded-lg p-2 text-center">
                            <span className="text-[10px] text-red-500 uppercase font-bold block mb-0.5">Devo</span>
                            <span className="font-bold text-red-700 dark:text-red-300 text-sm">
                                {formatCurrency(summary.myDebt)}
                            </span>
                        </div>
                        <div className="flex-1 bg-green-50 dark:bg-green-900/10 rounded-lg p-2 text-center">
                            <span className="text-[10px] text-green-500 uppercase font-bold block mb-0.5">A Receber</span>
                            <span className="font-bold text-green-700 dark:text-green-300 text-sm">
                                {formatCurrency(summary.myCredit)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </MotionDiv>
    );
};

export default SplitGroupCard;
