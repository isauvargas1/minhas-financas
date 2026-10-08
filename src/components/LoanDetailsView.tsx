import React from 'react';
import { motion } from 'framer-motion';

import { useLoan, useLoanMovements } from '../modules/loans/hooks.ts';
import { formatCents, formatDayKey, saoPauloToday } from '../modules/loans/money.ts';
import {
  LOAN_STATUS_LABELS,
  LOAN_TYPE_LABELS,
  interestLabel,
  openBalanceCents,
  principalProgressPercent,
} from '../modules/loans/presentation.ts';
import { BackIcon, CalendarIcon, CoinsIcon, EditIcon, HandshakeIcon, HistoryIcon, PlusIcon, WarningIcon } from './Icons.tsx';
import LoanMovementHistory from './loans/LoanMovementHistory.tsx';
import LoanSchedule from './loans/LoanSchedule.tsx';
import { LoanNotice, useLoanOperations } from './loans/useLoanOperations.tsx';

/**
 * Detalhe do empréstimo PF (P3-H): só o contrato autoritativo. Saldo,
 * acumulados, status, atraso e cronograma vêm do backend; as ações chamam as
 * callables (pagamento/recebimento, estorno, cancelamento, dados). Layout e
 * classes da tela anterior; "Excluir" virou "Cancelar empréstimo" e há
 * "Editar dados" (só campos não financeiros).
 */
interface LoanDetailsViewProps {
  loanId: string;
  onBack: () => void;
}

const LoanDetailsView: React.FC<LoanDetailsViewProps> = ({ loanId, onBack }) => {
  const { data: loan, isLoading } = useLoan(loanId);
  const {
    data: movements,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useLoanMovements(loanId);
  const operations = useLoanOperations(loan);
  const MotionDiv = motion.div as any;
  const today = saoPauloToday();

  if (isLoading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" role="status" aria-label="Carregando empréstimo"></div></div>;
  }
  if (!loan) {
    return (
      <div className="flex flex-col items-start gap-4 py-10">
        <button onClick={onBack} className="flex items-center gap-2 text-muted hover:text-on-surface transition-colors">
          <BackIcon className="h-5 w-5" /> Voltar
        </button>
        <p role="alert" className="text-on-surface">Empréstimo não encontrado. Atualize a lista e tente novamente.</p>
      </div>
    );
  }

  const { permissions } = operations;
  const progress = principalProgressPercent(loan);
  const isBorrow = loan.type === 'borrow';
  const cancelled = loan.status === 'cancelled';

  return (
    <div className="flex flex-col h-full animate-fade-in pb-10">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <button onClick={onBack} className="flex items-center gap-2 text-muted hover:text-on-surface transition-colors">
          <BackIcon className="h-5 w-5" /> Voltar
        </button>
        {permissions.canManage && (
          <div className="flex items-center gap-3 flex-wrap">
            {permissions.canEditMetadata && (
              <button type="button" onClick={operations.openMetadata} className="px-4 py-2 bg-surface border border-border text-xs font-bold uppercase rounded-lg hover:bg-background transition-all flex items-center gap-2">
                <EditIcon className="h-3.5 w-3.5" /> Editar dados
              </button>
            )}
            {permissions.canCancel && (
              <button type="button" onClick={operations.openCancel} className="px-4 py-2 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 text-xs font-bold uppercase rounded-lg hover:bg-red-100 transition-colors shadow-sm">
                Cancelar empréstimo
              </button>
            )}
          </div>
        )}
      </div>

      <LoanNotice message={operations.notice} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-surface rounded-2xl p-8 shadow-md border border-border relative overflow-hidden">
          <div className="flex items-start gap-6 relative z-10">
            <div className={`w-20 h-20 rounded-3xl flex items-center justify-center shadow-lg border-4 border-surface text-white text-4xl ${loan.type === 'lend' ? 'bg-green-600' : 'bg-red-600'}`}>
              <HandshakeIcon size={40} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className={`px-2.5 py-1 rounded text-[10px] uppercase font-bold tracking-widest ${loan.type === 'lend' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {LOAN_TYPE_LABELS.PF[loan.type]}
                </span>
                <span data-testid="loan-status" className="px-2.5 py-1 rounded text-[10px] uppercase font-bold bg-background text-muted border border-border">{LOAN_STATUS_LABELS[loan.status]}</span>
              </div>
              <h1 className="text-4xl font-black text-on-surface mb-2 break-words">{loan.personName}</h1>
              <p className="text-muted text-sm">{loan.description}</p>
              {loan.personContact && <p className="text-xs text-primary mt-1 font-medium">{loan.personContact}</p>}
            </div>
          </div>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <span className="text-sm font-bold text-muted uppercase tracking-widest">Saldo Pendente</span>
              <div data-testid="loan-balance" className="text-4xl font-black text-on-surface mt-1">
                {cancelled ? 'Cancelado' : formatCents(openBalanceCents(loan))}
              </div>
              <div className="h-3 bg-background rounded-full overflow-hidden relative mt-4 border border-border/50" role="progressbar" aria-label="Principal liquidado" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                <MotionDiv className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 1 }} />
              </div>
              <div className="flex justify-between mt-2 text-[10px] font-bold text-muted uppercase">
                <span>Principal liquidado: {progress}%</span>
                <span>{formatCents(loan.totalPrincipalSettledCents)} {isBorrow ? 'pagos' : 'recebidos'}</span>
              </div>
            </div>

            <dl className="space-y-4">
              <div className="flex justify-between text-sm">
                <dt className="text-muted font-medium">Principal:</dt>
                <dd className="font-bold text-on-surface">{formatCents(loan.principalCents)}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted font-medium">Juros:</dt>
                <dd className="font-bold text-on-surface text-right">{interestLabel(loan.interest)}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted font-medium">Juros previstos:</dt>
                <dd data-testid="loan-interest-scheduled" className="font-bold text-on-surface">{formatCents(loan.scheduledInterestCents)}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted font-medium">Juros {isBorrow ? 'pagos' : 'recebidos'}:</dt>
                <dd data-testid="loan-interest-settled" className="font-bold text-on-surface">{formatCents(loan.totalInterestSettledCents)}</dd>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-border">
                <dt className="text-muted font-medium">Modo:</dt>
                <dd className="font-bold text-on-surface">{loan.installmentsCount > 1 ? `${loan.installmentsCount} parcelas` : 'Pagamento único'}</dd>
              </div>
            </dl>
          </div>

          {permissions.canManage && (
            <button
              type="button"
              disabled={!permissions.canPay}
              onClick={operations.openPayment}
              className="mt-8 w-full py-4 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:shadow-none"
            >
              <PlusIcon className="w-5 h-5" /> {isBorrow ? 'Registrar Pagamento' : 'Registrar Recebimento'}
            </button>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-surface rounded-2xl p-6 shadow-sm border border-border flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><CalendarIcon className="h-6 w-6" /></div>
            <div>
              <span className="text-[10px] font-black text-muted uppercase tracking-widest block">Data de Início</span>
              <p className="text-lg font-bold text-on-surface">{formatDayKey(loan.startDate)}</p>
            </div>
          </div>
          <div className="bg-surface rounded-2xl p-6 shadow-sm border border-border flex items-center gap-4">
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl"><CoinsIcon className="h-6 w-6" /></div>
            <div>
              <span className="text-[10px] font-black text-muted uppercase tracking-widest block">Quitação Prevista</span>
              <p className="text-lg font-bold text-on-surface">{formatDayKey(loan.maturityDate)}</p>
            </div>
          </div>
          {loan.status === 'overdue' && (
            <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-2xl border border-red-200 dark:border-red-900/30 flex items-center gap-4">
              <div className="p-3 bg-red-100 text-red-600 rounded-xl"><WarningIcon className="h-6 w-6" /></div>
              <div>
                <span className="text-[10px] font-black text-red-600 uppercase tracking-widest block">Atenção</span>
                <p className="text-sm font-bold text-red-700">Contrato em atraso!</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 min-h-0">
        <div className="flex flex-col min-h-0">
          <h3 className="font-bold text-lg text-on-surface mb-4 flex items-center gap-2"><HistoryIcon className="h-5 w-5 text-primary" /> Histórico de Movimentações</h3>
          <div className="bg-surface rounded-xl shadow-sm border border-border flex-1 overflow-hidden flex flex-col">
            <div className="overflow-y-auto custom-scrollbar flex-1 p-2" tabIndex={0} role="region" aria-label="Histórico de movimentações">
              <LoanMovementHistory
                loan={loan}
                movements={movements ?? []}
                canReverse={permissions.canReverse}
                onReverse={operations.openReverse}
                hasMore={hasNextPage}
                isFetchingMore={isFetchingNextPage}
                onLoadMore={() => fetchNextPage()}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col min-h-0">
          <h3 className="font-bold text-lg text-on-surface mb-4 flex items-center gap-2"><CalendarIcon className="h-5 w-5 text-primary" /> Plano de Pagamento</h3>
          <div className="bg-surface rounded-xl shadow-sm border border-border flex-1 overflow-hidden flex flex-col p-4">
            <LoanSchedule loan={loan} today={today} />
          </div>
        </div>
      </div>

      {operations.modals}
    </div>
  );
};

export default LoanDetailsView;
