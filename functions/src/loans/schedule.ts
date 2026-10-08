import {addDaysToDayKey, isDayKey} from "../shared/dateKeys";
import {isMoneyCents, splitCentsEvenly, type MoneyCents} from "../shared/money";

/**
 * Motor único de juros e amortização de empréstimos, PF e PJ (D-13, P3-G).
 *
 * Função pura, em centavos inteiros e aritmética racional em `BigInt`:
 *
 * - **Taxa**: inteiro em partes por milhão da taxa nominal do período
 *   declarado (`ratePpm`; 1% = 10.000). Mensal: taxa do mês. Anual: taxa
 *   nominal anual convertida para a mensal **proporcional**, `anual / 12`,
 *   sem arredondar a taxa — o divisor 12 entra no denominador do cálculo de
 *   cada parcela, e só o valor em centavos da parcela é arredondado.
 * - **Arredondamento monetário**: meio para cima ao centavo, uma vez por
 *   grandeza de parcela (juros do período, prestação Price). Divisão de um
 *   total em parcelas usa o maior resto (`splitCentsEvenly`, D-34): os
 *   centavos que sobram vão para as primeiras parcelas.
 * - **Modelos**:
 *   - `none`: juros zero; o principal é dividido pelo maior resto;
 *   - `fixed`: o total de juros informado é dividido pelo maior resto;
 *   - `price`: prestação constante `B·i/(1−(1+i)^−n)`; juros do período sobre
 *     o saldo anterior; principal = prestação − juros; a última parcela
 *     amortiza o saldo restante exato (absorve o resíduo de arredondamento);
 *   - `sac`: amortização constante pelo maior resto; juros sobre o saldo
 *     anterior; prestações decrescentes;
 *   - `simple`: amortização constante pelo maior resto; juros sobre o
 *     principal original, sem juros sobre juros: total `B·i·n` arredondado
 *     uma vez e dividido pelo maior resto.
 *
 * Invariantes verificadas aqui mesmo (falha alta, nunca silenciosa):
 * `Σ principalCents == principalCents`, saldo final zero, toda parcela com
 * valores inteiros não negativos, `Σ interestCents == totalInterestCents`.
 */

export const LOAN_MAX_INSTALLMENTS = 360;
/** 100% ao período declarado. */
export const LOAN_MAX_RATE_PPM = 1_000_000;
export const RATE_PPM_SCALE = 1_000_000;

export type LoanInterestTerms =
  | {type: "none"}
  | {type: "fixed"; totalInterestCents: MoneyCents}
  | {
    type: "percentage";
    ratePpm: number;
    ratePeriod: "monthly" | "annual";
    amortization: "price" | "sac" | "simple";
  };

export interface LoanInstallmentPlan {
  /** 1..n */
  number: number;
  dueDate: string;
  principalCents: MoneyCents;
  interestCents: MoneyCents;
  totalCents: MoneyCents;
}

export interface LoanSchedule {
  installments: LoanInstallmentPlan[];
  totalInterestCents: MoneyCents;
  maturityDate: string;
}

export class LoanScheduleError extends Error {}

const ZERO = BigInt(0);
const TWO = BigInt(2);

/** `num / den` arredondado meio para cima, para `num >= 0` e `den > 0`. */
export const roundHalfUp = (num: bigint, den: bigint): bigint => {
  if (den <= ZERO || num < ZERO) {
    throw new LoanScheduleError("Arredondamento fora do domínio.");
  }
  return (TWO * num + den) / (TWO * den);
};

/** Taxa mensal como fração `num/den`, sem arredondar. */
export const monthlyRateFraction = (
  ratePpm: number,
  ratePeriod: "monthly" | "annual",
): {num: bigint; den: bigint} => ({
  num: BigInt(ratePpm),
  den: BigInt(ratePeriod === "annual" ? 12 * RATE_PPM_SCALE : RATE_PPM_SCALE),
});

const toSafeCents = (value: bigint, field: string): MoneyCents => {
  if (
    value < ZERO ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new LoanScheduleError(`${field}: fora do intervalo seguro.`);
  }
  return Number(value);
};

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Soma `months` meses a uma data civil, mantendo o dia do mês e recuando ao
 * último dia quando o mês é mais curto (31/01 + 1 mês = 28 ou 29/02). Pura
 * aritmética de calendário sobre a chave `YYYY-MM-DD` — sem fuso, sem UTC.
 */
export const addMonthsToDayKey = (dayKey: string, months: number): string => {
  if (!isDayKey(dayKey) || !Number.isSafeInteger(months) || months < 0) {
    throw new LoanScheduleError(`Data inválida: ${dayKey}`);
  }
  const [year, month, day] = dayKey.split("-").map(Number);
  const total = month - 1 + months;
  const nextYear = year + Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  const nextDay = Math.min(day, daysInMonth(nextYear, nextMonth));
  return `${String(nextYear).padStart(4, "0")}-` +
    `${String(nextMonth).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`;
};

/** Prestação Price arredondada: `B·i·q^n / (q^n − 1)`, com `q = 1 + i`. */
export const pricePaymentCents = (
  principalCents: MoneyCents,
  installments: number,
  rate: {num: bigint; den: bigint},
): bigint => {
  const principal = BigInt(principalCents);
  const n = BigInt(installments);
  const q = rate.den + rate.num;
  const qn = q ** n;
  const dn = rate.den ** n;
  return roundHalfUp(principal * rate.num * qn, rate.den * (qn - dn));
};

export interface LoanScheduleInput {
  principalCents: MoneyCents;
  installments: number;
  firstDueDate: string;
  interest: LoanInterestTerms;
}

const assertInput = (input: LoanScheduleInput): void => {
  if (!isMoneyCents(input.principalCents) || input.principalCents <= 0) {
    throw new LoanScheduleError("Principal: centavos inteiros positivos.");
  }
  if (
    !Number.isSafeInteger(input.installments) ||
    input.installments < 1 ||
    input.installments > LOAN_MAX_INSTALLMENTS
  ) {
    throw new LoanScheduleError("Parcelas: entre 1 e 360.");
  }
  // Ao menos um centavo de principal por parcela: nenhuma parcela vazia.
  if (input.principalCents < input.installments) {
    throw new LoanScheduleError("Principal: ao menos 1 centavo por parcela.");
  }
  if (!isDayKey(input.firstDueDate)) {
    throw new LoanScheduleError("Primeiro vencimento inválido.");
  }
  const {interest} = input;
  if (interest.type === "fixed") {
    if (!isMoneyCents(interest.totalInterestCents) ||
      interest.totalInterestCents <= 0) {
      throw new LoanScheduleError("Juros fixos: centavos inteiros positivos.");
    }
  }
  if (interest.type === "percentage") {
    if (
      !Number.isSafeInteger(interest.ratePpm) ||
      interest.ratePpm <= 0 ||
      interest.ratePpm > LOAN_MAX_RATE_PPM
    ) {
      throw new LoanScheduleError("Taxa: inteiro positivo até 100%.");
    }
  }
};

/** Principal e juros por parcela, sem datas. */
const splitPlan = (
  input: LoanScheduleInput,
): Array<{principal: bigint; interest: bigint}> => {
  const n = input.installments;
  const principal = BigInt(input.principalCents);
  const evenPrincipal = (): bigint[] =>
    splitCentsEvenly(input.principalCents, n).map((value) => BigInt(value));
  const {interest} = input;

  if (interest.type === "none") {
    return evenPrincipal().map((value) => ({principal: value, interest: ZERO}));
  }
  if (interest.type === "fixed") {
    const interestParts = splitCentsEvenly(interest.totalInterestCents, n);
    return evenPrincipal().map((value, index) => ({
      principal: value,
      interest: BigInt(interestParts[index]),
    }));
  }

  const rate = monthlyRateFraction(interest.ratePpm, interest.ratePeriod);
  if (interest.amortization === "simple") {
    const total = roundHalfUp(principal * rate.num * BigInt(n), rate.den);
    const interestParts = splitCentsEvenly(
      toSafeCents(total, "Juros"),
      n,
    );
    return evenPrincipal().map((value, index) => ({
      principal: value,
      interest: BigInt(interestParts[index]),
    }));
  }

  const plan: Array<{principal: bigint; interest: bigint}> = [];
  let balance = principal;
  if (interest.amortization === "sac") {
    for (const amortization of evenPrincipal()) {
      plan.push({
        principal: amortization,
        interest: roundHalfUp(balance * rate.num, rate.den),
      });
      balance -= amortization;
    }
    return plan;
  }

  // Price.
  const payment = pricePaymentCents(input.principalCents, n, rate);
  for (let index = 0; index < n; index += 1) {
    const periodInterest = roundHalfUp(balance * rate.num, rate.den);
    let amortization: bigint;
    if (index === n - 1) {
      amortization = balance;
    } else {
      amortization = payment - periodInterest;
      if (amortization < ZERO) amortization = ZERO;
      if (amortization > balance) amortization = balance;
    }
    plan.push({principal: amortization, interest: periodInterest});
    balance -= amortization;
  }
  return plan;
};

export const buildLoanSchedule = (input: LoanScheduleInput): LoanSchedule => {
  assertInput(input);
  const plan = splitPlan(input);
  const installments = plan.map((part, index): LoanInstallmentPlan => {
    const principalCents = toSafeCents(part.principal, "Principal da parcela");
    const interestCents = toSafeCents(part.interest, "Juros da parcela");
    return {
      number: index + 1,
      dueDate: addMonthsToDayKey(input.firstDueDate, index),
      principalCents,
      interestCents,
      totalCents: toSafeCents(part.principal + part.interest, "Parcela"),
    };
  });

  const principalSum = installments.reduce(
    (sum, item) => sum + BigInt(item.principalCents), ZERO);
  if (principalSum !== BigInt(input.principalCents)) {
    throw new LoanScheduleError("Soma do principal diverge do contrato.");
  }
  const totalInterest = installments.reduce(
    (sum, item) => sum + BigInt(item.interestCents), ZERO);
  if (
    input.interest.type === "fixed" &&
    totalInterest !== BigInt(input.interest.totalInterestCents)
  ) {
    throw new LoanScheduleError("Soma dos juros diverge do contrato.");
  }
  if (input.interest.type === "none" && totalInterest !== ZERO) {
    throw new LoanScheduleError("Contrato sem juros com juros.");
  }
  return {
    installments,
    totalInterestCents: toSafeCents(totalInterest, "Juros"),
    maturityDate: installments[installments.length - 1].dueDate,
  };
};

export type LoanStatus = "active" | "overdue" | "paid" | "cancelled";

export interface LoanStatusInput {
  cancelled: boolean;
  balanceCents: MoneyCents;
  totalPrincipalSettledCents: MoneyCents;
  schedule: readonly Pick<LoanInstallmentPlan, "dueDate" | "principalCents">[];
  /** Hoje em `America/Sao_Paulo`. */
  today: string;
}

export interface DerivedLoanStatus {
  status: LoanStatus;
  /**
   * Primeiro dia em atraso se nada mais for liquidado: o dia seguinte ao
   * vencimento da primeira parcela cujo principal acumulado ainda não foi
   * coberto pelo principal liquidado. `null` quando quitado ou cancelado.
   */
  overdueFrom: string | null;
}

/**
 * Status derivado (D-13): `cancelled` é terminal; saldo zero é `paid`; saldo
 * positivo com parcela vencida (vencimento antes de hoje) cujo principal
 * acumulado excede o principal liquidado é `overdue`; senão `active`.
 *
 * O critério é o principal porque é ele que forma o saldo (juros nunca
 * reduzem `balanceCents`): uma antecipação de principal adia o atraso; um
 * pagamento só de juros não o evita.
 */
export const deriveLoanStatus = (input: LoanStatusInput): DerivedLoanStatus => {
  if (input.cancelled) return {status: "cancelled", overdueFrom: null};
  if (input.balanceCents === 0) return {status: "paid", overdueFrom: null};
  let scheduled = 0;
  for (const installment of input.schedule) {
    scheduled += installment.principalCents;
    if (scheduled > input.totalPrincipalSettledCents) {
      const overdueFrom = addDaysToDayKey(installment.dueDate, 1);
      return {
        status: overdueFrom <= input.today ? "overdue" : "active",
        overdueFrom,
      };
    }
  }
  // Saldo positivo com todo o principal previsto coberto não existe quando
  // `Σ principal previsto == principal`; falha alta em vez de inventar.
  throw new LoanScheduleError("Cronograma não cobre o saldo do contrato.");
};

