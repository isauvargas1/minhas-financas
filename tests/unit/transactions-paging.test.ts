import assert from 'node:assert/strict';
import test from 'node:test';

import { readPagedWindow } from '../../src/modules/transactions/paging.ts';

/**
 * P5-F.1 — janela de receitas paginada por cursor (`readPagedWindow`, usada
 * por `getIncomeWindow`): um documento a mais por página só para saber se há
 * mais, o cursor no último da página e o teto de páginas. A suíte de Rules
 * confere a mesma forma de consulta no Emulator.
 */

const PAGE = 500;
const MAX_PAGES = 4;

/** Lista ordenada em memória; registra cada leitura (cursor e limite). */
const source = (total: number) => {
  const all = Array.from({ length: total }, (_, index) => `doc-${String(index).padStart(5, '0')}`);
  const reads: Array<{ after: string | undefined; limitCount: number }> = [];
  const readPage = async (after: string | undefined, limitCount: number) => {
    reads.push({ after, limitCount });
    const start = after === undefined ? 0 : all.indexOf(after) + 1;
    return all.slice(start, start + limitCount);
  };
  return { all, reads, readPage };
};

for (const [total, expected, truncated, pages] of [
  [0, 0, false, 1],
  [PAGE, PAGE, false, 1],
  [PAGE + 1, PAGE + 1, false, 2],
  [PAGE * MAX_PAGES, PAGE * MAX_PAGES, false, MAX_PAGES],
  [PAGE * MAX_PAGES + 1, PAGE * MAX_PAGES, true, MAX_PAGES],
] as const) {
  test(`${total} documentos: ${expected} lidos em ${pages} ${pages === 1 ? 'página' : 'páginas'}, ${truncated ? 'truncada' : 'completa'}`, async () => {
    const { all, reads, readPage } = source(total);
    const result = await readPagedWindow(readPage, PAGE, MAX_PAGES);
    assert.equal(result.docs.length, expected);
    assert.equal(result.truncated, truncated);
    assert.deepEqual(result.docs, all.slice(0, expected), 'em ordem, sem repetir nem pular');
    assert.equal(reads.length, pages);
    assert.ok(reads.every((read) => read.limitCount === PAGE + 1), 'cada página pede um documento a mais');
    // O cursor de cada página seguinte é o último da página anterior (nunca o documento de sonda).
    reads.slice(1).forEach((read, index) => assert.equal(read.after, all[(index + 1) * PAGE - 1]));
    assert.equal(reads[0].after, undefined);
  });
}
