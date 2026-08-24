import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';

import { db } from '../../../lib/firebase';

import { useFinancialIntent } from '../hooks/useIntentNonce';
import {
  backfillInvestmentWorkspace,
  enableInvestmentsV2Flag,
  migrateLegacyInvestments,
  rebuildInvestmentProjections,
  reconcileLegacyMigration,
  rollbackLegacyInvestmentMigration,
  runPaged,
  type OperationResult,
} from '../persistence/operationsApi';
import { Dialog, money, safeError } from './shared';

/**
 * Área operacional do domínio patrimonial (INV-P1-006).
 *
 * Antes desta tela, migração, reconciliação, rollback, habilitação da flag,
 * reconstrução de projeções e backfill **só eram invocáveis por teste de
 * integração**. Não havia procedimento executável para colocar um workspace
 * legado em produção, nem para reverter — e o relatório chegava a pedir uma
 * reconstrução que nenhum controle disparava.
 *
 * Decisões de desenho, todas ditadas por serem operações de efeito amplo:
 *
 * - **owner apenas**. O backend já restringe pela matriz de papéis; a tela não
 *   é oferecida a quem não pode executá-la, para não expor um caminho que
 *   termina em recusa;
 * - **impacto antes da confirmação**. Cada ação declara o que faz, o que
 *   preserva e o que não é reversível, no diálogo de confirmação;
 * - **motivo obrigatório**. Vai para a trilha de auditoria do backend junto
 *   com ator, correlação e resultado;
 * - **paginação visível**. As operações são retomáveis por página; a tela
 *   repagina até concluir e mostra o progresso, em vez de parecer travada;
 * - **sem duplo submit**. Uma operação por vez, com a intenção estável de
 *   INV-P1-004 — repetir um clique é replay, não uma segunda execução.
 */

interface Props {
  workspaceId: string;
  isOwner: boolean;
  investmentsV2Enabled: boolean;
}

/**
 * Existe histórico legado de investimento neste workspace?
 *
 * Consulta com `limit(1)`: a resposta é booleana, e ler a coleção inteira só
 * para saber se ela tem ao menos uma linha é exatamente o padrão de custo que
 * o domínio combate.
 */
const useHasLegacyInvestments = (workspaceId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['legacy-investments-presence', workspaceId],
    enabled,
    queryFn: async () => {
      const snapshot = await getDocs(query(
        collection(db, 'workspaces', workspaceId, 'transactions'),
        where('type', '==', 'investimento'),
        limit(1),
      ));
      return !snapshot.empty;
    },
  });

type Action =
  | 'migration-dry-run'
  | 'migration-apply'
  | 'reconcile'
  | 'enable-flag'
  | 'rollback'
  | 'rebuild'
  | 'backfill';

interface ActionSpec {
  id: Action;
  title: string;
  summary: string;
  impact: string[];
  danger?: boolean;
  needsMigrationId?: boolean;
  confirmLabel: string;
}

const ACTIONS: ActionSpec[] = [
  {
    id: 'migration-dry-run',
    title: 'Simular migração do histórico legado',
    summary:
      'Varre as transações de investimento e calcula o que seria migrado, sem gravar nada no domínio patrimonial.',
    impact: [
      'Nenhum movimento, posição ou projeção é criado.',
      'A flag de investimentos não é alterada.',
      'O lote de simulação é separado do lote de aplicação: simular não bloqueia migrar.',
    ],
    confirmLabel: 'Simular migração',
  },
  {
    id: 'migration-apply',
    title: 'Aplicar migração do histórico legado',
    summary:
      'Cria os movimentos do domínio patrimonial a partir das transações legadas de investimento, em ordem cronológica.',
    impact: [
      'Cria movimentos, posições, série mensal e cortes de alocação.',
      'Não cria espelho de caixa: as transações legadas continuam sendo o registro de caixa.',
      'Nenhuma transação legada é alterada ou apagada.',
      'É retomável e idempotente: repetir não duplica.',
    ],
    confirmLabel: 'Aplicar migração',
  },
  {
    id: 'reconcile',
    title: 'Conferir reconciliação',
    summary:
      'Compara o principal e o resultado realizado do histórico legado com os do domínio patrimonial, em centavos.',
    impact: ['Somente leitura. Nada é gravado.'],
    confirmLabel: 'Conferir agora',
  },
  {
    id: 'enable-flag',
    title: 'Habilitar o domínio patrimonial (flag V2)',
    summary:
      'Passa a fonte oficial de patrimônio, relatórios e alocação para o domínio patrimonial.',
    impact: [
      'Exige migração aplicada e concluída quando houver histórico legado.',
      'Exige reconciliação fechada em centavos.',
      'Fecha a trilha legada: novas transações de investimento passam a ser recusadas.',
      'Reversível pelo rollback, que também desliga a flag.',
    ],
    confirmLabel: 'Habilitar domínio patrimonial',
  },
  {
    id: 'rollback',
    title: 'Reverter a migração aplicada',
    summary:
      'Emite um movimento compensatório para cada movimento criado pela migração e desliga a flag.',
    impact: [
      'Nada é apagado: cada movimento migrado ganha um estorno vinculado.',
      'Posições, patrimônio, série mensal e progresso de metas voltam ao estado anterior à migração.',
      'A flag é desligada e o produto volta a ler o histórico legado.',
      'Libera uma nova tentativa: é possível migrar de novo depois.',
    ],
    danger: true,
    needsMigrationId: true,
    confirmLabel: 'Reverter migração',
  },
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
    confirmLabel: 'Reconstruir projeções',
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
    confirmLabel: 'Recalcular',
  },
];

const RESULT_LABELS: Record<string, string> = {
  scanned: 'Linhas varridas',
  migrated: 'Movimentos criados',
  alreadyMigrated: 'Já migrados',
  reversedCount: 'Compensações emitidas',
  processedPositions: 'Posições processadas',
  processedMovements: 'Movimentos processados',
  processedValuations: 'Valorações processadas',
  publishedCount: 'Projeções publicadas',
  prunedCount: 'Faixas de alocação podadas',
  prunedPeriodCount: 'Períodos podados',
  restartCount: 'Reinícios por escrita concorrente',
  attempt: 'Tentativa de migração',
  processedCount: 'Registros processados',
};

const CENTS_KEYS = new Set([
  'legacyPrincipalCents',
  'domainPrincipalCents',
  'legacyRealizedGainCents',
  'domainRealizedGainCents',
]);

const CENTS_LABELS: Record<string, string> = {
  legacyPrincipalCents: 'Principal no histórico legado',
  domainPrincipalCents: 'Principal no domínio patrimonial',
  legacyRealizedGainCents: 'Resultado realizado no legado',
  domainRealizedGainCents: 'Resultado realizado no domínio',
};

export const InvestmentOperationsPanel: React.FC<Props> = ({
  workspaceId, isOwner, investmentsV2Enabled,
}) => {
  const client = useQueryClient();
  const legacyPresence = useHasLegacyInvestments(workspaceId, isOwner);
  const hasLegacyInvestments = legacyPresence.data === true;
  const [pending, setPending] = useState<ActionSpec | null>(null);
  const [reason, setReason] = useState('');
  const [migrationId, setMigrationId] = useState('');
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [result, setResult] = useState<OperationResult | null>(null);

  const intent = useFinancialIntent(pending ? `ops:${pending.id}` : null);

  const closeDialog = () => {
    setPending(null);
    setReason('');
    setMigrationId('');
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

      switch (action.id) {
        case 'migration-dry-run':
          return runPaged(
            () => migrateLegacyInvestments({
              workspaceId, nonce, dryRun: true, reason: trimmedReason,
            }),
            onProgress,
          );
        case 'migration-apply':
          return runPaged(
            () => migrateLegacyInvestments({
              workspaceId, nonce, dryRun: false, reason: trimmedReason,
            }),
            onProgress,
          );
        case 'reconcile':
          return reconcileLegacyMigration(workspaceId, nonce);
        case 'enable-flag':
          return enableInvestmentsV2Flag(workspaceId, nonce, trimmedReason);
        case 'rollback':
          return runPaged(
            () => rollbackLegacyInvestmentMigration(
              workspaceId, nonce, migrationId.trim(), trimmedReason,
            ),
            onProgress,
          );
        case 'rebuild':
          return runPaged(
            () => rebuildInvestmentProjections(workspaceId, nonce, trimmedReason),
            onProgress,
          );
        case 'backfill':
          return runPaged(
            () => backfillInvestmentWorkspace(workspaceId, nonce, trimmedReason),
            onProgress,
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
        client.invalidateQueries({ queryKey: ['workspaces'] }),
      ]);
    },
    onError: (error) => {
      setResult(null);
      setNotice({ tone: 'error', text: safeError(error) });
      setProgress('');
    },
  });

  if (!isOwner) return null;

  const reasonValid = reason.trim().length >= 3;
  const migrationIdValid = !pending?.needsMigrationId || migrationId.trim().length > 0;
  const canConfirm = reasonValid && migrationIdValid && !mutation.isPending;

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
          Ações administrativas de efeito amplo, restritas ao proprietário do workspace.
          Cada uma exige confirmação e registra o motivo na trilha de auditoria.
        </p>
        <p className="mt-2 text-sm">
          <strong>Estado atual:</strong>{' '}
          {investmentsV2Enabled
            ? 'domínio patrimonial habilitado (flag V2 ligada).'
            : 'domínio patrimonial desligado — o produto lê o histórico legado.'}
          {hasLegacyInvestments
            ? ' Há histórico legado de investimentos neste workspace.'
            : ' Nenhum histórico legado de investimentos encontrado.'}
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
        {ACTIONS.map((action) => (
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
              if (key === 'reconciliation' && value && typeof value === 'object') {
                return Object.entries(value as Record<string, unknown>).map(
                  ([innerKey, innerValue]) => (
                    <div key={`rec-${innerKey}`} className="text-sm">
                      <dt className="text-muted">
                        {CENTS_LABELS[innerKey] ?? RESULT_LABELS[innerKey] ?? innerKey}
                      </dt>
                      <dd className="font-semibold">
                        {CENTS_KEYS.has(innerKey)
                          ? money(Number(innerValue))
                          : String(innerValue)}
                      </dd>
                    </div>
                  ),
                );
              }
              if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
                return [];
              }
              const label = RESULT_LABELS[key];
              if (!label) return [];
              return [(
                <div key={key} className="text-sm">
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-semibold">{String(value)}</dd>
                </div>
              )];
            })}
          </dl>
          {typeof result.migrationId === 'string' && (
            <p className="mt-3 text-xs text-muted">
              Identificador do lote: <code>{result.migrationId}</code>
            </p>
          )}
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

            {pending.needsMigrationId && (
              <label className="grid gap-1 text-sm font-medium">
                Identificador do lote de migração
                <input
                  value={migrationId}
                  onChange={(event) => setMigrationId(event.target.value)}
                  required
                  className="rounded-lg border border-border bg-surface px-3 py-2"
                />
                <span className="text-xs font-normal text-muted">
                  Aparece no resultado da migração aplicada e no conferidor de reconciliação.
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
