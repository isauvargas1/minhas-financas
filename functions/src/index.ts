import * as admin from "firebase-admin";
import {setGlobalOptions} from "firebase-functions/v2/options";

import {GLOBAL_FUNCTION_OPTIONS} from "./shared/runtimeOptions";

admin.initializeApp();

// Região junto do Firestore (`southamerica-east1`) e teto global de
// instâncias. Sem isso todo o deploy subia em `us-central1`, a um continente
// de distância do banco (INV-P2-042).
setGlobalOptions(GLOBAL_FUNCTION_OPTIONS);

// Triggers (Gatilhos Automáticos)
export * from "./triggers/transactions";

// P1 — conta, workspaces, membership e convites (kernel de autorização).
export * from "./workspaces/callables";
export {onWorkspaceDisplayChange} from "./workspaces/indexSync";

// Callables (APIs chamadas pelo frontend)
export * from "./callables/splitGroups";
export * from "./creditCards/callables";
export * from "./goals/callables";
export * from "./investments/callables";
export * from "./ai/callables";

// P2A — billing canônico: catálogo, checkout e Customer Portal.
// P2B.1 — entitlement do workspace pelo owner e uso da conta (leitura).
export {
  createBillingPortalSession,
  createCheckoutSession,
  getAccountUsage,
  getBillingCatalog,
  getWorkspaceEntitlement,
} from "./billing/callables";
export * from "./cash/rebuild";

// Cron Jobs (Tarefas agendadas)
export * from "./crons/recurring";

export * from "./crons/creditCardInvoices";

// INV-P2-019 — varredura diária de deriva do domínio patrimonial. Amostrada
// por rodízio: cada execução cobre uma fatia dos workspaces com o domínio
// ativo, sem varrer todos os tenants todo dia.
export * from "./crons/investmentDrift";

// Webhooks (Recebem avisos de serviços externos)
export {stripeWebhook} from "./webhooks/stripe";
