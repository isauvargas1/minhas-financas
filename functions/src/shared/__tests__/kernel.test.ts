import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {HttpsError} from "firebase-functions/v2/https";
import type {CallableRequest} from "firebase-functions/v2/https";
import {z} from "zod";

import {
  RECENT_AUTH_MAX_AGE_SECONDS,
  allowedSignInProviders,
  assertTokenPolicy,
  callerFromRequest,
  type AuthPolicy,
  type CallerIdentity,
} from "../callable";
import {
  ApplicationError,
  INVALID_PAYLOAD_MESSAGE,
  errorCodeOf,
  isAlreadyExistsError,
  sanitizeZodIssues,
  toHttpsError,
  type ApplicationErrorCode,
} from "../errors";
import {sha256, stableStringify} from "../hashing";
import {
  correlationIdSchema,
  idempotencyKeySchema,
  inviteIdSchema,
  memberIdSchema,
  workspaceIdSchema,
} from "../ids";
import {
  maskEmail,
  sanitizeLogFields,
  sanitizedStack,
  traceFieldFromHeader,
  type LogFields,
} from "../logger";

/* ------------------------------------------------------------------ ids */

const PATH_ID_SCHEMAS = {
  workspaceIdSchema,
  memberIdSchema,
  inviteIdSchema,
  correlationIdSchema,
};

const INVALID_PATH_IDS: unknown[] = [
  "",
  " ",
  "   ",
  " a",
  "a ",
  "\ta",
  "/",
  "a/b",
  "workspaces/outro",
  ".",
  "..",
  "__x__",
  "__name__",
  "____",
  "a\u0000b",
  "a\nb",
  "a\u001fb",
  "a\u007fb",
  "x".repeat(129),
  123,
  null,
  undefined,
  {},
];

const VALID_PATH_IDS = [
  "a",
  "ws_123",
  "A1b2C3d4E5f6G7h8I9j0",
  "user-1",
  "a.b",
  "__x",
  "x__",
  "espaço-ção",
];

for (const [name, schema] of Object.entries(PATH_ID_SCHEMAS)) {
  test(`${name} recusa segmentos de caminho inválidos`, () => {
    for (const value of INVALID_PATH_IDS) {
      assert.equal(
        schema.safeParse(value).success,
        false,
        `${name} aceitou ${JSON.stringify(value)}`,
      );
    }
  });

  test(`${name} aceita identificadores normais`, () => {
    for (const value of VALID_PATH_IDS) {
      const parsed = schema.safeParse(value);
      assert.equal(parsed.success, true, `${name} recusou ${value}`);
      assert.equal(parsed.data, value);
    }
  });
}

test("limites de tamanho dos identificadores", () => {
  assert.equal(workspaceIdSchema.safeParse("x".repeat(128)).success, true);
  assert.equal(workspaceIdSchema.safeParse("x".repeat(129)).success, false);
  assert.equal(memberIdSchema.safeParse("x".repeat(128)).success, true);
  assert.equal(memberIdSchema.safeParse("x".repeat(129)).success, false);
  assert.equal(inviteIdSchema.safeParse("x".repeat(64)).success, true);
  assert.equal(inviteIdSchema.safeParse("x".repeat(65)).success, false);
});

test("chave de idempotência exige 8 caracteres e as regras de caminho", () => {
  assert.equal(idempotencyKeySchema.safeParse("1234567").success, false);
  assert.equal(idempotencyKeySchema.safeParse("12345678").success, true);
  assert.equal(
    idempotencyKeySchema.safeParse("c0a8e1f2-9b7d-4e3a-8c6b-1d2e3f4a5b6c")
      .success,
    true,
  );
  assert.equal(idempotencyKeySchema.safeParse("x".repeat(128)).success, true);
  for (const value of INVALID_PATH_IDS) {
    assert.equal(
      idempotencyKeySchema.safeParse(value).success,
      false,
      JSON.stringify(value),
    );
  }
  for (const value of [
    "abcdefg/h",
    " abcdefgh",
    "abcdefgh ",
    "__abcdefgh__",
    "abcd\u0000efgh",
  ]) {
    assert.equal(
      idempotencyKeySchema.safeParse(value).success,
      false,
      JSON.stringify(value),
    );
  }
});

/* --------------------------------------------------------------- errors */

const HTTPS_CODE: Record<ApplicationErrorCode, string> = {
  invalid_payload: "invalid-argument",
  unauthenticated: "unauthenticated",
  permission_denied: "permission-denied",
  email_not_verified: "permission-denied",
  recent_login_required: "failed-precondition",
  account_suspended: "permission-denied",
  account_not_initialized: "failed-precondition",
  workspace_not_found: "not-found",
  workspace_archived: "failed-precondition",
  workspace_membership_required: "permission-denied",
  workspace_role_denied: "permission-denied",
  idempotency_conflict: "failed-precondition",
  idempotency_replay: "internal",
  domain_precondition_failed: "failed-precondition",
  quota_exceeded: "resource-exhausted",
  not_found: "not-found",
  already_exists: "already-exists",
  internal: "internal",
};

const PUBLIC_REASON_CODES = new Set<ApplicationErrorCode>([
  "email_not_verified",
  "recent_login_required",
  "account_suspended",
  "account_not_initialized",
  "workspace_archived",
]);

const GENERIC_INTERNAL_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente em instantes.";

const serialized = (error: HttpsError): string =>
  JSON.stringify({
    json: error.toJSON(),
    message: error.message,
    details: error.details,
  });

test("Zod vira invalid-argument com issues sem o valor recebido", () => {
  const email = "fulano.secreto@example.com";
  const token = "tok_segredo_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const schema = z.object({
    email: z.string().max(5),
    token: z.string().regex(/^x$/),
    amount: z.number().int(),
    role: z.enum(["member", "viewer"]),
  }).strict();
  const parsed = schema.safeParse(
    {email, token, amount: 1.5, role: "owner", intruso: email},
    {reportInput: true},
  );
  assert.equal(parsed.success, false);
  const zodError = parsed.error as z.ZodError;
  // Pré-condição: o erro bruto carrega o valor recebido.
  assert.ok(JSON.stringify(zodError.issues).includes(email));
  assert.ok(JSON.stringify(zodError.issues).includes(token));

  const error = toHttpsError(zodError, {requestId: "req-1"});
  assert.ok(error instanceof HttpsError);
  assert.equal(error.code, "invalid-argument");
  assert.equal(error.message, INVALID_PAYLOAD_MESSAGE);
  const details = error.details as {issues: Array<Record<string, unknown>>};
  assert.deepEqual(Object.keys(details), ["issues"]);
  assert.equal(details.issues.length, zodError.issues.length);
  for (const issue of details.issues) {
    assert.deepEqual(Object.keys(issue).sort(), ["code", "message", "path"]);
    assert.ok(Array.isArray(issue.path));
    assert.equal(typeof issue.code, "string");
    assert.equal(typeof issue.message, "string");
  }
  const paths = details.issues.map((issue) => JSON.stringify(issue.path));
  for (const expected of ["[\"email\"]", "[\"token\"]", "[\"amount\"]"]) {
    assert.ok(paths.includes(expected), expected);
  }
  const text = serialized(error);
  assert.equal(text.includes(email), false);
  assert.equal(text.includes("secreto"), false);
  assert.equal(text.includes(token), false);
  assert.equal(text.includes("1.5"), false);
  assert.equal(text.includes("req-1"), false);
});

test("sanitizeZodIssues limita quantidade, caminho e mensagem", () => {
  const many = z.array(z.number()).safeParse(
    Array.from({length: 30}, (_, index) => `valor-${index}`),
  );
  assert.equal(many.success, false);
  assert.equal(sanitizeZodIssues(many.error as z.ZodError).length, 20);

  // {a: {b: ... {j: número}}}: caminho de 10 níveis até o erro.
  const letters = "abcdefghij".split("");
  const deep = letters.reduceRight<z.ZodType>(
    (inner, key) => z.object({[key]: inner}),
    z.number(),
  );
  const deepResult = deep.safeParse(letters.reduceRight<unknown>(
    (inner, key) => ({[key]: inner}),
    "x",
  ));
  assert.equal(deepResult.success, false);
  const [deepIssue] = sanitizeZodIssues(deepResult.error as z.ZodError);
  assert.deepEqual(deepIssue.path, ["a", "b", "c", "d", "e", "f", "g", "h"]);

  const long = z.string().min(5, "m".repeat(500)).safeParse("x");
  assert.equal(long.success, false);
  const [longIssue] = sanitizeZodIssues(long.error as z.ZodError);
  assert.equal(longIssue.message.length, 200);
});

for (const [code, httpsCode] of Object.entries(HTTPS_CODE)) {
  test(`ApplicationError ${code} → ${httpsCode}`, () => {
    const applicationCode = code as ApplicationErrorCode;
    const error = toHttpsError(
      new ApplicationError(applicationCode, "Mensagem de domínio."),
      {requestId: "req-42"},
    );
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, httpsCode);
    assert.equal(error.message, "Mensagem de domínio.");
    const details = error.details as Record<string, unknown> | undefined;
    const expected: Record<string, unknown> = {};
    if (PUBLIC_REASON_CODES.has(applicationCode)) {
      expected.reason = applicationCode;
    }
    if (httpsCode === "internal") expected.requestId = "req-42";
    assert.deepEqual(details ?? {}, expected);
    if (Object.keys(expected).length === 0) assert.equal(details, undefined);
    assert.equal(errorCodeOf(new ApplicationError(applicationCode, "x")), code);
  });
}

test("reason público acompanha os detalhes do domínio", () => {
  const error = toHttpsError(
    new ApplicationError("workspace_archived", "Espaço arquivado.", {
      workspaceStatus: "archived",
    }),
  );
  assert.equal(error.code, "failed-precondition");
  assert.deepEqual(error.details, {
    workspaceStatus: "archived",
    reason: "workspace_archived",
  });
});

test("erro inesperado vira internal genérico com requestId", () => {
  const leaked = "fulano@example.com";
  const unexpected = new Error(`falha ao ler users/${leaked} token=abc123`);
  const error = toHttpsError(unexpected, {requestId: "req-7"});
  assert.equal(error.code, "internal");
  assert.equal(error.message, GENERIC_INTERNAL_MESSAGE);
  assert.deepEqual(error.details, {requestId: "req-7"});
  const text = serialized(error);
  assert.equal(text.includes(leaked), false);
  assert.equal(text.includes("abc123"), false);
  assert.equal(text.includes(" at "), false);
  assert.equal(text.includes(".js:"), false);

  const custom = toHttpsError(new TypeError("x is undefined"), {
    internalMessage: "Não foi possível salvar o espaço.",
  });
  assert.equal(custom.code, "internal");
  assert.equal(custom.message, "Não foi possível salvar o espaço.");
  assert.equal(custom.details, undefined);

  for (const thrown of ["texto", undefined, null, 42, {code: 13}]) {
    const mapped = toHttpsError(thrown, {requestId: "req-8"});
    assert.equal(mapped.code, "internal");
    assert.equal(mapped.message, GENERIC_INTERNAL_MESSAGE);
    assert.deepEqual(mapped.details, {requestId: "req-8"});
    assert.equal(errorCodeOf(thrown), "internal");
  }
});

test("ALREADY_EXISTS vira failed-precondition, não internal", () => {
  for (const thrown of [{code: 6}, {code: "already-exists"}]) {
    assert.equal(isAlreadyExistsError(thrown), true);
    const error = toHttpsError(thrown, {requestId: "req-9"});
    assert.equal(error.code, "failed-precondition");
    assert.equal(error.message, "Esta solicitação já está em processamento.");
    assert.equal(error.details, undefined);
    assert.equal(errorCodeOf(thrown), "idempotency_conflict");
  }
  for (const thrown of [{code: 5}, {code: "6"}, null, "already-exists", 6]) {
    assert.equal(isAlreadyExistsError(thrown), false);
  }
});

test("HttpsError existente passa sem alteração", () => {
  const original = new HttpsError("not-found", "Não encontrado.");
  assert.equal(toHttpsError(original), original);
  assert.equal(errorCodeOf(original), "not-found");
  assert.equal(errorCodeOf(new z.ZodError([])), "invalid_payload");
});

/* --------------------------------------------------------------- logger */

const SENSITIVE_LOG_KEYS = [
  "token",
  "inviteToken",
  "idToken",
  "email",
  "userEmail",
  "e-mail",
  "cpf",
  "cnpj",
  "payload",
  "rawPayload",
  "password",
  "senha",
  "authorization",
  "Authorization",
  "idempotencyKey",
  "apiKey",
  "clientSecret",
  "cookie",
  "receiptUrl",
  "comprovante",
  "transcription",
];

test("sanitizeLogFields descarta chaves sensíveis", () => {
  const safe: LogFields = {
    operation: "workspace.create",
    requestId: "req-1",
    workspaceId: "ws-1",
    actorRole: "owner",
    durationMs: 12,
    ok: true,
    nothing: null,
  };
  const sensitive: LogFields = Object.fromEntries(
    SENSITIVE_LOG_KEYS.map((key) => [key, "fulano@example.com"]),
  );
  assert.deepEqual(sanitizeLogFields({...safe, ...sensitive}), safe);
  for (const key of SENSITIVE_LOG_KEYS) {
    assert.deepEqual(sanitizeLogFields({[key]: "valor"}), {}, key);
  }
  assert.deepEqual(sanitizeLogFields(), {});
});

test("sanitizeLogFields trunca strings e descarta objetos", () => {
  const fields = {
    long: "a".repeat(1000),
    exact: "b".repeat(256),
    missing: undefined,
    nested: {email: "fulano@example.com"},
    list: ["x"],
    fn: () => "x",
    big: BigInt(1),
    zero: 0,
    no: false,
  } as unknown as LogFields;
  const sanitized = sanitizeLogFields(fields);
  assert.deepEqual(sanitized, {
    long: "a".repeat(256),
    exact: "b".repeat(256),
    zero: 0,
    no: false,
  });
  assert.equal("missing" in sanitized, false);
});

test("maskEmail mantém só a inicial e o domínio", () => {
  assert.equal(maskEmail("fulano@example.com"), "f***@example.com");
  assert.equal(maskEmail("A.B+tag@Empresa.com.br"), "A***@Empresa.com.br");
  assert.equal(maskEmail("a@b@c.com"), "a***@c.com");
  assert.equal(maskEmail("semarroba"), "***");
  assert.equal(maskEmail("@example.com"), "***");
  assert.equal(maskEmail(""), undefined);
  assert.equal(maskEmail(undefined), undefined);
});

test("sanitizedStack mantém nome e frames e descarta a mensagem", () => {
  const error = new Error("vazou fulano@example.com\nsegunda linha secreta");
  const stack = sanitizedStack(error);
  assert.ok(stack);
  const lines = stack.split("\n");
  assert.equal(lines[0], "Error");
  assert.ok(lines.length > 1);
  for (const line of lines.slice(1)) assert.ok(line.startsWith("at "), line);
  assert.equal(stack.includes("fulano@example.com"), false);
  assert.equal(stack.includes("secreta"), false);
  assert.ok(stack.includes("kernel.test"));

  const typed = sanitizedStack(new TypeError("mensagem"));
  assert.ok(typed?.startsWith("TypeError\n"));
});

test("sanitizedStack limita a 12 frames e ignora o que não é Error", () => {
  const error = new Error("m");
  error.stack = [
    "Error: m",
    ...Array.from({length: 20}, (_, index) => `    at f${index} (a.js:1:1)`),
  ].join("\n");
  const lines = (sanitizedStack(error) as string).split("\n");
  assert.equal(lines.length, 13);
  assert.equal(lines[1], "at f0 (a.js:1:1)");
  assert.equal(lines[12], "at f11 (a.js:1:1)");

  const noStack = new Error("m");
  noStack.stack = undefined;
  assert.equal(sanitizedStack(noStack), undefined);
  assert.equal(sanitizedStack("texto"), undefined);
  assert.equal(sanitizedStack({stack: "at x"}), undefined);
});

test("traceFieldFromHeader monta o campo de trace do Cloud Logging", () => {
  const saved = {
    GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
    GCP_PROJECT: process.env.GCP_PROJECT,
  };
  try {
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GCP_PROJECT;
    const header = "105445aa7843bc8bf206b12000100000/1;o=1";
    assert.deepEqual(traceFieldFromHeader(header), {});

    process.env.GCLOUD_PROJECT = "minhas-financas-local";
    assert.deepEqual(traceFieldFromHeader(header), {
      "logging.googleapis.com/trace":
        "projects/minhas-financas-local/traces/" +
        "105445aa7843bc8bf206b12000100000",
    });
    assert.deepEqual(traceFieldFromHeader(undefined), {});
    assert.deepEqual(traceFieldFromHeader(""), {});
    assert.deepEqual(traceFieldFromHeader("nao-hex/1"), {});
    assert.deepEqual(traceFieldFromHeader("abc/1"), {});
    assert.deepEqual(traceFieldFromHeader("../../x"), {});
    assert.deepEqual(traceFieldFromHeader("a".repeat(33)), {});
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

/* ------------------------------------------------------ callable policy */

const requestWith = (auth: unknown): CallableRequest<unknown> =>
  ({data: {}, auth, rawRequest: {headers: {}}}) as
    unknown as CallableRequest<unknown>;

const isApplicationErrorWith = (code: ApplicationErrorCode) =>
  (error: unknown): boolean =>
    error instanceof ApplicationError && error.code === code;

test("callerFromRequest recusa requisição sem autenticação", () => {
  for (const auth of [undefined, null, {}, {uid: ""}, {uid: undefined}]) {
    assert.throws(
      () => callerFromRequest(requestWith(auth)),
      isApplicationErrorWith("unauthenticated"),
    );
  }
});

test("callerFromRequest lê só claims tipadas do token", () => {
  const caller = callerFromRequest(requestWith({
    uid: "uid-1",
    token: {
      email: "fulano@example.com",
      email_verified: true,
      auth_time: 1_700_000_000,
      firebase: {sign_in_provider: "google.com"},
      name: "n".repeat(300),
      picture: "https://example.com/foto.png",
    },
  }));
  assert.deepEqual(caller, {
    uid: "uid-1",
    email: "fulano@example.com",
    emailVerified: true,
    authTime: 1_700_000_000,
    signInProvider: "google.com",
    displayName: "n".repeat(120),
    photoURL: "https://example.com/foto.png",
  });

  const loose = callerFromRequest(requestWith({
    uid: "uid-2",
    token: {
      email: 1,
      email_verified: "true",
      auth_time: "1700000000",
      firebase: {sign_in_provider: 1},
    },
  }));
  assert.deepEqual(loose, {
    uid: "uid-2",
    email: null,
    emailVerified: false,
    authTime: null,
    signInProvider: null,
    displayName: null,
    photoURL: null,
  });
});

test("allowedSignInProviders: só Google fora do Emulator", () => {
  assert.deepEqual(allowedSignInProviders({}), ["google.com"]);
  assert.deepEqual(
    allowedSignInProviders({FUNCTIONS_EMULATOR: "true"}),
    ["google.com", "password"],
  );
  for (const value of ["false", "1", "TRUE", "yes", ""]) {
    assert.deepEqual(
      allowedSignInProviders({FUNCTIONS_EMULATOR: value}),
      ["google.com"],
      value,
    );
  }
  assert.equal(RECENT_AUTH_MAX_AGE_SECONDS, 600);
});

const NOW = 1_800_000_000;
const PRODUCTION_PROVIDERS = allowedSignInProviders({});

const caller = (overrides: Partial<CallerIdentity> = {}): CallerIdentity => ({
  uid: "uid-1",
  email: "fulano@example.com",
  emailVerified: true,
  authTime: NOW - 60,
  signInProvider: "google.com",
  displayName: null,
  photoURL: null,
  ...overrides,
});

const policy = (overrides: Partial<AuthPolicy> = {}): AuthPolicy => ({
  requireVerifiedEmail: false,
  requireActiveAccount: true,
  ...overrides,
});

test("assertTokenPolicy recusa provedor fora da lista", () => {
  for (const provider of ["password", "anonymous", "custom", "phone", null]) {
    assert.throws(
      () => assertTokenPolicy(
        caller({signInProvider: provider}),
        policy(),
        NOW,
        PRODUCTION_PROVIDERS,
      ),
      isApplicationErrorWith("unauthenticated"),
      String(provider),
    );
  }
  assert.doesNotThrow(() =>
    assertTokenPolicy(
      caller({signInProvider: "password"}),
      policy(),
      NOW,
      allowedSignInProviders({FUNCTIONS_EMULATOR: "true"}),
    ));
});

test("assertTokenPolicy exige e-mail verificado quando a política pede", () => {
  const strict = policy({requireVerifiedEmail: true});
  for (const overrides of [
    {emailVerified: false},
    {email: null},
    {email: null, emailVerified: false},
  ]) {
    assert.throws(
      () => assertTokenPolicy(
        caller(overrides),
        strict,
        NOW,
        PRODUCTION_PROVIDERS,
      ),
      isApplicationErrorWith("email_not_verified"),
      JSON.stringify(overrides),
    );
    assert.doesNotThrow(() => assertTokenPolicy(
      caller(overrides),
      policy(),
      NOW,
      PRODUCTION_PROVIDERS,
    ));
  }
  assert.doesNotThrow(() =>
    assertTokenPolicy(caller(), strict, NOW, PRODUCTION_PROVIDERS));
});

test("assertTokenPolicy exige autenticação recente de até 600 s", () => {
  const recent = policy({maxAuthAgeSeconds: RECENT_AUTH_MAX_AGE_SECONDS});
  const check = (authTime: number | null) => () =>
    assertTokenPolicy(caller({authTime}), recent, NOW, PRODUCTION_PROVIDERS);

  assert.doesNotThrow(check(NOW));
  assert.doesNotThrow(check(NOW - 1));
  assert.doesNotThrow(check(NOW - 600));
  for (const authTime of [NOW - 601, NOW - 3600, 0, null]) {
    assert.throws(
      check(authTime),
      isApplicationErrorWith("recent_login_required"),
      String(authTime),
    );
  }
  // Sem exigência de login recente, a idade não importa.
  assert.doesNotThrow(() =>
    assertTokenPolicy(
      caller({authTime: null}),
      policy(),
      NOW,
      PRODUCTION_PROVIDERS,
    ));
});

test("recent_login_required chega ao cliente com reason", () => {
  let thrown: unknown;
  try {
    assertTokenPolicy(
      caller({authTime: NOW - 601}),
      policy({maxAuthAgeSeconds: RECENT_AUTH_MAX_AGE_SECONDS}),
      NOW,
      PRODUCTION_PROVIDERS,
    );
  } catch (error) {
    thrown = error;
  }
  const mapped = toHttpsError(thrown);
  assert.equal(mapped.code, "failed-precondition");
  assert.deepEqual(mapped.details, {reason: "recent_login_required"});
});

/* -------------------------------------------------------------- hashing */

test("stableStringify independe da ordem das chaves", () => {
  const left = {b: 1, a: {d: [3, {f: 1, e: 2}], c: "x"}, z: null};
  const right = {z: null, a: {c: "x", d: [3, {e: 2, f: 1}]}, b: 1};
  assert.equal(stableStringify(left), stableStringify(right));
  assert.equal(
    stableStringify(left),
    "{\"a\":{\"c\":\"x\",\"d\":[3,{\"e\":2,\"f\":1}]},\"b\":1,\"z\":null}",
  );
  assert.equal(sha256(stableStringify(left)), sha256(stableStringify(right)));
});

test("stableStringify preserva a ordem de arrays e os tipos", () => {
  assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
  assert.notEqual(stableStringify({a: 1}), stableStringify({a: "1"}));
  assert.notEqual(stableStringify({a: 1}), stableStringify({a: 1, b: 2}));
  for (const value of ["texto", 10, true, null, [], {}]) {
    assert.equal(stableStringify(value), JSON.stringify(value));
  }
});

test("sha256 é hexadecimal de 64 caracteres e determinístico", () => {
  assert.equal(
    sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.match(sha256(""), /^[0-9a-f]{64}$/);
  assert.equal(sha256("x"), sha256("x"));
  assert.notEqual(sha256("x"), sha256("y"));
});

/* ----------------------------------------------------- contrato de erro */

/**
 * Handlers do kernel lançam `ApplicationError`; só o mapeador único
 * (`toHttpsError`) constrói `HttpsError`. Um `new HttpsError` solto em código
 * de produção criaria um segundo contrato de erro, com código e mensagem fora
 * da tabela fechada.
 */
test("produção não constrói HttpsError fora do mapeador único", () => {
  // `lib/shared/__tests__` → `src/`.
  const srcRoot = path.resolve(__dirname, "../../../src");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "testSupport") {
          walk(full);
        }
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
        continue;
      }
      if (full === path.join(srcRoot, "shared", "errors.ts")) continue;
      if (/new\s+HttpsError\s*\(/.test(fs.readFileSync(full, "utf8"))) {
        offenders.push(path.relative(srcRoot, full));
      }
    }
  };
  walk(srcRoot);
  assert.deepEqual(offenders, []);
});
