import React from 'react';
import { motion } from 'framer-motion';
import type { SplitGroup, SplitParticipant } from '../modules/split-bills/types.ts';
import { formatSplitCents } from '../modules/split-bills/presentation.ts';
import { DynamicIcon, UsersIcon, EditIcon, DeleteIcon, RefreshIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';

interface SplitGroupCardProps {
    group: SplitGroup;
    /** Registro do próprio usuário no grupo (saldos do servidor). */
    myParticipant: SplitParticipant | null;
    onClick: () => void;
    onEdit?: () => void;
    onArchive?: () => void;
    onReactivate?: () => void;
}

/**
 * Cartão do grupo: os números vêm dos agregados mantidos pelo backend (total
 * do grupo e saldos do participante do usuário). Nenhuma lista de despesas
 * ou rateios é carregada por cartão.
 */
const SplitGroupCard: React.FC<SplitGroupCardProps> = ({ group, myParticipant, onClick, onEdit, onArchive, onReactivate }) => {
    const { playSound } = useTheme();
    const MotionDiv = motion.div as any;
    const isActive = group.status === 'active';
    const myDebt = myParticipant?.balances.owesOpenCents ?? 0;
    const myCredit = myParticipant?.balances.receivableOpenCents ?? 0;
    const hasActions = Boolean(onEdit || onArchive || onReactivate);

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
            className={`bg-white dark:bg-dark-100 rounded-xl p-0 shadow-sm border border-gray-100 dark:border-gray-700 cursor-pointer group flex flex-col relative overflow-hidden ${!isActive ? 'opacity-75 grayscale-[0.5]' : ''}`}
        >
            {/* Top Color Bar */}
            <div className="h-2 w-full" style={{ backgroundColor: group.visual.color }}></div>

            <div className="p-5 flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                     <div className="flex items-center gap-3">
                        <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm flex-shrink-0"
                            style={{ backgroundColor: group.visual.color }}
                        >
                            {group.visual.emoji ? <span className="text-xl">{group.visual.emoji}</span> : <DynamicIcon name={group.visual.icon} size={20} />}
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-1">
                                {group.name}
                            </h3>
                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                <span className={`px-1.5 py-0.5 rounded font-bold uppercase ${
                                    group.groupType === 'fixed' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300' : 'bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-300'
                                }`}>
                                    {group.groupType === 'fixed' ? 'fixo' : 'temporario'}
                                </span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                    <UsersIcon className="h-3 w-3" /> {group.counters.activeParticipantCount}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-1">
                        {!isActive && (
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] uppercase font-bold rounded mr-1">Encerrado</span>
                        )}
                        {/* Action Buttons (Only visible on hover or always if mobile) */}
                        {hasActions && (
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                {onEdit && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onEdit(); }}
                                        className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-dark-200 rounded-md transition-colors"
                                        title="Editar Grupo"
                                        aria-label="Editar Grupo"
                                    >
                                        <EditIcon className="w-4 h-4" />
                                    </button>
                                )}
                                {onArchive && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onArchive(); }}
                                        className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                                        title="Arquivar Grupo"
                                        aria-label="Arquivar Grupo"
                                    >
                                        <DeleteIcon className="w-4 h-4" />
                                    </button>
                                )}
                                {onReactivate && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onReactivate(); }}
                                        className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-dark-200 rounded-md transition-colors"
                                        title="Reativar Grupo"
                                        aria-label="Reativar Grupo"
                                    >
                                        <RefreshIcon className="w-4 h-4" />
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
                        <span className="font-bold text-gray-800 dark:text-white">{formatSplitCents(group.businessMode === 'reimbursement' ? group.totals.reimbursementTotalCents : group.totals.billedCents)}</span>
                    </div>

                    <div className="flex gap-2">
                        <div className="flex-1 bg-red-50 dark:bg-red-900/10 rounded-lg p-2 text-center">
                            <span className="text-[10px] text-red-500 uppercase font-bold block mb-0.5">Devo</span>
                            <span className="font-bold text-red-700 dark:text-red-300 text-sm">
                                {formatSplitCents(myDebt)}
                            </span>
                        </div>
                        <div className="flex-1 bg-green-50 dark:bg-green-900/10 rounded-lg p-2 text-center">
                            <span className="text-[10px] text-green-500 uppercase font-bold block mb-0.5">A Receber</span>
                            <span className="font-bold text-green-700 dark:text-green-300 text-sm">
                                {formatSplitCents(myCredit)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </MotionDiv>
    );
};

export default SplitGroupCard;
