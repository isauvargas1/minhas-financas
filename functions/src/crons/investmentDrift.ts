import * as admin from "firebase-admin";
import {FieldPath, FieldValue, Timestamp} from "firebase-admin/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";

import {saoPauloDayKey} from "../shared/dateKeys";
import {RETENTION_DAYS, expiresInDays} from "../shared/retention";
import {SCHEDULED_FUNCTION_OPTIONS} from "../shared/runtimeOptions";
import {
  INVESTMENT_COLLECTIONS,
  investmentCollection,
  investmentDoc,
} from "../investments/paths";

/**
 * Detecção agendada de deriva do domínio patrimonial (INV-P2-019).
 *
 * A deriva entre o ledger de fatos e as projeções acumuladas só era medida
 * **durante** um rebuild, e o rebuild só roda quando alguém o dispara. Uma
 * divergência entre `investment_movements` e `investment_summaries` podia
 * persistir indefinidamente sem ninguém saber — e o produto não tinha nem
 * sequer como saber que precisava reconstruir.
 *
 * ## Por que a comparação é esta
 *
 * Reconstruir tudo diariamente seria caro e redundante: já existe
 * `rebuildInvestmentProjections` para isso, e ele é a **correção**, não a
 * **detecção**. O que esta rotina faz é a conferência barata que qualquer
 * divergência precisa violar:
 *
 * - a soma dos `principalCents` das posições tem de bater com o
 *   `principalCents` do resumo;
 * - o mesmo para `currentValueCents`, resultado realizado, taxas e imposto;
 * - o número de posições expostas tem de bater com `positionCount`;
 * - o fechamento do último mês da série tem de bater com o patrimônio do
 *   resumo.
 *
 * Todas são leituras de projeção — nenhuma varre o ledger de movimentos.
 *
 * ## Por que não varre todos os workspaces
 *
 * A varredura é **amostrada por rodízio**: cada execução cobre uma fatia dos
 * workspaces com domínio patrimonial ativo, avançando um cursor persistido.
 * Em poucas execuções o rodízio cobre a base inteira, e o custo por execução é
 * limitado por construção. Varrer todos os tenants todo dia é exatamente o
 * padrão de custo que o domínio combate.
 *
 * ## O que é registrado
 *
 * `workspaceId`, correlação, tipo de deriva, magnitude, instante e status.
 * **Nenhum dado de pessoa e nenhum lançamento individual**: a magnitude é
 * agregada e existe para dimensionar a gravidade, não para reconstruir o
 * conteúdo financeiro.
 */

const db = () => admin.firestore();

/** Workspaces conferidos por execução. */
export const DRIFT_WORKSPACES_PER_RUN = 50;

/** Posições lidas por workspace. Acima disso a conferência é inconclusiva. */
export const DRIFT_POSITIONS_PER_WORKSPACE = 500;

/** Tolerância em centavos. Zero: o domínio é exato por construção. */
export const DRIFT_TOLERANCE_CENTS = 0;

const CURSOR_DOC = "system/investment_drift_scan";

export interface DriftFinding {
  kind: string;
  expected: number;
  published: number;
  differenceCents: number;
}

interface PositionTotals {
  positionCount: number;
  principalCents: number;
  currentValueCents: number;
  realizedGainCents: number;
  realizedLossCents: number;
  feesCents: number;
  taxCents: number;
}

const integerOrZero = (value: unknown): number =>
  Number.isSafeInteger(value) ? (value as number) : 0;

const emptyTotals = (): PositionTotals => ({
  positionCount: 0,
  principalCents: 0,
  currentValueCents: 0,
  realizedGainCents: 0,
  realizedLossCents: 0,
  feesCents: 0,
  taxCents: 0,
});

/**
 * Compara projeções entre si e devolve as divergências.
 *
 * Exportada para teste: é a regra de decisão, e ela precisa ser verificável
 * sem subir agendador.
 */
export const compareInvestmentProjections = (
  totals: PositionTotals,
  summary: admin.firestore.DocumentData | undefined,
  latestClosingCents: number | undefined,
): DriftFinding[] => {
  if (!summary) return [];
  const findings: DriftFinding[] = [];

  const compare = (
    kind: string,
    expected: number,
    published: number,
  ): void => {
    const difference = expected - published;
    if (Math.abs(difference) > DRIFT_TOLERANCE_CENTS) {
      findings.push({
        kind,
        expected,
        published,
        differenceCents: difference,
      });
    }
  };

  compare("principal", totals.principalCents, integerOrZero(summary.principalCents));
  compare("current_value", totals.currentValueCents, integerOrZero(summary.currentValueCents));
  compare("realized_gain", totals.realizedGainCents, integerOrZero(summary.realizedGainCents));
  compare("realized_loss", totals.realizedLossCents, integerOrZero(summary.realizedLossCents));
  compare("fees", totals.feesCents, integerOrZero(summary.feesCents));
  compare("tax", totals.taxCents, integerOrZero(summary.taxCents));
  compare("position_count", totals.positionCount, integerOrZero(summary.positionCount));

  // O fechamento do último mês materializado tem de ser o patrimônio atual: é
  // a mesma grandeza vista pela série e pelo resumo. Divergência aqui é
  // exatamente o sintoma que INV-P1-005 e INV-P2-015 corrigiram no rebuild.
  if (latestClosingCents !== undefined) {
    compare(
      "closing_vs_summary",
      integerOrZero(summary.currentValueCents),
      latestClosingCents,
    );
  }

  return findings;
};

/** Soma as posições publicadas do workspace, com teto explícito. */
const readPositionTotals = async (
  workspaceId: string,
): Promise<{totals: PositionTotals; truncated: boolean}> => {
  const snapshot = await investmentCollection(
    workspaceId,
    INVESTMENT_COLLECTIONS.positions,
  )
    .orderBy(FieldPath.documentId())
    .limit(DRIFT_POSITIONS_PER_WORKSPACE + 1)
    .get();

  const truncated = snapshot.size > DRIFT_POSITIONS_PER_WORKSPACE;
  const totals = emptyTotals();
  snapshot.docs
    .slice(0, DRIFT_POSITIONS_PER_WORKSPACE)
    .forEach((entry) => {
      const data = entry.data();
      const quantity = integerOrZero(data.quantityMicros);
      const principal = integerOrZero(data.principalCents);
      const currentValue = integerOrZero(data.currentValueCents);
      if (quantity !== 0 || principal !== 0 || currentValue !== 0) {
        totals.positionCount += 1;
      }
      totals.principalCents += principal;
      totals.currentValueCents += currentValue;
      totals.realizedGainCents += integerOrZero(data.realizedGainCents);
      totals.realizedLossCents += integerOrZero(data.realizedLossCents);
      totals.feesCents += integerOrZero(data.feesCents);
      totals.taxCents += integerOrZero(data.taxCents);
    });

  return {totals, truncated};
};

/** Fechamento do mês mais recente da série. */
const readLatestClosing = async (
  workspaceId: string,
): Promise<number | undefined> => {
  const snapshot = await investmentCollection(
    workspaceId,
    INVESTMENT_COLLECTIONS.reportPeriods,
  )
    .orderBy("periodStart", "desc")
    .limit(1)
    .get();
  const data = snapshot.docs[0]?.data();
  if (!data) return undefined;
  return Number.isSafeInteger(data.closingCurrentValueCents) ?
    (data.closingCurrentValueCents as number) :
    undefined;
};

/**
 * Confere um workspace e registra o resultado.
 *
 * Exportada para que o teste possa injetar deriva e verificar o registro sem
 * depender do agendador.
 */
export const inspectWorkspaceDrift = async (
  workspaceId: string,
  correlationId: string,
): Promise<{findings: DriftFinding[]; inconclusive: boolean}> => {
  // O resumo é lido primeiro, sozinho, e não em paralelo com as demais
  // leituras: ele é a peneira do rodízio. Sem ele o workspace nunca processou
  // movimento e não há o que conferir, então varrer posições e fechamentos
  // antes de saber disso gastaria três leituras onde uma basta.
  const summarySnapshot = await investmentDoc(
    workspaceId,
    INVESTMENT_COLLECTIONS.summaries,
    "current",
  ).get();

  const summary = summarySnapshot.data();
  if (!summary) return {findings: [], inconclusive: false};

  const [positions, latestClosing] = await Promise.all([
    readPositionTotals(workspaceId),
    readLatestClosing(workspaceId),
  ]);

  const findings = positions.truncated ?
    [] :
    compareInvestmentProjections(positions.totals, summary, latestClosing);

  const dayKey = saoPauloDayKey();
  const reportId = `${dayKey}_${workspaceId}`.replace(/[^\w-]/g, "_").slice(0, 96);

  await investmentDoc(
    workspaceId,
    INVESTMENT_COLLECTIONS.driftReports,
    reportId,
  ).set(
    {
      id: reportId,
      workspaceId,
      date: dayKey,
      correlationId,
      status: positions.truncated ?
        "inconclusive" :
        findings.length > 0 ? "drift_detected" : "clean",
      // Só tipo e magnitude agregada. Nenhum lançamento, nenhuma pessoa.
      findings: findings.map((finding) => ({
        kind: finding.kind,
        differenceCents: finding.differenceCents,
      })),
      findingCount: findings.length,
      maxDifferenceCents: findings.reduce(
        (max, finding) => Math.max(max, Math.abs(finding.differenceCents)),
        0,
      ),
      positionsInspected: positions.totals.positionCount,
      detectedAt: FieldValue.serverTimestamp(),
      expiresAt: expiresInDays(RETENTION_DAYS.eventLogs),
    },
    {merge: false},
  );

  if (findings.length > 0) {
    // Log estruturado sem valor financeiro individual: o suficiente para
    // alertar e localizar, nunca para reconstruir conteúdo.
    console.error("investment_drift_detected", {
      workspaceId,
      correlationId,
      kinds: findings.map((finding) => finding.kind),
      findingCount: findings.length,
    });
  }

  return {findings, inconclusive: positions.truncated};
};

/**
 * Fatia de workspaces desta execução, avançando o cursor de rodízio.
 *
 * O cursor é global (não por tenant) e vive fora das coleções de workspace,
 * porque a varredura é da plataforma, não de um cliente.
 */
const nextWorkspaceSlice = async (): Promise<{
  ids: string[];
  nextCursor: string | null;
}> => {
  const cursorSnapshot = await db().doc(CURSOR_DOC).get();
  const cursor = typeof cursorSnapshot.data()?.cursor === "string" ?
    (cursorSnapshot.data()?.cursor as string) :
    undefined;

  let query = db()
    .collection("workspaces")
    .orderBy(FieldPath.documentId())
    .limit(DRIFT_WORKSPACES_PER_RUN);
  if (cursor) query = query.startAfter(cursor);

  let page = await query.get();
  // Fim da lista: recomeça do início no próximo rodízio.
  if (page.empty && cursor) {
    page = await db()
      .collection("workspaces")
      .orderBy(FieldPath.documentId())
      .limit(DRIFT_WORKSPACES_PER_RUN)
      .get();
  }

  // O rodízio cobre todos os workspaces: o domínio patrimonial é único e não
  // há mais flag para filtrar. O custo continua limitado porque
  // `inspectWorkspaceDrift` sai na primeira leitura quando o workspace nunca
  // processou movimento — um workspace sem investimentos custa 1 leitura.
  const ids = page.docs.map((entry) => entry.id);

  return {
    ids,
    nextCursor: page.docs[page.docs.length - 1]?.id ?? null,
  };
};

export const processInvestmentDriftScan = onSchedule(
  {
    ...SCHEDULED_FUNCTION_OPTIONS,
    schedule: "every day 06:00",
    timeZone: "America/Sao_Paulo",
  },
  async (event) => {
    const correlationId = `drift-scan-${event.scheduleTime ?? saoPauloDayKey()}`;
    const slice = await nextWorkspaceSlice();

    let inspected = 0;
    let withDrift = 0;
    let inconclusive = 0;

    for (const workspaceId of slice.ids) {
      try {
        const result = await inspectWorkspaceDrift(workspaceId, correlationId);
        inspected += 1;
        if (result.inconclusive) inconclusive += 1;
        else if (result.findings.length > 0) withDrift += 1;
      } catch (error) {
        // A falha de um workspace não pode interromper o rodízio inteiro.
        console.error("investment_drift_scan_workspace_failed", {
          workspaceId,
          correlationId,
          errorCode: error instanceof Error ? error.name : "unknown",
        });
      }
    }

    await db().doc(CURSOR_DOC).set(
      {
        cursor: slice.nextCursor,
        lastRunAt: FieldValue.serverTimestamp(),
        lastRunCorrelationId: correlationId,
        lastInspected: inspected,
        lastWithDrift: withDrift,
        lastInconclusive: inconclusive,
        lastRunDate: saoPauloDayKey(),
      },
      {merge: true},
    );

    console.log("investment_drift_scan_completed", {
      correlationId,
      inspected,
      withDrift,
      inconclusive,
      nextCursor: slice.nextCursor ? "set" : "restart",
    });
  },
);

/** Reexportado para teste do teto de retenção. */
export const driftReportExpiry = (): Timestamp =>
  expiresInDays(RETENTION_DAYS.eventLogs);
