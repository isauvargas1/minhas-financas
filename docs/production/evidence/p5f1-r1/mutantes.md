# P5-F.1-R1 — mutantes

Cada mutante altera uma regra do delta da R1. Ele só conta como morto quando o teste indicado **reprova** com ele.

**Unidade** (`roteiros/mutantes-r1.py.txt`, runner do Node, sem Emulator):
- cada mutação troca um trecho exato, de uma única ocorrência;
- o arquivo volta byte a byte, e o script confere;
- `run-mutantes.sh` registra o SHA-256 de todos os arquivos de `src/`, `tests/` e `e2e/` e o `git status` antes e depois de cada rodada (`logs/execucoes/mutantes-r1-*.sha-*` e `*.status-*`);
- um mutante que não compila (esbuild, o mesmo da build) não conta como morto.

**Rodada final:**
- **U1 a U73** (`mutantes-r1-rev2.log`, 940 s): **73/73 mortos** e 0 que não compilam, sobre o `src/` final. O SHA-256 dos 407 arquivos e o `git status` são iguais antes e depois.
- **U74 e U75**, os mutantes do limite da espera pela hora do servidor, pedidos pela revisão 3 (P01), e **de novo U69 a U71** com os testes novos (`mutantes-r1-rev3.log`): **5/5 mortos**, com SHA-256 e `git status` iguais.
- **U76 e U77**, da correção do Q02 (revisão 4), e **de novo U56** (`mutantes-r1-rev4.log`): **3/3 mortos**, com SHA-256 e `git status` iguais. U56 é o único de U1 a U75 que muda um dos dois arquivos alterados pela correção.
- Entre a rodada completa e a última, o `src/` mudou só em `RoutineEditor.tsx` e `WorkTimeSettingsView.tsx` (Q02). Os outros mutantes mudam arquivos iguais aos da rodada completa, e os testes só ganharam asserções: um teste a mais só pode matar mais.

**Total: 77/77 mortos.**

**Histórico:**
- **Rodada anterior** (U1 a U67, `mutantes-r1-final.log`, código da árvore `d7dabb10`): 65/67.
  - U13 sobreviveu: nenhum teste tinha a véspera ocupando o dia civil num dia de jornada reduzida com acréscimos. Ganhou o caso no N02 de `work-time-calendar.test.ts` e mostrou o caso da véspera em jornada reduzida (`rotinas-matematica.md` §6), hoje declarado aberto, que tem teste próprio.
  - U53 não compilava: a mutação deixava um `else` solto e foi trocada por uma que compila.
  - Na rodada só dos dois (`mutantes-r1-final-b.log`): 2/2 mortos.
- **Revisão independente 2:**
  - U68 é o mutante que a revisão achou vivo (M03, `windowPart` ≥ 0). Agora é morto pelo teste do intervalo da véspera coberto pelo dia.
  - U69 a U71 cobrem a espera pela hora do servidor (M02).
  - U72 cobre a data fora do formato (M06), e U73, a ordem dos pares (M07).
  - O trecho de U54 foi atualizado para a linha nova de `validateDraft`, que mudou com M06.
- **Revisão independente 3:** o mutante dela, que encerrava a espera 1 ms depois da escrita, passava em toda a suíte (P01). Agora é U74, morto pelos testes do N03 com a hora do servidor e de 59 s. U75 (`<` no lugar de `<=`) é morto pelo de 60 s. A revisão 4 conferiu isso (Q04: a versão anterior desta linha dizia que U74 morria nos três).
- **Revisão independente 4 (Q02):** U76 é o comportamento anterior da tela (qualquer recusa do editor põe Configurações em edição), e U77, o editor que nunca informa edição. A guarda mata os dois, e o E2E do B02 mata os equivalentes (q02a e q02b).

**E2E** (`roteiros/e2e-mutante-r1.py.txt`, `e2e-mutantes-r1.sh.txt` e `e2e-mutantes-q02.sh.txt`, build novo para cada um): **5/5 mortos**. b01, b02 e n07 rodaram antes da correção do Q02 (`e2e-mutantes-rev2b`); os arquivos que eles mudam não mudaram depois, e o teste do B02 só ganhou passos no fim. q02a e q02b rodaram com a correção (`e2e-mutantes-q02`). O SHA-256 dos 407 arquivos de `src/`, `tests/` e `e2e/` e o `git status` são iguais antes e depois.

| Mutante | Mutação | Teste E2E | Resultado |
| --- | --- | --- | --- |
| b01 | `incomeBasis.ts`: o recebimento com estorno confirmado volta a contribuir (a exclusão desconta de novo) | `B01 (P5-F.1-R1)` | MORTO |
| b02 | `calendar.ts`: o intervalo das janelas que se cruzam volta a ser descontado por janela | `B02 (P5-F.1-R1)` | MORTO |
| n07 | `draft.ts`: salvar confere o calendário sem as exceções | `B02 (revisão da R1, N07)` | MORTO |
| q02a | `WorkTimeSettingsView.tsx`: qualquer recusa do editor de rotinas põe a tela em edição (o comportamento anterior) | `B02 (P5-F.1-R1)`: reprova logo depois do `reload` (falta "Valor estimado da sua hora") | MORTO |
| q02b | `RoutineEditor.tsx`: o editor nunca informa edição | `B02 (P5-F.1-R1)`: reprova na edição de verdade (falta "Prévia com as alterações") | MORTO |

A rodada anterior (`e2e-mutantes-rev2`) foi interrompida pelo reinício do contêiner no meio do mutante b01. O arquivo foi restaurado e conferido por SHA-256, e a rodada foi repetida inteira (`logs/execucoes/incidente-reinicio-conteiner.log`). Na árvore `d7dabb10`, antes da revisão 2, os três também eram mortos (`e2e-mutantes-final`).

<!-- tabela -->

| # | Grupo | Arquivo | Mutação | Testes | Resultado |
| --- | --- | --- | --- | --- | --- |
| U1 | B02 | `src/modules/work-time/calendar.ts` | a cobertura de uma janela com intervalo passa a aceitar outras janelas com intervalo | `work-time-calendar.test.ts` | MORTO |
| U2 | B02 | `src/modules/work-time/calendar.ts` | a janela com intervalo cruzada e não coberta deixa de tornar o dia ambíguo | `work-time-calendar.test.ts` | MORTO |
| U3 | B02 | `src/modules/work-time/calendar.ts` | o cruzamento entre janelas do próprio dia deixa de ser conferido | `work-time-calendar.test.ts` | MORTO |
| U4 | B02 | `src/modules/work-time/calendar.ts` | a janela isolada conta sem descontar o intervalo | `work-time-calendar.test.ts` | MORTO |
| U5 | B02 | `src/modules/work-time/calendar.ts` | os minutos em comum com a véspera deixam de ser descontados (contados duas vezes) | `work-time-calendar.test.ts` | MORTO |
| U6 | B02 | `src/modules/work-time/calendar.ts` | janelas idênticas (mesmo início, fim e intervalo) contam duas vezes | `work-time-calendar.test.ts` | MORTO |
| U7 | B02 | `src/modules/work-time/calendar.ts` | o feriado de folga deixa de suspender a ambiguidade do dia | `work-time-calendar.test.ts` | MORTO |
| U8 | B02 | `src/modules/work-time/calendar.ts` | o conferidor percorre só 7 dias, e não o período conjunto das rotinas (ciclos) | `work-time-calendar.test.ts`, `work-time-preference.test.ts` | MORTO |
| U9 | B02 | `src/modules/work-time/estimate.ts` | a estimativa calcula mesmo com dia ambíguo na janela | `work-time-estimate.test.ts` | MORTO |
| U10 | B02 | `src/modules/work-time/calendar.ts` | teto da P5-F.1: minutos sem horário até 24 h, sem descontar a ocupação das janelas | `work-time-calendar.test.ts` | MORTO |
| U11 | B02 | `src/modules/work-time/calendar.ts` | o primeiro dia do período desconta a véspera, que fica fora da janela | `work-time-calendar.test.ts` | MORTO |
| U12 | B02 | `src/modules/work-time/estimate.ts` | a estimativa não abre o período no primeiro mês da janela | `work-time-estimate.test.ts`, `work-time-calendar.test.ts` | MORTO |
| U13 | B02 | `src/modules/work-time/calendar.ts` | a ocupação do dia civil ignora o trecho depois da meia-noite das janelas da véspera | `work-time-calendar.test.ts` | MORTO |
| U14 | B02 | `src/modules/work-time/draft.ts` | salvar aceita rotinas sem cálculo seguro | `work-time-preference.test.ts` | MORTO |
| U15 | B01 | `src/modules/work-time/receivableReversal.ts` | o id do espelho do estorno derivado com outro sufixo (paridade com o backend) | `work-time-estimate.test.ts`, `work-time-consistency.test.ts` | MORTO |
| U16 | B01 | `src/modules/work-time/receivableReversal.ts` | a leitura por id deixa de ler os pares (recebimento e estorno) | `work-time-estimate.test.ts`, `work-time-consistency.test.ts` | MORTO |
| U17 | B01 | `src/modules/work-time/incomeBasis.ts` | o estorno aceito sem conferir `reversalOf` | `work-time-estimate.test.ts` | MORTO |
| U18 | B01 | `src/modules/work-time/incomeBasis.ts` | o estorno aceito em outro mês | `work-time-estimate.test.ts` | MORTO |
| U19 | B01 | `src/modules/work-time/incomeBasis.ts` | aceito o documento cujo movimento difere do derivado do id | `work-time-estimate.test.ts` | MORTO |
| U20 | B01 | `src/modules/work-time/incomeBasis.ts` | o recebimento estornado continua contribuindo (a exclusão desconta de novo) | `work-time-estimate.test.ts`, `work-time-consistency.test.ts` | MORTO |
| U21 | B01 | `src/modules/work-time/estimate.ts` | a estimativa calcula com exclusão não confirmada | `work-time-estimate.test.ts` | MORTO |
| U22 | B03 | `src/modules/work-time/consistency.ts` | regra 2: sem projeção confirmada, a prova passa | `work-time-consistency.test.ts`, `work-time-income-estimate.test.ts` | MORTO |
| U23 | B03 | `src/modules/work-time/consistency.ts` | regra 3: a receita das bases deixa de ser comparada com a projeção | `work-time-consistency.test.ts`, `work-time-income-estimate.test.ts` | MORTO |
| U24 | B03 | `src/modules/work-time/consistency.ts` | regra 4: aceita a leitura por id que começou na mesma ordem da versão vista | `work-time-consistency.test.ts` | MORTO |
| U25 | B03 | `src/modules/work-time/consistency.ts` | regra 4 desligada | `work-time-consistency.test.ts`, `work-time-income-estimate.test.ts` | MORTO |
| U26 | B03 | `src/modules/work-time/consistency.ts` | regra 5: escrita conhecida aceita sem comparar com a versão do mês | `work-time-consistency.test.ts` | MORTO |
| U27 | B03 | `src/modules/work-time/consistency.ts` | a criação da desconsiderada sai das escritas conhecidas | `work-time-consistency.test.ts` | MORTO |
| U28 | B03 | `src/modules/work-time/consistency.ts` | a confirmação de caixa sai das escritas conhecidas | `work-time-consistency.test.ts` | MORTO |
| U29 | B03 | `src/modules/work-time/consistency.ts` | a anulação sai das escritas conhecidas | `work-time-consistency.test.ts` | MORTO |
| U30 | B03 | `src/modules/work-time/consistency.ts` | o espelho do estorno (B01) sai das escritas conhecidas | `work-time-consistency.test.ts` | MORTO |
| U31 | B03 | `src/modules/work-time/consistency.ts` | uma leitura por id mais velha que chega depois volta o estado observado | `work-time-consistency.test.ts` | MORTO |
| U32 | B03 | `src/modules/work-time/consistency.ts` | a mudança vista entre duas leituras por id deixa de virar escrita conhecida | `work-time-consistency.test.ts` | MORTO |
| U33 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | sem prova, o estado atual é mostrado (sem a última provada nem o estado sem conversão) | `work-time-income-estimate.test.ts`, `work-time-consistency.test.ts` | MORTO |
| U34 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | a identidade da estimativa sem a conta e sem a janela | `work-time-income-estimate.test.ts` | MORTO |
| U35 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | a leitura por id começa antes do primeiro retorno do servidor à escuta | `work-time-consistency.test.ts` | MORTO |
| U36 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | a retenção ignora a prova | `work-time-consistency.test.ts`, `work-time-income-estimate.test.ts` | MORTO |
| U37 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | a releitura por id agendada pela versão nova desligada | `work-time-consistency.test.ts`, `work-time-income-estimate.test.ts` | MORTO |
| U38 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | com a escuta encerrada, o "Tentar de novo" relê por id na hora | `work-time-income-estimate.test.ts`, `work-time-guard.test.ts` | MORTO |
| U39 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | a escuta encerrada sem a mensagem de falha | `work-time-consistency.test.ts` | MORTO |
| U40 | B03 | `src/modules/reports/basisSync.ts` | a versão `updatedAt` da projeção nunca é lida | `work-time-consistency.test.ts` | MORTO |
| U41 | B03 | `src/modules/reports/basisSync.ts` | a projeção confirmada não é descartada no erro da escuta | `work-time-consistency.test.ts`, `work-time-income-estimate.test.ts` | MORTO |
| U42 | B03 | `src/modules/reports/basisRegistry.ts` | a ordem de chegada da primeira versão do mês no lugar da versão atual | `work-time-consistency.test.ts`, `work-time-income-estimate.test.ts` | MORTO |
| U43 | B03 | `src/modules/reports/hooks.ts` | `updatedAt` deixa de ser passado pela escuta do Firebase | `work-time-guard.test.ts` | MORTO |
| U44 | B02 | `src/modules/work-time/calendar.ts` | N01/N02: em dia de jornada reduzida, os minutos depois da meia-noite não contam no teto (como na árvore revisada) | `work-time-calendar.test.ts` | MORTO |
| U45 | B02 | `src/modules/work-time/calendar.ts` | N02: as janelas do próprio dia não ocupam o dia civil (o teto de 25 h 40 min) | `work-time-calendar.test.ts` | MORTO |
| U46 | B02 | `src/modules/work-time/calendar.ts` | N01: o dia de jornada reduzida não é tratado como dia em que a rotina acontece | `work-time-calendar.test.ts` | MORTO |
| U47 | B02 | `src/modules/work-time/calendar.ts` | N07: os dias vizinhos de dia sem a rotina deixam de ser conferidos | `work-time-calendar.test.ts`, `work-time-preference.test.ts` | MORTO |
| U48 | B02 | `src/modules/work-time/calendar.ts` | N07: o primeiro dia de cada mês é conferido com a véspera (sem a abertura do período) | `work-time-calendar.test.ts`, `work-time-preference.test.ts` | MORTO |
| U49 | B02 | `src/modules/work-time/calendar.ts` | N07: os feriados nacionais deixam de entrar entre os dias sem a rotina | `work-time-calendar.test.ts`, `work-time-preference.test.ts` | MORTO |
| U50 | B02 | `src/modules/work-time/calendar.ts` | N07: as exceções de intervalo (férias, folga, ausência, jornada reduzida) deixam de entrar | `work-time-calendar.test.ts`, `work-time-preference.test.ts` | MORTO |
| U51 | B02 | `src/modules/work-time/calendar.ts` | N07: o pré-filtro invertido (só confere sem janela coberta) | `work-time-calendar.test.ts`, `work-time-preference.test.ts` | MORTO |
| U52 | B02 | `src/modules/work-time/calendar.ts` | N07: o pré-filtro por dia nunca deixa conferir | `work-time-calendar.test.ts`, `work-time-preference.test.ts` | MORTO |
| U53 | B02 | `src/modules/work-time/calendar.ts` | N07: a janela com intervalo do próprio dia, coberta, não marca `covered` (só a da véspera marca) | `work-time-calendar.test.ts`, `work-time-preference.test.ts` | MORTO |
| U54 | B02 | `src/modules/work-time/draft.ts` | N07: salvar confere só as rotinas sozinhas, sem feriados nem exceções | `work-time-preference.test.ts` | MORTO |
| U55 | B02 | `src/modules/work-time/draft.ts` | N07: a recusa sempre na seção das rotinas | `work-time-preference.test.ts` | MORTO |
| U56 | B02 | `src/components/WorkTimeSettingsView.tsx` | N09: a validação do rascunho a cada renderização de Configurações | `work-time-guard.test.ts` | MORTO → MORTO |
| U57 | B03 | `src/modules/work-time/consistency.ts` | N03: a última gravação da desconsiderada sai das escritas conhecidas | `work-time-consistency.test.ts` | MORTO |
| U58 | B03 | `src/modules/work-time/consistency.ts` | N03: a espera limitada vale também para as escritas que sempre mudam a renda | `work-time-consistency.test.ts` | MORTO |
| U59 | B03 | `src/modules/work-time/consistency.ts` | N10: as mudanças já incluídas na projeção não são podadas | `work-time-consistency.test.ts` | MORTO |
| U60 | B03 | `src/modules/work-time/consistency.ts` | N10: os estados dos lançamentos fora da lista não são podados | `work-time-consistency.test.ts` | MORTO |
| U61 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | N03/N06: a espera limitada nunca termina | `work-time-consistency.test.ts`, `work-time-income-estimate.test.ts` | MORTO |
| U62 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | N03/N06: a espera recomeça a cada avaliação | `work-time-consistency.test.ts`, `work-time-income-estimate.test.ts` | MORTO |
| U63 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | N05: a escuta encerrada antes do primeiro retorno deixa "calculando" para sempre | `work-time-consistency.test.ts`, `work-time-guard.test.ts` | MORTO |
| U64 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | N06: a última provada no lugar da atual nunca ganha o aviso | `work-time-consistency.test.ts`, `work-time-guard.test.ts` | MORTO |
| U65 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | N06: com a leitura atual em erro, a última provada aparece sem o aviso | `work-time-income-estimate.test.ts`, `work-time-consistency.test.ts` | MORTO |
| U66 | B03 | `src/modules/transactions/api.ts` | N04: a leitura por id aceita o cache local (`getDocs`) | `work-time-guard.test.ts` | MORTO |
| U67 | B01 | `src/modules/work-time/receivableReversal.ts` | N08: os pares com ID repetido (o espelho de um estorno na lista) | `work-time-estimate.test.ts` | MORTO |
| U68 | B02 | `src/modules/work-time/calendar.ts` | M03 (revisão 2): o trecho das janelas depois da meia-noite nunca fica negativo (`windowPart` ≥ 0): o intervalo da véspera coberto pelo dia ocupa duas vezes o dia civil | `work-time-calendar.test.ts` | MORTO |
| U69 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | M02 (revisão 2): a hora do servidor das bases nunca encerra a espera limitada (ela recomeça a cada montagem) | `work-time-consistency.test.ts` | MORTO → MORTO |
| U70 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | M02 (revisão 2): qualquer texto em `generatedAt` vale como hora do servidor (`Date.parse` leniente) | `work-time-consistency.test.ts` | MORTO → MORTO |
| U71 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | M02 (revisão 2): a hora do servidor encerra a espera assim que passa da escrita, sem esperar os 30 s | `work-time-consistency.test.ts` | MORTO → MORTO |
| U72 | B02 | `src/modules/work-time/draft.ts` | M06 (revisão 2): a data de exceção fora do formato chega ao conferidor como exceção sem tratamento | `work-time-preference.test.ts` | MORTO |
| U73 | B01 | `src/modules/work-time/receivableReversal.ts` | M07 (revisão 2): os pares na ordem da lista (o espelho de um estorno listado antes do recebimento parte o par) | `work-time-estimate.test.ts` | MORTO |
| U74 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | P01 (revisão 3): a hora do servidor encerra a espera 1 ms depois da escrita (o mutante da revisão 3) | `work-time-consistency.test.ts` | MORTO |
| U75 | B03 | `src/modules/work-time/useIncomeEstimateWith.ts` | P01 (revisão 3): o limite da espera pela hora do servidor exclusivo (`<` no lugar de `<=`): 30 s depois da escrita ainda segura | `work-time-consistency.test.ts` | MORTO |
| U76 | B02 | `src/components/WorkTimeSettingsView.tsx` | Q02 (revisão 4): qualquer recusa do editor de rotinas põe Configurações em edição, também a da configuração gravada (o comportamento anterior) | `work-time-guard.test.ts` | MORTO |
| U77 | B02 | `src/components/workTime/RoutineEditor.tsx` | Q02 (revisão 4): o editor de rotinas nunca informa edição; a mudança da pessoa que continua recusada não põe a tela em edição | `work-time-guard.test.ts` | MORTO |

**Total:** 77/77 mortos (TOTAL unit: 73/73 mortos; 0 não compilam).
