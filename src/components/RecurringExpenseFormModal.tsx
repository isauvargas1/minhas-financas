import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { RecurringExpense, RecurringBusinessType, RecurringExecutionMode, RecurringFrequency, RecurringPaymentMethod, RecurringType } from '../modules/recurring/types.ts';
import { usesBillingDay } from '../modules/recurring/schedule.ts';
import {
    DEFAULT_RECURRING_CATEGORY,
    emptyForm,
    formFromExpense,
    toContractFields,
    toUpdateChanges,
    type RecurringFormState,
} from '../modules/recurring/payloads.ts';
import { BUSINESS_TYPE_LABELS, EXECUTION_MODE_LABELS, executionModeExplanation, recurringErrorView } from '../modules/recurring/presentation.ts';
import { useCreateRecurringExpense, useRecurringIntentKey, useUpdateRecurringExpense } from '../modules/recurring/hooks.ts';
import { saoPauloToday } from '../modules/loans/money.ts';
import { CreditCard } from '../types.ts';
import { CloseIcon, SearchIcon, DynamicIcon, BoltIcon, PaletteIcon, useTablerIconKeys, BuildingIcon, BriefcaseIcon } from './Icons.tsx';
import CashAccountSelect from './accounts/CashAccountSelect.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useTransactionCatalogOptions } from '../modules/settings-catalog/useTransactionCatalogOptions.ts';

interface RecurringExpenseFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Chamado depois que o backend gravou o contrato. */
    onSaved?: (recurringExpenseId: string) => void;
    expenseToEdit?: RecurringExpense | null;
    creditCards: CreditCard[];
}

const PRESET_COLORS = [
    '#E50914', // Netflix Red
    '#1DB954', // Spotify Green
    '#00A8E1', // Prime Blue
    '#4f46e5', // Indigo
    '#0f766e', // Teal (Business)
    '#f59e0b', // Amber
    '#ec4899', // Pink
    '#8b5cf6', // Violet
    '#64748b', // Slate
];

const CONTRACT_TYPES = Object.keys(BUSINESS_TYPE_LABELS) as RecurringBusinessType[];

/**
 * Formulário de recorrência (P4-B). O contrato vai ao backend pelas
 * callables `createRecurringExpense`/`updateRecurringExpense`: valor em
 * centavos, frequência D-12, dia de cobrança nas frequências mensais, modo
 * de execução explícito e destino (cartão ou conta) pela forma de
 * pagamento. Nada é gravado direto no Firestore.
 */
const RecurringExpenseFormModal: React.FC<RecurringExpenseFormModalProps> = ({
    isOpen, onClose, onSaved, expenseToEdit, creditCards
}) => {
    const { activeWorkspace } = useWorkspace();
    // Classificação de despesa: as categorias de despesa ativas do catálogo
    // do workspace (D-23), o mesmo recorte da Divisão de contas.
    const { options: catalog } = useTransactionCatalogOptions('despesa');
    const categories = catalog.settingsCategories;
    const isPJ = activeWorkspace.type === 'PJ';
    const defaults = useMemo(() => ({
        color: isPJ ? '#0f766e' : PRESET_COLORS[0],
        icon: isPJ ? 'FileInvoice' : 'Bolt',
    }), [isPJ]);

    // --- STATE ---
    const [form, setForm] = useState<RecurringFormState>(() => emptyForm(isPJ, saoPauloToday(), defaults));
    const set = <K extends keyof RecurringFormState>(key: K, value: RecurringFormState[K]) =>
        setForm(current => ({ ...current, [key]: value }));
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const submittingRef = useRef(false);

    // UI State
    const [activeTab, setActiveTab] = useState<'geral' | 'pagamento' | 'integracoes' | 'visual'>('geral');
    const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
    const [iconSearch, setIconSearch] = useState('');
    const [visibleIconCount, setVisibleIconCount] = useState(60);

    const createMutation = useCreateRecurringExpense();
    const updateMutation = useUpdateRecurringExpense();
    const intent = useRecurringIntentKey();

    // --- INITIALIZATION ---
    useEffect(() => {
        if (isOpen) {
            setForm(expenseToEdit ? formFromExpense(expenseToEdit) : emptyForm(isPJ, saoPauloToday(), defaults));
            setActiveTab('geral');
            setIsIconPickerOpen(false);
            setError(null);
            intent.reset();
        }
    }, [isOpen, expenseToEdit, isPJ, defaults, intent]);

    const nome = form.name;
    const tipo = form.type;
    const descricao = form.description;
    const fornecedor = form.supplier;
    const tipoEmpresa = form.businessType;
    const centroCusto = form.costCenter;
    const responsavel = form.responsible;
    const dataReajuste = form.adjustmentDate;
    const fidelidade = form.commitment;
    const valorPrevisto = form.amount;
    const periodo = form.frequency;
    const diaCobranca = form.billingDay;
    const dataInicio = form.startDate;
    const dataFim = form.endDate;
    const metodoPagamento = form.paymentMethod;
    const cartaoId = form.cardId;
    const categoriaDespesa = form.category;
    const corPrincipal = form.color;
    const icone = form.icon;
    const emojiOpcional = form.emoji;
    const selectableCards = creditCards.filter(c => c.status === 'active' || c.id === cartaoId);

    // --- ICON PICKER LOGIC ---
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

    // --- HANDLERS ---
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // Duplo clique e Enter repetido: barrados de forma síncrona.
        if (submittingRef.current) return;
        let operation: 'createRecurringExpense' | 'updateRecurringExpense';
        let payload: Record<string, unknown>;
        try {
            if (expenseToEdit) {
                operation = 'updateRecurringExpense';
                payload = {
                    recurringExpenseId: expenseToEdit.id,
                    expectedUpdatedAt: expenseToEdit.version,
                    changes: toUpdateChanges(expenseToEdit, form, isPJ),
                };
            } else {
                operation = 'createRecurringExpense';
                payload = { ...toContractFields(form, isPJ) };
            }
        } catch (validation) {
            setError(recurringErrorView(validation).message);
            return;
        }
        submittingRef.current = true;
        setBusy(true);
        setError(null);
        try {
            const idempotencyKey = intent.keyFor(operation, payload);
            const result = await (expenseToEdit ? updateMutation : createMutation)
                .mutateAsync({ payload, idempotencyKey });
            onSaved?.(result.recurringExpenseId);
            onClose();
        } catch (failure) {
            setError(recurringErrorView(failure).message);
        } finally {
            submittingRef.current = false;
            setBusy(false);
        }
    };

    if (!isOpen) return null;

    const commonInputClass = "w-full border border-border rounded-lg px-4 py-2 bg-background text-on-surface outline-none focus:ring-2 focus:ring-primary transition-colors text-sm";
    const labelClass = "block text-xs font-bold text-muted uppercase tracking-wider mb-1";

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="bg-surface rounded-xl shadow-lg w-full max-w-3xl animate-scale-in max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-border">
                    <h3 id="modal-title" className="text-xl font-bold text-on-surface">
                        {isPJ ? (expenseToEdit ? 'Editar Contrato' : 'Novo Contrato / Recorrência') : (expenseToEdit ? 'Editar Assinatura' : 'Nova Assinatura')}
                    </h3>
                    <button type="button" onClick={onClose} className="text-muted hover:text-on-surface" aria-label="Fechar">
                        <CloseIcon />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border overflow-x-auto" role="tablist">
                    {[
                        { key: 'geral', label: isPJ ? 'Dados do Contrato' : 'Geral', icon: isPJ ? 'FileText' : 'FileText' },
                        { key: 'pagamento', label: 'Pagamento', icon: 'CreditCard' },
                        { key: 'integracoes', label: 'Integrações', icon: 'Puzzle' },
                        { key: 'visual', label: 'Visual', icon: 'Palette' },
                    ].map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.key}
                            onClick={() => setActiveTab(tab.key as any)}
                            className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                                activeTab === tab.key 
                                    ? 'border-primary text-primary' 
                                    : 'border-transparent text-muted hover:text-on-surface'
                            }`}
                        >
                            <DynamicIcon name={tab.icon} size={16} />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Body */}
                <form id="recurringForm" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
                    {error && (
                        <p role="alert" className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
                            {error}
                        </p>
                    )}
                    
                    {/* --- TAB: GERAL --- */}
                    {activeTab === 'geral' && (
                        <div className="space-y-6" role="tabpanel">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div className="md:col-span-2">
                                    <label htmlFor="nome" className={labelClass}>Nome do Contrato / Serviço <span className="text-error">*</span></label>
                                    <input id="nome" type="text" value={nome} onChange={e => set('name', e.target.value)} className={commonInputClass} placeholder="Ex: AWS Cloud, Aluguel Escritório..." required autoFocus />
                                </div>
                                
                                {isPJ && (
                                    <>
                                        <div>
                                            <label htmlFor="fornecedor" className={labelClass}>Fornecedor</label>
                                            <div className="relative">
                                                <input id="fornecedor" type="text" value={fornecedor} onChange={e => set('supplier', e.target.value)} className={`${commonInputClass} pl-9`} placeholder="Ex: Amazon, Imobiliária X..." />
                                                <BuildingIcon className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
                                            </div>
                                        </div>
                                        <div>
                                            <label htmlFor="tipoEmpresa" className={labelClass}>Tipo de Despesa</label>
                                            <select id="tipoEmpresa" value={tipoEmpresa} onChange={e => set('businessType', e.target.value as RecurringBusinessType)} className={commonInputClass}>
                                                {CONTRACT_TYPES.map(t => <option key={t} value={t}>{BUSINESS_TYPE_LABELS[t]}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor="centroCusto" className={labelClass}>Centro de Custo / Projeto</label>
                                            <div className="relative">
                                                <input id="centroCusto" type="text" value={centroCusto} onChange={e => set('costCenter', e.target.value)} className={`${commonInputClass} pl-9`} placeholder="Ex: Marketing, Operação SP..." />
                                                <BriefcaseIcon className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
                                            </div>
                                        </div>
                                        <div>
                                            <label htmlFor="responsavel" className={labelClass}>Responsável Interno</label>
                                            <input id="responsavel" type="text" value={responsavel} onChange={e => set('responsible', e.target.value)} className={commonInputClass} placeholder="Nome do colaborador" />
                                        </div>
                                    </>
                                )}

                                {!isPJ && (
                                    <div>
                                        <label htmlFor="tipo" className={labelClass}>Tipo de Recorrência</label>
                                        <select id="tipo" value={tipo} onChange={e => set('type', e.target.value as RecurringType)} className={commonInputClass}>
                                            <option value="subscription">Assinatura (Stream, Apps)</option>
                                            <option value="fixed_bill">Conta Fixa (Luz, Net)</option>
                                            <option value="service">Serviço (Academia)</option>
                                            <option value="other">Outro</option>
                                        </select>
                                    </div>
                                )}

                                <div>
                                    <label htmlFor="valor" className={labelClass}>Valor Previsto <span className="text-error">*</span></label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-2 text-sm text-muted font-bold">R$</span>
                                        <input id="valor" type="number" step="0.01" value={valorPrevisto} onChange={e => set('amount', e.target.value)} className={`${commonInputClass} pl-9 font-bold`} required placeholder="0.00" />
                                    </div>
                                </div>
                                
                                <div>
                                    <label htmlFor="periodo" className={labelClass}>Frequência</label>
                                    <select id="periodo" value={periodo} onChange={e => set('frequency', e.target.value as RecurringFrequency)} className={commonInputClass}>
                                        <option value="monthly">Mensal</option>
                                        <option value="annual">Anual</option>
                                        <option value="weekly">Semanal</option>
                                        <option value="biweekly">Quinzenal</option>
                                        <option value="bimonthly">Bimestral</option>
                                        <option value="quarterly">Trimestral</option>
                                        <option value="semiannual">Semestral</option>
                                    </select>
                                </div>

                                {usesBillingDay(periodo) && (
                                    <div>
                                        <label htmlFor="diaCobranca" className={labelClass}>Dia do Vencimento</label>
                                        <input id="diaCobranca" type="number" min="1" max="31" value={diaCobranca} onChange={e => set('billingDay', e.target.value)} className={commonInputClass} />
                                    </div>
                                )}

                                <div>
                                    <label htmlFor="dataInicio" className={labelClass}>Início do Contrato</label>
                                    <input id="dataInicio" type="date" value={dataInicio} onChange={e => set('startDate', e.target.value)} className={commonInputClass} required />
                                </div>

                                {isPJ && (
                                    <>
                                        <div>
                                            <label htmlFor="dataReajuste" className={labelClass}>Próximo Reajuste</label>
                                            <input id="dataReajuste" type="date" value={dataReajuste} onChange={e => set('adjustmentDate', e.target.value)} className={commonInputClass} />
                                        </div>
                                        <div>
                                            <label htmlFor="fidelidade" className={labelClass}>Renovação / Fidelidade</label>
                                            <input id="fidelidade" type="text" value={fidelidade} onChange={e => set('commitment', e.target.value)} className={commonInputClass} placeholder="Ex: 12 meses, renovação automática..." />
                                        </div>
                                    </>
                                )}

                                <div>
                                    <label htmlFor="dataFim" className={labelClass}>Término do Contrato</label>
                                    <input id="dataFim" type="date" value={dataFim} onChange={e => set('endDate', e.target.value)} className={commonInputClass} />
                                </div>
                            </div>

                            {isPJ && (
                                <div className="bg-background p-4 rounded-xl border border-dashed border-border">
                                    <label className={labelClass}>Anexo do Contrato (Digital)</label>
                                    <div className="flex items-center gap-3">
                                        <button type="button" className="px-4 py-2 bg-surface border border-border rounded-lg text-xs font-medium hover:bg-background transition-colors flex items-center gap-2">
                                            <DynamicIcon name="Paperclip" size={14} /> Selecionar Arquivo
                                        </button>
                                        <span className="text-xs text-muted italic">Nenhum arquivo anexado</span>
                                    </div>
                                </div>
                            )}

                            <div>
                                <label htmlFor="descricao" className={labelClass}>Notas Adicionais</label>
                                <textarea id="descricao" value={descricao} onChange={e => set('description', e.target.value)} className={commonInputClass} rows={2} placeholder="Detalhes importantes do contrato..." />
                            </div>
                        </div>
                    )}

                    {/* --- TAB: PAGAMENTO --- */}
                    {activeTab === 'pagamento' && (
                        <div className="space-y-6" role="tabpanel">
                            <div>
                                <label className={labelClass}>Método de Pagamento {isPJ && 'Corporativo'}</label>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    {[
                                        { id: 'credit_card', label: isPJ ? 'Cartão Corp.' : 'Cartão Crédito', icon: 'CreditCard' },
                                        { id: 'boleto', label: 'Boleto', icon: 'Barcode' },
                                        { id: 'pix', label: 'Pix / Transf.', icon: 'BrandPix' },
                                        { id: 'debit', label: 'Débito Auto.', icon: 'BuildingBank' },
                                    ].map(m => (
                                        <button
                                            key={m.id}
                                            type="button"
                                            onClick={() => set('paymentMethod', m.id as RecurringPaymentMethod)}
                                            className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-all ${
                                                metodoPagamento === m.id 
                                                    ? 'bg-primary/10 border-primary text-primary' 
                                                    : 'bg-background border-border text-muted hover:bg-background/80'
                                            }`}
                                        >
                                            <DynamicIcon name={m.icon} size={28} className="mb-2" />
                                            <span className="text-xs font-bold uppercase">{m.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {metodoPagamento === 'credit_card' && (
                                <div className="bg-background p-5 rounded-2xl border border-border animate-fade-in space-y-4">
                                    <div>
                                        <label htmlFor="cartao" className={labelClass}>{isPJ ? 'Cartão Corporativo Responsável' : 'Selecione o Cartão'}</label>
                                        <select 
                                            id="cartao"
                                            value={cartaoId}
                                            onChange={e => set('cardId', e.target.value)}
                                            className={commonInputClass}
                                        >
                                            <option value="">-- Selecione o cartão --</option>
                                            {selectableCards.map(c => (
                                                <option key={c.id} value={c.id}>{c.name} ({c.brand}){c.status === 'archived' ? ' (arquivado)' : ''}</option>
                                            ))}
                                        </select>
                                    </div>
                                    
                                </div>
                            )}

                            {metodoPagamento !== 'credit_card' && (
                                <div className="bg-background p-5 rounded-2xl border border-border animate-fade-in space-y-4">
                                    <CashAccountSelect
                                        id="conta-recorrencia"
                                        label="Conta de pagamento"
                                        value={form.cashAccountId}
                                        onChange={(accountId) => set('cashAccountId', accountId)}
                                        autoSelect
                                        labelClassName={labelClass}
                                        selectClassName={commonInputClass}
                                    />
                                </div>
                            )}

                            <fieldset className="bg-background p-5 rounded-2xl border border-border space-y-3">
                                <legend className={labelClass}>Execução no vencimento</legend>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {(['automatic', 'confirmation_required'] as RecurringExecutionMode[]).map(mode => (
                                        <label key={mode} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${form.executionMode === mode ? 'bg-primary/10 border-primary text-primary dark:text-primary-on-dark' : 'bg-surface border-border text-on-surface'}`}>
                                            <input
                                                type="radio"
                                                name="executionMode"
                                                value={mode}
                                                checked={form.executionMode === mode}
                                                onChange={() => set('executionMode', mode)}
                                                className="w-4 h-4 text-primary border-border focus:ring-primary"
                                            />
                                            <span className="text-sm font-bold">{EXECUTION_MODE_LABELS[mode]}</span>
                                        </label>
                                    ))}
                                </div>
                                <p className="text-muted text-xs">{executionModeExplanation(form.executionMode, metodoPagamento)}</p>
                            </fieldset>
                        </div>
                    )}

                    {/* --- TAB: INTEGRAÇÕES --- */}
                    {activeTab === 'integracoes' && (
                        <div className="space-y-6" role="tabpanel">
                            {/* Despesas */}
                            <div className="bg-surface border border-border rounded-xl p-5 shadow-sm">
                                <div className="flex items-center gap-2 mb-4 border-b border-border pb-3">
                                    <BoltIcon className="text-yellow-500" />
                                    <h4 className="font-bold text-on-surface">Fluxo de Caixa {isPJ && '(Contas a Pagar)'}</h4>
                                </div>
                                <div className="space-y-3">
                                    <div>
                                        <label htmlFor="categoria" className={labelClass}>Classificação de Despesa</label>
                                        <select 
                                            id="categoria"
                                            value={categoriaDespesa}
                                            onChange={e => set('category', e.target.value)}
                                            className={commonInputClass}
                                        >
                                            <option value={DEFAULT_RECURRING_CATEGORY}>Padrão (Recorrentes)</option>
                                            {categories.filter(c => c.type === 'despesa' && c.name !== DEFAULT_RECURRING_CATEGORY).map(c => (
                                                <option key={c.id} value={c.name}>{c.name}</option>
                                            ))}
                                            {categoriaDespesa !== DEFAULT_RECURRING_CATEGORY && !categories.some(c => c.type === 'despesa' && c.name === categoriaDespesa) && (
                                                <option value={categoriaDespesa}>{categoriaDespesa}</option>
                                            )}
                                        </select>
                                    </div>
                                    {isPJ && (
                                        <p className="text-[10px] text-muted italic">
                                            No modo automático fora do cartão, as contas são geradas com status "Pendente" no dia do vencimento.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- TAB: VISUAL --- */}
                    {activeTab === 'visual' && (
                        <div className="space-y-6" role="tabpanel">
                            <div className="flex items-center justify-center p-10 bg-background rounded-2xl mb-4 border border-border">
                                <div 
                                    className="w-24 h-24 rounded-3xl flex items-center justify-center shadow-2xl text-white transition-all transform hover:scale-110"
                                    style={{ backgroundColor: corPrincipal }}
                                >
                                    {emojiOpcional ? <span className="text-5xl">{emojiOpcional}</span> : <DynamicIcon name={icone} size={48} />}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div>
                                    <label className={labelClass}>Paleta Sugerida</label>
                                    <div className="flex flex-wrap gap-2.5">
                                        {PRESET_COLORS.map(c => (
                                            <button
                                                key={c}
                                                type="button"
                                                onClick={() => set('color', c)}
                                                className={`w-10 h-10 rounded-xl border-2 transition-all hover:scale-110 ${corPrincipal === c ? 'border-primary ring-4 ring-primary/20 scale-110 shadow-lg' : 'border-transparent opacity-80'}`}
                                                style={{ backgroundColor: c }}
                                            />
                                        ))}
                                        <div className="relative">
                                            <input 
                                                type="color" 
                                                value={corPrincipal} 
                                                onChange={e => set('color', e.target.value)}
                                                className="w-10 h-10 p-0 border-0 rounded-xl cursor-pointer opacity-0 absolute inset-0 z-10" 
                                            />
                                            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-red-500 via-green-500 to-blue-500 border border-border flex items-center justify-center">
                                                <PaletteIcon className="w-5 h-5 text-white" />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className={labelClass}>Ícone Representativo</label>
                                        <button
                                            type="button"
                                            onClick={() => setIsIconPickerOpen(!isIconPickerOpen)}
                                            className="w-full flex items-center justify-between border border-border rounded-lg px-4 py-2.5 bg-background text-on-surface hover:border-primary transition-all"
                                        >
                                            <div className="flex items-center gap-3">
                                                <DynamicIcon name={icone} size={20} className="text-primary" />
                                                <span className="font-medium">{icone}</span>
                                            </div>
                                            <SearchIcon className="w-4 h-4 text-muted" />
                                        </button>
                                    </div>

                                    <div>
                                        <label className={labelClass}>Emoji de Identificação</label>
                                        <input 
                                            type="text" 
                                            value={emojiOpcional} 
                                            onChange={(e) => set('emoji', e.target.value)}
                                            placeholder="Ex: ☁️, 🏢, ⚡"
                                            className={`${commonInputClass} text-center text-xl py-3`}
                                            maxLength={2}
                                        />
                                    </div>
                                </div>
                            </div>

                            {isIconPickerOpen && (
                                <div className="border border-border rounded-xl p-4 bg-background animate-fade-in shadow-inner">
                                    <div className="relative mb-4">
                                        <input 
                                            type="text" 
                                            placeholder="Buscar ícones (ex: cloud, server, building)..." 
                                            value={iconSearch}
                                            onChange={e => {
                                                setIconSearch(e.target.value);
                                                setVisibleIconCount(60);
                                            }}
                                            className={`${commonInputClass} pl-10`}
                                            autoFocus
                                        />
                                        <SearchIcon className="absolute left-3 top-2.5 w-5 h-5 text-muted" />
                                    </div>
                                    <div className="grid grid-cols-6 sm:grid-cols-10 gap-2 max-h-[200px] overflow-y-auto custom-scrollbar p-1">
                                        {filteredIcons.slice(0, visibleIconCount).map((iconKey) => {
                                            const isSelected = icone === iconKey;
                                            return (
                                                <button
                                                    key={iconKey}
                                                    type="button"
                                                    onClick={() => {
                                                        set('icon', iconKey);
                                                        setIsIconPickerOpen(false);
                                                    }}
                                                    className={`aspect-square rounded-lg flex items-center justify-center border transition-all hover:bg-surface hover:shadow-md ${
                                                        isSelected 
                                                            ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/20' 
                                                            : 'border-transparent text-muted hover:border-border'
                                                    }`}
                                                    title={iconKey}
                                                >
                                                    <DynamicIcon name={iconKey} size={24} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                </form>

                {/* Footer */}
                <div className="p-6 border-t border-border flex justify-end gap-3 bg-gray-50 dark:bg-dark-300 rounded-b-xl">
                    <button type="button" onClick={onClose} disabled={busy} className="px-5 py-2.5 bg-background text-on-surface border border-border rounded-lg hover:bg-background/80 transition-colors font-medium">
                        Cancelar
                    </button>
                    <button type="submit" form="recurringForm" disabled={busy} className="px-8 py-2.5 bg-primary text-white font-bold rounded-lg hover:bg-primary/90 transition-all shadow-md active:scale-95 disabled:opacity-60">
                        {busy ? 'Salvando…' : expenseToEdit ? 'Salvar Alterações' : isPJ ? 'Cadastrar Contrato' : 'Cadastrar Assinatura'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RecurringExpenseFormModal;
