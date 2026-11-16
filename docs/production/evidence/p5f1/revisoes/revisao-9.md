# P5-F.1 — Revisão independente 9 (somente leitura)

- **Data:** 2026-11-05
- **Objeto:** `snapshot-r9/` (árvore Git `854463e8`). Junto vieram `r9-sobre-r8.diff` (mudanças desde a revisão 8, árvore `16cda725`, sem os PNG), `revisao-8.md` (R8-01 … R8-04 e os resíduos R7-01, R6-02, R5-02 e R1-19) e as respostas do autor (`snapshot-r9/docs/production/evidence/p5f1/revisoes/respostas-revisao-8.md`).
- **Contrato de aceite:** `p5f1/spec-original.txt`.
- **Método:** li o código, os testes, os documentos e as fontes do TanStack Query 5.0.0. Conferi cada resposta no código e no teste que ela cita, não pelo texto. Nada exigiu `npm install`, Emulator, build, rede ou Firebase. Tudo rodou no snapshot com Node 22.23.4 e `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON`. React 18.2.0, react-test-renderer 18.2.0 e @tanstack/react-query 5.0.0 vieram de `wt-p5f1/node_modules`, só para leitura, por um gancho de resolução em memória (`--import data:…`). O que rodei:
  1. **Unitários e ganchos.** `test:unit:reports` (87, com os 37 de `report-basis-sync` e os 7 de `report-live-refresh`) e `test:unit:work-time` (94, com os 14 de `work-time-income-estimate`): 4 de 4 execuções de cada conjunto sem falha, com o `verify:all` final do autor em curso na máquina (fase E2E).
  2. **Os testes novos contra o código da revisão 8.** O gancho redirecionou `src/` para `snapshot-r8/src/` (árvore `16cda725`). Do teste do registro, tirei em memória só o trecho do símbolo novo, como o autor fez: `r8-contra-16cda725/` é igual a `snapshot-r8/src/` e ao teste atual sem esse trecho. Reprovam 6:
     - os dois do orçamento e o do "Tentar de novo", por asserção (`holding` falso e as exclusões relidas 3 vezes);
     - o da nova tentativa e o da série no teto, por tempo esgotado;
     - o do agendador, porque `scheduled` não existe lá.

     Passam os outros 52, como em `logs/r8/contra-16cda725.log`.
  3. **Mutantes em memória.** Um gancho de carga troca o trecho no módulo carregado, e um invólucro de `fs.readFileSync` (com `syncBuiltinESMExports`) troca o mesmo trecho no que a guarda lê. Uma marca no stderr prova cada troca, e nada é gravado.
     - **Lista.** Os 166 de unidade e os 11 de Rules saíram de `mutantes.py.txt` por `ast`, sem executar o roteiro. O SHA-256 é o de `p5f1/mutantes.py` (`e28910e3…`). Também conferem `atualizar-mutantes-r8.py` (`afd23d54…`), `escrever-mutantes-md.py` (`d68a5f33…`) e `gerar-tabela-mutantes.py` (`241b7492…`).
     - **Nenhum mutante ficou aplicado.** Os 177 trechos aparecem uma vez cada no snapshot, e nenhum substituto contém o trecho original. `src/` e `tests/` (356 arquivos) são a árvore `854463e8` (`git hash-object` sem `-w`, contra `git ls-tree`) e batem com `logs/mutantes-unit-r8.sha-antes`.
     - **Os 17 novos ou atualizados** (U54, U138, U152–U166): **17/17 mortos**, todos por teste de comportamento (U54 e U138 também pela guarda).
     - **19 antigos da mesma região** (U71, U96, U97, U102–U104, U109, U129–U133, U139, U140, U144, U146–U149): **19/19 mortos**.
     - **9 meus** sobre o código novo (Y2–Y17, em "Verificado sem achado").
  4. **Sondas**, como testes acrescentados em memória aos módulos de teste, com React Query real, a API em memória e o relógio manual só nos agendadores. Comparei cada uma com `snapshot-r8`:
     - N1 e N1e: a estimativa sem receita desconsiderada;
     - C1: duas estimativas;
     - T1: a janela que sai de 12 meses e volta;
     - E9, E9b e E9c: o mês avulso que entra com releitura pendente;
     - F1: a falha anterior da releitura da mutação.

  Nenhum arquivo foi criado nem alterado além deste parecer. A impressão SHA-256 de caminho, tamanho e data dos 2.453 arquivos do snapshot ficou igual antes e depois (`7ec6bc4f…`), e `review/` só ganhou este arquivo. Em `snapshot-r8`, só rodei testes (com `src/` redirecionado). No worktree `wt-p5f1`, só li `node_modules` e objetos do Git (`ls-tree`, `cat-file`, `rev-parse` e `log`, com `--no-optional-locks`). Li os registros do autor em `p5f1/logs/` só para leitura. Quando uma conclusão depende do TanStack Query 5.0.0, do React 18.2 ou do SDK Firebase 12.8, isso está dito.

## Escopo revisado

- **Código e testes do `r9-sobre-r8.diff`:**
  - `src/modules/reports/{liveRefresh,basisRegistry,basisSync}.ts`;
  - `tests/unit/{report-live-refresh,report-basis-sync,work-time-income-estimate,work-time-guard}.test.ts`.
- **Documentos do diff:**
  - plano §20.15: `:4764`, `:4775`, `:4779-4782`, `:4799-4800`, riscos `:4812-4813` e `:4825`, estado `:4832`;
  - `DATA_MODEL.md:277`;
  - `evidence/p5f1/`: LEIAME, VEREDITOS, autorização, elegibilidade, execuções, mutantes e roteiros, a nota em `respostas-revisao-7.md:23-28`, `respostas-revisao-8.md` e a cópia de `revisao-8.md` (igual à original).
- **Contexto fora do diff:**
  - `src/modules/reports/{basisRefresh,queryKeys,hooks}.ts`, `src/modules/transactions/incomeReads.ts` e `src/modules/work-time/{useIncomeEstimateWith,useIncomeEstimate}.ts`;
  - `@tanstack/query-core` 5.0.0 (`build/modern/{query,queryClient,queryObserver,retryer,notifyManager}.js`) e `@tanstack/react-query` 5.0.0 (`build/modern/useBaseQuery.js`).
- **Registros do autor (só leitura):** `logs/r8/contra-16cda725.log`, `mutantes-unit-r8*.log`, `mutantes-rules-r8.*`, `e2e-wt-r8.log`, `repeticoes-r8/` e `verify-all-final.*`.

Linhas do plano referem-se a `docs/production/PRODUCTION_READINESS_PLAN.md` do snapshot.

## Resumo

| Situação dos achados da revisão 8 | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 2 | R8-03, R8-04 |
| CORRIGIDO nos cenários dos testes, com resíduo | 1 | R8-01 (resíduo em R9-01 e R9-02) |
| ACEITO COMO RISCO DOCUMENTADO | 1 | R8-02 (duração em R9-03) |

| Resíduos listados | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO nos cenários apontados, com resíduo | 3 | R7-01 e R6-02 (R9-01, R9-02 e R9-03), R5-02 (R9-01) |
| ACEITO COMO RISCO DOCUMENTADO | 1 | R1-19 |

| Achados novos | Qtde | IDs |
| --- | --- | --- |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 2 | R9-01, R9-03 |
| INFO | 2 | R9-02, R9-04 |

Não há achado HIGH nem MEDIUM. As correções resolvem R8-01 nos cenários dos testes: uma estimativa de 12 meses com receita desconsiderada. Nesse caso, com prova de comportamento:

- **Espera.** A base nova sem pedido espera a releitura pendente da outra, e as exclusões são relidas uma vez, depois das duas.
- **"Tentar de novo".** Ele relê as duas bases e libera sem esperar a reposição.
- **Teto.** A base parada no teto deixa a outra liberar, com a ressalva. A base relida com sucesso sai do teto.
- **Prova.** Os 6 testes do R8-01 reprovam contra `16cda725`, e os 17 mutantes novos ou atualizados morrem.

R8-03 está corrigido: U151, X1, X2 e X3 morrem por comportamento, sem a guarda.

Os achados novos:

- **R9-01 (LOW).** A espera mora na regra de pareamento da leitura dependente, que só existe com receita desconsiderada. Sem nenhuma, o cenário de R8-01 continua exatamente como em `snapshot-r8`: só uma das bases nova, por até 10 min.
- **R9-02 (INFO).** Com receita desconsiderada, outra estimativa com uma base só, ou a janela que sai de 12 meses e volta, ainda contorna a espera. Os dois casos exigem as escutas encerradas e já eram assim em `snapshot-r8`.
- **R9-03 (LOW).** A espera nova alonga o caso de R8-02, registrado como "em geral, menos de um segundo". Depois de uma mutação nesta aba, ele dura até a releitura pendente da série sair: 30 s, ou até 10 min com o orçamento gasto. A ressalva não aparece.
- **R9-04 (INFO).** Textos com imprecisões novas: contagem do plano, teto, falha que "não conta" e ordem dos pedidos.

O isolamento por titular e por workspace continua correto. Nada derivado é gravado, e a estimativa segue sem autoridade financeira.

## 1. Situação dos achados da revisão 8

| ID | Sev. original | Situação | Evidência (snapshot-r9) | O que falta |
| --- | --- | --- | --- | --- |
| R8-01 | LOW | CORRIGIDO nos cenários dos testes (uma estimativa, com receita desconsiderada); resíduo em R9-01 e R9-02 | (1) **Espera.** `scheduled` nos agendadores (`liveRefresh.ts:76-77`). `basisRereadScheduled` olha os dois agendadores e só considera pedido posterior ao começo da última leitura (`basisRegistry.ts:101-105`). A ordem vem de um contador só (`:50-71`). Todo pedido passa pelo registro (`:41`, `:89`, `basisSync.ts:201`; guarda `work-time-guard.test.ts:345,365`), e o começo é guardado na `queryFn` (`basisSync.ts:134`). A espera fica em `followReads` e vale só com mais de uma base (`:430`). (2) **Testes.** Os 6 do R8-01 (`report-basis-sync.test.ts:1001-1128` e `report-live-refresh.test.ts:134`) reprovam contra `16cda725` e passam aqui. As sondas P1 e P1b da revisão 8 viraram os testes de `:1001-1013`. (3) **Teto.** A decisão está registrada (plano `:4812`). A base relida com sucesso sai do teto (`basisSync.ts:193-197`; teste `:1091-1128`). (4) **"Tentar de novo".** Libera sem esperar (teste `:1016-1034`; U164 e U165). U152–U166 mortos | Sem receita desconsiderada, nada segura (R9-01). Com ela, a liberação de outra estimativa com uma base só e a janela que sai de 12 meses e volta contornam a espera (R9-02) |
| R8-02 | INFO | ACEITO COMO RISCO DOCUMENTADO; a duração registrada deixou de valer (R9-03) | O risco está no plano (`:4813`) e no comentário (`basisSync.ts:270-273`). A análise das duas saídas está certa. Com as entradas trocadas, não há estimativa anterior a mostrar. "Calculando" valeria para qualquer troca de configuração durante uma retenção | Com releitura pendente da série, o caso dura até ela sair, e não uma leitura por id (R9-03) |
| R8-03 | INFO | CORRIGIDO | U151, X1 e X2 morrem por comportamento, sem a guarda: são U162, U160 e U161, mortos pelos testes `work-time-income-estimate.test.ts:514` e `:541`. X3 morre pelo teste `report-basis-sync.test.ts:1130` (U163). A guarda fixa as dependências do `useMemo` (`work-time-guard.test.ts:400`), e a nota está em `respostas-revisao-7.md:26`. X4 ficou sem teste, por decisão registrada; o código (`?? -1`) é o lado seguro | — |
| R8-04 | INFO | CORRIGIDO no que apontou; imprecisões novas em R9-01, R9-03 e R9-04 | O comentário (`basisSync.ts:265-284`) não promete mais "nem só uma das bases" e cita o mês avulso e o teto. O item da revisão 7 (plano `:4799`) limita a janela futura à mesma base e não diz mais "como o pedido já fazia". `respostas-revisao-7.md:23-26` corrige as três frases. R8-01 e R8-02 estão nos riscos (`:4812-4813`) | Ver R9-01, R9-03 e R9-04 |
| R7-01 | LOW | CORRIGIDO nos cenários do achado; resíduos em R9-01 e R9-02 (o de R8-01) e em R9-03 (o de R8-02, registrado) | Ver R8-01 e R8-02 | R9-01, R9-02 e R9-03 |
| R6-02 | LOW | CORRIGIDO nos cenários apontados (com R7-01, R7-02 e R8-01); resíduos em R9-01, R9-02 e R9-03 | Ver R7-01 | R9-01, R9-02 e R9-03 |
| R5-02 | LOW | CORRIGIDO nos cenários apontados; resíduo em R9-01 | Com a escuta encerrada, a releitura da mutação é o único caminho (`incomeReads.ts:47`; `basisRegistry.ts:86-91`). Com receita desconsiderada, a espera segura até as duas bases chegarem | Sem receita desconsiderada, a base nova sem pedido não é segurada (R9-01) |
| R1-19 | INFO | ACEITO COMO RISCO DOCUMENTADO | Sem mudança. A decisão está no plano (`:4823`), e `Header.tsx` não está no diff | — |

## 2. Achados novos

### R9-01 — LOW: sem receita desconsiderada, a espera não existe; na janela de 12 meses, o cenário de R8-01 continua igual ao de `snapshot-r8`, com só uma das bases nova por até 10 min

**Local:**
- `src/modules/work-time/useIncomeEstimateWith.ts:155-157`: a leitura dependente é `needsExcluded ? excluded.dataUpdatedAt : null`; sem receita desconsiderada, é nula.
- `src/modules/reports/basisSync.ts`:
  - `:416`: `followReads` sai logo com `value === null`, e a espera (`:430`) e a liberação (`:431`) nunca rodam;
  - `:497-505`: `pairedIncome` só existe com `reads !== null`; sem ele, `ahead` é falso, e `holding` (`:513`) fica só com `syncing`, que exige pedido em curso;
  - comentários `:273-281` ("é segurada já na renderização em que chega [...] a releitura da mutação adiada pelo orçamento de uma base segura a outra até chegar") e `:407-408` ("a primeira base relida não é mostrada sem a outra").
- Documentos:
  - plano `:4764` e o risco `:4812` ("a estimativa segura a versão anterior, com a ressalva, por até 10 min");
  - `DATA_MODEL.md:277` e `VEREDITOS.md:45`;
  - `respostas-revisao-8.md:20` e a nota de `respostas-revisao-7.md:25`.
- Testes: todos os do R8-01 têm leitura por id.
  - O `Probe` tem `withExcluded = true` por padrão (`report-basis-sync.test.ts:223`), e nenhum teste novo o desliga (`budgetSpent`, `:966`; `mount`; `mountWindow`).
  - Na estimativa inteira, os testes novos usam `excludedIds: ['r500']` (`work-time-income-estimate.test.ts:514-568`).

**O que acontece.**
1. A espera nova está dentro de `followReads`, a regra que pareia a leitura dependente com a receita das bases. Sem receita desconsiderada não há leitura dependente, e nada segura uma base nova que chega sem pedido.
2. Com a escuta viva, a divergência pede, e `syncing` segura até todas as bases chegarem (`arrived`), com ou sem desconsiderada. O caso fica para a escuta encerrada por erro (ou que não entrega). É justamente o de R8-01 e R5-02, em que a releitura da mutação é o único caminho.
3. É o comportamento de `snapshot-r8`, sem mudança. A correção vale para quem desconsiderou alguma receita. O cenário de R8-01 não tinha receita desconsiderada e continua igual. A receita desconsiderada é opcional, e muitas estimativas não têm nenhuma.

**Cenário concreto** (o de R8-01):
- Fonte PF, modo habitual, nenhuma receita desconsiderada.
- Nos últimos 10 min, a pessoa lançou duas despesas nesta aba, ainda com 3 meses, e gastou o orçamento da mutação da série. Depois, passou a 12 meses, e o mês avulso nasceu com o orçamento cheio.
- A escuta da estimativa é encerrada por erro, e a ressalva aparece no topo.
- Ela corrige a data de uma receita de R$ 500,00 de 20/11/2025 para 20/10/2026.
- 30 s depois, o mês avulso é relido sem a receita, e a série espera a reposição.
- Por até 10 min, a estimativa conta a receita em nenhum dos dois meses, com a ressalva. Com R$ 3.000,00 por mês, mostra R$ 35.500,00 em vez de R$ 36.000,00. Com a data trocada no sentido inverso, conta a receita duas vezes.

**Sondas.**

| Sonda | Situação | r9 | `snapshot-r8` |
| --- | --- | --- | --- |
| N1 (gancho) | `budgetSpent` sem a leitura por id (`withExcluded: false`), com a escuta viva sem retorno e com a escuta encerrada | `holding` e `syncing` falsos. O estado livre e misto (out/2026 em 100.000, nov/2025 em 40.000) fica até a reposição. Com a leitura por id: `holding` verdadeiro e nenhuma renderização livre mista, como nos testes do autor | — |
| N1e (estimativa inteira) | 3 → 12 meses, `excludedIds: []`, escuta encerrada, R$ 500,00 de nov/2025 para out/2026 | 3.600.000\* → 3.550.000\* (até a reposição) → 3.600.000\* (\* = ressalva) | Igual |
| N1e com uma desconsiderada | O mesmo, com `excludedIds: ['r500']` | 3.550.000\* do começo ao fim | 3.550.000\* → 3.500.000\* → 3.550.000\* |

**Correção sugerida:**
- Fazer a espera valer também sem leitura dependente. Uma saída: tratar a falta dela como uma leitura que a liberação "relê" na hora (por exemplo, um contador interno). Assim, `paired`, `ahead` e a espera valem sempre. Outra: com mais de uma base, segurar na renderização enquanto uma base nova estiver à frente de outra que tem releitura pendente pedida depois do começo da última leitura dela.
- Teste: os do R8-01 com `withExcluded: false` e a estimativa inteira com `excludedIds: []`.
- Ou registrar nos riscos que a espera só existe com receita desconsiderada e corrigir os textos citados.

### R9-02 — INFO: com receita desconsiderada, a espera ainda é contornada por outra estimativa com uma base só e pela janela que sai de 12 meses e volta

**Local:**
- `src/modules/reports/basisSync.ts`:
  - `:425-429`: a leitura dependente nova, sem liberação desta estimativa, é pareada com a receita atual antes da espera (`:430`);
  - `:404-410` e `respostas-revisao-8.md:20`: "Uma base só sempre libera na chegada" e "não há outra base para juntar";
  - `:177-185`: quando a base sai de uso, os dois agendadores são cancelados, e a ordem é esquecida.
- `src/modules/transactions/incomeReads.ts:27-30`: a liberação relê as leituras de receitas do workspace, que as estimativas dividem.
- `@tanstack/query-core` 5.0.0, `queryObserver.js:418-419` (`shouldFetchOptionally`): a base que volta a ser usada só é lida se estiver desatualizada, e a releitura da mutação não a marca.

**O que acontece.**
1. **Outra estimativa com uma base só.**
   - O provedor e a prévia de Configurações (ou o assistente) podem ter janelas diferentes: uma de 12 meses e outra de 1, 3 ou 6. Elas dividem a série e a leitura por id.
   - Com a releitura do mês avulso pendente (orçamento gasto, ou a nova tentativa depois de uma falha), a série chega nova. A estimativa de uma base só libera na chegada e relê as leituras de receitas.
   - Na de 12 meses, a leitura por id muda sem liberação dela, e `followReads` a pareia com a receita atual: série nova e mês avulso antigo. `ahead` fica falso, e a estimativa fica livre e mista até a reposição.
2. **Janela que sai de 12 meses e volta durante a espera.**
   - O mês avulso sai de uso, e a releitura pendente da mutação dele é cancelada.
   - Na volta, ele vem do cache, sem releitura, e não há mais releitura pendente. A liberação junta a série nova com o mês avulso de antes da mutação até outro sinal.
3. **Por que INFO.** Os dois casos exigem que nenhuma escuta da mesma conta e do mesmo workspace entregue. Um retorno do servidor a qualquer uma delas reabre as encerradas, e a reaberta pede a releitura (a sincronização segura por `syncing`). Na troca de janela, a escuta também é reassinada.
4. Os dois são iguais em `snapshot-r8`, que não tinha a espera. São resíduos de R8-01 fora do caminho que a correção cobre.

**Sondas** (gancho, com a leitura por id e as escutas encerradas):

| Sonda | Situação | r9 | `snapshot-r8` |
| --- | --- | --- | --- |
| C1 | Estimativas de 3 e de 12 meses montadas; a de 12 monta 5 s depois, então o orçamento do mês avulso tem outra fase. Uma despesa gasta as duas fichas. A receita passa de nov/2025 para out/2026. A série tem ficha, e o mês avulso espera a reposição | A de 3 meses libera e relê as exclusões. A de 12 fica livre e mista (out/2026 em 150.000, nov/2025 em 90.000) até a reposição, quando libera e relê as exclusões de novo | Igual |
| T1 | Uma estimativa de 12 meses, com as duas releituras da mutação esperando a reposição. A janela vai a 3 meses e volta a 12 | O mês avulso nunca é relido (2 chamadas) e fica livre e misto no fim (out/2026 em 150.000, nov/2025 em 90.000) | Igual |

**Correção sugerida:**
- (a) Enquanto alguma base tiver releitura pendente pedida depois do começo da última leitura dela, não parear com a receita atual a leitura dependente nova que esta estimativa não liberou; continuar segurando até a liberação.
- (b) Não descartar a releitura pendente da base que sai de uso, ou marcar a base como desatualizada, para que a volta à janela a leia.
- Ou registrar os dois caminhos nos riscos e corrigir "não há outra base para juntar".

### R9-03 — LOW: a espera alonga o caso de R8-02 (registrado como "menos de um segundo") até a releitura pendente da série sair: 30 s depois de uma mutação nesta aba, ou até 10 min com o orçamento gasto, sem ressalva

**Local:**
- `src/modules/reports/basisSync.ts:430`: a espera vale também para a liberação que relê a leitura por id quando o mês avulso entra (o par tem 12 meses, e a base, 13).
- `src/modules/work-time/useIncomeEstimateWith.ts:104-110`: com as entradas trocadas, `holdEstimate` mostra o estado atual.
- `src/modules/reports/basisRegistry.ts:86-91` e `queryKeys.ts:53-57`: toda mutação nesta aba deixa a releitura da série pendente por 30 s (até 10 min sem ficha).
- Documentos:
  - risco do plano `:4813`: "até a leitura por id relida chegar (em geral, menos de um segundo)";
  - `respostas-revisao-8.md:21`: "esse caso, que dura uma leitura por id";
  - comentário `basisSync.ts:270-273`.

**O que acontece.**
1. **O caso de R8-02.** A estimativa que passa a 12 meses recebe o mês avulso novo com a leitura por id de antes dele. `ahead` segura, mas, com as entradas trocadas, `holdEstimate` mostra o estado misto até a leitura por id relida chegar.
2. **Em `snapshot-r8`,** a liberação saía na chegada do mês avulso, e o estado misto durava uma leitura por id.
3. **Agora,** com duas bases, a liberação espera qualquer releitura pendente pedida depois do começo da última leitura da série. A própria anulação nesta aba deixa a releitura da mutação da série pendente, e qualquer outra mutação nos últimos 30 s também. O estado misto fica até ela sair: 30 s depois da última mutação ou, com o orçamento gasto, na reposição (até 10 min).
4. **A escuta da janela nova não encurta a espera.** A projeção já é igual às bases (converge), e nada é pedido nem liberado por ela (sonda E9b).
5. **Não há ressalva,** porque nada falhou.

**Cenário concreto** (o de R8-02, com a anulação nesta aba):
- Fonte PF, 3 meses, R$ 3.000,00 por mês. A receita de R$ 500,00 de 15/11/2025 está desconsiderada.
- A pessoa a anula em Receitas, nesta aba, e o gatilho grava nov/2025 sem ela.
- Logo depois, ela passa a 12 meses em Configurações (ou salva, e o topo recebe os 12 meses).
- A estimativa de 12 meses desconta a receita duas vezes: mostra R$ 35.000,00 em vez de R$ 35.500,00 por até 30 s. Em `snapshot-r8`, só por uma leitura por id.
- Se ela tiver lançado duas despesas nos 10 min anteriores, o valor errado fica até a reposição: 5 min na sonda E9c.

**Sondas** (estimativa inteira; os valores reais da releitura da mutação no relógio dos agendadores):

| Sonda | Situação | r9 | `snapshot-r8` |
| --- | --- | --- | --- |
| E9 | Anulação nesta aba e troca para 12 meses logo depois, com a escuta viva e com a encerrada | `loading` → 3.500.000 até a releitura da mutação da série sair (30 s). Só então a leitura por id é relida → 3.550.000 | 3.500.000 só até a leitura por id, relida na chegada do mês avulso → 3.550.000 |
| E9b | O mesmo, com a escuta da janela nova entregando a projeção | Igual a E9: a projeção converge e não libera | — |
| E9c | Duas despesas antes (orçamento da série gasto), a anulação e a troca 2 min depois | 3.500.000 por 5 min, até a reposição | — |

**Correção sugerida:**
- Não esperar quando o par não tem as mesmas bases (o mês avulso que entra ou a chave trocada), ou esperar só pelas bases que já estavam no par. A releitura pendente que chegar depois libera de novo.
- Teste: a troca para 12 meses logo depois de uma mutação nesta aba.
- Ajustar o risco (`:4813`) e `respostas-revisao-8.md:21`.

### R9-04 — INFO: documentos e comentários com imprecisões novas

**Local e o que diz:**
1. **Contagens do plano** (`:4779`): "`test:unit:reports` 86, com 36 testes de gancho". Medi 87 testes, com 37 em `report-basis-sync` (35 declarações, duas delas em laço). `VEREDITOS.md:49` e `execucoes.md:98,102` dizem 87, e `VEREDITOS.md:49,60` e `autorizacao-isolamento.md:42`, 37.
2. **Teto em `VEREDITOS.md:45`.** O texto diz "com teto depois de falha que só uma projeção nova ou a virada do mês reabrem". A mesma linha diz "Uma leitura que chega com dados zera as falhas da base", e o plano (`:4764`, `:4825`) inclui o "Tentar de novo".
3. **"A falha da releitura da mutação continua sem contar para o teto."** Aparece em `respostas-revisao-8.md:20`; o comentário da guarda (`work-time-guard.test.ts:362-363`) e `execucoes.md:98` dizem "só a base desatualizada conta a falha".
   - Ela não conta na hora, mas conta depois. O ramo sem desatualização (`basisSync.ts:193-197`) não guarda `errorUpdatedAt`. Quando a base fica desatualizada por um sinal novo, `basisRefreshAfter` (`basisRefresh.ts:89-91`) conta aquela falha antiga.
   - O pedido seguinte chega ao teto com uma releitura falha em vez de duas. Sonda F1: 2 chamadas em vez de 4.
   - É igual em `snapshot-r8`. O efeito é só menos insistência: a estimativa fica com a última leitura, a ressalva e o "Tentar de novo".
   - Correção: guardar `errorUpdatedAt` também nesse ramo, ou ajustar os textos.
4. **Ordem dos pedidos** (`basisRegistry.ts:45-48`): "uma leitura que começou depois de um pedido já lê um estado pelo menos tão novo quanto o que motivou o pedido".
   - No pedido da mutação, o que motiva o pedido é a projeção que o gatilho grava depois. Uma leitura que começa entre a mutação e o gatilho (por exemplo, o "Tentar de novo" nos primeiros segundos) conta como mais nova e solta a espera sem ter visto o gatilho.
   - Não achei cenário prático com a escuta funcionando: o "Tentar de novo" reabre a escuta, que vê o gatilho e pede. A frase promete mais do que isso.
5. **Frases cobertas por R9-01, R9-02 e R9-03:**
   - "segura a outra até chegar";
   - "a primeira base relida não é mostrada sem a outra";
   - "Uma base só [...] não há outra base para juntar";
   - "a estimativa segura a versão anterior, com a ressalva";
   - "menos de um segundo".

**Correção sugerida:** ajustar os textos e, no item 3, de preferência o código.

## 3. Verificado sem achado

1. **Testes, guarda e mutantes.**
   - Os 181 testes (87 + 94) passam em 4 de 4 execuções de cada conjunto.
   - Contra `16cda725`, 6 testes reprovam e 52 passam. Os 5 testes novos que já passavam lá fixam comportamento existente e morrem nos mutantes: "uma base só" mata U153; "o mês avulso sem leitura nova" mata U163; "a falha da releitura da mutação" mata U159; os dois da estimativa inteira matam U160–U162.
   - Nada foi enfraquecido. As asserções subiram de 97 para 116 em `report-basis-sync`, de 36 para 42 em `work-time-income-estimate`, de 17 para 23 em `report-live-refresh` e de 165 para 173 na guarda.
   - As 5 asserções removidas da guarda deram lugar a versões mais estritas: o pedido pelo registro, o efeito das falhas inteiro, a `queryFn` com a ordem e a espera antes da liberação. Não há `skip`, `only` nem `todo`, e os prazos de `until` e `settle` são os mesmos.
   - Os dublês novos são legítimos:
     - o relógio manual (`report-basis-sync.test.ts:294-314`) só entra em `deps.refresh.clock`; as leituras, o React Query, `until` e `settle` seguem o relógio real;
     - `monthFailing` (`work-time-income-estimate.test.ts:115,169`) só faz o mês avulso falhar;
     - `mountWindow` com `extraMonth` (`:284-292`) mantém os chamadores antigos (o padrão é `null`);
     - o teste do registro usa agendadores falsos com `scheduled`.
   - Mutantes: 17/17 novos ou atualizados e 19/19 antigos da região mortos, e nenhum ficou aplicado no snapshot.
   - **Mutantes meus:**

     | Mutante | Troca | Resultado |
     | --- | --- | --- |
     | Y11 | o ramo sem desatualização cai na contagem | morto por comportamento |
     | Y12 | `scheduled` sempre verdadeiro | morto por comportamento |
     | Y14 | o pedido da mutação sem a ordem | morto por comportamento |
     | Y15 | a nova tentativa sem a ordem | morto por comportamento |
     | Y17 | `every` no lugar de `some` na espera | morto por comportamento |
     | Y2 | `>=` no lugar de `>` | equivalente: pedido e começo nunca têm a mesma ordem |
     | Y4 | sem `forgetBasisOrder` | equivalente: a entrada nova começa sem releitura pendente |
     | Y8 | começo ausente contado como depois do pedido (`?? Infinity`) | sobrevive, como o X4 da revisão 8. O código (`?? 0`) é o lado seguro; o caminho é o da base que volta do cache, como em T1 |
     | Y13 | o pedido da escuta e da virada sem passar pelo registro | sobrevive aos testes de comportamento; morre pela guarda (`work-time-guard.test.ts:338,345`) |

2. **A espera não prende a retenção.** Toda espera acaba quando a releitura pendente sai. Isso acontece 30 s depois da última mutação desta aba (cada `notify` recomeça o agrupamento, `liveRefresh.ts:67-70`), na reposição (até 10 min, `:54-60`) ou, na nova tentativa, em 5 s, dentro do orçamento da escuta. Os casos do pedido:
   - **Base que falha na releitura pendente:** a falha da mutação não pede outra, e a liberação sai com a ressalva (`useIncomeEstimateWith.ts:216`). A base desatualizada pede uma nova tentativa (a espera continua) até o teto, e depois libera com a ressalva.
   - **Consulta desligada:** `refetchQueries` só pula a consulta com todos os observadores desligados (`query.js:71-73`; `queryClient.js:147`), e aí a entrada já saiu do registro.
   - **Estimativa desligada:** `syncKey` é nulo, e nada é avaliado. As entradas saem do registro, e a ordem é esquecida. Na volta, a estimativa passa por `loading`.
   - **Pausa sem rede** (TanStack Query 5.0.0): a busca fica `paused` (`query.js:285`), e `refetchQueries` a devolve resolvida (`queryClient.js:152`). `isFetching` fica falso (`queryObserver.js:301,325`), e `fetchStatus` e `isPaused` não são propriedades rastreadas (`queryObserver.js:346-366`; `useBaseQuery.js:57`). Sem nova renderização, a retenção continua até a rede voltar. A busca então continua (`query.js:85-88`; `retryer.js:115-118`), entra em leitura e, na chegada, libera.
   - **Agendador cancelado:** só com zero usuários (`basisSync.ts:179-185`); com a base em uso, nunca. O caso da base que sai de uso e volta está em R9-02.
   - **Troca de chave ou de janela:** de 12 meses para menos, a estimativa fica com uma base só e libera. Na virada do mês, a chave do mês avulso muda e passa por `loading`.
3. **A decisão roda de novo quando a releitura pendente sai** (TanStack Query 5.0.0 e React 18.2).
   - O disparo chama `refetchQueries`, que cancela a busca em curso e começa outra (`queryClient.js:141-156`; `query.js:121-125`).
   - `isFetching` é rastreado, porque a desestruturação em `basisSync.ts:188` e o uso em `useIncomeEstimateWith.ts:151` o leem. A notificação sai num microtask (`notifyManager.js`).
   - A memória da base é refeita (`useIncomeEstimateWith.ts:153`, com `isFetching` nas dependências, fixado pela guarda), e o efeito de `basisSync.ts:475-488` roda com `basis.fetching`. Na chegada, `versionsKey` muda, e a liberação sai.
   - Os testes do orçamento provam a liberação depois da reposição.
4. **Sem releitura a mais nem laço.**
   - `basisRereadScheduled` só lê, e o ramo novo do efeito das falhas não pede nada.
   - Com as duas bases relidas em momentos diferentes, a leitura por id é relida uma vez, depois das duas: o registro é exatamente `['mês avulso', 'relatório', 'exclusões']`, no teste e na sonda N1 com exclusões.
   - O "Tentar de novo", com a releitura da série ainda pendente, gasta uma chamada a mais na reposição, dentro do orçamento da mutação, e não relê mais nada (teste `:1016-1034`).
   - O modelo de custo continua valendo: "até cerca de 43 por hora por base" (`VEREDITOS.md:71`; plano `:4822`).
5. **Ordem dos pedidos e dos começos.**
   - Pedem releitura pelo registro: a escuta e a virada (`basisRegistry.ts:41`), a mutação (`:89`) e a nova tentativa (`basisSync.ts:201`). A guarda proíbe outro `notify` (`work-time-guard.test.ts:345,365`).
   - Leem pela `queryFn`, que guarda o começo: a carga, os agendadores, o "Tentar de novo" (`refetch()` cancela e lê de novo, `queryObserver.js:146-160`) e cada nova tentativa do `retry` (`retryer.js:77-120`).
   - A leitura deduplicada devolve a promessa em curso sem chamar a `queryFn` (`query.js:126-128`), e o começo guardado é o da leitura cujo dado chega. A cancelada é sempre substituída por outra, que guarda o seu começo.
   - Na pausa sem rede, o começo é guardado na volta, quando a leitura de fato acontece.
   - Ressalvas: o item 4 de R9-04, e a pausa, em que a espera acaba antes de a leitura começar (só pesa se outra mudança rodar a decisão no meio).
6. **Efeito das falhas e teto.**
   - A leitura com dados zera as falhas nos dois ramos (`basisSync.ts:196`; `basisRefresh.ts:86-88`). A falha só soma no ramo desatualizado, com `errorUpdatedAt > dataUpdatedAt` (`basisRefresh.ts:89-91`).
   - "Base no teto ⟹ em erro" vale em todos os caminhos: no teto, a última leitura observada falhou, e a consulta está em `error`. A estimativa mostra a ressalva. A única exceção é passageira: um sucesso seguido de outra leitura antes de uma renderização sem leitura em curso, até essa leitura terminar.
   - A mutação continua pulando a base no teto (`basisRegistry.ts:88`), e a base relida com sucesso volta a ser relida (teste `:1091-1128`; U157–U159).
   - A ressalva sobre "não conta" está no item 3 de R9-04.
7. **Evidência.**
   - `logs/r8/contra-16cda725.log`: 58 testes, 6 reprovados e 52 aprovados.
   - `mutantes-unit-r8.log`: "166/166 mortos; 0 não compilam", em 1.316 s.
   - `mutantes-rules-r8.log`: "11/11 mortos", com as impressões de antes e depois iguais.
   - `e2e-wt-r8.log`: "15 passed (2.7m)".
   - `repeticoes-r8/`: 60 registros, todos com "# fail 0" (30 com 87 testes e 30 com 94).
   - Os registros das duas rodadas interrompidas batem com `execucoes.md:100-101`.
   - `mutantes.md` tem 166 linhas de unidade e 11 de Rules, todas "morto".
8. **Isolamento e superfície.**
   - O diff não toca Rules, índices, Functions, interface nem textos visíveis.
   - As ordens novas ficam em mapas do módulo, com a chave da base (uid, workspace, período e seções). Elas guardam só números, e nada é gravado.
9. **Plano.**
   - O §20.15 continua "AGUARDANDO AUDITORIA INDEPENDENTE" (`:4832`), sem marcar o gate da P5 nem P6–P10.
   - Os marcadores `⟦…⟧` são preenchidos depois do gate e não foram avaliados.

## Notas

- **TanStack Query 5.0.0** (`wt-p5f1/node_modules/@tanstack/query-core/build/modern`):
  - `refetchQueries` cancela por padrão e devolve resolvida a busca pausada (`queryClient.js:141-156`);
  - a busca com dado e `cancelRefetch` cancela a em curso; sem ele, devolve a promessa em curso (`query.js:121-128`);
  - sem rede, a busca nasce `paused` (`query.js:285`), e a `queryFn` só roda na volta (`retryer.js:115-118`; `query.js:85-88`);
  - `isFetching` é `fetchStatus === "fetching"` (`queryObserver.js:301`);
  - só as propriedades lidas notificam (`queryObserver.js:129-142,346-366`; `useBaseQuery.js:57`);
  - a base que volta a ser usada só é lida se estiver desatualizada (`queryObserver.js:418-419`);
  - as notificações saem num microtask (`notifyManager.js`).
- **React 18.2:** a aplicação usa `createRoot`; o `TestRenderer.create` dos testes e das sondas usa a raiz legada.
- **SDK Firebase 12.8:** o código novo não usa o SDK. A escuta (`hooks.ts:71-88`) não mudou.
- **Tempos.** Os tempos reais (gatilho, callable, escuta) são inferidos, não medidos no navegador. As sondas usam o relógio manual nos agendadores, e o resto em escala. A máquina estava ocupada pelo `verify:all` do autor durante as execuções.
- **Rodado sem criar arquivo:** os 36 mutantes do autor e os 9 meus, e as sondas N1, N1e, C1, T1, E9, E9b, E9c e F1, por ganchos de carga em memória (com `src/` redirecionado para `snapshot-r8` na comparação).
- **Não rodei** o E2E nem as Rules, que exigem build e Emulator. O `verify:all` final do autor terminou durante a revisão (`p5f1/logs/verify-all-final.log.meta`, só leitura): começou às 05:05:31Z e terminou às 05:45:15Z, na árvore `854463e8`, com saída 0. Teve 1.593 + 1.255 testes de Node e 206 de E2E. Não é evidência minha.
- **Impacto.** Nenhum achado novo grava, altera ou expõe dado financeiro. Os dois LOW tratam de valores transitórios da estimativa informativa: R9-01 com a ressalva na tela; R9-03 sem ela. Os INFO tratam de caminhos raros e de documentos.
