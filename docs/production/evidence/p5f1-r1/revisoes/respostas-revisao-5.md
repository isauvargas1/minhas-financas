# P5-F.1-R1 — respostas à revisão independente 5 (2026-11-06)

A revisão 5 (`revisao-5.md`) leu a árvore `aff667a5`, a mesma do `verify:all` final. Ela terminou em **FAIL para a R1 inteira**, de acordo com o FAIL que a R1 já declarava:
- **B03:** aberto em (a), (b) e (c), um FAIL que ela considerou bem fundado;
- **Q01 a Q04 da revisão 4:** corrigidos;
- **código novo do Q02:** sem defeito nem regressão, conferido em todos os casos pedidos.

Ela achou ainda um MEDIUM (S01), um LOW (S02) e cinco INFO (S03 a S07). Todas as respostas abaixo são de documento. O código e os testes ficaram como os do `verify:all` final.

## S01 — MEDIUM — o RR-R1-03 deixa o B02 aberto num caso

| Item | Conteúdo |
| --- | --- |
| Achado | Segunda 20:00–06:00 reduzida a 8 h e terça 00:00–08:00 somam 960 min, quando o trabalho cabe em 720. Salvar aceita a configuração. O pedido manda recusar uma combinação sem interpretação determinística segura (`pedido-r1.md:100`), e a monotonia, que vale, é mais estreita que essa correção. |
| Resposta | **Aceito: o B02 passa a constar como aberto nesse caso.** A revisão aceitou como correção mínima declará-lo aberto nos documentos ou recusar a configuração, e a R1 fez a primeira. Mudaram a matriz, `rotinas-matematica.md` §6 (agora "Caso aberto"), o relatório (§1, §3 e RR-R1-03), a §20.16, os vereditos e as linhas de estado do plano. O `calendario-feriados.md` da P5-F.1 também mudou. |
| Por que não a recusa agora | A recusa é local, mas muda a regra de ambiguidade do motor e o argumento de solidez do conferidor:<br>• o `planDay` passaria a marcar sem cálculo seguro o dia seguinte, quando as horas dele mudam conforme a véspera reduzida ocupe ou não o trecho depois da meia-noite;<br>• o conferidor teria de procurar esse caso também sem janela com intervalo coberta, que hoje é o atalho dele.<br>As propriedades de monotonia, de solidez e de 24 h teriam de ser revistas com ela. Como a R1 já termina em FAIL pelo B03, a recusa fica para a próxima etapa corretiva, com testes e revisão próprios, e não entrou sem verificação no fim desta. |

## S02 — LOW — `VEREDITOS.md` com valores da árvore `775db140`

| Item | Correção |
| --- | --- |
| Escopo | Tem o quarto elo (as correções da revisão 4, lidas pela revisão 5 na `aff667a5`, a do `verify:all` final). Diz que depois dele só mudaram documentos, listados em `patches/mudancas-depois-do-verify-all.txt` |
| Mutantes | 77/77 de unidade e 5/5 do E2E |
| `diff --check` | O rascunho dos vereditos cita `diff-check-aff667a5.log`, o da árvore final |

## S03 — INFO — dois comportamentos do Q02 sem teste

| Item | Conteúdo |
| --- | --- |
| Achado | Não têm teste: mudar a jornada para aplicar a vários dias sem aplicar (não deve pôr a tela em edição) e a digitação inválida (deve pôr). Dois mutantes semânticos passam nos 158 testes de unidade e, pela leitura, no E2E. |
| Resposta | Registrado como teste que falta (relatório §11 e §20.16). O código está certo nos dois casos, como a própria revisão conferiu. Os testes sugeridos entram na próxima etapa:<br>• conferir a tela fora de edição depois de mudar só o "Fim" da jornada;<br>• apagar o "Fim" de um dia e conferir a nota de não salvo;<br>• conferir a jornada em 14:00 depois de "Descartar".<br>Pôr testes agora exigiria um novo `verify:all`, e a R1 já termina em FAIL. `respostas-revisao-4.md` diz agora que os dois casos estão sem teste. |

## S04 — INFO — os 8 pixels do s3

`visual/LEIAME.md` e `respostas-revisao-4.md` dizem agora o lugar certo:
- os 8 pixels ficam nos cantos do botão "Excluir meus dados", 20 linhas abaixo por causa da prévia;
- o texto do aviso do topo passa de x = 940 (640 pixels);
- a coluna das seções tem 126 pixels de antisserrilhado (delta até 8).

## S05 — INFO — o caso (a) tem fallback local

Os resumos da matriz, do relatório, da §20.16 e dos vereditos dizem agora o que vale para cada caso:
- (b) e (c) só se fecham mudando a arquitetura financeira;
- o (a) tem um fallback local, o fail-closed estrito, que o pedido exige onde não há prova (`pedido-r1.md:149`);
- a R1 não o adotou, porque ele deixa a estimativa em reais, às vezes por meses, depois de uma edição sem efeito na renda, e ele ficou para decisão.

## S06 — INFO — "revisões 2 e 3"

A matriz e o relatório dizem "revisões 2 a 4", como os vereditos.

## S07 — INFO — referências que dependem do fechamento

- **O que entrou na árvore:** `revisao-5.md`, estas respostas, as sondas (`sondas-revisao-5/`), os logs (`logs-revisao-5/`, com `integridade/`) e os recortes (`recortes-revisao-5/`). As cópias e os mutantes ficaram fora, como nas revisões anteriores.
- **Os índices:** o `revisoes/LEIAME.md` e o `LEIAME.md` da evidência os citam.
- **O que mudou depois do `verify:all`:** a lista completa está em `patches/mudancas-depois-do-verify-all.txt`, no pacote. São só arquivos em `docs/`.

## Depois das respostas

- **Código e testes:** os do `verify:all` final (`aff667a5`).
- **Revisões:** não houve revisão 6. As respostas acima são de documento e estão listadas aqui para a auditoria independente conferir.
- **Veredito da R1:** **FAIL**, com o B02 aberto num caso e o B03 em três.
