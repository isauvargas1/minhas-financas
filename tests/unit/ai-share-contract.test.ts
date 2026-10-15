import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Correspondência aviso x payload do consultor de IA (P5-E1.1).
 *
 * O diálogo de confirmação descreve o que sai para o Google. Estas guardas
 * estáticas amarram o aviso ao contexto realmente montado no backend: sem
 * nomes de categorias, só grupos de despesas pela posição, e sem promessas
 * que o produto não consegue comprovar.
 */

const dialog = readFileSync(
  new URL('../../src/components/AiShareConsentDialog.tsx', import.meta.url),
  'utf8',
);
const analysisContext = readFileSync(
  new URL('../../functions/src/ai/analysisContext.ts', import.meta.url),
  'utf8',
);

test('diálogo de análise descreve o resumo agregado e a pergunta digitada', () => {
  for (const text of [
    'grupos de despesas',
    'Grupo de despesas 1',
    'não inclui os nomes das categorias',
    'nomes de clientes',
    'descrições de lançamentos',
    'identificadores internos',
    'A pergunta que você digitou vai inteira',
    'Cada envio usa 1 crédito de IA',
  ]) {
    assert.ok(dialog.includes(text), text);
  }
});

test('diálogo não faz promessas não comprovadas', () => {
  for (const forbidden of [
    /anonimizad/i,
    /Nenhum dado pessoal/i,
    /nunca saem/i,
    /não armazena/i,
    /exclusivamente nacional/i,
  ]) {
    assert.equal(forbidden.test(dialog), false, String(forbidden));
  }
});

test('contexto enviado ao Google identifica despesas só pela posição, sem nomes de categorias', () => {
  assert.match(analysisContext, /Grupo de despesas/);
  assert.match(analysisContext, /\bgrupo\b/);
  assert.equal(/\bnome:/.test(analysisContext), false, 'chave nome: no contexto');
  assert.equal(/item\.name/.test(analysisContext), false, 'item.name no contexto');
  assert.equal(/categoryKey/.test(analysisContext), false, 'categoryKey no contexto');
});
