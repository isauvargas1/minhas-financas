VEREDITO: PASS

# Parecer independente — estabilidade do processo de testes (Frente B), P5-F.1-R3.2, rodada 2

Revisor: estabilidade do processo (RR-R31-07 e RR-R31-08) e `firebase-production-readiness` no escopo da etapa.
Data: 2026-11-11. Árvore sob revisão: `9fddcb5ad93f030bcd991820db85ca9a2b233976`. Pasta: `p5f1r32/revisoes/estabilidade/rodada-2/` (saídas em `logs/`, roteiros em `ka/`).

## Conclusão

- **Os dois motivos do FAIL da rodada 1 caíram.**
  - A execução oficial `verify-all-r32-3`, na árvore `9fddcb5a`, terminou sem interrupção, com saída 0, e confere por contagem: `verify:fast`, integração, as 19 suítes de Rules e o E2E em grupos (seção 3).
  - O EST-10 foi corrigido com o marco de fase completa. Nenhum dos quatro sinais que o firebase-tools trata (SIGINT, SIGTERM, SIGHUP, SIGQUIT), mandado só ao CLI ou ao grupo inteiro, deixa passar uma fase interrompida (C12).
- **Achados da rodada 1:** EST-01, 02, 03, 04, 06, 07, 08 e 10 estão fechados. O EST-05 fica como risco residual registrado (RR-R32-05), agora com a memória medida. O EST-09 era só registro.
- **Achados novos, nenhum HIGH ou MEDIUM:**
  - EST-11 (LOW): os testes do EST-02 deixam vivos quatro mutantes do caminho de interrupção, inclusive o S06 do próprio roteiro do executor.
  - EST-12 a EST-15 (INFO).
  - Nenhum desses achados leva a PASS falso. O comportamento atual foi verificado na cadeia real npm → dash → executor → npx.
- **RR-R31-08:** a decisão D-P5F1-R32-03 está escrita, com gatilho, e o argumento técnico confere no código instalado. O gatilho não disparou na execução oficial: nenhum `socket hang up` ou `ECONNRESET` no log inteiro.
- **Skill:** `PASS — Firebase production readiness`, no escopo da etapa (seção 6).

## 1. Escopo conferido

- **Árvores.**
  - Sob revisão: `9fddcb5a`.
  - Base da rodada 1: `93668199`. Base R3.1: `efcbd264`.
  - O diff `93668199..9fddcb5a` tem 20 arquivos, todos lidos. Os da Frente B foram lidos por inteiro: `tools/integracao/marco-da-fase.mjs`, `tools/e2e/portas.mjs`, `tools/e2e/executar-em-grupos.mjs`, `tools/e2e/grupos.mjs`, `tests/tools/integracao-marco.test.mjs`, `tests/tools/e2e-grupos.test.mjs`, `playwright.config.ts`, e os diffs de `package.json`, `.github/workflows/quality-gate.yml`, README e documentos (RB-01, RB-03, RB-04, RB-05, RB-09; FIREBASE_PRODUCTION §15; THREAT_MODEL T-27; SECURITY_MODEL §10).
- **Minhas cópias.** Duas, extraídas com `git archive` da árvore (`copia/` e `copia-mutantes/`), com os `node_modules` por link. Nada foi escrito no worktree. Só usei `GIT_OPTIONAL_LOCKS=0`, e o HEAD continua `1730a1df`.
- **Rascunhos do executor:** `revisoes-LEIAME.md`, `plano-20-20.md` (D-P5F1-R32-03, RR-R32-01 a 08), `keepalive-rr-r31-08.md`, `fluxo-e2e-oficial.md`, `mutantes.md`, `historico-execucoes.md` e o relatório (seção E).
- **Código instalado:** firebase-tools 15.32.1, Playwright 1.60.0, npm 10.9.9, dash 0.5.12 (`/bin/sh`) e Node v22.23.4.
- **Evidências do executor:** os `.meta` dos E2E da rodada 2; `est02-vermelho.log` e `est10-vermelho.log`; `mutantes-grupos-r32-3.log`; e a execução oficial `verify-all-r32-3` (`.log`, `.log.meta`, `-memoria.txt`), acompanhada do início ao fim.

## 2. Comandos executados e resultados

Nada aqui rodou Emulator, Playwright de verdade, E2E, `npm run verify:*` ou `test:integration*`, e nada abriu as portas 4000, 4400, 4500, 5001, 8080, 9099, 9150, 9299, 9499 ou 5173. As portas usadas foram efêmeras (faixa 32768–60999). Tudo rodou com `nice -n 19`, sem produção e sem segredos. O Playwright e o firebase-tools dos experimentos são falsos, escritos por mim e descritos em cada linha.

| # | Comando (na minha cópia) | Resultado | Saída |
| --- | --- | --- | --- |
| C1 | `node --test tests/tools/integracao-marco.test.mjs` | 3/3 | `logs/C1-tools-integracao.log` |
| C2 | `node --test tests/tools/e2e-grupos.test.mjs` | 15/15 | `logs/C2-tools-e2e.log` |
| C3 | dash 0.5.12 com SIGINT ao grupo enquanto espera um filho (`ka/dash-wce.sh`) | não morre: espera o filho e segue a cadeia, mesmo com o filho morto pelo sinal (D1–D3) | `logs/C3-dash-sigint.log` |
| C4 | cadeia real `npm run verify` → dash → `npm run test:e2e` → dash → cópia do executor → `npx` real → dash → Playwright falso, que trata o SIGINT e leva 4 s no teardown (`ka/cadeia-sinais.mjs`, `ka/proj/`) | cenários X1–X9 na seção 4 (EST-02). O X4 de `C4-cadeia-sinais.txt` saiu errado (o `pgrep` pegou o `sh -c`); vale o `C4-cadeia-sinais-X4.txt` | `logs/C4-*.txt` |
| C5 | parser de argumentos embutido no Playwright 1.60 (commander) com as opções do `playwright test`, contra `refusedArgument` (`ka/args-wrap.cjs`) | `-xj2`, `-xc <arquivo>`, `-xu` e `--debug` passam (EST-13) | `logs/C5-args-agrupados.log` |
| C6 | meus mutantes R01–R06 contra a suíte oficial (`ka/mutantes-revisor-r2.py`; restauração conferida por SHA-256) | R01, R02 e R03 **sobrevivem**; R04, R05 e R06 morrem | `logs/C6-mutantes-revisor-r2.log` |
| C7 | R02 aplicado à cópia do executor na cadeia de C4, SIGTERM ao executor | o Playwright falso nunca recebe o SIGINT; o grupo continua 150 s, até eu encerrá-lo | `logs/C7-*.txt` |
| C8 | SIGTERM ao executor durante a espera de portas entre os grupos 1 e 2 (`ka/entre-grupos.mjs`), sem e com R03 | sem mutante: o grupo 2 não roda, saída 143; com R03: o grupo 2 roda, "ok", saída 0 | `logs/C8-sinal-entre-grupos.log` |
| C9 | contagem por fase do log oficial (`ka/contar-verify.py`, independente do roteiro do executor) | seção 3 | `logs/C9-contagem-verify-all-r32-3.txt` |
| C10 | picos de memória por fase e grupo (`ka/memoria-por-fase.py`) | seção 3 | `logs/C10-memoria-por-fase.txt` |
| C11 | os testes do E2E pelo repórter `list` no log (`ka/testes-do-log.py`) | 218 "✓", 218 distintos, 83/64/71, nenhum outro marcador | `logs/C11-testes-do-log.txt` |
| C12 | script oficial `test:integration:emulator` (texto do `package.json` e marco reais) com o npm de verdade por fora e um firebase falso fiel ao 15.32.1: sobe a cadeia com `sh -c`, desliga no 1º sinal e chama `process.exit()` sem esperar a cadeia; quatro sinais × só no CLI ou no grupo × duas ordens (`ka/marco-sinais.mjs`, `ka/marco/`) | nenhuma fase interrompida passa (EST-10) | `logs/C12-marco-sinais.txt` |
| C13 | o roteiro do executor `scripts/mutantes-grupos-r32.py` (47 mutantes) na minha `copia-mutantes`, restaurada e conferida por SHA-256 | **46/47**; o **S06 sobrevive** (EST-11) | `logs/C13-*.log`, `logs/C13-hashes-*.txt` |
| C14 | a lista da rodada 1 (`lista-suite.json`) contra os testes do log oficial, mais os títulos do `work-time-p5f.spec.ts` em `93668199` e `9fddcb5a` | um único teste novo (ADV-01); o diff de `e2e/` entre as duas árvores é de 78 inserções e nenhuma remoção. A diferença de título contra o `lista-suite.json` (12:35) é a reescrita da Frente A, já presente em `93668199` | `logs/C14-listas-r1-oficial.txt`, `logs/titulos-p5f-*.txt` |

Sobreposição com a execução oficial:
- Meus experimentos C1–C8 rodaram entre cerca de 17:00 e 17:21Z, durante a integração e os primeiros quatro minutos do grupo 1. Eles somam ao amostrador até cerca de 10 processos `node`, por segundos (C7: até 5, por 150 s).
- Os picos dos três grupos (17:23:01, 17:26:31 e 17:39:54) são posteriores. O pico da integração (17:07:17, 2.854 MiB) pode incluir os meus processos.
- C9 a C14 rodaram em Python ou depois do fim da execução oficial.

## 3. Execução oficial `verify-all-r32-3` — conferida por contagem

**Cabeçalho e fim** (`verify-all-r32-3.log.meta`):
- Início 16:49:33Z, fim 17:40:04Z, **`exit=0`**, `duracao_s=3023`. Árvore `9fddcb5a` no início e no fim; firebase-tools 15.32.1, Node v22.23.4, Java 21.0.12.1; `E2E_SHARDS` no padrão.
- O wrapper (`run-oficial.sh`, `with-proxy-safe.sh`) só define `PLAYWRIGHT_BROWSERS_PATH` e o proxy de loopback. Nenhuma variável `E2E_*`, e `test:e2e` roda sem argumentos.
- No fim: **`portas_ocupadas_no_fim=[]`, `java_no_fim=0` e `limpeza_externa=nenhuma (o Emulator desligou sozinho)`**.

**`verify:fast`:**
- Os 24 passos têm o cabeçalho do npm no log.
- Os 20 scripts de teste têm, cada um, o resumo do `node --test`, e somam **1.812 testes, 1.812 aprovados, 0 falha, 0 cancelado, 0 pulado e 0 todo**. Por script: `functions:test:unit` 677; `test:unit:investments` 177; `p1` 131; `billing` 72; `ui` 9; `cash` 23; `loans` 20; `clients` 15; `accounts` 16; `cards` 30; `recurring` 22; `split` 22; `settings-catalog` 17; `ai-chat` 37; `notifications` 99; `goals` 59; `reports` 107; `work-time` 261; `test:tools:e2e` 15; `test:tools:integracao` 3.
- Lint das Functions: 0 erro e 201 avisos. Nenhum `error TS`, `npm error` ou `not ok`; os dois builds terminaram.

**Integração (`test:integration:emulator`):**
- **22 resumos, na ordem da cadeia**, somam 1.289 testes, 1.289 aprovados e 0 falha, cancelado ou pulado.
- Functions 985; `test:tools:limpeza` 15; `test:tools:contas` 2; e as **19 suítes de Rules**: goals 21, investments 7, investment-domain 19, investment-m3 7, m4 41, adjacent 5, workspaces 10, billing 10, receivables 6, accounts 5, cards 5, recurring 5, split 7, transactions-p4d 8, settings-catalog 4, notifications 84, reports 12, work-time 14, projection-marks 17.
- `✔ Script exited successfully (code 0)` (linha 36576 do log sem cores) e **`[integração] fase completa: todas as suítes rodaram até o fim (execução 01b3ca0a-…)`** (36582).
- **Nenhum "Received SIGINT/SIGTERM" na fase de integração**, nenhum "exited with code" e nenhum "emulators failed to shut down".

**E2E (`test:e2e`):**
- `[e2e em grupos] 218 testes em 36 arquivos, em 3 grupo(s)` (36626). O N é 217 + 1: o ADV-01 é o único teste novo (C14).
- Grupo 1: saída 0, 83/83 em 433 s (16 arquivos). Grupo 2: 64/64 em 301 s (9 arquivos). Grupo 3: 71/71 em 705 s (11 arquivos).
- **`[e2e em grupos] ok: 218 testes, cada um uma vez, todos passaram`** (61467): **N igual ao tamanho da lista**.
- Pelo repórter `list` (C11): 218 linhas "✓", 218 testes distintos e numeração contínua por grupo. Nenhum "✘", flaky, skipped, "did not run", interrupted ou "Retry #". O B03-g e o ADV-01 passaram no grupo 3.
- Três "Received SIGTERM for the first time", **um por grupo**: é o `gracefulShutdown` do fim de cada grupo, seguido da parada de UI, Functions, Firestore, Auth, Eventarc, Tasks, hub e logging. Não houve segundo sinal nem saída forçada. Houve três "All emulators ready!", um Emulator novo por grupo.
- **Portas livres entre os grupos:**
  - nenhuma linha "portas ainda em uso";
  - os grupos 2 e 3 começaram;
  - o amostrador mostra `java=0` e a memória de volta a cerca de 1,2 GB entre os grupos (17:23:11–17:23:31 e 17:28:12–17:28:32).
- Nenhum `socket hang up`, `ECONNRESET` ou "Request to function failed" no log inteiro.

**Memória por fase** (contêiner de 16.086 MiB, amostra a cada 10 s; C10):

| Fase | Janela (UTC) | Pico | `node` máx. | `java` máx. |
| --- | --- | --- | --- | --- |
| `verify:fast` | 16:49:34–16:53:44 | 3.032 MiB | 5 | 0 |
| integração e Rules | 16:53:45–17:15:00 | 2.854 MiB | 16 | 1 |
| `build:e2e` e lista | 17:15:09–17:16:19 | 2.934 MiB | 13 | 0 |
| grupo 1 (83 testes) | 17:16:29–17:23:01 | **9.756 MiB** | 68 | 1 |
| entre 1 e 2 | 17:23:11–17:23:31 | 2.453 MiB (mín. 1.185) | 11 | 0 |
| grupo 2 (64 testes) | 17:23:41–17:28:02 | **7.262 MiB** | 45 | 1 |
| entre 2 e 3 | 17:28:12–17:28:32 | 2.085 MiB (mín. 1.188) | 6 | 0 |
| grupo 3 (71 testes) | 17:28:42–17:39:54 | **10.243 MiB** (pico da execução) | 72 | 1 |

Dentro de cada grupo, a memória só cresce: são os processos do emulador de Functions, um por função, sem encerrar os ociosos. Entre os grupos, ela volta ao piso. O isolamento por grupo funciona, e os picos ficam na faixa da R3.1 em grupos manuais (8,9/6,9/10,8 GB).

**Conclusão.** É a execução completa e ininterrupta que a rodada 1 exigia, com cada item conferido por contagem.

## 4. Situação dos achados da rodada 1

| Achado | Situação | Evidência |
| --- | --- | --- |
| EST-10 (MEDIUM) | **Fechado** | abaixo |
| EST-01 (LOW) | **Fechado** | abaixo |
| EST-02 (LOW) | **Fechado** no comportamento; as lacunas de teste viram o EST-11 | abaixo |
| EST-03 (LOW) | **Fechado**: risco aceito por escrito, com gatilho | abaixo |
| EST-04 (LOW) | **Fechado** | RB-01 (`RUNBOOKS.md:23`): firebase-tools 15.32.1 e Java 21, com as linhas do CI (`quality-gate.yml:137-140,148-151,177-180,188-191`, conferidas). FIREBASE_PRODUCTION `:329`, THREAT_MODEL T-27 `:139` e SECURITY_MODEL `:260` atualizados. Nenhum `firebase-tools@latest` na árvore (`git grep`). `e2e:kill-ports` (`package.json:46`) e RB-09 com 9299 e 9499, e um teste amarra essa lista às portas do executor (`e2e-grupos.test.mjs:138-142`). O aviso de versão no executor (opcional) não foi feito; o RB-01 diz a versão validada |
| EST-05 (LOW) | **Mantido como risco residual** (RR-R32-05, configuração externa) | O CI ainda não rodou o fluxo, e a classe do runner não foi confirmada. Com os picos medidos (9,8, 7,3 e 10,2 GB), um runner de cerca de 7 GB não comportaria os grupos 1 e 3, e um de 16 GB comporta, com folga parecida com a daqui. `E2E_SHARDS` (1 a 12) é o ajuste. Falha visível, sem PASS falso |
| EST-06 (INFO) | **Fechado** | Comentário em `grupos.mjs:10-13`. A divisão real da execução oficial é 83, 64 e 71 testes (16, 9 e 11 arquivos), e ainda falta escrevê-la no rascunho `fluxo-e2e-oficial.md:37`, que tem "XXX" |
| EST-07 (INFO) | **Fechado** | `executar-em-grupos.mjs:10-12` |
| EST-08 (INFO) | **Fechado**; sobra residual no EST-13 | `grupos.mjs:43-53` recusa `--retries`, `--repeat-each`, `--timeout`, `--workers`/`-j`, `--config`/`-c`, `--update-snapshots`/`-u` e `--ignore-snapshots`, nas formas `--x`, `--x=` e `-j2`. Teste em `e2e-grupos.test.mjs:66-81`; A01 e A02 mortos (C13) |
| EST-09 (INFO) | Sem ação (registro) | — |

**EST-10 — fechado.**
- **Código.** O script é `package.json:54`: `node tools/integracao/marco-da-fase.mjs iniciar && firebase emulators:exec … "<22 suítes> && node tools/integracao/marco-da-fase.mjs concluir" && node tools/integracao/marco-da-fase.mjs conferir`. O `iniciar` grava um marco aberto e novo; o `concluir` só fecha um marco aberto; o `conferir` apaga o marco e só aprova o fechado (`marco-da-fase.mjs:41-57`). O CI roda o mesmo script (`quality-gate.yml:160`) e os testes do marco (`:119-120`).
- **Por que o sinal virava sucesso** (firebase-tools 15.32.1):
  - a ação é `Promise.race([shutdownWhenKilled, emulatorExec])` (`lib/commands/emulators-exec.js:17-19`);
  - no 1º SIGINT, SIGTERM, SIGHUP ou SIGQUIT, o `processKillSignal` faz `onExit` e `cleanShutdown` e resolve a corrida (`lib/emulator/commandUtils.js:164-219`, `:221-231`);
  - o runner então chama `process.exit()`, com 0 (`lib/command.js:102-129`), sem esperar a cadeia, que fica órfã. Foi o que a execução 22 do histórico mostrou: a cadeia seguiu contra o Emulator desligado (`not ok 872` em diante).
- **Por que a cadeia interrompida não chega ao `concluir`.**
  - Ela é ligada por `&&`, e as suítes exigem `FIRESTORE_EMULATOR_HOST` e se conectam ao Emulator.
  - Nenhuma pula por falta de conexão: as de Rules e as guardas lançam erro sem a variável, e o único `skip` (`investmentDrift.integration.test.ts`) depende da variável, que a cadeia define.
  - Com o Emulator desligado, a suíte em curso falha e a cadeia para.
- **Testes.** C1 dá 3/3. A prova vermelha no script anterior dá 1/3 (`est10-vermelho.log`), e I01 a I07 morrem (C13).
- **C12, os sinais que o firebase-tools trata.** O script oficial roda com o npm de verdade e o dash.
  - Sem sinal: saída 0, "fase completa", 22/22.
  - SIGINT, SIGTERM, SIGHUP ou SIGQUIT só ao CLI: **saída 1** nas duas ordens (a cadeia percebe a queda antes ou depois de o CLI sair). Na ordem da execução 22, aparece a mensagem do marco "a fase de integração não chegou ao fim…", com a cadeia órfã ainda viva.
  - Os mesmos quatro ao grupo inteiro: o npm morre pelo sinal (130, 143, 129, 131), o `conferir` nem roda e o marco fica aberto.
  - O único 0 depois de um sinal é o F9: o sinal chega depois do `concluir`, com as 22 suítes já aprovadas. É resultado verdadeiro, e a conferência do gate ainda o separa pela linha "Received SIG…" na fase.
- **Execução oficial:** a linha do marco aparece, e nenhum "Received SIG" na fase.
- **Resíduos.** O EST-14 (INFO), e o `predeploy:rules`, registrado como RR-R32-08 (P6, PR-REL-01).

**EST-01 — fechado.**
- A espera foi para `tools/e2e/portas.mjs:9-29`, que só consulta: uma conexão aceita em 127.0.0.1 é porta ocupada.
- O prazo vem de `parsePortWait` (`grupos.mjs:28-41`): o padrão e o teto são 60 s, só inteiros de 0 a 60.000. Encurtar só antecipa a reprovação, porque a porta presa no fim do prazo reprova (`executar-em-grupos.mjs:127-128,152-156,164`).
- Os testes 3 e 10 a 13 cobrem os casos que faltavam: a porta ocupada antes do 1º grupo, presa depois do último, presa depois do 1º (o grupo 2 não roda) e liberada em poucos segundos. P01 a P06 morrem (C13).
- Na execução oficial, a espera passou entre os grupos sem reprovar (seção 3).

**EST-02 — fechado no comportamento.** O Playwright de cada grupo roda num grupo de processos próprio (`executar-em-grupos.mjs:67`, `detached: true`). SIGINT, SIGTERM e SIGHUP ao executor viram SIGINT ao grupo em curso (`:49-64`), os grupos seguintes não rodam, e a saída é 128 + o sinal (`:161-170`). Na cadeia real (C4):

| Cenário | O Playwright recebe | Quando o processo do topo sai | O que sobra |
| --- | --- | --- | --- |
| X1, Ctrl+C (SIGINT ao grupo, como o terminal faz) | 1 SIGINT | depois do teardown (5,6 s; sinal em 1,6 s), saída por SIGINT | nada |
| X4, SIGTERM só ao executor | 1 SIGINT | depois do teardown, saída 143 | nada |
| X3, SIGTERM ao grupo | 1 SIGINT | na hora (npm e dash morrem), saída por SIGTERM | o executor termina o desligamento órfão (4 s); depois, nada |
| X6, SIGHUP ao grupo | 1 SIGINT | na hora, saída por SIGHUP | idem X3 |
| X5, dois Ctrl+C com 2 s de intervalo | **2 SIGINT** | depois do teardown | nada no falso; no real, o 2º interrompe o teardown (EST-12 d) |
| X2/X8, SIGTERM só a um `npm` acima do executor | nada | na hora, saída 143 | a execução inteira segue órfã (EST-12 b) |
| X7, SIGQUIT ao grupo | nada | na hora, saída por SIGQUIT | o grupo do Playwright termina sozinho (EST-12 a) |
| X9, SIGKILL ao executor | nada | na hora, saída 137 | o grupo do Playwright termina sozinho; inevitável (RR-R32-04) |

O RB-04 documenta a interrupção, o Ctrl+C duplo e a conferência das portas antes da execução seguinte. A prova vermelha no executor anterior é `est02-vermelho.log` (11/12), e S01 a S05 morrem (C13). As lacunas dos testes estão no EST-11 e os caminhos não cobertos no EST-12; nenhum dá PASS falso.

**EST-03 — fechado.**
- **A decisão.** D-P5F1-R32-03 e RR-R32-03 estão no rascunho do plano (`plano-20-20.md:38,69`), em `keepalive-rr-r31-08.md:9,60` e na seção E do relatório. Risco aceito por escrito, com gatilho: "qualquer `socket hang up` ou `ECONNRESET` numa execução oficial leva ao endurecimento de todo o tráfego do `APIRequestContext` antes da execução seguinte, sem repetir a execução até passar". O texto final em `docs/production/` precisa manter o gatilho.
- **O argumento técnico confere** no Playwright 1.60.
  - O agente HTTP com keep-alive é um só por processo (`coreBundle.js:7945-7946`), usado pelo `fetch` do `APIRequestContext` (`:25944`), inclusive pelo `route.fetch()`, que sete specs usam.
  - No Node 22, um pedido com `Connection: close` ainda pega um soquete livre do pool.
  - Por isso o `Connection: close` só nos auxiliares não afastaria a corrida.
- **Na execução oficial, o gatilho não disparou:** 0 ocorrências no log inteiro.
- **Nota.** O gatilho, lido ao pé da letra, também dispararia com o "Request to function failed: socket hang up" que o Emulator escreve no desligamento, visto na rodada 1. A leitura literal é conservadora, sem risco de PASS falso.

## 5. Achados novos

Nenhum HIGH ou MEDIUM. Nenhum leva a PASS falso.

**EST-11 — LOW. Os testes do EST-02 deixam vivos quatro mutantes do caminho de interrupção.**
- **Onde:** `tests/tools/e2e-grupos.test.mjs:411-506` (o roteiro `runExecutorSignaled` e o teste dos três sinais) e o falso `npx` no modo `.wait` (`:185-196`). Esse falso é o líder e o único processo do próprio grupo, e trata o sinal ele mesmo.
- **Cenário e evidência:**
  - **R01**, o SIGHUP fora da lista (`executar-em-grupos.mjs:64`): sobrevive (C6), porque nenhum teste manda SIGHUP.
  - **R02**, `process.kill(current.pid, 'SIGINT')` no lugar de `-current.pid` (`:59`), que é o que um `child.kill('SIGINT')` faria: sobrevive (C6). Na cadeia real, o `npx` repassa o SIGINT só ao `sh -c` filho, e o dash, enquanto espera, não o repassa. O Playwright não recebe nada, e o grupo segue até o fim (C7: 150 s sem sinal, até eu encerrá-lo).
  - **R03**, o sinal fora de um grupo ignorado: sobrevive (C6). Na cadeia real, um SIGTERM durante a espera de portas entre os grupos se perde: o grupo 2 roda, e a execução termina com "ok" e saída 0. Sem o mutante, o grupo 2 não roda e a saída é 143 (C8).
  - **S06**, do roteiro do próprio executor (`ok` sem `interrupted === null`): sobrevive (C13, 46/47), porque nenhum teste manda o sinal depois do último grupo. O rascunho `fluxo-e2e-oficial.md:58` põe "S01 a S06" entre os mortos.
- **Impacto.** O código atual está certo (C4, C8). Mas uma regressão natural passaria na suíte oficial e no CI: trocar por `child.kill('SIGINT')`, tirar o SIGHUP ou reordenar o `interrupt`. Com ela, o Ctrl+C deixaria de parar o grupo, ou se perderia. Os resultados dos testes continuam conferidos pela lista.
- **Correção sugerida:**
  - o falso `npx` sobe um `sh -c` e, dentro dele, o processo que trata o sinal, como na cadeia real; assim só um sinal ao grupo chega a esse processo;
  - acrescentar casos com SIGHUP e com o sinal durante a espera de portas entre os grupos e depois do último (o `.hold` do roteiro já serve);
  - somar R01, R02 e R03 ao `mutantes-grupos-r32.py`;
  - corrigir a contagem em `mutantes.md` e em `fluxo-e2e-oficial.md`.

**EST-12 — INFO. Caminhos de interrupção que o executor não cobre.**
- **Casos (C4):**
  - (a) **SIGQUIT** (Ctrl+\) não é tratado (`:64`). O executor morre, e o grupo do Playwright, em sessão própria, termina o grupo em curso e desliga o Emulator sozinho (X7). O firebase-tools trata SIGQUIT como desligamento.
  - (b) **SIGTERM só a um `npm` acima do executor** (`kill <pid do npm>`, `timeout --foreground`). O npm repassa o sinal ao `sh` filho, o dash morre, e nada chega ao executor: a execução segue órfã até o fim (X2, X8). É do npm com o dash, anterior à etapa, e vale também para a integração.
  - (c) **SIGTERM ou SIGHUP ao grupo inteiro.** O npm e o dash saem na hora, e o executor termina o desligamento órfão: 4 s aqui, até os 60 s do `gracefulShutdown` no Emulator real (X3, X6). Quem chamou recebe a saída antes de o Emulator desligar.
  - (d) **Cada sinal recebido vira um SIGINT ao Playwright, não só o primeiro** (`:57-62`; X5). Num Playwright 1.60, um segundo sinal de qualquer tipo, depois de 1 s, interrompe o teardown, que tem um `SigIntWatcher` próprio (`runner/index.js:5576-5621`, `:5643-5696`). A saída por `gracefullyProcessExitDoNotHang` (`cli/testActions.js:95-96`) chama `gracefullyCloseAll()` (`coreBundle.js:8549-8558`). A segunda chamada de `gracefullyClose` do `webServer`, que ainda está desligando, é o "forcefully close" (`:8669-8674`), com SIGKILL ao grupo do firebase-tools (`:8698`). A JVM pode ficar. O RB-04 fala em "segundo Ctrl+C"; o cabeçalho do executor diz "repassa um SIGINT".
- **Impacto.** Não há PASS falso: quem chamou vê saída diferente de 0 ou morte por sinal, e a execução seguinte reprova com "portas em uso" (RB-04, RB-09). O RR-R32-04 cobre o Ctrl+C duplo e o SIGKILL.
- **Correção sugerida:**
  - tratar SIGQUIT como os outros;
  - uma linha no RB-04 e no RR-R32-04: o sinal precisa chegar ao executor ou ao grupo inteiro; depois, esperar a linha final do executor e conferir as portas; qualquer segundo sinal força a saída;
  - opcional: repassar só o primeiro sinal.

**EST-13 — INFO. A recusa de argumentos do EST-08 não pega agrupamentos curtos nem `--debug`.**
- **Onde:** `grupos.mjs:51`. `REFUSED_SHORT = /^-(?:j|c|u)(?:\S*)$/` só olha a primeira letra depois do hífen.
- **Evidência:** C5, com o parser embutido do próprio Playwright. `-xj2` dá `workers: "2"`, `-xc outro.config.ts` dá `config` e `-xu` dá `updateSnapshots`, porque o `-x` é booleano (`program.js:205`). O `--debug` é atalho de `--timeout=0 --max-failures=1 --headed --workers=1` (`:171`). Nenhum deles é recusado.
- **Impacto:** só com argumento deliberado numa execução local. O `verify:all` e o CI não passam argumentos, e a linha final diz quantos testes rodaram.
- **Correção sugerida:** recusar todo agrupamento curto que contenha `j`, `c` ou `u` (por exemplo, `/^-[A-Za-z]*[jcu]/` no que não começa com `--`) e recusar `--debug`.

**EST-14 — INFO. O marco não é amarrado à cadeia que o fecha.**
- **Onde:** `marco-da-fase.mjs:44-49`. O `concluir` fecha qualquer marco aberto em `test-results/integracao/marco.json`, e o `execucao` gravado pelo `iniciar` nunca é conferido.
- **Cenário:** uma cadeia que ficou órfã depois de uma interrupção, como a da execução 22, e que ainda esteja viva quando outra execução começa, pode alcançar o Emulator novo e fechar o marco dessa outra execução. Para virar PASS falso, a execução nova ainda teria de ser interrompida depois disso.
- **Impacto:** improvável, e a conferência do gate pela linha "Received SIG…" na fase o pegaria.
- **Correção sugerida, opcional:** `M=$(node tools/integracao/marco-da-fase.mjs iniciar) && firebase emulators:exec … "… && node tools/integracao/marco-da-fase.mjs concluir $M" && node tools/integracao/marco-da-fase.mjs conferir $M`, com o `iniciar` imprimindo o `execucao` e o `concluir` e o `conferir` exigindo o mesmo.

**EST-15 — INFO. Os relatórios por grupo e os logs do Emulator da execução oficial não foram preservados.**
- **Onde:** `test-results/e2e-grupos/grupo-<n>.json` e `test-results/grupo-<n>/` no worktree. O `run-oficial.sh` não os copia.
- **Cenário:** às 17:40:54Z, a execução `e2e-adv01-r32-2` começou no mesmo worktree, e às 17:42:04 o `test-results/` só tinha `.playwright-artifacts-0`. Não achei cópia em nenhum lugar do scratchpad.
- **Impacto:** a evidência da execução oficial fica só no log, que basta para o RB-05 e para a conferência por contagem (C9, C11). Os logs do Emulator por grupo, que o RB-04 descreve, ficaram fora da evidência.
- **Correção sugerida:** no fim do `run-oficial.sh`, copiar `test-results/e2e-grupos/` e `test-results/grupo-*/` para a evidência, antes de qualquer outra execução no worktree.

## 6. Skill `firebase-production-readiness`

PASS — Firebase production readiness

No escopo da etapa. Lidos `.claude/skills/firebase-production-readiness/SKILL.md` e `references/firebase-production-checklist.md`.

**Escopo.** O que a P5-F.1-R3.2 toca na plataforma:
- o Emulator no E2E e na integração: ciclo de vida, projeto, portas, desligamento e o marco de fase completa;
- `playwright.config.ts`;
- os executores `tools/e2e/*` e `tools/integracao/marco-da-fase.mjs`;
- os scripts `test:e2e`, `test:tools:e2e`, `test:tools:integracao`, `test:integration:emulator`, `verify:fast` e `verify:all`;
- o CI (`.github/workflows/quality-gate.yml`), inclusive a versão do firebase-tools.

Não é o checklist integral: a etapa não é release nem P10.

**Mapa de ambientes (no escopo).**

| Comando ou destino | Projeto | Evidência |
| --- | --- | --- |
| E2E local e CI (`test:e2e`, executor, `webServer`) | Emulator `minhas-financas-local`, `singleProjectMode` | `playwright.config.ts:86`; `package.json:43-44`; `firebase.json:66-84` (auth 9099, firestore 8080, functions 5001, UI 4000) |
| Integração e Rules (`test:integration:emulator`) | Emulator `minhas-financas-local` | `package.json:54`; o teste da fiação proíbe o ID de produção (`integracao-marco.test.mjs:80`) |
| Marco e executor | nenhum destino remoto | o marco só lê e grava `test-results/integracao/marco.json`; o executor só chama `npm --prefix functions run build` e `npx playwright test` (`executar-em-grupos.mjs:107,109,141`) |
| `.firebaserc`, `default` | produção | anterior à etapa (PR-PLAT-01), não alcançado pelo fluxo, porque todo comando passa `--project` |
| `deploy:*` | produção | anteriores e intocados; agentes não os executam |
| CI | sem segredos e sem credenciais | sem `secrets.`; firebase-tools 15.32.1 (`quality-gate.yml:151,191`); Java 21; Node 22 e 24 |

**Inventário de Functions.** Fora do escopo: o diff não toca `functions/`, exports, opções de runtime nem gatilhos. O emulador de Functions entra só pela memória por grupo (seção 3).

**Matriz de evidência (seções do checklist exercitadas pelo diff).**

| Seção | Item | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Os scripts e o CI tocados não têm produção como destino implícito | PASS | `package.json:43-44,48-49,54-56`; o mapa acima; `e2e-grupos.test.mjs:156`; `integracao-marco.test.mjs:80` |
| 1 | CI sem credenciais de produção; testes só no Emulator, com projeto local | PASS | `quality-gate.yml` sem segredos; `playwright.config.ts:86`; `package.json:43,54` |
| 12 | `firebase.json` define os emuladores usados, com projeto local e `singleProjectMode` | PASS | `firebase.json:66-84`; as portas conferidas cobrem as do `firebase.json` e as auxiliares (`grupos.mjs:130-133`; `e2e-grupos.test.mjs:132-143`) |
| 12 | Nenhum teste ou script do fluxo tocado depende de credenciais reais ou de rede externa | PASS | executor e marco sem rede; preparo em 127.0.0.1 (`e2e/support/callables.ts`); o wrapper da execução oficial só põe um proxy de loopback, requisito deste contêiner |
| 12 | O CI executa as suítes Emulator em todo PR | PASS | `quality-gate.yml:11-13` (`push`, `pull_request`), `:160` (integração), `:214-215` (E2E), `:116-120` (testes do executor e do marco) |
| 12 / FIRE-13 | Versão da CLI fixa no CI (parte do TARGET de P6, `FIREBASE_PRODUCTION.md` §15) | PASS no CI | `quality-gate.yml:151,191`; o RB-01 diz a versão validada para uso local (EST-04 fechado) |
| 12 | Emulator desligado limpo em cada execução, sem órfão nem limpeza externa | PASS | os três grupos da `verify-all-r32-3`: um SIGTERM, a parada de todos os emuladores, `java=0` entre os grupos; no fim, `portas_ocupadas_no_fim=[]`, `java_no_fim=0` e `limpeza_externa=nenhuma`; idem nos quatro E2E da rodada 2, inclusive os três vermelhos |
| 12 | Execução oficial com o Emulator (integração, Rules e E2E em grupos) na árvore sob revisão | PASS | `verify-all-r32-3`: saída 0 em 3.023 s, conferida por contagem (seção 3) |
| 12 | O resultado da etapa Emulator do `verify:all` reflete a execução das suítes | PASS | o marco (EST-10): C1, a prova vermelha, I01–I07 (C13) e C12; na execução oficial, a linha do marco e 22/22 resumos |

**Configuração externa pendente (no escopo).** Nenhuma. A classe do runner do GitHub (RR-R32-05) é condição de operação do CI, não item do checklist; fica como risco residual, agora com os picos medidos.

**Achados bloqueantes.** Nenhum. EST-11 (LOW) é cobertura de teste do caminho de interrupção do harness, cujo comportamento foi verificado. EST-12 a EST-15 (INFO) são documentação, robustez opcional e preservação de evidência. Nenhum deles corresponde a item do checklist em falha.

**Fora do escopo desta avaliação** (itens do checklist atribuídos a milestone posterior e não afetados pelo diff):
- §1, separação DEV/STAGING/PROD e `.firebaserc`: PR-PLAT-01 (P6), E-01;
- §1, utilitário com override para produção: PR-PLAT-02 (P6);
- §2, App Check, inclusive o E2E com o provedor de depuração (os logs mostram `"appCheck":"absent"`): PR-APPCHK-01 (P6), E-02;
- §3, pipeline de deploy de Rules e índices e CD, inclusive o `predeploy:rules` sem o marco (RR-R32-08): PR-REL-01 (P6), E-12;
- §4, opções de runtime das Functions: sem ID próprio no registro; nenhuma alterada;
- §5 e §6, IAM e segredos: E-04, E-05;
- §7, Authentication, e o login E2E no código de produção com o `dist/` compartilhado: PR-AUTH-04 (P6), E-03;
- §8, Hosting: PR-PLAT-03 (P6), E-11;
- §9 e §10, custos, quotas e monitoramento: PR-OBS-01 e PR-OBS-02 (P7), E-08;
- §11, backup, PITR e restore: PR-BKP-01 (P7), E-07;
- §12, projeto `demo-`, guarda única de Emulator e testes que pulam sem Emulator: FIRE-13, INV-16, REL-09 (P6);
- REL-11 (P6): cadeia de suprimentos e varredura de segredos do CI (actions por tag, `permissions`, gitleaks; T-27);
- §13, registro de configuração externa: depende dos itens acima.

**Verificação.** C1 a C14 (seção 2). A leitura do código instalado do firebase-tools 15.32.1, do Playwright 1.60.0 e do npm 10.9.9 está citada nas seções 4 e 5. A execução oficial `verify-all-r32-3` foi acompanhada do início ao fim e conferida por contagem; foi rodada pelo executor, e eu não rodei Emulator.

## 7. O que não foi possível verificar

- **O fluxo no CI.** Sem push, não há execução do workflow, e não sei a classe do runner nem a visibilidade do repositório. Não consultei o GitHub (RR-R32-05).
- **Os relatórios JSON por grupo e os logs do Emulator da execução oficial**, apagados pela execução seguinte (EST-15). A conferência independente foi feita pelo log (C9, C11).
- **Os sinais com o Playwright e o firebase-tools de verdade.** Os experimentos C4, C7, C8 e C12 usam falsos fiéis ao código lido, com o npm, o npx e o dash reais. O efeito do segundo SIGINT no Playwright real (EST-12 d) foi lido no código, não executado, porque eu não podia rodar Playwright nem Emulator.
- **Um terminal de verdade.** O Ctrl+C foi simulado por um SIGINT ao grupo em primeiro plano, que é o que o terminal faz.
- **A variante `socket hang up` do RR-R31-08 sob contenção de CPU, com Node 24 e contra o Auth.** Coberta só pela decisão com gatilho (EST-03).
- **Outras versões do firebase-tools, além do Windows e do macOS.** Fora do ambiente do projeto e do CI.
