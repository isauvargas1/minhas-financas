import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  AI_CALLABLES,
  AI_CREDITS_EXHAUSTED_MESSAGE,
  createAiCallables,
  isAiCreditsExhausted,
  type AiCallableName,
} from '../../src/modules/ai/callables.ts';
import { readFileAsBase64 } from '../../src/modules/ai/documentFile.ts';

/**
 * Contrato cliente das callables de IA (P2B.2, PR-AI-03).
 *
 * Amarra o cliente ao backend sem subir o Firebase: payload real de cada
 * wrapper contra as chaves dos schemas do backend, chave de idempotência nova
 * por ação, mensagem de créditos esgotados e guardas estáticas (peso em
 * créditos, modelo, teto de tokens e credencial ficam só no servidor).
 */
const backendAi = readFileSync(
  new URL('../../functions/src/ai/callables.ts', import.meta.url),
  'utf8',
);
const backendQuota = readFileSync(
  new URL('../../functions/src/billing/quota.ts', import.meta.url),
  'utf8',
);

const between = (text: string, start: string, end: string): string => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `bloco ${start} não encontrado`);
  return text.slice(from, to);
};

const keysAt = (block: string, indent: number): string[] =>
  [...block.matchAll(new RegExp(`^ {${indent}}(\\w+):`, 'gm'))]
    .map((entry) => entry[1])
    .sort();

const analysisKeys = keysAt(
  between(backendAi, 'export const analysisPayloadSchema', 'type AnalysisPayload'),
  4,
);
const extractionVariants = between(
  backendAi,
  'export const extractionPayloadSchema',
  'const EXTRACTION_INSTRUCTION',
).split('z.object({').slice(1).map((variant) => keysAt(variant, 6));

const recorder = () => {
  const calls: Array<{ name: AiCallableName; payload: Record<string, unknown> }> = [];
  const callables = createAiCallables(async <T,>(
    name: AiCallableName,
    payload: Record<string, unknown>,
  ) => {
    calls.push({ name, payload });
    return {} as T;
  });
  return { calls, callables };
};

const context = {
  profileType: 'PF' as const,
  periodLabel: 'Últimos 30 dias',
  kpis: [{ label: 'Receitas', formattedValue: 'R$ 5.000,00' }],
  topCategories: ['Moradia (40.0%)'],
  alerts: [],
};

test('as callables de IA do backend têm wrapper, e só elas', () => {
  const exported = [...backendAi.matchAll(/^ {2}(\w+): defineCallable\(/gm)]
    .map((entry) => entry[1])
    .sort();
  assert.deepEqual([...AI_CALLABLES].sort(), exported);
});

test('cada wrapper envia exatamente as chaves do schema, com idempotencyKey', async () => {
  assert.deepEqual(analysisKeys, ['context', 'idempotencyKey', 'question', 'workspaceId']);
  assert.deepEqual(extractionVariants, [
    ['idempotencyKey', 'kind', 'transcript', 'workspaceId'],
    ['dataBase64', 'idempotencyKey', 'kind', 'mimeType', 'workspaceId'],
  ]);
  const { calls, callables } = recorder();
  await callables.analyzeFinancialQuestion({ workspaceId: 'ws-1', question: 'Como estou?', context });
  await callables.extractTransactionFromText({ workspaceId: 'ws-1', transcript: 'Almoço de 45' });
  await callables.extractTransactionFromDocument({
    workspaceId: 'ws-1',
    mimeType: 'image/png',
    dataBase64: 'iVBORw0KGgo=',
  });
  assert.deepEqual(calls.map((call) => call.name), [
    'analyzeFinancialQuestion',
    'extractTransactionFromContent',
    'extractTransactionFromContent',
  ]);
  assert.deepEqual(Object.keys(calls[0].payload).sort(), analysisKeys);
  assert.deepEqual(Object.keys(calls[1].payload).sort(), extractionVariants[0]);
  assert.deepEqual(Object.keys(calls[2].payload).sort(), extractionVariants[1]);
  assert.equal(calls[1].payload.kind, 'text');
  assert.equal(calls[2].payload.kind, 'document');
  for (const { payload } of calls) {
    assert.ok(Object.values(payload).every((value) => value !== undefined));
    // Nada de custo, modelo ou limite enviado pelo cliente.
    for (const forbidden of ['creditCost', 'model', 'maxOutputTokens', 'planId']) {
      assert.equal(forbidden in payload, false, forbidden);
    }
  }
});

test('chave de idempotência nova a cada ação intencional', async () => {
  const { calls, callables } = recorder();
  const input = { workspaceId: 'ws-1', question: 'Mesma pergunta?', context };
  await callables.analyzeFinancialQuestion(input);
  await callables.analyzeFinancialQuestion(input);
  await callables.extractTransactionFromText({ workspaceId: 'ws-1', transcript: 'Almoço' });
  await callables.extractTransactionFromText({ workspaceId: 'ws-1', transcript: 'Almoço' });
  const keys = calls.map((call) => call.payload.idempotencyKey);
  for (const key of keys) {
    assert.equal(typeof key, 'string');
    assert.ok(String(key).length >= 8);
    assert.equal(String(key).includes('/'), false);
  }
  assert.equal(new Set(keys).size, keys.length, 'chave reaproveitada entre ações');
});

test('créditos esgotados: resource-exhausted tem mensagem própria, igual à do backend', () => {
  assert.equal(
    AI_CREDITS_EXHAUSTED_MESSAGE,
    'Os créditos de IA deste plano acabaram neste mês. Faça upgrade ou aguarde a renovação mensal.',
  );
  // O texto do cliente é o mesmo que o backend escreve no erro de quota.
  const backendMessage = between(backendQuota, 'export const AI_CREDITS_EXHAUSTED_MESSAGE', ';')
    .match(/"([^"]*)"/g)
    ?.map((part) => part.slice(1, -1))
    .join('');
  assert.equal(backendMessage, AI_CREDITS_EXHAUSTED_MESSAGE);
  assert.equal(isAiCreditsExhausted({ code: 'functions/resource-exhausted' }), true);
  for (const error of [
    { code: 'functions/failed-precondition' },
    { code: 'functions/internal' },
    { code: 'resource-exhausted' },
    new Error('functions/resource-exhausted'),
    null,
    undefined,
    'functions/resource-exhausted',
  ]) {
    assert.equal(isAiCreditsExhausted(error), false, String(error));
  }
});

// --- Guardas estáticas -----------------------------------------------------

const srcRoot = fileURLToPath(new URL('../../src', import.meta.url));
const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
const sourceFiles = listFiles(srcRoot).filter((path) => /\.(ts|tsx)$/.test(path));
const read = (path: string) => readFileSync(path, 'utf8');

test('análise e extração usam só os wrappers com chave; quota tem mensagem clara', () => {
  const direct = sourceFiles.filter((path) =>
    !path.includes(join('modules', 'ai')) &&
    /['"](analyzeFinancialQuestion|extractTransactionFromContent)['"]/.test(read(path)));
  assert.deepEqual(direct, [], 'chamada de IA fora do contrato');
  const reports = read(join(srcRoot, 'modules', 'reports', 'api.ts'));
  assert.match(reports, /await analyzeFinancialQuestion\(\{/);
  assert.match(reports, /isAiCreditsExhausted\(error\)\s*\?\s*AI_CREDITS_EXHAUSTED_MESSAGE/);
  const modal = read(join(srcRoot, 'components', 'TransactionModal.tsx'));
  assert.match(modal, /await extractTransactionFromDocument\(\{/);
  assert.match(modal, /await extractTransactionFromText\(\{/);
  assert.match(modal, /exhausted \? AI_CREDITS_EXHAUSTED_MESSAGE : fallback/);
  assert.equal(/httpsCallable/.test(modal), false);
});

test('peso em créditos, modelo, teto de tokens e credencial não existem no cliente', () => {
  const offenders = sourceFiles.filter((path) =>
    /AI_CREDIT_COSTS|creditCost|maxOutputTokens|gemini-|GOOGLE_AI_API_KEY|generativelanguage/
      .test(read(path)));
  assert.deepEqual(offenders, []);
});

test('contenção (functions/aborted) é erro de negócio com a mensagem do backend', () => {
  const errors = read(join(srcRoot, 'modules', 'workspaces', 'errors.ts'));
  const codes = /const BUSINESS_CODES = new Set\(\[([\s\S]*?)\]\);/.exec(errors);
  assert.ok(codes, 'BUSINESS_CODES');
  assert.match(codes[1], /'functions\/aborted'/);
  assert.equal(/'functions\/internal'/.test(codes[1]), false);
});

// --- Comprovante: leitura aguardada e carregamento até o fim --------------

/** `FileReader` falso: o teste decide quando a leitura termina. */
class FakeReader {
  result: string | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  started: Blob | null = null;
  readAsDataURL(file: Blob) {
    this.started = file;
  }
}

const readWith = (reader: FakeReader, file = new Blob(['comprovante'])) =>
  readFileAsBase64(file, () => reader as unknown as FileReader);

test('leitura do comprovante é uma Promise que só resolve no fim da leitura', async () => {
  const reader = new FakeReader();
  const file = new Blob(['comprovante']);
  let settled = false;
  const pending = readWith(reader, file).then((value) => {
    settled = true;
    return value;
  });
  assert.equal(reader.started, file);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false, 'resolveu antes do onload');
  reader.result = 'data:image/png;base64,QUJDRA==';
  reader.onload?.();
  assert.equal(await pending, 'QUJDRA==');
});

test('erro, cancelamento e arquivo vazio rejeitam a leitura do comprovante', async () => {
  const failing = new FakeReader();
  const failed = readWith(failing);
  failing.error = new Error('NotReadableError');
  failing.onerror?.();
  await assert.rejects(failed, /NotReadableError/);

  const aborted = new FakeReader();
  const abortedRead = readWith(aborted);
  aborted.onabort?.();
  await assert.rejects(abortedRead, /document_file_read_aborted/);

  const empty = new FakeReader();
  const emptyRead = readWith(empty);
  empty.result = 'data:,';
  empty.onload?.();
  await assert.rejects(emptyRead, /document_file_empty/);
});

test('comprovante: carregamento e botões de IA só voltam depois da leitura e da chamada', () => {
  const modal = read(join(srcRoot, 'components', 'TransactionModal.tsx'));
  assert.equal(/\.onload\s*=\s*async/.test(modal), false, 'onload assíncrono solto');
  const handler = modal.slice(
    modal.indexOf('const handleFileUpload'),
    modal.indexOf('// --- AI LOGIC: Voice Entry ---'),
  );
  const steps = [
    'setIsAILoading(true);',
    'try {',
    'await readFileAsBase64(file);',
    'await extractTransactionFromDocument({',
    '} catch (error) {',
    'showAIError(error, "Erro ao analisar documento.");',
    '} finally {',
    'setIsAILoading(false);',
    "if (fileInputRef.current) fileInputRef.current.value = '';",
  ];
  let cursor = -1;
  for (const step of steps) {
    const index = handler.indexOf(step, cursor + 1);
    assert.ok(index > cursor, `ausente ou fora de ordem: ${step}`);
    cursor = index;
  }
  // Nenhum outro ponto libera o carregamento ou limpa o input antes do fim.
  assert.equal(handler.split('setIsAILoading(false)').length - 1, 1);
  assert.equal(handler.split("fileInputRef.current.value = ''").length - 1, 1);
  assert.equal(/new FileReader\(/.test(handler), false);
  // Os dois botões (comprovante e voz) seguem presos ao mesmo estado.
  assert.equal((modal.match(/disabled=\{isAILoading\}/g) ?? []).length, 2);
});
