import type { Goal } from '../../types';

/**
 * Projeta o documento de meta para o modelo da interface.
 *
 * `investmentProgressCents` é publicado pelo domínio patrimonial a partir das
 * posições vinculadas e é a fonte oficial do progresso. `currentAmount` só
 * responde por metas que nunca receberam movimento — metas de valor informado
 * e metas empresariais automáticas.
 */
export const mapGoalDocument = (
  id: string,
  data: Omit<Goal, 'id'> & { investmentProgressCents?: number },
): Goal => ({
  id,
  ...data,
  progressBasis: data.progressBasis ?? 'net_contributions',
  currentAmount: Number.isSafeInteger(data.investmentProgressCents)
    ? data.investmentProgressCents! / 100
    : data.currentAmount,
});
