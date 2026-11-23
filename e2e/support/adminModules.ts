import { createRequire } from 'node:module';
import type {
  AdminAppModule,
  AdminAuthModule,
  AdminFirestoreModule,
} from '../../functions/src/shared/testSupport/e2eAdminTypes';

// Resolve as entradas publicas no pacote functions, usando a mesma instancia
// CommonJS do SDK que functions/lib usa. Nao inicializa app nem acessa dados.
const requireAdmin = createRequire(new URL('../../functions/package.json', import.meta.url));
export const adminApp = requireAdmin('firebase-admin/app') as AdminAppModule;
export const adminAuth = requireAdmin('firebase-admin/auth') as AdminAuthModule;
export const adminFirestore = requireAdmin('firebase-admin/firestore') as AdminFirestoreModule;
