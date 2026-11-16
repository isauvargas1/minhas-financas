# P5-F.1 — Revisão independente 10 (somente leitura)

- **Data:** 2026-11-05
- **Objeto:** `snapshot-r10/` (árvore Git `46abcd23`). Junto vieram:
  - `r10-sobre-r9.diff`: mudanças desde a revisão 9 (árvore `854463e8`), sem os PNG;
  - `revisao-9.md`: R9-01 … R9-04 e os resíduos R8-01, R8-02, R7-01, R6-02, R5-02 e R1-19;
  - as respostas do autor (`snapshot-r10/docs/production/evidence/p5f1/revisoes/respostas-revisao-9.md`), inclusive a seção da reprovação nas repetições;
  - os registros `logs/r9b/`, `logs/repeticoes-r9/`, `logs/repeticoes-r9b/`, `logs/dbg-r602/` e `logs/mutantes-unit-r9b.*`, e as cópias `r9b-contra-pre/`, `r9b-sonda-antiga/` e `dbg-r602*/`.
- **Contrato de aceite:** `p5f1/spec-original.txt`.
- **Método:** li o código, os testes, os documentos e as fontes do TanStack Query 5.0.0. Conferi cada resposta no código e no teste que ela cita, não pelo texto. Nada exigiu `npm install`, Emulator, build, rede ou Firebase.
  - **Ambiente.** Tudo rodou no snapshot com Node 22.23.4 e `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON`. React 18.2.0, react-test-renderer 18.2.0 e @tanstack/react-query 5.0.0 vieram de `wt-p5f1/node_modules`, só para leitura, por um gancho de resolução em memória (`--import data:…`).
  - **Integridade.** `src/` e `tests/` (356 arquivos) são a árvore `46abcd23`: conferi com `git hash-object --no-filters`, sem `-w`, contra `git --no-optional-locks ls-tree`. Os mesmos 356 arquivos batem com `logs/mutantes-unit-r9b.sha-antes`. `r9b-contra-pre/src` é o `src/` do snapshot com os 3 arquivos `*.antes-r9b`. A correção das repetições muda só tipos e comentários em `basisSync.ts`; em `useIncomeEstimateWith.ts`, troca `excluded.dataUpdatedAt` por `excluded.data`; em `incomeReads.ts`, liga `structuralSharing: false`.

  O que rodei:
  1. **Unitários e ganchos.** `test:unit:reports` (93, com os 43 de `report-basis-sync`) e `test:unit:work-time` (98, com os 18 de `work-time-income-estimate`): 4 de 4 execuções de cada conjunto sem falha, com o `verify:all` do autor em curso na máquina.
  2. **Os testes atuais contra o código da revisão 9.** O gancho redirecionou `src/` para `snapshot-r9/src/` (árvore `854463e8`). Reprovam 15 de 61: os 13 de `logs/r9/contra-854463e8.log` e os 2 novos da estimativa inteira (o objeto novo a cada leitura e o caso de R6-02 no mesmo milissegundo).
     - O teste novo de sincronização no mesmo milissegundo passa lá, como `execucoes.md` registra: o gancho é indiferente ao tipo, e a sonda passa o objeto.
     - Com a sonda de antes (o `dataUpdatedAt`, trocado em memória), ele reprova 3 de 3.
  3. **Mutantes em memória.** Um gancho de carga troca o trecho no módulo carregado, e um invólucro de `fs.readFileSync` (com `syncBuiltinESMExports`) troca o mesmo trecho no que a guarda lê. Uma marca na saída prova cada troca, e nada é gravado.
     - **Lista.** Saiu de `mutantes.py.txt` por `ast`, sem executar o roteiro. O SHA-256 é o de `p5f1/mutantes.py` (`9582e51d…`). Também conferem `atualizar-mutantes-r9.py` (`5bff7fe5…`), `atualizar-mutantes-r9b.py` (`58910b53…`), `escrever-mutantes-md.py` (`9f624419…`) e `gerar-tabela-mutantes.py` (`47b2985f…`).
     - **Nenhum mutante ficou aplicado.** Os 185 trechos (174 de unidade e 11 de Rules) aparecem uma vez cada no snapshot, e nenhum substituto está presente.
     - **Os 16 novos ou atualizados** (U55, U97, U114, U117, U152, U153, U157, U159 e U167–U174): **16/16 mortos**. U117 morre só pela guarda, como declarado; os outros morrem por teste de comportamento (U55 também pela guarda).
     - **6 meus** sobre o código novo (Y1–Y8, em "Verificado sem achado").
  4. **Sondas**, como testes acrescentados em memória aos módulos de teste, com React Query real, a API em memória e o relógio manual só nos agendadores. Comparei com `snapshot-r9` quando faz sentido:
     - H1 e H1x: uma mutação nesta aba durante a releitura;
     - E10: entradas trocadas durante a retenção;
     - M1e: a prévia montada durante a espera;
     - T1e: a volta a 12 meses, na estimativa inteira;
     - T1b: a base que sai de uso durante uma leitura;
     - P2: a estimativa nova que monta depois da limpeza;
     - PAUSA: a releitura pendente sem rede.

  Nenhum arquivo foi criado nem alterado além deste parecer. A impressão SHA-256 de caminho, tamanho e data dos 2.457 arquivos do snapshot ficou igual antes e depois (`6cf73059…`), e `review/` só ganhou este arquivo. No worktree `wt-p5f1`, só li `node_modules` e objetos do Git (`ls-tree`, `cat-file`, com `--no-optional-locks`). Li os registros do autor em `p5f1/logs/` só para leitura. Quando uma conclusão depende do TanStack Query 5.0.0, do React 18.2 ou do SDK Firebase 12.8, isso está dito.

## Escopo revisado

- **Código e testes do `r10-sobre-r9.diff`:**
  - `src/modules/reports/{basisSync,basisRegistry}.ts`, `src/modules/transactions/incomeReads.ts` e `src/modules/work-time/useIncomeEstimateWith.ts`;
  - `tests/unit/{report-basis-sync,work-time-income-estimate,work-time-guard}.test.ts`.
- **Documentos do diff:**
  - plano §20.15: `:4764`, `:4779-4781`, `:4800-4801`, riscos `:4813-4814`, estado `:4833`;
  - `DATA_MODEL.md:277`;
  - `evidence/p5f1/`: LEIAME, VEREDITOS, autorização, elegibilidade, execuções, mutantes e roteiros, as notas em `respostas-revisao-4.md` e `respostas-revisao-8.md`, `respostas-revisao-9.md` e a cópia de `revisao-9.md` (igual à original).
- **Contexto fora do diff:**
  - `src/modules/reports/{liveRefresh,basisRefresh,queryKeys,hooks}.ts`, `src/modules/transactions/api.ts:155-173`, `src/modules/work-time/{estimate,WorkTimeContext}.ts*` e `src/components/workTime/EstimateDetails.tsx`;
  - `@tanstack/query-core` 5.0.0 (`build/modern/{query,queryClient,queryObserver,utils,retryer,onlineManager}.js`) e `@tanstack/react-query` 5.0.0 (`build/modern/useBaseQuery.js`).

Linhas do plano referem-se a `docs/production/PRODUCTION_READINESS_PLAN.md` do snapshot.

## Resumo

| Situação dos achados da revisão 9 | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 3 | R9-01 (efeito colateral em R10-01), R9-03 (efeito colateral em R10-02), R9-04 (resíduo de contagem em R10-04) |
| CORRIGIDO no gancho, com resíduo | 1 | R9-02 (R10-02 e R10-03) |

| Resíduos listados | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO nos cenários apontados, com resíduo | 4 | R8-01, R7-01 e R6-02 (R10-02 e R10-03), R5-02 (R10-03) |
| ACEITO COMO RISCO DOCUMENTADO | 2 | R8-02 (a duração registrada volta a valer), R1-19 |

| Achados novos | Qtde | IDs |
| --- | --- | --- |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 1 | R10-01 |
| INFO | 3 | R10-02, R10-03, R10-04 |

Não há achado HIGH nem MEDIUM. As correções resolvem o que a revisão 9 apontou, com prova de comportamento:

- **R9-01.** A retenção das bases fora de passo (`outOfStep`) segura a janela de 12 meses também sem receita desconsiderada. Os 4 testes do orçamento e o N1e da estimativa inteira reprovam contra `854463e8`.
- **R9-02.** No gancho, a estimativa de uma base só não solta mais a de 12 meses, e o mês avulso que sai de uso com releitura pendente é relido na volta.
- **R9-03.** A liberação das leituras dependentes não espera mais a releitura pendente, e o estado mostrado durante a retenção não é mais guardado.
- **R9-04.** A falha da releitura da mutação fica registrada sem contar.
- **Repetições.** A reprovação de 1 em 60 tem diagnóstico reproduzível. A correção (o objeto do resultado como marca) se sustenta na semântica do TanStack Query 5.0.0.

Os achados novos:

- **R10-01 (LOW).** A retenção segura também bases em passo. Na janela de 12 meses, uma mutação nesta aba durante a releitura pedida pela escuta esconde o valor já sincronizado até a releitura da mutação sair. Isso leva 30 s depois da última mutação, ou até 10 min com o orçamento gasto, sem ressalva. Em `snapshot-r9`, o valor aparecia logo.
- **R10-02 (INFO).** A estimativa sem versão anterior das mesmas entradas mostra os estados intermediários durante toda a retenção: a montada nela, ou a de entradas trocadas. Com R10-01, isso vale também com a escuta viva. Num caso, isso é novo em relação a `snapshot-r9`: a base nova com a exclusão antiga, por uma leitura por id. O risco registrado só cobre as duas bases fora de passo, com a escuta encerrada.
- **R10-03 (INFO).** O pedido pendente pode ser dado como cumprido sem a leitura que o cumpre:
  - sem rede, a retenção solta na renderização seguinte;
  - na base que sai de uso no meio de uma leitura, o sucesso dessa leitura desfaz a invalidação da limpeza.
- **R10-04 (INFO).** Duas contagens antigas e uma frase do diagnóstico imprecisa.

O isolamento por titular e por workspace continua correto. Nada derivado é gravado, e a estimativa segue sem autoridade financeira.

## 1. Situação dos achados da revisão 9

| ID | Sev. original | Situação | Evidência (snapshot-r10) | O que falta |
| --- | --- | --- | --- | --- |
| R9-01 | LOW | CORRIGIDO; efeito colateral em R10-01 | (1) **Retenção.** `outOfStep` (`basisSync.ts:531-532`) entra em `holding` (`:540`), na renderização, com ou sem leitura dependente. (2) **Testes.** Os 4 testes do orçamento (`report-basis-sync.test.ts:1066-1082`, com e sem receita desconsiderada, escuta viva e encerrada) e o N1e da estimativa inteira (`work-time-income-estimate.test.ts:698`: sempre R$ 36.000,00) reprovam contra `854463e8` e passam aqui. (3) **Mutantes.** U152, U153, U167 e U168 mortos | A condição segura qualquer releitura pendente, mesmo com as bases em passo (R10-01) |
| R9-02 | INFO | CORRIGIDO no gancho, com resíduo | (1) **Uma base só.** C1 (`report-basis-sync.test.ts:1245`) reprova contra `854463e8`: a de 12 meses segura até o mês avulso chegar. (2) **Limpeza.** A base que sai de uso com releitura pendente fica desatualizada (`basisSync.ts:180-184`, `refetchType: 'none'`). Na volta, ela é lida na hora: `shouldFetchOptionally`, `queryObserver.js:418-419`, TanStack 5.0.0. T1 (`:1284`) reprova contra `854463e8`, e U169 morre. A estimativa nova que monta depois a relê pelo agendador: sonda P2, de 2 para 3 chamadas depois do agrupamento, uma leitura só | Na estimativa inteira, a volta a 12 meses não tem versão anterior das entradas, e o estado misto aparece durante a espera (T1e, R10-02). A base que sai de uso durante uma leitura perde a releitura pendente (T1b, R10-03) |
| R9-03 | LOW | CORRIGIDO; efeito colateral em R10-02 | (1) **Liberação.** `followReads` não espera mais (`basisSync.ts:446-452`; a guarda fixa o trecho em `work-time-guard.test.ts:383`). (2) **Retenção.** `holdEstimate` só guarda sem `holding` (`useIncomeEstimateWith.ts:112`; guarda `:414`). (3) **Testes.** E9 (`work-time-income-estimate.test.ts:736`): R$ 35.500,00 depois da leitura por id, com `seriesCalls` em 1. Esse teste e as duas regras puras (`:65`, `:89`) reprovam contra `854463e8`. U170 e U172 mortos | Com a retenção longa de R10-01, as entradas novas ficam sem versão guardada e expostas (R10-02) |
| R9-04 | INFO | CORRIGIDO; resíduo de contagem em R10-04 | (1) **Plano.** `:4779` diz 98 e 93, com 43 e 18, que conferem com as execuções. (2) **Teto.** `VEREDITOS.md:45` cita as quatro saídas. (3) **Falha registrada.** O ramo sem a base desatualizada guarda `errorUpdatedAt` (`basisSync.ts:202`). F1 (`report-basis-sync.test.ts:1322`, 7 chamadas) reprova contra `854463e8`, e U157, U159 e U171 morrem. (4) **Ordem dos pedidos.** `basisRegistry.ts:46-51` diz o que a ordem garante. (5) **Frases.** As frases foram reescritas | `VEREDITOS.md:60` ainda diz 42; `respostas-revisao-9.md:24` descreve a contagem de antes da correção das repetições (R10-04) |
| R8-01 | LOW | CORRIGIDO nos cenários apontados (com R9-01 e R9-02); resíduos em R10-02 e R10-03 | Ver R9-01 e R9-02. Sem receita desconsiderada, a estimativa de 12 meses segura a versão anterior até a outra base chegar | A estimativa sem versão anterior (montada, ou com entradas trocadas); a pausa sem rede |
| R8-02 | INFO | ACEITO COMO RISCO DOCUMENTADO; a duração registrada volta a valer | O risco (`:4814`) diz "em geral, menos de um segundo, mesmo com uma releitura pendente da série". O E9 prova: só a leitura por id separa o estado misto do certo | — |
| R7-01 | LOW | CORRIGIDO nos cenários apontados; resíduos em R10-02 e R10-03 | Ver R8-01 | R10-02 e R10-03 |
| R6-02 | LOW | CORRIGIDO nos cenários apontados (inclusive a reprovação nas repetições); resíduos em R10-02 e R10-03 | A leitura dependente passou ao objeto do resultado (`useIncomeEstimateWith.ts:158`, `incomeReads.ts:84`). Os testes `work-time-income-estimate.test.ts:310` e `:341` reprovam contra o código de antes (`r9b-contra-pre`) e morrem nos mutantes U173 e U174 | R10-02 (a base nova com a exclusão antiga durante a retenção) |
| R5-02 | LOW | CORRIGIDO nos cenários apontados; resíduo em R10-03 | Com a escuta encerrada e sem receita desconsiderada, a estimativa de 12 meses segura até a releitura da mutação da outra base chegar (os testes de R9-01) | A pausa sem rede (R10-03) |
| R1-19 | INFO | ACEITO COMO RISCO DOCUMENTADO | Sem mudança. A decisão está no plano (`:4824`), e `Header.tsx` não está no diff | — |

## 2. Achados novos

### R10-01 — LOW: a retenção das bases fora de passo segura também bases em passo; uma mutação nesta aba durante uma releitura esconde a estimativa já sincronizada até a releitura da mutação (30 s depois da última mutação; até 10 min com o orçamento gasto), sem ressalva

**Local:**
- `src/modules/reports/basisSync.ts`:
  - `:531-532`: `outOfStep` é verdadeiro se **alguma** base tem releitura pendente pedida depois do começo da última leitura dela; não confere se outra base já leu esse pedido;
  - `:540`: `outOfStep` entra em `holding`.
- `src/modules/reports/basisRegistry.ts`:
  - `:88-93`: cada mutação nesta aba pede a releitura de todas as bases carregadas do workspace (o mesmo sinal para as duas);
  - `:103-107`: a releitura conta como pendente enquanto o agendador tem relógio e o pedido é posterior ao começo da última leitura.
- `src/modules/reports/liveRefresh.ts`:
  - `:67-70`: cada `notify` recomeça o agrupamento, também durante a espera da reposição;
  - `:54-60`: sem ficha, a releitura espera a reposição.
- `src/modules/reports/queryKeys.ts:53-57`: 30 s depois da última mutação; 2 seguidas e mais 1 a cada 10 min.
- `src/modules/work-time/useIncomeEstimateWith.ts:106-111`: com `holding` e as mesmas entradas, vale a versão guardada.
- **Documentos:**
  - plano `:4764` e `basisSync.ts:305-306`: "Sem mudança nos dados, segurar não muda o que é mostrado";
  - nenhum risco registra o atraso (`:4813` trata só da escuta encerrada).

**O que acontece.**
1. **A regra não compara as bases.** A sugestão de R9-01 era segurar enquanto uma base nova estivesse **à frente** de outra com releitura pendente. A regra adotada segura sempre que existe uma releitura pendente posterior ao começo da última leitura de alguma base, mesmo quando as duas bases foram lidas no mesmo ciclo e as duas têm a mesma releitura pendente.
2. **O caso comum.** A pessoa lança uma receita; o gatilho grava; a escuta pede; 5 s depois, as duas bases são relidas. Se ela salvar outro lançamento nesta aba durante essas leituras (cerca de 1 s), as duas bases chegam com o estado sincronizado e consistente. Mas as duas têm a releitura da nova mutação pedida depois do começo da leitura. Então a estimativa segura a versão anterior à receita. Com receita desconsiderada, a janela vai até a releitura por id que segue a liberação (sonda H1x).
3. **Duração.** O valor só aparece quando a releitura da mutação chega:
   - 30 s depois da última mutação desta aba, e cada mutação nova adia;
   - com 2 releituras da mutação nos últimos 10 min (comum numa sessão de lançamentos), na reposição, até 10 min depois.
4. **Sem ressalva.** Nada falhou: sem aviso e sem "Tentar de novo". Vale para os 105 pontos e o Header (o provedor).
5. **Em `snapshot-r9`,** o valor sincronizado aparecia logo depois da sincronização: a espera morava só na liberação da base nova sem pedido.
6. **Contrapartida.** A retenção cobre, de fato, uma corrida estreita: o gatilho da mutação gravando entre as duas leituras paralelas. Com a escuta viva, essa corrida também é vista e pedida. O custo é segurar o caso comum.

**Cenário concreto:**
- Fonte PF, 12 meses, R$ 3.000,00 por mês, escuta viva, sem receita desconsiderada. A pessoa já fez duas rodadas de lançamentos nesta aba nos últimos 10 min.
- Ela lança uma receita de R$ 500,00 em 20/10/2026. A escuta sincroniza as duas bases (R$ 36.500,00, consistente).
- Durante essa leitura, ela salva uma despesa.
- A estimativa continua em R$ 36.000,00, sem ressalva, até a reposição do orçamento da mutação: até 10 min.
- Com o orçamento cheio, o atraso é de 30 s depois da última mutação, e cada lançamento novo adia.

**Sondas** (estimativa inteira; relógio manual nos agendadores: agrupamento 50 = 30 s, reposição 10.000 = 10 min):

| Sonda | Situação | r10 | `snapshot-r9` |
| --- | --- | --- | --- |
| H1, orçamento 1 | Sem desconsiderada; despesa durante a releitura pedida pela escuta | 3.600.000 até a reposição; depois 3.650.000; sem ressalva | 3.650.000 logo depois da sincronização |
| H1, orçamento 100 | O mesmo, com ficha | 3.600.000 até o agrupamento da despesa; depois 3.650.000 | 3.650.000 logo |
| H1x | Com desconsiderada; despesa depois da chegada das bases, durante a releitura por id | 3.550.000 até a reposição; depois 3.600.000 | 3.600.000 logo depois da leitura por id |

**Correção sugerida:**
- Segurar só quando uma base já leu um pedido que a outra ainda não leu.
  - Por exemplo, guardar por base o primeiro pedido pendente depois do começo da leitura cujos dados estão em uso, e comparar com o começo da leitura em uso das outras bases.
  - É a condição "à frente" de R9-01. Ela distingue R8-01 e a nova tentativa depois de uma falha (segura) de H1 (não segura).
- Teste: a sonda H1.
- Ou registrar o atraso nos riscos, com as durações, e corrigir "Sem mudança nos dados, segurar não muda o que é mostrado".

### R10-02 — INFO: a estimativa sem versão anterior das mesmas entradas (montada durante a retenção ou com as entradas trocadas) mostra os estados intermediários; com R10-01, a janela vale também com a escuta viva, e a base nova com a exclusão antiga aparece de novo

**Local:**
- `src/modules/work-time/useIncomeEstimateWith.ts:106-112`: com `holding` e entradas diferentes, ou sem versão guardada, vale o estado atual. Ele só é guardado sem `holding` (a correção de R9-03).
- `src/modules/reports/basisSync.ts:531-532`: a retenção longa de R10-01.
- **Documentos:**
  - risco `:4813`: "Com as entradas trocadas durante a espera (por exemplo, outro calendário), não há versão anterior delas a mostrar, e a estimativa nova pode juntar as duas bases fora de passo até a espera acabar". Ele está no item da escuta encerrada e cita só as duas bases;
  - plano `:4764`: "A espera vale para todas as estimativas da sessão";
  - `basisSync.ts:527-530`: "Uma base nova não é mostrada com outra que ainda vai ser relida pelo mesmo sinal";
  - `respostas-revisao-9.md:22` (R9-02): "a retenção vale durante essa leitura".

**O que acontece.**
1. **`holding` não basta.** `holdEstimate` só segura com uma versão anterior das mesmas entradas. Sem ela, `holding` não tem efeito: a estimativa mostra o estado atual a cada renderização. É o caso da estimativa com as entradas trocadas e da montada durante a retenção (a prévia de Configurações, o assistente).
2. **Sem versão guardada.** Com a correção de R9-03, as entradas novas ficam sem versão guardada durante toda a retenção. Com R10-01, essa retenção dura 30 s a 10 min depois de qualquer mutação nesta aba (janela de 12 meses), com a escuta viva e nada falhando.
3. **O que aparece nessa janela:**
   - as duas bases fora de passo (M1e; T1e, a volta a 12 meses de R9-02);
   - a base nova com as exclusões antigas, entre a liberação e a leitura por id relida (E10). É a classe de R4-01 e R6-02, e é nova em relação a `snapshot-r9`: lá, sem retenção, as entradas novas eram guardadas logo depois da troca.
4. **Duração.** Cada estado intermediário dura uma leitura por id (E10). O das duas bases dura até a espera acabar (M1e e T1e, até 10 min com a escuta encerrada).

**Cenário concreto** (E10):
- 12 meses, R$ 3.000,00 por mês. A receita de R$ 500,00 de 15/10/2026 está desconsiderada. Escuta viva.
- A releitura da mutação de uma despesa nesta aba espera a reposição.
- A pessoa troca o calendário em Configurações e salva.
- Outro membro anula a receita desconsiderada, e a escuta sincroniza.
- Entre a chegada das bases e a leitura por id relida, o topo mostra R$ 35.000,00 (a receita descontada duas vezes) e depois R$ 35.500,00. Em `snapshot-r9`, R$ 35.500,00 do começo ao fim.

**Sondas** (estimativa inteira):

| Sonda | Situação | r10 | `snapshot-r9` |
| --- | --- | --- | --- |
| E10 | Calendário trocado durante a retenção; outro membro anula a desconsiderada | 3.550.000 → 3.500.000 → 3.550.000 | 3.550.000 só |
| E10 sem troca | O mesmo, sem trocar as entradas | 3.550.000 só | 3.550.000 só |
| M1e | Escutas encerradas; mês avulso novo e série esperando a reposição; a prévia (12 meses) monta | provedor 3.600.000 (segurado); prévia 3.550.000 com ressalva até a reposição; as duas 3.600.000 no fim | os dois em 3.550.000 (R9-01) |
| T1e | Escuta encerrada; as duas releituras da mutação esperando a reposição; 12 → 3 → 12 meses | 3.550.000 (o mês avulso relido, a série antiga) até a reposição; depois 3.600.000 | o mês avulso não é relido (tempo esgotado) |

**Correção sugerida:**
- Corrigir R10-01 encurta a janela: sem a retenção indevida, as entradas novas são guardadas logo.
- Registrar no risco a estimativa montada durante a espera e a base nova com a exclusão antiga durante uma retenção com entradas trocadas, não só as duas bases.
- Ajustar as frases citadas.

### R10-03 — INFO: o pedido pendente pode ser dado como cumprido sem a leitura que o cumpre (pausa sem rede; base que sai de uso no meio de uma leitura)

**Local:**
- `src/modules/reports/basisRegistry.ts:103-107`: depois de o agendador disparar, a releitura deixa de contar como pendente. O começo só é anotado na `queryFn` (`basisSync.ts:130-134`).
- `src/modules/work-time/useIncomeEstimateWith.ts:153` e `basisSync.ts:532`: `fetching` é `isFetching`, sem a busca pausada.
- `src/modules/reports/basisSync.ts:180-184`: a invalidação na limpeza.
- TanStack Query 5.0.0:
  - `query.js:279-290`: sem rede, a busca nasce `paused`;
  - `queryObserver.js:301`, `:325`: `isFetching` falso, `isPaused` verdadeiro, e `isPaused` não é lido, então não notifica (`:346-366`);
  - `query.js:291-299`: o sucesso zera `isInvalidated`;
  - `query.js:97-109`: sem observadores, a leitura em curso continua (`cancelRetry`, porque a `queryFn` não lê o `signal`).

**O que acontece.**
1. **Pausa sem rede.**
   - A releitura pendente da outra base dispara sem rede. A busca fica pausada, a `queryFn` não roda, e o agendador fica sem relógio. Então `basisRereadScheduled` e `fetching` ficam falsos, e `outOfStep` também.
   - Nada renderiza com a pausa, e a tela mantém a versão segurada. Mas qualquer outra renderização mostra as bases fora de passo até a rede voltar: o provedor renderizando por outro motivo basta.
   - A revisão 9 registrou a mesma ressalva para a espera de então ("só pesa se outra mudança rodar a decisão no meio"). Com a retenção lida na renderização, qualquer renderização basta.
2. **Base que sai de uso durante uma leitura dela, com um pedido feito depois do começo dessa leitura.** Por exemplo, outra mutação nesta aba durante a leitura do mês avulso, e a pessoa passa a 3 meses.
   - A limpeza invalida, cancela os agendadores e esquece a ordem.
   - A leitura em curso continua sem observadores, e o sucesso dela desfaz a invalidação.
   - Na volta, a base está nova: não é relida, e o segundo pedido se perde até outro sinal (a escuta viva, ou, com ela encerrada, a próxima mutação, a virada do mês ou o "Tentar de novo").

**Sondas** (gancho):

| Sonda | Situação | Resultado |
| --- | --- | --- |
| PAUSA | `budgetSpent('encerrada', false)`; sem rede quando a releitura pendente da série sai; outra renderização (dados da leitura por id trocados) | Antes da renderização, `holding` continua verdadeiro e a busca, `paused`. Depois dela: `holding` falso, com outubro em 100.000 e novembro de 2025 em 40.000 (1 renderização livre com só uma base nova). Na volta da rede, a série é lida, e o estado fica consistente |
| T1b | Mutação 1 (o mês avulso a 40.000), leitura dele em curso (a callable lê no começo); mutação 2 (30.000) durante a leitura; 12 → 3 → 12 meses | Invalidada na limpeza: sim; depois da leitura em curso: não. Chamadas do mês avulso de 2 para 2 na volta; o mês avulso fica em 40.000, e não em 30.000 |

**Correção sugerida:**
- Contar a busca pausada como em leitura: `fetchStatus !== 'idle'`, ou `isFetching || isPaused` em `fetching`.
- Na limpeza com leitura em curso, guardar a marca no registro, pela chave, e aplicá-la no próximo registro da base. Outra saída: cancelar a leitura em curso com `revert`.
- Ou registrar os dois casos nos riscos e ajustar "a base que sai de uso com releitura pendente fica desatualizada e é relida quando volta".

### R10-04 — INFO: contagens antigas e uma frase do diagnóstico imprecisa

**Local e o que diz:**
1. **`VEREDITOS.md:60`:** "42 testes de gancho". A linha `:49` do mesmo arquivo diz 43, e a suíte tem 43.
2. **`respostas-revisao-9.md:24`** (R9-04, item 1): "O plano diz 96 e 92, com 42 testes de gancho e 16 da estimativa inteira". O plano (`:4779`) diz 98 e 93, com 43 e 18, o que medi. A linha é anterior à correção das repetições.
3. **`execucoes.md:113`** (diagnóstico):
   - "reprova sempre, no estado da 27ª: a base nova (outubro em 30.000), as exclusões da 3ª leitura e `holding` preso". O registro da 27ª (`logs/repeticoes-r9/rep-27.log:360-367`) só mostra o tempo esgotado no mesmo `until`; o estado vem da reprodução (`dbg-r602b`).
   - "(por exemplo, servida pelo cache local)": no produto, sem rede, o TanStack Query pausa a leitura (a `queryFn` nem roda); com rede, `getDocs` vai ao servidor. O mesmo milissegundo é, na prática, um efeito dos testes (leituras em memória sem latência). A correção continua válida e mais robusta.
4. **Frases cobertas por R10-01 a R10-03:**
   - "Sem mudança nos dados, segurar não muda o que é mostrado" (plano `:4764`; `basisSync.ts:305-306`);
   - "A espera vale para todas as estimativas da sessão" (`:4764`) e "Uma base nova não é mostrada com outra que ainda vai ser relida pelo mesmo sinal" (`basisSync.ts:527-530`);
   - "a base que sai de uso com releitura pendente fica desatualizada e é relida quando volta" (`:4764`; `basisSync.ts:302-303`; `DATA_MODEL.md:277`; `VEREDITOS.md:45`; `elegibilidade-receitas.md:50`);
   - "a retenção vale durante essa leitura" (`respostas-revisao-9.md:22`);
   - "quando ela sai, a base entra em leitura (`isFetching`)" (`respostas-revisao-9.md:21`): sem rede, a busca fica `paused`.

**Correção sugerida:** ajustar os textos.

## 3. Verificado sem achado

1. **Testes, guarda e mutantes.**
   - Os 191 testes (93 + 98) passam em 4 de 4 execuções de cada conjunto.
   - Contra `854463e8`, reprovam 15 de 61, pelos motivos de cada achado da revisão 9 e das repetições.
   - Contra o código de antes da correção das repetições (`r9b-contra-pre`): a estimativa inteira fica em 16 de 18, e a sincronização em 43 de 43, como `execucoes.md` registra. A sonda de antes reprova 3 de 3.
   - **Nada foi enfraquecido.**
     - Asserções: de 116 para 126 em `report-basis-sync`, de 42 para 63 em `work-time-income-estimate` e de 173 para 178 na guarda.
     - As duas expressões trocadas na guarda deram lugar a versões mais estritas: o efeito das falhas inteiro (`work-time-guard.test.ts:365`) e nada entre o par e a liberação (`:383`). Entraram `outOfStep`, a limpeza, o tipo da leitura dependente, a regra de retenção e `structuralSharing` (`:384-385`, `:390`, `:408-409`, `:414`, `:422`). `Date.now(` continua proibido.
     - Os testes da revisão 8 trocaram a sequência esperada pela nova (a leitura por id depois de cada base), mantendo a asserção de nenhuma renderização livre com só uma base nova.
     - Não há `skip`, `only` nem `todo`, e os prazos de `until` e `settle` são os mesmos.
   - **Dublês.** A sonda do gancho passou a usar `useTransactionsByIdsWith`: a mesma chave e as mesmas opções do produto, mais fiel que a consulta própria de antes. O `setState` de `work-time-income-estimate.test.ts:450` mantém o objeto, então não conta como leitura nova (antes, mudava o marco).
   - **Mutantes meus:**

     | Mutante | Troca | Resultado |
     | --- | --- | --- |
     | Y1 | a limpeza invalida sempre | morto por comportamento |
     | Y3 | `every` no lugar de `some` em `outOfStep` | morto por comportamento |
     | Y4 | `holdEstimate` guarda durante a retenção quando não há versão anterior | morto pela regra pura |
     | Y6 | `basisRereadScheduled` sem a ordem | morto por comportamento |
     | Y2 | a invalidação da limpeza sem `refetchType: 'none'` | sobrevive aos testes de comportamento e morre pela guarda (`:385`). O efeito é uma leitura na saída em vez de na volta (sonda: 1→2 chamadas ao sair), desperdiçada se a base não voltar (por exemplo, o mês avulso antigo na virada) |
     | Y8 | `outOfStep` sem `syncKey !== null` | sobrevive aos testes de comportamento e morre pela guarda (`:384`). Sem a checagem, a estimativa desligada mostraria a última pronta em vez de `idle` enquanto outra estimativa lê a base. Nenhum teste de comportamento cobre a estimativa desligada durante a retenção |

2. **A retenção acaba nos caminhos pedidos** (TanStack Query 5.0.0 e React 18.2). O registro é lido a cada renderização, e toda mudança de dado que pede renderização reavalia `outOfStep`.
   - **Releitura que sai.** `refetchQueries` (`queryClient.js:141-156`) põe a base em `fetching`. `isFetching` é lido (`basisSync.ts:193`, `useIncomeEstimateWith.ts:153`), então renderiza (`queryObserver.js:346-366`); na chegada, renderiza de novo, e a retenção sai.
   - **Releitura cancelada.** Só com zero usuários (`basisSync.ts:179-187`), quando a estimativa já não usa a base.
   - **Releitura superada por uma leitura nova.** O começo na `queryFn` passa à frente do pedido (teste do "Tentar de novo", `report-basis-sync.test.ts:1084`).
   - **Consulta desligada.** As bases da estimativa ligada nunca estão desligadas.
   - **Troca de chave ou de janela.** Com uma base só, não segura; na virada, a chave nova começa sem pedido.
   - **Estimativa desligada.** `syncKey` é nulo (só a guarda, ver Y8).
   - **Base no teto.** A mutação a pula (`basisRegistry.ts:90`) e o efeito das falhas não a reagenda (teste `:1160`).
   - **Duração.** Ela é limitada pela atividade da pessoa: cada mutação recomeça os 30 s, e a reposição sai em até 10 min. Ressalvas: R10-01 e a pausa (R10-03).
3. **Não solta cedo.**
   - O pedido que chega sem renderização vale na renderização seguinte, que é a que traria um dado novo.
   - O registro é um só para as estimativas da sessão: a de uma base só não solta a de 12 meses (C1).
   - A releitura pedida por outra estimativa também segura.
   - A base que sai de uso e volta é relida (T1, P2), exceto com leitura em curso (R10-03).
4. **"Segurar sem mudança nos dados".**
   - O aviso de falha e o "Tentar de novo" vêm do estado atual (`useIncomeEstimateWith.ts:107-108`). Durante `outOfStep`, o estado atual é sempre `done`: `loading` e `error` exigem uma base sem dados, e aí `basis` é nulo.
   - O Header usa o `refreshFailed` atual.
   - Única diferença visível: "Atualizado em" (`EstimateDetails.tsx:159`) mostra a hora da versão segurada, coerente com o valor mostrado. Com dados mudados, ver R10-01.
5. **Base desatualizada na limpeza.**
   - **Na troca de chave e na estimativa religada,** ela é lida na hora (`shouldFetchOptionally`). O resultado otimista já vem com `isFetching` (`queryObserver.js:236-247`), então o efeito das falhas não agenda outra leitura: uma leitura só.
   - **Na estimativa nova que monta** (`refetchOnMount: false`), o efeito das falhas a reagenda pelo agendador (P2).
   - **No teto,** a base não tem releitura pendente e não é invalidada aqui.
   - **Orçamento.** A leitura na volta não passa pelas fichas, mas substitui a releitura pendente cancelada. A base registrada de novo começa com o orçamento cheio, o que já era assim. Cabe no modelo de custo.
6. **Liberação depois de cada base e custo.** O modelo de custo diz "na janela de 12 meses, uma depois de cada base relida; quando as duas são relidas juntas, uma só, depois delas; a espera das bases fora de passo não acrescenta leitura" (`VEREDITOS.md:68`). O plano (`:4823`) limita as releituras do painel aos orçamentos das bases. Cada liberação depende de uma leitura de base com outra receita; `outOfStep` só lê o registro.
7. **Falha registrada sem contar.**
   - Nenhum caminho quebra o teto: só o sucesso zera `isInvalidated` (`query.js:291-299`). O ramo desatualizado conta cada `errorUpdatedAt` novo (`basisRefresh.ts:89-91`), e o outro só registra.
   - A mutação continua pulando a base no teto.
   - O efeito é a segunda releitura do pedido seguinte (F1; U171).
8. **Identidade pela leitura concluída** (TanStack Query 5.0.0):
   - com `structuralSharing: false`, `replaceData` devolve o objeto da `queryFn` (`utils.js:164-171`; `query.js:40-49`), e, sem `select`, o resultado usa `state.data` (`queryObserver.js:250-266`);
   - `getTransactionsByIds` devolve um objeto novo a cada chamada (`transactions/api.ts:155-173`).
   - **Caminhos:**
     - **troca de ids ou de chave:** outra consulta, `undefined` antes da primeira leitura, como era o 0;
     - **erro depois de dados:** o mesmo objeto, e a retenção continua com a ressalva, como antes;
     - **leitura cancelada:** o estado volta, sem objeto novo;
     - **coleta e remontagem:** uma consulta nova;
     - **duas estimativas na mesma chave:** o objeto é dividido;
     - **`setQueryData`:** nenhum uso no produto sobre `transactions` (só em notificações).
9. **Sem compartilhamento de estrutura.** O único consumidor é a estimativa. Ela já lê `dataUpdatedAt`, então não há renderização a mais. A memória de `state` já é refeita a cada renderização, porque o resultado rastreado é um objeto novo por renderização (`useBaseQuery.js:57`; `queryObserver.js:129-142`). Nada se perde.
10. **Bases pelo `dataUpdatedAt`.** Não achei caminho, no produto, em que duas leituras de uma base terminem no mesmo milissegundo:
    - cada leitura é uma chamada à callable, disparada por agendador (≥ 5 s), troca de chave ou ação da pessoa;
    - leituras simultâneas da mesma base são canceladas ou divididas (`cancelRefetch`), e a nova tentativa é a mesma busca.

    Nos testes, as bases levam ≥ 2 ms e começam ≥ 5 ms depois da chegada anterior. Os testes com o relógio parado só o param depois de as bases chegarem.
11. **Diagnóstico da reprovação.** Ele se sustenta:
    - mecanismo reproduzido com o relógio parado (`dbg-r602b`, e a minha execução com a sonda de antes: 3/3);
    - 150/150 no tempo normal (`logs/dbg-r602/resumo.txt`);
    - o mesmo ponto de falha da 27ª.

    Repetições refeitas: 30 com 93 testes e 30 com 98, todas com `# fail 0` (`logs/repeticoes-r9b/`). Ressalva de texto em R10-04.
12. **Isolamento e superfície.**
    - O diff não toca Rules, índices, Functions, interface nem textos visíveis.
    - O registro usa a chave da base (uid, workspace, período e seções), e a invalidação da limpeza é exata por chave.
13. **Plano.**
    - O §20.15 continua "AGUARDANDO AUDITORIA INDEPENDENTE" (`:4833`), sem marcar o gate da P5 nem P6–P10.
    - A cópia de `revisao-9.md` é igual à original.
    - Os marcadores `⟦…⟧` são preenchidos depois do gate e não foram avaliados.

## Notas

- **TanStack Query 5.0.0** (`wt-p5f1/node_modules/@tanstack/query-core/build/modern`):
  - sem rede, a busca nasce `paused` (`query.js:285`), e `refetchQueries` a devolve resolvida (`queryClient.js:152`);
  - `isFetching` e `isPaused` saem de `fetchStatus` (`queryObserver.js:301`, `:325`), e só as propriedades lidas notificam (`:346-366`);
  - o sucesso zera `isInvalidated` (`query.js:298`);
  - sem observadores, a busca em curso continua se a `queryFn` não leu o `signal` (`query.js:101-106`);
  - a base desatualizada que volta a ser usada é lida na hora (`queryObserver.js:418-419`), mas a que monta com `refetchOnMount: false` não (`:408-409`);
  - `invalidateQueries` com `refetchType: 'none'` só marca (`queryClient.js:126-133`);
  - `setOptions` roda num efeito (`useBaseQuery.js:43-45`), então a limpeza do registro roda com o observador ainda na chave antiga (por isso `refetchType: 'none'` importa, Y2).
- **React 18.2:**
  - a leitura do registro na renderização não tem efeito colateral;
  - `last.current` é atualizado na renderização, padrão que já existia;
  - a aplicação usa `createRoot`, e o `TestRenderer.create` dos testes e das sondas usa a raiz legada.
- **SDK Firebase 12.8:** a escuta usa `includeMetadataChanges` (`hooks.ts:80`). Sem rede, os retornos só do cache são ignorados (`basisSync.ts:468`) e não renderizam nada.
- **Tempos.** Os tempos reais (gatilho, callable, escuta) são inferidos, não medidos no navegador. As sondas usam o relógio manual nos agendadores (agrupamento 50 = 30 s ou 5 s; reposição 10.000 = 10 min) e o relógio real no resto. A máquina estava ocupada pelo `verify:all` do autor durante as execuções.
- **Rodado sem criar arquivo:** os 16 mutantes do autor e os 6 meus (Y1, Y2, Y3, Y4, Y6 e Y8), e as sondas H1, H1x, E10, M1e, T1e, T1b, P2 e PAUSA, por ganchos de carga em memória (com `src/` redirecionado para `snapshot-r9` na comparação).
- **Não rodei** o E2E nem as Rules, que exigem build e Emulator. O `verify:all` final do autor está em curso e não é evidência minha.
- **Impacto.**
  - Nenhum achado novo grava, altera ou expõe dado financeiro.
  - R10-01 atrasa, sem ressalva, um valor certo da estimativa informativa.
  - R10-02 e R10-03 tratam de valores transitórios em caminhos estreitos.
  - R10-04 trata de documentos.
