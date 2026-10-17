import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

import {
  create as createLoan,
  createPayload as loanPayload,
} from "../../loans/testSupport/loanTestSupport";
import {ApplicationError} from "../../shared/errors";
import type {LogFields, OperationLogger} from "../../shared/logger";
import {seedMember} from "../../shared/testSupport/kernelTestSupport";
import {call, db} from "../../workspaces/testSupport/p1TestSupport";
import {getFinancialReport} from "../callables";
import {readCardsSection} from "../cards";
import type {FinancialReport, ReportSection} from "../contract";
import {
  executeGetFinancialReport,
  isRecoverableReadError,
  type ReportReaders,
} from "../report";
import {
  actorOf,
  createEntry,
  exact,
  seedReportTenant,
  sync,
  type ReportTenant,
} from "./reportSupport";

/**
 * P5-C2, L8 — falha de um domínio sem derrubar o relatório inteiro.
 *
 * Os leitores dos blocos independentes do caixa são injetados pelo parâmetro
 * tipado `readers` (sem gancho global nem mock do SDK). Só falha passageira
 * de leitura (código gRPC de infraestrutura ou contenção) vira bloco
 * `unavailable`; erro de domínio, de autorização, estrutural ou invariante
 * quebrada continua derrubando a chamada.
 */

/** Erro com código gRPC, como o Admin SDK entrega. */
const grpcError = (code: number, message: string): Error =>
  Object.assign(new Error(message), {code});

const failing = (error: unknown) => async (): Promise<never> => {
  throw error;
};

const run = (
  t: ReportTenant,
  readers: Partial<ReportReaders>,
  options: {role?: "owner" | "viewer"; uid?: string;
    sections?: ReportSection[]; log?: OperationLogger} = {},
): Promise<FinancialReport> => executeGetFinancialReport(
  actorOf(t, options.uid ?? t.owner, options.role ?? "owner"),
  {
    workspaceId: t.workspaceId,
    range: {kind: "preset", preset: "30d"},
    ...(options.sections ? {sections: options.sections} : {}),
  },
  new Date(),
  {readers, log: options.log},
);

/** Logger que só guarda os eventos, para provar que vai código e não dado. */
const recordingLogger = () => {
  const events: Array<{event: string; fields: LogFields}> = [];
  const logger: OperationLogger = {
    context: {},
    with: () => logger,
    info: (event, fields = {}) => {
      events.push({event, fields});
    },
    warn: (event, fields = {}) => {
      events.push({event, fields});
    },
    error: (event, _error, fields = {}) => {
      events.push({event, fields});
    },
  };
  return {logger, events};
};

const tenantWithCash = async (prefix: string) => {
  const t = await seedReportTenant("PF", prefix);
  await createEntry(t, {type: "receita", amountCents: 50_000});
  await createEntry(t, {type: "despesa", amountCents: 12_000});
  await sync(t.workspaceId);
  return t;
};

test("isRecoverableReadError: só infraestrutura passageira do Firestore",
  () => {
    for (const code of [1, 2, 4, 8, 10, 13, 14]) {
      assert.equal(isRecoverableReadError(grpcError(code, "x")), true,
        `gRPC ${code}`);
    }
    for (const code of [3, 5, 6, 7, 9, 11, 12, 16]) {
      assert.equal(isRecoverableReadError(grpcError(code, "x")), false,
        `gRPC ${code} não é passageiro`);
    }
    assert.equal(isRecoverableReadError(
      new ApplicationError("permission_denied", "Sem permissão.")), false);
    assert.equal(isRecoverableReadError(
      new ApplicationError("internal" as never, "x")), false);
    assert.equal(isRecoverableReadError(new Error("soma fora da faixa")),
      false, "erro sem código é invariante ou defeito");
    assert.equal(isRecoverableReadError(new TypeError("x")), false);
    assert.equal(isRecoverableReadError(
      Object.assign(new Error("x"), {code: "unavailable"})), false,
    "código textual não é do Admin SDK");
    assert.equal(isRecoverableReadError(null), false);
  });

test("L8-01 falha passageira na leitura de cartões: cartões indisponíveis " +
  "com motivo fixo; caixa, KPIs, série e categorias seguem exatos",
async () => {
  const t = await tenantWithCash("l8c01");
  const r = await run(t, {
    cards: failing(grpcError(14, "14 UNAVAILABLE: conexão perdida")),
  });
  assert.equal(r.cards.status, "unavailable");
  assert.equal(r.cards.reason, "temporarily_unavailable");
  assert.equal(r.cards.data, null, "nunca zero nem lista vazia de cartões");
  assert.equal(exact(r.cash, "caixa").receiptsCents, 50_000);
  assert.equal(exact(r.cash, "caixa").paymentsCents, 12_000);
  assert.ok(r.kpis.status === "exact" || r.kpis.status === "zero");
  assert.ok(r.series.status === "exact" || r.series.status === "zero");
  assert.ok(r.categories.status === "exact" ||
    r.categories.status === "zero");
  assert.ok(r.accounts.status === "exact" || r.accounts.status === "zero");
  assert.doesNotMatch(JSON.stringify(r), /UNAVAILABLE|conexão perdida/,
    "a mensagem do SDK não vaza no relatório");
});

test("L8-02 dívidas dependem de cartões: empréstimos e recebíveis seguem, " +
  "mas o bloco vem parcial e sem obrigações de cartão", async () => {
  const t = await tenantWithCash("l8c02");
  await createLoan(t.owner, loanPayload(t.workspaceId,
    {principalCents: 300_000}));
  const r = await run(t, {
    cards: failing(grpcError(4, "DEADLINE_EXCEEDED")),
  });
  assert.equal(r.debts.status, "truncated");
  assert.equal(r.debts.reason, "partial_sources");
  assert.ok(r.debts.data, "empréstimos e recebíveis continuam visíveis");
  assert.equal(r.debts.data.cardObligationsCents, null,
    "obrigação de cartão ausente, nunca R$ 0,00");
  assert.equal(r.debts.data.loansBorrowed.balanceCents, 300_000);

  // Com cartões disponíveis o mesmo bloco é exato e traz a obrigação.
  const ok = await run(t, {});
  assert.equal(ok.debts.status, "exact");
  assert.equal(exact(ok.debts, "dívidas").cardObligationsCents, 0);
});

test("L8-03 alertas com cartões indisponíveis declaram cobertura parcial " +
  "e mantêm os alertas de empréstimo, que não dependem de cartões",
async () => {
  const t = await tenantWithCash("l8c03");
  const {loanId} = await createLoan(t.owner, loanPayload(t.workspaceId,
    {principalCents: 300_000}));
  // Estado persistido de atraso do empréstimo (o relatório só o lê).
  await db().doc(`workspaces/${t.workspaceId}/loans/${loanId}`)
    .update({status: "overdue"});
  const r = await run(t, {cards: failing(grpcError(14, "x"))},
    {sections: ["alerts"]});
  assert.equal(r.alerts.status, "truncated");
  assert.equal(r.alerts.reason, "partial_sources");
  assert.equal(r.cards.status, "not_requested");
  const loanAlert = r.alerts.data?.items.find((item) =>
    item.code === "overdue_borrowed_loans");
  assert.ok(loanAlert, "o alerta crítico do empréstimo não some");
  assert.equal(loanAlert.severity, "critical");
  assert.equal(loanAlert.values.overdueBalanceCents, 300_000);
  assert.equal(loanAlert.values.overdueCount, 1);

  // Com cartões disponíveis, o mesmo alerta e cobertura completa.
  const ok = await run(t, {}, {sections: ["alerts"]});
  assert.equal(ok.alerts.status, "exact");
  assert.ok(ok.alerts.data?.items.some((item) =>
    item.code === "overdue_borrowed_loans"));
});

test("L8-04 erro de autorização ou de domínio dentro do leitor não é " +
  "mascarado como indisponibilidade", async () => {
  const t = await tenantWithCash("l8c04");
  for (const error of [
    new ApplicationError("permission_denied", "Sem permissão."),
    new ApplicationError("workspace_membership_required", "Sem acesso."),
    grpcError(7, "PERMISSION_DENIED"),
    grpcError(16, "UNAUTHENTICATED"),
  ]) {
    await assert.rejects(run(t, {cards: failing(error)}),
      (thrown) => thrown === error, `não mascarar: ${String(error)}`);
  }
});

test("L8-05 invariante quebrada e falha estrutural derrubam a chamada " +
  "(nunca resultado parcial)", async () => {
  const t = await tenantWithCash("l8c05");
  for (const error of [
    new Error("soma fora da faixa segura: remainingCents"),
    new TypeError("Cannot read properties of undefined"),
    grpcError(9, "FAILED_PRECONDITION: The query requires an index"),
    grpcError(3, "INVALID_ARGUMENT"),
  ]) {
    await assert.rejects(run(t, {debts: failing(error)}),
      (thrown) => thrown === error);
    await assert.rejects(run(t, {cards: failing(error)}),
      (thrown) => thrown === error);
  }
});

test("L8-06 erro de rede transitório e contenção isolados por bloco; o log " +
  "leva o bloco e o código, sem a mensagem", async () => {
  const t = await tenantWithCash("l8c06");
  const {logger, events} = recordingLogger();
  const r = await run(t, {
    accounts: failing(grpcError(10, "ABORTED: contenção")),
    investments: failing(grpcError(8, "RESOURCE_EXHAUSTED")),
    debts: failing(grpcError(13, "INTERNAL dado sensível 4111")),
  }, {log: logger});
  assert.equal(r.accounts.status, "unavailable");
  assert.equal(r.investments.status, "unavailable");
  assert.equal(r.debts.status, "unavailable");
  for (const section of [r.accounts, r.investments, r.debts]) {
    assert.equal(section.reason, "temporarily_unavailable");
    assert.equal(section.data, null);
  }
  assert.ok(r.cards.status === "zero" || r.cards.status === "exact",
    "cartões, sem falha, seguem");
  assert.equal(exact(r.cash, "caixa").receiptsCents, 50_000);
  assert.equal(r.alerts.status, "truncated");
  const warned = events.filter((item) =>
    item.event === "financial_report.section_unavailable");
  assert.deepEqual(warned.map((item) => item.fields.section).sort(),
    ["accounts", "debts", "investments"]);
  assert.deepEqual(warned.map((item) => item.fields.errorCode).sort(),
    ["10", "13", "8"]);
  assert.doesNotMatch(JSON.stringify(events), /sensível|4111|contenção/);
});

test("L8-07 recuperação: depois da falha, a consulta seguinte volta exata",
  async () => {
    const t = await tenantWithCash("l8c07");
    let attempts = 0;
    const flaky: ReportReaders["cards"] = async (input) => {
      attempts += 1;
      if (attempts === 1) throw grpcError(14, "UNAVAILABLE");
      return readCardsSection(input);
    };
    const first = await run(t, {cards: flaky});
    assert.equal(first.cards.status, "unavailable");
    const second = await run(t, {cards: flaky});
    assert.ok(second.cards.status === "zero" ||
      second.cards.status === "exact");
    assert.ok(second.cards.data, "segunda leitura com números");
    assert.equal(attempts, 2);
  });

test("L8-08 investimentos indisponíveis preservam a matriz do viewer: sem " +
  "patrimônio, sem permissão nova, caixa exato", async () => {
  const t = await tenantWithCash("l8c08");
  const r = await run(t, {investments: failing(grpcError(14, "x"))},
    {role: "viewer", uid: t.viewer});
  assert.equal(r.permissions.investments, false);
  assert.equal(r.investments.status, "unavailable");
  assert.equal(r.investments.data, null);
  assert.equal(exact(r.cash, "caixa").receiptsCents, 50_000);
});

const httpsCode = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    assert.ok(error instanceof HttpsError, String(error));
    return error.code;
  }
};

test("L8-09 membro removido e membro de outro workspace continuam " +
  "recusados pela callable (nada de relatório parcial)", async () => {
  const a = await tenantWithCash("l8c09a");
  const b = await seedReportTenant("PF", "l8c09b");
  const payload = (workspaceId: string) =>
    ({workspaceId, range: {kind: "preset", preset: "30d"}});
  await seedMember(a.workspaceId, a.member, "member", "removed");
  assert.equal(await httpsCode(call(getFinancialReport, a.member,
    payload(a.workspaceId))), "permission-denied");
  assert.equal(await httpsCode(call(getFinancialReport, b.owner,
    payload(a.workspaceId))), "permission-denied");
  assert.equal(await httpsCode(call(getFinancialReport, a.owner,
    payload(b.workspaceId))), "permission-denied");
  // O dono de A segue lendo o próprio relatório.
  const own = await call<FinancialReport>(getFinancialReport, a.owner,
    payload(a.workspaceId));
  assert.equal(exact(own.cash, "caixa").receiptsCents, 50_000);
});
