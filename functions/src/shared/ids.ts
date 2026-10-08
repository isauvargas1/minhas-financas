import {z} from "zod";

/**
 * Schemas de identificador do kernel (P1, §2.2).
 *
 * Todo ID que vira segmento de caminho do Firestore passa por aqui. Um `/`
 * dentro de `workspaceId` transformava `workspaces/${id}/members/${uid}` num
 * caminho de outra coleção (ENTRY-11); `.` e `..` são IDs reservados pelo
 * Firestore; `__x__` é reservado; espaço nas pontas é quase sempre erro de
 * digitação que viraria outro documento.
 */
const RESERVED_ID = /^__.*__$/;

/** Caractere de controle (C0 ou DEL): sem uso legítimo em ID ou texto curto. */
export const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const pathSegmentId = (label: string, maxLength: number) => {
  const invalid = `${label}: valor inválido.`;
  return z.string()
    .min(1, `${label}: valor obrigatório.`)
    .max(maxLength, `${label}: excede ${maxLength} caracteres.`)
    .refine((value) => value.trim().length > 0, `${label}: valor vazio.`)
    .refine((value) => value === value.trim(), invalid)
    .refine((value) => !value.includes("/"), invalid)
    .refine((value) => value !== "." && value !== "..", invalid)
    .refine((value) => !RESERVED_ID.test(value), invalid)
    // Controle e caracteres invisíveis não têm uso legítimo em identificador.
    .refine((value) => !hasControlCharacter(value), invalid);
};

/** ID de workspace: gerado pelo Firestore (20) ou pelos seeds de teste. */
export const workspaceIdSchema = pathSegmentId("Workspace", 128);

/** UID do Firebase Auth (até 128 caracteres pela especificação). */
export const memberIdSchema = pathSegmentId("Membro", 128);

/** ID de convite: aleatório gerado pelo servidor. */
export const inviteIdSchema = pathSegmentId("Convite", 64);

/**
 * ID de lançamento em `transactions`: `cash_<hash>` nas callables do Caixa
 * (P3-A) ou determinístico nos espelhos dos demais domínios; o cliente não
 * cria lançamentos (P4-D).
 */
export const transactionIdSchema = pathSegmentId("Lançamento", 128);

/** ID de empréstimo (`loans`) e de movimento (`loan_movements`), P3-G. */
export const loanIdSchema = pathSegmentId("Empréstimo", 128);
export const loanMovementIdSchema = pathSegmentId("Movimento", 128);

/**
 * Cliente (`clients`), recebível (`receivables`) e movimento de recebível
 * (`receivable_movements`), P3-I.
 */
export const clientIdSchema = pathSegmentId("Cliente", 128);
export const receivableIdSchema = pathSegmentId("Recebível", 128);
export const receivableMovementIdSchema = pathSegmentId("Movimento", 128);

/**
 * Conta/carteira (`cash_accounts`), movimento de conta
 * (`cash_account_movements`) e transferência (`cash_transfers`), P3-J (D-30).
 */
export const cashAccountIdSchema = pathSegmentId("Conta", 128);
export const cashAccountMovementIdSchema = pathSegmentId("Movimento", 128);
export const cashTransferIdSchema = pathSegmentId("Transferência", 128);

/**
 * Cartão (`credit_cards`), compra (`credit_card_purchases`), fatura
 * (`credit_card_invoices`) e pagamento (`credit_card_invoice_payments`),
 * P4-A.
 */
export const creditCardIdSchema = pathSegmentId("Cartão", 128);
export const creditCardPurchaseIdSchema = pathSegmentId("Compra", 128);
export const creditCardInvoiceIdSchema = pathSegmentId("Fatura", 160);
export const creditCardPaymentIdSchema = pathSegmentId("Pagamento", 128);

/**
 * P4-B (D-12) — despesas recorrentes: contrato e ocorrência (o ID da
 * ocorrência é derivado pelo backend; o cliente só o repete).
 */
export const recurringExpenseIdSchema = pathSegmentId("Recorrência", 128);
export const recurringOccurrenceIdSchema = pathSegmentId("Ocorrência", 128);

/**
 * P4-C (D-14) — Divisão de contas: IDs derivados pelo backend; o cliente só
 * os repete nas operações seguintes.
 */
export const splitGroupIdSchema = pathSegmentId("Grupo", 128);
export const splitParticipantIdSchema = pathSegmentId("Participante", 128);
export const splitInviteIdSchema = pathSegmentId("Convite", 128);
export const splitBillIdSchema = pathSegmentId("Título", 128);
export const splitShareIdSchema = pathSegmentId("Rateio", 128);
export const splitReimbursementIdSchema = pathSegmentId("Reembolso", 128);

/**
 * P4-E (D-23) — item do catálogo de configurações: derivado pelo backend
 * (`cat_<hash>` na callable, `seed_<hash>` no provisionamento); o cliente só
 * o repete nas edições.
 */
export const settingsCatalogItemIdSchema = pathSegmentId("Cadastro", 128);

/**
 * Chave de idempotência escolhida pelo cliente. Nunca vira caminho sem hash
 * (`idempotencyDocumentId`), mas as mesmas restrições evitam ambiguidades.
 */
export const idempotencyKeySchema = pathSegmentId("Chave de idempotência", 128)
  .refine(
    (value) => value.length >= 8,
    "Chave de idempotência: mínimo de 8 caracteres.",
  );

/**
 * Identificador de uma importação em lotes (P3-D), gerado pelo cliente uma
 * vez por arquivo e repetido em todos os lotes dela. Nunca vira caminho sem
 * hash: entra no ID determinístico de cada linha importada.
 */
export const importIdSchema = pathSegmentId("Importação", 128)
  .refine(
    (value) => value.length >= 8,
    "Importação: mínimo de 8 caracteres.",
  );

/** Identificador de correlação opcional enviado pelo cliente. */
export const correlationIdSchema = pathSegmentId("Correlação", 128);
