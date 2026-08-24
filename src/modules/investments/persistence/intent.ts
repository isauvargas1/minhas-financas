/**
 * Identidade de intenção financeira para o domínio de investimentos.
 *
 * Módulo sem dependência do SDK do Firebase de propósito: ele é a parte
 * testável em unidade da correção de INV-P1-004, e `lib/firebase` exige
 * variáveis de ambiente para ser importado.
 */

/**
 * Serialização estável: as chaves de objeto saem ordenadas, para que a mesma
 * intenção produza sempre o mesmo texto independentemente da ordem em que o
 * formulário montou o payload.
 */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
};

/**
 * Digest curto e síncrono do conteúdo da intenção.
 *
 * Não é primitiva de segurança: o backend aplica SHA-256 sobre a chave e sobre
 * o payload por conta própria. Aqui só é preciso que intenções diferentes
 * produzam textos diferentes com folga, então usa-se FNV-1a em dois estados
 * independentes (~64 bits combinados).
 */
export const intentDigest = (value: unknown): string => {
  const text = stableStringify(value);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
};

/**
 * Identificador de uma intenção financeira aberta pelo usuário.
 *
 * Vale enquanto o formulário correspondente estiver aberto. Fechar e reabrir
 * o formulário é, por definição, uma intenção nova — é assim que o usuário
 * lança dois aportes idênticos no mesmo dia sem esbarrar na idempotência.
 */
export const newIntentNonce = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
    .replace(/-/g, '')
    .slice(0, 24);

/**
 * Chave de idempotência estável por intenção (INV-P1-004).
 *
 * O gerador anterior era `crypto.randomUUID()` dentro do `mutationFn`: **uma
 * chave nova por invocação**. Toda a infraestrutura de idempotência do backend
 * — reserva atômica, `requestHash`, IDs determinísticos — ficava inalcançável
 * a partir da interface, e o cenário que a idempotência existe para cobrir
 * (a resposta se perde por timeout, o usuário reenvia) criava um segundo fato
 * financeiro.
 *
 * A chave passa a ter três partes:
 *
 * - `operation` — a mesma intenção em operações diferentes é distinta;
 * - `nonce` — mintado quando o usuário **abre** o formulário, o que separa
 *   duas intenções deliberadamente idênticas;
 * - `digest` do conteúdo financeiro — se o usuário corrigir um valor depois de
 *   um erro e reenviar, isso é uma intenção diferente e precisa de chave
 *   diferente, senão o backend responderia `idempotency_conflict`.
 *
 * Duplo clique, retry de rede e timeout+retry mantêm as três partes iguais e,
 * portanto, produzem exatamente um fato financeiro.
 */
export const investmentIdempotencyKey = (
  operation: string,
  nonce: string,
  intentPayload: unknown,
): string => `investment-ui:${operation}:${nonce}:${intentDigest(intentPayload)}`;

/**
 * Correlação da **tentativa**, não da intenção.
 *
 * Nova a cada chamada, de propósito: é o que permite distinguir, no log, um
 * replay de idempotência de uma primeira execução.
 */
export const investmentCorrelationId = (): string =>
  `investment-attempt-${newIntentNonce()}`;
