
import React, { useState, useEffect, useRef } from 'react';
import { useTheme, SOUND_LIBRARY } from '../contexts/ThemeContext.tsx';
import { 
    BackIcon, MoonIcon, SunIcon, DashboardIcon, WalletIcon, CreditCardIcon, SettingsIcon,
    PaletteIcon, LayoutIcon, VolumeIcon, SparklesIcon, MonitorIcon, RotateCcwIcon, ShapesIcon,
    ArrowUpIcon, ArrowDownIcon, ChartBarIcon, TargetIcon, UsersIcon
} from './Icons.tsx';
import SummaryCard from './SummaryCard.tsx';
import Sidebar from './Sidebar.tsx';
import Header from './Header.tsx';
import TransactionsChart from './TransactionsChart.tsx';
import RecentTransactions from './RecentTransactions.tsx';
import { PRESET_THEMES } from '../contexts/themePresets.ts';
import { SoundKey, ThemeColors, Transaction } from '../types.ts';
import { Howl } from 'howler';

// Helper to calculate luminance
const getLuminance = (hex: string) => {
    const rgb = parseInt(hex.slice(1), 16); 
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >>  8) & 0xff;
    const b = (rgb >>  0) & 0xff;

    const [lr, lg, lb] = [r, g, b].map(c => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};

// Helper to calculate contrast ratio
const getContrastRatio = (hex1: string, hex2: string) => {
    const lum1 = getLuminance(hex1);
    const lum2 = getLuminance(hex2);
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
};

const ColorRow: React.FC<{
    label: string;
    colorKey: keyof ThemeColors;
    value: string;
    onChange: (key: keyof ThemeColors, val: string) => void;
    contrastWith?: string; // hex color to check contrast against
    contrastLabel?: string;
}> = ({ label, colorKey, value, onChange, contrastWith, contrastLabel }) => {
    
    let contrastRatio = 0;
    let contrastStatus = '';

    if (contrastWith) {
        contrastRatio = getContrastRatio(value, contrastWith);
        if (contrastRatio < 3) contrastStatus = 'Pobre';
        else if (contrastRatio < 4.5) contrastStatus = 'Bom (Grande)';
        else contrastStatus = 'Excelente';
    }

    const copyToClipboard = () => {
        navigator.clipboard.writeText(value);
    };

    return (
        <div className="flex items-center justify-between p-3 rounded-card border border-border bg-background hover:border-primary/30 transition-colors">
            <div className="flex-1">
                <div className="text-sm font-medium text-on-surface">{label}</div>
                {contrastWith && (
                    <div className={`text-xs mt-1 flex items-center gap-1 ${contrastRatio < 4.5 ? 'text-orange-500' : 'text-green-600'}`}>
                        {contrastRatio < 4.5 && <span className="font-bold">⚠</span>}
                        {contrastLabel || 'Contraste'}: {contrastRatio.toFixed(2)} ({contrastStatus})
                    </div>
                )}
            </div>
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 border border-border rounded-md p-1 bg-surface">
                    <input 
                        type="color" 
                        value={value} 
                        onChange={(e) => onChange(colorKey, e.target.value)}
                        className="h-8 w-10 p-0 border-0 rounded cursor-pointer"
                        title="Selecionar cor"
                    />
                    <div className="h-4 w-px bg-border mx-1"></div>
                    <span className="text-xs font-mono text-muted uppercase w-16 text-center">{value}</span>
                </div>
                <button 
                    onClick={copyToClipboard}
                    className="p-2 text-muted hover:text-primary transition-colors"
                    title="Copiar HEX"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
            </div>
        </div>
    );
};

// Mock data for preview
const MOCK_TRANSACTIONS: Transaction[] = [
    { id: 1, type: 'receita', description: 'Salário Mensal', category: 'Salário', value: 8500, date: '2025-12-05' },
    { id: 2, type: 'despesa', description: 'Aluguel Apartamento', category: 'Moradia', value: 2200, date: '2025-12-10' },
    { id: 3, type: 'despesa', description: 'Supermercado Semanal', category: 'Alimentação', value: 450.50, date: '2025-12-15' },
    { id: 4, type: 'investimento', description: 'Aporte Tesouro', category: 'Investimentos', value: 1000, date: '2025-12-20' },
    { id: 5, type: 'receita', description: 'Freelance Design', category: 'Honorários', value: 1200, date: '2025-12-22' },
    { id: 6, type: 'parcelado', description: 'Notebook Gamer', category: 'Eletrônicos', value: 500, date: '2025-12-24', installments: 10, currentInstallment: 3 },
];


const PersonalizationView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const { theme, setTheme, updateTheme, toggleMode, resetTheme, playSound, availableSounds } = useTheme();
    const [activeTab, setActiveTab] = useState<'general' | 'colors' | 'layout' | 'icons' | 'goals' | 'groups' | 'effects'>('general');
    
    // Preview state
    const [previewSidebarExpanded, setPreviewSidebarExpanded] = useState(true);
    
    // Dynamic Scale State
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(0.8);

    useEffect(() => {
        const calculateScale = () => {
            if (containerRef.current) {
                const { clientWidth, clientHeight } = containerRef.current;
                // Target resolution we want to simulate (Standard Desktop)
                const targetWidth = 1280;
                const targetHeight = 800;
                const padding = 40; // padding around the preview

                // Check for valid dimensions to avoid division by zero
                if (clientWidth <= 0 || clientHeight <= 0) return;

                // Calculate ratios
                const scaleX = (clientWidth - padding) / targetWidth;
                const scaleY = (clientHeight - padding) / targetHeight;

                // Use the smaller scale to fit "contain" style
                const newScale = Math.min(scaleX, scaleY);
                // Min scale to prevent it from disappearing, max 1 to prevent pixelation if screen is huge
                setScale(Math.max(0.69, Math.min(newScale, 1.2)));
            }
        };

        // Calculate initially
        calculateScale();

        // Recalculate on resize
        window.addEventListener('resize', calculateScale);
        return () => window.removeEventListener('resize', calculateScale);
    }, []);

    const handleColorChange = (key: keyof ThemeColors, value: string) => {
        updateTheme({
            colors: {
                ...theme.colors,
                [key]: value
            }
        });
    };

    const handleLayoutChange = (key: keyof typeof theme.layout, value: number | string) => {
        updateTheme({
            layout: {
                ...theme.layout,
                [key]: value
            }
        });
    };

    const handleIconChange = (key: keyof typeof theme.icons, value: any) => {
         updateTheme({
            icons: {
                ...theme.icons,
                [key]: value
            }
        });
    }

    const handleGoalsChange = (key: keyof typeof theme.goals, value: any) => {
        updateTheme({
            goals: {
                ...theme.goals,
                [key]: value
            }
        });
    }

    const handleSplitGroupsChange = (key: keyof typeof theme.splitGroups, value: any) => {
        updateTheme({
            splitGroups: {
                ...theme.splitGroups,
                [key]: value
            }
        });
    }

    const handleEffectChange = (key: keyof typeof theme.effects, value: boolean) => {
        updateTheme({
            effects: {
                ...theme.effects,
                [key]: value
            }
        });
    };

    const handleSoundConfigChange = (key: keyof typeof theme.sounds, value: any) => {
        updateTheme({
            sounds: {
                ...theme.sounds,
                [key]: value
            }
        });
    };

    const handleSoundMappingChange = (key: SoundKey, soundId: string) => {
        updateTheme({
            sounds: {
                ...theme.sounds,
                mapping: {
                    ...theme.sounds.mapping,
                    [key]: soundId
                }
            }
        });
    };

    return (
        <div className="flex flex-col h-full animate-fade-in gap-6">
            <div className="flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={onBack}
                        className="p-2 rounded-md bg-surface border border-border text-on-surface hover:bg-opacity-80 transition-colors"
                    >
                        <BackIcon className="h-5 w-5" />
                    </button>
                    <h2 className="text-2xl font-bold text-on-surface">Personalização</h2>
                </div>
                <button 
                    onClick={resetTheme}
                    className="flex items-center gap-2 text-sm text-muted hover:text-primary transition-colors"
                >
                    <RotateCcwIcon className="h-4 w-4" /> Resetar Padrão
                </button>
            </div>

            <div className="flex flex-col lg:flex-row gap-8 flex-1 min-h-0">
                {/* SETTINGS PANEL (LEFT) */}
                <div className="w-full lg:w-96 bg-surface border border-border rounded-card shadow-sm flex flex-col overflow-hidden flex-shrink-0">
                    {/* Tabs */}
                    <div className="flex border-b border-border overflow-x-auto">
                        <button onClick={() => setActiveTab('general')} className={`flex-1 min-w-[50px] p-3 flex justify-center border-b-2 transition-colors ${activeTab === 'general' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-on-surface'}`} title="Geral"><MonitorIcon className="h-5 w-5" /></button>
                        <button onClick={() => setActiveTab('colors')} className={`flex-1 min-w-[50px] p-3 flex justify-center border-b-2 transition-colors ${activeTab === 'colors' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-on-surface'}`} title="Cores"><PaletteIcon className="h-5 w-5" /></button>
                        <button onClick={() => setActiveTab('layout')} className={`flex-1 min-w-[50px] p-3 flex justify-center border-b-2 transition-colors ${activeTab === 'layout' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-on-surface'}`} title="Layout"><LayoutIcon className="h-5 w-5" /></button>
                        <button onClick={() => setActiveTab('icons')} className={`flex-1 min-w-[50px] p-3 flex justify-center border-b-2 transition-colors ${activeTab === 'icons' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-on-surface'}`} title="Ícones"><ShapesIcon className="h-5 w-5" /></button>
                        <button onClick={() => setActiveTab('goals')} className={`flex-1 min-w-[50px] p-3 flex justify-center border-b-2 transition-colors ${activeTab === 'goals' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-on-surface'}`} title="Metas"><TargetIcon className="h-5 w-5" /></button>
                        <button onClick={() => setActiveTab('groups')} className={`flex-1 min-w-[50px] p-3 flex justify-center border-b-2 transition-colors ${activeTab === 'groups' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-on-surface'}`} title="Grupos"><UsersIcon className="h-5 w-5" /></button>
                        <button onClick={() => setActiveTab('effects')} className={`flex-1 min-w-[50px] p-3 flex justify-center border-b-2 transition-colors ${activeTab === 'effects' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-on-surface'}`} title="Efeitos"><VolumeIcon className="h-5 w-5" /></button>
                    </div>

                    <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                        {activeTab === 'general' && (
                            <div className="space-y-8">
                                <div>
                                    <h3 className="font-semibold text-on-surface mb-4">Temas Rápidos</h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        {PRESET_THEMES.map(preset => (
                                            <button 
                                                key={preset.id}
                                                onClick={() => setTheme(preset)}
                                                className={`p-3 rounded-card border text-left transition-all hover:shadow-md ${theme.id === preset.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50'}`}
                                            >
                                                <div className="flex gap-2 mb-2">
                                                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: preset.colors.primary }}></div>
                                                    <div className="w-4 h-4 rounded-full border border-gray-200" style={{ backgroundColor: preset.colors.background }}></div>
                                                    <div className="w-4 h-4 rounded-full border border-gray-200" style={{ backgroundColor: preset.colors.surface }}></div>
                                                </div>
                                                <span className="text-sm font-medium text-on-surface">{preset.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <h3 className="font-semibold text-on-surface mb-4">Modo do Tema</h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <button 
                                            onClick={() => theme.mode !== 'light' && toggleMode()}
                                            className={`p-4 rounded-card border flex flex-col items-center gap-2 transition-all ${theme.mode === 'light' ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary' : 'border-border text-muted hover:bg-background'}`}
                                        >
                                            <SunIcon className="w-8 h-8" />
                                            <span>Claro</span>
                                        </button>
                                        <button 
                                            onClick={() => theme.mode !== 'dark' && toggleMode()}
                                            className={`p-4 rounded-card border flex flex-col items-center gap-2 transition-all ${theme.mode === 'dark' ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary' : 'border-border text-muted hover:bg-background'}`}
                                        >
                                            <MoonIcon className="w-8 h-8" />
                                            <span>Escuro</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'colors' && (
                            <div className="space-y-8">
                                <div>
                                    <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">Primária & Ações</h4>
                                    <div className="space-y-2">
                                        <ColorRow label="Cor Primária" colorKey="primary" value={theme.colors.primary} onChange={handleColorChange} contrastWith={theme.colors.surface} contrastLabel="vs. Superfície" />
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">Fundo & Superfícies</h4>
                                    <div className="space-y-2">
                                        <ColorRow label="Fundo da App" colorKey="background" value={theme.colors.background} onChange={handleColorChange} />
                                        <ColorRow label="Superfície (Cards)" colorKey="surface" value={theme.colors.surface} onChange={handleColorChange} />
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">Texto & Bordas</h4>
                                    <div className="space-y-2">
                                        <ColorRow label="Texto Principal" colorKey="text" value={theme.colors.text} onChange={handleColorChange} contrastWith={theme.colors.surface} contrastLabel="Leitura" />
                                        <ColorRow label="Texto Secundário" colorKey="textSecondary" value={theme.colors.textSecondary} onChange={handleColorChange} />
                                        <ColorRow label="Bordas" colorKey="border" value={theme.colors.border} onChange={handleColorChange} />
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">Feedback do Sistema</h4>
                                    <div className="space-y-2">
                                        <ColorRow label="Sucesso" colorKey="success" value={theme.colors.success} onChange={handleColorChange} />
                                        <ColorRow label="Erro / Perigo" colorKey="error" value={theme.colors.error} onChange={handleColorChange} />
                                        <ColorRow label="Alerta" colorKey="warning" value={theme.colors.warning} onChange={handleColorChange} />
                                        <ColorRow label="Informação" colorKey="info" value={theme.colors.info} onChange={handleColorChange} />
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-3">Cores de Gráficos</h4>
                                    <p className="text-xs text-muted mb-3">Visualize as alterações na legenda ao lado.</p>
                                    <div className="space-y-2">
                                        <ColorRow label="Receitas" colorKey="chartIncome" value={theme.colors.chartIncome} onChange={handleColorChange} />
                                        <ColorRow label="Despesas" colorKey="chartExpense" value={theme.colors.chartExpense} onChange={handleColorChange} />
                                        <ColorRow label="Investimentos" colorKey="chartInvestment" value={theme.colors.chartInvestment} onChange={handleColorChange} />
                                        <ColorRow label="Parceladas" colorKey="chartInstallment" value={theme.colors.chartInstallment} onChange={handleColorChange} />
                                    </div>
                                </div>
                                <div className="pt-4 border-t border-border">
                                    <button className="w-full py-2 bg-surface border border-border rounded-lg text-primary text-sm font-medium hover:bg-background transition-colors" onClick={() => alert("Variações automáticas geradas com base na cor primária!")}>Gerar Variações Automáticas</button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'layout' && (
                            <div className="space-y-6">
                                <h3 className="font-semibold text-on-surface">Layout e Espaçamento</h3>
                                <div>
                                    <label className="block text-sm font-medium text-muted mb-2">Arredondamento das Bordas: {theme.layout.borderRadius}px</label>
                                    <input type="range" min="0" max="24" step="2" value={theme.layout.borderRadius} onChange={(e) => handleLayoutChange('borderRadius', parseInt(e.target.value))} className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-muted mb-2">Largura da Sidebar: {theme.layout.sidebarWidth}px</label>
                                    <input type="range" min="200" max="320" step="8" value={theme.layout.sidebarWidth} onChange={(e) => handleLayoutChange('sidebarWidth', parseInt(e.target.value))} className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer" />
                                </div>
                            </div>
                        )}

                        {activeTab === 'icons' && (
                             <div className="space-y-6">
                                <h3 className="font-semibold text-on-surface">Estilo dos Ícones</h3>
                                <div>
                                    <label className="block text-sm font-medium text-muted mb-2">Pacote de Ícones</label>
                                    <select value={theme.icons.pack} onChange={(e) => handleIconChange('pack', e.target.value)} className="w-full border border-border bg-background text-on-surface rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                                        <option value="lucide">Lucide (Padrão Moderno)</option>
                                        <option value="phosphor">Phosphor (Clean)</option>
                                        <option value="tabler">Tabler (Detalhado)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-muted mb-2">Tamanho Base: {theme.icons.size}px</label>
                                    <input type="range" min="16" max="32" step="2" value={theme.icons.size} onChange={(e) => handleIconChange('size', parseInt(e.target.value))} className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-muted mb-2">Espessura do Traço: {theme.icons.strokeWidth}px</label>
                                    <input type="range" min="1" max="3" step="0.5" value={theme.icons.strokeWidth} onChange={(e) => handleIconChange('strokeWidth', parseFloat(e.target.value))} className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer" />
                                </div>
                            </div>
                        )}

                        {activeTab === 'goals' && (
                            <div className="space-y-6">
                                <h3 className="font-semibold text-on-surface">Visual das Metas</h3>
                                
                                <div>
                                    <label className="block text-sm font-medium text-muted mb-2">Densidade dos Cards</label>
                                    <div className="flex bg-background border border-border rounded-lg p-1">
                                        <button
                                            onClick={() => handleGoalsChange('density', 'comfortable')}
                                            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${theme.goals?.density === 'comfortable' ? 'bg-surface shadow-sm text-primary' : 'text-muted hover:text-on-surface'}`}
                                        >
                                            Rico (Detalhado)
                                        </button>
                                        <button
                                            onClick={() => handleGoalsChange('density', 'compact')}
                                            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${theme.goals?.density === 'compact' ? 'bg-surface shadow-sm text-primary' : 'text-muted hover:text-on-surface'}`}
                                        >
                                            Compacto
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between p-3 rounded-card border border-border bg-background">
                                        <span className="text-sm font-medium text-on-surface">Mostrar Capa (Imagem)</span>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" checked={theme.goals?.showCover ?? true} onChange={(e) => handleGoalsChange('showCover', e.target.checked)} className="sr-only peer" />
                                            <div className="w-11 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                        </label>
                                    </div>
                                    
                                    <div className="flex items-center justify-between p-3 rounded-card border border-border bg-background">
                                        <span className="text-sm font-medium text-on-surface">Mostrar Emojis</span>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" checked={theme.goals?.showEmoji ?? true} onChange={(e) => handleGoalsChange('showEmoji', e.target.checked)} className="sr-only peer" />
                                            <div className="w-11 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                        </label>
                                    </div>

                                    <div className="flex items-center justify-between p-3 rounded-card border border-border bg-background">
                                        <span className="text-sm font-medium text-on-surface">Mostrar Badges de Status</span>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" checked={theme.goals?.showBadges ?? true} onChange={(e) => handleGoalsChange('showBadges', e.target.checked)} className="sr-only peer" />
                                            <div className="w-11 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'groups' && (
                            <div className="space-y-6">
                                <h3 className="font-semibold text-on-surface">Visual dos Grupos</h3>
                                
                                <div>
                                    <label className="block text-sm font-medium text-muted mb-2">Visualização Padrão</label>
                                    <div className="flex bg-background border border-border rounded-lg p-1">
                                        <button
                                            onClick={() => handleSplitGroupsChange('defaultViewMode', 'card')}
                                            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${theme.splitGroups?.defaultViewMode === 'card' ? 'bg-surface shadow-sm text-primary' : 'text-muted hover:text-on-surface'}`}
                                        >
                                            Cards (Grade)
                                        </button>
                                        <button
                                            onClick={() => handleSplitGroupsChange('defaultViewMode', 'list')}
                                            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${theme.splitGroups?.defaultViewMode === 'list' ? 'bg-surface shadow-sm text-primary' : 'text-muted hover:text-on-surface'}`}
                                        >
                                            Lista (Tabela)
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-muted mb-2">Densidade de Informação</label>
                                    <div className="flex bg-background border border-border rounded-lg p-1">
                                        <button
                                            onClick={() => handleSplitGroupsChange('density', 'comfortable')}
                                            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${theme.splitGroups?.density === 'comfortable' ? 'bg-surface shadow-sm text-primary' : 'text-muted hover:text-on-surface'}`}
                                        >
                                            Confortável
                                        </button>
                                        <button
                                            onClick={() => handleSplitGroupsChange('density', 'compact')}
                                            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${theme.splitGroups?.density === 'compact' ? 'bg-surface shadow-sm text-primary' : 'text-muted hover:text-on-surface'}`}
                                        >
                                            Compacto
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'effects' && (
                            <div className="space-y-8">
                                <div className="space-y-6">
                                    <h3 className="font-semibold text-on-surface">Sons do Sistema</h3>
                                    <div className="flex items-center justify-between p-3 rounded-card border border-border bg-background">
                                        <div className="flex items-center gap-3">
                                            <VolumeIcon className="text-primary h-5 w-5" />
                                            <div>
                                                <div className="text-sm font-medium text-on-surface">Ativar Sons</div>
                                                <div className="text-xs text-muted">Feedback sonoro para interações</div>
                                            </div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" checked={theme.sounds?.enabled ?? true} onChange={(e) => handleSoundConfigChange('enabled', e.target.checked)} className="sr-only peer" />
                                            <div className="w-11 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                        </label>
                                    </div>

                                    <div className={`${!theme.sounds?.enabled ? 'opacity-50 pointer-events-none' : ''} transition-opacity space-y-4`}>
                                        <div>
                                            <label className="block text-sm font-medium text-muted mb-2">Volume Geral: {theme.sounds?.volume ?? 50}%</label>
                                            <input type="range" min="0" max="100" value={theme.sounds?.volume ?? 50} onChange={(e) => handleSoundConfigChange('volume', parseInt(e.target.value))} className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer" />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-muted mb-2">Pacote de Sons</label>
                                            <select value={theme.sounds?.pack ?? 'minimal'} onChange={(e) => handleSoundConfigChange('pack', e.target.value)} className="w-full border border-border bg-background text-on-surface rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                                                <option value="minimal">Minimalista (Suave)</option>
                                                <option value="digital">Digital (8-Bit)</option>
                                                <option value="classic">Clássico (Padrão UI)</option>
                                            </select>
                                        </div>

                                        <div className="mt-4 border border-border rounded-card bg-background overflow-hidden">
                                            <div className="bg-gray-100 dark:bg-dark-300 px-4 py-2 border-b border-border">
                                                <span className="text-xs font-semibold text-muted uppercase tracking-wider">Eventos Específicos</span>
                                            </div>
                                            <div className="divide-y divide-border">
                                                {[
                                                    { key: 'click', label: 'Clique Geral' },
                                                    { key: 'success', label: 'Ação Sucesso' },
                                                    { key: 'error', label: 'Erro / Alerta' },
                                                    { key: 'notification', label: 'Notificação' },
                                                ].map((event) => (
                                                    <div key={event.key} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-3">
                                                        <span className="text-sm text-on-surface font-medium">{event.label}</span>
                                                        <div className="flex items-center gap-2 flex-1 justify-end">
                                                            <select value={theme.sounds.mapping[event.key as SoundKey] || 'none'} onChange={(e) => handleSoundMappingChange(event.key as SoundKey, e.target.value)} className="text-xs border border-border bg-surface text-on-surface rounded px-2 py-1 max-w-[150px]">
                                                                <option value="none">Nenhum</option>
                                                                {availableSounds.map(sId => (
                                                                    <option key={sId} value={sId}>{sId.replace(/_/g, ' ')}</option>
                                                                ))}
                                                            </select>
                                                            <button onClick={() => playSound(event.key as SoundKey)} className="p-1.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex-shrink-0" title="Testar Som Atual">
                                                                <span className="text-xs font-bold">▶</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <hr className="border-border" />
                                <div className="flex items-center justify-between p-3 rounded-card border border-border bg-background">
                                    <div className="flex items-center gap-3">
                                        <SparklesIcon className="text-primary h-5 w-5" />
                                        <div>
                                            <div className="text-sm font-medium text-on-surface">Animações Visuais</div>
                                            <div className="text-xs text-muted">Transições suaves de página e hover</div>
                                        </div>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" checked={theme.effects.enableAnimations} onChange={(e) => handleEffectChange('enableAnimations', e.target.checked)} className="sr-only peer" />
                                        <div className="w-11 h-6 bg-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                    </label>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* PREVIEW PANEL (RIGHT) */}
                <div 
                    ref={containerRef}
                    className="flex-1 bg-background border border-border rounded-card shadow-inner overflow-hidden relative transition-colors duration-300 p-6 bg-gray-900/5 dark:bg-black/20"
                >
                    <div className="absolute top-0 left-0 bg-primary text-white text-xs px-2 py-1 rounded-br-md z-20">
                        Pré-visualização em Tempo Real
                    </div>

                   {/* Scaled App Simulation */}
                   <div 
                      style={{ 
                         width: '1280px', 
                         height: '800px', 
                         position: 'absolute',
                         top: '50%',
                         left: '50%',
                         transform: `translate(-50%, -50%) scale(${scale})`, 
                         transformOrigin: 'center center',
                         boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
                      }}
                      className="bg-background text-on-surface shadow-2xl overflow-hidden flex transition-colors duration-300 rounded-lg border border-border"
                   >
                        <div className="flex h-full w-full bg-background font-sans">
                            {/* REAL Sidebar Component */}
                            <Sidebar 
                                isExpanded={previewSidebarExpanded} 
                                setExpanded={setPreviewSidebarExpanded}
                                onNavigate={() => {}} // No-op for preview
                                currentView="dashboard"
                            />

                            <div className="flex-1 flex flex-col h-full overflow-hidden">
                                <div className="w-full px-4 sm:px-6 lg:px-8 py-8 h-full flex flex-col overflow-y-auto custom-scrollbar">
                                    {/* REAL Header Component */}
                                    <Header
                                        onToggleSidebar={() => setPreviewSidebarExpanded(!previewSidebarExpanded)}
                                        isSidebarExpanded={previewSidebarExpanded}
                                        onToggleDarkMode={() => {}} // No-op, visual change handled by theme
                                        isDarkMode={theme.mode === 'dark'}
                                        currentDate={new Date()}
                                        onCurrentDateChange={() => {}}
                                    />
                                    
                                    {/* Dashboard Layout */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
                                        <SummaryCard 
                                            title="Saldo Atual"
                                            value={12500.50} 
                                            trend="+2.5% desde o mês passado"
                                            icon={<WalletIcon />}
                                            color="blue"
                                        />
                                        <SummaryCard
                                            title="Receitas"
                                            value={8500.00}
                                            trend="Este mês"
                                            icon={<ArrowUpIcon />}
                                            color="green"
                                        />
                                        <SummaryCard
                                            title="Despesas"
                                            value={2650.50}
                                            trend="Este mês"
                                            icon={<ArrowDownIcon />}
                                            color="red"
                                        />
                                        <SummaryCard
                                            title="Investimentos"
                                            value={1000.00}
                                            trend="Rendimento: 8.5% a.a."
                                            icon={<ChartBarIcon />}
                                            color="indigo"
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
                                        <div className="lg:col-span-2">
                                            <TransactionsChart transactions={MOCK_TRANSACTIONS} />
                                        </div>
                                        <div className="lg:col-span-3">
                                            <RecentTransactions 
                                                transactions={MOCK_TRANSACTIONS} 
                                                onNewTransaction={() => {}} 
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                   </div>
                </div>
            </div>
             <style>{`
                /* Custom Scrollbar */
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: var(--color-border);
                    border-radius: 20px;
                }
            `}</style>
        </div>
    );
};

export default PersonalizationView;
