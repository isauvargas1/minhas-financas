
import React from 'react';
import { SummaryCardProps } from '../types.ts';

const SummaryCard: React.FC<SummaryCardProps> = ({ title, value, trend, icon, color, isClickable, onClick }) => {
    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(val);
    };

    // Mapping specific colors to Tailwind classes, but leveraging theme structure where possible
    const colorClasses = {
        blue: {
            border: 'border-blue-500',
            iconBg: 'bg-blue-100 dark:bg-blue-900/30',
            iconText: 'text-blue-600 dark:text-blue-400',
            trendText: 'text-blue-600 dark:text-blue-400'
        },
        green: {
            border: 'border-green-500',
            iconBg: 'bg-green-100 dark:bg-green-900/30',
            iconText: 'text-green-600 dark:text-green-400',
            trendText: 'text-green-600 dark:text-green-400'
        },
        red: {
            border: 'border-red-500',
            iconBg: 'bg-red-100 dark:bg-red-900/30',
            iconText: 'text-red-600 dark:text-red-400',
            trendText: 'text-red-600 dark:text-red-400'
        },
        indigo: {
            border: 'border-indigo-500',
            iconBg: 'bg-indigo-100 dark:bg-indigo-900/30',
            iconText: 'text-indigo-600 dark:text-indigo-400',
            trendText: 'text-indigo-600 dark:text-indigo-400'
        },
        purple: {
            border: 'border-purple-500',
            iconBg: 'bg-purple-100 dark:bg-purple-900/30',
            iconText: 'text-purple-600 dark:text-purple-400',
            trendText: 'text-purple-600 dark:text-purple-400'
        }
    };

    const selectedColor = colorClasses[color];

    // Use 'bg-surface' and 'rounded-card' (mapped to --radius)
    const cardBaseClasses = `card bg-surface rounded-card shadow-md p-6 border-l-4 ${selectedColor.border}`;
    const clickableClasses = isClickable ? 'cursor-pointer' : '';

    return (
        <div
            className={`${cardBaseClasses} ${clickableClasses}`}
            onClick={isClickable ? onClick : undefined}
            role={isClickable ? "button" : "figure"}
            tabIndex={isClickable ? 0 : -1}
            onKeyDown={(e) => {
                if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
                    onClick?.();
                }
            }}
        >
            <div className="flex justify-between items-start mb-2">
                <h2 className="text-muted font-medium">{title}</h2>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${selectedColor.iconBg} ${selectedColor.iconText}`}>
                    {icon}
                </div>
            </div>
            <p className="text-3xl font-bold text-on-surface">{formatCurrency(value)}</p>
            <div className={`mt-2 text-sm ${selectedColor.trendText}`}>
                <span>{trend}</span>
            </div>
        </div>
    );
};

export default SummaryCard;
