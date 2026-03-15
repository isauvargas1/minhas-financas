
import React from 'react';
import { DashboardIcon, CreditCardIcon, TargetIcon, ReportIcon, SettingsIcon, 
LogoutIcon, UsersIcon, RepeatIcon, BriefcaseIcon, TrendingUpIcon, FileInvoiceIcon, 
ChartBarIcon, HandshakeIcon } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useAuth } from '../contexts/AuthContext';
import { ShieldCheck } from 'lucide-react';

interface SidebarProps {
    isExpanded: boolean;
    setExpanded: (expanded: boolean) => void;
    onNavigate: (view: any) => void;
    currentView: string;
}

const Sidebar: React.FC<SidebarProps> = ({ isExpanded, setExpanded, onNavigate, currentView }) => {
    const { activeWorkspace } = useWorkspace();
    const { user } = useAuth();
    const isPJ = activeWorkspace.type === 'PJ';
    
    const menuItems = [
        { 
            icon: <DashboardIcon />, 
            text: 'Dashboard', 
            id: 'dashboard' 
        },
        
        // Common Items but localized
        ...(isPJ ? [
            { icon: <BriefcaseIcon />, text: 'Clientes & Recebíveis', id: 'clients_receivables' },
            { icon: <HandshakeIcon />, text: 'Empréstimos Corp.', id: 'loans' },
        ] : [
            { icon: <HandshakeIcon />, text: 'Empréstimos', id: 'loans' },
        ]),

        { 
            icon: <CreditCardIcon />, 
            text: isPJ ? 'Cartões Corporativos' : 'Cartões de Crédito', 
            id: 'cards' 
        },
        { 
            icon: isPJ ? <TrendingUpIcon /> : <TargetIcon />, 
            text: isPJ ? 'Metas Empresariais' : 'Metas', 
            id: 'goals' 
        },
        { 
            icon: <UsersIcon />, 
            text: isPJ ? 'Rateios & Reembolsos' : 'Dividir Gastos', 
            id: 'shared_expenses' 
        },
        { 
            icon: isPJ ? <FileInvoiceIcon /> : <RepeatIcon />, 
            text: isPJ ? 'Contratos & Recorrências' : 'Assinaturas', 
            id: 'recurring' 
        },
        { 
            icon: isPJ ? <ChartBarIcon /> : <ReportIcon />, 
            text: isPJ ? 'Relatórios Empresariais' : 'Relatórios', 
            id: 'reports' 
        },
        {
            icon: <TrendingUpIcon />, // Pode usar outro ícone se preferir, como o CrownIcon se existir
            text: 'Meu Plano',
            id: 'planos'
        },
        { 
            icon: <SettingsIcon />, 
            text: 'Configurações', 
            id: 'settings' 
        },
    ];

    return (
        <aside 
            className={`fixed lg:relative z-30 h-screen bg-surface border-r border-border shadow-lg flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'w-[var(--sidebar-width)]' : 'w-0 lg:w-16'}`}
            onMouseEnter={() => window.innerWidth >= 1024 && setExpanded(true)}
            onMouseLeave={() => window.innerWidth >= 1024 && setExpanded(false)}
        >
            <div className="p-4 flex items-center justify-center border-b border-border min-h-[72px]">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-bold flex-shrink-0">
                    F
                </div>
                <span className={`ml-3 font-bold text-primary text-xl whitespace-nowrap transition-opacity duration-200 ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
                    Finanças
                </span>
            </div>
            
            <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
                <ul className="flex flex-col h-full">
                    {menuItems.map((item) => (
                        <li key={item.id}>
                            <a 
                                href="#" 
                                onClick={(e) => {
                                    e.preventDefault();
                                    onNavigate(item.id);
                                }}
                                className={`flex items-center py-3 px-5 border-l-4 hover:bg-background transition-colors ${currentView === item.id ? 'border-primary bg-primary/10 text-primary' : 'border-transparent text-muted'}`}
                                title={!isExpanded ? item.text : ''}
                            >
                                <div className={`flex-shrink-0 ${currentView === item.id ? 'text-primary' : ''}`}>{item.icon}</div>
                                <span className={`ml-4 whitespace-nowrap transition-opacity duration-200 ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
                                    {item.text}
                                </span>
                            </a>
                        </li>
                    ))}

                    {/* --- BOTÃO SECRETO DO ADMIN --- */}
                    {user?.isAdmin && (
                        <li className="mt-auto pt-4 mb-2 border-t border-border mx-2">
                            <button
                                onClick={() => onNavigate('admin')}
                                className={`w-full flex items-center py-3 px-3 rounded-lg transition-all duration-200
                                    ${currentView === 'admin' 
                                        ? 'bg-purple-600 text-white shadow-md' 
                                        : 'text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20'}
                                `}
                                title={!isExpanded ? 'Painel Admin' : ''}
                            >
                                <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
                                    <ShieldCheck className="w-5 h-5" strokeWidth={2} />
                                </div>
                                <span className={`ml-4 font-medium whitespace-nowrap transition-opacity duration-200 ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
                                    Painel Admin
                                </span>
                            </button>
                        </li>
                    )}
                </ul>
            </nav>
            
            <div className="p-4 border-t border-border">
                <a href="#" className="flex items-center py-2 px-4 text-muted rounded-card hover:bg-background transition-colors">
                     <LogoutIcon />
                    <span className={`ml-4 whitespace-nowrap transition-opacity duration-200 ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>Sair</span>
                </a>
            </div>
        </aside>
    );
};

export default Sidebar;
