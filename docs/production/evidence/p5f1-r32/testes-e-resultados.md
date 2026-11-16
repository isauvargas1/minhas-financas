# P5-F.1-R3.2 — testes e resultados

Todas as execuções rodaram no worktree isolado `wt-p5f1-r32` ou em cópias dele, com o Firebase Emulator (projeto `minhas-financas-local`). Nenhuma acessou um projeto real. As saídas estão em `saidas/`, e os logs completos no pacote de auditoria. Uma execução que falhou continua no histórico, mesmo quando uma execução posterior passou.

## Execução oficial

`verify-all-r32-9` (execução 71 do histórico), na árvore de código final `5ea7fabe`:
- **Como.** `npm run verify:all` pelo procedimento oficial (`run-oficial.sh`), numa execução só, ininterrupta.
- **Quando.** 13:28:05Z–14:16:03Z de 14/11/2026, sem nenhuma outra execução de testes ao mesmo tempo.
- **Resultado.** Saída 0, 2.871 s.

| Etapa | Resultado |
| --- | --- |
| `verify:fast` (tipos, lint das Functions, builds, unidade e ferramentas) | 1.843 testes em 20 scripts, nenhuma falha |
| Integração das Functions e Rules no Emulator | Functions 985/985; guardas 15/15 e 2/2; 19 suítes de Rules com 287 testes; `[integração] fase completa` (execução `9a51fa5b`); nenhum "Received SIG" na fase |
| E2E em grupos | `ok: 218 testes, cada um uma vez, todos passaram`; grupos de 83 (424 s), 64 (295 s) e 71 (689 s) |
| Plataforma | Picos de memória de 9.948, 6.950 e 9.844 MiB por grupo; nenhum `socket hang up` nem `ECONNRESET` (o gatilho do D-P5F1-R32-03 não disparou); portas livres e nenhuma JVM no fim; `limpeza_externa=nenhuma`; árvore igual no começo e no fim |

As saídas estão em `saidas/verify-all-r32-9.meta.txt`, `.status.txt`, `-memoria.txt` e `.contagens.log.txt`.

**A execução do gate** (`gate-verify-all-r32`, execução 75), pelo mesmo procedimento, na árvore final com os documentos (fora de `docs/`, igual à de código final): saída 0, 2.902 s; 1.843 de unidade, 1.289 de integração e Rules com a fase completa, 218 E2E em 3 grupos (83, 64 e 71), com as chaves iguais às da `verify-all-r32-9`; nenhum `socket hang up`; portas livres e nenhuma JVM no fim (`saidas/gate-verify-all-r32.*`). Os relatórios por grupo e o `firebase-debug.log` de cada grupo estão no pacote.

**As outras execuções do `verify:all` pelo procedimento oficial:**
- **Saída 0, superadas por mudanças pedidas pelas revisões.** `verify-all-r32-3` (`9fddcb5a`), `verify-all-r32-4` (`ef514869`) e `verify-all-r32-6` (`698f9644`).
- **`verify-all-r32-5` (`698f9644`), interrompida.** O contêiner reiniciou. O executor reprovou, sem falso "ok".
- **`verify-all-r32-7` (`b2b15267`), saída 1.** O roteiro de uma revisão encerrou um processo do teste.
- **`verify-all-r32-8` (`5ea7fabe`), saída 1.** Falha intermitente de um teste das Functions anterior à etapa. A causa foi comprovada: a asserção procura "9990" no JSON inteiro do aviso, inclusive no `occurrenceId` aleatório. É o RR-R32-12, e o teste não mudou nesta etapa.

## Contagens de testes (R3.1 → R3.2)

Contagem pelos nomes dos testes (`saidas/contagens-r31-r32.log.txt`, com a lista dos nomes):

| Arquivo | R3.1 | R3.2 | Mesmo nome | Só na R3.1 (reescritos com outro nome) | Só na R3.2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `tests/unit/work-time-consistency.test.ts` | 46 | 107 | 44 | 2 | 63 |
| `tests/unit/work-time-guard.test.ts` | 18 | 19 | 18 | 0 | 1 |
| `tests/unit/work-time-income-estimate.test.ts` | 21 | 22 | 21 | 0 | 1 |
| `e2e/work-time-b03.spec.ts` | 6 | 7 | | | |
| `e2e/work-time-p5f.spec.ts` | 19 | 20 | | | |
| `tests/tools/e2e-grupos.test.mjs` (novo) | — | 23 | | | |
| `tests/tools/integracao-marco.test.mjs` (novo) | — | 3 | | | |

Nenhum teste foi removido, ignorado ou marcado com `skip`/`only`, e nenhum prazo foi aumentado. `testes-substituidos.md` descreve cada teste reescrito ou ajustado: o que afirmava, o que afirma e por quê.

## Provas vermelhas

Cada teste novo ou reescrito rodou também sobre o código anterior à correção e reprovou ali. Os testes de guarda passam nos dois lados: eles fixam o que não mudou.

**Unidade, Frente A.** Os testes finais dos três arquivos de unidade rodaram sobre o código da R3.1: os três arquivos de `src/` da R3.1 numa cópia da árvore final (`saidas/red-r32-na-r31-3.json` e `.log.txt`, execução 72).

| Arquivo | Testes na R3.2 | Falham sobre o código da R3.1 | Na árvore final |
| --- | ---: | ---: | --- |
| `work-time-consistency.test.ts` | 107 (63 novos ou com nome novo) | 45: 42 dos novos e os 3 reescritos com o mesmo nome (a prova pura das regras e os dois da regra 5) | todos passam |
| `work-time-guard.test.ts` | 19 (1 novo) | 2: o novo (nada é provado sem bloco exato, sem a projeção confirmada e sem a base igual a ela, sem exceção por base única) e o reescrito "estimativa: uma por contexto…" (as expressões novas do `holdEstimate` e a ordem dos motivos em `computeWorkTimeEstimate`) | todos passam |
| `work-time-income-estimate.test.ts` | 22 (1 novo) | 1: a tabela-verdade do `holdEstimate` | todos passam |
| **Total** | **148** | **48** | **148/148** |

Os 21 testes novos de consistência que passam também na R3.1 são guardas do que a R3.1 já fazia certo e que versões intermediárias da R3.2 quebraram:
- a indisponível decidida antes das receitas aparece como está (ADV-01);
- a indisponível com números e a de rotinas ambíguas esperam a prova (F-08, ADV-R3-01, com as sondas das revisões);
- as janelas com desconsiderada e a de 12 meses exigem a confirmação.

Os 2 testes da R3.1 que não existem com o mesmo nome na R3.2 foram reescritos com nome novo (`testes-substituidos.md`).

Também reprovaram:
- os testes da rodada 3 na árvore `ef514869`, anterior ao ADV-R3-01: 8 falhas (execução 57);
- as versões anteriores dos testes: 20 de 85 falham (execuções 4 e 21).

**E2E, Frente A** (no Emulator, com o build E2E):

| Teste | Código | Resultado | Execução |
| --- | --- | --- | --- |
| B03-g (sem conexão, nada convertido) | R3.1 | 0/1: sem conexão, o saldo continuou convertido por 60 s | 11 |
| p5f, a escuta encerrada | R3.1 | 0/1: o topo continuou "Valores em tempo de trabalho equivalente… ela usa a leitura anterior", com os valores convertidos | 20 |
| ADV-01 (a prévia indisponível sem conexão mostra o motivo) | `holdEstimate` anterior ao ADV-01 | 0/1: depois da janela, a prévia mostrava "A estimativa está em atualização" no lugar do motivo | 34 |
| B03-g com o mutante A02 da revisão (a volta da conexão sem `changes`) | cópia com o mutante | 0/1 | 35 |
| B03-g com o mutante N16 (escuta sem `includeMetadataChanges`) | cópia com o mutante | 0/1: sem conexão, o saldo continuou convertido | 36 |

Na R3.2, os mesmos testes passam: execuções 10, 19, 33, 61 e a execução oficial.

**Frente B** (o executor e o marco):

| Teste | Código | Resultado | Execução |
| --- | --- | --- | --- |
| Interrupção (EST-02) | executor de `2fdab479` | 11/12: com o SIGTERM, o executor anterior morria pelo sinal e o grupo ficava de pé | 25 |
| Marco de fase completa (EST-10) | `package.json` de `2fdab479` | 1/3: com o `firebase` falso que sai com 0 no meio da cadeia, o script anterior saía com 0 | 26 |
| `firebase-debug.log` por grupo (EST-R3-01) | executor de `ef514869` | 22/23: só o teste do log falha | 58 |
| Segundo sinal e limpeza do ajudante (EST-R4-01, EST-R5-01) | cópias com S01, S05 e U01 | 3/3 mutantes mortos em 149 s, sem órfão | 64 e 68 |

## Mutantes

Na árvore de código final, depois da execução oficial (execução 73 do histórico; detalhe por mutante em `mutantes.md`):

| Conjunto | Mortos |
| --- | ---: |
| Frente A, as condições novas do cliente, com a guarda de texto | 26/26 |
| Frente A, os mesmos, sem a guarda de texto | 24/26: N15 e N16, do adaptador do SDK, morrem no E2E B03-g com o mutante aplicado (execuções 74 e 36) |
| Frente B: o executor em grupos, o marco da integração e a fiação | 57/57, nenhum só pelo prazo |
| Regressão: os 12 dirigidos da R3.1 rodados na R3.2 | 12/12 |
| Regressão: os 29 do cliente da R3 rodados na R3.2 | 29/29 |

## Todas as execuções, em ordem

O histórico inclui as falhas e as interrupções intermediárias, cada uma com a causa.

| # | Execução | Árvore | Resultado | Observação |
| --- | --- | --- | --- | --- |
| 1 | unit-work-time-1 | (antes do resumo) | 3 falhas | testes da R3.2 ajustados; ver tarefa #63 |
| 2 | unit-work-time-2 | | 242/242 | |
| 3 | unit-reports-1 | | 107/107 | |
| 4 | red-r32-na-r31 | cópia (3 src da R3.1) | 20/85 falham | prova vermelha de unidade (versão dos testes antes da guarda do adaptador) |
| 5 | tsc-root-1..4 | | 0 | |
| 6 | tools-e2e-1 | | 6/6 | antes dos testes do executor |
| 7 | lista-suite | | 217 testes, 36 arquivos | `--list --reporter=json` |
| 8 | keepalive E1, E1b, E2 | | 0 falhas | janela de 5 s (desenho errado: o fechamento real é 6 s) |
| 9 | e2e-b03-r32-1 | 0f1b9320 | 6/7 | B03-g reprovou por erro de asserção do próprio teste (contava o saldo convertido de antes da queda); limpeza_externa=nenhuma |
| 10 | e2e-b03g-r32-2 | 059cec04 | 1/1 | B03-g corrigido |
| 11 | e2e-b03g-na-r31-vermelho | cópia 059cec04 + 3 src R3.1 | 0/1 | vermelho esperado: "sem conexão, o saldo em reais" (60 s convertido) |
| 12 | E3a timers / E3a check / E3b / E3c / E3d / E3e / E3h | | ver keepalive doc | E3d 1ª versão interrompida (servidor no mesmo processo do cliente: desenho errado) e refeita com o servidor em outro processo |
| 13 | mutantes-cliente-r32 | cópia 059cec04 | 16/16 | |
| 14 | mutantes-grupos-r32 | cópia 059cec04 | 24/26 | G02 sobreviveu (lacuna real) e X03 (equivalente) |
| 15 | mutantes-grupos-r32-2 | cópia + teste G02 | 25/26 | X03 equivalente quanto à decisão |
| 16 | typecheck-r32-pre-verify | 6d28cf98 | 0 | |
| 17 | verify-all-r32-1 | 6d28cf98 | interrompido (143) na fase build | interrompido pelo executor ao achar o teste p5f:1230 com o comportamento antigo; sem resultado de teste |
| 18 | e2e-p5f-r32-1 | ca11baca | INVÁLIDA, interrompida (143) | `dist/` substituído pelo build de produção do verify-all-r32-1 interrompido; SKIP_BUILD=1 o reaproveitou; sem o login E2E; o 1º teste esperou o prazo (5,0 min). Interromper pelo `timeout` derrubou o Playwright sem desligar os webServers: o firebase-tools (pid 24625, cwd no worktree) e o vite preview (pid 24815) foram encerrados com SIGTERM, por identidade, e tudo desligou em 3 s |
| 19 | e2e-p5f-r32-2 | ff1aa360 | 19/19 | build:e2e novo; o 1º teste (assistente) passou: a falha da 18 era só o dist/ errado; limpeza_externa=nenhuma |
| 20 | e2e-p5f-escuta-na-r31-vermelho | cópia 059cec04 + 3 src R3.1 + p5f reescrito | 0/1 | vermelho esperado: na R3.1 o topo seguia "Valores em tempo de trabalho equivalente… ela usa a leitura anterior" (convertido) com a escuta encerrada |
| 21 | red-r32-na-r31-2 | cópia 93668199 + 3 src R3.1 | 20/85 falham | prova vermelha de unidade com a versão final dos testes; as mesmas 20 da execução 4 |
| 22 | verify-all-r32-2 | 93668199 | **interrompido (130)** pelo executor, aos 1.390 s | verify:fast passou; na integração, um SIGINT só ao `firebase emulators:exec` (pid do CLI) a encerrou com saída 0 depois do `ok 867` das Functions, sem nenhuma suíte de Rules, e o `&&` seguiu para o `test:e2e` (evidência do EST-10); o executor da integração das Functions continuou contra o Emulator desligado e gravou falhas no mesmo log (`not ok 872` e seguintes); o SIGINT ao grupo de processos parou o E2E com 13 passados e 69 sem rodar, saída 130; interrompido para corrigir o ADV-01; limpeza_externa=nenhuma; pico 4.635 MiB |
| 23 | unit-adv-1 | árvore de trabalho (ADV-01) | 17/18 | o teste novo da divergência persistente conferia a contagem de releituras cedo demais (erro do próprio teste) |
| 24 | unit-adv-2 | idem | 18/18 | teste corrigido (`drive` até `calls.series >= 3`) |
| 25 | est02-vermelho | executor de 2fdab479 + testes novos | 11/12 | vermelho esperado: com o SIGTERM, o executor anterior morre pelo sinal (saída nula) e o grupo fica órfão |
| 26 | est10-vermelho | package.json de 2fdab479 + testes novos | 1/3 | vermelho esperado: com o `firebase` falso que sai com 0 no meio da cadeia, o script anterior sai com 0 |
| 27 | mutantes-cliente-r32-2 | cópia 2fdab479 (antes do F-03) | 20/20 | com a guarda de texto |
| 28 | mutantes-cliente-r32-2-sem-guarda | idem | 18/20 | sem a guarda: N15 e N16 (adaptador do SDK) sobrevivem, porque o mundo simulado não passa pelo adaptador; o comportamento deles é o do E2E com o SDK real (execuções seguintes) |
| 29 | mutantes-grupos-r32-3 | cópia d9d13231 | 37 mortos, depois **travou** | no P06 (porta ocupada vista como livre), o teste do auxiliar de portas deixava o servidor aberto ao falhar e o falso `npx` esperava um processo que não conseguia ouvir: a suíte travou até o prazo de 600 s, e o roteiro parou sem registrar o resto |
| 30 | p06-isolado-1 | cópia com o P06 | travou (parado pelo executor) | a mesma trava, reproduzida |
| 31 | p06-isolado-2 | cópia com o P06 + testes corrigidos | 11/15 (mutante morto em 3,6 s) | `finally` fecha o servidor do auxiliar; o falso `npx` falha na hora quando o processo não consegue ouvir; `spawnSync` do executor com prazo de 120 s; roteiros de mutantes contam o tempo esgotado como morto |
| 32 | tsc-root-6 | 9fddcb5a | 0 | |
| 33 | e2e-adv01-r32-1 | 9fddcb5a | 1/1 (53 s) | ADV-01 verde: sem conexão por 35 s depois de a estimativa em uso perder a conversão, a prévia indisponível só mostrou o motivo; a conversão em uso voltou com a conexão; limpeza_externa=nenhuma |
| 34 | e2e-adv01-na-pre-vermelho | cópia 580dc73d com o `holdEstimate` anterior ao ADV-01 | 0/1 | vermelho esperado: depois da janela, a prévia mostrava "A estimativa está em atualização…" com "Tentar de novo" no lugar do motivo (`e2e-adv01-na-pre-vermelho-error-context.md`) |
| 35 | e2e-b03g-com-a02 | cópia d9d13231 com o mutante A02 (N19) | 0/1 | vermelho esperado (pedido da revisão adversarial): com a conexão de volta, a prévia aberta de novo converte, mas o Dashboard fica em reais (`R$ 19.400,00` em vez de `≈ 776 h`, `work-time-b03.spec.ts:778`) |
| 36 | e2e-b03g-com-n16 | cópia 9fddcb5a com o N16 (escuta sem `includeMetadataChanges`) | 0/1 | vermelho esperado: sem conexão, o saldo continua convertido (`:750`, "sem conexão, o saldo em reais"); mostra por comportamento o adaptador que a unidade só cobre pela guarda |
| 37 | **verify-all-r32-3 (oficial)** | 9fddcb5a | **saída 0, 3.023 s** | uma execução, ininterrupta, pelo procedimento oficial (`run-oficial.sh`, `npm run verify:all`): unidade 1.812 testes em 20 scripts, sem falha; integração das Functions 985/985, guardas 15/15 e 2/2, 19 suítes de Rules (287 testes), `[integração] fase completa` e nenhum "Received SIG"; E2E `ok: 218 testes, cada um uma vez, todos passaram` (grupos 83/83 em 433 s, 64/64 em 301 s e 71/71 em 705 s); portas livres e `java_no_fim=0` no fim; `limpeza_externa=nenhuma`; pico 10.243 MiB; árvore igual no início e no fim |
| 38 | e2e-adv01-r32-2 | 9fddcb5a | 1/1 (125 s) | o E2E do ADV-01 de novo, logo depois da execução oficial 37, no mesmo worktree: apagou os relatórios por grupo e os logs do Emulator da 37 (`test-results/`), que não tinham sido copiados (EST-15 da estabilidade, rodada 2); a evidência da 37 ficou no log. Desde então, o `run-oficial.sh` copia `test-results/e2e-grupos/` e `test-results/grupo-*/` para `logs/<rótulo>-artefatos/` antes de tudo |
| 39 | unit-f08-1 | árvore intermediária (F-08) | 29/29 | o bloco novo do estado indisponível (ADV-01 e F-08) no código com `carriesBasisFigures` |
| 40 | tsc-root-7 | eb144b4b | 0 | |
| 41 | unit-work-time-3 | eb144b4b | 278/278 | F-08 e os testes da rodada 2 (tabela-verdade, guarda, ADV-R2-07) |
| 42 | unit-reports-2 | eb144b4b | 107/107 | |
| 43 | tools-e2e-2 | eb144b4b | 15/15 | o falso `npx` em cadeia (`npx` → `sh` → neto; ADV-R2-02), a lista de argumentos aceitos (ADV-R2-03) e o prazo 0 com a porta ocupada (ADV-R2-04). Antes, numa cópia parcial com o T01 (`process.kill(current.pid, …)`), o teste do EST-02 reprovou em cerca de 20 s (vermelho esperado; a saída não foi guardada em arquivo, e o T01 volta a morrer na execução 48) |
| 44 | tools-integracao-2 | eb144b4b | 3/3 | |
| 45 | tools-e2e-3 | árvore intermediária, com os testes do EST-11 | **16/18** | erro do próprio teste: o instante do sinal esperava a linha "2/2 passaram", e os relatórios simulados têm 3 testes num arquivo e 1 no outro; o executor seguiu até o fim, e o teste reprovou ao fim dos 20 s. Corrigida a expressão (`\d+/\d+ passaram`), sem mudar o executor nem as asserções |
| 46 | tools-e2e-4 | ef514869 | 18/18 | com SIGHUP, SIGQUIT, o sinal entre os grupos e o sinal depois do último (EST-11, EST-12) |
| 47 | sinais-r2-vermelho (1ª tentativa) | cópia parcial de ef514869 | base com 1 falha, nada medido | erro do roteiro: a cópia parcial não tinha o `firebase.json`, que o teste das portas lê ("not ok 6 - grupos: as portas conferidas entre os grupos são as do Emulator e a do frontend"); o roteiro parou na base, como deve. O log foi sobrescrito pela execução 48; a saída está transcrita aqui |
| 48 | sinais-r2-vermelho | a mesma cópia, com o `firebase.json` | **10/10 mortos** | S01–S09 e T01: entre eles o S06 (interrupção depois do último grupo), o S07 (SIGHUP; o R01 da estabilidade), o S08 (SIGQUIT), o S09 (sinal sem grupo em curso; o R03) e o T01 (o R02) |
| 49 | mutantes-cliente-n2x (1ª tentativa) | cópia de ef514869 | não rodou | erro do roteiro de filtragem (`IndexError` ao ler os argumentos); nenhum mutante aplicado, nada alterado na cópia. O log foi sobrescrito pela execução 50 |
| 50 | mutantes-cliente-n2x | cópia de ef514869 | **6/6 mortos** | N17, N18, N21 e N22 (F-08) e N23 e N24 (o B08 e o B09 da revisão adversarial, rodada 2; o B08 era o ADV-R2-07, que só a guarda pegava) |
| 51 | tsc-root-8 | ef514869 | 0 | |
| 52 | unit-work-time-4 | ef514869 | 278/278 | |
| 53 | tools-integracao-3 | ef514869 | 3/3 | |
| 54 | **verify-all-r32-4 (oficial)** | ef514869 | **saída 0, 3.095 s** | uma execução, ininterrupta, pelo procedimento oficial (`run-oficial.sh`, `npm run verify:all`), 18:30:01Z–19:21:43Z: unidade 1.832 testes em 20 scripts, sem falha; integração das Functions 985/985, guardas 15/15 e 2/2, 19 suítes de Rules (287 testes), `[integração] fase completa` (execução a1e9b7c7) e nenhum "Received SIG" na fase; E2E `ok: 218 testes, cada um uma vez, todos passaram`, grupos de 83 (473 s), 64 (340 s) e 71 (728 s); os três "Received SIGTERM" do log são o `gracefulShutdown` no fim de cada grupo; nenhum `socket hang up` nem `ECONNRESET` (o gatilho do D-P5F1-R32-03 não disparou); as sequências `[estados-adv-01…]` no log; picos de memória por grupo 9.676, 6.884 e 10.133 MiB (até o E2E, 2.983); portas livres, nenhuma JVM, `limpeza_externa=nenhuma`, árvore igual no começo e no fim; relatórios por grupo e logs do Emulator em `verify-all-r32-4-artefatos/` (5,6 MB) |
| 55 | mutantes finais na árvore ef514869 (filas a e b) | cópias de ef514869 | **interrompidos** pelo executor, superados | começaram às 23:15Z de 13/11; parados às 23:47Z, quando a revisão adversarial da rodada 3 (ADV-R3-01) levou a uma mudança de código. Até ali: cliente 21/21 mortos, Frente B 39/39 e R3.1 na R3.2 12/12, sem sobrevivente (`mutantes-cliente-r32-final.log`, `mutantes-grupos-r32-final.log`, `mutantes-cliente-r31-na-r32.log`, todos parciais, guardados com o sufixo `-ef514869-interrompido`). As cópias foram descartadas e refeitas da árvore nova |
| 56 | dev-r33-work-time-1 | cópia de trabalho (ef514869 + ADV-R3-01, EST-R3-01, ADV-R3-03, EST-R3-02) | 284/284 | a lista fechada `DECIDED_BEFORE_INCOME`, os testes da véspera reduzida ambígua e das sondas R3-P1 a R3-P3 |
| 57 | r33-vermelho (unidade) | cópia de ef514869 com os testes novos | **8 falham** (vermelho esperado) | consistência: os 3 do laço com a véspera reduzida ambígua e as 3 sondas; a tabela-verdade; a guarda. Os outros 140 passam (`r33-vermelho-*.log`) |
| 58 | r33-vermelho (executor) | cópia de ef514869 com os testes novos | 22/23 (vermelho esperado no EST-R3-01) | só o teste do `firebase-debug.log` falha no executor anterior; os do segundo sinal, do grupo morto por sinal, do relatório antigo e do sinal antes do primeiro grupo fixam comportamento que já estava certo (matam U01, U17, S10 e X09) |
| 59 | r33-mutantes-cliente-novos e r33-mutantes-grupos-novos | cópias da cópia de trabalho | **6/6** e **10/10 mortos** | N17, N18, N21, N22, N25, N26; K01, X09, U01, U17, S10 e os S06–S09 e T01 de novo |
| 60 | typecheck-r33-1, unit-work-time-5, unit-reports-3, tools-e2e-5, tools-integracao-4 | árvore nova no worktree | 0; 284/284; 107/107; 23/23; 3/3 | |
| 61 | e2e-p5f-r33-1 | árvore nova no worktree (antes do congelamento só mudaram dois comentários) | 20/20 (271 s) | o spec com as rotinas ambíguas (B02, S01) e o ADV-01, numa sessão do Playwright, antes da execução oficial; limpeza_externa=nenhuma |
| 62 | **verify-all-r32-5 (oficial)** | 698f9644 | **interrompida** por causa externa: o contêiner reiniciou | início 00:20:13Z de 14/11; o SIGTERM do reinício chegou às 00:57Z, no grupo 3 do E2E. Até ali: unidade 1.843 testes em 20 scripts, sem falha; integração e Rules 1.289, `[integração] fase completa` (execução 906f78b4); E2E grupo 1 83/83 (369 s) e grupo 2 64/64 (264 s). O executor recebeu o SIGTERM, repassou o SIGINT ao grupo 3, não rodou nada depois e terminou com `FALHOU` ("execução interrompida por SIGTERM: 3 de 3 grupo(s) rodaram"; o grupo 3 sem relatório): o caminho do EST-02 numa interrupção real, sem aprovação falsa. O desligamento do Emulator do grupo 3 não foi pelo caminho limpo: o log não o registra, e o `firebase-debug.log` ficou com dois links (o CLI foi morto pelo próprio reinício; EST-R4-03 da revisão de estabilidade). Esse log, que sobrou na raiz, recebeu depois o da integração da execução 63 (de 6,3 para 57 MB; EST-R4-02): a evidência do grupo 3 desta execução não é confiável. O `run-oficial.sh` morreu junto e não gravou a linha `fim=` no `.log.meta`. Depois do reinício: árvore igual, portas livres, nenhuma JVM. Não vale como execução oficial; a seguinte, ininterrupta, é a 63 |
| 63 | **verify-all-r32-6 (oficial)** | 698f9644 | **saída 0, 2.862 s** | uma execução, ininterrupta, pelo procedimento oficial (`run-oficial.sh`, `npm run verify:all`), 11:35:14Z–12:22:57Z de 14/11: unidade 1.843 testes em 20 scripts, sem falha; integração das Functions 985/985, guardas 15/15 e 2/2, 19 suítes de Rules (287 testes), `[integração] fase completa` (execução 422858ce) e nenhum "Received SIG" na fase; E2E `ok: 218 testes, cada um uma vez, todos passaram`, grupos de 83 (416 s), 64 (296 s) e 71 (679 s); os três "Received SIGTERM" são o `gracefulShutdown` no fim de cada grupo; nenhum `socket hang up` nem `ECONNRESET` (o gatilho do D-P5F1-R32-03 não disparou); as sequências `[estados-adv-01…]` no log; picos de memória por grupo 9.470, 9.534 e 9.575 MiB (até o E2E, 2.536); portas livres, nenhuma JVM, `limpeza_externa=nenhuma`, árvore igual no começo e no fim; relatórios por grupo e logs do Emulator, agora com o `firebase-debug.log` de cada grupo (30, 15 e 25 MB; EST-R3-01), em `verify-all-r32-6-artefatos/` (73 MB) |
| 64 | r34-mutantes-sinais | cópia de 698f9644 com a correção do EST-R4-01 | **3/3 mortos em 149 s** | S01, S05 e U01. Na árvore 698f9644, S01 e S05 só contavam como mortos pelo prazo de 600 s do roteiro: o teste do segundo sinal travava, porque o falso `npx` sobrevivia com o pipe do executor e prendia o processo dos testes (EST-R4-01 da estabilidade, rodada 4, reproduzido por ela). Com a limpeza nova do ajudante (o falso `npx` e os pipes encerrados no `finally`), reprovam na hora, sem processo órfão |
| 65 | tools-e2e-6 | árvore nova no worktree | 23/23 | |
| 66 | **verify-all-r32-7 (oficial)** | b2b15267 | **saída 1, 260 s**: interferência externa comprovada | começou às 12:44:03Z; no `verify:fast`, `test:tools:e2e` reprovou um teste ("not ok 16 - executor (EST-11): o sinal durante a espera das portas entre os grupos…": o executor sob teste saiu morto por sinal, `null !== 143`, uns 2 s depois de receber o SIGTERM). Causa: o roteiro da revisão de estabilidade (rodada 5), rodando ao mesmo tempo na cópia dela, procurava processos órfãos pelo diretório temporário (`e2e-grupos-raiz-*`) e encerrou com SIGKILL o executor desse teste da execução oficial (pid 8083, `wt-p5f1-r32/tools/e2e/executar-em-grupos.mjs`, cwd `/tmp/e2e-grupos-raiz-VZpeFs`) e o processo que segurava a porta (8111); o registro é da própria revisão (`revisoes/estabilidade/rodada-5/logs/C3-PRIMEIRA-VERSAO-que-encerrou-processos-da-r32-7.txt`, 12:48:15Z). Não houve integração nem E2E. A investigação apontou um risco latente na correção do EST-R4-01: o `finally` do ajudante matava, mesmo no caminho normal, um PID que já tinha saído (podia ter sido reaproveitado por outro processo); endurecido na execução 67 |
| 67 | r34-mutantes-sinais-2 | cópia com a 1ª versão endurecida do `finally` (só com o executor ainda vivo) | 3/3 mortos em 148 s, **mas um falso `npx` ficou órfão** | com o S05, o executor morre pelo SIGTERM antes do segundo sinal, e o `finally` não limpava porque o executor já tinha saído. O órfão (pid 32292, pai init, `STUB_DIR` de um diretório temporário deste teste, criado às 13:00:07 durante a execução) foi conferido pelo ambiente e encerrado pelo executor; nada travou (os pipes já eram fechados) |
| 68 | r34-mutantes-sinais-3 | cópia com o `finally` final: só no caminho de erro; o executor, se ainda é filho; o falso `npx`, só se o `STUB_DIR` deste teste está no ambiente dele (`/proc/<pid>/environ`); nunca por um PID que outro processo possa ter recebido (EST-R5-01) | **3/3 mortos em 149 s, sem órfão** | busca por `STUB_DIR` em `/proc` depois da execução: nenhum processo |
| 69 | tools-e2e-7 | árvore 5ea7fabe no worktree | 23/23 | |
| 70 | **verify-all-r32-8 (oficial)** | 5ea7fabe | **saída 1, 1.236 s**: falha intermitente de um teste anterior à etapa, causa comprovada | 13:05:50Z–13:26:34Z; nenhuma revisão rodava testes. `verify:fast` passou (1.843). Na integração das Functions, `not ok 581 - §16.15 recorrência pendente não vira pagamento realizado…` (`functions/src/notifications/__tests__/producers.integration.test.ts:1232`): "dado indevido no aviso: 9990". A asserção procura as palavras proibidas ("9990" é o valor do contrato, R$ 99,90, em centavos) no JSON inteiro do aviso, inclusive nos identificadores aleatórios; o `occurrenceId` gerado nesta execução foi `rocc_407244c62519990…` ("…2519990…"), e o aviso não tinha dado indevido. O teste já trata a mesma classe de falso positivo para os timestamps (`:246-250`), mas não para os identificadores. `functions/` não muda na R3.2 (diff vazio desde efcbd264); o teste passou nas execuções oficiais 2 a 6. Fica como risco residual RR-R32-12 (LOW, anterior à etapa), sem mudança no teste do backend nesta etapa; a execução seguinte, com a causa registrada, é a 71 |
| 71 | **verify-all-r32-9 (oficial)** | 5ea7fabe | **saída 0, 2.871 s** | uma execução, ininterrupta, pelo procedimento oficial (`run-oficial.sh`, `npm run verify:all`), 13:28:05Z–14:16:03Z de 14/11, sem nenhuma revisão rodando testes: unidade 1.843 testes em 20 scripts, sem falha; integração das Functions 985/985, guardas 15/15 e 2/2, 19 suítes de Rules (287 testes), `[integração] fase completa` (execução 9a51fa5b) e nenhum "Received SIG" na fase; E2E `ok: 218 testes, cada um uma vez, todos passaram`, grupos de 83 (424 s), 64 (295 s) e 71 (689 s); os três "Received SIGTERM" são o `gracefulShutdown` no fim de cada grupo; nenhum `socket hang up` nem `ECONNRESET` (o gatilho do D-P5F1-R32-03 não disparou); as sequências `[estados-adv-01…]` no log; picos de memória por grupo 9.948, 6.950 e 9.844 MiB (até o E2E, 2.661); portas livres, nenhuma JVM, `limpeza_externa=nenhuma`, árvore igual no começo e no fim; relatórios por grupo e logs do Emulator desta execução (o `firebase-debug.log` de cada grupo: 30, 15 e 25 MB) em `verify-all-r32-9-artefatos/` (74 MB). **É a execução oficial da árvore de código final** |
| 72 | red-r32-na-r31-3 (prova vermelha final de unidade) | três árvores: a R3.1 inteira (`efcbd264`), a cópia de 5ea7fabe com os três `src/` da R3.1 e a cópia de 5ea7fabe | **48 de 148 falham na R3.1** (vermelho esperado); 148/148 na final | 14:55:41Z–14:58:44Z, depois da execução oficial, sem nada pesado ao mesmo tempo além da fila de mutantes do cliente. `work-time-consistency` 45 de 107 (42 dos 63 novos ou com nome novo e os 3 reescritos com o mesmo nome), `work-time-guard` 2 de 19, `work-time-income-estimate` 1 de 22; os outros 100 passam nos dois lados (guardas do que não mudou). Os 2 nomes da R3.1 que não existem na R3.2 são os reescritos com nome novo (`red-r32-na-r31-3.json`) |
| 73 | mutantes finais (filas a e b, `rodar-mutantes-finais.sh`) | cópias de 5ea7fabe (`git archive`, sem `docs/`) | **26/26; 24/26 sem a guarda; 57/57; 12/12; 29/29** | 14:19:32Z–15:35:12Z, depois da execução oficial: as condições novas do cliente 26/26 com a guarda de texto e 24/26 sem ela (sobrevivem N15 e N16, do adaptador do SDK, que o mundo simulado da unidade não atravessa: como na execução 28); a Frente B 57/57, nenhum só pelo prazo; os 12 dirigidos da R3.1 e os 29 do cliente da R3 rodados na R3.2, todos mortos. Base sem falha em cada roteiro; cada arquivo restaurado conferido por SHA-256 (`mutantes-finais.meta`) |
| 74 | e2e-b03g-com-n15-final | cópia de 5ea7fabe com o N15 (o adaptador do SDK nunca marca o retorno do cache) | 0/1 (vermelho esperado, 170 s) | 17:03Z; sem conexão, o saldo continua convertido (`work-time-b03.spec.ts:750`, "sem conexão, o saldo em reais"); mostra por comportamento, com o SDK real, o mutante que a unidade só mata pela guarda. O N16 morreu do mesmo jeito na execução 36, e `src/modules/reports/hooks.ts` não mudou desde a R3.1; portas livres, nenhuma JVM, `limpeza_externa=nenhuma` |
| 75 | **gate-verify-all-r32 (gate, oficial)** | 3bf21397 (a árvore final com os documentos; fora de `docs/`, igual a 5ea7fabe) | **saída 0, 2.902 s** | a execução própria do gate (`regression-release-gate`), pelo procedimento oficial, 17:08:22Z–17:56:51Z de 14/11, sem nada mais rodando: unidade 1.843; integração e Rules 1.289 (Functions 985, 19 suítes de Rules com 287), `[integração] fase completa` (execução `e2c3bd4f`); E2E `ok: 218 testes, cada um uma vez, todos passaram`, grupos de 83 (420 s), 64 (315 s) e 71 (698 s), com as chaves iguais às da `verify-all-r32-9`; nenhum `socket hang up` nem `ECONNRESET`; pico de memória 9.578 MiB; portas livres, nenhuma JVM, `limpeza_externa=nenhuma`; árvore igual no começo e no fim. Depois, numa cópia própria do gate: a guarda de IA com o índice completo 5/5 (RR-R3-12) e a prova vermelha conferida (48 de 148). **PASS — regression release gate** (`revisoes/gate/PARECER-RODADA-1.md`) |

Nota da execução 18 (PT-R32-05 da revisão pt-BR): o erro do 1º teste, transcrito do `error-context.md` lido pelo executor às 13:55 (o arquivo foi apagado pela execução 19, que limpa `test-results/`; o log não o traz porque a execução foi interrompida antes do resumo do Playwright): "Test timeout of 300000ms exceeded. Error: locator.click: Test timeout of 300000ms exceeded. Call log: - waiting for getByTestId('e2e-login-button')". Causa no código: `src/components/auth/LoginView.tsx:38,70-73` só renderiza o botão com `VITE_E2E_MODE === 'true'`, definido só por `build:e2e` (`package.json`); o `npm run build` do verify-all-r32-1 (interrompido nessa fase) deixou em `dist/` o build de produção, sem o botão, e a execução 18 o reaproveitou com SKIP_BUILD=1. O procedimento oficial (`npm run test:e2e`) sempre refaz o `build:e2e` antes dos grupos.
