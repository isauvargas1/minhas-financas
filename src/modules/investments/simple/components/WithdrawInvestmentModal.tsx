import React, { useEffect, useState } from 'react';

import { useFinancialIntent } from '../../hooks/useIntentNonce';
import { simpleInvestmentError } from '../../errors';
import { useSimpleInvestmentMutation } from '../api';
import {
  buildWithdrawSimpleInvestmentInput,
  emptyWithdrawForm,
  maskCurrencyInput,
  validateWithdraw,
  type SimpleFormErrors,
  type WithdrawFormState,
} from '../form';
import {
  CurrencyField,
  DateField,
  ErrorBanner,
  SimpleModal,
  YesNoField,
  labelClasses,
  submitClasses,
} from './shell';

/**
 * "Retirar investimento" (Etapa 2, §8 e §9).
 *
 * O investimento não é escolhido aqui: o modal abre a partir da linha, e a tela
 * já sabe qual é. Um seletor técnico de posição só existiria para repetir uma
 * informação que o usuário acabou de apontar.
 *
 * O rendimento fica atrás de "Mais detalhes" porque ele é a exceção, não a
 * regra: sem ele, o backend trata o total como capital, que é o caso comum e o
 * comportamento conservador. Nada é estimado no cliente — se o valor pedido
 * passar do capital conhecido, quem explica é o domínio, e a mensagem já aponta
 * para este campo.
 */

export interface WithdrawInvestmentModalProps {
  open: boolean;
  workspaceId: string;
  investment: { positionId: string; description: string; principalCents: number } | null;
  onClose(): void;
  onSuccess(message: string): void;
}

const money = (cents: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

const WithdrawInvestmentModal: React.FC<WithdrawInvestmentModalProps> = ({
  open, workspaceId, investment, onClose, onSuccess,
}) => {
  const [form, setForm] = useState<WithdrawFormState>(() => emptyWithdrawForm(new Date()));
  const [errors, setErrors] = useState<SimpleFormErrors>({});
  const [failure, setFailure] = useState<string>();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const intent = useFinancialIntent(
    open && investment ? `simple-withdrawal:${investment.positionId}` : null,
  );
  const mutation = useSimpleInvestmentMutation(workspaceId);
  const submitting = mutation.isPending;

  useEffect(() => {
    if (!open) return;
    setForm(emptyWithdrawForm(new Date()));
    setErrors({});
    setFailure(undefined);
    setDetailsOpen(false);
  }, [open, investment?.positionId]);

  if (!investment) return null;

  const patch = (values: Partial<WithdrawFormState>) =>
    setForm((current) => ({ ...current, ...values }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const found = validateWithdraw(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // O rendimento mora fechado; um erro nele precisa ficar visível.
      if (found.gain) setDetailsOpen(true);
      return;
    }
    setFailure(undefined);
    // Instante congelado da intenção: um relógio novo por tentativa mudaria o
    // `requestHash` sem mudar a chave, e o retry viraria conflito.
    const payload = buildWithdrawSimpleInvestmentInput(
      form, investment.positionId, new Date(intent.occurredAt()),
    );
    try {
      await mutation.mutateAsync({
        name: 'withdrawSimpleInvestment',
        nonce: intent.nonce,
        payload: payload as unknown as Record<string, unknown>,
      });
      onSuccess(
        payload.received
          ? 'Retirada registrada como recebida.'
          : 'Retirada registrada. Confirme quando o dinheiro chegar.',
      );
      onClose();
    } catch (error) {
      const message = simpleInvestmentError(error);
      setFailure(message);
      if (/rendimento/i.test(message)) setDetailsOpen(true);
    }
  };

  return (
    <SimpleModal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title="Retirar investimento"
    >
      <ErrorBanner message={failure} />
      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-4">
          <div>
            <span className={labelClasses}>Investimento</span>
            <p className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-dark-200 px-4 py-2 text-gray-800 dark:text-gray-200 font-semibold">
              {investment.description}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Valor investido disponível: {money(investment.principalCents)}
            </p>
          </div>

          <CurrencyField
            id="withdraw-amount"
            label="Valor da retirada"
            required
            value={form.amount}
            onChange={(value) => patch({ amount: maskCurrencyInput(value) })}
            error={errors.amount}
          />

          <YesNoField
            name="withdraw-received"
            legend="O dinheiro já foi recebido?"
            value={form.received}
            onChange={(value) => patch({ received: value })}
          >
            <DateField
              id="withdraw-date"
              label={form.received ? 'Quando foi recebido?' : 'Quando deve ser recebido?'}
              required
              value={form.date}
              onChange={(value) => patch({ date: value })}
              error={errors.date}
            />
          </YesNoField>

          <details
            open={detailsOpen}
            onToggle={(event) => setDetailsOpen((event.target as HTMLDetailsElement).open)}
            className="rounded-lg border border-gray-200 dark:border-gray-700"
          >
            <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              Mais detalhes
            </summary>
            <div className="border-t border-gray-200 dark:border-gray-700 p-4">
              <CurrencyField
                id="withdraw-gain"
                label="Rendimento incluído na retirada"
                value={form.gain}
                onChange={(value) => patch({ gain: maskCurrencyInput(value) })}
                error={errors.gain}
                hint="Preencha somente se parte do valor retirado corresponde a rendimento do investimento."
              />
            </div>
          </details>
        </div>

        <div className="mt-6">
          <button type="submit" disabled={submitting} className={submitClasses}>
            {submitting ? 'Confirmando...' : 'Confirmar retirada'}
          </button>
        </div>
      </form>
    </SimpleModal>
  );
};

export default WithdrawInvestmentModal;
