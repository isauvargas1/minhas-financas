/**
 * Cópia mínima e descartável da raiz do repositório para testar as ferramentas de publicação e do piloto pela linha
 * de comando com um contrato CONTROLADO pelo teste (P6-A).
 *
 * Por que existe: rodar `tools/deploy/publicar.mjs` ou `tools/piloto/acesso-piloto.mjs` contra o contrato real faria o
 * resultado do teste depender do estado de `config/ambientes.json`. Quando o proprietário registrar a liberação G0, um
 * teste assim, executado numa árvore limpa e com tag, chegaria ao pipeline de verdade. Aqui, a cópia:
 * - leva só `tools/`, `config/`, `.firebaserc` e `firebase.json` (sem `node_modules`, sem `functions/`);
 * - não é repositório Git e o Git é impedido de subir aos diretórios pais (`GIT_CEILING_DIRECTORIES`), então o commit
 *   nunca é identificado e o guard de publicação recusa de qualquer jeito;
 * - recebe o contrato ajustado pelo teste (`ajustarContrato`).
 */
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const RAIZ_REAL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const criarRaizTemporaria = ({ajustarContrato = () => {}} = {}) => {
  const base = mkdtempSync(join(tmpdir(), 'fenix-raiz-'));
  const raiz = join(base, 'repo');
  for (const item of ['tools', 'config', '.firebaserc', 'firebase.json']) {
    cpSync(join(RAIZ_REAL, item), join(raiz, item), {recursive: true});
  }
  const caminhoContrato = join(raiz, 'config', 'ambientes.json');
  const contrato = JSON.parse(readFileSync(caminhoContrato, 'utf8'));
  ajustarContrato(contrato);
  writeFileSync(caminhoContrato, `${JSON.stringify(contrato, null, 2)}\n`);
  return {
    raiz,
    /** Variáveis que impedem o Git de achar um repositório acima da cópia. */
    envGit: {GIT_CEILING_DIRECTORIES: base},
    remover: () => rmSync(base, {recursive: true, force: true}),
  };
};
