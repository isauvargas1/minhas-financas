import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { useQuery } from '@tanstack/react-query';

import { db } from '../../lib/firebase';

/**
 * Projeção mensal de caixa, lida pelo produto (INV-P1-011).
 *
 * O saldo de caixa acumulado é um agregado **global**: ele não se pagina.
 * Antes, ele era obtido somando o array inteiro de transações do workspace, o
 * que obrigava a carregar a subcoleção completa só para responder ao progresso
 * de uma meta PJ do tipo `caixa_minimo`.
 *
 * A projeção é mantida por delta pelo gatilho de escrita de transações e
 * reconstruível a partir do próprio ledger. Somar meses é O(meses), não
 * O(transações).
 */

export interface CashPeriod {
  id: string;
  period: string;
  incomeCents: number;
  expenseCents: number;
  investmentOutflowCents: number;
  netCents: number;
  transactionCount: number;
}

/**
 * Teto de períodos lidos. 600 meses são 50 anos: bem além de qualquer
 * histórico real, e é o mesmo teto que as Rules impõem à listagem.
 */
const MAX_CASH_PERIODS = 600;

/** Documento de estado da reconstrução, que não é um período. */
const REBUILD_STATE_ID = 'cash_periods_rebuild';

export const listCashPeriods = async (
  workspaceId: string,
): Promise<CashPeriod[]> => {
  if (!workspaceId || workspaceId === 'loading') return [];
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, 'cash_report_periods'),
    orderBy('periodStart', 'desc'),
    orderBy(documentId(), 'desc'),
    limit(MAX_CASH_PERIODS),
  ));
  return snapshot.docs
    .filter((entry) => entry.id !== REBUILD_STATE_ID)
    .map((entry) => {
      const data = entry.data();
      return {
        id: entry.id,
        period: String(data.period ?? entry.id),
        incomeCents: Number(data.incomeCents ?? 0),
        expenseCents: Number(data.expenseCents ?? 0),
        investmentOutflowCents: Number(data.investmentOutflowCents ?? 0),
        netCents: Number(data.netCents ?? 0),
        transactionCount: Number(data.transactionCount ?? 0),
      };
    });
};

export const useCashPeriods = (workspaceId: string, enabled = true) =>
  useQuery({
    queryKey: ['cash-periods', workspaceId],
    queryFn: () => listCashPeriods(workspaceId),
    enabled: enabled && Boolean(workspaceId) && workspaceId !== 'loading',
    staleTime: 1000 * 60 * 5,
  });

/**
 * Saldo de caixa acumulado, em reais.
 *
 * Soma o efeito líquido de todos os meses projetados. Devolve `undefined`
 * enquanto a projeção não estiver disponível, para que o consumidor possa
 * distinguir "ainda não sei" de "é zero" — apresentar zero como saldo real
 * seria pior que não apresentar nada.
 */
export const cashBalanceFromPeriods = (
  periods: CashPeriod[] | undefined,
): number | undefined => {
  if (!periods) return undefined;
  return periods.reduce((total, period) => total + period.netCents, 0) / 100;
};
