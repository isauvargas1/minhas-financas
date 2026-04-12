import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EntityItem } from '../types.ts';
import { SearchIcon } from './Icons.tsx';
import { normalizeSettingsCatalogName } from '../modules/settings-catalog/utils.ts';

interface CatalogComboboxProps {
    label: string;
    required?: boolean;
    value: string;
    options: EntityItem[];
    placeholder?: string;
    disabled?: boolean;
    loading?: boolean;
    emptyText?: string;
    helperText?: string;
    inputClassName: string;
    onValueChange: (value: string) => void;
    onCommitValue: (value: string) => Promise<string | void>;
}

const MAX_VISIBLE_OPTIONS = 8;

const CatalogCombobox: React.FC<CatalogComboboxProps> = ({
    label,
    required = false,
    value,
    options,
    placeholder = 'Busque ou digite...',
    disabled = false,
    loading = false,
    emptyText = 'Nenhum item encontrado.',
    helperText,
    inputClassName,
    onValueChange,
    onCommitValue,
}) => {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const blurTimeoutRef = useRef<number | null>(null);

    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [isCommitting, setIsCommitting] = useState(false);

    const uniqueOptions = useMemo(() => {
        const map = new Map<string, EntityItem>();

        options.forEach((item) => {
            const key = normalizeSettingsCatalogName(item.name);
            if (!map.has(key)) {
                map.set(key, item);
            }
        });

        return Array.from(map.values());
    }, [options]);

    const filteredOptions = useMemo(() => {
        const normalizedValue = normalizeSettingsCatalogName(value);

        const ranked = [...uniqueOptions].sort((a, b) => {
            const aName = normalizeSettingsCatalogName(a.name);
            const bName = normalizeSettingsCatalogName(b.name);

            const aStarts = normalizedValue ? aName.startsWith(normalizedValue) : false;
            const bStarts = normalizedValue ? bName.startsWith(normalizedValue) : false;

            if (aStarts !== bStarts) return aStarts ? -1 : 1;

            return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
        });

        if (!normalizedValue) {
            return ranked.slice(0, MAX_VISIBLE_OPTIONS);
        }

        return ranked
            .filter((item) =>
                normalizeSettingsCatalogName(item.name).includes(normalizedValue)
            )
            .slice(0, MAX_VISIBLE_OPTIONS);
    }, [uniqueOptions, value]);

    const exactMatch = useMemo(() => {
        const normalizedValue = normalizeSettingsCatalogName(value);

        if (!normalizedValue) return undefined;

        return uniqueOptions.find(
            (item) => normalizeSettingsCatalogName(item.name) === normalizedValue
        );
    }, [uniqueOptions, value]);

    const showCreateHint =
        value.trim().length > 0 && !exactMatch && !loading && !isCommitting;

    useEffect(() => {
        if (!isOpen) {
            setHighlightedIndex(-1);
            return;
        }

        if (filteredOptions.length === 0) {
            setHighlightedIndex(-1);
            return;
        }

        if (highlightedIndex >= filteredOptions.length) {
            setHighlightedIndex(0);
        }
    }, [isOpen, filteredOptions, highlightedIndex]);

    useEffect(() => {
        return () => {
            if (blurTimeoutRef.current) {
                window.clearTimeout(blurTimeoutRef.current);
            }
        };
    }, []);

    const commitCurrentValue = async () => {
        const trimmed = value.trim();

        if (!trimmed) return;

        setIsCommitting(true);

        try {
            const resolvedValue = await onCommitValue(trimmed);

            if (typeof resolvedValue === 'string' && resolvedValue !== value) {
                onValueChange(resolvedValue);
            }
        } finally {
            setIsCommitting(false);
        }
    };

    const handleSelectOption = async (itemName: string) => {
        onValueChange(itemName);
        setIsOpen(false);
        setHighlightedIndex(-1);

        setIsCommitting(true);

        try {
            const resolvedValue = await onCommitValue(itemName);

            if (typeof resolvedValue === 'string' && resolvedValue !== itemName) {
                onValueChange(resolvedValue);
            }
        } finally {
            setIsCommitting(false);
        }
    };

    const handleBlur = () => {
        blurTimeoutRef.current = window.setTimeout(() => {
            setIsOpen(false);
            void commitCurrentValue();
        }, 140);
    };

    const handleFocus = () => {
        setIsOpen(true);
    };

    const handleKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((prev) => {
                if (filteredOptions.length === 0) return -1;
                if (prev < 0) return 0;
                return Math.min(prev + 1, filteredOptions.length - 1);
            });
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((prev) => {
                if (filteredOptions.length === 0) return -1;
                if (prev < 0) return filteredOptions.length - 1;
                return Math.max(prev - 1, 0);
            });
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            setIsOpen(false);
            setHighlightedIndex(-1);
            inputRef.current?.blur();
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();

            if (isOpen && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
                await handleSelectOption(filteredOptions[highlightedIndex].name);
                return;
            }

            setIsOpen(false);
            await commitCurrentValue();
        }
    };

    return (
        <div ref={wrapperRef}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {label} {required && <span className="text-red-500">*</span>}
            </label>

            <div className="relative">
                <div className="absolute left-3 top-2.5 text-gray-400 dark:text-gray-500 pointer-events-none">
                    <SearchIcon className="h-5 w-5" />
                </div>

                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    disabled={disabled || isCommitting}
                    placeholder={placeholder}
                    className={`${inputClassName} pl-10 pr-10`}
                    role="combobox"
                    aria-expanded={isOpen}
                    aria-autocomplete="list"
                    aria-controls="catalog-combobox-listbox"
                    onChange={(e) => {
                        onValueChange(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                />

                <button
                    type="button"
                    tabIndex={-1}
                    className="absolute right-3 top-2.5 text-gray-400 dark:text-gray-500"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setIsOpen((prev) => !prev)}
                >
                    <span className="text-xs">▼</span>
                </button>

                {isOpen && (
                    <div
                        id="catalog-combobox-listbox"
                        role="listbox"
                        className="absolute z-50 mt-2 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-100 shadow-xl overflow-hidden"
                    >
                        <div className="max-h-72 overflow-y-auto">
                            {filteredOptions.length > 0 ? (
                                filteredOptions.map((item, index) => {
                                    const isHighlighted = index === highlightedIndex;

                                    return (
                                        <button
                                            key={`${item.id}-${item.name}`}
                                            type="button"
                                            role="option"
                                            aria-selected={isHighlighted}
                                            className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                                                isHighlighted
                                                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                                    : 'text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-dark-200'
                                            }`}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => void handleSelectOption(item.name)}
                                        >
                                            {item.name}
                                        </button>
                                    );
                                })
                            ) : (
                                <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                                    {emptyText}
                                </div>
                            )}

                            {showCreateHint && (
                                <button
                                    type="button"
                                    className="w-full text-left px-4 py-3 text-sm border-t border-gray-100 dark:border-gray-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => void commitCurrentValue()}
                                >
                                    Criar e usar “{value.trim()}”
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {(helperText || isCommitting || loading) && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {isCommitting
                        ? 'Validando no catálogo...'
                        : loading
                        ? 'Atualizando catálogo...'
                        : helperText}
                </p>
            )}
        </div>
    );
};

export default CatalogCombobox;