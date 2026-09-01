/**
 * Ações disponíveis por linha, por papel (Etapa 2, §11 e §15).
 *
 * A regra do §11 é explícita: **não mostrar ação que o papel atual não pode
 * executar**. Um botão que só produz "Você não tem permissão" é pior que
 * botão nenhum — ele promete e recusa. A matriz aqui espelha exatamente a do
 * backend (`functions/src/investments/writeStrategy.ts`), que continua sendo a
 * autoridade: esconder é conveniência de interface, autorizar é servidor.
 *
 * - liquidar, cancelar, retirar e editar: owner, admin e member;
 * - desfazer lançamento (estorno): owner e admin.
 */

import type { SimpleInvestmentRow } from './rows';

export type SimpleWorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer' | undefined;

export type SimpleInvestmentAction =
  | 'settleContribution'
  | 'settleWithdrawal'
  | 'edit'
  | 'cancel'
  | 'withdraw'
  | 'undo';

const CAN_MUTATE = new Set(['owner', 'admin', 'member']);
const CAN_UNDO = new Set(['owner', 'admin']);

export interface SimpleRowActionContext {
  role: SimpleWorkspaceRole;
  /**
   * A posição do investimento tem capital para retirar.
   *
   * Vem de uma consulta em bloco sobre os `positionId` da página, nunca de uma
   * leitura por linha. `false` também cobre o aporte pendente, que ainda não
   * tem posição — e por isso não pode ser retirado.
   */
  redeemable: boolean;
}

export const simpleRowActions = (
  row: SimpleInvestmentRow,
  context: SimpleRowActionContext,
): SimpleInvestmentAction[] => {
  const mutate = CAN_MUTATE.has(String(context.role));
  const undo = CAN_UNDO.has(String(context.role));
  const actions: SimpleInvestmentAction[] = [];

  if (row.status === 'pending' && mutate) {
    actions.push('settleContribution', 'edit', 'cancel');
  }
  if (row.status === 'awaiting' && mutate) {
    actions.push('settleWithdrawal', 'cancel');
  }
  if (row.status === 'deposited') {
    // A retirada mora na linha do aporte porque, no fluxo simples, cada
    // "Novo investimento" tem posição própria: a linha depositada **é** o
    // investimento. Oferecê-la também na linha de retirada duplicaria o mesmo
    // botão para a mesma posição.
    if (mutate && context.redeemable) actions.push('withdraw');
    if (undo) actions.push('undo');
  }
  if (row.status === 'received' && undo) {
    actions.push('undo');
  }
  return actions;
};
