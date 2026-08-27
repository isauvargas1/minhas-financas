import type {CallableOptions} from "firebase-functions/v2/https";
import type {GlobalOptions} from "firebase-functions/v2/options";

/**
 * Região e recursos das Cloud Functions.
 *
 * ## Região
 *
 * O Firestore deste projeto está em `southamerica-east1`
 * (`firebase.json` → `firestore.location`). Nenhuma função declarava região,
 * então todas subiam no padrão `us-central1` (INV-P2-042): **toda** leitura e
 * escrita das operações financeiras — que são transacionais e fazem dezenas de
 * round-trips por chamada — cruzava o continente duas vezes. Declarar a região
 * junto do banco elimina essa latência e o egress correspondente.
 *
 * Trocar a região de uma função já implantada **não é uma edição no lugar**:
 * o Firebase cria a função nova e a antiga continua existindo. O procedimento
 * de corte está em `docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md`.
 *
 * ## Recursos
 *
 * Os valores vêm do comportamento real de cada classe de operação, não de
 * chutes:
 *
 * - **Callables transacionais** (aporte, resgate, liquidação, compra de
 *   cartão): uma transação com dezenas de documentos, concluída em segundos.
 *   60 s e 256 MiB cobrem com folga; `maxInstances` limita o fan-out contra o
 *   Firestore.
 * - **Callables pesadas e paginadas** (rebuild, backfill, migração,
 *   reconciliação, rollback, varredura de deriva): laços com cursor sobre o
 *   ledger inteiro. O padrão de 60 s matava a execução no meio deixando
 *   estado parcial. 540 s é o teto de uma callable HTTP; `maxInstances`
 *   baixo é deliberado — elas escrevem em documentos singleton do workspace e
 *   paralelismo alto só produz contenção (INV-P2-017).
 * - **Crons**: janela longa, concorrência mínima.
 */

export const FUNCTIONS_REGION = "southamerica-east1";

/** Opções globais aplicadas a todo o codebase em `index.ts`. */
export const GLOBAL_FUNCTION_OPTIONS: GlobalOptions = {
  region: FUNCTIONS_REGION,
  maxInstances: 20,
};

/** Callable transacional de domínio financeiro. */
export const DOMAIN_CALLABLE_OPTIONS: CallableOptions = {
  region: FUNCTIONS_REGION,
  timeoutSeconds: 60,
  memory: "256MiB",
  maxInstances: 20,
};

/**
 * Callable operacional pesada: paginada, com checkpoint e retomada.
 *
 * `maxInstances: 3` é o limite deliberado de concorrência global dessas
 * operações. Dentro de um mesmo workspace, o que impede duas execuções de se
 * atrapalharem é o par cerca de versão + serialização transacional — o
 * backfill acrescenta um lease do próprio lote (`backfill.ts`). O teto aqui
 * resolve outra coisa: protege o Firestore de um fan-out de reconstruções
 * simultâneas em tenants **diferentes**.
 */
export const HEAVY_CALLABLE_OPTIONS: CallableOptions = {
  region: FUNCTIONS_REGION,
  timeoutSeconds: 540,
  memory: "512MiB",
  maxInstances: 3,
};

/** Callable de IA: espera provider externo, não escreve no domínio. */
export const AI_CALLABLE_OPTIONS: CallableOptions = {
  region: FUNCTIONS_REGION,
  timeoutSeconds: 120,
  memory: "256MiB",
  maxInstances: 10,
};

/** Alias de leitura para o domínio de cartões. */
export const CREDIT_CARD_CALLABLE_OPTIONS = DOMAIN_CALLABLE_OPTIONS;

/** Alias de leitura para as operações pesadas de cartões. */
export const HEAVY_CREDIT_CARD_CALLABLE_OPTIONS = HEAVY_CALLABLE_OPTIONS;

/** Opções das rotinas agendadas. */
export const SCHEDULED_FUNCTION_OPTIONS = {
  region: FUNCTIONS_REGION,
  timeoutSeconds: 540,
  memory: "512MiB",
  maxInstances: 1,
} as const;
