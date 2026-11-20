import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {
  FieldValue,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import type {CallerIdentity} from "../shared/callable";
import {ApplicationError} from "../shared/errors";

/**
 * Acesso fechado do piloto (P6-A, produção-piloto; gate G0 do
 * `LAUNCH_CHECKLIST.md`).
 *
 * O FênixGran começa só com o proprietário e, depois, com convidados. O
 * Firebase Auth aceita qualquer conta Google, então o controle fica no
 * servidor: uma conta só opera se o perfil `users/{uid}` tiver a autorização
 * de acesso `accessStatus == "granted"` (P6-B). Ela é negativa por padrão e
 * só o `bootstrapAccount` a grava, na mesma transação que valida o convite do
 * e-mail verificado (lista `pilot_access`, status `active`) e o vincula ao
 * `uid` (uso único). Vale para conta nova e para conta pré-existente (perfil
 * e membership ativos anteriores à P6-B, sem o campo): as duas precisam do
 * convite. O kernel das callables (`assertActiveAccountSnapshot`) e as Rules
 * (`hasActiveAccount`) exigem o campo no mesmo perfil que já leem; sem ele,
 * nenhuma leitura, listagem ou escrita de dados de workspace é aceita.
 *
 * A revogação (`tools/piloto/acesso-piloto.mjs revogar`) grava
 * `accessStatus: "revoked"` no perfil da conta vinculada, na mesma transação
 * que revoga o convite, e depois suspende a conta. O efeito vale na
 * requisição seguinte, mesmo com ID token vigente; nada é apagado.
 *
 * - A lista é só do backend: as Rules negam leitura e escrita ao cliente, e ela
 *   é mantida por `tools/piloto/acesso-piloto.mjs` (Admin SDK).
 * - O documento é identificado pelo SHA-256 do e-mail normalizado, para que o
 *   endereço não apareça em caminhos nem em logs. O e-mail fica só dentro do
 *   documento, para o proprietário saber quem convidou.
 * - Nenhum e-mail, UID ou segredo está no código.
 * - Fora do Emulator (`minhas-financas-local`), o modo é sempre `invite_only`,
 *   inclusive quando o projeto não pode ser identificado (fail closed).
 */
export const PILOT_ACCESS_COLLECTION = "pilot_access";
export const EMULATOR_PROJECT_ID = "minhas-financas-local";

export type PilotAccessMode = "open_emulator" | "invite_only";

export const PILOT_ACCESS_DENIED_MESSAGE =
  "O FênixGran está em piloto fechado e este acesso ainda não foi liberado. " +
  "Peça um convite ao responsável pelo piloto.";

const projectFromFirebaseConfig = (raw: string | undefined): string | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {projectId?: unknown};
    return typeof parsed.projectId === "string" ? parsed.projectId : null;
  } catch {
    return null;
  }
};

/**
 * Aberto só no Emulator. Todas as fontes de projeto que existirem precisam
 * apontar para o projeto do Emulator; qualquer divergência ou ausência fecha.
 */
export const resolvePilotAccessMode = (
  env: NodeJS.ProcessEnv = process.env,
): PilotAccessMode => {
  const sources = [
    env.GCLOUD_PROJECT,
    env.GOOGLE_CLOUD_PROJECT,
    projectFromFirebaseConfig(env.FIREBASE_CONFIG) ?? undefined,
  ].filter((value): value is string =>
    typeof value === "string" && value !== "");
  if (sources.length === 0) return "invite_only";
  return sources.every((value) => value === EMULATOR_PROJECT_ID) ?
    "open_emulator" :
    "invite_only";
};

/** Estados da autorização de acesso no perfil (campo `accessStatus`). */
export const ACCOUNT_ACCESS_GRANTED = "granted";
export const ACCOUNT_ACCESS_REVOKED = "revoked";

/** Origem da autorização: convite do piloto, ou o Emulator (sem lista). */
export type AccountAccessSource = "pilot_invite" | "emulator";

/** O perfil autoriza a conta a operar (mesmo critério das Rules). */
export const isAccountAccessGranted = (
  profile: {get: (field: string) => unknown},
): boolean => profile.get("accessStatus") === ACCOUNT_ACCESS_GRANTED;

export const normalizePilotEmail = (email: string): string =>
  email.trim().toLowerCase();

export const pilotAccessDocId = (email: string): string =>
  createHash("sha256").update(normalizePilotEmail(email)).digest("hex");

/** Convite aprovado na transação do bootstrap; registrado como usado depois. */
export interface PilotAccessGrant {
  readonly ref: DocumentReference;
  readonly boundUid: string | null;
}

/**
 * Lê a entrada do convidado na mesma transação da inicialização da conta.
 * Chamada antes de qualquer escrita (regra de transação do Firestore), sempre
 * que o perfil ainda não tem a autorização (`accessStatus != "granted"`).
 *
 * O convite é de uso único: depois do primeiro bootstrap ele guarda o `uid`
 * da conta (`recordPilotAccessUse`). Um convite já vinculado a outra conta não
 * serve (troca de e-mail na conta antiga e uma conta nova com o e-mail do
 * convite), e a revogação alcança a conta pelo `uid`, não pelo e-mail atual.
 *
 * No Emulator não há lista de convites e a autorização é dada sem convite,
 * salvo a de um perfil já revogado, que continua revogado (o mesmo
 * comportamento negativo da produção, onde só um convite ativo a reabre).
 */
export const assertPilotAccess = async (
  transaction: Transaction,
  caller: CallerIdentity,
  mode: PilotAccessMode,
  currentAccessStatus: unknown = undefined,
): Promise<PilotAccessGrant | null> => {
  if (mode === "open_emulator") {
    if (currentAccessStatus === ACCOUNT_ACCESS_REVOKED) {
      throw new ApplicationError(
        "pilot_access_required",
        PILOT_ACCESS_DENIED_MESSAGE,
      );
    }
    return null;
  }
  if (!caller.email || !caller.emailVerified) {
    throw new ApplicationError(
      "pilot_access_required",
      PILOT_ACCESS_DENIED_MESSAGE,
    );
  }
  const ref = admin.firestore()
    .collection(PILOT_ACCESS_COLLECTION)
    .doc(pilotAccessDocId(caller.email));
  const entry = await transaction.get(ref);
  if (!entry.exists || entry.get("status") !== "active") {
    throw new ApplicationError(
      "pilot_access_required",
      PILOT_ACCESS_DENIED_MESSAGE,
    );
  }
  const bound = entry.get("uid");
  const boundUid = typeof bound === "string" && bound.length > 0 ? bound : null;
  if (boundUid !== null && boundUid !== caller.uid) {
    throw new ApplicationError(
      "pilot_access_required",
      PILOT_ACCESS_DENIED_MESSAGE,
    );
  }
  return {ref, boundUid};
};

/**
 * Campos da autorização gravados no perfil pelo bootstrap, na mesma
 * transação que valida e vincula o convite. `grant` nulo só existe no
 * Emulator (`open_emulator`).
 */
export const accountAccessGrantFields = (
  grant: PilotAccessGrant | null,
): Record<string, unknown> => ({
  accessStatus: ACCOUNT_ACCESS_GRANTED,
  accessSource: (grant === null ? "emulator" : "pilot_invite") satisfies
    AccountAccessSource,
  accessInviteId: grant === null ? null : grant.ref.id,
  accessGrantedAt: FieldValue.serverTimestamp(),
});

/** Vincula o convite à conta (uso único), na mesma transação do bootstrap. */
export const recordPilotAccessUse = (
  transaction: Transaction,
  grant: PilotAccessGrant | null,
  caller: CallerIdentity,
): void => {
  if (grant === null || grant.boundUid === caller.uid) return;
  transaction.update(grant.ref, {
    uid: caller.uid,
    usadoEm: FieldValue.serverTimestamp(),
  });
};
