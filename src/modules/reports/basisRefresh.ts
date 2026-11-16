/**
 * Decisões puras da atualização das bases de relatório de longa duração
 * (P5-F.1), sem React nem Firebase: os ganchos de `./hooks.ts` só as aplicam.
 */

/** Receita de caixa por mês (`AAAA-MM` → centavos). */
export type MonthlyIncome = Readonly<Record<string, number>>;

/** Hora do servidor do Firestore (`Timestamp`): segundos e nanossegundos. */
export interface ServerVersion {
  seconds: number;
  nanoseconds: number;
}

/** Hora do servidor de um campo (`Timestamp` do SDK, ou o mesmo par num objeto), ou `null`. */
export const serverVersionOf = (value: unknown): ServerVersion | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { seconds, nanoseconds } = value as { seconds?: unknown; nanoseconds?: unknown };
  return Number.isSafeInteger(seconds) && Number.isSafeInteger(nanoseconds)
    ? { seconds: seconds as number, nanoseconds: nanoseconds as number }
    : null;
};

export const compareServerVersions = (a: ServerVersion, b: ServerVersion): number =>
  a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;

export const serverVersionKey = (version: ServerVersion | null): string =>
  version === null ? 'sem-documento' : `${version.seconds}.${version.nanoseconds}`;

/**
 * A projeção mensal de caixa confirmada pelo servidor, como uma escuta de estimativa a recebeu
 * (P5-F.1-R1): a receita e a versão (`updatedAt`, gravada pelo gatilho a cada escrita) de cada mês
 * escutado, e a ordem, no registro, em que a versão atual de cada mês chegou pela primeira vez a uma
 * escuta da conta e do workspace (`noteProjectionSeen`).
 */
export interface ConfirmedProjection {
  income: MonthlyIncome;
  versions: Readonly<Record<string, ServerVersion | null>>;
  seen: Readonly<Record<string, number>>;
}

/**
 * A receita projetada de algum mês da janela difere da que a base leu: a
 * projeção mudou depois da leitura (receita nova, retroativa, editada ou
 * anulada, aqui ou em outra sessão) ou a base foi lida antes de o gatilho
 * gravar. Mês sem documento conta como 0. Só a receita importa: despesas e
 * outros campos do documento mensal não relêem a base.
 */
export const incomeDiverges = (
  projected: MonthlyIncome,
  basis: MonthlyIncome,
  months: readonly string[],
): boolean => months.some((month) => (projected[month] ?? 0) !== (basis[month] ?? 0));

/**
 * A mesma receita por mês, em todos os meses que as duas trazem: a base que as
 * leituras de receitas (exclusões por id) acompanham não mudou. Compara todos
 * os meses da base, e não só a janela: uma mudança fora dela também vale para
 * uma janela futura e para uma estimativa que monte depois.
 */
export const sameIncome = (a: MonthlyIncome, b: MonthlyIncome): boolean => {
  const months = Object.keys(a);
  return months.length === Object.keys(b).length && months.every((month) => Object.hasOwn(b, month) && a[month] === b[month]);
};

/** Assinatura da receita projetada da janela, para limitar as releituras pela mesma divergência. */
export const incomeSignature = (projected: MonthlyIncome, months: readonly string[]): string =>
  months.map((month) => `${month}=${projected[month] ?? 0}`).join(';');

/**
 * Releituras que uma mesma divergência pode pedir: a primeira e mais uma, para
 * a corrida em que a releitura chega antes da projeção. Se a base continuar
 * diferente da mesma projeção depois disso, nada mais é pedido até a projeção
 * mudar de novo (sem releitura indefinida).
 */
export const BASIS_DIVERGENCE_RETRIES = 2;

/**
 * Decide se a divergência pede releitura e devolve a contagem atualizada.
 * `converged`: a base alcançou a projeção; quem chama zera as contagens, para
 * que um estado que volte depois (uma receita editada e desfeita, mais de uma
 * vez) peça releitura de novo.
 */
export const divergenceRefresh = (
  projected: MonthlyIncome | null,
  basis: MonthlyIncome | null,
  months: readonly string[],
  attempts: ReadonlyMap<string, number>,
): { refresh: boolean; signature: string | null; attempts: number; converged: boolean } => {
  if (!projected || !basis || months.length === 0) return { refresh: false, signature: null, attempts: 0, converged: false };
  if (!incomeDiverges(projected, basis, months)) return { refresh: false, signature: null, attempts: 0, converged: true };
  const signature = incomeSignature(projected, months);
  const used = attempts.get(signature) ?? 0;
  if (used >= BASIS_DIVERGENCE_RETRIES) return { refresh: false, signature, attempts: used, converged: false };
  return { refresh: true, signature, attempts: used + 1, converged: false };
};

/** Falhas seguidas de uma base, desde a última versão dos dados. */
export interface BasisFailureState {
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  failures: number;
}

export const INITIAL_BASIS_FAILURE_STATE: BasisFailureState = { dataUpdatedAt: 0, errorUpdatedAt: 0, failures: 0 };

/**
 * Releitura de uma base desatualizada pelo agendador: uma versão nova dos
 * dados zera as falhas; cada falha conta uma vez; depois de `limit` falhas
 * seguidas, o agendador para. Uma mudança nova nas projeções zera a contagem
 * por fora (o gancho da escuta), então a base nunca fica congelada.
 */
export const basisRefreshAfter = (
  state: BasisFailureState,
  query: { dataUpdatedAt: number; errorUpdatedAt: number },
  limit: number,
): { notify: boolean; state: BasisFailureState } => {
  let next = state;
  if (next.dataUpdatedAt !== query.dataUpdatedAt) {
    next = { dataUpdatedAt: query.dataUpdatedAt, errorUpdatedAt: next.errorUpdatedAt, failures: 0 };
  }
  if (query.errorUpdatedAt > query.dataUpdatedAt && query.errorUpdatedAt !== next.errorUpdatedAt) {
    next = { ...next, errorUpdatedAt: query.errorUpdatedAt, failures: next.failures + 1 };
  }
  return { notify: next.failures < limit, state: next };
};

/** Receita por mês da base: os pontos da série e, quando houver, o mês avulso. */
export const basisIncomeOf = (
  points: ReadonlyArray<{ month: string; receiptsCents: number }>,
  extra: { month: string; receiptsCents: number } | null,
): MonthlyIncome => {
  const income: Record<string, number> = {};
  for (const point of points) income[point.month] = point.receiptsCents;
  if (extra) income[extra.month] = extra.receiptsCents;
  return income;
};

/** Receita por mês dos documentos de projeção (`incomeCents`, inteiro; o resto é ignorado). */
export const projectedIncomeOf = (
  documents: ReadonlyArray<{ id: string; incomeCents: unknown }>,
): MonthlyIncome => {
  const income: Record<string, number> = {};
  for (const document of documents) {
    if (Number.isSafeInteger(document.incomeCents)) income[document.id] = document.incomeCents as number;
  }
  return income;
};
