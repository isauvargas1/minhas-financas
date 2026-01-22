
import React, { useState, useMemo, useEffect } from 'react';
import { EntityItem, Workspace } from '../types.ts';
import { PlusIcon, EditIcon, DeleteIcon, SearchIcon, SortUpIcon, SortDownIcon, CloseIcon, WarningIcon, BackIcon, BriefcaseIcon, BuildingIcon, BellIcon, PaletteIcon } from './Icons.tsx';
import * as TablerIcons from '@tabler/icons-react';
import PersonalizationView from './PersonalizationView.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useUpdateWorkspace } from '../modules/workspaces/hooks.ts';

interface SettingsViewProps {
    data: {
        productsServices: EntityItem[];
        expenseTypes: EntityItem[];
        categories: EntityItem[];
        paymentTypes: EntityItem[];
        incomeTypes: EntityItem[];
        wallets: EntityItem[];
        costCenters?: EntityItem[];
    };
    onUpdate: (key: string, newData: EntityItem[]) => void;
}

type SettingsKey = 'productsServices' | 'expenseTypes' | 'categories' | 'paymentTypes' | 'incomeTypes' | 'wallets' | 'costCenters';
type CategoryType = 'receita' | 'despesa' | 'investimento' | 'parcelado';
type ViewMode = 'main' | 'cadastros' | 'personalizacao' | 'workspace';

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
    Object.keys(TablerIcons).forEach(key => { if (key.startsWith('Icon')) keys.add(key); });
    // @ts-ignore
    if (TablerIcons.default) {
        // @ts-ignore
        Object.keys(TablerIcons.default).forEach(key => { if (key.startsWith('Icon')) keys.add(key); });
    }
    return Array.from(keys);
};

const ICON_CATEGORIES = [
    { label: 'Todos', term: '' },
    { label: 'Financeiro', term: 'currency money coin wallet bank cash credit' },
    { label: 'Gráficos', term: 'chart graph activity' },
    { label: 'Comércio', term: 'shopping cart basket tag gift' },
    { label: 'Dispositivos', term: 'device phone laptop desktop' },
    { label: 'Casa', term: 'home building tool hammer' },
];

const SettingsView: React.FC<SettingsViewProps> = ({ data, onUpdate }) => {
    const { activeWorkspace, reloadWorkspaces } = useWorkspace();
    const updateWorkspaceMutation = useUpdateWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';

    const [viewMode, setViewMode] = useState<ViewMode>('main');
    const [activeTab, setActiveTab] = useState<SettingsKey>('productsServices');
    const [categorySubTab, setCategorySubTab] = useState<CategoryType>('receita');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: 'name'; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });
    
    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<EntityItem | null>(null);
    const [itemName, setItemName] = useState('');
    const [itemIcon, setItemIcon] = useState<string>('');
    const [itemColor, setItemColor] = useState<string>('#6366f1');
    const [itemStroke, setItemStroke] = useState<number>(2);
    const [iconSearch, setIconSearch] = useState('');
    const [visibleIconCount, setVisibleIconCount] = useState(60);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [itemToDelete, setItemToDelete] = useState<EntityItem | null>(null);

    // Workspace Form State
    const [wsName, setWsName] = useState(activeWorkspace.name);
    const [wsCnpj, setWsCnpj] = useState(activeWorkspace.cnpj || '');
    const [wsColor, setWsColor] = useState(activeWorkspace.themeColor);
    const [wsAlerts, setWsAlerts] = useState(activeWorkspace.alertPreferences || { billing: true, accountsPayable: true, delinquency: true, lowMargin: false });

    useEffect(() => {
        if (viewMode === 'workspace') {
            setWsName(activeWorkspace.name);
            setWsCnpj(activeWorkspace.cnpj || '');
            setWsColor(activeWorkspace.themeColor);
            setWsAlerts(activeWorkspace.alertPreferences || { billing: true, accountsPayable: true, delinquency: true, lowMargin: false });
        }
    }, [viewMode, activeWorkspace]);

    // Fix: Explicitly typed array literal to prevent string widening of 'key' property and resolve TS error
    const tabs: { key: SettingsKey; label: string; onlyPJ?: boolean }[] = ([
        { key: 'productsServices', label: 'Produtos e Serviços' },
        { key: 'costCenters', label: 'Centros de Custo', onlyPJ: true },
        { key: 'paymentTypes', label: 'Formas de Pagamento' },
        { key: 'expenseTypes', label: 'Tipos de Despesas' },
        { key: 'incomeTypes', label: 'Tipos de Receitas' },
        { key: 'categories', label: 'Categorias' },
        { key: 'wallets', label: 'Carteiras' },
    ] as { key: SettingsKey; label: string; onlyPJ?: boolean }[]).filter(t => !t.onlyPJ || isPJ);

    const processedData = useMemo(() => {
        let currentData = data[activeTab] || [];
        if (activeTab === 'categories') {
            currentData = currentData.filter(item => item.type === categorySubTab);
        }
        let filtered = currentData.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
        return filtered.sort((a, b) => {
            const aValue = a[sortConfig.key];
            const bValue = b[sortConfig.key];
            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [data, activeTab, categorySubTab, searchQuery, sortConfig]);

    const allIconKeys = useMemo(() => getAllIconKeys(), []);
    const filteredIcons = useMemo(() => {
        const lowerSearch = iconSearch.toLowerCase();
        const terms = lowerSearch.split(' ').filter(t => t.trim() !== '');
        return allIconKeys.filter(key => {
            const lowerKey = key.toLowerCase();
            if (terms.length === 0) return true;
            return terms.some(term => lowerKey.includes(term));
        });
    }, [allIconKeys, iconSearch]);

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        const currentList = [...(data[activeTab] || [])];
        const newItemData: Partial<EntityItem> = {
            name: itemName,
            icon: itemIcon || undefined,
            iconColor: itemIcon ? itemColor : undefined,
            iconStroke: itemIcon ? itemStroke : undefined,
        };
        if (activeTab === 'categories') newItemData.type = categorySubTab;
        
        if (editingItem) {
            const updatedList = currentList.map(item => item.id === editingItem.id ? { ...item, ...newItemData } : item);
            onUpdate(activeTab, updatedList);
        } else {
            const newId = currentList.length > 0 ? Math.max(...currentList.map(i => i.id)) + 1 : 1;
            onUpdate(activeTab, [...currentList, { id: newId, ...newItemData } as EntityItem]);
        }
        setIsModalOpen(false);
    };

    const handleSaveWorkspace = async () => {
        const updatedWs: Workspace = {
            ...activeWorkspace,
            name: wsName,
            cnpj: wsCnpj,
            themeColor: wsColor,
            alertPreferences: wsAlerts
        };
        await updateWorkspaceMutation.mutateAsync(updatedWs);
        await reloadWorkspaces();
        setViewMode('main');
    };

    const openModal = (item?: EntityItem) => {
        setIconSearch(''); setVisibleIconCount(60); setSelectedCategory('');
        if (item) {
            setEditingItem(item); setItemName(item.name);
            let storedIcon = item.icon || '';
            if (storedIcon && !storedIcon.startsWith('Icon')) {
                const prefixed = `Icon${storedIcon}`;
                if (getIconComponent(prefixed)) storedIcon = prefixed;
            }
            setItemIcon(storedIcon); setItemColor(item.iconColor || '#6366f1'); setItemStroke(item.iconStroke || 2);
        } else {
            setEditingItem(null); setItemName(''); setItemIcon(''); setItemColor('#6366f1'); setItemStroke(2);
        }
        setIsModalOpen(true);
    };

    const renderIcon = (iconName?: string, color?: string, stroke?: number, size: number = 24) => {
        if (!iconName) return null;
        const IconComponent = getIconComponent(iconName);
        if (!IconComponent) return null;
        return <IconComponent size={size} color={color || 'currentColor'} stroke={stroke || 2} />;
    };

    if (viewMode === 'personalizacao') return <PersonalizationView onBack={() => setViewMode('main')} />;

    if (viewMode === 'workspace' && isPJ) {
        return (
            <div className="animate-fade-in max-w-4xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <button onClick={() => setViewMode('main')} className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-on-surface transition-colors">
                        <BackIcon className="h-5 w-5" />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold text-on-surface">Gestão da Empresa</h2>
                        <p className="text-sm text-muted">Configurações específicas do workspace corporativo.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="md:col-span-2 space-y-6">
                        {/* Branding */}
                        <div className="bg-surface rounded-card border border-border p-6 shadow-sm space-y-5">
                            <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                                <BriefcaseIcon className="w-5 h-5 text-primary" /> Identidade da Empresa
                            </h3>
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-muted uppercase mb-1">Nome Fantasia</label>
                                    <input type="text" value={wsName} onChange={e => setWsName(e.target.value)} className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted uppercase mb-1">CNPJ</label>
                                    <input type="text" value={wsCnpj} onChange={e => setWsCnpj(e.target.value)} placeholder="00.000.000/0001-00" className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted uppercase mb-2">Cor de Destaque PJ</label>
                                    <div className="flex items-center gap-3">
                                        <input type="color" value={wsColor} onChange={e => setWsColor(e.target.value)} className="w-12 h-12 rounded cursor-pointer border-0 p-1 bg-background" />
                                        <p className="text-xs text-muted">Esta cor será usada nos cards e menus enquanto você estiver neste perfil.</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Alertas PJ */}
                        <div className="bg-surface rounded-card border border-border p-6 shadow-sm space-y-5">
                            <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                                <BellIcon className="w-5 h-5 text-primary" /> Preferências de Alertas PJ
                            </h3>
                            <div className="space-y-4">
                                {[
                                    { id: 'billing', label: 'Monitoramento de Faturamento', desc: 'Alertar quando as metas de receita estiverem fora do ritmo.' },
                                    { id: 'accountsPayable', label: 'Contas a Pagar Críticas', desc: 'Alertar sobre despesas altas vencendo hoje.' },
                                    { id: 'delinquency', label: 'Inadimplência de Clientes', desc: 'Notificar quando recebíveis ultrapassarem a data limite.' },
                                    { id: 'lowMargin', label: 'Margem de Lucro Baixa', desc: 'Avisar se o lucro operacional ficar abaixo de 10%.' }
                                ].map(alert => (
                                    <label key={alert.id} className="flex items-start justify-between p-3 rounded-xl border border-transparent hover:bg-background cursor-pointer group">
                                        <div className="flex-1 mr-4">
                                            <p className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors">{alert.label}</p>
                                            <p className="text-xs text-muted">{alert.desc}</p>
                                        </div>
                                        <input 
                                            type="checkbox" 
                                            checked={wsAlerts[alert.id as keyof typeof wsAlerts]} 
                                            onChange={(e) => setWsAlerts({ ...wsAlerts, [alert.id]: e.target.checked })}
                                            className="w-5 h-5 mt-1 rounded text-primary focus:ring-primary"
                                        />
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        {/* Summary / Preview */}
                        <div className="bg-primary/5 rounded-card border border-primary/20 p-6">
                             <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center text-white mb-4 shadow-lg">
                                <BriefcaseIcon className="w-10 h-10" />
                             </div>
                             <h4 className="font-bold text-on-surface">{wsName || 'Minha Empresa'}</h4>
                             <p className="text-xs text-muted mb-4">{wsCnpj || '00.000.000/0001-00'}</p>
                             <div className="pt-4 border-t border-primary/10">
                                <p className="text-xs font-bold text-primary uppercase mb-1">Status do Perfil</p>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-primary text-white">PJ VERIFICADO</span>
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
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">Configurações</h2>
                <p className="text-gray-500 dark:text-gray-400 mb-8">Gerencie as preferências e cadastros do sistema.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {isPJ && (
                        <button 
                            onClick={() => setViewMode('workspace')}
                            className="bg-surface p-6 rounded-xl shadow-md border border-transparent hover:border-primary transition-all group text-left"
                        >
                            <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <BriefcaseIcon className="w-6 h-6" />
                            </div>
                            <h3 className="text-lg font-bold text-on-surface mb-2">Dados da Empresa</h3>
                            <p className="text-sm text-muted mb-4">CNPJ, Branding, Alertas de Negócio e Cores do Perfil.</p>
                            <div className="flex items-center text-primary font-bold text-sm">Acessar <span className="ml-1">→</span></div>
                        </button>
                    )}

                    <button onClick={() => setViewMode('cadastros')} className="bg-surface p-6 rounded-xl shadow-md border border-transparent hover:border-indigo-500 transition-all group text-left">
                        <div className="w-12 h-12 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                             <TablerIcons.IconDatabase size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-on-surface mb-2">Cadastros</h3>
                        <p className="text-sm text-muted mb-4">Categorias, Formas de Pagamento, Carteiras e Centros de Custo.</p>
                        <div className="flex items-center text-indigo-600 font-bold text-sm">Acessar <span className="ml-1">→</span></div>
                    </button>

                    <button onClick={() => setViewMode('personalizacao')} className="bg-surface p-6 rounded-xl shadow-md border border-transparent hover:border-pink-500 transition-all group text-left">
                        <div className="w-12 h-12 rounded-lg bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                            <PaletteIcon className="w-6 h-6" />
                        </div>
                        <h3 className="text-lg font-bold text-on-surface mb-2">Personalização</h3>
                        <p className="text-sm text-muted mb-4">Ajuste temas, sons, animações e layout global.</p>
                        <div className="flex items-center text-pink-600 font-bold text-sm">Acessar <span className="ml-1">→</span></div>
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full animate-fade-in">
            <div className="flex items-center gap-4 mb-6 flex-shrink-0">
                <button onClick={() => setViewMode('main')} className="p-2 rounded-md bg-surface border border-border text-muted hover:text-on-surface shadow-sm transition-colors">
                    <BackIcon className="h-5 w-5" />
                </button>
                <h2 className="text-2xl font-bold text-on-surface">Cadastros</h2>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
                <div className="w-full lg:w-64 bg-surface rounded-xl shadow-md p-4 flex-shrink-0 overflow-y-auto max-h-[200px] lg:max-h-full border border-border">
                    <div className="flex flex-row lg:flex-col gap-2">
                        {tabs.map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => { setActiveTab(tab.key); setSearchQuery(''); }}
                                className={`text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${activeTab === tab.key ? 'bg-primary text-white shadow-md' : 'text-muted hover:bg-background'}`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 bg-surface rounded-xl shadow-md p-6 flex flex-col min-h-[500px] border border-border">
                    <div className="flex flex-col mb-6 gap-4 flex-shrink-0">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <h2 className="text-xl font-bold text-on-surface">{tabs.find(t => t.key === activeTab)?.label}</h2>
                            <div className="flex gap-2 w-full sm:w-auto">
                                <div className="relative flex-1 sm:flex-initial">
                                    <input type="text" placeholder="Pesquisar..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full sm:w-64 pl-10 pr-4 py-2 border border-border rounded-lg bg-background text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" />
                                    <div className="absolute left-3 top-2.5 text-gray-400"><SearchIcon className="h-5 w-5" /></div>
                                </div>
                                <button onClick={() => openModal()} className="bg-primary hover:bg-primary/90 text-white p-2 rounded-lg shadow-md transition-colors"><PlusIcon /></button>
                            </div>
                        </div>

                        {activeTab === 'categories' && (
                            <div className="flex gap-2 overflow-x-auto pb-2 border-b border-border">
                                {[
                                    { key: 'receita', label: 'Receitas' },
                                    { key: 'despesa', label: 'Despesas' },
                                    { key: 'investimento', label: 'Investimentos' },
                                    { key: 'parcelado', label: 'Parcelados' },
                                ].map(subTab => (
                                    <button key={subTab.key} onClick={() => setCategorySubTab(subTab.key as any)} className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${categorySubTab === subTab.key ? 'bg-primary/10 text-primary ring-1 ring-primary/20' : 'text-muted hover:bg-background'}`}>{subTab.label}</button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="overflow-x-auto flex-1">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="py-3 px-4 text-left font-medium text-muted w-16">Ícone</th>
                                    <th className="py-3 px-4 text-left font-medium text-muted cursor-pointer hover:bg-background transition-colors" onClick={() => setSortConfig({ key: 'name', direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' })}>
                                        <div className="flex items-center gap-1">Nome / Descrição {sortConfig.direction === 'asc' ? <SortUpIcon className="h-4 w-4" /> : <SortDownIcon className="h-4 w-4" />}</div>
                                    </th>
                                    <th className="py-3 px-4 text-center font-medium text-muted w-32">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {processedData.length > 0 ? (
                                    processedData.map(item => (
                                        <tr key={item.id} className="border-b border-border hover:bg-background/50 transition-colors">
                                            <td className="py-3 px-4">{item.icon ? <div className="p-1 rounded-md bg-background inline-block">{renderIcon(item.icon, item.iconColor, item.iconStroke, 24)}</div> : <span className="w-8 h-8 block"></span>}</td>
                                            <td className="py-3 px-4 text-on-surface font-medium">{item.name}</td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button onClick={() => openModal(item)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full transition-colors"><EditIcon className="h-4 w-4" /></button>
                                                    <button onClick={() => setItemToDelete(item)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-full transition-colors"><DeleteIcon className="h-4 w-4" /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan={3} className="text-center py-10 text-muted">Nenhum registro encontrado.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Entity Form Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setIsModalOpen(false)}>
                    <div className="bg-surface rounded-xl shadow-lg w-full max-w-lg animate-scale-in flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center p-5 border-b border-border">
                            <h3 className="text-lg font-bold text-on-surface">{editingItem ? 'Editar Item' : 'Novo Item'}</h3>
                            <button onClick={() => setIsModalOpen(false)} className="text-muted hover:text-on-surface"><CloseIcon /></button>
                        </div>
                        <form onSubmit={handleSave} className="p-6 space-y-5 overflow-y-auto">
                            <div>
                                <label className="block text-sm font-medium text-on-surface mb-1">Nome</label>
                                <input type="text" value={itemName} onChange={e => setItemName(e.target.value)} className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none" required />
                            </div>
                            <div className="bg-background p-4 rounded-xl border border-border">
                                <label className="block text-xs font-bold text-muted uppercase mb-3">Selecione um Ícone</label>
                                <div className="grid grid-cols-6 gap-2 max-h-40 overflow-y-auto custom-scrollbar p-1">
                                    {allIconKeys.slice(0, 48).map(key => (
                                        <button key={key} type="button" onClick={() => setItemIcon(key)} className={`aspect-square rounded flex items-center justify-center border transition-all ${itemIcon === key ? 'border-primary bg-primary/10' : 'border-transparent hover:border-border'}`}>
                                            {renderIcon(key, itemIcon === key ? itemColor : '#6b7280', 2, 20)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {itemIcon && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-muted uppercase mb-1">Cor</label>
                                        <input type="color" value={itemColor} onChange={e => setItemColor(e.target.value)} className="w-full h-10 rounded cursor-pointer p-1 bg-background" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted uppercase mb-1">Traço</label>
                                        <input type="number" step="0.5" min="1" max="3" value={itemStroke} onChange={e => setItemStroke(parseFloat(e.target.value))} className="w-full bg-background border border-border rounded-lg px-4 py-1.5 text-on-surface" />
                                    </div>
                                </div>
                            )}
                            <div className="pt-4 flex justify-end gap-3">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-gray-100 dark:bg-dark-200 text-on-surface rounded-lg">Cancelar</button>
                                <button type="submit" className="px-6 py-2 bg-primary text-white rounded-lg font-bold shadow-md">Salvar</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SettingsView;
