import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {billingAccountRef, ensureBillingAccount} from "../billing/model";
import {appendMembershipEvent, type AuditSnapshot} from "../shared/audit";
import type {CallerIdentity} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
} from "../shared/idempotency";
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  assertActiveAccountSnapshot,
  evaluateWorkspaceAccess,
  reassertWorkspaceActor,
  userProfileRef,
  userWorkspaceIndexRef,
  workspaceMemberRef,
  workspaceRef,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import {normalizeCnpj} from "./cnpj";
import type {
  CreateWorkspacePayload,
  UpdateWorkspaceSettingsPayload,
} from "./contracts";
import {
  DEFAULT_ALERT_PREFERENCES,
  DEFAULT_THEME_COLOR,
  PERSONAL_WORKSPACE_NAME,
  memberIdentityFrom,
  newWorkspaceRef,
  workspaceDisplayOf,
  writeActiveMembership,
} from "./model";
import {provisionWorkspaceDefaults} from "./provisioning";

const db = () => admin.firestore();

/**
 * CNPJ do payload → valor persistido. Vazio vira `null`; em PF só `null` é
 * aceito; em PJ o número precisa ter dígitos verificadores válidos (D-22).
 */
export const resolveCnpj = (
  type: "PF" | "PJ",
  input: string | null | undefined,
): string | null => {
  if (input === undefined || input === null || input.trim() === "") {
    return null;
  }
  if (type === "PF") {
    throw new ApplicationError(
      "invalid_payload",
      "CNPJ só pode ser informado em espaços PJ.",
    );
  }
  const cnpj = normalizeCnpj(input);
  if (!cnpj) throw new ApplicationError("invalid_payload", "CNPJ inválido.");
  return cnpj;
};

const newWorkspaceDocument = (input: {
  uid: string;
  type: "PF" | "PJ";
  name: string;
  cnpj: string | null;
  themeColor: string;
}) => ({
  name: input.name,
  type: input.type,
  cnpj: input.cnpj,
  ownerId: input.uid,
  status: "active",
  currency: "BRL",
  themeColor: input.themeColor,
  alertPreferences: {...DEFAULT_ALERT_PREFERENCES},
  createdBy: input.uid,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
  archivedAt: null,
  archivedBy: null,
});

export interface BootstrapAccountResult extends Record<string, unknown> {
  created: boolean;
  workspaceId: string | null;
}

/**
 * `bootstrapAccount` (PR-AUTH-03).
 *
 * Garante que a conta exista e tenha ao menos um workspace ativo. Na primeira
 * chamada cria, numa única transação, o perfil, o workspace PF "Meu Espaço
 * Pessoal" já provisionado com os cadastros padrão (`provisioning.ts`), o
 * membership owner, o índice, a auditoria e o estado de billing Free
 * (`billing_accounts/{uid}`, P2A). Nas seguintes é leitura pura — salvo
 * criar o billing Free se ele ainda não existir; um estado existente nunca é
 * sobrescrito.
 *
 * Concorrência: toda chamada lê `users/{uid}` e todo caminho que cria algo
 * também escreve nesse documento. Duas chamadas simultâneas disputam o mesmo
 * documento; a perdedora é repetida pelo Firestore, encontra o workspace já
 * criado e devolve `created: false`. Não há estado parcial: ou tudo foi
 * gravado, ou nada.
 *
 * Se a conta existe mas ficou sem nenhum workspace ativo (saiu de todos,
 * arquivou o pessoal), um novo workspace pessoal é criado pelo mesmo caminho.
 */
export const executeBootstrapAccount = async (
  caller: CallerIdentity,
  requestId: string,
): Promise<BootstrapAccountResult> =>
  db().runTransaction(async (transaction) => {
    const profileRef = userProfileRef(caller.uid);
    const profile = await transaction.get(profileRef);
    const status = profile.get("status");
    if (profile.exists && status !== undefined && status !== "active") {
      throw new ApplicationError(
        "account_suspended",
        ACCOUNT_SUSPENDED_MESSAGE,
      );
    }
    // Lido antes de qualquer escrita (regra de transação do Firestore).
    const billing = await transaction.get(billingAccountRef(caller.uid));
    const identity = memberIdentityFrom(caller);
    const initialized = profile.exists && status === "active";
    if (initialized) {
      const active = await transaction.get(
        profileRef.collection("workspaces")
          .where("status", "==", "active")
          .where("workspaceStatus", "==", "active")
          .limit(1),
      );
      if (!active.empty) {
        const changed =
          profile.get("email") !== identity.email ||
          profile.get("displayName") !== identity.displayName ||
          profile.get("photoURL") !== identity.photoURL;
        if (changed) {
          transaction.update(profileRef, {
            ...identity,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        ensureBillingAccount(transaction, caller.uid, billing);
        return {created: false, workspaceId: null};
      }
    }

    const workspaceDoc = newWorkspaceRef();
    const workspace = newWorkspaceDocument({
      uid: caller.uid,
      type: "PF",
      name: PERSONAL_WORKSPACE_NAME,
      cnpj: null,
      themeColor: DEFAULT_THEME_COLOR.PF,
    });
    if (profile.exists) {
      transaction.set(profileRef, {
        uid: caller.uid,
        ...identity,
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
        ...(initialized ? {} : {createdAt: FieldValue.serverTimestamp()}),
      }, {merge: true});
    } else {
      transaction.create(profileRef, {
        uid: caller.uid,
        ...identity,
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    ensureBillingAccount(transaction, caller.uid, billing);
    transaction.create(workspaceDoc, workspace);
    writeActiveMembership(transaction, {
      workspaceId: workspaceDoc.id,
      uid: caller.uid,
      role: "owner",
      caller,
      email: null,
      workspace: {name: workspace.name, type: "PF", status: "active"},
      invitedBy: null,
      existing: false,
    });
    if (!initialized) {
      appendMembershipEvent(transaction, {
        workspaceId: workspaceDoc.id,
        operation: "account.bootstrapped",
        actorId: caller.uid,
        actorRole: null,
        targetId: caller.uid,
        before: null,
        after: {status: "active"},
        reason: null,
        requestId,
      });
    }
    const defaults = provisionWorkspaceDefaults(transaction, {
      workspaceId: workspaceDoc.id,
      type: "PF",
      uid: caller.uid,
    });
    appendMembershipEvent(transaction, {
      workspaceId: workspaceDoc.id,
      operation: "workspace.created",
      actorId: caller.uid,
      actorRole: "owner",
      targetId: workspaceDoc.id,
      before: null,
      after: {
        type: "PF",
        status: "active",
        ownerId: caller.uid,
        defaultCatalogItems: defaults.catalogItemCount,
      },
      reason: initialized ? "personal_workspace_restored" : "bootstrap",
      requestId,
    });
    return {created: true, workspaceId: workspaceDoc.id};
  });

/**
 * `createWorkspace` (PR-WS-05): workspace, owner, índice, cadastros padrão e
 * auditoria numa única transação idempotente. P2 acrescenta a quota nesta
 * transação.
 */
export const executeCreateWorkspace = async (
  caller: CallerIdentity,
  payload: CreateWorkspacePayload,
  requestId: string,
): Promise<Record<string, unknown>> => {
  const cnpj = resolveCnpj(payload.type, payload.cnpj);
  return db().runTransaction(async (transaction) => {
    const reservation = await reserveActorIdempotency(transaction, {
      uid: caller.uid,
      operation: "createWorkspace",
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (reservation.replay) return reservation.replay;
    assertActiveAccountSnapshot(
      await transaction.get(userProfileRef(caller.uid)),
    );

    const workspaceDoc = newWorkspaceRef();
    const workspace = newWorkspaceDocument({
      uid: caller.uid,
      type: payload.type,
      name: payload.name,
      cnpj,
      themeColor: payload.themeColor ?? DEFAULT_THEME_COLOR[payload.type],
    });
    transaction.create(workspaceDoc, workspace);
    writeActiveMembership(transaction, {
      workspaceId: workspaceDoc.id,
      uid: caller.uid,
      role: "owner",
      caller,
      email: null,
      workspace: {name: payload.name, type: payload.type, status: "active"},
      invitedBy: null,
      existing: false,
    });
    const defaults = provisionWorkspaceDefaults(transaction, {
      workspaceId: workspaceDoc.id,
      type: payload.type,
      uid: caller.uid,
    });
    appendMembershipEvent(transaction, {
      workspaceId: workspaceDoc.id,
      operation: "workspace.created",
      actorId: caller.uid,
      actorRole: "owner",
      targetId: workspaceDoc.id,
      before: null,
      after: {
        type: payload.type,
        status: "active",
        ownerId: caller.uid,
        defaultCatalogItems: defaults.catalogItemCount,
      },
      reason: null,
      requestId,
    });
    const result = {workspaceId: workspaceDoc.id};
    completeActorIdempotency(transaction, reservation, {
      uid: caller.uid,
      operation: "createWorkspace",
      workspaceId: workspaceDoc.id,
      requestId,
      result,
    });
    return result;
  });
};

const ALERT_KEYS = [
  "billing",
  "accountsPayable",
  "delinquency",
  "lowMargin",
] as const;

/**
 * `updateWorkspaceSettings`: allowlist estrita (nome, CNPJ, cor, alertas).
 * `ownerId`, `type`, `status`, moeda, cobrança e papéis não são editáveis.
 */
export const executeUpdateWorkspaceSettings = async (
  actor: WorkspaceActor,
  payload: UpdateWorkspaceSettingsPayload,
  requestId: string,
): Promise<Record<string, unknown>> =>
  db().runTransaction(async (transaction) => {
    const {workspace, role} = await reassertWorkspaceActor(
      transaction,
      actor,
      ["owner", "admin"],
    );
    const type = workspace.type === "PJ" ? "PJ" : "PF";
    const patch: Record<string, unknown> = {};
    const before: AuditSnapshot = {};
    const after: AuditSnapshot = {};

    if (payload.name !== undefined && payload.name !== workspace.name) {
      patch.name = payload.name;
      before.name = typeof workspace.name === "string" ? workspace.name : null;
      after.name = payload.name;
    }
    if (payload.cnpj !== undefined) {
      const cnpj = resolveCnpj(type, payload.cnpj);
      if (cnpj !== (workspace.cnpj ?? null)) {
        patch.cnpj = cnpj;
        // O CNPJ fica no documento; a auditoria registra só a mudança.
        before.cnpjDefined = Boolean(workspace.cnpj);
        after.cnpjDefined = cnpj !== null;
      }
    }
    if (
      payload.themeColor !== undefined &&
      payload.themeColor !== workspace.themeColor
    ) {
      patch.themeColor = payload.themeColor;
      before.themeColor = typeof workspace.themeColor === "string" ?
        workspace.themeColor :
        null;
      after.themeColor = payload.themeColor;
    }
    if (payload.alertPreferences !== undefined) {
      const current = {
        ...DEFAULT_ALERT_PREFERENCES,
        ...(workspace.alertPreferences ?? {}),
      } as Record<string, unknown>;
      const next = payload.alertPreferences;
      const changedKeys = ALERT_KEYS.filter(
        (key) => current[key] !== next[key],
      );
      if (changedKeys.length > 0 || !workspace.alertPreferences) {
        patch.alertPreferences = {...next};
        for (const key of changedKeys) {
          before[`alert_${key}`] = current[key] === true;
          after[`alert_${key}`] = next[key];
        }
      }
    }

    if (Object.keys(patch).length === 0) return {updated: false};
    transaction.update(workspaceRef(actor.workspaceId), {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (patch.name !== undefined) {
      // A entrada do próprio ator muda na mesma transação; as dos demais
      // membros são atualizadas pelo gatilho `syncWorkspaceIndexEntries`.
      transaction.set(userWorkspaceIndexRef(actor.uid, actor.workspaceId), {
        name: patch.name,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    appendMembershipEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "workspace.settings_updated",
      actorId: actor.uid,
      actorRole: role,
      targetId: actor.workspaceId,
      before,
      after,
      reason: null,
      requestId,
    });
    return {updated: true};
  });

/**
 * `archiveWorkspace`: só o owner, com autenticação recente (D-06). Nunca
 * apaga: o documento permanece com `status: "archived"`, o que impede recriar
 * o mesmo ID sobre subcoleções órfãs. Repetir sobre um workspace já arquivado
 * pelo próprio owner devolve o mesmo resultado, sem nova auditoria.
 */
export const executeArchiveWorkspace = async (
  uid: string,
  workspaceId: string,
  requestId: string,
): Promise<Record<string, unknown>> =>
  db().runTransaction(async (transaction) => {
    const [profile, workspace, member] = await transaction.getAll(
      userProfileRef(uid),
      workspaceRef(workspaceId),
      workspaceMemberRef(workspaceId, uid),
    );
    if (workspace.get("status") === "archived") {
      assertActiveAccountSnapshot(profile);
      if (
        member.get("status") === "active" &&
        member.get("role") === "owner"
      ) {
        return {status: "archived", alreadyArchived: true};
      }
    }
    evaluateWorkspaceAccess({profile, workspace, member}, ["owner"]);
    transaction.update(workspaceRef(workspaceId), {
      status: "archived",
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(userWorkspaceIndexRef(uid, workspaceId), {
      workspaceStatus: "archived",
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    appendMembershipEvent(transaction, {
      workspaceId,
      operation: "workspace.archived",
      actorId: uid,
      actorRole: "owner",
      targetId: workspaceId,
      before: {status: workspaceDisplayOf(workspace.data() ?? {}).status},
      after: {status: "archived"},
      reason: null,
      requestId,
    });
    return {status: "archived", alreadyArchived: false};
  });
