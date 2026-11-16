VEREDITO: PASS

# Parecer independente: estabilidade do processo de testes (Frente B), P5-F.1-R3.2, rodada 3

- **Revisor:** estabilidade do processo (RR-R31-07 e RR-R31-08) e `firebase-production-readiness` no escopo da etapa.
- **Data:** 2026-11-13.
- **Árvore sob revisão:** `ef514869087c2b9e8e910a25fc7c18174418b8bb`.
- **Pasta:** `p5f1r32/revisoes/estabilidade/rodada-3/`. As saídas estão em `logs/`, os roteiros em `ka/` e as cópias em `copia/` e `copia-mutantes/`.

## Conclusão

- **A execução oficial final `verify-all-r32-4` confere por contagem, item a item** (seção 3):
  - saída 0, em 3.095 s, árvore `ef514869` no começo e no fim;
  - 1.832 testes de unidade em 20 scripts; integração com 22 resumos, entre eles as 19 suítes de Rules (287 testes), e o marco de fase completa;
  - nenhum sinal na fase de integração;
  - E2E com 218 testes: cada um uma vez, numa tentativa, `passed`, nos relatórios JSON por grupo e no repórter `list`, que batem entre si;
  - portas livres e nenhuma JVM no fim, `limpeza_externa=nenhuma`;
  - picos por grupo de 9.676, 6.884 e 10.133 MiB;
  - o gatilho do D-P5F1-R32-03 não disparou: nenhum `socket hang up` nem `ECONNRESET` no log inteiro.
- **EST-11 a EST-15:**
  - EST-11, EST-12, EST-13 e EST-15 estão fechados;
  - o EST-14 fica aceito como RR-R32-10, e o EST-05 como RR-R32-05; as duas classificações são aceitáveis (seção 6).
  - O roteiro do executor `mutantes-grupos-r32.py` dá **52/52 mortos** na minha cópia. Meus R01 a R03 da rodada 2 morrem pelos testes novos.
  - Na cadeia real npm → dash → executor → npx, o SIGQUIT agora para o grupo pelo caminho limpo (C4).
- **Achados novos.** Nenhum é HIGH ou MEDIUM, e nenhum leva a PASS falso.
  - **EST-R3-01 (LOW).** O `firebase-debug.log` de cada grupo, prometido pelo RB-04 e pela decisão D-P5F1-R32-03 ("o diagnóstico fica possível"), não existe. O firebase-tools apaga esse arquivo na saída limpa, e a saída limpa passou a ser o caminho normal com o `gracefulShutdown`, mesmo quando os testes falham. Só o `firestore-debug.log` é guardado.
  - **EST-R3-02 (INFO).** Cinco mutantes sobrevivem no caminho de interrupção: o segundo sinal (dois), o sinal antes do primeiro grupo, o grupo morto por sinal e os relatórios antigos não apagados. Nenhum dá PASS falso.
  - **EST-R3-03 (INFO).** O rascunho `mutantes.md` da Frente B está desatualizado e contradiz o `fluxo-e2e-oficial.md`. Há também uma imprecisão sobre a execução 22.
- **Skill:** `PASS — Firebase production readiness`, no escopo da etapa (seção 8).

## 1. Escopo conferido

- **Árvores.**
  - Sob revisão: `ef514869`.
  - Rodada 2: `9fddcb5a`.
  - R3.1: `efcbd264`.
  - O diff `9fddcb5a..ef514869` tem 10 arquivos, todos lidos.
  - Os da Frente B foram lidos por inteiro: `tools/e2e/executar-em-grupos.mjs`, `tools/e2e/grupos.mjs` e `tests/tools/e2e-grupos.test.mjs`.
  - Também o diff do RB-04 (`docs/production/RUNBOOKS.md:50,52`).
  - Também o diff do E2E (`e2e/work-time-p5f.spec.ts`): 3 linhas novas, sendo 2 `console.log` e 1 de comentário; nenhum título mudou (C14, C16).
  - `playwright.config.ts`, `package.json`, `.github/` e `tools/integracao/` não mudaram desde a rodada 2.
- **Minhas cópias.**
  - São duas, extraídas com `git archive` da árvore, sem `docs/` e com os `node_modules` por link.
  - Os 803 arquivos da cópia são idênticos, byte a byte, aos do worktree (C0).
  - Nada foi escrito no worktree. Usei `GIT_OPTIONAL_LOCKS=0` em todos os comandos do git.
  - Um `git write-tree` rodou uma vez, por descuido. Ele não mudou nada: o índice do worktree continua com a data de 11/11 11:47:49, e a árvore `3995eb7f` que ele devolveu já existia no repositório.
- **Rascunhos e procedimento do executor:**
  - `revisoes-LEIAME.md`, seção "Rodada 2";
  - `historico-execucoes.md`, execuções 38 a 54;
  - `fluxo-e2e-oficial.md`, `mutantes.md`, `plano-20-20.md` (RR-R32-03, 04, 05 e 10 e D-P5F1-R32-03), `keepalive-rr-r31-08.md` e `matriz-antes-depois.md`;
  - `run-oficial.sh`, `tree-now.sh`, `amostrar-memoria.sh` e `with-proxy-safe.sh`.
- **Evidência oficial:**
  - `verify-all-r32-4.log` (SHA-256 em `logs/verify-all-r32-4.sha256`), `.log.meta`, `.log.status` e `-memoria.txt`;
  - `verify-all-r32-4-artefatos/`: 3 JSON, 3 `firestore-debug.log` e 3 `.last-run.json`.
- **Código instalado:**
  - firebase-tools 15.32.1 (`lib/bin/cli.js`, `lib/logger.js`);
  - Playwright 1.60.0 (`lib/program.js`, as opções do `playwright test`).
- **Ambiente.**
  - O contêiner foi reiniciado antes da revisão, e a execução oficial terminou em 11/11, às 19:21:43Z. Nada meu se sobrepôs a ela: os números de memória da seção 3 são só dela.
  - C13 e C6 rodaram junto com as filas de mutantes do próprio executor (`rodar-mutantes-finais.sh a` e `b`) e com as dos outros revisores. A carga só pode tornar um mutante "morto" por tempo esgotado, nunca fazer um sobreviver.

## 2. Comandos executados e resultados

Nada aqui rodou Emulator, Playwright de verdade, E2E, `npm run verify:*` ou `test:integration*`, e nada abriu as portas do Emulator. As portas usadas foram efêmeras, e depois de C4 e C8 conferi que nenhuma porta do Emulator estava em uso e que não sobrou processo. Tudo rodou com `nice -n 19`, um de cada vez, sem produção e sem segredos.

| # | Comando (na minha cópia) | Resultado | Saída |
| --- | --- | --- | --- |
| C0 | cópia contra o worktree, arquivo por arquivo (`cmp`, só leitura) | 803 arquivos, 0 diferente | `logs/C0-copia-vs-worktree.txt` |
| C1 | `node --test tests/tools/integracao-marco.test.mjs` | 3/3 | `logs/C1-tools-integracao.log` |
| C2 | `node --test tests/tools/e2e-grupos.test.mjs` | 18/18 (15,4 s) | `logs/C2-tools-e2e.log` |
| C4 | a cadeia real `npm run verify` → dash → `npm run test:e2e` → dash → o executor final → `npx` real → Playwright falso que trata o SIGINT com teardown de 4 s (`ka/cadeia-sinais.mjs`, `ka/proj/`, executor e `grupos.mjs` com o mesmo SHA-256 da árvore). Cenários X1 a X9 da rodada 2, mais X6b (SIGHUP só no executor) e X7b (SIGQUIT só no executor) | seção 4 (EST-12) | `logs/C4-cadeia-sinais.txt` |
| C5 | a lista do que é aceito (`refusedArgument`) contra o parser **real** do `playwright test` 1.60 (`program.js` carregado com a ação trocada, sem rodar nada; `ka/args-propriedade.cjs`). São 960 argv: cada opção longa (36) em seis formas, todas as combinações curtas de uma, duas e três letras, valores que parecem opções e `--` | 134 aceitos (o parser recusa 13 deles). **Nenhum aceito produz opção fora de grep, grepInvert, project, trace, maxFailures e x** | `logs/C5-args-propriedade.log` |
| C6 | meus mutantes (`ka/mutantes-revisor-r3.py`, 14; restauração conferida por SHA-256) | 8 mortos, inclusive os R01 a R03 da rodada 2. **R3-M01, M02, M04, M05, M06 e M09 sobrevivem** (EST-R3-02; o M09 é equivalente quanto à decisão) | `logs/C6-*.log`, `logs/C6-hashes-depois.txt` |
| C8 | SIGTERM ao executor final durante a espera das portas entre os grupos 1 e 2 (`ka/entre-grupos.mjs`) | saída 143; o grupo 2 não roda; "não rodou" e FALHOU | `logs/C8-sinal-entre-grupos.log` |
| C9 | contagem por fase do log oficial (`ka/contar-verify.py`, o mesmo roteiro independente da rodada 2) | seção 3 | `logs/C9-contagem-verify-all-r32-4.txt` |
| C10 | picos de memória e processos por fase (`ka/memoria-por-fase.py`; janelas pelas transições `java` do amostrador) | seção 3 | `logs/C10-memoria-por-fase.txt` |
| C11 | testes do E2E pelo repórter `list` (`ka/testes-do-log.py`) | 218 "✓", 218 distintos, 83/64/71, numeração contínua, nenhum outro marcador | `logs/C11-testes-do-log.txt` |
| C13 | o roteiro do executor `scripts/mutantes-grupos-r32.py` na minha `copia-mutantes`, das 23:19:00Z às 23:34:18Z | **52/52 mortos**, base 18 + 3 testes sem falha, 14 arquivos restaurados com o mesmo SHA-256 | `logs/C13-*.log`, `logs/C13-hashes-*.txt` |
| C14 | diff de `e2e/`, `playwright.config.ts`, `package.json` e `.github/` desde a rodada 2 | só as 3 linhas do ADV-01 na spec | `logs/C14-diff-e2e-config.txt` |
| C15 | os relatórios JSON por grupo, conferidos sozinhos e contra o repórter `list` (`ka/relatorios-grupos.py`) | seção 3 | `logs/C15-relatorios-por-grupo.txt` |
| C16 | os 218 testes da rodada 2 (`verify-all-r32-3`) contra os da final, por arquivo e título (`ka/comparar-r2-r3.py`) | conjuntos iguais; 5 linhas deslocadas na `work-time-p5f.spec.ts`, pelas linhas novas | `logs/C16-lista-r2-final.txt` |
| C17 | sinais de problema no log e nos logs do Emulator por grupo | seção 3 | `logs/C17-sinais-no-log-e-emulador.txt` |
| C18 | o ciclo de vida do `firebase-debug.log`: o código do firebase-tools, os artefatos, o worktree e os logs deixados por execuções E2E antes e durante a R3.2 | EST-R3-01 | `logs/C18-logs-do-emulador.txt` |
| C19 | diff de `tests/tools/e2e-grupos.test.mjs` desde a rodada 2, só as linhas removidas | nenhuma asserção enfraquecida; `--reporter=list` e `--ui-port 0`, antes aceitos, agora são recusados | `logs/C19-diff-e2e-grupos-test.txt` |

## 3. Execução oficial `verify-all-r32-4`, conferida por contagem

**Cabeçalho e fim** (`.log.meta`):
- Início 18:30:01Z; fim 19:21:43Z; **`exit=0`**; `duracao_s=3095`.
- `head=1730a1df`; **`arvore=ef514869` no começo e no fim**, pelo índice temporário de `tree-now.sh`.
- Node v22.23.4, Java 21.0.12.1, firebase-tools 15.32.1, `E2E_SHARDS` no padrão.
- No fim: **`portas_ocupadas_no_fim=[]`, `java_no_fim=0` e `limpeza_externa=nenhuma (o Emulator desligou sozinho)`**.
- `artefatos=5.6M e2e-grupos grupo-1 grupo-2 grupo-3`.
- O `run-oficial.sh` (18:18Z, antes do início) e o `with-proxy-safe.sh` (04/11) não mudaram de papel desde a rodada 2: só `PLAYWRIGHT_BROWSERS_PATH` e o proxy de loopback, e o `npm run verify:all` sem argumentos.

**Unidade (`verify:fast`, C9):**
- Os 24 passos têm o cabeçalho do npm no log.
- Os 20 scripts de teste têm, cada um, o resumo do `node --test`. Somam **1.832 testes, 1.832 aprovados, 0 falha, 0 cancelado, 0 pulado e 0 todo**.
- Por script: `functions:test:unit` 677, `investments` 177, `p1` 131, `billing` 72, `ui` 9, `cash` 23, `loans` 20, `clients` 15, `accounts` 16, `cards` 30, `recurring` 22, `split` 22, `settings-catalog` 17, `ai-chat` 37, `notifications` 99, `goals` 59, `reports` 107, **`work-time` 278**, **`test:tools:e2e` 18** e `test:tools:integracao` 3.
- A diferença para a rodada 2 (1.812) é de +17 em `work-time` e +3 nos testes do executor, como o histórico diz.
- Lint das Functions: 0 erro e 201 avisos. Nenhum `npm error` ou `not ok`.

**Integração (`test:integration:emulator`, C9):**
- **22 resumos, na ordem da cadeia do `package.json`**: 1.289 testes, 1.289 aprovados e 0 falha, cancelado ou pulado.
- Functions 985/985; `test:tools:limpeza` 15/15; `test:tools:contas` 2/2.
- **As 19 suítes de Rules somam 287 testes:** goals 21, investments 7, investment-domain 19, investment-m3 7, m4 41, adjacent 5, workspaces 10, billing 10, receivables 6, accounts 5, cards 5, recurring 5, split 7, transactions-p4d 8, settings-catalog 4, notifications 84, reports 12, work-time 14 e projection-marks 17.
- `✔ Script exited successfully (code 0)` (linha 36696 do log sem cores) e **`[integração] fase completa: todas as suítes rodaram até o fim (execução a1e9b7c7-2a69-4990-a2b7-b157e710b4d5).`** (36702).
- O `test-results/integracao/` do worktree ficou vazio: o `conferir` apagou o marco.
- **Nenhum "Received SIG" na fase**, nenhum "exited with code" e nenhum "emulators failed to shut down".

**E2E (`test:e2e`, C9, C11, C15, C16):**
- `[e2e em grupos] 218 testes em 36 arquivos, em 3 grupo(s)` (36746).
- Os grupos, pela linha do executor:

  | Grupo | Saída | Testes | Duração | Arquivos |
  | --- | --- | --- | --- | --- |
  | 1 | 0 | 83/83 | 473 s | 16 |
  | 2 | 0 | 64/64 | 340 s | 9 |
  | 3 | 0 | 71/71 | 728 s | 11 |

- **`[e2e em grupos] ok: 218 testes, cada um uma vez, todos passaram`** (61656).
- **Relatórios JSON por grupo (C15):**
  - 83, 64 e 71 testes, todos `expected`;
  - cada um com **um só resultado, `passed` com `retry` 0**, e `expectedStatus` `passed`;
  - `stats`: `unexpected` 0, `flaky` 0 e `skipped` 0; `errors` vazio; nenhuma anotação `skip`, `fixme`, `fail` ou `slow`;
  - a configuração gravada em cada um: `shard` 1/3, 2/3 e 3/3, `workers` 1, `forbidOnly` true, `fullyParallel` false, `globalTimeout` 0, `maxFailures` 0, `grep` vazio, e o projeto `chromium` com `retries` 0, `repeatEach` 1 e `timeout` 45.000;
  - Playwright 1.60.0.
- **Conferência cruzada.**
  - Nos relatórios JSON, os 218 testes são distintos, nenhum aparece em dois grupos e nenhum arquivo está em mais de um grupo.
  - O conjunto é **igual** ao dos 218 do repórter `list` no log.
  - Por arquivo e título, ele é igual também aos 218 da `verify-all-r32-3` (C16).
- **O desligamento do Emulator em cada grupo.**
  - Três "Received SIGTERM for the first time", um por grupo (46764, 52501, 61637): é o `gracefulShutdown`.
  - Quatro "Shutting down emulators" e "Stopping Firestore Emulator": o da integração e os três dos grupos.
  - Três "All emulators ready!": um Emulator novo por grupo.
  - Nenhum SIGINT, SIGHUP, SIGQUIT ou SIGKILL e nenhum "forcefully".
- **Portas livres entre os grupos.**
  - Nenhuma linha "portas em uso" ou "ainda em uso".
  - O amostrador mostra `java=0` em 19:03:49–19:04:09 e em 19:09:30–19:09:50.
  - O fim de cada grupo no relatório (19:03:48,7 e 19:09:28,2) bate com a última linha de cada `firestore-debug.log`, que registra a parada do WebSocketServer.
- **Nada de sinal de recurso ou de rede (C17):**
  - nenhum "Target crashed", "Page crashed", `OutOfMemory`, "heap out of memory", **`socket hang up`, `ECONNRESET`** ou "Request to function failed" no log inteiro;
  - nos `firestore-debug.log`, nenhum `OutOfMemory`;
  - os `Error:` do log são esperados: avisos de IPv6 (`EAFNOSUPPORT ::1`), testes de contrato que registram erro de propósito e os quatro "Failed to authenticate" do Secret Manager no teste de billing fail-closed, que também aparecem na rodada 2 e são anteriores à etapa (seção 8).
- As sequências `[estados-adv-01-sem-conexao]` e `[estados-adv-01]` aparecem uma vez cada, a parte b do PT-R32-08.

**Memória por fase** (contêiner de 16.086 MiB, uma amostra a cada 10 s, 309 amostras; C10):

| Fase | Janela (UTC) | Pico | `node` máx. | `java` |
| --- | --- | --- | --- | --- |
| `verify:fast` | 18:30:03–18:34:03 | 2.504 MiB | 6 | 0 |
| integração e Rules | 18:34:13–18:54:57 | 2.983 MiB | 9 | 1 |
| `build:e2e`, Functions, lista e subida | 18:55:07–18:56:17 | 2.888 MiB | 9 | 0 |
| grupo 1 (83 testes) | 18:56:27–19:03:39 | **9.676 MiB** | 67 | 1 |
| entre 1 e 2 | 19:03:49–19:04:09 | 2.152 MiB (mín. 947) | 4 | 0 |
| grupo 2 (64 testes) | 19:04:19–19:09:20 | **6.884 MiB** | 44 | 1 |
| entre 2 e 3 | 19:09:30–19:09:50 | 2.188 MiB (mín. 1.100) | 4 | 0 |
| grupo 3 (71 testes) | 19:10:00–19:21:33 | **10.133 MiB** (pico da execução) | 71 | 1 |

- Os números batem com o histórico (execução 54) e com o `pico_mib=10133` do `.meta`.
- Dentro de cada grupo, a memória só cresce: são os processos do emulador de Functions.
- Entre os grupos, ela volta ao piso, com `java=0`.
- Os picos ficam na faixa da rodada 2 (9,8, 7,3 e 10,2 GB) e da R3.1 em grupos manuais (8,9, 6,9 e 10,8 GB).

**Conclusão.** É a execução completa e ininterrupta na árvore final, com cada item do pedido conferido por contagem e cruzado com os relatórios por grupo.

## 4. Situação dos achados das rodadas 1 e 2

| Achado | Situação | Evidência |
| --- | --- | --- |
| EST-01 (LOW) | Fechado (rodada 2), mantido | P01 a P06 e R3-M07 morrem (C13, C6); na execução oficial, nenhuma porta presa |
| EST-02 (LOW) | Fechado, mantido | C4 refeito com o executor final: X1, X3, X4 e X6 continuam como na rodada 2. S01 a S05 morrem (C13) |
| EST-03 (LOW) | Fechado, mantido | D-P5F1-R32-03 com o gatilho (`plano-20-20.md:39`); o gatilho não disparou na `verify-all-r32-4` (seção 3). A justificativa "o diagnóstico fica possível" não se sustenta (EST-R3-01) |
| EST-04 (LOW) | Fechado, mantido | firebase-tools 15.32.1 no CI (`quality-gate.yml:151,191`) e na execução oficial (`.meta`); W05 morre |
| EST-05 (LOW) | **Risco residual RR-R32-05, aceitável** | seção 6 |
| EST-06 (INFO) | Fechado | a divisão real é a mesma da rodada 2: 83, 64 e 71 testes (16, 9 e 11 arquivos). Falta só preencher o "XXX" de `fluxo-e2e-oficial.md:37` |
| EST-07 (INFO) | Fechado | — |
| EST-08 (INFO) | Fechado; a lista do que é aceito substitui a de recusados | C5 |
| EST-09 (INFO) | Registro | — |
| EST-10 (MEDIUM, rodada 1) | Fechado, mantido | `tools/integracao/` e o script não mudaram; I01 a I07 morrem (C13); a linha do marco aparece e nenhum "Received SIG" na fase (seção 3) |
| **EST-11 (LOW)** | **Fechado** | abaixo |
| **EST-12 (INFO)** | **Fechado** | abaixo |
| **EST-13 (INFO)** | **Fechado** | abaixo |
| **EST-14 (INFO)** | **Aceito como RR-R32-10; a classificação é aceitável** | seção 6 |
| **EST-15 (INFO)** | **Fechado no procedimento**; a parte dos logs do Emulator vira o EST-R3-01 | abaixo |

**EST-11, fechado.**
- **O `npx` falso agora é em cadeia.** O processo de topo sobe `sh -c '"$0" "$@"; exit $?' node <stub>`, e o neto, que trata o sinal, é o "Playwright" (`e2e-grupos.test.mjs:193-213`). O topo repassa ao `sh` o sinal que recebe sozinho, e o dash, enquanto espera o filho, não o repassa (C3 da rodada 2). Por isso o neto só recebe o sinal mandado ao grupo, como na cadeia real.
- **Os testes novos:**
  - SIGHUP e SIGQUIT só ao executor (`:537`): saída 129 e 131, um SIGINT ao grupo e o grupo 2 não roda;
  - o sinal durante a espera das portas entre os grupos (`:557`): o grupo 1 deixa a porta presa por 3 s, e o sinal sai pela linha "grupo 1: saída 0, …"; o grupo 2 não roda, e a saída é 143;
  - o sinal depois do último grupo (`:573`): saída 143, nunca "ok".
- **Mutantes.** Meus R01 (SIGHUP), R02 (SIGINT ao PID) e R03 (sinal sem grupo em curso), aplicados na forma da árvore final, morrem pelo teste certo: 15, 14 e 16 (C6). S06, S07, S08, S09 e T01 do roteiro do executor também morrem (C13).
- **As lacunas que sobram** estão no EST-R3-02. Nenhuma leva a PASS falso.

**EST-12, fechado.**
- **(a) SIGQUIT tratado** (`executar-em-grupos.mjs:66`).
  - Na cadeia real (C4), o X7 (SIGQUIT ao grupo) agora leva **um SIGINT ao Playwright falso**, com teardown completo e nada sobrando. Na rodada 2, o grupo do Playwright terminava sozinho, sem sinal.
  - O npm e o dash saem na hora, por SIGQUIT, e o executor termina o desligamento sozinho, como no X3.
  - X7b (SIGQUIT só ao executor): saída 131 depois do teardown. X6b (SIGHUP só ao executor): saída 129.
- **(b) e (c)** estão no RB-04 (`RUNBOOKS.md:52`).
  - A redação confere com C4: no X2 e no X8 (SIGTERM só a um `npm` acima do executor), o executor e o Playwright seguem órfãos.
  - No X3, X6 e X7 (sinal ao grupo inteiro), o topo sai na hora, e o executor termina sozinho em cerca de 4 s.
- **(d) cada sinal vira um SIGINT, sem mudança.**
  - No X5 (dois Ctrl+C com 2 s de intervalo), o Playwright falso recebe 2 SIGINT.
  - O cabeçalho (`executar-em-grupos.mjs:22-29`), o RB-04 e o RR-R32-04 (`plano-20-20.md:75`) dizem isso. O comportamento não tem teste (EST-R3-02).

**EST-13, fechado.**
- A recusa virou a lista do que é aceito (`grupos.mjs:43-72`):
  - positivos;
  - `-x`;
  - `-g`, `--grep`, `--grep-invert`, `--project`, `--trace` e `--max-failures`, com o valor separado (que não pode começar com `-`) ou com `=`;
  - `-g` com o valor junto.
- C5 confere a propriedade contra o parser **real** do Playwright 1.60, com as 36 opções longas e as curtas c, g, j, u e x. Dos 960 argv, os 134 aceitos só produzem opções de filtro e rastro. `-xj2`, `-xc`, `-xu`, `--debug`, `--global-timeout`, `--reporter`, `--fail-on-flaky-tests`, `--only-changed`, `--test-list` e `--no-deps` são recusados.
- G08, G09, A01 e A02 morrem (C13). R3-M08, M10 e M11 também (C6).
- Observação sem efeito no resultado: `--project` é variádico no commander. `--project chromium e2e/x.spec.ts` toma o arquivo como nome de projeto, e a lista falha com "a lista da suíte falhou". Não é brecha.

**EST-15, fechado no procedimento.**
- O `run-oficial.sh` copia `test-results/e2e-grupos/` e `test-results/grupo-*/` para `logs/<rótulo>-artefatos/` logo depois do `npm run`, antes de qualquer outra execução no worktree.
- Os artefatos da `verify-all-r32-4` estão lá e conferem (C15).
- Só que **o `firebase-debug.log` de grupo nenhum existe**, nem no worktree (C18): é o EST-R3-01.
- A cópia vem antes da conferência das portas e da JVM no fim. Isso atrasa essa conferência em menos de 1 s e não muda o resultado, porque o executor já esperou as portas depois do último grupo.

## 5. Achados novos

### EST-R3-01: LOW. O `firebase-debug.log` de cada grupo, prometido pela documentação e pela decisão do RR-R31-08, não existe

- **Onde:**
  - `tools/e2e/executar-em-grupos.mjs:44,140,146-148`: o executor copia o arquivo quando ele existe;
  - `docs/production/RUNBOOKS.md:52` (RB-04, Observações): "os logs do Emulator (`test-results/grupo-<n>/`, com `firebase-debug.log` e `firestore-debug.log`)";
  - `keepalive-rr-r31-08.md:59`, na justificativa do D-P5F1-R32-03: "**O diagnóstico fica possível.** Os logs do Emulator de cada grupo agora são guardados (`test-results/grupo-<n>/firebase-debug.log`). Se a falha voltar, o log do instante dela existe";
  - `matriz-antes-depois.md:51,58`.
- **Cenário e evidência (C18):**
  - O firebase-tools 15.32.1 apaga o `firebase-debug.log` na saída do processo quando o código é menor que 2 e `DEBUG` não está definido (`lib/bin/cli.js:71-75`).
  - Com o `gracefulShutdown` da R3.2, o SIGTERM leva ao desligamento limpo e à saída 0 do CLI. Isso vale **também quando os testes do grupo falham**, porque o webServer é desligado do mesmo jeito.
  - Os grupos 1 a 3 da execução oficial só têm `firestore-debug.log` e `.last-run.json`. O worktree não tem `firebase-debug.log`.
  - Nas quatro execuções E2E vermelhas da R3.2 (`e2e-adv01-na-pre-vermelho`, `e2e-b03g-com-a02`, `e2e-b03g-com-n16` e `e2e-p5f-escuta-na-r31-vermelho`, todas com `exit=1`), cada cópia só tem o `firestore-debug.log`.
  - Antes da R3.2, sem `gracefulShutdown`, o Playwright matava o CLI com SIGKILL, o arquivo ficava, e todos os worktrees e cópias das etapas R1 a R3.1 o têm (até 137 MB).
  - O log principal só traz a saída do Emulator em nível info: 7.129 "Beginning execution". As linhas `addWorker(` do pool de processos do emulador de Functions são as que os gates da R3 e da R3.1 usaram para diagnosticar a partida a frio (RR-R3-11) e o E-01. São 261 no `firebase-debug.log` da R3.1 e 0 no log oficial.
  - O arquivo só sobra se o CLI for morto antes de sair: o prazo de 60 s do `gracefulShutdown` vencido, com o SIGKILL do Playwright, ou um SIGKILL de fora.
- **Impacto.**
  - Não há PASS falso. A decisão D-P5F1-R32-03 continua valendo pelo gatilho, que é conservador: qualquer `socket hang up` ou `ECONNRESET` leva ao endurecimento.
  - Mas o diagnóstico que a decisão e o RB-04 prometem não existe justamente nos casos que interessam: um teste que falha por `socket hang up` ou por processo a frio.
  - A evidência do Emulator por grupo fica reduzida ao Firestore.
- **Correção sugerida.** Escolha uma das três:
  1. o executor cria um hard link do `firebase-debug.log` para `test-results/grupo-<n>/` assim que o arquivo aparece, durante o grupo (`fs.linkSync`, conferido a cada 0,5 s). O link guarda o mesmo inode, e o CLI só apaga o nome original;
  2. ou um `DEBUG` só no `env` do webServer do Emulator. Não recomendo: o console do CLI passa ao nível debug, e o log principal cresceria na ordem de 100 MB;
  3. ou, no mínimo, corrigir o RB-04, o `keepalive-rr-r31-08.md`, o `matriz-antes-depois.md` e o texto final do D-P5F1-R32-03. Eles devem dizer que só o `firestore-debug.log` fica por grupo, que a saída do emulador de Functions em nível info está no log principal e que o pool de processos deixou de ser registrado.

  Com a opção 1, um teste no executor com o falso `npx` apagando o próprio log no fim fixa o comportamento.

### EST-R3-02: INFO. Mutantes que ainda sobrevivem no caminho de interrupção

Saída de C6. Nenhum leva a PASS falso: em todos, a execução ainda termina diferente de 0, ou o PASS falso exigiria um Playwright que sai com 0 sem gravar o relatório.

| Mutante | Troca | Por que sobrevive | Efeito real |
| --- | --- | --- | --- |
| R3-M01 | repassa só o primeiro sinal | nenhum teste manda dois sinais, e o neto sai no primeiro | o segundo Ctrl+C deixa de forçar a saída, ao contrário do que dizem o cabeçalho, o RB-04 e o RR-R32-04 |
| R3-M02 | `process.once` | idem | o segundo sinal mata o executor pela ação padrão; o grupo do Playwright termina sozinho |
| R3-M05 | o sinal antes do primeiro grupo (build das Functions, lista ou espera inicial das portas) só vale depois do grupo 1 | nenhum teste manda sinal antes do grupo 1 | o grupo 1 inteiro (cerca de 8 min) rodaria depois de um SIGTERM; a saída ainda seria 143 |
| R3-M04 | o grupo morto por sinal conta como saída 0 | o falso `npx` nunca morre por sinal | só pesa se o próprio `npx` for morto e o relatório ficar completo |
| R3-M06 | os relatórios da execução anterior não são apagados | cada teste usa uma raiz temporária nova | só pesa se o Playwright sair com 0 sem gravar o relatório |

- O R3-M09 (`--global-timeout` aceito) também sobrevive, mas é equivalente quanto à decisão: teste que não roda reprova por "não rodou".
- **Observação de texto:** a mensagem "<sinal> recebido: o grupo em curso para e desliga o Emulator" sai também quando não há grupo em curso (C8). Ela é exata nos testes, que a conferem, mas descreve mal o caso entre os grupos e depois do último.
- **Correção sugerida, opcional:**
  - um teste com dois sinais a 1,5 s de intervalo e um neto que registra os dois antes de sair, esperando `['SIGINT', 'SIGINT']`;
  - um teste com o sinal durante o build falso (um `build.wait`), esperando nenhum grupo, 143 e "0 de 2 grupo(s)";
  - somar R3-M01 e R3-M05 ao `mutantes-grupos-r32.py`.

### EST-R3-03: INFO. Rascunhos desatualizados ou imprecisos

O que está errado, e não por preencher:
- **`evidencia-rascunho/mutantes.md:28-36`, a seção "E2E oficial em grupos (Frente B)".** Ela é de 14:10 de 11/11, da rodada 1, e não foi atualizada.
  - Diz "25/26 mortos" e um único arquivo de teste.
  - Descreve o G08 e o G09 como "`--shard`" e "`--last-failed`" aceitos; hoje são "opção fora da lista" e "valor de opção aceita que começa com `-`".
  - Afirma "**X03 sobrevive, equivalente**" e "o caminho da porta ocupada não tem teste de unidade, porque esperaria 60 s (RR-R32-05)". As duas coisas são falsas na árvore final: o X03 morre pelo teste 13 (C13), e o RR-R32-05 é o do runner do CI.
  - Não traz os grupos P, S, T, A e I.
  - Tudo isso contradiz `fluxo-e2e-oficial.md:59` e o roteiro de 52 mutantes. A resposta ao EST-11 (`revisoes-LEIAME.md:95`) diz que "as contagens dos rascunhos foram corrigidas"; foi só no `fluxo-e2e-oficial.md`.
  - A seção da Frente A (16/16, N01 a N16) também é anterior aos N17 a N24 da execução 50. Isso é da área financeira e da adversarial.
- **`fluxo-e2e-oficial.md:68`.** "a integração parou depois do `ok 867`, nenhuma suíte de Rules rodou" simplifica demais. O CLI desligou o Emulator e saiu com 0 depois do `ok 867`, e o `&&` seguiu para o `test:e2e`. A cadeia continuou órfã contra o Emulator desligado: `ok 868` a `871` e `not ok 872`, `876`, `881` e `888` a `891` (`verify-all-r32-2.log`, linhas 25750–28348). A linha 22 do histórico diz isso direito.
- **O que está por preencher, sem erro:** `fluxo-e2e-oficial.md:37` (83, 64 e 71), `:59` ("52 de 52" na minha cópia; o executor roda o seu), `mutantes.md:40-41` e a seção "Rodada 3" do `revisoes-LEIAME.md`.

## 6. EST-05 e EST-14 como riscos residuais

**EST-05 → RR-R32-05: aceitável.**
- Não dá para verificar sem push, que é proibido, e não consultei o GitHub.
- A falha seria visível: OOM ou teste vermelho, sem nova tentativa, com a lista conferida. Não há PASS falso.
- O ajuste (`E2E_SHARDS`, de 1 a 12) existe e é testado.
- O texto do plano (`plano-20-20.md:76`) não traz os números. O `fluxo-e2e-oficial.md:74` remete a `testes-e-resultados.md`.
- Sugiro pôr no RR-R32-05 final:
  - o pico medido (10,1 GB no grupo 3; 9,7 GB no grupo 1);
  - a regra prática: um runner com menos memória livre que isso precisa de `E2E_SHARDS` maior no workflow;
  - a verificação: na primeira execução do CI, conferir a classe do runner e se houve OOM.

**EST-14 → RR-R32-10: aceitável como INFO.** O PASS falso exige três coisas juntas:
1. uma cadeia órfã de uma execução interrompida, viva quando outra começa;
2. que ela alcance o Emulator novo e feche o marco;
3. que a execução nova seja interrompida depois disso.

Além disso, a cadeia órfã concorreria com as suítes da execução nova no mesmo Emulator e tenderia a fazê-las falhar. O gate ainda confere a contagem por suíte e a ausência de "Received SIG" na fase.

A justificativa do executor, a de que a amarração exigiria `$(…)` no script do npm, é fraca: o `sh` das npm scripts aceita `$(…)` no Linux e no CI. Mas o risco é baixo o bastante para não pedir mudança nesta etapa.

## 7. Conferências pedidas, uma a uma

- **O SIGQUIT e o cabeçalho de `executar-em-grupos.mjs`.**
  - `:66` trata o SIGQUIT.
  - O cabeçalho (`:22-29`) confere com o código e com C4: cada sinal vira um SIGINT; o sinal entre os grupos ou depois do último conta; "nunca com 'ok'"; e o sinal só ao `npm` de cima não chega.
- **O `npx` falso em cadeia, SIGHUP, SIGQUIT, o sinal entre os grupos e depois do último, e o prazo 0.**
  - Os testes estão em `e2e-grupos.test.mjs:193-213`, `:537`, `:557` e `:573`. O prazo 0 está em `:354` e `:358`.
  - T01, S06 a S09 e T03 morrem (C13).
  - O diff do arquivo de testes só remove linhas de refatoração. Nenhuma asserção ficou mais fraca, e `--reporter=list` e `--ui-port 0`, antes aceitos, agora são recusados (C19).
- **A lista do que é aceito em `grupos.mjs`:** C5 (EST-13).
- **O RB-04** (`RUNBOOKS.md:50,52`) confere com o código e com C4, menos a frase do `firebase-debug.log` (EST-R3-01).
- **A cópia dos artefatos no `run-oficial.sh`** existe e funcionou (EST-15).
- **Os 52 mutantes do roteiro:** 52/52 mortos na minha cópia (C13).
- **Mutantes meus que sobrevivem:** seis, no EST-R3-02.

## 8. Skill `firebase-production-readiness`

PASS — Firebase production readiness

No escopo da etapa. A leitura de `.claude/skills/firebase-production-readiness/SKILL.md` e de `references/firebase-production-checklist.md` é a da rodada 2, e os dois arquivos não mudaram na árvore.

**Escopo.** O que a P5-F.1-R3.2 toca na plataforma:
- o Emulator no E2E e na integração: ciclo de vida, projeto, portas, desligamento, marco de fase completa e logs por grupo;
- `playwright.config.ts`;
- `tools/e2e/*` e `tools/integracao/marco-da-fase.mjs`;
- os scripts `test:e2e`, `test:tools:e2e`, `test:tools:integracao`, `test:integration:emulator`, `verify:fast` e `verify:all`;
- o CI (`.github/workflows/quality-gate.yml`) e a versão do firebase-tools.

Não é o checklist integral: a etapa não é release nem P10.

**Mapa de ambientes (no escopo):**

| Comando ou destino | Projeto | Evidência |
| --- | --- | --- |
| E2E local e CI (`test:e2e`, executor, `webServer`) | Emulator `minhas-financas-local` | `playwright.config.ts:32,86`; `package.json:44`; a configuração gravada nos três relatórios JSON da execução oficial (C15) |
| Integração e Rules | Emulator `minhas-financas-local` | `package.json:54`; o teste da fiação proíbe o ID de produção (`integracao-marco.test.mjs:80`) |
| Executor e marco | nenhum destino remoto | o executor só chama `npm --prefix functions run build` e `npx playwright test` (`executar-em-grupos.mjs:109,111,143`); o marco só toca `test-results/integracao/marco.json` |
| `.firebaserc`, `default` | produção | anterior à etapa (PR-PLAT-01), não alcançado pelo fluxo: todo comando passa `--project` |
| `deploy:*` | produção | intocados; agentes não os executam |
| CI | sem segredos | sem `secrets.`; firebase-tools 15.32.1 (`quality-gate.yml:151,191`) |

**Inventário de Functions.** Fora do escopo: o diff não toca `functions/`. O emulador de Functions entra só pela memória por grupo e pelo log (seção 3, EST-R3-01).

Observação anterior à etapa: no teste de billing fail-closed, o emulador de Functions tenta ler os segredos Stripe e `APP_ALLOWED_ORIGINS` do Secret Manager e falha em "Failed to authenticate, have you run firebase login?" antes de qualquer pedido, porque não há credencial. Acontece também na rodada 2 e é o caminho que o teste espera; não houve acesso a produção.

**Matriz de evidência** (seções do checklist que o diff exercita):

| Seção | Item | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Os scripts e o CI tocados não têm produção como destino implícito | PASS | o mapa acima; `e2e-grupos.test.mjs:151-166` (sem o ID de produção no config) |
| 1 | CI sem credenciais de produção; testes só no Emulator, com projeto local | PASS | `quality-gate.yml` sem segredos; `playwright.config.ts:86`; `package.json:54` |
| 12 | `firebase.json` define os emuladores usados, e as portas conferidas os cobrem | PASS | `e2e-grupos.test.mjs:138-149`; o `e2e:kill-ports` é amarrado às mesmas portas |
| 12 | Nenhum teste ou script do fluxo tocado depende de credenciais reais ou de rede externa | PASS | executor e marco sem rede; o "Failed to authenticate" do Secret Manager falha antes da rede e é anterior à etapa |
| 12 | O CI executa as suítes Emulator em todo PR | PASS | `quality-gate.yml:117,120,215` e o job de integração; sem mudança desde a rodada 2 |
| 12 / FIRE-13 | Versão da CLI fixa no CI | PASS | `quality-gate.yml:151,191`; W05 morre |
| 12 | O Emulator desliga limpo em cada execução, sem órfão nem limpeza externa | PASS | os três grupos da `verify-all-r32-4`: um SIGTERM, a parada de todos os emuladores e `java=0` entre os grupos; no fim, `portas_ocupadas_no_fim=[]`, `java_no_fim=0` e `limpeza_externa=nenhuma`; o mesmo em todos os `.meta` E2E da R3.2 que terminaram por conta própria |
| 12 | Execução oficial com o Emulator (integração, Rules e E2E em grupos) na árvore sob revisão | PASS | `verify-all-r32-4`: saída 0, conferida por contagem (seção 3) |
| 12 | O resultado da etapa Emulator do `verify:all` reflete a execução das suítes | PASS | o marco: a linha na execução oficial, 22/22 resumos, I01 a I07 mortos |

**Configuração externa pendente (no escopo).** Nenhuma. A classe do runner do GitHub (RR-R32-05) é condição de operação do CI, não item do checklist.

**Achados bloqueantes.** Nenhum.
- O EST-R3-01 (LOW) é a guarda do log de diagnóstico do CLI do Emulator. Não corresponde a item do checklist em falha e não afeta o desligamento limpo, que fica provado.
- O EST-R3-02 e o EST-R3-03 (INFO) são cobertura de teste do harness e documentação.

**Fora do escopo desta avaliação** (itens atribuídos a milestone posterior e não afetados pelo diff):
- §1, separação DEV/STAGING/PROD e `.firebaserc`: PR-PLAT-01 (P6), E-01;
- §1, utilitário com override para produção: PR-PLAT-02 (P6);
- §2, App Check, inclusive no E2E (`"app":"MISSING"` no log): PR-APPCHK-01 (P6), E-02;
- §3, pipeline de deploy de Rules e índices, inclusive o `predeploy:rules` sem o marco (RR-R32-08): PR-REL-01 (P6), E-12;
- §4, opções de runtime das Functions: sem ID próprio no registro; nenhuma alterada;
- §5 e §6, IAM e segredos, inclusive os segredos Stripe no Emulator (o `.secret.local`): E-04, E-05;
- §7, Authentication e o login E2E com o `dist/` compartilhado: PR-AUTH-04 (P6), E-03;
- §8, Hosting: PR-PLAT-03 (P6), E-11;
- §9 e §10, custos, quotas e monitoramento: PR-OBS-01 e PR-OBS-02 (P7), E-08;
- §11, backup, PITR e restore: PR-BKP-01 (P7), E-07;
- §12, projeto `demo-`, guarda única de Emulator e testes que pulam sem Emulator: FIRE-13, INV-16, REL-09 (P6);
- REL-11 (P6): cadeia de suprimentos e varredura de segredos do CI (T-27);
- §13, registro de configuração externa: depende dos itens acima.

**Verificação.** C0 a C19 (seção 2). A leitura do código instalado do firebase-tools 15.32.1 está em C18 e a do Playwright 1.60.0 em C5. A execução oficial `verify-all-r32-4` foi rodada pelo executor e conferida aqui pelo log, pelo `.meta`, pelo amostrador e pelos artefatos; eu não rodei Emulator.

## 9. O que não foi possível verificar

- **O fluxo no CI.** Sem push, não há execução do workflow (RR-R32-05).
- **Os sinais com o Playwright e o firebase-tools de verdade.**
  - C4 e C8 usam um Playwright falso, fiel ao código lido, com o npm, o npx e o dash reais.
  - O efeito do segundo SIGINT no Playwright real foi lido no código na rodada 2, não executado.
  - O Ctrl+C e o Ctrl+\ foram simulados por um sinal ao grupo em primeiro plano, que é o que o terminal faz.
- **A conferência do EST-R3-01 numa falha de verdade por `socket hang up`.** O apagamento do `firebase-debug.log` foi provado pelo código do CLI e pelas quatro execuções vermelhas da R3.2, não por uma falha de rede.
- **Os roteiros finais do próprio executor** (as filas `a` e `b` de `rodar-mutantes-finais.sh`) ainda rodavam durante esta revisão. Rodei o de grupos na minha cópia (C13). Os do cliente são de outras áreas.
- **Outras versões do firebase-tools, Windows e macOS:** fora do ambiente do projeto e do CI.
