
import React, { useState, useEffect, useMemo } from 'react';
import { RecurringExpense, RecurringExpenseType, RecurringBillingPeriod, RecurringPaymentMethod, BusinessContractType } from '../modules/recurring-expenses/types.ts';
import { CreditCard, EntityItem } from '../types.ts';
import { useSplitGroups } from '../modules/split-bills/hooks.ts';
import { CloseIcon, SearchIcon, DynamicIcon, CreditCardIcon, UsersIcon, BoltIcon, PaletteIcon, getAllTablerIconKeys, BuildingIcon, BriefcaseIcon } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface RecurringExpenseFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (expense: RecurringExpense) => void;
    expenseToEdit?: RecurringExpense | null;
    creditCards: CreditCard[];
    categories: EntityItem[]; // Expense Categories
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

const CONTRACT_TYPES: BusinessContractType[] = [
    'SaaS', 'Aluguel', 'Internet', 'Energia', 'Água', 'Contabilidade', 'Impostos', 'Serviços', 'Outro'
];

const RecurringExpenseFormModal: React.FC<RecurringExpenseFormModalProps> = ({ 
    isOpen, onClose, onSave, expenseToEdit, creditCards, categories 
}) => {
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';

    // --- STATE ---
    // General
    const [nome, setNome] = useState('');
    const [tipo, setTipo] = useState<RecurringExpenseType>('assinatura');
    const [descricao, setDescricao] = useState('');
    
    // PJ Specific
    const [fornecedor, setFornecedor] = useState('');
    const [tipoEmpresa, setTipoEmpresa] = useState<BusinessContractType>('SaaS');
    const [centroCusto, setCentroCusto] = useState('');
    const [responsavel, setResponsavel] = useState('');
    const [dataReajuste, setDataReajuste] = useState('');
    const [fidelidade, setFidelidade] = useState('');
    const [anexoNome, setAnexoNome] = useState('');

    // Values & Period
    const [valorPadrao, setValorPadrao] = useState('');
    const [periodo, setPeriodo] = useState<RecurringBillingPeriod>('mensal');
    const [diaCobranca, setDiaCobranca] = useState<number>(new Date().getDate());
    const [dataInicio, setDataInicio] = useState(new Date().toISOString().split('T')[0]);
    const [dataFim, setDataFim] = useState('');

    // Payment
    const [metodoPagamento, setMetodoPagamento] = useState<RecurringPaymentMethod>('cartaoCredito');
    const [cartaoIdOpcional, setCartaoIdOpcional] = useState('');
    const [usarCartaoAutomaticamente, setUsarCartaoAutomaticamente] = useState(true);

    // Integrations
    const [gerarDespesaAutomaticamente, setGerarDespesaAutomaticamente] = useState(true);
    const [categoriaDespesaId, setCategoriaDespesaId] = useState('');
    
    const [splitGroupIdOpcional, setSplitGroupIdOpcional] = useState('');
    const [dividirAutomaticamenteNoGrupo, setDividirAutomaticamenteNoGrupo] = useState(false);

    // Visual
    const [corPrincipal, setCorPrincipal] = useState(isPJ ? '#0f766e' : PRESET_COLORS[0]);
    const [icone, setIcone] = useState(isPJ ? 'FileInvoice' : 'Bolt');
    const [emojiOpcional, setEmojiOpcional] = useState('');

    // UI State
    const [activeTab, setActiveTab] = useState<'geral' | 'pagamento' | 'integracoes' | 'visual'>('geral');
    const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
    const [iconSearch, setIconSearch] = useState('');
    const [visibleIconCount, setVisibleIconCount] = useState(60);

    // Data Hooks
    const { data: splitGroups } = useSplitGroups();

    // --- INITIALIZATION ---
    useEffect(() => {
        if (isOpen) {
            if (expenseToEdit) {
                setNome(expenseToEdit.nome);
                setTipo(expenseToEdit.tipo);
                setDescricao(expenseToEdit.descricao || '');
                setValorPadrao(String(expenseToEdit.valorPadrao));
                setPeriodo(expenseToEdit.periodo);
                setDiaCobranca(expenseToEdit.diaCobranca);
                setDataInicio(expenseToEdit.dataInicio);
                setDataFim(expenseToEdit.dataFim || '');
                
                setMetodoPagamento(expenseToEdit.metodoPagamento);
                setCartaoIdOpcional(expenseToEdit.cartaoIdOpcional || '');
                setUsarCartaoAutomaticamente(expenseToEdit.usarCartaoAutomaticamente ?? true);
                
                setGerarDespesaAutomaticamente(expenseToEdit.gerarDespesaAutomaticamente ?? true);
                setCategoriaDespesaId(expenseToEdit.categoriaDespesaId || '');
                
                setSplitGroupIdOpcional(expenseToEdit.splitGroupIdOpcional || '');
                setDividirAutomaticamenteNoGrupo(expenseToEdit.dividirAutomaticamenteNoGrupo ?? false);
                
                setCorPrincipal(expenseToEdit.corPrincipal);
                setIcone(expenseToEdit.icone);
                setEmojiOpcional(expenseToEdit.emojiOpcional || '');

                // PJ Fields
                setFornecedor(expenseToEdit.fornecedor || '');
                setTipoEmpresa(expenseToEdit.tipoEmpresa || 'SaaS');
                setCentroCusto(expenseToEdit.centroCusto || '');
                setResponsavel(expenseToEdit.responsavel || '');
                setDataReajuste(expenseToEdit.dataReajuste || '');
                setFidelidade(expenseToEdit.fidelidade || '');
                setAnexoNome(expenseToEdit.anexoNome || '');
            } else {
                // Reset
                setNome('');
                setTipo('assinatura');
                setDescricao('');
                setValorPadrao('');
                setPeriodo('mensal');
                setDiaCobranca(new Date().getDate());
                setDataInicio(new Date().toISOString().split('T')[0]);
                setDataFim('');
                setMetodoPagamento(isPJ ? 'boleto' : 'cartaoCredito');
                setCartaoIdOpcional('');
                setUsarCartaoAutomaticamente(true);
                setGerarDespesaAutomaticamente(true);
                setCategoriaDespesaId('');
                setSplitGroupIdOpcional('');
                setDividirAutomaticamenteNoGrupo(false);
                setCorPrincipal(isPJ ? '#0f766e' : PRESET_COLORS[0]);
                setIcone(isPJ ? 'FileInvoice' : 'Bolt');
                setEmojiOpcional('');
                setFornecedor('');
                setTipoEmpresa('SaaS');
                setCentroCusto('');
                setResponsavel('');
                setDataReajuste('');
                setFidelidade('');
                setAnexoNome('');
            }
            setActiveTab('geral');
            setIsIconPickerOpen(false);
        }
    }, [isOpen, expenseToEdit, isPJ]);

    // --- ICON PICKER LOGIC ---
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

    // --- HANDLERS ---
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!nome) return alert('Nome é obrigatório');
        if (!valorPadrao || parseFloat(valorPadrao) <= 0) return alert('Valor deve ser maior que zero');
        
        const newExpense: RecurringExpense = {
            id: expenseToEdit ? expenseToEdit.id : Date.now().toString(),
            nome,
            tipo,
            descricao,
            valorPadrao: parseFloat(valorPadrao),
            moeda: 'BRL',
            periodo,
            diaCobranca,
            dataInicio,
            dataFim: dataFim || undefined,
            metodoPagamento,
            cartaoIdOpcional: metodoPagamento === 'cartaoCredito' ? cartaoIdOpcional : undefined,
            usarCartaoAutomaticamente: metodoPagamento === 'cartaoCredito' ? usarCartaoAutomaticamente : false,
            gerarDespesaAutomaticamente,
            categoriaDespesaId: categoriaDespesaId || undefined,
            splitGroupIdOpcional: splitGroupIdOpcional || undefined,
            dividirAutomaticamenteNoGrupo: splitGroupIdOpcional ? dividirAutomaticamenteNoGrupo : false,
            corPrincipal,
            icone,
            emojiOpcional: emojiOpcional || undefined,
            status: expenseToEdit ? expenseToEdit.status : 'ativo',
            createdAt: expenseToEdit ? expenseToEdit.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            // PJ Fields
            fornecedor: isPJ ? fornecedor : undefined,
            tipoEmpresa: isPJ ? tipoEmpresa : undefined,
            centroCusto: isPJ ? centroCusto : undefined,
            responsavel: isPJ ? responsavel : undefined,
            dataReajuste: isPJ ? dataReajuste : undefined,
            fidelidade: isPJ ? fidelidade : undefined,
            anexoNome: isPJ ? anexoNome : undefined
        };

        onSave(newExpense);
        onClose();
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
                    <button onClick={onClose} className="text-muted hover:text-on-surface" aria-label="Fechar">
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
                    
                    {/* --- TAB: GERAL --- */}
                    {activeTab === 'geral' && (
                        <div className="space-y-6" role="tabpanel">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div className="md:col-span-2">
                                    <label htmlFor="nome" className={labelClass}>Nome do Contrato / Serviço <span className="text-error">*</span></label>
                                    <input id="nome" type="text" value={nome} onChange={e => setNome(e.target.value)} className={commonInputClass} placeholder="Ex: AWS Cloud, Aluguel Escritório..." required autoFocus />
                                </div>
                                
                                {isPJ && (
                                    <>
                                        <div>
                                            <label htmlFor="fornecedor" className={labelClass}>Fornecedor</label>
                                            <div className="relative">
                                                <input id="fornecedor" type="text" value={fornecedor} onChange={e => setFornecedor(e.target.value)} className={`${commonInputClass} pl-9`} placeholder="Ex: Amazon, Imobiliária X..." />
                                                <BuildingIcon className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
                                            </div>
                                        </div>
                                        <div>
                                            <label htmlFor="tipoEmpresa" className={labelClass}>Tipo de Despesa</label>
                                            <select id="tipoEmpresa" value={tipoEmpresa} onChange={e => setTipoEmpresa(e.target.value as any)} className={commonInputClass}>
                                                {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor="centroCusto" className={labelClass}>Centro de Custo / Projeto</label>
                                            <div className="relative">
                                                <input id="centroCusto" type="text" value={centroCusto} onChange={e => setCentroCusto(e.target.value)} className={`${commonInputClass} pl-9`} placeholder="Ex: Marketing, Operação SP..." />
                                                <BriefcaseIcon className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
                                            </div>
                                        </div>
                                        <div>
                                            <label htmlFor="responsavel" className={labelClass}>Responsável Interno</label>
                                            <input id="responsavel" type="text" value={responsavel} onChange={e => setResponsavel(e.target.value)} className={commonInputClass} placeholder="Nome do colaborador" />
                                        </div>
                                    </>
                                )}

                                {!isPJ && (
                                    <div>
                                        <label htmlFor="tipo" className={labelClass}>Tipo de Recorrência</label>
                                        <select id="tipo" value={tipo} onChange={e => setTipo(e.target.value as any)} className={commonInputClass}>
                                            <option value="assinatura">Assinatura (Stream, Apps)</option>
                                            <option value="contaFixa">Conta Fixa (Luz, Net)</option>
                                            <option value="servico">Serviço (Academia)</option>
                                            <option value="outro">Outro</option>
                                        </select>
                                    </div>
                                )}

                                <div>
                                    <label htmlFor="valor" className={labelClass}>Valor Previsto <span className="text-error">*</span></label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-2 text-sm text-muted font-bold">R$</span>
                                        <input id="valor" type="number" step="0.01" value={valorPadrao} onChange={e => setValorPadrao(e.target.value)} className={`${commonInputClass} pl-9 font-bold`} required placeholder="0.00" />
                                    </div>
                                </div>
                                
                                <div>
                                    <label htmlFor="periodo" className={labelClass}>Frequência</label>
                                    <select id="periodo" value={periodo} onChange={e => setPeriodo(e.target.value as any)} className={commonInputClass}>
                                        <option value="mensal">Mensal</option>
                                        <option value="anual">Anual</option>
                                        <option value="semanal">Semanal</option>
                                        <option value="trimestral">Trimestral</option>
                                        <option value="semestral">Semestral</option>
                                    </select>
                                </div>

                                <div>
                                    <label htmlFor="diaCobranca" className={labelClass}>Dia do Vencimento</label>
                                    <input id="diaCobranca" type="number" min="1" max="31" value={diaCobranca} onChange={e => setDiaCobranca(parseInt(e.target.value))} className={commonInputClass} />
                                </div>

                                <div>
                                    <label htmlFor="dataInicio" className={labelClass}>Início do Contrato</label>
                                    <input id="dataInicio" type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className={commonInputClass} required />
                                </div>

                                {isPJ && (
                                    <>
                                        <div>
                                            <label htmlFor="dataReajuste" className={labelClass}>Próximo Reajuste</label>
                                            <input id="dataReajuste" type="date" value={dataReajuste} onChange={e => setDataReajuste(e.target.value)} className={commonInputClass} />
                                        </div>
                                        <div>
                                            <label htmlFor="fidelidade" className={labelClass}>Renovação / Fidelidade</label>
                                            <input id="fidelidade" type="text" value={fidelidade} onChange={e => setFidelidade(e.target.value)} className={commonInputClass} placeholder="Ex: 12 meses, renovação automática..." />
                                        </div>
                                    </>
                                )}

                                <div>
                                    <label htmlFor="dataFim" className={labelClass}>Término do Contrato</label>
                                    <input id="dataFim" type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} className={commonInputClass} />
                                </div>
                            </div>

                            {isPJ && (
                                <div className="bg-background p-4 rounded-xl border border-dashed border-border">
                                    <label className={labelClass}>Anexo do Contrato (Digital)</label>
                                    <div className="flex items-center gap-3">
                                        <button type="button" className="px-4 py-2 bg-surface border border-border rounded-lg text-xs font-medium hover:bg-background transition-colors flex items-center gap-2">
                                            <DynamicIcon name="Paperclip" size={14} /> Selecionar Arquivo
                                        </button>
                                        <span className="text-xs text-muted italic">{anexoNome || 'Nenhum arquivo anexado'}</span>
                                    </div>
                                </div>
                            )}

                            <div>
                                <label htmlFor="descricao" className={labelClass}>Notas Adicionais</label>
                                <textarea id="descricao" value={descricao} onChange={e => setDescricao(e.target.value)} className={commonInputClass} rows={2} placeholder="Detalhes importantes do contrato..." />
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
                                        { id: 'cartaoCredito', label: isPJ ? 'Cartão Corp.' : 'Cartão Crédito', icon: 'CreditCard' },
                                        { id: 'boleto', label: 'Boleto', icon: 'Barcode' },
                                        { id: 'pix', label: 'Pix / Transf.', icon: 'BrandPix' },
                                        { id: 'debitoConta', label: 'Débito Auto.', icon: 'BuildingBank' },
                                    ].map(m => (
                                        <button
                                            key={m.id}
                                            type="button"
                                            onClick={() => setMetodoPagamento(m.id as any)}
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

                            {metodoPagamento === 'cartaoCredito' && (
                                <div className="bg-background p-5 rounded-2xl border border-border animate-fade-in space-y-4">
                                    <div>
                                        <label htmlFor="cartao" className={labelClass}>{isPJ ? 'Cartão Corporativo Responsável' : 'Selecione o Cartão'}</label>
                                        <select 
                                            id="cartao"
                                            value={cartaoIdOpcional} 
                                            onChange={e => setCartaoIdOpcional(e.target.value)} 
                                            className={commonInputClass}
                                        >
                                            <option value="">-- Selecione o cartão --</option>
                                            {creditCards.map(c => (
                                                <option key={c.id} value={c.id}>{c.name} ({c.brand})</option>
                                            ))}
                                        </select>
                                    </div>
                                    
                                    <div className="flex items-start gap-3 p-3 bg-surface rounded-lg">
                                        <input 
                                            id="auto-card" 
                                            type="checkbox" 
                                            checked={usarCartaoAutomaticamente} 
                                            onChange={e => setUsarCartaoAutomaticamente(e.target.checked)}
                                            className="mt-1 w-4 h-4 text-primary border-border rounded focus:ring-primary"
                                        />
                                        <div>
                                            <label htmlFor="auto-card" className="text-sm font-bold text-on-surface">Lançar fatura automaticamente</label>
                                            <p className="text-muted text-xs">O sistema provisionará a compra no cartão na data do vencimento.</p>
                                        </div>
                                    </div>
                                </div>
                            )}
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
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <input 
                                            id="gen-expense" 
                                            type="checkbox" 
                                            checked={gerarDespesaAutomaticamente} 
                                            onChange={e => setGerarDespesaAutomaticamente(e.target.checked)}
                                            className="w-4 h-4 text-primary rounded focus:ring-primary"
                                        />
                                        <label htmlFor="gen-expense" className="text-sm font-bold text-on-surface">
                                            {isPJ ? 'Provisionar em Contas a Pagar' : 'Gerar despesa no fluxo de caixa'}
                                        </label>
                                    </div>
                                    
                                    {gerarDespesaAutomaticamente && (
                                        <div className="animate-fade-in pl-7 space-y-3">
                                            <div>
                                                <label htmlFor="categoria" className={labelClass}>Classificação de Despesa</label>
                                                <select 
                                                    id="categoria"
                                                    value={categoriaDespesaId} 
                                                    onChange={e => setCategoriaDespesaId(e.target.value)} 
                                                    className={commonInputClass}
                                                >
                                                    <option value="">Padrão (Recorrentes)</option>
                                                    {categories.filter(c => c.type === 'despesa').map(c => (
                                                        <option key={c.id} value={c.id}>{c.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            {isPJ && (
                                                <p className="text-[10px] text-muted italic">
                                                    As contas serão geradas com status "Pendente" no dia do vencimento.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Divisão */}
                            <div className="bg-surface border border-border rounded-xl p-5 shadow-sm">
                                <div className="flex items-center gap-2 mb-4 border-b border-border pb-3">
                                    <UsersIcon className="text-blue-500" />
                                    <h4 className="font-bold text-on-surface">{isPJ ? 'Rateio entre Sócios / Projetos' : 'Divisão de Contas'}</h4>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <label htmlFor="splitGroup" className={labelClass}>{isPJ ? 'Vincular a Grupo de Rateio' : 'Vincular a Grupo'}</label>
                                        <select 
                                            id="splitGroup"
                                            value={splitGroupIdOpcional} 
                                            onChange={e => setSplitGroupIdOpcional(e.target.value)} 
                                            className={commonInputClass}
                                        >
                                            <option value="">-- Nenhum grupo --</option>
                                            {splitGroups?.map(g => (
                                                <option key={g.id} value={g.id}>{g.nome}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {splitGroupIdOpcional && (
                                        <div className="flex items-start gap-3 animate-fade-in bg-blue-50 dark:bg-blue-900/10 p-3 rounded-lg border border-blue-100 dark:border-blue-900/30">
                                            <input 
                                                id="auto-split" 
                                                type="checkbox" 
                                                checked={dividirAutomaticamenteNoGrupo} 
                                                onChange={e => setDividirAutomaticamenteNoGrupo(e.target.checked)}
                                                className="mt-1 w-4 h-4 text-primary rounded focus:ring-primary"
                                            />
                                            <div>
                                                <label htmlFor="auto-split" className="text-sm font-bold text-blue-800 dark:text-blue-300">Rateio Automático</label>
                                                <p className="text-blue-600 dark:text-blue-400 text-[10px]">O valor será dividido entre os participantes do grupo assim que a conta for provisionada.</p>
                                            </div>
                                        </div>
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
                                                onClick={() => setCorPrincipal(c)}
                                                className={`w-10 h-10 rounded-xl border-2 transition-all hover:scale-110 ${corPrincipal === c ? 'border-primary ring-4 ring-primary/20 scale-110 shadow-lg' : 'border-transparent opacity-80'}`}
                                                style={{ backgroundColor: c }}
                                            />
                                        ))}
                                        <div className="relative">
                                            <input 
                                                type="color" 
                                                value={corPrincipal} 
                                                onChange={e => setCorPrincipal(e.target.value)} 
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
                                            onChange={(e) => setEmojiOpcional(e.target.value)} 
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
                                                        setIcone(iconKey);
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
                    <button onClick={onClose} className="px-5 py-2.5 bg-background text-on-surface border border-border rounded-lg hover:bg-background/80 transition-colors font-medium">
                        Cancelar
                    </button>
                    <button onClick={handleSubmit} className="px-8 py-2.5 bg-primary text-white font-bold rounded-lg hover:bg-primary/90 transition-all shadow-md active:scale-95">
                        {expenseToEdit ? 'Salvar Alterações' : isPJ ? 'Cadastrar Contrato' : 'Cadastrar Assinatura'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RecurringExpenseFormModal;
