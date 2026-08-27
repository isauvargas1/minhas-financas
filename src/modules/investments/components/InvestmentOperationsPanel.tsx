import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';

import { auth, db } from '../../../lib/firebase';

import { useFinancialIntent } from '../hooks/useIntentNonce';
import {
  backfillInvestmentWorkspace,
  noMorePages,
  pagedRunIds,
  rebuildCashPeriods,
  rebuildInvestmentProjections,
  recalculateGoalInvestmentProgress,
  runPaged,
  type OperationResult,
} from '../persistence/operationsApi';
import { listGoals } from '../../goals/api';
import { Dialog, money, safeError } from './shared';

/**
 * Área operacional do domínio patrimonial (INV-P1-006).
 *
 * Antes desta tela, reconstrução de projeções e backfill **só eram invocáveis por teste de
 * integração**. Não havia procedimento executável para colocar um workspace
 * legado em produção, nem para reverter — e o relatório chegava a pedir uma
 * reconstrução que nenhum controle disparava.
 *
 * Decisões de desenho, todas ditadas por serem operações de efeito amplo:
 *
 * - **papel por ação, igual ao backend**. Migração, reversão e habilitação da
 *   flag trocam a fonte oficial de patrimônio do workspace e seguem restritas
 *   ao proprietário. As reconstruções de progresso de meta são corretivas e o
 *   backend as aceita para `owner` e `admin`; a tela passa a oferecê-las aos
 *   mesmos papéis, em vez de ser mais restritiva que a regra e deixar o
 *   administrador sem caminho executável. Quem não pode executar ação nenhuma
 *   não vê a área, para não expor um caminho que termina em recusa;
 * - **impacto antes da confirmação**. Cada ação declara o que faz, o que
 *   preserva e o que não é reversível, no diálogo de confirmação;
 * - **motivo obrigatório**. Vai para a trilha de auditoria do backend junto
 *   com ator, correlação e resultado;
 * - **paginação visível**. As operações são retomáveis por página; a tela
 *   repagina até concluir e mostra o progresso, em vez de parecer travada;
 * - **sem duplo submit**. Uma operação por vez, com a intenção estável de
 *   INV-P1-004 — repetir um clique é replay, não uma segunda execução.
 */

type OperatorRole = 'owner' | 'admin';

interface Props {
  workspaceId: string;
  /**
   * Papel do espelho de leitura (`users/{uid}/workspaces/{id}.role`).
   *
   * É a checagem barata, usada só para não disparar a consulta autoritativa
   * quando o papel espelhado já exclui a operação. Quem decide é
   * `useAuthoritativeRole`.
   */
  myRole?: string;
}

/**
 * Papel autoritativo do usuário no workspace.
 *
 * `activeWorkspace.myRole` pode vir de `users/{uid}/workspaces/{id}.role`, que
 * é um **espelho de leitura** que o próprio usuário escreve. A fonte de
 * verdade é `workspaces/{id}/members/{uid}`, onde as Rules impedem
 * autopromoção. O backend recusa a operação de qualquer forma; o que esta
 * verificação evita é oferecer na tela um caminho que termina em recusa —
 * e sugerir a quem não pode operar que poderia.
 */
const useAuthoritativeRole = (workspaceId: string) =>
  useQuery({
    queryKey: ['workspace-authoritative-role', workspaceId],
    enabled: workspaceId.length > 0,
    queryFn: async (): Promise<OperatorRole | null> => {
      const uid = auth.currentUser?.uid;
      if (!uid) return null;
      const [membership, workspace] = await Promise.all([
        getDoc(doc(db, 'workspaces', workspaceId, 'members', uid)),
        getDoc(doc(db, 'workspaces', workspaceId)),
      ]);
      if (workspace.data()?.ownerId === uid) return 'owner';
      const role = membership.data()?.role;
      if (role === 'owner') return 'owner';
      if (role === 'admin') return 'admin';
      return null;
    },
  });

type Action =
  | 'rebuild'
  | 'backfill'
  | 'rebuild-cash'
  | 'goal-rebuild-investments';

const OWNER_ONLY: OperatorRole[] = ['owner'];
const OWNER_OR_ADMIN: OperatorRole[] = ['owner', 'admin'];

interface ActionSpec {
  id: Action;
  title: string;
  summary: string;
  impact: string[];
  danger?: boolean;
  /** Exige escolher a meta alvo antes de confirmar. */
  needsGoal?: boolean;
  /**
   * Papéis que podem executar — o mesmo conjunto que o backend aceita.
   *
   * A reconstrução de projeções e o backfill percorrem o workspace inteiro e
   * ficam restritos ao proprietário. A reconstrução de progresso de meta é
   * corretiva, não muda fonte de verdade e é aceita pelo backend para
   * `owner` e `admin`
   * (`INVESTMENT_BACKEND_WRITE_PLANS.recalculateGoalInvestmentProgress`) — a
   * tela passa a refletir isso em vez de ser mais restritiva que a regra.
   */
  roles: OperatorRole[];
  confirmLabel: string;
}

const ACTIONS: ActionSpec[] = [
  {
    id: 'rebuild',
    title: 'Reconstruir projeções',
    summary:
      'Recalcula resumo, série mensal e cortes de alocação a partir dos fatos: movimentos e valorações.',
    impact: [
      'Publica valores absolutos calculados do zero, não incrementos.',
      'Corrige deriva entre os acumuladores e o histórico de fatos.',
      'Poda períodos e faixas de alocação sem lastro no histórico.',
      'Nenhum movimento ou valoração é alterado.',
    ],
    roles: OWNER_ONLY,
    confirmLabel: 'Reconstruir projeções',
  },
  {
    id: 'rebuild-cash',
    title: 'Reconstruir o fluxo de caixa mensal',
    summary:
      'Recalcula a projeção mensal de caixa do workspace a partir das transações.',
    impact: [
      'A projeção é o que substitui a leitura da coleção inteira de transações no saldo acumulado.',
      'Publica valores absolutos e zera meses sem lastro nas transações.',
      'Nenhuma transação é alterada.',
      'É o backfill para históricos anteriores à projeção.',
    ],
    roles: OWNER_ONLY,
    confirmLabel: 'Reconstruir fluxo de caixa',
  },
  {
    id: 'backfill',
    title: 'Recalcular posições e metas',
    summary:
      'Percorre as posições e as metas do workspace recalculando cada uma a partir do histórico de movimentos.',
    impact: [
      'Recalcula posição por posição e meta por meta, sem alterar fatos.',
      'É retomável por página e idempotente.',
    ],
    roles: OWNER_ONLY,
    confirmLabel: 'Recalcular',
  },
  {
    id: 'goal-rebuild-investments',
    title: 'Recalcular o progresso patrimonial de uma meta',
    summary:
      'Recalcula o valor investido e o valor de mercado que a meta acumula, a partir das posições vinculadas a ela.',
    impact: [
      'Publica valor absoluto das posições vinculadas, calculado do zero.',
      'Corrige deriva entre o progresso publicado na meta e as posições do domínio patrimonial.',
      'Nenhum movimento, valoração ou posição é alterado.',
      'É retomável por página e idempotente.',
    ],
    needsGoal: true,
    roles: OWNER_OR_ADMIN,
    confirmLabel: 'Recalcular progresso patrimonial',
  },
];

const RESULT_LABELS: Record<string, string> = {
  processedPositions: 'Posições processadas',
  processedMovements: 'Movimentos processados',
  processedValuations: 'Valorações processadas',
  publishedCount: 'Projeções publicadas',
  prunedCount: 'Faixas de alocação podadas',
  prunedPeriodCount: 'Períodos podados',
  restartCount: 'Reinícios por escrita concorrente',
  processedCount: 'Registros processados',
  periods: 'Meses reconstruídos',
  goalId: 'Meta',
  pageProcessedCount: 'Posições nesta página',
};

/**
 * Chaves cujo valor vem em centavos e precisa de formatação monetária.
 *
 * São as grandezas que o recálculo de progresso patrimonial de meta publica.
 */
const CENTS_KEYS = new Set([
  'netContributionCents',
  'currentValueCents',
]);

const CENTS_LABELS: Record<string, string> = {
  netContributionCents: 'Valor investido na meta',
  currentValueCents: 'Valor de mercado na meta',
};

export const InvestmentOperationsPanel: React.FC<Props> = ({
  workspaceId, myRole,
}) => {
  const client = useQueryClient();
  // O espelho é a checagem barata; a de membership é a que vale.
  const mirrorAllows = myRole === 'owner' || myRole === 'admin';
  const authoritative = useAuthoritativeRole(workspaceId);
  const role = mirrorAllows ? authoritative.data ?? null : null;
  const canOperate = role !== null;
  const [pending, setPending] = useState<ActionSpec | null>(null);
  const [reason, setReason] = useState('');
  const [goalId, setGoalId] = useState('');
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [result, setResult] = useState<OperationResult | null>(null);

  const intent = useFinancialIntent(pending ? `ops:${pending.id}` : null);

  /*
   * Metas do workspace, carregadas só quando há uma ação de meta para operar.
   *
   * `listGoals` já é a consulta do produto: filtro de arquivadas no servidor,
   * ordem determinística e `limit` — não é uma leitura nova nem uma varredura.
   */
  const needsGoalPicker = pending?.needsGoal === true;
  const goals = useQuery({
    queryKey: ['goals', workspaceId],
    enabled: canOperate && needsGoalPicker,
    queryFn: () => listGoals(workspaceId),
  });

  const closeDialog = () => {
    setPending(null);
    setReason('');
    setGoalId('');
    setProgress('');
  };

  const mutation = useMutation({
    mutationFn: async (action: ActionSpec): Promise<OperationResult> => {
      const nonce = intent.nonce;
      const trimmedReason = reason.trim();
      const onProgress = (index: number, page: OperationResult) => {
        setProgress(
          `Página ${index + 1}${page.phase ? ` · etapa ${String(page.phase)}` : ''}`,
        );
      };

      /*
       * Identidade da execução paginada (ver `pagedRunIds`).
       *
       * `ids(index)` dá correlação estável na execução inteira e chave nova
       * por página. `carryBatchId` guarda o identificador do lote que a
       * primeira página devolve e o reenvia nas seguintes: sem ele, o backend
       * derivaria um lote novo a cada página e nenhuma execução com mais de
       * uma página chegaria ao fim.
       */
      const ids = pagedRunIds(action.id, nonce);
      let batchId: string | undefined;
      const carryBatchId = (field: string) => (page: OperationResult) => {
        const value = page[field];
        if (typeof value === 'string' && value.length > 0) batchId = value;
        return page;
      };

      switch (action.id) {
        case 'rebuild':
          return runPaged(
            (index) => rebuildInvestmentProjections(
              workspaceId, nonce, trimmedReason, 50, batchId, ids(index),
            ).then(carryBatchId('rebuildId')),
            onProgress,
          );
        case 'backfill':
          return runPaged(
            (index) => backfillInvestmentWorkspace(
              workspaceId, nonce, trimmedReason, 20, batchId, ids(index),
            ).then(carryBatchId('backfillId')),
            onProgress,
          );
        case 'rebuild-cash':
          // Sem lote próprio: o checkpoint é um documento fixo por workspace,
          // e a rotina não reserva idempotência.
          return runPaged(
            (index) => rebuildCashPeriods(workspaceId, `${nonce}:p${index}`, trimmedReason),
            onProgress,
          );
        case 'goal-rebuild-investments':
          // Devolve `hasMore`, não `completed` — o critério é explícito.
          return runPaged(
            (index) => recalculateGoalInvestmentProgress(
              workspaceId, nonce, goalId.trim(), trimmedReason, 50, batchId, ids(index),
            ).then(carryBatchId('rebuildId')),
            onProgress,
            500,
            noMorePages,
          );
        default:
          throw new Error('Operação desconhecida.');
      }
    },
    onSuccess: async (data, action) => {
      setResult(data);
      setNotice({ tone: 'ok', text: `${action.title}: concluída com sucesso.` });
      closeDialog();
      await Promise.all([
        client.invalidateQueries({ queryKey: ['investment-summary', workspaceId] }),
        client.invalidateQueries({ queryKey: ['investment-positions', workspaceId] }),
        client.invalidateQueries({ queryKey: ['investment-movements', workspaceId] }),
        client.invalidateQueries({ queryKey: ['goals', workspaceId] }),
        client.invalidateQueries({ queryKey: ['workspaces'] }),
      ]);
    },
    onError: (error) => {
      setResult(null);
      setNotice({ tone: 'error', text: safeError(error) });
      setProgress('');
    },
  });

  if (!canOperate) return null;

  const visibleActions = ACTIONS.filter((action) => action.roles.includes(role));
  if (visibleActions.length === 0) return null;

  const reasonValid = reason.trim().length >= 3;
  const goalValid = !pending?.needsGoal || goalId.trim().length > 0;
  const canConfirm = reasonValid && goalValid && !mutation.isPending;

  return (
    <section
      aria-labelledby="investment-operations-title"
      className="rounded-2xl border border-border bg-surface p-5"
    >
      <div className="mb-4">
        <h2 id="investment-operations-title" className="text-lg font-bold text-on-surface">
          Operação do domínio patrimonial
        </h2>
        <p className="mt-1 text-sm text-muted">
          {role === 'owner'
            ? 'Ações administrativas de efeito amplo, restritas ao proprietário do workspace. Cada uma exige confirmação e registra o motivo na trilha de auditoria.'
            : 'Ações corretivas disponíveis para administradores. Cada uma exige confirmação e registra o motivo na trilha de auditoria. A reconstrução de projeções e o backfill são restritos ao proprietário.'}
        </p>
      </div>

      {notice && (
        <p
          role={notice.tone === 'ok' ? 'status' : 'alert'}
          className={`mb-4 rounded-lg p-3 text-sm ${
            notice.tone === 'ok'
              ? 'bg-green-50 text-green-900'
              : 'bg-red-50 text-red-900'
          }`}
        >
          {notice.text}
        </p>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {visibleActions.map((action) => (
          <li
            key={action.id}
            className="flex flex-col justify-between gap-3 rounded-xl border border-border p-4"
          >
            <div>
              <h3 className="font-semibold text-on-surface">{action.title}</h3>
              <p className="mt-1 text-sm text-muted">{action.summary}</p>
            </div>
            <button
              type="button"
              onClick={() => { setPending(action); setNotice(null); setResult(null); }}
              disabled={mutation.isPending}
              className={`self-start rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-60 ${
                action.danger
                  ? 'bg-red-700 text-white'
                  : 'border border-border text-on-surface'
              }`}
            >
              {action.confirmLabel}
            </button>
          </li>
        ))}
      </ul>

      {result && (
        <div className="mt-5 rounded-xl border border-border p-4">
          <h3 className="font-semibold text-on-surface">Resultado da última operação</h3>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {Object.entries(result).flatMap(([key, value]) => {
              if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
                return [];
              }
              const label = CENTS_LABELS[key] ?? RESULT_LABELS[key];
              if (!label) return [];
              return [(
                <div key={key} className="text-sm">
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-semibold">
                    {CENTS_KEYS.has(key) ? money(Number(value)) : String(value)}
                  </dd>
                </div>
              )];
            })}
          </dl>
        </div>
      )}

      <Dialog title={pending?.title ?? ''} open={pending !== null} onClose={closeDialog}>
        {pending && (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canConfirm) return;
              mutation.mutate(pending);
            }}
          >
            <p className="text-sm text-on-surface">{pending.summary}</p>
            <div>
              <p className="text-sm font-semibold text-on-surface">O que esta ação faz:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
                {pending.impact.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>

            {pending.needsGoal && (
              <label className="grid gap-1 text-sm font-medium">
                Meta
                <select
                  value={goalId}
                  onChange={(event) => setGoalId(event.target.value)}
                  required
                  className="rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <option value="">
                    {goals.isLoading ? 'Carregando metas…' : 'Selecione a meta'}
                  </option>
                  {(goals.data ?? []).map((goal) => (
                    <option key={goal.id} value={goal.id}>{goal.name}</option>
                  ))}
                </select>
                <span className="text-xs font-normal text-muted">
                  {goals.isError
                    ? 'Não foi possível carregar as metas. Feche e tente novamente.'
                    : (goals.data ?? []).length === 0 && !goals.isLoading
                      ? 'Nenhuma meta ativa neste workspace.'
                      : 'A operação recalcula somente a meta escolhida.'}
                </span>
              </label>
            )}

            <label className="grid gap-1 text-sm font-medium">
              Motivo
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={3}
                required
                className="rounded-lg border border-border bg-surface px-3 py-2"
              />
              <span className="text-xs font-normal text-muted">
                Fica registrado na auditoria junto com quem executou e quando.
              </span>
            </label>

            {mutation.isPending && (
              <p role="status" className="text-sm text-muted">
                Executando… {progress}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={!canConfirm}
                className={`rounded-xl px-4 py-2.5 font-bold disabled:opacity-60 ${
                  pending.danger ? 'bg-red-700 text-white' : 'bg-primary text-on-primary'
                }`}
              >
                {mutation.isPending ? 'Executando…' : pending.confirmLabel}
              </button>
              <button
                type="button"
                onClick={closeDialog}
                disabled={mutation.isPending}
                className="rounded-xl border border-border px-4 py-2.5 font-semibold disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
};

export default InvestmentOperationsPanel;
