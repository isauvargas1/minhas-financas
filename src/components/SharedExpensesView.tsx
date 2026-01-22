
import React, { useState, useMemo } from 'react';
import { useSplitGroups, useCreateSplitGroup, useUpdateSplitGroup, useDeleteSplitGroup } from '../modules/split-bills/hooks.ts';
import { SplitGroup } from '../types.ts';
import { PlusIcon, SearchIcon, LayoutGridIcon, ListIcon, FilterIcon, LoginIcon, UsersIcon, FileInvoiceIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import SplitGroupCard from './SplitGroupCard.tsx';
import SplitGroupList from './SplitGroupList.tsx';
import SplitGroupFormModal from './SplitGroupFormModal.tsx';
import JoinGroupModal from './JoinGroupModal.tsx';
import ConfirmationModal from './ConfirmationModal.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface SplitGroupsViewProps {
    onSelectGroup: (groupId: string) => void;
    onCreateGroup: () => void; 
}

const SplitGroupsView: React.FC<SplitGroupsViewProps> = ({ onSelectGroup }) => {
    const { data: groups, isLoading: isGroupsLoading } = useSplitGroups();
    const createGroupMutation = useCreateSplitGroup();
    const updateGroupMutation = useUpdateSplitGroup();
    const deleteGroupMutation = useDeleteSplitGroup();
    const { playSound } = useTheme();
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';
    
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
    
    const [filterType, setFilterType] = useState<string>('todos');
    const [filterStatus, setFilterStatus] = useState<string>('ativos');
    const [businessTab, setBusinessTab] = useState<'rateio' | 'reembolso'>('rateio');
    
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
    const [groupToEdit, setGroupToEdit] = useState<SplitGroup | null>(null);
    const [groupToDelete, setGroupToDelete] = useState<SplitGroup | null>(null);

    const filteredGroups = useMemo(() => {
        if (!groups) return [];
        return groups.filter(g => {
            const matchesSearch = g.nome.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesType = filterType === 'todos' || g.tipo === filterType;
            const matchesStatus = filterStatus === 'todos' 
                ? true 
                : filterStatus === 'ativos' ? g.ativo : !g.ativo;
            
            const matchesBusinessType = isPJ 
                ? (g.businessType || 'rateio') === businessTab
                : true;
            
            return matchesSearch && matchesType && matchesStatus && matchesBusinessType;
        });
    }, [groups, searchQuery, filterType, filterStatus, isPJ, businessTab]);

    const handleCreateGroup = (newGroup: SplitGroup) => {
        createGroupMutation.mutate(newGroup);
        playSound('success');
    };

    const handleUpdateGroup = (updatedGroup: SplitGroup) => {
        updateGroupMutation.mutate(updatedGroup);
        playSound('success');
    };

    const handleDeleteGroup = (groupId: string) => {
        deleteGroupMutation.mutate(groupId);
        playSound('success');
        setGroupToDelete(null);
    };

    const openCreateModal = () => {
        setGroupToEdit(null);
        setIsCreateModalOpen(true);
        playSound('click');
    };

    const openEditModal = (group: SplitGroup) => {
        setGroupToEdit(group);
        setIsCreateModalOpen(true);
        playSound('click');
    };

    return (
        <div className="h-full flex flex-col animate-fade-in">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                        {isPJ ? 'Rateios & Reembolsos' : 'Divisão de Contas'}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {isPJ ? 'Gerencie centros de custo e reembolsos' : 'Organize despesas compartilhadas em grupos'}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                    <div className="relative flex-1 min-w-[200px]">
                        <input
                            type="text"
                            placeholder="Buscar..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-dark-200 text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                        />
                        <div className="absolute left-3 top-2.5 text-gray-400">
                            <SearchIcon className="h-4 w-4" />
                        </div>
                    </div>

                    <div className="flex items-center gap-2 bg-white dark:bg-dark-100 p-1 rounded-lg border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center px-2 text-gray-400">
                            <FilterIcon className="h-4 w-4" />
                        </div>
                        <select 
                            value={filterType} 
                            onChange={(e) => setFilterType(e.target.value)}
                            className="text-sm bg-transparent border-none text-gray-600 dark:text-gray-300 focus:ring-0 cursor-pointer"
                        >
                            <option value="todos">Todos Tipos</option>
                            <option value="fixo">Recorrente</option>
                            <option value="temporario">Temp.</option>
                        </select>
                    </div>

                    <div className="flex bg-gray-100 dark:bg-dark-200 rounded-lg p-1">
                        <button onClick={() => setViewMode('card')} className={`p-2 rounded-md ${viewMode === 'card' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500'}`}><LayoutGridIcon className="h-5 w-5" /></button>
                        <button onClick={() => setViewMode('list')} className={`p-2 rounded-md ${viewMode === 'list' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500'}`}><ListIcon className="h-5 w-5" /></button>
                    </div>

                    <div className="flex gap-2">
                        <button onClick={() => setIsJoinModalOpen(true)} className="bg-white dark:bg-dark-200 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-sm hover:bg-gray-50 transition-colors">
                            <LoginIcon className="mr-2 h-4 w-4" /> Entrar
                        </button>
                        <button onClick={openCreateModal} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-md transition-colors">
                            <PlusIcon className="mr-2 h-4 w-4" /> Novo
                        </button>
                    </div>
                </div>
            </div>

            {isPJ && (
                <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
                    <button onClick={() => setBusinessTab('rateio')} className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${businessTab === 'rateio' ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Rateio</button>
                    <button onClick={() => setBusinessTab('reembolso')} className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${businessTab === 'reembolso' ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Reembolsos</button>
                </div>
            )}

            {isGroupsLoading ? (
                 <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>
            ) : (
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-6">
                    {viewMode === 'card' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {filteredGroups.map(group => (
                                <SplitGroupCard key={group.id} group={group} onClick={() => onSelectGroup(group.id)} onEdit={() => openEditModal(group)} onDelete={() => setGroupToDelete(group)} />
                            ))}
                        </div>
                    ) : (
                        <SplitGroupList groups={filteredGroups} onSelectGroup={onSelectGroup} onEdit={openEditModal} onDelete={setGroupToDelete} />
                    )}
                </div>
            )}

            <SplitGroupFormModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} onSave={groupToEdit ? handleUpdateGroup : handleCreateGroup} groupToEdit={groupToEdit} initialBusinessType={isPJ ? businessTab : undefined} />
            <JoinGroupModal isOpen={isJoinModalOpen} onClose={() => setIsJoinModalOpen(false)} onSuccess={onSelectGroup} />
            {groupToDelete && <ConfirmationModal isOpen={!!groupToDelete} onClose={() => setGroupToDelete(null)} onConfirm={() => handleDeleteGroup(groupToDelete.id)} title="Excluir Grupo" message={`Tem certeza que deseja excluir "${groupToDelete.nome}"?`} />}
        </div>
    );
};

export default SplitGroupsView;
