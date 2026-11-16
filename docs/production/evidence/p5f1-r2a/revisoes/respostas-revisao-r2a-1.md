# P5-F.1-R2A — respostas à revisão independente 1 (2026-11-06)

**O que a revisão leu.** A `revisao-r2a-1.md` leu a árvore `5a7dad57`. Pelo adendo, leu também `cf9cb2a9`, com a memória por chamada e a proposta v2.
- **Veredito:** FAIL global. B03 aberto, como previsto; B02 **não resolvido**, pelo T01; a Frente B precisa de emenda (T02).
- **Achados:** T01 (HIGH), T02 (HIGH no relatório, MEDIUM no resumo final), T03 (MEDIUM), T04 a T06 (LOW) e T07 a T12 (INFO).

**O que mudou.** A árvore do código foi de `cf9cb2a9` para `63e4c3c6`, com 6 arquivos: `calendar.ts`, `draft.ts`, `messages.ts`, dois testes de unidade e o E2E. A proposta e os documentos de evidência também mudaram. Tudo foi rodado de novo na árvore nova:
- testes de unidade, 174/174;
- E2E do tempo de trabalho, 19/19;
- mutantes de unidade e E2E;
- capturas e antes × depois;
- `verify:all`.

A segunda rodada da revisão (`revisao-r2a-2.md`) conferiu as correções.

## T01 — HIGH — S01 no dia que abre o período

| Item | Conteúdo |
| --- | --- |
| Achado | No dia 1 do período, a certeza da jornada reduzida era calculada descontando a véspera, que fica fora do período, e o dia 1 era contado sem esse desconto. Com isso, uma configuração aceita tinha horas dependentes da parte trabalhada, e acrescentar uma rotina tirava horas (1.080 → 970), uma regressão sobre a R1. |
| Resposta | **Aceito e corrigido no motor**, com a opção "bruta" que a revisão sugeriu: `computeNeighborWindows` calcula o máximo **sem nenhum desconto da véspera** (`most = windowWorkOf(routineDay.windows, [], …)`). É o que o dia conta abrindo o período, e no meio do período ele só conta menos. Assim, a redução certa não corta em nenhuma vista. |
| Conferidor | A revisão sugeriu também uma passada pelo dia 2 de cada mês. Ela não é preciso: o dia 2 do período é `planDay(D + 1, D)`, a mesma chamada da vista sem período. A certeza de `D` agora não depende da vista, e o plano de `D + 1` só lê `D` pelas janelas de vizinho. A passada nova, que roda `planDay` do dia seguinte a cada jornada reduzida, cobre o período que começa em `D`. A propriedade nova confere isso. |
| Testes | • Dirigido "B02 (P5-F.1-R2A, R2A-01)", com os dois contraexemplos da revisão: C é aceita com 1.080; C′ e a quinta de 20 h reduzida a 1.000 são recusadas, com `reduced_eve` em 02/10.<br>• Propriedade "R2A-01", com 1.500 amostras dirigidas: o sábado 01/08 reduzido abre o período, a sexta entra na manhã de sábado e o limite é sorteado perto da faixa da sexta. Ela confere o domingo contra os dois extremos e a monotonia.<br>• Rodada contra o motor de `cf9cb2a9`, a propriedade **falha** na amostra 3 (`saidas/unit-fix-regra-antiga-2.log.txt`). A primeira versão dela, com rotinas aleatórias, passava no motor antigo e foi refeita com o gerador dirigido.<br>• O mutante U11 volta a descontar a véspera e morre. |
| Custo | O caso domingo 22:00–06:00 / segunda 01:00–01:00 reduzida a 20 h / terça 00:00–02:00 passou a ser recusado. Com o domingo, ele valeria 60; abrindo o período, de 60 a 120. Num gerador genérico, a regra nova recusa 6 configurações a mais em 3.000 (0,2%), nenhuma num primeiro dia de mês (`saidas/custo-conservador-r2a01.log.txt`). Está em `s01-vespera-reduzida.md` §5 (fonte 4) e §9. |
| Documentos | `s01-vespera-reduzida.md`: §2, §3, §4, §6, §7, §8 e a §9 nova. Também a matriz, os testes e resultados, o relatório e o plano. |

## T02 — Frente B: a prova aceitava leitura velha com evento fora de ordem e mudança de mês

| Item | Conteúdo |
| --- | --- |
| Achado | A condição 2 não exigia `pending` vazio nem a marca lida depois da escuta de todos os meses, e a condição 1 não excluía eventos aplicados depois do corte. O modelo executável da própria proposta prova `T@v1` com erro de +R$ 200,00. |
| Resposta | **Aceito; a proposta foi corrigida.** Mudaram §0, §5.A ("No cliente"), Rules, riscos, §6, §8, §9 e §10:<br>• a marca é lida do servidor **depois** do instantâneo da escuta usado na conta, para todos os meses da janela. O gatilho grava a marca e os meses no mesmo commit, então a marca lida depois mostra tudo o que a escuta mostra;<br>• condição 2: `pending` **vazio**, `appliedVersion == v`, a marca fora de `broken` e `monthCommits` visíveis na escuta;<br>• condição 1: além do corte, a marca não mostra evento de `T` depois do corte (sem marca, ou `appliedVersion <= rebuildCutoff`, com `pending` vazio);<br>• releitura exigida: toda mudança de mês na escuta refaz a prova. É o que `basisSync.ts:421-429` e `:476-490` já fazem com as desconsideradas;<br>• lançamento apagado, inclusive fisicamente: exige a marca `deleted`, com `pending` vazio;<br>• §8 ganhou o cenário "fora de ordem + mudança de mês + leitura velha" e o da ordem das leituras, e o oráculo de "Permutações" passou a ser "prova verdadeira ⇒ estimativa igual ao valor exato";<br>• §6 e §10: A′ e C herdam a prova corrigida, o que a tabela agora diz. |
| Estado | O B03 continua aberto. A Frente B é só desenho e depende de aprovação (D-B03-1 a D-B03-4). |

## T03 — MEDIUM — recusa conservadora mais larga que a declarada; mensagem que afirmava dependência

| Item | Conteúdo |
| --- | --- |
| Achado | Três famílias de casos são recusadas com valor fisicamente fixo. A frequência não estava no pacote, e a mensagem dizia "as horas … dependem disso". |
| Mensagens | **Corrigidas.** Ao salvar: "Com a jornada reduzida de segunda-feira, 05/10/2026, **não dá para confirmar** que parte do horário que passa da meia-noite (Rotina 1) foi trabalhada, e por isso as horas de terça-feira, 06/10/2026, não podem ser calculadas com segurança. Troque…". Na estimativa: "Em algum dia do período, o dia anterior tem jornada reduzida num horário que passa da meia-noite, e não dá para confirmar que parte dele foi trabalhada: as horas desse dia não podem ser calculadas com segurança. Ajuste…". As duas são verdadeiras nos casos necessários e nos conservadores. |
| §5 | Reescrita com quatro fontes, com os exemplos da revisão (A, B, C) e os do T01: o teto com minutos sem horário ou acréscimos, a redução no próprio dia, reduções seguidas e o máximo sem a véspera. A frequência está medida em três geradores: o oráculo (10,4%), o adversarial da revisão (8,8%, em `cf9cb2a9`) e o genérico da R2A-01 (+0,2%). As saídas estão no pacote. |
| Não adotado | **Descontar a véspera reduzida certa no máximo, por recursão.** Contradiz a correção do T01: no dia que abre o período, a véspera não é descontada, e um máximo com desconto volta a dar "não corta" onde a redução corta. Uma regra por vista precisaria saber se o dia abre o período, e a mesma configuração vale para todos os períodos. O caso B fica como recusa conservadora (fonte 4), necessária quando o dia é o primeiro de um mês. |

## T04 — LOW — Teorema 3 com intervalo

**Aceito.** A §2 e a §4 agora tratam do intervalo:
- a parte trabalhada é a fisicamente possível, `K ⊆ ⋃(Wᵢ ∖ Bᵢ)` para alguma posição dos intervalos, até `R`;
- o extremo (ii) é o da convenção do intervalo, que dá a maior ocupação e o maior desconto;
- a conferência da revisão está citada: 0 em 6.846.581 partes fisicamente possíveis e 543 casos fora da faixa só com partes impossíveis.

A propriedade de unidade continua sem intervalo; a sonda de solidez da revisão, com intervalo, está em `revisoes/` e é reproduzível. Fica como lacuna de teste de unidade, registrada no relatório.

## T05 — LOW — custo do pior caso

**Aceito como registro.** `testes-e-resultados.md` traz duas tabelas, em quatro árvores: a sonda própria e as sondas de pior caso da revisão.
- Na árvore final, o pior caso medido é de 0,5 a 1,2 s por conferência, contra 0,43 a 0,53 s na R1. São 120 reduções de 366 dias sobrepostas, com janela coberta e 40 feriados.
- Os casos comuns ficam em 0 a 2 ms.
- O RR-R2A-02 registra o número.

Não houve otimização nem debounce nesta etapa. Um agrupamento por vizinhança aumentaria o risco no motor, e o debounce mudaria a tela.

## T06 — LOW — evidência fora do pacote

**Aceito.** O pacote final traz em `docs/production/evidence/p5f1-r2a/`:
- `testes-e-resultados.md`;
- `saidas/`: os logs dos mutantes, dos E2E e das sondas, e o resumo e os metadados do `verify:all`;
- `visual/`: as capturas e a comparação;
- `sondas/`;
- `revisoes/`: esta revisão, com as sondas e os logs dela.

O log completo do `verify:all` fica no ZIP.

## T07 — INFO — memória do conferidor

- **Mutantes M26 e M28.** Há um teste novo, "a memória do conferidor é de um calendário só…": um getter das exceções lê outro calendário no meio da chamada. Ele mata os dois mutantes, conferido aplicando cada um, e eles entraram na lista da R2A.
- **Cabeçalho.** O do módulo agora diz que o único estado é a memória de uma chamada, criada e desfeita dentro dela.

## T08 — INFO — "a véspera" sem referente

**Corrigido**, junto com o T03: "o dia anterior" e "as horas desse dia". O E2E e as capturas conferem o texto novo.

## T09 a T12 — INFO

- **T09 (S03 resolvido) e T10 (testes anteriores):** sem ação.
- **T11 (proposta):** as cinco imprecisões menores foram corrigidas na §5.A:
  - o lançamento sem marca, que fica pendente até a reconstrução;
  - o `limit` na consulta por ids e nas Rules;
  - o avanço monótono de `covered_by_rebuild`;
  - `monthCommits` como metadado menor;
  - a prova para o lançamento apagado.
- **T12 (escopo):** confirmado. A correção também não toca `functions/`, Rules nem índices.
