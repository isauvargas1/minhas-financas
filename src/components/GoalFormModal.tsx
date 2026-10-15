
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Goal, GoalCategory, GoalPriority, GoalStatus, BusinessGoalType, GoalPeriod } from '../types.ts';
import { CloseIcon, SearchIcon, SparklesIcon, DynamicIcon, useTablerIconKeys, BriefcaseIcon, BuildingIcon } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import {
    BUSINESS_TYPE_LABELS, GOAL_CASH_REGIME_NOTE, GOAL_COST_CENTER_NOTE, buildGoalSubmission, businessTypeNeedsCashNote,
    emptyGoalFormState, formProgressSource, formTargetIsPercent, formatCents, formatCivilDate,
    goalErrorView, goalToFormState, monthlySuggestionCents, parseReaisToCents,
    type GoalFormState, type GoalMeasure, type GoalSubmission,
} from '../modules/goals/model.ts';
import { resolveIntentKey, type IntentKey } from '../modules/transactions/cashEntry.ts';
import { newIdempotencyKey } from '../modules/workspaces/callables.ts';

interface GoalFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Envia ao backend; rejeita com o erro da callable (a mensagem é tratada aqui). */
    onSave: (submission: GoalSubmission, idempotencyKey: string) => Promise<void>;
    goalToEdit?: Goal | null;
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

/** Indicadores PJ: os rótulos são os do contrato (regime de caixa realizado). */
const BUSINESS_GOAL_TYPES: { value: BusinessGoalType, label: string, icon: string, description: string }[] = [
    { value: 'faturamento', label: BUSINESS_TYPE_LABELS.faturamento, icon: 'CurrencyDollar', description: 'Recebimentos operacionais realizados no período' },
    { value: 'lucro', label: BUSINESS_TYPE_LABELS.lucro, icon: 'Briefcase', description: 'Recebimentos menos despesas operacionais realizadas; não é lucro contábil' },
    { value: 'margem', label: BUSINESS_TYPE_LABELS.margem, icon: 'TrendingUp', description: 'Resultado operacional de caixa em percentual dos recebimentos' },
    { value: 'reducao_custos', label: BUSINESS_TYPE_LABELS.reducao_custos, icon: 'ArrowDown', description: 'Teto de despesas operacionais no período; acompanha o consumo do limite' },
    { value: 'caixa_minimo', label: BUSINESS_TYPE_LABELS.caixa_minimo, icon: 'PiggyBank', description: 'Saldo disponível em contas, medido no momento, sem período' },
    { value: 'investimento', label: 'Investimento / Expansão', icon: 'Building', description: 'Acúmulo para compra de ativos ou expansão' },
];

/** Meta empresarial com valor informado pelo usuário (mesmo contrato da meta manual pessoal). */
const PJ_MANUAL_GOAL = {
    label: 'Valor informado',
    icon: 'Target',
    description: 'Você informa o valor acumulado e o atualiza quando quiser. Não cria lançamento, não move conta e não aporta em investimento.',
};

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
    isOpen, onClose, onSave, goalToEdit,
}) => {
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';
    const profile = isPJ ? 'PJ' : 'PF';

    /*
     * Estado do formulário no mesmo formato do modelo (`GoalFormState`): o
     * payload do backend sai de `buildGoalSubmission`, sem ponto flutuante —
     * valores digitados em reais viram centavos por dígitos e a margem vira
     * pontos-base.
     *
     * INV-P2-027 — "Como medir o progresso": aportes líquidos, valor atual da
     * posição ou valor informado pelo usuário (meta manual).
     */
    const [form, setForm] = useState<GoalFormState>(() => emptyGoalFormState(profile));
    const patch = (changes: Partial<GoalFormState>) => setForm((current) => ({ ...current, ...changes }));

    // Icon Picker State
    const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
    const [iconSearch, setIconSearch] = useState('');
    const [visibleIconCount, setVisibleIconCount] = useState(60);
    const [selectedCategory, setSelectedCategory] = useState('');

    const [isSaving, setIsSaving] = useState(false);
    const [saveErrors, setSaveErrors] = useState<string[]>([]);

    const formRef = useRef<HTMLFormElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    // Mesmo conteúdo reenviado depois de falha: mesma chave; conteúdo novo, chave nova.
    const intentRef = useRef<IntentKey | null>(null);
    const savingRef = useRef(false);

    useEffect(() => {
        if (isOpen) {
            setForm(goalToEdit ? goalToFormState(goalToEdit, profile) : emptyGoalFormState(profile));
            // Reset Picker
            setIsIconPickerOpen(false);
            setIconSearch('');
            setSaveErrors([]);
            setIsSaving(false);
            savingRef.current = false;
            intentRef.current = null;
        }
    }, [isOpen, goalToEdit, profile]);

    const targetIsPercent = formTargetIsPercent(form, profile);
    const progressSource = formProgressSource(form, profile);

    // Sugestão de aporte (meta pessoal): inteira, em centavos.
    const suggestionCents = useMemo(() => {
        if (isPJ) return 0;
        const targetCents = parseReaisToCents(form.target);
        if (targetCents === null) return 0;
        const progressCents = form.measure === 'manual'
            ? parseReaisToCents(form.manual, { allowZero: true }) ?? 0
            : goalToEdit?.progressSource === 'investment' ? goalToEdit.investmentProgressCents ?? 0 : 0;
        return monthlySuggestionCents(targetCents, progressCents, form.deadline);
    }, [isPJ, form.target, form.measure, form.manual, form.deadline, goalToEdit]);

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (savingRef.current) return;
        const built = buildGoalSubmission(form, profile, goalToEdit);
        if (built.ok === false) {
            setSaveErrors(Object.values(built.errors).filter((message): message is string => Boolean(message)));
            return;
        }
        savingRef.current = true;
        setIsSaving(true);
        setSaveErrors([]);
        try {
            const intent = resolveIntentKey(
                intentRef.current, 'saveGoal', built.submission as unknown as Record<string, unknown>, newIdempotencyKey,
            );
            intentRef.current = intent;
            await onSave(built.submission, intent.key);
            onClose();
        } catch (error) {
            console.error('Falha ao salvar meta:', error);
            setSaveErrors([goalErrorView(error).message]);
        } finally {
            savingRef.current = false;
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    const commonInputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 bg-white text-gray-900 dark:bg-dark-200 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all";
    const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
    const darkerColor = adjustBrightness(form.color, -50);
    const previewGradient = `radial-gradient(circle at top left, rgba(255,255,255,0.2) 0%, transparent 40%), linear-gradient(135deg, ${form.color} 0%, ${darkerColor} 100%)`;

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
                                {BUSINESS_GOAL_TYPES.map(t => {
                                    const selected = progressSource !== 'manual' && form.businessType === t.value;
                                    return (
                                    <button
                                        key={t.value}
                                        type="button"
                                        onClick={() => patch({ businessType: t.value, icon: t.icon, measure: 'net_contributions' })}
                                        aria-pressed={selected}
                                        className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${selected ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white dark:bg-dark-200 border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50'}`}
                                    >
                                        <DynamicIcon name={t.icon} size={24} className="mb-2" />
                                        <span className="text-[10px] font-bold text-center uppercase leading-tight">{t.label}</span>
                                    </button>
                                    );
                                })}
                                <button
                                    type="button"
                                    onClick={() => patch({ measure: 'manual', icon: PJ_MANUAL_GOAL.icon })}
                                    aria-pressed={progressSource === 'manual'}
                                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${progressSource === 'manual' ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white dark:bg-dark-200 border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50'}`}
                                >
                                    <DynamicIcon name={PJ_MANUAL_GOAL.icon} size={24} className="mb-2" />
                                    <span className="text-[10px] font-bold text-center uppercase leading-tight">{PJ_MANUAL_GOAL.label}</span>
                                </button>
                            </div>
                            <p className="text-[11px] text-indigo-700 dark:text-indigo-300 italic">
                                * {progressSource === 'manual'
                                    ? PJ_MANUAL_GOAL.description
                                    : BUSINESS_GOAL_TYPES.find(t => t.value === form.businessType)?.description}
                                {progressSource !== 'manual' && businessTypeNeedsCashNote(form.businessType) ? ` ${GOAL_CASH_REGIME_NOTE}` : ''}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="md:col-span-2">
                                <label htmlFor="goal-name" className={labelClass}>Nome da Meta <span className="text-red-500">*</span></label>
                                <input id="goal-name" type="text" value={form.name} onChange={e => patch({ name: e.target.value })} placeholder="Ex: Atingir Breakeven" className={commonInputClass} required />
                            </div>
                            {progressSource === 'business_kpi' && form.businessType !== 'caixa_minimo' && (
                            <div>
                                <label htmlFor="goal-period" className={labelClass}>Período de Apuração</label>
                                <select id="goal-period" value={form.period} onChange={e => patch({ period: e.target.value as GoalPeriod })} className={commonInputClass}>
                                    <option value="mensal">Mensal</option>
                                    <option value="trimestral">Trimestral</option>
                                    <option value="semestral">Semestral</option>
                                    <option value="anual">Anual</option>
                                    <option value="custom">Personalizado</option>
                                </select>
                            </div>
                            )}
                            <div>
                                <label htmlFor="goal-cost-center" className={labelClass}>Centro de Custo (Opcional)</label>
                                <div className="relative">
                                    <input id="goal-cost-center" type="text" value={form.costCenter} onChange={e => patch({ costCenter: e.target.value })} placeholder="Ex: Comercial" aria-describedby="goal-cost-center-help" className={`${commonInputClass} pl-9`} />
                                    <BuildingIcon className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                                </div>
                                <p id="goal-cost-center-help" className="text-xs text-gray-500 mt-1">{GOAL_COST_CENTER_NOTE}</p>
                            </div>
                            {progressSource === 'manual' && (
                                !goalToEdit || goalToEdit.progressSource !== 'manual' ? (
                                    <div>
                                        <label htmlFor="goal-manual-value" className={labelClass}>Valor já acumulado (R$) <span className="text-red-500">*</span></label>
                                        <input id="goal-manual-value" type="text" inputMode="decimal" value={form.manual} onChange={e => patch({ manual: e.target.value })} placeholder="Ex: 1.500,00 (zero vale)" className={commonInputClass} required />
                                        <p className="text-xs text-gray-500 mt-1">
                                            {goalToEdit
                                                ? 'O valor da fonte anterior não é aproveitado: informe o valor inicial desta meta.'
                                                : 'Quanto a empresa já acumulou para esta meta.'}
                                        </p>
                                    </div>
                                ) : (
                                    <div>
                                        <span className={labelClass}>Valor acumulado</span>
                                        <p className={`${commonInputClass} bg-gray-50 text-gray-500`}>{formatCents(goalToEdit.manualProgressCents ?? 0)}</p>
                                        <p className="text-xs text-gray-500 mt-1">Para alterar o valor acumulado, use "Atualizar valor acumulado" na página da meta.</p>
                                    </div>
                                )
                            )}
                            <div>
                                <label htmlFor="goal-target" className={labelClass}>{targetIsPercent ? 'Alvo (%)' : 'Valor Alvo (R$)'} <span className="text-red-500">*</span></label>
                                <input id="goal-target" type="text" inputMode="decimal" value={form.target} onChange={e => patch({ target: e.target.value })} placeholder={targetIsPercent ? 'Ex: 15,5' : 'Ex: 10.000,00'} className={`${commonInputClass} font-bold text-lg`} required />
                            </div>
                            <div>
                                <label htmlFor="goal-deadline" className={labelClass}>Data Limite <span className="text-red-500">*</span></label>
                                <input id="goal-deadline" type="date" value={form.deadline} onChange={e => patch({ deadline: e.target.value })} className={commonInputClass} required />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Estilo e Prioridade</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                 <div>
                                    <label htmlFor="goal-priority" className={labelClass}>Prioridade</label>
                                    <select id="goal-priority" value={form.priority} onChange={e => patch({ priority: e.target.value as GoalPriority })} className={commonInputClass}>
                                        <option value="alta">Alta</option>
                                        <option value="media">Média</option>
                                        <option value="baixa">Baixa</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={labelClass}>Cor Principal</label>
                                    <div className="flex gap-2">
                                        {PRESET_COLORS.map(c => (
                                            <button key={c} type="button" onClick={() => patch({ color: c })} aria-label={`Cor ${c}`} className={`w-8 h-8 rounded-full border-2 ${form.color === c ? 'border-gray-800' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                                        ))}
                                        <input type="color" value={form.color} onChange={e => patch({ color: e.target.value })} aria-label="Cor personalizada" className="w-8 h-8 rounded-full border-0 p-0 cursor-pointer" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </form>

                    {saveErrors.length > 0 && <div role="alert" className="px-6 pt-4 text-sm text-red-600 dark:text-red-400">{saveErrors.map((message) => <p key={message}>{message}</p>)}</div>}
                    <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                        <button type="button" onClick={onClose} disabled={isSaving} className="px-5 py-2 bg-gray-100 dark:bg-dark-200 text-gray-700 dark:text-gray-300 rounded-lg font-medium">Cancelar</button>
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
                                    {form.emoji ? <span className="text-4xl">{form.emoji}</span> : <DynamicIcon name={form.icon} size={40} />}
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
                                                onClick={() => patch({ color: c })}
                                                aria-label={`Cor ${c}`}
                                                className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${form.color === c ? 'border-gray-500 dark:border-white scale-110 shadow-sm' : 'border-transparent'}`}
                                                style={{ backgroundColor: c }}
                                            />
                                        ))}
                                        <input 
                                            type="color" 
                                            value={form.color}
                                            onChange={(e) => patch({ color: e.target.value })}
                                            aria-label="Cor personalizada"
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
                                                        <DynamicIcon name={form.icon} size={20} className="text-gray-500" />
                                                        <span>{form.icon}</span>
                                                    </div>
                                                    <SearchIcon className="w-4 h-4 text-gray-400" />
                                                </button>
                                                <input 
                                                    type="text" 
                                                    value={form.emoji}
                                                    onChange={(e) => patch({ emoji: e.target.value })}
                                                    placeholder="Emoji (Opcional)"
                                                    aria-label="Emoji (Opcional)"
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
                                                        const isSelected = form.icon === iconKey;
                                                        return (
                                                            <button
                                                                key={iconKey}
                                                                type="button"
                                                                onClick={() => {
                                                                    patch({ icon: iconKey });
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
                                <label htmlFor="goal-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome da Meta <span className="text-red-500">*</span></label>
                                <input 
                                    id="goal-name"
                                    type="text" 
                                    value={form.name}
                                    onChange={(e) => patch({ name: e.target.value })}
                                    placeholder="Ex: Viagem Disney 2026"
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="goal-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria <span className="text-red-500">*</span></label>
                                <select 
                                    id="goal-category"
                                    value={form.category}
                                    onChange={(e) => patch({ category: e.target.value as GoalCategory })}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white outline-none"
                                >
                                    {GOAL_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                </select>
                            </div>
                            
                            {/* O status só nasce aqui; depois muda pelos botões da meta (setGoalStatus). */}
                            {!goalToEdit && (
                            <div>
                                <label htmlFor="goal-status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                                <select 
                                    id="goal-status"
                                    value={form.status}
                                    onChange={(e) => patch({ status: e.target.value as GoalStatus })}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white outline-none"
                                >
                                    <option value="em_andamento">Em Andamento</option>
                                    <option value="pausada">Pausada</option>
                                    <option value="alcancada">Concluída</option>
                                    <option value="cancelada">Cancelada</option>
                                </select>
                            </div>
                            )}

                            <div>
                                <label htmlFor="goal-priority" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prioridade</label>
                                <select 
                                    id="goal-priority"
                                    value={form.priority}
                                    onChange={(e) => patch({ priority: e.target.value as GoalPriority })}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white outline-none"
                                >
                                    <option value="alta">Alta</option>
                                    <option value="media">Média</option>
                                    <option value="baixa">Baixa</option>
                                </select>
                            </div>
                            <div className="md:col-span-2">
                                <label htmlFor="goal-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição</label>
                                <textarea 
                                    id="goal-description"
                                    value={form.description}
                                    onChange={(e) => patch({ description: e.target.value })}
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
                                <label htmlFor="goal-target" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor Objetivo (R$) <span className="text-red-500">*</span></label>
                                <input 
                                    id="goal-target"
                                    type="text"
                                    inputMode="decimal"
                                    value={form.target}
                                    onChange={(e) => patch({ target: e.target.value })}
                                    placeholder="Ex: 10.000,00"
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white text-lg font-bold"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="goal-deadline" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data Limite <span className="text-red-500">*</span></label>
                                <input 
                                    id="goal-deadline"
                                    type="date" 
                                    value={form.deadline}
                                    onChange={(e) => patch({ deadline: e.target.value })}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white"
                                    required
                                />
                            </div>
                            
                            {/* Suggestion Box */}
                            {suggestionCents > 0 && (
                                <div className="md:col-span-2 bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl flex items-start gap-3 border border-indigo-100 dark:border-indigo-800">
                                    <SparklesIcon className="text-indigo-500 mt-1 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300">Sugestão de Aporte</p>
                                        <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">
                                            Para atingir <b>{formatCents(parseReaisToCents(form.target) ?? 0)}</b> até <b>{formatCivilDate(form.deadline)}</b>, você precisa investir aproximadamente:
                                        </p>
                                        <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                                            {formatCents(suggestionCents)} / mês
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
                                    value={form.measure}
                                    onChange={(event) => patch({ measure: event.target.value as GoalMeasure })}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white"
                                >
                                    <option value="net_contributions">Pelo valor aportado</option>
                                    <option value="current_value">Pelo valor atual da posição</option>
                                    <option value="manual">Informado por mim</option>
                                </select>
                                <p className="text-xs text-gray-500 mt-1">
                                    {form.measure === 'net_contributions'
                                        ? 'O progresso soma os aportes líquidos vinculados e não muda com a variação de mercado.'
                                        : form.measure === 'current_value'
                                            ? 'O progresso acompanha o valor atual das posições vinculadas. Sem marcação a mercado, ele é o capital aplicado.'
                                            : 'Você informa o valor já acumulado e o atualiza quando quiser. Não cria lançamento, não move conta e não aporta em investimento.'}
                                </p>
                            </div>

                            {form.measure === 'manual' ? (
                                !goalToEdit || goalToEdit.progressSource !== 'manual' ? (
                                    <div>
                                        <label htmlFor="goal-manual-value" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor já acumulado (R$) <span className="text-red-500">*</span></label>
                                        <input
                                            id="goal-manual-value"
                                            type="text"
                                            inputMode="decimal"
                                            value={form.manual}
                                            onChange={(e) => patch({ manual: e.target.value })}
                                            placeholder="Ex: 1.500,00 (zero vale)"
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white"
                                            required
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            {goalToEdit
                                                ? 'O valor da fonte anterior não é aproveitado: informe o valor inicial desta meta.'
                                                : 'Quanto você já tem guardado para esta meta.'}
                                        </p>
                                    </div>
                                ) : (
                                    <div>
                                        <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor acumulado</span>
                                        <p className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 bg-gray-50 text-gray-500">{formatCents(goalToEdit.manualProgressCents ?? 0)}</p>
                                        <p className="text-xs text-gray-500 mt-1">
                                            Para alterar o valor acumulado, use "Atualizar valor acumulado" na página da meta.
                                        </p>
                                    </div>
                                )
                            ) : (
                                <div>
                                    <label htmlFor="goal-current-balance" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Saldo Atual (Automático)</label>
                                    <input
                                        id="goal-current-balance"
                                        type="text"
                                        value={formatCents(goalToEdit?.progressSource === 'investment' ? goalToEdit.investmentProgressCents ?? 0 : 0)}
                                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white bg-gray-50 text-gray-500 cursor-not-allowed"
                                        disabled
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        O saldo vem das posições de investimento vinculadas à meta, em Investimentos.
                                    </p>
                                </div>
                            )}
                            <div>
                                <label htmlFor="goal-start-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data de Início</label>
                                <input 
                                    id="goal-start-date"
                                    type="date" 
                                    value={form.startDate}
                                    onChange={(e) => patch({ startDate: e.target.value })}
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white"
                                />
                            </div>
                        </div>
                    </section>

                </form>

                {saveErrors.length > 0 && <div role="alert" className="px-6 pt-4 text-sm text-red-600 dark:text-red-400">{saveErrors.map((message) => <p key={message}>{message}</p>)}</div>}
                {/* Footer */}
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                    <button type="button" onClick={onClose} disabled={isSaving} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
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
