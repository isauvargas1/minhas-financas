/**
 * Leitura simples do domínio patrimonial (Etapa 2, §6 e §7).
 *
 * A tela comum de Investimentos volta a ser a lista do baseline, mas a fonte
 * **não** é `transactions`: é `investment_movements`, o ledger autoritativo.
 * Este módulo transforma um movimento em uma linha da tabela e não faz mais
 * nada — nenhuma leitura, nenhum efeito, nenhum React. É o que permite testá-lo
 * com o runner do Node, que é o único disponível no repositório.
 *
 * Duas decisões estruturais:
 *
 * - **Nada é resolvido por ID na leitura.** Instituição, carteira, categoria e
 *   nome do investimento vêm da fotografia que a Etapa 1 grava no movimento.
 *   Uma página de 20 linhas custa uma consulta, não vinte e uma.
 * - **A linha é o movimento, não o ativo.** Um aporte pendente ainda não tem
 *   posição, e um ativo cujo único movimento foi cancelado não tem nada a
 *   mostrar. Listando movimentos, o pendente aparece desde o primeiro instante
 *   e o cancelado aparece como cancelado — nunca como investimento ativo.
 */

import type { InvestmentMovement } from '../types';

export type SimpleInvestmentKind = 'contribution' | 'withdrawal';

/**
 * Estado visível de um lançamento.
 *
 * Os rótulos do §7 mapeiam um a um; `undone` cobre o lançamento estornado, que
 * o baseline não tinha porque não havia estorno. "Desfeito" é o termo natural
 * — a palavra técnica "reversal" nunca chega à tela.
 */
export type SimpleInvestmentStatus =
  | 'deposited'
  | 'pending'
  | 'awaiting'
  | 'received'
  | 'cancelled'
  | 'undone';

export const SIMPLE_STATUS_LABEL: Record<SimpleInvestmentStatus, string> = {
  deposited: 'Depositado',
  pending: 'Pendente',
  awaiting: 'Aguardando recebimento',
  received: 'Recebido',
  cancelled: 'Cancelado',
  undone: 'Desfeito',
};

export const SIMPLE_KIND_LABEL: Record<SimpleInvestmentKind, string> = {
  contribution: 'Aporte',
  withdrawal: 'Retirada',
};

export interface SimpleInvestmentRow {
  id: string;
  kind: SimpleInvestmentKind;
  status: SimpleInvestmentStatus;
  description: string;
  /**
   * Categoria do investimento, já fotografada no movimento.
   *
   * Lançamentos novos apontam para `category`/`investimento`; os anteriores à
   * unificação, para o grupo histórico `investment_type`. A linha não precisa
   * saber de qual: o nome vem gravado e o ID é a autoridade.
   */
  category: string;
  /** Identificador da categoria — autoridade do vínculo, ao contrário do nome. */
  categoryId?: string;
  /** Carteira de investimento (`investment_class`), já fotografada. */
  portfolio: string;
  portfolioId?: string;
  institution: string;
  institutionId?: string;
  goalId?: string;
  positionId: string;
  /**
   * Valor que o usuário reconhece: no aporte, o que foi aplicado; na retirada,
   * o total sacado — capital mais o rendimento que ele tenha informado.
   */
  valueCents: number;
  /**
   * Parcela de **capital** do lançamento.
   *
   * Igual a `valueCents` no aporte. Na retirada é menor quando o usuário
   * informou rendimento, e é só ela que reduz o capital aplicado — somar o
   * rendimento aqui faria a retirada apagar mais patrimônio do que existiu.
   */
  principalCents: number;
  occurredAt: Date | null;
  /**
   * O lançamento moveu patrimônio de verdade.
   *
   * Pendente, cancelado e desfeito ficam de fora: os dois primeiros têm todos
   * os deltas em zero por contrato, e o terceiro foi compensado por um
   * movimento de estorno. É esta bandeira que sustenta as invariantes do §12.
   */
  effective: boolean;
}

/** Operações que a tela simples representa. As demais são infraestrutura. */
const LISTABLE_OPERATIONS = new Set(['contribution', 'redemption']);

/**
 * O movimento pertence à lista simples?
 *
 * `goal_link` e `goal_unlink` são vínculo de meta, não lançamento de dinheiro.
 * `reversal` é o movimento compensatório de um estorno: exibi-lo criaria duas
 * linhas para um fato só. O lançamento original é quem passa a "Desfeito".
 */
export const isListableSimpleMovement = (
  movement: Pick<InvestmentMovement, 'operation'>,
): boolean => LISTABLE_OPERATIONS.has(movement.operation);

export const toDateOrNull = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { toDate?: unknown; seconds?: unknown };
    if (typeof candidate.toDate === 'function') {
      const parsed = (candidate as { toDate(): Date }).toDate();
      return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
    }
    if (typeof candidate.seconds === 'number') return new Date(candidate.seconds * 1000);
  }
  return null;
};

const statusOf = (
  kind: SimpleInvestmentKind,
  movement: Pick<InvestmentMovement, 'status' | 'reversedByMovementId'>,
): SimpleInvestmentStatus => {
  if (movement.status === 'cancelled') return 'cancelled';
  if (movement.status === 'pending') return kind === 'contribution' ? 'pending' : 'awaiting';
  if (movement.reversedByMovementId) return 'undone';
  return kind === 'contribution' ? 'deposited' : 'received';
};

/**
 * Movimento do ledger → linha da tabela.
 *
 * O valor da retirada soma capital e rendimento porque é o total que entrou na
 * conta do usuário — o backend guarda os dois separados justamente para não
 * confundir capital com resultado, e a tela mostra a soma, que é o que a
 * pessoa viu no extrato.
 */
export const toSimpleInvestmentRow = (movement: InvestmentMovement): SimpleInvestmentRow => {
  const kind: SimpleInvestmentKind =
    movement.operation === 'redemption' ? 'withdrawal' : 'contribution';
  const status = statusOf(kind, movement);
  const valueCents = kind === 'withdrawal'
    ? movement.principalCents + (movement.gainCents ?? 0)
    : movement.principalCents;
  return {
    id: movement.id,
    kind,
    status,
    description: movement.description,
    category: movement.typeName ?? '',
    categoryId: movement.typeId,
    portfolio: movement.className ?? '',
    portfolioId: movement.classId,
    institution: movement.institutionName ?? '',
    institutionId: movement.institutionId,
    goalId: movement.goalId,
    positionId: movement.positionId,
    valueCents,
    principalCents: movement.principalCents,
    occurredAt: toDateOrNull(movement.occurredAt),
    effective: status === 'deposited' || status === 'received',
  };
};

export const toSimpleInvestmentRows = (movements: InvestmentMovement[]): SimpleInvestmentRow[] =>
  movements.filter(isListableSimpleMovement).map(toSimpleInvestmentRow);

// ---------------------------------------------------------------------------
// Filtros da tela — os mesmos quatro do baseline, sobre a fonte nova.
// ---------------------------------------------------------------------------

export interface SimpleInvestmentFilters {
  search: string;
  category: string;
  /** Identificador da meta, `sem-meta`, ou `todas`. Nunca o rótulo. */
  goal: string;
  status: string;
}

export const EMPTY_SIMPLE_FILTERS: SimpleInvestmentFilters = {
  search: '',
  category: 'todas',
  goal: 'todas',
  status: 'todos',
};

/** Valor do filtro de meta para o lançamento sem vínculo. */
export const SIMPLE_GOAL_NONE = 'sem-meta';

export const hasActiveSimpleFilters = (filters: SimpleInvestmentFilters): boolean =>
  Boolean(filters.search) ||
  filters.category !== 'todas' ||
  filters.goal !== 'todas' ||
  filters.status !== 'todos';

/**
 * Recorte que a consulta pode aplicar no servidor (Etapa 3, §0.C).
 *
 * Só entram combinações cobertas por índice **já existente** em
 * `firestore.indexes.json` — `status+occurredAt`, `operation+occurredAt`,
 * `status+operation+occurredAt` e `goalId+occurredAt`. Combinar meta com
 * estado exigiria um índice novo para uma consulta que ninguém pediu, então a
 * meta só desce ao servidor quando o estado está em "Todos"; o que sobra é
 * refinado sobre a página carregada.
 *
 * "Desfeitos" não desce: o estado vem de `reversedByMovementId`, que é
 * presença de campo e não igualdade. E "Depositados"/"Recebidos" descem como
 * liquidados — o estorno é descartado na página, porque um movimento estornado
 * continua `settled` no ledger.
 */
export interface SimpleMovementQueryFilter {
  status?: string;
  operation?: string;
  goalId?: string;
}

const STATUS_QUERY: Record<string, SimpleMovementQueryFilter> = {
  deposited: { status: 'settled', operation: 'contribution' },
  pending: { status: 'pending', operation: 'contribution' },
  awaiting: { status: 'pending', operation: 'redemption' },
  received: { status: 'settled', operation: 'redemption' },
  cancelled: { status: 'cancelled' },
};

export const simpleMovementQueryFilter = (
  filters: SimpleInvestmentFilters,
): SimpleMovementQueryFilter => {
  const byStatus = STATUS_QUERY[filters.status];
  if (byStatus) return byStatus;
  if (filters.status === 'todos' && filters.goal !== 'todas' && filters.goal !== SIMPLE_GOAL_NONE) {
    return { goalId: filters.goal };
  }
  return {};
};

const normalize = (value: unknown): string =>
  String(value ?? '').trim().toLocaleLowerCase('pt-BR');

/** Nome da meta da linha, com as mesmas três leituras do baseline. */
export const simpleGoalLabel = (
  row: SimpleInvestmentRow,
  goalNames: Map<string, string>,
): string => {
  if (!row.goalId) return 'Sem meta';
  return goalNames.get(row.goalId) ?? 'Meta removida';
};

const matchesGoalFilter = (row: SimpleInvestmentRow, goal: string): boolean => {
  if (goal === 'todas') return true;
  if (goal === SIMPLE_GOAL_NONE) return !row.goalId;
  return row.goalId === goal;
};

export const filterSimpleInvestmentRows = (
  rows: SimpleInvestmentRow[],
  filters: SimpleInvestmentFilters,
  goalNames: Map<string, string>,
): SimpleInvestmentRow[] => {
  const term = normalize(filters.search);
  return rows.filter((row) => {
    if (filters.category !== 'todas' && row.category !== filters.category) return false;
    if (!matchesGoalFilter(row, filters.goal)) return false;
    if (filters.status !== 'todos' && row.status !== filters.status) return false;
    if (term.length === 0) return true;
    return [
      row.description,
      row.category,
      row.portfolio,
      row.institution,
      SIMPLE_STATUS_LABEL[row.status],
      SIMPLE_KIND_LABEL[row.kind],
      simpleGoalLabel(row, goalNames),
      row.occurredAt ? row.occurredAt.toLocaleDateString('pt-BR') : '',
    ].some((field) => normalize(field).includes(term));
  });
};

export type SimpleSortKey = 'description' | 'category' | 'status' | 'date' | 'value';
export interface SimpleSortConfig { key: SimpleSortKey; direction: 'ascending' | 'descending' }

export const DEFAULT_SIMPLE_SORT: SimpleSortConfig = { key: 'date', direction: 'descending' };

const sortValue = (row: SimpleInvestmentRow, key: SimpleSortKey): string | number => {
  if (key === 'description') return normalize(row.description);
  if (key === 'category') return normalize(row.category);
  if (key === 'status') return normalize(SIMPLE_STATUS_LABEL[row.status]);
  if (key === 'value') return row.valueCents;
  return row.occurredAt ? row.occurredAt.getTime() : 0;
};

export const sortSimpleInvestmentRows = (
  rows: SimpleInvestmentRow[],
  sort: SimpleSortConfig,
): SimpleInvestmentRow[] => {
  const factor = sort.direction === 'ascending' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = sortValue(left, sort.key);
    const b = sortValue(right, sort.key);
    if (a < b) return -1 * factor;
    if (a > b) return 1 * factor;
    return 0;
  });
};

/** Categorias presentes nas linhas carregadas, para o filtro de Categoria. */
export const simpleCategoryOptions = (rows: SimpleInvestmentRow[]): string[] =>
  Array.from(new Set(rows.map((row) => row.category).filter((name) => name.length > 0)))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

export interface SimpleGoalFilterOption { value: string; label: string }

/**
 * Opções do filtro de Meta, com identificador no valor.
 *
 * O baseline usava o nome como valor; duas metas homônimas colapsavam em uma
 * só e nada podia descer ao servidor. O rótulo continua sendo o do baseline.
 */
export const simpleGoalOptions = (
  rows: SimpleInvestmentRow[],
  goalNames: Map<string, string>,
): SimpleGoalFilterOption[] => {
  const options = new Map<string, string>();
  rows.forEach((row) => {
    const value = row.goalId ?? SIMPLE_GOAL_NONE;
    if (!options.has(value)) options.set(value, simpleGoalLabel(row, goalNames));
  });
  return Array.from(options.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
};
