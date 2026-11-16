# P5-F.1-R3.2 — Frente B: o E2E oficial em grupos (RR-R31-07)

**Problema (R3.1).**
- Nenhuma das quatro execuções completas do `npm run verify:all` na árvore final da R3.1 terminou com saída 0.
- Cada uma falhou por uma causa ambiental diferente no fim do E2E: o processo a frio, a conexão encerrada e o OOM do navegador.
- Os 216 testes passaram em três grupos de 68, 70 e 78 testes, cada grupo com o próprio Emulator. Esse caminho era um roteiro do executor, fora do procedimento oficial.

**Resultado (R3.2).**
- O isolamento por grupos passou a ser o procedimento oficial: `npm run test:e2e`, chamado pelo `verify:all` e pelo job de CI.
- Duas causas foram corrigidas na origem.
- A execução oficial: `testes-e-resultados.md`, seção "Procedimento oficial".

## Causas

| # | Causa | Evidência | Correção |
| --- | --- | --- | --- |
| C1 | **JVM do Firestore órfã depois de cada execução do Playwright.** O Playwright 1.60 encerra o `webServer` sem `gracefulShutdown` com SIGKILL no grupo de processos, e o firebase-tools sobe a JVM do emulador do Firestore como processo destacado, em outro grupo. A JVM sobrevivia na porta 8080, e o Emulator seguinte não subia (por isso a R3.1 precisou de limpeza externa entre os grupos) | `node_modules/playwright/lib/runner/index.js:840-846`: sem `gracefulShutdown`, `attemptToGracefullyClose` lança "skip graceful shutdown". `node_modules/playwright-core/lib/coreBundle.js:8669-8698`: então vem `process.kill(-pid, "SIGKILL")`. `firebase-tools/lib/emulator/downloadableEmulators.js:334`: `detached: true`. Nas execuções da R3.1, a etapa `stop-own-emulator.sh` encerrava a JVM órfã depois de cada grupo | `playwright.config.ts`: `gracefulShutdown: { signal: 'SIGTERM', timeout: 60_000 }`. Com SIGTERM, o firebase-tools desliga todos os emuladores; o prazo só limita o desligamento. Em todas as execuções E2E da R3.2 que terminaram normalmente, o `.meta` registra portas livres, nenhuma JVM e `limpeza_externa=nenhuma` |
| C2 | **Memória acumulada do emulador de Functions numa sessão.** Ele mantém um processo por função chamada e não encerra os ociosos. A suíte inteira chegava a 13–14,4 GB, com 97 a 104 processos `node`: um processo subia a frio sob pressão, o Chrome era morto por OOM e uma conexão era encerrada no preparo | Picos da R3.1 (`evidence/p5f1-r31/testes-e-resultados.md`, execuções 22, 24 e 26) e o registro do kernel (`dmesg`) na execução 26 | Grupos de arquivos (`--shard=i/N` do Playwright, N = 3 por padrão), um depois do outro, cada um com o próprio Emulator, que começa vazio e é desligado no fim do grupo |
| C3 | **Nova tentativa automática no CI** (`retries: 2`). Uma falha intermitente podia passar despercebida | `playwright.config.ts` da R3.1 | `retries: 0` em todo lugar e `forbidOnly: true`. O executor reprova qualquer resultado com mais de uma tentativa |
| C4 | **Emulator da versão do dia no CI** (`firebase-tools@latest`). Uma versão nova mudaria o ambiente sem aviso | `.github/workflows/quality-gate.yml` da R3.1 | Fixado em 15.32.1, a versão validada, nos dois jobs com Emulator |

## O executor (`tools/e2e/executar-em-grupos.mjs`)

1. Compila as Functions (as specs carregam `functions/lib`) e lista a suíte com os mesmos argumentos: `playwright test --list --reporter=json`.
2. Remove os relatórios anteriores e espera as portas do Emulator e do frontend livres, por até 60 s, sem encerrar processo nenhum (`tools/e2e/portas.mjs`; `E2E_PORT_WAIT_MS` só encurta esse prazo, de 0 a 60 s, para os testes do executor). Porta ainda ocupada no fim do prazo reprova sem rodar grupo nenhum.
3. Para cada grupo, roda `playwright test --shard=i/N --output=test-results/grupo-i`, num grupo de processos próprio, com:
   - o relatório JSON do grupo (`E2E_SHARD_REPORT`);
   - o HTML do grupo, no CI;
   - os logs do Emulator do grupo guardados em `test-results/grupo-i/`: o `firestore-debug.log`, copiado no fim, e o `firebase-debug.log`, que o firebase-tools apaga ao sair limpo (sem `DEBUG`, saída 0 ou 1; `lib/bin/cli.js:71-75`), por um link físico feito enquanto o grupo roda (EST-R3-01);
   - a espera das portas livres antes do próximo grupo. Porta ainda ocupada interrompe e reprova ("ainda em uso"), e os grupos seguintes não rodam.
4. Confere os relatórios contra a lista completa e só passa quando cada teste rodou exatamente uma vez, numa tentativa só, e passou. Reprovam: teste que não rodou, repetido, fora da lista, instável, ignorado, falho, com mais de uma tentativa, grupo sem relatório, lista vazia, grupo com saída diferente de 0, porta presa e interrupção.
5. Só aceita os argumentos que escolhem o que roda e o rastro: arquivos e linhas, `-g`/`--grep`, `--grep-invert`, `--project`, `--trace`, `-x` e `--max-failures` (o valor de uma opção aceita não pode ser outra opção). Qualquer outro é recusado: `--shard`, `--last-failed` e `--list` (quem divide e lista é o executor), os que mudam o critério dos testes (`--retries`, `--repeat-each`, `--timeout`, `--workers`/`-j`, `--config`/`-c`, `--update-snapshots`/`-u`, `--ignore-snapshots`, `--debug`), também nas formas curtas combinadas (`-xj2`, `-xc`, `-xu`), e os de relatório e interface (EST-08, ADV-R2-03, EST-13). `E2E_SHARDS` fora de 1 a 12 também é recusado. A linha final diz quantos testes rodaram.
6. **Interrupção** (EST-02, EST-11, EST-12). SIGINT, SIGTERM, SIGHUP ou SIGQUIT ao executor (Ctrl+C, `timeout`, cancelamento do CI, terminal fechado, Ctrl+\) viram um SIGINT ao grupo de processos do Playwright em curso, o mesmo que um Ctrl+C nele: o Playwright para e desliga o Emulator do grupo pelo `gracefulShutdown`. Como o Playwright está noutro grupo, o SIGTERM mandado ao grupo do executor não o mata antes do desligamento (o que deixava o Emulator de pé na rodada 1). O sinal recebido sem grupo em curso (na espera das portas entre os grupos ou depois do último) também conta. Os grupos seguintes não rodam, e a saída é 128 + o número do sinal (130, 143, 129 ou 131), nunca "ok". Cada sinal recebido vira um SIGINT: o segundo, depois de 1 s, força a saída do Playwright e pode deixar o Emulator de pé. Um sinal só ao `npm` de cima não chega ao executor (RB-04, RB-09).

**O que não muda.** Os mesmos arquivos e testes, as mesmas asserções e prazos, a mesma configuração do Playwright (`workers: 1`, `fullyParallel: false`), o mesmo build e o mesmo projeto `minhas-financas-local`. Cada spec cuida do próprio isolamento de dados (limpa o Emulator, apaga o que criou ou usa ids próprios), então não depende do Emulator do teste anterior (EST-07).

**Por que N = 3.** É a quantidade validada na R3.1 e na R3.2 (picos de memória por grupo na execução oficial). A divisão é a do `--shard` do Playwright, por arquivo e na ordem da lista (com `fullyParallel: false`), e não a divisão manual da R3.1: 83, 64 e 71 testes na execução oficial (EST-06).

## Fiação e testes

- `package.json`:
  - `test:e2e` = `npm run build:e2e && node tools/e2e/executar-em-grupos.mjs`;
  - `test:tools:e2e` roda os testes do executor;
  - o `verify:fast` passa a incluí-los;
  - o `verify:all` termina no `test:e2e`.
- CI:
  - o job "E2E" roda `npm run test:e2e`;
  - o job de unidade roda `npm run test:tools:e2e` e `npm run test:tools:integracao`;
  - os jobs com Emulator instalam o firebase-tools 15.32.1.
- `tests/tools/e2e-grupos.test.mjs`, com 23 testes:
  - as decisões puras: quantidade, argumentos recusados, chaves estáveis e conferência da lista;
  - as portas contra o `firebase.json`;
  - o executor de ponta a ponta, com `npm` e `npx` falsos no PATH: grupos em sequência, cada um com relatório, saída e logs próprios; teste que não rodou, instável, repetido, grupo com saída 1 ou sem relatório; argumento recusado, quantidade inválida, build ou lista com falha;
  - a fiação: `package.json`, `playwright.config.ts` e CI;
  - a espera das portas (o auxiliar com prazo curto; o executor com a porta presa antes do primeiro grupo, depois do último e depois do primeiro, e com a porta que libera em poucos segundos), o prazo que só encurta e a lista de portas do `e2e:kill-ports`;
  - a interrupção, com o executor de verdade e um `npx` falso em cadeia, como o real (`npx` → `sh` → o processo que trata o sinal; só o sinal ao grupo chega a ele; ADV-R2-02): SIGTERM ao executor, SIGTERM ao grupo de processos dele, Ctrl+C, SIGHUP e SIGQUIT (um SIGINT só ao grupo do Playwright, o grupo 2 não roda, saída 143, 130, 129 ou 131, nada órfão); o sinal durante a espera das portas entre os grupos (o grupo 2 não roda, saída 143) e depois do último grupo (saída 143, nunca "ok"; EST-11);
  - o prazo 0 com a porta ocupada (ADV-R2-04);
  - o segundo sinal repassado (o jeito de forçar a saída), o grupo morto por sinal como falha, o relatório de uma execução anterior que não conta, o sinal antes do primeiro grupo e o `firebase-debug.log` apagado na saída limpa e guardado pelo link (ADV-R3-03, EST-R3-01, EST-R3-02).
- O marco de fase completa da integração (EST-10), em `tests/tools/integracao-marco.test.mjs`, com 3 testes: os passos do marco; a fiação (o `iniciar` antes do `emulators:exec`, o `concluir` como último passo da cadeia, o `conferir` depois e todas as 19 suítes de Rules do `package.json`); e o script oficial como o npm o roda, com `firebase` e `npm` falsos: o Emulator que sai com 0 no meio reprova, a cadeia inteira aprova e a suíte que falha reprova como antes.
- Mutantes: 57 de 57 mortos na árvore de código final (`mutantes.md`), entre eles P01 a P06 (portas), S01 a S10, T01, U01 e U17 (sinais), T03 (prazo 0), G08, G09, A01 e A02 (argumentos), K01 (log), X09 (relatório anterior) e I01 a I07 (marco). Na rodada 1, o X03 sobrevivia como equivalente; com os testes de porta presa, ele morre.
- Documentação operacional: `docs/production/RUNBOOKS.md` (RB-01, RB-03, RB-04, RB-05, RB-08 e RB-09) e a tabela de gates do `README.md`.

## Evidência guardada (EST-15)

O executor apaga `test-results/e2e-grupos/` no começo de cada execução, e o Playwright limpa as pastas de saída. Na execução oficial 37, o E2E do ADV-01 rodado logo depois no mesmo worktree apagou os relatórios por grupo e os logs do Emulator dela; a conferência ficou pelo log. Desde então, o roteiro da execução oficial copia `test-results/e2e-grupos/` e `test-results/grupo-*/` para `logs/<rótulo>-artefatos/` antes de qualquer outra execução, e os da execução oficial final estão no pacote de auditoria.

## Integração e Rules: o marco de fase completa (EST-10)

O `firebase emulators:exec` trata SIGINT, SIGTERM, SIGHUP e SIGQUIT como pedido de desligamento: para a cadeia de suítes no meio, desliga os emuladores e termina com saída 0 (firebase-tools 15.32.1, `lib/commands/emulators-exec.js:18` e `lib/emulator/commandUtils.js:164-230`). Foi o que aconteceu na `verify-all-r32-2`: com o SIGINT só ao CLI, ele desligou o Emulator e saiu com 0 depois do `ok 867`, e o `&&` seguiu para o `test:e2e`. A cadeia de suítes continuou órfã contra o Emulator desligado (`ok 868` a `871`, depois `not ok 872`, `876`, `881` e `888` a `891`; `verify-all-r32-2.log`, linhas 25750 a 28348), e nenhuma suíte de Rules rodou. Agora `npm run test:integration:emulator` grava um marco aberto antes do `emulators:exec` (`iniciar`), fecha-o como último passo da cadeia (`concluir`, só alcançado com todas as suítes passando, porque a cadeia é ligada por `&&`) e só aprova depois com o marco fechado (`conferir`, que o apaga). A linha de sucesso é `[integração] fase completa: todas as suítes rodaram até o fim`.

## Riscos conhecidos

- **RR-R32-03 (LOW; substitui o RR-R31-08).** `socket hang up` no preparo pela API sob sobrecarga, de causa não comprovada (`keepalive-rr-r31-08.md`). Aceito por escrito, com gatilho (D-P5F1-R32-03): qualquer `socket hang up` ou `ECONNRESET` numa execução oficial leva ao endurecimento de todo o tráfego do `APIRequestContext` antes da execução seguinte, sem repetir a execução até passar.
- **RR-R32-04 (LOW).** Um segundo sinal de qualquer tipo, ou SIGKILL no executor ou no Playwright, ainda pode deixar o Emulator de pé; um sinal só ao `npm` de cima não chega ao executor, que segue órfão; com o sinal ao grupo inteiro, quem chamou recebe a saída antes de o Emulator desligar (EST-12). A execução seguinte reprova com "portas em uso antes do primeiro grupo" (nunca passa com o Emulator anterior), e o RB-04 e o RB-09 dizem o que fazer.
- **RR-R32-05 (LOW, configuração externa).** O fluxo em grupos ainda não rodou no CI, e a classe do runner não foi confirmada. Os picos por grupo da execução oficial estão em `testes-e-resultados.md`; se o runner tiver menos memória, `E2E_SHARDS` (1 a 12) aumenta a quantidade de grupos.
- **RR-R32-10 (INFO; EST-14).** O marco não é amarrado à cadeia que o fecha: uma cadeia órfã ainda viva quando outra execução começa poderia fechar o marco da nova, que ainda teria de ser interrompida depois disso. Improvável; o gate confere a contagem por suíte e a ausência de "Received SIG" na fase.
- **RR-R32-13 (LOW; EST-R6-01).** No caminho normal, o ajudante dos testes de interrupção (`tests/tools/e2e-grupos.test.mjs:517-533`) confere e encerra o falso `npx` pelo número do PID, sem conferir se ele ainda é deste teste (o `ownStub` vale só no caminho de erro). Um PID reaproveitado levaria um SIGKILL a um processo de fora; exige que o contador de PIDs dê a volta inteira em menos de um segundo, e o teste reprova se acontecer. Sem mudança nesta etapa; o `ownStub` nos dois pontos na próxima mudança do executor.
- **RR-R32-08 (LOW, P6).** O `predeploy:rules`, que roda antes do `deploy:firestore`, usa o mesmo `emulators:exec` sem o marco: um sinal no meio das Rules pode deixar o deploy seguir. Fora desta etapa (agentes não executam deploy; PR-REL-01).
