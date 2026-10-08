import { extractTransactionFromDocument, extractTransactionFromText } from '../modules/ai/api';
import { aiCreditsExhaustedMessage, isAiCreditsExhausted } from '../modules/ai/callables';
import { readFileAsBase64 } from '../modules/ai/documentFile';

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
import CashAccountSelect from './accounts/CashAccountSelect.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useTransactionCatalogOptions } from '../modules/settings-catalog/useTransactionCatalogOptions.ts';
import SimpleInvestmentForm from '../modules/investments/simple/components/SimpleInvestmentForm.tsx';
import {
    useCreateSettingsCatalogItem,
    useCatalogIntentKey,
} from '../modules/settings-catalog/hooks.ts';
import {
    buildCreateCatalogPayload,
    categorySubtypeForTransactionType,
    isSettingsCatalogDuplicateError,
    settingsCatalogPermissions,
} from '../modules/settings-catalog/callables.ts';
import { normalizeSettingsCatalogName } from '../modules/settings-catalog/utils.ts';
import {
    CashEntryInputError,
    cashErrorView,
    isManualCashEntryCandidate,
    isPendingCashEntry,
    REASON_MAX_LENGTH,
    resolveIntentKey,
    toConfirmCashPayload,
    toCreateCashPayload,
    toUpdateCashPayload,
    type IntentKey,
    type ManualEntryForm,
} from '../modules/transactions/cashEntry.ts';
import { newIdempotencyKey } from '../modules/workspaces/callables.ts';
import { formatCents, formatDayKey, saoPauloToday } from '../modules/loans/money.ts';
import { formatCompetence } from '../modules/cards/cycle.ts';
import { purchasePreview, toCreateCardPurchasePayload } from '../modules/cards/payloads.ts';
import { RETROACTIVE_WARNING, cardsErrorView } from '../modules/cards/presentation.ts';

interface SubmitRoute {
    authoritative: boolean;
    /** Compra no cartão (P4-A): erro do domínio de cartões. */
    cardPurchase: boolean;
}

/**
 * O produto/serviço digitado não pôde entrar no catálogo (só administradores
 * cadastram itens novos, ou houve falha de rede). Antes, a falha ficava sem
 * aviso e o envio parecia não acontecer.
 */
class CatalogEntryError extends Error {}

const NOT_EDITABLE_MESSAGE =
    'Este lançamento é gerado por outro módulo e só pode ser alterado por ele.';

const CATALOG_ENTRY_MESSAGE =
    'Não foi possível cadastrar este produto ou serviço no catálogo. Escolha um item já cadastrado ' +
    'ou tente de novo; itens novos só podem ser cadastrados por administradores do espaço.';

interface ExtendedTransactionModalProps extends TransactionModalProps {
    goals?: Goal[];
    defaultGoalId?: string | null;
    /**
     * Feedback do aporte criado pela aba "Investimento".
     *
     * É o `showNotification` do `App.tsx` — o mesmo mecanismo que as
     * transações comuns já usam. A aba nova não traz sistema de aviso próprio.
     */
    onInvestmentSuccess?: (message: string) => void;
}

const TransactionModal: React.FC<ExtendedTransactionModalProps> = ({
    isOpen,
    onClose,
    onAddCreditCardPurchase,
    onCreateManualTransaction,
    onUpdateManualTransaction,
    onConfirmManualTransaction,
    transactionToEdit,
    defaultType,
    allowedTypes = null,
    currentDate,
    creditCards = [],
    goals = [],
    transactions = [],
    defaultGoalId = null,
    onInvestmentSuccess,
}) => {
    const { activeWorkspace, activeWorkspaceRole } = useWorkspace();
    const canManageCatalog = settingsCatalogPermissions(activeWorkspaceRole).canManage;
    const isPJ = activeWorkspace.type === 'PJ';
    const createCatalogItemMutation = useCreateSettingsCatalogItem();
    const catalogIntent = useCatalogIntentKey();
    const modalRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);


    const isEditing = !!transactionToEdit;
    const [activeTab, setActiveTab] = useState<TransactionType>('receita');
    /*
     * Envio autoritativo (P3-E). `submittingRef` barra o segundo clique antes
     * do próximo render; `intentRef` guarda a chave da intenção para que o
     * reenvio do mesmo conteúdo, depois de uma falha, use a mesma chave.
     */
    const submittingRef = useRef(false);
    const intentRef = useRef<IntentKey | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [editReason, setEditReason] = useState('');
    /*
     * Aporte e resgate não são lançamento de transação.
     *
     * O patrimônio é o ledger `investment_movements`, e é ele que projeta o
     * espelho de caixa em `transactions`. Um aporte gravado por aqui sairia do
     * caixa e nunca chegaria ao patrimônio.
     *
     * A aba "Investimento" existe de novo porque o ponto de entrada é o que a
     * pessoa procura, e ele estava só dentro de Investimentos. O que **não**
     * voltou é a escrita antiga: a aba não conhece `transactions` (o cliente
     * não escreve nela, P4-D). Ela monta o mesmo `SimpleInvestmentForm` da
     * tela de Investimentos, cujo único destino é `createSimpleInvestment`.
     *
     * Só na criação. Editar uma transação continua restrito ao tipo do
     * documento aberto: espelho de investimento não é editável como transação
     * comum, e transação comum não vira aporte.
     */
    const resolvedAllowedTypes = useMemo<TransactionType[]>(() => {
        if (isEditing && transactionToEdit) {
            return [transactionToEdit.type];
        }

        if (allowedTypes && allowedTypes.length > 0) {
            return allowedTypes;
        }

        if (defaultType) {
            return [defaultType];
        }

        return ['receita', 'despesa', 'investimento', 'parcelado'];
    }, [allowedTypes, defaultType, isEditing, transactionToEdit]);

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

    // Conta/carteira do lançamento manual (D-30, P3-J).
    const [cashAccountId, setCashAccountId] = useState('');

    // New States for Advanced Parcelado Logic
    const [selectedCardId, setSelectedCardId] = useState<string>('');
    const [valueType, setValueType] = useState<'total' | 'installment'>('total');
    const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);

    /*
     * Envio de aporte em curso na aba "Investimento".
     *
     * O formulário simples desabilita o próprio botão, mas quem fecha esta
     * modal é a moldura — X, fundo e Escape — e quem a troca de conteúdo é a
     * faixa de abas. Fechar ou trocar no meio da chamada desmonta o
     * formulário, e o erro da mutation morre com ele: a pessoa fica sem saber
     * se o aporte entrou. `NewInvestmentModal` já trava o fechamento por este
     * mesmo sinal; a aba passa a travar também.
     *
     * O espelho em `ref` existe porque o ouvinte de Escape é registrado uma
     * vez por abertura e leria um valor congelado do estado.
     */
    const [investmentPending, setInvestmentPending] = useState(false);
    const investmentPendingRef = useRef(false);
    const activeTabRef = useRef<TransactionType>(activeTab);

    useEffect(() => {
        investmentPendingRef.current = investmentPending;
    }, [investmentPending]);

    useEffect(() => {
        activeTabRef.current = activeTab;
    }, [activeTab]);

    const requestClose = () => {
        if (investmentPendingRef.current) return;
        onClose();
    };

    useEffect(() => {
        if (!isOpen) return;
        previousFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        requestAnimationFrame(() => titleRef.current?.focus());
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') requestClose();
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

        // D-23: só owner/admin cadastram; o backend confere o papel de novo.
        if (!canManageCatalog) {
            throw new CatalogEntryError(CATALOG_ENTRY_MESSAGE);
        }

        try {
            const payload = buildCreateCatalogPayload(activeWorkspace.id, {
                group: 'product_service',
                name: trimmed,
            });
            await createCatalogItemMutation.mutateAsync({
                payload,
                idempotencyKey: catalogIntent.keyFor('createSettingsCatalogItem', payload),
            });

            return trimmed;
        } catch (error) {
            if (isSettingsCatalogDuplicateError(error)) {
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

    const selectedCreditCardForPurchase = useMemo(
        () => creditCards.find((card) => String(card.id) === selectedCardId),
        [creditCards, selectedCardId],
    );

    /*
     * Prévia da compra no cartão (P4-A), em centavos: total exato, parcelas
     * pelo maior resto, primeira fatura pela regra D-36 (data de fatura já
     * fechada vai para a primeira aberta) e o limite disponível autoritativo.
     * Só exibe: quem decide é o backend.
     */
    const creditCardPurchasePreview = useMemo(() => {
        if (activeTab !== 'parcelado' || !selectedCreditCardForPurchase) {
            return null;
        }
        return purchasePreview({
            card: selectedCreditCardForPurchase,
            value,
            installments,
            valueType,
            purchaseDate,
            today: saoPauloToday(),
        });
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
    // A aba Parcelado é compra no cartão: usa as categorias de despesa (D-23).
    const getCategoryOptions = (type: TransactionType) => {
        const subtype = categorySubtypeForTransactionType(type);
        return mergedSettingsCategories.filter((c) => c.type === subtype);
    };

    useEffect(() => {
        if (!isOpen) return;

        // Cada abertura é uma intenção nova.
        intentRef.current = null;
        submittingRef.current = false;
        setIsSubmitting(false);
        setSubmitError(null);
        setEditReason('');

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
            // Todo produtor grava `isPaid`; só `false` é pendente.
            setIsPaid(transactionToEdit.isPaid !== false);
            // Conta do lançamento; sem conta preenchida, a escolha é explícita.
            setCashAccountId(transactionToEdit.cashAccountId ?? '');
            if (transactionToEdit.cardId) setSelectedCardId(String(transactionToEdit.cardId));

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
            setSupplier('');
            setCostCenter('');

            setCategory('');
            setExpenseType('');
            setIncomeType('');
            setPaymentMethod('');
            setSelectedCardId('');
            setValueType('total');
            setCashAccountId('');
        }
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
        // Um aporte em curso não pode ter o próprio formulário desmontado por
        // uma troca de aba: a chamada seguiria viva sem ninguém para mostrar
        // o resultado.
        if (investmentPendingRef.current) return;

        setActiveTab(newTab);

        /*
         * A aba de investimento tem estado próprio e catálogos próprios. Trocar
         * para ela não prepara, não limpa e não envia nada do formulário comum
         * — e voltar dela reencontra o formulário comum como estava.
         */
        if (newTab === 'investimento') {
            /*
             * A captura por voz não vive no painel de IA: o reconhecedor é do
             * componente. Esconder o painel deixaria o microfone aberto sem
             * botão de parar e, pior, o resultado chamaria `applyAIData`, que
             * troca a aba de volta e desmontaria o aporte meio preenchido.
             */
            recognitionRef.current?.stop();
            return;
        }

        const catOptions = getCategoryOptions(newTab);
        setCategory(catOptions.length > 0 ? catOptions[0].name : '');

        if (newTab !== 'despesa') {
            setExpenseType('');
            setPaymentMethod('');
        }

        if (newTab !== 'receita') {
            setIncomeType('');
        }
    };

    // --- AI LOGIC: Common Form Pre-filler ---
    const applyAIData = (data: any) => {
        if (!data) return;
        /*
         * Um resultado de voz ou de imagem que chega depois de a pessoa ter ido
         * para a aba de investimento não pode arrastá-la de volta nem
         * sobrescrever o formulário comum pelas costas. O `ref` é lido porque
         * quem chama esta função é um callback preso ao instante em que a
         * captura começou.
         */
        if (activeTabRef.current === 'investimento') return;
        if (data.type && (['receita', 'despesa', 'parcelado'].includes(data.type))) {
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

    // Créditos de IA esgotados (P2B.2) têm mensagem própria, mais longa.
    const showAIError = (error: unknown, fallback: string) => {
        const exhausted = isAiCreditsExhausted(error);
        setAIStatus(exhausted ? aiCreditsExhaustedMessage(error) : fallback);
        setTimeout(() => setAIStatus(null), exhausted ? 6000 : 3000);
    };

    // --- AI LOGIC: Document Analysis ---
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsAILoading(true);
        setAIStatus("Analisando comprovante...");

        // Leitura e chamada são aguardadas aqui: o carregamento e os botões de
        // IA só voltam no `finally`, depois do fim real da extração. Um único
        // `catch` cobre erro de leitura, da callable e créditos esgotados.
        try {
            const base64Data = await readFileAsBase64(file);
            // A extração roda no backend: a chave do modelo nunca chega ao
            // navegador. Antes, `vite.config.ts` injetava a credencial real
            // no bundle servido a qualquer visitante. Cada envio é uma
            // ação nova, com chave de idempotência própria.
            const response = await extractTransactionFromDocument({
                workspaceId: activeWorkspace.id,
                mimeType: file.type,
                dataBase64: base64Data,
            });
            const result = response.extracted ?? {};
            applyAIData(result);
            setAIStatus("Comprovante lido com sucesso!");
            setTimeout(() => setAIStatus(null), 3000);
        } catch (error) {
            console.error("AI Document Scan Error:", error);
            showAIError(error, "Erro ao analisar documento.");
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
                const response = await extractTransactionFromText({
                    workspaceId: activeWorkspace.id,
                    transcript,
                });
                const result = response.extracted ?? {};
                applyAIData(result);
                setAIStatus("Entendido! Revise os dados preenchidos.");
                setTimeout(() => setAIStatus(null), 3000);
            } catch (error) {
                console.error("AI Voice Interpretation Error:", error);
                showAIError(error, "Não consegui entender muito bem. Tente novamente.");
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

    /*
     * Operações pela callable autoritativa (P3-E, P3-F): receita ou despesa
     * manual, pendente ou confirmada, sem vínculo com outro domínio.
     * - pendente marcado como pago/recebido: confirmação (data efetiva e valor
     *   liquidado; vencimento preservado), sem motivo;
     * - pendente que segue pendente, ou confirmado que segue confirmado:
     *   correção, com motivo (D-35);
     * - confirmado não volta a pendente.
     */
    const editRoutesToCash = isEditing && !!transactionToEdit &&
        (activeTab === 'receita' || activeTab === 'despesa') &&
        isManualCashEntryCandidate(transactionToEdit);
    const storedPending = editRoutesToCash && isPendingCashEntry(transactionToEdit);
    const confirmingPending = storedPending && isPaid;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();

        /*
         * Guarda de contrato. O formulário comum nem chega a ser renderizado na
         * aba de investimento: o aporte é só do `SimpleInvestmentForm`.
         */
        if (activeTab === 'investimento') return;
        // Segundo clique durante o envio: ignorado.
        if (submittingRef.current) return;
        submittingRef.current = true;
        setIsSubmitting(true);
        setSubmitError(null);
        const route: SubmitRoute = { authoritative: false, cardPurchase: false };
        try {
            await submitTransaction(route);
        } catch (error) {
            // Caminho autoritativo: o erro fica no modal, que segue aberto para
            // revisar ou reenviar o mesmo conteúdo (com a mesma chave). Nos
            // demais caminhos o `App` já avisou.
            if (error instanceof CatalogEntryError) setSubmitError(error.message);
            else if (route.cardPurchase) setSubmitError(cardsErrorView(error).message);
            else if (route.authoritative) setSubmitError(cashErrorView(error).message);
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
        }
    };

    const submitTransaction = async (route: SubmitRoute) => {
        let resolvedDescription = description;

        if (activeTab === 'despesa' || activeTab === 'parcelado') {
            try {
                resolvedDescription = await ensureProductServiceValue(description);
            } catch {
                throw new CatalogEntryError(CATALOG_ENTRY_MESSAGE);
            }
            setDescription(resolvedDescription);
        }

        if (activeTab === 'parcelado' && !isEditing) {
            /*
             * Compra manual no cartão (P4-A): só a callable
             * `createCreditCardPurchase`. Nenhum lançamento `parcelado` é
             * criado aqui e não há caminho alternativo. O valor total vai em
             * centavos; parcelas, faturas, origem e limite são do backend. A
             * chave é da intenção: o mesmo conteúdo reenviado depois de uma
             * falha ou resposta incerta reusa a chave.
             */
            route.authoritative = true;
            route.cardPurchase = true;
            if (!onAddCreditCardPurchase) {
                throw new Error('Compra no cartão indisponível neste contexto.');
            }
            const payload = toCreateCardPurchasePayload({
                cardId: selectedCardId,
                description: resolvedDescription,
                category: category || 'Sem categoria',
                supplier: isPJ ? supplier : undefined,
                costCenter: isPJ ? costCenter : undefined,
                purchaseDate,
                value,
                installments,
                valueType,
            }, activeWorkspace.id);
            const intent = resolveIntentKey(
                intentRef.current, 'createCreditCardPurchase', payload, newIdempotencyKey,
            );
            intentRef.current = intent;
            await onAddCreditCardPurchase(payload, intent.key);
            intentRef.current = null;
            onClose();
            return;
        }

        // P4-C (PR-TX-06): parcela e cartão nunca vão para `transactions` — a
        // compra parcelada é do domínio de cartões (callable acima).
        const isManualTab = activeTab === 'receita' || activeTab === 'despesa';
        const manualForm: ManualEntryForm = {
            type: activeTab === 'receita' ? 'receita' : 'despesa',
            description: resolvedDescription,
            category,
            amount: value,
            date,
            incomeType,
            expenseType,
            paymentMethod,
            supplier: isPJ ? supplier : undefined,
            costCenter: isPJ ? costCenter : undefined,
            isPaid,
            cashAccountId,
        };

        if (isEditing) {
            if (editRoutesToCash && !storedPending && !isPaid) {
                // Confirmado não volta a pendente (D-29).
                route.authoritative = true;
                throw new CashEntryInputError(
                    'Este lançamento já está confirmado e não pode voltar a pendente por aqui.',
                );
            }
            if (confirmingPending) {
                route.authoritative = true;
                const payload = toConfirmCashPayload(manualForm, {
                    workspaceId: activeWorkspace.id,
                    isPJ,
                    transactionId: String(transactionToEdit.id),
                    updatedAt: transactionToEdit.updatedAt,
                    stored: transactionToEdit as unknown as Record<string, unknown>,
                });
                const intent = resolveIntentKey(
                    intentRef.current, 'confirmCashTransaction', payload, newIdempotencyKey,
                );
                intentRef.current = intent;
                await onConfirmManualTransaction(payload, intent.key);
            } else if (editRoutesToCash) {
                route.authoritative = true;
                const payload = toUpdateCashPayload(manualForm, {
                    workspaceId: activeWorkspace.id,
                    isPJ,
                    transactionId: String(transactionToEdit.id),
                    updatedAt: transactionToEdit.updatedAt,
                    reason: editReason,
                });
                const intent = resolveIntentKey(
                    intentRef.current, 'updateCashTransaction', payload, newIdempotencyKey,
                );
                intentRef.current = intent;
                await onUpdateManualTransaction(payload, intent.key);
            } else {
                // P4-D: lançamento de outro módulo não é editável aqui, e não
                // existe escrita direta em `transactions` como alternativa.
                route.authoritative = true;
                throw new CashEntryInputError(NOT_EDITABLE_MESSAGE);
            }
        } else if (isManualTab) {
            // Confirmado ou pendente/agendado (D-29): sempre pela callable.
            route.authoritative = true;
            const payload = toCreateCashPayload(manualForm, {
                workspaceId: activeWorkspace.id,
                isPJ,
            });
            const intent = resolveIntentKey(
                intentRef.current, 'createCashTransaction', payload, newIdempotencyKey,
            );
            intentRef.current = intent;
            await onCreateManualTransaction(payload, intent.key);
        } else {
            route.authoritative = true;
            throw new CashEntryInputError(NOT_EDITABLE_MESSAGE);
        }

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

    /*
     * Na confirmação de um pendente, a data do formulário passa a ser a data
     * efetiva; o vencimento continua registrado e é mostrado aqui, para não
     * confundir os dois (D-29).
     */
    /*
     * Conta/carteira (D-30, P3-J): só no fluxo das callables de caixa — novo
     * lançamento manual ou correção/confirmação de um elegível. Na criação, a
     * primeira conta ativa já vem escolhida; sem conta preenchida, a escolha é
     * explícita (o formulário nunca supõe uma conta).
     */
    const showAccountField = !isEditing || editRoutesToCash;
    const renderAccountField = (fieldId: string) => (showAccountField ? (
        <CashAccountSelect
            id={fieldId}
            label="Conta/carteira"
            requiredMark={<> <span className="text-red-500">*</span></>}
            value={cashAccountId}
            onChange={setCashAccountId}
            autoSelect={!isEditing}
            labelClassName="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            selectClassName={commonInputClasses}
            hintClassName="text-xs text-gray-500 dark:text-gray-400 mt-1"
        />
    ) : null);

    const renderDueDateHint = (verb: 'paga' | 'recebida') => {
        const dueDate = transactionToEdit?.dueDate ?? transactionToEdit?.date;
        if (!confirmingPending || !dueDate) return null;
        const [year, month, day] = dueDate.split('-');
        return (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Vencimento: {day}/{month}/{year}. Informe a data em que foi {verb}.
            </p>
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
                            <div data-testid="card-purchase-preview" className={`mt-3 rounded-lg border p-3 text-xs ${creditCardPurchasePreview.insufficientLimit
                                ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
                                : 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300'
                                }`}>
                                <p className="font-bold mb-2">
                                    Prévia antes de confirmar
                                </p>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <div>
                                        <p className="opacity-75">Primeira fatura</p>
                                        <p className="font-bold">{formatCompetence(creditCardPurchasePreview.firstCompetence)}</p>
                                    </div>

                                    <div>
                                        <p className="opacity-75">Vencimento previsto</p>
                                        <p className="font-bold">
                                            {formatDayKey(creditCardPurchasePreview.firstDueDate)}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="opacity-75">Valor total da compra</p>
                                        <p className="font-bold">{formatCents(creditCardPurchasePreview.totalCents)}</p>
                                    </div>

                                    <div>
                                        <p className="opacity-75">Valor da parcela</p>
                                        <p className="font-bold">
                                            {creditCardPurchasePreview.firstInstallmentCents === creditCardPurchasePreview.otherInstallmentCents
                                                ? `${formatCents(creditCardPurchasePreview.firstInstallmentCents)} em ${creditCardPurchasePreview.installmentsCount}x`
                                                : `${formatCents(creditCardPurchasePreview.firstInstallmentCents)} na 1ª e ${formatCents(creditCardPurchasePreview.otherInstallmentCents)} nas demais (${creditCardPurchasePreview.installmentsCount}x)`}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="opacity-75">Limite disponível atual</p>
                                        <p className="font-bold">{formatCents(creditCardPurchasePreview.availableCents)}</p>
                                    </div>

                                    <div>
                                        <p className="opacity-75">Limite após a compra</p>
                                        <p className="font-bold">{formatCents(creditCardPurchasePreview.availableAfterCents)}</p>
                                    </div>
                                </div>

                                {creditCardPurchasePreview.retroactiveTarget && (
                                    <p className="mt-2 font-medium" data-testid="card-purchase-retroactive-warning">
                                        {RETROACTIVE_WARNING(creditCardPurchasePreview.retroactiveTarget)}
                                    </p>
                                )}
                                <p className="mt-2 font-medium">
                                    {creditCardPurchasePreview.insufficientLimit
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
                    {/*
                      D-29 (P3-F): receita recebida (data efetiva, até hoje) ou a
                      receber (vencimento, inclusive futuro). Mesmo padrão do
                      bloco "Essa despesa já foi paga?".
                    */}
                    {renderAccountField('transaction-income-account')}
                    <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        <label id="transaction-income-settled" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Essa receita já foi recebida?
                        </label>
                        <div role="radiogroup" aria-labelledby="transaction-income-settled" className="flex gap-4 mb-3">
                            <label className="flex items-center cursor-pointer">
                                <input type="radio" name="isReceived" checked={isPaid === true} onChange={() => setIsPaid(true)} className="mr-2 text-green-600 focus:ring-green-500" />
                                <span className="text-gray-700 dark:text-gray-300">Sim</span>
                            </label>
                            <label className="flex items-center cursor-pointer">
                                <input type="radio" name="isReceived" checked={isPaid === false} onChange={() => setIsPaid(false)} className="mr-2 text-green-600 focus:ring-green-500" />
                                <span className="text-gray-700 dark:text-gray-300">Não</span>
                            </label>
                        </div>
                        <div>
                            <label htmlFor="transaction-income-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 animate-fade-in">
                                {isPaid ? 'Quando foi recebida?' : 'Quando deve ser recebida?'} <span className="text-red-500">*</span>
                            </label>
                            <input id="transaction-income-date" type="date" value={date} onChange={e => setDate(e.target.value)} className={commonInputClasses} required />
                            {renderDueDateHint('recebida')}
                        </div>
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
                    {renderAccountField('transaction-expense-account')}
                    <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        <label id="transaction-expense-settled" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Essa despesa já foi paga?
                        </label>
                        <div role="radiogroup" aria-labelledby="transaction-expense-settled" className="flex gap-4 mb-3">
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
                            <label htmlFor="transaction-expense-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 animate-fade-in">
                                {isPaid ? 'Quando foi pago?' : 'Quando deve ser pago?'} <span className="text-red-500">*</span>
                            </label>
                            <input id="transaction-expense-date" type="date" value={date} onChange={e => setDate(e.target.value)} className={commonInputClasses} required />
                            {renderDueDateHint('paga')}
                        </div>
                    </div>
                </>
            );
        }

        return null;
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 transition-opacity" onClick={requestClose}>
            <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="transaction-modal-title" className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-lg transition-transform transform scale-95 animate-scale-in max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-dark-100 z-10">
                    <h3 id="transaction-modal-title" ref={titleRef} tabIndex={-1} className="text-xl font-bold text-gray-800 dark:text-white outline-none">{isEditing ? 'Editar Transação' : 'Nova Transação'}</h3>
                    <button type="button" onClick={requestClose} disabled={investmentPending} aria-label="Fechar" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50">
                        <CloseIcon />
                    </button>
                </div>

                {/*
                  Assistente de IA (§5).

                  Ele preenche exclusivamente o formulário comum —
                  `applyAIData` escreve descrição, valor, data, parcelas,
                  fornecedor e categoria de transação. Na aba de investimento
                  esses campos não existem, e deixá-lo visível ofereceria um
                  preenchimento que cairia num estado que ninguém vê. Nada de
                  IA/OCR/voz mudou para receita, despesa e cartão.
                */}
                {!isEditing && activeTab !== 'investimento' && (
                    <div className="p-4 bg-indigo-50 dark:bg-indigo-900/10 border-b border-indigo-100 dark:border-indigo-900/30 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <SparklesIcon className="text-indigo-600 h-4 w-4" />
                                <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-widest">Assistente de Preenchimento IA</span>
                            </div>
                            {aiStatus && (
                                <span role="status" aria-live="polite" className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full animate-pulse">{aiStatus}</span>
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

                {isCatalogLoading && activeTab !== 'investimento' && (
                    <div className="px-6 pt-4 text-xs font-medium text-indigo-600 dark:text-indigo-300">
                        Atualizando cadastros do workspace...
                    </div>
                )}

                <div className="p-6">
                    {/*
                      Um formulário ou o outro, nunca os dois: `SimpleInvestmentForm`
                      traz o seu próprio `<form>` e o seu próprio botão, e aninhá-lo
                      no formulário comum seria HTML inválido além de deixar o submit
                      de transação alcançável a partir do aporte.
                    */}
                    {activeTab === 'investimento' ? (
                        <SimpleInvestmentForm
                            open={isOpen}
                            workspaceId={activeWorkspace.id}
                            goals={goals}
                            initialGoalId={defaultGoalId}
                            idPrefix="transaction-investment"
                            onPendingChange={setInvestmentPending}
                            onClose={onClose}
                            onSuccess={(message) => onInvestmentSuccess?.(message)}
                        />
                    ) : (
                        <form onSubmit={handleSubmit}>
                            <div className="space-y-4">
                                {renderFields()}
                                {editRoutesToCash && !confirmingPending && (
                                    <div>
                                        <label htmlFor="transaction-edit-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            Motivo da correção <span className="text-red-500">*</span>
                                        </label>
                                        <textarea
                                            id="transaction-edit-reason"
                                            value={editReason}
                                            onChange={(event) => setEditReason(event.target.value)}
                                            maxLength={REASON_MAX_LENGTH}
                                            rows={2}
                                            required
                                            className={commonInputClasses}
                                        />
                                    </div>
                                )}
                            </div>
                            {submitError && (
                                <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
                                    {submitError}
                                </p>
                            )}
                            <div className="mt-6">
                                <button type="submit" disabled={isSubmitting} aria-busy={isSubmitting} className={`w-full disabled:opacity-60 text-white font-medium py-3 px-4 rounded-lg shadow-md transition-colors duration-200 ${buttonClasses[activeTab]}`}>
                                    {confirmingPending
                                        ? (activeTab === 'receita' ? 'Confirmar recebimento' : 'Confirmar pagamento')
                                        : isEditing
                                        ? 'Salvar Alterações'
                                        : `Revisar e Adicionar ${activeTab === 'receita' ? 'Receita' : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}`}
                                </button>
                            </div>
                        </form>
                    )}
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
