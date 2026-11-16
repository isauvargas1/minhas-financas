# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: work-time-b03.spec.ts >> B03-e: a receita desconsiderada sai da janela da estimativa e volta: o mês antigo só deixa de descontar quando projeção e marca mudam juntas
- Location: e2e/work-time-b03.spec.ts:577:1

# Error details

```
Error: apiRequestContext.post: socket hang up
Call log:
  - → POST http://127.0.0.1:5001/minhas-financas-local/southamerica-east1/createCashAccount
    - user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.96 Safari/537.36
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - Authorization: Bearer <token do Emulator omitido>
    - Content-Type: application/json
    - content-length: 163

```

# Test source

```ts
  1   | import { expect, type APIRequestContext } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * Chamada de callable pelo runtime real das Functions (Etapa 3, §0.B).
  5   |  *
  6   |  * A Etapa 3 tirou a administração técnica de investimentos da configuração
  7   |  * comum: contas e ativos técnicos, semeadura de padrões e o painel operacional
  8   |  * continuam íntegros, mas não têm mais ponto de montagem na navegação. Os
  9   |  * roteiros de E2E que os dirigiam pela tela deixaram de descrever um caminho
  10  |  * executável.
  11  |  *
  12  |  * Apagá-los reduziria cobertura de verdade, e não só de tela. O defeito que
  13  |  * aqueles testes existiam para pegar — `admin.firestore.FieldPath` chegando
  14  |  * `undefined` no runtime das Functions, com os testes de integração passando
  15  |  * porque chamam as funções exportadas diretamente — só aparece com o runtime
  16  |  * no meio. Então o que muda é o gatilho, não a camada: em vez de um clique,
  17  |  * uma chamada HTTP ao emulador de Functions, com token real do emulador de
  18  |  * Auth, exatamente como o SDK do navegador faria.
  19  |  *
  20  |  * De quebra, a autoridade passa a ser verificada onde ela mora: um papel sem
  21  |  * permissão recebe `permission-denied` do servidor, o que é mais forte do que
  22  |  * confirmar que o botão estava escondido.
  23  |  */
  24  | 
  25  | const PROJECT = 'minhas-financas-local';
  26  | const REGION = 'southamerica-east1';
  27  | const FUNCTIONS_ORIGIN = 'http://127.0.0.1:5001';
  28  | const AUTH_ORIGIN = 'http://127.0.0.1:9099';
  29  | 
  30  | export const callableUrl = (name: string): string =>
  31  |   `${FUNCTIONS_ORIGIN}/${PROJECT}/${REGION}/${name}`;
  32  | 
  33  | /** Token do emulador de Auth para o usuário do teste. */
  34  | export const emulatorIdToken = async (
  35  |   request: APIRequestContext,
  36  |   email: string,
  37  |   password: string,
  38  | ): Promise<string> => {
  39  |   const response = await request.post(
  40  |     `${AUTH_ORIGIN}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=e2e-api-key`,
  41  |     { data: { email, password, returnSecureToken: true } },
  42  |   );
  43  |   expect(response.ok(), await response.text()).toBeTruthy();
  44  |   return (await response.json()).idToken as string;
  45  | };
  46  | 
  47  | export interface CallableOutcome {
  48  |   status: number;
  49  |   result?: Record<string, unknown>;
  50  |   errorStatus?: string;
  51  |   errorMessage?: string;
  52  | }
  53  | 
  54  | /** Invoca uma callable com o protocolo do SDK: `{ data: … }` no corpo. */
  55  | export const callCallable = async (
  56  |   request: APIRequestContext,
  57  |   token: string,
  58  |   name: string,
  59  |   data: Record<string, unknown>,
  60  | ): Promise<CallableOutcome> => {
> 61  |   const response = await request.post(callableUrl(name), {
      |                                  ^ Error: apiRequestContext.post: socket hang up
  62  |     headers: {
  63  |       Authorization: `Bearer ${token}`,
  64  |       'Content-Type': 'application/json',
  65  |     },
  66  |     data: { data },
  67  |     timeout: 60_000,
  68  |   });
  69  |   const body = await response.json().catch(() => ({}));
  70  |   return {
  71  |     status: response.status(),
  72  |     result: body.result as Record<string, unknown> | undefined,
  73  |     errorStatus: body.error?.status as string | undefined,
  74  |     errorMessage: body.error?.message as string | undefined,
  75  |   };
  76  | };
  77  | 
  78  | /** Identificadores de uma página, no formato que o contrato paginado exige. */
  79  | export const pageIds = (correlationId: string) => (page: number) => ({
  80  |   idempotencyKey: `${correlationId}-page-${page}`,
  81  |   correlationId,
  82  | });
  83  | 
  84  | /**
  85  |  * Repagina uma operação pesada até concluir, como a superfície fazia.
  86  |  *
  87  |  * `completed` na maioria das operações; `hasMore` nas reconstruções por
  88  |  * cursor. Assumir só `completed` faria a repaginação estourar o teto e
  89  |  * relatar falha numa execução que já havia terminado.
  90  |  */
  91  | export const runPagedCallable = async (
  92  |   request: APIRequestContext,
  93  |   token: string,
  94  |   name: string,
  95  |   base: Record<string, unknown>,
  96  |   correlationId: string,
  97  |   maxPages = 40,
  98  | ): Promise<CallableOutcome> => {
  99  |   const ids = pageIds(correlationId);
  100 |   let last: CallableOutcome = { status: 0 };
  101 |   let carried: Record<string, unknown> = {};
  102 |   for (let page = 0; page < maxPages; page += 1) {
  103 |     last = await callCallable(request, token, name, { ...base, ...carried, ...ids(page) });
  104 |     expect(last.status, `${name} falhou: ${last.errorMessage ?? ''}`).toBe(200);
  105 |     const result = last.result ?? {};
  106 |     // O lote é escolhido pelo servidor na primeira página e precisa voltar nas
  107 |     // seguintes, ou cada página abriria uma execução nova.
  108 |     for (const key of ['rebuildId', 'backfillId']) {
  109 |       if (typeof result[key] === 'string') carried[key] = result[key];
  110 |     }
  111 |     if (result.completed === true || result.hasMore === false) break;
  112 |   }
  113 |   return last;
  114 | };
  115 | 
```