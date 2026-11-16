FAIL — Financial domain integrity

Revisão independente da P5-F.1-R3.1 (achado R3-AUD-01) pela skill `financial-domain-integrity`, feita em 2026-11-10, só com leitura. Não alterei nada no worktree nem no índice do git. As execuções e os experimentos rodaram em cópias no scratchpad, montadas por `git archive`.

- `W` = `<scratchpad>/wt-p5f1-r31`
- Árvore de antes (R3): `1c9155dbc8d6aedd35e6f39a63fac46b53d81919`. Árvore de depois (R3.1): `40057d2a78c47fea537480b0a2bc21fc46e2a500`.
- O worktree é a árvore de depois. Os 3.475 blobs dela batem com os arquivos em disco (`git hash-object` sem `-w`, conferido no início e no fim da revisão), e não há arquivo a mais em `src`, `functions/src`, `tests`, `e2e`, Rules ou índices.

**Veredito em uma frase.** O comportamento inseguro do R3-AUD-01 foi eliminado no código e os testes não foram enfraquecidos. O FAIL vem de um item bloqueante só de documentação (F-01): a referência de estado atual e um comentário de código ainda descrevem a retenção removida como vigente. Mesmo sem o F-01, ainda não caberia PASS hoje: a regressão completa na árvore final está pendente (V-01). O F-02 (MEDIUM) é anterior à R3.1, fica fora do diff e não bloqueia esta correção, mas precisa ser registrado como risco residual.

---

## Escopo (Scope)

- **Diff R3 → R3.1** (`git diff --stat`): 11 arquivos.
  - Código: `src/modules/work-time/useIncomeEstimateWith.ts`, `consistency.ts`, `messages.ts`, `src/modules/reports/basisSync.ts`.
  - Testes de unidade: `tests/unit/work-time-income-estimate.test.ts`, `work-time-consistency.test.ts`, `work-time-guard.test.ts`.
  - E2E: `e2e/work-time-b03.spec.ts`, `e2e/work-time-p5f.spec.ts`.
  - Documentos: `docs/production/evidence/p5f1-r31/{matriz-antes-depois,testes-substituidos}.md`.
- **Mudança funcional.** Ela só existe em `useIncomeEstimateWith.ts`. Em `src`, o diff tem 31 linhas acrescentadas: 27 de comentário e 4 de código (`:118`, `:363`, `:367`, `:386`). São 101 linhas removidas, e nenhum import é novo. Em `consistency.ts`, `messages.ts` e `basisSync.ts` só mudaram comentários.
- **Fluxo afetado.** A exibição de valores em BRL como tempo de trabalho equivalente, nas telas que consomem `WorkTimeContext` e na prévia de Configurações: renda elegível oficial ÷ minutos planejados.
- **Fora do diff, com hashes idênticos nas duas árvores:**
  - `functions/` (subárvore `6437cb4…`), `firestore.rules` (`133b422…`), `firestore.indexes.json` (`f4322d8…`), `storage.rules`, `firebase.json`, `package.json`, `package-lock.json` e `tests/firestore/`;
  - em `src/modules/work-time/`: `calculation.ts`, `estimate.ts`, `incomeBasis.ts`, `projectionProof.ts`, `display.tsx`, `presentation.ts` e `WorkTimeContext.tsx`;
  - os componentes `WorkTimeSettingsView.tsx`, `EstimateDetails.tsx`, `IncomeEditor.tsx` e `WorkTimeWizard.tsx`.

  Com isso, ledger, saldos, `cash_projection_marks`, gatilhos, reconstrução, Rules, índices e Billing ficaram inalterados.
- **Persistência, migração e PF/PJ.** Não há persistência nova nem migração. O comportamento PF/PJ (`allowBusinessIncome`, `workspaceType`) não mudou.

## Mapa de autoridade (Authority map)

| Figura | Fonte oficial | Quem escreve | Fronteira confiável | Na R3.1 |
| --- | --- | --- | --- | --- |
| Receita mensal (`incomeCents`) | `workspaces/{ws}/cash_report_periods/{AAAA-MM}` | Gatilho de lançamentos e reconstrução (Admin SDK) | Functions; Rules com `allow write: if false` (`W/firestore.rules:792-799`) | Inalterado |
| Marca de aplicação | `workspaces/{ws}/cash_projection_marks/{id}` | Gatilho, na mesma transação do delta, e reconstrução | Rules com `create, update, delete: if false` (`W/firestore.rules:818-822`); teste no Emulator em `W/tests/firestore/cash-projection-marks-p5f1r3.rules.integration.test.mjs:239-245` | Inalterado |
| Lançamentos lidos por id (desconsideradas e espelhos de estorno) | `workspaces/{ws}/transactions/{id}` | Callables do caixa (nos E2E, `voidCashTransaction` com `idempotencyKey`) | Rules negam `create`, `update` e `delete` (`W/firestore.rules:618` em diante) | Inalterado |
| Série e 12º mês do relatório | Callable `getFinancialReport` (leitura no servidor) | Ninguém | Servidor | Inalterado |
| Estimativa e conversão exibida | Derivadas em memória a cada renderização: `W/src/modules/work-time/useIncomeEstimateWith.ts:229-283` (estado), `:306` (prova), `:363` (apresentação); `WorkTimeContext.tsx:127-135`; `display.tsx:79`; `presentation.ts:47` | Ninguém; nada persistido | Cliente, só leitura | A R3.1 **remove** o único estado entre renderizações que guardava estimativa: o ref `last`, a identidade e `heldSince`/`heldTooLong` |

- Não há segundo escritor nem fonte concorrente. A retenção da R1 funcionava, na prática, como uma segunda fonte de exibição: a estimativa guardada no gancho concorria com a atual. A R3.1 a eliminou.
- No diff de `src`, as linhas acrescentadas não têm `setDoc`, `updateDoc`, `addDoc`, `httpsCallable`, `fetch`, `localStorage` nem import.
- Os E2E confirmam que a estimativa não grava nada: `W/e2e/work-time-b03.spec.ts:357` e `:711`.

## Semântica dos movimentos (Movement semantics)

- **Classificação.** A R3.1 não classifica, não soma e não grava movimento. A renda elegível segue sendo a receita recebida oficial de cada mês da janela (`receiptsCents`), menos as receitas desconsideradas cujo conteúdo a projeção comprovadamente contém (regra 5 e marcas). O estorno confirmado de um recebimento de cliente zera a exclusão (B01). A receita PJ só entra com `allowBusinessIncome`. O código dessas regras não mudou (`estimate.ts`, `incomeBasis.ts`, `receivableReversal.ts` e `projectionProof.ts` sem diff).
- **Efeito contábil: nenhum.** A conversão é informativa (`W/src/modules/work-time/calculation.ts:6-11`). Não afeta caixa, ativos, passivos, receita, despesa, principal, rendimento realizado nem valorização, e não entra em agregados, filtros ou relatórios.
- **Movimentos exercitados pelos testes de exibição:**
  - criação de receita (inclusive retroativa e de outra sessão);
  - edição de uma desconsiderada em outra sessão com o gatilho atrasado;
  - mudança de mês da desconsiderada;
  - anulação (nesta aba e por `voidCashTransaction`);
  - estorno de recebimento de cliente;
  - marca quebrada, evento fora de ordem e reconstrução.

## Matriz de evidências (Evidence matrix)

| Seção do checklist | Resultado | Evidência |
| --- | --- | --- |
| Representação e tempo | PASS | Centavos inteiros e BigInt, com arredondamento do meio para cima (`W/src/modules/work-time/calculation.ts:89-128`). O adaptador de reais é só de borda, limitado e sem cálculo financeiro (`:136-141`). Nenhum arquivo de aritmética mudou. A R3.1 só acrescenta comparações de estado (`useIncomeEstimateWith.ts:118`, `:367`). O tempo de 30 s é só de interface (`:368-385`), e a entrada da prova não tem relógio (guarda `W/tests/unit/work-time-guard.test.ts:485`). Não há data nova persistida. |
| Semântica financeira | PASS | Sem mudança de classificação nem de PF/PJ (arquivos sem diff). O E2E "a preferência vale em PF e PJ" (`W/e2e/work-time-p5f.spec.ts:374`) passou na execução do executor. |
| Autoridade e atomicidade | PASS (autoridade); N/A (atomicidade) | Não há escrita (ver mapa). Functions e Rules são idênticas. Não há operação composta. |
| Operações críticas e eventos | N/A (escrita); PASS (exibição sob eventos) | Não há operação crítica nova. A exibição tolera entrega fora de ordem, atraso do gatilho e duplicidade de leituras: testes "B03 (R3, b)", "(R3, a)" e "(R3, d)" e os testes da R3.1 em `W/tests/unit/work-time-consistency.test.ts:948`, `:1026`, `:1171-1349`. |
| Histórico e auditabilidade | N/A | Nenhum registro financeiro é criado, editado ou apagado, e nenhuma trilha mudou (`functions/` idêntico). |
| Fontes, totais, projeções e relatórios | PASS no diff; F-02 fora do diff | A conversão só aparece com `proof.proven && !holding` (`useIncomeEstimateWith.ts:118`, `:363`), com prova e estado calculados das mesmas entradas na mesma renderização (`:229-306`). A prova não mudou (`consistency.ts:54-73` idêntico fora do cabeçalho; `projectionProof.ts` sem diff). |
| Substituição de domínio e remoção do legado | **FAIL** (F-01) | No código, a remoção está provada por busca e por guarda (seção "Remoção do legado"). A documentação de referência (`W/docs/production/DATA_MODEL.md:279`) e o comentário `W/src/modules/work-time/useIncomeEstimate.ts:18` ainda descrevem a retenção como vigente. |
| Migração com dados reais | N/A | Nenhum dado persistido muda, e não existem dados reais de produção (política de legado do plano). |
| Testes obrigatórios | PASS no código; verificação final pendente (V-01) | Criação, edição, anulação/estorno, nova tentativa e concorrência estão cobertas em unidade e E2E (seção "Testes"). A autoridade é coberta pelas suítes de Rules no Emulator, inalteradas. Atomicidade: N/A. Execuções: unidade 221/221 e mutantes 4/4, ambos meus; E2E 25/25 do executor, numa versão que difere da final só por um `console.log`. O `verify:all` na árvore final ainda roda. |

## Resposta aos cinco pontos pedidos

1. **Autoridade no backend, sem escrita nem fonte concorrente, nada convertido persistido: sim.** As evidências estão no mapa de autoridade. O diff não toca o backend, as Rules nem os índices (hashes de subárvore idênticos).
2. **Sem prova, ou com a sincronização em curso, o resultado é reais: sim, em todos os caminhos do diff.**
   - **Mecanismo.** `holdEstimate` devolve um estado pronto só com `proven && !settling`, e esse estado é o próprio objeto da renderização (`useIncomeEstimateWith.ts:113-118`). O gancho não guarda nenhuma estimativa entre renderizações. A guarda `W/tests/unit/work-time-guard.test.ts:466-469` proíbe os símbolos da retenção e qualquer `useRef`/`useState` de `IncomeEstimateState`. O único chamador está em `:363`, e o consumidor deriva `config` na mesma renderização (`WorkTimeContext.tsx:127-135`).
   - **Prazo de 30 s.** Ele só troca `loading` pelo erro `ESTIMATE_UPDATING` com "Tentar de novo" (`:367`, `:385`) e nunca devolve estado pronto. O mutante M3 ("o prazo devolve a atual") é morto por 13 testes.
   - **Falha de rede.**
     - Leitura por id ou das marcas: `consistency.test.ts:1236-1262`.
     - Mês avulso: `:546` e `income-estimate.test.ts:849`.
     - Busca pausada sem rede: `income-estimate.test.ts:948`.
     - HTTP 500 no relatório, em E2E: `W/e2e/work-time-p5f.spec.ts:1038-1124`, com um registrador que mostra nenhuma hora do primeiro erro até a anulação.
   - **Leitura em andamento:** `consistency.test.ts:1264` e `:1326` (base relida devagar, uma base sem desconsiderada).
   - **Troca de workspace:** `:1287`.
   - **Troca de preferência:** `:1308`; troca para 12 meses em `income-estimate.test.ts:1045`.
   - **Escuta encerrada:** `income-estimate.test.ts:636`, `:676`, `:731`, `:890`.
   - **Exceção fora do diff:** F-02 (leitura única vinda do cache antes do primeiro retorno do servidor da escuta). É anterior à R3.1, a R3 se comporta igual, e a R3.1 reduz a exposição.
3. **Centavos e BigInt preservados: sim.** Ver a linha "Representação e tempo" da matriz. Nenhum ponto flutuante novo e nenhum arquivo de cálculo alterado.
4. **Testes existem e não foram enfraquecidos: sim.** A comparação entre os corpos antigos e novos está na seção "Testes".
5. **Remoção do caminho antigo provada por busca: sim no código.** Na documentação, não (F-01).

## Reconciliação (Reconciliation)

- **Fontes oficiais:** `cash_report_periods` (receita por mês, versão e etiqueta de geração), `cash_projection_marks` e `transactions` lidos por id, com o espelho do estorno.
- **Reconstrução da renda:** Σ dos `receiptsCents` dos meses da janela, menos Σ do conteúdo que a projeção comprovadamente contém de cada desconsiderada. O estorno confirmado zera a exclusão.
- **Fórmulas:** valor por hora = renda × 60 ÷ minutos; minutos = valor × minutos ÷ renda. Ambas em BigInt, com arredondamento do meio para cima (`calculation.ts:93-128`). Nada mudou.
- **Contra a contagem dupla,** sem mudança: a regra 3 (bases iguais à projeção mês a mês), a regra 4 (leitura por id depois da versão do mês) e a regra 5 (marcas no mesmo instante dos meses), em `consistency.ts:54-73`.
- **Comparação com o oficial nos testes:**
  - unidade: `assertOnly`, `assertUpdatingOr` e `assertNoConversion` sobre **todas** as renderizações (`consistency.test.ts:425`, `:806`, `:1130`);
  - E2E: `expectOnlyConsistent` e a ausência do estado inseguro (`b03.spec.ts:674`, `:708-709`), além de `incomeCents` do mês igual ao esperado depois da reconstrução, no B03-f.

## Retentativa e concorrência (Retry and concurrency)

- **Idempotência.** A R3.1 não tem escrita. A anulação usada no E2E reescrito passa pela callable do backend com `idempotencyKey` (`W/e2e/work-time-p5f.spec.ts:1087`), que não mudou.
- **Nova tentativa.** "Tentar de novo" relê série, mês avulso e desconsideradas (quando a escuta está viva) e reabre a escuta (`useIncomeEstimateWith.ts:203-208`). Os testes mostram que a nova tentativa sem a marca aplicada continua sem conversão: `consistency.test.ts:1199` e `:1236`, e o B03-f.
- **Corridas cobertas:**
  - outra sessão edita a desconsiderada com o gatilho atrasado (`:948`) ou muda o mês dela (`:1026`);
  - evento fora de ordem com a marca pendente ("B03 (R3, b)");
  - troca de workspace e de preferência com a prova pendente (`:1287`, `:1308`);
  - leitura em andamento (`:1264`);
  - base mais lenta que o tempo de interface (`:1091`, `:1326`);
  - mutação nesta aba antes do retorno da escuta (`income-estimate.test.ts:676`);
  - receita de outra sessão e de outro membro em E2E (B03-a e B03-f; `p5f.spec.ts:869`).
- **Proteção.** A decisão é recalculada a cada renderização a partir das mesmas entradas, sem estado guardado. Por isso nenhuma interleaving faz um estado pronto de outra renderização reaparecer, o que a propriedade com 20.000 passos verifica (`income-estimate.test.ts:117-145`).

## Remoção do legado (Legacy removal)

- **Busca no repositório** (fora de `node_modules`, `dist` e `lib`) por `HeldEstimate`, `EstimateIdentity`, `sameEstimateIdentity`, `sameEstimateInputs`, `heldTooLong`, `heldSince`, `decision.held`, `decision.last`, `last.current` e `lastProven`.
  - **Em código de produção: zero ocorrências.**
  - As que restam são só:
    - a guarda negativa em `W/tests/unit/work-time-guard.test.ts:466` e `:485`;
    - os registros históricos em `docs/production/evidence/` (p5f1, p5f1-r1 e p5f1-r31);
    - um falso positivo sem relação (`last.currentValueCents` em `tests/unit/investment-allocation.test.ts:144`).
- **Chamador único:** `holdEstimate` só é chamada em `useIncomeEstimateWith.ts:363`, com quatro parâmetros e sem estimativa anterior. O teste `income-estimate.test.ts:102` (`holdEstimate.length === 4`) e a guarda `:492` confirmam.
- **Rules, índices, crons e Functions:** N/A. A retenção era só do cliente, e nada no backend a servia.
- **Testes do contrato antigo:** foram substituídos no mesmo cenário (seção "Testes"). Os testes antigos rodados contra o código novo falham exatamente onde exigiam a retenção (R11-02, N06), e o arquivo `work-time-income-estimate.test.ts` da R3 não carrega porque importa os símbolos removidos (`<scratchpad>/fdi-runs/rev-r3tests-on-r31.txt`).
- **Documentação: FAIL** (F-01).

## Testes: comparação dos corpos antigos e novos

| Teste (arquivo:linha na R3.1) | R3 afirmava | R3.1 afirma | Avaliação |
| --- | --- | --- | --- |
| Três testes puros de `holdEstimate` (`income-estimate.test.ts:76`, `:105`, `:117`) | A anterior da mesma identidade vale sem prova ou durante a sincronização | Tabela-verdade completa; caso da sincronização; propriedade com 20.000 passos e mais de 1.000 prontas exercitadas | Mais forte |
| R5-02 (`:636`) | A última leitura com ressalva | Erro fixo; nenhuma conversão em todas as renderizações desde a falha; recuperação provada | Igual na recuperação, mais forte na janela |
| R6-02 (`:676`, laço "viva"/"encerrada") | `latest()` = a anterior | `latest()` sem conversão e com o estado esperado; asserção final sobre todas as renderizações mantida (`[1_056_000]`) e registro de leituras igual | Equivalente |
| R6-01 (`:731`) | Ressalva no provedor | Erro e nenhuma conversão desde a falha; reabertura e receita de outra sessão iguais | Mais forte |
| R8-03 (`:849`) | Antes da projeção, 3.550.000 | Antes, nenhuma conversão; depois, **todas** as prontas = 3.600.000 com aviso (e não vazio) | Mais forte |
| R9-01 (`:890`) e R10-03 (`:948`) | A anterior com ressalva | Erro e nenhuma conversão em todas as renderizações; estado misto e chamadas iguais | Mais forte |
| R9-03 (`:1045`) | Os 12 meses aparecem sem esperar a releitura pendente | Nenhuma conversão até a sincronização terminar; "nenhum estado misto" mantido em todas as renderizações de 12 meses | Troca de vivacidade pedida pelo item 2 (RR-R31-02 do executor); segurança mantida |
| R11-02 (`consistency.test.ts:546`) | Pronta com ressalva depois da falha | Mensagem exata e nenhuma conversão desde a falha; `assertOnly([3_600_000])` mantido | Mais forte |
| B03 (R3, a) e (R3, d) (`:948`, `:1026`) | `assertOnly([1_056_000])` | `assertNoConversion` e `assertUpdatingOr([1_086_000])` | Estritamente mais forte (o `assertOnly` antigo também passa no código novo, por ser permissivo) |
| N06 (`:1091`) | A anterior ganhava o aviso depois de 30 s | "Em atualização" com nova tentativa e nenhuma conversão; `assertUpdatingOr` sobre a janela inteira | Contrato novo; mais forte |
| Guarda (`work-time-guard.test.ts:462-492`) | A forma da retenção | Nova forma, ausência dos símbolos e de estado guardado | Mais forte |
| E2E "releitura que falha" (`p5f.spec.ts:1038`) | A hora anterior com o aviso | Quatro fases e um registrador de estados; mesmos textos, ausência de detalhe interno e recuperação | Mais forte |
| E2E B03-f (`b03.spec.ts:632`) | (novo) | R3-AUD-01 de ponta a ponta | Novo |

- **Contagem de declarações `test(`, R3 → R3.1:** consistência 33 → 40, mais um laço de 2; income-estimate 20 → 20; guarda 18 → 18; b03 5 → 6; p5f 19 → 19.
- **Sem `skip`, `only` nem `todo`.** A suíte de unidade fecha com 221/221, 0 skip e 0 todo.
- **Esperas.** Nenhuma asserção ficou mais permissiva. O orçamento total do E2E reescrito passou de 240 s para 300 s, e isso está documentado. Sobre a espera de 45 s, ver F-04.

## Achados classificados

### F-01 — LOW — bloqueante (item "documentação" da remoção do legado)

- **Cenário.** Quem consulta a referência de estado atual lê que, sem prova, a estimativa mostra a última estimativa provada da mesma identidade. É o contrato que a R3.1 removeu.
- **Evidência:**
  - `W/docs/production/DATA_MODEL.md:279`: "…sem prova, a estimativa mostra só a última provada da mesma identidade ou nenhuma conversão (fail-closed)";
  - `W/src/modules/work-time/useIncomeEstimate.ts:18`: "A lógica, a sincronização e a retenção estão em `./useIncomeEstimateWith.ts`".
- **Impacto.** Nenhum em execução. A documentação passa a contradizer o código e o contrato de segurança da R3.1. O checklist exige atualizar a documentação que ainda descreve o caminho removido como vigente, e qualquer item remanescente dessa seção reprova.
- **Remediação.** Reescrever `DATA_MODEL.md:279` com o contrato novo: sem prova ou com a sincronização em curso, nenhuma conversão; nenhuma estimativa anterior guardada nem mostrada; o tempo de interface só muda o texto. Tirar "a retenção" do comentário de `useIncomeEstimate.ts:18`. A correção é só de texto e não muda código, teste nem gate.

### F-02 — MEDIUM — fora do diff (anterior à R3.1, a R3 se comporta igual); não bloqueia esta correção

- **Cenário.** Uma base e nenhuma desconsiderada (regra 1, "leitura única"). A pessoa religa a estimativa, amplia a janela (por exemplo, de 3 para 6 meses) ou volta a uma fonte já lida na sessão.
  - A série vem do cache sem releitura, e a regra 1 aprova sem a escuta.
  - `holding` continua falso até o primeiro retorno do servidor da escuta nova.
  - Se outra sessão lançou uma receita fora do que a escuta anterior acompanhava, a conversão aparece pela renda antiga, como estado atual e sem aviso, até a escuta comparar e pedir a releitura.
  - Sem rede nesse momento, o retorno do servidor não chega (o retorno só do cache é ignorado), e o valor antigo fica até a rede voltar.
- **Evidência no código:**
  - `W/src/modules/work-time/consistency.ts:56` (regra 1);
  - `W/src/modules/reports/basisSync.ts:153` (`staleTime: Infinity`), `:159-160` (sem releitura na montagem nem na volta da rede), `:509` (retorno do cache ignorado), `:529-530` (a comparação só acontece no retorno do servidor);
  - `useIncomeEstimateWith.ts:118` e `:363`.
- **Experimentos** (cópias no scratchpad, com o mundo em memória de `work-time-consistency.test.ts`):
  - estimativa religada, com a escuta respondendo em 300 ms: a R3.1 mostra primeiro `done:1106000:false`, o valor de antes da receita de outra sessão, e depois `loading → 1136000`; a R3 mostra `1106000 → 1136000`, com o antigo também durante a sincronização;
  - troca de 3 para 6 meses com junho alterado: a R3.1 mostra `done:2162000:false` e depois `loading → 2192000`; a R3 mostra `2162000 → 2192000`.
- **Impacto.** A exibição é só informativa, e nenhum dado financeiro é afetado. Com rede, a janela é curta (até o primeiro retorno do servidor); sem rede, não tem prazo. O sintoma visível é o mesmo do B03-f: o valor atual em reais convertido pela renda anterior. A R3.1 não agrava o problema e reduz a exposição, porque tira o valor antigo da tela durante a sincronização. O R3-AUD-01 trata de `proven=false`; aqui `proven=true` pela regra 1, que não mudou.
- **Remediação** (próxima etapa, fora do escopo desta correção):
  - na regra 1, exigir que a leitura da base tenha começado depois do primeiro retorno do servidor da escuta corrente (o registro de ordem já existe em `basisSync.ts:142` e `:561-562`), ou tratar a falta desse retorno como sincronização em curso;
  - manter como está o caso da escuta encerrada (aviso imediato);
  - cobrir com testes de unidade e E2E: religar, ampliar a janela, voltar a uma fonte em cache, escuta lenta e sem rede;
  - registrar como risco residual no plano.

### F-03 — INFO — rastreabilidade da evidência do executor

- **Unidade.** O log `p5f1r31/logs/unit-work-time-2.log` (20:15:07Z) é anterior à versão final de `tests/unit/work-time-consistency.test.ts` (20:16:23Z). O nome final do teste de `:1326` não aparece nele. O log `red-r31-na-r3.log` (20:05:35Z) também traz o nome antigo.
- **E2E.** A execução dirigida (`logs/e2e-r31-work-time-1.log`, 20:39:29Z–20:45:50Z, 25/25) é anterior à versão final de `e2e/work-time-p5f.spec.ts` (20:46:26Z). Comparei as linhas alteradas: a única diferença é o `console.log` de `W/e2e/work-time-p5f.spec.ts:1115`, sem efeito em asserção.
- **Reprodução independente na árvore final:** unidade 221/221; os testes finais contra o código da R3 falham em 12 casos (os 8 novos e os 4 reescritos), pelo motivo do achado, por exemplo "mostrados: loading → 1056000".
- **Remediação.** No pacote, apontar execuções sobre a árvore final. O `verify:all` sobre `40057d2a` cobre isso.

### F-04 — INFO — precisão de `testes-substituidos.md:22`

- **Divergência.** O documento diz "Nenhuma espera de afirmação foi aumentada", mas a espera da hora nova em `W/e2e/work-time-p5f.spec.ts:1108` passou de 30 s (R3) para 45 s.
- **Por que não é enfraquecimento.** A asserção continua a mesma (`brl(hourlyAfter)`). Ela agora fica numa fase nova (receita nova, gatilho e escuta), no padrão de `:866` (45 s), embora o teste análogo de `:885` use 30 s.
- **Remediação.** Corrigir a frase ou justificar os 45 s.

### F-05 — INFO — plano mestre sem a R3.1

- **Situação.** `grep -F` não encontra "R3.1" nem "R3-AUD-01" em `docs/production/PRODUCTION_READINESS_PLAN.md`. As decisões que a R3.1 supera continuam como as últimas registradas: §20.16, linhas 4881 e 4886 (D-P5F1-R1-04) e linha 4903 (D-P5F1-R1-06).
- **Remediação.** No fechamento, registrar a decisão nova e o risco residual do F-02, como exige o CLAUDE.md. O gate de regressão confere.

### V-01 — verificação pendente (sozinha, já impede PASS nesta data)

- **Situação.** O `verify:all` sobre a árvore `40057d2a` começou às 20:47:05Z (`p5f1r31/logs/verify-all-1.log.meta`). Às 21:05Z ainda estava na integração no Emulator `minhas-financas-local`, e o E2E completo não tinha começado.
- **O que depende dele:**
  - o E2E da versão final de `work-time-p5f.spec.ts`;
  - as suítes de Rules e de integração (inalteradas, mas exigidas pela política);
  - o lint.
- Não inventei resultado: o gate deve conferir a saída 0 desse `verify:all`.

## Achados bloqueantes (Blocking findings)

- **F-01 (LOW).**
  - Invariante: a documentação não pode descrever como vigente o caminho removido.
  - Falha: `DATA_MODEL.md:279` e `useIncomeEstimate.ts:18` descrevem a retenção da R1 como atual.
  - Impacto: documentação contraditória com o contrato fail-closed da R3.1.
  - Remediação: os textos indicados no F-01.
- **V-01.** É lacuna de verificação, não defeito; pela política da skill, bloqueia o PASS até a saída do `verify:all` na árvore final.

Depois de corrigir o F-01 (só texto) e com o `verify:all` em saída 0 na árvore final, nenhum outro item do diff impede PASS. O F-02 fica como risco residual registrado, fora desta correção.

## Verificação (Verification)

As saídas ficam em `<scratchpad>/fdi-runs/`.

| Comando ou teste | Árvore | Resultado |
| --- | --- | --- |
| Conferência dos blobs com `git hash-object` sem `-w` | worktree × 40057d2a | 3.475/3.475, no início e no fim |
| `git diff --stat` e `git rev-parse` de `functions`, `firestore.rules`, `firestore.indexes.json` e `tests/firestore` | 1c9155d → 40057d2a | Sem mudança |
| `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test` com os 10 arquivos de `test:unit:work-time` | Final (W) | 221/221, 0 fail, 0 skip, 0 todo, 29 s (`unit-work-time.txt`) |
| `npx --no-install tsc --noEmit -p tsconfig.json` (sem `incremental`; não grava nada) | Final (W) | Saída 0, 0 erro (inclui `src`, `tests` e `e2e`) |
| Testes finais da R3.1 sobre o código da R3 (cópia `fdi-red`) | R3 + testes R3.1 | Consistência: 12 falhas (8 novos e 4 reescritos); o R3-AUD-01 falha com "mostrados: loading → 1056000" depois das premissas satisfeitas (`red-consistency.txt`) |
| Testes da R3 sobre o código da R3.1 (cópia `fdi-rev`) | R3.1 + testes R3 | Falham só os que exigiam a retenção (R11-02, N06) e o arquivo que importa os símbolos removidos; as guardas de varredura falham por a cópia ser parcial, sem `functions/` (`rev-r3tests-on-r31.txt`) |
| Mutantes dirigidos (cópia `fdi-mut`, restaurada; hash `24e9c2b…` conferido) | R3.1 | 4/4 mortos: sincronização ignorada (6 falhas), prova ignorada (36), o prazo devolve a atual (13), "em atualização" só sem prova (1) |
| Experimentos do F-02 | R3.1 e R3 | Descritos no F-02 |
| Evidência do executor (dados conferidos) | — | E2E dirigido 25/25 (difere da final por um `console.log`); vermelho na R3: B03-f com "Received: 9" `[data-work-time]` e saldo "≈ 808 h" a R$ 25,00/h; p5f sem o erro esperado; mutantes 11/11 e 29/29 |
| `verify:all` (executor) | 40057d2a | **Pendente** (V-01) |

Cobertura por tipo de operação, em unidade e E2E no Emulator `minhas-financas-local` (`W/e2e/support/workspaceSeed.ts:35-45`):

- **Criação:** B03-f (`b03.spec.ts:632`) e `p5f.spec.ts:848` e `:869`; unidade `consistency.test.ts:1171` e `:1326`.
- **Edição:** B03-a (`b03.spec.ts:325`); unidade `consistency.test.ts:948` e `:1026`.
- **Anulação e estorno:** `p5f.spec.ts:1038`, `:1126` e `:1298` (B01); unidade `income-estimate.test.ts:676` e `:1045`.
- **Nova tentativa:** `p5f.spec.ts:999`, `:1038` e `:1204`, e B03-f; unidade `consistency.test.ts:1199` e `:1236`.
- **Concorrência** (outra sessão ou membro, evento fora de ordem, troca durante a prova pendente): B03-a, B03-f e `p5f.spec.ts:869`; unidade `consistency.test.ts:948`, `:1287` e `:1308`.
- **Autoridade:** `tests/firestore/cash-projection-marks-p5f1r3.rules.integration.test.mjs:239-245`, inalterado e rodando no `verify:all`.
- **Atomicidade:** N/A, porque não há escrita.

**Veredito: FAIL — Financial domain integrity.**

- F-01: LOW, bloqueante, documentação.
- F-02: MEDIUM, fora do diff, anterior à R3.1.
- F-03, F-04 e F-05: INFO.
- V-01: verificação final pendente.
