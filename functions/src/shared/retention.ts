import {Timestamp} from "firebase-admin/firestore";

/**
 * Política de retenção das coleções operacionais (INV-P2-041).
 *
 * Chaves de idempotência, métricas, eventos e contadores de frequência crescem
 * a cada mutação e nunca eram purgados: custo de armazenamento indefinido e
 * índices cada vez maiores num caminho que não tem valor de auditoria de longo
 * prazo.
 *
 * A regra que separa o que expira do que não expira é uma só: **fato
 * financeiro necessário para auditoria ou reconstrução nunca expira**.
 * Movimentos, valorações, posições, períodos, alocações, transações e trilha
 * de auditoria do domínio ficam de fora desta política por construção — nenhum
 * deles recebe `expiresAt`.
 *
 * O campo `expiresAt` é apenas a marca. A remoção é feita pela política de TTL
 * do Firestore, que precisa ser ativada por coleção no projeto — passo de
 * infraestrutura registrado em
 * `docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md`.
 */

export const RETENTION_DAYS = {
  /**
   * Chave de idempotência. Precisa sobreviver com folga a qualquer retry
   * plausível — inclusive um usuário que reabre o aplicativo dias depois — e
   * não tem valor depois disso.
   */
  idempotencyKeys: 90,
  /** Métrica operacional diária agregada. */
  operationalMetrics: 400,
  /** Log de evento operacional (não é a trilha de auditoria do domínio). */
  eventLogs: 400,
  /** Contador de limite de frequência: some junto com a janela. */
  rateLimits: 2,
  /** Checkpoint de operação já concluída. */
  completedCheckpoints: 30,
} as const;

/** Instante de expiração a partir de agora, em dias. */
export const expiresInDays = (days: number): Timestamp =>
  Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);
