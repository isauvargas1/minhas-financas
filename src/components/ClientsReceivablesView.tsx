import React, { useMemo, useState } from 'react';

import { useAuth } from '../contexts/AuthContext.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import {
  useArchiveClient,
  useCancelReceivable,
  useClientNames,
  useClientPrivateList,
  useClients,
  useClientsIntentKey,
  useOpenReceivablesOfClient,
  useReceivableTotals,
  useReceivables,
  useReverseReceivableReceipt,
} from '../modules/clients/hooks.ts';
import { formatCents, formatDayKey, saoPauloToday } from '../modules/loans/money.ts';
import {
  toArchiveClientPayload,
  toCancelReceivablePayload,
  toReverseReceiptPayload,
} from '../modules/clients/payloads.ts';
import {
  ARCHIVE_EXPLANATION,
  CANCEL_WITH_RECEIPTS_HINT,
  RECEIVABLE_STATUS_BADGE,
  RECEIVABLE_STATUS_LABELS,
  clientPermissions,
  clientsErrorView,
  formatDocument,
  isReceivableOverdue,
  movementSummary,
  receivableDisplayStatus,
  receivablePermissions,
} from '../modules/clients/presentation.ts';
import type { Client, Receivable, ReceivableMovement } from '../modules/clients/types.ts';
import ClientFormModal from './ClientFormModal.tsx';
import ReceivableFormModal from './ReceivableFormModal.tsx';
import ClientsConfirmModal from './clients/ClientsConfirmModal.tsx';
import { ClientsNotice } from './clients/ClientsDialog.tsx';
import ReceiptModal from './clients/ReceiptModal.tsx';
import ReceivableHistoryModal from './clients/ReceivableHistoryModal.tsx';
import {
  ArchiveIcon,
  CheckIcon,
  CloseIcon,
  CurrencyDollarIcon,
  EditIcon,
  FileInvoiceIcon,
  HistoryIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
  WarningIcon,
} from './Icons.tsx';

/**
 * Clientes & Recebíveis (D-24, D-39, P3-I).
 *
 * Só lê (páginas, agregados do servidor) e chama callables; nenhuma escrita
 * direta no Firestore. Dados pessoais dos clientes só são pedidos para owner e
 * admin. "Em atraso" é derivado pela data civil de São Paulo, nunca gravado.
 * Os diálogos guardam o registro como estava ao abrir: o reenvio da mesma
 * intenção usa a mesma chave e não duplica efeito.
 */
type DialogState =
  | null
  | { kind: 'client-form'; client: Client | null }
  | { kind: 'archive'; client: Client }
  | { kind: 'receivable-form'; receivable: Receivable | null }
  | { kind: 'receipt'; receivable: Receivable }
  | { kind: 'history'; receivable: Receivable }
  | { kind: 'reverse'; receivable: Receivable; movement: ReceivableMovement }
  | { kind: 'cancel'; receivable: Receivable };

const ACTION_ROW = 'flex justify-end gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity';

const ClientsReceivablesView: React.FC = () => {
  const { activeWorkspace, activeWorkspaceRole } = useWorkspace();
  const { user } = useAuth();
  const { playSound } = useTheme();
  const permissions = clientPermissions(activeWorkspaceRole);
  const actor = { role: activeWorkspaceRole, uid: user?.uid };

  const clientsQuery = useClients();
  const receivablesQuery = useReceivables();
  const totals = useReceivableTotals();
  const clients = clientsQuery.data;
  const receivables = receivablesQuery.data;
  const referencedClientIds = useMemo(
    () => (receivables ?? []).map((receivable) => receivable.clientId),
    [receivables],
  );
  const clientsById = useClientNames(clients, referencedClientIds);
  const listedClientIds = useMemo(() => (clients ?? []).map((client) => client.id), [clients]);
  const privateQuery = useClientPrivateList(permissions.canSeePrivateData ? listedClientIds : []);
  const privateById = useMemo(
    () => new Map((privateQuery.data ?? []).map((personal) => [personal.clientId, personal])),
    [privateQuery.data],
  );

  const [activeTab, setActiveTab] = useState<'clients' | 'receivables'>('receivables');
  const [searchQuery, setSearchQuery] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const today = saoPauloToday();

  const archiveMutation = useArchiveClient();
  const cancelMutation = useCancelReceivable();
  const reverseMutation = useReverseReceivableReceipt();
  const archiveIntent = useClientsIntentKey();
  const cancelIntent = useClientsIntentKey();
  const reverseIntent = useClientsIntentKey();
  const archiveTarget = dialog?.kind === 'archive' ? dialog.client : null;
  const openOfArchiveTarget = useOpenReceivablesOfClient(archiveTarget?.id ?? null);

  const open = (next: Exclude<DialogState, null>) => {
    setNotice(null);
    if (next.kind === 'archive') archiveIntent.reset();
    if (next.kind === 'cancel') cancelIntent.reset();
    if (next.kind === 'reverse') reverseIntent.reset();
    setDialog(next);
  };
  const close = () => setDialog(null);
  const done = (message: string) => {
    setDialog(null);
    setNotice(message);
    playSound('success');
  };

  // -- Filter Logic --
  const filteredClients = useMemo(() => {
    if (!clients) return [];
    const term = searchQuery.toLowerCase();
    return clients.filter((client) =>
      client.name.toLowerCase().includes(term) ||
      Boolean(privateById.get(client.id)?.email?.toLowerCase().includes(term)));
  }, [clients, privateById, searchQuery]);

  const filteredReceivables = useMemo(() => {
    if (!receivables) return [];
    const term = searchQuery.toLowerCase();
    return receivables.filter((receivable) => receivable.description.toLowerCase().includes(term));
  }, [receivables, searchQuery]);

  const clientName = (id: string) => clientsById.get(id)?.name ?? 'Cliente';
  const summaryValue = (cents: number | undefined) =>
    totals.data && cents !== undefined ? formatCents(cents) : '—';

  // -- Operações com confirmação --
  const archive = async (): Promise<string | null> => {
    if (dialog?.kind !== 'archive') return null;
    try {
      const payload = toArchiveClientPayload(activeWorkspace.id, dialog.client);
      await archiveMutation.mutateAsync({ payload, idempotencyKey: archiveIntent.keyFor('archiveClient', payload) });
      done('Cliente arquivado. O histórico dos recebíveis foi preservado.');
      return null;
    } catch (failure) {
      return clientsErrorView(failure).message;
    }
  };

  const cancel = async (reason: string): Promise<string | null> => {
    if (dialog?.kind !== 'cancel') return null;
    try {
      const payload = toCancelReceivablePayload({
        workspaceId: activeWorkspace.id, receivable: dialog.receivable, reason,
      });
      await cancelMutation.mutateAsync({ payload, idempotencyKey: cancelIntent.keyFor('cancelReceivable', payload) });
      done('Recebível cancelado. O histórico foi preservado.');
      return null;
    } catch (failure) {
      return clientsErrorView(failure).message;
    }
  };

  const reverse = async (reason: string): Promise<string | null> => {
    if (dialog?.kind !== 'reverse') return null;
    try {
      const payload = toReverseReceiptPayload({
        workspaceId: activeWorkspace.id, receivable: dialog.receivable, movement: dialog.movement, reason,
      });
      await reverseMutation.mutateAsync({
        payload, idempotencyKey: reverseIntent.keyFor('reverseReceivableReceipt', payload),
      });
      done('Estorno registrado. O saldo e o caixa foram recompostos.');
      return null;
    } catch (failure) {
      return clientsErrorView(failure).message;
    }
  };

  const openReceivablesCount = openOfArchiveTarget.data ?? 0;
  const archiveBlocked = openReceivablesCount > 0
    ? `Este cliente tem ${openReceivablesCount} ${openReceivablesCount === 1 ? 'recebível' : 'recebíveis'} em aberto. ` +
      'Receba ou cancele antes de arquivar.'
    : null;

  const showNewButton = activeTab === 'clients' ? permissions.canManageClients : permissions.canCreateReceivable;

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 flex-shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-on-surface flex items-center gap-2">
            <UsersIcon className="h-6 w-6 text-primary" />
            Clientes & Recebíveis
          </h2>
          <p className="text-sm text-muted">Gestão de cobranças e carteira de clientes</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <input
              type="text"
              placeholder="Buscar..."
              aria-label="Buscar"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-surface border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none text-on-surface"
            />
            <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
          </div>
          {showNewButton && (
            <button
              onClick={() => {
                if (activeTab === 'clients') open({ kind: 'client-form', client: null });
                else open({ kind: 'receivable-form', receivable: null });
              }}
              className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm transition-colors whitespace-nowrap"
            >
              <PlusIcon className="w-4 h-4" />
              {activeTab === 'clients' ? 'Novo Cliente' : 'Novo Recebível'}
            </button>
          )}
        </div>
      </div>

      <ClientsNotice message={notice} />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 flex-shrink-0">
        <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 rounded-lg">
            <FileInvoiceIcon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-muted uppercase">Total a Receber</p>
            <p className="text-xl font-bold text-on-surface" data-testid="receivables-total-open">{summaryValue(totals.data?.openCents)}</p>
          </div>
        </div>
        <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
          <div className="p-3 bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg">
            <WarningIcon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-muted uppercase">Em Atraso</p>
            <p className="text-xl font-bold text-red-600 dark:text-red-400" data-testid="receivables-total-overdue">{summaryValue(totals.data?.overdueCents)}</p>
          </div>
        </div>
        <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
          <div className="p-3 bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400 rounded-lg">
            <CurrencyDollarIcon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-muted uppercase">Próximos 7 Dias</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="receivables-total-upcoming">{summaryValue(totals.data?.upcomingCents)}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border mb-4 flex-shrink-0">
        <button
          onClick={() => setActiveTab('receivables')}
          aria-pressed={activeTab === 'receivables'}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'receivables' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-on-surface'}`}
        >
          <FileInvoiceIcon className="h-4 w-4" /> Recebíveis
        </button>
        <button
          onClick={() => setActiveTab('clients')}
          aria-pressed={activeTab === 'clients'}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'clients' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-on-surface'}`}
        >
          <UsersIcon className="h-4 w-4" /> Clientes
        </button>
      </div>

      {/* Content List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface border border-border rounded-xl shadow-sm">
        {activeTab === 'receivables' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-background text-muted uppercase font-bold text-xs border-b border-border sticky top-0">
                <tr>
                  <th className="px-6 py-3">Descrição</th>
                  <th className="px-6 py-3">Cliente</th>
                  <th className="px-6 py-3">Vencimento</th>
                  <th className="px-6 py-3 text-right">Valor</th>
                  <th className="px-6 py-3 text-right">Saldo</th>
                  <th className="px-6 py-3 text-center">Status</th>
                  <th className="px-6 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {receivablesQuery.isLoading ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted">Carregando...</td></tr>
                ) : receivablesQuery.isError ? (
                  <tr><td colSpan={7} className="p-8 text-center text-error" role="alert">Não foi possível carregar os recebíveis.</td></tr>
                ) : filteredReceivables.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted">Nenhum recebível encontrado.</td></tr>
                ) : (
                  filteredReceivables.map((receivable) => {
                    const display = receivableDisplayStatus(receivable, today);
                    const can = receivablePermissions(actor, receivable);
                    return (
                      <tr key={receivable.id} className="hover:bg-background/50 transition-colors group">
                        <td className="px-6 py-3 font-medium text-on-surface">{receivable.description}</td>
                        <td className="px-6 py-3 text-on-surface">{clientName(receivable.clientId)}</td>
                        <td className={`px-6 py-3 ${isReceivableOverdue(receivable, today) ? 'text-red-500 font-medium' : 'text-muted'}`}>
                          {formatDayKey(receivable.dueDate)}
                        </td>
                        <td className="px-6 py-3 text-right font-bold text-on-surface">{formatCents(receivable.amountCents)}</td>
                        <td className="px-6 py-3 text-right text-on-surface">
                          {receivable.status === 'cancelled' ? '—' : formatCents(receivable.balanceCents)}
                        </td>
                        <td className="px-6 py-3 text-center">
                          <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${RECEIVABLE_STATUS_BADGE[display]}`}>
                            {RECEIVABLE_STATUS_LABELS[display]}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <div className={ACTION_ROW}>
                            {can.canReceive && (
                              <button onClick={() => open({ kind: 'receipt', receivable })} className="p-1.5 bg-green-50 text-green-600 hover:bg-green-100 rounded" title="Registrar recebimento" aria-label={`Registrar recebimento: ${receivable.description}`}>
                                <CheckIcon className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={() => open({ kind: 'history', receivable })} className="p-1.5 text-muted hover:bg-background rounded" title="Histórico" aria-label={`Histórico: ${receivable.description}`}>
                              <HistoryIcon className="w-4 h-4" />
                            </button>
                            {can.canEdit && (
                              <button onClick={() => open({ kind: 'receivable-form', receivable })} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Editar" aria-label={`Editar: ${receivable.description}`}>
                                <EditIcon className="w-4 h-4" />
                              </button>
                            )}
                            {can.canCancel && (
                              <button onClick={() => open({ kind: 'cancel', receivable })} className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded" title="Cancelar recebível" aria-label={`Cancelar recebível: ${receivable.description}`}>
                                <CloseIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            {receivablesQuery.hasNextPage && (
              <div className="p-4 flex justify-center">
                <button type="button" onClick={() => receivablesQuery.fetchNextPage()} disabled={receivablesQuery.isFetchingNextPage} className="px-4 py-2 text-sm font-medium text-primary hover:bg-background rounded-lg disabled:opacity-60">
                  {receivablesQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'clients' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-background text-muted uppercase font-bold text-xs border-b border-border sticky top-0">
                <tr>
                  <th className="px-6 py-3">Nome</th>
                  <th className="px-6 py-3">Contato</th>
                  <th className="px-6 py-3">Documento</th>
                  <th className="px-6 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clientsQuery.isLoading ? (
                  <tr><td colSpan={4} className="p-8 text-center text-muted">Carregando...</td></tr>
                ) : clientsQuery.isError ? (
                  <tr><td colSpan={4} className="p-8 text-center text-error" role="alert">Não foi possível carregar os clientes.</td></tr>
                ) : filteredClients.length === 0 ? (
                  <tr><td colSpan={4} className="p-8 text-center text-muted">Nenhum cliente encontrado.</td></tr>
                ) : (
                  filteredClients.map((client) => {
                    const personal = privateById.get(client.id);
                    return (
                      <tr key={client.id} className="hover:bg-background/50 transition-colors group">
                        <td className="px-6 py-3 font-medium text-on-surface">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                              {client.name.charAt(0).toUpperCase()}
                            </div>
                            {client.name}
                            {client.status === 'archived' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">Arquivado</span>
                            )}
                          </div>
                        </td>
                        {permissions.canSeePrivateData ? (
                          <>
                            <td className="px-6 py-3 text-muted">
                              <div className="flex flex-col">
                                <span>{personal?.email || '-'}</span>
                                <span className="text-xs opacity-70">{personal?.phone || ''}</span>
                              </div>
                            </td>
                            <td className="px-6 py-3 text-muted">{formatDocument(personal?.document)}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-6 py-3 text-muted" title="Visível só para proprietário e administradores">Restrito</td>
                            <td className="px-6 py-3 text-muted" title="Visível só para proprietário e administradores">Restrito</td>
                          </>
                        )}
                        <td className="px-6 py-3 text-right">
                          {permissions.canManageClients && client.status === 'active' && (
                            <div className={ACTION_ROW}>
                              <button onClick={() => open({ kind: 'client-form', client })} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Editar cliente" aria-label={`Editar cliente: ${client.name}`}>
                                <EditIcon className="w-4 h-4" />
                              </button>
                              <button onClick={() => open({ kind: 'archive', client })} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Arquivar cliente" aria-label={`Arquivar cliente: ${client.name}`}>
                                <ArchiveIcon className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            {clientsQuery.hasNextPage && (
              <div className="p-4 flex justify-center">
                <button type="button" onClick={() => clientsQuery.fetchNextPage()} disabled={clientsQuery.isFetchingNextPage} className="px-4 py-2 text-sm font-medium text-primary hover:bg-background rounded-lg disabled:opacity-60">
                  {clientsQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <ClientFormModal
        isOpen={dialog?.kind === 'client-form'}
        onClose={close}
        onDone={done}
        clientToEdit={dialog?.kind === 'client-form' ? dialog.client : null}
      />

      <ReceivableFormModal
        isOpen={dialog?.kind === 'receivable-form'}
        onClose={close}
        onDone={done}
        receivableToEdit={dialog?.kind === 'receivable-form' ? dialog.receivable : null}
        editClientName={dialog?.kind === 'receivable-form' && dialog.receivable
          ? clientName(dialog.receivable.clientId)
          : undefined}
      />

      {dialog?.kind === 'receipt' && (
        <ReceiptModal open receivable={dialog.receivable} onClose={close} onDone={done} />
      )}

      {dialog?.kind === 'history' && (
        <ReceivableHistoryModal
          open
          receivable={dialog.receivable}
          onClose={close}
          canReverse={receivablePermissions(actor, dialog.receivable).canReverse}
          onReverse={(movement) => open({ kind: 'reverse', receivable: dialog.receivable, movement })}
        />
      )}

      <ClientsConfirmModal
        open={dialog?.kind === 'archive'}
        title="Arquivar cliente"
        confirmLabel="Arquivar cliente"
        onClose={close}
        onConfirm={archive}
        busy={archiveMutation.isPending}
        blockedMessage={archiveBlocked}
      >
        {dialog?.kind === 'archive' && (
          <p className="font-bold text-gray-800 dark:text-gray-100">{dialog.client.name}</p>
        )}
        <p>{ARCHIVE_EXPLANATION}</p>
      </ClientsConfirmModal>

      <ClientsConfirmModal
        open={dialog?.kind === 'cancel'}
        title="Cancelar recebível"
        confirmLabel="Cancelar recebível"
        reasonLabel="Motivo do cancelamento"
        onClose={close}
        onConfirm={cancel}
        busy={cancelMutation.isPending}
        blockedMessage={dialog?.kind === 'cancel' && dialog.receivable.activeReceiptCount > 0
          ? CANCEL_WITH_RECEIPTS_HINT
          : null}
      >
        {dialog?.kind === 'cancel' && (
          <p className="font-bold text-gray-800 dark:text-gray-100">
            {dialog.receivable.description}: {formatCents(dialog.receivable.amountCents)}
          </p>
        )}
        <p>O cancelamento é definitivo e não movimenta o caixa. O histórico é preservado; nada é apagado.</p>
      </ClientsConfirmModal>

      <ClientsConfirmModal
        open={dialog?.kind === 'reverse'}
        title="Estornar recebimento"
        confirmLabel="Confirmar estorno"
        reasonLabel="Motivo do estorno"
        onClose={close}
        onConfirm={reverse}
        busy={reverseMutation.isPending}
      >
        {dialog?.kind === 'reverse' && (
          <p className="font-bold text-gray-800 dark:text-gray-100">
            Recebimento de {formatDayKey(dialog.movement.date)}: {movementSummary(dialog.movement)}
          </p>
        )}
        <p>
          O recebimento original continua no histórico, marcado como estornado. Um movimento de compensação
          devolve principal e desconto ao saldo e desfaz no caixa o valor recebido.
        </p>
      </ClientsConfirmModal>
    </div>
  );
};

export default ClientsReceivablesView;
