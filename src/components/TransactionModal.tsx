import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

import React, { useState, FormEvent, useEffect, useRef, useMemo } from 'react';
import {
    Transaction,
    TransactionType,
    CreditCard,
    EntityItem,
    TransactionModalProps,
    Goal,
    TransactionDisplaySnapshots,
    TransactionCatalogVisualSnapshot,
} from '../types.ts';
import { CloseIcon, TargetIcon, BriefcaseIcon, BuildingIcon, SparklesIcon, MicrophoneIcon, DynamicIcon } from './Icons.tsx';
import CatalogCombobox from './CatalogCombobox.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useTransactionCatalogOptions } from '../modules/settings-catalog/useTransactionCatalogOptions.ts';
import { useCreateSettingsCatalogItem } from '../modules/settings-catalog/hooks.ts';
import { normalizeSettingsCatalogName } from '../modules/settings-catalog/utils.ts';

interface ExtendedTransactionModalProps extends TransactionModalProps {
    goals?: Goal[];
    defaultGoalId?: string | null;
}

const TransactionModal: React.FC<ExtendedTransactionModalProps> = ({
    isOpen,
    onClose,
    onAddTransaction,
    onAddTransactions,
    onAddCreditCardPurchase,
    onUpdateTransaction,
    transactionToEdit,
    defaultType,
    allowedTypes = null,
    currentDate,
    creditCards = [],
    productsServices = [],
    settingsCategories = [],
    wallets = [],
    expenseTypes = [],
    paymentTypes = [],
    incomeTypes = [],
    costCenters = [],
    goals = [],
    transactions = [],
    defaultGoalId = null,
    onAddProductService
}) => {
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';
    const createCatalogItemMutation = useCreateSettingsCatalogItem();
    const modalRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);


    const isEditing = !!transactionToEdit;
    const [activeTab, setActiveTab] = useState<TransactionType>('receita');
    // Com o domínio patrimonial oficial ligado, aporte e resgate deixam de ser
    // lançamento de transação: os relatórios passam a ler só as projeções,
    // enquanto o fluxo de caixa continua somando `transactions`. Um aporte
    // gravado por aqui sairia do caixa e nunca chegaria ao patrimônio. As
    // Rules e as callables já recusam a escrita; a interface para de oferecê-la
    // para o usuário não esbarrar num erro de permissão sem explicação.
    const investmentsV2Enabled = activeWorkspace?.features?.investmentsV2?.enabled === true;

    const resolvedAllowedTypes = useMemo<TransactionType[]>(() => {
        const withoutLegacyInvestment = (types: TransactionType[]) =>
            investmentsV2Enabled ? types.filter(type => type !== 'investimento') : types;

        if (isEditing && transactionToEdit) {
            return [transactionToEdit.type];
        }

        if (allowedTypes && allowedTypes.length > 0) {
            return withoutLegacyInvestment(allowedTypes);
        }

        if (defaultType) {
            return withoutLegacyInvestment([defaultType]);
        }

        return withoutLegacyInvestment(['receita', 'despesa', 'investimento', 'parcelado']);
    }, [allowedTypes, defaultType, isEditing, transactionToEdit, investmentsV2Enabled]);

    /** Modal aberto só para investimento num workspace já migrado. */
    const investmentTrailClosed = !isEditing && resolvedAllowedTypes.length === 0;

    // State for form fields
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState('');
    const [value, setValue] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [installments, setInstallments] = useState('1');

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
    const [investmentOperation, setInvestmentOperation] = useState<'contribution' | 'redemption'>('contribution');
    const [sourceMovementId, setSourceMovementId] = useState('');
    const [redemptionGain, setRedemptionGain] = useState('0');
    const [redemptionFees, setRedemptionFees] = useState('0');
    const [redemptionTax, setRedemptionTax] = useState('0');
    const redemptionRequestId = useRef('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submissionError, setSubmissionError] = useState<string | null>(null);

    const redemptionSources = useMemo(() => transactions.filter((transaction) => {
        if (transaction.type !== 'investimento' || transaction.isPaid !== true) return false;
        if (transaction.investmentMetadata &&
            transaction.investmentMetadata.investmentOperation !== 'contribution') return false;
        const principalCents = transaction.investmentMetadata?.principalCents ??
            transaction.valueCents ?? Math.round(transaction.value * 100);
        const remainingCents = transaction.remainingPrincipalCents ??
            principalCents - (transaction.redeemedPrincipalCents ?? 0);
        return remainingCents > 0 || String(transaction.id) === sourceMovementId;
    }), [transactions, sourceMovementId]);

    useEffect(() => {
        if (!isOpen) return;
        previousFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        requestAnimationFrame(() => titleRef.current?.focus());
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key !== 'Tab' || !modalRef.current) return;
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
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previousFocusRef.current?.focus();
        };
    }, [isOpen]);

    // PJ Specific State
    const [supplier, setSupplier] = useState('');
    const [costCenter, setCostCenter] = useState('');



    const buildNameOptions = (
        items: EntityItem[] = [],
        selectedValue?: string
    ) => {
        const names = items.map((item) => item.name);

        if (
            selectedValue &&
            selectedValue.trim() &&
            !names.some(
                (name) => name.trim().toLowerCase() === selectedValue.trim().toLowerCase()
            )
        ) {
            return [selectedValue, ...names];
        }

        return names;
    };

    const effectiveTransactionType = isEditing && transactionToEdit
        ? transactionToEdit.type
        : activeTab;

    const {
        options: catalogOptions,
        isLoading: isCatalogLoading,
    } = useTransactionCatalogOptions(effectiveTransactionType);

    const mergedProductsServices = useMemo(
        () => catalogOptions.productsServices,
        [catalogOptions.productsServices]
    );

    const mergedSettingsCategories = useMemo(
        () => catalogOptions.settingsCategories,
        [catalogOptions.settingsCategories]
    );

    const mergedWallets = useMemo(
        () => catalogOptions.wallets,
        [catalogOptions.wallets]
    );

    const mergedExpenseTypes = useMemo(
        () => catalogOptions.expenseTypes,
        [catalogOptions.expenseTypes]
    );

    const mergedPaymentTypes = useMemo(
        () => catalogOptions.paymentTypes,
        [catalogOptions.paymentTypes]
    );

    const mergedIncomeTypes = useMemo(
        () => catalogOptions.incomeTypes,
        [catalogOptions.incomeTypes]
    );

    const mergedCostCenters = useMemo(
        () => catalogOptions.costCenters,
        [catalogOptions.costCenters]
    );

    const ensureProductServiceValue = async (rawValue: string) => {
        const trimmed = rawValue.trim();

        if (!trimmed) return '';

        const normalized = normalizeSettingsCatalogName(trimmed);

        const existing = mergedProductsServices.find(
            (item) => normalizeSettingsCatalogName(item.name) === normalized
        );

        if (existing) {
            return existing.name;
        }

        try {
            const created = await createCatalogItemMutation.mutateAsync({
                group: 'product_service',
                name: trimmed,
                workspaceScope: 'both',
                status: 'active',
            });

            return created.name;
        } catch (error) {
            const message =
                error instanceof Error ? error.message.toLowerCase() : '';

            const duplicateError =
                message.includes('já existe') ||
                message.includes('duplicate');

            if (duplicateError) {
                const fallbackExisting = mergedProductsServices.find(
                    (item) => normalizeSettingsCatalogName(item.name) === normalized
                );

                return fallbackExisting?.name || trimmed;
            }

            throw error;
        }
    };

    const buildSnapshotFromEntityItem = (
        group: TransactionCatalogVisualSnapshot['group'],
        item?: EntityItem,
    ): TransactionCatalogVisualSnapshot | undefined => {
        if (!item?.name) return undefined;

        return {
            group,
            label: item.name,
            normalizedLabel: normalizeSettingsCatalogName(item.name),
            icon: item.icon,
            color: item.iconColor,
            stroke: item.iconStroke,
            transactionSubtype: item.type as TransactionType | undefined,
        };
    };

    const findEntityByName = (
        items: EntityItem[],
        label?: string,
        type?: TransactionType,
    ) => {
        if (!label?.trim()) return undefined;

        const normalized = normalizeSettingsCatalogName(label);

        return items.find((item) => {
            if (normalizeSettingsCatalogName(item.name) !== normalized) return false;

            if (type && item.type) {
                return item.type === type;
            }

            return true;
        });
    };

    const buildDisplaySnapshots = (
        resolvedDescription: string,
    ): TransactionDisplaySnapshots => {
        const categoryItem = findEntityByName(
            mergedSettingsCategories,
            category,
            activeTab,
        );

        const expenseTypeItem = findEntityByName(
            mergedExpenseTypes,
            expenseType,
        );

        const incomeTypeItem = findEntityByName(
            mergedIncomeTypes,
            incomeType,
        );

        const paymentMethodItem = findEntityByName(
            mergedPaymentTypes,
            paymentMethod,
        );

        const productServiceItem = findEntityByName(
            mergedProductsServices,
            resolvedDescription,
        );

        const costCenterItem = findEntityByName(
            mergedCostCenters,
            costCenter,
        );

        const walletItem = mergedWallets.find(
            (item) => String(item.id) === walletId,
        );

        return {
            categorySnapshot: buildSnapshotFromEntityItem('category', categoryItem),
            expenseTypeSnapshot: buildSnapshotFromEntityItem(
                'expense_type',
                expenseTypeItem,
            ),
            incomeTypeSnapshot: buildSnapshotFromEntityItem(
                'income_type',
                incomeTypeItem,
            ),
            paymentMethodSnapshot: buildSnapshotFromEntityItem(
                'payment_method',
                paymentMethodItem,
            ),
            productServiceSnapshot: buildSnapshotFromEntityItem(
                'product_service',
                productServiceItem,
            ),
            walletSnapshot: buildSnapshotFromEntityItem('wallet', walletItem),
            costCenterSnapshot: buildSnapshotFromEntityItem(
                'cost_center',
                costCenterItem,
            ),
        };
    };

    const walletOptions = useMemo(() => {
        const options = mergedWallets.map((wallet) => ({
            value: String(wallet.id),
            label: wallet.name,
        }));

        if (walletId && !options.some((option) => option.value === walletId)) {
            options.unshift({
                value: walletId,
                label: `Carteira legada (ID ${walletId})`,
            });
        }

        return options;
    }, [mergedWallets, walletId]);

    const normalizeMoney = (amount: number): number =>
        Math.round((amount + Number.EPSILON) * 100) / 100;

    const formatCurrency = (amount: number): string =>
        amount.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        });

    const padDatePart = (value: number): string => String(value).padStart(2, '0');

    const lastDayOfMonth = (year: number, monthIndex: number): number =>
        new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

    const parseIsoDateParts = (
        value: string,
    ): { year: number; monthIndex: number; day: number } | null => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

        if (!match) return null;

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const monthIndex = month - 1;
        const lastDay = lastDayOfMonth(year, monthIndex);

        if (month < 1 || month > 12 || day < 1 || day > lastDay) {
            return null;
        }

        return { year, monthIndex, day };
    };

    const formatCompetenceMonth = (year: number, monthIndex: number): string => {
        const date = new Date(Date.UTC(year, monthIndex, 1));

        return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}`;
    };

    const addMonthsToCompetence = (
        competenceMonth: string,
        months: number,
    ): string => {
        const [year, month] = competenceMonth.split('-').map(Number);

        return formatCompetenceMonth(year, month - 1 + months);
    };

    const formatDateWithSafeDay = (
        competenceMonth: string,
        day: number,
    ): string => {
        const [year, month] = competenceMonth.split('-').map(Number);
        const monthIndex = month - 1;
        const safeDay = Math.min(day, lastDayOfMonth(year, monthIndex));

        return `${year}-${padDatePart(month)}-${padDatePart(safeDay)}`;
    };

    const calculateFirstInvoiceCompetence = (
        date: string,
        closingDay: number,
    ): string | null => {
        const parts = parseIsoDateParts(date);

        if (!parts) return null;

        const baseCompetence = formatCompetenceMonth(parts.year, parts.monthIndex);

        return parts.day > closingDay
            ? addMonthsToCompetence(baseCompetence, 1)
            : baseCompetence;
    };

    const getAvailableLimitForCard = (card: CreditCard): number => {
        if (typeof card.limitAvailable === 'number') {
            return normalizeMoney(card.limitAvailable);
        }

        if (typeof card.limitUsed === 'number') {
            return normalizeMoney(Math.max(card.limitTotal - card.limitUsed, 0));
        }

        return normalizeMoney(card.limitTotal);
    };

    const selectedCreditCardForPurchase = useMemo(
        () => creditCards.find((card) => String(card.id) === selectedCardId),
        [creditCards, selectedCardId],
    );

    const creditCardPurchasePreview = useMemo(() => {
        if (activeTab !== 'parcelado' || !selectedCreditCardForPurchase) {
            return null;
        }

        const parsedInstallments = Number.parseInt(installments, 10);
        const parsedAmount = Number(value);

        if (
            !Number.isFinite(parsedInstallments) ||
            parsedInstallments < 1 ||
            !Number.isFinite(parsedAmount) ||
            parsedAmount <= 0
        ) {
            return null;
        }

        const totalAmount = normalizeMoney(
            valueType === 'total'
                ? parsedAmount
                : parsedAmount * parsedInstallments,
        );
        const installmentAmount = normalizeMoney(totalAmount / parsedInstallments);
        const firstInvoiceCompetence = calculateFirstInvoiceCompetence(
            purchaseDate,
            selectedCreditCardForPurchase.closingDay,
        );

        if (!firstInvoiceCompetence) {
            return null;
        }

        const firstInvoiceDueDate = formatDateWithSafeDay(
            firstInvoiceCompetence,
            selectedCreditCardForPurchase.dueDay,
        );
        const availableLimit = getAvailableLimitForCard(selectedCreditCardForPurchase);
        const limitAfterPurchase = normalizeMoney(availableLimit - totalAmount);

        return {
            totalAmount,
            installmentAmount,
            installmentsCount: parsedInstallments,
            firstInvoiceCompetence,
            firstInvoiceDueDate,
            availableLimit,
            limitAfterPurchase,
            isLimitInsufficient: limitAfterPurchase < 0,
        };
    }, [
        activeTab,
        selectedCreditCardForPurchase,
        installments,
        value,
        valueType,
        purchaseDate,
    ]);




    // AI States
    const [isAILoading, setIsAILoading] = useState(false);
    const [aiStatus, setAIStatus] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const recognitionRef = useRef<any>(null);



    // Helper to get category options filtered by active tab type
    const getCategoryOptions = (type: TransactionType) => {
        return mergedSettingsCategories.filter((c) => c.type === type);
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
            const investmentMetadata = transactionToEdit.investmentMetadata;
            if (investmentMetadata?.investmentOperation === 'redemption') {
                setInvestmentOperation('redemption');
                setSourceMovementId(investmentMetadata.sourceMovementId);
                setValue(String(investmentMetadata.principalCents / 100));
                setRedemptionGain(String(investmentMetadata.gainCents / 100));
                setRedemptionFees(String(investmentMetadata.feesCents / 100));
                setRedemptionTax(String(investmentMetadata.taxCents / 100));
                setDate(investmentMetadata.settlementDate || transactionToEdit.date);
                setIsDeposited(investmentMetadata.status === 'settled');
            } else {
                setInvestmentOperation('contribution');
                setSourceMovementId('');
                setRedemptionGain('0');
                setRedemptionFees('0');
                setRedemptionTax('0');
            }

            // Set PJ Fields
            setSupplier(transactionToEdit.supplier || '');
            setCostCenter(transactionToEdit.costCenter || '');

        } else {
            // Limpa tudo para uma Nova Transação
            const initialTab = resolvedAllowedTypes[0] || defaultType || 'receita';
            setActiveTab(initialTab);
            setDescription('');
            setValue('');


            setDate('');
            setPurchaseDate('');

            setInstallments('1');
            setIsPaid(true);
            setIsDeposited(true);
            setInvestmentOperation('contribution');
            setSourceMovementId('');
            setRedemptionGain('0');
            setRedemptionFees('0');
            setRedemptionTax('0');
            setSupplier('');
            setCostCenter('');

            if (defaultGoalId) setSelectedGoalId(String(defaultGoalId));
            else setSelectedGoalId('');


            setCategory('');
            setExpenseType('');
            setIncomeType('');
            setPaymentMethod('');
            setSelectedCardId('');
            setWalletId('');
            setValueType('total');
        }
        setSubmissionError(null);
        setIsSubmitting(false);
        redemptionRequestId.current = `investment-redemption-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
    }, [
        isOpen,
        transactionToEdit,
        defaultType,
        isEditing,
        defaultGoalId,
        resolvedAllowedTypes
    ]);

    const handleTabChange = (newTab: TransactionType) => {
        if (!resolvedAllowedTypes.includes(newTab)) return;

        setActiveTab(newTab);

        const catOptions = getCategoryOptions(newTab);
        setCategory(catOptions.length > 0 ? catOptions[0].name : '');

        if (newTab !== 'despesa') {
            setExpenseType('');
            setPaymentMethod('');
        }

        if (newTab !== 'receita') {
            setIncomeType('');
        }

        if (newTab !== 'investimento') {
            setWalletId('');
        }
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
            const options = getCategoryOptions(data.type || activeTab);
            const exists = options.find((o) =>
                o.name.toLowerCase().includes(String(data.category).toLowerCase())
            );
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
                // A extração roda no backend: a chave do modelo nunca chega ao
                // navegador. Antes, `vite.config.ts` injetava a credencial real
                // no bundle servido a qualquer visitante.
                const callable = httpsCallable<Record<string, unknown>, { extracted: Record<string, unknown> }>(
                    functions,
                    'extractTransactionFromContent',
                );
                const response = await callable({
                    kind: 'document',
                    workspaceId: activeWorkspace.id,
                    mimeType: file.type,
                    dataBase64: base64Data,
                });
                const result = response.data.extracted ?? {};
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
                const callable = httpsCallable<Record<string, unknown>, { extracted: Record<string, unknown> }>(
                    functions,
                    'extractTransactionFromContent',
                );
                const response = await callable({
                    kind: 'text',
                    workspaceId: activeWorkspace.id,
                    transcript,
                });
                const result = response.data.extracted ?? {};
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

    const buildCreditCardPurchaseIdempotencyKey = (): string => {
        const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

        return `manual-credit-card-purchase-${randomPart}`;
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();

        let resolvedDescription = description;

        if (activeTab === 'despesa' || activeTab === 'parcelado') {
            resolvedDescription = await ensureProductServiceValue(description);
            setDescription(resolvedDescription);
        }

        const displaySnapshots = buildDisplaySnapshots(resolvedDescription);

        if (activeTab === 'parcelado' && !isEditing) {
            const card = creditCards.find(c => String(c.id) === selectedCardId);

            if (!card) {
                alert("Selecione um cartão válido.");
                return;
            }

            const totalInstallments = parseInt(installments, 10);
            const inputVal = parseFloat(value);

            if (!Number.isFinite(totalInstallments) || totalInstallments < 1) {
                alert("Informe uma quantidade válida de parcelas.");
                return;
            }

            if (!Number.isFinite(inputVal) || inputVal <= 0) {
                alert("Informe um valor válido para a compra.");
                return;
            }

            const purchaseTotalAmount = normalizeMoney(
                valueType === 'total'
                    ? inputVal
                    : inputVal * totalInstallments,
            );
            const availableLimit = getAvailableLimitForCard(card);

            if (purchaseTotalAmount > availableLimit) {
                alert("Limite disponível insuficiente para esta compra.");
                return;
            }

            if (onAddCreditCardPurchase) {
                await onAddCreditCardPurchase({
                    cardId: String(card.id),
                    description: resolvedDescription,
                    categorySnapshot: {
                        label: category || 'Sem categoria',
                        normalizedLabel: (category || 'Sem categoria').trim().toLowerCase(),
                    },
                    supplier: isPJ ? supplier : undefined,
                    costCenter: isPJ ? costCenter : undefined,
                    purchaseDate,
                    totalAmount: inputVal,
                    installmentsCount: totalInstallments,
                    amountType: valueType,
                    source: 'manual',
                    idempotencyKey: buildCreditCardPurchaseIdempotencyKey(),
                    correlationId: 'transaction-modal-credit-card-purchase',
                });

                onClose();
                return;
            }

            if (onAddTransactions) {
                const finalTotal = valueType === 'total' ? inputVal : inputVal * totalInstallments;
                const installmentValue = valueType === 'total'
                    ? parseFloat((inputVal / totalInstallments).toFixed(2))
                    : inputVal;

                const pDate = new Date(purchaseDate);
                const startMonthOffset = pDate.getDate() > card.closingDay ? 1 : 0;
                const newTransactions: Omit<Transaction, 'id'>[] = [];
                const remainder = valueType === 'total'
                    ? parseFloat((finalTotal - (installmentValue * totalInstallments)).toFixed(2))
                    : 0;

                for (let i = 0; i < totalInstallments; i++) {
                    const isLast = i === totalInstallments - 1;
                    const currentVal = isLast
                        ? parseFloat((installmentValue + remainder).toFixed(2))
                        : installmentValue;
                    const dueDate = new Date(
                        pDate.getFullYear(),
                        pDate.getMonth() + startMonthOffset + i,
                        card.dueDay
                    );

                    newTransactions.push({
                        type: 'parcelado',
                        displaySnapshots,
                        description: resolvedDescription,
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
        }

        const transactionData: any = {
            type: activeTab,
            description: resolvedDescription,
            category,
            value: parseFloat(value),
            date,
            supplier: isPJ ? supplier : undefined,
            costCenter: isPJ ? costCenter : undefined,
            displaySnapshots,
        };

        if (activeTab === 'parcelado') {
            transactionData.installments = parseInt(installments, 10);
            transactionData.currentInstallment = isEditing ? transactionToEdit.currentInstallment : 1;
            if (selectedCardId) transactionData.cardId = selectedCardId;
        }

        if (activeTab === 'despesa') {
            transactionData.expenseType = expenseType;
            transactionData.paymentMethod = paymentMethod;
            transactionData.isPaid = isPaid;
        }

        if (activeTab === 'receita') transactionData.incomeType = incomeType;

        if (activeTab === 'investimento') {
            if (investmentOperation === 'redemption') {
                const source = redemptionSources.find(item => String(item.id) === sourceMovementId);
                const principal = parseFloat(value);
                const gain = parseFloat(redemptionGain || '0');
                const fees = parseFloat(redemptionFees || '0');
                const tax = parseFloat(redemptionTax || '0');
                if (!source) {
                    setSubmissionError('Selecione um investimento de origem com saldo disponível.');
                    return;
                }
                if (![principal, gain, fees, tax].every(Number.isFinite) || principal <= 0 || gain < 0 || fees < 0 || tax < 0) {
                    setSubmissionError('Revise os valores informados para o resgate.');
                    return;
                }
                if (tax > gain || fees + tax >= principal + gain) {
                    setSubmissionError('Impostos não podem superar o ganho, e os descontos devem ser menores que o valor bruto.');
                    return;
                }
                const toCents = (amount: number) => Math.round(amount * 100);
                const netCashCents = toCents(principal) + toCents(gain) - toCents(fees) - toCents(tax);
                transactionData.value = netCashCents / 100;
                transactionData.valueCents = netCashCents;
                transactionData.category = source.category;
                transactionData.walletId = source.walletId;
                transactionData.goalId = source.goalId;
                transactionData.isPaid = isDeposited;
                transactionData.investmentMetadata = {
                    currency: 'BRL',
                    investmentOperation: 'redemption',
                    cashImpact: isDeposited ? 'inflow' : 'none',
                    investmentImpact: isDeposited ? 'decrease' : 'none',
                    principalCents: toCents(principal),
                    gainCents: toCents(gain),
                    feesCents: toCents(fees),
                    taxCents: toCents(tax),
                    settlementDate: date,
                    status: isDeposited ? 'settled' : 'pending',
                    sourceMovementId,
                    idempotencyKey: redemptionRequestId.current,
                };
            } else {
                if (walletId) transactionData.walletId = walletId;
                transactionData.isPaid = isDeposited;
                if (selectedGoalId) transactionData.goalId = selectedGoalId;
                else transactionData.goalId = undefined;
            }
        }

        if (activeTab === 'investimento') {
            setIsSubmitting(true);
            setSubmissionError(null);
            try {
                if (isEditing) await onUpdateTransaction({ ...transactionToEdit, ...transactionData });
                else await onAddTransaction(transactionData as Omit<Transaction, 'id'>);
                onClose();
            } catch (error) {
                console.error('Falha ao salvar investimento:', error);
                setSubmissionError(
                    investmentOperation === 'redemption'
                        ? 'Não foi possível salvar o resgate. Revise o saldo e tente novamente.'
                        : 'Não foi possível salvar o aporte. Revise os dados e tente novamente.'
                );
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        if (isEditing) await onUpdateTransaction({ ...transactionToEdit, ...transactionData });
        else await onAddTransaction(transactionData as Omit<Transaction, 'id'>);

        onClose();
    };

    const tabClasses = (tabType: TransactionType) => {
        const base = "tab-button flex-1 py-3 px-2 font-medium text-center focus:outline-none transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed";
        if (activeTab === tabType) {
            switch (tabType) {
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
        if (!isPJ) return null;

        const showSupplier = activeTab === 'despesa' || activeTab === 'parcelado';

        return (
            <div className="bg-indigo-50 dark:bg-indigo-900/10 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30 grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div className="sm:col-span-2 text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-2">
                    <BriefcaseIcon className="w-3 h-3" /> Dados Empresariais
                </div>

                {showSupplier && (
                    <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase">
                            Fornecedor
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                value={supplier}
                                onChange={e => setSupplier(e.target.value)}
                                className={`${commonInputClasses} pl-9`}
                                placeholder="Ex: AWS, Google, Mercado..."
                            />
                            <BuildingIcon className="absolute left-3 top-2.5 w-4 h-4 text-indigo-400" />
                        </div>
                    </div>
                )}

                <div className={showSupplier ? '' : 'sm:col-span-2'}>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase">
                        Centro de Custo / Projeto
                    </label>
                    <input
                        list="cost-centers-list"
                        type="text"
                        value={costCenter}
                        onChange={e => setCostCenter(e.target.value)}
                        className={commonInputClasses}
                        placeholder={
                            mergedCostCenters.length > 0
                                ? 'Selecione ou digite...'
                                : 'Ex: Projeto Alpha, Marketing...'
                        }
                    />
                    <datalist id="cost-centers-list">
                        {mergedCostCenters.map((center) => (
                            <option key={center.id} value={center.name} />
                        ))}
                    </datalist>
                    {isCatalogLoading && (
                        <p className="mt-1 text-[11px] text-indigo-500">
                            Atualizando centros de custo do catálogo...
                        </p>
                    )}
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
                    <CatalogCombobox
                        label="Produto / Serviço"
                        required
                        value={description}
                        options={mergedProductsServices}
                        placeholder="Busque, selecione ou digite um novo item..."
                        loading={isCatalogLoading || createCatalogItemMutation.isPending}
                        inputClassName={commonInputClasses}
                        helperText="Use o mesmo campo para buscar, selecionar ou criar."
                        onValueChange={setDescription}
                        onCommitValue={ensureProductServiceValue}
                    />
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
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                                Use 1 para compra à vista no cartão.
                            </p>
                            <input type="number" value={installments} onChange={e => setInstallments(e.target.value)} min="1" max="60" className={commonInputClasses} required disabled={isEditing} />
                        </div>

                        {creditCardPurchasePreview && (
                            <div className={`mt-3 rounded-lg border p-3 text-xs ${creditCardPurchasePreview.isLimitInsufficient
                                ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
                                : 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300'
                                }`}>
                                <p className="font-bold mb-2">
                                    Prévia antes de confirmar
                                </p>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <div>
                                        <p className="opacity-75">Primeira fatura</p>
                                        <p className="font-bold">{creditCardPurchasePreview.firstInvoiceCompetence}</p>
                                    </div>

                                    <div>
                                        <p className="opacity-75">Vencimento previsto</p>
                                        <p className="font-bold">
                                            {new Date(`${creditCardPurchasePreview.firstInvoiceDueDate}T12:00:00`).toLocaleDateString('pt-BR')}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="opacity-75">Valor total da compra</p>
                                        <p className="font-bold">{formatCurrency(creditCardPurchasePreview.totalAmount)}</p>
                                    </div>

                                    <div>
                                        <p className="opacity-75">Valor médio da parcela</p>
                                        <p className="font-bold">
                                            {formatCurrency(creditCardPurchasePreview.installmentAmount)}
                                            {' '}
                                            em {creditCardPurchasePreview.installmentsCount}x
                                        </p>
                                    </div>

                                    <div>
                                        <p className="opacity-75">Limite disponível atual</p>
                                        <p className="font-bold">{formatCurrency(creditCardPurchasePreview.availableLimit)}</p>
                                    </div>

                                    <div>
                                        <p className="opacity-75">Limite após a compra</p>
                                        <p className="font-bold">{formatCurrency(creditCardPurchasePreview.limitAfterPurchase)}</p>
                                    </div>
                                </div>

                                <p className="mt-2 font-medium">
                                    {creditCardPurchasePreview.isLimitInsufficient
                                        ? 'Limite insuficiente para esta compra.'
                                        : 'A compra consome limite agora. O caixa só será afetado no pagamento da fatura.'}
                                </p>
                            </div>
                        )}
                    </div>
                </>
            );
        }

        if (activeTab === 'receita') {
            const incomeTypeOptions = buildNameOptions(mergedIncomeTypes, incomeType);
            const categoryOptions = buildNameOptions(getCategoryOptions(activeTab), category);

            return (
                <>
                    {renderPJFields()}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Tipo de Receita <span className="text-red-500">*</span>
                        </label>
                        <select value={incomeType} onChange={e => setIncomeType(e.target.value)} className={commonInputClasses} required>
                            <option value="">Selecione...</option>
                            {incomeTypeOptions.map((name) => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria <span className="text-red-500">*</span></label>
                        <select value={category} onChange={e => setCategory(e.target.value)} className={commonInputClasses} required>
                            <option value="">Selecione...</option>
                            {buildNameOptions(getCategoryOptions(activeTab), category).map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Valor (R$) <span className="text-red-500">*</span>
                        </label>
                        <input type="number" value={value} onChange={e => setValue(e.target.value)} step="0.01" min="0.01" className={commonInputClasses} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Origem/Descrição <span className="text-red-500">*</span>
                        </label>
                        <input type="text" value={description} onChange={e => setDescription(e.target.value)} className={commonInputClasses} placeholder="Ex: Cliente XYZ, Reembolso Empresa..." required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Data de Recebimento <span className="text-red-500">*</span>
                        </label>
                        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={commonInputClasses} required />
                    </div>
                </>
            );
        }

        if (activeTab === 'despesa') {
            const expenseTypeOptions = buildNameOptions(mergedExpenseTypes, expenseType);
            const paymentTypeOptions = buildNameOptions(mergedPaymentTypes, paymentMethod);
            const categoryOptions = buildNameOptions(getCategoryOptions(activeTab), category);

            return (
                <>
                    {renderPJFields()}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Tipo de Despesa <span className="text-red-500">*</span>
                        </label>
                        <select value={expenseType} onChange={e => setExpenseType(e.target.value)} className={commonInputClasses} required>
                            <option value="">Selecione...</option>
                            {expenseTypeOptions.map((name) => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Categoria <span className="text-red-500">*</span>
                        </label>
                        <select value={category} onChange={e => setCategory(e.target.value)} className={commonInputClasses} required>
                            <option value="">Selecione...</option>
                            {categoryOptions.map((name) => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                    <CatalogCombobox
                        label="Produto/Serviço"
                        required
                        value={description}
                        options={mergedProductsServices}
                        placeholder="Ex: Conta de Luz, Manutenção..."
                        loading={isCatalogLoading || createCatalogItemMutation.isPending}
                        inputClassName={commonInputClasses}
                        helperText="Digite para buscar, selecionar ou criar automaticamente."
                        onValueChange={setDescription}
                        onCommitValue={ensureProductServiceValue}
                    />
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Valor (R$) <span className="text-red-500">*</span>
                        </label>
                        <input type="number" value={value} onChange={e => setValue(e.target.value)} step="0.01" min="0.01" className={commonInputClasses} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Forma de Pagamento <span className="text-red-500">*</span>
                        </label>
                        <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={commonInputClasses} required>
                            <option value="">Selecione...</option>
                            {paymentTypeOptions.map((name) => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Essa despesa já foi paga?
                        </label>
                        <div className="flex gap-4 mb-3">
                            <label className="flex items-center cursor-pointer">
                                <input type="radio" name="isPaid" checked={isPaid === true} onChange={() => setIsPaid(true)} className="mr-2 text-red-600 focus:ring-red-500" />
                                <span className="text-gray-700 dark:text-gray-300">Sim</span>
                            </label>
                            <label className="flex items-center cursor-pointer">
                                <input type="radio" name="isPaid" checked={isPaid === false} onChange={() => setIsPaid(false)} className="mr-2 text-red-600 focus:ring-red-500" />
                                <span className="text-gray-700 dark:text-gray-300">Não</span>
                            </label>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 animate-fade-in">
                                {isPaid ? 'Quando foi pago?' : 'Quando deve ser pago?'} <span className="text-red-500">*</span>
                            </label>
                            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={commonInputClasses} required />
                        </div>
                    </div>
                </>
            );
        }

        if (activeTab === 'investimento') {
            const categoryOptions = buildNameOptions(getCategoryOptions(activeTab), category);
            const immutableRedemption = isEditing &&
                transactionToEdit?.investmentMetadata?.investmentOperation === 'redemption' &&
                transactionToEdit.investmentMetadata.status !== 'pending';

            if (investmentOperation === 'redemption') {
                return (
                    <>
                        <div>
                            <label htmlFor="investmentOperation" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Operação <span className="text-red-500">*</span>
                            </label>
                            <select id="investmentOperation" value={investmentOperation} disabled={isEditing} onChange={event => setInvestmentOperation(event.target.value as 'contribution' | 'redemption')} className={commonInputClasses}>
                                <option value="contribution">Aporte</option>
                                <option value="redemption">Resgate</option>
                            </select>
                        </div>

                        {immutableRedemption && (
                            <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                                Um resgate liquidado não pode ser editado. Use a ação de estorno na lista de investimentos.
                            </p>
                        )}

                        <div>
                            <label htmlFor="redemptionSource" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Investimento de origem <span className="text-red-500">*</span>
                            </label>
                            <select id="redemptionSource" value={sourceMovementId} onChange={event => setSourceMovementId(event.target.value)} disabled={immutableRedemption} className={commonInputClasses} required>
                                <option value="">Selecione...</option>
                                {redemptionSources.map(source => {
                                    const principalCents = source.investmentMetadata?.principalCents ?? source.valueCents ?? Math.round(source.value * 100);
                                    const remainingCents = source.remainingPrincipalCents ?? principalCents - (source.redeemedPrincipalCents ?? 0);
                                    return (
                                        <option key={String(source.id)} value={String(source.id)}>
                                            {source.description} — saldo de {formatCurrency(remainingCents / 100)}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>

                        <div>
                            <label htmlFor="redemptionDescription" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Descrição <span className="text-red-500">*</span>
                            </label>
                            <input id="redemptionDescription" type="text" value={description} onChange={event => setDescription(event.target.value)} disabled={immutableRedemption} className={commonInputClasses} placeholder="Ex: Resgate parcial do CDB" required />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="redemptionPrincipal" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Principal resgatado (R$)</label>
                                <input id="redemptionPrincipal" type="number" value={value} onChange={event => setValue(event.target.value)} disabled={immutableRedemption} min="0.01" step="0.01" className={commonInputClasses} required />
                            </div>
                            <div>
                                <label htmlFor="redemptionGain" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rendimento realizado (R$)</label>
                                <input id="redemptionGain" type="number" value={redemptionGain} onChange={event => setRedemptionGain(event.target.value)} disabled={immutableRedemption} min="0" step="0.01" className={commonInputClasses} required />
                            </div>
                            <div>
                                <label htmlFor="redemptionFees" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Taxas (R$)</label>
                                <input id="redemptionFees" type="number" value={redemptionFees} onChange={event => setRedemptionFees(event.target.value)} disabled={immutableRedemption} min="0" step="0.01" className={commonInputClasses} required />
                            </div>
                            <div>
                                <label htmlFor="redemptionTax" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Impostos (R$)</label>
                                <input id="redemptionTax" type="number" value={redemptionTax} onChange={event => setRedemptionTax(event.target.value)} disabled={immutableRedemption} min="0" step="0.01" className={commonInputClasses} required />
                            </div>
                        </div>

                        <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Situação do resgate</span>
                            <div className="flex gap-4 mb-3">
                                <label className="flex items-center cursor-pointer">
                                    <input type="radio" name="redemptionStatus" checked={isDeposited === false} onChange={() => setIsDeposited(false)} disabled={immutableRedemption} className="mr-2 text-blue-600 focus:ring-blue-500" />
                                    <span className="text-gray-700 dark:text-gray-300">Pendente</span>
                                </label>
                                <label className="flex items-center cursor-pointer">
                                    <input type="radio" name="redemptionStatus" checked={isDeposited === true} onChange={() => setIsDeposited(true)} disabled={immutableRedemption} className="mr-2 text-blue-600 focus:ring-blue-500" />
                                    <span className="text-gray-700 dark:text-gray-300">Liquidado</span>
                                </label>
                            </div>
                            <label htmlFor="redemptionSettlementDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {isDeposited ? 'Data da liquidação' : 'Data prevista'} <span className="text-red-500">*</span>
                            </label>
                            <input id="redemptionSettlementDate" type="date" value={date} onChange={event => setDate(event.target.value)} disabled={immutableRedemption} className={commonInputClasses} required />
                        </div>
                    </>
                );
            }

            return (
                <>
                    <div>
                        <label htmlFor="investmentOperation" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Operação <span className="text-red-500">*</span>
                        </label>
                        <select id="investmentOperation" value={investmentOperation} disabled={isEditing || Boolean(defaultGoalId)} onChange={event => setInvestmentOperation(event.target.value as 'contribution' | 'redemption')} className={commonInputClasses}>
                            <option value="contribution">Aporte</option>
                            <option value="redemption">Resgate</option>
                        </select>
                    </div>
                    {renderPJFields()}
                    <div className="bg-indigo-50 dark:bg-indigo-900/20 p-3 rounded-lg border border-indigo-100 dark:border-indigo-800 mb-4 animate-fade-in">
                        <div className="flex items-center gap-2 mb-2">
                            <TargetIcon className="text-indigo-500 h-4 w-4" />
                            <label htmlFor="investmentGoal" className="block text-sm font-bold text-indigo-700 dark:text-indigo-300">
                                Vincular a uma Meta?
                            </label>
                        </div>
                        <select
                            id="investmentGoal"
                            value={selectedGoalId}
                            onChange={e => setSelectedGoalId(e.target.value)}
                            disabled={isEditing && Boolean(transactionToEdit?.goalId)}
                            className="w-full border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-dark-100 text-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">Sem Meta (Investimento Geral)</option>
                            {goals.filter(g => g.status === 'em_andamento').map(goal => (
                                <option key={goal.id} value={goal.id}>
                                    {goal.visual.emoji} {goal.name} ({Math.round(Math.min(100, (goal.currentAmount / goal.targetAmount) * 100))}%)
                                </option>
                            ))}
                        </select>
                        {isEditing && transactionToEdit?.goalId && (
                            <p className="mt-2 text-xs text-indigo-700 dark:text-indigo-300">
                                Para alterar o vínculo, use “Vincular Existente” na meta.
                            </p>
                        )}
                    </div>

                    <div>
                            <label htmlFor="investmentWallet" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Selecione a Carteira <span className="text-red-500">*</span>
                        </label>
                        <select id="investmentWallet" value={walletId} onChange={e => setWalletId(e.target.value)} className={commonInputClasses} required>
                            <option value="">Selecione...</option>
                            {walletOptions.map((wallet) => (
                                <option key={wallet.value} value={wallet.value}>{wallet.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="investmentDescription" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Descrição <span className="text-red-500">*</span>
                        </label>
                        <input id="investmentDescription" type="text" value={description} onChange={e => setDescription(e.target.value)} className={commonInputClasses} placeholder="Ex: Aporte Mensal" required />
                    </div>

                    <div>
                        <label htmlFor="investmentCategory" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Categoria <span className="text-red-500">*</span>
                        </label>
                        <select id="investmentCategory" value={category} onChange={e => setCategory(e.target.value)} className={commonInputClasses} required>
                            <option value="">Selecione...</option>
                            {categoryOptions.map((name) => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="investmentValue" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Valor Investido (R$) <span className="text-red-500">*</span>
                        </label>
                        <input id="investmentValue" type="number" value={value} onChange={e => setValue(e.target.value)} step="0.01" min="0.01" className={commonInputClasses} required />
                    </div>

                    <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Esse valor já foi depositado?
                        </label>
                        <div className="flex gap-4 mb-3">
                            <label className="flex items-center cursor-pointer">
                                <input type="radio" name="isDeposited" checked={isDeposited === true} onChange={() => setIsDeposited(true)} className="mr-2 text-blue-600 focus:ring-blue-500" />
                                <span className="text-gray-700 dark:text-gray-300">Sim</span>
                            </label>
                            <label className="flex items-center cursor-pointer">
                                <input type="radio" name="isDeposited" checked={isDeposited === false} onChange={() => setIsDeposited(false)} className="mr-2 text-blue-600 focus:ring-blue-500" />
                                <span className="text-gray-700 dark:text-gray-300">Não</span>
                            </label>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 animate-fade-in">
                                {isDeposited ? 'Quando foi depositado?' : 'Quando deve ser depositado?'} <span className="text-red-500">*</span>
                            </label>
                            <input id="investmentDate" aria-label={isDeposited ? 'Data do depósito' : 'Data prevista do depósito'} type="date" value={date} onChange={e => setDate(e.target.value)} className={commonInputClasses} required />
                        </div>
                    </div>
                </>
            );
        }

        return null;
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 transition-opacity" onClick={onClose}>
            <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="transaction-modal-title" className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-lg transition-transform transform scale-95 animate-scale-in max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-dark-100 z-10">
                    <h3 id="transaction-modal-title" ref={titleRef} tabIndex={-1} className="text-xl font-bold text-gray-800 dark:text-white outline-none">{isEditing ? 'Editar Transação' : 'Nova Transação'}</h3>
                    <button type="button" onClick={onClose} aria-label="Fechar" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                        <CloseIcon />
                    </button>
                </div>

                {investmentTrailClosed && (
                    <div className="p-6">
                        <p role="status" className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-100">
                            Este workspace já usa o domínio patrimonial oficial. Aportes e
                            resgates são registrados em <strong>Investimentos</strong>, onde
                            ficam vinculados a conta, ativo e meta — e não mais como
                            lançamento de transação.
                        </p>
                        <button
                            type="button"
                            onClick={onClose}
                            className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700"
                        >
                            Entendi
                        </button>
                    </div>
                )}

                {/* AI Entry Panel */}
                {!isEditing && !investmentTrailClosed && (
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

                {!isEditing && resolvedAllowedTypes.length > 1 && (
                    <div className="border-b border-gray-200 dark:border-gray-700">
                        <div className="flex">
                            {resolvedAllowedTypes.includes('receita') && (
                                <button
                                    onClick={() => handleTabChange('receita')}
                                    className={tabClasses('receita')}
                                    type="button"
                                >
                                    Receita
                                </button>
                            )}

                            {resolvedAllowedTypes.includes('despesa') && (
                                <button
                                    onClick={() => handleTabChange('despesa')}
                                    className={tabClasses('despesa')}
                                    type="button"
                                >
                                    Despesa
                                </button>
                            )}

                            {resolvedAllowedTypes.includes('investimento') && (
                                <button
                                    onClick={() => handleTabChange('investimento')}
                                    className={tabClasses('investimento')}
                                    type="button"
                                >
                                    Investimento
                                </button>
                            )}

                            {resolvedAllowedTypes.includes('parcelado') && (
                                <button
                                    onClick={() => handleTabChange('parcelado')}
                                    className={tabClasses('parcelado')}
                                    type="button"
                                >
                                    Cartão
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {isCatalogLoading && (
                    <div className="px-6 pt-4 text-xs font-medium text-indigo-600 dark:text-indigo-300">
                        Atualizando cadastros do workspace...
                    </div>
                )}

                {!investmentTrailClosed && <div className="p-6">
                    <form onSubmit={handleSubmit}>
                        <div className="space-y-4">
                            {renderFields()}
                        </div>
                        <div className="mt-6">
                            {submissionError && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{submissionError}</p>}
                            <button type="submit" disabled={isSubmitting || Boolean(isEditing && transactionToEdit?.investmentMetadata?.investmentOperation === 'redemption' && transactionToEdit.investmentMetadata.status !== 'pending')} className={`w-full disabled:opacity-60 text-white font-medium py-3 px-4 rounded-lg shadow-md transition-colors duration-200 ${buttonClasses[activeTab]}`}>
                                {isSubmitting
                                    ? investmentOperation === 'redemption' ? 'Salvando resgate...' : 'Salvando aporte...'
                                    : isEditing
                                        ? 'Salvar Alterações'
                                        : investmentOperation === 'redemption'
                                            ? 'Registrar Resgate'
                                            : `Revisar e Adicionar ${activeTab === 'receita' ? 'Receita' : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}`}
                            </button>
                        </div>
                    </form>
                </div>}
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
