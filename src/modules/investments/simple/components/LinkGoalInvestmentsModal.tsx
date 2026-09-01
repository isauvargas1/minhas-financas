import React, { useMemo, useRef, useState } from 'react';

import { useFinancialIntent } from '../../hooks/useIntentNonce';
import { simpleInvestmentError } from '../../errors';
import { useGoalLinkCandidates, useSimpleInvestmentMutation } from '../api';
import {
  availableGoalLinkCandidates,
  buildGoalLinkCall,
  buildGoalUnlinkCall,
  canManageGoalLinks,
  linkedGoalInvestments,
  type GoalLinkCandidate,
} from '../goalLink';
import { ErrorBanner, SimpleModal } from './shell';

/**
 * "Vincular Existente" da meta (Etapa 3, §2.C e §2.D).
 *
 * O botão existia no baseline ligado a `() => {}`. Aqui ele abre a única tela
 * onde o vínculo de meta é editável no fluxo comum, com as duas listas que a
 * correção de vínculo exige: o que já está na meta, com a ação de tirar, e o
 * que pode entrar.
 *
 * O que a lista **não** mostra, por decisão do §2.C:
 *
 * - investimento de outro workspace — a coleção é filha de
 *   `workspaces/{id}` e as Rules recusam qualquer listagem fora dela;
 * - posição sem capital e sem valor — o ativo técnico do onboarding e o
 *   investimento inteiramente retirado não são "um investimento" para quem
 *   abre a meta;
 * - aporte pendente — ainda não tem posição, e não precisa de vínculo
 *   retroativo: o próprio formulário já oferece a meta;
 * - o que já está nesta meta, na lista de disponíveis.
 *
 * Investimento vinculado a **outra** meta aparece, mas nunca troca em silêncio:
 * a ação é explícita e passa por confirmação, porque a meta anterior perde
 * aquele capital no mesmo instante.
 */

const formatCurrency = (cents: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

export interface LinkGoalInvestmentsModalProps {
  open: boolean;
  workspaceId: string;
  goalId: string;
  goalName: string;
  role: string | undefined;
  onClose(): void;
  onSuccess(message: string): void;
}

const rowClasses =
  'flex flex-col gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-dark-200/60 p-3 sm:flex-row sm:items-center sm:justify-between';

const LinkGoalInvestmentsModal: React.FC<LinkGoalInvestmentsModalProps> = ({
  open, workspaceId, goalId, goalName, role, onClose, onSuccess,
}) => {
  const [failure, setFailure] = useState<string>();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<GoalLinkCandidate | null>(null);

  const candidates = useGoalLinkCandidates(workspaceId, goalId, open);
  const intent = useFinancialIntent(open ? `goal-link:${goalId}` : null);
  const mutation = useSimpleInvestmentMutation(workspaceId);
  const canManage = canManageGoalLinks(role);
  /*
   * Rodada da intenção, avançada **só depois de um sucesso**.
   *
   * A chave de idempotência precisa repetir enquanto a tentativa é a mesma —
   * é o que faz o retry de uma resposta perdida repetir o resultado em vez de
   * duplicar o vínculo. Mas ela não pode repetir entre operações distintas:
   * com o modal aberto, vincular, remover e vincular de novo o mesmo
   * investimento montava a chave anterior, e o backend devolvia a reserva já
   * concluída — nada era escrito e a tela ainda assim anunciava sucesso.
   */
  const round = useRef(0);

  const loaded = useMemo(
    () => (candidates.data?.pages ?? []).flatMap((page) => page.candidates),
    [candidates.data],
  );
  const linked = useMemo(() => linkedGoalInvestments(loaded), [loaded]);
  const available = useMemo(() => availableGoalLinkCandidates(loaded), [loaded]);

  const run = async (
    candidate: GoalLinkCandidate,
    call: ReturnType<typeof buildGoalLinkCall>,
    message: string,
  ) => {
    setFailure(undefined);
    setPendingId(candidate.positionId);
    try {
      await mutation.mutateAsync({
        name: call.name,
        nonce: `${intent.nonce}-${round.current}-${call.name}-${candidate.positionId}`,
        payload: call.payload,
      });
      round.current += 1;
      await candidates.refetch();
      onSuccess(message);
    } catch (error) {
      setFailure(simpleInvestmentError(error));
    } finally {
      setPendingId(null);
    }
  };

  const link = (candidate: GoalLinkCandidate) => run(
    candidate,
    buildGoalLinkCall(
      candidate,
      goalId,
      intent.occurredAt(),
      `Vínculo retroativo do investimento à meta ${goalName}.`,
    ),
    candidate.goalId
      ? 'Investimento movido para esta meta.'
      : 'Investimento vinculado à meta.',
  );

  const unlink = (candidate: GoalLinkCandidate) => run(
    candidate,
    buildGoalUnlinkCall(
      candidate,
      goalId,
      intent.occurredAt(),
      `Remoção do investimento da meta ${goalName}.`,
    ),
    'Investimento removido da meta.',
  );

  const busy = mutation.isPending;

  const actionButton = (
    candidate: GoalLinkCandidate,
    label: string,
    tone: string,
    onClick: () => void,
  ) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || !canManage}
      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
    >
      {pendingId === candidate.positionId && busy ? 'Salvando...' : label}
    </button>
  );

  const describe = (candidate: GoalLinkCandidate) => (
    <div className="min-w-0">
      <p className="truncate font-semibold text-gray-800 dark:text-gray-100">{candidate.name}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {formatCurrency(candidate.currentValueCents)}
        {candidate.bucket === 'other_goal' ? ' · já vinculado a outra meta' : ''}
      </p>
    </div>
  );

  return (
    <SimpleModal open={open} onClose={busy ? () => undefined : onClose} title="Investimentos da meta">
      <ErrorBanner message={failure} />

      {!canManage && (
        <p className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          Seu papel neste workspace permite acompanhar a meta, mas não alterar vínculos de investimento.
        </p>
      )}

      {candidates.isLoading && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Carregando investimentos...</p>
      )}

      {candidates.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {simpleInvestmentError(candidates.error)}
        </p>
      )}

      {!candidates.isLoading && !candidates.isError && (
        <div className="space-y-6">
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Nesta meta
            </h3>
            {linked.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Nenhum investimento vinculado a esta meta ainda.
              </p>
            ) : (
              <ul className="space-y-2">
                {linked.map((candidate) => (
                  <li key={candidate.positionId} className={rowClasses}>
                    {describe(candidate)}
                    {actionButton(
                      candidate,
                      'Remover da meta',
                      'bg-white dark:bg-dark-100 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-dark-300',
                      () => unlink(candidate),
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Disponíveis para vincular
            </h3>
            {available.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {candidates.hasNextPage
                  ? 'Nenhum investimento disponível entre os já carregados. Use "Carregar mais" para ver os anteriores.'
                  : 'Nenhum investimento disponível. Use "Novo Aporte" para registrar um novo.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {available.map((candidate) => (
                  <li key={candidate.positionId} className={rowClasses}>
                    {describe(candidate)}
                    {actionButton(
                      candidate,
                      candidate.goalId ? 'Alterar meta' : 'Vincular',
                      'bg-indigo-600 hover:bg-indigo-700 text-white',
                      () => (candidate.goalId ? setConfirming(candidate) : link(candidate)),
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/*
            A lista é paginada: dizer o escopo e oferecer a continuação é o que
            impede a pessoa de ler "não há mais nada" onde só havia o fim da
            primeira página.
          */}
          {candidates.hasNextPage && (
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => candidates.fetchNextPage()}
                disabled={candidates.isFetchingNextPage}
                className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-dark-200 disabled:opacity-50"
              >
                {candidates.isFetchingNextPage ? 'Carregando...' : 'Carregar mais'}
              </button>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Esta lista mostra os investimentos já carregados.
              </p>
            </div>
          )}
        </div>
      )}

      {/*
        Troca de meta nunca é silenciosa: o capital sai do progresso da meta
        anterior no mesmo instante em que entra nesta.
      */}
      {confirming && (
        <div className="mt-6 rounded-xl border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-4">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Mover "{confirming.name}" para {goalName}?
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            O valor deste investimento deixa de contar no progresso da meta atual e passa a contar nesta. O histórico dos dois lados é preservado.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => { const target = confirming; setConfirming(null); link(target); }}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Confirmar troca
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(null)}
              className="rounded-lg border border-amber-300 dark:border-amber-800 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </SimpleModal>
  );
};

export default LinkGoalInvestmentsModal;
