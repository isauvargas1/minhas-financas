import * as admin from "firebase-admin";
import {setGlobalOptions} from "firebase-functions/v2/options";

import {GLOBAL_FUNCTION_OPTIONS} from "./shared/runtimeOptions";

admin.initializeApp();

// Região junto do Firestore (`southamerica-east1`) e teto global de
// instâncias. Sem isso todo o deploy subia em `us-central1`, a um continente
// de distância do banco (INV-P2-042).
setGlobalOptions(GLOBAL_FUNCTION_OPTIONS);

// Triggers (Gatilhos Automáticos)
export * from "./triggers/transactions";

// P1 — conta, workspaces, membership e convites (kernel de autorização).
export * from "./workspaces/callables";
export {onWorkspaceDisplayChange} from "./workspaces/indexSync";

// Callables (APIs chamadas pelo frontend)
export * from "./goals/callables";
export * from "./investments/callables";
export * from "./ai/callables";

// P2A — billing canônico: catálogo, checkout e Customer Portal.
// P2B.1 — entitlement do workspace pelo owner e uso da conta (leitura).
export {
  createBillingPortalSession,
  createCheckoutSession,
  getAccountUsage,
  getBillingCatalog,
  getWorkspaceEntitlement,
} from "./billing/callables";
export * from "./cash/rebuild";
// P5-C1 — relatório financeiro autoritativo (Dashboard e Relatórios).
export {getFinancialReport} from "./reports/callables";
// P3-A — criação; P3-C — correção e anulação; P3-D — importação em lotes de
// lançamento manual confirmado; P3-F — pendentes, agendados e confirmação.
export {
  confirmCashTransaction,
  createCashTransaction,
  importCashTransactions,
  updateCashTransaction,
  voidCashTransaction,
} from "./cash/callables";
// P3-G — domínio autoritativo de empréstimos (D-13): contratação com caixa no
// mesmo commit, liquidação, estorno, cancelamento e metadados; atraso diário.
export {
  cancelLoan,
  createLoan,
  registerLoanPayment,
  reverseLoanMovement,
  updateLoanMetadata,
} from "./loans/callables";
export {processLoanStatusRefresh} from "./loans/statusRefresh";
// P3-I — clientes (D-24) e recebíveis (D-39): cadastro com dados pessoais
// separados, recebimento parcial com caixa no mesmo commit, estorno e
// cancelamento lógicos.
export {
  archiveClient,
  cancelReceivable,
  createClient,
  createReceivable,
  receiveReceivable,
  reverseReceivableReceipt,
  updateClient,
  updateReceivable,
} from "./receivables/callables";
// P3-J — contas/carteiras e transferências (D-30): saldo autoritativo por
// conta, livro-razão imutável e transferência com estorno compensatório.
export {
  archiveCashAccount,
  createCashAccount,
  createCashTransfer,
  reactivateCashAccount,
  reverseCashTransfer,
  updateCashAccount,
} from "./accounts/callables";

// P4-E — catálogo de configurações (D-23): criação, edição (renomear,
// aparência, reativar) e inativação só pelo backend, com unicidade de nome
// transacional e auditoria; o cliente só lê.
export {
  archiveSettingsCatalogItem,
  createSettingsCatalogItem,
  updateSettingsCatalogItem,
} from "./settingsCatalog/callables";

// P4-A — cartões de crédito autoritativos (D-36): cadastro e ciclo de vida,
// compras e parcelas em centavos, faturas com ciclo e pagamento separados,
// pagamento a partir de conta (D-30), estornos, ajuste e reconciliação.
export {
  archiveCreditCard,
  cancelCreditCardPurchase,
  createCreditCard,
  createCreditCardInvoiceAdjustment,
  createCreditCardPurchase,
  reactivateCreditCard,
  rebuildCardInvoicesForCard,
  recalculateCardLimit,
  refundCreditCardPurchase,
  registerInvoicePayment,
  reverseInvoicePayment,
  updateCreditCard,
  updateCreditCardPurchase,
} from "./cards/callables";

// P4-B — despesas recorrentes autoritativas (D-12): contrato em centavos,
// agenda civil determinística, ocorrências por vencimento e geração no Caixa
// (P3) ou no Cartão (P4-A) pelo backend.
export {
  cancelRecurringExpense,
  confirmRecurringOccurrence,
  createRecurringExpense,
  ignoreRecurringOccurrence,
  pauseRecurringExpense,
  resumeRecurringExpense,
  retryRecurringOccurrence,
  updateRecurringExpense,
} from "./recurring/callables";

// P4-C — Divisão de contas autoritativa (D-14): grupos, participantes
// (membros do workspace e externos), convites por código, títulos com rateio
// exato em centavos, quitação, perdão e reembolso PJ, com o fato financeiro
// no Caixa (P3) ou no Cartão (P4-A) no mesmo commit.
export {
  acceptSplitGroupInvite,
  addExternalSplitParticipant,
  addWorkspaceSplitParticipant,
  approveSplitReimbursement,
  archiveSplitGroup,
  cancelSplitReimbursement,
  createSplitBill,
  createSplitGroup,
  createSplitGroupInvite,
  createSplitReimbursement,
  deactivateSplitParticipant,
  forgiveSplitShare,
  paySplitReimbursement,
  reactivateSplitGroup,
  rejectSplitReimbursement,
  reverseReimbursementPayment,
  reverseSplitShareSettlement,
  revokeSplitGroupInvite,
  settleSplitShare,
  updateSplitBill,
  updateSplitGroup,
  voidSplitBill,
} from "./splitBills/callables";

// Cron Jobs (Tarefas agendadas)
export {processRecurring} from "./crons/recurring";

// P4-A — fechamento automático de faturas de cartão (D-36) e alertas de
// vencimento, com cursor estável e releitura transacional.
export {processCreditCardInvoiceClosing} from "./cards/closing";

// INV-P2-019 — varredura diária de deriva do domínio patrimonial. Amostrada
// por rodízio: cada execução cobre uma fatia dos workspaces com o domínio
// ativo, sem varrer todos os tenants todo dia.
export * from "./crons/investmentDrift";

// P5-D2 — notificações persistentes: contagem exata de não lidas (callable) e
// produtores de fatos de domínio. Os gatilhos só leem o antes e o depois do
// documento autoritativo e criam o aviso com ID determinístico. Recebíveis
// vencidos (atraso derivado, sem escrita no vencimento): rotina horária sobre
// o trabalho pendente que as operações de recebíveis enfileiram (P5-D2.1).
export {getNotificationUnreadCount} from "./notifications/unreadCount";
export {onCashAccountWriteNotification} from
  "./notifications/producers/cashAccounts";
export {onGoalWriteNotification} from "./notifications/producers/goals";
export {onLoanWriteNotification} from "./notifications/producers/loans";
export {processReceivableOverdueNotifications} from
  "./notifications/producers/receivables";
export {onRecurringOccurrenceCreatedNotification} from
  "./notifications/producers/recurring";

// Webhooks (Recebem avisos de serviços externos)
export {stripeWebhook} from "./webhooks/stripe";
