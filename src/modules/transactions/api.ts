import {
  collection,
  documentId,
  DocumentData,
  getDocs,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  QueryDocumentSnapshot,
  startAfter,
  where
} from "firebase/firestore";

import { db } from "../../lib/firebase";
import type { Transaction, TransactionType } from "../../types";
import { saoPauloMonthsAgo } from "./cashEntry";
import { monthDateRange, readFirstAccepted, readPagedWindow } from "./paging";
import { normalizeTransactionData } from "./contract";

const txCol = (workspaceId: string) =>
  collection(db, "workspaces", workspaceId, "transactions");

function assertValidWorkspaceId(workspaceId: string | undefined): asserts workspaceId is string {
  if (!workspaceId || workspaceId === "loading") {
    throw new Error("Workspace ID inválido para operações de transação.");
  }
}

export const isVoidedTransaction = (data: DocumentData): boolean =>
  data?.voidedAt !== undefined && data?.voidedAt !== null;

const normalizeTransaction = (
  snapshot: QueryDocumentSnapshot<DocumentData>
): Transaction | null =>
  normalizeTransactionData(snapshot.id, snapshot.data(), snapshot.ref.parent.parent?.id);

/**
 * Janela de "Transações Recentes" do Dashboard, em meses: o widget mostra as
 * mais recentes com `date` a partir do mesmo dia de 12 meses atrás, em São
 * Paulo (o mesmo recorte da antiga carga do aplicativo, P5-GATE-FINAL,
 * FIRESTORE-01).
 */
export const DEFAULT_TRANSACTION_WINDOW_MONTHS = 12;

/** Teto de documentos por página. Toda consulta do módulo o respeita. */
export const TRANSACTION_PAGE_SIZE = 500;

/**
 * Teto de páginas da lista de um mês (até 20.000 lançamentos de um tipo no
 * mês). Existe para que um defeito de cursor vire erro visível em vez de laço,
 * e para que o custo de uma carga seja limitado; acima dele, a lista volta
 * marcada como truncada e a tela avisa.
 */
export const MAX_TRANSACTION_PAGES = 40;

/** Quantas "Transações Recentes" o Dashboard mostra. */
export const RECENT_TRANSACTIONS_COUNT = 9;

/** Página da consulta das recentes: as 9 mais uma folga para anuladas. */
export const RECENT_TRANSACTIONS_PAGE_SIZE = 10;

/** Teto de páginas das recentes (até 100 documentos lidos por carga). */
export const RECENT_TRANSACTIONS_MAX_PAGES = 10;

export interface TransactionPage {
  items: Transaction[];
  /**
   * A janela pedida não coube no teto de páginas. O consumidor precisa dizer
   * isso ao usuário: silenciar seria apresentar um agregado incompleto como
   * se fosse o total.
   */
  truncated: boolean;
  /**
   * Documentos fora do contrato (sem `valueCents` inteiro, com `date` textual
   * inválido ou com `type` desconhecido) excluídos da lista. A tela precisa
   * avisar: um lançamento inválido nunca vira R$ 0,00.
   *
   * Cobertura (P5-C2 L-4): só conta o que a consulta devolveu (na lista do
   * mês, os documentos do tipo e do mês pedidos). Documento sem `date` ou
   * com `date` não textual nem volta da consulta ordenada (o Firestore o omite
   * do filtro e da ordenação por string) e não entra aqui; quem o detecta é o
   * gatilho do caixa, que registra `contract_violation` e marca a projeção
   * para reconstrução. Varredura da coleção inteira no cliente está fora de
   * questão; a conferência completa é o detector de deriva da P7 (PR-TX-04).
   */
  invalidCount: number;
}

/** Início da janela como data civil `YYYY-MM-DD` de São Paulo, o formato do campo `date`. */
const monthsAgoDateOnly = (months: number): string => saoPauloMonthsAgo(months);

/** O lançamento que a tela mostra, ou `null` para o anulado e o fora do contrato. */
const acceptListed = (document: QueryDocumentSnapshot<DocumentData>): Transaction | null =>
  isVoidedTransaction(document.data()) ? null : normalizeTransaction(document);

export interface RecentTransactions {
  /** As mais recentes, em `date` desc e id desc, no máximo `RECENT_TRANSACTIONS_COUNT`. */
  items: Transaction[];
  /**
   * O teto de páginas acabou antes de juntar as 9 (anuladas ou fora do
   * contrato demais entre as mais recentes): a tela avisa que a lista não é a
   * das 9 mais recentes.
   */
  truncated: boolean;
}

/**
 * "Transações Recentes" do Dashboard (P5-GATE-FINAL, FIRESTORE-01): só as 9
 * mais recentes, do tipo escolhido no filtro do widget (ou de todos), com
 * `date` na janela de `DEFAULT_TRANSACTION_WINDOW_MONTHS` meses.
 *
 * Antes, a carga do aplicativo lia a janela inteira de 12 meses (até 40
 * páginas de 500, 20.000 documentos) em qualquer tela e a cada mutação, para
 * o widget mostrar 9 itens. Agora a consulta é a ordem do próprio widget
 * (`date` desc, id desc, a mesma ordem estável de antes), em páginas de 10
 * por cursor: anulados e documentos fora do contrato são pulados e a leitura
 * continua até juntar as 9, com teto de 10 páginas.
 *
 * Índices: sem filtro de tipo, o índice simples de `date`; com filtro,
 * `transactions` (`type`, `date` desc, `__name__` desc).
 */
export const getRecentTransactions = async (
  workspaceId: string,
  type: TransactionType | null,
): Promise<RecentTransactions> => {
  assertValidWorkspaceId(workspaceId);
  const since = monthsAgoDateOnly(DEFAULT_TRANSACTION_WINDOW_MONTHS);
  const { items, truncated } = await readFirstAccepted<QueryDocumentSnapshot<DocumentData>, Transaction>(
    async (after, limitCount) => (await getDocs(query(
      txCol(workspaceId),
      ...(type ? [where("type", "==", type)] : []),
      where("date", ">=", since),
      orderBy("date", "desc"),
      orderBy(documentId(), "desc"),
      ...(after ? [startAfter(after)] : []),
      limit(limitCount),
    ))).docs,
    acceptListed,
    RECENT_TRANSACTIONS_COUNT,
    RECENT_TRANSACTIONS_PAGE_SIZE,
    RECENT_TRANSACTIONS_MAX_PAGES,
  );
  return { items, truncated };
};

/** Teto das consultas `in` por id do Firestore. */
export const TRANSACTION_ID_BATCH = 30;

/**
 * Lançamentos por id, inclusive anulados (o chamador decide o que contam).
 * Até `TRANSACTION_ID_BATCH` ids por consulta; ids repetidos são lidos uma
 * vez. As Rules exigem membership no workspace. Sempre do servidor
 * (`getDocsFromServer`): sem rede, a leitura falha em vez de devolver o cache
 * local, que pode não ter os documentos e faria todos parecerem inexistentes
 * (P5-F.1-R1, revisão: N04; quem usa é a estimativa do tempo de trabalho, que
 * mostra a falha com "Tentar de novo").
 */
export const getTransactionsByIds = async (
  workspaceId: string,
  ids: readonly string[],
): Promise<{ found: Transaction[]; missing: string[]; raw: Record<string, DocumentData> }> => {
  assertValidWorkspaceId(workspaceId);
  const unique = [...new Set(ids)];
  const found: Transaction[] = [];
  // P5-F.1-R3 (B03): o conteúdo bruto de cada encontrado, como o servidor o guardou (antes de normalizar),
  // para quem precisa conferir qual conteúdo a projeção oficial contém.
  const raw: Record<string, DocumentData> = {};
  for (let start = 0; start < unique.length; start += TRANSACTION_ID_BATCH) {
    const chunk = unique.slice(start, start + TRANSACTION_ID_BATCH);
    const snapshot = await getDocsFromServer(query(txCol(workspaceId), where(documentId(), "in", chunk)));
    snapshot.docs.forEach((document) => {
      const transaction = normalizeTransaction(document);
      if (!transaction) return;
      found.push(transaction);
      raw[document.id] = document.data();
    });
  }
  const foundIds = new Set(found.map((transaction) => transaction.id));
  return { found, missing: unique.filter((id) => !foundIds.has(id)), raw };
};

/** Teto de páginas da janela de receitas (2.000 receitas). */
export const INCOME_WINDOW_MAX_PAGES = 4;

const pagedWindow = async (
  workspaceId: string,
  filter: ReturnType<typeof where>,
  since: string,
  until: string,
  maxPages: number,
): Promise<TransactionPage> => {
  // Páginas de TRANSACTION_PAGE_SIZE com um documento a mais de sonda (`readPagedWindow`): janela
  // com exatamente `maxPages` páginas cheias não é marcada como truncada.
  const { docs, truncated } = await readPagedWindow<QueryDocumentSnapshot<DocumentData>>(
    async (after, limitCount) => (await getDocs(query(
      txCol(workspaceId),
      filter,
      where("date", ">=", since),
      where("date", "<=", until),
      orderBy("date", "desc"),
      orderBy(documentId(), "desc"),
      ...(after ? [startAfter(after)] : []),
      limit(limitCount),
    ))).docs,
    TRANSACTION_PAGE_SIZE,
    maxPages,
  );
  const items: Transaction[] = [];
  let invalidCount = 0;
  docs.forEach((document) => {
    if (isVoidedTransaction(document.data())) return;
    const transaction = normalizeTransaction(document);
    if (transaction) items.push(transaction);
    else invalidCount += 1;
  });
  return { items, truncated, invalidCount };
};

/**
 * Receitas de uma janela de datas civis (`since` a `until`, inclusive), para
 * conferência item a item: os lançamentos `receita` e os estornos de
 * recebimento (gravados como `despesa`, com `receivableEntry.reversal`), que
 * tiram receita do mês. Anulados não voltam. Com mais de
 * `INCOME_WINDOW_MAX_PAGES` páginas, volta marcada como truncada.
 *
 * Índices: `transactions` (`type`, `date` desc, `__name__` desc) e
 * (`receivableEntry.reversal`, `date` desc, `__name__` desc).
 */
export const getIncomeWindow = async (
  workspaceId: string,
  since: string,
  until: string,
): Promise<TransactionPage> => {
  assertValidWorkspaceId(workspaceId);
  const [receipts, reversals] = await Promise.all([
    pagedWindow(workspaceId, where("type", "==", "receita"), since, until, INCOME_WINDOW_MAX_PAGES),
    pagedWindow(workspaceId, where("receivableEntry.reversal", "==", true), since, until, 1),
  ]);
  return {
    items: [...receipts.items, ...reversals.items]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1)),
    truncated: receipts.truncated || reversals.truncated,
    invalidCount: receipts.invalidCount + reversals.invalidCount,
  };
};

/**
 * Lançamentos de um tipo no mês escolhido no Header (P5-GATE-FINAL,
 * FIRESTORE-01): a lista de Receitas ou de Despesas.
 *
 * Antes, a lista filtrava no navegador a janela de 12 meses carregada com o
 * aplicativo (e um mês mais antigo que a janela aparecia vazio). Agora a
 * consulta é só do mês e do tipo pedidos, em `date` desc e id desc, por cursor
 * em páginas de 500, até o fim do mês: a busca, os filtros, o total, a média e
 * a ordenação por coluna da tela continuam sobre o conjunto completo do mês.
 * Acima de `MAX_TRANSACTION_PAGES` páginas, volta marcada como truncada e a
 * tela avisa. Anulados não voltam; fora do contrato entram em `invalidCount`.
 *
 * Índice: `transactions` (`type`, `date` desc, `__name__` desc).
 */
export const getMonthTransactions = async (
  workspaceId: string,
  monthKey: string,
  type: "receita" | "despesa",
): Promise<TransactionPage> => {
  assertValidWorkspaceId(workspaceId);
  const { since, until } = monthDateRange(monthKey);
  return pagedWindow(workspaceId, where("type", "==", type), since, until, MAX_TRANSACTION_PAGES);
};
