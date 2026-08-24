import * as admin from "firebase-admin";
import {FieldPath, FieldValue, Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../creditCards/auth";
import {CreditCardApplicationError} from "../creditCards/errors";
import type {
  EnableInvestmentsV2FlagPayload,
  MigrateLegacyInvestmentsPayload,
  RollbackLegacyInvestmentMigrationPayload,
} from "./contracts";
import {assertInvestmentDocument} from "./documentContracts";
import {
  INVESTMENT_CALCULATION_VERSION,
  INVESTMENT_DOMAIN_VERSION,
} from "./domain";
import {
  authorizeInvestmentTransaction,
  deterministicDocumentId,
  investmentPositionId,
  profileTypeFromWorkspace,
} from "./infrastructure";
import {addExact} from "./math";
import {recordInvestmentOperationMetric} from "./observability";
import {
  INVESTMENT_COLLECTIONS,
  investmentCollection,
  investmentDoc,
  investmentFirestore,
  investmentWorkspaceRef,
} from "./paths";
import {
  readInvestmentPeriodContext,
  writeInvestmentAllocationProjections,
  writeInvestmentReportPeriod,
} from "./reporting";
import {positionState, writePosition} from "./operationsV2";
import {investmentOperationRoles} from "./writeStrategy";

/**
 * Migração do legado M1/M2 para o domínio oficial.
 *
 * `backfillInvestmentWorkspace` só reconstrói projeções sobre movimentos que
 * já estão no domínio. Esta rotina é o passo anterior: traz os aportes e
 * resgates que vivem em `transactions` para `investment_movements`.
 *
 * O ponto que a separa de um aporte normal é o caixa. O caminho normal grava
 * um espelho em `transactions`; aqui a transação **já existe** e é a própria
 * origem, então nenhum espelho é escrito. O movimento aponta para ela por
 * `transactionId` e carrega `migratedFromTransactionId`, e o caixa segue
 * contado uma única vez.
 */

const SNAPSHOT_KIND = "legacy_migration" as const;

/** Nome do par de destino criado quando o legado não tem conta nem ativo. */
export const LEGACY_ENTITY_NAME = "Investimentos legados";

/**
 * Quantidade sintética do legado: uma micro-unidade por centavo de principal.
 * O legado não registra quantidade nem preço, e o domínio exige quantidade
 * positiva. A convenção mantém `currentValue === principal` enquanto não
 * houver valoração, que é exatamente a semântica do dado migrado.
 */
const quantityForLegacy = (principalCents: number): number => principalCents;

interface MigrationTotals {
  contributionPrincipalCents: number;
  redemptionPrincipalCents: number;
  realizedGainCents: number;
  feesCents: number;
  taxCents: number;
}

const emptyTotals = (): MigrationTotals => ({
  contributionPrincipalCents: 0,
  redemptionPrincipalCents: 0,
  realizedGainCents: 0,
  feesCents: 0,
  taxCents: 0,
});

const integerOrZero = (value: unknown): number =>
  Number.isSafeInteger(value) ? (value as number) : 0;

const centsFromLegacy = (data: admin.firestore.DocumentData): number => {
  const metadataPrincipal = data.investmentMetadata?.principalCents;
  if (Number.isSafeInteger(metadataPrincipal)) return metadataPrincipal;
  if (Number.isSafeInteger(data.valueCents)) return data.valueCents;
  const value = Number(data.value);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
};

export type LegacyRowKind =
  | "contribution"
  | "redemption"
  | "redemption_reversal";

export interface LegacyRowDecision {
  kind?: LegacyRowKind;
  /** Motivo da exclusão, quando a linha não migra. */
  skipReason?: string;
  /**
   * A linha foi excluída porque o classificador **não a reconhece**, e não
   * porque ela seja legitimamente irrelevante. Reconciliar por cima disso é
   * comparar o erro consigo mesmo, então a reconciliação falha fechada.
   */
  unclassified?: boolean;
  /** Transação de origem compensada, quando a linha é um estorno. */
  reversalOfTransactionId?: string;
  principalCents: number;
  gainCents: number;
  feesCents: number;
  taxCents: number;
}

/** Exclusões legítimas: o fato não aconteceu, logo não há o que migrar. */
const LEGITIMATE_SKIP_STATUSES = ["pending", "cancelled"];

/**
 * Classifica uma transação legada. Pendente e cancelado ficam de fora: não são
 * fato consumado e não alteraram caixa, posição nem meta.
 *
 * O estorno (`redemption_reversal`) **migra**. No legado ele é a transação
 * compensatória que devolve o principal e anula o ganho do resgate revertido,
 * enquanto o resgate original permanece com `status: "reversed"` — ou seja,
 * continua elegível. Descartar o estorno e migrar o resgate revertido
 * subavalia o patrimônio e inventa renda realizada; e, como
 * `reconcileLegacyMigration` soma o lado legado com este mesmo classificador,
 * o erro fecharia consigo mesmo e liberaria a flag.
 */
export const classifyLegacyRow = (
  data: admin.firestore.DocumentData,
): LegacyRowDecision => {
  const base = {principalCents: 0, gainCents: 0, feesCents: 0, taxCents: 0};
  if (data.type !== "investimento") {
    return {...base, skipReason: "nao_e_investimento"};
  }
  // Baixa lógica (INV-P2-032). A transação continua no histórico para
  // auditoria, mas não é fato consumado: migrá-la inventaria patrimônio. É
  // exclusão legítima, não `unclassified`.
  if (data.voidedAt !== undefined && data.voidedAt !== null) {
    return {...base, skipReason: "baixada_logicamente"};
  }
  const metadata = data.investmentMetadata;
  if (!metadata) {
    if (data.isPaid === false) return {...base, skipReason: "nao_liquidado"};
    const principalCents = centsFromLegacy(data);
    if (principalCents <= 0) return {...base, skipReason: "sem_valor"};
    return {...base, kind: "contribution", principalCents};
  }
  const status = String(metadata.status);
  if (metadata.status !== "settled" && metadata.status !== "reversed") {
    return {
      ...base,
      skipReason: `status_${status}`,
      unclassified: !LEGITIMATE_SKIP_STATUSES.includes(status),
    };
  }
  const operation = metadata.investmentOperation;
  if (operation === "redemption" || operation === "redemption_reversal") {
    const principalCents = integerOrZero(metadata.principalCents);
    if (principalCents <= 0) return {...base, skipReason: "sem_valor"};
    return {
      kind: operation,
      principalCents,
      gainCents: integerOrZero(metadata.gainCents),
      feesCents: integerOrZero(metadata.feesCents),
      taxCents: integerOrZero(metadata.taxCents),
      ...(operation === "redemption_reversal" &&
        typeof metadata.sourceMovementId === "string" ?
        {reversalOfTransactionId: metadata.sourceMovementId} :
        {}),
    };
  }
  if (operation && operation !== "contribution") {
    return {
      ...base,
      skipReason: `operacao_${String(operation)}`,
      unclassified: true,
    };
  }
  const principalCents = centsFromLegacy(data);
  if (principalCents <= 0) return {...base, skipReason: "sem_valor"};
  return {...base, kind: "contribution", principalCents};
};

/** Linha já classificada como migrável; `kind` deixa de ser opcional. */
export interface MigratableLegacyRow extends LegacyRowDecision {
  kind: LegacyRowKind;
}

/** Sinal do principal na posição e na reconciliação. */
export const legacyPrincipalSign = (kind: LegacyRowKind): 1 | -1 =>
  kind === "redemption" ? -1 : 1;

/** Sinal do resultado realizado: o estorno anula o ganho do resgate. */
export const legacyResultSign = (kind: LegacyRowKind): 1 | -1 =>
  kind === "redemption_reversal" ? -1 : 1;

interface MigrationState {
  phase: "scanning" | "completed";
  /** Último documento da página anterior: data (chave de ordem) e ID. */
  cursor?: string;
  cursorDate?: string;
  scanned: number;
  migrated: number;
  alreadyMigrated: number;
  skipped: Record<string, number>;
  totals: MigrationTotals;
  rolledBack: boolean;
}

const readState = (
  snapshot: admin.firestore.DocumentSnapshot,
): MigrationState => {
  const data = snapshot.data() ?? {};
  return {
    phase: (data.phase ?? "scanning") as MigrationState["phase"],
    cursor: typeof data.cursor === "string" ? data.cursor : undefined,
    cursorDate:
      typeof data.cursorDate === "string" ? data.cursorDate : undefined,
    scanned: integerOrZero(data.scanned),
    migrated: integerOrZero(data.migrated),
    alreadyMigrated: integerOrZero(data.alreadyMigrated),
    skipped: (data.skipped ?? {}) as Record<string, number>,
    // `totals` guarda a forma exigida pelo contrato de snapshot; os totais da
    // migração vivem em `migrationTotals` e são o que precisa sobreviver
    // entre páginas.
    totals: {...emptyTotals(), ...(data.migrationTotals ?? {})},
    rolledBack: data.rolledBack === true,
  };
};

const legacyMovementId = (transactionId: string): string =>
  deterministicDocumentId("legacy-migration", transactionId);

const legacyAccountId = (workspaceId: string): string =>
  deterministicDocumentId("legacy-account", workspaceId);

const legacyAssetId = (workspaceId: string): string =>
  deterministicDocumentId("legacy-asset", workspaceId);

/** Par conta+ativo de destino, criado sob demanda e sempre com o mesmo ID. */
const writeLegacyEntities = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  profileType: "PF" | "PJ",
  actorId: string,
  accountSnapshot: admin.firestore.DocumentSnapshot,
  assetSnapshot: admin.firestore.DocumentSnapshot,
): {accountId: string; assetId: string; created: boolean} => {
  const accountId = legacyAccountId(workspaceId);
  const assetId = legacyAssetId(workspaceId);
  const accountRef = accountSnapshot.ref;
  const assetRef = assetSnapshot.ref;
  const now = FieldValue.serverTimestamp();
  let created = false;
  if (!accountSnapshot.exists) {
    created = true;
    transaction.create(
      accountRef,
      assertInvestmentDocument("account", {
        id: accountId,
        workspaceId,
        profileType,
        name: LEGACY_ENTITY_NAME,
        institutionName: "Origem anterior ao domínio patrimonial",
        currency: "BRL",
        status: "active",
        createdBy: actorId,
        createdAt: now,
        updatedBy: actorId,
        updatedAt: now,
      }, workspaceId),
    );
  }
  if (!assetSnapshot.exists) {
    created = true;
    transaction.create(
      assetRef,
      assertInvestmentDocument("asset", {
        id: assetId,
        workspaceId,
        profileType,
        name: LEGACY_ENTITY_NAME,
        assetType: "other",
        allocationPurpose: "unassigned",
        currency: "BRL",
        status: "active",
        createdBy: actorId,
        createdAt: now,
        updatedBy: actorId,
        updatedAt: now,
      }, workspaceId),
    );
  }
  return {accountId, assetId, created};
};

/**
 * Reconciliação: soma do legado em `transactions` contra a soma do domínio em
 * `investment_positions`. Ambas paginadas, sem varredura sem teto.
 */
export interface LegacyReconciliation {
  legacyPrincipalCents: number;
  domainPrincipalCents: number;
  legacyRealizedGainCents: number;
  domainRealizedGainCents: number;
  /** Linhas que o classificador não reconhece; qualquer uma reprova. */
  unclassifiedCount: number;
  reconciled: boolean;
}

export const reconcileLegacyMigration = async (
  workspaceId: string,
  pageSize: number,
): Promise<LegacyReconciliation> => {
  const db = investmentFirestore();
  let legacyPrincipalCents = 0;
  let legacyRealizedGainCents = 0;
  let unclassifiedCount = 0;
  let cursor: string | undefined;
  for (let page = 0; page < 500; page += 1) {
    let query = db
      .collection(`workspaces/${workspaceId}/transactions`)
      .where("type", "==", "investimento")
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    cursor = snapshot.docs[snapshot.docs.length - 1].id;
    for (const entry of snapshot.docs) {
      const decision = classifyLegacyRow(entry.data());
      if (decision.unclassified) unclassifiedCount += 1;
      if (!decision.kind) continue;
      legacyPrincipalCents +=
        legacyPrincipalSign(decision.kind) * decision.principalCents;
      if (decision.kind !== "contribution") {
        legacyRealizedGainCents +=
          legacyResultSign(decision.kind) * decision.gainCents;
      }
    }
    if (snapshot.size < pageSize) break;
  }

  let domainPrincipalCents = 0;
  let domainRealizedGainCents = 0;
  let positionCursor: string | undefined;
  for (let page = 0; page < 500; page += 1) {
    let query = investmentCollection(
      workspaceId,
      INVESTMENT_COLLECTIONS.positions,
    )
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (positionCursor) query = query.startAfter(positionCursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    positionCursor = snapshot.docs[snapshot.docs.length - 1].id;
    for (const entry of snapshot.docs) {
      domainPrincipalCents += integerOrZero(entry.data().principalCents);
      domainRealizedGainCents += integerOrZero(entry.data().realizedGainCents);
    }
    if (snapshot.size < pageSize) break;
  }

  return {
    legacyPrincipalCents,
    domainPrincipalCents,
    legacyRealizedGainCents,
    domainRealizedGainCents,
    unclassifiedCount,
    // Os dois lados passam pelo mesmo classificador, então a igualdade sozinha
    // não prova correção: prova apenas coerência interna. Uma linha que o
    // classificador não reconhece invalida a comparação inteira e reprova.
    reconciled:
      unclassifiedCount === 0 &&
      legacyPrincipalCents === domainPrincipalCents &&
      legacyRealizedGainCents === domainRealizedGainCents,
  };
};

export const executeMigrateLegacyInvestments = async (
  auth: WorkspaceAuthorizationContext,
  payload: MigrateLegacyInvestmentsPayload,
): Promise<Record<string, unknown>> => {
  const migrationId =
    payload.migrationId ??
    deterministicDocumentId("legacy-migration-run", auth.workspaceId);
  const snapshotRef = investmentDoc(
    auth.workspaceId,
    INVESTMENT_COLLECTIONS.snapshots,
    migrationId,
  );

  const workspaceSnapshot = await investmentWorkspaceRef(auth.workspaceId).get();
  if (!workspaceSnapshot.exists) {
    throw new CreditCardApplicationError(
      "workspace_not_found",
      "Workspace não encontrado.",
    );
  }
  const profileType = profileTypeFromWorkspace(workspaceSnapshot.data() ?? {});

  const existing = await snapshotRef.get();
  const state = existing.exists ?
    readState(existing) :
    {
      phase: "scanning" as const,
      scanned: 0,
      migrated: 0,
      alreadyMigrated: 0,
      skipped: {} as Record<string, number>,
      totals: emptyTotals(),
      rolledBack: false,
    };

  // Uma página de transações legadas por chamada, com cursor por workspace.
  //
  // A ordem é **cronológica**, não por ID. IDs do Firestore são aleatórios, e
  // aplicar um resgate antes do aporte que ele consome deixava a posição sem
  // saldo no momento da aplicação. `date` é o campo que as Rules exigem em toda
  // transação (`isDateOnlyString`), e o ID desempata para o cursor ser estável.
  let query = investmentFirestore()
    .collection(`workspaces/${auth.workspaceId}/transactions`)
    .where("type", "==", "investimento")
    .orderBy("date", "asc")
    .orderBy(FieldPath.documentId(), "asc")
    .limit(payload.pageSize);
  if (state.cursorDate && state.cursor) {
    query = query.startAfter(state.cursorDate, state.cursor);
  }
  const page = await query.get();

  for (const entry of page.docs) {
    state.scanned += 1;
    const decision = classifyLegacyRow(entry.data());
    if (!decision.kind) {
      const reason = decision.skipReason ?? "desconhecido";
      state.skipped[reason] = (state.skipped[reason] ?? 0) + 1;
      continue;
    }
    if (decision.kind === "contribution") {
      state.totals.contributionPrincipalCents = addExact(
        state.totals.contributionPrincipalCents,
        decision.principalCents,
        "contributionPrincipalCents",
      );
    } else {
      // O estorno entra com sinal invertido em toda componente: ele compensa
      // o resgate revertido, que continua migrando por estar `reversed`.
      const sign = legacyResultSign(decision.kind);
      state.totals.redemptionPrincipalCents = addExact(
        state.totals.redemptionPrincipalCents,
        sign * decision.principalCents,
        "redemptionPrincipalCents",
      );
      state.totals.realizedGainCents = addExact(
        state.totals.realizedGainCents,
        sign * decision.gainCents,
        "realizedGainCents",
      );
      state.totals.feesCents = addExact(
        state.totals.feesCents,
        sign * decision.feesCents,
        "feesCents",
      );
      state.totals.taxCents = addExact(
        state.totals.taxCents,
        sign * decision.taxCents,
        "taxCents",
      );
    }

    if (payload.dryRun) continue;

    const applied = await applyLegacyRow(
      auth,
      profileType,
      entry,
      {...decision, kind: decision.kind},
      migrationId,
    );
    if (applied === "created") state.migrated += 1;
    else state.alreadyMigrated += 1;
  }

  const last = page.docs[page.docs.length - 1];
  if (last) {
    state.cursor = last.id;
    state.cursorDate = String(last.get("date"));
  }
  const completed = page.size < payload.pageSize;
  if (completed) state.phase = "completed";

  // A varredura ordena por `date`, e o Firestore omite da ordenação todo
  // documento que não tem o campo. Sem esta conferência, uma transação de
  // investimento sem `date` sairia da migração em silêncio. O `count()` é
  // agregado, não traz documentos.
  if (completed) {
    const total = await investmentFirestore()
      .collection(`workspaces/${auth.workspaceId}/transactions`)
      .where("type", "==", "investimento")
      .count()
      .get();
    const expected = total.data().count;
    if (expected !== state.scanned) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        `A varredura cronológica alcançou ${state.scanned} de ${expected} ` +
          "transações de investimento. As restantes não têm o campo `date` " +
          "e precisam ser corrigidas antes de migrar.",
      );
    }
  }

  await snapshotRef.set(
    {
      id: migrationId,
      workspaceId: auth.workspaceId,
      profileType,
      kind: SNAPSHOT_KIND,
      targetId: auth.workspaceId,
      status: completed ? "completed" : "running",
      phase: state.phase,
      dryRun: payload.dryRun === true,
      cutoffAt: existing.exists ?
        (existing.data()?.cutoffAt as Timestamp) :
        Timestamp.now(),
      processedCount: state.scanned,
      expectedProjectionVersion: 0,
      totals: {
        quantityMicros: 0,
        principalCents:
          state.totals.contributionPrincipalCents -
          state.totals.redemptionPrincipalCents,
        realizedGainCents: state.totals.realizedGainCents,
        feesCents: state.totals.feesCents,
        taxCents: state.totals.taxCents,
        netContributionCents:
          state.totals.contributionPrincipalCents -
          state.totals.redemptionPrincipalCents,
        currentValueCents:
          state.totals.contributionPrincipalCents -
          state.totals.redemptionPrincipalCents,
      },
      migrationTotals: state.totals,
      scanned: state.scanned,
      migrated: state.migrated,
      alreadyMigrated: state.alreadyMigrated,
      skipped: state.skipped,
      rolledBack: state.rolledBack,
      ...(state.cursor ? {cursor: state.cursor} : {}),
      ...(state.cursorDate ? {cursorDate: state.cursorDate} : {}),
      pageSize: payload.pageSize,
      calculationVersion: INVESTMENT_CALCULATION_VERSION,
      correlationId: payload.correlationId,
      createdBy: auth.uid,
      createdAt: existing.exists ?
        (existing.data()?.createdAt as Timestamp) :
        FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(completed ? {completedAt: FieldValue.serverTimestamp()} : {}),
    },
    {merge: true},
  );

  return {
    success: true,
    migrationId,
    dryRun: payload.dryRun === true,
    completed,
    scanned: state.scanned,
    migrated: state.migrated,
    alreadyMigrated: state.alreadyMigrated,
    skipped: state.skipped,
    totals: state.totals,
  };
};

/**
 * Aplica uma linha legada, em transação própria. Nunca escreve espelho de
 * caixa: a transação de origem já é o registro de caixa daquele evento.
 */
const applyLegacyRow = async (
  auth: WorkspaceAuthorizationContext,
  profileType: "PF" | "PJ",
  entry: admin.firestore.QueryDocumentSnapshot,
  decision: MigratableLegacyRow,
  migrationId: string,
): Promise<"created" | "existing"> => {
  const movementId = legacyMovementId(entry.id);
  const occurredAt = (entry.data().transactionDate as Timestamp | undefined) ??
    Timestamp.fromDate(new Date(`${String(entry.data().date)}T12:00:00.000Z`));

  return investmentFirestore().runTransaction(async (transaction) => {
    const authorization = await authorizeInvestmentTransaction(
      transaction,
      auth,
      investmentOperationRoles("migrateLegacyInvestments"),
    );
    const movementRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.movements,
      movementId,
    );
    const movementSnapshot = await transaction.get(movementRef);
    // Idempotência: o ID vem da transação de origem, então reexecutar não
    // cria segunda cópia do mesmo fato.
    if (movementSnapshot.exists) return "existing" as const;

    // Os IDs de destino são determinísticos, então as referências existem sem
    // depender de leitura. Todas as leituras acontecem aqui, antes de
    // qualquer escrita, como a transação do Firestore exige.
    const accountId = legacyAccountId(auth.workspaceId);
    const assetId = legacyAssetId(auth.workspaceId);
    const positionId = investmentPositionId(accountId, assetId);
    const [accountSnapshot, assetSnapshot, positionSnapshot] =
      await Promise.all([
        transaction.get(
          investmentDoc(
            auth.workspaceId,
            INVESTMENT_COLLECTIONS.accounts,
            accountId,
          ),
        ),
        transaction.get(
          investmentDoc(
            auth.workspaceId,
            INVESTMENT_COLLECTIONS.assets,
            assetId,
          ),
        ),
        transaction.get(
          investmentDoc(
            auth.workspaceId,
            INVESTMENT_COLLECTIONS.positions,
            positionId,
          ),
        ),
      ]);
    const periodContext = await readInvestmentPeriodContext(
      transaction,
      auth.workspaceId,
      occurredAt,
    );

    writeLegacyEntities(
      transaction,
      auth.workspaceId,
      profileType,
      auth.uid,
      accountSnapshot,
      assetSnapshot,
    );

    const current = positionState(positionSnapshot);
    const isContribution = decision.kind === "contribution";
    const isReversal = decision.kind === "redemption_reversal";
    // Sinal por classe: aporte e estorno somam principal, resgate subtrai; o
    // estorno ainda desfaz ganho, taxa e imposto do resgate que compensa.
    const principalSign = legacyPrincipalSign(decision.kind);
    const resultSign = legacyResultSign(decision.kind);
    const quantityDelta =
      principalSign * quantityForLegacy(decision.principalCents);
    const principalDelta = principalSign * decision.principalCents;

    const next = {
      ...current,
      quantityMicros: current.quantityMicros + quantityDelta,
      principalCents: current.principalCents + principalDelta,
      realizedGainCents:
        current.realizedGainCents + resultSign * decision.gainCents,
      feesCents: current.feesCents + resultSign * decision.feesCents,
      taxCents: current.taxCents + resultSign * decision.taxCents,
      currentValueCents: current.currentValueCents + principalDelta,
      version: current.version + 1,
    };

    // Truncar com `Math.min` produzia um movimento com `principalCents` cheio
    // e `principalDeltaCents` zero: ledger permanentemente errado, invisível
    // ao rerun (idempotente por ID) e impossível de reparar sem apagar
    // histórico. Falhar aqui aborta a transação antes de qualquer escrita, e o
    // cursor não avança, então a operação é retomável depois da correção.
    if (
      next.quantityMicros < 0 || next.principalCents < 0 ||
      next.realizedGainCents < 0 || next.feesCents < 0 || next.taxCents < 0
    ) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        `A transação legada ${entry.id} deixaria a posição inconsistente ` +
          "(saldo insuficiente para o resgate ou estorno sem o evento " +
          "original). Corrija o histórico legado antes de migrar.",
      );
    }

    const movement = {
      id: movementId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      domainVersion: INVESTMENT_DOMAIN_VERSION,
      calculationVersion: INVESTMENT_CALCULATION_VERSION,
      accountId,
      assetId,
      positionId,
      operation: isContribution ?
        "contribution" :
        isReversal ? "reversal" : "redemption",
      ...(isReversal ? {reversalOfOperation: "redemption" as const} : {}),
      status: "settled",
      currency: "BRL",
      description: String(entry.data().description ?? LEGACY_ENTITY_NAME)
        .slice(0, 500),
      principalCents: decision.principalCents,
      gainCents: decision.gainCents,
      feesCents: decision.feesCents,
      taxCents: decision.taxCents,
      quantityMicros: Math.abs(quantityDelta),
      // O caixa deste evento já está registrado na transação de origem, por
      // isso o delta de caixa do movimento migrado é zero: contá-lo de novo
      // duplicaria o fluxo.
      cashDeltaCents: 0,
      principalDeltaCents: principalDelta,
      realizedGainDeltaCents: resultSign * decision.gainCents,
      feesDeltaCents: resultSign * decision.feesCents,
      taxDeltaCents: resultSign * decision.taxCents,
      quantityDeltaMicros: quantityDelta,
      goalNetContributionDeltaCents: 0,
      goalCurrentValueDeltaCents: 0,
      currentValueDeltaCents: principalDelta,
      transactionId: entry.id,
      migratedFromTransactionId: entry.id,
      // O contrato do documento exige que todo `reversal` aponte para o
      // movimento compensado. No legado o alvo é a transação do resgate, cujo
      // movimento migrado tem ID derivado dela.
      ...(isReversal && decision.reversalOfTransactionId ?
        {reversedMovementId: legacyMovementId(decision.reversalOfTransactionId)} :
        {}),
      migrationId,
      correlationId: `legacy-migration-${entry.id}`.slice(0, 200),
      idempotencyKeyHash: movementId,
      occurredAt,
      settlementAt: occurredAt,
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      settledBy: auth.uid,
      settledAt: FieldValue.serverTimestamp(),
    };
    transaction.create(
      movementRef,
      assertInvestmentDocument("movement", movement, auth.workspaceId),
    );

    writePosition(
      transaction,
      positionSnapshot,
      auth.workspaceId,
      authorization.profileType,
      accountId,
      assetId,
      next,
      movementId,
      occurredAt,
      auth.uid,
    );
    writeInvestmentAllocationProjections(
      transaction,
      auth.workspaceId,
      authorization.profileType,
      auth.uid,
      accountSnapshot.data() ?? {},
      assetSnapshot.data() ?? {},
      current,
      next,
    );
    writeInvestmentReportPeriod(
      transaction,
      auth.workspaceId,
      authorization.profileType,
      auth.uid,
      occurredAt,
      {
        operation: isContribution ?
          "contribution" :
          isReversal ? "reversal" : "redemption",
        ...(isReversal ? {reversalOfOperation: "redemption" as const} : {}),
        principalCents: decision.principalCents,
        gainCents: decision.gainCents,
        feesCents: decision.feesCents,
        taxCents: decision.taxCents,
        // Zero: o caixa foi registrado pela transação legada.
        cashDeltaCents: 0,
        currentValueDeltaCents: principalDelta,
      },
      periodContext,
    );
    recordInvestmentOperationMetric(transaction, {
      workspaceId: auth.workspaceId,
      operation: "migrateLegacyInvestments",
      actorId: auth.uid,
      accountId,
      assetId,
      movementId,
      correlationId: `legacy-migration-${migrationId}`,
    });
    return "created" as const;
  });
};

/**
 * Rollback sem apagar histórico.
 *
 * Desliga a flag e marca o lote como revertido. Os movimentos criados
 * **permanecem**: apagar histórico financeiro é proibido, e o registro de que
 * a migração aconteceu é ele próprio um fato. Reparo para frente é reexecutar
 * a aplicação, que é idempotente e completa o que faltou.
 */
export const executeRollbackLegacyInvestmentMigration = async (
  auth: WorkspaceAuthorizationContext,
  payload: RollbackLegacyInvestmentMigrationPayload,
): Promise<Record<string, unknown>> => {
  return investmentFirestore().runTransaction(async (transaction) => {
    await authorizeInvestmentTransaction(
      transaction,
      auth,
      investmentOperationRoles("rollbackLegacyInvestmentMigration"),
    );
    const snapshotRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.snapshots,
      payload.migrationId,
    );
    const snapshot = await transaction.get(snapshotRef);
    if (!snapshot.exists || snapshot.data()?.kind !== SNAPSHOT_KIND) {
      throw new CreditCardApplicationError(
        "not_found",
        "Migração não encontrada para este workspace.",
      );
    }
    const workspaceRef = investmentWorkspaceRef(auth.workspaceId);
    await transaction.get(workspaceRef);

    transaction.set(
      workspaceRef,
      {features: {investmentsV2: {enabled: false}}},
      {merge: true},
    );
    transaction.set(
      snapshotRef,
      {
        rolledBack: true,
        rolledBackBy: auth.uid,
        rolledBackAt: FieldValue.serverTimestamp(),
        rollbackReason: payload.reason,
        updatedAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
    recordInvestmentOperationMetric(transaction, {
      workspaceId: auth.workspaceId,
      operation: "rollbackLegacyInvestmentMigration",
      actorId: auth.uid,
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
    });
    return {
      success: true,
      migrationId: payload.migrationId,
      flagEnabled: false,
      movementsPreserved: true,
    };
  });
};

/**
 * Liga `features.investmentsV2.enabled` **apenas** se a reconciliação fechar.
 *
 * O M4 tornou `features` imutável pelo cliente, então esta é a única via. A
 * reconciliação roda antes e a flag só é gravada quando principal e ganho do
 * legado batem exatamente com os do domínio, em centavos.
 */
export const executeEnableInvestmentsV2Flag = async (
  auth: WorkspaceAuthorizationContext,
  payload: EnableInvestmentsV2FlagPayload,
): Promise<Record<string, unknown>> => {
  const reconciliation = await reconcileLegacyMigration(
    auth.workspaceId,
    payload.pageSize,
  );
  if (!reconciliation.reconciled) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "A reconciliação entre o legado e o domínio patrimonial não fechou. " +
        "A flag não pode ser habilitada enquanto os totais divergirem.",
      {
        legacyPrincipalCents: reconciliation.legacyPrincipalCents,
        domainPrincipalCents: reconciliation.domainPrincipalCents,
      },
    );
  }
  return investmentFirestore().runTransaction(async (transaction) => {
    await authorizeInvestmentTransaction(
      transaction,
      auth,
      investmentOperationRoles("enableInvestmentsV2Flag"),
    );
    const workspaceRef = investmentWorkspaceRef(auth.workspaceId);
    await transaction.get(workspaceRef);
    transaction.set(
      workspaceRef,
      {features: {investmentsV2: {enabled: true}}},
      {merge: true},
    );
    recordInvestmentOperationMetric(transaction, {
      workspaceId: auth.workspaceId,
      operation: "enableInvestmentsV2Flag",
      actorId: auth.uid,
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
    });
    return {success: true, flagEnabled: true, reconciliation};
  });
};
