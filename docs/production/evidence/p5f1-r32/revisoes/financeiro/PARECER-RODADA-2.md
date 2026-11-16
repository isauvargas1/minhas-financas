FAIL — Financial domain integrity

# P5-F.1-R3.2: parecer de integridade financeira, rodada 2 (Frente A, RR-R31-05)

- **Revisão:** independente e somente leitura sobre a worktree, com a skill `financial-domain-integrity`. Reli o `SKILL.md` e o `references/integrity-checklist.md` inteiros.
- **Base:** R3.1, árvore `efcbd2645b8e7b08b5add2812f6b319f4a76369b`.
- **Árvore sob revisão:** `9fddcb5ad93f030bcd991820db85ca9a2b233976`, o código final candidato. A rodada 1 revisou `93668199c4d5a57a41308dd08383afd7c2245b00`.
- **Pasta:** `<scratchpad>/p5f1r32/revisoes/financeiro/rodada-2`. Todo caminho relativo abaixo parte dela.

## 1. Veredito

**FAIL**, por um achado MEDIUM novo (F-08), aberto pela correção do ADV-01.

- **Conversão: confirmada sem exceção.** Nenhuma estimativa que converte aparece sem a confirmação do servidor exigida. Vale em toda janela (1, 3, 6 e 12 meses e mês corrente), com uma base ou duas, com ou sem desconsiderada, sem conexão, com a escuta encerrada e com divergência persistente.
  - A conversão só nasce de `ready`, e `holdEstimate` segura toda `ready` sem prova ou com a sincronização em curso.
  - Minha varredura R2-05 (30 casos: 5 janelas × com/sem desconsiderada × 3 condições, com a volta da conversão no fim) passa 30/30 na final e reprova 18/30 na R3.1.
- **F-08 (MEDIUM).** O ADV-01 passou a mostrar a estimativa indisponível sem prova. Ela carrega os números da base: meses, receitas oficiais, desconsideradas, elegíveis e totais. A memória de cálculo ("Como este valor foi calculado?") mostra esses números. Sem a prova das marcas, os itens desconsiderados saem da leitura por id crua, e o resultado pode ser um estado misto:
  - **R2-01**, o cenário N03 com a rotina sem horas: a memória mostra R$ 10.260,00 de elegíveis, isto é, R$ 800,00 tirados do total que ainda contém R$ 500,00. É o valor que o próprio teste N03 chama de "nunca". Os estados consistentes dão R$ 10.560,00.
  - **R2-03**, rotina normal: o estado misto vira "Não há receitas efetivadas nos meses considerados", e os dois estados consistentes estão prontos (R$ 200,00 de elegíveis).
  - **R2-02**, divergência persistente com 12 meses: depois das releituras, setembro aparece como receita oficial de R$ 3.300,00, e a projeção confirmada diz R$ 3.000,00.
  - Na R3.1 e na árvore da rodada 1, os três casos ficavam sem nenhum desses números até a prova ("calculando" ou "em atualização"): as sondas passam lá e reprovam na final.
- **Mutantes:** 18/18 meus mortos pela suíte de comportamento existente. O R15, que sobrevivia na rodada 1, agora morre na unidade (§8).
- **Achados da rodada 1:**
  - fechados com evidência: F-03, F-04 e F-06;
  - F-02 fechado no aspecto de produto, mas a solução abriu o F-08;
  - em aberto, como risco residual e sugestão: F-01 (LOW, anterior à R3.2) e F-05 (INFO, backend);
  - F-07 tratado pelo EST-10, com a execução oficial da final ainda em curso.
- **Demais pontos do pedido:** confirmados, cada um com evidência (§5): tempo e releituras não provam, marcas e R3-AUD-01 preservados na conversão, D-29, centavos, nada gravado, testes novos vermelhos na R3.1, substituídos sem enfraquecimento e mutantes.

O FAIL não pede outro desenho. A correção é local (§10, F-08). Sem prova, a indisponível pode aparecer com um motivo que não depende da receita lida, sem os números derivados das bases. Os motivos que dependem da receita esperam a prova, como a estimativa que converte.

## 2. Escopo conferido

- **O que mudou desde a rodada 1** (`93668199 → 9fddcb5a`; [diff-stat-9366-9fdd.log](logs/diff-stat-9366-9fdd.log), [diff-src-9366-9fdd.patch](logs/diff-src-9366-9fdd.patch)):
  - em `src/`, só dois arquivos: `consistency.ts` (F-03: sem bloco exato, `reason: 'inexact'`) e `useIncomeEstimateWith.ts` (ADV-01: `holdEstimate` só segura `ready`; o resto são comentários);
  - testes: `work-time-guard`, `work-time-consistency` e `work-time-income-estimate` ([diff-guard-income-9366-9fdd.patch](logs/diff-guard-income-9366-9fdd.patch), [diff-consistency-9366-9fdd.patch](logs/diff-consistency-9366-9fdd.patch)); E2E novo "ADV-01 (R3.2)";
  - ferramentas de E2E e de integração, CI e documentos: fora do domínio financeiro, não revisados aqui (Frente B).
- **Desde a R3.1** ([diff-stat-r31-9fdd.log](logs/diff-stat-r31-9fdd.log), [diff-src-r31-9fdd-codigo.txt](logs/diff-src-r31-9fdd-codigo.txt)):
  - em `src/`, três arquivos, com seis mudanças de código fora os comentários: o retorno do cache zera a confirmação; sai `multipleBases` e a regra da leitura única; sem bloco exato, `inexact`; `holdEstimate` só segura `ready`;
  - `functions/`, `firestore.rules`, `firestore.indexes.json`, `firebase.json` e `storage.rules`: diff de 0 bytes.
- **Lidos inteiros na final:** `consistency.ts`, `useIncomeEstimateWith.ts`, `estimate.ts` e `EstimateDetails.tsx`.
- **Lidos em parte:** `IncomeEditor.tsx` (painel "Receitas consideradas"), `WorkTimeSettingsView.tsx`, `WorkTimeContext.tsx`, `Header.tsx`, `incomeBasis.ts` (`applyIncomeExclusions`) e o mundo simulado de `work-time-consistency.test.ts`.
- **Consumidores da conversão.** Todos exigem `ready` de um estado que passou por `holdEstimate`:
  - `WorkTimeContext.tsx:127` (a `config` que converte os valores do app);
  - `EstimateDetails.tsx:55` (prévia de R$ 150,00), `:60-62` e `:154-155` (valor da hora);
  - `WorkTimeSettingsView.tsx:448-449` ("Valor em uso agora");
  - `presentation.ts:27, 36` (a `config` do contexto).
- **PF/PJ:** sem mudança. A fonte PJ continua exigindo `allowBusinessIncome` (`estimate.ts:159-162`). O E2E do ADV-01 usa exatamente esse caso (`business_not_confirmed`).

## 3. Mapa de autoridade

| Figura | Fonte oficial | Escritores | Fronteira confiável |
| --- | --- | --- | --- |
| Receita por mês (`incomeCents`) | `workspaces/{ws}/cash_report_periods/{AAAA-MM}` | Só o gatilho de caixa e a reconstrução, pelo Admin SDK | Rules negam o cliente; inalteradas (diff vazio) |
| Base da estimativa (série 12m e o 12º mês) | Callable `getFinancialReport`, que lê a projeção | Nenhum (leitura) | Membership conferido a cada chamada; inalterado |
| Desconsideradas e marcas | Leitura por id e `readProjectionMarks` (transação só de leitura) | Inalterados na R3.2 | Inalterada |
| Confirmação do servidor (`confirmed`) | Retorno `fromCache: false` da escuta com `includeMetadataChanges` | Estado React em memória | Zerada na escuta nova, no retorno do cache e no erro; vale só com a chave conta+workspace+meses |
| Conversão (valor da hora em uso) | Derivada em memória, só de `ready` provada e sincronizada | Nenhum (nada gravado) | `holdEstimate` (`useIncomeEstimateWith.ts:123-129`) |
| **Números da estimativa indisponível** (memória de cálculo) | Derivados em memória das bases e, sem a prova das marcas, da leitura por id crua (`:264-278`) | Nenhum (nada gravado) | **Nenhuma desde o ADV-01:** `holdEstimate` deixa passar `unavailable` com ou sem prova (F-08) |

Nenhuma fonte concorrente nem escritor novo, do cliente ou do backend.

## 4. Semântica dos movimentos

Sem mudança desde a rodada 1. A R3.2 não altera classificação, sinal, regra de inclusão nem moeda.

- **Na base:** só o `incomeCents` da projeção: receita confirmada e não anulada, mais o principal de recebimento de cliente, com o estorno de sinal oposto.
- **Fora da base:** empréstimo, investimento (aporte, resgate, rendimento), receita financeira, pagamento de fatura e reembolso da divisão.
- **Desconsideradas:** saem só do próprio mês. Com a prova das marcas, o conteúdo tirado é o que a projeção contém. Sem ela, é o da leitura crua, e é aí que nasce o estado misto do F-08 (`incomeBasis.ts:173-217`; um mês com desconsiderada maior que o total é pulado, e um mês que zera não é).

## 5. Os oito pontos do pedido

1. **Nenhuma `ready`/`done` exibida como conversão sem a confirmação, em toda janela: PASS.**
   - Código:
     - `holdEstimate` segura toda `ready` sem prova ou sincronizando (`useIncomeEstimateWith.ts:128-129`);
     - a prova exige o bloco exato (`consistency.ts:65`), a projeção confirmada (`:67`) e a igualdade mês a mês (`:68`);
     - todo consumidor converte só de `ready` (§2).
   - Testes:
     - laço `WINDOWS` (`work-time-consistency.test.ts:1901`, cache aquecido em toda janela, com e sem desconsiderada);
     - ADV-03 (`:1802`, queda de conexão com 12 meses e com desconsiderada);
     - F-04/ADV-08 (`:1855`, mês corrente com desconsiderada no próprio mês);
     - F-04 (`:1873`, janela ampliada e reduzida na mesma montagem);
     - minha varredura R2-05, com as três condições em todas as janelas.
   - As estimativas `done` que não convertem (indisponíveis) aparecem sem prova: é o F-08, que não envolve conversão.
2. **Os dez cenários: PASS.** Os nove primeiros têm teste que reprova na R3.1. O 10, a volta à conversão, é a asserção final desses mesmos testes, que vem depois do ponto vermelho (§6).
3. **Tempo e releituras não provam: PASS.**
   - O tempo de interface só troca o texto (`useIncomeEstimateWith.ts:376-397`). As releituras param em 2, e a divergência continua sem prova (`consistency.ts:68`).
   - Testes: `:1649` (base acima), `:1833` (F-04, base abaixo), meus T3 (base abaixo; mês corrente com a série abaixo, como uma D-29 violada) e R2-05 (divergência em todas as janelas, com `w.calls.series` limitado e 2 s a mais no relógio).
   - Mutantes: R03 e R04 mortos (§8).
4. **O indisponível sem bloco exato aparece como está: PASS.**
   - Com o F-03, a prova não aprova mais nada sem bloco exato (`consistency.ts:65`). O estado aparece porque `holdEstimate` deixa passar `unavailable` (`:129`).
   - Testes: `:1673` e minha R2-04 (nenhuma conversão com a série sem bloco exato, com e sem retorno do servidor).
   - O ADV-01 estendeu isso a todo indisponível, e o problema dessa extensão é o F-08.
5. **Marcas e R3-AUD-01: preservados na conversão; FAIL na parte do que as marcas protegem (F-08).**
   - `projectionProof.ts` e as regras 4 e 5 (`consistency.ts:69-79`) estão iguais aos da R3.1. Nenhuma estimativa anterior é guardada nem mostrada (guarda `work-time-guard.test.ts:464-473`; mutante R10 morto).
   - Mas na R3.1 a regra 5 cobria toda estimativa mostrada com desconsiderada, pronta ou indisponível. Agora cobre só a que converte, e a indisponível sem prova mostra o "valor novo com o total velho" que as marcas existem para impedir (F-08, R2-01).
6. **Mês corrente e D-29: PASS**, sem mudança desde a rodada 1.
   - `functions/` tem diff de 0 bytes contra a R3.1. A análise e a execução dos esquemas compilados da rodada 1 continuam valendo: receita confirmada com data futura é recusada na criação, na correção, na confirmação, na importação e no recebimento de recebível ([d29-esquemas.log](../logs/d29-esquemas.log)).
   - Meu T3 (mês corrente com a série abaixo da projeção) mostra o resultado fail-closed se a D-29 fosse violada.
7. **Centavos inteiros, nenhuma escrita, nada gravado: PASS.**
   - As linhas alteradas de `src/` desde a R3.1 não têm API de escrita, armazenamento nem aritmética monetária ([diff-src-r31-9fdd-codigo.txt](logs/diff-src-r31-9fdd-codigo.txt)).
   - O E2E do ADV-01 confere que a preferência não foi regravada.
8. **Testes: PASS na conversão.**
   - Os novos reprovam na R3.1 e passam na final (§6). Os substituídos não foram enfraquecidos (§7).
   - Mutantes: §8.
   - Lacuna: nenhum teste confere os números da estimativa indisponível. Os do ADV-01 conferem só o motivo (`assertOnlyUnavailable`, `work-time-consistency.test.ts:1700-1708`). Ela entra no F-08.

## 6. Matriz dos dez cenários (estado final)

A coluna "R3.1" é o resultado dos testes da final sobre o `src/` da R3.1 (cópia `copia-r31`, três arquivos trocados, blobs conferidos: [diff-copias-final-r31-src.log](logs/diff-copias-final-r31-src.log)).

- **Totais na R3.1:** os testes da final reprovam 28/84 em `work-time-consistency`, 2/19 na guarda e 1/22 em `work-time-income-estimate` ([vermelho-r31-lista.txt](logs/vermelho-r31-lista.txt)). Os meus reprovam 22/42 ([revisor-r31.log](logs/revisor-r31.log)).
- **Numeração:** os números são os do TAP de `work-time-consistency` na cópia vermelha.

| # | Cenário | Testes na árvore final | R3.1 | Final |
| --- | --- | --- | --- | --- |
| 1 | Cache aquecido antes do 1º retorno do servidor | `work-time-consistency.test.ts:1485` (2 variantes), `:1519` (mês corrente), `:1535` (prévia ao lado), laço `WINDOWS` `:1901` (9 casos), `:1855` (mês corrente com desconsiderada no próprio mês); E2E B03-g | Reprovam 43, 44, 45, 46 e os quatro do laço sem desconsiderada (72, 74 e 76: 1, 3 e 6 meses; 80: mês corrente). Os com desconsiderada ou 12 meses (73, 75, 77–79) e o 70 (`:1855`) passam: a R3.1 já exigia a projeção nesses casos, e eles ficam como regressão | passa |
| 2 | Retorno à página e remontagem | `:1485` (`warmCache` desmonta e remonta no mesmo `QueryClient`), `:1535`, `:1591` (remonta sem conexão); E2E B03-g (prévia reaberta) | Reprovam 43, 44, 46 e 49 | passa |
| 3 | Reativação do modo tempo de trabalho | `:1551` | Reprova (47) | passa |
| 4 | Troca de workspace | `:1570` (ida e volta com o cache aquecido); `:691` e `:1399` (da R3.1, como regressão) | Reprova (48) | passa |
| 5 | Sem conexão | `:1591`, `:1610`, ADV-03 `:1802` (12 meses sem, 3 meses com e 12 meses com desconsiderada), R2-05 (10 casos); E2E B03-g e ADV-01 | Reprovam 49, 50, 66, 67, 68 e os 10 R2-05 "sem conexão": a R3.1 mantinha a confirmação no retorno do cache | passa |
| 6 | Escuta encerrada com erro | `:551` (desde o começo), `:567` (12 meses), `:801` (N05), `:1632` (com a estimativa na tela), R2-05 (10); E2E p5f `:1230` | Reprovam 8, 51 e os 4 R2-05 sem desconsiderada (1, 3 e 6 meses e mês corrente). `:567`, `:801` e os 6 R2-05 com desconsiderada ou 12 meses passam: já eram protegidos | passa |
| 7 | Divergência persistente depois das releituras | `:1649` (base acima), `:1833` (base abaixo), meus T3 (inclusive o mês corrente), R2-05 (10) | Reprovam 52, 69, os dois T3 e os 4 R2-05 sem desconsiderada. Com desconsiderada ou 12 meses, a R3.1 já não convertia | passa |
| 8 | Janelas de 1, 3, 6 e 12 meses (e mês corrente) | Laço `WINDOWS`, ADV-03, `:1873` (ampliada e reduzida), meus T1 e T2, R2-05 em todas as janelas | Reprovam 71, 72, 74, 76, 80, T1, T2 e 18 dos R2-05 | passa |
| 9 | Com e sem desconsiderados | `WINDOWS` (com e sem), `:1855`, prova pura (`:85`, `:122`, `:143`), ADV-03 (com), R2-05 (com e sem) | "Sem" reprova: as linhas acima e a prova pura (1, 2, 3). "Com" reprova sem conexão (67, 68 e 5 R2-05) | passa |
| 10 | Volta à conversão depois da confirmação válida | A asserção positiva final de cada teste acima (`publish`, `goOnline`, "Tentar de novo" → o valor certo). ADV-03: a mesma conversão sem leitura a mais (`:1824-1826`). R2-05 (30 casos): depois, só a conversão certa. E2E: B03-g (`work-time-b03.spec.ts:778`, o saldo convertido de novo), ADV-01 (a conversão em uso volta) e p5f `:1230` | n/a: vem depois do ponto vermelho. Sem ela reprovariam os mesmos testes, e os mutantes R15 e N19, que suprimem a volta, morrem | passa |

- **Reprovam também na R3.1**, pelo contrato e não por acaso:
  - a guarda: 12, a expressão do `holdEstimate` e o retorno do cache; 19, a ordem das regras;
  - a tabela-verdade do ADV-01 (`work-time-income-estimate` 4);
  - cinco testes do gancho do ADV-01:
    - 56, 61 e 64 escondem o indisponível durante a releitura ou a divergência;
    - 63 troca o motivo pelo erro;
    - 65 converte R$ 11.060,00 "com aviso" com a escuta encerrada, o próprio RR-R31-05.
- **Motivos das reprovações**, conferidos no TAP: conversão sem a confirmação, indisponível escondido, ou o código antigo na guarda. Nenhum é acidental.
- **E2E vermelho na R3.1:** é o da rodada 1 (B03-g e p5f `:1230`), já conferido.

## 7. Testes substituídos ou ajustados desde a R3.1: nada enfraquecido

Conferi cada item da lista do COMUM-R2 contra a R3.1 e contra a árvore da rodada 1.

- **Nenhum teste removido.** Os títulos fixos da R3.1 que faltam na final são os três reescritos ou renomeados que conferi na rodada 1 ([contagem-testes.log](logs/contagem-testes.log)).
- **Contagem de chamadas `test(`, R3.1 → final:** consistência 40 → 58 (84 testes com os laços), guarda 18 → 19, `income-estimate` 20 → 21, p5f 19 → 20 e b03 6 → 7.
- **Scripts oficiais.** Comparei os `npm run` que `verify:fast`, `test:integration:emulator` e `verify:all` chamam na R3.1 e na final:
  - nenhuma suíte saiu;
  - entraram `test:tools:e2e` e `test:tools:integracao` no `verify:fast`;
  - `test:unit:work-time` e `test:unit:reports` estão iguais aos da R3.1.

| Teste | O que mudou | Juízo |
| --- | --- | --- |
| Guarda do `holdEstimate` (`work-time-guard.test.ts:469`) | A expressão fixada passou da R3.1 (`state.status === 'done' && (!proven \|\| settling)`) para a do ADV-01, com `state.estimate.status === 'ready'` | O teste continua fixando a expressão exata, então não afrouxou. Mudou o contrato, de propósito. A consequência não prevista desse contrato é o F-08 |
| Guarda da ordem das regras e da contagem (`:761-781`) | `!input.basis.exact` exige `{ proven: false, reason: 'inexact' }`; as aprovações caem de 3 para 2 | Mais estrito |
| Guardas do retorno do cache e do adaptador (`:396`, `:420`, `:779-780`) | Exigem `setConfirmed(null)` no retorno do cache, `includeMetadataChanges` e `fromCache` | Mais estritos |
| Prova pura (`work-time-consistency.test.ts:85`) | Sem bloco exato, `'provada'` → `'inexact'` nos dois casos, e uma asserção nova: nem com a projeção confirmada e igual às bases | Mais estrito |
| Mundo simulado (`:276-279`, `:306-321`) | `goOnline` conta as mudanças por escuta contra a última entrega a ela, inclusive a do cache, como o `docChanges()` do SDK (0 quando nada mudou). As outras entregas continuam contando todos os documentos (`countChanges` falso por padrão) | Mais fiel; nada afrouxado |
| Título do ADV-06 (`:1438`) | Só o título | Neutro |
| Tabela-verdade do ADV-01 (`work-time-income-estimate.test.ts:154`) | Nova | Os testes da R3.1 em `holdEstimate` usam só estimativas prontas (`done(...)`, `:57-64`) e não precisaram mudar: desde a R3.1, o arquivo só ganhou linhas |
| Testes do gancho do ADV-01 (`work-time-consistency.test.ts:1696-1800`) | Novos | Conferem que o indisponível aparece e que nada converte, mas só pelo motivo (`assertOnlyUnavailable`), nunca pelos números. É a lacuna do F-08 |
| ADV-03 e F-04 (`:1802-1892`) | Novos | O F-04 adotou a base abaixo da projeção, o mês corrente com desconsiderada no próprio mês e a janela ampliada e reduzida (3 → 6 → 3). A variante do meu T3 com o mês corrente (série abaixo, como uma D-29 violada) não entrou, mas o meu T3 passa na final |
| E2E "ADV-01 (R3.2)" (`work-time-p5f.spec.ts:1310`) | Novo | Verde na final ([e2e-adv01-r32-1.log](../../../logs/e2e-adv01-r32-1.log)). Vermelho na cópia anterior ao ADV-01 (`:1333`): a prévia trocou o motivo por "em atualização". Usa `business_not_confirmed`, motivo sem números, então não exercita o F-08 |

## 8. Mutantes

- **Roteiro:** [mutantes-revisor-r2.py](scripts/mutantes-revisor-r2.py) ([mutantes-revisor-r2.log](logs/mutantes-revisor-r2.log)). É o da rodada 1 com três ajustes:
  - o R14 segue a expressão nova do `holdEstimate`;
  - entram o R18 e o R19, para o F-03, e o R20;
  - os extras são os meus testes que passam na final (T1–T5b, R2-04 e R2-05). R2-01 a R2-03 ficam fora porque reprovam na final: são a prova do F-08.
- **Integridade:** cada troca casa uma vez. Cada mutante roda três conjuntos:
  - a suíte de comportamento existente: `work-time-consistency`, `-income-estimate`, `-estimate`, `report-basis-sync` e `-refresh`;
  - a guarda;
  - os extras.

  O arquivo é restaurado e conferido por SHA-256 a cada mutante. No fim, conferi a cópia contra a árvore ([copia-restaurada.log](logs/copia-restaurada.log)). Nas três linhas de base, nenhuma falha.

| Mutante | Comportamento (falhas) | Guarda | Extras | Exemplo de teste que o mata |
| --- | --- | --- | --- | --- |
| R01 retorno do cache só zera antes do 1º retorno do servidor | 4 | 1 | 10 | `:1610` a conexão cai; R2-05 sem conexão |
| R02 confirmação "pegajosa" no gancho | 12 | 2 | 21 | `:1551` religada; T2 |
| R03 o tempo de interface aprova | 22 | 1 | 22 | M-01 da R3; T3 |
| R04 releituras esgotadas viram aceitação | 2 | 0 | 12 | `:1649`; T3 |
| R05 aceita base ACIMA da projeção | 5 | 1 | 0 | prova pura `:85` |
| R06 aceita base ABAIXO da projeção | 2 | 1 | 7 | `:1833` (F-04, novo); T3 |
| R07 janela de um mês dispensa a confirmação | 5 | 1 | 11 | `:1519`; T2 |
| R08 sem desconsiderada, projeção nula aprova | 27 | 1 | 14 | prova pura; T1 |
| R09 projeção fabricada da base (a "leitura única" no gancho) | 18 | 2 | 12 | `:551`; T1 |
| R10 R3-AUD-01 de volta | 28 | 1 | 22 | B03 (R8-02); T1 |
| R11 regra 5 removida | 23 | 0 | 0 | prova pura e os da R3 |
| R12 regra 4 relaxada | 1 | 0 | 0 | prova pura |
| R13 confirmação de outra janela aceita | 4 | 2 | 1 | B03 (R8-02); T2 |
| R14 `holdEstimate` ignora a sincronização | 6 | 1 | 0 | tabela-verdade da R3.1 |
| R15 só confirma com documento mudado | **5** | 0 | 10 | `:1591`; R2-05 sem conexão. **Sobrevivia na rodada 1** (F-06): agora morre na unidade |
| R18 `reportExact` desacoplado da base (F-03) | 1 | 0 | **0** | `:1673` (o indisponível vira pronta segurada). A R2-04 passa: **nada converte**, porque a prova exige o bloco exato |
| R19 o R18 com o F-03 revertido | 2 | 1 | **2** | prova pura. A R2-04 reprova nas duas variantes: **converte** sem bloco exato. É a defesa que o F-03 acrescentou |
| R20 a `ready` provisória (mês corrente, menos meses) passa sem prova | 3 | 1 | 8 | `:1519`; T3 do mês corrente |

**Total:** 18/18 mortos pela suíte de comportamento existente. Nenhum depende só da guarda.

Do executor ([mutantes-cliente-r32-2.log](../../../logs/mutantes-cliente-r32-2.log), cópia anterior ao F-03):

- 20/20 com a guarda;
- 18/20 sem ela. O N15 e o N16, do adaptador do SDK, que o mundo simulado não atravessa, ficam cobertos pelo B03-g com o N16 (vermelho em `:750`).
- O roteiro já foi atualizado para a final (N07 = F-03 revertido; N17 e N18 = ADV-01). O executor o roda depois da execução oficial.

Nenhum mutante, meu ou dele, mede os números da estimativa indisponível. É a lacuna do F-08.

## 9. Achados da rodada 1

| Achado | Situação | Evidência |
| --- | --- | --- |
| F-01 (LOW, anterior à R3.2): virada do mês, a janela anterior provada até a releitura | **Aberto, como risco residual** (RR-R32-06, segundo o executor); fora do RR-R31-05 | Comportamento igual ao da rodada 1: T5 e T5b passam na final e na R3.1 ([revisor-final.log](logs/revisor-final.log), [revisor-r31.log](logs/revisor-r31.log)). O registro no plano e no relatório ainda não existe (§14). |
| F-02 (INFO, produto): só o indisponível sem bloco exato dispensava a confirmação | **Fechado no aspecto de produto**, porque com o ADV-01 todo indisponível aparece. O aspecto financeiro **virou o F-08 (MEDIUM)** | Na rodada 1 eu disse que, para os motivos que dependem da receita, esperar a confirmação é coerente. O ADV-01 liberou todos, com os números: R2-01, R2-02 e R2-03 (§10). |
| F-03 (INFO): a dispensa sem bloco exato dependia de duas expressões separadas | **Fechado** | `consistency.ts:65` (`inexact`); guarda `work-time-guard.test.ts:761`; prova pura `work-time-consistency.test.ts:85`; minha R2-04 verde. O mutante R18 desacopla `reportExact` da base: a estimativa fica pronta com a série sem bloco exato, e mesmo assim nada converte (R2-04 passa). O R19 faz o mesmo e reverte o F-03: aí converte, e R2-04 reprova (§8). A defesa agora não depende do acoplamento. |
| F-04 (INFO): reforços de teste | **Fechado** | Adotados em `:1833` (base abaixo), `:1855` (mês corrente com desconsiderada no próprio mês) e `:1873` (janela 3 → 6 → 3). Meus T1–T4 passam na final; T1, T2 e os dois T3 reprovam na R3.1, e T4 passa lá, como na rodada 1. |
| F-05 (INFO, backend): correção de confirmado com data futura sem caso explícito | **Aberto, como sugestão**, fora da etapa | `functions/` sem diff; a recusa foi executada na rodada 1. |
| F-06 (INFO): o mundo simulado não reproduzia a volta da conexão só com metadados | **Fechado** | `goOnline` conta as mudanças como o SDK (`:276-279`, `:306-321`). O ADV-03 confere `w.lastChanges === 0` e "sem leitura a mais" (`:1824-1826`). O meu R15 agora morre na unidade (§8), e o N19 do executor também. O B03-g com o A02 aplicado reprova com o SDK real (`work-time-b03.spec.ts:778`). |
| F-07 (INFO, processo): a execução oficial não terminou e o `&&` seguiu depois de um SIGINT | **Tratado no projeto pelo EST-10** (marco de fase completa). A conferência é da revisão de estabilidade e do gate | A `verify-all-r32-3` estava em curso (§14). |

## 10. Achados novos

### F-08: MEDIUM (bloqueante). A estimativa indisponível aparece sem prova com números de um estado misto na memória de cálculo

- **Onde:**
  - [`src/modules/work-time/useIncomeEstimateWith.ts:128-129`](copia/src/modules/work-time/useIncomeEstimateWith.ts#L128): `holdEstimate` só segura `ready`. A `unavailable` passa com ou sem prova e com a sincronização em curso.
  - [`useIncomeEstimateWith.ts:262-278`](copia/src/modules/work-time/useIncomeEstimateWith.ts#L262): sem a prova das marcas, os itens desconsiderados vêm da leitura por id crua (`:271-278`). O comentário de `:262-263` ainda diz "Sem prova, a estimativa calculada aqui nunca é mostrada (`holdEstimate`)", e isso deixou de valer.
  - [`src/modules/work-time/estimate.ts:193-228`](copia/src/modules/work-time/estimate.ts#L193): os motivos `no_income`, `no_work_minutes`, `income_too_low`, `income_too_high`, `work_minutes_too_high` e `hourly_rate_too_low` carregam a base inteira (meses, receitas, desconsideradas, elegíveis e totais). Os de `:160`, `:165`, `:170` e `:191` usam a base vazia.
  - [`src/components/workTime/EstimateDetails.tsx:154-205`](copia/src/components/workTime/EstimateDetails.tsx#L154): para qualquer `done`, inclusive o indisponível, a memória de cálculo mostra:
    - o motivo;
    - "Meses considerados" (receitas oficiais, desconsideradas e elegíveis);
    - "Total de receitas elegíveis";
    - "Você desconsiderou N receitas (R$ X)".

    O botão "Como este valor foi calculado?" aparece para todo `done` (`:109-111`), em Configurações e no assistente.
  - [`src/components/workTime/IncomeEditor.tsx:108-111`](copia/src/components/workTime/IncomeEditor.tsx#L108): o painel "Receitas consideradas" usa as receitas da estimativa como "o relatório oficial".
  - Comentários que deixaram de valer, além de `:262-263`:
    - `useIncomeEstimateWith.ts:117-121`: "o motivo real continua visível";
    - `consistency.ts:5-8`: "Ela só é mostrada quando a correspondência entre essas leituras é demonstrada".
- **Cenários.** Provas executáveis minhas, com o gancho real (`useIncomeEstimateWith`, React Query, react-test-renderer) e o mundo simulado da final ([r2-sondas.ts.part](testes-revisor/r2-sondas.ts.part), montadas em `tests/unit/revisor-r2-financeiro.test.ts` de cada cópia). Cada uma vem com o que as renderizações mostraram ([revisor-final.log](logs/revisor-final.log), [revisor-r31.log](logs/revisor-r31.log), [revisor-9366.log](logs/revisor-9366.log)).
  - **R2-01**, o N03 com a rotina sem horas. Outra sessão muda a desconsiderada `r500` de R$ 500,00 para R$ 800,00, e o gatilho ainda não aplicou outubro nem a marca.
    - Na final: `loading → indisponível no_work_minutes total=1026000 2026-10: oficial=402000 desconsiderada=80000 elegível=322000`. A memória mostra R$ 10.260,00 de elegíveis e outubro com R$ 3.220,00.
    - É o valor que o teste N03 da própria suíte chama de "nunca" (`work-time-consistency.test.ts:837`: "Nunca R$ 10.260,00 (R$ 800,00 tirados do total velho)").
    - Os dois estados consistentes dão R$ 10.560,00, com outubro em R$ 3.520,00.
    - Na R3.1 e na árvore da rodada 1: `loading`, e só os números consistentes depois do gatilho.
  - **R2-03**, rotina normal, janela de 1 mês: outubro tem R$ 500,00 (`ra`, desconsiderada, de R$ 300,00, mais `rb`, de R$ 200,00). Outra sessão muda `ra` para R$ 500,00 antes do gatilho.
    - Na final: `loading → indisponível no_income total=0`, isto é, "Estimativa indisponível. Não há receitas efetivadas nos meses considerados…" (`messages.ts:32`).
    - Os dois estados consistentes estão prontos (R$ 200,00 de elegíveis), e o motivo é falso.
    - Na R3.1 e na árvore da rodada 1: `loading → pronta 20000`.
  - **R2-02**, cenário 7 com 12 meses e a rotina sem horas: a série traz setembro R$ 300,00 acima da projeção.
    - Na final, depois das duas releituras: `indisponível no_work_minutes total=3630000 2026-09: oficial=330000`. A projeção confirmada diz R$ 3.000,00.
    - Na R3.1 e na árvore da rodada 1: "em atualização". Este caso pesa menos: o número é o do relatório oficial sob uma anomalia no servidor, o mesmo que a tela de relatórios mostraria.
- **Impacto:**
  - Não há conversão, nada é gravado e nada sai da tela da própria pessoa. O critério "nenhuma conversão sem comprovação financeira válida" continua atendido.
  - Mas a memória de cálculo apresenta como fato um total derivado que nenhum estado oficial reconstrói: receita oficial de um instante menos a desconsiderada de outro. É o defeito do B03 ("o valor novo com o total velho") que a regra 5 e as marcas da R3 eliminaram. Pode também mostrar um motivo falso (R2-03).
  - Nos três casos, o estado aparece sem aviso. `refreshFailed` é falso (`useIncomeEstimateWith.ts:294`), porque nenhuma leitura falhou e a escuta está viva. O aviso de "última leitura" (`ESTIMATE_REFRESH_FAILED`) só acompanha o indisponível quando a escuta encerra.
  - É regressão aberta nesta etapa:
    - na R3.1, `holdEstimate` segurava toda estimativa `done` sem prova, e a regra 5 cobria qualquer estimativa mostrada com desconsiderada;
    - na árvore da rodada 1, também.
  - O que a R3.1 já mostrava sem prova era outra coisa: o indisponível com uma base e nenhuma desconsiderada, pela leitura única. Eram receitas oficiais do cache, talvez antigas, mas de um único estado e reconstituíveis. A exposição nova é o total derivado com desconsiderada, que mistura instantes, e a janela de 12 meses.
  - Pelo checklist, é total não reconstituível e dupla contagem num número mostrado ("Fontes, totais, projeções e relatórios"; "Semântica financeira: Prevent double counting"). Pela política da skill, isso é FAIL.
- **Exposição:**
  - Exige um motivo que traga a base preenchida. O realista é `no_work_minutes` (rotina ou exceções sem horas na janela). `no_income` e os limites só aparecem por coincidência de valores, como no R2-03.
  - Exige também uma das três condições:
    - uma desconsiderada com conteúdo ainda não aplicado pelo gatilho: dura até o gatilho, segundos no caso comum;
    - uma marca quebrada: dura até a reconstrução;
    - 12 meses com as bases fora de passo, ou uma anomalia persistente.
- **Correção sugerida:** a escolha cabe ao executor, com a revisão de produto, porque mexe no que o ADV-01 quis preservar.
  - Sem prova, ou com a sincronização em curso, a indisponível pode aparecer com um motivo que não depende da receita lida (`business_not_confirmed`, `report_unavailable`, `exclusion_unconfirmed`, `ambiguous_*` e `no_work_minutes`). Nesse caso, sem os números derivados das bases e das desconsideradas.
    - Por exemplo, `holdEstimate` devolve a indisponível com a base vazia, e a memória de cálculo diz que os valores do período aparecem quando a estimativa for confirmada.
    - A frase "Você não desconsiderou nenhuma receita" não pode aparecer quando há desconsiderada.
  - Os motivos que dependem da receita (`no_income`, `income_too_low`, `income_too_high` e `hourly_rate_too_low`) esperam a prova, como a estimativa que converte.
  - Testes que fixem as duas coisas: nenhum número de estado misto (R2-01) e nenhum motivo de estado misto (R2-03), mais os comentários corrigidos.
  - O motivo de `no_work_minutes` continua visível sem conexão e com a escuta encerrada, que era o objetivo do ADV-01.

## 11. Matriz de evidências (checklist da skill)

| Seção do checklist | Resultado | Evidência |
| --- | --- | --- |
| Representação e tempo | PASS | Centavos inteiros; nenhuma aritmética nova ([diff-src-r31-9fdd-codigo.txt](logs/diff-src-r31-9fdd-codigo.txt)). D-29 garantida pelo backend, sem diff (§5, item 6). A fronteira de período tem o atraso do F-01 (LOW, anterior). |
| Semântica financeira | PASS na classificação; dupla contagem no F-08 | A classificação, o sinal e as inclusões não mudaram (§4). A dupla contagem do estado misto aparece só no número mostrado do indisponível (F-08). |
| Autoridade e atomicidade | PASS (escrita: N/A) | Nenhuma escrita nova. As fontes são do backend, e Rules, Functions e índices não mudaram. Não há operação composta. |
| Operações críticas e eventos | N/A na escrita; PASS na leitura | Releituras limitadas a 2, sem aceitação (R04 morto). A reabertura da escuta e a chave da confirmação não mudaram (R13 morto). |
| Histórico e auditoria | N/A | Nada é gravado, apagado ou reescrito. |
| Fontes, totais, projeções e relatórios | **FAIL** (F-08) | Na conversão, PASS: igualdade mês a mês com a projeção confirmada e, com desconsiderada, a regra 5 (R2-05 30/30). Na memória de cálculo do indisponível, o total derivado de um estado misto (R2-01), o motivo de um estado misto (R2-03) e o número que diverge da projeção confirmada (R2-02). |
| Substituição de domínio e remoção de legado | PASS | §12. |
| Migração com dados reais | N/A | Não há dados reais nem dado persistido novo. |
| Testes obrigatórios | **FAIL** só pela lacuna do F-08 | Nenhum teste confere os números do indisponível. O resto do lado de leitura está verde na final (84/84, 19/19 e 22/22). Em cada operação, o efeito dela na estimativa:<br>• criação: receita nova de outra sessão (`:1485`, variante) e receita de hoje no mês corrente (`:1519`);<br>• edição: a desconsiderada editada antes do gatilho (`:821`, `:1034`);<br>• anulação e estorno: `:582`, `:723` e os B01 (`:1947-2025`);<br>• retry: `:1649`, `:1833`, `:551`, `:1632` e R2-05;<br>• concorrência e ordem: `:512` (a escuta antes, depois e só com o servidor) e `:723`;<br>• autoridade: Rules inalteradas; as suítes de Rules ficam com a execução oficial. |

## 12. Reconciliação, retry, concorrência e legado

- **Reconciliação.**
  - A conversão exige a base igual à projeção confirmada em cada mês da janela (mês sem documento vale 0) e, com desconsiderada, a prova das marcas no mesmo instante dos meses.
  - O mês corrente soma os dias até a data de referência. A igualdade com a projeção do mês inteiro depende da D-29, garantida pelo backend.
  - A falha de reconciliação desta rodada é a do indisponível (F-08).
- **Retry.**
  - No máximo duas releituras por divergência, sem aceitação. Evidência:
    - `:1649` e `:1833` (base acima e abaixo da projeção);
    - meus T3 (inclusive no mês corrente);
    - R2-05, a divergência em todas as janelas, com `w.calls.series` limitado e o "Tentar de novo" trazendo o valor novo;
    - o mutante R04 morto.
  - O "Tentar de novo" reabre a escuta encerrada: `:551`, `:1632` e R2-05.
- **Concorrência.**
  - **Edição em outra sessão antes do gatilho** (a família N03/B03). A conversão continua protegida: os testes B03 da R3 estão verdes, e R11 e R12 estão mortos. O indisponível não está protegido (R2-01).
  - **Queda e volta da conexão.** O retorno do cache zera a confirmação. A volta só com metadados a restaura sem leitura a mais (ADV-03; R2-05). Os mutantes R01 e R15 morrem.
  - **Troca de janela, workspace ou conta.** A confirmação só vale com a chave da montagem (`:1873`, `:1570`, `:708`; R13 morto).
- **Legado** ([busca-legado.log](logs/busca-legado.log)):
  - `multipleBases` só aparece nos testes que provam a ausência (`work-time-consistency.test.ts:153, 158`; `work-time-guard.test.ts:766, 769`);
  - a aprovação antiga sem bloco exato (`basis.exact) return { proven: true }`) não existe mais em `src/`, `functions/src`, `e2e/` nem `tests/`;
  - `consistency.ts` tem só as duas aprovações (`:69`, sem desconsiderada, e `:79`, a prova das marcas);
  - Rules, índices, Functions e flags: nenhum servia ao atalho (diff vazio). Nada é persistido, então não há o que migrar.

## 13. Comandos executados e resultados

Tudo rodou nas minhas cópias, feitas com `git archive` da árvore e com links para os `node_modules` da worktree, um de cada vez, sob:

```
nice -n 19 node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 --test-reporter=tap
```

- Não rodei Emulator, Playwright, E2E, `verify:*`, `test:integration*` nem `tests/tools/*`, e nada abriu portas.
- Não acessei o Firebase de produção nem li segredos.
- Nada foi alterado na worktree. Rodei lá um `git write-tree`, que só lê: o índice continuou com a data de 11:47:49, e a árvore dele é a do HEAD (`3995eb7f`).

Cópias usadas:

- `copia`: árvore final;
- `copia-r31`: a final com os três arquivos de `src/` da R3.1 ([diff-copias-final-r31-src.log](logs/diff-copias-final-r31-src.log));
- `copia-9366`: a final com o `src/` da árvore da rodada 1 ([copia-9366.log](logs/copia-9366.log)).

Os testes do revisor são o arquivo de consistência de cada cópia, mais o ajuste de duas linhas do mundo (data de referência trocável, para T5 e T5b), os T1–T5b da rodada 1 e as sondas R2 ([montar-testes-revisor.py](scripts/montar-testes-revisor.py)). O arquivo montado é idêntico nas cópias.

| Comando ou arquivo | Cópia | Resultado | Log |
| --- | --- | --- | --- |
| `tests/unit/work-time-consistency.test.ts` | final | 84/84 | [final-consistency.log](logs/final-consistency.log) |
| `tests/unit/work-time-guard.test.ts` | final | 19/19 | [final-work-time-guard.log](logs/final-work-time-guard.log) |
| `tests/unit/work-time-income-estimate.test.ts` | final | 22/22 | [final-work-time-income-estimate.log](logs/final-work-time-income-estimate.log) |
| testes do revisor (`--test-name-pattern='^REVISOR'`) | final | 39/42. Reprovam só R2-01, R2-02 e R2-03, as provas do F-08 | [revisor-final.log](logs/revisor-final.log) |
| testes do revisor | R3.1 | 20/42. Passam T4, T5, T5b, R2-01 a R2-04 e 12 dos 30 R2-05. Reprovam T1, T2, os dois T3 e 18 dos R2-05 | [revisor-r31.log](logs/revisor-r31.log) |
| testes do revisor R2-01 a R2-04 | rodada 1 | 5/5. Os três casos do F-08 ficam em "calculando" até a prova (R2-02: "em atualização") | [revisor-9366.log](logs/revisor-9366.log) |
| `work-time-consistency`, `-guard` e `-income-estimate` da final | R3.1 | reprovam 28/84, 2/19 e 1/22, todos pelo contrato (§6) | [vermelho-r31-lista.txt](logs/vermelho-r31-lista.txt) e `logs/vermelho-r31-*.log` |
| mutantes do revisor (18) | final | 18/18 mortos pela suíte de comportamento; cópia restaurada e conferida | [mutantes-revisor-r2.log](logs/mutantes-revisor-r2.log), [copia-restaurada.log](logs/copia-restaurada.log) |
| buscas de legado na árvore (`git grep`) | final | só os testes negativos; duas aprovações | [busca-legado.log](logs/busca-legado.log) |
| linhas de código alteradas em `src/`, R3.1 → final | — | seis mudanças, sem escrita, armazenamento nem aritmética | [diff-src-r31-9fdd-codigo.txt](logs/diff-src-r31-9fdd-codigo.txt) |
| títulos de teste, R3.1 → final | — | nenhum removido sem substituto | [contagem-testes.log](logs/contagem-testes.log) |

Evidência do executor, conferida só lendo:

- `e2e-adv01-r32-1`, `e2e-adv01-na-pre-vermelho`, `e2e-b03g-com-a02` e `e2e-b03g-com-n16`, com os `.meta`;
- `mutantes-cliente-r32-2.log` e `-sem-guarda.log`;
- o roteiro `mutantes-cliente-r32.py`, já atualizado para a final (N07 = F-03 revertido; N17 e N18 = ADV-01), e o `prova-vermelha-r32.py`;
- o histórico das execuções.

## 14. O que não foi possível verificar

- **E2E, Rules e integração.** Pela regra comum, não rodei nenhum. Para os specs de tempo de trabalho, usei os logs do executor:
  - `e2e-adv01-r32-1`: 1/1 na final;
  - `e2e-adv01-na-pre-vermelho`: 0/1, vermelho em `:1333`;
  - `e2e-b03g-com-a02`: 0/1, vermelho em `work-time-b03.spec.ts:778`, que fecha o F-06 com o SDK real;
  - `e2e-b03g-com-n16`: 0/1, vermelho em `:750`;
  - os da rodada 1.

  A cópia do A02 (`d9d13231`) difere da final só no F-03 e em comentários, e o F-03 não atua no B03-g, cuja base é exata.
- **F-08 no E2E.** Não há E2E para o F-08. As minhas provas são de unidade, com o gancho real. Entre o `holdEstimate` e a memória de cálculo não há SDK, só React (`EstimateDetails.tsx:127-205`), então a unidade basta para o veredito.
  - Se o gate quiser a prova no navegador: o B03-a com a rotina sem horas, conferindo "Como este valor foi calculado?" antes do gatilho.
- **Execução oficial.** A `verify-all-r32-3`, na árvore `9fddcb5a`, estava em curso na hora do parecer, na fase das Rules. Não conferi o resultado; ele é do gate e da revisão de estabilidade.
- **Documentação.** O plano, o relatório e os riscos residuais (RR-R32-06 para o meu F-01, RR-R32-07 e os textos do RR-R31-06) ainda não foram escritos. A revisão deles fica para depois da execução oficial.
- **Mutantes do executor na final.** Ele os roda depois da execução oficial. Conferi o log da cópia anterior ao F-03: 20/20 com a guarda; 18/20 sem ela, e o N15 e o N16 (o adaptador do SDK) ficam cobertos pelo E2E com o SDK real.
