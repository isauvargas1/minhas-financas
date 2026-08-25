
import React, { useState, useEffect, useMemo } from 'react';
import { SplitGroup, SplitGroupType } from '../types.ts';
import { CloseIcon, SearchIcon, DynamicIcon, useTablerIconKeys } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface SplitGroupFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (group: SplitGroup) => void;
    groupToEdit?: SplitGroup | null;
    initialBusinessType?: 'rateio' | 'reembolso';
}

const PRESET_COLORS = [
    '#4f46e5', // Indigo
    '#0ea5e9', // Sky
    '#22c55e', // Green
    '#eab308', // Yellow
    '#f97316', // Orange
    '#ec4899', // Pink
    '#8b5cf6', // Violet
    '#64748b', // Slate
];

const ICON_CATEGORIES = [
    { label: 'Casa', term: 'home bed bath sofa' },
    { label: 'Viagem', term: 'plane map car bus' },
    { label: 'Lazer', term: 'glass beer music movie' },
    { label: 'Trabalho', term: 'briefcase building laptop file' },
    { label: 'Outros', term: 'star heart users' },
];

const adjustBrightness = (color: string, amount: number) => {
    return '#' + color.replace(/^#/, '').replace(/../g, color => ('0'+Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
}

const SplitGroupFormModal: React.FC<SplitGroupFormModalProps> = ({ 
    isOpen, onClose, onSave, groupToEdit, initialBusinessType 
}) => {
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';

    // Basic Info
    const [nome, setNome] = useState('');
    const [descricao, setDescricao] = useState('');
    const [tipo, setTipo] = useState<SplitGroupType>('fixo');
    const [ativo, setAtivo] = useState(true);
    
    // PJ Specific
    const [businessType, setBusinessType] = useState<'rateio' | 'reembolso'>('rateio');

    // Visual
    const [corPrincipal, setCorPrincipal] = useState(PRESET_COLORS[0]);
    const [icone, setIcone] = useState('Home');
    const [emojiOpcional, setEmojiOpcional] = useState('');

    // Icon Picker State
    const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
    const [iconSearch, setIconSearch] = useState('');
    const [visibleIconCount, setVisibleIconCount] = useState(60);
    const [selectedCategory, setSelectedCategory] = useState('');

    useEffect(() => {
        if (isOpen) {
            if (groupToEdit) {
                setNome(groupToEdit.nome);
                setDescricao(groupToEdit.descricao || '');
                setTipo(groupToEdit.tipo);
                setAtivo(groupToEdit.ativo);
                setCorPrincipal(groupToEdit.corPrincipal);
                setIcone(groupToEdit.icone);
                setEmojiOpcional(groupToEdit.emojiOpcional || '');
                if (groupToEdit.businessType) setBusinessType(groupToEdit.businessType);
            } else {
                // Reset
                setNome('');
                setDescricao('');
                setTipo('fixo');
                setAtivo(true);
                setCorPrincipal(PRESET_COLORS[0]);
                setIcone(isPJ && initialBusinessType === 'reembolso' ? 'FileInvoice' : 'Home');
                setEmojiOpcional('');
                setBusinessType(initialBusinessType || 'rateio');
            }
            setIsIconPickerOpen(false);
            setIconSearch('');
        }
    }, [isOpen, groupToEdit, initialBusinessType, isPJ]);

    // --- ICON SEARCH LOGIC ---
    // O catálogo completo chega junto com o pacote de ícones, carregado sob
    // demanda (INV-P2-044). Até lá a lista fica vazia e o seletor mostra o
    // estado de carregamento, em vez de a tela inteira esperar 9,6 MB.
    const allIconKeys = useTablerIconKeys();

    const filteredIcons = useMemo(() => {
        const lowerSearch = iconSearch.toLowerCase();
        const terms = lowerSearch.split(' ').filter(t => t.trim() !== '');

        return allIconKeys.filter(key => {
            const lowerKey = key.toLowerCase();
            if (terms.length === 0) return true;
            return terms.some(term => lowerKey.includes(term));
        });
    }, [allIconKeys, iconSearch]);

    const handleCategoryClick = (term: string, label: string) => {
        setIconSearch(term);
        setSelectedCategory(label);
        setVisibleIconCount(60);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        const newGroup: SplitGroup = {
            id: groupToEdit ? groupToEdit.id : Date.now().toString(),
            nome,
            descricao,
            tipo,
            ativo,
            corPrincipal,
            icone,
            emojiOpcional,
            dataCriacao: groupToEdit ? groupToEdit.dataCriacao : new Date().toISOString().split('T')[0],
            businessType: isPJ ? businessType : undefined
        };

        onSave(newGroup);
        onClose();
    };

    if (!isOpen) return null;

    const darkerColor = adjustBrightness(corPrincipal, -50);
    const previewGradient = `radial-gradient(circle at top left, rgba(255,255,255,0.2) 0%, transparent 40%), linear-gradient(135deg, ${corPrincipal} 0%, ${darkerColor} 100%)`;
    
    const commonInputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 bg-white text-gray-900 dark:bg-dark-200 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none";

    // Text labels based on context
    const modalTitle = groupToEdit 
        ? (isPJ ? 'Editar Grupo' : 'Editar Grupo') 
        : (isPJ ? (businessType === 'reembolso' ? 'Novo Reembolso' : 'Novo Rateio') : 'Novo Grupo de Despesas');
        
    const nameLabel = isPJ ? 'Nome do Projeto / Centro de Custo' : 'Nome do Grupo';
    const descLabel = isPJ ? 'Finalidade / Descrição' : 'Descrição';

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-lg animate-scale-in max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-white">
                        {modalTitle}
                    </h3>
                    <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                        <CloseIcon />
                    </button>
                </div>

                {/* Body */}
                <form id="splitGroupForm" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                    
                    {/* Visual Identity */}
                    <div className="flex gap-6 items-start">
                        {/* Visual Preview */}
                        <div 
                            className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-md transition-all relative overflow-hidden flex-shrink-0"
                            style={{ background: previewGradient, color: '#fff' }}
                        >
                            <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent"></div>
                            <div className="relative z-10 w-10 h-10 flex items-center justify-center">
                                {emojiOpcional ? <span className="text-3xl">{emojiOpcional}</span> : <DynamicIcon name={icone} size={32} />}
                            </div>
                        </div>
                        
                        <div className="flex-1 space-y-4">
                            {/* Color Picker */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Cor Principal</label>
                                <div className="flex flex-wrap gap-2">
                                    {PRESET_COLORS.map(c => (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setCorPrincipal(c)}
                                            className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${corPrincipal === c ? 'border-gray-500 dark:border-white scale-110 shadow-sm' : 'border-transparent'}`}
                                            style={{ backgroundColor: c }}
                                        />
                                    ))}
                                    <input 
                                        type="color" 
                                        value={corPrincipal}
                                        onChange={(e) => setCorPrincipal(e.target.value)}
                                        className="w-6 h-6 rounded-full cursor-pointer p-0 border-0"
                                    />
                                </div>
                            </div>

                            {/* Icon Picker Trigger */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Ícone & Emoji</label>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsIconPickerOpen(!isIconPickerOpen)}
                                        className="flex-1 flex items-center justify-between border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-dark-200 text-gray-700 dark:text-white hover:bg-gray-50 dark:hover:bg-dark-300 transition-colors text-sm"
                                    >
                                        <div className="flex items-center gap-2">
                                            <DynamicIcon name={icone} size={16} className="text-gray-500" />
                                            <span>{icone}</span>
                                        </div>
                                    </button>
                                    <input 
                                        type="text" 
                                        value={emojiOpcional} 
                                        onChange={(e) => setEmojiOpcional(e.target.value)} 
                                        placeholder="Emoji"
                                        className="w-20 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white text-gray-900 dark:bg-dark-200 dark:text-white text-sm outline-none"
                                        maxLength={2}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Expanded Icon Picker */}
                    {isIconPickerOpen && (
                        <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-3 bg-gray-50 dark:bg-dark-200 animate-fade-in">
                                <div className="relative mb-2">
                                <input 
                                    type="text" 
                                    placeholder="Pesquisar ícone..." 
                                    value={iconSearch}
                                    onChange={e => {
                                        setIconSearch(e.target.value);
                                        setVisibleIconCount(60);
                                        setSelectedCategory('');
                                    }}
                                    className="w-full pl-8 pr-4 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white text-gray-900 dark:bg-dark-100 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    autoFocus
                                />
                                <SearchIcon className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
                                </div>

                                <div className="flex flex-wrap gap-1.5 mb-2">
                                {ICON_CATEGORIES.map(cat => (
                                    <button
                                        key={cat.label}
                                        type="button"
                                        onClick={() => handleCategoryClick(cat.term, cat.label)}
                                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                                            (selectedCategory === cat.label)
                                                ? 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-800' 
                                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100 dark:bg-dark-100 dark:text-gray-400 dark:border-gray-700'
                                        }`}
                                    >
                                        {cat.label}
                                    </button>
                                ))}
                            </div>

                            <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 max-h-[140px] overflow-y-auto custom-scrollbar p-1">
                                {filteredIcons.slice(0, visibleIconCount).map((iconKey) => {
                                    const isSelected = icone === iconKey;
                                    return (
                                        <button
                                            key={iconKey}
                                            type="button"
                                            onClick={() => {
                                                setIcone(iconKey);
                                                setIsIconPickerOpen(false);
                                            }}
                                            className={`aspect-square rounded flex items-center justify-center border transition-all hover:bg-white dark:hover:bg-dark-100 hover:shadow-sm ${
                                                isSelected 
                                                    ? 'border-indigo-500 bg-white dark:bg-dark-100 shadow-sm ring-1 ring-indigo-500 text-indigo-600 dark:text-indigo-400' 
                                                    : 'border-transparent hover:border-gray-200 dark:hover:border-gray-600 text-gray-500 dark:text-gray-400'
                                            }`}
                                            title={iconKey}
                                        >
                                            <DynamicIcon name={iconKey} size={20} />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Basic Fields */}
                    <div className="space-y-4">
                        {isPJ && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de Operação</label>
                                <select 
                                    value={businessType} 
                                    onChange={(e) => setBusinessType(e.target.value as any)} 
                                    className={commonInputClass}
                                    disabled={!!groupToEdit} // Can't change type after create
                                >
                                    <option value="rateio">Rateio de Custos (Entre sócios/projetos)</option>
                                    <option value="reembolso">Reembolso Corporativo (Empresa paga colaborador)</option>
                                </select>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{nameLabel} <span className="text-red-500">*</span></label>
                            <input 
                                type="text" 
                                value={nome} 
                                onChange={(e) => setNome(e.target.value)} 
                                placeholder={isPJ ? "Ex: Projeto Alpha, Marketing, Viagem SP..." : "Ex: Casa Praia, República..."}
                                className={commonInputClass}
                                required
                            />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recorrência <span className="text-red-500">*</span></label>
                                <select 
                                    value={tipo} 
                                    onChange={(e) => setTipo(e.target.value as SplitGroupType)} 
                                    className={commonInputClass}
                                >
                                    <option value="fixo">Fixa (Recorrente)</option>
                                    <option value="temporario">Temporária</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                                <select 
                                    value={ativo ? 'ativo' : 'inativo'} 
                                    onChange={(e) => setAtivo(e.target.value === 'ativo')} 
                                    className={commonInputClass}
                                >
                                    <option value="ativo">Ativo</option>
                                    <option value="inativo">Encerrado</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{descLabel}</label>
                            <textarea 
                                value={descricao} 
                                onChange={(e) => setDescricao(e.target.value)} 
                                rows={2}
                                className={commonInputClass}
                                placeholder="Opcional."
                            />
                        </div>

                        {!groupToEdit && (
                            <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-lg border border-indigo-100 dark:border-indigo-800">
                                <p className="text-xs text-indigo-800 dark:text-indigo-300">
                                    <strong>Nota:</strong> Você será adicionado automaticamente como administrador.
                                </p>
                            </div>
                        )}
                    </div>
                </form>

                {/* Footer */}
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                        Cancelar
                    </button>
                    <button type="submit" form="splitGroupForm" className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
                        {groupToEdit ? 'Salvar Alterações' : 'Criar Grupo'}
                    </button>
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

export default SplitGroupFormModal;
