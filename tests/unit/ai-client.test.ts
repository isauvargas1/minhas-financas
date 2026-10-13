import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  AI_CALLABLES,
  AI_CLIENT_TIMEOUT_MS,
  AI_CREDITS_EXHAUSTED_MESSAGE,
  AI_RETRY_ALREADY_PROCESSED_MESSAGE,
  AI_GENERIC_ERROR_MESSAGE,
  AI_PERMISSION_DENIED_MESSAGE,
  AI_PROVIDER_CONSENT_VERSION,
  aiCreditsExhaustedMessage,
  aiErrorMessage,
  createAiCallables,
  isAiCreditsExhausted,
  isAiTransportFailure,
  providerConsent,
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
  'type ExtractionPayload',
).split('z.object({').slice(1).map((variant) => keysAt(variant, 6));

const recorder = () => {
  const calls: Array<{ name: AiCallableName; payload: Record<string, unknown> }> = [];
  const callables = createAiCallables(async <T,>(
    name: AiCallableName,
    payload: Record<string, unknown>,
  ) => {
    calls.push({ name, payload });
    return {} as T;
  }, { wait: async () => {} });
  return { calls, callables };
};

const range = { kind: 'preset' as const, preset: '30d' as const };

test('as callables de IA do backend têm wrapper, e só elas', () => {
  const exported = [...backendAi.matchAll(/^ {2}(\w+): defineCallable\(/gm)]
    .map((entry) => entry[1])
    .sort();
  assert.deepEqual([...AI_CALLABLES].sort(), exported);
});

test('cada wrapper envia exatamente as chaves do schema, com a chave do chamador e a confirmação', async () => {
  assert.deepEqual(analysisKeys, [
    'idempotencyKey', 'providerConsent', 'question', 'range', 'workspaceId',
  ]);
  assert.deepEqual(extractionVariants, [
    ['idempotencyKey', 'kind', 'providerConsent', 'transcript', 'workspaceId'],
    ['dataBase64', 'idempotencyKey', 'kind', 'mimeType', 'providerConsent', 'workspaceId'],
  ]);
  const { calls, callables } = recorder();
  await callables.analyzeFinancialQuestion({
    workspaceId: 'ws-1', question: 'Como estou?', range, idempotencyKey: 'chave-analise-1',
  });
  await callables.extractTransactionFromText({
    workspaceId: 'ws-1', transcript: 'Almoço de 45', idempotencyKey: 'chave-texto-1',
  });
  await callables.extractTransactionFromDocument({
    workspaceId: 'ws-1',
    mimeType: 'image/png',
    dataBase64: 'iVBORw0KGgo=',
    idempotencyKey: 'chave-documento-1',
  });
  assert.deepEqual(calls.map((call) => call.name), [
    'analyzeFinancialQuestion',
    'extractTransactionFromContent',
    'extractTransactionFromContent',
  ]);
  assert.deepEqual(Object.keys(calls[0].payload).sort(), analysisKeys);
  assert.deepEqual(Object.keys(calls[1].payload).sort(), extractionVariants[0]);
  assert.deepEqual(Object.keys(calls[2].payload).sort(), extractionVariants[1]);
  assert.deepEqual(calls[0].payload, {
    workspaceId: 'ws-1',
    idempotencyKey: 'chave-analise-1',
    question: 'Como estou?',
    range: { kind: 'preset', preset: '30d' },
    providerConsent: { version: 'ai-provider-share-v1', operation: 'analysis', confirmed: true },
  });
  assert.equal(calls[1].payload.kind, 'text');
  assert.equal(calls[2].payload.kind, 'document');
  assert.deepEqual(calls[1].payload.providerConsent, {
    version: 'ai-provider-share-v1', operation: 'extraction_text', confirmed: true,
  });
  assert.deepEqual(calls[2].payload.providerConsent, {
    version: 'ai-provider-share-v1', operation: 'extraction_document', confirmed: true,
  });
  assert.deepEqual(calls.map((call) => call.payload.idempotencyKey), [
    'chave-analise-1', 'chave-texto-1', 'chave-documento-1',
  ]);
  for (const { payload } of calls) {
    assert.ok(Object.values(payload).every((value) => value !== undefined));
    // Nada de custo, modelo ou limite enviado pelo cliente.
    for (const forbidden of ['creditCost', 'model', 'maxOutputTokens', 'planId']) {
      assert.equal(forbidden in payload, false, forbidden);
    }
  }
});

test('a análise não envia nenhum campo financeiro, de perfil, papel ou usuário', async () => {
  const { calls, callables } = recorder();
  await callables.analyzeFinancialQuestion({
    workspaceId: 'ws-1',
    question: 'Como estou?',
    range: { kind: 'month', month: '2026-09' },
    idempotencyKey: 'chave-analise-2',
  });
  const payload = calls[0].payload;
  for (const forbidden of [
    'context', 'kpis', 'topCategories', 'alerts', 'profileType', 'workspaceType',
    'role', 'uid', 'userId', 'periodLabel',
  ]) {
    assert.equal(forbidden in payload, false, forbidden);
  }
  assert.deepEqual(payload.range, { kind: 'month', month: '2026-09' });
  // Nenhum número monetário trafega: o servidor lê o relatório oficial.
  const serialized = JSON.stringify(payload);
  assert.equal(/R\$|\d+[.,]\d{2}\b/.test(serialized.replace(/2026-09/g, '')), false);
});

test('a confirmação de envio é versionada e coerente com a operação', () => {
  assert.equal(AI_PROVIDER_CONSENT_VERSION, 'ai-provider-share-v1');
  for (const operation of ['analysis', 'extraction_text', 'extraction_document'] as const) {
    assert.deepEqual(providerConsent(operation), {
      version: 'ai-provider-share-v1', operation, confirmed: true,
    });
  }
  const backendConsent = readFileSync(
    new URL('../../functions/src/ai/consent.ts', import.meta.url),
    'utf8',
  );
  assert.ok(backendConsent.includes(`"${AI_PROVIDER_CONSENT_VERSION}"`));
  for (const operation of ['analysis', 'extraction_text', 'extraction_document']) {
    assert.ok(backendConsent.includes(`"${operation}"`), operation);
  }
});

test('a chave de idempotência é do chamador: a mesma intenção reusa a mesma chave', async () => {
  const { calls, callables } = recorder();
  const input = { workspaceId: 'ws-1', question: 'Mesma pergunta?', range };
  await callables.analyzeFinancialQuestion({ ...input, idempotencyKey: 'intencao-aaaa-1' });
  await callables.analyzeFinancialQuestion({ ...input, idempotencyKey: 'intencao-bbbb-2' });
  assert.deepEqual(calls.map((call) => call.payload.idempotencyKey), [
    'intencao-aaaa-1', 'intencao-bbbb-2',
  ]);
});

/** `invoke` que falha nas primeiras tentativas com os erros dados. */
const flaky = (failures: unknown[], result: unknown = { ok: true }) => {
  const payloads: Array<Record<string, unknown>> = [];
  let waits = 0;
  const callables = createAiCallables(async <T,>(
    _name: AiCallableName,
    payload: Record<string, unknown>,
  ) => {
    payloads.push(payload);
    if (payloads.length <= failures.length) throw failures[payloads.length - 1];
    return result as T;
  }, { wait: async () => { waits += 1; } });
  return { payloads, callables, waits: () => waits };
};

const analysisInput = {
  workspaceId: 'ws-1', question: 'Como estou?', range, idempotencyKey: 'intencao-cccc-3',
};

test('falha de transporte: uma única repetição, com a mesma chave e o mesmo payload', async () => {
  for (const error of [
    { code: 'functions/unavailable', message: 'unavailable' },
    new TypeError('Failed to fetch'),
  ]) {
    const { payloads, callables, waits } = flaky([error]);
    await callables.analyzeFinancialQuestion(analysisInput);
    assert.equal(payloads.length, 2, JSON.stringify(error));
    assert.deepEqual(payloads[1], payloads[0]);
    assert.equal(payloads[1].idempotencyKey, 'intencao-cccc-3');
    assert.equal(waits(), 1);
  }
  // Segunda falha de transporte: sobe o erro, sem terceira tentativa.
  const down = { code: 'functions/unavailable', message: 'unavailable' };
  const { payloads, callables } = flaky([down, down, down]);
  await assert.rejects(callables.analyzeFinancialQuestion(analysisInput), (error) => error === down);
  assert.equal(payloads.length, 2);
  // Também na extração, com a mesma chave.
  const text = flaky([down]);
  await text.callables.extractTransactionFromText({
    workspaceId: 'ws-1', transcript: 'Almoço de 45', idempotencyKey: 'intencao-dddd-4',
  });
  assert.equal(text.payloads.length, 2);
  assert.deepEqual(text.payloads[1], text.payloads[0]);
});

test('pedido que chegou ao servidor não é repetido: deadline-exceeded e o tempo limite do cliente acima da função', async () => {
  const late = { code: 'functions/deadline-exceeded', message: 'deadline-exceeded' };
  const { payloads, callables, waits } = flaky([late]);
  await assert.rejects(callables.analyzeFinancialQuestion(analysisInput), (thrown) => thrown === late);
  assert.equal(payloads.length, 1);
  assert.equal(waits(), 0);
  // Acima dos 120 s da callable e dos 90 s do provedor.
  assert.ok(AI_CLIENT_TIMEOUT_MS > 120_000);
});

test('repetição que encontra o pedido já processado avisa que a tentativa pode ter contado', async () => {
  const processed = {
    code: 'functions/failed-precondition',
    message: 'Esta solicitação de IA já foi processada. Faça uma nova solicitação para consultar novamente.',
  };
  const { payloads, callables } = flaky([{ code: 'functions/unavailable', message: 'unavailable' }, processed]);
  await assert.rejects(callables.analyzeFinancialQuestion(analysisInput), (thrown) => {
    assert.equal((thrown as { code?: string }).code, 'functions/failed-precondition');
    assert.equal(aiErrorMessage(thrown), AI_RETRY_ALREADY_PROCESSED_MESSAGE);
    return true;
  });
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[1], payloads[0]);
});

test('resposta do backend nunca é repetida: sem segundo envio nem segundo crédito', async () => {
  for (const code of [
    'failed-precondition', 'invalid-argument', 'resource-exhausted',
    'permission-denied', 'internal', 'aborted', 'unauthenticated', 'not-found',
    'deadline-exceeded',
  ]) {
    const error = { code: `functions/${code}`, message: 'Mensagem do backend em pt-BR.' };
    const { payloads, callables } = flaky([error]);
    await assert.rejects(callables.analyzeFinancialQuestion(analysisInput), (thrown) => thrown === error);
    assert.equal(payloads.length, 1, code);
    const doc = flaky([error]);
    await assert.rejects(doc.callables.extractTransactionFromDocument({
      workspaceId: 'ws-1', mimeType: 'application/pdf', dataBase64: 'JVBERi0xLjQK',
      idempotencyKey: 'intencao-eeee-5',
    }));
    assert.equal(doc.payloads.length, 1, code);
  }
  assert.equal(isAiTransportFailure({ code: 'functions/unavailable' }), true);
  assert.equal(isAiTransportFailure({ code: 'functions/internal' }), false);
  assert.equal(isAiTransportFailure({ code: 'functions/deadline-exceeded' }), false);
  assert.equal(isAiTransportFailure(null), false);
  assert.equal(isAiTransportFailure('functions/unavailable'), false);
});

test('mensagens de erro de IA em pt-BR: a do backend quando houver frase, nunca o código cru', () => {
  const backend = 'Confirme o envio ao provedor de IA antes de continuar. Nada foi enviado e nenhum crédito foi usado.';
  for (const code of ['failed-precondition', 'invalid-argument', 'resource-exhausted']) {
    assert.equal(aiErrorMessage({ code: `functions/${code}`, message: backend }), backend, code);
    // Sem frase (o SDK usa o código como mensagem): texto genérico.
    assert.equal(aiErrorMessage({ code: `functions/${code}`, message: code }), AI_GENERIC_ERROR_MESSAGE, code);
    assert.equal(aiErrorMessage({ code: `functions/${code}` }), AI_GENERIC_ERROR_MESSAGE, code);
  }
  const consent = {
    code: 'functions/failed-precondition',
    message: backend,
    details: { reason: 'ai_consent_required' },
  };
  assert.equal(aiErrorMessage(consent), backend);
  const providerFailed = {
    code: 'functions/failed-precondition',
    message: 'O serviço de IA falhou depois de aceitar o pedido; o crédito foi contabilizado.',
    details: { reason: 'ai_provider_failed' },
  };
  assert.equal(aiErrorMessage(providerFailed), providerFailed.message);
  // Créditos esgotados: a do backend; sem frase, a de reserva.
  assert.equal(aiErrorMessage({
    code: 'functions/resource-exhausted',
    message: AI_CREDITS_EXHAUSTED_MESSAGE,
    details: { resource: 'aiCreditsPerMonth' },
  }), AI_CREDITS_EXHAUSTED_MESSAGE);
  assert.equal(aiErrorMessage({
    code: 'functions/resource-exhausted',
    message: 'resource-exhausted',
    details: { resource: 'aiCreditsPerMonth' },
  }), AI_CREDITS_EXHAUSTED_MESSAGE);
  assert.equal(AI_PERMISSION_DENIED_MESSAGE,
    'Você não tem permissão para usar a IA neste espaço de trabalho.');
  assert.equal(aiErrorMessage({ code: 'functions/permission-denied', message: 'denied' }),
    AI_PERMISSION_DENIED_MESSAGE);
  assert.equal(AI_GENERIC_ERROR_MESSAGE, 'Não foi possível usar a IA agora. Tente novamente mais tarde.');
  for (const error of [
    { code: 'functions/internal', message: 'internal error happened' },
    { code: 'functions/unavailable' },
    new Error('Failed to fetch'),
    null,
    undefined,
    'texto',
  ]) {
    assert.equal(aiErrorMessage(error), AI_GENERIC_ERROR_MESSAGE, String(error));
  }
  for (const error of [consent, providerFailed, new Error('x'), null]) {
    assert.doesNotMatch(aiErrorMessage(error), /chave API/i);
  }
});

const backendString = (name: string) =>
  between(backendQuota, `export const ${name}`, ';')
    .match(/"([^"]*)"/g)
    ?.map((part) => part.slice(1, -1))
    .join('');

test('créditos esgotados: só a recusa do backend por créditos, com a mensagem dele', () => {
  assert.equal(
    AI_CREDITS_EXHAUSTED_MESSAGE,
    'Os créditos de IA deste plano acabaram neste mês. Faça upgrade ou aguarde o início do próximo mês.',
  );
  // O texto de reserva do cliente é o mesmo que o backend escreve ao titular.
  assert.equal(backendString('AI_CREDITS_EXHAUSTED_MESSAGE'), AI_CREDITS_EXHAUSTED_MESSAGE);
  const exhausted = (message: string) => ({
    code: 'functions/resource-exhausted',
    message,
    details: { resource: 'aiCreditsPerMonth', planId: 'pro', limit: 150, periodKey: '2026-10' },
  });
  assert.equal(isAiCreditsExhausted(exhausted(AI_CREDITS_EXHAUSTED_MESSAGE)), true);
  for (const error of [
    { code: 'functions/failed-precondition' },
    { code: 'functions/internal' },
    { code: 'resource-exhausted', details: { resource: 'aiCreditsPerMonth' } },
    // HTTP 429 da plataforma: o SDK usa o código como mensagem, sem detalhes.
    { code: 'functions/resource-exhausted', message: 'resource-exhausted' },
    { code: 'functions/resource-exhausted', details: { resource: 'membersPerWorkspace' } },
    new Error('functions/resource-exhausted'),
    null,
    undefined,
    'functions/resource-exhausted',
  ]) {
    assert.equal(isAiCreditsExhausted(error), false, JSON.stringify(error));
  }
  // Quem não é o titular recebe do backend a orientação de pedir ao titular,
  // e o cliente a exibe como veio.
  const nonOwner = backendString('AI_CREDITS_EXHAUSTED_NON_OWNER_MESSAGE');
  assert.ok(nonOwner && /titular/.test(nonOwner));
  assert.equal(aiCreditsExhaustedMessage(exhausted(nonOwner)), nonOwner);
  // Sem frase do backend, a mensagem de reserva; nunca o código cru.
  assert.equal(aiCreditsExhaustedMessage(exhausted('resource-exhausted')),
    AI_CREDITS_EXHAUSTED_MESSAGE);
  assert.equal(aiCreditsExhaustedMessage({}), AI_CREDITS_EXHAUSTED_MESSAGE);
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
  assert.match(reports, /range: contextSnapshot\.range,/);
  assert.match(reports, /answer: aiErrorMessage\(error\)/);
  // Nenhum valor financeiro sai do navegador na análise.
  assert.equal(/context:|kpis|topCategories|formattedValue/.test(reports), false);
  const modal = read(join(srcRoot, 'components', 'TransactionModal.tsx'));
  assert.match(modal, /extractTransactionFromDocument\(\{/);
  assert.match(modal, /extractTransactionFromText\(\{/);
  assert.match(modal, /text: aiErrorMessage\(error\)/);
  assert.equal(/httpsCallable/.test(modal), false);
  // Erro cru da IA não vai ao console: no máximo o código.
  assert.equal(/console\.error/.test(modal), false);
});

test('peso em créditos, modelo, teto de tokens e credencial não existem no cliente', () => {
  const offenders = sourceFiles.filter((path) =>
    /AI_CREDIT_COSTS|creditCost|maxOutputTokens|gemini-|GOOGLE_AI_API_KEY|generativelanguage/
      .test(read(path)));
  assert.deepEqual(offenders, []);
});

test('contenção (functions/aborted) é erro de negócio com a mensagem do backend', () => {
  const errors = read(join(srcRoot, 'modules', 'workspaces', 'errorMessages.ts'));
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

test('comprovante: envio só depois da confirmação; leitura, chamada e carregamento no mesmo fluxo', () => {
  const modal = read(join(srcRoot, 'components', 'TransactionModal.tsx'));
  assert.equal(/\.onload\s*=\s*async/.test(modal), false, 'onload assíncrono solto');
  // Escolher o arquivo só valida e abre a confirmação: nada é lido nem enviado.
  const select = modal.slice(
    modal.indexOf('const handleFileSelected'),
    modal.indexOf('const sendDocument'),
  );
  assert.match(select, /validateAiDocument\(file\)/);
  assert.match(select, /setAiConsent\(\{ kind: 'document', file, mimeType: check\.mimeType \}\)/);
  assert.equal(/readFileAsBase64|extractTransactionFromDocument/.test(select), false);
  // A leitura só começa na confirmação, antes da callable, e a chave nasce lá.
  const send = modal.slice(
    modal.indexOf('const sendDocument'),
    modal.indexOf('// --- AI LOGIC: Voice Entry ---'),
  );
  const steps = [
    'await readFileAsBase64(file);',
    'if (!isCurrent()) throw new LocalFileReadError();',
    'return extractTransactionFromDocument({',
    'idempotencyKey,',
  ];
  let cursor = -1;
  for (const step of steps) {
    const index = send.indexOf(step, cursor + 1);
    assert.ok(index > cursor, `ausente ou fora de ordem: ${step}`);
    cursor = index;
  }
  assert.equal(/new FileReader\(/.test(send), false);
  // Carregamento, ocupado e erro: um único `try/catch/finally` em `runAiExtraction`.
  const run = modal.slice(
    modal.indexOf('const runAiExtraction'),
    modal.indexOf('// --- AI LOGIC: Document Analysis ---'),
  );
  const runSteps = [
    'if (aiBusyRef.current) return;',
    'aiBusyRef.current = true;',
    'const idempotencyKey = newIdempotencyKey();',
    'setIsAILoading(true);',
    'try {',
    'await call({',
    '} catch (error) {',
    '} finally {',
    'aiBusyRef.current = false;',
    'setIsAILoading(false);',
  ];
  cursor = -1;
  for (const step of runSteps) {
    const index = run.indexOf(step, cursor + 1);
    assert.ok(index > cursor, `ausente ou fora de ordem: ${step}`);
    cursor = index;
  }
  // Os dois botões (comprovante e voz) seguem presos ao carregamento e à
  // confirmação; o de comprovante também fica bloqueado durante a gravação.
  assert.equal((modal.match(/disabled=\{isAILoading \|\| aiConsent !== null \|\| isRecording\}/g) ?? []).length, 1);
  assert.equal((modal.match(/disabled=\{isAILoading \|\| aiConsent !== null\}/g) ?? []).length, 1);
  // O seletor só aceita os tipos que o backend lê.
  assert.match(modal, /accept=\{AI_DOCUMENT_ACCEPT\}/);
});

test('texto de voz e documento: microfone e envio só abrem depois do diálogo de confirmação', () => {
  const modal = read(join(srcRoot, 'components', 'TransactionModal.tsx'));
  const entry = modal.slice(
    modal.indexOf('const handleVoiceEntry'),
    modal.indexOf('const startVoiceRecognition'),
  );
  assert.match(entry, /setAiConsent\(\{ kind: 'voice_start' \}\)/);
  assert.equal(/recognition\.start\(\)|new SpeechRecognition/.test(entry), false);
  const start = modal.slice(
    modal.indexOf('const startVoiceRecognition'),
    modal.indexOf('const sendTranscript'),
  );
  // O reconhecimento termina em outra confirmação: o texto não é enviado direto.
  assert.match(start, /setAiConsent\(\{ kind: 'voice_send', transcript: check\.transcript \}\)/);
  assert.equal(/extractTransactionFromText/.test(start), false);
  const confirm = modal.slice(modal.indexOf('const confirmAiConsent'));
  assert.match(confirm, /consent\.kind === 'voice_start'\) startVoiceRecognition\(\)/);
  assert.match(confirm, /sendDocument\(consent\.file, consent\.mimeType\)/);
  assert.match(confirm, /sendTranscript\(consent\.transcript\)/);
});

test('confirmação presa ao escopo em que abriu; gravação não substitui outra confirmação; pergunta no limite do backend', () => {
  const modal = read(join(srcRoot, 'components', 'TransactionModal.tsx'));
  const confirm = modal.slice(
    modal.indexOf('const confirmAiConsent'),
    modal.indexOf('const aiConsentVariant'),
  );
  const order = [
    'const consentScope = aiConsentScopeRef.current;',
    'setAiConsent(null);',
    'if (!consentScope || !isSameAiScope(consentScope, currentAiScope())) {',
    'AI_SUGGESTION_DISCARDED_MESSAGE',
    'return;',
    'startVoiceRecognition()',
    'sendDocument(consent.file, consent.mimeType)',
    'sendTranscript(consent.transcript)',
  ];
  let cursor = -1;
  for (const step of order) {
    const index = confirm.indexOf(step, cursor + 1);
    assert.ok(index > cursor, `ausente ou fora de ordem: ${step}`);
    cursor = index;
  }
  assert.match(modal, /aiConsentScopeRef\.current = value \? captureAiScope\(currentAiScope\(\)\) : null;/);
  assert.match(modal, /if \(!isSameAiScope\(voiceScope, currentAiScope\(\)\) \|\| aiConsentRef\.current\) return;/);

  const chat = read(join(srcRoot, 'components', 'ReportsAIChat.tsx'));
  assert.match(chat, /const QUESTION_MIN = 3;/);
  assert.match(chat, /const QUESTION_MAX = 2000;/);
  assert.match(chat, /maxLength=\{QUESTION_MAX\}/);
  assert.match(chat, /question\.length < QUESTION_MIN \|\| question\.length > QUESTION_MAX/);
  assert.match(chat, /disabled=\{input\.trim\(\)\.length < QUESTION_MIN \|\| isLoading \|\| !isReady\}/);
});
