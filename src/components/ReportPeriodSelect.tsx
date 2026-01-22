
import React, { useState, useRef, useEffect } from 'react';
import { ReportTimeRange } from '../modules/reports/types.ts';
import { CalendarIcon, SortDownIcon, CheckIcon } from './Icons.tsx';

interface ReportPeriodSelectProps {
    value: ReportTimeRange;
    onChange: (value: ReportTimeRange) => void;
    options: { label: string; value: ReportTimeRange; disabled?: boolean }[];
}

const ReportPeriodSelect: React.FC<ReportPeriodSelectProps> = ({ value, onChange, options }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(o => o.value === value);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            setIsOpen(!isOpen);
        } else if (e.key === 'Escape') {
            setIsOpen(false);
        }
    };

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                onKeyDown={handleKeyDown}
                className={`
                    flex items-center justify-between gap-3
                    h-10 px-3 pl-4 min-w-[220px]
                    bg-surface border rounded-lg
                    text-sm font-medium
                    transition-all duration-200 ease-in-out
                    outline-none
                    focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background
                    ${isOpen 
                        ? 'border-primary ring-2 ring-primary/10 text-primary' 
                        : 'border-border text-on-surface hover:border-primary/50'
                    }
                `}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-label="Selecionar período do relatório"
            >
                <div className="flex items-center gap-2.5 truncate">
                    <CalendarIcon className={`h-4 w-4 ${isOpen ? 'text-primary' : 'text-muted'}`} />
                    <span className="truncate">{selectedOption?.label || 'Selecione o período'}</span>
                </div>
                <SortDownIcon 
                    className={`
                        h-4 w-4 text-muted flex-shrink-0 transition-transform duration-200 
                        ${isOpen ? 'rotate-180 text-primary' : ''}
                    `} 
                />
            </button>

            {isOpen && (
                <div 
                    className="absolute top-full mt-2 w-full min-w-[240px] right-0 z-50 bg-surface border border-border rounded-lg shadow-xl overflow-hidden animate-fade-in origin-top"
                    role="listbox"
                >
                    <div className="py-1 max-h-80 overflow-y-auto custom-scrollbar">
                        {options.map((option) => {
                            const isSelected = option.value === value;
                            return (
                                <button
                                    key={option.value}
                                    onClick={() => {
                                        if (!option.disabled) {
                                            onChange(option.value);
                                            setIsOpen(false);
                                        }
                                    }}
                                    disabled={option.disabled}
                                    className={`
                                        w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-all duration-150 outline-none
                                        focus-visible:bg-primary/5 focus-visible:text-primary
                                        ${option.disabled 
                                            ? 'opacity-50 cursor-not-allowed text-muted bg-background/50' 
                                            : 'cursor-pointer hover:bg-primary/10 hover:text-primary'
                                        }
                                        ${isSelected 
                                            ? 'bg-primary/5 text-primary font-semibold' 
                                            : 'text-on-surface'
                                        }
                                    `}
                                    role="option"
                                    aria-selected={isSelected}
                                >
                                    <span className="truncate mr-2">{option.label}</span>
                                    {isSelected && <CheckIcon className="h-4 w-4 flex-shrink-0" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReportPeriodSelect;
