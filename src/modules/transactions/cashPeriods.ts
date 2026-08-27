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
 *
 * O teto é **estrutural**, não amostral: a projeção tem exatamente um
 * documento por mês com movimento, então alcançá-lo exigiria 50 anos de
 * histórico contínuo. Ainda assim ele é sondado, e não presumido: a consulta
 * pede um documento a mais para saber se estourou. A reconstrução no backend
 * (`functions/src/cash/rebuild.ts`) falha explicitamente no mesmo número, de
 * modo que a projeção não cresce além dele em silêncio.
 */
export const MAX_CASH_PERIODS = 600;

/**
 * Documentos de estado da reconstrução, que não são períodos.
 *
 * São dois: o da execução real e o da simulação. Precisam ficar de fora de
 * qualquer soma de saldo.
 */
const REBUILD_STATE_IDS = new Set([
  'cash_periods_rebuild',
  'cash_periods_rebuild_dry_run',
]);

export interface CashPeriodList {
  items: CashPeriod[];
  /** A leitura bateu no teto: o saldo somado destes meses não cobre tudo. */
  truncated: boolean;
}

export const listCashPeriods = async (
  workspaceId: string,
): Promise<CashPeriodList> => {
  if (!workspaceId || workspaceId === 'loading') {
    return { items: [], truncated: false };
  }
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, 'cash_report_periods'),
    orderBy('periodStart', 'desc'),
    orderBy(documentId(), 'desc'),
    limit(MAX_CASH_PERIODS),
  ));
  /*
   * As Rules recusam `limit` acima de 600, então não dá para pedir "um a mais"
   * e usar o excedente como sonda. A detecção olha os **períodos**, não o
   * tamanho bruto da resposta: os documentos de estado da reconstrução ocupam
   * lugar na página sem serem períodos, e contá-los faria um workspace com 599
   * meses e um estado ser reportado como cortado. Só há corte quando os 600
   * documentos lidos são todos período.
   */
  const items = snapshot.docs
    .filter((entry) => !REBUILD_STATE_IDS.has(entry.id))
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
  return {items, truncated: items.length >= MAX_CASH_PERIODS};
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
  periods: CashPeriodList | undefined,
): number | undefined => {
  if (!periods) return undefined;
  /*
   * Cortado no teto, o saldo somado seria menor que o real. Um saldo
   * subestimado exibido como saldo é pior que nenhum saldo: ele muda o
   * progresso de uma meta de caixa mínimo sem dizer que está incompleto. O
   * consumidor recebe "ainda não sei", que ele já sabe tratar.
   */
  if (periods.truncated) return undefined;
  return periods.items.reduce((total, period) => total + period.netCents, 0) / 100;
};
