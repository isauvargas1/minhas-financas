# P5-F.1-R3 — mutantes

Cada mutante muda uma regra do código entregue; um teste precisa falhar. Os roteiros aplicam um mutante por vez numa **cópia** da árvore (o worktree não é tocado), exigem que o trecho trocado case exatamente uma vez, rodam os testes, restauram o arquivo e conferem o SHA-256 do original. Roteiros em `sondas/` (`mutantes-cliente-r3.py`, `mutantes-backend-r3.py`, `mutantes-marcas-rapido.py`); saídas em `saidas/`.

## 1. Cliente: prova pelas marcas, regra 5, gancho da estimativa e releitura do Dashboard

Roteiro `mutantes-cliente-r3.py`, 29 mutantes (28 na 1ª rodada; o P16 entrou com a regra A02), testes de unidade: `work-time-projection-proof`, `work-time-consistency`, `work-time-income-estimate`, `work-time-estimate`, `work-time-guard`, `report-live-refresh`, `report-live-refresh-freshness`, `report-basis-sync`.

| Rodada | Resultado |
| --- | --- |
| 1ª (`saidas/mutantes-cliente-r3.log.txt`) | 26 de 28 mortos; **sobreviveram P11 e R01** |
| Reverificação depois do reforço dos testes (`saidas/mutantes-cliente-r3-reverificacao.log.txt`) | P11 e R01 mortos: **28 de 28** |
| Final, sobre o código com a regra A02 (`saidas/mutantes-cliente-r3-final.log.txt`) | 28 de 29; **sobreviveu P07**. Com a A02, o caso que o matava passou a recusar antes, no próprio recebimento |
| Reverificação do P07 (`saidas/mutantes-cliente-r3-p07.log.txt`), com o caso novo "recebimento não encontrado e estorno vivo na projeção" | P07 morto: **29 de 29** |

| Mutante | Arquivo | Morto por |
| --- | --- | --- |
| P01 mês sem etiqueta aceito | `projectionProof.ts` | prova: mês sem `projectionGeneration` |
| P02 gerações diferentes aceitas | `projectionProof.ts` | prova: gerações diferentes |
| P03 bases sem conferência com os meses | `projectionProof.ts` | prova: receita das bases diferente |
| P04 marca quebrada vale como nada | `projectionProof.ts` | prova e gancho (R3, c) |
| P05 pendência ignorada | `projectionProof.ts` | prova e gancho (R3, b) |
| P06 impressão não comparada | `projectionProof.ts` | 16 testes, inclusive a propriedade |
| P07 estorno sem recebimento aceito | `projectionProof.ts` | prova de estorno; depois da A02, pelo caso do recebimento não encontrado com o estorno vivo na projeção |
| P08 âncora depois de raiz `absent` aceita | `projectionProof.ts` | paridade com a fixture do backend |
| P09 geração mais nova na posição ignorada | `projectionProof.ts` | `superseded` |
| P10 raiz `event` sem âncora aceita | `projectionProof.ts` | paridade com a fixture do backend |
| P11 criação casa com qualquer nó | `projectionProof.ts` | **sobreviveu na 1ª rodada**; morto pela paridade com a fixture depois de três casos novos gerados pelo backend (criação pendente sobre nó vivo, com e sem âncora, e sobre nó apagado) |
| P12 chaves do mapa sem ordenar | `projectionProof.ts` | fixture de impressão digital |
| P13 `Timestamp` sem nanossegundos | `projectionProof.ts` | fixture de impressão digital |
| P14 posições diferentes aceitas | `projectionProof.ts` | `slot_mismatch` |
| P15 absorção ignora o conteúdo | `projectionProof.ts` | paridade com a fixture do backend |
| P16 nó ausente com o lido presente prova (A02) | `projectionProof.ts` | regressão A02 e os testes de marca ausente e de estorno |
| C01 regra 5 ignorada | `consistency.ts` | 15 testes |
| C02 prova ausente vale como provada | `consistency.ts` | ordem das regras |
| H01 itens das leituras mesmo provado | `useIncomeEstimateWith.ts` | B01 (estorno lido antes de aplicado) |
| H02 leitura de outra janela aceita | `useIncomeEstimateWith.ts` | guarda estática. Em execução é equivalente: a chave da leitura por id leva a janela (`scope`), sem `placeholderData`, então o dado de outra janela não chega ao gancho; a conferência fica como defesa |
| H03 marcas dos estornos não lidas | `useIncomeEstimateWith.ts` | B01 (estorno em outra sessão) |
| H04 sem "estimativa em atualização" | `useIncomeEstimateWith.ts` | 9 testes (ex-N03, ex-P01) |
| H05 sem releitura por motivo passageiro | `useIncomeEstimateWith.ts` | 4 testes |
| R01 impressão do normalizado, não do bruto | `receivableReversal.ts` | **sobreviveu na 1ª rodada** (o mundo de teste devolvia o mesmo objeto como normalizado e bruto); morto, 26 falhas, depois de o mundo separar o documento guardado (sem `id`, como no Firestore) do normalizado (com `id`). Sem o reforço, o defeito só tiraria a conversão (nunca a mostraria errada) |
| Q01 releitura cancela sempre (comportamento antigo) | `reports/queryKeys.ts` | decisão pura e releitura |
| Q02 começo igual à mudança conta como depois | `reports/queryKeys.ts` | decisão pura |
| Q03 primeira leitura sem releitura depois | `reports/queryKeys.ts` | primeira leitura reaproveitada |
| Q04 começo da leitura não anotado | `reports/queryKeys.ts` | leitura em curso preservada |
| Q05 leitura em curso nunca relida | `reports/queryKeys.ts` | decisão pura, rajada |

## 2. Backend: regras puras das marcas (rápidos)

Roteiro `mutantes-marcas-rapido.py` sobre o JavaScript compilado de `functions/src/cash/projectionMarks.ts`, teste `lib/cash/__tests__/projectionMarks.test.js` (inclui a propriedade INV-M). Saída: `saidas/mutantes-marcas-rapido.log.txt`. **7 de 7 mortos.**

| Mutante | Falhas |
| --- | --- |
| M1 sempre avança (sem pendência) | 4 |
| M2 raiz `event` sem âncora aceita | 3 |
| M3 ignora a âncora | 4 |
| M4 criação casa com qualquer nó | 2 |
| M5 absorção ignora o conteúdo | 4 |
| M6 âncora com raiz `absent` aceita | 3 |
| M7 cadeia de outra geração vale | 3 |

## 3. Backend: gatilho e reconstrução no Emulator

Roteiro `mutantes-backend-r3.py`. Cada mutante é aplicado numa cópia do backend, compilado (`tsc`) e testado com a integração das marcas (`lib/cash/__tests__/projectionMarks.integration.test.js`) num Emulator isolado (projeto `minhas-financas-local`, portas próprias). Um mutante que não compila não conta como morto por teste: ganha uma variante que compila.

| Rodada | Código | Resultado |
| --- | --- | --- |
| Preliminar, **interrompida** (`saidas/mutantes-backend-r3-preliminar.log.txt`) | antes das correções A01 e A03 | B01 não compilava (variante refeita). B02, B03 e B07 mortos. **Sobreviveram B04, B05 e B06.** Foi interrompida no B08 para aplicar a correção do A01. A interrupção deixou o `rebuild.ts` da cópia mutado; a cópia foi refeita a partir do worktree e conferida por SHA-256 antes da rodada final |
| Final (`saidas/mutantes-backend-r3-final.log.txt`) | final, com A01 e A03 e os testes novos | **11 de 12 mortos; sobreviveu B09** |
| Reverificação do B09 (`saidas/mutantes-backend-r3-b09.log.txt`) | final, com o teste do incidente depois do corte | B09 morto: **12 de 12** |
| Poda (`saidas/mutantes-backend-r3-poda.log.txt`) | com a poda do gatilho (L-PRI-02) e o teste 15. B01 refeito para o código novo. A cópia diferia da árvore final só num comentário de `periods.ts` e no teste 16 (corrida), que entrou depois | **B01 e B13 a B16: 5 de 5 mortos**, base 15/15 |

| Mutante | Arquivo | Morto por |
| --- | --- | --- |
| B01 marca montada e não gravada no gatilho | `periods.ts` | 11 testes |
| B02 só a geração publicada recebe o evento | `periods.ts` | reconstrução com eventos posteriores; muitas edições antes do commit da página; recriação com o mesmo id |
| B03 quebra não registra a recuperação | `periods.ts` | teto de pendências; recriação (registro do conflito) |
| B04 meses do gatilho com a etiqueta inicial | `periods.ts` | **sobreviveu na preliminar**; morto pela verificação nova da etiqueta do mês depois da publicação |
| B05 evento sem a hora do estado anterior (sem raiz `event`) | `periods.ts` | **sobreviveu na preliminar**: a absorção das pendências dava a mesma visão. Morto pelo teste novo "muitas edições depois do corte, entregues antes do commit da página", em que a raiz no estado do corte evita o teto de 16 pendências |
| B06 gatilho não repassa a hora do estado anterior | `triggers/transactions.ts` | igual ao B05 |
| B07 varredura sem âncoras | `rebuild.ts` | 8 testes |
| B08 publicação não troca a posição das marcas | `rebuild.ts` | 8 testes |
| B09 publicação desliga a recuperação sem conferir o corte | `rebuild.ts` | **sobreviveu na final**; morto pelo teste novo "incidente de marca depois do corte, durante a preparação: a publicação mantém o registro e a reconstrução seguinte o desliga" |
| B10 meses publicados com a etiqueta inicial | `rebuild.ts` | 2 testes |
| B11 âncora com a geração inicial, não a preparada | `rebuild.ts` | 8 testes |
| B12 publicação sem conferir que as entregas alimentaram a preparada (A01) | `rebuild.ts` | "entrega com commit depois do corte que leu o estado antes do checkpoint" |
| B13 gatilho sem poda: as componentes superadas ficam | `periods.ts` | teste 15 (poda) |
| B14 poda apaga a geração preparada | `periods.ts` | 5 testes (7, 8, 10, 13 e 15): a âncora da preparada some numa entrega durante a preparação |
| B15 poda não tira âncoras superadas | `projectionMarks.ts` | teste 15, depois da segunda reconstrução |
| B16 poda não tira cadeias superadas | `projectionMarks.ts` | teste 15 |

**Total do backend no Emulator:** 16 de 16 mutantes mortos (B01 a B12 nas rodadas anteriores; B01, refeito, e B13 a B16 na rodada da poda).

## 4. S01 e S03 (R2A) sobre a árvore da R3

Roteiro da R2A (`p5f1r2a/mutantes-r2a.py`, SHA-256 `7cb70f11…`, sem alteração), rodado sobre uma cópia da árvore da R3. O motor de calendário, o editor de rotinas, os testes deles e `e2e/work-time-p5f.spec.ts` são iguais aos da R2A. Saída em `saidas/mutantes-r2a-na-r3.log.txt`: **38 de 38 mortos**, 0 que não compilam, em 593 s. O SHA-256 dos 416 arquivos de `src/`, `tests/` e `e2e/` da cópia é o mesmo antes e depois. S01 e S03 não foram enfraquecidos.
