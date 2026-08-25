import type { ReportTimeRange } from './types.ts';
/**
 * Recorte de janela de relatório no fuso oficial do produto (INV-P2-048).
 *
 * O domínio materializa **toda** chave de período em `America/Sao_Paulo`
 * (`functions/src/shared/dateKeys.ts`), e o recorte do frontend usava
 * `getUTCDate()`/`toISOString()`. Entre 21:00 e 23:59 BRT a data UTC já é a do
 * dia seguinte, e na virada do mês é o mês seguinte: a janela do relatório
 * incluía ou excluía um dia inteiro de movimentação em relação ao que o
 * backend gravou.
 *
 * O offset é resolvido pelo próprio formatador do runtime, o que mantém o
 * cálculo correto sob horário de verão — não há offset fixo escrito à mão.
 */

const BRAZIL_TIME_ZONE = 'America/Sao_Paulo';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BRAZIL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Chave `YYYY-MM-DD` do instante informado, em `America/Sao_Paulo`. */
export const saoPauloDayKey = (value: Date = new Date()): string =>
  dayFormatter.format(value);

/** Chave `YYYY-MM` do instante informado, em `America/Sao_Paulo`. */
export const saoPauloMonthKey = (value: Date = new Date()): string =>
  saoPauloDayKey(value).slice(0, 7);

/**
 * Data-only de hoje, decomposta, no fuso oficial.
 *
 * Serve de base para aritmética de calendário sem passar por UTC: somar e
 * subtrair dias sobre os componentes locais evita a virada de fuso.
 */
const todayParts = (reference: Date): {year: number; month: number; day: number} => {
  const [year, month, day] = saoPauloDayKey(reference).split('-').map(Number);
  return {year, month, day};
};

const toKey = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/**
 * Data-only resultante de deslocar o dia de hoje, no fuso oficial.
 *
 * A aritmética acontece sobre uma data UTC construída a partir dos componentes
 * **locais**, o que a torna imune ao deslocamento de fuso: o resultado é
 * lido de volta pelos mesmos componentes.
 */
export const shiftSaoPauloDays = (days: number, reference = new Date()): string => {
  const {year, month, day} = todayParts(reference);
  const anchor = new Date(Date.UTC(year, month - 1, day));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return toKey(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth() + 1,
    anchor.getUTCDate(),
  );
};

/** Primeiro dia do ano corrente, no fuso oficial. */
export const startOfSaoPauloYear = (reference = new Date()): string =>
  toKey(todayParts(reference).year, 1, 1);

/** Mesmo dia, um ano atrás, mais um dia — a janela de 12 meses do relatório. */
export const startOfSaoPauloTwelveMonths = (reference = new Date()): string => {
  const {year, month, day} = todayParts(reference);
  const anchor = new Date(Date.UTC(year - 1, month - 1, day));
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  return toKey(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth() + 1,
    anchor.getUTCDate(),
  );
};

/**
 * Início da janela de relatório, no fuso oficial do produto (INV-P2-048).
 *
 * O domínio materializa toda chave de período em `America/Sao_Paulo`, e o
 * recorte usava `toISOString()` e `getDate()` do fuso do navegador. Entre 21:00
 * e 23:59 BRT a data UTC já é a do dia seguinte, e na virada do mês é o mês
 * seguinte: a janela incluía ou excluía um dia inteiro de movimentação em
 * relação ao que o backend gravou. Um usuário no exterior via ainda outra
 * janela.
 *
 * As comparações passam a ser entre strings `YYYY-MM-DD`, que é o formato do
 * próprio campo `date` da transação — sem construir `Date` intermediário e sem
 * reintroduzir fuso.
 */
export const reportWindowStart = (
    range: ReportTimeRange,
    reference = new Date(),
): string | undefined => {
    switch (range) {
        case '7d': return shiftSaoPauloDays(-7, reference);
        case '30d': return shiftSaoPauloDays(-30, reference);
        case '90d': return shiftSaoPauloDays(-90, reference);
        case '12m': return shiftSaoPauloDays(-365, reference);
        case 'ytd': return startOfSaoPauloYear(reference);
        case 'all': return undefined;
        default: return shiftSaoPauloDays(-30, reference);
    }
};

