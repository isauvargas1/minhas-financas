import assert from "node:assert/strict";
import test from "node:test";

import {ApplicationError} from "../../shared/errors";
import {seedActiveAccount} from "../../shared/testSupport/kernelTestSupport";
import {
  resolveWorkspaceActor,
  WORKSPACE_ROLE_CHANGED_MESSAGE,
} from "../../shared/workspaceAuth";

import {creditCardWorkspaceRoles} from "../callable";
import {executeCloseCreditCardInvoice} from "../closeInvoice";
import type {
  CloseCreditCardInvoicePayload,
  CreateCreditCardPurchasePayload,
  RegisterCreditCardInvoicePaymentPayload,
} from "../contracts";
import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "../createPurchase";
import {
  executeRegisterCreditCardInvoicePayment,
  type RegisterCreditCardInvoicePaymentResult,
} from "../registerInvoicePayment";

import {
  creditCardTestActor,
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationMember,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

/**
 * Releitura da autorização dentro da transação (P1, `reassertWorkspaceActor`).
 *
 * A pré-checagem do kernel roda antes da transação. Aqui o ator é resolvido
 * de verdade pelo resolvedor canônico, o membership muda e só então a
 * operação executa com o ator já resolvido — exatamente a janela em que um
 * membro removido ou rebaixado terminaria a operação com o poder antigo.
 */

const TEST_WORKSPACE_ID = "workspace-credit-card-reauthorization-test";
const TEST_OWNER_ID = "user-credit-card-reauthorization-owner";
const TEST_ADMIN_ID = "user-credit-card-reauthorization-admin";
const TEST_MEMBER_ID = "user-credit-card-reauthorization-member";
const TEST_CARD_ID = "card-credit-card-reauthorization-test";
const TEST_INVOICE_ID = `${TEST_CARD_ID}_2026-04`;

const FOOTPRINT_COLLECTIONS = [
  "credit_card_purchases",
  "credit_card_installments",
  "credit_card_invoices",
  "credit_card_invoice_payments",
  "card_limit_ledger",
  "financial_events",
  "credit_card_audit_logs",
  "credit_card_operational_metrics",
  "credit_card_idempotency_keys",
  "invoice_views",
  "notifications",
  "transactions",
];

const workspaceFootprint = async (): Promise<Record<string, number>> => {
  const db = getIntegrationFirestore();
  const sizes = await Promise.all(
    FOOTPRINT_COLLECTIONS.map(async (collectionName) => {
      const snapshot = await db
        .collection(`workspaces/${TEST_WORKSPACE_ID}/${collectionName}`)
        .get();

      return [collectionName, snapshot.size] as const;
    }),
  );

  return Object.fromEntries(sizes);
};

const limitSnapshotData = async () => {
  const snapshot = await getIntegrationFirestore()
    .doc(
      `workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`,
    )
    .get();

  return snapshot.data();
};

const invoiceData = async () => {
  const snapshot = await getIntegrationFirestore()
    .doc(
      `workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${TEST_INVOICE_ID}`,
    )
    .get();

  return snapshot.data();
};

const updateMembership = async (
  uid: string,
  fields: Record<string, unknown>,
): Promise<void> => {
  await getIntegrationFirestore()
    .doc(`workspaces/${TEST_WORKSPACE_ID}/members/${uid}`)
    .update(fields);
};

const expectApplicationError = async (
  call: () => Promise<unknown>,
  code: string,
  message?: string,
): Promise<void> => {
  await assert.rejects(call, (error: unknown) => {
    assert.ok(error instanceof ApplicationError, "erro inesperado");
    assert.equal(error.code, code);
    if (message !== undefined) {
      assert.equal(error.message, message);
    }
    // O erro de acesso não revela papel nem matriz de papéis.
    assert.doesNotMatch(JSON.stringify(error.details ?? {}), /role/i);
    return true;
  });
};

const purchasePayload = (
  idempotencyKey: string,
): CreateCreditCardPurchasePayload => ({
  workspaceId: TEST_WORKSPACE_ID,
  cardId: TEST_CARD_ID,
  description: "Compra releitura transacional",
  categorySnapshot: {label: "Testes"},
  purchaseDate: "2026-04-05",
  totalAmount: 1200,
  installmentsCount: 3,
  amountType: "total",
  source: "manual",
  idempotencyKey,
  correlationId: "reauthorization-create-purchase",
});

const setupWorkspace = async (): Promise<void> => {
  await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);

  await seedCreditCardIntegrationWorkspace({
    workspaceId: TEST_WORKSPACE_ID,
    ownerId: TEST_OWNER_ID,
    cardId: TEST_CARD_ID,
  });

  await seedCreditCardIntegrationMember({
    workspaceId: TEST_WORKSPACE_ID,
    userId: TEST_ADMIN_ID,
    role: "admin",
  });

  await seedCreditCardIntegrationMember({
    workspaceId: TEST_WORKSPACE_ID,
    userId: TEST_MEMBER_ID,
    role: "member",
  });
};

test(
  "createCreditCardPurchase recusa membership removido depois da " +
    "pré-checagem e não grava nada",
  async () => {
    await setupWorkspace();

    const actor = await resolveWorkspaceActor(
      TEST_MEMBER_ID,
      TEST_WORKSPACE_ID,
      creditCardWorkspaceRoles("createCreditCardPurchase"),
    );

    assert.equal(actor.role, "member");

    const footprintBefore = await workspaceFootprint();
    const payload = purchasePayload("reauthorization-removed-member-001");

    await updateMembership(TEST_MEMBER_ID, {status: "removed"});

    await expectApplicationError(
      () => executeCreateCreditCardPurchase({payload, actor}),
      "workspace_membership_required",
    );

    assert.deepEqual(await workspaceFootprint(), footprintBefore);

    const limitAfterRefusal = await limitSnapshotData();

    assert.equal(limitAfterRefusal?.limitUsed, 0);
    assert.equal(limitAfterRefusal?.limitAvailable, 5000);

    // Controle: com o membership ativo de novo, o mesmo contexto passa. A
    // recusa acima foi da releitura, não de outra pré-condição.
    await updateMembership(TEST_MEMBER_ID, {status: "active"});

    const result = await executeCreateCreditCardPurchase({
      payload,
      actor,
    }) as CreateCreditCardPurchaseResult;

    assert.equal(result.success, true);
    assert.equal((await workspaceFootprint()).credit_card_purchases, 1);
    assert.equal((await limitSnapshotData())?.limitUsed, 1200);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);

test(
  "createCreditCardPurchase recusa papel rebaixado e conta suspensa " +
    "depois da pré-checagem",
  async () => {
    await setupWorkspace();

    const adminActor = await resolveWorkspaceActor(
      TEST_ADMIN_ID,
      TEST_WORKSPACE_ID,
      creditCardWorkspaceRoles("createCreditCardPurchase"),
    );
    const ownerActor = await resolveWorkspaceActor(
      TEST_OWNER_ID,
      TEST_WORKSPACE_ID,
      creditCardWorkspaceRoles("createCreditCardPurchase"),
    );

    assert.equal(adminActor.role, "admin");
    assert.equal(ownerActor.role, "owner");

    const footprintBefore = await workspaceFootprint();

    await updateMembership(TEST_ADMIN_ID, {role: "viewer"});

    await expectApplicationError(
      () => executeCreateCreditCardPurchase({
        payload: purchasePayload("reauthorization-demoted-admin-001"),
        actor: adminActor,
      }),
      "workspace_role_denied",
      WORKSPACE_ROLE_CHANGED_MESSAGE,
    );

    await seedActiveAccount(TEST_OWNER_ID, {status: "suspended"});

    await expectApplicationError(
      () => executeCreateCreditCardPurchase({
        payload: purchasePayload("reauthorization-suspended-owner-001"),
        actor: ownerActor,
      }),
      "account_suspended",
    );

    assert.deepEqual(await workspaceFootprint(), footprintBefore);

    const limitAfterRefusal = await limitSnapshotData();

    assert.equal(limitAfterRefusal?.limitUsed, 0);
    assert.equal(limitAfterRefusal?.limitAvailable, 5000);

    await seedActiveAccount(TEST_OWNER_ID);
    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);

test(
  "registerCreditCardInvoicePayment recusa admin rebaixado depois da " +
    "pré-checagem sem tocar fatura, limite ou caixa",
  async () => {
    await setupWorkspace();

    await executeCreateCreditCardPurchase({
      payload: purchasePayload("reauthorization-payment-purchase-001"),
      actor: creditCardTestActor(TEST_WORKSPACE_ID, TEST_OWNER_ID),
    });

    const adminActor = await resolveWorkspaceActor(
      TEST_ADMIN_ID,
      TEST_WORKSPACE_ID,
      creditCardWorkspaceRoles("registerCreditCardInvoicePayment"),
    );

    assert.equal(adminActor.role, "admin");

    const footprintBefore = await workspaceFootprint();
    const invoiceBefore = await invoiceData();

    assert.equal(invoiceBefore?.status, "open");
    assert.equal(invoiceBefore?.paidAmount, 0);
    assert.equal(invoiceBefore?.remainingAmount, 400);

    const payload: RegisterCreditCardInvoicePaymentPayload = {
      workspaceId: TEST_WORKSPACE_ID,
      cardId: TEST_CARD_ID,
      invoiceId: TEST_INVOICE_ID,
      paymentDate: "2026-04-20",
      amount: 400,
      paymentMethod: "external",
      idempotencyKey: "reauthorization-demoted-payment-001",
      correlationId: "reauthorization-demoted-payment",
    };

    // `member` não paga fatura; e mesmo um papel permitido diferente do
    // resolvido recusaria: a releitura exige o papel da pré-checagem.
    await updateMembership(TEST_ADMIN_ID, {role: "member"});

    await expectApplicationError(
      () => executeRegisterCreditCardInvoicePayment({
        payload,
        actor: adminActor,
      }),
      "workspace_role_denied",
      WORKSPACE_ROLE_CHANGED_MESSAGE,
    );

    assert.deepEqual(await workspaceFootprint(), footprintBefore);

    const invoiceAfterRefusal = await invoiceData();

    assert.equal(invoiceAfterRefusal?.status, "open");
    assert.equal(invoiceAfterRefusal?.paidAmount, 0);
    assert.equal(invoiceAfterRefusal?.remainingAmount, 400);

    const limitAfterRefusal = await limitSnapshotData();

    assert.equal(limitAfterRefusal?.limitUsed, 1200);
    assert.equal(limitAfterRefusal?.limitAvailable, 3800);

    // Controle: devolvido o papel, o mesmo pagamento é aceito.
    await updateMembership(TEST_ADMIN_ID, {role: "admin"});

    const result = await executeRegisterCreditCardInvoicePayment({
      payload,
      actor: adminActor,
    }) as RegisterCreditCardInvoicePaymentResult;

    assert.equal(result.success, true);

    const invoiceAfterPayment = await invoiceData();

    assert.equal(invoiceAfterPayment?.paidAmount, 400);
    assert.equal(invoiceAfterPayment?.remainingAmount, 0);
    assert.equal(invoiceAfterPayment?.status, "paid");

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);

test(
  "closeCreditCardInvoice recusa admin removido depois da pré-checagem e " +
    "mantém a fatura aberta",
  async () => {
    await setupWorkspace();

    await executeCreateCreditCardPurchase({
      payload: purchasePayload("reauthorization-close-purchase-001"),
      actor: creditCardTestActor(TEST_WORKSPACE_ID, TEST_OWNER_ID),
    });

    const adminActor = await resolveWorkspaceActor(
      TEST_ADMIN_ID,
      TEST_WORKSPACE_ID,
      creditCardWorkspaceRoles("closeCreditCardInvoice"),
    );

    const footprintBefore = await workspaceFootprint();

    const payload: CloseCreditCardInvoicePayload = {
      workspaceId: TEST_WORKSPACE_ID,
      cardId: TEST_CARD_ID,
      invoiceId: TEST_INVOICE_ID,
      closedAt: "2026-04-10",
      idempotencyKey: "reauthorization-removed-close-001",
      correlationId: "reauthorization-removed-close",
    };

    await updateMembership(TEST_ADMIN_ID, {status: "removed"});

    await expectApplicationError(
      () => executeCloseCreditCardInvoice({payload, actor: adminActor}),
      "workspace_membership_required",
    );

    assert.deepEqual(await workspaceFootprint(), footprintBefore);
    assert.equal((await invoiceData())?.status, "open");

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);
