import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORK_TIME_MAX_DISPLAY_REAIS,
  WORK_TIME_MAX_INCOME_CENTS,
  WORK_TIME_MAX_WORK_MINUTES,
  WORK_TIME_MIN_INCOME_CENTS,
  WORK_TIME_MIN_WORK_MINUTES,
  checkWorkTimeConfig,
  describeWorkTime,
  displayReaisToCents,
  formatWorkTime,
  formatWorkTimeCompact,
  presentWorkTime,
  workTimeEquivalent,
  workTimeHourlyRateCents,
  type WorkTimeConfig,
  type WorkTimeEquivalent,
} from '../../src/modules/work-time/calculation.ts';
import {
  moneyOrWorkTimeAxisFromReais,
  moneyOrWorkTimeTooltipFromReais,
} from '../../src/modules/work-time/presentation.ts';

/*
 * P5-F (REQ-FUT-01), P5-F.1 — cálculo puro do tempo de trabalho equivalente.
 * Fórmula em inteiros: minutos = centavos × minutosDoPeríodo ÷ rendaDoPeríodo,
 * arredondada ao minuto mais próximo, meio minuto para longe de zero. Desde a
 * P5-F.1 o período é a janela da estimativa (até 12 meses).
 */

const NBSP = ' ';
const show = (text: string) => text.replaceAll(NBSP, ' ');

/** Renda que dá exatamente R$ 0,01 por hora na janela máxima. */
const CENT_PER_HOUR_INCOME = WORK_TIME_MAX_WORK_MINUTES / 60;

/** R$ 3.520,00 por 176 h: a hora vale exatamente R$ 20,00. */
const BASE: WorkTimeConfig = { incomeCents: 352_000, workMinutes: 176 * 60 };

const minutesOf = (amountCents: number, config: WorkTimeConfig = BASE): number => {
  const result = workTimeEquivalent(amountCents, config);
  assert.equal(result.kind, 'minutes', `esperava minutos para ${amountCents}`);
  return (result as Extract<WorkTimeEquivalent, { kind: 'minutes' }>).minutes;
};

/** Gerador determinístico (LCG) para os testes de propriedade. */
const seeded = (seed: number) => {
  let state = BigInt(seed);
  const MOD = BigInt(2) ** BigInt(48);
  return (maxExclusive: number): number => {
    state = (state * BigInt(25214903917) + BigInt(11)) % MOD;
    return Number(state % BigInt(maxExclusive));
  };
};

test('exemplo de referência: R$ 482,35 com hora de R$ 20,00 vira 24 h 7 min', () => {
  // 48.235 × 10.560 ÷ 352.000 = 1.447,05 minutos → 1.447.
  assert.equal(minutesOf(48_235), 1_447);
  const result = workTimeEquivalent(48_235, BASE);
  assert.equal(show(formatWorkTime(result as Exclude<WorkTimeEquivalent, { kind: 'unavailable' }>)), '≈ 24 h 7 min');
});

test('equivalência entre períodos: a renda inteira vale a carga inteira, e a escala não muda o resultado', () => {
  assert.equal(minutesOf(BASE.incomeCents), BASE.workMinutes);
  assert.equal(minutesOf(BASE.incomeCents / 2), BASE.workMinutes / 2);
  assert.equal(minutesOf(2_000), 60, 'uma hora de trabalho vale R$ 20,00');
  const doubled = { incomeCents: BASE.incomeCents * 2, workMinutes: BASE.workMinutes * 2 };
  const weekly = { incomeCents: 88_000, workMinutes: 44 * 60 };
  const random = seeded(7);
  for (let index = 0; index < 500; index += 1) {
    const amount = random(50_000_000) - 25_000_000;
    if (amount === 0) continue;
    assert.deepEqual(workTimeEquivalent(amount, doubled), workTimeEquivalent(amount, BASE), `escala, ${amount}`);
    assert.deepEqual(workTimeEquivalent(amount, weekly), workTimeEquivalent(amount, BASE), `mesma hora, ${amount}`);
  }
});

test('arredondamento ao minuto mais próximo: meio minuto vai para longe de zero', () => {
  // R$ 2,00 por 1 h: 1 centavo = 0,3 min.
  const config = { incomeCents: 200, workMinutes: 60 };
  assert.equal(minutesOf(5, config), 2, '1,5 min → 2');
  assert.equal(minutesOf(-5, config), -2, '−1,5 min → −2');
  assert.equal(minutesOf(4, config), 1, '1,2 min → 1');
  assert.equal(minutesOf(6, config), 2, '1,8 min → 2');
  // R$ 1,20 por 1 h: 1 centavo = 0,5 min, exatamente no meio.
  const half = { incomeCents: 120, workMinutes: 60 };
  assert.equal(minutesOf(1, half), 1);
  assert.equal(minutesOf(-1, half), -1);
  assert.equal(minutesOf(3, half), 2, '1,5 min → 2');
});

test('propriedade: o resultado é o inteiro mais próximo do quociente exato e o negativo espelha o positivo', () => {
  const random = seeded(2026);
  for (let index = 0; index < 2_000; index += 1) {
    const config = {
      incomeCents: WORK_TIME_MIN_INCOME_CENTS + random(5_000_000),
      workMinutes: WORK_TIME_MIN_WORK_MINUTES + random(WORK_TIME_MAX_WORK_MINUTES - 60),
    };
    if (checkWorkTimeConfig(config) !== null) continue;
    const amount = 1 + random(1_000_000_000_000);
    const result = workTimeEquivalent(amount, config);
    const mirror = workTimeEquivalent(-amount, config);
    const exact = BigInt(amount) * BigInt(config.workMinutes);
    const income = BigInt(config.incomeCents);
    if (result.kind === 'under_a_minute') {
      assert.ok(BigInt(2) * exact < income, 'menos de meio minuto');
      assert.deepEqual(mirror, { kind: 'under_a_minute', negative: true });
      continue;
    }
    assert.equal(result.kind, 'minutes');
    const minutes = BigInt((result as { minutes: number }).minutes);
    // |minutos × renda − valor × carga| ≤ renda ÷ 2, com o meio arredondado para cima.
    const gap = minutes * income - exact;
    assert.ok(BigInt(2) * gap <= income && BigInt(-2) * gap < income, `arredondamento de ${amount}`);
    assert.deepEqual(mirror, { kind: 'minutes', minutes: -Number(minutes) });
  }
});

test('zero, menos de 1 minuto e sinal', () => {
  assert.deepEqual(workTimeEquivalent(0, BASE), { kind: 'zero' });
  assert.deepEqual(workTimeEquivalent(-0, BASE), { kind: 'zero' });
  // 1 centavo com a hora a R$ 20,00 é 0,03 min: nunca aparece como 0.
  assert.deepEqual(workTimeEquivalent(1, BASE), { kind: 'under_a_minute', negative: false });
  assert.deepEqual(workTimeEquivalent(-1, BASE), { kind: 'under_a_minute', negative: true });
  // 16 centavos = 0,48 min (ainda menos de 1); 17 centavos = 0,51 min → 1 min.
  assert.equal(workTimeEquivalent(16, BASE).kind, 'under_a_minute');
  assert.equal(minutesOf(17), 1);
  assert.equal(minutesOf(-120_000), -3_600, 'R$ 1.200,00 negativos = −60 h');
});

test('valores e configurações inválidos ficam indisponíveis (a interface mostra o dinheiro)', () => {
  for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, -0.01,
    Number.MAX_SAFE_INTEGER + 1, '100' as unknown as number, null as unknown as number, undefined as unknown as number]) {
    assert.deepEqual(workTimeEquivalent(amount, BASE), { kind: 'unavailable' }, String(amount));
  }
  const invalid: Array<[WorkTimeConfig, string]> = [
    [{ incomeCents: 0, workMinutes: 9_600 }, 'income_too_low'],
    [{ incomeCents: -350_000, workMinutes: 9_600 }, 'income_too_low'],
    [{ incomeCents: WORK_TIME_MIN_INCOME_CENTS - 1, workMinutes: 60 }, 'income_too_low'],
    [{ incomeCents: WORK_TIME_MAX_INCOME_CENTS + 1, workMinutes: 9_600 }, 'income_too_high'],
    [{ incomeCents: 350_000.5, workMinutes: 9_600 }, 'income_invalid'],
    [{ incomeCents: Number.NaN, workMinutes: 9_600 }, 'income_invalid'],
    [{ incomeCents: 350_000, workMinutes: WORK_TIME_MIN_WORK_MINUTES - 1 }, 'minutes_too_low'],
    [{ incomeCents: 350_000, workMinutes: 0 }, 'minutes_too_low'],
    [{ incomeCents: 350_000, workMinutes: -60 }, 'minutes_too_low'],
    [{ incomeCents: 350_000, workMinutes: WORK_TIME_MAX_WORK_MINUTES + 1 }, 'minutes_too_high'],
    [{ incomeCents: 350_000, workMinutes: 90.5 }, 'minutes_invalid'],
    // R$ 1,00 pela janela máxima (12 meses de 744 h): a hora valeria menos de um centavo.
    [{ incomeCents: 100, workMinutes: WORK_TIME_MAX_WORK_MINUTES }, 'hourly_rate_too_low'],
  ];
  for (const [config, issue] of invalid) {
    assert.equal(checkWorkTimeConfig(config), issue, JSON.stringify(config));
    assert.deepEqual(workTimeEquivalent(10_000, config), { kind: 'unavailable' });
    assert.equal(workTimeHourlyRateCents(config), null);
    assert.equal(presentWorkTime(10_000, config), null);
  }
  // Limites exatos ainda válidos.
  assert.equal(checkWorkTimeConfig({ incomeCents: WORK_TIME_MIN_INCOME_CENTS, workMinutes: 60 }), null);
  assert.equal(checkWorkTimeConfig({ incomeCents: WORK_TIME_MAX_INCOME_CENTS, workMinutes: WORK_TIME_MAX_WORK_MINUTES }), null);
  assert.equal(checkWorkTimeConfig({ incomeCents: CENT_PER_HOUR_INCOME, workMinutes: WORK_TIME_MAX_WORK_MINUTES }), null, 'hora de exatamente R$ 0,01');
  assert.equal(checkWorkTimeConfig({ incomeCents: CENT_PER_HOUR_INCOME - 1, workMinutes: WORK_TIME_MAX_WORK_MINUTES }), 'hourly_rate_too_low', 'um centavo a menos');
});

test('limite seguro: valores muito grandes calculam em BigInt e só ficam indisponíveis acima do maior inteiro seguro', () => {
  // Hora de R$ 0,01: cada centavo vale 60 minutos (o pior caso permitido).
  const cheapest = { incomeCents: CENT_PER_HOUR_INCOME, workMinutes: WORK_TIME_MAX_WORK_MINUTES };
  const fits = Math.floor(Number.MAX_SAFE_INTEGER / 60);
  assert.equal(minutesOf(fits, cheapest), fits * 60);
  assert.equal(minutesOf(-fits, cheapest), -fits * 60);
  assert.deepEqual(workTimeEquivalent(fits + 1, cheapest), { kind: 'unavailable' });
  assert.deepEqual(workTimeEquivalent(Number.MAX_SAFE_INTEGER, cheapest), { kind: 'unavailable' });
  // Com a renda máxima, o maior valor seguro ainda converte, e exato.
  const richest = { incomeCents: WORK_TIME_MAX_INCOME_CENTS, workMinutes: WORK_TIME_MAX_WORK_MINUTES };
  const expected = (BigInt(2) * BigInt(Number.MAX_SAFE_INTEGER) * BigInt(WORK_TIME_MAX_WORK_MINUTES)
    + BigInt(WORK_TIME_MAX_INCOME_CENTS)) / (BigInt(2) * BigInt(WORK_TIME_MAX_INCOME_CENTS));
  assert.equal(minutesOf(Number.MAX_SAFE_INTEGER, richest), Number(expected));
  // Em ponto flutuante o produto passaria de 2^53 e perderia unidades; o resultado continua inteiro e seguro.
  assert.ok(Number.isSafeInteger(minutesOf(Number.MAX_SAFE_INTEGER, richest)));
});

test('limites da janela da estimativa (P5-F.1): 12 meses de 744 h e R$ 100 mi por mês', () => {
  assert.equal(WORK_TIME_MIN_WORK_MINUTES, 60);
  assert.equal(WORK_TIME_MAX_WORK_MINUTES, 535_680);
  assert.equal(WORK_TIME_MIN_INCOME_CENTS, 100);
  assert.equal(WORK_TIME_MAX_INCOME_CENTS, 120_000_000_000);
});

test('valor estimado por hora em centavos inteiros, arredondado ao centavo mais próximo', () => {
  assert.equal(workTimeHourlyRateCents(BASE), 2_000);
  assert.equal(workTimeHourlyRateCents({ incomeCents: 100, workMinutes: 120 }), 50);
  assert.equal(workTimeHourlyRateCents({ incomeCents: 101, workMinutes: 120 }), 51, '50,5 → 51');
  assert.equal(workTimeHourlyRateCents({ incomeCents: 350_000, workMinutes: 173 * 60 + 20 }), 2_019, 'R$ 3.500,00 ÷ 173 h 20 min');
  assert.equal(workTimeHourlyRateCents({ incomeCents: CENT_PER_HOUR_INCOME, workMinutes: WORK_TIME_MAX_WORK_MINUTES }), 1);
});

test('volta de reais de exibição a centavos é exata até o teto e recusa o resto', () => {
  const edges = [0, 1, 5, 10, 15, 29, 57, 1_005, 33_333, 48_235, 999_999, 123_456_789_012_345,
    999_999_999_999_999, 1_000_000_000_000_000];
  for (const cents of edges) {
    assert.equal(displayReaisToCents(cents / 100), cents, `+${cents}`);
    assert.equal(displayReaisToCents(-cents / 100), cents === 0 ? 0 : -cents, `-${cents}`);
  }
  const random = seeded(99);
  for (let index = 0; index < 20_000; index += 1) {
    const high = random(10_000_000);
    const low = random(100_000_000);
    const cents = high * 100_000_000 + low; // até 10^15
    assert.equal(displayReaisToCents(cents / 100), cents, String(cents));
    assert.equal(displayReaisToCents(-cents / 100), cents === 0 ? 0 : -cents);
  }
  assert.equal(Object.is(displayReaisToCents(-0), 0), true, 'sem −0');
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    WORK_TIME_MAX_DISPLAY_REAIS + 1, -(WORK_TIME_MAX_DISPLAY_REAIS + 1), '12' as unknown as number]) {
    assert.equal(displayReaisToCents(value), null, String(value));
  }
});

test('formatação pt-BR em horas e minutos, sem quebra de linha e com marca de estimativa', () => {
  const cases: Array<[WorkTimeEquivalent, string]> = [
    [{ kind: 'zero' }, '0 min'],
    [{ kind: 'under_a_minute', negative: false }, '< 1 min'],
    [{ kind: 'under_a_minute', negative: true }, '-< 1 min'],
    [{ kind: 'minutes', minutes: 1 }, '≈ 1 min'],
    [{ kind: 'minutes', minutes: 45 }, '≈ 45 min'],
    [{ kind: 'minutes', minutes: 120 }, '≈ 2 h'],
    [{ kind: 'minutes', minutes: 690 }, '≈ 11 h 30 min'],
    [{ kind: 'minutes', minutes: -130 }, '-≈ 2 h 10 min'],
    [{ kind: 'minutes', minutes: 1_234 * 60 + 5 }, '≈ 1.234 h 5 min'],
    [{ kind: 'minutes', minutes: 150_000_000_000_000 * 60 }, '≈ 150.000.000.000.000 h'],
  ];
  for (const [equivalent, expected] of cases) {
    const text = formatWorkTime(equivalent as Exclude<WorkTimeEquivalent, { kind: 'unavailable' }>);
    assert.equal(show(text), expected);
    assert.equal(/ /.test(text), false, `sem espaço quebrável em ${expected}`);
  }
});

test('rótulo compacto de eixo: horas inteiras arredondadas e minutos abaixo de 1 h', () => {
  const cases: Array<[WorkTimeEquivalent, string]> = [
    [{ kind: 'zero' }, '0 h'],
    [{ kind: 'under_a_minute', negative: false }, '< 1 min'],
    [{ kind: 'under_a_minute', negative: true }, '-< 1 min'],
    [{ kind: 'minutes', minutes: 45 }, '≈ 45 min'],
    [{ kind: 'minutes', minutes: 59 }, '≈ 59 min'],
    [{ kind: 'minutes', minutes: 60 }, '≈ 1 h'],
    [{ kind: 'minutes', minutes: 89 }, '≈ 1 h'],
    [{ kind: 'minutes', minutes: 90 }, '≈ 2 h'],
    [{ kind: 'minutes', minutes: -90 }, '-≈ 2 h'],
    [{ kind: 'minutes', minutes: 123 * 60 + 49 }, '≈ 124 h'],
    [{ kind: 'minutes', minutes: 1_234 * 60 + 5 }, '≈ 1.234 h'],
    [{ kind: 'minutes', minutes: Number.MAX_SAFE_INTEGER }, '≈ 150.119.987.579.017 h'],
  ];
  for (const [equivalent, expected] of cases) {
    const text = formatWorkTimeCompact(equivalent as Exclude<WorkTimeEquivalent, { kind: 'unavailable' }>);
    assert.equal(show(text), expected);
    assert.equal(/ /.test(text), false, `sem espaço quebrável em ${expected}`);
  }
});

test('eixo e tooltip de gráfico: modo dinheiro devolve o texto exato do formatador da tela', () => {
  const money = (reais: number) => `R$${reais / 1000}k`;
  for (const reais of [0, 2500, -1200.5, 0.01, 1e16]) {
    assert.equal(moneyOrWorkTimeAxisFromReais(null, reais, money), money(reais));
    assert.equal(moneyOrWorkTimeTooltipFromReais(null, reais, money), money(reais));
  }
  // Hora de R$ 20,00 (BASE): R$ 2.500 são 125 h no eixo e 125 h com os reais no tooltip.
  assert.equal(show(moneyOrWorkTimeAxisFromReais(BASE, 2500, money)), '≈ 125 h');
  assert.equal(show(moneyOrWorkTimeTooltipFromReais(BASE, 2500, money)), '≈ 125 h (R$ 2.500,00)');
  assert.equal(show(moneyOrWorkTimeAxisFromReais(BASE, 0, money)), '0 h');
  // Fora do intervalo exato dos reais de exibição, ou valor que não converte: o eixo fica em dinheiro.
  assert.equal(moneyOrWorkTimeAxisFromReais(BASE, WORK_TIME_MAX_DISPLAY_REAIS * 10, money), money(WORK_TIME_MAX_DISPLAY_REAIS * 10));
  assert.equal(moneyOrWorkTimeAxisFromReais(BASE, Number.NaN, money), money(Number.NaN));
});

test('descrição por extenso para leitores de tela, com singular e plural', () => {
  assert.equal(describeWorkTime({ kind: 'zero' }), '0 minutos de trabalho');
  assert.equal(describeWorkTime({ kind: 'under_a_minute', negative: false }), 'menos de 1 minuto de trabalho');
  assert.equal(describeWorkTime({ kind: 'under_a_minute', negative: true }), 'valor negativo de menos de 1 minuto de trabalho');
  assert.equal(describeWorkTime({ kind: 'minutes', minutes: 61 }), 'aproximadamente 1 hora e 1 minuto de trabalho');
  assert.equal(describeWorkTime({ kind: 'minutes', minutes: 120 }), 'aproximadamente 2 horas de trabalho');
  assert.equal(describeWorkTime({ kind: 'minutes', minutes: -1_447 }), 'valor negativo de aproximadamente 24 horas e 7 minutos de trabalho');
  assert.equal(describeWorkTime({ kind: 'minutes', minutes: 1_234 * 60 }), 'aproximadamente 1.234 horas de trabalho');
});

test('apresentação: texto curto, falado, dica e tooltip trazem o valor exato em reais', () => {
  const presentation = presentWorkTime(48_235, BASE);
  assert.ok(presentation);
  assert.equal(show(presentation.short), '≈ 24 h 7 min');
  assert.equal(show(presentation.spoken), 'aproximadamente 24 horas e 7 minutos de trabalho, equivalente a R$ 482,35');
  assert.equal(show(presentation.hint), 'R$ 482,35 · tempo de trabalho estimado');
  assert.equal(show(presentation.withMoney), '≈ 24 h 7 min (R$ 482,35)');
  assert.equal(show(presentWorkTime(-1, BASE)?.withMoney ?? ''), '-< 1 min (-R$ 0,01)');
  assert.equal(presentWorkTime(Number.NaN, BASE), null);
});
