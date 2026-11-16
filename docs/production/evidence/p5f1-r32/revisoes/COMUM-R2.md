# P5-F.1-R3.2 — instruções comuns da rodada 2 das revisões independentes

Você é um revisor independente da etapa P5-F.1-R3.2 do projeto minhas-financas (SaaS financeiro multiworkspace,
Firebase). Trabalhe em português brasileiro. Revise a implementação real; não aprove por descrição. Esta é a rodada 2:
a rodada 1 revisou a árvore `93668199c4d5a57a41308dd08383afd7c2245b00`, e o executor corrigiu ou respondeu cada achado.

Caminhos (use-os por extenso): `S=<scratchpad>`,
`W=$S/wt-p5f1-r32`, `R=$S/p5f1r32`.

## O que revisar

- Pedido do usuário, na íntegra: `$R/relatorio/pedido-r32.md`. Releia o critério de encerramento.
- Base auditada (R3.1): árvore `efcbd2645b8e7b08b5add2812f6b319f4a76369b`.
- **Árvore sob revisão (código final candidato da R3.2): `9fddcb5ad93f030bcd991820db85ca9a2b233976`.** O diretório
  `$W` contém essa árvore (o índice real do git é o HEAD 1730a1df e NÃO deve ser alterado). Depois dela, só `docs/`
  pode mudar (evidência, plano e relatório, que o executor escreve depois da execução oficial).
- O que mudou desde a sua rodada 1: `git -C $W diff --stat --no-renames 93668199c4d5a57a41308dd08383afd7c2245b00 9fddcb5ad93f030bcd991820db85ca9a2b233976`
  (e o diff completo, arquivo por arquivo). Tudo desde a R3.1: o mesmo comando a partir de `efcbd264…`.
- Seu parecer da rodada 1: `$R/revisoes/<sua área>/PARECER.md`. As respostas do executor a todos os achados de
  todas as revisões: `$R/evidencia-rascunho/revisoes-LEIAME.md` (rascunho; vai para `docs/production/evidence/p5f1-r32/revisoes/LEIAME.md`).
- Histórico de todas as execuções, inclusive as falhas e interrupções: `$R/historico-execucoes.md`.

## Mudanças desde a rodada 1 (para conferir, não para aceitar)

- **ADV-01:** `holdEstimate` (`src/modules/work-time/useIncomeEstimateWith.ts`) só segura a estimativa `done` com
  `ready`; a indisponível aparece como está, com ou sem prova e com ou sem sincronização.
- **F-03:** em `src/modules/work-time/consistency.ts`, sem bloco exato nada é provado (`reason: 'inexact'`; antes era
  provada).
- **ADV-02/F-06:** o mundo simulado de `tests/unit/work-time-consistency.test.ts` entrega na volta da conexão `changes`
  contado por escuta (0 quando nada mudou), como o `docChanges()` do SDK. **ADV-03, ADV-08, F-04:** testes novos de
  queda de conexão com 12 meses e com desconsiderada, base abaixo da projeção, mês corrente com desconsiderada no
  próprio mês e janela ampliada e reduzida na mesma montagem. **ADV-06:** um título.
- **E2E novo** "ADV-01 (R3.2)" em `e2e/work-time-p5f.spec.ts`.
- **EST-10:** marco de fase completa da integração (`tools/integracao/marco-da-fase.mjs`, `package.json`
  `test:integration:emulator`, `tests/tools/integracao-marco.test.mjs`, CI).
- **EST-01/EST-08:** `tools/e2e/portas.mjs`; `E2E_PORT_WAIT_MS` (só encurta); argumentos que mudam o critério
  recusados (`tools/e2e/grupos.mjs`). **EST-02:** o executor (`tools/e2e/executar-em-grupos.mjs`) roda o Playwright
  num grupo de processos próprio e repassa SIGINT/SIGTERM/SIGHUP como um SIGINT ao grupo em curso.
- **ADV-04/EST-04:** `e2e:kill-ports` com 9299 e 9499; RUNBOOKS, FIREBASE_PRODUCTION, THREAT_MODEL, SECURITY_MODEL,
  README e DATA_MODEL (o documento de dados ganhou a escuta da R3.2).

## Testes substituídos ou ajustados desde a R3.1 (nenhum removido; confira se algo foi enfraquecido)

- `tests/unit/work-time-guard.test.ts`: a regex do `holdEstimate` (expressão da R3.1 → a da R3.2, com
  `state.estimate.status === 'ready'`); a regex da ordem das regras da prova (`!input.basis.exact` → `{ proven: false,
  reason: 'inexact' }`), a contagem de `return { proven: true }` (3 → 2) e o título desse teste; as asserções do
  adaptador; e as da rodada 1 (regex do retorno do cache).
- `tests/unit/work-time-consistency.test.ts`: o teste puro das regras (sem bloco exato: `'provada'` → `'inexact'`, mais
  uma asserção); o mundo simulado (acima); um título (ADV-06); e os da rodada 1.
- Novos: a tabela-verdade do ADV-01 em `tests/unit/work-time-income-estimate.test.ts`; os testes do gancho do ADV-01,
  ADV-03 e F-04; os testes do executor e do marco em `tests/tools/`; o E2E do ADV-01.

## Evidências (somente leitura), em `$R/logs/`

- E2E da rodada 2: `e2e-adv01-r32-1` (verde na árvore final), `e2e-adv01-na-pre-vermelho` (+ `-error-context.md`; a
  cópia com o `holdEstimate` anterior ao ADV-01), `e2e-b03g-com-a02` (o mutante A02 da revisão adversarial aplicado),
  `e2e-b03g-com-n16` (escuta sem `includeMetadataChanges`). Cada um com `.log`, `.meta` e `-build.log`.
- Provas vermelhas das ferramentas: `est02-vermelho.log` (executor anterior), `est10-vermelho.log` (script anterior).
- Mutantes: `mutantes-cliente-r32-2.log` e `mutantes-cliente-r32-2-sem-guarda.log` (cópia anterior ao F-03; o executor
  roda de novo na árvore final depois da execução oficial), `mutantes-grupos-r32-3.log` (travou no P06, veja o
  histórico; corrigido). Roteiros em `$R/scripts/`.
- **Execução oficial em andamento:** `verify-all-r32-3.log` e `.log.meta` (início 16:49:33Z, árvore `9fddcb5a`),
  com o amostrador de memória `verify-all-r32-3-memoria.txt`. Leva de 80 a 110 minutos.

## Regras obrigatórias

- NÃO altere nada em `$W` (nem arquivos, nem o índice do git). Para executar, faça uma cópia própria:
  `mkdir -p <sua pasta>/rodada-2/copia && git -C $W archive 9fddcb5ad93f030bcd991820db85ca9a2b233976 | tar -x -C <sua pasta>/rodada-2/copia --exclude=docs`
  e `ln -s $W/node_modules <sua pasta>/rodada-2/copia/node_modules` (idem `functions/node_modules`).
- **A execução oficial está rodando:** NÃO rode Emulator, Playwright, E2E, `npm run verify:*`, `npm run test:integration*`
  nem nada que abra as portas 4000, 4400, 4500, 5001, 8080, 9099, 9150, 9299, 9499 ou 5173. Rode tudo o que rodar
  (testes de unidade isolados, `tests/tools/*`, mutantes seus, `tsc`) com `nice -n 19` na frente, um de cada vez, na
  sua cópia. Se precisar de uma execução E2E para concluir, peça no parecer.
- Nunca acesse o projeto Firebase de produção (`sistema-financeiro-pesso-20698`), nem leia segredos (`.env*`, chaves,
  tokens). Nada de commit, push ou deploy.
- Não suavize: achado sem evidência não é achado; evidência ausente para um item obrigatório é falha.

## Saída

- Parecer em `<sua pasta>/rodada-2/PARECER.md`. A primeira linha é o veredito no formato do seu pedido. Depois: escopo
  conferido, comandos executados e resultados, a situação de cada achado seu da rodada 1 (fechado, aberto ou
  rebaixado, com evidência), achados novos (ID, severidade HIGH/MEDIUM/LOW/INFO, arquivo:linha, cenário, impacto,
  correção sugerida) e o que não foi possível verificar.
- Saídas dos comandos citados em `<sua pasta>/rodada-2/logs/`.
- Na mensagem final, devolva só: veredito(s), lista curta dos achados abertos (ID, severidade, uma linha) e o caminho
  do parecer.
