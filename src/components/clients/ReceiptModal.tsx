import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { useWorkspace } from '../../contexts/WorkspaceContext.tsx';
import { useClientsIntentKey, useReceiveReceivable } from '../../modules/clients/hooks.ts';
import { centsToInput, formatCents, saoPauloToday } from '../../modules/loans/money.ts';
import {
  receiptAmountsOf,
  receiptCashCents,
  toReceivePayload,
  type ReceiptForm,
} from '../../modules/clients/payloads.ts';
import { clientsErrorView } from '../../modules/clients/presentation.ts';
import type { Receivable } from '../../modules/clients/types.ts';
import { CheckIcon } from '../Icons.tsx';
import CashAccountSelect from '../accounts/CashAccountSelect.tsx';
import ClientsDialog, { CLIENTS_FORM_STYLES as styles, ClientsFormError } from './ClientsDialog.tsx';

/**
 * Registrar recebimento (D-39, P3-I) — substitui "Marcar Recebido". Principal,
 * juros, multa e desconto explícitos: o principal sugerido é o saldo (pode ser
 * parcial); juros e multa não abatem o saldo; o desconto abate o saldo e não
 * entra no caixa. O caixa recebe principal + juros + multa.
 */
interface ReceiptModalProps {
  open: boolean;
  /** O recebível como estava ao abrir (versão e saldo da intenção). */
  receivable: Receivable;
  onClose: () => void;
  onDone: (message: string) => void;
}

const ReceiptModal: React.FC<ReceiptModalProps> = ({ open, receivable, onClose, onDone }) => {
  const id = useId();
  const { activeWorkspace } = useWorkspace();
  const mutation = useReceiveReceivable();
  const { keyFor, reset } = useClientsIntentKey();
  const today = saoPauloToday();
  const [form, setForm] = useState<ReceiptForm>({
    principal: '', interest: '', penalty: '', discount: '', paymentDate: today, cashAccountId: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    reset();
    setError(null);
    setForm({
      principal: centsToInput(receivable.balanceCents),
      interest: '',
      penalty: '',
      discount: '',
      paymentDate: saoPauloToday(),
      cashAccountId: '',
    });
  }, [open, receivable, reset]);

  /** Prévia só para leitura: valores inválidos não mostram total. */
  const preview = useMemo(() => {
    try {
      const amounts = receiptAmountsOf(form);
      return {
        cashCents: receiptCashCents(amounts),
        balanceAfterCents: receivable.balanceCents - amounts.principalCents - amounts.discountCents,
      };
    } catch {
      return null;
    }
  }, [form, receivable.balanceCents]);

  const set = (field: keyof ReceiptForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));
  const setAccount = useCallback((cashAccountId: string) =>
    setForm((current) => ({ ...current, cashAccountId })), []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mutation.isPending) return;
    setError(null);
    try {
      const payload = toReceivePayload({
        workspaceId: activeWorkspace.id, receivable, form, today: saoPauloToday(),
      });
      const result = await mutation.mutateAsync({
        payload, idempotencyKey: keyFor('receiveReceivable', payload),
      });
      onDone(result.status === 'received'
        ? 'Recebimento registrado. O recebível foi quitado.'
        : 'Recebimento registrado.');
    } catch (failure) {
      setError(clientsErrorView(failure).message);
    }
  };

  const moneyField = (field: keyof ReceiptForm, label: string, hint?: string) => (
    <div>
      <label htmlFor={`${id}-${field}`} className={styles.label}>{label}</label>
      <input
        id={`${id}-${field}`}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        value={form[field]}
        onChange={set(field)}
        aria-describedby={hint ? `${id}-${field}-hint` : undefined}
        className={styles.input}
      />
      {hint && <p id={`${id}-${field}-hint`} className={styles.hint}>{hint}</p>}
    </div>
  );

  return (
    <ClientsDialog
      open={open}
      title="Registrar recebimento"
      icon={<CheckIcon className="w-5 h-5 text-primary" />}
      onClose={onClose}
      busy={mutation.isPending}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={mutation.isPending} className={styles.cancel}>
            Cancelar
          </button>
          <button type="submit" form={`${id}-form`} disabled={mutation.isPending} aria-busy={mutation.isPending} className={styles.submit}>
            {mutation.isPending ? 'Registrando…' : 'Registrar recebimento'}
          </button>
        </>
      )}
    >
      <form id={`${id}-form`} onSubmit={handleSubmit} className="space-y-4" noValidate>
        <p className="text-sm text-muted">
          <span className="font-medium text-on-surface">{receivable.description}</span>
          {' · '}saldo em aberto <span className="font-bold text-on-surface">{formatCents(receivable.balanceCents)}</span>
        </p>
        <div className="grid grid-cols-2 gap-4">
          {moneyField('principal', 'Principal (R$)')}
          {moneyField('discount', 'Desconto (R$)')}
          {moneyField('interest', 'Juros (R$)')}
          {moneyField('penalty', 'Multa (R$)')}
        </div>
        <p className={styles.hint}>
          Juros e multa entram no caixa e não abatem o saldo. O desconto abate o saldo e não entra no caixa.
        </p>
        <div>
          <label htmlFor={`${id}-date`} className={styles.label}>Data do recebimento <span className="text-error">*</span></label>
          <input
            id={`${id}-date`}
            type="date"
            value={form.paymentDate}
            max={today}
            onChange={set('paymentDate')}
            className={styles.input}
            required
            aria-required="true"
          />
        </div>
        {/* Conta que recebe o dinheiro (D-30, P3-J); só desconto não a usa. */}
        <CashAccountSelect
          id={`${id}-account`}
          label="Conta/carteira que recebe"
          value={form.cashAccountId}
          onChange={setAccount}
          autoSelect
          labelClassName={styles.label}
          selectClassName={styles.input}
          hintClassName={styles.hint}
        />
        <dl className="rounded-lg bg-background border border-border p-3 text-sm space-y-1" aria-live="polite">
          <div className="flex justify-between">
            <dt className="text-muted">Total que entra no caixa</dt>
            <dd className="font-bold text-on-surface">{preview ? formatCents(preview.cashCents) : '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Saldo após o recebimento</dt>
            <dd className="font-medium text-on-surface">
              {preview && preview.balanceAfterCents >= 0 ? formatCents(preview.balanceAfterCents) : '—'}
            </dd>
          </div>
        </dl>
        <ClientsFormError message={error} />
      </form>
    </ClientsDialog>
  );
};

export default ReceiptModal;
