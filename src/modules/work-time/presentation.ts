/**
 * Escolha entre dinheiro e tempo de trabalho na hora de exibir (P5-F).
 * Módulo PURO: sem React, sem Firebase, imports com extensão `.ts`.
 *
 * Sem configuração ativa (`config === null`), cada função devolve exatamente
 * o texto do formatador de dinheiro da tela, sem nenhuma mudança: é assim que
 * o modo dinheiro, o padrão, fica idêntico ao de antes. Com configuração, um
 * valor que não converte (inválido ou fora do intervalo seguro) também cai
 * no dinheiro. Nada aqui altera, arredonda ou agrega o valor financeiro.
 */
import {
  displayReaisToCents,
  formatWorkTimeCompact,
  presentWorkTime,
  workTimeEquivalent,
  type WorkTimeConfig,
  type WorkTimePresentation,
} from './calculation.ts';

export type CentsFormatter = (cents: number) => string;
export type ReaisFormatter = (reais: number) => string;

/** Apresentação em tempo, ou `null` quando o valor fica em dinheiro. */
export const workTimePresentationFor = (
  config: WorkTimeConfig | null,
  cents: number,
): WorkTimePresentation | null => (config ? presentWorkTime(cents, config) : null);

/** Apresentação em tempo de um valor de exibição em reais (`centavos ÷ 100`). */
export const workTimePresentationForReais = (
  config: WorkTimeConfig | null,
  reais: number,
): WorkTimePresentation | null => {
  if (!config) return null;
  const cents = displayReaisToCents(reais);
  return cents === null ? null : presentWorkTime(cents, config);
};

/** Rótulo de eixo de gráfico: no modo tempo, o formato compacto (horas inteiras). */
export const moneyOrWorkTimeAxisFromReais = (
  config: WorkTimeConfig | null,
  reais: number,
  formatMoney: ReaisFormatter,
): string => {
  const cents = config ? displayReaisToCents(reais) : null;
  if (!config || cents === null) return formatMoney(reais);
  const equivalent = workTimeEquivalent(cents, config);
  return equivalent.kind === 'unavailable' ? formatMoney(reais) : formatWorkTimeCompact(equivalent);
};

/** Texto de tooltip de gráfico: no modo tempo, tempo e reais lado a lado. */
export const moneyOrWorkTimeTooltipFromReais = (
  config: WorkTimeConfig | null,
  reais: number,
  formatMoney: ReaisFormatter,
): string => workTimePresentationForReais(config, reais)?.withMoney ?? formatMoney(reais);
