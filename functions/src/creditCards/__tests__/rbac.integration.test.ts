import assert from "node:assert/strict";
import test from "node:test";
import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";

import {
  callableRequest,
  seedActiveAccount,
} from "../../shared/testSupport/kernelTestSupport";
import {
  ACCOUNT_NOT_INITIALIZED_MESSAGE,
  ACCOUNT_SUSPENDED_MESSAGE,
  WORKSPACE_ACCESS_DENIED_MESSAGE,
  WORKSPACE_ARCHIVED_MESSAGE,
  WORKSPACE_ROLE_CHANGED_MESSAGE,
  WORKSPACE_ROLE_DENIED_MESSAGE,
  type WorkspaceRole,
} from "../../shared/workspaceAuth";

import {creditCardWorkspaceRoles} from "../callable";
import {
  cancelCreditCardPurchase,
  closeCreditCardInvoice,
  createCreditCardPurchase,
  rebuildCardInvoicesForCard,
  recalculateCardLimit,
  registerCreditCardInvoicePayment,
  reopenCreditCardInvoice,
  reverseCreditCardInvoicePayment,
  updateCreditCardPurchase,
} from "../callables";
import type {CreditCardBackendWriteOperation} from "../writeStrategy";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationMember,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-rbac-test";
const TEST_OWNER_ID = "user-credit-card-rbac-owner";
const TEST_ADMIN_ID = "user-credit-card-rbac-admin";
const TEST_MEMBER_ID = "user-credit-card-rbac-member";
const TEST_VIEWER_ID = "user-credit-card-rbac-viewer";
const TEST_OUTSIDER_ID = "user-credit-card-rbac-outsider";
const TEST_REMOVED_ID = "user-credit-card-rbac-removed";
const TEST_SUSPENDED_ID = "user-credit-card-rbac-suspended";
const TEST_NO_PROFILE_ID = "user-credit-card-rbac-no-profile";
const TEST_CARD_ID = "card-credit-card-rbac-test";

const LEGACY_WORKSPACE_ID = "workspace-credit-card-rbac-owner-only";
const LEGACY_OWNER_ID = "user-credit-card-rbac-owner-only";
const LEGACY_CARD_ID = "card-credit-card-rbac-owner-only";

const ARCHIVED_WORKSPACE_ID = "workspace-credit-card-rbac-archived";
const ARCHIVED_OWNER_ID = "user-credit-card-rbac-archived-owner";
const ARCHIVED_CARD_ID = "card-credit-card-rbac-archived";

type CallableOperation = Exclude<
  CreditCardBackendWriteOperation,
  "migrateLegacyInstallmentsToInvoiceDomain"
>;

interface RunnableCallable {
  run: (request: CallableRequest<unknown>) => Promise<unknown>;
}

const CALLABLES: Record<CallableOperation, RunnableCallable> = {
  createCreditCardPurchase: createCreditCardPurchase,
  updateCreditCardPurchase: updateCreditCardPurchase,
  cancelCreditCardPurchase: cancelCreditCardPurchase,
  closeCreditCardInvoice: closeCreditCardInvoice,
  reopenCreditCardInvoice: reopenCreditCardInvoice,
  registerCreditCardInvoicePayment: registerCreditCardInvoicePayment,
  reverseCreditCardInvoicePayment: reverseCreditCardInvoicePayment,
  recalculateCardLimit: recalculateCardLimit,
  rebuildCardInvoicesForCard: rebuildCardInvoicesForCard,
};

/**
 * Matriz esperada, escrita à mão: uma mudança em `writeStrategy.ts` que
 * amplie ou reduza papéis precisa aparecer aqui também. `viewer` é somente
 * leitura e não escreve em operação alguma.
 */
const EXPECTED_ALLOWED_ROLES: Record<CallableOperation, WorkspaceRole[]> = {
  createCreditCardPurchase: ["owner", "admin", "member"],
  updateCreditCardPurchase: ["owner", "admin", "member"],
  cancelCreditCardPurchase: ["owner", "admin"],
  closeCreditCardInvoice: ["owner", "admin"],
  reopenCreditCardInvoice: ["owner", "admin"],
  registerCreditCardInvoicePayment: ["owner", "admin"],
  reverseCreditCardInvoicePayment: ["owner", "admin"],
  recalculateCardLimit: ["owner", "admin"],
  rebuildCardInvoicesForCard: ["owner", "admin"],
};

const OPERATIONS = Object.keys(CALLABLES) as CallableOperation[];

const USER_BY_ROLE: Record<WorkspaceRole, string> = {
  owner: TEST_OWNER_ID,
  admin: TEST_ADMIN_ID,
  member: TEST_MEMBER_ID,
  viewer: TEST_VIEWER_ID,
};

const ACCESS_MESSAGES = new Set([
  ACCOUNT_NOT_INITIALIZED_MESSAGE,
  ACCOUNT_SUSPENDED_MESSAGE,
  WORKSPACE_ACCESS_DENIED_MESSAGE,
  WORKSPACE_ARCHIVED_MESSAGE,
  WORKSPACE_ROLE_CHANGED_MESSAGE,
  WORKSPACE_ROLE_DENIED_MESSAGE,
]);

/** Coleções em que uma chamada negada não pode deixar rastro algum. */
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

const buildPayload = (
  operation: CallableOperation,
  label: string,
  workspaceId = TEST_WORKSPACE_ID,
  cardId = TEST_CARD_ID,
): Record<string, unknown> => {
  const base = {
    workspaceId,
    cardId,
    idempotencyKey: `rbac-${label}-${operation}`,
    correlationId: `rbac-${label}-${operation}`,
  };
  const invoiceId = `${cardId}_2026-04`;

  switch (operation) {
  case "createCreditCardPurchase":
    return {
      ...base,
      description: "Compra RBAC",
      categorySnapshot: {label: "RBAC"},
      purchaseDate: "2026-04-05",
      totalAmount: 100,
      installmentsCount: 1,
      amountType: "total",
      source: "manual",
    };
  case "updateCreditCardPurchase":
    return {
      ...base,
      purchaseId: "purchase-rbac-inexistente",
      description: "Compra RBAC editada",
      reason: "Teste RBAC de edição",
    };
  case "cancelCreditCardPurchase":
    return {
      ...base,
      purchaseId: "purchase-rbac-inexistente",
      reason: "Teste RBAC de cancelamento",
      policy: "block_if_invoice_paid",
    };
  case "closeCreditCardInvoice":
    return {...base, invoiceId, closedAt: "2026-04-10"};
  case "reopenCreditCardInvoice":
    return {
      ...base,
      invoiceId,
      reason: "Teste RBAC de reabertura",
      policy: "block_if_paid",
    };
  case "registerCreditCardInvoicePayment":
    return {
      ...base,
      invoiceId,
      paymentDate: "2026-04-20",
      amount: 100,
      paymentMethod: "external",
    };
  case "reverseCreditCardInvoicePayment":
    return {
      ...base,
      invoiceId,
      paymentId: "payment-rbac-inexistente",
      reason: "Teste RBAC de estorno",
      reversedAt: "2026-04-21",
    };
  case "recalculateCardLimit":
    return {...base, reason: "Teste RBAC de recálculo"};
  case "rebuildCardInvoicesForCard":
    return {
      ...base,
      fromCompetenceMonth: "2026-04",
      toCompetenceMonth: "2026-04",
      reason: "Teste RBAC de rebuild",
    };
  }
};

const runAs = (
  operation: CallableOperation,
  uid: string,
  payload: Record<string, unknown>,
): Promise<unknown> =>
  CALLABLES[operation].run(callableRequest(uid, payload));

const workspaceFootprint = async (
  workspaceId: string,
): Promise<Record<string, number>> => {
  const db = getIntegrationFirestore();
  const sizes = await Promise.all(
    FOOTPRINT_COLLECTIONS.map(async (collectionName) => {
      const snapshot = await db
        .collection(`workspaces/${workspaceId}/${collectionName}`)
        .get();

      return [collectionName, snapshot.size] as const;
    }),
  );

  return Object.fromEntries(sizes);
};

const expectDenied = async (
  call: () => Promise<unknown>,
  expectedMessage: string,
  context: string,
): Promise<void> => {
  await assert.rejects(call, (error: unknown) => {
    assert.ok(error instanceof HttpsError, `${context}: erro inesperado`);
    assert.equal(error.code, "permission-denied", context);
    assert.equal(error.message, expectedMessage, context);
    // O detalhe público nunca revela papel nem a matriz de papéis.
    assert.doesNotMatch(
      JSON.stringify(error.details ?? {}),
      /role/i,
      context,
    );
    return true;
  });
};

const expectAuthorized = async (
  call: () => Promise<unknown>,
  context: string,
): Promise<void> => {
  try {
    await call();
  } catch (error) {
    // Autorizado significa que a pré-checagem e a releitura transacional
    // passaram: a operação pode falhar por regra de domínio (alvo inexistente,
    // estado da fatura), nunca por acesso nem por erro interno.
    assert.ok(error instanceof HttpsError, `${context}: erro inesperado`);
    assert.notEqual(error.code, "permission-denied", context);
    assert.notEqual(error.code, "unauthenticated", context);
    assert.notEqual(error.code, "internal", context);
    assert.equal(ACCESS_MESSAGES.has(error.message), false, context);
  }
};

test("matriz de papéis das callables de cartão exclui system e viewer", () => {
  for (const operation of OPERATIONS) {
    assert.deepEqual(
      [...creditCardWorkspaceRoles(operation)].sort(),
      [...EXPECTED_ALLOWED_ROLES[operation]].sort(),
      operation,
    );
    assert.equal(
      creditCardWorkspaceRoles(operation).includes("viewer"),
      false,
      operation,
    );
  }
});

test(
  "RBAC do domínio de cartão restringe cada callable por papel do membership",
  async () => {
    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);

    await seedCreditCardIntegrationWorkspace({
      workspaceId: TEST_WORKSPACE_ID,
      ownerId: TEST_OWNER_ID,
      cardId: TEST_CARD_ID,
    });

    for (const role of ["admin", "member", "viewer"] as const) {
      await seedCreditCardIntegrationMember({
        workspaceId: TEST_WORKSPACE_ID,
        userId: USER_BY_ROLE[role],
        role,
      });
    }

    // Conta ativa, mas sem membership neste workspace.
    await seedActiveAccount(TEST_OUTSIDER_ID);

    const footprintBefore = await workspaceFootprint(TEST_WORKSPACE_ID);

    for (const operation of OPERATIONS) {
      for (const role of ["owner", "admin", "member", "viewer"] as const) {
        if (EXPECTED_ALLOWED_ROLES[operation].includes(role)) {
          continue;
        }

        await expectDenied(
          () => runAs(
            operation,
            USER_BY_ROLE[role],
            buildPayload(operation, `denied-${role}`),
          ),
          WORKSPACE_ROLE_DENIED_MESSAGE,
          `${operation} como ${role}`,
        );
      }

      await expectDenied(
        () => runAs(
          operation,
          TEST_OUTSIDER_ID,
          buildPayload(operation, "denied-outsider"),
        ),
        WORKSPACE_ACCESS_DENIED_MESSAGE,
        `${operation} como não membro`,
      );
    }

    // Nenhuma chamada negada escreve no workspace — nem dado financeiro, nem
    // métrica, evento ou notificação de falha (INV-P0-001).
    assert.deepEqual(
      await workspaceFootprint(TEST_WORKSPACE_ID),
      footprintBefore,
    );

    for (const operation of OPERATIONS) {
      for (const role of EXPECTED_ALLOWED_ROLES[operation]) {
        await expectAuthorized(
          () => runAs(
            operation,
            USER_BY_ROLE[role],
            buildPayload(operation, `allowed-${role}`),
          ),
          `${operation} como ${role}`,
        );
      }
    }

    const db = getIntegrationFirestore();
    const purchases = await db
      .collection(`workspaces/${TEST_WORKSPACE_ID}/credit_card_purchases`)
      .get();

    // owner, admin e member criaram uma compra cada.
    assert.deepEqual(
      purchases.docs.map((purchase) => purchase.get("createdBy")).sort(),
      [TEST_ADMIN_ID, TEST_MEMBER_ID, TEST_OWNER_ID].sort(),
    );

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);

test(
  "owner apenas por ownerId, sem membership, é negado e nada é gravado",
  async () => {
    await resetCreditCardIntegrationWorkspace(LEGACY_WORKSPACE_ID);

    await seedCreditCardIntegrationWorkspace({
      workspaceId: LEGACY_WORKSPACE_ID,
      ownerId: LEGACY_OWNER_ID,
      cardId: LEGACY_CARD_ID,
    });

    // `workspace.ownerId` continua apontando para o usuário, mas o membership
    // não existe: o campo denormalizado nunca autoriza (D-02).
    const db = getIntegrationFirestore();

    await db
      .doc(`workspaces/${LEGACY_WORKSPACE_ID}/members/${LEGACY_OWNER_ID}`)
      .delete();
    await db
      .doc(`users/${LEGACY_OWNER_ID}/workspaces/${LEGACY_WORKSPACE_ID}`)
      .delete();

    const workspace = await db.doc(`workspaces/${LEGACY_WORKSPACE_ID}`).get();

    assert.equal(workspace.get("ownerId"), LEGACY_OWNER_ID);

    const footprintBefore = await workspaceFootprint(LEGACY_WORKSPACE_ID);

    for (const operation of OPERATIONS) {
      await expectDenied(
        () => runAs(
          operation,
          LEGACY_OWNER_ID,
          buildPayload(
            operation,
            "owner-only",
            LEGACY_WORKSPACE_ID,
            LEGACY_CARD_ID,
          ),
        ),
        WORKSPACE_ACCESS_DENIED_MESSAGE,
        `${operation} como owner sem membership`,
      );
    }

    assert.deepEqual(
      await workspaceFootprint(LEGACY_WORKSPACE_ID),
      footprintBefore,
    );

    const limitSnapshot = await db
      .doc(
        `workspaces/${LEGACY_WORKSPACE_ID}/card_limit_snapshots/` +
          LEGACY_CARD_ID,
      )
      .get();

    assert.equal(limitSnapshot.get("limitUsed"), 0);
    assert.equal(limitSnapshot.get("limitAvailable"), 5000);

    await resetCreditCardIntegrationWorkspace(LEGACY_WORKSPACE_ID);
  },
);

test(
  "membership removido, conta suspensa, conta sem perfil e workspace " +
    "arquivado são negados sem escrita",
  async () => {
    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
    await resetCreditCardIntegrationWorkspace(ARCHIVED_WORKSPACE_ID);

    await seedCreditCardIntegrationWorkspace({
      workspaceId: TEST_WORKSPACE_ID,
      ownerId: TEST_OWNER_ID,
      cardId: TEST_CARD_ID,
    });

    await seedCreditCardIntegrationMember({
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_REMOVED_ID,
      role: "admin",
    });

    const db = getIntegrationFirestore();

    await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/members/${TEST_REMOVED_ID}`)
      .update({status: "removed"});

    await seedCreditCardIntegrationMember({
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_SUSPENDED_ID,
      role: "admin",
    });
    await seedActiveAccount(TEST_SUSPENDED_ID, {status: "suspended"});

    // Membership ativo, mas sem o perfil server-owned `users/{uid}`.
    await seedCreditCardIntegrationMember({
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_NO_PROFILE_ID,
      role: "admin",
    });
    await db.doc(`users/${TEST_NO_PROFILE_ID}`).delete();

    await seedCreditCardIntegrationWorkspace({
      workspaceId: ARCHIVED_WORKSPACE_ID,
      ownerId: ARCHIVED_OWNER_ID,
      cardId: ARCHIVED_CARD_ID,
    });
    await db
      .doc(`workspaces/${ARCHIVED_WORKSPACE_ID}`)
      .update({status: "archived"});

    const footprintBefore = await workspaceFootprint(TEST_WORKSPACE_ID);
    const archivedFootprintBefore = await workspaceFootprint(
      ARCHIVED_WORKSPACE_ID,
    );

    for (const operation of [
      "createCreditCardPurchase",
      "registerCreditCardInvoicePayment",
    ] as const) {
      await expectDenied(
        () => runAs(
          operation,
          TEST_REMOVED_ID,
          buildPayload(operation, "removed"),
        ),
        WORKSPACE_ACCESS_DENIED_MESSAGE,
        `${operation} com membership removido`,
      );

      await expectDenied(
        () => runAs(
          operation,
          TEST_SUSPENDED_ID,
          buildPayload(operation, "suspended"),
        ),
        ACCOUNT_SUSPENDED_MESSAGE,
        `${operation} com conta suspensa`,
      );

      await assert.rejects(
        () => runAs(
          operation,
          TEST_NO_PROFILE_ID,
          buildPayload(operation, "no-profile"),
        ),
        (error: unknown) =>
          error instanceof HttpsError &&
          error.code === "failed-precondition" &&
          error.message === ACCOUNT_NOT_INITIALIZED_MESSAGE,
      );

      await assert.rejects(
        () => runAs(
          operation,
          ARCHIVED_OWNER_ID,
          buildPayload(
            operation,
            "archived",
            ARCHIVED_WORKSPACE_ID,
            ARCHIVED_CARD_ID,
          ),
        ),
        (error: unknown) =>
          error instanceof HttpsError &&
          error.code === "failed-precondition" &&
          error.message === WORKSPACE_ARCHIVED_MESSAGE,
      );
    }

    assert.deepEqual(
      await workspaceFootprint(TEST_WORKSPACE_ID),
      footprintBefore,
    );
    assert.deepEqual(
      await workspaceFootprint(ARCHIVED_WORKSPACE_ID),
      archivedFootprintBefore,
    );

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
    await resetCreditCardIntegrationWorkspace(ARCHIVED_WORKSPACE_ID);
  },
);

test("chamada sem autenticação é recusada sem escrita", async () => {
  await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);

  await seedCreditCardIntegrationWorkspace({
    workspaceId: TEST_WORKSPACE_ID,
    ownerId: TEST_OWNER_ID,
    cardId: TEST_CARD_ID,
  });

  const footprintBefore = await workspaceFootprint(TEST_WORKSPACE_ID);

  for (const operation of OPERATIONS) {
    await assert.rejects(
      () => CALLABLES[operation].run(
        callableRequest(null, buildPayload(operation, "anonymous")),
      ),
      (error: unknown) =>
        error instanceof HttpsError && error.code === "unauthenticated",
    );
  }

  assert.deepEqual(
    await workspaceFootprint(TEST_WORKSPACE_ID),
    footprintBefore,
  );

  await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
});
