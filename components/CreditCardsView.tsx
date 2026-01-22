
import React, { useState, useMemo } from 'react';
import { CreditCard, Transaction } from '../types.ts';
import CreditCard3D from './CreditCard3D.tsx';
import CreditCardForm from './CreditCardForm.tsx';
import { PlusIcon, SearchIcon, EditIcon, DeleteIcon, CloseIcon, LayoutGridIcon, ListIcon, ChartBarIcon, UsersIcon, BuildingIcon } from './Icons.tsx';
import { useWorkspace } from '../WorkspaceContext.tsx';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip } from 'recharts';

interface CreditCardsViewProps {
    cards: CreditCard[];
    transactions: Transaction[];
    onAddCard: (card: CreditCard) => void;
    onUpdateCard: (card: CreditCard) => void;
    onDeleteCard: (cardId: number) => void;
}

const CreditCardsView: React.FC<CreditCardsViewProps> = ({ cards, transactions, onAddCard, onUpdateCard, onDeleteCard }) => {
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [cardToEdit, setCardToEdit] = useState<CreditCard | null>(null);
    const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
    
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';

    // Filter cards
    const filteredCards = useMemo(() => {
        return cards.filter(card => 
            card.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
            card.brand.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [cards, searchQuery]);

    const getCardLimits = (card: CreditCard) => {
        const usedLimit = transactions
            .filter(t => (t.type === 'despesa' || t.type === 'parcelado') && t.cardId === card.id)
            .reduce((sum, t) => sum + t.value, 0);

        return {
            used: usedLimit,
            available: card.limitTotal - usedLimit
        };
    };

    // --- PJ REPORTS LOGIC ---
    const cardReport = useMemo(() => {
        if (!selectedCardId || !isPJ) return null;
        
        const cardTransactions = transactions.filter(t => t.cardId === selectedCardId);
        
        const byCategory: Record<string, number> = {};
        const bySupplier: Record<string, number> = {};
        
        cardTransactions.forEach(t => {
            const cat = t.category || 'Outros';
            const sup = t.supplier || 'N/A';
            byCategory[cat] = (byCategory[cat] || 0) + t.value;
            if (t.supplier) bySupplier[sup] = (bySupplier[sup] || 0) + t.value;
        });

        const categoryData = Object.entries(byCategory).map(([name, value]) => ({ name, value }));
        const topSuppliers = Object.entries(bySupplier)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5);

        return { categoryData, topSuppliers };
    }, [selectedCardId, transactions, isPJ]);

    const handleEdit = (card: CreditCard) => {
        setCardToEdit(card);
        setIsFormOpen(true);
        setSelectedCardId(null);
    };

    const handleDelete = (id: number) => {
        if (confirm('Tem certeza que deseja excluir este cartão?')) {
            onDeleteCard(id);
            setSelectedCardId(null);
        }
    };

    const handleSave = (card: CreditCard) => {
        if (cardToEdit) onUpdateCard(card);
        else onAddCard(card);
        setIsFormOpen(false);
        setCardToEdit(null);
    };

    const selectedCard = cards.find(c => c.id === selectedCardId);
    const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

    return (
        <div className="h-full flex flex-col animate-fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                        {isPJ ? 'Cartões Corporativos' : 'Meus Cartões'}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {isPJ ? 'Gerencie limites e despesas da sua frota de cartões' : 'Gerencie seus limites e faturas'}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                    <div className="relative flex-1 sm:flex-initial">
                        <input
                            type="text"
                            placeholder="Buscar..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full sm:w-48 pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-dark-200 text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                        />
                        <div className="absolute left-3 top-2.5 text-gray-400">
                            <SearchIcon className="h-4 w-4" />
                        </div>
                    </div>

                    <div className="flex bg-gray-100 dark:bg-dark-200 rounded-lg p-1">
                        <button onClick={() => setViewMode('grid')} className={`p-2 rounded-md ${viewMode === 'grid' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500'}`}><LayoutGridIcon className="h-5 w-5" /></button>
                        <button onClick={() => setViewMode('list')} className={`p-2 rounded-md ${viewMode === 'list' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500'}`}><ListIcon className="h-5 w-5" /></button>
                    </div>

                    <button onClick={() => { setCardToEdit(null); setIsFormOpen(true); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-md transition-all">
                        <PlusIcon className="mr-2 h-4 w-4" /> {isPJ ? 'Novo Cartão Corp' : 'Novo Cartão'}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className={viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-6" : "space-y-3 pb-6"}>
                    {filteredCards.map(card => (
                        <CreditCard3D key={card.id} card={card} mode={viewMode} limits={getCardLimits(card)} onClick={() => setSelectedCardId(card.id)} />
                    ))}
                </div>
            </div>

            {selectedCard && (
                <div className="fixed inset-0 z-40 bg-black/50 flex justify-end transition-opacity" onClick={() => setSelectedCardId(null)}>
                    <div className="w-full max-w-lg bg-white dark:bg-dark-100 h-full shadow-2xl p-6 overflow-y-auto animate-slide-in-right" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-gray-800 dark:text-white">Detalhes do Cartão</h3>
                            <button onClick={() => setSelectedCardId(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-dark-200 rounded-full transition-colors text-gray-500"><CloseIcon /></button>
                        </div>

                        <div className="mb-8 transform scale-90 sm:scale-100 origin-top-center">
                            <CreditCard3D card={selectedCard} mode="grid" limits={getCardLimits(selectedCard)} onClick={() => {}} />
                        </div>

                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4 bg-gray-50 dark:bg-dark-200 p-4 rounded-xl border border-gray-100">
                                <div className="col-span-2 flex items-center justify-between mb-2">
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${selectedCard.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                        {selectedCard.status === 'active' ? 'Ativo' : 'Inativo'}
                                    </span>
                                    {isPJ && selectedCard.responsiblePerson && (
                                        <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded flex items-center gap-1">
                                            <UsersIcon className="w-3 h-3" /> {selectedCard.responsiblePerson}
                                        </span>
                                    )}
                                </div>
                                <div><p className="text-[10px] text-gray-500 uppercase font-bold">Fechamento</p><p className="font-bold">Dia {selectedCard.closingDay}</p></div>
                                <div><p className="text-[10px] text-gray-500 uppercase font-bold">Vencimento</p><p className="font-bold">Dia {selectedCard.dueDay}</p></div>
                                {isPJ && (
                                    <div className="col-span-2 pt-2 border-t border-gray-200 dark:border-gray-700 mt-2">
                                        <p className="text-[10px] text-gray-500 uppercase font-bold">Uso Recomendado</p>
                                        <p className="text-sm italic">{selectedCard.recommendedUse || 'Uso geral'}</p>
                                    </div>
                                )}
                            </div>

                            {isPJ && cardReport && (
                                <div className="space-y-4">
                                    <h4 className="font-bold text-gray-800 dark:text-white flex items-center gap-2 border-b pb-2">
                                        <ChartBarIcon className="w-4 h-4 text-indigo-600" /> Relatório do Cartão
                                    </h4>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-100">
                                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Gastos por Categoria</p>
                                            <div className="h-32">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <PieChart>
                                                        <Pie data={cardReport.categoryData} innerRadius={25} outerRadius={45} paddingAngle={2} dataKey="value">
                                                            {cardReport.categoryData.map((_, index) => (
                                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                            ))}
                                                        </Pie>
                                                        <ReTooltip contentStyle={{ fontSize: '10px' }} />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                        
                                        <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-100">
                                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Maiores Fornecedores</p>
                                            <div className="space-y-2">
                                                {cardReport.topSuppliers.map((sup, i) => (
                                                    <div key={i} className="flex justify-between items-center text-xs">
                                                        <span className="truncate max-w-[80px] font-medium"><BuildingIcon className="w-2 h-2 inline mr-1" /> {sup.name}</span>
                                                        <span className="font-bold">R$ {sup.value.toFixed(0)}</span>
                                                    </div>
                                                ))}
                                                {cardReport.topSuppliers.length === 0 && <p className="text-[10px] text-gray-400 italic">Sem fornecedores listados.</p>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="pt-6 border-t border-gray-100 flex gap-3">
                                <button onClick={() => handleEdit(selectedCard)} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-md transition-all flex justify-center items-center gap-2">
                                    <EditIcon className="h-4 w-4" /> Editar
                                </button>
                                <button onClick={() => handleDelete(selectedCard.id)} className="flex-1 py-2.5 bg-white dark:bg-dark-200 border border-gray-200 text-red-600 rounded-lg font-bold hover:bg-red-50 transition-all flex justify-center items-center gap-2">
                                    <DeleteIcon className="h-4 w-4" /> Excluir
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <CreditCardForm isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} onSave={handleSave} cardToEdit={cardToEdit} />

            <style>{`
                @keyframes slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
                .animate-slide-in-right { animation: slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
            `}</style>
        </div>
    );
};

export default CreditCardsView;
