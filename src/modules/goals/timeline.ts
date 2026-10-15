/**
 * Linha do tempo e previsão da meta de investimentos (P5-B). Módulo PURO.
 *
 * Parte dos movimentos do ledger já traduzidos (`impactCents` é o efeito que o
 * backend aplicou no progresso) e do alvo em centavos. Nada de ponto flutuante
 * em valor: somas e comparações são inteiras; datas são civis `AAAA-MM-DD`.
 */
import {
  addMonthsToCivilDate,
  civilDateKey,
  civilDayNumber,
  ratioBasisPoints,
} from './model.ts';

export interface GoalMovementFact {
  /** Data civil do movimento (`AAAA-MM-DD`), ou vazio se desconhecida. */
  dateKey: string;
  /** Efeito assinado no progresso da meta, em centavos. */
  impactCents: number;
}

export interface GoalTimelineEvent {
  date: string;
  title: string;
  type: 'start' | 'milestone' | 'deposit' | 'completion';
  valueCents: number;
}

const MILESTONES_BASIS_POINTS = [2500, 5000, 7500, 10000];

/** `AAAA-MM-DD` → "outubro de 2026" (mês e ano em pt-BR, sem fuso). */
export const formatMonthYear = (key: string): string => {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

/**
 * Estimativa de fim pela média mensal dos últimos 6 meses de aportes.
 * `null` sem base suficiente (menos de 2 movimentos ou média não positiva).
 */
export const goalForecastLabel = (
  movements: readonly GoalMovementFact[],
  remainingCents: number,
  today: string = civilDateKey(),
): string | null => {
  if (remainingCents <= 0 || movements.length < 2) return null;
  const since = addMonthsToCivilDate(today, -6);
  const recent = movements.filter((movement) => movement.dateKey !== '' && movement.dateKey >= since);
  const distinctMonths = new Set(recent.map((movement) => movement.dateKey.slice(0, 7))).size;
  const totalCents = recent.reduce((sum, movement) => sum + movement.impactCents, 0);
  const averageMonthlyCents = totalCents / Math.max(1, distinctMonths);
  if (!(averageMonthlyCents > 0)) return null;
  const monthsNeeded = remainingCents / averageMonthlyCents;
  if (monthsNeeded > 120) return '> 10 anos';
  return formatMonthYear(addMonthsToCivilDate(today, Math.ceil(monthsNeeded)));
};

export interface TimelineGoal {
  startDate: string;
  status: string;
  statusUpdatedAt?: string;
  targetCents: number;
  /** Progresso atual da meta, em centavos. */
  progressCents: number;
  /** Alvo atingido pelo progresso (não é o status 'alcancada'). */
  achieved: boolean;
}

/** Eventos da meta, do mais recente ao mais antigo. */
export const goalTimelineEvents = (
  goal: TimelineGoal,
  movements: readonly GoalMovementFact[],
  today: string = civilDateKey(),
): GoalTimelineEvent[] => {
  const events: GoalTimelineEvent[] = [
    {date: goal.startDate, title: 'Meta Criada', type: 'start', valueCents: 0},
  ];
  const chronological = [...movements].sort((a, b) =>
    a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0);
  let runningCents = 0;
  let nextMilestone = 0;
  for (const movement of chronological) {
    runningCents += movement.impactCents;
    const progressBasisPoints = ratioBasisPoints(runningCents, goal.targetCents);
    while (nextMilestone < MILESTONES_BASIS_POINTS.length &&
      progressBasisPoints >= MILESTONES_BASIS_POINTS[nextMilestone]) {
      events.push({
        date: movement.dateKey,
        title: `Alcançou ${MILESTONES_BASIS_POINTS[nextMilestone] / 100}%`,
        type: 'milestone',
        valueCents: runningCents,
      });
      nextMilestone += 1;
    }
    // Aporte de pelo menos 10% do alvo.
    if (movement.impactCents * 10 >= goal.targetCents) {
      events.push({date: movement.dateKey, title: 'Grande Aporte', type: 'deposit', valueCents: movement.impactCents});
    }
  }
  // Conclusão (status persistido) e alvo atingido são fatos distintos.
  if (goal.status === 'alcancada') {
    const statusDate = goal.statusUpdatedAt && !Number.isNaN(Date.parse(goal.statusUpdatedAt))
      ? civilDateKey(new Date(goal.statusUpdatedAt))
      : today;
    events.push({date: statusDate, title: 'Meta Concluída! 🎉', type: 'completion', valueCents: goal.progressCents});
  } else if (goal.achieved && nextMilestone < MILESTONES_BASIS_POINTS.length) {
    events.push({date: today, title: 'Alvo atingido! 🎉', type: 'completion', valueCents: goal.progressCents});
  }
  return events.sort((a, b) =>
    civilDayNumber(a.date || today) === civilDayNumber(b.date || today)
      ? 0
      : civilDayNumber(b.date || today) - civilDayNumber(a.date || today));
};
