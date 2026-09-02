import React, { useState } from 'react';

import type { Goal } from '../../../../types';
import SimpleInvestmentForm, {
  type EditingInvestment,
} from './SimpleInvestmentForm';
import { SimpleModal } from './shell';

/**
 * "Novo investimento" (Etapa 2, §4).
 *
 * Este arquivo é só a moldura modal da experiência específica de
 * Investimentos: título, painel e fechamento. Os campos, a validação, os
 * catálogos e a idempotência moram em `SimpleInvestmentForm`, que a aba
 * "Investimento" de "Nova Transação" monta sem modal próprio. Um formulário,
 * dois pontos de montagem, um destino: `createSimpleInvestment`.
 */

export type { EditingInvestment };

export interface NewInvestmentModalProps {
  open: boolean;
  workspaceId: string;
  goals: Goal[];
  /** Meta pré-selecionada quando o modal é aberto a partir de uma meta (§13). */
  initialGoalId?: string | null;
  /** A meta não pode ser trocada dentro deste formulário (Etapa 3, §2.A). */
  goalLocked?: boolean;
  /** Aporte pendente que está sendo corrigido (§11). */
  editing?: EditingInvestment | null;
  onClose(): void;
  onSuccess(message: string): void;
}

const NewInvestmentModal: React.FC<NewInvestmentModalProps> = ({
  open, workspaceId, goals, initialGoalId, goalLocked = false, editing, onClose, onSuccess,
}) => {
  const [submitting, setSubmitting] = useState(false);

  return (
    <SimpleModal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={editing ? 'Editar investimento' : 'Novo investimento'}
    >
      <SimpleInvestmentForm
        open={open}
        workspaceId={workspaceId}
        goals={goals}
        initialGoalId={initialGoalId}
        goalLocked={goalLocked}
        editing={editing}
        onPendingChange={setSubmitting}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    </SimpleModal>
  );
};

export default NewInvestmentModal;
