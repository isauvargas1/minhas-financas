/**
 * Contrato das notificações persistentes (P5-D2, PR-NOTIF-01, PR-RPT-04).
 *
 * O evento `workspaces/{ws}/notifications/{id}` é compartilhado pelo
 * workspace, gravado só pelo backend (Admin SDK) e imutável depois de criado.
 * Representa um **fato de domínio já ocorrido** (texto no passado), nunca
 * uma condição atual: a condição vive nas telas do domínio e nos relatórios.
 * O que é de cada pessoa (lida, arquivada, excluída para si) fica em
 * `notification_user_states/{uid}/notification_entries/{id}` (D-18, Rules).
 *
 * Todo produtor passa pelo builder único (`builder.ts`), que valida este
 * contrato. A contagem exata (`unreadCount.ts`) depende dele: todo evento
 * tem título, mensagem, `createdAt` (ISO) e `expiresAt` (Timestamp) e é
 * visível a todo membro ativo — não há evento dirigido a um usuário.
 *
 * Nada de dado pessoal (nome de pessoa ou cliente, documento, telefone,
 * e-mail), de texto gerado por IA ou de cópia do documento de domínio: só
 * identificadores da entidade, a data do fato e o texto fixo do evento.
 */

/** Domínio de origem do evento. */
export const NOTIFICATION_DOMAINS = [
  "credit_card",
  "loan",
  "receivable",
  "cash_account",
  "goal",
  "recurring",
] as const;
export type NotificationDomain = typeof NOTIFICATION_DOMAINS[number];

/** Tipo do fato de domínio (`domainEventType`), sempre de um único domínio. */
export const NOTIFICATION_EVENT_DOMAIN = {
  invoice_closed: "credit_card",
  invoice_due_soon: "credit_card",
  invoice_overdue: "credit_card",
  loan_overdue: "loan",
  receivable_overdue: "receivable",
  cash_account_negative_balance: "cash_account",
  goal_achieved: "goal",
  recurring_awaiting_confirmation: "recurring",
  recurring_attention_required: "recurring",
} as const satisfies Record<string, NotificationDomain>;
export type NotificationEventType = keyof typeof NOTIFICATION_EVENT_DOMAIN;

export const NOTIFICATION_EVENT_TYPES = Object.keys(
  NOTIFICATION_EVENT_DOMAIN) as NotificationEventType[];

/** `source`: a coleção autoritativa que originou o fato. */
export const NOTIFICATION_SOURCE_BY_DOMAIN = {
  credit_card: "credit_card_invoice",
  loan: "loan",
  receivable: "receivable",
  cash_account: "cash_account",
  goal: "goal",
  recurring: "recurring_occurrence",
} as const satisfies Record<NotificationDomain, string>;
export type NotificationSource =
  typeof NOTIFICATION_SOURCE_BY_DOMAIN[NotificationDomain];

/** Apresentação (ícone e cor no painel). */
export const NOTIFICATION_TYPES = [
  "info", "success", "warning", "error", "credit_card",
] as const;
export type NotificationPresentationType = typeof NOTIFICATION_TYPES[number];

/**
 * Link seguro: só uma chave de tela interna do app (nunca URL). `settings`
 * leva às Configurações, onde ficam "Contas e carteiras".
 */
export const NOTIFICATION_LINKS = {
  cards: "Ver cartões",
  loans: "Ver empréstimos",
  clients_receivables: "Ver recebíveis",
  settings: "Abrir configurações",
  goals: "Ver metas",
  recurring: "Ver recorrentes",
} as const;
export type NotificationLink = keyof typeof NOTIFICATION_LINKS;

/** Identificadores de entidade permitidos por domínio (todos obrigatórios). */
export const NOTIFICATION_ENTITY_FIELDS = {
  credit_card: ["cardId", "invoiceId"],
  loan: ["loanId"],
  receivable: ["receivableId"],
  cash_account: ["accountId"],
  goal: ["goalId"],
  recurring: ["recurringExpenseId", "occurrenceId"],
} as const satisfies Record<NotificationDomain, readonly string[]>;
export type NotificationEntityField =
  typeof NOTIFICATION_ENTITY_FIELDS[NotificationDomain][number];

export const NOTIFICATION_TITLE_MAX = 80;
export const NOTIFICATION_MESSAGE_MAX = 300;

/** Entrada do builder: o produtor nunca monta o documento à mão. */
export interface NotificationInput {
  id: string;
  workspaceId: string;
  eventType: NotificationEventType;
  title: string;
  message: string;
  type: NotificationPresentationType;
  link: NotificationLink;
  /** Instante de criação em ms; define `createdAt` e `expiresAt` (180 dias). */
  createdAtMs: number;
  /** Exatamente os campos de `NOTIFICATION_ENTITY_FIELDS[domínio]`. */
  entity: Partial<Record<NotificationEntityField, string>>;
}

/** Campos do documento gravado (a ordem não importa). */
export const NOTIFICATION_DOCUMENT_FIELDS = [
  "id", "workspaceId", "title", "message", "type", "link", "actionLabel",
  "createdAt", "expiresAt", "source", "domain", "domainEventType",
] as const;

/** Contrato violado por um produtor: não se grava nada. */
export class NotificationContractError extends Error {
  constructor(readonly reason: string) {
    super(`notification_contract_violation:${reason}`);
    this.name = "NotificationContractError";
  }
}
