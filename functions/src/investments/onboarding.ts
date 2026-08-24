import {FieldValue} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../creditCards/auth";
import type {OnboardInvestmentWorkspacePayload} from "./contracts";
import {assertInvestmentDocument} from "./documentContracts";
import {recordInvestmentOperationMetric} from "./observability";
import {investmentOperationRoles} from "./writeStrategy";
import {
  authorizeInvestmentTransaction,
  completeInvestmentIdempotency,
  deterministicDocumentId,
  recordInvestmentEvent,
  reserveInvestmentIdempotency,
  sha256,
} from "./infrastructure";
import {
  INVESTMENT_COLLECTIONS,
  investmentCollection,
  investmentDoc,
  investmentFirestore,
} from "./paths";

interface CatalogSeed {
  group: "investment_type" | "investment_class" | "investment_risk" |
    "investment_liquidity" | "investment_indexer" | "investment_strategy";
  name: string;
  scope: "PF" | "PJ" | "both";
}

const COMMON_SEEDS: CatalogSeed[] = [
  ...["Renda fixa", "Fundos", "Ações", "ETF", "Criptoativos", "Outros"]
    .map((name) => ({group: "investment_type" as const, name, scope: "both" as const})),
  ...["Baixo", "Moderado", "Alto"]
    .map((name) => ({group: "investment_risk" as const, name, scope: "both" as const})),
  ...["Diária", "No vencimento"]
    .map((name) => ({group: "investment_liquidity" as const, name, scope: "both" as const})),
  ...["CDI", "Selic", "IPCA", "Prefixado"]
    .map((name) => ({group: "investment_indexer" as const, name, scope: "both" as const})),
];

const PROFILE_SEEDS: Record<"PF" | "PJ", CatalogSeed[]> = {
  PF: [
    ...["Reserva de emergência", "Aposentadoria", "Objetivos"]
      .map((name) => ({group: "investment_class" as const, name, scope: "PF" as const})),
    ...["Conservadora", "Moderada", "Arrojada"]
      .map((name) => ({group: "investment_strategy" as const, name, scope: "PF" as const})),
  ],
  PJ: [
    ...["Caixa e liquidez", "Reserva operacional", "Expansão"]
      .map((name) => ({group: "investment_class" as const, name, scope: "PJ" as const})),
    ...["Preservação de caixa", "Liquidez operacional", "Crescimento"]
      .map((name) => ({group: "investment_strategy" as const, name, scope: "PJ" as const})),
  ],
};

const normalize = (value: string): string => value.normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();

export const executeOnboardInvestmentWorkspace = async (
  auth: WorkspaceAuthorizationContext,
  payload: OnboardInvestmentWorkspacePayload,
): Promise<Record<string, unknown>> => investmentFirestore().runTransaction(async (transaction) => {
  const operation = "onboardInvestmentWorkspace" as const;
  const authorization = await authorizeInvestmentTransaction(
    transaction,
    auth,
    investmentOperationRoles(operation),
  );
  const reservation = await reserveInvestmentIdempotency(
    transaction, auth, operation, payload.idempotencyKey, payload.correlationId, payload,
  );
  if (reservation.replay) return reservation.replay;

  const seeds = [...COMMON_SEEDS, ...PROFILE_SEEDS[authorization.profileType]];
  const prepared = seeds.map((seed) => {
    const normalizedName = normalize(seed.name);
    const dedupeKey = [seed.group, "all", seed.scope, normalizedName].join("::");
    return {
      seed,
      normalizedName,
      dedupeKey,
      uniqueRef: investmentFirestore().doc(
        `workspaces/${auth.workspaceId}/settings_catalog_uniques/${dedupeKey}`,
      ),
    };
  });
  const readResults = await Promise.all([
    transaction.get(investmentCollection(auth.workspaceId, INVESTMENT_COLLECTIONS.accounts)
      .where("status", "==", "active").limit(1)),
    transaction.get(investmentCollection(auth.workspaceId, INVESTMENT_COLLECTIONS.assets)
      .where("status", "==", "active").limit(1)),
    ...prepared.map((entry) => transaction.get(entry.uniqueRef)),
    ...prepared.map((entry) => transaction.get(
      investmentFirestore().collection(`workspaces/${auth.workspaceId}/settings_catalog`)
        .where("dedupeKey", "==", entry.dedupeKey).limit(1),
    )),
  ]);
  const accountPage = readResults[0] as FirebaseFirestore.QuerySnapshot;
  const assetPage = readResults[1] as FirebaseFirestore.QuerySnapshot;
  const uniqueSnapshots = readResults.slice(2, 2 + prepared.length) as FirebaseFirestore.DocumentSnapshot[];
  const catalogSnapshots = readResults.slice(2 + prepared.length) as FirebaseFirestore.QuerySnapshot[];

  let createdCatalogCount = 0;
  prepared.forEach((entry, index) => {
    if (uniqueSnapshots[index].exists) return;
    const existingItem = catalogSnapshots[index].docs[0];
    const itemId = existingItem?.id ?? `investment_default_${sha256(entry.dedupeKey).slice(0, 24)}`;
    const audit = {
      createdBy: auth.uid,
      updatedBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!existingItem) {
      transaction.create(
        investmentFirestore().doc(`workspaces/${auth.workspaceId}/settings_catalog/${itemId}`),
        {
        workspaceId: auth.workspaceId,
        group: entry.seed.group,
        name: entry.seed.name,
        normalizedName: entry.normalizedName,
        dedupeKey: entry.dedupeKey,
        workspaceScope: entry.seed.scope,
        sortOrder: (index + 1) * 10,
        status: "active",
        ...audit,
        },
      );
      createdCatalogCount += 1;
    }
    transaction.create(entry.uniqueRef, {
      dedupeKey: entry.dedupeKey,
      catalogItemId: itemId,
      workspaceId: auth.workspaceId,
      group: entry.seed.group,
      normalizedName: entry.normalizedName,
      ...audit,
    });
  });

  let accountId: string | null = accountPage.docs[0]?.id ?? null;
  let assetId: string | null = assetPage.docs[0]?.id ?? null;
  if (!accountId) {
    accountId = deterministicDocumentId("onboarding", auth.workspaceId, "account");
    transaction.create(investmentDoc(auth.workspaceId, INVESTMENT_COLLECTIONS.accounts, accountId), assertInvestmentDocument("account", {
      id: accountId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      name: authorization.profileType === "PJ" ? "Conta de investimentos da empresa" : "Conta de investimentos",
      institutionName: "Instituição a definir",
      currency: "BRL",
      status: "active",
      createdBy: auth.uid,
      updatedBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, auth.workspaceId));
  }
  if (!assetId) {
    assetId = deterministicDocumentId("onboarding", auth.workspaceId, "asset");
    transaction.create(investmentDoc(auth.workspaceId, INVESTMENT_COLLECTIONS.assets, assetId), assertInvestmentDocument("asset", {
      id: assetId,
      workspaceId: auth.workspaceId,
      profileType: authorization.profileType,
      name: authorization.profileType === "PJ" ? "Reserva financeira da empresa" : "Reserva de liquidez",
      symbol: authorization.profileType === "PJ" ? "RESERVA-PJ" : "RESERVA-PF",
      assetType: "fixed_income",
      // PF trata reserva de liquidez como objetivo não classificado; PJ a
      // classifica explicitamente como reserva. O campo é obrigatório no
      // documento e não pode depender do default do leitor.
      allocationPurpose:
        authorization.profileType === "PJ" ? "reserve" : "unassigned",
      currency: "BRL",
      status: "active",
      createdBy: auth.uid,
      updatedBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, auth.workspaceId));
  }

  const result = {
    success: true,
    workspaceId: auth.workspaceId,
    profileType: authorization.profileType,
    accountId,
    assetId,
    createdAccount: accountPage.empty,
    createdAsset: assetPage.empty,
    createdCatalogCount,
    existingCatalogCount: seeds.length - createdCatalogCount,
  };
  recordInvestmentOperationMetric(transaction, {
    workspaceId: auth.workspaceId,
    operation,
    actorId: auth.uid,
    correlationId: payload.correlationId,
    idempotencyKey: payload.idempotencyKey,
  });
  recordInvestmentEvent(
    transaction, auth, authorization.role, authorization.profileType,
    operation, reservation, payload.correlationId, "workspace", auth.workspaceId, result,
  );
  completeInvestmentIdempotency(
    transaction, auth, operation, payload.correlationId, reservation, result,
  );
  return result;
});
