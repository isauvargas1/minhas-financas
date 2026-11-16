# P5-F.1-R3 (B03) — testes alterados, substituídos, removidos e novos

**Escopo:** `tests/unit/work-time-consistency.test.ts`, `tests/unit/work-time-income-estimate.test.ts` e `tests/unit/work-time-guard.test.ts`. Nenhum código de produção, Rules, Functions ou E2E foi alterado por esta tarefa. Nenhum `skip`, `only` ou `todo`; nenhum timeout aumentado; nenhuma asserção sobre "valor nunca mostrado errado" foi relaxada.

**Por que mudaram.** A regra 5 antiga da prova (escritas pendentes: `inherentWritesOf`, `observeExcludedRead`, `pendingWriteKey`, `unappliedWrites`; a espera limitada `bounded`; o conjunto `expired`) foi **removida** por ser uma presunção temporal: depois de um prazo, a prova deixava de segurar a conversão sem que o gatilho tivesse aplicado a escrita à projeção. A regra 5 nova (`proveProjectionExclusions`) exige as marcas de aplicação (`cash_projection_marks`) lidas numa transação só de leitura no mesmo instante dos meses da janela: sem a marca no conteúdo lido, nunca há conversão, por mais tempo que passe. O prazo (`pendingWaitMs`, 30 s no produto) virou tempo de interface: só troca "calculando" por "estimativa em atualização" (`ESTIMATE_UPDATING`) ou dá o aviso à última estimativa provada.

**Contagens.**

| Arquivo | Declarações `test(` antes → depois | Testes executados antes → depois | Estado antes (com o código novo, sem as mudanças) |
| --- | --- | --- | --- |
| `work-time-consistency.test.ts` | 26 → 33 | 30 → 38 | não carregava (importava funções removidas) |
| `work-time-income-estimate.test.ts` | 20 → 20 | 21 → 21 | 15 de 21 falhavam (sem `readProjectionMarks`) |
| `work-time-guard.test.ts` | 17 → 18 | 17 → 18 | 3 de 17 falhavam |

Resultado final dos seis arquivos pedidos (`work-time-consistency`, `work-time-income-estimate`, `work-time-guard`, `work-time-estimate`, `work-time-projection-proof`, `report-basis-sync`): 178 de 178, em três execuções seguidas. `npx tsc --noEmit -p tsconfig.json`: sem erros.

---

## 1. `work-time-consistency.test.ts`

### 1.1 O mundo em memória (`world()`), sem teste próprio

- Ganhou `readProjectionMarks` (transação só de leitura: lê o estado de quando começa e responde depois de uma latência) e `raw` no `readByIds` (documento bruto, sobre o qual a impressão digital é calculada).
- **INV-M modelada.** O mapa de conteúdos aplicados por `ws:id` e o auxiliar `w.apply(ws, ids)` gravam como aplicado o conteúdo atual de cada lançamento. A marca só muda nesse auxiliar, chamado no mesmo passo síncrono em que `w.income` passa a refletir o estado do lançamento. Lançamento escrito sem o gatilho ter aplicado fica com a marca no conteúdo anterior (o atraso do gatilho). A marca é gravada no formato que `readMarkDoc` entende (`chains.a`, `node: {k: 'alive', fp}` com `fp = transactionFingerprint(conteúdo)`; `deleted` quando apagado).
- `w.pendingMarks` (marca com evento fora de ordem) e `w.brokenMarks` (marca quebrada) para os testes (b) e (c). Meses sem receita no mapa saem com `exists: false`, como o código real.
- `standard(w)` grava r500 e a receita que já o inclui, e aplica a marca de r500.
- Relógio manual (`manualClock`), `drive`, `elapse` e `assertUpdatingOr` para os testes de "nenhum prazo aprova".

### 1.2 Funções puras

| Antes | Depois | O que afirmava → o que afirma | Por quê |
| --- | --- | --- | --- |
| `prova: cada regra, na ordem, com o motivo da primeira que falha` | mesmo nome (alterado) | Regras 1 a 4 e a regra 5 antiga (`pendingWrites`, `projection_pending`, `bounded`, `expired`, `pendingWriteKey`, `unappliedWrites`) → regras 1 a 4 iguais, com a entrada nova (`exclusionsProof`), e a regra 5 nova: prova nula é `loading`, prova recusada é `projection_marks` | A entrada da prova mudou; a presunção temporal foi removida |
| `prova: as escritas que o próprio documento mostra (criação, confirmação, anulação e estorno)` | `prova (regra 5, marcas): prova nula espera, prova recusada é "projection_marks" por qualquer motivo, provada aprova, e as regras 1 a 4 vêm antes` | Testava `inherentWritesOf`, função removida → cada motivo recusado (`generation`, `bases`, `mark_pending`, `mark_broken`, `content`) vira `projection_marks`; provada aprova; sem desconsideradas a prova das marcas não é consultada; a ordem 1, 2, 3, 4, 5 vale mesmo com a prova das marcas recusada | Substituto da regra 5 nova |
| `prova: as mudanças vistas entre duas leituras por id, com a hora do estado novo; uma leitura mais velha não volta o estado` | `prova (regra 5, marcas): só o resultado da prova das marcas decide; escrita, hora ou prazo não aprovam nem seguram` | Testava `observeExcludedRead`, função removida → campos antigos (`pendingWrites`, `expired`, relógio) passados à entrada não mudam o resultado; as chaves da entrada são só as da regra nova; e, com a prova real (`proveProjectionExclusions`), a mesma impressão digital aprova e outra recusa | Substituto: garante que nada temporal volta a decidir |

### 1.3 Gancho: alterados só para respeitar a INV-M (asserções iguais)

| Teste | Mudança |
| --- | --- |
| `B03 (R8-02): a desconsiderada do 12º mês anulada em outra sessão…` | `apply` na criação de r500 e junto com a anulação e a receita de novembro de 2025 |
| `B03 (R11-01): o mês avulso sai da janela…` | `apply` na criação de r500 |
| `B03: o calendário trocado durante a sincronização de uma anulação…` | `apply` junto com a anulação e a receita de outubro |
| `B03: troca do workspace da renda…` | `apply` de r500 nos dois workspaces |
| `B03: nova receita e anulação da desconsiderada… durante a releitura por id` | `apply` junto com a anulação e a receita de outubro |
| `revisão da R1 (N03): a desconsiderada editada em outra sessão antes do gatilho, na primeira leitura…` | O gatilho passa a aplicar receita e marca juntas; sem o gatilho a marca fica no conteúdo anterior. Comentário "dentro da espera limitada" removido. Mesma afirmação: nunca o valor novo com o total velho |
| `B01: o recebimento desconsiderado é estornado em outra sessão (depois da sincronização / durante a releitura por id)` (2 testes) | `receivables(w)` aplica A, C e tx_b; o espelho do estorno é aplicado junto com a receita de outubro |
| `B01: o estorno lido antes de a projeção incluí-lo nunca aparece com o total antigo…` | Idem. O estorno lido antes de aplicado agora tem marca ausente: a prova usa a parte dele como zero, e os valores permitidos são os mesmos |
| `B01: o recebimento desconsiderado sem estorno continua descontado; com dois desconsiderados…` | Idem |

Sem mudança (continuam passando como estavam): os três `B03: a primeira estimativa só aparece provada pela projeção…`, `B03: a projeção mais nova que a base lida na montagem…`, `B03: uma base e nenhuma desconsiderada…`, `B03: janela de 12 meses com a escuta encerrada desde o começo…`, `B03 (R11-02)…`, `B03: troca de conta…`, `B03: a leitura por id falha antes da primeira estimativa…`, `revisão da R1 (N05)…` e `revisão da R1 (N06): a última estimativa provada mostrada no lugar da atual por mais que a espera limitada ganha o aviso e o "Tentar de novo"` (este é tempo de interface, como pedido; só o nome antigo "espera limitada" foi mantido).

### 1.4 Gancho: substituídos (aprovação por prazo → garantia nova)

| Antes | Depois | O que afirmava → o que afirma |
| --- | --- | --- |
| `revisão da R1 (N03): a desconsiderada editada sem efeito na renda (o gatilho não grava): a estimativa aparece só depois da espera limitada, com o valor certo` | `B03 (R3, ex-N03): … marca velha: nenhuma conversão em tempo nenhum, só "estimativa em atualização"; com a marca aplicada, a estimativa certa aparece sem esperar prazo` | A estimativa certa aparecia depois de ≥ 700 ms (a espera aprovava) → com a marca velha, 10 min no relógio da estimativa e mais de 1 h na hora do servidor depois, nenhuma estimativa; o estado é `ESTIMATE_UPDATING` com "Tentar de novo"; a leitura é refeita pelo agendador, mas nunca aprovada; com `w.apply`, a estimativa certa (R$ 10.560,00) aparece em menos que o tempo de interface |
| `revisão 2 da R1 (M02): a espera limitada conta a partir da escrita, na hora do servidor: uma sessão nova depois dela não espera de novo` | `B03 (R3, ex-M02): a hora do servidor não aprova: uma sessão nova aberta depois de o servidor passar da escrita por mais que qualquer prazo continua sem converter com a marca velha` | Sessão nova depois de 61 s do servidor convertia → sessão nova depois de 3.700 s do servidor continua sem converter e mostra `ESTIMATE_UPDATING`; ao aplicar a marca, converte |
| `revisão 3 da R1 (P01): o N03 no caminho de produção, com a hora do servidor nas bases…` | `B03 (R3, ex-P01): o N03 com a hora do servidor nas bases: sessão aberta 5 s depois da edição de valor, e mesmo 1 h depois, nunca o valor novo com o total velho; o gatilho aplica (receita e marca) e aparece o certo` | Mesmo cenário sem o `pendingWaitMs` de 60 s; acrescenta 2 min no relógio e 1 h na hora do servidor sem converter, e a conversão só com receita e marca juntas |
| `revisão 3 da R1 (P01): o limite da espera pela hora do servidor… 59 s` (segura) e `… 60 s` (encerra) | `B03 (R3, ex-P01): nenhum intervalo aprova a conversão… 59 s`, `… 60 s (o limite que antes encerrava a espera)` e `… 3600 s` | 59 s segurava e 60 s liberava → 59, 60 e 3.600 s: nenhum aprova; só `ESTIMATE_UPDATING`. O laço passou de 2 para 3 testes |
| `revisão da R1 (N06): a edição sem efeito na renda depois da mudança vista não prende a estimativa; outra receita entra depois da espera limitada` | `B03 (R3, ex-N06): a edição sem efeito na renda depois da mudança vista, aplicada pelo gatilho, não prende a estimativa: outra receita entra sem esperar prazo` | A receita nova entrava depois da espera → com a marca aplicada pelo gatilho (inclusive a edição só de descrição), a receita nova de agosto entra sem esperar e nunca aparece "em atualização" |

### 1.5 Gancho: novos

| Teste | O que afirma |
| --- | --- |
| `B03 (R3, a): a desconsiderada editada em outra sessão com o gatilho atrasado…` | Estimativa já mostrada; edição para R$ 900,00 sem o gatilho; a releitura por id traz o valor novo, mas só a última provada (R$ 10.560,00) é mostrada, nunca R$ 10.460,00. Quando o gatilho aplica (receita e marca juntas), aparece R$ 10.860,00 |
| `B03 (R3, b): evento fora de ordem (marca com pendência)…` | Marca com pendência: nenhuma conversão, mesmo com releituras e 10 min depois (`ESTIMATE_UPDATING`); fechada a pendência, a estimativa aparece |
| `B03 (R3, c): marca quebrada…` | Marca quebrada: nenhuma conversão e nenhuma releitura automática (1 leitura por id e 1 de marcas mesmo após 10 min); a escuta pede uma releitura e só essa acontece; recuperada a marca, o "Tentar de novo" prova |
| `B03 (R3, d): a desconsiderada muda de mês para fora da janela…` | A data muda para julho com o gatilho atrasado: o mês antigo continua descontando (nunca R$ 11.360,00); só quando receita e marca mudam juntas aparece R$ 10.860,00 |
| `B03 (R3, e): a releitura por motivo passageiro respeita o orçamento do agendador…` | Com orçamento de 2: a carga e 2 releituras (3 leituras); antes da reposição, nenhuma; uma ficha devolvida, uma releitura; depois, nenhuma. Em momento algum converte |
| `revisão pt-BR da R3 (M-01): sem desconsiderada, 12 meses e a escuta sem retorno do servidor…` | Sem receita desconsiderada e sem retorno do servidor na escuta: depois do tempo de interface aparece o texto de "em atualização" (`ESTIMATE_UPDATING`, sem apontar causa), nunca a conversão; com o retorno, a estimativa provada |
| `revisão pt-BR da R3 (L-03): a leitura das marcas falha…` | A leitura das marcas falha: aparece o erro fixo em pt-BR (`ESTIMATE_EXCLUDED_READ_FAILED`) com "Tentar de novo", nunca a conversão; o "Tentar de novo" prova |

Os dois testes da revisão pt-BR (M-01 e L-03) entraram depois da primeira versão desta tabela, que ainda contava 31 declarações e 36 testes; o total é 33 declarações e 38 testes executados, os 38 nomes do log do `verify:all` (gate, rodada 1, I-01).

Todos os testes de (a) a (e) e os `ex-*` foram conferidos por mutação local: com o mundo trocado por um em que a marca sempre reflete o documento atual (gatilho instantâneo), 11 testes falham, entre eles todos os que afirmam "sem conversão com a marca velha".

---

## 2. `work-time-income-estimate.test.ts`

Todos os cenários e asserções foram mantidos. Mudanças:

- **Mundo (`fake()`):** ganhou `readProjectionMarks` e `raw` no `readByIds`; `apply()` aplica a marca (INV-M) e o conteúdo da marca começa no estado de criação. Os meses lidos vêm de `receipts` e `extraReceipts`.
- **`apply()` chamado junto com a mudança de receita** em: `mutação nesta aba: anular a receita desconsiderada… (R4-01)`, `leitura por id antiga: a prévia montada depois de uma mutação… (R5-01)`, `releitura da mutação com a base nova antes do retorno da escuta (viva)` e `(encerrada)` (R6-02, B03), `exclusão de um mês fora da janela, anulada nesta aba… (R7-01)` (na criação e na anulação), `janela de 12 meses com a releitura de uma mutação nesta aba pendente… (R10-02)` e `anulação nesta aba de uma desconsiderada do 12º mês… (R9-03, B03)` (na criação e na anulação).
- **`duas leituras por id concluídas no mesmo milissegundo… (R6-02)` e `leitura por id antiga… (R5-01)`:** a consulta da leitura por id agora tem a janela de meses na chave (`scope`), e a leitura sem janela (antes de a série carregar) fica na cache sem dados. A contagem `byIds.length === 1` passou a contar as consultas **com dados** (`.filter(query.state.data !== undefined)`), com comentário. A afirmação é a mesma: uma só leitura por id viva, com as três atualizações no mesmo `dataUpdatedAt`.
- Sem mudança: os demais testes (retenção pura, 12 meses, escuta encerrada etc.).

---

## 3. `work-time-guard.test.ts`

| Teste | Mudança |
| --- | --- |
| `a preferência só é lida e gravada no documento privado do próprio usuário` | `projectionReads.ts` fica fora da varredura de "caminho de workspace" (é o único arquivo do módulo que lê as coleções da projeção); a guarda própria abaixo o cobre |
| `nada derivado é gravado: só a API do módulo escreve…` | `projectionReads.ts` fica fora da varredura de `runTransaction` (a transação só lê); a guarda própria abaixo o cobre |
| **Novo** `leitura das marcas de aplicação (P5-F.1-R3): só uma transação de leitura, só nas coleções da projeção, sem escrita, escuta nem cache` | `projectionReads.ts`: só `doc` e `runTransaction` do SDK; uma transação; exatamente dois `transaction.get` e nenhum outro método da transação; nenhum `set`/`update`/`delete`/`create`/`setDoc`/`updateDoc`/`deleteDoc`/`addDoc`/`writeBatch`/`onSnapshot`/`getDoc(s)`/`query`/`collection`; nenhum cache; só `cash_report_periods` e `cash_projection_marks` sob `workspaces/{workspaceId}`; workspace validado antes da transação; tetos e `maxAttempts: 5`; e as Rules negam a escrita do cliente nas duas coleções e só leem para quem lê o workspace |
| `estimativa: uma por contexto, sem polling nem listener por lançamento` | (1) Guarda do corpo antigo de `readExcluded` reescrita: `noteDependentReadStart()` acontece **antes** de qualquer leitura (`readExcludedIncome` e depois `readProjectionMarks`), a transação recebe os meses da janela e os ids das desconsideradas e dos espelhos de estorno, e o resultado leva `startedOrder`, `snapshot` e `window`. (2) `proveEstimateConsistency(proofInput)` sem `expired`; nenhum resto da regra 5 antiga (`observeExcludedRead`, `inherentWritesOf`, `pendingWriteKey`, `unappliedWrites`, `expired`, `bounded`, `pendingWrites`, `projection_pending`) no hook nem em `consistency.ts`. (3) A entrada da prova (`exclusionsProof` e `proofInput`) não tem relógio, prazo nem `waitedTooLong`. (4) `ESTIMATE_UPDATING` só como erro com "Tentar de novo", e `waitingProof` exige `!proof.proven`. (5) O retorno final do hook inclui o ramo `ESTIMATE_UPDATING`. (6) A fiação real liga `readProjectionMarks`. (7) A chave da leitura por id leva o `scope`. (8) `getTransactionsByIds` devolve o `raw`. (9) `projectionProof.ts` é puro e sem relógio. (10) Em `reports/hooks.ts`, o agendador da escuta do mês agora chama `refreshFinancialReportsAfterChange(queryClient, lastChange.current)` (mudança concorrente RR-R2A-04 já presente no mesmo diretório de trabalho, não da R3 do B03) |

Sem mudança: os demais 14 testes da guarda continuam passando como estavam.
