import { newIdempotencyKey } from '../workspaces/callables.ts';

/**
 * Contrato cliente das callables de IA (P2B.2).
 *
 * Módulo puro: não importa o SDK. `api.ts` o liga ao `httpsCallable`; os
 * testes o ligam a um `invoke` falso. Cada chamada é uma ação intencional do
 * usuário e leva uma chave de idempotência nova: o backend consome no máximo
 * um crédito por chave e não chama o provedor duas vezes. Peso em créditos,
 * modelo e limites de custo existem só no servidor.
 */
export const AI_CALLABLES = [
  'analyzeFinancialQuestion',
  'extractTransactionFromContent',
] as const;

export type AiCallableName = (typeof AI_CALLABLES)[number];

export type Invoke = <TResult>(
  name: AiCallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

export interface FinancialQuestionContext {
  profileType: 'PF' | 'PJ';
  periodLabel: string;
  kpis: Array<{ label: string; formattedValue: string }>;
  topCategories: string[];
  alerts: string[];
}

export interface FinancialQuestionInput {
  workspaceId: string;
  question: string;
  context: FinancialQuestionContext;
}

export interface FinancialQuestionResult {
  answer: string;
  createdAt: string;
}

export interface ExtractionResult {
  extracted: Record<string, unknown>;
}

/** Créditos mensais de IA do plano do titular esgotados (texto do backend). */
export const AI_CREDITS_EXHAUSTED_MESSAGE =
  'Os créditos de IA deste plano acabaram neste mês. Faça upgrade ou aguarde o início do próximo mês.';

/**
 * Recusa por créditos de IA esgotados. Só o backend envia
 * `details.resource = 'aiCreditsPerMonth'`; um `resource-exhausted` sem esse
 * detalhe (ex.: HTTP 429 da plataforma) não é falta de crédito.
 */
export const isAiCreditsExhausted = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const { code, details } = error as { code?: unknown; details?: unknown };
  return code === 'functions/resource-exhausted' &&
    typeof details === 'object' && details !== null &&
    (details as { resource?: unknown }).resource === 'aiCreditsPerMonth';
};

/**
 * Mensagem de créditos esgotados: a do backend, que já distingue o titular
 * (upgrade) de quem não é o titular (pedir ao titular).
 */
export const aiCreditsExhaustedMessage = (error: unknown): string => {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && /\s/.test(message.trim())
    ? message
    : AI_CREDITS_EXHAUSTED_MESSAGE;
};

export const createAiCallables = (invoke: Invoke) => ({
  analyzeFinancialQuestion: (input: FinancialQuestionInput) =>
    invoke<FinancialQuestionResult>('analyzeFinancialQuestion', {
      workspaceId: input.workspaceId,
      question: input.question,
      context: input.context,
      idempotencyKey: newIdempotencyKey(),
    }),

  extractTransactionFromText: (input: { workspaceId: string; transcript: string }) =>
    invoke<ExtractionResult>('extractTransactionFromContent', {
      kind: 'text',
      workspaceId: input.workspaceId,
      transcript: input.transcript,
      idempotencyKey: newIdempotencyKey(),
    }),

  extractTransactionFromDocument: (input: {
    workspaceId: string;
    mimeType: string;
    dataBase64: string;
  }) =>
    invoke<ExtractionResult>('extractTransactionFromContent', {
      kind: 'document',
      workspaceId: input.workspaceId,
      mimeType: input.mimeType,
      dataBase64: input.dataBase64,
      idempotencyKey: newIdempotencyKey(),
    }),
});
