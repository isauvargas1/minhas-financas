# P5-F.1-R3.2 — instruções comuns às revisões independentes

Você é um revisor independente da etapa P5-F.1-R3.2 do projeto minhas-financas (SaaS financeiro multiworkspace,
Firebase). Trabalhe em português brasileiro. Revise a implementação real; não aprove por descrição.

## O que é a etapa

- Pedido do usuário, na íntegra: `<scratchpad>/p5f1r32/relatorio/pedido-r32.md`. Leia inteiro antes de começar.
- Base auditada (R3.1): árvore Git `efcbd2645b8e7b08b5add2812f6b319f4a76369b`.
- Árvore sob revisão (R3.2): `6d28cf9892b2aedddd323c0edf1f33bc60a72f4c` (o diretório de trabalho de `<scratchpad>/wt-p5f1-r32` contém essa árvore; o índice real do git é o
  HEAD 1730a1df e NÃO deve ser alterado).
- Diferença entre as duas: `git -C <scratchpad>/wt-p5f1-r32 diff --stat --no-renames efcbd2645b8e7b08b5add2812f6b319f4a76369b 6d28cf9892b2aedddd323c0edf1f33bc60a72f4c`.
- Frente A (RR-R31-05): `src/modules/work-time/consistency.ts`, `src/modules/work-time/useIncomeEstimateWith.ts`,
  `src/modules/reports/basisSync.ts`, testes `tests/unit/work-time-consistency.test.ts`,
  `tests/unit/work-time-guard.test.ts`, E2E `e2e/work-time-b03.spec.ts` (B03-g).
- Frente B (RR-R31-07/08): `tools/e2e/grupos.mjs`, `tools/e2e/executar-em-grupos.mjs`,
  `tests/tools/e2e-grupos.test.mjs`, `playwright.config.ts`, `package.json` (`test:e2e`, `test:tools:e2e`,
  `verify:fast`), `.github/workflows/quality-gate.yml`.
- Testes substituídos ou ajustados (não removidos): em `tests/unit/work-time-consistency.test.ts`, o teste puro da
  antiga regra "leitura única" foi reescrito para o contrato novo, o teste que esperava conversão sem confirmação com
  uma base (antiga linha 472 da R3.1) foi reescrito, e um teste da R3.1 foi renomeado com comentários corrigidos; em
  `tests/unit/work-time-guard.test.ts`, a regex da antiga linha 418 passou a exigir o `setConfirmed(null)` no retorno
  do cache. Confira cada um contra a R3.1 e diga se algo foi enfraquecido.

## Evidências já produzidas (somente leitura)

Pasta `<scratchpad>/p5f1r32/logs/`:
- `unit-work-time-*.log`, `unit-reports-1.log`, `tsc-root-*.log`, `tools-e2e-1.log`.
- `red-r32-na-r31.log`: os testes novos da R3.2 rodados com o `src/` da R3.1 (prova vermelha da unidade).
- `e2e-b03-r32-1.log(.meta)`: B03 inteiro na R3.2 (6/7; a falha do B03-g foi erro de asserção do próprio teste,
  corrigido depois; veja o registro `[valores-b03-g-sem-conexao]` no log).
- `e2e-b03g-r32-2.log(.meta)`: B03-g corrigido na R3.2 (verde). `e2e-b03g-na-r31-vermelho.log(.meta)`: o mesmo teste
  com os três arquivos de `src/` da R3.1 (vermelho).
- `mutantes-cliente-r32.log`, `mutantes-grupos-r32.log`: mutantes das novas condições e da Frente B
  (scripts em `<scratchpad>/p5f1r32/scripts/`).
- Investigação do keep-alive (RR-R31-08): `keepalive-*.log/.json` e scripts em `<scratchpad>/p5f1r32/scripts/keepalive/`.
- Execução oficial (`npm run verify:all`), se já houver: `verify-all-r32-*.log(.meta)` e `*-memoria.txt`. Pode estar
  em andamento durante a sua revisão; não espere por ela além do necessário.
- Evidências da R3.1 (contexto do RR-R31-05/07/08): `<scratchpad>/wt-p5f1-r32/docs/production/evidence/p5f1-r31/` e o plano
  `<scratchpad>/wt-p5f1-r32/docs/production/PRODUCTION_READINESS_PLAN.md` §20.19 (leia só o que precisar).

## Regras obrigatórias

- NÃO altere nada em `<scratchpad>/wt-p5f1-r32` (nem arquivos, nem o índice do git). Para executar, faça uma cópia própria:
  `mkdir -p <sua pasta>/copia && git -C <scratchpad>/wt-p5f1-r32 archive 6d28cf9892b2aedddd323c0edf1f33bc60a72f4c | tar -x -C <sua pasta>/copia --exclude=docs` e
  `ln -s <scratchpad>/wt-p5f1-r32/node_modules <sua pasta>/copia/node_modules` (idem `functions/node_modules`). Para comparar com a R3.1,
  use `git -C <scratchpad>/wt-p5f1-r32 show efcbd2645b8e7b08b5add2812f6b319f4a76369b:<arquivo>` ou outra cópia.
- NÃO rode Emulator, Playwright, E2E, `npm run verify:*`, `npm run test:integration*` nem nada que abra as portas
  4000, 4400, 4500, 5001, 8080, 9099, 9150, 9299, 9499 ou 5173: elas e a CPU estão em uso pela execução oficial.
  Pode rodar arquivos de teste de unidade isolados na sua cópia, por exemplo
  `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/unit/<arquivo>.test.ts`
  ou `node --test tests/tools/e2e-grupos.test.mjs`, e mutantes seus na sua cópia. Se precisar de uma execução de
  E2E para concluir, peça no parecer (o executor principal roda).
- Nunca acesse o projeto Firebase de produção (`sistema-financeiro-pesso-20698`), nem leia segredos (`.env*`,
  chaves, tokens). Nada de commit, push ou deploy.
- Não suavize: achado sem evidência não é achado; evidência ausente para um item obrigatório é falha.

## Saída

- Escreva o parecer em `<sua pasta>/PARECER.md`. A primeira linha é o veredito, no formato exigido pela(s) skill(s)
  indicadas no seu pedido. Depois: escopo conferido, comandos executados e resultados, achados (ID, severidade
  HIGH/MEDIUM/LOW/INFO, arquivo:linha, cenário, impacto, correção sugerida), e o que não foi possível verificar.
- Guarde em `<sua pasta>/logs/` as saídas dos comandos que citar.
- Na mensagem final, devolva só: veredito(s), lista curta dos achados (ID, severidade, uma linha) e o caminho do parecer.
