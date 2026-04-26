import * as admin from "firebase-admin";

admin.initializeApp();

// Triggers (Gatilhos Automáticos)
export * from "./triggers/transactions";

// Callables (APIs chamadas pelo frontend)
export * from "./callables/splitGroups";
export * from "./creditCards/callables";

export * from "./callables/billing";

// Cron Jobs (Tarefas agendadas)
export * from "./crons/recurring";

// Webhooks (Recebem avisos de serviços externos)
export * from "./webhooks/stripe";