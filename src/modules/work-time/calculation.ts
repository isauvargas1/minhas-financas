/**
 * Tempo de trabalho equivalente (P5-F, REQ-FUT-01; P5-F.1): cálculo e
 * formatação. Módulo PURO: sem React, sem Firebase, imports com extensão
 * `.ts` — roda direto no runner do Node.
 *
 * É só uma comparação informativa: quantos minutos de trabalho planejado
 * correspondem a um valor em dinheiro, pela renda e pelas horas de um mesmo
 * período. Não é custo contábil, preço do trabalho, salário líquido,
 * produtividade nem retorno. O dinheiro continua sendo a fonte de verdade:
 * nada daqui é gravado, enviado ao backend ou usado para filtrar, ordenar,
 * agregar ou calcular valores financeiros.
 *
 * Desde a P5-F.1 a configuração vem da estimativa automática (`estimate.ts`):
 * a renda elegível do período, em centavos, vem do relatório oficial, e os
 * minutos, do calendário do usuário para os mesmos meses. A fórmula, toda em
 * inteiros (BigInt no meio do caminho), não mudou:
 *
 *   minutos = valorEmCentavos × minutosDoPeríodo ÷ rendaDoPeríodoEmCentavos
 *
 * arredondada ao minuto mais próximo; o meio minuto arredonda para longe de
 * zero (2,5 → 3 e −2,5 → −3), então um valor negativo é sempre o espelho do
 * positivo. Um valor diferente de zero que arredonda para 0 vira "menos de
 * 1 minuto", nunca "0 min".
 */
import { formatCentsBRL, isMoneyCents } from '../../lib/money.ts';

/** Maior janela da estimativa: 12 meses. */
export const WORK_TIME_MAX_WINDOW_MONTHS = 12;
/** Renda mínima do período: R$ 1,00. */
export const WORK_TIME_MIN_INCOME_CENTS = 100;
/** Renda máxima do período: R$ 100.000.000,00 por mês, em 12 meses. */
export const WORK_TIME_MAX_INCOME_CENTS = 10_000_000_000 * WORK_TIME_MAX_WINDOW_MONTHS;
/** Horas mínimas do período: 1 hora. */
export const WORK_TIME_MIN_WORK_MINUTES = 60;
/** Horas máximas do período: as 24 horas dos 31 dias de cada um de 12 meses. */
export const WORK_TIME_MAX_WORK_MINUTES = 744 * 60 * WORK_TIME_MAX_WINDOW_MONTHS;
/**
 * Teto dos valores de exibição em reais que voltam a centavos
 * (`displayReaisToCents`): 10 trilhões de reais, ou 10^15 centavos. Abaixo
 * dele, `Math.round(reais × 100)` devolve exatamente os centavos que geraram
 * `centavos ÷ 100`.
 */
export const WORK_TIME_MAX_DISPLAY_REAIS = 10_000_000_000_000;

/** Renda e minutos do mesmo período (a estimativa ativa). */
export interface WorkTimeConfig {
  incomeCents: number;
  workMinutes: number;
}

export type WorkTimeConfigIssue =
  | 'income_invalid'
  | 'income_too_low'
  | 'income_too_high'
  | 'minutes_invalid'
  | 'minutes_too_low'
  | 'minutes_too_high'
  | 'hourly_rate_too_low';

const isSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

/**
 * Primeiro problema da configuração, ou `null` quando ela é válida. Além dos
 * limites de cada campo, o valor por hora precisa dar pelo menos R$ 0,01:
 * `renda × 60 ≥ minutos`.
 */
export const checkWorkTimeConfig = (config: WorkTimeConfig): WorkTimeConfigIssue | null => {
  const { incomeCents: income, workMinutes: minutes } = config;
  if (!isSafeInteger(income)) return 'income_invalid';
  if (income < WORK_TIME_MIN_INCOME_CENTS) return 'income_too_low';
  if (income > WORK_TIME_MAX_INCOME_CENTS) return 'income_too_high';
  if (!isSafeInteger(minutes)) return 'minutes_invalid';
  if (minutes < WORK_TIME_MIN_WORK_MINUTES) return 'minutes_too_low';
  if (minutes > WORK_TIME_MAX_WORK_MINUTES) return 'minutes_too_high';
  if (income * 60 < minutes) return 'hourly_rate_too_low';
  return null;
};

export const isValidWorkTimeConfig = (config: WorkTimeConfig): boolean =>
  checkWorkTimeConfig(config) === null;

export type WorkTimeEquivalent =
  | { kind: 'zero' }
  | { kind: 'under_a_minute'; negative: boolean }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'unavailable' };

const ZERO = BigInt(0);
const TWO = BigInt(2);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Divisão inteira arredondada ao mais próximo; o meio vai para cima (operandos ≥ 0). */
const roundedQuotient = (numerator: bigint, denominator: bigint): bigint =>
  (TWO * numerator + denominator) / (TWO * denominator);

/**
 * Equivalente em minutos de trabalho de um valor em centavos. `unavailable`
 * quando o valor não é um inteiro seguro, quando a configuração é inválida
 * ou quando o resultado passaria do maior inteiro seguro: quem exibe mostra
 * o valor em dinheiro.
 */
export const workTimeEquivalent = (amountCents: number, config: WorkTimeConfig): WorkTimeEquivalent => {
  if (!isMoneyCents(amountCents) || !isValidWorkTimeConfig(config)) return { kind: 'unavailable' };
  if (amountCents === 0) return { kind: 'zero' };
  const negative = amountCents < 0;
  const magnitude = BigInt(Math.abs(amountCents));
  const minutes = roundedQuotient(
    magnitude * BigInt(config.workMinutes),
    BigInt(config.incomeCents),
  );
  if (minutes === ZERO) return { kind: 'under_a_minute', negative };
  if (minutes > MAX_SAFE) return { kind: 'unavailable' };
  const value = Number(minutes);
  return { kind: 'minutes', minutes: negative ? -value : value };
};

/**
 * Valor estimado de uma hora: renda × 60 ÷ minutos, arredondado ao centavo
 * mais próximo (o meio vai para cima). `null` com configuração inválida.
 */
export const workTimeHourlyRateCents = (config: WorkTimeConfig): number | null => {
  if (!isValidWorkTimeConfig(config)) return null;
  return Number(roundedQuotient(
    BigInt(config.incomeCents) * BigInt(60),
    BigInt(config.workMinutes),
  ));
};

/**
 * Volta a centavos um valor de exibição em reais que veio de `centavos ÷ 100`
 * (adaptador dos Relatórios, gráficos). É exato até `WORK_TIME_MAX_DISPLAY_REAIS`;
 * fora disso, ou com valor não finito, devolve `null` e quem exibe mantém o
 * dinheiro. Serve só para exibir: nenhum cálculo financeiro passa por aqui.
 */
export const displayReaisToCents = (reais: number): number | null => {
  if (typeof reais !== 'number' || !Number.isFinite(reais)) return null;
  if (Math.abs(reais) > WORK_TIME_MAX_DISPLAY_REAIS) return null;
  const cents = Math.round(reais * 100);
  return cents === 0 ? 0 : cents;
};

const NBSP = ' ';
const integerFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

type ShownEquivalent = Exclude<WorkTimeEquivalent, { kind: 'unavailable' }>;

const splitMinutes = (minutes: number): { hours: number; rest: number } => {
  const magnitude = Math.abs(minutes);
  return { hours: Math.floor(magnitude / 60), rest: magnitude % 60 };
};

/**
 * Texto curto, sem quebra de linha: `≈ 11 h 30 min`, `≈ 2 h`, `≈ 45 min`,
 * `-≈ 1.234 h 5 min`, `< 1 min`, `-< 1 min` e `0 min`. O `≈` marca a
 * estimativa e o sinal vem antes dele, como em `-R$ 1,00`.
 */
export const formatWorkTime = (equivalent: ShownEquivalent): string => {
  if (equivalent.kind === 'zero') return `0${NBSP}min`;
  if (equivalent.kind === 'under_a_minute') {
    return `${equivalent.negative ? '-' : ''}<${NBSP}1${NBSP}min`;
  }
  const { hours, rest } = splitMinutes(equivalent.minutes);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${integerFormatter.format(hours)}${NBSP}h`);
  if (rest > 0) parts.push(`${rest}${NBSP}min`);
  return `${equivalent.minutes < 0 ? '-' : ''}≈${NBSP}${parts.join(NBSP)}`;
};

/**
 * Rótulo compacto para eixo de gráfico, onde cabem poucos caracteres: horas
 * inteiras arredondadas ao mais próximo (`≈ 124 h`, `-≈ 1.234 h`) e, abaixo
 * de uma hora, minutos (`≈ 45 min`). O valor completo fica no tooltip.
 */
export const formatWorkTimeCompact = (equivalent: ShownEquivalent): string => {
  if (equivalent.kind === 'zero') return `0${NBSP}h`;
  if (equivalent.kind === 'under_a_minute') return formatWorkTime(equivalent);
  const magnitude = Math.abs(equivalent.minutes);
  const sign = equivalent.minutes < 0 ? '-' : '';
  if (magnitude < 60) return `${sign}≈${NBSP}${magnitude}${NBSP}min`;
  const hours = Number((BigInt(magnitude) + BigInt(30)) / BigInt(60));
  return `${sign}≈${NBSP}${integerFormatter.format(hours)}${NBSP}h`;
};

const plural = (count: number, singular: string, pluralForm: string): string =>
  `${integerFormatter.format(count)} ${count === 1 ? singular : pluralForm}`;

/** Descrição por extenso, para leitores de tela. */
export const describeWorkTime = (equivalent: ShownEquivalent): string => {
  if (equivalent.kind === 'zero') return '0 minutos de trabalho';
  if (equivalent.kind === 'under_a_minute') {
    return `${equivalent.negative ? 'valor negativo de ' : ''}menos de 1 minuto de trabalho`;
  }
  const { hours, rest } = splitMinutes(equivalent.minutes);
  const parts: string[] = [];
  if (hours > 0) parts.push(plural(hours, 'hora', 'horas'));
  if (rest > 0) parts.push(plural(rest, 'minuto', 'minutos'));
  return `${equivalent.minutes < 0 ? 'valor negativo de ' : ''}aproximadamente ${parts.join(' e ')} de trabalho`;
};

export interface WorkTimePresentation {
  /** Texto visível (`≈ 11 h 30 min`). */
  short: string;
  /** Texto para leitores de tela, com o valor exato em reais. */
  spoken: string;
  /** Dica ao passar o mouse, com o valor exato em reais. */
  hint: string;
  /** Texto para tooltip de gráfico: tempo e reais lado a lado. */
  withMoney: string;
}

/**
 * Tudo que a interface mostra de um valor no modo tempo, ou `null` quando ele
 * não pode ser convertido (a interface mostra o dinheiro).
 */
export const presentWorkTime = (amountCents: number, config: WorkTimeConfig): WorkTimePresentation | null => {
  const equivalent = workTimeEquivalent(amountCents, config);
  if (equivalent.kind === 'unavailable') return null;
  const money = formatCentsBRL(amountCents);
  const short = formatWorkTime(equivalent);
  return {
    short,
    spoken: `${describeWorkTime(equivalent)}, equivalente a ${money}`,
    hint: `${money} · tempo de trabalho estimado`,
    withMoney: `${short} (${money})`,
  };
};
