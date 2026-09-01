import React, { useEffect, useMemo, useState } from 'react';

import type { Goal } from '../../../../types';
import { useSettingsCatalogGroup } from '../../../settings-catalog/hooks';
import { useFinancialIntent } from '../../hooks/useIntentNonce';
import { simpleInvestmentError } from '../../errors';
import { useSimpleInvestmentMutation } from '../api';
import {
  buildCreateSimpleInvestmentInput,
  emptyNewInvestmentForm,
  formatCentsInput,
  maskCurrencyInput,
  validateNewInvestment,
  type NewInvestmentFormState,
  type SimpleFormErrors,
} from '../form';
import {
  CurrencyField,
  DateField,
  ErrorBanner,
  SelectField,
  SimpleModal,
  YesNoField,
  labelClasses,
  inputClasses,
  submitClasses,
  Required,
  FieldError,
  type SelectOption,
} from './shell';

/**
 * "Novo investimento" (Etapa 2, §4).
 *
 * Modal próprio, e não a aba de investimento do `TransactionModal`. O
 * `TransactionModal` do baseline gravava direto em `transactions`, e a versão
 * atual removeu o tipo de propósito — reabri-lo ali significaria ou ressuscitar
 * a escrita antiga, ou fazer um único componente de quatro tipos falar com dois
 * domínios diferentes no submit. O visual é o do baseline; o destino é
 * exclusivamente `createSimpleInvestment`.
 *
 * O que **não** existe neste formulário, por contrato: quantidade, preço
 * unitário, preço médio, tipo técnico de ativo, conta, posição, regime de
 * acompanhamento. O backend deriva tudo a partir de carteira, instituição e
 * categoria.
 */

/**
 * Aporte pendente em correção, com os valores da intenção original.
 *
 * Os identificadores vêm da fotografia gravada no movimento — o formulário
 * reabre exatamente o que foi escolhido antes, sem nenhuma leitura extra e sem
 * depender do rótulo, que pode ter sido renomeado no catálogo desde então.
 */
export interface EditingInvestment {
  movementId: string;
  description: string;
  classId?: string;
  institutionId?: string;
  typeId?: string;
  valueCents: number;
  goalId?: string;
  occurredAt: Date | null;
}

export interface NewInvestmentModalProps {
  open: boolean;
  workspaceId: string;
  goals: Goal[];
  /** Meta pré-selecionada quando o modal é aberto a partir de uma meta (§13). */
  initialGoalId?: string | null;
  /**
   * A meta não pode ser trocada dentro deste formulário (Etapa 3, §2.A).
   *
   * Vale quando o aporte nasce de dentro de uma meta: ali a pessoa já declarou
   * o destino, e um seletor aberto no meio do formulário só serve para um
   * aporte cair na meta errada por engano. Fora desse fluxo o campo continua
   * livre, e a troca de meta de um investimento existente tem operação
   * própria, com confirmação.
   */
  goalLocked?: boolean;
  /**
   * Aporte pendente que está sendo corrigido (§11).
   *
   * Editar um pendente é cancelar a intenção anterior e abrir outra: o
   * histórico guarda as duas, e nenhum fato financeiro é apagado — um pendente
   * tem todos os deltas em zero.
   */
  editing?: EditingInvestment | null;
  onClose(): void;
  onSuccess(message: string): void;
}

const goalOptions = (goals: Goal[]): SelectOption[] => goals
  .filter((goal) => goal.status === 'em_andamento')
  .map((goal) => ({
    value: goal.id,
    label: `${goal.visual?.emoji ? `${goal.visual.emoji} ` : ''}${goal.name}`,
  }));

const NewInvestmentModal: React.FC<NewInvestmentModalProps> = ({
  open, workspaceId, goals, initialGoalId, goalLocked = false, editing, onClose, onSuccess,
}) => {
  const [form, setForm] = useState<NewInvestmentFormState>(
    () => emptyNewInvestmentForm(new Date(), initialGoalId ?? ''),
  );
  const [errors, setErrors] = useState<SimpleFormErrors>({});
  const [failure, setFailure] = useState<string>();

  const intent = useFinancialIntent(
    open ? `simple-investment:${editing?.movementId ?? 'new'}` : null,
  );
  const mutation = useSimpleInvestmentMutation(workspaceId);

  const portfolios = useSettingsCatalogGroup('investment_class');
  const institutions = useSettingsCatalogGroup('investment_institution');
  const categories = useSettingsCatalogGroup('investment_type');

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setForm(editing
      ? {
        ...emptyNewInvestmentForm(editing.occurredAt ?? now, editing.goalId ?? ''),
        classId: editing.classId ?? '',
        institutionId: editing.institutionId ?? '',
        typeId: editing.typeId ?? '',
        description: editing.description,
        amount: formatCentsInput(editing.valueCents),
        // O que está em edição é um aporte **pendente**: se já estivesse
        // depositado, editar não seria cancelar e refazer.
        deposited: false,
      }
      : emptyNewInvestmentForm(now, initialGoalId ?? ''));
    setErrors({});
    setFailure(undefined);
  }, [open, initialGoalId, editing]);

  const toOptions = (items?: { id: string; name: string }[]): SelectOption[] =>
    (items ?? []).map((item) => ({ value: item.id, label: item.name }));

  const patch = (values: Partial<NewInvestmentFormState>) =>
    setForm((current) => ({ ...current, ...values }));

  const catalogLoading =
    portfolios.isLoading || institutions.isLoading || categories.isLoading;

  const submitting = mutation.isPending;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const found = validateNewInvestment(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setFailure(undefined);
    /*
     * O instante da intenção é o congelado, nunca `new Date()`.
     *
     * `dateInputToInstant` devolve o agora quando o dia escolhido é hoje e o
     * meio-dia local ainda não chegou. Com um relógio novo por tentativa, o
     * reenvio da **mesma** intenção viajaria com outro `occurredAt`, que entra
     * no `requestHash` do backend: a chave de idempotência seria a mesma e o
     * corpo não, e o retry de uma resposta perdida voltaria como
     * `idempotency_conflict` em vez de repetir o resultado anterior.
     */
    const payload = buildCreateSimpleInvestmentInput(form, new Date(intent.occurredAt()));
    try {
      /*
       * Cancelar primeiro, criar depois. A ordem inversa deixaria duas
       * intenções pendentes vivas se o cancelamento falhasse — duplicidade
       * financeira aparente. Nesta ordem, uma falha na criação deixa o pendente
       * anterior cancelado e o usuário vê o erro com o formulário ainda aberto.
       */
      if (editing) {
        await mutation.mutateAsync({
          name: 'cancelInvestmentMovement',
          nonce: `${intent.nonce}-cancel`,
          payload: {
            movementId: editing.movementId,
            occurredAt: intent.occurredAt(),
            reason: 'Correção do investimento pendente pelo usuário.',
          },
        });
      }
      await mutation.mutateAsync({
        name: 'createSimpleInvestment',
        nonce: intent.nonce,
        payload: payload as unknown as Record<string, unknown>,
      });
      onSuccess(
        payload.settled
          ? 'Investimento registrado como depositado.'
          : 'Investimento registrado como pendente.',
      );
      onClose();
    } catch (error) {
      setFailure(simpleInvestmentError(error));
    }
  };

  const availableGoals = useMemo(() => goalOptions(goals), [goals]);
  /*
   * Rótulo da meta travada. Sai da lista completa, e não só das metas em
   * andamento: quem abriu o formulário de dentro de uma meta pausada tem
   * direito de ver o nome dela, mesmo que ela não apareça no seletor livre.
   */
  const lockedGoalLabel = goalLocked && initialGoalId
    ? goals.find((goal) => goal.id === initialGoalId)?.name ?? 'Meta selecionada'
    : null;

  return (
    <SimpleModal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={editing ? 'Editar investimento' : 'Novo investimento'}
    >
      <ErrorBanner message={failure} />
      {catalogLoading && (
        <p className="mb-4 text-xs font-medium text-indigo-600 dark:text-indigo-300">
          Atualizando cadastros do workspace...
        </p>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-4">
          <div className="bg-indigo-50 dark:bg-indigo-900/20 p-3 rounded-lg border border-indigo-100 dark:border-indigo-800">
            <label htmlFor="simple-goal" className={`${labelClasses} font-bold text-indigo-700 dark:text-indigo-300`}>
              {lockedGoalLabel ? 'Meta' : 'Meta (opcional)'}
            </label>
            <select
              id="simple-goal"
              value={form.goalId}
              disabled={Boolean(lockedGoalLabel)}
              onChange={(event) => patch({ goalId: event.target.value })}
              className="w-full border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-dark-100 text-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-80"
            >
              {lockedGoalLabel ? (
                <option value={initialGoalId ?? ''}>{lockedGoalLabel}</option>
              ) : (
                <>
                  <option value="">Sem meta</option>
                  {availableGoals.map((goal) => (
                    <option key={goal.value} value={goal.value}>{goal.label}</option>
                  ))}
                </>
              )}
            </select>
            {lockedGoalLabel && (
              <p className="mt-1.5 text-xs text-indigo-700 dark:text-indigo-300">
                Este aporte já vai para esta meta.
              </p>
            )}
          </div>

          <SelectField
            id="simple-portfolio"
            label="Carteira"
            required
            value={form.classId}
            options={toOptions(portfolios.data)}
            onChange={(value) => patch({ classId: value })}
            error={errors.classId}
            hint="Onde este dinheiro se encaixa: aposentadoria, reserva de emergência, objetivos."
            emptyHint="Nenhuma carteira cadastrada. Cadastre em Configurações › Cadastros › Carteiras de investimento."
          />

          <SelectField
            id="simple-institution"
            label="Instituição"
            required
            value={form.institutionId}
            options={toOptions(institutions.data)}
            onChange={(value) => patch({ institutionId: value })}
            error={errors.institutionId}
            emptyHint="Nenhuma instituição cadastrada. Cadastre em Configurações › Cadastros › Instituições."
          />

          <div>
            <label htmlFor="simple-description" className={labelClasses}>
              Descrição <Required />
            </label>
            <input
              id="simple-description"
              type="text"
              value={form.description}
              placeholder="Ex: Tesouro Selic 2029"
              onChange={(event) => patch({ description: event.target.value })}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={errors.description ? 'simple-description-error' : undefined}
              className={inputClasses}
            />
            <FieldError id="simple-description-error" message={errors.description} />
          </div>

          <SelectField
            id="simple-category"
            label="Categoria"
            required
            value={form.typeId}
            options={toOptions(categories.data)}
            onChange={(value) => patch({ typeId: value })}
            error={errors.typeId}
            emptyHint="Nenhuma categoria cadastrada. Cadastre em Configurações › Cadastros › Categorias de investimento."
          />

          <CurrencyField
            id="simple-amount"
            label="Valor do investimento"
            required
            value={form.amount}
            onChange={(value) => patch({ amount: maskCurrencyInput(value) })}
            error={errors.amount}
          />

          <YesNoField
            name="simple-deposited"
            legend="Esse valor já foi depositado?"
            value={form.deposited}
            onChange={(value) => patch({ deposited: value })}
          >
            <DateField
              id="simple-date"
              label={form.deposited ? 'Quando foi depositado?' : 'Quando deve ser depositado?'}
              required
              value={form.date}
              onChange={(value) => patch({ date: value })}
              error={errors.date}
            />
          </YesNoField>
        </div>

        <div className="mt-6">
          <button type="submit" disabled={submitting} className={submitClasses}>
            {submitting ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </SimpleModal>
  );
};

export default NewInvestmentModal;
