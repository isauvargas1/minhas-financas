import assert from "node:assert/strict";
import {before, describe, test} from "node:test";

import {ApplicationError} from "../../shared/errors";
import {db} from "../../workspaces/testSupport/p1TestSupport";
import {executeCreateSplitBill} from "../billOperations";
import {executeCreateSplitGroup} from "../groupOperations";
import {executePaySplitReimbursement} from "../reimbursementOperations";
import {
  activeSplitGroups,
  actorOf,
  addMember,
  approveReimbursement,
  assertSplitReconciles,
  balanceOf,
  billPayload,
  billRef,
  clockAt,
  countOf,
  createBill,
  createGroup,
  createReimbursement,
  defaultAccountOf,
  groupPayload,
  groupRef,
  idempotencyKey,
  memberParticipantId,
  readDoc,
  reimbursementPayload,
  reimbursementRef,
  rejectsWith,
  requestId,
  seedGroupWithMembers,
  seedSplitTenant,
  settleShare,
  shareIdOf,
  versionOf,
  voidBill,
  type SplitTenant,
} from "../testSupport/splitTestSupport";

/**
 * Concorrência, atomicidade e idempotência (P4-C, §18, §30, §46): cada
 * operação é uma transação; falha antes do commit não deixa nada; corridas
 * sobre o mesmo rateio resolvem uma vez; replays não duplicam fatos.
 */
const failBeforeCommit = () => ({
  ...clockAt(),
  beforeCommit: () => {
    throw new Error("falha injetada antes do commit");
  },
});

const snapshotCounts = async (tenant: SplitTenant) => ({
  bills: await countOf(tenant.workspaceId, "split_bills"),
  shares: await countOf(tenant.workspaceId, "split_shares"),
  events: await countOf(tenant.workspaceId, "split_events"),
  transactions: await countOf(tenant.workspaceId, "transactions"),
  movements: await countOf(tenant.workspaceId, "cash_account_movements"),
  groups: await countOf(tenant.workspaceId, "split_groups"),
  participants: await countOf(tenant.workspaceId, "split_participants"),
  receipts: (await db().collection(
    `users/${tenant.owner}/idempotency_keys`).get()).size,
});

describe("Divisão de contas — concorrência e atomicidade", () => {
  let tenant: SplitTenant;

  before(async () => {
    tenant = await seedSplitTenant("PF", "split-conc");
  });

  test("falha antes do commit: título com Caixa não deixa nada", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const accountId = defaultAccountOf(tenant.workspaceId);
    const counts = await snapshotCounts(tenant);
    const balance = await balanceOf(tenant.workspaceId, accountId);
    const group = await readDoc(groupRef(tenant.workspaceId, ids.groupId));
    await assert.rejects(executeCreateSplitBill(actorOf(tenant, tenant.owner),
      billPayload(tenant, ids.groupId, ids.owner, [ids.owner, ids.member], {
        financialIntegration: "cash", cashAccountId: accountId,
      }), requestId(), failBeforeCommit()), /falha injetada/);
    assert.deepEqual(await snapshotCounts(tenant), counts);
    assert.equal(await balanceOf(tenant.workspaceId, accountId), balance);
    assert.deepEqual(await readDoc(groupRef(tenant.workspaceId, ids.groupId)),
      group);
  });

  test("falha antes do commit: grupo não consome vaga nem cria dono",
    async () => {
      const counts = await snapshotCounts(tenant);
      const active = await activeSplitGroups(tenant.workspaceId);
      await assert.rejects(executeCreateSplitGroup(
        actorOf(tenant, tenant.owner), groupPayload(tenant), requestId(),
        failBeforeCommit()), /falha injetada/);
      assert.deepEqual(await snapshotCounts(tenant), counts);
      assert.equal(await activeSplitGroups(tenant.workspaceId), active);
    });

  test("falha antes do commit: pagamento de reembolso não move a conta",
    async () => {
      const pj = await seedSplitTenant("PJ", "split-conc-pj");
      const {groupId} = await createGroup(pj, {businessMode: "reimbursement"});
      const owner = memberParticipantId(pj, groupId, pj.owner);
      const {reimbursementId} = await createReimbursement(pj,
        reimbursementPayload(pj, groupId, owner));
      await approveReimbursement(pj, reimbursementId);
      const accountId = defaultAccountOf(pj.workspaceId);
      const balance = await balanceOf(pj.workspaceId, accountId);
      const counts = await snapshotCounts(pj);
      await assert.rejects(executePaySplitReimbursement(actorOf(pj, pj.owner), {
        workspaceId: pj.workspaceId,
        idempotencyKey: idempotencyKey(),
        reimbursementId,
        expectedUpdatedAt: await versionOf(reimbursementRef(pj.workspaceId,
          reimbursementId)),
        cashAccountId: accountId,
        paymentDate: "2026-10-07",
      }, requestId(), failBeforeCommit()), /falha injetada/);
      assert.deepEqual(await snapshotCounts(pj), counts);
      assert.equal(await balanceOf(pj.workspaceId, accountId), balance);
      const item = await readDoc(reimbursementRef(pj.workspaceId,
        reimbursementId));
      assert.equal(item.status, "approved");
    });

  test("corrida no mesmo rateio: um registro de recebimento vence",
    async () => {
      const ids = await seedGroupWithMembers(tenant);
      const {billId} = await createBill(tenant, billPayload(tenant, ids.groupId,
        ids.owner, [ids.owner, ids.member]));
      const share = shareIdOf(tenant, billId, ids.member);
      const results = await Promise.allSettled([
        settleShare(tenant, share, tenant.owner),
        settleShare(tenant, share, tenant.admin),
        settleShare(tenant, share, tenant.owner),
      ]);
      const fulfilled = results.filter((result) =>
        result.status === "fulfilled");
      assert.equal(fulfilled.length, 1);
      for (const result of results) {
        if (result.status === "rejected") {
          assert.ok(result.reason instanceof ApplicationError);
          assert.ok(["concurrent_update", "domain_precondition_failed"]
            .includes(result.reason.code), result.reason.code);
        }
      }
      await assertSplitReconciles(tenant.workspaceId, ids.groupId);
    });

  test("rajada no mesmo grupo: cada operação entra inteira ou não entra; " +
    "agregados sempre exatos", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const created = await Promise.all([1, 2, 3, 4, 5].map((index) =>
      createBill(tenant, billPayload(tenant, ids.groupId, ids.owner,
        [ids.owner, ids.member, ids.otherMember],
        {amountCents: 1_000 * index + index}))));
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
    // O grupo é o documento dos agregados: as escritas dele se serializam.
    // Numa rajada, a transação que não obtém a vez falha inteira (código
    // retentável) — nunca grava metade.
    const shares = created.flatMap(({billId}) => [
      shareIdOf(tenant, billId, ids.member),
      shareIdOf(tenant, billId, ids.otherMember),
    ]);
    const burst = await Promise.allSettled(shares.map((share, index) =>
      settleShare(tenant, share, index % 2 === 0 ? tenant.owner :
        tenant.admin)));
    for (const result of burst) {
      if (result.status === "fulfilled") continue;
      const reason = result.reason as {code?: unknown};
      assert.ok(reason.code === 10 || reason.code === "concurrent_update",
        `falha não retentável: ${String(reason.code)}`);
    }
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
    // Quem perdeu a vez repete (ação do usuário) e o estado fecha exato.
    for (const share of shares) {
      const current = await readDoc(db().doc(
        `workspaces/${tenant.workspaceId}/split_shares/${share}`));
      if (current.status === "open") await settleShare(tenant, share);
    }
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
    const group = await readDoc(groupRef(tenant.workspaceId, ids.groupId));
    assert.equal(group.totals.openCents, 0);
    assert.equal(group.counters.openBillCount, 0);
    assert.equal(group.totals.billedCents, 15_015);
  });

  test("idempotência: replay sem duplicar; mesma chave com outros dados é " +
    "conflito; âncora durável depois do recibo", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const accountId = defaultAccountOf(tenant.workspaceId);
    const payload = billPayload(tenant, ids.groupId, ids.owner,
      [ids.owner, ids.member], {financialIntegration: "cash",
        cashAccountId: accountId});
    const first = await executeCreateSplitBill(actorOf(tenant, tenant.owner),
      payload, requestId(), clockAt());
    const counts = await snapshotCounts(tenant);
    const replay = await executeCreateSplitBill(actorOf(tenant, tenant.owner),
      payload, requestId(), clockAt());
    assert.equal(replay.replayed, true);
    assert.equal(replay.billId, first.billId);
    assert.deepEqual(await snapshotCounts(tenant), counts);
    await rejectsWith(executeCreateSplitBill(actorOf(tenant, tenant.owner),
      {...payload, amountCents: payload.amountCents + 1}, requestId(),
      clockAt()), "idempotency_conflict");
    const receipts = await db()
      .collection(`users/${tenant.owner}/idempotency_keys`).get();
    await Promise.all(receipts.docs.map((doc) => doc.ref.delete()));
    const anchored = await executeCreateSplitBill(actorOf(tenant, tenant.owner),
      payload, requestId(), clockAt());
    assert.equal(anchored.replayed, true);
    assert.equal(anchored.billId, first.billId);
    assert.equal(await countOf(tenant.workspaceId, "split_bills"),
      counts.bills);
    assert.equal(await countOf(tenant.workspaceId, "transactions"),
      counts.transactions);
    // Sem o recibo, a âncora também recusa a mesma chave com outros dados.
    const again = await db()
      .collection(`users/${tenant.owner}/idempotency_keys`).get();
    await Promise.all(again.docs.map((doc) => doc.ref.delete()));
    await rejectsWith(executeCreateSplitBill(actorOf(tenant, tenant.owner),
      {...payload, amountCents: payload.amountCents + 1}, requestId(),
      clockAt()), "idempotency_conflict");
    assert.equal(await countOf(tenant.workspaceId, "split_bills"),
      counts.bills);
    // Anulação repetida com outra chave: o estado já mudou.
    await voidBill(tenant, String(first.billId));
    await rejectsWith(voidBill(tenant, String(first.billId)),
      "domain_precondition_failed");
    const bill = await readDoc(billRef(tenant.workspaceId,
      String(first.billId)));
    assert.equal(bill.status, "voided");
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
  });

  test("participantes simultâneos: contadores exatos", async () => {
    const {groupId} = await createGroup(tenant);
    await Promise.all([tenant.member, tenant.otherMember, tenant.admin]
      .map((uid) => addMember(tenant, groupId, uid)));
    const group = await readDoc(groupRef(tenant.workspaceId, groupId));
    assert.equal(group.counters.activeParticipantCount, 4);
    await assertSplitReconciles(tenant.workspaceId, groupId);
  });
});
