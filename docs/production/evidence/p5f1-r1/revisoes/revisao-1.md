# Revisão independente e adversarial: P5-F.1-R1 (B01, B02, B03)

**Data:** 2026-11-05 · **Modo:** somente leitura (nada foi alterado no worktree nem na cópia anterior; sem commit, push, rede, `npm run`, Emulator ou Playwright). Rodei um único arquivo de teste (`tests/unit/work-time-calendar.test.ts`, 21/21 PASS) e as sondas listadas no §7.

## 0. Veredito

| Bloqueador | Veredito | Resumo |
| --- | --- | --- |
| **B01** | **CORRIGIDO** | O cenário A+100 / estorno −100 / B+100 dá R$ 100,00 na função pura e no gancho. Na P5-F.1, o mesmo gancho caía para "indisponível: sem renda". O ID do estorno derivado no cliente bate com o do backend. Não achei caminho de dupla dedução. Restam só as exposições da classe B03 (N03, N04), que superestimam a renda e nunca descontam duas vezes. |
| **B02** | **NÃO CORRIGIDO (reaberto)** | O exemplo do parecer foi corrigido (480 → 480 min), e a união de janelas resistiu a mais de 100 mil amostras. Mas a lógica nova de teto da R1 tem um contraexemplo ao invariante, com configuração aceita ao salvar: acrescentar uma rotina válida tira 540 min da janela e muda o valor da hora em +37,5% (N01). O mesmo defeito deixa um dia civil passar de 24 h (N02), o que é regressão em relação à P5-F.1. Logo, o "Teorema 2" de `rotinas-matematica.md` é falso. |
| **B03** | **NÃO CORRIGIDO integralmente** | R11-01, R11-02, R8-02 e R10-02 foram fechados, e a primeira renderização sem estimativa compatível não mostra mais estado misto. Mesmo assim, a política não é fail-closed em pelo menos dois caminhos: (a)/(b) documentados, com estado misto reproduzido (N03), e a leitura por id servida do cache local, não documentada (N04). Há ainda um estado preso novo, sem erro nem "Tentar de novo" (N05). E o limite (c) deixa uma estimativa velha na tela sem aviso (N06). |

**Recomendação:** FAIL. Não publicar.

## 1. Estado do material revisado

- **O worktree mudou durante a revisão.** Entre 21:41 e 21:47 UTC foram alterados `consistency.ts` (`observeExcludedRead` ganhou a comparação de versão), `basisSync.ts`, `basisRegistry.ts`, `reports/hooks.ts`, `work-time-consistency.test.ts`, `work-time-guard.test.ts`, `consistencia-estimativa.md`, `matriz-bloqueadores.md` e `LEIAME.md` (novo).
  - Reli o estado final, cuja última modificação foi às 21:47:01.
  - Todas as sondas de gancho e as buscas rodaram depois disso.
  - Hashes (SHA-256, 16 primeiros hexadecimais) do estado revisado:
    - `calendar.ts` 9b956512bb0de6a1;
    - `consistency.ts` 05ff4af8073b9987;
    - `useIncomeEstimateWith.ts` fca49e5dd13b92b1;
    - `incomeBasis.ts` fab816fcc3e8c2e4;
    - `receivableReversal.ts` 96d05a96d72bb3c4;
    - `estimate.ts` 141737af818e6b12;
    - `draft.ts` 0e42babc66c63f41;
    - `basisSync.ts` d5205070e5ef3273;
    - `basisRegistry.ts` 0f38ad185f3e0bfe;
    - `basisRefresh.ts` 9306458d2b10e9b6;
    - `reports/hooks.ts` bd915c7d85cc3cee.
- **A cópia "antes" confere com a árvore Git `d9b33cd1`.** Comparei todos os arquivos rastreados de `src/` e `tests/` com `git show`: 0 diferenças. Ela tem dois arquivos a mais, `tests/fixtures/receivable-reversal-ids.json` e `tests/unit/work-time-consistency.antes.test.ts`, que são a bateria "antes" da equipe. INFO.
- **Arquivos que a R1 não tocou.** `firestore.rules` e `firestore.indexes.json` têm mtime do checkout (19:29:19). `package.json` só acrescenta `work-time-consistency.test.ts` ao script `test:unit:work-time`.
- **E2E.** Comparado com `d9b33cd1` (`git show`), só ganhou dois testes (B01 e B02) e helpers de import. Nada foi removido.

## 2. Achados confirmados

### N01 — HIGH — reabre B02: acrescentar uma rotina válida tira horas num dia de jornada reduzida com plantão ou hora extra

- **Onde:** `src/modules/work-time/calendar.ts` em três pontos:
  - `:408`: `civilOccupancy(..., followsRoutine(...) ? routineDay.windows : [], ...)`. Num dia reduzido, `followsRoutine` é falso, e as janelas do próprio dia não ocupam o dia civil.
  - `:430-434`: a redução só zera `windowPart` quando `minutes > flags.reduced`.
  - `:451`: `limit = windowPart + max(0, 1440 − occupancy)`.
- **Mecanismo:**
  - **Rotina dentro do limite da redução** (`w ≤ R`): o teto dos acréscimos vira `w + 1440`, que na prática não limita nada.
  - **Rotina nova que passa do limite** (`w' > R`): o dia passa a `min(R + acréscimos, 1440)`.
  - **Quando cai:** sempre que `acréscimos > 1440 − w`. É uma descontinuidade, não monotonia.
- **Cenário concreto** (`sondas/b02-reduzida-total.mts`), mês atual de outubro/2026, referência 25/10, renda R$ 5.000,00:
  - **Configuração:**
    - rotina: segunda 08:00–17:00, sem intervalo;
    - exceções: jornada reduzida em 05/10 (600 min), plantão em 05/10 (1.440 min) e férias de 12/10 a 31/10.
  - **R1:**
    - com uma rotina: 1.980 min → R$ 151,52/h;
    - acrescentada a rotina válida segunda 18:00–20:00: 1.440 min → R$ 208,33/h. São −540 min por acrescentar 120 min de rotina.
  - `validateDraft` aceita as duas configurações (`{"ok":true}`), e `routinesAmbiguity` devolve `null`.
  - **P5-F.1:** 1.440 → 1.440 min, R$ 208,33 → R$ 208,33.
- **Também na janela habitual:** a busca dirigida (`b02-cobertura.mts`, 40 mil amostras, 27.726 pares com cálculo seguro) achou uma violação em ago–out/2026, de 99.930 para 99.600 min. Minimizada (`b02-minimizar.mts`, `b02-violacao.json`), dá 73.605 → 73.380 min. A perda está em 26/08 (jornada reduzida de 990 min e plantão de 1.395 min): 2.385 → 1.440 min, com teto aplicado.
- **Busca sem `reduced`** (`b02-cobertura-sem-reduzida.mts`, 60 mil amostras, 41.752 pares): 0 violações. O defeito está isolado nesse caminho.
- **Por que os testes da R1 não pegaram:**
  - O gerador de propriedade (`tests/unit/work-time-calendar.test.ts`, `randomExceptions`) limita plantão, hora extra e jornada reduzida a `(1 + floor(next() * 12)) * 60 ≤ 720` min.
  - O defeito exige `acréscimos > 1440 − w` com `w ≤ R`, isto é, acima de 720 min quando `R ≤ 720`. É inalcançável com esse gerador.
  - O item 2 da prova ("Num dia de jornada reduzida, `min(w + x, R)` perde no máximo o que saiu") não descreve o código. O código calcula `min(min(w + d, R) + acréscimos, limite)`, e o limite depende de a redução morder ou não.

### N02 — MEDIUM — regressão: o teto de 24 h do dia civil não vale em dia de jornada reduzida (mesma causa de N01)

- **Onde:** `calendar.ts:408` e `:451`.
- **Cenário** (`sondas/b02-reduzida-teto.mts`): segunda 05/10/2026, rotina 08:00–17:00, jornada reduzida a 600 min e hora extra de 1.000 min.
  - **R1:** **1.540 min (25 h 40 min)** num único dia civil, sem nenhuma janela passar da meia-noite. `capped: false`, então a nota de teto nem aparece.
  - **P5-F.1:** 1.440 min, com teto.
  - Com plantão de 1.440 min, o dia vai a 1.980 min (33 h).
- **Contradições:**
  - a nota `capped_days` (`messages.ts:64`: "para nenhum dia ter mais de 24 horas de trabalho entre 0h e 24h");
  - `rotinas-matematica.md` §3;
  - `calendario-feriados.md`.
- **Efeito:** horas superestimadas, logo valor da hora subestimado.

### N03 — MEDIUM — B03: os limites (a) e (b) mostram conversão mista como "provada"; o fail-closed não é absoluto

- **Onde:** `consistency.ts:180-203`. A regra 5 só conhece criação, confirmação, anulação, estorno e mudanças observadas, não a edição de valor, data ou tipo antes da primeira observação. A estimativa mista ainda é guardada como "última provada" (`useIncomeEstimateWith.ts:141`, `:344`).
- **Reprodução** (`sondas/b03-gancho.mts edicao-antes-da-primeira-leitura`, React Query real):
  - Situação: desconsiderada de R$ 500,00 em outubro; outra sessão muda o valor para R$ 800,00; o gatilho ainda não gravou.
  - Renderizações: `loading → R$10260 → R$10560`.
  - R$ 10.260,00 mistura o valor novo da exclusão com o total velho. Os estados consistentes valem R$ 10.560,00.
  - A P5-F.1 se comporta igual: o problema não é novo, mas continua.
- **Por que é achado, apesar de documentado:**
  - O pedido exige "fallback seguro e documentar a limitação". Aqui há documentação, mas não há fallback: a estimativa é mostrada.
  - Havia sinal disponível. Na sonda, o `updatedAt` do desconsiderado (106) é posterior à versão de outubro na projeção (104, gravada antes da edição). Ele poderia segurar a estimativa, ao menos por uma espera limitada.
  - A própria R1 aceitou esse custo de vivacidade no limite (c).
  - Por isso, "nenhuma renderização com estimativa não provada" (matriz, B03) é verdade só pela definição interna de "provada".
- **Exposição:** a latência do gatilho (segundos, ou mais com cold start ou retentativas), somada à releitura.

### N05 — MEDIUM — vivacidade: escuta encerrada antes do primeiro retorno do servidor, com desconsideradas, prende em "calculando" para sempre

- **Onde:** `useIncomeEstimateWith.ts` em três pontos:
  - `:204`: a leitura por id só é ligada com `projectionReady === windowKey`, que nunca chega.
  - `:233`: o estado fica `loading` porque `needsExcluded && !excluded.data`.
  - `:339-341`: com o estado diferente de `done`, `unproven = state`, e o `failure` (`ESTIMATE_UNCONFIRMED_FAILED`) nunca é usado.
  - Na interface (`EstimateDetails.tsx:43-44`), o estado `loading` não tem "Tentar de novo".
- **Reprodução** (`b03-gancho.mts escuta-recusada-com-exclusao`):
  - R1: `loading` por 1,5 s, com 0 leituras por id.
  - P5-F.1: `loading → R$10560(ressalva)`.
  - Sem desconsideradas, em 12 meses (`escuta-recusada-sem-exclusao-12m`), a R1 mostra o erro com "Tentar de novo", como esperado.
- **O que contradiz:** `consistencia-estimativa.md` §3 ("com uma leitura ou a escuta em falha, o erro em pt-BR com 'Tentar de novo'") e §4, regra 2.
- **Cobertura:** os testes só cobrem a escuta encerrada sem desconsideradas, ou depois da primeira prova.
- **Efeito:** fail-closed, porque nenhum número errado aparece, mas o estado fica preso sem saída.

### N06 — LOW — limite (c): a estimativa velha fica na tela sem aviso, indefinidamente

- **Onde:** `consistency.ts:126-154`. As mudanças observadas nunca saem da lista, e a regra 5 (`:196-202`) exige uma versão posterior ao `updatedAt` do estado novo.
- **Reprodução** (`b03-gancho.mts limite-c-estimativa-parada`):
  - Passos: outra sessão muda o valor da desconsiderada (o gatilho grava outubro) e depois só a descrição; mais tarde entra uma receita de agosto (+R$ 100,00).
  - **R1:** a última renderização continua em **R$ 10.560,00**, sem ressalva, enquanto o estado atual vale R$ 10.660,00.
  - **P5-F.1:** converge para R$ 10.660,00.
  - Na R1, só uma escrita nova em outubro ou um recarregamento destravam.
- **Documentação:** o documento diz "a estimativa fica sem conversão". Na prática, mostra a última provada antiga, sem indicação de atraso, e trava também a atualização dos outros meses.

### N07 — LOW — B02: configurações aceitas ao salvar ficam "sem cálculo seguro" na janela

- **Onde:**
  - `draft.ts:374`: `validateDraft` só confere `routinesAmbiguity(draft.routines, ...)`, sem exceções e sem `periodStart`;
  - `calendar.ts:590`.
- **Casos:**
  1. **Exceção no dia vizinho** (`sondas/b02-excecao-ambigua.mts`, `b02-excecao-salvar.mts`):
     - rotinas: segunda 20:00–24:00 sem intervalo, segunda 22:00–02:00 com 30 min e terça 00:00–08:00 sem intervalo;
     - `routinesAmbiguity`: `null`; `validateDraft`: `ok`;
     - com folga em 20/10, o dia 19/10 fica ambíguo, e a estimativa sai `ambiguous_routines`. Com feriado local em 27/10, o dia 26/10 também.
  2. **Começo do período** (`sondas/b02-borda-ambigua.mts`):
     - rotinas: domingo 20:00–04:00 e segunda 01:00–05:00/30 com 03:00–06:00;
     - a configuração é aceita ao salvar;
     - com junho/2026 abrindo o período (01/06 é segunda), o dia 01/06 fica ambíguo; na vista do mês, não.
- **Efeito:** fail-closed, sem número errado. Mas a mensagem da estimativa manda "Ajuste as rotinas em Configurações", e o editor de rotinas não mostra aviso algum.
- **Contradição:** "salvar é recusado" (matriz B02, `calendario-feriados.md`) não vale para essa classe.

## 3. Suspeita forte (não reproduzida contra o SDK real)

### N04 — MEDIUM — leitura por id servida do cache local passa na prova e tira as exclusões da conta

- **Onde:**
  - `src/modules/transactions/api.ts:164`: `getDocs(...)`, sem `getDocsFromServer` e sem conferir `snapshot.metadata.fromCache`;
  - `consistency.ts:190-203`: com todos os ids `missing`, `excludedMonths` e `pendingWrites` ficam vazios, e a prova passa.
- **Base:**
  - O SDK do Firebase (12.8.0 no projeto) resolve `getDocs` com o cache quando o cliente está offline. É o comportamento documentado: "may return cached data … if you are offline".
  - O app usa `getFirestore` com cache em memória, e não há listener em `transactions`. Logo, o resultado offline é vazio.
  - A projeção confirmada continua valendo, porque os retornos só do cache são ignorados e `confirmed` não é zerado.
- **Simulação** (`b03-gancho.mts leitura-por-id-do-cache-vazio`, `readByIds` devolvendo tudo como `missing`):
  - R1 e P5-F.1: `loading → R$11060`; o consistente é R$ 10.560,00.
  - A nota mostrada é falsa: "1 receita desconsiderada está fora do período ou não soma renda".
- **Por que importa:** a premissa da regra 4 ("o Firestore não devolve… um estado anterior") só vale para leitura no servidor. O tratamento de falha de leitura está no escopo do B03, e o "retorno só do cache não vale" foi aplicado só à escuta.
- **Correção simples:** usar `getDocsFromServer` ou tratar `fromCache` como falha.
- **Não reabre o B01:** sem o documento, A é ignorado e não há dupla dedução.

## 4. Informativos

- **N08 (INFO, documentos):**
  - O Teorema 2 é falso (N01).
  - "A propriedade vale em todas as amostras" é verdade só dentro das faixas do gerador.
  - Os "limites registrados" de `consistencia-estimativa.md` §6 estão incompletos (faltam N04 e N05), e o limite (c) está mal descrito (N06).
  - "Cada par vem de um mesmo instante do Firestore" é impreciso. Os lotes de `getTransactionsByIds` são lidos em sequência, e um id repetido na lista desloca os pares entre lotes: na sonda, 2 pares partidos. É irrelevante para a correção, porque os espelhos são imutáveis e a leitura começa depois da projeção.
- **N09 (INFO, custo):**
  - `routinesAmbiguity` custa 50 a 110 ms por chamada no pior caso (três escalas longas, primas entre si; node, desktop).
  - Roda em toda renderização de Configurações (`WorkTimeSettingsView.tsx:264`, `draftIsValid`) e a cada mudança do editor. A rotina semanal comum fica abaixo de 1 ms.
  - Os testes registram releituras a mais: `byIdReads` passou de 2 para 3 nos cenários de janela maior, e `seriesCalls` de 3 para 5 num cenário. Não é bloqueador.
- **N10 (INFO):** a lista de mudanças observadas (`dependentStates`) cresce sem limite durante a sessão. É pequena, mas não tem poda.

## 5. O que foi verificado e passou

### B01

- **Paridade do ID:**
  - A derivação do cliente (`recvcash_` → `rmv_` → SHA-256 de `<movimento>:reversal` → `recvcash_`) bate com o backend. Conferi em `functions/src/receivables/model.ts:78,101-105` e `operations.ts:779-841`, com uma sonda em `node:crypto` (`b01-puro.mts`: paridade `true`) e com a fixture compartilhada mais o teste do backend.
  - O espelho do estorno tem `receivableEntry.reversal: true`, `reversalOf` igual ao movimento, a mesma data e o mesmo principal.
  - O espelho do recebimento não muda no estorno, que só grava `reversedBy` no movimento.
- **Leitura em par:** 50 recebimentos desconsiderados dão 100 ids em 4 consultas (30/30/30/10), com 0 pares partidos e 50 estornos achados.
- **Cálculo:**
  - A+100 com estorno lido: elegível 10000, `reversed` 1, sem nota de exclusão ignorada.
  - Sem o estorno lido: 0, o caso que as regras 4 e 5 impedem de aparecer.
  - Estorno com principal divergente: `unconfirmed`, e a estimativa fica `exclusion_unconfirmed`.
  - Juros não atrapalham: só o principal entra em `incomeCents`.
- **Gancho** (`b03-gancho.mts b01-parecer`):
  - R1: `loading → R$100`, inclusive depois do estorno e do gatilho.
  - P5-F.1: `R$100 → indisponível:no_income`, a dupla dedução zerando a renda.
- **Caminhos de dupla dedução:** não achei nenhum.
  - Basear-se no estorno exige que a projeção o inclua (regra 3).
  - A leitura por id começa depois dessa versão (regra 4).
  - O estorno lido antes do gatilho espera a projeção (regra 5, `createdAt` do espelho).
  - O limite (a) não se aplica a espelhos, que são imutáveis.
  - O (b) só superestima.
- **Anulação comum:** é `voidedAt` no próprio documento (`mutateTransaction.ts:927`), sem documento compensatório. Os outros domínios (empréstimo, divisão, investimento, fatura) não são excluíveis.

### B02

- **Exemplo do parecer:** 480 → 480 min. Na P5-F.1, 480 → 390.
- **Busca aleatória geral** (`b02-busca.mts`, 60 mil amostras): 9.707 pares com cálculo seguro e 0 violações. Na P5-F.1, 154 violações em 3 mil amostras.
- **Busca dirigida a coberturas, sem `reduced`:** 41.752 pares e 0 violações.
- **Ambiguidade:** recusada no editor (`role="alert"`) e ao salvar, com mensagem em pt-BR; uma configuração ambígua já gravada fica indisponível (E2E B02). Exceções: N07.
- **Testes de calendário:** a suíte da R1 passa (21/21), mas não cobre N01 e N02.

### B03

- **R10-02:** `holdEstimate` não mostra mais um estado `done` sem prova nem estimativa provada da mesma identidade.
- **Identidade:** inclui uid, janela, workspace, modo, meses, confirmação PJ, calendário (por referência, conservador) e exclusões.
- **Projeção confirmada:** só vale com a chave conta + workspace + meses (`basisSync.ts`, `confirmed.key === confirmedKey`).
- **Trocas de conta, workspace e janela:** não reaproveitam estimativa.
- **Escuta encerrada depois da primeira prova:** mostra a última provada com ressalva, ou o erro.
- **Com várias bases:** a regra 3 compara a receita de cada mês da janela com a projeção.
- **Comparação de versões:** `updatedAt` da projeção e `createdAt`/`voidedAt`/`confirmedAt` vêm todos de `serverTimestamp` do backend (`periods.ts:828`, `createTransaction.ts:270`, `mutateTransaction.ts:417,927`, `model.ts:468`), então são comparáveis.

### Testes, regressão e escopo

- **Nada de `skip`, `only` ou `todo`.** O `timeoutMs` padrão continua 3_000, e os `retries` do Playwright não mudaram.
- **Asserções removidas** têm justificativa:
  - `work-time-calendar.test.ts`, 6 removidas: 08–14/30 com 12–18/30, OFFICE com contida, noturno com intervalo cruzando a manhã. São configurações que agora são ambíguas por contrato, e passaram a ser asseguradas como ambíguas.
  - `work-time-estimate.test.ts`: o texto do item estornado mudou.
  - `work-time-income-estimate.test.ts`: retenção e contagens. As contagens refletem as leituras novas. A troca de "só o estado misto e o certo" por "nenhum estado misto" é reforço.
- **Mudança de harness:** a escuta falsa passou a entregar o retorno inicial sozinha (`initialSnapshot: true`, como o SDK). É exigida pelo contrato novo, mas tirou daquele arquivo os cenários em que a escuta ainda não respondeu; parte deles foi para `work-time-consistency.test.ts`.
- **Não achei enfraquecimento injustificado.**
- **Interface:** mudou só onde o contrato pede (aviso de ambiguidade, "horas sem cálculo seguro", mensagens novas, textos de nota). Tudo em pt-BR e acessível (`role="alert"`, `aria-hidden` no "?", rótulo no dia).
- **Segurança e isolamento:**
  - As leituras novas ficam em `workspaces/{fonte}/transactions` (por id) e `cash_report_periods` (campo `updatedAt`) do mesmo workspace. O teste de Rules novo nega outro workspace, membro removido, conta suspensa e anônimo.
  - Nenhuma escrita nova do cliente nos arquivos alterados (busca por `setDoc`, `updateDoc`, `addDoc`, `writeBatch` e `runTransaction`: nada).
  - Rules e índices não foram tocados.

## 6. Recomendações (mínimas)

1. **N01/N02:** num dia de jornada reduzida, contar a ocupação das janelas do próprio dia quando a rotina não passa do limite, ou aplicar o mesmo `limit` nos dois ramos. Acrescentar uma propriedade com plantão, hora extra e jornada reduzida até 1.440 min, mais o caso dirigido do §2.
2. **N04:** ler por id com `getDocsFromServer` (ou recusar `fromCache`) e tratar como falha de leitura.
3. **N05:** com a escuta em falha e estado `loading`, mostrar o erro com "Tentar de novo" e reabrir a escuta.
4. **N03/N06:**
   - Tratar `updatedAt` do desconsiderado maior que a versão do mês como pendente, com espera limitada, em vez de provado.
   - Sinalizar "pode estar desatualizada" quando a última provada for mostrada por mais que alguns segundos.
   - Corrigir as descrições de §6.
5. **N07:** recusar ao salvar ou avisar no editor de rotinas e de exceções quando a combinação ficar ambígua na janela; ou apontar o dia na mensagem da estimativa.

## 7. Sondas

Todas ficam em `<scratchpad>/p5f1r1/revisao/`. Comando:

```
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON <sonda> <raiz da árvore> [cenário]
```

Raízes:
- R1: `<scratchpad>/wt-p5f1-r1`
- P5-F.1: `<scratchpad>/p5f1r1/antes/arvore-d9b33cd1`

| Sonda | Mostra |
| --- | --- |
| `b01-puro.mts` | B01 puro: paridade do ID, A/B, pares nos lotes |
| `b02-busca.mts` (args: amostras, semente) | Busca geral de monotonia. Logs: `b02-busca-r1-60k.log` e `b02-busca-antes-3k.log` |
| `b02-cobertura.mts` e `b02-cobertura-sem-reduzida.mts` | Busca dirigida a coberturas. Logs: `b02-cobertura-r1.log`, `b02-cobertura-antes.log` e `b02-cobertura-sem-reduzida-r1.log` |
| `b02-minimizar.mts` (com `b02-violacao.json`) | Minimização da violação da busca |
| `b02-reduzida-teto.mts` e `b02-reduzida-total.mts` | N01 e N02 |
| `b02-excecao-ambigua.mts`, `b02-excecao-salvar.mts` e `b02-borda-ambigua.mts` | N07 |
| `b02-custo-conferidor.mts` | N09 |
| `b03-gancho.mts <raiz> <cenário>` | Gancho real com React Query. Cenários: `edicao-antes-da-primeira-leitura` (N03), `escuta-recusada-com-exclusao` (N05), `escuta-recusada-sem-exclusao-12m`, `leitura-por-id-do-cache-vazio` (N04), `limite-c-estimativa-parada` (N06) e `b01-parecer` |

`e2e-antes.spec.ts.txt` é o E2E da árvore `d9b33cd1` extraído com `git show`, só para comparação.
