import React, { useEffect, useMemo } from 'react';

import { useCashAccounts } from '../../modules/accounts/hooks.ts';

/**
 * Escolha da conta/carteira de um fato que move dinheiro (D-30, P3-J):
 * lançamento manual, confirmação de pendente, empréstimo, liquidação e
 * recebimento.
 *
 * Oferece as contas ativas. A conta já vinculada (correção ou confirmação)
 * continua visível mesmo arquivada, para que corrigir só a descrição não
 * troque de conta; mover dinheiro nela o backend recusa, com mensagem
 * pt-BR. As classes vêm do formulário que a usa, para manter o visual de
 * cada modal.
 */
interface CashAccountSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (accountId: string) => void;
  disabled?: boolean;
  labelClassName: string;
  selectClassName: string;
  hintClassName?: string;
  /** Escolhe a primeira conta ativa quando nada está escolhido. */
  autoSelect?: boolean;
  /** Marca de obrigatório no rótulo, no estilo do formulário. */
  requiredMark?: React.ReactNode;
}

const CashAccountSelect: React.FC<CashAccountSelectProps> = ({
  id, label, value, onChange, disabled = false, labelClassName, selectClassName,
  hintClassName = 'text-xs text-muted mt-1', autoSelect = false, requiredMark,
}) => {
  const accounts = useCashAccounts();
  const all = useMemo(() => accounts.data?.items ?? [], [accounts.data]);
  const options = useMemo(
    () => all.filter((account) => account.status === 'active' || account.id === value),
    [all, value],
  );

  // Sem lista de dependências de propósito: o efeito de abertura do
  // formulário pai roda depois deste, no mesmo commit, e zera a escolha; com
  // a lista já em cache o valor volta ao mesmo `''` e um efeito com
  // dependências não rodaria de novo. Reavaliar a cada render repõe a
  // primeira conta ativa enquanto nada estiver escolhido.
  useEffect(() => {
    if (!autoSelect || value || disabled) return;
    const first = all.find((account) => account.status === 'active');
    if (first) onChange(first.id);
  });

  const noActive = accounts.isSuccess && !all.some((account) => account.status === 'active');

  return (
    <div>
      <label htmlFor={id} className={labelClassName}>
        {label}{requiredMark}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || accounts.isLoading}
        className={selectClassName}
        aria-describedby={noActive || accounts.isError ? `${id}-hint` : undefined}
      >
        {accounts.isLoading ? (
          <option value="">Carregando contas…</option>
        ) : (
          <option value="" disabled>Selecione a conta</option>
        )}
        {options.map((account) => (
          <option key={account.id} value={account.id}>
            {account.status === 'archived' ? `${account.name} (arquivada)` : account.name}
          </option>
        ))}
      </select>
      {accounts.isError && (
        <p id={`${id}-hint`} role="alert" className={hintClassName}>
          Não foi possível carregar as contas.
        </p>
      )}
      {noActive && (
        <p id={`${id}-hint`} className={hintClassName}>
          Nenhuma conta ativa. Cadastre uma em Configurações › Contas e carteiras.
        </p>
      )}
    </div>
  );
};

export default CashAccountSelect;
