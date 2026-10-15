import type { ReactNode } from 'react';
import type { CardPurchaseResult } from './modules/cards/callables.ts';
import type { CreditCard } from './modules/cards/types.ts';

// P4-A: modelo único de cartões (centavos), lido do backend autoritativo.
export * from './modules/cards/types.ts';
export * from './modules/reports/types.ts';
export * from './modules/notifications/types.ts';
export * from './modules/messages/types.ts';
export * from './modules/loans/types.ts';
export * from './modules/settings-catalog/types.ts';
export * from './modules/settings-catalog/types.ts';
export * from './modules/settings-catalog/display.ts';

export type { WorkspaceType } from './modules/workspaces/types.ts';

/** Tipo persistido de uma transação (contrato do documento `transactions`). */
export type TransactionType = 'receita' | 'despesa' | 'investimento';

/**
 * Aba/tipo do formulário de lançamento. `parcelado` é a aba de compra parcelada
 * no cartão (`createCreditCardPurchase`): nunca é gravada em `transactions`.
 */
export type TransactionFormType = TransactionType | 'parcelado';

export interface EntityItem {
    id: string | number;
    name: string;
    type?: string;
    icon?: string;
    iconColor?: string;
    iconStroke?: number;
    profileId?: string;
}

export interface SettingsData {
    productsServices: EntityItem[];
    expenseTypes: EntityItem[];
    categories: EntityItem[];
    paymentTypes: EntityItem[];
    incomeTypes: EntityItem[];
    costCenters: EntityItem[];
}

export interface TransactionCatalogVisualSnapshot {
    group:
    | 'product_service'
    | 'expense_type'
    | 'category'
    | 'payment_method'
    | 'income_type'
    | 'cost_center';
    label: string;
    normalizedLabel: string;
    icon?: string;
    color?: string;
    stroke?: number;
    transactionSubtype?: TransactionType;
}

export interface TransactionDisplaySnapshots {
    categorySnapshot?: TransactionCatalogVisualSnapshot;
    expenseTypeSnapshot?: TransactionCatalogVisualSnapshot;
    incomeTypeSnapshot?: TransactionCatalogVisualSnapshot;
    paymentMethodSnapshot?: TransactionCatalogVisualSnapshot;
    productServiceSnapshot?: TransactionCatalogVisualSnapshot;
    costCenterSnapshot?: TransactionCatalogVisualSnapshot;
}

/**
 * Marca backend-only do espelho de caixa de investimento (D-15, P4-D). O
 * patrimônio vive no domínio de investimentos; o espelho é só o efeito de
 * caixa: aporte liquidado sai, retirada recebida entra (principal + rendimento),
 * pendente e cancelado não movem caixa, e o estorno compensa.
 */
export interface TransactionInvestmentEntry {
    domainVersion: number;
    movementId: string;
    operation: 'contribution' | 'redemption';
    reversal: boolean;
    reversalOf: string | null;
    status: 'pending' | 'settled' | 'cancelled';
    principalCents: number;
    gainCents: number;
    amountCents: number;
    currency: 'BRL';
}

export interface Transaction {
    id: number | string;
    type: TransactionType;
    description: string;
    category: string;
    /** ID da categoria do catálogo (D-23), gravado pelo backend. */
    categoryId?: string;
    /** Magnitude em centavos inteiros (≥ 0); o sinal vem do tipo. */
    valueCents: number;
    date: string;
    cardId?: string;
    /** Conta/carteira do lançamento (D-30, P3-J), gravada só pelo backend. */
    cashAccountId?: string;
    userId?: string;
    workspaceId?: string;
    expenseType?: string;
    incomeType?: string;
    paymentMethod?: string;
    isPaid?: boolean;
    /** Vencimento do lançamento manual pendente, preservado na confirmação (D-29). */
    dueDate?: string;
    profileId?: string;
    supplier?: string;
    costCenter?: string;
    source?: string;
    /**
     * Espelho de caixa do pagamento (ou do estorno) de fatura de cartão,
     * gravado pelo backend (P4-A). Liquidação do cartão: move o saldo, nunca
     * é receita nem despesa operacional. Estornado só pela tela de cartões.
     */
    creditCardPaymentEntry?: {
        cardId: string;
        invoiceId: string;
        paymentId: string;
        reversal: boolean;
        amountCents: number;
        reversalOf?: string;
    };
    displaySnapshots?: TransactionDisplaySnapshots;
    investmentEntry?: TransactionInvestmentEntry;
    /**
     * Espelho de caixa de empréstimo gravado pelo backend (P3-G, D-13). O
     * principal e os juros não são receita nem despesa operacional.
     */
    loanEntry?: { loanId: string; loanMovementId: string; kind: string };
    /**
     * Espelho de caixa de recebimento de recebível (P3-I, D-39). O principal
     * é receita operacional; juros e multa, resultado financeiro; o desconto
     * nunca entra no caixa. Alterado só pelas callables de recebíveis.
     */
    receivableEntry?: {
        receivableId: string;
        receivableMovementId: string;
        clientId: string;
        reversal: boolean;
        principalCents: number;
        interestCents: number;
        penaltyCents: number;
        discountCents: number;
    };
    /**
     * Espelho de caixa da Divisão de contas (P4-C): despesa paga pelo Caixa
     * num título de rateio ou pagamento de reembolso PJ, e as compensações
     * (`reversal`). Despesa operacional com sinal; gravado só pelo backend.
     */
    splitEntry?: {
        kind: 'bill_expense' | 'reimbursement_payment';
        groupId: string;
        billId: string | null;
        reimbursementId: string | null;
        reversal: boolean;
        reversalOf: string | null;
        amountCents: number;
    };
    /**
     * Baixa lógica (INV-P2-032, D-35). Histórico financeiro não é apagado: a
     * anulação, feita pelo backend (`voidCashTransaction`), marca o documento,
     * que permanece disponível para auditoria e some de toda leitura do
     * produto.
     */
    voidedAt?: unknown;
    voidedBy?: string;
    voidReason?: string;
    /**
     * Marca do lançamento criado ou adotado pelo backend (P3-A/C/D). Com ela,
     * só as callables de caixa alteram o documento (as Rules negam o
     * cliente).
     */
    cashEntry?: {
        origin?: string;
        status?: string;
        channel?: string;
        [key: string]: unknown;
    };
    /** Versão do documento (Timestamp do servidor), usada como `expectedUpdatedAt`. */
    updatedAt?: unknown;
    createdAt?: unknown;
}

// --- GOALS MODULE TYPES ---

export type GoalCategory =
    | 'reserva_emergencia'
    | 'viagem'
    | 'veiculo'
    | 'imovel'
    | 'eletronicos'
    | 'educacao'
    | 'patrimonio'
    | 'outro';

export type BusinessGoalType =
    | 'caixa_minimo'
    | 'faturamento'
    | 'lucro'
    | 'margem'
    | 'reducao_custos'
    | 'investimento';

export type GoalPeriod = 'mensal' | 'trimestral' | 'semestral' | 'anual' | 'custom';

export type GoalHorizon = 'curto' | 'medio' | 'longo';

export type GoalStatus = 'em_andamento' | 'alcancada' | 'pausada' | 'cancelada';

export type GoalPriority = 'baixa' | 'media' | 'alta';

export type GoalProgressBasis = 'net_contributions' | 'current_value';

/** Única fonte do progresso da meta (P5-B, D-31). */
export type GoalProgressSource = 'manual' | 'investment' | 'business_kpi';

export interface GoalVisual {
    color: string;
    icon: string;
    emoji?: string;
    coverImage?: string;
    progressBarType: 'linear' | 'circular';
}

/**
 * Definição editável da meta: o payload de `createGoal`/`updateGoal`, igual ao
 * schema do backend (`goalDefinitionSchema`). Não carrega status nem progresso
 * manual; valores em centavos inteiros e margem em pontos-base.
 */
export interface GoalDefinition {
    name: string;
    description?: string;
    category: GoalCategory;
    priority: GoalPriority;
    startDate: string;
    deadline: string;
    horizon: GoalHorizon;
    progressSource: GoalProgressSource;
    progressBasis?: GoalProgressBasis;
    businessType?: BusinessGoalType;
    period?: GoalPeriod;
    costCenter?: string;
    targetAmountCents?: number;
    targetBasisPoints?: number;
    visual: GoalVisual;
}

/** Documento persistido `workspaces/{ws}/goals/{goalId}` (escrito só pelo backend). */
export interface Goal {
    id: string;
    name: string;
    description?: string;
    category: GoalCategory;
    status: GoalStatus;
    priority: GoalPriority;
    /** 3 = alta, 2 = média, 1 = baixa (ordenação da lista). */
    priorityRank: number;
    startDate: string;
    deadline: string;
    horizon: GoalHorizon;
    progressSource: GoalProgressSource;

    /** Toda meta, exceto margem PJ. */
    targetAmountCents?: number;
    /** Só indicador PJ de margem. */
    targetBasisPoints?: number;

    /** Só fonte `manual`. */
    manualProgressCents?: number;
    manualProgressUpdatedAt?: string;

    /** Só fonte `investment`. */
    progressBasis?: GoalProgressBasis;
    investmentNetContributionCents?: number;
    investmentCurrentValueCents?: number;
    investmentProgressCents?: number;

    businessType?: BusinessGoalType;
    period?: GoalPeriod;
    costCenter?: string;

    visual: GoalVisual;

    archived: boolean;
    archivedAt?: string;
    archiveReason?: string;
    /** Versão do domínio de metas, base do `expectedRevision`. */
    revision: number;
    statusUpdatedAt?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface SummaryCardProps {
    title: string;
    value: number;
    /** Quando presente, substitui o número formatado (estados sem valor: "—"). */
    displayValue?: string;
    trend: string;
    icon: ReactNode;
    color: 'blue' | 'green' | 'red' | 'indigo' | 'purple';
    isClickable?: boolean;
    onClick?: () => void;
}

export interface IconProps {
    className?: string;
    title?: string;
    [key: string]: any;
}


export interface TransactionModalProps {
    isOpen: boolean;
    onClose: () => void;
    /**
     * Compra manual no cartão (P4-A): só a callable `createCreditCardPurchase`,
     * com o payload estrito (valor total em centavos) e a chave da intenção.
     */
    onAddCreditCardPurchase?: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<CardPurchaseResult>;
    /**
     * Lançamento manual pela callable autoritativa (P3-E). O payload já está
     * no contrato estrito; a chave é da intenção. P4-D: não existe caminho de
     * escrita direta em `transactions` — estas callables são o único destino.
     */
    onCreateManualTransaction: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<void>;
    /** Correção autoritativa (P3-E, D-35): estado completo, versão lida e motivo. */
    onUpdateManualTransaction: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<void>;
    /** Confirmação de pendente (P3-F, D-29): `confirmCashTransaction`. */
    onConfirmManualTransaction: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<void>;
    transactionToEdit?: Transaction | null;
    defaultType?: TransactionFormType | null;
    currentDate: Date;
    creditCards?: CreditCard[];
    allowedTypes?: TransactionFormType[] | null;
    transactions?: Transaction[];
}

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
    primary: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    success: string;
    error: string;
    warning: string;
    info: string;
    chartIncome: string;
    chartExpense: string;
    chartInvestment: string;
    chartInstallment: string;
}

export interface ThemeLayout {
    borderRadius: number;
    density: 'compact' | 'comfortable' | 'spacious';
    sidebarWidth: number;
}

export interface ThemeIcons {
    pack: 'lucide' | 'phosphor' | 'tabler';
    size: number;
    strokeWidth: number;
}

export type SoundKey = 'click' | 'success' | 'error' | 'notification';

export interface ThemeSounds {
    enabled: boolean;
    volume: number;
    pack: 'minimal' | 'digital' | 'classic';
    mapping: Record<SoundKey, string | null>;
}

export interface ThemeEffects {
    enableSounds: boolean;
    enableAnimations: boolean;
}

export interface ThemeGoals {
    density: 'compact' | 'comfortable';
    showCover: boolean;
    showEmoji: boolean;
    showBadges: boolean;
}

export interface ThemeSplitGroups {
    defaultViewMode: 'card' | 'list';
    density: 'compact' | 'comfortable';
}

export interface AppTheme {
    id: string;
    name: string;
    mode: ThemeMode;
    colors: ThemeColors;
    layout: ThemeLayout;
    icons: ThemeIcons;
    sounds: ThemeSounds;
    effects: ThemeEffects;
    goals: ThemeGoals;
    splitGroups: ThemeSplitGroups;
}

export interface AppNotification {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error' | 'invite' | 'credit_card';
    link?: string;
    actionLabel?: string;
    createdAt: string;

    workspaceId?: string;
    source?: string;
    domain?: 'credit_card' | string;
    domainEventId?: string;
    domainEventType?: string;
    cardId?: string;
    invoiceId?: string;
    purchaseId?: string;
    paymentId?: string;
    ledgerEntryId?: string;
    actorId?: string;
}
