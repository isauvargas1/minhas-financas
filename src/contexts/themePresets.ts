
import { AppTheme, ThemeSounds, ThemeGoals, ThemeSplitGroups } from '../types.ts';

const defaultIcons = {
    pack: 'lucide' as const,
    size: 20,
    strokeWidth: 2
};

const defaultSounds: ThemeSounds = {
    enabled: true,
    volume: 50,
    pack: 'minimal',
    mapping: {
        click: 'click_minimal',
        success: 'success_minimal',
        error: 'error_minimal',
        notification: 'notification_minimal'
    }
};

const defaultGoals: ThemeGoals = {
    density: 'comfortable',
    showCover: true,
    showEmoji: true,
    showBadges: true
};

const defaultSplitGroups: ThemeSplitGroups = {
    defaultViewMode: 'card',
    density: 'comfortable'
};

export const defaultLightTheme: AppTheme = {
    id: 'default-light',
    name: 'Padrão Claro',
    mode: 'light',
    colors: {
        primary: '#4f46e5', // indigo-600
        background: '#f9fafb', // gray-50
        surface: '#ffffff',    // white
        text: '#1f2937',       // gray-800
        textSecondary: '#6b7280', // gray-500
        border: '#e5e7eb',     // gray-200
        
        success: '#22c55e',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6',

        chartIncome: '#22c55e',
        chartExpense: '#ef4444',
        chartInvestment: '#3b82f6',
        chartInstallment: '#a855f7',
    },
    layout: {
        borderRadius: 12,
        density: 'comfortable',
        sidebarWidth: 256
    },
    icons: defaultIcons,
    sounds: defaultSounds,
    effects: {
        enableSounds: true,
        enableAnimations: true
    },
    goals: defaultGoals,
    splitGroups: defaultSplitGroups
};

export const defaultDarkTheme: AppTheme = {
    id: 'default-dark',
    name: 'Padrão Escuro',
    mode: 'dark',
    colors: {
        primary: '#6366f1', // indigo-500
        background: '#0B1120', // custom dark
        surface: '#1E293B',    // slate-800
        text: '#f3f4f6',       // gray-100
        textSecondary: '#9ca3af', // gray-400
        border: '#374151',     // gray-700

        success: '#4ade80',
        error: '#f87171',
        warning: '#fbbf24',
        info: '#60a5fa',

        chartIncome: '#4ade80',
        chartExpense: '#f87171',
        chartInvestment: '#60a5fa',
        chartInstallment: '#c084fc',
    },
    layout: {
        borderRadius: 12,
        density: 'comfortable',
        sidebarWidth: 256
    },
    icons: defaultIcons,
    sounds: defaultSounds,
    effects: {
        enableSounds: true,
        enableAnimations: true
    },
    goals: defaultGoals,
    splitGroups: defaultSplitGroups
};

export const midnightTheme: AppTheme = {
    id: 'midnight',
    name: 'Midnight',
    mode: 'dark',
    colors: {
        primary: '#818cf8', // indigo-400
        background: '#020617', // slate-950
        surface: '#0f172a',    // slate-900
        text: '#e2e8f0',       // slate-200
        textSecondary: '#64748b', // slate-500
        border: '#1e293b',     // slate-800

        success: '#34d399',
        error: '#f87171',
        warning: '#fbbf24',
        info: '#60a5fa',

        chartIncome: '#34d399',
        chartExpense: '#f87171',
        chartInvestment: '#60a5fa',
        chartInstallment: '#a78bfa',
    },
    layout: {
        borderRadius: 16,
        density: 'spacious',
        sidebarWidth: 260
    },
    icons: { ...defaultIcons, strokeWidth: 1.5 },
    sounds: { ...defaultSounds, pack: 'digital' },
    effects: {
        enableSounds: true,
        enableAnimations: true
    },
    goals: { ...defaultGoals, density: 'comfortable' },
    splitGroups: { ...defaultSplitGroups, density: 'comfortable' }
};

export const emeraldTheme: AppTheme = {
    id: 'emerald',
    name: 'Emerald',
    mode: 'light',
    colors: {
        primary: '#059669', // emerald-600
        background: '#ecfdf5', // emerald-50
        surface: '#ffffff',
        text: '#064e3b',       // emerald-900
        textSecondary: '#047857', // emerald-700
        border: '#d1fae5',     // emerald-100

        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#0ea5e9',

        chartIncome: '#10b981',
        chartExpense: '#ef4444',
        chartInvestment: '#0ea5e9',
        chartInstallment: '#8b5cf6',
    },
    layout: {
        borderRadius: 8,
        density: 'compact',
        sidebarWidth: 240
    },
    icons: { ...defaultIcons, size: 18 },
    sounds: { ...defaultSounds, enabled: false },
    effects: {
        enableSounds: false,
        enableAnimations: true
    },
    goals: { ...defaultGoals, density: 'compact', showCover: false },
    splitGroups: { ...defaultSplitGroups, density: 'compact' }
};

export const sunriseTheme: AppTheme = {
    id: 'sunrise',
    name: 'Sunrise',
    mode: 'light',
    colors: {
        primary: '#ea580c', // orange-600
        background: '#fff7ed', // orange-50
        surface: '#ffffff',
        text: '#431407',       // orange-950
        textSecondary: '#9a3412', // orange-700
        border: '#ffedd5',     // orange-100

        success: '#22c55e',
        error: '#ea580c',
        warning: '#facc15',
        info: '#0ea5e9',

        chartIncome: '#22c55e',
        chartExpense: '#ea580c',
        chartInvestment: '#0ea5e9',
        chartInstallment: '#d946ef',
    },
    layout: {
        borderRadius: 20,
        density: 'comfortable',
        sidebarWidth: 256
    },
    icons: defaultIcons,
    sounds: { ...defaultSounds, pack: 'classic' },
    effects: {
        enableSounds: true,
        enableAnimations: true
    },
    goals: { ...defaultGoals, showEmoji: true },
    splitGroups: defaultSplitGroups
};

export const PRESET_THEMES: AppTheme[] = [
    defaultLightTheme,
    defaultDarkTheme,
    midnightTheme,
    emeraldTheme,
    sunriseTheme
];
