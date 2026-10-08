import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {CASH_ENTRY_MAX_CENTS} from "../cash/contracts";
import {sha256} from "../shared/hashing";
import {isMoneyCents} from "../shared/money";
import {workspaceRef, type WorkspaceRole} from "../shared/workspaceAuth";

/**
 * Modelo autoritativo de cartões de crédito (P4-A, D-36).
 *
 * Coleções sob `workspaces/{wid}`, com `schemaVersion: 1`, gravadas só pelo
 * backend (as Rules negam ao cliente toda escrita, inclusive em
 * `credit_cards`). O modelo substituiu o domínio anterior em ponto flutuante
 * sem migração: não há dados reais. Documento fora do schema é recusado
 * (falha fechada), nunca "consertado" por leitura.
 *
 * - `credit_cards/{cardId}`: cadastro, estado (`active`|`archived`), limite em
 *   centavos (`limitTotalCents`, `limitUsedCents`, `limitAvailableCents` =
 *   total − usado) e dias de fechamento/vencimento (1–31; mês sem o dia usa o
 *   último dia). `updatedAt` muda só com o cadastro (é a versão que o cliente
 *   informa para editar); o limite registra `limitUpdatedAt`.
 * - `credit_card_purchases/{purchaseId}`: compra (à vista ou parcelada), valor
 *   total em centavos, parcelas e estado (`active`|`cancelled`|`refunded`).
 * - `credit_card_invoices/{cardId}_{AAAA-MM}`: fatura da competência, com o
 *   ciclo (`cycleStatus` `open`|`closed`) separado do pagamento
 *   (`paymentStatus` `unpaid`|`partial`|`paid`). Atraso nunca é gravado: é
 *   `closed` + saldo > 0 + vencimento antes de hoje (São Paulo).
 * - `credit_card_invoice_entries`: lançamentos da fatura com sinal — parcela,
 *   ajuste, crédito de estorno e transporte de crédito entre faturas. O total
 *   da fatura é a soma dos lançamentos ativos dela.
 * - `credit_card_invoice_payments`: pagamentos e seus estornos (fatos
 *   imutáveis; o original recebe só o vínculo `reversedBy`).
 * - `credit_card_limit_ledger`: livro do limite em centavos com sinal
 *   (positivo consome). `limitUsedCents` é sempre a soma do livro e também
 *   lançamentos ativos − pagamentos líquidos: duas reconstruções
 *   independentes.
 * - `credit_card_events`: auditoria append-only, sem PII nem texto livre.
 */
export const CARD_SCHEMA_VERSION = 1;

export const CREDIT_CARDS_COLLECTION = "credit_cards";
export const CARD_PURCHASES_COLLECTION = "credit_card_purchases";
export const CARD_INVOICES_COLLECTION = "credit_card_invoices";
export const CARD_ENTRIES_COLLECTION = "credit_card_invoice_entries";
export const CARD_PAYMENTS_COLLECTION = "credit_card_invoice_payments";
export const CARD_LIMIT_LEDGER_COLLECTION = "credit_card_limit_ledger";
export const CARD_EVENTS_COLLECTION = "credit_card_events";

export const CARD_BRANDS = ["Visa", "Mastercard", "Elo", "Amex"] as const;
export type CardBrand = typeof CARD_BRANDS[number];
export type CardStatus = "active" | "archived";

/**
 * Teto operacional de cartões por workspace, ativos e arquivados (não é
 * quota comercial). A tela lista no máximo 50 cartões — o teto de listagem
 * das Rules —, então o backend não deixa o workspace passar disso.
 */
export const CARD_LIMIT_PER_WORKSPACE = 50;

/**
 * Teto de parcelas: o mais restritivo entre o produto (o formulário sempre
 * limitou a 60) e o backend (que não tinha teto). Uma compra lê e escreve no
 * máximo 60 faturas na mesma transação.
 */
export const CARD_MAX_INSTALLMENTS = 60;

/** Teto do limite total do cartão e de um valor isolado. */
export const CARD_MAX_CENTS = CASH_ENTRY_MAX_CENTS;

/** Autor das escritas do fechamento automático. */
export const CARD_SYSTEM_ACTOR = "system:credit-card-closing";

export const cardsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CREDIT_CARDS_COLLECTION);
export const purchasesRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CARD_PURCHASES_COLLECTION);
export const invoicesRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CARD_INVOICES_COLLECTION);
export const entriesRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CARD_ENTRIES_COLLECTION);
export const paymentsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CARD_PAYMENTS_COLLECTION);
export const limitLedgerRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CARD_LIMIT_LEDGER_COLLECTION);
export const cardEventsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(CARD_EVENTS_COLLECTION);

// ---------------------------------------------------------------------- IDs

const hash40 = (value: string): string => sha256(value).slice(0, 40);

/** Intenção do ator, procurada nos eventos de qualquer workspace. */
export const cardIntentIdFor = (uid: string, idempotencyKey: string) =>
  sha256(`${uid}:${idempotencyKey}`).slice(0, 32);

/** ID de cada criação: hash de `(workspace, ator, chave)`, a própria âncora. */
const creationIdFor = (
  prefix: string,
  workspaceId: string,
  uid: string,
  idempotencyKey: string,
): string => `${prefix}_${hash40(`${workspaceId}:${uid}:${idempotencyKey}`)}`;

export const cardIdFor = (workspaceId: string, uid: string, key: string) =>
  creationIdFor("card", workspaceId, uid, key);
export const purchaseIdFor = (workspaceId: string, uid: string, key: string) =>
  creationIdFor("ccp", workspaceId, uid, key);
export const paymentIdFor = (workspaceId: string, uid: string, key: string) =>
  creationIdFor("ccpay", workspaceId, uid, key);
export const adjustmentEntryIdFor = (
  workspaceId: string,
  uid: string,
  key: string,
) => creationIdFor("cce", workspaceId, uid, `adjustment:${key}`);

/** Uma fatura por cartão e competência: o ID é legível e determinístico. */
export const invoiceIdFor = (cardId: string, competenceMonth: string) =>
  `${cardId}_${competenceMonth}`;

/**
 * Parcela `n` (1-based) da revisão financeira `revision` da compra. A edição
 * financeira substitui as parcelas por outras com IDs novos; as antigas ficam
 * canceladas (histórico).
 */
export const installmentEntryIdFor = (
  purchaseId: string,
  revision: number,
  installmentNumber: number,
) => `cce_${hash40(`${purchaseId}:r${revision}:${installmentNumber}`)}`;
/** Um crédito de estorno por compra. */
export const refundEntryIdFor = (purchaseId: string) =>
  `cce_${hash40(`${purchaseId}:refund`)}`;
/** Transporte do crédito de uma fatura fechada: um par por fatura. */
export const carryoverEntryIdFor = (
  invoiceId: string,
  side: "out" | "in",
) => `cce_${hash40(`${invoiceId}:carryover:${side}`)}`;
/** Um pagamento tem no máximo um estorno: o ID deriva do original. */
export const paymentReversalIdFor = (paymentId: string) =>
  `ccpay_${hash40(`${paymentId}:reversal`)}`;
/** Espelho de caixa do pagamento/estorno: um por fato de pagamento. */
export const paymentCashTransactionIdFor = (paymentId: string) =>
  `cccash_${paymentId.replace(/^ccpay_/, "")}`;
/** Lançamento do livro do limite: determinístico pelo fato de origem. */
export const limitLedgerIdFor = (sourceKey: string) =>
  `ccl_${hash40(sourceKey)}`;

// ---------------------------------------------------------- calendário (D-36)

const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;
const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (value: number): string => String(value).padStart(2, "0");

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Dias do mês civil (mês 1–12), sem fuso: aritmética de calendário. */
export const daysInMonth = (year: number, month: number): number => {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30,
    31, 30, 31];
  return days[month - 1];
};

export const isMonthKey = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const match = MONTH_KEY_PATTERN.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
};

const parseMonthKey = (monthKey: string): {year: number; month: number} => {
  const match = MONTH_KEY_PATTERN.exec(monthKey);
  if (!match) throw new Error(`competência inválida: ${monthKey}`);
  return {year: Number(match[1]), month: Number(match[2])};
};

export const addMonthsToMonthKey = (monthKey: string, months: number) => {
  const {year, month} = parseMonthKey(monthKey);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`;
};

/** Meses de `from` até `to` (negativo se `to` vem antes). */
export const monthsBetween = (from: string, to: string): number => {
  const a = parseMonthKey(from);
  const b = parseMonthKey(to);
  return (b.year - a.year) * 12 + (b.month - a.month);
};

export const monthOfDayKey = (dayKey: string): string => {
  if (!DAY_KEY_PATTERN.test(dayKey)) {
    throw new Error(`data inválida: ${dayKey}`);
  }
  return dayKey.slice(0, 7);
};

/** Dia `day` do mês; mês sem esse dia usa o último dia (determinístico). */
export const clampedDayKey = (monthKey: string, day: number): string => {
  const {year, month} = parseMonthKey(monthKey);
  return `${monthKey}-${pad2(Math.min(day, daysInMonth(year, month)))}`;
};

/** Data de fechamento da fatura da competência. */
export const closingDateOf = (monthKey: string, closingDay: number) =>
  clampedDayKey(monthKey, closingDay);

/**
 * Vencimento: o primeiro dia `dueDay` (ajustado ao mês) estritamente depois
 * do fechamento — no mesmo mês quando cabe, senão no seguinte.
 */
export const dueDateOf = (
  monthKey: string,
  closingDay: number,
  dueDay: number,
): string => {
  const closing = closingDateOf(monthKey, closingDay);
  const sameMonth = clampedDayKey(monthKey, dueDay);
  return sameMonth > closing ?
    sameMonth :
    clampedDayKey(addMonthsToMonthKey(monthKey, 1), dueDay);
};

/**
 * Competência natural de uma data: a fatura cujo fechamento ainda não chegou
 * nessa data. Compra no próprio dia do fechamento vai para a fatura seguinte
 * (a fatura fecha no início do dia de fechamento).
 */
export const naturalCompetenceOf = (dayKey: string, closingDay: number) => {
  const month = monthOfDayKey(dayKey);
  return dayKey < closingDateOf(month, closingDay) ?
    month :
    addMonthsToMonthKey(month, 1);
};

/**
 * Primeira competência ainda aberta hoje: a natural de hoje. Todo lançamento
 * novo cai nela ou depois — nunca numa fatura fechada (D-36).
 */
export const firstOpenCompetence = (today: string, closingDay: number) =>
  naturalCompetenceOf(today, closingDay);

export interface InstallmentPlacement {
  installmentNumber: number;
  amountCents: number;
  /** Competência natural pela data da compra. */
  naturalCompetence: string;
  /** Onde a parcela é publicada: a natural ou, fechada, a primeira aberta. */
  competenceMonth: string;
}

/**
 * Publicação das parcelas (D-36, compra retroativa): cada parcela vai para a
 * sua competência natural; se essa competência já fechou, vai para a primeira
 * ainda aberta. A data da compra nunca muda e nenhuma fatura fechada recebe
 * lançamento.
 */
export const placeInstallments = (input: {
  purchaseDate: string;
  amountsCents: readonly number[];
  closingDay: number;
  today: string;
}): InstallmentPlacement[] => {
  const first = naturalCompetenceOf(input.purchaseDate, input.closingDay);
  const open = firstOpenCompetence(input.today, input.closingDay);
  return input.amountsCents.map((amountCents, index) => {
    const natural = addMonthsToMonthKey(first, index);
    return {
      installmentNumber: index + 1,
      amountCents,
      naturalCompetence: natural,
      competenceMonth: natural < open ? open : natural,
    };
  });
};

// ------------------------------------------------------------- estado

export type InvoiceCycleStatus = "open" | "closed";
export type InvoicePaymentStatus = "unpaid" | "partial" | "paid";

/** Pagamento derivado: sem saldo, pago; com algum pagamento, parcial. */
export const derivePaymentStatus = (
  totalCents: number,
  paidCents: number,
): InvoicePaymentStatus => {
  if (totalCents - paidCents <= 0) return "paid";
  return paidCents > 0 ? "partial" : "unpaid";
};

/**
 * Ciclo efetivamente fechado: já fechado ou com a data de fechamento
 * alcançada (o fechamento automático pode não ter rodado ainda). As
 * operações tratam os dois casos como fechado.
 */
export const isCycleEffectivelyClosed = (
  invoice: {cycleStatus: InvoiceCycleStatus; closingDate: string},
  today: string,
): boolean => invoice.cycleStatus === "closed" || today >= invoice.closingDate;

/** Atraso derivado (nunca persistido). */
export const isInvoiceOverdue = (
  invoice: {
    cycleStatus: InvoiceCycleStatus;
    remainingCents: number;
    dueDate: string;
  },
  today: string,
): boolean => invoice.cycleStatus === "closed" &&
  invoice.remainingCents > 0 && invoice.dueDate < today;

// ------------------------------------------------------------- validação

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isNullableText = (value: unknown): value is string | null =>
  value === null || isText(value);

const isDayKeyText = (value: unknown): value is string =>
  typeof value === "string" && DAY_KEY_PATTERN.test(value);

const isDayOfMonth = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1 &&
  (value as number) <= 31;

const isPositiveInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;

const isNonNegativeInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isTimestamp = (value: unknown): value is Timestamp =>
  value instanceof Timestamp;

// -------------------------------------------------------------------- cartão

export const CARD_VISUAL_BG_TYPES = ["color", "gradient", "image"] as const;
export const CARD_VISUAL_TEXT_COLORS = ["white", "black"] as const;

export interface CardVisual {
  bgType: typeof CARD_VISUAL_BG_TYPES[number];
  bgColor: string;
  bgGradientColor: string | null;
  bgImage: string | null;
  textColor: typeof CARD_VISUAL_TEXT_COLORS[number];
  showName: boolean;
  showBrand: boolean;
  showLogo: boolean;
}

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
/**
 * Imagem de fundo: só `https://`, sem aspas, parênteses, espaços nem barras
 * invertidas — o valor vai para `url(...)` no estilo do cartão.
 */
export const CARD_IMAGE_URL_PATTERN = /^https:\/\/[^\s"'()\\<>]{1,490}$/;

const readCardVisual = (value: unknown): CardVisual | null => {
  if (typeof value !== "object" || value === null) return null;
  const visual = value as Record<string, unknown>;
  if (
    !(CARD_VISUAL_BG_TYPES as readonly unknown[]).includes(visual.bgType) ||
    typeof visual.bgColor !== "string" ||
    !HEX_COLOR_PATTERN.test(visual.bgColor) ||
    !(visual.bgGradientColor === null ||
      (typeof visual.bgGradientColor === "string" &&
        HEX_COLOR_PATTERN.test(visual.bgGradientColor))) ||
    !(visual.bgImage === null ||
      (typeof visual.bgImage === "string" &&
        CARD_IMAGE_URL_PATTERN.test(visual.bgImage))) ||
    !(CARD_VISUAL_TEXT_COLORS as readonly unknown[])
      .includes(visual.textColor) ||
    typeof visual.showName !== "boolean" ||
    typeof visual.showBrand !== "boolean" ||
    typeof visual.showLogo !== "boolean"
  ) {
    return null;
  }
  return visual as unknown as CardVisual;
};

/** Dados descritivos editáveis do cadastro. */
export interface CardProfile {
  name: string;
  brand: CardBrand;
  closingDay: number;
  dueDay: number;
  bestDay: number | null;
  observations: string | null;
  responsiblePerson: string | null;
  recommendedUse: string | null;
  defaultCostCenter: string | null;
  visual: CardVisual;
}

export interface AuthoritativeCard extends CardProfile {
  id: string;
  workspaceId: string;
  status: CardStatus;
  limitTotalCents: number;
  limitUsedCents: number;
  limitAvailableCents: number;
  createdBy: string;
  revision: number;
  updatedAt: Timestamp;
}

/** Limite usado aceito: pode ser negativo (crédito a favor) até o teto. */
export const isCardLimitUsed = (value: unknown): value is number =>
  isMoneyCents(value) && Math.abs(value) <= 2 * CARD_MAX_CENTS;

export const readAuthoritativeCard = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeCard | null => {
  if (!data || data.schemaVersion !== CARD_SCHEMA_VERSION) return null;
  const visual = readCardVisual(data.visual);
  if (
    data.workspaceId !== workspaceId ||
    !isText(data.name) ||
    !(CARD_BRANDS as readonly unknown[]).includes(data.brand) ||
    (data.status !== "active" && data.status !== "archived") ||
    !isPositiveInt(data.limitTotalCents) ||
    data.limitTotalCents > CARD_MAX_CENTS ||
    !isCardLimitUsed(data.limitUsedCents) ||
    data.limitAvailableCents !== data.limitTotalCents - data.limitUsedCents ||
    !isDayOfMonth(data.closingDay) ||
    !isDayOfMonth(data.dueDay) ||
    !(data.bestDay === null || isDayOfMonth(data.bestDay)) ||
    !isNullableText(data.observations) ||
    !isNullableText(data.responsiblePerson) ||
    !isNullableText(data.recommendedUse) ||
    !isNullableText(data.defaultCostCenter) ||
    !visual ||
    !isText(data.createdBy) ||
    !isPositiveInt(data.revision) ||
    !isTimestamp(data.updatedAt)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    name: data.name,
    brand: data.brand,
    status: data.status,
    limitTotalCents: data.limitTotalCents,
    limitUsedCents: data.limitUsedCents,
    limitAvailableCents: data.limitAvailableCents,
    closingDay: data.closingDay,
    dueDay: data.dueDay,
    bestDay: data.bestDay,
    observations: data.observations,
    responsiblePerson: data.responsiblePerson,
    recommendedUse: data.recommendedUse,
    defaultCostCenter: data.defaultCostCenter,
    visual,
    createdBy: data.createdBy,
    revision: data.revision,
    updatedAt: data.updatedAt,
  };
};

export const cardDocument = (input: {
  id: string;
  workspaceId: string;
  profile: CardProfile;
  limitTotalCents: number;
  actorUid: string;
  intentId: string;
  requestHash: string;
}): admin.firestore.DocumentData => ({
  id: input.id,
  schemaVersion: CARD_SCHEMA_VERSION,
  workspaceId: input.workspaceId,
  ...input.profile,
  status: "active",
  limitTotalCents: input.limitTotalCents,
  limitUsedCents: 0,
  limitAvailableCents: input.limitTotalCents,
  revision: 1,
  intentId: input.intentId,
  requestHash: input.requestHash,
  createdBy: input.actorUid,
  updatedBy: input.actorUid,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
  limitUpdatedAt: FieldValue.serverTimestamp(),
});

/** Novo limite usado: grava o derivado junto, nunca um sem o outro. */
export const cardLimitPatch = (
  card: Pick<AuthoritativeCard, "limitTotalCents">,
  limitUsedCents: number,
): admin.firestore.UpdateData<admin.firestore.DocumentData> => ({
  limitUsedCents,
  limitAvailableCents: card.limitTotalCents - limitUsedCents,
  limitUpdatedAt: FieldValue.serverTimestamp(),
});

// -------------------------------------------------------------------- compra

export type PurchaseStatus = "active" | "cancelled" | "refunded";
/**
 * Origem da compra. A callable de compra manual grava sempre `manual`;
 * `recurring` é gravada só pela geração de Recorrentes (P4-B), com o
 * contrato e a ocorrência de origem; `split`, só pela Divisão de contas
 * (P4-C), com o grupo e o título de origem.
 */
export const PURCHASE_SOURCES = ["manual", "recurring", "split"] as const;
export type PurchaseSource = typeof PURCHASE_SOURCES[number];

export interface PurchaseDetails {
  description: string;
  category: string;
  supplier: string | null;
  costCenter: string | null;
}

export interface AuthoritativePurchase extends PurchaseDetails {
  id: string;
  workspaceId: string;
  cardId: string;
  purchaseDate: string;
  totalCents: number;
  installmentsCount: number;
  /** Revisão financeira: parte dos IDs das parcelas vigentes. */
  installmentRevision: number;
  status: PurchaseStatus;
  source: PurchaseSource;
  refundedCents: number;
  createdBy: string;
  revision: number;
  requestHash: string;
  updatedAt: Timestamp;
}

export const readAuthoritativePurchase = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativePurchase | null => {
  if (!data || data.schemaVersion !== CARD_SCHEMA_VERSION) return null;
  if (
    data.workspaceId !== workspaceId ||
    !isText(data.cardId) ||
    !isText(data.description) ||
    !isText(data.category) ||
    !isNullableText(data.supplier) ||
    !isNullableText(data.costCenter) ||
    !isDayKeyText(data.purchaseDate) ||
    !isPositiveInt(data.totalCents) ||
    data.totalCents > CARD_MAX_CENTS ||
    !isPositiveInt(data.installmentsCount) ||
    data.installmentsCount > CARD_MAX_INSTALLMENTS ||
    data.installmentsCount > data.totalCents ||
    !isPositiveInt(data.installmentRevision) ||
    !["active", "cancelled", "refunded"].includes(data.status) ||
    !(PURCHASE_SOURCES as readonly unknown[]).includes(data.source) ||
    // Origem recorrente ⇔ contrato e ocorrência de origem gravados.
    (data.source === "recurring" ?
      !isText(data.recurringExpenseId) || !isText(data.recurringOccurrenceId) :
      data.recurringExpenseId !== null ||
        data.recurringOccurrenceId !== null) ||
    // Origem da Divisão de contas ⇔ grupo e título de origem gravados.
    (data.source === "split" ?
      !isText(data.splitGroupId) || !isText(data.splitBillId) :
      data.splitGroupId !== null || data.splitBillId !== null) ||
    !isNonNegativeInt(data.refundedCents) ||
    data.refundedCents > data.totalCents ||
    !isText(data.createdBy) ||
    !isPositiveInt(data.revision) ||
    !isText(data.requestHash) ||
    !isTimestamp(data.updatedAt)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    cardId: data.cardId,
    description: data.description,
    category: data.category,
    supplier: data.supplier,
    costCenter: data.costCenter,
    purchaseDate: data.purchaseDate,
    totalCents: data.totalCents,
    installmentsCount: data.installmentsCount,
    installmentRevision: data.installmentRevision,
    status: data.status,
    source: data.source,
    refundedCents: data.refundedCents,
    createdBy: data.createdBy,
    revision: data.revision,
    requestHash: data.requestHash,
    updatedAt: data.updatedAt,
  };
};

// -------------------------------------------------------------------- fatura

export interface AuthoritativeInvoice {
  id: string;
  workspaceId: string;
  cardId: string;
  competenceMonth: string;
  closingDate: string;
  dueDate: string;
  cycleStatus: InvoiceCycleStatus;
  paymentStatus: InvoicePaymentStatus;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  activeEntryCount: number;
  revision: number;
  updatedAt: Timestamp;
}

/**
 * Invariantes da fatura: aberta não tem pagamento e pode ficar negativa
 * (crédito); fechada tem total ≥ 0 (o crédito excedente é transportado no
 * fechamento) e pago entre 0 e o total. Restante = total − pago, e o estado
 * do pagamento é sempre o derivado.
 */
export const isConsistentInvoiceState = (state: {
  cycleStatus: InvoiceCycleStatus;
  paymentStatus: InvoicePaymentStatus;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  activeEntryCount: number;
}): boolean => {
  if (
    !isMoneyCents(state.totalCents) ||
    !isNonNegativeInt(state.paidCents) ||
    state.remainingCents !== state.totalCents - state.paidCents ||
    !isNonNegativeInt(state.activeEntryCount) ||
    state.paymentStatus !==
      derivePaymentStatus(state.totalCents, state.paidCents)
  ) {
    return false;
  }
  if (state.cycleStatus === "open") return state.paidCents === 0;
  return state.totalCents >= 0 && state.paidCents <= state.totalCents;
};

export const readAuthoritativeInvoice = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeInvoice | null => {
  if (!data || data.schemaVersion !== CARD_SCHEMA_VERSION) return null;
  if (
    data.workspaceId !== workspaceId ||
    !isText(data.cardId) ||
    !isMonthKey(data.competenceMonth) ||
    id !== invoiceIdFor(data.cardId, data.competenceMonth) ||
    !isDayKeyText(data.closingDate) ||
    !isDayKeyText(data.dueDate) ||
    data.dueDate <= data.closingDate ||
    (data.cycleStatus !== "open" && data.cycleStatus !== "closed") ||
    !["unpaid", "partial", "paid"].includes(data.paymentStatus) ||
    !isPositiveInt(data.revision) ||
    !isTimestamp(data.updatedAt) ||
    !isConsistentInvoiceState({
      cycleStatus: data.cycleStatus,
      paymentStatus: data.paymentStatus,
      totalCents: data.totalCents,
      paidCents: data.paidCents,
      remainingCents: data.remainingCents,
      activeEntryCount: data.activeEntryCount,
    })
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    cardId: data.cardId,
    competenceMonth: data.competenceMonth,
    closingDate: data.closingDate,
    dueDate: data.dueDate,
    cycleStatus: data.cycleStatus,
    paymentStatus: data.paymentStatus,
    totalCents: data.totalCents,
    paidCents: data.paidCents,
    remainingCents: data.remainingCents,
    activeEntryCount: data.activeEntryCount,
    revision: data.revision,
    updatedAt: data.updatedAt,
  };
};

/** Fatura nova, aberta e vazia; o chamador aplica o primeiro lançamento. */
export const newInvoiceState = (input: {
  workspaceId: string;
  cardId: string;
  competenceMonth: string;
  closingDay: number;
  dueDay: number;
}): Omit<AuthoritativeInvoice, "updatedAt" | "revision"> & {
  revision: number;
} => ({
  id: invoiceIdFor(input.cardId, input.competenceMonth),
  workspaceId: input.workspaceId,
  cardId: input.cardId,
  competenceMonth: input.competenceMonth,
  closingDate: closingDateOf(input.competenceMonth, input.closingDay),
  dueDate: dueDateOf(input.competenceMonth, input.closingDay, input.dueDay),
  cycleStatus: "open",
  paymentStatus: "paid",
  totalCents: 0,
  paidCents: 0,
  remainingCents: 0,
  activeEntryCount: 0,
  revision: 0,
});

export interface InvoiceFinancialState {
  cycleStatus: InvoiceCycleStatus;
  totalCents: number;
  paidCents: number;
  activeEntryCount: number;
}

/** Campos derivados gravados junto com qualquer mudança financeira. */
export const invoiceStatePatch = (
  state: InvoiceFinancialState,
  revision: number,
): admin.firestore.UpdateData<admin.firestore.DocumentData> => ({
  cycleStatus: state.cycleStatus,
  totalCents: state.totalCents,
  paidCents: state.paidCents,
  remainingCents: state.totalCents - state.paidCents,
  paymentStatus: derivePaymentStatus(state.totalCents, state.paidCents),
  activeEntryCount: state.activeEntryCount,
  revision,
  updatedAt: FieldValue.serverTimestamp(),
});

export const invoiceCreateDocument = (
  base: ReturnType<typeof newInvoiceState>,
  state: InvoiceFinancialState,
): admin.firestore.DocumentData => ({
  id: base.id,
  schemaVersion: CARD_SCHEMA_VERSION,
  workspaceId: base.workspaceId,
  cardId: base.cardId,
  competenceMonth: base.competenceMonth,
  closingDate: base.closingDate,
  dueDate: base.dueDate,
  closedAt: null,
  closedBy: null,
  carryoverOutCents: 0,
  createdAt: FieldValue.serverTimestamp(),
  ...invoiceStatePatch(state, 1),
});

// --------------------------------------------------------- lançamentos

export const ENTRY_KINDS = [
  "installment",
  "adjustment",
  "refund_credit",
  "carryover_in",
  "carryover_out",
] as const;
export type EntryKind = typeof ENTRY_KINDS[number];
export type EntryStatus = "active" | "cancelled";

export interface AuthoritativeEntry {
  id: string;
  workspaceId: string;
  cardId: string;
  invoiceId: string;
  competenceMonth: string;
  kind: EntryKind;
  amountCents: number;
  status: EntryStatus;
  purchaseId: string | null;
  installmentNumber: number | null;
}

/** Sinal exigido por tipo: parcela e transporte de saída positivos etc. */
export const isEntryAmountValid = (
  kind: EntryKind,
  amount: number,
): boolean => {
  if (!isMoneyCents(amount) || amount === 0) return false;
  switch (kind) {
  case "installment":
  case "carryover_out":
    return amount > 0;
  case "refund_credit":
  case "carryover_in":
    return amount < 0;
  case "adjustment":
    return true;
  }
};

export const readAuthoritativeEntry = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeEntry | null => {
  if (!data || data.schemaVersion !== CARD_SCHEMA_VERSION) return null;
  if (
    data.workspaceId !== workspaceId ||
    !isText(data.cardId) ||
    !isText(data.invoiceId) ||
    !isMonthKey(data.competenceMonth) ||
    data.invoiceId !== invoiceIdFor(data.cardId, data.competenceMonth) ||
    !(ENTRY_KINDS as readonly unknown[]).includes(data.kind) ||
    !isEntryAmountValid(data.kind, data.amountCents) ||
    (data.status !== "active" && data.status !== "cancelled") ||
    !isNullableText(data.purchaseId) ||
    !(data.installmentNumber === null || isPositiveInt(data.installmentNumber))
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    cardId: data.cardId,
    invoiceId: data.invoiceId,
    competenceMonth: data.competenceMonth,
    kind: data.kind,
    amountCents: data.amountCents,
    status: data.status,
    purchaseId: data.purchaseId,
    installmentNumber: data.installmentNumber,
  };
};

export const entryDocument = (input: {
  id: string;
  workspaceId: string;
  cardId: string;
  competenceMonth: string;
  kind: EntryKind;
  amountCents: number;
  purchaseId: string | null;
  installmentNumber: number | null;
  installmentsCount: number | null;
  /** Competência natural da parcela (na retroativa, difere da publicada). */
  naturalCompetence: string | null;
  /** Ajuste em fatura fechada: a competência pedida, compensada aqui. */
  requestedCompetence: string | null;
  /** Transporte: a fatura de origem do crédito. */
  sourceInvoiceId: string | null;
  /** Só no ajuste: motivo informado por owner/admin. */
  reason: string | null;
  actorUid: string;
  operation: string;
  requestId: string;
}): admin.firestore.DocumentData => ({
  id: input.id,
  schemaVersion: CARD_SCHEMA_VERSION,
  workspaceId: input.workspaceId,
  cardId: input.cardId,
  invoiceId: invoiceIdFor(input.cardId, input.competenceMonth),
  competenceMonth: input.competenceMonth,
  kind: input.kind,
  amountCents: input.amountCents,
  status: "active",
  purchaseId: input.purchaseId,
  installmentNumber: input.installmentNumber,
  installmentsCount: input.installmentsCount,
  naturalCompetence: input.naturalCompetence,
  requestedCompetence: input.requestedCompetence,
  sourceInvoiceId: input.sourceInvoiceId,
  reason: input.reason,
  cancelledAt: null,
  cancelledBy: null,
  createdBy: input.actorUid,
  operation: input.operation,
  requestId: input.requestId,
  createdAt: FieldValue.serverTimestamp(),
});

/** Cancelamento lógico de lançamento de fatura aberta (nunca apagado). */
export const entryCancelPatch = (
  actorUid: string,
): admin.firestore.UpdateData<admin.firestore.DocumentData> => ({
  status: "cancelled",
  cancelledAt: FieldValue.serverTimestamp(),
  cancelledBy: actorUid,
});

// ---------------------------------------------------------------- pagamento

export type PaymentKind = "payment" | "reversal";

export interface AuthoritativePayment {
  id: string;
  workspaceId: string;
  cardId: string;
  invoiceId: string;
  kind: PaymentKind;
  amountCents: number;
  paymentDate: string;
  cashAccountId: string;
  accountMovementId: string;
  cashTransactionId: string;
  reversalOf: string | null;
  reversedBy: string | null;
  createdBy: string;
  requestHash: string;
}

export const readAuthoritativePayment = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativePayment | null => {
  if (!data || data.schemaVersion !== CARD_SCHEMA_VERSION) return null;
  if (
    data.workspaceId !== workspaceId ||
    !isText(data.cardId) ||
    !isText(data.invoiceId) ||
    (data.kind !== "payment" && data.kind !== "reversal") ||
    !isPositiveInt(data.amountCents) ||
    data.amountCents > CARD_MAX_CENTS ||
    !isDayKeyText(data.paymentDate) ||
    !isText(data.cashAccountId) ||
    !isText(data.accountMovementId) ||
    !isText(data.cashTransactionId) ||
    !isNullableText(data.reversalOf) ||
    (data.kind === "reversal") !== (data.reversalOf !== null) ||
    !isNullableText(data.reversedBy) ||
    (data.kind === "reversal" && data.reversedBy !== null) ||
    !isText(data.createdBy) ||
    !isText(data.requestHash)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    cardId: data.cardId,
    invoiceId: data.invoiceId,
    kind: data.kind,
    amountCents: data.amountCents,
    paymentDate: data.paymentDate,
    cashAccountId: data.cashAccountId,
    accountMovementId: data.accountMovementId,
    cashTransactionId: data.cashTransactionId,
    reversalOf: data.reversalOf,
    reversedBy: data.reversedBy,
    createdBy: data.createdBy,
    requestHash: data.requestHash,
  };
};

export const paymentDocument = (input: {
  id: string;
  workspaceId: string;
  cardId: string;
  invoiceId: string;
  competenceMonth: string;
  kind: PaymentKind;
  amountCents: number;
  paymentDate: string;
  cashAccountId: string;
  accountMovementId: string;
  cashTransactionId: string;
  reversalOf: string | null;
  actorUid: string;
  intentId: string;
  requestHash: string;
  requestId: string;
}): admin.firestore.DocumentData => ({
  id: input.id,
  schemaVersion: CARD_SCHEMA_VERSION,
  workspaceId: input.workspaceId,
  cardId: input.cardId,
  invoiceId: input.invoiceId,
  competenceMonth: input.competenceMonth,
  kind: input.kind,
  amountCents: input.amountCents,
  paymentDate: input.paymentDate,
  cashAccountId: input.cashAccountId,
  accountMovementId: input.accountMovementId,
  cashTransactionId: input.cashTransactionId,
  reversalOf: input.reversalOf,
  reversedBy: null,
  reversedAt: null,
  intentId: input.intentId,
  requestHash: input.requestHash,
  requestId: input.requestId,
  createdBy: input.actorUid,
  createdAt: FieldValue.serverTimestamp(),
});

// ---------------------------------------------------------- livro do limite

export const LIMIT_LEDGER_KINDS = [
  "purchase",
  "purchase_update",
  "purchase_cancel",
  "purchase_refund",
  "adjustment",
  "payment",
  "payment_reversal",
] as const;
export type LimitLedgerKind = typeof LIMIT_LEDGER_KINDS[number];

/** Positivo consome limite; negativo devolve. Valor zero não é gravado. */
export const limitLedgerDocument = (input: {
  id: string;
  workspaceId: string;
  cardId: string;
  kind: LimitLedgerKind;
  amountCents: number;
  sourceId: string;
  limitUsedAfterCents: number;
  actorUid: string;
  operation: string;
  requestId: string;
}): admin.firestore.DocumentData => ({
  id: input.id,
  schemaVersion: CARD_SCHEMA_VERSION,
  workspaceId: input.workspaceId,
  cardId: input.cardId,
  kind: input.kind,
  amountCents: input.amountCents,
  sourceId: input.sourceId,
  limitUsedAfterCents: input.limitUsedAfterCents,
  createdBy: input.actorUid,
  operation: input.operation,
  requestId: input.requestId,
  createdAt: FieldValue.serverTimestamp(),
});

// ------------------------------------------------------------------ eventos

export type CardEventOperation =
  | "credit_card.created"
  | "credit_card.updated"
  | "credit_card.archived"
  | "credit_card.reactivated"
  | "credit_card.purchase_created"
  | "credit_card.purchase_updated"
  | "credit_card.purchase_cancelled"
  | "credit_card.purchase_refunded"
  | "credit_card.adjustment_created"
  | "credit_card.invoice_closed"
  | "credit_card.payment_registered"
  | "credit_card.payment_reversed"
  | "credit_card.limit_recalculated"
  | "credit_card.invoice_rebuilt";

export const cardEventIdFor = (
  operation: CardEventOperation,
  targetKey: string,
): string => `${operation.replace(".", "_")}_${
  sha256(`${operation}:${targetKey}`).slice(0, 32)}`;

export type CardEventSnapshot = Record<string, number | string | null>;

export interface CardEventInput {
  workspaceId: string;
  cardId: string;
  operation: CardEventOperation;
  /** Chave do ID determinístico do evento (alvo do fato ou intenção). */
  targetKey: string;
  actorId: string;
  actorRole: WorkspaceRole | null;
  intentId: string | null;
  requestHash: string | null;
  requestId: string;
  correlationId: string | null;
  purchaseId?: string | null;
  invoiceId?: string | null;
  paymentId?: string | null;
  entryId?: string | null;
  amountCents?: number | null;
  /** Só números, estados e IDs: nenhum texto livre nem dado pessoal. */
  before: CardEventSnapshot | null;
  after: CardEventSnapshot | null;
  changedFields?: string[];
}

export const appendCardEvent = (
  transaction: admin.firestore.Transaction,
  input: CardEventInput,
): string => {
  const ref = cardEventsRef(input.workspaceId)
    .doc(cardEventIdFor(input.operation, input.targetKey));
  transaction.create(ref, {
    id: ref.id,
    schemaVersion: CARD_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    cardId: input.cardId,
    operation: input.operation,
    actorId: input.actorId,
    actorRole: input.actorRole,
    intentId: input.intentId,
    requestHash: input.requestHash,
    requestId: input.requestId,
    correlationId: input.correlationId,
    purchaseId: input.purchaseId ?? null,
    invoiceId: input.invoiceId ?? null,
    paymentId: input.paymentId ?? null,
    entryId: input.entryId ?? null,
    amountCents: input.amountCents ?? null,
    before: input.before,
    after: input.after,
    changedFields: input.changedFields ?? [],
    occurredAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
};

export const cardLimitSnapshot = (card: {
  status: CardStatus;
  limitTotalCents: number;
  limitUsedCents: number;
}): CardEventSnapshot => ({
  status: card.status,
  limitTotalCents: card.limitTotalCents,
  limitUsedCents: card.limitUsedCents,
  limitAvailableCents: card.limitTotalCents - card.limitUsedCents,
});

export const invoiceSnapshot = (
  state: InvoiceFinancialState,
): CardEventSnapshot => ({
  cycleStatus: state.cycleStatus,
  totalCents: state.totalCents,
  paidCents: state.paidCents,
  remainingCents: state.totalCents - state.paidCents,
  paymentStatus: derivePaymentStatus(state.totalCents, state.paidCents),
  activeEntryCount: state.activeEntryCount,
});
