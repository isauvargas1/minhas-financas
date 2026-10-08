import React from 'react';

import { formatCents, formatDayKey } from '../../modules/loans/money.ts';
import {
  movementLabel,
  movementStateLabel,
} from '../../modules/loans/presentation.ts';
import type { Loan, LoanMovement } from '../../modules/loans/types.ts';
import { CheckIcon, CoinsIcon, HistoryIcon } from '../Icons.tsx';

/**
 * Histórico de movimentos do contrato (P3-H), na mesma lista de antes:
 * contratação, pagamentos ou recebimentos e estornos/cancelamento. Nada é
 * apagado: o movimento estornado continua visível, marcado (texto e borda
 * tracejada), e o estorno aponta para ele. Juros nunca aparecem como
 * amortização: cada linha separa principal e juros.
 */
interface LoanMovementHistoryProps {
  loan: Loan;
  movements: LoanMovement[];
  canReverse: (movement: LoanMovement) => boolean;
  onReverse: (movement: LoanMovement) => void;
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore?: () => void;
}

const LoanMovementHistory: React.FC<LoanMovementHistoryProps> = ({
  loan, movements, canReverse, onReverse, hasMore, isFetchingMore, onLoadMore,
}) => {
  const isPJ = loan.profileType === 'PJ';
  const byId = new Map(movements.map((movement) => [movement.id, movement]));
  const amountClass = loan.type === 'lend' ? 'text-green-600' : 'text-red-600';

  if (movements.length === 0) {
    return isPJ ? (
      <div className="flex flex-col items-center justify-center h-full text-muted opacity-40 py-20">
        <HistoryIcon className="w-16 h-16 mb-4" />
        <p className="text-sm font-black uppercase tracking-widest">Sem movimentações financeiras</p>
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center h-48 text-muted opacity-50">
        <HistoryIcon className="w-12 h-12 mb-2" />
        <p className="text-sm font-medium">Nenhuma movimentação registrada.</p>
      </div>
    );
  }

  return (
    <div className={isPJ ? 'space-y-3' : 'space-y-2'}>
      <ul className={isPJ ? 'space-y-3' : 'space-y-2'} aria-label="Movimentos do empréstimo">
        {movements.map((movement) => {
          const label = movementLabel(movement, loan.type);
          const original = movement.reversalOf ? byId.get(movement.reversalOf) : undefined;
          const reversal = movement.reversedBy ? byId.get(movement.reversedBy) : undefined;
          const active = movement.kind !== 'reversal' && !movement.reversedBy;
          const border = movement.reversedBy ? 'border-dashed' : '';
          const relation = (
            <>
              {movement.kind === 'reversal' && (
                <p className={`${isPJ ? 'text-[10px]' : 'text-xs'} text-muted mt-0.5 break-words`}>
                  {original
                    ? `Compensa: ${movementLabel(original, loan.type).toLowerCase()} de ${formatDayKey(original.date)}`
                    : 'Compensa um movimento anterior'}
                  {movement.reason ? ` · Motivo: ${movement.reason}` : ''}
                </p>
              )}
              {movement.reversedBy && (
                <p className={`${isPJ ? 'text-[10px]' : 'text-xs'} text-muted mt-0.5`}>
                  {reversal ? `Compensado em ${formatDayKey(reversal.date)}` : 'Compensado por um movimento posterior'}
                </p>
              )}
            </>
          );
          const reverseButton = canReverse(movement) && (
            <button
              type="button"
              onClick={() => onReverse(movement)}
              className="mt-2 px-3 py-1 text-xs font-bold rounded-lg border border-border text-on-surface hover:bg-surface"
              aria-label={`Estornar ${label.toLowerCase()} de ${formatDayKey(movement.date)}`}
            >
              Estornar
            </button>
          );

          if (isPJ) {
            return (
              <li key={movement.id} data-movement-kind={movement.kind}
                className={`p-4 bg-background rounded-2xl border border-border ${border} flex justify-between items-center gap-3 hover:shadow-md transition-all`}>
                <div className="flex items-center gap-4 min-w-0">
                  <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-white ${loan.type === 'borrow' ? 'bg-red-500' : 'bg-green-500'}`}>
                    <CoinsIcon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-on-surface text-sm">{label}</p>
                    <div className="flex gap-2 items-center text-[10px] text-muted font-bold uppercase mt-0.5 flex-wrap">
                      <span>{formatDayKey(movement.date)}</span>
                      <span aria-hidden="true">•</span>
                      <span>P: {formatCents(movement.principalCents)}</span>
                      <span aria-hidden="true">•</span>
                      <span>J: {formatCents(movement.interestCents)}</span>
                    </div>
                    {relation}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className={`font-black text-lg ${loan.type === 'borrow' ? 'text-red-600' : 'text-green-600'}`}>{formatCents(movement.totalCents)}</p>
                  <span className={`text-[9px] uppercase font-black flex items-center justify-end gap-1 ${active ? 'text-green-600' : 'text-muted'}`}>
                    {active && <CheckIcon className="w-3 h-3" />} {movementStateLabel(movement)}
                  </span>
                  {reverseButton}
                </div>
              </li>
            );
          }

          return (
            <li key={movement.id} data-movement-kind={movement.kind}
              className={`p-4 bg-background rounded-lg border border-border ${border} flex justify-between items-center gap-3 hover:bg-surface/50 transition-colors`}>
              <div className="min-w-0">
                <p className="font-bold text-on-surface text-sm">{label}</p>
                <p className="text-xs text-muted">{formatDayKey(movement.date)}</p>
                <p className="text-xs text-muted">
                  Principal {formatCents(movement.principalCents)} · Juros {formatCents(movement.interestCents)}
                </p>
                {relation}
              </div>
              <div className="text-right shrink-0">
                <p className={`font-black ${amountClass}`}>{formatCents(movement.totalCents)}</p>
                <span className="text-[9px] text-muted uppercase font-bold flex items-center justify-end gap-1">
                  {active && <CheckIcon className="w-3 h-3" />} {movementStateLabel(movement)}
                </span>
                {reverseButton}
              </div>
            </li>
          );
        })}
      </ul>
      {hasMore && onLoadMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isFetchingMore}
          className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-on-surface disabled:opacity-60"
        >
          {isFetchingMore ? 'Carregando…' : 'Carregar movimentações anteriores'}
        </button>
      )}
    </div>
  );
};

export default LoanMovementHistory;
