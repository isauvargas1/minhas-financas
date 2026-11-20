import type { BotaoLoginE2E as BotaoDoE2E } from './loginE2E';

/*
 * Substituto de `loginE2E.tsx` fora do perfil `e2e`, pelo alias `@fenix/login-e2e` do `vite.config.ts`. A importação
 * acima é só de tipo e some no build: o botão, as credenciais do Emulator e o login automatizado não chegam ao bundle.
 */
export const BotaoLoginE2E: typeof BotaoDoE2E = null;
