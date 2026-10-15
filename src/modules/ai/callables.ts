/**
 * Contrato cliente das callables de IA (P2B.2, P5-E1).
 *
 * Módulo puro: não importa o SDK. `api.ts` o liga ao `httpsCallable`; os
 * testes o ligam a um `invoke` falso. A chave de idempotência é do CHAMADOR:
 * uma por intenção do usuário, gerada no momento da confirmação de envio. O
 * backend consome no máximo um crédito por chave e não chama o provedor duas
 * vezes. Peso em créditos, modelo e limites de custo existem só no servidor.
 *
 * Nenhum valor financeiro vem do navegador: a análise envia só a pergunta e o
 * período (o servidor lê o relatório oficial), e a extração envia só o texto
 * reconhecido ou o arquivo escolhido. Toda chamada leva a confirmação de
 * envio ao provedor de IA (`providerConsent`), versionada e por operação; é
 * um controle de transparência, não registro de consentimento LGPD.
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

/** Versão do texto de confirmação de envio ao provedor de IA. */
export const AI_PROVIDER_CONSENT_VERSION = 'ai-provider-share-v1';

export type AiConsentOperation = 'analysis' | 'extraction_text' | 'extraction_document';

export interface ProviderConsent {
  version: typeof AI_PROVIDER_CONSENT_VERSION;
  operation: AiConsentOperation;
  confirmed: true;
}

/** Confirmação de envio da operação, feita pela pessoa no diálogo. */
export const providerConsent = (operation: AiConsentOperation): ProviderConsent => ({
  version: AI_PROVIDER_CONSENT_VERSION,
  operation,
  confirmed: true,
});

/** Período da análise: o mesmo contrato dos Relatórios. */
export type ReportRangeInput =
  | { kind: 'preset'; preset: '7d' | '30d' | '90d' | '12m' | 'ytd' | 'all' }
  | { kind: 'month'; month: string };

export interface FinancialQuestionInput {
  workspaceId: string;
  question: string;
  range: ReportRangeInput;
  /** Uma por intenção do usuário (gerada na confirmação). */
  idempotencyKey: string;
}

export interface AnalysisAnswer {
  answer: string;
  createdAt: string;
  workspaceType: 'PF' | 'PJ';
  period: {
    label: string;
    startDate: string | null;
    endDate: string;
    referenceDate: string;
    dayCount: number;
  };
  coverage: Record<string, string>;
}

export type InvalidReason =
  | 'format'
  | 'negative'
  | 'zero'
  | 'too_large'
  | 'precision'
  | 'out_of_range'
  | 'too_long'
  | 'not_applicable';

export type FieldState<T> =
  | { state: 'identified'; value: T }
  | { state: 'missing' }
  | { state: 'invalid'; reason: InvalidReason }
  | { state: 'ambiguous' };

export interface ExtractionResult {
  schemaVersion: 1;
  status: 'complete' | 'partial' | 'refused';
  fields: {
    operation: FieldState<'income' | 'expense'>;
    description: FieldState<string>;
    /** Inteiro em centavos. */
    amountCents: FieldState<number>;
    /** AAAA-MM-DD. */
    date: FieldState<string>;
    categoryHint: FieldState<string>;
    supplier: FieldState<string>;
    costCenterHint: FieldState<string>;
    /** 1 a 60. */
    installments: FieldState<number>;
  };
}

export interface ExtractionResponse {
  extraction: ExtractionResult;
}

export type DocumentMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'application/pdf';

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

/**
 * Tempo limite do cliente para as callables de IA, acima dos 120 s da
 * função (e dos 90 s do provedor). Com o padrão do SDK (70 s), o navegador
 * desistiria enquanto o servidor, já com o crédito admitido, ainda espera o
 * provedor.
 */
export const AI_CLIENT_TIMEOUT_MS = 125_000;

/**
 * Só `unavailable` (e erro sem `code`) é repetido. `deadline-exceeded`
 * significa que o pedido chegou ao servidor: repetir não traria a resposta e
 * só voltaria "já processada".
 */
const TRANSPORT_CODES = new Set(['unavailable']);

/**
 * A repetição por falha de transporte encontrou o pedido já processado: a
 * primeira tentativa chegou ao servidor e pode ter sido contabilizada.
 */
export const AI_RETRY_ALREADY_PROCESSED_MESSAGE =
  'A conexão caiu durante a consulta e o pedido já tinha chegado ao servidor. A tentativa pode ter sido contabilizada nos créditos de IA do plano. Envie novamente para tentar outra vez.';

const errorCode = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null) return null;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code.replace(/^functions\//, '') : null;
};

/**
 * Falha de transporte: a requisição pode nem ter chegado ao servidor
 * (`unavailable`) ou nem ter `code` (erro de rede do navegador). Qualquer
 * resposta do backend, mesmo de erro, não é transporte.
 */
export const isAiTransportFailure = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const code = errorCode(error);
  return code === null || TRANSPORT_CODES.has(code);
};

export const AI_PERMISSION_DENIED_MESSAGE =
  'Você não tem permissão para usar a IA neste espaço de trabalho.';

export const AI_GENERIC_ERROR_MESSAGE =
  'Não foi possível usar a IA agora. Tente novamente mais tarde.';

const backendMessage = (error: unknown): string | null => {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && /\s/.test(message.trim()) ? message : null;
};

/**
 * Mensagem em pt-BR para o usuário. Erros de negócio do backend
 * (`failed-precondition`, `invalid-argument`, `resource-exhausted`) trazem a
 * própria frase; o código cru do SDK (sem espaço) nunca é mostrado.
 */
export const aiErrorMessage = (error: unknown): string => {
  if (isAiCreditsExhausted(error)) return aiCreditsExhaustedMessage(error);
  const code = errorCode(error);
  if (code === 'permission-denied') return AI_PERMISSION_DENIED_MESSAGE;
  if (code === 'failed-precondition' || code === 'invalid-argument' ||
    code === 'resource-exhausted') {
    return backendMessage(error) ?? AI_GENERIC_ERROR_MESSAGE;
  }
  return AI_GENERIC_ERROR_MESSAGE;
};

export interface AiCallableOptions {
  /** Espera antes da única repetição por falha de transporte. */
  wait?: (ms: number) => Promise<void>;
}

const TRANSPORT_RETRY_DELAY_MS = 600;

export const createAiCallables = (invoke: Invoke, options: AiCallableOptions = {}) => {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));

  /*
   * Uma única repetição, com a MESMA chave e o mesmo payload, só quando a
   * resposta pode nunca ter chegado. Se a primeira tentativa já tiver sido
   * admitida, o backend responde "já processada" sem novo débito. Respostas
   * do backend (failed-precondition, invalid-argument, resource-exhausted,
   * permission-denied, internal...) nunca são repetidas.
   */
  const call = async <TResult>(
    name: AiCallableName,
    payload: Record<string, unknown>,
  ): Promise<TResult> => {
    try {
      return await invoke<TResult>(name, payload);
    } catch (error) {
      if (!isAiTransportFailure(error)) throw error;
      await wait(TRANSPORT_RETRY_DELAY_MS);
      try {
        return await invoke<TResult>(name, payload);
      } catch (retryError) {
        // Mesma chave já admitida: a resposta da primeira tentativa se perdeu.
        if (errorCode(retryError) === 'failed-precondition') {
          throw Object.assign(new Error(AI_RETRY_ALREADY_PROCESSED_MESSAGE), {
            code: 'functions/failed-precondition',
          });
        }
        throw retryError;
      }
    }
  };

  return {
    analyzeFinancialQuestion: (input: FinancialQuestionInput) =>
      call<AnalysisAnswer>('analyzeFinancialQuestion', {
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
        question: input.question,
        range: input.range,
        providerConsent: providerConsent('analysis'),
      }),

    extractTransactionFromText: (input: {
      workspaceId: string;
      transcript: string;
      idempotencyKey: string;
    }) =>
      call<ExtractionResponse>('extractTransactionFromContent', {
        kind: 'text',
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
        transcript: input.transcript,
        providerConsent: providerConsent('extraction_text'),
      }),

    extractTransactionFromDocument: (input: {
      workspaceId: string;
      mimeType: DocumentMimeType;
      dataBase64: string;
      idempotencyKey: string;
    }) =>
      call<ExtractionResponse>('extractTransactionFromContent', {
        kind: 'document',
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
        mimeType: input.mimeType,
        dataBase64: input.dataBase64,
        providerConsent: providerConsent('extraction_document'),
      }),
  };
};
