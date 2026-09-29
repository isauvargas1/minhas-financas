import {randomBytes} from "node:crypto";

import {sha256} from "../shared/hashing";

/**
 * Token de convite (D-05).
 *
 * 256 bits de CSPRNG em base64url (43 caracteres, sem padding): seguro para
 * URL e sem espaço para adivinhação. Só o SHA-256 é persistido, sem pepper;
 * o token em claro existe apenas na memória da requisição que o emite e nunca
 * vai para log, auditoria, resposta ou outro membro.
 */
export const INVITE_TOKEN_BYTES = 32;
export const INVITE_TTL_DAYS = 7;
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const generateInviteToken = (): string =>
  randomBytes(INVITE_TOKEN_BYTES).toString("base64url");

export const hashInviteToken = (token: string): string => sha256(token);

/**
 * E-mail normalizado para o vínculo do convite: sem espaços nas pontas e em
 * minúsculas. Não remove pontos nem sufixos `+`: dois endereços diferentes
 * para o provedor continuam diferentes aqui.
 */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();
