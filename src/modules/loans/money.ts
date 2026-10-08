/**
 * Conversões de valor e taxa dos formulários de empréstimo (P3-H).
 *
 * Módulo puro. Nenhuma conversão passa por ponto flutuante: o texto digitado
 * é lido por partes (inteiro e casas) e vira inteiro — centavos ou partes por
 * milhão. Precisão além do permitido é recusada, nunca arredondada: o que o
 * backend recebe é exatamente o que o usuário escreveu.
 */

/** Teto do backend por valor (R$ 1.000.000.000,00), em centavos. */
export const LOAN_MAX_CENTS = 100_000_000_000;
/** Teto do backend para a taxa: 100% ao período. */
export const LOAN_MAX_RATE_PPM = 1_000_000;
export const LOAN_MAX_INSTALLMENTS = 360;
export const RATE_PPM_PER_PERCENT = 10_000;

const NBSP = / /g;

/**
 * Valor em reais no formato brasileiro → centavos inteiros, ou `null`.
 *
 * Aceita `1234`, `1234,5`, `1.234,56` e `R$ 1.234,56`: vírgula para os
 * centavos (até duas casas) e ponto só como separador de milhar, em grupos de
 * três. Recusa sinal, expoente, ponto decimal (`10.50`), mais de duas casas
 * (`1,234`), grupos de milhar irregulares, zero (salvo `allowZero`) e acima do
 * teto do backend.
 */
export const parseBrlToCents = (
  input: string,
  options: { allowZero?: boolean } = {},
): number | null => {
  if (typeof input !== 'string') return null;
  const text = input.replace(NBSP, ' ').trim().replace(/^R\$\s*/, '');
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const [, integerText, decimals = ''] = match;
  const integerDigits = integerText.replace(/\./g, '');
  if (integerDigits.length > 12) return null;
  const cents = Number(integerDigits) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > LOAN_MAX_CENTS) return null;
  if (cents === 0 && !options.allowZero) return null;
  return cents;
};

/**
 * Percentual digitado → taxa em partes por milhão, ou `null`.
 *
 * `1,99` → 19.900; `12` → 120.000; `0,0001` → 1. Aceita vírgula ou ponto
 * como separador decimal (a taxa não tem milhar) e `%` no fim. Mais de quatro
 * casas não cabe em parte por milhão e é recusado; zero e acima de 100%
 * também.
 */
export const parsePercentToRatePpm = (input: string): number | null => {
  if (typeof input !== 'string') return null;
  const text = input.replace(NBSP, ' ').trim().replace(/\s*%$/, '');
  const match = /^(\d{1,3})(?:[.,](\d{1,4}))?$/.exec(text);
  if (!match) return null;
  const [, integerText, decimals = ''] = match;
  const ppm = Number(integerText) * RATE_PPM_PER_PERCENT +
    Number(decimals.padEnd(4, '0'));
  if (!Number.isSafeInteger(ppm) || ppm < 1 || ppm > LOAN_MAX_RATE_PPM) {
    return null;
  }
  return ppm;
};

const groupThousands = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Centavos → texto do campo (`1.234,56`), sem `R$`. Só para preencher. */
export const centsToInput = (cents: number): string => {
  if (!Number.isSafeInteger(cents) || cents < 0) return '';
  const reais = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${groupThousands(String(reais))},${String(rest).padStart(2, '0')}`;
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos → `R$ 1.234,56` para exibição. */
export const formatCents = (cents: number): string =>
  BRL.format((Number.isSafeInteger(cents) ? cents : 0) / 100);

/** Partes por milhão → `1,99%` (casas finais zeradas omitidas). */
export const formatRatePpm = (ratePpm: number): string => {
  const integer = Math.floor(ratePpm / RATE_PPM_PER_PERCENT);
  const decimals = String(ratePpm % RATE_PPM_PER_PERCENT)
    .padStart(4, '0').replace(/0+$/, '');
  return `${integer}${decimals ? `,${decimals}` : ''}%`;
};

/** `AAAA-MM-DD` → `DD/MM/AAAA`, sem fuso (a data é civil). */
export const formatDayKey = (dayKey: string | null | undefined): string => {
  if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return '—';
  const [year, month, day] = dayKey.split('-');
  return `${day}/${month}/${year}`;
};

/** Hoje (`AAAA-MM-DD`) em `America/Sao_Paulo`, como o backend valida. */
export const saoPauloToday = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

export const isDayKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
};

/**
 * Soma meses a uma data civil, recuando ao último dia do mês quando o dia não
 * existe (31/01 + 1 mês = 28 ou 29/02) — a mesma regra do backend. Usada só
 * para sugerir o primeiro vencimento no formulário.
 */
export const addMonthsToDayKey = (dayKey: string, months: number): string => {
  const [year, month, day] = dayKey.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(
    target.getUTCFullYear(), target.getUTCMonth() + 1, 0,
  )).getUTCDate();
  const resolved = Math.min(day, lastDay);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(resolved).padStart(2, '0')}`;
};
