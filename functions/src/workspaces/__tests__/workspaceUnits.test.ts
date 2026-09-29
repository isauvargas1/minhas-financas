import test from "node:test";
import assert from "node:assert/strict";

import {sha256} from "../../shared/hashing";
import type {WorkspaceRole} from "../../shared/workspaceAuth";
import {normalizeCnpj} from "../cnpj";
import {
  acceptWorkspaceInvitePayloadSchema,
  alertPreferencesSchema,
  archiveWorkspacePayloadSchema,
  bootstrapAccountPayloadSchema,
  changeWorkspaceMemberRolePayloadSchema,
  createWorkspacePayloadSchema,
  inviteRoleSchema,
  inviteWorkspaceMemberPayloadSchema,
  leaveWorkspacePayloadSchema,
  removeWorkspaceMemberPayloadSchema,
  revokeWorkspaceInvitePayloadSchema,
  themeColorSchema,
  transferWorkspaceOwnershipPayloadSchema,
  updateWorkspaceSettingsPayloadSchema,
  workspaceNameSchema,
} from "../contracts";
import {
  INVITE_TOKEN_PATTERN,
  INVITE_TTL_DAYS,
  generateInviteToken,
  hashInviteToken,
  normalizeEmail,
} from "../inviteTokens";
import {
  MANAGEABLE_ROLES,
  canChangeRole,
  canInvite,
  canRemove,
  canRevokeInvite,
  type ManageableRole,
} from "../rbac";

/* ------------------------------------------------------ rbac (D-04) */

const ROLES: readonly WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

/** Matriz esperada escrita à mão, independente da implementação. */
const EXPECTED_INVITE: Record<WorkspaceRole, readonly ManageableRole[]> = {
  owner: ["admin", "member", "viewer"],
  admin: ["member", "viewer"],
  member: [],
  viewer: [],
};

const EXPECTED_REMOVE: Record<WorkspaceRole, readonly WorkspaceRole[]> = {
  owner: ["admin", "member", "viewer"],
  admin: ["member", "viewer"],
  member: [],
  viewer: [],
};

/** Pares [de, para] permitidos por ator. */
const EXPECTED_CHANGE: Record<WorkspaceRole, ReadonlyArray<string>> = {
  owner: [
    "admin>admin", "admin>member", "admin>viewer",
    "member>admin", "member>member", "member>viewer",
    "viewer>admin", "viewer>member", "viewer>viewer",
  ],
  admin: [
    "member>member", "member>viewer",
    "viewer>member", "viewer>viewer",
  ],
  member: [],
  viewer: [],
};

test("papéis gerenciáveis nunca incluem owner", () => {
  assert.deepEqual([...MANAGEABLE_ROLES], ["admin", "member", "viewer"]);
});

test("canInvite e canRevokeInvite seguem a matriz D-04", () => {
  for (const actor of ROLES) {
    for (const role of MANAGEABLE_ROLES) {
      const expected = EXPECTED_INVITE[actor].includes(role);
      assert.equal(canInvite(actor, role), expected, `${actor} → ${role}`);
      assert.equal(
        canRevokeInvite(actor, role),
        expected,
        `${actor} revoga ${role}`,
      );
    }
  }
});

test("canChangeRole segue a matriz D-04 e nunca muda o owner", () => {
  for (const actor of ROLES) {
    for (const from of ROLES) {
      for (const to of MANAGEABLE_ROLES) {
        const expected = EXPECTED_CHANGE[actor].includes(`${from}>${to}`);
        assert.equal(
          canChangeRole(actor, from, to),
          expected,
          `${actor}: ${from} → ${to}`,
        );
        if (from === "owner") {
          assert.equal(canChangeRole(actor, from, to), false);
        }
      }
    }
  }
});

test("admin não toca em admin; member e viewer não gerem ninguém", () => {
  assert.equal(canInvite("admin", "admin"), false);
  assert.equal(canChangeRole("admin", "admin", "member"), false);
  assert.equal(canChangeRole("admin", "member", "admin"), false);
  assert.equal(canRemove("admin", "admin"), false);
  for (const actor of ["member", "viewer"] as const) {
    for (const target of ROLES) {
      assert.equal(canRemove(actor, target), false);
      if (target !== "owner") {
        assert.equal(canInvite(actor, target), false);
        for (const to of MANAGEABLE_ROLES) {
          assert.equal(canChangeRole(actor, target, to), false);
        }
      }
    }
  }
});

test("canRemove segue a matriz D-04 e o owner nunca é removível", () => {
  for (const actor of ROLES) {
    assert.equal(canRemove(actor, "owner"), false, `${actor} remove owner`);
    for (const target of ROLES) {
      assert.equal(
        canRemove(actor, target),
        EXPECTED_REMOVE[actor].includes(target),
        `${actor} remove ${target}`,
      );
    }
  }
});

/* ---------------------------------------------------------------- cnpj */

test("CNPJ válido com ou sem máscara vira a forma mascarada", () => {
  const cases: Array<[string, string]> = [
    ["11.222.333/0001-81", "11.222.333/0001-81"],
    ["11222333000181", "11.222.333/0001-81"],
    ["  11.222.333/0001-81  ", "11.222.333/0001-81"],
    ["11444777000161", "11.444.777/0001-61"],
    // Dígitos verificadores 0 (resto < 2).
    ["10000000000307", "10.000.000/0003-07"],
    ["10.000.000/0006-50", "10.000.000/0006-50"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeCnpj(input), expected, input);
  }
});

test("CNPJ inválido é recusado", () => {
  for (const input of [
    "11.222.333/0001-82",
    "11222333000182",
    "11222333000191",
    "10000000000317",
    "00000000000000",
    "11111111111111",
    "11.111.111/1111-11",
    "99.999.999/9999-99",
    "1122233300018",
    "112223330001811",
    "11.222.333/0001-8",
    "11.222333/0001-81",
    "11222333/0001-81",
    "11.222.333000181",
    "11.222.333-0001/81",
    "11 222 333 0001 81",
    "11.222.333/0001-8A",
    "1122233300018A",
    "",
    "   ",
  ]) {
    assert.equal(normalizeCnpj(input), null, input);
  }
});

/* -------------------------------------------------------- inviteTokens */

test("token de convite: 43 caracteres base64url e 256 bits", () => {
  const token = generateInviteToken();
  assert.equal(token.length, 43);
  assert.match(token, INVITE_TOKEN_PATTERN);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.equal(INVITE_TTL_DAYS, 7);
});

test("1000 tokens gerados são distintos e seguem o padrão", () => {
  const tokens = new Set<string>();
  for (let index = 0; index < 1000; index += 1) {
    const token = generateInviteToken();
    assert.match(token, INVITE_TOKEN_PATTERN);
    tokens.add(token);
  }
  assert.equal(tokens.size, 1000);
});

test("hash do token é SHA-256 hexadecimal e determinístico", () => {
  const token = generateInviteToken();
  const hash = hashInviteToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashInviteToken(token), hash);
  assert.equal(hash, sha256(token));
  assert.notEqual(hash, token);
  assert.notEqual(hashInviteToken(generateInviteToken()), hash);
});

test("INVITE_TOKEN_PATTERN recusa tamanho e alfabeto errados", () => {
  const valid = "A".repeat(42) + "_";
  assert.match(valid, INVITE_TOKEN_PATTERN);
  for (const invalid of [
    "A".repeat(42),
    "A".repeat(44),
    "A".repeat(42) + "+",
    "A".repeat(42) + "/",
    "A".repeat(42) + "=",
    "A".repeat(42) + " ",
    " " + "A".repeat(43),
    "",
  ]) {
    assert.doesNotMatch(invalid, INVITE_TOKEN_PATTERN, invalid);
  }
});

test("normalizeEmail apara e usa minúsculas sem reescrever o endereço", () => {
  assert.equal(
    normalizeEmail("  Fulano.Silva+Tag@Example.COM \n"),
    "fulano.silva+tag@example.com",
  );
  assert.equal(normalizeEmail("a@b.co"), "a@b.co");
  assert.notEqual(normalizeEmail("a.b@x.com"), normalizeEmail("ab@x.com"));
});

/* ----------------------------------------------------------- contracts */

const TOKEN = "A".repeat(43);
const KEY = "chave-idem-123";

interface ParsingSchema {
  safeParse(value: unknown): {success: boolean; data?: unknown};
}

const PAYLOAD_SCHEMAS: Array<[string, ParsingSchema, Record<string, unknown>]> =
  [
    ["bootstrapAccount", bootstrapAccountPayloadSchema, {}],
    [
      "createWorkspace",
      createWorkspacePayloadSchema,
      {type: "PF", name: "Casa", idempotencyKey: KEY},
    ],
    [
      "updateWorkspaceSettings",
      updateWorkspaceSettingsPayloadSchema,
      {workspaceId: "ws-1"},
    ],
    ["archiveWorkspace", archiveWorkspacePayloadSchema, {workspaceId: "ws-1"}],
    [
      "inviteWorkspaceMember",
      inviteWorkspaceMemberPayloadSchema,
      {
        workspaceId: "ws-1",
        email: "convidado@example.com",
        role: "member",
        idempotencyKey: KEY,
      },
    ],
    [
      "acceptWorkspaceInvite",
      acceptWorkspaceInvitePayloadSchema,
      {token: TOKEN},
    ],
    [
      "revokeWorkspaceInvite",
      revokeWorkspaceInvitePayloadSchema,
      {workspaceId: "ws-1", inviteId: "inv-1"},
    ],
    [
      "changeWorkspaceMemberRole",
      changeWorkspaceMemberRolePayloadSchema,
      {workspaceId: "ws-1", memberId: "uid-2", role: "viewer"},
    ],
    [
      "removeWorkspaceMember",
      removeWorkspaceMemberPayloadSchema,
      {workspaceId: "ws-1", memberId: "uid-2"},
    ],
    ["leaveWorkspace", leaveWorkspacePayloadSchema, {workspaceId: "ws-1"}],
    [
      "transferWorkspaceOwnership",
      transferWorkspaceOwnershipPayloadSchema,
      {workspaceId: "ws-1", newOwnerId: "uid-2", idempotencyKey: KEY},
    ],
    [
      "alertPreferences",
      alertPreferencesSchema,
      {
        billing: true,
        accountsPayable: false,
        delinquency: true,
        lowMargin: false,
      },
    ],
  ];

const FORBIDDEN_KEYS = [
  "ownerId",
  "role",
  "status",
  "currency",
  "uid",
  "plan",
  "createdBy",
  "memberCount",
];

for (const [name, schema, base] of PAYLOAD_SCHEMAS) {
  test(`${name}: payload mínimo válido`, () => {
    assert.equal(schema.safeParse(base).success, true);
  });

  test(`${name}: .strict() recusa campos desconhecidos`, () => {
    const extras = FORBIDDEN_KEYS.filter((key) => !(key in base));
    assert.ok(extras.length > 0);
    for (const key of extras) {
      assert.equal(
        schema.safeParse({...base, [key]: "x"}).success,
        false,
        `${name} aceitou ${key}`,
      );
    }
  });
}

test("papel owner nunca é concedido por convite nem por troca de papel", () => {
  assert.equal(inviteRoleSchema.safeParse("owner").success, false);
  for (const role of ["admin", "member", "viewer"]) {
    assert.equal(inviteRoleSchema.safeParse(role).success, true);
  }
  for (const role of ["owner", "OWNER", "Admin", "", "superadmin"]) {
    assert.equal(
      inviteWorkspaceMemberPayloadSchema.safeParse({
        workspaceId: "ws-1",
        email: "convidado@example.com",
        role,
        idempotencyKey: KEY,
      }).success,
      false,
      role,
    );
    assert.equal(
      changeWorkspaceMemberRolePayloadSchema.safeParse({
        workspaceId: "ws-1",
        memberId: "uid-2",
        role,
      }).success,
      false,
      role,
    );
  }
});

test("nome do espaço é aparado e não pode ficar vazio", () => {
  assert.equal(workspaceNameSchema.parse("  Casa  "), "Casa");
  assert.equal(workspaceNameSchema.parse("x".repeat(120)), "x".repeat(120));
  assert.equal(
    workspaceNameSchema.parse(`  ${"x".repeat(120)}  `),
    "x".repeat(120),
  );
  for (const invalid of ["", "   ", "\n\t", "x".repeat(121), "a\u0000b", 1]) {
    assert.equal(
      workspaceNameSchema.safeParse(invalid).success,
      false,
      JSON.stringify(invalid),
    );
  }
  const created = createWorkspacePayloadSchema.parse({
    type: "PJ",
    name: "  Empresa  ",
    idempotencyKey: KEY,
  });
  assert.equal(created.name, "Empresa");
  assert.equal(
    createWorkspacePayloadSchema.safeParse({
      type: "PJ",
      name: "   ",
      idempotencyKey: KEY,
    }).success,
    false,
  );
});

test("tipo do espaço aceita só PF e PJ", () => {
  for (const type of ["pf", "pj", "PX", "", null]) {
    assert.equal(
      createWorkspacePayloadSchema.safeParse({
        type,
        name: "Casa",
        idempotencyKey: KEY,
      }).success,
      false,
      String(type),
    );
  }
});

test("cor do tema é #rrggbb em minúsculas", () => {
  assert.equal(themeColorSchema.parse("#AABBCC"), "#aabbcc");
  assert.equal(themeColorSchema.parse("#0a1B2c"), "#0a1b2c");
  for (const invalid of ["#abc", "AABBCC", "#GGGGGG", "#aabbccdd", "", "red"]) {
    assert.equal(themeColorSchema.safeParse(invalid).success, false, invalid);
  }
  const updated = updateWorkspaceSettingsPayloadSchema.parse({
    workspaceId: "ws-1",
    themeColor: "#FF00AA",
  });
  assert.equal(updated.themeColor, "#ff00aa");
});

test("CNPJ passa sem validação de dígitos no contrato", () => {
  // O dígito verificador é conferido no domínio (`normalizeCnpj`).
  for (const cnpj of ["11.222.333/0001-82", "11222333000181", null]) {
    const parsed = updateWorkspaceSettingsPayloadSchema.parse({
      workspaceId: "ws-1",
      cnpj,
    });
    assert.equal(parsed.cnpj, cnpj);
  }
  assert.equal(
    updateWorkspaceSettingsPayloadSchema.safeParse({
      workspaceId: "ws-1",
      cnpj: "1".repeat(33),
    }).success,
    false,
  );
});

test("token de aceite segue INVITE_TOKEN_PATTERN", () => {
  assert.equal(
    acceptWorkspaceInvitePayloadSchema.safeParse({
      token: generateInviteToken(),
    }).success,
    true,
  );
  for (const token of [
    "A".repeat(42),
    "A".repeat(44),
    "A".repeat(42) + "=",
    "A".repeat(42) + "/",
    "",
    43,
  ]) {
    assert.equal(
      acceptWorkspaceInvitePayloadSchema.safeParse({token}).success,
      false,
      String(token),
    );
  }
});

test("contratos recusam identificadores que viram outro caminho", () => {
  for (const workspaceId of ["a/b", "..", "__x__", " ws", ""]) {
    assert.equal(
      archiveWorkspacePayloadSchema.safeParse({workspaceId}).success,
      false,
      workspaceId,
    );
  }
  assert.equal(
    removeWorkspaceMemberPayloadSchema.safeParse({
      workspaceId: "ws-1",
      memberId: "uid/../outro",
    }).success,
    false,
  );
  assert.equal(
    createWorkspacePayloadSchema.safeParse({
      type: "PF",
      name: "Casa",
      idempotencyKey: "curta",
    }).success,
    false,
  );
});

test("e-mail do convite é aparado e validado", () => {
  const parsed = inviteWorkspaceMemberPayloadSchema.parse({
    workspaceId: "ws-1",
    email: "  convidado@example.com  ",
    role: "admin",
    idempotencyKey: KEY,
  });
  assert.equal(parsed.email, "convidado@example.com");
  for (const email of ["sem-arroba", "a@b", "a @b.com", "", "@b.com"]) {
    assert.equal(
      inviteWorkspaceMemberPayloadSchema.safeParse({
        workspaceId: "ws-1",
        email,
        role: "member",
        idempotencyKey: KEY,
      }).success,
      false,
      email,
    );
  }
});
