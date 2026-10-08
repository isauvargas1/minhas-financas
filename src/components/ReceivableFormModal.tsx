import React, { useEffect, useId, useState } from 'react';

import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import {
  useActiveClientOptions,
  useClientsIntentKey,
  useCreateReceivable,
  useUpdateReceivable,
} from '../modules/clients/hooks.ts';
import { centsToInput, saoPauloToday } from '../modules/loans/money.ts';
import {
  RECEIVABLE_TEXT_LIMITS,
  toCreateReceivablePayload,
  toUpdateReceivablePayload,
  type ReceivableForm,
} from '../modules/clients/payloads.ts';
import {
  AMOUNT_LOCKED_HINT,
  clientsErrorView,
  isAmountLocked,
} from '../modules/clients/presentation.ts';
import type { Receivable } from '../modules/clients/types.ts';
import ClientsDialog, { CLIENTS_FORM_STYLES as styles, ClientsFormError } from './clients/ClientsDialog.tsx';
import { FileInvoiceIcon } from './Icons.tsx';

/**
 * Novo recebível e edição (D-39, P3-I). O valor é digitado em reais e vira
 * centavos inteiros sem ponto flutuante; o status não é escolhido aqui — nasce
 * "em aberto" no backend e só muda por recebimento, estorno ou cancelamento.
 * Na edição: descrição e vencimento; o valor original só sem recebimento
 * ativo e sem desconto; o cliente não muda.
 */
interface ReceivableFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  receivableToEdit?: Receivable | null;
  /** Nome do cliente do recebível em edição (pode estar arquivado). */
  editClientName?: string;
}

const ReceivableFormModal: React.FC<ReceivableFormModalProps> = ({
  isOpen, onClose, onDone, receivableToEdit, editClientName,
}) => {
  const id = useId();
  const { activeWorkspace } = useWorkspace();
  const editing = Boolean(receivableToEdit);
  const options = useActiveClientOptions(isOpen && !editing);
  const clients = options.data?.items ?? [];
  const createMutation = useCreateReceivable();
  const updateMutation = useUpdateReceivable();
  const { keyFor, reset } = useClientsIntentKey();
  const [form, setForm] = useState<ReceivableForm>({ description: '', clientId: '', amount: '', dueDate: '' });
  const [error, setError] = useState<string | null>(null);
  const busy = createMutation.isPending || updateMutation.isPending;
  const amountLocked = receivableToEdit ? isAmountLocked(receivableToEdit) : false;

  useEffect(() => {
    if (!isOpen) return;
    reset();
    setError(null);
    setForm(receivableToEdit
      ? {
        description: receivableToEdit.description,
        clientId: receivableToEdit.clientId,
        amount: centsToInput(receivableToEdit.amountCents),
        dueDate: receivableToEdit.dueDate,
      }
      : { description: '', clientId: '', amount: '', dueDate: saoPauloToday() });
  }, [isOpen, receivableToEdit, reset]);

  // Sem escolha ainda: o primeiro cliente ativo, como a tela já fazia.
  useEffect(() => {
    if (isOpen && !editing && clients.length > 0) {
      setForm((current) => current.clientId ? current : { ...current, clientId: clients[0].id });
    }
  }, [isOpen, editing, clients]);

  const set = (field: keyof ReceivableForm) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => setForm((current) => ({ ...current, [field]: event.target.value }));

  const noClients = !editing && options.isSuccess && clients.length === 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    try {
      if (receivableToEdit) {
        const payload = toUpdateReceivablePayload({
          workspaceId: activeWorkspace.id, receivable: receivableToEdit, form, amountLocked,
        });
        await updateMutation.mutateAsync({ payload, idempotencyKey: keyFor('updateReceivable', payload) });
        onDone('Recebível atualizado.');
      } else {
        const payload = toCreateReceivablePayload(activeWorkspace.id, form);
        await createMutation.mutateAsync({ payload, idempotencyKey: keyFor('createReceivable', payload) });
        onDone('Recebível cadastrado.');
      }
    } catch (failure) {
      setError(clientsErrorView(failure).message);
    }
  };

  return (
    <ClientsDialog
      open={isOpen}
      title={editing ? 'Editar Recebível' : 'Novo Recebível'}
      icon={<FileInvoiceIcon className="w-5 h-5 text-primary" />}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={styles.cancel}>
            Cancelar
          </button>
          <button type="submit" form={`${id}-form`} disabled={busy || noClients} aria-busy={busy} className={styles.submit}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      )}
    >
      <form id={`${id}-form`} onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor={`${id}-description`} className={styles.label}>Descrição <span className="text-error">*</span></label>
          <input
            id={`${id}-description`}
            type="text"
            value={form.description}
            onChange={set('description')}
            maxLength={RECEIVABLE_TEXT_LIMITS.description}
            className={styles.input}
            placeholder="Ex: Consultoria Junho"
            required
            aria-required="true"
          />
        </div>

        <div>
          <label htmlFor={`${id}-client`} className={styles.label}>Cliente <span className="text-error">*</span></label>
          {editing ? (
            <select id={`${id}-client`} value={form.clientId} disabled className={styles.input}>
              <option value={form.clientId}>{editClientName ?? 'Cliente'}</option>
            </select>
          ) : (
            <select
              id={`${id}-client`}
              value={form.clientId}
              onChange={set('clientId')}
              className={styles.input}
              required
              aria-required="true"
            >
              <option value="">Selecione um cliente</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          )}
          {noClients && <p className="text-xs text-error mt-1">Cadastre um cliente primeiro.</p>}
          {options.isError && <p className="text-xs text-error mt-1">Não foi possível carregar os clientes.</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${id}-amount`} className={styles.label}>Valor (R$) <span className="text-error">*</span></label>
            <input
              id={`${id}-amount`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={form.amount}
              onChange={set('amount')}
              disabled={amountLocked}
              aria-describedby={amountLocked ? `${id}-amount-hint` : undefined}
              className={`${styles.input} font-bold`}
              required
              aria-required="true"
            />
          </div>
          <div>
            <label htmlFor={`${id}-due`} className={styles.label}>Vencimento <span className="text-error">*</span></label>
            <input
              id={`${id}-due`}
              type="date"
              value={form.dueDate}
              onChange={set('dueDate')}
              className={styles.input}
              required
              aria-required="true"
            />
          </div>
        </div>
        {amountLocked && <p id={`${id}-amount-hint`} className={styles.hint}>{AMOUNT_LOCKED_HINT}</p>}
        <ClientsFormError message={error} />
      </form>
    </ClientsDialog>
  );
};

export default ReceivableFormModal;
