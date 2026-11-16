VEREDITO: PASS

# Parecer independente — estabilidade do processo de testes (Frente B), P5-F.1-R3.2, rodada 6 (focada)

Revisor: estabilidade do processo e `firebase-production-readiness` no escopo da etapa. Data: 2026-11-14.

**Árvore sob revisão:** `5ea7fabee02c3ae4ca79400f416ce9e67e425ec7`. É a `b2b15267` com o `finally` de `runExecutorSignaled` endurecido. Pasta: `p5f1r32/revisoes/estabilidade/rodada-6/` (saídas em `logs/`, roteiros em `ka/`, cópias em `copia/` e `copia-mutantes/`).

**Regras que segui nesta rodada.**
- Não encerrei nenhum processo que não fosse meu.
- O único roteiro que pode encerrar processos (C2) só considera os que têm uma marca própria no ambiente, `REVISOR_EST_R6=<id>`, herdada só pelos filhos dos meus comandos. Ele não procura processos por nome nem por diretório. Nenhum processo marcado sobrou, e nada foi encerrado.
- Nada foi escrito no worktree nem no repositório (`GIT_OPTIONAL_LOCKS=0`, sem `git write-tree`).

## Conclusão

- **A execução oficial `verify-all-r32-9`, na árvore final, confere por contagem** (seção 3).
  - **Resultado geral:** saída 0, em 2.871 s, com `5ea7fabe` no começo e no fim.
  - **Unidade e integração:**
    - 1.843 testes de unidade;
    - 1.289 de integração, inclusive as 19 suítes de Rules (287);
    - o marco de fase completa, e nenhum sinal na fase.
  - **E2E:** 218 testes, cada um uma vez, numa tentativa e `passed`. São iguais aos da `verify-all-r32-6` por arquivo, título e linha.
  - **Fim da execução:** portas livres, nenhuma JVM, `limpeza_externa=nenhuma`.
  - **Memória, pico por grupo:** 9.948, 6.950 e 9.844 MiB.
  - **Gatilho do D-P5F1-R32-03:** nenhum `socket hang up` nem `ECONNRESET`.
  - **Artefatos:**
    - a pasta tem só arquivos desta execução, e os três `firebase-debug.log` existem (30, 15 e 25 MB);
    - cada log começa no `emulators:start` do próprio grupo e vai até o desligamento;
    - as linhas `addWorker(` somam 124, 76 e 124.
- **A limpeza nova do ajudante está correta no caminho que ela cobre** (seção 2).
  - S01 e S05 reprovam sem travar e sem deixar órfão, tanto no teste do segundo sinal quanto na suíte inteira.
  - U01, S10 e U17 morrem.
  - A flag `completed` impede a limpeza no caminho normal. O executor só é encerrado enquanto é filho ainda não colhido. O falso `npx` só é encerrado se for deste teste (`ownStub`).
  - **Mas o mesmo padrão do EST-R5-01 continua no próprio caminho normal do ajudante**, em `:517-520` e `:524-533`: EST-R6-01, LOW.
- **RR-R32-12 (a falha da `verify-all-r32-8`).** A classificação está correta: é um falso positivo intermitente de um teste do backend anterior à etapa. O tratamento é aceitável, com duas ressalvas de registro (seção 4).
- **EST-R5-02:** fechado a partir da `verify-all-r32-9`. As pastas de artefatos da r32-7 e da r32-8, de antes da correção, ainda guardam os da r32-6 (seção 5).
- **Achados abertos.** Nenhum é HIGH ou MEDIUM, e nenhum leva a PASS falso.
  - **EST-R6-01 (LOW).**
  - **EST-R6-02 (INFO):** as pastas de artefatos antigas.
  - **EST-R4-02 (INFO)**, sem mudança.
  - **EST-R3-03 (INFO):** o `mutantes.md` ainda é o de 11/11. O executor vai refazê-lo dos mutantes finais em curso.
- **Skill:** `PASS — Firebase production readiness`, no escopo da etapa (seção 6).

## 1. Escopo e comandos

| # | Comando | Resultado | Saída |
| --- | --- | --- | --- |
| C0 | `git diff b2b15267 5ea7fabe` | só `tests/tools/e2e-grupos.test.mjs`: o `ownStub` (`:465-472`), a flag `completed` (`:479`, `:536`) e o `finally` (`:538-558`) | `logs/C0-diff.txt` |
| C1 | `node --test tests/tools/e2e-grupos.test.mjs` e `integracao-marco.test.mjs`, na `copia` | 23/23 e 3/3 | `logs/C1-*.log` |
| C2 | `ka/sinais-marcados.sh` na `copia-mutantes`: a base; S01 e S05 só no teste do segundo sinal; S01, S05, U01, S10 e U17 na suíte inteira. Prazo externo de 300 s em cada caso, com a contagem dos processos marcados | resultados abaixo. **Nenhum processo marcado sobrou em caso algum**, e o executor foi restaurado byte a byte | `logs/C2-sinais-marcados.txt`, `ka/saidas-sinais/` |
| C3–C9 | contagem da `verify-all-r32-9`: fases, relatórios por grupo, repórter `list`, lista contra a r32-6, logs do Emulator por grupo, sinais e memória | seção 3 | `logs/C3…C9` |
| C10 | o teste §16.15 em todas as execuções oficiais | `ok 581` na r32-2 a r32-6 e na r32-9; `not ok 581` na r32-8 | `logs/C10-teste-16-15-nas-execucoes.txt` |

Resultados de C2:

| Caso | Saída | Tempo | Testes que reprovaram |
| --- | --- | --- | --- |
| Base | 23/23 | 20 s | nenhum |
| S01, só o teste do segundo sinal | `not ok` | 10 s | o teste |
| S05, só o teste do segundo sinal | `not ok` | 11 s | o teste |
| S01, suíte inteira | saída 1 | 69 s | 14, 15 e 18 |
| S05, suíte inteira | saída 1 | 22 s | 14, 16, 17, 18 e 22 |
| U01 | saída 1 | 40 s | 18 |
| S10 | saída 1 | 20 s | 18 |
| U17 | saída 1 | 19 s | 19 |

Os resultados batem com a `r34-mutantes-sinais-3.log` do executor: 3/3 em 149 s.

Também li:
- o histórico, execuções 66 a 71;
- `r34-mutantes-sinais-2.log` e `-3.log`;
- o `run-oficial.sh` (13:27:47Z);
- `functions/src/notifications/__tests__/producers.integration.test.ts:246-256,1226-1240` e `functions/src/recurring/model.ts:122`;
- o RR-R32-12 em `plano-20-20.md:84`.

## 2. A correção do EST-R5-01 e o que sobra

**O `finally` (`:538-558`) só age se `completed` for falso.** Esse é o caminho de erro: uma asserção ou o `send` lançaram antes do `return`.

| Parte | Conferência | Resultado |
| --- | --- | --- |
| Executor | encerra o grupo `-child.pid` só se `child.exitCode` e `child.signalCode` ainda são nulos. O executor é filho deste processo e não foi colhido, então o PID e o PGID dele não podem ter sido dados a outro processo | correto |
| Falso `npx` | encerra só se `/proc/<pid>/environ` traz o `STUB_DIR` deste teste. O diretório vem do `mkdtemp`, então outro processo não o tem. Só o processo é encerrado, não o grupo: no `.wait2`, o falso `npx` está sozinho no grupo; no `.wait`, é o neto, e o `sh` e o `npx` saem com ele | correto. C2 não deixa órfão, inclusive com o S05, que deixava um na primeira versão (execução 67) |
| Pipes | destruídos sempre | o processo de teste não fica preso (C2) |
| Pode esconder falha? | não. O `return` (saída, `stubAlive`, sinais e chamadas) é calculado antes. No caminho normal o `finally` não age, e U01, S10 e U17 morrem (C2) | correto |

Só existe em Linux, porque usa `/proc`. Em macOS, o `ownStub` dá sempre falso e o `finally` não encerra o falso `npx`. É o comportamento anterior ao EST-R4-01, só no caminho de erro. O CI é Ubuntu. Fica registrado como nota, não como achado.

### EST-R6-01: LOW. O caminho normal do ajudante ainda sinaliza o falso `npx` pelo PID, sem conferir se ele ainda é deste teste

- **Onde:** `tests/tools/e2e-grupos.test.mjs`, em dois pontos.
  - `:524-533` roda em toda passagem dos testes 14, 15 e 18, que têm `stubPid`. Depois que o executor sai, o ajudante faz `process.kill(stubPid, 0)`. Se isso der certo, marca `stubAlive = true` e manda `process.kill(stubPid, 'SIGKILL')`.
  - `:517-520` é o prazo de 20 s, que manda `process.kill(stubPid, 'SIGKILL')`.
- **Cenário.**
  - No caminho normal, o falso `npx` já saiu e foi colhido pelo pai antes do executor. O PID dele fica livre por toda a janela até a linha 527.
  - Nessa janela, o executor ainda espera as portas, escreve o resumo e sai, e o teste recebe o `exit`.
  - Se o PID for reaproveitado (`pid_max` é 32768 neste contêiner), o `kill(…, 0)` dá certo para um processo de fora, e ele recebe SIGKILL.
  - É o mesmo risco que o executor tratou no `finally` pelo EST-R5-01, e o comentário novo (`:539-543`: "nunca por um PID que outro processo possa ter recebido") não vale para o ajudante inteiro.
- **Impacto.**
  - É improvável: o contador dos PIDs teria de dar a volta inteira em menos de um segundo.
  - Não há PASS falso. Se acontecer, o próprio teste reprova (`stubAlive` verdadeiro), mas já terá encerrado um processo de outra execução. O verify:fast e o CI rodam ao lado de outras coisas.
  - O EST-R5-01 recebeu a mesma severidade.
- **Correção sugerida.**
  - `stubAlive = stubPid !== null && ownStub(stubPid, stubs)`;
  - `SIGKILL` só nesse caso;
  - a mesma condição no prazo de `:519`.

## 3. Execução oficial `verify-all-r32-9`, conferida por contagem

**`.meta`.**
- Início 13:28:05Z; fim 14:16:03Z; **`exit=0`**; `duracao_s=2871`.
- **`arvore=5ea7fabe` no começo e no fim.**
- Node v22.23.4, Java 21.0.12.1, firebase-tools 15.32.1, `E2E_SHARDS` padrão.
- **`portas_ocupadas_no_fim=[]`, `java_no_fim=0`, `limpeza_externa=nenhuma`.**
- `artefatos=74M e2e-grupos grupo-1 grupo-2 grupo-3`.

**Unidade (C3).**
- 24 passos com cabeçalho e 20 resumos.
- **1.843 testes, todos aprovados.** `work-time` tem 284 e `test:tools:e2e` tem 23. Os demais scripts têm as mesmas contagens das rodadas 3 e 4.
- Lint: 0 erro e 201 avisos.

**Integração (C3).**
- 22 resumos, na ordem da cadeia: **1.289 testes**.
  - Functions: 985.
  - Guardas: 15 e 2.
  - **19 suítes de Rules:** 287 testes, com as mesmas contagens.
- `Script exited successfully (code 0)` (linha 36762).
- **`[integração] fase completa … (execução 9a51fa5b-…)`** (linha 36768).
- **Nenhum "Received SIG"**, "exited with code" ou "failed to shut down" na fase.

**E2E (C3 a C6).**
- `218 testes em 36 arquivos, em 3 grupo(s)`:

  | Grupo | Testes | Tempo |
  | --- | --- | --- |
  | 1 | 83/83 | 424 s |
  | 2 | 64/64 | 295 s |
  | 3 | 71/71 | 689 s |

- **`ok: 218 testes, cada um uma vez, todos passaram`** (linha 61626).
- **Relatórios JSON por grupo.**
  - Todos os testes `expected`, cada um com **um só resultado, `passed` com `retry` 0**.
  - `unexpected`, `flaky` e `skipped`: 0. `errors` vazio.
  - Configuração: `shard` 1/3, 2/3 e 3/3, `workers` 1, `forbidOnly` true, `retries` 0, `repeatEach` 1, `timeout` 45.000, Playwright 1.60.0.
  - 218 testes distintos, e nenhum arquivo em mais de um grupo.
  - O conjunto é igual ao do repórter `list` (218 "✓", numeração contínua, nenhum outro marcador) e igual ao da `verify-all-r32-6` (nenhuma linha deslocada).
- **Desligamento e sinais (C8).**
  - Três "Received SIGTERM", um por grupo; três "All emulators ready"; quatro "Stopping Firestore Emulator".
  - Nenhum SIGINT, SIGKILL, "forcefully", "portas em uso", crash de página ou `OutOfMemory`.
  - **Nenhum `socket hang up`, `ECONNRESET` ou "Request to function failed"**; as sequências `[estados-adv-01…]` aparecem duas vezes.

**Artefatos (C7; todos com hora dentro da execução):**

| Grupo | Janela no relatório | `firebase-debug.log` | CLI começou | `addWorker(` | `firestore-debug.log` |
| --- | --- | --- | --- | --- | --- |
| 1 | 13:52:27–13:59:30 | 30.730.466 bytes | 13:52:47 | 124 | termina em "server shut down" |
| 2 | 13:59:31–14:04:25 | 15.296.304 bytes | 13:59:52 | 76 | termina em "server shut down" |
| 3 | 14:04:26–14:15:54 | 24.767.305 bytes | 14:04:52 | 124 | termina em "server shut down" |

- Cada `firebase-debug.log` tem um "Received SIGTERM" e um "Shutting down emulators".
- Todos usam o projeto `minhas-financas-local`, e nenhum traz o ID de produção.

**Memória (C9; 287 amostras):**

| Fase | Pico | `node` máx. | `java` |
| --- | --- | --- | --- |
| `verify:fast` | 2.661 MiB | 5 | 0 |
| Integração | 2.464 MiB | 5 | 1 |
| Build e lista | 2.485 MiB | 4 | 0 |
| **Grupo 1** | **9.948 MiB** | 68 | 1 |
| Entre 1 e 2 | 2.303 MiB | 4 | 0 |
| **Grupo 2** | **6.950 MiB** | 44 | 1 |
| Entre 2 e 3 | 2.042 MiB | 4 | 0 |
| **Grupo 3** | **9.844 MiB** | 68 | 1 |

O número de processos `node` antes do E2E (no máximo 5) mostra que nenhuma revisão rodava testes junto. Os números batem com a execução 71 do histórico.

## 4. A `verify-all-r32-8` e o RR-R32-12

**O que aconteceu.**
- A execução reprovou com saída 1, em 1.236 s, na integração das Functions: `not ok 581 - §16.15 recorrência pendente não vira pagamento realizado…`, com "dado indevido no aviso: 9990".
- O `occurrenceId` do aviso era `rocc_407244c6251999080b4f251…`. Esse identificador é derivado por hash (`functions/src/recurring/model.ts:122`) e contém "9990" por acaso.
- A asserção (`producers.integration.test.ts:246-256`) procura as palavras proibidas no JSON inteiro do aviso, inclusive nos identificadores. Ela já trata a mesma classe de falso positivo nos instantes, mas não nos identificadores. A lista da §16.15 inclui "9990" (`:1232-1233`).
- O aviso não tinha dado indevido.
- O E2E não rodou.

**A classificação está correta: é falha intermitente de teste, anterior à etapa, sem relação com a mudança.**
- `functions/` não muda desde `efcbd264` (o diff está vazio).
- O mesmo teste passou nas execuções r32-2 a r32-6 e na r32-9 (C10).
- A causa está provada pelo próprio identificador no log.

**O tratamento é aceitável:**
- risco residual registrado (RR-R32-12, LOW, anterior à etapa);
- nenhuma mudança no backend fora do escopo;
- uma nova execução oficial só depois de a causa ser escrita no histórico.

Isso não é "repetir até passar": a falha tem causa demonstrada, e a repetição não é automática.

**Ressalvas para o texto do RR-R32-12:**
- **Dar um destino à correção:** uma etapa ou um ID do plano para comparar as palavras só nos campos visíveis do aviso, ou para excluir os identificadores gerados. Hoje o gate fica vermelho por acaso em cerca de 0,1% das execuções só nesse teste. O próprio RR diz que o padrão se repete em outros testes do arquivo (por exemplo `:874` e `:1036`), e o efeito soma.
- **Escrever o critério do gate:** uma execução oficial que reprove por esse teste só é tratada como este falso positivo quando a palavra aparece dentro de um identificador gerado, e não num campo visível, como foi feito na execução 70.

## 5. Situação dos achados anteriores

| Achado | Situação | Evidência |
| --- | --- | --- |
| EST-R5-01 (LOW) | **Fechado no `finally`**. O mesmo padrão segue no caminho normal: EST-R6-01 | seção 2 |
| EST-R5-02 (INFO) | **Fechado a partir da r32-9.** O `run-oficial.sh` só copia pastas com arquivos mais novos que o início (`find … -newermt @$START`). Os artefatos da r32-9 são desta execução (C7) | resíduo abaixo |
| EST-R4-01 (LOW) | Fechado (rodada 5; reconferido em C2) | — |
| EST-R4-02 (INFO) | Aberto e opcional; o executor não mudou nesta árvore | — |
| EST-R4-03 (INFO) | **Fechado**: a execução 62 do histórico agora diz que o desligamento do grupo 3 não foi pelo caminho limpo | histórico, linha 66 |
| EST-R3-03 (INFO) | Aberto: o `mutantes.md` ainda é o de 11/11 14:10. O executor vai refazê-lo das execuções finais, que estão em curso | — |
| EST-05 e EST-14 | Riscos residuais aceitos (RR-R32-05, RR-R32-10). Os picos da r32-9 estão dentro do RR-R32-05 | — |

### EST-R6-02: INFO. As pastas de artefatos da r32-7 e da r32-8 ainda guardam os da r32-6

- **Onde:** `logs/verify-all-r32-7-artefatos/` e `logs/verify-all-r32-8-artefatos/`.
- **Cenário:** as duas execuções rodaram com o `run-oficial.sh` anterior à correção, e nenhuma chegou ao E2E. As pastas têm os JSON e os logs da r32-6: mesmos horários, e as datas dos arquivos são de 12:06 a 12:22Z. Os `.meta` das duas dizem `artefatos=73M e2e-grupos grupo-1 grupo-2 grupo-3`.
- **Impacto:** só evidência. Se as pastas forem para o pacote de auditoria, parecem E2E completos de execuções que não chegaram a ele.
- **Correção sugerida:** tirar as duas pastas do pacote, ou anotar no histórico (execuções 66 e 70) que são cópias da r32-6.

## 6. Skill `firebase-production-readiness`

PASS — Firebase production readiness

- **Escopo:** o da etapa, como nas rodadas anteriores. Nesta rodada, os itens tocados são o ajudante dos testes do executor e a execução oficial na árvore final. Não é o checklist integral.
- **Mapa de ambientes:** sem mudança. E2E, integração e Rules só rodam no Emulator `minhas-financas-local`, como confirmam os logs por grupo. `.firebaserc` e `deploy:*` ficaram intocados, e o CI não tem segredos.
- **Inventário de Functions:** fora do escopo (o diff não toca `functions/`). O RR-R32-12 é de um teste do backend, anterior à etapa.

**Matriz de evidência:**

| Seção | Item | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Scripts e CI sem produção como destino | PASS | `playwright.config.ts`, `package.json` e o CI iguais aos de `698f9644`; os logs por grupo (C7) |
| 12 | Execução oficial com o Emulator na árvore sob revisão | PASS | `verify-all-r32-9`, saída 0, conferida por contagem (seção 3) |
| 12 | Emulator desligado limpo, sem órfão nem limpeza externa | PASS | um SIGTERM e um desligamento por grupo; `java=0` entre os grupos; no fim, portas livres, nenhuma JVM e `limpeza_externa=nenhuma` |
| 12 | O resultado da etapa Emulator reflete a execução das suítes | PASS | o marco; 22/22 resumos |
| 12 | Nenhum teste do fluxo depende de credenciais reais ou de rede externa | PASS | 218/218; as observações de rede da rodada 4 (o MOTD do CLI e os sons da interface) continuam anteriores à etapa |
| 12 / FIRE-13 | Versão da CLI fixa | PASS | 15.32.1 |

- **Configuração externa pendente:** nenhuma.
- **Achados bloqueantes:** nenhum. O EST-R6-01 é robustez do harness de testes, e o EST-R6-02 é registro de evidência.
- **Fora do escopo desta avaliação:** a mesma lista das rodadas 4 e 5, ou seja:
  - PR-PLAT-01 e E-01;
  - PR-PLAT-02;
  - PR-APPCHK-01 e E-02;
  - PR-REL-01 e E-12 (inclusive o RR-R32-08);
  - §4;
  - E-04 e E-05;
  - PR-AUTH-04 e E-03;
  - PR-PLAT-03 e E-11;
  - PR-OBS-01, PR-OBS-02 e E-08;
  - PR-BKP-01 e E-07;
  - FIRE-13, INV-16 e REL-09;
  - REL-11;
  - §13.
- **Verificação:** C0 a C10. Não rodei Emulator. A execução oficial foi feita pelo executor e conferida aqui pelo log, pelo `.meta`, pelo amostrador e pelos artefatos.

## 7. O que não foi possível verificar

- **O reaproveitamento de PID do EST-R6-01.** Foi lido no código, não provocado, porque provocá-lo exigiria esgotar os PIDs do contêiner.
- **Os mutantes finais do executor.** Ainda estavam rodando nas cópias dele, e o `mutantes.md` ainda não foi refeito. Nesta árvore, rodei os oito casos de C2.
- **O fluxo no CI** (RR-R32-05), por falta de push.
