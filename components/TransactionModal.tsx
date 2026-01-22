
import React, { useState, FormEvent, useEffect, useRef } from 'react';
import { Transaction, TransactionType, CreditCard, EntityItem, TransactionModalProps, Goal } from '../types.ts';
// Added DynamicIcon to the imports below to fix the error on line 603
import { CloseIcon, TargetIcon, BriefcaseIcon, BuildingIcon, SparklesIcon, MicrophoneIcon, DynamicIcon } from './Icons.tsx';
import { useWorkspace } from '../WorkspaceContext.tsx';
import { GoogleGenAI, Type } from "@google/genai";

interface ExtendedTransactionModalProps extends TransactionModalProps {
    goals?: Goal[];
    defaultGoalId?: number | null;
}

const TransactionModal: React.FC<ExtendedTransactionModalProps> = ({ 
    isOpen, 
    onClose, 
    onAddTransaction, 
    onAddTransactions,
    onUpdateTransaction, 
    transactionToEdit, 
    defaultType, 
    currentDate,
    creditCards = [],
    productsServices = [],
    settingsCategories = [],
    wallets = [],
    expenseTypes = [],
    paymentTypes = [],
    incomeTypes = [],
    goals = [],
    defaultGoalId = null, 
    onAddProductService
}) => {
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';
    
    const isEditing = !!transactionToEdit;
    const [activeTab, setActiveTab] = useState<TransactionType>('receita');
    
    // State for form fields
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState('');
    const [value, setValue] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [installments, setInstallments] = useState('2');
    
    // New States for Expense Logic
    const [expenseType, setExpenseType] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('');
    const [isPaid, setIsPaid] = useState(true);

    // New State for Income Logic
    const [incomeType, setIncomeType] = useState('');

    // New States for Advanced Parcelado Logic
    const [selectedCardId, setSelectedCardId] = useState<string>('');
    const [valueType, setValueType] = useState<'total' | 'installment'>('total');
    const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);

    // New States for Investment Logic
    const [walletId, setWalletId] = useState('');
    const [isDeposited, setIsDeposited] = useState(true);
    const [selectedGoalId, setSelectedGoalId] = useState<string>(''); 

    // PJ Specific State
    const [supplier, setSupplier] = useState('');
    const [costCenter, setCostCenter] = useState('');

    // AI States
    const [isAILoading, setIsAILoading] = useState(false);
    const [aiStatus, setAIStatus] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const recognitionRef = useRef<any>(null);

    // Helper to get category options filtered by active tab type
    const getCategoryOptions = (type: TransactionType) => {
        return settingsCategories.filter(c => c.type === type);
    };

    useEffect(() => {
        if (!isOpen) return;

        if (isEditing) {
            setActiveTab(transactionToEdit.type);
            setDescription(transactionToEdit.description);
            setCategory(transactionToEdit.category);
            setValue(String(transactionToEdit.value));
            setDate(transactionToEdit.date);
            if (transactionToEdit.installments) setInstallments(String(transactionToEdit.installments));
            if (transactionToEdit.expenseType) setExpenseType(transactionToEdit.expenseType);
            if (transactionToEdit.paymentMethod) setPaymentMethod(transactionToEdit.paymentMethod);
            if (transactionToEdit.incomeType) setIncomeType(transactionToEdit.incomeType);
            if (transactionToEdit.isPaid !== undefined) {
                setIsPaid(transactionToEdit.isPaid);
                setIsDeposited(transactionToEdit.isPaid);
            }
            if (transactionToEdit.cardId) setSelectedCardId(String(transactionToEdit.cardId));
            if (transactionToEdit.walletId) setWalletId(String(transactionToEdit.walletId));
            if (transactionToEdit.goalId) setSelectedGoalId(String(transactionToEdit.goalId));
            else setSelectedGoalId('');
            
            // Set PJ Fields
            setSupplier(transactionToEdit.supplier || '');
            setCostCenter(transactionToEdit.costCenter || '');

        } else {
            const initialTab = defaultType || 'receita';
            setActiveTab(initialTab);
            setDescription('');
            setValue('');
            setDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString().split('T')[0]);
            setPurchaseDate(new Date().toISOString().split('T')[0]);
            setInstallments('2');
            setIsPaid(true); 
            setIsDeposited(true);
            setSupplier('');
            setCostCenter('');
            
            if (defaultGoalId) setSelectedGoalId(String(defaultGoalId));
            else setSelectedGoalId('');
            
            const catOptions = settingsCategories.filter(c => c.type === initialTab);
            setCategory(catOptions.length > 0 ? catOptions[0].name : '');
            setExpenseType(expenseTypes.length > 0 ? expenseTypes[0].name : '');
            setIncomeType(incomeTypes.length > 0 ? incomeTypes[0].name : '');
            setPaymentMethod(paymentTypes.length > 0 ? paymentTypes[0].name : '');
            setSelectedCardId(creditCards.length > 0 ? String(creditCards[0].id) : '');
            setWalletId(wallets.length > 0 ? String(wallets[0].id) : '');
            setValueType('total');
        }
    }, [isOpen, transactionToEdit, defaultType, isEditing, currentDate, creditCards, wallets, settingsCategories, expenseTypes, paymentTypes, incomeTypes, defaultGoalId]);

    const handleTabChange = (newTab: TransactionType) => {
        setActiveTab(newTab);
        const catOptions = settingsCategories.filter(c => c.type === newTab);
        setCategory(catOptions.length > 0 ? catOptions[0].name : '');
    };

    // --- AI LOGIC: Common Form Pre-filler ---
    const applyAIData = (data: any) => {
        if (!data) return;
        if (data.type && (['receita', 'despesa', 'investimento', 'parcelado'].includes(data.type))) {
            setActiveTab(data.type);
        }
        if (data.description) setDescription(data.description);
        if (data.value) setValue(String(data.value));
        if (data.date) setDate(data.date);
        if (data.purchaseDate) setPurchaseDate(data.purchaseDate);
        if (data.installments) setInstallments(String(data.installments));
        if (data.supplier) setSupplier(data.supplier);
        if (data.costCenter) setCostCenter(data.costCenter);
        if (data.category) {
            // Check if extracted category exists in options
            const options = settingsCategories.filter(c => c.type === (data.type || activeTab));
            const exists = options.find(o => o.name.toLowerCase().includes(data.category.toLowerCase()));
            if (exists) setCategory(exists.name);
        }
    };

    // --- AI LOGIC: Document Analysis ---
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsAILoading(true);
        setAIStatus("Analisando comprovante...");

        try {
            const reader = new FileReader();
            reader.onload = async () => {
                const base64Data = (reader.result as string).split(',')[1];
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
                
                const response = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: {
                        parts: [
                            { inlineData: { data: base64Data, mimeType: file.type } },
                            { text: `Extraia informações financeiras deste documento para preencher um formulário. Retorne um JSON com os campos: type (receita, despesa, investimento, parcelado), description, value (number), category (sugestão), date (YYYY-MM-DD), supplier, costCenter, installments (se parcelado).` }
                        ]
                    },
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                type: { type: Type.STRING },
                                description: { type: Type.STRING },
                                value: { type: Type.NUMBER },
                                category: { type: Type.STRING },
                                date: { type: Type.STRING },
                                supplier: { type: Type.STRING },
                                costCenter: { type: Type.STRING },
                                installments: { type: Type.INTEGER }
                            }
                        }
                    }
                });

                const result = JSON.parse(response.text || '{}');
                applyAIData(result);
                setAIStatus("Comprovante lido com sucesso!");
                setTimeout(() => setAIStatus(null), 3000);
            };
            reader.readAsDataURL(file);
        } catch (error) {
            console.error("AI Document Scan Error:", error);
            setAIStatus("Erro ao analisar documento.");
            setTimeout(() => setAIStatus(null), 3000);
        } finally {
            setIsAILoading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // --- AI LOGIC: Voice Entry ---
    const handleVoiceEntry = () => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Seu navegador não suporta reconhecimento de voz.");
            return;
        }

        if (isRecording) {
            recognitionRef.current?.stop();
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'pt-BR';
        recognition.continuous = false;
        recognition.interimResults = false;
        recognitionRef.current = recognition;

        recognition.onstart = () => {
            setIsRecording(true);
            setAIStatus("Ouvindo... Fale sobre sua transação.");
        };

        recognition.onresult = async (event: any) => {
            const transcript = event.results[0][0].transcript;
            setIsRecording(false);
            setAIStatus("Interpretando sua fala...");
            setIsAILoading(true);

            try {
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
                const response = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: transcript,
                    config: {
                        systemInstruction: `O usuário descreveu uma transação financeira em linguagem natural. Extraia os dados e retorne um JSON. Campos: type (receita, despesa, investimento, parcelado), description, value (number), date (YYYY-MM-DD), category, supplier, costCenter, installments.`,
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                type: { type: Type.STRING },
                                description: { type: Type.STRING },
                                value: { type: Type.NUMBER },
                                category: { type: Type.STRING },
                                date: { type: Type.STRING },
                                supplier: { type: Type.STRING },
                                costCenter: { type: Type.STRING },
                                installments: { type: Type.INTEGER }
                            }
                        }
                    }
                });

                const result = JSON.parse(response.text || '{}');
                applyAIData(result);
                setAIStatus("Entendido! Revise os dados preenchidos.");
                setTimeout(() => setAIStatus(null), 3000);
            } catch (error) {
                console.error("AI Voice Interpretation Error:", error);
                setAIStatus("Não consegui entender muito bem. Tente novamente.");
                setTimeout(() => setAIStatus(null), 3000);
            } finally {
                setIsAILoading(false);
            }
        };

        recognition.onerror = () => {
            setIsRecording(false);
            setAIStatus("Houve um erro no microfone.");
            setTimeout(() => setAIStatus(null), 3000);
        };

        recognition.onend = () => setIsRecording(false);

        recognition.start();
    };

    if (!isOpen) return null;

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        
        if ((activeTab === 'despesa' || activeTab === 'parcelado') && description.trim() !== '') {
            if (onAddProductService) onAddProductService(description.trim());
        }

        if (activeTab === 'parcelado' && !isEditing && onAddTransactions) {
            const card = creditCards.find(c => String(c.id) === selectedCardId);
            if (!card) {
                alert("Selecione um cartão válido.");
                return;
            }

            const totalInstallments = parseInt(installments);
            const inputVal = parseFloat(value);
            let finalTotal = valueType === 'total' ? inputVal : inputVal * totalInstallments;
            let installmentValue = valueType === 'total' ? parseFloat((inputVal / totalInstallments).toFixed(2)) : inputVal;

            const pDate = new Date(purchaseDate);
            let startMonthOffset = pDate.getDate() > card.closingDay ? 1 : 0;

            const newTransactions: Omit<Transaction, 'id'>[] = [];
            let remainder = valueType === 'total' ? parseFloat((finalTotal - (installmentValue * totalInstallments)).toFixed(2)) : 0;

            for (let i = 0; i < totalInstallments; i++) {
                const isLast = i === totalInstallments - 1;
                const currentVal = isLast ? parseFloat((installmentValue + remainder).toFixed(2)) : installmentValue;
                const dueDate = new Date(pDate.getFullYear(), pDate.getMonth() + startMonthOffset + i, card.dueDay);

                newTransactions.push({
                    type: 'parcelado',
                    description,
                    category,
                    value: currentVal,
                    date: dueDate.toISOString().split('T')[0],
                    installments: totalInstallments,
                    currentInstallment: i + 1,
                    cardId: card.id,
                    isPaid: false,
                    supplier: isPJ ? supplier : undefined,
                    costCenter: isPJ ? costCenter : undefined
                });
            }

            onAddTransactions(newTransactions);
            onClose();
            return;
        }

        const transactionData: any = {
            type: activeTab,
            description,
            category,
            value: parseFloat(value),
            date,
            supplier: isPJ ? supplier : undefined,
            costCenter: isPJ ? costCenter : undefined
        };
        
        if (activeTab === 'parcelado') {
            transactionData.installments = parseInt(installments);
            transactionData.currentInstallment = isEditing ? transactionToEdit.currentInstallment : 1;
            if(selectedCardId) transactionData.cardId = parseInt(selectedCardId);
        }

        if (activeTab === 'despesa') {
            transactionData.expenseType = expenseType;
            transactionData.paymentMethod = paymentMethod;
            transactionData.isPaid = isPaid;
        }

        if (activeTab === 'receita') transactionData.incomeType = incomeType;

        if (activeTab === 'investimento') {
            if(walletId) transactionData.walletId = parseInt(walletId);
            transactionData.isPaid = isDeposited;
            if (selectedGoalId) transactionData.goalId = parseInt(selectedGoalId);
            else transactionData.goalId = undefined;
        }
        
        if (isEditing) onUpdateTransaction({ ...transactionToEdit, ...transactionData });
        else onAddTransaction(transactionData as Omit<Transaction, 'id'>);
        
        onClose();
    };

    const tabClasses = (tabType: TransactionType) => {
        const base = "tab-button flex-1 py-3 px-2 font-medium text-center focus:outline-none transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed";
        if (activeTab === tabType) {
            switch(tabType) {
                case 'receita': return `${base} text-green-600 dark:text-green-400 border-b-2 border-green-600 dark:border-green-400`;
                case 'despesa': return `${base} text-red-600 dark:text-red-400 border-b-2 border-red-600 dark:border-red-400`;
                case 'investimento': return `${base} text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400`;
                case 'parcelado': return `${base} text-purple-600 dark:text-purple-400 border-b-2 border-purple-600 dark:border-purple-400`;
            }
        }
        return `${base} text-gray-500 dark:text-gray-400 border-b-2 border-transparent`;
    };
    
    const inputFocusRingColor = {
        receita: 'focus:ring-green-500',
        despesa: 'focus:ring-red-500',
        investimento: 'focus:ring-blue-500',
        parcelado: 'focus:ring-purple-500'
    };
    
    const buttonClasses = {
        receita: 'bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800',
        despesa: 'bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800',
        investimento: 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800',
        parcelado: 'bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-800'
    };
    
    const commonInputClasses = `w-full border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-dark-200 text-gray-800 dark:text-gray-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 ${inputFocusRingColor[activeTab]}`;
    
    const renderPJFields = () => {
        if (!isPJ || (activeTab !== 'despesa' && activeTab !== 'parcelado')) return null;
        return (
            <div className="bg-indigo-50 dark:bg-indigo-900/10 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30 grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div className="sm:col-span-2 text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-2">
                    <BriefcaseIcon className="w-3 h-3" /> Dados Empresariais
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase">Fornecedor</label>
                    <div className="relative">
                        <input type="text" value={supplier} onChange={e => setSupplier(e.target.value)} className={`${commonInputClasses} pl-9`} placeholder="Ex: AWS, Google, Mercado..." />
                        <BuildingIcon className="absolute left-3 top-2.5 w-4 h-4 text-indigo-400" />
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase">Centro de Custo / Projeto</label>
                    <input type="text" value={costCenter} onChange={e => setCostCenter(e.target.value)} className={commonInputClasses} placeholder="Ex: Projeto Alpha, Marketing..." />
                </div>
            </div>
        );
    };

    const renderFields = () => {
        const currentCategoryOptions = getCategoryOptions(activeTab);

        if (activeTab === 'parcelado') {
            return (
                <>
                    {renderPJFields()}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cartão de Crédito <span className="text-red-500">*</span></label>
                        <select value={selectedCardId} onChange={e => setSelectedCardId(e.target.value)} className={commonInputClasses} required disabled={isEditing}>
                            <option value="">Selecione o cartão...</option>
                            {creditCards.filter(c => c.status === 'active').map(card => (<option key={card.id} value={card.id}>{card.name} (Fecha dia {card.closingDay})</option>))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Produto / Serviço <span className="text-red-500">*</span></label>
                        <input list="products-list-parcelado" type="text" value={description} onChange={e => setDescription(e.target.value)} className={commonInputClasses} placeholder="Busque ou digite..." required />
                         <datalist id="products-list-parcelado">{productsServices.map(item => (<option key={item.id} value={item.name} />))}</datalist>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria <span className="text-red-500">*</span></label>
                        <select value={category} onChange={e => setCategory(e.target.value)} className={commonInputClasses} required>
                            <option value="">Selecione...</option>
                            {currentCategoryOptions.map(cat => (<option key={cat.id} value={cat.name}>{cat.name}</option>))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data da Compra <span className="text-red-500">*</span></label>
                        <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className={commonInputClasses} required disabled={isEditing} />
                    </div>
                    <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Tipo de Valor <span className="text-red-500">*</span></label>
                        <div className="flex flex-col sm:flex-row gap-4 mb-2">
                            <label className="flex items-center cursor-pointer"><input type="radio" name="valueType" checked={valueType === 'total'} onChange={() => setValueType('total')} className="mr-2 text-purple-600 focus:ring-purple-500" disabled={isEditing} /><span className="text-gray-700 dark:text-gray-300 text-sm">Valor Total da Compra</span></label>
                            <label className="flex items-center cursor-pointer"><input type="radio" name="valueType" checked={valueType === 'installment'} onChange={() => setValueType('installment')} className="mr-2 text-purple-600 focus:ring-purple-500" disabled={isEditing} /><span className="text-gray-700 dark:text-gray-300 text-sm">Valor da Parcela</span></label>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{valueType === 'total' ? 'Valor Total (R$)' : 'Valor da Parcela (R$)'}</label>
                            <input type="number" value={value} onChange={e => setValue(e.target.value)} step="0.01" min="0.01" className={commonInputClasses} required />
                        </div>
                        <div className="mt-3">
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Quantidade de Parcelas</label>
                            <input type="number" value={installments} onChange={e => setInstallments(e.target.value)} min="2" max="60" className={commonInputClasses} required disabled={isEditing} />
                        </div>
                    </div>
                </>
            );
        }

        if (activeTab === 'receita') {
            return (
                <>
                    <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de Receita <span className="text-red-500">*</span></label><select value={incomeType} onChange={e => setIncomeType(e.target.value)} className={commonInputClasses} required><option value="">Selecione...</option>{incomeTypes.map(type => <option key={type.id} value={type.name}>{type.name}</option>)}</select></div>
                    <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria <span className="text-red-500">*</span></label><select value={category} onChange={e => setCategory(e.target.value)} className={commonInputClasses} required><option value="">Selecione...</option>{currentCategoryOptions.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}</select></div>
                    <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor (R$) <span className="text-red-500">*</span></label><input type="number" value={value} onChange={e => setValue(e.target.value)} step="0.01" min="0.01" className={commonInputClasses} required /></div>
                    <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Origem/Descrição <span className="text-red-500">*</span></label><input type="text" value={description} onChange={e => setDescription(e.target.value)} className={commonInputClasses} placeholder="Ex: Cliente XYZ, Reembolso Empresa..." required /></div>
                    <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data de Recebimento <span className="text-red-500">*</span></label><input type="date" value={date} onChange={e => setDate(e.target.value)} className={commonInputClasses} required /></div>
                </>
            );
        }

        if (activeTab === 'despesa') {
            return (
                <>
                    {renderPJFields()}
                    <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de Despesa <span className="text-red-500">*</span></label><select value={expenseType} onChange={e => setExpenseType(e.target.value)} className={commonInputClasses} required><option value="">Selecione...</option>{expenseTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}</select></div>
                    <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria <span className="text-red-500">*</span></label><select value={category} onChange={e => setCategory(e.target.value)} className={commonInputClasses} required><option value="">Selecione...</option>{currentCategoryOptions.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}</select></div>
                    <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Produto/Serviço <span className="text-red-500">*</span></label><input list="products-list-despesa" type="text" value={description} onChange={e => setDescription(e.target.value)} className={commonInputClasses} placeholder="Ex: Conta de Luz, Manutenção..." required /><datalist id="products-list-despesa">{productsServices.map(item => (<option key={item.id} value={item.name} />))}</datalist></div>
                    <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor (R$) <span className="text-red-500">*</span></label><input type="number" value={value} onChange={e => setValue(e.target.value)} step="0.01" min="0.01" className={commonInputClasses} required /></div>
                    <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Forma de Pagamento <span className="text-red-500">*</span></label><select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={commonInputClasses} required><option value="">Selecione...</option>{paymentTypes.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}</select></div>
                    <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-200 dark:border-gray-700"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Essa despesa já foi paga?</label><div className="flex gap-4 mb-3"><label className="flex items-center cursor-pointer"><input type="radio" name="isPaid" checked={isPaid === true} onChange={() => setIsPaid(true)} className="mr-2 text-red-600 focus:ring-red-500" /><span className="text-gray-700 dark:text-gray-300">Sim</span></label><label className="flex items-center cursor-pointer"><input type="radio" name="isPaid" checked={isPaid === false} onChange={() => setIsPaid(false)} className="mr-2 text-red-600 focus:ring-red-500" /><span className="text-gray-700 dark:text-gray-300">Não</span></label></div><div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 animate-fade-in">{isPaid ? 'Quando foi pago?' : 'Quando deve ser pago?'} <span className="text-red-500">*</span></label><input type="date" value={date} onChange={e => setDate(e.target.value)} className={commonInputClasses} required /></div></div>
                </>
            );
        }

        if (activeTab === 'investimento') {
            return (
                <>
                    <div className="bg-indigo-50 dark:bg-indigo-900/20 p-3 rounded-lg border border-indigo-100 dark:border-indigo-800 mb-4 animate-fade-in">
                        <div className="flex items-center gap-2 mb-2">
                            <TargetIcon className="text-indigo-500 h-4 w-4" />
                            <label className="block text-sm font-bold text-indigo-700 dark:text-indigo-300">Vincular a uma Meta?</label>
                        </div>
                        <select 
                            value={selectedGoalId} 
                            onChange={e => setSelectedGoalId(e.target.value)} 
                            className="w-full border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-dark-100 text-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">Sem Meta (Investimento Geral)</option>
                            {goals.filter(g => g.status === 'em_andamento').map(goal => (
                                <option key={goal.id} value={goal.id}>
                                    {goal.visual.emoji} {goal.name} ({Math.round(Math.min(100, (goal.currentAmount/goal.targetAmount)*100))}%)
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Selecione a Carteira <span className="text-red-500">*</span></label>
                        <select value={walletId} onChange={e => setWalletId(e.target.value)} className={commonInputClasses} required>
                            <option value="">Selecione...</option>
                            {wallets.map(wallet => (<option key={wallet.id} value={wallet.id}>{wallet.name}</option>))}
                        </select>
                    </div>

                     <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição <span className="text-red-500">*</span></label>
                        <input type="text" value={description} onChange={e => setDescription(e.target.value)} className={commonInputClasses} placeholder="Ex: Aporte Mensal" required />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria <span className="text-red-500">*</span></label>
                        <select value={category} onChange={e => setCategory(e.target.value)} className={commonInputClasses} required>
                            <option value="">Selecione...</option>
                            {currentCategoryOptions.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor Investido (R$) <span className="text-red-500">*</span></label>
                        <input type="number" value={value} onChange={e => setValue(e.target.value)} step="0.01" min="0.01" className={commonInputClasses} required />
                    </div>

                    <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Esse valor já foi depositado?</label>
                        <div className="flex gap-4 mb-3">
                            <label className="flex items-center cursor-pointer"><input type="radio" name="isDeposited" checked={isDeposited === true} onChange={() => setIsDeposited(true)} className="mr-2 text-blue-600 focus:ring-blue-500" /><span className="text-gray-700 dark:text-gray-300">Sim</span></label>
                            <label className="flex items-center cursor-pointer"><input type="radio" name="isDeposited" checked={isDeposited === false} onChange={() => setIsDeposited(false)} className="mr-2 text-blue-600 focus:ring-blue-500" /><span className="text-gray-700 dark:text-gray-300">Não</span></label>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 animate-fade-in">{isDeposited ? 'Quando foi depositado?' : 'Quando deve ser depositado?'} <span className="text-red-500">*</span></label>
                            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={commonInputClasses} required />
                        </div>
                    </div>
                </>
            );
        }

        return null;
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 transition-opacity" onClick={onClose}>
            <div className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-lg transition-transform transform scale-95 animate-scale-in max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-dark-100 z-10">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-white">{isEditing ? 'Editar Transação' : 'Nova Transação'}</h3>
                    <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                       <CloseIcon />
                    </button>
                </div>

                {/* AI Entry Panel */}
                {!isEditing && (
                    <div className="p-4 bg-indigo-50 dark:bg-indigo-900/10 border-b border-indigo-100 dark:border-indigo-900/30 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <SparklesIcon className="text-indigo-600 h-4 w-4" />
                                <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-widest">Assistente de Preenchimento IA</span>
                            </div>
                            {aiStatus && (
                                <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full animate-pulse">{aiStatus}</span>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isAILoading}
                                className="flex-1 bg-white dark:bg-dark-200 border border-indigo-200 dark:border-indigo-800 p-2 rounded-lg flex items-center justify-center gap-2 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                            >
                                <DynamicIcon name="FileInvoice" size={14} /> Escanear Comprovante
                            </button>
                            <button 
                                onClick={handleVoiceEntry}
                                disabled={isAILoading}
                                className={`flex-1 border p-2 rounded-lg flex items-center justify-center gap-2 text-xs font-medium transition-all ${isRecording ? 'bg-red-100 border-red-300 text-red-700 animate-pulse' : 'bg-white dark:bg-dark-200 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'}`}
                            >
                                <MicrophoneIcon className={isRecording ? 'h-4 w-4' : 'h-4 w-4'} /> {isRecording ? 'Ouvindo...' : 'Falar Transação'}
                            </button>
                        </div>
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*,application/pdf" onChange={handleFileUpload} />
                        {isAILoading && (
                             <div className="h-1 bg-indigo-200 dark:bg-indigo-800 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-600 w-1/3 animate-[shimmer_1.5s_infinite]"></div>
                             </div>
                        )}
                    </div>
                )}
                
                {!isEditing && !defaultType && (
                    <div className="border-b border-gray-200 dark:border-gray-700">
                        <div className="flex">
                            <button onClick={() => handleTabChange('receita')} className={tabClasses('receita')} disabled={isEditing}>Receita</button>
                            <button onClick={() => handleTabChange('despesa')} className={tabClasses('despesa')} disabled={isEditing}>Despesa</button>
                            <button onClick={() => handleTabChange('investimento')} className={tabClasses('investimento')} disabled={isEditing}>Investimento</button>
                            <button onClick={() => handleTabChange('parcelado')} className={tabClasses('parcelado')} disabled={isEditing}>Parcelado</button>
                        </div>
                    </div>
                )}
                
                <div className="p-6">
                    <form onSubmit={handleSubmit}>
                        <div className="space-y-4">
                            {renderFields()}
                        </div>
                        <div className="mt-6">
                            <button type="submit" className={`w-full text-white font-medium py-3 px-4 rounded-lg shadow-md transition-colors duration-200 ${buttonClasses[activeTab]}`}>
                                {isEditing ? 'Salvar Alterações' : `Revisar e Adicionar ${activeTab === 'receita' ? 'Receita' : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}`}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
             <style>{`
                @keyframes shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(200%); }
                }
                @keyframes scale-in {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .animate-scale-in {
                    animation: scale-in 0.2s ease-out forwards;
                }
                @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .animate-fade-in {
                    animation: fade-in 0.3s ease-in forwards;
                }
            `}</style>
        </div>
    );
};

export default TransactionModal;
