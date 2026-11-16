# FAIL — revisão de UI de produto em PT-BR

Etapa: P5-F.1-R3 (B03 e RR-R2A-04). Revisão independente pela skill `ptbr-product-ui-review` (checklist `references/product-ui-checklist.md`), em 2026-11-09, de 18:48 a 19:10 UTC.

Abreviações: `S` = `<scratchpad>`, `WT` = `$S/wt-p5f1-r3`, `R` = `$S/p5f1r3/revisoes/ptbr`. Os caminhos `arquivo:linha` são relativos ao WT.

## 1. Escopo

- **Requisito.** Com receitas desconsideradas, a estimativa de tempo de trabalho só converte valores quando a prova pelas marcas de aplicação passa. Sem prova, os valores ficam em reais e, depois do tempo de interface (`ESTIMATE_PENDING_WAIT_MS` = 30 s), aparece `ESTIMATE_UPDATING` com "Tentar de novo". Nenhum componente React muda. A releitura do relatório do Dashboard muda de momento, não de aparência (RR-R2A-04).
- **Base e HEAD.** A base é a árvore `f82679226ec93e18f906731be09d0675326fd764`. O HEAD do WT é `1730a1df0d3870ff52496933f45cb73a8dacd29b`, com o trabalho da R3 fora do índice. A árvore revisada é `905ed3d67ecb9cdff2dfd01e81271e241809e29b`. Durante a revisão, o executor mudou só `docs/` e testes, gerando `11c4069…` e depois `90c06358acc7175be310f2c3c515066e0f97744d`. `git diff 905ed3d 90c0635 -- src e2e playwright.config.ts package.json` sai vazio, então o código revisado e o E2E executado valem para a árvore atual.
- **Delta em `src` e `e2e`.** São 12 arquivos: `src/modules/work-time/{messages,useIncomeEstimateWith,useIncomeEstimate,consistency,projectionProof,projectionReads,receivableReversal}.ts`, `src/modules/transactions/{api,incomeReads}.ts`, `src/modules/reports/{hooks,queryKeys}.ts` e `e2e/work-time-b03.spec.ts`. Nenhum `.tsx`, `.css`, `.html`, `.svg` ou `src/components/**` foi alterado. Em `package.json` mudaram só scripts de teste.
- **Telas e fluxos revisados.**
  - Configurações › Tempo de trabalho equivalente: cartão da estimativa (`EstimateSummary`), painel "Receitas consideradas" e memória de cálculo.
  - Assistente: prévia e contagem de lançamentos.
  - Aviso do topo em modo tempo (`Header`).
  - Dashboard: saldo convertido ou em reais e releitura do relatório.

## 2. Evidências do código

| Critério | Arquivo:linha | Conclusão |
| --- | --- | --- |
| Texto novo | `src/modules/work-time/messages.ts:83-87` | Única string nova visível (`ESTIMATE_UPDATING`). Ortografia, acentuação e tom estão corretos. Os termos combinam com o resto do produto: "totais oficiais" (`:82`) e "os valores ficam em reais" (`src/components/Header.tsx:537`). Problema de **precisão**: ver M-01. |
| Quando o texto aparece | `src/modules/work-time/useIncomeEstimateWith.ts:412-432` e `:455` | `waitingProof` = sem prova, sem estimativa retida, leituras prontas e o estado mostrado é "calculando". **Não depende de haver desconsideradas nem do motivo da recusa.** |
| Motivos sem relação com desconsideradas | `src/modules/work-time/consistency.ts:55-62` | Regra 2 (`projection`, `:60`) e regra 3 (`bases`, `:61`) recusam **antes** de checar `hasExclusions` (`:62`), quando há duas bases (janela de 12 meses). |
| Renderização do estado | `src/components/workTime/EstimateDetails.tsx:43-53` | Usa o ramo de erro que já existia: `div[role="alert"]` > `p.text-sm.text-on-surface` e `button` "Tentar de novo" (`linkButtonClass`, `src/components/workTime/ui.tsx:20-21`). A marcação foi confirmada no snapshot do trace (§3). |
| Aviso do topo | `src/components/Header.tsx:533-537` | `status: 'error'` mostra "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações." Texto anterior à R3, coerente. |
| Textos adjacentes no estado `error` | `src/components/workTime/IncomeEditor.tsx:46-56`, `:146` e `:202` | O painel e a contagem usam textos genéricos de erro ("A estimativa não carregou…"), e a lista exige `status: 'done'`. Ver L-01. |
| Valores em reais sem prova | `src/modules/work-time/WorkTimeContext.tsx:127-135` | `config` só existe com `done`/`ready`. Em `error`, nada converte. |
| Vazamento de detalhes internos | `src/modules/work-time/projectionReads.ts:23` e `:27`; `src/modules/work-time/projectionProof.ts:26-33`; `src/modules/work-time/receivableReversal.ts:117-124`; `src/modules/work-time/messages.ts:89-90` | As mensagens internas novas nunca chegam à tela: a falha da leitura vira `ESTIMATE_EXCLUDED_READ_FAILED` e a falha da impressão digital vira "sem prova". Confirmado pela sonda D. |
| Erros do backend | `functions/src/cash/rebuild.ts:1206-1215` | As violações novas viram `ApplicationError` com mensagem fixa. A reconstrução não tem chamador na UI (sem `rebuildCashPeriods` em `src/`). Nenhum `HttpsError` novo chega ao cliente. |
| Dashboard sem mudança visual | `src/modules/reports/hooks.ts:56-60` e `:160-176`; `src/modules/reports/queryKeys.ts:80-133`; `src/App.tsx:264-271`; `src/modules/reports/adapter.ts:775-785` | Nenhum componente mostra `isFetching` (verificado com grep). Uma falha de releitura com dado presente não troca os cartões. A mudança fica no momento da atualização. |
| Contratos de leitura | `src/modules/transactions/api.ts:160-182`; `src/modules/transactions/incomeReads.ts:73-86` | `raw` e `scope` são usados só pela estimativa (verificado com grep). Nada de UI é afetado. |
| Testes sem enfraquecimento | grep em `e2e/work-time-*.spec.ts` e `tests/unit/{work-time,report}-*.test.ts` | Sem `only`, `skip`, `fixme` ou `todo`. Os outros specs E2E, `e2e/support` e `playwright.config.ts` não mudaram. |

## 3. Evidências de execução

| Comando / teste | Viewport / interação | Resultado | Artefato |
| --- | --- | --- | --- |
| `npm run test:unit:work-time` (WT, duas vezes: árvores 905ed3d e 90c0635) | — | 211/211, 0 skipped/todo | `$R/logs/unit-work-time.log` e `$R/logs/unit-work-time-2.log` |
| `npm run test:unit:reports` | — | 107/107 | `$R/logs/unit-reports.log` |
| `npx tsc --noEmit -p tsconfig.json` (só leitura; sem `incremental`) | — | exit 0, sem diagnósticos | `$R/logs/tsc-frontend.log` |
| `flock $S/p5f1r3/wt-r3-runtime.lock bash $S/p5f1r3/run-pw.sh revisao-ptbr dejavu e2e/work-time-b03.spec.ts --trace on --output=$R/pw-out --reporter=list,json` (uma execução, build E2E novo, Emulator `minhas-financas-local`) | desktop 1280×720 e celular 375×812 (B03-b) | **5/5** (2,6 min). Valores registrados só de estados consistentes (a–e). Axe com 0 violações em desktop e celular. Sem rolagem horizontal. Letra de 14 px. "Tentar de novo" com 106,125×20 px em (33; 534,5). B03-c: 1 clique em "Tentar de novo" logo depois da reconstrução. | `$S/p5f1r3/logs/revisao-ptbr.log`; `$R/pw-report.json`; traces em `$R/pw-out/*/trace.zip`; capturas em `$R/capturas/` |
| Trace B03-b (snapshots DOM e screencast) | Configurações aberta aos 74,3 s; `ESTIMATE_UPDATING` aos ~104,8 s (30 s depois) | O topo mostra "indisponível agora… Veja o motivo em Configurações" desde ~101,5 s, enquanto o cartão ainda diz "Lendo as receitas oficiais e calculando..." (I-03). Marcação igual ao ramo de erro existente. | `$R/capturas/b03-b-desktop-1280x720-t101s-topo-indisponivel-cartao-calculando.jpeg`, `$R/capturas/b03-b-desktop-1280x720-t104s-em-atualizacao.jpeg`, `$R/capturas/b03-b-celular-375x812-em-atualizacao.png` |
| Sondas A e B (harness copiado de `tests/unit/work-time-consistency.test.ts`, imports para o `src` do WT; nada no WT foi alterado) | 12 meses, **nenhuma desconsiderada**. A: escuta ainda sem retorno do servidor. B: projeção à frente da série e releitura das bases mais lenta que o tempo de interface. | R3: `loading → error: ESTIMATE_UPDATING` em A; `loading → error: ESTIMATE_UPDATING → done` em B. | `$R/sonda/sonda-updating-sem-desconsideradas.test.ts`; `$R/logs/sonda-updating.log` |
| As mesmas sondas contra a base (`git archive f826… src` em `$R/base-arvore`) | idem | Base: só `loading` (A) e `loading → done` (B). Nunca o texto novo. | `$R/sonda/sonda-base.test.ts`; `$R/logs/sonda-base.log` |
| Sonda C | marca quebrada → "em atualização" → 1 clique e depois 3 cliques em "Tentar de novo" | O estado mostrado não muda em nenhum momento. Cada clique relê série, lançamentos e marcas (1→2, depois 2→5). | `$R/sonda/sonda-retry.test.ts`; `$R/logs/sonda-retry.log` |
| Sonda D | a transação das marcas falha antes da primeira estimativa | "Não foi possível conferir as receitas desconsideradas agora. Tente de novo.", sem erro bruto e sem conversão. "Tentar de novo" recupera. | `$R/sonda/sonda-marcas-falha.test.ts`; `$R/logs/sonda-marcas-falha.log` |

Limpeza: a JVM do Emulator desta execução (PID 4047) ficou órfã, porque a limpeza do `run-pw.sh` recusou com `ativos=2` durante o encerramento. Ela foi encerrada com SIGTERM por `$S/p5e11/stop-own-emulator.sh`, dentro do lock, com identidade e propriedade conferidas (`limpeza=0`, porta 8080 livre). Registro em `$S/p5f1r3/logs/emulator-cleanup.log`.

## 4. Comparação antes/depois

- **Componentes e estilos.** Nenhum diff em `.tsx`, `.css` ou `.html`. O estado novo usa a mesma marcação do ramo de erro anterior (`EstimateDetails.tsx:46-52`), visto no trace e nas capturas. A diferença visível é só de conteúdo e de qual ramo de estado aparece, sem mudança de layout, cor, ícone ou navegação.
- **Mudança esperada, com justificativa de estado/contrato (B03, fail-closed).**
  - Antes: com desconsideradas, a conversão podia aparecer depois da espera limitada (regra 5 antiga, removida em `consistency.ts`).
  - Agora: sem prova pelas marcas, nada converte (B03-a a e: só valores de estados consistentes) e, depois de 30 s, aparece `ESTIMATE_UPDATING` com "Tentar de novo" (B03-b).
  - O topo passa de "Calculando…" para "indisponível agora…".
- **Mudança inesperada.** O mesmo estado e o mesmo texto aparecem **sem nenhuma receita desconsiderada** (janela de 12 meses, regras 2 e 3).
  - Na base, esses casos ficavam em "Lendo as receitas oficiais e calculando..." e o topo em "Calculando…".
  - Na R3, depois de 30 s, viram `ESTIMATE_UPDATING` com uma causa que não existe, e o topo passa a "indisponível agora".
  - Evidência: sondas A e B, R3 contra base.
- **Dashboard.** Sem mudança de aparência. O saldo convertido e em reais se atualiza nos cenários B03-a, c, d e e.

## 5. Achados

### M-01 — MEDIUM (bloqueante): `ESTIMATE_UPDATING` atribui a espera às "receitas desconsideradas" em estados com outra causa, inclusive sem nenhuma desconsiderada

- **Evidência.**
  - `useIncomeEstimateWith.ts:415` aciona o texto para qualquer motivo de recusa.
  - `consistency.ts:60-61` recusa por `projection` e por `bases` antes e independentemente de `hasExclusions` (`:62`).
  - `messages.ts:87` afirma uma causa específica: "os totais oficiais ainda não confirmam as últimas alterações das receitas desconsideradas".
  - Sondas A e B (`excludedIds: []`, 12 meses) chegam a `error: ESTIMATE_UPDATING`. A base fica em `loading`.
  - Com desconsideradas, o motivo `bases` (de `consistency.ts` ou de `projectionProof.ts:348-351`) também pode vir da mudança de uma receita que não foi desconsiderada.
- **Quando acontece.**
  - Escuta sem retorno do servidor por mais de 30 s com os relatórios já lidos (rede que bloqueia o canal do Firestore).
  - Bases divergentes por mais de 30 s sem estimativa retida. Exemplos: o orçamento da escuta esgotado (`FINANCIAL_REPORT_BASIS_REFRESH`: 5 seguidas e 1 a cada 120 s, `src/modules/reports/queryKeys.ts:39-43`), mudanças contínuas que adiam a coalescência de 5 s, ou a callable lenta na primeira carga, numa troca de período ou na prévia de Configurações.
- **Impacto.** A pessoa sem nenhuma receita desconsiderada lê que "as últimas alterações das receitas desconsideradas" ainda não foram confirmadas. O texto é impreciso e enganoso sobre a causa, e leva a pessoa a procurar um problema inexistente. O checklist (§2) classifica conteúdo impreciso como FAIL.
- **Correção mínima (sem mudança visual).** Uma das duas:
  - (a) Texto neutro quanto à causa em `messages.ts:87`, por exemplo: "A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais. Enquanto isso, os valores ficam em reais."
  - (b) Restringir `ESTIMATE_UPDATING` a `needsExcluded` com motivo `projection_marks`, mantendo um texto neutro para os outros motivos.
  - Nos dois casos: atualizar `UPDATING_TEXT` em `e2e/work-time-b03.spec.ts:36` e acrescentar um teste de unidade do caminho sem desconsiderada.

### M-02 — MEDIUM (bloqueante, evidência): a prova obrigatória está incompleta na árvore final

- **E2E dos fluxos adjacentes.**
  - `e2e/work-time-p5f.spec.ts` (19 cenários de UI do tempo de trabalho) e `e2e/cash-pending-entries.spec.ts` rodaram por último em t1 (build às 17:46) e em t5/t6 (18:15–18:22).
  - Depois disso mudaram `src/modules/work-time/projectionProof.ts` (18:35, A02: recusa mais casos), `functions/src/cash/periods.ts` (18:30, gatilho da projeção) e `functions/src/cash/rebuild.ts` (18:25).
  - O registro do executor ainda tem `[[EXECUCOES]]` e `[[VERIFY]]` em aberto (`docs/production/evidence/p5f1-r3/testes-e-resultados.md` §3 e §4).
  - Esta revisão só podia executar o spec do B03, que passou na árvore final.
- **Teclado.** A sequência por teclado no estado novo ("em atualização": Tab até "Tentar de novo", Enter/Espaço, foco visível, desktop e 375 px) não foi exercitada pelo spec nem pela revisão. O checklist §5 diz que a automação não substitui essa inspeção. O risco é baixo: `<button type="button">` nativo, marcação inalterada.

### L-01 — LOW: textos adjacentes dizem "não carregou" no estado "em atualização", e o painel fica sem lista

- `IncomeEditor.tsx:146` mostra no painel "Receitas consideradas": "A estimativa não carregou, então a lista ainda não pode ser montada. Feche e tente de novo."
- `IncomeEditor.tsx:202` mostra na contagem do assistente (`WorkTimeWizard.tsx:187`, `showCount`): "Não foi possível contar os lançamentos agora: a estimativa não carregou." Fica na mesma tela do texto "em atualização".
- A lista depende de `status: 'done'` (`IncomeEditor.tsx:46-56`, consulta desabilitada sem `since`: `src/modules/transactions/hooks.ts:76`).
- Num estado persistente (marca quebrada até a reconstrução), a pessoa não consegue ver nem voltar a considerar o item. Sobra só "Restaurar padrão".
- Os textos são anteriores à R3, mas passam a aparecer porque o estado novo é modelado como `error` (`useIncomeEstimateWith.ts:455`).

### L-02 — LOW: "Tentar de novo" no estado "em atualização" não dá retorno e aceita cliques repetidos

- Sonda C: depois do clique, o texto não muda em nenhum momento, porque `waitedTooLong` só volta a `false` quando a prova muda (`useIncomeEstimateWith.ts:418-432`).
- Três cliques seguidos geram três releituras da série (callable `getFinancialReport`), dos lançamentos e das marcas (`retry`, `:248-253`).
- O padrão já existia nos outros erros de `EstimateSummary` (`EstimateDetails.tsx:50`). Aqui a condição pode persistir, e o botão parece não funcionar.

### L-03 — LOW: falta teste de regressão para a falha da leitura nova (marcas)

- `failing.marks` está definido no harness (`tests/unit/work-time-consistency.test.ts:349`), mas nenhum teste o usa.
- O mapeamento para o texto fixo em pt-BR foi provado só pela sonda D desta revisão.

### I-01 — INFO: `role="alert"` num estado que o código define como "não é falha"

- `messages.ts:84-86` define o estado como "não é falha"; `EstimateDetails.tsx:48` o anuncia com `role="alert"`.
- O resultado é um anúncio assertivo uns 30 s depois de abrir Configurações.
- A WCAG 2.1 4.1.3 é atendida. Se o estado ganhar um ramo próprio (M-01 ou L-01), `role="status"` seria o adequado.

### I-02 — INFO: alvo de "Tentar de novo" com 106×20 px no celular

- Componente anterior à R3 (`ui.tsx:20-21`).
- A exceção de espaçamento da WCAG 2.2 2.5.8 é atendida: o próximo alvo ("Salvar alterações") fica a ~35 px abaixo, conforme a captura de 375×812.
- O gate do projeto é a WCAG 2.1. Melhorar o alvo é decisão de UI fora do escopo da R3.

### I-03 — INFO: incoerência transitória entre o topo e Configurações

- As duas instâncias da estimativa têm cronômetros próprios.
- Por até 30 s, o topo diz "Veja o motivo em Configurações" (`Header.tsx:536`), enquanto o cartão em Configurações ainda diz "Lendo as receitas oficiais e calculando..." (`EstimateDetails.tsx:44`).
- Observado no trace por ~3,6 s (captura t101s).

### I-04 — INFO: estados persistentes ficam "em atualização" indefinidamente

- Casos: marca quebrada, mês sem etiqueta de geração, dado sem marca (classificados pela R3 como fora do produto, resposta A04).
- Os valores ficam em reais, nunca convertem errado.
- A volta depende da reconstrução e da escuta ou de "Tentar de novo". No B03-c, o clique foi feito logo depois da reconstrução, então a recuperação automática não foi medida.

### I-05 — INFO: Dashboard

- A primeira resposta de cada escuta (montagem, troca de mês no topo) passa a pedir uma releitura (`hooks.ts:166-171`).
- Não há efeito visual. O custo é tema de `firestore-scale-cost-review`.

## 6. Riscos residuais

- Até M-01 ser corrigido, pessoas sem receitas desconsideradas podem ver uma explicação falsa sobre a causa da estimativa indisponível. Não há impacto financeiro: os valores ficam em reais.
- Em estados persistentes (I-04), "em atualização" pode durar até uma reconstrução feita pela operação. O sinal para owner/admin fica para P7 (A04).
- As regressões em fluxos adjacentes do tempo de trabalho na árvore final não estão comprovadas por E2E até M-02 ser fechado. O risco é mitigado pelos 211 testes de unidade e pelo B03 5/5 na árvore final.

## 7. Bloqueadores para PASS

1. **M-01.** Tornar `ESTIMATE_UPDATING` neutro quanto à causa, ou restringir o estado ao motivo `projection_marks` com desconsideradas e manter um texto neutro para os demais.
   - Atualizar `e2e/work-time-b03.spec.ts:36`.
   - Acrescentar um teste de unidade do caminho sem desconsiderada (12 meses: escuta sem retorno e bases divergentes) que confira o texto exibido.
2. **M-02.** Executar na árvore final, depois da correção, e registrar:
   - `e2e/work-time-p5f.spec.ts`, `e2e/cash-pending-entries.spec.ts` e `e2e/work-time-b03.spec.ts` (ou `npm run verify:all`);
   - a sequência por teclado no estado "em atualização" (Tab até "Tentar de novo", Enter/Espaço, foco visível; desktop e 375×812).
3. **Recomendado, não bloqueante.** L-01 a L-03, com a menor mudança possível: L-01 e L-02 só se o estado ganhar ramo próprio por causa de M-01; para L-03, um teste com `failing.marks`.
