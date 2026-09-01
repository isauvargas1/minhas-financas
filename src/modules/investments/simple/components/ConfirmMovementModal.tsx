import React, { useEffect, useState } from 'react';

import { useFinancialIntent } from '../../hooks/useIntentNonce';
import { simpleInvestmentError } from '../../errors';
import { useSimpleInvestmentMutation } from '../api';
import { dateInputToInstant, dateInputValue, isValidDateInput } from '../form';
import { DateField, ErrorBanner, SimpleModal, submitClasses } from './shell';

/**
 * Confirmações de um lançamento já existente (Etapa 2, §5, §10 e §11).
 *
 * As quatro ações compartilham a mesma forma — um lançamento identificado, uma
 * data e uma confirmação — e por isso um modal só. Nenhuma delas pergunta de
 * novo valor, rendimento, carteira, categoria ou instituição: esses dados
 * pertencem à intenção original e reabri-los seria editar fato financeiro por
 * porta lateral, que é justamente o que o backend recusa.
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
    body: 'O valor sai do seu caixa e passa a contar como investido.',
    dateLabel: 'Quando foi depositado?',
    submit: 'Confirmar depósito',
    pending: 'Confirmando...',
    success: 'Depósito confirmado.',
    callable: 'settleInvestmentContribution',
  },
  settleWithdrawal: {
    title: 'Confirmar recebimento',
    body: 'O valor entra no seu caixa e sai do investimento.',
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

export interface ConfirmMovementModalProps {
  open: boolean;
  workspaceId: string;
  intent: ConfirmMovementIntent | null;
  movement: { id: string; description: string } | null;
  onClose(): void;
  onSuccess(message: string): void;
}

const ConfirmMovementModal: React.FC<ConfirmMovementModalProps> = ({
  open, workspaceId, intent, movement, onClose, onSuccess,
}) => {
  const [date, setDate] = useState(() => dateInputValue(new Date()));
  const [dateError, setDateError] = useState<string>();
  const [failure, setFailure] = useState<string>();

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
  }, [open, movement?.id, intent]);

  if (!open || !intent || !movement) return null;
  const copy = COPY[intent];

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (copy.dateLabel && !isValidDateInput(date)) {
      setDateError('Informe uma data válida.');
      return;
    }
    setDateError(undefined);
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
    } else if (intent === 'undo') {
      payload.reversedAt = instant;
      payload.reason = REASON.undo;
    } else {
      payload.occurredAt = instant;
      payload.reason = REASON.cancel;
    }
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
