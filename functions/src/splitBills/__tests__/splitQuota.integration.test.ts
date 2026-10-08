import assert from "node:assert/strict";
import {describe, test} from "node:test";

import {
  SPLIT_GROUPS_QUOTA_EXHAUSTED_MESSAGE,
  SPLIT_GROUPS_QUOTA_EXHAUSTED_NON_OWNER_MESSAGE,
} from "../../billing/quota";
import {
  executeGetWorkspaceEntitlement,
} from "../../billing/workspaceEntitlement";
import {ApplicationError} from "../../shared/errors";
import {db} from "../../workspaces/testSupport/p1TestSupport";
import {
  executeCreateSplitGroup,
  REIMBURSEMENT_PJ_ONLY_MESSAGE,
} from "../groupOperations";
import {
  activeSplitGroups,
  actorOf,
  archiveGroup,
  billPayload,
  clockAt,
  countOf,
  createBill,
  createGroup,
  groupPayload,
  groupRef,
  memberParticipantId,
  readDoc,
  reactivateGroup,
  rejectsWith,
  requestId,
  seedSplitTenant,
} from "../testSupport/splitTestSupport";

/**
 * Quota comercial `splitGroups` no servidor (P4-C, §8, PR-ENT-01): plano
 * efetivo do owner canônico, só grupos ativos; criar consome, arquivar
 * libera, reativar reconfere; downgrade nunca apaga; a última vaga sob
 * concorrência é admitida uma vez; viewer não cria; member cria e vira dono.
 */
const quotaRejection = async (
  promise: Promise<unknown>,
  message: string,
  expectUsed: boolean,
) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApplicationError, String(error));
    assert.equal(error.code, "quota_exceeded");
    assert.equal(error.message, message);
    const details = error.details as Record<string, unknown>;
    assert.equal(details.resource, "splitGroups");
    assert.equal(details.limit, 2);
    assert.equal("used" in details, expectUsed);
    return true;
  });
};

describe("Divisão de contas — quota splitGroups", () => {
  test("Free: 2 grupos ativos; o 3º é recusado com a mensagem do papel",
    async () => {
      const tenant = await seedSplitTenant("PF", "split-quota", "free");
      await createGroup(tenant);
      const {groupId} = await createGroup(tenant, {}, tenant.member);
      // Member cria e vira o dono do grupo.
      const group = await readDoc(groupRef(tenant.workspaceId, groupId));
      assert.equal(group.ownerUserId, tenant.member);
      assert.equal(group.ownerParticipantId,
        memberParticipantId(tenant, groupId, tenant.member));
      assert.equal(await activeSplitGroups(tenant.workspaceId), 2);
      await quotaRejection(createGroup(tenant),
        SPLIT_GROUPS_QUOTA_EXHAUSTED_MESSAGE, true);
      await quotaRejection(createGroup(tenant, {}, tenant.member),
        SPLIT_GROUPS_QUOTA_EXHAUSTED_NON_OWNER_MESSAGE, false);
      assert.equal(await countOf(tenant.workspaceId, "split_groups"), 2);

      // Entitlement: só o titular vê o uso; todos veem o esgotamento.
      const owner = await executeGetWorkspaceEntitlement(
        actorOf(tenant, tenant.owner));
      assert.deepEqual(owner.splitGroupsQuota, {status: "available", limit: 2,
        used: 2, remaining: 0, exhausted: true});
      const member = await executeGetWorkspaceEntitlement(
        actorOf(tenant, tenant.member));
      assert.deepEqual(member.splitGroupsQuota, {status: "available",
        limit: 2, used: null, remaining: null, exhausted: true});

      // Arquivar libera; reativar reconfere e consome.
      await archiveGroup(tenant, groupId, tenant.member);
      assert.equal(await activeSplitGroups(tenant.workspaceId), 1);
      const {groupId: third} = await createGroup(tenant);
      await quotaRejection(reactivateGroup(tenant, groupId, tenant.member),
        SPLIT_GROUPS_QUOTA_EXHAUSTED_NON_OWNER_MESSAGE, false);
      await archiveGroup(tenant, third);
      await reactivateGroup(tenant, groupId, tenant.member);
      assert.equal(await activeSplitGroups(tenant.workspaceId), 2);
    });

  test("viewer não cria; reembolso só em PJ; replay não consome outra vaga",
    async () => {
      const tenant = await seedSplitTenant("PF", "split-quota-roles", "free");
      await rejectsWith(createGroup(tenant, {}, tenant.viewer),
        "workspace_role_denied");
      await rejectsWith(createGroup(tenant, {businessMode: "reimbursement"}),
        "invalid_payload", REIMBURSEMENT_PJ_ONLY_MESSAGE);
      const payload = groupPayload(tenant);
      const first = await executeCreateSplitGroup(actorOf(tenant, tenant.owner),
        payload, requestId(), clockAt());
      const replay = await executeCreateSplitGroup(
        actorOf(tenant, tenant.owner), payload, requestId(), clockAt());
      assert.equal(replay.replayed, true);
      assert.equal(replay.groupId, first.groupId);
      assert.equal(await activeSplitGroups(tenant.workspaceId), 1);
      // Recibo apagado (TTL): a âncora durável ainda devolve o mesmo grupo.
      const receipts = await db()
        .collection(`users/${tenant.owner}/idempotency_keys`).get();
      await Promise.all(receipts.docs.map((doc) => doc.ref.delete()));
      const anchored = await executeCreateSplitGroup(
        actorOf(tenant, tenant.owner), payload, requestId(), clockAt());
      assert.equal(anchored.replayed, true);
      assert.equal(anchored.groupId, first.groupId);
      assert.equal(await activeSplitGroups(tenant.workspaceId), 1);
      assert.equal(await countOf(tenant.workspaceId, "split_groups"), 1);
    });

  test("última vaga sob concorrência: admitida uma vez só", async () => {
    const tenant = await seedSplitTenant("PF", "split-quota-race", "free");
    await createGroup(tenant);
    const attempts = await Promise.allSettled([
      tenant.owner, tenant.admin, tenant.member, tenant.otherMember,
      tenant.owner,
    ].map((uid) => createGroup(tenant, {}, uid)));
    const fulfilled = attempts.filter((item) => item.status === "fulfilled");
    const rejected = attempts.filter((item) => item.status === "rejected");
    assert.equal(fulfilled.length, 1);
    for (const item of rejected) {
      const reason = (item as PromiseRejectedResult).reason;
      assert.ok(reason instanceof ApplicationError);
      assert.equal(reason.code, "quota_exceeded");
    }
    assert.equal(await activeSplitGroups(tenant.workspaceId), 2);
    assert.equal(await countOf(tenant.workspaceId, "split_groups"), 2);
  });

  test("downgrade nunca apaga: grupos seguem e lançam; só criar e reativar " +
    "ficam bloqueados", async () => {
    const tenant = await seedSplitTenant("PF", "split-quota-down", "pro");
    const groups = [];
    for (let index = 0; index < 3; index += 1) {
      groups.push((await createGroup(tenant)).groupId);
    }
    await db().doc(`billing_accounts/${tenant.owner}`).update({
      planId: "free", entitlementStatus: "free", subscriptionStatus: "none",
    });
    await quotaRejection(createGroup(tenant),
      SPLIT_GROUPS_QUOTA_EXHAUSTED_MESSAGE, true);
    assert.equal(await countOf(tenant.workspaceId, "split_groups"), 3);
    const owner = memberParticipantId(tenant, groups[0], tenant.owner);
    await createBill(tenant, billPayload(tenant, groups[0], owner, [owner]));
    await archiveGroup(tenant, groups[1]);
    await archiveGroup(tenant, groups[2]);
    assert.equal(await activeSplitGroups(tenant.workspaceId), 1);
    await reactivateGroup(tenant, groups[1]);
    await quotaRejection(reactivateGroup(tenant, groups[2]),
      SPLIT_GROUPS_QUOTA_EXHAUSTED_MESSAGE, true);
    assert.equal(await activeSplitGroups(tenant.workspaceId), 2);
  });
});
