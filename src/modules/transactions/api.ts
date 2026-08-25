import {
  addDoc,
  collection,
  doc,
  documentId,
  DocumentData,
  getDocs,
  limit,
  orderBy,
  query,
  QueryDocumentSnapshot,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "../../lib/firebase";
import type { Transaction } from "../../types";
import { toDateOnlyString, toFirestoreDateTimestamp } from "../../utils/date";

const txCol = (workspaceId: string) =>
  collection(db, "workspaces", workspaceId, "transactions");

function assertValidWorkspaceId(workspaceId: string | undefined): asserts workspaceId is string {
  if (!workspaceId || workspaceId === "loading") {
    throw new Error("Workspace ID inválido para operações de transação.");
  }
}

const stripUndefined = <T extends Record<string, any>>(obj: T): Partial<T> => {
  const out: Partial<T> = {};

  for (const k of Object.keys(obj) as (keyof T)[]) {
    const v = obj[k];
    if (v !== undefined) {
      if (Array.isArray(v)) {
        out[k] = v.map((entry) => (
          entry && typeof entry === "object" && Object.getPrototypeOf(entry) === Object.prototype
            ? stripUndefined(entry)
            : entry
        )) as T[keyof T];
      } else if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
        out[k] = stripUndefined(v) as T[keyof T];
      } else {
        out[k] = v;
      }
    }
  }

  return out;
};

/**
 * Transação baixada logicamente (INV-P2-032): permanece no histórico para
 * auditoria e reconciliação, e não participa de nenhuma leitura do produto.
 */
export const isVoidedTransaction = (data: DocumentData): boolean =>
  data?.voidedAt !== undefined && data?.voidedAt !== null;

const getSortTime = (data: DocumentData): number => {
  if (data.createdAt && typeof data.createdAt.toMillis === "function") {
    return data.createdAt.toMillis();
  }

  if (data.transactionDate && typeof data.transactionDate.toMillis === "function") {
    return data.transactionDate.toMillis();
  }

  const dateOnly = toDateOnlyString(data.date);
  return dateOnly ? new Date(`${dateOnly}T12:00:00.000Z`).getTime() : 0;
};

const normalizeTransaction = (
  snapshot: QueryDocumentSnapshot<DocumentData>
): Transaction => {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    ...(data as Omit<Transaction, "id">),
    date: toDateOnlyString(data.date ?? data.transactionDate),
    cardId: data.cardId ? String(data.cardId) : undefined,
    goalId: data.goalId ? String(data.goalId) : undefined,
    investmentMetadata: data.investmentMetadata ? {
      ...data.investmentMetadata,
      settlementDate: toDateOnlyString(data.investmentMetadata.settlementDate),
      sourceMovementId: String(data.investmentMetadata.sourceMovementId),
      reversalMovementId: data.investmentMetadata.reversalMovementId
        ? String(data.investmentMetadata.reversalMovementId)
        : undefined,
    } : undefined,
    workspaceId: data.workspaceId ?? snapshot.ref.parent.parent?.id
  };
};

const buildTransactionPayload = (
  workspaceId: string,
  transaction: Omit<Transaction, "id">
) => {
  return stripUndefined({
    ...transaction,
    date: toDateOnlyString(transaction.date),
    transactionDate: toFirestoreDateTimestamp(transaction.date),
    workspaceId,
    profileId: transaction.profileId ?? workspaceId
  });
};

const newIdempotencyKey = () => crypto.randomUUID();

const callInvestmentFunction = async <TResult>(
  name: string,
  payload: Record<string, unknown>,
): Promise<TResult> => {
  const callable = httpsCallable<Record<string, unknown>, TResult>(functions, name);
  const result = await callable(payload);
  return result.data;
};

const saveRedemption = async (
  workspaceId: string,
  transaction: Omit<Transaction, "id">,
  transactionId?: string,
): Promise<{transactionId: string}> => {
  const metadata = transaction.investmentMetadata;
  if (!metadata || metadata.investmentOperation !== "redemption") {
    throw new Error("Resgate inválido.");
  }
  return callInvestmentFunction("saveInvestmentRedemption", {
    workspaceId,
    idempotencyKey: metadata.idempotencyKey,
    correlationId: `transaction-ui-${metadata.idempotencyKey}`,
    ...(transactionId ? {transactionId} : {}),
    redemption: {
      sourceMovementId: metadata.sourceMovementId,
      description: transaction.description,
      principal: metadata.principalCents / 100,
      gain: metadata.gainCents / 100,
      fees: metadata.feesCents / 100,
      tax: metadata.taxCents / 100,
      settlementDate: metadata.settlementDate ?? transaction.date,
      status: metadata.status,
    },
  });
};

const saveLinkedContribution = async (
  workspaceId: string,
  transaction: Omit<Transaction, "id">,
  transactionId?: string,
): Promise<{transactionId: string}> => {
  if (transaction.type !== "investimento" || !transaction.goalId) {
    throw new Error("Aporte vinculado inválido.");
  }
  const displaySnapshots = transaction.displaySnapshots
    ? stripUndefined({
        categorySnapshot: transaction.displaySnapshots.categorySnapshot,
        walletSnapshot: transaction.displaySnapshots.walletSnapshot,
      })
    : undefined;
  const contribution = stripUndefined({
    goalId: transaction.goalId,
    description: transaction.description,
    category: transaction.category,
    value: transaction.value,
    date: transaction.date,
    walletId: transaction.walletId,
    isPaid: transaction.isPaid === true,
    supplier: transaction.supplier,
    costCenter: transaction.costCenter,
    displaySnapshots,
  });
  const callable = httpsCallable(functions, "saveGoalContribution");
  const result = await callable({
    workspaceId,
    idempotencyKey: newIdempotencyKey(),
    ...(transactionId ? {transactionId} : {}),
    contribution,
  });
  return result.data as {transactionId: string};
};

/**
 * Janela padrão carregada na abertura do aplicativo, em meses.
 *
 * Cobre com folga tudo que o produto consulta sem pedido explícito do usuário:
 * dashboard e gráficos usam o mês corrente, o widget de relatórios usa seis
 * meses, e as faixas `7d`, `30d`, `90d`, `12m` e `ytd` do relatório cabem aqui.
 */
export const DEFAULT_TRANSACTION_WINDOW_MONTHS = 12;

/** Teto de documentos por página. Toda consulta do módulo o respeita. */
export const TRANSACTION_PAGE_SIZE = 500;

/**
 * Teto de páginas de uma carga. Existe para que um defeito de cursor vire erro
 * visível em vez de laço, e para que o custo de uma carga seja limitado.
 */
export const MAX_TRANSACTION_PAGES = 40;

export interface TransactionWindow {
  /**
   * Início da janela como `YYYY-MM-DD`. Ausente significa "todo o histórico".
   */
  since?: string;
  /** Teto de páginas; ao ser atingido a carga volta marcada como truncada. */
  maxPages?: number;
}

export interface TransactionPage {
  items: Transaction[];
  /**
   * A janela pedida não coube no teto de páginas. O consumidor precisa dizer
   * isso ao usuário: silenciar seria apresentar um agregado incompleto como
   * se fosse o total.
   */
  truncated: boolean;
}

/** Início da janela como data-only `YYYY-MM-DD`, o formato do campo `date`. */
const monthsAgoDateOnly = (months: number): string => {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
};

/**
 * Carrega transações por janela de período, paginado (INV-P1-011).
 *
 * A versão anterior fazia `getDocs(txCol(workspaceId))` — sem `where`, sem
 * `orderBy`, sem `limit` — e ordenava no cliente. Um tenant com 200.000
 * transações lia 200.000 documentos **a cada carga do aplicativo**, no caminho
 * que alimenta dashboard, relatórios, metas e alocações. O módulo de
 * investimentos agrava a mesma coleção com um espelho por movimento.
 *
 * A ordenação é pelo campo `date` (`YYYY-MM-DD`), com cursor. **Não** por
 * `transactionDate`: o Firestore omite da consulta ordenada todo documento que
 * não tem o campo, e `transactionDate` é opcional em documentos legados —
 * ordenar por ele faria o histórico antigo simplesmente desaparecer da tela.
 * `date` é exigido pelas Rules em toda transação, é lexicograficamente
 * ordenável e cobre o histórico inteiro.
 *
 * O recorte por janela é o que torna o custo proporcional ao que a tela
 * mostra, e não ao histórico inteiro do workspace.
 */
export const getTransactionWindow = async (
  workspaceId: string,
  window: TransactionWindow = {},
): Promise<TransactionPage> => {
  assertValidWorkspaceId(workspaceId);

  const maxPages = window.maxPages ?? MAX_TRANSACTION_PAGES;
  const items: Transaction[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined;
  let truncated = true;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const constraints = [
      ...(window.since ? [where('date', '>=', window.since)] : []),
      orderBy('date', 'desc'),
      orderBy(documentId(), 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(TRANSACTION_PAGE_SIZE),
    ];
    const snapshot = await getDocs(query(txCol(workspaceId), ...constraints));
    snapshot.docs.forEach((document) => {
      if (isVoidedTransaction(document.data())) return;
      items.push(normalizeTransaction(document));
    });
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < TRANSACTION_PAGE_SIZE) {
      truncated = false;
      break;
    }
  }

  return { items, truncated };
};

/**
 * Janela padrão do aplicativo.
 *
 * Documentos anteriores ao campo `transactionDate` não entram na consulta
 * ordenada — o Firestore omite da ordenação todo documento sem o campo. Eles
 * são recuperados por uma segunda consulta limitada, para que um histórico
 * legado não desapareça da tela.
 */
export const getTransactions = async (
  workspaceId: string,
  months = DEFAULT_TRANSACTION_WINDOW_MONTHS,
): Promise<Transaction[]> => {
  const page = await getTransactionWindow(workspaceId, {
    since: monthsAgoDateOnly(months),
  });
  return page.items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
};

/**
 * Histórico completo, sob pedido explícito do usuário.
 *
 * É o único caminho que percorre o histórico inteiro, e existe porque a faixa
 * "tudo" do relatório é uma pergunta legítima. Ele é paginado, tem teto de
 * páginas e devolve `truncated` para que a tela avise quando o agregado não
 * cobre tudo.
 */
export const getFullTransactionHistory = (
  workspaceId: string,
): Promise<TransactionPage> => getTransactionWindow(workspaceId, {});

/**
 * Transações de investimento do histórico, para vínculo retroativo e para
 * escolher a origem de um resgate.
 *
 * Consulta específica por propósito: os dois formulários precisam do universo
 * de aportes, não do histórico inteiro de caixa.
 */
export const listInvestmentTransactions = async (
  workspaceId: string,
  max = TRANSACTION_PAGE_SIZE,
): Promise<Transaction[]> => {
  assertValidWorkspaceId(workspaceId);
  const snapshot = await getDocs(query(
    txCol(workspaceId),
    where('type', '==', 'investimento'),
    orderBy('date', 'desc'),
    orderBy(documentId(), 'desc'),
    limit(Math.min(max, TRANSACTION_PAGE_SIZE)),
  ));
  return snapshot.docs
    .filter((document) => !isVoidedTransaction(document.data()))
    .map(normalizeTransaction);
};

export const createTransaction = async (
  workspaceId: string,
  transaction: Omit<Transaction, "id">
): Promise<Transaction> => {
  assertValidWorkspaceId(workspaceId);

  if (transaction.investmentMetadata?.investmentOperation === "redemption") {
    const result = await saveRedemption(workspaceId, transaction);
    return {id: result.transactionId, ...transaction, workspaceId, profileId: workspaceId};
  }

  if (transaction.type === "investimento" && transaction.goalId) {
    const result = await saveLinkedContribution(workspaceId, transaction);
    return {id: result.transactionId, ...transaction, workspaceId, profileId: workspaceId};
  }

  const normalizedTransaction = buildTransactionPayload(workspaceId, transaction);

  const docRef = await addDoc(
    txCol(workspaceId),
    stripUndefined({
      ...normalizedTransaction,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  );

  return {
    id: docRef.id,
    ...transaction,
    ...normalizedTransaction
  } as Transaction;
};

export const createTransactionsBatch = async (
  workspaceId: string,
  transactions: Omit<Transaction, "id">[]
): Promise<Transaction[]> => {
  assertValidWorkspaceId(workspaceId);

  if (transactions.length === 0) {
    return [];
  }

  const batch = writeBatch(db);
  const collectionRef = txCol(workspaceId);
  const createdTransactions: Transaction[] = [];

  transactions.forEach((transaction) => {
    const docRef = doc(collectionRef);
    const normalizedTransaction = buildTransactionPayload(workspaceId, transaction);

    batch.set(
      docRef,
      stripUndefined({
        ...normalizedTransaction,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );

    createdTransactions.push({
      id: docRef.id,
      ...transaction,
      ...normalizedTransaction
    } as Transaction);
  });

  await batch.commit();

  return createdTransactions;
};

export const updateTransaction = async (
  workspaceId: string,
  transaction: Transaction
): Promise<void> => {
  assertValidWorkspaceId(workspaceId);

  const { id, ...data } = transaction;

  if (transaction.investmentMetadata?.investmentOperation === "redemption") {
    await saveRedemption(workspaceId, data, String(id));
    return;
  }

  if (transaction.type === "investimento" && transaction.goalId) {
    await saveLinkedContribution(workspaceId, data, String(id));
    return;
  }
  const docRef = doc(db, "workspaces", workspaceId, "transactions", String(id));

  await updateDoc(
    docRef,
    stripUndefined({
      ...buildTransactionPayload(workspaceId, data as Omit<Transaction, "id">),
      updatedAt: serverTimestamp()
    })
  );
};

/**
 * Baixa lógica de transação (INV-P2-032).
 *
 * `AGENTS.md` proíbe hard delete de histórico financeiro, e as Rules agora
 * negam `delete` em `transactions`. Uma transação legada apagada é a origem de
 * um movimento migrado: apagá-la torna a reconciliação da migração impossível
 * para sempre. O documento permanece, marcado com quem baixou, quando e por
 * quê, e desaparece de toda leitura do produto.
 */
export const deleteTransaction = async (
  workspaceId: string,
  transaction: Transaction,
): Promise<void> => {
  assertValidWorkspaceId(workspaceId);

  if (transaction.investmentMetadata?.investmentOperation === "redemption") {
    const idempotencyKey = newIdempotencyKey();
    if (transaction.investmentMetadata.status === "pending") {
      await callInvestmentFunction("cancelInvestmentRedemption", {
        workspaceId,
        idempotencyKey,
        correlationId: `transaction-ui-${idempotencyKey}`,
        transactionId: String(transaction.id),
        reason: "Cancelado pelo usuário",
      });
      return;
    }
    if (transaction.investmentMetadata.status === "settled") {
      await callInvestmentFunction("reverseInvestmentRedemption", {
        workspaceId,
        idempotencyKey,
        correlationId: `transaction-ui-${idempotencyKey}`,
        transactionId: String(transaction.id),
        reversalDate: new Date().toISOString().slice(0, 10),
        reason: "Estornado pelo usuário",
      });
      return;
    }
    throw new Error("Este resgate não pode ser alterado novamente.");
  }

  const docRef = doc(db, "workspaces", workspaceId, "transactions", String(transaction.id));
  const actorId = auth.currentUser?.uid;

  if (!actorId) {
    throw new Error("Sessão expirada. Entre novamente para excluir a transação.");
  }

  await updateDoc(docRef, {
    voidedAt: serverTimestamp(),
    voidedBy: actorId,
    voidReason: "Excluída pelo usuário",
    updatedAt: serverTimestamp(),
  });
};
