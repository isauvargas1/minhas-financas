import React, { useEffect, useMemo, useRef, useState } from 'react';

import { useFinancialIntent } from '../../hooks/useIntentNonce';
import { simpleInvestmentError } from '../../errors';
import { useSimpleInvestmentMutation } from '../api';
import { useCashAccounts } from '../../../accounts/hooks';
import { defaultCashAccountId, useActiveCashAccountOptions } from '../cashAccounts';
import {
  CONTRIBUTION_ACCOUNT_MESSAGE,
  WITHDRAWAL_ACCOUNT_MESSAGE,
  dateInputToInstant,
  dateInputValue,
  isValidDateInput,
} from '../form';
import type { SimpleInvestmentKind } from '../rows';
import { CashAccountField, DateField, ErrorBanner, SimpleModal, submitClasses } from './shell';

/**
 * Confirmações de um lançamento já existente (Etapa 2, §5, §10 e §11).
 *
 * As quatro ações compartilham a mesma forma — um lançamento identificado, uma
 * data e uma confirmação — e por isso um modal só. Nenhuma delas pergunta de
 * novo valor, rendimento, carteira, categoria ou instituição: esses dados
 * pertencem à intenção original e reabri-los seria editar fato financeiro por
 * porta lateral, que é justamente o que o backend recusa.
 *
 * Conta do Caixa (D-30, P4-D): confirmar depósito pede a conta de origem e
 * confirmar recebimento, a de destino — é ali que o dinheiro se move. Desfazer
 * compensa na conta do lançamento original, que é só informada, nunca
 * escolhida. Cancelar um pendente não move conta.
 *
 * "Desfazer lançamento" é o nome de tela do estorno. A palavra técnica nunca
 * aparece, e a ação só é oferecida a quem o domínio autoriza.
 */

export type ConfirmMovementIntent =
  | 'settleContribution'
  | 'settleWithdrawal'
  | 'cancel'
  | 'undo';

interface IntentCopy {
  title: string;
  body: string;
  dateLabel?: string;
  submit: string;
  pending: string;
  success: string;
  callable: string;
}

const COPY: Record<ConfirmMovementIntent, IntentCopy> = {
  settleContribution: {
    title: 'Confirmar depósito',
    body: 'O valor sai da conta escolhida e passa a contar como investido.',
    dateLabel: 'Quando foi depositado?',
    submit: 'Confirmar depósito',
    pending: 'Confirmando...',
    success: 'Depósito confirmado.',
    callable: 'settleInvestmentContribution',
  },
  settleWithdrawal: {
    title: 'Confirmar recebimento',
    body: 'O valor entra na conta escolhida e sai do investimento.',
    dateLabel: 'Quando o dinheiro entrou?',
    submit: 'Confirmar recebimento',
    pending: 'Confirmando...',
    success: 'Recebimento confirmado.',
    callable: 'settleSimpleWithdrawal',
  },
  cancel: {
    title: 'Cancelar lançamento',
    body: 'O lançamento continua no histórico como cancelado. Nada é apagado.',
    submit: 'Cancelar lançamento',
    pending: 'Cancelando...',
    success: 'Lançamento cancelado.',
    callable: 'cancelInvestmentMovement',
  },
  undo: {
    title: 'Desfazer lançamento',
    body: 'Os efeitos do lançamento são revertidos e o histórico registra as duas etapas.',
    dateLabel: 'Quando o lançamento foi desfeito?',
    submit: 'Desfazer lançamento',
    pending: 'Desfazendo...',
    success: 'Lançamento desfeito.',
    callable: 'reverseInvestmentMovement',
  },
};

const REASON: Record<ConfirmMovementIntent, string> = {
  settleContribution: '',
  settleWithdrawal: '',
  cancel: 'Cancelado pelo usuário na tela de investimentos.',
  undo: 'Lançamento desfeito pelo usuário na tela de investimentos.',
};

export interface ConfirmMovementTarget {
  id: string;
  description: string;
  /** No desfazer: aporte ou retirada, para dizer o sentido da compensação. */
  kind?: SimpleInvestmentKind;
  /** No desfazer: a conta do lançamento original, onde a compensação cai. */
  cashAccountId?: string;
}

export interface ConfirmMovementModalProps {
  open: boolean;
  workspaceId: string;
  intent: ConfirmMovementIntent | null;
  movement: ConfirmMovementTarget | null;
  onClose(): void;
  onSuccess(message: string): void;
}

/** Conta exigida pela confirmação, com o rótulo e a mensagem de cada sentido. */
const ACCOUNT_FIELD: Partial<Record<ConfirmMovementIntent, {
  label: string;
  hint: string;
  required: string;
}>> = {
  settleContribution: {
    label: 'Conta de origem',
    hint: 'Conta do Caixa de onde o dinheiro saiu. O saldo dela diminui no mesmo instante.',
    required: CONTRIBUTION_ACCOUNT_MESSAGE,
  },
  settleWithdrawal: {
    label: 'Conta de destino',
    hint: 'Conta do Caixa em que o dinheiro entrou. O saldo dela aumenta no mesmo instante.',
    required: WITHDRAWAL_ACCOUNT_MESSAGE,
  },
};

const ConfirmMovementModal: React.FC<ConfirmMovementModalProps> = ({
  open, workspaceId, intent, movement, onClose, onSuccess,
}) => {
  const [date, setDate] = useState(() => dateInputValue(new Date()));
  const [dateError, setDateError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [cashAccountId, setCashAccountId] = useState('');
  const [accountError, setAccountError] = useState<string>();
  // Trava síncrona: dois envios no mesmo tique não passam pelo `isPending`.
  const submittingRef = useRef(false);
  const cashAccounts = useActiveCashAccountOptions();
  const singleAccountId = defaultCashAccountId(cashAccounts.options);
  const allAccounts = useCashAccounts();
  const originalAccountName = useMemo(() => {
    if (!movement?.cashAccountId) return null;
    return allAccounts.data?.items.find((account) => account.id === movement.cashAccountId)?.name ?? null;
  }, [allAccounts.data, movement?.cashAccountId]);

  const financialIntent = useFinancialIntent(
    open && movement && intent ? `simple-${intent}:${movement.id}` : null,
  );
  const mutation = useSimpleInvestmentMutation(workspaceId);
  const submitting = mutation.isPending;

  useEffect(() => {
    if (!open) return;
    setDate(dateInputValue(new Date()));
    setDateError(undefined);
    setFailure(undefined);
    setCashAccountId('');
    setAccountError(undefined);
  }, [open, movement?.id, intent]);

  // Conta única: já vem escolhida (com duas ou mais, a escolha é explícita).
  useEffect(() => {
    if (!open || !singleAccountId) return;
    setCashAccountId((current) => current || singleAccountId);
  }, [open, singleAccountId, movement?.id, intent]);

  if (!open || !intent || !movement) return null;
  const copy = COPY[intent];
  const accountField = ACCOUNT_FIELD[intent];
  const undoAccountNote = intent === 'undo' && originalAccountName
    ? movement.kind === 'withdrawal'
      ? `O valor sai novamente da conta ${originalAccountName}.`
      : `O valor volta para a conta ${originalAccountName}.`
    : null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || submittingRef.current) return;
    const invalidDate = Boolean(copy.dateLabel) && !isValidDateInput(date);
    const missingAccount = Boolean(accountField) && !cashAccountId;
    setDateError(invalidDate ? 'Informe uma data válida.' : undefined);
    setAccountError(missingAccount ? accountField?.required : undefined);
    if (invalidDate || missingAccount) return;
    setFailure(undefined);
    // Os dois ramos partem do mesmo instante congelado da intenção: o campo de
    // data só ancora o dia, e o relógio que resolve "hoje antes do meio-dia"
    // precisa ser estável entre tentativas para o retry continuar idempotente.
    const instant = copy.dateLabel
      ? dateInputToInstant(date, new Date(financialIntent.occurredAt()))
      : financialIntent.occurredAt();
    const payload: Record<string, unknown> = { movementId: movement.id };
    if (intent === 'settleContribution' || intent === 'settleWithdrawal') {
      payload.settledAt = instant;
      payload.cashAccountId = cashAccountId;
    } else if (intent === 'undo') {
      payload.reversedAt = instant;
      payload.reason = REASON.undo;
    } else {
      payload.occurredAt = instant;
      payload.reason = REASON.cancel;
    }
    submittingRef.current = true;
    try {
      await mutation.mutateAsync({
        name: copy.callable,
        nonce: financialIntent.nonce,
        payload,
      });
      onSuccess(copy.success);
      onClose();
    } catch (error) {
      setFailure(simpleInvestmentError(error));
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <SimpleModal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={copy.title}
    >
      <ErrorBanner message={failure} />
      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-dark-200 px-4 py-3">
            <p className="font-semibold text-gray-800 dark:text-gray-200">{movement.description}</p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{copy.body}</p>
            {undoAccountNote && (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{undoAccountNote}</p>
            )}
          </div>
          {copy.dateLabel && (
            <DateField
              id="confirm-movement-date"
              label={copy.dateLabel}
              required
              value={date}
              onChange={setDate}
              error={dateError}
            />
          )}
          {accountField && (
            <CashAccountField
              id="confirm-movement-cash-account"
              label={accountField.label}
              value={cashAccountId}
              options={cashAccounts.options}
              onChange={setCashAccountId}
              error={accountError}
              hint={accountField.hint}
            />
          )}
        </div>
        <div className="mt-6">
          <button type="submit" disabled={submitting} className={submitClasses}>
            {submitting ? copy.pending : copy.submit}
          </button>
        </div>
      </form>
    </SimpleModal>
  );
};

export default ConfirmMovementModal;
