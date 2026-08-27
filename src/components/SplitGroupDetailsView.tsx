
import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useSplitGroup, useSplitBills, useSplitParticipants, useSplitGroupShares, useCreateSplitBill, useUpdateSplitShare, useUpdateSplitBill, useDeleteSplitBill, useUpdateSplitGroup, useUpdateSplitBillStatus } from '../modules/split-bills/hooks.ts';
import { BackIcon, PlusIcon, DynamicIcon, SettingsIcon, ListIcon, ChartBarIcon, UsersIcon, EditIcon, CheckIcon, WarningIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { Transaction, CreditCard, SplitBill, SplitShare, SplitGroup } from '../types.ts';
import SplitBillFormModal from './SplitBillFormModal.tsx';
import SplitBillDetailsModal from './SplitBillDetailsModal.tsx';
import SplitGroupCharts from './SplitGroupCharts.tsx';
import SplitGroupSettingsModal from './SplitGroupSettingsModal.tsx';
import SplitGroupFormModal from './SplitGroupFormModal.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface SplitGroupDetailsViewProps {
    groupId: string;
    onBack: () => void;
    onAddTransaction: (transaction: Omit<Transaction, 'id'>) => void;
    onAddTransactions: (transactions: Omit<Transaction, 'id'>[]) => void;
    creditCards: CreditCard[];
}

const SplitGroupDetailsView: React.FC<SplitGroupDetailsViewProps> = ({ 
    groupId, onBack, onAddTransaction, onAddTransactions, creditCards 
}) => {
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';

    const { data: group, isLoading: isGroupLoading } = useSplitGroup(groupId);
    const {
        data: bills,
        isLoading: isBillsLoading,
        isTruncated: areBillsTruncated,
    } = useSplitBills(groupId);
    const { data: participants } = useSplitParticipants(groupId);
    const {
        data: shares,
        isLoading: isSharesLoading,
        isTruncated: areSharesTruncated,
    } = useSplitGroupShares(groupId);
    
    const createBillMutation = useCreateSplitBill();
    const updateBillMutation = useUpdateSplitBill();
    const deleteBillMutation = useDeleteSplitBill();
    const updateShareMutation = useUpdateSplitShare();
    const updateGroupMutation = useUpdateSplitGroup();
    const updateBillStatusMutation = useUpdateSplitBillStatus();

    const [activeTab, setActiveTab] = useState<'bills' | 'charts'>('bills');
    const { playSound } = useTheme();
    const MotionDiv = motion.div as any;

    // Modal States
    const [isBillFormOpen, setIsBillFormOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isEditGroupOpen, setIsEditGroupOpen] = useState(false);
    
    const [billToView, setBillToView] = useState<SplitBill | null>(null);
    const [billToEdit, setBillToEdit] = useState<SplitBill | null>(null);

    // Logic
    const myParticipant = useMemo(() => {
        if (!participants) return null;
        return participants.find(p => p.nomeExibicao === 'Você');
    }, [participants]);

    const isOwner = myParticipant?.papel === 'dono';
    const isViewer = myParticipant?.papel === 'visualizador';
    const isReimbursementGroup = isPJ && group?.businessType === 'reembolso';

    const summary = useMemo(() => {
        if (!bills || !shares || !participants || !myParticipant) return { paid: 0, received: 0, owed: 0, total: 0, receivable: 0 };

        const total = bills.reduce((acc, b) => acc + (b.valorReal || 0), 0);
        const owed = shares
            .filter(s => s.participantId === myParticipant.id && s.status === 'aPagar')
            .reduce((acc, s) => acc + s.valorDevido, 0);
        const myBills = bills.filter(b => b.pagadorPrincipalId === myParticipant.id);
        const paid = myBills.reduce((acc, b) => acc + (b.valorReal || 0), 0);
        const myBillIds = myBills.map(b => b.id);
        const receivable = shares
            .filter(s => myBillIds.includes(s.billId) && s.participantId !== myParticipant.id && s.status === 'aPagar')
            .reduce((acc, s) => acc + s.valorDevido, 0);

        return { paid, received: 0, owed, total, receivable };
    }, [bills, shares, participants, myParticipant]);

    if (isGroupLoading || !group || !participants) {
         return (
             <div className="flex items-center justify-center h-full">
                 <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
             </div>
         );
    }

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    const handleCreateBill = (bill: SplitBill, newShares: SplitShare[], integrationData?: any) => {
        createBillMutation.mutate({ bill, shares: newShares });
        // For standard rateio groups, integration might happen here or later
        if (!isReimbursementGroup) {
            handleIntegration(integrationData, bill);
        }
    };

    const handleUpdateBill = (bill: SplitBill, newShares: SplitShare[], integrationData?: any) => {
        updateBillMutation.mutate({ bill, shares: newShares });
        playSound('success');
    };

    const handleDeleteBill = (billId: string) => {
        deleteBillMutation.mutate({ billId, groupId });
        playSound('success');
    };

    const handleUpdateGroup = (updatedGroup: SplitGroup) => {
        updateGroupMutation.mutate(updatedGroup);
        playSound('success');
    };

    const handleIntegration = (integrationData: any, bill: SplitBill) => {
        if (integrationData) {
            if (integrationData.type === 'parcelado') {
                const card = creditCards.find(c => c.id === integrationData.cardId);
                if (card && integrationData.installments) {
                    const totalInstallments = integrationData.installments;
                    const { installmentValue, remainder } = integrationData;
                    
                    const iVal = parseFloat((integrationData.value / totalInstallments).toFixed(2));
                    const rem = parseFloat((integrationData.value - (iVal * totalInstallments)).toFixed(2));

                    const purchaseDate = new Date(integrationData.date);
                    const closingDay = card.closingDay;
                    let startMonthOffset = purchaseDate.getDate() > closingDay ? 1 : 0;

                    const newTransactions: Omit<Transaction, 'id'>[] = [];
                    for (let i = 0; i < totalInstallments; i++) {
                        const isLast = i === totalInstallments - 1;
                        const currentVal = isLast ? parseFloat((iVal + rem).toFixed(2)) : iVal;
                        const dueDate = new Date(purchaseDate.getFullYear(), purchaseDate.getMonth() + startMonthOffset + i, card.dueDay);
                        
                        newTransactions.push({
                            type: 'parcelado',
                            description: `${integrationData.description} (Grupo: ${group.nome})`,
                            category: integrationData.category,
                            value: currentVal,
                            date: dueDate.toISOString().split('T')[0],
                            installments: totalInstallments,
                            currentInstallment: i + 1,
                            cardId: card.id,
                            isPaid: false
                        });
                    }
                    onAddTransactions(newTransactions);
                }
            } else {
                onAddTransaction({
                    ...integrationData,
                    description: `${integrationData.description} (Grupo: ${group.nome})`
                });
            }
        }
        playSound('success');
    }

    const handleUpdateShareStatus = (share: SplitShare, newStatus: any) => {
        updateShareMutation.mutate({ ...share, status: newStatus, valorPago: newStatus === 'pagoAoPagadorPrincipal' ? share.valorDevido : 0 });
        playSound('success');
    };

    const handleReimbursementAction = (bill: SplitBill, action: 'approve' | 'pay') => {
        if (action === 'approve') {
            updateBillStatusMutation.mutate({ billId: bill.id, status: 'aprovado' as any, groupId: group.id });
            playSound('success');
        } else if (action === 'pay') {
            // Mark as paid
            updateBillStatusMutation.mutate({ billId: bill.id, status: 'pago' as any, groupId: group.id });
            
            // Create actual company expense
            const payer = participants.find(p => p.id === bill.pagadorPrincipalId);
            onAddTransaction({
                type: 'despesa',
                description: `${bill.descricao} (Reembolso: ${payer?.nomeExibicao})`,
                value: bill.valorReal || 0,
                date: new Date().toISOString().split('T')[0],
                category: 'Reembolso',
                isPaid: true,
                paymentMethod: 'Transferência'
            });
            playSound('success');
        }
    };

    const handleListDelete = (billId: string) => {
        if (isOwner) {
            const confirmText = prompt('Para confirmar a exclusão, digite "DELETAR":');
            if (confirmText?.toUpperCase() === 'DELETAR') {
                handleDeleteBill(billId);
            }
        } else {
            if (confirm('Tem certeza que deseja excluir esta despesa?')) {
                handleDeleteBill(billId);
            }
        }
    };

    const getBillShares = (billId: string) => shares?.filter(s => s.billId === billId) || [];

    const mockCategories = [
        { id: 1, name: 'Alimentação', type: 'despesa' },
        { id: 2, name: 'Transporte', type: 'despesa' },
        { id: 3, name: 'Moradia', type: 'despesa' },
        { id: 4, name: 'Lazer', type: 'despesa' },
        { id: 5, name: 'Outros', type: 'despesa' },
    ];

    // --- REIMBURSEMENT STATUS BADGES ---
    const getReimbursementBadge = (status: string | undefined) => {
        if (!status || status === 'solicitado') return <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-xs font-bold uppercase">Solicitado</span>;
        if (status === 'aprovado') return <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold uppercase">Aprovado</span>;
        if (status === 'pago') return <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs font-bold uppercase">Pago</span>;
        return null;
    };

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
                    {isOwner && (
                        <button 
                            onClick={() => setIsEditGroupOpen(true)}
                            className="p-2 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition-colors bg-gray-100 dark:bg-dark-200 rounded-lg"
                            title="Editar Grupo"
                        >
                            <EditIcon className="h-5 w-5" />
                        </button>
                    )}
                    <button 
                        onClick={() => setIsSettingsOpen(true)}
                        className="p-2 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition-colors bg-gray-100 dark:bg-dark-200 rounded-lg"
                        title={isPJ ? "Sócios e Configurações" : "Configurações e Participantes"}
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
                            style={{ backgroundColor: group.corPrincipal }}
                        >
                             {group.emojiOpcional ? <span className="text-3xl">{group.emojiOpcional}</span> : <DynamicIcon name={group.icone} size={32} />}
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-1">{group.nome}</h1>
                            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                                 <span className="flex items-center gap-1">
                                     <UsersIcon className="h-4 w-4" /> 
                                     {participants?.length || 0} {isPJ ? 'colaboradores' : 'participantes'}
                                 </span>
                                 <span>•</span>
                                 <span className="uppercase font-bold text-xs bg-gray-100 dark:bg-dark-200 px-2 py-0.5 rounded text-gray-600 dark:text-gray-300">
                                     {isReimbursementGroup ? 'Reembolso' : group.tipo}
                                 </span>
                            </div>
                        </div>
                    </div>

                    {!isViewer && (
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

                {/* Financial Summary */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-xl border border-gray-100 dark:border-gray-700">
                        <span className="text-xs text-gray-500 uppercase font-bold">{isReimbursementGroup ? 'Total Solicitado' : 'Total Grupo'}</span>
                        <p className="text-lg font-bold text-gray-800 dark:text-white mt-1">{formatCurrency(summary.total)}</p>
                    </div>
                    {isReimbursementGroup ? (
                        <div className="bg-orange-50 dark:bg-orange-900/10 p-3 rounded-xl border border-orange-100 dark:border-orange-900/30">
                            <span className="text-xs text-orange-600 uppercase font-bold">Pendente Pagamento</span>
                            <p className="text-lg font-bold text-orange-800 dark:text-orange-300 mt-1">
                                {/* Sum of Approved but Not Paid */}
                                {formatCurrency(bills.filter(b => b.reimbursementStatus === 'aprovado' || b.reimbursementStatus === 'solicitado').reduce((acc, b) => acc + (b.valorReal || 0), 0))}
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="bg-green-50 dark:bg-green-900/10 p-3 rounded-xl border border-green-100 dark:border-green-900/30">
                                <span className="text-xs text-green-600 uppercase font-bold">Eu Paguei</span>
                                <p className="text-lg font-bold text-green-800 dark:text-green-300 mt-1">{formatCurrency(summary.paid)}</p>
                            </div>
                            <div className="bg-blue-50 dark:bg-blue-900/10 p-3 rounded-xl border border-blue-100 dark:border-blue-900/30">
                                <span className="text-xs text-blue-600 uppercase font-bold">A Receber</span>
                                <p className="text-lg font-bold text-blue-800 dark:text-blue-300 mt-1">{formatCurrency(summary.receivable)}</p>
                            </div>
                            <div className="bg-red-50 dark:bg-red-900/10 p-3 rounded-xl border border-red-100 dark:border-red-900/30">
                                <span className="text-xs text-red-600 uppercase font-bold">Minha Dívida</span>
                                <p className="text-lg font-bold text-red-800 dark:text-red-300 mt-1">{formatCurrency(summary.owed)}</p>
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
                        {/*
                          O teto de leitura é declarado, nunca silencioso: os
                          totais deste grupo saem desta lista, e um número
                          financeiro parcial exibido como completo é pior que
                          um aviso.
                        */}
                        {(areBillsTruncated || areSharesTruncated) && (
                            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                                Este grupo atingiu o limite seguro de leitura. Os totais exibidos
                                não cobrem todos os lançamentos.
                            </p>
                        )}
                        {bills && bills.length > 0 ? (
                            bills.map((bill) => {
                                const payer = participants.find(p => p.id === bill.pagadorPrincipalId);
                                const isMyRequest = payer?.id === myParticipant?.id;
                                const status = bill.reimbursementStatus || 'solicitado';

                                return (
                                    <MotionDiv 
                                        key={bill.id}
                                        variants={itemVariants} 
                                        onClick={() => setBillToView(bill)}
                                        className="bg-white dark:bg-dark-100 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors cursor-pointer group relative gap-4"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="flex flex-col items-center justify-center w-12 h-12 bg-gray-100 dark:bg-dark-200 rounded-lg text-gray-500 text-xs font-bold group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                                                 <span>{new Date(bill.createdAt || '').getDate()}</span>
                                                 <span className="uppercase text-[10px]">{new Date(bill.createdAt || '').toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}</span>
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-gray-800 dark:text-white">{bill.descricao}</h4>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                                    <span className="px-1.5 py-0.5 bg-gray-200 dark:bg-dark-300 rounded text-[10px]">{bill.categoriaNome || 'Geral'}</span>
                                                    <span>• {isReimbursementGroup ? 'Solicitante:' : 'Pago por'} <strong>{payer?.nomeExibicao || 'Alguém'}</strong></span>
                                                </p>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center justify-between md:justify-end gap-4 w-full md:w-auto">
                                            {isReimbursementGroup ? (
                                                <div className="flex items-center gap-3">
                                                    {getReimbursementBadge(status)}
                                                    
                                                    {/* Reimbursement Actions */}
                                                    {isOwner && status === 'solicitado' && (
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); handleReimbursementAction(bill, 'approve'); }}
                                                            className={`${actionButtonBase} bg-blue-600 text-white hover:bg-blue-700`}
                                                        >
                                                            Aprovar
                                                        </button>
                                                    )}
                                                    {isOwner && status === 'aprovado' && (
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); handleReimbursementAction(bill, 'pay'); }}
                                                            className={`${actionButtonBase} bg-green-600 text-white hover:bg-green-700`}
                                                        >
                                                            Pagar
                                                        </button>
                                                    )}
                                                </div>
                                            ) : (
                                                <div>
                                                    {bill.statusPagamento === 'pago' ? (
                                                        <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold">QUITADO</span>
                                                    ) : (
                                                        <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-bold">PENDENTE</span>
                                                    )}
                                                </div>
                                            )}

                                            <p className="font-bold text-gray-800 dark:text-white text-lg">{formatCurrency(bill.valorReal || 0)}</p>
                                            
                                            {/* Action Buttons on Hover */}
                                            {isOwner && (
                                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute right-4 top-1/2 -translate-y-1/2 bg-white dark:bg-dark-100 p-1 shadow-sm rounded-lg border border-gray-100 dark:border-gray-700">
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); setBillToEdit(bill); setIsBillFormOpen(true); }}
                                                        className="p-1.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-dark-200 rounded-md transition-colors"
                                                        title="Editar"
                                                    >
                                                        <EditIcon className="w-4 h-4" />
                                                    </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleListDelete(bill.id); }}
                                                        className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                                                        title="Excluir"
                                                    >
                                                        <DynamicIcon name="Trash" size={16} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </MotionDiv>
                                );
                            })
                        ) : (
                             <div className="text-center py-20 bg-gray-50 dark:bg-dark-200/50 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                                <p className="text-gray-500 dark:text-gray-400">
                                    {isReimbursementGroup ? 'Nenhuma solicitação de reembolso.' : 'Nenhuma despesa registrada neste grupo.'}
                                </p>
                            </div>
                        )}
                    </MotionDiv>
                )}
                
                {activeTab === 'charts' && (
                    <SplitGroupCharts 
                        bills={bills || []} 
                        participants={participants} 
                        shares={shares || []} 
                    />
                )}
            </div>

            <SplitBillFormModal 
                isOpen={isBillFormOpen} 
                onClose={() => { setIsBillFormOpen(false); setBillToEdit(null); }}
                onSave={(bill, shares, integrationData) => {
                    if (billToEdit) {
                        handleUpdateBill(bill, shares, integrationData);
                    } else {
                        handleCreateBill(bill, shares, integrationData);
                    }
                }}
                groupId={groupId}
                participants={participants}
                categories={mockCategories}
                creditCards={creditCards}
                billToEdit={billToEdit}
                sharesToEdit={billToEdit ? getBillShares(billToEdit.id) : null}
                isReimbursementGroup={isReimbursementGroup}
            />

            {billToView && (
                <SplitBillDetailsModal 
                    isOpen={!!billToView}
                    onClose={() => setBillToView(null)}
                    bill={billToView}
                    participants={participants}
                    shares={getBillShares(billToView.id)}
                    onUpdateShareStatus={handleUpdateShareStatus}
                    onEditBill={(bill) => {
                        setBillToEdit(bill);
                        setIsBillFormOpen(true);
                    }}
                    onDeleteBill={handleDeleteBill}
                    isOwner={isOwner}
                />
            )}

            <SplitGroupSettingsModal 
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                group={group}
                participants={participants}
                isOwner={isOwner}
                onGroupDeleted={onBack}
                onGroupLeft={onBack}
                currentUserId={myParticipant?.id}
            />

            <SplitGroupFormModal 
                isOpen={isEditGroupOpen}
                onClose={() => setIsEditGroupOpen(false)}
                onSave={handleUpdateGroup}
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
