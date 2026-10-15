import type { ExtractionResult, FieldState } from './callables.ts';

/**
 * Aplicação da extração de IA ao formulário de lançamento (P5-E1).
 *
 * Função pura: recebe o `ExtractionResult` do backend e o contexto do
 * formulário e devolve o que preencher. Só campos `identified` entram;
 * `missing`, `invalid` e `ambiguous` nunca são preenchidos nem zerados. O valor
 * chega em centavos inteiros e vira o texto do campo numérico (`12.34`) por
 * aritmética inteira, sem ponto flutuante. Nada é salvo aqui: o lançamento só
 * é gravado pelo botão do formulário, pelas callables oficiais.
 */

export type ExtractionTab = 'receita' | 'despesa' | 'parcelado' | 'investimento';

export interface ExtractionCategory {
  id: string;
  name: string;
}

export interface ExtractionContext {
  currentTab: ExtractionTab;
  allowedTabs: readonly ExtractionTab[];
  isPJ: boolean;
  /** Categorias do catálogo para a aba (a aba Parcelado usa as de despesa). */
  categoriesFor: (tab: ExtractionTab) => readonly ExtractionCategory[];
}

export interface ExtractionPatch {
  tab?: 'receita' | 'despesa' | 'parcelado';
  description?: string;
  /** Texto do campo numérico de valor (`12.34`). */
  value?: string;
  /** Aba receita/despesa. */
  date?: string;
  /** Aba parcelado (data da compra). */
  purchaseDate?: string;
  installments?: string;
  supplier?: string;
  costCenter?: string;
  categoryId?: string;
}

export interface ExtractionApplication {
  patch: ExtractionPatch;
  message: string;
  /** Rótulos pt-BR dos campos aplicáveis que a IA não identificou. */
  unidentified: string[];
  categoryNotFound: boolean;
}

export const EXTRACTION_COMPLETE_MESSAGE =
  'Sugestão aplicada. Revise todos os campos antes de salvar.';
export const EXTRACTION_REFUSED_MESSAGE =
  'Não identificamos uma operação financeira. Nenhum campo foi preenchido.';
export const EXTRACTION_CATEGORY_NOT_FOUND_SUFFIX =
  ' Categoria sugerida não encontrada; escolha manualmente.';
/** Rótulos das abas do formulário, para avisar a troca feita pela sugestão. */
const TAB_LABELS: Record<'receita' | 'despesa' | 'parcelado', string> = {
  receita: 'Receita',
  despesa: 'Despesa',
  parcelado: 'Cartão',
};

export const EXTRACTION_MALFORMED_MESSAGE =
  'Não foi possível usar a IA agora. Tente novamente mais tarde.';

/** Teto do backend para valores (R$ 1.000.000.000,00), em centavos. */
const MAX_CENTS = 100_000_000_000;
const MAX_INSTALLMENTS = 60;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Minúsculas, sem acentos, espaços colapsados, sem espaços nas pontas. */
export const normalizeHint = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Centavos inteiros → texto do campo numérico (`1234` → `12.34`), ou `null`. */
export const centsToNumberInput = (cents: unknown): string | null => {
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents)) return null;
  if (cents <= 0 || cents > MAX_CENTS) return null;
  const reais = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${reais}.${String(rest).padStart(2, '0')}`;
};

const isRealDay = (value: string): boolean => {
  const match = DAY_KEY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
};

const identifiedValue = <T>(field: FieldState<T> | undefined): T | undefined =>
  field && field.state === 'identified' ? field.value : undefined;

/** Categoria só por igualdade normalizada e sem ambiguidade. */
export const matchCategory = (
  hint: string,
  options: readonly ExtractionCategory[],
): ExtractionCategory | null => {
  const wanted = normalizeHint(hint);
  if (!wanted) return null;
  const matches = options.filter((option) => normalizeHint(option.name) === wanted);
  return matches.length === 1 ? matches[0] : null;
};

const joinLabels = (labels: string[]): string => labels.join(', ');

export const planExtractionApplication = (
  result: ExtractionResult,
  context: ExtractionContext,
): ExtractionApplication => {
  const empty = (message: string): ExtractionApplication => ({
    patch: {}, message, unidentified: [], categoryNotFound: false,
  });
  if (context.currentTab === 'investimento') return empty('');
  if (!result || typeof result !== 'object' || !result.fields ||
    result.status === 'refused') {
    return empty(EXTRACTION_REFUSED_MESSAGE);
  }
  const { fields } = result;
  const patch: ExtractionPatch = {};
  const allowed = (tab: ExtractionTab) => context.allowedTabs.includes(tab);

  const installmentsRaw = identifiedValue(fields.installments);
  const installments = typeof installmentsRaw === 'number' &&
    Number.isInteger(installmentsRaw) &&
    installmentsRaw >= 1 && installmentsRaw <= MAX_INSTALLMENTS
    ? installmentsRaw
    : undefined;
  const operation = identifiedValue(fields.operation);

  let tab: 'receita' | 'despesa' | 'parcelado' | null =
    context.currentTab === 'receita' || context.currentTab === 'despesa' ||
    context.currentTab === 'parcelado'
      ? context.currentTab
      : null;
  if (tab === null) return empty('');
  if (operation === 'income' && allowed('receita')) {
    tab = 'receita';
  } else if (operation === 'expense') {
    if (tab === 'parcelado') {
      // Compra no cartão continua no cartão (à vista ou parcelada): sair
      // daqui gravaria um débito em conta e o pagamento da fatura depois
      // contaria a mesma despesa de novo.
    } else if (installments !== undefined && installments >= 2 && allowed('parcelado')) {
      tab = 'parcelado';
    } else if (allowed('despesa')) {
      tab = 'despesa';
    }
  }
  if (tab !== context.currentTab) patch.tab = tab;

  const unidentified: string[] = [];
  const track = (applied: boolean, label: string) => {
    if (!applied) unidentified.push(label);
  };

  track(operation === 'income' || operation === 'expense', 'tipo da operação');

  const description = identifiedValue(fields.description);
  const hasDescription = typeof description === 'string' && description.trim() !== '';
  if (hasDescription) patch.description = description.trim();
  track(hasDescription, 'descrição');

  const value = centsToNumberInput(identifiedValue(fields.amountCents));
  if (value !== null) patch.value = value;
  track(value !== null, 'valor');

  const date = identifiedValue(fields.date);
  const hasDate = typeof date === 'string' && isRealDay(date);
  if (hasDate) {
    if (tab === 'parcelado') patch.purchaseDate = date;
    else patch.date = date;
  }
  track(hasDate, tab === 'parcelado' ? 'data da compra' : 'data');

  let categoryNotFound = false;
  const categoryHint = identifiedValue(fields.categoryHint);
  const hasCategoryHint = typeof categoryHint === 'string' && categoryHint.trim() !== '';
  if (hasCategoryHint) {
    const match = matchCategory(categoryHint, context.categoriesFor(tab));
    if (match) patch.categoryId = match.id;
    else categoryNotFound = true;
  } else {
    track(false, 'categoria');
  }

  if (tab === 'despesa' || tab === 'parcelado') {
    if (context.isPJ) {
      const supplier = identifiedValue(fields.supplier);
      const hasSupplier = typeof supplier === 'string' && supplier.trim() !== '';
      if (hasSupplier) patch.supplier = supplier.trim();
      track(hasSupplier, 'fornecedor');
    }
  }
  if (context.isPJ) {
    const costCenter = identifiedValue(fields.costCenterHint);
    const hasCostCenter = typeof costCenter === 'string' && costCenter.trim() !== '';
    if (hasCostCenter) patch.costCenter = costCenter.trim();
    track(hasCostCenter, 'centro de custo');
  }
  if (tab === 'parcelado') {
    if (installments !== undefined) patch.installments = String(installments);
    track(installments !== undefined, 'parcelas');
  }

  let message: string;
  if (result.status === 'complete') {
    message = EXTRACTION_COMPLETE_MESSAGE;
  } else if (unidentified.length > 0) {
    message = `Sugestão parcial aplicada. Confira: ${joinLabels(unidentified)}.`;
  } else {
    message = 'Sugestão parcial aplicada. Revise todos os campos antes de salvar.';
  }
  if (categoryNotFound) message += EXTRACTION_CATEGORY_NOT_FOUND_SUFFIX;
  if (patch.tab) message += ` O formulário mudou para a aba ${TAB_LABELS[patch.tab]}.`;
  return { patch, message, unidentified, categoryNotFound };
};

export const TRANSCRIPT_MIN = 3;
export const TRANSCRIPT_MAX = 4000;
export const TRANSCRIPT_TOO_SHORT_MESSAGE =
  'Não entendi o que foi falado. Tente falar novamente.';
export const TRANSCRIPT_TOO_LONG_MESSAGE =
  'O texto reconhecido é longo demais para enviar. Tente falar de forma mais breve.';

export type TranscriptCheck =
  | { ok: true; transcript: string }
  | { ok: false; message: string };

/** Limites do backend (3 a 4000 caracteres após o trim), antes de abrir a confirmação. */
export const checkTranscript = (raw: unknown): TranscriptCheck => {
  const transcript = typeof raw === 'string' ? raw.trim() : '';
  if (transcript.length < TRANSCRIPT_MIN) return { ok: false, message: TRANSCRIPT_TOO_SHORT_MESSAGE };
  if (transcript.length > TRANSCRIPT_MAX) return { ok: false, message: TRANSCRIPT_TOO_LONG_MESSAGE };
  return { ok: true, transcript };
};
