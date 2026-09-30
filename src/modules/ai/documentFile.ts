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
