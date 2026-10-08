import React, { useState } from 'react';

import { useAuth } from '../../contexts/AuthContext.tsx';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import { useWorkspace } from '../../contexts/WorkspaceContext.tsx';
import {
  useCancelLoan,
  useLoanIntentKey,
  useReverseLoanMovement,
} from '../../modules/loans/hooks.ts';
import { formatCents, formatDayKey } from '../../modules/loans/money.ts';
import { toCancelPayload, toReversePayload } from '../../modules/loans/payloads.ts';
import {
  loanErrorView,
  loanPermissions,
  movementLabel,
} from '../../modules/loans/presentation.ts';
import type { Loan, LoanMovement } from '../../modules/loans/types.ts';
import LoanMetadataModal from './LoanMetadataModal.tsx';
import LoanPaymentModal from './LoanPaymentModal.tsx';
import LoanReasonModal from './LoanReasonModal.tsx';

/**
 * Ações do detalhe do empréstimo, comuns a PF e PJ (P3-H): pagamento ou
 * recebimento, estorno, cancelamento e edição de dados — cada uma por sua
 * callable. As permissões refletem a política do backend (owner/admin tudo;
 * member só no que criou; viewer só lê), mas quem decide é o backend: a perda
 * de papel com a tela aberta chega como recusa em pt-BR, sem gravar nada.
 */
/**
 * Cada diálogo guarda o contrato **como estava ao abrir** (versão, saldo):
 * depois de falha ou resposta incerta a tela recarrega, mas o diálogo aberto
 * continua com a mesma intenção — o reenvio do mesmo conteúdo usa a mesma
 * chave e o backend devolve o resultado já gravado, em vez de um segundo
 * efeito. Conflito de versão continua visível; reabrir carrega a atual.
 */
type DialogState =
  | null
  | { kind: 'payment'; loan: Loan }
  | { kind: 'metadata'; loan: Loan }
  | { kind: 'cancel'; loan: Loan }
  | { kind: 'reverse'; loan: Loan; movement: LoanMovement };

export const CANCEL_WITH_PAYMENTS_HINT =
  'Este empréstimo tem pagamentos ativos. Estorne-os no histórico antes de cancelar o contrato.';

export const useLoanOperations = (loan: Loan | null | undefined) => {
  const { activeWorkspace, activeWorkspaceRole } = useWorkspace();
  const { user } = useAuth();
  const { playSound } = useTheme();
  const permissions = loanPermissions({ role: activeWorkspaceRole, uid: user?.uid }, loan);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reverseMutation = useReverseLoanMovement();
  const cancelMutation = useCancelLoan();
  const reverseIntent = useLoanIntentKey();
  const cancelIntent = useLoanIntentKey();

  const close = () => setDialog(null);
  const done = (message: string) => {
    setDialog(null);
    setNotice(message);
    playSound('success');
  };
  const open = (next: Exclude<DialogState, null>) => {
    setNotice(null);
    if (next.kind === 'reverse') reverseIntent.reset();
    if (next.kind === 'cancel') cancelIntent.reset();
    setDialog(next);
  };

  const reverse = async (reason: string): Promise<string | null> => {
    if (dialog?.kind !== 'reverse') return null;
    try {
      const payload = toReversePayload({
        workspaceId: activeWorkspace.id, loan: dialog.loan, movement: dialog.movement, reason,
      });
      await reverseMutation.mutateAsync({
        payload, idempotencyKey: reverseIntent.keyFor('reverseLoanMovement', payload),
      });
      done('Estorno registrado. O saldo e o caixa foram recompostos.');
      return null;
    } catch (failure) {
      return loanErrorView(failure).message;
    }
  };

  const cancel = async (reason: string): Promise<string | null> => {
    if (dialog?.kind !== 'cancel') return null;
    try {
      const payload = toCancelPayload({ workspaceId: activeWorkspace.id, loan: dialog.loan, reason });
      await cancelMutation.mutateAsync({
        payload, idempotencyKey: cancelIntent.keyFor('cancelLoan', payload),
      });
      done('Empréstimo cancelado. O histórico foi preservado.');
      return null;
    } catch (failure) {
      return loanErrorView(failure).message;
    }
  };

  const settlementWord = loan?.type === 'lend' ? 'recebimento' : 'pagamento';
  const snapshot = dialog?.loan ?? loan;
  const modals = loan && snapshot ? (
    <>
      <LoanPaymentModal
        open={dialog?.kind === 'payment'}
        loan={snapshot}
        onClose={close}
        onDone={() => done(loan.type === 'lend' ? 'Recebimento registrado.' : 'Pagamento registrado.')}
      />
      <LoanMetadataModal
        open={dialog?.kind === 'metadata'}
        loan={snapshot}
        onClose={close}
        onDone={() => done('Dados do empréstimo atualizados.')}
      />
      <LoanReasonModal
        open={dialog?.kind === 'reverse'}
        title={`Estornar ${settlementWord}`}
        confirmLabel="Confirmar estorno"
        reasonLabel="Motivo do estorno"
        onClose={close}
        onConfirm={reverse}
        busy={reverseMutation.isPending}
      >
        {dialog?.kind === 'reverse' && (
          <p className="font-bold text-gray-800 dark:text-gray-100">
            {movementLabel(dialog.movement, loan.type)} de {formatDayKey(dialog.movement.date)}:{' '}
            {formatCents(dialog.movement.totalCents)} (principal {formatCents(dialog.movement.principalCents)},
            juros {formatCents(dialog.movement.interestCents)})
          </p>
        )}
        <p>
          O movimento original continua no histórico, marcado como estornado. Um movimento de compensação
          devolve o principal ao saldo e desfaz no caixa o valor {loan.type === 'lend' ? 'recebido' : 'pago'}.
        </p>
      </LoanReasonModal>
      <LoanReasonModal
        open={dialog?.kind === 'cancel'}
        title="Cancelar empréstimo"
        confirmLabel="Cancelar empréstimo"
        reasonLabel="Motivo do cancelamento"
        onClose={close}
        onConfirm={cancel}
        busy={cancelMutation.isPending}
        blockedMessage={snapshot.activePaymentCount > 0 ? CANCEL_WITH_PAYMENTS_HINT : null}
      >
        <p>O histórico do contrato e dos movimentos é preservado; nada é apagado.</p>
        <p>
          O efeito inicial do principal ({formatCents(loan.principalCents)}) é compensado no caixa:
          {loan.type === 'borrow' ? ' uma saída' : ' uma entrada'} na data da contratação.
        </p>
        <p>Pagamentos ativos precisam ser estornados antes. O contrato fica cancelado e não aceita novas operações.</p>
      </LoanReasonModal>
    </>
  ) : null;

  return {
    permissions,
    notice,
    modals,
    openPayment: () => { if (loan) open({ kind: 'payment', loan }); },
    openMetadata: () => { if (loan) open({ kind: 'metadata', loan }); },
    openCancel: () => { if (loan) open({ kind: 'cancel', loan }); },
    openReverse: (movement: LoanMovement) => { if (loan) open({ kind: 'reverse', loan, movement }); },
  };
};

/** Aviso de sucesso da última operação, anunciado por leitor de tela. */
export const LoanNotice: React.FC<{ message: string | null }> = ({ message }) => (
  <p role="status" aria-live="polite" className={message ? 'mb-4 rounded-lg bg-green-50 dark:bg-green-900/20 p-3 text-sm font-medium text-green-800 dark:text-green-200' : 'sr-only'}>
    {message ?? ''}
  </p>
);
