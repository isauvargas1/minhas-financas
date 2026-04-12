import React from 'react';
import { DynamicIcon } from './Icons.tsx';
import type { ResolvedCatalogVisual } from '../modules/settings-catalog/display.ts';

interface CatalogVisualChipProps {
    visual: ResolvedCatalogVisual | null;
    fallbackLabel?: string;
    className?: string;
}

const CatalogVisualChip: React.FC<CatalogVisualChipProps> = ({
    visual,
    fallbackLabel,
    className = '',
}) => {
    const label = visual?.label || fallbackLabel || '—';
    const color = visual?.color || '#6b7280';

    return (
        <span
            className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
            style={{
                backgroundColor: `${color}1A`,
                color,
            }}
        >
            {visual?.icon ? (
                <DynamicIcon name={visual.icon} size={14} color={color} />
            ) : (
                <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: color }}
                />
            )}
            <span>{label}</span>
        </span>
    );
};

export default CatalogVisualChip;