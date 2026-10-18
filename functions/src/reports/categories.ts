import * as admin from "firebase-admin";
import {FieldPath} from "firebase-admin/firestore";

import {
  CASH_CATEGORY_FIELDS,
  CASH_CATEGORY_SCHEMA_VERSION,
  CASH_CATEGORY_YEARS_COLLECTION,
  isCatalogCategoryKey,
  normalizeCashCategoryDelta,
  readCashCategoryDays,
  RESERVED_CATEGORY_KEYS,
  type CashCategoryClassification,
  type CashCategoryDelta,
} from "../cash/periods";
import {
  readAuthoritativeCatalogItem,
  settingsCatalogRef,
} from "../settingsCatalog/model";
import {addExact, ratioBasisPoints} from "./formulas";
import type {
  CategoriesReport,
  CategoryItem,
  ReportSectionResult,
} from "./contract";
import type {WindowMonth} from "./window";

/**
 * Categorias da janela (P5-C1, D-37.8), lidas da geração vigente de
 * `cash_category_years`: um documento por (ano, categoria), somando só os
 * dias que caem na janela. A chave é o ID estável (catálogo) ou uma das
 * classificações explícitas; o nome vem do catálogo atual, então renomear a
 * categoria muda o rótulo e não a identidade.
 *
 * Conferências antes de entregar como exato (D-37.10):
 * - cada documento: Σ dias = totais do ano;
 * - a janela: Σ categorias de receita = recebimentos operacionais e Σ de
 *   despesa = pagamentos operacionais do bloco de caixa.
 * Falhou → "aguardando reconstrução". Teto de leitura atingido → "truncado".
 */

/** Teto de documentos categoria-ano lidos por relatório. */
export const MAX_CATEGORY_YEAR_DOCS = 2000;

const db = () => admin.firestore();

const CLASSIFICATIONS: readonly CashCategoryClassification[] = [
  "catalog", "uncategorized", "receivables", "split",
];

interface ParsedCategoryYear {
  categoryKey: string;
  categoryId: string | null;
  classification: CashCategoryClassification;
  year: string;
  totals: CashCategoryDelta;
  days: Record<string, Partial<CashCategoryDelta>>;
  consistent: boolean;
}

const parseCategoryYear = (
  id: string,
  data: admin.firestore.DocumentData,
  generation: string,
  year: string,
): ParsedCategoryYear | null => {
  const key = data.categoryKey;
  const classification = data.classification as CashCategoryClassification;
  if (
    // Versão anterior (contagem única por dia) exige reconstrução.
    data.schemaVersion !== CASH_CATEGORY_SCHEMA_VERSION ||
    typeof key !== "string" ||
    id !== `${generation}__${year}__${key}` ||
    !CLASSIFICATIONS.includes(classification) ||
    (classification === "catalog" ?
      !isCatalogCategoryKey(key) || data.categoryId !== key :
      !RESERVED_CATEGORY_KEYS.includes(key))
  ) {
    return null;
  }
  const totals = normalizeCashCategoryDelta(data);
  const days = readCashCategoryDays(data.days);
  const sum = {
    incomeCents: 0, expenseCents: 0, incomeCount: 0, expenseCount: 0,
  };
  for (const delta of Object.values(days)) {
    for (const field of CASH_CATEGORY_FIELDS) sum[field] += delta[field] ?? 0;
  }
  return {
    categoryKey: key,
    categoryId: classification === "catalog" ? key : null,
    classification,
    year,
    totals,
    days,
    consistent: CASH_CATEGORY_FIELDS.every((field) =>
      sum[field] === totals[field]),
  };
};

const yearPrefixQuery = (
  workspaceId: string,
  generation: string,
  year: string,
  limit: number,
): admin.firestore.Query => {
  const prefix = `${generation}__${year}__`;
  return db()
    .collection(`workspaces/${workspaceId}/${CASH_CATEGORY_YEARS_COLLECTION}`)
    .orderBy(FieldPath.documentId())
    .startAt(prefix)
    .endAt(`${prefix}`)
    .limit(limit);
};

/** Dia `MMDD` do ano está na janela? */
const inWindow = (
  year: string,
  mmdd: string,
  startDate: string,
  endDate: string,
): boolean => {
  const day = `${year}-${mmdd.slice(0, 2)}-${mmdd.slice(2, 4)}`;
  return day >= startDate && day <= endDate;
};

interface Accumulated {
  categoryKey: string;
  categoryId: string | null;
  classification: CashCategoryClassification;
  incomeCents: number;
  expenseCents: number;
  incomeCount: number;
  expenseCount: number;
}

const itemsOf = (
  entries: Accumulated[],
  side: "income" | "expense",
  names: ReadonlyMap<string, string>,
): CategoryItem[] => {
  const amountOf = (entry: Accumulated) =>
    side === "income" ? entry.incomeCents : entry.expenseCents;
  const countOf = (entry: Accumulated) =>
    side === "income" ? entry.incomeCount : entry.expenseCount;
  const relevant = entries.filter((entry) =>
    amountOf(entry) !== 0 || countOf(entry) !== 0);
  const total = relevant.reduce((sum, entry) =>
    addExact(sum, amountOf(entry)), 0);
  return relevant
    .map((entry) => ({
      categoryKey: entry.categoryKey,
      categoryId: entry.categoryId,
      classification: entry.classification,
      name: entry.categoryId ? names.get(entry.categoryId) ?? null : null,
      amountCents: amountOf(entry),
      shareBasisPoints: ratioBasisPoints(amountOf(entry), total),
      transactionCount: countOf(entry),
    }))
    .sort((left, right) => right.amountCents - left.amountCents ||
      left.categoryKey.localeCompare(right.categoryKey));
};

export const readCategoriesSection = async (input: {
  workspaceId: string;
  generation: string;
  months: readonly WindowMonth[];
  /** Recebimentos e pagamentos operacionais da mesma janela (caixa). */
  receiptsCents: number;
  paymentsCents: number;
}): Promise<ReportSectionResult<CategoriesReport>> => {
  const {workspaceId, generation, months} = input;
  if (months.length === 0) {
    return {status: "zero", data: {expense: [], income: []}};
  }
  const startDate = months[0].startDate;
  const endDate = months[months.length - 1].endDate;
  const years = [...new Set(months.map((slice) => slice.month.slice(0, 4)))];

  const parsed: ParsedCategoryYear[] = [];
  let truncated = false;
  for (const year of years) {
    const remaining = MAX_CATEGORY_YEAR_DOCS - parsed.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const snapshot = await yearPrefixQuery(
      workspaceId, generation, year, remaining + 1).get();
    if (snapshot.size > remaining) truncated = true;
    for (const doc of snapshot.docs.slice(0, remaining)) {
      const entry = parseCategoryYear(doc.id, doc.data(), generation, year);
      if (!entry || !entry.consistent) {
        return {
          status: "rebuild_needed", reason: "category_parity", data: null,
        };
      }
      parsed.push(entry);
    }
  }

  const byKey = new Map<string, Accumulated>();
  for (const entry of parsed) {
    const accumulated = byKey.get(entry.categoryKey) ?? {
      categoryKey: entry.categoryKey,
      categoryId: entry.categoryId,
      classification: entry.classification,
      incomeCents: 0,
      expenseCents: 0,
      incomeCount: 0,
      expenseCount: 0,
    };
    for (const [mmdd, delta] of Object.entries(entry.days)) {
      if (!inWindow(entry.year, mmdd, startDate, endDate)) continue;
      const income = delta.incomeCents ?? 0;
      const expense = delta.expenseCents ?? 0;
      accumulated.incomeCents = addExact(accumulated.incomeCents, income);
      accumulated.expenseCents = addExact(accumulated.expenseCents, expense);
      // A projeção já separa a contagem por lado (receita × despesa).
      accumulated.incomeCount += delta.incomeCount ?? 0;
      accumulated.expenseCount += delta.expenseCount ?? 0;
    }
    byKey.set(entry.categoryKey, accumulated);
  }
  const entries = [...byKey.values()];

  if (!truncated) {
    const income = entries.reduce((sum, entry) =>
      addExact(sum, entry.incomeCents), 0);
    const expense = entries.reduce((sum, entry) =>
      addExact(sum, entry.expenseCents), 0);
    if (income !== input.receiptsCents || expense !== input.paymentsCents) {
      return {status: "rebuild_needed", reason: "category_cash_parity",
        data: null};
    }
  }

  const catalogIds = entries.flatMap((entry) =>
    entry.categoryId ? [entry.categoryId] : []);
  const names = new Map<string, string>();
  if (catalogIds.length > 0) {
    const snapshots = await db().getAll(...catalogIds.map((id) =>
      settingsCatalogRef(workspaceId).doc(id)));
    for (const snapshot of snapshots) {
      const item = snapshot.exists ?
        readAuthoritativeCatalogItem(snapshot.id, snapshot.data(),
          workspaceId) :
        null;
      if (item?.group === "category") names.set(snapshot.id, item.name);
    }
  }

  const data: CategoriesReport = {
    expense: itemsOf(entries, "expense", names),
    income: itemsOf(entries, "income", names),
  };
  if (truncated) {
    return {status: "truncated", reason: "category_read_limit", data};
  }
  const empty = data.expense.length === 0 && data.income.length === 0;
  return {status: empty ? "zero" : "exact", data};
};
