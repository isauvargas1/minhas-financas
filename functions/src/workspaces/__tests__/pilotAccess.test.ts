import assert from "node:assert/strict";
import test from "node:test";

import {
  EMULATOR_PROJECT_ID,
  normalizePilotEmail,
  pilotAccessDocId,
  resolvePilotAccessMode,
} from "../pilotAccess";

/*
 * P6-A: o piloto só fica aberto no Emulator. Qualquer projeto real, ausência de
 * projeto ou fonte divergente fecha o acesso (fail closed).
 */
test("acesso aberto só quando todas as fontes apontam para o Emulator", () => {
  assert.equal(resolvePilotAccessMode({GCLOUD_PROJECT: EMULATOR_PROJECT_ID}), "open_emulator");
  assert.equal(
    resolvePilotAccessMode({
      GCLOUD_PROJECT: EMULATOR_PROJECT_ID,
      FIREBASE_CONFIG: JSON.stringify({projectId: EMULATOR_PROJECT_ID}),
    }),
    "open_emulator",
  );
});

test("projeto real, ausente, divergente ou ilegível fecha o acesso", () => {
  const producao = "sistema-financeiro-pesso-20698";
  for (const env of [
    {},
    {GCLOUD_PROJECT: ""},
    {GCLOUD_PROJECT: producao},
    {GOOGLE_CLOUD_PROJECT: producao},
    {FIREBASE_CONFIG: JSON.stringify({projectId: producao})},
    {GCLOUD_PROJECT: EMULATOR_PROJECT_ID, GOOGLE_CLOUD_PROJECT: producao},
    {GCLOUD_PROJECT: EMULATOR_PROJECT_ID, FIREBASE_CONFIG: JSON.stringify({projectId: producao})},
    {FIREBASE_CONFIG: "nao-e-json"},
    {GCLOUD_PROJECT: "demo-minhas-financas-local"},
  ] as NodeJS.ProcessEnv[]) {
    assert.equal(resolvePilotAccessMode(env), "invite_only", JSON.stringify(env));
  }
});

test("o identificador do convite não contém o e-mail e ignora caixa e espaços", () => {
  const id = pilotAccessDocId("  Pessoa.Convidada@Exemplo.com ");
  assert.equal(id, pilotAccessDocId("pessoa.convidada@exemplo.com"));
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.ok(!id.includes("exemplo"));
  assert.equal(normalizePilotEmail(" A@B.COM "), "a@b.com");
});
