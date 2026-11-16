# P5-F.1 — Revisão independente 5 (somente leitura)

- **Data:** 2026-11-04
- **Objeto:** `snapshot-r5/` (árvore Git `e2870ed6`; o código é o mesmo da árvore `53cfc239`, em que roda o `verify:all` final, e só os documentos diferem). Junto vieram `r5-sobre-r4.diff` (mudanças desde a revisão 4, sem os PNG), `revisao-4.md` (R4-01 … R4-06 e os resíduos R3-01, R3-02, R3-03, R3-05, R2-04, R1-03 e R1-19) e as respostas do autor (`snapshot-r5/docs/production/evidence/p5f1/revisoes/respostas-revisao-4.md`).
- **Contrato de aceite:** `p5f1/spec-original.txt`.
- **Método:** li o código, os testes, o backend relacionado e os documentos. Conferi cada resposta no código e no teste que ela cita, não pelo texto. Nada exigiu `npm install`, Emulator, build, rede ou Firebase. O único arquivo criado é este parecer. O que rodei:
  1. **Unitários puros, no snapshot**, com `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test`: `report-{basis-refresh,live-refresh,range,adapter,alerts-guard}`, `transactions-paging` e `work-time-{calendar,estimate,guard,preference,calculation,grammar}`, 128/128.
  2. **Testes de gancho**, com o código do snapshot. React 18.2.0, react-test-renderer 18.2.0 e @tanstack/react-query 5.0.0 vieram de `wt-p5f1/node_modules`, só para leitura, por um gancho de resolução em memória (`--import data:…`). `report-basis-sync` (14) e `work-time-income-estimate` (4) passaram 18/18 em três execuções. Os conjuntos inteiros também passaram: `test:unit:work-time` 84/84 e `test:unit:reports` 62/62 (os números do VEREDITOS).
  3. **Mutantes em memória.** Um gancho de carga troca o trecho no módulo carregado, e um invólucro de `fs.readFileSync` troca o mesmo trecho no que a guarda lê; nada é gravado.
     - (a) Os 115 mutantes de unidade de `mutantes.py.txt`. Extraí a lista com `ast`, sem executar o roteiro, e rodei cada mutante contra os testes que o roteiro indica: 115/115 reprovam por asserção, nenhum por erro de carga. Antes, cada arquivo mutado passou pelo esbuild 0.25.12 de `wt-p5f1`: 0 não compilam.
     - (b) 10 mutantes meus contra `report-basis-sync`, `work-time-income-estimate`, `work-time-guard` e `report-range` (41 testes). Resultados em R5-03.
  4. **Sondas** com `node --input-type=module -e`, React Query real e a API em memória. Elas avançam em passos de 2 a 5 ms: o `act` assíncrono do React 18.2 só aplica o trabalho do React no fim do escopo. Sondei:
     - a leitura por id envelhecida, relida na montagem da prévia (R5-01);
     - a escuta encerrada por erro (R5-02);
     - a troca de workspace com pedido em curso, com o código real e com o mutante M6 (R5-03);
     - a janela de 12 meses com só a série mudando (R5-04);
     - os momentos de pedido e de liberação, instrumentados em memória.

  Nenhum arquivo do snapshot mudou: a impressão SHA-256 de caminho, tamanho e data dos 2.441 arquivos ficou igual antes e depois. No worktree `wt-p5f1`, onde o `verify:all` roda, meus comandos só leram `node_modules`. A exceção foram um `git log -3` e um `git status --short` no início. Eles não alteram arquivos, mas o `git status` pode atualizar o cache de stat do índice. Quando uma conclusão depende do TanStack Query 5.0.0, do React 18.2 ou do SDK Firestore 12.8.0 (`@firebase/firestore` 4.10.0), isso está dito, e as fontes foram lidas em `wt-p5f1/node_modules`.

## Escopo revisado

- **Código e testes do `r5-sobre-r4.diff`:**
  - `src/modules/reports/{basisSync,basisRegistry,queryKeys,hooks}.ts`;
  - `src/modules/transactions/{incomeReads,hooks}.ts` e `src/modules/investments/simple/api.ts`;
  - `src/modules/work-time/{useIncomeEstimateWith,useIncomeEstimate,incomeBasis,messages,calendar}.ts`;
  - `src/components/workTime/{EstimateDetails,IncomeEditor}.tsx`;
  - `tests/unit/{report-basis-sync,work-time-income-estimate,work-time-estimate,work-time-guard,report-range}.test.ts`, os E2E 13 e 14 de `e2e/work-time-p5f.spec.ts` e `package.json`.
- **Documentos do diff:** plano §20.15 (`:4718-4824`), `DATA_MODEL.md:277`, `ARCHITECTURE.md` e `evidence/p5f1/` (VEREDITOS, elegibilidade, inventário, autorização, execuções, mutantes e roteiro, visual, respostas).
- **Contexto fora do diff:**
  - `src/modules/reports/liveRefresh.ts`, `src/App.tsx:116-123` e `src/main.tsx:14`;
  - `src/modules/work-time/WorkTimeContext.tsx:85-160`, `src/components/WorkTimeSettingsView.tsx:176-184` e `src/components/workTime/WorkTimeWizard.tsx:69-77`;
  - backend: `functions/src/receivables/operations.ts:780-845`, `functions/src/reports/report.ts:225-262,370-384`, `functions/src/cash/periods.ts:935-1090` e `functions/src/triggers/transactions.ts:30-45,225-245`;
  - `firestore.rules:788-795`;
  - fontes do `@tanstack/query-core` 5.0.0 e do `@firebase/firestore`.

Linhas do plano referem-se a `docs/production/PRODUCTION_READINESS_PLAN.md` do snapshot.

## Resumo

| Situação dos achados da revisão 4 | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 4 | R4-02, R4-04, R4-05 (lacuna de teste em R5-03), R4-06 |
| CORRIGIDO no cenário do achado, com resíduo ou efeito novo | 2 | R4-01 (resíduo em R5-01), R4-03 (efeito em R5-02) |

| Resíduos listados | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 5 | R3-01, R3-02, R3-05, R2-04, R1-03 |
| CORRIGIDO no cenário do achado, com resíduo | 1 | R3-03 (R5-01) |
| ACEITO COMO RISCO DOCUMENTADO | 1 | R1-19 |

| Achados novos | Qtde | IDs |
| --- | --- | --- |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 2 | R5-01, R5-02 |
| INFO | 3 | R5-03 … R5-05 |

Não há achado HIGH nem MEDIUM. As correções resolvem os cenários da revisão 4, e há prova de comportamento:

- a estimativa inteira roda com React Query real (`useIncomeEstimateWith`);
- a regra de retenção virou função pura, testada entrada por entrada;
- 14 testes de gancho cobrem a sincronização;
- os 115 mutantes compilam e reprovam por asserção (conferi em memória).

Conferi também:

- a mutação nesta aba não relê nada antes da projeção;
- a base que carrega não pede releitura;
- as duas bases da janela de 12 meses são esperadas;
- as invalidações das telas não reabrem o teto;
- a base sem dado fica fora do agendador;
- o marco não usa relógio;
- os textos de estorno batem com o backend.

Os achados novos são de severidade baixa:

- **R5-01**, resíduo de R4-01 e R3-03. A leitura por id deixou de ser relida pela mutação, mas continua sujeita às regras padrão do React Query. Com mais de 5 minutos, a montagem da prévia (ou a volta da rede) a relê antes da base. Aparece então, e fica retido até a base nova chegar, o mesmo R$ 25,68 que o mutante `e2e-mutante-r401` mostra.
- **R5-02**, efeito de R4-03. Agora só a escuta relê a base. Se ela é encerrada por erro, ou se o backend marca a projeção para reconstrução sem mudar os documentos mensais, a estimativa continua "pronta" com a leitura anterior, sem aviso, até a virada do mês ou uma montagem nova.

Os INFO tratam de testes que não exercitam o escopo `uid|workspace` nem a liberação da base sem bloco exato (R5-03), de imprecisões dos documentos e do modelo de custo (R5-04) e de um invólucro que ficou sem consumidor (R5-05).

O isolamento por titular e por workspace continua correto. Nada derivado é gravado, e a estimativa segue sem autoridade financeira.

## 1. Situação dos achados da revisão 4

| ID | Sev. original | Situação | Evidência (snapshot-r5) | O que falta |
| --- | --- | --- | --- | --- |
| R4-01 | LOW | CORRIGIDO no cenário do achado (leitura por id fresca); resíduo em R5-01 | `invalidateTransactionDependents` passa por `invalidateTransactionReads` (`src/modules/transactions/hooks.ts:25-36`). Ele relê `['transactions', ws]` sem as duas leituras de receitas (o `predicate` de `incomeReads.ts:43-52`) e só marca a janela do painel. `invalidateFinancialReports` não toca as bases (`queryKeys.ts:57-61`), e o espelho dos investimentos usa o mesmo caminho (`investments/simple/api.ts:144`). O teste "mutação nesta aba" roda o gancho inteiro (`work-time-income-estimate.test.ts:196-227`): a renda fica em 1.056.000 centavos do começo ao fim, e U99 o reprova. O E2E 13 tem observador (`e2e/work-time-p5f.spec.ts:1063-1114`). A guarda proíbe invalidar o prefixo fora do módulo (`work-time-guard.test.ts:377-381`), com U100 e U101. Sondei: depois da anulação, nenhuma leitura até a projeção mudar | A leitura por id com mais de 5 min é relida na montagem da prévia, antes da base (R5-01). Sem a escuta, nada mais a relê (R5-02) |
| R4-02 | LOW | CORRIGIDO | (a) A base é nula enquanto alguma carrega (`useIncomeEstimateWith.ts:137-147`; `basisSync.ts:254`). Os testes `report-basis-sync.test.ts:431-444` e `work-time-income-estimate.test.ts:229-247` dão uma leitura de cada (série, mês avulso, por id), e U102 e U105 reprovam. (b) As versões ficam no pedido, com critério de chegada (`basisSync.ts:223-228,233,264,271`). Nas duas ordens de chegada (`report-basis-sync.test.ts:446-471`): uma releitura de cada base e uma das exclusões, sem renderização livre mista; U103 e U104 reprovam. O modelo de custo foi refeito | O texto "só libera quando todas chegam" omite a liberação na convergência, que está correta (R5-04) |
| R4-03 | LOW | CORRIGIDO no que o achado pedia; efeito novo em R5-02 | `invalidateFinancialReports` invalida só `[FINANCIAL_REPORT_KEY]` (`queryKeys.ts:57-61`). A virada do mês tem invalidação própria (`:63-74`; `reports/hooks.ts:134-144`), uma única chamada, travada pela guarda. `refreshRegisteredBases` pula a base sem dado (`basisRegistry.ts:29-35`; `loaded()` em `basisSync.ts:121`), e a escuta reabre só as bases do uid e do workspace (`basisSync.ts:239`). Testes: `report-basis-sync.test.ts:300-328` (quatro invalidações, nenhuma chamada; projeção nova, duas releituras; a virada recupera), `:330-346` e `report-range`; U106, U107 e U108 reprovam | A releitura pelas mutações saiu por inteiro, e não só o efeito sobre o teto. Com isso, a escuta encerrada por erro e a reconstrução marcada fora dos documentos mensais ficam sem nenhuma releitura (R5-02) |
| R4-04 | LOW | CORRIGIDO | O backend grava o estorno na data do recebimento (`functions/src/receivables/operations.ts:806-808,830`). `IncomeItemView.reversed` substitui a data (`incomeBasis.ts:190-195,245`), e `reversalSituation` não tem mais nenhuma referência no código, nos testes nem nos documentos fora de `revisoes/`. A memória de cálculo, o motivo do item, o aviso do painel e "Ficam fora automaticamente" (`messages.ts:100,123,151-171`; `EstimateDetails.tsx:206`) dizem que o estorno fica na data do recebimento e anula o valor dele naquele mês, sem data apresentada como a do estorno. Com o item desconsiderado, status e aviso concordam. As fixtures usam a mesma data e um segundo recebimento no mesmo mês (`work-time-estimate.test.ts:242-283`), e o texto inteiro é conferido com `deepEqual` (`:285-330`). U75, U93 e U110 reprovam. D-P5F1-04 (`inventario.md:52`), `elegibilidade-receitas.md:17,33` e o plano foram reescritos | — |
| R4-05 | INFO | CORRIGIDO no código; o teste citado não exercita o escopo (R5-03) | O marco é por igualdade de `dataUpdatedAt` (`basisSync.ts:247,306-311`), e a guarda proíbe `Date.now(` (`work-time-guard.test.ts:365`). Pedido, espera e marco levam a chave `uid|workspace` e são descartados na troca (`basisSync.ts:207,285-289,309-311`). O teste do relógio para trás (`report-basis-sync.test.ts:412-429`) reprovaria o marco por relógio da revisão 4, e U109 reprova. Sondei a troca de workspace com pedido em curso, e a volta: nenhuma retenção presa | Com os três descartes removidos (M4, M5, M6), todos os testes passam; com M6, a sonda prende a retenção (R5-03) |
| R4-06 | INFO | CORRIGIDO | (1) U14 troca a condição por `false` e compila; o roteiro passa pelo esbuild (`mutantes.md`), e conferi 115/115 compilando e reprovando por asserção. (2) `respostas-revisao-3.md:12` ganhou a nota. (3) `respostas-revisao-2.md:25,29` ganhou as notas. (4) O comentário em `calendar.ts:358` foi corrigido. (5) `holdEstimate` e `sameEstimateInputs` são puros (`useIncomeEstimateWith.ts:76-109`), testados entrada por entrada (`work-time-income-estimate.test.ts:62-101`), e o gancho inteiro roda com React Query real; U111 a U115 reprovam | — |
| R3-01 | LOW | CORRIGIDO (com R4-04) | O ramo `outside` saiu. Com o item já desconsiderado, o status ("Desconsiderada por você") e o aviso ("Desconsiderado, o valor sai duas vezes. Volte a considerá-lo.") concordam (`messages.ts:151-171`) | — |
| R3-02 | LOW | CORRIGIDO (com R4-02) | Ver R4-02 | — |
| R3-03 | LOW | CORRIGIDO no cenário (outra sessão; mutação nesta aba com a leitura por id fresca); resíduo em R5-01 | Ver R4-01 | Ver R5-01 |
| R3-05 | LOW | CORRIGIDO (com R4-06) | Ver R4-06 | — |
| R2-04 | LOW | CORRIGIDO (com R4-03) | O teto não é mais anulado pelas invalidações. A falha continua visível: `refreshFailed` (`useIncomeEstimateWith.ts:208`) é repassado pela retenção (`:103-104`), com "Tentar de novo" | Sem releitura, não há falha a mostrar (R5-02) |
| R1-03 | MEDIUM | CORRIGIDO | E2E 14 (`e2e/work-time-p5f.spec.ts:1115-1141`): a conta é suspensa e outro dispositivo grava; aparece o aviso fixo em pt-BR, os valores voltam a reais, o log traz só o código, e "Tentar de novo" reabre a escuta (`WorkTimeContext.tsx:98-108`, sem mudança). Execução (3/3) e mutante do E2E estão registrados em `execucoes.md`; o risco saiu do plano | O E2E não foi rodado aqui |
| R1-19 | INFO | ACEITO COMO RISCO DOCUMENTADO | Sem mudança; a decisão está no plano (riscos) | — |

## 2. Achados novos

### R5-01 — LOW: a leitura por id com mais de 5 minutos é relida na montagem da prévia, antes da base

**Local:**
- `src/modules/transactions/incomeReads.ts:61-74` (`staleTime` de 5 min; `refetchOnMount` e `refetchOnReconnect` no padrão);
- `src/modules/work-time/useIncomeEstimateWith.ts:96-109,148,211-214`;
- `src/modules/reports/basisSync.ts:240,253-262`;
- quem monta uma estimativa nova: `src/components/WorkTimeSettingsView.tsx:176-184` e `src/components/workTime/WorkTimeWizard.tsx:69-77`;
- documentos: plano `:4764,4801`, `VEREDITOS.md:45,68` e `respostas-revisao-4.md:21`.

**O que acontece.** A correção de R4-01 tirou a leitura por id da invalidação das mutações. Agora ela só é relida pela sincronização e pelas regras padrão do React Query.
1. Com `staleTime` de 5 min (`incomeReads.ts:72`), a leitura vence 5 minutos depois da última sincronização. Antes, toda mutação a relia, o que a deixava sempre fresca logo depois de uma mutação. Agora a idade dela vem da última sincronização, e esse caminho abre justamente no cenário de R4-01.
2. Um observador novo da mesma chave relê a leitura vencida na montagem (`refetchOnMount`). É o caso da prévia de Configurações e do assistente a partir da etapa 4. A volta da rede faz o mesmo (`refetchOnReconnect`).
3. Se a projeção ainda não mudou, não há pedido em curso, e nada segura. O provedor e a prévia calculam a base velha com a exclusão nova.
4. Esse estado misto vira a última estimativa pronta (`holdEstimate`, `useIncomeEstimateWith.ts:108`).
5. Quando o gatilho grava a projeção, a escuta pede a releitura, e a retenção passa a segurar justamente esse valor misto, até a liberação e a nova leitura por id. Isso vale mesmo quando o estado atual já é consistente.

*Semântica do TanStack Query 5.0.0:* `onSubscribe` → `shouldFetchOnMount` → `isStaleByTime(staleTime)` (`queryObserver.ts:99-109,702-748`; `query.ts:258-264`); a volta da rede passa por `onOnline` (`query.ts:275-281`).

**Cenário concreto.** O de R4-01, cinco minutos ou mais depois do login, que é o caso comum.
- A fonte é o espaço ativo, no modo habitual de agosto a outubro, com uma receita de R$ 500,00 de outubro desconsiderada.
- A pessoa anula essa receita em Lançamentos e abre Configurações → Tempo de trabalho antes de o gatilho gravar a projeção, o que leva de 1 a 3 s, ou mais numa partida a frio.
- A prévia monta e relê a leitura por id, que já vem anulada. A exclusão passa a ser ignorada com o total velho, e a hora sobe de R$ 25,00 para R$ 25,68. Isso aparece na prévia e no provedor (no modo tempo, também no topo).
- Fica assim até a base nova chegar: o resto do tempo do gatilho, mais 5 s do agendador, a callable e a nova leitura por id. São de 6 a 8 s, como em R4-01.

É o valor que o E2E 13 garante não aparecer. O teste não o vê porque roda inteiro em menos de 4 minutos depois do login (`test.setTimeout(240_000)`).

**Sonda.** React Query real, API em memória, passos de 2 ms. A leitura por id foi envelhecida com `setState({dataUpdatedAt: agora − 6 min})`, e a retenção instrumentada em memória.
- Depois da anulação nesta aba, nenhuma leitura (correto).
- A montagem da prévia relê a leitura por id. Provedor e prévia, com `holding = false`, passam de 1.056.000 para 1.106.000 centavos de renda.
- A projeção chega e `holding` vira verdadeiro, mas a tela continua em 1.106.000 até a liberação, embora o estado atual já seja 1.056.000 (base nova, exclusão já anulada).
- Sequência mostrada: no provedor, `loading → 1.056.000 → 1.106.000 → 1.056.000`; na prévia, `1.056.000 → 1.106.000 → 1.056.000`.
- Controle, com a leitura fresca: nenhuma mudança na tela.
- Mutante meu M21 (`staleTime: 0` em `incomeReads.ts:72`): passa nos 41 testes. Nenhum teste cobre a releitura na montagem.

**Outras entradas do mesmo caminho:**
- a volta da rede;
- uma lista de exclusões nova, como o rascunho da prévia, cuja chave é lida na hora (`shouldFetchOptionally`). Com entradas diferentes, `holdEstimate` mostra o estado atual e o guarda como último, inclusive durante uma sincronização.

Quando a prévia monta já com um pedido em curso, a montagem relê base e leitura por id juntas, porque o pedido marcou as duas. Ali a retenção da prévia costuma chegar antes: o SDK entrega na hora o retorno de um alvo já sincronizado (`common-341bda9b.esm.js:16176-16207`, SDK Firestore 12.8.0), e a leitura por id precisa ir ao servidor.

**Documentação.** O risco "Escrita de outra sessão no meio de uma sincronização" (plano `:4801`) diz "por um instante". O efeito é o mesmo deste achado: o estado misto vira o último pronto, e a retenção seguinte o segura durante a sincronização inteira, ou seja, por segundos. O VEREDITOS (`:45,68`) e a resposta de R4-01 dizem que a mutação nesta aba não relê a leitura por id, sem a ressalva da montagem e da reconexão.

**Correção sugerida:**
- Deixar a leitura por id ser relida só pela sincronização e pelo "Tentar de novo": `staleTime: Infinity` e `refetchOnReconnect: false` em `useTransactionsByIdsWith` (a chave nova continua lida na hora).
- Alternativa mais geral: tratar dados novos da leitura dependente que chegam fora de uma liberação como "à frente da base", segurar e pedir a releitura das bases.
- Teste de gancho com a leitura por id envelhecida e uma segunda estimativa montada depois de uma mutação, como a sonda. Se possível, também o E2E 13 com o relógio adiantado (`page.clock`).
- Ajustar o risco e os vereditos.

### R5-02 — LOW: só a escuta relê a base; escuta encerrada por erro e reconstrução marcada fora dos meses ficam invisíveis

**Local:**
- `src/modules/reports/basisSync.ts:157-187,292-298` (o `onError` não faz nada);
- `src/modules/reports/queryKeys.ts:49-61` e `src/modules/transactions/incomeReads.ts:36-52`;
- backend:
  - `functions/src/cash/periods.ts:941-944,1066-1090`: `needsRebuild` fica no documento `projection_state` de `cash_period_events`;
  - `functions/src/triggers/transactions.ts:30-45,225-245`;
  - `functions/src/reports/report.ts:250-258,370-373`: a série passa a `rebuild_needed`;
- comparação com a revisão 4: `snapshot-r4/src/modules/reports/basisSync.ts:236` ("a base segue pela invalidação das mutações") e `snapshot-r4/src/modules/reports/queryKeys.ts:57-66`;
- documentos: plano `:4764` e riscos (`:4796-4812`), `DATA_MODEL.md:277` e `VEREDITOS.md:45,67-68`.

**O que acontece.** Na revisão 4, a escuta era a via principal e a invalidação das mutações, a reserva; o comentário do `onError` dizia isso. A correção de R4-03 tirou a reserva inteira. Agora só a escuta, a virada do mês, o "Tentar de novo" e uma montagem nova relêem a base. Dois casos ficam sem nenhuma releitura e sem aviso:

1. **Reconstrução marcada.** O gatilho às vezes desiste de aplicar um lançamento: falha permanente, contrato violado, exclusão ambígua ou falha passageira perto do fim da janela de 24 h.
   - Ele só liga `needsRebuild` no `projection_state`; os documentos mensais não mudam.
   - O relatório passa a responder `rebuild_needed` na série, mas a escuta não vê nada.
   - A estimativa continua "pronta" com os totais anteriores, enquanto o Dashboard, relido pela mutação, mostra o relatório em reconstrução.
   - Pela regra da P5-F.1, relatório indisponível deixa a estimativa indisponível e os valores em reais. A regra só volta a valer na virada do mês, numa montagem nova ou quando a reconstrução reescrever os meses.
2. **Escuta encerrada por erro**, por exemplo com o acesso ao workspace-fonte perdido no meio da sessão.
   - O SDK não reabre a escuta: "No further callbacks will occur" (`@firebase/firestore/dist/index.d.ts:1764-1765`), e o `onError` não avisa nada.
   - Nenhuma mutação, desta aba ou de outra origem, relê mais a base. A estimativa fica congelada, sem `refreshFailed`, até a virada do mês ou uma montagem nova.
   - O "Tentar de novo" só aparece com uma falha e, de todo modo, não reabre a escuta: as dependências do efeito não têm contador de nova tentativa.
   - Na revisão 4, a primeira mutação relia a base, e a falha aparecia.

**Sonda.** React Query real; a escuta chama `onError` logo depois de aberta. Primeiro entra uma receita nova; depois, o relatório passa a responder `rebuild_needed`. Cada passo leva `invalidateTransactionReads` e `invalidateFinancialReports`. Resultado: 1 callable e 1 leitura por id no total (só as da carga), estado `done/ready` com a renda inicial e `refreshFailed: false`.

**Documentação.** Nada disso está registrado. O plano diz que a escuta "cobre receita retroativa, edição, anulação … nesta aba ou em outra sessão", e os riscos não citam a escuta parada nem a reconstrução marcada fora dos meses.

**Correção sugerida:**
- **Para a reconstrução:** reler só a base, não a leitura por id, do workspace da mutação, pelo agendador e sem zerar as falhas. Há três desfechos possíveis:
  - o gatilho já gravou: a escuta pede antes e a retenção ordena;
  - o gatilho ainda não gravou: a base volta igual;
  - o gatilho desistiu: a base volta `rebuild_needed`, e a estimativa fica indisponível.

  O custo é uma callable por rajada de mutações, no orçamento da base.
- **Para a escuta com erro:** mostrar a falha, com um "Tentar de novo" que reabra a escuta.
- Ou registrar os dois casos como risco.
- Testes de gancho com `onError` e com a base passando a `rebuild_needed` sem mudança dos documentos.

### R5-03 — INFO: o escopo `uid|workspace` e a liberação da base sem bloco exato não têm teste que os exercite

**Local:**
- `src/modules/reports/basisSync.ts:271,279,285-289`;
- `tests/unit/report-basis-sync.test.ts:282-298,395-410`;
- `VEREDITOS.md:45,83` e `respostas-revisao-4.md:25`.

**Mutantes meus**, contra `report-basis-sync`, `work-time-income-estimate`, `work-time-guard` e `report-range` (41 testes):

| ID | Mutação | Resultado |
| --- | --- | --- |
| M4 | sem o descarte do pedido na troca (`basisSync.ts:287`) | sobrevive |
| M5 | sem o descarte do marco na troca (`:288`) | sobrevive (mascarado pela conferência da chave na renderização, `:310`) |
| M6 | sem o descarte da espera na troca (`:289`) | sobrevive |
| M7 | sem a liberação na convergência (`:260`) | morto (9 testes reprovam) |
| M8 | sem a liberação da base sem bloco exato (`:279`) | sobrevive |
| M13 | prefixo ignorado no registro (`basisRegistry.ts:31`) | morto, só pela guarda |
| M18 | sem `markIncomeReadsStale` no pedido (`:240`) | sobrevive (equivalente nos testes: a liberação relê as leituras ativas de todo modo) |
| M19 | o pedido sem zerar o marco (`:234`) | sobrevive (equivalente: `syncing` cobre) |
| M20 | liberar sem conferir a chegada no fim do caminho exato (`:271`) | sobrevive |
| M21 | `staleTime: 0` na leitura por id (`incomeReads.ts:72`) | sobrevive (ver R5-01) |

**Consequências:**
- **M6.** A sonda tinha um pedido em curso em ws-a, trocou para ws-b e voltou. Com o mutante, `syncing` fica verdadeiro para sempre em ws-a (`final: {syncing: true, holding: true}`); com o código real, os dois ficam falsos. A estimativa ficaria congelada na última pronta até outra divergência.
- **M8.** Depois de uma releitura sem bloco exato, o pedido nunca seria liberado, e a estimativa seguraria a última pronta, da base exata anterior, em vez de mostrar "indisponível".
- **M20.** Quando a projeção vai para um estado cujas tentativas já se esgotaram, com um pedido em curso, a liberação viria antes da base, e a leitura por id antes dela. O caminho é raro.

**Por que sobrevivem.** O teste "troca de workspace: a retenção … não passa para outro workspace" (`:395-410`) só troca de workspace depois de a sincronização terminar, quando a leitura nova já limpou o marco. Ele pega o marco por relógio da revisão 4, não o escopo novo. O teste "base sem bloco exato" (`:282-298`) não confere `syncing` nem `holding`.

**Correção sugerida:**
- Testes de gancho que troquem de workspace com o pedido em curso e durante a espera da leitura dependente, e voltem.
- Conferir `syncing` e `holding` depois da releitura sem bloco exato.
- Ajustar a evidência, que cita o teste atual como prova do escopo (`VEREDITOS.md:45,83`).

### R5-04 — INFO: imprecisões dos documentos e dos comentários

**Local:**
- `respostas-revisao-4.md:22`, plano `:4764,4809`, `DATA_MODEL.md:277`, `elegibilidade-receitas.md:50` e `VEREDITOS.md:45,67-69`;
- `src/modules/reports/basisSync.ts:177-182`;
- `tests/firestore/work-time-p5f.rules.integration.test.mjs:432-434`.

1. **Liberação.** Os documentos e o comentário dizem que a sincronização "só libera quando todas [as bases] trazem uma leitura nova e alcançam a projeção". O código libera em mais dois casos:
   - na convergência, antes de todas chegarem (`basisSync.ts:258-261`);
   - sem mais tentativas, com o que chegou, mesmo sem alcançar a projeção (`:271`).

   Sondei a janela de 12 meses com só outubro mudando, a série em 10 ms e o mês avulso em 250 ms: a liberação e a leitura por id saíram aos 145 ms, e o mês avulso chegou aos 384 ms. A liberação é correta, porque a receita igual à da projeção torna a base equivalente para a estimativa, que só usa totais mensais e o status. Só o texto não a descreve.
2. **Custo.** Três pontos não estão no modelo:
   - A releitura pedida pela escuta vai para todas as bases carregadas do uid e do workspace (`basisSync.ts:239`; `basisRegistry.ts:29-35`), não só para as "da estimativa" (`VEREDITOS.md:67`; `elegibilidade-receitas.md:50`). Com o provedor em 3 meses e a prévia em 12, uma mudança vista pelo provedor relê também o mês avulso da prévia.
   - A leitura por id também é relida na montagem de uma estimativa nova e na volta da rede, depois de 5 min (R5-01). "Mutação nesta aba …: nenhuma leitura por id" e "reconexão da escuta" (`VEREDITOS.md:68-69`) não dizem isso.
   - Com o painel aberto, cada liberação relê a janela do painel inteira (até 2.505 documentos; `incomeReads.ts:31-34`), no limite do orçamento das bases (até cerca de 35 por hora por base). "A janela do painel, se aberto" não dá a ordem de grandeza, e o risco "Custo do painel" (plano `:4809`) só fala de abrir e de marcar. O comportamento é anterior a esta rodada.
3. **Comentário desatualizado.** `work-time-p5f.rules.integration.test.mjs:432-434` cita a escuta de `useFinancialReportBasisLiveRefresh` em `reports/hooks.ts`, que saiu nesta rodada. A escuta real é `firebaseBasisDeps.subscribePeriods` (`reports/hooks.ts:71-88`).

**Correção sugerida:** descrever as três condições de liberação, completar o modelo de custo e atualizar o comentário.

### R5-05 — INFO: `useTransactionsByIds` ficou sem consumidor

**Local:**
- `src/modules/transactions/hooks.ts:64-74`;
- `tests/unit/work-time-guard.test.ts:373`.

**O que acontece.** A estimativa usa `useTransactionsByIdsWith` com a leitura injetada (`useIncomeEstimateWith.ts:148`, ligada em `useIncomeEstimate.ts:20-23`). O invólucro com o Firestore real em `transactions/hooks.ts` não tem nenhum consumidor em `src/`; só a guarda o mantém, conferindo o corpo dele. Não há, portanto, outros consumidores da leitura por id a afetar com a mudança da invalidação. O CLAUDE.md pede remover adaptadores sem uso no mesmo milestone, e o comentário do invólucro (`:64-69`) fala dele como se estivesse em uso.

**Correção sugerida:** remover o invólucro e a asserção. A fiação real já é conferida em `work-time-guard.test.ts:356`.

## 3. Verificado sem achado

1. **Ganchos, unitários e mutantes.**
   - `report-basis-sync` e `work-time-income-estimate`: 18/18 em três execuções.
   - `test:unit:work-time` 84/84, `test:unit:reports` 62/62 e os unitários puros 128/128.
   - Os 115 mutantes do autor compilam (esbuild) e reprovam por asserção, inclusive os da guarda (com o invólucro de leitura).
   - Dos meus, reprovam M7 e M13; os demais estão em R5-03.
2. **Retenção que fica presa.** Percorri cada caso:
   - base que falha: fica em `syncing`, com aviso e "Tentar de novo". Recupera pela projeção nova, pela virada, pela reconexão (a consulta fica invalidada), por uma montagem nova ou pela nova tentativa;
   - leitura dependente que falha: fica retida, com o aviso de `excluded.isError` e "Tentar de novo";
   - leitura pausada sem rede: retém até a volta, sem prender;
   - leitura desligada: `reads` é nulo, sem marco;
   - orçamento esgotado: espera a reposição, até 120 s;
   - chave das exclusões trocada: o valor diferente limpa o marco (`basisSync.ts:306-308`).

   Não há retenção presa em silêncio. A única exceção é o mutante M6.
3. **Janela ou mês trocados com pedido em curso.**
   - As versões são comparadas por índice. Uma base a mais no pedido (`undefined`) conta como chegada, e a série ainda precisa chegar; uma a menos é ignorada.
   - Na virada do mês, a chave nova do mês avulso começa vazia (base nula) e chega depois.
   - Na troca de workspace, o pedido é descartado e as consultas invalidadas são relidas na montagem (sondado).
4. **Duas instâncias.** Cada uma tem o próprio pedido e o próprio marco. Com as liberações no mesmo ciclo, há uma leitura por id para as duas (`cancelRefetch: false`; instrumentado). Sobre a prévia montada durante uma sincronização, ver R5-01.
5. **Convergência antes da chegada.** É segura: receita igual significa base equivalente. A releitura já agendada chega depois, igual, e não faz nada.
6. **Premissa "mudança relevante da exclusão muda a receita projetada da janela".** Ela se sustenta.
   - `classifyIncomeDocument` espelha a contribuição de cada lançamento para o `incomeCents` (`incomeBasis.ts:61-87`), com paridade provada por fixture.
   - Toda mudança que altera o efeito de uma exclusão muda a receita projetada de algum mês da janela: valor, anulação, pendente ↔ efetivada, tipo e data entre meses da janela, para dentro dela ou para fora.
   - Uma exclusão fora da janela só conta como ignorada, e continua ignorada.
   - Exceções: duas mudanças no mesmo mês que se anulam antes de a escuta ver o estado intermediário (o total fica certo; só a parcela da exclusão fica velha até a próxima leitura por id), e a reconstrução marcada (R5-02).
7. **Teto de falhas e base sem dado.**
   - As invalidações das telas não tocam as bases (teste e guarda).
   - A escuta zera as falhas só do uid e do workspace dela. O prefixo termina em vírgula, então `ws-a` não casa com `ws-ab`.
   - A virada do mês zera todas.
   - A base sem dado fica fora do agendador. Ela se recupera pelo "Tentar de novo" (o erro aparece), pela reconexão (consulta sem dado conta como velha) ou por uma montagem nova.
8. **Textos de estorno.**
   - Estão em pt-BR claro e batem com o backend.
   - Nenhum apresenta data como a do estorno.
   - No item desconsiderado, o status e o aviso são coerentes.
   - "Neste mês" se refere ao título do mês da seção do painel (`IncomeEditor.tsx:152-168`); o item depois do período fica na seção "Depois do período" (`:170-175`).
9. **Teste que troca `Date.now`.** É seguro:
   - a troca fica dentro de `try/finally`;
   - o `until` mede com `performance.now()`;
   - o runner roda cada arquivo num processo próprio;
   - cada teste cria o próprio `QueryClient`, e o `afterEach` desmonta e limpa o registro.
10. **Nada enfraquecido.**
    - Os 8 testes de gancho da revisão 4 continuam; o do teto mudou para o comportamento novo, pedido em R4-03.
    - O painel passou a ser conferido com `deepEqual` do texto inteiro.
    - As asserções que saíram da guarda miravam código removido e têm equivalentes.
    - No E2E, só entraram os testes 13 e 14, sem `skip`, `only` ou `fixme`, com timeouts no padrão do arquivo (20 a 30 s).
11. **StrictMode.** Só vale no desenvolvimento (`src/main.tsx:14`), e o build do E2E não repete efeitos. No desenvolvimento, a escuta é reaberta e a entrada do registro é recriada com um agendador novo; os `useRef` persistem, e `holdEstimate` é idempotente na renderização dupla.
12. **Isolamento.**
    - As releituras usam o prefixo de uid e workspace, e `refreshIncomeReads` e `markIncomeReadsStale` valem só para o workspace da estimativa.
    - A troca de conta descarta pedido, espera e marco, e o logout limpa os caches.
    - A escuta das projeções exige membro com leitura e `limit` até 600 (`firestore.rules:788-795`).
13. **Investimentos.** O espelho dos investimentos usa `invalidateTransactionReads` no lugar do prefixo inteiro (`api.ts:144`), travado pela guarda (U101).
14. **Plano e modelos.**
    - O §20.15 não marca o gate da P5 nem P6–P10, e o estado é "aguardando auditoria independente".
    - Os marcadores `⟦…⟧` são preenchidos depois do gate e não foram avaliados.
    - A evidência visual refeita (`comparacao-r5-r6.txt`) bate com a mudança de texto: as 6 capturas da memória de cálculo mudaram.

## Notas

- **TanStack Query 5.0.0** (`wt-p5f1/node_modules/@tanstack/query-core/src`):
  - um observador novo busca na montagem quando a consulta está velha por tempo ou invalidada (`queryObserver.ts:99-109,702-748`; `query.ts:258-264`);
  - a volta da rede relê pelo primeiro observador que aceita (`query.ts:275-281`);
  - a busca em curso continua quando o último observador sai, se a função não usa o `signal` (`query.ts:295-315`);
  - `invalidateQueries` com `predicate` combina prefixo e predicado, e relê as ativas salvo `refetchType: 'none'` (`queryClient.ts:248-266`).
- **React 18.2:** o `act` assíncrono só aplica o trabalho do React no fim do escopo. Uma primeira sonda de R5-04, com um único `act` de 500 ms, mostrou uma ordem falsa (a liberação depois do mês avulso). Refeita em passos de 2 ms, mostrou a liberação na convergência.
- **SDK Firestore 12.8.0:**
  - o erro de uma escuta é terminal (`index.d.ts:1764-1765`);
  - um listener novo de um alvo já ativo recebe a vista atual sem ida ao servidor (`common-341bda9b.esm.js:16176-16207`).
- **Tempos.** Os tempos reais (gatilho, callable, partida a frio) são inferidos, não medidos no navegador.
- **Sondas rodadas sem criar arquivo:**
  - leitura por id envelhecida, com e sem prévia, com a retenção instrumentada (R5-01);
  - escuta encerrada por erro e relatório em reconstrução (R5-02);
  - troca de workspace com pedido em curso, com o código real e com M6 (R5-03);
  - janela de 12 meses com só a série mudando (R5-04);
  - momentos de pedido e de liberação com duas instâncias.
- **Impacto.** Nenhum achado novo grava, altera ou expõe dado financeiro. Todos tratam da estimativa informativa, de custo, de testes ou de documentos.
