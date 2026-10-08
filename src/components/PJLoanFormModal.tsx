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
import {
  CLASSIFICATION_LABELS,
  COUNTERPARTY_LABELS,
  loanErrorView,
} from '../modules/loans/presentation.ts';
import { PJ_COUNTERPARTY_TYPES, PJ_LOAN_CLASSIFICATIONS } from '../modules/loans/types.ts';
import { BriefcaseIcon, BuildingIcon, CoinsIcon, DynamicIcon, UsersIcon } from './Icons.tsx';
import CashAccountSelect from './accounts/CashAccountSelect.tsx';
import LoanDialog, { LoanFormError, LoanMoneyInput, loanDialogStyles } from './loans/LoanDialog.tsx';
import {
  AMORTIZATION_OPTIONS,
  LoanNatureToggle,
  amortizationLabel,
  useInstallmentSplit,
} from './loans/LoanTermsFields.tsx';

/**
 * Nova operação de empréstimo PJ pela callable `createLoan` (P3-H). Mesmo
 * motor do PF; os campos gerenciais (tipo de contraparte, CNPJ/CPF,
 * classificação, centro de custo) são exclusivos de PJ e validados pelo
 * backend contra o tipo do espaço persistido. Layout e classes do registro
 * anterior; mudam só os campos exigidos pelo contrato autoritativo.
 */
interface PJLoanFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (loanId: string) => void;
}

const styles = loanDialogStyles('pj-form');

const initialForm = (): LoanCreateForm => ({
  ...emptyLoanCreateForm('borrow', saoPauloToday()),
  classification: 'dividas_financeiras',
  counterpartyType: 'banco',
});

const PJLoanFormModal: React.FC<PJLoanFormModalProps> = ({ isOpen, onClose, onCreated }) => {
  const { activeWorkspace } = useWorkspace();
  const mutation = useCreateLoan();
  const intent = useLoanIntentKey();
  const id = useId();
  const [form, setForm] = useState<LoanCreateForm>(initialForm);
  const [error, setError] = useState<string | null>(null);
  // Cada abertura é uma sessão nova: os campos remontam com o formulário limpo.
  const [session, setSession] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    intent.reset();
    setError(null);
    setForm(initialForm());
    setSession((current) => current + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const patch = (next: Partial<LoanCreateForm>) => setForm((current) => ({ ...current, ...next }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const payload = toCreateLoanPayload(form, {
        workspaceId: activeWorkspace.id, profileType: 'PJ', today: saoPauloToday(),
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
      title="Registro de Operação Financeira"
      subtitle={`Perfil Empresarial: ${activeWorkspace.name}`}
      variant="pj-form"
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={styles.secondary}>Cancelar</button>
          <button type="submit" form={`${id}-form`} disabled={busy} aria-busy={busy} className={styles.primary}>
            {busy ? 'Salvando…' : 'Salvar Registro'}
          </button>
        </>
      )}
    >
      <PjLoanFields key={session} id={id} form={form} patch={patch} onSubmit={submit} error={error} />
    </LoanDialog>
  );
};

const PjLoanFields: React.FC<{
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
      <div className="flex flex-col sm:flex-row gap-6">
        <div className="flex-1">
          <span id={`${id}-type-label`} className={styles.label}>Tipo de Operação <span className="text-error">*</span></span>
          <LoanNatureToggle profileType="PJ" name={`${id}-type`} labelledBy={`${id}-type-label`} value={form.type}
            onChange={(type) => patch({ type })} />
        </div>
        <div className="flex-1">
          <label htmlFor={`${id}-classification`} className={styles.label}>Classificação Contábil</label>
          <select id={`${id}-classification`} value={form.classification ?? ''}
            onChange={(event) => patch({ classification: event.target.value as LoanCreateForm['classification'] })}
            className={styles.input}>
            {PJ_LOAN_CLASSIFICATIONS.map((value) => (
              <option key={value} value={value}>{CLASSIFICATION_LABELS[value]}</option>
            ))}
            <option value="">Não classificado</option>
          </select>
        </div>
      </div>

      <div role="group" aria-labelledby={`${id}-counterparty-title`} className="bg-background/40 p-6 rounded-2xl border border-border space-y-5">
        <div id={`${id}-counterparty-title`} className="flex items-center gap-2 text-xs font-black text-primary uppercase tracking-widest border-b border-border pb-2 mb-1">
          <BuildingIcon className="w-4 h-4" /> Dados da Contraparte
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label htmlFor={`${id}-name`} className={styles.label}>Nome / Razão Social <span className="text-error">*</span></label>
            <div className="relative">
              <input id={`${id}-name`} type="text" value={form.personName} maxLength={LOAN_TEXT_LIMITS.personName}
                onChange={(event) => patch({ personName: event.target.value })} className={`${styles.input} pl-10`}
                placeholder="Ex: Banco Itaú, João Silva..." required />
              <UsersIcon className="absolute left-3.5 top-2.5 w-4 h-4 text-muted" />
            </div>
          </div>
          <div>
            <label htmlFor={`${id}-counterparty`} className={styles.label}>Tipo de Contraparte</label>
            <select id={`${id}-counterparty`} value={form.counterpartyType ?? ''}
              onChange={(event) => patch({ counterpartyType: event.target.value as LoanCreateForm['counterpartyType'] })}
              className={styles.input}>
              {PJ_COUNTERPARTY_TYPES.map((value) => (
                <option key={value} value={value}>{COUNTERPARTY_LABELS[value]}</option>
              ))}
              <option value="">Não informado</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-document`} className={styles.label}>CNPJ / CPF</label>
            <input id={`${id}-document`} type="text" inputMode="numeric" value={form.cnpjCpf ?? ''}
              onChange={(event) => patch({ cnpjCpf: event.target.value })} className={styles.input}
              placeholder="00.000.000/0000-00" />
          </div>
          <div>
            <label htmlFor={`${id}-contact`} className={styles.label}>Contato / Telefone</label>
            <input id={`${id}-contact`} type="text" value={form.personContact} maxLength={LOAN_TEXT_LIMITS.personContact}
              onChange={(event) => patch({ personContact: event.target.value })} className={styles.input}
              placeholder="E-mail ou celular" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <label htmlFor={`${id}-description`} className={styles.label}>Finalidade da Operação</label>
          <input id={`${id}-description`} type="text" value={form.description} maxLength={LOAN_TEXT_LIMITS.description}
            onChange={(event) => patch({ description: event.target.value })} className={styles.input}
            placeholder="Ex: Investimento em maquinário, Adiantamento PLR..." />
        </div>
        <div>
          <label htmlFor={`${id}-cost-center`} className={styles.label}>Centro de Custo</label>
          <div className="relative">
            <input id={`${id}-cost-center`} type="text" value={form.costCenter ?? ''} maxLength={LOAN_TEXT_LIMITS.costCenter}
              onChange={(event) => patch({ costCenter: event.target.value })} className={`${styles.input} pl-10`}
              placeholder="Ex: Operacional, RH..." />
            <BriefcaseIcon className="absolute left-3.5 top-2.5 w-4 h-4 text-muted" />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-principal`} className={styles.label}>Valor Principal <span className="text-error">*</span></label>
          <LoanMoneyInput id={`${id}-principal`} value={form.principal} inputClass={styles.input} className="font-black text-base"
            prefixClass="absolute left-3.5 top-2.5 text-muted font-bold text-xs"
            onChange={(event) => patch({ principal: event.target.value })} required />
        </div>
        <div>
          <label htmlFor={`${id}-start`} className={styles.label}>Data de Contratação</label>
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

      <div className="bg-indigo-50/50 dark:bg-indigo-950/10 p-6 rounded-2xl border border-indigo-100 dark:border-indigo-900/30 space-y-6">
        <div className="flex items-center gap-2 text-xs font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest border-b border-indigo-100 dark:border-indigo-900/30 pb-2">
          <CoinsIcon className="w-4 h-4" /> Condições Financeiras
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <label htmlFor={`${id}-interest-type`} className={styles.label}>Tipo de Juros</label>
            <select id={`${id}-interest-type`} value={form.interestType}
              onChange={(event) => patch({ interestType: event.target.value as LoanCreateForm['interestType'] })}
              className={styles.input}>
              <option value="none">Isento / Sem Juros</option>
              <option value="percentage">Percentual (%)</option>
              <option value="fixed">Valor Fixo Total</option>
            </select>
          </div>
          {form.interestType === 'percentage' && (
            <>
              <div>
                <label htmlFor={`${id}-period`} className={styles.label}>Base de Cálculo</label>
                <select id={`${id}-period`} value={form.ratePeriod}
                  onChange={(event) => patch({ ratePeriod: event.target.value as LoanCreateForm['ratePeriod'] })}
                  className={styles.input}>
                  <option value="monthly">Ao Mês (% a.m.)</option>
                  <option value="annual">Ao Ano (% a.a.)</option>
                </select>
              </div>
              <div className="animate-fade-in">
                <label htmlFor={`${id}-rate`} className={styles.label}>Taxa (%) <span className="text-error">*</span></label>
                <input id={`${id}-rate`} type="text" inputMode="decimal" autoComplete="off" value={form.rate}
                  onChange={(event) => patch({ rate: event.target.value })} className={styles.input} placeholder="0,000" required />
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
          {form.interestType === 'fixed' && (
            <div className="animate-fade-in">
              <label htmlFor={`${id}-fixed`} className={styles.label}>Valor Fixo Total (R$) <span className="text-error">*</span></label>
              <input id={`${id}-fixed`} type="text" inputMode="decimal" autoComplete="off" value={form.fixedInterest}
                onChange={(event) => patch({ fixedInterest: event.target.value })} className={styles.input} placeholder="0,00" required />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 py-2 border-t border-indigo-100 dark:border-indigo-900/30">
          <input id={`${id}-split`} type="checkbox" checked={split} onChange={(event) => toggle(event.target.checked)}
            className="w-5 h-5 text-primary border-border rounded focus:ring-primary" />
          <label htmlFor={`${id}-split`} className="text-sm font-black text-on-surface cursor-pointer select-none">Amortização em Parcelas Periódicas</label>
        </div>

        {split && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 animate-fade-in">
            <div>
              <label htmlFor={`${id}-installments`} className={styles.label}>Quantidade de Parcelas</label>
              <input id={`${id}-installments`} type="number" min={2} max={LOAN_MAX_INSTALLMENTS} step={1}
                value={form.installments} onChange={(event) => patch({ installments: event.target.value })}
                className={styles.input} />
            </div>
            <div className="bg-white/50 dark:bg-dark-100/50 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
              <p className="text-[10px] text-muted leading-relaxed">
                <strong>Nota Corporativa:</strong> O cronograma (principal, juros e total de cada parcela) é calculado ao salvar, pelo sistema de amortização escolhido, com vencimentos mensais a partir do primeiro vencimento.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-blue-50/50 dark:bg-blue-950/10 p-4 rounded-xl border border-blue-100 dark:border-blue-900/30 flex items-start gap-3">
        <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded flex-shrink-0">
          <DynamicIcon name="InfoCircle" size={14} />
        </div>
        <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
          <strong>Impacto no Caixa:</strong> Uma {form.type === 'borrow' ? 'entrada' : 'saída'}{principalCents === null ? ' do principal' : ` de ${formatCents(principalCents)}`} será registrada na data de contratação. O principal não é receita nem despesa: só os juros contam como resultado financeiro.
        </p>
      </div>

      <LoanFormError message={error} />
    </form>
  );
};

export default PJLoanFormModal;
