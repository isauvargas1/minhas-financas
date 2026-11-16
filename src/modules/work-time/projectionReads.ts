import { doc, runTransaction } from 'firebase/firestore';

import { db } from '../../lib/firebase';
import { generationOf, type ProjectionMarksRead, type SnapshotMonth } from './projectionProof';

/** Teto de marcas lidas numa prova: 50 desconsideradas e 50 espelhos de estorno. */
export const PROJECTION_MARKS_MAX = 100;
/** Teto de meses: a janela da estimativa (12) e um de folga, como a escuta (`BASIS_PERIODS_MAX`). */
export const PROJECTION_MONTHS_MAX = 13;

/**
 * Meses da janela e marcas de aplicação da projeção, no mesmo instante (P5-F.1-R3, B03): uma transação só de
 * leitura do SDK, que no commit confere que nenhum documento lido mudou e, se mudou, lê tudo de novo (até 5
 * vezes; depois, falha, e a estimativa mostra o erro com "Tentar de novo"). Sem relógio e sem comparar
 * horários: as marcas e os meses vêm do mesmo estado. Transação não usa o cache local; sem rede, falha. As Rules
 * exigem membership no workspace (`get` de cada documento) e negam qualquer escrita.
 */
export const readProjectionMarks = async (
  workspaceId: string,
  months: readonly string[],
  ids: readonly string[],
): Promise<ProjectionMarksRead> => {
  if (!workspaceId || workspaceId === 'loading') throw new Error('Workspace ID inválido para a leitura da projeção.');
  const uniqueMonths = [...new Set(months)];
  const uniqueIds = [...new Set(ids)];
  if (uniqueMonths.length > PROJECTION_MONTHS_MAX || uniqueIds.length > PROJECTION_MARKS_MAX) {
    throw new Error('Leitura da projeção acima do teto da estimativa.');
  }
  return runTransaction(db, async (transaction) => {
    const [monthSnapshots, markSnapshots] = await Promise.all([
      Promise.all(uniqueMonths.map((month) => transaction.get(doc(db, 'workspaces', workspaceId, 'cash_report_periods', month)))),
      Promise.all(uniqueIds.map((id) => transaction.get(doc(db, 'workspaces', workspaceId, 'cash_projection_marks', id)))),
    ]);
    const monthsRead: Record<string, SnapshotMonth> = {};
    monthSnapshots.forEach((read, index) => {
      const data = read.exists() ? read.data() : null;
      monthsRead[uniqueMonths[index]] = {
        exists: data !== null,
        incomeCents: Number.isSafeInteger(data?.incomeCents) ? (data?.incomeCents as number) : Number.NaN,
        generation: generationOf(data?.projectionGeneration),
      };
    });
    const marks: Record<string, unknown> = {};
    markSnapshots.forEach((read, index) => {
      marks[uniqueIds[index]] = read.exists() ? read.data() : null;
    });
    return { months: monthsRead, marks };
  }, { maxAttempts: 5 });
};
