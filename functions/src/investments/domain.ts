/**
 * Versões do domínio patrimonial gravadas em todo movimento e posição.
 *
 * O formato dos documentos é o contrato Zod de `documentContracts.ts`, que
 * reproduz as invariantes das Rules; aqui ficam só as constantes que os
 * documentos carregam.
 */
export const INVESTMENT_DOMAIN_VERSION = 2 as const;
export const INVESTMENT_CALCULATION_VERSION =
  "investment-v2-cents-micros-half-up" as const;

export type InvestmentProfileType = "PF" | "PJ";
