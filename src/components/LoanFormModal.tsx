import React, { useEffect, useId, useState } from 'react';

import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useCreateLoan, useLoanIntentKey } from '../modules/loans/hooks.ts';
import { LOAN_MAX_INSTALLMENTS, formatCents, parseBrlToCents, saoPauloToday } from '../modules/loans/money.ts';
import {
  LOAN_TEXT_LIMITS,
  emptyLoanCreateForm,
  toCreateLoanPayload,
  type LoanCreateForm,
} from '../modules/loans/payloads.ts';
import { loanErrorView } from '../modules/loans/presentation.ts';
import { CoinsIcon, UsersIcon } from './Icons.tsx';
import CashAccountSelect from './accounts/CashAccountSelect.tsx';
import LoanDialog, { LoanFormError, LoanMoneyInput, loanDialogStyles } from './loans/LoanDialog.tsx';
import {
  AMORTIZATION_OPTIONS,
  LoanNatureToggle,
  amortizationLabel,
  useInstallmentSplit,
} from './loans/LoanTermsFields.tsx';

/**
 * Novo empréstimo PF pela callable `createLoan` (P3-H). O backend grava
 * contrato, fato inicial, espelho de caixa e auditoria no mesmo commit; o
 * frontend só envia os termos digitados (centavos, taxa inteira, datas).
 * Layout e classes do formulário anterior; mudam só os campos que o
 * contrato autoritativo exige (primeiro vencimento, taxa e amortização) e
 * os que deixaram de existir (quitação prevista e forma de pagamento, hoje
 * derivados ou fora do contrato).
 */
interface LoanFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (loanId: string) => void;
}

const styles = loanDialogStyles('pf-form');

const LoanFormModal: React.FC<LoanFormModalProps> = ({ isOpen, onClose, onCreated }) => {
  const { activeWorkspace } = useWorkspace();
  const mutation = useCreateLoan();
  const intent = useLoanIntentKey();
  const id = useId();
  const [form, setForm] = useState<LoanCreateForm>(() => emptyLoanCreateForm('lend', saoPauloToday()));
  const [error, setError] = useState<string | null>(null);
  // Cada abertura é uma sessão nova: os campos remontam com o formulário limpo.
  const [session, setSession] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    intent.reset();
    setError(null);
    setForm(emptyLoanCreateForm('lend', saoPauloToday()));
    setSession((current) => current + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const patch = (next: Partial<LoanCreateForm>) => setForm((current) => ({ ...current, ...next }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const payload = toCreateLoanPayload(form, {
        workspaceId: activeWorkspace.id, profileType: 'PF', today: saoPauloToday(),
      });
      const result = await mutation.mutateAsync({
        payload, idempotencyKey: intent.keyFor('createLoan', payload),
      });
      onCreated(result.loanId);
      onClose();
    } catch (failure) {
      setError(loanErrorView(failure).message);
    }
  };

  const busy = mutation.isPending;
  return (
    <LoanDialog
      open={isOpen}
      title="Novo Empréstimo"
      variant="pf-form"
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={styles.secondary}>Cancelar</button>
          <button type="submit" form={`${id}-form`} disabled={busy} aria-busy={busy} className={styles.primary}>
            {busy ? 'Salvando…' : 'Salvar Empréstimo'}
          </button>
        </>
      )}
    >
      <PfLoanFields key={session} id={id} form={form} patch={patch} onSubmit={submit} error={error} />
    </LoanDialog>
  );
};

const PfLoanFields: React.FC<{
  id: string;
  form: LoanCreateForm;
  patch: (next: Partial<LoanCreateForm>) => void;
  onSubmit: (event: React.FormEvent) => void;
  error: string | null;
}> = ({ id, form, patch, onSubmit, error }) => {
  const { split, toggle } = useInstallmentSplit(form, patch);
  const today = saoPauloToday();
  const principalCents = parseBrlToCents(form.principal);
  return (
    <form id={`${id}-form`} onSubmit={onSubmit} className={styles.stack} noValidate>
      <LoanNatureToggle profileType="PF" name={`${id}-type`} value={form.type} onChange={(type) => patch({ type })} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="md:col-span-2">
          <label htmlFor={`${id}-name`} className={styles.label}>Pessoa Envolvida <span className="text-error">*</span></label>
          <div className="relative">
            <input id={`${id}-name`} type="text" value={form.personName} maxLength={LOAN_TEXT_LIMITS.personName}
              onChange={(event) => patch({ personName: event.target.value })} className={`${styles.input} pl-10`}
              placeholder="Nome completo" required />
            <UsersIcon className="absolute left-3.5 top-2.5 w-4 h-4 text-muted" />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-contact`} className={styles.label}>Contato (Opcional)</label>
          <input id={`${id}-contact`} type="text" value={form.personContact} maxLength={LOAN_TEXT_LIMITS.personContact}
            onChange={(event) => patch({ personContact: event.target.value })} className={styles.input}
            placeholder="Telefone ou e-mail" />
        </div>
        <div>
          <label htmlFor={`${id}-description`} className={styles.label}>Descrição curta</label>
          <input id={`${id}-description`} type="text" value={form.description} maxLength={LOAN_TEXT_LIMITS.description}
            onChange={(event) => patch({ description: event.target.value })} className={styles.input}
            placeholder="Ex: Reforma casa, Investimento..." />
        </div>
        <div>
          <label htmlFor={`${id}-principal`} className={styles.label}>Valor Principal <span className="text-error">*</span></label>
          <LoanMoneyInput id={`${id}-principal`} value={form.principal} inputClass={styles.input} className="font-bold text-lg"
            onChange={(event) => patch({ principal: event.target.value })} required />
        </div>
        <div>
          <label htmlFor={`${id}-start`} className={styles.label}>Data de Início</label>
          <input id={`${id}-start`} type="date" max={today} value={form.startDate}
            onChange={(event) => patch({ startDate: event.target.value })} className={styles.input} required />
        </div>
        <div>
          <label htmlFor={`${id}-first-due`} className={styles.label}>Primeiro Vencimento</label>
          <input id={`${id}-first-due`} type="date" min={form.startDate || undefined} value={form.firstDueDate}
            onChange={(event) => patch({ firstDueDate: event.target.value })} className={styles.input} required />
        </div>
        {/* Conta/carteira do principal (D-30, P3-J). */}
        <CashAccountSelect
          id={`${id}-account`}
          label={form.type === 'lend' ? 'Conta/carteira de saída' : 'Conta/carteira de entrada'}
          value={form.cashAccountId}
          onChange={(cashAccountId) => patch({ cashAccountId })}
          autoSelect
          labelClassName={styles.label}
          selectClassName={styles.input}
        />
      </div>

      <div className="bg-background p-5 rounded-2xl border border-border space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <CoinsIcon className="w-4 h-4 text-primary" />
          <h4 className="text-xs font-bold text-on-surface uppercase tracking-widest">Juros e Parcelamento</h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${id}-interest-type`} className={styles.label}>Tipo de Juros</label>
            <select id={`${id}-interest-type`} value={form.interestType}
              onChange={(event) => patch({ interestType: event.target.value as LoanCreateForm['interestType'] })}
              className={styles.input}>
              <option value="none">Sem Juros</option>
              <option value="percentage">Percentual (%)</option>
              <option value="fixed">Valor Fixo (Total)</option>
            </select>
          </div>
          {form.interestType === 'percentage' && (
            <div className="animate-fade-in">
              <label htmlFor={`${id}-rate`} className={styles.label}>Percentual (%) <span className="text-error">*</span></label>
              <input id={`${id}-rate`} type="text" inputMode="decimal" autoComplete="off" value={form.rate}
                onChange={(event) => patch({ rate: event.target.value })} className={styles.input} placeholder="0,00" required />
            </div>
          )}
          {form.interestType === 'fixed' && (
            <div className="animate-fade-in">
              <label htmlFor={`${id}-fixed`} className={styles.label}>Valor Total (R$) <span className="text-error">*</span></label>
              <input id={`${id}-fixed`} type="text" inputMode="decimal" autoComplete="off" value={form.fixedInterest}
                onChange={(event) => patch({ fixedInterest: event.target.value })} className={styles.input} placeholder="0,00" required />
            </div>
          )}
          {form.interestType === 'percentage' && (
            <>
              <div className="animate-fade-in">
                <label htmlFor={`${id}-period`} className={styles.label}>Período da Taxa</label>
                <select id={`${id}-period`} value={form.ratePeriod}
                  onChange={(event) => patch({ ratePeriod: event.target.value as LoanCreateForm['ratePeriod'] })}
                  className={styles.input}>
                  <option value="monthly">Ao Mês</option>
                  <option value="annual">Ao Ano</option>
                </select>
              </div>
              <div className="animate-fade-in">
                <label htmlFor={`${id}-amortization`} className={styles.label}>Amortização <span className="text-error">*</span></label>
                <select id={`${id}-amortization`} value={form.amortization}
                  onChange={(event) => patch({ amortization: event.target.value as LoanCreateForm['amortization'] })}
                  className={styles.input} required>
                  <option value="">Escolha</option>
                  {AMORTIZATION_OPTIONS.map((value) => (
                    <option key={value} value={value}>{amortizationLabel(value)}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <input id={`${id}-split`} type="checkbox" checked={split} onChange={(event) => toggle(event.target.checked)}
            className="w-5 h-5 text-primary border-border rounded" />
          <label htmlFor={`${id}-split`} className="text-sm font-bold text-on-surface cursor-pointer">Dividir em Parcelas Mensais</label>
        </div>

        {split && (
          <div className="grid grid-cols-2 gap-4 animate-fade-in">
            <div>
              <label htmlFor={`${id}-installments`} className={styles.label}>Número de Parcelas</label>
              <input id={`${id}-installments`} type="number" min={2} max={LOAN_MAX_INSTALLMENTS} step={1}
                value={form.installments} onChange={(event) => patch({ installments: event.target.value })}
                className={styles.input} />
            </div>
            <div className="flex items-end">
              <p className="text-[10px] text-muted italic">O cronograma (principal, juros e total de cada parcela) é calculado ao salvar, com vencimento mensal a partir do primeiro vencimento.</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-indigo-50 dark:bg-indigo-900/10 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
        <p className="text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
          <strong>Nota de Fluxo:</strong> Ao salvar, o principal{principalCents === null ? '' : ` de ${formatCents(principalCents)}`} é registrado automaticamente como {form.type === 'lend' ? 'saída' : 'entrada'} no caixa na data de início, para refletir o {form.type === 'lend' ? 'dinheiro saindo da sua conta' : 'dinheiro entrando na sua conta'}. Não é receita nem despesa: só os juros contam como resultado financeiro.
        </p>
      </div>

      <LoanFormError message={error} />
    </form>
  );
};

export default LoanFormModal;
