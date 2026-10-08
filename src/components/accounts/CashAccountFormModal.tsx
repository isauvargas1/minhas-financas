import React, { useEffect, useId, useRef, useState } from 'react';

import {
  useAccountsIntentKey,
  useCreateCashAccount,
  useUpdateCashAccount,
} from '../../modules/accounts/hooks.ts';
import { CASH_ACCOUNT_TYPES } from '../../modules/accounts/adapters.ts';
import {
  ACCOUNT_TEXT_LIMITS,
  toCreateCashAccountPayload,
  toUpdateCashAccountPayload,
} from '../../modules/accounts/payloads.ts';
import { ACCOUNT_TYPE_LABELS, accountsErrorView } from '../../modules/accounts/presentation.ts';
import type { CashAccount, CashAccountType } from '../../modules/accounts/types.ts';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { WalletIcon } from '../Icons.tsx';
import ClientsDialog, { CLIENTS_FORM_STYLES as styles, ClientsFormError } from '../clients/ClientsDialog.tsx';

/**
 * Criação e edição de conta/carteira (D-30, P3-J), só owner/admin.
 *
 * Na criação: nome, tipo e saldo inicial opcional (positivo, zero ou
 * negativo), que vira o movimento `opening_balance` no backend — não é
 * receita nem despesa. Na edição: só nome e tipo; o saldo nunca é editável.
 */
interface CashAccountFormModalProps {
  open: boolean;
  account: CashAccount | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const CashAccountFormModal: React.FC<CashAccountFormModalProps> = ({
  open, account, onClose, onSaved,
}) => {
  const id = useId();
  const { activeWorkspace } = useWorkspace();
  const createMutation = useCreateCashAccount();
  const updateMutation = useUpdateCashAccount();
  const { keyFor, reset } = useAccountsIntentKey();
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<CashAccountType>('cash');
  const [openingBalance, setOpeningBalance] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Barra o segundo envio antes do próximo render (clique duplo).
  const submittingRef = useRef(false);
  const busy = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!open) return;
    reset();
    setError(null);
    setName(account?.name ?? '');
    setAccountType(account?.accountType ?? 'cash');
    setOpeningBalance('');
  }, [open, account, reset]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    try {
      if (account) {
        const payload = toUpdateCashAccountPayload({ name, accountType }, account, activeWorkspace.id);
        await updateMutation.mutateAsync({
          payload, idempotencyKey: keyFor('updateCashAccount', payload),
        });
        onSaved('Conta atualizada.');
      } else {
        const payload = toCreateCashAccountPayload(
          { name, accountType, openingBalance }, activeWorkspace.id,
        );
        await createMutation.mutateAsync({
          payload, idempotencyKey: keyFor('createCashAccount', payload),
        });
        onSaved('Conta criada.');
      }
    } catch (caught) {
      setError(accountsErrorView(caught).message);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <ClientsDialog
      open={open}
      title={account ? 'Editar conta' : 'Nova conta'}
      icon={<WalletIcon className="w-5 h-5 text-primary" />}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={styles.cancel}>Cancelar</button>
          <button type="submit" form={`${id}-form`} disabled={busy} aria-busy={busy} className={styles.submit}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      )}
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor={`${id}-name`} className={styles.label}>Nome da conta</label>
          <input
            id={`${id}-name`}
            type="text"
            value={name}
            maxLength={ACCOUNT_TEXT_LIMITS.name}
            onChange={(event) => setName(event.target.value)}
            className={styles.input}
            placeholder="Ex.: Conta corrente Banco X"
            required
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor={`${id}-type`} className={styles.label}>Tipo</label>
          <select
            id={`${id}-type`}
            value={accountType}
            onChange={(event) => setAccountType(event.target.value as CashAccountType)}
            className={styles.input}
            disabled={busy}
          >
            {CASH_ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>{ACCOUNT_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>
        {account ? (
          <p className={styles.hint}>
            O saldo não é editável: ele muda só com lançamentos, transferências, empréstimos e
            recebimentos.
          </p>
        ) : (
          <div>
            <label htmlFor={`${id}-opening`} className={styles.label}>Saldo inicial (opcional)</label>
            <input
              id={`${id}-opening`}
              type="text"
              inputMode="decimal"
              value={openingBalance}
              onChange={(event) => setOpeningBalance(event.target.value)}
              className={styles.input}
              placeholder="0,00"
              disabled={busy}
              aria-describedby={`${id}-opening-hint`}
            />
            <p id={`${id}-opening-hint`} className={styles.hint}>
              Não é receita nem despesa. Use - na frente para uma conta que já começa negativa.
            </p>
          </div>
        )}
        <ClientsFormError message={error} />
      </form>
    </ClientsDialog>
  );
};

export default CashAccountFormModal;
