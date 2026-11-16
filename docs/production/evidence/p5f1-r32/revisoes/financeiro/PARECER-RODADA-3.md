PASS — Financial domain integrity

# P5-F.1-R3.2: parecer de integridade financeira, rodada 3 (Frente A, RR-R31-05)

- **Revisão:** independente e somente leitura, com a skill `financial-domain-integrity` (reli o `SKILL.md` e o `references/integrity-checklist.md` inteiros).
- **Base:** R3.1, árvore `efcbd2645b8e7b08b5add2812f6b319f4a76369b`. **Rodada 2:** `9fddcb5ad93f030bcd991820db85ca9a2b233976` (FAIL, F-08).
- **Árvore sob revisão:** `ef514869087c2b9e8e910a25fc7c18174418b8bb`. Todas as leituras e execuções foram feitas em cópias próprias (`git archive` dessa árvore). Depois do aviso do executor, `$W` passou a conter outra árvore (`698f9644`, a da rodada 4); nada deste parecer foi lido de lá.
- **Pasta:** `<scratchpad>/p5f1r32/revisoes/financeiro/rodada-3`. Os caminhos relativos abaixo partem dela.

## 1. Veredito

**PASS** para a árvore `ef514869`. O F-08 está fechado, e nenhuma conversão aparece sem a comprovação.

- **F-08 fechado.** Nenhuma estimativa com valores das bases chega à tela sem prova ou com a sincronização em curso.
  - Os três casos da rodada 2 não aparecem mais: R$ 10.260,00 no N03 com a rotina sem horas, "Não há receitas efetivadas…" de um estado misto e setembro com R$ 3.300,00.
  - Minhas sondas R2-01 a R2-03 reprovam na árvore da rodada 2 e passam na final.
  - Minha varredura nova, R3-05, cobre 5 janelas × com/sem desconsiderada × 3 condições, com a indisponível que traz valores. Ela reprova 30/30 na árvore da rodada 2 e passa 30/30 na final.
- **Conversão.** Nada converte sem a confirmação do servidor, em toda janela, com e sem desconsiderada. Os dez cenários continuam cobertos (§5), e a varredura R2-05 passa 30/30.
- **Achado novo F-R3-01 (LOW, não bloqueante).** A regra estrutural (`carriesBasisFigures`) não cobre os motivos de rotina ambígua.
  - `ambiguous_routines` e `ambiguous_reduced_eve` não saem antes da receita: dependem dos meses com renda e levam notas tiradas das bases e da leitura por id sem prova.
  - Na árvore final, aparecem sem prova (R3-01, R3-02 e R3-04).
  - Não há valor em reais, total nem conversão. O que aparece é uma nota de "Limitações" ou um motivo de configuração, de forma passageira. Por isso o achado é LOW (§7).
  - O executor já corrigiu com o ADV-R3-01 na `698f9644`. A conferência fica para a rodada 4.
- **Mutantes.** 31 meus, 30 mortos pela suíte de comportamento existente. O R31 morre só pela guarda: é uma lacuna de teste, sem efeito financeiro (F-R3-03).
  - Do executor contra o F-08: 6/6 no `mutantes-cliente-n2x.log` e N17/N18/N21 de novo na execução final, que foi interrompida.
- **Execução oficial** `verify-all-r32-4`: saída 0, árvore `ef514869` no início e no fim. `test:unit:work-time` deu 278/278 e `test:unit:reports` 107/107. Integração e Rules completas, com `[integração] fase completa`, e o E2E com 218 testes passando, entre eles o B03-g, a escuta encerrada (p5f:1230) e o "ADV-01 (R3.2)".

## 2. Escopo conferido

- **Desde a rodada 2** ([diff-src-9fdd-ef51.patch](logs/diff-src-9fdd-ef51.patch)): em `src/`, uma linha de código. `holdEstimate` passou a segurar `carriesBasisFigures(state.estimate)`, isto é, `ready` ou `months` não vazio. O resto são comentários de `consistency.ts` e do gancho.
- **Testes mudados desde a rodada 2:**
  - a tabela-verdade, a guarda e o E2E do ADV-01 ([diff-guard-income-e2e-9fdd-ef51.patch](logs/diff-guard-income-e2e-9fdd-ef51.patch)); no E2E, só `console.log` e comentário;
  - o bloco "o estado indisponível" ([diff-consistency-9fdd-ef51.patch](logs/diff-consistency-9fdd-ef51.patch)).
- **Desde a R3.1** ([buscas-e-diffs.log](logs/buscas-e-diffs.log)):
  - Em `src/`, três arquivos e sete mudanças de código: o retorno do cache zera a confirmação, sai a leitura única (`multipleBases`), entra o `inexact` sem bloco exato e entra o `carriesBasisFigures` no `holdEstimate`.
  - Têm diff de 0 bytes: `functions/`, `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `storage.rules`, `estimate.ts`, `messages.ts`, `incomeBasis.ts`, `projectionProof.ts` e os componentes.
- **Lidos inteiros na árvore final:** `useIncomeEstimateWith.ts`, `estimate.ts`, `messages.ts`, `EstimateDetails.tsx` e as partes de exclusão de `incomeBasis.ts`.
- **Lidos em parte:** `IncomeEditor.tsx` (o painel "Receitas consideradas" e o "Considerar"), `Header.tsx`, `WorkTimeContext.tsx` e `WorkTimeSettingsView.tsx`.
- **Consumidores da estimativa.** Todos recebem o estado depois do `holdEstimate`.
  - A conversão só nasce de `ready`: `WorkTimeContext.tsx:127`, `Header.tsx:45`, `WorkTimeSettingsView.tsx:448` e `EstimateDetails.tsx:55, 60, 154`.
  - Da indisponível, a tela mostra o motivo, a fonte, o modo e a data de referência. Mostra os meses e os totais só com `months` não vazio (`EstimateDetails.tsx:87, 162`), as desconsideradas pela `excludedCount` (`:201-204`) e as notas, todas (`:225`).
  - O painel "Receitas consideradas" usa os meses da estimativa como total oficial (`IncomeEditor.tsx:108-111`).
- **PF/PJ:** sem mudança. A fonte PJ exige `allowBusinessIncome` (`estimate.ts:159-162`). O `business_not_confirmed` sai antes de qualquer leitura de receita, com as notas vazias.

## 3. Mapa de autoridade e semântica

Sem mudança desde a rodada 2:

- A receita de cada mês vem de `cash_report_periods`. Os únicos escritores são o gatilho e a reconstrução, pelo Admin SDK, e as Rules negam o cliente.
- A base vem de `getFinancialReport`. A confirmação é a de um retorno `fromCache: false` da escuta, com a chave conta + workspace + meses.
- A estimativa é derivada em memória e nunca gravada.
- A classificação dos movimentos é a mesma: receita confirmada e o principal de recebimento entram; empréstimo, investimento, receita financeira, fatura e divisão ficam fora.
- **Uma ressalva** (F-R3-01): para a indisponível sem valores, a "fronteira" agora é `carriesBasisFigures`. Ela olha `ready` e `months`, mas não as notas.

## 4. O que ainda aparece sem prova (pergunta 2 do coordenador)

Li cada `return` de `computeWorkTimeEstimate` (`estimate.ts:142-246`) e rodei a função pura ([explorar-estimativa-pura.log](logs/explorar-estimativa-pura.log)) e a sonda R3-04, com 1.038 estimativas sem valores.

| Motivo | Onde sai | Depende da receita lida? | O que leva | Classificação |
| --- | --- | --- | --- | --- |
| `business_not_confirmed` | `:160`, antes de tudo | Não: só o tipo do espaço e a preferência | base vazia, notas vazias | sem valores, decidido antes da receita ✔ |
| `report_unavailable` | `:164-166` | Não: o estado do bloco e a presença dos meses | base vazia; no máximo `business_income` | sem valores ✔ (é o estado legítimo do item 4) |
| `exclusion_unconfirmed` | `:169-171`, antes de `applyIncomeExclusions` | Não: o estorno da leitura por id ("não deu para confirmar") | base vazia; no máximo `business_income` | sem valores ✔. R3-03: meses 0, renda 0, desconsideradas 0, notas [] |
| `ambiguous_routines` / `ambiguous_reduced_eve` | `:189-192`, **depois** de `applyIncomeExclusions` (`:172-176`) e do corte dos meses sem renda (`:179-180`) | **Sim** | base vazia, mas com as notas `exclusions_skipped`, `exclusions_ignored` e `exclusions_reversed` | **depende da receita** (F-R3-01) |

- **Valores em reais.** Só existem com `base` (`:193-200`), e `base` sempre tem meses: a janela não é vazia, e o corte deixa pelo menos um mês. Na árvore final, então, nenhum valor das bases sai sem meses. A regra estrutural cobre todo valor monetário de hoje.
- **Estimativas futuras.** Nada fixa isso por teste.
  - A tabela-verdade usa estimativas sintéticas (`work-time-income-estimate.test.ts:157-190`).
  - Os testes B02 conferem meses, horas e renda dos motivos ambíguos (`work-time-estimate.test.ts:219, 237`), mas não `excludedCents`, `excludedCount` nem as notas.
  - Um motivo novo que trouxesse `excludedCents` ou uma nota com valores sem meses passaria pela regra e pelos testes. A sonda R3-04 é a propriedade que falta e já reprova hoje (90 casos, só nos dois motivos ambíguos).
- **Conclusão financeira errada.** Os três primeiros motivos não levam a nenhuma: são de disponibilidade e configuração, sem valor. Nos dois ambíguos, o que aparece sem prova é uma nota ou um motivo de configuração calculado de leituras não confirmadas (F-R3-01). Não é valor nem total.

## 5. Os pontos do pedido

1. **Nenhuma `ready` como conversão sem a confirmação, em toda janela: PASS.**
   - `holdEstimate` segura toda `ready` sem prova ou sincronizando (`useIncomeEstimateWith.ts:135-141`).
   - Testes: o laço `WINDOWS` (`work-time-consistency.test.ts:2093-2121`, 10 casos), o ADV-03 (`:2001`), o F-04 (`:2032-2091`) e minhas R2-05 (30/30) e T1–T4.
2. **Os dez cenários: PASS**, com as mesmas provas da rodada 2. Cada um tem teste que reprova na R3.1 ([vermelho-r31-work-time-consistency.log](logs/vermelho-r31-work-time-consistency.log): 40/101 reprovam, todos pelo contrato).
   - Cache aquecido, volta à página e remontagem: `:1488-1552` (43–46).
   - Reativação: `:1554` (47).
   - Troca de workspace: `:1573` (48).
   - Sem conexão: `:1594`, `:1613` e ADV-03 (49, 50, 83–85).
   - Escuta encerrada: `:554` e `:1635` (8, 51).
   - Divergência persistente: `:1652` e `:2032` (52, 86).
   - Janelas 1/3/6/12 e mês corrente: `WINDOWS` (89, 91, 93, 97 reprovam; os casos com desconsiderada e os de 12 meses já eram protegidos).
   - Com e sem desconsiderada: os mesmos laços.
   - Volta à conversão: a asserção final de cada um.
   - E2E: B03-g e p5f:1230, verdes na execução oficial.
3. **Tempo e releituras não provam: PASS.** R03 e R04 morrem; `:1652`, `:2032` e meu T3.
4. **O indisponível legítimo aparece como está: PASS.**
   - O sem bloco exato aparece sem prova: `:1676` e o bloco `WITHOUT_FIGURES` (`:1737-1763`, três condições).
   - O `business_not_confirmed` também (`:1765-1796`, depois da confirmação).
   - Mutantes: R24 (morto) e R18/R19.
5. **Marcas (regras 4 e 5) e R3-AUD-01: PASS.**
   - `projectionProof.ts` tem diff vazio. As regras 4 e 5 de `consistency.ts` são as da R3.1, e a busca só acha as duas aprovações (`:72, :82`).
   - A guarda proíbe guardar uma estimativa anterior (`work-time-guard.test.ts:472-475`).
   - Mutantes R10, R11 e R12 mortos.
   - A regra `inexact` (`consistency.ts:68`) está preservada: N07/N08 do executor e meus R18/R19 morrem.
6. **D-29: PASS**, sem mudança. `functions/` tem diff vazio desde a R3.1, e a execução dos esquemas da rodada 1 continua valendo.
7. **Centavos inteiros, nenhuma escrita, nada gravado: PASS.** As linhas de código alteradas desde a R3.1 não têm escrita, armazenamento nem aritmética ([buscas-e-diffs.log](logs/buscas-e-diffs.log)).
8. **Testes: PASS** (§6 e §8), com as lacunas INFO do F-R3-03.

## 6. Testes substituídos desde a rodada 2: nada enfraquecido nem removido

| Teste | Mudança | Juízo |
| --- | --- | --- |
| Guarda do `holdEstimate` (`work-time-guard.test.ts:470-471`) | A expressão com `state.estimate.status === 'ready'` virou a com `carriesBasisFigures(state.estimate)`, e entrou a regex do próprio `carriesBasisFigures` | Fixa as duas expressões exatas. Segura mais estados que antes: mais estrito |
| Tabela-verdade (`work-time-income-estimate.test.ts:157`) | Antes, toda indisponível (6 motivos) passava como está. Agora são 5 sem valores (como estão) e 6 com valores (só provados e sincronizados). Entrou a asserção de que todos os motivos de `UNAVAILABLE_REASON_TEXT` estão classificados | Mais estrito. A parte da `ready` não mudou |
| Bloco do estado indisponível (`work-time-consistency.test.ts:1689-1997`) | 12 → 29 testes. As asserções antigas de "aparece como está" para `no_work_minutes` e `no_income` viraram "nenhum valor sem prova" mais "o erro ou em atualização" mais "com a prova, a indisponível provada" (`:1798-1876`). O "aparece como está" passou para `business_not_confirmed` e `report_unavailable` (`:1737-1796`). Entraram as sondas R2-01 a R2-03 (`:1898-1960`), a transição PJ → renda confirmada (`:1962`, no lugar da transição sem horas → com horas, impossível com o novo contrato) e o ADV-R2-07 (`:1981`) | Nenhuma cobertura perdida. Contagem: consistência 84 → 101, guarda 19 → 19, `income-estimate` 22 → 22 |

**Vermelho e verde dos testes novos:**

- Árvore da rodada 2 ([vermelho-9fdd-work-time-consistency.log](logs/vermelho-9fdd-work-time-consistency.log)): reprovam 14/101, todos do F-08. Os 66–70 e 72–77 trazem a indisponível com valores sem prova, e os 78–80 são as sondas (`total=1026000`, `oficial=330000`, `no_income`). A guarda reprova 1/19 e a tabela-verdade 1/22.
- R3.1: 40/101, 2/19 e 1/22, pelo contrato. As sondas passam lá, porque a R3.1 não tinha o F-08.
- Final: 101/101, 19/19 e 22/22.

## 7. Achados novos

### F-R3-01: LOW. Os motivos de rotina ambígua não saem antes da receita: dependem dela, levam notas das bases e aparecem sem prova

- **Onde:**
  - `src/modules/work-time/estimate.ts:172-192`: as exclusões são aplicadas e os meses sem renda cortados antes da conferência da ambiguidade, e `notes` (o mesmo vetor do `emptyBase`, `:145-157`) já tem as notas das exclusões quando sai `unavailable(emptyBase, 'ambiguous_*')`.
  - `src/modules/work-time/useIncomeEstimateWith.ts:107-115`: `carriesBasisFigures` olha só `ready` e `months`. O comentário diz que a indisponível sem números "sai antes de qualquer receita (… rotinas sem cálculo seguro)", e isso não vale para esses dois motivos.
  - `src/components/workTime/EstimateDetails.tsx:225`: as notas aparecem para todo `done`.
- **Cenários** (sondas minhas, com o gancho real; [revisor-final.log](logs/revisor-final.log), [revisor-r31.log](logs/revisor-r31.log), [revisor-9fdd.log](logs/revisor-9fdd.log)):
  - **R3-01, estado misto.** Rotinas ambíguas e janela de 1 mês. Outubro tem R$ 500,00 (`ra`, desconsiderada, de R$ 300,00, mais `rb`). Outra sessão muda `ra` para R$ 600,00 antes do gatilho.
    - Na final: `loading → indisponível ambiguous_routines notas=[exclusions_skipped(2026-10)]`. A memória de cálculo mostra "As receitas que você desconsiderou não foram descontadas em 10/2026: o relatório oficial desse mês ainda não as inclui. Vale o total oficial."
    - Nenhum dos dois estados consistentes tem essa nota (500 − 300 e 800 − 600 ≥ 0).
    - Na R3.1: `loading` até a prova, e depois a indisponível sem nota.
  - **R3-02, o motivo depende da receita.** Véspera reduzida ambígua só em agosto, e agosto com R$ 100,00 abrindo o período. Outra sessão anula a receita de agosto com a tela fora, e a tela volta com o cache aquecido.
    - Na final, antes do retorno do servidor: `indisponível ambiguous_reduced_eve`. O estado do servidor (setembro e outubro) é a pronta de R$ 7.040,00, que converte depois da prova.
    - Na R3.1: `loading → pronta`.
  - **R3-04, propriedade pura.** De 1.038 estimativas sem valores, 90 trazem nota das bases. Todas são `ambiguous_*` com `exclusions_skipped`, `_ignored` ou `_reversed`.
- **Impacto:** nenhuma conversão, nenhum valor em reais, nenhum total, nada gravado.
  - O que aparece sem prova é uma nota de "Limitações", que descreve um atraso real do relatório em relação ao lançamento editado, ou um motivo sobre a configuração da rotina. Os dois são passageiros: valem até o gatilho ou até o retorno do servidor.
  - A exposição exige uma rotina ambígua na janela, condição que já deixa a estimativa indisponível.
  - Não é total irreconstituível nem dupla contagem, e por isso não bloqueia. Mas contraria o contrato declarado do F-08 ("nenhum número das bases sem prova") e não tem teste.
- **Classificação dos motivos de rotina ambígua (pedido do coordenador):** são indisponíveis que **dependem das receitas**. Devem esperar a prova, como as que trazem valores. Só `business_not_confirmed`, `report_unavailable` e `exclusion_unconfirmed` são decididos antes de qualquer receita.
- **Correção sugerida:**
  - segurar os motivos ambíguos como os com valores (uma lista fechada dos decididos antes da receita, fail-closed para motivos novos);
  - ou decidir a ambiguidade antes das exclusões e sem as notas.
  - Em qualquer caso, adotar a propriedade R3-04 como teste: toda indisponível mostrada sem prova tem valores zerados e só a nota `business_income`.
- **Situação:** o executor informou a correção (ADV-R3-01, lista `DECIDED_BEFORE_INCOME`) na `698f9644`. Fica aberto nesta árvore, para confirmar na rodada 4.

### F-R3-02: INFO (produto e pt-BR; anterior à R3.2). A memória de cálculo de uma indisponível sem valores diz "Você não desconsiderou nenhuma receita." com desconsiderada

- **Onde:** `EstimateDetails.tsx:201-204` usa `estimate.excludedCount`, que é 0 na base vazia (`estimate.ts:154-155`).
- **Cenário:** no `exclusion_unconfirmed` (R3-03, `excludedCount: 0` com `A` desconsiderado), o motivo diz "um recebimento que você desconsiderou" e a seção logo abaixo diz que nenhum foi desconsiderado. Os feriados e as exceções viram "nenhum" pelo mesmo motivo (`:129-134, 211-218`).
- **Impacto:** não há valor. Na R3.1 o texto já saía assim, mas só com a prova.
- **Sugestão:** tirar esse texto e essas seções quando não houver meses, ou dizer que os detalhes aparecem quando houver estimativa. Isso cabe à revisão de produto e pt-BR.

### F-R3-03: INFO (testes)

- **R22 e R31 (§8).** A retenção, durante a sincronização em curso, da indisponível provada com valores só é fixada pela tabela-verdade pura e pela guarda. Nenhum teste do gancho tem a indisponível com valores provada e sincronizando. O efeito seria mostrar valores provados, não um estado misto.
- **Teste `:1805`, "nenhuma renda na janela, com a divergência persistente".** A inclinação de setembro (+R$ 300,00) faz a base ficar pronta, e não `no_income`. O teste segura uma pronta e não exercita a `no_income` divergente; por isso passa na árvore da rodada 2 (o 71). A combinação "com valores × divergência" está coberta pela rotina sem horas (`:1805`, `no_work_minutes`, e as sondas R2-02 e R3-05).
- **Sugestão:** um caso do gancho com a indisponível provada durante uma releitura, e a propriedade R3-04.

## 8. Mutantes

**Meus** ([mutantes-revisor-r3.py](scripts/mutantes-revisor-r3.py), [mutantes-revisor-r3.log](logs/mutantes-revisor-r3.log)).

- **Os 18 da rodada 2,** com o R14 e o R20 na expressão nova, mais 13 novos contra o F-08.
- **Cada mutante roda três conjuntos:**
  - a suíte de comportamento: `work-time-consistency`, `-income-estimate`, `-estimate`, `report-basis-sync` e `-refresh`;
  - a guarda;
  - os meus extras que passam na final: T1–T5b, R2-01 a R2-05, R3-03 e R3-05.
- **Linhas de base:** sem falha.
- **Restauração:** cada arquivo foi conferido por SHA-256. No fim, a cópia é idêntica ao `git archive` de `ef514869` ([copia-restaurada.log](logs/copia-restaurada.log)).
- **Carga:** nenhuma falha "tempo esgotado" no log, então as mortes não vieram da carga da máquina.

| Mutante | Comport. | Guarda | Extras | Juízo |
| --- | --- | --- | --- | --- |
| R01–R15, R18–R20 (os da rodada 2) | 1 a 36 cada | — | — | todos MORTOS |
| R21 só a indisponível com mais de um mês espera | 2 | 1 | 13 | MORTO (sonda R2-03 do executor) |
| R22 a indisponível com valores ignora a sincronização | 1 | 1 | 0 | MORTO, só pela tabela-verdade pura (F-R3-03) |
| R23 `no_work_minutes` passa sem prova | 12 | 1 | 32 | MORTO |
| R24 a indisponível sem valores espera a sincronização | 5 | 1 | 0 | MORTO (ADV-01 preservado) |
| R25 só a com desconsiderada espera | 10 | 1 | 16 | MORTO (a base divergente sem desconsiderada) |
| R26 `no_income` com a base vazia | 3 | 0 | 1 | MORTO (o motivo falso do R2-03 volta) |
| R27 as rotinas ambíguas com meses e total | 2 | 0 | 0 | MORTO (B02) |
| R28/R29 `exclusion_unconfirmed` / `ambiguous_routines` esperam a prova | 1 / 1 | 1 / 1 | 0 / 0 | MORTOS, só pela tabela-verdade |
| R30 o gancho trata toda indisponível como provada | 14 | 1 | 33 | MORTO |
| R31 o gancho ignora a sincronização só para a indisponível | **0** | 1 | 0 | **MORTO SÓ PELA GUARDA** (F-R3-03) |
| R32 o F-08 desfeito (o N21) | 15 | 1 | 33 | MORTO |
| R33 sem o termo da pronta (o N22; equivalente no gancho) | 4 | 1 | 0 | MORTO (estimativa sintética sem meses) |

**Total:** 30/31 mortos pela suíte de comportamento existente e 31/31 por algum conjunto.

**Do executor:**

- [mutantes-cliente-n2x.log](../../../logs/mutantes-cliente-n2x.log): 6/6 mortos (N17, N18, N21 a N24), lido o roteiro.
- A execução final em `ef514869` foi interrompida ([mutantes-cliente-r32-final-ef514869-interrompido.log](../../../logs/mutantes-cliente-r32-final-ef514869-interrompido.log)): N01–N18, N23, N24 e N21 mortos antes da interrupção. O N22 não chegou a rodar nela; morre no n2x.

## 9. Achados das rodadas 1 e 2

| Achado | Situação | Evidência |
| --- | --- | --- |
| F-08 (MEDIUM) | **Fechado** | Sondas R2-01 a R2-03: reprovam na árvore da rodada 2, passam na final. Varredura R3-05: 30/30 reprova na árvore da rodada 2, 30/30 passa na final. Testes do executor `:1798-1960`. Mutantes R21, R23, R25, R26, R30 e R32 mortos por comportamento. O resíduo dos motivos ambíguos é o F-R3-01 (LOW) |
| F-01 (LOW, anterior) | **Aberto como risco residual** (RR-R32-06 no rascunho do relatório; ainda não está no plano em `docs/`) | T5 e T5b passam na final, na R3.1 e na árvore da rodada 2: o comportamento não mudou |
| F-05 (INFO, backend) | **Aberto como sugestão**, fora da etapa | `functions/` com diff vazio desde a R3.1 |
| F-02, F-03, F-04, F-06 | Fechados na rodada 2, sem regressão | Mutantes R15, R18 e R19 mortos; testes F-04 verdes |
| F-07 (processo) | Tratado (EST-10) | A `verify-all-r32-4` tem `[integração] fase completa`, nenhum "Received SIG" na fase de integração e as 19 suítes de Rules |

## 10. Matriz do checklist

| Seção | Resultado | Evidência |
| --- | --- | --- |
| Representação e tempo | PASS | Centavos inteiros, sem aritmética nova ([buscas-e-diffs.log](logs/buscas-e-diffs.log)). D-29 sem mudança. F-01 continua como risco anterior |
| Semântica financeira | PASS | Classificação inalterada. Nenhum total de estado misto aparece (F-08 fechado) |
| Autoridade e atomicidade | PASS (escrita: N/A) | Sem escrita nova. Functions, Rules e índices com diff vazio |
| Operações críticas e eventos | PASS na leitura | Releituras limitadas (R04 morto) e chave da confirmação (R13 morto) |
| Histórico e auditoria | N/A | Nada é gravado |
| Fontes, totais, projeções e relatórios | PASS | Conversão e valores das bases só com a prova (R2-05, R3-05, sondas). A nota dos motivos ambíguos é LOW (F-R3-01) |
| Substituição e legado | PASS | `multipleBases` só nos testes negativos. Só as duas aprovações. A aprovação sem bloco exato não existe mais ([buscas-e-diffs.log](logs/buscas-e-diffs.log)) |
| Migração com dados reais | N/A | Não há dados reais nem dado persistido novo |
| Testes obrigatórios | PASS | Efeito de cada operação na estimativa: criação (`:1488`), edição (N03, R2-01), anulação e estorno (B01, `:585`), retry (`:1652`, R2-05), concorrência (`:516`, `:726`). Rules completas na execução oficial |

## 11. Comandos executados

Todos rodaram nas minhas cópias, um de cada vez, sob `nice -n 19 node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 --test-reporter=tap` ([rodar.sh](scripts/rodar.sh)). Sem Emulator, Playwright, E2E, `verify:*` ou `test:integration*`. Sem acesso a produção e sem segredos. Nada foi alterado em `$W`: o índice continua com a data de 11:47:49.

**Cópias:**

- `copia`: final;
- `copia-r31`: os três arquivos de `src/` da R3.1;
- `copia-9fdd`: os dois da rodada 2;
- `copia-mut`: a dos mutantes.

Os blobs estão conferidos em [copias.log](logs/copias.log). Os testes do revisor foram montados por [montar-testes-revisor-r3.py](scripts/montar-testes-revisor-r3.py), com o mesmo arquivo nas quatro cópias.

| Comando | Cópia | Resultado | Log |
| --- | --- | --- | --- |
| `work-time-consistency`, `-guard`, `-income-estimate` | final | 101/101, 19/19, 22/22 | `logs/final-*.log` |
| os mesmos | R3.1 | reprovam 40, 2 e 1 | `logs/vermelho-r31-*.log` |
| os mesmos | rodada 2 | reprovam 14, 1 e 1, todos do F-08 | `logs/vermelho-9fdd-*.log` |
| testes do revisor (76) | final | 73/76. Reprovam só R3-01, R3-02 e R3-04 (F-R3-01) | [revisor-final.log](logs/revisor-final.log) |
| testes do revisor | R3.1 | 35/76. R3-01, R3-02 e R3-03 passam; R2-05 e R3-05 reprovam 18/30 cada; T1–T3 reprovam | [revisor-r31.log](logs/revisor-r31.log) |
| testes do revisor | rodada 2 | 40/76. Reprovam R2-01 a R2-03, R3-05 (30/30), R3-01, R3-02 e R3-04 | [revisor-9fdd.log](logs/revisor-9fdd.log) |
| exploração pura de `computeWorkTimeEstimate` | final | os cenários de R3-01 e R3-02 | [explorar-estimativa-pura.log](logs/explorar-estimativa-pura.log) |
| mutantes do revisor (31) | final | 30/31 por comportamento; R31 só pela guarda | [mutantes-revisor-r3.log](logs/mutantes-revisor-r3.log) |
| buscas e diffs (`git grep`, `git diff`) | árvores | só os testes negativos; nenhuma escrita | [buscas-e-diffs.log](logs/buscas-e-diffs.log) |
| leitura do log oficial `verify-all-r32-4` | — | saída 0; contagens no §1 | [verify-all-r32-4-sem-ansi.log](logs/verify-all-r32-4-sem-ansi.log) |

## 12. O que não foi possível verificar

- **E2E.** Não rodei nenhum. Usei a execução oficial `verify-all-r32-4`, verde. Não há E2E da indisponível com valores nem da rotina ambígua. Entre o `holdEstimate` e a tela só há React (`EstimateDetails.tsx`), então a unidade com o gancho real basta para este veredito.
- **A memória de cálculo renderizada.** Os componentes `.tsx` não rodam na unidade. Os textos das notas e das desconsideradas foram tirados do código (`EstimateDetails.tsx:201-225`) e das funções puras (`estimateNoteText`).
- **Documentação final.** O plano e o relatório ainda não registram o F-R3-01 nem o RR-R32-06 em `docs/`.
