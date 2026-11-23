/**
 * Executa a revalidação pós-commit sem ligá-la ao ciclo de vida da mutação.
 *
 * Só deve ser chamado a partir do onSuccess de uma callable confirmada. Assim,
 * mesmo uma leitura lenta, pendente ou falha não mantém bloqueada a confirmação
 * de uma escrita que o servidor já confirmou. As queries continuam sendo
 * invalidadas/refetchadas normalmente pela função recebida.
 */
export const runCashRefreshAfterCommit = (
  refresh: () => Promise<unknown>,
  reportFailure: () => void,
): void => {
  // Agendar para a próxima microtask também evita que uma falha síncrona de
  // atualização seja confundida com falha na escrita financeira confirmada.
  void Promise.resolve().then(refresh).catch(reportFailure);
};
