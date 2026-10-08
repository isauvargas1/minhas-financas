import {z} from "zod";

import {isDayKey, saoPauloDayKey} from "../shared/dateKeys";
import {isIsoInstant} from "../shared/commitTime";
import {
  cashAccountIdSchema,
  correlationIdSchema,
  hasControlCharacter,
  idempotencyKeySchema,
  importIdSchema,
  transactionIdSchema,
  workspaceIdSchema,
} from "../shared/ids";
import {isMoneyCents} from "../shared/money";

/**
 * Contrato da criação de lançamento manual (P3-A, PR-TX-01; P3-F, D-29).
 *
 * Só receita e despesa comuns. O estado vem explícito (`status`): confirmado
 * — fato já ocorrido, com a data efetiva (`date`) até hoje — ou pendente —
 * compromisso com vencimento (`dueDate`), passado, de hoje ou futuro
 * (agendado). `isPaid` nunca vem do cliente: o backend o deriva do estado.
 * Os dois ramos são `.strict()`: campo desconhecido é
 * recusado, não ignorado. Por isso nada do que é autoritativo ou vínculo de
 * outro domínio passa — `value`, `valueCents`, `userId`, `profileId`,
 * `profileType`, `isPaid`, `cardId`, `loanId`, `loanMovementId`,
 * `installments`, `source`, `creditCard*`, `investmentEntry`, `voidedAt`,
 * `createdBy`. Usuário, workspace e papel vêm
 * do token e do membership persistido; o vínculo com investimentos, cartões,
 * empréstimos e recebíveis só existe nos fluxos próprios desses domínios.
 *
 * P3-J (D-30): todo lançamento manual informa a conta/carteira
 * (`cashAccountId`). O confirmado move o saldo dela no mesmo commit; o
 * pendente guarda a conta e só a move na confirmação.
 *
 * Os tetos são os mesmos das Rules de `transactions` (`value <= 1000000000`,
 * descrição até 300, categoria até 120, fornecedor e centro de custo até 200),
 * para que nenhum lançamento aceito aqui fique fora do que o resto do produto
 * aceita.
 */

/** R$ 1.000.000.000,00: mesmo teto das Rules, em centavos. */
export const CASH_ENTRY_MAX_CENTS = 100_000_000_000;

/** Primeira data civil aceita para um lançamento. */
export const CASH_ENTRY_MIN_DAY = "2000-01-01";

const textSchema = (label: string, maxLength: number) => z.string()
  .transform((value) => value.trim())
  .pipe(z.string()
    .min(1, `${label}: valor obrigatório.`)
    .max(maxLength, `${label}: até ${maxLength} caracteres.`)
    .refine((value) => !hasControlCharacter(value), `${label}: inválido.`));

/**
 * Valor em centavos inteiros (D-34): número inteiro seguro, positivo e até o
 * teto. Sem coerção — `"1000"`, `10.5`, `NaN`, `Infinity` e `-0` são recusados.
 */
export const amountCentsSchema = z.number()
  .refine(isMoneyCents, "Valor: centavos inteiros.")
  .refine((value) => value > 0, "Valor: deve ser maior que zero.")
  .refine(
    (value) => value <= CASH_ENTRY_MAX_CENTS,
    "Valor: acima do máximo permitido.",
  );

/** Data civil `YYYY-MM-DD` existente, a partir de 2000 (D-17). */
const dayKeySchema = (label: string) => z.string()
  .refine(isDayKey, `${label}: use AAAA-MM-DD com uma data existente.`)
  .refine((value) => value >= CASH_ENTRY_MIN_DAY, `${label}: anterior a 2000.`);

export const FUTURE_CONFIRMED_DATE_MESSAGE =
  "Data: lançamento confirmado não pode ter data futura.";

/**
 * Data efetiva `YYYY-MM-DD` em `America/Sao_Paulo` (D-17).
 *
 * Lançamento confirmado é fato já ocorrido: a data não passa de hoje no fuso
 * do produto. Vencimento futuro é lançamento pendente (D-29).
 */
export const cashEntryDateSchema = dayKeySchema("Data")
  .refine((value) => value <= saoPauloDayKey(), FUTURE_CONFIRMED_DATE_MESSAGE);

/** Vencimento até 10 anos à frente de hoje (São Paulo). */
export const CASH_ENTRY_MAX_DUE_YEARS = 10;

export const maxDueDayKey = (today: string = saoPauloDayKey()): string =>
  `${Number(today.slice(0, 4)) + CASH_ENTRY_MAX_DUE_YEARS}${today.slice(4)}`;

/**
 * Vencimento do lançamento pendente (D-29): passado (vencido), hoje ou
 * futuro (agendado). O avanço do calendário não muda o estado.
 */
export const cashEntryDueDateSchema = dayKeySchema("Vencimento")
  .refine(
    (value) => value <= maxDueDayKey(),
    `Vencimento: no máximo ${CASH_ENTRY_MAX_DUE_YEARS} anos à frente.`,
  );

/** Campos descritivos e o valor, iguais na criação e na correção. */
const baseEntryFields = {
  description: textSchema("Descrição", 300),
  category: textSchema("Categoria", 120),
  amountCents: amountCentsSchema,
  /** Só em workspace PJ; a checagem usa o tipo persistido do workspace. */
  supplier: textSchema("Fornecedor", 200).optional(),
  costCenter: textSchema("Centro de custo", 200).optional(),
};

/**
 * Estado e datas do lançamento (D-29). A combinação é conferida por
 * `settlementRule`: confirmado leva `date`; pendente leva `dueDate`.
 */
const settlementFields = {
  status: z.enum(["confirmed", "pending"]).optional(),
  date: dayKeySchema("Data").optional(),
  dueDate: dayKeySchema("Vencimento").optional(),
};

/** Campos do lançamento, iguais na criação e na correção. */
const entryFields = {
  ...baseEntryFields,
  ...settlementFields,
  /** Conta/carteira do lançamento (D-30): ativa, no mesmo workspace. */
  cashAccountId: cashAccountIdSchema,
};

const commonFields = {
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  ...entryFields,
};

type SettlementInput = {
  status?: "confirmed" | "pending";
  date?: string;
  dueDate?: string;
};

/**
 * Confirmado (padrão quando `status` falta): `date` obrigatória, até hoje, e
 * sem vencimento. Pendente: `dueDate` obrigatório, até 10 anos à frente, e
 * sem data efetiva — ela só nasce na confirmação.
 */
const settlementRule = (entry: SettlementInput, context: z.RefinementCtx) => {
  if (entry.status === "pending") {
    if (entry.dueDate === undefined) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Vencimento: obrigatório para lançamento pendente.",
      });
    } else if (entry.dueDate > maxDueDayKey()) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message:
          `Vencimento: no máximo ${CASH_ENTRY_MAX_DUE_YEARS} anos à frente.`,
      });
    }
    if (entry.date !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["date"],
        message:
          "Data: lançamento pendente não tem data efetiva; ela é informada " +
          "na confirmação.",
      });
    }
    return;
  }
  if (entry.date === undefined) {
    context.addIssue({
      code: "custom",
      path: ["date"],
      message: "Data: obrigatória para lançamento confirmado.",
    });
  } else if (entry.date > saoPauloDayKey()) {
    context.addIssue({
      code: "custom",
      path: ["date"],
      message: FUTURE_CONFIRMED_DATE_MESSAGE,
    });
  }
  if (entry.dueDate !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["dueDate"],
      message: "Vencimento: só em lançamento pendente.",
    });
  }
};

/** Estado normalizado de um lançamento validado (D-29). */
export type CashEntrySettlement =
  | {status: "confirmed"; date: string}
  | {status: "pending"; dueDate: string};

/** Depois de `settlementRule`, a combinação é sempre uma das duas. */
export const settlementOf = (entry: SettlementInput): CashEntrySettlement =>
  entry.status === "pending" ?
    {status: "pending", dueDate: entry.dueDate as string} :
    {status: "confirmed", date: entry.date as string};

/** Campos próprios de cada tipo, iguais na criação, correção e importação. */
const incomeFields = {
  type: z.literal("receita"),
  incomeType: textSchema("Tipo de receita", 120).optional(),
};

const expenseFields = {
  type: z.literal("despesa"),
  expenseType: textSchema("Tipo de despesa", 120).optional(),
  paymentMethod: textSchema("Forma de pagamento", 120).optional(),
};

export const createCashTransactionPayloadSchema = z.discriminatedUnion("type", [
  z.object({...commonFields, ...incomeFields}).strict(),
  z.object({...commonFields, ...expenseFields}).strict(),
]).superRefine(settlementRule);

export type CreateCashTransactionPayload = z.infer<
  typeof createCashTransactionPayloadSchema
>;

export interface CreateCashTransactionResult extends Record<string, unknown> {
  transactionId: string;
  replayed: boolean;
}

/**
 * Correção e anulação de lançamento (P3-C, D-35).
 *
 * Contratos separados, sem endpoint genérico: nenhum aceita um documento do
 * Firestore. O cliente informa o lançamento (`transactionId`, no workspace
 * autorizado), a intenção (`idempotencyKey`), a versão que leu
 * (`expectedUpdatedAt`) e o motivo. Autor, criação, titularidade, auditoria,
 * moeda e vínculos de outros domínios nunca vêm do cliente.
 */

/**
 * Versão lida pelo cliente: o `updatedAt` do lançamento, em ISO-8601 com até
 * nanossegundos, ou `null` quando o documento lido não tem `updatedAt` (caso
 * mantido fechado, não suposto). Todo escritor grava `updatedAt` com o horário
 * do servidor, então dois estados diferentes do mesmo documento nunca têm o
 * mesmo valor.
 */
export const expectedUpdatedAtSchema = z.string()
  .max(40, "Versão do lançamento: formato inválido.")
  .refine(isIsoInstant, "Versão do lançamento: formato inválido.")
  .nullable();

const mutationFields = {
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  transactionId: transactionIdSchema,
  expectedUpdatedAt: expectedUpdatedAtSchema,
  reason: textSchema("Motivo", 300),
  /** Correlação opcional do cliente; fica fora do hash da intenção. */
  correlationId: correlationIdSchema.optional(),
};

/**
 * Estado completo e corrigido do lançamento. O que não for informado deixa
 * de existir (um campo opcional omitido é removido). O tipo só alterna entre
 * receita e despesa; os campos próprios de cada tipo acompanham o tipo novo.
 * O estado (`status`) precisa ser o atual: a correção não confirma nem volta
 * a pendente — confirmar é `confirmCashTransaction` (D-29).
 */
export const cashEntryStateSchema = z.discriminatedUnion("type", [
  z.object({...entryFields, ...incomeFields}).strict(),
  z.object({...entryFields, ...expenseFields}).strict(),
]).superRefine(settlementRule);

export type CashEntryState = z.infer<typeof cashEntryStateSchema>;

export const updateCashTransactionPayloadSchema = z.object({
  ...mutationFields,
  entry: cashEntryStateSchema,
}).strict();

export type UpdateCashTransactionPayload = z.infer<
  typeof updateCashTransactionPayloadSchema
>;

export const voidCashTransactionPayloadSchema = z.object({
  ...mutationFields,
}).strict();

export type VoidCashTransactionPayload = z.infer<
  typeof voidCashTransactionPayloadSchema
>;

/**
 * Confirmação de lançamento pendente (P3-F, D-29).
 *
 * Registra a liquidação: a data efetiva (`date`, até hoje — liquidação futura
 * não é fato) e o valor efetivamente liquidado (`amountCents`, que pode
 * diferir do previsto). Em despesa, a forma de pagamento usada pode ser
 * informada (`paymentMethod`); omitida, a registrada é mantida. O mesmo vale
 * para a conta (`cashAccountId`, D-30): o saldo dela é movido no commit da
 * confirmação. O vencimento fica preservado. Sem motivo: confirmar é o fluxo
 * normal, não correção.
 */
export const confirmCashTransactionPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  transactionId: transactionIdSchema,
  expectedUpdatedAt: expectedUpdatedAtSchema,
  date: cashEntryDateSchema,
  amountCents: amountCentsSchema,
  paymentMethod: textSchema("Forma de pagamento", 120).optional(),
  /**
   * Conta efetivamente usada na liquidação (D-30). Omitida, vale a conta
   * registrada no lançamento pendente.
   */
  cashAccountId: cashAccountIdSchema.optional(),
  /** Correlação opcional do cliente; fica fora do hash da intenção. */
  correlationId: correlationIdSchema.optional(),
}).strict();

export type ConfirmCashTransactionPayload = z.infer<
  typeof confirmCashTransactionPayloadSchema
>;

export interface ConfirmCashTransactionResult extends Record<string, unknown> {
  transactionId: string;
  replayed: boolean;
  revision: number;
}

export interface UpdateCashTransactionResult extends Record<string, unknown> {
  transactionId: string;
  replayed: boolean;
  /** `false` quando o estado informado já era o atual (nada gravado). */
  changed: boolean;
  revision: number;
}

export interface VoidCashTransactionResult extends Record<string, unknown> {
  transactionId: string;
  replayed: boolean;
  revision: number;
}

/**
 * Importação de lançamentos manuais confirmados (P3-D, D-40).
 *
 * Um arquivo vira uma importação (`importId`, gerado pelo cliente) enviada em
 * lotes de até `CASH_IMPORT_MAX_ITEMS` linhas. Cada lote tem a própria chave
 * de idempotência; cada linha tem um identificador estável dentro da
 * importação (`lineId`, por exemplo o número da linha do arquivo), que forma
 * o ID determinístico do lançamento. Assim um lote repetido, um lote refeito
 * com outra chave e lotes que se sobrepõem nunca criam a mesma linha duas
 * vezes. Cada linha passa pelo mesmo contrato estrito da criação: nada de
 * autoria, valor em reais, vínculo de outro domínio ou campo desconhecido.
 *
 * O teto do lote cabe com folga numa transação do Firestore (3 escritas por
 * linha — lançamento, evento e movimento da conta — mais saldo da conta,
 * chave, limite e quota, contra 500) e limita a rajada de entregas do
 * gatilho da projeção mensal.
 *
 * P3-J (D-30): a conta é do lote (`cashAccountId`); toda linha nova move o
 * saldo dela no mesmo commit.
 */
export const CASH_IMPORT_MAX_ITEMS = 50;

const importLineIdSchema = z.string()
  .regex(
    /^[A-Za-z0-9_-]{1,64}$/,
    "Linha: use até 64 letras, números, _ ou -.",
  );

/** Linha importada: só lançamento confirmado, com a data efetiva. */
export const cashImportItemSchema = z.discriminatedUnion("type", [
  z.object({
    lineId: importLineIdSchema,
    ...baseEntryFields,
    date: cashEntryDateSchema,
    ...incomeFields,
  }).strict(),
  z.object({
    lineId: importLineIdSchema,
    ...baseEntryFields,
    date: cashEntryDateSchema,
    ...expenseFields,
  }).strict(),
]);

export type CashImportItem = z.infer<typeof cashImportItemSchema>;

export const importCashTransactionsPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  importId: importIdSchema,
  /** Conta/carteira de todas as linhas do lote (D-30). */
  cashAccountId: cashAccountIdSchema,
  /** Correlação opcional do cliente; fica fora do hash da intenção. */
  correlationId: correlationIdSchema.optional(),
  items: z.array(cashImportItemSchema)
    .min(1, "Importação: envie ao menos um lançamento.")
    .max(
      CASH_IMPORT_MAX_ITEMS,
      `Importação: no máximo ${CASH_IMPORT_MAX_ITEMS} lançamentos por lote.`,
    ),
}).strict().superRefine((payload, context) => {
  const seen = new Set<string>();
  payload.items.forEach((item, index) => {
    if (seen.has(item.lineId)) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "lineId"],
        message: "Linha repetida neste lote.",
      });
    }
    seen.add(item.lineId);
  });
});

export type ImportCashTransactionsPayload = z.infer<
  typeof importCashTransactionsPayloadSchema
>;

export type CashImportItemStatus = "created" | "already_imported";

export interface ImportCashTransactionsResult extends Record<string, unknown> {
  importId: string;
  replayed: boolean;
  /** Linhas criadas neste lote (cada uma consumiu uma unidade da quota). */
  created: number;
  /** Linhas que já existiam desta importação (nenhum consumo). */
  alreadyImported: number;
  /** Mês da quota consumido; `null` quando nada foi criado. */
  periodKey: string | null;
  items: Array<{
    lineId: string;
    transactionId: string;
    status: CashImportItemStatus;
  }>;
  /** Resumo em pt-BR para a interface. */
  message: string;
}
