
import React, { useState, useRef, useEffect, useId } from 'react';
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
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listId = useId();

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

    /*
     * P5-GATE-FINAL (PTBR-05): o seletor é um botão que mostra e esconde a lista de períodos (padrão de divulgação),
     * só com botões nativos. Enter e Espaço são do próprio botão: o `keydown` não alterna mais (alternava, e o
     * clique nativo alternava de novo, então o seletor não abria pelo teclado). Escape fecha a lista aberta, de
     * qualquer ponto dela, e devolve o foco ao botão; escolher um período também; sair dela pelo Tab a fecha.
     */
    const closeToTrigger = () => {
        setIsOpen(false);
        triggerRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape' && isOpen) {
            e.preventDefault();
            closeToTrigger();
        }
    };

    /*
     * P5-GATE-FINAL (2ª revisão, PTBR2-02/03/07): no tema escuro, o destaque usa a cor de primeiro plano legível
     * (`primary-on-dark`, a mesma do painel de notificações); a opção com foco tem anel (a selecionada também, e o
     * fundo dela era igual ao do foco); e o `mousedown` numa opção não move o foco, para que, nos navegadores em que
     * o clique não foca o botão, a saída do foco não feche a lista antes do clique.
     */
    const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
        if (isOpen && !e.currentTarget.contains(e.relatedTarget as Node | null)) setIsOpen(false);
    };

    return (
        <div className="relative" ref={containerRef} onKeyDown={handleKeyDown} onBlur={handleBlur}>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    flex items-center justify-between gap-3
                    h-10 px-3 pl-4 min-w-[220px]
                    bg-surface border rounded-lg
                    text-sm font-medium
                    transition-all duration-200 ease-in-out
                    outline-none
                    focus-visible:ring-2 focus-visible:ring-primary dark:focus-visible:ring-primary-on-dark focus-visible:ring-offset-2 focus-visible:ring-offset-background
                    ${isOpen 
                        ? 'border-primary ring-2 ring-primary/10 text-primary dark:text-primary-on-dark'
                        : 'border-border text-on-surface hover:border-primary/50'
                    }
                `}
                aria-expanded={isOpen}
                aria-controls={isOpen ? listId : undefined}
            >
                <div className="flex items-center gap-2.5 truncate">
                    <CalendarIcon className={`h-4 w-4 ${isOpen ? 'text-primary dark:text-primary-on-dark' : 'text-muted'}`} />
                    {/* O nome acessível contém o texto visível (WCAG 2.5.3): "Período do relatório: <período>". */}
                    <span className="sr-only">Período do relatório: </span>
                    <span className="truncate">{selectedOption?.label || 'Selecione o período'}</span>
                </div>
                <SortDownIcon 
                    className={`
                        h-4 w-4 text-muted flex-shrink-0 transition-transform duration-200 
                        ${isOpen ? 'rotate-180 text-primary dark:text-primary-on-dark' : ''}
                    `} 
                />
            </button>

            {isOpen && (
                <div 
                    id={listId}
                    className="absolute top-full mt-2 w-full min-w-[240px] right-0 z-50 bg-surface border border-border rounded-lg shadow-xl overflow-hidden animate-fade-in origin-top"
                    role="group"
                    aria-label="Períodos do relatório"
                >
                    <div className="py-1 max-h-80 overflow-y-auto custom-scrollbar">
                        {options.map((option) => {
                            const isSelected = option.value === value;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                        if (!option.disabled) {
                                            onChange(option.value);
                                            closeToTrigger();
                                        }
                                    }}
                                    disabled={option.disabled}
                                    className={`
                                        w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-all duration-150 outline-none
                                        focus-visible:text-primary dark:focus-visible:text-primary-on-dark focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary dark:focus-visible:ring-primary-on-dark
                                        ${option.disabled 
                                            ? 'opacity-50 cursor-not-allowed text-muted bg-background/50' 
                                            : 'cursor-pointer hover:bg-primary/10 hover:text-primary dark:hover:text-primary-on-dark'
                                        }
                                        ${isSelected 
                                            ? 'bg-primary/5 text-primary dark:text-primary-on-dark font-semibold'
                                            : 'text-on-surface'
                                        }
                                    `}
                                    aria-current={isSelected ? 'true' : undefined}
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
