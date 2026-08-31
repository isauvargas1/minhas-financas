import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {cashPeriodDeltaFor, cashPeriodKeyFor} from "../../cash/periods";
import {runRecurringExpenseScan} from "../recurring";

/**
 * Varredura de despesas recorrentes contra o Firestore.
 *
 * O agendamento em si (Cloud Scheduler → Pub/Sub → função) **não** é
 * reproduzível aqui: o pacote de emuladores deste repositório sobe `auth`,
 * `firestore`, `functions` e `ui`, e não o `pubsub`, sem o qual o CLI não
 * registra nem dispara gatilho `onSchedule`. O que este arquivo exercita é
 * tudo que o gatilho chama; o disparo real fica registrado como verificação
 * de STAGING em `docs/investments/STAGING_ROLLOUT_READINESS.md`.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório.");
}

const PROJECT = process.env.GCLOUD_PROJECT || "minhas-financas-local";
const WORKSPACE_A = "recurring-scan-a";
const WORKSPACE_B = "recurring-scan-b";
const CHECKPOINT = "job_checkpoints/recurring_expenses";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

interface SeedInput {
  nome: string;
  valorPadrao?: number;
  periodo?: string;
  status?: string;
  gerarDespesaAutomaticamente?: boolean;
  dataInicio?: string;
  dataFim?: string;
  nextDueDate?: string;
  diaCobranca?: number;
  categoriaDespesaId?: string;
}

const seedExpense = async (
  workspaceId: string,
  id: string,
  input: SeedInput,
): Promise<void> => {
  await db().doc(`workspaces/${workspaceId}/recurring_expenses/${id}`).set({
    nome: input.nome,
    tipo: "assinatura",
    valorPadrao: input.valorPadrao ?? 100,
    moeda: "BRL",
    periodo: input.periodo ?? "mensal",
    diaCobranca: input.diaCobranca ?? 10,
    // O cadastro grava Timestamp, não string: é a forma real do documento.
    dataInicio: Timestamp.fromDate(
      new Date(`${input.dataInicio ?? "2026-03-10"}T12:00:00.000Z`),
    ),
    ...(input.dataFim ?
      {dataFim: Timestamp.fromDate(new Date(`${input.dataFim}T12:00:00.000Z`))} :
      {}),
    ...(input.nextDueDate ? {nextDueDate: input.nextDueDate} : {}),
    ...(input.categoriaDespesaId ?
      {categoriaDespesaId: input.categoriaDespesaId} :
      {}),
    metodoPagamento: "pix",
    gerarDespesaAutomaticamente: input.gerarDespesaAutomaticamente ?? true,
    corPrincipal: "#112233",
    icone: "receipt",
    status: input.status ?? "ativo",
  });
};

const resetWorld = async (): Promise<void> => {
  await Promise.all([
    db().recursiveDelete(db().doc(`workspaces/${WORKSPACE_A}`)),
    db().recursiveDelete(db().doc(`workspaces/${WORKSPACE_B}`)),
    db().doc(CHECKPOINT).delete(),
  ]);
  await Promise.all([
    db().doc(`workspaces/${WORKSPACE_A}`).set({type: "PF", name: WORKSPACE_A}),
    db().doc(`workspaces/${WORKSPACE_B}`).set({type: "PJ", name: WORKSPACE_B}),
  ]);
};

const transactions = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/transactions`).get()).docs;

test("a assinatura vencida vira despesa válida e visível para a projeção de caixa", async () => {
  await resetWorld();
  await seedExpense(WORKSPACE_A, "aluguel", {
    nome: "Aluguel da sala",
    valorPadrao: 3_200,
    nextDueDate: "2026-06-10",
  });

  const summary = await runRecurringExpenseScan({today: "2026-06-15"});
  assert.equal(summary.generated, 1);
  assert.equal(summary.scanned, 1);
  assert.equal(summary.truncated, false);

  const created = await transactions(WORKSPACE_A);
  assert.equal(created.length, 1);
  const data = created[0].data();

  assert.equal(created[0].id, "rec_aluguel_2026-06-10");
  assert.equal(data.date, "2026-06-10");
  assert.equal(data.type, "despesa");
  assert.equal(data.value, 3_200);
  assert.equal(data.isPaid, false);
  assert.equal(data.workspaceId, WORKSPACE_A);
  assert.ok(typeof data.userId === "string" && data.userId.length > 0);

  /*
   * A regressão que este bloco tranca: com `date` fora do contrato, o gatilho
   * de caixa devolvia `undefined` para o mês e **toda** despesa recorrente
   * ficava fora do saldo acumulado — sem erro, sem log, sem sinal.
   */
  assert.equal(cashPeriodKeyFor(data), "2026-06");
  assert.equal(cashPeriodDeltaFor(data).expenseCents, 320_000);
  assert.equal(cashPeriodDeltaFor(data).netCents, -320_000);

  // A assinatura avança um período, e só um.
  const expense = await db()
    .doc(`workspaces/${WORKSPACE_A}/recurring_expenses/aluguel`).get();
  assert.equal(expense.data()?.nextDueDate, "2026-07-10");

  /*
   * A ocorrência do mês passa a apontar para a despesa criada, no mesmo
   * formato e com o mesmo ID que a tela usa. É esse registro que impede a
   * geração manual de criar um segundo lançamento para o mesmo mês.
   */
  const occurrence = await db()
    .doc(`workspaces/${WORKSPACE_A}/recurring_occurrences/occ_aluguel_2026-06`)
    .get();
  assert.equal(occurrence.exists, true);
  assert.equal(occurrence.data()?.despesaId, "rec_aluguel_2026-06-10");
  assert.equal(occurrence.data()?.status, "gerado");
  assert.equal(occurrence.data()?.recurringExpenseId, "aluguel");
});

test("vencimento já gerado pela tela não vira um segundo lançamento", async () => {
  await resetWorld();
  await seedExpense(WORKSPACE_A, "streaming", {
    nome: "Streaming", valorPadrao: 39.9, nextDueDate: "2026-06-10",
  });
  // A tela gerou este mês e registrou a despesa na ocorrência.
  await db()
    .doc(`workspaces/${WORKSPACE_A}/recurring_occurrences/occ_streaming_2026-06`)
    .set({
      recurringExpenseId: "streaming",
      competencia: "2026-06",
      valorPrevisto: 39.9,
      despesaId: "despesa-criada-pela-tela",
      status: "gerado",
    });

  const summary = await runRecurringExpenseScan({today: "2026-06-15"});
  assert.equal(summary.generated, 0);
  assert.equal(summary.skippedAlreadyGenerated, 1);
  assert.equal((await transactions(WORKSPACE_A)).length, 0);

  // A assinatura avança mesmo assim: o mês está resolvido.
  const expense = await db()
    .doc(`workspaces/${WORKSPACE_A}/recurring_expenses/streaming`).get();
  assert.equal(expense.data()?.nextDueDate, "2026-07-10");
});

test("a primeira execução não gera histórico de assinatura antiga", async () => {
  await resetWorld();
  // Sem `nextDueDate`: é o estado de **toda** assinatura existente hoje.
  await seedExpense(WORKSPACE_A, "antiga", {
    nome: "Assinatura antiga",
    valorPadrao: 50,
    dataInicio: "2023-03-10",
    diaCobranca: 10,
  });

  const summary = await runRecurringExpenseScan({today: "2026-06-15"});
  assert.equal(summary.generated, 0, "nada retroativo");
  assert.equal(summary.skippedNotDue, 1);
  assert.equal((await transactions(WORKSPACE_A)).length, 0);

  // Chegado o vencimento seguinte, gera um só — e a partir daí é gerida.
  const next = await runRecurringExpenseScan({today: "2026-07-10"});
  assert.equal(next.generated, 1);
  const created = await transactions(WORKSPACE_A);
  assert.equal(created.length, 1);
  assert.equal(created[0].data().date, "2026-07-10");
});

test("só gera para quem pediu geração automática e está ativo", async () => {
  await resetWorld();
  await Promise.all([
    seedExpense(WORKSPACE_A, "gera", {
      nome: "Gera", nextDueDate: "2026-06-10",
    }),
    seedExpense(WORKSPACE_A, "nao-gera", {
      nome: "Não gera",
      nextDueDate: "2026-06-10",
      gerarDespesaAutomaticamente: false,
    }),
    seedExpense(WORKSPACE_A, "pausada", {
      nome: "Pausada", nextDueDate: "2026-06-10", status: "pausado",
    }),
    seedExpense(WORKSPACE_A, "cancelada", {
      nome: "Cancelada", nextDueDate: "2026-06-10", status: "cancelado",
    }),
  ]);

  const summary = await runRecurringExpenseScan({today: "2026-06-15"});
  assert.equal(summary.generated, 1);
  // Pausada, cancelada e sem geração automática nem chegam a ser lidas: o
  // filtro é do servidor, não da memória.
  assert.equal(summary.scanned, 1);

  const created = await transactions(WORKSPACE_A);
  assert.equal(created.length, 1);
  assert.match(created[0].data().description, /^Gera \(/);
});

test("repetir a varredura no mesmo dia não duplica lançamento", async () => {
  await resetWorld();
  await seedExpense(WORKSPACE_A, "streaming", {
    nome: "Streaming", valorPadrao: 39.9, nextDueDate: "2026-06-10",
  });

  const first = await runRecurringExpenseScan({today: "2026-06-15"});
  const second = await runRecurringExpenseScan({today: "2026-06-15"});

  assert.equal(first.generated, 1);
  // O vencimento avançou para 2026-07-10, que ainda não venceu.
  assert.equal(second.generated, 0);
  assert.equal(second.skippedNotDue, 1);
  assert.equal((await transactions(WORKSPACE_A)).length, 1);
});

test("o contrato encerrado gera o último vencimento e para", async () => {
  await resetWorld();
  await seedExpense(WORKSPACE_A, "contrato", {
    nome: "Contrato encerrado",
    nextDueDate: "2026-06-10",
    dataFim: "2026-06-30",
  });

  const first = await runRecurringExpenseScan({today: "2026-12-01"});
  assert.equal(first.generated, 1);

  const expense = await db()
    .doc(`workspaces/${WORKSPACE_A}/recurring_expenses/contrato`).get();
  assert.equal(expense.data()?.status, "cancelado");

  // Encerrada, some da consulta: nada mais é gerado em execução nenhuma.
  const second = await runRecurringExpenseScan({today: "2027-01-01"});
  assert.equal(second.generated, 0);
  assert.equal(second.scanned, 0);
  assert.equal((await transactions(WORKSPACE_A)).length, 1);
});

test("o período anual avança um ano, não um mês", async () => {
  await resetWorld();
  await seedExpense(WORKSPACE_A, "dominio", {
    nome: "Registro de domínio",
    periodo: "anual",
    valorPadrao: 60,
    nextDueDate: "2026-06-10",
  });

  await runRecurringExpenseScan({today: "2026-12-01"});
  const expense = await db()
    .doc(`workspaces/${WORKSPACE_A}/recurring_expenses/dominio`).get();
  assert.equal(expense.data()?.nextDueDate, "2027-06-10");
  // Sete meses de atraso não viram sete lançamentos anuais.
  assert.equal((await transactions(WORKSPACE_A)).length, 1);
});

test("cada lançamento nasce dentro do workspace da própria assinatura", async () => {
  await resetWorld();
  await Promise.all([
    seedExpense(WORKSPACE_A, "pf-assinatura", {
      nome: "Assinatura PF", nextDueDate: "2026-06-10",
    }),
    seedExpense(WORKSPACE_B, "pj-assinatura", {
      nome: "Assinatura PJ", nextDueDate: "2026-06-10",
    }),
  ]);

  const summary = await runRecurringExpenseScan({today: "2026-06-15"});
  assert.equal(summary.generated, 2);

  const a = await transactions(WORKSPACE_A);
  const b = await transactions(WORKSPACE_B);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.match(a[0].data().description, /^Assinatura PF \(/);
  assert.equal(a[0].data().workspaceId, WORKSPACE_A);
  assert.match(b[0].data().description, /^Assinatura PJ \(/);
  assert.equal(b[0].data().workspaceId, WORKSPACE_B);
});

test("o teto de páginas interrompe sem omitir: o cursor retoma na execução seguinte", async () => {
  await resetWorld();
  await Promise.all([
    seedExpense(WORKSPACE_A, "a-primeira", {
      nome: "Primeira", nextDueDate: "2026-06-10",
    }),
    seedExpense(WORKSPACE_A, "b-segunda", {
      nome: "Segunda", nextDueDate: "2026-06-10",
    }),
  ]);

  const first = await runRecurringExpenseScan({
    today: "2026-06-15", pageSize: 1, maxPages: 1,
  });
  assert.equal(first.generated, 1);
  assert.equal(first.truncated, true);
  assert.equal(first.resumed, false);

  const checkpoint = await db().doc(CHECKPOINT).get();
  assert.equal(typeof checkpoint.data()?.cursorPath, "string");
  assert.equal(checkpoint.data()?.lastRunTruncated, true);

  const second = await runRecurringExpenseScan({
    today: "2026-06-15", pageSize: 1, maxPages: 1,
  });
  assert.equal(second.resumed, true);
  assert.equal(second.generated, 1);

  // As duas foram cobertas, cada uma exatamente uma vez.
  const created = await transactions(WORKSPACE_A);
  assert.equal(created.length, 2);
  assert.deepEqual(
    created.map((entry) => entry.id).sort(),
    ["rec_a-primeira_2026-06-10", "rec_b-segunda_2026-06-10"],
  );
});

test("valor inválido é contado e ignorado, sem avançar a assinatura", async () => {
  await resetWorld();
  await seedExpense(WORKSPACE_A, "sem-valor", {
    nome: "Sem valor", valorPadrao: 0, nextDueDate: "2026-06-10",
  });

  const summary = await runRecurringExpenseScan({today: "2026-06-15"});
  assert.equal(summary.generated, 0);
  assert.equal(summary.skippedInvalidValue, 1);
  assert.equal((await transactions(WORKSPACE_A)).length, 0);

  // A assinatura **não** avança: corrigido o valor no cadastro, o mesmo
  // vencimento volta a ser elegível em vez de ser pulado para sempre.
  const expense = await db()
    .doc(`workspaces/${WORKSPACE_A}/recurring_expenses/sem-valor`).get();
  assert.equal(expense.data()?.nextDueDate, "2026-06-10");
});
