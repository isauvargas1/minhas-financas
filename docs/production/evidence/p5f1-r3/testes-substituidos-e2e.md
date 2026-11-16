# P5-F.1-R3 — Testes E2E substituídos pelo desenho das marcas (B03)

**Resultado: nenhuma substituição foi necessária.**

Com o código atual da R3 (gatilho com marcas de aplicação, prova no cliente sem prazo que aprove), foram executadas sem alteração:

| Spec | Resultado |
| --- | --- |
| `e2e/work-time-p5f.spec.ts` | 19 de 19 passaram |
| `e2e/cash-pending-entries.spec.ts` | 2 de 2 passaram |

Execução única de `run-pw.sh t1 dejavu e2e/work-time-p5f.spec.ts e2e/cash-pending-entries.spec.ts`: `21 passed (3.5m)`, build E2E da árvore atual, Emulator `minhas-financas-local`. Log: `scratchpad/p5f1r3/logs/t1.log`.

Nenhuma asserção, tempo-limite ou cenário desses specs foi alterado. Os testes que cobrem a espera por prova de consistência (`mutação nesta aba: anular em Receitas…`, `atualização automática: receita retroativa…` e `B01 (P5-F.1-R1)…`) já afirmavam o que o desenho novo garante: nunca um valor intermediário na prévia (`__p5fHourly` igual a `R$ 25,00` do começo ao fim) e a conversão só com os dois lados do estado consistentes. Eles seguem válidos porque a prova só termina quando a projeção e o conteúdo lido concordam, e nenhum depende de um prazo que aprove a conversão.

A cobertura nova do desenho (marca quebrada, reconstrução, troca de exclusões, mudança de mês e edição por outro usuário) está em `e2e/work-time-b03.spec.ts`, como testes novos e não como substituição.
