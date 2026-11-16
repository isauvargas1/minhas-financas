import { useAuth } from '../../contexts/AuthContext';
import { firebaseBasisDeps } from '../reports/hooks';
import { getTransactionsByIds } from '../transactions/api';
import { readProjectionMarks } from './projectionReads';
import {
  useIncomeEstimateWith,
  type IncomeEstimateDeps,
  type IncomeEstimateParams,
  type IncomeEstimateState,
} from './useIncomeEstimateWith';

export type { IncomeEstimateParams, IncomeEstimateState } from './useIncomeEstimateWith';

/**
 * Estimativa automática a partir das fontes oficiais (P5-F.1), com as
 * dependências reais: a callable do relatório e a escuta das projeções
 * (`reports/hooks.ts`) e a leitura por id dos lançamentos desconsiderados. A
 * lógica, a sincronização e a apresentação fail-closed estão em `./useIncomeEstimateWith.ts`,
 * testadas com uma API em memória.
 */
const firebaseIncomeEstimateDeps: IncomeEstimateDeps = {
  basis: firebaseBasisDeps,
  readByIds: getTransactionsByIds,
  readProjectionMarks,
};

export const useIncomeEstimate = (params: IncomeEstimateParams): IncomeEstimateState => {
  const { user } = useAuth();
  return useIncomeEstimateWith(firebaseIncomeEstimateDeps, user?.uid ?? null, params);
};
