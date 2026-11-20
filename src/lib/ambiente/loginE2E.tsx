import React from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';

/*
 * Login automatizado do E2E (P6-A, PR-AUTH-04). Só entra no bundle do perfil `e2e`: o `vite.config.ts` aponta o alias
 * `@fenix/login-e2e` para este arquivo nesse perfil e para `loginE2E.vazio.ts` nos outros, inclusive no `local` do
 * `npm run dev`, onde o login é pelo Google do Emulator. A varredura do bundle recusa um build sem Emulator que contenha
 * o marcador, o domínio de teste ou o botão abaixo.
 *
 * As credenciais padrão valem só no Auth Emulator, que cria a conta na primeira entrada; nenhum ambiente remoto as
 * conhece. A spec pode trocá-las por `?e2eEmail=` e `?e2ePassword=`.
 */
export const MARCADOR_LOGIN_E2E = 'fenixgran:login-e2e';
const PROJETO_EMULADOR = 'minhas-financas-local';
const EMAIL_PADRAO = 'e2e-owner@minhas-financas.local';
const SENHA_PADRAO = 'e2e-password-123456';

const codigoDoErro = (error: unknown): string =>
    typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';

const entrarNoModoE2E = async (email = EMAIL_PADRAO, password = SENHA_PADRAO) => {
    if (auth.app.options.projectId !== PROJETO_EMULADOR) {
        throw new Error('Login E2E indisponível fora do Emulator.');
    }

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        const code = codigoDoErro(error);

        if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
            await createUserWithEmailAndPassword(auth, email, password);
            return;
        }

        throw error;
    }
};

const BotaoReal: React.FC = () => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const email = params?.get('e2eEmail') || undefined;
    const password = params?.get('e2ePassword') || undefined;

    return (
        <button
            type="button"
            data-testid="e2e-login-button"
            data-fenixgran={MARCADOR_LOGIN_E2E}
            onClick={() => entrarNoModoE2E(email, password)}
            className="group relative flex w-full justify-center rounded-md border border-indigo-200 bg-white py-3 px-4 text-sm font-medium text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all"
        >
            Entrar em modo E2E
        </button>
    );
};

export const BotaoLoginE2E: React.FC | null = BotaoReal;
