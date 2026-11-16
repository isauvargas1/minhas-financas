PASS — Financial domain integrity

# P5-F.1-R3.2: parecer de integridade financeira, rodada 4 (revisão focada em ef514869 → 698f9644)

- **Revisão:** independente e somente leitura, com a skill `financial-domain-integrity`, sobre a mudança feita depois da rodada 3.
- **Árvore sob revisão:** `698f96441df1fbcd63467792c43cdb57b3911d9e`. A rodada 3 (`ef514869087c2b9e8e910a25fc7c18174418b8bb`) deu PASS com o F-R3-01 (LOW) aberto ([parecer da rodada 3](../rodada-3/PARECER.md)).
- **Pasta:** `<scratchpad>/p5f1r32/revisoes/financeiro/rodada-4`. Os caminhos relativos partem dela.

## 1. Veredito

**PASS.** Os três pontos pedidos estão confirmados por código, testes e mutantes.

1. **A lista fechada `DECIDED_BEFORE_INCOME`** (`business_not_confirmed`, `report_unavailable` e `exclusion_unconfirmed`) é a classificação certa pelo critério do F-08.
   - São exatamente os motivos que `computeWorkTimeEstimate` devolve antes de usar qualquer receita.
   - Todos saem com a base vazia e sem nota das bases.
   - Todo o resto espera a prova, inclusive um motivo novo (fail-closed).
2. **Os motivos de rotina ambígua passam a esperar a prova** (ADV-R3-01). Isso fecha o meu F-R3-01: as sondas R3-01, R3-02 e R4-03 reprovam em `ef514869` e passam na `698f9644`.
3. **Nenhuma conversão aparece sem a comprovação.** A pronta continua fora da lista, e `holdEstimate` mantém a mesma forma. Os mutantes que abrem a conversão morrem por comportamento. A varredura R2-05 dá 30/30, e a suíte de tempo de trabalho dá 284/284.

**Execução oficial `verify-all-r32-6`** (árvore `698f9644` no início e no fim): saída 0.

- Unidade sem falha: `test:unit:work-time` 284/284 e `test:unit:reports` 107/107.
- Integração e Rules completas: `[integração] fase completa`.
- E2E: 218 testes, todos passaram, entre eles o B03-g, o p5f:1230 e o "ADV-01 (R3.2)".
- Os três "Received SIGTERM" do log são o desligamento do Emulator de cada grupo do E2E, depois da fase de integração ([verify-all-r32-6-sem-ansi.log](logs/verify-all-r32-6-sem-ansi.log)).

## 2. Escopo conferido

- **Código** ([diff-src-ef51-698f.patch](logs/diff-src-ef51-698f.patch), [copias-e-buscas.log](logs/copias-e-buscas.log)). Só `useIncomeEstimateWith.ts` muda:
  - sai `carriesBasisFigures`, a regra da rodada 3 (`ready` ou `months` não vazio);
  - entram `DECIDED_BEFORE_INCOME` (`:113-117`) e `dependsOnIncomeReadings` (`:126-127`), definida como `!(unavailable && DECIDED_BEFORE_INCOME.has(reason))`;
  - `holdEstimate` (`:148-154`) segura todo `done` que `dependsOnIncomeReadings`, sem prova ou com a sincronização em curso.

  Em `consistency.ts` e no gancho, o resto são comentários. Nenhuma linha alterada tem escrita, armazenamento ou aritmética.
- **Sem diff:** `estimate.ts`, `messages.ts`, `incomeBasis.ts`, `projectionProof.ts`, `src/modules/reports`, os componentes, `functions/`, `firestore.rules`, `firestore.indexes.json`, `firebase.json` e `storage.rules`. A busca por `carriesBasisFigures` em `src/`, `tests/` e `e2e/` não acha nada: a regra antiga saiu inteira.
- **Testes:**
  - a tabela-verdade, a guarda e o comentário do E2E ([diff-guard-income-e2e-ef51-698f.patch](logs/diff-guard-income-e2e-ef51-698f.patch));
  - na consistência ([diff-consistency-ef51-698f.patch](logs/diff-consistency-ef51-698f.patch)), o laço `DEPENDS_ON_INCOME` com a véspera reduzida ambígua e as sondas R3-P1 a R3-P3 da adversarial.
- **Fora do domínio financeiro:** a mudança no executor do E2E (EST-R3-01) e os testes das ferramentas.

## 3. Ponto 1: a lista fechada é a classificação certa

**Critério do F-08:** pode aparecer sem prova só o estado que não traz nada tirado das leituras de receita: nem valor, nem nota, nem um motivo que dependa de quais meses têm renda.

- **Código** (`estimate.ts:159-172`, sem diff desde a R3.1). Antes de `applyIncomeExclusions` (`:172`) saem só três motivos, todos com `emptyBase`:
  - `business_not_confirmed` (`:160`) depende só do tipo do espaço e da preferência; as notas ainda estão vazias.
  - `report_unavailable` (`:164-166`) depende do estado do bloco e da presença dos meses da janela, não dos valores.
  - `exclusion_unconfirmed` (`:169-171`) depende do estorno da leitura por id e do mês do item na janela pedida, não da renda.

  Depois de `:172` vêm o corte dos meses sem renda (`:179-180`), a ambiguidade (`:189-192`) e os motivos com base preenchida.
- **A guarda nova** (`work-time-guard.test.ts:470-482`) fixa:
  - a lista e `dependsOnIncomeReadings` por expressão exata;
  - que os `unavailable(..., '<motivo>')` antes de `applyIncomeExclusions(` são exatamente os três;
  - que nenhum dos três aparece depois.
- **Propriedade pura, minha (R4-01):** 2.016 estimativas (4 calendários × 4 conjuntos de receitas × 7 de desconsideradas × 3 janelas × 3 fontes × exato ou não).
  - Os 1.408 casos com motivo da lista têm meses, renda, horas e desconsideradas zerados e no máximo a nota `business_income`. Não houve nenhuma violação.
  - A grade exercitou todos os motivos que importam aqui: `pronta`, `report_unavailable`, `business_not_confirmed`, `exclusion_unconfirmed`, `no_income`, `no_work_minutes`, `ambiguous_routines` e `ambiguous_reduced_eve` ([revisor-final.log](logs/revisor-final.log)).
  - É a propriedade que a regra da rodada 3 não cumpria (R3-04: 90 violações, todas nos ambíguos).
- **Fail-closed para motivo novo.** A tabela-verdade segura `'motivo_novo'` (`work-time-income-estimate.test.ts:184-187`). O mutante Q10, que troca a lista fechada por uma lista aberta dos motivos conhecidos, morre por ela.
- **O que ainda aparece sem prova.** `report_unavailable` e `exclusion_unconfirmed` podem sair de uma leitura de cache ou crua, sem confirmação. São afirmações de disponibilidade ("o relatório ainda não está disponível", "não foi possível confirmar o estorno"), sem número e sem conclusão financeira. É o "preservar estados legitimamente indisponíveis" do pedido, e eu aceito.
  - Na memória de cálculo, esses estados continuam com a frase "Você não desconsiderou nenhuma receita." mesmo com desconsiderada (F-R3-02, INFO, anterior, de texto).

## 4. Ponto 2: os motivos de rotina ambígua esperam a prova

- **Classificação:** os dois motivos ambíguos dependem das receitas. Ficam fora da lista e são segurados como a pronta e como a indisponível com valores.
- **Minhas sondas** (o mesmo arquivo nas duas cópias; [revisor-final.log](logs/revisor-final.log) × [revisor-ef51.log](logs/revisor-ef51.log)):

| Sonda | `ef514869` | `698f9644` |
| --- | --- | --- |
| R3-01: rotinas ambíguas e a desconsiderada editada antes do gatilho (a nota `exclusions_skipped` de um estado misto) | reprova: `indisponível ambiguous_routines notas=[exclusions_skipped(2026-10)]` sem prova | passa: `loading` até a prova, e depois `ambiguous_routines` sem nota |
| R3-02: véspera reduzida só em agosto; a renda de agosto anulada com a tela fora; o cache aquecido | reprova: `indisponível ambiguous_reduced_eve` antes do servidor | passa: `loading → pronta 704000` (setembro e outubro) |
| R4-03: rotinas que se cruzam, sem retorno do servidor | reprova: `loading → indisponível ambiguous_routines` | passa: `loading → erro(em atualização)`; com o retorno, a indisponível provada |

- **Testes do executor.** Reprovam em `ef514869` e passam na final ([vermelho-ef51-*.log](logs/) × [final-*.log](logs/)):
  - 3 do laço `DEPENDS_ON_INCOME` com a véspera reduzida ambígua: os 72–74;
  - as sondas R3-P1 a R3-P3: os 85–87;
  - a tabela-verdade e a guarda.

  São os mesmos 8 do `r33-vermelho` do executor. Na final dá 107/107, 19/19 e 22/22.
- **Lacuna de teste do executor** (INFO, continua o F-R3-03). Os testes do gancho só usam a véspera reduzida (`AMBIGUOUS_AUGUST`).
  - `ambiguous_routines`, das rotinas que se cruzam, é fixado no gancho só pelas minhas R3-01 e R4-03. No resto, só pela tabela-verdade pura.
  - O mutante Q04 (`ambiguous_routines` na lista) morre por 1 teste da suíte, a tabela-verdade, e por 2 meus.

## 5. Ponto 3: nenhuma conversão sem a comprovação

- A pronta nunca entra na lista: `dependsOnIncomeReadings` é verdadeira para todo `status !== 'unavailable'`. `holdEstimate` mantém a forma da R3.1 (`(!proven || settling) ? unproven : state`).
- **Na final:**
  - `test:unit:work-time` 284/284 ([final-unit-work-time.log](logs/final-unit-work-time.log)) e `test:unit:reports` 107/107 ([final-unit-reports.log](logs/final-unit-reports.log));
  - minhas R2-05 (30/30: 5 janelas × com/sem desconsiderada × sem conexão, escuta encerrada e divergência persistente, com a volta da conversão certa), T1–T5b, R2-01 a R2-04, R3-03, R3-05 (30/30) e R4-01 a R4-03: 79/79;
  - E2E B03-g, p5f:1230 e ADV-01 verdes na execução oficial.
- **Mutantes que abririam a conversão morrem por comportamento** (§6):
  - Q09 (só a pronta espera);
  - Q11 (sincronização ignorada);
  - Q13 (o gancho trata a indisponível como provada);
  - Q14 (R3-AUD-01 de volta);
  - Q15 (RR-R31-05 de volta).
- **Pontos do pedido sem mudança desde a rodada 3:** marcas (regras 4 e 5), `inexact`, D-29, centavos inteiros e nenhuma escrita. `consistency.ts` muda só em comentário, e `projectionProof.ts`, `estimate.ts` e `functions/` não mudam.

## 6. Mutantes

**Meus** ([mutantes-revisor-r4.py](scripts/mutantes-revisor-r4.py), [mutantes-revisor-r4.log](logs/mutantes-revisor-r4.log)).

- **Cada mutante roda três conjuntos:**
  - a suíte de comportamento: `work-time-consistency`, `-income-estimate`, `-estimate`, `report-basis-sync` e `-refresh`;
  - a guarda;
  - os meus 79 extras.
- **Linhas de base:** sem falha.
- **Restauração:** SHA-256 por arquivo, e a cópia é idêntica ao `git archive` de `698f9644` no fim ([copias-e-buscas.log](logs/copias-e-buscas.log)).
- **Carga:** nenhuma falha "tempo esgotado".

| Mutante | Comport. | Guarda | Extras | Juízo |
| --- | --- | --- | --- | --- |
| Q01 `exclusion_unconfirmed` fora da lista | 1 | 1 | 2 | MORTO (tabela-verdade; no gancho, só a minha R4-02) |
| Q02 `report_unavailable` fora da lista | 6 | 1 | 0 | MORTO |
| Q03 `business_not_confirmed` fora da lista | 11 | 1 | 0 | MORTO |
| Q04 `ambiguous_routines` na lista | 1 | 1 | 2 | MORTO (tabela-verdade; R3-01, R4-03) |
| Q05 `ambiguous_reduced_eve` na lista | 7 | 1 | 1 | MORTO |
| Q06 `no_work_minutes` na lista | 12 | 1 | 32 | MORTO |
| Q07 `no_income` na lista | 4 | 1 | 1 | MORTO |
| Q08 a regra da rodada 3 de volta | 7 | 1 | 3 | MORTO |
| Q09 a regra da rodada 2 de volta | 21 | 1 | 36 | MORTO |
| Q10 lista aberta (um motivo novo passaria) | 1 | 1 | 0 | MORTO (o `'motivo_novo'` da tabela-verdade) |
| Q11 `holdEstimate` ignora a sincronização | 6 | 1 | 0 | MORTO |
| Q12 o gancho ignora a sincronização só para a indisponível | **0** | 1 | 0 | **MORTO SÓ PELA GUARDA** (o mesmo R31 da rodada 3; F-R3-03) |
| Q13 o gancho trata toda indisponível como provada | 20 | 1 | 36 | MORTO |
| Q14 R3-AUD-01 de volta | 32 | 1 | 42 | MORTO |
| Q15 RR-R31-05 de volta (sem a projeção, a prova aprova sem desconsiderada) | 41 | 1 | 25 | MORTO |

**Total:** 14/15 mortos pela suíte de comportamento e 15/15 por algum conjunto.

**Do executor** ([r33-mutantes-cliente-novos.log](../../../logs/r33-mutantes-cliente-novos.log)): 6/6 mortos (N17, N18, N21, N22, N25 e N26), com a guarda no conjunto. Não li o roteiro dessa rodada. A lista de mutantes e as falhas citadas batem com as minhas: os ambíguos e a lista.

## 7. Achados

| Achado | Situação | Evidência |
| --- | --- | --- |
| F-R3-01 (LOW): os motivos de rotina ambígua apareciam sem prova | **Fechado** | §4: R3-01, R3-02 e R4-03 vermelhas em `ef514869` e verdes na `698f9644`; R4-01 sem violação; Q04, Q05 e Q08 mortos; a guarda fixa a lista e a posição dos três motivos em `computeWorkTimeEstimate` |
| F-R3-02 (INFO, produto e pt-BR, anterior): "Você não desconsiderou nenhuma receita." na indisponível sem valores com desconsiderada | **Aberto** | `EstimateDetails.tsx:201-204` sem diff. A R4-02 mostra `exclusion_unconfirmed` com `excludedCount: 0` e `A` desconsiderado. Sem valor; cabe à revisão de produto |
| F-R3-03 (INFO, testes) | **Aberto, reduzido** | Q12 (o R31 da rodada 3) continua morto só pela guarda: nenhum teste do gancho tem a indisponível que depende das receitas provada durante uma releitura. `ambiguous_routines` e o `exclusion_unconfirmed` mostrado como está só têm teste de gancho nos meus extras (R3-01, R4-03, R4-02). Sugestão: adotar R4-01 a R4-03 e um caso com a indisponível provada sincronizando |
| F-08 (MEDIUM, rodada 2) | Fechado na rodada 3, sem regressão | Q06, Q07 e Q09 mortos; sondas R2-01 a R2-03 e R3-05 verdes |
| F-01 (LOW, anterior) | Aberto como risco residual (RR-R32-06 no rascunho do relatório) | `estimate.ts` e `hooks.ts` sem diff; T5 e T5b verdes |
| F-05 (INFO, backend) | Aberto como sugestão, fora da etapa | `functions/` sem diff |

**Achados novos da rodada 4:** nenhum.

## 8. Comandos executados

Todos nas minhas cópias (`git archive` de `698f9644`; a `copia-ef51` é a mesma com os dois arquivos de `src/` de `ef514869`, blobs conferidos em [copias.log](logs/copias.log)), um de cada vez, sob `nice -n 19 node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 --test-reporter=tap`.

- Não rodei Emulator, Playwright, E2E, `verify:*` nem `test:integration*`.
- Não acessei produção nem li segredos.
- Nada foi alterado em `$W`. O índice continua com a data de 11/11, 11:47:49, e não rodei `git write-tree`.
- Os testes do revisor foram montados por [montar-testes-revisor-r4.py](scripts/montar-testes-revisor-r4.py): o arquivo de consistência da cópia, os T1–T5b da rodada 1, as sondas da rodada 3 sem a R3-04 (que testava a regra da rodada 3) e as da rodada 4 ([r4-sondas.ts.part](testes-revisor/r4-sondas.ts.part)).

| Comando | Cópia | Resultado | Log |
| --- | --- | --- | --- |
| `work-time-consistency`, `-guard`, `-income-estimate` | final | 107/107, 19/19, 22/22 | `logs/final-work-time-*.log` |
| os mesmos | `src/` de ef514869 | reprovam 6, 1 e 1, todos do ADV-R3-01 | `logs/vermelho-ef51-*.log` |
| `test:unit:work-time` (10 arquivos) e `test:unit:reports` (7) | final | 284/284 e 107/107 | [final-unit-work-time.log](logs/final-unit-work-time.log), [final-unit-reports.log](logs/final-unit-reports.log) |
| testes do revisor (79) | final | 79/79 | [revisor-final.log](logs/revisor-final.log) |
| testes do revisor | `src/` de ef514869 | 76/79: reprovam R3-01, R3-02 e R4-03 | [revisor-ef51.log](logs/revisor-ef51.log) |
| mutantes do revisor (15) | final | 14/15 por comportamento; Q12 só pela guarda | [mutantes-revisor-r4.log](logs/mutantes-revisor-r4.log) |
| diffs e buscas | árvores | só o gancho muda; `carriesBasisFigures` removida; nenhuma escrita | [copias-e-buscas.log](logs/copias-e-buscas.log) |
| leitura da execução oficial `verify-all-r32-6` | — | saída 0; §1 | [verify-all-r32-6-sem-ansi.log](logs/verify-all-r32-6-sem-ansi.log) |

## 9. O que não foi possível verificar

- **E2E.** Não rodei nenhum, por regra. Usei a `verify-all-r32-6` oficial e o `e2e-p5f-r33-1` do executor (20/20), ambos na `698f9644`. Não há E2E com rotina ambígua. A prova é a unidade com o gancho real, e entre o `holdEstimate` e a tela só há React.
- **Memória de cálculo renderizada.** Os `.tsx` não rodam na unidade, então os textos vêm do código (`EstimateDetails.tsx`, sem diff).
- **Documentação.** Não conferi o plano nem o relatório finais em `docs/`, que o executor escreve depois.
