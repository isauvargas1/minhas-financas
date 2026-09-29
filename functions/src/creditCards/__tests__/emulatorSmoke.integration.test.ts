import assert from "node:assert/strict";
import test from "node:test";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-integration-test";
const TEST_OWNER_ID = "user-credit-card-integration-owner";
const TEST_CARD_ID = "card-credit-card-integration-test";

test(
  "Firestore Emulator deve permitir seed isolado do workspace de cartão",
  async () => {
    const db = getIntegrationFirestore();

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);

    await seedCreditCardIntegrationWorkspace({
      workspaceId: TEST_WORKSPACE_ID,
      ownerId: TEST_OWNER_ID,
      cardId: TEST_CARD_ID,
    });

    const workspaceSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}`)
      .get();

    const memberSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/members/${TEST_OWNER_ID}`)
      .get();

    const cardSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_cards/${TEST_CARD_ID}`)
      .get();

    const limitSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
      .get();

    assert.equal(workspaceSnapshot.exists, true);
    assert.equal(memberSnapshot.exists, true);
    assert.equal(cardSnapshot.exists, true);
    assert.equal(limitSnapshot.exists, true);

    const profileSnapshot = await db.doc(`users/${TEST_OWNER_ID}`).get();

    // O seed reproduz o estado que o resolvedor canônico exige: perfil ativo,
    // workspace ativo e membership ativo. `ownerId` é só dado denormalizado.
    assert.equal(profileSnapshot.data()?.status, "active");
    assert.equal(workspaceSnapshot.data()?.status, "active");
    assert.equal(workspaceSnapshot.data()?.ownerId, TEST_OWNER_ID);
    assert.equal(memberSnapshot.data()?.role, "owner");
    assert.equal(memberSnapshot.data()?.status, "active");
    assert.equal(cardSnapshot.data()?.workspaceId, TEST_WORKSPACE_ID);
    assert.equal(cardSnapshot.data()?.limitTotal, 5000);
    assert.equal(limitSnapshot.data()?.limitAvailable, 5000);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);
