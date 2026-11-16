# P5-F.1 — Revisão independente 6 (somente leitura)

- **Data:** 2026-11-04
- **Objeto:** `snapshot-r6/` (árvore Git `80b73832`). Junto vieram `r6-sobre-r5.diff` (mudanças desde a revisão 5, sem os PNG), `revisao-5.md` (R5-01 … R5-05 e os resíduos R4-01, R3-03, R4-03, R4-05 e R1-19) e as respostas do autor (`snapshot-r6/docs/production/evidence/p5f1/revisoes/respostas-revisao-5.md`). Durante a revisão, a árvore passou a `ff45884e`, com mudança só em comentários de `src/modules/reports/basisSync.ts` (`r7-sobre-r6.diff`); conferi esses comentários pelo diff, aplicado em memória. Os achados valem para as duas árvores.
- **Contrato de aceite:** `p5f1/spec-original.txt`.
- **Método:** li o código, os testes, os documentos e as fontes do TanStack Query 5.0.0 e do SDK do Firestore. Conferi cada resposta no código e no teste que ela cita, não pelo texto. Nada exigiu `npm install`, Emulator, build, rede ou Firebase, e o único arquivo criado é este parecer. O contêiner foi reiniciado no meio da revisão; refiz o que ficou pela metade. O que rodei:
  1. **Unitários puros, no snapshot**, com `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test`: `report-{basis-refresh,live-refresh,range,adapter,alerts-guard}`, `transactions-paging` e `work-time-{calendar,estimate,guard,preference,calculation,grammar}`, 128/128.
  2. **Testes de gancho e conjuntos**, com o código do snapshot. React 18.2.0, react-test-renderer 18.2.0 e @tanstack/react-query 5.0.0 vieram de `wt-p5f1/node_modules`, só para leitura, por um gancho de resolução em memória (`--import data:…`).
     - `test:unit:reports` (67 testes, com os 19 de `report-basis-sync`): 15 de 15 execuções sem falha.
     - `test:unit:work-time` (88 testes, com os 8 de `work-time-income-estimate`): 13 de 20 sem falha. As outras 7 reprovam só um teste novo, sempre na mesma asserção (R6-04).
  3. **Mutantes em memória.** Um gancho de carga troca o trecho no módulo carregado, e um invólucro de `fs.readFileSync` troca o mesmo trecho no que a guarda lê; nada é gravado.
     - (a) Os 130 de unidade desta rodada. A árvore só traz a lista da revisão 4 (R6-06). Reconstruí a da revisão 5 em memória (a lista do snapshot com as 4 trocas de `p5f1/atualizar-mutantes-r5.py`), conferi que ela é igual a `p5f1/mutantes.py` e extraí os mutantes com `ast`, sem executar os roteiros. Cada arquivo mutado passou pelo esbuild 0.25.12 de `wt-p5f1`: 0 não compilam. Rodei cada mutante contra os testes que o roteiro indica: 129 reprovam por asserção determinística, e U102 sobrevive (R6-04).
     - (b) 8 mutantes meus (M1–M8) contra `report-basis-sync`, `work-time-income-estimate`, `work-time-guard` e `report-range`.
  4. **Sondas**, como testes acrescentados em memória ao módulo de teste (pelo mesmo gancho de carga), com React Query real e a API em memória:
     - P1: escuta do provedor encerrada, prévia montada depois e o "Tentar de novo" dela (R6-01);
     - P2, P3 e P3b: a releitura da mutação chegando antes do retorno da escuta, com a escuta viva e encerrada (R6-02);
     - P4 e P5: base desatualizada, ou parada no teto, e outra estimativa montada depois (R6-05 e "verificado");
     - P6: rajadas de mutação antes de uma receita nova, com o orçamento em escala (R6-03);
     - instrumentação do teste intermitente: momento de cada renderização, liberação e leitura (R6-04).
  5. **Comentários da árvore `ff45884e`.** Apliquei os dois trechos de `r7-sobre-r6.diff` em memória: o arquivo compila (esbuild), e a guarda, `report-basis-sync` e `report-range` passam (42/42).

  Nenhum arquivo do snapshot mudou: a impressão SHA-256 de caminho, tamanho e data dos 2.443 arquivos ficou igual antes e depois (`738408ff…`). No worktree `wt-p5f1`, onde o `verify:all` roda, só li `node_modules`; não rodei `git` nele. Li os registros do autor em `p5f1/logs/`, só para leitura. Quando uma conclusão depende do TanStack Query 5.0.0, do React 18.2 ou do SDK Firestore 12.8.0 (`@firebase/firestore` 4.10.0), isso está dito, e as fontes foram lidas em `wt-p5f1/node_modules`.

## Escopo revisado

- **Código e testes do `r6-sobre-r5.diff`:**
  - `src/modules/transactions/{incomeReads,hooks}.ts`;
  - `src/modules/reports/{basisRegistry,basisSync}.ts`;
  - `src/modules/work-time/useIncomeEstimateWith.ts`;
  - `tests/unit/{report-basis-sync,work-time-income-estimate,work-time-guard}.test.ts` e o comentário de `tests/firestore/work-time-p5f.rules.integration.test.mjs`.
- **Comentários do `r7-sobre-r6.diff`:** `BASIS_RETRIES_AFTER_ERROR`, `BASIS_PERIODS_MAX` e o `useQuery` da base, em `src/modules/reports/basisSync.ts`.
- **Documentos do diff:** plano §20.15 (`:4764`, `:4786-4793` e riscos `:4797-4813`), `DATA_MODEL.md:277` e `evidence/p5f1/` (LEIAME, VEREDITOS, autorização, elegibilidade, execuções e respostas).
- **Contexto fora do diff:**
  - `src/modules/work-time/WorkTimeContext.tsx:85-160`, `src/components/Header.tsx:42-51,529-546`, `src/components/WorkTimeSettingsView.tsx:176-184,263,432-438`, `src/components/workTime/EstimateDetails.tsx:60-82` e `src/modules/work-time/messages.ts:70-92`;
  - `src/modules/reports/{liveRefresh,queryKeys,basisRefresh,hooks}.ts` e `src/modules/work-time/{estimate,incomeBasis}.ts`;
  - os ganchos de mutação que chamam `invalidateTransactionDependents` (lançamentos, cartões, empréstimos, recorrentes, divisões, clientes e contas) e `src/modules/investments/simple/api.ts:144`;
  - `src/App.tsx:116-123`, `src/contexts/AuthContext.tsx:60-111` e `firestore.rules:788-794`;
  - `@tanstack/query-core` 5.0.0 (`build/modern/{query,queryObserver}.js`) e `@firebase/firestore/dist/index.d.ts`.

Linhas do plano referem-se a `docs/production/PRODUCTION_READINESS_PLAN.md` do snapshot.

## Resumo

| Situação dos achados da revisão 5 | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 4 | R5-01, R5-03, R5-04, R5-05 |
| CORRIGIDO no cenário do achado, com resíduo e efeitos novos | 1 | R5-02 (resíduo em R6-01; efeitos em R6-02 e R6-03) |

| Resíduos listados | Qtde | IDs |
| --- | --- | --- |
| CORRIGIDO | 4 | R4-01, R3-03, R4-03 (efeitos novos em R6-02 e R6-03), R4-05 |
| ACEITO COMO RISCO DOCUMENTADO | 1 | R1-19 |

| Achados novos | Qtde | IDs |
| --- | --- | --- |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 4 | R6-01 … R6-04 |
| INFO | 2 | R6-05, R6-06 |

Não há achado HIGH nem MEDIUM. As correções resolvem os cenários da revisão 5, com prova de comportamento:

- a leitura por id deixou de ser relida na montagem e na volta da rede, e um mutante disso reprova de forma determinística;
- a mutação nesta aba relê a base sem zerar o teto, e a reconstrução marcada fora dos meses deixa a estimativa indisponível;
- a escuta encerrada por erro avisa e é reaberta pelo "Tentar de novo" da mesma estimativa;
- o escopo `uid|workspace` e as três liberações ganharam testes, e os mutantes M4, M6, M8 e M20 da revisão 5 agora reprovam (U127 a U130).

Os achados novos são de severidade baixa e nascem das próprias correções:

- **R6-01.** A escuta é por instância. Quando a do provedor é encerrada, a ressalva do topo manda tentar de novo em Configurações. Lá, porém, o botão é o da prévia, que reabre só a escuta dela. A ressalva fica, e o provedor deixa de acompanhar outras sessões até a virada do mês ou uma recarga.
- **R6-02.** A releitura pedida pela mutação chega fora do protocolo de retenção. Se a base nova chega antes do retorno da escuta, aparece o caso misto inverso (base nova com a exclusão antiga). Com a escuta viva, é uma corrida rara e curta. Com a escuta encerrada, o valor misto fica preso a partir da segunda mutação que muda a receita.
- **R6-03.** As releituras da mutação gastam o orçamento por base que a escuta usa. Depois de cinco rajadas de mutação, a sincronização seguinte espera a reposição, até 120 s.
- **R6-04.** Um teste novo é intermitente: reprova em cerca de uma de cada três execuções de `test:unit:work-time`. Por isso, U102, que ficou equivalente com o código novo, consta como morto.

Os INFO tratam de imprecisões dos documentos e dos comentários (R6-05) e da evidência dos mutantes que ainda não está na árvore (R6-06).

O isolamento por titular e por workspace continua correto. Nada derivado é gravado, e a estimativa segue sem autoridade financeira.

## 1. Situação dos achados da revisão 5

| ID | Sev. original | Situação | Evidência (snapshot-r6) | O que falta |
| --- | --- | --- | --- | --- |
| R5-01 | LOW | CORRIGIDO | `useTransactionsByIdsWith` tem `staleTime: Infinity` e `refetchOnReconnect: false` (`incomeReads.ts:76-78`). No TanStack Query 5.0.0, um observador novo só busca na montagem a consulta desatualizada (`queryObserver.js:46-54,408-414`). Com prazo infinito, só a invalidada ou sem dado está desatualizada (`query.js:77-79`). A volta da rede só relê quem aceita `refetchOnReconnect` (`query.js:85-89`; `queryObserver.js:60-64`). O pedido da escuta não marca mais as leituras de receitas (`basisSync.ts:251-263`); só a liberação as invalida e relê (`:265-271`; `incomeReads.ts:27-30`). As bases também não relêem na montagem nem na volta da rede (`basisSync.ts:111-116`). O teste "leitura por id antiga…" (`work-time-income-estimate.test.ts:296-328`) envelhece a leitura em 6 min e monta a prévia depois da mutação; a asserção `:314` reprova U116 de forma determinística ("2 !== 1"). "Prévia montada durante uma sincronização" (`:366-385`) mata U118 e U119. A lista nova, lida na hora, entrou nos riscos (plano `:4802`) | A última asserção desse teste é intermitente (R6-04); ela não faz parte da prova acima |
| R5-02 | LOW | CORRIGIDO no cenário do achado; resíduo em R6-01 e efeitos novos em R6-02 e R6-03 | (1) `invalidateTransactionReads` chama `rereadWorkspaceBases` (`incomeReads.ts:41-53`), que relê pelo agendador as bases carregadas do workspace, fora do teto e sem zerar as falhas (`basisRegistry.ts:50-55`). Uma releitura que falha por esse caminho não é contada: a consulta não está invalidada, e o redutor de erro mantém `isInvalidated` (`query.js:306-320`). Por isso o efeito da base não volta a pedir (`basisSync.ts:146-153`), e não há laço. O teste "reconstrução marcada…" (`work-time-income-estimate.test.ts:330-348`) deixa a estimativa indisponível sem reler a leitura por id; o teto continua parado com quatro mutações (`report-basis-sync.test.ts:347`). (2) O erro da escuta liga `listenFailed` (`basisSync.ts:320-323,341`), que entra em `refreshFailed` (`useIncomeEstimateWith.ts:215`). O "Tentar de novo" reabre a escuta pelo contador nas dependências do efeito (`basisSync.ts:237,324,337`; `useIncomeEstimateWith.ts:165`). Testes `report-basis-sync.test.ts:522-542` (uma escuta por vez, `:537`) e `work-time-income-estimate.test.ts:350-364`. U121 a U126 reprovam | O "Tentar de novo" só reabre a escuta da própria instância, e o do provedor não está em nenhuma tela (R6-01). A releitura da mutação reabre o caso misto inverso (R6-02) e gasta o orçamento da escuta (R6-03). A reconstrução marcada por mutação de outra sessão continua sem releitura e sem registro (R6-05) |
| R5-03 | INFO | CORRIGIDO | Testes novos: troca de workspace com o pedido em curso e volta (`report-basis-sync.test.ts:544-567`), que mata U127 e U128 (M4 e M6); tentativas esgotadas com pedido em curso, com a ordem base → exclusões (`:569-585`), que mata U130 (M20); `syncing` e `holding` falsos depois da releitura sem bloco exato (`:319`), que mata U129 (M8). O marco não precisa de descarte à parte: `readsBehind` exige a mesma chave (`basisSync.ts:335-336`), e o efeito de `reads` o limpa quando a leitura muda com o workspace (`:331-333`). O pedido não zera mais o marco, porque `syncing` o cobre (`:334,340`). Conferi os dois raciocínios | — |
| R5-04 | INFO | CORRIGIDO | (1) As três liberações estão no comentário (`basisSync.ts:189-201`) e batem com o código: convergência (`:279-282`), tentativas esgotadas com tudo chegado (`:291-292`) e base sem bloco exato com tudo chegado (`:300`). Estão também no plano (`:4764`), no `DATA_MODEL.md:277`, na elegibilidade (`:50`) e nos vereditos (`:45`). (2) A escuta relê só as próprias bases (`basisSync.ts:256-261`; `refreshRegisteredBases` por chave exata, `basisRegistry.ts:33-39`; U120). O modelo de custo ganhou a releitura da mutação, a leitura por id só pela sincronização e a janela do painel relida a cada liberação (`VEREDITOS.md:68-69`). (3) O comentário da suíte de Rules cita `firebaseBasisDeps.subscribePeriods` (`work-time-p5f.rules.integration.test.mjs:433-434`) | Imprecisões novas em R6-05 |
| R5-05 | INFO | CORRIGIDO | `useTransactionsByIds` saiu de `transactions/hooks.ts`, e a guarda impede a volta (`work-time-guard.test.ts:385`). A fiação real continua conferida (`:363-365`: `readByIds: getTransactionsByIds`) | — |
| R4-01 | LOW | CORRIGIDO (com R5-01) | Ver R5-01. A mutação nesta aba não relê a leitura por id (o `predicate` de `incomeReads.ts:47-50`), nem a montagem ou a volta da rede depois de 5 min | — |
| R3-03 | LOW | CORRIGIDO (com R5-01) | Ver R4-01 | — |
| R4-03 | LOW | CORRIGIDO (com R5-02) | As invalidações das telas não tocam as bases (`queryKeys.ts:57-61`). A mutação relê sem zerar as falhas e não reabre o teto (`report-basis-sync.test.ts:330-359,587-612`; U122) | Efeitos da releitura da mutação em R6-02 e R6-03 |
| R4-05 | INFO | CORRIGIDO (com R5-03) | Ver R5-03; a sonda da revisão 5 com o mutante M6 virou o teste `:544-567` | — |
| R1-19 | INFO | ACEITO COMO RISCO DOCUMENTADO | Sem mudança; a decisão está no plano (riscos) | — |

## 2. Achados novos

### R6-01 — LOW: com a escuta do provedor encerrada, a ressalva do topo manda tentar de novo em Configurações, mas lá o "Tentar de novo" é o da prévia e não reabre a escuta do provedor

**Local:**
- `src/modules/reports/basisSync.ts:236-237,311,320-324,337-342`: `listenFailedKey` e `listenAttempt` são estado de cada instância do gancho;
- `src/modules/work-time/useIncomeEstimateWith.ts:154-166`: `retry` chama o `retryListen` da mesma instância;
- `src/modules/work-time/WorkTimeContext.tsx:118-126`: a estimativa do provedor; o `estimate.retry` dela não é usado por nenhuma tela;
- `src/components/Header.tsx:49-50` e `src/modules/work-time/messages.ts:82`: a ressalva "A última atualização da estimativa falhou: ela usa a leitura anterior. Tente de novo em Configurações.";
- `src/components/WorkTimeSettingsView.tsx:176-184,263,432-438`: Configurações usa `draftEstimate`; `savedEstimate` só aparece em "Valor em uso agora";
- `src/components/workTime/EstimateDetails.tsx:78-82`: o botão só aparece com o `refreshFailed` da prévia;
- documentos: plano `:4764`, `DATA_MODEL.md:277`, `VEREDITOS.md:45,60`, `elegibilidade-receitas.md:50`, `autorizacao-isolamento.md:42-43` e `respostas-revisao-5.md:21`.

**O que acontece.**
1. A escuta, o aviso e a reabertura são de cada estimativa. O provedor (no contexto, sempre montado), a prévia de Configurações e o assistente são instâncias separadas, cada uma com a própria escuta.
2. As bases e a leitura por id são consultas compartilhadas. Por isso, o "Tentar de novo" da prévia também conserta as leituras do provedor. A escuta, não.
3. Quando a escuta do provedor é encerrada por erro, o topo mostra a ressalva no modo tempo e manda tentar de novo em Configurações. Ao abrir Configurações, a prévia monta com uma escuta nova:
   - se a causa já passou, a prévia não tem aviso nem botão;
   - se não passou, o botão da prévia reabre só a escuta dela.
4. A escuta do provedor fica parada. Só a reabrem a virada do mês (a janela muda), salvar outra fonte, outro modo ou outro período, desligar e religar a função, trocar de conta ou recarregar a página. Até lá, a ressalva continua no topo, e o provedor não acompanha mais as outras sessões nem os outros membros. Só as mutações desta aba ainda relêem a base, com os efeitos de R6-02.

*Semântica do SDK Firestore 12.8.0:* depois do erro, a escuta não chama mais nada ("No further callbacks will occur", `@firebase/firestore/dist/index.d.ts:1764-1765` e equivalentes das consultas).

**Cenário concreto.**
- A fonte da renda é um workspace compartilhado, e a pessoa está no modo tempo.
- Um administrador suspende a participação dela e a reativa minutos depois. Qualquer outro erro terminal da escuta tem o mesmo efeito.
- Durante a suspensão, a escuta do provedor recebe "permissão negada" e é encerrada.
- Depois da reativação, a pessoa segue a ressalva e abre Configurações. A prévia funciona e não mostra botão nenhum. O topo continua com "A última atualização da estimativa falhou… Tente de novo em Configurações".
- Uma receita lançada por outro membro não chega mais à estimativa em uso.

**Sonda P1.** React Query real, API em memória.
1. A escuta do provedor é encerrada, e a prévia monta depois (2 escutas abertas): a prévia fica com `refreshFailed: false`, e o provedor com `true`.
2. O "Tentar de novo" da prévia abre a 3ª escuta, e o provedor continua com `true`.
3. A prévia é fechada, e chega uma receita nova de outra sessão: 0 chamadas. O provedor fica em 1.056.000 centavos de renda (seriam 1.106.000), ainda com a ressalva.

**Testes.** Os dois testes da escuta com erro usam uma instância só (`report-basis-sync.test.ts:522-542`; `work-time-income-estimate.test.ts:350-364`). Nenhum cobre provedor e prévia.

**Correção sugerida:**
- Fazer a reabertura alcançar todas as estimativas do uid e do workspace. Por exemplo, uma "geração da escuta" no registro, aumentada por qualquer "Tentar de novo" e incluída nas dependências do efeito.
- Ou oferecer o "Tentar de novo" da estimativa em uso em Configurações, junto de "Valor em uso agora", quando `savedEstimate.refreshFailed`.
- Opcional: reabrir a escuta sozinho depois de uma leitura bem-sucedida da base.
- Teste de gancho com duas instâncias: a escuta do provedor falha, e o "Tentar de novo" da prévia precisa limpar o aviso do provedor (ou o botão do provedor precisa existir).

### R6-02 — LOW: a releitura pedida pela mutação chega fora do protocolo de retenção e reabre o caso misto inverso (base nova, exclusões antigas); com a escuta encerrada, o valor misto fica preso

**Local:**
- `src/modules/transactions/incomeReads.ts:41-53` e `src/modules/reports/basisRegistry.ts:50-55`: a mutação só chama `scheduler.notify()`, sem pedido, retenção ou liberação depois;
- `src/modules/reports/basisSync.ts:273-301,327-330`: a comparação roda num efeito, depois da renderização que já mostra a base nova;
- `src/modules/work-time/useIncomeEstimateWith.ts:98-111,219-221`: com `holding` falso, essa renderização vira a última estimativa pronta;
- `src/modules/reports/basisRefresh.ts:40-52`: as tentativas por assinatura;
- teste que não cobre essa ordem: `tests/unit/work-time-income-estimate.test.ts:240-274` (a releitura da mutação volta igual, porque "o gatilho ainda não gravou").

**O que acontece.**
1. A mutação nesta aba relê as bases carregadas do workspace pelo agendador, 5 s depois (agrupamento), sem abrir um pedido.
2. Se o gatilho já gravou a projeção quando a callable lê, a base volta nova. Se ela chega antes do retorno da escuta, a renderização dela sai com `holding` falso: não há pedido nem marco. A tela mostra a base nova com a leitura por id antiga, e `holdEstimate` guarda esse estado como a última estimativa pronta.
3. Só no efeito seguinte a comparação vê a base nova diferente da projeção velha e abre um pedido. A retenção passa a segurar justamente o valor misto, até a liberação e a nova leitura por id. O pedido ainda zera as falhas e agenda mais uma callable, que volta igual.
4. **Com a escuta viva**, a liberação vem com o retorno dela (convergência). O valor misto dura até esse retorno e a leitura por id que o segue.
5. **Com a escuta encerrada** (R6-01 ou qualquer erro terminal), `projected` continua com a última projeção recebida.
   - A primeira mutação que muda a receita é comparada com essa projeção morta. Ela paga duas releituras a mais e mostra o valor misto até elas acabarem.
   - A partir da segunda, as tentativas daquela assinatura já se esgotaram (`basisRefresh.ts:50`): não há pedido nem liberação, e a leitura por id não é mais relida. O valor misto fica até o "Tentar de novo", que para o provedor não existe (R6-01), a virada do mês, outra janela ou uma recarga.
   - A tela mostra o aviso de que a estimativa "usa a leitura anterior", mas o valor mostrado não é nenhuma leitura anterior.

**Cenário concreto.**
- *Escuta viva:* a pessoa anula, em Lançamentos, a receita de R$ 500,00 que tinha desconsiderado. O gatilho, numa partida a frio, grava a projeção uns 5 s depois, enquanto a callable agendada pela mutação está em curso. A callable lê a projeção já gravada e responde antes do retorno da escuta. A renda elegível cai de R$ 10.560,00 para R$ 10.060,00 (os R$ 500,00 descontados de um total que já não os tem) e volta quando a escuta e a leitura por id chegam, em menos de 1 s. É raro: a gravação precisa cair na janela de leitura da callable.
- *Escuta encerrada:* uma receita nova de R$ 1.000,00 e, depois, a anulação da desconsiderada, as duas nesta aba. Depois da segunda, a estimativa fica em R$ 11.060,00 em vez de R$ 11.560,00, sem prazo para voltar.

**Sondas.** React Query real, API em memória, agrupamento de 50 ms.

| Sonda | Situação | Renda mostrada (centavos) | Leituras |
| --- | --- | --- | --- |
| P2 | escuta viva; a base nova chega 120 ms antes do retorno da escuta | 1.056.000 → **1.006.000** → 1.056.000 | 3 callables; 2 leituras por id |
| P3 | escuta encerrada; uma mutação muda a receita | 1.056.000 → **1.006.000** (de 66 ms a 203 ms) → 1.056.000 | 4 callables: a carga, a mutação e 2 contra a projeção morta |
| P3b | escuta encerrada; receita nova e depois a anulação da desconsiderada | depois da 2ª: 1.156.000 → **1.106.000**, sem voltar (o certo seria 1.156.000) | a leitura por id fica em 2; `refreshFailed: true` |

**Correção sugerida:**
- Tratar a leitura nova da base que chega sem pedido e muda a receita como "à frente das leituras": segurar já na renderização, e não só no efeito, e liberar em seguida, relendo as leituras de receitas, como o pedido da escuta faz.
- Ou fazer a mutação abrir um pedido em cada estimativa do workspace, com retenção, e liberar sem reler a leitura por id quando a base voltar igual.
- Com a escuta encerrada, descartar `projected`, para não comparar com uma projeção morta.
- Testes de gancho com o gatilho gravando antes da releitura da mutação e a escuta chegando depois, viva e encerrada. Conferir que nenhuma renderização é mista e que a leitura por id vem depois da base.

### R6-03 — LOW: as releituras pedidas pelas mutações gastam o orçamento por base que a escuta usa; depois de cinco rajadas, a sincronização seguinte espera até 120 s

**Local:**
- `src/modules/transactions/incomeReads.ts:41-53` e `src/modules/reports/basisRegistry.ts:50-55`;
- `src/modules/reports/basisSync.ts:121-133`: um agendador por base, o mesmo da escuta;
- `src/modules/reports/liveRefresh.ts:43-63` e `src/modules/reports/queryKeys.ts:36-40`: agrupamento de 5 s, 5 seguidas e 1 a cada 120 s;
- quem chama: `invalidateTransactionDependents` (`transactions/hooks.ts:25-37`) nas mutações de lançamentos, cartões, empréstimos, recorrentes, divisões, clientes e contas, e `investments/simple/api.ts:144`;
- documentos: `VEREDITOS.md:68` e `elegibilidade-receitas.md:50` (custo) e os riscos do plano (`:4797-4813`), que não tratam do atraso.

**O que acontece.**
1. Toda rajada de mutação com espelho de caixa no workspace-fonte gasta uma ficha de cada base carregada dele. É uma por rajada separada por mais de 5 s, seja despesa, compra no cartão, transferência ou empréstimo.
2. Depois de 5 rajadas, a próxima releitura espera a reposição, de 1 ficha a cada 120 s.
3. O pedido da escuta para uma mudança real de receita usa o mesmo agendador e espera junto. Enquanto isso, `syncing` segura o valor anterior, sem nenhum sinal na tela.
4. No código da revisão 5, as mutações não gastavam o orçamento; no desenho da revisão 4, gastavam, pela invalidação das bases.

**Sonda P6.** Orçamento em escala: agrupamento de 20 ms, 5 seguidas e 1 a cada 1.500 ms.
- Sem rajadas antes, uma receita nova de outra sessão aparece em 30 ms.
- Depois de 6 rajadas de mutação (5 callables), a mesma receita leva 1.209 ms. Na escala real, isso é até cerca de 120 s.

**Cenário concreto.** No modo tempo, a pessoa lança cinco despesas seguidas e, em seguida, uma receita. Ou outro membro lança uma receita logo depois. A estimativa em uso fica com o valor anterior por até cerca de 2 min.

**Correção sugerida:**
- Tirar a releitura da mutação do orçamento da escuta: um orçamento próprio, ou um agrupamento bem mais longo (por exemplo, uma por minuto).
- Ou reler pela mutação só quando a escuta não pediu nada nos segundos seguintes, que é o caso do gatilho que desiste.
- Registrar o atraso no modelo de custo e nos riscos.

### R6-04 — LOW: o teste novo "leitura por id antiga…" é intermitente, e a contagem de mutantes depende dele; U102 ficou equivalente e consta como morto

**Local:**
- `tests/unit/work-time-income-estimate.test.ts:296-328` (a asserção é a de `:327`) e a leitura por id do dublê (`:181-189`, `await wait(2)` em `:184`);
- `src/modules/transactions/incomeReads.ts:27-30` (`cancelRefetch: false`) e `src/modules/reports/basisSync.ts:254,275`;
- registro do autor, fora da árvore: `p5f1/logs/mutantes-unit-r5.log:102`, com U102 morto.

**O que acontece.**
1. A última asserção, `f.byIdReads === 2`, supõe que as liberações do provedor e da prévia dividem uma única leitura por id.
2. Neste ambiente de teste (react-test-renderer no modo legado e `until` em passos de 5 ms), as duas estimativas renderizam em passos diferentes do `act`. Instrumentei: as duas liberações saem com uns 5 ms entre si (por exemplo, aos 797,8 ms e aos 803,5 ms).
3. A leitura do dublê dura 2 ms. Quando ela termina antes da segunda liberação, há uma terceira leitura, e o teste reprova com "3 !== 2".

**Medido:**
- `test:unit:work-time` (88 testes) reprovou em 7 de 20 execuções, sempre nessa asserção;
- o arquivo sozinho, em 10 de 27;
- `test:unit:reports`, em 0 de 15;
- com a leitura do dublê em 20 ms (troca em memória), 0 de 15.

No produto, a raiz do React 18 agrupa as atualizações, e a leitura por id leva pelo menos uma ida ao servidor. As duas liberações dividem a leitura, e não há defeito do produto.

**Consequências:**
- O `verify:all`, que roda `test:unit:work-time`, passa ou reprova por sorte. As execuções do autor passaram (`test:unit:work-time-r5.log` e `-r5b.log`, "ok 74"), assim como o `verify-all-final.log` que estava em curso sobre `80b73832`. O novo `verify:all`, sobre `ff45884e`, roda o mesmo teste.
- Um mutante testado só contra `work-time-income-estimate` pode morrer por esse teste, sem que nenhuma outra asserção o pegue. Nas minhas rodadas, 129 dos 130 reprovam por asserção determinística.
- U102 (base carregando não pede releitura, `basisSync.ts:275`) sobrevive em 6 de 6 execuções. Desde esta rodada, `request` já retorna com `current === null` (`:254`), e isso torna o mutante equivalente (meu M8, que tira essa guarda, também sobrevive). O registro do autor o dá como morto, e o teste intermitente explica: ele está num dos dois arquivos de U102. O "130/130" não vale.

**Correção sugerida:**
- Tornar o teste determinístico sem enfraquecê-lo: a leitura por id do dublê mais longa que o passo do `act` (20 ms bastam) ou a ordem das leituras conferida pelo registro, como em `:366-385`.
- Trocar U102 por um mutante que tire as duas guardas (`:275` e `:254`), ou retirá-lo como equivalente.
- Rodar de novo os mutantes e registrar o resultado.

### R6-05 — INFO: imprecisões dos documentos e dos comentários

**Local:** plano `:4764,4813`, `DATA_MODEL.md:277`, `VEREDITOS.md:45,60,68`, `elegibilidade-receitas.md:50`, `autorizacao-isolamento.md:42-43`, `respostas-revisao-5.md:21` e o comentário do `useQuery` da base em `r7-sobre-r6.diff` (`basisSync.ts:117-120` da árvore `ff45884e`).

1. **"O 'Tentar de novo' a reabre."** É o que dizem o plano, o `DATA_MODEL`, os vereditos, a elegibilidade, a autorização e a resposta. Só vale para a instância cujo botão foi usado, e o do provedor não está em nenhuma tela (R6-01).
2. **"Depois de 2 releituras falhas, a base espera … uma montagem nova ou o 'Tentar de novo'"** (plano `:4813`). Com outra estimativa usando a base, por exemplo o provedor, que fica montado com a função ligada, a montagem da prévia não relê nada.
   - Sonda P5: base parada no teto, consulta invalidada e em erro. A montagem de uma segunda estimativa fez 0 chamadas, e a primeira continuou em `syncing`.
   - O comentário novo de `BASIS_RETRIES_AFTER_ERROR` (árvore `ff45884e`) já diz isso certo ("a contagem só recomeça do zero quando nenhuma estimativa ligada usa mais a base"), mas o plano não acompanhou.
   - Na elegibilidade (`:50`), "só uma projeção nova no workspace" ficou para trás: desde esta rodada, é uma projeção nova da própria estimativa.
3. **Comentário novo do `useQuery` da base:** "a desatualizada que volta a ser usada (chave trocada ou estimativa religada) é lida na hora, como o React Query faz com qualquer consulta desatualizada que volta a ser observada".
   - Os dois exemplos estão certos: num observador já montado, a troca de chave e o `enabled` que volta a `true` passam por `shouldFetchOptionally` (`queryObserver.js:97-105,418-420`).
   - A generalização não está: com `refetchOnMount: false`, um observador novo não lê na montagem a base desatualizada que tem dado (`onSubscribe` → `shouldFetchOnMount`, `:46-54,408-410`).
   - Quem a relê, nesse caso, é o efeito da base, pelo agendador: 5 s depois, e só abaixo do teto. A sonda P4 (prévia montada depois da virada do mês, com o provedor desligado) mostrou 1 chamada pelo agendador; a P5, 0 no teto.
4. **Reconstrução marcada por mutação de outra sessão ou de outro membro.** A releitura da mutação só cobre as mutações desta aba (`incomeReads.ts:41-53`). Com outra origem, a estimativa continua "pronta" com os totais anteriores, enquanto o Dashboard mostra o relatório em reconstrução (o caso 1 de R5-02). O plano (`:4764`) diz que a releitura da mutação "cobre o gatilho que desiste…" sem esse limite, e os riscos não o registram.
5. **Modelo de custo** (`VEREDITOS.md:68`; `elegibilidade-receitas.md:50`). Não cita duas coisas: a disputa com o orçamento da escuta (R6-03) e, com a escuta encerrada, as duas callables a mais por mutação que muda a receita (R6-02).

**Correção sugerida:** ajustar os textos acima e o comentário (por exemplo: "um observador novo não lê na montagem; a base desatualizada que volta a ser usada pela mesma estimativa é lida na hora, e a de uma estimativa que monta é relida pelo agendador") e registrar o limite da reconstrução nos riscos.

### R6-06 — INFO: a evidência dos mutantes desta rodada ainda não está na árvore

**Local:** `docs/production/evidence/p5f1/mutantes.py.txt`, `mutantes.md:1-150`, `LEIAME.md:25`, `execucoes.md` (linha "Mutantes da revisão 5", com o marcador ⟦MUT-R5⟧) e `respostas-revisao-5.md:20-23`.

**O que acontece:**
- `mutantes.py.txt` ainda é a versão da revisão 4, com 115 mutantes e o mesmo SHA-256 da de `snapshot-r5` (`86dda8d1…`).
- `atualizar-mutantes-r5.py.txt` não está na árvore, e o LEIAME só lista o da revisão 4.
- `mutantes.md` termina em U115.
- As respostas citam U116 a U130 como mortos; só o resultado da execução é marcador a preencher.

Reconstruí a lista em memória, como descrito no método. A lista existe fora da árvore, em `p5f1/mutantes.py` e `p5f1/atualizar-mutantes-r5.py`.

**Correção sugerida:** copiar o roteiro atualizado e o de atualização para a árvore, gerar de novo a tabela com o resultado da rodada (incluindo U102, R6-04) e citar o de atualização no LEIAME.

## 3. Verificado sem achado

1. **Ganchos, unitários, guarda e mutantes.**
   - Unitários puros 128/128. `test:unit:reports` 67/67 em 15 de 15 execuções. Os 27 testes de `report-basis-sync` e `work-time-income-estimate` passam, salvo a intermitência de R6-04.
   - Nada foi enfraquecido. As asserções subiram de 147 para 154 na guarda, de 44 para 65 em `report-basis-sync` e de 20 para 29 em `work-time-income-estimate`.
   - As asserções que saíram foram trocadas por equivalentes do código novo ou mais fortes: registro, `loaded`, `staleTime` com `refetchOnMount` e `refetchOnReconnect`, `refreshFailed` e o invólucro, agora proibido. A contagem `[2, 2]` virou `[3, 2]` pela releitura nova da mutação.
   - Não há `skip` nem `only`, e os prazos são os mesmos.
   - Mutantes meus:

     | ID | Mutação | Resultado |
     | --- | --- | --- |
     | M1 | sem `setListenFailedKey(null)` no efeito (`basisSync.ts:311`) | morto (os dois testes da escuta com erro) |
     | M2 | `listenFailed` sem conferir a chave (`:341`) | sobrevive: o efeito limpa o aviso logo depois da troca; só a renderização intermediária mudaria |
     | M3 | o pedido sem marcar as próprias bases (`:258-260`) | morto (teto de falhas) |
     | M4 | `>=` → `>` no teto da mutação (`basisRegistry.ts:52`) | morto |
     | M5 | registro sem o workspace da base (`basisSync.ts:130`) | morto |
     | M6 | base com `refetchOnReconnect` (`:115`) | morto só pela guarda |
     | M7 | `rereadWorkspaceBases` dentro do `Promise.all` | morto só pela guarda (comportamento igual) |
     | M8 | `request` sem a guarda `current === null` (`:254`) | sobrevive: equivalente, pela guarda de `:275` (ver U102 em R6-04) |

2. **Leitura por id sem prazo: nada fica desatualizado sem fim, salvo R6-01 e R6-02.**
   - Toda liberação relê as leituras em uso e invalida as inativas (`incomeReads.ts:27-30`). A chave inativa invalidada é relida quando volta a ser observada, depois de a base alcançar a projeção. A não invalidada some em 5 min (`gcTime` padrão; o `QueryClient` só muda `staleTime` e `refetchOnWindowFocus`, `App.tsx:116-123`).
   - A troca de conta e o logout limpam o cache (`AuthContext.tsx:75,111`).
   - Sem exclusões, `reads` é nulo, e não há marco.
   - A estimativa desligada e religada relê a base invalidada na hora (`shouldFetchOptionally`), e a escuta reaberta compara de novo.
   - Outro membro que edita um desconsiderado muda a projeção, e a escuta sincroniza.
   - Resíduo aceito: duas mudanças no mesmo mês que se anulam antes de a escuta ver o estado intermediário. A parcela da exclusão fica velha até a próxima liberação; antes, até a releitura de 5 min na montagem. A classificação só usa campos que mexem na projeção (`incomeBasis.ts:60-86`), e a edição é feita no próprio documento.
3. **Bases sem releitura na montagem e na volta da rede.**
   - A base sem dado carrega na montagem (`shouldLoadOnMount`, `queryObserver.js:405-407`), e a que nunca carregou continua fora do agendador.
   - A que volta a ser usada pela mesma estimativa é lida na hora. A de uma estimativa que monta é relida pelo agendador (P4).
   - O "Tentar de novo" chama `refetch` direto e não depende dessas opções.
   - O erro de uma releitura pedida pela escuta mantém a consulta invalidada (`query.js:306-320`). O efeito conta a falha e volta a pedir até o teto. Sem a volta da rede, a base parada no teto espera a projeção nova, a virada do mês ou o "Tentar de novo", sempre com aviso.
   - Sem rede, a busca fica pausada e continua na volta (`query.js:88`), com qualquer valor de `refetchOnReconnect`.
4. **Escuta com erro, fora de R6-01.**
   - O aviso aparece no erro e some na troca de janela, de workspace ou de conta e ao desligar: o efeito o limpa (`basisSync.ts:311`), e a chave é conferida (`:341`).
   - O "Tentar de novo" desfaz a escuta antiga antes de abrir a nova (a limpeza roda antes do efeito; `report-basis-sync.test.ts:537`).
   - Uma escuta reaberta volta a comparar: a receita nova relê a base (`:538-541`).
   - Com a escuta saudável, o "Tentar de novo" a reabre: são até 13 leituras a mais, por clique.
5. **Releitura só das bases da própria estimativa.** Cada estimativa tem a própria escuta, na própria janela. Uma mudança num mês que só uma das janelas tem só interessa a essa estimativa. As chaves da vista (`basisKeyOf`, `useIncomeEstimateWith.ts:148-150`) são as do registro e do cache (`basisSync.ts:67-73,102`), e a invalidação exata as encontra. Não achei caso, com as duas escutas vivas, em que uma estimativa precise das bases da outra.
6. **Sem laço.** A releitura da mutação não zera falhas, a que falha não é contada nem pede outra, e a divergência continua limitada a 2 releituras por estado. Com a base sem bloco exato, a releitura é uma por mudança do servidor.
7. **Isolamento.**
   - `rereadWorkspaceBases` filtra pelo workspace da base (`basisRegistry.ts:52`).
   - O registro só tem bases do uid em uso: os efeitos as removem, e o logout limpa o cache.
   - A escuta das projeções exige membro com leitura e `limit` até 600 (`firestore.rules:788-794`).
   - Nada é gravado.
8. **Liberações e custo, fora de R6-03 e R6-05.**
   - As três condições de liberação descritas batem com o código.
   - A janela do painel relida a cada liberação, até 2.505 documentos, agora está no modelo e nos riscos (plano `:4810`).
   - O risco da escrita no meio de uma sincronização foi corrigido (`:4802`).
9. **Comentários da árvore `ff45884e`, fora do item 3 de R6-05.**
   - O de `BASIS_PERIODS_MAX` está certo: a janela tem no máximo 12 meses (os completos do histórico, ou só o corrente; `estimate.ts:100-114`).
   - O de `BASIS_RETRIES_AFTER_ERROR` também. A volta da rede não relê (`query.js:85-89`), e a montagem de outro observador também não (`queryObserver.js:46-54`); se a base estiver desatualizada e abaixo do teto, o efeito do primeiro observador já a pediu. A contagem recomeça quando o registro é refeito, sem nenhum usuário (`basisSync.ts:137-143`).
   - A guarda continua passando com os comentários novos.
10. **Plano e modelos.** O §20.15 continua "aguardando auditoria independente", sem marcar o gate da P5 nem P6–P10 (`:4820`). Os marcadores `⟦…⟧` são preenchidos depois do gate e não foram avaliados.

## Notas

- **TanStack Query 5.0.0** (`wt-p5f1/node_modules/@tanstack/query-core/build/modern`):
  - desatualizada é a consulta invalidada, sem dado ou vencida (`query.js:77-79`);
  - um observador novo só busca na montagem pela `refetchOnMount`, salvo sem dado (`queryObserver.js:46-54,405-414`);
  - a troca de chave e o `enabled` que volta a `true` buscam a consulta desatualizada por `shouldFetchOptionally`, sem olhar `refetchOnMount` (`:97-105,418-420`);
  - a volta da rede relê pelo primeiro observador que aceita e continua a busca pausada (`query.js:85-89`);
  - o redutor de erro mantém `isInvalidated`, e o de sucesso o zera (`:291-320`).
- **React 18.2 e react-test-renderer:** neste ambiente de teste (modo legado, `act` assíncrono em passos de 5 ms), duas estimativas que observam a mesma consulta renderizam em passos diferentes. É a causa de R6-04, não um comportamento do produto.
- **SDK Firestore 12.8.0:** o erro de uma escuta é terminal (`index.d.ts:1764-1765` e equivalentes das consultas).
- **Tempos.** Os tempos reais (gatilho, partida a frio, callable, retorno da escuta) são inferidos, não medidos no navegador. As sondas usam agrupamento e orçamento em escala.
- **Sondas rodadas sem criar arquivo:** P1 a P6 e P3b, como testes acrescentados em memória aos módulos de teste, e a instrumentação do teste intermitente.
- **Não rodei** o E2E nem as Rules: exigem build e Emulator.
- **Impacto.** Nenhum achado novo grava, altera ou expõe dado financeiro. Todos tratam da estimativa informativa, do custo, dos testes ou dos documentos.
