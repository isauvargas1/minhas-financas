import {FieldValue} from "firebase-admin/firestore";

import {
  reassertWorkspaceActor,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import type {OnboardInvestmentWorkspacePayload} from "./contracts";
import {assertInvestmentDocument} from "./documentContracts";
import {recordInvestmentOperationMetric} from "./observability";
import {investmentOperationRoles} from "./writeStrategy";
import {
  completeInvestmentIdempotency,
  deterministicDocumentId,
  profileTypeFromWorkspace,
  recordInvestmentEvent,
  reserveInvestmentIdempotency,
} from "./infrastructure";
import {
  INVESTMENT_COLLECTIONS,
  investmentCollection,
  investmentDoc,
  investmentFirestore,
} from "./paths";
import {
  INVESTMENT_TYPE_SEEDS,
  investmentCatalogSeedDocumentId,
  normalizeCatalogName,
} from "./simpleMode";

interface CatalogSeed {
  group: "investment_type" | "investment_class" | "investment_risk" |
    "investment_liquidity" | "investment_indexer" | "investment_strategy";
  name: string;
  scope: "PF" | "PJ" | "both";
}

const COMMON_SEEDS: CatalogSeed[] = [
  // A lista de categorias vive em `simpleMode`, junto da classificação
  // técnica que cada uma implica: duas listas divergiriam no primeiro item
  // acrescentado, e o `assetType` passaria a depender de qual delas foi
  // atualizada.
  ...INVESTMENT_TYPE_SEEDS
    .map(({name}) => ({group: "investment_type" as const, name, scope: "both" as const})),
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

const normalize = normalizeCatalogName;

type InvestmentProfileType = "PF" | "PJ";

/** Item padrão do catálogo de investimentos, já com chave e ID estáveis. */
interface PreparedCatalogSeed {
  seed: CatalogSeed;
  sortOrder: number;
  normalizedName: string;
  dedupeKey: string;
  defaultItemId: string;
}

/**
 * Padrões de investimento de um perfil, na ordem em que são semeados.
 *
 * Fonte única para as duas escritas: o preparo convergente
 * (`executeOnboardInvestmentWorkspace`) e o provisionamento de workspace novo
 * (`writeNewWorkspaceInvestmentDefaults`).
 */
const investmentCatalogSeedsFor = (
  profileType: InvestmentProfileType,
): PreparedCatalogSeed[] =>
  [...COMMON_SEEDS, ...PROFILE_SEEDS[profileType]].map((seed, index) => {
    const normalizedName = normalize(seed.name);
    return {
      seed,
      sortOrder: (index + 1) * 10,
      normalizedName,
      dedupeKey: [seed.group, "all", seed.scope, normalizedName].join("::"),
      defaultItemId: investmentCatalogSeedDocumentId(
        seed.group, seed.scope, seed.name,
      ),
    };
  });

const catalogItemRef = (workspaceId: string, itemId: string) =>
  investmentFirestore().doc(`workspaces/${workspaceId}/settings_catalog/${itemId}`);

const catalogUniqueRef = (workspaceId: string, dedupeKey: string) =>
  investmentFirestore().doc(
    `workspaces/${workspaceId}/settings_catalog_uniques/${dedupeKey}`,
  );

const auditStamp = (uid: string) => ({
  createdBy: uid,
  updatedBy: uid,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

const catalogItemDocument = (
  workspaceId: string,
  entry: PreparedCatalogSeed,
  uid: string,
) => ({
  workspaceId,
  group: entry.seed.group,
  name: entry.seed.name,
  normalizedName: entry.normalizedName,
  dedupeKey: entry.dedupeKey,
  workspaceScope: entry.seed.scope,
  sortOrder: entry.sortOrder,
  status: "active",
  ...auditStamp(uid),
});

const catalogUniqueDocument = (
  workspaceId: string,
  entry: PreparedCatalogSeed,
  itemId: string,
  uid: string,
) => ({
  dedupeKey: entry.dedupeKey,
  catalogItemId: itemId,
  workspaceId,
  group: entry.seed.group,
  normalizedName: entry.normalizedName,
  ...auditStamp(uid),
});

const defaultAccountId = (workspaceId: string) =>
  deterministicDocumentId("onboarding", workspaceId, "account");

const defaultAssetId = (workspaceId: string) =>
  deterministicDocumentId("onboarding", workspaceId, "asset");

const defaultAccountDocument = (
  workspaceId: string,
  profileType: InvestmentProfileType,
  uid: string,
) => assertInvestmentDocument("account", {
  id: defaultAccountId(workspaceId),
  workspaceId,
  profileType,
  name: profileType === "PJ" ? "Conta de investimentos da empresa" : "Conta de investimentos",
  institutionName: "Instituição a definir",
  currency: "BRL",
  status: "active",
  ...auditStamp(uid),
}, workspaceId);

const defaultAssetDocument = (
  workspaceId: string,
  profileType: InvestmentProfileType,
  uid: string,
) => assertInvestmentDocument("asset", {
  id: defaultAssetId(workspaceId),
  workspaceId,
  profileType,
  name: profileType === "PJ" ? "Reserva financeira da empresa" : "Reserva de liquidez",
  symbol: profileType === "PJ" ? "RESERVA-PJ" : "RESERVA-PF",
  assetType: "fixed_income",
  // PF trata reserva de liquidez como objetivo não classificado; PJ a
  // classifica explicitamente como reserva. O campo é obrigatório no
  // documento e não pode depender do default do leitor.
  allocationPurpose: profileType === "PJ" ? "reserve" : "unassigned",
  currency: "BRL",
  status: "active",
  ...auditStamp(uid),
}, workspaceId);

export interface NewWorkspaceInvestmentDefaults {
  accountId: string;
  assetId: string;
  catalogItemCount: number;
}

/**
 * Padrões de investimento de um workspace **recém-criado** (P1).
 *
 * Chamado pelo provisionamento de `bootstrapAccount`/`createWorkspace`, na
 * mesma transação que cria o workspace. O ID do workspace acabou de ser
 * gerado, então não há o que ler: tudo é `transaction.create`, e qualquer
 * colisão aborta a transação inteira em vez de sobrescrever.
 */
export const writeNewWorkspaceInvestmentDefaults = (
  transaction: FirebaseFirestore.Transaction,
  input: {workspaceId: string; profileType: InvestmentProfileType; uid: string},
): NewWorkspaceInvestmentDefaults => {
  const entries = investmentCatalogSeedsFor(input.profileType);
  for (const entry of entries) {
    transaction.create(
      catalogItemRef(input.workspaceId, entry.defaultItemId),
      catalogItemDocument(input.workspaceId, entry, input.uid),
    );
    transaction.create(
      catalogUniqueRef(input.workspaceId, entry.dedupeKey),
      catalogUniqueDocument(
        input.workspaceId, entry, entry.defaultItemId, input.uid,
      ),
    );
  }
  const accountId = defaultAccountId(input.workspaceId);
  const assetId = defaultAssetId(input.workspaceId);
  transaction.create(
    investmentDoc(input.workspaceId, INVESTMENT_COLLECTIONS.accounts, accountId),
    defaultAccountDocument(input.workspaceId, input.profileType, input.uid),
  );
  transaction.create(
    investmentDoc(input.workspaceId, INVESTMENT_COLLECTIONS.assets, assetId),
    defaultAssetDocument(input.workspaceId, input.profileType, input.uid),
  );
  return {accountId, assetId, catalogItemCount: entries.length};
};

/**
 * Preparo convergente dos padrões de investimento de um workspace existente.
 *
 * Não faz parte do ciclo de vida do workspace — o provisionamento já grava
 * os padrões na criação. Continua como operação do domínio: completa o que
 * faltar sem duplicar o que já existe.
 */
export const executeOnboardInvestmentWorkspace = async (
  auth: WorkspaceActor,
  payload: OnboardInvestmentWorkspacePayload,
): Promise<Record<string, unknown>> => investmentFirestore().runTransaction(async (transaction) => {
  const operation = "onboardInvestmentWorkspace" as const;
  const access = await reassertWorkspaceActor(
    transaction,
    auth,
    investmentOperationRoles(operation),
  );
  const authorization = {
    role: access.role,
    profileType: profileTypeFromWorkspace(access.workspace),
  };
  const reservation = await reserveInvestmentIdempotency(
    transaction, auth, operation, payload.idempotencyKey, payload.correlationId, payload,
  );
  if (reservation.replay) return reservation.replay;

  const prepared = investmentCatalogSeedsFor(authorization.profileType);
  const readResults = await Promise.all([
    transaction.get(investmentCollection(auth.workspaceId, INVESTMENT_COLLECTIONS.accounts)
      .where("status", "==", "active").limit(1)),
    transaction.get(investmentCollection(auth.workspaceId, INVESTMENT_COLLECTIONS.assets)
      .where("status", "==", "active").limit(1)),
    ...prepared.map((entry) => transaction.get(catalogUniqueRef(auth.workspaceId, entry.dedupeKey))),
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
    const itemId = existingItem?.id ?? entry.defaultItemId;
    if (!existingItem) {
      transaction.create(
        catalogItemRef(auth.workspaceId, itemId),
        catalogItemDocument(auth.workspaceId, entry, auth.uid),
      );
      createdCatalogCount += 1;
    }
    transaction.create(
      catalogUniqueRef(auth.workspaceId, entry.dedupeKey),
      catalogUniqueDocument(auth.workspaceId, entry, itemId, auth.uid),
    );
  });

  let accountId: string | null = accountPage.docs[0]?.id ?? null;
  let assetId: string | null = assetPage.docs[0]?.id ?? null;
  if (!accountId) {
    accountId = defaultAccountId(auth.workspaceId);
    transaction.create(
      investmentDoc(auth.workspaceId, INVESTMENT_COLLECTIONS.accounts, accountId),
      defaultAccountDocument(auth.workspaceId, authorization.profileType, auth.uid),
    );
  }
  if (!assetId) {
    assetId = defaultAssetId(auth.workspaceId);
    transaction.create(
      investmentDoc(auth.workspaceId, INVESTMENT_COLLECTIONS.assets, assetId),
      defaultAssetDocument(auth.workspaceId, authorization.profileType, auth.uid),
    );
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
    existingCatalogCount: prepared.length - createdCatalogCount,
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
