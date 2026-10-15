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
 * Movimentos, posições, períodos, alocações, transações e trilha de auditoria
 * do domínio ficam de fora desta política por construção — nenhum deles
 * recebe `expiresAt`.
 *
 * O campo `expiresAt` é apenas a marca. A remoção é feita pela política de TTL
 * do Firestore, declarada por grupo de coleção em `firestore.indexes.json`
 * (`fieldOverrides`) e ativa só depois de publicada em cada ambiente
 * (`docs/production/DATA_RETENTION_LIFECYCLE.md`, §2.2 e §7).
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
  /**
   * Marca de entrega já aplicada pelo gatilho de caixa (INV-P3-001).
   *
   * Mesma classe das chaves de idempotência, e pelo mesmo motivo: precisa
   * sobreviver com folga à janela de reentrega do Eventarc — 24 horas para um
   * gatilho de 2ª geração com `retry` (P3-B) — e à reconstrução em andamento,
   * que soma as marcas posteriores ao corte e recomeça depois de 24 horas.
   * Não tem valor depois disso: o fato financeiro vive na transação e no
   * período, que nunca expiram. Política de TTL declarada em
   * `firestore.indexes.json`.
   */
  cashPeriodEvents: 90,
  /**
   * Acumulador intermediário da reconstrução da projeção de caixa (P5-C1):
   * detalhe diário por mês e, na simulação, categorias. Não é fato nem
   * projeção publicada — a publicação copia o conteúdo para os meses no
   * mesmo commit, e a reconstrução apaga os próprios shards ao terminar. A
   * TTL é a rede de segurança de uma reconstrução abandonada (o checkpoint
   * vence em 24 horas).
   */
  cashRebuildShards: 7,
  /**
   * Recibo idempotente de evento do Stripe (P2A). O Stripe reentrega por até
   * 3 dias e permite reenvio manual de eventos de até 30 dias; o recibo
   * precisa sobreviver a toda essa janela para o replay continuar sem efeito.
   * A trilha de billing (`billing_events`) não expira.
   */
  billingWebhookEvents: 90,
  /**
   * Recibo de consumo de crédito de IA (P2B.2): só metadados e hash, nunca
   * conteúdo. Precisa sobreviver a qualquer retry plausível da mesma chave;
   * o contador mensal (`ai_usage`) não expira nesta etapa (ciclo de vida em
   * P8).
   */
  aiUsageReceipts: 90,
  /**
   * Evento de notificação compartilhado (`notifications`) e o estado privado
   * de cada usuário sobre ele (`notification_entries`): os dois expiram juntos,
   * com o mesmo `expiresAt`. A contagem parte da criação do evento no
   * servidor e nunca é prorrogada por reexecução do produtor. A interface
   * esconde a notificação já na expiração lógica; a remoção física é do TTL
   * do Firestore, declarado em `firestore.indexes.json` e só efetivo depois
   * de publicado e ativo no ambiente (E-07, pendente). Não é fato
   * financeiro: o fato vive na fatura, no lançamento e nos eventos do cartão,
   * que nunca expiram.
   */
  notifications: 180,
} as const;

/** Instante de expiração a partir de agora, em dias. */
export const expiresInDays = (days: number): Timestamp =>
  Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);

/**
 * Instante de expiração a partir de um instante já capturado, em dias.
 * Determinístico: o mesmo instante e os mesmos dias dão o mesmo `Timestamp`.
 */
export const expiresAfterDays = (fromMillis: number, days: number): Timestamp =>
  Timestamp.fromMillis(fromMillis + days * 24 * 60 * 60 * 1000);
