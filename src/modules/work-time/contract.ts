/**
 * Contrato v2 da preferência privada de tempo de trabalho equivalente
 * (P5-F.1, evolução da P5-F, REQ-FUT-01). Módulo PURO: sem React, sem
 * Firebase, imports com extensão `.ts` — roda direto no runner do Node.
 *
 * A preferência é do usuário, não do workspace: vale igual em PF e PJ e em
 * qualquer papel. Fica num documento próprio,
 * `users/{uid}/private_preferences/work_time_equivalent`, fora do perfil
 * `users/{uid}` (server-owned). As Rules deixam só o titular ler, gravar e
 * apagar, com estes campos e gramáticas exatos; nenhuma regra de workspace
 * alcança o caminho e nenhuma Function o lê.
 *
 * O v2 substitui o v1 sem migração nem leitura dupla (não há dados reais): o
 * documento v1 é ignorado como fora do contrato e as Rules não o aceitam mais.
 *
 * Minimização: o documento guarda só o que o usuário escolheu — rotina,
 * feriados locais, exceções (tipo e datas, sem motivo nem dado de saúde),
 * a fonte da renda e as exclusões que ele fez — e `updatedAt`, a hora do
 * servidor da última gravação. A renda, os minutos e o valor por hora são
 * derivados em memória do relatório oficial e do calendário: nunca são
 * gravados aqui, no `localStorage`, em logs ou no chat de IA.
 */
import type { LocalHoliday, WorkCalendar, WorkException, WorkRoutine } from './calendar.ts';
import {
  formatExceptions,
  formatExcludedIds,
  formatLocalHolidays,
  formatRoutines,
  isMunicipality,
  isRecordId,
  parseExceptions,
  parseExcludedIds,
  parseLocalHolidays,
  parseRoutines,
} from './grammar.ts';

export const WORK_TIME_PREFERENCES_COLLECTION = 'private_preferences';
export const WORK_TIME_PREFERENCE_ID = 'work_time_equivalent';
export const WORK_TIME_SCHEMA_VERSION = 2;

export type WorkTimeDisplayMode = 'money' | 'time';
export const WORK_TIME_DISPLAY_MODES: readonly WorkTimeDisplayMode[] = ['money', 'time'];

/** Habitual: meses completos anteriores. Mês atual: o mês corrente, ainda incompleto. */
export type WorkTimeEstimateMode = 'habitual' | 'current_month';
export const WORK_TIME_ESTIMATE_MODES: readonly WorkTimeEstimateMode[] = ['habitual', 'current_month'];

export type WorkTimeHistoryMonths = 1 | 3 | 6 | 12;
export const WORK_TIME_HISTORY_MONTHS: readonly WorkTimeHistoryMonths[] = [1, 3, 6, 12];
export const WORK_TIME_DEFAULT_HISTORY_MONTHS: WorkTimeHistoryMonths = 3;

/** As 27 unidades da federação. */
export const BRAZILIAN_UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;
export type BrazilianUf = typeof BRAZILIAN_UFS[number];

export interface WorkTimePreference {
  enabled: boolean;
  displayMode: WorkTimeDisplayMode;
  estimateMode: WorkTimeEstimateMode;
  historyMonths: WorkTimeHistoryMonths;
  /** Único workspace de onde vem a renda (sem soma PF+PJ). */
  incomeWorkspaceId: string;
  /** Confirmação explícita para usar a receita de um workspace PJ. */
  allowBusinessIncome: boolean;
  /** Lançamentos de receita que o usuário tirou da estimativa (só da estimativa). */
  excludedIncomeIds: readonly string[];
  routines: readonly WorkRoutine[];
  worksOnHolidays: boolean;
  uf: BrazilianUf | '';
  municipality: string;
  localHolidays: readonly LocalHoliday[];
  exceptions: readonly WorkException[];
}

/** Campos exatos do documento (as Rules exigem a mesma lista). */
export const WORK_TIME_PREFERENCE_FIELDS = [
  'schemaVersion',
  'enabled',
  'displayMode',
  'estimateMode',
  'historyMonths',
  'incomeWorkspaceId',
  'allowBusinessIncome',
  'excludedIncomeIds',
  'routines',
  'worksOnHolidays',
  'uf',
  'municipality',
  'localHolidays',
  'exceptions',
  'updatedAt',
] as const;

/** Uid do Firebase Auth como segmento de caminho: 1 a 128 caracteres, sem `/`. */
const isUidSegment = (uid: unknown): uid is string =>
  typeof uid === 'string' && /^[^/]{1,128}$/.test(uid) && uid !== '.' && uid !== '..';

/** Segmentos do caminho do documento do titular `uid`. */
export const workTimePreferencePathSegments = (uid: string): [string, string, string, string] => {
  if (!isUidSegment(uid)) throw new Error('Usuário inválido para a preferência de tempo de trabalho.');
  return ['users', uid, WORK_TIME_PREFERENCES_COLLECTION, WORK_TIME_PREFERENCE_ID];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTimestampLike = (value: unknown): boolean =>
  isPlainObject(value) && typeof (value as { toMillis?: unknown }).toMillis === 'function';

const isUf = (value: unknown): value is BrazilianUf | '' =>
  value === '' || (BRAZILIAN_UFS as readonly unknown[]).includes(value);

/** Calendário de trabalho da preferência, para o motor de calendário. */
export const workCalendarOf = (preference: Pick<WorkTimePreference, 'routines' | 'worksOnHolidays' | 'localHolidays' | 'exceptions'>): WorkCalendar => ({
  routines: preference.routines,
  worksOnHolidays: preference.worksOnHolidays,
  localHolidays: preference.localHolidays,
  exceptions: preference.exceptions,
});

/**
 * Lê o documento com o mesmo contrato das Rules e, além delas, a semântica
 * das gramáticas (datas reais em ordem, sem sobreposição do mesmo tipo, sem
 * repetição, forma canônica). Qualquer desvio devolve `null`, e a interface
 * trata como preferência inválida (mostra dinheiro).
 */
export const parseWorkTimePreference = (data: unknown): WorkTimePreference | null => {
  if (!isPlainObject(data)) return null;
  const keys = Object.keys(data);
  if (keys.length !== WORK_TIME_PREFERENCE_FIELDS.length) return null;
  if (!WORK_TIME_PREFERENCE_FIELDS.every((field) => keys.includes(field))) return null;
  if (data.schemaVersion !== WORK_TIME_SCHEMA_VERSION) return null;
  if (typeof data.enabled !== 'boolean') return null;
  if (!WORK_TIME_DISPLAY_MODES.includes(data.displayMode as WorkTimeDisplayMode)) return null;
  if (!WORK_TIME_ESTIMATE_MODES.includes(data.estimateMode as WorkTimeEstimateMode)) return null;
  if (!WORK_TIME_HISTORY_MONTHS.includes(data.historyMonths as WorkTimeHistoryMonths)) return null;
  if (!isRecordId(data.incomeWorkspaceId)) return null;
  if (typeof data.allowBusinessIncome !== 'boolean') return null;
  if (typeof data.worksOnHolidays !== 'boolean') return null;
  if (!isUf(data.uf)) return null;
  if (!isMunicipality(data.municipality)) return null;
  if (!isTimestampLike(data.updatedAt)) return null;
  const excludedIncomeIds = parseExcludedIds(data.excludedIncomeIds);
  const routines = parseRoutines(data.routines);
  const localHolidays = parseLocalHolidays(data.localHolidays);
  const exceptions = parseExceptions(data.exceptions);
  if (!excludedIncomeIds || !routines || !localHolidays || !exceptions) return null;
  return {
    enabled: data.enabled,
    displayMode: data.displayMode as WorkTimeDisplayMode,
    estimateMode: data.estimateMode as WorkTimeEstimateMode,
    historyMonths: data.historyMonths as WorkTimeHistoryMonths,
    incomeWorkspaceId: data.incomeWorkspaceId,
    allowBusinessIncome: data.allowBusinessIncome,
    excludedIncomeIds,
    routines,
    worksOnHolidays: data.worksOnHolidays,
    uf: data.uf,
    municipality: data.municipality,
    localHolidays,
    exceptions,
  };
};

/**
 * Campos gravados pelo cliente, sem `updatedAt` (posto como hora do
 * servidor). Lança quando a preferência não sairia válida na leitura: o que
 * vai para o servidor é exatamente o que o `parseWorkTimePreference` aceita.
 */
export const workTimePreferenceFields = (preference: WorkTimePreference) => {
  const fields = {
    schemaVersion: WORK_TIME_SCHEMA_VERSION,
    enabled: preference.enabled === true,
    displayMode: preference.displayMode,
    estimateMode: preference.estimateMode,
    historyMonths: preference.historyMonths,
    incomeWorkspaceId: preference.incomeWorkspaceId,
    allowBusinessIncome: preference.allowBusinessIncome === true,
    excludedIncomeIds: formatExcludedIds(preference.excludedIncomeIds),
    routines: formatRoutines(preference.routines),
    worksOnHolidays: preference.worksOnHolidays === true,
    uf: preference.uf,
    municipality: preference.municipality,
    localHolidays: formatLocalHolidays(preference.localHolidays),
    exceptions: formatExceptions(preference.exceptions),
  };
  const roundTrip = parseWorkTimePreference({ ...fields, updatedAt: { toMillis: () => 0 } });
  if (!roundTrip) throw new Error('Configuração de tempo de trabalho inválida.');
  return fields;
};

/** A conversão está ligada (o alternador aparece); a estimativa pode ainda estar indisponível. */
export const isWorkTimeEnabled = (preference: WorkTimePreference | null): preference is WorkTimePreference =>
  preference !== null && preference.enabled;

/** Modo de exibição escolhido: tempo só com a preferência válida, ligada e em modo tempo. */
export const effectiveDisplayMode = (preference: WorkTimePreference | null): WorkTimeDisplayMode =>
  isWorkTimeEnabled(preference) && preference.displayMode === 'time' ? 'time' : 'money';
