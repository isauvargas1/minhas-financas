PASS — Financial domain integrity

# Parecer de integridade do domínio financeiro — P5-F.1-R3, rodada 2

Conferência, só de leitura, das respostas aos achados F-01 a F-12 da rodada 1 (`PARECER.md`, nesta pasta), na árvore de código congelada `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`. Não subi o Emulator, não compilei nada no WT, não usei Firebase real e não fiz commit nem push.

**Veredito: PASS.** O `verify:all` final terminou às 20:22:55 UTC na árvore congelada, com `exit=0`. Foram 3.250 testes (1.746 no `verify:fast`, 1.289 de integração e Rules, 215 E2E), com 0 falha, 0 `flaky`, 0 skip e 0 todo, na 1ª execução. O código do WT não mudou depois. Com isso F-01 está resolvido. F-02 e F-12 estão resolvidos. F-03, F-04, F-05 e F-07 a F-11 estão aceitos como risco residual registrado. F-06 (LOW, documental) fica pendente para o fechamento. Não há achado novo de integridade financeira.

Histórico desta rodada: às 20:15, com o `verify:all` ainda nos E2E, o parecer estava provisoriamente em FAIL, só por F-01. A seção "Condições para PASS" registra o que foi conferido no fim.

## Base conferida

- **Árvore:** a árvore atual do WT (`1f78fc6e3e209f30f0760d7902e5aa8c2ba0b519`, 20:12) difere de `377c2f3f` só em `docs/`. Em `functions/`, `src/`, `tests/`, `e2e/`, `firestore.rules`, `firestore.indexes.json` e `package.json`, o diff é vazio. Os 11 arquivos financeiros principais têm SHA-256 iguais no WT e em `377c2f3f`.
- **Código mudado desde a rodada 1** (diff `9961d45b` → `377c2f3f`):
  - `firestore.indexes.json`: 6 isenções de índice de campo único para `cash_projection_marks`;
  - testes novos: unidade da isenção; integração 15 (poda) e 16 (corrida F-02);
  - `functions/src/cash/periods.ts`: só o comentário de custo. A poda e a ordem do import já tinham sido revistas por mim às 19:21–19:25; `projectionMarks.ts` tem o mesmo SHA-256 (`1b7f6f48…`) da versão das minhas sondas;
  - `src/modules/reports/basisRegistry.ts`: removida `observeDependentRead` (busca em `src`, `tests` e `e2e`: zero referências).

  Nenhuma dessas mudanças mexe em valor, delta, classificação, marca ou prova.
- **`verify:all`** (`logs/verify-all-final.log`; `.meta`: `arvore=377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`, início 19:42:32Z, `fim=2026-11-09T20:22:55Z exit=0 duracao_s=2423`, `limpeza=0`; `verify-all-final.resumo.json`):
  - Node: 1.746/1.746 no `verify:fast` e 1.289/1.289 na integração, total 3.035, sem `fail`, `cancelled`, `skipped` nem `todo` (somei as linhas `# tests`/`# pass` do log);
  - unidade das Functions: 677/677;
  - unidade do cliente: verde (por exemplo, 213/213 e 107/107);
  - integração das Functions no Emulator: 985/985, com as 16 das marcas (`ok 362` A01, `ok 368` poda, `ok 369` corrida F-02, `[F-02] tentativas da transação do gatilho: 1`). O primeiro teste de cada uma das 7 suítes do mesmo gatilho aparece como `ok` no log (`rebuildFence`, `periods`, `projectionRecovery`, `categoryLink`, `d29Lifecycle`, `mutateTransaction`, `financialReportAccess`);
  - Rules: todas as suítes, `test:rules:projection-marks` com 17/17;
  - lint: 0 erro (201 avisos, os mesmos da R2A);
  - E2E: 215 aprovados em 18,5 min, 1 worker, `retries: 0` (sem `CI`), sem nenhum `✘`, `flaky` ou pulado:
    - `work-time-b03`: os 5 até o fim (189 a 193), inclusive o B03-b (190) com "nenhum valor convertido sem prova";
    - `work-time-p5f`: os 19 (194 a 212), inclusive o B01 com estorno real por callable (209);
  - nenhum `not ok` no log.
- **Código depois do `verify:all`:** as árvores do WT às 20:23 (`3eb6041dea2e791cae0c4eaa2c1ab4bad972cba1`) e às 20:24 (`a5e82cb21a026375b58136c0918bce893a6929a8`) diferem de `377c2f3f` só em `docs/`.

## Estado dos achados

| ID | Rodada 1 | Resposta | Conferência | Estado |
| --- | --- | --- | --- | --- |
| F-01 | MEDIUM | Evidência na árvore final pelo `verify:all`; poda e corrida antes, na cópia | Detalhe abaixo da tabela | **Resolvido** |
| F-02 | LOW | Teste de integração 16 | Detalhe abaixo da tabela | **Resolvido** |
| F-03 | LOW | Condição RR-R3-06 | A condição está no desenho, §9 ("Leitura") e §10, e no rascunho da §20.18. É mais forte que a minha alternativa: versão da regra na etiqueta, igualdade no cliente e reconstrução antes de publicar o cliente novo. A R3 não muda `cashPeriodDeltaFor` nem `classifyIncomeDocument` (conferido no diff) | **Aceito** (risco residual registrado) |
| F-04 | LOW | Argumento e RR-R3-07 | Concordo com o argumento. Com a INV-M no instante da transação, o efeito tirado é a parte de T, seja qual for o instante da leitura por id. Um lançamento criado e aplicado depois da leitura tem nó vivo sem conteúdo lido e recusa (`projectionProof.ts:334-335`). A ordem só pesa se a INV-M falhar no backend. A defesa em profundidade fica registrada | **Aceito** (risco residual registrado) |
| F-05 | LOW | RR-R3-01, P7 | Registrado no rascunho da §20.18, com o custo do estado pendente no §9. A tela fica em reais, sem valor errado | **Aceito** (risco residual registrado) |
| F-06 | LOW | "A §20.18 existe; os marcadores estão preenchidos" | Detalhe abaixo da tabela | **Parcial**: os marcadores de `testes-e-resultados.md` estão preenchidos; a §20.18 ainda vai ao plano no fechamento |
| F-07 | INFO | Registrado | Caso-limite ABA na `matriz-requisitos.md` (linha do B03-02), com a INV-M | **Aceito** |
| F-08 | INFO | Classificado | Desenho da R1, mantido | **Aceito** |
| F-09 | INFO | Classificado | Conservador; regra 3 da R1 | **Aceito** |
| F-10 | INFO | Classificado (A07) | Desenho §3 e RR-R3-02 | **Aceito** |
| F-11 | INFO | Classificado | Os mutantes B01 (gatilho sem marca) e B04 (meses sem etiqueta) mostram que um uso sem marca ou sem etiqueta é detectado | **Aceito** |
| F-12 | INFO | Histórico registrado | `testes-e-resultados.md` §3 lista as 7 falhas intermediárias (`int-cash-1`, `rules-marcas`, `t2`, `t3`, `r3-b03-teclado`, `int-copia-marcas-f02`, `functions-unit-copia-1`), com causa e execução seguinte. Conferi as três de E2E e a `f02` nos logs | **Resolvido** |

**F-01, conferência.**
- **Poda:** tem unidade (12/12, `unit-projectionMarks-poda.log`) e integração 15 (`int-copia-marcas-poda.log`, 15/15; no `verify:all`, `ok 368`). Os mutantes B13 a B16 morreram (`mutantes-backend-poda.log`, base 15/15).
- **Integração no `verify:all`:** as 7 suítes do gatilho e as 16 das marcas rodaram na árvore final (985/985).
- **`verify:all` completo na árvore final:** `exit=0` e os 215 E2E aprovados, entre eles os 5 de `work-time-b03` e os 19 de `work-time-p5f` (veja "Base conferida").

**F-02, conferência.** O teste 16 roda o mesmo corpo do gatilho (`applyCashPeriodWriteOnce` num `runTransaction`) com pausa antes do commit, depois de ler a marca sem âncora. A página faz o commit da âncora no meio. Resultado:
- a âncora sobrevive;
- a cadeia confere;
- o mês fica em 2.000;
- o gatilho fez o commit na 1ª tentativa, ou seja, a página esperou.

Passou na cópia (`int-copia-marcas-f02b.log`, 16/16) e no `verify:all` (`ok 369`). A primeira execução (`f02`, 15/16) falhou por erro do próprio teste: ele chamava a reconstrução de novo depois de publicada. Está registrada no §3. O desenho, §6, descreve a garantia.

**F-06, conferência.** Situação às 20:24, depois do `verify:all`:
- **`testes-e-resultados.md`:** preenchido. O §4 traz 3.250/3.250 na árvore `377c2f3f`, 1ª execução, e o §5, a comparação com a R2A: +97, só testes novos, nenhum script perdeu teste. Os números batem com o log e o resumo;
- **plano mestre:** `docs/production/PRODUCTION_READINESS_PLAN.md` ainda é o das 16:26, sem a §20.18;
- **rascunho da §20.18** (`p5f1r3/evidencia/plano-20-18.md`): o conteúdo é adequado (arquitetura, condições de implantação e restauração, RR-R3-01 a 09, rollback), mas ainda tem `[[TESTES]]`, `[[REVISOES]]` e `[[VEREDITO]]`.

O achado é LOW e não bloqueia este gate, desde que o fechamento aplique a seção ao plano.

## Achados novos

Nenhum de integridade financeira.
- **Isenção dos 6 campos de índice:** coerente com o acesso só por id do gatilho, da varredura e do cliente, e com `list: false` nas Rules. Não afeta valor nem prova.
- **Remoção de `observeDependentRead`:** a função não tinha chamador. Não afeta a prova.
- **Teste 15:** cobre o caso que eu pedi (entrega anterior ao corte durante a preparação, com a âncora da preparada preservada) e a remoção da posição superada depois de uma e de duas reconstruções. A visão conferida é a do backend. A paridade com a visão do cliente já está provada pela fixture e pela sonda F2 (0 casos menos conservadores em 300 mil).

## Condições para PASS

As três condições registradas às 20:15 foram conferidas às 20:23:
1. o `.meta` tem `arvore=377c2f3ff3cd1729a819e5be8d89dc06dea7cf93` e `exit=0`: **atendida**;
2. os 215 E2E passaram sem `✘` nem `flaky`, com os 5 de `work-time-b03` até o fim e os 19 de `work-time-p5f`, inclusive o estorno real: **atendida**;
3. o código não mudou depois de `377c2f3f`; só `docs/` difere: **atendida**.

**Veredito: PASS — Financial domain integrity.**

**Riscos residuais e condições que seguem:**
- F-03 (RR-R3-06): qualquer mudança futura de `cashPeriodDeltaFor` ou `classifyIncomeDocument` exige, na mesma mudança, a versão da regra na etiqueta da geração, a igualdade no cliente e a reconstrução antes de publicar o cliente;
- F-04 (RR-R3-07): defesa em profundidade ausente para uma falha desconhecida da INV-M;
- F-05 (RR-R3-01): estado sem recuperação automática e sem sinal, em reais;
- F-07 a F-11, registrados;
- **F-06 (LOW), condição de fechamento:** aplicar a §20.18 ao plano mestre, preenchendo `[[TESTES]]`, `[[REVISOES]]` e `[[VEREDITO]]` com estes resultados. A resposta que diz que a seção "existe" deve ser corrigida, ou a seção, aplicada antes da entrega.
