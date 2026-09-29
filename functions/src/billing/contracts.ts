import {z} from "zod";

import {idempotencyKeySchema} from "../shared/ids";
import {PAID_PLAN_IDS} from "./catalog";

/**
 * Contratos das callables de billing (P2A).
 *
 * Todos `.strict()`. O cliente escolhe o **plano** (`planId`), nunca o preço
 * do Stripe: o backend resolve `planId → priceId` pela configuração do
 * ambiente. Nenhum contrato aceita `priceId`, `customerId`, uid ou status.
 */
const returnUrlSchema = z.string().min(1).max(2048);

export const getBillingCatalogPayloadSchema = z.object({}).strict();

export const createCheckoutSessionPayloadSchema = z.object({
  planId: z.enum(PAID_PLAN_IDS),
  returnUrl: returnUrlSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const createBillingPortalSessionPayloadSchema = z.object({
  returnUrl: returnUrlSchema,
}).strict();

export type CreateCheckoutSessionPayload =
  z.infer<typeof createCheckoutSessionPayloadSchema>;
export type CreateBillingPortalSessionPayload =
  z.infer<typeof createBillingPortalSessionPayloadSchema>;
