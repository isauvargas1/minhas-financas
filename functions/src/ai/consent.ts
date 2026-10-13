import {z} from "zod";

import {ApplicationError} from "../shared/errors";

/**
 * Confirmação de envio ao provedor de IA (P5-E1, D-11.3).
 *
 * Antes de qualquer conteúdo sair para o provedor externo, a pessoa vê o que
 * será enviado e confirma aquela operação. O cliente manda esta marca,
 * versionada e vinculada ao tipo de operação; o backend recusa a chamada sem
 * ela antes de ler dados financeiros, antes da admissão (sem crédito, sem
 * rate limit) e antes de qualquer chamada ao provedor.
 *
 * É um controle técnico de transparência e de ação afirmativa por operação.
 * Não é registro de consentimento LGPD nem prova jurídica de base legal: a
 * base legal, o registro formal e a retenção ficam para a P8 (PR-AI-01).
 */
export const AI_PROVIDER_CONSENT_VERSION = "ai-provider-share-v1";

export const AI_CONSENT_OPERATIONS = [
  "analysis",
  "extraction_text",
  "extraction_document",
] as const;

export type AiConsentOperation = typeof AI_CONSENT_OPERATIONS[number];

export const providerConsentSchema = z.object({
  version: z.literal(AI_PROVIDER_CONSENT_VERSION),
  operation: z.enum(AI_CONSENT_OPERATIONS),
  confirmed: z.literal(true),
}).strict();

export type ProviderConsent = z.infer<typeof providerConsentSchema>;

/** Motivo público (detalhe do erro) para o cliente reabrir a confirmação. */
export const AI_CONSENT_REQUIRED_REASON = "ai_consent_required";

export const AI_CONSENT_REQUIRED_MESSAGE =
  "Confirme o envio ao provedor de IA antes de continuar. Nada foi enviado " +
  "e nenhum crédito foi usado.";

/**
 * Exige a confirmação da operação desta chamada. Ausente ou de outra
 * operação: recusa, sem efeito. A forma (versão, `confirmed: true`) já foi
 * validada pelo schema estrito do payload.
 */
export const assertProviderConsent = (
  consent: ProviderConsent | undefined,
  operation: AiConsentOperation,
): void => {
  if (consent === undefined || consent.operation !== operation) {
    throw new ApplicationError(
      "domain_precondition_failed",
      AI_CONSENT_REQUIRED_MESSAGE,
      {reason: AI_CONSENT_REQUIRED_REASON},
    );
  }
};
