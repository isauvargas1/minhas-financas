
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { CreditCard, CreditCardVisual } from '../types.ts';
import { CreditCardIcon, WifiIcon } from './Icons.tsx';

interface CreditCard3DProps {
    card: CreditCard;
    mode: 'grid' | 'list';
    limits: {
        used: number;
        available: number;
    };
    onClick: () => void;
}

const DEFAULT_CREDIT_CARD_VISUAL: CreditCardVisual = {
    bgType: 'color',
    bgColor: '#1e293b',
    bgGradientColor: '#3b82f6',
    bgImage: '',
    textColor: 'white',
    showName: true,
    showBrand: true,
    showLogo: true,
};

const resolveCreditCardVisual = (
    visual: CreditCard['visual'],
): CreditCardVisual => ({
    bgType: visual?.bgType ?? DEFAULT_CREDIT_CARD_VISUAL.bgType,
    bgColor: visual?.bgColor ?? DEFAULT_CREDIT_CARD_VISUAL.bgColor,
    bgGradientColor: visual?.bgGradientColor ?? DEFAULT_CREDIT_CARD_VISUAL.bgGradientColor,
    bgImage: visual?.bgImage ?? DEFAULT_CREDIT_CARD_VISUAL.bgImage,
    textColor: visual?.textColor ?? DEFAULT_CREDIT_CARD_VISUAL.textColor,
    showName: visual?.showName ?? DEFAULT_CREDIT_CARD_VISUAL.showName,
    showBrand: visual?.showBrand ?? DEFAULT_CREDIT_CARD_VISUAL.showBrand,
    showLogo: visual?.showLogo ?? DEFAULT_CREDIT_CARD_VISUAL.showLogo,
});

const CreditCard3D: React.FC<CreditCard3DProps> = ({ card, mode, limits, onClick }) => {
    const [isHovered, setIsHovered] = useState(false);
    const MotionDiv = motion.div as any;
    const visual = resolveCreditCardVisual(card.visual);

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(val);
    };

    const getBackgroundStyle = () => {
        if (visual.bgType === 'image' && visual.bgImage) {
            return { backgroundImage: `url(${visual.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' };
        }
        if (visual.bgType === 'gradient' && visual.bgGradientColor) {
            return { background: `linear-gradient(135deg, ${visual.bgColor}, ${visual.bgGradientColor})` };
        }
        return { backgroundColor: visual.bgColor };
    };

    const textColorClass = visual.textColor === 'white' ? 'text-white' : 'text-gray-900';
    const borderColorClass = visual.textColor === 'white' ? 'border-white/20' : 'border-gray-900/20';

    // List View Render
    if (mode === 'list') {
        return (
            <div
                onClick={onClick}
                className="flex items-center justify-between p-4 bg-white dark:bg-dark-100 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-dark-200 cursor-pointer transition-colors"
            >
                <div className="flex items-center space-x-4">
                    {/* Mini Card Preview - Aspect Ratio 1.586 */}
                    <div
                        className="w-16 aspect-[1.586] rounded-md shadow-sm relative overflow-hidden flex-shrink-0"
                        style={getBackgroundStyle()}
                    >
                        <div className={`absolute bottom-1 right-1 text-[8px] font-bold ${textColorClass} opacity-80`}>
                            {card.brand}
                        </div>
                    </div>
                    <div>
                        <h3 className="font-semibold text-gray-800 dark:text-gray-200">{card.name}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{card.brand} • Final ****</p>
                    </div>
                </div>

                <div className="hidden sm:flex flex-col items-end">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {formatCurrency(limits.used)} <span className="text-gray-400 text-xs">/ {formatCurrency(card.limitTotal)}</span>
                    </div>
                    <div className="w-32 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full mt-1 overflow-hidden">
                        <div
                            className={`h-full rounded-full ${limits.available < 0 ? 'bg-red-500' : 'bg-indigo-500'}`}
                            style={{ width: `${Math.min(100, (limits.used / card.limitTotal) * 100)}%` }}
                        ></div>
                    </div>
                </div>

                <div className={`px-2 py-1 rounded-full text-xs font-medium ${card.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        card.status === 'blocked' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                            'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                    {card.status === 'active' ? 'Ativo' : card.status === 'blocked' ? 'Bloqueado' : 'Cancelado'}
                </div>
            </div>
        );
    }

    // Grid View Render (3D Flip)
    return (
        <div
            className="group perspective-1000 w-full max-w-[325px] aspect-[1.586] cursor-pointer mx-auto"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={onClick}
        >
            <MotionDiv
                className="relative w-full h-full transition-all duration-500 preserve-3d"
                animate={{ rotateY: isHovered ? 180 : 0 }}
                transition={{ duration: 0.6, type: "spring", stiffness: 260, damping: 20 }}
                style={{ transformStyle: 'preserve-3d' }}
            >
                {/* FRONT FACE */}
                <div
                    className="absolute inset-0 w-full h-full rounded-2xl shadow-xl overflow-hidden backface-hidden flex flex-col justify-between p-6"
                    style={{
                        ...getBackgroundStyle(),
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden' // Safari support
                    }}
                >
                    {/* Shine Effect Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                    <div className="flex justify-between items-start z-10">
                        {visual.showName && <span className={`font-medium tracking-wide ${textColorClass}`}>{card.name}</span>}
                        {visual.showLogo && <div className={`opacity-70 ${textColorClass}`}><WifiIcon className="w-6 h-6 rotate-90" /></div>}
                    </div>

                    <div className="z-10">
                        <div className="flex items-center gap-3 mb-4">
                            <div className={`w-10 h-7 bg-yellow-400/80 rounded-md backdrop-blur-sm border ${borderColorClass}`}></div>
                            <div className={`opacity-50 ${textColorClass}`}><WifiIcon className="w-5 h-5" /></div>
                        </div>
                        <div className={`text-xl font-mono tracking-widest ${textColorClass} opacity-90 mb-1`}>
                            **** **** **** 1234
                        </div>
                        <div className="flex justify-between items-end">
                            <div className={`text-xs ${textColorClass} opacity-80 uppercase`}>
                                {visual.showName ? 'Usuario' : ''}
                            </div>
                            {visual.showBrand && <span className={`font-bold italic text-lg ${textColorClass}`}>{card.brand}</span>}
                        </div>
                    </div>
                </div>

                {/* BACK FACE */}
                <div
                    className="absolute inset-0 w-full h-full rounded-2xl shadow-xl overflow-hidden backface-hidden flex flex-col bg-gray-800 p-6"
                    style={{
                        transform: 'rotateY(180deg)',
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden'
                    }}
                >
                    {/* Magnetic Strip */}
                    <div className="absolute top-4 left-0 right-0 h-10 bg-black/80" />

                    <div className="mt-12 flex flex-col h-full justify-between">
                        <div className="space-y-3">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-400">Limite Total</span>
                                <span className="text-white font-medium">{formatCurrency(card.limitTotal)}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-400">Utilizado</span>
                                <span className="text-red-400 font-medium">{formatCurrency(limits.used)}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-400">Disponível</span>
                                <span className="text-green-400 font-medium">{formatCurrency(limits.available)}</span>
                            </div>

                            {/* Progress Bar */}
                            <div className="w-full h-1.5 bg-gray-700 rounded-full mt-2 overflow-hidden">
                                <div
                                    className={`h-full rounded-full ${limits.available < 0 ? 'bg-red-500' : 'bg-indigo-500'}`}
                                    style={{ width: `${Math.min(100, (limits.used / card.limitTotal) * 100)}%` }}
                                ></div>
                            </div>
                        </div>

                        <div className="flex justify-between items-end border-t border-gray-700 pt-3">
                            <div>
                                <div className="text-[10px] text-gray-500 uppercase">Fechamento</div>
                                <div className="text-white font-bold text-lg">Dia {card.closingDay}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] text-gray-500 uppercase">Melhor Dia</div>
                                <div className="text-green-400 font-bold text-lg">Dia {card.bestDay || card.closingDay + 1}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </MotionDiv>
        </div>
    );
};

export default CreditCard3D;
