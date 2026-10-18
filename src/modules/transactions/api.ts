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
import { saoPauloMonthsAgo } from "./cashEntry";
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
  /**
   * Documentos fora do contrato (sem `valueCents` inteiro, com `date` textual
   * inválido ou com `type` desconhecido) excluídos da lista. A tela precisa
   * avisar: um lançamento inválido nunca vira R$ 0,00.
   *
   * Cobertura (P5-C2 L-4): só conta o que a consulta da janela devolveu, e a
   * contagem é da janela inteira, não do mês exibido. Documento sem `date` ou
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
 * janela é feito por ela. `transactionDate` (instante) saiu do contrato na
 * P5-C2 (PR-TX-03); o Firestore omite da consulta ordenada todo documento sem
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
  let invalidCount = 0;
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
      const transaction = normalizeTransaction(document);
      if (transaction) items.push(transaction);
      else invalidCount += 1;
    });
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < TRANSACTION_PAGE_SIZE) {
      truncated = false;
      break;
    }
  }

  return { items, truncated, invalidCount };
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
    invalidCount: page.invalidCount,
  };
};
