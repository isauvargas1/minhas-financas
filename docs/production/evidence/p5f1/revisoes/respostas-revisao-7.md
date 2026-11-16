# P5-F.1 — respostas à revisão independente 7

Cada achado de [`revisao-7.md`](revisao-7.md) e cada resíduo que ela apontou nos achados anteriores, com o que foi feito, onde está e como foi provado. Mutantes: `../mutantes.md` (U = unidade e guarda; R = Rules no Emulator; E2E = build com a mutação). Execuções: `../execucoes.md`.

O `verify:all` que rodava durante a revisão (o 10º, árvore `167c2893`, saída 0, 3.037 testes) deixou de ser o gate definitivo, porque estas correções mudam o código. O gate definitivo foi rodado de novo sobre a árvore final (`execucoes.md`).

## Resíduos dos achados anteriores

| ID | Situação na revisão 7 | Resposta | Prova |
| --- | --- | --- | --- |
| R6-02 | Corrigido nos cenários do achado; resíduo em R7-01 e efeito em R7-02 | **Corrigido com R7-01 e R7-02** | Ver abaixo |
| R5-02 | Corrigido nos cenários apontados; resíduo em R7-01 e R7-02 | **Corrigido com R7-01 e R7-02** | Ver abaixo |
| R1-19 | Risco aceito | Sem mudança | §20.15, riscos |

## Achados novos

| ID | Sev. | Resposta | Prova |
| --- | --- | --- | --- |
| R7-01 | LOW | **Corrigido.** (1) **Todos os meses da base:** a regra da base nova sem pedido passou a comparar a receita de todos os meses que a base traz (`sameIncome`), e não só a janela. Assim, um mês mudado fora da janela também relê as exclusões depois da base, e o par fica certo para qualquer janela futura e para a estimativa que monte depois (com a mesma lista, a leitura por id do cache já foi relida depois da base). Como a regra não depende mais da janela, a troca de janela não deixa a retenção presa. (2) **Todas as bases:** a liberação sem pedido só sai quando nenhuma base da estimativa está mais em leitura (`BasisView.fetching`), como o pedido já fazia com a chegada de todas. Na janela de 12 meses, a série e o mês avulso liberam juntos, com uma leitura das exclusões depois deles. O custo de reler a leitura por id também numa mudança fora da janela (até 2 consultas `in` e, com o painel aberto, a janela dele) fica dentro dos orçamentos das bases | `report-basis-refresh`: "mesma receita por mês: todos os meses que a base traz …"; `report-basis-sync`: "mês fora da janela mudado sem pedido …" (a sonda A da revisão: as exclusões relidas mesmo com julho fora da janela; na janela nova, nenhuma retenção presa e nenhuma renderização mista) e "janela de 12 meses, as duas bases relidas sem pedido …" (a sonda D: nenhuma renderização livre com só uma das bases nova; exclusões relidas uma vez, depois das duas); `work-time-income-estimate`: "exclusão de um mês fora da janela, anulada nesta aba: a janela maior salva depois mostra a renda certa …" (a sonda A2: sempre R$ 21.620,00 com 6 meses, nunca R$ 21.120,00); U131, U132 e U147–U151 mortos |
| R7-02 | LOW | **Corrigido.** Cada retorno do servidor à escuta das projeções é contado por `uid|workspace` (`noteServerSnapshot`), e cada leitura de base guarda, no começo, quantos já tinham chegado (`basisFetchStarts`, na `queryFn`). Uma leitura nova que começou antes do último retorno pode ter lido um estado anterior a ele, então ela volta a comparar e a pedir, como a carga. É o caso de uma receita lançada e anulada durante a leitura, venha a releitura de um pedido já liberado pela convergência ou da mutação. A leitura que começou depois do último retorno continua sem pedir: ela leu a projeção depois desse retorno, e a escuta traz o mesmo estado em seguida. A economia da revisão 6 se mantém | `report-basis-sync`: "releitura pedida liberada pela convergência antes de chegar, com um estado intermediário …" (a sonda B2: 3 chamadas, o estado final e nenhuma renderização livre com o intermediário) e "releitura da mutação que começou antes do último retorno da escuta …" (a sonda B); o teste da revisão 6 "base nova sem pedido … não pede outra releitura" continua com 2 chamadas; U133 e U144–U146 mortos |
| R7-03 | INFO | **Corrigido.** (1) As contagens de `VEREDITOS.md:49` foram atualizadas. (2) "O primeiro retorno" virou "cada retorno do servidor" no plano, no `DATA_MODEL`, nos vereditos, na elegibilidade e em `respostas-revisao-6.md`; o modelo de custo diz que uma escuta encerrada que volta a falhar é reaberta de novo a cada retorno de outra. (3) A janela do painel relida pela liberação sem pedido entrou no modelo de custo e no risco do painel, com o teto dos dois orçamentos (até cerca de 43 por hora por base). (4) A espera de até 10 min da reconstrução marcada depois de 2 releituras da mutação em 10 min entrou no texto principal, na elegibilidade, nos riscos e no modelo de custo | Documentos |

**Nota (revisão 8).** Três frases de R7-01 prometiam mais que o código, e a revisão 8 apontou cada uma (R8-04):
- "o par fica certo para qualquer janela futura e para a estimativa que monte depois": vale para a janela e a estimativa com a mesma base. O mês avulso, que só a janela de 12 meses lê, não é acompanhado antes de entrar (R8-02, nos riscos).
- "Na janela de 12 meses, a série e o mês avulso liberam juntos": valia quando as duas eram relidas juntas. A base cuja releitura esperava o orçamento ficava para trás; desde a revisão 8, a liberação espera também a releitura pendente (R8-01).
- "U131, U132 e U147–U151 mortos": o U151 morria só pela guarda. Desde a revisão 8, a mesma troca morre também pelo teste de comportamento da estimativa inteira (U162, só com esse teste).

Ver [`respostas-revisao-8.md`](respostas-revisao-8.md).
