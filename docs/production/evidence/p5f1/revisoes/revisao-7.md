# P5-F.1 — Revisão independente 7 (somente leitura)

- **Data:** 2026-11-05
- **Objeto:** `snapshot-r7/` (árvore Git `167c2893`). Junto vieram `r7-sobre-r6.diff` (mudanças desde a revisão 6, árvore `80b73832`, sem os PNG), `revisao-6.md` (R6-01 … R6-06 e os resíduos R5-02, R4-03 e R1-19) e as respostas do autor (`snapshot-r7/docs/production/evidence/p5f1/revisoes/respostas-revisao-6.md`).
- **Contrato de aceite:** `p5f1/spec-original.txt`.
- **Método:** li o código, os testes, os documentos e as fontes do TanStack Query 5.0.0. Conferi cada resposta no código e no teste que ela cita, não pelo texto. Nada exigiu `npm install`, Emulator, build, rede ou Firebase, e o único arquivo criado é este parecer. O que rodei:
  1. **Unitários e ganchos, no snapshot**, com `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test`. React 18.2.0, react-test-renderer 18.2.0 e @tanstack/react-query 5.0.0 vieram de `wt-p5f1/node_modules`, só para leitura, por um gancho de resolução em memória (`--import data:…`).
     - `test:unit:reports` (73 testes, com os 25 de `report-basis-sync`) e `test:unit:work-time` (91, com os 11 de `work-time-income-estimate`): 11 de 11 execuções de cada conjunto sem falha (uma e depois dez seguidas, alternadas), com o `verify:all` do autor ainda em curso na máquina.
     - **Os testes novos contra o código da revisão 6:** os dois arquivos de gancho da árvore nova, com `src/` redirecionado para `snapshot-r6/src/` pelo mesmo gancho. Os 10 testes novos reprovam, e os 26 anteriores passam.
  2. **Mutantes em memória.** Um gancho de carga troca o trecho no módulo carregado, e um invólucro de `fs.readFileSync` (com `syncBuiltinESMExports`) troca o mesmo trecho no que a guarda lê; nada é gravado.
     - Os 143 de `mutantes.py.txt`, que tem o mesmo SHA-256 de `p5f1/mutantes.py` (`87cdc086…`). Extraí a lista com `ast`, sem executar o roteiro, e conferi que cada trecho aparece uma vez.
     - Cada arquivo mutado passou pelo esbuild 0.25.12 de `wt-p5f1` (`transformSync`, em memória): 0 não compilam (U62 e U63 miram `firestore.rules`, que a guarda lê como texto).
     - Cada mutante contra os testes que o roteiro indica: **143/143 mortos**.
     - U133 (`evaluate.current(true)` no lugar de `evaluate.current(loading || pending.current !== null)`, o comportamento da revisão 6) também serviu de comparação nas sondas B e B2.
  3. **R6-04.** O teste "leitura por id antiga…" e os dois de prévia (por `--test-name-pattern`), 12 vezes cada, com a leitura por id do dublê em 2 ms (troca em memória):
     - no renderizador em modo legado, 4 de 12 reprovam ("3 !== 2");
     - com `unstable_isConcurrent` (a raiz concorrente, que agrupa as renderizações como `createRoot`), 12 de 12 passam.
  4. **Sondas**, como testes acrescentados em memória aos módulos de teste, com React Query real e a API em memória:
     - A, A2 e A3: um mês fora da janela muda por uma leitura sem pedido e, depois, uma janela passa a incluí-lo (troca de meses ou prévia maior montada depois); A2 e A3 também em `snapshot-r6`;
     - B e B2: uma leitura com um estado intermediário da projeção chega depois do retorno da escuta (a releitura da mutação; a releitura pedida e liberada pela convergência), com o código novo, com U133 e, B2, em `snapshot-r6`;
     - C: a terceira rajada de mutação com a reconstrução marcada, com o orçamento em escala;
     - D: janela de 12 meses, com as duas bases relidas sem pedido, a série primeiro.

  Nenhum arquivo do snapshot mudou: a impressão SHA-256 de caminho, tamanho e data dos 2.447 arquivos ficou igual antes e depois (`fe904710…`). Em `snapshot-r6`, só rodei testes. No worktree `wt-p5f1`, só li `node_modules`; não rodei `git` nem nada nele. Li os registros do autor em `p5f1/logs/`, só para leitura. Quando uma conclusão depende do TanStack Query 5.0.0, do React 18.2 ou do SDK Firestore 12.8.0, isso está dito.

## Escopo revisado

- **Código e testes do `r7-sobre-r6.diff`:**
  - `src/modules/reports/{basisSync,basisRegistry,queryKeys}.ts` e o comentário de `src/modules/transactions/incomeReads.ts`;
  - `tests/unit/{report-basis-sync,work-time-income-estimate,work-time-guard}.test.ts`;
  - o E2E 15 (`e2e/work-time-p5f.spec.ts:1141-1175`), lido e não rodado.
- **Documentos do diff:** plano §20.15 (`:4764`, `:4794`, riscos `:4798-4817`), `DATA_MODEL.md:277` e `evidence/p5f1/` (LEIAME, VEREDITOS, autorização, elegibilidade, execuções, mutantes e roteiros, respostas).
- **Contexto fora do diff:**
  - `src/modules/work-time/useIncomeEstimateWith.ts`, `src/modules/work-time/WorkTimeContext.tsx:85-126` e `src/components/WorkTimeSettingsView.tsx:176-184`;
  - `src/modules/reports/{hooks,liveRefresh,basisRefresh}.ts` e `src/main.tsx:12-16`;
  - `@tanstack/query-core` 5.0.0 (`build/modern/{notifyManager,queryClient,query,queryObserver}.js`).

Linhas do plano referem-se a `docs/production/PRODUCTION_READINESS_PLAN.md` do snapshot.

## Resumo

| Situação dos achados da revisão 6 | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 5 | R6-01, R6-03, R6-04, R6-05, R6-06 |
| CORRIGIDO nos cenários do achado, com resíduo e efeito novo | 1 | R6-02 (resíduo em R7-01; efeito em R7-02) |

| Resíduos listados | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 1 | R4-03 |
| CORRIGIDO nos cenários apontados, com resíduo | 1 | R5-02 (R7-01 e R7-02) |
| ACEITO COMO RISCO DOCUMENTADO | 1 | R1-19 |

| Achados novos | Qtde | IDs |
| --- | --- | --- |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 2 | R7-01, R7-02 |
| INFO | 1 | R7-03 |

Não há achado HIGH nem MEDIUM. As correções resolvem os cenários da revisão 6, com prova de comportamento:

- a escuta encerrada do provedor volta pela escuta da prévia ou pelo "Tentar de novo" de qualquer estimativa, sem reabrir a saudável;
- a base nova sem pedido é segurada na renderização em que chega, e as exclusões são relidas depois dela;
- a escuta encerrada não compara mais com a projeção morta;
- a releitura da mutação tem orçamento próprio, dentro do limite da callable;
- o teste intermitente ficou determinístico, e a mudança do dublê não esconde defeito do produto.

Os 10 testes novos reprovam contra o código da revisão 6, e os 143 mutantes morrem.

Os achados novos são de severidade baixa e estão no caminho novo da leitura sem pedido:

- **R7-01.** A regra da base nova sem pedido só compara a janela atual e só roda quando chega leitura nova. Quando a janela passa a incluir um mês que mudou fora dela, ou quando uma prévia maior monta, a estimativa junta o total novo com a exclusão antiga, sem liberação. Na janela de 12 meses, ela libera com só uma das bases nova.
- **R7-02.** A leitura sem pedido não pede releitura nem quando começou antes do último retorno da escuta. Uma receita lançada e anulada durante a releitura pedida deixa a base com o estado intermediário, sem aviso. Na revisão 6, isso se corrigia sozinho.

O INFO trata de imprecisões dos documentos (R7-03).

O isolamento por titular e por workspace continua correto. Nada derivado é gravado, e a estimativa segue sem autoridade financeira.

## 1. Situação dos achados da revisão 6

| ID | Sev. original | Situação | Evidência (snapshot-r7) | O que falta |
| --- | --- | --- | --- | --- |
| R6-01 | LOW | CORRIGIDO | Registro das escutas encerradas pela chave `uid\|workspace` (`basisRegistry.ts:72-93`). No erro, a escuta se registra (`basisSync.ts:401-411`); o retorno do servidor a qualquer escuta da chave reabre as registradas (`:393-396`); o "Tentar de novo" só reabre as encerradas (`:448-452`); a limpeza do efeito desfaz o registro (`:412-415`). Testes `report-basis-sync.test.ts:733-771` (a escuta saudável não reabre, `:762`; as duas encerradas reabrem, `:767-770`) e `work-time-income-estimate.test.ts:426-447` (a sonda P1 da revisão 6: 1.106.000 centavos, sem a ressalva). E2E 15 lido; nos registros do autor, 15/15 (`e2e-wt-r6.log`) e o mutante `e2e-mutante-r601` morto. U135–U137 e U143 mortos (U143 só pela guarda). Os testes reprovam contra o código da revisão 6 | Os documentos dizem "o primeiro retorno"; o código reabre a cada retorno (R7-03) |
| R6-02 | LOW | CORRIGIDO nos cenários do achado; resíduo em R7-01 e efeito novo em R7-02 | (1) Par da leitura dependente com a receita da base (`released`, `paired`, `:272-277`), liberação em `followReads` (`:354-379`) e `ahead` já na renderização (`:437-447`). Testes `:633-658`, `:660-684`, `:686-706` e `:708-731`; na estimativa inteira, `:394-424` (renda sempre em 1.056.000). As sondas P2, P3 e P3b da revisão 6 viraram esses testes. (2) `evaluate(mayRequest)` (`:318-353`, `:421-430`): só a carga e a chegada com pedido em curso pedem. (3) Com a escuta encerrada, `projected` é descartado, e o pedido em curso libera quando as bases chegam (`:322-327`). U131–U134, U139, U140 e o U102 novo mortos; os 10 testes novos reprovam contra o código da revisão 6 | A regra sem pedido não acompanha a troca de janela nem espera a outra base da janela de 12 meses (R7-01). "Sem pedido não pede" deixa a base atrás da projeção quando a releitura pedida é liberada antes de chegar (R7-02) |
| R6-03 | LOW | CORRIGIDO | `mutationScheduler` por base (`basisSync.ts:136-145`; cancelado em `:160`) e usado só por `rereadWorkspaceBases` (`basisRegistry.ts:56-61`). `FINANCIAL_REPORT_BASIS_MUTATION_REFRESH`: 30 s, 2 seguidas, 1 a cada 10 min (`queryKeys.ts:45-57`). A conta confere: 5 + 30 = 35 e 2 + 6 = 8 por hora por base, e 200 + 2 × 43 = 286 < 300 (`queryKeys.ts:20-31`; `VEREDITOS.md:69`). Teste `:773-792`: 6 rajadas, 2 releituras da mutação, e a receita nova sincroniza em menos de 1 s. U138, U141 e U142 mortos (U141 e U142 só pela guarda). Sonda C: a reconstrução marcada pela 3ª rajada não se perde; espera a reposição | O prazo de até 10 min depois de 2 rajadas não está nos riscos (R7-03) |
| R6-04 | LOW | CORRIGIDO | Leitura por id do dublê em 20 ms (`work-time-income-estimate.test.ts:118-124,147,193`); a asserção (`:336`) e os prazos não mudaram. 11 de 11 execuções de cada conjunto sem falha; os 60 registros de `p5f1/logs/repeticoes-r6/` dizem "fail 0". Com 2 ms, o modo legado reprova 4 de 12, e a raiz concorrente passa 12 de 12: a raiz do React 18 (`createRoot`, `main.tsx:12`) agrupa as duas renderizações, as duas liberações rodam no mesmo ciclo de efeitos e dividem a leitura em curso. A troca é legítima. O U102 equivalente foi trocado (`atualizar-mutantes-r6.py.txt`); o novo morre por `report-basis-sync.test.ts:686-706` | — |
| R6-05 | INFO | CORRIGIDO | (1) "Tentar de novo" de qualquer estimativa da conta e do workspace: plano `:4764`, `DATA_MODEL.md:277`, `VEREDITOS.md:45,60`, `elegibilidade-receitas.md:50` e `autorizacao-isolamento.md:42-43,51`. (2) O teto: plano `:4817` e elegibilidade `:50`. (3) O comentário do `useQuery` da base (`basisSync.ts:122-126`) bate com o React Query 5.0 (`queryObserver.js:408-410,418-420`). (4) A reconstrução marcada de outra sessão está nos riscos (`:4805`), e o texto principal diz "nas mutações desta aba" (`:4764`). (5) O modelo de custo ganhou a mutação, o limite e a escuta encerrada (`VEREDITOS.md:68-70`) | Imprecisões novas em R7-03 |
| R6-06 | INFO | CORRIGIDO | `mutantes.py.txt`, `atualizar-mutantes-r5.py.txt` e `atualizar-mutantes-r6.py.txt` estão na árvore, com o mesmo SHA-256 das cópias em `p5f1/`. `mutantes.md` vai até U143, com a rodada da revisão 6; o LEIAME lista os roteiros. Minha rodada: 143/143, 0 não compilam | — |
| R5-02 | LOW | CORRIGIDO nos cenários apontados (com R6-01, R6-02 e R6-03); resíduo em R7-01 e R7-02 | Ver R6-01 a R6-03 | R7-01 e R7-02 |
| R4-03 | LOW | CORRIGIDO (com R6-02 e R6-03) | A mutação continua sem zerar as falhas e sem reler base parada no teto (`basisRegistry.ts:58`), agora fora do orçamento da escuta. O teste do teto passa (`report-basis-sync.test.ts:348-377`), e U122 morre | — |
| R1-19 | INFO | ACEITO COMO RISCO DOCUMENTADO | Sem mudança; a decisão está no plano (`:4815`), e `Header.tsx` não mudou | — |

## 2. Achados novos

### R7-01 — LOW: a regra da base nova sem pedido só olha a janela atual e só roda quando chega leitura nova; a janela que passa a incluir o mês mudado, e a janela de 12 meses com as duas bases relidas sem pedido, juntam versões

**Local:**
- `src/modules/reports/basisSync.ts`:
  - `:359-379`: `followReads` compara `pair.income` com `current.income` só nos meses da janela (`months`);
  - `:421-433`: os dois efeitos que o chamam dependem de `versionsKey`, `basis?.exact`, `basis?.income` e `reads`, nunca de `monthsKey`;
  - `:437-447`: a renderização calcula `ahead` com os `months` novos;
  - `:373-376`: o primeiro par de uma estimativa que monta é a leitura por id do cache com a base atual;
  - `:288-293` e `:378`: o pedido espera todas as bases (`arrived`), mas a liberação sem pedido sai na primeira que chega;
  - `:227-232`: o comentário diz que "um total novo nunca é juntado com exclusões antigas".
- `src/modules/work-time/useIncomeEstimateWith.ts:98-111`: com entradas diferentes, `holdEstimate` mostra o estado atual. Em `:130-133`, a janela sai de `mode` e `historyMonths`.
- `src/components/WorkTimeSettingsView.tsx:176-184` (a prévia segue o rascunho) e `src/modules/work-time/WorkTimeContext.tsx:118-126` (o provedor segue a preferência salva).
- Testes: nenhum cobre a janela trocada nem a base nova sem pedido na janela de 12 meses. A regra "nenhuma renderização livre com só uma das bases nova" só é conferida no caminho do pedido (`tests/unit/report-basis-sync.test.ts:494-520`, asserção `:518`).

**O que acontece.**
1. Uma leitura nova sem pedido muda a receita de um mês que a série traz, mas que fica fora da janela de todas as estimativas abertas. Em geral, é a releitura da mutação desta aba. `followReads` só compara a janela: não libera, a leitura por id não é relida, e `paired` continua com a receita anterior.
2. Depois, a janela passa a incluir esse mês. A pessoa troca "meses do histórico" ou o modo no rascunho (prévia) e salva (provedor), ou uma estimativa com janela maior monta e pareia a leitura por id do cache com a base atual (`:373-376`).
   - Com entradas diferentes, `holdEstimate` mostra o estado novo na hora, e ele junta o total novo do mês com a leitura por id antiga.
   - Na renderização, `ahead` fica verdadeiro, porque a regra vê o mês diferente. Nenhum efeito roda `followReads` com a janela nova: nada libera nem relê. `holding` fica preso, sem efeito visível, e o valor misto continua até a próxima leitura nova da base (de qualquer origem) ou da leitura por id.
   - A escuta da janela nova traz a projeção igual à base e converge, sem pedido em curso: também não libera (`:331-334`).
3. Na janela de 12 meses, as duas bases relidas sem pedido chegam em momentos diferentes. `followReads` libera na primeira e relê as exclusões, sem esperar a outra. Até a segunda chegar, há uma renderização livre com só uma das bases nova; a segunda é segurada e relida em seguida. O caminho do pedido proíbe isso.
4. O valor misto dos itens 1 e 2 já existia na revisão 6 (sondas A2 e A3 em `snapshot-r6`, com o mesmo valor). Novos são a regra declarada, que esses casos contradizem, e o `holding` preso sem liberação.

**Cenário concreto.**
- Fonte PF, modo habitual com 3 meses (ago–out). Quando a pessoa usava 6 meses, ela desconsiderou uma receita de R$ 500,00 de julho.
- Nesta aba, ela anula essa receita. O gatilho grava julho sem ela, e a releitura da mutação, 30 s depois, traz a base nova. A janela de 3 meses não tem julho, então nada é relido.
- Em Configurações, ela passa o rascunho para 6 meses (mai–out) e salva.
- A prévia e, depois, a estimativa em uso mostram julho já sem os R$ 500,00 e ainda descontam a receita: R$ 19.060,00 de renda elegível em vez de R$ 19.560,00. Não há aviso, e o valor fica até a próxima releitura da base ou das exclusões.

**Sondas.** React Query real, API em memória.

| Sonda | Situação | Resultado |
| --- | --- | --- |
| A | Gancho da sincronização. Julho muda fora da janela pela releitura da mutação; a janela passa a incluir julho; a escuta traz a projeção igual à base | `holding` passa a verdadeiro na renderização da troca e continua 400 ms depois do retorno; a leitura por id fica em 1. Só a releitura seguinte da base libera e relê |
| A2 | Estimativa inteira. Anulação da desconsiderada de julho nesta aba e troca de 3 para 6 meses | 1.906.000 centavos com 6 meses (certo: 1.956.000); a leitura por id fica em 1. Em `snapshot-r6`, também 1.906.000 |
| A3 | O mesmo, com uma prévia de 6 meses montada depois, ao lado do provedor de 3 meses | A prévia mostra 1.906.000; a leitura por id fica em 1. Em `snapshot-r6`, também 1.906.000 |
| D | Janela de 12 meses. A releitura da mutação traz outubro e novembro de 2025 novos: a série chega em 10 ms, e o mês avulso em 150 ms | 1 renderização livre com só a série nova (outubro em 150.000, novembro de 2025 ainda em 90.000) e as exclusões relidas depois da série. Na chegada do mês avulso, segura e relê de novo |

**Correção sugerida:**
- Na liberação sem pedido, comparar todos os meses que a base traz, e não só a janela. Uma mudança fora da janela passaria a reler a leitura por id (até 2 consultas `in`) e manteria o par certo para qualquer janela futura e para a estimativa que monta depois. Alternativa mínima: rodar `followReads` também quando a janela muda (`monthsKey` nas dependências).
- Na janela de 12 meses, liberar a base nova sem pedido só quando nenhuma base da estimativa estiver em releitura (por exemplo, `isFetching` por base na `BasisView`), como o pedido já faz com `arrived`.
- Testes: a janela que passa a incluir um mês mudado sem pedido, no gancho e na estimativa inteira; a prévia maior montada depois; a releitura da mutação com as duas bases da janela de 12 meses.
- Ajustar o comentário `:227-232` e os documentos, ou registrar o resíduo nos riscos.

### R7-02 — LOW: a leitura nova sem pedido não pede releitura nem quando começou antes do último retorno da escuta; uma receita lançada e anulada durante a releitura pedida deixa a base com o estado intermediário, sem aviso

**Local:**
- `src/modules/reports/basisSync.ts`:
  - `:421-430`: `evaluate(loading || pending.current !== null)`;
  - `:338`: `mayRequest &&`;
  - `:331-334`: a convergência libera o pedido antes de as releituras chegarem, por desenho (`:216-217`);
  - `:206-209`: a justificativa ("ela leu a projeção depois do último retorno, e a escuta traz o mesmo estado em seguida").
- `src/modules/reports/basisRegistry.ts:56-61`: a releitura da mutação, outra leitura sem pedido.
- A mesma regra nos documentos: plano `:4764`, `DATA_MODEL.md:277`, `VEREDITOS.md:45,61`, `elegibilidade-receitas.md:50` e `respostas-revisao-6.md:20` (item 2).
- Testes: nenhum cobre uma leitura que começa antes do último retorno e chega depois dele.

**O que acontece.**
1. A escuta traz uma receita nova. O pedido agenda a releitura (5 s), e a callable lê a projeção com a receita.
2. Enquanto a callable responde, a receita é anulada, ou a edição é desfeita, e o gatilho grava o mês de volta ao valor que a base já tinha. A escuta traz esse retorno, que converge com a base antiga: o pedido é liberado (`:331-334`) com a releitura ainda em curso.
3. A releitura chega com o estado intermediário. Como não há pedido em curso nem é carga, `evaluate(false)` não pede nada (`:338`), e `followReads` relê as exclusões depois dela.
4. A base fica diferente da última projeção recebida, que é a atual. Não há `syncing`, `holding` nem aviso. A escuta só volta a comparar num novo retorno do servidor (qualquer mudança de documento mensal da janela, inclusive uma despesa, ou uma reconexão), e só a virada do mês, outra leitura da base ou uma recarga corrigem antes disso.
5. Na revisão 6, a mesma chegada era comparada e pedia uma releitura, que corrigia a base (sonda B2 em `snapshot-r6`).
6. O mesmo vale para uma leitura sem pedido que começa antes do último retorno e pega um estado que a escuta não mostrou, por exemplo a releitura da mutação durante um lançamento e uma anulação muito próximos (sonda B).

A justificativa de `:206-209` vale para a leitura que começa depois do último retorno. Ela não vale para uma que começa antes e chega depois.

**Cenário concreto.**
- No celular, a pessoa lança uma receita de R$ 500,00 em outubro, no workspace-fonte, e a anula logo em seguida, porque errou o mês. Pode ser também outro membro.
- A escuta da estimativa em uso vê a receita, e a releitura pedida lê a projeção com ela.
- A anulação é projetada e chega à escuta antes de a callable responder. A janela é a duração da callable, maior numa partida a frio.
- A estimativa em uso fica com R$ 500,00 a mais na renda de outubro, sem aviso, até a próxima mudança na janela da fonte. Numa fonte pouco movimentada, isso pode levar horas.

**Sondas.** React Query real, API em memória. A callable do dublê lê a projeção no início da chamada e responde 200 ms depois.

| Sonda | Situação | r7 | Com U133 (toda leitura nova pode pedir) | `snapshot-r6` |
| --- | --- | --- | --- | --- |
| B2 | Receita lançada e anulada com a releitura pedida em curso | `syncing` falso logo depois do retorno da anulação; no fim, outubro em 150.000 na base (a projeção diz 100.000), 2 chamadas; `syncing`, `holding` e `listenFailed` falsos | 3 chamadas; 100.000 | 3 chamadas; 100.000 |
| B | A releitura da mutação lê o estado intermediário; a escuta só traz o final, igual à base | 150.000 contra 100.000; 2 chamadas | 3 chamadas; 100.000 | — |

**Correção sugerida:**
- Quando a convergência libera um pedido antes de as releituras chegarem, guardar as versões do pedido e tratar a chegada delas como pedida (`mayRequest` verdadeiro). Outra saída é cancelar a releitura em curso.
- Para as outras leituras sem pedido (a da mutação, o "Tentar de novo"), permitir um pedido quando houve retorno do servidor durante a leitura. Por exemplo: contar os retornos e guardar, por base, o número visto quando a busca começou. Ou registrar o resíduo nos riscos.
- Ajustar o comentário `:206-209` e os documentos: "ela leu a projeção depois do último retorno" só vale para a leitura que começou depois dele.
- Testes de gancho com B2 e B.

### R7-03 — INFO: imprecisões dos documentos

**Local:** `VEREDITOS.md:49,68`; plano `:4764,4805,4814`; `elegibilidade-receitas.md:50`; `respostas-revisao-6.md:19`.

1. **Contagens da verificação.** `VEREDITOS.md:49` ainda diz `test:unit:work-time` (88), `test:unit:reports` (67, com os 19 testes de gancho) e E2E da P5-F.1 (14). Agora são 91, 73 (com 25) e 15, como registra `execucoes.md:85,88` e como medi.
2. **"O primeiro retorno do servidor à escuta de outra estimativa"** (plano `:4764`, elegibilidade `:50`, respostas `:19`).
   - O código reabre as escutas encerradas a cada retorno do servidor, não só no primeiro (`basisSync.ts:394-396`). O comentário do registro diz isso certo (`basisRegistry.ts:68-70`).
   - Uma escuta que volta a falhar é reaberta a cada retorno de outra da mesma chave, cada vez com uma escuta nova. Com `includeMetadataChanges` (`hooks.ts:80`), a volta da rede também traz um retorno do servidor (semântica do SDK Firestore 12.8).
3. **Painel aberto na liberação sem pedido.** Essa liberação relê também a janela do painel, se ele estiver aberto (`refreshIncomeReads` relê os dois tipos, `incomeReads.ts:27-30`).
   - O modelo de custo cita só "uma leitura das exclusões" (`VEREDITOS.md:68`).
   - O risco do painel limita as releituras a "até cerca de 35 por hora" (plano `:4814`), o orçamento da escuta. Agora soma o da mutação (até 8 por hora por base) e, na janela de 12 meses, pode haver uma liberação por base (R7-01, item 3).
4. **A reconstrução marcada por mutação desta aba depois de 2 rajadas.** Depois de 2 releituras da mutação em menos de 10 min, a próxima espera a reposição. A reconstrução marcada pela 3ª rajada só aparece até 10 min depois; na sonda C, levou 1,26 s, com reposição de 1,5 s.
   - O plano só diz "dentro do orçamento dela" no risco das outras sessões (`:4805`).
   - O texto principal (`:4764`) e a elegibilidade (`:50`) dizem que a releitura da mutação "cobre" a reconstrução marcada nas mutações desta aba, sem esse prazo.

**Correção sugerida:**
- atualizar as contagens de `VEREDITOS.md:49`;
- trocar "o primeiro retorno" por "cada retorno do servidor";
- incluir a janela do painel, na liberação sem pedido, no modelo de custo e no risco do painel;
- registrar o prazo de até 10 min da reconstrução marcada depois de 2 rajadas.

## 3. Verificado sem achado

1. **Testes, guarda e mutantes.**
   - 164 testes (73 + 91) passam em 11 de 11 execuções de cada conjunto.
   - Contra o código da revisão 6, os 10 testes novos reprovam e os 26 anteriores passam: os testes novos medem as correções.
   - Nada foi enfraquecido. As asserções subiram de 65 para 87 em `report-basis-sync`, de 29 para 32 em `work-time-income-estimate`, de 154 para 162 na guarda e de 265 para 273 no E2E.
   - As asserções da guarda que mudaram trocaram a fiação antiga pela nova com a mesma intenção (`work-time-guard.test.ts:337-343,363-372`).
   - Não há `skip`, `only` nem `todo`, e os prazos de `until` e `settle` são os mesmos. Os 45 s do E2E 15 seguem o padrão dos testes de receita de outra sessão (`e2e/work-time-p5f.spec.ts:866`). A única mudança do dublê é a latência da leitura por id (2 → 20 ms), legítima (R6-04).
   - Mutantes: 143/143. U141, U142 e U143 morrem só pela guarda e não têm teste de comportamento.
     - Sem o cancelamento de U142, um tempo pendente da mutação relê a base de uma estimativa já desmontada: `refetchQueries` relê consulta sem observador (`queryClient.js:141-147`; `query.js:71-73`, TanStack Query 5.0.0).
     - Sem a limpeza de U143, um registro órfão reabriria uma escuta já trocada.
     - O código atual tem os dois.
2. **A regra de `ahead` na renderização e a de `followReads`.** O resultado é o mesmo nestes casos:
   - marco posto e chegado: as duas usam a receita da liberação; ela é sempre gravada com o marco, na mesma chave (`:313-314`);
   - marco de outra chave: as duas usam `paired`;
   - leitura nova sem marco: nenhuma segura, e `followReads` pareia com a base atual;
   - base nula e base sem bloco exato: nada;
   - com pedido em curso: `followReads` não compara, mas `syncing` já segura (`request` e `release` põem e tiram `waitingKey` junto com `pending`).

   Só a troca de janela diverge, porque `followReads` não roda (R7-01).
3. **`holding` sem liberação, fora de R7-01.**
   - **Leitura dependente que falha:** o marco fica, com o aviso e o "Tentar de novo". Na estimativa em uso, a ressalva manda a Configurações, e a prévia que monta relê a leitura por id invalidada: `refetchOnMount` padrão com consulta invalidada, porque o redutor de erro mantém `isInvalidated` (`query.js:77-79,306-320`; `queryObserver.js:408-414`).
   - **Base que muda durante a releitura:** segura e relê de novo (`report-basis-sync.test.ts:708-731`).
   - **Troca de conta:** os marcos têm a chave, e o cache é limpo.
   - **Estimativa desligada:** `syncKey` nulo, sem retenção. Na volta, a leitura relida no meio do caminho já mudou `dataUpdatedAt`, ou está invalidada e é relida.
   - **Marco de outro workspace:** não é mais limpo na troca (antes era), mas só segura na volta se a leitura daquele workspace não mudou desde a liberação, e ela está relida ou invalidada.
4. **`evaluate(false)`, fora de R7-02.**
   - Janela trocada com a mesma chave: a escuta é refeita, e o primeiro retorno compara com pedido (`:393-400`).
   - Virada do mês: a janela muda com a base.
   - Carga, outra chave e outro número de bases: `loading` (`:426-427`).
   - Pedido em curso: pode pedir.
   - Tentativas esgotadas: também não pediam na revisão 6.
5. **Registro das escutas encerradas.**
   - A chave é exata (`uid|workspace`): não alcança outra conta nem outro workspace.
   - A limpeza do efeito desfaz o registro na desmontagem, na troca de janela, de conta ou de fonte e ao desligar (`:412-415`).
   - `reopenFailedListeners` tira o conjunto do registro antes de chamar (`basisRegistry.ts:88-93`). Cada escuta reabre uma vez, e o desfazer posterior não tira registro novo de outra.
   - A reabertura passa pela limpeza do efeito, então há uma escuta por instância (`report-basis-sync.test.ts:750,770`).
   - Não há laço: reabrir exige retorno do servidor de outra escuta ou um clique.
   - O `StrictMode` (`main.tsx:14`) só dobra efeitos em desenvolvimento, e a limpeza desfaz o registro.
6. **Orçamento da mutação e limite da callable.**
   - São 35 + 8 releituras por base e por hora. Com o Dashboard, 286 < 300.
   - Os dois agendadores são independentes (`:773-792`).
   - A releitura que passa do orçamento é adiada, não perdida: `fire` reagenda sem fichas (`liveRefresh.ts:54-60`; sonda C).
7. **Legitimidade da troca do dublê (R6-04).** No TanStack Query 5.0.0, as notificações de uma consulta saem num só microtask (`notifyManager.js:41-53`). Com a raiz concorrente do React 18 (`createRoot`), as duas estimativas renderizam e rodam os efeitos juntas, e a segunda liberação entra na leitura em curso (`cancelRefetch: false`, `incomeReads.ts:27-30`). A medição com 2 ms confirma: 12/12 com a raiz concorrente.
8. **Evidência.**
   - `execucoes.md:85-88` bate com os registros do autor: 30 + 30 repetições com "fail 0", 143/143 e E2E 15/15.
   - O mutante do E2E da R6-01 está morto em `e2e-mutante-r601.out`.
   - Os roteiros copiados têm os mesmos SHA-256 das cópias em `p5f1/`.
9. **Isolamento e superfície.**
   - O diff não toca Rules, índices, Functions, interface nem textos.
   - `rereadWorkspaceBases` continua filtrando pelo workspace da base, e o registro só tem bases do uid em uso.
   - Nada é gravado.
10. **Plano e riscos.**
    - Os riscos novos (`:4804`, `:4806`) batem com o código.
    - O §20.15 continua "aguardando auditoria independente" (`:4824`), sem marcar o gate da P5 nem P6–P10.
    - Os marcadores `⟦…⟧` são preenchidos depois do gate e não foram avaliados.

## Notas

- **TanStack Query 5.0.0** (`wt-p5f1/node_modules/@tanstack/query-core/build/modern`):
  - as notificações de uma atualização saem juntas num microtask (`notifyManager.js:41-53`);
  - `refetchQueries` cancela a busca em curso (`cancelRefetch` padrão verdadeiro) e relê também consulta sem observador (`queryClient.js:141-147`; `query.js:71-73`);
  - a consulta invalidada é desatualizada, e o redutor de erro mantém a invalidação (`query.js:77-79,306-320`);
  - `refetchOnMount` e `shouldFetchOptionally` decidem a busca na montagem e na troca de chave (`queryObserver.js:408-420`).
- **React 18.2:** a aplicação usa `createRoot` (`main.tsx:12`), que agrupa as atualizações. O `TestRenderer.create` padrão usa a raiz legada; `unstable_isConcurrent` usa a concorrente.
- **SDK Firestore 12.8.0:** o erro de uma escuta é terminal. Com `includeMetadataChanges` (`hooks.ts:80`), a mudança de `fromCache` também traz um retorno.
- **Tempos.** Os tempos reais (gatilho, partida a frio, callable, escuta) são inferidos, não medidos no navegador. As sondas usam agrupamento e orçamento em escala.
- **Sondas e mutantes rodados sem criar arquivo:** os mutantes, as sondas A, A2, A3, B, B2, C e D e a medição de R6-04, por ganchos de carga em memória.
- **Não rodei** o E2E nem as Rules, que exigem build e Emulator. O status do `verify:all` do autor, lido só para leitura (`p5f1/logs/verify-all-final.log.status`), registra saída 0 na árvore `167c2893`, terminada às 01:49:50Z; ele não é evidência minha.
- **Impacto.** Nenhum achado novo grava, altera ou expõe dado financeiro. Os dois LOW tratam da estimativa informativa, e o INFO, dos documentos.
