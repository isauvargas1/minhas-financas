VEREDITO: PASS

# Revisão adversarial de qualidade e arquitetura, P5-F.1-R3.2, rodada 3 (Frentes A e B)

Árvore revisada: `ef514869087c2b9e8e910a25fc7c18174418b8bb`. O veredito é PASS porque não há HIGH nem MEDIUM em aberto.
Nenhuma conversão chega à tela sem prova, e nenhum número das bases aparece sem ela. Os sete achados da rodada 2 estão
fechados: o ADV-R2-01 pelo F-08, os outros por teste, código ou documento.

Tentei quebrar a correção do F-08 e achei um resto do mesmo defeito, sem conversão e sem número (ADV-R3-01, LOW). Os
motivos de rotina ambígua (`ambiguous_routines` e `ambiguous_reduced_eve`) entram na lista "sem números" e aparecem sem
prova. Mas, no modo habitual, eles dependem da receita lida: os primeiros meses da janela sem renda saem do período
antes da conferência da ambiguidade (`estimate.ts:179-191`). Por isso a sonda mostra um motivo falso de estado misto,
o mesmo caso da R2-03 da financeira, e um *flash* dele numa edição normal. Na R3.1, os dois casos davam "calculando".
Ficam também dois INFO de documentação e testes.

Veredito da skill `firestore-scale-cost-review`: **PASS** (seção 7).

## 1. Escopo conferido

- **Cópias.**
  - `rodada-3/copia` vem de `git archive` da árvore. O `diff -rq` contra o worktree só acha artefatos de build e de
    execução (`dist/`, `functions/lib/`, `test-results/` e os logs do Emulator).
  - `copia-mut` serve para os mutantes e `copia-sonda` para as sondas.
  - `copia-sonda-r31` e `copia-sonda-r2` são a mesma árvore com os três arquivos de `src/` que a R3.2 muda
    (`basisSync.ts`, `consistency.ts` e `useIncomeEstimateWith.ts`), da R3.1 (`efcbd264`) e da rodada 2 (`9fddcb5a`).
    Conferi os SHA-256 contra o `git show`.
  - Não alterei o worktree nem o índice. O índice do worktree continua com a data de 11:47:49.
- **Diff desde a rodada 2** (`9fddcb5a..ef514869`), dez arquivos:
  - `consistency.ts` e `useIncomeEstimateWith.ts`: só `carriesBasisFigures`, a expressão do `holdEstimate` e
    comentários;
  - os testes de unidade (`work-time-consistency`, `-income-estimate` e `-guard`);
  - o E2E do ADV-01 (dois `console.log` e um comentário);
  - `tools/e2e/grupos.mjs`, `tools/e2e/executar-em-grupos.mjs` e `tests/tools/e2e-grupos.test.mjs`;
  - o `RUNBOOKS.md`.

  Desde a R3.1, `src/` muda só nos três arquivos citados. `firestore.rules`, `firestore.indexes.json`, `functions/`,
  `reports/hooks.ts` e `incomeReads.ts` não mudam.
- **Consumidores relidos para o F-08:**
  - `EstimateDetails.tsx` (resumo e memória de cálculo);
  - `IncomeEditor.tsx` (o painel "Receitas consideradas" e a contagem usam `referenceOf(state)` e as receitas da
    estimativa mostrada);
  - `estimate.ts`, `incomeBasis.ts` e `messages.ts`.
- **Achados das outras áreas na rodada 2:** o F-08 da financeira, os EST-11 a EST-15 da estabilidade e as respostas do
  executor (`evidencia-rascunho/revisoes-LEIAME.md`, seção "Rodada 2").
- **Rascunhos do executor** (plano, matriz e relatório, de 18:35-18:38) e o histórico das execuções 38 a 54.

## 2. Comandos executados e resultados

Tudo com `nice -n 19`, um de cada vez, nas minhas cópias. Não rodei Emulator, Playwright, E2E, `verify:*` nem
`test:integration*`. Logs em
`<scratchpad>/p5f1r32/revisoes/adversarial/rodada-3/logs/`;
roteiros em `.../rodada-3/scripts/`.

| Comando (na cópia) | Resultado | Log |
| --- | --- | --- |
| Conjunto `test:unit:work-time` (10 arquivos) | 278/278, saída 0 | `unit-work-time-ef51.log` |
| Conjunto `test:unit:reports` (7 arquivos) | 107/107, saída 0 | `unit-reports-ef51.log` |
| `node --test tests/tools/e2e-grupos.test.mjs` | 18/18, saída 0 | `tools-e2e-ef51.log` |
| `node --test tests/tools/integracao-marco.test.mjs` | 3/3, saída 0 | `tools-integracao-ef51.log` |
| `npx tsc --noEmit` | saída 0 | `tsc-raiz-ef51.log` |
| Sondas R3-P0 a R3-P9 anexadas a uma cópia do teste do gancho, fora do repositório (`scripts/sonda-r3.ts.txt`), na árvore final, com o `src/` da R3.1 e com o da rodada 2 | comportamento registrado (seção 4) | `sonda-r3-ef51.log`, `sonda-r3-p0b-ef51.log`, `sonda-r3-src-r31.log`, `sonda-r3-src-r2.log`, `sonda-r3-p8p9-ef51.log` |
| Mutantes da Frente A, C01 a C13 (`scripts/mutantes-adv-r3.py <cópia> A`) | 13/13 mortos, todos por comportamento (fora da guarda) | `mutantes-frente-a-r3.log` |
| Mutantes da Frente B, U01 a U17 (`scripts/mutantes-adv-r3.py <cópia> B`) | 13/17 mortos; U03 e U06 equivalentes; U01 e U17 sobrevivem (ADV-R3-03) | `mutantes-frente-b-r3.log` |
| A lista de argumentos aceitos contra o analisador real do `playwright test` 1.60 (`scripts/aceitos-fuzz.mjs`): todas as sequências de até 3 argumentos tiradas de 53 fichas | 151.739 sequências; o executor aceita 17.256; nenhuma lida com opção fora da lista (controle: as recusadas são lidas com `workers`, `config`, `debug` e `retries`) | `aceitos-fuzz.log` |

O roteiro dos mutantes aplica um por vez, exige que cada troca case uma vez só, restaura e confere o SHA-256. Na Frente
A, roda `work-time-consistency`, `-income-estimate`, `-estimate` e `-guard`, com as falhas separadas por arquivo.

| Mutante da Frente A | Resultado |
| --- | --- |
| C01 `carriesBasisFigures` só com a pronta (o `holdEstimate` da rodada 2) | morto (14 do gancho, 1 da tabela-verdade) |
| C02 só com mais de um mês (a indisponível de um mês passa) | morto (1 do gancho: a R2-03; 1 da tabela) |
| C03 pela renda (`incomeCents > 0`; a sem renda passa) | morto (3 do gancho, 1 da tabela) |
| C04 por lista de motivos (só `no_income` e `no_work_minutes`) | morto (a tabela; nenhum teste do gancho usa os limites) |
| C05 o `holdEstimate` ignora a sincronização em curso | morto (6 de `work-time-income-estimate`: as tabelas puras da R3.1 e da R3.2 e o gancho de 12 meses) |
| C06 a com números espera a prova, mas não a sincronização | morto (a tabela; nenhum do gancho) |
| C07 só pelos meses, sem a parte da pronta (equivalente no produto) | morto (4 de `work-time-income-estimate`: os objetos prontos dos testes puros não têm meses) |
| C08 a com números passa com o aviso de releitura (escuta encerrada) | morto (4 do gancho, 1 da tabela) |
| C09 `refreshFailed` sem a escuta encerrada | morto (4 do gancho) |
| C10 `no_income` dispensado da prova | morto (3 do gancho, 1 da tabela) |
| C11 o tempo de interface só vale para a pronta | morto (7 do gancho) |
| C12 a falha da escuta só vale para a pronta | morto (4 do gancho) |
| C13 o tempo de interface não recomeça quando a espera acaba | morto (1 do gancho, o teste do tempo de interface da R3.1) |

| Mutante da Frente B | Resultado |
| --- | --- |
| U01 o segundo sinal não é repassado | **sobrevive** (ADV-R3-03) |
| U02 o valor de uma opção aceita pode começar com `-` | morto |
| U03 `-g` com valor junto aceita qualquer sufixo | sobrevive; equivalente (o sufixo é só o padrão do `-g`) |
| U04 a forma `--opção=valor` aceita qualquer opção longa | morto (2) |
| U05 `-x` combinado é aceito | morto |
| U06 a opção com valor não pula o valor | sobrevive; equivalente (o valor que começa com `-` já é recusado antes) |
| U07 SIGQUIT sem tratamento; U08 SIGHUP sem tratamento | mortos (o teste do EST-11) |
| U09 o laço não para com o sinal entre os grupos | morto (3) |
| U10 a interrupção depois do último grupo não reprova | morto |
| U11 o SIGINT só ao PID do `npx` (o T01) | morto (2) |
| U12 o prazo 0 pula as portas (o T03) | morto |
| U13 a saída da interrupção é 1 | morto (4) |
| U14 o Playwright sem grupo de processos próprio | morto (2) |
| U15 o sinal sem grupo em curso não conta | morto (2) |
| U16 a porta presa depois do grupo não reprova | morto |
| U17 o grupo morto por sinal conta como saída 0 | **sobrevive** (ADV-R3-03) |

Evidências do executor que conferi, sem reexecutar:

- **`verify-all-r32-4` (oficial).** Árvore `ef514869` no início e no fim, saída 0 em 3.095 s e pico de 10.133 MiB.
  - O log traz `[integração] fase completa…` (linha 36702) e nenhum "Received SIG" antes dela.
  - Traz `[e2e em grupos] ok: 218 testes, cada um uma vez, todos passaram` (83, 64 e 71 por grupo).
  - Os 42 resumos do `node --test` têm `fail 0`, e não há nenhum `not ok`.
  - As portas ficaram livres, `java_no_fim=0`, e os artefatos por grupo foram guardados (EST-15).
  - O E2E "ADV-01 (R3.2)" passou e imprimiu as sequências (`[estados-adv-01-sem-conexao]`, linha 60630): a prévia só
    mostrou o motivo.
  - O E2E da fonte PJ com a receita confirmada e sem receitas (`work-time-p5f.spec.ts:731-732`) é um indisponível com
    números que agora espera a prova, e passou com o servidor do Emulator.
- **Mutantes do executor.**
  - `mutantes-cliente-n2x` (execução 50): N17, N18, N21, N22, N23 (o B08) e N24 (o B09), 6/6 mortos.
  - `sinais-r2-vermelho` (execução 48): S01 a S09 e T01, 10/10 mortos.

## 3. Situação dos achados das rodadas 1 e 2

Os oito da rodada 1 continuam fechados. O ADV-01 foi revisto nesta rodada por causa do F-08 (seção 4.1).

| Achado | Situação | Evidência |
| --- | --- | --- |
| ADV-01 (MEDIUM, rodada 1) | **Fechado**, agora em duas partes | **Sem números:** opção (a), por código e testes; os motivos aparecem como estão. **Com números:** opção (b), decisão escrita; eles esperam a prova, como a pronta (F-08), com o impacto no RR-R32-01 e na matriz. Detalhe na seção 4.1. |
| ADV-02 a ADV-08 (rodada 1) | Fechados | Sem mudança desde a rodada 2. Os testes do ADV-02, do ADV-03 e do ADV-08 estão na árvore final e passam. |
| ADV-R2-01 (LOW) | **Fechado pelo F-08, salvo o resto do ADV-R3-01** | Nenhum número das bases aparece sem prova: `carriesBasisFigures` + `holdEstimate` (`useIncomeEstimateWith.ts:114-141`). Testes: `assertNoFigures` nos 12 testes "com números" e as sondas R2-01 a R2-03 da financeira, na suíte. Mortos por comportamento: C01, C02, C03, C04, C06, C08 e C10, além do N21 do executor. O motivo falso de estado misto continua possível nos motivos de rotina ambígua (ADV-R3-01). |
| ADV-R2-02 (LOW) | **Fechado** | O `npx` falso sobe `sh -c` e, dentro dele, o processo que trata o sinal (`e2e-grupos.test.mjs:192-201`). O sinal só ao PID do `npx` vai ao `sh`, que morre sem repassar, e o neto não o recebe. O U11 (T01) morre em dois testes (`signals` vazio e `stubAlive`). |
| ADV-R2-03 (LOW) | **Fechado** | A recusa virou lista de aceitos (`grupos.mjs:52-72`). Mortos: U02, U04 e U05. Equivalentes: U03 e U06. A sondagem contra o analisador real não acha sequência aceita com opção fora da lista (seção 4.3). O RB-04 diz o mesmo (`RUNBOOKS.md:50`). |
| ADV-R2-04 (INFO) | **Fechado** | `waitForFreePorts([porta], 0)` com a porta ocupada devolve a porta (`e2e-grupos.test.mjs:354`). O U12 (T03) morre. |
| ADV-R2-05 (INFO) | **Fechado** | Documentado no RB-04 (`RUNBOOKS.md:52`): interromper pelo Ctrl+C, pelo grupo (`kill -TERM -- -<pgid>`) ou pelo executor; o SIGTERM só ao `npm` de cima deixa o executor órfão. O cabeçalho do executor também (`executar-em-grupos.mjs:22-29`). |
| ADV-R2-06 (INFO, anterior à R3.2) | **Fechado como documentado** | RR-R32-01 do rascunho (`plano-20-20.md:69`). A sonda R3-P5 reproduz: com desconsiderada, sem o primeiro retorno do servidor, "calculando" sem leitura por id; com a escuta encerrada desde o começo, "Não foi possível confirmar…". Depois do primeiro retorno, sem conexão, o motivo aparece. |
| ADV-R2-07 (INFO) | **Fechado** | Teste do gancho `work-time-consistency.test.ts:1981`. O N23 do executor (o meu B08) morre por comportamento. |

## 4. O que ataquei nesta rodada

### 4.1 O F-08 contra o ADV-01

**O que fica visível sem prova.** A regra é `estimate.status === 'ready' || estimate.months.length > 0`
(`useIncomeEstimateWith.ts:114-115`). Por `estimate.ts`:

- **Sem números (base vazia):** `business_not_confirmed` (`:160`), `report_unavailable` (`:165`),
  `exclusion_unconfirmed` (`:170`) e `ambiguous_*` (`:191`).
- **Com números (base preenchida):** `no_income`, `no_work_minutes` e os limites (`:209-227`).
- **A pronta** sempre tem meses, porque exige renda acima de zero.

Os sem números continuam visíveis sem prova:

- os testes WITHOUT_FIGURES do gancho (12): `business_not_confirmed` e `report_unavailable`, sem retorno do servidor,
  com a escuta encerrada, com divergência persistente, e sem conexão, escuta encerrada e divergência depois do
  primeiro retorno, nas janelas de 3 meses sem desconsiderada e de 12 com;
- a sonda R3-P4, nos três caminhos, para `ambiguous_reduced_eve` consistente;
- a sonda R3-P5, para `exclusion_unconfirmed` depois do primeiro retorno; antes dele vale o ADV-R2-06;
- o E2E "ADV-01 (R3.2)" na execução oficial;
- o N24 do executor morre.

O caso do meu ADV-01 da rodada 1, `no_work_minutes` com uma base, volta a esperar a prova. É a opção (b) que eu deixei
aberta naquele achado: a decisão está escrita com a justificativa do F-08 (`plano-20-20.md:19,68`;
`matriz-antes-depois.md:35`; `RELATORIO-P5F1-R32.md:22-23,51`). Testes fixam o comportamento:

- os 12 testes "com números", com a saída de cada espera: o servidor responde, o "Tentar de novo" reabre a escuta, ou
  a anomalia acaba;
- a tabela-verdade, que confere a classificação contra `UNAVAILABLE_REASON_TEXT`;
- as duas regexes da guarda.

O impacto na tela também está escrito: sem conexão, "em atualização"; com a escuta encerrada, "Não foi possível
confirmar…", no lugar do motivo (`matriz-antes-depois.md:29-30`). O que falta corrigir no RR-R32-02 está no ADV-R3-02.

**Estado sem saída: não achei.** Com o servidor disponível, a indisponível com números sai da espera nos três caminhos
(os testes acima). O tempo de interface também a troca por "em atualização" com "Tentar de novo": os mutantes C11
(tempo só para a pronta) e C12 (a falha só para a pronta) morrem em 7 e 4 testes do gancho, e o C13 (o tempo
que não recomeça) morre no teste do tempo de interface da R3.1. A divergência persistente fica em "em
atualização", com "Tentar de novo", até a anomalia acabar: é o requisito 7, igual à pronta. Os que ficam em
"calculando" sem o "em atualização" são os do ADV-R2-06, anteriores e documentados.

**Transições.** A prova não depende do estado da estimativa, e as sondas mostram o caminho certo:

- **R3-P6**, com a escuta encerrada: renda PJ sem confirmação → confirmada com a rotina sem horas → sem confirmação. O
  resultado é `business_not_confirmed` com o aviso → o erro "Não foi possível confirmar…" → `business_not_confirmed`
  com o aviso. Os números da rotina sem horas nunca aparecem. Na R3.1 e na rodada 2, aparecia
  `no_work_minutes meses=[08,09,10] aviso`.
- **R3-P7**, sem retorno do servidor: com números → "em atualização" → sem números (o motivo) → de volta → "calculando"
  e, passado o tempo, "em atualização". O tempo recomeça na volta, e só o texto muda.
- **O teste do gancho**, com a escuta encerrada: sem números → pronta. Nada converte até a escuta voltar.

**`refreshFailed`.** Fica verdadeiro com a escuta encerrada e falso sem conexão, nos testes sem números (PT-R32-08 a).
O C09 (sem `listenFailed`) morre em 4 testes do gancho.

**Reabertura da escuta, troca de workspace e de janela.** As sondas R3-P8 e R3-P9 repetem, com a rotina sem horas, os
testes da pronta: o workspace de ida e volta com o cache aquecido e a janela de 3 para 6 e de volta para 3, sem
retorno do servidor nas novas. Antes do retorno, só "calculando", nenhuma renderização com números e só o
workspace certo; com o retorno, o indisponível da janela ou do workspace certo (`sonda-r3-p8p9-ef51.log`).

### 4.2 O que a mudança não pega: os motivos de rotina ambígua (ADV-R3-01)

O comentário de `carriesBasisFigures` (`useIncomeEstimateWith.ts:111-112`) diz que a indisponível sem números "é a que
sai antes de qualquer receita (… rotinas sem cálculo seguro)". O mesmo vale na tabela-verdade e nos rascunhos. Mas, em
`estimate.ts`:

- a aplicação das desconsideradas (`:172`) vem antes;
- o corte dos primeiros meses sem renda, no modo habitual (`:179-180`), vem antes;
- o primeiro mês usado abre o período (`periodStart`, `:184`);
- só então vem a conferência da ambiguidade (`:189-191`).

Então o motivo de rotina ambígua depende da receita lida e das desconsideradas, como o `no_income` da R2-03.

O calendário das sondas: segunda 20:00–06:00 e terça 00:00–08:00, com a segunda 03/08/2026 reduzida a 8 h, como no
teste S01. Só agosto fica ambíguo. Agosto tem como única receita `ra`, de R$ 300,00, desconsiderada. Os estados
consistentes não usam agosto e estão prontos (R$ 7.040,00, setembro e outubro; controle R3-P0, estado 1).

| Sonda | Árvore final (e rodada 2) | R3.1 |
| --- | --- | --- |
| **R3-P0**, edição normal: `ra` de R$ 300,00 para R$ 100,00, com o gatilho aplicado no mesmo passo | `loading → indisponível ambiguous_reduced_eve → pronta 704000`. A R3-P0b mostra a causa: a série nova (agosto com R$ 100,00) com a leitura por id antiga (R$ 300,00). As desconsideradas de agosto são puladas (`exclusions_skipped`), e agosto volta ao período | `loading → pronta 704000` |
| **R3-P1**, estado misto: `ra` editada antes do gatilho (a R2-03 com outro motivo) | `loading → indisponível ambiguous_reduced_eve` até o gatilho; depois, a pronta | `loading`; depois, a pronta |
| **R3-P2**, cache aquecido sem conexão: a única receita de agosto anulada com a tela fora | o motivo falso, sem aviso, por mais que o tempo de interface; com a conexão de volta, a pronta | igual (a regra da leitura única da R3.1) |
| **R3-P3**, divergência persistente: a série com R$ 300,00 em agosto e a projeção com zero | depois das duas releituras, `ambiguous_reduced_eve` para sempre, sem "em atualização"; o controle sem a anomalia está pronto | igual |

O R3-P0 e o R3-P1 são regressão em relação à R3.1, aberta pelo ADV-01 na rodada 2 e mantida pelo F-08. A correção do
F-08 pedia "nenhum motivo de estado misto (R2-03)". O R3-P2 e o R3-P3 já aconteciam na R3.1 com uma base.

### 4.3 Frente B

**Lista de argumentos aceitos** (`grupos.mjs:52-72`).

- O que não está na lista é recusado, inclusive as formas combinadas e o valor de opção que começa com `-`.
- A sondagem `aceitos-fuzz` monta um commander com as 37 opções do comando `test` do Playwright 1.60, lidas do
  `program.js` sem executar o programa. Ela gera todas as sequências de até 3 argumentos com 53 fichas (151.739),
  inclusive formas combinadas, `=`, `--`, maiúsculas e travessão. Das 17.256 que o executor aceita, 13.854 são lidas
  sem erro e nenhuma traz opção fora de `grep`, `grepInvert`, `project`, `trace`, `x` e `maxFailures`; as outras
  3.402 dão erro do analisador, e o grupo reprova. O controle mostra que o mesmo analisador lê as recusadas (`-xj2`,
  `-xc`, `--debug`, `--retries=1`) com as opções proibidas, então a sondagem enxerga o que procura.
- Dois cuidados que não são falha:
  - `--project` é variádico no Playwright (`<project-name...>`): `--project chromium e2e/a.spec.ts` toma o arquivo
    como projeto e falha. É recusa falsa, segura;
  - `--grep-invert` e os filtros reduzem a lista, mas a lista e os grupos usam os mesmos argumentos, e lista vazia
    reprova (`checkGroupRuns`).
- Nenhuma opção aceita muda tentativa, prazo, paralelismo, configuração, relatório ou instantâneo.

**SIGQUIT e o cabeçalho** (`executar-em-grupos.mjs:22-29,51-66`).

- SIGQUIT entra na lista dos tratados; o U07 morre pelo teste do EST-11, com saída 131.
- O cabeçalho descreve o que o código faz: cada sinal vira um SIGINT ao grupo em curso; o sinal entre os grupos ou
  depois do último conta (U09, U10 e U15 morrem); o sinal só ao `npm` de cima não chega.
- O segundo sinal, que força a saída, está descrito, mas não tem teste: o U01 sobrevive (ADV-R3-03).

**Os testes novos** (`e2e-grupos.test.mjs:431-586`).

- **O `npx` falso em cadeia:** o neto grava o sinal recebido; o do meio só repassa SIGINT, SIGTERM e SIGHUP ao `sh`, que
  morre sem repassar. O sinal só chega ao neto pelo grupo. Mata o T01 (U11) e o U14 (sem `detached`).
- **O prazo 0:** mata o T03 (U12).
- **SIGHUP e SIGQUIT:** matam o U07 e o U08.
- **O sinal entre os grupos:** com a porta presa por 3 s, mata o U09 e o U15.
- **O sinal depois do último grupo:** mata o U10 e exige `doesNotMatch(/ok: \d+ testes/)`.
- **O instante do sinal:** sai da saída do executor (`grupo 1: saída 0, \d+/\d+ passaram`), e `holderPid` prova que a
  porta estava presa. O ajudante mata o executor que ficar de pé (o `finally`), e o teste não deixa órfão.
- **Sobreviventes:**
  - **U17** (o grupo morto por sinal conta como 0): sem efeito na decisão quando o grupo morre antes do relatório (vira
    "sem relatório") ou com a porta presa; sem teste para o grupo morto depois de escrever um relatório completo;
  - **U01** (o segundo sinal não é repassado). Os dois estão no ADV-R3-03.

**Nada termina com saída 0 numa execução incompleta ou com falha.**

- `ok` exige `interrupted === null`, nenhum problema e nenhuma linha "terminou com saída" ou "ainda em uso"
  (`executar-em-grupos.mjs:166`).
- A saída da interrupção é 128 + o sinal.
- A execução oficial na árvore final passou pelo procedimento: 218 testes, cada um uma vez.

### 4.4 Testes substituídos desde a rodada 2

Nenhum enfraquecido nem removido. Nenhum `skip`, `only`, `fixme` ou `test.fail` novo, nem prazo maior.

| Teste | Mudança | Conclusão |
| --- | --- | --- |
| Guarda do `holdEstimate` (`work-time-guard.test.ts:467-471`) | A regex da expressão com `state.estimate.status === 'ready'` deu lugar a duas regexes exatas: a do `holdEstimate` com `carriesBasisFigures(state.estimate)` e a do próprio `carriesBasisFigures` | Mudança de contrato pedida pelo F-08. Continua fixando a expressão inteira, agora com mais uma |
| Tabela-verdade (`work-time-income-estimate.test.ts:149-190`) | Antes: 6 motivos, sempre "como está". Agora: 5 sem números, sempre como estão; 6 com números, só provados e sincronizados; a pronta, igual. A classificação é conferida contra `UNAVAILABLE_REASON_TEXT` | Mais estrita nos com números, igual nos sem números. Os testes verdes da pronta (sem meses no objeto) também matam o C07 por erro de tipo |
| Bloco "o estado indisponível" (`work-time-consistency.test.ts:1689-1997`), de 12 para 29 testes | Os 5 + 6 testes "o indisponível aparece como está" (`no_work_minutes` e `no_income`) passam a exigir nenhum número sem prova, o estado de espera certo e a saída dele. Os casos sem números passam para `business_not_confirmed` e `report_unavailable`, com a ressalva. A transição parte da renda PJ. Entram as sondas R2-01 a R2-03 da financeira e o ADV-R2-07 | Mais estrito. As 5 asserções `assertOnlyUnavailable` removidas são o contrato que o F-08 inverteu, e ficaram substituídas pelas de espera e saída. Os 12 "com números" cobrem as mesmas condições, mais a recuperação. Asserções no arquivo: 169 → 185 |
| `e2e-grupos.test.mjs` | Na lista de aceitos/recusados, `--reporter=list` e `--ui-port 0` passaram de aceitos a recusados; entram as formas combinadas e `--debug`. O `npx` falso dos grupos `.wait` virou cadeia. O ajudante dos sinais ganhou `ready`/`env` e o `finally` | Mais estrito; nenhuma asserção removida (a do "grupo 1 não começou" virou a do instante do sinal). Asserções: 130 → 156 |
| E2E "ADV-01 (R3.2)" | Dois `console.log` e o comentário; nenhum título nem asserção | Igual |

## 5. Achados novos

### ADV-R3-01: LOW. Os motivos de rotina ambígua aparecem sem prova, mas dependem da receita lida: motivo falso de estado misto

- **Arquivo:linha:**
  - `src/modules/work-time/estimate.ts:172-191`: as desconsideradas e o corte dos meses sem renda vêm antes da
    conferência da ambiguidade;
  - `src/modules/work-time/useIncomeEstimateWith.ts:111-115`: `carriesBasisFigures` e o comentário "a que sai antes de
    qualquer receita (… rotinas sem cálculo seguro)";
  - `tests/unit/work-time-income-estimate.test.ts:160-162`: a lista `withoutFigures` com o mesmo comentário.
  - Os rascunhos: `plano-20-20.md:19`, `matriz-antes-depois.md:35`, `RELATORIO-P5F1-R32.md:22` e
    `revisoes-LEIAME.md:23,75`.
- **Cenário:** seção 4.2, sondas R3-P0 a R3-P3 com o gancho real. São necessários:
  - o modo habitual;
  - uma rotina ou exceção ambígua só nos primeiros meses da janela;
  - e esses meses passando de zero a alguma renda entre a leitura e o estado confirmado: uma edição ou anulação em
    outra sessão, uma desconsiderada no primeiro mês, o cache aquecido sem conexão, ou uma anomalia no servidor.
- **Impacto:**
  - Nenhuma conversão e nenhum número: o critério de encerramento continua atendido.
  - Aparece "Estimativa indisponível. Em algum dia do período, … Ajuste as exceções ou as rotinas em Configurações."
    num período que o estado confirmado não usa. Pode ser um *flash* numa edição normal (R3-P0), durar até o gatilho
    (R3-P1), durar sem conexão e sem aviso (R3-P2) ou durar para sempre depois das releituras (R3-P3).
  - O R3-P0 e o R3-P1 são regressão em relação à R3.1, aberta pelo ADV-01 e mantida pelo F-08. O F-08 pedia "nenhum
    motivo de estado misto".
  - A exposição é pequena: o editor recusa gravar as duas configurações ambíguas (E2E `work-time-p5f.spec.ts:1531` e
    S01). Elas só existem já gravadas (antes da recusa, em outro dispositivo) ou no rascunho não salvo da prévia.
  - "Nada errado aparece" (RR-R32-01, `plano-20-20.md:63`) e "os motivos que saem antes de qualquer receita" não são
    exatos.
  - A classificação para a área financeira, pelo critério do F-08, cabe à revisão financeira.
- **Correção sugerida, uma das três:**
  - (a) **Documentar:** registrar o caso como risco residual, com o R3-P0 a R3-P3. Corrigir o comentário de
    `carriesBasisFigures`, o da tabela-verdade e os rascunhos: os motivos de rotina ambígua não trazem números, mas,
    no modo habitual, dependem dos meses com renda. Tirar o "nada errado aparece". Acrescentar um teste que fixe o
    comportamento escolhido.
  - (b) **Segurar no modo habitual:** tratar `ambiguous_*` no modo habitual como dependente das leituras, e segurá-lo
    sem prova como os com números. O custo é o do ADV-01 para esses motivos: sem conexão, "em atualização".
  - (c) **Conferir a ambiguidade antes do corte:** fazer a conferência na janela inteira, antes do corte por renda.
    Muda o cálculo, porque o mês ambíguo sem renda passaria a deixar a estimativa indisponível. Fora do escopo desta
    etapa.

### ADV-R3-02: INFO. RR-R32-02 inexato depois do F-08

`plano-20-20.md:70` (RR-R32-02) diz que o painel "Receitas consideradas" e a contagem "só montam a lista com ela calculada
e na tela (a que converte, confirmada, ou a indisponível, com o motivo)". Depois do F-08, a indisponível com números
também espera a confirmação. O painel dela fica em "Carregando as receitas do período..." e, passado o tempo de
interface ou com a escuta encerrada, em "A estimativa não carregou…", como o da que converte. Isso vale porque
`IncomeEditor.tsx:46,108-111` usa só o estado mostrado.

Sugestão: "a que converte e a indisponível com números, confirmadas, ou a indisponível sem números, com o motivo".

### ADV-R3-03: INFO. Dois comportamentos do executor sem teste (U01 e U17)

- **U01, o segundo sinal.** O repasse do segundo sinal (`executar-em-grupos.mjs:59-64`) é o jeito documentado de forçar
  a saída do Playwright (cabeçalho, RB-04, RR-R32-04). Um mutante que só repassa o primeiro sobrevive. Sem ele, um
  segundo Ctrl+C não força mais nada: o Ctrl+C do terminal chega só ao grupo do executor.
- **U17, o grupo morto por sinal.** `resolve(signal ? 1 : …)` (`:78`) trata o grupo morto por sinal como falha. O
  mutante que o trata como 0 sobrevive. Ele só mudaria a decisão com o relatório completo escrito antes da morte e as
  portas livres. Não é caminho de aprovação falsa conhecido, mas não tem teste.
- **Sugestão:** um teste com dois sinais (o neto registra dois SIGINT) e um com o `npx` falso que escreve o relatório
  completo e se mata com SIGKILL.

## 6. Achados em aberto

| ID | Severidade | Resumo |
| --- | --- | --- |
| ADV-R3-01 | LOW | Os motivos de rotina ambígua (lista "sem números") aparecem sem prova, mas dependem da receita lida no modo habitual. Há motivo falso de estado misto (regressão em relação à R3.1) e motivo do cache ou da base divergente; o comentário "antes de qualquer receita" está errado. |
| ADV-R3-02 | INFO | O RR-R32-02 não diz que a indisponível com números também espera a confirmação para o painel "Receitas consideradas". |
| ADV-R3-03 | INFO | O segundo sinal (U01) e o grupo morto por sinal (U17) não têm teste. |

## 7. Firestore scale/cost review

PASS — Firestore scale/cost review

- **Escopo:**
  - Desde a rodada 2, a mudança é pura: `carriesBasisFigures` e a expressão do `holdEstimate`, mais testes,
    ferramentas e documentos.
  - Desde a R3.1, nenhuma consulta, escuta, índice, regra ou Function foi criada, mudada ou removida. O
    `git diff --stat efcbd264..ef514869` é vazio para `firestore.rules`, `firestore.indexes.json`, `functions/`,
    `reports/hooks.ts` e `incomeReads.ts`.
  - A escuta é a mesma: `workspaces/{workspaceId}/cash_report_periods`, `documentId()` entre o primeiro e o último mês,
    `limit(13)`, `includeMetadataChanges: true`.
- **Evidência por item:**

  | Item | Estado | Evidência |
  | --- | --- | --- |
  | Isolamento por workspace | PASS | O caminho tem o workspace, e as Rules exigem membro ativo com conta ativa, sem mudança. As chaves do cache levam a conta e o workspace (`basisSync.ts:135`). |
  | Consulta limitada | PASS | `limit(BASIS_PERIODS_MAX = 13)`, sem mudança. |
  | Paginação | N/A | Janela fixa de até 12 documentos mensais. |
  | Índices | PASS | Intervalo em `__name__`, índice automático; `firestore.indexes.json` sem mudança. |
  | N+1 e escutas duplicadas | PASS | Continua uma escuta por montagem. A leitura por id das desconsideradas (até 50) depende de `projectionReady`, não do estado mostrado. |
  | Ciclo de vida da escuta | PASS | Sem mudança desde a R3.1: cancelamento na limpeza do efeito e reabertura por `listenAttempt`. |
  | Leituras novas pela mudança | PASS | `holdEstimate` e `carriesBasisFigures` são puros. Só os consumidores dependem do estado mostrado, e quem lê a partir dele é o painel "Receitas consideradas" e a contagem (`useIncomeWindow`, `transactions/hooks.ts:68-78`, que exige `since` vindo do `referenceDate` da estimativa mostrada). Segurar a indisponível com números só adia ou evita essa leitura: igual à R3.1, nunca mais que na rodada 2. Nenhuma releitura nova da base: as releituras continuam ≤ 2 por estado divergente (os testes "com números" com divergência conferem `w.calls.series === 3`). |
  | Dados amplos no navegador | PASS | Até 13 projeções; nada somado de lançamentos. |
  | Escritas, agregados, retenção | N/A | Nenhuma escrita; as Rules negam escrita do cliente em `cash_report_periods`. |
  | Remoção do legado | PASS | Nenhuma regra antiga volta. A guarda fixa as duas expressões novas (`work-time-guard.test.ts:470-471`). |
  | Verificação no Emulator | PASS | A execução oficial `verify-all-r32-4` saiu com 0 na árvore final: 19 suítes de Rules na fase completa da integração e 218 E2E, inclusive o B03-g, o ADV-01 e o indisponível com números da fonte PJ. Nenhuma consulta nem regra mudou, então não há suíte nova a exigir. |

- **Modelo de custo** (estimativas). `W` = documentos da janela (≤ 12) e `M` = membros com a estimativa ligada.
  - Montagem: ≤ W leituras na escuta inicial, ou nenhuma a mais com a consulta idêntica ativa.
  - Mudança de projeção: 1 leitura por escuta, espalhada às M escutas.
  - Volta da conexão: os documentos mudados.
  - Releituras: ≤ 2 por divergência, dentro do agendador e do limite da callable (300/h por conta e workspace).
  - A rodada 3 não muda nenhum desses números. Pode só adiar a leitura da janela de receitas do painel enquanto a
    indisponível com números espera.
  - Com 10 000 usuários ligados: no máximo 3 escutas de ≤ 13 documentos por usuário.
- **Achados bloqueantes:** nenhum. O ADV-R3-01 é de apresentação, sem custo.
- **Verificação:** unidade 278/278 e 107/107, ferramentas 18/18 e 3/3, `tsc` 0 e os mutantes da seção 2, nas minhas
  cópias. O Emulator é da execução oficial do executor (`verify-all-r32-4`, `.meta` com a árvore no início e no fim).

## 8. O que não foi possível verificar

- **Nenhuma execução no Emulator nem E2E,** pela regra da rodada. O ADV-R3-01 está provado no gancho real (React Query
  real, mundo simulado). Entre o `holdEstimate` e a tela não há SDK, só React (`EstimateDetails.tsx:69-73`), então a
  unidade basta para o achado. Não peço E2E.
- **Relatório e plano finais.** Conferi os rascunhos de 18:35-18:38, que o executor ainda edita depois da execução
  oficial. Devem trazer o ADV-R3-01 (a decisão e a correção do "antes de qualquer receita") e o ADV-R3-02.
- **Interrupção real do executor** com o Playwright e o Emulator de verdade: não rodei, pela regra. Pelos testes com a
  cadeia `npx` → `sh` → neto, pelos mutantes e pelo experimento da rodada 2 com o `npx` real, o caminho está certo.
