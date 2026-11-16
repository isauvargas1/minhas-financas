/**
 * Leitura de uma janela paginada por cursor (P5-F.1), sem SDK: a função que
 * lê uma página é injetada (`getIncomeWindow` liga o Firestore; os testes,
 * uma lista em memória).
 *
 * Cada página pede um documento a mais que o tamanho (`pageSize + 1`) só para
 * saber se há mais: só a página, sem o documento de sonda, é usada, e o
 * cursor é o último dela. Uma janela com exatamente `maxPages` páginas cheias
 * não é marcada como truncada; com mais, `truncated` é verdadeiro e só as
 * `maxPages` páginas voltam.
 */
export const readPagedWindow = async <D>(
  readPage: (after: D | undefined, limitCount: number) => Promise<readonly D[]>,
  pageSize: number,
  maxPages: number,
): Promise<{ docs: D[]; truncated: boolean }> => {
  const docs: D[] = [];
  let cursor: D | undefined;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const read = await readPage(cursor, pageSize + 1);
    const page = read.slice(0, pageSize);
    docs.push(...page);
    if (read.length <= pageSize) return { docs, truncated: false };
    cursor = page[page.length - 1];
  }
  return { docs, truncated: true };
};

/**
 * Os primeiros `wanted` documentos aceitos de uma consulta ordenada, lidos por cursor em páginas de `pageSize`
 * (P5-GATE-FINAL, FIRESTORE-01: "Transações Recentes" do Dashboard). `accept` devolve o item ou `null` para o
 * documento que não entra (anulado, fora do contrato), e a leitura continua até juntar `wanted` itens ou a
 * consulta acabar. Com `maxPages` páginas cheias lidas sem juntar `wanted`, volta `truncated: true`: o
 * consumidor diz isso em vez de apresentar a lista curta como se fosse a completa. `reads` é o total de
 * documentos devolvidos pelas consultas (o que o Firestore cobra).
 */
export const readFirstAccepted = async <D, T>(
  readPage: (after: D | undefined, limitCount: number) => Promise<readonly D[]>,
  accept: (document: D) => T | null,
  wanted: number,
  pageSize: number,
  maxPages: number,
): Promise<{ items: T[]; skipped: number; truncated: boolean; reads: number }> => {
  const items: T[] = [];
  let skipped = 0;
  let reads = 0;
  let cursor: D | undefined;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await readPage(cursor, pageSize);
    reads += page.length;
    for (const document of page) {
      const item = accept(document);
      if (item === null) {
        skipped += 1;
        continue;
      }
      items.push(item);
      if (items.length === wanted) return { items, skipped, truncated: false, reads };
    }
    if (page.length < pageSize) return { items, skipped, truncated: false, reads };
    cursor = page[page.length - 1];
  }
  return { items, skipped, truncated: true, reads };
};

/**
 * Mês `AAAA-MM` (o do Header) como intervalo de datas civis do campo `date` (`AAAA-MM-DD`, ordenável como
 * texto): do dia 01 ao 31. Todo dia válido do mês cabe no intervalo e nenhum dia de outro mês cabe; um texto
 * que não é dia válido (`AAAA-02-30`) volta da consulta e a normalização o recusa (conta como inconsistente).
 */
export const monthDateRange = (monthKey: string): { since: string; until: string } => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    throw new Error('Mês inválido para a lista de lançamentos.');
  }
  return { since: `${monthKey}-01`, until: `${monthKey}-31` };
};
