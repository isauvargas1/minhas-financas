// Tipos do SDK para o Playwright, resolvidos no pacote functions.
// Sem inicializacao ou operacoes administrativas em runtime.
export type AdminAppModule = typeof import("firebase-admin/app");
export type AdminAuthModule = typeof import("firebase-admin/auth");
export type AdminFirestoreModule = typeof import("firebase-admin/firestore");
