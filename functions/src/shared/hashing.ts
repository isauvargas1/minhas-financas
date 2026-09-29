import {createHash} from "node:crypto";

/** SHA-256 em hexadecimal. */
export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * JSON com chaves ordenadas: a mesma intenção produz o mesmo hash
 * independentemente da ordem em que o cliente montou o objeto.
 */
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
};
