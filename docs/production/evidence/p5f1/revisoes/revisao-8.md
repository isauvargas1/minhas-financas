# P5-F.1 — Revisão independente 8 (somente leitura)

- **Data:** 2026-11-05
- **Objeto:** `snapshot-r8/` (árvore Git `16cda725`). Junto vieram `r8-sobre-r7.diff` (mudanças desde a revisão 7, árvore `167c2893`, sem os PNG), `revisao-7.md` (R7-01 … R7-03 e os resíduos R6-02, R5-02 e R1-19) e as respostas do autor (`snapshot-r8/docs/production/evidence/p5f1/revisoes/respostas-revisao-7.md`).
- **Contrato de aceite:** `p5f1/spec-original.txt`.
- **Método:** li o código, os testes, os documentos e as fontes do TanStack Query 5.0.0. Conferi cada resposta no código e no teste que ela cita, não pelo texto. Nada exigiu `npm install`, Emulator, build, rede ou Firebase. Tudo rodou no snapshot com Node 22.23.4 e `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test`. React 18.2.0, react-test-renderer 18.2.0 e @tanstack/react-query 5.0.0 vieram de `wt-p5f1/node_modules`, só para leitura, por um gancho de resolução em memória (`--import data:…`). O que rodei:
  1. **Unitários e ganchos.** `test:unit:reports` (78, com os 29 de `report-basis-sync` e os 5 de `report-basis-refresh`) e `test:unit:work-time` (92, com os 12 de `work-time-income-estimate`): 6 de 6 execuções de cada conjunto sem falha (uma e depois cinco alternadas), com o `verify:all` final do autor em curso na máquina.
  2. **Os testes novos contra o código da revisão 7.** `src/` foi redirecionado para `snapshot-r7/src/` pelo mesmo gancho. Os 5 testes novos de comportamento reprovam, todos por tempo esgotado na espera que depende da correção, e os 36 anteriores passam. `report-basis-refresh` nem carrega lá, porque `sameIncome` não existia.
  3. **Mutantes em memória.** Um gancho de carga troca o trecho no módulo carregado, e um invólucro de `fs.readFileSync` (com `syncBuiltinESMExports`) troca o mesmo trecho no que a guarda lê. Uma marca no stderr prova cada troca, e nada é gravado.
     - Os 151 de `mutantes.py.txt`, com o mesmo SHA-256 de `p5f1/mutantes.py` (`f559ddcc…`). Extraí a lista com `ast`, sem executar o roteiro, e conferi que cada trecho aparece uma vez.
     - Cada `.ts` mutado passou por `module.stripTypeScriptTypes` e `vm.SourceTextModule`, em memória: 146 compilam. Os outros 5 (`firestore.rules` e três `.tsx`) a guarda lê como texto.
     - **151/151 mortos** (777 s): 134 pela carga do módulo e 17 só pelo texto da guarda.
     - Rodei também 9 mutantes meus sobre o código novo (R8-03).
  4. **Sondas**, como testes acrescentados em memória aos módulos de teste, com React Query real e a API em memória. Para cada uma, comparei com `snapshot-r7`:
     - E1 e E1b: o mês avulso que entra na janela;
     - P1 e P1b: a janela de 12 meses com o orçamento de uma base gasto, com a escuta viva e encerrada;
     - P2: receita do mês corrente;
     - P3: duas estimativas, retornos sem mudança e divergência persistente;
     - P4, P4b e E3: o mês avulso que falha, também com um mutante;
     - A3 a A3d: a prévia maior montada depois.

  Nenhum arquivo do snapshot mudou: a impressão SHA-256 de caminho, tamanho e data dos 2.450 arquivos ficou igual antes e depois (`19d32841…`). Em `snapshot-r7`, só rodei testes. No worktree `wt-p5f1`, só li `node_modules`. Li os registros do autor em `p5f1/logs/`, só para leitura. Quando uma conclusão depende do TanStack Query 5.0.0, do React 18.2 ou do SDK Firebase 12.8.0, isso está dito. Há um registro de procedimento nas Notas (arquivo temporário criado e apagado por engano em `review/`).

## Escopo revisado

- **Código e testes do `r8-sobre-r7.diff`:**
  - `src/modules/reports/{basisSync,basisRegistry,basisRefresh}.ts` e `src/modules/work-time/useIncomeEstimateWith.ts`;
  - `tests/unit/{report-basis-sync,report-basis-refresh,work-time-income-estimate,work-time-guard}.test.ts`.
- **Documentos do diff:** plano §20.15 (`:4764`, `:4795`, riscos `:4799-4818`, estado `:4825`), `DATA_MODEL.md:277` e `evidence/p5f1/` (LEIAME, VEREDITOS, autorização, elegibilidade, execuções, mutantes e roteiros, respostas às revisões 6 e 7).
- **Contexto fora do diff:**
  - `src/modules/reports/{liveRefresh,queryKeys,hooks,officialApi}.ts` e `src/modules/transactions/incomeReads.ts`;
  - `src/App.tsx:116-123`, `src/modules/work-time/WorkTimeContext.tsx:118-126`, `src/components/WorkTimeSettingsView.tsx:176-184,311-319,458` e `src/components/workTime/WorkTimeWizard.tsx:69-77`;
  - `@tanstack/query-core` 5.0.0 (`build/modern/{query,queryClient,queryObserver,retryer,notifyManager}.js`) e `@firebase/functions` 0.13.1 (`dist/esm/index.esm.js:621`).
- **Registros do autor (só leitura):** `mutantes-unit-r7.log`, `e2e-wt-r7.log`, `repeticoes-r7/` e `verify-all-final.log*`.

Linhas do plano referem-se a `docs/production/PRODUCTION_READINESS_PLAN.md` do snapshot.

## Resumo

| Situação dos achados da revisão 7 | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 2 | R7-02, R7-03 |
| CORRIGIDO nos cenários do achado, com resíduo | 1 | R7-01 (resíduo em R8-01 e R8-02) |

| Resíduos listados | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO nos cenários apontados, com resíduo | 2 | R6-02 (R8-01 e R8-02), R5-02 (R8-01) |
| ACEITO COMO RISCO DOCUMENTADO | 1 | R1-19 |

| Achados novos | Qtde | IDs |
| --- | --- | --- |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 1 | R8-01 |
| INFO | 3 | R8-02, R8-03, R8-04 |

Não há achado HIGH nem MEDIUM. As correções resolvem os cenários da revisão 7, com prova de comportamento:

- **Mês mudado fora da janela.** Ele passou a reler a leitura por id depois da base, e a janela que passa a incluí-lo não junta versões nem prende a retenção. A prévia de 6 meses montada depois mostra só R$ 21.620,00; em `snapshot-r7`, R$ 21.120,00, e a leitura por id nunca é relida.
- **As duas bases da janela de 12 meses relidas juntas.** A liberação espera as duas.
- **Leitura que cruzou um retorno do servidor.** Ela volta a comparar e pedir, e os casos B e B2 terminam no estado final.
- **Economia da revisão 6.** Ela se mantém: retornos sem mudança não pedem nada, e a divergência persistente não vira laço (sonda P3).

Os 5 testes novos de comportamento reprovam contra o código da revisão 7, e os 151 mutantes morrem.

Os achados novos são de severidade baixa:

- **R8-01.** `fetching` diz que nenhuma base está lendo agora, não que todas foram relidas. Na janela de 12 meses, quando a releitura de uma base é adiada pelo orçamento dela (ou pulada no teto de falhas), a outra libera sozinha. Com a escuta encerrada, o estado misto fica livre até a reposição, por até 10 min.
- **R8-02.** O mês avulso que entra na janela não era acompanhado por base nenhuma. Na troca para 12 meses, o total novo dele aparece, por uma leitura, com a exclusão antiga. É preexistente: igual em `snapshot-r7`.
- **R8-03.** A fiação de `fetching` no produto não tem teste de comportamento: U151 morre só pela guarda, e tirar `isFetching` das dependências do `useMemo` sobrevive a tudo e prende a retenção.
- **R8-04.** Comentário e documentos prometem mais que o código.

O isolamento por titular e por workspace continua correto. Nada derivado é gravado, e a estimativa segue sem autoridade financeira.

## 1. Situação dos achados da revisão 7

| ID | Sev. original | Situação | Evidência (snapshot-r8) | O que falta |
| --- | --- | --- | --- | --- |
| R7-01 | LOW | CORRIGIDO nos cenários do achado; resíduo em R8-01 e R8-02 | (1) **Todos os meses.** `sameIncome` (`basisRefresh.ts:28-31`) compara todos os meses da base, em `followReads` (`basisSync.ts:400`) e em `ahead` (`:474`). A mudança de julho, fora de ago–out, relê as exclusões depois da base, e a janela que passa a incluir julho não prende nada (`report-basis-sync.test.ts:811-834`). Na estimativa inteira, de 3 para 6 meses, a renda é sempre R$ 21.620,00 (`work-time-income-estimate.test.ts:452-493`). Sonda A3d: a prévia de 6 meses montada depois mostra só 2.162.000 (em `snapshot-r7`, a leitura por id nunca é relida). (2) **As duas bases.** `BasisView.fetching` (`basisSync.ts:201-202`; `useIncomeEstimateWith.ts:151`) entra na condição de `:400`. Com as duas bases relidas juntas, a ordem é relatório, mês avulso, exclusões, sem renderização livre com só uma nova (`report-basis-sync.test.ts:836-857`). Os testes reprovam contra a revisão 7. U131, U132 e U147–U150 morrem por comportamento; U151, só pela guarda (R8-03) | A liberação não espera a base cuja releitura foi adiada pelo orçamento ou pulada no teto (R8-01). O mês avulso, que nenhuma base trazia antes da troca, ainda junta versões por uma leitura (R8-02) |
| R7-02 | LOW | CORRIGIDO | (1) **Contagem e começo.** Cada retorno do servidor é contado por `uid\|workspace` (`basisSync.ts:417`; `basisRegistry.ts:73-77`). Cada leitura guarda o começo na `queryFn` (`basisSync.ts:124-132`; `basisFetchStarts`, `basisRegistry.ts:78`). (2) **Condição.** `overlapped` está em `basisSync.ts:451-455`. (3) **Testes.** B2 (`report-basis-sync.test.ts:859-882`) e B (`:884-907`) terminam com 3 chamadas, o estado final e nenhuma renderização livre com o intermediário. O teste da revisão 6 continua com 2 chamadas (`:650-675`). (4) **Começo certo (TanStack Query 5.0.0).** A `queryFn` roda na hora em que a busca começa, ou quando a pausa sem rede acaba (`retryer.js:77-120`). A busca deduplicada devolve a promessa em curso, sem chamar a `queryFn`, e o começo guardado é o da leitura cujo dado chega (`query.js:121-127`). `refetchQueries` e `refetch()` cancelam e guardam um começo novo (`queryClient.js:141-150`; `queryObserver.js:146-160`), e a nova tentativa guarda de novo. O começo ausente depois da última desmontagem conta como antes (`?? -1`), o lado seguro. (5) **Sem excesso nem laço.** Na sonda P3, com duas estimativas de janelas diferentes, retornos sem mudança no meio de leituras sem pedido não pedem nada. A divergência persistente para em 2 pedidos: 1 → 4 → 6 → 10 chamadas, isto é, 3 da mutação, 2 pedidos e 4 da mutação. U133 e U144–U146 morrem | Detalhes sem teste (X3, X4) em R8-03 |
| R7-03 | INFO | CORRIGIDO | (1) `VEREDITOS.md:49`: 92, 78 (com 29) e 15, como medi e como registra `execucoes.md:92`. (2) "Cada retorno do servidor": plano `:4764`, `DATA_MODEL.md:277`, `VEREDITOS.md:45,60`, `elegibilidade-receitas.md:50` e `respostas-revisao-6.md:19`; a escuta que volta a falhar é reaberta a cada retorno de outra (`VEREDITOS.md:60`). (3) A janela do painel na liberação sem pedido: `VEREDITOS.md:68,71` e plano `:4815`, até cerca de 43 por hora por base. (4) A espera de até 10 min: plano `:4764,4806`, `elegibilidade-receitas.md:50` e `VEREDITOS.md:68` | Imprecisões novas em R8-04 |
| R6-02 | LOW | CORRIGIDO nos cenários apontados (com R7-01 e R7-02); resíduo em R8-01 e R8-02 | Ver R7-01 e R7-02 | R8-01 e R8-02 |
| R5-02 | LOW | CORRIGIDO nos cenários apontados; resíduo em R8-01 | Com a escuta encerrada, a releitura da mutação é o único caminho de atualização (`incomeReads.ts:47`; `basisRegistry.ts:56-61`), e é nele que aparece R8-01 | R8-01 |
| R1-19 | INFO | ACEITO COMO RISCO DOCUMENTADO | Sem mudança; a decisão está no plano (`:4816`), e `Header.tsx` não está no diff | — |

## 2. Achados novos

### R8-01 — LOW: a base nova sem pedido libera quando nenhuma base está em leitura, e não quando todas foram relidas; na janela de 12 meses, a base cuja releitura foi adiada pelo orçamento (ou pulada no teto) fica para trás, e a estimativa mostra só uma das bases nova, livre

**Local:**
- `src/modules/reports/basisSync.ts`:
  - `:400`: a liberação exige `!current.fetching`, uma foto do momento;
  - `:201-202` e `src/modules/work-time/useIncomeEstimateWith.ts:151`: `fetching` é `isFetching` das bases;
  - `:310-315`: o pedido usa `arrived`, que exige versão nova de todas as bases;
  - `:252-255`: o comentário diz "nem só uma das bases da janela de 12 meses".
- `src/modules/reports/basisRegistry.ts:56-61`:
  - a releitura da mutação notifica o agendador de cada base em separado;
  - cada agendador tem o próprio orçamento: 2 seguidas e 1 a cada 10 min (`queryKeys.ts:53-57`);
  - pula a base parada no teto de falhas (`:58`).
- `src/modules/reports/liveRefresh.ts:54-60`: sem ficha, o agendador só reagenda; a base não fica `isFetching`.

**O que acontece.**
1. As duas bases da janela de 12 meses têm agendadores e orçamentos independentes. Eles ficam diferentes quando a base do mês avulso nasce depois da série: a pessoa passou de 3 para 12 meses, ou o mês virou e o mês avulso trocou de chave. Nesse caso, a série pode ter gastado as 2 fichas da mutação nos últimos 10 min, e o mês avulso tem fichas. Também ficam diferentes quando a série parou no teto de falhas, e então a mutação não a relê.
2. Numa mutação desta aba, o mês avulso é relido 30 s depois, e a série espera a reposição (até 10 min) ou não é relida.
3. O mês avulso chega com outra receita. Nenhuma base está em leitura, então `followReads` libera e relê as exclusões. Daí em diante, a estimativa fica livre com o mês avulso novo e a série antiga, até a série ser relida.
4. Com a escuta viva, ela normalmente já pediu e resolveu a releitura das duas (pelo orçamento dela) antes dos 30 s da mutação, e o caso não aparece. Ele aparece quando a escuta não entrega a tempo, sobretudo com a escuta encerrada por erro. Esse é o estado em que a releitura da mutação é o único caminho (R5-02), e o teste do autor (`report-basis-sync.test.ts:836-857`) parte da mesma premissa: nenhum retorno da escuta depois da mudança.
5. O mesmo ocorria na revisão 7 (sonda P1 igual em `snapshot-r7`). A revisão 8 corrigiu o caso das duas bases relidas juntas, mas declara uma regra mais forte do que a que o código garante.

**Cenário concreto.**
- Fonte PF, modo habitual, 12 meses (nov/2025 a out/2026).
- Nos últimos 10 min, a pessoa lançou duas despesas nesta aba, ainda com 3 meses, o que gastou as 2 releituras da mutação da série. Depois, passou a 12 meses, e a base do mês avulso nasceu com orçamento cheio.
- A escuta da estimativa em uso é encerrada por erro, e a ressalva do topo aparece.
- A pessoa corrige a data de uma receita de R$ 500,00 de 20/11/2025 para 20/10/2026.
- 30 s depois, a releitura da mutação traz novembro de 2025 sem a receita; a série espera a reposição.
- Por até 10 min, a estimativa conta a receita em nenhum dos dois meses: R$ 500,00 a menos na renda dos 12 meses. Ela não segura o valor anterior; mostra a ressalva de atualização que falhou.
- Com a data trocada no sentido inverso, a receita entra duas vezes.

**Sondas.** React Query real, API em memória.

| Sonda | Situação | r8 | `snapshot-r7` |
| --- | --- | --- | --- |
| P1 | 12 meses. Série sem ficha no orçamento da mutação (reposição de 60 s), mês avulso com fichas. Uma receita passa de nov/2025 (90.000 → 40.000) para out/2026 (100.000 → 150.000) nesta aba, sem retorno da escuta | 1 renderização livre com só o mês avulso novo; a série não é relida (3 chamadas), e o estado final fica livre e misto (out/2026 em 100.000, nov/2025 em 40.000) | Igual |
| P1b | O mesmo, com a escuta encerrada por erro e reposição de 2 s | `listenFailed` verdadeiro; 1 renderização livre mista até a série ser relida na reposição (1,4 s depois); as exclusões são relidas duas vezes, uma depois de cada base | — |

**Correção sugerida:**
- Tratar como "em leitura" também a base com releitura agendada. Por exemplo, o agendador expõe se há releitura pendente (`pending` em `createLiveRefreshScheduler`), e a `BasisView` passa a considerar isso em `fetching`.
- Outra saída: quando só parte das bases da estimativa trouxe versão nova desde o par, pedir (`request.current`) em vez de liberar. Assim, a chegada passa pela regra do pedido (`arrived`).
- Para a base parada no teto, decidir se libera sozinha (com a ressalva, como hoje) e registrar a decisão.
- Teste: a janela de 12 meses com o orçamento da mutação de uma base gasto e o da outra cheio (P1 e P1b).
- Ajustar o comentário `:252-255` e os documentos (R8-04), ou registrar o resíduo nos riscos.

### R8-02 — INFO: o mês avulso, que nenhuma base trazia, entra na janela de 12 meses com a leitura por id de antes dele; por uma leitura, a estimativa junta o total novo desse mês com a exclusão antiga

**Local:**
- `src/modules/reports/basisSync.ts`:
  - `:400` e `:474`: o par compara todos os meses da base;
  - `:246-256`: o comentário diz que uma mudança fora da janela vale "para uma janela futura".
- `src/modules/work-time/useIncomeEstimateWith.ts`:
  - `:98-111`: com entradas diferentes, `holdEstimate` mostra o estado atual e o guarda como última estimativa;
  - `:121-126` e `:139-153`: a série `12m` vai de dez/2025 a nov/2026, e o mês avulso (nov/2025) só é lido com 12 meses.
- `src/components/WorkTimeSettingsView.tsx:176-184` e `src/modules/work-time/WorkTimeContext.tsx:118-126`: a prévia segue o rascunho, e o provedor segue a preferência salva (inclusive vinda de outro aparelho).

**O que acontece.**
1. A correção de R7-01 mantém a leitura por id em par com todos os meses que a base traz. Mas o 12º mês completo para trás (o mês avulso) não está na série; ele só é lido quando a janela de 12 meses entra em uso.
2. Antes disso, uma mudança nesse mês não muda base nenhuma e não relê a leitura por id. Um exemplo é anular ou editar uma receita desconsiderada de lá.
3. Na troca para 12 meses, o mês avulso chega novo, e a leitura por id do cache é a de antes. `ahead` fica verdadeiro, porque são 13 meses contra 12, e a sincronização segura e relê. Mas, como as entradas mudaram, `holdEstimate` mostra o estado misto. Durante a retenção, guarda e mostra o mesmo estado, até a leitura por id relida chegar.
4. Igual em `snapshot-r7` (E1b com o mesmo resultado). O efeito dura uma leitura por id, em geral menos de um segundo.
5. Não é o caso da prévia montada depois. A prévia e o assistente partem da preferência salva (`WorkTimeSettingsView.tsx:311-319`; `WorkTimeWizard.tsx:69-77`), então a janela maior chega por troca na mesma instância, que libera e relê.

**Cenário concreto.**
- Fonte PF, 3 meses. Em fevereiro de 2026, com a janela de nov/2025 a jan/2026, a pessoa desconsiderou uma receita de R$ 500,00 de 15/11/2025, e a exclusão ficou na preferência.
- Hoje (04/11/2026), essa receita é anulada, nesta aba ou em outra sessão. O gatilho grava nov/2025 sem ela, mas nenhuma base traz esse mês.
- A pessoa passa o rascunho de Configurações para 12 meses, ou o provedor recebe os 12 meses salvos em outro aparelho.
- Até a leitura por id relida chegar, a prévia (ou o topo) mostra R$ 35.500,00 de renda dos 12 meses em vez de R$ 36.000,00: o total de novembro já sem a receita, e ela ainda descontada.

**Sondas.** E1 e E1b (E1b com todas as consultas paradas antes da troca), em r8 e em `snapshot-r7`: a sequência de rendas com 12 meses é 3.550.000 e depois 3.600.000. A leitura por id vai de 1 para 2 só depois da troca.

**Correção sugerida:**
- Quando o conjunto de bases cresce (o mês avulso entra), manter `loading`, ou não guardar como última estimativa o estado que a sincronização ainda segura (`ahead`), até a leitura por id relida depois dele chegar.
- Ou registrar o caso nos riscos, ao lado de "Estimativa montada no meio de uma releitura das exclusões", e ajustar as afirmações de R8-04.

### R8-03 — INFO: a fiação de `fetching` no produto não tem teste de comportamento; U151 morre só pela guarda, e tirar `isFetching` das dependências do `useMemo` sobrevive a tudo e prende a retenção

**Local:**
- `src/modules/work-time/useIncomeEstimateWith.ts:151` (`fetching`) e `:153` (as dependências do `useMemo`, com `series.isFetching` e `extra.isFetching`).
- `tests/unit/report-basis-sync.test.ts:231-233`: os testes de gancho usam uma cópia dessa fiação no `Probe` do teste.
- `tests/unit/work-time-guard.test.ts:387`: a guarda fixa só a linha de `fetching`.
- `package.json:53`: no front-end não há ESLint (só `functions:lint`), então nenhuma regra de dependências de gancho existe para pegar a falta.
- `src/modules/reports/basisSync.ts:451-455`: os detalhes de `overlapped`.
- `docs/production/evidence/p5f1/mutantes.md:190` e `respostas-revisao-7.md:19`: U151 é citado como prova de R7-01.

**Mutantes meus**, em memória, como na rodada principal:

| Mutante | Troca | Testes | Resultado |
| --- | --- | --- | --- |
| U151 sem a guarda | `fetching: false` (`:151`) | `work-time-income-estimate` | sobrevive |
| X1 | `useMemo` sem `series.isFetching` e `extra.isFetching` nas dependências (`:153`) | guarda e `work-time-income-estimate` | sobrevive |
| X2 | `fetching: series.isFetching` (`:151`) | `work-time-income-estimate`; guarda | sobrevive; morto pela guarda |
| X3 | `overlapped` sem exigir versão nova da base (`basisSync.ts:453-454`) | `report-basis-sync`, `work-time-income-estimate` e guarda | sobrevive |
| X4 | começo ausente conta como depois do último retorno (`?? Number.POSITIVE_INFINITY`, `:454`) | idem | sobrevive |
| X5 | limpeza sem apagar o começo (`:175`) | idem | sobrevive (quase equivalente: o começo que fica ainda vale) |
| X6 | `<=` no lugar de `<` (`:454`) | `report-basis-sync` e `work-time-income-estimate` | morto (4 testes) |
| X7 | conta também o retorno só do cache (`:416-417`) | idem; guarda | sobrevive; morto pela guarda |
| X8 | efeito sem `basis?.fetching` nas dependências (`:457`) | idem | sobrevive (equivalente: `basis?.income` muda de identidade a cada recálculo) |

**Consequência de X1 (sonda E3,** estimativa inteira, 12 meses, série nova sem pedido e o mês avulso falhando, com a nova tentativa):
- No código atual, a estimativa segura enquanto o mês avulso lê e libera depois da falha: 3.550.000 → 3.600.000, com uma releitura da leitura por id e a ressalva de atualização que falhou.
- Com X1, ela fica em 3.550.000, e a leitura por id não é relida. A memória do `useMemo` guarda `fetching` verdadeiro, porque nada da dependência muda quando a busca só falha. A retenção fica presa até outra mudança de dado ou o "Tentar de novo".

X3 deixaria uma base parada, com leitura antiga, fazer uma leitura sem pedido pedir: só custo. X4 perderia a leitura cruzada que chega depois de desmontar e montar de novo.

**Correção sugerida:**
- Um teste de `useIncomeEstimateWith` com a janela de 12 meses e uma releitura sem pedido em que o mês avulso chega depois e em que ele falha (como E3). Ele mataria U151, X1 e X2 sem depender da guarda.
- Um teste de gancho da janela de 12 meses em que só a série muda sem pedido e o mês avulso tem começo antigo (mataria X3).
- Opcional: fixar na guarda as dependências do `useMemo`.
- Em `respostas-revisao-7.md:19`, deixar claro que U151 só morre pela guarda.

### R8-04 — INFO: comentário e documentos prometem mais que o código

**Local:** `src/modules/reports/basisSync.ts:252-255`; plano `:4795`; `respostas-revisao-7.md:19`; riscos `:4799-4818`.

1. **`basisSync.ts:252-255`:** "libera quando nenhuma base da estimativa está mais em leitura (`fetching`) [...] uma base nova nunca é juntada com exclusões lidas antes dela, nem só uma das bases da janela de 12 meses". As duas garantias têm exceção: R8-01 e R8-02.
2. **Plano `:4795`** (a linha da revisão 7):
   - "Ela também passou a esperar todas as bases da estimativa terminarem de ler, como o pedido já fazia." O pedido espera a chegada de todas (`arrived`, `basisSync.ts:310-315`); `fetching` espera só as leituras em curso (R8-01).
   - "uma janela que passa a incluir um mês mudado fora dela, ou uma estimativa maior que monte depois, não junta mais versões." Não vale para o mês avulso (R8-02).
3. **`respostas-revisao-7.md:19`:**
   - "o par fica certo para qualquer janela futura e para a estimativa que monte depois" (R8-02);
   - "Na janela de 12 meses, a série e o mês avulso liberam juntos" (R8-01);
   - "U131, U132 e U147–U151 mortos": U151 só pela guarda (R8-03).
4. **Riscos:** nem R8-01 nem R8-02 aparecem.

O texto principal (`:4764`), `DATA_MODEL.md:277`, `VEREDITOS.md:45` e `elegibilidade-receitas.md:50` dizem só "libera quando nenhuma base da estimativa está [mais] em leitura", o que é literalmente certo.

**Correção sugerida:** ajustar os textos acima ao que o código garante, ou registrar R8-01 e R8-02 nos riscos.

## 3. Verificado sem achado

1. **Testes, guarda e mutantes.**
   - Os 170 testes (78 + 92) passam em 6 de 6 execuções de cada conjunto.
   - Contra o código da revisão 7, os 5 testes novos de comportamento reprovam, e os 36 anteriores passam.
   - Nada foi enfraquecido. As asserções subiram de 87 para 97 em `report-basis-sync`, de 32 para 36 em `work-time-income-estimate`, de 27 para 33 em `report-basis-refresh` e de 162 para 165 na guarda.
   - As linhas removidas do diff dos testes são só as trocadas. A asserção da guarda que mudou ficou mais estrita: exige `noteServerSnapshot` antes de `reopenFailedListeners` (`work-time-guard.test.ts:367`). Não há `skip`, `only` nem `todo`, e os prazos de `until` e `settle` são os mesmos.
   - Mutantes: 151/151, 0 não compilam. U144–U150 morrem pelos testes novos de comportamento.
2. **Os dublês novos são legítimos.**
   - `readAtStart` (`report-basis-sync.test.ts:86-87,141,149,157`): a callable lê a receita no começo e responde depois. É o pior caso de uma leitura do servidor antes de uma escrita concorrente, e o padrão falso mantém os outros testes como estavam.
   - `excludedDate` (`work-time-income-estimate.test.ts:125-126,150,198`): só parametriza a data do lançamento desconsiderado.
   - `mountWindow` (`report-basis-sync.test.ts:272-280`): troca a janela na mesma instância, como o provedor e a prévia fazem.
   - A cópia de `fetching` no `Probe` (`:231-233`) é igual à do produto.
   - Nenhum deles muda o código testado.
3. **`overlapped` sem excesso nem laço.**
   - A contagem é por `uid|workspace`, para todas as janelas. Um retorno à escuta de outra estimativa também marca a leitura como cruzada, o lado seguro.
   - O pedido continua exigindo divergência na janela da própria estimativa e no máximo 2 releituras por estado (`basisRefresh.ts:43-63`).
   - Sonda P3, com duas estimativas, retornos sem mudança e divergência persistente: nenhum pedido a mais e nenhum laço; igual em `snapshot-r7`.
   - Base que nunca carregou e troca de chave ou de número de bases passam por `loading` (`basisSync.ts:449-450`).
   - Mês avulso com chave nova e dado em cache, sem começo guardado: conta como cruzada (`?? -1`), o lado seguro.
4. **Começo da leitura.**
   - `basisFetchStarts` não depende da entrada do registro: a `queryFn`, que roda no efeito de assinatura do `useQuery` antes do efeito do registro, grava normalmente (`basisSync.ts:126`).
   - Depois da última desmontagem, a limpeza o apaga (`:175`). Uma leitura em curso que chega depois de montar de novo conta como cruzada, e a nova tentativa grava outra vez.
   - O `StrictMode` (`main.tsx:14`, só em desenvolvimento) apaga no efeito dobrado, mas a primeira chegada é carga.
5. **`fetching` não prende a retenção.**
   - **Falha (sondas P4b e E3):** segura enquanto o mês avulso lê e na nova tentativa, porque `fetchStatus` continua `fetching` no intervalo (`retryer.js:88-110`), e libera no erro (`query.js:306-320`). Em `snapshot-r7`, a liberação saía na chegada da série, antes do mês avulso.
   - **Busca que não termina:** a callable usa o prazo padrão do SDK, 70 s (`officialApi.ts:12-13`; `@firebase/functions` 0.13.1, `index.esm.js:621`). Com `retry: 1` e 1 s de espera (`retryer.js:5-7`), a retenção dura no máximo cerca de 2 min 20 s e termina com a ressalva.
   - **Sem rede:** `fetchStatus` vira `paused` e `isFetching` fica falso (`queryObserver.js:301,325`). A liberação sai, e o marco segura até a leitura por id, também pausada, chegar.
   - **`refetchOnMount` desligado:** não começa leitura.
   - **Estimativa desligada:** `syncKey` nulo, sem retenção; na volta, `loading`.
   - **Soltar cedo:** só em R8-01.
6. **Custo de comparar todos os meses.**
   - Sonda P2: uma receita do mês corrente lançada nesta aba faz a releitura da mutação ser seguida de uma releitura da leitura por id (até 2 consultas `in` e, com o painel aberto, a janela dele), sem mudar o valor (R$ 10.560,00). Em `snapshot-r7`, nenhuma.
   - O custo fica dentro dos orçamentos das bases e está no modelo de custo: "qualquer mês da base" (`VEREDITOS.md:68`), "até cerca de 43 por hora por base" (`:71`; plano `:4815`).
   - A retenção por mudança fora da janela mantém os mesmos números até a releitura.
7. **Sonda A3 com carga na máquina.** A primeira rodada mostrou 2.112.000 e depois 2.162.000. A inspeção do cache (A3c) mostrou a leitura por id ainda em curso 150 ms depois da base, com o `verify:all` do autor ocupando a máquina. A prévia montou no meio dela, o risco já registrado no plano (`:4805`). Com as consultas paradas antes (A3d), só 2.162.000.
8. **Sem releitura pelo foco.** A aplicação desliga `refetchOnWindowFocus` (`App.tsx:116-123`). A única busca deduplicada das bases é a do próprio observador, na montagem ou na troca de opções (`queryObserver.js:49-50,99-105`), que mantém o começo da leitura em curso.
9. **Evidência.**
   - `execucoes.md:91-96` bate com os registros: `mutantes-unit-r7.log` diz "151/151 mortos; 0 não compilam", e `e2e-wt-r7.log`, "15 passed (3.2m)".
   - `repeticoes-r7/` tem 60 registros, todos "# fail 0" (30 com 78 testes e 30 com 92).
   - Os roteiros copiados têm os mesmos SHA-256 das cópias em `p5f1/`: `mutantes.py` `f559ddcc…`, `atualizar-mutantes-r7.py` `e8bc681d…`, `gerar-tabela-mutantes.py` `241b7492…` e `escrever-mutantes-md.py` `d3d81da6…`.
   - `mutantes.md` vai até U151 (151 + 11 = 162 trechos).
10. **Isolamento e superfície.**
    - O diff não toca Rules, índices, Functions, interface nem textos visíveis.
    - As contagens e os começos ficam em mapas do módulo, sem dado, com chave de `uid` e workspace. Nada é gravado.
11. **Plano.**
    - O §20.15 continua "AGUARDANDO AUDITORIA INDEPENDENTE" (`:4825`), sem marcar o gate da P5 nem P6–P10.
    - Os marcadores `⟦…⟧` são preenchidos depois do gate e não foram avaliados.

## Notas

- **TanStack Query 5.0.0** (`wt-p5f1/node_modules/@tanstack/query-core/build/modern`):
  - a busca com dado e `cancelRefetch` cancela a em curso; sem ele, devolve a promessa em curso sem chamar a `queryFn` (`query.js:121-127`);
  - `refetchQueries` e `refetch()` cancelam por padrão (`queryClient.js:141-150`; `queryObserver.js:146-160`);
  - a `queryFn` roda na hora (ou quando a pausa sem rede acaba), e cada nova tentativa a chama de novo, depois de 1 s na primeira (`retryer.js:5-7,77-120`);
  - `fetchStatus` continua `fetching` entre as tentativas e só fica `idle` no erro ou no sucesso (`query.js:263-320`); `isFetching` é `fetchStatus === "fetching"` (`queryObserver.js:301`);
  - as notificações saem num microtask (`notifyManager.js`).
- **React 18.2:** a aplicação usa `createRoot` (`main.tsx:12`); o `TestRenderer.create` dos testes usa a raiz legada.
- **SDK Firebase 12.8.0:** a escuta usa `includeMetadataChanges` (`hooks.ts:80`), então um retorno do servidor só de metadados também conta, o lado seguro. A callable do relatório não define prazo e usa o padrão de 70 s (`@firebase/functions` 0.13.1).
- **Tempos.** Os tempos reais (gatilho, partida a frio, callable, escuta) são inferidos, não medidos no navegador. As sondas usam agrupamento e orçamento em escala. A máquina estava ocupada pelo `verify:all` do autor; por isso, P4 e A3 foram refeitas com espera maior ou com as consultas paradas (P4b, A3d), e as conclusões usam essas rodadas.
- **Rodado sem criar arquivo:** os 151 mutantes, os 9 meus e as sondas E1, E1b, E3, P1, P1b, P2, P3, P4, P4b, A3, A3b, A3c e A3d, por ganchos de carga em memória.
- **Não rodei** o E2E nem as Rules, que exigem build e Emulator. O `verify:all` final do autor estava em curso quando terminei, lido só para leitura (`p5f1/logs/verify-all-final.log.meta`): começou às 02:48:31Z, na árvore `16cda725`, e o registro foi atualizado às 03:26. Não é evidência minha.
- **Registro de procedimento.** No começo, por engano, um comando criou e apagou na mesma execução um arquivo temporário em `review/` (`.r8-docs-a.txt`, com um trecho do diff), contra a regra do pedido. O arquivo não existe mais, e `review/` só mudou de data por isso. O snapshot e o worktree não foram tocados (impressão igual antes e depois).
- **Impacto.** Nenhum achado novo grava, altera ou expõe dado financeiro. O LOW e os INFO tratam da estimativa informativa, dos testes e dos documentos.
