import type { FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, initializeFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';

/*
 * Conexão com o Emulator (P6-A, PR-PLAT-01 e PR-AUTH-04). Só entra no bundle dos perfis `local` e `e2e`: o
 * `vite.config.ts` aponta o alias `@fenix/emuladores` para este arquivo nesses perfis e para `emuladores.vazio.ts` nos
 * outros. A varredura do bundle (`tools/seguranca/varrer-bundle.mjs`) recusa um build sem Emulator que contenha o
 * marcador abaixo.
 *
 * Dois modos, definidos pelo perfil (`__FENIX_CONEXAO_EMULADOR__`, de `conexaoDoEmulador` em
 * `tools/ambiente/contrato.mjs`):
 * - `mesma-origem` (perfil `local`, `npm run dev`): o navegador fala só com o servidor do Vite (no GitHub Codespaces, a
 *   porta privada 3000), e o proxy do Vite repassa ao Emulator na própria máquina, sem expor as portas do Emulator;
 * - `direta` (perfil `e2e`): conexão às portas do Emulator em `127.0.0.1`, como o E2E foi validado.
 */
export const MARCADOR_EMULADORES = 'fenixgran:conexao-emuladores';
const PROJETO_EMULADOR = 'minhas-financas-local';

export interface ConexaoEmuladores {
  readonly marcador: string;
  readonly functions: Functions;
}

const estado = globalThis as typeof globalThis & { __FENIXGRAN_EMULADORES__?: ConexaoEmuladores };

export const conectarEmuladores = (app: FirebaseApp, regiao: string): ConexaoEmuladores | null => {
  if (estado.__FENIXGRAN_EMULADORES__) return estado.__FENIXGRAN_EMULADORES__;
  // PR-AUTH-04: o modo de Emulator nunca roda com o projeto de um ambiente remoto.
  if (app.options.projectId !== PROJETO_EMULADOR) {
    throw new Error('Conexão com o Emulator recusada: o projeto configurado não é o do Emulator.');
  }
  const conexao = __FENIX_CONEXAO_EMULADOR__;
  if (!conexao) throw new Error('Conexão com o Emulator recusada: o perfil não definiu o modo de conexão.');
  let functions: Functions;
  if (conexao.modo === 'direta') {
    connectAuthEmulator(getAuth(app), `http://${conexao.host}:${conexao.auth}`, { disableWarnings: true });
    connectFirestoreEmulator(getFirestore(app), conexao.host, conexao.firestore);
    functions = getFunctions(app, regiao);
    connectFunctionsEmulator(functions, conexao.host, conexao.functions);
  } else {
    const origem = window.location.origin;
    connectAuthEmulator(getAuth(app), origem, { disableWarnings: true });
    initializeFirestore(app, { host: window.location.host, ssl: window.location.protocol === 'https:' });
    // Domínio próprio das callables: `<origem>/<projeto>/<região>/<nome>`, o caminho do Emulator de Functions.
    functions = getFunctions(app, `${origem}/${PROJETO_EMULADOR}/${regiao}`);
  }
  const resultado: ConexaoEmuladores = { marcador: MARCADOR_EMULADORES, functions };
  estado.__FENIXGRAN_EMULADORES__ = resultado;
  return resultado;
};
