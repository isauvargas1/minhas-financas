import type { ativarAppCheck as ativarDeVerdade } from './appCheck';

/** Perfis sem App Check (Emulator, E2E, verificação e release sem registro): nada é inicializado nem empacotado. */
export const ativarAppCheck: typeof ativarDeVerdade = () => null;
