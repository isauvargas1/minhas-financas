import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    useAddExternalSplitParticipant,
    useAddWorkspaceSplitParticipant,
    useArchiveSplitGroup,
    useCreateSplitInvite,
    useDeactivateSplitParticipant,
    useReactivateSplitGroup,
    useRevokeSplitInvite,
    useSplitIntentKey,
    useSplitInvites,
} from '../modules/split-bills/hooks.ts';
import { SPLIT_TEXT_LIMITS, toExternalParticipantPayload, toWorkspaceParticipantPayload } from '../modules/split-bills/payloads.ts';
import {
    GROUP_ROLE_LABELS,
    isWorkspaceAdmin,
    participantInitial,
    participantName,
    splitErrorView,
    type SplitGroupPermissions,
    type SplitViewer,
    type WorkspaceMemberName,
} from '../modules/split-bills/presentation.ts';
import type { SplitAssignableRole, SplitGroup, SplitParticipant } from '../modules/split-bills/types.ts';
import type { SplitInviteResult } from '../modules/split-bills/callables.ts';
import { CloseIcon, UsersIcon, LinkIcon, CopyIcon, DeleteIcon, WarningIcon, LogoutIcon, PlusIcon, RefreshIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useCardDialogFocus } from './cards/useCardDialogFocus.ts';

export interface SplitMemberOption extends WorkspaceMemberName {
    role: 'owner' | 'admin' | 'member' | 'viewer';
}

interface SplitGroupSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    group: SplitGroup;
    participants: SplitParticipant[];
    members: ReadonlyMap<string, WorkspaceMemberName>;
    memberOptions: SplitMemberOption[];
    me: SplitParticipant | null;
    viewer: SplitViewer;
    permissions: SplitGroupPermissions;
    onGroupLeft: () => void;
}

const SplitGroupSettingsModal: React.FC<SplitGroupSettingsModalProps> = (props) => {
    if (!props.isOpen) return null;
    return <SplitGroupSettings {...props} />;
};

const formatExpiry = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

const SplitGroupSettings: React.FC<SplitGroupSettingsModalProps> = ({
    onClose, group, participants, members, memberOptions, me, viewer, permissions, onGroupLeft
}) => {
    const [activeTab, setActiveTab] = useState<'participants' | 'invites'>('participants');
    const { playSound } = useTheme();
    const canManage = permissions.canManage;
    const isActive = group.status === 'active';
    const admin = isWorkspaceAdmin(viewer.role);

    // Hooks
    const { data: invites, isLoading: isInvitesLoading } = useSplitInvites(group.id, admin, canManage && activeTab === 'invites');
    const createInvite = useCreateSplitInvite();
    const revokeInvite = useRevokeSplitInvite();
    const addMember = useAddWorkspaceSplitParticipant();
    const addExternal = useAddExternalSplitParticipant();
    const deactivate = useDeactivateSplitParticipant();
    const archive = useArchiveSplitGroup();
    const reactivate = useReactivateSplitGroup();
    const intent = useSplitIntentKey();
    const busy = createInvite.isPending || revokeInvite.isPending || addMember.isPending ||
        addExternal.isPending || deactivate.isPending || archive.isPending || reactivate.isPending;
    const panelRef = useRef<HTMLDivElement>(null);
    useCardDialogFocus(panelRef, onClose, busy);

    // Invite State
    const [inviteRole, setInviteRole] = useState<SplitAssignableRole>('participant');
    const [createdInvite, setCreatedInvite] = useState<{ code: string; expiresAt: string } | null>(null);
    const [copied, setCopied] = useState(false);

    // Participants State
    const [memberUid, setMemberUid] = useState('');
    const [memberRole, setMemberRole] = useState<SplitAssignableRole>('participant');
    const [externalName, setExternalName] = useState('');
    const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

    // Danger Zone State
    const [isArchiving, setIsArchiving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sorted = useMemo(() => [...participants].sort((a, b) =>
        (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) ||
        (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0)), [participants]);
    const activeUserIds = new Set(participants.filter(p => p.status === 'active' && p.userId).map(p => p.userId));
    const addable = memberOptions.filter(m => m.role !== 'viewer' && !activeUserIds.has(m.uid));
    const activeCount = participants.filter(p => p.status === 'active').length;

    const run = async (
        operation: string,
        mutation: { mutateAsync: (input: { payload: Record<string, unknown>; idempotencyKey: string }) => Promise<unknown> },
        payload: Record<string, unknown>,
    ): Promise<unknown> => {
        setError(null);
        const result = await mutation.mutateAsync({ payload, idempotencyKey: intent.keyFor(operation, payload) });
        intent.reset();
        playSound('success');
        return result;
    };

    const attempt = async (action: () => Promise<void>) => {
        if (busy) return;
        try {
            await action();
        } catch (failure) {
            setError(splitErrorView(failure).message);
        }
    };

    const handleCreateInvite = () => attempt(async () => {
        setCopied(false);
        const result = await run('createSplitGroupInvite', createInvite, { groupId: group.id, role: inviteRole }) as SplitInviteResult;
        setCreatedInvite(result.code ? { code: result.code, expiresAt: result.expiresAt } : null);
    });

    const handleCopyCode = async (code: string) => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            playSound('click');
        } catch {
            setError('Não foi possível copiar. Selecione o código e copie manualmente.');
        }
    };

    const handleRevoke = (inviteId: string) => attempt(async () => {
        await run('revokeSplitGroupInvite', revokeInvite, { groupId: group.id, inviteId });
    });

    const handleAddMember = () => attempt(async () => {
        await run('addWorkspaceSplitParticipant', addMember, toWorkspaceParticipantPayload(group.id, memberUid, memberRole));
        setMemberUid('');
    });

    const handleAddExternal = () => attempt(async () => {
        await run('addExternalSplitParticipant', addExternal, toExternalParticipantPayload(group.id, externalName));
        setExternalName('');
    });

    const handleRemove = (participant: SplitParticipant) => attempt(async () => {
        await run('deactivateSplitParticipant', deactivate,
            { groupId: group.id, participantId: participant.id, expectedUpdatedAt: participant.version });
        setConfirmRemoveId(null);
    });

    const handleLifecycle = (action: 'archive' | 'reactivate') => attempt(async () => {
        await run(action === 'archive' ? 'archiveSplitGroup' : 'reactivateSplitGroup',
            action === 'archive' ? archive : reactivate,
            { groupId: group.id, expectedUpdatedAt: group.version });
        setIsArchiving(false);
        if (action === 'archive') onClose();
    });

    const handleLeaveGroup = () => {
        if (!me || !confirm('Sair do grupo? O histórico continua no grupo; você deixa de participar dele.')) return;
        void attempt(async () => {
            await run('deactivateSplitParticipant', deactivate,
                { groupId: group.id, participantId: me.id, expectedUpdatedAt: me.version });
            onGroupLeft();
            onClose();
        });
    };

    const tabClass = (tab: 'participants' | 'invites') => `flex-1 py-3 text-sm font-bold transition-colors ${activeTab === tab ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50 dark:bg-indigo-900/10' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`;
    const smallInput = "bg-white dark:bg-dark-300 border border-indigo-200 dark:border-gray-600 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white";

    return createPortal((
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="split-settings-title">
            <div
                ref={panelRef}
                tabIndex={-1}
                className="bg-white dark:bg-dark-200 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in flex flex-col max-h-[90vh] outline-none"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-dark-300">
                    <h3 id="split-settings-title" className="font-bold text-lg text-gray-800 dark:text-white flex items-center gap-2">
                        <UsersIcon className="w-5 h-5 text-indigo-600" />
                        Configurações do Grupo
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Fechar">
                        <CloseIcon />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-100 dark:border-gray-700" role="tablist">
                    <button role="tab" aria-selected={activeTab === 'participants'} onClick={() => setActiveTab('participants')} className={tabClass('participants')}>
                        Participantes ({activeCount})
                    </button>
                    <button role="tab" aria-selected={activeTab === 'invites'} onClick={() => setActiveTab('invites')} className={tabClass('invites')}>
                        Convites
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                    {error && (
                        <p role="alert" className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>
                    )}

                    {activeTab === 'participants' && (
                        <div className="space-y-4">
                            {sorted.map(p => {
                                const name = participantName(p, members);
                                const removable = canManage && isActive && p.status === 'active' && p.role !== 'owner';
                                return (
                                    <div key={p.id} className={`flex items-center justify-between p-3 bg-gray-50 dark:bg-dark-300 rounded-xl border border-gray-100 dark:border-gray-700 ${p.status !== 'active' ? 'opacity-60' : ''}`}>
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shadow-sm"
                                                style={{ backgroundColor: p.color, color: '#fff' }}
                                                aria-hidden="true"
                                            >
                                                {participantInitial(name)}
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-800 dark:text-white text-sm">
                                                    {name}
                                                    {p.role === 'owner' && <span className="ml-2 text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200">DONO</span>}
                                                    {me && p.id === me.id && <span className="ml-2 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-200">VOCÊ</span>}
                                                    {p.kind === 'external' && <span className="ml-2 text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">EXTERNO</span>}
                                                    {p.status !== 'active' && <span className="ml-2 text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">INATIVO</span>}
                                                </p>
                                                <p className="text-xs text-gray-400">{p.kind === 'external' ? 'Participante externo (sem acesso ao sistema)' : GROUP_ROLE_LABELS[p.role]}</p>
                                            </div>
                                        </div>
                                        {removable && (confirmRemoveId === p.id ? (
                                            <div className="flex gap-1">
                                                <button onClick={() => setConfirmRemoveId(null)} disabled={busy} className="text-gray-500 hover:bg-gray-100 p-2 rounded-lg text-xs font-bold">Cancelar</button>
                                                <button onClick={() => handleRemove(p)} disabled={busy} className="text-white bg-red-600 hover:bg-red-700 px-2 py-1.5 rounded-lg text-xs font-bold">Confirmar</button>
                                            </div>
                                        ) : (
                                            <button onClick={() => setConfirmRemoveId(p.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors text-xs font-bold" title="Remover">
                                                Remover
                                            </button>
                                        ))}
                                    </div>
                                );
                            })}

                            {canManage && isActive && (
                                <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30 space-y-3">
                                    <h4 className="font-bold text-indigo-800 dark:text-indigo-300 text-sm flex items-center gap-2">
                                        <PlusIcon className="w-4 h-4" /> Adicionar Participante
                                    </h4>
                                    <div className="flex flex-wrap gap-2">
                                        <select aria-label="Membro do espaço" value={memberUid} onChange={e => setMemberUid(e.target.value)} className={`${smallInput} flex-1 min-w-[150px]`}>
                                            <option value="">Membro do espaço...</option>
                                            {addable.map(m => <option key={m.uid} value={m.uid}>{m.displayName || m.email || 'Membro do espaço'}</option>)}
                                        </select>
                                        <select aria-label="Papel no grupo" value={memberRole} onChange={e => setMemberRole(e.target.value as SplitAssignableRole)} className={smallInput}>
                                            <option value="participant">Participante</option>
                                            <option value="viewer">Visualizador</option>
                                        </select>
                                        <button onClick={handleAddMember} disabled={busy || !memberUid} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-2 rounded-lg shadow-sm transition-all disabled:opacity-50">
                                            Adicionar
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <input aria-label="Nome do participante externo" value={externalName} maxLength={SPLIT_TEXT_LIMITS.externalName} onChange={e => setExternalName(e.target.value)} placeholder="Participante externo (só o nome)" className={`${smallInput} flex-1 min-w-[150px]`} />
                                        <button onClick={handleAddExternal} disabled={busy || !externalName.trim()} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-2 rounded-lg shadow-sm transition-all disabled:opacity-50">
                                            Adicionar
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'invites' && (
                        <div className="space-y-6">
                            {!canManage ? (
                                <div className="text-center py-4 text-gray-400 text-sm italic">Só o dono do grupo ou um administrador do espaço gerencia convites.</div>
                            ) : (
                                <>
                                    <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                                        <h4 className="font-bold text-indigo-800 dark:text-indigo-300 text-sm mb-2 flex items-center gap-2">
                                            <LinkIcon className="w-4 h-4" /> Gerar Novo Convite
                                        </h4>
                                        <div className="flex gap-2">
                                            <select
                                                aria-label="Papel do convite"
                                                value={inviteRole}
                                                onChange={(e) => setInviteRole(e.target.value as SplitAssignableRole)}
                                                className={smallInput}
                                            >
                                                <option value="participant">Participante (Edita)</option>
                                                <option value="viewer">Visualizador (Só vê)</option>
                                            </select>
                                            <button
                                                onClick={handleCreateInvite}
                                                disabled={busy || !isActive}
                                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-2 rounded-lg shadow-sm transition-all flex-1 disabled:opacity-50"
                                            >
                                                {createInvite.isPending ? 'Criando...' : 'Gerar Código'}
                                            </button>
                                        </div>
                                        <p className="mt-2 text-[11px] text-indigo-800/80 dark:text-indigo-300/80">
                                            O convite vale por 7 dias, uma única vez, e só para membros deste espaço.
                                        </p>
                                    </div>

                                    {createdInvite && (
                                        <div className="p-3 bg-white dark:bg-dark-300 border border-indigo-300 dark:border-indigo-700 rounded-xl shadow-sm" role="status">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="font-mono font-bold text-indigo-600 dark:text-indigo-400 text-lg tracking-wider select-all">{createdInvite.code}</p>
                                                    <p className="text-[10px] text-gray-400">Expira em {formatExpiry(createdInvite.expiresAt)}</p>
                                                </div>
                                                <button onClick={() => handleCopyCode(createdInvite.code)} className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Copiar código" aria-label="Copiar código">
                                                    <CopyIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                                                {copied ? 'Código copiado.' : 'Guarde o código agora: por segurança, ele não é exibido de novo.'}
                                            </p>
                                        </div>
                                    )}

                                    <div>
                                        <h4 className="font-bold text-gray-700 dark:text-gray-300 text-xs uppercase mb-3">Convites Ativos</h4>
                                        {isInvitesLoading ? (
                                            <div className="text-center py-4 text-gray-400 text-sm">Carregando...</div>
                                        ) : !invites || invites.length === 0 ? (
                                            <div className="text-center py-4 text-gray-400 text-sm italic">Nenhum convite pendente.</div>
                                        ) : (
                                            <div className="space-y-3">
                                                {invites.map(inv => (
                                                    <div key={inv.id} className="flex items-center justify-between p-3 bg-white dark:bg-dark-300 border border-gray-200 dark:border-gray-600 rounded-xl shadow-sm">
                                                        <div>
                                                            <p className="font-mono font-bold text-indigo-600 dark:text-indigo-400 text-lg tracking-wider" aria-label={`Código terminado em ${inv.codeHint}`}>•••••••{inv.codeHint}</p>
                                                            <p className="text-[10px] text-gray-400">{GROUP_ROLE_LABELS[inv.role]} · Expira em {formatExpiry(inv.expiresAt)}</p>
                                                        </div>
                                                        <button onClick={() => handleRevoke(inv.id)} disabled={busy} className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors text-xs font-bold" title="Revogar convite">
                                                            Revogar
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-4 bg-gray-50 dark:bg-dark-300 border-t border-gray-100 dark:border-gray-700 space-y-3">
                    {canManage ? (
                        <div className="flex flex-col gap-2">
                            {!isActive ? (
                                <button
                                    onClick={() => handleLifecycle('reactivate')}
                                    disabled={busy}
                                    className="w-full py-3 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2"
                                >
                                    <RefreshIcon className="w-4 h-4" />
                                    Reativar Grupo
                                </button>
                            ) : !isArchiving ? (
                                <button
                                    onClick={() => { setError(null); setIsArchiving(true); }}
                                    className="w-full py-3 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2"
                                >
                                    <DeleteIcon className="w-4 h-4" />
                                    Arquivar Grupo
                                </button>
                            ) : (
                                <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-xl border border-red-200 dark:border-red-800">
                                    <p className="text-xs text-red-800 dark:text-red-200 font-bold mb-2 flex items-center gap-2">
                                        <WarningIcon className="w-4 h-4" /> Arquivar o grupo? O histórico continua disponível para consulta.
                                    </p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setIsArchiving(false)}
                                            disabled={busy}
                                            className="flex-1 py-2 bg-white dark:bg-dark-200 text-gray-600 dark:text-gray-300 text-xs font-bold rounded-lg border border-gray-200 dark:border-gray-600"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            onClick={() => handleLifecycle('archive')}
                                            disabled={busy}
                                            className="flex-1 py-2 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 shadow-sm"
                                        >
                                            Confirmar Arquivamento
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : me && me.status === 'active' && me.role !== 'owner' && isActive ? (
                        <button
                            onClick={handleLeaveGroup}
                            disabled={busy}
                            className="w-full py-3 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-300 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            <LogoutIcon className="w-4 h-4" />
                            Sair do Grupo
                        </button>
                    ) : null}
                </div>
            </div>
             <style>{`
                @keyframes scale-in {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .animate-scale-in {
                    animation: scale-in 0.2s ease-out forwards;
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
    ), document.body);
};

export default SplitGroupSettingsModal;
