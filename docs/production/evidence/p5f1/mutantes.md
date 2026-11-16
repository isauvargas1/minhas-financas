# P5-F.1 — mutantes: os testes não são vazios

Cada mutante introduz um defeito plausível e roda o teste que deveria pegá-lo. Está morto quando o teste falha.

- **Unidade, guarda e Rules** (`mutantes.py.txt`): cada mutante é aplicado no worktree, testado e revertido; o roteiro confere o SHA-256 do arquivo depois de restaurar e para se a troca não casar exatamente uma vez. Desde a revisão 4, antes de testar, o arquivo mutado passa pelo esbuild (o mesmo da build): mutante que não compila sai como "não compila", nunca como morto (R4-06). O `git status` do worktree foi conferido igual antes e depois de cada rodada. As Rules rodam dentro do `firebase emulators:exec` (Emulator `minhas-financas-local`).
- **Mutantes da P5-F** (`mutantes-p5f-na-p5f1.py.txt`): os 59 mutantes de unidade e guarda do roteiro da P5-F, rodados contra as suítes da P5-F.1 em cópias fora do worktree, para provar que nada da P5-F foi enfraquecido.
- **E2E** (`e2e-mutante.py.txt`, desde a revisão 2): cada mutante num build temporário, com o teste do comportamento; o arquivo é restaurado byte a byte (SHA-256 conferido).

## Resultado

| Rodada | Resultado |
| --- | --- |
| Unidade e guarda, final | **184/184 mortos, 0 não compilam** (revisão 10: 182/184 na rodada completa, `mutantes-unit-r10`, e os 2 sobreviventes mortos com um teste novo e uma parte nova do teste do registro, `mutantes-unit-r10-sobreviventes`; antes, 174/174 depois da correção da reprovação nas repetições da revisão 9, `mutantes-unit-r9b`, e 172/172 na revisão 9, `mutantes-unit-r9`) |
| Rules no Emulator, final | **11/11 mortos** (Rules e suíte sem mudança desde a revisão 3; rodados de novo depois das correções da revisão 9, `mutantes-rules-r9`; a revisão 10 não mudou `firestore.rules` nem a suíte, com o mesmo SHA-256; cada mutante foi conferido: tira uma condição ou troca uma expressão por outra válida) |
| P5-F contra a P5-F.1 | 52 dos 59 ainda se aplicam; **52/52 mortos**. Os 7 restantes miram código substituído (contrato v1, `form.ts`, teto de renda do v1). Os equivalentes no v2 estão entre os de unidade: U29, U30 e U34 para K4, K8 e K6, os de `draft.ts` para F1–F3 e os da guarda sobre `firestore.rules` para G20 |
| E2E da revisão 1 | morto: com a escuta das projeções desligada, o teste de receita retroativa com outro workspace ativo reprova (a prévia fica em R$ 25,00 em vez de R$ 25,68) |
| E2E da revisão 2, R2-02 | morto: sem a releitura das leituras de receitas na divergência (`invalidateIncomeReads`), o teste 8 reprova: a receita desconsiderada e anulada em outra sessão continua descontada, e a nota de que ela não muda mais a estimativa não aparece |
| E2E da revisão 2, R2-07 | morto: com "Ver receitas consideradas" habilitado sem fonte, o teste 9 reprova (o botão deveria estar desabilitado) |
| E2E da revisão 2, R2-06 | morto: sem a adoção do modo trocado pelo Header durante a edição, o teste 10 reprova (o rádio "Tempo de trabalho" não fica marcado e salvar desfaria o clique) |
| E2E da revisão 3, R3-03 | morto: sem a retenção da última estimativa consistente, o teste 8 reprova (o observador vê, por um instante, a base nova com a exclusão antiga na prévia) |
| E2E da revisão 4, R4-01 | morto nas duas rodadas: com a mutação nesta aba relendo todas as leituras de lançamentos (`predicate: () => true` em `invalidateTransactionReads`), o teste 13 reprova: o observador vê "R$ 25,68" na prévia (a receita anulada somada ao total velho, com a exclusão já ignorada) antes de "R$ 25,00". Rodado na revisão 4 (`e2e-mutante-r401`) e de novo sobre o código da revisão 5 (`e2e-mutante-r401b`) |
| E2E da revisão 4, R1-03 | morto: com o erro da escuta da preferência engolido (o estado de erro não é posto em `WorkTimeContext.tsx`), o teste 14 reprova: o aviso de Configurações não aparece (`e2e-mutante-r103`; o arquivo e o teste não mudaram na revisão 5) |
| E2E da revisão 6, R6-01 | morto: sem a reabertura das escutas encerradas pelo retorno do servidor a outra escuta (`reopenFailedListeners` no retorno, `e2e-mutante-r601`), o teste 15 reprova: depois de abrir Configurações, o topo continua com a ressalva da atualização que falhou |

**Rodadas anteriores:**
- unidade 53/54 na 1ª: a posição no ciclo antes da referência sobreviveu (`Math.abs` coincide com o módulo em ciclos de 1 dia de trabalho), e o teste ganhou o ciclo 6×1 para trás;
- Rules 7/8 na 1ª: `allow list` com a condição do titular sobreviveu, porque a consulta do titular filtrada pelo próprio id não era testada; a suíte passou a exigir a negação, e entrou um mutante mais forte ("titular lista");
- na rodada da revisão 1, U02 teve o trecho atualizado depois da correção do intervalo (R1-05), que extraiu `spill`;
- na rodada da revisão 2, U14, U54 e U55 tiveram o trecho atualizado para o código novo, com a mesma intenção (feriado com escala classificado como trabalhado; teto de falhas aplicado pelo gancho; escuta ligada pela estimativa), e entraram U65–U84 (atualização por divergência, falhas, releituras dependentes, paginação com um a mais, estorno dentro da janela, mensagens, eleições de 2020, classificação do feriado pelo resultado e ressalvas do aviso) e R10–R11 (escuta das projeções só para membros e com limite). Antes da rodada, todos os trechos foram conferidos (nenhum ausente ou repetido).
- na rodada da revisão 3, a lógica da base saiu de `hooks.ts` para `basisSync.ts` (testada com ganchos reais), a paginação para `paging.ts` e o tratamento do estorno para funções puras: 13 trechos (U14, U54, U55, U65, U70–U75, U79–U81) foram atualizados para o código novo com a mesma intenção, e entraram U85–U98 (retorno do cache, convergência, base sem bloco exato, invalidação que reabre a base, aviso da atualização que falhou, marco das releituras, retenção, painel). Na 1ª rodada, 97/98: o mutante que tira `cancelRefetch: false` sobreviveu, porque a retenção pelo marco de dados já garante a consistência; o teste de duas estimativas passou a exigir uma releitura só das exclusões, e ele morre.
- na rodada da revisão 4: U14 deixou de remover a linha (o `else if` seguinte ficava solto e o arquivo não compilava, mas o roteiro contava a falha como morte) e passou a trocar a condição por `false`; a estimativa saiu para `useIncomeEstimateWith.ts` e a sincronização ganhou critério de chegada das bases e marco sem relógio, então 13 trechos (U55, U60, U71, U72, U75, U84, U86–U88, U90, U93, U96 e U97) foram atualizados com a mesma intenção (U75 passou a mirar o pareamento do estorno pelo movimento, porque o caso "estorno depois do período" saiu com R4-04); entraram U99–U115 (mutação nesta aba, base que carrega, chegada de todas as bases, teto que só a projeção e a virada do mês reabrem, base sem dado fora do agendador, marco por igualdade, aviso do estorno e a regra de retenção). Antes da rodada, os 126 trechos foram conferidos (nenhum ausente ou repetido), e o roteiro passou a separar o que não compila.
- na rodada da revisão 5: a leitura por id passou a seguir só a sincronização, a mutação voltou a reler a base (sem zerar o teto), a escuta com erro ganhou aviso e reabertura, e a escuta passou a reler só as bases da própria estimativa; 3 trechos foram atualizados com a mesma intenção (U90, U97 e U107) e entraram U116–U130 (leitura por id sem prazo nem releitura na volta da rede, o pedido sem marcar as leituras de receitas, bases sem releitura na montagem, só as bases da estimativa, a releitura da mutação, o teto e o workspace dela, a escuta com erro e a reabertura, o descarte do pedido e da espera na troca de workspace e as duas liberações com a chegada conferida). Antes da rodada, os 141 trechos foram conferidos.
- na rodada da revisão 6: a base nova que chega sem pedido passou a ser segurada já na renderização, com as leituras de receitas relidas depois dela; a leitura nova sem pedido deixou de pedir releitura; a escuta encerrada deixou de valer para comparação e passou a ser reaberta entre estimativas; e a releitura da mutação ganhou agendador e orçamento próprios. 3 trechos foram atualizados com a mesma intenção (U97, U109 e U130). O U102 foi trocado: ele era equivalente desde a revisão 5 e só morria pelo teste intermitente (R6-04); o novo é o pedido em curso sem projeção, que deve terminar quando as bases chegam. Entraram U131–U143: a retenção na renderização, a liberação depois da base nova, a leitura sem pedido que não pede, a projeção descartada na escuta encerrada, as duas reaberturas e o registro, o agendador e o orçamento da mutação, o par das leituras com a base da liberação (no efeito e na renderização) e a limpeza do registro e do agendador. Antes da rodada, os 154 trechos foram conferidos.
- na rodada da revisão 7: a base nova sem pedido passou a comparar todos os meses da base e a liberar só com todas as bases fora de leitura, e a leitura que começou antes do último retorno do servidor voltou a comparar e pedir. 3 trechos foram atualizados com a mesma intenção (U131, U132 e U133). Entraram U144–U151: a condição da leitura cruzada, a contagem dos retornos, o começo de cada leitura, a espera das bases em leitura, a comparação de todos os meses no efeito e na renderização, a função pura e a fiação de `fetching`. Antes da rodada, os 162 trechos foram conferidos.
- na rodada da revisão 8: com mais de uma base, a base nova sem pedido passou a esperar também a releitura pendente de qualquer uma, nos dois agendadores, quando pedida depois do começo da última leitura da base (todo pedido de releitura passa pelo registro, que guarda a ordem dele), e uma leitura com dados passou a zerar as falhas também sem a base desatualizada (a base relida com sucesso sai do teto). 2 trechos foram atualizados com a mesma intenção (U54 e U138: o pedido pelo registro). Entraram U152–U166: a espera da releitura pendente, a base só que não espera, cada um dos dois agendadores no registro, o `scheduled` do agendador, o zerar das falhas sem a base desatualizada, a falha sem a base desatualizada contada e relida de novo, a falha da releitura da mutação contada para o teto, e, só com o teste de comportamento da estimativa inteira (sem a guarda), as dependências do `useMemo` da base (X1), `fetching` só da série (X2) e `fetching: false` (o U151 sem a guarda), além da leitura cruzada que exige versão nova (X3) e, por fim, a ordem dos pedidos e dos começos de leitura (U164–U166). As duas primeiras rodadas foram interrompidas de propósito, com a correção ainda mudando; desde a 1ª, `mutantes.py` trata o SIGTERM e restaura o arquivo em teste.
- na rodada da revisão 9: a espera da revisão 8 saiu da liberação das leituras dependentes e virou a retenção das bases fora de passo, na renderização, com ou sem leitura dependente; a base que sai de uso com releitura pendente passou a ficar desatualizada; o estado mostrado durante a retenção deixou de ser guardado; e a falha sem a base desatualizada passou a ficar registrada sem contar. 6 trechos foram atualizados com a mesma intenção (U97, U114, U152, U153, U157 e U159). Entraram U167–U172: a retenção das bases fora de passo tirada de `holding`, a retenção sem a base em leitura, a base que sai de uso sem ficar desatualizada, o estado mostrado durante a retenção guardado de novo, a falha sem a base desatualizada sem registro e a espera devolvida à liberação das leituras dependentes.
- nas repetições da revisão 9, depois das correções: a leitura dependente passou a ir pelo objeto do resultado, e a leitura por id, sem compartilhamento de estrutura (um objeto novo a cada leitura concluída). 2 trechos foram atualizados com a mesma intenção (U55 e U117), e entraram U173 (sem `structuralSharing: false`) e U174 (a sincronização de volta ao `dataUpdatedAt`), os dois testados só contra a estimativa inteira
- na rodada da revisão 10: as bases fora de passo passaram à regra "à frente" (a ordem dos dados em uso e os pedidos que eles não cobrem), a busca pausada passou a contar como leitura, e a base que sai de uso com releitura pendente passou a ficar marcada e a ser relida na volta. 12 trechos foram atualizados com a mesma intenção (U151, U152, U154, U155, U160–U162, U164–U166, U168 e U169), e entraram U175–U184. Sobreviveram U153 e U176, por falta de teste (uma base só em releitura; a leitura que falha no registro): com um teste novo (a base única) e uma parte nova do teste do registro (a leitura que falha), morreram na rodada só deles

## Unidade e guarda

| ID | Grupo | Arquivo | Trecho original | Mutação | Testes | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| U01 | calendar | `src/modules/work-time/calendar.ts` | `if (holidayEffect === 'removed_work') minutes = 0;` | (remove) | work-time-calendar | morto |
| U02 | calendar | `src/modules/work-time/calendar.ts` | `const overlap = intersectionLength(merged, spill);` | `const overlap = 0;` | work-time-calendar | morto |
| U03 | calendar | `src/modules/work-time/calendar.ts` | `totalLength(merged) - overlap - routineDay.breaks` | `totalLength(merged) - overlap` | work-time-calendar | morto |
| U04 | calendar | `src/modules/work-time/calendar.ts` | `const merged = mergeIntervals(routineDay.windows);` | `const merged = routineDay.windows;` | work-time-calendar | morto |
| U05 | calendar | `src/modules/work-time/calendar.ts` | `const capped = minutes > DAY_MINUTES;` | `const capped = false;` | work-time-calendar | morto |
| U06 | calendar | `src/modules/work-time/calendar.ts` | `} else if (flags.reduced !== null && minutes > flags.reduced) {` | `} else if (flags.reduced !== null) {` | work-time-calendar | morto |
| U07 | calendar | `src/modules/work-time/calendar.ts` | `if (flags.absence !== null && minutes > 0) {` | `if (false) {` | work-time-calendar | morto |
| U08 | calendar | `src/modules/work-time/calendar.ts` | `const position = ((diff % length) + length) % length;` | `const position = Math.abs(diff % length);` | work-time-calendar | morto |
| U09 | calendar | `src/modules/work-time/calendar.ts` | `end > start ? end - start : DAY_MINUTES - start + end;` | `end >= start ? end - start : DAY_MINUTES - start + end;` | work-time-calendar | morto |
| U10 | calendar | `src/modules/work-time/calendar.ts` | `if (calendar.worksOnHolidays \|\| flags.holidayWorked) return 'worked'…` | `if (flags.holidayWorked) return 'worked';` | work-time-calendar | morto |
| U11 | calendar | `src/modules/work-time/calendar.ts` | `flags.holidayWorked = true;` | `flags.holidayWorked = false;` | work-time-calendar | morto |
| U12 | calendar | `src/modules/work-time/calendar.ts` | `if (entry.date === date) flags.additions.push({ kind: entry.kind, minu…` | (remove) | work-time-calendar | morto |
| U13 | calendar | `src/modules/work-time/calendar.ts` | `totalLength(merged) - overlap - routineDay.breaks, largestWindow);` | `totalLength(merged) - overlap - routineDay.breaks);` | work-time-calendar | morto |
| U14 | calendar | `src/modules/work-time/calendar.ts` | `if (minutes > 0) finalHolidayEffect = 'worked';` | `if (false) finalHolidayEffect = 'worked';` | work-time-calendar | morto |
| U15 | feriados | `src/modules/work-time/holidays.ts` | `law: 'Lei nº 14.759/2023', fromYear: 2024 }` | `law: 'Lei nº 14.759/2023', fromYear: 2023 }` | work-time-calendar | morto |
| U16 | feriados | `src/modules/work-time/holidays.ts` | `{ month: 11, day: 2, name: 'Finados', law: LEI_662, fromYear: 2003 },` | (remove) | work-time-calendar | morto |
| U17 | feriados | `src/modules/work-time/holidays.ts` | `const day = ((h + l - 7 * m + 114) % 31) + 1;` | `const day = ((h + l - 7 * m + 114) % 31) + 2;` | work-time-calendar | morto |
| U18 | feriados | `src/modules/work-time/holidays.ts` | `offsetFromEaster: 60 }` | `offsetFromEaster: 61 }` | work-time-calendar | morto |
| U19 | feriados | `src/modules/work-time/holidays.ts` | `return addDays(first, (6 - weekdayIndex(first) + 7) % 7);` | `return addDays(first, (7 - weekdayIndex(first)) % 7);` | work-time-calendar | morto |
| U20 | feriados | `src/modules/work-time/holidays.ts` | `year % 2 !== 0) return null;` | `false) return null;` | work-time-calendar | morto |
| U21 | gramática | `src/modules/work-time/grammar.ts` | `02-(?:0[1-9]\|1[0-9]\|2[0-8]))\|20(?:[02468][048]\|[13579][26])-02-29)` | `02-(?:0[1-9]\|1[0-9]\|2[0-9]))\|20(?:[02468][048]\|[13579][26])-02-29)` | work-time-grammar, work-time-guard | morto |
| U22 | gramática | `src/modules/work-time/grammar.ts` | `export const MINUTES_1_PATTERN = '(?:[1-9][0-9]{0,2}\|` | `export const MINUTES_1_PATTERN = '(?:[0-9][0-9]{0,2}\|` | work-time-grammar | morto |
| U23 | gramática | `src/modules/work-time/grammar.ts` | `if (spans.some((other) => span.start <= other.end && other.start <= sp…` | (remove) | work-time-grammar, work-time-preference | morto |
| U24 | gramática | `src/modules/work-time/grammar.ts` | `return formatExceptions(entries) === text ? entries : null;` | `return entries;` | work-time-grammar | morto |
| U25 | gramática | `src/modules/work-time/grammar.ts` | `export const MAX_EXCEPTIONS = 120;` | `export const MAX_EXCEPTIONS = 121;` | work-time-grammar | morto |
| U26 | gramática | `src/modules/work-time/grammar.ts` | `return spec.breakMinutes >= 0 && spec.breakMinutes < windowLengthOf(sp…` | `return spec.breakMinutes >= 0;` | work-time-grammar, work-time-preference | morto |
| U27 | gramática | `src/modules/work-time/grammar.ts` | `if (!routines.every(isValidRoutine) \|\| !routines.some(routineHasWork…` | `if (!routines.every(isValidRoutine)) return null;` | work-time-grammar, work-time-preference | morto |
| U28 | gramática | `src/modules/work-time/grammar.ts` | `export const ROUTINES_LIST_PATTERN = `(?:${ROUTINE_PATTERN};){1,3}`;` | `export const ROUTINES_LIST_PATTERN = `(?:${ROUTINE_PATTERN};){1,4}`;` | work-time-grammar, work-time-guard | morto |
| U29 | contrato | `src/modules/work-time/contract.ts` | `isWorkTimeEnabled(preference) && preference.displayMode === 'time' ? '…` | `preference !== null && preference.displayMode === 'time' ? 'time' : 'm…` | work-time-preference | morto |
| U30 | contrato | `src/modules/work-time/contract.ts` | `if (!excludedIncomeIds \|\| !routines \|\| !localHolidays \|\| !except…` | `if (!excludedIncomeIds \|\| !localHolidays \|\| !exceptions) return nu…` | work-time-preference | morto |
| U31 | contrato | `src/modules/work-time/contract.ts` | `if (keys.length !== WORK_TIME_PREFERENCE_FIELDS.length) return null;` | (remove) | work-time-preference | morto |
| U32 | contrato | `src/modules/work-time/contract.ts` | `if (data.schemaVersion !== WORK_TIME_SCHEMA_VERSION) return null;` | (remove) | work-time-preference | morto |
| U33 | contrato | `src/modules/work-time/contract.ts` | `if (!isMunicipality(data.municipality)) return null;` | (remove) | work-time-preference | morto |
| U34 | contrato | `src/modules/work-time/contract.ts` | `'exceptions', 'updatedAt', ] as const;` | `'exceptions', 'updatedAt', 'incomeCents', ] as const;` | work-time-preference, work-time-guard | morto |
| U35 | contrato | `src/modules/work-time/contract.ts` | `if (!roundTrip) throw new Error` | `if (false) throw new Error` | work-time-preference | morto |
| U36 | estimativa | `src/modules/work-time/estimate.ts` | `const used = input.mode === 'habitual' && firstWithIncome > 0 ? basis.…` | `const used = basis;` | work-time-estimate | morto |
| U37 | estimativa | `src/modules/work-time/estimate.ts` | `if (!input.allowBusinessIncome) return unavailable(emptyBase, 'busines…` | (remove) | work-time-estimate | morto |
| U38 | estimativa | `src/modules/work-time/estimate.ts` | `if (!input.reportExact \|\| window.length === 0` | `if (window.length === 0` | work-time-estimate | morto |
| U39 | estimativa | `src/modules/work-time/estimate.ts` | `} else if (months.length < input.historyMonths) {` | `} else if (false) {` | work-time-estimate | morto |
| U40 | estimativa | `src/modules/work-time/estimate.ts` | `if (input.mode === 'current_month') { provisional = true;` | `if (input.mode === 'current_month') { provisional = false;` | work-time-estimate | morto |
| U41 | estimativa | `src/modules/work-time/estimate.ts` | `for (let offset = historyMonths; offset >= 1; offset -= 1) {` | `for (let offset = historyMonths; offset >= 0; offset -= 1) {` | work-time-estimate | morto |
| U42 | estimativa | `src/modules/work-time/estimate.ts` | `(mode === 'habitual' && historyMonths === 12 ? shiftMonthKey(currentMo…` | `(mode === 'habitual' && historyMonths === 12 ? shiftMonthKey(currentMo…` | work-time-estimate | morto |
| U43 | receitas | `src/modules/work-time/incomeBasis.ts` | `const pending = data.isPaid === false \|\| (isRecord(cashEntry) && cas…` | `const pending = data.isPaid === false;` | work-time-estimate | morto |
| U44 | receitas | `src/modules/work-time/incomeBasis.ts` | `contributionCents: entry.principalCents === 0 ? 0 : -entry.principalCe…` | `contributionCents: entry.principalCents };` | work-time-estimate | morto |
| U45 | receitas | `src/modules/work-time/incomeBasis.ts` | `if (data.loanEntry !== undefined) return ZERO('loan');` | (remove) | work-time-estimate | morto |
| U46 | receitas | `src/modules/work-time/incomeBasis.ts` | `if (data.voidedAt !== undefined && data.voidedAt !== null) return ZERO…` | (remove) | work-time-estimate | morto |
| U47 | receitas | `src/modules/work-time/incomeBasis.ts` | `if (eligible < 0) {` | `if (false) {` | work-time-estimate | morto |
| U48 | receitas | `src/modules/work-time/incomeBasis.ts` | `(classification.kind === 'income' \|\| classification.kind === 'receiv…` | `classification.contributionCents !== 0;` | work-time-estimate | morto |
| U49 | receitas | `src/modules/work-time/incomeBasis.ts` | `possibleDuplicate: excludable && (counts.get(duplicateKey(document)) ?…` | `possibleDuplicate: false,` | work-time-estimate | morto |
| U50 | cálculo | `src/modules/work-time/calculation.ts` | `export const WORK_TIME_MAX_WORK_MINUTES = 744 * 60 * WORK_TIME_MAX_WIN…` | `export const WORK_TIME_MAX_WORK_MINUTES = 744 * 60 * 13;` | work-time-calculation | morto |
| U51 | cálculo | `src/modules/work-time/calculation.ts` | `if (income * 60 < minutes) return` | `if (income * 59 < minutes) return` | work-time-calculation | morto |
| U52 | rascunho | `src/modules/work-time/draft.ts` | `text.normalize('NFC').replace(` | `text.replace(` | work-time-preference | morto |
| U53 | guarda | `src/modules/reports/hooks.ts` | `limit(BASIS_PERIODS_MAX),` | `limit(600),` | work-time-guard | morto |
| U54 | base | `src/modules/reports/basisSync.ts` | `if (decision.notify) scheduleBasisReread(refreshKey, entry.scheduler);` | `scheduleBasisReread(refreshKey, entry.scheduler);` | report-basis-sync, work-time-guard | morto |
| U55 | guarda | `src/modules/work-time/useIncomeEstimateWith.ts` | `deps.basis, uid, workspaceId, windowMonths, basis, needsExcluded ? exc…` | `deps.basis, uid, workspaceId, windowMonths, basis, needsExcluded ? exc…` | work-time-guard, work-time-income-estimate | morto |
| U56 | rascunho | `src/modules/work-time/draft.ts` | `if (end < input.start) return { ok: false, field: 'end'` | `if (false) return { ok: false, field: 'end'` | work-time-preference | morto |
| U57 | rascunho | `src/modules/work-time/draft.ts` | `if (clash) return { ok: false` | `if (false) return { ok: false` | work-time-preference | morto |
| U58 | rascunho | `src/modules/work-time/draft.ts` | `if (!isValidDaySpec(spec)) return { ok: false, message: 'O intervalo p…` | `if (false) return { ok: false, message: 'O intervalo precisa ser menor` | work-time-preference | morto |
| U59 | guarda | `src/modules/work-time/WorkTimeContext.tsx` | `}, [uid, retryNonce]);` | `}, [retryNonce]);` | work-time-guard | morto |
| U60 | guarda | `src/modules/reports/queryKeys.ts` | `queryClient.invalidateQueries({ queryKey: [FINANCIAL_REPORT_BASIS_KEY]…` | `queryClient.invalidateQueries({ queryKey: [FINANCIAL_REPORT_BASIS_KEY]…` | work-time-guard, report-range | morto |
| U61 | guarda | `src/modules/work-time/display.tsx` | `const config = !forcedMoney && workTime?.displayMode === 'time' ? work…` | `const config = workTime?.config ?? null;` | work-time-guard | morto |
| U62 | guarda | `firestore.rules` | `data.exceptions.split(';').size() <= 120 &&` | (remove) | work-time-guard | morto |
| U63 | guarda | `firestore.rules` | `return '(?:[1-9][0-9]{0,2}\|1[0-3][0-9][0-9]\|14[0-3][0-9]\|1440)';` | `return '(?:[0-9][0-9]{0,2}\|1[0-3][0-9][0-9]\|14[0-3][0-9]\|1440)';` | work-time-guard | morto |
| U64 | guarda | `src/modules/work-time/api.ts` | `setDoc(preferenceRef(uid), { ...workTimePreferenceFields(preference), …` | `setDoc(preferenceRef(uid), { ...workTimePreferenceFields(preference), …` | work-time-guard | morto |
| U65 | basis | `src/modules/reports/basisRefresh.ts` | `if (used >= BASIS_DIVERGENCE_RETRIES) return { refresh: false, signatu…` | (remove) | report-basis-refresh | morto |
| U66 | basis | `src/modules/reports/basisRefresh.ts` | `): boolean => months.some((month) =>` | `): boolean => months.every((month) =>` | report-basis-refresh | morto |
| U67 | basis | `src/modules/reports/basisRefresh.ts` | `return { notify: next.failures < limit, state: next };` | `return { notify: true, state: next };` | report-basis-refresh | morto |
| U68 | basis | `src/modules/reports/basisRefresh.ts` | `&& query.errorUpdatedAt !== next.errorUpdatedAt) {` | `) {` | report-basis-refresh | morto |
| U69 | basis | `src/modules/reports/basisRefresh.ts` | `if (Number.isSafeInteger(document.incomeCents)) income[document.id]` | `if (document.incomeCents !== undefined) income[document.id]` | report-basis-refresh | morto |
| U70 | base | `src/modules/reports/basisRegistry.ts` | `entry.failure = { ...entry.failure, failures: 0 };` | (remove) | report-basis-sync | morto |
| U71 | base | `src/modules/reports/basisSync.ts` | `if (key !== null) void refreshIncomeReads(queryClient, workspaceId as …` | (remove) | report-basis-sync | morto |
| U72 | base | `src/modules/transactions/incomeReads.ts` | `const KINDS: readonly IncomeReadKind[] = ['by-ids', 'income-window'];` | `const KINDS: readonly IncomeReadKind[] = ['income-window'];` | report-basis-sync, work-time-income-estimate | morto |
| U73 | paginação | `src/modules/transactions/paging.ts` | `const read = await readPage(cursor, pageSize + 1);` | `const read = await readPage(cursor, pageSize);` | transactions-paging | morto |
| U74 | paginação | `src/modules/transactions/paging.ts` | `if (read.length <= pageSize) return { docs, truncated: false };` | `if (read.length < pageSize) return { docs, truncated: false };` | transactions-paging | morto |
| U75 | receitas | `src/modules/work-time/incomeBasis.ts` | `reversed: movementId !== null && reversals.has(movementId),` | `reversed: reversals.size > 0,` | work-time-estimate | morto |
| U76 | mensagens | `src/modules/work-time/messages.ts` | `if (source === 'excluded') return ESTIMATE_EXCLUDED_READ_FAILED;` | (remove) | work-time-estimate | morto |
| U77 | feriados | `src/modules/work-time/holidays.ts` | `if (ELECTIONS_POSTPONED_YEARS.includes(year)) return null;` | (remove) | work-time-calendar | morto |
| U78 | feriados | `src/modules/work-time/holidays.ts` | `return addDays(last, -((weekdayIndex(last) + 1) % 7));` | `return addDays(last, -(weekdayIndex(last) % 7));` | work-time-calendar | morto |
| U79 | calendar | `src/modules/work-time/calendar.ts` | `else if (holidayEffect === 'removed_work' && flags.scheduleChange === …` | `else if (holidayEffect === 'removed_work') finalHolidayEffect = 'remov…` | work-time-calendar | morto |
| U80 | calendar | `src/modules/work-time/calendar.ts` | `else finalHolidayEffect = 'rest_day';` | (remove) | work-time-calendar | morto |
| U81 | calendar | `src/modules/work-time/calendar.ts` | `if (markedWorked && minutes > 0) applied.push('holiday_worked');` | `if (markedWorked) applied.push('holiday_worked');` | work-time-calendar | morto |
| U82 | mensagens | `src/modules/work-time/messages.ts` | `estimate.workspaceType === 'PJ' ? ESTIMATE_QUALIFIER_BUSINESS : null,` | `null,` | work-time-estimate | morto |
| U83 | mensagens | `src/modules/work-time/messages.ts` | `: estimate.provisional ? ESTIMATE_QUALIFIER_PROVISIONAL : null,` | `: null,` | work-time-estimate | morto |
| U84 | guarda | `src/modules/work-time/useIncomeEstimateWith.ts` | `message: estimateFailureMessage('excluded', excluded.error), retry };` | `message: String(excluded.error), retry };` | work-time-guard | morto |
| U85 | base | `src/modules/reports/basisSync.ts` | `if (snapshot.fromCache) return;` | (remove) | report-basis-sync | morto |
| U86 | base | `src/modules/reports/basisSync.ts` | `if (decision.converged) { attempts.current.clear();` | `if (decision.converged) {` | report-basis-sync | morto |
| U87 | base | `src/modules/reports/basisSync.ts` | `if (!synced \|\| snapshot.changes > 0) changed.current = true;` | `if (!synced) changed.current = true;` | report-basis-sync | morto |
| U88 | base | `src/modules/reports/basisSync.ts` | `if (current.exact) { changed.current = false;` | `if (true) { changed.current = false;` | report-basis-sync | morto |
| U89 | base | `src/modules/reports/queryKeys.ts` | `refreshRegisteredBases();` | (remove) | report-basis-sync, work-time-guard | morto |
| U90 | guarda | `src/modules/work-time/useIncomeEstimateWith.ts` | `const refreshFailed = series.isError \|\| (needsExtra && extra.isError…` | `const refreshFailed = false;` | work-time-guard, work-time-income-estimate | morto |
| U91 | guarda | `src/components/Header.tsx` | `estimateQualifiers(readyEstimate, workTime.estimate.refreshFailed)` | `estimateQualifiers(readyEstimate)` | work-time-guard | morto |
| U92 | mensagens | `src/modules/work-time/messages.ts` | `refreshFailed ? ESTIMATE_QUALIFIER_STALE : null,` | `null,` | work-time-estimate | morto |
| U93 | mensagens | `src/modules/work-time/messages.ts` | `return { status, reversalNote, canToggle: item.excludable && (!item.re…` | `return { status, reversalNote, canToggle: item.excludable };` | work-time-estimate | morto |
| U94 | mensagens | `src/modules/work-time/messages.ts` | `: inside ? 'Considerada na estimativa.' : 'Depois do período desta est…` | `: 'Considerada na estimativa.';` | work-time-estimate | morto |
| U95 | guarda | `src/modules/transactions/api.ts` | `limit(limitCount),` | `limit(TRANSACTION_PAGE_SIZE),` | work-time-guard | morto |
| U96 | base | `src/modules/reports/basisSync.ts` | `readsMark.current = key !== null && readsRef.current !== null ? { key,…` | `readsMark.current = null;` | report-basis-sync, work-time-income-estimate | morto |
| U97 | base | `src/modules/reports/basisSync.ts` | `holding: syncing \|\| readsBehind \|\| ahead \|\| outOfStep,` | `holding: syncing \|\| ahead \|\| outOfStep,` | report-basis-sync, work-time-income-estimate | morto |
| U98 | base | `src/modules/transactions/incomeReads.ts` | `{ queryKey: incomeReadsKey(workspaceId, kind) }, { cancelRefetch: fals…` | `{ queryKey: incomeReadsKey(workspaceId, kind) })` | report-basis-sync | morto |
| U99 | mutação | `src/modules/transactions/incomeReads.ts` | `predicate: (query) => !isIncomeReadKey(query.queryKey),` | (remove) | work-time-income-estimate, work-time-guard | morto |
| U100 | mutação | `src/modules/transactions/hooks.ts` | `invalidateTransactionReads(queryClient, workspaceId),` | `queryClient.invalidateQueries({ queryKey: transactionKey(workspaceId) …` | work-time-guard | morto |
| U101 | mutação | `src/modules/investments/simple/api.ts` | `invalidateTransactionReads(queryClient, workspaceId),` | `queryClient.invalidateQueries({ queryKey: ['transactions', workspaceId…` | work-time-guard | morto |
| U102 | base | `src/modules/reports/basisSync.ts` | `if (pending.current && arrived()) release.current(); return; } if (cur…` | `return; } if (current.exact) {` | report-basis-sync | morto |
| U103 | base | `src/modules/reports/basisSync.ts` | `current.versions.every((version, index) => version !== 0 && version !=…` | `current.versions.some((version, index) => version !== 0 && version !==…` | report-basis-sync | morto |
| U104 | base | `src/modules/reports/basisSync.ts` | `if (pending.current && !arrived() && pending.current.signature === dec…` | (remove) | report-basis-sync | morto |
| U105 | estimativa | `src/modules/work-time/useIncomeEstimateWith.ts` | `if (!series.data \|\| (needsExtra && !extra.data)) return null;` | `if (!series.data) return null;` | work-time-income-estimate | morto |
| U106 | base | `src/modules/reports/queryKeys.ts` | `await queryClient.invalidateQueries({ queryKey: [FINANCIAL_REPORT_KEY]…` | `refreshRegisteredBases(); await queryClient.invalidateQueries({ queryK…` | report-basis-sync, report-range | morto |
| U107 | base | `src/modules/reports/basisRegistry.ts` | `if ((keys && !keys.includes(key)) \|\| !entry.loaded()) continue;` | `if (keys && !keys.includes(key)) continue;` | report-basis-sync | morto |
| U108 | guarda | `src/modules/reports/hooks.ts` | `void invalidateFinancialReportBases(queryClient);` | (remove) | work-time-guard | morto |
| U109 | base | `src/modules/reports/basisSync.ts` | `&& reads !== null && reads === mark.value;` | `&& reads !== null && reads <= mark.value;` | report-basis-sync | morto |
| U110 | mensagens | `src/modules/work-time/messages.ts` | `const where = inside` | `const where = true` | work-time-estimate | morto |
| U111 | retenção | `src/modules/work-time/useIncomeEstimateWith.ts` | `a.calendar === b.calendar &&` | (remove) | work-time-income-estimate | morto |
| U112 | retenção | `src/modules/work-time/useIncomeEstimateWith.ts` | `a.excludedIds.join(',') === b.excludedIds.join(',');` | `true;` | work-time-income-estimate | morto |
| U113 | retenção | `src/modules/work-time/useIncomeEstimateWith.ts` | `? { ...last.state, refreshFailed: state.refreshFailed, retry: state.re…` | `? last.state` | work-time-income-estimate | morto |
| U114 | retenção | `src/modules/work-time/useIncomeEstimateWith.ts` | `return { shown: state, last: !holding && state.status === 'done' ? { p…` | `return { shown: state, last: !holding && state.status === 'done' ? { p…` | work-time-income-estimate | morto |
| U115 | retenção | `src/modules/work-time/useIncomeEstimateWith.ts` | `const decision = holdEstimate(holding, last.current, params, state);` | `const decision = holdEstimate(false, last.current, params, state);` | work-time-income-estimate, work-time-guard | morto |
| U116 | leituras | `src/modules/transactions/incomeReads.ts` | `staleTime: Infinity, refetchOnReconnect: false,` | `staleTime: 1000 * 60 * 5, refetchOnReconnect: false,` | work-time-income-estimate | morto |
| U117 | leituras | `src/modules/transactions/incomeReads.ts` | `refetchOnReconnect: false, structuralSharing: false, });` | `structuralSharing: false, });` | work-time-guard | morto |
| U118 | base | `src/modules/reports/basisSync.ts` | `refreshRegisteredBases(current.keys);` | `refreshRegisteredBases(current.keys); void queryClient.invalidateQueri…` | work-time-income-estimate, work-time-guard | morto |
| U119 | base | `src/modules/reports/basisSync.ts` | `refetchOnMount: false,` | (remove) | work-time-income-estimate, work-time-guard | morto |
| U120 | base | `src/modules/reports/basisSync.ts` | `refreshRegisteredBases(current.keys);` | `refreshRegisteredBases();` | work-time-guard | morto |
| U121 | mutação | `src/modules/transactions/incomeReads.ts` | `rereadWorkspaceBases(workspaceId);` | (remove) | work-time-income-estimate, report-basis-sync, work-time-guard | morto |
| U122 | base | `src/modules/reports/basisRegistry.ts` | `\|\| entry.failure.failures >= entry.maxFailures) continue;` | `) continue;` | report-basis-sync | morto |
| U123 | base | `src/modules/reports/basisRegistry.ts` | `if (entry.workspaceId !== workspaceId \|\| !entry.loaded()` | `if (!entry.loaded()` | report-basis-sync | morto |
| U124 | escuta | `src/modules/reports/basisSync.ts` | `setListenFailedKey(syncKey);` | (remove) | report-basis-sync, work-time-income-estimate | morto |
| U125 | escuta | `src/modules/work-time/useIncomeEstimateWith.ts` | `retryListen();` | (remove) | work-time-income-estimate | morto |
| U126 | escuta | `src/modules/reports/basisSync.ts` | `monthsKey, deps, listenAttempt]);` | `monthsKey, deps]);` | report-basis-sync, work-time-income-estimate | morto |
| U127 | base | `src/modules/reports/basisSync.ts` | `if (pending.current && pending.current.key !== syncKey) pending.curren…` | (remove) | report-basis-sync | morto |
| U128 | base | `src/modules/reports/basisSync.ts` | `setWaitingKey((current) => (current === syncKey ? current : null));` | (remove) | report-basis-sync | morto |
| U129 | base | `src/modules/reports/basisSync.ts` | `if (pending.current && arrived()) release.current(); };` | `};` | report-basis-sync | morto |
| U130 | base | `src/modules/reports/basisSync.ts` | `// O mesmo estado, sem mais releituras: libera com o que chegou. if (p…` | `// O mesmo estado, sem mais releituras: libera com o que chegou. if (p…` | report-basis-sync | morto |
| U131 | sem pedido | `src/modules/reports/basisSync.ts` | `const ahead = basis !== null && basis.exact && pairedIncome !== null &…` | `const ahead = false;` | report-basis-sync, work-time-income-estimate | morto |
| U132 | sem pedido | `src/modules/reports/basisSync.ts` | `if (current.exact && !current.fetching && !sameIncome(current.income, …` | (remove) | report-basis-sync, work-time-income-estimate | morto |
| U133 | sem pedido | `src/modules/reports/basisSync.ts` | `evaluate.current(loading \|\| pending.current !== null \|\| overlapped…` | `evaluate.current(true);` | report-basis-sync, work-time-income-estimate | morto |
| U134 | escuta | `src/modules/reports/basisSync.ts` | `projected.current = null; changed.current = false; attempts.current = …` | `setListenFailedKey(syncKey);` | report-basis-sync | morto |
| U135 | escuta | `src/modules/reports/basisSync.ts` | `reopenFailedListeners(syncKey);` | (remove) | report-basis-sync, work-time-income-estimate | morto |
| U136 | escuta | `src/modules/reports/basisSync.ts` | `if (key !== null) reopenFailedListeners(key);` | `if (key !== null) setListenAttempt((attempt) => attempt + 1);` | report-basis-sync | morto |
| U137 | escuta | `src/modules/reports/basisSync.ts` | `unregister = registerFailedListener(syncKey, () => setListenAttempt((a…` | (remove) | report-basis-sync, work-time-income-estimate | morto |
| U138 | mutação | `src/modules/reports/basisRegistry.ts` | `scheduleBasisReread(key, entry.mutationScheduler);` | `scheduleBasisReread(key, entry.scheduler);` | report-basis-sync, work-time-guard | morto |
| U139 | sem pedido | `src/modules/reports/basisSync.ts` | `paired.current = { key, income: base && base.key === key ? base.income…` | `paired.current = { key, income: current.income, reads: value };` | report-basis-sync | morto |
| U140 | sem pedido | `src/modules/reports/basisSync.ts` | `if (reads !== mark.value && released.current?.key === syncKey) pairedI…` | (remove) | report-basis-sync | morto |
| U141 | mutação | `src/modules/reports/queryKeys.ts` | `coalesceMs: 30_000, burst: 2, refillMs: 600_000,` | `coalesceMs: 5_000, burst: 5, refillMs: 120_000,` | work-time-guard | morto |
| U142 | mutação | `src/modules/reports/basisSync.ts` | `current.mutationScheduler.cancel();` | (remove) | work-time-guard | morto |
| U143 | escuta | `src/modules/reports/basisSync.ts` | `return () => { unregister?.(); unsubscribe(); };` | `return unsubscribe;` | work-time-guard | morto |
| U144 | cruzada | `src/modules/reports/basisSync.ts` | `evaluate.current(loading \|\| pending.current !== null \|\| overlapped…` | `evaluate.current(loading \|\| pending.current !== null);` | report-basis-sync | morto |
| U145 | cruzada | `src/modules/reports/basisSync.ts` | `noteServerSnapshot(syncKey);` | (remove) | report-basis-sync | morto |
| U146 | cruzada | `src/modules/reports/basisSync.ts` | `basisFetchStarts.set(refreshKey, serverSnapshotCount(syncKeyOf(uid as …` | (remove) | report-basis-sync | morto |
| U147 | sem pedido | `src/modules/reports/basisSync.ts` | `if (current.exact && !current.fetching && !sameIncome(current.income, …` | `if (current.exact && !sameIncome(current.income, pair.income)) release…` | report-basis-sync | morto |
| U148 | sem pedido | `src/modules/reports/basisSync.ts` | `if (current.exact && !current.fetching && !sameIncome(current.income, …` | `if (current.exact && !current.fetching && !months.every((month) => (cu…` | report-basis-sync, work-time-income-estimate | morto |
| U149 | sem pedido | `src/modules/reports/basisSync.ts` | `const ahead = basis !== null && basis.exact && pairedIncome !== null &…` | `const ahead = basis !== null && basis.exact && pairedIncome !== null &…` | report-basis-sync | morto |
| U150 | basis | `src/modules/reports/basisRefresh.ts` | `return months.length === Object.keys(b).length && months.every((month)…` | `return months.every((month) => a[month] === b[month]);` | report-basis-refresh | morto |
| U151 | estimativa | `src/modules/work-time/useIncomeEstimateWith.ts` | `fetching: series.fetchStatus !== 'idle' \|\| (needsExtra && extra.fetc…` | `fetching: false,` | work-time-guard, work-time-income-estimate | morto |
| U152 | agendada | `src/modules/reports/basisSync.ts` | `(basis.fetching \|\| basesOutOfStep(basis.keys));` | `basis.fetching;` | report-basis-sync | morto |
| U153 | agendada | `src/modules/reports/basisSync.ts` | `const outOfStep = syncKey !== null && basis !== null && basis.keys.len…` | `const outOfStep = syncKey !== null && basis !== null && basis.keys.len…` | report-basis-sync | morto |
| U154 | agendada | `src/modules/reports/basisRegistry.ts` | `return entry !== undefined && (entry.scheduler.scheduled() \|\| entry.…` | `return entry !== undefined && entry.scheduler.scheduled();` | report-basis-sync | morto |
| U155 | agendada | `src/modules/reports/basisRegistry.ts` | `return entry !== undefined && (entry.scheduler.scheduled() \|\| entry.…` | `return entry !== undefined && entry.mutationScheduler.scheduled();` | report-basis-sync | morto |
| U156 | agendada | `src/modules/reports/liveRefresh.ts` | `scheduled: () => pending !== null,` | `scheduled: () => false,` | report-live-refresh, report-basis-sync | morto |
| U157 | teto | `src/modules/reports/basisSync.ts` | `entry.failure = { dataUpdatedAt, errorUpdatedAt, failures: dataUpdated…` | `entry.failure = { dataUpdatedAt, errorUpdatedAt, failures: entry.failu…` | report-basis-sync | morto |
| U158 | teto | `src/modules/reports/basisSync.ts` | `if (!isStale) {` | `if (false) {` | report-basis-sync, work-time-income-estimate | morto |
| U159 | teto | `src/modules/reports/basisSync.ts` | `entry.failure = { dataUpdatedAt, errorUpdatedAt, failures: dataUpdated…` | `entry.failure = basisRefreshAfter(entry.failure, { dataUpdatedAt, erro…` | report-basis-sync | morto |
| U160 | estimativa | `src/modules/work-time/useIncomeEstimateWith.ts` | `}, [series.data, series.dataUpdatedAt, series.fetchStatus, extra.data,…` | `}, [series.data, series.dataUpdatedAt, extra.data, extra.dataUpdatedAt…` | work-time-income-estimate | morto |
| U161 | estimativa | `src/modules/work-time/useIncomeEstimateWith.ts` | `fetching: series.fetchStatus !== 'idle' \|\| (needsExtra && extra.fetc…` | `fetching: series.fetchStatus !== 'idle',` | work-time-income-estimate | morto |
| U162 | estimativa | `src/modules/work-time/useIncomeEstimateWith.ts` | `fetching: series.fetchStatus !== 'idle' \|\| (needsExtra && extra.fetc…` | `fetching: false,` | work-time-income-estimate | morto |
| U163 | cruzada | `src/modules/reports/basisSync.ts` | `current.versions[index] !== before.versions[index] && (basisFetchStart…` | `(basisFetchStarts.get(basisKey) ?? -1) < serverSnapshotCount(key));` | report-basis-sync | morto |
| U164 | agendada | `src/modules/reports/basisRegistry.ts` | `return open !== undefined && open[open.length - 1] > (readStartedAt.ge…` | `return true;` | report-basis-sync | morto |
| U165 | agendada | `src/modules/reports/basisSync.ts` | `const started = noteBasisReadStart(refreshKey);` | `const started = 0;` | report-basis-sync | morto |
| U166 | agendada | `src/modules/reports/basisRegistry.ts` | `open.push(basisOrder);` | (remove) | report-basis-sync | morto |
| U167 | fora de passo | `src/modules/reports/basisSync.ts` | `holding: syncing \|\| readsBehind \|\| ahead \|\| outOfStep,` | `holding: syncing \|\| readsBehind \|\| ahead,` | report-basis-sync, work-time-income-estimate | morto |
| U168 | fora de passo | `src/modules/reports/basisSync.ts` | `(basis.fetching \|\| basesOutOfStep(basis.keys));` | `basesOutOfStep(basis.keys);` | report-basis-sync | morto |
| U169 | fora de passo | `src/modules/reports/basisSync.ts` | `if (basisRereadScheduled(refreshKey)) { void queryClient.invalidateQue…` | (remove) | report-basis-sync | morto |
| U170 | estimativa | `src/modules/work-time/useIncomeEstimateWith.ts` | `return { shown: state, last: !holding && state.status === 'done' ? { p…` | `return { shown: state, last: state.status === 'done' ? { params, state…` | work-time-income-estimate | morto |
| U171 | teto | `src/modules/reports/basisSync.ts` | `entry.failure = { dataUpdatedAt, errorUpdatedAt, failures: dataUpdated…` | `entry.failure = { ...entry.failure, dataUpdatedAt, failures: dataUpdat…` | report-basis-sync | morto |
| U172 | sem pedido | `src/modules/reports/basisSync.ts` | `if (current.exact && !current.fetching && !sameIncome(current.income, …` | `if (current.keys.length > 1 && current.keys.some(basisRereadScheduled)…` | work-time-income-estimate | morto |
| U173 | mesmo milissegundo | `src/modules/transactions/incomeReads.ts` | `structuralSharing: false,` | (remove) | work-time-income-estimate | morto |
| U174 | mesmo milissegundo | `src/modules/work-time/useIncomeEstimateWith.ts` | `needsExcluded ? excluded.data : null` | `needsExcluded ? excluded.dataUpdatedAt : null` | work-time-income-estimate | morto |
| U175 | em passo | `src/modules/reports/basisRegistry.ts` | `if (firstOpen === undefined \|\| !rereadPending(behind)) return false;` | `if (firstOpen === undefined) return false;` | report-basis-sync | morto |
| U176 | em passo | `src/modules/reports/basisRegistry.ts` | `(servedReadStartedAt.get(other) ?? 0) > firstOpen` | `(readStartedAt.get(other) ?? 0) > firstOpen` | report-basis-sync | morto |
| U177 | em passo | `src/modules/reports/basisRegistry.ts` | `if (readStartedAt.get(key) !== started) return;` | (remove) | report-basis-sync | morto |
| U178 | em passo | `src/modules/reports/basisRegistry.ts` | `const open = (openRequests.get(key) ?? []).filter((request) => request…` | `const open = openRequests.get(key) ?? [];` | report-basis-sync | morto |
| U179 | em passo | `src/modules/reports/basisSync.ts` | `noteBasisReadServed(refreshKey, started);` | (remove) | report-basis-sync | morto |
| U180 | em passo | `src/modules/reports/basisRegistry.ts` | `return open !== undefined && open[open.length - 1] > (readStartedAt.ge…` | `return open !== undefined && open[0] > (readStartedAt.get(key) ?? 0);` | report-basis-sync | morto |
| U181 | na volta | `src/modules/reports/basisSync.ts` | `markRereadOnReturn(refreshKey);` | (remove) | report-basis-sync | morto |
| U182 | na volta | `src/modules/reports/basisSync.ts` | `if (takeRereadOnReturn(refreshKey) && entry.loaded() && (queryClient.g…` | (remove) | report-basis-sync | morto |
| U183 | na volta | `src/modules/reports/basisSync.ts` | `&& (queryClient.getQueryState(exactKey)?.fetchStatus ?? 'idle') === 'i…` | (remove) | report-basis-sync | morto |
| U184 | pausada | `src/modules/work-time/useIncomeEstimateWith.ts` | `fetching: series.fetchStatus !== 'idle' \|\| (needsExtra && extra.fetc…` | `fetching: series.isFetching \|\| (needsExtra && extra.isFetching),` | work-time-income-estimate | morto |

## Rules (Emulator)

| ID | Grupo | Arquivo | Trecho original | Mutação | Resultado |
| --- | --- | --- | --- | --- | --- |
| R01 | rules | `firestore.rules` | `data.exceptions.split(';').size() <= 120 &&` | (remove) | morto |
| R02 | rules | `firestore.rules` | `data.schemaVersion == 2 &&` | `data.schemaVersion >= 1 &&` | morto |
| R03 | rules | `firestore.rules` | `return text == '' \|\| (text + separator).matches('(?:' + item + separ…` | `return true;` | morto |
| R04 | rules | `firestore.rules` | `'municipality', 'localHolidays', 'exceptions', 'updatedAt', ]) && data…` | `'municipality', 'localHolidays', 'exceptions', 'updatedAt', 'incomeCen…` | morto |
| R05 | rules | `firestore.rules` | `return '(?:[1-9][0-9]{0,2}\|1[0-3][0-9][0-9]\|14[0-3][0-9]\|1440)';` | `return '(?:[0-9][0-9]{0,2}\|1[0-3][0-9][0-9]\|14[0-3][0-9]\|1440)';` | morto |
| R06 | rules | `firestore.rules` | `allow list: if false; } // Índice de participação` | `allow list: if isOwnWorkTimePreference(userId, preferenceId); } // Índ…` | morto |
| R07 | rules | `firestore.rules` | `allow list: if false; } // Índice de participação` | `allow list: if hasActiveAccount() && request.auth.uid == userId; } // …` | morto |
| R08 | rules | `firestore.rules` | `return hasActiveAccount() && request.auth.uid == userId && preferenceI…` | `return hasActiveAccount() && preferenceId == 'work_time_equivalent';` | morto |
| R09 | rules | `firestore.rules` | `data.uf in ['', 'AC',` | `data.uf in ['', 'XX', 'AC',` | morto |
| R10 | rules | `firestore.rules` | `allow list: if canReadWorkspaceScopedData(workspaceId) && request.quer…` | `allow list: if canReadWorkspaceScopedData(workspaceId);` | morto |
| R11 | rules | `firestore.rules` | `match /cash_report_periods/{docId} { allow get: if canReadWorkspaceSco…` | `match /cash_report_periods/{docId} { allow get: if canReadWorkspaceSco…` | morto |

## Mutantes da P5-F contra as suítes da P5-F.1

| ID da P5-F | Mutante | Resultado na P5-F.1 | Primeiro teste que reprova ou motivo |
| --- | --- | --- | --- |
| C1 | arredondamento vira truncamento | morto | 3 - arredondamento ao minuto mais próximo: meio minuto vai para longe de zero |
| C2 | menos de 1 minuto vira zero | morto | 5 - zero, menos de 1 minuto e sinal |
| C3 | sinal negativo perdido | morto | 3 - arredondamento ao minuto mais próximo: meio minuto vai para longe de zero |
| C4 | sem teto do maior inteiro seguro | morto | 7 - limite seguro: valores muito grandes calculam em BigInt e só ficam indisponíveis acima do maior inteiro se… |
| C5 | sem piso de R$ 0,01 por hora | morto | 6 - valores e configurações inválidos ficam indisponíveis (a interface mostra o dinheiro) |
| C6 | reais de exibição devolvem -0 | morto | 10 - volta de reais de exibição a centavos é exata até o teto e recusa o resto |
| C7 | sem teto dos reais de exibição | morto | 10 - volta de reais de exibição a centavos é exata até o teto e recusa o resto |
| C8 | sem a marca de estimativa (≈) | morto | 1 - exemplo de referência: R$ 482,35 com hora de R$ 20,00 vira 24 h 7 min |
| C9 | espaço comum no lugar do espaço inseparável | morto | 11 - formatação pt-BR em horas e minutos, sem quebra de linha e com marca de estimativa |
| C10 | leitor de tela sem o valor exato em reais | morto | 15 - apresentação: texto curto, falado, dica e tooltip trazem o valor exato em reais |
| K1 | campo a mais aceito na leitura | morto | 61 - leitura estrita: v1, campo a mais, campo a menos, tipo errado e gramática inválida não valem |
| K2 | enabled sem verificação de tipo | morto | 61 - leitura estrita: v1, campo a mais, campo a menos, tipo errado e gramática inválida não valem |
| K3 | updatedAt sem verificação | morto | 61 - leitura estrita: v1, campo a mais, campo a menos, tipo errado e gramática inválida não valem |
| K4 | modo tempo com a preferência desativada | não se aplica | src/modules/work-time/contract.ts: trecho presente 0 vez(es): "isWorkTimeAvailable(preference) && preference.d… |
| K5 | uid com barra vira caminho | morto | 59 - caminho privado por usuário, fora do perfil server-owned e de qualquer workspace |
| K6 | valor convertido gravado no documento | não se aplica | src/modules/work-time/contract.ts: trecho presente 0 vez(es): 'monthlyWorkMinutes: preference.monthlyWorkMinut… |
| K7 | schemaVersion ignorado | morto | 61 - leitura estrita: v1, campo a mais, campo a menos, tipo errado e gramática inválida não valem |
| K8 | configuração inválida aceita na leitura | não se aplica | src/modules/work-time/contract.ts: trecho presente 0 vez(es): 'if (!isValidWorkTimeConfig(config)) return null… |
| F1 | minutos até 60 | não se aplica | src/modules/work-time/form.ts não existe mais |
| F2 | renda zero cai na mensagem de mínimo | não se aplica | src/modules/work-time/form.ts não existe mais |
| G1 | contexto da IA recebe a renda | morto | 46 - IA, notificações e relatórios autoritativos não recebem a preferência |
| G2 | Function lê a preferência | morto | 45 - nenhuma Function lê, grava ou menciona a preferência privada |
| G3 | cópia da preferência no localStorage | morto | 48 - nenhuma cópia local da preferência e nenhuma leitura do cache do SDK no app |
| G4 | leitura do cache local do Firestore | morto | 48 - nenhuma cópia local da preferência e nenhuma leitura do cache do SDK no app |
| G5 | log com o objeto de erro inteiro | morto | 49 - logs da preferência só levam mensagem fixa e código de erro |
| G6 | Rules liberam a listagem ao titular | morto | 52 - Rules: bloco explícito do titular, campos, gramáticas e limites iguais ao contrato v2 do cliente |
| G7 | Rules sem hasOnly (campo extra) | morto | 52 - Rules: bloco explícito do titular, campos, gramáticas e limites iguais ao contrato v2 do cliente |
| G8 | Rules aceitam updatedAt do cliente | morto | 52 - Rules: bloco explícito do titular, campos, gramáticas e limites iguais ao contrato v2 do cliente |
| G9 | transferência (BRL obrigatório) usa a camada | morto | 55 - matriz: entradas, confirmações, termos, históricos e preços ficam em BRL |
| G10 | ponto elegível sem a camada (LoanCard) | morto | 57 - matriz: os pontos elegíveis usam a camada de exibição, e a prévia do tema força reais |
| G11 | modo dinheiro ganha elemento novo | morto | 58 - modo dinheiro idêntico: a camada devolve o formatador da tela, sem elemento novo |
| G12 | DTO de relatório com tempo de trabalho | morto | 47 - DTOs, chamadas e adaptadores financeiros não carregam tempo de trabalho |
| G13 | preferência no cache do React Query | morto | 48 - nenhuma cópia local da preferência e nenhuma leitura do cache do SDK no app |
| G14 | API da preferência com caminho de workspace | morto | 51 - a preferência só é lida e gravada no documento privado do próprio usuário |
| G15 | notificação carrega a renda | morto | 46 - IA, notificações e relatórios autoritativos não recebem a preferência |
| G16 | prévia do tema (gráfico e lista) sem ForceMoneyDisplay | morto | 57 - matriz: os pontos elegíveis usam a camada de exibição, e a prévia do tema força reais |
| G17 | Header registra a preferência no log | morto | 49 - logs da preferência só levam mensagem fixa e código de erro |
| G18 | rótulo do log com a renda digitada | morto | 49 - logs da preferência só levam mensagem fixa e código de erro |
| G19 | Rules sem conta ativa | morto | 52 - Rules: bloco explícito do titular, campos, gramáticas e limites iguais ao contrato v2 do cliente |
| G20 | Rules com teto de renda diferente do contrato | não se aplica | firestore.rules: trecho presente 0 vez(es): 'data.monthlyIncomeCents <= 10000000000 &&' |
| C11 | eixo compacto trunca as horas | morto | 12 - rótulo compacto de eixo: horas inteiras arredondadas e minutos abaixo de 1 h |
| C12 | eixo no modo dinheiro deixa de usar o formatador da tela | morto | 13 - eixo e tooltip de gráfico: modo dinheiro devolve o texto exato do formatador da tela |
| F3 | renda bem formada acima do inteiro seguro vira erro de formato | não se aplica | src/modules/work-time/form.ts não existe mais |
| G21 | Header da prévia ignora o ForceMoneyDisplay | morto | 57 - matriz: os pontos elegíveis usam a camada de exibição, e a prévia do tema força reais |
| G22 | parte da divisão volta a converter (ação de um clique) | morto | 56 - matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G23 | eixo de gráfico volta ao texto longo | morto | 56 - matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G24 | confirmação de anulação sem o valor em reais no modo tempo | morto | 56 - matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G25 | import dinâmico da camada num arquivo que fica em BRL | morto | 55 - matriz: entradas, confirmações, termos, históricos e preços ficam em BRL |
| G27 | eixo mais largo também no modo dinheiro | morto | 56 - matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G28 | anulação de despesa dividida sem o valor em reais no modo tempo | morto | 56 - matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G29 | margem negativa no gráfico de fluxo também no modo tempo | morto | 56 - matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G26 | curinga recursivo com outro nome nas Rules | morto | 52 - Rules: bloco explícito do titular, campos, gramáticas e limites iguais ao contrato v2 do cliente |
| G30 | principal do empréstimo ganha a versão convertida ao lado dos reais | morto | 56 - matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G31 | limite usado do cartão ganha a versão convertida ao lado dos reais | morto | 56 - matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
| G32 | estado exposto sem conferir o uid (resposta de outra conta aparece) | morto | 50 - sessão: troca de conta e respostas atrasadas não expõem a preferência de outra conta |
| G33 | listener não é cancelado na troca de conta | morto | 50 - sessão: troca de conta e respostas atrasadas não expõem a preferência de outra conta |
| G34 | resposta grava o estado sem o uid do listener | morto | 50 - sessão: troca de conta e respostas atrasadas não expõem a preferência de outra conta |
| G35 | valor exposto lido de state, e não de current (janela da troca de conta) | morto | 50 - sessão: troca de conta e respostas atrasadas não expõem a preferência de outra conta |
| G36 | valor original do recebível ganha a versão convertida via moneyDisplay | morto | 56 - matriz: pontos em BRL dentro de arquivos elegíveis continuam em reais, linha a linha |
