# P5-F.1 — Revisão independente 11 (somente leitura)

- **Data:** 2026-11-05
- **Objeto:** `snapshot-r11/` (árvore Git `355b4d07`). Junto vieram:
  - `r11-sobre-r10.diff`: mudanças desde a revisão 10 (árvore `46abcd23`), sem os PNG;
  - `revisao-10.md`: R10-01 … R10-04 e os resíduos de R9-01 a R9-04, R8-01, R8-02, R7-01, R6-02, R5-02 e R1-19;
  - as respostas do autor (`snapshot-r11/docs/production/evidence/p5f1/revisoes/respostas-revisao-10.md`);
  - `r10-contra-46abcd23/`, `logs/r10/`, `logs/repeticoes-r10/`, `logs/mutantes-unit-r10*` e `logs/e2e-wt-r10.log`.
- **Contrato de aceite:** `p5f1/spec-original.txt`.
- **Método:** li o código, os testes, os documentos e as fontes do TanStack Query 5.0.0. Conferi cada resposta no código e no teste que ela cita, não pelo texto. Nada exigiu `npm install`, Emulator, build, rede ou Firebase.
  - **Ambiente.** Tudo rodou no snapshot com Node 22.23.4 e `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON`. React 18.2.0, react-test-renderer 18.2.0 e @tanstack/react-query 5.0.0 (query-core 5.0.0) vieram de `wt-p5f1/node_modules`, só para leitura, por ganchos de resolução e de carga em memória (`module.register` com um módulo `data:`, por `--import data:…`). Os mesmos ganchos redirecionam `src/` para `snapshot-r10/src` (árvore `46abcd23`) nas comparações, trocam trechos no módulo carregado (mutantes) e acrescentam testes ao módulo de teste carregado (sondas). Nada é gravado.
  - **Integridade.** Os 2.460 arquivos regulares do snapshot batem com `git --no-optional-locks ls-tree -r 355b4d07` (por `git hash-object --no-filters`, sem `-w`); os 10 restantes são vínculos simbólicos. Os arquivos de código e de teste são os das rodadas finais: o SHA-256 confere com `logs/mutantes-unit-r10-sobreviventes.sha-antes` e com os 45 de `logs/repeticoes-r10.sha-antes`. O teste de sincronização da rodada completa dos mutantes (`p5f1/antes-r10/report-basis-sync.test.ts.antes-sobreviventes`) difere do final só por acréscimos: a parte da leitura que falha no teste do registro e o teste da base única.

  O que rodei:
  1. **Unitários e ganchos.** `test:unit:reports` (100, com os 50 de `report-basis-sync`) e `test:unit:work-time` (100, com os 20 de `work-time-income-estimate`): 2 de 2 execuções de cada conjunto sem falha, com o `verify:all` do autor em curso na máquina. Com as sondas acrescentadas, 51/51 e 21/21.
  2. **Os testes atuais contra o código da revisão 10.** O gancho redirecionou `src/` para `snapshot-r10/src`, com as mesmas adaptações do autor: o esvaziamento do registro de antes (`basisRefreshes.clear()`) no lugar de `clearBasisRegistry`, e o teste do registro novo fora (`--test-skip-pattern`).
     - Sincronização **45/49**. Reprovam os 4 esperados: as duas variantes de H1 e a H1x (tempo esgotado: a estimativa segurada até a releitura da mutação) e o T1b (o mês avulso não é relido na volta).
     - O teste da base única passa lá: ele guarda U153, e não a correção. Os registros do autor (`logs/r10/contra-46abcd23-sync.log`, 44/48) são de antes desse teste.
     - O teste da busca pausada no gancho também passa lá, porque a sonda monta `fetching` com `fetchStatus`, como `execucoes.md:120` registra.
     - Estimativa inteira **18/20**. Reprovam a busca pausada (R$ 35.500,00 na renderização durante a pausa) e o E10 (R$ 35.000,00 no meio).
  3. **Mutantes em memória.** Um gancho de carga troca o trecho no módulo carregado; uma marca na saída prova cada troca.
     - **Lista.** Saiu de `mutantes.py.txt` por `ast`, sem executar o roteiro. O SHA-256 é o de `p5f1/mutantes.py` (`12539050…`). Também conferem `atualizar-mutantes-r10.py` (`85a35ce7…`), `escrever-mutantes-md.py` (`08904fe1…`) e `gerar-tabela-mutantes.py` (`7f609d81…`).
     - **Nenhum mutante ficou aplicado.** Os 195 trechos (184 de unidade e 11 de Rules) aparecem uma vez cada no snapshot.
     - **16 do autor** (U152, U153, U160, U161, U168, U169 e U175–U184): **16/16 mortos**, todos por teste de comportamento. U183 (a releitura na volta mesmo com a base em leitura) morre só pela asserção nova do T1, de uma leitura só na volta (`report-basis-sync.test.ts:1510`).
     - **1 meu**, Z1: a condição da volta pela ordem do registro, no lugar de `fetchStatus` (ver R11-01). Passa os 50 testes de gancho e os 20 da estimativa inteira, inclusive a asserção do T1, e corrige P1 e P1e. A guarda (`work-time-guard.test.ts:390`) fixa a condição atual e reprovaria, como deve.
  4. **Sondas**, como testes acrescentados em memória aos módulos de teste, com React Query real, a API em memória e o relógio manual só nos agendadores. Comparei com `46abcd23` quando faz sentido:
     - H1e: a sincronização com uma mutação nesta aba no meio e o orçamento da mutação gasto (o cenário de R10-01), na estimativa inteira;
     - P1 e P1e: a volta a 12 meses antes de a leitura em curso do mês avulso chegar;
     - P3 e P3e: a nova tentativa depois de uma falha, com e sem receita desconsiderada;
     - P4: o T1b com a série relida enquanto o mês avulso está fora de uso.

  Nenhum arquivo foi criado nem alterado além deste parecer. A única exceção é do próprio ambiente: um `grep` meu, mal redirecionado, foi posto em segundo plano e interrompido, e a ferramenta deixou o registro dele (`tasks/b15b09eio.output`, 10 bytes, "[killed]") no diretório de tarefas da sessão, fora de `review/`, do snapshot e do worktree. A impressão SHA-256 de caminho, tamanho e data dos arquivos do snapshot ficou igual antes e depois (`9338b3c1…`), e `review/` só ganhou este arquivo. No worktree `wt-p5f1`, só li `node_modules` e objetos do Git (`ls-tree`, `cat-file`, `hash-object` sem `-w`, `status`, sempre com `--no-optional-locks`). Li os registros do autor em `p5f1/logs/` só para leitura. Quando uma conclusão depende do TanStack Query 5.0.0, do React 18.2 ou do SDK Firebase 12.8, isso está dito.

## Escopo revisado

- **Código e testes do `r11-sobre-r10.diff`:**
  - `src/modules/reports/{basisRegistry,basisSync}.ts` e `src/modules/work-time/useIncomeEstimateWith.ts`;
  - `tests/unit/{report-basis-sync,work-time-income-estimate,work-time-guard}.test.ts`.
- **Documentos do diff:**
  - plano §20.15: `:4764`, `:4779-4781`, `:4802`, riscos `:4814`, estado `:4834`;
  - `DATA_MODEL.md:277`;
  - `evidence/p5f1/`: LEIAME, VEREDITOS, autorização, elegibilidade, execuções, mutantes e roteiros, a nota em `respostas-revisao-9.md`, `respostas-revisao-10.md` e a cópia de `revisao-10.md` (igual à original).
- **Contexto fora do diff:**
  - `src/modules/reports/{liveRefresh,basisRefresh,queryKeys}.ts`, `src/modules/transactions/incomeReads.ts`, `src/modules/work-time/useIncomeEstimate.ts`, `src/components/WorkTimeSettingsView.tsx:176-184` (a prévia usa o rascunho), `src/contexts/AuthContext.tsx:75`, `:111` e `src/App.tsx:116-123`;
  - `@tanstack/query-core` 5.0.0 (`build/modern/{query,queryObserver,queryCache,retryer,onlineManager,focusManager}.js`) e `@tanstack/react-query` 5.0.0 (`build/modern/useBaseQuery.js`).

Linhas do plano referem-se a `docs/production/PRODUCTION_READINESS_PLAN.md` do snapshot.

## Resumo

| Situação dos achados da revisão 10 | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 1 | R10-01 |
| CORRIGIDO no caso novo; o resto ACEITO COMO RISCO DOCUMENTADO | 1 | R10-02 |
| CORRIGIDO em parte | 1 | R10-03 (a pausa, corrigida; a base que sai no meio de uma leitura, com resíduo em R11-01 e R11-02) |
| CORRIGIDO, com resíduo de texto | 1 | R10-04 (R11-03) |

| Resíduos listados | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 3 | R9-01, R9-04 (contagens em R11-03), R5-02 |
| CORRIGIDO nos cenários apontados, com resíduo | 5 | R9-02 (R11-01), R8-01 (R11-02, anterior a esta rodada), R9-03, R7-01 e R6-02 (riscos registrados) |
| ACEITO COMO RISCO DOCUMENTADO | 2 | R8-02, R1-19 |

| Achados novos | Qtde | IDs |
| --- | --- | --- |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 0 | — |
| INFO | 3 | R11-01, R11-02, R11-03 |

Não há achado HIGH, MEDIUM nem LOW. As correções resolvem o que a revisão 10 apontou, com prova de comportamento:

- **R10-01.** A regra "à frente" solta as bases em passo: com uma mutação nesta aba no meio da sincronização, a estimativa mostra o valor sincronizado na hora, também com o orçamento da mutação gasto (H1e: R$ 36.500,00; em `46abcd23`, R$ 36.000,00 até a reposição). Os casos de espera de verdade continuam segurados.
- **R10-02.** O caso novo (a base nova com a exclusão antiga, com as entradas trocadas durante a retenção longa) saiu com R10-01. O resto está nos riscos, com texto fiel.
- **R10-03.** A busca pausada conta como leitura e renderiza. A base que sai no meio de uma leitura, com outro pedido durante ela, é relida na volta quando essa leitura chega antes da volta.
- **R10-04.** As contagens e as frases apontadas foram corrigidas.

Os achados novos:

- **R11-01 (INFO).** Se a volta acontece antes de a leitura de antes da saída chegar, a marca é consumida e nada é agendado: `fetchStatus` não distingue essa leitura da leitura na hora da troca de chave. O pedido feito durante ela se perde. A escuta reaberta na volta costuma corrigir; persiste com ela falhando de novo (com a ressalva). O mutante U183, que corrigiria o caso, é morto só pela asserção de eficiência do T1; uma condição pela ordem (Z1) passa os 70 testes de comportamento e corrige.
- **R11-02 (INFO).** A retenção das bases fora de passo só começa no efeito que agenda a releitura da base atrás. Sem receita desconsiderada, a renderização em que a releitura de uma base desatualizada falha mostra só a outra base nova. Esse estado é guardado e mostrado, com a ressalva, durante a nova tentativa. A volta da base marcada tem a mesma janela de uma renderização. Já era assim em `46abcd23`, mas os documentos dizem que a nova tentativa segura.
- **R11-03 (INFO).** Duas contagens antigas nas respostas, "dois testes novos" onde entrou um teste e meio, e dois textos menores.

O isolamento por titular e por workspace continua correto. Nada derivado é gravado, e a estimativa segue sem autoridade financeira.

## 1. Situação dos achados da revisão 10

| ID | Sev. original | Situação | Evidência (snapshot-r11) | O que falta |
| --- | --- | --- | --- | --- |
| R10-01 | LOW | CORRIGIDO | (1) **Regra.** `basesOutOfStep` (`basisRegistry.ts:140-145`) compara o primeiro pedido aberto de cada base (`openRequests`, `:60`, `:65-71`) com o começo da leitura cujos dados a outra mostra. Esse começo (`servedReadStartedAt`) só é anotado com dados e só se nenhuma leitura começou depois (`:85-91`; `basisSync.ts:137-143`). `outOfStep` usa `basis.fetching \|\| basesOutOfStep(basis.keys)` (`basisSync.ts:550-551`). (2) **Testes.** H1 com e sem receita desconsiderada (`report-basis-sync.test.ts:1219-1254`) e H1x (`:1256`) reprovam contra `46abcd23` (tempo esgotado) e passam aqui. O teste do registro (`:728-787`) cobre a leitura cancelada por outra, a que falha e a base sem releitura pendente. (3) **Sonda H1e** (estimativa inteira, orçamento da mutação 1, escuta viva): R$ 36.500,00 logo depois da sincronização e depois da reposição; em `46abcd23`, R$ 36.000,00 até a reposição. (4) **Mutantes.** U175–U180 mortos. (5) **Texto.** "Sem mudança nos dados, segurar não muda o que é mostrado" saiu do código e do plano | A corrida do gatilho entre as duas leituras paralelas ficou nos riscos (`:4814`), com texto fiel (ver "Verificado", 7) |
| R10-02 | INFO | CORRIGIDO no caso novo; o resto ACEITO COMO RISCO DOCUMENTADO | O E10 (`work-time-income-estimate.test.ts:782`) mostra só R$ 35.500,00 depois da troca do calendário e reprova contra `46abcd23` (R$ 35.000,00 no meio). O risco (`:4814`) cita a estimativa montada durante a espera, a de entradas trocadas (outro calendário, a volta a 12 meses) e a base com as exclusões anteriores até a leitura por id | — |
| R10-03 | INFO | (1) CORRIGIDO; (2) CORRIGIDO em parte | (1) **Pausa.** `fetching` é `fetchStatus !== 'idle'`, com `fetchStatus` nas dependências da memória da base (`useIncomeEstimateWith.ts:153`, `:155`). Lido assim, ele notifica a passagem a `paused` (só as propriedades lidas notificam, `queryObserver.js:346-366`, TanStack 5.0.0), e qualquer renderização durante a pausa segura. O teste da estimativa inteira (`work-time-income-estimate.test.ts:736`) reprova contra `46abcd23` (R$ 35.500,00). U184 morto; guarda `work-time-guard.test.ts:413-416`. (2) **Saída no meio de uma leitura.** A saída com releitura pendente marca e desatualiza (`basisSync.ts:195-198`); a volta relê pelo agendador se a consulta está parada (`:182-185`). O T1b (`report-basis-sync.test.ts:1275`) reprova contra `46abcd23`. U181–U183 mortos. O T1 ganhou a asserção de uma leitura só na volta (`:1509-1510`) | (2) Com a volta antes de a leitura de antes da saída chegar, a marca é consumida sem releitura (R11-01). A primeira renderização da volta ainda não segura (R11-02) |
| R10-04 | INFO | CORRIGIDO, com resíduo de texto | O VEREDITOS diz 50 nas duas linhas (`:49`, `:60`). O diagnóstico (`execucoes.md:112`) diz que o estado vem da reprodução e que o mesmo milissegundo é um efeito dos testes. Há uma nota em `respostas-revisao-9.md:32`, e as frases foram reescritas | `respostas-revisao-10.md:25` diz que o VEREDITOS tem 49, e a nota de `respostas-revisao-9.md:32` diz 100 e 99, com 49 (R11-03) |
| R9-01 | LOW | CORRIGIDO; o efeito colateral (R10-01) também | Ver R10-01. Os 4 testes do orçamento (`report-basis-sync.test.ts:1130-1146`) e o N1e (`work-time-income-estimate.test.ts:698`) continuam passando | — |
| R9-02 | INFO | CORRIGIDO no gancho; T1b corrigido em parte; T1e nos riscos | C1 (`report-basis-sync.test.ts:1437`) e T1 (`:1476`) passam; T1b, ver R10-03 | R11-01; R11-02 (a volta) |
| R9-03 | LOW | CORRIGIDO; o caso novo de R10-02 saiu; o resto nos riscos | E10; risco `:4814` | — |
| R9-04 | INFO | CORRIGIDO; resíduo de contagem | Ver R10-04 | R11-03 |
| R8-01 | LOW | CORRIGIDO nos cenários apontados; resíduo anterior a esta rodada | A mutação adiada pelo orçamento segura com e sem receita desconsiderada, com a escuta viva e encerrada (`:1130-1146`); a nova tentativa depois de uma falha, com receita desconsiderada (`:1168`) | Sem receita desconsiderada, a renderização da falha mostra só uma base nova, e esse estado é mostrado durante a nova tentativa (R11-02; igual em `46abcd23`) |
| R8-02 | INFO | ACEITO COMO RISCO DOCUMENTADO | Sem mudança (`:4812`) | — |
| R7-01 | LOW | CORRIGIDO nos cenários apontados; resíduos nos riscos | Ver R10-02 | — |
| R6-02 | LOW | CORRIGIDO nos cenários apontados; resíduos nos riscos | A base nova com a exclusão antiga na retenção longa saiu (E10) | — |
| R5-02 | LOW | CORRIGIDO | A pausa sem rede, que restava, ver R10-03 (1) | — |
| R1-19 | INFO | ACEITO COMO RISCO DOCUMENTADO | Sem mudança (`:4825`); `Header.tsx` fora do diff | — |

## 2. Achados novos

### R11-01 — INFO: a base que volta a ser usada enquanto a leitura de antes da saída ainda está em curso perde a marca e não é relida; o pedido feito durante essa leitura se perde (resíduo de R10-03)

**Local:**
- `src/modules/reports/basisSync.ts`:
  - `:182`: `takeRereadOnReturn(refreshKey) && entry.loaded() && (… fetchStatus ?? 'idle') === 'idle'`. A marca é consumida primeiro; "em leitura" não distingue a leitura na hora da troca de chave da leitura de antes da saída;
  - `:179-181`: "Sem marca, ou já em leitura (a chave trocada lê a desatualizada na hora), nada muda";
  - `:195-198`: a marca na saída.
- TanStack Query 5.0.0:
  - `queryObserver.js:96-106`, `:418-420`: na troca de chave, a consulta desatualizada é buscada por `#executeFetch()`, sem `cancelRefetch`;
  - `query.js:121-129`: com uma busca em curso e sem `cancelRefetch`, devolve a promessa em curso: nenhuma leitura nova começa;
  - `query.js:97-108`: sem observadores, a busca em curso continua (`cancelRetry`, porque a `queryFn` não lê o `signal`);
  - `query.js:291-305`: o sucesso dela zera `isInvalidated`.
- **Testes:**
  - o T1b espera a leitura em curso chegar antes de voltar (`report-basis-sync.test.ts:1297-1298`: `settle(250)` com 150 ms de atraso);
  - U183, que relê também com a base em leitura e corrigiria este caso, só é morto pela asserção de eficiência do T1 (`:1510`);
  - a guarda fixa a condição (`work-time-guard.test.ts:390`).
- **Documentos:**
  - plano `:4764` ("é relida quando volta, mesmo que a leitura em curso na saída termine depois") e `:4802`;
  - `basisSync.ts:320-322`, `DATA_MODEL.md:277`, `VEREDITOS.md:45` e `:76`, `elegibilidade-receitas.md:50` e `autorizacao-isolamento.md:42`;
  - `respostas-revisao-10.md:24` (R10-03, item 2: "se ninguém a está lendo").

**O que acontece.**
1. **Um pedido durante a leitura.** Uma leitura do mês avulso começa (ordem s). Durante ela chega outro pedido (r > s): uma mutação nesta aba, a virada do mês, a nova tentativa ou a escuta.
2. **A saída.** A janela sai de 12 meses. A limpeza vê o pedido posterior ao começo da leitura, desatualiza a base e a marca. A leitura continua sem observadores.
3. **A volta antes de a leitura chegar.**
   - Na troca de chave, a consulta desatualizada é buscada, mas a busca em curso é devolvida: nenhuma leitura nova começa.
   - No efeito do registro, `takeRereadOnReturn` consome a marca. Como `fetchStatus` é `fetching`, nada é agendado.
4. **A chegada.** A leitura chega com o estado de antes de r e zera `isInvalidated`. O pedido r continua em `openRequests`, mas a base não tem releitura pendente: `basesOutOfStep` não segura, e o efeito das falhas não relê (a base não está desatualizada).
5. **O estado misto.** A releitura de r da série, que ficou em uso, chega. A estimativa mostra a série depois de r com o mês avulso de antes dele, sem retenção, até outro sinal.
6. **Mesma causa noutro caminho.** A volta por uma estimativa que monta durante a leitura de antes tem o mesmo efeito: `fetchStatus` também não é `idle`.
7. **Origem.** Em `46abcd23`, sem a marca, o resultado era o mesmo (P1). Não é regressão: é o caso de R10-03 que a correção não alcançou.

**Atenuação.**
- A volta muda a janela ou o `enabled` da estimativa, e a escuta dela é reaberta (`basisSync.ts:481`, `:509`); ou é uma estimativa que monta, com escuta própria.
- No produto, o primeiro retorno do servidor a essa escuta compara as bases com a projeção. Se a projeção já tiver a mudança, ele pede as duas bases; se o gatilho gravar depois, o retorno seguinte pede.
- O caso persiste quando a escuta reaberta não responde (encerrada de novo, com a ressalva) ou quando a mudança não aparece na receita das projeções (a reconstrução marcada).
- O dublê da escuta não entrega retorno na reabertura. Por isso o caso persiste nas sondas, como no T1b.

**Cenário concreto (P1e):**
- 12 meses, R$ 3.000,00 por mês, sem receita desconsiderada. A escuta está encerrada e, reaberta na volta, falha de novo.
- Uma despesa nesta aba: as duas bases são relidas, e a do mês avulso demora.
- Durante essa leitura, outra mutação nesta aba move R$ 500,00 de nov/2025 para out/2026. O gatilho grava depois da leitura em curso.
- A pessoa troca a janela para 3 meses e volta a 12 antes de a leitura do mês avulso chegar.
- A série relida pela segunda mutação traz out/2026 com R$ 3.500,00. O mês avulso fica em R$ 3.000,00, quando deveria estar em R$ 2.500,00.
- A estimativa mostra R$ 36.500,00 em vez de R$ 36.000,00, com a ressalva da escuta e sem retenção, até outro sinal.
- Na sonda, a escuta reaberta do dublê fica muda sem falhar: o valor é o mesmo, sem a ressalva.

**Sondas** (relógio manual nos agendadores):

| Sonda | Situação | Resultado |
| --- | --- | --- |
| P1 (gancho) | O T1b, com a volta 30 ms depois da saída e a leitura em curso do mês avulso levando 300 ms | Atual e `46abcd23`: `monthCalls` fica em 2; o mês avulso fica em 40.000 (deveria ser 30.000), com out/2026 em 110.000; `holding` falso; 1 renderização livre mista. Com Z1: 3 chamadas, 30.000 e 0 renderização mista |
| P1e (estimativa inteira) | O cenário acima | Atual: R$ 36.500,00 (nov/2025 R$ 3.000,00; out/2026 R$ 3.500,00), `monthCalls` 2. Com Z1: R$ 36.000,00, `monthCalls` 3 |

**Correção sugerida:**
- **Decidir a volta pela ordem, e não por `fetchStatus`.** Agendar quando o último pedido aberto da base é posterior ao começo da última leitura (`readStartedAt`):
  - a leitura na hora da troca de chave começa no efeito de `setOptions` (`useBaseQuery.js:43-45`), que roda antes do efeito do registro no mesmo componente, e por isso já conta;
  - a leitura de antes da saída começou antes do pedido, e por isso não conta;
  - sem rede, a leitura na hora fica pausada antes da `queryFn`, e a volta agendaria mais uma. Isso é aceitável, ou basta somar `fetchStatus === 'paused'`.
- **Z1 prova a troca.** Feita em memória, ela passa os 50 testes de gancho e os 20 da estimativa inteira e corrige P1 e P1e. A guarda precisa acompanhar.
- **Teste:** o T1b com a volta antes de a leitura em curso chegar.
- **Ou** registrar o caso nos riscos e ajustar as frases citadas.

### R11-02 — INFO: a retenção das bases fora de passo só começa no efeito que agenda a releitura da base atrás; sem receita desconsiderada, a renderização em que a releitura de uma base desatualizada falha (e a primeira da volta da base marcada) mostra só uma base nova, e esse estado é guardado e mostrado durante a espera

**Local:**
- `src/modules/reports/basisRegistry.ts:114-117` e `:140-145`: a base atrás só conta se tem releitura pendente nos agendadores (`scheduled()`).
- `src/modules/reports/basisSync.ts`:
  - `:207-221`: a nova tentativa depois de uma falha é agendada no efeito das falhas (`:220`), depois da renderização que mostra a falha;
  - `:179-185`: na volta, a base marcada é agendada no efeito do registro, depois da primeira renderização;
  - `:550-551`: `outOfStep` é lido na renderização.
- `src/modules/work-time/useIncomeEstimateWith.ts:112`: o estado de uma renderização sem retenção é guardado; na retenção seguinte, é ele que aparece (`:106-110`).
- **Testes:** o teste da nova tentativa (`report-basis-sync.test.ts:1168`) só roda com receita desconsiderada, o padrão de `mount`. Nesse caso, `ahead` e `readsBehind` cobrem a renderização da falha.
- **Documentos:**
  - plano `:4764` e `basisSync.ts:314-316`: "a nova tentativa agendada depois de uma falha, segura a base nova da outra até chegar";
  - `VEREDITOS.md:45` e `elegibilidade-receitas.md:50`;
  - `respostas-revisao-10.md:22` ("Continuam segurados […] a nova tentativa depois de uma falha") e `:24` ("Durante essa espera, a ordem guardada segura a outra base que esteja à frente").

**O que acontece.**
1. **A falha.** Uma base desatualizada é relida, e a releitura falha, com a nova tentativa interna do React Query. A outra base chegou nova durante essa leitura, e `fetching` segurava.
2. **A renderização da falha.** Nela, `fetching` já é falso, e a base que falhou ainda não tem releitura pendente: o efeito das falhas só a agenda depois. `basesOutOfStep` é falso.
3. **Nada mais segura.** Sem receita desconsiderada, a renderização mostra só uma base nova, e `holdEstimate` a guarda como a última estimativa.
4. **A retenção mostra o estado misto.** O efeito agenda a nova tentativa, e a estimativa passa a segurar. O que ela mostra é o estado guardado, misto, com a ressalva da falha, até a nova tentativa chegar: os 5 s do agrupamento mais a leitura, ou até 2 min com o orçamento da escuta gasto. Se a nova tentativa também falhar, a base chega ao teto, que libera com a ressalva, como registrado.
5. **A volta da base marcada (P4).**
   - A série relida enquanto o mês avulso estava fora de uso fica à frente.
   - Na primeira renderização da volta, o mês avulso ainda não está registrado, nem pendente. Também não é lido na hora, porque a leitura em curso na saída o deixou novo.
   - Resultado: uma renderização livre com só a série nova.
   - Na troca da janela, as entradas mudam, e o risco registrado já cobre o caso (`:4814`). Com as mesmas entradas (a estimativa religada), o estado misto é guardado e mostrado durante a espera.
6. **Quando acontece.** Com uma releitura pedida pela escuta, `syncing` segura até as bases chegarem. O caso precisa de um sinal sem pedido da escuta: a volta, a virada do mês sem troca do mês avulso ou o "Tentar de novo" com uma base já desatualizada.
7. **Origem.** Em `46abcd23`, P3 e P3e dão o mesmo resultado: o caso vem da retenção na renderização da revisão 9, e não desta rodada. Ele não tinha sido apontado.

**Cenário concreto (P3e):**
- 12 meses, R$ 3.000,00 por mês, sem receita desconsiderada. R$ 500,00 passam de nov/2025 para out/2026.
- As duas bases são relidas (na sonda, pela virada do mês). A série chega nova, e o mês avulso falha duas vezes.
- A estimativa sai de R$ 36.000,00 para R$ 36.500,00 (out/2026 nova, nov/2025 antiga), com a ressalva.
- Fica assim durante a nova tentativa e volta a R$ 36.000,00 quando o mês avulso chega.

**Sondas:**

| Sonda | Situação | Resultado |
| --- | --- | --- |
| P3 (gancho) | A nova tentativa do mês avulso depois de uma falha (o teste `:1168`), com e sem receita desconsiderada | Com: nenhuma renderização livre mista. Sem: 1 renderização livre mista, e `holding` continua falso até a nova tentativa sair. Igual em `46abcd23` |
| P3e (estimativa inteira) | O cenário acima | 3.600.000 → 3.650.000 (com a ressalva); durante a nova tentativa, 3.650.000; depois, 3.600.000. Igual em `46abcd23` |
| P4 (gancho) | O T1b com a série relida pela 2ª mutação enquanto o mês avulso está fora de uso | Sem receita desconsiderada: 1 renderização livre na volta (40.000 com out/2026 em 110.000), depois `holding`. Com: nenhuma |

**Correção sugerida:**
- Contar como "vai ser relida" também o que o efeito vai agendar:
  - a base marcada que volta (a marca ainda está no registro na primeira renderização);
  - a base desatualizada, abaixo do teto, cuja última leitura falhou.
- Ou agendar a nova tentativa fora do efeito.
- Teste: o da nova tentativa (`:1168`) também sem receita desconsiderada, com `halfway()`.
- Ou registrar o caso nos riscos e ajustar as frases citadas.

### R11-03 — INFO: contagens antigas nas respostas, "dois testes novos" onde entrou um teste e meio, e dois textos menores

**Local e o que diz:**
1. **`respostas-revisao-10.md:25`** (R10-04, item 1): "`VEREDITOS.md` diz 49 testes de gancho nas duas linhas". O VEREDITOS (`:49`, `:60`) diz 50, como a suíte.
2. **`respostas-revisao-9.md:32`** (a nota da revisão 10): "o plano diz 100 e 99, com 49 testes de gancho e 20 da estimativa inteira". O plano (`:4779`) diz 100 e 100, com 50 e 20, o que medi. A nota é anterior ao teste da base única.
3. **"Dois testes novos"** para U153 e U176 (`mutantes.md:13`, `:38`; `execucoes.md:119`, `:124`). Entrou um teste (`report-basis-sync.test.ts:1306`); o outro é a parte nova do teste do registro (`:778-786`). Por isso a suíte foi de 49 para 50.
4. **Frases cobertas por R11-01 e R11-02**, listadas lá.
5. **Menores:**
   - `LEIAME.md:25` põe `atualizar-mutantes-r10.py.txt` entre "os trechos atualizados e os mutantes novos das rodadas das revisões 4 a 9";
   - o comentário da guarda (`work-time-guard.test.ts:382-385`) ainda descreve a regra anterior: "alguma em leitura ou com releitura pendente pedida depois do começo da última leitura dela".

**Correção sugerida:** ajustar os textos.

## 3. Verificado sem achado

1. **Testes, guarda e mutantes.**
   - Os 200 testes (100 + 100) passam em 2 de 2 execuções de cada conjunto. As repetições do autor (`logs/repeticoes-r10/`) têm 30 × 100 e 30 × 100, todas com `# fail 0`, e o mesmo SHA-256 dos 45 arquivos antes e depois.
   - Contra `46abcd23`, reprovam os 6 esperados (4 da sincronização e 2 da estimativa inteira), pelos motivos registrados.
   - **Nada foi enfraquecido:**
     - asserções: de 178 para 184 na guarda, de 126 para 149 em `report-basis-sync` e de 63 para 69 em `work-time-income-estimate`;
     - cada expressão trocada na guarda deu lugar à da regra nova, por inteiro: o registro (`work-time-guard.test.ts:343-350`), a `queryFn`, a limpeza, a volta e `outOfStep` (`:386-395`), e a estimativa sem `isFetching` (`:413-416`);
     - a sonda do gancho passou a montar `fetching` como o produto;
     - `clearBasisRegistry` isola melhor os casos;
     - não há `skip`, `only` nem `todo`, e os prazos de `until` e `settle` são os mesmos.
   - **Rodadas dos mutantes:** a rodada completa (182/184) e a dos sobreviventes (2/2) rodaram sobre o mesmo código. O teste mudou entre elas só por acréscimos.
   - **E2E:** 15/15 (`logs/e2e-wt-r10.log`), com o `git status` igual antes e depois.
2. **A regra "à frente" segura e solta onde deve** (TanStack Query 5.0.0 e React 18.2):
   - **Segura:**
     - a mutação adiada pelo orçamento de uma base: a outra serve uma leitura posterior ao pedido aberto da primeira, que está pendente;
     - a nova tentativa, com a ressalva de R11-02;
     - C1: a mutação pede as duas bases;
     - a leitura cancelada por outra: a nova começa na hora (`query.js:121-125`; `retryer.js:115-116`), e a cancelada não serve;
     - a nova tentativa interna do React Query: uma chamada nova da `queryFn`, com começo posterior (`retryer.js:77-113`);
     - a pausa (`fetching`).
   - **Solta:**
     - H1, H1x e H1e;
     - o "Tentar de novo": duas leituras sem pedido, posteriores a todos;
     - a base no teto (sem releitura pendente).
   - **A releitura da mutação fora de fase** depois de uma sincronização não segura: a releitura da escuta já cobriu o pedido da mutação nas duas bases.
   - **C1 com a escuta da janela de 12 meses encerrada:** o retorno do servidor à escuta da outra estimativa a reabre (`basisSync.ts:489`; `basisRegistry.ts:214-219`). A comparação dela pede as duas bases antes de a série chegar.
3. **A leitura servida corresponde aos dados mostrados:**
   - a cancelada por outra não é anotada (`readStartedAt` muda);
   - a dividida é uma leitura só;
   - a que termina sem observadores guarda os dados (`query.js:101-106`) e é anotada;
   - a que falha não é anotada;
   - a que volta do cache coletado é uma consulta nova, com leitura nova.
   - **Logout.** `queryClient.clear()` (`AuthContext.tsx:75`) descarta uma leitura em curso (`queryCache.js:39-49`, `query.js:58-61`). O registro ainda pode anotá-la como servida, mas sem efeito: a base recarrega, e até lá `basis` é nulo.
4. **A ordem que fica depois da saída:**
   - **Retenção justificada.** A base que volta só fica "atrás" com releitura pendente, e essa espera tem fim (agendador, teto). Como "à frente", ela usa a leitura dos dados que ainda mostra.
   - **Pedidos só para bases em uso.** Pedidos só vão para bases registradas (`basisRegistry.ts:37-43`, `:106-111`; `basisSync.ts:184`, `:220`). A lista de uma base fora de uso não cresce.
   - **Tamanho.** Cada leitura com dados limpa a lista. As chaves ficam na sessão (não há limpeza no produto): são números por uid, workspace, período e seções, como `serverSnapshots` já era. Nenhum valor financeiro fica guardado.
5. **A releitura na volta:**
   - acontece uma vez: o T1 tem uma leitura só; na estimativa nova com `refetchOnMount: false`, os pedidos se juntam no mesmo agendador;
   - cabe no orçamento novo do registro;
   - não acontece no teto nem na base que nunca carregou: nenhuma das duas é marcada;
   - com o cache coletado, a marca é consumida sem ação, e a base carrega;
   - a exceção é R11-01.
6. **A busca pausada:**
   - **Sem rede.** A busca nasce `paused` (`query.js:285`) e continua na volta da rede (`query.js:85-89`).
   - **Aba oculta.** Na nova tentativa interna, a pausa também acontece com a aba oculta (`retryer.js:43`, `:101-104`) e continua no foco (`query.js:80-84`). A espera dura até a aba voltar, sem que ninguém a veja. Os documentos falam só da rede.
   - **Liberação das leituras dependentes.** `followReads` espera a pausa, com o mesmo resultado de antes: a leitura por id ficaria pausada também.
   - **Efeito das falhas.** Continua com `isFetching` (`basisSync.ts:206-208`). A pausa não muda as dependências dele, e nada é pedido de novo.
   - **Uma base só, outras telas.** A estimativa de uma base só não é segurada por `outOfStep`, e nenhuma outra tela lê `BasisView`.
7. **A corrida que a regra não vê.**
   - O risco (`:4814`) descreve bem o caso da escuta encerrada: as duas bases ficam em passo pela ordem, com só uma nova, até a releitura da mutação, por até 10 min com o orçamento gasto (a retenção dessa releitura mostra o estado guardado).
   - Com a escuta viva, o retorno com a gravação pede as duas bases, e `syncing` segura até elas. O estado misto que já tiver aparecido entre a chegada e o retorno fica durante essa sincronização: segundos, a classe do risco de escrita no meio de uma sincronização (`:4811`).
8. **Isolamento e superfície.**
   - O diff não toca Rules, índices, Functions, interface nem textos visíveis.
   - O registro usa a chave da base, e `basesOutOfStep` só olha as chaves da estimativa.
   - Nada é gravado.
9. **Plano.**
   - O §20.15 continua "AGUARDANDO AUDITORIA INDEPENDENTE" (`:4834`), sem marcar o gate da P5 nem P6–P10.
   - A cópia de `revisao-10.md` é igual à original.
   - Os marcadores `⟦…⟧` são preenchidos depois do gate e não foram avaliados.

## Notas

- **TanStack Query 5.0.0** (`wt-p5f1/node_modules/@tanstack/query-core/build/modern`):
  - **`setOptions`.** Busca na troca de chave sem `cancelRefetch` (`queryObserver.js:96-106`). `fetch` com uma busca em curso e sem `cancelRefetch` devolve a promessa em curso (`query.js:121-129`); com `cancelRefetch` e dados, cancela em silêncio e começa outra (`:122-124`).
  - **Resultado otimista.** O da renderização já marca `fetching` quando a troca de chave vai buscar (`queryObserver.js:236-247`). Por isso a volta de uma base desatualizada é segurada na primeira renderização, e a de uma base que não está desatualizada, não (R11-02).
  - **`queryFn` síncrona.** Ela é chamada na hora em que a busca começa, se puder buscar (`retryer.js:115-119`). A nova tentativa chama a `queryFn` de novo (`:77-113`) e pausa com a aba oculta ou sem rede (`:43`, `:101-104`).
  - **Sem observadores.** A busca em curso continua se a `queryFn` não leu o `signal` (`query.js:97-108`), e o sucesso zera `isInvalidated` (`:298`).
  - **Notificação.** Só as propriedades lidas notificam (`queryObserver.js:346-366`), e `fetchStatus` lido notifica a pausa.
- **React 18.2:**
  - os efeitos passivos de um componente rodam na ordem de declaração: o de `setOptions` (`useBaseQuery.js:43-45`) vem antes do efeito do registro;
  - os efeitos rodam depois da renderização que mostra a mudança (R11-02);
  - o `TestRenderer.create` dos testes e das sondas usa a raiz legada.
- **SDK Firebase 12.8:** sem mudança nesta rodada. A reabertura da escuta na volta (R11-01) é a mesma `onSnapshot` de antes.
- **Tempos.** Os tempos reais (callable, gatilho, escuta) são inferidos, não medidos no navegador. As sondas usam o relógio manual nos agendadores (agrupamento 50 = 5 s ou 30 s) e o relógio real no resto. A máquina estava ocupada pelo `verify:all` do autor durante as execuções.
- **Rodado sem criar arquivo:**
  - os 16 mutantes do autor e o Z1;
  - as sondas H1e, P1, P1e, P3, P3e e P4;
  - os testes atuais contra `46abcd23`;
  - tudo por ganchos de carga em memória, com o código no módulo carregado e o roteiro em variável de ambiente.
- **Não rodei** o E2E, as Rules nem o `tsc`, que exigem build, Emulator ou escrita de cache de compilação. O `verify:all` final do autor está em curso e não é evidência minha.
- **Impacto.**
  - Nenhum achado novo grava, altera ou expõe dado financeiro, nem passa de um workspace para outro.
  - R11-01 e R11-02 tratam de valores transitórios da estimativa informativa, em caminhos estreitos, quase sempre com a ressalva da falha ou da escuta encerrada.
  - R11-03 trata de documentos.
