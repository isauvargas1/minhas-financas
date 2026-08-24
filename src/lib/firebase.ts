import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const requiredFirebaseEnv = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID'
] as const;

const missingFirebaseEnv = requiredFirebaseEnv.filter(
  (key) => !(import.meta.env as Record<string, string | undefined>)[key]
);

if (missingFirebaseEnv.length > 0) {
  throw new Error(
    `Firebase não configurado. Variáveis ausentes: ${missingFirebaseEnv.join(', ')}`
  );
}

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
// Mesma região declarada em `functions/src/shared/runtimeOptions.ts`. O SDK
// Web resolve `us-central1` por padrão; sem isto o cliente chamaria um
// endpoint que não existe mais depois da migração de região (INV-P2-042).
export const FUNCTIONS_REGION = 'southamerica-east1';

export const functions = getFunctions(app, FUNCTIONS_REGION);

const shouldUseFirebaseEmulators =
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';

const emulatorState = globalThis as typeof globalThis & {
  __MINHAS_FINANCAS_FIREBASE_EMULATORS_CONNECTED__?: boolean;
};

if (shouldUseFirebaseEmulators && !emulatorState.__MINHAS_FINANCAS_FIREBASE_EMULATORS_CONNECTED__) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);

  emulatorState.__MINHAS_FINANCAS_FIREBASE_EMULATORS_CONNECTED__ = true;
}

export default app;