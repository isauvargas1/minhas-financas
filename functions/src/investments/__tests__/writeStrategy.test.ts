import assert from "node:assert/strict";
import test from "node:test";

import type {InvestmentBackendOperation} from "../infrastructure";
import {
  INVESTMENT_BACKEND_WRITE_PLANS,
  getInvestmentBackendWritePlan,
  investmentOperationRoles,
} from "../writeStrategy";

const operations = Object.keys(
  INVESTMENT_BACKEND_WRITE_PLANS,
) as InvestmentBackendOperation[];

test("toda operação declarada aponta para si mesma", () => {
  for (const operation of operations) {
    assert.equal(
      getInvestmentBackendWritePlan(operation).operation,
      operation,
      `Plano de ${operation} declara operação divergente.`,
    );
  }
});

test("nenhuma operação permite escrita direta do cliente", () => {
  for (const operation of operations) {
    const plan = getInvestmentBackendWritePlan(operation);
    assert.equal(plan.clientDirectWriteAllowed, false);
    assert.equal(plan.requiresAuthentication, true);
    assert.equal(plan.requiresWorkspaceMembership, true);
    assert.equal(plan.requiresIdempotencyKey, true);
    assert.equal(plan.requiresCorrelationId, true);
  }
});

test("papéis são não vazios e restritos ao conjunto conhecido", () => {
  const known = new Set(["owner", "admin", "member", "viewer"]);
  for (const operation of operations) {
    const roles = investmentOperationRoles(operation);
    assert.ok(roles.length > 0, `${operation} sem papéis declarados.`);
    for (const role of roles) {
      assert.ok(known.has(role), `${operation} declara papel ${role}.`);
    }
    assert.ok(
      !roles.includes("viewer"),
      `${operation} não pode admitir viewer em mutação.`,
    );
  }
});

test("matriz de papéis por operação é a esperada pelo domínio", () => {
  const expected: Record<InvestmentBackendOperation, string[]> = {
    // D-15 (P4-D): só as operações da experiência simples. Registrar,
    // confirmar, retirar e cancelar pendente são do dia a dia de quem
    // participa do workspace; desfazer fato liquidado (estorno) é de
    // owner/admin.
    createSimpleInvestment: ["owner", "admin", "member"],
    settleInvestmentContribution: ["owner", "admin", "member"],
    withdrawSimpleInvestment: ["owner", "admin", "member"],
    settleSimpleWithdrawal: ["owner", "admin", "member"],
    cancelInvestmentMovement: ["owner", "admin", "member"],
    reverseInvestmentMovement: ["owner", "admin"],
    // INV-P2-028 — troca de meta: mesma matriz de vínculo e desvínculo.
    changeInvestmentGoal: ["owner", "admin", "member"],
    linkInvestmentToGoal: ["owner", "admin", "member"],
    unlinkInvestmentFromGoal: ["owner", "admin", "member"],
  };
  assert.deepEqual(
    operations.slice().sort(),
    Object.keys(expected).sort(),
    "A matriz declarada não cobre exatamente as operações do domínio.",
  );
  for (const operation of operations) {
    assert.deepEqual(
      investmentOperationRoles(operation).slice().sort(),
      expected[operation].slice().sort(),
      `Papéis divergentes em ${operation}.`,
    );
  }
});

test("operações que movem caixa declaram espelho em transactions", () => {
  for (const operation of operations) {
    const plan = getInvestmentBackendWritePlan(operation);
    if (!plan.affectsCashProjection) continue;
    assert.ok(
      plan.writes.includes("transactions"),
      `${operation} move caixa mas não declara escrita em transactions.`,
    );
  }
});

test("fato liquidado com dinheiro declara o livro-razão das contas (D-30)", () => {
  for (const operation of [
    "createSimpleInvestment",
    "settleInvestmentContribution",
    "withdrawSimpleInvestment",
    "settleSimpleWithdrawal",
    "reverseInvestmentMovement",
  ] as const) {
    const plan = getInvestmentBackendWritePlan(operation);
    assert.equal(plan.affectsCashProjection, true, operation);
    assert.ok(plan.writes.includes("cash_accounts"), operation);
    assert.ok(plan.writes.includes("cash_account_movements"), operation);
  }
});

test("cancelamento de pendente não toca projeções nem contas", () => {
  const plan = getInvestmentBackendWritePlan("cancelInvestmentMovement");
  assert.equal(plan.updatesProjections, false);
  assert.equal(plan.affectsCashProjection, false);
  for (const target of [
    "investment_positions", "goals", "investment_summaries",
    "cash_accounts", "cash_account_movements",
  ] as const) {
    assert.ok(!plan.writes.includes(target), target);
  }
});

test("toda mutação registra evento e conclui idempotência", () => {
  for (const operation of operations) {
    const plan = getInvestmentBackendWritePlan(operation);
    assert.ok(
      plan.writes.includes("investment_idempotency_keys"),
      `${operation} não declara escrita da chave de idempotência.`,
    );
    assert.ok(
      plan.writes.includes("investment_event_logs"),
      `${operation} não declara trilha de auditoria.`,
    );
  }
});

test("toda operação declara a métrica operacional que de fato escreve", () => {
  // M4.D — `investment_operational_metrics` era escrita por
  // `observability.ts` sem constar do union nem de nenhum plano: o
  // cross-check declarativo tinha ponto cego exatamente na coleção que o M3
  // acrescentou. Agora a matriz cobre 100% das escritas do domínio.
  for (const operation of operations) {
    assert.ok(
      getInvestmentBackendWritePlan(operation).writes.includes(
        "investment_operational_metrics",
      ),
      `${operation} grava métrica operacional e não a declara.`,
    );
  }
});

test("nenhum plano declara escrita fora do domínio além do caixa e das metas", () => {
  // Fora de `investment_*` e `goals`, as operações só escrevem o efeito de
  // caixa (P4-D): o espelho em `transactions` e o livro-razão das contas
  // (D-30). Todas essas coleções são exclusivas do backend nas Rules.
  const cashTargets = new Set([
    "transactions", "cash_accounts", "cash_account_movements",
  ]);
  for (const operation of operations) {
    const plan = getInvestmentBackendWritePlan(operation);
    assert.equal(plan.clientDirectWriteAllowed, false, operation);
    for (const target of plan.writes) {
      if (cashTargets.has(target)) continue;
      assert.ok(
        target.startsWith("investment_") || target === "goals",
        `${operation} declara alvo inesperado fora do domínio: ${target}.`,
      );
    }
  }
});

// INV-P3-052 — quatro operações não revalidavam o papel dentro da transação.
//
// O wrapper da callable autoriza antes de abrir a transação. Sem a
// revalidação, uma revogação de papel entre os dois momentos passava
// despercebida e a mutação seguia com privilégio que já não existe.

test("toda operação de escrita revalida o papel dentro da transação", () => {
  for (const operation of Object.keys(
    INVESTMENT_BACKEND_WRITE_PLANS,
  ) as InvestmentBackendOperation[]) {
    const plan = INVESTMENT_BACKEND_WRITE_PLANS[operation];
    if (!plan.requiresFirestoreTransaction) continue;
    assert.equal(
      plan.revalidatesRoleInTransaction,
      true,
      `${operation} precisa revalidar o papel dentro da transação.`,
    );
  }
});
