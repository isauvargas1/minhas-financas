import type { FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';

/**
 * App Check da produção (PR-APPCHK-01). Só entra no bundle do release com `producao.appCheck` registrado em
 * `config/ambientes.json` (alias `@fenix/app-check` do `vite.config.ts`). A chave de site é pública por desenho.
 * Os tokens passam a acompanhar as chamadas; o enforcement é ligado no servidor e no console, depois do período de
 * monitoramento (D-33).
 */
export const ativarAppCheck = (app: FirebaseApp, config: typeof __FENIX_APP_CHECK__): AppCheck | null => {
  if (!config) return null;
  return initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(config.siteKey),
    isTokenAutoRefreshEnabled: true,
  });
};
