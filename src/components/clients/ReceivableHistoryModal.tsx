import React from 'react';

import { useReceivableMovements } from '../../modules/clients/hooks.ts';
import { formatCents, formatDayKey } from '../../modules/loans/money.ts';
import { movementLabel, movementStateLabel } from '../../modules/clients/presentation.ts';
import type { Receivable, ReceivableMovement } from '../../modules/clients/types.ts';
import { HistoryIcon, RotateCcwIcon } from '../Icons.tsx';
import ClientsDialog, { CLIENTS_FORM_STYLES as styles } from './ClientsDialog.tsx';

/**
 * Histórico do recebível (P3-I): data, principal, juros, multa, desconto,
 * total recebido e a relação de estorno. O desconto aparece à parte e nunca
 * soma ao "total recebido" (que é o dinheiro: principal + juros + multa).
 */
interface ReceivableHistoryModalProps {
  open: boolean;
  receivable: Receivable;
  onClose: () => void;
  canReverse: (movement: ReceivableMovement) => boolean;
  onReverse: (movement: ReceivableMovement) => void;
}

const signed = (movement: ReceivableMovement, cents: number): string =>
  movement.kind === 'reversal' && cents > 0 ? `− ${formatCents(cents)}` : formatCents(cents);

const ReceivableHistoryModal: React.FC<ReceivableHistoryModalProps> = ({
  open, receivable, onClose, canReverse, onReverse,
}) => {
  const movements = useReceivableMovements(open ? receivable.id : null);
  const items = movements.data ?? [];

  return (
    <ClientsDialog
      open={open}
      title="Histórico do recebível"
      icon={<HistoryIcon className="w-5 h-5 text-primary" />}
      onClose={onClose}
      footer={(
        <button type="button" onClick={onClose} className={styles.cancel}>Fechar</button>
      )}
    >
      <p className="text-sm text-muted">
        <span className="font-medium text-on-surface">{receivable.description}</span>
        {' · '}valor original {formatCents(receivable.amountCents)} · saldo {formatCents(receivable.balanceCents)}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
        <dt>Principal recebido</dt><dd className="text-right text-on-surface">{formatCents(receivable.principalReceivedCents)}</dd>
        <dt>Juros recebidos</dt><dd className="text-right text-on-surface">{formatCents(receivable.interestReceivedCents)}</dd>
        <dt>Multa recebida</dt><dd className="text-right text-on-surface">{formatCents(receivable.penaltyReceivedCents)}</dd>
        <dt>Desconto concedido</dt><dd className="text-right text-on-surface">{formatCents(receivable.discountGrantedCents)}</dd>
      </dl>
      {movements.isLoading && <p className="text-sm text-muted">Carregando...</p>}
      {movements.isError && <p role="alert" className="text-sm text-error">Não foi possível carregar o histórico.</p>}
      {movements.isSuccess && items.length === 0 && (
        <p className="text-sm text-muted">Nenhum recebimento registrado.</p>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-border border border-border rounded-lg">
          {items.map((movement) => (
            <li key={movement.id} className="p-3 text-sm space-y-1">
              <div className="flex justify-between gap-2">
                <span className="font-medium text-on-surface">
                  {movementLabel(movement)} · {formatDayKey(movement.date)}
                </span>
                <span className="text-xs text-muted">{movementStateLabel(movement, items)}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 text-xs text-muted">
                <dt>Principal</dt><dd className="text-right">{signed(movement, movement.principalCents)}</dd>
                <dt>Juros</dt><dd className="text-right">{signed(movement, movement.interestCents)}</dd>
                <dt>Multa</dt><dd className="text-right">{signed(movement, movement.penaltyCents)}</dd>
                <dt>Desconto (não é dinheiro)</dt><dd className="text-right">{signed(movement, movement.discountCents)}</dd>
                <dt className="font-medium text-on-surface">Total recebido</dt>
                <dd className="text-right font-bold text-on-surface">{signed(movement, movement.cashCents)}</dd>
              </dl>
              {movement.reason && <p className="text-xs text-muted">Motivo: {movement.reason}</p>}
              {canReverse(movement) && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => onReverse(movement)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                  >
                    <RotateCcwIcon className="w-3.5 h-3.5" /> Estornar
                  </button>
                </div>
              )}
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

export default ReceivableHistoryModal;
