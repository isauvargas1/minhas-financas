/**
 * Chaves de dia e mês no fuso oficial do produto (INV-P2-048). A janela dos
 * relatórios é resolvida no servidor (P5-C1, `functions/src/reports/window.ts`);
 * aqui fica só a chave do mês corrente que o Dashboard escuta.
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
