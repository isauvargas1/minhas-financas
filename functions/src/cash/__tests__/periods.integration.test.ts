import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {
  CashContractViolationError,
  applyCashPeriodWrite,
  applyCashPeriodWriteOnce,
  cashDayKeyFor,
  cashPeriodDeltaFor,
  cashPeriodEventKey,
  cashPeriodEventRef,
  cashPeriodKeyFor,
  cashDaysMatchMonth,
  cashWritePlanFor,
  normalizeCashPeriodDelta,
  readCashDayDeltas,
} from "../periods";
import {
  CASH_REBUILD_CONTRACT_VIOLATION_MESSAGE,
  CASH_REBUILD_STATE_IDS,
  executeRebuildCashPeriods,
} from "../rebuild";
import {CASH_ENTRY_MAX_CENTS} from "../contracts";
import {ApplicationError} from "../../shared/errors";

/**
 * Projeção mensal de caixa (INV-P1-011).
 *
 * É ela que permite ao produto parar de varrer a subcoleção inteira de
 * transações para responder "qual é o saldo acumulado". Um acumulador só é
 * aceitável quando é reconstrutível a partir dos fatos, então a reconstrução é
 * testada contra o caminho incremental.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório.");
}

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const WORKSPACE = "cash-periods-workspace";
const ACTOR = "cash-periods-actor";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

const transaction = (overrides: Record<string, unknown>) => ({
  type: "despesa",
  description: "Lançamento",
  category: "Casa",
  valueCents: 10_000,
  date: "2026-08-10",
  userId: ACTOR,
  workspaceId: WORKSPACE,
  ...overrides,
});

const reset = async () => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
};

const period = async (key: string) =>
  (await db().doc(`workspaces/${WORKSPACE}/cash_report_periods/${key}`).get())
    .data();

/** Aplica a escrita como o gatilho faria, numa transação própria. */
const applyWrite = async (
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
) => {
  await db().runTransaction(async (tx) => {
    applyCashPeriodWrite(
      tx as unknown as Parameters<typeof applyCashPeriodWrite>[0],
      WORKSPACE,
      before,
      after,
    );
  });
};

/**
 * Uma entrega do gatilho, exatamente como `onTransactionWrite` a executa:
 * dedupe e incremento na mesma transação, endereçados pelo `event.id`.
 */
const deliver = async (
  eventId: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  transactionId = "tx-entrega",
) => {
  const action = !before ? "CREATE" : !after ? "DELETE" : "UPDATE";
  return db().runTransaction((tx) =>
    applyCashPeriodWriteOnce(
      tx,
      WORKSPACE,
      cashPeriodEventKey(eventId),
      before,
      after,
      {transactionId, action, eventTime: Timestamp.now()},
    ),
  );
};

test("classificação de caixa espelha a semântica do produto", () => {
  assert.equal(cashPeriodDeltaFor(transaction({type: "receita"})).netCents, 10_000);
  assert.equal(cashPeriodDeltaFor(transaction({type: "despesa"})).netCents, -10_000);
  // `parcelado` não existe em `transactions` (a compra vive em cartões):
  // violação de contrato, nunca despesa.
  assert.throws(
    () => cashPeriodDeltaFor(transaction({type: "parcelado"})),
    (error: unknown) => error instanceof CashContractViolationError &&
      error.field === "type",
  );

  // Espelho de investimento (P4-D): a marca `investmentEntry` decide.
  const entry = (overrides: Record<string, unknown> = {}) => ({
    domainVersion: 1, movementId: "mov-1", operation: "contribution",
    reversal: false, reversalOf: null, status: "settled",
    principalCents: 10_000, gainCents: 0, amountCents: 10_000, currency: "BRL",
    ...overrides,
  });
  // Aporte é saída de caixa contabilizada à parte das despesas de consumo.
  const contribution = cashPeriodDeltaFor(transaction({
    type: "investimento", investmentEntry: entry(),
  }));
  assert.equal(contribution.netCents, -10_000);
  assert.equal(contribution.expenseCents, 0);
  assert.equal(contribution.investmentOutflowCents, 10_000);

  // Investimento sem marca: fora do contrato, violação (PR-INV-01, P5-C2).
  assert.throws(
    () => cashPeriodDeltaFor(transaction({type: "investimento"})),
    (error: unknown) => error instanceof CashContractViolationError &&
      error.field === "type",
  );

  // Retirada pendente não é fato consumado: não toca caixa.
  assert.equal(cashPeriodDeltaFor(transaction({
    type: "investimento",
    investmentEntry: entry({operation: "redemption", status: "pending"}),
  })).netCents, 0);

  // Retirada recebida entra no caixa como principal de investimento.
  const redemption = cashPeriodDeltaFor(transaction({
    type: "investimento", investmentEntry: entry({operation: "redemption"}),
  }));
  assert.equal(redemption.netCents, 10_000);
  assert.equal(redemption.investmentInflowCents, 10_000);
  assert.equal(redemption.incomeCents, 0);

  // Baixa lógica não conta (INV-P2-032).
  assert.equal(cashPeriodDeltaFor(transaction({
    type: "receita",
    voidedAt: at("2026-08-11T10:00:00.000Z"),
  })).netCents, 0);

  // Centavos exatos vêm só de `valueCents`; `value` em reais nunca é lido.
  assert.equal(cashPeriodDeltaFor(transaction({
    type: "receita", valueCents: 1_001,
  })).netCents, 1_001);
  assert.equal(cashPeriodDeltaFor(transaction({
    type: "receita", valueCents: 1_001, value: 10.005,
  })).netCents, 1_001);
});

test("documento fora do contrato lança violação; anulado vale zero", () => {
  const violation = (field: string) => (error: unknown): boolean =>
    error instanceof CashContractViolationError && error.field === field;
  const semCentavos = transaction({type: "receita"}) as Record<string, unknown>;
  delete semCentavos.valueCents;

  // Só `value` em reais, sem `valueCents`: não é lido (nunca vira R$ 0,00).
  assert.throws(() => cashPeriodDeltaFor({...semCentavos, value: 100}),
    violation("valueCents"));
  for (const valueCents of [10.5, -1, "10000", null, Number.NaN]) {
    assert.throws(() => cashPeriodDeltaFor(transaction({valueCents})),
      violation("valueCents"), String(valueCents));
  }
  // Tipo desconhecido; marca de domínio ilegível.
  assert.throws(() => cashPeriodDeltaFor(transaction({type: "transferencia"})),
    violation("type"));
  assert.throws(() => cashPeriodDeltaFor(transaction({loanEntry: {}})),
    violation("marker"));

  // Anulado vale zero mesmo com dado inválido; pendente válido vale zero.
  const anulado = at("2026-08-11T10:00:00.000Z");
  assert.equal(cashPeriodDeltaFor(transaction({
    type: "parcelado", valueCents: 10.5, voidedAt: anulado,
  })).netCents, 0);
  assert.equal(cashPeriodDeltaFor(transaction({
    isPaid: false, cashEntry: {status: "pending"},
  })).netCents, 0);
  // Pendente com `valueCents` inválido ainda é violação.
  assert.throws(() => cashPeriodDeltaFor({
    ...semCentavos, isPaid: false, cashEntry: {status: "pending"},
  }), violation("valueCents"));
});

test("criação, alteração, troca de mês e exclusão mantêm o saldo exato", async () => {
  await reset();

  const receita = transaction({type: "receita", valueCents: 50_000});
  await applyWrite(undefined, receita);
  assert.equal((await period("2026-08"))?.netCents, 50_000);
  assert.equal((await period("2026-08"))?.incomeCents, 50_000);
  assert.equal((await period("2026-08"))?.transactionCount, 1);

  // Alteração de valor no mesmo mês: um único incremento combinado.
  const corrigida = {...receita, valueCents: 30_000};
  await applyWrite(receita, corrigida);
  assert.equal((await period("2026-08"))?.netCents, 30_000);
  assert.equal((await period("2026-08"))?.transactionCount, 1);

  // Troca de mês: sai de agosto, entra em julho.
  const movida = {...corrigida, date: "2026-07-05"};
  await applyWrite(corrigida, movida);
  assert.equal((await period("2026-08"))?.netCents, 0);
  assert.equal((await period("2026-08"))?.transactionCount, 0);
  assert.equal((await period("2026-07"))?.netCents, 30_000);
  assert.equal((await period("2026-07"))?.transactionCount, 1);

  // Exclusão retira o efeito por completo.
  await applyWrite(movida, undefined);
  assert.equal((await period("2026-07"))?.netCents, 0);
  assert.equal((await period("2026-07"))?.transactionCount, 0);
});

test("reconstrução reproduz o caminho incremental e é idempotente", async () => {
  await reset();

  const rows = [
    transaction({type: "receita", valueCents: 100_000, date: "2026-06-10"}),
    transaction({type: "despesa", valueCents: 40_000, date: "2026-06-20"}),
    transaction({
      type: "investimento", valueCents: 20_000, date: "2026-07-05",
      investmentEntry: {
        domainVersion: 1, movementId: "mov-c", operation: "contribution",
        reversal: false, reversalOf: null, status: "settled",
        principalCents: 20_000, gainCents: 0, amountCents: 20_000,
        currency: "BRL",
      },
    }),
    transaction({type: "receita", valueCents: 90_000, date: "2026-07-25"}),
    transaction({
      type: "investimento", valueCents: 15_000, date: "2026-08-02",
      investmentEntry: {
        domainVersion: 1, movementId: "mov-r", operation: "redemption",
        reversal: false, reversalOf: null, status: "settled",
        principalCents: 15_000, gainCents: 0, amountCents: 15_000,
        currency: "BRL",
      },
    }),
  ];

  // Caminho incremental, como o gatilho faz.
  for (const [index, row] of rows.entries()) {
    await db().doc(`workspaces/${WORKSPACE}/transactions/tx-${index}`).set(row);
    await applyWrite(undefined, row);
  }

  const incremental = {
    "2026-06": await period("2026-06"),
    "2026-07": await period("2026-07"),
    "2026-08": await period("2026-08"),
  };
  assert.equal(incremental["2026-06"]?.netCents, 60_000);
  assert.equal(incremental["2026-07"]?.netCents, 70_000);
  assert.equal(incremental["2026-08"]?.netCents, 15_000);

  // Injeta deriva para provar que a reconstrução a corrige.
  await db().doc(`workspaces/${WORKSPACE}/cash_report_periods/2026-07`).set(
    {netCents: 999_999},
    {merge: true},
  );

  const first = await executeRebuildCashPeriods(WORKSPACE, ACTOR, {
    workspaceId: WORKSPACE,
    idempotencyKey: "cash-rebuild-0001",
    correlationId: "corr-cash-rebuild",
    pageSize: 2,
    reason: "Reconstrução de teste",
    dryRun: false,
  });
  // Página pequena de propósito: exercita a retomada por cursor.
  let result = first;
  for (let page = 0; page < 20 && result.completed !== true; page += 1) {
    result = await executeRebuildCashPeriods(WORKSPACE, ACTOR, {
      workspaceId: WORKSPACE,
      idempotencyKey: `cash-rebuild-${page}-0002`,
      correlationId: "corr-cash-rebuild",
      pageSize: 2,
      reason: "Reconstrução de teste",
    dryRun: false,
    });
  }
  assert.equal(result.completed, true);

  for (const key of ["2026-06", "2026-07", "2026-08"] as const) {
    const rebuilt = await period(key);
    assert.equal(
      rebuilt?.netCents,
      incremental[key]?.netCents,
      `Mês ${key} precisa bater com o caminho incremental.`,
    );
    assert.equal(rebuilt?.incomeCents, incremental[key]?.incomeCents);
    assert.equal(rebuilt?.expenseCents, incremental[key]?.expenseCents);
    assert.equal(
      rebuilt?.investmentOutflowCents,
      incremental[key]?.investmentOutflowCents,
    );
  }

  // Saldo global = soma dos meses.
  const balance = ["2026-06", "2026-07", "2026-08"]
    .reduce(async (accumulator, key) => (
      await accumulator) + Number((await period(key))?.netCents ?? 0), Promise.resolve(0));
  assert.equal(await balance, 60_000 + 70_000 + 15_000);

  await reset();
});

test("reconstrução zera período órfão sem lastro no ledger", async () => {
  await reset();
  const row = transaction({type: "receita", valueCents: 10_000});
  await db().doc(`workspaces/${WORKSPACE}/transactions/tx-only`).set(row);

  // Período sobrevivente de uma execução anterior, sem transação que o sustente.
  await db().doc(`workspaces/${WORKSPACE}/cash_report_periods/2026-01`).set({
    id: "2026-01", workspaceId: WORKSPACE, period: "2026-01",
    periodStart: at("2026-01-01T03:00:00.000Z"),
    incomeCents: 999_999, expenseCents: 0, investmentOutflowCents: 0,
    netCents: 999_999, transactionCount: 1,
  });

  const result = await executeRebuildCashPeriods(WORKSPACE, ACTOR, {
    workspaceId: WORKSPACE,
    idempotencyKey: "cash-rebuild-orfao-0001",
    correlationId: "corr-cash-rebuild-orfao",
    pageSize: 100,
    reason: "Reconstrução de teste",
    dryRun: false,
  });
  assert.equal(result.completed, true);

  assert.equal((await period("2026-01"))?.netCents, 0);
  assert.equal((await period("2026-01"))?.transactionCount, 0);
  assert.equal((await period("2026-08"))?.netCents, 10_000);

  await reset();
});

test("chave mensal é o prefixo de `date`, sem conversão de fuso", () => {
  assert.equal(cashPeriodKeyFor({date: "2026-08-31"}), "2026-08");
  assert.equal(cashDayKeyFor({date: "2026-08-31"}), "2026-08-31");
  // 22:00 BRT de 31/08 é 01:00 UTC de 01/09: um `transactionDate`
  // remanescente não compete com `date`.
  assert.equal(
    cashPeriodKeyFor({
      date: "2026-08-31",
      transactionDate: at("2026-09-01T01:00:00.000Z"),
    }),
    "2026-08",
  );
  // Sem `date`, o instante não é lido: violação de contrato.
  assert.throws(
    () => cashPeriodKeyFor({transactionDate: at("2026-09-01T01:00:00.000Z")}),
    (error: unknown) => error instanceof CashContractViolationError &&
      error.field === "date",
  );
});

/**
 * Reentrega do gatilho (INV-P3-001).
 *
 * O Eventarc entrega **pelo menos** uma vez: quando a execução anterior não
 * confirma a tempo, o mesmo `event.id` volta. Como o período é mantido por
 * `FieldValue.increment`, a segunda entrega somava o mesmo delta de novo — e o
 * saldo acumulado do workspace passava a mentir sem erro e sem log.
 *
 * O teste executa o **mesmo evento duas vezes** em cada um dos três formatos
 * de escrita e exige que o resultado financeiro seja idêntico ao de uma
 * aplicação única.
 */
test("a mesma entrega executada duas vezes move o caixa só uma vez", async () => {
  await reset();

  const receita = transaction({type: "receita", valueCents: 50_000});

  // CREATE, entregue duas vezes.
  const primeira = await deliver("evt-create-0001", undefined, receita);
  const reentrega = await deliver("evt-create-0001", undefined, receita);

  assert.equal(primeira.applied, true, "a primeira entrega aplica");
  assert.equal(reentrega.applied, false, "a reentrega não aplica");
  // A marca devolve os períodos da aplicação original, não uma lista vazia.
  assert.deepEqual(reentrega.periods, primeira.periods);
  assert.equal((await period("2026-08"))?.netCents, 50_000);
  assert.equal((await period("2026-08"))?.incomeCents, 50_000);
  assert.equal((await period("2026-08"))?.transactionCount, 1);

  // UPDATE com troca de mês, entregue duas vezes: o efeito precisa sair de
  // agosto e entrar em julho exatamente uma vez, nos dois períodos.
  const movida = {
    ...receita,
    valueCents: 30_000,
    date: "2026-07-05",
  };
  await deliver("evt-update-0001", receita, movida);
  await deliver("evt-update-0001", receita, movida);
  assert.equal((await period("2026-08"))?.netCents, 0);
  assert.equal((await period("2026-08"))?.transactionCount, 0);
  assert.equal((await period("2026-07"))?.netCents, 30_000);
  assert.equal((await period("2026-07"))?.transactionCount, 1);

  // DELETE, entregue duas vezes: o caixa não pode ficar negativo por retirar
  // o mesmo lançamento duas vezes.
  await deliver("evt-delete-0001", movida, undefined);
  await deliver("evt-delete-0001", movida, undefined);
  assert.equal((await period("2026-07"))?.netCents, 0);
  assert.equal((await period("2026-07"))?.transactionCount, 0);

  await reset();
});

test("a marca de entrega é por workspace e não guarda o event.id", async () => {
  await reset();

  const eventId = "projects/p/databases/(default)/documents/" +
    "workspaces/w/transactions/tx-sensivel-0001";
  const chave = cashPeriodEventKey(eventId);

  await deliver(eventId, undefined,
    transaction({type: "receita", valueCents: 10_000}));

  const marca = await cashPeriodEventRef(WORKSPACE, chave).get();
  assert.equal(marca.exists, true);
  assert.equal(marca.data()?.workspaceId, WORKSPACE);
  // O ID é hash: nem o caminho do documento nem o ID da transação aparecem.
  assert.match(chave, /^[0-9a-f]{40}$/);
  assert.equal(chave.includes("tx-sensivel-0001"), false);
  assert.equal(JSON.stringify(marca.data()?.id).includes("tx-sensivel"), false);
  // Retenção marcada: a coleção é operacional, não é fato financeiro.
  assert.ok(marca.data()?.expiresAt, "a marca precisa de expiresAt");

  // A mesma entrega noutro workspace é outra marca: o dedupe não vaza tenant.
  const outro = await db().doc(
    `workspaces/outro-workspace/cash_period_events/${chave}`,
  ).get();
  assert.equal(outro.exists, false);

  await reset();
});

test("duas entregas legítimas distintas são ambas aplicadas", async () => {
  await reset();

  const salario = transaction(
    {type: "receita", valueCents: 50_000, description: "Salário"});
  const aluguel = transaction(
    {type: "despesa", valueCents: 12_000, description: "Aluguel"});

  const um = await deliver(
    "evt-legitimo-0001", undefined, salario, "tx-salario");
  const dois = await deliver(
    "evt-legitimo-0002", undefined, aluguel, "tx-aluguel");

  assert.equal(um.applied, true);
  assert.equal(dois.applied, true, "evento distinto precisa ser aplicado");

  const agosto = await period("2026-08");
  assert.equal(agosto?.incomeCents, 50_000);
  assert.equal(agosto?.expenseCents, 12_000);
  assert.equal(agosto?.netCents, 50_000 - 12_000);
  assert.equal(agosto?.transactionCount, 2, "os dois lançamentos contam");

  // Reentregar as duas não muda nada: idempotência por evento, não por
  // documento.
  await deliver("evt-legitimo-0001", undefined, salario, "tx-salario");
  await deliver("evt-legitimo-0002", undefined, aluguel, "tx-aluguel");
  const depois = await period("2026-08");
  assert.equal(depois?.netCents, agosto?.netCents);
  assert.equal(depois?.transactionCount, 2);

  await reset();
});

/**
 * A reconstrução continua sendo reconciliação, e não a defesa contra
 * duplicação: ela fecha nos mesmos valores que o caminho deduplicado publicou.
 */
test("a reconstrução confere o caixa deduplicado sem alterá-lo", async () => {
  await reset();

  const linhas = [
    {id: "tx-a", evento: "evt-rec-0001",
      dados: transaction({type: "receita", valueCents: 100_000})},
    {id: "tx-b", evento: "evt-rec-0002",
      dados: transaction({type: "despesa", valueCents: 25_000})},
  ];
  for (const linha of linhas) {
    await db().doc(`workspaces/${WORKSPACE}/transactions/${linha.id}`)
      .set(linha.dados);
    await deliver(linha.evento, undefined, linha.dados, linha.id);
    // Reentrega imediata, como um retry do Eventarc.
    await deliver(linha.evento, undefined, linha.dados, linha.id);
  }

  const antes = await period("2026-08");
  assert.equal(antes?.netCents, 100_000 - 25_000);

  const resultado = await executeRebuildCashPeriods(WORKSPACE, ACTOR, {
    workspaceId: WORKSPACE,
    idempotencyKey: "cash-rebuild-dedupe-0001",
    correlationId: "corr-cash-rebuild-dedupe",
    pageSize: 100,
    reason: "Conferência do caminho deduplicado",
    dryRun: false,
  });
  assert.equal(resultado.completed, true);

  const depois = await period("2026-08");
  assert.equal(depois?.netCents, antes?.netCents);
  assert.equal(depois?.transactionCount, antes?.transactionCount);

  await reset();
});

// ------------------------------------------------- contrato único (P5-C2)

/** Meses publicados; o estado da reconstrução mora na mesma coleção. */
const periodsCount = async () =>
  (await db().collection(`workspaces/${WORKSPACE}/cash_report_periods`).get())
    .docs.filter((doc) => !(CASH_REBUILD_STATE_IDS as readonly string[])
      .includes(doc.id)).length;

test("entrega de documento fora do contrato falha sem marca nem período",
  async () => {
    await reset();
    for (const [index, data] of [
      transaction({type: "parcelado"}),
      transaction({type: "investimento"}),
      transaction({valueCents: 10.5}),
      transaction({date: "2026-02-30"}),
    ].entries()) {
      const eventId = `evt-violacao-${index}`;
      await assert.rejects(deliver(eventId, undefined, data),
        CashContractViolationError);
      // A transação aborta inteira: nenhuma marca, nenhum mês, nenhum dia.
      assert.equal(
        (await cashPeriodEventRef(WORKSPACE, cashPeriodEventKey(eventId))
          .get()).exists,
        false,
      );
      assert.equal(await periodsCount(), 0);
    }
    await reset();
  });

test("reconstrução recusa publicar com documento fora do contrato",
  async () => {
    await reset();
    await db().doc(`workspaces/${WORKSPACE}/transactions/tx-valido`).set(
      transaction({type: "receita", valueCents: 10_000}));
    // Legado em reais, sem `valueCents`: nunca vira R$ 0,00 na base.
    const legado = transaction({type: "receita"}) as Record<string, unknown>;
    delete legado.valueCents;
    await db().doc(`workspaces/${WORKSPACE}/transactions/tx-legado`).set(
      {...legado, value: 100});

    await assert.rejects(
      executeRebuildCashPeriods(WORKSPACE, ACTOR, {
        workspaceId: WORKSPACE,
        idempotencyKey: "cash-rebuild-contrato-0001",
        correlationId: "corr-cash-rebuild-contrato",
        pageSize: 100,
        reason: "Reconstrução de teste",
        dryRun: false,
      }),
      (error: unknown) => error instanceof ApplicationError &&
        error.code === "domain_precondition_failed" &&
        error.message === CASH_REBUILD_CONTRACT_VIOLATION_MESSAGE,
    );
    assert.equal(await periodsCount(), 0, "nenhum mês publicado");
    await reset();
  });

test("correção retroativa de `date` move dia, mês e ano com Σ dias = mês",
  async () => {
    await reset();
    const original = transaction({
      type: "receita", valueCents: 50_000, date: "2026-12-31",
    });
    await applyWrite(undefined, original);
    const corrigida = {...original, date: "2027-01-02"};
    await applyWrite(original, corrigida);

    const dezembro = await period("2026-12");
    const janeiro = await period("2027-01");
    assert.equal(dezembro?.netCents, 0);
    assert.equal(dezembro?.incomeCents, 0);
    assert.equal(dezembro?.transactionCount, 0);
    assert.equal(janeiro?.netCents, 50_000);
    assert.equal(janeiro?.incomeCents, 50_000);
    assert.equal(janeiro?.transactionCount, 1);
    for (const [month, data] of [["2026-12", dezembro], ["2027-01", janeiro]]) {
      const days = readCashDayDeltas(data && (data as {days?: unknown}).days);
      assert.ok(
        cashDaysMatchMonth(days, normalizeCashPeriodDelta(
          data as Record<string, unknown>)),
        `Σ dias = mês em ${month}`,
      );
    }
    assert.deepEqual(readCashDayDeltas(janeiro?.days), {
      "02": {incomeCents: 50_000, netCents: 50_000, transactionCount: 1},
    });
    assert.deepEqual(readCashDayDeltas(dezembro?.days), {},
      "o dia de origem fica zerado");

    // A categoria troca de ano junto: sai de 2026 e entra em 2027.
    const year = async (value: string) => (await db().doc(
      `workspaces/${WORKSPACE}/cash_category_years/g0__${value}__sem_categoria`,
    ).get()).data();
    assert.equal((await year("2026"))?.incomeCents, 0);
    assert.equal((await year("2027"))?.incomeCents, 50_000);
    await reset();
  });

test("valor no teto do produto é aceito; acima lança e não grava", async () => {
  await reset();
  const teto = CASH_ENTRY_MAX_CENTS;
  const receita = transaction({type: "receita", valueCents: teto});
  await applyWrite(undefined, receita);
  assert.equal((await period("2026-08"))?.incomeCents, teto);
  assert.equal((await period("2026-08"))?.netCents, teto);

  for (const valueCents of [teto + 1, Number.MAX_SAFE_INTEGER]) {
    await reset();
    const acima = transaction({type: "receita", valueCents});
    await assert.rejects(applyWrite(undefined, acima),
      CashContractViolationError);
    assert.equal(await periodsCount(), 0);
  }
  await reset();
});

test("mudar só o `transactionDate` remanescente não gera delta", async () => {
  await reset();
  const receita = transaction({
    type: "receita", valueCents: 50_000,
    transactionDate: at("2026-08-10T15:00:00.000Z"),
  });
  await applyWrite(undefined, receita);
  const antes = await period("2026-08");

  const remanescente = {
    ...receita, transactionDate: at("2026-09-20T15:00:00.000Z"),
  };
  assert.deepEqual(cashWritePlanFor(receita, remanescente),
    {months: {}, days: {}, categories: {}});
  await applyWrite(receita, remanescente);
  assert.deepEqual(await period("2026-08"), antes, "mês intocado");
  assert.equal(await period("2026-09"), undefined, "nenhum mês novo");

  // Pela entrega do gatilho: aplicada, sem período tocado e sem delta.
  const entrega = await deliver("evt-remanescente-0001", receita,
    remanescente);
  assert.equal(entrega.applied, true);
  assert.deepEqual(entrega.periods, []);
  assert.deepEqual(await period("2026-08"), antes);
  await reset();
});
