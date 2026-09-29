import {z} from "zod";

/**
 * Schemas de identificador do kernel (P1, §2.2).
 *
 * Todo ID que vira segmento de caminho do Firestore passa por aqui. Um `/`
 * dentro de `workspaceId` transformava `workspaces/${id}/members/${uid}` num
 * caminho de outra coleção (ENTRY-11); `.` e `..` são IDs reservados pelo
 * Firestore; `__x__` é reservado; espaço nas pontas é quase sempre erro de
 * digitação que viraria outro documento.
 */
const RESERVED_ID = /^__.*__$/;

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const pathSegmentId = (label: string, maxLength: number) => {
  const invalid = `${label}: valor inválido.`;
  return z.string()
    .min(1, `${label}: valor obrigatório.`)
    .max(maxLength, `${label}: excede ${maxLength} caracteres.`)
    .refine((value) => value.trim().length > 0, `${label}: valor vazio.`)
    .refine((value) => value === value.trim(), invalid)
    .refine((value) => !value.includes("/"), invalid)
    .refine((value) => value !== "." && value !== "..", invalid)
    .refine((value) => !RESERVED_ID.test(value), invalid)
    // Controle e caracteres invisíveis não têm uso legítimo em identificador.
    .refine((value) => !hasControlCharacter(value), invalid);
};

/** ID de workspace: gerado pelo Firestore (20) ou pelos seeds de teste. */
export const workspaceIdSchema = pathSegmentId("Workspace", 128);

/** UID do Firebase Auth (até 128 caracteres pela especificação). */
export const memberIdSchema = pathSegmentId("Membro", 128);

/** ID de convite: aleatório gerado pelo servidor. */
export const inviteIdSchema = pathSegmentId("Convite", 64);

/**
 * Chave de idempotência escolhida pelo cliente. Nunca vira caminho sem hash
 * (`idempotencyDocumentId`), mas as mesmas restrições evitam ambiguidades.
 */
export const idempotencyKeySchema = pathSegmentId("Chave de idempotência", 128)
  .refine(
    (value) => value.length >= 8,
    "Chave de idempotência: mínimo de 8 caracteres.",
  );

/** Identificador de correlação opcional enviado pelo cliente. */
export const correlationIdSchema = pathSegmentId("Correlação", 128);
