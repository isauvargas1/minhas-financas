import type { ReactNode } from 'react';
import type {
    CompetenceMonth,
    CreditCardBillingCycleStatus,
    CreditCardInvoiceStatus,
} from './modules/credit-cards/domain/types.ts';

export * from './modules/credit-cards/domain/types.ts';
export * from './modules/recurring-expenses/types.ts';
export * from './modules/reports/types.ts';
export * from './modules/notifications/types.ts';
export * from './modules/messages/types.ts';
export * from './modules/loans/types.ts';
export * from './modules/settings-catalog/types.ts';
export * from './modules/settings-catalog/types.ts';
export * from './modules/settings-catalog/display.ts';

export type WorkspaceType = 'PF' | 'PJ';

export interface Workspace {
    id: string;
    userId: string;
    ownerId: string;
    type: WorkspaceType;
    name: string;
    slug?: string;
    cnpj?: string | null;
    
    logoUrl?: string;
    themeColor?: string;
    currency?: string;
    pjAccentColor?: string;
    alertPreferences?: {
        billing: boolean;
        accountsPayable: boolean;
        delinquency: boolean;
        lowMargin: boolean;
    };
    createdAt: string;
    updatedAt: string;
}

export type TransactionType = 'receita' | 'despesa' | 'investimento' | 'parcelado';

export type Category = {
    receita: Array<'Salário' | 'Honorários' | 'Venda de Produto' | 'Reembolso' | 'Dividendos' | 'Outros'>;
    despesa: Array<'Alimentação' | 'Moradia' | 'Transporte' | 'Saúde' | 'Educação' | 'Lazer' | 'Utilidades' | 'Comunicação' | 'Outros'>;
    investimento: Array<'Ações' | 'Fundos Imobiliários' | 'Tesouro Direto' | 'CDB' | 'Poupança' | 'Outros'>;
    parcelado: Array<'Eletrônicos' | 'Eletrodomésticos' | 'Móveis' | 'Vestuário' | 'Outros'>;
};

export interface EntityItem {
    id: number;
    name: string;
    type?: string;
    icon?: string;
    iconColor?: string;
    iconStroke?: number;
    profileId?: string;
}

export interface CreditCard {
    id: string;
    workspaceId?: string;

    name: string;
    brand: string;
    status: 'active' | 'blocked' | 'cancelled';

    limitTotal: number;
    limitAvailable?: number;
    limitUsed?: number;

    closingDay: number;
    dueDay: number;
    bestDay?: number;
    billingCycleStatus?: CreditCardBillingCycleStatus;

    observations?: string;
    visual: {
        bgType: 'color' | 'gradient' | 'image';
        bgColor: string;
        bgGradientColor?: string;
        bgImage?: string;
        textColor: 'white' | 'black';
        showName: boolean;
        showBrand: boolean;
        showLogo: boolean;
    };

    profileId?: string;
    responsiblePerson?: string;
    recommendedUse?: string;
    defaultCostCenter?: string;

    createdAt?: unknown;
    updatedAt?: unknown;
}

export interface SettingsData {
    productsServices: EntityItem[];
    expenseTypes: EntityItem[];
    categories: EntityItem[];
    paymentTypes: EntityItem[];
    incomeTypes: EntityItem[];
    wallets: EntityItem[];
    costCenters: EntityItem[];
}

export interface TransactionCatalogVisualSnapshot {
    group:
        | 'product_service'
        | 'expense_type'
        | 'category'
        | 'payment_method'
        | 'income_type'
        | 'wallet'
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
    walletSnapshot?: TransactionCatalogVisualSnapshot;
    costCenterSnapshot?: TransactionCatalogVisualSnapshot;
}

export interface TransactionCreditCardCompatibility {
    source: 'credit_card_invoice';
    invoiceId: string;
    cardId: string;
    competenceMonth: CompetenceMonth;
    invoiceStatus: CreditCardInvoiceStatus;
    isProjection: true;
}

export interface Transaction {
    id: number | string;
    type: TransactionType;
    description: string;
    category: string;
    value: number;
    date: string;
    installments?: number;
    currentInstallment?: number;
    cardId?: string;
    walletId?: number;
    userId?: string;
    workspaceId?: string;
    goalId?: string;
    loanId?: string;
    loanMovementId?: string;
    expenseType?: string;
    incomeType?: string;
    paymentMethod?: string;
    isPaid?: boolean;
    profileId?: string;
    supplier?: string;
    costCenter?: string;
    source?: string;
    creditCardInvoiceId?: string;
    creditCardInvoicePaymentId?: string;
    creditCardCompatibility?: TransactionCreditCardCompatibility;
    displaySnapshots?: TransactionDisplaySnapshots;
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

export interface Goal {
    id: string;
    name: string;
    description?: string;
    category: GoalCategory;
    status: GoalStatus;
    priority: GoalPriority;
    
    targetAmount: number;
    currentAmount: number;
    startDate: string;
    deadline: string;
    horizon: GoalHorizon;
    
    businessType?: BusinessGoalType;
    period?: GoalPeriod;
    costCenter?: string;
    isAutomatic?: boolean;

    visual: {
        color: string;
        icon: string;
        emoji?: string;
        coverImage?: string;
        progressBarType: 'linear' | 'circular';
    };

    createdAt: string;
    updatedAt: string;
    profileId?: string;
}

// --- SHARED EXPENSES MODULE TYPES (Split Bills) ---

export type SplitGroupType = 'fixo' | 'temporario';
export type SplitBillValueType = 'fixo' | 'variavel';
export type SplitBillPaymentStatus = 'pendente' | 'parcialmentePago' | 'pago' | 'cancelado' | 'aprovado' | 'solicitado';

export type SplitBillPaymentMethod =
  | 'dinheiro'
  | 'pix'
  | 'transferencia'
  | 'cartaoCredito'
  | 'outro';

export type SplitShareStatus =
  | 'aPagar'
  | 'pagoAoPagadorPrincipal'
  | 'pagoDireto'
  | 'perdoado';

export type SplitParticipantRole =
  | 'dono'
  | 'pagadorPrincipal'
  | 'participante'
  | 'visualizador';

export interface SplitGroup {
  id: string;
  nome: string;
  tipo: SplitGroupType;
  descricao?: string;
  ativo: boolean;
  dataCriacao: string;
  dataEncerramento?: string;
  corPrincipal: string;
  icone: string;
  emojiOpcional?: string;
  imagemCapaOpcional?: string;
  businessType?: 'rateio' | 'reembolso';
  profileId?: string;
}

export interface SplitParticipant {
  id: string;
  groupId: string;
  userId?: string;
  convidadoId?: string;
  nomeExibicao: string;
  papel: SplitParticipantRole;
  porcentagemPadrao?: number;
  corIdentidade: string;
  avatarEmojiOpcional?: string;
}

export interface SplitBill {
  id: string;
  groupId: string;
  descricao: string;
  categoriaId?: string;
  categoriaNome?: string;
  tipoValor: SplitBillValueType;
  valorPadrao?: number;
  valorReal?: number;
  moeda: 'BRL';
  competencia: string;
  dataVencimento?: string;
  statusPagamento: SplitBillPaymentStatus;
  formaPagamento: SplitBillPaymentMethod;
  cartaoIdOpcional?: string;
  despesaIdOpcional?: string;
  pagadorPrincipalId?: string;
  createdAt?: string;
  updatedAt?: string;
  reimbursementStatus?: 'solicitado' | 'aprovado' | 'pago';
}

export interface SplitShare {
  id: string;
  billId: string;
  participantId: string;
  valorDevido: number;
  valorPago: number;
  status: SplitShareStatus;
  dataUltimoPagamento?: string;
  observacao?: string;
}

export interface SplitGroupInvite {
  id: string;
  groupId: string;
  codigoConvite: string;
  papelSugerido: 'participante' | 'visualizador';
  emailOuIdentificador?: string;
  expiraEm?: string;
  status: 'pendente' | 'aceito' | 'expirado' | 'revogado';
}

export interface SummaryData {
    balance: number;
    income: number;
    expenses: number;
    investments: number;
}

export interface SummaryCardProps {
    title: string;
    value: number;
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

export interface CreditCardPurchaseModalInput {
    cardId: string;
    description: string;
    categorySnapshot: {
        label: string;
        normalizedLabel?: string;
    };
    supplier?: string;
    costCenter?: string;
    purchaseDate: string;
    totalAmount: number;
    installmentsCount: number;
    amountType: 'total' | 'installment';
    source: 'manual';
    idempotencyKey: string;
    correlationId?: string;
}

export interface TransactionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAddTransaction: (transaction: Omit<Transaction, 'id'>) => void;
    onAddTransactions?: (transactions: Omit<Transaction, 'id'>[]) => void;
    onAddCreditCardPurchase?: (purchase: CreditCardPurchaseModalInput) => Promise<void> | void;
    onUpdateTransaction: (transaction: Transaction) => void;
    transactionToEdit?: Transaction | null;
    defaultType?: TransactionType | null;
    currentDate: Date;
    creditCards?: CreditCard[];
    productsServices?: EntityItem[];
    settingsCategories?: EntityItem[];
    wallets?: EntityItem[];
    expenseTypes?: EntityItem[];
    paymentTypes?: EntityItem[];
    incomeTypes?: EntityItem[];
    allowedTypes?: TransactionType[] | null;
    costCenters?: EntityItem[];
    onAddProductService?: (name: string) => void;
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
    type: 'info' | 'success' | 'warning' | 'error' | 'invite';
    read: boolean;
    link?: string; // Para redirecionar (ex: '/loans/123')
    actionLabel?: string; // Ex: "Aceitar"
    createdAt: string;
}
