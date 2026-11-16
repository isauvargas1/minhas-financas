# P5-F.1-R1 — evidências

Correção estritamente corretiva dos três bloqueadores HIGH do parecer independente de 2026-11-05 sobre a P5-F.1 (§20.15 do plano mestre). A seção do plano é a §20.16.

| Arquivo | Conteúdo |
| --- | --- |
| `matriz-bloqueadores.md` | B01, B02 e B03: cenário, resultado anterior, causa, correção, testes e resultado |
| `rotinas-matematica.md` | B02: modelo, teoremas (cálculo seguro e monotonia), atribuição aos dias, teto, antes × depois e o caso aberto da véspera em jornada reduzida (§6) |
| `consistencia-estimativa.md` | B03: mecanismo verificável (projeção confirmada, versão `updatedAt`, ordens), regras da prova, política fail-closed, vivacidade, custo, limites e cenários |
| `sondas/` | Sondas da B02, que rodam sobre qualquer árvore: copie a sonda sem o `.txt` (o Node só tira os tipos de `.mts`) e rode `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON <sonda>.mts <raiz>`, numa árvore com `node_modules`:<br>• o antes × depois (`b02`, `b02-reduzida`, `exemplo-noturno`, `revisao2`);<br>• as buscas da revisão 1 (`b02-cobertura`, `b02-busca`, esta com a contagem do conferidor do calendário);<br>• a solidez do conferidor (`aceita`, `aceita-causas`);<br>• o teto dirigido (`teto-e`);<br>• o custo (`custo-cal`, `custo-rotinas`);<br>• o limite da véspera em jornada reduzida (`dia-seguinte-reduzida`) |
| `visual/` | Capturas dos estados novos da R1: os avisos do editor e de Configurações, a configuração sem cálculo seguro já gravada e o Dashboard em reais. São 1440 × 900 e 390 × 844, claro e escuro, com axe e transbordamento, e o roteiro temporário |
| `execucoes.md` | Comandos, ambiente e contagens (PASS/FAIL/SKIP/RETRY) dos testes dirigidos, das repetições, dos mutantes e do `verify:all` |
| `mutantes.md` | Mutantes do delta da R1 e o resultado de cada um |
| `VEREDITOS.md` | Vereditos das skills exigidas pelo gate e da revisão independente |
| `revisoes/` | As revisões independentes do delta da R1 (`revisao-1.md` a `revisao-5.md`), as respostas item a item (`respostas-revisao-1.md` a `respostas-revisao-5.md`) e as sondas, os logs e os recortes de cada uma (`revisoes/LEIAME.md`) |

O "antes" de cada cenário vem da mesma bateria rodada sobre uma cópia exata da árvore `d9b33cd1` (`git archive`). Só os próprios testes da R1 foram copiados para lá, sem os testes de funções que não existiam. O "antes" dos achados da revisão 1 vem do mesmo jeito, da árvore revisada `b97806c4` (`revisoes/respostas-revisao-1.md`).
