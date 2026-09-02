import type {
    Transaction,
    TransactionCatalogVisualSnapshot,
    TransactionType,
} from '../../types.ts';
import type { SettingsCatalogItem } from './types';
import { normalizeSettingsCatalogName } from './utils.ts';

export type CatalogDisplayGroup =
    | 'product_service'
    | 'expense_type'
    | 'category'
    | 'payment_method'
    | 'income_type'
    | 'wallet'
    | 'cost_center'
    // Categoria de investimento do cadastro **anterior**. A categoria atual
    // é `category` com subtipo `investimento`, já contemplada acima; este
    // grupo permanece porque a listagem simples desenha o chip de lançamentos
    // feitos antes da unificação.
    | 'investment_type';

export interface ResolvedCatalogVisual {
    group: CatalogDisplayGroup;
    label: string;
    normalizedLabel: string;
    icon?: string;
    color?: string;
    stroke?: number;
    source: 'snapshot' | 'catalog' | 'fallback';
}

const FALLBACK_COLORS: Record<CatalogDisplayGroup, string> = {
    product_service: '#6366f1',
    expense_type: '#ef4444',
    category: '#8b5cf6',
    payment_method: '#0ea5e9',
    income_type: '#10b981',
    wallet: '#3b82f6',
    cost_center: '#f59e0b',
    investment_type: '#2563eb',
};

const toResolvedVisual = (
    group: CatalogDisplayGroup,
    label: string,
    source: ResolvedCatalogVisual['source'],
    icon?: string,
    color?: string,
    stroke?: number,
): ResolvedCatalogVisual => ({
    group,
    label,
    normalizedLabel: normalizeSettingsCatalogName(label),
    icon,
    color: color || FALLBACK_COLORS[group],
    stroke,
    source,
});

const resolveFromCatalog = (params: {
    catalogItems: SettingsCatalogItem[];
    group: CatalogDisplayGroup;
    label?: string;
    transactionSubtype?: TransactionType;
}) => {
    const { catalogItems, group, label, transactionSubtype } = params;

    if (!label?.trim()) return undefined;

    const normalized = normalizeSettingsCatalogName(label);

    return catalogItems.find((item) => {
        if (item.group !== group) return false;
        if (normalizeSettingsCatalogName(item.name) !== normalized) return false;

        if (group === 'category' && transactionSubtype) {
            return item.transactionSubtype === transactionSubtype;
        }

        return true;
    });
};

/*
 * O grupo aqui é o do **snapshot persistido na transação**, que é um
 * subconjunto de `CatalogDisplayGroup`: `investment_type` só existe para
 * desenhar o chip de um investimento e nunca é gravado numa transação.
 * Amarrar o parâmetro ao tipo persistido impede que um grupo novo de exibição
 * vaze para dentro de um documento antigo.
 */
export const buildVisualSnapshotFromCatalogItem = (
    group: TransactionCatalogVisualSnapshot['group'],
    item: SettingsCatalogItem,
): TransactionCatalogVisualSnapshot => ({
    group,
    label: item.name,
    normalizedLabel: normalizeSettingsCatalogName(item.name),
    icon: item.icon,
    color: item.color,
    stroke: item.stroke,
    transactionSubtype: item.transactionSubtype,
});

export const resolveCatalogVisual = (params: {
    catalogItems: SettingsCatalogItem[];
    group: CatalogDisplayGroup;
    label?: string;
    transactionSubtype?: TransactionType;
    snapshot?: TransactionCatalogVisualSnapshot;
}): ResolvedCatalogVisual | null => {
    const { catalogItems, group, label, transactionSubtype, snapshot } = params;

    if (snapshot?.label) {
        return toResolvedVisual(
            group,
            snapshot.label,
            'snapshot',
            snapshot.icon,
            snapshot.color,
            snapshot.stroke,
        );
    }

    const match = resolveFromCatalog({
        catalogItems,
        group,
        label,
        transactionSubtype,
    });

    if (match) {
        return toResolvedVisual(
            group,
            match.name,
            'catalog',
            match.icon,
            match.color,
            match.stroke,
        );
    }

    if (label?.trim()) {
        return toResolvedVisual(group, label, 'fallback');
    }

    return null;
};

export const resolveTransactionVisuals = (params: {
    transaction: Transaction;
    catalogItems: SettingsCatalogItem[];
}) => {
    const { transaction, catalogItems } = params;
    const snapshots = transaction.displaySnapshots || {};

    return {
        category: resolveCatalogVisual({
            catalogItems,
            group: 'category',
            label: transaction.category,
            transactionSubtype: transaction.type,
            snapshot: snapshots.categorySnapshot,
        }),
        expenseType: resolveCatalogVisual({
            catalogItems,
            group: 'expense_type',
            label: transaction.expenseType,
            snapshot: snapshots.expenseTypeSnapshot,
        }),
        incomeType: resolveCatalogVisual({
            catalogItems,
            group: 'income_type',
            label: transaction.incomeType,
            snapshot: snapshots.incomeTypeSnapshot,
        }),
        paymentMethod: resolveCatalogVisual({
            catalogItems,
            group: 'payment_method',
            label: transaction.paymentMethod,
            snapshot: snapshots.paymentMethodSnapshot,
        }),
        productService: resolveCatalogVisual({
            catalogItems,
            group: 'product_service',
            label: transaction.description,
            snapshot: snapshots.productServiceSnapshot,
        }),
        costCenter: resolveCatalogVisual({
            catalogItems,
            group: 'cost_center',
            label: transaction.costCenter,
            snapshot: snapshots.costCenterSnapshot,
        }),
    };
};