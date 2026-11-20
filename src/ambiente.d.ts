/*
 * Constantes do perfil de build (P6-A), definidas pelo `define` do `vite.config.ts` a partir de `config/ambientes.json`.
 * Só valores públicos por desenho.
 */
declare const __FENIX_PERFIL__: 'local' | 'e2e' | 'verificacao' | 'release';

/** Como o cliente fala com o Emulator: `null` sem Emulator; mesma origem no `local`; direto no `e2e`. */
declare const __FENIX_CONEXAO_EMULADOR__:
  | { readonly modo: 'mesma-origem' }
  | { readonly modo: 'direta'; readonly host: string; readonly auth: number; readonly firestore: number; readonly functions: number }
  | null;

/** App Check da produção: só no release e só depois do registro do app (E-02); `null` nos demais casos. */
declare const __FENIX_APP_CHECK__: {
  readonly provedor: 'recaptcha-enterprise';
  readonly siteKey: string;
} | null;

declare const __FENIX_CONFIG_WEB__: {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly storageBucket: string;
  readonly messagingSenderId: string;
  readonly appId: string;
};
