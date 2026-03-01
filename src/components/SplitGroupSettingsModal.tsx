import React, { useState } from 'react';
import { SplitGroup, SplitParticipant } from '../types.ts';
// CORREÇÃO: Atualizado para usar o novo nome 'useCreateSplitGroupInvite'
import { useSplitGroupInvites, useCreateSplitGroupInvite, useDeleteSplitGroup, useLeaveSplitGroup } from '../modules/split-bills/hooks.ts';
import { CloseIcon, UsersIcon, LinkIcon, CopyIcon, ShareIcon, DeleteIcon, WarningIcon, LogoutIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';

interface SplitGroupSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    group: SplitGroup;
    participants: SplitParticipant[];
    isOwner: boolean;
    onGroupDeleted: () => void;
    onGroupLeft: () => void;
    currentUserId?: string;
}

const SplitGroupSettingsModal: React.FC<SplitGroupSettingsModalProps> = ({ 
    isOpen, onClose, group, participants, isOwner, onGroupDeleted, onGroupLeft, currentUserId
}) => {
    const [activeTab, setActiveTab] = useState<'participants' | 'invites'>('participants');
    const { playSound } = useTheme();
    
    // Hooks
    const { data: invites, isLoading: isInvitesLoading } = useSplitGroupInvites(group.id);
    // CORREÇÃO: Uso do hook renomeado
    const createInviteMutation = useCreateSplitGroupInvite();
    const deleteGroupMutation = useDeleteSplitGroup();
    const leaveGroupMutation = useLeaveSplitGroup();

    // Invite State
    const [inviteRole, setInviteRole] = useState<'participante' | 'visualizador'>('participante');

    // Danger Zone State
    const [isDeleting, setIsDeleting] = useState(false);

    if (!isOpen) return null;

    const handleCreateInvite = () => {
        createInviteMutation.mutate({ groupId: group.id, role: inviteRole }, {
            onSuccess: () => {
                playSound('success');
            }
        });
    };

    const handleCopyInvite = (code: string) => {
        // Link format: currentUrl?invite=CODE
        const url = `${window.location.origin}${window.location.pathname}?invite=${code}`;
        navigator.clipboard.writeText(url);
        playSound('click');
        alert('Link copiado para a área de transferência!');
    };

    const handleDeleteGroup = () => {
        if (confirm('Tem certeza ABSOLUTA? Isso apagará o grupo, todas as contas, divisões e histórico. Essa ação não pode ser desfeita.')) {
            deleteGroupMutation.mutate(group.id, {
                onSuccess: () => {
                    playSound('success');
                    onGroupDeleted();
                    onClose();
                }
            });
        }
    };

    const handleLeaveGroup = () => {
        if (!currentUserId) return;
        // Find participant ID for current user
        // Assuming currentUserId is passed correctly or we match by logic. 
        // For now, let's assume the parent component passes the correct participant ID logic or we find by user ID if available in participant struct.
        // In this architecture, usually we match by profileId/userId.
        
        // Simplification: We need the participant ID to leave. 
        // Let's find the participant record that corresponds to "Você" or current user
        // Ideally, 'participants' prop has this info.
        
        // Mock logic: find participant where name is 'Você' or matches ID
        const myParticipant = participants.find(p => p.nomeExibicao === 'Você' || (currentUserId && p.userId === currentUserId)); // Adjust logic as per your auth
        
        if (myParticipant && confirm('Sair do grupo? Você perderá acesso ao histórico.')) {
            leaveGroupMutation.mutate({ groupId: group.id, participantId: myParticipant.id }, {
                onSuccess: () => {
                    playSound('success');
                    onGroupLeft();
                    onClose();
                }
            });
        } else if (!myParticipant) {
            alert('Erro ao identificar seu usuário no grupo.');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div 
                className="bg-white dark:bg-dark-200 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-dark-300">
                    <h3 className="font-bold text-lg text-gray-800 dark:text-white flex items-center gap-2">
                        <UsersIcon className="w-5 h-5 text-indigo-600" />
                        Configurações do Grupo
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                        <CloseIcon />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-100 dark:border-gray-700">
                    <button 
                        onClick={() => setActiveTab('participants')}
                        className={`flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'participants' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50 dark:bg-indigo-900/10' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                    >
                        Participantes ({participants.length})
                    </button>
                    <button 
                        onClick={() => setActiveTab('invites')}
                        className={`flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'invites' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50 dark:bg-indigo-900/10' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                    >
                        Convites
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                    {activeTab === 'participants' && (
                        <div className="space-y-4">
                            {participants.map(p => (
                                <div key={p.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-dark-300 rounded-xl border border-gray-100 dark:border-gray-700">
                                    <div className="flex items-center gap-3">
                                        <div 
                                            className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shadow-sm"
                                            style={{ backgroundColor: p.corIdentidade, color: '#fff' }}
                                        >
                                            {p.avatarEmojiOpcional || p.nomeExibicao.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="font-bold text-gray-800 dark:text-white text-sm">
                                                {p.nomeExibicao} 
                                                {p.papel === 'dono' && <span className="ml-2 text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200">DONO</span>}
                                                {p.userId === currentUserId && <span className="ml-2 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-200">VOCÊ</span>}
                                            </p>
                                            <p className="text-xs text-gray-400 capitalize">{p.papel}</p>
                                        </div>
                                    </div>
                                    {isOwner && p.papel !== 'dono' && (
                                        <button className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors text-xs font-bold" title="Remover">
                                            Remover
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'invites' && (
                        <div className="space-y-6">
                            <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                                <h4 className="font-bold text-indigo-800 dark:text-indigo-300 text-sm mb-2 flex items-center gap-2">
                                    <LinkIcon className="w-4 h-4" /> Gerar Novo Convite
                                </h4>
                                <div className="flex gap-2">
                                    <select 
                                        value={inviteRole}
                                        onChange={(e) => setInviteRole(e.target.value as any)}
                                        className="bg-white dark:bg-dark-300 border border-indigo-200 dark:border-gray-600 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                                    >
                                        <option value="participante">Participante (Edita)</option>
                                        <option value="visualizador">Visualizador (Só vê)</option>
                                    </select>
                                    <button 
                                        onClick={handleCreateInvite}
                                        disabled={createInviteMutation.isPending}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-2 rounded-lg shadow-sm transition-all flex-1"
                                    >
                                        {createInviteMutation.isPending ? 'Criando...' : 'Gerar Link'}
                                    </button>
                                </div>
                            </div>

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
                                                    <p className="font-mono font-bold text-indigo-600 dark:text-indigo-400 text-lg tracking-wider">{inv.codigoConvite}</p>
                                                    <p className="text-[10px] text-gray-400">Expira em {new Date(inv.expiraEm).toLocaleDateString()}</p>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button onClick={() => handleCopyInvite(inv.codigoConvite)} className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Copiar Link">
                                                        <CopyIcon className="w-4 h-4" />
                                                    </button>
                                                    <button className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Compartilhar">
                                                        <ShareIcon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-4 bg-gray-50 dark:bg-dark-300 border-t border-gray-100 dark:border-gray-700 space-y-3">
                    {isOwner ? (
                        <div className="flex flex-col gap-2">
                            {!isDeleting ? (
                                <button 
                                    onClick={() => setIsDeleting(true)}
                                    className="w-full py-3 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2"
                                >
                                    <DeleteIcon className="w-4 h-4" />
                                    Excluir Grupo
                                </button>
                            ) : (
                                <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-xl border border-red-200 dark:border-red-800">
                                    <p className="text-xs text-red-800 dark:text-red-200 font-bold mb-2 flex items-center gap-2">
                                        <WarningIcon className="w-4 h-4" /> Tem certeza?
                                    </p>
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => setIsDeleting(false)}
                                            className="flex-1 py-2 bg-white dark:bg-dark-200 text-gray-600 dark:text-gray-300 text-xs font-bold rounded-lg border border-gray-200 dark:border-gray-600"
                                        >
                                            Cancelar
                                        </button>
                                        <button 
                                            onClick={handleDeleteGroup}
                                            className="flex-1 py-2 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 shadow-sm"
                                        >
                                            Confirmar Exclusão
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <button 
                            onClick={handleLeaveGroup}
                            className="w-full py-3 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-300 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            <LogoutIcon className="w-4 h-4" />
                            Sair do Grupo
                        </button>
                    )}
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
    );
};

export default SplitGroupSettingsModal;