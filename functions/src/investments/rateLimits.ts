import type {InvestmentBackendOperation} from "./infrastructure";
import type {RateLimitPolicy} from "../shared/rateLimit";

/**
 * Limite de frequência por classe de operação do domínio (INV-P2-031).
 *
 * Nenhuma callable de investimento tinha teto. Isso importa por três motivos
 * distintos, e cada classe abaixo responde a um deles:
 *
 * - **custo**: migração, reconstrução e backfill varrem o ledger inteiro; um
 *   laço de chamadas multiplica leitura e escrita do Firestore sem limite;
 * - **contenção**: as mutações escrevem em quatro documentos singleton do
 *   workspace (resumo, período do mês, métrica do dia, alocações), e um
 *   disparo em rajada só produz abortos por contenção;
 * - **integridade**: com idempotência estável (INV-P1-004), uma rajada de
 *   intenções distintas ainda é possível, e um teto por ator dá tempo de o
 *   operador perceber o erro.
 *
 * O limite é por **ator e workspace**, contado num documento do Firestore —
 * contador em memória não limita nada num runtime que escala horizontalmente.
 * Ele é consumido **dentro** da transação da operação, antes de qualquer
 * escrita de domínio.
 */

/** Operações pesadas e paginadas: caras por natureza, raras por desenho. */
const HEAVY_POLICY = {limit: 200, windowSeconds: 60 * 60};

/** Operações administrativas de efeito amplo. */
const ADMIN_POLICY = {limit: 20, windowSeconds: 60 * 60};

/** Mutações financeiras do dia a dia. */
const MUTATION_POLICY = {limit: 120, windowSeconds: 60 * 60};

/** Cadastro e vínculo: sem efeito monetário direto. */
const REGISTRY_POLICY = {limit: 200, windowSeconds: 60 * 60};

const POLICY_BY_OPERATION: Partial<
  Record<InvestmentBackendOperation, {limit: number; windowSeconds: number}>
> = {
  migrateLegacyInvestments: HEAVY_POLICY,
  rollbackLegacyInvestmentMigration: ADMIN_POLICY,
  enableInvestmentsV2Flag: ADMIN_POLICY,
  rebuildInvestmentProjections: HEAVY_POLICY,
  backfillInvestmentWorkspace: HEAVY_POLICY,
  recalculateInvestmentPosition: HEAVY_POLICY,
  recalculateGoalInvestmentProgress: HEAVY_POLICY,
  onboardInvestmentWorkspace: ADMIN_POLICY,

  createInvestmentContribution: MUTATION_POLICY,
  createInvestmentRedemption: MUTATION_POLICY,
  settleInvestmentRedemption: MUTATION_POLICY,
  cancelInvestmentMovement: MUTATION_POLICY,
  reverseInvestmentMovement: MUTATION_POLICY,
  recordInvestmentValuation: MUTATION_POLICY,
  saveInvestmentRedemption: MUTATION_POLICY,
  cancelInvestmentRedemption: MUTATION_POLICY,
  reverseInvestmentRedemption: MUTATION_POLICY,

  saveInvestmentAccount: REGISTRY_POLICY,
  saveInvestmentAsset: REGISTRY_POLICY,
  archiveInvestmentAccount: REGISTRY_POLICY,
  archiveInvestmentAsset: REGISTRY_POLICY,
  linkInvestmentToGoal: REGISTRY_POLICY,
  unlinkInvestmentFromGoal: REGISTRY_POLICY,
  registerInvestmentImportBatch: REGISTRY_POLICY,
};

/**
 * Política da operação, ou `undefined` quando ela não tem teto declarado.
 *
 * Operações de leitura não passam por aqui; toda operação de escrita tem
 * entrada explícita, e uma operação nova sem entrada é uma omissão visível na
 * revisão em vez de um limite implícito.
 */
export const investmentRateLimitPolicy = (
  operation: InvestmentBackendOperation,
): RateLimitPolicy | undefined => {
  const policy = POLICY_BY_OPERATION[operation];
  return policy ? {operation, ...policy} : undefined;
};
