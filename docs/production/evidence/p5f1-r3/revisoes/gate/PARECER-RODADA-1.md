FAIL — regression release gate

# Gate de regressão — P5-F.1-R3 (B03, recuperação após reconstrução e RR-R2A-04)

Revisor independente, somente leitura, em 2026-11-09, de cerca de 21:00 a 22:10 UTC. Skill `regression-release-gate`, com o `references/release-checklist.md` lido na íntegra antes da validação.

O que este gate não fez:
- não alterou nenhum arquivo do worktree (WT), do repositório ou do plano;
- não usou Firebase fora do Emulator `minhas-financas-local`, e o usou só numa cópia própria e sob o lock `wt-r3-runtime.lock`;
- não rodou `npm run dev` nem `preview`, não fez commit, push nem deploy e não leu nenhum `.env*`.

**Decisão: FAIL**, por um único bloqueador, de evidência e não de código (B-01).
- **O código está sólido.** O `verify:all` do executor na árvore de código `377c2f3f` passou na 1ª execução: 3.250 testes, 0 falha.
- **A reexecução independente deste gate** na mesma árvore reproduziu, script a script, o `verify:fast` (1.746) e a integração com Rules (1.289). No E2E, 214 de 215 passaram. A falha é ambiental e comprovada: o cgroup de memória da sessão esgotou, o OOM do kernel está registrado e o spec isolado passou 3 de 3 (E-01).
- **Sem enfraquecimento.** Nenhum teste foi pulado, removido sem substituto ou enfraquecido sem justificativa, e nenhum timeout aumentou.
- **O bloqueador.** O parecer de privacidade (rodada 2) diz que qualquer mudança posterior em `PRIVACY_LGPD.md`, `DATA_RETENTION_LIFECYCLE.md`, `DATA_MODEL.md` ou `DESENHO-MARCAS-B03.md` exige nova conferência. Três desses arquivos mudaram 42 s depois do parecer, e a conferência não existe. O gate exige o PASS de cada skill sobre o estado final, e para a privacidade ele não cobre o estado final da documentação.

## 1. Escopo Git

| Item | Valor |
| --- | --- |
| Worktree | `<scratchpad>/wt-p5f1-r3`, branch local `feat/p5-f1-r3-2026-11-09` |
| `HEAD` | `1730a1df0d3870ff52496933f45cb73a8dacd29b` (commit-base; a R3 está no diretório de trabalho, sem commit) |
| Status contra o `HEAD` | 66 arquivos modificados e 41 não versionados (P5-F, R1, R2A e R3 acumuladas); índice real intocado |
| Base da comparação | árvore entregue da R2A `f82679226ec93e18f906731be09d0675326fd764` (objeto `tree`, conferido com `git cat-file -t`) |
| Merge-base | Não se aplica: a base é um objeto `tree`, não um commit. As duas árvores derivam do mesmo `1730a1df` |
| Árvore de código final | `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93` (a do `verify:all`) |
| Árvore atual do WT | `914f8b69098a1af57f87b7402d3aa48a65880ac2`, calculada com índice temporário próprio; a mesma no início e no fim deste gate |
| Delta de código R2A → `377c2f3f` (fora de `docs/`) | 33 arquivos, +6.666/−526: 12 novos e 21 alterados, nenhum removido |
| Delta de documentos R2A → atual | 171 arquivos em `docs/`, +8.932/−11 |
| Depois do `verify:all` (`377c2f3f` → atual) | 89 arquivos, **todos em `docs/`** |

**Componentes tocados.**
- **Backend:**
  - `functions/src/cash/projectionMarks.ts`, novo;
  - `periods.ts`: marca na transação do delta, etiqueta da geração e poda;
  - `rebuild.ts`: âncoras na página, orçamento com âncoras, checkpoint v3, recomeço `post_cutoff_event_missed_staging`, e `markSlot` e `markRecoveryNeeded` na publicação;
  - `triggers/transactions.ts`: `beforeUpdateTime` e o log `cash_projection_mark.broken`.
- **Rules e índices:** bloco `cash_projection_marks` só com `get`, a coleção em `isBackendOwnedCollection` e 6 isenções de índice de campo único.
- **Cliente:**
  - a prova pelas marcas (`work-time/projectionProof.ts` e `projectionReads.ts`, novos) e a regra 5 nova em `consistency.ts`;
  - o gancho da estimativa, `receivableReversal.ts`, `transactions/api.ts` e `incomeReads.ts`;
  - a releitura do Dashboard (`reports/queryKeys.ts`, `hooks.ts`);
  - a remoção de `observeDependentRead` (`basisRegistry.ts`) e o texto `ESTIMATE_UPDATING`.
- **Testes:** 8 arquivos novos e 5 alterados. `package.json` muda só em scripts de teste.

**Depois do `verify:all`, só `docs/` mudou.**
- O `git diff 377c2f3f 914f8b69` fora de `docs/` é vazio.
- Nenhum arquivo versionado ou não ignorado fora de `docs/` tem mtime posterior ao início do `verify:all` (19:42:32Z). Os únicos são os logs de depuração do Emulator, que são ignorados.

**Nenhum teste lê `docs/` de forma que essas mudanças alterem resultado.** Há uma exceção à frase literal "nenhum teste lê `docs/`" do parecer de observabilidade (rodada 2):
- a varredura de segredos de `tests/unit/ai-backend-only.test.ts:76-78` usa os pathspecs `*.json` e `*.ts`, que no git casam em qualquer profundidade, e lê 57 `.json` versionados de `docs/`;
- o único `.json` mudado depois do `verify:all` (`saidas/verify-all-final.resumo.json`) não é versionado e fica fora dessa lista;
- nenhum arquivo de `docs/` tem o padrão de chave procurado;
- o `tsc` da raiz não inclui `docs/`, e não há `.ts` lá.

## 2. Evidências

| Etapa | Comando ou inspeção | Resultado | Duração | Artefato |
| --- | --- | --- | --- | --- |
| Execução oficial (executor) | `npm run verify:all` na árvore `377c2f3f`, 1ª execução | `exit=0`. A árvore está registrada no `.meta`, o Emulator foi o `minhas-financas-local` e a JVM órfã do E2E foi encerrada com SIGTERM pela limpeza | 2.423 s (19:42:32–20:22:55Z) | `p5f1r3/logs/verify-all-final.log`, `.meta`, `.resumo.json`, `emulator-cleanup.log` |
| Reexecução independente (gate) | `npm run verify:all` numa cópia: `git archive 377c2f3f`, `node_modules` copiados, índice git com todos os arquivos (árvore `377c2f3f` antes e depois), sem commit, sob o lock, com o proxy de loopback numa porta própria | `exit=1`. `verify:fast` 1.746/1.746 e integração 1.289/1.289, iguais script a script ao executor. E2E 214/215, com 1 falha ambiental comprovada (E-01). `limpeza=0` | 2.488 s (21:18:29–21:59:57Z) | `revisoes/gate/logs/verify-all-gate.log`, `.meta`, `emulator-cleanup-gate.log` |
| Diagnóstico de determinismo (gate) | `npx playwright test e2e/workspace-membership.spec.ts --repeat-each=3` na mesma cópia | 6/6. O teste que falhou passou 3/3 (13,0 s, 4,8 s e 3,8 s) | 73 s | `revisoes/gate/logs/e2e-membership-rerun.log` |
| Evidência ambiental (gate) | `dmesg`, PSI de memória, `firebase-debug.log` da cópia e dos WTs da R3 e da R2A | Ver E-01 | — | `revisoes/gate/logs/dmesg-oom.txt` |
| 1. Typecheck | `tsc --noEmit` na raiz e nas Functions | 0 erro nas duas execuções | — | logs, linhas 10–17 |
| Lint das Functions | `eslint --ext .js,.ts .` | 0 erro e 201 avisos nas duas execuções. O conjunto por arquivo e regra é idêntico ao da R2A: nenhum aviso novo, nenhum em arquivo da R3 | — | comparação dos logs |
| 2. Build do frontend | `vite build`, de produção e de E2E | OK. Só o aviso de chunk acima de 900 kB, o mesmo da R2A | 22,16 s e 21,85 s | logs |
| 3. Build das Functions | `tsc` (`functions:build`) | OK | — | logs |
| 4. Unitários | 18 scripts do `verify:fast` | **1.746/1.746** nas duas execuções, com 0 fail, cancelled, skipped e todo | — | logs |
| 5–7. Integração, Emulator e Rules | `test:integration:emulator`, com `--project minhas-financas-local`: Functions (985) e suítes de Rules e ferramentas (304) | **1.289/1.289** nas duas execuções, com "Script exited successfully (code 0)" e os emuladores encerrados | 945 s só nas Functions | logs |
| 8. Playwright | `npm run test:e2e`: build E2E e `vite preview` contra o Emulator | Executor: **215 passed (18,5 min)**, 1 worker, `retries: 0` (sem `CI`), nenhum `✘`, `flaky` ou pulado. Gate: 214/215 (E-01) | 18,5 e 19,4 min | logs |
| 9. Smoke adjacente | Suíte E2E completa | Cobre o fluxo alterado (`work-time-b03`, 5), a estimativa vizinha (`work-time-p5f`, 19), o RR-R2A-04 (`cash-pending-entries`, 2), o logout (`workspace-membership:54`) e as callables de lançamento e reconstrução usadas pelos B03 | — | logs |
| Comparação com a R2A | Script a script e nome a nome, nos dois logs | Ver §4: +97, só testes novos; nenhum script perdeu teste; saíram 8 nomes, todos substituídos e documentados | — | `revisoes/gate/node-test-names-diff.txt` |
| Skips, `only`, `todo` | `git grep` das duas árvores, com os equivalentes do `node:test` e do Playwright (`.skip/.only/.todo/.fixme`, `{skip:}`, `x*`, `--test-only`, `grep`, `forbidOnly`, `retries`) | Nada novo. Preexistentes e inativos: o `skip` condicional de `investmentDrift.integration.test.ts` (o ambiente do Emulator está presente) e `retries: process.env.CI ? 2 : 0` | — | `revisoes/gate/skipscan-*.txt` |
| Timeouts | Diff dos testes existentes alterados; auxiliares `until`/`settle`; `setTimeout` do spec novo por versão | Nenhum aumentado. Os valores do spec novo (300 s e 360 s) estão na faixa do `work-time-p5f` da R2A e não mudaram entre a cópia das 18:09 e o final | — | §3 |
| Projeto de produção | Linhas `+` do delta, logs do `verify:all`, scripts e sondas da etapa, bundle E2E da cópia | 0 em comando, script, log ou bundle. 2 linhas, só em documentação. Os testes de ferramentas que citam o projeto são guardas de recusa, anteriores à R3 | — | — |
| Scripts `deploy:*` | Logs e scripts da etapa e dos revisores | Nenhum executado e nenhum alterado. `predeploy:rules` ganhou o build das Functions e a suíte nova, só no Emulator | — | `package.json` |
| Segredos | Linhas `+` do delta (chaves Google, Stripe, webhook, chave privada, GitHub, Slack, AWS, JWT) e nomes de arquivo | 0. Só senhas sintéticas de Emulator em testes e sondas | — | `revisoes/gate/added-lines.txt` |
| Mutantes (amostragem dos logs) | Totais e SHA-256 dos arquivos mutados | Cliente 29/29 (28/29 e o P07); rápidos 7/7; backend no Emulator 16/16 (11/12, o B09 e a poda 5/5); S01 e S03 da R2A 38/38. Os 5 arquivos mutados do cliente têm o mesmo SHA-256 na árvore final | — | `p5f1r3/logs/mutantes-*` |
| Fixtures geradas pelo backend | Regeneração das duas com o backend compilado da árvore final, gravando num arquivo próprio | Idênticas byte a byte às versionadas: `projection-mark-views.json` e `transaction-fingerprints.json` | — | `revisoes/gate/fixtures-regeneradas/` |
| Plano mestre | `PRODUCTION_READINESS_PLAN.md`: §20.18, linha da P5 e histórico de 2026-11-09 | Atualizado com arquitetura, invariantes, custos, condições de implantação e restauração, testes, revisões, os riscos RR-R3-01 a 10 e o rollback. O veredito do gate está "pendente", como esperado | — | plano, linhas 56, 816 e 5086–5219 |

## 3. Achados

### Bloqueador

**B-01 — O parecer de privacidade não cobre o estado final da documentação da sua superfície.**
- A condição está em `revisoes/privacidade/PARECER-RODADA-2.md:19`: "Uma mudança posterior em `PRIVACY_LGPD.md`, `DATA_RETENTION_LIFECYCLE.md`, `DATA_MODEL.md` ou `DESENHO-MARCAS-B03.md` exige nova conferência." O parecer foi gravado às 20:25:00 UTC, com os documentos reconferidos na árvore `3eb6041d`.
- Às 20:25:42 UTC mudaram:
  - `docs/production/PRIVACY_LGPD.md:153` (§6.4, "Ordem obrigatória");
  - `docs/production/DATA_RETENTION_LIFECYCLE.md:104`;
  - `docs/production/evidence/p5f1-r3/DESENHO-MARCAS-B03.md:37` (§3) e as linhas 122–143 (§9).
- O conteúdo aplica o N-PRI-01 que o próprio revisor recomendou e confere com a sonda dele (cenários 3, 4a e 4b). Este gate não achou erro no texto. Mas a nova conferência que o parecer exige não existe, e o gate não substitui a skill de domínio. Não há arquivo do revisor de privacidade posterior às 20:25:01.

### Falha da reexecução independente, ambiental e comprovada (não é regressão)

**E-01 — `e2e/workspace-membership.spec.ts:169` ("convite, aceite, troca de papel, remoção e perda de acesso entre duas contas"), teste 214 de 215.**

**O que falhou.** Depois de `selectOption('admin')` (`:249`), o poll do documento do membro (`:251-253`) continuou lendo `viewer` até o limite de 45 s do teste.

**Por que é ambiental.**
- O teste e o caminho dele não mudaram na R3: o diff do spec, de `functions/src/workspaces`, de `src/modules/workspaces` e de `SettingsView.tsx` é vazio.
- **Linha do tempo**, pelo `firebase-debug.log` da cópia:
  - `updateWorkspaceSettings` do viewer, que só nega permissão, ficou de 21:59:13,6 a 21:59:35,6 (19.877 ms no log da callable; nas outras execuções, de 4 a 200 ms);
  - o `OPTIONS` da troca de papel levou 4 s;
  - o `POST` de `changeWorkspaceMemberRole` foi aceito às 21:59:46,95 e fechado sem `finish` às 21:59:51,6.
- **Kernel.** No mesmo segundo, o cgroup da sessão (`claude-code-bash`, limite de cerca de 13,35 GiB) chegou ao limite: "Memory cgroup out of memory: Killed process 1887 (chrome-headless)". Havia 132 processos com cerca de 13,3 GB de RSS, dos quais 103 `node` com cerca de 12,4 GB. A PSI de memória logo depois estava em `avg60=5.58` e `avg300=4.09`.
- **Origem da memória.** O emulador de Functions mantém um processo `node` por função e nunca o remove. Foram 98 workers na minha execução, contra 96 no `verify:all` do executor da R3 e 96 no da R2A, e 10 de `getFinancialReport`, contra 7 e 6. A suíte E2E roda no limite de memória deste ambiente desde a R2A, e a minha execução passou dele no fim.
- **Não determinística.** O mesmo teste passou no executor (13,4 s), na reexecução isolada (3 de 3) e em todas as execuções anteriores registradas.

**Classificação.** Causa ambiental comprovada pelo kernel e pelos tempos do emulador. Não houve valor errado; foi latência numa escrita assíncrona. Por si, não bloqueia. Fica registrado como risco de reprodutibilidade (§6).

**Artefatos da falha.** Fora do CI, a config do Playwright desliga trace, captura e vídeo (`playwright.config.ts:54-56`, anterior à R3). O `error-context.md` desta falha foi apagado pela reexecução isolada, porque o Playwright limpa `test-results/` a cada execução. A evidência preservada é:
- o erro, o call log e a linha, no `verify-all-gate.log` (linhas 60002 e 60060–60083);
- o trecho do pool de workers e do ciclo das requisições, em `revisoes/gate/logs/firebase-debug-e01-trecho.txt`;
- o relatório do OOM, em `revisoes/gate/logs/dmesg-oom.txt`.

### LOW

- **L-01 — Outras edições de documentos depois dos pareceres, sem condição explícita de reconferência.** Todas aplicam sugestões INFO dos próprios revisores. O gate conferiu cada uma contra o código ou a evidência, e todas estão corretas:
  - `OBSERVABILITY.md:50` e `:277`, às 20:57:07, depois do parecer de observabilidade (20:55:49, leitura até 20:49:19). Aplicam o R2-I1 e o R2-I2: `invalid_chain` (`projectionMarks.ts:425-436`); `lastMarkIssueCode/TransactionId/At` (`periods.ts:1209-1211`); "cada cadeia"; a RB-T04 (`RUNBOOKS.md:141`);
  - §9 do desenho, às 20:25:42, depois do parecer de escala (20:24:25). Aplica N1 a N3, N5 e N6, com os números da sonda do revisor;
  - `DATA_MODEL.md:140` (20:20:48) e a linha 26 de `PRIVACY_LGPD.md`, depois do parecer de segurança (20:20:09). Aplicam o R2-I1 e o R2-I4, e o revisor de privacidade os reconferiu em `3eb6041d`.

  Recomendação: incluir essas edições na reconferência do B-01.
- **L-02 — Guarda que não enxerga arquivos não versionados.** `tests/unit/ai-backend-only.test.ts:26-31` lista arquivos com `git ls-files` sem `--others`. Como a P5-F e a R3 estão sem commit no WT, o `verify:all` do executor deixou de fora:
  - 34 arquivos `src` não versionados, no guarda "nenhum arquivo do cliente importa SDK de IA" (varreu 228 de 262);
  - 131 arquivos novos, na varredura de segredos (631 de 762).

  O gate fechou a lacuna. A reexecução com índice completo varreu 262 e 762 arquivos e passou nos dois testes, e a busca estática deu 0 import de SDK de IA e 0 chave. Recomendação: usar `--cached --others --exclude-standard`, como já faz `investment-simple-guards.test.ts:175-178`.
- **L-03 — Paridade unilateral da fixture de visões.** `tests/fixtures/projection-mark-views.json` é gerada pelo `markViewOf` do backend por uma sonda (`sondas/gerar-fixture-visoes.cjs`) e só é lida por `tests/unit/work-time-projection-proof.test.ts:72,88`. Nenhum teste do backend confere que ele ainda produz essas visões; para as impressões esse teste existe (`projectionMarks.test.ts:124`). Hoje a fixture está atual: regenerada pelo backend da árvore final, saiu idêntica byte a byte. Uma mudança futura de `markViewOf` deixaria a fixture velha sem quebrar teste. Recomendação: um teste do backend que recalcule as visões da fixture.

### INFO

- **I-01 — Contagens desatualizadas.** `testes-substituidos.md:11` (26 → 31 declarações, 30 → 36 testes) e `matriz-requisitos.md:49` ("`work-time-consistency`, 36") são de antes dos dois testes da revisão pt-BR (M-01 e L-03). O real é 33 declarações e 38 testes, como em `testes-e-resultados.md:45`; o log tem os 38 nomes. A matriz também diz "Suíte de Rules 6/6" nas linhas de §6 e §9, mas o script oficial roda 17 (6 + 11).
- **I-02 — Marcadores.** `LEIAME.md:5` (`[[VEREDITO]]`) e `revisoes/LEIAME.md:14` (`[[GATE]]`) dependem deste gate. `matriz-requisitos.md:92` (`[[REVISOES-ESTADO]]`) não depende dele e já poderia estar preenchido.
- **I-03 — Limpeza do Emulator.** `testes-e-resultados.md:104` diz "nenhum processo órfão sobrou (`limpeza=0`)". É verdade no fim, mas a JVM do Firestore do E2E (PID 21948) ficou depois do Playwright e foi encerrada com SIGTERM pela limpeza (`emulator-cleanup.log`), com a porta 8080 livre. É comportamento conhecido do harness, sem efeito nos resultados.
- **I-04 — Asserção de 24 px retirada do spec novo.** Era `retryBox.height >= 24` (medido 20 px no `t2.log`), escrita e retirada dentro da R3, nunca parte de uma base entregue. A justificativa se sustenta:
  - o gate de acessibilidade do projeto é WCAG 2.0/2.1 A e AA (`e2e/support/axe.ts:14`), sem tamanho mínimo de alvo;
  - o pedido da R3 não exige tamanho de alvo e proíbe relaxar asserção para ocultar falha. Aqui a asserção era mais estrita que o próprio critério: a exceção de espaçamento da 2.5.8 da WCAG 2.2 é atendida (106×20 px, próximo alvo a cerca de 35 px; parecer pt-BR, I-02);
  - o botão é anterior à R3, e nenhum `.tsx` mudou.

  O spec mantém "dentro da janela" e anexa a caixa (`e2e/work-time-b03.spec.ts:447-450`). As outras asserções que falharam no `t2` ("o saldo foi convertido" e o `toContainText` de 60 s) continuam com os mesmos limiares e prazos (`:347`, `:571`, `:617`). A causa foi o alcance da escuta do Dashboard (RR-R3-04), contornado com a escolha do mês anterior.
- **I-05 — Anterior à R3, fora do delta.** O CI (`.github/workflows/quality-gate.yml:69-114`) não chama `test:unit:settings-catalog` nem `test:unit:ai-chat`, que estão no `verify:fast`. É assim desde o `HEAD`. O gate os executou.

### Sem achado

- **Testes removidos e substituídos.** Saíram 8 nomes, todos de `test:unit:work-time`. Cada um tem substituto em `testes-substituidos.md` §1.2 e §1.4, com afirmação igual ou mais forte: a aprovação por prazo, removida pelo requisito, virou "nenhum prazo aprova", com 59 s, 60 s e 3.600 s. As regras 1 a 4 de "prova: cada regra…" mantêm as mesmas asserções.
- **Guarda de privacidade.** `work-time-guard.test.ts` tira `projectionReads.ts` de duas varreduras, mas a guarda própria é mais estrita: uma transação, exatamente dois `transaction.get` e nenhum outro método; nenhuma escrita, escuta, consulta ou cache; só as duas coleções; e Rules sem escrita. A verificação de pureza ganhou padrões.
- **Contagem por consultas com dados.** `work-time-income-estimate.test.ts:496,578` passou a contar só as consultas com dados. A consulta sem janela fica desabilitada e sem dados pela chave nova com `scope`; a afirmação "uma só leitura por id viva" se mantém.
- **Página de 125 em `rebuildFence`.** O teste de 500 meses passou de páginas de 250 para 125, com as mesmas asserções. A falha intermediária foi de granularidade: o orçamento com âncoras cortou a página e o checkpoint parou em 478. O produto corta a página sozinho pelo orçamento (`rebuild.ts:804-806`). "500 escritas sim, 501 não" continua igual.
- **Caminho antigo.**
  - Nenhuma referência à regra 5 antiga (`inherentWritesOf`, `observeExcludedRead`, `pendingWriteKey`, `unappliedWrites`, `bounded`, `expired`, `projection_pending`) fora das guardas que afirmam a ausência.
  - `waitedTooLong` ficou só como estado de interface: leva a `ESTIMATE_UPDATING`, que é erro e nunca conversão, e é proibido na entrada da prova.
  - `observeDependentRead` não tem referência.
- **Falhas intermediárias.** As sete de `testes-e-resultados.md` §3 (`int-cash-1`, `rules-marcas`, `t2`, `t3`, `r3-b03-teclado`, `int-copia-marcas-f02`, `functions-unit-copia-1`) são exatamente as que aparecem nos 39 logs dirigidos de `p5f1r3/logs/`, fora mutantes e o `verify:all`. Os outros 32, inclusive builds, estão verdes. A falha da R2A (RR-R2A-04) está investigada em `rr-r2a-04.md`, com causa no cliente, correção e 7 testes determinísticos.

## 4. Skips e cobertura

| Fase | R2A (`f8267922`) | R3, executor | R3, gate |
| --- | --- | --- | --- |
| `verify:fast` | 1.687 | 1.746 (0 falha) | 1.746 (0 falha) |
| Integração e Rules | 1.256 | 1.289 (0 falha) | 1.289 (0 falha) |
| Playwright | 210 | 215 (0 falha) | 214 + 1 falha ambiental (E-01); isolado, 6/6 |
| **Total** | **3.153** | **3.250** | **3.249 + 1 ambiental** |

Nas duas execuções da R3: 0 skip, 0 todo e 0 cancelled.

**Delta de +97, só de testes novos.**
- `functions:test:unit`: +13 (`projectionMarks.test.ts`).
- `test:unit:reports`: +7 (`report-live-refresh-freshness.test.ts`).
- `test:unit:work-time`: +39, que são 47 nomes novos menos 8 substituídos: 30 de `work-time-projection-proof`, 16 de `work-time-consistency` (30 → 38) e 1 de `work-time-guard`.
- `functions:test:integration:emulator`: +16 (`projectionMarks.integration.test.ts`).
- `test:rules:projection-marks`: +17. O script é novo e está ligado a `test:integration:emulator` e ao CI.
- Playwright: +5 (`work-time-b03.spec.ts`).

Nenhum script tem menos testes que na R2A. Nenhum E2E saiu ou mudou de nome.

**Skips.** 0 em todas as fases, nas duas execuções. Não houve "no tests found" nem suíte vazia: os 40 scripts `node --test` relatam contagem positiva, e o Playwright relata 215.

**Cobertura.** O repositório não tem cobertura instrumentada (nem c8, nyc ou limiar) nem baseline versionada, e a matriz exige cobertura "quando configurada". Isso é anterior à R3. A não redução foi conferida por contagem de testes por script e por nome, e pelos mutantes mortos dos invariantes novos.

## 5. Mudanças de superfície

- **UI:** nenhum `.tsx`, `.css`, `.html` ou `.svg` mudou entre a R2A e o final.
- **Texto e comportamento:** a única mudança visível é o texto novo `ESTIMATE_UPDATING` (`src/modules/work-time/messages.ts:88`), em pt-BR e sem apontar causa (M-01). Ele aparece depois de 30 s sem prova, inclusive sem desconsideradas, no lugar de "calculando" indefinidamente, e nunca converte. A mudança é justificada pelo contrato fail-closed do B03 e aprovada pela revisão pt-BR.
- **Erros:** os novos do cliente (`projectionReads.ts`) estão em pt-BR e chegam à tela pelo texto fixo `ESTIMATE_EXCLUDED_READ_FAILED`. Os do backend chegam pela constante existente `CASH_REBUILD_CONTRACT_VIOLATION_MESSAGE`.
- **Rotas:** nenhuma.
- **Contratos, todos documentados** (`DATA_MODEL.md`, desenho, §20.18):
  - coleção nova `cash_projection_marks/{transactionId}`, só do backend, com Rules só de `get`;
  - `projectionGeneration` em `cash_report_periods`;
  - `markSlot`, `markRecoveryNeeded`, `markIssueCount`, `markIssueMaxEventTime` e `lastMarkIssue*` em `projection_state`;
  - checkpoint v3 com `markSlot`. Os checkpoints v2 deixam de valer, sem compatibilidade, como pede a regra de legado;
  - motivo de recomeço `post_cutoff_event_missed_staging`;
  - `beforeUpdateTime` no evento do gatilho;
  - `raw` em `getTransactionsByIds`;
  - `scope` na chave `by-ids`;
  - 6 isenções de índice.

  Não há callable nova nem opção de runtime alterada (parecer de plataforma).

## 6. Riscos residuais

- **Os da §20.18, aceitos e registrados:**
  - RR-R3-01: recusas permanentes sem sinal fora do produto; leitor e alerta A21 na P7;
  - RR-R3-02: tipo desconhecido é fail-closed;
  - RR-R3-03: latência do Emulator carregado;
  - RR-R3-04: escuta do Dashboard só no mês corrente e no escolhido, anterior à R3;
  - RR-R3-05: vivacidade do recomeço;
  - RR-R3-06: mudar `cashPeriodDeltaFor` ou `classifyIncomeDocument` exige versão na etiqueta e reconstrução;
  - RR-R3-07: leitura por id fora da transação;
  - RR-R3-08: impressões e chaves em memória;
  - RR-R3-09: capacidade da reconstrução e DR;
  - RR-R3-10: textos de UI.
- **Memória do harness E2E (E-01, novo, anterior à R3).**
  - **O quê:** o emulador de Functions acumula cerca de 96 a 98 workers `node`, um por função, sem remoção, e a suíte termina perto do limite de memória deste ambiente (cerca de 13,35 GiB).
  - **Impacto:** falhas aleatórias de tempo no fim do E2E, aqui e possivelmente em runners de CI com menos memória. Isso torna o gate pouco reprodutível.
  - **Mitigação sugerida:** separar o E2E em grupos com Emulator próprio, ou reiniciar o emulador de Functions entre grupos. Registrar no plano. A R3 não muda esse quadro: são 96 workers na R2A e na R3.
- **Implantação.** As isenções de índice só valem depois de publicar `firestore.indexes.json`, antes das Functions ou junto. Ambiente com dados anteriores às marcas, e restauração que não seja instantânea, exigem reconstruir antes de reabrir. Nada foi publicado.
- **Paridade da fixture de visões (L-03):** uma mudança futura de `markViewOf` não quebraria teste.
- **Guarda de SDK de IA e de segredos (L-02):** enquanto o trabalho estiver sem commit, esses dois testes não veem arquivos não versionados.
- **CI (I-05):** dois scripts unitários do `verify:fast` não rodam no CI.
- **Cobertura:** sem instrumentação, uma perda de cobertura de linha ou ramo não seria vista. Hoje a mitigação é a contagem por nome e os mutantes.

## 7. Bloqueadores para PASS

1. **Reconferência de privacidade (B-01).** O revisor de `privacy-lgpd-data-lifecycle` confere as mudanças de `PRIVACY_LGPD.md`, `DATA_RETENTION_LIFECYCLE.md` e `DESENHO-MARCAS-B03.md` (diff `3eb6041dea2e791cae0c4eaa2c1ab4bad972cba1` → árvore atual) e registra o veredito sobre a árvore de documentos final, com o hash dela.
2. **Recomendado na mesma rodada (L-01), sem bloquear sozinho.** Os revisores de observabilidade (`OBSERVABILITY.md`), escala (§9 do desenho) e segurança (`DATA_MODEL.md:140` e linha 26 de `PRIVACY_LGPD.md`) registram que as edições aplicam as suas sugestões.

Nada no código precisa mudar. A árvore de código `377c2f3f` continua valendo, com o `verify:all` verde do executor e a reexecução deste gate. A única falha desta reexecução, E-01, tem causa ambiental comprovada e passou isolada 3 de 3.

Depois da reconferência, o gate pode ser refeito só sobre o diff de `docs/`, sem nova execução, se o código continuar `377c2f3f`. Se o código mudar, tudo deve ser reexecutado.

## 8. Skills de domínio

| Skill | Exigida porque o diff toca | Veredito usado | Cobre o estado final? | Referência |
| --- | --- | --- | --- | --- |
| `financial-domain-integrity` | Projeção, marcas, reconstrução, prova | **PASS** (rodada 2, árvore `377c2f3f`) | Sim. As edições posteriores do desenho (§3 e §9) não tocam valor, delta nem prova | `revisoes/financeiro/PARECER-RODADA-2.md` |
| `multi-tenant-security-review` | Rules, leitura do cliente | **PASS** (rodada 2) | Sim para o código e as Rules. As edições INFO posteriores foram reconferidas pelo revisor de privacidade (L-01) | `revisoes/seguranca/PARECER-RODADA-2.md` |
| `firestore-scale-cost-review` | Coleção nova, índices, transação de leitura, reconstrução | **PASS** (rodada 2, final) | Sim para o código. O §9 foi editado depois, com as sugestões do revisor (L-01) | `revisoes/escala-custo/PARECER-RODADA-2.md` |
| `privacy-lgpd-data-lifecycle` | Impressões (dado pseudonimizado), retenção, eliminação | **PASS** (rodada 2) | **Não**: a condição de reconferência do próprio parecer foi acionada às 20:25:42 (**B-01**) | `revisoes/privacidade/PARECER-RODADA-2.md:19` |
| `ptbr-product-ui-review` | Texto e estado visível da estimativa | **PASS** (rodada 2) | Sim: nenhuma mudança de UI depois | `revisoes/ptbr/PARECER-RODADA-2.md` |
| `observability-incident-readiness` | Log novo, alerta A21, DR | **PASS** (rodada 2, leitura até 20:49:19) | Sim para o código. `OBSERVABILITY.md` foi editado depois, com o R2-I1 e o R2-I2 (L-01) | `revisoes/obs-plataforma/PARECER-OBSERVABILIDADE-RODADA-2.md` |
| `firebase-production-readiness` | `firestore.indexes.json`, scripts, runtime, DR | **PASS no escopo da R3** (rodada 1, mantido no anexo da observabilidade com os documentos até 20:49:19) | Sim | `revisoes/obs-plataforma/PARECER-PLATAFORMA.md` |
| Arquitetura (gatilho × reconstrução × leitura; exigida pelo pedido da R3) | Desenho B03 | **PASS** (rodada 2): 6 × 20.000 cenários, 0 violação | Sim: §4, §6 e §10 do desenho sem edição posterior | `revisoes/arquitetura/PARECER-ARQUITETURA-R3-RODADA-2.md` |
| `billing-entitlement-integrity` | Não tocada: nenhum arquivo de Stripe, planos, entitlements ou quotas no delta | Não exigida | — | — |
| `saas-commercial-readiness` | Não tocada: nenhuma superfície pública | Não exigida | — | — |
