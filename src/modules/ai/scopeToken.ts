/**
 * Token de escopo de uma operação de IA no formulário de lançamento (P5-E1).
 *
 * Capturado quando a pessoa confirma o envio e conferido depois da leitura do
 * arquivo e no retorno da callable. Se o workspace, a aba, a abertura do
 * modal ou o modo de edição mudou, o resultado é descartado sem preencher
 * nada. Módulo puro: quem chama lê os valores atuais de `ref`s, porque os
 * callbacks assíncronos são capturados no início da operação.
 */
export interface AiScopeSnapshot {
  readonly open: boolean;
  readonly workspaceId: string;
  readonly tab: string;
  /** Avança a cada abertura do modal. */
  readonly openSeq: number;
  readonly editing: boolean;
}

export const captureAiScope = (current: AiScopeSnapshot): AiScopeSnapshot =>
  Object.freeze({ ...current });

/** `true` só quando o escopo atual ainda é exatamente o da confirmação. */
export const isSameAiScope = (
  captured: AiScopeSnapshot,
  current: AiScopeSnapshot,
): boolean =>
  captured.open &&
  current.open &&
  captured.workspaceId === current.workspaceId &&
  captured.tab === current.tab &&
  captured.openSeq === current.openSeq &&
  captured.editing === current.editing;

export const AI_SUGGESTION_DISCARDED_MESSAGE =
  'A sugestão da IA foi descartada porque o formulário mudou.';
