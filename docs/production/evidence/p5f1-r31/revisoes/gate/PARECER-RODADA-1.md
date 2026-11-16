PASS — regression release gate

# Gate de regressão — P5-F.1-R3.1 (R3-AUD-01), rodada 1

Revisor independente, somente leitura, em 2026-11-11, das 00:30 às 01:46 UTC. A skill `regression-release-gate` foi carregada pela ferramenta Skill, e o `references/release-checklist.md` foi lido inteiro (80 linhas) antes de validar.

Nada foi alterado no worktree, no índice real nem na configuração. As árvores foram calculadas com índice temporário próprio, em `G/tmp/`. Fora o `verify:all` oficial, as execuções rodaram numa cópia minha da árvore atual sem `docs/` (`G/sandbox/copia`, por `git archive`, com `node_modules` por link). Nada rodou em paralelo ao `verify:all`, salvo leitura de arquivos e, durante a integração, as rodadas de unidade da cópia (mutantes e prova vermelha, cerca de 4 min ao todo, sem Emulator nem portas), com a memória abaixo de 2,1 GB. Os grupos E2E do gate rodaram depois do `verify:all`, sozinhos.

Abreviações:
- `S` = `<scratchpad>`;
- `W` = `S/wt-p5f1-r31`;
- `G` = `S/p5f1r31/revisoes/gate`;
- `L` = `S/p5f1r31/logs`.

**Decisão: PASS.**
- **R3-AUD-01 eliminado.** Nenhuma conversão aparece sem prova ou com a sincronização em curso, e o prazo só muda o texto.
- **Diff limpo.** Nenhuma área proibida foi tocada, e os testes reescritos ficaram mais fortes, sem remoção nem skip.
- **Regressão completa aprovada por etapas**, todas executadas por este gate na árvore final:
  - unidade, integração, Rules, lint e builds passaram no `verify:all` oficial;
  - o E2E deu 215/216 nesse `verify:all`, com uma falha ambiental medida no mesmo teste do E-01 da R3, e 216/216 nos grupos com Emulator próprio.
- **Falhas no histórico.** Nenhuma das quatro execuções completas na árvore final terminou com saída 0, sempre por uma falha ambiental no fim do E2E. Elas ficam no histórico e elevam o RR-R31-07 a MEDIUM de processo (G-01).
- **RR-R31-05 em aberto, MEDIUM.** É compatível com o escopo desta etapa e pede etapa própria antes de publicar.

## 1. Escopo Git

| Item | Valor |
| --- | --- |
| Worktree e branch | `W`, `feat/p5-f1-r31-2026-11-10`; sem upstream, sem stash |
| `HEAD` (commit-base) | `1730a1df0d3870ff52496933f45cb73a8dacd29b`. O índice real é a árvore do `HEAD` (`3995eb7f…`), com 0 arquivos staged. A R3.1 está no diretório de trabalho, sem commit |
| Base | Árvore final da R3, `1c9155dbc8d6aedd35e6f39a63fac46b53d81919` (objeto tree). O merge-base não se aplica: a comparação é árvore com árvore. A árvore de código da R3 (`377c2f3f`), a do `verify:all` de referência, difere dela só em `docs/` (0 arquivos fora) |
| Árvore atual | `6137c2012bd755d75a94229ae9d5a3a54a52c738`, por índice temporário com `git add -A`, a mesma técnica de `tree-now.sh` |
| Árvore de código final | `d9fed573c803d64827ba278c347215054a31e0d2`: igual à atual fora de `docs/` |

**Diff `1c9155db → 6137c201`.** São 12 arquivos fora da evidência (793 inserções, 256 remoções) e 185 arquivos novos em `docs/production/evidence/p5f1-r31/`.
- **Código de produção.** Só `src/modules/work-time/useIncomeEstimateWith.ts` muda código. Em `src/modules/reports/basisSync.ts`, `src/modules/work-time/consistency.ts`, `messages.ts` e `useIncomeEstimate.ts`, a AST impressa sem comentários pelo compilador TypeScript do projeto é idêntica à da R3 (`G/sandbox/ast.cjs`).
- **Testes.** `tests/unit/work-time-consistency.test.ts`, `work-time-income-estimate.test.ts` e `work-time-guard.test.ts`; `e2e/work-time-b03.spec.ts` e `e2e/work-time-p5f.spec.ts`.
- **Documentos.** `docs/production/DATA_MODEL.md:279`; o plano mestre (linha da P5, histórico, §20.19 e duas notas de substituição nas seções históricas, sem remoção de texto); a evidência.
- **Fora do diff:** `functions/`, `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc`, `package.json`, `package-lock.json`, `playwright.config.ts`, `e2e/support/`, `.github/`, todo `.tsx` e todo estilo.

**Árvores das execuções**, comparadas com a atual fora de `docs/`:

| Execução | Árvore | Arquivos diferentes fora de `docs/` |
| --- | --- | --- |
| `verify-all-1` | `40057d2a` | 5: código anterior às revisões. O resultado não vale para a árvore final |
| `verify-all-2`, `-3` e `-4` | `b841ec69`, `9d688d9c` e `30abca0f` | 0 |
| E2E em grupos | `4e1521a6` | 0 |
| Mutantes finais | `d9fed573` | 0 |
| `gate-verify-all` (este gate) | `6137c201` | é a árvore atual |

Depois das execuções na árvore final, só mudaram arquivos de `docs/`.

## 2. Evidências

| Etapa | Comando ou inspeção | Resultado | Duração | Artefato |
| --- | --- | --- | --- | --- |
| Base e árvores | `git cat-file`, `git diff` árvore com árvore, índice temporário | Seção 1 | — | — |
| Só comentários em 4 arquivos | AST sem comentários, R3 × atual | Iguais nos 4; só `useIncomeEstimateWith.ts` difere | — | `G/sandbox/ast.cjs` |
| 1. Typecheck | `npm run typecheck`, dentro do `verify:fast` do gate: o `tsc --noEmit` da raiz, que inclui `src`, `e2e` e `tests`, e o das Functions | 0 erro | dentro do `verify:fast` | `L/gate-verify-all.log` |
| Lint | `npm run functions:lint` | 0 erro e 201 avisos, os mesmos da R3 (as Functions não mudam) | idem | idem |
| 2. Build do frontend | `npm run build` | ok; só o aviso de tamanho de chunk, anterior | idem | idem |
| 3. Build das Functions | `npm run functions:build` | ok | idem | idem |
| 4. Unitários | Os 18 scripts unitários do `verify:fast` (`functions:test:unit` e os 17 `test:unit:*`) | **1.754/1.754**; 0 falha, skip, todo ou cancelado | idem | idem |
| 5 a 7. Integração, Emulator e Rules | `npm run test:integration:emulator` (`auth` e `firestore`, projeto `minhas-financas-local`): 22 scripts | **1.289/1.289**; 0 falha, skip, todo ou cancelado. Inclui `test:rules:work-time` e `test:rules:projection-marks` | — | idem |
| 8. Playwright | `npm run test:e2e`: build E2E e `vite preview` contra o Emulator | **215/216.** Falhou `workspace-membership.spec.ts:169` (o 215º), no poll de `removed` (`:265`), por causa ambiental medida (seção 9.4). Os 25 de tempo de trabalho passaram, inclusive o B03-f (40,5 s) e a "releitura que falha" (19,9 s) | 20,2 min | `L/gate-verify-all.log`; `G/evidencia/` |
| `verify:all` do gate | `bash S/p5f1r31/verify-com-memoria.sh gate-verify-all` | **Saída 1**, só pela falha acima. Limpeza do Emulator 0; pico de 14.441 MiB (103 processos `node`) às 01:21:12, no minuto da falha; sem OOM | 42,5 min | `L/gate-verify-all.log`, `.log.meta`, `-memoria.txt` |
| 8, em grupos (gate) | `bash G/sandbox/gate-e2e-em-grupos.sh`: o roteiro do executor só com os logs renomeados para `gate-…`; os 36 arquivos em três grupos, cada um com o próprio Emulator, mesmo build e mesma configuração | **216/216**, saída 0: 68 (6,1 min), 70 (4,8 min) e 78 (11,1 min); 0 falha, flaky ou skipped. O `:169` passou (14,1 s), e os 25 de tempo de trabalho também. Pico de 10.302 MiB, sem OOM; limpeza 0 | 22,8 min | `L/gate-e2e-grupo-*.log`, `L/gate-e2e-grupos.meta`, `L/gate-e2e-grupos-memoria.txt` |
| 9. Smoke adjacente | Dentro do E2E: B03-a a B03-f (o fluxo alterado e os vizinhos), os 19 de `work-time-p5f` (Configurações, painel, assistente, estados de erro), relatórios financeiros e Dashboard (a mesma base e a mesma callable) | Verdes no `verify:all` do gate e nos grupos | — | idem |
| RR-R3-12 | `tests/unit/ai-backend-only.test.ts` com índice temporário completo (`git add -A`) | 5/5; 262 arquivos de `src` vistos, contra 228 no índice real | < 1 s | `G/logs/ai-backend-only-indice-completo.log` |
| Prova vermelha do gate | Na cópia, os 5 arquivos alterados de `src/` voltam à R3, com os testes finais | 24 de 85 falham: os 8 novos, os reescritos e a guarda | ~1 min | `G/logs/vermelho-r3-gate.txt` |
| Mutantes do gate | G1: o prazo aprova a conversão; G2: retenção por variável de módulo, fora de hooks; G3: retenção só depois do prazo | 3 de 3 mortos (14, 35 e 14 falhas); base 85/85; arquivo restaurado e conferido por SHA-256 | ~3 min | `G/logs/mutantes-gate.txt`, `G/sandbox/mutantes-gate.json` |
| `verify:all` do executor na árvore final | `verify-all-2`, `-3` e `-4`, recontados por mim nos logs completos | Saída 1 nas três: 1.754/1.754, 1.289/1.289, lint 0 erro, Playwright 215/216 | 42,9, 41,9 e 43,0 min | `L/verify-all-*.log` |
| E2E em grupos do executor | `e2e-em-grupos.sh` | 216/216 (68 + 70 + 78); os 36 arquivos, cada um num grupo só | 22,3 min | `L/e2e-grupo-*.log` |
| Reexecuções isoladas do executor | `workspace-membership.spec.ts` e B03-e, `--repeat-each=3` | 6/6 e 3/3 | 74 s e 96 s | `L/e2e-membership-isolado.log`, `L/e2e-b03-e-isolado.log` |

## 3. Achados

Nenhum achado HIGH ou MEDIUM no diff. Os achados abaixo são de processo, evidência e documentação.

- **G-01 — MEDIUM (processo, fora do diff; confirma e agrava o RR-R31-07).** Neste ambiente, o `npm run verify:all` não termina verde numa execução só.
  - Nenhuma das quatro execuções completas na árvore final de código terminou com saída 0: as três do executor e a deste gate. Em todas, há uma única falha, no fim do E2E e ambiental: três vezes o `workspace-membership.spec.ts:169` e uma vez o B03-e.
  - A unidade, a integração, as Rules, o lint e os builds passaram nas quatro, com as mesmas contagens.
  - **Impacto.** Não é regressão do produto. Mas o comando oficial do gate não passa no ambiente de referência, e o CI roda o E2E numa sessão só (`npm run test:e2e`, job `e2e` de `.github/workflows/quality-gate.yml`, com `retries: 2`), onde as novas tentativas podem mascarar o problema.
  - **Remédio**, fora do escopo da R3.1 e antes de o CI ou o gate da P5 dependerem do `verify:all`: rodar o E2E em grupos com Emulator próprio, ou reiniciar o emulador de Functions entre grupos, e tratar o G-02. Sem aumentar prazos nem repetir asserções.
- **G-02 — LOW (a causa da falha do `verify-all-3`).** O executor deixou o mecanismo como hipótese não comprovada. Conferi três fatos:
  1. o `createCashAccount` é a primeira chamada à porta 5001 desse teste: o `tokenOf` vai ao emulador de Auth (`e2e/work-time-b03.spec.ts:153-166`). Um soquete reaproveitado só poderia vir do teste anterior;
  2. no Playwright 1.60 do projeto, o `APIRequestContext` envia pelo agente HTTP global do módulo, com `keepAlive: true` (`node_modules/playwright-core/lib/coreBundle.js:7945-7946` e `:25944`), compartilhado entre os testes do mesmo processo;
  3. o firebase-tools não define `keepAliveTimeout` no servidor do emulador, e o padrão do Node 22 é 5.000 ms.

  A corrida entre um soquete ocioso reaproveitado e o fechamento dele pelo servidor é um mecanismo conhecido, que produz exatamente `socket hang up` sem o pedido chegar a ser registrado. Para o evento, continua sem prova, porque não há captura de rede.

  A atribuição ao ambiente, porém, está comprovada: o pedido não chegou à função, a falha está no preparo, antes de abrir a página, e o diff da R3.1 não tem caminho até essa chamada.

  **Remédio:** junto do G-01, no harness.
- **G-03 — INFO (fechamento pendente).** Os marcadores do veredito continuam no disco:
  - `GATE`, entre chaves duplas, no plano (`:56` e `:817`);
  - `GATE_ESTADO`, entre chaves duplas, no plano (`:5327`);
  - `VEREDITO`, entre chaves duplas, em `evidence/p5f1-r31/LEIAME.md:10`;
  - `GATE_RESULTADO`, entre chaves duplas, em `testes-e-resultados.md:66`;
  - `VEREDITO`, entre colchetes duplos, em `relatorio/RELATORIO-P5F1-R31.md:226`.

  O pacote de auditoria também não existe ainda: `empacotar.sh` não rodou, e com ele faltam o patch binário, os hashes e o ZIP que a entrega pede. A linha 15 da matriz remete ao manifesto desse pacote; este gate conferiu o mesmo pelo diff.

  **Remédio.**
  - Preencher os marcadores com este veredito.
  - Registrar a execução do gate como falha intermediária (`gate-verify-all`, saída 1, o `:169`) e, ao lado dela, os grupos do gate (216/216).
  - Gerar o pacote na árvore final, com este parecer.

  Depois disso, só `docs/` pode mudar.
- **G-04 — INFO (cobertura).** O projeto não tem instrumentação de cobertura, então uma perda de linha ou de ramo não seria vista por métrica. A mitigação é a mesma da R3: a contagem por script e por nome e os mutantes. Anterior à R3.1.
- **G-05 — INFO (relatório).** `relatorio/RELATORIO-P5F1-R31.md:152` diz "Todos de 16.086 MiB, sem swap e sem OOM", logo depois de listar o OOM do `verify-all-4`. O plano (`:5287`) e `testes-e-resultados.md` estão certos. **Remédio:** "sem swap; OOM só no `verify-all-4`".

## 4. Skips e cobertura

- **Skips.** 0 skip, todo e cancelado em todas as execuções de `node --test`, do executor e minhas. 0 `skipped` e 0 `did not run` no Playwright. Nas fontes, nenhum `.only`, `.skip`, `.fixme` ou `todo` em `e2e/`, `tests/` nem `functions/src`. O `forbidOnly` não está configurado, mas as contagens por script iguais às esperadas excluem um `.only`.
- **Contagem contra a R3** (`verify:all` de `377c2f3f`, saída 0):

  | Camada | R3 | R3.1 | Delta e explicação |
  | --- | ---: | ---: | --- |
  | `verify:fast` | 1.746 | 1.754 | +8. Dos 40 scripts, só `test:unit:work-time` muda (213 → 221): os 7 testes novos de `work-time-consistency`, um deles em duas variantes (por id e marcas) |
  | Integração e Rules | 1.289 | 1.289 | 0 |
  | Playwright | 215 | 216 | +1: o B03-f |
  | Total | 3.250 | 3.259 | +9 |

- **Nomes.** Os nomes que saíram são todos de testes reescritos no mesmo cenário: 1 em `work-time-consistency` (a N06), 9 em `work-time-income-estimate` e 1 em `work-time-p5f`. O R6-02, o R11-02 e os B03 (a) e (d) mudaram por dentro, com o mesmo nome. Cada um está em `testes-substituidos.md`. Nenhum teste foi removido.
- **Cobertura.** O projeto não tem instrumentação de cobertura configurada, como já registrado no gate da R3. A comparação é feita pela contagem por script e por nome e pelos mutantes: 12/12 dirigidos e 29/29 da R3, do executor, e 3/3 deste gate. Nenhuma redução.

## 5. Mudanças de superfície

- **UI.** Nenhum componente, `.tsx` ou estilo mudou. Muda o estado que chega aos componentes: sem prova ou com a sincronização em curso, o estado não convertido em vez da estimativa retida. Os valores ficam em reais, com os textos que já existiam ("Calculando…", "em atualização", o erro com "Tentar de novo"). É a mudança pedida (itens 2 a 5). Efeito adjacente: o painel "Receitas consideradas" e a contagem da renda ficam indisponíveis nessas janelas (RR-R31-06), porque dependem do estado pronto. A consulta do painel fica desligada com a janela nula (`src/modules/transactions/hooks.ts:76`): nenhuma leitura sem limite e nenhuma leitura a mais.
- **Textos.** Nenhum texto novo nem alterado na interface. Em `messages.ts` só mudam comentários, conferido por AST. Os textos que os E2E novos afirmam existem em `src/` desde a R3.
- **Rotas.** Nenhuma.
- **Contratos.** `holdEstimate` passa de 6 para 4 parâmetros e devolve só o estado a mostrar. Saíram `sameEstimateInputs`, `sameEstimateIdentity`, `EstimateIdentity` e `HeldEstimate`. Ninguém em `src/`, `e2e/`, `tests/` ou `functions/src` os usa: só a guarda negativa os cita, numa expressão regular. Nenhum documento Firestore, payload, índice, evento ou callable mudou.

## 6. Riscos residuais

Os RR-R31-01 a RR-R31-07 do §20.19 do plano mestre, conferidos um a um contra o código e as revisões:

| Risco | Conferência do gate | Situação |
| --- | --- | --- |
| RR-R31-01 (interface, LOW): a conversão some a cada sincronização real; na janela de 12 meses, também cerca de 30 s depois de qualquer lançamento nesta aba; aviso do topo sem região viva; foco no `body` | Confere com `holdEstimate` (`useIncomeEstimateWith.ts:118`) e com a I-01 a I-03 da revisão pt-BR | Aceito: é o comportamento pedido |
| RR-R31-02 (interface, LOW): sem conversão enquanto uma releitura de base está pendente; pior caso de cerca de 10 min na janela de 12 meses | Confere com `outOfStep` (`basisSync.ts:588-597`) e o orçamento de `queryKeys.ts:53-57`; o "Tentar de novo" relê as bases (`useIncomeEstimateWith.ts:203-208`) | Aceito; nenhum E2E mede a duração na janela de 12 meses |
| RR-R31-03 (interface, LOW): "em atualização" até a prova voltar; com a marca quebrada, até a reconstrução | Como na R3 (B03-b e B03-c), agora também quando havia uma anterior | Aceito |
| RR-R31-04 (contrato, INFO): o estado atual provado e sincronizado com o aviso imediato de leitura anterior | É a preservação do item 6 do pedido. No R3-AUD-01, uma estimativa anterior aparecia como atual, sem prova e sem aviso. Aqui é o estado atual provado, e o aviso vem na mesma renderização. Mutante A11 e E2E "releitura que falha", fase 3 | Aceito |
| RR-R31-05 (consistência; MEDIUM na financeira, LOW na adversarial; anterior à R3.1) | Seção 9.6 | Compatível com o pedido; risco **MEDIUM** em aberto, para etapa própria antes de publicar |
| RR-R31-06 (interface, LOW): painel e contagem da renda dependem do estado pronto | Confere com `IncomeEditor.tsx:46-56` e `:145-146`. Na R3, o painel usava os totais da estimativa retida, que também eram antigos | Aceito; consequência da apresentação fail-closed |
| RR-R31-07 (gate e processo, LOW; agrava o RR-R3-11) | Confirmado e agravado (G-01). Nenhuma das quatro execuções completas na árvore final terminou verde, a deste gate inclusive, e três falharam no mesmo `:169`. O B03-f, pedido pela etapa, aumentou a suíte para 216 testes | Elevo a **MEDIUM de processo**. Não muda o produto, mas precisa estar resolvido antes de o CI ou o gate da P5 dependerem do `verify:all` |

Riscos acrescentados por este gate:
- **A corrida de keep-alive no harness E2E (G-02).** Pode derrubar qualquer chamada de preparo pela API, no CI também. A mitigação vai junto da do RR-R31-07, sem repetir asserções: desligar o keep-alive nas chamadas de preparo, ou subir o `keepAliveTimeout` do emulador acima da ociosidade do agente.
- **O RR-R3-12 continua.** Até a correção, todo gate sem commit reexecuta `ai-backend-only.test.ts` com o índice completo, como feito aqui.

## 7. Bloqueadores para PASS

Nenhum para esta etapa.

Pendências de fechamento, que não condicionam este PASS:
- **G-03.** Preencher os marcadores com este veredito, registrar como execuções da etapa o `gate-verify-all` (saída 1, `:169`) e os grupos do gate (216/216), e gerar o pacote de auditoria na árvore final;
- **G-05.** Corrigir a frase de `RELATORIO-P5F1-R31.md:152`.

Antes de publicar, ou de o CI e o gate da P5 dependerem do `verify:all`:
- **RR-R31-05.** Uma etapa própria para a regra 1 servida do cache.
- **G-01 e RR-R31-07, com o G-02.** O E2E em grupos ou com o emulador de Functions reiniciado entre eles, e o preparo pela API protegido da corrida de keep-alive. Sem aumentar prazos nem repetir asserções.

## 8. Skills de domínio

A tabela do gate, aplicada ao diff:

| Superfície | Tocada? | Fundamento | Skill e veredito |
| --- | --- | --- | --- |
| Dados, cálculos, relatórios financeiros | Sim | A estimativa e a conversão derivadas da renda oficial | `financial-domain-integrity`: **PASS**, rodada 2, sobre `d9fed573` (`S/p5f1r31/revisoes/financeiro/PARECER-RODADA-2.md`; cópia fiel em `evidence/p5f1-r31/revisoes/financeiro/`). As pendências que a revisão deixou ao gate (V-02, N-01, N-02) estão resolvidas: a regressão nesta rodada, o §20.19 e a remissão em `DATA_MODEL.md:279`. Faltam só os marcadores do veredito deste gate (G-03) |
| Conteúdo renderizado | Sim | Os estados que chegam à tela | `ptbr-product-ui-review`: **PASS**, rodada 2 (`S/p5f1r31/revisoes/ptbr/PARECER-RODADA-2.md`). As pendências dela (N-01 e N-02) estão resolvidas: os riscos estão no §20.19 e a regressão nesta rodada |
| Eliminação do R3-AUD-01 | — | Revisão pedida no pedido da etapa | Adversarial: **PASS**, rodada 2 (`S/p5f1r31/revisoes/adversarial/PARECER-RODADA-2.md`), com 4 INFO |
| Queries, listeners, schema, índices | Não | Nenhuma consulta, escuta, documento ou índice mudou; `basisSync.ts` só em comentários. O único efeito indireto desliga a consulta do painel mais vezes (menos leituras) | Não exigida |
| Auth, workspaces, RBAC, Rules, callables | Não | Nada de Rules, callables, `WorkspaceContext` ou membership. Saiu a retenção por identidade: menos estado entre contas e workspaces, não mais | Não exigida |
| Billing | Não | — | Não exigida |
| Plataforma | Não | Nenhuma configuração, runtime, export ou segredo | Não exigida |
| Dados pessoais | Não | Nenhuma coleta, gravação ou envio novo; a estimativa continua só em memória | Não exigida |
| Logging e observabilidade | Não | 0 linha de `console`, logger ou evento em `src/`. O `console.log` novo é do E2E | Não exigida |
| Superfícies públicas | Não | — | Não exigida |

As três revisões avaliaram a árvore de código `d9fed573`, idêntica à atual fora de `docs/`. As cópias na evidência são fiéis aos originais: diferem só pela troca do caminho absoluto por `<scratchpad>`, conferido com `diff` depois de normalizar. A afirmação do executor sobre as superfícies não tocadas se confirma.

## 9. Auditorias pedidas pelo coordenador

### 9.1 Eliminação do R3-AUD-01

**Eliminado.** Não há caminho com conversão que não seja o estado atual, provado e com a sincronização concluída.
- **Código.** `holdEstimate` (`useIncomeEstimateWith.ts:113-118`) devolve o próprio `state` só com `proven && !settling`; um estado pronto sem prova, ou sincronizando, vira `unproven` ("calculando" ou o erro com "Tentar de novo"). Não recebe nem guarda estimativa anterior. O fim do gancho (`:363-386`) não tem outra saída pronta.
- **Consumidores.** `WorkTimeContext.tsx:127-135` deriva a conversão só de `status === 'done'` com a estimativa pronta, sem guardar a estimativa em `useRef` nem em estado. `EstimateDetails.tsx`, `IncomeEditor.tsx`, `Header.tsx`, `WorkTimeWizard.tsx` e `WorkTimeSettingsView.tsx` também não guardam estimativa: mostram o estado recebido.
- **O prazo só muda o texto.** Depois de `ESTIMATE_PENDING_WAIT_MS`, sai o erro `ESTIMATE_UPDATING`, sem conversão (`:367`, `:385`). Meu mutante G1 (o prazo devolve a atual sem prova) é morto por 14 testes; o A09 e o A12 do executor cobrem o texto e o recomeço da espera.
- **A conversão volta com a prova.** Todos os testes novos terminam com a estimativa nova provada e sem aviso. No E2E B03-f, ela volta depois da reconstrução, com a renda nova.
- **Preservado:**
  - o aviso de leitura anterior, no estado atual provado (A11; E2E "releitura que falha", fase 3);
  - o "Tentar de novo" em todos os estados de erro e de "em atualização";
  - as preferências: `WorkTimeContext`, `api.ts` e os editores não mudaram;
  - os erros e os textos existentes.
- **Retenção fora do gancho.** Minhas variantes G2 (variável de módulo) e G3 (só depois do prazo) escapam da guarda estática e são mortas por 35 e 14 testes de comportamento.
- **Prova vermelha.** Na minha cópia, os testes finais contra o `src/` da R3 falham em 24 de 85. A do E2E, conferida por hash na cópia `copia-r3-e2e` (os três arquivos da R3 e os specs finais), falha em `work-time-b03.spec.ts:671` com `Received: "tempo|≈ 808 h"`, e a "releitura que falha", em `:1081`.

### 9.2 Áreas proibidas

Nenhuma tocada. O diff não tem arquivo de `functions/` (Ledger, saldos, gatilhos, reconstrução, `projectionMarks.ts`, `cash_projection_marks`), nem `firestore.rules`, `firestore.indexes.json` ou arquivo de Billing. Também não toca os arquivos do RR-R2A-04 (`cash-pending-entries.spec.ts` e o caminho do Dashboard corrigido na R3) nem estilo algum. Em `basisSync.ts`, que é da atualização do Dashboard, a AST sem comentários é idêntica à da R3. A suíte de integração e Rules, que cobre o backend, passou inteira (1.289) nas três execuções do executor e na deste gate.

### 9.3 Testes reescritos

Conferi o diff de cada um contra `testes-substituidos.md`: 14 de unidade, a guarda e 1 E2E.
- Cada reescrita mantém o cenário (dados, falhas injetadas e sequência) e troca a afirmação da anterior na tela por `assertNoConversion` em todas as renderizações da janela sem prova, com o texto exato do erro ou do "em atualização" e o "Tentar de novo".
- As afirmações comuns aos dois contratos continuam: estado misto, valores intermediários, contagem de leituras e recuperação.
- Os auxiliares `assertLoadingOr` e `assertUpdatingOr` já existiam na R3 e são estritos: um estado pronto fora dos valores permitidos falha.
- O R8-03 ficou mais forte: antes, "nenhum total novo sem a ressalva"; agora, "só o total novo, provado e com a ressalva".
- O R9-03 passa a esperar a releitura pendente, como manda o item 2 do pedido.
- A guarda afirma a forma nova e a ausência de `HeldEstimate`, `EstimateIdentity`, `sameEstimate*`, `heldTooLong`, `heldSince`, `decision.` e `last.current`, e de `useRef`/`useState` de `IncomeEstimateState`.
- **Prazos.** Na unidade, nenhum mudou. No E2E "releitura que falha", o orçamento total passou de 240 s para 300 s pelas três fases novas, e o teste leva cerca de 20 s. As esperas de 45 s e 30 s das afirmações que já existiam não mudaram. O B03-f usa os 360 s e o laço `toPass` com "Tentar de novo" do B03-c. Não vejo prazo aumentado para esconder instabilidade.

### 9.4 Falhas intermediárias

Todas constam de `testes-e-resultados.md` (execuções 1 a 27) e do §20.19:
- os 8 vermelhos da unidade na R3 e os 2 vermelhos do E2E na cópia da R3, nas duas versões;
- a 1ª unidade depois da correção, com 210/221 (conferido no log);
- a cópia de mutantes inválida e a rodada interrompida;
- `verify-all-2`, `-3` e `-4`.

Conferi as três falhas dos `verify:all` nos logs completos.
- **`verify-all-2`, `workspace-membership.spec.ts:169`, poll de `removed` em `:265`. Ambiental, com o mecanismo medido.**
  - No `firebase-debug` da execução, o `OPTIONS` de `removeWorkspaceMember` é aceito às 22:34:06,97Z. O worker é criado a frio (`addWorker`, a única chamada dessa função no E2E) e só fica pronto às 22:34:19,17Z.
  - O `POST` termina com `outcome: ok`. A memória estava em 14,4 GB de 16 GB, com 104 processos `node`.
  - O teste passou no `verify-all-1` (16,4 s), no `verify-all-3` (13,5 s) e, isolado, 3 de 3.
- **`verify-all-3`, B03-e (`work-time-b03.spec.ts:577`). Ambiental na atribuição; o mecanismo não está provado.**
  - A falha está no preparo: `seedTenant` → `createAccountByApi` → `POST createCashAccount`, com `socket hang up`, aos 2,1 s, antes de abrir a página. O emulador não registra o pedido.
  - Nenhum código da R3.1 está nesse caminho.
  - O B03-e passou no `verify-all-1`, no `-2`, no `-4`, no grupo 3 e, isolado, 3 de 3. O B03-f, logo depois dele, passou.
  - O complemento deste gate está no G-02.
- **`verify-all-4`, o mesmo `:169`. Ambiental, comprovado pelo kernel.**
  - O `dmesg` registra "Memory cgroup out of memory: Killed process 13368 (chrome-headless)" às 00:07:33, no minuto da falha.
  - O `error-context.md` dessa falha não tem a seção "Page snapshot", que existe no do `verify-all-2`. Isso é coerente com o renderizador morto antes do clique em "Remover acesso" chegar ao servidor.
- **`gate-verify-all`, deste gate, o mesmo `:169` e o mesmo poll. Ambiental, com o mecanismo medido.**
  - No `firebase-debug.log` desta execução (trecho em `G/evidencia/firebase-debug-removeWorkspaceMember-gate.txt`), o `OPTIONS` é aceito às 01:21:08,93Z e o worker é criado a frio às 08,93. É a única criação dele no E2E inteiro.
  - Os módulos resolvem às 10,63, o `initializeApp` sai às 17,79 e o runtime fica pronto às 20,04. O `POST` é aceito às 20,44 e termina às 21,18 com `outcome: ok`: cerca de 12,2 s depois do `OPTIONS`, acima dos 12 s do poll.
  - A memória estava em 14,4 GB (pico de 14.441 MiB às 01:21:12, com 103 processos `node`). Não houve OOM: o `dmesg` só tem o das 00:07:33.
  - A página estava viva, como mostra o snapshot em `G/evidencia/error-context-gate.md`.

Nenhuma passagem posterior apaga essas falhas: elas ficam no histórico, com causa. Em nenhuma das quatro a falha veio de uma asserção sobre o comportamento do produto:
- no `:169` do `verify-all-2` e do gate, a remoção terminou, só que depois do prazo do poll;
- no do `verify-all-4`, ela não chegou a ser pedida, porque o renderizador morreu;
- no B03-e, o preparo não chegou à função.

### 9.5 Regressão completa: comando oficial e grupos

**O comando oficial não termina verde neste ambiente.** Nenhuma das quatro execuções completas do `npm run verify:all` na árvore final terminou com saída 0: as três do executor e a deste gate. Nas quatro, a única falha está no fim do E2E e é ambiental (seção 9.4). Unidade, integração, Rules, lint e builds passaram em todas, com as mesmas contagens.

**Por isso refiz a etapa E2E em grupos**, com uma cópia do roteiro do executor que só troca os nomes dos logs para `gate-…`: **216/216**, saída 0: 68 (6,1 min), 70 (4,8 min) e 78 (11,1 min); 0 falha, flaky ou skipped. O `:169` passou (14,1 s), e os 25 de tempo de trabalho também. Pico de 10.302 MiB, sem OOM; limpeza 0.

**Julgamento: a regressão completa está aprovada, por etapas, todas executadas por este gate na árvore final.**
1. **Todas as etapas passaram.** As etapas 1 a 7, o lint e os builds passaram no `verify:all` oficial deste gate. A etapa 8 passou inteira nos grupos deste gate: 216/216.
2. **Os grupos executam a mesma etapa, sem redução:**
   - os 36 arquivos, cada um num grupo só, e os 216 testes;
   - a mesma configuração (`workers: 1`, `retries: 0`; fora do CI o trace já é desligado, então o `--trace off` não muda nada);
   - o mesmo build E2E, contra o projeto `minhas-financas-local`.

   Muda só o ciclo de vida do Emulator, que é a mitigação do RR-R3-11 proposta pelo próprio gate da R3.
3. **Nenhum teste ficou sem sessão completa.** Cada um dos 216 passou ao menos uma vez numa sessão completa da árvore final: o `:169` no `verify-all-3`; o B03-e no `-2`, no `-4` e no do gate; os demais nas quatro. Uma interferência entre testes que só aparecesse numa sessão longa teria aparecido ali.
4. **As falhas das sessões completas têm causa ambiental.** Ela está medida em três casos: a partida a frio sob pressão de memória, duas vezes, e o renderizador morto pelo OOM, uma. No quarto, está comprovada na atribuição (G-02). Nenhuma passa pelo código da R3.1.
5. **A regra da skill não se aplica.** Ela proíbe emitir PASS quando o ambiente impede uma etapa obrigatória. A etapa 8 não ficou ausente nem inconclusiva: foi executada inteira e passou. O impedimento atinge só a execução numa sessão única, que é uma propriedade do harness, não do código.

**O que isso não prova**, e fica com o G-01 e o RR-R31-07: que o `npm run test:e2e` numa sessão só passe neste ambiente. É assim que o CI roda.

**A prova por partes do executor bastava?** Sozinha, não. Faltava a execução do próprio gate, que o checklist exige sempre que a etapa pode ser executada, e o mecanismo da falha do `verify-all-3` estava em aberto. Com o `verify:all` oficial do gate (etapas 1 a 7), os grupos do gate (etapa 8) e o G-02, basta.

### 9.6 RR-R31-05: a regra 1 da prova com a base do cache

**Compatível com o pedido como risco residual registrado. Não bloqueia esta etapa, mas é o principal risco em aberto e pede etapa própria antes de qualquer publicação.**
- **É outro mecanismo.** O pedido manda corrigir só o R3-AUD-01: `holdEstimate` devolvendo a última provada como `done` com `proven=false`. O RR-R31-05 tem `proven=true` pela regra 1 (`consistency.ts:56`), sobre uma base servida do cache (`staleTime: Infinity` e `refetchOnMount: false`, `basisSync.ts:153` e `:159`), antes do primeiro retorno do servidor à escuta.
- **Conferido no código.** Antes desse retorno, `projected.current` é nulo e nada é pedido (`basisSync.ts:434-438`), então `holding` é falso (`:597`). No primeiro retorno com divergência, `request` liga a espera (`:418`), e a R3.1 passa a "calculando". Na R3, a retida continuava durante a sincronização seguinte. A R3.1 reduz a exposição: não a cria nem a agrava. Os dois revisores a reproduziram nas duas árvores.
- **Corrigir muda o mecanismo.** Seria preciso mudar a regra 1 ou o estado inicial da sincronização, por exemplo tratar "escuta aberta e sem retorno do servidor" como sincronização em curso. Isso muda a volta a uma fonte, o religar e o comportamento sem rede. O pedido manda preservar o mecanismo da R3 e corrigir exclusivamente o R3-AUD-01.
- **Mas o sintoma é da mesma classe do HIGH corrigido.** Uma conversão não confirmada como atual aparece sem aviso: com rede, por fração de segundo a alguns segundos; sem rede, sem prazo. Por isso classifico **MEDIUM**, como a revisão financeira (F-02), e não LOW.
- **Leitura do pedido.** "Comportamento inseguro eliminado", no pedido, é o R3-AUD-01 descrito em "Problema reproduzido", e ele está eliminado. Este resíduo não está. Cabe à auditoria independente decidir a etapa. A direção já está registrada: `confirmed === null && !listenFailed` como sincronização em curso para a regra 1, com a escuta encerrada como hoje (RR-R31-04).

### 9.7 Demais itens

- **Produção.** Nenhuma ocorrência de `sistema-financeiro-pesso-20698` no diff, na evidência nova nem nos logs das execuções (`verify-all-1` a `-4`, grupos e `gate-verify-all`). Todas usam `--project minhas-financas-local`. Nada acessou Firebase real.
- **`deploy:*`.** Nenhum foi executado e o `package.json` não mudou.
- **Segredos.** Nenhum padrão de chave, token, chave privada ou JWT nas linhas acrescentadas, nem arquivo `.env`, de chave ou de credencial no diff. O token do Emulator está omitido na evidência. Não li `.env*`.
- **UI e pt-BR.** Nenhuma mudança visual fora do escopo e nenhum texto novo. Os textos afirmados existem em pt-BR desde a R3.
- **Pendências do fechamento (G-03).** Os marcadores do veredito e o pacote de auditoria ainda não existem. São do executor, depois deste parecer.

## Artefatos deste gate

Em `G/`:
- `PARECER-RODADA-1.md`, este parecer;
- `logs/`: `ai-backend-only-indice-completo.log`, `mutantes-gate.txt`, `vermelho-r3-gate.txt`, `gate-verify-all.console.txt` e `gate-e2e-grupos.console.txt`;
- `evidencia/`: o bloco da falha do `:169` no `verify:all` do gate (`falha-gate-membership.txt`), o `error-context-gate.md`, o trecho do `firebase-debug.log` (`firebase-debug-removeWorkspaceMember-gate.txt`, sem token) e o registro de OOM do kernel (`dmesg-oom-gate.txt`, só o das 00:07:33);
- `sandbox/`: `copia/` (a cópia sem `docs/`), `ast.cjs`, `tokens.cjs`, `tokdiff.cjs`, `contar.py`, `mutar.py`, `mutantes-gate.json` e `gate-e2e-em-grupos.sh`;
- em `L/`: `gate-verify-all.log`, `.log.meta`, `.log.status` e `-memoria.txt`; `gate-e2e-grupos.meta`, `gate-e2e-grupos-memoria.txt`, `gate-e2e-grupos-build.log` e `gate-e2e-grupo-1` a `-3` (`.log`, `.meta`, `.resumo.txt`).
