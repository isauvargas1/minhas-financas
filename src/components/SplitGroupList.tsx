
import React from 'react';
import { SplitGroup } from '../types.ts';
import { useSplitBills, useSplitGroupShares, useSplitParticipants } from '../modules/split-bills/hooks.ts';
import { DynamicIcon, UsersIcon, EditIcon, DeleteIcon } from './Icons.tsx';

interface SplitGroupListProps {
    groups: SplitGroup[];
    onSelectGroup: (groupId: string) => void;
    onEdit?: (group: SplitGroup) => void;
    onDelete?: (group: SplitGroup) => void;
}

const GroupRow: React.FC<{ 
    group: SplitGroup; 
    onSelect: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
}> = ({ group, onSelect, onEdit, onDelete }) => {
    const { data: bills } = useSplitBills(group.id);
    const { data: shares } = useSplitGroupShares(group.id);
    const { data: participants } = useSplitParticipants(group.id);

    const myParticipantId = React.useMemo(() => {
        if (!participants) return null;
        return participants.find(p => p.nomeExibicao === 'Você')?.id;
    }, [participants]);

    const isOwner = React.useMemo(() => {
        if (!participants) return false;
        const me = participants.find(p => p.nomeExibicao === 'Você');
        return me?.papel === 'dono';
    }, [participants]);

    const summary = React.useMemo(() => {
        if (!bills || !shares || !myParticipantId) {
            return { totalGroup: 0, balance: 0, status: 'neutral' };
        }

        const totalGroup = bills.reduce((acc, b) => acc + (b.valorReal || 0), 0);
        
        let myDebt = 0;
        let myCredit = 0;

        const myShares = shares.filter(s => s.participantId === myParticipantId);
        myDebt = myShares.filter(s => s.status === 'aPagar').reduce((acc, s) => acc + s.valorDevido, 0);

        const myBills = bills.filter(b => b.pagadorPrincipalId === myParticipantId);
        const myBillIds = myBills.map(b => b.id);
        const othersSharesOfMyBills = shares.filter(s => myBillIds.includes(s.billId) && s.participantId !== myParticipantId);

        myCredit = othersSharesOfMyBills.filter(s => s.status === 'aPagar').reduce((acc, s) => acc + s.valorDevido, 0);
        
        const balance = myCredit - myDebt;
        const status = balance > 0 ? 'credit' : balance < 0 ? 'debt' : 'neutral';

        return { totalGroup, balance, status };
    }, [bills, shares, myParticipantId]);

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    return (
        <tr 
            onClick={onSelect} 
            className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors cursor-pointer group"
        >
            <td className="px-4 py-4">
                <div className="flex items-center gap-3">
                    <div 
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm flex-shrink-0"
                        style={{ backgroundColor: group.corPrincipal }}
                    >
                        {group.emojiOpcional ? <span className="text-sm">{group.emojiOpcional}</span> : <DynamicIcon name={group.icone} size={16} />}
                    </div>
                    <div>
                        <p className="font-bold text-gray-800 dark:text-white text-sm">{group.nome}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{group.tipo === 'fixo' ? 'Recorrente' : 'Temporário'}</p>
                    </div>
                </div>
            </td>
            <td className="px-4 py-4">
                <div className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
                    <UsersIcon className="h-4 w-4 text-gray-400" />
                    {participants?.length || 0}
                </div>
            </td>
            <td className="px-4 py-4 text-sm font-medium text-gray-800 dark:text-white">
                {formatCurrency(summary.totalGroup)}
            </td>
            <td className="px-4 py-4">
                <span className={`text-sm font-bold ${
                    summary.status === 'credit' ? 'text-green-600' : 
                    summary.status === 'debt' ? 'text-red-600' : 'text-gray-400'
                }`}>
                    {summary.balance > 0 ? `+ ${formatCurrency(summary.balance)}` : 
                     summary.balance < 0 ? `- ${formatCurrency(Math.abs(summary.balance))}` : 
                     'Zerado'}
                </span>
            </td>
            <td className="px-4 py-4">
                <div className="flex items-center justify-between">
                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${
                        group.ativo ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }`}>
                        {group.ativo ? 'Ativo' : 'Encerrado'}
                    </span>
                    
                    {isOwner && (
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {onEdit && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onEdit(); }}
                                    className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-dark-300 rounded transition-colors"
                                >
                                    <EditIcon className="w-4 h-4" />
                                </button>
                            )}
                            {onDelete && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                                    className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                >
                                    <DeleteIcon className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </td>
        </tr>
    );
};

const SplitGroupList: React.FC<SplitGroupListProps> = ({ groups, onSelectGroup, onEdit, onDelete }) => {
    return (
        <div className="bg-white dark:bg-dark-100 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 dark:bg-dark-200 text-gray-500 dark:text-gray-400 text-xs uppercase font-bold border-b border-gray-200 dark:border-gray-700">
                        <tr>
                            <th className="px-4 py-3">Grupo</th>
                            <th className="px-4 py-3">Participantes</th>
                            <th className="px-4 py-3">Total do Grupo</th>
                            <th className="px-4 py-3">Seu Saldo</th>
                            <th className="px-4 py-3">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groups.map(group => (
                            <GroupRow 
                                key={group.id} 
                                group={group} 
                                onSelect={() => onSelectGroup(group.id)} 
                                onEdit={onEdit ? () => onEdit(group) : undefined}
                                onDelete={onDelete ? () => onDelete(group) : undefined}
                            />
                        ))}
                         {groups.length === 0 && (
                            <tr>
                                <td colSpan={5} className="text-center py-10 text-gray-500 dark:text-gray-400">
                                    Nenhum grupo encontrado.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default SplitGroupList;
