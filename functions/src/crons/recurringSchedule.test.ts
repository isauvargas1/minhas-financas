import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {
  addRecurringPeriod,
  buildRecurringTransaction,
  competenciaOf,
  firstManagedDueDate,
  firstRecurringDueDate,
  planRecurringCharge,
  recurringDayKey,
  recurringOccurrenceId,
  recurringTransactionId,
  RECURRING_SYSTEM_ACTOR_ID,
} from "./recurring";

/**
 * Regra de datas da geração recorrente, sem Firestore.
 *
 * A rotina não tinha teste nenhum, e o que ela calculava estava errado em
 * três frentes independentes: ignorava `periodo`, ignorava `dataFim` e
 * gravava `date` fora do contrato `YYYY-MM-DD`. Nada disso precisa de banco
 * para ser exercitado — e é justamente por não precisar que a ausência de
 * cobertura era barata de corrigir e cara de manter.
 */

test("o período de cobrança define o próximo vencimento", () => {
  assert.equal(addRecurringPeriod("2026-03-10", "semanal"), "2026-03-17");
  assert.equal(addRecurringPeriod("2026-03-10", "quinzenal"), "2026-03-25");
  assert.equal(addRecurringPeriod("2026-03-10", "mensal"), "2026-04-10");
  assert.equal(addRecurringPeriod("2026-03-10", "bimestral"), "2026-05-10");
  assert.equal(addRecurringPeriod("2026-03-10", "trimestral"), "2026-06-10");
  assert.equal(addRecurringPeriod("2026-03-10", "semestral"), "2026-09-10");
  assert.equal(addRecurringPeriod("2026-03-10", "anual"), "2027-03-10");
});

test("a virada de ano e o transbordo de mês seguem a regra do cliente", () => {
  assert.equal(addRecurringPeriod("2026-12-15", "mensal"), "2027-01-15");
  // 31 de janeiro + 1 mês transborda, exatamente como `addPeriod` no cliente.
  assert.equal(addRecurringPeriod("2026-01-31", "mensal"), "2026-03-03");
  // 2028 é bissexto: 29 de fevereiro existe.
  assert.equal(addRecurringPeriod("2028-01-29", "mensal"), "2028-02-29");
});

test("o dia de cobrança desloca o primeiro vencimento só nos períodos mensais", () => {
  assert.equal(
    firstRecurringDueDate({
      dataInicio: "2026-03-02", periodo: "mensal", diaCobranca: 5,
    }),
    "2026-03-05",
  );
  // Semanal e quinzenal não têm dia do mês: o início manda.
  assert.equal(
    firstRecurringDueDate({
      dataInicio: "2026-03-02", periodo: "semanal", diaCobranca: 5,
    }),
    "2026-03-02",
  );
  // Sem dia de cobrança válido, o início manda.
  assert.equal(
    firstRecurringDueDate({dataInicio: "2026-03-02", periodo: "mensal"}),
    "2026-03-02",
  );
  assert.equal(firstRecurringDueDate({periodo: "mensal"}), undefined);
});

test("`dataInicio` é lida como Timestamp, como o cadastro a grava", () => {
  // O formulário grava `Timestamp.fromDate(...)`, não string.
  const stored = Timestamp.fromDate(new Date("2026-03-10T12:00:00.000Z"));
  assert.equal(recurringDayKey(stored), "2026-03-10");
  assert.equal(recurringDayKey("2026-03-10T00:00:00.000Z"), "2026-03-10");
  assert.equal(recurringDayKey("2026-03-10"), "2026-03-10");
  assert.equal(recurringDayKey(undefined), undefined);
  assert.equal(recurringDayKey("ontem"), undefined);
});

test("vencimento futuro não gera nada", () => {
  const plan = planRecurringCharge(
    {dataInicio: "2026-05-10", periodo: "mensal"},
    "2026-04-01",
  );
  assert.equal(plan, undefined);
});

test("vencido gera um único lançamento e avança um período", () => {
  const plan = planRecurringCharge(
    {nextDueDate: "2026-03-10", periodo: "mensal"},
    "2026-06-01",
  );
  // Atrasado três meses: gera **um** e volta amanhã. O teto de escrita de um
  // lote não pode depender de quanto tempo o job ficou parado.
  assert.deepEqual(plan, {
    dueDate: "2026-03-10",
    nextDueDate: "2026-04-10",
    competencia: "2026-03",
    ended: false,
  });
});

test("assinatura sem `nextDueDate` nunca gera vencimento retroativo", () => {
  /*
   * **Nenhuma** assinatura existente tem `nextDueDate` — o produto nunca
   * gravou o campo. Sem piso, a primeira execução real cairia em `dataInicio`
   * e, gerando um vencimento por execução, emitiria uma despesa retroativa por
   * dia até alcançar o presente: três anos de assinatura mensal virariam trinta
   * e seis lançamentos que o usuário nunca teve.
   */
  const antiga = {dataInicio: "2023-03-10", periodo: "mensal", diaCobranca: 10};
  assert.equal(firstManagedDueDate(antiga, "2026-06-01"), "2026-06-10");

  // Nenhum vencimento passado é gerado, nem o do mês corrente que já venceu.
  assert.equal(planRecurringCharge(antiga, "2026-06-01"), undefined);
  assert.equal(planRecurringCharge(antiga, "2026-06-15"), undefined);

  // A rotina passa a gerar quando o vencimento chega — e só aquele.
  assert.deepEqual(planRecurringCharge(antiga, "2026-07-10"), {
    dueDate: "2026-07-10",
    nextDueDate: "2026-08-10",
    competencia: "2026-07",
    ended: false,
  });

  /*
   * A partir daí a assinatura tem `nextDueDate` e a rotina a gere normalmente,
   * inclusive recuperando atraso de execução — um vencimento por execução.
   */
  assert.deepEqual(
    planRecurringCharge({...antiga, nextDueDate: "2026-07-10"}, "2026-09-01"),
    {
      dueDate: "2026-07-10",
      nextDueDate: "2026-08-10",
      competencia: "2026-07",
      ended: false,
    },
  );
});

test("assinatura nova começa a valer no próprio primeiro vencimento", () => {
  const nova = {dataInicio: "2026-06-10", periodo: "mensal", diaCobranca: 10};
  assert.equal(firstManagedDueDate(nova, "2026-06-01"), "2026-06-10");
  assert.equal(firstManagedDueDate(nova, "2026-06-10"), "2026-06-10");
});

test("a ocorrência do vencimento tem o mesmo ID que a tela projeta", () => {
  // `logic.ts` do cliente monta `occ_${expense.id}_${competencia}`.
  assert.equal(competenciaOf("2026-06-10"), "2026-06");
  assert.equal(
    recurringOccurrenceId("assinatura-1", "2026-06-10"),
    "occ_assinatura-1_2026-06",
  );
});

test("contrato encerrado não gera depois do fim e se encerra ao chegar nele", () => {
  // Vencimento já além do fim: nada é gerado.
  assert.equal(
    planRecurringCharge(
      {nextDueDate: "2026-07-10", dataFim: "2026-06-30", periodo: "mensal"},
      "2026-08-01",
    ),
    undefined,
  );
  // Último vencimento dentro do contrato: gera e marca o encerramento.
  assert.deepEqual(
    planRecurringCharge(
      {nextDueDate: "2026-06-10", dataFim: "2026-06-30", periodo: "mensal"},
      "2026-08-01",
    ),
    {
      dueDate: "2026-06-10",
      nextDueDate: "2026-07-10",
      competencia: "2026-06",
      ended: true,
    },
  );
});

test("a transação gerada respeita o contrato que as Rules exigem", () => {
  const built = buildRecurringTransaction(
    {
      nome: "Aluguel da sala",
      valorPadrao: 3_200,
      periodo: "mensal",
      tipoEmpresa: "Aluguel",
    },
    "workspace-x",
    "assinatura-1",
    "2026-06-10",
    "rec_assinatura-1_2026-06-10",
  );

  // `date` no contrato `YYYY-MM-DD` — a versão anterior gravava instante ISO
  // completo, o que tirava a despesa da projeção mensal de caixa e travava
  // qualquer edição posterior pelas Rules.
  assert.equal(built.date, "2026-06-10");
  assert.match(String(built.date), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(built.transactionDate instanceof Timestamp);
  assert.equal(built.type, "despesa");
  assert.equal(built.value, 3_200);
  // Mesmo formato da geração manual da tela: nome e mês por extenso.
  assert.equal(built.description, "Aluguel da sala (junho)");
  assert.equal(built.category, "Aluguel");
  assert.equal(built.isPaid, false);
  assert.equal(built.workspaceId, "workspace-x");
  assert.equal(built.profileId, "workspace-x");
  assert.equal(built.userId, RECURRING_SYSTEM_ACTOR_ID);
  assert.equal(built.recurringId, "assinatura-1");

  // Campos que tornariam a despesa não editável pelo cliente
  // (`isPlainClientTransaction`) ficam de fora.
  for (const forbidden of [
    "valueCents",
    "goalId",
    "investmentMetadata",
    "redeemedPrincipalCents",
    "remainingPrincipalCents",
    "settlementDate",
  ]) {
    assert.equal(forbidden in built, false, `${forbidden} não deve ser gravado`);
  }
});

test("sem tipo de empresa, a categoria é a mesma que a tela usa em PF", () => {
  const built = buildRecurringTransaction(
    {nome: "Streaming", valorPadrao: 39.9, periodo: "mensal"},
    "workspace-x",
    "assinatura-2",
    "2026-06-10",
    "rec_assinatura-2_2026-06-10",
  );
  assert.equal(built.category, "Assinaturas");
});

test("o ID do lançamento é determinístico: um retry não duplica", () => {
  assert.equal(
    recurringTransactionId("assinatura-1", "2026-06-10"),
    "rec_assinatura-1_2026-06-10",
  );
  assert.equal(
    recurringTransactionId("assinatura-1", "2026-06-10"),
    recurringTransactionId("assinatura-1", "2026-06-10"),
  );
  assert.notEqual(
    recurringTransactionId("assinatura-1", "2026-06-10"),
    recurringTransactionId("assinatura-1", "2026-07-10"),
  );
});
