import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

import {
  assertLedgerConsistent,
  balanceOf,
  movementsOf,
} from "../../accounts/testSupport/accountTestSupport";
import {cashAccountDocument} from "../../accounts/model";
import {runCashAccountReconciliation} from "../../accounts/reconciliation";
import {
  applyCashPeriodWriteOnce,
  cashPeriodEventKey,
} from "../../cash/periods";
import {ApplicationError} from "../../shared/errors";
import {
  callableRequest,
  defaultAccountOf,
  requireFirestoreEmulator,
  seedActiveAccount,
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import type {WorkspaceActor} from "../../shared/workspaceAuth";
import {createSimpleInvestment} from "../callables";
import {investmentCashEffect, readInvestmentCashEntry} from "../cashEffect";
import {
  executeCancelInvestmentMovement,
  executeCreateSimpleInvestment,
  executeLinkInvestmentToGoal,
  executeReverseInvestmentMovement,
  executeSettleInvestmentContribution,
  executeSettleSimpleWithdrawal,
  executeUnlinkInvestmentFromGoal,
  executeWithdrawSimpleInvestment,
} from "../operationsV2";
import {recordInvestmentCallableFailureSafely} from "../observability";
import {
  catalogSeedDocumentId,
  normalizeCatalogName,
} from "../../settingsCatalog/model";

/**
 * Investimentos no livro-razão das contas (D-15, D-30, P4-D).
 *
 * O que este arquivo prova:
 *
 * - **conta no mesmo commit** — aporte depositado e retirada recebida movem a
 *   conta escolhida (kind e domínio `investment`) junto com o movimento do
 *   domínio, a posição, as projeções, o espelho de caixa, a auditoria e a
 *   idempotência; pendente e cancelado não movem conta;
 * - **estorno na mesma conta** — a compensação usa a conta do original;
 * - **espelho = conta** — o efeito do espelho na projeção mensal do Caixa é o
 *   mesmo valor lançado na conta, e o saldo é a soma dos movimentos;
 * - **fonte única patrimonial** — o espelho nunca move patrimônio nem meta, e
 *   um documento `investimento` forjado não cria patrimônio nem caixa
 *   (PR-INV-01);
 * - **sem quota manual** (D-40), **replay** e **concorrência**.
 */

const firestore = requireFirestoreEmulator();
const db = (): admin.firestore.Firestore => firestore;

const WS_A = "inv-cash-workspace-a";
const WS_B = "inv-cash-workspace-b";
const OWNER_A = "inv-cash-owner-a";
const MEMBER_A = "inv-cash-member-a";
const VIEWER_A = "inv-cash-viewer-a";
const OWNER_B = "inv-cash-owner-b";
const GOAL = "inv-cash-goal";
const INSTITUTION = "inv-cash-institution";
const PORTFOLIO = "inv-cash-portfolio";
const CATEGORY = catalogSeedDocumentId(
  "category", "investimento", "both", "Tesouro Direto",
);
const SECOND_ACCOUNT = "inv-cash-conta-corrente";

const auth = (
  workspaceId = WS_A,
  uid = OWNER_A,
  role: WorkspaceActor["role"] = "owner",
): WorkspaceActor => ({workspaceId, uid, role});

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

const catalogItem = async (
  workspaceId: string,
  id: string,
  group: string,
  name: string,
  transactionSubtype?: string,
) => {
  const normalizedName = normalizeCatalogName(name);
  await db().doc(`workspaces/${workspaceId}/settings_catalog/${id}`).set({
    workspaceId, group, name, normalizedName,
    dedupeKey: [group, transactionSubtype ?? "all", "both", normalizedName]
      .join("::"),
    workspaceScope: "both", sortOrder: 10, status: "active",
    ...(transactionSubtype ? {transactionSubtype} : {}),
    createdBy: "seed", updatedBy: "seed",
    createdAt: at("2026-08-01T00:00:00.000Z"),
    updatedAt: at("2026-08-01T00:00:00.000Z"),
  });
};

const seed = async (): Promise<void> => {
  await Promise.all([
    db().recursiveDelete(db().doc(`workspaces/${WS_A}`)),
    db().recursiveDelete(db().doc(`workspaces/${WS_B}`)),
  ]);
  await Promise.all([OWNER_A, MEMBER_A, VIEWER_A, OWNER_B]
    .map((uid) => seedActiveAccount(uid)));
  await seedWorkspace({workspaceId: WS_A, ownerId: OWNER_A});
  await seedWorkspace({workspaceId: WS_B, ownerId: OWNER_B});
  await seedMember(WS_A, MEMBER_A, "member");
  await seedMember(WS_A, VIEWER_A, "viewer");
  await db().doc(`workspaces/${WS_A}/cash_accounts/${SECOND_ACCOUNT}`).set(
    cashAccountDocument({
      id: SECOND_ACCOUNT, workspaceId: WS_A, name: "Conta corrente",
      accountType: "checking", actorUid: OWNER_A,
    }));
  await Promise.all([
    db().doc(`workspaces/${WS_A}/goals/${GOAL}`).set({
      id: GOAL, workspaceId: WS_A, name: "Meta de investimento",
      progressBasis: "net_contributions",
      investmentNetContributionCents: 0,
      investmentCurrentValueCents: 0,
      investmentProgressCents: 0,
      investmentProjectionVersion: 0,
    }),
    catalogItem(WS_A, INSTITUTION, "investment_institution", "BTG"),
    catalogItem(WS_A, PORTFOLIO, "investment_class", "Aposentadoria"),
    catalogItem(WS_A, CATEGORY, "category", "Tesouro Direto", "investimento"),
  ]);
};

const CONTA_A = defaultAccountOf(WS_A);

interface NovoAporte {
  chave: string;
  valorCents?: number;
  liquidado?: boolean;
  conta?: string | null;
  metaId?: string;
  quando?: string;
  contexto?: WorkspaceActor;
}

const aportar = (opcoes: NovoAporte) => {
  const contexto = opcoes.contexto ?? auth();
  const liquidado = opcoes.liquidado ?? true;
  const conta = opcoes.conta === undefined ?
    (liquidado ? CONTA_A : null) :
    opcoes.conta;
  return executeCreateSimpleInvestment(contexto, {
    workspaceId: contexto.workspaceId,
    idempotencyKey: opcoes.chave,
    correlationId: `corr-${opcoes.chave}`,
    institutionId: INSTITUTION,
    classId: PORTFOLIO,
    typeId: CATEGORY,
    description: "Tesouro Selic 2029",
    valueCents: opcoes.valorCents ?? 100_000,
    settled: liquidado,
    occurredAt: opcoes.quando ?? "2026-08-10T12:00:00.000Z",
    ...(opcoes.metaId ? {goalId: opcoes.metaId} : {}),
    ...(conta ? {cashAccountId: conta} : {}),
  });
};

const retirar = (
  positionId: string,
  chave: string,
  valorCents: number,
  extras: {
    rendimentoCents?: number;
    recebido?: boolean;
    conta?: string | null;
    quando?: string;
  } = {},
) => {
  const recebido = extras.recebido ?? true;
  const conta = extras.conta === undefined ?
    (recebido ? CONTA_A : null) :
    extras.conta;
  return executeWithdrawSimpleInvestment(auth(), {
    workspaceId: WS_A,
    idempotencyKey: chave,
    correlationId: `corr-${chave}`,
    positionId,
    valueCents: valorCents,
    ...(extras.rendimentoCents === undefined ?
      {} : {gainCents: extras.rendimentoCents}),
    received: recebido,
    occurredAt: extras.quando ?? "2026-08-20T12:00:00.000Z",
    ...(conta ? {cashAccountId: conta} : {}),
  });
};

const estornar = (movementId: string, chave: string, quando =
"2026-08-25T12:00:00.000Z") => executeReverseInvestmentMovement(auth(), {
  workspaceId: WS_A,
  idempotencyKey: chave,
  correlationId: `corr-${chave}`,
  movementId,
  reversedAt: quando,
  reason: "Lançamento desfeito",
});

const doc = async (workspaceId: string, path: string) =>
  (await db().doc(`workspaces/${workspaceId}/${path}`).get()).data();

const movimento = (id: string) => doc(WS_A, `investment_movements/${id}`);
const espelho = (id: string) => doc(WS_A, `transactions/${id}`);
const posicao = (id: string) => doc(WS_A, `investment_positions/${id}`);
const resumo = () => doc(WS_A, "investment_summaries/current");
const meta = () => doc(WS_A, `goals/${GOAL}`);
const periodoCaixa = (chave: string) => doc(WS_A, `cash_report_periods/${chave}`);
const periodoPatrimonial = (chave: string) =>
  doc(WS_A, `investment_report_periods/${chave}`);

/** Entrega do gatilho de transações, como `onTransactionWrite`. */
const entregar = async (
  eventId: string,
  transactionId: string,
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
) => db().runTransaction((tx) => applyCashPeriodWriteOnce(
  tx, WS_A, cashPeriodEventKey(eventId), before, after,
  {
    transactionId,
    action: !before ? "CREATE" : !after ? "DELETE" : "UPDATE",
    eventTime: Timestamp.now(),
  },
));

const erro = async (executar: () => Promise<unknown>): Promise<Error> => {
  try {
    await executar();
  } catch (falha) {
    return falha as Error;
  }
  throw new Error("A operação deveria ter falhado.");
};

const movimentosDeInvestimento = async () =>
  (await movementsOf(WS_A)).filter((entry) => entry.sourceDomain === "investment");

// ---------------------------------------------------------------------------
// A. Aportes
// ---------------------------------------------------------------------------

test("aporte depositado sai da conta escolhida no mesmo commit", async () => {
  await seed();
  const criado = await aportar({
    chave: "cash-aporte-0000001", valorCents: 150_000, metaId: GOAL,
    conta: SECOND_ACCOUNT,
  });

  assert.equal(await balanceOf(WS_A, SECOND_ACCOUNT), -150_000,
    "saldo negativo é permitido: a conta começou zerada");
  assert.equal(await balanceOf(WS_A, CONTA_A), 0, "moveu a conta errada");

  const mov = await movimento(String(criado.movementId));
  assert.equal(mov?.cashAccountId, SECOND_ACCOUNT);
  assert.equal(mov?.accountMovementId, criado.accountMovementId);

  const [contaMov] = await movementsOf(WS_A, SECOND_ACCOUNT);
  assert.equal(contaMov.id, criado.accountMovementId);
  assert.equal(contaMov.kind, "investment");
  assert.equal(contaMov.sourceDomain, "investment");
  assert.equal(contaMov.sourceId, criado.movementId);
  assert.equal(contaMov.amountCents, -150_000);
  assert.equal(contaMov.effectiveDate, "2026-08-10");
  assert.equal(contaMov.reversalOf, null);

  const projecao = await espelho(String(criado.transactionId));
  assert.equal(projecao?.type, "investimento");
  assert.equal(projecao?.cashAccountId, SECOND_ACCOUNT);
  assert.equal(projecao?.accountMovementId, criado.accountMovementId);
  assert.equal(projecao?.source, "investment");
  assert.equal(projecao?.walletId, undefined);
  assert.equal(projecao?.goalId, undefined, "o espelho não carrega meta");
  assert.deepEqual(
    {operation: projecao?.investmentEntry?.operation,
      status: projecao?.investmentEntry?.status,
      amountCents: projecao?.investmentEntry?.amountCents},
    {operation: "contribution", status: "settled", amountCents: 150_000},
  );

  // Espelho = conta: a projeção do Caixa sai pelo mesmo valor.
  await entregar("evt-aporte-1", String(criado.transactionId), undefined, projecao);
  const periodo = await periodoCaixa("2026-08");
  assert.equal(periodo?.investmentOutflowCents, 150_000);
  assert.equal(periodo?.netCents, contaMov.amountCents);
  assert.equal(periodo?.expenseCents ?? 0, 0, "aporte virou despesa");

  // Patrimônio no domínio, meta pelo movimento.
  assert.equal((await posicao(String(criado.positionId)))?.principalCents, 150_000);
  assert.equal((await meta())?.investmentNetContributionCents, 150_000);
  await assertLedgerConsistent(WS_A);
});

test("aporte pendente não move conta; a confirmação move", async () => {
  await seed();
  const criado = await aportar({
    chave: "cash-pendente-000001", valorCents: 80_000, liquidado: false,
  });
  assert.equal(criado.accountMovementId, null);
  assert.equal(await balanceOf(WS_A, CONTA_A), 0);
  assert.equal((await movimentosDeInvestimento()).length, 0);
  const pendente = await espelho(String(criado.transactionId));
  assert.equal(pendente?.investmentEntry?.status, "pending");
  assert.equal(pendente?.cashAccountId, undefined);
  assert.equal((await movimento(String(criado.movementId)))?.cashAccountId,
    undefined);

  // Pendente com conta: recusado (a conta é escolhida na confirmação).
  assert.match(
    (await erro(() => aportar({
      chave: "cash-pendente-000002", liquidado: false, conta: CONTA_A,
    }))).message,
    /pendente não movimenta conta/i,
  );
  // Depositado sem conta: recusado.
  assert.match(
    (await erro(() => aportar({chave: "cash-pendente-000003", conta: null})))
      .message,
    /conta de origem/i,
  );

  const liquidar = () => executeSettleInvestmentContribution(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "cash-pendente-000004",
    correlationId: "corr-cash-pendente-000004",
    movementId: String(criado.movementId),
    settledAt: "2026-08-15T12:00:00.000Z",
    cashAccountId: SECOND_ACCOUNT,
  });
  const liquidado = await liquidar();
  assert.equal(await balanceOf(WS_A, SECOND_ACCOUNT), -80_000);
  const [contaMov] = await movimentosDeInvestimento();
  assert.equal(contaMov.id, liquidado.accountMovementId);
  assert.equal(contaMov.effectiveDate, "2026-08-15");
  const mov = await movimento(String(criado.movementId));
  assert.equal(mov?.cashAccountId, SECOND_ACCOUNT);
  assert.equal(mov?.accountMovementId, liquidado.accountMovementId);
  const projecao = await espelho(String(criado.transactionId));
  assert.equal(projecao?.investmentEntry?.status, "settled");
  assert.equal(projecao?.cashAccountId, SECOND_ACCOUNT);

  // Replay da confirmação: nada se move de novo.
  await liquidar();
  assert.equal(await balanceOf(WS_A, SECOND_ACCOUNT), -80_000);
  assert.equal((await movimentosDeInvestimento()).length, 1);
  await assertLedgerConsistent(WS_A);
});

// ---------------------------------------------------------------------------
// B. Retiradas
// ---------------------------------------------------------------------------

test("retirada recebida entra na conta: principal e rendimento separados", async () => {
  await seed();
  const criado = await aportar({chave: "cash-retirada-00001", valorCents: 200_000});
  const retirada = await retirar(String(criado.positionId), "cash-retirada-00002",
    55_000, {rendimentoCents: 5_000, conta: SECOND_ACCOUNT});

  assert.equal(await balanceOf(WS_A, SECOND_ACCOUNT), 55_000);
  const contaMov = (await movementsOf(WS_A, SECOND_ACCOUNT))[0];
  assert.equal(contaMov.amountCents, 55_000);
  assert.equal(contaMov.kind, "investment");
  assert.equal(contaMov.sourceId, retirada.movementId);

  const projecao = await espelho(String(retirada.transactionId));
  await entregar("evt-ret-1", String(retirada.transactionId), undefined, projecao);
  const periodo = await periodoCaixa("2026-08");
  assert.equal(periodo?.investmentInflowCents, 50_000, "principal retirado");
  assert.equal(periodo?.financialIncomeCents, 5_000, "rendimento realizado");
  assert.equal(periodo?.incomeCents ?? 0, 0, "principal virou receita");
  assert.equal(periodo?.netCents, contaMov.amountCents);

  // Patrimônio: só o principal sai; o rendimento é resultado realizado.
  const estado = await posicao(String(criado.positionId));
  assert.equal(estado?.principalCents, 150_000);
  assert.equal(estado?.realizedGainCents, 5_000);
  await assertLedgerConsistent(WS_A);
});

test("retirada pendente não move conta; a confirmação move na conta de destino", async () => {
  await seed();
  const criado = await aportar({chave: "cash-wpend-0000001", valorCents: 100_000});
  const saldoAntes = await balanceOf(WS_A, CONTA_A);
  const pedido = await retirar(String(criado.positionId), "cash-wpend-0000002",
    40_000, {recebido: false});
  assert.equal(pedido.accountMovementId, null);
  assert.equal(await balanceOf(WS_A, CONTA_A), saldoAntes);

  assert.match(
    (await erro(() => retirar(String(criado.positionId), "cash-wpend-0000003",
      10_000, {conta: null}))).message,
    /conta de destino/i,
  );

  const liquidado = await executeSettleSimpleWithdrawal(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "cash-wpend-0000004",
    correlationId: "corr-cash-wpend-0000004",
    movementId: String(pedido.movementId),
    settledAt: "2026-08-22T12:00:00.000Z",
    cashAccountId: SECOND_ACCOUNT,
  });
  assert.equal(await balanceOf(WS_A, SECOND_ACCOUNT), 40_000);
  assert.equal((await movimento(String(pedido.movementId)))?.cashAccountId,
    SECOND_ACCOUNT);
  assert.ok(liquidado.accountMovementId);
  await assertLedgerConsistent(WS_A);
});

// ---------------------------------------------------------------------------
// C. Estornos e cancelamento
// ---------------------------------------------------------------------------

test("estorno de aporte compensa na conta original, nunca em outra", async () => {
  await seed();
  const criado = await aportar({
    chave: "cash-estorno-000001", valorCents: 70_000, conta: SECOND_ACCOUNT,
  });
  const estorno = await estornar(String(criado.movementId), "cash-estorno-000002");

  assert.equal(await balanceOf(WS_A, SECOND_ACCOUNT), 0);
  assert.equal(await balanceOf(WS_A, CONTA_A), 0);
  const movimentos = await movementsOf(WS_A, SECOND_ACCOUNT);
  const compensacao = movimentos.find((entry) => entry.kind === "reversal");
  assert.ok(compensacao);
  assert.equal(compensacao.reversalOf, criado.accountMovementId);
  assert.equal(compensacao.sourceDomain, "investment");
  assert.equal(compensacao.amountCents, 70_000);
  assert.equal(compensacao.effectiveDate, "2026-08-25");

  const mov = await movimento(String(estorno.reversalMovementId));
  assert.equal(mov?.cashAccountId, SECOND_ACCOUNT);
  assert.equal(mov?.accountMovementId, compensacao.id);
  // O original é preservado, só marcado como estornado.
  const original = await movimento(String(criado.movementId));
  assert.equal(original?.status, "settled");
  assert.equal(original?.reversedByMovementId, estorno.reversalMovementId);

  // Espelho compensatório: desfaz a saída de investimento, não é receita.
  const projecao = await espelho(String(estorno.transactionId));
  assert.equal(projecao?.investmentEntry?.reversal, true);
  assert.equal(projecao?.investmentEntry?.reversalOf, criado.movementId);
  await entregar("evt-est-1", String(estorno.transactionId), undefined, projecao);
  const periodo = await periodoCaixa("2026-08");
  assert.equal(periodo?.investmentOutflowCents, -70_000);
  assert.equal(periodo?.incomeCents ?? 0, 0);
  assert.equal(periodo?.netCents, 70_000);

  // O estorno não aceita conta (o contrato é estrito) — nem pelo executor.
  await assert.rejects(() => executeReverseInvestmentMovement(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "cash-estorno-000003",
    correlationId: "corr-cash-estorno-000003",
    movementId: String(criado.movementId),
    reversedAt: "2026-08-26T12:00:00.000Z",
    reason: "Segunda tentativa",
  }), /já foi estornado/i);
  await assertLedgerConsistent(WS_A);
});

test("estorno de retirada sai da conta em que ela entrou", async () => {
  await seed();
  const criado = await aportar({chave: "cash-estret-0000001", valorCents: 100_000});
  const retirada = await retirar(String(criado.positionId), "cash-estret-0000002",
    30_000, {rendimentoCents: 2_000, conta: SECOND_ACCOUNT});
  assert.equal(await balanceOf(WS_A, SECOND_ACCOUNT), 30_000);
  const estorno = await estornar(String(retirada.movementId), "cash-estret-0000003");
  assert.equal(await balanceOf(WS_A, SECOND_ACCOUNT), 0);
  assert.equal(await balanceOf(WS_A, CONTA_A), -100_000, "a conta do aporte não muda");
  const projecao = await espelho(String(estorno.transactionId));
  await entregar("evt-estret-1", String(estorno.transactionId), undefined, projecao);
  const periodo = await periodoCaixa("2026-08");
  assert.equal(periodo?.investmentInflowCents, -28_000);
  assert.equal(periodo?.financialIncomeCents, -2_000);
  // Posição restaurada.
  const estado = await posicao(String(criado.positionId));
  assert.equal(estado?.principalCents, 100_000);
  assert.equal(estado?.realizedGainCents, 0);
  await assertLedgerConsistent(WS_A);
});

test("cancelar pendente não move conta e preserva o documento", async () => {
  await seed();
  const criado = await aportar({
    chave: "cash-cancel-0000001", liquidado: false, valorCents: 25_000,
  });
  await executeCancelInvestmentMovement(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "cash-cancel-0000002",
    correlationId: "corr-cash-cancel-0000002",
    movementId: String(criado.movementId),
    occurredAt: "2026-08-11T12:00:00.000Z",
    reason: "Não aconteceu",
  });
  assert.equal((await movimentosDeInvestimento()).length, 0);
  assert.equal(await balanceOf(WS_A, CONTA_A), 0);
  const projecao = await espelho(String(criado.transactionId));
  assert.equal(projecao?.investmentEntry?.status, "cancelled");
  assert.equal(projecao?.cashAccountId, undefined);
  await entregar("evt-cancel-1", String(criado.transactionId), undefined, projecao);
  assert.equal((await periodoCaixa("2026-08"))?.netCents ?? 0, 0);
  assert.equal((await movimento(String(criado.movementId)))?.status, "cancelled");
});

// ---------------------------------------------------------------------------
// D. Conta arquivada, outro workspace, falha antes do commit
// ---------------------------------------------------------------------------

test("conta arquivada recusa fato novo e compensação, sem escrita parcial", async () => {
  await seed();
  const criado = await aportar({
    chave: "cash-arq-000000001", valorCents: 10_000, conta: SECOND_ACCOUNT,
  });
  await db().doc(`workspaces/${WS_A}/cash_accounts/${SECOND_ACCOUNT}`)
    .update({status: "archived"});

  const novo = await erro(() => aportar({
    chave: "cash-arq-000000002", conta: SECOND_ACCOUNT,
  }));
  assert.ok(novo instanceof ApplicationError);
  assert.match(novo.message, /arquivada/i);

  const compensacao = await erro(() =>
    estornar(String(criado.movementId), "cash-arq-000000003"));
  assert.match(compensacao.message, /arquivada/i);
  assert.equal((await movimento(String(criado.movementId)))?.reversedByMovementId,
    undefined);
  assert.equal((await posicao(String(criado.positionId)))?.principalCents, 10_000);
  assert.equal(await balanceOf(WS_A, SECOND_ACCOUNT), -10_000);
  assert.equal((await movementsOf(WS_A, SECOND_ACCOUNT)).length, 1);
  assert.equal(
    (await db().collection(`workspaces/${WS_A}/investment_movements`).get()).size,
    1,
  );
});

test("conta de outro workspace não existe aqui; nada é escrito", async () => {
  await seed();
  const falha = await erro(() => aportar({
    chave: "cash-cross-00000001", conta: defaultAccountOf(WS_B),
  }));
  assert.ok(falha instanceof ApplicationError);
  assert.equal((falha as ApplicationError).code, "not_found");
  assert.equal(await balanceOf(WS_B, defaultAccountOf(WS_B)), 0);
  for (const colecao of ["investment_movements", "investment_positions",
    "transactions", "cash_account_movements"]) {
    assert.equal(
      (await db().collection(`workspaces/${WS_A}/${colecao}`).get()).size, 0,
      colecao,
    );
  }
  assert.equal(
    (await db().collection(`workspaces/${WS_B}/cash_account_movements`).get()).size,
    0,
  );
});

test("falha depois de ler a conta não deixa movimento nem saldo", async () => {
  await seed();
  const falha = await erro(() => aportar({
    chave: "cash-falha-0000001", metaId: "meta-inexistente",
  }));
  assert.match(falha.message, /meta/i);
  assert.equal(await balanceOf(WS_A, CONTA_A), 0);
  assert.equal((await movementsOf(WS_A)).length, 0);
  assert.equal((await db().collection(`workspaces/${WS_A}/transactions`).get()).size, 0);
});

// ---------------------------------------------------------------------------
// E. Replay e concorrência
// ---------------------------------------------------------------------------

test("replay devolve o mesmo resultado e move a conta uma vez", async () => {
  await seed();
  const primeiro = await aportar({chave: "cash-replay-0000001", valorCents: 33_000});
  const segundo = await aportar({chave: "cash-replay-0000001", valorCents: 33_000});
  assert.deepEqual(segundo, primeiro);
  assert.equal(await balanceOf(WS_A, CONTA_A), -33_000);
  assert.equal((await movimentosDeInvestimento()).length, 1);
});

test("aportes concorrentes na mesma conta não perdem saldo", async () => {
  await seed();
  const valores = [10_000, 20_000, 30_000, 40_000, 50_000];
  await Promise.all(valores.map((valorCents, index) => aportar({
    chave: `cash-conc-${String(index).padStart(10, "0")}`, valorCents,
  })));
  // A mesma intenção em rajada: um fato só.
  await Promise.all([0, 1, 2].map(() => aportar({
    chave: "cash-conc-mesma-00001", valorCents: 7_000,
  }).catch(() => undefined)));
  assert.equal(await balanceOf(WS_A, CONTA_A), -157_000);
  assert.equal((await movimentosDeInvestimento()).length, 6);
  await assertLedgerConsistent(WS_A);
  const reconciliacao = await runCashAccountReconciliation(WS_A);
  assert.deepEqual(reconciliacao.divergentAccountIds, []);
  assert.equal(reconciliacao.orphanMovementCount, 0);
});

// ---------------------------------------------------------------------------
// F. Fonte única patrimonial (PR-INV-01)
// ---------------------------------------------------------------------------

test("o espelho não move patrimônio nem meta; documento forjado não cria nada", async () => {
  await seed();
  const criado = await aportar({
    chave: "cash-fonte-0000001", valorCents: 60_000, metaId: GOAL,
  });
  const patrimonio = await resumo();
  const progresso = (await meta())?.investmentNetContributionCents;

  // Reescrever o espelho pelo Admin SDK (o cliente nem consegue) não toca o
  // domínio patrimonial: posição, resumo e meta só mudam por movimento.
  await db().doc(`workspaces/${WS_A}/transactions/${criado.transactionId}`)
    .update({valueCents: 999_999, value: 9_999.99});
  assert.deepEqual(await resumo(), patrimonio);
  assert.equal((await meta())?.investmentNetContributionCents, progresso);

  // Documento `investimento` sem marca: não é aporte, não move caixa e não
  // cria patrimônio.
  const forjado = {
    type: "investimento", description: "Aporte forjado", category: "Investimentos",
    value: 500, valueCents: 50_000, date: "2026-08-12", isPaid: true,
    transactionDate: at("2026-08-12T12:00:00.000Z"),
    workspaceId: WS_A, userId: OWNER_A, goalId: GOAL,
    investmentMetadata: {status: "settled", cashImpact: "outflow",
      investmentOperation: "contribution", principalCents: 50_000},
  };
  await db().doc(`workspaces/${WS_A}/transactions/forjado-1`).set(forjado);
  await entregar("evt-forjado-1", "forjado-1", undefined, forjado);
  const periodo = await periodoCaixa("2026-08");
  assert.equal(periodo?.investmentOutflowCents ?? 0, 0);
  assert.equal(periodo?.netCents ?? 0, 0);
  assert.deepEqual(await resumo(), patrimonio);
  assert.equal((await meta())?.investmentNetContributionCents, progresso);
  assert.equal(
    (await db().collection(`workspaces/${WS_A}/investment_positions`).get()).size,
    1,
  );
});

test("a meta tem uma fonte: o movimento; vínculo e desvínculo não movem caixa", async () => {
  await seed();
  const vinculado = await aportar({
    chave: "cash-meta-00000001", valorCents: 100_000, metaId: GOAL,
  });
  const livre = await aportar({chave: "cash-meta-00000002", valorCents: 40_000});
  assert.equal((await meta())?.investmentNetContributionCents, 100_000);
  const saldo = await balanceOf(WS_A, CONTA_A);

  const posicaoLivre = await posicao(String(livre.positionId));
  await executeLinkInvestmentToGoal(auth(), {
    workspaceId: WS_A, idempotencyKey: "cash-meta-00000003",
    correlationId: "corr-cash-meta-00000003",
    accountId: String(posicaoLivre?.accountId),
    assetId: String(posicaoLivre?.assetId),
    goalId: GOAL, occurredAt: "2026-08-13T12:00:00.000Z",
    reason: "Passa a compor a meta",
  });
  assert.equal((await meta())?.investmentNetContributionCents, 140_000);
  assert.equal(await balanceOf(WS_A, CONTA_A), saldo, "vincular moveu conta");

  await executeUnlinkInvestmentFromGoal(auth(), {
    workspaceId: WS_A, idempotencyKey: "cash-meta-00000004",
    correlationId: "corr-cash-meta-00000004",
    accountId: String(posicaoLivre?.accountId),
    assetId: String(posicaoLivre?.assetId),
    goalId: GOAL, occurredAt: "2026-08-14T12:00:00.000Z",
    reason: "Sai da meta",
  });
  assert.equal((await meta())?.investmentNetContributionCents, 100_000);

  // O gatilho de caixa sobre o espelho não é uma segunda fonte da meta.
  const projecao = await espelho(String(vinculado.transactionId));
  await entregar("evt-meta-1", String(vinculado.transactionId), undefined, projecao);
  await entregar("evt-meta-1", String(vinculado.transactionId), undefined, projecao);
  assert.equal((await meta())?.investmentNetContributionCents, 100_000);
  assert.equal((await periodoCaixa("2026-08"))?.investmentOutflowCents, 100_000);

  // Retirada com rendimento reduz só o principal da meta.
  await retirar(String(vinculado.positionId), "cash-meta-00000005", 35_000,
    {rendimentoCents: 5_000});
  assert.equal((await meta())?.investmentNetContributionCents, 70_000);
});

// ---------------------------------------------------------------------------
// G. Quota manual (D-40) e período oficial do dashboard
// ---------------------------------------------------------------------------

test("investimento não consome a quota mensal de lançamentos (D-40)", async () => {
  await seed();
  const criado = await aportar({chave: "cash-quota-0000001"});
  await retirar(String(criado.positionId), "cash-quota-0000002", 10_000);
  await estornar(String(criado.movementId), "cash-quota-0000003")
    .catch(() => undefined);
  const quota = await db().collection(`workspaces/${WS_A}/quota_state`).get();
  const mensais = quota.docs.filter((entry) => entry.id.startsWith("transactions_"));
  assert.deepEqual(mensais.map((entry) => entry.id), []);
});

test("aporte do mês oficial: líquido do estorno e alinhado ao espelho", async () => {
  await seed();
  const a = await aportar({chave: "cash-mes-000000001", valorCents: 100_000});
  await aportar({chave: "cash-mes-000000002", valorCents: 50_000});
  await aportar({
    chave: "cash-mes-000000003", valorCents: 20_000, liquidado: false,
  });
  await estornar(String(a.movementId), "cash-mes-000000004",
    "2026-08-28T12:00:00.000Z");
  const periodo = await periodoPatrimonial("2026-08");
  // Pendente não entra; o estorno desconta no mês do estorno.
  assert.equal(periodo?.contributionCents, 50_000);

  // A saída de caixa para investimento do mês (espelhos) é o mesmo número.
  const espelhos = await db().collection(`workspaces/${WS_A}/transactions`).get();
  for (const entry of espelhos.docs) {
    await entregar(`evt-mes-${entry.id}`, entry.id, undefined, entry.data());
  }
  assert.equal((await periodoCaixa("2026-08"))?.investmentOutflowCents, 50_000);
});

test("o corte do período usa America/Sao_Paulo, não UTC", async () => {
  await seed();
  // 02:30 UTC de 1º de setembro ainda é 31 de agosto em São Paulo.
  await aportar({
    chave: "cash-corte-0000001", valorCents: 12_000,
    quando: "2026-09-01T02:30:00.000Z",
  });
  assert.equal((await periodoPatrimonial("2026-08"))?.contributionCents, 12_000);
  assert.equal(await periodoPatrimonial("2026-09"), undefined);
  const [contaMov] = await movimentosDeInvestimento();
  assert.equal(contaMov.effectiveDate, "2026-08-31");
});

// ---------------------------------------------------------------------------
// H. Papéis e observabilidade
// ---------------------------------------------------------------------------

test("viewer não registra investimento; membro registra na conta escolhida", async () => {
  await seed();
  await assert.rejects(
    () => aportar({chave: "cash-papel-0000001", contexto: auth(WS_A, VIEWER_A, "viewer")}),
  );
  const criado = await aportar({
    chave: "cash-papel-0000002", contexto: auth(WS_A, MEMBER_A, "member"),
  });
  assert.equal(criado.status, "settled");
  // Estorno é de owner/admin.
  await assert.rejects(() => executeReverseInvestmentMovement(
    auth(WS_A, MEMBER_A, "member"), {
      workspaceId: WS_A, idempotencyKey: "cash-papel-0000003",
      correlationId: "corr-cash-papel-0000003",
      movementId: String(criado.movementId),
      reversedAt: "2026-08-20T12:00:00.000Z", reason: "Tentativa de membro",
    }));
  assert.equal(await balanceOf(WS_A, CONTA_A), -100_000);
});

test("falha de callable fica só no workspace autorizado", async () => {
  await seed();
  const intruso = "inv-cash-intruso";
  await seedActiveAccount(intruso);
  await assert.rejects(
    () => createSimpleInvestment.run(callableRequest(intruso, {
      workspaceId: WS_A,
      idempotencyKey: "cash-obs-000000001",
      correlationId: "corr-cash-obs-000000001",
      institutionId: INSTITUTION, classId: PORTFOLIO, typeId: CATEGORY,
      description: "Intruso", valueCents: 1_000,
      occurredAt: "2026-08-10T12:00:00.000Z", cashAccountId: CONTA_A,
    })),
    (error: unknown) =>
      error instanceof HttpsError && error.code === "permission-denied",
  );
  assert.equal(
    (await db().collection(`workspaces/${WS_A}/investment_event_logs`).get()).size,
    0,
  );

  // Falha de quem passou pela pré-checagem: registrada no próprio workspace.
  await recordInvestmentCallableFailureSafely(
    "createSimpleInvestment",
    callableRequest(OWNER_A, {
      workspaceId: WS_A, correlationId: "corr-cash-obs-000000002",
      idempotencyKey: "cash-obs-000000002",
    }),
    new ApplicationError("domain_precondition_failed", "Falha simulada."),
    WS_A,
  );
  const falhas = await db()
    .collection(`workspaces/${WS_A}/investment_event_logs`)
    .where("outcome", "==", "failed").get();
  assert.equal(falhas.size, 1);
  assert.equal(falhas.docs[0].data().operation, "createSimpleInvestment");
});


// ---------------------------------------------------------------------------
// H. Reconciliação: fonte única patrimonial e caixa a partir do ledger
// ---------------------------------------------------------------------------

/**
 * Sem rebuild público (D-15), a prova de que as projeções são derivadas é a
 * reconstrução aqui: posição, resumo e período mensal batem com a soma dos
 * movimentos liquidados; as contas batem com a soma dos movimentos de conta;
 * e o efeito de caixa dos espelhos é exatamente o efeito do ledger — o
 * espelho nunca é lido para patrimônio.
 */
test("projeções, contas e espelhos se reconstroem do ledger", async () => {
  await seed();
  const a = await aportar({chave: "rec-aporte-000001", valorCents: 200_000});
  const b = await aportar({
    chave: "rec-aporte-000002", valorCents: 50_000, liquidado: false,
  });
  await executeSettleInvestmentContribution(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "rec-confirma-0001",
    correlationId: "corr-rec-confirma-0001",
    movementId: String(b.movementId),
    settledAt: "2026-08-12T12:00:00.000Z",
    cashAccountId: SECOND_ACCOUNT,
  });
  const r = await retirar(String(a.positionId), "rec-retira-000001", 60_000,
    {rendimentoCents: 10_000});
  await estornar(String(r.movementId), "rec-estorno-00001");
  await retirar(String(a.positionId), "rec-retira-000002", 30_000,
    {rendimentoCents: 5_000, conta: SECOND_ACCOUNT});
  const pendente = await retirar(String(a.positionId), "rec-retira-000003",
    5_000, {recebido: false});
  await executeCancelInvestmentMovement(auth(), {
    workspaceId: WS_A,
    idempotencyKey: "rec-cancela-00001",
    correlationId: "corr-rec-cancela-00001",
    movementId: String(pendente.movementId),
    occurredAt: "2026-08-26T12:00:00.000Z",
    reason: "Não aconteceu",
  });
  const estornoAporte = await aportar({
    chave: "rec-aporte-000003", valorCents: 7_000,
  });
  await estornar(String(estornoAporte.movementId), "rec-estorno-00002");

  const movimentos = (await db()
    .collection(`workspaces/${WS_A}/investment_movements`).get())
    .docs.map((entry) => entry.data());
  const liquidados = movimentos.filter((entry) => entry.status === "settled");
  const soma = (lista: admin.firestore.DocumentData[], campo: string) =>
    lista.reduce((total, entry) => total + Number(entry[campo] ?? 0), 0);

  // Posições: capital = Σ principalDelta dos liquidados; regime por valor.
  const posicoes = (await db()
    .collection(`workspaces/${WS_A}/investment_positions`).get()).docs;
  for (const entry of posicoes) {
    const daPosicao = liquidados.filter(
      (movement) => movement.positionId === entry.id);
    assert.equal(entry.get("principalCents"),
      soma(daPosicao, "principalDeltaCents"), entry.id);
    assert.equal(entry.get("currentValueCents"), entry.get("principalCents"));
  }
  // Resumo = Σ posições.
  const total = posicoes.reduce(
    (acc, entry) => acc + Number(entry.get("principalCents")), 0);
  assert.equal((await resumo())?.principalCents, total);
  assert.equal((await resumo())?.currentValueCents, total);

  // Período mensal (todos os fatos em agosto, America/Sao_Paulo).
  const periodo = await periodoPatrimonial("2026-08");
  assert.equal(periodo?.costDeltaCents,
    soma(liquidados, "principalDeltaCents"));
  assert.equal(periodo?.cashDeltaCents, soma(liquidados, "cashDeltaCents"));
  // Aporte do mês = aportes liquidados − estorno de aporte: 200.000 +
  // 50.000 + 7.000 − 7.000.
  assert.equal(periodo?.contributionCents, 250_000);
  // Retirada: 50.000 estornada, 25.000 recebida (o pendente cancelado não
  // conta).
  assert.equal(periodo?.redemptionPrincipalCents, 25_000);
  assert.equal(periodo?.realizedGainCents, 5_000);

  // Contas: cada movimento de conta de investimento é o efeito de caixa do
  // movimento liquidado, na conta registrada nele.
  const deConta = await movimentosDeInvestimento();
  assert.equal(deConta.length, liquidados.length);
  for (const movement of liquidados) {
    const daConta = deConta.find(
      (entry) => entry.id === movement.accountMovementId);
    assert.ok(daConta, `sem movimento de conta para ${movement.id}`);
    assert.equal(daConta.accountId, movement.cashAccountId);
    assert.equal(daConta.amountCents, movement.cashDeltaCents);
  }
  for (const conta of [CONTA_A, SECOND_ACCOUNT]) {
    assert.equal(await balanceOf(WS_A, conta), soma(
      liquidados.filter((movement) => movement.cashAccountId === conta),
      "cashDeltaCents"));
  }
  await assertLedgerConsistent(WS_A);

  // Espelhos: efeito líquido = Σ cashDelta; pendente e cancelado, zero.
  const espelhos = (await db().collection(`workspaces/${WS_A}/transactions`)
    .where("type", "==", "investimento").get()).docs
    .map((entry) => entry.data());
  assert.equal(espelhos.length, movimentos.filter(
    (entry) => entry.operation !== "goal_link" &&
      entry.operation !== "goal_unlink").length);
  const efeito = espelhos.reduce((acc, entry) => {
    const marca = readInvestmentCashEntry(entry.investmentEntry);
    assert.ok(marca, "espelho sem marca válida");
    return acc + investmentCashEffect(marca).netCents;
  }, 0);
  assert.equal(efeito, soma(liquidados, "cashDeltaCents"));
});

/**
 * PF e PJ seguem o mesmo contrato de conta: o contexto vem do workspace
 * (nunca do payload), fica fotografado em ativo, posição, resumo e período,
 * e a conta movimentada é a do próprio workspace PJ.
 */
test("workspace PJ: aporte e retirada movem a conta do PJ com contexto PJ",
  async () => {
    await seed();
    const WS_PJ = "inv-cash-workspace-pj";
    const OWNER_PJ = "inv-cash-owner-pj";
    await db().recursiveDelete(db().doc(`workspaces/${WS_PJ}`));
    await seedActiveAccount(OWNER_PJ);
    await seedWorkspace({workspaceId: WS_PJ, ownerId: OWNER_PJ, type: "PJ"});
    await Promise.all([
      catalogItem(WS_PJ, INSTITUTION, "investment_institution", "BTG"),
      catalogItem(WS_PJ, PORTFOLIO, "investment_class", "Caixa e liquidez"),
      catalogItem(WS_PJ, CATEGORY, "category", "Tesouro Direto",
        "investimento"),
    ]);
    const contaPj = defaultAccountOf(WS_PJ);
    const contexto = auth(WS_PJ, OWNER_PJ);
    const criado = await aportar({
      chave: "cash-pj-aporte-0001", valorCents: 300_000, contexto,
      conta: contaPj,
    });
    const retirada = await executeWithdrawSimpleInvestment(contexto, {
      workspaceId: WS_PJ,
      idempotencyKey: "cash-pj-retira-0001",
      correlationId: "corr-cash-pj-retira-0001",
      positionId: String(criado.positionId),
      valueCents: 80_000,
      gainCents: 20_000,
      received: true,
      occurredAt: "2026-08-20T12:00:00.000Z",
      cashAccountId: contaPj,
    });

    assert.equal(await balanceOf(WS_PJ, contaPj), -300_000 + 80_000);
    const movimentosPj = (await movementsOf(WS_PJ))
      .filter((entry) => entry.sourceDomain === "investment");
    assert.deepEqual(
      movimentosPj.map((entry) => entry.amountCents).sort((a, b) => a - b),
      [-300_000, 80_000]);
    await assertLedgerConsistent(WS_PJ);

    const pj = async (path: string) => doc(WS_PJ, path);
    assert.equal((await pj(`investment_positions/${criado.positionId}`))
      ?.profileType, "PJ");
    assert.equal((await pj(`investment_positions/${criado.positionId}`))
      ?.principalCents, 240_000);
    assert.equal((await pj("investment_summaries/current"))?.profileType,
      "PJ");
    const periodo = await pj("investment_report_periods/2026-08");
    assert.equal(periodo?.profileType, "PJ");
    assert.equal(periodo?.contributionCents, 300_000);
    assert.equal(periodo?.redemptionPrincipalCents, 60_000);
    assert.equal(periodo?.realizedGainCents, 20_000);

    const espelhoPj = await pj(`transactions/${retirada.transactionId}`);
    assert.equal(espelhoPj?.cashAccountId, contaPj);
    const marca = readInvestmentCashEntry(espelhoPj?.investmentEntry);
    assert.ok(marca);
    assert.deepEqual(investmentCashEffect(marca), {
      investmentOutflowCents: 0,
      investmentInflowCents: 60_000,
      financialIncomeCents: 20_000,
      netCents: 80_000,
    });

    // Nada vazou para o workspace PF.
    assert.equal((await movimentosDeInvestimento()).length, 0);
    assert.equal(await resumo(), undefined);
  });
