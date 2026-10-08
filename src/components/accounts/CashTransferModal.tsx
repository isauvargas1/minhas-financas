import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useAccountsIntentKey, useCreateCashTransfer } from '../../modules/accounts/hooks.ts';
import { ACCOUNT_TEXT_LIMITS, toCreateCashTransferPayload } from '../../modules/accounts/payloads.ts';
import { accountsErrorView } from '../../modules/accounts/presentation.ts';
import type { CashAccount } from '../../modules/accounts/types.ts';
import { formatCents, formatDayKey, saoPauloToday } from '../../modules/loans/money.ts';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { RepeatIcon } from '../Icons.tsx';
import ClientsDialog, { CLIENTS_FORM_STYLES as styles, ClientsFormError } from '../clients/ClientsDialog.tsx';

/**
 * Transferência entre contas (D-30, P3-J): origem, destino, valor, data e
 * descrição opcional; antes de enviar, a confirmação mostra origem, destino
 * e valor. Não é receita nem despesa: o efeito global é zero.
 */
interface CashTransferModalProps {
  open: boolean;
  accounts: CashAccount[];
  onClose: () => void;
  onDone: (message: string) => void;
}

const emptyForm = (today: string) => ({
  sourceAccountId: '',
  destinationAccountId: '',
  amount: '',
  date: today,
  description: '',
});

const CashTransferModal: React.FC<CashTransferModalProps> = ({ open, accounts, onClose, onDone }) => {
  const id = useId();
  const { activeWorkspace } = useWorkspace();
  const mutation = useCreateCashTransfer();
  const { keyFor, reset } = useAccountsIntentKey();
  const [form, setForm] = useState(() => emptyForm(saoPauloToday()));
  const [review, setReview] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Barra o segundo envio antes do próximo render (clique duplo).
  const submittingRef = useRef(false);
  const busy = mutation.isPending;
  const active = useMemo(() => accounts.filter((account) => account.status === 'active'), [accounts]);
  const nameOf = (accountId: unknown) =>
    accounts.find((account) => account.id === accountId)?.name ?? '—';

  useEffect(() => {
    if (!open) return;
    reset();
    setError(null);
    setReview(null);
    setForm(emptyForm(saoPauloToday()));
  }, [open, reset]);

  const set = (field: keyof ReturnType<typeof emptyForm>) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
    };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || submittingRef.current) return;
    setError(null);
    if (!review) {
      try {
        setReview(toCreateCashTransferPayload(form, activeWorkspace.id));
      } catch (caught) {
        setError(accountsErrorView(caught).message);
      }
      return;
    }
    submittingRef.current = true;
    try {
      await mutation.mutateAsync({
        payload: review, idempotencyKey: keyFor('createCashTransfer', review),
      });
      onDone('Transferência registrada.');
    } catch (caught) {
      setError(accountsErrorView(caught).message);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <ClientsDialog
      open={open}
      title={review ? 'Confirmar transferência' : 'Nova transferência'}
      icon={<RepeatIcon className="w-5 h-5 text-primary" />}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button
            type="button"
            onClick={review ? () => { setReview(null); setError(null); } : onClose}
            disabled={busy}
            className={styles.cancel}
          >
            {review ? 'Voltar' : 'Cancelar'}
          </button>
          <button type="submit" form={`${id}-form`} disabled={busy} aria-busy={busy} className={styles.submit}>
            {busy ? 'Enviando…' : review ? 'Confirmar transferência' : 'Revisar'}
          </button>
        </>
      )}
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {review ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Origem</dt>
              <dd className="text-right font-medium text-on-surface">{nameOf(review.sourceAccountId)}</dd>
              <dt className="text-muted">Destino</dt>
              <dd className="text-right font-medium text-on-surface">{nameOf(review.destinationAccountId)}</dd>
              <dt className="text-muted">Valor</dt>
              <dd className="text-right font-bold text-on-surface">{formatCents(review.amountCents as number)}</dd>
              <dt className="text-muted">Data</dt>
              <dd className="text-right text-on-surface">{formatDayKey(review.date as string)}</dd>
              {typeof review.description === 'string' && (
                <>
                  <dt className="text-muted">Descrição</dt>
                  <dd className="text-right text-on-surface">{review.description}</dd>
                </>
              )}
            </dl>
            <p className="text-xs text-muted">
              A transferência não é receita nem despesa: só move o saldo entre as duas contas.
            </p>
          </>
        ) : (
          <>
            <div>
              <label htmlFor={`${id}-source`} className={styles.label}>Conta de origem</label>
              <select id={`${id}-source`} value={form.sourceAccountId} onChange={set('sourceAccountId')}
                className={styles.input} disabled={busy}>
                <option value="" disabled>Selecione a conta</option>
                {active.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({formatCents(account.balanceCents)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-destination`} className={styles.label}>Conta de destino</label>
              <select id={`${id}-destination`} value={form.destinationAccountId} onChange={set('destinationAccountId')}
                className={styles.input} disabled={busy}>
                <option value="" disabled>Selecione a conta</option>
                {active.filter((account) => account.id !== form.sourceAccountId).map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={`${id}-amount`} className={styles.label}>Valor (R$)</label>
                <input id={`${id}-amount`} type="text" inputMode="decimal" value={form.amount}
                  onChange={set('amount')} className={styles.input} placeholder="0,00" disabled={busy} />
              </div>
              <div>
                <label htmlFor={`${id}-date`} className={styles.label}>Data</label>
                <input id={`${id}-date`} type="date" value={form.date} max={saoPauloToday()}
                  onChange={set('date')} className={styles.input} disabled={busy} />
              </div>
            </div>
            <div>
              <label htmlFor={`${id}-description`} className={styles.label}>Descrição (opcional)</label>
              <input id={`${id}-description`} type="text" value={form.description}
                maxLength={ACCOUNT_TEXT_LIMITS.description} onChange={set('description')}
                className={styles.input} disabled={busy} />
            </div>
          </>
        )}
        <ClientsFormError message={error} />
      </form>
    </ClientsDialog>
  );
};

export default CashTransferModal;
