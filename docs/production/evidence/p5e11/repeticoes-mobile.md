# P5-E1.1 — Repetições do teste "F — celular 390×844 (toque)": todas as tentativas

Critério do pedido (§9.2): pelo menos 20 execuções consecutivas aprovadas por variante mobile (tema claro e tema escuro), na árvore final, com a spec original sem alteração, documentando todas as tentativas, inclusive as falhas.

## Como foi executado

- Spec original, sem nenhuma alteração: `e2e/notifications-p5d2.spec.ts` (SHA-256 começa com `08fd30570851559b`, o mesmo em todas as rodadas).
- Comando: `npm run test:e2e -- e2e/notifications-p5d2.spec.ts --grep celular --repeat-each=<N> --reporter=list`, no repositório, nas portas padrão, contra o Emulator do projeto `minhas-financas-local`. Sem `retries`, sem `waitForTimeout` e sem aumento de timeout.
- Cada execução reinicia os dados (`clearEmulatorData`). O build é o E2E (`npm run build:e2e`), nunca `dev`/`preview` com a configuração local.
- Depois de cada rodada, a JVM do Firestore Emulator que o Playwright deixa órfã foi encerrada só com identidade, propriedade e não uso comprovados, com SIGTERM ao PID ([`encerramentos-emulator.txt`](encerramentos-emulator.txt)).
- "Maior série" é a maior sequência de aprovações consecutivas da variante, na ordem de término.

## Rodadas oficiais (spec original, árvore do repositório)

| Rodada | Árvore | Execuções | Tema claro | Tema escuro | Maior série (claro / escuro) | Log |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Desenho A: ações no `touchend` | 40 | 19 ✓, 1 ✘ | 20 ✓ | 14 / 20 | [repeticoes-1-desenho-A.txt](repeticoes/repeticoes-1-desenho-A.txt) |
| 2 | Desenho B: roteamento do clique, com `layout` | 40 | 20 ✓ | 19 ✓, 1 ✘ | 20 / 13 | [repeticoes-2-desenho-B-com-layout.txt](repeticoes/repeticoes-2-desenho-B-com-layout.txt) |
| 3 | Desenho B sem `layout` (hipótese do `MeasureLayout`, refutada) | 80 | 37 ✓, 3 ✘ | 39 ✓, 1 ✘ | 23 / 28 | [repeticoes-3-desenho-B-sem-layout.txt](repeticoes/repeticoes-3-desenho-B-sem-layout.txt) |
| 4 | Roteamento do clique + fusão de marcas + re-render no `onExitComplete`, com o `layout` original (antes do foco na reentrega, L3/L4 da revisão 2) | 80 | 40 ✓ | 40 ✓ | 40 / 40 | [repeticoes-4-final.txt](repeticoes/repeticoes-4-final.txt) |
| **5** | **Árvore final: a da rodada 4, mais o foco que acompanha o clique reentregue e a reentrega só a dono com `click()` (L3/L4)** | **80** | **40 ✓** | **40 ✓** | **40 / 40** | [repeticoes-5-final.txt](repeticoes/repeticoes-5-final.txt) |

Todas as falhas das rodadas 1 a 3 têm o mesmo sintoma: `toHaveCount(7)` recebeu 8 (linha 971 da spec). As causas estão em [`diagnostico-notificacoes.md`](diagnostico-notificacoes.md):

- rodada 1: a ativação no `touchend` não ocorreu num toque, o click de compatibilidade caiu fora do botão e o arquivamento se perdeu (§4, histórico);
- rodadas 2 e 3: aviso arquivado preso no DOM pelo defeito do `AnimatePresence` do framer-motion 10.16.4 (§4.1). A rodada 3 mostrou que tirar o `layout` não resolvia.

Embora as rodadas 2 e 3 tenham séries de 20 ou mais em alguma variante, elas não atendem ao critério: a árvore ainda falhava. Na rodada 4, as 40 execuções de cada variante foram aprovadas em sequência. Depois dela, a revisão 2 levou a duas mudanças no `pressOrigin.ts` (o foco acompanha o clique reentregue; dono sem `click()` só tem o clique impedido), e por isso a rodada 5 repetiu a medição na árvore final: 40 ✓ no tema claro e 40 ✓ no escuro, com maior série de 40 e 40 (15,4 min). É a rodada que vale para o critério.

## Rodadas instrumentadas (cópias de diagnóstico, portas trocadas)

Servem ao diagnóstico, não ao critério. Spec com registro de eventos e, nas últimas, também o app instrumentado (só na cópia).

| Rodada | Árvore | Resultado | Uso |
| --- | --- | --- | --- |
| run1 | P5-E1 (antes de qualquer correção) | 17 ✓, 3 ✘ | causa 1: clique de compatibilidade redirecionado (§2–§3) |
| fix1 | desenho A | 20 ✓ | primeira validação |
| router | desenho B, com `layout` | 77 ✓, 3 ✘ | sem clique desviado; aviso preso |
| router2 | desenho B, com `layout`, estilos das linhas | 78 ✓, 2 ✘ | linha presa com `opacity: 0; height: 0px` |
| final1 | desenho B, sem `layout`, com o registro do app | 77 ✓, 3 ✘ | saída do F 04 começa 7–21 ms depois do `exitComplete` anterior e o aviso fica preso ([atrasos](diagnostico/forcerender/atrasos.txt)) |

As contagens também estão em [`diagnostico/contagens.txt`](diagnostico/contagens.txt).

## Spec nova (`e2e/notifications-mobile-p5e11.spec.ts`)

Os 20 casos (os 18 do §9.3, mais o 19 e o 20) foram aprovados na árvore final: 20/20 no pré-teste das 14:24–14:27Z, junto com `ai-consent-extraction.spec.ts` (12/12) e a regressão determinística `notifications-exit-race.spec.ts` (1/1), 33/33 em 3,0 min, no repositório e nas portas padrão ([`execucoes/e2e-specs-p5e11-final.txt`](execucoes/e2e-specs-p5e11-final.txt)). Os três rodam de novo no `npm run verify:all` ([`execucoes.md`](execucoes.md)).

Antes disso, a spec nova passou 20/20 às 12:51Z, numa árvore anterior ao foco na reentrega (L3/L4).
