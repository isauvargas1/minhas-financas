
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { NotificationItem, NotificationType } from '../types.ts';
import { CheckIcon, CloseIcon, WarningIcon, DynamicIcon } from './Icons.tsx';

interface NotificationsPanelProps {
    notifications: NotificationItem[];
    onClose: () => void;
    onMarkAllRead: () => void;
    onMarkAsRead: (id: string) => void;
    onDelete: (id: string) => void; // Archive
    onNavigate?: (route: string) => void; // Add navigation support
}

const NotificationsPanel: React.FC<NotificationsPanelProps> = ({ 
    notifications, onClose, onMarkAllRead, onMarkAsRead, onDelete, onNavigate
}) => {
    
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
        <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute top-14 right-0 w-80 sm:w-96 bg-surface rounded-card shadow-2xl border border-border z-50 flex flex-col max-h-[80vh] overflow-hidden origin-top-right"
        >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-surface z-10 relative">
                <div className="flex items-center gap-2">
                    <h3 className="font-bold text-on-surface">Notificações</h3>
                    <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-bold">
                        {notifications.filter(n => n.status === 'unread').length}
                    </span>
                </div>
                <div className="flex gap-2 items-center">
                    <button 
                        onClick={onMarkAllRead}
                        className="text-xs text-primary hover:underline font-medium"
                    >
                        Marcar todas lidas
                    </button>
                    <button onClick={onClose} className="p-1 text-muted hover:text-on-surface rounded-full hover:bg-background transition-colors">
                        <CloseIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-background/50">
                {notifications.length === 0 ? (
                    <div className="p-10 text-center text-muted flex flex-col items-center justify-center h-full">
                        <div className="w-16 h-16 bg-background rounded-full flex items-center justify-center mb-4 border border-border">
                            <DynamicIcon name="BellOff" className="w-8 h-8 text-muted/50" />
                        </div>
                        <p className="text-sm font-medium text-on-surface">Tudo limpo por aqui!</p>
                        <p className="text-xs text-muted mt-1">Você não tem novas notificações.</p>
                    </div>
                ) : (
                    <AnimatePresence initial={false}>
                        {notifications.map((notif) => (
                            <motion.div 
                                key={notif.id}
                                layout
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                                onClick={() => handleItemClick(notif)}
                                className={`p-4 border-b border-border hover:bg-surface transition-colors cursor-pointer relative group ${notif.status === 'unread' ? 'bg-primary/5' : 'bg-surface'}`}
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
                                
                                {/* Hover Actions */}
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onDelete(notif.id); }}
                                    className="absolute top-2 right-2 p-1.5 text-muted hover:text-error opacity-0 group-hover:opacity-100 transition-opacity bg-surface rounded-full shadow-sm border border-border"
                                    title="Arquivar"
                                >
                                    <CloseIcon className="w-3 h-3" />
                                </button>
                                
                                {notif.status === 'unread' && (
                                    <span className="absolute top-1/2 right-3 transform -translate-y-1/2 w-2 h-2 bg-primary rounded-full group-hover:opacity-0 transition-opacity shadow-sm"></span>
                                )}
                            </motion.div>
                        ))}
                    </AnimatePresence>
                )}
            </div>
        </motion.div>
    );
};

export default NotificationsPanel;
