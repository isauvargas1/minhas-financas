import {
  callInvestment,
  investmentCorrelationId,
  investmentIdempotencyKey,
  investmentRequestIds,
} from './callableApi';

/**
 * Superfície operacional do domínio patrimonial (INV-P1-006).
 *
 * As callables críticas — reconstrução, backfill, valoração e recálculo de
 * posição e de meta — existiam no backend e **não eram invocáveis por nada**:
 * nem tela, nem script, nem runbook. O relatório chegava a exibir "solicite a
 * reconstrução das projeções antes de tomar decisões" sem que existisse
 * controle nenhum que a solicitasse.
 *
 * Este módulo é o único ponto de chamada dessas operações no cliente. Cada uma
 * usa a mesma identidade de intenção das demais operações financeiras
 * (INV-P1-004): a chave de idempotência deriva da intenção, e o
 * `correlationId` é novo a cada tentativa, para que um retry seja replay e
 * apareça no log como tal.
 */

export interface OperationResult {
  success?: boolean;
  completed?: boolean;
  [key: string]: unknown;
}

/** Identificadores de **uma página** de uma execução paginada. */
export interface PageIds {
  idempotencyKey: string;
  correlationId: string;
}

/**
 * Identidade de uma execução paginada.
 *
 * As duas metades puxam para lados opostos, e a superfície acertava as duas ao
 * contrário:
 *
 * - **`correlationId` estável na execução inteira.** O backend deriva dele o
 *   ID do lote quando o chamador não informa um (`projection-rebuild`,
 *   `goal-rebuild`, `bf_…`) e depois recusa qualquer página cujo
 *   `correlationId` não bata com o do checkpoint
 *   ("pertence a outro contexto de execução"). Um `correlationId` novo por
 *   página abre um lote novo por página, e nenhum deles avança.
 * - **`idempotencyKey` distinta por página.** A reserva de idempotência é por
 *   chave: com a mesma chave, a segunda página devolve *o resultado da
 *   primeira* como replay. A execução repete a página 1 até o teto de páginas
 *   e termina em erro, sem nunca ter avançado.
 *
 * Nenhuma das duas falhas aparecia nos testes porque toda a massa de teste
 * cabe numa página só: `completed: true` volta na primeira chamada e o laço
 * nunca chega à segunda. É o `backfill.ts` do backend que já fazia certo, com
 * `derivedKey(baseKey, kind, targetId, page)` por página.
 */
export const pagedRunIds = (
  operation: string,
  nonce: string,
): ((page: number) => PageIds) => {
  const correlationId = investmentCorrelationId();
  return (page: number) => ({
    idempotencyKey: investmentIdempotencyKey(operation, nonce, {
      run: correlationId,
      page,
    }),
    correlationId,
  });
};

const call = (
  name: string,
  nonce: string,
  workspaceId: string,
  payload: Record<string, unknown>,
  ids?: PageIds,
): Promise<OperationResult> => {
  const body = { workspaceId, ...payload };
  return callInvestment(name, {
    ...body,
    ...(ids ?? investmentRequestIds(name, nonce, body)),
  }) as Promise<OperationResult>;
};

export const rebuildInvestmentProjections = (
  workspaceId: string,
  nonce: string,
  reason: string,
  pageSize = 50,
  rebuildId?: string,
  ids?: PageIds,
) =>
  call('rebuildInvestmentProjections', nonce, workspaceId, {
    reason, pageSize,
    ...(rebuildId ? { rebuildId } : {}),
  }, ids);

export const backfillInvestmentWorkspace = (
  workspaceId: string,
  nonce: string,
  reason: string,
  pageSize = 20,
  backfillId?: string,
  ids?: PageIds,
) =>
  call('backfillInvestmentWorkspace', nonce, workspaceId, {
    reason, pageSize,
    ...(backfillId ? { backfillId } : {}),
  }, ids);

export interface ValuationInput {
  workspaceId: string;
  nonce: string;
  accountId: string;
  assetId: string;
  unitPriceMicros: number;
  effectiveAt: string;
  reason: string;
}

/**
 * Registro de valoração (INV-P1-007).
 *
 * Não gera fluxo de caixa: altera o valor de mercado da posição e a variação
 * patrimonial do período, nada mais.
 */
export const recordInvestmentValuation = ({
  workspaceId, nonce, accountId, assetId, unitPriceMicros, effectiveAt, reason,
}: ValuationInput) =>
  call('recordInvestmentValuation', nonce, workspaceId, {
    accountId, assetId, unitPriceMicros, effectiveAt, reason,
    source: 'manual',
  });

export const recalculateInvestmentPosition = (
  workspaceId: string,
  nonce: string,
  accountId: string,
  assetId: string,
  reason: string,
  pageSize = 50,
) =>
  call('recalculateInvestmentPosition', nonce, workspaceId, {
    accountId, assetId, reason, pageSize,
  });

/**
 * Recálculo do progresso **patrimonial** de uma meta (domínio V2).
 *
 * Soma `principalCents` e `currentValueCents` das posições vinculadas à meta e
 * publica o valor absoluto. É paginado por cursor: o chamador repagina
 * enquanto `hasMore` for verdadeiro.
 */
export const recalculateGoalInvestmentProgress = (
  workspaceId: string,
  nonce: string,
  goalId: string,
  reason: string,
  pageSize = 50,
  rebuildId?: string,
  ids?: PageIds,
) =>
  call('recalculateGoalInvestmentProgress', nonce, workspaceId, {
    goalId, reason, pageSize,
    ...(rebuildId ? { rebuildId } : {}),
  }, ids);

/**
 * Reconstrução da projeção mensal de caixa (INV-P1-011).
 *
 * A projeção substitui a varredura da subcoleção inteira de transações no
 * cálculo do saldo acumulado. Como todo acumulador, precisa de caminho de
 * reconstrução — e de backfill, para workspaces cujo histórico é anterior a
 * ela.
 */
export const rebuildCashPeriods = (
  workspaceId: string,
  nonce: string,
  reason: string,
  pageSize = 300,
) => call('rebuildCashPeriods', nonce, workspaceId, { reason, pageSize });

/**
 * Critério padrão de conclusão: `completed: true`.
 *
 * A maioria das operações pesadas do domínio devolve esse campo. As
 * reconstruções de posição e de meta (`rebuild.ts`) devolvem `hasMore` em vez
 * dele — por isso o critério é um parâmetro, e não uma checagem fixa. Assumir
 * `completed` naquelas duas faria a tela repaginar até estourar o teto e
 * relatar falha numa operação que já havia concluído.
 */
const completedFlag = (result: OperationResult): boolean =>
  result.completed === true;

/** Critério das reconstruções paginadas por cursor: acabou quando não há mais. */
export const noMorePages = (result: OperationResult): boolean =>
  result.hasMore === false;

/**
 * Repagina uma operação com checkpoint até concluir.
 *
 * As operações pesadas do domínio são retomáveis por página; o teto existe
 * para que um defeito de avanço vire erro visível em vez de laço infinito no
 * navegador. `isDone` diz o que "concluiu" significa para cada operação.
 */
export const runPaged = async (
  page: (index: number) => Promise<OperationResult>,
  onProgress: (index: number, result: OperationResult) => void,
  maxPages = 500,
  isDone: (result: OperationResult) => boolean = completedFlag,
): Promise<OperationResult> => {
  let last: OperationResult = {};
  for (let index = 0; index < maxPages; index += 1) {
    last = await page(index);
    onProgress(index, last);
    if (isDone(last)) return last;
  }
  throw new Error(
    `A operação não concluiu em ${maxPages} páginas. Verifique o estado antes de repetir.`,
  );
};
