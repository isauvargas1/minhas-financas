# P5-F.1 — Revisão independente 4 (somente leitura)

- **Data:** 2026-11-04
- **Objeto:** `snapshot-r4/` (árvore Git `fb802e26`), com `r4-sobre-r3.diff` (mudanças desde a revisão 3; os PNG foram ignorados), `revisao-3.md` (R3-01 … R3-06 e os itens parciais R2-04, R2-05, R2-09, R1-03 e R1-19) e as respostas do autor (`snapshot-r4/docs/production/evidence/p5f1/revisoes/respostas-revisao-3.md`).
- **Contrato de aceite:** `p5f1/spec-original.txt`.
- **Método:** leitura estática do código, dos testes, do backend relacionado e dos documentos. Conferi cada resposta no código e no teste que ela cita, e não pelo texto. Nada exigiu `npm install`, Emulator, build, rede ou Firebase, e o único arquivo criado é este parecer. O que rodei:
  1. **Unitários puros, no próprio snapshot**, com `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test`: `report-basis-refresh`, `report-live-refresh`, `transactions-paging` e `work-time-{calendar,estimate,guard,preference,calculation,grammar}`, 90/90. Os 7 arquivos de `test:unit:work-time`, sozinhos: 80/80.
  2. **Testes de gancho.** O snapshot não tem `node_modules`. Rodei `report-basis-sync.test.ts` e o conjunto de `test:unit:reports` com o código do snapshot. Os pacotes (React 18.2.0, react-test-renderer 18.2.0, @tanstack/react-query 5.0.0) vieram de `wt-p5f1/node_modules`, só para leitura, por um gancho de resolução em memória (`--import data:…`). Resultado: 8/8 em três execuções, e 56/56.
  3. **Mutantes em memória**, com um gancho de carga que troca o trecho só na memória, sem gravar. (a) Contra `report-basis-sync`: 11 mutantes do autor (U54, U70–U72, U85–U89, U96, U98) e 3 meus. (b) Contra `work-time-estimate` e `work-time-calendar`: 8 do autor (U14, U75, U79–U81, U92–U94) e 2 meus. (c) Para cada um dos 98 mutantes de unidade de `mutantes.py.txt`: conferi que o arquivo mutado compila, com os tipos removidos (`module.stripTypeScriptTypes`) e o módulo analisado por `vm.SourceTextModule`.
  4. **Sondas** com `node --input-type=module -e`, com React Query real e uma API em memória: mutação nesta aba; janela de 12 meses, na montagem e na divergência; troca de workspace com `readsAfter`; invalidações repetidas com a base falhando. Sondas puras: classificação de feriados com `dayPlan`/`monthPlan` e `incomeItemPresentation`.

  Nenhum arquivo do snapshot mudou: conferi a data e o tamanho de todos os arquivos antes e depois. O worktree `wt-p5f1` mudou durante a revisão (`functions/lib/`, `firebase-debug.log`, `firestore-debug.log`) por causa de um `npm run verify:all` de outra sessão, que começou no meio dela. Meus comandos só leram `wt-p5f1/node_modules`. Quando uma conclusão depende do TanStack Query 5.0.0, do React 18.2 ou do SDK Firestore 12.8.0, isso está dito; as fontes dessas bibliotecas foram lidas em `wt-p5f1/node_modules`.

## Escopo revisado

- **Código e testes do `r4-sobre-r3.diff`:**
  - `src/modules/reports/{basisSync,basisRegistry,basisRefresh,hooks,queryKeys}.ts`;
  - `src/modules/transactions/{incomeReads,paging,api,hooks}.ts`;
  - `src/modules/work-time/{useIncomeEstimate,calendar,incomeBasis,messages}.ts`;
  - `src/components/Header.tsx` e `src/components/workTime/{EstimateDetails,IncomeEditor}.tsx`;
  - `tests/unit/{report-basis-sync,transactions-paging,report-basis-refresh,work-time-calendar,work-time-estimate,work-time-guard}.test.ts`, `tests/firestore/work-time-p5f.rules.integration.test.mjs`, os testes 8, 10, 11 e 12 de `e2e/work-time-p5f.spec.ts` e `package.json`.
- **Documentos do diff:** plano (§20.15), `DATA_MODEL` e `evidence/p5f1/` (LEIAME, VEREDITOS, autorização, calendário, elegibilidade, execuções, inventário, mutantes e o roteiro deles, respostas).
- **Contexto fora do diff:**
  - `src/App.tsx:116-123,274-277`; `src/modules/reports/{hooks.ts:144-190,liveRefresh.ts}`; `src/modules/transactions/hooks.ts:23-35,119-195`; `src/components/WorkTimeSettingsView.tsx:100-185`; `src/modules/work-time/WorkTimeContext.tsx:85-160`;
  - `functions/src/receivables/{operations.ts:780-850,model.ts:442-470,cashEffect.ts:10-20}` e `functions/src/receivables/__tests__/receivableLifecycle.integration.test.ts:337-363`;
  - `functions/src/reports/{callables.ts:27-70,report.ts:250-262,370-409}` e `functions/src/cash/rebuild.ts:1512-1550`;
  - `ARCHITECTURE.md:191` e `SECURITY_MODEL.md:126`;
  - fontes de `@tanstack/query-core` e de `@firebase/firestore` em `wt-p5f1/node_modules`.

Linhas do plano referem-se a `docs/production/PRODUCTION_READINESS_PLAN.md` do snapshot.

## Resumo

| Situação dos achados da revisão 3 | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 2 | R3-04, R3-06 |
| CORRIGIDO no cenário do achado, com efeito novo ou resíduo | 4 | R3-01 (premissa em R4-04), R3-02 (efeito novo em R4-02), R3-03 (resíduo em R4-01), R3-05 (resíduo em R4-06) |

| Itens parciais listados (e R2-06, que a resposta também trata) | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 3 | R2-05, R2-06, R2-09 |
| CORRIGIDO, com efeito novo | 1 | R2-04 (R4-03) |
| PARCIALMENTE CORRIGIDO + ACEITO COMO RISCO DOCUMENTADO | 1 | R1-03 |
| ACEITO COMO RISCO DOCUMENTADO | 1 | R1-19 |

| Achados novos | Qtde | IDs |
| --- | --- | --- |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 4 | R4-01 … R4-04 |
| INFO | 2 | R4-05, R4-06 |

Não há achado HIGH nem MEDIUM. As correções resolvem os cenários da revisão 3, e agora há prova de comportamento. Os 8 testes de gancho rodam com React Query real e reprovam os mutantes da fiação (conferi em memória, e três mutantes meus também reprovam). Conferi também:

- a escuta ignora o retorno só do cache;
- a contagem zera quando a base alcança a projeção;
- a base sem bloco exato relê sem laço;
- no caminho da divergência, as exclusões são relidas só depois da base;
- a releitura que falha aparece na tela, com "Tentar de novo";
- o feriado é classificado pelos minutos finais em todos os casos que sondei.

Os achados novos são de severidade baixa:

- **R4-01**, resíduo de R3-03: uma mutação feita nesta aba ainda relê as exclusões antes da base. Por alguns segundos, a estimativa mostra, e depois segura, um total velho combinado com o item novo.
- **R4-02:** na janela de 12 meses, o 12º mês ainda carregando é tratado como "base sem bloco exato". Cada carga do app nesse modo, e parte das mudanças, gasta duas callables a mais.
- **R4-03:** `refreshRegisteredBases()` roda em toda invalidação e anula o teto de falhas.
- **R4-04:** o backend grava o estorno de recebimento no mesmo dia do recebimento. O caso "estorno depois do período" não acontece, e os textos e documentos sobre o mês do estorno enganam.

Os INFO tratam do marco `readsAfter`, que não é monotônico nem amarrado ao workspace (R4-05), e de imprecisões da evidência, entre elas um mutante que não compila e foi contado como morto (R4-06).

O isolamento por titular e por workspace continua correto, nada derivado é gravado e a estimativa segue sem autoridade financeira.

## 1. Situação dos achados da revisão 3

| ID | Sev. original | Situação | Evidência (snapshot-r4) | O que falta |
| --- | --- | --- | --- | --- |
| R3-01 | LOW | CORRIGIDO nos casos que o backend produz; a premissa do caso restante está em R4-04 | `reversalSituation` (`src/modules/work-time/incomeBasis.ts:208-215`) devolve `offset` quando os dois estão na janela ou os dois depois dela. `incomeItemPresentation` (`messages.ts:151-174`) tira a caixa (salvo se o item já estiver desconsiderado), mostra o aviso para reconsiderar e diz "Depois do período desta estimativa: ainda não entra na conta." `ItemRow` só aplica a função (`IncomeEditor.tsx:66,76-94`). Há teste dos casos (`tests/unit/work-time-estimate.test.ts:283-321`); U75, U93 e U94 reprovam em memória. D-P5F1-04 foi reescrita (`inventario.md:52`; plano `:4743`). | O caso "recebimento na janela, estorno depois" não acontece com o backend atual, e os textos sobre o mês do estorno enganam (R4-04). No ramo `outside`, com o item já desconsiderado, o aviso diz que o recebimento "soma no período" logo abaixo de "Desconsiderada por você: não entra nesta estimativa." (`messages.ts:163` × `:156-158`; sondado). |
| R3-02 | LOW | (a) CORRIGIDO; (b) CORRIGIDO, com efeito novo em R4-02 | (a) `if (decision.converged) attempts.current.clear()` (`basisSync.ts:210`). O teste "estado que volta" faz cinco mudanças e espera cinco releituras (`report-basis-sync.test.ts:213-226`); U86 reprova. (b) Com `basisExact` falso, a escuta não compara e chama `request` no primeiro retorno do servidor e quando `changes > 0` (`basisSync.ts:231-233`). `changes` é `docChanges().length` (`hooks.ts:88`), que sem opção já exclui mudanças só de metadados (SDK, `index.esm.js:1290-1312`). A base nova não relê de novo, porque o efeito dela só compara (`basisSync.ts:240-247`). Teste "base sem bloco exato" (`:228-244`); U87 e U88 reprovam. A evidência deixou de dizer que "uma projeção nova recomeça a conta" (`elegibilidade-receitas.md:50`). | `basisExact` também é falso enquanto o 12º mês da janela de 12 meses carrega (R4-02). |
| R3-03 | LOW | CORRIGIDO no cenário do achado (mudança feita em outra sessão); resíduo em R4-01 (mutação feita nesta aba) | Na divergência, `request` só marca as leituras de receitas como desatualizadas (`markIncomeReadsStale`, `refetchType: 'none'`: `incomeReads.ts:17-20`; `basisSync.ts:202`). O efeito da base nova as relê (`refreshIncomeReads`, com `cancelRefetch: false`: `incomeReads.ts:28-31`; `basisSync.ts:240-245`). `syncing` cobre o intervalo do pedido até a base nova, e `readsAfter` cobre a espera das exclusões (`useIncomeEstimate.ts:105-110`). Testes de gancho 1 e 8 (`report-basis-sync.test.ts:181-197,296-315`). Em memória, reprovam U71, U72, U96 e U98, e também meus mutantes "relê as exclusões já no pedido" e "`syncing` sempre falso". O E2E 8 ganhou um observador (`e2e/work-time-p5f.spec.ts:900-931`) e tem mutante registrado (`execucoes.md`, "Mutante do E2E da revisão 3"). `DATA_MODEL.md:277` foi corrigido. Nesse caminho, a releitura da janela do painel segue o orçamento do agendador. | `invalidateTransactionDependents` ainda relê na hora tudo o que está sob `['transactions', ws]`, o que inclui as duas leituras (R4-01). A retenção em si (`lastDone`, `inputs`) só tem a guarda de texto e o E2E 8 (R4-06). |
| R3-04 | LOW | CORRIGIDO | `planDay` classifica pelos minutos finais, depois de exceções, acréscimos e teto (`calendar.ts:313-322`), e a marca `holiday_worked` só conta quando o dia teve trabalho (`:324`). Sondas, com rotina de segunda a sexta (resultados abaixo da tabela). Os minutos são os mesmos de antes. Testes em `work-time-calendar.test.ts:304-339`; U79, U80 e U81 reprovam. Uma variante de U14 que compila (`if (false) …`) reprova 2 testes. | U14, como está registrado, não compila (R4-06). O comentário de `holidaysWorked` (`calendar.ts:358`) ficou desatualizado (R4-06). |
| R3-05 | LOW | CORRIGIDO no essencial; resíduo INFO em R4-06 | (1) `basisSync.ts` recebe a callable e a escuta injetadas e tem 8 testes de gancho (rodados: 8/8); o risco "ganchos sem teste" saiu do plano (`:4796-4808`). (2) Para R2-06: E2E 10 (`e2e:966-997`) e o mutante `e2e-mutante-r206` (`execucoes.md`). (3) A resposta nova admite o erro sobre R2-05 (`respostas-revisao-3.md:10`), e o comportamento foi corrigido. | `respostas-revisao-3.md:12` fala em "7 testes de gancho"; são 8. `respostas-revisao-2.md` foi editado nesta rodada (R1-21, R2-06, R2-12), mas as linhas de R2-05 (`:25`) e R2-09 (`:29`) mantêm, sem nota, as afirmações que a revisão 3 mostrou falsas. |
| R3-06 | INFO | CORRIGIDO | (1) O comentário voltou para cima de `STANDING_LIMITATIONS` (`messages.ts:95`). (2) "2.505" no plano (`:4804`) e em `respostas-revisao-2.md:14`. (3) `readPagedWindow` (`transactions/paging.ts:12-27`) equivale ao laço anterior: o mesmo cursor, a mesma sonda, e o filtro de anulados aplicado depois, com o mesmo resultado. Testes com 0, 500, 501, 2.000 e 2.001 documentos (`transactions-paging.test.ts`, 5/5); a guarda trava a fiação real (`work-time-guard.test.ts:375-384`); U73 e U74 reprovam. | — |
| R2-04 | LOW | CORRIGIDO, com efeito novo em R4-03 | (1) Com dados em cache e a releitura falhando, `refreshFailed` (`useIncomeEstimate.ts:156`) liga o aviso fixo com "Tentar de novo" (`EstimateDetails.tsx:78-83`; `messages.ts:73`) e a ressalva do topo (`Header.tsx:49-51`; `messages.ts:83-93`). Durante a retenção, o sinalizador vem do estado atual (`useIncomeEstimate.ts:159`). (2) `invalidateFinancialReports` chama `refreshRegisteredBases()` (`queryKeys.ts:64`), que zera as falhas e notifica o agendador de cada base (`basisRegistry.ts:26-32`), mesmo com a base já invalidada. Teste de gancho "teto de falhas" (`report-basis-sync.test.ts:246-268`); U54, U70 e U89 reprovam em memória; E2E 12 (`e2e:1031-1061`). | A reabertura vale para toda invalidação, inclusive as que vêm do listener do mês do App, e na prática o teto deixa de existir (R4-03). |
| R2-05 | LOW | CORRIGIDO | `includeMetadataChanges: true` e `fromCache` repassado (`hooks.ts:84,87`); o retorno só do cache é ignorado (`basisSync.ts:227`). Com a opção, o SDK entrega o retorno confirmado mesmo sem documento mudado (`common-341bda9b.esm.js:16314-16336`), então a comparação sempre acontece. Teste "retorno só do cache" (`report-basis-sync.test.ts:199-211`); U85 reprova. *SDK Firestore 12.8.0.* | — |
| R2-06 | LOW | CORRIGIDO | O E2E 10 cobre o caso: com uma edição em curso, a pessoa liga o modo tempo pelo topo. O rascunho adota o modo, não aparece aviso de outra aba, e salvar grava `displayMode: 'time'` junto com a edição (`e2e:966-997`). Há mutante do E2E registrado (`execucoes.md`). A adoção não mudou (`WorkTimeSettingsView.tsx:120-127`). | O resíduo INFO da revisão 3 continua: mudar o modo nas duas telas para o mesmo valor mostra o aviso de outra aba. Nada a exigir. |
| R2-09 | LOW | CORRIGIDO | Ver R3-05 (1). Os ganchos de `basisSync.ts` rodam com React 18 e `QueryClient` real, e os testes cobrem: primeiro retorno, cache, estado que volta, base sem bloco exato, teto de falhas, dois observadores, troca de workspace e duas estimativas. Os 11 mutantes do autor para essa fiação reprovam ao menos um teste (em memória). Meus 3 também: tirar a comparação na base nova, reler as exclusões já no pedido, `syncing` sempre falso. | A regra de retenção de `useIncomeEstimate.ts` é copiada no `Probe` do teste (`report-basis-sync.test.ts:133-155`), em vez de exercitada (R4-06). |
| R1-03 | MEDIUM | PARCIALMENTE CORRIGIDO + ACEITO COMO RISCO DOCUMENTADO | A falha da leitura dos desconsiderados tem o E2E 11 (`e2e:999-1029`). Com a conta suspensa, a tela mostra a mensagem fixa em pt-BR, sem texto do SDK, e "Tentar de novo" traz a estimativa de volta; nada é gravado. Plano (`:4807`) e `autorizacao-isolamento.md` atualizados. | A falha da leitura da preferência continua só com a guarda. O motivo registrado procede para uma escuta nova. Fica como sugestão, a confirmar porque depende da semântica do Firestore: suspender a conta e alterar o documento pelo Admin talvez faça a escuta já aberta receber a recusa. |
| R1-19 | INFO | ACEITO COMO RISCO DOCUMENTADO | Sem mudança; a decisão está no plano (`:4805`). | — |

Sondas de R3-04 (rotina de segunda a sexta):

| Caso | Minutos | Classificação |
| --- | --- | --- |
| 15/11/2026 (domingo) com plantão de 6 h | 360 | trabalhado |
| Natal com plantão de 12 h | 720 | trabalhado |
| 20/11 com hora extra de 2 h | 120 | trabalhado |
| 20/11 com escala de 6 h | 360 | trabalhado |
| 20/11 com escala 0 | 0 | dia sem trabalho |
| Natal marcado como trabalhado e coberto por férias | 0 | dia sem trabalho; a marca não conta |
| Natal sem marca, com férias | 0 | tirou o dia (a ausência não se aplica a dia já zerado, como antes) |
| Quem trabalha em feriados, Natal com férias | 0 | dia sem trabalho |
| Quem trabalha em feriados, Natal com férias e plantão | > 0 | trabalhado |
| Jornada reduzida no Natal | — | tirou o dia sem a opção de trabalhar em feriados; trabalhado com ela |

## 2. Achados novos

### R4-01 — LOW: a mutação feita nesta aba relê as exclusões antes da base

**Local:**
- `src/modules/transactions/hooks.ts:23-35,62-66,119-127`;
- `src/modules/transactions/incomeReads.ts:11-12`;
- `src/modules/work-time/useIncomeEstimate.ts:105-110,160`;
- `src/modules/reports/basisSync.ts:159-167`;
- documentos: `DATA_MODEL.md:277`, plano `:4764` e `VEREDITOS.md:45`.

**O que acontece.** As exclusões e a janela do painel ainda são relidas antes da base. A estimativa mostra, e depois segura, um total velho com o item novo. A correção de R3-03 vale para a divergência que a escuta vê; a mutação feita nesta aba segue outro caminho:

1. A mutação passa por `invalidateCashDependents` e chega a `invalidateTransactionDependents`. Ela invalida `['transactions', ws]` com o `refetchType` padrão (`active`).
2. `by-ids` e `income-window` ficam sob esse prefixo (`incomeReads.ts:11-12`), então voltam na hora. A base só é relida pelo agendador, 5 s depois da última notificação.
3. `syncing` só começa quando o gatilho grava a projeção e a escuta vê a divergência. Até lá, a estimativa é calculada com o item novo e o total velho.
4. Esse estado misto vira `lastDone` (`useIncomeEstimate.ts:160`). A retenção passa a segurá-lo até as leituras feitas depois da base nova.

**Cenário concreto.** A fonte é o espaço ativo, o padrão; modo habitual, agosto a outubro; uma receita de R$ 500,00 de outubro está desconsiderada. A pessoa anula essa receita em Lançamentos. A leitura por id volta já anulada em décimos de segundo, e a exclusão passa a ser ignorada (nota `exclusions_ignored`). A base, porém, ainda tem os R$ 500,00. Resultado: o valor da hora e todas as conversões contam R$ 500,00 a mais por uns 6 a 8 s (tempo do gatilho, mais 5 s, mais a callable). Se ela editar o valor dessa receita de R$ 500,00 para R$ 800,00, a estimativa tira R$ 800,00 de um total que ainda tem os R$ 500,00.

**Sonda.** Com React Query real, `invalidateQueries(['transactions', ws])` mais `invalidateFinancialReports`, e a projeção chegando 30 ms depois, a ordem observada foi: relatório, exclusões, mutação, exclusões, projeção, relatório, exclusões. Houve 1 renderização sem retenção com o total velho e o item novo, e 2 renderizações retidas com esses mesmos dados.

**Documentação.** O comentário de `basisSync.ts:162` ("para a estimativa nunca juntar um item novo com um total velho"), o `DATA_MODEL`, o plano e o VEREDITOS descrevem só o caminho da divergência. O E2E 8 usa outra sessão. *Semântica do TanStack Query 5.0.0.*

**Correção sugerida.**
- Tirar `by-ids` e `income-window` da releitura imediata de `invalidateTransactionDependents`: só marcar, com `refetchType: 'none'`.
- Levar a mutação para o caminho da divergência: ligar `syncing` e as releituras pendentes das bases daquele workspace (por exemplo, pelo `basisRegistry`) e reler as leituras de receitas depois da base nova, mesmo que a projeção não mude.
- Teste de gancho "mutação nesta aba" e E2E que anula, nesta aba, a receita desconsiderada, com o observador do teste 8.
- Ajustar o comentário e os documentos.

### R4-02 — LOW: na janela de 12 meses, o 12º mês carregando vira "base sem bloco exato"

**Local:**
- `src/modules/work-time/useIncomeEstimate.ts:63,68,76-87`;
- `src/modules/work-time/estimate.ts:120-124`;
- `src/modules/reports/basisSync.ts:209-213,226-233,240-247`;
- documentos: `VEREDITOS.md:66-67` e `elegibilidade-receitas.md:50`.

**O que acontece.** `basisExact` exige `extra.data` (`useIncomeEstimate.ts:85-86`). O mês avulso só começa a ser lido quando a série chega, na mesma renderização em que a escuta se inscreve. Daí saem dois efeitos.

**(a) Na montagem.** O primeiro retorno do servidor para a escuta costuma chegar antes da callable do mês avulso. Com `exactRef` falso, `request` invalida as duas bases, notifica os agendadores e marca as leituras de receitas (`basisSync.ts:231-233`). Quando o mês avulso chega, a comparação converge, mas 5 s depois as duas bases são relidas assim mesmo.
- Sonda com listener em 10 ms, série em 20 ms e mês avulso em 60 ms: 4 callables em vez de 2, e 2 leituras por id em vez de 1. Com o listener mais lento que a callable: 2 e 1.
- Acontece a cada carga do app nesse modo, na virada do mês e ao escolher 12 meses.

**(b) Na divergência.** As duas bases são relidas juntas. Se o mês avulso (um mês, bloco `cash`) volta antes da série:
1. o efeito da base consome as leituras pendentes com a série ainda velha;
2. compara de novo e diverge com a mesma assinatura;
3. gasta a segunda tentativa (`:209-213,240-247`) e faz mais um pedido.
- Sonda com série em 60 ms e mês avulso em 20 ms: 4 callables e 2 leituras por id por mudança.
- Some a folga que a segunda tentativa deixaria para a corrida com a projeção.

**O que segue correto.** A retenção: nenhuma renderização mista nas sondas, nas duas ordens de chegada.

**Documentação.** O modelo de custo fala em 1 ou 2 chamadas ao abrir e até 1 releitura por mudança.

*Inferido do tempo relativo entre a escuta e a callable.*

**Correção sugerida.**
- Distinguir "ainda carregando" de "sem bloco exato": por exemplo, `basisExact` nulo até as duas bases terem dados; enquanto for nulo, a escuta só registra a projeção.
- Com duas bases, consumir as leituras pendentes e comparar só quando as duas releituras pedidas tiverem terminado (por exemplo, pelo `dataUpdatedAt` de cada uma depois do pedido).
- Testes de gancho com série e mês avulso, nas duas ordens.
- Ajustar o modelo de custo.

### R4-03 — LOW: `refreshRegisteredBases()` em toda invalidação anula o teto de falhas

**Local:**
- `src/modules/reports/queryKeys.ts:57-66` e `basisRegistry.ts:26-32`;
- `src/modules/reports/hooks.ts:152-157,168-189` e `src/App.tsx:274-277`;
- `src/modules/reports/basisSync.ts:53-60,132-139`;
- `functions/src/reports/callables.ts:49-58`;
- documentos: plano `:4764,4808` e `elegibilidade-receitas.md:50`.

**O que acontece.** A função também passa a reler bases que nunca carregaram. `invalidateFinancialReports` é chamada por toda mutação. É chamada também pelo listener do mês do App a cada mudança do documento do mês corrente do workspace ativo: qualquer lançamento de qualquer membro, despesas incluídas, agrupado em 2 s, até cerca de 100 por hora (`liveRefresh.ts:1-14`). Cada chamada zera as falhas de todas as bases registradas, de qualquer workspace, e notifica o agendador de cada uma.

**(1) Base que falha sempre.** Por exemplo: a pessoa saiu do workspace-fonte, o espaço foi suspenso ou o relatório está com erro. Ela deveria parar depois de 2 falhas; o comentário de `basisSync.ts:53-59` cita justamente o caso "depois de perder o acesso ao workspace". Em vez disso, é relida a cada invalidação, e só o orçamento do agendador a limita: 5 seguidas e mais cerca de 30 por hora, cada uma com `retry: 1`, ou seja, 2 chamadas.

**(2) Base que nunca carregou.** O efeito das falhas só age com `dataUpdatedAt !== 0` (`basisSync.ts:133`; na revisão 3, `snapshot-r3/src/modules/reports/hooks.ts:174`), e na revisão 3 a invalidação não relia essa base. Agora `refreshRegisteredBases()` a relê pelo agendador, sem passar por essa condição.

**Sondas.**
- Base sem dado, 4 invalidações: as chamadas passam de 2 para 10.
- Base que perdeu o acesso: 6 chamadas a mais, já limitadas pelo orçamento.

**Efeito sobre a cota.** A recusa de acesso sai antes da reserva do limite de frequência. Um erro do relatório depois da reserva, porém, consome a cota de 300 por hora que o Dashboard divide (`callables.ts:49-58`). Num incidente, cada nova tentativa gasta essa cota.

**Preexistente e não registrado.** A invalidação do listener do App relê também toda base saudável, até no modo habitual, em que o mês corrente nem está na janela. O VEREDITOS diz o contrário: "só a mudança de receita relê o relatório" (`VEREDITOS.md:67`).

**Documentação.** O plano (`:4764,4808`) e a evidência dizem que a base "para depois de 2 falhas seguidas" e citam como reabertura só a mutação e a virada do mês.

*Semântica do TanStack Query 5.0.0.*

**Correção sugerida.**
- Zerar as falhas só com um sinal de versão nova que diga respeito à base: virada do mês (todas as bases), mutação no workspace da base (prefixo do workspace) e divergência (já existe). Não zerar a cada invalidação vinda de outro workspace.
- Deixar fora do agendador a base sem dado, como o efeito já faz.
- Opcional: tratar a recusa de acesso como final até uma montagem nova ou o "Tentar de novo".
- Corrigir o comentário, o plano e o modelo de custo.
- Teste de gancho: a base que falha sob invalidações repetidas para no teto.

### R4-04 — LOW: o estorno de recebimento é gravado no dia do recebimento

**Local:**
- backend: `functions/src/receivables/operations.ts:806-808,827-831` e `functions/src/receivables/__tests__/receivableLifecycle.integration.test.ts:359-363`;
- `src/modules/work-time/incomeBasis.ts:196-215,236,262`;
- `src/modules/work-time/messages.ts:101,124,151-174` e `src/components/workTime/EstimateDetails.tsx:206`;
- testes: `tests/unit/work-time-estimate.test.ts:244-265,283-321`;
- documentos: plano `:4743,4760,4796`, `inventario.md:52` e `elegibilidade-receitas.md:17,33`.

**O que acontece.** O caso "estorno depois do período" não acontece, e os textos e documentos sobre o mês do estorno enganam. O backend diz: "O estorno corrige o fato: mesmo dia civil do original, para que o mês do original some zero". O movimento e o espelho em `transactions` recebem `date: movement.date`, a data do recebimento, e o teste de integração confere `compensation.date === original.date`. Por isso `reversedOn`, que é a data do espelho (`incomeBasis.ts:236,262`), é sempre a data do recebimento, e `reversalSituation` só devolve `outside` com dados que o backend não produz. Os casos reais (os dois na janela, ou os dois no mês corrente) estão certos. O resto, não:

1. O painel diz "Estornado em 15/09/2026" para um recebimento de 15/09 estornado em 02/11: mostra a data do recebimento como se fosse a do estorno.
2. A memória de cálculo e o painel dizem que os estornos "reduzem a receita do mês em que acontecem" ou "aconteceram" (`messages.ts:101,124`; `EstimateDetails.tsx:206`). Quem estorna em novembro um recebimento de setembro espera ver novembro mudar, e novembro está fora da janela habitual (agosto a outubro). O que cai é setembro, e o valor da hora muda na hora.
3. D-P5F1-04, `elegibilidade-receitas.md:17,33` e o plano descrevem um estorno com data própria: `:4760` fala que os estornos "reduzem o mês do estorno", e o risco de `:4796` fala do estorno que "sai da janela depois (virada do mês)".
4. As fixtures dos testes (recebimento em 15/09, estorno em 02/11) não têm a forma que o backend grava.
5. O ramo `outside`, com o item já desconsiderado, contradiz o próprio status (texto latente).

**Origem.** A premissa veio da fixture. R1-14, R2-01 (MEDIUM na revisão 2) e o caso "dentro/depois" de R3-01 partiram dela; o desconto em dobro de R1-14 procede mesmo assim. Parte dos textos é anterior a esta rodada. A estimativa não tem número errado.

**Correção sugerida.**
- Dizer que o estorno de recebimento fica na data do recebimento e anula o valor naquele mês, na memória de cálculo, no motivo do item e no aviso do painel.
- Não apresentar a data do recebimento como data do estorno.
- Reescrever D-P5F1-04, a elegibilidade e o risco.
- Usar a forma real nas fixtures (mesma data).
- Remover o ramo `outside` ou mantê-lo como defesa, com o texto do item já desconsiderado coerente.

### R4-05 — INFO: `readsAfter` é um instante de relógio compartilhado entre workspaces

**Local:**
- `src/modules/reports/basisSync.ts:215-224,243`;
- `src/modules/work-time/useIncomeEstimate.ts:107-110`;
- `src/components/workTime/IncomeEditor.tsx:215`.

**O que acontece.** O marco é um instante do relógio do aparelho, não amarrado ao workspace. Em dois casos de borda, a retenção fica presa até outra leitura por id. `sync` não é reiniciado na troca de workspace (`basisSync.ts:223-224`), e `readsBehind` compara o `dataUpdatedAt` de qualquer leitura com esse instante.

**(a) Troca de workspace.** A fonte volta para um workspace cuja leitura por id está em cache, ainda fresca (5 min), com data anterior a um `readsAfter` posto por uma sincronização no outro workspace. `readsBehind` fica verdadeiro sem nenhuma releitura agendada. A partir do primeiro estado pronto, tudo fica retido até uma sincronização nesse workspace, uma mutação nele ou uma montagem nova depois dos 5 min.
- Sonda: ws-b carregado; troca para ws-a e sincronização; volta para ws-b. Resultado: `holding: true` 500 ms depois, sem leitura nova.
- Para acontecer, é preciso repetir a mesma lista de exclusões, porque trocar a fonte limpa as exclusões (`IncomeEditor.tsx:215`).

**(b) Relógio.** `Date.now()` não é monotônico. Um ajuste do relógio para trás entre `readsAfter` e a chegada dos dados faz a leitura nova parecer anterior ao marco, com o mesmo efeito.

**Consequência.** Durante a retenção, mudanças da base que não passam por divergência, como a virada do mês e as invalidações, não aparecem.

**Correção sugerida.**
- Guardar o workspace junto do marco, ou reiniciar `sync` na troca de workspace.
- Usar um marcador independente do relógio, como o `dataUpdateCount` da leitura, capturado no pedido.

### R4-06 — INFO: imprecisões da evidência

**Local:**
- `docs/production/evidence/p5f1/mutantes.md` (U14) e `mutantes.py.txt:33,154-168`;
- `respostas-revisao-3.md:12` e `respostas-revisao-2.md:25,29`;
- `src/modules/work-time/calendar.ts:358`;
- `tests/unit/report-basis-sync.test.ts:133-155` e `VEREDITOS.md:45`.

1. **U14 não compila.** Tirar `if (minutes > 0) finalHolidayEffect = 'worked';` deixa o `else if` seguinte solto (`ERR_INVALID_TYPESCRIPT_SYNTAX`), e o roteiro conta qualquer saída diferente de 0 como "morto". Dos 98, é o único que não compila: conferi removendo os tipos e analisando cada arquivo mutado. A variante que compila (`if (false)`) reprova 2 testes. A cobertura existe, mas a linha da evidência não a prova.
2. **Contagem.** `respostas-revisao-3.md:12` fala em 7 testes de gancho; são 8, como dizem o VEREDITOS e `autorizacao-isolamento.md`.
3. **Respostas antigas sem nota.** `respostas-revisao-2.md`, editado nesta rodada, mantém duas afirmações que a revisão 3 mostrou falsas. Em R2-05: "O retorno parcial do cache não relê". Em R2-09: "os unitários do projeto rodam no Node sem React nem DOM". Falta uma nota que aponte a correção.
4. **Comentário.** O comentário de `holidaysWorked` ("marcados ou porque o usuário trabalha em feriados") não cobre mais escala, plantão e hora extra.
5. **Retenção sem teste.** A retenção de `useIncomeEstimate` (`lastDone`, `inputs`) não roda em nenhum teste. O `Probe` do teste de gancho reimplementa só `syncing || readsBehind`, e a guarda não tem padrão para `inputs`. Um mutante que tire, por exemplo, `calendar` de `inputs` não seria pego por nenhum unitário. Mesmo assim, o VEREDITOS cita "testes de gancho com duas estimativas" como prova da retenção.

**Correção sugerida.**
- O roteiro de mutantes deve distinguir erro de compilação de reprovação; trocar U14 por uma mutação que compile.
- Corrigir a contagem de testes de gancho.
- Anotar as linhas de R2-05 e R2-09 em `respostas-revisao-2.md`.
- Atualizar o comentário de `holidaysWorked`.
- Testar `useIncomeEstimate` com os ganchos injetados, ou extrair a regra de retenção para uma função pura testada.

## 3. Verificado sem achado

1. **Ganchos e mutantes.** `report-basis-sync`: 8/8 em três execuções; `test:unit:reports`: 56/56. Cada mutante do autor para a fiação (U54, U70–U72, U85–U89, U96, U98) reprova ao menos um teste, e os meus três também. Os mutantes puros de estorno e painel (U75, U92–U94) e de calendário (U79–U81) reprovam com asserção, não por erro de carga.
2. **Escuta e metadados.** O retorno só do cache é ignorado. Com `includeMetadataChanges`, os eventos a mais são só as viradas de cache e de sincronização; o cliente não grava esses documentos, então não há escrita pendente, e esses eventos não cobram leitura. `changes` não conta mudança só de metadados, e o retorno confirmado sempre chega. *SDK Firestore 12.8.0.*
3. **Sem laço.**
   - O `setSync` da escuta não renderiza de novo quando já está esperando (`basisSync.ts:204`).
   - O `setSync` do efeito da base roda uma vez por sincronização e não muda as dependências do próprio efeito.
   - O `setSync` do ramo desligado roda só quando o efeito roda.
   - A base sem bloco exato relê só com mudança de documento ou com o primeiro retorno.
   - Uma divergência que a base não alcança pede no máximo 2 releituras por estado.
4. **Retenção, fora de R4-05.**
   - `syncing` só fica preso com falha visível (`refreshFailed`, com "Tentar de novo") ou sem rede (consulta pausada).
   - Com várias instâncias, cada uma tem o próprio marco, e a leitura das exclusões é feita uma vez só (`cancelRefetch: false`; teste 8).
   - Se as entradas mudam durante a sincronização, a estimativa é recalculada.
   - Na primeira montagem não há retenção.
   - A retenção não vaza entre contas: o `calendar` é outro objeto, o estado zera com a estimativa desligada, e os caches são limpos no logout.
5. **Escopo das releituras.** A releitura usa o prefixo de uid e workspace (`basisSync.ts:66-67`). `refreshIncomeReads` vale só para o workspace da estimativa. A troca de workspace cancela a escuta anterior (teste 7).
6. **Ordem no caminho da divergência.** As exclusões são relidas depois da base (teste 1). Nas sondas de 12 meses, nas duas ordens de chegada, nenhuma renderização juntou dados de versões diferentes.
7. **Textos novos.** `ESTIMATE_REFRESH_FAILED`, `ESTIMATE_QUALIFIER_STALE`, "Depois do período desta estimativa: ainda não entra na conta." e os avisos dos dois casos reais de estorno estão em pt-BR claro, sem detalhe interno. O "Tentar de novo" do relatório indisponível não aparece junto do aviso de falha (`EstimateDetails.tsx:74-83`); o aviso usa `role="status"`.
8. **Classificação do feriado.** Correta em todos os casos sondados (tabela de R3-04), sem mudar minutos.
9. **Paginação.** `readPagedWindow` dá o mesmo resultado do laço anterior, inclusive com `maxPages = 1` (estornos) e janela vazia.
10. **E2E 10, 11 e 12.** Coerentes com o código. Nenhum `skip`, `only` ou `fixme`. O único timeout de 45 s novo está numa asserção nova (aviso da releitura que falhou) e segue o padrão do arquivo para esperas que dependem de releitura.
11. **Rules e índices.** Sem mudança. A suíte de Rules ganhou a página exatamente cheia (500, sem "há mais") e as páginas vazias, sem afrouxar nada.
12. **Contagens.**
    - 90 unitários puros, 80 em `test:unit:work-time` e 56 em `test:unit:reports`.
    - 17 guardas, 13 cenários de Rules e 12 E2E.
    - 98 mutantes de unidade, dos quais 1 não compila (R4-06), e 5 do E2E (não rodados aqui).
13. **Plano e modelos.**
    - §20.15 não marca o gate da P5 nem P6–P10, e o estado é "aguardando auditoria independente".
    - `ARCHITECTURE.md:191` e `SECURITY_MODEL.md:126` continuam descrevendo o código.
    - O risco "ganchos sem teste" saiu do plano, e entraram os riscos da preferência e do teto de falhas.
    - Os marcadores `⟦…⟧` são preenchidos depois do gate e não foram avaliados.

## Notas

- **TanStack Query 5.0.0** (fontes em `wt-p5f1/node_modules/@tanstack/query-core/src`):
  - `invalidateQueries` sem `refetchType` relê na hora as consultas ativas (`queryClient.ts:248-266`);
  - `refetchQueries` ignora consultas desligadas e cancela a leitura em curso por padrão (`:268-292`);
  - `fetch` com `cancelRefetch: false` devolve a promessa em curso (`query.ts:320-341`);
  - o sucesso grava `dataUpdatedAt = Date.now()` e limpa `isInvalidated`; o erro não limpa (`:554-589`).
- **React 18.2:** o `act` assíncrono só aplica o trabalho do React no fim do escopo. Por isso as sondas avançam em passos de 2 ms, como o `until` do teste.
- **SDK Firestore 12.8.0** (`@firebase/firestore` 4.10.0): `docChanges()` sem opção exclui mudanças só de metadados (`index.esm.js:1290-1312`). Com `includeMetadataChanges`, o retorno confirmado é entregue mesmo sem documento mudado (`common-341bda9b.esm.js:16314-16336`).
- **Tempos.** Os tempos reais (gatilho, callable, partida a frio) são inferidos, não medidos no navegador. As ordens de chegada das sondas de R4-02 são as duas possíveis.
- **Sondas rodadas sem criar arquivo:**
  - mutação nesta aba (R4-01);
  - janela de 12 meses na montagem e na divergência, nas duas ordens (R4-02);
  - invalidações repetidas com base sem dado e com base que perdeu o acesso (R4-03);
  - `incomeItemPresentation` nas combinações de estorno (R4-04);
  - troca de workspace com `readsAfter` (R4-05);
  - classificação de feriados (R3-04);
  - compilação dos 98 mutantes (R4-06).
- **R4-04 corrige as revisões anteriores.** A premissa do "estorno depois do período" em R2-01 e R3-01 não vale com o backend atual. O código atual trata corretamente os casos que existem.
- **Impacto.** Nenhum achado novo grava, altera ou expõe dado financeiro. Todos tratam da estimativa informativa, de custo, de texto ou de evidência.
