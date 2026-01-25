import React, { useState } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { 
    useWorkspaceMembers, 
    useAddMember, 
    useUpdateMemberRole, 
    useRemoveMember 
} from '../modules/workspaces/hooks';
import { WorkspaceRole, WorkspaceMember } from '../modules/workspaces/types';
import { 
    CloseIcon, 
    UsersIcon, 
    UserPlusIcon,
    DeleteIcon,
    ShieldCheckIcon,
    CheckIcon
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

const MembersManagerModal: React.FC<MembersManagerModalProps> = ({ onClose }) => {
    const { activeWorkspace } = useWorkspace();
    const { data: members, isLoading } = useWorkspaceMembers(activeWorkspace.id);
    
    const addMemberMutation = useAddMember(activeWorkspace.id);
    const updateRoleMutation = useUpdateMemberRole(activeWorkspace.id);
    const removeMemberMutation = useRemoveMember(activeWorkspace.id);

    const [newEmail, setNewEmail] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Segurança na UI: Apenas Owner e Admin podem ver controles sensíveis
    const canManage = ['owner', 'admin'].includes(activeWorkspace.myRole || 'viewer');

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newEmail.trim()) return;
        
        setError(null);
        setIsAdding(true);

        try {
            // OBS: Em produção, isso dispararia um Cloud Function para enviar e-mail.
            // Aqui, simulamos adicionando direto (assumindo que o e-mail é a chave ou que temos o UID).
            // Para o MVP funcionar, vamos gerar um ID fake baseado no email se não tivermos auth real de busca.
            const fakeUid = newEmail.replace(/[^a-zA-Z0-9]/g, ''); 
            
            const newMember: WorkspaceMember = {
                uid: fakeUid, // Num sistema real, buscaríamos o UID pelo email via Cloud Function
                email: newEmail,
                role: 'viewer', // Padrão seguro
                displayName: newEmail.split('@')[0],
                joinedAt: new Date().toISOString()
            };

            await addMemberMutation.mutateAsync(newMember);
            setNewEmail('');
        } catch (err) {
            console.error(err);
            setError("Falha ao adicionar membro. Verifique se o e-mail é válido.");
        } finally {
            setIsAdding(false);
        }
    };

    const handleRoleChange = (memberId: string, newRole: WorkspaceRole) => {
        if (!canManage) return;
        updateRoleMutation.mutate({ memberId, role: newRole });
    };

    const handleRemove = (memberId: string) => {
        if (!canManage) return;
        if (confirm('Tem certeza que deseja remover este membro? Ele perderá acesso imediatamente.')) {
            removeMemberMutation.mutate(memberId);
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
                                    disabled={isAdding}
                                    className="bg-primary hover:bg-primary/90 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50 transition-all"
                                >
                                    {isAdding ? 'Adicionando...' : 'Convidar'}
                                </button>
                            </form>
                            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
                            <p className="text-xs text-muted mt-2">
                                * Novos membros entram como "Visualizador" por padrão. Você pode alterar o papel abaixo.
                            </p>
                        </div>
                    )}

                    {/* List Section */}
                    <div>
                        <h3 className="text-sm font-bold text-on-surface uppercase mb-3">Membros Atuais ({members?.length || 0})</h3>
                        
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
                                                onChange={(e) => handleRoleChange(member.uid, e.target.value as WorkspaceRole)}
                                                disabled={!canManage || member.role === 'owner'} 
                                                className="bg-background border border-border rounded px-2 py-1 text-xs text-on-surface focus:ring-1 focus:ring-primary outline-none disabled:opacity-50 cursor-pointer"
                                            >
                                                {Object.entries(ROLE_LABELS).map(([key, label]) => (
                                                    <option key={key} value={key}>{label}</option>
                                                ))}
                                            </select>

                                            {canManage && member.role !== 'owner' && (
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