PASS — Financial domain integrity

# P5-F.1-R3.2: parecer de integridade financeira (Frente A, RR-R31-05)

- **Revisão:** independente e somente leitura sobre a worktree, com a skill `financial-domain-integrity`. Li o `SKILL.md` e o `references/integrity-checklist.md` inteiros.
- **Base:** R3.1, árvore `efcbd2645b8e7b08b5add2812f6b319f4a76369b`.
- **Sob revisão:**
  - `ca11bacad38c78020eadfc310fae847190222b59`, por instrução do coordenador; substituiu a `6d28cf98`, que também conferi;
  - a árvore de código final, `93668199c4d5a57a41308dd08383afd7c2245b00`.
- **Equivalência das duas:** de `ca11baca` para `93668199` mudam só o `README.md`, o `docs/production/RUNBOOKS.md` e um comentário de `playwright.config.ts`. O diff em `src/`, `tests/`, `e2e/`, `functions/`, `firestore.rules` e `firestore.indexes.json` tem 0 bytes ([diff-stat-ca11-9366.log](logs/diff-stat-ca11-9366.log)). O parecer vale para as duas.
- **Pasta:** `<scratchpad>/p5f1r32/revisoes/financeiro`. Todo caminho relativo abaixo parte dela.

## 1. Veredito

**PASS.** Os oito pontos do pedido estão confirmados por código, testes e execução.

- **Contrato.** Fora do estado sem bloco exato, que não converte nada, nenhuma estimativa pronta chega à tela sem duas condições:
  - a projeção confirmada por um retorno do servidor à escuta da própria montagem, para a mesma conta, o mesmo workspace e os mesmos meses;
  - a base igual a essa projeção em todos os meses da janela.

  Vale para toda janela, com uma base ou duas, com ou sem desconsiderada.
- **Remoção do atalho.** O atalho da "leitura única" (`multipleBases`) foi removido. Ele só aparece nos testes que provam a ausência dele.
- **Falta de confirmação.** O retorno só do cache local (sem conexão) e a escuta encerrada zeram a confirmação.
- **Tempo e releituras.** Nenhum prazo e nenhuma quantidade de releituras aprovam a conversão.
- **Testes.** Os testes novos reprovam na R3.1 pelo motivo certo e passam na árvore final. Os testes substituídos não foram enfraquecidos.
- **Mutantes.**
  - Do executor: 16/16 mortos.
  - Meus: 14 de 15 mortos pela suíte de comportamento existente (§9).
  - O único que sobrevive, R15, só suprime conversão, nunca a produz. É uma lacuna de fidelidade do mundo simulado, coberta pelo E2E B03-g com o SDK real (F-06).
- **Escopo do diff.** Não há escrita nova. Valores, Functions, Rules e índices não mudaram.
- **Achados.** Nenhum é bloqueante. O único LOW é anterior à R3.2 e fica fora do RR-R31-05: a virada do mês (§13). Os INFO são reforços de teste e de defesa em profundidade, mais uma observação de processo sobre a execução oficial (F-07).

O PASS cobre o domínio financeiro da mudança R3.1 → R3.2. Ele não substitui o `verify:all` oficial, que o pedido exige para encerrar a etapa e é tarefa do `regression-release-gate`. Na `93668199` ainda não há `verify:all` oficial verde. A `verify-all-r32-2` terminou com saída 130, interrompida por SIGINT (§14, F-07). Nela, só o `verify:fast` passou inteiro.

## 2. Escopo conferido

- **O que mudou no código** ([diff-src-r31-9366.patch](logs/diff-src-r31-9366.patch)). Fora os comentários, são seis linhas:
  - [`basisSync.ts:511-517`](copia/src/modules/reports/basisSync.ts#L511): `if (snapshot.fromCache) return;` passou a `if (snapshot.fromCache) { setConfirmed(null); return; }`;
  - [`consistency.ts:38-78`](copia/src/modules/work-time/consistency.ts#L38): saem o campo `multipleBases` e a regra `if (!input.multipleBases && !input.hasExclusions) return { proven: true };`;
  - [`useIncomeEstimateWith.ts:289-307`](copia/src/modules/work-time/useIncomeEstimateWith.ts#L289): o gancho deixa de passar `multipleBases`, e `needsExtra` sai das dependências do `useMemo`.
- **Arquivos lidos inteiros na árvore final:**
  - `consistency.ts`, `useIncomeEstimateWith.ts`, `basisSync.ts`, `basisRefresh.ts`, `basisRegistry.ts`, `queryKeys.ts` e `estimate.ts`;
  - `subscribePeriods` e a virada do mês em `hooks.ts`;
  - `WorkTimeContext.tsx` e o uso da estimativa no `Header.tsx`.
- **Inalterados** (diff vazio): `projectionProof.ts`, `holdEstimate`, `functions/`, `firestore.rules` e `firestore.indexes.json`.
- **Fluxos afetados:** só a apresentação. É a decisão de exibir ou não a conversão de valores em tempo de trabalho equivalente (valor da hora = Σ renda elegível ÷ Σ horas planejadas). A decisão vale no provedor (`WorkTimeContext.tsx:118-135`), na prévia de Configurações e no assistente, todos por `useIncomeEstimate`.
  - Nenhum outro módulo calcula ou prova a estimativa. A busca por `computeWorkTimeEstimate|proveEstimateConsistency|useIncomeEstimateWith` em `src/` só acha o próprio gancho.
  - A conversão só nasce de `estimate.status === 'done' && estimate.estimate.status === 'ready'` (`WorkTimeContext.tsx:127-135`; `Header.tsx:45-50`).
- **PF/PJ:** sem mudança. A fonte PJ continua exigindo `allowBusinessIncome` (`estimate.ts:159-162`). O E2E "a preferência vale em PF e PJ" e o da escuta encerrada (espaço ativo PJ, renda do PF) estão verdes.

## 3. Mapa de autoridade

| Figura | Fonte oficial | Escritores | Fronteira confiável |
| --- | --- | --- | --- |
| Receita por mês da janela (`incomeCents`) | `workspaces/{ws}/cash_report_periods/{AAAA-MM}` | Só o gatilho `onTransactionWrite` e a reconstrução, ambos pelo Admin SDK | Rules `allow write: if false` (`firestore.rules:792-799`) |
| Base da estimativa (série 12m e, em 12 meses, o 12º mês) | Callable `getFinancialReport`, que lê a projeção (`functions/src/reports/cash.ts:106-120, 172-185`) | Nenhum: é leitura | O servidor confere membership a cada chamada |
| Lançamentos que alimentam `incomeCents` | `transactions` | Callables de caixa (criação, correção, confirmação, importação) e recebíveis; detalhe no §7 | Rules `create, update, delete: if false` (`firestore.rules:618-621`) |
| Desconsideradas e marcas de aplicação | Leitura por id (`getTransactionsByIds`) e `readProjectionMarks` (transação só de leitura) | Inalterados na R3.2 | Inalterada |
| Confirmação do servidor (`confirmed`) | Retorno `fromCache: false` da escuta `onSnapshot(..., { includeMetadataChanges: true })` (`hooks.ts:80-99`) | Estado React em memória, sem persistência | Zerado na escuta nova (`basisSync.ts:505`), no retorno do cache (`:515`) e no erro (`:545`). Só vale com a mesma chave conta+workspace+meses (`:395, :609`) |
| Estimativa e conversão | Derivadas em memória (`useIncomeEstimateWith.ts:232-288`) | Nenhum: nada é gravado | O E2E B03-g confere que a preferência não foi regravada |

Nenhuma fonte concorrente foi criada. A R3.2 não introduz escritor novo, nem do cliente nem do backend.

## 4. Semântica dos movimentos

- **O que entra na base:** só `incomeCents` da projeção, a "receita" operacional.
  - Lançamento `receita` confirmado e não anulado (`functions/src/cash/periods.ts:270-360`, ramo `type === "receita"` em `:342`).
  - Principal de recebimento de cliente; o estorno compensa com sinal oposto (`functions/src/receivables/cashEffect.ts:90-100`).
- **O que fica fora:** principal de empréstimo, fluxos de investimento (aporte, principal resgatado), rendimento e juros (receita financeira), pagamento de fatura e reembolso da divisão de contas. Os efeitos de cada um estão em `loans/cashEffect.ts:82-108`, `investments/cashEffect.ts:102-120`, `cards/cashEffect.ts:75-83` e `splitBills/cashEffect.ts:71-77`.
- **Classificação:** está correta para "renda" e não mudou. A R3.2 não altera classificação, sinal, regra de inclusão nem moeda.
- **Desconsideradas:** são tiradas só do próprio mês, e só com a prova das marcas (regra 5, inalterada). Não há dupla contagem nova.

## 5. Os oito pontos do pedido

1. **Nenhuma estimativa pronta sem a confirmação, em toda janela.**
   - Código:
     - [`consistency.ts:60-67`](copia/src/modules/work-time/consistency.ts#L60): carregando → sem bloco exato (indisponível) → `projection === null` → divergência → sem desconsiderada;
     - [`basisSync.ts:609`](copia/src/modules/reports/basisSync.ts#L609): a confirmação só vale com a chave da montagem;
     - [`useIncomeEstimateWith.ts:302, 367`](copia/src/modules/work-time/useIncomeEstimateWith.ts#L367): `projection: confirmed` e `holdEstimate`.
   - Testes: o laço `WINDOWS` ([`work-time-consistency.test.ts:1664-1692`](copia/tests/unit/work-time-consistency.test.ts#L1664)) cobre 1, 3, 6 e 12 meses e o mês corrente, com e sem desconsiderada. O laço pula "mês corrente com desconsiderada no próprio mês"; meu T4 cobre esse caso (§8).
   - Troca de janela na mesma montagem, citada no RR-R31-05 ("ao ampliar a janela"): coberta pelos meus T1 (3 → 6) e T2 (6 → 1), que reprovam na R3.1 e passam na final.
2. **Os dez cenários:** cada um tem teste próprio, que reprova na R3.1 (§6).
3. **Tempo e releituras não provam nada.**
   - O tempo de interface (30 s) só troca o texto ([`useIncomeEstimateWith.ts:371-389`](copia/src/modules/work-time/useIncomeEstimateWith.ts#L371)).
   - O mutante R03 (passado o prazo, mostra a estimativa) morre em 18 testes.
   - As releituras param em `BASIS_DIVERGENCE_RETRIES = 2` (`basisRefresh.ts:76, 84-96`). A divergência continua reprovando a prova ([`consistency.ts:66`](copia/src/modules/work-time/consistency.ts#L66)).
   - Testes: o `:1627` (10 min no relógio da estimativa e 30 min na hora do servidor) e o meu T3, nos dois sentidos e no mês corrente.
   - Mutantes: o R04 (as releituras esgotadas viram aceitação) morre; N03 e N04 (executor) também.
4. **O estado indisponível sem bloco exato aparece como está.**
   - Código: [`consistency.ts:63`](copia/src/modules/work-time/consistency.ts#L63). `basis.exact` falso implica `reportExact` falso, que dá `report_unavailable` sem conversão (`useIncomeEstimateWith.ts:162` × `:248-251`; `estimate.ts:164-166`).
   - Teste: o `:1651` passa na R3.1 e na final.
   - Mutantes: N07 e N08 (executor) mortos.
   - Os demais motivos de indisponível ficam no INFO F-02.
5. **Marcas financeiras e R3-AUD-01 preservados.**
   - `projectionProof.ts` não mudou. As regras 4 e 5 em [`consistency.ts:67-77`](copia/src/modules/work-time/consistency.ts#L67) são as mesmas da R3.1 (`:61-71` lá). `holdEstimate` ([`useIncomeEstimateWith.ts:116-121`](copia/src/modules/work-time/useIncomeEstimateWith.ts#L116)) também não mudou.
   - Mutantes mortos: R10 (sem prova, volta a última provada: o R3-AUD-01), R11 (regra 5 removida), R12 (regra 4 relaxada) e R14 (`holdEstimate` ignora a sincronização).
6. **Mês corrente e D-29:** garantido pelo backend (§7).
7. **Centavos inteiros, nenhuma escrita nova e nada gravado.**
   - O diff de `src/` não tem API de escrita, armazenamento nem aritmética; busca por `setDoc|updateDoc|addDoc|writeBatch|runTransaction|httpsCallable|localStorage|toFixed|parseFloat|Math.round|/ 100` em [diff-src-r31-9366.patch](logs/diff-src-r31-9366.patch).
   - `functions/`, Rules e índices têm diff vazio. A estimativa segue inteira (`estimate.ts:142-246`).
8. **Testes.**
   - Os novos reprovam na R3.1 e passam na final (§6, §8).
   - Os substituídos não foram enfraquecidos (§8).
   - Mutantes: 16/16 do executor mortos ([mutantes-cliente-r32.log](../../logs/mutantes-cliente-r32.log)). Dos meus 15 ([mutantes-revisor.log](logs/mutantes-revisor.log)), 14 morrem pela suíte existente. O R15 sobrevive na unidade e só suprime conversão (F-06).

## 6. Matriz dos dez cenários

Os números entre parênteses são os do TAP na execução dos testes da árvore final com o `src/` da R3.1: [vermelho-testes-r32-em-src-r31.log](logs/vermelho-testes-r32-em-src-r31.log), 20 de 85 reprovam. É a mesma lista do `red-r32-na-r31-2.log` do executor.

| # | Cenário | Teste na árvore final | R3.1 | Final |
| --- | --- | --- | --- | --- |
| 1 | Cache aquecido antes do 1º retorno do servidor | `work-time-consistency.test.ts:1464` (2 variantes: sem e com receita nova de outra sessão com a tela fora) | reprova (43, 44: `'done' !== 'loading'`) | passa |
| 2 | Volta à página e remontagem | `:1464` (`warmCache`: desmonta e remonta no mesmo `QueryClient`), `:1513` (prévia ao lado do provedor), E2E `work-time-b03.spec.ts:729` (B03-g, prévia reaberta) | reprova (43, 44, 46). O B03-g vermelho para antes, na queda de conexão, então a parte da prévia reaberta tem prova vermelha só na unidade | passa |
| 3 | Reativação do modo tempo de trabalho | `:1529` | reprova (47: mostrou 1106000 religada) | passa |
| 4 | Troca de workspace (fonte da renda) | `:1548` | reprova (48: ws-a do cache) | passa |
| 5 | Sem conexão | `:1569` (remonta sem conexão), `:1588` (a conexão cai com a estimativa na tela), E2E B03-g | reprova (49, 50; B03-g: "sem conexão, o saldo em reais") | passa |
| 6 | Escuta encerrada com erro | `:529` (encerrada desde o começo), `:1610` (encerrada com a estimativa na tela), E2E `work-time-p5f.spec.ts:1230` | reprova (8, 51 "com aviso"; p5f: o topo seguia "…ela usa a leitura anterior") | passa |
| 7 | Divergência persistente depois das releituras | `:1627` (base acima da projeção); meu T3 (base abaixo; mês corrente com série abaixo, como uma D-29 violada) | reprova (52; T3: 1076000 e 80000 mostrados) | passa |
| 8 | Janelas de 1, 3, 6 e 12 meses (e mês corrente) | `:1664-1692` (laço `WINDOWS`) | reprova sem desconsiderada em 1, 3 e 6 meses e no mês corrente (54, 56, 58, 62). "Com desconsiderada" e 12 meses já eram protegidos na R3.1 e passam lá (55, 57, 59, 60, 61), como regressão | passa |
| 9 | Com e sem desconsiderados | laço `WINDOWS` (com/sem por janela), `:85` e `:119` (prova pura); meu T4 (mês corrente com desconsiderada no próprio mês) | "sem" reprova; "com" já era protegido (T4 passa na R3.1) | passa |
| 10 | Volta à conversão depois da confirmação válida | asserção positiva final de cada teste acima (`publish`, `goOnline`, "Tentar de novo" → o valor certo, com `assertLoadingOr`, `assertUpdatingOr` ou `assertOnlyWithoutConversionOr` em todas as renderizações); E2E B03-g (a conexão volta → R$ 25,00 e o saldo convertido); E2E p5f:1230 (reabertura → "Valores em tempo de trabalho equivalente…" e o saldo convertido antes da receita retroativa) | n/a (vem depois do ponto vermelho) | passa |

Também reprovam na R3.1 a prova pura (`:85`, `:119`, `:140`) e os guardas por regex (`work-time-guard.test.ts:345`, que exige o `setConfirmed(null)` no retorno do cache, e `:759`).

**Motivo de cada reprovação** (extraído do TAP): estimativa `done` exibida sem o retorno do servidor, divergente ou com a escuta encerrada, ou o código antigo no guarda. Nenhuma reprovação veio de motivo acidental.

**Provas E2E.** Usei os logs do executor, porque não pude rodar E2E.

- **Paridade das árvores** ([diff-arvores-e2e-vs-ca11.log](logs/diff-arvores-e2e-vs-ca11.log)):
  - `0f1b9320` (B03 a–f): o `src/` é idêntico ao final;
  - `059cec04` (B03-g verde): `src/` e o spec são idênticos ao final;
  - `ff1aa360` (p5f 19/19): `src/` e os specs são idênticos (muda só o README e um comentário).
- **Provas vermelhas:**
  - as cópias usadas têm os três arquivos de `src/` da R3.1 e os specs finais (conferido byte a byte);
  - o B03-g reprova em "sem conexão, o saldo em reais";
  - o p5f:1230 espera "Estimativa de tempo de trabalho indisponível agora…" e recebe "Valores em tempo de trabalho equivalente… ela usa a leitura anterior".
- **Execução descartada:** a `e2e-p5f-r32-1` é inválida (o `dist/` estava errado, segundo o coordenador).

## 7. Reconciliação e D-29 (mês corrente)

- **Fórmula.**
  - Mês completo: o `receiptsCents` da série é o `incomeCents` do documento mensal.
  - Mês corrente (parcial): o `receiptsCents` é a soma dos dias até a data de referência (`functions/src/reports/cash.ts:106-120`), e a projeção traz o mês inteiro.
  - A prova exige igualdade mês a mês na janela, com mês sem documento valendo 0 (`basisRefresh.ts:49-53`).
- **D-29 garantida pelo backend:** nenhum caminho grava receita confirmada com data futura.
  - Caixa, criação, correção e importação: `cashEntryDateSchema` e a `settlementRule` recusam `date > saoPauloDayKey()` no confirmado (`functions/src/cash/contracts.ts:81-83, 150-197`). A correção usa a mesma regra (`:275-285`) e a importação usa `cashEntryDateSchema` (`:380-395`).
  - Caixa, confirmação de pendente: `date: cashEntryDateSchema` (`:310-318`).
  - Recebível: `paymentDate: pastDaySchema` (`functions/src/receivables/contracts.ts:95-97, 238`). O estorno usa a data do recebimento original (`receivables/operations.ts:808-830`).
  - Recorrentes: grava só `despesa` (`functions/src/recurring/facts.ts:222`), com `paidDate` até hoje (`recurring/contracts.ts:273-275`). Empréstimo, divisão, cartão e investimento não alimentam `incomeCents` (§4).
  - O cliente não escreve em `transactions` nem em `cash_report_periods` (Rules, §3). Os agendadores (`crons/`) não confirmam receita.
- **Execução dos esquemas compilados** ([d29-esquemas.log](logs/d29-esquemas.log), com `functions/lib` da worktree; `functions/src` não muda entre R3.1 e a final):
  - receita confirmada amanhã é RECUSADA na criação, na correção (com e sem `status`), na confirmação, na importação e no recebimento de recebível;
  - a de hoje é ACEITA.
- **Testes de backend existentes:**
  - criação: `d29Contracts.test.ts:84-110` e `createTransaction.integration.test.ts:351`;
  - confirmação: `d29Contracts.test.ts:183-215`;
  - importação: `importTransactions.integration.test.ts:183`;
  - recebível: `receivableContracts.test.ts:160`.

  No `verify:fast` oficial, `functions:test:unit` deu 677/677. A correção não tem caso explícito (INFO F-05).
- **Se a D-29 fosse violada:** o resultado é fail-closed, sem conversão (meu T3, mês corrente com a série R$ 200,00 abaixo da projeção). A conversão errada não aparece; só a disponibilidade sofre.

## 8. Testes substituídos ou ajustados: nada enfraquecido

Comparei cada um com a R3.1. A contagem de testes por arquivo nunca cai, e nenhum título some sem substituto:

| Arquivo | R3.1 | Final |
| --- | --- | --- |
| `work-time-consistency` | 40 | 51 |
| `guard` | 18 | 19 |
| `b03` | 6 | 7 |
| `p5f` | 19 | 19 |

- **Prova pura** (`:85`, `:119`, `:140`).
  - O caso "uma base, nenhuma desconsiderada, `projection: null`", que esperava `'provada'`, passou a esperar `'projection'`; a mudança de contrato pedida é esta.
  - O caso `multipleBases: true, projection: null` → `'projection'` ficou coberto pelo mesmo caso sem o campo, que não existe mais. O caso com projeção presente → `'provada'` continua, sem o campo.
  - Entraram asserções novas:
    - sem bloco exato, com e sem desconsiderada → provada;
    - divergência sem desconsiderada → `'bases'` (dois casos);
    - um campo antigo `multipleBases: false` não dispensa a projeção.

  Ficou mais forte.
- **`B03` da R3.1 em `:472`, agora `:529`.**
  - Antes afirmava a conversão "com a ressalva" com a escuta recusada.
  - Agora afirma `assertNoConversion` em todas as renderizações, a mensagem `ESTIMATE_UNCONFIRMED_FAILED` e, depois do "Tentar de novo", a estimativa provada sem aviso.

  A afirmação antiga é o defeito; a nova é mais forte.
- **Teste renomeado `:1416` ("provada, mas com a sincronização em curso").** Só o título e os comentários mudaram: o diff de 47 linhas contra a R3.1 não tem asserção diferente ([r31-teste-1330.txt](logs/r31-teste-1330.txt) × [r32-teste-sinc.txt](logs/r32-teste-sinc.txt)). Para uma base, a prova agora também falha durante a releitura, e o teste deixou de isolar a retenção. A retenção continua coberta: o mutante R14 morre.
- **Teste "mudança da preferência com a prova pendente".** Só o comentário mudou.
- **Guarda `work-time-guard.test.ts:420`, antiga 418.**
  - Antes: `if (snapshot.fromCache) return;` seguido de `noteServerSnapshot` e `reopenFailedListeners`.
  - Agora exige `{ setConfirmed(null); return; }` e mantém a mesma sequência depois. Ficou mais forte.
- **Infraestrutura do mundo simulado.** Os campos `offline`, `basisSkew` e `seriesStatus`, o `fromCache` em `snapshot()`, o `client` e o `unmount` em `mount` e os `extraRenderers` no `afterEach` são aditivos. Os valores padrão reproduzem o comportamento anterior: inclinação vazia, `'exact'`, `fromCache = false` com `changes = documents.length`.
- **E2E `work-time-p5f.spec.ts:1230`, reescrito na `ca11baca`** ([e2e-p5f-escuta-r31.txt](logs/e2e-p5f-escuta-r31.txt) × [e2e-p5f-escuta-r32.txt](logs/e2e-p5f-escuta-r32.txt)).
  - Antes afirmava o aviso de leitura anterior com a escuta encerrada, isto é, a conversão pela leitura anterior que a R3.2 elimina.
  - Agora afirma:
    - o topo com "indisponível agora…";
    - `[data-work-time]` com contagem 0 na página;
    - o saldo do cartão em reais;
    - nenhum aviso de leitura anterior.

  As asserções finais passaram a ser positivas. Na reabertura, o topo deve conter "Valores em tempo de trabalho equivalente…" (antes, só `not.toContainText(stale)`, que passava com o topo vazio). Antes da receita retroativa, o saldo deve estar convertido de novo. Os prazos não mudaram (`setTimeout` 240 s; esperas de 30 s e 45 s).

  Ficou mais forte. Reprova na R3.1 e passa na final (p5f 19/19).
- **B03-g, entre as execuções `0f1b9320` e `059cec04`.**
  - A primeira versão exigia "nenhum `tempo|`" num registro que começa antes da queda e, portanto, contém o saldo convertido de antes.
  - A correção exige `drop > 0` (o saldo passou a reais) e nenhum `tempo|` do primeiro `reais|` em diante.

  Não afrouxa: o log da falha mostra o comportamento certo (`["tempo|≈ 776 h","reais|R$ 19.400,00"]`).

## 9. Mutantes

- **Executor:** 16/16 mortos ([mutantes-cliente-r32.log](../../logs/mutantes-cliente-r32.log)). Li o script `mutantes-cliente-r32.py`: as trocas casam uma vez, e os arquivos são restaurados e conferidos por SHA-256.
- **Meus:** 15, diferentes dos dele. Cada troca casa uma vez e cada arquivo é conferido byte a byte na restauração ([mutantes-revisor.py](scripts/mutantes-revisor.py), [mutantes-revisor.log](logs/mutantes-revisor.log)). Para cada mutante rodei três conjuntos:
  - a suíte de comportamento existente: `work-time-consistency`, `work-time-income-estimate`, `work-time-estimate`, `report-basis-sync` e `report-basis-refresh`;
  - o guarda por regex;
  - os meus testes extras.

  Nas três linhas de base, nada falha.

| Mutante | Resultado na suíte de comportamento existente | Testes que o matam (ex.) |
| --- | --- | --- |
| R01 retorno do cache só zera antes do 1º retorno do servidor (a queda de conexão mantém a confirmação) | MORTO (1) | `:1588` a conexão cai |
| R02 confirmação "pegajosa" no gancho | MORTO (8) | `:1529` religada e outros |
| R03 o tempo de interface aprova | MORTO (18) | revisão pt-BR da R3 (M-01) e os de cache aquecido |
| R04 releituras esgotadas viram aceitação | MORTO (1) | `:1627` divergência persistente |
| R05 aceita base ACIMA da projeção | MORTO (5) | `:85` prova pura e `:1627` |
| R06 aceita base ABAIXO da projeção | MORTO (1) | `work-time-income-estimate` (R6) "releitura da mutação com a base nova antes do retorno da escuta"; também meu T3 |
| R07 janela de um mês dispensa a confirmação | MORTO (4) | `:1497` mês corrente com o cache e o laço `WINDOWS` (1 mês, mês corrente) |
| R08 sem desconsiderada, projeção nula aprova | MORTO (23) | `:85` prova pura e os de cache aquecido |
| R09 projeção fabricada da base (a "leitura única" no gancho) | MORTO (15) | `:529` escuta encerrada desde o começo e outros |
| R10 R3-AUD-01 de volta (sem prova, a última provada) | MORTO (23) | B03 (R8-02) e os da R3.1 (R3-AUD-01) |
| R11 regra 5 removida | MORTO (23) | `:85` e os da R3 (marcas) |
| R12 regra 4 relaxada (`<=` → `<`) | MORTO (1) | `:85` ("mesma ordem") |
| R13 confirmação de outra janela da mesma conta e workspace | MORTO (3) | B03 (R8-02, troca para 12 meses) |
| R14 `holdEstimate` ignora a sincronização em curso | MORTO (5) | "apresentação fail-closed (R3.1, R3-AUD-01)" e outros |
| R15 o retorno do servidor só confirma com documento mudado (a volta da conexão só com metadados não devolve a conversão) | **SOBREVIVE** (0 na suíte, no guarda e nos extras) | ver F-06 |

**Total:** 14/15 mortos pela suíte de comportamento existente. O guarda por regex sozinho não salvou nenhum: todo mutante morto caiu também em algum teste de comportamento.

## 10. Matriz de evidências (checklist da skill)

| Seção do checklist | Resultado | Evidência |
| --- | --- | --- |
| Representação e tempo | PASS | Centavos inteiros sem mudança (`estimate.ts:142-246`; diff sem aritmética). Datas civis vêm do servidor (`referenceDate`) e o mês sai de `monthKeyOf`. D-29 conferida (§7). A fronteira de período está definida (releitura na virada, `hooks.ts:130-156`); o atraso fica no F-01 (LOW, anterior). |
| Semântica financeira | PASS | §4. `incomeCents` = receita operacional confirmada mais o principal de recebível; empréstimo, investimento, receita financeira, fatura e divisão ficam fora. Desconsideradas só com a prova das marcas. PF/PJ inalterado (`estimate.ts:159-162`). |
| Autoridade e atomicidade | PASS (escrita: N/A) | Nenhuma escrita nova (diff). As fontes são só do backend, e as Rules negam o cliente (`firestore.rules:618-621, 792-799`). Nada é gravado (o B03-g confere a preferência). Não há operação composta. |
| Operações críticas e eventos | N/A na escrita; PASS na leitura | Nenhuma operação nova. As releituras são limitadas (`basisRefresh.ts:76, 84-96`) e não viram aceitação (R04 morto). A reabertura da escuta pelo registro não mudou (`basisRegistry.ts:232-253`). |
| Histórico e auditoria | N/A | Nada é gravado, apagado ou reescrito. Functions e Rules inalteradas (diff vazio). |
| Fontes, totais, projeções e relatórios | PASS | Fonte oficial única: `cash_report_periods`, lida pela callable e pela escuta. Só converte com igualdade mês a mês (`consistency.ts:66`). Divergência persistente não converte (`:1627`, T3). A deriva é detectada e relida (`basisSync.ts:433-467`). |
| Substituição de domínio e remoção de legado | PASS | §12. |
| Migração com dados reais | N/A | Não há dados reais (plano, §1) nem mudança de schema ou de dado persistido. |
| Testes obrigatórios | PASS | Ver abaixo, §6, §8 e §9. |

**Testes obrigatórios.** A R3.2 não grava nada, então valem no lado de leitura: o efeito de cada operação financeira na estimativa. Todos estão verdes na árvore final.

- **Criação:** receita nova de outra sessão com a tela fora (`work-time-consistency.test.ts:1464`, variante "receita nova"); receita de hoje no mês corrente (`:1497`); E2E "uma receita nova entra na estimativa" e "receita retroativa no espaço da renda" (`work-time-p5f.spec.ts:848, 869`).
- **Edição:** a desconsiderada editada por outra sessão (R3.1, R3-AUD-01, `:1235`); E2E B03-a (`work-time-b03.spec.ts:328`).
- **Anulação e estorno:**
  - desconsiderada do 12º mês anulada em outra sessão (`:560`, R8-02);
  - E2E "mutação nesta aba: anular" (`work-time-p5f.spec.ts:1152`);
  - estorno de recebimento de cliente: B01 em `work-time-consistency.test.ts`; E2E `work-time-p5f.spec.ts:1334`.
- **Retry:** releituras pela divergência (`:1627`, T3); "Tentar de novo" (`:529`, `:1610`); E2E "releitura que falha" (`work-time-p5f.spec.ts:1038`).
- **Concorrência e ordem:**
  - a escuta antes das bases, depois delas e só quando o servidor responde (`:490`);
  - leituras sobrepostas a retornos do servidor (R7-02) e bases fora de passo (12 meses), em `report-basis-sync` (107/107 na suíte de relatórios).
- **Autoridade:** Rules inalteradas e negando o cliente. As suítes `test:rules:*` ainda precisam de um `verify:all` oficial completo na árvore final (§15, F-07).
- **Atomicidade:** N/A, não há operação composta.

## 11. Retry e concorrência

- **Idempotência.** Não se aplica à escrita, porque não há nenhuma. Na leitura:
  - cada retorno do servidor substitui a confirmação, sem acumular nada (`basisSync.ts:537`);
  - zerar é idempotente (`:505, :515, :545`);
  - a reabertura das escutas encerradas é única por chave (`basisRegistry.ts:232-253`).
- **Repetição.** No máximo duas releituras por estado divergente. Depois delas não há aprovação: R04 morto, `:1627` e T3.
- **Corridas:**
  - *Renderização entre a troca de chave e o efeito.* A chave da confirmação (`basisSync.ts:395, 609`) devolve `null` para outra conta, workspace ou janela. Evidência: R13 morto; T1 e T2.
  - *Retorno do servidor que diverge da base.* `setConfirmed` e o pedido de releitura (`setWaitingKey`, `:420`) saem do mesmo retorno (`:537-538`), e a prova reprova a base divergente por conta própria (`consistency.ts:66`). Não há renderização convertida entre um e outro.
  - *Retorno do cache depois do retorno do servidor* (queda de conexão). Zera a confirmação (`:515`). Evidência: R01 morto; `:1588`; B03-g.
  - *Escuta antiga que responde depois de desmontar.* O SDK não entrega depois do `unsubscribe`, o mundo simulado reproduz isso (`work-time-consistency.test.ts:296`), e a chave também protege.
  - *Leituras sobrepostas e bases fora de passo.* Os mecanismos da R1 à R3.1 não mudaram e seguem cobertos pela suíte.

## 12. Remoção de legado

- **O que foi substituído:** a regra 1 da R3.1, a "leitura única". Uma base sem desconsiderada era dada como provada sem a escuta, por meio do campo `multipleBases` da entrada da prova.
- **O que foi removido:**
  - a regra em `consistency.ts` (`:56` na R3.1);
  - o campo na interface (`:35` na R3.1);
  - o envio do campo no gancho (`useIncomeEstimateWith.ts:295` na R3.1);
  - a dependência `needsExtra` do `useMemo`.
- **Busca:** `multipleBases` em `src/`, `functions/src`, `e2e/` e `tests/` só aparece em `work-time-consistency.test.ts:150, 155` e `work-time-guard.test.ts:764, 767`, que provam a ausência.
- **Guardas:** `work-time-guard.test.ts:759-779` fixam:
  - a ordem das regras;
  - a ausência de `multipleBases`;
  - só três aprovações;
  - `projection: confirmed`;
  - os três `setConfirmed(null)`;
  - `includeMetadataChanges` e `fromCache` no adaptador.
- **Rules, índices, Functions e flags:** nenhum servia ao atalho (diff vazio).
- **Dados:** nada é persistido, então não há o que migrar.

## 13. Achados

Nenhum é bloqueante. Não há HIGH nem MEDIUM.

### F-01: LOW, anterior à R3.2 e fora do RR-R31-05. Virada do mês: a janela anterior continua provada e convertida até a releitura das bases

- **Onde:**
  - [`consistency.ts:60-78`](copia/src/modules/work-time/consistency.ts#L60): a prova compara receita por mês, não o mês da data de referência;
  - [`useIncomeEstimateWith.ts:136-149`](copia/src/modules/work-time/useIncomeEstimateWith.ts#L136): a janela vem do `referenceDate` da base em cache;
  - [`hooks.ts:130-156`](copia/src/modules/reports/hooks.ts#L130): a virada é detectada no relógio do cliente, a cada 60 s;
  - [`queryKeys.ts:39-43, 140-146`](copia/src/modules/reports/queryKeys.ts#L140): a releitura é agrupada em 5 s.
- **Cenário:** no dia 1º, depois da meia-noite em São Paulo, com a tela aberta.
  - A estimativa de "3 meses" continua com agosto a outubro (referência 04/11), provada pela escuta desses meses, até a releitura das bases trazer a referência nova. A espera é de até 60 s, mais 5 s de agrupamento, mais a leitura.
  - No modo "mês atual", o mês anterior aparece como atual nesse intervalo.
  - Se a releitura falha (a callable falha e a escuta segue viva), a janela anterior continua convertida com a ressalva de leitura anterior, pelo contrato RR-R31-04, até o "Tentar de novo", uma projeção nova ou a próxima virada.
  - Com o relógio do cliente atrasado, a espera cresce na mesma proporção.
- **Evidência** (testes meus, verdes na R3.1 e na final):
  - T5 ([revisor-t5-copia.log](logs/revisor-t5-copia.log), [revisor-t5-copia-vermelho.log](logs/revisor-t5-copia-vermelho.log)): `incomeCents` 900000, meses `2026-08..10`, `referenceDate` `2026-11-04` depois da virada para 01/12;
  - T5b ([revisor-t5b-copia.log](logs/revisor-t5b-copia.log), [revisor-t5b-copia-vermelho.log](logs/revisor-t5b-copia-vermelho.log)): o mesmo, com `refreshFailed: true`.
- **Impacto:** o valor convertido corresponde aos dados oficiais da janela exibida e nunca mistura fontes. Ainda assim, é a janela do período anterior apresentada como atual. Não há perda nem gravação: é um atraso de fronteira de período.
  - No mesmo mês, uma referência em cache de dias anteriores não muda o valor. As horas são as do mês inteiro (`estimate.ts:11-13`), e a receita até ontem é igual à projeção (D-29). Só a nota "até dd/mm" fica com a data da base (`estimate.ts:231-233`).
- **Correção sugerida** (etapa própria, sem mudança visual): tratar `monthKeyOf(series.data.referenceDate) !== saoPauloMonthKey()` como sincronização em curso, sem conversão, até a base nova chegar; ou levar o mês de referência para a prova. Registrar como risco residual no relatório da R3.2.

### F-02: INFO (produto). Só o indisponível "sem bloco exato" dispensa a confirmação

- **Onde:** [`consistency.ts:62-65`](copia/src/modules/work-time/consistency.ts#L62).
- **O que muda:** com base exata, os outros motivos de indisponível passam a esperar o retorno do servidor:
  - `business_not_confirmed`, `no_income`, `no_work_minutes`, `ambiguous_routines`, `income_too_low` e os demais.
  - Antes disso aparece "calculando". Sem conexão, aparece "em atualização" ou o erro com "Tentar de novo", no lugar do motivo.
- **Por que não é problema financeiro:** nos dois casos nada converte. Alguns desses motivos dependem da receita (`no_income`, os limites), e esperar a confirmação é coerente para eles.
- **Para quem:** cabe à revisão de produto e pt-BR dizer se isso atende ao "preservar estados legitimamente indisponíveis" além do caso sem bloco exato, que é o do item 4 e está preservado.

### F-03: INFO (defesa em profundidade). A dispensa do estado sem bloco exato depende de duas expressões calculadas à parte

- **Onde:** a dispensa da prova usa `basis.exact` ([`useIncomeEstimateWith.ts:162`](copia/src/modules/work-time/useIncomeEstimateWith.ts#L162)). A não conversão vem de `reportExact` ([`:248-251`](copia/src/modules/work-time/useIncomeEstimateWith.ts#L248)).
- **Situação hoje:** `basis.exact` falso implica `reportExact` falso. Uma mudança futura em só uma das duas abriria conversão sem prova.
- **Sugestão:** derivar as duas de uma função só, ou restringir a dispensa a estimativas não prontas (`estimate.status !== 'ready'`).

### F-04: INFO (testes). Reforços sugeridos

Os testes estão no arquivo [revisor-financeiro.test.ts](testes-revisor/revisor-financeiro.test.ts), padrão `REVISOR`.

- **Divergência persistente (cenário 7):** só é testada com a base acima da projeção (`:1627`).
  - A prova pura também só tem casos com a base acima: `'2026-09': 101` contra 100, e a projeção sem setembro (0) contra 100 (`:97-98` e `:103-104`).
  - O mutante R06 (aceitar a base abaixo) morre só por um teste antigo, da R6 em `work-time-income-estimate`, e não pelos do cenário.
  - Sugestão: adotar o meu T3, nos dois sentidos e no mês corrente com a série abaixo da projeção.
  - O T3 reprova na R3.1 e passa na final ([revisor-extras-todos-copia-vermelho.log](logs/revisor-extras-todos-copia-vermelho.log), [revisor-extras-todos-copia.log](logs/revisor-extras-todos-copia.log)).
- **Mês corrente com desconsiderada no próprio mês:** o laço `WINDOWS` pula o caso (`:1674`). Meu T4 cobre e passa nas duas árvores, porque a R3.1 já exigia a projeção com desconsiderada.
- **Ampliar ou reduzir a janela na mesma montagem:** o RR-R31-05 citava o caso, e não há teste próprio. Meus T1 e T2 reprovam na R3.1 e passam na final.

### F-05: INFO (backend, anterior à R3.2). Correção de lançamento confirmado com data futura sem caso explícito

- **Onde:** `functions/src/cash/__tests__/d29Contracts.test.ts:117-141` testa pendente com vencimento futuro e confirmado de hoje, mas não "confirmado amanhã" na correção.
- **Proteção atual:** a regra é a mesma da criação (`settlementRule` aplicada em `contracts.ts:275-279`), e executei o esquema compilado: RECUSADO ([d29-esquemas.log](logs/d29-esquemas.log)).
- **Sugestão:** acrescentar o caso. O backend não muda na R3.2.

### F-06: INFO (testes). O mundo simulado não reproduz a volta da conexão só com metadados; o mutante R15 sobrevive na unidade

- **Onde:**
  - [`work-time-consistency.test.ts:269-272, 280-294`](copia/tests/unit/work-time-consistency.test.ts#L269): `goOnline` e `snapshot()`;
  - [`basisSync.ts:537`](copia/src/modules/reports/basisSync.ts#L537): `setConfirmed` em todo retorno do servidor.
- **O que o mundo faz:** no mundo da unidade, todo retorno do servidor traz `changes = documents.length`. No SDK real, a volta da conexão com `includeMetadataChanges` é um retorno só de metadados: `fromCache: false` e `docChanges()` vazio, logo `changes: 0` em `hooks.ts:95`.
- **O mutante R15:** confirma só com `snapshot.changes > 0` e passa em toda a unidade. Na unidade, o cenário 10 depois da queda de conexão (`:1588`) não mede o caso real.
- **Impacto:** nenhum na integridade. O código atual confirma em todo retorno do servidor, e o mutante só suprime conversão (fail-closed). O caso real está coberto pelo E2E B03-g (`work-time-b03.spec.ts:729`, verde): sem recarregar, a conexão volta e a conversão volta.
- **Sugestão:**
  - `goOnline` entregar `changes: 0`, como o SDK;
  - se o executor quiser fechar a prova, rodar o B03-g com o R15 aplicado. Ele deve reprovar em "com a conexão de volta, a conversão certa volta".

### F-07: INFO (processo, fora do domínio financeiro; para o executor e para as revisões de estabilidade e de gate). A execução oficial na árvore final não terminou, e a cadeia `&&` seguiu depois de uma interrupção

Os números de linha são do [verify-all-r32-2-sem-ansi.log](logs/verify-all-r32-2-sem-ansi.log).

- **Sequência observada:**
  - Antes do SIGINT, o último resultado da integração das Functions é `ok 867`. Não há resumo `# tests` dessa fase, e nenhuma suíte `test:rules:*` aparece no log.
  - Em `:25750`, `emulators: Received SIGINT (Ctrl-C) for the first time` e o desligamento dos emuladores.
  - Em `:25760`, o npm já inicia o `test:e2e`.
  - O executor de testes da integração continua gravando no mesmo log, contra o Emulator desligado e com o `functions/lib` apagado e recompilado pelo build do E2E (`:25795-25800`): `not ok 872`, `876`, `881`, `888`–`891` (`:26501-28354`).
  - O E2E para em "13 passed, 69 did not run" (`:28436-28437`), e a execução termina com saída 130.
- **Hipótese não confirmada:** o `firebase emulators:exec` pode ter saído com 0 depois do SIGINT, já que o `&&` seguiu em frente. Nesse caso, uma integração interrompida passaria por verde na cadeia, e as Rules ficariam sem rodar.
- **Impacto:** nenhum na integridade financeira da R3.2. Mas não há prova oficial completa da integração, das Rules nem do E2E na árvore final.
- **Sugestão:** antes de aceitar qualquer `verify:all` com saída 0, conferir no log os resumos de todas as suítes de integração e de Rules (cerca de 1.289 testes na R3.1) e os três grupos do E2E. Investigar também a saída do `emulators:exec` sob SIGINT.

## 14. Comandos executados e resultados

Todos rodaram numa cópia própria, com `git archive` da árvore e links para os `node_modules` da worktree, sob `nice -n 19 node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1`. Não rodei Emulator, Playwright, E2E, `verify:*` nem `test:integration*`. Não acessei o Firebase de produção nem li segredos.

| Comando ou arquivo | Árvore | Resultado | Log |
| --- | --- | --- | --- |
| `tests/unit/work-time-consistency.test.ts` | ca11baca (= final) | 66/66 | [r32-ca11-consistency.log](logs/r32-ca11-consistency.log) |
| `tests/unit/work-time-guard.test.ts` | ca11baca | 19/19 | [r32-ca11-guard.log](logs/r32-ca11-guard.log) |
| suíte `test:unit:work-time` (10 arquivos) | ca11baca | 242/242 | [r32-ca11-unit-work-time.log](logs/r32-ca11-unit-work-time.log) |
| suíte `test:unit:reports` (7 arquivos) | ca11baca | 107/107 | [r32-ca11-unit-reports.log](logs/r32-ca11-unit-reports.log) |
| testes finais de consistência e guarda com o `src/` da R3.1 | R3.1 + testes finais | 20/85 reprovam, só os novos e reescritos | [vermelho-testes-r32-em-src-r31.log](logs/vermelho-testes-r32-em-src-r31.log) |
| extras do revisor T1–T5b (padrão `REVISOR`, [revisor-financeiro.test.ts](testes-revisor/revisor-financeiro.test.ts)) | final / R3.1 | 7/7 passam / reprovam T1, T2 e os dois T3; passam T4, T5 e T5b (anteriores à R3.2) | [revisor-extras-todos-copia.log](logs/revisor-extras-todos-copia.log), [revisor-extras-todos-copia-vermelho.log](logs/revisor-extras-todos-copia-vermelho.log) |
| mutantes do revisor (15; [mutantes-revisor.py](scripts/mutantes-revisor.py)) | ca11baca | 14/15 mortos pela suíte existente; R15 sobrevive (F-06); cópia restaurada byte a byte | [mutantes-revisor.log](logs/mutantes-revisor.log) |
| esquemas D-29 compilados (`functions/lib`) | worktree | futuro recusado em todos os caminhos de `incomeCents` | [d29-esquemas.log](logs/d29-esquemas.log) |
| busca por `multipleBases` em `src/`, `functions/src`, `e2e/` e `tests/` | final | só os testes negativos | §2 |
| busca por escrita, armazenamento ou aritmética no diff de `src/` | R3.1 → final | nenhuma | [diff-src-r31-9366.patch](logs/diff-src-r31-9366.patch) |

**Evidência do executor conferida** (somente leitura): `red-r32-na-r31(-2).log` (a mesma lista de 20 reprovações), `e2e-b03-r32-1` (6/7), `e2e-b03g-r32-2` (1/1), `e2e-b03g-na-r31-vermelho`, `e2e-p5f-r32-2` (19/19), `e2e-p5f-escuta-na-r31-vermelho` e `mutantes-cliente-r32.log`.

**`verify:all` oficial na `93668199`** ([verify-all-r32-2-sem-ansi.log](logs/verify-all-r32-2-sem-ansi.log), cópia sem códigos ANSI do log do executor): terminou com saída 130 às 14:30:26, interrompido.

- **Passou** (`verify:fast` inteiro):
  - typecheck, lint, build;
  - `functions:test:unit` 677/677;
  - `test:unit:work-time` 242/242;
  - `test:unit:reports` 107/107;
  - todas as demais suítes de unidade;
  - `test:tools:e2e` 9/9.
- **Não terminou:** a integração com o Emulator e o E2E (F-07).

## 15. O que não foi possível verificar

- **E2E e Rules.** Pela regra comum, não rodei E2E nem as suítes de Rules e de integração no Emulator. Para os dois specs que exercitam a estimativa (`work-time-b03` e `work-time-p5f`), usei os logs do executor em árvores com `src/` e specs idênticos aos finais (§6). Os outros specs não semeiam preferência de tempo de trabalho e não convertem valores.
  - `functions/`, `firestore.rules`, `firestore.indexes.json` e `firebase.json` são idênticos byte a byte aos da R3.1 (`efcbd264`), e essas suítes não importam `src/`. Então a R3.2 não pode afetá-las.
  - Na R3.1, com esse mesmo código, a integração e as Rules passaram 1.289/1.289 em cinco execuções (`docs/production/evidence/p5f1-r31/testes-e-resultados.md`, linhas 49, 60, 62, 64 e 66). Conferi que as árvores dessas execuções (`40057d2a`, `b841ec69`, `9d688d9c`, `30abca0f` e `6137c201`) têm diff vazio contra a final nesses caminhos. Por isso a falta delas na execução oficial não bloqueia este veredito financeiro.
  - O resultado na árvore final continua exigido pelo gate.
  - **Peço ao executor** que o fechamento confira, num `verify:all` oficial completo da `93668199`, os dois specs de tempo de trabalho e as suítes `test:rules:reports`, `test:rules:work-time` e `test:rules:projection-marks`. A `verify-all-r32-2` foi interrompida antes delas (F-07).
- **Firestore SDK real.** A volta da conexão só com metadados (`docChanges()` vazio) só tem cobertura no E2E B03-g, verde. Não rodei o B03-g contra o mutante R15, que sobrevive na unidade (F-06). Peço essa execução se o gate quiser a prova completa; ela não muda o veredito, porque o R15 só suprime conversão.
- **Documentação.** Não verifiquei a documentação pedida dos impactos de sincronização demorada e do painel "Receitas consideradas" (RR-R31-06): o relatório da R3.2 ainda não existe na pasta `relatorio/`.
