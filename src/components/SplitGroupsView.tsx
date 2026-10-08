import React, { useState, useMemo } from 'react';
import {
    useActiveSplitGroups,
    useArchivedSplitGroups,
    useArchiveSplitGroup,
    useCreateSplitGroup,
    useMySplitParticipants,
    useReactivateSplitGroup,
    useSplitIntentKey,
    useUpdateSplitGroup,
} from '../modules/split-bills/hooks.ts';
import { getSplitGroup } from '../modules/split-bills/api.ts';
import type { SplitGroup } from '../modules/split-bills/types.ts';
import { canCreateSplitGroup, groupPermissions, splitErrorView } from '../modules/split-bills/presentation.ts';
import type { SplitGroupSave } from './SplitGroupFormModal.tsx';
import { PlusIcon, SearchIcon, LayoutGridIcon, ListIcon, FilterIcon, LoginIcon, UsersIcon, FileInvoiceIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import SplitGroupCard from './SplitGroupCard.tsx';
import SplitGroupList from './SplitGroupList.tsx';
import SplitGroupFormModal from './SplitGroupFormModal.tsx';
import JoinGroupModal from './JoinGroupModal.tsx';
import ConfirmationModal from './ConfirmationModal.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
// Plano do workspace (do owner): o contador de grupos ativos vem do backend.
import { useBilling } from '../modules/billing/BillingContext';
import { splitGroupsQuotaView } from '../modules/billing/transactionsQuota';

interface SplitGroupsViewProps {
    onSelectGroup: (groupId: string) => void;
    onCreateGroup: () => void;
}

const SplitGroupsView: React.FC<SplitGroupsViewProps> = ({ onSelectGroup }) => {
    const [filterStatus, setFilterStatus] = useState<string>('ativos');
    const {
        data: activeGroups,
        isLoading: isActiveLoading,
        isTruncated: isActiveTruncated,
    } = useActiveSplitGroups();
    const {
        data: archivedGroups,
        isLoading: isArchivedLoading,
        hasNextPage,
        fetchNextPage,
        isFetchingNextPage,
    } = useArchivedSplitGroups(filterStatus !== 'ativos');
    const { byGroup: myParticipants } = useMySplitParticipants();
    const createGroupMutation = useCreateSplitGroup();
    const updateGroupMutation = useUpdateSplitGroup();
    const archiveGroupMutation = useArchiveSplitGroup();
    const reactivateGroupMutation = useReactivateSplitGroup();
    const intent = useSplitIntentKey();
    const { playSound } = useTheme();
    const { activeWorkspace, activeWorkspaceRole } = useWorkspace();
    const { user } = useAuth();
    const viewer = { uid: user?.uid, role: activeWorkspaceRole };
    // O limite é do plano do titular (D-01): só ele resolve com upgrade.
    const isWorkspaceOwner = activeWorkspaceRole === 'owner';
    const isPJ = activeWorkspace.type === 'PJ';

    // Quota `splitGroups` decidida e contada no servidor (P4-C).
    const { workspaceEntitlement } = useBilling();
    const splitQuota = splitGroupsQuotaView(workspaceEntitlement);
    const isQuotaReached = !splitQuota.canCreate;
    const canCreateGroup = canCreateSplitGroup(activeWorkspaceRole) && !isQuotaReached;

    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'card' | 'list'>('card');

    // Filters
    const [filterType, setFilterType] = useState<string>('todos');

    // PJ Specific: Active Tab
    const [businessTab, setBusinessTab] = useState<'rateio' | 'reembolso'>('rateio');

    // Modal State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
    const [groupToEdit, setGroupToEdit] = useState<SplitGroup | null>(null);
    const [groupToArchive, setGroupToArchive] = useState<SplitGroup | null>(null);
    const [groupToReactivate, setGroupToReactivate] = useState<SplitGroup | null>(null);
    const [lifecycleError, setLifecycleError] = useState<string | null>(null);

    const groups = useMemo(() => {
        if (filterStatus === 'ativos') return activeGroups ?? [];
        if (filterStatus === 'encerrados') return archivedGroups ?? [];
        return [...(activeGroups ?? []), ...(archivedGroups ?? [])];
    }, [filterStatus, activeGroups, archivedGroups]);

    const filteredGroups = useMemo(() => {
        return groups.filter(g => {
            const matchesSearch = g.name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesType = filterType === 'todos' || g.groupType === filterType;

            // PJ Business Logic Filtering
            const matchesBusinessType = isPJ
                ? g.businessMode === (businessTab === 'reembolso' ? 'reimbursement' : 'split')
                : true;

            return matchesSearch && matchesType && matchesBusinessType;
        });
    }, [groups, searchQuery, filterType, isPJ, businessTab]);

    const isGroupsLoading = isActiveLoading || (filterStatus !== 'ativos' && isArchivedLoading);

    const handleSaveGroup = async (save: SplitGroupSave) => {
        if (!groupToEdit) {
            const payload = save.create as Record<string, unknown>;
            await createGroupMutation.mutateAsync({
                payload,
                idempotencyKey: intent.keyFor('createSplitGroup', payload),
            });
        } else {
            let version = groupToEdit.version;
            if (Object.keys(save.changes).length > 0) {
                const payload = { groupId: groupToEdit.id, expectedUpdatedAt: version, changes: save.changes };
                await updateGroupMutation.mutateAsync({
                    payload,
                    idempotencyKey: intent.keyFor('updateSplitGroup', payload),
                });
                version = (await getSplitGroup(activeWorkspace.id, groupToEdit.id))?.version ?? version;
            }
            if (save.status !== groupToEdit.status) {
                const payload = { groupId: groupToEdit.id, expectedUpdatedAt: version };
                const mutation = save.status === 'archived' ? archiveGroupMutation : reactivateGroupMutation;
                await mutation.mutateAsync({
                    payload,
                    idempotencyKey: intent.keyFor(save.status === 'archived' ? 'archiveSplitGroup' : 'reactivateSplitGroup', payload),
                });
            }
        }
        intent.reset();
        playSound('success');
    };

    const handleLifecycle = async (group: SplitGroup, action: 'archive' | 'reactivate') => {
        setLifecycleError(null);
        const payload = { groupId: group.id, expectedUpdatedAt: group.version };
        const mutation = action === 'archive' ? archiveGroupMutation : reactivateGroupMutation;
        try {
            await mutation.mutateAsync({
                payload,
                idempotencyKey: intent.keyFor(action === 'archive' ? 'archiveSplitGroup' : 'reactivateSplitGroup', payload),
            });
            intent.reset();
            playSound('success');
            setGroupToArchive(null);
            setGroupToReactivate(null);
        } catch (error) {
            setLifecycleError(splitErrorView(error).message);
        }
    };

    const openCreateModal = () => {
        if (!canCreateGroup) return; // Segurança extra
        intent.reset();
        setGroupToEdit(null);
        setIsCreateModalOpen(true);
        playSound('click');
    };

    const openEditModal = (group: SplitGroup) => {
        intent.reset();
        setGroupToEdit(group);
        setIsCreateModalOpen(true);
        playSound('click');
    };

    const actionsOf = (group: SplitGroup) => {
        const permissions = groupPermissions(viewer, group, myParticipants.get(group.id) ?? null);
        if (!canCreateSplitGroup(activeWorkspaceRole) || !(permissions.canManage)) return {};
        return group.status === 'active'
            ? { onEdit: () => openEditModal(group), onArchive: () => { setLifecycleError(null); setGroupToArchive(group); } }
            : { onReactivate: () => { setLifecycleError(null); setGroupToReactivate(group); } };
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

                    {/* AVISO DE LIMITE ATINGIDO */}
                    {isQuotaReached && (
                        <div role="status" className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 rounded-lg inline-flex items-center">
                            {isWorkspaceOwner
                                ? `Atingiu o limite de ${splitQuota.limit} grupos ativos do seu plano.`
                                : `Atingiu o limite de ${splitQuota.limit} grupos ativos do plano do titular. Peça ao titular do espaço para fazer upgrade.`}
                            {isWorkspaceOwner && (
                                <a href="/planos" className="ml-2 font-bold underline hover:text-amber-800 dark:hover:text-amber-300 cursor-pointer">
                                    Fazer Upgrade
                                </a>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[200px]">
                        <input
                            type="text"
                            placeholder="Buscar..."
                            aria-label="Buscar grupos"
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
                            aria-label="Filtrar por tipo"
                            className="text-sm bg-transparent border-none text-gray-600 dark:text-gray-300 focus:ring-0 cursor-pointer"
                        >
                            <option value="todos">Todos Tipos</option>
                            <option value="fixed">Recorrente</option>
                            <option value="temporary">Temp.</option>
                        </select>
                        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1"></div>
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            aria-label="Filtrar por situação"
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
                            aria-label="Visualização em Cards"
                        >
                            <LayoutGridIcon className="h-5 w-5" />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                            title="Visualização em Lista"
                            aria-label="Visualização em Lista"
                        >
                            <ListIcon className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="flex gap-2 ml-auto sm:ml-0">
                        <button
                            onClick={() => setIsJoinModalOpen(true)}
                            disabled={!canCreateSplitGroup(activeWorkspaceRole)}
                            className="bg-white dark:bg-dark-200 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-sm hover:bg-gray-50 dark:hover:bg-dark-300 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <LoginIcon className="mr-2 h-4 w-4" />
                            Entrar
                        </button>
                        <button
                            onClick={openCreateModal}
                            disabled={!canCreateGroup}
                            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-md transition-colors whitespace-nowrap ${
                                canCreateGroup
                                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
                                    : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                            }`}
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
                    {isActiveTruncated && (
                        <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                            Há mais grupos ativos do que o limite seguro de leitura. Alguns não aparecem nesta lista.
                        </p>
                    )}
                    {viewMode === 'card' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {filteredGroups.map(group => (
                                <SplitGroupCard
                                    key={group.id}
                                    group={group}
                                    myParticipant={myParticipants.get(group.id) ?? null}
                                    onClick={() => onSelectGroup(group.id)}
                                    {...actionsOf(group)}
                                />
                            ))}
                        </div>
                    ) : (
                        <SplitGroupList
                            groups={filteredGroups}
                            myParticipants={myParticipants}
                            onSelectGroup={onSelectGroup}
                            actionsOf={actionsOf}
                        />
                    )}

                    {filterStatus !== 'ativos' && hasNextPage && (
                        <div className="mt-6 flex justify-center">
                            <button
                                type="button"
                                onClick={() => fetchNextPage()}
                                disabled={isFetchingNextPage}
                                className="rounded-xl border border-border px-5 py-2.5 text-sm font-bold text-on-surface disabled:opacity-60"
                            >
                                {isFetchingNextPage ? 'Carregando…' : 'Carregar mais grupos'}
                            </button>
                        </div>
                    )}

                    {filteredGroups.length === 0 && (
                        <div className="text-center py-20 bg-gray-50 dark:bg-dark-200/50 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                            <p className="text-gray-500 dark:text-gray-400">Nenhum registro encontrado.</p>
                            <div className="mt-4 flex gap-3 justify-center">
                                <button
                                    onClick={openCreateModal}
                                    disabled={!canCreateGroup}
                                    className={`font-medium ${
                                        canCreateGroup
                                            ? 'text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer'
                                            : 'text-gray-400 cursor-not-allowed'
                                    }`}
                                >
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
                onSave={handleSaveGroup}
                groupToEdit={groupToEdit}
                initialBusinessType={isPJ ? businessTab : undefined}
            />

            <JoinGroupModal
                isOpen={isJoinModalOpen}
                onClose={() => setIsJoinModalOpen(false)}
                onSuccess={(groupId) => onSelectGroup(groupId)}
            />

            {groupToArchive && (
                <ConfirmationModal
                    isOpen={!!groupToArchive}
                    onClose={() => setGroupToArchive(null)}
                    onConfirm={() => handleLifecycle(groupToArchive, 'archive')}
                    title="Arquivar Grupo"
                    message={`Arquivar "${groupToArchive.name}"? O grupo e todo o histórico continuam disponíveis para consulta, e uma vaga do plano é liberada. Só é possível arquivar sem despesas, rateios ou reembolsos em aberto.`}
                    confirmLabel="Confirmar Arquivamento"
                    isBusy={archiveGroupMutation.isPending}
                    error={lifecycleError}
                />
            )}

            {groupToReactivate && (
                <ConfirmationModal
                    isOpen={!!groupToReactivate}
                    onClose={() => setGroupToReactivate(null)}
                    onConfirm={() => handleLifecycle(groupToReactivate, 'reactivate')}
                    title="Reativar Grupo"
                    message={`Reativar "${groupToReactivate.name}"? Ele volta para os grupos ativos e ocupa uma vaga do plano.`}
                    confirmLabel="Confirmar Reativação"
                    isBusy={reactivateGroupMutation.isPending}
                    error={lifecycleError}
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
