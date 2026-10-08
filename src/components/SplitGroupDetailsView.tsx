import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
    SPLIT_KEYS,
    useApproveSplitReimbursement,
    useArchiveSplitGroup,
    useReactivateSplitGroup,
    useUpdateSplitGroup,
    useCancelSplitReimbursement,
    useRejectSplitReimbursement,
    useReverseReimbursementPayment,
    useSplitBills,
    useSplitGroup,
    useSplitIntentKey,
    useSplitParticipants,
    useSplitReimbursements,
} from '../modules/split-bills/hooks.ts';
import { getSplitGroup, listSplitShares } from '../modules/split-bills/api.ts';
import {
    REIMBURSEMENT_STATUS_BADGE,
    REIMBURSEMENT_STATUS_LABELS,
    canCancelReimbursement,
    canEditBill,
    canVoidBill,
    formatSplitCents,
    groupPermissions,
    isWorkspaceAdmin,
    myParticipantOf,
    participantName,
    splitErrorView,
    type WorkspaceMemberName,
} from '../modules/split-bills/presentation.ts';
import type { SplitBill, SplitReimbursement, SplitShare } from '../modules/split-bills/types.ts';
import { dayBadgeParts } from '../modules/recurring/presentation.ts';
import { useWorkspaceMembers } from '../modules/workspaces/hooks.ts';
import type { CreditCard } from '../modules/cards/types.ts';
import { BackIcon, PlusIcon, DynamicIcon, SettingsIcon, ListIcon, ChartBarIcon, UsersIcon, EditIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import SplitBillFormModal from './SplitBillFormModal.tsx';
import SplitBillDetailsModal from './SplitBillDetailsModal.tsx';
import SplitGroupCharts from './SplitGroupCharts.tsx';
import SplitGroupSettingsModal, { type SplitMemberOption } from './SplitGroupSettingsModal.tsx';
import SplitGroupFormModal, { type SplitGroupSave } from './SplitGroupFormModal.tsx';
import SplitReimbursementPayModal from './SplitReimbursementPayModal.tsx';
import ConfirmationModal from './ConfirmationModal.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface SplitGroupDetailsViewProps {
    groupId: string;
    onBack: () => void;
    creditCards: CreditCard[];
}

type ReimbursementAction = 'approve' | 'reject' | 'cancel' | 'reverse';

/** Selo da data civil (dia e mês), sem fuso. */
const DateBadge: React.FC<{ day: string }> = ({ day }) => {
    const parts = dayBadgeParts(day);
    return (
        <div className="flex flex-col items-center justify-center w-12 h-12 bg-gray-100 dark:bg-dark-200 rounded-lg text-gray-500 text-xs font-bold group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
             <span>{parts.day}</span>
             <span className="uppercase text-[10px]">{parts.month}</span>
        </div>
    );
};

const SplitGroupDetailsView: React.FC<SplitGroupDetailsViewProps> = ({
    groupId, onBack, creditCards
}) => {
    const { activeWorkspace, activeWorkspaceRole } = useWorkspace();
    const { user } = useAuth();
    const isPJ = activeWorkspace.type === 'PJ';
    const viewer = { uid: user?.uid, role: activeWorkspaceRole };
    const queryClient = useQueryClient();

    const { data: group, isLoading: isGroupLoading } = useSplitGroup(groupId);
    const isReimbursementGroup = group?.businessMode === 'reimbursement';
    const { data: participants, isTruncated: areParticipantsTruncated } = useSplitParticipants(groupId);
    const {
        data: bills,
        hasNextPage: hasMoreBills,
        fetchNextPage: fetchMoreBills,
        isFetchingNextPage: isFetchingBills,
    } = useSplitBills(groupId, Boolean(group) && !isReimbursementGroup);
    const {
        data: reimbursements,
        hasNextPage: hasMoreReimbursements,
        fetchNextPage: fetchMoreReimbursements,
        isFetchingNextPage: isFetchingReimbursements,
    } = useSplitReimbursements(groupId, Boolean(group) && isReimbursementGroup);
    const { data: workspaceMembers } = useWorkspaceMembers(activeWorkspace.id);

    const updateGroupMutation = useUpdateSplitGroup();
    const archiveGroupMutation = useArchiveSplitGroup();
    const reactivateGroupMutation = useReactivateSplitGroup();
    const approve = useApproveSplitReimbursement();
    const reject = useRejectSplitReimbursement();
    const cancel = useCancelSplitReimbursement();
    const reverse = useReverseReimbursementPayment();
    const intent = useSplitIntentKey();

    const [activeTab, setActiveTab] = useState<'bills' | 'charts'>('bills');
    const { playSound } = useTheme();
    const MotionDiv = motion.div as any;

    // Modal States
    const [isBillFormOpen, setIsBillFormOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isEditGroupOpen, setIsEditGroupOpen] = useState(false);

    const [billToView, setBillToView] = useState<SplitBill | null>(null);
    const [billToEdit, setBillToEdit] = useState<{ bill: SplitBill; shares: SplitShare[] } | null>(null);
    const [reimbursementToPay, setReimbursementToPay] = useState<SplitReimbursement | null>(null);
    const [pendingAction, setPendingAction] = useState<{ action: ReimbursementAction; item: SplitReimbursement } | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    const members = useMemo(() => new Map<string, WorkspaceMemberName>((workspaceMembers ?? [])
        .map(m => [m.uid, { uid: m.uid, displayName: m.displayName, email: m.email }])), [workspaceMembers]);
    const memberOptions: SplitMemberOption[] = useMemo(() => (workspaceMembers ?? [])
        .map(m => ({ uid: m.uid, displayName: m.displayName, email: m.email, role: m.role })), [workspaceMembers]);
    const myParticipant = myParticipantOf(participants, user?.uid);
    const permissions = groupPermissions(viewer, group, myParticipant);

    if (isGroupLoading || !group || !participants) {
         return (
             <div className="flex items-center justify-center h-full">
                 <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
             </div>
         );
    }

    const byId = new Map(participants.map(p => [p.id, p]));
    const nameOf = (id: string) => participantName(byId.get(id), members);
    const balances = myParticipant?.balances;

    const handleSaveGroup = async (save: SplitGroupSave) => {
        let version = group.version;
        if (Object.keys(save.changes).length > 0) {
            const payload = { groupId: group.id, expectedUpdatedAt: version, changes: save.changes };
            await updateGroupMutation.mutateAsync({ payload, idempotencyKey: intent.keyFor('updateSplitGroup', payload) });
            version = (await getSplitGroup(activeWorkspace.id, group.id))?.version ?? version;
        }
        if (save.status !== group.status) {
            const payload = { groupId: group.id, expectedUpdatedAt: version };
            const archive = save.status === 'archived';
            await (archive ? archiveGroupMutation : reactivateGroupMutation).mutateAsync({
                payload,
                idempotencyKey: intent.keyFor(archive ? 'archiveSplitGroup' : 'reactivateSplitGroup', payload),
            });
        }
        intent.reset();
        playSound('success');
    };

    /** Edição pede os rateios gravados (o formulário preserva o método). */
    const openEdit = async (bill: SplitBill, shares?: SplitShare[]) => {
        const loaded = shares ?? (await queryClient.fetchQuery({
            queryKey: SPLIT_KEYS.shares(activeWorkspace.id, bill.id),
            queryFn: () => listSplitShares(activeWorkspace.id, bill.id),
        })).items;
        setBillToEdit({ bill, shares: loaded });
        setIsBillFormOpen(true);
    };

    const runReimbursementAction = async () => {
        if (!pendingAction) return;
        const { action, item } = pendingAction;
        const payload = { reimbursementId: item.id, expectedUpdatedAt: item.version };
        const mutation = action === 'approve' ? approve : action === 'reject' ? reject : action === 'cancel' ? cancel : reverse;
        const operation = action === 'approve' ? 'approveSplitReimbursement' : action === 'reject' ? 'rejectSplitReimbursement'
            : action === 'cancel' ? 'cancelSplitReimbursement' : 'reverseReimbursementPayment';
        setActionError(null);
        try {
            await mutation.mutateAsync({ payload, idempotencyKey: intent.keyFor(operation, payload) });
            intent.reset();
            playSound('success');
            setPendingAction(null);
        } catch (failure) {
            setActionError(splitErrorView(failure).message);
        }
    };

    const actionCopy: Record<ReimbursementAction, { title: string; message: string; confirm: string }> = {
        approve: { title: 'Aprovar Reembolso', message: 'Aprovar este pedido de reembolso? Ele fica pronto para pagamento.', confirm: 'Aprovar' },
        reject: { title: 'Rejeitar Reembolso', message: 'Rejeitar este pedido de reembolso? Ele sai dos valores pendentes.', confirm: 'Rejeitar' },
        cancel: { title: 'Cancelar Pedido', message: 'Cancelar este pedido de reembolso? Ele sai dos valores pendentes.', confirm: 'Cancelar Pedido' },
        reverse: { title: 'Estornar Pagamento', message: 'Estornar o pagamento? Um lançamento de estorno é criado na mesma conta do Caixa e o reembolso volta para aprovado.', confirm: 'Estornar Pagamento' },
    };

    const isActionBusy = approve.isPending || reject.isPending || cancel.isPending || reverse.isPending;
    const admin = isWorkspaceAdmin(activeWorkspaceRole);

    // Animation Variants
    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: {
                staggerChildren: 0.05
            }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0 }
    };

    const actionButtonBase = "px-3 py-1.5 rounded text-xs font-bold uppercase transition-colors shadow-sm";

    return (
        <div className="flex flex-col h-full animate-fade-in">
            {/* Header Navigation */}
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
                 <button
                    onClick={() => {
                        playSound('click');
                        onBack();
                    }}
                    className="flex items-center gap-2 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white transition-colors"
                >
                    <BackIcon className="h-5 w-5" />
                    <span className="text-sm font-medium">Voltar para Grupos</span>
                </button>
                <div className="flex gap-2">
                    {permissions.canManage && group.status === 'active' && (
                        <button
                            onClick={() => { intent.reset(); setIsEditGroupOpen(true); }}
                            className="p-2 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition-colors bg-gray-100 dark:bg-dark-200 rounded-lg"
                            title="Editar Grupo"
                            aria-label="Editar Grupo"
                        >
                            <EditIcon className="h-5 w-5" />
                        </button>
                    )}
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="p-2 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition-colors bg-gray-100 dark:bg-dark-200 rounded-lg"
                        title={isPJ ? "Sócios e Configurações" : "Configurações e Participantes"}
                        aria-label={isPJ ? "Sócios e Configurações" : "Configurações e Participantes"}
                    >
                        <SettingsIcon className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* Hero Section */}
            <div className="bg-white dark:bg-dark-100 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 mb-6">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-6">
                    <div className="flex items-center gap-5">
                        <div
                            className="w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-md text-3xl"
                            style={{ backgroundColor: group.visual.color }}
                        >
                             {group.visual.emoji ? <span className="text-3xl">{group.visual.emoji}</span> : <DynamicIcon name={group.visual.icon} size={32} />}
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-1">{group.name}</h1>
                            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                                 <span className="flex items-center gap-1">
                                     <UsersIcon className="h-4 w-4" />
                                     {group.counters.activeParticipantCount} {isPJ ? 'colaboradores' : 'participantes'}
                                 </span>
                                 <span>•</span>
                                 <span className="uppercase font-bold text-xs bg-gray-100 dark:bg-dark-200 px-2 py-0.5 rounded text-gray-600 dark:text-gray-300">
                                     {isReimbursementGroup ? 'Reembolso' : group.groupType === 'fixed' ? 'fixo' : 'temporario'}
                                 </span>
                                 {group.status !== 'active' && (
                                     <span className="uppercase font-bold text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500">Encerrado</span>
                                 )}
                            </div>
                        </div>
                    </div>

                    {permissions.canWrite && (
                        <button
                            onClick={() => {
                                setBillToEdit(null);
                                setIsBillFormOpen(true);
                            }}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center shadow-md transition-colors whitespace-nowrap"
                        >
                            <PlusIcon className="mr-2 h-4 w-4" />
                            {isReimbursementGroup ? 'Solicitar Reembolso' : 'Nova Despesa'}
                        </button>
                    )}
                </div>

                {/* Financial Summary — agregados do servidor */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-xl border border-gray-100 dark:border-gray-700">
                        <span className="text-xs text-gray-500 uppercase font-bold">{isReimbursementGroup ? 'Total Solicitado' : 'Total Grupo'}</span>
                        <p className="text-lg font-bold text-gray-800 dark:text-white mt-1">{formatSplitCents(isReimbursementGroup ? group.totals.reimbursementTotalCents : group.totals.billedCents)}</p>
                    </div>
                    {isReimbursementGroup ? (
                        <div className="bg-orange-50 dark:bg-orange-900/10 p-3 rounded-xl border border-orange-100 dark:border-orange-900/30">
                            <span className="text-xs text-orange-600 uppercase font-bold">Pendente Pagamento</span>
                            <p className="text-lg font-bold text-orange-800 dark:text-orange-300 mt-1">
                                {formatSplitCents(group.totals.reimbursementPendingCents)}
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="bg-green-50 dark:bg-green-900/10 p-3 rounded-xl border border-green-100 dark:border-green-900/30">
                                <span className="text-xs text-green-600 uppercase font-bold">Eu Paguei</span>
                                <p className="text-lg font-bold text-green-800 dark:text-green-300 mt-1">{formatSplitCents(balances?.paidCents ?? 0)}</p>
                            </div>
                            <div className="bg-blue-50 dark:bg-blue-900/10 p-3 rounded-xl border border-blue-100 dark:border-blue-900/30">
                                <span className="text-xs text-blue-600 uppercase font-bold">A Receber</span>
                                <p className="text-lg font-bold text-blue-800 dark:text-blue-300 mt-1">{formatSplitCents(balances?.receivableOpenCents ?? 0)}</p>
                            </div>
                            <div className="bg-red-50 dark:bg-red-900/10 p-3 rounded-xl border border-red-100 dark:border-red-900/30">
                                <span className="text-xs text-red-600 uppercase font-bold">Minha Dívida</span>
                                <p className="text-lg font-bold text-red-800 dark:text-red-300 mt-1">{formatSplitCents(balances?.owesOpenCents ?? 0)}</p>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
                <button
                    onClick={() => setActiveTab('bills')}
                    className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'bills' ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                >
                    <ListIcon className="h-4 w-4" /> {isReimbursementGroup ? 'Solicitações' : 'Despesas'}
                </button>
                <button
                    onClick={() => setActiveTab('charts')}
                    className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'charts' ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
                >
                    <ChartBarIcon className="h-4 w-4" /> Gráficos
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {activeTab === 'bills' && (
                    <MotionDiv
                        className="space-y-4 pb-10"
                        variants={containerVariants}
                        initial="hidden"
                        animate="show"
                    >
                        {areParticipantsTruncated && (
                            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                                Este grupo tem mais participantes do que o limite seguro de leitura.
                            </p>
                        )}
                        {isReimbursementGroup ? (
                            reimbursements && reimbursements.length > 0 ? reimbursements.map((item) => {
                                const canAdminister = permissions.canAdministerReimbursements;
                                const canCancel = canCancelReimbursement(viewer, myParticipant, item) && group.status === 'active';
                                return (
                                    <MotionDiv
                                        key={item.id}
                                        variants={itemVariants}
                                        className="bg-white dark:bg-dark-100 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors group relative gap-4"
                                    >
                                        <div className="flex items-center gap-4">
                                            <DateBadge day={item.expenseDate} />
                                            <div>
                                                <h4 className="font-bold text-gray-800 dark:text-white">{item.description}</h4>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                                    <span className="px-1.5 py-0.5 bg-gray-200 dark:bg-dark-300 rounded text-[10px]">{item.category}</span>
                                                    <span>• Solicitante: <strong>{nameOf(item.requesterParticipantId)}</strong></span>
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between md:justify-end gap-4 w-full md:w-auto">
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className={`${REIMBURSEMENT_STATUS_BADGE[item.status]} px-2 py-0.5 rounded text-xs font-bold uppercase`}>{REIMBURSEMENT_STATUS_LABELS[item.status]}</span>
                                                {canAdminister && item.status === 'requested' && (
                                                    <button onClick={() => { setActionError(null); setPendingAction({ action: 'approve', item }); }} className={`${actionButtonBase} bg-blue-600 text-white hover:bg-blue-700`}>
                                                        Aprovar
                                                    </button>
                                                )}
                                                {canAdminister && item.status === 'approved' && (
                                                    <button onClick={() => setReimbursementToPay(item)} className={`${actionButtonBase} bg-green-600 text-white hover:bg-green-700`}>
                                                        Pagar
                                                    </button>
                                                )}
                                                {canAdminister && (item.status === 'requested' || item.status === 'approved') && (
                                                    <button onClick={() => { setActionError(null); setPendingAction({ action: 'reject', item }); }} className={`${actionButtonBase} bg-white text-red-600 border border-red-200 hover:bg-red-50`}>
                                                        Rejeitar
                                                    </button>
                                                )}
                                                {canCancel && (
                                                    <button onClick={() => { setActionError(null); setPendingAction({ action: 'cancel', item }); }} className={`${actionButtonBase} bg-white text-gray-600 border border-gray-200 hover:bg-gray-50`}>
                                                        Cancelar
                                                    </button>
                                                )}
                                                {canAdminister && item.status === 'paid' && (
                                                    <button onClick={() => { setActionError(null); setPendingAction({ action: 'reverse', item }); }} className={`${actionButtonBase} bg-white text-amber-700 border border-amber-200 hover:bg-amber-50`}>
                                                        Estornar Pagamento
                                                    </button>
                                                )}
                                            </div>
                                            <p className="font-bold text-gray-800 dark:text-white text-lg">{formatSplitCents(item.amountCents)}</p>
                                        </div>
                                    </MotionDiv>
                                );
                            }) : (
                                <div className="text-center py-20 bg-gray-50 dark:bg-dark-200/50 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                                    <p className="text-gray-500 dark:text-gray-400">Nenhuma solicitação de reembolso.</p>
                                </div>
                            )
                        ) : bills && bills.length > 0 ? (
                            bills.map((bill) => {
                                const editable = canEditBill(viewer, permissions, bill);
                                const voidable = canVoidBill(viewer, permissions, bill);
                                return (
                                    <MotionDiv
                                        key={bill.id}
                                        variants={itemVariants}
                                        onClick={() => setBillToView(bill)}
                                        className={`bg-white dark:bg-dark-100 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors cursor-pointer group relative gap-4 ${bill.status === 'voided' ? 'opacity-60' : ''}`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <DateBadge day={bill.expenseDate} />
                                            <div>
                                                <h4 className="font-bold text-gray-800 dark:text-white">{bill.description}</h4>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                                    <span className="px-1.5 py-0.5 bg-gray-200 dark:bg-dark-300 rounded text-[10px]">{bill.category}</span>
                                                    <span>• Pago por <strong>{nameOf(bill.payerParticipantId)}</strong></span>
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between md:justify-end gap-4 w-full md:w-auto">
                                            <div>
                                                {bill.status === 'voided' ? (
                                                    <span className="text-[10px] bg-gray-200 text-gray-700 px-2 py-0.5 rounded font-bold">ANULADA</span>
                                                ) : bill.status === 'settled' ? (
                                                    <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold">QUITADO</span>
                                                ) : (
                                                    <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-bold">PENDENTE</span>
                                                )}
                                            </div>

                                            <p className="font-bold text-gray-800 dark:text-white text-lg">{formatSplitCents(bill.amountCents)}</p>

                                            {/* Action Buttons on Hover */}
                                            {(editable || voidable) && (
                                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity absolute right-4 top-1/2 -translate-y-1/2 bg-white dark:bg-dark-100 p-1 shadow-sm rounded-lg border border-gray-100 dark:border-gray-700">
                                                    {editable && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); void openEdit(bill); }}
                                                            className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-dark-200 rounded-md transition-colors"
                                                            title="Editar"
                                                            aria-label="Editar"
                                                        >
                                                            <EditIcon className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                    {voidable && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setBillToView(bill); }}
                                                            className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                                                            title="Anular"
                                                            aria-label="Anular"
                                                        >
                                                            <DynamicIcon name="Trash" size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </MotionDiv>
                                );
                            })
                        ) : (
                             <div className="text-center py-20 bg-gray-50 dark:bg-dark-200/50 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                                <p className="text-gray-500 dark:text-gray-400">
                                    Nenhuma despesa registrada neste grupo.
                                </p>
                            </div>
                        )}
                        {((!isReimbursementGroup && hasMoreBills) || (isReimbursementGroup && hasMoreReimbursements)) && (
                            <div className="flex justify-center">
                                <button
                                    type="button"
                                    onClick={() => (isReimbursementGroup ? fetchMoreReimbursements() : fetchMoreBills())}
                                    disabled={isFetchingBills || isFetchingReimbursements}
                                    className="rounded-xl border border-border px-5 py-2.5 text-sm font-bold text-on-surface disabled:opacity-60"
                                >
                                    {isFetchingBills || isFetchingReimbursements ? 'Carregando…' : 'Carregar mais'}
                                </button>
                            </div>
                        )}
                    </MotionDiv>
                )}

                {activeTab === 'charts' && (
                    <SplitGroupCharts
                        group={group}
                        participants={participants}
                        members={members}
                    />
                )}
            </div>

            <SplitBillFormModal
                isOpen={isBillFormOpen}
                onClose={() => { setIsBillFormOpen(false); setBillToEdit(null); }}
                onSaved={() => playSound('success')}
                group={group}
                participants={participants}
                members={members}
                me={myParticipant}
                isWorkspaceAdmin={admin}
                creditCards={creditCards}
                billToEdit={billToEdit?.bill ?? null}
                sharesToEdit={billToEdit?.shares ?? null}
                isReimbursementGroup={isReimbursementGroup}
            />

            {billToView && (
                <SplitBillDetailsModal
                    isOpen={!!billToView}
                    onClose={() => setBillToView(null)}
                    bill={billToView}
                    participants={participants}
                    members={members}
                    me={myParticipant}
                    viewer={viewer}
                    permissions={permissions}
                    onEditBill={(bill, shares) => { void openEdit(bill, shares); }}
                />
            )}

            {reimbursementToPay && (
                <SplitReimbursementPayModal reimbursement={reimbursementToPay} onClose={() => setReimbursementToPay(null)} />
            )}

            {pendingAction && (
                <ConfirmationModal
                    isOpen={!!pendingAction}
                    onClose={() => setPendingAction(null)}
                    onConfirm={runReimbursementAction}
                    title={actionCopy[pendingAction.action].title}
                    message={actionCopy[pendingAction.action].message}
                    confirmLabel={actionCopy[pendingAction.action].confirm}
                    isBusy={isActionBusy}
                    error={actionError}
                />
            )}

            <SplitGroupSettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                group={group}
                participants={participants}
                members={members}
                memberOptions={memberOptions}
                me={myParticipant}
                viewer={viewer}
                permissions={permissions}
                onGroupLeft={onBack}
            />

            <SplitGroupFormModal
                isOpen={isEditGroupOpen}
                onClose={() => setIsEditGroupOpen(false)}
                onSave={handleSaveGroup}
                groupToEdit={group}
            />

             <style>{`
                @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .animate-fade-in {
                    animation: fade-in 0.3s ease-out forwards;
                }
                 .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: rgba(156, 163, 175, 0.5);
                    border-radius: 20px;
                }
                .dark .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: rgba(75, 85, 99, 0.5);
                }
            `}</style>
        </div>
    );
};

export default SplitGroupDetailsView;
