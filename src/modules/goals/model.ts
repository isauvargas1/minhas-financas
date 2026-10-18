/**
 * Modelo de apresentação das metas (P5-B, D-31). Módulo PURO: sem React, sem
 * Firebase, imports com extensão `.ts` — roda direto no runner do Node.
 *
 * O frontend não calcula progresso financeiro. O backend persiste (manual e
 * investimentos) ou calcula (indicadores PJ) o valor; aqui só se escolhe a
 * **única** fonte declarada em `progressSource`, sem fallback entre campos,
 * e se apresenta o resultado: percentuais em pontos-base inteiros, valores em
 * centavos inteiros, datas civis `AAAA-MM-DD` de America/Sao_Paulo.
 */
import type {
  BusinessGoalType,
  Goal,
  GoalCategory,
  GoalDefinition,
  GoalHorizon,
  GoalPeriod,
  GoalPriority,
  GoalProgressBasis,
  GoalProgressSource,
  GoalStatus,
} from '../../types.ts';

// ---------------------------------------------------------------------------
// Constantes do contrato
// ---------------------------------------------------------------------------

/** Teto de valores de meta: R$ 100 bilhões, em centavos. */
export const MAX_GOAL_CENTS = 10_000_000_000_000;
/** Margem-alvo máxima: 100%, em pontos-base. */
export const MAX_GOAL_BASIS_POINTS = 10_000;
/** Metas por chamada de indicador PJ. */
export const MAX_KPI_GOALS_PER_CALL = 25;
/** Metas por página da lista (a consulta pede uma a mais como sonda). */
export const GOALS_PAGE_SIZE = 25;
/** Entradas do histórico de progresso manual por consulta. */
export const MANUAL_HISTORY_LIMIT = 20;

export const GOAL_TIME_ZONE = 'America/Sao_Paulo';

export const GOAL_STATUSES: readonly GoalStatus[] = ['em_andamento', 'alcancada', 'pausada', 'cancelada'];
const CATEGORIES: readonly GoalCategory[] = [
  'reserva_emergencia', 'viagem', 'veiculo', 'imovel', 'eletronicos', 'educacao', 'patrimonio', 'outro',
];
const PRIORITIES: readonly GoalPriority[] = ['baixa', 'media', 'alta'];
const HORIZONS: readonly GoalHorizon[] = ['curto', 'medio', 'longo'];
const SOURCES: readonly GoalProgressSource[] = ['manual', 'investment', 'business_kpi'];
const BASES: readonly GoalProgressBasis[] = ['net_contributions', 'current_value'];
const BUSINESS_TYPES: readonly BusinessGoalType[] = [
  'faturamento', 'lucro', 'margem', 'caixa_minimo', 'reducao_custos', 'investimento',
];
const PERIODS: readonly GoalPeriod[] = ['mensal', 'trimestral', 'semestral', 'anual', 'custom'];
const PROGRESS_BAR_TYPES = ['linear', 'circular'] as const;

export type BusinessKpiType = Exclude<BusinessGoalType, 'investimento'>;

/** Rótulos dos indicadores (regime de caixa realizado), exatamente os do contrato. */
export const BUSINESS_TYPE_LABELS: Record<BusinessGoalType, string> = {
  faturamento: 'Recebimentos operacionais realizados',
  lucro: 'Resultado operacional de caixa',
  margem: 'Margem operacional de caixa',
  caixa_minimo: 'Saldo disponível em contas',
  reducao_custos: 'Limite de despesas operacionais',
  investimento: 'Investimento',
};

export const GOAL_CASH_REGIME_NOTE = 'Regime de caixa; compras no cartão de crédito não entram.';

/**
 * Centro de custo é metadado informativo da meta: os indicadores PJ
 * automáticos usam os valores gerais do workspace (segmentação por centro de
 * custo depende da D-37/P5-C).
 */
export const GOAL_COST_CENTER_NOTE =
  'Informativo: não filtra os indicadores automáticos, que usam os valores gerais da empresa.';

/** Nota do detalhe de um indicador PJ com centro de custo. */
export const GOAL_COST_CENTER_KPI_NOTE =
  'O centro de custo é informativo: este indicador usa os valores gerais da empresa, sem filtrar por centro de custo.';

/** Indicadores que carregam a nota de regime de caixa: resultado, margem e limite. */
export const businessTypeNeedsCashNote = (businessType: BusinessGoalType | undefined): boolean =>
  businessType === 'lucro' || businessType === 'margem' || businessType === 'reducao_custos';

export const businessTypeLabel = (businessType: BusinessGoalType | undefined): string =>
  businessType ? BUSINESS_TYPE_LABELS[businessType] : '';

export const PERIOD_LABELS: Record<GoalPeriod, string> = {
  mensal: 'Mensal',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
  custom: 'Personalizado',
};

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  em_andamento: 'Em andamento',
  alcancada: 'Concluída',
  pausada: 'Pausada',
  cancelada: 'Cancelada',
};

// ---------------------------------------------------------------------------
// Datas civis (America/Sao_Paulo)
// ---------------------------------------------------------------------------

export const isCivilDate = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2999 || month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
};

const civilFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: GOAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data civil `AAAA-MM-DD` de um instante, no fuso de São Paulo. */
export const civilDateKey = (instant: Date = new Date()): string => {
  const parts = civilFormatter.formatToParts(instant);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
};

/** Dias desde 1970-01-01 de uma data civil (UTC puro, sem fuso). */
export const civilDayNumber = (key: string): number => {
  const [year, month, day] = key.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
};

/** `AAAA-MM-DD` → `dd/mm/aaaa`; valor inválido → `—`. */
export const formatCivilDate = (key: string | undefined): string => {
  if (!isCivilDate(key)) return '—';
  return `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
};

/** ISO (ou Date) → `dd/mm/aaaa` no fuso de São Paulo. */
export const formatInstantDate = (value: string | Date | undefined): string => {
  if (!value) return '—';
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return '—';
  return formatCivilDate(civilDateKey(instant));
};

/** Soma meses a uma data civil, limitando o dia ao fim do mês de destino. */
export const addMonthsToCivilDate = (key: string, months: number): string => {
  const [year, month, day] = key.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(day, lastDay))}`;
};

/** Meses civis inteiros entre duas datas (diferença de ano/mês, sem dia). */
export const monthsBetweenCivilDates = (from: string, to: string): number => {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
};

/** Horizonte da meta pela distância entre as datas civis. */
export const goalHorizon = (startDate: string, deadline: string): GoalHorizon => {
  const years = monthsBetweenCivilDates(startDate, deadline) / 12;
  if (years <= 1) return 'curto';
  if (years <= 5) return 'medio';
  return 'longo';
};

// ---------------------------------------------------------------------------
// Formatação e entrada de valores
// ---------------------------------------------------------------------------

const BRL = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'});

/** Centavos → `R$ 1.234,56`. Valor não inteiro é recusado, não arredondado. */
export const formatCents = (cents: number): string =>
  BRL.format((Number.isSafeInteger(cents) ? cents : 0) / 100);

const BRL_WHOLE = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

/**
 * Centavos → `R$ 1.235` (reais inteiros), só para exibição nos cartões da
 * lista, que já mostravam o valor sem centavos. Não é usado em cálculo.
 */
export const formatCentsWhole = (cents: number): string =>
  BRL_WHOLE.format((Number.isSafeInteger(cents) ? cents : 0) / 100);

/** Pontos-base → `12,34%` (sempre duas casas). */
export const formatBasisPoints = (basisPoints: number): string => {
  const value = Number.isSafeInteger(basisPoints) ? basisPoints : 0;
  const abs = Math.abs(value);
  const integer = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimals = String(abs % 100).padStart(2, '0');
  return `${value < 0 ? '-' : ''}${integer},${decimals}%`;
};

/** Pontos-base → percentual inteiro truncado (`45%`), para os cartões. */
export const formatBasisPointsShort = (basisPoints: number): string => {
  const value = Number.isSafeInteger(basisPoints) ? basisPoints : 0;
  return `${Math.trunc(value / 100)}%`;
};

const NBSP = / /g;

/**
 * Valor em reais digitado → centavos inteiros, ou `null`. Sem ponto flutuante:
 * o texto é lido por dígitos. Aceita `1500`, `1500,5`, `1.500,00`, `R$ 1.500,00`
 * e `1500.50` (um ponto com uma ou duas casas). Recusa sinal, expoente, mais de
 * duas casas (fração abaixo do centavo), zero (salvo `allowZero`) e acima do teto.
 */
export const parseReaisToCents = (
  input: string,
  options: {allowZero?: boolean} = {},
): number | null => {
  if (typeof input !== 'string') return null;
  const text = input.replace(NBSP, ' ').trim().replace(/^R\$\s*/, '');
  let integerDigits: string;
  let decimals = '';
  let match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(text);
  if (match) {
    integerDigits = match[1].replace(/\./g, '');
    decimals = match[2] ?? '';
  } else {
    match = /^(\d+)\.(\d{1,2})$/.exec(text);
    if (!match) return null;
    integerDigits = match[1];
    decimals = match[2];
  }
  if (integerDigits.length > 14) return null;
  const cents = Number(integerDigits) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_GOAL_CENTS) return null;
  if (cents === 0 && !options.allowZero) return null;
  return cents;
};

/**
 * Percentual digitado → pontos-base (1..10.000), ou `null`. `12,34` → 1.234;
 * `100` → 10.000. Vírgula ou ponto decimal, `%` opcional no fim; mais de duas
 * casas, zero e acima de 100% são recusados.
 */
export const parsePercentToBasisPoints = (input: string): number | null => {
  if (typeof input !== 'string') return null;
  const text = input.replace(NBSP, ' ').trim().replace(/\s*%$/, '');
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (basisPoints < 1 || basisPoints > MAX_GOAL_BASIS_POINTS) return null;
  return basisPoints;
};

/** Centavos → texto do campo (`1.234,56`), sem `R$`. Só para preencher. */
export const centsToInput = (cents: number): string => {
  if (!Number.isSafeInteger(cents) || cents < 0) return '';
  const reais = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${reais},${String(cents % 100).padStart(2, '0')}`;
};

/** Pontos-base → texto do campo (`12,34`), sem `%`. Só para preencher. */
export const basisPointsToInput = (basisPoints: number): string => {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) return '';
  const decimals = String(basisPoints % 100).padStart(2, '0').replace(/0+$/, '');
  return `${Math.floor(basisPoints / 100)}${decimals ? `,${decimals}` : ''}`;
};

/** `valor / alvo` em pontos-base, aritmética inteira (trunca); alvo ≤ 0 → 0. */
export const ratioBasisPoints = (value: number, target: number): number => {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(target) || target <= 0) return 0;
  return Number((BigInt(value) * 10_000n) / BigInt(target));
};

// ---------------------------------------------------------------------------
// Mapeamento do documento persistido
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);
const isNonNegativeInt = (value: unknown): value is number => isInt(value) && value >= 0;
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/** Timestamp do Firestore (duck-typed), `Date` ou texto ISO → ISO; senão `undefined`. */
export const timestampToIso = (value: unknown): string | undefined => {
  if (typeof value === 'string') return Number.isNaN(Date.parse(value)) ? undefined : value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (isRecord(value) && typeof value.toMillis === 'function') {
    const millis = (value as {toMillis: () => number}).toMillis();
    return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
  }
  return undefined;
};

/** Meta de margem usa pontos-base como alvo; as demais, centavos. */
export const isMarginGoal = (goal: Pick<Goal, 'progressSource' | 'businessType'>): boolean =>
  goal.progressSource === 'business_kpi' && goal.businessType === 'margem';

/**
 * Documento `goals/{id}` → `Goal`, ou `null` se não seguir o contrato. Validação
 * mínima e **sem fallback entre campos**: nada é inferido de campo removido.
 */
export const mapGoalDocument = (id: string, data: unknown): Goal | null => {
  if (!id || !isRecord(data)) return null;
  const {
    name, category, priority, status, startDate, deadline, horizon, visual,
    progressSource, priorityRank, archived, revision,
  } = data;
  if (typeof name !== 'string' || name.length === 0) return null;
  if (!isOneOf(CATEGORIES, category) || !isOneOf(PRIORITIES, priority)) return null;
  if (!isOneOf(GOAL_STATUSES, status) || !isOneOf(HORIZONS, horizon)) return null;
  if (!isCivilDate(startDate) || !isCivilDate(deadline)) return null;
  if (!isOneOf(SOURCES, progressSource)) return null;
  if (priorityRank !== 1 && priorityRank !== 2 && priorityRank !== 3) return null;
  if (typeof archived !== 'boolean') return null;
  if (!isInt(revision) || revision < 1) return null;
  if (!isRecord(visual) || typeof visual.color !== 'string' || typeof visual.icon !== 'string' ||
    !isOneOf(PROGRESS_BAR_TYPES, visual.progressBarType)) {
    return null;
  }
  if (data.description !== undefined && typeof data.description !== 'string') return null;
  if (data.costCenter !== undefined && typeof data.costCenter !== 'string') return null;

  const goal: Goal = {
    id,
    name,
    category,
    priority,
    priorityRank,
    status,
    startDate,
    deadline,
    horizon,
    progressSource,
    visual: {
      color: visual.color,
      icon: visual.icon,
      progressBarType: visual.progressBarType,
      ...(typeof visual.emoji === 'string' ? {emoji: visual.emoji} : {}),
      ...(typeof visual.coverImage === 'string' ? {coverImage: visual.coverImage} : {}),
    },
    archived,
    revision,
    ...(typeof data.description === 'string' ? {description: data.description} : {}),
    ...(typeof data.costCenter === 'string' ? {costCenter: data.costCenter} : {}),
    ...(typeof data.archiveReason === 'string' ? {archiveReason: data.archiveReason} : {}),
  };
  const stamps: Array<[keyof Goal, unknown]> = [
    ['createdAt', data.createdAt],
    ['updatedAt', data.updatedAt],
    ['statusUpdatedAt', data.statusUpdatedAt],
    ['archivedAt', data.archivedAt],
  ];
  for (const [key, raw] of stamps) {
    const iso = timestampToIso(raw);
    if (iso) (goal as unknown as Record<string, unknown>)[key] = iso;
  }

  switch (progressSource) {
  case 'manual': {
    if (!isNonNegativeInt(data.manualProgressCents)) return null;
    goal.manualProgressCents = data.manualProgressCents;
    const updatedAt = timestampToIso(data.manualProgressUpdatedAt);
    if (updatedAt) goal.manualProgressUpdatedAt = updatedAt;
    break;
  }
  case 'investment': {
    if (!isOneOf(BASES, data.progressBasis)) return null;
    goal.progressBasis = data.progressBasis;
    if (data.businessType !== undefined) {
      if (data.businessType !== 'investimento') return null;
      goal.businessType = 'investimento';
    }
    for (const key of [
      'investmentNetContributionCents', 'investmentCurrentValueCents', 'investmentProgressCents',
    ] as const) {
      const value = data[key];
      if (value === undefined) continue;
      if (!isNonNegativeInt(value)) return null;
      goal[key] = value;
    }
    break;
  }
  case 'business_kpi': {
    if (!isOneOf(BUSINESS_TYPES, data.businessType) || data.businessType === 'investimento') return null;
    goal.businessType = data.businessType;
    if (data.businessType !== 'caixa_minimo') {
      if (!isOneOf(PERIODS, data.period)) return null;
      goal.period = data.period;
    }
    break;
  }
  }

  if (isMarginGoal(goal)) {
    if (!isInt(data.targetBasisPoints) || data.targetBasisPoints < 1 ||
      data.targetBasisPoints > MAX_GOAL_BASIS_POINTS) {
      return null;
    }
    goal.targetBasisPoints = data.targetBasisPoints;
  } else {
    if (!isInt(data.targetAmountCents) || data.targetAmountCents < 1 ||
      data.targetAmountCents > MAX_GOAL_CENTS) {
      return null;
    }
    goal.targetAmountCents = data.targetAmountCents;
  }
  return goal;
};

// ---------------------------------------------------------------------------
// Visão geral e indicadores PJ (resposta das callables)
// ---------------------------------------------------------------------------

export interface GoalsOverview {
  activeCount: number;
  byStatus: Record<GoalStatus, number>;
}

export const parseGoalsOverview = (data: unknown): GoalsOverview => {
  if (!isRecord(data) || !isNonNegativeInt(data.activeCount) || !isRecord(data.byStatus)) {
    throw new Error('Resposta inválida do resumo de metas.');
  }
  const byStatus = {} as Record<GoalStatus, number>;
  for (const status of GOAL_STATUSES) {
    const count = data.byStatus[status];
    if (!isNonNegativeInt(count)) throw new Error('Resposta inválida do resumo de metas.');
    byStatus[status] = count;
  }
  return {activeCount: data.activeCount, byStatus};
};

export interface GoalKpiWindow {
  startDate: string;
  endDate: string;
}

export type GoalKpiResult =
  | {
    goalId: string;
    status: 'ok';
    businessType: 'faturamento' | 'lucro' | 'reducao_custos';
    unit: 'cents';
    valueCents: number;
    window: GoalKpiWindow;
    components: {receiptsCents: number; expensesCents: number};
  }
  | {
    goalId: string;
    status: 'ok';
    businessType: 'margem';
    unit: 'basis_points';
    valueBasisPoints: number;
    window: GoalKpiWindow;
    components: {receiptsCents: number; expensesCents: number};
  }
  | {
    goalId: string;
    status: 'ok';
    businessType: 'caixa_minimo';
    unit: 'cents';
    valueCents: number;
    asOf: string;
  }
  | {goalId: string; status: 'unavailable'; reason: string; message: string};

/** Estado de um indicador ainda sem resultado (carregando ou com falha). */
export type GoalKpiPending = {status: 'loading'} | {status: 'error'};
export type GoalKpiInput = GoalKpiResult | GoalKpiPending;

const MALFORMED_KPI = 'Resposta inválida dos indicadores da meta.';

const parseWindow = (value: unknown): GoalKpiWindow => {
  if (!isRecord(value) || !isCivilDate(value.startDate) || !isCivilDate(value.endDate)) {
    throw new Error(MALFORMED_KPI);
  }
  return {startDate: value.startDate, endDate: value.endDate};
};

const parseComponents = (value: unknown): {receiptsCents: number; expensesCents: number} => {
  if (!isRecord(value) || !isInt(value.receiptsCents) || !isInt(value.expensesCents)) {
    throw new Error(MALFORMED_KPI);
  }
  return {receiptsCents: value.receiptsCents, expensesCents: value.expensesCents};
};

export const parseGoalKpiResults = (data: unknown): GoalKpiResult[] => {
  if (!isRecord(data) || !Array.isArray(data.results)) throw new Error(MALFORMED_KPI);
  return data.results.map((raw): GoalKpiResult => {
    if (!isRecord(raw) || typeof raw.goalId !== 'string') throw new Error(MALFORMED_KPI);
    if (raw.status === 'unavailable') {
      if (typeof raw.message !== 'string' || raw.message.length === 0) throw new Error(MALFORMED_KPI);
      return {
        goalId: raw.goalId,
        status: 'unavailable',
        reason: typeof raw.reason === 'string' ? raw.reason : '',
        message: raw.message,
      };
    }
    if (raw.status !== 'ok') throw new Error(MALFORMED_KPI);
    switch (raw.businessType) {
    case 'faturamento':
    case 'lucro':
    case 'reducao_custos':
      if (raw.unit !== 'cents' || !isInt(raw.valueCents)) throw new Error(MALFORMED_KPI);
      return {
        goalId: raw.goalId, status: 'ok', businessType: raw.businessType, unit: 'cents',
        valueCents: raw.valueCents, window: parseWindow(raw.window),
        components: parseComponents(raw.components),
      };
    case 'margem':
      if (raw.unit !== 'basis_points' || !isInt(raw.valueBasisPoints)) throw new Error(MALFORMED_KPI);
      return {
        goalId: raw.goalId, status: 'ok', businessType: 'margem', unit: 'basis_points',
        valueBasisPoints: raw.valueBasisPoints, window: parseWindow(raw.window),
        components: parseComponents(raw.components),
      };
    case 'caixa_minimo':
      if (raw.unit !== 'cents' || !isInt(raw.valueCents) || typeof raw.asOf !== 'string') {
        throw new Error(MALFORMED_KPI);
      }
      return {
        goalId: raw.goalId, status: 'ok', businessType: 'caixa_minimo', unit: 'cents',
        valueCents: raw.valueCents, asOf: raw.asOf,
      };
    default:
      throw new Error(MALFORMED_KPI);
    }
  });
};

// ---------------------------------------------------------------------------
// Progresso exibido: uma fonte por meta, sem fallback
// ---------------------------------------------------------------------------

export type GoalProgressView =
  | {state: 'loading'}
  | {state: 'error'; message: string}
  | {state: 'unavailable'; message: string}
  | {
    state: 'ready';
    unit: 'cents' | 'basis_points';
    value: number;
    target: number;
    /** `valor / alvo` em pontos-base (trunca; pode passar de 10.000 ou ser negativo). */
    percentBasisPoints: number;
    /** Largura da barra, limitada a 0..10.000. */
    barBasisPoints: number;
    /** Progresso ≥ alvo. Não é o status 'alcancada'. */
    reached: boolean;
    /** Meta de limite de despesas com consumo acima do limite. */
    overLimit: boolean;
    /** Alvo atingido no sentido da meta (nunca para limite de despesas). */
    achieved: boolean;
    valueText: string;
    targetText: string;
    percentText: string;
    percentShortText: string;
    window?: GoalKpiWindow;
    asOf?: string;
  };

export const KPI_ERROR_MESSAGE = 'Não foi possível calcular o indicador agora. Tente novamente mais tarde.';

export const goalTarget = (goal: Goal): number =>
  isMarginGoal(goal) ? goal.targetBasisPoints ?? 0 : goal.targetAmountCents ?? 0;

/** Alvo formatado (centavos, ou percentual na meta de margem) mesmo sem progresso. */
export const goalTargetText = (goal: Goal): string =>
  isMarginGoal(goal) ? formatBasisPoints(goalTarget(goal)) : formatCents(goalTarget(goal));

const readyView = (
  goal: Goal,
  unit: 'cents' | 'basis_points',
  value: number,
  extra: {window?: GoalKpiWindow; asOf?: string} = {},
): GoalProgressView => {
  const target = goalTarget(goal);
  const percentBasisPoints = ratioBasisPoints(value, target);
  const isLimit = goal.businessType === 'reducao_custos';
  const reached = target > 0 && value >= target;
  const format = unit === 'basis_points' ? formatBasisPoints : formatCents;
  return {
    state: 'ready',
    unit,
    value,
    target,
    percentBasisPoints,
    barBasisPoints: Math.min(10_000, Math.max(0, percentBasisPoints)),
    reached,
    overLimit: isLimit && target > 0 && value > target,
    achieved: reached && !isLimit,
    valueText: format(value),
    targetText: format(target),
    percentText: formatBasisPoints(percentBasisPoints),
    percentShortText: formatBasisPointsShort(percentBasisPoints),
    ...extra,
  };
};

/**
 * Progresso da meta, a partir de **uma** fonte:
 * - `manual`: `manualProgressCents`;
 * - `investment`: `investmentProgressCents` (ausente = 0);
 * - `business_kpi`: resultado de `getGoalKpiProgress` (`kpi`); sem ele, carregando.
 */
export const goalProgressView = (goal: Goal, kpi?: GoalKpiInput): GoalProgressView => {
  switch (goal.progressSource) {
  case 'manual':
    return readyView(goal, 'cents', goal.manualProgressCents ?? 0);
  case 'investment':
    return readyView(goal, 'cents', goal.investmentProgressCents ?? 0);
  case 'business_kpi': {
    if (!kpi || kpi.status === 'loading') return {state: 'loading'};
    if (kpi.status === 'error') return {state: 'error', message: KPI_ERROR_MESSAGE};
    if (kpi.status === 'unavailable') return {state: 'unavailable', message: kpi.message};
    if (kpi.goalId !== goal.id || kpi.businessType !== goal.businessType) {
      return {state: 'error', message: KPI_ERROR_MESSAGE};
    }
    if (kpi.businessType === 'margem') {
      return readyView(goal, 'basis_points', kpi.valueBasisPoints, {window: kpi.window});
    }
    if (kpi.businessType === 'caixa_minimo') {
      return readyView(goal, 'cents', kpi.valueCents, {asOf: kpi.asOf});
    }
    return readyView(goal, 'cents', kpi.valueCents, {window: kpi.window});
  }
  }
};

/** Metas cujo progresso depende de `getGoalKpiProgress`. */
export const kpiGoalIds = (goals: readonly Goal[]): string[] =>
  goals.filter((goal) => goal.progressSource === 'business_kpi').map((goal) => goal.id);

export const chunkKpiGoalIds = (ids: readonly string[]): string[][] => {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += MAX_KPI_GOALS_PER_CALL) {
    chunks.push(ids.slice(index, index + MAX_KPI_GOALS_PER_CALL));
  }
  return chunks;
};

// ---------------------------------------------------------------------------
// Ritmo da meta (datas civis, inteiros)
// ---------------------------------------------------------------------------

export type GoalPaceStatus =
  | 'neutral'
  | 'completed'
  | 'missed'
  | 'on_track'
  | 'warning'
  | 'off_track'
  | 'off_track_high';

interface ElapsedTime {
  totalDays: number;
  elapsedDays: number;
  /** Tempo decorrido em pontos-base, nunca negativo. */
  timeBasisPoints: number;
}

const elapsedTime = (goal: Pick<Goal, 'startDate' | 'deadline'>, today: string): ElapsedTime => {
  const totalDays = civilDayNumber(goal.deadline) - civilDayNumber(goal.startDate);
  const elapsedDays = civilDayNumber(today) - civilDayNumber(goal.startDate);
  const timeBasisPoints = totalDays > 0 && elapsedDays > 0
    ? Math.floor((elapsedDays * 10_000) / totalDays)
    : 0;
  return {totalDays, elapsedDays, timeBasisPoints};
};

/**
 * Ritmo da meta em andamento: tempo decorrido × progresso, em pontos-base.
 * Para limite de despesas, estar acima do ritmo é ruim.
 */
export const goalPaceStatus = (
  goal: Goal,
  view: GoalProgressView,
  today: string = civilDateKey(),
): GoalPaceStatus => {
  if (goal.status !== 'em_andamento' || view.state !== 'ready') return 'neutral';
  if (today >= goal.deadline) {
    // Limite de despesas: cumprida é terminar dentro do limite.
    if (goal.businessType === 'reducao_custos') return view.overLimit ? 'missed' : 'completed';
    return view.reached ? 'completed' : 'missed';
  }
  const {timeBasisPoints} = elapsedTime(goal, today);
  const valueBasisPoints = view.percentBasisPoints;
  if (goal.businessType === 'reducao_custos') {
    return valueBasisPoints > timeBasisPoints + 1000 ? 'off_track_high' : 'on_track';
  }
  if (valueBasisPoints * 100 >= timeBasisPoints * 95) return 'on_track';
  if (valueBasisPoints * 100 >= timeBasisPoints * 70) return 'warning';
  return 'off_track';
};

export type GoalHealthBadge =
  | 'paused'
  | 'cancelled'
  | 'completed'
  | 'target_reached'
  | 'on_track'
  | 'warning'
  | 'late';

/**
 * Selo da meta pessoal. Status persistido e alvo atingido são coisas distintas:
 * 'completed' só vem do status 'alcancada'; 'target_reached' é progresso ≥ alvo.
 */
export const goalHealthBadge = (
  goal: Goal,
  view: GoalProgressView,
  today: string = civilDateKey(),
): GoalHealthBadge | null => {
  if (goal.status === 'pausada') return 'paused';
  if (goal.status === 'cancelada') return 'cancelled';
  if (goal.status === 'alcancada') return 'completed';
  if (view.state !== 'ready') return null;
  if (view.achieved) return 'target_reached';
  if (today < goal.startDate) return null;
  const {timeBasisPoints} = elapsedTime(goal, today);
  if (view.percentBasisPoints * 100 >= timeBasisPoints * 90) return 'on_track';
  if (view.percentBasisPoints * 100 >= timeBasisPoints * 70) return 'warning';
  return 'late';
};

/** Aporte mensal sugerido em centavos (0 = sem sugestão). */
export const monthlySuggestionCents = (
  targetCents: number,
  progressCents: number,
  deadline: string,
  today: string = civilDateKey(),
): number => {
  if (!isCivilDate(deadline) || !Number.isSafeInteger(targetCents) || !Number.isSafeInteger(progressCents)) {
    return 0;
  }
  const remaining = targetCents - progressCents;
  if (remaining <= 0) return 0;
  const months = monthsBetweenCivilDates(today, deadline);
  return months > 0 ? Math.ceil(remaining / months) : remaining;
};

// ---------------------------------------------------------------------------
// Histórico do progresso manual (goal_audit_logs)
// ---------------------------------------------------------------------------

export interface GoalManualProgressEntry {
  id: string;
  beforeCents: number;
  afterCents: number;
  timestamp: string;
  actorId?: string;
}

export const mapManualProgressAudit = (id: string, data: unknown): GoalManualProgressEntry | null => {
  if (!id || !isRecord(data) || !isRecord(data.details)) return null;
  const {beforeCents, afterCents} = data.details;
  const timestamp = timestampToIso(data.timestamp);
  if (!isNonNegativeInt(beforeCents) || !isNonNegativeInt(afterCents) || !timestamp) return null;
  return {
    id,
    beforeCents,
    afterCents,
    timestamp,
    ...(typeof data.actorId === 'string' ? {actorId: data.actorId} : {}),
  };
};

// ---------------------------------------------------------------------------
// Erros das callables → pt-BR
// ---------------------------------------------------------------------------

export type GoalErrorKind =
  | 'validation'
  | 'conflict'
  | 'forbidden'
  | 'precondition'
  | 'quota'
  | 'session'
  | 'uncertain';

export interface GoalErrorView {
  kind: GoalErrorKind;
  message: string;
  /** O servidor está em outro estado que o exibido: recarregar. */
  refresh: boolean;
}

/** Textos que o SDK de Functions gera sozinho, sem resposta do backend. */
const SDK_DEFAULT_MESSAGE = /^(internal|Response is (not valid JSON object|missing data field)\.)$/;

const UNCERTAIN_MESSAGE =
  'Não foi possível confirmar a operação. Verifique a conexão e tente de novo: o reenvio do mesmo conteúdo não duplica o registro.';

/** Mensagens do backend já são pt-BR; aqui só se escolhe a mais útil. */
export const goalErrorView = (error: unknown): GoalErrorView => {
  const value = error as {code?: unknown; message?: unknown; details?: unknown} | null;
  const code = typeof value?.code === 'string' ? value.code.replace(/^functions\//, '') : '';
  const raw = typeof value?.message === 'string' ? value.message.trim() : '';
  const message = raw && raw !== code && !SDK_DEFAULT_MESSAGE.test(raw) ? raw : '';
  const details = (value?.details ?? {}) as {issues?: Array<{message?: unknown}>};
  switch (code) {
  case 'invalid-argument': {
    const issue = details.issues?.find((item) => typeof item.message === 'string');
    return {
      kind: 'validation',
      message: typeof issue?.message === 'string'
        ? issue.message
        : message || 'Revise os dados informados e tente novamente.',
      refresh: false,
    };
  }
  case 'aborted':
    return {
      kind: 'conflict',
      message: message ||
        'A meta foi alterada desde que você a abriu. Recarregue e tente de novo.',
      refresh: true,
    };
  case 'permission-denied':
    return {
      kind: 'forbidden',
      message: message || 'Você não tem permissão para esta operação neste espaço.',
      refresh: false,
    };
  case 'unauthenticated':
    return {kind: 'session', message: 'Sua sessão expirou. Entre novamente para continuar.', refresh: false};
  case 'resource-exhausted':
    return {
      kind: 'quota',
      message: message || 'O limite desta operação foi atingido. Tente novamente mais tarde.',
      refresh: false,
    };
  case 'not-found':
    return {
      kind: 'conflict',
      message: 'Esta meta não foi encontrada. Atualize a lista e tente novamente.',
      refresh: true,
    };
  case 'failed-precondition':
    return {
      kind: 'precondition',
      message: message || 'Não foi possível concluir a operação no estado atual da meta. Atualize e tente novamente.',
      refresh: true,
    };
  default:
    return {
      kind: 'uncertain',
      message: code === 'internal' && message ? message : UNCERTAIN_MESSAGE,
      refresh: true,
    };
  }
};

// ---------------------------------------------------------------------------
// Formulário → payload do backend
// ---------------------------------------------------------------------------

/** Como a meta pessoal mede o progresso. */
export type GoalMeasure = 'net_contributions' | 'current_value' | 'manual';
export type GoalProfile = 'PF' | 'PJ';

export interface GoalFormState {
  name: string;
  description: string;
  category: GoalCategory;
  priority: GoalPriority;
  /** Só vale na criação; o status muda depois por `setGoalStatus`. */
  status: GoalStatus;
  startDate: string;
  deadline: string;
  /** Meta pessoal: como medir o progresso. */
  measure: GoalMeasure;
  /** Meta empresarial: indicador (ou `investimento`). */
  businessType: BusinessGoalType;
  period: GoalPeriod;
  costCenter: string;
  /** Alvo digitado: reais, ou percentual quando a meta é de margem. */
  target: string;
  /** Valor já acumulado digitado (reais), para meta manual nova ou trocada para manual. */
  manual: string;
  color: string;
  icon: string;
  emoji: string;
}

export type GoalSubmission =
  | {
    kind: 'create';
    goal: GoalDefinition;
    status: GoalStatus;
    manualProgressCents?: number;
  }
  | {
    kind: 'update';
    goalId: string;
    expectedRevision: number;
    goal: GoalDefinition;
    manualProgressCents?: number;
  };

export type GoalFormErrors = Partial<Record<
  'name' | 'startDate' | 'deadline' | 'target' | 'manual' | 'period' | 'costCenter' | 'description',
  string
>>;

export type GoalSubmissionResult =
  | {ok: true; submission: GoalSubmission}
  | {ok: false; errors: GoalFormErrors};

/** Cursor da lista de metas de investimento (ordem por nome e, no empate, ID). */
export interface InvestmentGoalOptionsCursor {
  name: string;
  id: string;
}

export interface InvestmentGoalOptionsPage {
  goals: Goal[];
  /** Cursor da próxima página; `null` quando esta é a última. */
  nextCursor: InvestmentGoalOptionsCursor | null;
  /** Documentos fora do contrato, descartados (e reportados por quem chama). */
  invalidIds: string[];
}

/**
 * Uma página do seletor de metas de investimento a partir do que a consulta
 * devolveu (`pageSize` + 1 documentos no máximo, em ordem de nome e ID): a
 * sonda só decide se há próxima página. Sem teto: o cursor sempre aponta para
 * o último documento exibido (P5-B.1).
 */
export const buildInvestmentGoalOptionsPage = (
  entries: readonly {id: string; data: unknown}[],
  pageSize: number,
): InvestmentGoalOptionsPage => {
  const shown = entries.slice(0, pageSize);
  const goals: Goal[] = [];
  const invalidIds: string[] = [];
  for (const entry of shown) {
    const goal = mapGoalDocument(entry.id, entry.data);
    if (goal) goals.push(goal);
    else invalidIds.push(entry.id);
  }
  const last = shown[shown.length - 1];
  const lastName = last && typeof (last.data as {name?: unknown})?.name === 'string'
    ? (last.data as {name: string}).name
    : null;
  return {
    goals,
    nextCursor: entries.length > pageSize && last && lastName !== null
      ? {name: lastName, id: last.id}
      : null,
    invalidIds,
  };
};

/**
 * Metas das páginas carregadas mais as buscadas por ID, sem repetir: primeiro
 * a ordem das páginas, depois as extras. Usado para nomear posições e manter
 * selecionada uma meta que ainda não veio na lista paginada (P5-B.1).
 */
export const mergeGoalsById = (loaded: readonly Goal[], extra: readonly Goal[] = []): Goal[] => {
  const seen = new Set(loaded.map((goal) => goal.id));
  const merged = [...loaded];
  for (const goal of extra) {
    if (seen.has(goal.id)) continue;
    seen.add(goal.id);
    merged.push(goal);
  }
  return merged;
};

/** Estado inicial do formulário de criação. */
export const emptyGoalFormState = (profile: GoalProfile, today: string = civilDateKey()): GoalFormState => ({
  name: '',
  description: '',
  category: 'outro',
  priority: 'media',
  status: 'em_andamento',
  startDate: today,
  deadline: addMonthsToCivilDate(today, 12),
  measure: 'net_contributions',
  businessType: profile === 'PJ' ? 'faturamento' : 'investimento',
  period: 'mensal',
  costCenter: '',
  target: '',
  manual: '',
  color: profile === 'PJ' ? '#0f766e' : '#6366f1',
  icon: profile === 'PJ' ? 'Briefcase' : 'Target',
  emoji: '',
});

/** Estado do formulário de edição a partir da meta persistida. */
export const goalToFormState = (goal: Goal, profile: GoalProfile): GoalFormState => {
  const base = emptyGoalFormState(profile);
  const target = isMarginGoal(goal)
    ? basisPointsToInput(goal.targetBasisPoints ?? 0)
    : centsToInput(goal.targetAmountCents ?? 0);
  return {
    ...base,
    name: goal.name,
    description: goal.description ?? '',
    category: goal.category,
    priority: goal.priority,
    status: goal.status,
    startDate: goal.startDate,
    deadline: goal.deadline,
    measure: goal.progressSource === 'manual'
      ? 'manual'
      : goal.progressSource === 'investment' ? goal.progressBasis ?? 'net_contributions' : 'net_contributions',
    businessType: goal.businessType ?? 'investimento',
    period: goal.period ?? 'mensal',
    costCenter: goal.costCenter ?? '',
    target,
    manual: goal.progressSource === 'manual' ? centsToInput(goal.manualProgressCents ?? 0) : '',
    color: goal.visual.color,
    icon: goal.visual.icon,
    emoji: goal.visual.emoji ?? '',
  };
};

/**
 * Fonte de progresso que o formulário escolhido produz. "Informado por mim"
 * vale nos dois perfis (o contrato aceita meta manual em PF e em PJ); no PJ,
 * fora dela, o objetivo escolhe entre investimentos e indicador automático.
 */
export const formProgressSource = (state: GoalFormState, profile: GoalProfile): GoalProgressSource => {
  if (state.measure === 'manual') return 'manual';
  if (profile === 'PF') return 'investment';
  return state.businessType === 'investimento' ? 'investment' : 'business_kpi';
};

export const formTargetIsPercent = (state: GoalFormState, profile: GoalProfile): boolean =>
  formProgressSource(state, profile) === 'business_kpi' && state.businessType === 'margem';

/**
 * Estado do formulário → payload (`GoalDefinition` + `manualProgressCents`).
 *
 * - Criação: meta manual exige o valor já acumulado (zero vale); as demais
 *   não o enviam.
 * - Edição: envia `expectedRevision`; o valor manual só vai na troca de outra
 *   fonte para manual (e é obrigatório nela). Status e progresso manual de uma
 *   meta que continua manual não saem por aqui.
 */
export const buildGoalSubmission = (
  state: GoalFormState,
  profile: GoalProfile,
  existing?: Goal | null,
): GoalSubmissionResult => {
  const errors: GoalFormErrors = {};
  const name = state.name.trim();
  if (!name) errors.name = 'Informe o nome da meta.';
  else if (name.length > 120) errors.name = 'O nome da meta pode ter no máximo 120 caracteres.';
  const description = state.description.trim();
  if (description.length > 1000) errors.description = 'A descrição pode ter no máximo 1.000 caracteres.';
  const costCenter = profile === 'PJ' ? state.costCenter.trim() : '';
  if (costCenter.length > 120) errors.costCenter = 'O centro de custo pode ter no máximo 120 caracteres.';

  if (!isCivilDate(state.startDate)) errors.startDate = 'Informe uma data de início válida.';
  if (!isCivilDate(state.deadline)) errors.deadline = 'Informe uma data limite válida.';
  else if (isCivilDate(state.startDate) && state.deadline < state.startDate) {
    errors.deadline = 'A data limite deve ser igual ou posterior à data inicial.';
  }

  const progressSource = formProgressSource(state, profile);
  const isKpi = progressSource === 'business_kpi';
  const isMargin = formTargetIsPercent(state, profile);

  let targetAmountCents: number | undefined;
  let targetBasisPoints: number | undefined;
  if (isMargin) {
    const parsed = parsePercentToBasisPoints(state.target);
    if (parsed === null) {
      errors.target = 'Informe a margem-alvo entre 0,01% e 100%, com até duas casas decimais.';
    } else {
      targetBasisPoints = parsed;
    }
  } else {
    const parsed = parseReaisToCents(state.target);
    if (parsed === null) {
      errors.target = 'Informe um valor-alvo maior que zero, em reais, com até duas casas decimais (ex.: 1.500,00).';
    } else {
      targetAmountCents = parsed;
    }
  }

  if (isKpi && state.businessType !== 'caixa_minimo' && !isOneOf(PERIODS, state.period)) {
    errors.period = 'Escolha o período do indicador.';
  }

  const switchesToManual = progressSource === 'manual' && Boolean(existing) &&
    existing!.progressSource !== 'manual';
  const needsManualValue = progressSource === 'manual' && (!existing || switchesToManual);
  let manualProgressCents: number | undefined;
  if (needsManualValue) {
    const parsed = parseReaisToCents(state.manual, {allowZero: true});
    if (parsed === null) {
      errors.manual = 'Informe o valor já acumulado em reais, com até duas casas decimais (zero vale).';
    } else {
      manualProgressCents = parsed;
    }
  }

  if (Object.keys(errors).length > 0) return {ok: false, errors};

  const emoji = state.emoji.trim();
  const goal: GoalDefinition = {
    name,
    ...(description ? {description} : {}),
    category: state.category,
    priority: state.priority,
    startDate: state.startDate,
    deadline: state.deadline,
    horizon: goalHorizon(state.startDate, state.deadline),
    progressSource,
    ...(progressSource === 'investment'
      ? {progressBasis: profile === 'PF' && state.measure === 'current_value' ? 'current_value' as const : 'net_contributions' as const}
      : {}),
    // Meta manual não tem indicador: `businessType` só sai fora dela.
    ...(profile === 'PJ' && progressSource !== 'manual'
      ? {businessType: state.businessType}
      : {}),
    ...(isKpi && state.businessType !== 'caixa_minimo' ? {period: state.period} : {}),
    ...(costCenter ? {costCenter} : {}),
    ...(targetAmountCents !== undefined ? {targetAmountCents} : {}),
    ...(targetBasisPoints !== undefined ? {targetBasisPoints} : {}),
    visual: {
      color: state.color,
      icon: state.icon,
      ...(emoji ? {emoji} : {}),
      ...(existing?.visual.coverImage ? {coverImage: existing.visual.coverImage} : {}),
      progressBarType: existing?.visual.progressBarType ?? 'linear',
    },
  };

  if (existing) {
    return {
      ok: true,
      submission: {
        kind: 'update',
        goalId: existing.id,
        expectedRevision: existing.revision,
        goal,
        ...(manualProgressCents !== undefined ? {manualProgressCents} : {}),
      },
    };
  }
  return {
    ok: true,
    submission: {
      kind: 'create',
      goal,
      status: state.status,
      ...(manualProgressCents !== undefined ? {manualProgressCents} : {}),
    },
  };
};
