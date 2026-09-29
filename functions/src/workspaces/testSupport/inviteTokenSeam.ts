import {FieldValue} from "firebase-admin/firestore";

import {
  requireFirestoreEmulator,
} from "../../shared/testSupport/kernelTestSupport";
import {generateInviteToken, hashInviteToken} from "../inviteTokens";
import {inviteRef, inviteTokenRef} from "../model";

/**
 * Seam exclusivo de teste para convites (D-05).
 *
 * Em produção o token em claro só existe na memória da requisição que emite o
 * convite e seria entregue pelo e-mail transacional (E-11), que ainda não
 * existe. Os testes precisam de um token válido para exercitar o aceite sem
 * que o produto finja ter enviado e-mail: este helper emite um token novo
 * para um convite já existente e grava o ponteiro do hash, exatamente como a
 * emissão faria.
 *
 * Só roda contra o Emulator (`requireFirestoreEmulator`). Não é importado por
 * nenhum módulo de produção, não é exportado por `index.ts` e o diretório
 * `testSupport/` é ignorado no upload de deploy (`firebase.json`) — o teste de
 * contrato de deploy verifica as duas coisas.
 */
export const issueTestInviteToken = async (
  workspaceId: string,
  inviteId: string,
): Promise<string> => {
  requireFirestoreEmulator();
  const invite = await inviteRef(workspaceId, inviteId).get();
  if (!invite.exists) throw new Error("Convite inexistente no Emulator.");
  const token = generateInviteToken();
  await inviteTokenRef(hashInviteToken(token)).create({
    workspaceId,
    inviteId,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: invite.get("expiresAt"),
  });
  return token;
};
