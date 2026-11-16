VEREDITO: FAIL

# Parecer independente — estabilidade do processo de testes (Frente B), P5-F.1-R3.2

Revisor: estabilidade do processo (RR-R31-07 e RR-R31-08) e `firebase-production-readiness` no escopo da etapa.
Data: 2026-11-11. Pasta: `p5f1r32/revisoes/estabilidade/` (logs em `logs/`, roteiros em `ka/`).

## Conclusão

- **O desenho e o código da Frente B estão corretos.**
  - As duas causas do RR-R31-07 estão confirmadas no código instalado e nas evidências de antes e depois: a JVM órfã pelo SIGKILL do Playwright 1.60 e o emulador de Functions com um processo por função.
  - O `gracefulShutdown` elimina a limpeza externa.
  - O executor confere cada teste da lista, uma vez, numa tentativa, passando.
  - `retries: 0` e `forbidOnly` também no CI; nenhum teste ignorado, nenhuma asserção ou prazo existente alterado; nada alcança produção.
  - No diff, só achados LOW e INFO (EST-01 a EST-09).
- **FAIL por dois motivos.**
  - Falta a evidência central: as duas execuções oficiais do `verify:all` na árvore sob revisão foram interrompidas de fora, e o E2E oficial em grupos nunca completou de ponta a ponta com a suíte real (3.5).
  - A `verify-all-r32-2` mostrou um MEDIUM de processo, anterior à etapa (EST-10): um SIGINT cortou a integração no meio, o `firebase emulators:exec` saiu com 0 e o `verify:all` seguiu. A saída 0 sozinha não prova o gate.
- **Para virar PASS:**
  - uma execução completa e ininterrupta do `verify:all` na `93668199`, com saída 0 e conferida por contagem: unidade 1.784; a integração e as 19 suítes de Rules até o fim, sem "Received SIGINT/SIGTERM" na fase de integração; "[e2e em grupos] ok: 217 testes, cada um uma vez, todos passaram"; portas livres entre os grupos e no fim; `limpeza_externa=nenhuma`;
  - o EST-10 tratado, ao menos pela conferência por contagem no gate.
- **RR-R31-08.** "Não comprovada" é a conclusão sustentada. Sem mitigação, é aceitável só como risco aceito explicitamente pelo gate; há uma mitigação barata, só no harness (EST-03).
- **Skill.** `FAIL — Firebase production readiness`, no escopo, pelos mesmos dois motivos (seção 5).

## 1. Escopo conferido

- **Árvores.** Base R3.1 `efcbd2645b8e7b08b5add2812f6b319f4a76369b`. Árvore sob revisão **`93668199c4d5a57a41308dd08383afd7c2245b00`**, por atualização do coordenador durante a revisão (`6d28cf98` → `ca11baca` → `93668199`). Conferi que, entre `6d28cf98` e `93668199`, os arquivos da Frente B (`tools/e2e/*`, `tests/tools/e2e-grupos.test.mjs`, `package.json`, `.github/workflows/quality-gate.yml`, `firebase.json`) são idênticos, e que só mudaram: `e2e/work-time-p5f.spec.ts` (Frente A), um comentário do `playwright.config.ts:39` (o caminho inexistente `scripts/e2e-shards.mjs` virou `tools/e2e/executar-em-grupos.mjs`), `README.md` e `docs/production/RUNBOOKS.md` (`logs/diff-6d28-ca11.txt`, `logs/diff-ca11-9366-codigo.txt`, `logs/diff-r31-9366-runbooks.txt`). Minhas cópias foram extraídas com `git archive` da árvore, e nenhum arquivo do worktree foi alterado. No início, rodei uma vez `git status --short` no worktree: o git pode regravar o cache de stat do índice, sem mudar o que está nele. Depois, só `GIT_OPTIONAL_LOCKS=0`. O HEAD continua `1730a1df`.
- **Lidos por inteiro:** `tools/e2e/grupos.mjs`, `tools/e2e/executar-em-grupos.mjs`, `tests/tools/e2e-grupos.test.mjs`, `playwright.config.ts`, `.github/workflows/quality-gate.yml`, os diffs de `package.json`, `playwright.config.ts`, CI, `e2e/` e `RUNBOOKS.md` contra a R3.1, RB-01/04/05/08/09 do RUNBOOKS, a linha do `test:e2e` no README, `e2e/support/callables.ts` e o `clearEmulatorData` de `e2e/support/workspaceSeed.ts`.
- **Código instalado** (trechos e linhas em `logs/codigo-instalado.txt`): Playwright 1.60.0 (`node_modules/playwright*`), firebase-tools 15.32.1 (`/opt/node22/lib/node_modules/firebase-tools/`), Node v22.23.4.
- **Evidências do executor:** os `.meta` e logs dos E2E da R3.2, os scripts e resultados `keepalive-*` (E1, E1b, E2, E3a timers e check, E3b, E3c, E3d, E3e, E3h), `mutantes-grupos-r32*.log`, `tools-e2e-1.log`, `lista-suite.json`; da R3.1, `testes-e-resultados.md`, `saidas/e2e-grupos*` e `p5f1r31/logs/emulator-cleanup.log`.
- **Execuções oficiais:**
  - `verify-all-r32-1`: interrompida pelo executor no build do `verify:fast`, saída 143, sem resultado de teste; não conta;
  - `verify-all-r32-2`, na árvore `93668199`: interrompida por SIGINT externo na integração e de novo no grupo 1 do E2E, saída 130; não conta como resultado (3.5);
  - nenhuma execução oficial completa até a entrega deste parecer, às 14:35Z;
  - `e2e-p5f-r32-1`: inválida por erro do executor (build de produção reaproveitado), mas é evidência do órfão por SIGTERM (EST-02).

## 2. Comandos executados e resultados

Nada aqui rodou Emulator, Playwright, E2E, `npm run verify:*` ou `test:integration*`, nem abriu as portas 4000, 4400, 4500, 5001, 8080, 9099, 9150, 9299, 9499 ou 5173. Os experimentos sortearam portas efêmeras e conferiram que não eram da lista. Nada de produção nem de segredos.

| # | Comando (na minha cópia) | Resultado | Log |
| --- | --- | --- | --- |
| C1 | `node --test tests/tools/e2e-grupos.test.mjs` (cópia de `6d28cf98`) | 9/9 | `logs/tools-e2e-revisor-1.log` |
| C2 | o mesmo na cópia de `93668199` | 9/9 | `logs/tools-e2e-revisor-9366.log` |
| C3 | `testsOfReport` do próprio executor sobre `lista-suite.json` | 217 testes, 36 arquivos, 217 chaves distintas; nenhuma anotação; nenhum `expectedStatus` diferente de `passed`; config `retries [0]`, `forbidOnly true`, `workers 1` | `logs/contar-lista.out` |
| C4 | réplica do `filterForShard` do Playwright 1.60 (`runner/index.js:2309`), um grupo por arquivo | N=3: grupos de **83, 64 e 70** testes (16, 9 e 11 arquivos) | `logs/simular-shards.out` |
| C5 | sonda E3h do executor refeita com `NODE_DEBUG=http` (servidor Node local) | o agente descarta o soquete livre com FIN pendente: "PENDING DATA on FREE socket - destroying poisoned socket" | `logs/e3h-revisor-debug.log` |
| C6 | `ka/exp-portas.mjs` (executor real com `npm`/`npx` falsos), caso A: porta ocupada antes | saída 1 em 60 s, nenhum grupo chamado, "portas em uso antes do primeiro grupo", nenhum processo encerrado | `logs/exp-portas-A.log` |
| C7 | caso B: o último grupo deixa um processo destacado na porta | saída 1 com 2/2 testes passando: "portas ainda em uso depois do grupo 2" | `logs/exp-portas-B.log` |
| C8 | caso C: o processo sai sozinho em 10 s | espera e segue; saída 0 | `logs/exp-portas-C.log` |
| C9 | `ka/mutantes-portas.py` (cópia separada, restauração conferida por SHA-256) | P01–P04 **sobrevivem** à suíte oficial e são mortos por C6–C8 (EST-01). A 1ª rodada do roteiro teve erro meu de caminho, sem efeito na cópia; vale a 2ª, a do log | `logs/mutantes-portas-revisor.log` |
| C10 | resumo e taxas dos resultados keep-alive | ver 3.4 | `logs/keepalive-resumo-revisor.txt`, `logs/keepalive-taxa-revisor.txt` |
| C11 | leitura do código instalado (`grep -n`) | ver 3.1–3.4 | `logs/codigo-instalado.txt`, `logs/emulators-exec-sigint.txt` |
| C12 | análise dos logs da `verify-all-r32-2` (somas dos resumos do `node --test`; `ka/memoria-segmentos.mjs` sobre a amostragem de memória) | ver 3.5 e EST-10 | `logs/verify-all-r32-2.limpo.log`, `logs/verify-all-r32-2-memoria-segmentos.txt` |

## 3. Conferência dos itens do pedido

### 3.1 Causas do RR-R31-07

**(a) JVM do Firestore órfã — confirmada, e a correção também.**
- No Playwright 1.60, o `webServer` é lançado como líder de um grupo de processos (`playwright-core/lib/coreBundle.js:8608`, `detached`). No fim, `gracefullyClose` chama `attemptToGracefullyClose().catch(() => killProcess())` (`:8678`). Sem `gracefulShutdown`, a tentativa lança "skip graceful shutdown" (`playwright/lib/runner/index.js:844`) e o grupo recebe SIGKILL (`coreBundle.js:8698`). Com ele, o sinal vai ao grupo (`index.js:846`) e o Playwright espera o `close` até o prazo (`:848-849`); vencido, volta ao SIGKILL.
- No firebase-tools 15.32.1, os emuladores com binário próprio sobem com `detached: true` (`emulator/downloadableEmulators.js:334`), fora do grupo do `webServer`. Com `--only auth,firestore,functions`, é só a JVM do Firestore; UI, Auth, Functions, hub, logging, Eventarc e Tasks rodam no processo do CLI (a UI é um app Express, `emulator/ui.js:27-53`). Só param pelo `stop()` (SIGINT, até 4 s; `:426`, `:31`), chamado no `cleanShutdown` quando o CLI recebe SIGINT, SIGTERM, SIGHUP ou SIGQUIT (`emulator/commandUtils.js:223`, `:184`). Com SIGKILL, o CLI morre sem `cleanShutdown` e a JVM fica na 8080.
- **Antes (R3.1, sem `gracefulShutdown`).** `p5f1r31/logs/emulator-cleanup.log` registra uma JVM `cloud-firestore-emulator-v1.22.0.jar` na 8080 depois de **cada** execução do Playwright, encerrada de fora: grupos às 00:16:35, 00:21:27 e 00:32:10, e cada `verify:all`.
- **Depois (R3.2).** `e2e-b03-r32-1`, `e2e-b03g-r32-2`, `e2e-b03g-na-r31-vermelho` e `e2e-p5f-r32-2` terminam com `portas_ocupadas_no_fim=[]`, `java_no_fim=0` e `limpeza_externa=nenhuma`. A `verify-all-r32-2`, interrompida por SIGINT no grupo 1, também (3.5). Os logs mostram "Received SIGTERM for the first time. Starting a clean shutdown." e a parada, em ordem, de UI, Functions, Firestore, Auth, Eventarc, Tasks, hub e logging.
- O firebase-tools trata um **segundo** sinal como "pular o desligamento limpo" (`commandUtils.js:187`). O Playwright manda um só, ao grupo. Correto.
- **Lado não coberto:** SIGTERM no processo do Playwright (e não no `webServer`) deixa tudo de pé, porque o processo principal do Playwright 1.60 só trata SIGINT (`index.js:5603`). Evidência: `e2e-p5f-r32-1.meta`, saída 143, as 10 portas ocupadas, uma JVM, `limpeza_externa=2` (EST-02).

**(b) Memória do emulador de Functions — confirmada; o isolamento limita, não remove.**
- `RuntimeWorkerPool.getKey` devolve o `triggerId` (`emulator/functionsRuntimeWorker.js:240`): um processo por função. Os ociosos só saem em `refresh()` (recarga do código, `:246`) e em `exit()` (`:257`), sem prazo de ociosidade.
- R3.1, sessão única: 97 a 104 processos `node`, 13,2 a 14,4 GB, OOM do `chrome-headless` e partida a frio de 9 a 12 s. R3.1 em grupos manuais (68/70/78): picos de 8.897 MiB (59 `node`), 6.894 MiB (44) e 10.777 MiB (74), com queda para 0,9 a 1,9 GB entre grupos (`saidas/e2e-grupos-memoria.txt`). O isolamento funciona.
- O pico de um grupo ainda chega perto de 11 GB num contêiner de 16 GB. Os grupos oficiais (C4: 83/64/70) não são os validados na R3.1 (EST-06), e a capacidade do runner do CI é desconhecida (EST-05).

### 3.2 Fluxo oficial

- `package.json:44`: `test:e2e` = `npm run build:e2e && node tools/e2e/executar-em-grupos.mjs`. `:55`: o `verify:all` termina em `npm run test:e2e`. `:54`: o `verify:fast` inclui `test:tools:e2e` (`:48`).
- Executor (`tools/e2e/executar-em-grupos.mjs`), confirmado no código e em C6–C8:
  - build das Functions;
  - lista com `--list --reporter=json` e `E2E_SHARD_REPORT=''`. No Playwright 1.60, o modo lista só carrega e reporta (`index.js:6470`): não sobe `webServer` nem apaga a saída;
  - grupos `--shard=i/N`, em sequência, com `--output=test-results/grupo-i`, relatório JSON próprio e `PLAYWRIGHT_HTML_OUTPUT_DIR`, variável aceita no 1.60 (`index.js:3324`);
  - espera das 10 portas antes do 1º grupo e depois de cada um, por até 60 s, sem encerrar processo (`:111-112`, `:135-139`);
  - `firebase-debug.log` e `firestore-debug.log` apagados antes e copiados depois de cada grupo;
  - conferência contra a lista completa (`grupos.mjs:72-100`): não rodou, repetido, fora da lista, resultado diferente de `expected`, tentativas diferentes de `["passed"]`, grupo sem relatório. Grupo com saída diferente de 0, ou porta presa, dá saída 1 (`:146`).
- Cobertura: cada grupo de teste do Playwright (o arquivo, com `fullyParallel: false`) cai em exatamente um shard, pelo índice do 1º teste (`index.js:2309-2333`). Shard vazio não reprova, porque com `--shard` o "No tests found" é suprimido (`:6003`), mas também não abre lacuna, porque a conferência é pela lista. No início de cada grupo só os `outputDir` dos projetos são apagados (`createRemoveOutputDirsTask`, `index.js:5919`), então `test-results/e2e-grupos/` sobrevive.
- No CI, o repórter HTML nunca abre servidor (`index.js:3304`) e não trava o executor numa falha.
- CI: `test:tools:e2e` no job de unidade (`quality-gate.yml:116-117`); `npm run test:e2e` no job E2E (`:211-212`); `firebase-tools@15.32.1` nos dois jobs com Emulator (`:148`, `:188`); `playwright-report/` e `test-results/` como artefato na falha (`:214-222`).
- Testes do executor: 9/9 (C1, C2). O `tools-e2e-1.log` do executor (12:35, 6 testes) é anterior à versão final do arquivo (9 testes). Mutantes do executor: 25/26; o X03 sobrevivente é equivalente (a quebra do laço só acontece com porta presa, que já reprova pela linha "ainda em uso", e os grupos não rodados viram "não rodou"). Meus 4 mutantes do caminho de portas sobrevivem à suíte (EST-01).

### 3.3 Exigências do pedido

- **Todos os testes preservados.** A lista tem 217 testes: os 216 da R3.1 e o B03-g, em 36 arquivos (C3). No diff de `e2e/` contra a R3.1 só mudam `work-time-b03.spec.ts` (o B03-g, novo) e `work-time-p5f.spec.ts` (um teste reescrito da Frente A; o mérito da asserção cabe à revisão financeira).
- **Nenhum teste ignorado.** Zero `test.skip(`, `test.fixme(`, `test.fail(`, `test.slow(` e `.only(` na R3.1 e na R3.2. A lista não tem anotação. `forbidOnly: true` (`playwright.config.ts:58`; antes, o padrão `false`). O executor reprova `skipped`.
- **Sem nova tentativa.** `retries: 0` também no CI (`:57`; antes, `process.env.CI ? 2 : 0`). O executor reprova `flaky` e mais de uma tentativa, inclusive duas que passaram, e recusa `--last-failed`.
- **Sem aumento de prazo.** `timeout` 45 s, `expect` 12 s e os prazos dos `webServer` (180 s e 300 s) não mudaram. Nenhum prazo de teste existente mudou. As únicas linhas novas de prazo no diff de `e2e/` são do B03-g, no padrão dos B03 existentes (300 a 360 s por teste e 60 s nas esperas); o teste reescrito do p5f mantém 240 s e 30 s. O prazo do `gracefulShutdown` (60 s) e a espera de portas (60 s) são de desligamento e de infraestrutura, fora das asserções.
- **Mesmo ambiente lógico.** Mesma configuração, mesmo build e mesmo projeto. A diferença intencional: cada grupo começa com um Emulator novo, e dentro do grupo a ordem é a mesma. Nenhum spec depende de dados de outro arquivo (EST-07). No CI, o rastro passou de `on-first-retry`, que nunca dispararia sem nova tentativa, a `retain-on-failure` (`:69`): só artefato, mas grava rastro de todos os testes no CI (EST-05).
- **Sem regra de negócio na Frente B.** Os arquivos da Frente B não tocam `src/`, `functions/src`, Rules nem índices.
- **Sem produção.** O executor só chama `npm --prefix functions run build` e `npx playwright test`. O Emulator sobe com `--project minhas-financas-local` (`playwright.config.ts:86`), e o build com `VITE_FIREBASE_PROJECT_ID=minhas-financas-local` (`package.json:43`). O teste da fiação proíbe o ID de produção no config (`e2e-grupos.test.mjs:128`). O `.firebaserc` com `default` de produção é anterior (PR-PLAT-01) e não é alcançado pelo fluxo, porque todo comando passa `--project`.

### 3.4 RR-R31-08 (keep-alive)

**Premissas do executor, confirmadas no código instalado:**
- o `APIRequestContext` usa `new HttpHappyEyeballsAgent({ keepAlive: true })` (`coreBundle.js:7946`) quando não há proxy (`:25944`);
- no Node 22.23.4, `keepSocketAlive` só encurta o prazo pelo aviso `Keep-Alive: timeout=5` se o agente tiver `timeout` (`agentTimeout = this.options.timeout || 0` e `serverHintTimeout < agentTimeout`). Com 0, o aviso é ignorado;
- o servidor do Node 22.23.4 tem `keepAliveTimeout` 5000 e `keepAliveTimeoutBuffer` 1000; o emulador real fecha a conexão ociosa em 6.001 a 6.002 ms (E3e).

**Avaliação dos experimentos:**
- **E1 e E2 têm falha de desenho, superada depois.** E1 (servidor puro) e E2 (emulador real, sem e com carga) amostram densamente 4.980 a 5.020 ms, pelos 5 s anunciados, mas o fechamento real é em cerca de 6,0 s. Em E2 nenhum par chega à janela; em E1, só três pares tocam 6.000 ms. Esses "0 falhas" não testam a corrida. E3a a E3c corrigem a faixa (4 a 6 s e 5,6 a 6,1 s).
- **E3a-check reproduz 3/80 (`read ECONNRESET`)** com o laço do servidor ocupado na fase check, e dá 0/80 com `Connection: close`. E3a-timers dá 0/80. O mecanismo: o pedido chega durante a ocupação; na volta seguinte, os temporizadores rodam antes da leitura, e o keep-alive vencido destrói o soquete com dado não lido, o que gera RST.
- **No emulador real, E3b (40 pares, 4 a 6 s) e E3c (60 pares, 5,6 a 6,1 s) dão 0 falhas**, com a mesma ocupação injetada no processo do CLI. A latência máxima de 295 e 307 ms prova que a ocupação estava ativa. Na sub-janela das falhas de E3a (5.850 a 6.000 ms), E3a teve 3/18, e E3b com E3c tiveram 0/21. Com a taxa de E3a, a chance de 0 em 21 é de cerca de 2%; em 5.700 a 6.100 ms, 0 em 53, cerca de 0,9% (C10). A não reprodução no emulador real é um dado, não um acaso provável.
- **E3d e E3h (cliente ocupado na hora do fechamento) dão 0 falhas.** C5 explica: o agente do Node 22.23 descarta o soquete livre que já tem o FIN pendente e abre outro. Essa variante está mitigada pelo próprio Node.
- **O sintoma original não é o que se reproduziu.** O `verify-all-3` da R3.1 falhou com `socket hang up` (FIN sem resposta). O que se reproduziu foi o RST (`ECONNRESET`). A variante FIN precisa do fechamento pelo servidor entre a escolha do soquete pelo cliente e a chegada do pedido. Essa janela é de microssegundos em repouso e cresce com contenção de CPU (naquele instante havia 97 processos `node` e 13,2 GB em uso). Não houve experimento para ela, nem com Node 24 (o job E2E do CI roda Node 24, `quality-gate.yml:168`), nem contra o Auth (9099), que o `emulatorIdToken` também chama pelo mesmo agente.

**Conclusão.** "NÃO comprovada" é a conclusão correta e está sustentada pelos dados de E3a a E3h. As lacunas acima não a mudam, mas impedem afirmar que a corrida não ocorre no emulador.

Deixar sem mitigação é aceitável só como risco residual explícito. Uma ocorrência derruba a execução oficial de forma visível (`retries: 0` e a conferência do executor), então não há PASS falso; o custo é CI vermelho intermitente. Mas o plano da R3.1 (RR-R31-07, "O que fazer") pedia que o preparo pela API fosse protegido do RR-R31-08 antes de o CI e o gate dependerem do `verify:all`. A R3.2 faz o CI depender dele sem essa proteção (EST-03).

### 3.5 Execução oficial (`verify-all-r32-2`): memória e processos

Árvore `93668199`, firebase-tools 15.32.1, Node v22.23.4, Java 21.0.12.1; de 14:07:11 a 14:30:26Z, **saída 130 (SIGINT), em 1.390 s**. Não é resultado. Log sem cores em `logs/verify-all-r32-2.limpo.log`; segmentos de memória em `logs/verify-all-r32-2-memoria-segmentos.txt`.

- **`verify:fast`: completo.** 1.784 testes de unidade, 1.784 aprovados, 0 falhas, 0 pulados (soma dos resumos do `node --test`); lint com 0 erro e 201 avisos; `test:tools:e2e` 9/9.
- **`test:integration:emulator`: interrompido por um SIGINT externo**, que não partiu desta revisão. Depois do `ok 867` da integração das Functions (linha 25744 do log sem cores) vem "Received SIGINT (Ctrl-C) for the first time. Starting a clean shutdown." (25750). Nenhuma das suítes de Rules começou. **O script saiu com 0 e o `verify:all` seguiu para o `test:e2e`** (25760). É o EST-10.
- **`test:e2e`: o executor oficial começou** (build E2E, "217 testes em 36 arquivos, em 3 grupo(s)", grupo 1 de 3). No grupo 1, 13 testes passaram até um segundo SIGINT externo, por volta das 14:30:20.
  - O Playwright tratou o sinal: 1 teste `interrupted` (`ai-consent-extraction.spec.ts:718`, 161 ms) e 69 que não rodaram.
  - O teardown desligou o Emulator com o `gracefulShutdown`: "Received SIGTERM for the first time", e a parada de todos os emuladores.
  - O executor morreu com o sinal, sem resumo.
  - No fim, `portas_ocupadas_no_fim=[]`, `java_no_fim=0` e `limpeza_externa=nenhuma`.
  - Os dois "Request to function failed: Error: socket hang up" aparecem em "Waiting for all functions to finish...", já no desligamento: pedidos do teste interrompido, não do preparo. Não são o RR-R31-08.
- **Memória.** Na integração, pico de 2.637 MiB, até 9 processos `node` e 1 `java`. No grupo 1, das 14:29:15 às 14:30:16, com só 13 testes, pico de 4.635 MiB, 24 processos `node` e 1 `java`. Não há dados dos grupos 2 e 3, nem de uma passagem entre grupos.
- **Conclusão.** As duas execuções oficiais na árvore sob revisão foram interrompidas de fora (a `r32-1` no build, a `r32-2` na integração e no E2E). O E2E oficial em grupos nunca completou de ponta a ponta com a suíte real, os três grupos, a espera de portas entre eles e a conferência pela lista. Os itens 2 e 5 do pedido ficam sem a evidência real.
- **O que a `r32-2` comprova.** SIGINT ao grupo de processos leva ao desligamento limpo, sem órfão; com SIGTERM, o Emulator fica órfão (`e2e-p5f-r32-1`, EST-02). E um sinal na etapa do `emulators:exec` vira saída 0 (EST-10).

## 4. Achados

Nenhum HIGH. Um MEDIUM de processo, anterior ao diff mas evidenciado na execução oficial (EST-10). No diff da Frente B, só LOW e INFO, e nenhum deles leva a PASS falso: o fluxo falha fechado ou a falha aparece.

**EST-10 — MEDIUM (processo; anterior à etapa, evidenciado na `verify-all-r32-2`). A saída 0 do `verify:all` não prova que a integração e as Rules terminaram.**
- Onde: o `test:integration:emulator` (`package.json`), que encadeia 22 scripts dentro de um único `firebase emulators:exec`. No firebase-tools 15.32.1, a ação do `exec` é `Promise.race([shutdownWhenKilled(options), emulatorExec(script, options)])` (`lib/commands/emulators-exec.js:18`). No primeiro SIGINT, SIGTERM, SIGHUP ou SIGQUIT, `processKillSignal` faz o `cleanShutdown` e resolve a corrida com sucesso (`lib/emulator/commandUtils.js:164-213`), e a conferência do código de saída do script (`:317`) não chega a rodar.
- Cenário e evidência: um SIGINT externo cortou a integração das Functions depois do `ok 867`. Nenhuma suíte de Rules começou, o `test:integration:emulator` saiu com 0 e o `verify:all` seguiu para o `test:e2e` (`logs/emulators-exec-sigint.txt`). Só o segundo SIGINT, no E2E, parou tudo, porque o Playwright e o executor não transformam o sinal em sucesso.
- Impacto: um `verify:all` com saída 0 pode esconder integração e Rules incompletas, se a interrupção cair na etapa do Emulator (um Ctrl-C que o operador acha que abortou, um supervisor ou um `kill` dirigido ao CLI). A R3.2 deu ao E2E a conferência pela lista, mas a integração ainda depende só do código de saída. Fora do escopo, e não verificado em execução: o mesmo mecanismo vale para `predeploy:rules` em `deploy:firestore` (`predeploy:rules && firebase deploy`). Um sinal no meio das Rules pode deixar o deploy seguir (P6, PR-REL-01; agentes não executam deploy).
- Correção sugerida:
  - no gate, já: não aceitar o `verify:all` só pelo código de saída. Conferir as contagens por script, como fez o gate da R3.1 ("as contagens dos 40 scripts"), e a ausência de "Received SIGINT/SIGTERM" na fase de integração;
  - no projeto: tornar a etapa à prova de interrupção. Por exemplo, a cadeia dentro do `exec` termina gravando um marcador, que o script npm apaga antes e exige depois do `exec`; ou um pequeno executor que confira os resumos do `node --test`, como o do E2E. O mesmo para o `predeploy:rules`.

**EST-01 — LOW. O caminho de portas do executor não tem teste.**
- Onde: `tools/e2e/executar-em-grupos.mjs:33` (`PORT_WAIT_MS`), `:111-112` (porta presa antes), `:135-139` (porta presa depois do grupo), `:146` (a linha "ainda em uso" na decisão). Em `tests/tools/e2e-grupos.test.mjs:175-213`, o roteiro do executor usa `E2E_START_EMULATORS=false` e uma porta livre: nenhum teste ocupa porta.
- Cenário: quatro mutantes, P01 (ignora porta presa depois do grupo), P02 (ignora porta presa antes), P03 (tira "ainda em uso" da decisão) e P04 (espera de 0 s), passam na suíte oficial e no CI. C6 a C8 matam os quatro (C9). Os 26 mutantes do executor não cobrem esse caminho.
- Impacto: é a condição que torna visível a falha do RR-R31-07, um Emulator que não desligou. RB-04 e o cabeçalho do executor a dão como critério de reprovação, e uma regressão nela passaria despercebida. Com P01 ou P03, a JVM órfã depois do último grupo só apareceria na execução seguinte. Os resultados dos testes continuam conferidos.
- Correção sugerida: em `e2e-grupos.test.mjs`, três casos com um ouvinte em `E2E_PORT`:
  - a porta ocupada antes: saída 1, nenhum grupo chamado;
  - um processo destacado deixado pelo falso `npx` no último grupo: saída 1 com "ainda em uso";
  - um processo que sai em poucos segundos: saída 0.

  Para o teste não esperar 60 s, o prazo pode vir de uma variável só de teste, com teto. Somar P01 a P04 ao `mutantes-grupos-r32.py`.

**EST-02 — LOW. Interrompido por SIGTERM, o fluxo oficial deixa o Emulator do grupo de pé.**
- Onde: o executor lança o Playwright sem repassar sinais (`executar-em-grupos.mjs:60-64`) e não trata SIGTERM. O processo principal do Playwright 1.60 só trata SIGINT (`playwright/lib/runner/index.js:5603`), e os `webServer` são grupos destacados (`coreBundle.js:8608`).
- Cenário e evidência: `timeout`, `kill` ou um supervisor manda SIGTERM durante um grupo. O Playwright morre sem o teardown, e o CLI do firebase-tools (com a UI e os emuladores internos), a JVM e o `vite preview` continuam. É o que mostra `e2e-p5f-r32-1.meta`: saída 143, as 10 portas ocupadas, `java_no_fim=1` e limpeza por identidade.
- Impacto: localmente, a execução seguinte falha fechado ("portas em uso antes do primeiro grupo") e pede limpeza manual (`npm run e2e:kill-ports`, com `kill -9`). No CI, a máquina é descartada. Não há PASS falso.
- Correção sugerida: no executor, tratar SIGTERM, SIGINT e SIGHUP repassando SIGINT ao filho. O SIGINT é o sinal que o Playwright trata, e o teardown dele já desliga o Emulator com o `gracefulShutdown`. Esperar o filho com prazo, sair com código diferente de 0 e registrar em RB-04 e RB-09 o que fazer depois de uma interrupção.

**EST-03 — LOW (decisão do gate). RR-R31-08 segue aberto e sem mitigação, embora a R3.1 a tenha posto como condição.**
- Onde: as chamadas de preparo pelo `APIRequestContext`, que usam o agente com keep-alive sem prazo (`coreBundle.js:7946`). São os helpers `emulatorIdToken` e `callCallable` de `e2e/support/callables.ts:39` e `:61`, usados por 23 arquivos de `e2e/` (lista em `logs/arquivos-request-direto.txt`), e as duas chamadas diretas ao REST do Firestore (`notifications-mobile-p5e11.spec.ts:676` e `notifications-retention-d18.spec.ts:175`).
- Cenário: reaproveitar um soquete no instante em que o emulador o fecha, cerca de 6,0 s de ociosidade, dá `socket hang up` ou `ECONNRESET` no preparo. A investigação (3.4) não comprovou a corrida no emulador real, e as lacunas de desenho são:
  - E1 e E2 na faixa de 5 s;
  - a variante reproduzida (RST) é outra que a do evento original (FIN);
  - sem contenção de CPU, sem Node 24 e sem o Auth.
- Impacto: falha intermitente e visível do E2E oficial, um teste vermelho sem nova tentativa, também no CI. O plano da R3.1 (RR-R31-07, "O que fazer") pedia "o preparo pela API precisa ser protegido do RR-R31-08" antes de o CI e o gate dependerem do `verify:all`, e a R3.2 passa a depender dele sem isso.
- Correção sugerida, uma das duas:
  - endurecimento só do harness: `Connection: close` nos dois helpers de `callables.ts` e nas duas chamadas diretas. E3a dá 0/80 com ele; nenhuma asserção, prazo ou comportamento do produto muda, e o navegador continua com as conexões dele;
  - ou o gate aceita o risco por escrito, com gatilho: qualquer `socket hang up` ou `ECONNRESET` numa execução oficial leva à primeira opção, sem repetir a execução até passar.

**EST-04 — LOW. Documentação de operação e de plataforma contradiz o CI fixado, e o fluxo local não fixa a versão validada.**
- Onde:
  - `docs/production/RUNBOOKS.md:23` (RB-01): "o CI usa `firebase-tools@latest`, sem versão fixa" e "Java 17"; o CI usa 15.32.1 e Java 21 (`quality-gate.yml:137`, `:177`). O Java 17 já estava errado na R3.1;
  - `docs/production/FIREBASE_PRODUCTION.md:329` (§15, CURRENT): "o CI instala `firebase-tools@latest`";
  - `docs/production/THREAT_MODEL.md:139` (T-27);
  - RB-09 e `e2e:kill-ports` (`package.json:46`) listam as portas sem 9299 e 9499, que RB-04 agora exige livres. Na prática elas são do processo do CLI e saem com ele, mas o critério de sucesso de RB-09 não as cobre.
- Impacto: o fluxo "suportado oficialmente" fica com instruções contraditórias. RB-04, RB-05, RB-08 e o README estão certos. O desligamento limpo foi verificado só no firebase-tools 15.32.1 (`commandUtils.js:164-230`), e quem rodar outra versão localmente fica fora do que foi validado; o executor não confere a versão.
- Correção sugerida:
  - RB-01: firebase-tools 15.32.1 e Java 21, também para uso local;
  - FIREBASE_PRODUCTION §15: CI fixado, local não; o resto do TARGET de FIRE-13 continua;
  - T-27: tirar o `@latest`;
  - incluir 9299 e 9499 em RB-09 e no `e2e:kill-ports`;
  - opcional: o executor avisar quando `firebase --version` for diferente de 15.32.1.

**EST-05 — LOW (risco residual). O fluxo novo não foi exercitado no CI, e a capacidade do runner é desconhecida.**
- Onde: `quality-gate.yml:159-212` (`ubuntu-latest`, Node 24, sem `E2E_SHARDS`, padrão de 3 grupos) e `playwright.config.ts:69` (no CI, rastro de todos os testes, retido na falha).
- Cenário: os picos medidos aqui, num contêiner de 16 GB, vão até cerca de 11 GB por grupo (R3.1: 8,9, 6,9 e 10,8 GB). Se o repositório usar o runner padrão de repositório privado, de 2 vCPU e cerca de 7 GB (a confirmar pelo dono, não consultei o GitHub), um grupo pode não caber. O rastro de todos os testes também pesa.
- Impacto: E2E do CI vermelho por memória. A falha é visível, não há PASS falso.
- Correção sugerida: confirmar a classe do runner; medir na primeira execução do CI; se preciso, definir `E2E_SHARDS` no job, de 1 a 12 (`grupos.mjs:13`), e reavaliar o rastro.

**EST-06 — INFO. Os grupos oficiais não são os validados na R3.1.**
- Onde: `tools/e2e/grupos.mjs:10` diz "o isolamento validado na P5-F.1-R3.1 (três grupos com Emulator próprio)".
- Cenário: o `--shard=i/3` do Playwright dá 83, 64 e 70 testes (C4), e não os grupos manuais 68/70/78 da R3.1. A composição é parecida: o grupo 1 é o da R3.1 mais `goals-p5b`, e o grupo 3 está contido no da R3.1. A validação desses grupos é a própria execução oficial da R3.2 (3.5).
- Correção sugerida: ajustar o comentário e registrar a divisão real na evidência.

**EST-07 — INFO. O comentário "cada teste já zera os dados do Emulator antes de começar" é impreciso.**
- Onde: `executar-em-grupos.mjs:11`.
- Cenário: o isolamento varia por spec, entre `clearEmulatorData`, `recursiveDelete` dirigido e ids únicos por teste. `app-smoke`, `authenticated-smoke` e `notifications-exit-race` não mexem em dados e não dependem de outro arquivo. Sem impacto encontrado.

**EST-08 — INFO. O executor aceita argumentos que mudam o critério.**
- Onde: `grupos.mjs:25-26`.
- Cenário: `--timeout`, `--workers`, `--config`, filtros (`-g`, arquivos, `--project`, `--only-changed`) valem igualmente para a lista e para os grupos, e o "ok: N testes" sai com prazos ou paralelismo alterados ou para um subconjunto. `--retries` e `--repeat-each` são pegos pelas tentativas e pelas chaves repetidas.
- As invocações oficiais (`verify:all`, CI) não passam argumentos.
- Correção sugerida, opcional: recusar `--timeout`, `--workers`, `--config`, `--retries` e `--repeat-each`, ou imprimir os argumentos na linha final.

**EST-09 — INFO. Já resolvido ou só de registro.**
- O comentário de `playwright.config.ts:39` com caminho inexistente foi corrigido em `93668199`.
- `tools-e2e-1.log` (6 testes) é anterior à versão final do arquivo de testes (9). C1 e C2 registram 9/9.
- O mutante X03 sobrevivente do executor é equivalente.
- O Playwright não faz desligamento limpo no Windows (`index.js:842`): o fluxo vale para Linux e para o CI.

## 5. Skill `firebase-production-readiness`

FAIL — Firebase production readiness

No escopo da etapa. O código e a configuração da plataforma tocados estão corretos, mas falta a evidência obrigatória da execução das suítes Emulator pelo procedimento oficial, e a etapa Emulator do `verify:all` reporta sucesso depois de interrompida (EST-10).

Lidos `.claude/skills/firebase-production-readiness/SKILL.md` e `references/firebase-production-checklist.md`, por inteiro.

**Escopo.** O que a P5-F.1-R3.2 toca na plataforma:
- o Emulator no E2E: ciclo de vida, projeto, portas e desligamento;
- `playwright.config.ts`;
- o executor `tools/e2e/*` e os scripts `test:e2e`, `test:tools:e2e`, `verify:fast` e `verify:all`;
- o CI (`.github/workflows/quality-gate.yml`), inclusive a versão do firebase-tools.

Não é o checklist integral: a etapa não é release nem P10.

**Mapa de ambientes (no escopo).**

| Comando ou destino | Projeto | Evidência |
| --- | --- | --- |
| E2E local e CI (`test:e2e`, executor, `webServer`) | Emulator `minhas-financas-local`, `singleProjectMode` | `playwright.config.ts:86`; `package.json:43-44`; `firebase.json` (`emulators`: auth 9099, firestore 8080, functions 5001, UI 4000, todos em 127.0.0.1) |
| Integração e Rules (`test:integration:emulator`) | Emulator `minhas-financas-local` | `package.json`, inalterado |
| Executor `tools/e2e/executar-em-grupos.mjs` | nenhum destino remoto | só `npm --prefix functions run build` e `npx playwright test` |
| `.firebaserc`, `default` | produção | anterior à etapa (PR-PLAT-01); o fluxo não o alcança, porque todo comando passa `--project` |
| `deploy:*` | produção | `package.json:38-42`, anteriores e intocados; agentes não os executam |
| CI | sem segredos e sem credenciais | `quality-gate.yml`, sem `secrets.`; firebase-tools 15.32.1, Java 21, Node 22 e 24 |

**Inventário de Functions.** Fora do escopo. O diff da etapa não toca `functions/`, exports, opções de runtime nem gatilhos. O emulador de Functions entra só pelo ciclo de vida dos processos (3.1 b).

**Matriz de evidência (seções do checklist exercitadas pelo diff).**

| Seção | Item | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Os scripts e o CI tocados não têm produção como destino implícito | PASS | `package.json:43-44,48,54-55`; executor (3.3, "Sem produção"); `e2e-grupos.test.mjs:127-128` |
| 1 | CI sem credenciais de produção; testes só no Emulator, com projeto local | PASS | `quality-gate.yml` sem segredos; `playwright.config.ts:86`; `package.json:43` |
| 12 | `firebase.json` define os emuladores usados, com projeto local e `singleProjectMode` | PASS | `firebase.json` (`emulators`, `singleProjectMode: true`); as portas auxiliares 4400, 4500, 9150, 9299 e 9499 estão na conferência do executor (`grupos.mjs:103-106`, teste `e2e-grupos.test.mjs:109-115`) |
| 12 | Nenhum teste ou script de teste do fluxo tocado depende de credenciais reais ou de rede externa | PASS | executor sem rede; preparo em 127.0.0.1 (`e2e/support/callables.ts:27-28`) |
| 12 | O CI executa as suítes Emulator em todo PR | PASS | `quality-gate.yml:10-14` (`pull_request`, `push` em `main`), `:156-157`, `:211-212` |
| 12 / FIRE-13 | Versão da CLI fixa no CI (parte do TARGET de P6 em `FIREBASE_PRODUCTION.md` §15) | PASS no CI | `quality-gate.yml:148,188`. Uso local não fixado e documento desatualizado (EST-04, LOW, documentação) |
| 12 | Emulator desligado limpo em cada execução, sem processo órfão nem limpeza externa | PASS | 3.1 (a): o antes em `p5f1r31/logs/emulator-cleanup.log`; o depois nos quatro `.meta` com `limpeza_externa=nenhuma`; o caso de SIGTERM no runner (EST-02) fica fora do caminho normal |
| 12 | Execução oficial com o Emulator (integração, Rules e E2E em grupos) na árvore sob revisão | **FAIL** | 3.5: as duas execuções oficiais foram interrompidas; não há resultado válido da integração, das Rules nem do E2E em grupos |
| 12 | O resultado da etapa Emulator do `verify:all` reflete a execução das suítes | **FAIL** | EST-10: `firebase emulators:exec` sai com 0 depois de um SIGINT no meio do script (`emulators-exec.js:18`; `commandUtils.js:164-213`); visto na `verify-all-r32-2` |

**Configuração externa pendente (no escopo).** Nenhuma. A classe do runner do GitHub (EST-05) é condição de operação do CI, não item do checklist; fica como risco residual.

**Achados bloqueantes.**
1. **Sem execução oficial válida das suítes Emulator na árvore sob revisão** (3.5).
   - Impacto: o desligamento limpo entre grupos, a espera de portas e a conferência pela lista nunca foram exercitados com o Emulator real nos três grupos. A integração e as 19 suítes de Rules não têm resultado na `93668199`.
   - Remediação: uma execução completa e ininterrupta do `verify:all`, conferida por contagem.
2. **EST-10.**
   - Impacto: a saída 0 da etapa Emulator não prova que as suítes rodaram.
   - Remediação: conferência por contagem no gate, já, e marcador de conclusão ou executor com conferência no projeto.

EST-04 (documentação que ainda diz `firebase-tools@latest`) é correção de documento, não falta de evidência: a fixação está no próprio workflow.

**Fora do escopo desta avaliação** (itens do checklist atribuídos a milestone posterior e não afetados pelo diff):
- §1, separação DEV/STAGING/PROD e `.firebaserc`: PR-PLAT-01 (P6), E-01;
- §1, utilitário com override para produção: PR-PLAT-02 (P6);
- §2, App Check, inclusive o E2E com o provedor de depuração (os logs do E2E mostram `"app":"MISSING"`): PR-APPCHK-01 (P6), E-02;
- §3, pipeline de deploy de Rules e índices e CD: PR-REL-01 (P6), E-12;
- §4, opções de runtime das Functions: sem ID próprio no registro; nenhuma alterada;
- §5 e §6, IAM e segredos: E-04, E-05;
- §7, Authentication, e o login E2E no código de produção com o `dist/` compartilhado: PR-AUTH-04 (P6), E-03;
- §8, Hosting: PR-PLAT-03 (P6), E-11;
- §9 e §10, custos, quotas e monitoramento: PR-OBS-01 e PR-OBS-02 (P7), E-08;
- §11, backup, PITR e restore: PR-BKP-01 (P7), E-07;
- §12, projeto `demo-`, guarda única de Emulator e testes que pulam sem Emulator: FIRE-13, INV-16, REL-09 (P6);
- REL-11 (P6): cadeia de suprimentos e varredura de segredos do CI (actions por tag, `permissions` e gitleaks; T-27);
- §13, registro de configuração externa: depende dos itens acima.

**Verificação.** C1 a C12 (seção 2), a leitura do código instalado (`logs/codigo-instalado.txt`, `logs/emulators-exec-sigint.txt`) e os logs da `verify-all-r32-2` (3.5), rodada e interrompida fora desta revisão. Não rodei Emulator.

## 6. O que não foi possível verificar

- **O E2E oficial em grupos de ponta a ponta e o `verify:all` completo.** As duas execuções oficiais na árvore sob revisão foram interrompidas (3.5), e eu não podia rodar o Emulator. Para concluir, é preciso uma execução completa do executor principal, conferida como na Conclusão.
- **O fluxo no CI.** Sem push, não há execução do workflow. Não sei a classe do runner nem a visibilidade do repositório; não consultei o GitHub (EST-05).
- **A variante `socket hang up` do RR-R31-08**, o reaproveitamento no instante exato sob contenção de CPU, com Node 24 e contra o Auth. Não rodei experimento com carga de CPU porque a CPU está reservada para a execução oficial (EST-03).
- **Outras versões do firebase-tools** fora da 15.32.1. O desligamento limpo foi lido e visto só nela (EST-04).
- **Windows e macOS**, fora do ambiente do projeto e do CI.
