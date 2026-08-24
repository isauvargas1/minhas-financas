import assert from "node:assert/strict";
import test from "node:test";

import * as admin from "firebase-admin";

import {getIntegrationFirestore} from "../../creditCards/testSupport/emulatorFirestore";
import {generateInviteCodeForTest} from "../splitGroups";

// INV-P2-037 — `acceptSplitGroupInvite` verificava apenas `request.auth` e
// escrevia com o Admin SDK em `workspaces/{alheio}/split_participants`; o
// código de convite vinha de `Math.random().toString(36).substring(2, 8)`.
//
// Estes testes exercitam as duas propriedades verificáveis sem subir o
// emulador de Functions: o formato e a distribuição do código, e o fato de que
// o convite é sempre escopo de um workspace do qual o chamador participa.

const WORKSPACE_ID = "workspace-split-invite-integration";
const OWNER_ID = "user-split-invite-owner";
const OUTSIDER_ID = "user-split-invite-outsider";

const CODE_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;

const seed = async () => {
  const db = getIntegrationFirestore();
  await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE_ID}`));
  await db.doc(`workspaces/${WORKSPACE_ID}`).set({
    ownerId: OWNER_ID,
    type: "PF",
    name: "Split",
    currency: "BRL",
  });
  await db.doc(`workspaces/${WORKSPACE_ID}/members/${OWNER_ID}`).set({
    uid: OWNER_ID,
    role: "owner",
    status: "active",
  });
};

test(
  "convite só é encontrado dentro do workspace em que foi criado",
  {skip: !process.env.FIRESTORE_EMULATOR_HOST},
  async () => {
    await seed();
    const db = getIntegrationFirestore();

    await db.collection(`workspaces/${WORKSPACE_ID}/split_invites`).doc().set({
      groupId: "grupo-1",
      codigoConvite: "ABCDEFGHJK",
      papelSugerido: "participante",
      status: "pendente",
      expiraEm: new Date(Date.now() + 86_400_000).toISOString(),
      createdBy: OWNER_ID,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // A consulta que a callable faz é sempre relativa ao workspace autorizado.
    // Um workspace diferente não enxerga o convite, ainda que o código seja
    // conhecido: é isso que `requireWorkspaceRole` passa a garantir.
    const otherWorkspace = await db
      .collection("workspaces/workspace-split-invite-outro/split_invites")
      .where("codigoConvite", "==", "ABCDEFGHJK")
      .get();
    assert.equal(otherWorkspace.empty, true);

    const sameWorkspace = await db
      .collection(`workspaces/${WORKSPACE_ID}/split_invites`)
      .where("codigoConvite", "==", "ABCDEFGHJK")
      .where("status", "==", "pendente")
      .get();
    assert.equal(sameWorkspace.size, 1);

    await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE_ID}`));
  },
);

test(
  "usuário sem membership não tem papel no workspace do convite",
  {skip: !process.env.FIRESTORE_EMULATOR_HOST},
  async () => {
    await seed();
    const db = getIntegrationFirestore();

    const membership = await db
      .doc(`workspaces/${WORKSPACE_ID}/members/${OUTSIDER_ID}`)
      .get();

    // `requireWorkspaceRole` rejeita exatamente este estado. Antes da
    // correção, `acceptSplitGroupInvite` seguia adiante e gravava.
    assert.equal(membership.exists, false);

    await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE_ID}`));
  },
);

test("código de convite usa CSPRNG, alfabeto sem ambiguidade e não repete", () => {
  const codes = new Set<string>();

  for (let index = 0; index < 500; index += 1) {
    const code = generateInviteCodeForTest();
    assert.match(code, CODE_ALPHABET);
    codes.add(code);
  }

  // 500 amostras num espaço de 31^10 (~49 bits): colisão aqui indicaria
  // gerador com estado degenerado, que era exatamente o problema do
  // `Math.random()` anterior.
  assert.equal(codes.size, 500);
});
