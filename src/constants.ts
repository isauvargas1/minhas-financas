import { Category, EntityItem } from './types';

export const categories: Category = {
    receita: ['Salário', 'Honorários', 'Venda de Produto', 'Reembolso', 'Dividendos', 'Outros'],
    despesa: ['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Utilidades', 'Comunicação', 'Outros'],
    investimento: ['Ações', 'Fundos Imobiliários', 'Tesouro Direto', 'CDB', 'Poupança', 'Outros'],
    parcelado: ['Eletrônicos', 'Eletrodomésticos', 'Móveis', 'Vestuário', 'Outros']
};

export const expenseTypesOptions = [
    'Fixa', 'Variável', 'Operacional', 'Pessoal', 'Recorrente', 'Emergencial'
];

export const paymentMethodsOptions = [
    'Dinheiro', 'Pix', 'Boleto', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência'
];

export const transactionTypeColors = {
    receita: 'text-green-600 dark:text-green-400',
    despesa: 'text-red-600 dark:text-red-400',
    investimento: 'text-blue-600 dark:text-blue-400',
    parcelado: 'text-purple-600 dark:text-purple-400',
};

export const chartColors = {
    light: {
        receita: '#22c55e',
        despesa: '#ef4444',
        investimento: '#3b82f6',
        parcelado: '#a855f7'
    },
    dark: {
        receita: '#4ade80',
        despesa: '#f87171',
        investimento: '#60a5fa',
        parcelado: '#c084fc'
    }
}

export const initialProductsServices: EntityItem[] = [
    { id: 1, name: 'Consultoria de TI', icon: 'DeviceDesktop', iconColor: '#4f46e5', iconStroke: 2 },
    { id: 2, name: 'Manutenção Elétrica', icon: 'Bolt', iconColor: '#eab308', iconStroke: 2 },
    { id: 3, name: 'Netflix', icon: 'Movie', iconColor: '#ef4444', iconStroke: 1.5 },
    { id: 4, name: 'Spotify', icon: 'Music', iconColor: '#22c55e', iconStroke: 2 },
];

export const initialExpenseTypes: EntityItem[] = [
    { id: 1, name: 'Fixa', icon: 'Lock', iconColor: '#64748b', iconStroke: 2 },
    { id: 2, name: 'Variável', icon: 'ChartArrows', iconColor: '#f97316', iconStroke: 2 },
    { id: 3, name: 'Emergencial', icon: 'AlertTriangle', iconColor: '#dc2626', iconStroke: 2.5 },
];

export const initialCategoriesSettings: EntityItem[] = [
    { id: 1, name: 'Alimentação', icon: 'ShoppingCart', iconColor: '#ef4444', iconStroke: 2, type: 'despesa' },
    { id: 2, name: 'Moradia', icon: 'Home', iconColor: '#3b82f6', iconStroke: 2, type: 'despesa' },
    { id: 3, name: 'Transporte', icon: 'Car', iconColor: '#eab308', iconStroke: 2, type: 'despesa' },
    { id: 4, name: 'Saúde', icon: 'Heart', iconColor: '#ec4899', iconStroke: 2, type: 'despesa' },
    { id: 5, name: 'Lazer', icon: 'Confetti', iconColor: '#8b5cf6', iconStroke: 2, type: 'despesa' },
    { id: 6, name: 'Educação', icon: 'School', iconColor: '#0ea5e9', iconStroke: 2, type: 'despesa' },
    { id: 7, name: 'Utilidades', icon: 'Bulb', iconColor: '#f59e0b', iconStroke: 2, type: 'despesa' },
    { id: 10, name: 'Salário', icon: 'Briefcase', iconColor: '#22c55e', iconStroke: 2, type: 'receita' },
    { id: 11, name: 'Honorários', icon: 'Certificate', iconColor: '#8b5cf6', iconStroke: 2, type: 'receita' },
    { id: 12, name: 'Venda de Produto', icon: 'Tag', iconColor: '#f97316', iconStroke: 2, type: 'receita' },
    { id: 13, name: 'Reembolso', icon: 'ReceiptRefund', iconColor: '#6366f1', iconStroke: 2, type: 'receita' },
    { id: 14, name: 'Dividendos', icon: 'ChartPie', iconColor: '#10b981', iconStroke: 2, type: 'receita' },
    { id: 20, name: 'Ações', icon: 'TrendingUp', iconColor: '#3b82f6', iconStroke: 2, type: 'investimento' },
    { id: 21, name: 'Fundos Imobiliários', icon: 'BuildingSkyscraper', iconColor: '#f59e0b', iconStroke: 2, type: 'investimento' },
    { id: 22, name: 'Tesouro Direto', icon: 'BuildingBank', iconColor: '#10b981', iconStroke: 2, type: 'investimento' },
    { id: 23, name: 'CDB', icon: 'Percentage', iconColor: '#8b5cf6', iconStroke: 2, type: 'investimento' },
    { id: 24, name: 'Poupança', icon: 'PigMoney', iconColor: '#ec4899', iconStroke: 2, type: 'investimento' },
    { id: 30, name: 'Eletrônicos', icon: 'DeviceMobile', iconColor: '#6366f1', iconStroke: 2, type: 'parcelado' },
    { id: 31, name: 'Eletrodomésticos', icon: 'ToolsKitchen', iconColor: '#ef4444', iconStroke: 2, type: 'parcelado' },
    { id: 32, name: 'Móveis', icon: 'Sofa', iconColor: '#eab308', iconStroke: 2, type: 'parcelado' },
    { id: 33, name: 'Vestuário', icon: 'Shirt', iconColor: '#ec4899', iconStroke: 2, type: 'parcelado' },
];

export const initialPaymentTypes: EntityItem[] = [
    { id: 1, name: 'Dinheiro', icon: 'Cash', iconColor: '#10b981', iconStroke: 2 },
    { id: 2, name: 'Cartão de Crédito', icon: 'CreditCard', iconColor: '#3b82f6', iconStroke: 2 },
    { id: 3, name: 'Cartão de Débito', icon: 'Id', iconColor: '#6366f1', iconStroke: 2 },
    { id: 4, name: 'Pix', icon: 'BrandPix', iconColor: '#14b8a6', iconStroke: 2 },
    { id: 5, name: 'Boleto', icon: 'Barcode', iconColor: '#475569', iconStroke: 2 },
];

export const initialIncomeTypes: EntityItem[] = [
    { id: 1, name: 'Salário Mensal', icon: 'Briefcase', iconColor: '#22c55e', iconStroke: 2 },
    { id: 2, name: 'Freelance', icon: 'DeviceLaptop', iconColor: '#8b5cf6', iconStroke: 2 },
    { id: 3, name: 'Dividendos', icon: 'ChartPie', iconColor: '#f59e0b', iconStroke: 2 },
    { id: 4, name: 'Venda de Bens', icon: 'Tag', iconColor: '#ef4444', iconStroke: 2 },
];

export const initialWallets: EntityItem[] = [
    { id: 1, name: 'Carteira Principal', icon: 'Wallet', iconColor: '#4f46e5', iconStroke: 2 },
    { id: 2, name: 'Reserva de Emergência', icon: 'ShieldCheck', iconColor: '#10b981', iconStroke: 2 },
    { id: 3, name: 'Investimentos Nubank', icon: 'BuildingBank', iconColor: '#8b5cf6', iconStroke: 2 },
    { id: 4, name: 'Binance', icon: 'CoinBitcoin', iconColor: '#f59e0b', iconStroke: 2 },
];