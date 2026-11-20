/**
 * Regras puras da lista do piloto (P6-A), testadas sem Firestore em `tests/tools/acesso-piloto-regras.test.mjs`.
 *
 * No G0 só o proprietário usa a produção: no máximo um convite ativo. A partir do G1 (liberação registrada com
 * `gate: "G1"`), o limite é o que o proprietário definir no registro dos convidados (G1.12), conferido por ele.
 */
export const LIMITE_DE_ATIVOS_POR_GATE = Object.freeze({G0: 1});

/** `gate`: o da liberação da produção (`null` no Emulator). `outrosAtivos`: convites ativos além do pedido. */
export const avaliarNovoConvite = ({gate, outrosAtivos}) => {
  const limite = LIMITE_DE_ATIVOS_POR_GATE[gate] ?? null;
  if (limite !== null && outrosAtivos >= limite) {
    return [`No ${gate} só ${limite === 1 ? 'um convite pode estar ativo (o do proprietário)' : `${limite} convites podem estar ativos`}. `
      + 'Registre a liberação G1 antes de convidar outras pessoas. Nada foi alterado.'];
  }
  return [];
};
