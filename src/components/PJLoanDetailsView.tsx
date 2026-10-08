import React from 'react';
import { motion } from 'framer-motion';

import { useLoan, useLoanMovements } from '../modules/loans/hooks.ts';
import { formatCents, formatDayKey, saoPauloToday } from '../modules/loans/money.ts';
import {
  COUNTERPARTY_LABELS,
  LOAN_STATUS_LABELS,
  classificationLabel,
  interestLabel,
  openBalanceCents,
  principalProgressPercent,
} from '../modules/loans/presentation.ts';
import { BackIcon, BriefcaseIcon, CalendarIcon, CoinsIcon, EditIcon, HandshakeIcon, HistoryIcon, PlusIcon, TrendingUpIcon } from './Icons.tsx';
import LoanMovementHistory from './loans/LoanMovementHistory.tsx';
import LoanSchedule from './loans/LoanSchedule.tsx';
import { LoanNotice, useLoanOperations } from './loans/useLoanOperations.tsx';

/**
 * Detalhe da operação de empréstimo PJ (P3-H): o mesmo contrato autoritativo
 * do PF, com os dados gerenciais (classificação, centro de custo, tipo e
 * documento da contraparte). Nada financeiro é derivado aqui. Layout e
 * classes da tela anterior; "Excluir" virou "Cancelar empréstimo", "Editar
 * Operação" abre a edição dos dados não financeiros e "Novo Lançamento"
 * registra o pagamento ou recebimento pela callable.
 */
interface PJLoanDetailsViewProps {
  loanId: string;
  onBack: () => void;
}

const formatDocument = (digits?: string): string | null => {
  if (!digits) return null;
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return digits;
};

const PJLoanDetailsView: React.FC<PJLoanDetailsViewProps> = ({ loanId, onBack }) => {
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
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" role="status" aria-label="Carregando operação"></div></div>;
  }
  if (!loan) {
    return (
      <div className="flex flex-col items-start gap-4 py-10">
        <button onClick={onBack} className="flex items-center gap-2 text-muted hover:text-on-surface transition-all">
          <BackIcon className="h-5 w-5" /> <span className="font-bold text-sm uppercase tracking-widest">Painel de Empréstimos</span>
        </button>
        <p role="alert" className="text-on-surface">Operação não encontrada. Atualize a lista e tente novamente.</p>
      </div>
    );
  }

  const { permissions } = operations;
  const isLiab = loan.type === 'borrow';
  const cancelled = loan.status === 'cancelled';
  const progress = principalProgressPercent(loan);
  const document = formatDocument(loan.cnpjCpf);

  return (
    <div className="flex flex-col h-full animate-fade-in pb-10">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <button onClick={onBack} className="flex items-center gap-2 text-muted hover:text-on-surface transition-all group">
          <BackIcon className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
          <span className="font-bold text-sm uppercase tracking-widest">Painel de Empréstimos</span>
        </button>
        {permissions.canManage && (
          <div className="flex items-center gap-3 flex-wrap">
            {permissions.canEditMetadata && (
              <button type="button" onClick={operations.openMetadata} className="px-4 py-2 bg-surface border border-border text-xs font-bold uppercase rounded-lg hover:bg-background transition-all flex items-center gap-2">
                <EditIcon className="h-3.5 w-3.5" /> Editar Operação
              </button>
            )}
            {permissions.canCancel && (
              <button type="button" onClick={operations.openCancel} className="px-4 py-2.5 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 text-xs font-bold uppercase rounded-lg hover:bg-red-100 transition-colors shadow-sm">
                Cancelar empréstimo
              </button>
            )}
          </div>
        )}
      </div>

      <LoanNotice message={operations.notice} />

      {/* Analysis Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
        {/* Main Identity & Principal */}
        <div className="lg:col-span-3 bg-surface rounded-3xl p-8 shadow-xl border border-border relative overflow-hidden flex flex-col">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
            <div className="flex items-center gap-6 min-w-0">
              <div className={`w-20 h-20 shrink-0 rounded-3xl flex items-center justify-center text-white shadow-2xl border-4 border-surface text-4xl transform -rotate-3 ${isLiab ? 'bg-red-600' : 'bg-green-600'}`}>
                <HandshakeIcon size={40} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] uppercase font-black tracking-widest ${isLiab ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {isLiab ? 'Passivo Financeiro' : 'Ativo Financeiro'}
                  </span>
                  <span data-testid="loan-status" className="px-2.5 py-1 rounded-full text-[10px] uppercase font-black bg-background text-muted border border-border tracking-wider">{LOAN_STATUS_LABELS[loan.status]}</span>
                </div>
                <h1 className="text-4xl font-black text-on-surface tracking-tight leading-none mb-2 break-words">{loan.personName}</h1>
                <p className="text-muted text-sm font-medium flex items-center gap-2">
                  <BriefcaseIcon className="w-4 h-4" /> {loan.costCenter || 'Sem centro de custo vinculado'}
                </p>
                <p className="text-muted text-xs font-medium mt-2 break-words">
                  {classificationLabel(loan.classification)} · {loan.counterpartyType ? COUNTERPARTY_LABELS[loan.counterpartyType] : 'Contraparte não informada'}
                  {document && <> · <span data-testid="loan-document">{document}</span></>}
                </p>
                {(loan.description || loan.personContact) && (
                  <p className="text-muted text-xs mt-1 break-words">{[loan.description, loan.personContact].filter(Boolean).join(' · ')}</p>
                )}
              </div>
            </div>

            <div className="text-right flex flex-col items-end">
              <span className="text-[11px] font-black text-muted uppercase tracking-[0.2em] mb-1">{isLiab ? 'Saldo Devedor Atual' : 'Saldo a Receber Atual'}</span>
              <div data-testid="loan-balance" className="text-5xl font-black text-on-surface tracking-tighter">
                {cancelled ? 'Cancelado' : formatCents(openBalanceCents(loan))}
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 border-t border-border mt-auto">
            <div>
              <dt className="text-[10px] font-black text-muted uppercase tracking-widest mb-1 block">Principal Contratado</dt>
              <dd className="text-xl font-bold text-on-surface">{formatCents(loan.principalCents)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-black text-muted uppercase tracking-widest mb-1 block">Total Amortizado</dt>
              <dd className="text-xl font-bold text-green-600">{formatCents(loan.totalPrincipalSettledCents)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-black text-muted uppercase tracking-widest mb-1 block">Juros Acumulados ({isLiab ? 'Pagos' : 'Rec.'})</dt>
              <dd data-testid="loan-interest-settled" className="text-xl font-bold text-blue-600">{formatCents(loan.totalInterestSettledCents)}</dd>
            </div>
          </dl>

          <div className="mt-8 space-y-2">
            <div className="flex justify-between text-[10px] font-black text-muted uppercase tracking-[0.15em]">
              <span>Status da Liquidação</span>
              <span>{progress}% concluído</span>
            </div>
            <div className="h-2.5 bg-background rounded-full overflow-hidden border border-border/50 relative" role="progressbar" aria-label="Principal liquidado" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <MotionDiv className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 1.2 }} />
            </div>
          </div>
        </div>

        {/* PJ Insights Sidebar */}
        <div className="space-y-6">
          <div className="bg-primary/5 rounded-3xl p-6 border border-primary/20 flex flex-col justify-between">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-primary text-white rounded-xl shadow-lg">
                <TrendingUpIcon className="w-5 h-5" />
              </div>
              <h4 className="font-black text-sm text-primary uppercase tracking-widest">Resumo PJ</h4>
            </div>
            <dl className="space-y-4">
              <div>
                <dt className="text-[9px] font-bold text-muted uppercase">Custo Total Previsto</dt>
                <dd className="text-lg font-black text-on-surface">{formatCents(loan.principalCents + loan.scheduledInterestCents)}</dd>
              </div>
              <div className="pt-3 border-t border-primary/10">
                <dt className="text-[9px] font-bold text-muted uppercase">Taxa Vigente</dt>
                <dd className="text-sm font-bold text-on-surface">{interestLabel(loan.interest)}</dd>
              </div>
              <div className="pt-3 border-t border-primary/10">
                <dt className="text-[9px] font-bold text-muted uppercase">Impacto Fluxo de Caixa</dt>
                <dd className="text-xs font-medium text-muted leading-relaxed">Provisionado em {loan.installmentsCount > 1 ? `${loan.installmentsCount} parcelas` : 'Pagamento único'}.</dd>
              </div>
            </dl>
          </div>

          <div className="bg-surface rounded-3xl p-6 shadow-sm border border-border space-y-4">
            <div className="flex items-center gap-3">
              <CalendarIcon className="w-5 h-5 text-muted" />
              <div>
                <p className="text-[9px] font-bold text-muted uppercase leading-none">Início</p>
                <p className="text-sm font-bold text-on-surface">{formatDayKey(loan.startDate)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-4 border-t border-border">
              <CoinsIcon className="w-5 h-5 text-muted" />
              <div>
                <p className="text-[9px] font-bold text-muted uppercase leading-none">Vencimento Final</p>
                <p className="text-sm font-bold text-on-surface">{formatDayKey(loan.maturityDate)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions & Schedule */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
        {/* Movements History */}
        <div className="lg:col-span-7 flex flex-col min-h-[400px]">
          <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
            <h3 className="font-black text-lg text-on-surface uppercase tracking-widest flex items-center gap-2">
              <HistoryIcon className="h-5 w-5 text-primary" /> Histórico de Movimentações
            </h3>
            {permissions.canManage && (
              <button
                type="button"
                disabled={!permissions.canPay}
                onClick={operations.openPayment}
                className="bg-primary hover:bg-primary/90 text-white px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider shadow-lg transition-all active:scale-95 disabled:bg-gray-300 disabled:shadow-none"
              >
                <PlusIcon className="w-3.5 h-3.5 inline mr-1" /> Novo Lançamento
              </button>
            )}
          </div>

          <div className="bg-surface rounded-3xl shadow-xl border border-border flex-1 overflow-hidden flex flex-col">
            <div className="overflow-y-auto custom-scrollbar flex-1 p-3" tabIndex={0} role="region" aria-label="Histórico de movimentações">
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

        {/* Schedule Column */}
        <div className="lg:col-span-5 flex flex-col h-full">
          <h3 className="font-black text-lg text-on-surface uppercase tracking-widest mb-6 flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" /> Cronograma PJ
          </h3>
          <div className="bg-surface rounded-3xl shadow-xl border border-border flex-1 overflow-hidden flex flex-col p-6">
            <LoanSchedule loan={loan} today={today} />
          </div>
        </div>
      </div>

      {operations.modals}
    </div>
  );
};

export default PJLoanDetailsView;
