import {randomUUID} from "node:crypto";
import {onCall} from "firebase-functions/v2/https";
import type {
  CallableFunction,
  CallableOptions,
  CallableRequest,
} from "firebase-functions/v2/https";
import type {z} from "zod";

import {
  ApplicationError,
  INVALID_PAYLOAD_MESSAGE,
  errorCodeOf,
  toHttpsError,
} from "./errors";
import {
  createOperationLogger,
  traceFieldFromHeader,
  type OperationLogger,
} from "./logger";
import {DOMAIN_CALLABLE_OPTIONS} from "./runtimeOptions";
import {
  requireActiveAccount,
  resolveWorkspaceActor,
  type WorkspaceActor,
  type WorkspaceRole,
} from "./workspaceAuth";

/**
 * Wrapper único de callable (P1, §2.3).
 *
 * Centraliza, nesta ordem: identificador de requisição do servidor, log de
 * início, autenticação, política de token (`email_verified`, autenticação
 * recente), Zod, conta ativa e — quando a operação é por workspace — a
 * pré-checagem do resolvedor canônico. Depois executa o handler e registra
 * fim, duração e código de erro; qualquer falha sai pelo mapeador único.
 *
 * O wrapper **não** abre transação nem move idempotência para fora dela. A
 * releitura de autorização, a reserva de idempotência e a auditoria são
 * helpers que o handler chama dentro da própria transação; o wrapper orquestra
 * sem quebrar a atomicidade.
 */
export interface AuthPolicy {
  /** Exige `email_verified` no token (D-06). */
  requireVerifiedEmail: boolean;
  /** Idade máxima de `auth_time`, em segundos (autenticação recente). */
  maxAuthAgeSeconds?: number;
  /** Exige perfil `users/{uid}` ativo (padrão). */
  requireActiveAccount: boolean;
}

/**
 * Provedores de login aceitos (D-06: só Google).
 *
 * O Emulator de Functions define `FUNCTIONS_EMULATOR=true`; só nele o E2E
 * autentica usuários de teste por e-mail e senha. Em qualquer projeto real a
 * variável não existe e a lista é apenas `google.com`.
 */
export const allowedSignInProviders = (
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] =>
  env.FUNCTIONS_EMULATOR === "true" ?
    ["google.com", "password"] :
    ["google.com"];

/** Janela de autenticação recente para operações irreversíveis (D-06). */
export const RECENT_AUTH_MAX_AGE_SECONDS = 10 * 60;

/**
 * Ponto de extensão do App Check (P6, D-33).
 *
 * Vazio de propósito: o enforcement depende do registro do app e da chave
 * reCAPTCHA Enterprise por ambiente (E-02) e do período de monitoramento. O
 * wrapper já registra se a requisição trouxe token (`appCheck` no log de
 * início), que é o sinal usado para decidir o rollout. P6 liga
 * `enforceAppCheck` aqui, num único lugar, para todas as callables do kernel.
 */
export const APP_CHECK_CALLABLE_OPTIONS: Pick<
  CallableOptions,
  "enforceAppCheck"
> = {};

export interface CallerIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  /** `auth_time` do token, em segundos desde a época. */
  authTime: number | null;
  signInProvider: string | null;
  /** Nome e foto do token (claims `name`/`picture`), só para exibição. */
  displayName: string | null;
  photoURL: string | null;
}

export interface KernelContext<TPayload> {
  requestId: string;
  caller: CallerIdentity;
  payload: TPayload;
  actor: WorkspaceActor | null;
  log: OperationLogger;
}

/**
 * Falha entregue ao registrador do domínio.
 *
 * `workspaceId` e `actor` só são preenchidos **depois** que a pré-checagem do
 * resolvedor canônico confirmou o acesso. O `workspaceId` do payload chega
 * antes disso e não é confiável: gravar nele deixaria quem foi recusado — por
 * token, política ou falta de membership — escrever evento e métrica no
 * workspace de outro tenant (INV-P0-001).
 */
export interface CallableFailure {
  request: CallableRequest<unknown>;
  uid: string | null;
  /** Workspace autorizado pela pré-checagem, ou `null`. */
  workspaceId: string | null;
  actor: WorkspaceActor | null;
  requestId: string;
  error: unknown;
}

export interface CallableDefinition<TPayload, TResult> {
  operation: string;
  schema: z.ZodType<TPayload>;
  runtime?: CallableOptions;
  policy?: Partial<AuthPolicy>;
  /**
   * Papéis aceitos pela pré-checagem. Exige `workspaceId` no payload. A
   * decisão que vale é a releitura dentro da transação.
   */
  workspaceRoles?:
    | readonly WorkspaceRole[]
    | ((payload: TPayload) => readonly WorkspaceRole[]);
  /** Mensagem pt-BR do domínio para erro inesperado. */
  internalMessage?: string;
  /** Registro de falha do domínio (não pode lançar). */
  onFailure?: (failure: CallableFailure) => Promise<void> | void;
  handler: (context: KernelContext<TPayload>) => Promise<TResult>;
}

const DEFAULT_POLICY: AuthPolicy = {
  requireVerifiedEmail: false,
  requireActiveAccount: true,
};

export const callerFromRequest = (
  request: CallableRequest<unknown>,
): CallerIdentity => {
  if (!request.auth?.uid) {
    throw new ApplicationError("unauthenticated", "Usuário não autenticado.");
  }
  const token = request.auth.token as unknown as Record<string, unknown>;
  const firebase = token.firebase as Record<string, unknown> | undefined;
  return {
    uid: request.auth.uid,
    email: typeof token.email === "string" ? token.email : null,
    emailVerified: token.email_verified === true,
    authTime: typeof token.auth_time === "number" ? token.auth_time : null,
    signInProvider: typeof firebase?.sign_in_provider === "string" ?
      firebase.sign_in_provider :
      null,
    displayName: typeof token.name === "string" ?
      token.name.slice(0, 120) :
      null,
    photoURL: typeof token.picture === "string" ?
      token.picture.slice(0, 2048) :
      null,
  };
};

export const assertTokenPolicy = (
  caller: CallerIdentity,
  policy: AuthPolicy,
  nowSeconds = Math.floor(Date.now() / 1000),
  providers: readonly string[] = allowedSignInProviders(),
): void => {
  if (!caller.signInProvider || !providers.includes(caller.signInProvider)) {
    throw new ApplicationError(
      "unauthenticated",
      "Entre com sua conta Google para continuar.",
    );
  }
  if (policy.requireVerifiedEmail && (!caller.email || !caller.emailVerified)) {
    throw new ApplicationError(
      "email_not_verified",
      "Confirme seu e-mail para realizar esta operação.",
    );
  }
  if (policy.maxAuthAgeSeconds !== undefined) {
    const age = caller.authTime === null ?
      Number.POSITIVE_INFINITY :
      nowSeconds - caller.authTime;
    if (age > policy.maxAuthAgeSeconds) {
      throw new ApplicationError(
        "recent_login_required",
        "Por segurança, entre novamente com sua conta Google para confirmar " +
          "esta operação.",
      );
    }
  }
};

const workspaceIdOf = (payload: unknown): string | null => {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as {workspaceId?: unknown}).workspaceId;
  return typeof value === "string" ? value : null;
};

const headerOf = (
  request: CallableRequest<unknown>,
  name: string,
): string | undefined => {
  const value = request.rawRequest?.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};

export const defineCallable = <TPayload, TResult>(
  definition: CallableDefinition<TPayload, TResult>,
): CallableFunction<unknown, Promise<TResult>> => {
  const policy: AuthPolicy = {...DEFAULT_POLICY, ...definition.policy};
  const runtime: CallableOptions = {
    ...(definition.runtime ?? DOMAIN_CALLABLE_OPTIONS),
    ...APP_CHECK_CALLABLE_OPTIONS,
  };
  return onCall(runtime, async (request) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let log = createOperationLogger({
      operation: definition.operation,
      requestId,
      actorId: request.auth?.uid ?? null,
      ...traceFieldFromHeader(headerOf(request, "x-cloud-trace-context")),
    });
    log.info("callable.start", {appCheck: request.app ? "present" : "absent"});

    let uid: string | null = request.auth?.uid ?? null;
    let workspaceId: string | null = null;
    let authorized: WorkspaceActor | null = null;
    try {
      const caller = callerFromRequest(request);
      uid = caller.uid;
      assertTokenPolicy(caller, policy);
      const payload = definition.schema.parse(request.data);
      workspaceId = workspaceIdOf(payload);

      let actor: WorkspaceActor | null = null;
      if (definition.workspaceRoles) {
        if (!workspaceId) {
          throw new ApplicationError(
            "invalid_payload",
            INVALID_PAYLOAD_MESSAGE,
          );
        }
        const roles = typeof definition.workspaceRoles === "function" ?
          definition.workspaceRoles(payload) :
          definition.workspaceRoles;
        actor = await resolveWorkspaceActor(caller.uid, workspaceId, roles);
        authorized = actor;
      } else if (policy.requireActiveAccount) {
        await requireActiveAccount(caller.uid);
      }
      log = log.with({workspaceId, actorRole: actor?.role ?? null});

      const result = await definition.handler({
        requestId,
        caller,
        payload,
        actor,
        log,
      });
      log.info("callable.end", {
        outcome: "ok",
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      const errorCode = errorCodeOf(error);
      const fields = {
        outcome: "error",
        errorCode,
        workspaceId,
        durationMs: Date.now() - startedAt,
      };
      if (errorCode === "internal") {
        log.error("callable.end", error, fields);
      } else {
        log.warn("callable.end", fields);
      }
      if (definition.onFailure) {
        try {
          await definition.onFailure({
            request,
            uid,
            workspaceId: authorized?.workspaceId ?? null,
            actor: authorized,
            requestId,
            error,
          });
        } catch (failureError) {
          log.error("callable.failure_record_failed", failureError);
        }
      }
      throw toHttpsError(error, {
        internalMessage: definition.internalMessage,
        requestId,
      });
    }
  });
};
