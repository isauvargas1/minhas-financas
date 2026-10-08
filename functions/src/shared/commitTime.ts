import {Timestamp} from "firebase-admin/firestore";

/**
 * Instante ISO-8601 com até 9 casas de fração de segundo e fuso (`Z` ou
 * `±HH:MM`).
 */
const ISO_INSTANT =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Converte um instante ISO em `Timestamp` sem perder microssegundos.
 *
 * `new Date(iso)` truncaria em milissegundos. Instantes de commit do
 * Firestore têm microssegundos, e dois commits do mesmo milissegundo seriam
 * confundidos — na cerca da reconstrução (P3-B) e na pré-condição de versão
 * da edição (P3-C).
 */
export const parseIsoInstant = (value: string): Timestamp => {
  const match = ISO_INSTANT.exec(value);
  const millis = match ? Date.parse(`${match[1]}${match[3]}`) : Number.NaN;
  if (!match || Number.isNaN(millis)) {
    throw new Error("Instante inválido.");
  }
  const nanoseconds = Number((match[2] ?? "").padEnd(9, "0"));
  return new Timestamp(Math.floor(millis / 1000), nanoseconds);
};

export const isIsoInstant = (value: string): boolean => {
  try {
    parseIsoInstant(value);
    return true;
  } catch {
    return false;
  }
};

/** Instante em ISO-8601 com nanossegundos, para devolver ao cliente. */
export const formatIsoInstant = (value: Timestamp): string => {
  const base = new Date(value.seconds * 1000).toISOString().slice(0, 19);
  return `${base}.${String(value.nanoseconds).padStart(9, "0")}Z`;
};
