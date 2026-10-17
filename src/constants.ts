import { EntityItem } from './types';

export const transactionTypeColors = {
    receita: 'text-green-600 dark:text-green-400',
    despesa: 'text-red-600 dark:text-red-400',
    investimento: 'text-blue-600 dark:text-blue-400',
};

export const chartColors = {
    light: {
        receita: '#22c55e',
        despesa: '#ef4444',
        investimento: '#3b82f6'
    },
    dark: {
        receita: '#4ade80',
        despesa: '#f87171',
        investimento: '#60a5fa'
    }
}

/**
 * Paleta de cor por nome de categoria usada só pelos gráficos de Relatórios.
 * Não é cadastro: as categorias do workspace vivem só no catálogo
 * autoritativo (`settings_catalog`, D-23), gravado pelo backend.
 */
export const REPORT_CATEGORY_PALETTE: EntityItem[] = [
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
];
