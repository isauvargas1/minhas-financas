'use strict';
/**
 * Hook de teste (`node --require`): prova que uma guarda recusou ANTES de
 * carregar o `firebase-admin`.
 *
 * Se qualquer módulo cujo pedido contenha `firebase-admin` for carregado, grava
 * uma marca no arquivo indicado por `TESTE_MARCA_FIREBASE_ADMIN` e encerra com
 * o código 97, sem carregar o SDK.
 */
const fs = require('node:fs');
const Module = require('node:module');

const original = Module._load;
Module._load = function carregar(request, ...resto) {
  if (typeof request === 'string' && request.includes('firebase-admin')) {
    const marca = process.env.TESTE_MARCA_FIREBASE_ADMIN;
    if (marca) fs.writeFileSync(marca, `carregou: ${request}\n`);
    process.exit(97);
  }
  return original.call(this, request, ...resto);
};
