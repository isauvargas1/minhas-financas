/**
 * Leitura do comprovante como Promise (P2B.2).
 *
 * O `FileReader` avisa por callback; com `onload` assíncrono solto, o
 * handler do modal chegava ao `finally` — e liberava o carregamento e os
 * botões de IA — antes de a leitura e a chamada de extração terminarem.
 * Aguardando esta Promise, leitura, chamada e erro ficam no mesmo
 * `try/catch/finally`.
 *
 * Devolve só o conteúdo em base64 (sem o prefixo `data:...;base64,`).
 * `createReader` existe para o teste unitário, sem DOM.
 */
export const readFileAsBase64 = (
  file: Blob,
  createReader: () => FileReader = () => new FileReader(),
): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = createReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const base64 = dataUrl.split(',')[1];
      if (base64) resolve(base64);
      else reject(new Error('document_file_empty'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('document_file_read_failed'));
    reader.onabort = () => reject(new Error('document_file_read_aborted'));
    reader.readAsDataURL(file);
  });

/** Tipos aceitos pelo backend para leitura de comprovante por IA. */
export const AI_DOCUMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;

export type AiDocumentMimeType = (typeof AI_DOCUMENT_MIME_TYPES)[number];

/** Valor do atributo `accept` do seletor de arquivo. */
export const AI_DOCUMENT_ACCEPT = AI_DOCUMENT_MIME_TYPES.join(',');

/**
 * Teto do arquivo no cliente: 4,5 MB. Em base64 vira 6.291.456 caracteres,
 * exatamente o limite do backend (6 * 1024 * 1024).
 */
export const AI_DOCUMENT_MAX_BYTES = 4_718_592;

export const AI_DOCUMENT_EMPTY_MESSAGE = 'Arquivo vazio. Escolha outro arquivo.';
export const AI_DOCUMENT_UNSUPPORTED_MESSAGE =
  'Formato não suportado. Envie uma imagem PNG, JPEG ou WEBP, ou um PDF.';
export const AI_DOCUMENT_TOO_LARGE_MESSAGE =
  'Arquivo grande demais para leitura por IA (máximo de 4,5 MB).';
export const AI_DOCUMENT_READ_FAILED_MESSAGE =
  'Não foi possível ler o arquivo. Nada foi enviado.';

export type AiDocumentCheck =
  | { ok: true; mimeType: AiDocumentMimeType }
  | { ok: false; message: string };

/** Validação local, antes de qualquer envio: vazio, tipo e tamanho. */
export const validateAiDocument = (file: { type: string; size: number }): AiDocumentCheck => {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, message: AI_DOCUMENT_EMPTY_MESSAGE };
  }
  const mimeType = (AI_DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type)
    ? (file.type as AiDocumentMimeType)
    : null;
  if (!mimeType) return { ok: false, message: AI_DOCUMENT_UNSUPPORTED_MESSAGE };
  if (file.size > AI_DOCUMENT_MAX_BYTES) {
    return { ok: false, message: AI_DOCUMENT_TOO_LARGE_MESSAGE };
  }
  return { ok: true, mimeType };
};

const TYPE_LABELS: Record<AiDocumentMimeType, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WEBP',
  'application/pdf': 'PDF',
};

export const aiDocumentTypeLabel = (mimeType: AiDocumentMimeType): string =>
  TYPE_LABELS[mimeType];

/** Tamanho em pt-BR (base 1024): `350 KB`, `1,2 MB`. Sem ponto flutuante inexato na exibição. */
export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  const kilobytes = Math.round(bytes / 1024);
  if (kilobytes < 1024) return `${kilobytes} KB`;
  const tenthsOfMegabyte = Math.round((bytes * 10) / (1024 * 1024));
  const whole = Math.floor(tenthsOfMegabyte / 10);
  const tenth = tenthsOfMegabyte % 10;
  return `${whole},${tenth} MB`;
};
