import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { ativarAppCheck } from '@fenix/app-check';
import { conectarEmuladores } from '@fenix/emuladores';

/*
 * P6-A (PR-PLAT-01, PR-AUTH-04): a configuração web vem do perfil de build (`config/ambientes.json`, pelo `define`
 * `__FENIX_CONFIG_WEB__` do `vite.config.ts`), nunca do ambiente da estação. O cliente não lê nenhuma `VITE_*`.
 *
 * P5-GATE-FINAL (E-00, causa da exposição de chave), mantido: nada aqui lê `import.meta.env` como objeto. Isso faria o
 * Vite embutir no bundle público todas as variáveis `VITE_*` do ambiente de build. A guarda
 * `tests/unit/ai-backend-only.test.ts` e a varredura do bundle (`tools/seguranca/varrer-bundle.mjs`) falham se voltar.
 */
const firebaseConfig = __FENIX_CONFIG_WEB__;

const requiredFirebaseConfig = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'] as const;

const missingFirebaseConfig = requiredFirebaseConfig.filter((field) => !firebaseConfig?.[field]);

if (missingFirebaseConfig.length > 0) {
  throw new Error(
    `Firebase não configurado para o perfil ${__FENIX_PERFIL__}. Campos ausentes: ${missingFirebaseConfig.join(', ')}`
  );
}

const app = initializeApp(firebaseConfig);

// Mesma região declarada em `functions/src/shared/runtimeOptions.ts`. O SDK
// Web resolve `us-central1` por padrão; sem isto o cliente chamaria um
// endpoint que não existe mais depois da migração de região (INV-P2-042).
export const FUNCTIONS_REGION = 'southamerica-east1';

/*
 * Só nos perfis `local` e `e2e` o módulo real entra no bundle e conecta ao Emulator antes de qualquer uso dos serviços
 * abaixo. Nos perfis `verificacao` e `release`, o alias aponta para um módulo que devolve `null`.
 */
const emuladores = conectarEmuladores(app, FUNCTIONS_REGION);

/*
 * P6-A (PR-APPCHK-01, preparação): o App Check entra no bundle só no release com `producao.appCheck` registrado
 * (E-02); nos demais casos o alias aponta para um módulo vazio. Ele precisa vir antes de Auth, Firestore e Functions.
 * O enforcement é do servidor e do console, e continua desligado até a decisão D-33.
 */
ativarAppCheck(app, __FENIX_APP_CHECK__);

// P6-A: o Cloud Storage não é usado pelo app (storage.rules nega tudo); o SDK não é inicializado no cliente.

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = emuladores?.functions ?? getFunctions(app, FUNCTIONS_REGION);

export default app;
