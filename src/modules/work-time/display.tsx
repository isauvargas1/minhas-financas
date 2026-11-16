import React, { createContext, useContext, useMemo } from 'react';

import { formatCentsBRL } from '../../lib/money';
import type { WorkTimeConfig, WorkTimePresentation } from './calculation';
import {
  moneyOrWorkTimeAxisFromReais,
  moneyOrWorkTimeTooltipFromReais,
  workTimePresentationFor,
  workTimePresentationForReais,
  type CentsFormatter,
  type ReaisFormatter,
} from './presentation';
import { useOptionalWorkTime } from './WorkTimeContext';

/**
 * Camada de exibição do tempo de trabalho equivalente (P5-F).
 *
 * Cada tela pede `useMoneyDisplay()` e troca, só nos pontos elegíveis da
 * matriz (`docs/production/evidence/p5f/matriz-cobertura.md`), a chamada do
 * próprio formatador por `display.cents(valor, formatador)`. No modo
 * dinheiro, o padrão, o resultado é exatamente o texto do formatador da tela,
 * sem elemento novo. No modo tempo, o valor vira `≈ 11 h 30 min`, com o valor
 * exato em reais no `title` e no texto para leitores de tela. Os dados, os
 * filtros, as ordenações e os cálculos continuam em centavos.
 */

const ForceMoneyContext = createContext(false);

/** Força dinheiro numa subárvore (prévias com dados fictícios, confirmações). */
export const ForceMoneyDisplay: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ForceMoneyContext.Provider value>{children}</ForceMoneyContext.Provider>
);

/** Subárvore forçada em dinheiro (o Header da prévia do tema esconde o alternador e o aviso). */
export const useIsMoneyForced = (): boolean => useContext(ForceMoneyContext);

/**
 * `relative` prende o `sr-only` (posição absoluta) ao próprio valor: dentro de
 * uma tabela com rolagem horizontal, ele fica recortado com a tabela em vez de
 * alargar a página.
 */
const WorkTimeAmount: React.FC<{ presentation: WorkTimePresentation }> = ({ presentation }) => (
  <span data-work-time="" title={presentation.hint} className="relative">
    <span aria-hidden="true">{presentation.short}</span>
    <span className="sr-only">{presentation.spoken}</span>
  </span>
);

export interface MoneyDisplay {
  /** Modo tempo ativo nesta tela. */
  isTime: boolean;
  /** Valor em centavos para JSX. */
  cents: (cents: number, formatMoney?: CentsFormatter) => React.ReactNode;
  /** Valor de exibição em reais (`centavos ÷ 100`, adaptadores e gráficos) para JSX. */
  reais: (reais: number, formatMoney: ReaisFormatter) => React.ReactNode;
  /** Rótulo de eixo de gráfico: no modo tempo, horas inteiras (`≈ 124 h`), que cabem no eixo. */
  reaisAxis: (reais: number, formatMoney: ReaisFormatter) => string;
  /** Tooltip de gráfico: no modo tempo, tempo e reais lado a lado. */
  reaisTooltip: (reais: number, formatMoney: ReaisFormatter) => string;
}

const createMoneyDisplay = (config: WorkTimeConfig | null): MoneyDisplay => ({
  isTime: config !== null,
  cents: (cents, formatMoney = formatCentsBRL) => {
    const presentation = workTimePresentationFor(config, cents);
    return presentation ? <WorkTimeAmount presentation={presentation} /> : formatMoney(cents);
  },
  reais: (reais, formatMoney) => {
    const presentation = workTimePresentationForReais(config, reais);
    return presentation ? <WorkTimeAmount presentation={presentation} /> : formatMoney(reais);
  },
  reaisAxis: (reais, formatMoney) => moneyOrWorkTimeAxisFromReais(config, reais, formatMoney),
  reaisTooltip: (reais, formatMoney) => moneyOrWorkTimeTooltipFromReais(config, reais, formatMoney),
});

export const useMoneyDisplay = (): MoneyDisplay => {
  const workTime = useOptionalWorkTime();
  const forcedMoney = useContext(ForceMoneyContext);
  const config = !forcedMoney && workTime?.displayMode === 'time' ? workTime.config : null;
  return useMemo(() => createMoneyDisplay(config), [config]);
};
