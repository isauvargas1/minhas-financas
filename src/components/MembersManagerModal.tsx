import React, { useState } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useAuth } from '../contexts/AuthContext';
import {
    useWorkspaceMembers,
    useInviteMember,
    useUpdateMemberRole,
    useRemoveMember,
    useTransferOwnership,
} from '../modules/workspaces/hooks';
import { WorkspaceRole } from '../modules/workspaces/types';
import { workspaceErrorMessage, withRecentLogin } from '../modules/workspaces/errors';
import { 
    CloseIcon, 
    UsersIcon, 
    UserPlusIcon,
    DeleteIcon,
    ShieldCheckIcon,
} from './Icons';

interface MembersManagerModalProps {
    onClose: () => void;
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
    owner: 'Dono (Acesso Total)',
    admin: 'Administrador',
    member: 'Membro (Editor)',
    viewer: 'Visualizador'
};

type ManageableRole = Exclude<WorkspaceRole, 'owner'>;

/**
 * Alçada de gestão por papel (D-04), a mesma que o backend aplica: a tela só
 * oferece o que a callable aceitaria. A decisão continua sendo do backend.
 */
const MANAGED_BY: Record<WorkspaceRole, ManageableRole[]> = {
    owner: ['admin', 'member', 'viewer'],
    admin: ['member', 'viewer'],
    member: [],
    viewer: [],
};

const MembersManagerModal: React.FC<MembersManagerModalProps> = ({ onClose }) => {
    const { activeWorkspace, activeWorkspaceRole, reloadWorkspaces } = useWorkspace();
    const { user } = useAuth();
    const { data: members, isLoading, hasMore, isLoadingMore, loadMore } = useWorkspaceMembers(activeWorkspace.id);

    const inviteMutation = useInviteMember(activeWorkspace.id);
    const updateRoleMutation = useUpdateMemberRole(activeWorkspace.id);
    const removeMemberMutation = useRemoveMember(activeWorkspace.id);
    const transferMutation = useTransferOwnership(activeWorkspace.id);

    const [newEmail, setNewEmail] = useState('');
    const [isInviting, setIsInviting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    // Papel lido do membership ativo (WorkspaceContext), nunca do índice.
    const actorRole: WorkspaceRole = activeWorkspaceRole ?? 'viewer';
    const manageable = MANAGED_BY[actorRole];
    const canManage = manageable.length > 0;

    const canEditMember = (memberId: string, role: WorkspaceRole) =>
        canManage && memberId !== user?.uid && role !== 'owner' && manageable.includes(role);

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        const email = newEmail.trim();
        if (!email) return;

        setError(null);
        setNotice(null);
        setIsInviting(true);

        try {
            // Convite pendente vinculado ao e-mail (D-05). O membership só é
            // criado quando a própria pessoa aceita, com a conta dela.
            await inviteMutation.mutateAsync({ email, role: 'viewer' });
            setNewEmail('');
            setNotice(`Convite registrado para ${email}.`);
        } catch (err) {
            console.error(err);
            setError(workspaceErrorMessage(err, 'Não foi possível registrar o convite. Tente novamente.'));
        } finally {
            setIsInviting(false);
        }
    };

    const handleTransfer = async (memberId: string, label: string) => {
        if (!confirm(`Transferir a titularidade do espaço para ${label}? Você passará a ser administrador.`)) {
            return;
        }
        try {
            await withRecentLogin(() => transferMutation.mutateAsync(memberId));
            await reloadWorkspaces();
        } catch (err) {
            console.error(err);
            setError(workspaceErrorMessage(err, 'Não foi possível transferir a titularidade. Tente novamente.'));
        }
    };

    const handleRoleChange = (memberId: string, label: string, newRole: WorkspaceRole) => {
        setError(null);
        setNotice(null);
        if (newRole === 'owner') {
            if (actorRole === 'owner') void handleTransfer(memberId, label);
            return;
        }
        updateRoleMutation.mutate({ memberId, role: newRole }, {
            onError: (err) => {
                console.error(err);
                setError(workspaceErrorMessage(err, 'Não foi possível alterar o papel. Tente novamente.'));
            },
        });
    };

    const handleRemove = (memberId: string) => {
        setError(null);
        setNotice(null);
        if (confirm('Tem certeza que deseja remover este membro? Ele perderá acesso imediatamente.')) {
            removeMemberMutation.mutate(memberId, {
                onError: (err) => {
                    console.error(err);
                    setError(workspaceErrorMessage(err, 'Não foi possível remover o membro. Tente novamente.'));
                },
            });
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in">
            <div className="bg-surface rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="p-6 border-b border-border flex justify-between items-center bg-surface">
                    <div>
                        <h2 className="text-xl font-bold text-on-surface flex items-center gap-2">
                            <UsersIcon className="w-6 h-6 text-primary" />
                            Membros e Permissões
                        </h2>
                        <p className="text-sm text-muted">Gerencie quem tem acesso ao workspace <strong>{activeWorkspace.name}</strong>.</p>
                    </div>
                    <button onClick={onClose} className="text-muted hover:text-on-surface transition-colors">
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-8">
                    
                    {/* Invite Section */}
                    {canManage && (
                        <div className="bg-background rounded-lg p-4 border border-border">
                            <h3 className="text-sm font-bold text-on-surface uppercase mb-3 flex items-center gap-2">
                                <UserPlusIcon className="w-4 h-4" /> Convidar Novo Membro
                            </h3>
                            <form onSubmit={handleInvite} className="flex gap-2">
                                <input 
                                    type="email" 
                                    placeholder="email@exemplo.com"
                                    className="flex-1 bg-surface border border-border rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-primary text-on-surface"
                                    value={newEmail}
                                    onChange={e => setNewEmail(e.target.value)}
                                    required
                                />
                                <button 
                                    type="submit" 
                                    disabled={isInviting}
                                    className="bg-primary hover:bg-primary/90 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50 transition-all"
                                >
                                    {isInviting ? 'Convidando...' : 'Convidar'}
                                </button>
                            </form>
                            {error && <p className="text-red-500 text-xs mt-2" role="alert">{error}</p>}
                            {notice && <p className="text-xs text-muted mt-2">{notice}</p>}
                            <p className="text-xs text-muted mt-2">
                                * Novos membros entram como "Visualizador" por padrão. Você pode alterar o papel abaixo.
                            </p>
                        </div>
                    )}

                    {/* List Section */}
                    <div>
                        <h3 className="text-sm font-bold text-on-surface uppercase mb-3">Membros Atuais ({members?.length || 0}{hasMore ? '+' : ''})</h3>
                        
                        {isLoading ? (
                            <div className="text-center py-8 text-muted">Carregando membros...</div>
                        ) : (
                            <div className="space-y-3">
                                {members?.map((member) => (
                                    <div key={member.uid} className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface hover:border-primary/30 transition-colors group">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg">
                                                {member.displayName?.charAt(0).toUpperCase() || member.email.charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="font-bold text-on-surface text-sm">{member.displayName || 'Usuário'}</p>
                                                <p className="text-xs text-muted">{member.email}</p>
                                            </div>
                                            {member.role === 'owner' && (
                                                <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-800 text-[10px] font-bold rounded-full border border-yellow-200">DONO</span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-4">
                                            <select 
                                                value={member.role}
                                                onChange={(e) => handleRoleChange(member.uid, member.displayName || member.email, e.target.value as WorkspaceRole)}
                                                disabled={!canEditMember(member.uid, member.role)} 
                                                className="bg-background border border-border rounded px-2 py-1 text-xs text-on-surface focus:ring-1 focus:ring-primary outline-none disabled:opacity-50 cursor-pointer"
                                            >
                                                {(Object.entries(ROLE_LABELS) as Array<[WorkspaceRole, string]>)
                                                    .filter(([key]) =>
                                                        !canEditMember(member.uid, member.role) ||
                                                        key === member.role ||
                                                        manageable.includes(key as ManageableRole) ||
                                                        (key === 'owner' && actorRole === 'owner'))
                                                    .map(([key, label]) => (
                                                        <option key={key} value={key}>{label}</option>
                                                    ))}
                                            </select>

                                            {canEditMember(member.uid, member.role) && (
                                                <button 
                                                    onClick={() => handleRemove(member.uid)}
                                                    className="p-2 text-muted hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                                                    title="Remover acesso"
                                                >
                                                    <DeleteIcon className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}

                                {hasMore && (
                                    <button
                                        type="button"
                                        onClick={() => void loadMore()}
                                        disabled={isLoadingMore}
                                        className="w-full p-2 rounded-lg transition-colors text-sm text-primary font-medium hover:bg-background disabled:opacity-50"
                                    >
                                        {isLoadingMore ? 'Carregando membros...' : 'Carregar mais membros'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 bg-background border-t border-border text-center">
                     <p className="text-xs text-muted">
                        <ShieldCheckIcon className="w-3 h-3 inline mr-1 text-green-500" />
                        Ambiente Seguro com controle de acesso baseado em funções (RBAC).
                     </p>
                </div>
            </div>
        </div>
    );
};

export default MembersManagerModal;