
import React from 'react';
export * from './modules/recurring-expenses/types.ts';

export type TransactionType = 'receita' | 'despesa' | 'investimento' | 'parcelado';

export type Category = {
    receita: Array<'Salário' | 'Honorários' | 'Venda de Produto' | 'Reembolso' | 'Dividendos' | 'Outros'>;
    despesa: Array<'Alimentação' | 'Moradia' | 'Transporte' | 'Saúde' | 'Educação' | 'Lazer' | 'Utilidades' | 'Comunicação' | 'Outros'>;
    investimento: Array<'Ações' | 'Fundos Imobiliários' | 'Tesouro Direto' | 'CDB' | 'Poupança' | 'Outros'>;
    parcelado: Array<'Eletrônicos' | 'Eletrodomésticos' | 'Móveis' | 'Vestuário' | 'Outros'>;
};

// Generic interface for CRUD items (Product, ExpenseType, etc.)
export interface EntityItem {
    id: number;
    name: string;
    type?: string; // e.g., 'receita', 'despesa' for categories
    // Icon properties
    icon?: string; // Icon name key
    iconColor?: string; // Hex color
    iconStroke?: number; // Stroke width (1-3)
}

export interface CreditCard {
    id: number;
    name: string;
    brand: string;
    limitTotal: number;
    closingDay: number;
    dueDay: number;
    bestDay?: number;
    status: 'active' | 'blocked' | 'cancelled';
    observations?: string;
    visual: {
        bgType: 'color' | 'gradient' | 'image';
        bgColor: string; // main color
        bgGradientColor?: string; // secondary color for gradient
        bgImage?: string; // data url or link
        textColor: 'white' | 'black';
        showName: boolean;
        showBrand: boolean;
        showLogo: boolean;
    };
}

export interface SettingsData {
    productsServices: EntityItem[];
    expenseTypes: EntityItem[];
    categories: EntityItem[]; // Specific for general categorization if needed
    paymentTypes: EntityItem[];
    incomeTypes: EntityItem[];
    wallets: EntityItem[];
}

export interface Transaction {
    id: number;
    type: TransactionType;
    description: string;
    category: string;
    value: number;
    date: string; // YYYY-MM-DD
    installments?: number;
    currentInstallment?: number;
    cardId?: number; // Linked credit card ID
    walletId?: number; // Linked wallet ID
    
    // GOALS INTEGRATION
    goalId?: number; // Linked Goal ID (if this transaction contributes to a goal)

    // New fields for extended form logic
    expenseType?: string;
    incomeType?: string; // New field for Income Type
    paymentMethod?: string;
    isPaid?: boolean;
}

// --- GOALS MODULE TYPES ---

export type GoalCategory = 
    | 'reserva_emergencia'  // Segurança
    | 'viagem'              // Lazer/Experiência
    | 'veiculo'             // Carro/Moto
    | 'imovel'              // Casa Própria/Reforma
    | 'eletronicos'         // Notebook/Celular
    | 'educacao'            // Faculdade/Cursos
    | 'patrimonio'          // Aposentadoria/Liberdade Financeira
    | 'outro';

export type GoalHorizon = 
    | 'curto'  // < 1 ano
    | 'medio'  // 1 a 5 anos
    | 'longo'; // > 5 anos

export type GoalStatus = 
    | 'em_andamento' 
    | 'alcancada' 
    | 'pausada' 
    | 'cancelada';

export type GoalPriority = 'baixa' | 'media' | 'alta';

export interface Goal {
    id: number;
    
    // Core Data
    name: string;
    description?: string;
    category: GoalCategory;
    status: GoalStatus;
    priority: GoalPriority;
    
    // Financial & Time Data
    targetAmount: number;       // Objetivo final
    currentAmount: number;      // Calculado (Soma dos investimentos vinculados)
    startDate: string;          // YYYY-MM-DD
    deadline: string;           // YYYY-MM-DD
    horizon: GoalHorizon;       // Pode ser calculado ou definido manualmente
    
    // Visual Customization
    visual: {
        color: string;           // Hex principal
        icon: string;            // Icon Key name
        emoji?: string;          // Emoji opcional
        coverImage?: string;     // Base64/URL para capa
        progressBarType: 'linear' | 'circular';
    };

    createdAt: string;
    updatedAt: string;
}

// Opcional: Para histórico granular de contribuições
export interface GoalContribution {
    id: number;
    goalId: number;
    transactionId: number;
    date: string;
    amount: number;
}

// --- SHARED EXPENSES MODULE TYPES (Split Bills) ---

export type SplitGroupType = 'fixo' | 'temporario';

export type SplitBillValueType = 'fixo' | 'variavel';

export type SplitBillPaymentStatus = 'pendente' | 'parcialmentePago' | 'pago' | 'cancelado';

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
  icone: string; // nome usado pelo sistema central de ícones
  emojiOpcional?: string;
  imagemCapaOpcional?: string;
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
  competencia: string; // ex: "2023-10" ou data completa
  dataVencimento?: string;
  statusPagamento: SplitBillPaymentStatus;
  formaPagamento: SplitBillPaymentMethod;
  cartaoIdOpcional?: string;
  despesaIdOpcional?: string;
  pagadorPrincipalId?: string;
  createdAt?: string;
  updatedAt?: string;
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

// -----------------------------------

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
    icon: React.ReactNode;
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
    onAddTransaction: (transaction: Omit<Transaction, 'id'>) => void;
    onAddTransactions?: (transactions: Omit<Transaction, 'id'>[]) => void;
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
    incomeTypes?: EntityItem[]; // Added prop
    onAddProductService?: (name: string) => void;
}

// --- THEMING INTERFACES ---

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
    // Base
    primary: string;       // Main brand color
    background: string;    // App background
    surface: string;       // Card/Sidebar background
    text: string;          // Main text color
    textSecondary: string; // Muted text color
    border: string;        // Border color
    
    // Feedback
    success: string;
    error: string;
    warning: string;
    info: string;

    // Charts
    chartIncome: string;
    chartExpense: string;
    chartInvestment: string;
    chartInstallment: string;
}

export interface ThemeLayout {
    borderRadius: number; // in px, e.g., 0, 4, 8, 12, 16
    density: 'compact' | 'comfortable' | 'spacious';
    sidebarWidth: number; // in px
}

export interface ThemeIcons {
    pack: 'lucide' | 'phosphor' | 'tabler';
    size: number; // px
    strokeWidth: number; 
}

// SOUNDS
export type SoundKey = 'click' | 'success' | 'error' | 'notification';

export interface ThemeSounds {
  enabled: boolean;
  volume: number; // 0 to 100
  pack: 'minimal' | 'digital' | 'classic';
  mapping: Record<SoundKey, string | null>; // Maps event to sound ID
}

export interface ThemeEffects {
    enableSounds: boolean; // Deprecated but kept for migration
    enableAnimations: boolean;
}

// Global Goal Settings
export interface ThemeGoals {
    density: 'compact' | 'comfortable';
    showCover: boolean;
    showEmoji: boolean;
    showBadges: boolean;
}

// Global Split Group Settings
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
