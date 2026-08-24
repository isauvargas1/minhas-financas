/**
 * Chaves determinísticas de dia e mês no fuso oficial do produto.
 *
 * Todo corte de período do domínio financeiro usa `America/Sao_Paulo`. Derivar
 * a chave a partir de `toISOString()` coloca um movimento liquidado entre
 * 21:00 e 23:59 BRT no dia seguinte — e, na virada do mês, no mês seguinte.
 * Como as projeções mensais usam a chave como ID de documento e acumulam por
 * incremento, essa atribuição errada não é corrigível sem reconstrução.
 */

const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRAZIL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Chave `YYYY-MM-DD` do instante informado em `America/Sao_Paulo`. */
export const saoPauloDayKey = (value: Date = new Date()): string =>
  dayFormatter.format(value);

/** Chave `YYYY-MM` do instante informado em `America/Sao_Paulo`. */
export const saoPauloMonthKey = (value: Date = new Date()): string =>
  saoPauloDayKey(value).slice(0, 7);

/**
 * Instante UTC correspondente ao início do dia `YYYY-MM-DD` em São Paulo.
 *
 * O offset é resolvido a partir do próprio formatador, e não de uma constante
 * `-03:00`, para permanecer correto caso o horário de verão volte a existir.
 */
export const saoPauloDayStart = (dayKey: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new Error(`Chave de dia inválida: ${dayKey}`);
  }
  const hourMs = 3_600_000;
  const naiveUtc = new Date(`${dayKey}T00:00:00.000Z`);
  // `naiveUtc` interpretado em São Paulo devolve o relógio de parede daquele
  // instante; a diferença para a meia-noite pretendida é o offset do fuso.
  const offsetMs = naiveUtc.getTime() - localAsUtc(naiveUtc).getTime();
  let candidate = new Date(naiveUtc.getTime() + offsetMs);
  // Na entrada do horário de verão a meia-noite local não existe. Caminha em
  // passos de uma hora até cair no dia pretendido e depois recua até a
  // primeira hora que ainda pertence a ele.
  for (let step = 0; step < 8 && saoPauloDayKey(candidate) !== dayKey; step++) {
    const direction = saoPauloDayKey(candidate) < dayKey ? hourMs : -hourMs;
    candidate = new Date(candidate.getTime() + direction);
  }
  while (saoPauloDayKey(new Date(candidate.getTime() - hourMs)) === dayKey) {
    candidate = new Date(candidate.getTime() - hourMs);
  }
  return candidate;
};

/** Instante UTC do início do mês `YYYY-MM` em São Paulo. */
export const saoPauloMonthStart = (monthKey: string): Date => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    throw new Error(`Chave de mês inválida: ${monthKey}`);
  }
  return saoPauloDayStart(`${monthKey}-01`);
};

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRAZIL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Lê o relógio de parede de São Paulo como se fosse UTC. */
const localAsUtc = (value: Date): Date => {
  const parts = partsFormatter.formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return new Date(
    `${read("year")}-${read("month")}-${read("day")}` +
      `T${read("hour")}:${read("minute")}:${read("second")}.000Z`,
  );
};
