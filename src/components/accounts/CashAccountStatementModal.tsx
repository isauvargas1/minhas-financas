import React from 'react';

import { useCashAccountMovements } from '../../modules/accounts/hooks.ts';
import { movementKindLabel } from '../../modules/accounts/presentation.ts';
import type { CashAccount } from '../../modules/accounts/types.ts';
import { formatCents, formatDayKey } from '../../modules/loans/money.ts';
import { HistoryIcon } from '../Icons.tsx';
import ClientsDialog, { CLIENTS_FORM_STYLES as styles } from '../clients/ClientsDialog.tsx';

/**
 * Extrato da conta (D-30, P3-J): os movimentos do livro-razão, mais recente
 * primeiro, paginados pelo servidor. O saldo exibido é o autoritativo da
 * conta; nada é somado no navegador.
 */
interface CashAccountStatementModalProps {
  open: boolean;
  account: CashAccount;
  onClose: () => void;
}

const CashAccountStatementModal: React.FC<CashAccountStatementModalProps> = ({ open, account, onClose }) => {
  const movements = useCashAccountMovements(open ? account.id : null);
  const items = movements.data ?? [];

  return (
    <ClientsDialog
      open={open}
      title="Extrato da conta"
      icon={<HistoryIcon className="w-5 h-5 text-primary" />}
      onClose={onClose}
      footer={(
        <button type="button" onClick={onClose} className={styles.cancel}>Fechar</button>
      )}
    >
      <p className="text-sm text-muted">
        <span className="font-medium text-on-surface">{account.name}</span>
        {' · '}saldo {formatCents(account.balanceCents)}
      </p>
      {movements.isLoading && <p className="text-sm text-muted">Carregando...</p>}
      {movements.isError && <p role="alert" className="text-sm text-error">Não foi possível carregar o extrato.</p>}
      {movements.isSuccess && items.length === 0 && (
        <p className="text-sm text-muted">Nenhum movimento nesta conta.</p>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-border border border-border rounded-lg">
          {items.map((movement) => (
            <li key={movement.id} className="p-3 text-sm flex justify-between gap-3">
              <span className="text-on-surface">
                {movementKindLabel(movement)}
                <span className="block text-xs text-muted">{formatDayKey(movement.effectiveDate)}</span>
              </span>
              <span className={`font-bold ${movement.amountCents < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                {movement.amountCents < 0 ? `− ${formatCents(-movement.amountCents)}` : formatCents(movement.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {movements.hasNextPage && (
        <button
          type="button"
          onClick={() => movements.fetchNextPage()}
          disabled={movements.isFetchingNextPage}
          className={styles.cancel}
        >
          {movements.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </ClientsDialog>
  );
};

export default CashAccountStatementModal;
