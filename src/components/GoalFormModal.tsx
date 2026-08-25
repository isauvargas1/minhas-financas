
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Goal, GoalCategory, GoalPriority, GoalHorizon, EntityItem, Transaction, GoalStatus, BusinessGoalType, GoalPeriod } from '../types.ts';
import { CloseIcon, SearchIcon, SparklesIcon, DynamicIcon, getAllTablerIconKeys, BriefcaseIcon, BuildingIcon, ClockIcon } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface GoalFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (goal: Omit<Goal, 'id'> & { id?: string }, idempotencyKey: string) => Promise<Goal>;
    goalToEdit?: Goal | null;
    wallets: EntityItem[]; 
    transactions?: Transaction[];
    onLinkTransactions?: (transactionIds: string[], goalId: string, idempotencyKey: string) => Promise<void>;
    initialSection?: 'details' | 'linking';
}

const GOAL_CATEGORIES: { value: GoalCategory, label: string }[] = [
    { value: 'reserva_emergencia', label: 'Reserva de Emergência' },
    { value: 'viagem', label: 'Viagem' },
    { value: 'veiculo', label: 'Veículo' },
    { value: 'imovel', label: 'Imóvel' },
    { value: 'eletronicos', label: 'Eletrônicos' },
    { value: 'educacao', label: 'Educação' },
    { value: 'patrimonio', label: 'Patrimônio / Aposentadoria' },
    { value: 'outro', label: 'Outro' },
];

const BUSINESS_GOAL_TYPES: { value: BusinessGoalType, label: string, icon: string, description: string }[] = [
    { value: 'faturamento', label: 'Faturamento', icon: 'CurrencyDollar', description: 'Receita bruta total no período' },
    { value: 'lucro', label: 'Lucro Líquido', icon: 'Briefcase', description: 'Receitas menos despesas' },
    { value: 'margem', label: 'Margem de Lucro (%)', icon: 'TrendingUp', description: 'Percentual de lucro sobre a receita' },
    { value: 'reducao_custos', label: 'Redução de Custos', icon: 'ArrowDown', description: 'Economia em relação a um teto de gastos' },
    { value: 'caixa_minimo', label: 'Reserva de Caixa', icon: 'PiggyBank', description: 'Garantir saldo mínimo em conta' },
    { value: 'investimento', label: 'Investimento / Expansão', icon: 'Building', description: 'Acúmulo para compra de ativos ou expansão' },
];

const PRESET_COLORS = ['#6366f1', '#ef4444', '#22c55e', '#eab308', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316'];

const ICON_CATEGORIES = [
    { label: 'Todos', term: '' },
    { label: 'Financeiro', term: 'currency money coin wallet bank cash credit' },
    { label: 'Objetos', term: 'device phone laptop desktop car home building' },
    { label: 'Lazer', term: 'plane beach sun music camera ticket' },
    { label: 'Símbolos', term: 'star heart shield check target trophy' },
];

const adjustBrightness = (color: string, amount: number) => {
    return '#' + color.replace(/^#/, '').replace(/../g, color => ('0'+Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
}

const GoalFormModal: React.FC<GoalFormModalProps> = ({ 
    isOpen, onClose, onSave, goalToEdit, wallets, 
    transactions = [], onLinkTransactions, initialSection = 'details' 
}) => {
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';

    // Basic Info
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState<GoalCategory>('outro');
    const [priority, setPriority] = useState<GoalPriority>('media');
    const [status, setStatus] = useState<GoalStatus>('em_andamento');

    // PJ Specific
    const [businessType, setBusinessType] = useState<BusinessGoalType>('faturamento');
    const [period, setPeriod] = useState<GoalPeriod>('mensal');
    const [costCenter, setCostCenter] = useState('');

    // Financial
    const [targetAmount, setTargetAmount] = useState('');
    const [currentAmount, setCurrentAmount] = useState('0');
    /*
     * INV-P2-027 — base de progresso da meta.
     *
     * O backend suporta as duas bases desde o M3, e nenhum formulário as
     * expunha: toda meta nascia em `net_contributions` e `current_value` era
     * inalcançável pelo produto. A escolha muda o que o número da meta
     * significa — quanto foi aportado, ou quanto a posição vale hoje.
     */
    const [progressBasis, setProgressBasis] =
        useState<'net_contributions' | 'current_value'>('net_contributions');
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [deadline, setDeadline] = useState('');

    // Visual
    const [color, setColor] = useState(PRESET_COLORS[0]);
    const [icon, setIcon] = useState('Target');
    const [emoji, setEmoji] = useState('');

    // Icon Picker State
    const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
    const [iconSearch, setIconSearch] = useState('');
    const [visibleIconCount, setVisibleIconCount] = useState(60);
    const [selectedCategory, setSelectedCategory] = useState('');

    // Suggestion State
    const [monthlySuggestion, setMonthlySuggestion] = useState<number | null>(null);

    // Retroactive Linking State
    const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const formRef = useRef<HTMLFormElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const saveRequestId = useRef(crypto.randomUUID());
    const linkRequestId = useRef(crypto.randomUUID());

    useEffect(() => {
        if (isOpen) {
            if (goalToEdit) {
                setName(goalToEdit.name);
                setDescription(goalToEdit.description || '');
                setCategory(goalToEdit.category);
                setPriority(goalToEdit.priority);
                setStatus(goalToEdit.status);
                setTargetAmount(String(goalToEdit.targetAmount));
                setCurrentAmount(String(goalToEdit.currentAmount));
                setProgressBasis(goalToEdit.progressBasis ?? 'net_contributions');
                setStartDate(goalToEdit.startDate);
                setDeadline(goalToEdit.deadline);
                setColor(goalToEdit.visual.color);
                setIcon(goalToEdit.visual.icon);
                setEmoji(goalToEdit.visual.emoji || '');
                
                // PJ Fields
                setBusinessType(goalToEdit.businessType || 'investimento');
                setPeriod(goalToEdit.period || 'custom');
                setCostCenter(goalToEdit.costCenter || '');
                
                // Transactions
                const linked = transactions.filter(t =>
                    t.type === 'investimento' &&
                    (!t.investmentMetadata || t.investmentMetadata.investmentOperation === 'contribution') &&
                    t.goalId === goalToEdit.id
                ).map(t => String(t.id));
                setSelectedTransactionIds(linked);
            } else {
                // Reset
                setName('');
                setDescription('');
                setCategory('outro');
                setPriority('media');
                setStatus('em_andamento');
                setTargetAmount('');
                setCurrentAmount('0');
                setStartDate(new Date().toISOString().split('T')[0]);
                const nextYear = new Date();
                nextYear.setFullYear(nextYear.getFullYear() + 1);
                setDeadline(nextYear.toISOString().split('T')[0]);
                
                setColor(isPJ ? '#0f766e' : PRESET_COLORS[0]);
                setIcon(isPJ ? 'Briefcase' : 'Target');
                setEmoji('');
                setBusinessType(isPJ ? 'faturamento' : 'investimento');
                setPeriod(isPJ ? 'mensal' : 'custom');
                setCostCenter('');
                setSelectedTransactionIds([]);
            }
            // Reset Picker
            setIsIconPickerOpen(false);
            setIconSearch('');
            setSaveError(null);
            setIsSaving(false);
            saveRequestId.current = crypto.randomUUID();
            linkRequestId.current = crypto.randomUUID();
        }
    }, [isOpen, goalToEdit, isPJ]);

    // Calculate suggestion (PF Only mostly)
    useEffect(() => {
        if (targetAmount && deadline) {
            const target = parseFloat(targetAmount);
            const current = parseFloat(currentAmount) || 0;
            const remaining = target - current;
            
            const start = new Date();
            const end = new Date(deadline);
            const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
            
            if (months > 0 && remaining > 0) {
                setMonthlySuggestion(remaining / months);
            } else {
                setMonthlySuggestion(null);
            }
        } else {
            setMonthlySuggestion(null);
        }
    }, [targetAmount, currentAmount, deadline]);

    // Scroll handling for PF Modal
    useEffect(() => {
        if (isOpen && initialSection === 'linking') {
            setTimeout(() => {
                const el = document.getElementById('linking-section');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 300);
        }
    }, [isOpen, initialSection]);

    useEffect(() => {
        if (!isOpen) return;
        previousFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        requestAnimationFrame(() => titleRef.current?.focus());
        return () => previousFocusRef.current?.focus();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isSaving) onClose();
            if (event.key === 'Tab' && modalRef.current) {
                const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ));
                if (focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, isSaving, onClose]);

    // --- ICON SEARCH LOGIC ---
    const allIconKeys = useMemo(() => getAllTablerIconKeys(), []);
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

    const calculateHorizon = (start: string, end: string): GoalHorizon => {
        const s = new Date(start);
        const e = new Date(end);
        const years = (e.getFullYear() - s.getFullYear()) + (e.getMonth() - s.getMonth()) / 12;
        if (years <= 1) return 'curto';
        if (years <= 5) return 'medio';
        return 'longo';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSaving) return;
        setIsSaving(true);
        setSaveError(null);

        const newGoal: Omit<Goal, 'id'> & { id?: string } = {
            ...(goalToEdit ? { id: goalToEdit.id } : {}),
            name,
            description,
            category,
            priority,
            status,
            targetAmount: parseFloat(targetAmount),
            currentAmount: parseFloat(currentAmount), 
            startDate,
            deadline,
            horizon: calculateHorizon(startDate, deadline),
            businessType: isPJ ? businessType : undefined,
            period: isPJ ? period : undefined,
            costCenter: isPJ ? costCenter : undefined,
            isAutomatic: isPJ && businessType !== 'investimento',
            progressBasis,
            visual: { color, icon, emoji, progressBarType: 'linear' },
            createdAt: goalToEdit ? goalToEdit.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        try {
            const persistedGoal = await onSave(newGoal, saveRequestId.current);
            if (onLinkTransactions) {
                await onLinkTransactions(selectedTransactionIds, persistedGoal.id, linkRequestId.current);
            }
            onClose();
        } catch (error) {
            console.error('Falha ao salvar meta:', error);
            setSaveError('Não foi possível salvar a meta. Revise os dados e tente novamente.');
        } finally {
            setIsSaving(false);
        }
    };

    const availableInvestments = transactions.filter(t => 
        t.type === 'investimento' && 
        (!t.investmentMetadata || t.investmentMetadata.investmentOperation === 'contribution') &&
        (t.goalId === undefined || (goalToEdit && t.goalId === goalToEdit.id))
    );

    const toggleTransactionSelection = (id: string | number) => {
        const stringId = String(id);
        setSelectedTransactionIds(prev => 
            prev.includes(stringId) ? prev.filter(tid => tid !== stringId) : [...prev, stringId]
        );
    };

    if (!isOpen) return null;

    const commonInputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 bg-white text-gray-900 dark:bg-dark-200 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all";
    const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
    const darkerColor = adjustBrightness(color, -50);
    const previewGradient = `radial-gradient(circle at top left, rgba(255,255,255,0.2) 0%, transparent 40%), linear-gradient(135deg, ${color} 0%, ${darkerColor} 100%)`;

    // --- PJ MODE RENDER ---
    if (isPJ) {
        return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => !isSaving && onClose()}>
                <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="goal-modal-title" className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-2xl animate-scale-in max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
                        <h3 id="goal-modal-title" ref={titleRef} tabIndex={-1} className="text-xl font-bold text-gray-800 dark:text-white outline-none">
                            {goalToEdit ? 'Editar Meta' : 'Nova Meta Empresarial'}
                        </h3>
                        <button type="button" onClick={onClose} aria-label="Fechar" className="text-gray-500 hover:text-gray-700"><CloseIcon /></button>
                    </div>

                    <form id="goalForm" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                        <div className="space-y-4 bg-indigo-50 dark:bg-indigo-900/10 p-5 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                            <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                                <BriefcaseIcon className="w-4 h-4" /> Objetivo de Negócio
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {BUSINESS_GOAL_TYPES.map(t => (
                                    <button
                                        key={t.value}
                                        type="button"
                                        onClick={() => {
                                            setBusinessType(t.value);
                                            setIcon(t.icon);
                                        }}
                                        className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${businessType === t.value ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white dark:bg-dark-200 border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50'}`}
                                    >
                                        <DynamicIcon name={t.icon} size={24} className="mb-2" />
                                        <span className="text-[10px] font-bold text-center uppercase leading-tight">{t.label}</span>
                                    </button>
                                ))}
                            </div>
                            <p className="text-[11px] text-indigo-700 dark:text-indigo-300 italic">
                                * {BUSINESS_GOAL_TYPES.find(t => t.value === businessType)?.description}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="md:col-span-2">
                                <label className={labelClass}>Nome da Meta <span className="text-red-500">*</span></label>
                                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Atingir Breakeven" className={commonInputClass} required />
                            </div>
                            <div>
                                <label className={labelClass}>Período de Apuração</label>
                                <select value={period} onChange={e => setPeriod(e.target.value as any)} className={commonInputClass}>
                                    <option value="mensal">Mensal</option>
                                    <option value="trimestral">Trimestral</option>
                                    <option value="semestral">Semestral</option>
                                    <option value="anual">Anual</option>
                                    <option value="custom">Personalizado</option>
                                </select>
                            </div>
                            <div>
                                <label className={labelClass}>Centro de Custo (Opcional)</label>
                                <div className="relative">
                                    <input type="text" value={costCenter} onChange={e => setCostCenter(e.target.value)} placeholder="Ex: Comercial" className={`${commonInputClass} pl-9`} />
                                    <BuildingIcon className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                                </div>
                            </div>
                            <div>
                                <label className={labelClass}>{businessType === 'margem' ? 'Alvo (%)' : 'Valor Alvo (R$)'} <span className="text-red-500">*</span></label>
                                <input type="number" step="0.01" value={targetAmount} onChange={e => setTargetAmount(e.target.value)} className={`${commonInputClass} font-bold text-lg`} required />
                            </div>
                            <div>
                                <label className={labelClass}>Data Limite <span className="text-red-500">*</span></label>
                                <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className={commonInputClass} required />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Estilo e Prioridade</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                 <div>
                                    <label className={labelClass}>Prioridade</label>
                                    <select value={priority} onChange={e => setPriority(e.target.value as any)} className={commonInputClass}>
                                        <option value="alta">Alta</option>
                                        <option value="media">Média</option>
                                        <option value="baixa">Baixa</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={labelClass}>Cor Principal</label>
                                    <div className="flex gap-2">
                                        {PRESET_COLORS.map(c => (
                                            <button key={c} type="button" onClick={() => setColor(c)} className={`w-8 h-8 rounded-full border-2 ${color === c ? 'border-gray-800' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                                        ))}
                                        <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-8 h-8 rounded-full border-0 p-0 cursor-pointer" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </form>

                    {saveError && <p role="alert" className="px-6 pt-4 text-sm text-red-600 dark:text-red-400">{saveError}</p>}
                    <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                        <button onClick={onClose} className="px-5 py-2 bg-gray-100 dark:bg-dark-200 text-gray-700 dark:text-gray-300 rounded-lg font-medium">Cancelar</button>
                        <button type="submit" form="goalForm" disabled={isSaving} className="px-8 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg font-bold shadow-md">{isSaving ? 'Salvando...' : 'Salvar Meta'}</button>
                    </div>
                </div>
            </div>
        );
    }

    // --- PF MODE RENDER (RESTAURADO) ---
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={() => !isSaving && onClose()}>
            <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="goal-modal-title" className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-2xl animate-scale-in max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
                    <h3 id="goal-modal-title" ref={titleRef} tabIndex={-1} className="text-xl font-bold text-gray-800 dark:text-white outline-none">
                        {goalToEdit ? 'Editar Meta' : 'Nova Meta Financeira'}
                    </h3>
                    <button type="button" onClick={onClose} aria-label="Fechar" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                        <CloseIcon />
                    </button>
                </div>

                {/* Body */}
                <form id="goalForm" ref={formRef} onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-8">
                    
                    {/* Section 1: Visual Identity */}
                    <section className="space-y-4">
                        <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Identidade Visual</h4>
                        <div className="flex flex-col sm:flex-row gap-6 items-start">
                            {/* Visual Preview */}
                            <div 
                                className="w-24 h-24 rounded-2xl flex items-center justify-center shadow-md transition-all relative overflow-hidden flex-shrink-0"
                                style={{ background: previewGradient, color: '#fff' }}
                            >
                                <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent"></div>
                                <div className="relative z-10 w-12 h-12 flex items-center justify-center">
                                    {emoji ? <span className="text-4xl">{emoji}</span> : <DynamicIcon name={icon} size={40} />}
                                </div>
                            </div>
                            
                            <div className="flex-1 w-full space-y-4">
                                {/* Color Picker */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Cor Principal</label>
                                    <div className="flex flex-wrap gap-2">
                                        {PRESET_COLORS.map(c => (
                                            <button
                                                key={c}
                                                type="button"
                                                onClick={() => setColor(c)}
                                                className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${color === c ? 'border-gray-500 dark:border-white scale-110 shadow-sm' : 'border-transparent'}`}
                                                style={{ backgroundColor: c }}
                                            />
                                        ))}
                                        <input 
                                            type="color" 
                                            value={color}
                                            onChange={(e) => setColor(e.target.value)}
                                            className="w-8 h-8 rounded-full cursor-pointer p-0 border-0"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-4">
                                    {/* Icon Picker Trigger */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ícone</label>
                                        
                                        {!isIconPickerOpen ? (
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setIsIconPickerOpen(true)}
                                                    className="flex-1 flex items-center justify-between border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-dark-200 text-gray-700 dark:text-white hover:bg-gray-50 dark:hover:bg-dark-300 transition-colors"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <DynamicIcon name={icon} size={20} className="text-gray-500" />
                                                        <span>{icon}</span>
                                                    </div>
                                                    <SearchIcon className="w-4 h-4 text-gray-400" />
                                                </button>
                                                <input 
                                                    type="text" 
                                                    value={emoji} 
                                                    onChange={(e) => setEmoji(e.target.value)} 
                                                    placeholder="Emoji (Opcional)"
                                                    className="w-1/3 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-dark-200 dark:text-white"
                                                />
                                            </div>
                                        ) : (
                                            /* EXPANDED ICON PICKER */
                                            <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-3 bg-gray-50 dark:bg-dark-200 animate-fade-in">
                                                 <div className="flex justify-between items-center mb-2">
                                                    <h5 className="text-xs font-bold text-gray-500 uppercase">Biblioteca de Ícones</h5>
                                                    <button type="button" onClick={() => setIsIconPickerOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                                                        <CloseIcon className="w-4 h-4" />
                                                    </button>
                                                 </div>

                                                 {/* Search Input */}
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
                                                        className="w-full pl-8 pr-4 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-dark-100 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                                        autoFocus
                                                    />
                                                    <SearchIcon className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
                                                 </div>

                                                 {/* Categories */}
                                                 <div className="flex flex-wrap gap-1.5 mb-2">
                                                    {ICON_CATEGORIES.map(cat => (
                                                        <button
                                                            key={cat.label}
                                                            type="button"
                                                            onClick={() => handleCategoryClick(cat.term, cat.label)}
                                                            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                                                                (selectedCategory === cat.label || (cat.label === 'Todos' && selectedCategory === '' && iconSearch === ''))
                                                                    ? 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-800' 
                                                                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100 dark:bg-dark-100 dark:text-gray-400 dark:border-gray-700'
                                                            }`}
                                                        >
                                                            {cat.label}
                                                        </button>
                                                    ))}
                                                </div>

                                                {/* Grid */}
                                                <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 max-h-[180px] overflow-y-auto custom-scrollbar p-1">
                                                    {filteredIcons.slice(0, visibleIconCount).map((iconKey) => {
                                                        const isSelected = icon === iconKey;
                                                        return (
                                                            <button
                                                                key={iconKey}
                                                                type="button"
                                                                onClick={() => {
                                                                    setIcon(iconKey);
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
                                                
                                                {filteredIcons.length > visibleIconCount && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setVisibleIconCount(prev => prev + 60)}
                                                        className="w-full mt-2 py-1 text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded transition-colors"
                                                    >
                                                        Carregar mais...
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <hr className="border-gray-200 dark:border-gray-700" />

                    {/* Section 2: Basic Info */}
                    <section className="space-y-4">
                         <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Detalhes da Meta</h4>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome da Meta <span className="text-red-500">*</span></label>
                                <input 
                                    type="text" 
                                    value={name} 
                                    onChange={(e) => setName(e.target.value)} 
                                    placeholder="Ex: Viagem Disney 2026"
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria <span className="text-red-500">*</span></label>
                                <select 
                                    value={category} 
                                    onChange={(e) => setCategory(e.target.value as GoalCategory)} 
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white outline-none"
                                >
                                    {GOAL_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                </select>
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                                <select 
                                    value={status} 
                                    onChange={(e) => setStatus(e.target.value as GoalStatus)} 
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white outline-none"
                                >
                                    <option value="em_andamento">Em Andamento</option>
                                    <option value="pausada">Pausada</option>
                                    <option value="alcancada">Concluída</option>
                                    <option value="cancelada">Cancelada</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prioridade</label>
                                <select 
                                    value={priority} 
                                    onChange={(e) => setPriority(e.target.value as GoalPriority)} 
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white outline-none"
                                >
                                    <option value="alta">Alta</option>
                                    <option value="media">Média</option>
                                    <option value="baixa">Baixa</option>
                                </select>
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
                                <textarea 
                                    value={description} 
                                    onChange={(e) => setDescription(e.target.value)} 
                                    rows={2}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white outline-none"
                                />
                            </div>
                         </div>
                    </section>

                    <hr className="border-gray-200 dark:border-gray-700" />

                    {/* Section 3: Values & Deadlines */}
                    <section className="space-y-4">
                        <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Planejamento</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor Objetivo (R$) <span className="text-red-500">*</span></label>
                                <input 
                                    type="number" 
                                    value={targetAmount} 
                                    onChange={(e) => setTargetAmount(e.target.value)} 
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white text-lg font-bold"
                                    min="1"
                                    step="0.01"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data Limite <span className="text-red-500">*</span></label>
                                <input 
                                    type="date" 
                                    value={deadline} 
                                    onChange={(e) => setDeadline(e.target.value)} 
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white"
                                    required
                                />
                            </div>
                            
                            {/* Suggestion Box */}
                            {monthlySuggestion && monthlySuggestion > 0 && (
                                <div className="md:col-span-2 bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl flex items-start gap-3 border border-indigo-100 dark:border-indigo-800">
                                    <SparklesIcon className="text-indigo-500 mt-1 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300">Sugestão de Aporte</p>
                                        <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">
                                            Para atingir <b>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(targetAmount))}</b> até <b>{new Date(deadline).toLocaleDateString('pt-BR')}</b>, você precisa investir aproximadamente:
                                        </p>
                                        <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(monthlySuggestion)} / mês
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div>
                                <label htmlFor="goal-progress-basis" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Como medir o progresso
                                </label>
                                <select
                                    id="goal-progress-basis"
                                    value={progressBasis}
                                    onChange={(event) => setProgressBasis(event.target.value as typeof progressBasis)}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white"
                                >
                                    <option value="net_contributions">Pelo valor aportado</option>
                                    <option value="current_value">Pelo valor de mercado da posição</option>
                                </select>
                                <p className="text-xs text-gray-500 mt-1">
                                    {progressBasis === 'net_contributions'
                                        ? 'O progresso soma os aportes líquidos vinculados e não muda com a variação de mercado.'
                                        : 'O progresso acompanha o valor de mercado das posições vinculadas, subindo e descendo com a valoração.'}
                                </p>
                            </div>

                             <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Saldo Atual (Automático)</label>
                                <input 
                                    type="text" 
                                    value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(currentAmount))}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white bg-gray-50 text-gray-500 cursor-not-allowed"
                                    disabled
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    O saldo é calculado somando os investimentos vinculados abaixo.
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data de Início</label>
                                <input 
                                    type="date" 
                                    value={startDate} 
                                    onChange={(e) => setStartDate(e.target.value)} 
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white"
                                />
                            </div>
                        </div>
                    </section>

                    <hr className="border-gray-200 dark:border-gray-700" />

                    {/* Section 4: Retroactive Linking */}
                    <section id="linking-section" className="space-y-4">
                         <div className="flex justify-between items-center">
                            <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Investimentos Vinculados</h4>
                            {selectedTransactionIds.length > 0 && (
                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded">
                                    {selectedTransactionIds.length} selecionados
                                </span>
                            )}
                         </div>
                         <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                            Selecione quais investimentos existentes fazem parte desta meta:
                         </p>
                         
                         {availableInvestments.length > 0 ? (
                             <div className="border border-gray-300 dark:border-gray-600 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-50 dark:bg-dark-200 text-gray-500 dark:text-gray-400 font-medium">
                                        <tr>
                                            <th className="px-4 py-2 w-10">Selecionar</th>
                                            <th className="px-4 py-2">Descrição</th>
                                            <th className="px-4 py-2">Data</th>
                                            <th className="px-4 py-2 text-right">Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                        {availableInvestments.map(t => {
                                            const isSelected = selectedTransactionIds.includes(String(t.id));
                                            return (
                                                <tr 
                                                    key={t.id} 
                                                    onClick={() => toggleTransactionSelection(t.id)}
                                                    className={`cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-dark-200'}`}
                                                >
                                                    <td className="px-4 py-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleTransactionSelection(t.id)}
                                                            onClick={(event) => event.stopPropagation()}
                                                            aria-label={`Vincular ${t.description}`}
                                                            className="h-5 w-5 rounded border-gray-400 text-indigo-600 focus:ring-indigo-500"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                                                        <div className="font-medium">{t.description}</div>
                                                        <div className="text-xs text-gray-500">{t.category}</div>
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                                        {new Date(t.date).toLocaleDateString('pt-BR')}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-bold text-gray-800 dark:text-white">
                                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(t.value)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                             </div>
                         ) : (
                             <div className="text-center py-6 bg-gray-50 dark:bg-dark-200 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                                 <p className="text-gray-500 dark:text-gray-400 text-sm">
                                     Não há investimentos disponíveis para vincular no momento.
                                 </p>
                             </div>
                         )}
                         <p className="text-xs text-gray-400 mt-2">
                             Investimentos já vinculados a OUTRAS metas não aparecem aqui. Desvincule-os na outra meta primeiro se necessário.
                         </p>
                    </section>

                </form>

                {saveError && <p role="alert" className="px-6 pt-4 text-sm text-red-600 dark:text-red-400">{saveError}</p>}
                {/* Footer */}
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                        Cancelar
                    </button>
                    <button type="submit" form="goalForm" disabled={isSaving} className="px-6 py-2 bg-indigo-600 disabled:opacity-60 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
                        {isSaving ? 'Salvando...' : goalToEdit ? 'Salvar Alterações' : 'Criar Meta'}
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
                 /* Custom Scrollbar for Icon Grid */
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

export default GoalFormModal;
