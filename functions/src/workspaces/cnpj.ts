/**
 * CNPJ opcional do workspace (D-22).
 *
 * Aceita o número com ou sem máscara; recusa formato inválido, sequência
 * repetida e dígito verificador errado. Não é único: o mesmo CNPJ pode estar
 * em mais de um workspace (filiais, contadores, reorganizações). O valor é
 * gravado na forma canônica com máscara, que é a forma exibida hoje.
 */
const CNPJ_MASKED = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
const CNPJ_DIGITS = /^\d{14}$/;

const checkDigit = (digits: number[], weights: number[]): number => {
  const sum = weights.reduce(
    (total, weight, index) => total + weight * digits[index],
    0,
  );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
};

const FIRST_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const SECOND_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Devolve o CNPJ canônico (com máscara) ou `null` se inválido. */
export const normalizeCnpj = (input: string): string | null => {
  const trimmed = input.trim();
  if (!CNPJ_MASKED.test(trimmed) && !CNPJ_DIGITS.test(trimmed)) return null;
  const raw = trimmed.replace(/\D/g, "");
  if (/^(\d)\1{13}$/.test(raw)) return null;
  const digits = raw.split("").map(Number);
  if (checkDigit(digits, FIRST_WEIGHTS) !== digits[12]) return null;
  if (checkDigit(digits, SECOND_WEIGHTS) !== digits[13]) return null;
  return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/` +
    `${raw.slice(8, 12)}-${raw.slice(12)}`;
};
