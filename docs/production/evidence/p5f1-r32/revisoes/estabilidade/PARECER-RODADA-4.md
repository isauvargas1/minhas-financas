VEREDITO: PASS

# Parecer independente — estabilidade do processo de testes (Frente B), P5-F.1-R3.2, rodada 4 (focada)

Revisor: estabilidade do processo e `firebase-production-readiness` no escopo da etapa. Data: 2026-11-14. Árvore sob revisão: `698f96441df1fbcd63467792c43cdb57b3911d9e`. Pasta: `p5f1r32/revisoes/estabilidade/rodada-4/` (saídas em `logs/`, roteiros em `ka/`, cópias em `copia/`, `copia-mutantes/` e `copia-trava/`).

## Conclusão

- **O link físico do `firebase-debug.log` está correto** e foi conferido em três frentes:
  - **No código.** O Playwright 1.60 limpa a pasta `--output` antes de subir o webServer. Se ela sumir depois do link, o laço refaz o link. O link não é copiado sobre si mesmo. O grupo sem log não guarda nada.
  - **Em oito experimentos (K1–K8).**
  - **Numa execução real.** Durante o grupo 1 da `verify-all-r32-6`, a raiz e `test-results/grupo-1/` tinham o mesmo inode, com 2 links. Nos artefatos da execução, os três grupos têm `firebase-debug.log`:
    - cada um começa com o `emulators:start` do próprio grupo e vai até o desligamento;
    - as linhas `addWorker(` são 120, 78 e 124.
  - A falha ao criar o link é silenciosa e sem efeito no resultado (EST-R4-02).
- **EST-R3-02 está fechado.** Os cinco sobreviventes da rodada 3 morrem pelos testes novos: R3-M01 = U01, R3-M02 = S10, R3-M04 = U17, R3-M06 = X09 e R3-M05, que é o meu R4-M07.
- **Roteiro do executor (57 mutantes): 57/57 mortos na minha cópia.** Houve dois cuidados (seção 3):
  - O reinício interrompeu a primeira passada, e a cópia ficou com o S08 aplicado. Restaurei o arquivo pela árvore, conferi por SHA-256 e retomei do S08.
  - S01 e S05 "morrem" só pelo tempo esgotado de 600 s. É o achado novo EST-R4-01.
- **`verify-all-r32-6` confere por contagem** (seção 4):
  - saída 0, em 2.862 s, árvore `698f9644` no começo e no fim;
  - 1.843 testes de unidade;
  - na integração, 1.289 testes, as 19 suítes de Rules, o marco de fase completa e nenhum sinal na fase;
  - no E2E, 218 testes, cada um uma vez, numa tentativa, `passed`, iguais aos da rodada 3;
  - portas livres e nenhuma JVM no fim, `limpeza_externa=nenhuma`;
  - picos de 9.534, 7.172 e 9.575 MiB;
  - nenhum `socket hang up` nem `ECONNRESET`.
- **`verify-all-r32-5`, interrompida pelo reinício.**
  - O executor fez o que devia: `SIGTERM recebido`, nenhum grupo depois, "não rodou" para os 71 testes do grupo 3 e `FALHOU`.
  - Mas o grupo 3 **não** desligou pelo caminho limpo, ao contrário do que diz a execução 62 do histórico (EST-R4-03).
- **Achados abertos.** Nenhum é HIGH ou MEDIUM, e nenhum leva a PASS falso.
  - **EST-R4-01 (LOW):** o teste novo do segundo sinal trava a suíte e deixa um processo órfão quando o primeiro SIGINT não chega.
  - **EST-R4-02 (INFO):** a falha do link é silenciosa, e o nome que sobra na raiz recebe o log da execução seguinte.
  - **EST-R4-03 (INFO):** a descrição da execução 62 no histórico.
  - **EST-R3-03 (INFO):** continua aberto até o `mutantes.md` ser refeito.
- **Skill:** `PASS — Firebase production readiness`, no escopo da etapa (seção 7).

## 1. Escopo conferido

- **Diff `ef514869..698f9644`:** 9 arquivos.
  - Os da minha área foram lidos por inteiro: `tools/e2e/executar-em-grupos.mjs` (`logs/C1-diff-executor.txt`) e `tests/tools/e2e-grupos.test.mjs` (`logs/C2-diff-testes-executor.txt`).
  - Em `e2e/work-time-p5f.spec.ts`, só comentário.
  - `playwright.config.ts`, `package.json`, `.github/` e `tools/integracao/` não mudaram (`logs/C12-diff-e2e-config.txt`).
  - O restante (`src/modules/work-time/*`, testes de unidade e `DATA_MODEL.md`) é das áreas financeira e adversarial.
- **Também lidos:**
  - a seção "Rodada 3" do `revisoes-LEIAME.md` e as execuções 55 a 63 do histórico;
  - os rascunhos `fluxo-e2e-oficial.md`, `plano-20-20.md` (RR-R32-05) e `mutantes.md`;
  - o RB-04 em `698f9644`.
- **Código instalado:**
  - Playwright 1.60.0, `lib/runner/index.js:5828-5834,5919-5939`: a tarefa "clear output" vem antes do `createPluginSetupTasks`, que sobe o webServer. O `preserveOutputDir` só existe no `TestRunner` (`:6165`, `:6361`), o do modo UI, e não no `playwright test`.
  - firebase-tools 15.32.1: `lib/bin/cli.js:71-75` apaga o log, e `lib/logger.js:114-133` reaproveita um `firebase-debug.log` que já existe.
- **Cópias.**
  - Feitas com `git archive` de `698f9644`, sem `docs/` e com os `node_modules` por link.
  - Nada foi escrito no worktree nem no repositório: nenhum `git write-tree`, e `GIT_OPTIONAL_LOCKS=0` em tudo.
  - Do worktree, só li `test-results/` e `firebase-debug.log` (C8, C13).
- **Sobreposição com a execução oficial.**
  - C5b, C7, C10 e C11 rodaram das 11:37 às 11:53Z, durante o `verify:fast` e a integração da `verify-all-r32-6`. Somam processos `node` às amostras dessas fases.
  - O E2E começou às 11:59Z; durante ele, só fiz leituras.

## 2. Comandos executados e resultados

Nada rodou Emulator, Playwright de verdade, E2E, `npm run verify:*` ou `test:integration*`. As portas usadas foram efêmeras, e tudo rodou com `nice -n 19`, um de cada vez, sem produção e sem segredos.

| # | Comando | Resultado | Saída |
| --- | --- | --- | --- |
| C3 | `node --test tests/tools/e2e-grupos.test.mjs` | 23/23 (19 s) | `logs/C3-tools-e2e.log` |
| C4 | `node --test tests/tools/integracao-marco.test.mjs` | 3/3 | `logs/C4-tools-integracao.log` |
| C5 | `scripts/mutantes-grupos-r32.py` (SHA-256 `40803a6b…`) na `copia-mutantes`, 00:25–00:56Z | 38 mortos (G01–S07). Parado pelo reinício do contêiner no S08 | `logs/C5-mutantes-grupos-r32.log` |
| C5a | a cópia depois do reinício | o arquivo **não** estava restaurado: o `executar-em-grupos.mjs` ainda tinha o S08 (sem SIGQUIT). Restaurei pela árvore e conferi: SHA-256 dos 14 arquivos iguais aos do início, `copia` = `copia-mutantes` | `logs/C5-mutante-deixado-pelo-reinicio.txt`, `logs/C5-hashes-*.txt` |
| C5b | o mesmo roteiro, retomado do 39º mutante (S08) por uma cópia que só acrescenta o índice de início (`ka/mutantes-grupos-r32-retomada.py`), 11:37–11:44Z | **19/19 mortos**. Com C5: **57/57**. Restauração conferida | `logs/C5b-*.log`, `logs/C5b-hashes-depois.txt` |
| C6 | o órfão do S01 em C5 | `node …/e2e-grupos-falsos-…/npx playwright test --shard=1/2`, com `ppid` 1, vivo havia 11 min; encerrado por mim | `logs/C6-orfao-do-S01.txt` |
| C7 | só o teste do segundo sinal (`--test-name-pattern`), com prazo externo de 90 s, sem mutante, com S01 e com S05 (`ka/trava-segundo-sinal.sh`, `copia-trava`) | sem mutante: ok em 1 s. **S01 e S05: `not ok` em cerca de 10 s, mas o processo de teste não termina** (saída 124 aos 90 s), e o falso `npx` fica órfão | `logs/C7-trava-segundo-sinal.txt` |
| C8 | `test-results/grupo-*` do worktree deixados pela `verify-all-r32-5` (só leitura, antes de a r32-6 chegar ao E2E), mais a releitura às 12:03Z | grupos 1 e 2: `firebase-debug.log` com 1 link, `addWorker(` 60 e 37. Grupo 3: 2 links com a raiz (o CLI morreu antes de apagar) e 13 `addWorker(`. Às 12:03Z, esse inode já tinha 57 MB, com o `emulators:exec` da integração da r32-6 (EST-R4-02) | `logs/C8-logs-do-emulador-r32-5.txt` |
| C9 | contagem da `verify-all-r32-5` (`ka/contar-verify.py`) | seção 5 | `logs/C9-contagem-verify-all-r32-5.txt` |
| C10 | oito experimentos com o executor da árvore e um Playwright falso que limpa a pasta `--output` como o real (`ka/experimentos-link.sh`, `ka/falsos/`), mais o `copyFileSync` do Node 22 sobre um link da origem | seção 3 | `logs/C10-experimentos-link.txt` |
| C11 | meus mutantes do código novo (`ka/mutantes-revisor-r4.py`, 7) | 4 mortos. R4-M03, M04 e M06 sobrevivem e são equivalentes (seção 3) | `logs/C11-*.log` |
| C13 | o link ao vivo, durante o grupo 1 da r32-6 (12:03:24Z, só leitura) | raiz e `test-results/grupo-1/firebase-debug.log`: mesmo inode, `links=2`, 7.996.797 bytes | `logs/C13-link-ao-vivo-r32-6.txt` |
| C14 | contagem da `verify-all-r32-6` | seção 4 | `logs/C14-contagem-verify-all-r32-6.txt` |
| C15–C17 | relatórios JSON por grupo contra o repórter `list`; testes pelo `list`; lista contra a da rodada 3 | seção 4 | `logs/C15…C17` |
| C18 | os logs do Emulator guardados por grupo na r32-6 (`ka/logs-por-grupo.py`) | seção 4 | `logs/C18-logs-por-grupo-r32-6.txt` |
| C19–C20 | sinais de problema no log; memória por fase | seção 4 | `logs/C19…`, `logs/C20…` |

## 3. A mudança do EST-R3-01 e do EST-R3-02

**O link físico** está em `executar-em-grupos.mjs:69-86`, com o uso em `:88-104` e `:168-173`:
- a cada 0,5 s, enquanto o grupo roda, se `firebase-debug.log` existe na raiz e ainda não está em `test-results/grupo-i/`, o executor cria a pasta e o link (`linkSync`);
- no fim, só copia o que o link não guardou.

As quatro condições pedidas:

| Condição | Conferência | Resultado |
| --- | --- | --- |
| Corrida com a limpeza do Playwright | No Playwright 1.60, a limpeza vem antes do webServer (seção 1). O executor apaga o log da raiz antes de cada grupo (`:164`), então o arquivo só aparece quando o CLI do grupo sobe, depois da limpeza. Se a pasta some depois do link, o laço o refaz no passo seguinte. K2 (a pasta apagada 0,8 s depois do link): o link é refeito e o conteúdo fica inteiro, `l1|l2|l3`. K7 (log antigo na pasta, com a limpeza): fica o log novo | correto |
| Cópia sobre o próprio link | A guarda `!existsSync(…)` (`:172`) evita a cópia. K3 (o CLI morto antes de apagar, como no grupo 3 da r32-5, C8): o guardado e a raiz são o mesmo inode, `links=2`, com o conteúdo inteiro. Sem a guarda (R4-M03), nada se perde: no Node 22, o `copyFileSync` sobre um link da origem não faz nada (C10). A guarda é defensiva, e o mutante é equivalente | correto |
| Grupo sem log | K4 (sem `firebase-debug.log`): nada é guardado, saída 0. É o caso de `E2E_START_EMULATORS=false` | correto |
| Falha ao criar o link | `catch` com nova tentativa no passo seguinte (`:82-84`). K6 (o link falha e o CLI não apaga): a cópia do fim guarda o log. **K5 (o link falha e o CLI sai limpo): o log se perde, sem aviso, e a execução diz "ok"** | sem efeito no resultado; silencioso (EST-R4-02) |

Experimentos e execuções reais complementares:
- **K8** (log antigo na pasta, com um Playwright que **não** limpa): fica o log antigo. Não acontece no `playwright test`, que sempre limpa (seção 1).
- **Na execução real (C13, C18):**
  - durante o grupo, o link existe;
  - nos artefatos, cada `firebase-debug.log` tem o `Command: … emulators:start --only auth,firestore,functions --project minhas-financas-local`, com a hora de início de cada grupo (12:00:07, 12:07:02 e 12:11:58Z, cerca de 20 s depois do começo de cada relatório);
  - cada um tem um "Received SIGTERM" e um "Shutting down emulators", e termina no "Stopping Logging Emulator" do fim do grupo.

**Os testes novos** (`e2e-grupos.test.mjs:618-689`):
- O segundo sinal (`:618`, falso `.wait2` em `:203-216`) mata U01 e S10, que são meus R3-M01 e R3-M02.
- O grupo morto por sinal (`:639`, `.selfkill` em `:241`) mata U17, o R3-M04.
- O log apagado na saída limpa (`:648`, `.limpo` em `:230-238`) mata K01, R4-M01, R4-M02 e R4-M05. O vermelho no executor anterior é a execução 58.
- O relatório anterior (`:655`) mata X09, o R3-M06.
- O sinal antes do primeiro grupo (`:665`) mata R4-M07, o R3-M05.
- No diff, nenhuma asserção ficou mais fraca. `send` passou a ser `await`ado (`:506`), e `runExecutor` ganhou `rootFiles`.

**Meus mutantes que sobrevivem (C11), todos equivalentes:**
- R4-M03, a cópia sem a guarda: ver acima.
- R4-M06, o link sem conferir o que já está guardado: o `linkSync` dá `EEXIST`, e o `catch` o absorve.
- R4-M04, o laço do link não para na saída do grupo: só teria efeito num grupo sem log próprio seguido de outro com log, e o Emulator de cada grupo sempre escreve o seu.

**O roteiro de 57.** Todos morrem pelo teste certo (C5 e C5b):
- K01 pelo 20; X09 pelo 21; U01 e S10 pelo 18; U17 pelo 19;
- S06 a S09 e T01 como na rodada 3;
- I01 a I07 pelos 24 e 25.

S01 e S05 contam como mortos pelo tempo esgotado de 600 s do roteiro. A suíte trava (EST-R4-01).

## 4. Execução oficial `verify-all-r32-6`, conferida por contagem

**`.meta`:**
- início 11:35:14Z; fim 12:22:57Z; **`exit=0`**; `duracao_s=2862`;
- **`arvore=698f9644` no começo e no fim**;
- Node v22.23.4, Java 21.0.12.1, firebase-tools 15.32.1, `E2E_SHARDS` padrão;
- **`portas_ocupadas_no_fim=[]`, `java_no_fim=0`, `limpeza_externa=nenhuma`**;
- `artefatos=73M e2e-grupos grupo-1 grupo-2 grupo-3`.

**Unidade (C14):**
- os 24 passos com cabeçalho e os 20 resumos somam **1.843 testes, todos aprovados**, com 0 falha, cancelado, pulado ou todo;
- `work-time` 284 e `test:tools:e2e` 23; a diferença para a rodada 3 é de +6 e +5;
- os demais por script como na rodada 3;
- lint: 0 erro e 201 avisos.

**Integração (C14):**
- 22 resumos, na ordem da cadeia: 1.289 testes, 1.289 aprovados;
- Functions 985, limpeza 15, contas 2;
- **as 19 suítes de Rules somam 287**, com as mesmas contagens da rodada 3;
- `Script exited successfully (code 0)` (36762) e **`[integração] fase completa … (execução 422858ce-…)`** (36768);
- **nenhum "Received SIG" na fase.**

**E2E (C14 a C17):**
- `218 testes em 36 arquivos, em 3 grupo(s)`;
- grupo 1: 83/83 em 416 s; grupo 2: 64/64 em 296 s; grupo 3: 71/71 em 679 s;
- **`ok: 218 testes, cada um uma vez, todos passaram`** (61626).
- **Relatórios JSON por grupo:**
  - todos `expected`, cada teste com **um só resultado, `passed` com `retry` 0**;
  - `unexpected`, `flaky` e `skipped` 0; `errors` vazio; nenhuma anotação `skip` ou `fixme`;
  - `shard` 1/3, 2/3 e 3/3, `workers` 1, `forbidOnly` true, `retries` 0, `repeatEach` 1, `timeout` 45.000, Playwright 1.60.0.
- Os 218 são distintos e nenhum arquivo está em dois grupos.
- O conjunto é **igual** ao do repórter `list` (218 "✓", numeração contínua, nenhum outro marcador) e **igual** ao da `verify-all-r32-4`, por arquivo e título, sem nenhuma linha deslocada.
- Três "Received SIGTERM", um por grupo (`gracefulShutdown`); três "All emulators ready"; quatro "Stopping Firestore Emulator".
- Nenhum SIGINT, SIGKILL, "forcefully", "portas em uso", crash de página, `OutOfMemory`, **`socket hang up`, `ECONNRESET`** ou "Request to function failed" (C19). O gatilho do D-P5F1-R32-03 não disparou.

**Logs do Emulator por grupo (C18):**

| Grupo | `firebase-debug.log` | `addWorker(` | CLI iniciado | `firestore-debug.log` |
| --- | --- | --- | --- | --- |
| 1 | 30.476.171 bytes | 120 | 12:00:07Z | 1.425.111 bytes, termina em "server shut down" |
| 2 | 15.318.901 bytes | 78 | 12:07:02Z | 1.461.417 bytes |
| 3 | 24.716.013 bytes | 124 | 12:11:58Z | 2.450.989 bytes, termina em "server shut down" |

Os três `firebase-debug.log` usam o projeto `minhas-financas-local` e não têm nenhuma ocorrência do ID de produção.

**Memória e processos (C20; 285 amostras, contêiner de 16.087 MiB):**

| Fase | Janela (UTC) | Pico | `node` máx. | `java` |
| --- | --- | --- | --- | --- |
| `verify:fast`* | 11:35:19–11:39:40 | 2.456 MiB | 11 | 0 |
| integração e Rules* | 11:39:50–11:58:42 | 2.290 MiB | 13 | 1 |
| build, lista e subida | 11:58:52–12:00:03 | 2.536 MiB | 6 | 0 |
| grupo 1 | 12:00:13–12:06:34 | **9.534 MiB** | 68 | 1 |
| entre 1 e 2 | 12:06:44–12:06:54 | 2.165 MiB | 6 | 0 |
| grupo 2 | 12:07:04–12:11:35 | **7.172 MiB** | 47 | 1 |
| entre 2 e 3 | 12:11:45–12:11:55 | 2.337 MiB | 6 | 0 |
| grupo 3 | 12:12:05–12:22:47 | **9.575 MiB** (pico) | 68 | 1 |

\* Inclui processos meus (C5b a C11). Os grupos ficam na faixa das rodadas 2 e 3, e `java=0` entre eles.

## 5. Leitura da `verify-all-r32-5`, interrompida pelo reinício (C9)

- **Até o reinício.**
  - Unidade: 1.843 testes.
  - Integração: 1.289, com a linha do marco (execução `906f78b4`) e nenhum sinal na fase.
  - Grupos 1 e 2: 83/83 e 64/64.
- **No grupo 3.**
  - Depois do "All emulators ready" (52733), vem `[e2e em grupos] SIGTERM recebido…` (53973) e, logo em seguida, `grupo 3: saída 1, sem relatório, 122 s`.
  - O resumo diz `execução interrompida por SIGTERM: 3 de 3 grupo(s) rodaram`, com 72 problemas: "sem relatório" e os 71 testes do grupo como "não rodou". O fim é `FALHOU`.
  - **O executor tratou o sinal sem aprovação falsa**, e nada rodou depois.
- **O grupo 3 não desligou pelo caminho limpo.**
  - Depois do 52733, o log não tem "Received SIG…" nem "Shutting down emulators" do Emulator do grupo 3 (só os dois dos grupos 1 e 2).
  - O `firebase-debug.log` do grupo 3 ficou na raiz com 2 links (C8): o CLI não chegou ao `exit` que o apaga, porque foi morto.
  - O mais provável é que o desligamento do contêiner tenha mandado sinal a todos os processos de uma vez.
  - "Nenhuma JVM depois do reinício" não prova desligamento limpo, porque o reinício encerra tudo. Ver o EST-R4-03.
- **O `run-oficial.sh` morreu junto:** sem `fim=` e sem artefatos. A execução não vale como oficial, como o histórico registra.

## 6. Situação dos achados da rodada 3, e achados novos

| Achado | Situação | Evidência |
| --- | --- | --- |
| EST-R3-01 (LOW) | **Fechado** | seções 3 e 4 (link no código, K1–K8, ao vivo, artefatos da r32-6 e sobras da r32-5). O RB-04 (`RUNBOOKS.md:52`) e o `keepalive-rr-r31-08.md:59` agora correspondem ao que existe |
| EST-R3-02 (INFO) | **Fechado** | os cinco sobreviventes morrem (seção 3). A robustez do teste novo fica no EST-R4-01 |
| EST-R3-03 (INFO) | **Aberto, parcial** | `fluxo-e2e-oficial.md:69` agora descreve a cadeia órfã da execução 22 como o histórico. O `mutantes.md` ainda é o de 11/11 14:10, com "25/26" e o X03 "equivalente"; o executor diz que o refaz das execuções finais. Por preencher: `fluxo-e2e-oficial.md:37` e `:60` ("XXX de 57") |
| EST-05 (RR-R32-05) | Risco residual aceito | `plano-20-20.md:76` agora traz os picos e a regra do `E2E_SHARDS`. Os números da r32-6 (9,5 GB no máximo) estão dentro do que ele diz |
| EST-14 (RR-R32-10) | Risco residual aceito | sem mudança |

### EST-R4-01: LOW. O teste do segundo sinal trava a suíte e deixa um processo órfão quando o primeiro SIGINT não chega

- **Onde:** `tests/tools/e2e-grupos.test.mjs`.
  - `runExecutorSignaled` só arma o temporizador de 20 s depois de `await send(child, stubs)` (`:506-510`).
  - O `finally` (`:527-531`) só encerra o grupo do executor, e só se ele ainda estiver vivo.
  - No modo `.wait2` (`:203-216`), o falso `npx` é o líder do próprio grupo, criado com `detached` pelo executor. Ele fica num `setInterval` e herdou o stdout e o stderr do executor, que são os sockets que o teste lê.
  - O `send` do teste (`:621-631`) lança `'o primeiro SIGINT não chegou ao grupo'` aos 10 s.
- **Cenário e evidência.** Com uma regressão que impede o primeiro SIGINT de chegar, o teste marca `not ok` em cerca de 10 s. Mas o falso `npx` fica vivo e mantém o socket aberto, e o arquivo de teste **nunca termina**.
  - S01 (sinal não repassado) e S05 (SIGTERM sem tratamento) são esses casos. Em C7, os dois ficam presos até o prazo externo de 90 s (saída 124) e deixam o órfão com `ppid` 1.
  - Em C5, os dois só "morreram" pelos 600 s do roteiro, e às 00:47Z achei um órfão do S01 vivo havia 11 min (C6).
  - O roteiro do executor conta esses casos como "MORTO".
- **Impacto.** Não há PASS falso: a linha `not ok` sai e a execução nunca aprova.
  - Mas `npm run test:tools:e2e`, que está no `verify:fast` e no job de unidade do CI, troca uma falha em segundos por um travamento.
  - O workflow não tem `timeout-minutes`, então vale o teto padrão do GitHub, de horas.
  - Em máquina local, sobra um processo `node` órfão para sempre.
  - É justamente o tipo de regressão que estes testes existem para pegar.
- **Correção sugerida:**
  - armar o temporizador antes de `await send(...)`, ou envolver o `send` num `try/finally` que encerre o falso `npx`;
  - no `finally`, encerrar também o grupo do falso `npx`: com `.wait2`, `process.kill(-stubPid, 'SIGKILL')`, porque ele é líder do grupo; com `.wait`, o grupo do neto;
  - opcional: `{ timeout: 60_000 }` nos testes de sinal do `node:test` e `timeout-minutes` nos jobs do CI.

### EST-R4-02: INFO. A guarda do log falha em silêncio, e o nome que sobra na raiz recebe o log da execução seguinte

- **Onde:** `executar-em-grupos.mjs:82-84` (o `catch` vazio) e `:164-173`. Do lado do firebase-tools, `lib/logger.js:114-133`: ele reaproveita um `firebase-debug.log` que já existe e escreve no fim dele.
- **Cenário e evidência:**
  - (a) K5: sem link físico (`linkSync` com EPERM, por exemplo num sistema de arquivos sem esse recurso) e com o CLI saindo limpo, o log se perde e a linha final é "ok", sem aviso.
  - (b) C8: quando o CLI de um grupo morre antes de apagar o log, como no grupo 3 da r32-5, o nome da raiz continua ligado ao log guardado do grupo. A integração da execução seguinte, que roda antes de o executor apagar a raiz, escreveu nesse mesmo inode: ele passou de 6,3 para 57 MB, com o `Command: … emulators:exec …` da r32-6. A evidência da execução interrompida fica misturada com a da seguinte.
- **Impacto:** só diagnóstico. A execução nova não é afetada: a raiz é apagada antes de cada grupo, e o Playwright limpa a pasta. Os artefatos da r32-6 são limpos (C18).
- **Correção sugerida, opcional:**
  - no fim de cada grupo, depois da cópia, apagar o `firebase-debug.log` da raiz quando o log já estiver guardado, para que nenhum nome compartilhado sobre;
  - escrever um aviso quando o grupo subiu o Emulator e o log não foi guardado.

### EST-R4-03: INFO. A execução 62 do histórico diz "parou o grupo 3 pelo caminho limpo", mas a evidência não sustenta

- **Onde:** `historico-execucoes.md`, execução 62.
- **Evidência:** seção 5. O Emulator do grupo 3 não registrou desligamento, e o log ficou com 2 links porque o CLI foi morto.
- **Correção sugerida:**
  - escrever que o executor recebeu o SIGTERM, repassou o SIGINT e reprovou a execução sem rodar mais nada;
  - escrever que o desligamento do contêiner encerrou o Emulator do grupo 3 por fora, sem o caminho limpo.
- **Nota de texto:** "3 de 3 grupo(s) rodaram" conta o grupo interrompido como rodado. "3 de 3 grupo(s) começaram" seria mais exato. O teste fixa a frase atual (`:547`, `:598`, `:613`, `:636` e `:682`).

## 7. Skill `firebase-production-readiness`

PASS — Firebase production readiness

**Escopo.** No escopo da etapa, como na rodada 3. Itens da mudança:
- o executor do E2E (a guarda do log do Emulator);
- os testes do executor;
- a execução oficial com o Emulator na árvore final.

Não é o checklist integral.

**Mapa de ambientes.** Sem mudança: E2E, integração e Rules só no Emulator `minhas-financas-local`. Os três `firebase-debug.log` dos grupos confirmam o `--project minhas-financas-local` e não têm o ID de produção. `.firebaserc` e `deploy:*` estão intocados. O CI não tem segredos.

**Inventário de Functions.** Fora do escopo: o diff não toca `functions/`.

**Matriz de evidência (seções exercitadas):**

| Seção | Item | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Scripts e CI sem produção como destino | PASS | `playwright.config.ts`, `package.json` e o CI iguais aos da rodada 3; os logs por grupo (C18) |
| 12 | Emulator desligado limpo em cada grupo, sem órfão nem limpeza externa | PASS | r32-6: um SIGTERM por grupo e a parada de todos os emuladores; `java=0` entre os grupos; no fim, `portas_ocupadas_no_fim=[]`, `java_no_fim=0`, `limpeza_externa=nenhuma` |
| 12 | Execução oficial com o Emulator na árvore sob revisão | PASS | `verify-all-r32-6`, saída 0, conferida por contagem (seção 4) |
| 12 | O resultado da etapa Emulator reflete a execução das suítes | PASS | o marco: linha e 22/22 resumos; I01 a I07 mortos |
| 12 | Nenhum teste ou script do fluxo depende de credenciais reais ou de rede externa | PASS | 218/218 sem rede externa. Observação anterior à etapa: durante as execuções, o proxy do ambiente recusou conexões a `firebase-public.firebaseio.com` (a mensagem do dia do CLI, `lib/fetchMOTD.js:35-37`) e a `assets.mixkit.co` (sons da interface, `src/contexts/ThemeContext.tsx:28-30`). Nada depende delas, e nenhuma é do projeto de produção |
| 12 / FIRE-13 | Versão da CLI fixa | PASS | 15.32.1 no `.meta` e no CI |

**Configuração externa pendente (no escopo).** Nenhuma.

**Achados bloqueantes.** Nenhum. O EST-R4-01 é robustez do teste do harness, e o EST-R4-02 e o EST-R4-03 são diagnóstico e registro. Nenhum corresponde a item do checklist em falha.

**Fora do escopo desta avaliação.** É a mesma lista da rodada 3:
- PR-PLAT-01 e E-01 (§1);
- PR-PLAT-02;
- PR-APPCHK-01 e E-02 (§2);
- PR-REL-01 e E-12 (§3, inclusive o RR-R32-08);
- §4, sem ID próprio no registro;
- E-04 e E-05 (§5 e §6);
- PR-AUTH-04 e E-03 (§7);
- PR-PLAT-03 e E-11 (§8);
- PR-OBS-01, PR-OBS-02 e E-08 (§9 e §10);
- PR-BKP-01 e E-07 (§11);
- FIRE-13, INV-16 e REL-09 (§12);
- REL-11 (T-27);
- §13.

**Verificação.** C3 a C20 (seção 2). Eu não rodei Emulator. A execução oficial foi rodada pelo executor e conferida aqui pelo log, pelo `.meta`, pelo amostrador e pelos artefatos.

## 8. O que não foi possível verificar

- **O link num sistema de arquivos sem link físico** foi simulado (K5), não reproduzido. O worktree e o runner Linux do CI usam sistemas que têm o recurso.
- **A causa exata do fim do grupo 3 da r32-5** (que sinais o desligamento do contêiner mandou, e em que ordem) foi deduzida pelo log e pelo inode; não foi observada.
- **O fluxo no CI** (RR-R32-05), por falta de push.
- **Os roteiros finais do próprio executor** na árvore `698f9644`. Rodei o de grupos na minha cópia.
