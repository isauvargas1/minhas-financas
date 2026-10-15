import * as admin from "firebase-admin";

import {ApplicationError} from "../shared/errors";
import {
  readAuthoritativeCatalogItem,
  settingsCatalogRef,
  type AuthoritativeSettingsCatalogItem,
} from "../settingsCatalog/model";
import {RESERVED_CATEGORY_KEYS} from "./periods";

/**
 * Vínculo estável lançamento ↔ categoria do catálogo (P5-C1, D-37.8).
 *
 * O cliente informa só o `categoryId`. O backend lê o item na fase de
 * leitura da mesma transação que grava o lançamento e confere: mesmo
 * workspace (o caminho e o campo `workspaceId`), grupo `category`, subtipo
 * igual ao tipo do lançamento (receita/despesa) e item ativo. O nome gravado
 * no lançamento (`category`) é o retrato do catálogo naquele instante, nunca
 * o texto digitado; a agregação dos relatórios usa o ID, então renomear a
 * categoria não muda a identidade.
 *
 * Linha importada sem `categoryId` fica explicitamente "Sem categoria": o
 * backend não inventa ID a partir de texto.
 */

export const UNCATEGORIZED_LABEL = "Sem categoria";

export const CATEGORY_NOT_FOUND_MESSAGE =
  "Categoria não encontrada neste espaço de trabalho. Escolha outra " +
  "categoria.";

export const CATEGORY_SUBTYPE_MESSAGE =
  "A categoria escolhida não é do mesmo tipo do lançamento. Escolha uma " +
  "categoria de receita para receitas e de despesa para despesas.";

export const CATEGORY_INACTIVE_MESSAGE =
  "A categoria escolhida está inativa. Escolha uma categoria ativa ou " +
  "reative-a em Configurações.";

export interface ResolvedEntryCategory {
  /** `null` = "Sem categoria" (só na importação). */
  categoryId: string | null;
  /** Retrato do nome no catálogo (ou o rótulo de sem categoria). */
  name: string;
}

export const UNCATEGORIZED: ResolvedEntryCategory = Object.freeze({
  categoryId: null,
  name: UNCATEGORIZED_LABEL,
});

/**
 * Lê, numa só chamada da fase de leitura, os itens pedidos. Item ausente,
 * de outro workspace ou fora do formato autoritativo vale `null`.
 */
export const readEntryCategories = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  categoryIds: readonly string[],
): Promise<Map<string, AuthoritativeSettingsCatalogItem | null>> => {
  const unique = [...new Set(categoryIds)];
  const result = new Map<string, AuthoritativeSettingsCatalogItem | null>();
  if (unique.length === 0) return result;
  const snapshots = await transaction.getAll(
    ...unique.map((id) => settingsCatalogRef(workspaceId).doc(id)),
  );
  snapshots.forEach((snapshot, index) => {
    result.set(unique[index], snapshot.exists ?
      readAuthoritativeCatalogItem(snapshot.id, snapshot.data(), workspaceId) :
      null);
  });
  return result;
};

/**
 * Confere o item para um lançamento do tipo informado. `keepInactiveId` é a
 * categoria atual do lançamento na correção: manter a mesma categoria,
 * inativada depois, não bloqueia corrigir outros campos; escolher uma
 * categoria inativa nova é recusado.
 */
export const resolveEntryCategory = (
  categoryId: string,
  item: AuthoritativeSettingsCatalogItem | null | undefined,
  entryType: "receita" | "despesa",
  options: {keepInactiveId?: string | null} = {},
): ResolvedEntryCategory => {
  if (
    !item ||
    item.group !== "category" ||
    RESERVED_CATEGORY_KEYS.includes(categoryId)
  ) {
    throw new ApplicationError("invalid_payload", CATEGORY_NOT_FOUND_MESSAGE);
  }
  if (item.transactionSubtype !== entryType) {
    throw new ApplicationError("invalid_payload", CATEGORY_SUBTYPE_MESSAGE);
  }
  if (item.status !== "active" && options.keepInactiveId !== categoryId) {
    throw new ApplicationError(
      "domain_precondition_failed",
      CATEGORY_INACTIVE_MESSAGE,
    );
  }
  return {categoryId, name: item.name};
};
