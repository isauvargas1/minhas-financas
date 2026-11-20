import type { conectarEmuladores as conectarNoEmulador } from './emuladores';

/*
 * Substituto de `emuladores.ts` nos perfis sem Emulator (`verificacao` e `release`), pelo alias `@fenix/emuladores` do
 * `vite.config.ts`. A importação acima é só de tipo e some no build: nenhum código de conexão com o Emulator chega ao
 * bundle desses perfis.
 */
export const conectarEmuladores: typeof conectarNoEmulador = () => null;
