import * as admin from "firebase-admin";

import type {
  CreditCardCallableExecutionContext,
} from "./callable";

import type {
  UpdateCreditCardPurchasePayload,
} from "./contracts";

import {
  CREDIT_CARD_ADMIN_COLLECTIONS,
  cardFinancialEventDoc,
  cardLimitLedgerDoc,
  cardLimitSnapshotDoc,
  creditCardInstallmentDoc,
  creditCardInvoiceDoc,
  creditCardInvoiceViewDoc,
  creditCardPurchaseDoc,
  getFirestore,
  workspaceCollection,
} from "./adminPaths";

import {
  CreditCardApplicationError,
} from "./errors";

import {
  markIdempotencyKeyCompleted,
  reserveIdempotencyKey,
} from "./idempotency";

export interface UpdateCreditCardPurchaseResult {
  success: true;
  purchaseId: string;
  updatedInstallmentIds: string[];
  cancelledInstallmentIds: string[];
  affectedInvoiceIds: string[];
  ledgerEntryId?: string;
  eventId: string;
  limitSnapshot: {
    cardId: string;
    limitTotal: number;
    limitUsed: number;
    limitAvailable: number;
  };
}

interface PurchaseData {
  id?: string;
  workspaceId?: string;
  cardId?: string;
  description?: string;
  categoryId?: string;
  categorySnapshot?: Record<string, unknown>;
  supplier?: string;
  costCenter?: string;
  purchaseDate?: string;
  totalAmount?: number;
  installmentsCount?: number;
  amountType?: "total" | "installment";
  firstInvoiceCompetence?: string;
  status?: string;
}

interface InstallmentData {
  id?: string;
  workspaceId?: string;
  purchaseId?: string;
  cardId?: string;
  installmentNumber?: number;
  installmentsCount?: number;
  amount?: number;
  competenceMonth?: string;
  invoiceId?: string;
  dueDate?: string;
  status?: string;
  paidAmount?: number;
}

interface InvoiceData {
  id?: string;
  workspaceId?: string;
  cardId?: string;
  competenceMonth?: string;
  closingDate?: string;
  dueDate?: string;
  status?: string;
  totalAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
  itemsCount?: number;
}

interface LimitSnapshotData {
  workspaceId?: string;
  cardId?: string;
  limitTotal?: number;
  limitUsed?: number;
  limitAvailable?: number;
}

interface PaymentData {
  id?: string;
  workspaceId?: string;
  cardId?: string;
  invoiceId?: string;
  status?: string;
}

interface InstallmentDraft {
  id: string;
  workspaceId: string;
  purchaseId: string;
  cardId: string;
  installmentNumber: number;
  installmentsCount: number;
  amount: number;
  competenceMonth: string;
  invoiceId: string;
  dueDate: string;
  status: "invoiced";
  paidAmount: number;
}

const normalizeMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (
    Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null
  );

const stripUndefinedValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedValues);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedValues(entryValue)])
  );
};

const toFirestoreData = (
  data: Record<string, unknown>
): admin.firestore.DocumentData =>
  stripUndefinedValues(data) as admin.firestore.DocumentData;

const pad = (value: number): string => String(value).padStart(2, "0");

const lastDayOfMonth = (year: number, monthIndex: number): number =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

const formatDateWithSafeDay = (
  competenceMonth: string,
  day: number
): string => {
  const [year, month] = competenceMonth.split("-").map(Number);
  const monthIndex = month - 1;
  const safeDay = Math.min(day, lastDayOfMonth(year, monthIndex));

  return `${year}-${pad(month)}-${pad(safeDay)}`;
};

const parseIsoDateParts = (
  value: string
): {year: number; monthIndex: number; day: number} => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

  if (!match) {
    throw new CreditCardApplicationError(
      "invalid_payload",
      "Data da compra inválida.",
      {field: "purchaseDate"}
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthIndex = month - 1;
  const lastDay = lastDayOfMonth(year, monthIndex);

  if (month < 1 || month > 12 || day < 1 || day > lastDay) {
    throw new CreditCardApplicationError(
      "invalid_payload",
      "Data da compra inválida.",
      {field: "purchaseDate"}
    );
  }

  return {year, monthIndex, day};
};

const formatCompetenceMonth = (
  year: number,
  monthIndex: number
): string => {
  const date = new Date(Date.UTC(year, monthIndex, 1));

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
};

const addMonthsToCompetence = (
  competenceMonth: string,
  months: number
): string => {
  const [year, month] = competenceMonth.split("-").map(Number);

  return formatCompetenceMonth(year, month - 1 + months);
};

const calculateFirstInvoiceCompetence = (
  purchaseDate: string,
  closingDay: number
): string => {
  const parts = parseIsoDateParts(purchaseDate);
  const baseCompetence = formatCompetenceMonth(
    parts.year,
    parts.monthIndex
  );

  return parts.day > closingDay ?
    addMonthsToCompetence(baseCompetence, 1) :
    baseCompetence;
};

const buildInvoiceId = (
  cardId: string,
  competenceMonth: string
): string => `${cardId}_${competenceMonth}`;

const buildInstallmentId = (
  purchaseId: string,
  installmentNumber: number
): string =>
  `${purchaseId}_installment_${String(installmentNumber).padStart(3, "0")}`;

const sumMoney = (values: number[]): number =>
  normalizeMoney(values.reduce((total, value) => total + value, 0));

const calculateInstallmentAmounts = (
  totalAmount: number,
  installmentsCount: number
): number[] => {
  const baseAmount = normalizeMoney(totalAmount / installmentsCount);
  const amounts: number[] = [];
  let accumulated = 0;

  for (let index = 0; index < installmentsCount; index++) {
    const isLast = index === installmentsCount - 1;
    const amount = isLast ?
      normalizeMoney(totalAmount - accumulated) :
      baseAmount;

    amounts.push(amount);
    accumulated = normalizeMoney(accumulated + amount);
  }

  if (sumMoney(amounts) !== normalizeMoney(totalAmount)) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "A soma das parcelas não fecha com o valor total da compra.",
      {totalAmount}
    );
  }

  return amounts;
};

const resolveTotalAmount = (
  amount: number,
  amountType: "total" | "installment",
  installmentsCount: number
): number => {
  const normalizedAmount = normalizeMoney(amount);

  if (amountType === "installment") {
    return normalizeMoney(normalizedAmount * installmentsCount);
  }

  return normalizedAmount;
};

const buildInstallments = (
  workspaceId: string,
  purchaseId: string,
  cardId: string,
  totalAmount: number,
  installmentsCount: number,
  firstInvoiceCompetence: string,
  dueDay: number
): InstallmentDraft[] => {
  const amounts = calculateInstallmentAmounts(totalAmount, installmentsCount);

  return amounts.map((amount, index) => {
    const installmentNumber = index + 1;
    const competenceMonth = addMonthsToCompetence(
      firstInvoiceCompetence,
      index
    );
    const invoiceId = buildInvoiceId(cardId, competenceMonth);

    return {
      id: buildInstallmentId(purchaseId, installmentNumber),
      workspaceId,
      purchaseId,
      cardId,
      installmentNumber,
      installmentsCount,
      amount,
      competenceMonth,
      invoiceId,
      dueDate: formatDateWithSafeDay(competenceMonth, dueDay),
      status: "invoiced",
      paidAmount: 0,
    };
  });
};

const groupAmountByInvoice = (
  installments: Array<InstallmentData | InstallmentDraft>
): Map<string, {amount: number; itemsCount: number}> => {
  const grouped = new Map<string, {amount: number; itemsCount: number}>();

  installments.forEach((installment) => {
    if (!installment.invoiceId) return;

    const current = grouped.get(installment.invoiceId) ?? {
      amount: 0,
      itemsCount: 0,
    };

    current.amount = normalizeMoney(
      current.amount + Number(installment.amount ?? 0)
    );
    current.itemsCount += 1;

    grouped.set(installment.invoiceId, current);
  });

  return grouped;
};

const derivePaymentStatus = (
  totalAmount: number,
  paidAmount: number
): "unpaid" | "partial" | "paid" | "overpaid" => {
  if (totalAmount <= 0) return "paid";
  if (paidAmount <= 0) return "unpaid";
  if (paidAmount < totalAmount) return "partial";
  if (paidAmount === totalAmount) return "paid";

  return "overpaid";
};

const deriveInvoiceStatus = (
  totalAmount: number,
  paidAmount: number,
  itemsCount: number
): "open" | "partial_paid" | "paid" | "cancelled" => {
  if (itemsCount <= 0 || totalAmount <= 0) return "cancelled";
  if (paidAmount <= 0) return "open";
  if (paidAmount < totalAmount) return "partial_paid";

  return "paid";
};

const buildResult = (
  purchaseId: string,
  updatedInstallmentIds: string[],
  cancelledInstallmentIds: string[],
  affectedInvoiceIds: string[],
  ledgerEntryId: string | undefined,
  eventId: string,
  cardId: string,
  limitTotal: number,
  limitUsed: number,
  limitAvailable: number
): UpdateCreditCardPurchaseResult => ({
  success: true,
  purchaseId,
  updatedInstallmentIds,
  cancelledInstallmentIds,
  affectedInvoiceIds,
  ledgerEntryId,
  eventId,
  limitSnapshot: {
    cardId,
    limitTotal,
    limitUsed,
    limitAvailable,
  },
});

export const executeUpdateCreditCardPurchase = async (
  context: CreditCardCallableExecutionContext<UpdateCreditCardPurchasePayload>
): Promise<UpdateCreditCardPurchaseResult | Record<string, unknown>> => {
  const {payload, auth} = context;
  const db = getFirestore();
  const operation = "updateCreditCardPurchase";

  return db.runTransaction(async (transaction) => {
    const workspaceId = payload.workspaceId;
    const purchaseRef = creditCardPurchaseDoc(
      workspaceId,
      payload.purchaseId
    );
    const limitSnapshotRef = cardLimitSnapshotDoc(
      workspaceId,
      payload.cardId
    );
    const installmentsQuery = workspaceCollection(
      workspaceId,
      CREDIT_CARD_ADMIN_COLLECTIONS.installments
    ).where("purchaseId", "==", payload.purchaseId);

    const [
      purchaseSnapshot,
      limitSnapshot,
      installmentsSnapshot,
    ] = await Promise.all([
      transaction.get(purchaseRef),
      transaction.get(limitSnapshotRef),
      transaction.get(installmentsQuery),
    ]);

    if (!purchaseSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Compra de cartão não encontrada.",
        {purchaseId: payload.purchaseId}
      );
    }

    if (!limitSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Snapshot de limite do cartão não encontrado.",
        {cardId: payload.cardId}
      );
    }

    const purchaseData = purchaseSnapshot.data() as PurchaseData | undefined;
    const limitSnapshotData = limitSnapshot.data() as
      LimitSnapshotData | undefined;
    const oldInstallments = installmentsSnapshot.docs.map(
      (documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      })
    ) as InstallmentData[];

    if (!purchaseData) {
      throw new CreditCardApplicationError(
        "internal",
        "Compra existente sem dados carregados.",
        {purchaseId: payload.purchaseId}
      );
    }

    if (!limitSnapshotData) {
      throw new CreditCardApplicationError(
        "internal",
        "Snapshot de limite existente sem dados carregados.",
        {cardId: payload.cardId}
      );
    }

    if (oldInstallments.length === 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A compra não possui parcelas para edição.",
        {purchaseId: payload.purchaseId}
      );
    }

    const currentPurchaseDate = purchaseData.purchaseDate;
    const currentAmountType = purchaseData.amountType ?? "total";
    const currentInstallmentsCount = Number(
      purchaseData.installmentsCount ?? oldInstallments.length
    );
    const currentTotalAmount = normalizeMoney(
      Number(purchaseData.totalAmount ?? sumMoney(
        oldInstallments.map((installment) => Number(installment.amount ?? 0))
      ))
    );

    if (!currentPurchaseDate) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A compra existente não possui data válida.",
        {purchaseId: payload.purchaseId}
      );
    }

    const nextPurchaseDate = payload.purchaseDate ?? currentPurchaseDate;
    const nextInstallmentsCount = payload.installmentsCount ??
      currentInstallmentsCount;
    const nextAmountType = payload.amountType ?? currentAmountType;
    const nextInputAmount = payload.totalAmount ?? (
      nextAmountType === "installment" ?
        normalizeMoney(currentTotalAmount / currentInstallmentsCount) :
        currentTotalAmount
    );
    const nextTotalAmount = resolveTotalAmount(
      nextInputAmount,
      nextAmountType,
      nextInstallmentsCount
    );

    const invoiceRefsForRead = new Set<string>();

    oldInstallments.forEach((installment) => {
      if (installment.invoiceId) {
        invoiceRefsForRead.add(installment.invoiceId);
      }
    });

    const oldInvoiceSnapshots = await Promise.all(
      Array.from(invoiceRefsForRead).map((invoiceId) =>
        transaction.get(creditCardInvoiceDoc(workspaceId, invoiceId))
      )
    );

    const firstExistingInvoice = oldInvoiceSnapshots[0]?.data() as
      InvoiceData | undefined;
    const closingDay = firstExistingInvoice?.closingDate ?
      Number(firstExistingInvoice.closingDate.slice(-2)) :
      10;
    const dueDay = firstExistingInvoice?.dueDate ?
      Number(firstExistingInvoice.dueDate.slice(-2)) :
      20;

    const newFirstInvoiceCompetence = calculateFirstInvoiceCompetence(
      nextPurchaseDate,
      closingDay
    );
    const newInstallments = buildInstallments(
      workspaceId,
      payload.purchaseId,
      payload.cardId,
      nextTotalAmount,
      nextInstallmentsCount,
      newFirstInvoiceCompetence,
      dueDay
    );

    newInstallments.forEach((installment) => {
      invoiceRefsForRead.add(installment.invoiceId);
    });

    const affectedInvoiceIds = Array.from(invoiceRefsForRead);
    const invoiceRefs = affectedInvoiceIds.map((invoiceId) =>
      creditCardInvoiceDoc(workspaceId, invoiceId)
    );
    const invoiceSnapshots = await Promise.all(
      invoiceRefs.map((invoiceRef) => transaction.get(invoiceRef))
    );
    const paymentQueries = affectedInvoiceIds.map((invoiceId) =>
      workspaceCollection(
        workspaceId,
        CREDIT_CARD_ADMIN_COLLECTIONS.invoicePayments
      ).where("invoiceId", "==", invoiceId)
    );
    const paymentSnapshots = await Promise.all(
      paymentQueries.map((paymentQuery) => transaction.get(paymentQuery))
    );
    
 const payments = paymentSnapshots.reduce<PaymentData[]>(
  (accumulator, paymentSnapshot) => {
    accumulator.push(
      ...paymentSnapshot.docs.map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      }) as PaymentData)
    );

    return accumulator;
  },
  []
);

    const idempotency = await reserveIdempotencyKey(transaction, {
      workspaceId,
      operation,
      idempotencyKey: payload.idempotencyKey,
      requestPayload: payload,
    });

    if (idempotency.replayResult) {
      return idempotency.replayResult;
    }

    if (purchaseData.workspaceId !== workspaceId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A compra não pertence ao workspace informado.",
        {purchaseId: payload.purchaseId}
      );
    }

    if (purchaseData.cardId !== payload.cardId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A compra não pertence ao cartão informado.",
        {purchaseId: payload.purchaseId, cardId: payload.cardId}
      );
    }

    if (purchaseData.status !== "active") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Somente compras ativas podem ser editadas.",
        {purchaseId: payload.purchaseId, status: purchaseData.status}
      );
    }

    const invalidInstallment = oldInstallments.find((installment) =>
      installment.workspaceId !== workspaceId ||
      installment.cardId !== payload.cardId ||
      installment.purchaseId !== payload.purchaseId
    );

    if (invalidInstallment) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Todas as parcelas precisam pertencer à compra, cartão e workspace.",
        {installmentId: invalidInstallment.id}
      );
    }

    const paidInstallment = oldInstallments.find((installment) =>
      Number(installment.paidAmount ?? 0) > 0 ||
      installment.status === "paid"
    );

    if (paidInstallment) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Não é permitido editar compra com parcela já paga.",
        {installmentId: paidInstallment.id}
      );
    }

    const activePayment = payments.find((payment) =>
      payment.status !== "reversed"
    );

    if (activePayment) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Não é permitido editar compra com pagamento em fatura afetada.",
        {
          paymentId: activePayment.id,
          invoiceId: activePayment.invoiceId,
        }
      );
    }

    const invoices = invoiceSnapshots.map((invoiceSnapshot) => ({
      id: invoiceSnapshot.id,
      exists: invoiceSnapshot.exists,
      data: invoiceSnapshot.data() as InvoiceData | undefined,
      ref: invoiceSnapshot.ref,
    }));

    const invalidInvoice = invoices.find((invoice) =>
      invoice.exists &&
      (
        !invoice.data ||
        invoice.data.workspaceId !== workspaceId ||
        invoice.data.cardId !== payload.cardId
      )
    );

    if (invalidInvoice) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "As faturas afetadas precisam pertencer ao mesmo cartão e workspace.",
        {invoiceId: invalidInvoice.id}
      );
    }

    const nonOpenInvoice = invoices.find((invoice) =>
      invoice.exists && invoice.data?.status !== "open"
    );

    if (nonOpenInvoice) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Edição conservadora exige que todas as faturas afetadas estejam abertas.",
        {invoiceId: nonOpenInvoice.id, status: nonOpenInvoice.data?.status}
      );
    }

    const oldAmountByInvoice = groupAmountByInvoice(oldInstallments);
    const newAmountByInvoice = groupAmountByInvoice(newInstallments);

 const newInstallmentIds = new Set(
  newInstallments.map((installment) => installment.id)
);
    const updatedInstallmentIds: string[] = [];
    const cancelledInstallmentIds: string[] = [];
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    newInstallments.forEach((installment) => {
      transaction.set(
        creditCardInstallmentDoc(workspaceId, installment.id),
        toFirestoreData({
          ...installment,
          updatedAt: serverTimestamp,
          createdAt: serverTimestamp,
        }),
        {merge: true}
      );

      updatedInstallmentIds.push(installment.id);
    });

    oldInstallments.forEach((installment) => {
      if (!installment.id || newInstallmentIds.has(installment.id)) return;

      transaction.update(
        creditCardInstallmentDoc(workspaceId, installment.id),
        toFirestoreData({
          status: "cancelled",
          cancelledAt: serverTimestamp,
          updatedAt: serverTimestamp,
        })
      );

      cancelledInstallmentIds.push(installment.id);
    });

    invoices.forEach((invoice) => {
      const oldGroup = oldAmountByInvoice.get(invoice.id) ?? {
        amount: 0,
        itemsCount: 0,
      };
      const newGroup = newAmountByInvoice.get(invoice.id) ?? {
        amount: 0,
        itemsCount: 0,
      };

      if (!invoice.exists) {
        if (newGroup.itemsCount <= 0) return;

        const competenceMonth = invoice.id.replace(`${payload.cardId}_`, "");
        const totalAmount = newGroup.amount;
        const paidAmount = 0;
        const remainingAmount = totalAmount;
        const itemsCount = newGroup.itemsCount;

        transaction.set(invoice.ref, toFirestoreData({
          id: invoice.id,
          workspaceId,
          cardId: payload.cardId,
          competenceMonth,
          closingDate: formatDateWithSafeDay(competenceMonth, closingDay),
          dueDate: formatDateWithSafeDay(competenceMonth, dueDay),
          status: "open",
          totalAmount,
          paidAmount,
          remainingAmount,
          itemsCount,
          paymentStatusDerived: "unpaid",
          generatedAt: serverTimestamp,
          updatedAt: serverTimestamp,
        }));

        transaction.set(
          creditCardInvoiceViewDoc(workspaceId, invoice.id),
          toFirestoreData({
            id: invoice.id,
            workspaceId,
            cardId: payload.cardId,
            competenceMonth,
            dueDate: formatDateWithSafeDay(competenceMonth, dueDay),
            status: "open",
            totalAmount,
            paidAmount,
            remainingAmount,
            updatedAt: serverTimestamp,
          }),
          {merge: true}
        );

        return;
      }

      const invoiceData = invoice.data as InvoiceData;
      const previousTotalAmount = normalizeMoney(
        Number(invoiceData.totalAmount ?? 0)
      );
      const previousPaidAmount = normalizeMoney(
        Number(invoiceData.paidAmount ?? 0)
      );
      const previousItemsCount = Number(invoiceData.itemsCount ?? 0);
      const totalAmount = normalizeMoney(
        Math.max(previousTotalAmount - oldGroup.amount + newGroup.amount, 0)
      );
      const paidAmount = Math.min(previousPaidAmount, totalAmount);
      const remainingAmount = normalizeMoney(totalAmount - paidAmount);
      const itemsCount = Math.max(
        previousItemsCount - oldGroup.itemsCount + newGroup.itemsCount,
        0
      );
      const status = deriveInvoiceStatus(totalAmount, paidAmount, itemsCount);
      const paymentStatusDerived = derivePaymentStatus(
        totalAmount,
        paidAmount
      );

      transaction.update(invoice.ref, toFirestoreData({
        totalAmount,
        paidAmount,
        remainingAmount,
        itemsCount,
        status,
        paymentStatusDerived,
        updatedAt: serverTimestamp,
      }));

      transaction.set(
        creditCardInvoiceViewDoc(workspaceId, invoice.id),
        toFirestoreData({
          id: invoice.id,
          workspaceId,
          cardId: payload.cardId,
          competenceMonth: invoiceData.competenceMonth,
          dueDate: invoiceData.dueDate,
          status,
          totalAmount,
          paidAmount,
          remainingAmount,
          updatedAt: serverTimestamp,
        }),
        {merge: true}
      );
    });

    const limitTotal = normalizeMoney(
      Number(limitSnapshotData.limitTotal ?? 0)
    );
    const currentLimitUsed = normalizeMoney(
      Number(limitSnapshotData.limitUsed ?? 0)
    );
    const currentLimitAvailable = normalizeMoney(
      Number(limitSnapshotData.limitAvailable ?? limitTotal - currentLimitUsed)
    );
    const deltaAmount = normalizeMoney(nextTotalAmount - currentTotalAmount);

    if (deltaAmount > 0 && currentLimitAvailable < deltaAmount) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Limite disponível insuficiente para aumentar esta compra.",
        {
          cardId: payload.cardId,
          deltaAmount,
          currentLimitAvailable,
        }
      );
    }

    const newLimitUsed = normalizeMoney(currentLimitUsed + deltaAmount);
    const newLimitAvailable = normalizeMoney(limitTotal - newLimitUsed);
    const ledgerEntryId = deltaAmount === 0 ?
      undefined :
      `${payload.purchaseId}_purchase_updated_${Date.now()}`;

    if (ledgerEntryId) {
      transaction.set(cardLimitLedgerDoc(workspaceId, ledgerEntryId), {
        id: ledgerEntryId,
        workspaceId,
        cardId: payload.cardId,
        sourceType: "purchase",
        sourceId: payload.purchaseId,
        direction: deltaAmount > 0 ? "consume" : "restore",
        amount: Math.abs(deltaAmount),
        balanceAfter: newLimitAvailable,
        createdAt: serverTimestamp,
        actorId: auth.uid,
        idempotencyKey: payload.idempotencyKey,
      });
    }

    transaction.set(limitSnapshotRef, toFirestoreData({
      workspaceId,
      cardId: payload.cardId,
      limitTotal,
      limitUsed: newLimitUsed,
      limitAvailable: newLimitAvailable,
      updatedAt: serverTimestamp,
    }));

transaction.update(purchaseRef, toFirestoreData({
  description: payload.description ?? purchaseData.description,
  categoryId: payload.categoryId ?? purchaseData.categoryId,
  categorySnapshot: payload.categorySnapshot ??
    purchaseData.categorySnapshot,
  supplier: payload.supplier ?? purchaseData.supplier,
  costCenter: payload.costCenter ?? purchaseData.costCenter,
  purchaseDate: nextPurchaseDate,
  totalAmount: nextTotalAmount,
  installmentsCount: nextInstallmentsCount,
  amountType: nextAmountType,
  firstInvoiceCompetence: newFirstInvoiceCompetence,
  updatedBy: auth.uid,
  updatedAt: serverTimestamp,
}));

    const eventId = `${payload.purchaseId}_purchase_updated`;

    transaction.set(cardFinancialEventDoc(workspaceId, eventId), toFirestoreData({
      id: eventId,
      workspaceId,
      cardId: payload.cardId,
      eventType: "purchase_updated",
      purchaseId: payload.purchaseId,
      ledgerEntryId,
      payload: {
        reason: payload.reason,
        previousTotalAmount: currentTotalAmount,
        nextTotalAmount,
        deltaAmount,
        previousInstallmentsCount: currentInstallmentsCount,
        nextInstallmentsCount,
        affectedInvoiceIds,
        updatedInstallmentIds,
        cancelledInstallmentIds,
      },
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
      createdAt: serverTimestamp,
      actorId: auth.uid,
    }));

    const result = buildResult(
      payload.purchaseId,
      updatedInstallmentIds,
      cancelledInstallmentIds,
      affectedInvoiceIds,
      ledgerEntryId,
      eventId,
      payload.cardId,
      limitTotal,
      newLimitUsed,
      newLimitAvailable
    );

    markIdempotencyKeyCompleted(
      transaction,
      idempotency.ref,
      result as unknown as Record<string, unknown>
    );

    return result;
  });
};