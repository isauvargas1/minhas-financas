import React, { useEffect, useMemo, useState } from 'react';

import type { Goal } from '../../../../types';
import {
  useSettingsCatalog,
  useSettingsCatalogGroup,
} from '../../../settings-catalog/hooks';
import { useFinancialIntent } from '../../hooks/useIntentNonce';
import { simpleInvestmentError } from '../../errors';
import { useSimpleInvestmentMutation } from '../api';
import {
  buildCategoryOptions,
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
  YesNoField,
  labelClasses,
  inputClasses,
  submitClasses,
  Required,
  FieldError,
  type SelectOption,
} from './shell';

/**
 * Formulário de "Novo investimento", sem a moldura do modal.
 *
 * Existe um formulário só. A tela de Investimentos o embrulha em
 * `NewInvestmentModal`, e a aba "Investimento" de "Nova Transação" o monta
 * dentro do próprio painel — mesmos campos, mesma validação, mesmos catálogos,
 * mesma identidade de intenção e o **mesmo** destino: `createSimpleInvestment`.
 * Duplicar isto dentro do `TransactionModal` seria reabrir, por cópia, o
 * caminho que gravava aporte direto em `transactions`.
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
  /**
   * Rótulo da categoria no instante em que o movimento foi escrito.
   *
   * É o que permite reabrir um pendente antigo mostrando a categoria que ele
   * realmente tem, sem consultar o catálogo por nome e sem depender de o item
   * ainda estar sendo oferecido como cadastro.
   */
  typeName?: string;
  valueCents: number;
  goalId?: string;
  occurredAt: Date | null;
}

export interface SimpleInvestmentFormProps {
  /**
   * Formulário aberto. Abrir é o que cria uma intenção financeira nova e
   * repõe os campos; fechado, nada é submetido nem preparado.
   */
  open: boolean;
  workspaceId: string;
  goals: Goal[];
  /** Meta pré-selecionada quando o formulário nasce de uma meta (§13). */
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
   * tem todos os deltas em zero. As duas metades acontecem na mesma transação
   * do backend, via `replacesMovementId`: uma correção recusada não consome o
   * pendente que ela ia substituir.
   */
  editing?: EditingInvestment | null;
  /**
   * Prefixo dos `id` e `name` dos campos.
   *
   * O padrão é o do baseline, para que a tela de Investimentos continue com o
   * DOM que já tinha. Cada ponto de montagem usa o seu, porque dois
   * formulários montados ao mesmo tempo com `id` repetido quebrariam o vínculo
   * `label`/campo e juntariam os rádios de "já foi depositado?" num grupo só.
   */
  idPrefix?: string;
  /** Informa o envio em curso a quem embrulha o formulário. */
  onPendingChange?(pending: boolean): void;
  onClose(): void;
  onSuccess(message: string): void;
}

const goalOptions = (goals: Goal[]): SelectOption[] => goals
  .filter((goal) => goal.status === 'em_andamento')
  .map((goal) => ({
    value: goal.id,
    label: `${goal.visual?.emoji ? `${goal.visual.emoji} ` : ''}${goal.name}`,
  }));

const SimpleInvestmentForm: React.FC<SimpleInvestmentFormProps> = ({
  open, workspaceId, goals, initialGoalId, goalLocked = false, editing,
  idPrefix = 'simple', onPendingChange, onClose, onSuccess,
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
  /*
   * Fonte única da categoria: Configurações › Cadastros › Categorias ›
   * Investimentos, ou seja o catálogo genérico `category` recortado por
   * `transactionSubtype`. É o mesmo cadastro que alimenta receita, despesa e
   * parcelado — e a mesma consulta já cacheada de `useSettingsCatalog`, com
   * recorte local: nenhuma leitura nova do Firestore.
   *
   * O grupo histórico `investment_type` continua existindo e legível no
   * backend; ele apenas deixou de ser um segundo cadastro visível.
   */
  const categories = useSettingsCatalog({
    group: 'category',
    transactionSubtype: 'investimento',
  });

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

  /*
   * A regra de compatibilidade da categoria é pura e mora em `form.ts`, junto
   * das outras: o que decide quais opções existem não depende de React e é
   * testado sem renderizar nada.
   */
  const categoryOptions = useMemo<SelectOption[]>(
    () => buildCategoryOptions(categories.data, form.typeId, editing?.typeName),
    [categories.data, form.typeId, editing?.typeName],
  );

  const catalogLoading =
    portfolios.isLoading || institutions.isLoading || categories.isLoading;

  const submitting = mutation.isPending;

  useEffect(() => {
    onPendingChange?.(submitting);
  }, [submitting, onPendingChange]);

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
    /*
     * Correção de pendente é **uma** chamada, com `replacesMovementId`.
     *
     * O caminho anterior cancelava o pendente e depois criava o substituto,
     * em duas callables. Entre uma e outra havia um estado alcançável em que
     * o pendente já estava cancelado e o substituto não existia — e uma recusa
     * na criação (categoria inativada no cadastro depois do lançamento, por
     * exemplo) fazia o usuário perder o lançamento por ter tentado corrigir a
     * descrição. Inverter a ordem seria pior: uma falha no cancelamento
     * deixaria dois pendentes vivos para o mesmo dinheiro.
     *
     * Não existe ordem segura entre duas transações independentes. O domínio
     * passa a fazer as duas metades no mesmo commit, e a interface só declara
     * qual pendente está sendo substituído: edição recusada devolve o pendente
     * original intacto, sem nada para o formulário reconstruir.
     */
    const payload = buildCreateSimpleInvestmentInput(
      form, new Date(intent.occurredAt()), editing?.movementId,
    );
    try {
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
    <>
      <ErrorBanner message={failure} />
      {catalogLoading && (
        <p className="mb-4 text-xs font-medium text-indigo-600 dark:text-indigo-300">
          Atualizando cadastros do workspace...
        </p>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-4">
          <div className="bg-indigo-50 dark:bg-indigo-900/20 p-3 rounded-lg border border-indigo-100 dark:border-indigo-800">
            <label htmlFor={`${idPrefix}-goal`} className={`${labelClasses} font-bold text-indigo-700 dark:text-indigo-300`}>
              {lockedGoalLabel ? 'Meta' : 'Meta (opcional)'}
            </label>
            <select
              id={`${idPrefix}-goal`}
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
            id={`${idPrefix}-portfolio`}
            label="Carteira de investimento"
            required
            value={form.classId}
            options={toOptions(portfolios.data)}
            onChange={(value) => patch({ classId: value })}
            error={errors.classId}
            hint="Onde este dinheiro se encaixa: aposentadoria, reserva de emergência, objetivos."
            emptyHint="Nenhuma carteira cadastrada. Cadastre em Configurações › Cadastros › Carteiras de investimento."
          />

          <SelectField
            id={`${idPrefix}-institution`}
            label="Instituição"
            required
            value={form.institutionId}
            options={toOptions(institutions.data)}
            onChange={(value) => patch({ institutionId: value })}
            error={errors.institutionId}
            emptyHint="Nenhuma instituição cadastrada. Cadastre em Configurações › Cadastros › Instituições."
          />

          <div>
            <label htmlFor={`${idPrefix}-description`} className={labelClasses}>
              Descrição <Required />
            </label>
            <input
              id={`${idPrefix}-description`}
              type="text"
              value={form.description}
              placeholder="Ex: Tesouro Selic 2029"
              onChange={(event) => patch({ description: event.target.value })}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={errors.description ? `${idPrefix}-description-error` : undefined}
              className={inputClasses}
            />
            <FieldError id={`${idPrefix}-description-error`} message={errors.description} />
          </div>

          <SelectField
            id={`${idPrefix}-category`}
            label="Categoria"
            required
            value={form.typeId}
            options={categoryOptions}
            onChange={(value) => patch({ typeId: value })}
            error={errors.typeId}
            emptyHint="Nenhuma categoria cadastrada. Cadastre em Configurações › Cadastros › Categorias › Investimentos."
          />

          <CurrencyField
            id={`${idPrefix}-amount`}
            label="Valor do investimento"
            required
            value={form.amount}
            onChange={(value) => patch({ amount: maskCurrencyInput(value) })}
            error={errors.amount}
          />

          <YesNoField
            name={`${idPrefix}-deposited`}
            legend="Esse valor já foi depositado?"
            value={form.deposited}
            onChange={(value) => patch({ deposited: value })}
          >
            <DateField
              id={`${idPrefix}-date`}
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
    </>
  );
};

export default SimpleInvestmentForm;
