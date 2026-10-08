import {onSchedule} from "firebase-functions/v2/scheduler";

import {runRecurringGeneration} from "../recurring/scheduler";
import {SCHEDULED_FUNCTION_OPTIONS} from "../shared/runtimeOptions";

/**
 * Gatilho diário das despesas recorrentes (P4-B, D-12).
 *
 * Só o disparo: a varredura, a recuperação de vencimentos perdidos, a
 * geração no Caixa ou no Cartão e os limites operacionais vivem em
 * `recurring/scheduler.ts` e `recurring/generation.ts`. Fuso declarado: sem
 * ele o Cloud Scheduler usa UTC e o corte do dia cairia às 23:00 do dia
 * anterior em São Paulo.
 */
export const processRecurring = onSchedule(
  {
    ...SCHEDULED_FUNCTION_OPTIONS,
    schedule: "every day 02:00",
    timeZone: "America/Sao_Paulo",
  },
  async (event) => {
    await runRecurringGeneration({
      requestId: `recurring-generation-${event.scheduleTime}`,
    });
  },
);
