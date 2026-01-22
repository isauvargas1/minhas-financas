
import React, { useState } from 'react';
import { SplitGroup, SplitParticipant, SplitGroupInvite } from '../types.ts';
import { useSplitGroupInvites, useCreateInvite, useDeleteSplitGroup, useLeaveSplitGroup } from '../modules/split-bills/hooks.ts';
import { CloseIcon, UsersIcon, LinkIcon, CopyIcon, ShareIcon, DeleteIcon, WarningIcon, LogoutIcon } from './Icons.tsx';
import { useTheme } from '../ThemeContext.tsx';

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
    const createInviteMutation = useCreateInvite();
    const deleteGroupMutation = useDeleteSplitGroup();
    const leaveGroupMutation = useLeaveSplitGroup();

    // Invite State
    const [inviteRole, setInviteRole] = useState<'participante' | 'visualizador'>('participante');

    // Danger Zone State
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteInput, setDeleteInput] = useState('');

    if (!isOpen) return null;

    const handleCreateInvite = () => {
        createInviteMutation.mutate({ groupId: group.id, role: inviteRole });
        playSound('success');
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        playSound('click');
        alert('Código copiado!');
    };

    const handleDeleteGroup = () => {
        if (deleteInput.toUpperCase() === 'DELETAR') {
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
        if (confirm("Tem certeza que deseja sair deste grupo? O histórico será removido para você.") && currentUserId) {
            leaveGroupMutation.mutate({ groupId: group.id, participantId: currentUserId }, {
                onSuccess: () => {
                    playSound('success');
                    onGroupLeft();
                    onClose();
                }
            });
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-md animate-scale-in flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                
                {/* Header */}
                <div className="flex justify-between items-center p-5 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white">Configurações do Grupo</h3>
                    <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                        <CloseIcon />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200 dark:border-gray-700">
                    <button 
                        onClick={() => setActiveTab('participants')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'participants' ? 'text-indigo-600 border-b-2 border-indigo-600 dark:text-indigo-400 dark:border-indigo-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                    >
                        Participantes ({participants.length})
                    </button>
                    {isOwner && (
                        <button 
                            onClick={() => setActiveTab('invites')}
                            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'invites' ? 'text-indigo-600 border-b-2 border-indigo-600 dark:text-indigo-400 dark:border-indigo-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                        >
                            Convites
                        </button>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
                    
                    {activeTab === 'participants' && (
                        <div className="space-y-4">
                            {participants.map(p => (
                                <div key={p.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-dark-200 rounded-lg border border-gray-100 dark:border-gray-700">
                                    <div className="flex items-center gap-3">
                                        <div 
                                            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-lg shadow-sm"
                                            style={{ backgroundColor: p.corIdentidade }}
                                        >
                                            {p.avatarEmojiOpcional || p.nomeExibicao.charAt(0)}
                                        </div>
                                        <div>
                                            <p className="font-bold text-gray-800 dark:text-white text-sm">{p.nomeExibicao} {p.nomeExibicao === 'Você' && '(Eu)'}</p>
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium uppercase ${
                                                p.papel === 'dono' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300' :
                                                p.papel === 'visualizador' ? 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300' :
                                                'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                                            }`}>
                                                {p.papel}
                                            </span>
                                        </div>
                                    </div>
                                    {isOwner && p.papel !== 'dono' && (
                                        <button className="text-red-400 hover:text-red-600 p-2" title="Remover">
                                            <DeleteIcon className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'invites' && isOwner && (
                        <div className="space-y-6">
                            <div className="bg-indigo-50 dark:bg-indigo-900/10 p-4 rounded-lg border border-indigo-100 dark:border-indigo-900/30">
                                <h4 className="text-sm font-bold text-indigo-800 dark:text-indigo-300 mb-2">Gerar Novo Convite</h4>
                                <div className="flex gap-2 mb-3">
                                    <select 
                                        value={inviteRole} 
                                        onChange={(e) => setInviteRole(e.target.value as any)}
                                        className="flex-1 border border-indigo-200 dark:border-indigo-800 bg-white text-gray-900 dark:bg-dark-100 dark:text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="participante">Participante (Pode editar)</option>
                                        <option value="visualizador">Visualizador (Somente leitura)</option>
                                    </select>
                                    <button 
                                        onClick={handleCreateInvite}
                                        disabled={createInviteMutation.isPending}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                    >
                                        Gerar
                                    </button>
                                </div>
                                <p className="text-xs text-indigo-600 dark:text-indigo-400">
                                    O código gerado expira em 7 dias.
                                </p>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-gray-500 uppercase mb-3">Convites Ativos</h4>
                                {isInvitesLoading ? (
                                    <div className="text-center py-4 text-sm text-gray-400">Carregando...</div>
                                ) : invites && invites.length > 0 ? (
                                    <div className="space-y-3">
                                        {invites.map(invite => (
                                            <div key={invite.id} className="flex items-center justify-between p-3 bg-white dark:bg-dark-200 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
                                                <div>
                                                    <p className="font-mono text-lg font-bold text-gray-800 dark:text-white tracking-widest">{invite.codigoConvite}</p>
                                                    <p className="text-xs text-gray-500">Papel: {invite.papelSugerido}</p>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button 
                                                        onClick={() => copyToClipboard(invite.codigoConvite)}
                                                        className="p-2 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20 rounded-md transition-colors"
                                                        title="Copiar Código"
                                                    >
                                                        <CopyIcon className="w-4 h-4" />
                                                    </button>
                                                    <button 
                                                        onClick={() => { /* TODO: Share Logic */ }}
                                                        className="p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-dark-300 rounded-md transition-colors"
                                                        title="Compartilhar"
                                                    >
                                                        <ShareIcon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-center text-sm text-gray-400 py-4">Nenhum convite ativo.</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Danger Zone */}
                <div className="p-5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-dark-200/50 rounded-b-xl">
                    {isOwner ? (
                        <>
                            {isDeleting ? (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-red-600">
                                        <WarningIcon className="w-5 h-5" />
                                        <span className="font-bold text-sm">Zona de Perigo</span>
                                    </div>
                                    <p className="text-xs text-gray-600 dark:text-gray-400">
                                        Excluir o grupo apagará todo o histórico de despesas para todos os participantes.
                                    </p>
                                    <input 
                                        type="text" 
                                        placeholder="Digite DELETAR"
                                        value={deleteInput}
                                        onChange={e => setDeleteInput(e.target.value)}
                                        className="w-full border border-red-300 dark:border-red-800 bg-white dark:bg-dark-100 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                                    />
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => { setIsDeleting(false); setDeleteInput(''); }}
                                            className="flex-1 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 transition-colors"
                                        >
                                            Cancelar
                                        </button>
                                        <button 
                                            onClick={handleDeleteGroup}
                                            disabled={deleteInput.toUpperCase() !== 'DELETAR'}
                                            className="flex-1 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            Confirmar Exclusão
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button 
                                    onClick={() => setIsDeleting(true)}
                                    className="w-full py-3 border border-red-200 dark:border-red-900/50 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                    <DeleteIcon className="w-4 h-4" />
                                    Excluir Grupo
                                </button>
                            )}
                        </>
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
