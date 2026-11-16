# P5-F.1-R1 — B03: estimativa fail-closed (consistência entre leituras)

Código:
- `src/modules/work-time/consistency.ts`: prova pura, sem React, sem Firebase e sem relógio;
- `src/modules/reports/basisSync.ts`: projeção confirmada da escuta;
- `src/modules/reports/basisRegistry.ts`: ordens e observações;
- `src/modules/reports/hooks.ts`: o campo `updatedAt` das projeções;
- `src/modules/work-time/useIncomeEstimateWith.ts`: retenção, leitura por id e releitura.

Testes:
- `tests/unit/work-time-consistency.test.ts` (prova pura e cenários de gancho);
- `tests/unit/work-time-income-estimate.test.ts` (retenção pura e cenários da P5-F.1, reforçados);
- `tests/unit/work-time-guard.test.ts` (fiação);
- `tests/firestore/work-time-p5f.rules.integration.test.mjs` (formas de leitura).

## 1. O problema

A estimativa junta leituras feitas em momentos diferentes:
- a série do relatório oficial (callable);
- o 12º mês (callable, só na janela de 12 meses);
- os lançamentos desconsiderados, por id (Firestore);
- a escuta das projeções mensais de caixa (`cash_report_periods`).

Na P5-F.1, a retenção era heurística: pedido em curso, leitura dependente atrás, base à frente ou bases fora de passo. Ela segurava a estimativa anterior *das mesmas entradas*. Sem estimativa anterior compatível (a primeira renderização, entradas trocadas), mostrava o estado atual, mesmo misto (R10-02). Alguns caminhos combinavam versões incompatíveis:
- R8-02: o 12º mês novo com a exclusão antiga;
- R9-03: a troca para 12 meses logo depois de uma anulação;
- R11-01: a base que volta desatualizada;
- R11-02: só uma das duas bases nova.

A R1 fecha esses caminhos e os demais cenários do pedido (§7). Ficam abertos os três casos do §6, que dependem da latência do gatilho.

## 2. O mecanismo verificável

A fonte oficial de correspondência é a **projeção mensal confirmada pelo servidor** na escuta da estimativa. Para cada mês da janela, ela traz:
- `incomeCents`, a receita que o relatório oficial lê;
- `updatedAt`, a hora do servidor da última escrita do gatilho no mês. O gatilho só grava o mês quando receita, despesa ou distribuição diária mudam (`functions/src/cash/periods.ts`, `cashPlanPeriods`).

O retorno só do cache local não vale.

Um contador do registro marca, sem relógio:
- a ordem em que cada versão de cada mês chegou pela primeira vez a uma escuta da conta e do workspace (`noteProjectionSeen`, até 4 versões por mês);
- a ordem em que cada leitura por id começou (`noteDependentReadStart`).

O Firestore não devolve, a uma leitura que começa depois de outra terminar, um estado anterior ao dela.

**Regras de `proveEstimateConsistency`, nesta ordem.** A primeira que falha é o motivo:

| # | Regra | Motivo quando falha |
| --- | --- | --- |
| — | Bases ainda carregando | `loading` |
| 1 | Uma base só e nenhuma desconsiderada: uma leitura, nada a combinar | (provada) |
| — | Sem bloco exato: a estimativa fica indisponível, sem conversão | (provada) |
| 2 | Há projeção confirmada para os meses da janela; com a escuta encerrada, não há | `projection` |
| 3 | A receita de cada mês nas bases é a da projeção (mês sem documento vale 0) | `bases` |
| 4 | A leitura por id em uso começou depois de a versão atual de cada mês com desconsiderada chegar | `exclusions_read` |
| 5 | Nenhuma escrita conhecida de uma desconsiderada é posterior à versão do mês dela (as de espera limitada, só até a espera terminar) | `projection_pending` |

As escritas conhecidas (regra 5) são:
- sem espera, porque sempre mudam a receita do mês e o gatilho grava a projeção depois delas:
  - a criação (`createdAt`) e a confirmação (`cashEntry.confirmedAt`) de uma desconsiderada que soma renda;
  - a anulação (`voidedAt`) de uma que somava;
  - a criação do espelho do estorno de um recebimento desconsiderado (B01);
- com espera limitada (revisão independente, N03 e N06), porque podem vir de uma edição sem efeito na renda, que o gatilho não grava:
  - a última gravação de cada desconsiderada com mês (`updatedAt`), também na primeira leitura por id da sessão: uma edição de valor, data ou tipo feita antes dela segura a prova até o gatilho gravar o mês;
  - a mudança de mês ou de valor vista entre duas leituras por id da mesma conta e do mesmo workspace (`updatedAt` do estado novo).

A espera limitada (`ESTIMATE_PENDING_WAIT_MS`, 30 s) conta a partir da escrita, para cada uma (lançamento, mês e hora). Ela termina no que vier primeiro:
- a hora do servidor que as bases em uso mostram (`generatedAt` do relatório, das Functions) passa da hora da escrita (do Firestore) por 30 s ou mais (revisão independente 2, M02). Só o formato ISO em UTC vale como hora do servidor; outro texto não encerra nada;
- passam 30 s no relógio injetável dos agendadores desde que a escrita apareceu nesta montagem. Esse é o caso de uma edição feita nos 30 s antes de as bases serem geradas.

Assim, uma montagem ou uma sessão nova não espera de novo por uma escrita que o servidor já passou. A prova continua sem relógio: ela só recebe as escritas cuja espera terminou (`expired`). Quando a espera termina sem a projeção passar da escrita, a escrita deixa de segurar. Isso é uma presunção (a escrita não mudou a renda), não uma prova; quando ela erra, é o caso (a) do §6.

As mudanças observadas ficam acumuladas (`observeDependentRead`). Uma leitura mais velha que chega depois não volta o estado. A cada leitura, a observação guarda só os lançamentos dela e só as mudanças que a projeção ainda não passou (revisão independente, N10): a projeção de um mês só avança, então uma mudança já incluída nunca volta a pesar.

## 3. A política (`holdEstimate`)

- **Identidade de uma estimativa:** conta (uid), período (os meses da janela), workspace-fonte, modo, meses do histórico, confirmação de renda PJ, calendário (o objeto) e a lista de exclusões.
- **Sem prova:** vale a última estimativa provada da mesma identidade, com o aviso de falha e o "Tentar de novo" do estado atual. Com a leitura atual em erro, a anterior aparece com o aviso "usa a última leitura" e o "Tentar de novo" do erro (revisão independente, N06). Sem estimativa anterior, nenhuma conversão: "Lendo as receitas oficiais e calculando..." ou, com uma leitura ou a escuta em falha, o erro em pt-BR com "Tentar de novo" (`ESTIMATE_UNCONFIRMED_FAILED`, `estimateFailureMessage`). Os valores voltam a aparecer em reais.
- **Escuta encerrada antes do primeiro retorno do servidor, com desconsideradas** (revisão independente, N05): a leitura por id nunca começaria, e "calculando" não terminaria. Vale o erro `ESTIMATE_UNCONFIRMED_FAILED` com "Tentar de novo", que reabre a escuta.
- **Provada, com a sincronização ainda relendo:** a última provada da mesma identidade, se houver. Sem ela, a atual, que é provada.
- **Estimativa antiga:** a última provada mostrada no lugar da atual por mais que a espera limitada ganha o aviso "usa a última leitura" e o "Tentar de novo" (`refreshFailed`, que a tela já mostra; revisão independente, N06). O aviso do topo diz "Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior". Na revisão 2 (M05), ele dizia que a atualização "falhou", o que não é verdade quando só falta a confirmação; agora vale para os dois casos.
- Só um estado pronto e provado é guardado como a última estimativa.

## 4. Vivacidade: cada regra tem quem a destrave

| Regra | O que a destrava |
| --- | --- |
| 2 | O retorno do servidor à escuta; com a escuta encerrada, o "Tentar de novo" (de qualquer estimativa da conta e do workspace) ou o retorno à escuta de outra |
| 3 | A releitura das bases pedida pela sincronização (divergência, com orçamento) |
| 4 | Uma releitura por id. Ela vem da liberação da sincronização ou, quando a sincronização não vai reler, do agendador da própria estimativa (`FINANCIAL_REPORT_BASIS_REFRESH`: agrupada em 5 s, 5 seguidas e mais 1 a cada 120 s) |
| 5 | A escrita da projeção pelo gatilho, que a escuta entrega; depois, as regras 3 e 4. Para as escritas de espera limitada, também o fim da espera (30 s) |

A leitura por id só começa depois do primeiro retorno do servidor à escuta da janela (`projectionReady`). Com isso, a regra 4 vale na montagem sem leitura a mais. Com a escuta encerrada, o "Tentar de novo" não relê por id na hora: só vale a leitura que começar depois do retorno da escuta reaberta. Com a escuta encerrada antes do primeiro retorno, o estado é o erro com "Tentar de novo" (§3).

A leitura por id é sempre do servidor (`getDocsFromServer`, revisão independente, N04). Sem rede, ela falha, e a estimativa mostra a falha com "Tentar de novo", ou a última provada com o aviso. O cache local não vale, como na escuta: sem os documentos nele, todos os desconsiderados pareceriam inexistentes. A suíte de Rules confere, contra o SDK real no Emulator, que sem rede `getDocs` responde do cache e `getDocsFromServer` falha como `unavailable`.

## 5. Custo

- **Caso comum:** nada a mais. A leitura por id já esperava a projeção, e a escuta já existia.
- **Releitura por id a mais:** uma de até 4 consultas `in` de até 30 ids, no máximo 100 documentos (os 50 desconsiderados e os espelhos de estorno). Ela acontece quando uma versão nova de um mês com desconsiderada chega depois do começo da leitura por id sem que a sincronização releia: mudança só de despesa no mês, troca da janela, ou escuta atrasada em relação à releitura da mutação. Segue o orçamento do agendador acima.
- **Campo novo lido:** `updatedAt` das projeções (os mesmos documentos da escuta). Nenhuma escrita nova, nenhum índice novo, nenhuma Rule nova.
- **Leitura por id do servidor** (N04): as mesmas consultas e a mesma quantidade de documentos, sem o atalho do cache.
- **Espera limitada** (N03, N06, M02): nenhuma leitura a mais. Ela segura a estimativa por até 30 s numa edição de desconsiderada que o gatilho ainda não gravou, ou que não muda a renda. Como os 30 s contam está logo abaixo. Na revisão 2 (M02), a espera recomeçava a cada montagem, sem fim, quando a edição não mudava a renda. Agora:
  - com bases geradas depois dos 30 s, a espera termina na primeira renderização com elas;
  - com bases geradas antes (a edição feita nos últimos 30 s), ela conta no relógio da montagem.
- **Nos testes de gancho**, a prova pede, em alguns cenários, uma leitura a mais (revisão independente, N09): leituras por id de 2 para 3 nos cenários de janela maior, e releituras da série de 3 para 5 num cenário de duas leituras no mesmo milissegundo. São releituras do orçamento do agendador, não leituras por renderização.

## 6. Limites registrados

**Estes três casos deixam o B03 aberto: por eles, o veredito da R1 é FAIL.** Neles, uma conversão incorreta ainda pode aparecer até o gatilho gravar. O pedido diz que convergir depois não basta.

A projeção não registra quais escritas já aplicou. As marcas de entrega `cash_period_events` são só do servidor, com o id do evento em hash. O cliente não detecta (b) nem (c); em (a), ele sabe que não provou e mostra mesmo assim, depois da espera.

Caminhos para decidir:
1. **A projeção registrar o que aplicou**, por mês, de modo que o cliente prove a inclusão de cada escrita. Fecha os três, mas muda a arquitetura financeira, o que o pedido não autoriza.
2. **Só em (a), fail-closed estrito:** depois da espera, a estimativa fica em reais até a projeção do mês passar da escrita.
   - É uma mudança local que a R1 poderia fazer, mas não fecha o B03: (b) e (c) continuariam abertos.
   - Ela troca o erro passageiro por uma perda longa da estimativa. Numa edição sem efeito na renda, que o gatilho não grava, a estimativa fica em reais até outra escrita regravar o mês, ou até ele sair da janela (até 12 meses).
   - Por isso ficou para decisão de produto.
3. **Aceitar o risco** por decisão registrada.

Os casos da revisão 1 que foram corrigidos (N03 a N06) estão em `revisoes/respostas-revisao-1.md`. Ficam estes três:

- **(a) Gatilho mais lento que a espera limitada.** A edição de valor, data ou tipo de uma desconsiderada segura a prova pelo `updatedAt` dela até o gatilho gravar o mês, mas só por até 30 s. Um gatilho mais lento (início a frio, retentativas) deixa a edição junto com o total de antes, depois da espera e até gravar. Quando grava, a versão nova do mês aciona as regras 3 e 4, e a estimativa segura e relê.
- **(b) Gatilhos fora de ordem.** O gatilho de outra escrita do mesmo mês pode rodar antes do de uma escrita anterior. Ele avança a versão do mês para depois das duas sem incluir a anterior, com o mesmo efeito e a mesma correção de (a).
- **(c) Data que tira a desconsiderada da janela.** Na primeira leitura da sessão, o mês de antes de uma edição de data não é conhecido. Se a edição tirou a desconsiderada da janela e o gatilho ainda não gravou o mês de antes, a estimativa conta a receita dela nesse mês até o gatilho gravar. A espera limitada só olha o mês atual dela, que fica fora da janela.

Nos três casos, o erro dura a latência do gatilho. A direção dele depende do caso (revisão independente 2, M01; a versão anterior deste parágrafo dizia que só superestimava, o que vale para (c) e para o estorno, não para (a) e (b)):
- **(c)** só superestima: a receita da desconsiderada continua no total do mês de antes, sem ser tirada.
- **No estorno de um recebimento desconsiderado (B01)**, (b) só superestima: a exclusão perde o efeito com o estorno lido, e o total ainda tem o recebimento.
- **Em (a) e (b), com uma edição de valor, a direção depende da edição.**
  - Uma desconsiderada que cai de valor, ou deixa de somar, tira do total antigo menos do que ele tem dela: a estimativa superestima.
  - Uma que sobe de valor (R$ 500,00 → R$ 800,00) tira do total antigo, que só tem R$ 500,00 dela, os R$ 800,00 novos. São R$ 300,00 de outras receitas, e a estimativa subestima até o gatilho gravar, como no defeito do B01, mas transitório.
  - Exemplos da revisão: R$ 10.260,00 no lugar de R$ 10.560,00 em (a); R$ 10.360,00, abaixo dos dois estados consistentes (R$ 10.560,00 e R$ 10.660,00), em (b).

## 7. Cenários testados (cada renderização conferida)

Todos são de `tests/unit/work-time-consistency.test.ts`, salvo indicação. A coluna "P5-F.1" é a cópia dos cenários rodada sobre a árvore `d9b33cd1` (`logs/antes-b03-b01-hooks.log`).

| Cenário | P5-F.1 | R1 |
| --- | --- | --- |
| Primeira estimativa, nas três ordens de resposta (escuta antes, depois, só quando pedida) | a leitura por id começava antes da projeção | só "calculando" e a estimativa provada; uma leitura por id, depois da projeção |
| Projeção mais nova que a base lida na montagem | R$ 10.560,00 (base antiga) mostrada | só R$ 11.060,00, depois da base relida |
| Uma base sem desconsiderada, escuta encerrada | estimativa com a ressalva | igual (leitura única provada) |
| 12 meses com a escuta encerrada desde o começo | R$ 36.000,00 sem prova | erro com "Tentar de novo"; com a escuta de volta, R$ 36.000,00 provados |
| R8-02: desconsiderada do 12º mês anulada em outra sessão e troca para 12 meses | R$ 35.000,00 (o mês avulso novo menos a exclusão anulada) mostrados | só "calculando" e R$ 35.500,00 |
| R11-01: o mês avulso sai com a leitura em curso e volta desatualizado | R$ 35.300,00 (base antiga) mostrados | só R$ 35.100,00, depois da base relida |
| R11-02: as bases relidas pela virada do mês e o mês avulso falhando | R$ 36.500,00 (out/2026 nova com nov/2025 antiga) | só R$ 36.000,00, a anterior e depois a nova provada |
| Calendário trocado durante a sincronização de uma anulação | R$ 10.060,00 (a anulada descontada de novo) mostrados | só "calculando" e R$ 10.560,00 com o calendário novo |
| Troca do workspace da renda; troca de conta | sem valor do anterior (guardas) | igual |
| Nova receita e anulação da desconsiderada durante a releitura por id | R$ 10.360,00 (descontada duas vezes) | só estados consistentes |
| Falha da leitura por id antes da primeira estimativa | erro (guarda) | erro com "Tentar de novo"; depois, a estimativa |
| B01: estorno em outra sessão, depois da sincronização / durante a releitura por id | R$ 9.060,00 / R$ 9.360,00 (A descontado de novo) | R$ 10.060,00 / R$ 10.360,00 |
| B01: estorno lido antes de a projeção incluí-lo | R$ 9.360,00 | nunca R$ 11.360,00 (o estorno com outubro ainda somando A); só R$ 10.060,00 e R$ 10.360,00 |
| R6-02, R4-01, R5-01/02, R6-01, R7-01, R8-03, R9-01, R9-03, R10-02, R10-03 (`work-time-income-estimate.test.ts`) | — | reescritos para o contrato fail-closed: nenhum estado misto, com a escuta entregando a gravação do gatilho como no produto |

Cenários da revisão independente, com a coluna "árvore revisada" rodada sobre a cópia da árvore `b97806c4` (`logs/antes-revisao-ganchos.log`):

| Cenário | Árvore revisada | Corrigida |
| --- | --- | --- |
| N05: escuta encerrada antes do primeiro retorno, com desconsiderada | "calculando" para sempre, 0 leituras por id | o erro com "Tentar de novo"; com a escuta de volta, uma leitura por id e a estimativa provada |
| N03: a desconsiderada editada em outra sessão antes do gatilho, na primeira leitura | R$ 10.260,00 (o valor novo tirado do total velho) | só "calculando" e R$ 10.560,00, depois do gatilho |
| N03: a desconsiderada editada sem efeito na renda (o gatilho não grava) | a estimativa logo | só "calculando" e, depois da espera limitada, R$ 10.560,00 |
| N06: a edição sem efeito na renda depois da mudança vista, e agosto com +R$ 100,00 | presa em R$ 10.560,00, sem aviso | R$ 10.660,00 depois da espera |
| N06: a releitura da base mais lenta que a espera | a anterior sem aviso | a anterior com o aviso e o "Tentar de novo"; depois, a nova sem aviso |
| M02 (revisão 2): a desconsiderada editada sem efeito na renda; sessão nova depois de o servidor passar da escrita por mais que a espera (60 s no teste) | a espera recomeçava: nada mostrado até o fim dela | logo depois da edição, a espera vale (nada mostrado); na sessão nova, a estimativa logo, sem esperar de novo |
