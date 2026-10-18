import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ExtractionResult } from '../../src/modules/ai/callables.ts';
import {
  AI_DOCUMENT_ACCEPT,
  AI_DOCUMENT_EMPTY_MESSAGE,
  AI_DOCUMENT_MAX_BYTES,
  AI_DOCUMENT_TOO_LARGE_MESSAGE,
  AI_DOCUMENT_UNSUPPORTED_MESSAGE,
  aiDocumentTypeLabel,
  formatFileSize,
  validateAiDocument,
} from '../../src/modules/ai/documentFile.ts';
import {
  EXTRACTION_CATEGORY_NOT_FOUND_SUFFIX,
  EXTRACTION_COMPLETE_MESSAGE,
  EXTRACTION_REFUSED_MESSAGE,
  centsToNumberInput,
  checkTranscript,
  matchCategory,
  normalizeHint,
  planExtractionApplication,
  type ExtractionContext,
  type ExtractionTab,
} from '../../src/modules/ai/extractionForm.ts';
import {
  AI_SUGGESTION_DISCARDED_MESSAGE,
  captureAiScope,
  isSameAiScope,
} from '../../src/modules/ai/scopeToken.ts';

/**
 * Aplicação da extração de IA ao formulário (P5-E1): só campos identificados
 * preenchem, categoria só por igualdade normalizada, centavos viram texto sem
 * ponto flutuante, arquivo é validado antes de qualquer envio e um resultado
 * de outro escopo é descartado.
 */
const missing = { state: 'missing' } as const;

const extraction = (
  fields: Partial<ExtractionResult['fields']>,
  status: ExtractionResult['status'] = 'partial',
): ExtractionResult => ({
  schemaVersion: 1,
  status,
  fields: {
    operation: missing,
    description: missing,
    amountCents: missing,
    date: missing,
    categoryHint: missing,
    supplier: missing,
    costCenterHint: missing,
    installments: missing,
    ...fields,
  },
});

const CATEGORIES: Record<string, Array<{ id: string; name: string }>> = {
  receita: [{ id: 'r1', name: 'Salário' }, { id: 'r2', name: 'Vendas' }],
  despesa: [{ id: 'd1', name: 'Alimentação' }, { id: 'd2', name: 'Moradia' }],
  parcelado: [{ id: 'd1', name: 'Alimentação' }, { id: 'd2', name: 'Moradia' }],
};

const context = (overrides: Partial<ExtractionContext> = {}): ExtractionContext => ({
  currentTab: 'despesa',
  allowedTabs: ['receita', 'despesa', 'investimento', 'parcelado'],
  isPJ: false,
  categoriesFor: (tab: ExtractionTab) => CATEGORIES[tab] ?? [],
  ...overrides,
});

const identified = <T,>(value: T) => ({ state: 'identified', value }) as const;

test('só campos identificados preenchem; missing, invalid e ambiguous nunca', () => {
  const result = extraction({
    operation: identified('expense'),
    description: identified('Almoço no restaurante'),
    amountCents: { state: 'invalid', reason: 'precision' },
    date: { state: 'ambiguous' },
    categoryHint: missing,
  });
  const plan = planExtractionApplication(result, context({ currentTab: 'receita' }));
  assert.deepEqual(plan.patch, { tab: 'despesa', description: 'Almoço no restaurante' });
  assert.equal('value' in plan.patch, false);
  assert.equal('date' in plan.patch, false);
  assert.equal('categoryId' in plan.patch, false);
  assert.deepEqual(plan.unidentified, ['valor', 'data', 'categoria']);
  assert.equal(plan.message,
    'Sugestão parcial aplicada. Confira: valor, data, categoria. O formulário mudou para a aba Despesa.');
});

test('sugestão completa: mensagem de revisão e todos os campos do formulário', () => {
  const result = extraction({
    operation: identified('income'),
    description: identified('Pagamento do cliente'),
    amountCents: identified(150_000),
    date: identified('2026-10-05'),
    categoryHint: identified('  VENDAS '),
  }, 'complete');
  const plan = planExtractionApplication(result, context());
  assert.deepEqual(plan.patch, {
    tab: 'receita',
    description: 'Pagamento do cliente',
    value: '1500.00',
    date: '2026-10-05',
    categoryId: 'r2',
  });
  // A troca de aba feita pela sugestão é avisada.
  assert.equal(plan.message, `${EXTRACTION_COMPLETE_MESSAGE} O formulário mudou para a aba Receita.`);
  assert.equal(plan.message,
    'Sugestão aplicada. Revise todos os campos antes de salvar. O formulário mudou para a aba Receita.');
  // Sem troca de aba, só a mensagem de revisão.
  const same = planExtractionApplication(result, context({ currentTab: 'receita' }));
  assert.equal(same.message, EXTRACTION_COMPLETE_MESSAGE);
});

test('refused não preenche nada, nem campos que viessem identificados', () => {
  const plan = planExtractionApplication(extraction({
    operation: identified('expense'),
    description: identified('Qualquer coisa'),
    amountCents: identified(1000),
  }, 'refused'), context());
  assert.deepEqual(plan.patch, {});
  assert.equal(plan.message, EXTRACTION_REFUSED_MESSAGE);
  assert.equal(plan.message, 'Não identificamos uma operação financeira. Nenhum campo foi preenchido.');
  // Resposta malformada tampouco preenche.
  assert.deepEqual(planExtractionApplication({} as ExtractionResult, context()).patch, {});
});

test('categoria só por igualdade normalizada com as opções da aba alvo', () => {
  assert.equal(normalizeHint('  ALIMENTAÇÃO   Fora  '), 'alimentacao fora');
  const options = CATEGORIES.despesa;
  assert.equal(matchCategory('alimentacao', options)?.id, 'd1');
  assert.equal(matchCategory(' MORADIA ', options)?.id, 'd2');
  // Contém, mas não é igual: sem correspondência.
  assert.equal(matchCategory('alimentacao fora de casa', options), null);
  assert.equal(matchCategory('mora', options), null);
  assert.equal(matchCategory('', options), null);
  // Duas opções iguais depois de normalizar: ambíguo, não escolhe.
  assert.equal(matchCategory('moradia', [
    { id: 'a', name: 'Moradia' }, { id: 'b', name: 'MORADIA ' },
  ]), null);

  // A categoria é procurada na aba alvo (despesa), não na aba atual (receita).
  const plan = planExtractionApplication(extraction({
    operation: identified('expense'),
    categoryHint: identified('Salário'),
  }), context({ currentTab: 'receita' }));
  assert.equal(plan.patch.tab, 'despesa');
  assert.equal('categoryId' in plan.patch, false);
  assert.equal(plan.categoryNotFound, true);
  assert.ok(plan.message.includes(EXTRACTION_CATEGORY_NOT_FOUND_SUFFIX));
  assert.ok(plan.message.endsWith(
    ' Categoria sugerida não encontrada; escolha manualmente. O formulário mudou para a aba Despesa.'));

  const complete = planExtractionApplication(extraction({
    operation: identified('expense'),
    categoryHint: identified('Hobby'),
  }, 'complete'), context());
  assert.equal(
    complete.message,
    'Sugestão aplicada. Revise todos os campos antes de salvar. Categoria sugerida não encontrada; escolha manualmente.',
  );
});

test('parcelas >= 2 levam à aba de compra no cartão só se ela for permitida', () => {
  const result = extraction({
    operation: identified('expense'),
    description: identified('Geladeira'),
    amountCents: identified(240_000),
    date: identified('2026-10-02'),
    installments: identified(6),
    categoryHint: identified('Moradia'),
  });
  const plan = planExtractionApplication(result, context());
  assert.deepEqual(plan.patch, {
    tab: 'parcelado',
    description: 'Geladeira',
    value: '2400.00',
    purchaseDate: '2026-10-02',
    installments: '6',
    categoryId: 'd2',
  });
  assert.equal('date' in plan.patch, false, 'data da compra, não data de pagamento');
  assert.equal('cardId' in plan.patch, false, 'o cartão continua manual');

  // Aba não permitida: cai para despesa e não preenche parcelas.
  const noCard = planExtractionApplication(result, context({
    allowedTabs: ['receita', 'despesa'],
  }));
  assert.equal(noCard.patch.tab, undefined);
  assert.equal(noCard.patch.date, '2026-10-02');
  assert.equal('installments' in noCard.patch, false);

  // 1 parcela não é parcelado.
  const single = planExtractionApplication(extraction({
    operation: identified('expense'), installments: identified(1),
  }), context({ currentTab: 'receita' }));
  assert.equal(single.patch.tab, 'despesa');
  // Fora de 1..60 ou não inteiro: ignorado.
  for (const bad of [0, 61, 2.5, -3]) {
    const invalid = planExtractionApplication(extraction({
      operation: identified('expense'), installments: identified(bad),
    }), context());
    assert.equal(invalid.patch.tab, undefined, String(bad));
    assert.equal('installments' in invalid.patch, false, String(bad));
  }
});

test('aba alvo não permitida: não troca de aba', () => {
  const plan = planExtractionApplication(extraction({
    operation: identified('income'),
    description: identified('Venda'),
  }), context({ currentTab: 'despesa', allowedTabs: ['despesa'] }));
  assert.equal('tab' in plan.patch, false);
  assert.equal(plan.patch.description, 'Venda');
  // Operação não identificada: a aba atual fica.
  const unknown = planExtractionApplication(extraction({
    description: identified('Algo'),
  }), context({ currentTab: 'receita' }));
  assert.equal('tab' in unknown.patch, false);
  // Aba de investimento nunca recebe sugestão.
  const investment = planExtractionApplication(extraction({
    operation: identified('expense'), description: identified('Algo'),
  }), context({ currentTab: 'investimento' }));
  assert.deepEqual(investment.patch, {});
});

test('fornecedor e centro de custo só no PJ; fornecedor só em despesa e compra no cartão', () => {
  const result = extraction({
    operation: identified('expense'),
    supplier: identified('AWS'),
    costCenterHint: identified('Infraestrutura'),
  });
  const pf = planExtractionApplication(result, context({ isPJ: false }));
  assert.equal('supplier' in pf.patch, false);
  assert.equal('costCenter' in pf.patch, false);
  const pj = planExtractionApplication(result, context({ isPJ: true }));
  assert.equal(pj.patch.supplier, 'AWS');
  assert.equal(pj.patch.costCenter, 'Infraestrutura');
  const income = planExtractionApplication(extraction({
    operation: identified('income'),
    supplier: identified('AWS'),
    costCenterHint: identified('Infraestrutura'),
  }), context({ isPJ: true, currentTab: 'receita' }));
  assert.equal('supplier' in income.patch, false);
  assert.equal(income.patch.costCenter, 'Infraestrutura');
});

test('centavos inteiros viram o texto do campo numérico sem ponto flutuante', () => {
  assert.equal(centsToNumberInput(1), '0.01');
  assert.equal(centsToNumberInput(5), '0.05');
  assert.equal(centsToNumberInput(10), '0.10');
  assert.equal(centsToNumberInput(4_590), '45.90');
  assert.equal(centsToNumberInput(100_000), '1000.00');
  // 1,15 e 0,29 errariam em float (0.1 + 0.2 e afins); aqui é inteiro.
  assert.equal(centsToNumberInput(115), '1.15');
  assert.equal(centsToNumberInput(29), '0.29');
  assert.equal(centsToNumberInput(100_000_000_000), '1000000000.00');
  for (const bad of [0, -1, 1.5, Number.NaN, Infinity, 100_000_000_001, '100', null, undefined]) {
    assert.equal(centsToNumberInput(bad), null, String(bad));
  }
  // Valor inválido não preenche e entra na lista de conferência.
  const plan = planExtractionApplication(extraction({
    operation: identified('expense'), amountCents: identified(0),
  }), context());
  assert.equal('value' in plan.patch, false);
  assert.ok(plan.unidentified.includes('valor'));
});

test('data fora do formato ou inexistente não preenche', () => {
  for (const bad of ['05/10/2026', '2026-13-01', '2026-02-30', '', 'ontem']) {
    const plan = planExtractionApplication(extraction({
      operation: identified('expense'), date: identified(bad),
    }), context());
    assert.equal('date' in plan.patch, false, bad);
  }
});

test('validação local do arquivo: vazio, tipo e tamanho', () => {
  assert.deepEqual(validateAiDocument({ type: 'image/png', size: 0 }),
    { ok: false, message: AI_DOCUMENT_EMPTY_MESSAGE });
  assert.equal(AI_DOCUMENT_EMPTY_MESSAGE, 'Arquivo vazio. Escolha outro arquivo.');
  for (const type of ['image/gif', 'text/plain', 'application/zip', 'image/heic', '']) {
    assert.deepEqual(validateAiDocument({ type, size: 1000 }),
      { ok: false, message: AI_DOCUMENT_UNSUPPORTED_MESSAGE }, type);
  }
  assert.equal(AI_DOCUMENT_UNSUPPORTED_MESSAGE,
    'Formato não suportado. Envie uma imagem PNG, JPEG ou WEBP, ou um PDF.');
  assert.equal(AI_DOCUMENT_MAX_BYTES, 4_718_592);
  assert.deepEqual(validateAiDocument({ type: 'application/pdf', size: AI_DOCUMENT_MAX_BYTES + 1 }),
    { ok: false, message: AI_DOCUMENT_TOO_LARGE_MESSAGE });
  assert.equal(AI_DOCUMENT_TOO_LARGE_MESSAGE,
    'Arquivo grande demais para leitura por IA (máximo de 4,5 MB).');
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const) {
    assert.deepEqual(validateAiDocument({ type, size: 1 }), { ok: true, mimeType: type });
    assert.deepEqual(validateAiDocument({ type, size: AI_DOCUMENT_MAX_BYTES }), { ok: true, mimeType: type });
  }
  assert.equal(AI_DOCUMENT_ACCEPT, 'image/png,image/jpeg,image/webp,application/pdf');
  // Em base64 o teto do cliente é exatamente o do backend (6 * 1024 * 1024).
  assert.equal(Math.ceil(AI_DOCUMENT_MAX_BYTES / 3) * 4, 6 * 1024 * 1024);
});

test('tamanho do arquivo em pt-BR e rótulo do tipo', () => {
  assert.equal(formatFileSize(500), '500 B');
  assert.equal(formatFileSize(350 * 1024), '350 KB');
  assert.equal(formatFileSize(1_258_291), '1,2 MB');
  assert.equal(formatFileSize(4_718_592), '4,5 MB');
  assert.equal(formatFileSize(1024 * 1024), '1,0 MB');
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(Number.NaN), '0 B');
  assert.equal(aiDocumentTypeLabel('image/png'), 'PNG');
  assert.equal(aiDocumentTypeLabel('image/jpeg'), 'JPEG');
  assert.equal(aiDocumentTypeLabel('image/webp'), 'WEBP');
  assert.equal(aiDocumentTypeLabel('application/pdf'), 'PDF');
});

test('texto reconhecido: 3 a 4000 caracteres após o trim', () => {
  assert.deepEqual(checkTranscript('  almoço de quarenta reais '),
    { ok: true, transcript: 'almoço de quarenta reais' });
  for (const bad of ['', '  ab ', null, undefined, 42]) {
    assert.equal(checkTranscript(bad).ok, false, String(bad));
  }
  assert.equal(checkTranscript('a'.repeat(4000)).ok, true);
  assert.equal(checkTranscript('a'.repeat(4001)).ok, false);
});

test('token de escopo: workspace, aba, abertura e edição mudando descartam o resultado', () => {
  const base = { open: true, workspaceId: 'ws-1', tab: 'despesa', openSeq: 3, editing: false };
  const token = captureAiScope(base);
  assert.equal(isSameAiScope(token, { ...base }), true);
  assert.equal(isSameAiScope(token, { ...base, workspaceId: 'ws-2' }), false);
  assert.equal(isSameAiScope(token, { ...base, tab: 'receita' }), false);
  assert.equal(isSameAiScope(token, { ...base, openSeq: 4 }), false);
  assert.equal(isSameAiScope(token, { ...base, open: false }), false);
  assert.equal(isSameAiScope(token, { ...base, editing: true }), false);
  // O token é uma cópia: mudar o original depois não o altera.
  const live = { ...base };
  const frozen = captureAiScope(live);
  live.workspaceId = 'ws-9';
  assert.equal(frozen.workspaceId, 'ws-1');
  // Fechado desde a captura não vale, mesmo com tudo igual.
  assert.equal(isSameAiScope(captureAiScope({ ...base, open: false }), { ...base, open: false }), false);
  assert.equal(AI_SUGGESTION_DISCARDED_MESSAGE,
    'A sugestão da IA foi descartada porque o formulário mudou.');
});

// --- Diálogo de confirmação: textos exatos e acessibilidade (guarda estática) ---

const dialog = readFileSync(
  new URL('../../src/components/AiShareConsentDialog.tsx', import.meta.url),
  'utf8',
);

test('diálogo de envio ao provedor: textos exatos das quatro variantes', () => {
  for (const text of [
    'Enviar pergunta ao assistente de IA',
    'Enviar comprovante para leitura por IA',
    'Preencher por voz',
    'Enviar texto reconhecido à IA',
    'Enviar pergunta',
    'Enviar comprovante',
    'Iniciar gravação',
    'Enviar texto',
    'Para responder, o FênixGran envia ao Google (Gemini API), provedor de IA usado pelo FênixGran, o texto da sua pergunta e um resumo financeiro deste espaço de trabalho, preparado pelo sistema para o período: ${variant.periodLabel}.',
    'O resumo tem apenas valores agregados do período: saldos, entradas e saídas, receitas e despesas, indicadores, cartões, dívidas e valores a receber, movimentações de investimentos e, conforme sua permissão, o patrimônio investido, alertas, o tipo do espaço (pessoal ou empresa) e até 5 grupos de despesas identificados só pela posição (Grupo de despesas 1, 2…).',
    'O resumo não inclui os nomes das categorias, nomes de clientes ou de cartões, descrições de lançamentos nem identificadores internos.',
    'A pergunta que você digitou vai inteira e pode conter dados pessoais que você mesmo tenha escrito. Evite incluir dados pessoais desnecessários.',
    'A resposta é gerada por IA, pode conter erros e não altera nenhum registro financeiro. Confira antes de tomar decisões.',
    'Cada envio usa 1 crédito de IA do plano, mesmo que o serviço de IA falhe depois de aceitar o pedido.',
    'O arquivo inteiro será enviado ao Google (Gemini API), provedor de IA usado pelo FênixGran, apenas para sugerir os campos deste formulário. Envie somente o comprovante da operação.',
    'O FênixGran não guarda o arquivo. A leitura pode conter erros: nada é salvo até você revisar e confirmar o lançamento.',
    'Usa 1 crédito de IA do plano.',
    'O reconhecimento de fala é feito pelo seu navegador. Dependendo do navegador, o áudio pode ser enviado ao serviço de reconhecimento de voz do fornecedor do navegador (por exemplo, o Google no Chrome), fora do controle do FênixGran.',
    'Depois da gravação, você verá o texto reconhecido e decidirá se ele será enviado ao Google (Gemini API) para sugerir os campos.',
    'A gravação não usa créditos; o envio do texto usa 1 crédito de IA do plano.',
    'Este texto será enviado ao Google (Gemini API), provedor de IA usado pelo FênixGran, apenas para sugerir os campos deste formulário. A sugestão pode conter erros: nada é salvo até você revisar e confirmar o lançamento.',
  ]) {
    assert.ok(dialog.includes(text), text);
  }
  assert.equal(/consentimento|autorizo/i.test(dialog.replace(/\/\*[\s\S]*?\*\//g, '')), false);
  assert.equal(/dangerouslySetInnerHTML|<input[^>]*checkbox|defaultChecked/.test(dialog), false);
});

test('diálogo de envio ao provedor: acessível, foco preso e cancelar não envia', () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /aria-labelledby=\{titleId\}/);
  assert.match(dialog, /aria-describedby=\{bodyId\}/);
  assert.match(dialog, /cancelRef\.current\?\.focus\(\)/);
  assert.match(dialog, /event\.key === 'Escape'/);
  assert.match(dialog, /event\.key !== 'Tab'/);
  assert.match(dialog, /target\?\.focus\(\)/);
  assert.match(dialog, /disabled=\{isBusy\}/);
  // Clique fora cancela; clique dentro não propaga para a moldura do formulário.
  assert.match(dialog, /event\.stopPropagation\(\); onCancel\(\);/);
  // P5-E1.1: o corpo e a citação rolam no celular ou com texto longo; enquanto rolam, entram no Tab.
  assert.match(dialog, /if \(node\.scrollHeight > node\.clientHeight \+ 1\) node\.tabIndex = 0;\s*else node\.removeAttribute\('tabindex'\);/);
  assert.match(dialog, /new ResizeObserver\(update\)/);
  assert.match(dialog, /<div id=\{bodyId\} ref=\{bodyRef\} className="p-6 overflow-y-auto min-h-0">/);
  assert.match(dialog, /const bodyRef = useFocusableWhenScrollable<HTMLDivElement>\(\);/);
  assert.match(dialog, /<p ref=\{quoteRef\} className="[^"]*max-h-32 overflow-y-auto/);
});

test('o diálogo é usado no chat e no assistente do lançamento, e o chat não envia sem ele', () => {
  const chat = readFileSync(new URL('../../src/components/ReportsAIChat.tsx', import.meta.url), 'utf8');
  assert.match(chat, /<AiShareConsentDialog/);
  const handleSend = chat.slice(chat.indexOf('const handleSend'), chat.indexOf('const handleConfirmSend'));
  assert.equal(/sendQuestion\(/.test(handleSend), false, 'pergunta enviada sem confirmação');
  const confirm = chat.slice(chat.indexOf('const handleConfirmSend'), chat.indexOf('const handleKeyDown'));
  assert.match(confirm, /sendQuestion\(current\.question, snapshot, newIdempotencyKey\(\)\)/);
  assert.equal((chat.match(/sendQuestion\(/g) ?? []).length, 1);
  const modal = readFileSync(new URL('../../src/components/TransactionModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /<AiShareConsentDialog/);
});

test('a partir da aba Cartão, despesa continua compra no cartão (à vista ou parcelada)', () => {
  for (const installments of [missing, identified(1), identified(4)] as const) {
    const plan = planExtractionApplication(extraction({
      operation: identified('expense'),
      description: identified('Fone de ouvido'),
      amountCents: identified(19_990),
      date: identified('2026-10-10'),
      installments,
    }), context({ currentTab: 'parcelado' }));
    assert.equal('tab' in plan.patch, false, JSON.stringify(installments));
    assert.equal(plan.patch.purchaseDate, '2026-10-10');
    assert.equal('date' in plan.patch, false);
    assert.doesNotMatch(plan.message, /mudou para a aba/);
  }
  // Receita não existe no cartão: vai para Receita e avisa.
  const income = planExtractionApplication(extraction({
    operation: identified('income'),
  }), context({ currentTab: 'parcelado' }));
  assert.equal(income.patch.tab, 'receita');
  assert.match(income.message, /O formulário mudou para a aba Receita\.$/);
});
