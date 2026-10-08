import React, { useEffect, useId, useState } from 'react';

import { useWorkspace } from '../../contexts/WorkspaceContext.tsx';
import { useLoanIntentKey, useRegisterLoanPayment } from '../../modules/loans/hooks.ts';
import {
  centsToInput,
  formatCents,
  parseBrlToCents,
  saoPauloToday,
} from '../../modules/loans/money.ts';
import { toPaymentPayload } from '../../modules/loans/payloads.ts';
import { loanErrorView, suggestedPayment } from '../../modules/loans/presentation.ts';
import type { Loan } from '../../modules/loans/types.ts';
import CashAccountSelect from '../accounts/CashAccountSelect.tsx';
import LoanDialog, { LoanFormError, LoanMoneyInput, actionVariantOf, loanDialogStyles } from './LoanDialog.tsx';

/**
 * Pagamento (borrow) ou recebimento (lend) pela callable `registerLoanPayment`
 * (P3-H). Principal e juros separados; a sugestão vem da próxima parcela do
 * cronograma persistido e só preenche os campos. O backend valida saldo,
 * data, versão, papel, status e concorrência; nada é gravado pelo cliente.
 * Moldura e campos no visual do registro de movimento PF/PJ anterior.
 */
interface LoanPaymentModalProps {
  open: boolean;
  loan: Loan;
  onClose: () => void;
  onDone: () => void;
}

const LoanPaymentModal: React.FC<LoanPaymentModalProps> = ({ open, loan, onClose, onDone }) => {
  const { activeWorkspace } = useWorkspace();
  const mutation = useRegisterLoanPayment();
  const intent = useLoanIntentKey();
  const id = useId();
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  const [date, setDate] = useState(saoPauloToday());
  // Conta/carteira que paga ou recebe (D-30, P3-J).
  const [cashAccountId, setCashAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const suggestion = suggestedPayment(loan);
  const isBorrow = loan.type === 'borrow';

  useEffect(() => {
    if (!open) return;
    intent.reset();
    setError(null);
    setDate(saoPauloToday());
    setCashAccountId('');
    setPrincipal(suggestion ? centsToInput(suggestion.principalCents) : '');
    setInterest(suggestion ? centsToInput(suggestion.interestCents) : '');
    // Só ao abrir: a sugestão não sobrescreve o que o usuário digitou.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const principalCents = principal.trim() === '' ? 0 : parseBrlToCents(principal, { allowZero: true });
  const interestCents = interest.trim() === '' ? 0 : parseBrlToCents(interest, { allowZero: true });
  const total = principalCents !== null && interestCents !== null ? principalCents + interestCents : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const payload = toPaymentPayload({ principal, interest, date, cashAccountId }, {
        workspaceId: activeWorkspace.id, loan, today: saoPauloToday(),
      });
      await mutation.mutateAsync({ payload, idempotencyKey: intent.keyFor('registerLoanPayment', payload) });
      onDone();
    } catch (failure) {
      setError(loanErrorView(failure).message);
    }
  };

  const busy = mutation.isPending;
  const isPJ = loan.profileType === 'PJ';
  const variant = actionVariantOf(loan.profileType);
  const styles = loanDialogStyles(variant);
  const title = isPJ
    ? (isBorrow ? 'Registrar Pagamento (Passivo)' : 'Registrar Recebimento (Ativo)')
    : (isBorrow ? 'Registrar Pagamento' : 'Registrar Recebimento');
  const prefixClass = isPJ ? 'absolute left-3 top-2.5 text-muted font-bold text-xs' : undefined;
  return (
    <LoanDialog
      open={open}
      title={title}
      variant={variant}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={styles.secondary}>Cancelar</button>
          <button type="submit" form={`${id}-form`} disabled={busy} aria-busy={busy} className={styles.primary}>
            {busy ? 'Registrando…' : (isPJ ? 'Confirmar Registro' : 'Registrar')}
          </button>
        </>
      )}
    >
      <form id={`${id}-form`} onSubmit={submit} className={styles.stack} noValidate>
        {suggestion && (
          <p className="text-xs text-muted">
            Valores sugeridos da parcela {suggestion.installmentNumber}. Ajuste se {isBorrow ? 'pagou' : 'recebeu'} valores diferentes.
          </p>
        )}
        <div className={`grid grid-cols-2 ${isPJ ? 'gap-5' : 'gap-4'}`}>
          <div>
            <label htmlFor={`${id}-principal`} className={styles.label}>{isPJ ? 'Principal (Amortização)' : 'Principal (R$)'}</label>
            <LoanMoneyInput id={`${id}-principal`} value={principal} inputClass={styles.input} className="font-bold"
              prefixClass={prefixClass} onChange={(event) => setPrincipal(event.target.value)}
              aria-describedby={`${id}-principal-hint`} />
            <p id={`${id}-principal-hint`} className="text-[10px] text-muted mt-1">Saldo pendente: {formatCents(loan.balanceCents)}</p>
          </div>
          <div>
            <label htmlFor={`${id}-interest`} className={styles.label}>{isPJ ? 'Juros / Taxas' : 'Juros (R$)'}</label>
            <LoanMoneyInput id={`${id}-interest`} value={interest} inputClass={styles.input}
              className={isPJ ? 'font-bold text-blue-600' : 'font-bold'}
              prefixClass={prefixClass} onChange={(event) => setInterest(event.target.value)} />
          </div>
        </div>

        <div className="flex justify-between items-center bg-gray-50 dark:bg-dark-100 p-4 rounded-xl border border-border">
          <span className="text-xs font-black text-muted uppercase">Total do Lançamento:</span>
          <span className="text-xl font-black text-on-surface" aria-live="polite">
            {total === null ? '—' : formatCents(total)}
          </span>
        </div>

        <div>
          <label htmlFor={`${id}-date`} className={styles.label}>Data da Operação</label>
          <input
            id={`${id}-date`}
            type="date"
            min={loan.startDate}
            max={saoPauloToday()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={styles.input}
            required
          />
        </div>

        <CashAccountSelect
          id={`${id}-account`}
          label={isBorrow ? 'Conta/carteira que paga' : 'Conta/carteira que recebe'}
          value={cashAccountId}
          onChange={setCashAccountId}
          autoSelect
          labelClassName={styles.label}
          selectClassName={styles.input}
        />

        <div className="bg-blue-50 dark:bg-blue-900/10 p-3 rounded-lg border border-blue-100 dark:border-blue-900/30">
          <p className="text-[10px] text-blue-700 dark:text-blue-300">
            O total {isBorrow ? 'pago' : 'recebido'} é registrado automaticamente no caixa. Só o principal reduz o saldo; os juros são {isBorrow ? 'despesa' : 'receita'} financeira.
          </p>
        </div>
        <LoanFormError message={error} />
      </form>
    </LoanDialog>
  );
};

export default LoanPaymentModal;
