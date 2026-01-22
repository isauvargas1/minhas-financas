
import React, { useState, useEffect, useRef } from 'react';
import { BellIcon, EnvelopeIcon, SunIcon, MoonIcon, HamburgerIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon, CheckIcon, UsersIcon, BuildingIcon, BriefcaseIcon, PlusIcon, LogoutIcon } from './Icons.tsx';
import NotificationsPanel from './NotificationsPanel.tsx';
import MessagesPanel from './MessagesPanel.tsx';
import CreateWorkspaceModal from './CreateWorkspaceModal.tsx';
import { 
    useNotifications, useUnreadNotificationCount, useMarkAllNotificationsAsRead, 
    useMarkNotificationAsRead, useArchiveNotification 
} from '../modules/notifications/hooks.ts';
import { 
    useUnreadMessagesCount 
} from '../modules/messages/hooks.ts';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface HeaderProps {
    onToggleSidebar: () => void;
    isSidebarExpanded: boolean;
    onToggleDarkMode: () => void;
    isDarkMode: boolean;
    currentDate: Date;
    onCurrentDateChange: (newDate: Date) => void;
    onNavigate?: (view: string) => void;
    onOpenSplitGroup?: (groupId: string) => void;
}

const Header: React.FC<HeaderProps> = ({ 
    onToggleSidebar, isSidebarExpanded, onToggleDarkMode, isDarkMode, 
    currentDate, onCurrentDateChange, onNavigate, onOpenSplitGroup 
}) => {
    const { activeWorkspace, workspaces, switchWorkspace } = useWorkspace();
    
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [pickerYear, setPickerYear] = useState(currentDate.getFullYear());
    const [pickerMonth, setPickerMonth] = useState(currentDate.getMonth());
    const pickerRef = useRef<HTMLDivElement>(null);

    // --- State for Panels ---
    const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
    const [isMessagesOpen, setIsMessagesOpen] = useState(false);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [isCreateWorkspaceModalOpen, setIsCreateWorkspaceModalOpen] = useState(false);
    
    // --- Data Hooks ---
    // Notifications
    const { data: notifications } = useNotifications();
    const unreadNotifications = useUnreadNotificationCount();
    const markAllNotifications = useMarkAllNotificationsAsRead();
    const markNotification = useMarkNotificationAsRead();
    const archiveNotification = useArchiveNotification();

    // Messages
    const unreadMessages = useUnreadMessagesCount();

    const formattedDate = currentDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    const capitalizedDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

    const goToPreviousMonth = () => {
        onCurrentDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    };

    const goToNextMonth = () => {
        onCurrentDateChange(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    };
    
    const goToToday = () => {
        onCurrentDateChange(new Date());
    };
    
    // Click Outside Handlers
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
                setIsPickerOpen(false);
            }
            // Panels are handled by the backdrop overlay
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [pickerRef]);

    const handleDateSelect = () => {
        if(pickerYear > 1900 && pickerYear < 3000) {
            onCurrentDateChange(new Date(pickerYear, pickerMonth, 1));
        }
        setIsPickerOpen(false);
    };

    const handleOpenPicker = () => {
        setPickerYear(currentDate.getFullYear());
        setPickerMonth(currentDate.getMonth());
        setIsPickerOpen(true);
    };

    // --- Actions ---
    const toggleNotifications = () => {
        if (!isNotificationsOpen) {
            setIsMessagesOpen(false); // Close messages if opening notifications
            setIsUserMenuOpen(false);
        }
        setIsNotificationsOpen(!isNotificationsOpen);
    };

    const toggleMessages = () => {
        if (!isMessagesOpen) {
            setIsNotificationsOpen(false); // Close notifications if opening messages
            setIsUserMenuOpen(false);
        }
        setIsMessagesOpen(!isMessagesOpen);
    };

    const toggleUserMenu = () => {
        if (!isUserMenuOpen) {
            setIsNotificationsOpen(false);
            setIsMessagesOpen(false);
        }
        setIsUserMenuOpen(!isUserMenuOpen);
    };

    const handleSwitchWorkspace = (id: string) => {
        switchWorkspace(id);
        setIsUserMenuOpen(false);
    };

    const months = [...Array(12).keys()].map(i => {
        const monthName = new Date(0, i).toLocaleString('pt-BR', { month: 'long' });
        return monthName.charAt(0).toUpperCase() + monthName.slice(1);
    });

    const iconButtonBaseClass = "relative p-2 rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-background";
    const iconButtonActive = "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400";
    const iconButtonInactive = "bg-surface text-muted hover:bg-gray-100 dark:hover:bg-dark-200 hover:text-on-surface";

    // Badge styling reused for consistency
    const Badge = ({ count }: { count: number }) => (
        <span className="absolute top-0 right-0 flex h-4 w-4 -translate-y-1 translate-x-1 items-center justify-center rounded-full bg-red-500 ring-2 ring-background text-[10px] font-bold text-white shadow-sm animate-scale-in">
            {count > 9 ? '9+' : count}
        </span>
    );

    return (
        <header className="mb-8 relative z-30">
            {/* Backdrop for Panels */}
            {(isNotificationsOpen || isMessagesOpen || isUserMenuOpen) && (
                <div 
                    className="fixed inset-0 z-30 bg-transparent" 
                    onClick={() => { setIsNotificationsOpen(false); setIsMessagesOpen(false); setIsUserMenuOpen(false); }}
                />
            )}

            <div className="flex justify-between items-center flex-wrap gap-4">
                <div className="flex items-center">
                     <button
                        onClick={onToggleSidebar}
                        className="lg:hidden p-2 rounded-md bg-surface shadow-sm border border-border text-on-surface mr-4 hover:bg-background transition-colors"
                    >
                        <HamburgerIcon />
                    </button>
                    <div className="flex flex-col">
                        <h1 className="text-3xl font-bold text-primary font-sans tracking-tight">
                            {activeWorkspace.type === 'PJ' ? 'Finanças da Empresa' : 'Minhas Finanças'}
                        </h1>
                        {activeWorkspace.type === 'PJ' && (
                            <span className="text-xs text-teal-600 dark:text-teal-400 font-bold uppercase tracking-wider flex items-center gap-1 mt-0.5">
                                <BriefcaseIcon className="w-3 h-3" />
                                {activeWorkspace.name}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-center gap-2 order-last w-full sm:order-none sm:w-auto">
                    <button onClick={goToPreviousMonth} className="p-2 rounded-full bg-surface border border-border text-muted shadow-sm hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors" aria-label="Mês anterior">
                        <ChevronLeftIcon className="h-5 w-5" />
                    </button>
                    <div className="relative">
                        <div className="flex flex-col items-center">
                             <button onClick={handleOpenPicker} className="flex items-center gap-2 text-lg font-semibold text-on-surface min-w-[11rem] justify-center p-2 rounded-lg hover:bg-surface/50 transition-colors whitespace-nowrap" aria-label="Selecionar Mês e Ano">
                                <span>{capitalizedDate}</span>
                                <SearchIcon className="h-4 w-4 text-muted" />
                            </button>
                             <button onClick={goToToday} className="text-xs text-primary hover:underline font-medium">Hoje</button>
                        </div>
                        {isPickerOpen && (
                            <div ref={pickerRef} className="absolute top-full mt-2 bg-surface p-4 rounded-card shadow-xl z-20 w-64 border border-border animate-fade-in-fast">
                                <h4 className="text-center font-medium mb-3 text-on-surface">Selecione a Data</h4>
                                <div className="flex gap-2">
                                    <select 
                                        value={pickerMonth} 
                                        onChange={(e) => setPickerMonth(parseInt(e.target.value))}
                                        className="flex-1 border border-border bg-background text-on-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                        aria-label="Selecionar Mês"
                                    >
                                        {months.map((month, index) => (
                                            <option key={month} value={index}>{month}</option>
                                        ))}
                                    </select>
                                    <input 
                                        type="number" 
                                        value={pickerYear}
                                        onChange={(e) => setPickerYear(parseInt(e.target.value) || new Date().getFullYear())}
                                        className="w-24 border border-border bg-background text-on-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                        placeholder="Ano"
                                        aria-label="Digitar Ano"
                                    />
                                </div>
                                <button onClick={handleDateSelect} className="mt-4 w-full bg-primary hover:bg-primary/90 text-white font-medium py-2 px-4 rounded-lg transition-colors shadow-sm">
                                    Ir
                                </button>
                            </div>
                        )}
                    </div>
                    <button onClick={goToNextMonth} className="p-2 rounded-full bg-surface border border-border text-muted shadow-sm hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors" aria-label="Próximo mês">
                        <ChevronRightIcon className="h-5 w-5" />
                    </button>
                </div>
                
                <div className="flex items-center gap-3 relative">
                    {/* NOTIFICATIONS BUTTON */}
                    <div className="relative">
                        <button 
                            onClick={toggleNotifications}
                            className={`${iconButtonBaseClass} ${isNotificationsOpen ? iconButtonActive : iconButtonInactive}`}
                            aria-label="Notificações"
                            title="Centro de Notificações"
                        >
                            <BellIcon className="w-5 h-5" />
                            {unreadNotifications > 0 && <Badge count={unreadNotifications} />}
                        </button>
                        {isNotificationsOpen && notifications && (
                            <NotificationsPanel 
                                notifications={notifications} 
                                onClose={() => setIsNotificationsOpen(false)}
                                onMarkAllRead={() => markAllNotifications.mutate()}
                                onMarkAsRead={(id) => markNotification.mutate(id)}
                                onDelete={(id) => archiveNotification.mutate(id)}
                                onNavigate={onNavigate}
                            />
                        )}
                    </div>
                    
                    {/* MESSAGES BUTTON */}
                    <div className="relative">
                        <button 
                            onClick={toggleMessages}
                            className={`${iconButtonBaseClass} ${isMessagesOpen ? iconButtonActive : iconButtonInactive}`}
                            aria-label="Mensagens"
                            title="Centro de Mensagens"
                        >
                            <EnvelopeIcon className="w-5 h-5" />
                            {unreadMessages > 0 && <Badge count={unreadMessages} />}
                        </button>
                        {isMessagesOpen && (
                            <MessagesPanel 
                                onClose={() => setIsMessagesOpen(false)} 
                                onOpenSplitGroup={(groupId) => {
                                    if (onOpenSplitGroup) {
                                        onOpenSplitGroup(groupId);
                                        setIsMessagesOpen(false);
                                    }
                                }}
                            />
                        )}
                    </div>
                    
                    <div className="h-6 w-px bg-border mx-1"></div>

                    <button 
                        onClick={onToggleDarkMode} 
                        className={`${iconButtonBaseClass} ${iconButtonInactive}`}
                        aria-label="Alternar modo escuro"
                        title={isDarkMode ? "Ativar modo claro" : "Ativar modo escuro"}
                    >
                        {isDarkMode ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
                    </button>
                    
                    <div className="hidden sm:flex items-center gap-3 pl-2 relative">
                        <div 
                            className="flex flex-col items-end cursor-pointer"
                            onClick={toggleUserMenu}
                        >
                            <span className="text-sm font-semibold text-on-surface leading-tight">Olá, Usuário</span>
                            {activeWorkspace.type === 'PJ' ? (
                                <div className="flex flex-col items-end">
                                    <span className="text-[9px] bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 px-1.5 py-px rounded font-bold uppercase tracking-wider mb-px border border-teal-200 dark:border-teal-800">
                                        EMPRESA
                                    </span>
                                    <span className="text-[9px] text-muted truncate max-w-[120px]">
                                        {activeWorkspace.name}
                                    </span>
                                </div>
                            ) : (
                                <span className="text-[10px] bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-300 px-2 py-0.5 rounded font-bold uppercase tracking-wider border border-indigo-100 dark:border-indigo-800">
                                    PESSOAL
                                </span>
                            )}
                        </div>
                        <div 
                            onClick={toggleUserMenu}
                            className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold shadow-md cursor-pointer hover:shadow-lg transition-all hover:scale-105 ring-2 ring-white dark:ring-dark-100 ${activeWorkspace.type === 'PJ' ? 'bg-teal-600' : 'bg-gradient-to-tr from-indigo-600 to-purple-600'}`}
                        >
                            {activeWorkspace.type === 'PJ' ? 'PJ' : 'U'}
                        </div>

                        {/* USER MENU / WORKSPACE SWITCHER */}
                        {isUserMenuOpen && (
                            <div className="absolute top-full right-0 mt-3 w-72 bg-surface rounded-card shadow-2xl border border-border z-50 overflow-hidden animate-fade-in-fast flex flex-col">
                                
                                {/* User Info Header */}
                                <div className="p-4 bg-background/50 border-b border-border flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
                                        U
                                    </div>
                                    <div>
                                        <p className="font-bold text-sm text-on-surface">Usuário Principal</p>
                                        <p className="text-xs text-muted">usuario@exemplo.com</p>
                                    </div>
                                </div>

                                {/* Workspaces List */}
                                <div className="p-2 border-b border-border max-h-[200px] overflow-y-auto custom-scrollbar">
                                    <p className="px-2 py-1.5 text-[10px] font-bold text-muted uppercase tracking-wider">Perfis Financeiros</p>
                                    
                                    {/* Personal Workspace (Fixed Logic) */}
                                    {workspaces.filter(ws => ws.type === 'PF').map(ws => (
                                        <button
                                            key={ws.id}
                                            onClick={() => handleSwitchWorkspace(ws.id)}
                                            className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors text-sm mb-1 ${
                                                activeWorkspace.id === ws.id 
                                                    ? 'bg-primary/10 text-primary font-medium' 
                                                    : 'text-on-surface hover:bg-background'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`p-1.5 rounded-md ${activeWorkspace.id === ws.id ? 'bg-primary text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                                                    <UsersIcon className="w-4 h-4" />
                                                </div>
                                                <div className="text-left">
                                                    <span className="block leading-none">Pessoal</span>
                                                    <span className="text-[10px] opacity-70 font-normal">Finanças pessoais</span>
                                                </div>
                                            </div>
                                            {activeWorkspace.id === ws.id && <CheckIcon className="w-4 h-4" />}
                                        </button>
                                    ))}

                                    {/* Business Workspaces */}
                                    {workspaces.filter(ws => ws.type === 'PJ').map(ws => (
                                        <button
                                            key={ws.id}
                                            onClick={() => handleSwitchWorkspace(ws.id)}
                                            className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors text-sm mb-1 ${
                                                activeWorkspace.id === ws.id 
                                                    ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400 font-medium' 
                                                    : 'text-on-surface hover:bg-background'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`p-1.5 rounded-md ${activeWorkspace.id === ws.id ? 'bg-teal-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                                                    <BriefcaseIcon className="w-4 h-4" />
                                                </div>
                                                <div className="text-left">
                                                    <span className="block leading-none">{ws.name}</span>
                                                    <span className="text-[10px] opacity-70 font-normal">Empresa</span>
                                                </div>
                                            </div>
                                            {activeWorkspace.id === ws.id && <CheckIcon className="w-4 h-4" />}
                                        </button>
                                    ))}
                                </div>

                                {/* Actions */}
                                <div className="p-2 bg-background/30">
                                    <button 
                                        onClick={() => {
                                            setIsUserMenuOpen(false);
                                            setIsCreateWorkspaceModalOpen(true);
                                        }}
                                        className="w-full flex items-center gap-2 p-2 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 rounded-lg transition-colors font-medium"
                                    >
                                        <PlusIcon className="w-4 h-4" />
                                        Adicionar empresa
                                    </button>
                                    <button 
                                        onClick={() => {/* Logout logic */ setIsUserMenuOpen(false); }}
                                        className="w-full flex items-center gap-2 p-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-colors mt-1"
                                    >
                                        <LogoutIcon className="w-4 h-4" />
                                        Sair
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <CreateWorkspaceModal 
                isOpen={isCreateWorkspaceModalOpen}
                onClose={() => setIsCreateWorkspaceModalOpen(false)}
            />

            <style>{`
                @keyframes scale-in {
                    from { transform: scale(0) translate(25%, -25%); opacity: 0; }
                    to { transform: scale(1) translate(25%, -25%); opacity: 1; }
                }
                .animate-scale-in {
                    animation: scale-in 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
                }
                @keyframes fade-in-fast {
                    from { opacity: 0; transform: translateY(-5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in-fast {
                    animation: fade-in-fast 0.2s ease-out forwards;
                }
                 .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: var(--color-border);
                    border-radius: 20px;
                }
            `}</style>
        </header>
    );
};

export default Header;
