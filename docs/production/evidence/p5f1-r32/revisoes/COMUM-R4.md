# P5-F.1-R3.2 — instruções comuns da rodada 4 (revisão focada)

Você é um revisor independente da etapa P5-F.1-R3.2 do projeto minhas-financas. Trabalhe em português brasileiro.
Revise a implementação real; não aprove por descrição. Esta é a rodada 4, **focada na mudança feita depois da
rodada 3**: a rodada 3 revisou a árvore `ef514869087c2b9e8e910a25fc7c18174418b8bb`, e o executor mudou código por causa
de achados dela.

Caminhos (use-os por extenso): `S=<scratchpad>`,
`W=$S/wt-p5f1-r32`, `R=$S/p5f1r32`.

## O que revisar

- **Árvore sob revisão (código final da R3.2): `698f96441df1fbcd63467792c43cdb57b3911d9e`.** O diretório `$W` a contém
  (o índice real do git é o HEAD 1730a1df e NÃO deve ser alterado). Depois dela, só `docs/` pode mudar.
- A mudança: `git -C $W diff --no-renames ef514869087c2b9e8e910a25fc7c18174418b8bb 698f96441df1fbcd63467792c43cdb57b3911d9e`
  (9 arquivos; um deles, `docs/production/DATA_MODEL.md`, só texto).
- Os pareceres da rodada 3 de todas as áreas: `$R/revisoes/<área>/rodada-3/PARECER.md` (a financeira pode ainda estar
  em curso). As respostas do executor: `$R/evidencia-rascunho/revisoes-LEIAME.md`, seção "Rodada 3".
- Histórico: `$R/historico-execucoes.md`, execuções 55 a 62.

## O que mudou (para conferir, não para aceitar)

- **ADV-R3-01 (adversarial):** os motivos de rotina ambígua (`ambiguous_routines`, `ambiguous_reduced_eve`) apareciam
  sem prova, mas dependem dos meses com renda (o corte dos meses sem renda vem antes da conferência da ambiguidade em
  `estimate.ts`). Agora `holdEstimate` (`src/modules/work-time/useIncomeEstimateWith.ts`) segura todo estado `done` que
  `dependsOnIncomeReadings`: tudo fora da lista fechada `DECIDED_BEFORE_INCOME` (`business_not_confirmed`,
  `report_unavailable`, `exclusion_unconfirmed`). Um motivo novo espera a prova (fail-closed). A guarda confere que os
  motivos devolvidos antes de `applyIncomeExclusions` em `computeWorkTimeEstimate` são exatamente esses três. Isso
  substitui a regra estrutural da rodada 3 (`carriesBasisFigures`: `ready` ou `months` não vazio).
- Testes: a tabela-verdade (`tests/unit/work-time-income-estimate.test.ts`), a guarda (`work-time-guard.test.ts`), a
  véspera reduzida ambígua no laço da indisponível que depende das receitas e três testes das sondas R3-P1 a R3-P3 da
  adversarial (`work-time-consistency.test.ts`).
- **EST-R3-01 (estabilidade):** o executor (`tools/e2e/executar-em-grupos.mjs`) guarda o `firebase-debug.log` de cada
  grupo por um link físico feito enquanto o grupo roda (o firebase-tools apaga o arquivo ao sair limpo).
- **ADV-R3-03 e EST-R3-02:** testes novos do executor (`tests/tools/e2e-grupos.test.mjs`): o segundo sinal repassado, o
  grupo morto por sinal como falha, o relatório de uma execução anterior que não conta, o sinal antes do primeiro grupo,
  e o log apagado na saída limpa.
- Comentários: `consistency.ts`, `e2e/work-time-p5f.spec.ts` e o cabeçalho do bloco do estado indisponível.

## Evidências (somente leitura), em `$R/logs/`

- `dev-r33-work-time-1.log`, `r33-vermelho-*.log` (os testes novos sobre o código de ef514869), `r33-mutantes-cliente-novos.log`,
  `r33-mutantes-grupos-novos.log`, `typecheck-r33-1.log`, `unit-work-time-5.log`, `tools-e2e-5.log`, `e2e-p5f-r33-1.log` e `.meta`.
- **Execução oficial em andamento:** `verify-all-r32-5.log` e `.log.meta` (árvore `698f9644`).

## Regras obrigatórias

- NÃO altere nada em `$W` (nem arquivos, nem o índice do git; nem `git write-tree`). Para executar, faça uma cópia
  própria: `mkdir -p <sua pasta>/rodada-4/copia && git -C $W archive 698f96441df1fbcd63467792c43cdb57b3911d9e | tar -x -C <sua pasta>/rodada-4/copia --exclude=docs`
  e `ln -s $W/node_modules <sua pasta>/rodada-4/copia/node_modules` (idem `functions/node_modules`).
- **A execução oficial está rodando:** NÃO rode Emulator, Playwright, E2E, `npm run verify:*`, `npm run test:integration*`
  nem nada que abra as portas 4000, 4400, 4500, 5001, 8080, 9099, 9150, 9299, 9499 ou 5173. O que rodar, com
  `nice -n 19` na frente, um de cada vez, na sua cópia.
- Nunca acesse o projeto Firebase de produção (`sistema-financeiro-pesso-20698`), nem leia segredos. Nada de commit,
  push ou deploy.
- Não suavize: achado sem evidência não é achado; evidência ausente para um item obrigatório é falha.

## Saída

- Parecer em `<sua pasta>/rodada-4/PARECER.md`. Primeira linha: o veredito no formato do seu pedido. Depois: escopo,
  comandos e resultados, a situação de cada achado seu da rodada 3 (fechado, aberto, rebaixado), achados novos (ID com o
  prefixo da sua área e `R4`; severidade; arquivo:linha; cenário; impacto; correção sugerida) e o que não foi possível
  verificar.
- Na mensagem final, devolva só: veredito(s), lista curta dos achados abertos e o caminho do parecer.
