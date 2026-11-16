# P5-F.1-R1 — respostas à revisão independente 3 (2026-11-06)

A revisão 3 (`revisao-3.md`) leu a árvore `6c459430` e terminou em **FAIL**, sem defeito de código nos três bloqueadores:
- **B01:** corrigido. A ordem dos pares (M07) passou na sonda dela: 0 pares partidos em 3.000 listas.
- **B02:** corrigido, e a prova reescrita do Teorema 2 está correta. A revisão conferiu contra `planDay`, com geradores e um oráculo geométrico próprios:
  - 137.211 pares sem violação de monotonia;
  - 16,2 milhões de dias sem dia civil acima de 24 h fora da exceção do §6;
  - os passos 1 a 5 da prova valem em 3,49 milhões de dias.
- **B03:** corrigido dentro dos limites registrados. A espera pela hora do servidor usa só horas do servidor, não cria estado misto além do limite (a) e não prende a estimativa.
- M01 e M03 a M07: corrigidos.

O FAIL veio de dois pontos:
- um teste que faltava (P01);
- afirmações falsas no rascunho de `VEREDITOS.md` (P02).

Ficaram ainda quatro ajustes de documento e pacote (P03 a P06).

## P01 — LOW — o limite de 30 s da espera pela hora do servidor não tinha teste

| Item | Conteúdo |
| --- | --- |
| Correção | Três testes novos em `work-time-consistency.test.ts`, os da sonda da revisão, com o mundo de teste dando `generatedAt` em ISO, como as Functions:<br>• o N03 no caminho de produção: a sessão abre 5 s depois da edição de valor, e nunca aparece R$ 10.260,00;<br>• a base gerada 59 s depois da escrita, com espera de 60 s: ainda segura;<br>• 60 s: encerra.<br>Mutantes novos: U74, o da revisão, que encerra a espera 1 ms depois da escrita; e U75, `<` no lugar de `<=`. |
| Resultado | Consistência: 30/30. Mutantes da espera: U69, U70, U71, U74 e U75, 5/5 mortos (`mutantes-r1-rev3.log`).<br>Antes da correção, o mutante de 1 ms passava em toda a suíte, e na `d7dabb10` só o caso de 60 s reprova (`logs-revisao-3/r3-espera-servidor.*.log.txt`).<br>O texto de `respostas-revisao-2.md` foi ajustado: U70 cobre a forma estrita; U71, U74 e U75, o limite. |

## P02 — LOW — `VEREDITOS.md` afirmava coisas falsas sobre o código revisado

| Item | Conteúdo |
| --- | --- |
| Correção | O escopo diz agora a ordem certa: a `d7dabb10` lida pela revisão 2; as correções da revisão 2 lidas pela revisão 3 na `6c459430`; e as da revisão 3, lidas pela revisão 4. Os mutantes são os da árvore final (75/75), não 67/67. |

## P03 — INFO — "não recomeça a cada montagem" só vale com bases geradas 30 s depois da escrita

| Item | Conteúdo |
| --- | --- |
| Correção | `DATA_MODEL.md` e `matriz-bloqueadores.md` agora dizem: não recomeça quando as bases em uso foram geradas 30 s ou mais depois da escrita; com bases em cache geradas antes disso, conta no relógio de cada montagem até a base ser relida.<br>É o que o §5 de `consistencia-estimativa.md` e `respostas-revisao-2.md` já diziam. A sonda da revisão (`logs-revisao-3/r3-remonta-cache.log.txt`) mostra o caso: fail-closed, sem número errado, e raro. |

## P04 — INFO — logs da revisão 2 fora da árvore, e duas sondas que não rodavam como estão

| Item | Conteúdo |
| --- | --- |
| Correção | Na árvore:<br>• `revisoes/logs-revisao-2/`, com todos os logs da revisão 2, inclusive os da raiz da pasta de trabalho (`unit-snap.log`, `antes-*.log`, `sondas-r1.log`);<br>• `revisoes/sondas-revisao-3/` e `revisoes/logs-revisao-3/`.<br>**Correção posterior (revisão 4, Q01):** até a árvore `775db140`, os logs não entravam na árvore, porque o `.gitignore` ignora `*.log`. Agora estão como `.log.txt`.<br>`revisoes/LEIAME.md` explica as duas sondas de gancho que fixam o caminho de `node_modules` e como rodá-las (`` `${root}/node_modules` ``, como fez a revisão 3). |

## P05 — INFO — o registro do M09 não estava no §2

| Item | Conteúdo |
| --- | --- |
| Correção | `rotinas-matematica.md` §2 ganhou o parágrafo "Fora do horizonte": o efeito (o dia sem cálculo seguro num mês mais antigo que 12 meses, no calendário de exceções), o alcance (nenhuma estimativa usa esse mês) e o teste do horizonte. O risco está em RR-R1-02. |

## P06 — INFO — deslizes de notação na prova

| Item | Conteúdo |
| --- | --- |
| Correção | `rotinas-matematica.md` §4, passo 6: "Cada perda `δ_d > 0`… compensada pelo ganho `ΔT_{d−1} = δ_d`", e "(§3, Período)" no lugar de "(E1)". |

## Depois das correções

- O código de `src/` é o mesmo que a revisão 3 leu; só entraram os testes de P01 e documentos.
- Mutantes: 75/75 (`mutantes.md`). O `verify:all` final roda sobre a árvore corrigida.
- A revisão independente 4, somente leitura, confere estas correções (`revisao-4.md`).

**Veredito da R1.** A revisão deu o B03 como corrigido dentro dos limites registrados. O veredito da R1 é mais estrito: **FAIL**, porque nos casos (a), (b) e (c) de `consistencia-estimativa.md` §6 ainda pode aparecer uma conversão incorreta até o gatilho gravar. O pedido diz que convergir depois não basta (relatório, §1; matriz, B03).
