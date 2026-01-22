
import React, { useState, useEffect } from 'react';
import { CreditCard } from '../types.ts';
import { CloseIcon, UsersIcon, BriefcaseIcon, BoltIcon, CreditCardIcon } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface CreditCardFormProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (card: CreditCard) => void;
    cardToEdit?: CreditCard | null;
}

const CreditCardForm: React.FC<CreditCardFormProps> = ({ isOpen, onClose, onSave, cardToEdit }) => {
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';
    
    const [activeTab, setActiveTab] = useState<'financial' | 'visual'>('financial');
    
    // Financial State
    const [name, setName] = useState('');
    const [brand, setBrand] = useState('Visa');
    const [limitTotal, setLimitTotal] = useState('');
    const [closingDay, setClosingDay] = useState('1');
    const [dueDay, setDueDay] = useState('10');
    const [bestDay, setBestDay] = useState('');
    const [status, setStatus] = useState<'active' | 'blocked' | 'cancelled'>('active');
    const [observations, setObservations] = useState('');

    // PJ Specific State
    const [responsiblePerson, setResponsiblePerson] = useState('');
    const [recommendedUse, setRecommendedUse] = useState('');
    const [defaultCostCenter, setDefaultCostCenter] = useState('');

    // Visual State
    const [bgType, setBgType] = useState<'color' | 'gradient' | 'image'>('color');
    const [bgColor, setBgColor] = useState('#1e293b');
    const [bgGradientColor, setBgGradientColor] = useState('#3b82f6');
    const [bgImage, setBgImage] = useState('');
    const [textColor, setTextColor] = useState<'white' | 'black'>('white');
    const [showName, setShowName] = useState(true);
    const [showBrand, setShowBrand] = useState(true);
    const [showLogo, setShowLogo] = useState(true);

    useEffect(() => {
        if (isOpen) {
            if (cardToEdit) {
                setName(cardToEdit.name);
                setBrand(cardToEdit.brand);
                setLimitTotal(String(cardToEdit.limitTotal));
                setClosingDay(String(cardToEdit.closingDay));
                setDueDay(String(cardToEdit.dueDay));
                setBestDay(cardToEdit.bestDay ? String(cardToEdit.bestDay) : '');
                setStatus(cardToEdit.status);
                setObservations(cardToEdit.observations || '');
                setResponsiblePerson(cardToEdit.responsiblePerson || '');
                setRecommendedUse(cardToEdit.recommendedUse || '');
                setDefaultCostCenter(cardToEdit.defaultCostCenter || '');
                setBgType(cardToEdit.visual.bgType);
                setBgColor(cardToEdit.visual.bgColor);
                setBgGradientColor(cardToEdit.visual.bgGradientColor || '#3b82f6');
                setBgImage(cardToEdit.visual.bgImage || '');
                setTextColor(cardToEdit.visual.textColor);
                setShowName(cardToEdit.visual.showName);
                setShowBrand(cardToEdit.visual.showBrand);
                setShowLogo(cardToEdit.visual.showLogo);
            } else {
                setName('');
                setBrand('Visa');
                setLimitTotal('');
                setClosingDay('1');
                setDueDay('10');
                setBestDay('');
                setStatus('active');
                setObservations('');
                setResponsiblePerson('');
                setRecommendedUse('');
                setDefaultCostCenter('');
                setBgType('color');
                setBgColor(isPJ ? '#0f766e' : '#1e293b');
                setBgGradientColor('#3b82f6');
                setBgImage('');
                setTextColor('white');
                setShowName(true);
                setShowBrand(true);
                setShowLogo(true);
            }
            setActiveTab('financial');
        }
    }, [isOpen, cardToEdit, isPJ]);

    if (!isOpen) return null;

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        const newCard: CreditCard = {
            id: cardToEdit ? cardToEdit.id : Date.now(),
            name,
            brand,
            limitTotal: parseFloat(limitTotal),
            closingDay: parseInt(closingDay),
            dueDay: parseInt(dueDay),
            bestDay: bestDay ? parseInt(bestDay) : undefined,
            status,
            observations,
            responsiblePerson: isPJ ? responsiblePerson : undefined,
            recommendedUse: isPJ ? recommendedUse : undefined,
            defaultCostCenter: isPJ ? defaultCostCenter : undefined,
            visual: {
                bgType,
                bgColor,
                bgGradientColor: bgType === 'gradient' ? bgGradientColor : undefined,
                bgImage: bgType === 'image' ? bgImage : undefined,
                textColor,
                showName,
                showBrand,
                showLogo
            }
        };
        onSave(newCard);
    };

    const previewStyle = () => {
        if (bgType === 'image' && bgImage) return { backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' };
        if (bgType === 'gradient') return { background: `linear-gradient(135deg, ${bgColor}, ${bgGradientColor})` };
        return { backgroundColor: bgColor };
    };

    const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2.5 bg-white text-gray-900 dark:bg-dark-200 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-gray-400 text-sm";
    const labelClass = "block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5";

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-dark-100 rounded-2xl shadow-2xl w-full max-w-2xl animate-scale-in max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex justify-between items-center px-6 py-5 border-b border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg">
                            <CreditCardIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-800 dark:text-white">
                            {cardToEdit ? 'Editar Cartão' : isPJ ? 'Novo Cartão Corporativo' : 'Novo Cartão'}
                        </h3>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                        <CloseIcon />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-dark-200/50">
                    <button 
                        onClick={() => setActiveTab('financial')}
                        className={`flex-1 py-4 text-sm font-bold uppercase tracking-widest transition-all ${activeTab === 'financial' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white dark:bg-dark-100' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                    >
                        Dados Financeiros
                    </button>
                    <button 
                        onClick={() => setActiveTab('visual')}
                        className={`flex-1 py-4 text-sm font-bold uppercase tracking-widest transition-all ${activeTab === 'visual' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white dark:bg-dark-100' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                    >
                        Estilo Visual
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    <form id="cardForm" onSubmit={handleSave} className="space-y-8">
                        {activeTab === 'financial' ? (
                            <div className="space-y-6">
                                {/* Primeira Linha: Identificação */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div>
                                        <label className={labelClass}>Apelido do Cartão</label>
                                        <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputClass} placeholder="Ex: Nubank Empresarial" required />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Bandeira</label>
                                        <select value={brand} onChange={e => setBrand(e.target.value)} className={inputClass}>
                                            <option value="Visa">Visa</option>
                                            <option value="Mastercard">Mastercard</option>
                                            <option value="Elo">Elo</option>
                                            <option value="Amex">Amex</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Bloco Corporativo PJ */}
                                {isPJ && (
                                    <div className="bg-indigo-50/30 dark:bg-indigo-900/10 p-5 rounded-2xl border border-indigo-100/50 dark:border-indigo-900/30 space-y-5">
                                        <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400 font-bold text-xs uppercase tracking-widest border-b border-indigo-100 dark:border-indigo-900/30 pb-2 mb-1">
                                            <BriefcaseIcon className="w-4 h-4" /> Uso da Empresa
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                            <div>
                                                <label className="block text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider mb-1.5">Responsável pelo Cartão</label>
                                                <div className="relative">
                                                    <input type="text" value={responsiblePerson} onChange={e => setResponsiblePerson(e.target.value)} className={`${inputClass} pl-10 border-indigo-100 dark:border-indigo-900/40`} placeholder="Nome do colaborador" />
                                                    <UsersIcon className="absolute left-3.5 top-3 w-4 h-4 text-indigo-300" />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider mb-1.5">Centro de Custo Padrão</label>
                                                <input type="text" value={defaultCostCenter} onChange={e => setDefaultCostCenter(e.target.value)} className={`${inputClass} border-indigo-100 dark:border-indigo-900/40`} placeholder="Ex: Marketing, TI..." />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider mb-1.5">Uso Recomendado / Regras</label>
                                            <input type="text" value={recommendedUse} onChange={e => setRecommendedUse(e.target.value)} className={`${inputClass} border-indigo-100 dark:border-indigo-900/40`} placeholder="Ex: Apenas fornecedores SaaS, Viagens comerciais..." />
                                        </div>
                                    </div>
                                )}

                                {/* Limite e Gestão */}
                                <div className="space-y-4">
                                    <div>
                                        <label className={`${labelClass} flex justify-between`}>
                                            Limite Total
                                            {isPJ && <span className="text-[10px] font-normal lowercase normal-case opacity-60 italic">Limite do cartão corporativo</span>}
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-2.5 text-gray-400 font-bold">R$</span>
                                            <input type="number" value={limitTotal} onChange={e => setLimitTotal(e.target.value)} className={`${inputClass} pl-12 font-bold text-lg`} required step="0.01" placeholder="0,00" />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                        <div>
                                            <label className={labelClass}>Dia Fechamento</label>
                                            <input type="number" value={closingDay} onChange={e => setClosingDay(e.target.value)} className={inputClass} min="1" max="31" required />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Dia Vencimento</label>
                                            <input type="number" value={dueDay} onChange={e => setDueDay(e.target.value)} className={inputClass} min="1" max="31" required />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Melhor Dia</label>
                                            <input type="number" value={bestDay} onChange={e => setBestDay(e.target.value)} className={inputClass} min="1" max="31" placeholder="Automático" />
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className={labelClass}>Notas / Observações</label>
                                    <textarea value={observations} onChange={e => setObservations(e.target.value)} className={`${inputClass} resize-none`} rows={3} placeholder="Informações adicionais para gestão interna..."></textarea>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                    <div>
                                        <label className={labelClass}>Tipo de Fundo</label>
                                        <div className="flex bg-gray-100 dark:bg-dark-200 rounded-xl p-1 gap-1">
                                            {['color', 'gradient', 'image'].map((type) => (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => setBgType(type as any)}
                                                    className={`flex-1 py-2 text-xs font-bold uppercase rounded-lg transition-all ${bgType === type ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500 hover:text-gray-700'}`}
                                                >
                                                    {type === 'color' ? 'Cor' : type === 'gradient' ? 'Degradê' : 'Foto'}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div>
                                            <label className={labelClass}>Cor Principal</label>
                                            <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="h-12 w-full rounded-xl cursor-pointer p-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-200" />
                                        </div>

                                        {bgType === 'gradient' && (
                                            <div className="animate-fade-in">
                                                <label className={labelClass}>Cor de Transição</label>
                                                <input type="color" value={bgGradientColor} onChange={e => setBgGradientColor(e.target.value)} className="h-12 w-full rounded-xl cursor-pointer p-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-200" />
                                            </div>
                                        )}
                                    </div>

                                    <div className="p-4 bg-gray-50 dark:bg-dark-200 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-3">
                                        <label className="flex items-center gap-3 cursor-pointer group">
                                            <input type="checkbox" checked={showName} onChange={e => setShowName(e.target.checked)} className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-indigo-600 transition-colors">Exibir Nome do Cartão</span>
                                        </label>
                                        <label className="flex items-center gap-3 cursor-pointer group">
                                            <input type="checkbox" checked={showBrand} onChange={e => setShowBrand(e.target.checked)} className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-indigo-600 transition-colors">Exibir Bandeira</span>
                                        </label>
                                    </div>
                                </div>

                                <div className="flex flex-col items-center justify-center pt-4">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-4 tracking-widest">Prévia do Cartão</p>
                                    <div 
                                        className="w-full max-w-[320px] aspect-[1.586] rounded-2xl shadow-2xl p-7 relative flex flex-col justify-between overflow-hidden transition-all duration-500 ring-4 ring-black/5"
                                        style={previewStyle()}
                                    >
                                        <div className="flex justify-between items-start z-10">
                                            {showName && <span className={`font-bold tracking-tight text-lg drop-shadow-sm ${textColor === 'white' ? 'text-white' : 'text-gray-900'}`}>{name || 'Cartão Corporativo'}</span>}
                                            <div className="w-10 h-8 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-md border border-white/20 shadow-inner"></div>
                                        </div>
                                        <div className="z-10">
                                            <div className={`text-2xl font-mono tracking-[0.2em] ${textColor === 'white' ? 'text-white' : 'text-gray-900'} opacity-80 mb-3 drop-shadow-sm`}>**** 1234</div>
                                            <div className="flex justify-between items-end">
                                                <div className="flex flex-col">
                                                    <span className={`text-[8px] uppercase tracking-tighter opacity-50 ${textColor === 'white' ? 'text-white' : 'text-gray-900'}`}>Card Holder</span>
                                                    <span className={`text-xs font-bold uppercase tracking-wider ${textColor === 'white' ? 'text-white' : 'text-gray-900'}`}>{responsiblePerson || 'USUÁRIO DA EMPRESA'}</span>
                                                </div>
                                                {showBrand && <span className={`font-black italic text-xl ${textColor === 'white' ? 'text-white' : 'text-gray-900'}`}>{brand}</span>}
                                            </div>
                                        </div>
                                        {/* Gloss effect */}
                                        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/10 to-transparent pointer-events-none"></div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </form>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3 bg-gray-50/50 dark:bg-dark-200/50">
                    <button onClick={onClose} className="px-6 py-2.5 bg-white dark:bg-dark-200 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-300 transition-all font-bold text-sm shadow-sm">
                        Cancelar
                    </button>
                    <button type="submit" form="cardForm" className="px-10 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all shadow-lg shadow-indigo-200 dark:shadow-none font-bold text-sm active:scale-95">
                        Salvar Cartão
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreditCardForm;
