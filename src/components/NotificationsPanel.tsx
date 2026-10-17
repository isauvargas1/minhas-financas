
import React, { useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, type MotionProps } from 'framer-motion';
import { NotificationItem, NotificationType } from '../types.ts';
import { CheckIcon, CloseIcon, DeleteIcon, WarningIcon, DynamicIcon } from './Icons.tsx';
import { pressTargetProps, usePointerOriginTracking } from '../lib/pressOrigin.ts';

interface NotificationsPanelProps {
    notifications: NotificationItem[];
    // P5-D1: carregamento, erro e páginas. O contador (chip) é o total exato do backend.
    status: 'loading' | 'error' | 'ready';
    errorMessage?: string | null;
    noticeMessage?: string | null;
    unreadChip: string;
    unreadChipLabel: string;
    hasMore: boolean;
    isLoadingMore: boolean;
    isMarking: boolean;
    // "Excluir para mim": só owner, admin e member (nunca viewer).
    canDelete: boolean;
    isDeleting: boolean;
    onLoadMore: () => void;
    onRetry: () => void;
    onClose: () => void;
    onMarkAllRead: () => void;
    onMarkAsRead: (id: string) => void;
    onArchive: (id: string) => void; // Arquivar só para o próprio usuário (todos os perfis)
    onDeleteForMe: (id: string) => void; // Pede a confirmação de exclusão só para o próprio usuário
    onNavigate?: (route: string) => void; // Add navigation support
}

const MotionDiv = motion.div as React.ComponentType<React.HTMLAttributes<HTMLDivElement> & MotionProps & React.RefAttributes<HTMLDivElement>>;

/** Folga mínima entre o painel e as bordas da tela. */
const VIEWPORT_MARGIN_PX = 8;

/**
 * O painel é ancorado à direita do sino. Quando o cabeçalho quebra a linha
 * (celular e telas estreitas), o sino fica à esquerda e o painel sairia da
 * tela pela esquerda, deixando as ações fora do alcance: só nesse caso ele é
 * deslocado para dentro da tela. Sem transbordo, nada muda.
 */
const useKeepInsideViewport = () => {
    const ref = useRef<HTMLDivElement>(null);
    const [shiftPx, setShiftPx] = useState(0);
    useLayoutEffect(() => {
        const fit = () => {
            const panel = ref.current;
            const anchor = panel?.offsetParent;
            if (!panel || !anchor) return;
            // Borda esquerda natural (ancorada à direita do contêiner do sino),
            // sem depender da escala da animação de entrada.
            const naturalLeft = anchor.getBoundingClientRect().right - panel.offsetWidth;
            setShiftPx(Math.max(0, Math.ceil(VIEWPORT_MARGIN_PX - naturalLeft)));
        };
        fit();
        window.addEventListener('resize', fit);
        return () => window.removeEventListener('resize', fit);
    }, []);
    return { ref, shiftPx };
};

const NotificationsPanel: React.FC<NotificationsPanelProps> = ({ 
    notifications, status, errorMessage, noticeMessage, unreadChip, unreadChipLabel,
    hasMore, isLoadingMore, isMarking, canDelete, isDeleting, onLoadMore, onRetry, onClose, onMarkAllRead, onMarkAsRead, onArchive, onDeleteForMe, onNavigate
}) => {
    const { ref: panelRef, shiftPx } = useKeepInsideViewport();
    // P5-E1.1: o clique de um toque vai para o item ou botão em que o toque
    // começou, mesmo que a lista tenha se deslocado (outro aviso arquivado
    // saindo) entre o toque e o clique.
    usePointerOriginTracking();
    // P5-E1.1: no framer-motion 10.16, o `AnimatePresence` tira do DOM os avisos
    // que terminaram de sair com um re-render agendado por um contador
    // capturado num render anterior. Se um aviso começa a sair logo depois de
    // outro terminar (antes desse re-render), a remoção dele vira uma
    // atualização igual, que o React descarta, e o aviso fica no DOM invisível
    // e clicável. Re-renderizar o painel a cada `onExitComplete` conclui a
    // remoção.
    const [, setExitCompletions] = useState(0);
    const handleExitComplete = () => setExitCompletions((count) => count + 1);
    
    const getIcon = (type: NotificationType) => {
        switch(type) {
            case 'meta': return <DynamicIcon name="Target" className="w-5 h-5 text-purple-600" />;
            case 'cartaoCredito': return <DynamicIcon name="CreditCard" className="w-5 h-5 text-yellow-600" />;
            case 'alertaFinanceiro': return <WarningIcon className="w-5 h-5 text-red-600" />;
            case 'gastoRecorrente': return <DynamicIcon name="Repeat" className="w-5 h-5 text-orange-600" />;
            case 'divisaoDespesas': return <DynamicIcon name="Users" className="w-5 h-5 text-blue-600" />;
            case 'sistema': return <DynamicIcon name="Settings" className="w-5 h-5 text-gray-600" />;
            default: return <DynamicIcon name="InfoCircle" className="w-5 h-5 text-indigo-600" />;
        }
    };

    const getBgColor = (type: NotificationType) => {
        switch(type) {
            case 'meta': return 'bg-purple-100 dark:bg-purple-900/20';
            case 'cartaoCredito': return 'bg-yellow-100 dark:bg-yellow-900/20';
            case 'alertaFinanceiro': return 'bg-red-100 dark:bg-red-900/20';
            case 'gastoRecorrente': return 'bg-orange-100 dark:bg-orange-900/20';
            case 'divisaoDespesas': return 'bg-blue-100 dark:bg-blue-900/20';
            case 'sistema': return 'bg-gray-100 dark:bg-gray-800';
            default: return 'bg-indigo-100 dark:bg-indigo-900/20';
        }
    };

    const formatDate = (isoString: string) => {
        const date = new Date(isoString);
        const now = new Date();
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
        
        if (diffInSeconds < 60) return 'Agora';
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min atrás`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} h atrás`;
        return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    };

    const handleItemClick = (notif: NotificationItem) => {
        onMarkAsRead(notif.id);
        if (notif.actionRoute && onNavigate) {
            onNavigate(notif.actionRoute);
            onClose();
        }
    };

    return (
        <MotionDiv
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            ref={panelRef}
            style={{ maxWidth: `calc(100vw - ${2 * VIEWPORT_MARGIN_PX}px)`, ...(shiftPx > 0 ? { right: -shiftPx } : {}) }}
            className="absolute top-14 right-0 w-80 sm:w-96 bg-surface rounded-card shadow-2xl border border-border z-50 flex flex-col max-h-[80vh] overflow-hidden origin-top-right"
        >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-surface z-10 relative">
                <div className="flex items-center gap-2">
                    <h3 className="font-bold text-on-surface">Notificações</h3>
                    <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-bold" title={unreadChipLabel}>
                        <span aria-hidden="true">{unreadChip}</span>
                        <span className="sr-only">{unreadChipLabel}</span>
                    </span>
                </div>
                <div className="flex gap-2 items-center">
                    <button 
                        type="button"
                        onClick={onMarkAllRead}
                        disabled={isMarking}
                        aria-busy={isMarking}
                        className="text-xs text-primary hover:underline font-medium disabled:opacity-60 disabled:no-underline"
                    >
                        Marcar exibidas como lidas
                    </button>
                    <button type="button" onClick={onClose} aria-label="Fechar notificações" className="p-1 text-muted hover:text-on-surface rounded-full hover:bg-background transition-colors">
                        <CloseIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {noticeMessage && (
                <div role="alert" className="px-4 py-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-b border-border">
                    {noticeMessage}
                </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-background/50">
                {status === 'loading' ? (
                    <div role="status" className="p-10 text-center text-sm text-muted">
                        Carregando notificações…
                    </div>
                ) : status === 'error' ? (
                    <div role="alert" className="p-10 text-center text-muted flex flex-col items-center justify-center h-full">
                        <div className="w-16 h-16 bg-background rounded-full flex items-center justify-center mb-4 border border-border">
                            <WarningIcon className="w-8 h-8 text-red-600" />
                        </div>
                        <p className="text-sm font-medium text-on-surface">{errorMessage || 'Não foi possível carregar as notificações. Tente novamente.'}</p>
                        <button type="button" onClick={onRetry} className="mt-3 text-xs text-primary hover:underline font-medium">
                            Tentar novamente
                        </button>
                    </div>
                ) : notifications.length === 0 && hasMore ? (
                    <div className="p-10 text-center text-muted flex flex-col items-center justify-center h-full">
                        <p className="text-sm font-medium text-on-surface">Nada para exibir entre as mais recentes</p>
                        <p className="text-xs text-muted mt-1">As mais recentes foram arquivadas ou excluídas por você, ou expiraram. Use “Carregar mais” para procurar as anteriores.</p>
                    </div>
                ) : notifications.length === 0 ? (
                    <div className="p-10 text-center text-muted flex flex-col items-center justify-center h-full">
                        <div className="w-16 h-16 bg-background rounded-full flex items-center justify-center mb-4 border border-border">
                            <DynamicIcon name="BellOff" className="w-8 h-8 text-muted/50" />
                        </div>
                        <p className="text-sm font-medium text-on-surface">Tudo limpo por aqui!</p>
                        <p className="text-xs text-muted mt-1">Você não tem novas notificações.</p>
                    </div>
                ) : (
                    <AnimatePresence initial={false} onExitComplete={handleExitComplete}>
                        {notifications.map((notif) => (
                            <MotionDiv
                                key={notif.id}
                                layout
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                                {...pressTargetProps}
                                onClick={() => handleItemClick(notif)}
                                className={`p-4 border-b border-border hover:bg-surface transition-colors cursor-pointer relative group [@media(hover:none)]:pb-12 ${notif.status === 'unread' ? 'bg-primary/5' : 'bg-surface'}`}
                            >
                                <div className="flex gap-3">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${getBgColor(notif.type)}`}>
                                        {getIcon(notif.type)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start mb-1">
                                            <h4 className={`text-sm font-semibold truncate pr-4 ${notif.status === 'unread' ? 'text-on-surface' : 'text-muted'}`}>
                                                {notif.title}
                                            </h4>
                                            <span className="text-[10px] text-muted whitespace-nowrap">
                                                {formatDate(notif.createdAt)}
                                            </span>
                                        </div>
                                        <p className={`text-xs leading-relaxed ${notif.status === 'unread' ? 'text-on-surface opacity-90' : 'text-muted'}`}>
                                            {notif.message}
                                        </p>
                                        
                                        {notif.actionLabel && (
                                            <div className="mt-2">
                                                <span className="text-[10px] font-bold text-primary hover:underline uppercase tracking-wide">
                                                    {notif.actionLabel} →
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Ações: no hover (ou foco) em telas com mouse; sempre visíveis no celular */}
                                <div className="absolute bottom-2 right-2 flex gap-1 transition-opacity [@media(hover:hover)]:bottom-auto [@media(hover:hover)]:top-2 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
                                    {canDelete && (
                                        <button
                                            type="button"
                                            {...pressTargetProps}
                                            onClick={(e) => { e.stopPropagation(); onDeleteForMe(notif.id); }}
                                            disabled={isDeleting}
                                            className="p-1.5 [@media(hover:none)]:p-2 text-muted hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary bg-surface rounded-full shadow-sm border border-border disabled:opacity-60"
                                            title="Excluir para mim"
                                            aria-label={`Excluir para mim: ${notif.title}`}
                                        >
                                            <DeleteIcon className="w-3 h-3" />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        {...pressTargetProps}
                                        onClick={(e) => { e.stopPropagation(); onArchive(notif.id); }}
                                        className="p-1.5 [@media(hover:none)]:p-2 text-muted hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary bg-surface rounded-full shadow-sm border border-border"
                                        title="Arquivar para mim"
                                        aria-label={`Arquivar para mim: ${notif.title}`}
                                    >
                                        <CloseIcon className="w-3 h-3" />
                                    </button>
                                </div>
                                
                                {notif.status === 'unread' && (
                                    <span className="absolute top-1/2 right-3 transform -translate-y-1/2 w-2 h-2 bg-primary rounded-full [@media(hover:hover)]:group-hover:opacity-0 transition-opacity shadow-sm"></span>
                                )}
                            </MotionDiv>
                        ))}
                    </AnimatePresence>
                )}
                {status === 'ready' && hasMore && (
                    <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={isLoadingMore}
                        className="w-full p-3 text-xs text-primary hover:underline font-medium disabled:opacity-60 disabled:no-underline"
                    >
                        {isLoadingMore ? 'Carregando…' : 'Carregar mais'}
                    </button>
                )}
            </div>
        </MotionDiv>
    );
};

export default NotificationsPanel;
