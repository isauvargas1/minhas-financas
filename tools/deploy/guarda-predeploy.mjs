#!/usr/bin/env node

import {spawnSync} from 'node:child_process';
import {RAIZ, carregarConfiguracao} from '../ambiente/contrato.mjs';
import {fatosLocais, lerMarcadorDoRelease} from './fatos.mjs';
import {avaliarGancho} from './publicacao.mjs';

const alvoFirebase = process.argv[2];
const publicacao = process.env.FENIX_PUBLICACAO;

const recusar = motivos => {
  process.stderr.write(
    '\\n[predeploy] deploy recusado pelo guard do FênixGran:\\n' +
    motivos.map(m => '  - ' + m).join('\\n') + '\\n'
  );
  process.exit(3);
};

try {
  const cfg = carregarConfiguracao(RAIZ);

  const avaliar = (conferirBuild = true) => avaliarGancho({
    fatos: {
      cfg,
      project: process.env.GCLOUD_PROJECT,
      env: process.env,
      ...fatosLocais(RAIZ),
    },
    alvoFirebase,
    publicacao,
    conferirBuild,
    marcador: alvoFirebase === 'hosting'
      ? lerMarcadorDoRelease(RAIZ)
      : null,
  });

  const hostingNativo =
    alvoFirebase === 'hosting' &&
    publicacao === undefined;

  const motivos = avaliar(!hostingNativo);

  if (motivos.length) recusar(motivos);

  if (hostingNativo) {
    console.log('[predeploy] Compilando frontend de produção...');

    const build = spawnSync(
      'npm',
      ['run', 'build:release'],
      {cwd: RAIZ, stdio: 'inherit'}
    );

    if (build.status !== 0) {
      recusar(['A compilação de produção falhou.']);
    }

    const motivosBuild = avaliar(true);

    if (motivosBuild.length) recusar(motivosBuild);
  }

  console.log(
    '[predeploy] ' + alvoFirebase + ': autorizado pelo guard.'
  );

} catch (erro) {
  recusar(
    erro.motivos ?? ['falha do guard: ' + erro.message]
  );
}
