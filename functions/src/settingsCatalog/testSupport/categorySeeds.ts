import {
  catalogItemDocument,
  catalogSeedDocumentId,
  settingsCatalogRef,
  type CategoryTransactionSubtype,
  type SettingsCatalogStatus,
} from "../model";
import {db} from "../../workspaces/testSupport/p1TestSupport";

/**
 * Sementes de categoria do catálogo para as suítes de integração (P5-C1,
 * D-37.8). Os lançamentos e contratos referenciam a categoria só por
 * `categoryId`; estas funções gravam, pelo Admin SDK, o item no formato
 * autoritativo que o backend lê na transação.
 *
 * O ID padrão é determinístico (`catalogSeedDocumentId`), o mesmo que o
 * provisionamento real usa; por isso os IDs de `DEFAULT_*_CATEGORY_ID`
 * valem em qualquer workspace depois de `seedDefaultCategories`.
 */
export const DEFAULT_INCOME_CATEGORY_NAME = "Salário";
export const DEFAULT_EXPENSE_CATEGORY_NAME = "Alimentação";

export const DEFAULT_INCOME_CATEGORY_ID = catalogSeedDocumentId(
  "category", "receita", "both", DEFAULT_INCOME_CATEGORY_NAME);
export const DEFAULT_EXPENSE_CATEGORY_ID = catalogSeedDocumentId(
  "category", "despesa", "both", DEFAULT_EXPENSE_CATEGORY_NAME);

/** ID da categoria padrão semeada para o tipo do lançamento. */
export const defaultCategoryIdFor = (type: "receita" | "despesa"): string =>
  type === "despesa" ?
    DEFAULT_EXPENSE_CATEGORY_ID : DEFAULT_INCOME_CATEGORY_ID;

export interface SeedCategoryInput {
  name: string;
  subtype: Extract<CategoryTransactionSubtype, "receita" | "despesa">;
  status?: SettingsCatalogStatus;
  /** Padrão: o ID determinístico da semente do catálogo. */
  id?: string;
  sortOrder?: number;
  actorUid?: string;
}

/** Grava (ou regrava) a categoria e devolve o ID do item. */
export const seedCategory = async (
  workspaceId: string,
  input: SeedCategoryInput,
): Promise<string> => {
  const id = input.id ?? catalogSeedDocumentId(
    "category", input.subtype, "both", input.name);
  await db().doc(`${settingsCatalogRef(workspaceId).path}/${id}`).set(
    catalogItemDocument({
      workspaceId,
      group: "category",
      name: input.name,
      workspaceScope: "both",
      transactionSubtype: input.subtype,
      sortOrder: input.sortOrder ?? 0,
      status: input.status ?? "active",
      actorUid: input.actorUid ?? "seed-test",
    }),
  );
  return id;
};

export interface DefaultCategoryIds {
  incomeCategoryId: string;
  expenseCategoryId: string;
}

/** Uma categoria de receita ("Salário") e uma de despesa ("Alimentação"). */
export const seedDefaultCategories = async (
  workspaceId: string,
): Promise<DefaultCategoryIds> => ({
  incomeCategoryId: await seedCategory(workspaceId, {
    name: DEFAULT_INCOME_CATEGORY_NAME, subtype: "receita",
  }),
  expenseCategoryId: await seedCategory(workspaceId, {
    name: DEFAULT_EXPENSE_CATEGORY_NAME, subtype: "despesa",
  }),
});
