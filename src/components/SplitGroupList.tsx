import React from 'react';
import type { SplitGroup, SplitParticipant } from '../modules/split-bills/types.ts';
import { formatSplitCents } from '../modules/split-bills/presentation.ts';
import { DynamicIcon, UsersIcon, EditIcon, DeleteIcon, RefreshIcon } from './Icons.tsx';

interface GroupActions {
    onEdit?: () => void;
    onArchive?: () => void;
    onReactivate?: () => void;
}

interface SplitGroupListProps {
    groups: SplitGroup[];
    /** `groupId` → registro do próprio usuário (saldos do servidor). */
    myParticipants: ReadonlyMap<string, SplitParticipant>;
    onSelectGroup: (groupId: string) => void;
    actionsOf: (group: SplitGroup) => GroupActions;
}

const GroupRow: React.FC<{
    group: SplitGroup;
    myParticipant: SplitParticipant | null;
    onSelect: () => void;
    actions: GroupActions;
}> = ({ group, myParticipant, onSelect, actions }) => {
    // Saldo do usuário no grupo: o que tem a receber menos o que deve.
    const balance = (myParticipant?.balances.receivableOpenCents ?? 0) -
        (myParticipant?.balances.owesOpenCents ?? 0);
    const status = balance > 0 ? 'credit' : balance < 0 ? 'debt' : 'neutral';
    const isActive = group.status === 'active';
    const { onEdit, onArchive, onReactivate } = actions;

    return (
        <tr
            onClick={onSelect}
            className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors cursor-pointer group"
        >
            <td className="px-4 py-4">
                <div className="flex items-center gap-3">
                    <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm flex-shrink-0"
                        style={{ backgroundColor: group.visual.color }}
                    >
                        {group.visual.emoji ? <span className="text-sm">{group.visual.emoji}</span> : <DynamicIcon name={group.visual.icon} size={16} />}
                    </div>
                    <div>
                        <p className="font-bold text-gray-800 dark:text-white text-sm">{group.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{group.groupType === 'fixed' ? 'Recorrente' : 'Temporário'}</p>
                    </div>
                </div>
            </td>
            <td className="px-4 py-4">
                <div className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
                    <UsersIcon className="h-4 w-4 text-gray-400" />
                    {group.counters.activeParticipantCount}
                </div>
            </td>
            <td className="px-4 py-4 text-sm font-medium text-gray-800 dark:text-white">
                {formatSplitCents(group.businessMode === 'reimbursement' ? group.totals.reimbursementTotalCents : group.totals.billedCents)}
            </td>
            <td className="px-4 py-4">
                <span className={`text-sm font-bold ${
                    status === 'credit' ? 'text-green-600' :
                    status === 'debt' ? 'text-red-600' : 'text-gray-400'
                }`}>
                    {balance > 0 ? `+ ${formatSplitCents(balance)}` :
                     balance < 0 ? `- ${formatSplitCents(Math.abs(balance))}` :
                     'Zerado'}
                </span>
            </td>
            <td className="px-4 py-4">
                <div className="flex items-center justify-between">
                    <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${
                        isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }`}>
                        {isActive ? 'Ativo' : 'Encerrado'}
                    </span>

                    {(onEdit || onArchive || onReactivate) && (
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            {onEdit && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onEdit(); }}
                                    className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-dark-300 rounded transition-colors"
                                    aria-label="Editar Grupo"
                                >
                                    <EditIcon className="w-4 h-4" />
                                </button>
                            )}
                            {onArchive && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onArchive(); }}
                                    className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                    aria-label="Arquivar Grupo"
                                >
                                    <DeleteIcon className="w-4 h-4" />
                                </button>
                            )}
                            {onReactivate && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onReactivate(); }}
                                    className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-dark-300 rounded transition-colors"
                                    aria-label="Reativar Grupo"
                                >
                                    <RefreshIcon className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </td>
        </tr>
    );
};

const SplitGroupList: React.FC<SplitGroupListProps> = ({ groups, myParticipants, onSelectGroup, actionsOf }) => {
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
                                myParticipant={myParticipants.get(group.id) ?? null}
                                onSelect={() => onSelectGroup(group.id)}
                                actions={actionsOf(group)}
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
