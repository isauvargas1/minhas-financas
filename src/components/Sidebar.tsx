import React, { useEffect, useRef } from 'react';
import {
    DashboardIcon,
    CreditCardIcon,
    TargetIcon,
    ReportIcon,
    SettingsIcon,
    LogoutIcon,
    UsersIcon,
    RepeatIcon,
    BriefcaseIcon,
    TrendingUpIcon,
    FileInvoiceIcon,
    ChartBarIcon,
    HandshakeIcon,
} from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useAuth } from '../contexts/AuthContext';
import { ShieldCheck } from 'lucide-react';

interface SidebarProps {
    isExpanded: boolean;
    setExpanded: (expanded: boolean) => void;
    onNavigate: (view: any) => void;
    currentView: string;
}

const Sidebar: React.FC<SidebarProps> = ({
    isExpanded,
    setExpanded,
    onNavigate,
    currentView,
}) => {
    const { activeWorkspace } = useWorkspace();
    const { user, logout } = useAuth();
    const isPJ = activeWorkspace.type === 'PJ';

    const handleLogout = async () => {
        try {
            await logout();
        } catch (error) {
            console.error('Erro ao sair:', error);
        }
    };

    /*
     * Abaixo de `lg` o menu é uma gaveta sobre o conteúdo (V-02/V-03): fecha ao
     * escolher uma seção, ao tocar fora dele e com Esc. No desktop o estado
     * continua controlado pelo hover (menu compacto × expandido).
     */
    const isMobileViewport = () => window.innerWidth < 1024;
    const firstItemRef = useRef<HTMLAnchorElement | null>(null);
    const navigate = (view: string) => {
        onNavigate(view);
        if (isMobileViewport()) setExpanded(false);
    };
    useEffect(() => {
        if (!isExpanded || !isMobileViewport()) return undefined;
        // Teclado no mobile: o menu vem antes do conteúdo no DOM, então o
        // foco entra nele ao abrir e volta ao botão de menu ao fechar com Esc.
        // No primeiro quadro da transição o `visibility` ainda é `hidden` e o
        // navegador ignora o foco: tenta de novo nos quadros seguintes.
        let frames = 0;
        let frame = 0;
        const focusFirstItem = () => {
            const item = firstItemRef.current;
            if (!item) return;
            item.focus();
            if (document.activeElement !== item && frames < 10) {
                frames += 1;
                frame = requestAnimationFrame(focusFirstItem);
            }
        };
        focusFirstItem();
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setExpanded(false);
            document.querySelector<HTMLButtonElement>('button[aria-controls="menu-principal"]')?.focus();
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isExpanded, setExpanded]);

    const menuItems = [
        {
            icon: <DashboardIcon />,
            text: 'Dashboard',
            id: 'dashboard',
        },

        ...(isPJ
            ? [
                  {
                      icon: <BriefcaseIcon />,
                      text: 'Clientes & Recebíveis',
                      id: 'clients_receivables',
                  },
                  {
                      icon: <HandshakeIcon />,
                      text: 'Empréstimos Corp.',
                      id: 'loans',
                  },
              ]
            : [
                  {
                      icon: <HandshakeIcon />,
                      text: 'Empréstimos',
                      id: 'loans',
                  },
              ]),

        {
            icon: <CreditCardIcon />,
            text: isPJ ? 'Cartões Corporativos' : 'Cartões de Crédito',
            id: 'cards',
        },
        {
            icon: isPJ ? <TrendingUpIcon /> : <TargetIcon />,
            text: isPJ ? 'Metas Empresariais' : 'Metas',
            id: 'goals',
        },
        {
            icon: <UsersIcon />,
            text: isPJ ? 'Rateios & Reembolsos' : 'Dividir Gastos',
            id: 'shared_expenses',
        },
        {
            icon: isPJ ? <FileInvoiceIcon /> : <RepeatIcon />,
            text: isPJ ? 'Contratos & Recorrências' : 'Assinaturas',
            id: 'recurring',
        },
        {
            icon: isPJ ? <ChartBarIcon /> : <ReportIcon />,
            text: isPJ ? 'Relatórios Empresariais' : 'Relatórios',
            id: 'reports',
        },
        {
            icon: <TrendingUpIcon />,
            text: 'Meu Plano',
            id: 'planos',
        },
        {
            icon: <SettingsIcon />,
            text: 'Configurações',
            id: 'settings',
        },
    ];

    return (
        <>
        {/*
         * Mobile: o menu aberto fica acima do Header (z-30) e do conteúdo; um
         * backdrop transparente entre os dois fecha o menu ao tocar fora, sem
         * mudar a aparência (mesmo padrão dos painéis do Header).
         */}
        {isExpanded && (
            <div
                className="fixed inset-0 z-40 bg-transparent lg:hidden"
                onClick={() => setExpanded(false)}
                aria-hidden="true"
            />
        )}
        <aside
            id="menu-principal"
            aria-label="Menu principal"
            className={`fixed lg:relative z-50 lg:z-30 h-screen bg-surface border-r border-border shadow-lg flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${
                isExpanded ? 'w-[var(--sidebar-width)]' : 'w-0 lg:w-16 max-lg:invisible'
            }`}
            onMouseEnter={() => window.innerWidth >= 1024 && setExpanded(true)}
            onMouseLeave={() => window.innerWidth >= 1024 && setExpanded(false)}
        >
            <div className="p-4 flex items-center justify-center border-b border-border min-h-[72px]">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-bold flex-shrink-0">
                    F
                </div>
                <span
                    className={`ml-3 font-bold text-primary dark:text-primary-on-dark text-xl whitespace-nowrap transition-opacity duration-200 ${
                        isExpanded ? 'opacity-100' : 'opacity-0'
                    }`}
                >
                    Finanças
                </span>
            </div>

            <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
                <ul className="flex flex-col h-full">
                    {menuItems.map((item, index) => (
                        <li key={item.id}>
                            <a
                                ref={index === 0 ? firstItemRef : undefined}
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    navigate(item.id);
                                }}
                                className={`flex items-center py-3 px-5 border-l-4 hover:bg-background transition-colors ${
                                    currentView === item.id
                                        ? 'border-primary bg-primary/10 text-primary dark:text-primary-on-dark'
                                        : 'border-transparent text-muted'
                                }`}
                                title={!isExpanded ? item.text : ''}
                            >
                                <div
                                    className={`flex-shrink-0 ${
                                        currentView === item.id ? 'text-primary dark:text-primary-on-dark' : ''
                                    }`}
                                >
                                    {item.icon}
                                </div>
                                <span
                                    className={`ml-4 whitespace-nowrap transition-opacity duration-200 ${
                                        isExpanded ? 'opacity-100' : 'opacity-0'
                                    }`}
                                >
                                    {item.text}
                                </span>
                            </a>
                        </li>
                    ))}

                    {user?.isAdmin && (
                        <li className="mt-auto pt-4 mb-2 border-t border-border mx-2">
                            <button
                                onClick={() => navigate('admin')}
                                className={`w-full flex items-center py-3 px-3 rounded-lg transition-all duration-200
                                    ${
                                        currentView === 'admin'
                                            ? 'bg-purple-600 text-white shadow-md'
                                            : 'text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                                    }
                                `}
                                title={!isExpanded ? 'Painel Admin' : ''}
                            >
                                <div className="flex-shrink-0 flex items-center justify-center w-6 h-6">
                                    <ShieldCheck className="w-5 h-5" strokeWidth={2} />
                                </div>
                                <span
                                    className={`ml-4 font-medium whitespace-nowrap transition-opacity duration-200 ${
                                        isExpanded ? 'opacity-100' : 'opacity-0'
                                    }`}
                                >
                                    Painel Admin
                                </span>
                            </button>
                        </li>
                    )}
                </ul>
            </nav>

            <div className="p-4 border-t border-border">
                <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center py-2 px-4 text-muted rounded-card hover:bg-background transition-colors"
                    title={!isExpanded ? 'Sair' : ''}
                >
                    <LogoutIcon />
                    <span
                        className={`ml-4 whitespace-nowrap transition-opacity duration-200 ${
                            isExpanded ? 'opacity-100' : 'opacity-0'
                        }`}
                    >
                        Sair
                    </span>
                </button>
            </div>
        </aside>
        </>
    );
};

export default Sidebar;