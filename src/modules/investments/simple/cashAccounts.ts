import { useMemo } from 'react';

import { useCashAccounts } from '../../accounts/hooks';

/**
 * Contas do Caixa oferecidas nos lançamentos de investimento (D-30, P4-D).
 *
 * "Carteira de investimentos" (`investment_class`) classifica o patrimônio;
 * a conta de origem/destino é a do Caixa (Configurações › Contas e
 * carteiras), de onde o aporte depositado sai e para onde a retirada
 * recebida vai. Só contas ativas: o backend recusa conta arquivada.
 */
export interface CashAccountOption {
  value: string;
  label: string;
}

export const activeCashAccountOptions = (
  accounts: ReadonlyArray<{ id: string; name: string; status: string }> | undefined,
): CashAccountOption[] => (accounts ?? [])
  .filter((account) => account.status === 'active')
  .map((account) => ({ value: account.id, label: account.name }));

/**
 * Conta preenchida de antemão só quando há exatamente uma ativa: com duas ou
 * mais, a escolha é sempre explícita — nenhum fato financeiro cai numa conta
 * que o usuário não escolheu.
 */
export const defaultCashAccountId = (options: CashAccountOption[]): string =>
  options.length === 1 ? options[0].value : '';

export const useActiveCashAccountOptions = () => {
  const accounts = useCashAccounts();
  const options = useMemo(
    () => activeCashAccountOptions(accounts.data?.items),
    [accounts.data],
  );
  return { options, isLoading: accounts.isLoading };
};
