import React, { useEffect, useId, useState } from 'react';

import { LOAN_TEXT_LIMITS } from '../../modules/loans/payloads.ts';
import LoanDialog, { LoanFormError, loanDialogStyles } from './LoanDialog.tsx';

/**
 * Confirmação com motivo obrigatório (P3-H): estorno de movimento e
 * cancelamento do contrato, no visual do `ConfirmationModal` que a exclusão
 * usava. `onConfirm` recebe o motivo e devolve a mensagem de erro (pt-BR) ou
 * `null` quando concluiu.
 */
interface LoanReasonModalProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  reasonLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<string | null>;
  busy: boolean;
  /** Bloqueia a confirmação (ex.: cancelamento com pagamentos ativos). */
  blockedMessage?: string | null;
  children: React.ReactNode;
}

const styles = loanDialogStyles('confirm');

const LoanReasonModal: React.FC<LoanReasonModalProps> = ({
  open, title, confirmLabel, reasonLabel, onClose, onConfirm, busy, blockedMessage, children,
}) => {
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError(null);
  }, [open]);

  const blocked = Boolean(blockedMessage);
  const disabled = busy || blocked || !reason.trim();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    setError(await onConfirm(reason));
  };

  return (
    <LoanDialog
      open={open}
      title={title}
      variant="confirm"
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={styles.secondary}>Voltar</button>
          <button type="submit" form={`${id}-form`} disabled={disabled} aria-busy={busy} className={styles.danger}>
            {busy ? 'Enviando…' : confirmLabel}
          </button>
        </>
      )}
    >
      <form id={`${id}-form`} onSubmit={submit}>
        <div className="text-gray-600 dark:text-gray-300 space-y-2">{children}</div>
        {blocked ? (
          <p role="alert" className="mt-4 text-left rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-sm font-medium text-amber-900 dark:text-amber-200">
            {blockedMessage}
          </p>
        ) : (
          <div className="mt-4 text-left">
            <label htmlFor={`${id}-reason`} className={styles.label}>
              {reasonLabel} <span className="text-red-500">*</span>
            </label>
            <textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={LOAN_TEXT_LIMITS.reason}
              rows={2}
              required
              aria-required="true"
              className={styles.input}
            />
          </div>
        )}
        <LoanFormError message={error} variant="confirm" />
      </form>
    </LoanDialog>
  );
};

export default LoanReasonModal;
