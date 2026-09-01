/**
 * Tradução de erro de callable para frase em pt-BR.
 *
 * Vive fora de qualquer componente porque é a parte testável em unidade da
 * regra do §15 da Etapa 2: **nada técnico chega ao usuário**. Nenhum
 * `FirebaseError`, nenhum `permission-denied`, nenhum `trackingMode`,
 * `quantityMicros`, `positionId`, `accountId`, `assetId` ou
 * `idempotencyKey` — o código do erro escolhe a frase e o resto é descartado.
 */

const codeOf = (error: unknown): string =>
  typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

const messageOf = (error: unknown): string =>
  typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';

/**
 * Mensagem segura para a tela.
 *
 * Quando o backend devolve uma pré-condição de domínio, a mensagem dele **é**
 * a explicação e vale mais que uma frase genérica: ela já vem em pt-BR e diz
 * qual foi o impedimento. `code.includes` é proposital — a callable entrega o
 * código prefixado (`functions/permission-denied`).
 */
export const safeInvestmentError = (error: unknown): string => {
  const code = codeOf(error);
  const message = messageOf(error);

  if (code.includes('permission-denied')) return 'Você não tem permissão para concluir esta ação.';
  if (code.includes('unauthenticated')) return 'Sua sessão expirou. Entre novamente para continuar.';
  if (code.includes('invalid-argument')) return 'Revise os dados informados e tente novamente.';
  if (code.includes('failed-precondition')) {
    /*
     * Pré-condição de domínio já vem em pt-BR e explica a causa; trocá-la por
     * uma frase genérica esconderia exatamente a informação que o operador
     * precisa para decidir o passo seguinte.
     *
     * O prefixo removido é **só** o técnico. A versão anterior cortava tudo
     * até o primeiro `:`, e a mensagem mais importante do modo simples — "…se
     * parte do valor é rendimento, informe quanto: o sistema não estima
     * rentabilidade." — chegava ao usuário reduzida à segunda metade, sem a
     * causa e sem a orientação.
     */
    const clean = message
      .replace(/^\s*(?:FirebaseError|Error|[a-z]+\/[a-z-]+)\s*:\s*/i, '')
      .trim();
    return clean.length > 0 && clean.length <= 400
      ? clean
      : 'A operação não pôde ser concluída no estado atual.';
  }
  return 'Não foi possível concluir a operação. Tente novamente.';
};

/**
 * Erro do domínio patrimonial já orientado para a experiência simples.
 *
 * Duas recusas do backend são frequentes o bastante para merecerem o passo
 * seguinte junto da causa, em vez de deixarem o usuário sem saída:
 *
 * - **retirada acima do capital conhecido** — a saída é informar quanto do
 *   valor é rendimento, e esse campo mora atrás de "Mais detalhes";
 * - **investimento controlado por quantidade** — é um ativo do regime antigo,
 *   que a tela simples não sabe operar. A frase técnica do domínio é
 *   substituída por uma que não menciona quantidade, resgate detalhado nem
 *   resultado realizado.
 */
export const simpleInvestmentError = (error: unknown): string => {
  const safe = safeInvestmentError(error);
  if (/controlado por quantidade/i.test(safe)) {
    return 'Este investimento foi criado por um cadastro avançado e não pode ' +
      'ser movimentado por aqui. Fale com quem administra o workspace.';
  }
  if (/supera o capital investido/i.test(safe)) {
    return `${safe} Abra "Mais detalhes" na retirada e informe o rendimento incluído.`;
  }
  return safe;
};
