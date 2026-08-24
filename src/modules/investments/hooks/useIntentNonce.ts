import { useCallback, useEffect, useRef, useState } from 'react';

import { newIntentNonce } from '../persistence/callableApi';

export interface FinancialIntent {
  /** Identidade estável da intenção aberta pelo usuário. */
  nonce: string;
  /**
   * Instante da intenção, congelado na **primeira** tentativa de envio.
   *
   * Precisa ser estável entre tentativas: `occurredAt` entra no `requestHash`
   * do backend (só `correlationId` fica de fora), então um `new Date()` por
   * tentativa transformaria todo retry em `idempotency_conflict` — ou, se a
   * chave também mudasse, num segundo fato financeiro.
   */
  occurredAt: () => string;
}

/**
 * Intenção financeira aberta pelo usuário, estável enquanto o formulário está
 * aberto (INV-P1-004).
 *
 * A chave de idempotência precisa representar a intenção, não a tentativa
 * HTTP. O gerador anterior chamava `crypto.randomUUID()` dentro do
 * `mutationFn` — uma chave nova por invocação —, o que tornava a idempotência
 * do backend inalcançável a partir da interface: duplo clique, retry de rede e
 * timeout+retry criavam fatos financeiros duplicados.
 *
 * Ciclo de vida:
 *
 * - abrir o formulário ⇒ intenção nova ⇒ nonce e instante novos;
 * - reenviar após erro, duplo clique, retry, timeout ⇒ mesma intenção;
 * - fechar e reabrir ⇒ intenção nova, ainda que o conteúdo seja idêntico —
 *   é assim que dois aportes iguais no mesmo dia continuam possíveis.
 *
 * `identity` caracteriza o formulário aberto (`"<editor>:<entidade>"`);
 * `null` significa "nenhum formulário aberto".
 */
export const useFinancialIntent = (identity: string | null): FinancialIntent => {
  const [nonce, setNonce] = useState(newIntentNonce);
  const previousIdentity = useRef<string | null>(identity);
  const frozenInstant = useRef<string | null>(null);

  useEffect(() => {
    if (previousIdentity.current === identity) return;
    previousIdentity.current = identity;
    frozenInstant.current = null;
    if (identity !== null) setNonce(newIntentNonce());
  }, [identity]);

  const occurredAt = useCallback(() => {
    if (frozenInstant.current === null) {
      frozenInstant.current = new Date().toISOString();
    }
    return frozenInstant.current;
  }, []);

  return { nonce, occurredAt };
};
