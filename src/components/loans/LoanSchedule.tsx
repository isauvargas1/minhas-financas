import React from 'react';

import { formatCents, formatDayKey } from '../../modules/loans/money.ts';
import {
  INSTALLMENT_STATE_LABELS,
  scheduleRows,
  type InstallmentState,
} from '../../modules/loans/presentation.ts';
import type { Loan } from '../../modules/loans/types.ts';

/**
 * Cronograma persistido pelo backend (P3-H), na mesma lista de parcelas de
 * antes: nenhum valor é calculado aqui. Cada parcela mostra o total e, logo
 * abaixo do vencimento, o principal (amortização do saldo) e os juros (custo).
 */
type Tone = 'paid' | 'overdue' | 'pending';

const toneOf = (state: InstallmentState): Tone =>
  state === 'amortized' ? 'paid' : state === 'overdue' ? 'overdue' : 'pending';

const PF = {
  scroll: 'overflow-y-auto custom-scrollbar flex-1 pr-2',
  list: 'space-y-3',
  item: () => 'flex items-center justify-between p-3 rounded-xl border border-border bg-background/50',
  left: 'flex items-center gap-3',
  badge: (tone: Tone) => `w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
    tone === 'paid' ? 'bg-green-100 text-green-700' : tone === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`,
  title: 'font-bold text-on-surface text-xs',
  meta: 'text-[10px] text-muted',
  total: 'font-bold text-on-surface text-sm',
};

const PJ = {
  scroll: 'overflow-y-auto custom-scrollbar flex-1 pr-2',
  list: 'space-y-4',
  item: (tone: Tone) => `flex items-center justify-between p-4 rounded-2xl border ${
    tone === 'paid' ? 'bg-green-50/30 border-green-100' : tone === 'overdue' ? 'bg-red-50/30 border-red-100' : 'bg-background/50 border-border'}`,
  left: 'flex items-center gap-4',
  badge: (tone: Tone) => `w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shadow-sm ${
    tone === 'paid' ? 'bg-green-100 text-green-700' : tone === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-600'}`,
  title: 'font-black text-on-surface text-xs uppercase tracking-wider',
  meta: 'text-[10px] text-muted font-bold',
  total: 'font-black text-on-surface text-base',
};

const LoanSchedule: React.FC<{ loan: Loan; today: string }> = ({ loan, today }) => {
  const rows = scheduleRows(loan, today);
  const isPJ = loan.profileType === 'PJ';
  const s = isPJ ? PJ : PF;
  return (
    // Região rolável alcançável pelo teclado (setas rolam a lista).
    <div className={s.scroll} tabIndex={0} role="region" aria-label="Cronograma do empréstimo">
      <ol className={s.list} aria-label="Parcelas do empréstimo">
        {rows.map((row) => {
          const tone = toneOf(row.state);
          const label = INSTALLMENT_STATE_LABELS[row.state];
          return (
            <li key={row.number} className={s.item(tone)}>
              <div className={s.left}>
                <div className={s.badge(tone)} aria-hidden="true">{row.number}</div>
                <div>
                  <p className={s.title}>Parcela {row.number}</p>
                  <p className={s.meta}>Vence em {formatDayKey(row.dueDate)}</p>
                  <p className={s.meta}>
                    Principal {formatCents(row.principalCents)} · Juros {formatCents(row.interestCents)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className={s.total}>{formatCents(row.totalCents)}</p>
                {isPJ ? (
                  <div className="flex gap-2 justify-end mt-1">
                    <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${
                      tone === 'paid' ? 'bg-green-600 text-white' : tone === 'overdue' ? 'bg-red-600 text-white' : 'bg-gray-400 text-white'}`}>
                      {label}
                    </span>
                  </div>
                ) : (
                  <span className={`text-[9px] font-black uppercase ${
                    tone === 'paid' ? 'text-green-600' : tone === 'overdue' ? 'text-red-600' : 'text-gray-400'}`}>
                    {label}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default LoanSchedule;
