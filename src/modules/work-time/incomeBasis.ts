/**
 * Base de renda elegível do tempo de trabalho equivalente (P5-F.1). Módulo
 * PURO: sem React, sem Firebase, imports com extensão `.ts`.
 *
 * A autoridade é o relatório oficial: o total de cada mês é o `receiptsCents`
 * da série do `getFinancialReport`, que é o `incomeCents` da projeção de
 * caixa (`functions/src/cash/periods.ts`, `cashPeriodDeltaFor`). Este módulo
 * não soma lançamentos para chegar a esse total. Ele só:
 *
 * - espelha, item a item, a contribuição de um lançamento para o
 *   `incomeCents` oficial, para mostrar os itens no painel "Receitas
 *   consideradas" e descontar os que o usuário excluiu (a paridade com a
 *   função do backend é provada por fixture compartilhada,
 *   `tests/fixtures/cash-income-classification.json`);
 * - aplica as exclusões do usuário sobre o total oficial de cada mês.
 *
 * A classificação usa só as marcas gravadas pelo backend, o tipo, o valor
 * em centavos e o estado de liquidação. Nunca usa descrição nem nome de
 * categoria.
 */
import { receiptMovementIdOfMirror } from './receivableReversal.ts';

/** Natureza do lançamento para a renda elegível. */
export type IncomeKind =
  /** Receita comum liquidada: entra com o valor. */
  | 'income'
  /** Recebimento de recebível: entra o principal (juros e multa são receita financeira). */
  | 'receivable'
  /** Estorno de recebimento: tira o principal no mês do estorno. */
  | 'receivable_reversal'
  /** Receita pendente (não liquidada): não entra. */
  | 'pending'
  /** Espelho de empréstimo (principal e juros): não é receita. */
  | 'loan'
  /** Pagamento de fatura de cartão: não é receita. */
  | 'card_payment'
  /** Divisão de contas e reembolsos: não é receita. */
  | 'split'
  /** Aporte, resgate ou rendimento de investimento: não é receita do trabalho. */
  | 'investment'
  /** Lançamento anulado: não conta. */
  | 'voided'
  /** Despesa comum. */
  | 'expense'
  /** Fora do contrato de caixa (o backend também não o projeta). */
  | 'invalid';

export interface IncomeClassification {
  kind: IncomeKind;
  /** Contribuição para o `incomeCents` oficial do mês do lançamento. */
  contributionCents: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const ZERO = (kind: IncomeKind): IncomeClassification => ({ kind, contributionCents: 0 });

/**
 * Espelho de `cashPeriodDeltaFor(...).incomeCents`, na mesma ordem de
 * decisão: anulado, empréstimo, pagamento de cartão, recebível, divisão de
 * contas, investimento e, por fim, receita ou despesa comum.
 */
export const classifyIncomeDocument = (data: Record<string, unknown>): IncomeClassification => {
  if (data.voidedAt !== undefined && data.voidedAt !== null) return ZERO('voided');
  if (data.loanEntry !== undefined) return ZERO('loan');
  if (data.creditCardPaymentEntry !== undefined) return ZERO('card_payment');
  if (data.receivableEntry !== undefined) {
    const entry = data.receivableEntry;
    if (!isRecord(entry) || !isCents(entry.principalCents) || typeof entry.reversal !== 'boolean') return ZERO('invalid');
    if ((data.type !== 'receita' && data.type !== 'despesa') || !isCents(data.valueCents)) return ZERO('invalid');
    if (!entry.reversal) return { kind: 'receivable', contributionCents: entry.principalCents };
    return { kind: 'receivable_reversal', contributionCents: entry.principalCents === 0 ? 0 : -entry.principalCents };
  }
  if (data.splitEntry !== undefined) return ZERO('split');
  if (data.investmentEntry !== undefined) return ZERO('investment');
  if (data.type !== 'receita' && data.type !== 'despesa') return ZERO('invalid');
  if (!isCents(data.valueCents)) return ZERO('invalid');
  const cashEntry = data.cashEntry;
  const pending = data.isPaid === false || (isRecord(cashEntry) && cashEntry.status === 'pending');
  if (pending) return ZERO(data.type === 'receita' ? 'pending' : 'expense');
  if (data.type === 'despesa') return ZERO('expense');
  return { kind: 'income', contributionCents: data.valueCents };
};

/** O usuário pode tirar o item da estimativa: só o que soma renda. */
export const isExcludableIncome = (classification: IncomeClassification): boolean =>
  (classification.kind === 'income' || classification.kind === 'receivable') && classification.contributionCents > 0;

/** Total oficial de um mês (série do relatório). */
export interface MonthReceipts {
  month: string;
  receiptsCents: number;
  /** O mês ainda não terminou (mês corrente). */
  partial: boolean;
}

/** Um lançamento excluído pelo usuário, já lido e classificado. */
export interface ExcludedIncomeItem {
  id: string;
  /** Mês do lançamento (`AAAA-MM`), ou `null` quando não foi encontrado. */
  month: string | null;
  classification: IncomeClassification | null;
  /**
   * Recebimento de cliente já estornado (o estorno foi lido junto, `excludedItemOf`): no mesmo mês, o
   * estorno anula o valor do recebimento no total oficial, então a exclusão não tira nada.
   */
  reversed?: boolean;
  /** Recebimento cujo estado de estorno não pôde ser confirmado: a estimativa fica suspensa (B01). */
  unconfirmed?: boolean;
}

/**
 * Item desconsiderado a partir do documento lido por id e do espelho do estorno lido junto (ou `null`,
 * sem estorno). Para um recebimento de cliente, o estorno é procurado pelo identificador oficial: o
 * ID do espelho do estorno deriva do movimento do recebimento (`receivableReversal.ts`). O estorno
 * vale quando o próprio documento o confirma: marca de estorno, `reversalOf` igual ao movimento, o
 * mesmo mês e o mesmo principal com o sinal oposto. Com o estorno válido, a contribuição líquida do
 * recebimento no mês é zero, e a exclusão perde o efeito, mesmo com outras receitas mantendo o total
 * do mês acima de zero. Sem como confirmar (o movimento do documento não é o do ID, ou o estorno
 * lido não fecha com o recebimento), o item fica `unconfirmed`, e a estimativa não é mostrada.
 */
export const excludedItemOf = (document: Record<string, unknown>, reversal: Record<string, unknown> | null): ExcludedIncomeItem => {
  const id = String(document.id);
  const month = typeof document.date === 'string' ? document.date.slice(0, 7) : null;
  const classification = classifyIncomeDocument(document);
  if (classification.kind !== 'receivable') return { id, month, classification };
  const entry = document.receivableEntry as Record<string, unknown>;
  const movementId = receiptMovementIdOfMirror(id);
  if (movementId === null || entry.receivableMovementId !== movementId) return { id, month, classification, unconfirmed: true };
  if (reversal === null) return { id, month, classification };
  const reversalEntry = reversal.receivableEntry;
  const reversalClassification = classifyIncomeDocument(reversal);
  const confirmed = isRecord(reversalEntry) &&
    reversalEntry.reversal === true &&
    reversalEntry.reversalOf === movementId &&
    reversalClassification.kind === 'receivable_reversal' &&
    reversalClassification.contributionCents === -classification.contributionCents &&
    typeof reversal.date === 'string' &&
    reversal.date.slice(0, 7) === month;
  if (!confirmed) return { id, month, classification, unconfirmed: true };
  return { id, month, classification: { kind: 'receivable', contributionCents: 0 }, reversed: true };
};

export interface BasisMonth extends MonthReceipts {
  /** Soma das exclusões aplicadas no mês. */
  excludedCents: number;
  excludedCount: number;
  /** Total oficial menos as exclusões aplicadas. */
  eligibleCents: number;
  /** As exclusões deste mês não foram aplicadas (deixariam o mês negativo). */
  exclusionsSkipped: boolean;
}

export interface ExclusionOutcome {
  months: BasisMonth[];
  /** Exclusões sem efeito: fora da janela, não encontradas ou que não somavam renda. */
  ignored: number;
  /** Recebimentos desconsiderados e já estornados, na janela: o estorno anula o valor, e a exclusão não tira nada. */
  reversed: number;
}

/**
 * Aplica as exclusões do usuário sobre o total oficial de cada mês. Um item
 * só é descontado no próprio mês e só quando somava renda. Se a subtração
 * deixasse o mês abaixo de zero (o que só acontece com o relatório ainda
 * atrasado em relação aos lançamentos), as exclusões daquele mês não são
 * aplicadas e o mês é sinalizado: o total oficial prevalece.
 */
export const applyIncomeExclusions = (
  months: readonly MonthReceipts[],
  excluded: readonly ExcludedIncomeItem[],
): ExclusionOutcome => {
  const byMonth = new Map<string, { cents: number; count: number }>();
  let ignored = 0;
  let reversed = 0;
  const windowMonths = new Set(months.map((item) => item.month));
  for (const item of excluded) {
    if (item.reversed && item.month && windowMonths.has(item.month)) {
      reversed += 1;
      continue;
    }
    if (!item.month || !item.classification || !windowMonths.has(item.month) || !isExcludableIncome(item.classification)) {
      ignored += 1;
      continue;
    }
    const current = byMonth.get(item.month) ?? { cents: 0, count: 0 };
    byMonth.set(item.month, {
      cents: current.cents + item.classification.contributionCents,
      count: current.count + 1,
    });
  }
  return {
    ignored,
    reversed,
    months: months.map((month) => {
      const exclusion = byMonth.get(month.month);
      if (!exclusion) {
        return { ...month, excludedCents: 0, excludedCount: 0, eligibleCents: month.receiptsCents, exclusionsSkipped: false };
      }
      const eligible = month.receiptsCents - exclusion.cents;
      if (eligible < 0) {
        return { ...month, excludedCents: 0, excludedCount: 0, eligibleCents: month.receiptsCents, exclusionsSkipped: true };
      }
      return {
        ...month,
        excludedCents: exclusion.cents,
        excludedCount: exclusion.count,
        eligibleCents: eligible,
        exclusionsSkipped: false,
      };
    }),
  };
};

// ------------------------------------------------- painel "Receitas consideradas"

/** Lançamento como o painel o recebe (documento normalizado do módulo de lançamentos). */
export interface IncomeDocument extends Record<string, unknown> {
  id: string;
  date: string;
  valueCents: number;
}

export interface IncomeItemView {
  id: string;
  date: string;
  month: string;
  /** Descrição digitada, só para a pessoa reconhecer o item (nunca para classificar). */
  description: string;
  valueCents: number;
  classification: IncomeClassification;
  excludable: boolean;
  excludedByUser: boolean;
  /**
   * O estorno deste recebimento está na lista. O backend grava o estorno na data do próprio
   * recebimento (`functions/src/receivables/operations.ts`), então os dois ficam sempre no mesmo mês
   * e, no relatório, somam zero nele.
   */
  reversed: boolean;
  /** Outra receita com a mesma data, o mesmo valor e a mesma conta: incerteza sinalizada. */
  possibleDuplicate: boolean;
}

const receivableOf = (document: IncomeDocument) => {
  const entry = document.receivableEntry;
  return isRecord(entry) ? entry : null;
};

/**
 * Itens do painel, do mais recente ao mais antigo. Despesas comuns não
 * aparecem (só estornos de recebimento, que reduzem a receita). A
 * duplicidade é só sinalizada: o sistema não sabe se são dois recebimentos
 * reais, e a pessoa decide.
 */
export const buildIncomeItemViews = (
  documents: readonly IncomeDocument[],
  excludedIds: readonly string[],
): IncomeItemView[] => {
  const excluded = new Set(excludedIds);
  const reversals = new Set<string>();
  for (const document of documents) {
    const entry = receivableOf(document);
    if (entry && entry.reversal === true && typeof entry.reversalOf === 'string') reversals.add(entry.reversalOf);
  }
  const classified = documents
    .map((document) => ({ document, classification: classifyIncomeDocument(document) }))
    .filter(({ classification }) => classification.kind !== 'expense');
  const duplicateKey = (document: IncomeDocument) =>
    `${document.date}|${document.valueCents}|${String(document.type)}|${String(document.cashAccountId ?? '')}`;
  const counts = new Map<string, number>();
  for (const { document, classification } of classified) {
    if (!isExcludableIncome(classification)) continue;
    counts.set(duplicateKey(document), (counts.get(duplicateKey(document)) ?? 0) + 1);
  }
  return classified
    .map(({ document, classification }) => {
      const excludable = isExcludableIncome(classification);
      const entry = receivableOf(document);
      const movementId = entry && typeof entry.receivableMovementId === 'string' ? entry.receivableMovementId : null;
      return {
        id: document.id,
        date: document.date,
        month: document.date.slice(0, 7),
        description: typeof document.description === 'string' ? document.description : '',
        valueCents: document.valueCents,
        classification,
        excludable,
        excludedByUser: excludable && excluded.has(document.id),
        reversed: movementId !== null && reversals.has(movementId),
        possibleDuplicate: excludable && (counts.get(duplicateKey(document)) ?? 0) > 1,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
};

export interface MonthReconciliation {
  month: string;
  /** Soma das contribuições dos itens listados no mês. */
  listedCents: number;
  officialCents: number;
  matches: boolean;
  considered: number;
  excludedByUser: number;
  automatic: number;
}

/** Conferência mês a mês: a lista soma o mesmo que o relatório oficial? */
export const reconcileIncomeMonths = (
  items: readonly IncomeItemView[],
  official: readonly MonthReceipts[],
): MonthReconciliation[] => official.map((month) => {
  const own = items.filter((item) => item.month === month.month);
  const listedCents = own.reduce((sum, item) => sum + item.classification.contributionCents, 0);
  return {
    month: month.month,
    listedCents,
    officialCents: month.receiptsCents,
    matches: listedCents === month.receiptsCents,
    considered: own.filter((item) => item.excludable && !item.excludedByUser).length,
    excludedByUser: own.filter((item) => item.excludedByUser).length,
    automatic: own.filter((item) => !item.excludable).length,
  };
});
