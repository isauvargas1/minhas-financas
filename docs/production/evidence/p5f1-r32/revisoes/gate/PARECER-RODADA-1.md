PASS — regression release gate

# P5-F.1-R3.2: gate de regressão (`regression-release-gate`), rodada 1

- **Data:** 2026-11-14, das 17:03Z às 18:05Z.
- **Revisor:** independente. Este gate valida e não corrige. Nada foi escrito no worktree `wt-p5f1-r32`: nem código, nem testes, nem configuração, nem documentos, nem o índice do git.
- **Pasta:** `<scratchpad>/p5f1r32/revisoes/gate/`. Os arquivos citados como `logs/…` ficam nela, e os da execução oficial ficam em `p5f1r32/logs/gate-verify-all-r32*`.

**Decisão.** PASS. Todas as etapas obrigatórias rodaram e passaram, e nenhuma proibição foi violada. O critério de encerramento do pedido está cumprido:
- **Nenhuma conversão sem comprovação financeira válida.** Código, testes, prova vermelha e veredito financeiro sobre o estado final confirmam isso.
- **Nenhum bloqueador material aberto.** Ficam só riscos LOW e INFO, registrados no plano.
- **`verify:all` aprovado pelo procedimento oficial.** A execução `gate-verify-all-r32` foi uma só, ininterrupta, e saiu com 0.

## 1. Escopo Git

| Item | Valor |
| --- | --- |
| Branch | `feat/p5-f1-r32-2026-11-11`, sem upstream (`git rev-parse @{u}`: "no upstream configured") |
| `HEAD` | `1730a1df0d3870ff52496933f45cb73a8dacd29b`, árvore `3995eb7f`. O índice real é o HEAD: `git diff --cached` está vazio antes e depois do gate |
| Merge-base com `main` | `37d8780d94451afdaff0e91686307daa824c1ad9` (registro). A base que vale é a informada no pedido, abaixo |
| Base informada (R3.1) | árvore `efcbd2645b8e7b08b5add2812f6b319f4a76369b`, que existe (`git cat-file -t`: tree) |
| Estado final medido | árvore `3bf2139781338059aa5a3554cb473799c1e44683`, do diretório de trabalho por índice temporário (`tree-now.sh`). Foi medida antes da execução oficial, no começo dela, no fim dela e de novo depois dos testes extras: a mesma nas quatro vezes |
| Código final do executor | `5ea7fabee02c3ae4ca79400f416ce9e67e425ec7`. De `5ea7fabe` para `3bf21397`, nada muda fora de `docs/` (`logs/auditoria-diff.txt`) |
| Worktree | 69 `M` e 47 `??` sobre o HEAD (`gate-verify-all-r32.log.status`): a R3.2 e as etapas anteriores, nada commitado. O status depois do gate é idêntico ao do começo (`logs/status-depois.txt`), e só os artefatos ignorados de build e de teste mudaram |

**Diff da base para o estado final, fora de `docs/`:** 18 arquivos, +2.624 e −85 linhas (`git diff --stat --no-renames efcbd264 3bf21397`).

| Componente | Arquivos | Classificação |
| --- | --- | --- |
| Cliente, domínio financeiro (Frente A) | `src/modules/work-time/consistency.ts`, `src/modules/work-time/useIncomeEstimateWith.ts`, `src/modules/reports/basisSync.ts` | Prova de consistência e apresentação fail-closed da estimativa; confirmação do servidor zerada no retorno só do cache |
| Testes de unidade | `tests/unit/work-time-consistency.test.ts`, `work-time-guard.test.ts`, `work-time-income-estimate.test.ts` | Novos e reescritos (`testes-substituidos.md`) |
| E2E | `e2e/work-time-b03.spec.ts` (+B03-g), `e2e/work-time-p5f.spec.ts` (+ADV-01 R3.2, 1 reescrito) | Novos e reescrito |
| Ferramentas de teste (Frente B) | `tools/e2e/{executar-em-grupos,grupos,portas}.mjs`, `tools/integracao/marco-da-fase.mjs`, `tests/tools/{e2e-grupos,integracao-marco}.test.mjs` (novos) | Executor do E2E em grupos e marco de fase completa da integração |
| Configuração de teste e CI | `package.json` (`test:e2e`, `test:integration:emulator`, `verify:fast`, `e2e:kill-ports`, `test:tools:*`), `playwright.config.ts`, `.github/workflows/quality-gate.yml` | `retries: 0`, `forbidOnly: true`, `gracefulShutdown` SIGTERM e relatório JSON por grupo; firebase-tools fixado em 15.32.1 no CI |
| Documentação de comandos | `README.md` (tabela de comandos) | Só texto de desenvolvedor |

- **Fora do diff:** `functions/`, `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc`, componentes React, estilos, `index.html` e `App.tsx` (`logs/auditoria-diff.txt`). O diff também não toca `src/modules/reports/hooks.ts`, que é o adaptador do SDK, nem `messages.ts`, `estimate.ts` e `presentation.ts`.
- **`docs/`:** 189 arquivos, +50.867 e −18. São a evidência, o plano §20.20 e cinco linhas ajustadas em `DATA_MODEL.md`, `FIREBASE_PRODUCTION.md`, `SECURITY_MODEL.md`, `THREAT_MODEL.md` e `RUNBOOKS.md`.

## 2. Evidências

| Etapa | Comando / inspeção | Resultado | Duração | Artefato |
| --- | --- | --- | --- | --- |
| Procedimento oficial | `bash p5f1r32/run-oficial.sh gate-verify-all-r32 verify:all` (= `npm run verify:all` no worktree, com o loopback-proxy do contêiner e o amostrador de memória), uma vez, em segundo plano, sem nada pesado em paralelo; portas do Emulator livres e nenhuma JVM antes | **saída 0**; `arvore` = `arvore_no_fim` = `3bf21397`; `portas_ocupadas_no_fim=[]`, `java_no_fim=0`, `limpeza_externa=nenhuma (o Emulator desligou sozinho)` | **2.902 s** (17:08:22Z–17:56:51Z) | `p5f1r32/logs/gate-verify-all-r32.log` (SHA-256 `c9f7aed0…`), `.log.meta`, `.log.status`, `-memoria.txt`, `-artefatos/`; `logs/sha256-execucao-oficial.txt` |
| 1. Typecheck | `npm run typecheck` (`tsc --noEmit` da raiz, que inclui `src`, `e2e` e `tests`, e o das Functions), dentro do `verify:fast` | 0 erro (a cadeia `&&` seguiu) | dentro do `verify:fast` (≈4,3 min no total) | log, linhas 10-17 |
| Lint das Functions | `npm run functions:lint` | **0 erro**, 201 avisos, iguais à R3.1 (0 erro e 201 avisos) | idem | log, linha 293 |
| 2. Build do frontend | `npm run build` (`vite build`) | ok, `built in 26.35s`. O único aviso é o de chunk > 900 kB, anterior à etapa | idem | log, linhas 297-322 |
| 3. Build das Functions | `npm run functions:build`; e, no E2E, `npm --prefix functions run build` pelo executor | ok | idem | log |
| 4. Unidade (frontend, Functions e ferramentas) | os 20 scripts de teste do `verify:fast` | **1.843/1.843**: 0 falha, 0 skip, 0 todo, 0 cancelado. `work-time` 284, `test:tools:e2e` 23, `test:tools:integracao` 3, `functions:test:unit` 677 | idem | `logs/contagens-gate.txt` |
| 5. Integração | `npm run test:integration:emulator`, com o marco `iniciar`, o `firebase emulators:exec --only auth,firestore --project minhas-financas-local`, a cadeia e depois `concluir` e `conferir` | Functions **985/985**, guardas **15/15** (limpeza) e **2/2** (contas); `Script exited successfully (code 0)` (linha 36762); `[integração] fase completa … (execução e2c3bd4f-…)` (linha 36768); 22 resumos, **1.289/1.289**, 0 skip | ≈19,5 min (17:12:4xZ–17:32:0xZ, pela JVM no amostrador) | `logs/contagens-gate.txt` |
| 6. Firebase Emulator | o mesmo `emulators:exec` e, no E2E, o `webServer` do Playwright (`--project minhas-financas-local`) | 1 Emulator na integração e 1 por grupo no E2E. Prontos, consumidos e desligados: "Received SIGTERM … clean shutdown" só nos 3 fins de grupo, e nenhum "Received SIG" na fase de integração. Nenhuma JVM nem porta ocupada no fim. `sistema-financeiro-pesso-20698` aparece 0 vez no log e 0 vez nos 3 `firebase-debug.log`; `minhas-financas-local` aparece 44.035 vezes | — | `logs/conferencias-log-oficial.txt`; `-artefatos/grupo-*/firebase-debug.log` |
| 7. Firestore Rules | as 19 suítes `test:rules:*` da cadeia oficial | **287/287**, com as mesmas contagens por suíte da `verify-all-r32-9` (accounts 5, adjacent 5, billing 10, cards 5, goals 21, investment-domain 19, investment-m3 7, investments 7, m4 41, notifications 84, projection-marks 17, receivables 6, recurring 5, reports 12, settings-catalog 4, split 7, transactions-p4d 8, work-time 14, workspaces 10) | dentro da integração | `logs/contagens-gate.txt` |
| 8. Playwright E2E (suíte completa) | `npm run test:e2e` = `build:e2e` + `tools/e2e/executar-em-grupos.mjs` (3 grupos, `--shard`) | `218 testes em 36 arquivos, em 3 grupo(s)`. Grupo 1: 83/83 em 420 s. Grupo 2: 64/64 em 315 s. Grupo 3: 71/71 em 698 s. **`ok: 218 testes, cada um uma vez, todos passaram`** (linha 61757). Nos relatórios JSON, cada teste rodou uma vez, `expected`, com uma tentativa `passed`; 0 skipped, 0 unexpected, 0 flaky e nenhuma chave duplicada. As chaves (arquivo, títulos e linha) são idênticas às da `verify-all-r32-9` | ≈24,7 min (17:32:0xZ–17:56:51Z) | `-artefatos/e2e-grupos/grupo-{1,2,3}.json`; `logs/conferir-e2e.log`; `scripts/conferir-e2e.mjs` |
| 9. Smoke adjacente | dentro da suíte completa | O fluxo alterado e o escopo novo passam: B03-g, "escuta das projeções encerrada" (reescrito) e ADV-01 (R3.2), mais os 7 do B03 e os 20 do p5f. Também passam os fluxos que compartilham coleção, rota ou contrato: `financial-reports` 11, `cash-*` 15, `workspace-membership` 2, `regression-smoke` 3, `app-smoke` e `authenticated-smoke`, e os estados de erro (escuta encerrada, sem conexão, divergência) | — | `logs/e2e-por-arquivo.txt` |
| Plataforma | amostrador de memória; busca no log | Picos: `verify:fast` 2.363 MiB, integração 2.300, grupo 1 9.558, grupo 2 6.753, grupo 3 9.578 (`pico_mib=9578`). **0** `socket hang up` e **0** `ECONNRESET`, então o gatilho do D-P5F1-R32-03 não disparou. O `MetadataLookupWarning … 403` vem da sonda de metadados GCE do SDK pelo proxy do contêiner, ambiental: também aparece 116 vezes na `verify-all-r32-9` | — | `logs/conferencias-log-oficial.txt` |
| RR-R3-12 (guarda de IA com o índice completo) | `git archive 3bf21397` em `copia-final/`, `git init` e `git add -A` na cópia, depois `node --test tests/unit/ai-backend-only.test.ts` | **5/5**. Com o índice completo: 262 arquivos `src/**/*.ts(x)` e 786 na varredura de segredos. O índice real do worktree (HEAD) vê 228 e 631 | 1 s | `logs/ai-backend-only-indice-completo.log` |
| Prova vermelha (conferência do gate) | `copia-vermelho/`: a árvore final sem `docs/`, com os três arquivos de `src/` da R3.1 (SHA-256 iguais aos da R3.1); depois os três arquivos de unidade, `--test-concurrency=1` | **48 de 148 falham** na R3.1. Por exemplo: "prova: cada regra…", "B03 (R3.2): uma base e nenhuma desconsiderada com a escuta encerrada…" e "R3.2 (RR-R31-05): a base do cache aquecido antes do primeiro retorno do servidor…". Na árvore final, os mesmos 148 passam: estão nos 284 de `test:unit:work-time` | ≈2 min | `logs/vermelho-r31-src.log` |
| Auditoria do diff | `git diff`/`git grep` entre `efcbd264`, `698f9644`, `5ea7fabe` e `3bf21397` | Ver as seções 3 e 4 | — | `logs/auditoria-diff.txt` |

**Comparação com a base (R3.1, execuções da `testes-e-resultados.md` dela).**
- **Unidade.** 1.754 → 1.843 (+89). O delta é todo de testes novos:
  - `work-time-consistency` +61 (46 → 107);
  - `work-time-guard` +1;
  - `work-time-income-estimate` +1;
  - `tests/tools/e2e-grupos` +23 e `integracao-marco` +3, novos e ligados ao `verify:fast` e ao CI.
- **Integração e Rules.** 1.289 → 1.289, sem mudança: o diff não toca `functions/` nem as Rules.
- **E2E.** 216 → 218: +B03-g e +ADV-01 (R3.2).
- **Lint.** 0 erro e 201 avisos nos dois lados.

## 3. Achados

Nenhum HIGH ou MEDIUM. Nenhum achado bloqueia o PASS.

| ID | Severidade | Arquivo:linha | Achado | Impacto | Tratamento |
| --- | --- | --- | --- | --- | --- |
| G-R32-01 | LOW (anterior à etapa) | `functions/src/notifications/__tests__/producers.integration.test.ts:246-256` (RR-R32-12) | `assertNoWords` busca as palavras proibidas no `JSON.stringify` do aviso inteiro, inclusive nos identificadores aleatórios. Conferi no código e no log da `verify-all-r32-8`, linhas 20625-20633: `occurrenceId` `rocc_407244c6251999080b…` contém "9990", e o erro foi `dado indevido no aviso: 9990`. A falha era um falso positivo do teste, com causa comprovada; não é ambiental | Reprovação espúria e rara do procedimento oficial, nunca PASS falso. Nesta execução do gate, o teste passou (985/985); `functions/` não muda na etapa | Risco residual já no plano, com destino (pré-requisito do fechamento da P5) e critério escrito. A `verify-all-r32-8` continua reprovada no histórico; o gate não a desconsidera, mas a decisão se apoia na própria execução |
| G-R32-02 | LOW | `tests/tools/e2e-grupos.test.mjs:517-533` (RR-R32-13, EST-R6-01) | No caminho normal, o ajudante dos testes de interrupção sinaliza o falso `npx` pelo número do PID, sem o `ownStub` | Só com a volta inteira do contador de PIDs em menos de 1 s; não produz PASS falso | Risco residual aceito no plano; corrigir na próxima mudança do executor |
| G-R32-03 | INFO (anterior) | `tests/unit/ai-backend-only.test.ts:26-28` (RR-R3-12) | Sem commit, a execução oficial roda a guarda sobre o índice do HEAD (228 e 631 arquivos) e não vê os arquivos novos das etapas sem commit, como `tests/tools/*.mjs` | Sem a reexecução, a guarda de segredo não cobriria os arquivos novos | Reexecutada pelo gate com o índice completo: 5/5 (seção 2). Continua até a correção sugerida no plano (`--cached --others --exclude-standard`) |
| G-R32-04 | INFO | `package.json`, `.github/workflows/quality-gate.yml` | O repositório não tem ferramenta nem baseline de cobertura (sem c8, nyc ou thresholds) | A comparação de cobertura é por contagem e nome de teste, como nos gates anteriores. Não há redução: nenhum teste removido, e os 3 renomeados são reescritas declaradas | Registro |
| G-R32-05 | INFO | `docs/production/evidence/p5f1-r32/LEIAME.md` ("Veredito global: XXX") e plano §20.20 ("Estado. XXX (gate)") | Espaços reservados para o veredito deste gate | Só `docs/`; o executor preenche | Preencher com este veredito; a árvore de código continua `5ea7fabe` |

## 4. Proibições, skips e cobertura

- **Skip, only, fixme e todo.** A busca abrangeu `test|it|describe.(skip|only|fixme|todo)`, `{skip|todo: true}`, `test.fail`, `xit`, `xdescribe`, `--test-skip-pattern`, `--test-only`, `testIgnore` e `grepInvert`. Em `e2e`, `tests`, `functions/src`, `src`, `playwright.config.ts` e `package.json`, deu **0 na R3.1 e 0 na árvore final**. Na saída, nenhum skipped, todo, cancelled, flaky ou unexpected em nenhuma das três fases.
- **Asserções removidas.** São 11 linhas, todas nas reescritas declaradas em `testes-substituidos.md`, e conferi cada uma:
  - **Prova pura, 6 linhas.** Afirmavam `provada` sem projeção, o RR-R31-05 em si. Agora afirmam `projection`, `bases`, `inexact` ou `provada` só com a projeção confirmada e igual.
  - **Guarda do cache, 1 linha.** `if (snapshot.fromCache) return;` virou `{ setConfirmed(null); return; }`, mais estrita.
  - **Guarda do `holdEstimate`, 1 linha.** Ver o ponto seguinte.
  - **E2E "escuta encerrada", 3 linhas.** Afirmavam a ressalva com conversão. Agora: indisponível, `[data-work-time]` ausente, saldo em reais, ressalva ausente e, na reabertura, `approximate` positivo e o saldo convertido de novo.
- **Única semântica afrouxada: `holdEstimate`.** Na R3.1, segurava todo `done`. Agora não segura a indisponível dos três motivos de `DECIDED_BEFORE_INCOME` (`business_not_confirmed`, `report_unavailable`, `exclusion_unconfirmed`). Isso é aceito porque:
  - o pedido exige isso explicitamente ("Preservar estados legitimamente indisponíveis…");
  - esses estados não convertem nem trazem números: a guarda confere que são exatamente os motivos devolvidos antes de `applyIncomeExclusions` e que nenhum aparece depois;
  - a lista é fechada e fail-closed: um motivo novo espera a prova;
  - a cobertura é superior: a tabela-verdade com as 11 razões de `UNAVAILABLE_REASON_TEXT`, prova × sincronização × falha; o bloco de 35 testes no gancho; o E2E ADV-01; e os mutantes N17, N18 e N21 a N26 mortos;
  - a pronta (`ready`) continua exigindo `proven && !settling`, e o gancho só devolve `shown` ou o erro de espera (`useIncomeEstimateWith.ts:402,424-425`).
- **Prazos.**
  - Nenhum prazo existente aumentou. O `timeout: 45_000` e o do `webServer` (180 s) do Playwright estão iguais, e o reescrito mantém `test.setTimeout(240_000)`.
  - Os dois testes novos usam `test.setTimeout(300_000)`, como os seis da R3.1 do mesmo tipo (B03 com 300 s e 360 s; p5f com 6 × 300 s).
  - O prazo de 60 s do `gracefulShutdown` vale só para o desligamento.
  - `E2E_PORT_WAIT_MS` só encurta a espera.
- **Nova tentativa.** `retries` passou de `CI ? 2 : 0` para `0`, mais estrito. O executor reprova qualquer teste com mais de uma tentativa ou que não seja `expected`, e `forbidOnly: true` foi incluído. O `trace` passou de `on-first-retry` (inútil sem nova tentativa) para `retain-on-failure` no CI, o que preserva os rastros da falha.
- **Testes removidos.** Nenhum. Pelos nomes, R3.1 → final:
  - na unidade, só faltam os 2 renomeados de `work-time-consistency` ("B03: uma base…" e "R3.1: provada, mas…");
  - no E2E, só falta o renomeado de `work-time-p5f`;
  - todos estão declarados com o substituto, e as contagens subiram em todos os arquivos.
- **Legado.** A regra "leitura única" e o campo `multipleBases` saíram de `src/`: 0 ocorrência. Os testes só os citam em asserções negativas (`work-time-guard.test.ts:779,782`) e numa entrada forçada que não dispensa a projeção (`work-time-consistency.test.ts:159`). `carriesBasisFigures` saiu do código e dos testes.
- **Produção.** Nenhum comando, script ou variável do gate aponta para `sistema-financeiro-pesso-20698`.
  - As 2 ocorrências nas linhas adicionadas são `assert.doesNotMatch(…, /sistema-financeiro-pesso-20698/)`, em `tests/tools/e2e-grupos.test.mjs` e `integracao-marco.test.mjs`.
  - `verify:all`, `test:e2e` e `test:integration:emulator` usam `minhas-financas-local`.
  - O `.firebaserc` com a produção como `default` é anterior à etapa (PR-PLAT-01) e não é usado pelo gate.
  - Nenhum `deploy:*` rodou.
- **Plano.** §20.20 está atualizado, com as decisões D-P5F1-R32-01 a 03, testes, revisões, execuções, riscos e rollback. O estado aguarda este gate, e a etapa não foi declarada concluída antes dele.

## 5. Mudanças de superfície

- **UI.** Nenhuma.
  - O diff não toca componentes, contextos, estilos, `index.html`, `App.tsx`, `messages.ts`, `estimate.ts` nem `presentation.ts`.
  - As únicas strings novas em `src/` são códigos internos de motivo (`'inexact'` e os três de `DECIDED_BEFORE_INCOME`), usados só na decisão (`useIncomeEstimateWith.ts:371-376`) e nunca renderizados.
  - O que o usuário vê muda só por estado. A conversão sem confirmação sai, e os valores ficam em reais com os textos já existentes ("calculando", "em atualização" com "Tentar de novo", "Não foi possível confirmar…"). É o comportamento pedido, coberto pelos E2E B03-g, p5f e ADV-01 e pela revisão pt-BR.
- **Textos.** Nenhum texto novo nem alterado ao usuário. O `README.md` mudou só na tabela de comandos do desenvolvedor.
- **Rotas.** Nenhuma.
- **Contratos.**
  - `ConsistencyInput` perdeu `multipleBases` e `ConsistencyReason` ganhou `'inexact'`: são tipos internos do módulo, com consumidores ajustados e verificados pelo `tsc`.
  - `DECIDED_BEFORE_INCOME` e `dependsOnIncomeReadings` são exportações novas do gancho.
  - Nenhum documento Firestore, índice, evento, payload, callable ou Rule mudou. A escuta continua a mesma: `cash_report_periods`, `limit(13)`, `includeMetadataChanges`, em `hooks.ts`, que não mudou.
- **Configuração de teste e CI.**
  - O `test:e2e` agora roda em grupos.
  - O `test:integration:emulator` ganhou o marco de fase completa.
  - O `verify:fast` passou a incluir os testes das ferramentas.
  - O CI fixa o firebase-tools em 15.32.1 e roda os dois testes novos.
  - Tudo isso é pedido pela Frente B, testado (23 + 3 testes, mutantes 57/57) e exercitado por esta execução.

## 6. Riscos residuais

Os do plano §20.20 continuam, todos LOW ou INFO, e nenhum foi aberto por este gate:
- **RR-R32-01:** sincronização demorada, o custo do fail-closed, com valores em reais.
- **RR-R32-02:** o painel "Receitas consideradas" depende da estimativa mostrada.
- **RR-R32-03:** `socket hang up` não comprovado, aceito com gatilho. Teve 0 ocorrência nesta execução.
- **RR-R32-04:** um segundo sinal ou SIGKILL pode deixar o Emulator de pé.
- **RR-R32-05:** o fluxo em grupos ainda não rodou no CI. Picos medidos aqui: 9.578, 6.753 e 9.558 MiB por grupo; o ajuste é o `E2E_SHARDS`.
- **RR-R32-06:** virada do mês, anterior à etapa.
- **RR-R32-07** (INFO): janela de detecção da queda pelo SDK.
- **RR-R32-08:** `predeploy:rules` sem o marco, para a P6.
- **RR-R32-09** (INFO): lacunas de E2E cobertas pela unidade.
- **RR-R32-10** (INFO): o marco não é amarrado à cadeia. O gate conferiu a contagem por suíte e 0 "Received SIG" na integração.
- **RR-R32-11:** a memória de cálculo da indisponível sem totais, anterior à etapa.
- **RR-R32-12:** G-R32-01.
- **RR-R32-13:** G-R32-02.
- **RR-R3-12:** G-R32-03.

Mitigações e destinos estão no plano.

## 7. Bloqueadores para PASS

Nenhum.

## 8. Skills de domínio

O diff toca dados e cálculo financeiro (a prova e a apresentação da estimativa), a escuta Firestore, a configuração de Emulator, Playwright e CI, e o que é renderizado ao usuário (por estado). Com isso, as skills exigidas são estas quatro.

**Cobertura do estado final.** As rodadas 4 da financeira, da adversarial e da pt-BR foram na árvore `698f9644`. Conferi o diff de `698f9644` para `5ea7fabe`: só `tests/tools/e2e-grupos.test.mjs` (o `ownStub`, a flag `completed` e o `finally` do ajudante) e uma linha de `docs/production/DATA_MODEL.md` (o ADV-R4-01 pedido pela própria adversarial). Nenhum dos dois toca a superfície dessas três revisões. De `5ea7fabe` para `3bf21397`, só `docs/`. Por isso, as três cobrem o código final. As rodadas 1 a 3, sobre as árvores anteriores, cobrem o restante do diff da etapa; a rodada 4 foi focada na mudança de `ef514869` para `698f9644`.

| Skill | Veredito sobre o estado final | Referência |
| --- | --- | --- |
| `financial-domain-integrity` | `PASS — Financial domain integrity` (rodada 4, `698f9644`; rodadas 3 PASS, 2 FAIL pelo F-08, corrigido e fechado, e 1 PASS). Os achados abertos são INFO, cobertos por RR-R32-09, ou LOW anteriores (RR-R32-06), e não bloqueiam. A prova vermelha (48/148 na R3.1) foi conferida pelo gate | `revisoes/financeiro/rodada-4/PARECER.md`; respostas em `evidence/p5f1-r32/revisoes/LEIAME.md` |
| `firestore-scale-cost-review` | `PASS — Firestore scale/cost review` (revisão adversarial, rodada 4, `698f9644`, seção 6; também PASS nas rodadas 1 a 3). Nenhuma consulta, escuta, índice, Rule ou Function nova; a regra nova nunca acrescenta leitura | `revisoes/adversarial/rodada-4/PARECER.md:216` |
| `firebase-production-readiness` (escopo da etapa) | `PASS — Firebase production readiness` (estabilidade, rodada 6, na árvore de código final `5ea7fabe`, com a `verify-all-r32-9` conferida por contagem). A rodada 5 deu FAIL interino só pela falta de execução válida em `b2b15267`, árvore superada. Esta execução do gate repete a conferência na árvore final, com o mesmo resultado | `revisoes/estabilidade/rodada-6/PARECER.md:1,224` |
| `ptbr-product-ui-review` | `PASS — revisão de UI de produto em PT-BR` (rodada 4, `698f9644`; PASS nas quatro). Os hashes da interface são iguais na R3.1 e na final; PT-R3-01 é anterior (RR-R32-11) | `revisoes/ptbr/rodada-4/PARECER.md` |

**Skills não aplicáveis pelo diff:**
- **`multi-tenant-security-review`.** O diff não toca Auth, membership, RBAC, Rules, Storage, callables nem `functions/`.
  - A escuta continua com a mesma consulta por workspace, em `hooks.ts`, que não mudou.
  - A chave da confirmação, por conta, workspace e meses, continua a da R3.1. A mudança só remove a confirmação no retorno do cache, o que é mais restritivo e não dá acesso a nada novo.
  - Os 287 testes de Rules e o E2E `workspace-membership` passam sem mudança.
- **`billing-entitlement-integrity`.** Nada de Stripe, planos, assinatura, webhook, entitlements ou quotas. O listener de `billing_accounts` não mudou, e `test:rules:billing` (10) e `test:unit:billing` (72) passam iguais.
- **`privacy-lgpd-data-lifecycle`.** Nenhum dado pessoal novo é coletado, gravado, retido ou enviado a terceiro. Os registros novos dos E2E (`[estados-adv-01…]`, `[valores-b03-g…]`) imprimem só estados de tela com dados sintéticos do Emulator.
- **`observability-incident-readiness`.** Nenhum logging, métrica, alerta, auditoria ou reconciliação do produto mudou. O que mudou é saída e guarda de logs da ferramenta de teste (o `firebase-debug.log` por grupo), coberta pela revisão de estabilidade.
- **`saas-commercial-readiness`.** Nenhuma landing, preço, cadastro, checkout, página legal, footer, SEO ou afirmação pública. O `README.md` mudou só na tabela de comandos.

## O que não foi possível verificar

- **CI.** O fluxo em grupos no CI real (RR-R32-05, configuração externa): este gate roda no contêiner, e nada foi publicado.
- **Rede real.** A duração da espera com rede real (RR-R32-01).

Nenhum dos dois é etapa do checklist executável aqui. Os dois estão registrados como risco no plano.
