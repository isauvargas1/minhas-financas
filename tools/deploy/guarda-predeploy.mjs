#!/usr/bin/env node
/**
 * Gancho de predeploy do `firebase.json` (P6-A). Roda como primeiro passo de todo `firebase deploy` deste repositório,
 * para Firestore, Functions, Hosting e Storage, inclusive quando alguém chama o firebase-tools direto, sem os scripts.
 *
 *   node tools/deploy/guarda-predeploy.mjs <firestore|functions|hosting|storage>
 *
 * O firebase-tools informa o projeto em `GCLOUD_PROJECT`. A publicação só segue se tiver vindo do guard
 * (`tools/deploy/publicar.mjs`) para o mesmo projeto e o mesmo commit, e se os itens estáticos (contrato, liberação,
 * `.firebaserc`, worktree, versão) e, no Hosting, o build continuarem válidos. Limite: um operador com permissão no
 * projeto ainda publica por fora do repositório; isso é do IAM (E-04).
 */
import {RAIZ, carregarConfiguracao} from '../ambiente/contrato.mjs';
import {fatosLocais, lerMarcadorDoRelease} from './fatos.mjs';
import {avaliarGancho} from './publicacao.mjs';

const alvoFirebase = process.argv[2];
let motivos;
try {
  const cfg = carregarConfiguracao(RAIZ);
  motivos = avaliarGancho({
    fatos: {cfg, project: process.env.GCLOUD_PROJECT, env: process.env, ...fatosLocais(RAIZ)},
    alvoFirebase,
    publicacao: process.env.FENIX_PUBLICACAO,
    marcador: alvoFirebase === 'hosting' ? lerMarcadorDoRelease(RAIZ) : null,
  });
} catch (erro) {
  motivos = erro.motivos ?? [`falha do guard: ${erro.message}`];
}
if (motivos.length > 0) {
  process.stderr.write(`\n[predeploy] deploy recusado pelo guard do FênixGran:\n${motivos.map((motivo) => `  - ${motivo}`).join('\n')}\n`);
  process.exit(3);
}
console.log(`[predeploy] ${alvoFirebase}: autorizado pelo guard.`);
