import { callInvestment, investmentRequestIds } from './callableApi';

/**
 * Superfície operacional do domínio patrimonial (INV-P1-006).
 *
 * Nove callables críticas — migração, reconciliação, rollback, habilitação da
 * flag, reconstrução, backfill, valoração e recálculo de posição e de meta —
 * existiam no backend e **não eram invocáveis por nada**: nem tela, nem
 * script, nem runbook. O relatório chegava a exibir "solicite a reconstrução
 * das projeções antes de tomar decisões" sem que existisse controle nenhum que
 * a solicitasse.
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

const call = (
  name: string,
  nonce: string,
  workspaceId: string,
  payload: Record<string, unknown>,
): Promise<OperationResult> => {
  const body = { workspaceId, ...payload };
  return callInvestment(name, {
    ...body,
    ...investmentRequestIds(name, nonce, body),
  }) as Promise<OperationResult>;
};

export interface MigrationInput {
  workspaceId: string;
  nonce: string;
  dryRun: boolean;
  reason: string;
  pageSize?: number;
  migrationId?: string;
}

/**
 * Uma página da migração legada.
 *
 * O chamador repagina até `completed`. A simulação e a aplicação usam lotes
 * separados no backend (INV-P1-003), então rodar a simulação **não** consome
 * o checkpoint da aplicação.
 */
export const migrateLegacyInvestments = ({
  workspaceId, nonce, dryRun, reason, pageSize = 50, migrationId,
}: MigrationInput) =>
  call('migrateLegacyInvestments', nonce, workspaceId, {
    dryRun, reason, pageSize,
    ...(migrationId ? { migrationId } : {}),
  });

export const reconcileLegacyMigration = (
  workspaceId: string,
  nonce: string,
  pageSize = 100,
) => call('reconcileLegacyMigration', nonce, workspaceId, { pageSize });

export const rollbackLegacyInvestmentMigration = (
  workspaceId: string,
  nonce: string,
  migrationId: string,
  reason: string,
  pageSize = 20,
) =>
  call('rollbackLegacyInvestmentMigration', nonce, workspaceId, {
    migrationId, reason, pageSize,
  });

export const enableInvestmentsV2Flag = (
  workspaceId: string,
  nonce: string,
  reason: string,
  migrationId?: string,
) =>
  call('enableInvestmentsV2Flag', nonce, workspaceId, {
    reason, pageSize: 100,
    ...(migrationId ? { migrationId } : {}),
  });

export const rebuildInvestmentProjections = (
  workspaceId: string,
  nonce: string,
  reason: string,
  pageSize = 50,
  rebuildId?: string,
) =>
  call('rebuildInvestmentProjections', nonce, workspaceId, {
    reason, pageSize,
    ...(rebuildId ? { rebuildId } : {}),
  });

export const backfillInvestmentWorkspace = (
  workspaceId: string,
  nonce: string,
  reason: string,
  pageSize = 20,
  backfillId?: string,
) =>
  call('backfillInvestmentWorkspace', nonce, workspaceId, {
    reason, pageSize,
    ...(backfillId ? { backfillId } : {}),
  });

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

export const recalculateGoalInvestmentProgress = (
  workspaceId: string,
  nonce: string,
  goalId: string,
  reason: string,
  pageSize = 50,
) =>
  call('recalculateGoalInvestmentProgress', nonce, workspaceId, {
    goalId, reason, pageSize,
  });

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
 * Repagina uma operação com checkpoint até concluir.
 *
 * Todas as operações pesadas do domínio devolvem `completed: false` enquanto
 * houver página pendente. O teto de páginas existe para que um defeito de
 * avanço vire erro visível em vez de laço infinito no navegador.
 */
export const runPaged = async (
  page: (index: number) => Promise<OperationResult>,
  onProgress: (index: number, result: OperationResult) => void,
  maxPages = 500,
): Promise<OperationResult> => {
  let last: OperationResult = {};
  for (let index = 0; index < maxPages; index += 1) {
    last = await page(index);
    onProgress(index, last);
    if (last.completed === true) return last;
  }
  throw new Error(
    `A operação não concluiu em ${maxPages} páginas. Verifique o estado antes de repetir.`,
  );
};
