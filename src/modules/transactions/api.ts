import {
  collection,
  documentId,
  DocumentData,
  getDocs,
  limit,
  orderBy,
  query,
  QueryDocumentSnapshot,
  startAfter,
  where
} from "firebase/firestore";

import { db } from "../../lib/firebase";
import type { Transaction } from "../../types";
import { toDateOnlyString } from "../../utils/date";

const txCol = (workspaceId: string) =>
  collection(db, "workspaces", workspaceId, "transactions");

function assertValidWorkspaceId(workspaceId: string | undefined): asserts workspaceId is string {
  if (!workspaceId || workspaceId === "loading") {
    throw new Error("Workspace ID inválido para operações de transação.");
  }
}

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
    workspaceId: data.workspaceId ?? snapshot.ref.parent.parent?.id
  };
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
 * A ordenação é pelo campo `date` (`YYYY-MM-DD`), com cursor. Pelo contrato
 * atual, todo produtor do backend grava `date` em todo lançamento: é a data
 * civil em America/Sao_Paulo, lexicograficamente ordenável, e o recorte por
 * janela é feito por ela. **Não** por `transactionDate`: é a segunda
 * representação da mesma data (instante), que sai com a fórmula única
 * (PR-TX-03, P5), e o Firestore omite da consulta ordenada todo documento sem
 * o campo usado na ordenação.
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
 * Janela padrão do aplicativo: os últimos `months` meses pela data civil
 * `date`, com o mesmo teto de páginas e o sinal de truncamento da janela.
 */
export const getTransactions = async (
  workspaceId: string,
  months = DEFAULT_TRANSACTION_WINDOW_MONTHS,
): Promise<TransactionPage> => {
  const page = await getTransactionWindow(workspaceId, {
    since: monthsAgoDateOnly(months),
  });
  /*
   * O sinal de truncamento era descartado aqui.
   *
   * A faixa "tudo" do relatório já avisava quando o teto de páginas era
   * atingido, mas a janela padrão — que alimenta painel, metas, alocações e
   * relatórios de período — devolvia só o array e perdia a informação. Um
   * workspace acima do teto veria agregados incompletos apresentados como
   * totais, sem nada na tela dizendo isso.
   */
  return {
    items: page.items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    truncated: page.truncated,
  };
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
