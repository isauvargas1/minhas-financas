import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {FUNCTIONS_REGION} from "../../shared/runtimeOptions";
import {processCreditCardInvoiceOperationalAlerts} from "../creditCardInvoices";
import {processInvestmentDriftScan} from "../investmentDrift";
import {processRecurring} from "../recurring";

/**
 * O corpo do agendador, e não só a lógica que ele chama.
 *
 * ## O que dá para exercitar aqui, e o que não dá
 *
 * O disparo real é Cloud Scheduler → Pub/Sub → função. O pacote de emuladores
 * deste repositório (`firebase.json`) sobe `auth`, `firestore`, `functions` e
 * `ui`; **não** sobe `pubsub`, sem o qual o CLI não registra nem dispara
 * gatilho `onSchedule`. Simular o disparo seria declarar verde um caminho não
 * exercitado, então o disparo fica como verificação de STAGING.
 *
 * O que **é** exercitável, e antes não era por ninguém, são as duas metades
 * que o agendamento carrega:
 *
 * 1. **o contrato de implantação** — expressão de agendamento, fuso, região,
 *    tempo limite, memória e concorrência, lidos do `__endpoint` que o
 *    `firebase deploy` consome. É o mesmo objeto que vai para o Cloud
 *    Scheduler, então divergir aqui é divergir em produção;
 * 2. **o corpo do gatilho** — `.run(event)` executa exatamente o que o
 *    runtime executaria ao receber o evento, incluindo a derivação de
 *    correlação a partir de `scheduleTime`, os laços de página e a escrita de
 *    cursor, que os testes de lógica não alcançam.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório.");
}

const PROJECT = process.env.GCLOUD_PROJECT || "minhas-financas-local";
const WORKSPACE = "scheduler-handler-ws";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

/** Evento de agendamento, no formato que o runtime v2 entrega. */
const scheduledEvent = (scheduleTime: string) => ({
  jobName: "test-job",
  scheduleTime,
  scheduleId: "test-schedule",
  region: FUNCTIONS_REGION,
  data: undefined,
}) as unknown as Parameters<typeof processRecurring.run>[0];

const SCHEDULERS = [
  {
    name: "processRecurring",
    fn: processRecurring,
    schedule: "every day 02:00",
  },
  {
    name: "processInvestmentDriftScan",
    fn: processInvestmentDriftScan,
    schedule: "every day 06:00",
  },
  {
    name: "processCreditCardInvoiceOperationalAlerts",
    fn: processCreditCardInvoiceOperationalAlerts,
    schedule: "every day 07:00",
  },
];

test("toda rotina agendada declara fuso, região e recursos de rotina longa", () => {
  for (const {name, fn, schedule} of SCHEDULERS) {
    const endpoint = (fn as unknown as {
      __endpoint: Record<string, unknown>;
    }).__endpoint;
    const trigger = endpoint.scheduleTrigger as Record<string, unknown>;

    assert.equal(trigger.schedule, schedule, `${name}: agendamento`);
    /*
     * Sem fuso declarado o Cloud Scheduler usa UTC, e 02:00 UTC é 23:00 do dia
     * anterior em São Paulo: o corte do dia cairia no dia errado numa rotina
     * cujo produto inteiro fecha período em `America/Sao_Paulo`.
     */
    assert.equal(trigger.timeZone, "America/Sao_Paulo", `${name}: fuso`);

    // Região junto do Firestore (INV-P2-042). `southamerica-east1` precisa
    // valer para as rotinas agendadas também, não só para as callables.
    assert.deepEqual(endpoint.region, [FUNCTIONS_REGION], `${name}: região`);

    // Perfil de rotina longa: o padrão de callable (60 s / 256 MiB) corta a
    // varredura no meio, e as três paginam milhares de documentos.
    assert.equal(endpoint.timeoutSeconds, 540, `${name}: tempo limite`);
    assert.equal(endpoint.availableMemoryMb, 512, `${name}: memória`);
    // Uma execução por vez: elas escrevem cursor e documentos singleton.
    assert.equal(endpoint.maxInstances, 1, `${name}: concorrência`);
  }
});

test("o corpo do gatilho de recorrentes gera a despesa vencida", async () => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  await db().doc("job_checkpoints/recurring_expenses").delete();
  await db().doc(`workspaces/${WORKSPACE}`).set({type: "PF", name: WORKSPACE});
  await db()
    .doc(`workspaces/${WORKSPACE}/recurring_expenses/handler-assinatura`)
    .set({
      nome: "Assinatura pelo gatilho",
      tipo: "assinatura",
      valorPadrao: 49.9,
      moeda: "BRL",
      periodo: "mensal",
      diaCobranca: 10,
      dataInicio: Timestamp.fromDate(new Date("2020-01-10T12:00:00.000Z")),
      nextDueDate: "2020-01-10",
      metodoPagamento: "pix",
      gerarDespesaAutomaticamente: true,
      corPrincipal: "#112233",
      icone: "receipt",
      status: "ativo",
    });

  await processRecurring.run(scheduledEvent("2026-08-26T05:00:00.000Z"));

  const created = await db()
    .collection(`workspaces/${WORKSPACE}/transactions`).get();
  assert.equal(created.size, 1);
  assert.equal(created.docs[0].id, "rec_handler-assinatura_2020-01-10");
  assert.equal(created.docs[0].data().date, "2020-01-10");

  // O corpo do gatilho também é quem persiste o checkpoint.
  const checkpoint = await db().doc("job_checkpoints/recurring_expenses").get();
  assert.equal(checkpoint.data()?.lastRunGenerated, 1);
  assert.equal(checkpoint.data()?.lastRunTruncated, false);
});

test("o corpo do gatilho de deriva percorre a fatia e avança o cursor", async () => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  await db().doc("system/investment_drift_scan").delete();
  await db().doc(`workspaces/${WORKSPACE}`).set({
    type: "PF",
    name: WORKSPACE,
  });
  await db()
    .doc(`workspaces/${WORKSPACE}/investment_summaries/current`)
    .set({
      workspaceId: WORKSPACE,
      positionCount: 0,
      principalCents: 0,
      currentValueCents: 0,
      updatedAt: Timestamp.now(),
    });

  await processInvestmentDriftScan.run(
    scheduledEvent("2026-08-26T09:00:00.000Z"),
  );

  // A varredura registra o workspace conferido e deixa o cursor onde parou.
  const reports = await db()
    .collection(`workspaces/${WORKSPACE}/investment_drift_reports`).get();
  assert.equal(reports.size, 1);
  assert.equal(reports.docs[0].data().workspaceId, WORKSPACE);
  assert.equal(reports.docs[0].data().status, "clean");
  // A correlação deriva de `scheduleTime`: é o que liga o registro à execução.
  assert.equal(typeof reports.docs[0].data().correlationId, "string");

  const cursor = await db().doc("system/investment_drift_scan").get();
  assert.equal(cursor.exists, true);
});
