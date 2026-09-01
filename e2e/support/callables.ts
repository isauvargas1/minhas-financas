import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Chamada de callable pelo runtime real das Functions (Etapa 3, §0.B).
 *
 * A Etapa 3 tirou a administração técnica de investimentos da configuração
 * comum: contas e ativos técnicos, semeadura de padrões e o painel operacional
 * continuam íntegros, mas não têm mais ponto de montagem na navegação. Os
 * roteiros de E2E que os dirigiam pela tela deixaram de descrever um caminho
 * executável.
 *
 * Apagá-los reduziria cobertura de verdade, e não só de tela. O defeito que
 * aqueles testes existiam para pegar — `admin.firestore.FieldPath` chegando
 * `undefined` no runtime das Functions, com os testes de integração passando
 * porque chamam as funções exportadas diretamente — só aparece com o runtime
 * no meio. Então o que muda é o gatilho, não a camada: em vez de um clique,
 * uma chamada HTTP ao emulador de Functions, com token real do emulador de
 * Auth, exatamente como o SDK do navegador faria.
 *
 * De quebra, a autoridade passa a ser verificada onde ela mora: um papel sem
 * permissão recebe `permission-denied` do servidor, o que é mais forte do que
 * confirmar que o botão estava escondido.
 */

const PROJECT = 'minhas-financas-local';
const REGION = 'southamerica-east1';
const FUNCTIONS_ORIGIN = 'http://127.0.0.1:5001';
const AUTH_ORIGIN = 'http://127.0.0.1:9099';

export const callableUrl = (name: string): string =>
  `${FUNCTIONS_ORIGIN}/${PROJECT}/${REGION}/${name}`;

/** Token do emulador de Auth para o usuário do teste. */
export const emulatorIdToken = async (
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> => {
  const response = await request.post(
    `${AUTH_ORIGIN}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=e2e-api-key`,
    { data: { email, password, returnSecureToken: true } },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).idToken as string;
};

export interface CallableOutcome {
  status: number;
  result?: Record<string, unknown>;
  errorStatus?: string;
  errorMessage?: string;
}

/** Invoca uma callable com o protocolo do SDK: `{ data: … }` no corpo. */
export const callCallable = async (
  request: APIRequestContext,
  token: string,
  name: string,
  data: Record<string, unknown>,
): Promise<CallableOutcome> => {
  const response = await request.post(callableUrl(name), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: { data },
    timeout: 60_000,
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status(),
    result: body.result as Record<string, unknown> | undefined,
    errorStatus: body.error?.status as string | undefined,
    errorMessage: body.error?.message as string | undefined,
  };
};

/** Identificadores de uma página, no formato que o contrato paginado exige. */
export const pageIds = (correlationId: string) => (page: number) => ({
  idempotencyKey: `${correlationId}-page-${page}`,
  correlationId,
});

/**
 * Repagina uma operação pesada até concluir, como a superfície fazia.
 *
 * `completed` na maioria das operações; `hasMore` nas reconstruções por
 * cursor. Assumir só `completed` faria a repaginação estourar o teto e
 * relatar falha numa execução que já havia terminado.
 */
export const runPagedCallable = async (
  request: APIRequestContext,
  token: string,
  name: string,
  base: Record<string, unknown>,
  correlationId: string,
  maxPages = 40,
): Promise<CallableOutcome> => {
  const ids = pageIds(correlationId);
  let last: CallableOutcome = { status: 0 };
  let carried: Record<string, unknown> = {};
  for (let page = 0; page < maxPages; page += 1) {
    last = await callCallable(request, token, name, { ...base, ...carried, ...ids(page) });
    expect(last.status, `${name} falhou: ${last.errorMessage ?? ''}`).toBe(200);
    const result = last.result ?? {};
    // O lote é escolhido pelo servidor na primeira página e precisa voltar nas
    // seguintes, ou cada página abriria uma execução nova.
    for (const key of ['rebuildId', 'backfillId']) {
      if (typeof result[key] === 'string') carried[key] = result[key];
    }
    if (result.completed === true || result.hasMore === false) break;
  }
  return last;
};
