import React, { useEffect, useId, useState } from 'react';

import { useWorkspace } from '../../contexts/WorkspaceContext.tsx';
import { useLoanIntentKey, useUpdateLoanMetadata } from '../../modules/loans/hooks.ts';
import {
  LOAN_TEXT_LIMITS,
  metadataFormOf,
  toMetadataPayload,
  type LoanMetadataForm,
} from '../../modules/loans/payloads.ts';
import {
  CLASSIFICATION_LABELS,
  COUNTERPARTY_LABELS,
  loanErrorView,
} from '../../modules/loans/presentation.ts';
import {
  PJ_COUNTERPARTY_TYPES,
  PJ_LOAN_CLASSIFICATIONS,
  type Loan,
} from '../../modules/loans/types.ts';
import LoanDialog, { LoanFormError, actionVariantOf, loanDialogStyles } from './LoanDialog.tsx';

/**
 * Edição dos dados não financeiros pela callable `updateLoanMetadata` (P3-H):
 * contraparte, contato, descrição e, em PJ, tipo da contraparte, CNPJ/CPF,
 * classificação e centro de custo. Principal, natureza, juros, cronograma,
 * saldo, acumulados e status não são editáveis — nem aparecem aqui.
 */
interface LoanMetadataModalProps {
  open: boolean;
  loan: Loan;
  onClose: () => void;
  onDone: () => void;
}

const LoanMetadataModal: React.FC<LoanMetadataModalProps> = ({ open, loan, onClose, onDone }) => {
  const { activeWorkspace } = useWorkspace();
  const mutation = useUpdateLoanMetadata();
  const intent = useLoanIntentKey();
  const id = useId();
  const [form, setForm] = useState<LoanMetadataForm>(metadataFormOf(loan));
  const [error, setError] = useState<string | null>(null);
  const isPJ = loan.profileType === 'PJ';

  useEffect(() => {
    if (!open) return;
    intent.reset();
    setError(null);
    setForm(metadataFormOf(loan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (next: Partial<LoanMetadataForm>) => setForm((current) => ({ ...current, ...next }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const payload = toMetadataPayload(form, { workspaceId: activeWorkspace.id, loan });
      await mutation.mutateAsync({ payload, idempotencyKey: intent.keyFor('updateLoanMetadata', payload) });
      onDone();
    } catch (failure) {
      setError(loanErrorView(failure).message);
    }
  };

  const busy = mutation.isPending;
  const variant = actionVariantOf(loan.profileType);
  const styles = loanDialogStyles(variant);
  return (
    <LoanDialog
      open={open}
      title={isPJ ? 'Editar Dados da Operação' : 'Editar Dados do Empréstimo'}
      variant={variant}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={styles.secondary}>Cancelar</button>
          <button type="submit" form={`${id}-form`} disabled={busy} aria-busy={busy} className={styles.primary}>
            {busy ? 'Salvando…' : 'Salvar Dados'}
          </button>
        </>
      )}
    >
      <form id={`${id}-form`} onSubmit={submit} className={styles.stack} noValidate>
        <p className="text-xs text-muted">
          Valores, juros, cronograma e saldo não mudam por aqui. Para corrigir um pagamento, estorne-o;
          para desfazer a contratação, cancele o empréstimo.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-name`} className={styles.label}>
              {isPJ ? 'Nome / Razão Social' : 'Pessoa Envolvida'} <span className="text-error">*</span>
            </label>
            <input id={`${id}-name`} type="text" value={form.personName} maxLength={LOAN_TEXT_LIMITS.personName}
              onChange={(event) => patch({ personName: event.target.value })} className={styles.input} required />
          </div>
          <div>
            <label htmlFor={`${id}-contact`} className={styles.label}>{isPJ ? 'Contato / Telefone' : 'Contato (Opcional)'}</label>
            <input id={`${id}-contact`} type="text" value={form.personContact} maxLength={LOAN_TEXT_LIMITS.personContact}
              onChange={(event) => patch({ personContact: event.target.value })} className={styles.input} />
          </div>
          <div>
            <label htmlFor={`${id}-description`} className={styles.label}>{isPJ ? 'Finalidade da Operação' : 'Descrição curta'}</label>
            <input id={`${id}-description`} type="text" value={form.description} maxLength={LOAN_TEXT_LIMITS.description}
              onChange={(event) => patch({ description: event.target.value })} className={styles.input} />
          </div>
          {isPJ && (
            <>
              <div>
                <label htmlFor={`${id}-counterparty`} className={styles.label}>Tipo de Contraparte</label>
                <select id={`${id}-counterparty`} value={form.counterpartyType ?? ''}
                  onChange={(event) => patch({ counterpartyType: event.target.value as LoanMetadataForm['counterpartyType'] })}
                  className={styles.input}>
                  <option value="">Não informado</option>
                  {PJ_COUNTERPARTY_TYPES.map((value) => (
                    <option key={value} value={value}>{COUNTERPARTY_LABELS[value]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-document`} className={styles.label}>CNPJ / CPF</label>
                <input id={`${id}-document`} type="text" inputMode="numeric" value={form.cnpjCpf ?? ''}
                  onChange={(event) => patch({ cnpjCpf: event.target.value })} className={styles.input}
                  placeholder="00.000.000/0000-00" />
              </div>
              <div>
                <label htmlFor={`${id}-classification`} className={styles.label}>Classificação Contábil</label>
                <select id={`${id}-classification`} value={form.classification ?? ''}
                  onChange={(event) => patch({ classification: event.target.value as LoanMetadataForm['classification'] })}
                  className={styles.input}>
                  <option value="">Não classificado</option>
                  {PJ_LOAN_CLASSIFICATIONS.map((value) => (
                    <option key={value} value={value}>{CLASSIFICATION_LABELS[value]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-cost-center`} className={styles.label}>Centro de Custo</label>
                <input id={`${id}-cost-center`} type="text" value={form.costCenter ?? ''} maxLength={LOAN_TEXT_LIMITS.costCenter}
                  onChange={(event) => patch({ costCenter: event.target.value })} className={styles.input} />
              </div>
            </>
          )}
        </div>
        <LoanFormError message={error} />
      </form>
    </LoanDialog>
  );
};

export default LoanMetadataModal;
