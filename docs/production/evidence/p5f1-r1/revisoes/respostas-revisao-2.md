# P5-F.1-R1 — respostas à revisão independente 2 (2026-11-06)

A revisão 2 (`revisao-2.md`) leu a árvore `d7dabb10` e terminou em **FAIL**. Não achou defeito de código nos três bloqueadores:
- **B01** corrigido;
- **B02** corrigido no comportamento: 0 violações em 182.354 pares, com geradores que acham violações nas árvores anteriores;
- **B03** corrigido dentro dos limites da arquitetura.

O FAIL veio de quatro pontos:
- a descrição dos limites (M01, MEDIUM);
- a prova escrita do Teorema 2 (M03);
- números de custo (M04);
- evidências fora da árvore (M08).

Houve ainda quatro achados LOW e INFO (M02, M05, M06, M07) e um registro (M09). Cada um foi tratado abaixo. Onde há teste novo, o "antes" é ele rodado sobre uma cópia exata do `src/` da árvore `d7dabb10` (`git archive`; logs `antes-revisao2-*.log`).

## M01 — MEDIUM — direção do erro nos limites (a) e (b)

| Item | Conteúdo |
| --- | --- |
| Correção | `consistencia-estimativa.md` §6: a direção do erro depende do caso.<br>• **(c)** só superestima.<br>• **O estorno de um recebimento desconsiderado** (B01), em (b), só superestima.<br>• **Em (a) e (b), com edição de valor:** a desconsiderada que cai de valor superestima. A que sobe de valor tira do total antigo mais do que ele tem dela e abate outra receita até o gatilho gravar: R$ 10.260,00 no lugar de R$ 10.560,00 em (a), e R$ 10.360,00 em (b).<br>A frase "nunca desconta duas vezes" saiu. A mesma correção está na matriz (B03), no relatório e nos riscos do plano (RR-R1-01). |
| Por que fica | A projeção não registra quais escritas aplicou, como a revisão confirmou (§4.4). Fechar esses casos exigiria mudar a arquitetura financeira, o que está fora do escopo. |

## M02 — LOW — a espera limitada recomeçava a cada montagem

| Item | Conteúdo |
| --- | --- |
| Correção | `useIncomeEstimateWith.ts`: a espera também termina quando a hora do servidor que as bases mostram (`generatedAt` do relatório) já passou da hora da escrita por 30 s ou mais. Assim ela conta a partir da escrita, e uma montagem ou sessão nova não espera de novo.<br>Só vale o formato ISO em UTC (`toISOString` das Functions). O `Date.parse` leniente lia "s-1" como 2001; o teste dos rótulos falsos pegou isso, e o mutante U70 garante a forma estrita. U71 cobre o limite. Na revisão 3 (P01), U74 e U75 e três testes do limite completaram a cobertura.<br>Com bases geradas antes de completar os 30 s (a edição feita nos últimos 30 s), a espera conta no relógio da montagem, como antes. O §5 de `consistencia-estimativa.md` diz isso. |
| Teste | `work-time-consistency.test.ts`, "revisão 2 da R1 (M02)". Usa espera de 60 s, maior que qualquer `until`:<br>• logo depois da edição sem efeito na renda, a espera vale e nada aparece;<br>• numa sessão nova, com o servidor 61 s depois, a estimativa aparece sem esperar.<br>Na árvore `d7dabb10`: `tempo esgotado: a estimativa sem esperar de novo`. |
| Segurança | A expiração só pode vir antes da do relógio da montagem, nunca depois, e o limite continua 30 s depois da escrita. É o que (a) já descreve. |

## M03 — LOW — passos da prova do Teorema 2 e o teste que faltava

| Item | Conteúdo |
| --- | --- |
| Correção | `rotinas-matematica.md` §3 e §4, reescritos com:<br>• `T` (minutos atribuídos ao dia depois da meia-noite);<br>• `A` (os da véspera no dia civil);<br>• `D = A − P`, a lacuna do intervalo da véspera coberta pelo dia.<br>O código calcula `o = T − D`, que pode ser negativo, e o teto é `T + 1.440 − A`. Num dia que segue a rotina, `m = T + min(w^c + x + a, 1.440 − A)`.<br>A prova vale passo a passo: `T` nunca diminui; `w^c` perde no máximo `δ`; `m' ≥ m + ΔT − δ` num dia que segue a rotina e `m' ≥ m − δ` nos demais; depois, a soma telescópica. O código não mudou. |
| Teste | `work-time-calendar.test.ts`, "revisão 2 da R1 (M03)", o caso da revisão: segunda 20:00–24:00 e terça 00:00–06:00, mais segunda 22:00–04:00 com 3 h de intervalo, e 24 h de hora extra na terça.<br>• A segunda conta 240 → 480.<br>• A terça conta 1.440 → 1.200, com teto.<br>• O mês não cai, e as duas configurações são aceitas pelo conferidor, trabalhando nos feriados. Sem isso, a terça de 07/09/2027 tiraria a cobertura, e o conferidor recusaria com razão.<br>O mutante da revisão (`windowPart` ≥ 0, U68) sobrevivia à suíte da `d7dabb10` e agora é morto. |

## M04 — LOW — custo do conferidor

| Item | Conteúdo |
| --- | --- |
| Correção | `rotinas-matematica.md` §2, `respostas-revisao-1.md` (N09) e os riscos (RR-R1-04) passam a citar a sonda da revisão (`revisoes/sondas-revisao-2/b02-custo.mts.txt`) e a nossa execução dela na árvore final: configuração comum, 0 a 1 ms; coberta sem exceções, 42 a 84 ms; pior caso da gramática (3 rotinas cobertas, uma escala cíclica 27 × 26, 120 exceções de 366 dias e 40 feriados anuais), 368 a 389 ms, e `validateDraft` inteiro, 481 ms (`logs/execucoes/sonda-final-custo-m04.log`; na mesma sonda, a revisão mediu 385 a 520 ms).<br>A sonda antiga (`custo-cal`) só media configurações que o pré-filtro corta. O documento diz isso agora. |
| Fica | O conferidor roda uma vez por mudança do rascunho em Configurações e no assistente. No pior caso da gramática, são algumas centenas de milissegundos por mudança: risco de desempenho registrado (RR-R1-04), sem efeito em valores. Cache e adiamento ficaram fora, para não mexer na interface. |

## M05 — LOW — o aviso dizia que a atualização falhou quando só faltava confirmar

| Item | Conteúdo |
| --- | --- |
| Correção | `messages.ts`: o aviso do topo (`ESTIMATE_QUALIFIER_STALE`) passa a ser "Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações.". É verdadeiro nos dois casos (falha e confirmação pendente) e coerente com o texto dos detalhes (`ESTIMATE_REFRESH_FAILED`), que não mudou. |
| Testes | A asserção exata do texto (`work-time-estimate.test.ts`) e os três E2E que o conferem (`e2e/work-time-p5f.spec.ts`) foram atualizados para o texto novo. Nenhuma asserção foi tirada. |

## M06 — INFO — `validateDraft` lançava `RangeError` com data fora do formato

| Item | Conteúdo |
| --- | --- |
| Correção | `draft.ts`: o conferidor do calendário fica protegido. Uma data fora do formato dá a mensagem do formato ("Há exceções sobrepostas ou fora do formato"), e não uma exceção sem tratamento. |
| Teste | `work-time-preference.test.ts`, "revisão 2 da R1 (M06)": com uma janela coberta, para o conferidor ler as exceções, testa 30/02 e o mês 13. Na árvore `d7dabb10`, lança `RangeError`. |

## M07 — INFO — o par se partia com o espelho do estorno antes do recebimento

| Item | Conteúdo |
| --- | --- |
| Correção | `receivableReversal.ts` (`pairedReadIds`): os pares cujo lançamento não é o espelho do estorno de outro da lista vão primeiro. O espelho listado antes do próprio recebimento entra no par dele, lado a lado. |
| Teste | `work-time-estimate.test.ts`, N08, nas duas ordens. Na árvore `d7dabb10`, a segunda ordem reprova (`o estorno logo depois`). Mutante U73. |

## M08 — INFO — evidências citadas que não estavam na árvore

Na árvore final estão:
- `execucoes.md`, `VEREDITOS.md`, `mutantes.md`;
- `revisoes/revisao-2.md` e estas respostas;
- as sondas das duas revisões (`revisoes/sondas-revisao-1/`, `revisoes/sondas-revisao-2/`, com os logs da 2);
- as sondas e os logs finais da R1 (`sondas/`, `logs` do pacote);
- a §20.16 do plano mestre.

As referências aos logs do protótipo foram trocadas pelas execuções na árvore final (`sonda-final-*`).

## M09 — INFO — "horas sem cálculo seguro" num mês antigo

Registrado (`rotinas-matematica.md` §2, RR-R1-02). O conferidor olha de 12 meses antes do mês de hoje até 2099, que é tudo o que uma estimativa pode usar. Um mês mais antigo pode mostrar no calendário de exceções o dia sem cálculo seguro de uma configuração aceita, sem efeito em nenhuma estimativa (há teste do horizonte).

## Depois das correções

- Mutantes de unidade: U1 a U73 (`mutantes.md`). Mutantes do E2E: 3.
- O `verify:all` final roda sobre a árvore corrigida.
- Uma terceira revisão independente, somente leitura, confere estas correções (`revisao-3.md`).
