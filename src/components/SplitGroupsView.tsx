
import React, { useState, useMemo } from 'react';
import { useSplitGroups, useCreateSplitGroup, useUpdateSplitGroup, useDeleteSplitGroup } from '../modules/split-bills/hooks.ts';
import { SplitGroup } from '../types.ts';
import { PlusIcon, SearchIcon, LayoutGridIcon, ListIcon, FilterIcon, LoginIcon, UsersIcon, FileInvoiceIcon } from './Icons.tsx';
import { useTheme } from '../ThemeContext.tsx';
import SplitGroupCard from './SplitGroupCard.tsx';
import SplitGroupList from './SplitGroupList.tsx';
import SplitGroupFormModal from './SplitGroupFormModal.tsx';
import JoinGroupModal from './JoinGroupModal.tsx';
import ConfirmationModal from './ConfirmationModal.tsx';
import { useWorkspace } from '../WorkspaceContext.tsx';

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
    
    // Filters
    const [filterType, setFilterType] = useState<string>('todos');
    const [filterStatus, setFilterStatus] = useState<string>('ativos');
    
    // PJ Specific: Active Tab
    const [businessTab, setBusinessTab] = useState<'rateio' | 'reembolso'>('rateio');
    
    // Modal State
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
            
            // PJ Business Logic Filtering
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
            {/* Header */}
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
                    {/* Search */}
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

                    {/* Filters */}
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
                        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1"></div>
                        <select 
                            value={filterStatus} 
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="text-sm bg-transparent border-none text-gray-600 dark:text-gray-300 focus:ring-0 cursor-pointer"
                        >
                            <option value="ativos">Ativos</option>
                            <option value="encerrados">Encerrados</option>
                            <option value="todos">Todos</option>
                        </select>
                    </div>

                    {/* View Toggle */}
                    <div className="flex bg-gray-100 dark:bg-dark-200 rounded-lg p-1">
                        <button 
                            onClick={() => setViewMode('card')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'card' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                            title="Visualização em Cards"
                        >
                            <LayoutGridIcon className="h-5 w-5" />
                        </button>
                        <button 
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                            title="Visualização em Lista"
                        >
                            <ListIcon className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="flex gap-2 ml-auto sm:ml-0">
                        <button 
                            onClick={() => setIsJoinModalOpen(true)}
                            className="bg-white dark:bg-dark-200 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-sm hover:bg-gray-50 dark:hover:bg-dark-300 transition-colors whitespace-nowrap"
                        >
                            <LoginIcon className="mr-2 h-4 w-4" />
                            Entrar
                        </button>
                        <button 
                            onClick={openCreateModal}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-md transition-colors whitespace-nowrap"
                        >
                            <PlusIcon className="mr-2 h-4 w-4" />
                            {isPJ ? (businessTab === 'rateio' ? 'Novo Rateio' : 'Novo Reembolso') : 'Novo Grupo'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Business Tabs (PJ Only) */}
            {isPJ && (
                <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
                    <button 
                        onClick={() => setBusinessTab('rateio')}
                        className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${businessTab === 'rateio' ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                    >
                        <UsersIcon className="h-4 w-4" /> Rateio de Custos
                    </button>
                    <button 
                        onClick={() => setBusinessTab('reembolso')}
                        className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${businessTab === 'reembolso' ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                    >
                        <FileInvoiceIcon className="h-4 w-4" /> Reembolsos
                    </button>
                </div>
            )}

            {/* Content */}
            {isGroupsLoading ? (
                 <div className="flex items-center justify-center py-20">
                     <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                 </div>
            ) : (
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-6">
                    {viewMode === 'card' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {filteredGroups.map(group => (
                                <SplitGroupCard 
                                    key={group.id} 
                                    group={group} 
                                    onClick={() => onSelectGroup(group.id)}
                                    onEdit={() => openEditModal(group)}
                                    onDelete={() => setGroupToDelete(group)}
                                />
                            ))}
                        </div>
                    ) : (
                        <SplitGroupList 
                            groups={filteredGroups} 
                            onSelectGroup={onSelectGroup}
                            onEdit={(group) => openEditModal(group)}
                            onDelete={(group) => setGroupToDelete(group)}
                        />
                    )}

                    {filteredGroups.length === 0 && (
                        <div className="text-center py-20 bg-gray-50 dark:bg-dark-200/50 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                            <p className="text-gray-500 dark:text-gray-400">Nenhum registro encontrado.</p>
                            <div className="mt-4 flex gap-3 justify-center">
                                <button onClick={openCreateModal} className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
                                    Criar novo
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <SplitGroupFormModal 
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSave={(group) => {
                    if (groupToEdit) handleUpdateGroup(group);
                    else handleCreateGroup(group);
                }}
                groupToEdit={groupToEdit}
                initialBusinessType={isPJ ? businessTab : undefined}
            />

            <JoinGroupModal 
                isOpen={isJoinModalOpen}
                onClose={() => setIsJoinModalOpen(false)}
                onSuccess={(groupId) => onSelectGroup(groupId)}
            />

            {groupToDelete && (
                <ConfirmationModal 
                    isOpen={!!groupToDelete}
                    onClose={() => setGroupToDelete(null)}
                    onConfirm={() => handleDeleteGroup(groupToDelete.id)}
                    title="Excluir Grupo"
                    message={`Tem certeza que deseja excluir "${groupToDelete.nome}"? Todo o histórico será perdido.`}
                />
            )}

             <style>{`
                @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .animate-fade-in {
                    animation: fade-in 0.3s ease-out forwards;
                }
            `}</style>
        </div>
    );
};

export default SplitGroupsView;
