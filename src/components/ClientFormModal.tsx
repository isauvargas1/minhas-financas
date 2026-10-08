import React, { useEffect, useId, useState } from 'react';

import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import {
  useClientPrivate,
  useClientsIntentKey,
  useCreateClient,
  useUpdateClient,
} from '../modules/clients/hooks.ts';
import {
  CLIENT_TEXT_LIMITS,
  clientFormOf,
  toCreateClientPayload,
  toUpdateClientPayload,
  type ClientForm,
} from '../modules/clients/payloads.ts';
import { clientsErrorView } from '../modules/clients/presentation.ts';
import type { Client } from '../modules/clients/types.ts';
import ClientsDialog, { CLIENTS_FORM_STYLES as styles, ClientsFormError } from './clients/ClientsDialog.tsx';
import { UsersIcon } from './Icons.tsx';

/**
 * Cadastro de cliente (D-24, P3-I) — só owner e admin abrem. Nome no cadastro
 * compartilhado; e-mail, telefone, CPF/CNPJ e observações vão para o
 * documento privado. Na edição, os dados pessoais são lidos do documento
 * privado (as Rules só o entregam a owner/admin) e só o que mudou é enviado.
 */
interface ClientFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  clientToEdit?: Client | null;
}

const EMPTY: ClientForm = { name: '', email: '', phone: '', document: '', notes: '' };

const ClientFormModal: React.FC<ClientFormModalProps> = ({ isOpen, onClose, onDone, clientToEdit }) => {
  const id = useId();
  const { activeWorkspace } = useWorkspace();
  const editing = Boolean(clientToEdit);
  const personal = useClientPrivate(isOpen && clientToEdit ? clientToEdit.id : null);
  const createMutation = useCreateClient();
  const updateMutation = useUpdateClient();
  const { keyFor, reset } = useClientsIntentKey();
  const [form, setForm] = useState<ClientForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const busy = createMutation.isPending || updateMutation.isPending;
  const loadingPersonal = editing && personal.isLoading;

  useEffect(() => {
    if (!isOpen) return;
    reset();
    setError(null);
    setForm(clientToEdit ? clientFormOf(clientToEdit, null) : EMPTY);
  }, [isOpen, clientToEdit, reset]);

  useEffect(() => {
    if (isOpen && clientToEdit && personal.data !== undefined) {
      setForm(clientFormOf(clientToEdit, personal.data));
    }
  }, [isOpen, clientToEdit, personal.data]);

  const set = (field: keyof ClientForm) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || loadingPersonal) return;
    setError(null);
    try {
      if (clientToEdit) {
        const payload = toUpdateClientPayload({
          workspaceId: activeWorkspace.id,
          client: clientToEdit,
          personal: personal.data ?? null,
          form,
        });
        await updateMutation.mutateAsync({ payload, idempotencyKey: keyFor('updateClient', payload) });
        onDone('Cliente atualizado.');
      } else {
        const payload = toCreateClientPayload(activeWorkspace.id, form);
        await createMutation.mutateAsync({ payload, idempotencyKey: keyFor('createClient', payload) });
        onDone('Cliente cadastrado.');
      }
    } catch (failure) {
      setError(clientsErrorView(failure).message);
    }
  };

  return (
    <ClientsDialog
      open={isOpen}
      title={editing ? 'Editar Cliente' : 'Novo Cliente'}
      icon={<UsersIcon className="w-5 h-5 text-primary" />}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={styles.cancel}>
            Cancelar
          </button>
          <button type="submit" form={`${id}-form`} disabled={busy || loadingPersonal} aria-busy={busy} className={styles.submit}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      )}
    >
      <form id={`${id}-form`} onSubmit={handleSubmit} className="space-y-4" noValidate>
        {personal.isError && (
          <ClientsFormError message="Não foi possível carregar os dados do cliente. Feche e tente novamente." />
        )}
        <div>
          <label htmlFor={`${id}-name`} className={styles.label}>Nome <span className="text-error">*</span></label>
          <input
            id={`${id}-name`}
            type="text"
            value={form.name}
            onChange={set('name')}
            maxLength={CLIENT_TEXT_LIMITS.name}
            className={styles.input}
            required
            aria-required="true"
          />
        </div>
        <div>
          <label htmlFor={`${id}-email`} className={styles.label}>E-mail</label>
          <input
            id={`${id}-email`}
            type="email"
            value={form.email}
            onChange={set('email')}
            maxLength={CLIENT_TEXT_LIMITS.email}
            disabled={loadingPersonal}
            className={styles.input}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${id}-phone`} className={styles.label}>Telefone</label>
            <input
              id={`${id}-phone`}
              type="text"
              value={form.phone}
              onChange={set('phone')}
              maxLength={CLIENT_TEXT_LIMITS.phone}
              disabled={loadingPersonal}
              className={styles.input}
            />
          </div>
          <div>
            <label htmlFor={`${id}-document`} className={styles.label}>CPF/CNPJ</label>
            <input
              id={`${id}-document`}
              type="text"
              value={form.document}
              onChange={set('document')}
              maxLength={CLIENT_TEXT_LIMITS.document}
              disabled={loadingPersonal}
              className={styles.input}
            />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-notes`} className={styles.label}>Observações</label>
          <textarea
            id={`${id}-notes`}
            value={form.notes}
            onChange={set('notes')}
            maxLength={CLIENT_TEXT_LIMITS.notes}
            disabled={loadingPersonal}
            className={styles.input}
            rows={3}
          />
        </div>
        <ClientsFormError message={error} />
      </form>
    </ClientsDialog>
  );
};

export default ClientFormModal;
