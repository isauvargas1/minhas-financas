import React, { useState, useRef, useEffect } from 'react';
// Corrigido: Trocamos TrashIcon por DeleteIcon
import { BellIcon, CheckIcon, DeleteIcon } from './Icons.tsx'; 
import { useNotifications, useMarkAsRead, useMarkAllAsRead, useDeleteNotification } from '../modules/notifications/hooks.ts';

// Nova função nativa para substituir o date-fns!
const timeAgo = (dateInput: string | Date) => {
    const date = new Date(dateInput);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'agora mesmo';
    
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `há ${diffInMinutes} min`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `há ${diffInHours} h`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 30) return `há ${diffInDays} dias`;
    
    return date.toLocaleDateString('pt-BR');
};

const NotificationBell: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    
    const { data: notifications = [] } = useNotifications();
    const markReadMutation = useMarkAsRead();
    const markAllMutation = useMarkAllAsRead();
    const deleteMutation = useDeleteNotification();

    const unreadCount = notifications.filter(n => !n.read).length;

    // Fecha ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleMarkAllRead = () => {
        const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
        if (unreadIds.length > 0) markAllMutation.mutate(unreadIds);
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Ícone do Sino */}
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-dark-200 rounded-full transition-colors"
            >
                <BellIcon className="w-6 h-6" />
                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white dark:border-dark-100">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white dark:bg-dark-200 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden z-50 animate-scale-in origin-top-right">
                    <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-dark-300">
                        <h3 className="font-bold text-gray-700 dark:text-white text-sm">Notificações</h3>
                        {unreadCount > 0 && (
                            <button 
                                onClick={handleMarkAllRead}
                                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                            >
                                Marcar tudo como lido
                            </button>
                        )}
                    </div>

                    <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                        {notifications.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 text-sm">
                                <BellIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                Nenhuma notificação.
                            </div>
                        ) : (
                            <ul>
                                {notifications.map(n => (
                                    <li 
                                        key={n.id} 
                                        className={`p-4 border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-dark-300 transition-colors flex gap-3 ${!n.read ? 'bg-indigo-50/40 dark:bg-indigo-900/10' : ''}`}
                                    >
                                        <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${!n.read ? 'bg-indigo-500' : 'bg-transparent'}`}></div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start">
                                                <p className={`text-sm ${!n.read ? 'font-bold text-gray-800 dark:text-white' : 'font-medium text-gray-600 dark:text-gray-300'}`}>
                                                    {n.title}
                                                </p>
                                                <span className="text-[10px] text-gray-400 shrink-0 ml-2">
                                                    {/* Usando a nossa função nativa */}
                                                    {timeAgo(n.createdAt)}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                                                {n.message}
                                            </p>
                                            
                                            {/* Ações */}
                                            <div className="flex items-center gap-3 mt-2">
                                                {!n.read && (
                                                    <button 
                                                        onClick={() => markReadMutation.mutate(n.id)}
                                                        className="text-[10px] font-bold text-indigo-600 hover:underline flex items-center gap-1"
                                                    >
                                                        <CheckIcon className="w-3 h-3" /> Marcar como lida
                                                    </button>
                                                )}
                                                <button 
                                                    onClick={() => deleteMutation.mutate(n.id)}
                                                    className="text-[10px] text-gray-400 hover:text-red-500 flex items-center gap-1"
                                                >
                                                    {/* Usando DeleteIcon em vez de TrashIcon */}
                                                    <DeleteIcon className="w-3 h-3" /> Remover
                                                </button>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationBell;