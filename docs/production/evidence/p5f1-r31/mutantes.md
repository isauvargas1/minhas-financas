# P5-F.1-R3.1 — mutantes

**Como rodam.** Numa cópia da árvore: o worktree inteiro exceto `docs/`, com `node_modules` por link simbólico.
- Um mutante por vez, por troca exata que tem de casar uma única vez.
- Em seguida, `tests/unit/work-time-consistency.test.ts`, `tests/unit/work-time-income-estimate.test.ts` e `tests/unit/work-time-guard.test.ts` com `node --test`.
- Por fim, o arquivo é restaurado e conferido byte a byte (SHA-256).

O mutante está **morto** quando pelo menos um teste falha. Antes dos mutantes, a base de cada cópia rodou com 0 falhas.

## Rodadas

| Rodada | Árvore de código | Cópia | Resultado | Saída |
| --- | --- | --- | --- | --- |
| 1ª cópia (só `src/`, `tests/`, `package.json`) | `7ee80711` | `copia-mutantes` | **inválida**: a base falha 4 testes da guarda, que lê `functions/src` e `firestore.rules`, ausentes na cópia. Refeita com a árvore inteira | `saidas/mutantes-copia-1-base.log.txt` (reexecução da base) |
| Dirigidos A01–A11 | `7ee80711` | `copia-mutantes-2` | **11/11 mortos** | `saidas/mutantes-cliente-r31.log.txt` |
| Cliente da R3 (29) sobre a R3.1 | `7ee80711` | `copia-mutantes-2` | **29/29 mortos** | `saidas/mutantes-cliente-r3-na-r31.log.txt` |
| Dirigidos A01–A11, refeita depois das revisões | `196259af` | `copia-mutantes-3` | **interrompida** no começo, de propósito, para acrescentar o teste do segundo período e o A12. Só a base rodou (0 falhas). A cópia ficou com um mutante aplicado e não foi reaproveitada | `saidas/mutantes-cliente-r31-final-interrompida.log.txt` |
| **Dirigidos A01–A12 (final)** | **`d9fed573`** (código final) | `copia-mutantes-4` | **12/12 mortos** | `saidas/mutantes-cliente-r31-final.log.txt` |

Da árvore `7ee80711` para a final `d9fed573`, os testes só ganharam afirmações e nomes corretos. A conferência foi feita no diff de `tests/`: as únicas linhas removidas são o nome e o comentário antigos da propriedade. As mudanças:
- o R6-02 passa a conferir todas as renderizações até a prova;
- o segundo período no teste "antes e depois do tempo de interface";
- o nome da propriedade.

Por isso o resultado 29/29 dos mutantes da R3, obtido em `7ee80711`, vale para a árvore final: um teste que só ganha afirmações não deixa vivo um mutante que já matava. O código de produção de `7ee80711` para `d9fed573` difere só em comentários.

## Mutantes dirigidos à R3.1 (`mutantes-cliente-r31.py`)

Alvo: `src/modules/work-time/useIncomeEstimateWith.ts`, isto é, `holdEstimate` e a integração no fim do gancho. Resultado final na árvore `d9fed573`: **12 de 12 mortos**.

| Mutante | O que muda | Falhas | Exemplo de teste que o mata |
| --- | --- | ---: | --- |
| A01 | Retenção reintroduzida: um `useRef` guarda a última pronta e a devolve quando a atual não está pronta (o comportamento da R3) | 27 | B03 (R8-02), R3.1 (R3-AUD-01) |
| A02 | Sem prova, a atual aparece (`settling` só) | 37 | B03, janela de 12 meses com a escuta encerrada |
| A03 | A sincronização é ignorada (`!proven` só) | 7 | R3.1: provada, mas com a sincronização em curso |
| A04 | `holding` não passado (`false`) | 4 | o mesmo |
| A05 | A prova não passada (`true`) | 35 | B03, 12 meses com a escuta encerrada |
| A06 | Sem "em atualização" (a linha do prazo removida) | 13 | revisão pt-BR da R3 (M-01) |
| A07 | "Em atualização" só sem prova, não na sincronização longa | 2 | R3.1: provada, mas com a sincronização em curso |
| A08 | A falha de leitura vira "calculando" (sem "Tentar de novo") | 10 | B03, 12 meses com a escuta encerrada |
| A09 | "Em atualização" sem esperar o prazo (`waitMs = 0`) | 17 | B03: a projeção mais nova que a base lida na montagem |
| A10 | Com uma leitura em falha, a estimativa sem prova aparece | 14 | B03, 12 meses com a escuta encerrada |
| A11 | A atual, provada e sincronizada, perde o aviso de releitura em falha (`refreshFailed: false`) | 6 | B03: uma base e nenhuma desconsiderada, a leitura única provada com a escuta encerrada, com a ressalva |
| A12 | O prazo não volta a zero ao sair da espera (`setWaitedTooLong(false)` removido): o segundo período começa direto em "em atualização" | 1 | R3.1: antes e depois do tempo de interface (segundo período) |

O que cada um protege:
- A01 é a regressão exata do R3-AUD-01.
- A11 protege o item 6 do pedido: o aviso continua.
- A12 é o M8 da revisão adversarial (rodada 1), que sobrevivia porque nenhum teste cobria dois períodos de espera seguidos. Ele só muda o texto, nunca a conversão. Com a R3.1, os períodos de espera ficaram frequentes, um a cada sincronização.

A revisão adversarial rodou também 8 mutantes próprios na árvore da rodada 1 (`revisoes/adversarial/`). Morreram 7, entre eles uma retenção por `useRef<any>`, que a expressão da guarda não pega e os testes de comportamento matam. Sobreviveu o M8, só de texto, que é o A12 acima, morto na árvore final. A revisão financeira rodou 4 (`revisoes/financeiro/saidas/mut-*.txt`), todos mortos.

## Mutantes do cliente da R3 sobre a R3.1 (`evidence/p5f1-r3`, `mutantes-cliente-r3.py`)

Os 29 mutantes da R3 rodaram de novo com os testes da R3.1:
- P01–P16: a prova pelas marcas;
- C01–C02: a ordem das regras;
- H01–H05: o gancho;
- R01: a impressão digital;
- Q01–Q05: o RR-R2A-04.

Resultado: **29 de 29 mortos**, base com 0 falhas. Nenhum teste da R3.1 deixou de matar um mutante que a R3 matava.

## Fora do alvo

Os mutantes do backend da R3 (marcas, gatilho, reconstrução) não foram rodados de novo. A R3.1 não muda nenhum arquivo de `functions/`, `firestore.rules` nem `firestore.indexes.json`: o manifesto está no pacote, e o roteiro de empacotamento recusa o diff se algum desses arquivos aparecer. A suíte de integração no Emulator, que cobre esse código, roda inteira no `verify:all`.
