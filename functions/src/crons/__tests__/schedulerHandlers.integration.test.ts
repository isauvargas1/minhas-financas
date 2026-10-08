import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {processCreditCardInvoiceClosing} from "../../cards/closing";
import {FUNCTIONS_REGION} from "../../shared/runtimeOptions";
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
/*
 * A varredura de deriva pagina `workspaces` por id global, em fatias de
 * `DRIFT_WORKSPACES_PER_RUN`. Outras suítes deixam workspaces no Emulator,
 * então "o workspace do teste cai na primeira fatia" não é premissa estável.
 * O teste fixa o cursor imediatamente antes de um id reservado e adjacente, e
 * a fatia passa a começar exatamente no workspace alvo, qualquer que seja o
 * resto.
 */
const DRIFT_CURSOR_START = "zz-p2c-drift-000";
const DRIFT_WORKSPACE = "zz-p2c-drift-001";

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
    name: "processCreditCardInvoiceClosing",
    fn: processCreditCardInvoiceClosing,
    schedule: "every day 00:15",
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

/*
 * O corpo do gatilho de recorrentes (P4-B) é exercitado em
 * `recurring/__tests__/recurringScheduler.integration.test.ts`, no mesmo
 * arquivo da varredura: as duas percorrem o collection group global
 * `recurring_expenses`, e dentro de um arquivo os testes são sequenciais.
 */

test("o corpo do gatilho de deriva percorre a fatia e avança o cursor", async () => {
  const scheduleTime = "2026-08-26T09:00:00.000Z";
  await db().recursiveDelete(db().doc(`workspaces/${DRIFT_WORKSPACE}`));
  await db().doc(`workspaces/${DRIFT_WORKSPACE}`).set({
    type: "PF",
    name: DRIFT_WORKSPACE,
  });
  await db()
    .doc(`workspaces/${DRIFT_WORKSPACE}/investment_summaries/current`)
    .set({
      workspaceId: DRIFT_WORKSPACE,
      positionCount: 0,
      principalCents: 0,
      currentValueCents: 0,
      updatedAt: Timestamp.now(),
    });
  // A página começa logo depois do cursor: o alvo é o primeiro da fatia.
  await db().doc("system/investment_drift_scan").set({
    cursor: DRIFT_CURSOR_START,
  });

  await processInvestmentDriftScan.run(scheduledEvent(scheduleTime));

  // A varredura registra o workspace conferido e deixa o cursor onde parou.
  const reports = await db()
    .collection(`workspaces/${DRIFT_WORKSPACE}/investment_drift_reports`).get();
  assert.equal(reports.size, 1);
  assert.equal(reports.docs[0].data().workspaceId, DRIFT_WORKSPACE);
  assert.equal(reports.docs[0].data().status, "clean");
  // A correlação deriva de `scheduleTime`: é o que liga o registro à execução.
  assert.equal(
    reports.docs[0].data().correlationId,
    `drift-scan-${scheduleTime}`,
  );

  const cursor = await db().doc("system/investment_drift_scan").get();
  assert.equal(cursor.exists, true);
  // Pode haver ids posteriores na mesma fatia; o que importa é que avançou
  // pelo menos até o alvo.
  const nextCursor = cursor.data()?.cursor;
  assert.equal(typeof nextCursor, "string");
  assert.notEqual(nextCursor, DRIFT_CURSOR_START);
  assert.ok(nextCursor >= DRIFT_WORKSPACE);
  assert.ok(cursor.data()?.lastInspected >= 1);
  assert.equal(
    cursor.data()?.lastRunCorrelationId,
    `drift-scan-${scheduleTime}`,
  );
});
