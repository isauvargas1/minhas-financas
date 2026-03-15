import * as admin from "firebase-admin";

admin.initializeApp();

// Triggers (Gatilhos Automáticos)
export * from "./triggers/transactions";

// Callables (APIs chamadas pelo frontend)
export * from "./callables/splitGroups";

// Cron Jobs (Tarefas agendadas)
export * from "./crons/recurring";

export * from "./callables/billing";

// Webhooks (Recebem avisos de serviços externos)
export * from "./webhooks/stripe";
