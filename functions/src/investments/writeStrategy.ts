import type {WorkspaceRole} from "../shared/workspaceAuth";
import type {InvestmentBackendOperation} from "./infrastructure";

/**
 * Matriz declarativa de escrita do domínio de investimentos.
 *
 * Antes do M3 os papéis permitidos existiam duas vezes por operação — uma no
 * wrapper da callable e outra dentro da transação — em cinco arquivos, sem
 * vínculo de compilação entre as duas. Este registro passa a ser a única
 * fonte: `callables.ts` lê `allowedRoles` para o gate não transacional e as
 * operações leem o mesmo valor para a revalidação dentro da transação.
 *
 * `clientDirectWriteAllowed`
 * é do tipo literal `false` para que nenhuma operação possa ser declarada como
 * gravável diretamente pelo cliente.
 */

export type InvestmentWriteTarget =
  | "investment_accounts"
  | "investment_assets"
  | "investment_movements"
  | "investment_positions"
  | "investment_event_logs"
  | "investment_idempotency_keys"
  | "investment_summaries"
  | "investment_report_periods"
  | "investment_allocation_summaries"
  | "investment_operational_metrics"
  | "transactions"
  | "cash_accounts"
  | "cash_account_movements"
  | "goals";

export interface InvestmentBackendWritePlan {
  operation: InvestmentBackendOperation;
  allowedRoles: WorkspaceRole[];
  requiresAuthentication: true;
  requiresWorkspaceMembership: true;
  requiresIdempotencyKey: boolean;
  requiresCorrelationId: boolean;
  requiresFirestoreTransaction: boolean;
  /** Revalida papel dentro da transação, além do gate do wrapper. */
  revalidatesRoleInTransaction: boolean;
  writes: InvestmentWriteTarget[];
  /** Cria movimento no ledger oficial `investment_movements`. */
  appendsToLedger: boolean;
  /** Altera posição, resumo, período, alocação ou meta. */
  updatesProjections: boolean;
  /**
   * Move caixa: espelha em `transactions` e, no fato liquidado, lança o
   * movimento na conta escolhida (D-30, P4-D) no mesmo commit.
   */
  affectsCashProjection: boolean;
  clientDirectWriteAllowed: false;
}

const MUTATION_ROLES: WorkspaceRole[] = ["owner", "admin", "member"];
const PRIVILEGED_ROLES: WorkspaceRole[] = ["owner", "admin"];

export const INVESTMENT_BACKEND_WRITE_PLANS: Record<
  InvestmentBackendOperation,
  InvestmentBackendWritePlan
> = {
  /**
   * Novo investimento no modo simples.
   *
   * Escreve conta e ativo técnicos **na mesma transação** do aporte: se o
   * aporte falha, nada é criado. É por isso que a operação declara
   * `investment_accounts` e `investment_assets` além do que um aporte comum
   * escreve — e por isso ela não pode ser decomposta em duas chamadas.
   */
  createSimpleInvestment: {
    operation: "createSimpleInvestment",
    allowedRoles: MUTATION_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_accounts",
      "investment_assets",
      "investment_movements",
      "investment_positions",
      "investment_summaries",
      "investment_report_periods",
      "investment_allocation_summaries",
      "goals",
      "transactions",
      "cash_accounts",
      "cash_account_movements",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: true,
    // Um investimento criado como pendente não atualiza projeção nenhuma; a
    // matriz declara o teto de efeito da operação, não o de cada chamada.
    updatesProjections: true,
    affectsCashProjection: true,
    clientDirectWriteAllowed: false,
  },
  settleInvestmentContribution: {
    operation: "settleInvestmentContribution",
    allowedRoles: MUTATION_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_movements",
      "investment_positions",
      "investment_summaries",
      "investment_report_periods",
      "investment_allocation_summaries",
      "goals",
      "transactions",
      "cash_accounts",
      "cash_account_movements",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: true,
    affectsCashProjection: true,
    clientDirectWriteAllowed: false,
  },
  /**
   * Retirada no modo simples.
   *
   * Cobre os dois estados numa transação só: pendente (deltas zero) ou já
   * recebida (liquidada de imediato). Não passa pela liquidação de resgate
   * porque não há valores de liquidação a informar — ganho, perda, taxas e
   * imposto são zero por contrato.
   */
  withdrawSimpleInvestment: {
    operation: "withdrawSimpleInvestment",
    allowedRoles: MUTATION_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_movements",
      "investment_positions",
      "investment_summaries",
      "investment_report_periods",
      "investment_allocation_summaries",
      "goals",
      "transactions",
      "cash_accounts",
      "cash_account_movements",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: true,
    updatesProjections: true,
    affectsCashProjection: true,
    clientDirectWriteAllowed: false,
  },
  settleSimpleWithdrawal: {
    operation: "settleSimpleWithdrawal",
    allowedRoles: MUTATION_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_movements",
      "investment_positions",
      "investment_summaries",
      "investment_report_periods",
      "investment_allocation_summaries",
      "goals",
      "transactions",
      "cash_accounts",
      "cash_account_movements",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: true,
    affectsCashProjection: true,
    clientDirectWriteAllowed: false,
  },
  cancelInvestmentMovement: {
    operation: "cancelInvestmentMovement",
    allowedRoles: MUTATION_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    // Só sai de `pending`, cujos deltas são todos zero.
    writes: [
      "investment_movements",
      "transactions",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: false,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  reverseInvestmentMovement: {
    operation: "reverseInvestmentMovement",
    allowedRoles: PRIVILEGED_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_movements",
      "investment_positions",
      "investment_summaries",
      "investment_report_periods",
      "investment_allocation_summaries",
      "goals",
      "transactions",
      "cash_accounts",
      "cash_account_movements",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: true,
    updatesProjections: true,
    affectsCashProjection: true,
    clientDirectWriteAllowed: false,
  },
  // INV-P2-028 — troca de meta como operação própria e atômica: emite o
  // desvínculo e o vínculo no mesmo limite transacional.
  changeInvestmentGoal: {
    operation: "changeInvestmentGoal",
    allowedRoles: MUTATION_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_movements",
      "investment_positions",
      "investment_allocation_summaries",
      "goals",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: true,
    updatesProjections: true,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  linkInvestmentToGoal: {
    operation: "linkInvestmentToGoal",
    allowedRoles: MUTATION_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_movements",
      "investment_positions",
      "investment_allocation_summaries",
      "goals",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: true,
    updatesProjections: true,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  unlinkInvestmentFromGoal: {
    operation: "unlinkInvestmentFromGoal",
    allowedRoles: MUTATION_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_movements",
      "investment_positions",
      "investment_allocation_summaries",
      "goals",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: true,
    updatesProjections: true,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
};

export const getInvestmentBackendWritePlan = (
  operation: InvestmentBackendOperation,
): InvestmentBackendWritePlan => INVESTMENT_BACKEND_WRITE_PLANS[operation];

/** Papéis autorizados a executar a operação, em wrapper e em transação. */
export const investmentOperationRoles = (
  operation: InvestmentBackendOperation,
): WorkspaceRole[] =>
  INVESTMENT_BACKEND_WRITE_PLANS[operation].allowedRoles;
