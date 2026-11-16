# P5-F.1-R3.2 — instruções comuns da rodada 3 das revisões independentes

Você é um revisor independente da etapa P5-F.1-R3.2 do projeto minhas-financas (SaaS financeiro multiworkspace,
Firebase). Trabalhe em português brasileiro. Revise a implementação real; não aprove por descrição. Esta é a rodada 3:
a rodada 2 revisou a árvore `9fddcb5ad93f030bcd991820db85ca9a2b233976`, e o executor corrigiu ou respondeu cada achado
de todas as revisões.

Caminhos (use-os por extenso): `S=<scratchpad>`,
`W=$S/wt-p5f1-r32`, `R=$S/p5f1r32`.

## O que revisar

- Pedido do usuário, na íntegra: `$R/relatorio/pedido-r32.md`. Releia o critério de encerramento.
- Base auditada (R3.1): árvore `efcbd2645b8e7b08b5add2812f6b319f4a76369b`.
- **Árvore sob revisão (código final da R3.2): `ef514869087c2b9e8e910a25fc7c18174418b8bb`.** O diretório `$W` contém
  essa árvore (o índice real do git é o HEAD 1730a1df e NÃO deve ser alterado). Depois dela, só `docs/` pode mudar
  (evidência, plano e relatório, que o executor escreve depois da execução oficial).
- O que mudou desde a sua rodada 2: `git -C $W diff --stat --no-renames 9fddcb5ad93f030bcd991820db85ca9a2b233976 ef514869087c2b9e8e910a25fc7c18174418b8bb`
  (e o diff completo, arquivo por arquivo). Tudo desde a R3.1: o mesmo comando a partir de `efcbd264…`.
- Seus pareceres anteriores: `$R/revisoes/<sua área>/PARECER.md` (rodada 1) e `$R/revisoes/<sua área>/rodada-2/PARECER.md`.
  Os pareceres da rodada 2 das outras áreas estão nas pastas vizinhas (leia ao menos os achados abertos delas).
- As respostas do executor a todos os achados, das duas rodadas: `$R/evidencia-rascunho/revisoes-LEIAME.md` (seção
  "Rodada 2" para os da rodada 2).
- Histórico de todas as execuções, inclusive as falhas e interrupções: `$R/historico-execucoes.md` (execuções 38 a 54
  depois da sua rodada 2).

## Mudanças desde a rodada 2 (para conferir, não para aceitar)

- **F-08 (financeira) e ADV-R2-01 (adversarial):** `holdEstimate` (`src/modules/work-time/useIncomeEstimateWith.ts`)
  segura toda estimativa `done` que traz números das bases (`carriesBasisFigures`: `ready`, ou `months` não vazio)
  sem prova ou com a sincronização em curso; a indisponível sem números aparece como está. Comentários de
  `consistency.ts` e do gancho revistos.
- **Testes do F-08:** a tabela-verdade de `tests/unit/work-time-income-estimate.test.ts` (motivos com e sem números,
  conferidos contra `UNAVAILABLE_REASON_TEXT`); o bloco "o estado indisponível" de `tests/unit/work-time-consistency.test.ts`
  (29 testes, com as sondas R2-01 a R2-03 da financeira, a ressalva `refreshFailed` e o ADV-R2-07); a regex da guarda
  em `tests/unit/work-time-guard.test.ts`.
- **Frente B:** a lista do que é aceito como argumento (`tools/e2e/grupos.mjs`; ADV-R2-03, EST-13); o SIGQUIT
  tratado (`tools/e2e/executar-em-grupos.mjs`; EST-12) e o cabeçalho revisto; `tests/tools/e2e-grupos.test.mjs` com o
  `npx` falso em cadeia (ADV-R2-02), o prazo 0 (ADV-R2-04) e os casos do EST-11 (SIGHUP, SIGQUIT, sinal entre os
  grupos, sinal depois do último). RB-04 (`docs/production/RUNBOOKS.md`) com a interrupção (ADV-R2-05, EST-12).
- **E2E:** "ADV-01 (R3.2)" imprime as sequências gravadas (PT-R32-08 b); comentário revisto. Nenhum título mudou.
- **Procedimento:** o `run-oficial.sh` guarda os relatórios por grupo e os logs do Emulator (EST-15).

## Testes substituídos ou ajustados desde a rodada 2 (nenhum removido; confira se algo foi enfraquecido)

- `tests/unit/work-time-guard.test.ts`: a regex do `holdEstimate` (a expressão da rodada 2, com
  `state.estimate.status === 'ready'`, pela da final, com `carriesBasisFigures(state.estimate)`, e a do próprio
  `carriesBasisFigures`).
- `tests/unit/work-time-income-estimate.test.ts`: a tabela-verdade do ADV-01, reescrita para o F-08.
- `tests/unit/work-time-consistency.test.ts`: o bloco do ADV-01, reescrito e ampliado para o F-08.
- `tests/tools/e2e-grupos.test.mjs`: o `npx` falso e o ajudante dos sinais; a lista de argumentos aceitos e recusados.

## Evidências (somente leitura), em `$R/logs/`

- Execuções 38 a 53 do histórico (unidade, tipos, ferramentas, `sinais-r2-vermelho.log`, `mutantes-cliente-n2x.log`).
- Roteiros de mutantes em `$R/scripts/` (o executor roda todos de novo na árvore final depois da execução oficial).
- **Execução oficial em andamento:** `verify-all-r32-4.log` e `.log.meta` (início 18:30:01Z, árvore `ef514869`), com o
  amostrador de memória `verify-all-r32-4-memoria.txt`. Leva de 50 a 60 minutos.

## Regras obrigatórias

- NÃO altere nada em `$W` (nem arquivos, nem o índice do git). Para executar, faça uma cópia própria:
  `mkdir -p <sua pasta>/rodada-3/copia && git -C $W archive ef514869087c2b9e8e910a25fc7c18174418b8bb | tar -x -C <sua pasta>/rodada-3/copia --exclude=docs`
  e `ln -s $W/node_modules <sua pasta>/rodada-3/copia/node_modules` (idem `functions/node_modules`).
- **A execução oficial está rodando:** NÃO rode Emulator, Playwright, E2E, `npm run verify:*`, `npm run test:integration*`
  nem nada que abra as portas 4000, 4400, 4500, 5001, 8080, 9099, 9150, 9299, 9499 ou 5173. Rode tudo o que rodar
  (testes de unidade isolados, `tests/tools/*`, mutantes seus, `tsc`) com `nice -n 19` na frente, um de cada vez, na
  sua cópia. Se precisar de uma execução E2E para concluir, peça no parecer.
- Nunca acesse o projeto Firebase de produção (`sistema-financeiro-pesso-20698`), nem leia segredos (`.env*`, chaves,
  tokens). Nada de commit, push ou deploy.
- Não suavize: achado sem evidência não é achado; evidência ausente para um item obrigatório é falha.

## Saída

- Parecer em `<sua pasta>/rodada-3/PARECER.md`. A primeira linha é o veredito no formato do seu pedido. Depois: escopo
  conferido, comandos executados e resultados, a situação de cada achado seu das rodadas 1 e 2 (fechado, aberto ou
  rebaixado, com evidência), achados novos (ID com o prefixo da sua área e `R3`, por exemplo `F-R3-01`; severidade
  HIGH/MEDIUM/LOW/INFO, arquivo:linha, cenário, impacto, correção sugerida) e o que não foi possível verificar.
- Saídas dos comandos citados em `<sua pasta>/rodada-3/logs/`.
- Na mensagem final, devolva só: veredito(s), lista curta dos achados abertos (ID, severidade, uma linha) e o caminho
  do parecer.
