
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, type MotionProps } from 'framer-motion';
import { useChatThreads, useThreadMessages, useSendMessage, useMarkThreadAsRead } from '../modules/messages/hooks.ts';
import { ChatThread, ChatMessage } from '../modules/messages/types.ts';
import { CloseIcon, DynamicIcon, SearchIcon, ArrowUpIcon, UsersIcon, ChevronLeftIcon, MessageCirclePlusIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import NewConversationModal from './NewConversationModal.tsx';

interface MessagesPanelProps {
    threads?: ChatThread[]; 
    onClose: () => void;
    onMarkAsRead?: (id: string) => void;
    onOpenSplitGroup?: (groupId: string) => void;
}

const MotionDiv = motion.div as React.ComponentType<React.HTMLAttributes<HTMLDivElement> & MotionProps>;

const MessagesPanel: React.FC<MessagesPanelProps> = ({ onClose, onOpenSplitGroup }) => {
    const { data: threadsData } = useChatThreads();
    const threads = threadsData || [];
    
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [inputMessage, setInputMessage] = useState('');
    const [isNewConversationOpen, setIsNewConversationOpen] = useState(false);
    
    // Hooks
    const { data: messages, isLoading: isMessagesLoading } = useThreadMessages(selectedThreadId);
    const sendMessageMutation = useSendMessage();
    const markAsReadMutation = useMarkThreadAsRead();
    const { theme, playSound } = useTheme();

    // Refs
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Filter Logic
    const filteredThreads = threads.filter(t => 
        (t.groupName || t.participants[0]?.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const selectedThread = threads.find(t => t.id === selectedThreadId);

    // Auto-scroll to bottom
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, selectedThreadId]);

    // Focus input on thread select
    useEffect(() => {
        if (selectedThreadId) {
            // Small delay to ensure render
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [selectedThreadId]);

    // Mark as read when opening
    useEffect(() => {
        if (selectedThreadId && selectedThread?.unreadCount > 0) {
            markAsReadMutation.mutate(selectedThreadId);
        }
    }, [selectedThreadId, selectedThread?.unreadCount]);

    const handleSendMessage = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!inputMessage.trim() || !selectedThreadId) return;

        sendMessageMutation.mutate({ threadId: selectedThreadId, content: inputMessage });
        setInputMessage('');
        playSound('click');
        
        // Keep focus
        setTimeout(() => inputRef.current?.focus(), 10);
    };

    const handleThreadClick = (id: string) => {
        setSelectedThreadId(id);
        playSound('click');
    };

    const handleCreateConversation = (conversationId: string) => {
        // API handles creation, here we just select the new thread
        setSelectedThreadId(conversationId);
    };

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatDateLabel = (iso: string) => {
        const d = new Date(iso);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) return 'Hoje';
        return d.toLocaleDateString('pt-BR');
    };

    const getAvatar = (thread: ChatThread, size: string = "w-10 h-10") => {
        if (thread.isGroup) {
            return (
                <div className={`${size} rounded-full bg-primary/10 flex items-center justify-center text-primary border border-primary/20`}>
                    <UsersIcon className="w-1/2 h-1/2" />
                </div>
            );
        }
        const p = thread.participants[0];
        return (
            <div className={`${size} rounded-full bg-gray-200 dark:bg-dark-300 flex items-center justify-center border border-gray-300 dark:border-gray-600 overflow-hidden text-gray-600 dark:text-gray-300`}>
                <span className="text-xl font-medium">{p?.avatar || p?.name?.charAt(0)}</span>
            </div>
        );
    };

    const getThreadName = (thread: ChatThread) => thread.isGroup ? thread.groupName : thread.participants[0]?.name;

    // View Components
    const renderSidebar = () => (
        <div className={`flex-col h-full bg-background border-r border-border w-full md:w-[350px] ${selectedThreadId ? 'hidden md:flex' : 'flex'}`}>
            <div className="p-4 border-b border-border bg-surface sticky top-0 z-10">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-on-surface">Mensagens</h2>
                    <div className="flex gap-2 items-center">
                        <button 
                            onClick={() => setIsNewConversationOpen(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary text-sm font-medium active:scale-95"
                            title="Nova Conversa"
                            aria-label="Iniciar nova conversa"
                        >
                            <MessageCirclePlusIcon className="w-4 h-4" />
                            <span className="hidden sm:inline">Nova</span>
                        </button>
                        <button onClick={onClose} className="p-2 text-muted hover:text-on-surface rounded-full hover:bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary" aria-label="Fechar painel">
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    </div>
                </div>
                <div className="relative">
                    <input 
                        type="text" 
                        placeholder="Pesquisar conversa..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none text-on-surface placeholder:text-muted transition-shadow"
                    />
                    <SearchIcon className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface">
                {filteredThreads.length === 0 ? (
                    <div className="p-8 text-center text-muted flex flex-col items-center justify-center h-full opacity-60">
                        <DynamicIcon name="MessageOff" className="w-12 h-12 mb-2" />
                        <p>Nenhuma conversa encontrada.</p>
                        <button 
                            onClick={() => setIsNewConversationOpen(true)}
                            className="mt-4 text-primary text-sm font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-primary rounded px-2"
                        >
                            Iniciar nova conversa
                        </button>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {filteredThreads.map(thread => (
                            <div 
                                key={thread.id} 
                                onClick={() => handleThreadClick(thread.id)}
                                className={`p-4 flex gap-3 cursor-pointer transition-colors hover:bg-background ${selectedThreadId === thread.id ? 'bg-primary/5' : 'bg-surface'}`}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') handleThreadClick(thread.id);
                                }}
                            >
                                <div className="relative">
                                    {getAvatar(thread, "w-12 h-12")}
                                    {thread.unreadCount > 0 && (
                                        <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-surface shadow-sm">
                                            {thread.unreadCount}
                                        </span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline mb-1">
                                        <h4 className={`text-sm truncate ${thread.unreadCount > 0 ? 'font-bold text-on-surface' : 'font-medium text-on-surface/80'}`}>
                                            {getThreadName(thread)}
                                        </h4>
                                        <span className="text-[10px] text-muted whitespace-nowrap ml-2">
                                            {formatTime(thread.lastMessage.timestamp)}
                                        </span>
                                    </div>
                                    <p className={`text-xs truncate ${thread.unreadCount > 0 ? 'text-on-surface font-medium' : 'text-muted'}`}>
                                        {thread.lastMessage.senderId === 'me' && <span className="mr-1">Você:</span>}
                                        {thread.lastMessage.content}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

    const renderChat = () => {
        if (!selectedThread) return (
            <div className="hidden md:flex flex-1 items-center justify-center bg-background flex-col text-center p-8 opacity-60">
                <div className="w-24 h-24 bg-surface rounded-full flex items-center justify-center mb-6 border border-border shadow-sm">
                    <DynamicIcon name="Message" className="w-10 h-10 text-primary" />
                </div>
                <h3 className="text-lg font-medium text-on-surface mb-2">Selecione uma conversa</h3>
                <p className="text-sm text-muted max-w-xs">Escolha um contato à esquerda para visualizar o histórico e enviar mensagens.</p>
            </div>
        );

        return (
            <div className={`flex-col flex-1 bg-surface h-full ${selectedThreadId ? 'flex' : 'hidden md:flex'}`}>
                {/* Chat Header */}
                <div className="p-3 border-b border-border flex items-center justify-between shadow-sm z-10 bg-surface">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setSelectedThreadId(null)} className="md:hidden p-2 -ml-2 text-muted hover:bg-background rounded-full transition-colors">
                            <ChevronLeftIcon className="w-5 h-5" />
                        </button>
                        {getAvatar(selectedThread, "w-10 h-10")}
                        <div>
                            <h3 className="font-bold text-on-surface text-sm">{getThreadName(selectedThread)}</h3>
                            <div className="flex items-center gap-2">
                                {selectedThread.relatedGroupId && onOpenSplitGroup ? (
                                    <button 
                                        onClick={() => onOpenSplitGroup(selectedThread.relatedGroupId!)}
                                        className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-primary"
                                    >
                                        <UsersIcon className="w-3 h-3" />
                                        Ver Grupo
                                    </button>
                                ) : (
                                    <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block"></span> Online
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-background/30 space-y-4">
                    {isMessagesLoading ? (
                        <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div></div>
                    ) : (
                        <>
                            {messages?.map((msg, index) => {
                                const isMe = msg.senderId === 'me';
                                const showDate = index === 0 || formatDateLabel(msg.timestamp) !== formatDateLabel(messages[index - 1].timestamp);
                                
                                return (
                                    <React.Fragment key={msg.id}>
                                        {showDate && (
                                            <div className="flex justify-center my-4">
                                                <span className="text-[10px] bg-background border border-border text-muted px-3 py-1 rounded-full font-medium shadow-sm">
                                                    {formatDateLabel(msg.timestamp)}
                                                </span>
                                            </div>
                                        )}
                                        <MotionDiv
                                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}
                                        >
                                            <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl shadow-sm text-sm relative group transition-all ${
                                                isMe 
                                                    ? 'bg-primary text-white rounded-tr-none' 
                                                    : 'bg-surface border border-border text-on-surface rounded-tl-none'
                                            }`}>
                                                <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                                                <div className={`text-[9px] mt-1 text-right opacity-70 ${isMe ? 'text-white/80' : 'text-muted'}`}>
                                                    {formatTime(msg.timestamp)}
                                                    {isMe && msg.status === 'sent' && <span className="ml-1">✓</span>}
                                                </div>
                                            </div>
                                        </MotionDiv>
                                    </React.Fragment>
                                );
                            })}
                            <div ref={messagesEndRef} />
                        </>
                    )}
                </div>

                {/* Input Area */}
                <div className="p-4 bg-surface border-t border-border">
                    <form onSubmit={handleSendMessage} className="flex gap-2 items-end">
                        <div className="relative flex-1">
                            <input
                                ref={inputRef}
                                type="text"
                                value={inputMessage}
                                onChange={(e) => setInputMessage(e.target.value)}
                                placeholder="Digite sua mensagem..."
                                className="w-full bg-background border border-border focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-xl px-4 py-3 text-sm text-on-surface outline-none transition-all placeholder:text-muted"
                            />
                        </div>
                        <button 
                            type="submit"
                            disabled={!inputMessage.trim()}
                            className="p-3 bg-primary hover:bg-primary/90 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-xl shadow-md transition-all active:scale-95 disabled:scale-100 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary"
                        >
                            <ArrowUpIcon className="w-5 h-5" />
                        </button>
                    </form>
                </div>
            </div>
        );
    };

    return (
        <>
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity" onClick={onClose} />
            <MotionDiv
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed inset-y-0 right-0 z-50 w-full md:max-w-4xl bg-surface shadow-2xl flex overflow-hidden md:my-6 md:mr-6 md:h-[calc(100vh-3rem)] md:rounded-card border border-border"
            >
                {renderSidebar()}
                {renderChat()}
            </MotionDiv>

            <NewConversationModal 
                isOpen={isNewConversationOpen}
                onClose={() => setIsNewConversationOpen(false)}
                onConversationCreated={handleCreateConversation}
            />
        </>
    );
};

export default MessagesPanel;
