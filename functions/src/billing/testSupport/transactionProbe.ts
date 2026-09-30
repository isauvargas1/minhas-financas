import {AsyncLocalStorage} from "node:async_hooks";

import type * as admin from "firebase-admin";

/**
 * Sonda de transação (somente testes; fora dos exports e do deploy).
 *
 * Marca o contexto assíncrono de todo callback de `runTransaction` do
 * Firestore. O Stripe falso consulta `insideTransaction()` em cada chamada e
 * recusa I/O externo feito de dentro de uma transação (P2A.1): o SDK repete
 * o callback e seguraria a transação durante a chamada externa.
 */
const transactionScope = new AsyncLocalStorage<true>();
let installed = false;

export const insideTransaction = (): boolean =>
  transactionScope.getStore() === true;

type TransactionCallback = (
  transaction: admin.firestore.Transaction,
) => Promise<unknown>;

type RunTransaction = (
  this: admin.firestore.Firestore,
  updateFunction: TransactionCallback,
  options?: unknown,
) => Promise<unknown>;

/** Instala a sonda uma vez por processo de teste. */
export const installTransactionProbe = (
  firestore: admin.firestore.Firestore,
): void => {
  if (installed) return;
  installed = true;
  const prototype = Object.getPrototypeOf(firestore) as {
    runTransaction: RunTransaction;
  };
  const original = prototype.runTransaction;
  prototype.runTransaction = function probedRunTransaction(
    updateFunction,
    options,
  ) {
    return original.call(
      this,
      (transaction) =>
        transactionScope.run(true, () => updateFunction(transaction)),
      options,
    );
  };
};
