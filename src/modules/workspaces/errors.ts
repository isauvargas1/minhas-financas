import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';

import { auth } from '../../lib/firebase';
import { callableErrorReason } from './errorMessages.ts';

// Parte pura (sem SDK), testável em `tests/unit`.
export { callableErrorReason, workspaceErrorMessage } from './errorMessages.ts';

/**
 * Operações irreversíveis (transferência de titularidade, arquivamento)
 * exigem login recente (D-06). Quando o backend pede, reautentica com o
 * Google e repete a chamada uma única vez.
 */
export const withRecentLogin = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (callableErrorReason(error) !== 'recent_login_required' || !auth.currentUser) {
      throw error;
    }
    await reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider());
    return operation();
  }
};
