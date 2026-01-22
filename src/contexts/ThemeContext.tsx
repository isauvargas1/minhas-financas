
import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import { AppTheme, SoundKey } from '../types.ts';
import { defaultLightTheme, defaultDarkTheme } from './themePresets.ts';
import { Howl } from 'howler';

interface ThemeContextType {
    theme: AppTheme;
    setTheme: (theme: AppTheme) => void;
    updateTheme: (updates: Partial<AppTheme>) => void;
    toggleMode: () => void;
    resetTheme: () => void;
    playSound: (key: SoundKey) => void;
    availableSounds: string[]; // To list in select box
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// --- SOUND LIBRARY (Base64 for Zero-Config Setup) ---
// Minimalist
const B64_CLICK_MINIMAL = "data:audio/wav;base64,UklGRlIAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAACAAEA/v///wAAAAD//wAA/v/+/wAAAAD//wAA/v/+/wAAAAD//wAA/v/+/wAAAAD//wAA";
const B64_SUCCESS_MINIMAL = "data:audio/wav;base64,UklGRjQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YXcAAACAgICAAAAAgIAAAICAAACAgIAAAICAAAAAgIAAAICAAACAgIAAAICAAAAAgIAAAICAAACAgIAAAICAAAAAgIAAAICAAACAgIAAAICAAAAAgIAAAICAAACAgIAAAICAAAAAgIAAAICAAACAgIAAAICAAAAAgIA=";

// Since we cannot host files, we map IDs to these Base64 strings.
// In a real app, these would be URLs like '/sounds/click.mp3'
export const SOUND_LIBRARY: Record<string, string> = {
    // Minimal
    'click_minimal': 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
    'success_minimal': 'https://assets.mixkit.co/active_storage/sfx/1114/1114-preview.mp3',
    'error_minimal': 'https://assets.mixkit.co/active_storage/sfx/2572/2572-preview.mp3',
    'notification_minimal': 'https://assets.mixkit.co/active_storage/sfx/2344/2344-preview.mp3',
    
    // Digital
    'click_digital': 'https://assets.mixkit.co/active_storage/sfx/270/270-preview.mp3',
    'success_digital': 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3',
    'error_digital': 'https://assets.mixkit.co/active_storage/sfx/2953/2953-preview.mp3',
    'notification_digital': 'https://assets.mixkit.co/active_storage/sfx/1043/1043-preview.mp3',
    
    // Classic
    'click_classic': 'https://assets.mixkit.co/active_storage/sfx/2573/2573-preview.mp3',
    'success_classic': 'https://assets.mixkit.co/active_storage/sfx/1112/1112-preview.mp3',
    'error_classic': 'https://assets.mixkit.co/active_storage/sfx/950/950-preview.mp3',
    'notification_classic': 'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3',

    // "None" option
    'none': '',
};


export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Initialize state from local storage or default
    const [theme, setThemeState] = useState<AppTheme>(() => {
        const saved = localStorage.getItem('app-theme');
        let loadedTheme = null;
        
        if (saved) {
            try {
                loadedTheme = JSON.parse(saved);
            } catch (e) {
                console.error("Failed to parse theme", e);
            }
        }
        
        // Determine base theme from system preference
        const baseTheme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) 
            ? defaultDarkTheme 
            : defaultLightTheme;

        if (loadedTheme) {
            // Merge loaded theme with base theme to ensure all properties exist
            return {
                ...baseTheme,
                ...loadedTheme,
                colors: { ...baseTheme.colors, ...loadedTheme.colors },
                layout: { ...baseTheme.layout, ...loadedTheme.layout },
                icons: { ...baseTheme.icons, ...loadedTheme.icons },
                sounds: { ...baseTheme.sounds, ...loadedTheme.sounds }, // Ensure sounds exist
                effects: { ...baseTheme.effects, ...loadedTheme.effects }
            };
        }
        
        return baseTheme;
    });

    const setTheme = (newTheme: AppTheme) => {
        setThemeState(newTheme);
        localStorage.setItem('app-theme', JSON.stringify(newTheme));
    };

    const updateTheme = (updates: Partial<AppTheme>) => {
        const newTheme = { ...theme, ...updates };
        setTheme(newTheme);
    };

    const toggleMode = () => {
        if (theme.mode === 'light') {
            const newTheme = { 
                ...defaultDarkTheme, 
                layout: theme.layout, 
                icons: theme.icons,
                sounds: theme.sounds,
                effects: theme.effects 
            };
            setTheme(newTheme);
        } else {
            const newTheme = { 
                ...defaultLightTheme, 
                layout: theme.layout,
                icons: theme.icons,
                sounds: theme.sounds,
                effects: theme.effects 
            };
            setTheme(newTheme);
        }
    };

    const resetTheme = () => {
        setTheme(theme.mode === 'dark' ? defaultDarkTheme : defaultLightTheme);
    };

    // --- SOUND LOGIC ---
    
    // Helper to change pack mappings
    useEffect(() => {
        // If the user changes the "Pack" in settings, we automatically update the mappings
        // This acts as a listener for "pack" changes to reset mappings to defaults
        const pack = theme.sounds?.pack || 'minimal';
        const currentMapping = theme.sounds?.mapping;
        
        const defaultForPack = {
            click: `click_${pack}`,
            success: `success_${pack}`,
            error: `error_${pack}`,
            notification: `notification_${pack}`
        };

        // Check if we need to update mapping (if current mapping doesn't match pack logic roughly)
        // Simplified: We assume if the pack name changed, we overwrite mappings. 
        // In a real app, we might check if 'custom' is selected.
        const shouldUpdate = 
            currentMapping.click !== defaultForPack.click || 
            currentMapping.success !== defaultForPack.success;

        if (shouldUpdate) {
             updateTheme({
                 sounds: {
                     ...theme.sounds,
                     mapping: defaultForPack
                 }
             });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [theme.sounds.pack]);

    const playSound = (key: SoundKey) => {
        if (!theme.sounds?.enabled) return;

        const soundId = theme.sounds.mapping[key];
        if (!soundId || soundId === 'none') return;

        const src = SOUND_LIBRARY[soundId];
        if (!src) return;

        const sound = new Howl({
            src: [src],
            volume: theme.sounds.volume / 100,
            html5: true
        });
        
        sound.play();
    };

    // Apply CSS Variables to :root
    useEffect(() => {
        const root = document.documentElement;

        // Base Colors
        root.style.setProperty('--color-primary', theme.colors.primary);
        root.style.setProperty('--color-bg', theme.colors.background);
        root.style.setProperty('--color-surface', theme.colors.surface);
        root.style.setProperty('--color-text', theme.colors.text);
        root.style.setProperty('--color-text-secondary', theme.colors.textSecondary);
        root.style.setProperty('--color-border', theme.colors.border);
        
        // Feedback Colors
        root.style.setProperty('--color-success', theme.colors.success);
        root.style.setProperty('--color-error', theme.colors.error);
        root.style.setProperty('--color-warning', theme.colors.warning);
        root.style.setProperty('--color-info', theme.colors.info);

        // Chart Colors
        root.style.setProperty('--color-chart-income', theme.colors.chartIncome);
        root.style.setProperty('--color-chart-expense', theme.colors.chartExpense);
        root.style.setProperty('--color-chart-investment', theme.colors.chartInvestment);
        root.style.setProperty('--color-chart-installment', theme.colors.chartInstallment);

        // Layout
        root.style.setProperty('--radius', `${theme.layout.borderRadius}px`);
        root.style.setProperty('--sidebar-width', `${theme.layout.sidebarWidth}px`);

        // Tailwind Class Dark Mode handling
        if (theme.mode === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }

    }, [theme]);

    const availableSounds = Object.keys(SOUND_LIBRARY).filter(k => k !== 'none');

    return (
        <ThemeContext.Provider value={{ theme, setTheme, updateTheme, toggleMode, resetTheme, playSound, availableSounds }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
