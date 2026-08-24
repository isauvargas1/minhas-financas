import type {WorkspaceMemberRole} from "../creditCards/auth";
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
 * Segue o formato de `creditCards/writeStrategy.ts`; `clientDirectWriteAllowed`
 * é do tipo literal `false` para que nenhuma operação possa ser declarada como
 * gravável diretamente pelo cliente.
 */

export type InvestmentWriteTarget =
  | "investment_accounts"
  | "investment_assets"
  | "investment_movements"
  | "investment_positions"
  | "investment_valuations"
  | "investment_snapshots"
  | "investment_event_logs"
  | "investment_idempotency_keys"
  | "investment_import_batches"
  | "investment_summaries"
  | "investment_report_periods"
  | "investment_allocation_summaries"
  | "investment_operational_metrics"
  | "workspaces"
  | "investment_audit_logs"
  | "transactions"
  | "goals"
  | "settings_catalog";

export interface InvestmentBackendWritePlan {
  operation: InvestmentBackendOperation;
  allowedRoles: WorkspaceMemberRole[];
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
  /** Move caixa e, por isso, espelha em `transactions`. */
  affectsCashProjection: boolean;
  clientDirectWriteAllowed: false;
}

const MUTATION_ROLES: WorkspaceMemberRole[] = ["owner", "admin", "member"];
const PRIVILEGED_ROLES: WorkspaceMemberRole[] = ["owner", "admin"];
const OWNER_ROLES: WorkspaceMemberRole[] = ["owner"];

export const INVESTMENT_BACKEND_WRITE_PLANS: Record<
  InvestmentBackendOperation,
  InvestmentBackendWritePlan
> = {
  onboardInvestmentWorkspace: {
    operation: "onboardInvestmentWorkspace",
    allowedRoles: OWNER_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_accounts",
      "investment_assets",
      "settings_catalog",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: false,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  saveInvestmentAccount: {
    operation: "saveInvestmentAccount",
    allowedRoles: PRIVILEGED_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_accounts",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: false,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  saveInvestmentAsset: {
    operation: "saveInvestmentAsset",
    allowedRoles: PRIVILEGED_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_assets",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: false,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  createInvestmentContribution: {
    operation: "createInvestmentContribution",
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
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: true,
    updatesProjections: true,
    affectsCashProjection: true,
    clientDirectWriteAllowed: false,
  },
  createInvestmentRedemption: {
    operation: "createInvestmentRedemption",
    allowedRoles: MUTATION_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    // Resgate nasce `pending`: não move posição, meta nem caixa liquidada.
    writes: [
      "investment_movements",
      "transactions",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: true,
    updatesProjections: false,
    affectsCashProjection: false,
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
  settleInvestmentRedemption: {
    operation: "settleInvestmentRedemption",
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
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: true,
    affectsCashProjection: true,
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
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: true,
    updatesProjections: true,
    affectsCashProjection: true,
    clientDirectWriteAllowed: false,
  },
  recordInvestmentValuation: {
    operation: "recordInvestmentValuation",
    allowedRoles: PRIVILEGED_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    // Marcação a mercado altera patrimônio; nunca escreve em `transactions`.
    writes: [
      "investment_valuations",
      "investment_positions",
      "investment_summaries",
      "investment_report_periods",
      "investment_allocation_summaries",
      "goals",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
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
  recalculateInvestmentPosition: {
    operation: "recalculateInvestmentPosition",
    allowedRoles: PRIVILEGED_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_positions",
      "investment_summaries",
      "investment_report_periods",
      "investment_allocation_summaries",
      "investment_snapshots",
      "goals",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: true,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  recalculateGoalInvestmentProgress: {
    operation: "recalculateGoalInvestmentProgress",
    allowedRoles: PRIVILEGED_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "goals",
      "investment_snapshots",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: true,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  rebuildInvestmentProjections: {
    operation: "rebuildInvestmentProjections",
    allowedRoles: PRIVILEGED_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_summaries",
      "investment_report_periods",
      "investment_allocation_summaries",
      "investment_snapshots",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: true,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  backfillInvestmentWorkspace: {
    operation: "backfillInvestmentWorkspace",
    allowedRoles: PRIVILEGED_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    // Orquestrador: cada rebuild aninhado abre a própria transação e
    // revalida o papel dentro dela; só o snapshot de progresso é escrito
    // fora de transação.
    requiresFirestoreTransaction: false,
    revalidatesRoleInTransaction: false,
    writes: [
      "investment_positions",
      "investment_summaries",
      "investment_report_periods",
      "investment_allocation_summaries",
      "investment_snapshots",
      "goals",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: true,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  migrateLegacyInvestments: {
    operation: "migrateLegacyInvestments",
    allowedRoles: OWNER_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    // Não escreve em `transactions`: a transação legada já é o registro de
    // caixa do evento migrado.
    writes: [
      "investment_accounts",
      "investment_assets",
      "investment_movements",
      "investment_positions",
      "investment_summaries",
      "investment_report_periods",
      "investment_allocation_summaries",
      "investment_snapshots",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: true,
    updatesProjections: true,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  rollbackLegacyInvestmentMigration: {
    operation: "rollbackLegacyInvestmentMigration",
    allowedRoles: OWNER_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    // Desliga a flag e marca o lote; nenhum movimento é apagado.
    writes: [
      "workspaces",
      "investment_snapshots",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: false,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  enableInvestmentsV2Flag: {
    operation: "enableInvestmentsV2Flag",
    allowedRoles: OWNER_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "workspaces",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: false,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  registerInvestmentImportBatch: {
    operation: "registerInvestmentImportBatch",
    allowedRoles: PRIVILEGED_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_import_batches",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: false,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  archiveInvestmentAccount: {
    operation: "archiveInvestmentAccount",
    allowedRoles: PRIVILEGED_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_accounts",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: false,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  archiveInvestmentAsset: {
    operation: "archiveInvestmentAsset",
    allowedRoles: PRIVILEGED_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: true,
    writes: [
      "investment_assets",
      "investment_event_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: false,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  saveInvestmentRedemption: {
    operation: "saveInvestmentRedemption",
    allowedRoles: MUTATION_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    // Trilha legada do M2: sem revalidação dentro da transação.
    revalidatesRoleInTransaction: false,
    writes: [
      "transactions",
      "goals",
      "investment_audit_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: false,
    affectsCashProjection: true,
    clientDirectWriteAllowed: false,
  },
  cancelInvestmentRedemption: {
    operation: "cancelInvestmentRedemption",
    allowedRoles: MUTATION_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: false,
    writes: [
      "transactions",
      "investment_audit_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: false,
    affectsCashProjection: false,
    clientDirectWriteAllowed: false,
  },
  reverseInvestmentRedemption: {
    operation: "reverseInvestmentRedemption",
    // Alinhado à equivalente V2 `reverseInvestmentMovement`: estorno é
    // privilegiado. Antes do M3 esta callable aceitava `member`.
    allowedRoles: PRIVILEGED_ROLES,
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresCorrelationId: true,
    requiresFirestoreTransaction: true,
    revalidatesRoleInTransaction: false,
    writes: [
      "transactions",
      "goals",
      "investment_audit_logs",
      "investment_idempotency_keys",
      "investment_operational_metrics",
    ],
    appendsToLedger: false,
    updatesProjections: false,
    affectsCashProjection: true,
    clientDirectWriteAllowed: false,
  },
};

export const getInvestmentBackendWritePlan = (
  operation: InvestmentBackendOperation,
): InvestmentBackendWritePlan => INVESTMENT_BACKEND_WRITE_PLANS[operation];

/** Papéis autorizados a executar a operação, em wrapper e em transação. */
export const investmentOperationRoles = (
  operation: InvestmentBackendOperation,
): WorkspaceMemberRole[] =>
  INVESTMENT_BACKEND_WRITE_PLANS[operation].allowedRoles;
