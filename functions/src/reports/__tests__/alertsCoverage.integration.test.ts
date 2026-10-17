import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {CASH_PERIODS_COLLECTION} from "../../cash/periods";
import {MAX_CASH_PERIODS} from "../../cash/rebuild";
import {db} from "../../workspaces/testSupport/p1TestSupport";
import {executeGetFinancialReport} from "../report";
import {actorOf, preset, seedReportTenant} from "./reportSupport";

/**
 * P5-D2 (§15.1) — as condições do período só se dizem completas quando
 * TODAS as fontes foram avaliadas. Com o caixa indisponível ("todo o
 * período" acima do teto de meses), o resultado operacional e a base de
 * recebimentos não foram avaliados: o bloco sai `truncated` com
 * `partial_sources`, e a interface não pode afirmar "Tudo certo".
 */

db();

const seedTooManyPeriods = async (workspaceId: string): Promise<void> => {
  const periods = db().collection(
    `workspaces/${workspaceId}/${CASH_PERIODS_COLLECTION}`);
  let batch = db().batch();
  let size = 0;
  for (let index = 0; index <= MAX_CASH_PERIODS; index += 1) {
    const year = 1900 + Math.floor(index / 12);
    const monthIndex = index % 12;
    const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    batch.set(periods.doc(month), {
      periodStart: Timestamp.fromDate(new Date(Date.UTC(year, monthIndex, 1))),
    });
    size += 1;
    if (size === 400) {
      await batch.commit();
      batch = db().batch();
      size = 0;
    }
  }
  if (size > 0) await batch.commit();
};

test("P5-D2 alertas com o caixa indisponível (todo o período acima do " +
  "teto) declaram cobertura parcial, nunca completa", async () => {
  const t = await seedReportTenant("PF", "p5d2-cov");
  await seedTooManyPeriods(t.workspaceId);
  const report = await executeGetFinancialReport(actorOf(t), {
    workspaceId: t.workspaceId,
    range: preset("all"),
    sections: ["alerts"],
  });
  assert.equal(report.alerts.status, "truncated");
  assert.equal(report.alerts.reason, "partial_sources");
  assert.deepEqual(report.alerts.data?.items.map((item) => item.code)
    .filter((code) => code === "negative_operational_result" ||
      code === "insufficient_base"), [],
  "condições de caixa não avaliadas não aparecem");
});

test("P5-D2 controle: com todas as fontes avaliadas e sem condições, o " +
  "bloco de alertas é completo", async () => {
  const t = await seedReportTenant("PF", "p5d2-cov-ok");
  const report = await executeGetFinancialReport(actorOf(t), {
    workspaceId: t.workspaceId,
    range: preset("30d"),
    sections: ["alerts"],
  });
  assert.ok(report.alerts.status === "zero" ||
    report.alerts.status === "exact", `status ${report.alerts.status}`);
});
