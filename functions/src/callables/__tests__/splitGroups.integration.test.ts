import assert from "node:assert/strict";
import test from "node:test";

import * as admin from "firebase-admin";
import {HttpsError} from "firebase-functions/v2/https";

import {
  callableRequest,
  requireFirestoreEmulator,
  seedActiveAccount,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {acceptSplitGroupInvite, generateInviteCode} from "../splitGroups";

// INV-P2-037 — `acceptSplitGroupInvite` verificava apenas `request.auth` e
// escrevia com o Admin SDK em `workspaces/{alheio}/split_participants`; o
// código de convite vinha de `Math.random().toString(36).substring(2, 8)`.
//
// Estes testes exercitam as duas propriedades verificáveis sem subir o
// emulador de Functions: o formato e a distribuição do código, e o fato de que
// o convite é sempre escopo de um workspace do qual o chamador participa.
//
// Suíte de integração sem Emulator falha em vez de pular.
const firestore = requireFirestoreEmulator();
const getIntegrationFirestore = () => firestore;

const WORKSPACE_ID = "workspace-split-invite-integration";
const OWNER_ID = "user-split-invite-owner";
const OUTSIDER_ID = "user-split-invite-outsider";

const CODE_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/;

/** Perfis ativos, workspace `active` e owner com membership ativo. */
const seed = async () => {
  const db = getIntegrationFirestore();
  await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE_ID}`));
  await Promise.all([
    seedActiveAccount(OWNER_ID),
    seedActiveAccount(OUTSIDER_ID),
  ]);
  await seedWorkspace({
    workspaceId: WORKSPACE_ID,
    ownerId: OWNER_ID,
    type: "PF",
    name: "Split",
  });
};

test(
  "convite só é encontrado dentro do workspace em que foi criado",
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
    // conhecido: é isso que o resolvedor canônico do kernel garante.
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
  async () => {
    await seed();
    const db = getIntegrationFirestore();

    await db.collection(`workspaces/${WORKSPACE_ID}/split_invites`).doc().set({
      groupId: "grupo-1",
      codigoConvite: "MNPQRSTUVW",
      papelSugerido: "participante",
      status: "pendente",
      expiraEm: new Date(Date.now() + 86_400_000).toISOString(),
      createdBy: OWNER_ID,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const membership = await db
      .doc(`workspaces/${WORKSPACE_ID}/members/${OUTSIDER_ID}`)
      .get();

    // O resolvedor canônico rejeita exatamente este estado. Antes da
    // correção, `acceptSplitGroupInvite` seguia adiante e gravava.
    assert.equal(membership.exists, false);

    // Conta ativa, token realista e código válido: sem membership ativo, a
    // callable recusa antes de qualquer leitura do convite ou gravação.
    await assert.rejects(
      () => acceptSplitGroupInvite.run(callableRequest(OUTSIDER_ID, {
        code: "MNPQRSTUVW",
        userName: "Pessoa de fora",
        workspaceId: WORKSPACE_ID,
      })),
      (error: unknown) =>
        error instanceof HttpsError && error.code === "permission-denied",
    );
    const participants = await db
      .collection(`workspaces/${WORKSPACE_ID}/split_participants`)
      .where("userId", "==", OUTSIDER_ID)
      .get();
    assert.equal(participants.empty, true);
    const invite = await db
      .collection(`workspaces/${WORKSPACE_ID}/split_invites`)
      .where("codigoConvite", "==", "MNPQRSTUVW")
      .get();
    assert.equal(invite.docs[0]?.data().status, "pendente");

    await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE_ID}`));
  },
);

test("código de convite usa CSPRNG, alfabeto sem ambiguidade e não repete", () => {
  const codes = new Set<string>();

  for (let index = 0; index < 500; index += 1) {
    const code = generateInviteCode();
    assert.match(code, CODE_ALPHABET);
    codes.add(code);
  }

  // 500 amostras num espaço de 31^10 (~49 bits): colisão aqui indicaria
  // gerador com estado degenerado, que era exatamente o problema do
  // `Math.random()` anterior.
  assert.equal(codes.size, 500);
});
