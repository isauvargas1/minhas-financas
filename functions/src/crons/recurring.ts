import {onSchedule} from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import {FieldPath, Timestamp} from "firebase-admin/firestore";

import {saoPauloDayKey, saoPauloDayStart} from "../shared/dateKeys";
import {SCHEDULED_FUNCTION_OPTIONS} from "../shared/runtimeOptions";

/**
 * Geração das despesas recorrentes vencidas.
 *
 * ## O que estava errado
 *
 * A rotina varria `collectionGroup("recurring_expenses")` procurando
 * `status == "active"` e lia `nextDueDate`/`startDate`. **O produto nunca
 * escreveu nenhum desses valores**: o cadastro grava `status` no domínio
 * `'ativo' | 'pausado' | 'cancelado'` e a data de início em `dataInicio`
 * (`src/modules/recurring-expenses/types.ts`). A consulta, portanto, não
 * casava com documento nenhum — o agendamento era um no-op silencioso, e a
 * omissão não aparecia em lugar nenhum porque nenhum teste o exercitava.
 *
 * E se casasse, o que escrevia não era uma transação válida:
 *
 * - `date` saía como instante ISO completo (`2026-08-26T00:00:00.000Z`) num
 *   campo cujo contrato é `YYYY-MM-DD`. `cashPeriodKeyFor` tentaria
 *   `new Date("2026-08-26T00:00:00.000ZT12:00:00.000Z")`, obteria `Invalid
 *   Date` e devolveria `undefined`: **toda** despesa gerada ficaria fora da
 *   projeção mensal de caixa, que é a fonte oficial de saldo acumulado;
 * - sem `userId` e sem `workspaceId`, as Rules recusam qualquer edição
 *   posterior (`isCommonValidTransactionPayload` exige os dois, e o `update`
 *   compara `userId` dos dois lados). A despesa gerada nasceria congelada: o
 *   usuário não conseguiria marcá-la como paga, editá-la nem dar baixa;
 * - o avanço era sempre `+1 mês`, ignorando `periodo`. Uma assinatura anual
 *   viraria doze despesas por ano;
 * - `dataFim` era ignorada: o contrato encerrado continuaria gerando;
 * - o ID da transação era aleatório, então um retry do Cloud Scheduler
 *   duplicaria o lançamento.
 *
 * ## Desenho
 *
 * A lógica sai do corpo do agendador (`runRecurringExpenseScan`) para poder
 * ser exercitada contra o Emulator, e o cálculo de datas é puro
 * (`addRecurringPeriod`, `firstRecurringDueDate`) para ser exercitado sem
 * Firestore nenhum. O agendador vira só o gatilho.
 *
 * A varredura continua paginada por cursor com checkpoint entre execuções, e
 * o gate de geração é o do próprio cadastro: `gerarDespesaAutomaticamente`.
 * Quem não pediu geração automática não passa a receber lançamento — inclusive
 * os documentos anteriores ao campo, que o filtro de igualdade do Firestore
 * deixa de fora por não terem o campo.
 */

const db = (): admin.firestore.Firestore => admin.firestore();

/** Assinaturas lidas por página; mantém a leitura por execução limitada. */
export const RECURRING_PAGE_SIZE = 200;
/** Teto de páginas por execução, para o job não crescer sem limite. */
export const RECURRING_MAX_PAGES = 50;
/** Escritas por commit. Cada item gera até 3 escritas; o limite do lote é 500. */
export const RECURRING_BATCH_LIMIT = 400;

/** Status de assinatura ativa, no domínio que o cadastro realmente grava. */
export const RECURRING_ACTIVE_STATUS = "ativo";

/**
 * Autor das transações geradas.
 *
 * Nenhuma pessoa criou este lançamento. Atribuí-lo ao proprietário seria
 * registrar uma autoria falsa na trilha; o campo existe porque as Rules o
 * exigem para permitir edição posterior, e um ator de sistema explícito
 * satisfaz a regra sem mentir sobre a origem. Mesmo padrão de
 * `crons/creditCardInvoices.ts`.
 */
export const RECURRING_SYSTEM_ACTOR_ID = "system:recurring-expenses";

/**
 * Checkpoint da varredura, fora de qualquer workspace.
 *
 * O teto por execução (`MAX_PAGES × PAGE_SIZE`) protege a instância, mas sem
 * retomada ele vira omissão permanente: a consulta é sempre a mesma, ordenada
 * por ID, e a assinatura processada continua ativa; logo, tudo além do teto
 * jamais seria alcançado em execução nenhuma. O cursor persistido faz a
 * execução seguinte continuar de onde a anterior parou.
 */
const RECURRING_CHECKPOINT = "job_checkpoints/recurring_expenses";

export type RecurringBillingPeriod =
  | "semanal"
  | "quinzenal"
  | "mensal"
  | "bimestral"
  | "trimestral"
  | "semestral"
  | "anual";

/** Períodos em que `diaCobranca` faz sentido — os que andam de mês em mês. */
const MONTHLY_OR_LONGER: RecurringBillingPeriod[] = [
  "mensal",
  "bimestral",
  "trimestral",
  "semestral",
  "anual",
];

const parseDayKey = (dayKey: string): [number, number, number] => {
  const [year, month, day] = dayKey.split("-").map(Number);
  return [year, month, day];
};

const toDayKey = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Avança uma data `YYYY-MM-DD` por um período de cobrança.
 *
 * A aritmética espelha exatamente `addPeriod` do cliente
 * (`src/modules/recurring-expenses/logic.ts`), inclusive o transbordo de mês
 * do `Date` — 31 de janeiro + 1 mês cai em 2 ou 3 de março. Divergir aqui
 * faria a despesa gerada cair num dia diferente da ocorrência que a tela
 * projeta para o mesmo contrato.
 */
export const addRecurringPeriod = (
  dayKey: string,
  period: RecurringBillingPeriod,
  count = 1,
): string => {
  const [year, month, day] = parseDayKey(dayKey);
  switch (period) {
  case "semanal":
    return toDayKey(new Date(Date.UTC(year, month - 1, day + 7 * count)));
  case "quinzenal":
    return toDayKey(new Date(Date.UTC(year, month - 1, day + 15 * count)));
  case "bimestral":
    return toDayKey(new Date(Date.UTC(year, month - 1 + 2 * count, day)));
  case "trimestral":
    return toDayKey(new Date(Date.UTC(year, month - 1 + 3 * count, day)));
  case "semestral":
    return toDayKey(new Date(Date.UTC(year, month - 1 + 6 * count, day)));
  case "anual":
    return toDayKey(new Date(Date.UTC(year + count, month - 1, day)));
  case "mensal":
  default:
    return toDayKey(new Date(Date.UTC(year, month - 1 + count, day)));
  }
};

/** `YYYY-MM-DD` de um campo que pode ser Timestamp, string ISO ou data. */
export const recurringDayKey = (value: unknown): string | undefined => {
  if (value instanceof Timestamp) return saoPauloDayKey(value.toDate());
  if (value instanceof Date) return saoPauloDayKey(value);
  if (typeof value !== "string" || value.length < 10) return undefined;
  const candidate = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : undefined;
};

/**
 * Primeiro vencimento de um contrato.
 *
 * Espelha `projectOccurrences` do cliente: parte de `dataInicio` e, nos
 * períodos que andam de mês em mês, desloca o dia para `diaCobranca`.
 */
export const firstRecurringDueDate = (
  data: admin.firestore.DocumentData,
): string | undefined => {
  const start = recurringDayKey(data.dataInicio);
  if (!start) return undefined;
  const period = (data.periodo ?? "mensal") as RecurringBillingPeriod;
  const billingDay = Number(data.diaCobranca);
  if (
    !Number.isInteger(billingDay) ||
    billingDay < 1 ||
    billingDay > 31 ||
    !MONTHLY_OR_LONGER.includes(period)
  ) {
    return start;
  }
  const [year, month] = parseDayKey(start);
  return toDayKey(new Date(Date.UTC(year, month - 1, billingDay)));
};

export interface RecurringChargePlan {
  /** Vencimento a gerar nesta execução. */
  dueDate: string;
  /** Vencimento a gravar em `nextDueDate` depois de gerar. */
  nextDueDate: string;
  /** Encerrado por `dataFim`: não há próximo vencimento. */
  ended: boolean;
  /** Competência (`YYYY-MM`) da ocorrência correspondente. */
  competencia: string;
}

/**
 * Primeiro vencimento que a rotina passa a gerir, para uma assinatura que
 * ainda não tem `nextDueDate`.
 *
 * **Nenhuma assinatura existente tem `nextDueDate`** — o produto nunca gravou
 * esse campo, e é justamente por isso que a rotina nunca gerou nada. Sem um
 * piso, a primeira execução real cairia em `dataInicio` e, gerando um
 * vencimento por execução, emitiria uma despesa retroativa por dia até
 * alcançar o presente: uma assinatura mensal de três anos viraria trinta e
 * seis lançamentos que o usuário nunca teve, cada um entrando na projeção de
 * caixa e nos relatórios.
 *
 * O piso é hoje: a rotina assume a assinatura a partir do primeiro vencimento
 * da série que não está no passado. Histórico não é responsabilidade dela — a
 * tela de detalhe da assinatura já oferece a geração manual, ocorrência a
 * ocorrência, para quem quiser preencher o passado.
 */
export const firstManagedDueDate = (
  data: admin.firestore.DocumentData,
  today: string,
): string | undefined => {
  const first = firstRecurringDueDate(data);
  if (!first) return undefined;
  if (first >= today) return first;

  const period = (data.periodo ?? "mensal") as RecurringBillingPeriod;
  // Teto de segurança: a série avança até alcançar hoje. Mesmo semanal desde
  // 1970 caberia com folga, e o teto impede laço infinito num `periodo`
  // inesperado que não avance.
  let candidate = first;
  for (let step = 0; step < 4_000; step += 1) {
    const next = addRecurringPeriod(candidate, period);
    if (next <= candidate) return undefined;
    candidate = next;
    if (candidate >= today) return candidate;
  }
  return undefined;
};

/** Competência `YYYY-MM` de um vencimento, no formato que a ocorrência usa. */
export const competenciaOf = (dueDate: string): string => dueDate.slice(0, 7);

/**
 * ID da ocorrência correspondente a um vencimento.
 *
 * Determinístico e **igual** ao que o cliente projeta
 * (`src/modules/recurring-expenses/logic.ts`), para que a rotina e a tela
 * falem do mesmo documento.
 */
export const recurringOccurrenceId = (
  recurringId: string,
  dueDate: string,
): string => `occ_${recurringId}_${competenciaOf(dueDate)}`;

/**
 * O que fazer com uma assinatura hoje.
 *
 * Gera **um** vencimento por execução, como antes: uma assinatura atrasada
 * seis meses se acerta em seis execuções diárias, e nenhuma execução isolada
 * pode explodir o lote. `undefined` significa "nada a fazer hoje".
 */
export const planRecurringCharge = (
  data: admin.firestore.DocumentData,
  today: string,
): RecurringChargePlan | undefined => {
  const period = (data.periodo ?? "mensal") as RecurringBillingPeriod;
  // Com `nextDueDate` a rotina já geria a assinatura e retoma de onde parou,
  // inclusive recuperando atraso de execução. Sem ele, assume no presente.
  const dueDate =
    recurringDayKey(data.nextDueDate) ?? firstManagedDueDate(data, today);
  if (!dueDate || dueDate > today) return undefined;

  const endDate = recurringDayKey(data.dataFim);
  if (endDate && dueDate > endDate) return undefined;

  const nextDueDate = addRecurringPeriod(dueDate, period);
  return {
    dueDate,
    nextDueDate,
    competencia: competenciaOf(dueDate),
    ended: Boolean(endDate && nextDueDate > endDate),
  };
};

/**
 * Rótulo de categoria da despesa gerada.
 *
 * `category` é **rótulo de exibição**: o gráfico de despesas por categoria o
 * usa direto como nome (`reports/logic.ts`, `categoryName: name`). Gravar
 * `categoriaDespesaId` ali — que é o ID do vínculo — faria a categoria
 * aparecer no relatório como um identificador do Firestore.
 *
 * Os rótulos são os mesmos que a geração manual da tela usa
 * (`RecurringExpenseDetailsView.handleGenerate`): `tipoEmpresa` quando a
 * assinatura é corporativa, "Assinaturas" caso contrário. Assim os dois
 * caminhos produzem lançamentos indistinguíveis no relatório.
 */
const recurringCategory = (data: admin.firestore.DocumentData): string => {
  const business = data.tipoEmpresa;
  if (typeof business === "string" && business.trim().length > 0) {
    return business.trim().slice(0, 120);
  }
  return "Assinaturas";
};

/**
 * Descrição da despesa gerada, no mesmo formato da geração manual: nome da
 * assinatura seguido do mês por extenso.
 */
const MONTHS_PT_BR = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const recurringDescription = (
  data: admin.firestore.DocumentData,
  dueDate: string,
): string => {
  const name = typeof data.nome === "string" ? data.nome.trim() : "";
  const base = name.length > 0 ? name : "Despesa recorrente";
  const month = MONTHS_PT_BR[Number(dueDate.slice(5, 7)) - 1];
  return `${base}${month ? ` (${month})` : ""}`.slice(0, 300);
};

/**
 * Documento da transação gerada.
 *
 * Só campos que as Rules aceitam num documento editável pelo cliente:
 * `valueCents`, `goalId` e `investmentMetadata` ficam de fora de propósito —
 * `isPlainClientTransaction` recusa a edição de qualquer transação que os
 * carregue, e uma despesa que o usuário não pode marcar como paga não serve.
 */
export const buildRecurringTransaction = (
  data: admin.firestore.DocumentData,
  workspaceId: string,
  recurringId: string,
  dueDate: string,
  transactionId: string,
): admin.firestore.DocumentData => ({
  id: transactionId,
  type: "despesa",
  description: recurringDescription(data, dueDate),
  category: recurringCategory(data),
  value: Number(data.valorPadrao),
  date: dueDate,
  transactionDate: Timestamp.fromDate(saoPauloDayStart(dueDate)),
  isPaid: false,
  userId: RECURRING_SYSTEM_ACTOR_ID,
  workspaceId,
  profileId: workspaceId,
  source: "recurring",
  recurringId,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
});

/**
 * ID determinístico do lançamento.
 *
 * O ID aleatório anterior fazia de qualquer retry do Cloud Scheduler um
 * segundo lançamento do mesmo mês. Derivado da assinatura e do vencimento, o
 * retry reescreve o mesmo documento com o mesmo conteúdo.
 */
export const recurringTransactionId = (
  recurringId: string,
  dueDate: string,
): string => `rec_${recurringId}_${dueDate}`;

export interface RecurringScanOptions {
  /** Dia de referência (`YYYY-MM-DD`); por padrão, hoje em São Paulo. */
  today?: string;
  pageSize?: number;
  maxPages?: number;
  batchLimit?: number;
}

export interface RecurringScanSummary {
  generated: number;
  scanned: number;
  skippedNotDue: number;
  skippedEnded: number;
  skippedInvalidValue: number;
  /** Ocorrência já gerada pela tela: a rotina não duplica. */
  skippedAlreadyGenerated: number;
  resumed: boolean;
  truncated: boolean;
}

const isGeneratableValue = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= 1_000_000_000;

export const runRecurringExpenseScan = async (
  options: RecurringScanOptions = {},
): Promise<RecurringScanSummary> => {
  const today = options.today ?? saoPauloDayKey();
  const pageSize = options.pageSize ?? RECURRING_PAGE_SIZE;
  const maxPages = options.maxPages ?? RECURRING_MAX_PAGES;
  const batchLimit = options.batchLimit ?? RECURRING_BATCH_LIMIT;

  const checkpointRef = db().doc(RECURRING_CHECKPOINT);
  const checkpoint = await checkpointRef.get();
  const resumePath = typeof checkpoint.data()?.cursorPath === "string" ?
    (checkpoint.data()?.cursorPath as string) :
    undefined;

  // Consulta de grupo de coleção ordena por caminho completo, então o cursor
  // retomado precisa ser uma referência de documento, não um ID curto.
  let cursorPath: string | undefined = resumePath;
  let generated = 0;
  let scanned = 0;
  let skippedNotDue = 0;
  let skippedEnded = 0;
  let skippedInvalidValue = 0;
  let skippedAlreadyGenerated = 0;
  let exhausted = false;
  let batch = db().batch();
  let batchWrites = 0;

  const flush = async (): Promise<void> => {
    if (batchWrites === 0) return;
    await batch.commit();
    batch = db().batch();
    batchWrites = 0;
  };

  for (let page = 0; page < maxPages; page += 1) {
    let query = db()
      .collectionGroup("recurring_expenses")
      .where("status", "==", RECURRING_ACTIVE_STATUS)
      .where("gerarDespesaAutomaticamente", "==", true)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursorPath) query = query.startAfter(db().doc(cursorPath));

    const activeSnap = await query.get();
    if (activeSnap.empty) {
      exhausted = true;
      break;
    }
    cursorPath = activeSnap.docs[activeSnap.docs.length - 1].ref.path;
    scanned += activeSnap.size;

    for (const docSnap of activeSnap.docs) {
      const data = docSnap.data();
      const workspaceRef = docSnap.ref.parent.parent;
      if (!workspaceRef) continue;

      const plan = planRecurringCharge(data, today);
      if (!plan) {
        // Encerrado por `dataFim` conta separado de "ainda não venceu": são
        // diagnósticos diferentes quando uma assinatura para de gerar.
        const endDate = recurringDayKey(data.dataFim);
        const dueDate =
          recurringDayKey(data.nextDueDate) ?? firstRecurringDueDate(data);
        if (endDate && dueDate && dueDate > endDate) skippedEnded += 1;
        else skippedNotDue += 1;
        continue;
      }

      if (!isGeneratableValue(Number(data.valorPadrao))) {
        // Valor inválido não vira transação recusada pelas Rules mais tarde:
        // é contado e ignorado, e a assinatura não avança — o operador vê a
        // contagem e corrige o cadastro.
        skippedInvalidValue += 1;
        continue;
      }

      /*
       * A ocorrência é o registro que diz se este vencimento já virou despesa.
       *
       * A tela de detalhe da assinatura tem geração manual
       * (`RecurringExpenseDetailsView.handleGenerate`), que cria a despesa e
       * grava `despesaId` na ocorrência. Sem consultar isso, a rotina criaria
       * um **segundo** lançamento para o mesmo mês — com outro ID, invisível
       * para a tela — e o mês apareceria em dobro no caixa e nos relatórios.
       *
       * A leitura é um `get` por assinatura vencida, por ID determinístico:
       * não é consulta, e só acontece para quem de fato tem vencimento hoje.
       */
      const occurrenceRef = workspaceRef
        .collection("recurring_occurrences")
        .doc(recurringOccurrenceId(docSnap.id, plan.dueDate));
      const occurrence = await occurrenceRef.get();
      const alreadyGenerated =
        typeof occurrence.data()?.despesaId === "string" &&
        (occurrence.data()?.despesaId as string).length > 0;

      if (alreadyGenerated) {
        // Já gerado pela tela: a assinatura avança, mas nada é criado.
        skippedAlreadyGenerated += 1;
        batch.update(docSnap.ref, {
          nextDueDate: plan.nextDueDate,
          ...(plan.ended ? {status: "cancelado"} : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        batchWrites += 1;
        if (batchWrites >= batchLimit) await flush();
        continue;
      }

      const transactionId = recurringTransactionId(docSnap.id, plan.dueDate);
      const txRef = workspaceRef.collection("transactions").doc(transactionId);
      batch.set(
        txRef,
        buildRecurringTransaction(
          data,
          workspaceRef.id,
          docSnap.id,
          plan.dueDate,
          transactionId,
        ),
      );

      // A ocorrência passa a apontar para a despesa criada, no mesmo formato
      // que a tela grava: é isso que impede a tela de gerar de novo.
      batch.set(
        occurrenceRef,
        {
          id: occurrenceRef.id,
          recurringExpenseId: docSnap.id,
          competencia: plan.competencia,
          dataPrevista: Timestamp.fromDate(saoPauloDayStart(plan.dueDate)),
          valorPrevisto: Number(data.valorPadrao),
          despesaId: transactionId,
          status: "gerado",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        {merge: true},
      );

      batch.update(docSnap.ref, {
        nextDueDate: plan.nextDueDate,
        ...(plan.ended ? {status: "cancelado"} : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      batchWrites += 3;
      generated += 1;
      if (batchWrites >= batchLimit) await flush();
    }

    if (activeSnap.size < pageSize) {
      exhausted = true;
      break;
    }
  }

  await flush();

  // Varredura completa reinicia do começo na próxima execução; interrompida
  // pelo teto, guarda onde parou. Sem isso, o corte seria silencioso.
  await checkpointRef.set(
    {
      job: "recurring_expenses",
      cursorPath: exhausted || !cursorPath ?
        admin.firestore.FieldValue.delete() :
        cursorPath,
      lastRunDay: today,
      lastRunGenerated: generated,
      lastRunScanned: scanned,
      lastRunTruncated: !exhausted,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {merge: true},
  );

  return {
    generated,
    scanned,
    skippedNotDue,
    skippedEnded,
    skippedInvalidValue,
    skippedAlreadyGenerated,
    resumed: Boolean(resumePath),
    truncated: !exhausted,
  };
};

export const processRecurring = onSchedule(
  {
    ...SCHEDULED_FUNCTION_OPTIONS,
    schedule: "every day 02:00",
    // Sem fuso declarado o agendamento era UTC, e o corte do dia caía às 23:00
    // do dia anterior em São Paulo — um vencimento do dia 1º só seria gerado
    // no dia 2. O produto inteiro corta período em `America/Sao_Paulo`.
    timeZone: "America/Sao_Paulo",
  },
  async () => {
    const summary = await runRecurringExpenseScan();
    // Log operacional sanitizado: apenas contagens, nunca valor, descrição
    // ou identificador de pessoa.
    console.log("recurring_processed", summary);
  },
);
