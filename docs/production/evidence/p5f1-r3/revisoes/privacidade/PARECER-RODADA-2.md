PASS — Privacy/LGPD data lifecycle

Escopo do veredito: o mesmo da rodada 1 (`PARECER.md`) — a superfície da P5-F.1-R3 (marcas de aplicação da projeção, B03) e o que o plano atribui à P5 ou antes e que o diff exercita; não é o checklist integral, que só vale em release e na P10. Rodada 2: conferência, somente leitura, das respostas a M-PRI-01, L-PRI-02 e INFO-01 a INFO-04, mais os achados novos. Isto não é parecer jurídico: a qualificação jurídica fica com o E-09.

Nenhum achado em aberto bloqueia o escopo. Os dois achados novos são INFO. Os três E2E de que este parecer dependia passaram no `verify:all` da árvore congelada, que terminou com `exit=0` (seção "Dependência do `verify:all`").

`S=<scratchpad>`. As escritas desta rodada ficaram em `$S/p5f1r3/revisoes/privacidade/`: a cópia própria `r2-copia/`, apagada depois do uso, a sonda e os logs. Não houve Emulator, recompilação de `WT/functions/lib`, Firebase real nem leitura de `.env*`.

---

## Escopo

**Árvores**
- Código: `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`, congelado. É a árvore do `verify:all` final, concluído com `exit=0` (`$S/p5f1r3/logs/verify-all-final.log.meta`).
- Documentos: lidos no worktree na árvore `1f78fc6e3e209f30f0760d7902e5aa8c2ba0b519`, calculada com índice temporário próprio. Fora de `docs/`, ela é idêntica a `377c2f3f` (diff vazio).
- Reconferidos no fechamento desta rodada, na árvore `3eb6041dea2e791cae0c4eaa2c1ab4bad972cba1`. Desde `1f78fc6e` houve só duas precisões, as duas corretas:
  - `DATA_MODEL.md:140` passa a citar as duas suítes de Rules;
  - a linha 26 do `PRIVACY_LGPD.md` diz "membro ativo com conta ativa", que é o que as Rules exigem (`firestore.rules:42-46`).
- Uma mudança posterior em `PRIVACY_LGPD.md`, `DATA_RETENTION_LIFECYCLE.md`, `DATA_MODEL.md` ou `DESENHO-MARCAS-B03.md` exige nova conferência.

**Código alterado desde a rodada 1** (`905ed3d6` → `377c2f3f`)
- `pruneMarkDoc` (`functions/src/cash/projectionMarks.ts:496-518`) e o uso no gatilho (`functions/src/cash/periods.ts:1401-1406`).
- Isenção de índice de campo único para os 6 campos da marca (`firestore.indexes.json`).
- Remoção de `observeDependentRead` e do estado em memória dele (`src/modules/reports/basisRegistry.ts`).
- Texto de `ESTIMATE_UPDATING`.
- Testes.

**Sem mudança desde a rodada 1**
- `firestore.rules`.
- Leitura e prova no cliente: `projectionReads.ts`, `projectionProof.ts`, `transactions/api.ts`, `receivableReversal.ts`.
- `reports/queryKeys.ts`.
- `AuthContext.tsx`, `sessionCleanup.ts` e `firebase.ts`. Os três últimos e os E2E `work-time-p5f` e `workspace-membership` estão sem mudança em toda a R3.

**Documentos conferidos**
- `PRIVACY_LGPD.md`: §3, linha 26 nova; §6.4, com o requisito da P8; §9.
- `DATA_RETENTION_LIFECYCLE.md:104` e `DATA_MODEL.md:140`.
- `DESENHO-MARCAS-B03.md`: §3 (privacidade da impressão) e §4 (poda e índices).
- `evidence/p5f1-r3/revisoes/respostas-revisao-financeiro-escala-privacidade-1.md`.
- Rascunho da §20.18: `$S/p5f1r3/evidencia/plano-20-18.md`. Fica fora do worktree e vai ao plano no fechamento.

---

## Estado dos achados da rodada 1

| ID | Sev. | Estado | Evidência |
| --- | --- | --- | --- |
| M-PRI-01 | MEDIUM | **Resolvido** | Os cinco itens da remediação foram feitos. <br>• **Inventário:** linha 26 no `PRIVACY_LGPD.md` §3. Cobre dado pseudonimizado derivado das linhas 12 e 13, titulares, origem, finalidade, base E-09, compartilhamento, retenção com poda e resíduo, e o risco aceito. <br>• **Eliminação:** §6.4 com a coleção, o requisito da P8 e o `requestHash`. <br>• **Navegador:** §9 com marcas, impressões e meses no cache em memória do React Query, limpos no logout e na troca de conta. Confere com `AuthContext.tsx:75,111`. <br>• **Retenção:** `DATA_RETENTION_LIFECYCLE.md:104` sem "sem dado pessoal". <br>• **Desenho:** §3 com a análise, os números das sondas da rodada 1 (função de impressão sem mudança desde então), a decisão pelo documento inteiro, o motivo de não usar sal (todo membro leria o sal) e o risco residual aceito. <br>**O ajuste à minha remediação está certo, e retiro a alternativa "duas reconstruções".** A varredura só regrava a âncora, com merge e sem ler a marca. A cadeia de uma geração superada só sai numa regravação pelo gatilho. A sonda `sonda-r2-poda-e-p8` mostra isso no cenário 2: depois de R2 e R3 publicadas, fp(V1) continua em `chains.b.base` e só sai na regravação seguinte. Um detalhe de ordem no requisito ficou como achado novo N-PRI-01 (INFO). |
| L-PRI-02 | LOW | **Resolvido**, pela primeira opção | **Poda.** `pruneMarkDoc` guarda só as componentes de `state.categoryGeneration` e `state.categoryStaging?.generation`, na mesma escrita sem merge (`periods.ts:1401-1406`). A geração preparada fica mesmo antes do corte. Isso é seguro porque `categoryStaging.generation = rebuildId` é gravado no mesmo commit do checkpoint (`rebuild.ts`, `writeNewCheckpoint`/`stagingPatch`), antes de qualquer âncora `g: rebuildId`. A transação do gatilho lê o estado e a marca, então uma mudança concorrente faz o gatilho reler. <br>**Provas.** <br>• Na minha cópia: 31/31, inclusive "poda (L-PRI-02)", "índices" e a propriedade INV-M (4.000 cenários, 79.796 conferências, 954 podas, 0 violações). <br>• Na minha sonda, cenário 1: a g0 sai na regravação seguinte à publicação. <br>• No `verify:all`: integração `ok 368` (poda) e `ok 369` (corrida F-02). <br>• Herdados: mutantes B13–B16 mortos, inclusive B14 ("poda apaga a geração preparada", 5 falhas). <br>**Resíduo documentado e aceito.** A posição superada fica até a próxima regravação, e num lançamento apagado (só desenvolvimento) até a eliminação do workspace (linha 26; `DATA_RETENTION_LIFECYCLE.md:104`; `DESENHO` §4; RR-R3-08). Aceito porque a varredura não pode podar a cadeia sem ler a marca: apagar às cegas a cadeia da posição preparada destruiria a cadeia que o gatilho já começou ali. Além disso, o pedido do titular tem o procedimento da P8, e o dado é pseudonimizado e lido pelo mesmo público que lia a versão na época. |
| INFO-01 | INFO | **Registrado** | `PRIVACY_LGPD.md` §6.4 (o mesmo requisito vale para `cashEntry.requestHash`); rascunho da §20.18 (requisito da P8 com a sugestão de HMAC; RR-R3-08) |
| INFO-02 | INFO | **Classificado e registrado** | Rascunho da §20.18, RR-R3-08, na mesma decisão da P6/P8 sobre o cache em memória. Há uma imprecisão na descrição do resíduo: achado novo N-PRI-02 |
| INFO-03 | INFO | **Pendente do fechamento**; não depende do `verify:all` | O plano no worktree ainda não tem a §20.18 (busca por `20.18` em `PRODUCTION_READINESS_PLAN.md`: 0). O rascunho já traz o conteúdo de privacidade da R3: poda, impressão como dado pseudonimizado, requisito da P8, `requestHash` e RR-R3-08. A resposta F-06/INFO-03 ("A §20.18 existe") só fica verdadeira depois da aplicação do rascunho, que precisa acontecer antes de as respostas serem entregues |
| INFO-04 | INFO | Sem ação | Necessidade confirmada na rodada 1 |

---

## Achados novos (rodada 2)

**HIGH 0 · MEDIUM 0 · LOW 0 · INFO 2.** Nenhum é bloqueante.

- **N-PRI-01 — INFO — Falta uma condição de ordem no requisito da P8 (`PRIVACY_LGPD.md` §6.4).**
  - O requisito "apagar as marcas dos lançamentos afetados e reconstruir" está certo. Mas, se a marca for apagada **antes** de o gatilho aplicar a entrega da correção ou anonimização, ou com uma entrega anterior ainda pendente ou em voo, a entrega seguinte regrava a impressão antiga.
  - Isso acontece porque, sem marca, a geração publicada vê o lançamento como "ausente", e o evento com `antes = V1` vira pendência `{b: fp(V1), a: fp(V2)}`.
  - Essa pendência sobrevive à reconstrução, na posição superada, até uma regravação.
  - Prova: `sonda-r2-poda-e-p8.log`, cenários 4a e 4b (fp(V1) em `chains.b.pending.0.b.fp` antes e depois de R2). O cenário 3, na ordem certa, termina sem fp(V1).
  - Recomendação de texto para o §6.4 (e para a linha correspondente da §20.18): "apagar a marca só depois que o gatilho aplicou todas as entregas do lançamento até a correção (marca de entrega `applied` e cadeia sem pendência), e reconstruir em seguida".
  - Risco residual até a P8: nenhum. Não existe fluxo de correção a pedido nem de anonimização hoje.
- **N-PRI-02 — INFO — A descrição do resíduo de `reportFetchStarts` subestima o que ele guarda.**
  - A resposta diz "só guarda em memória ordens por hash de chave, sem conteúdo financeiro". O rascunho diz que ele "fica em memória até recarregar a página".
  - O "hash" do React Query é `JSON.stringify` da chave (`node_modules/@tanstack/query-core/build/modern/utils.js:79-87`; conferido: `hashKey([...])` devolve a chave em claro). A chave do relatório contém uid, workspace e papel (`src/modules/reports/queryKeys.ts:12-18`).
  - Portanto o mapa (`queryKeys.ts:93-104`) guarda, depois do logout, os identificadores da conta anterior em claro, sem conteúdo financeiro.
  - A classificação INFO e a decisão da P6/P8 continuam valendo. Recomendação: escrever "chaves do relatório com uid, workspace e papel da conta anterior, em claro" no RR-R3-08.

---

## Inventário (o que mudou desde a rodada 1)

- **Linhas A e B da rodada 1** (impressões e metadados da marca) agora estão no inventário canônico (`PRIVACY_LGPD.md` §3, linha 26), classificadas como dado pseudonimizado derivado, com base legal E-09.
- **Retenção das linhas A e B:** acompanha o lançamento. A poda tira as gerações superadas e abandonadas na regravação seguinte. Ficam:
  - âncora, base e pendências da geração vigente, necessárias à prova, até a reconstrução e a regravação seguintes;
  - a posição superada até a próxima regravação;
  - num lançamento apagado (só desenvolvimento), essa posição até a eliminação do workspace.
- **Índices:** nenhum campo da marca tem mais entrada de índice de campo único. É menos dado derivado guardado, e nada consulta a coleção (Rules: `list: if false`).
- **Cliente:** sem mudança. O estado em memória de `observeDependentRead` saiu, o que também elimina uma cópia em memória. As linhas C a G da rodada 1 continuam valendo como estão.

## Direitos do titular

Sem fluxo novo: confirmação, acesso, portabilidade, eliminação e canal ficam na P8 (PR-AUTH-01, PR-PRIV-01). A diferença desta rodada é que **correção e anonimização** a pedido do titular num workspace mantido agora têm o procedimento registrado: apagar a marca e reconstruir (`PRIVACY_LGPD.md` §6.4), com o detalhe de ordem de N-PRI-01. A sonda (cenário 3) mostra que, na ordem certa, nenhuma impressão da versão anterior sobra. Prazo e teste ficam na P8.

## Matriz de evidência

| Seção do checklist | Resultado | Evidência |
| --- | --- | --- |
| 1. Inventário e registro | PASS | Linha 26 do §3; `DATA_RETENTION_LIFECYCLE.md:104` e `DATA_MODEL.md:140` coerentes com o código |
| 2. Finalidade, necessidade e minimização | PASS | Poda implementada e testada (L-PRI-02); resíduo documentado com justificativa; isenção de índices; logs só com ids e códigos fixos (nenhum log novo fora de teste no diff da rodada) |
| 3. Bases legais, transparência e aceite | PASS (registro) | Finalidade e base E-09 registradas na linha 26. Validação jurídica fora do escopo (E-09, P8) |
| 4. Direitos do titular | — | Fora do escopo (PR-AUTH-01, PR-PRIV-01, PR-CR-05, P8). Impacto registrado no §6.4 |
| 5. Eliminação, exclusão e anonimização | PASS (parte do escopo) | §6.4 com a coleção, o requisito da P8 (correto, com o detalhe de N-PRI-01) e o `requestHash`; restauração recria as marcas por reconstrução (`BACKUP_RESTORE_DR.md:52,117`) |
| 6. Retenção | PASS | Linha da tabela coerente: sem `expiresAt`, poda e resíduo descritos |
| 7. Subprocessadores e transferência | PASS | Nenhum terceiro novo |
| 8. Cookies, armazenamento local e trackers | PASS | Código do cliente sem mudança desde a rodada 1; guardas `work-time` 213/213 no `verify:all` (testes 133, 138 e 139). E2E aprovados no `verify:all`: `work-time-p5f` 374 ("outra conta no mesmo navegador não vê configuração, estimativa nem valores convertidos"), 560 ("a IA não recebe a configuração e o modo tempo não grava nada fora do documento privado") e 999 (mensagem fixa, nada do SDK) |
| 9. Segurança como obrigação de privacidade | PASS | `test:rules:projection-marks` 17/17 no `verify:all` da árvore congelada (suíte base e de ataques: isolamento A↔B, não membros, consulta de grupo, oráculo de existência por `verify`, tetos, revogação no meio da transação) |
| 10. Incidentes | — | Fora do escopo (PR-OBS-02, P7); nada novo no diff |
| 11. Testes obrigatórios | PASS (itens do escopo) | Isolamento por Rules (17/17). Logout sem resíduo (teste 8 do §14): `e2e/workspace-membership.spec.ts:54` aprovado no `verify:all` da árvore congelada |
| 12. Registro documental | PASS | `PRIVACY_LGPD.md`, `DATA_RETENTION_LIFECYCLE.md`, `DATA_MODEL.md` e desenho atualizados; `SUBPROCESSORS.md` sem mudança necessária. A §20.18 do plano (INFO-03) entra no fechamento |

## Pendências jurídicas/externas

Sem mudança desde a rodada 1:
- E-09: qualificação da impressão e base legal.
- D-07 e D-18: anonimização, correção e prazos.
- E-08: retenção dos logs.
- E-07 e D-27: dado eliminado em backup.

## Achados bloqueantes

Nenhum. M-PRI-01 e L-PRI-02 estão resolvidos; N-PRI-01 e N-PRI-02 são INFO.

## Fora do escopo desta avaliação

Igual à rodada 1:
- PR-AUTH-01, PR-PRIV-01, PR-CR-05, D-07 e E-09 (P8);
- D-18 (P5/P8, parte financeira);
- PR-AUTH-02 (P9);
- D-26 (P8/P9);
- PR-AI-01 e D-11 (P8);
- PR-OBS-02, PR-BKP-01, E-07, D-27 e E-08 (P7);
- PR-RULES-02 e PR-PLAT-03 (P6);
- decisão do cache em memória do SDK (P6/P8), que agora inclui `reportFetchStarts` (N-PRI-02).

## Verificação

**Executado nesta rodada**
1. Árvores:
   - `git cat-file -t 377c2f3f` devolve `tree`;
   - árvore do worktree com índice temporário próprio (`r2.index`, apagado depois): `1f78fc6e`;
   - `git diff 377c2f3f 1f78fc6e -- . ':!docs'` vazio;
   - diff de código `905ed3d6 → 377c2f3f` conferido arquivo a arquivo.
2. Cópia própria da árvore congelada: `git archive 377c2f3f functions/src functions/package.json functions/tsconfig.json tests/fixtures firestore.indexes.json` em `$S/p5f1r3/revisoes/privacidade/r2-copia/`, com `node_modules` ligado por link simbólico ao do worktree, só para leitura. `tsc -p tsconfig.json`: saída 0. O `WT/functions/lib` não foi tocado. A cópia (13 MB, com o link simbólico) foi apagada depois do uso, para não ir ao pacote; para reproduzir, recrie-a com os mesmos comandos.
3. Na cópia: `node --test lib/cash/__tests__/projectionMarks.test.js lib/cash/__tests__/dayProjection.test.js` dá **31/31**. A linha `[INV-M]` mostra `pruned: 954`. Log: `r2-functions-unit.log`.
4. Sonda `sondas/sonda-r2-poda-e-p8.cjs`, com as funções compiladas da cópia, o mesmo laço de `periods.ts:1388-1406` e a âncora com merge. Log: `sondas/sonda-r2-poda-e-p8.log`. Resultados:
   - **1b:** a g0 sai na regravação;
   - **2b:** fp(V1) continua depois de duas reconstruções;
   - **2c:** fp(V1) sai na regravação seguinte;
   - **3:** ordem certa, sem fp(V1);
   - **4a e 4b:** ordem errada, fp(V1) em pendência, que sobrevive à reconstrução.
5. Buscas e checagens:
   - nenhum log novo fora de teste (o único `console.log` novo está em `projectionMarks.integration.test.ts:738`);
   - nenhuma API de armazenamento local nem e-mail no diff da rodada;
   - `firestore.rules` e caminhos de leitura do cliente sem mudança;
   - `hashKey` do React Query devolve a chave em claro (`node -e`).

**Lido no `verify:all`** (árvore `377c2f3f`, `$S/p5f1r3/logs/verify-all-final.log`; o `.meta` registra `fim=2026-11-09T20:22:55Z exit=0 duracao_s=2423`)
- `functions:test:unit`: 677/677.
- `test:unit:work-time`: 213/213, com as guardas 133, 138 e 139.
- Integração das Functions: 985/985, com `ok 368` (poda) e `ok 369` (corrida F-02).
- `test:rules:projection-marks`: 17/17.
- E2E: 215/215 sem nenhum `✘`. Inclui B03-a a B03-e (5/5); `work-time-p5f` 265, 374, 560 e 999 (linhas 57615 e 58621 do log); e `workspace-membership` 54 (linha 59914).
- Total (`$S/p5f1r3/logs/verify-all-final.resumo.json`): 1.746 testes em `verify:fast`, 1.289 na integração e 215 no Playwright, ou seja, 3.250 testes, sem falha nem skip. O lint tem 0 erros. O resultado confere com o enviado pelo coordenador.

**Herdado, não reproduzido**
- `mutantes-backend-poda.log`: B01 e B13–B16 mortos.
- `unit-projectionMarks-poda.log`: 12/12.
- `int-copia-marcas-poda.log`: 15/15.

## Dependência do `verify:all`

Este parecer dependia de três E2E. Os três passaram no `verify:all` da árvore congelada, na 1ª execução:
- `e2e/workspace-membership.spec.ts:54`: "primeiro login prepara a conta no backend e o logout não vaza dados para a próxima conta". É o teste 8 do §14. Passou (`✓ 213`).
- `e2e/work-time-p5f.spec.ts:560`: "a IA não recebe a configuração e o modo tempo não grava nada fora do documento privado". Passou (`✓ 197`).
- `e2e/work-time-p5f.spec.ts:999`: falha na leitura das desconsideradas com mensagem fixa em pt-BR, sem nada do SDK. Passou (`✓ 204`).

O `verify:all` terminou com `exit=0` às 20:22:55 UTC, com 215/215 E2E. Nada deste parecer depende mais dele. O `exit=0` geral é exigência do `regression-release-gate`, não desta skill.
