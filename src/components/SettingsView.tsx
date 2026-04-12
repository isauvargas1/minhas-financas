import React, { useEffect, useMemo, useState } from 'react';
import type { EntityItem, Workspace } from '../types.ts';
import {
    PlusIcon,
    EditIcon,
    DeleteIcon,
    SearchIcon,
    CloseIcon,
    WarningIcon,
    BackIcon,
    BriefcaseIcon,
    BellIcon,
    PaletteIcon,
    UsersIcon,
} from './Icons.tsx';
import * as TablerIcons from '@tabler/icons-react';
import PersonalizationView from './PersonalizationView.tsx';
import MembersManagerModal from './MembersManagerModal.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useUpdateWorkspace } from '../modules/workspaces/hooks.ts';
import { useSettingsCatalogScreen } from '../modules/settings-catalog/useSettingsCatalogScreen.ts';
import type { SettingsCatalogItem, SettingsCatalogStatus, SettingsCatalogTransactionSubtype } from '../modules/settings-catalog/types.ts';
import { createPortal } from 'react-dom';

interface SettingsViewProps {
    data?: {
        productsServices: EntityItem[];
        expenseTypes: EntityItem[];
        categories: EntityItem[];
        paymentTypes: EntityItem[];
        incomeTypes: EntityItem[];
        wallets: EntityItem[];
        costCenters?: EntityItem[];
    };
    onUpdate?: (key: string, newData: EntityItem[]) => void;
}

type ViewMode = 'main' | 'cadastros' | 'personalizacao' | 'workspace';

const CATEGORY_SUBTYPE_OPTIONS: Array<{
    key: SettingsCatalogTransactionSubtype;
    label: string;
}> = [
    { key: 'receita', label: 'Receitas' },
    { key: 'despesa', label: 'Despesas' },
    { key: 'investimento', label: 'Investimentos' },
    { key: 'parcelado', label: 'Parcelados' },
];

const ICON_CATEGORIES = [
    { label: 'Todos', term: '' },
    { label: 'Financeiro', term: 'currency money coin wallet bank cash credit receipt' },
    { label: 'Gráficos', term: 'chart graph activity report analytics' },
    { label: 'Comércio', term: 'shopping cart basket bag gift package store' },
    { label: 'Dispositivos', term: 'device phone laptop desktop cpu' },
    { label: 'Casa', term: 'home building tool hammer kitchen' },
];

const getIconComponent = (iconName: string) => {
    const possibleNames = [iconName, `Icon${iconName}`];
    for (const name of possibleNames) {
        // @ts-ignore
        if (TablerIcons[name]) return TablerIcons[name] as React.FC<any>;
        // @ts-ignore
        if (TablerIcons.default && TablerIcons.default[name]) return TablerIcons.default[name] as React.FC<any>;
    }
    return undefined;
};

const getAllIconKeys = () => {
    const keys = new Set<string>();
    Object.keys(TablerIcons).forEach((key) => {
        if (key.startsWith('Icon')) keys.add(key);
    });
    // @ts-ignore
    if (TablerIcons.default) {
        // @ts-ignore
        Object.keys(TablerIcons.default).forEach((key) => {
            if (key.startsWith('Icon')) keys.add(key);
        });
    }
    return Array.from(keys);
};

const renderInPortal = (children: React.ReactNode) => {
    if (typeof document === 'undefined') return null;
    return createPortal(children, document.body);
};

const SettingsView: React.FC<SettingsViewProps> = () => {
    const { activeWorkspace, reloadWorkspaces } = useWorkspace();
    const updateWorkspaceMutation = useUpdateWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';

    const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
    const canManageMembers = ['owner', 'admin'].includes(activeWorkspace.myRole || '');

    const [viewMode, setViewMode] = useState<ViewMode>('main');

    const {
        sections,
        activeSection,
        activeSectionKey,
        setActiveSectionKey,
        search,
        setSearch,
        includeInactive,
        setIncludeInactive,
        transactionSubtype,
        setTransactionSubtype,
        items,
        stats,
        feedback,
        clearFeedback,
        error,
        isLoading,
        isFetching,
        isModalOpen,
        modalMode,
        selectedItem,
        openCreateModal,
        openEditModal,
        closeModal,
        submitItem,
        removeItem,
    } = useSettingsCatalogScreen();

    const [itemToDelete, setItemToDelete] = useState<SettingsCatalogItem | null>(null);

    const [itemName, setItemName] = useState('');
    const [itemIcon, setItemIcon] = useState('');
    const [itemColor, setItemColor] = useState('#6366f1');
    const [itemStroke, setItemStroke] = useState<number>(2);
    const [itemStatus, setItemStatus] = useState<SettingsCatalogStatus>('active');
    const [iconSearch, setIconSearch] = useState('');
    const [selectedIconCategory, setSelectedIconCategory] = useState('Todos');
    const [visibleIconCount, setVisibleIconCount] = useState(72);

    const [wsName, setWsName] = useState(activeWorkspace.name);
    const [wsCnpj, setWsCnpj] = useState(activeWorkspace.cnpj || '');
    const [wsColor, setWsColor] = useState(activeWorkspace.themeColor);
    const [wsAlerts, setWsAlerts] = useState(
        activeWorkspace.alertPreferences || {
            billing: true,
            accountsPayable: true,
            delinquency: true,
            lowMargin: false,
        }
    );

    useEffect(() => {
    const shouldLockScroll = isModalOpen || !!itemToDelete || isMembersModalOpen;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;

    if (shouldLockScroll) {
        const scrollbarWidth =
            window.innerWidth - document.documentElement.clientWidth;

        document.body.style.overflow = 'hidden';

        if (scrollbarWidth > 0) {
            document.body.style.paddingRight = `${scrollbarWidth}px`;
        }
    }

    return () => {
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPaddingRight;
    };
}, [isModalOpen, itemToDelete, isMembersModalOpen]);

    useEffect(() => {
        if (viewMode === 'workspace') {
            setWsName(activeWorkspace.name);
            setWsCnpj(activeWorkspace.cnpj || '');
            setWsColor(activeWorkspace.themeColor);
            setWsAlerts(
                activeWorkspace.alertPreferences || {
                    billing: true,
                    accountsPayable: true,
                    delinquency: true,
                    lowMargin: false,
                }
            );
        }
    }, [viewMode, activeWorkspace]);

    useEffect(() => {
        if (!isModalOpen) return;

        setIconSearch('');
        setSelectedIconCategory('Todos');
        setVisibleIconCount(72);

        if (selectedItem) {
            setItemName(selectedItem.name);
            setItemIcon(selectedItem.icon || '');
            setItemColor(selectedItem.color || '#6366f1');
            setItemStroke(selectedItem.stroke || 2);
            setItemStatus(selectedItem.status || 'active');
        } else {
            setItemName('');
            setItemIcon('');
            setItemColor('#6366f1');
            setItemStroke(2);
            setItemStatus('active');
        }
    }, [isModalOpen, selectedItem]);

    const allIconKeys = useMemo(() => getAllIconKeys(), []);

    const filteredIcons = useMemo(() => {
        const lowerSearch = iconSearch.toLowerCase().trim();
        const searchTerms = lowerSearch.split(' ').filter(Boolean);

        const selectedCategoryConfig =
            ICON_CATEGORIES.find((category) => category.label === selectedIconCategory) ||
            ICON_CATEGORIES[0];

        const categoryTerms = selectedCategoryConfig.term
            .toLowerCase()
            .split(' ')
            .filter(Boolean);

        return allIconKeys.filter((key) => {
            const lowerKey = key.toLowerCase();

            const matchesCategory =
                categoryTerms.length === 0 ||
                categoryTerms.some((term) => lowerKey.includes(term));

            const matchesSearch =
                searchTerms.length === 0 ||
                searchTerms.every((term) => lowerKey.includes(term));

            return matchesCategory && matchesSearch;
        });
    }, [allIconKeys, iconSearch, selectedIconCategory]);

    const queryErrorMessage =
        error instanceof Error
            ? error.message
            : 'Não foi possível carregar os cadastros do workspace.';

    const renderIcon = (
        iconName?: string,
        color?: string,
        stroke?: number,
        size: number = 24
    ) => {
        if (!iconName) return null;
        const IconComponent = getIconComponent(iconName);
        if (!IconComponent) return null;
        return <IconComponent size={size} color={color || 'currentColor'} stroke={stroke || 2} />;
    };

    const handleSaveCatalog = async (e: React.FormEvent) => {
        e.preventDefault();

        await submitItem({
            name: itemName,
            icon: itemIcon || undefined,
            color: itemIcon ? itemColor : undefined,
            stroke: itemIcon ? itemStroke : undefined,
            status: itemStatus,
        });
    };

    const handleConfirmDelete = async () => {
        if (!itemToDelete) return;
        await removeItem(itemToDelete);
        setItemToDelete(null);
    };

    const buildWorkspacePayload = (): Workspace => {
    const currentWorkspace = activeWorkspace as Partial<Workspace> & {
        id: string;
        type: Workspace['type'];
        name: string;
    };

    return {
        id: currentWorkspace.id,
        userId: currentWorkspace.userId ?? currentWorkspace.ownerId ?? '',
        ownerId: currentWorkspace.ownerId ?? currentWorkspace.userId ?? '',
        type: currentWorkspace.type,
        name: wsName,
        slug: currentWorkspace.slug,
        cnpj: wsCnpj || null,
        logoUrl: currentWorkspace.logoUrl,
        themeColor: wsColor,
        currency: currentWorkspace.currency,
        pjAccentColor: currentWorkspace.pjAccentColor,
        alertPreferences: wsAlerts,
        createdAt: currentWorkspace.createdAt ?? new Date().toISOString(),
        updatedAt: currentWorkspace.updatedAt ?? new Date().toISOString(),
    };
};

    const handleSaveWorkspace = async () => {
    const updatedWs = buildWorkspacePayload();
    await updateWorkspaceMutation.mutateAsync(updatedWs);
    await reloadWorkspaces();
    setViewMode('main');
};

    if (viewMode === 'personalizacao') {
        return <PersonalizationView onBack={() => setViewMode('main')} />;
    }

    if (viewMode === 'workspace' && isPJ) {
        return (
            <div className="animate-fade-in max-w-4xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <button
                        onClick={() => setViewMode('main')}
                        className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-on-surface transition-colors"
                    >
                        <BackIcon className="h-5 w-5" />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold text-on-surface">Gestão da Empresa</h2>
                        <p className="text-sm text-muted">
                            Configurações específicas do workspace corporativo.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="md:col-span-2 space-y-6">
                        <div className="bg-surface rounded-card border border-border p-6 shadow-sm space-y-5">
                            <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                                <BriefcaseIcon className="w-5 h-5 text-primary" /> Identidade da Empresa
                            </h3>
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-muted uppercase mb-1">
                                        Nome Fantasia
                                    </label>
                                    <input
                                        type="text"
                                        value={wsName}
                                        onChange={(e) => setWsName(e.target.value)}
                                        className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted uppercase mb-1">
                                        CNPJ
                                    </label>
                                    <input
                                        type="text"
                                        value={wsCnpj}
                                        onChange={(e) => setWsCnpj(e.target.value)}
                                        placeholder="00.000.000/0001-00"
                                        className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted uppercase mb-2">
                                        Cor de Destaque PJ
                                    </label>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="color"
                                            value={wsColor}
                                            onChange={(e) => setWsColor(e.target.value)}
                                            className="w-12 h-12 rounded cursor-pointer border-0 p-1 bg-background"
                                        />
                                        <p className="text-xs text-muted">
                                            Esta cor será usada nos cards e menus enquanto você estiver
                                            neste perfil.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-surface rounded-card border border-border p-6 shadow-sm space-y-5">
                            <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                                <BellIcon className="w-5 h-5 text-primary" /> Preferências de Alertas PJ
                            </h3>
                            <div className="space-y-4">
                                {[
                                    {
                                        id: 'billing',
                                        label: 'Monitoramento de Faturamento',
                                        desc: 'Alertar quando as metas de receita estiverem fora do ritmo.',
                                    },
                                    {
                                        id: 'accountsPayable',
                                        label: 'Contas a Pagar Críticas',
                                        desc: 'Alertar sobre despesas altas vencendo hoje.',
                                    },
                                    {
                                        id: 'delinquency',
                                        label: 'Inadimplência de Clientes',
                                        desc: 'Notificar quando recebíveis ultrapassarem a data limite.',
                                    },
                                    {
                                        id: 'lowMargin',
                                        label: 'Margem de Lucro Baixa',
                                        desc: 'Avisar se o lucro operacional ficar abaixo de 10%.',
                                    },
                                ].map((alert) => (
                                    <label
                                        key={alert.id}
                                        className="flex items-start justify-between p-3 rounded-xl border border-transparent hover:bg-background cursor-pointer group"
                                    >
                                        <div className="flex-1 mr-4">
                                            <p className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors">
                                                {alert.label}
                                            </p>
                                            <p className="text-xs text-muted">{alert.desc}</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={wsAlerts[alert.id as keyof typeof wsAlerts]}
                                            onChange={(e) =>
                                                setWsAlerts({
                                                    ...wsAlerts,
                                                    [alert.id]: e.target.checked,
                                                })
                                            }
                                            className="w-5 h-5 mt-1 rounded text-primary focus:ring-primary"
                                        />
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-primary/5 rounded-card border border-primary/20 p-6">
                            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center text-white mb-4 shadow-lg">
                                <BriefcaseIcon className="w-10 h-10" />
                            </div>
                            <h4 className="font-bold text-on-surface">{wsName || 'Minha Empresa'}</h4>
                            <p className="text-xs text-muted mb-4">
                                {wsCnpj || '00.000.000/0001-00'}
                            </p>
                            <div className="pt-4 border-t border-primary/10">
                                <p className="text-xs font-bold text-primary uppercase mb-1">
                                    Status do Perfil
                                </p>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-primary text-white">
                                    PJ VERIFICADO
                                </span>
                            </div>
                        </div>

                        <button
                            onClick={handleSaveWorkspace}
                            className="w-full py-3 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold shadow-md transition-all active:scale-95"
                        >
                            Salvar Alterações
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (viewMode === 'main') {
        return (
            <div className="animate-fade-in">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">
                    Configurações
                </h2>
                <p className="text-gray-500 dark:text-gray-400 mb-8">
                    Gerencie as preferências e módulos administrativos do sistema.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {isPJ && (
                        <button
                            onClick={() => setViewMode('workspace')}
                            className="bg-surface p-6 rounded-xl shadow-md border border-transparent hover:border-primary transition-all group text-left"
                        >
                            <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <BriefcaseIcon className="w-6 h-6" />
                            </div>
                            <h3 className="text-lg font-bold text-on-surface mb-2">
                                Dados da Empresa
                            </h3>
                            <p className="text-sm text-muted mb-4">
                                CNPJ, branding, alertas de negócio e cores do perfil.
                            </p>
                            <div className="flex items-center text-primary font-bold text-sm">
                                Acessar <span className="ml-1">→</span>
                            </div>
                        </button>
                    )}

                    {canManageMembers && (
                        <button
                            onClick={() => setIsMembersModalOpen(true)}
                            className="bg-surface p-6 rounded-xl shadow-md border border-transparent hover:border-blue-500 transition-all group text-left"
                        >
                            <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <UsersIcon className="w-6 h-6" />
                            </div>
                            <h3 className="text-lg font-bold text-on-surface mb-2">
                                Membros da Equipe
                            </h3>
                            <p className="text-sm text-muted mb-4">
                                Convide pessoas, gerencie permissões e acessos.
                            </p>
                            <div className="flex items-center text-blue-600 font-bold text-sm">
                                Gerenciar <span className="ml-1">→</span>
                            </div>
                        </button>
                    )}

                    <button
                        onClick={() => setViewMode('cadastros')}
                        className="bg-surface p-6 rounded-xl shadow-md border border-transparent hover:border-indigo-500 transition-all group text-left"
                    >
                        <div className="w-12 h-12 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                            <TablerIcons.IconDatabase size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-on-surface mb-2">Cadastros</h3>
                        <p className="text-sm text-muted mb-4">
                            Catálogo administrativo real do workspace, com busca, filtros e gestão centralizada.
                        </p>
                        <div className="flex items-center text-indigo-600 font-bold text-sm">
                            Acessar <span className="ml-1">→</span>
                        </div>
                    </button>

                    <button
                        onClick={() => setViewMode('personalizacao')}
                        className="bg-surface p-6 rounded-xl shadow-md border border-transparent hover:border-pink-500 transition-all group text-left"
                    >
                        <div className="w-12 h-12 rounded-lg bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                            <PaletteIcon className="w-6 h-6" />
                        </div>
                        <h3 className="text-lg font-bold text-on-surface mb-2">
                            Personalização
                        </h3>
                        <p className="text-sm text-muted mb-4">
                            Ajuste temas, sons, animações e layout global.
                        </p>
                        <div className="flex items-center text-pink-600 font-bold text-sm">
                            Acessar <span className="ml-1">→</span>
                        </div>
                    </button>
                </div>

                {isMembersModalOpen && (
                    <MembersManagerModal onClose={() => setIsMembersModalOpen(false)} />
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full animate-fade-in">
            <div className="flex flex-col gap-4 mb-6 flex-shrink-0">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setViewMode('main')}
                        className="p-2 rounded-md bg-surface border border-border text-muted hover:text-on-surface shadow-sm transition-colors"
                    >
                        <BackIcon className="h-5 w-5" />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold text-on-surface">Cadastros</h2>
                        <p className="text-sm text-muted">
                            Módulo de administração do catálogo do workspace.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-surface border border-border rounded-xl p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted">
                            Total
                        </p>
                        <p className="text-2xl font-bold text-on-surface mt-1">{stats.total}</p>
                    </div>
                    <div className="bg-surface border border-border rounded-xl p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted">
                            Ativos
                        </p>
                        <p className="text-2xl font-bold text-green-600 mt-1">{stats.active}</p>
                    </div>
                    <div className="bg-surface border border-border rounded-xl p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted">
                            Inativos
                        </p>
                        <p className="text-2xl font-bold text-amber-600 mt-1">{stats.inactive}</p>
                    </div>
                </div>
            </div>

            <div className="flex flex-col xl:flex-row gap-6 flex-1 min-h-0">
                <aside className="w-full xl:w-72 bg-surface rounded-xl shadow-md p-4 border border-border flex-shrink-0">
                    <div className="mb-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted mb-1">
                            Seções
                        </p>
                        <h3 className="text-lg font-bold text-on-surface">
                            Catálogo administrativo
                        </h3>
                    </div>

                    <div className="flex xl:flex-col gap-2 overflow-x-auto xl:overflow-visible pb-1">
                        {sections.map((section) => {
                            const isActive = activeSectionKey === section.key;
                            return (
                                <button
                                    key={section.key}
                                    onClick={() => {
                                        setActiveSectionKey(section.key);
                                        setSearch('');
                                        clearFeedback();
                                    }}
                                    className={`min-w-fit xl:min-w-0 text-left px-4 py-3 rounded-xl transition-all border ${
                                        isActive
                                            ? 'bg-primary text-white border-primary shadow-md'
                                            : 'bg-background text-on-surface border-border hover:border-primary/30'
                                    }`}
                                >
                                    <div className="text-sm font-bold">{section.shortTitle}</div>
                                    <div
                                        className={`text-xs mt-1 ${
                                            isActive ? 'text-white/80' : 'text-muted'
                                        }`}
                                    >
                                        {section.description}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </aside>

                <section className="flex-1 bg-surface rounded-xl shadow-md border border-border min-h-[560px] flex flex-col">
                    <div className="p-5 md:p-6 border-b border-border">
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                                <div>
                                    <h3 className="text-xl font-bold text-on-surface">
                                        {activeSection?.title}
                                    </h3>
                                    <p className="text-sm text-muted mt-1">
                                        {activeSection?.description}
                                    </p>
                                </div>

                                <button
                                    onClick={openCreateModal}
                                    className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white rounded-xl px-4 py-2.5 font-bold shadow-md transition-colors"
                                >
                                    <PlusIcon />
                                    Novo cadastro
                                </button>
                            </div>

                            <div className="flex flex-col lg:flex-row gap-3">
                                <div className="relative flex-1">
                                    <input
                                        type="text"
                                        placeholder={activeSection?.searchPlaceholder || 'Buscar cadastro'}
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="w-full pl-11 pr-4 py-3 border border-border rounded-xl bg-background text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                                    />
                                    <div className="absolute left-3 top-3 text-muted">
                                        <SearchIcon className="h-5 w-5" />
                                    </div>
                                </div>

                                <label className="inline-flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-background text-sm text-on-surface">
                                    <input
                                        type="checkbox"
                                        checked={includeInactive}
                                        onChange={(e) => setIncludeInactive(e.target.checked)}
                                        className="rounded text-primary focus:ring-primary"
                                    />
                                    Exibir inativos
                                </label>
                            </div>

                            {activeSection?.supportsTransactionSubtype && (
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    {CATEGORY_SUBTYPE_OPTIONS.map((subtype) => (
                                        <button
                                            key={subtype.key}
                                            onClick={() => setTransactionSubtype(subtype.key)}
                                            className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                                                transactionSubtype === subtype.key
                                                    ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                                                    : 'text-muted hover:bg-background'
                                            }`}
                                        >
                                            {subtype.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="p-5 md:p-6 flex-1">
                        {feedback && (
                            <div
                                className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
                                    feedback.type === 'success'
                                        ? 'bg-green-50 text-green-700 border-green-200'
                                        : 'bg-red-50 text-red-700 border-red-200'
                                }`}
                            >
                                {feedback.message}
                            </div>
                        )}

                        {error && (
                            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-3">
                                <WarningIcon className="h-5 w-5 mt-0.5" />
                                <div>
                                    <p className="font-bold">Falha ao carregar o catálogo</p>
                                    <p className="mt-1">{queryErrorMessage}</p>
                                </div>
                            </div>
                        )}

                        {isLoading && items.length === 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {Array.from({ length: 6 }).map((_, index) => (
                                    <div
                                        key={index}
                                        className="rounded-xl border border-border bg-background p-4 animate-pulse"
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-surface" />
                                            <div className="flex-1 space-y-2">
                                                <div className="h-4 rounded bg-surface w-1/2" />
                                                <div className="h-3 rounded bg-surface w-1/3" />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : items.length === 0 ? (
                            <div className="h-full min-h-[320px] flex items-center justify-center">
                                <div className="max-w-md text-center">
                                    <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                                        <TablerIcons.IconDatabase size={28} />
                                    </div>
                                    <h4 className="text-lg font-bold text-on-surface">
                                        {activeSection?.emptyTitle}
                                    </h4>
                                    <p className="text-sm text-muted mt-2">
                                        {activeSection?.emptyDescription}
                                    </p>
                                    <button
                                        onClick={openCreateModal}
                                        className="mt-5 inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white rounded-xl px-4 py-2.5 font-bold shadow-md transition-colors"
                                    >
                                        <PlusIcon />
                                        Criar primeiro item
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {isFetching && (
                                    <div className="text-xs font-medium text-muted">
                                        Atualizando dados do catálogo...
                                    </div>
                                )}

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {items.map((item) => (
                                        <article
                                            key={item.id}
                                            className="rounded-2xl border border-border bg-background p-4 hover:border-primary/30 hover:shadow-md transition-all"
                                        >
                                            <div className="flex items-start gap-4">
                                                <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center shrink-0">
                                                    {item.icon ? (
                                                        renderIcon(
                                                            item.icon,
                                                            item.color,
                                                            item.stroke,
                                                            24
                                                        )
                                                    ) : (
                                                        <TablerIcons.IconShape
                                                            size={22}
                                                            className="text-muted"
                                                        />
                                                    )}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h4 className="font-bold text-on-surface truncate">
                                                            {item.name}
                                                        </h4>
                                                        <span
                                                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                                                item.status === 'active'
                                                                    ? 'bg-green-100 text-green-700'
                                                                    : 'bg-amber-100 text-amber-700'
                                                            }`}
                                                        >
                                                            {item.status === 'active'
                                                                ? 'Ativo'
                                                                : 'Inativo'}
                                                        </span>

                                                        {item.transactionSubtype && (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-primary/10 text-primary">
                                                                {item.transactionSubtype}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="mt-2 text-xs text-muted space-y-1">
                                                        <p>Grupo: {activeSection?.shortTitle}</p>
                                                        <p>Ordenação: {item.sortOrder}</p>
                                                    </div>

                                                    <div className="mt-4 flex items-center gap-2">
                                                        <button
                                                            onClick={() => openEditModal(item)}
                                                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-surface text-sm font-medium text-on-surface transition-colors"
                                                        >
                                                            <EditIcon className="h-4 w-4" />
                                                            Editar
                                                        </button>
                                                        <button
                                                            onClick={() => setItemToDelete(item)}
                                                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 hover:bg-red-50 text-sm font-medium text-red-600 transition-colors"
                                                        >
                                                            <DeleteIcon className="h-4 w-4" />
                                                            Excluir
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            </div>

            {isModalOpen &&
    renderInPortal(
        <div
            className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-[2px] overflow-y-auto overscroll-contain"
            onClick={closeModal}
        >
            <div className="min-h-screen flex items-center justify-center p-4 md:p-6">
                <div
                    className="my-auto bg-surface rounded-2xl shadow-lg w-full max-w-3xl animate-scale-in flex flex-col max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-3rem)] border border-border overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex justify-between items-center p-5 border-b border-border">
                        <div>
                            <h3 className="text-lg font-bold text-on-surface">
                                {modalMode === 'edit' ? 'Editar cadastro' : 'Novo cadastro'}
                            </h3>
                            <p className="text-sm text-muted mt-1">
                                {activeSection?.title}
                                {selectedItem?.transactionSubtype
                                    ? ` • ${selectedItem.transactionSubtype}`
                                    : activeSection?.supportsTransactionSubtype
                                    ? ` • ${transactionSubtype}`
                                    : ''}
                            </p>
                        </div>
                        <button
                            onClick={closeModal}
                            className="text-muted hover:text-on-surface"
                        >
                            <CloseIcon />
                        </button>
                    </div>

                    <form onSubmit={handleSaveCatalog} className="flex flex-col min-h-0">
                        <div className="p-5 md:p-6 overflow-y-auto overflow-x-hidden space-y-6 min-w-0">
                            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-6 min-w-0">
                                <div className="space-y-5 min-w-0">
                                    <div>
                                        <label className="block text-sm font-medium text-on-surface mb-1.5">
                                            Nome do cadastro
                                        </label>
                                        <input
                                            type="text"
                                            value={itemName}
                                            onChange={(e) => setItemName(e.target.value)}
                                            className="w-full bg-background border border-border rounded-xl px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary outline-none"
                                            placeholder="Ex.: Cartão corporativo, Fornecedor A, Alimentação..."
                                            required
                                        />
                                    </div>

                                    {activeSection?.supportsTransactionSubtype && (
                                        <div>
                                            <label className="block text-sm font-medium text-on-surface mb-2">
                                                Tipo de transação
                                            </label>
                                            <div className="flex flex-wrap gap-2">
                                                {CATEGORY_SUBTYPE_OPTIONS.map((subtype) => {
                                                    const isActive = transactionSubtype === subtype.key;
                                                    const isDisabled = modalMode === 'edit';
                                                    return (
                                                        <button
                                                            key={subtype.key}
                                                            type="button"
                                                            disabled={isDisabled}
                                                            onClick={() =>
                                                                !isDisabled &&
                                                                setTransactionSubtype(subtype.key)
                                                            }
                                                            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                                                                isActive
                                                                    ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                                                                    : 'text-muted hover:bg-background'
                                                            } ${
                                                                isDisabled
                                                                    ? 'opacity-70 cursor-not-allowed'
                                                                    : ''
                                                            }`}
                                                        >
                                                            {subtype.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-sm font-medium text-on-surface mb-2">
                                            Status
                                        </label>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setItemStatus('active')}
                                                className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                                                    itemStatus === 'active'
                                                        ? 'border-green-200 bg-green-50 text-green-700'
                                                        : 'border-border text-on-surface hover:bg-background'
                                                }`}
                                            >
                                                Ativo
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setItemStatus('inactive')}
                                                className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                                                    itemStatus === 'inactive'
                                                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                                                        : 'border-border text-on-surface hover:bg-background'
                                                }`}
                                            >
                                                Inativo
                                            </button>
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-border bg-background p-4">
                                        <p className="text-xs font-bold uppercase tracking-wide text-muted mb-3">
                                            Pré-visualização
                                        </p>

                                        <div className="flex items-center gap-4">
                                            <div className="w-14 h-14 rounded-2xl bg-surface border border-border flex items-center justify-center">
                                                {itemIcon ? (
                                                    renderIcon(itemIcon, itemColor, itemStroke, 28)
                                                ) : (
                                                    <TablerIcons.IconShape
                                                        size={24}
                                                        className="text-muted"
                                                    />
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-on-surface truncate">
                                                    {itemName || 'Novo item do catálogo'}
                                                </p>
                                                <p className="text-sm text-muted">
                                                    {activeSection?.shortTitle}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4 min-w-0">
                                    <div className="rounded-2xl border border-border bg-background p-4">
                                        <div className="flex items-center justify-between gap-3 mb-3">
                                            <label className="text-sm font-medium text-on-surface">
                                                Ícone
                                            </label>
                                            {itemIcon && (
                                                <button
                                                    type="button"
                                                    onClick={() => setItemIcon('')}
                                                    className="text-xs font-bold text-red-600 hover:text-red-700"
                                                >
                                                    Remover ícone
                                                </button>
                                            )}
                                        </div>

                                        <div className="space-y-3">
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={iconSearch}
                                                    onChange={(e) => setIconSearch(e.target.value)}
                                                    placeholder="Buscar ícone"
                                                    className="w-full pl-10 pr-4 py-2.5 border border-border rounded-xl bg-surface text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                                                />
                                                <div className="absolute left-3 top-2.5 text-muted">
                                                    <SearchIcon className="h-5 w-5" />
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                {ICON_CATEGORIES.map((category) => (
                                                    <button
                                                        key={category.label}
                                                        type="button"
                                                        onClick={() => setSelectedIconCategory(category.label)}
                                                        className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                                                            selectedIconCategory === category.label
                                                                ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                                                                : 'bg-surface text-muted hover:bg-white/60'
                                                        }`}
                                                    >
                                                        {category.label}
                                                    </button>
                                                ))}
                                            </div>

                                            <div className="grid grid-cols-6 sm:grid-cols-7 gap-2 max-h-64 overflow-y-auto hide-scrollbar p-1">
                                                {filteredIcons
                                                    .slice(0, visibleIconCount)
                                                    .map((key) => (
                                                        <button
                                                            key={key}
                                                            type="button"
                                                            onClick={() => setItemIcon(key)}
                                                            className={`aspect-square rounded-xl flex items-center justify-center border transition-all ${
                                                                itemIcon === key
                                                                    ? 'border-primary bg-primary/10'
                                                                    : 'border-transparent hover:border-border hover:bg-surface'
                                                            }`}
                                                        >
                                                            {renderIcon(
                                                                key,
                                                                itemIcon === key ? itemColor : '#6b7280',
                                                                itemIcon === key ? itemStroke : 2,
                                                                20
                                                            )}
                                                        </button>
                                                    ))}
                                            </div>

                                            {visibleIconCount < filteredIcons.length && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setVisibleIconCount((prev) => prev + 48)
                                                    }
                                                    className="w-full py-2 rounded-xl border border-border text-sm font-medium text-on-surface hover:bg-surface transition-colors"
                                                >
                                                    Mostrar mais ícones
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {itemIcon && (
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-muted uppercase mb-1.5">
                                                    Cor
                                                </label>
                                                <input
                                                    type="color"
                                                    value={itemColor}
                                                    onChange={(e) => setItemColor(e.target.value)}
                                                    className="w-full h-11 rounded-lg cursor-pointer p-1 bg-background"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-muted uppercase mb-1.5">
                                                    Traço
                                                </label>
                                                <input
                                                    type="number"
                                                    step="0.5"
                                                    min="1"
                                                    max="4"
                                                    value={itemStroke}
                                                    onChange={(e) =>
                                                        setItemStroke(parseFloat(e.target.value))
                                                    }
                                                    className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-on-surface"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="p-5 border-t border-border flex flex-col-reverse sm:flex-row justify-end gap-3">
                            <button
                                type="button"
                                onClick={closeModal}
                                className="px-4 py-2.5 bg-background border border-border text-on-surface rounded-xl font-medium"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                className="px-6 py-2.5 bg-primary text-white rounded-xl font-bold shadow-md disabled:opacity-60"
                                disabled={isLoading}
                            >
                                {modalMode === 'edit' ? 'Salvar alterações' : 'Criar cadastro'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )}

            {itemToDelete &&
    renderInPortal(
        <div
            className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-[2px] overflow-y-auto overscroll-contain"
            onClick={() => setItemToDelete(null)}
        >
            <div className="min-h-screen flex items-center justify-center p-4 md:p-6">
                <div
                    className="my-auto bg-surface rounded-2xl shadow-lg w-full max-w-md animate-scale-in border border-border overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="p-6">
                        <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mb-4">
                            <WarningIcon className="h-6 w-6" />
                        </div>

                        <h3 className="text-lg font-bold text-on-surface">
                            Excluir cadastro
                        </h3>
                        <p className="text-sm text-muted mt-2">
                            Tem certeza que deseja excluir <strong>{itemToDelete.name}</strong>?
                            Esta ação também libera a chave de unicidade desse item.
                        </p>

                        <div className="mt-6 flex flex-col-reverse sm:flex-row justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setItemToDelete(null)}
                                className="px-4 py-2.5 bg-background border border-border text-on-surface rounded-xl font-medium"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmDelete}
                                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold"
                            >
                                Excluir item
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )}

            {isMembersModalOpen && (
                <MembersManagerModal onClose={() => setIsMembersModalOpen(false)} />
            )}
        </div>
    );
};

export default SettingsView;