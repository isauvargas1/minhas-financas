/**
 * E2E oficial em grupos (P5-F.1-R3.2): a espera pelas portas do Emulator e do frontend entre os grupos, usada pelo
 * executor (`executar-em-grupos.mjs`). Só consulta as portas: nenhum processo é encerrado por aqui. Testada em
 * `tests/tools/e2e-grupos.test.mjs`.
 */
import { createConnection } from 'node:net';

/** A porta tem alguém ouvindo em 127.0.0.1 (a conexão é aceita). Recusa, erro ou 1 s sem resposta: livre. */
export const portInUse = (port) => new Promise((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port });
  const done = (busy) => {
    socket.destroy();
    resolve(busy);
  };
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
  socket.setTimeout(1_000, () => done(false));
});

/** Espera as portas livrarem, sem encerrar processo nenhum; devolve as que continuam em uso no fim do prazo. */
export const waitForFreePorts = async (ports, timeoutMs, pollMs = 500) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const busy = [];
    for (const port of ports) if (await portInUse(port)) busy.push(port);
    if (busy.length === 0 || Date.now() >= deadline) return busy;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
};
