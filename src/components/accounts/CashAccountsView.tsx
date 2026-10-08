import React, { useMemo, useRef, useState } from 'react';

import { useAuth } from '../../contexts/AuthContext.tsx';
import { useWorkspace } from '../../contexts/WorkspaceContext.tsx';
import {
  useAccountsIntentKey,
  useArchiveCashAccount,
  useCashAccounts,
  useCashAccountsTotal,
  useCashTransfers,
  useReactivateCashAccount,
  useReverseCashTransfer,
} from '../../modules/accounts/hooks.ts';
import {
  toAccountStatusPayload,
  toReverseCashTransferPayload,
} from '../../modules/accounts/payloads.ts';
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_TYPE_LABELS,
  ARCHIVE_WITH_BALANCE_HINT,
  LEDGER_COVERAGE_NOTE,
  TRANSFER_STATUS_LABELS,
  accountPermissions,
  accountsErrorView,
  canReverseTransfer,
  type WorkspaceRole,
} from '../../modules/accounts/presentation.ts';
import type { CashAccount, CashTransfer } from '../../modules/accounts/types.ts';
import { formatCents, formatDayKey } from '../../modules/loans/money.ts';
import {
  ArchiveIcon,
  BackIcon,
  EditIcon,
  HistoryIcon,
  PlusIcon,
  RefreshIcon,
  RepeatIcon,
  RotateCcwIcon,
  WalletIcon,
} from '../Icons.tsx';
import ClientsConfirmModal from '../clients/ClientsConfirmModal.tsx';
import { ClientsNotice } from '../clients/ClientsDialog.tsx';
import CashAccountFormModal from './CashAccountFormModal.tsx';
import CashAccountStatementModal from './CashAccountStatementModal.tsx';
import CashTransferModal from './CashTransferModal.tsx';

/**
 * Configurações › Contas e carteiras (D-30, P3-J).
 *
 * Owner e admin criam, renomeiam, mudam o tipo, arquivam (com saldo zero) e
 * reativam contas; owner, admin e member transferem entre contas ativas;
 * viewer só lê. Saldos são os autoritativos (`balanceCents`); o saldo geral
 * é somado no servidor. O histórico de transferências é paginado.
 */
interface CashAccountsViewProps {
  onBack: () => void;
}

type Confirmation =
  | { kind: 'archive'; account: CashAccount }
  | { kind: 'reactivate'; account: CashAccount }
  | { kind: 'reverse'; transfer: CashTransfer };

const CashAccountsView: React.FC<CashAccountsViewProps> = ({ onBack }) => {
  const { user } = useAuth();
  const { activeWorkspace, activeWorkspaceRole } = useWorkspace();
  const role = activeWorkspaceRole as WorkspaceRole | null | undefined;
  const permissions = accountPermissions(role);
  const accounts = useCashAccounts();
  const total = useCashAccountsTotal();
  const transfers = useCashTransfers();
  const archiveMutation = useArchiveCashAccount();
  const reactivateMutation = useReactivateCashAccount();
  const reverseMutation = useReverseCashTransfer();
  const { keyFor, reset } = useAccountsIntentKey();

  const [notice, setNotice] = useState<string | null>(null);
  const [formAccount, setFormAccount] = useState<CashAccount | null | undefined>(undefined);
  const [statementAccount, setStatementAccount] = useState<CashAccount | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  // Barra a segunda confirmação antes do próximo render (clique duplo).
  const confirmingRef = useRef(false);

  const items = useMemo(() => accounts.data?.items ?? [], [accounts.data]);
  const activeCount = items.filter((account) => account.status === 'active').length;
  const nameOf = (accountId: string) =>
    items.find((account) => account.id === accountId)?.name ?? 'Conta';
  const transferItems = transfers.data ?? [];
  const confirmBusy = archiveMutation.isPending || reactivateMutation.isPending ||
    reverseMutation.isPending;

  const done = (message: string) => {
    setNotice(message);
    setFormAccount(undefined);
    setTransferOpen(false);
    setConfirmation(null);
  };

  const openConfirmation = (next: Confirmation) => {
    reset();
    setNotice(null);
    setConfirmation(next);
  };

  const runConfirmation = async (reason: string): Promise<string | null> => {
    if (!confirmation || confirmingRef.current) return null;
    confirmingRef.current = true;
    try {
      if (confirmation.kind === 'reverse') {
        const payload = toReverseCashTransferPayload(confirmation.transfer, reason, activeWorkspace.id);
        await reverseMutation.mutateAsync({ payload, idempotencyKey: keyFor('reverseCashTransfer', payload) });
        done('Transferência estornada.');
      } else {
        const payload = toAccountStatusPayload(confirmation.account, activeWorkspace.id);
        if (confirmation.kind === 'archive') {
          await archiveMutation.mutateAsync({ payload, idempotencyKey: keyFor('archiveCashAccount', payload) });
          done('Conta arquivada.');
        } else {
          await reactivateMutation.mutateAsync({ payload, idempotencyKey: keyFor('reactivateCashAccount', payload) });
          done('Conta reativada.');
        }
      }
      return null;
    } catch (caught) {
      return accountsErrorView(caught).message;
    } finally {
      confirmingRef.current = false;
    }
  };

  return (
    <div className="animate-fade-in max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar para Configurações"
          className="p-2 rounded-lg bg-surface border border-border text-muted hover:text-on-surface transition-colors"
        >
          <BackIcon className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-2xl font-bold text-on-surface">Contas e carteiras</h2>
          <p className="text-sm text-muted">Saldos por conta e transferências entre elas.</p>
        </div>
      </div>

      <ClientsNotice message={notice} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-surface rounded-card border border-border p-6 shadow-sm">
          <p className="text-xs font-bold text-muted uppercase">Saldo geral</p>
          <p className="mt-2 text-2xl font-bold text-on-surface" data-testid="accounts-total">
            {total.isLoading ? 'Carregando…' : total.isError ? '—' : formatCents(total.data ?? 0)}
          </p>
          {total.isError && (
            <p role="alert" className="text-xs text-error mt-1">Não foi possível calcular o saldo geral.</p>
          )}
        </div>
        <div className="md:col-span-2 bg-surface rounded-card border border-border p-6 shadow-sm flex flex-col justify-between gap-4">
          <p className="text-sm text-muted">{LEDGER_COVERAGE_NOTE}</p>
          <div className="flex flex-wrap gap-3">
            {permissions.canManage && (
              <button
                type="button"
                onClick={() => { setNotice(null); setFormAccount(null); }}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white rounded-lg px-4 py-2 font-bold shadow-sm transition-colors"
              >
                <PlusIcon className="w-4 h-4" /> Nova conta
              </button>
            )}
            {permissions.canTransfer && (
              <button
                type="button"
                onClick={() => { setNotice(null); setTransferOpen(true); }}
                disabled={activeCount < 2}
                title={activeCount < 2 ? 'Transferir exige ao menos duas contas ativas.' : undefined}
                className="inline-flex items-center gap-2 border border-border bg-background text-on-surface rounded-lg px-4 py-2 font-bold hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RepeatIcon className="w-4 h-4" /> Nova transferência
              </button>
            )}
          </div>
        </div>
      </div>

      <section className="bg-surface rounded-card border border-border shadow-sm mb-6" aria-labelledby="accounts-heading">
        <h3 id="accounts-heading" className="p-5 border-b border-border text-lg font-bold text-on-surface flex items-center gap-2">
          <WalletIcon className="w-5 h-5 text-primary" /> Contas
        </h3>
        {accounts.isLoading && <p className="p-5 text-sm text-muted">Carregando...</p>}
        {accounts.isError && <p role="alert" className="p-5 text-sm text-error">Não foi possível carregar as contas.</p>}
        {accounts.isSuccess && items.length === 0 && (
          <p className="p-5 text-sm text-muted">Nenhuma conta cadastrada.</p>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-border">
            {items.map((account) => (
              <li key={account.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-testid="account-row">
                <div className="min-w-0">
                  <p className="font-bold text-on-surface truncate">{account.name}</p>
                  <p className="text-xs text-muted">
                    {ACCOUNT_TYPE_LABELS[account.accountType]} · {ACCOUNT_STATUS_LABELS[account.status]}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <span className={`font-bold mr-2 ${account.balanceCents < 0 ? 'text-red-600 dark:text-red-400' : 'text-on-surface'}`}>
                    {formatCents(account.balanceCents)}
                  </span>
                  <button type="button" onClick={() => setStatementAccount(account)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary dark:text-primary-on-dark hover:bg-primary/10 rounded">
                    <HistoryIcon className="w-3.5 h-3.5" /> Extrato
                  </button>
                  {permissions.canManage && account.status === 'active' && (
                    <>
                      <button type="button" onClick={() => { setNotice(null); setFormAccount(account); }}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted hover:text-on-surface hover:bg-background rounded">
                        <EditIcon className="w-3.5 h-3.5" /> Editar
                      </button>
                      <button type="button" onClick={() => openConfirmation({ kind: 'archive', account })}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                        <ArchiveIcon className="w-3.5 h-3.5" /> Arquivar
                      </button>
                    </>
                  )}
                  {permissions.canManage && account.status === 'archived' && (
                    <button type="button" onClick={() => openConfirmation({ kind: 'reactivate', account })}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary dark:text-primary-on-dark hover:bg-primary/10 rounded">
                      <RefreshIcon className="w-3.5 h-3.5" /> Reativar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {accounts.data?.atLimit && (
          <p className="p-5 text-xs text-muted">
            Limite de 100 contas por espaço atingido. Reative uma conta arquivada em vez de criar outra.
          </p>
        )}
      </section>

      <section className="bg-surface rounded-card border border-border shadow-sm" aria-labelledby="transfers-heading">
        <h3 id="transfers-heading" className="p-5 border-b border-border text-lg font-bold text-on-surface flex items-center gap-2">
          <RepeatIcon className="w-5 h-5 text-primary" /> Transferências
        </h3>
        {transfers.isLoading && <p className="p-5 text-sm text-muted">Carregando...</p>}
        {transfers.isError && <p role="alert" className="p-5 text-sm text-error">Não foi possível carregar as transferências.</p>}
        {transfers.isSuccess && transferItems.length === 0 && (
          <p className="p-5 text-sm text-muted">Nenhuma transferência registrada.</p>
        )}
        {transferItems.length > 0 && (
          <ul className="divide-y divide-border">
            {transferItems.map((transfer) => (
              <li key={transfer.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-testid="transfer-row">
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-on-surface">
                    {nameOf(transfer.sourceAccountId)} → {nameOf(transfer.destinationAccountId)}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDayKey(transfer.date)} · {TRANSFER_STATUS_LABELS[transfer.status]}
                    {transfer.description ? ` · ${transfer.description}` : ''}
                  </p>
                  {transfer.reversalReason && (
                    <p className="text-xs text-muted">Motivo do estorno: {transfer.reversalReason}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <span className={`font-bold ${transfer.status === 'reversed' ? 'text-muted line-through' : 'text-on-surface'}`}>
                    {formatCents(transfer.amountCents)}
                  </span>
                  {canReverseTransfer(transfer, role, user?.uid) && (
                    <button type="button" onClick={() => openConfirmation({ kind: 'reverse', transfer })}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                      <RotateCcwIcon className="w-3.5 h-3.5" /> Estornar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {transfers.hasNextPage && (
          <div className="p-5">
            <button type="button" onClick={() => transfers.fetchNextPage()} disabled={transfers.isFetchingNextPage}
              className="px-4 py-2 text-sm font-medium text-muted hover:bg-background rounded-lg transition-colors disabled:opacity-60">
              {transfers.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </button>
          </div>
        )}
      </section>

      <CashAccountFormModal
        open={formAccount !== undefined}
        account={formAccount ?? null}
        onClose={() => setFormAccount(undefined)}
        onSaved={done}
      />
      <CashTransferModal
        open={transferOpen}
        accounts={items}
        onClose={() => setTransferOpen(false)}
        onDone={done}
      />
      {statementAccount && (
        <CashAccountStatementModal
          open
          account={items.find((account) => account.id === statementAccount.id) ?? statementAccount}
          onClose={() => setStatementAccount(null)}
        />
      )}
      <ClientsConfirmModal
        open={confirmation !== null}
        title={confirmation?.kind === 'reverse' ? 'Estornar transferência'
          : confirmation?.kind === 'reactivate' ? 'Reativar conta' : 'Arquivar conta'}
        confirmLabel={confirmation?.kind === 'reverse' ? 'Confirmar estorno'
          : confirmation?.kind === 'reactivate' ? 'Reativar' : 'Arquivar'}
        reasonLabel={confirmation?.kind === 'reverse' ? 'Motivo do estorno' : undefined}
        onClose={() => setConfirmation(null)}
        onConfirm={runConfirmation}
        busy={confirmBusy}
        blockedMessage={confirmation?.kind === 'archive' && confirmation.account.balanceCents !== 0
          ? ARCHIVE_WITH_BALANCE_HINT : null}
      >
        {confirmation?.kind === 'reverse' ? (
          <p>
            Estornar a transferência de {formatCents(confirmation.transfer.amountCents)} de{' '}
            {nameOf(confirmation.transfer.sourceAccountId)} para{' '}
            {nameOf(confirmation.transfer.destinationAccountId)}? O valor volta para a conta de origem.
          </p>
        ) : confirmation?.kind === 'reactivate' ? (
          <p>Reativar a conta {confirmation.account.name}? Ela volta a aceitar movimentos.</p>
        ) : confirmation ? (
          <p>Arquivar a conta {confirmation.account.name}? Ela deixa de aceitar movimentos e o histórico é mantido.</p>
        ) : null}
      </ClientsConfirmModal>
    </div>
  );
};

export default CashAccountsView;
