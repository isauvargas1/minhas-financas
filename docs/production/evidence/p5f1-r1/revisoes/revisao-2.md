# Revisão independente 2 (somente leitura): P5-F.1-R1 depois das correções da revisão 1

**Data:** 2026-11-05/06 · **Árvore revisada:** `d7dabb10d39270dc299c304d7f3e02654366fc2b` (cópia fixa em `<scratchpad>/p5f1r1/revisao2/arvore-d7dabb10`, chamada aqui de SNAP).

**Comparações:**
- `b97806c4` (a árvore da revisão 1);
- `d9b33cd1` (a P5-F.1).

**Modo:**
- Nada foi alterado na SNAP, nas árvores anteriores nem no worktree. Do worktree usei só objetos Git (`diff`, `show`, `ls-tree`, `rev-parse`).
- Não houve commit, push, rede externa, Firebase, Emulator, Playwright nem `npm run`.
- Rodei testes de unidade e sondas com `node`. Sondas, saídas e cópias de trabalho ficaram todas em `<scratchpad>/p5f1r1/revisao2/`.

`<scratchpad>` = `<scratchpad>`.

## 0. Veredito

| Bloqueador | Veredito | Resumo |
| --- | --- | --- |
| **B01** | **CORRIGIDO**, sem regressão | O cenário do parecer dá R$ 100,00 em todas as renderizações do gancho, na SNAP e na b97806c4. A leitura em par melhorou (N08): não há mais ID repetido e o par fica no mesmo lote. Resta um canto informativo (M07). |
| **B02** | **CORRIGIDO no comportamento**; a justificativa escrita tem passos falsos | **Monotonia:** 0 violações em 182.354 pares com geradores adversariais próprios. Os mesmos geradores acham violações na b97806c4 (29) e na P5-F.1 (133).<br>**Dia civil:** acima de 24 h só na exceção registrada (§6).<br>**Conferidor:** sólido (0 dias ambíguos em 1.373 configurações aceitas e 85.126 planos de mês) e completo para as janelas da estimativa.<br>**Pendências:** a prova do Teorema 2 (§4) tem passos falsos, e o caso que os expõe não tem teste: um mutante sobrevive à suíte inteira (M03). O custo do conferidor está subestimado no documento (M04). |
| **B03** | **CORRIGIDO dentro dos limites arquiteturais**; os limites estão mal descritos | N03, N04, N05, N06 e N10 estão corrigidos, com testes que reprovam na b97806c4 e passam na SNAP. R11-01, R11-02, R8-02, R10-02 e B01 não regrediram.<br>Os limites (a), (b) e (c) são de fato inevitáveis sem mudar a projeção financeira. Mas (a) e (b) **subestimam** a renda quando a desconsiderada sobe de valor: o documento diz que "superestima" e que "nunca desconta duas vezes" (M01).<br>A espera limitada recomeça a cada montagem da estimativa, indefinidamente (M02). |

**Recomendação final: FAIL.** Não há defeito de código pendente nos três bloqueadores, mas restam três pendências:
- duas exigências documentais do pedido original sem cumprimento: "documente precisamente a limitação" (M01, MEDIUM) e "justificativa matemática" (M03);
- evidências citadas que não estão na árvore (M08).

Para virar PASS sem mudar o cálculo, bastam:
- corrigir §6 de `consistencia-estimativa.md` (M01);
- reescrever os passos 1 e 4 da prova (M03);
- acrescentar o teste dirigido que mata o mutante de M03;
- corrigir os números de custo (M04);
- completar o pacote de evidências (M08).

M02 pede ao menos a correção do texto; a mitigação sugerida é opcional.

## 1. Material e integridade

- **SNAP × árvore Git `d7dabb10`:** comparei 2.488 entradas (`git ls-tree` × `git hash-object`). Há 0 divergências, fora os 10 links simbólicos de `.claude/skills/`, que viraram diretórios na extração. A SNAP tem um arquivo a mais, `docs/production/evidence/p5f1-r1/mutantes.md`, que **não está na árvore Git** (M08).
- **Cópia da b97806c4 com os testes da SNAP** (`revisao2/b97806c4-com-testes-d7dabb10`): os 264 arquivos de `src/` conferem com a árvore Git `b97806c4`, com 0 divergências. Os hashes de `calendar.ts`, `consistency.ts`, `useIncomeEstimateWith.ts` e `receivableReversal.ts` batem com os da revisão 1.
- **Unidade na SNAP:** 12 arquivos (tempo de trabalho e relatórios), **214/214 PASS**, 0 fail, 0 skip e 0 todo, em 24 s (`revisao2/unit-snap.log`).

## 2. Achados da revisão 1 (N01–N10)

"Reprova na b97806c4" significa: o teste da SNAP, rodado sem alteração contra o `src/` da b97806c4. Só os imports de funções que não existem lá viraram stubs que lançam erro: `calendarAmbiguity`, `pendingWriteKey` e `unappliedWrites`. Logs: `revisao2/antes-*.log`.

| Achado | Corrigido? | Evidência |
| --- | --- | --- |
| **N01** (HIGH): jornada reduzida com plantão tirava horas | **Sim** | **Código:** `calendar.ts:426-470`. `happens` inclui o dia reduzido; o teto é `windowPart + (1.440 − previousOccupancy)`, com `windowPart = min(minutos, afterMidnight)`.<br>**Testes:**<br>• o dirigido reprova na b97806c4 (`'1980 → 1440'`) e passa na SNAP;<br>• a propriedade dirigida reprova lá e passa aqui.<br>**Sondas próprias (§4):** 0 violações em 182.354 pares na SNAP. Na b97806c4, 1 em 1.593 (`b02-mono-adv`) e 28 em 1.974 (`b02-motivos`). |
| **N02** (MEDIUM): dia civil acima de 24 h no dia reduzido | **Sim** | **Testes:** o dirigido e a propriedade "sem janela que passe da meia-noite" reprovam na b97806c4 e passam na SNAP.<br>**Sonda `b02-motivos`** (cópia instrumentada, 3,5 milhões de dias): dia civil acima de 24 h **só** depois de véspera em jornada reduzida (8.408 casos, a exceção registrada no §6); fora dela, 0. |
| **N03** (MEDIUM): edição antes da primeira leitura aparecia misturada | **Sim, até a espera limitada** | **Código:** `consistency.ts:131-132` (`updatedAt` com `bounded`), `:214-224`; `useIncomeEstimateWith.ts:337-356`.<br>**Teste:** reprova na b97806c4 (`loading → 1026000`) e passa na SNAP.<br>**Sonda da revisão 1**, `edicao-antes-da-primeira-leitura`: b97806c4 `loading → R$10260 → R$10560`; SNAP `loading → R$10560`.<br>**Resta:** o limite (a) depois de 30 s, mal descrito (M01), e um custo de vivacidade (M02). |
| **N04** (MEDIUM): leitura por id do cache local | **Sim** (fiação) | **Código:** `transactions/api.ts:169`, com `getDocsFromServer` (só a estimativa chama).<br>**Guarda:** a expressão regular da fiação reprova na b97806c4.<br>**Não reexecutado aqui:** o teste contra o SDK real (`disableNetwork`, `fromCache`, `unavailable`), em `work-time-p5f.rules.integration.test.mjs`, exige Emulator, que é proibido. O código do teste está certo. |
| **N05** (MEDIUM): "calculando" para sempre com a escuta recusada | **Sim** | **Código:** `useIncomeEstimateWith.ts:397-400`.<br>**Teste:** reprova na b97806c4 (`mostrados: loading`).<br>**Sondas:** a da revisão 1 dá na SNAP o erro "Não foi possível confirmar a estimativa…", com 0 leituras por id; na b97806c4, `loading` para sempre. Na sonda própria, com a escuta caindo durante a espera limitada, o resultado é `loading → erro`, sem prender. |
| **N06** (LOW): estimativa velha sem aviso | **Sim** | **Código:** `useIncomeEstimateWith.ts:410-429` e `holdEstimate` (`:158-167`).<br>**Testes:** dois cenários de gancho reprovam na b97806c4.<br>**Sonda própria `n06`:** SNAP `R$10560 → R$10560(aviso) → R$10660`; b97806c4 parado em `R$10560`.<br>**Resta:** o texto do aviso fala em falha (M05). |
| **N07** (LOW): configuração aceita ficava sem cálculo seguro | **Sim** | **Código:** `calendar.ts:698-777`, `draft.ts:440-443`, `WorkTimeSettingsView.tsx:266-272,457-459`.<br>**Testes:** os dirigidos, a propriedade e a preferência reprovam na b97806c4 (função ausente ou contrato novo).<br>**Sonda `b02-conferidor`:** 0 dias ambíguos em 1.373 configurações aceitas (§4.3). |
| **N08** (INFO): documentos e pares | **Em grande parte** | **Código:** `pairedReadIds` (`receivableReversal.ts:57-72`): sem ID repetido e com o par lado a lado. O teste reprova na b97806c4.<br>**Resta:** o canto com o espelho do estorno listado antes do recebimento (M07).<br>**Documentos:** os limites foram reescritos, mas com a direção errada (M01). |
| **N09** (INFO): custo | **Em parte** | **Memorização:** `validateDraft` é memorizado por rascunho (`WorkTimeSettingsView.tsx:266`, guarda), e o pré-filtro funciona (caso comum de 0 a 1 ms).<br>**Custo:** o pior caso medido é de 385 a 520 ms, não 65 ms (M04). |
| **N10** (INFO): lista de mudanças sem poda | **Sim** | **Código:** `consistency.ts:149-184`.<br>**Testes:** os puros de poda reprovam na b97806c4; os mutantes U59 e U60 da equipe são mortos. |

## 3. Achados novos

### M01 — MEDIUM — os limites (a) e (b) de B03 podem **subestimar** a renda, ao contrário do que diz o §6

- **Onde:** `docs/production/evidence/p5f1-r1/consistencia-estimativa.md:108`: "Nos três casos, o erro dura a latência do gatilho e **superestima** a renda do mês afetado. **Nunca desconta duas vezes.**"
  - A frase contradiz o próprio exemplo do N03 na tabela do §7: R$ 10.260,00 misto contra R$ 10.560,00 consistente.
  - Ela também generaliza para B03 a observação da revisão 1, "O (b) só superestima", que valia para o estorno (B01).
- **Mecanismo:** quando a desconsiderada **sobe** de valor (R$ 500,00 → R$ 800,00) e o gatilho grava depois da espera (a) ou fora de ordem (b), a exclusão nova sai do total antigo. Isso tira R$ 300,00 de **outras** receitas: é o efeito do B01 (exclusão que abate outra receita), em versão transitória.
- **Reprodução** (`revisao2/sondas/b03-gancho2.mts`, React Query real, espera de 400 ms; log em `b03-gancho2-snap.log`):
  - `limite-a-direcao`: `loading → R$10260 → R$10560`. Consistente: R$ 10.560,00. Misto: R$ 10.260,00, ou seja, **R$ 300,00 a menos**.
  - `limite-b-direcao`: `R$10560 → R$10360 → R$10660`. Consistentes: R$ 10.560,00 antes e R$ 10.660,00 depois. Misto: R$ 10.360,00, **abaixo dos dois**.
- **O que está certo no §6:**
  - (c), data que tira a desconsiderada da janela, só superestima;
  - para o estorno (B01), (b) só superestima;
  - os três limites são inevitáveis sem que a projeção registre as escritas aplicadas: as marcas `cash_period_events` são só do servidor, com o id do evento em hash. Isso é mudança de arquitetura financeira, fora do escopo.
  - Também está certo que (b) não tem a espera de 30 s: é imediato.
- **Correção mínima:**
  - reescrever a frase: "o erro pode subestimar ou superestimar a renda do mês; com uma desconsiderada que sobe de valor, a exclusão tira do total antigo mais do que ela soma nele (abate outra receita) até o gatilho gravar";
  - repetir isso na matriz (B01, linha "Resultado"), no relatório e no registro de riscos do plano.

### M02 — LOW — a espera limitada recomeça a cada montagem, indefinidamente, e a documentação diz "por até 30 s depois de uma edição"

- **Onde:**
  - `useIncomeEstimateWith.ts:341-355`: `waitStarts` é um `useRef` por instância, e a espera começa quando a escrita aparece.
  - `consistency.ts:131-132`: `updatedAt` de toda desconsiderada vira escrita com espera.
  - `consistencia-estimativa.md:97` (§5): "Ela só segura a estimativa por até 30 s depois de uma edição…".
- **Mecanismo:**
  - Uma edição sem efeito na renda (descrição, categoria, observação) de uma desconsiderada, feita depois da última gravação da projeção daquele mês, deixa `updatedAt > versão do mês` **para sempre**: o gatilho nunca grava.
  - Sem a última provada, o que ocorre em toda montagem nova (a carga do app, ou a prévia de Configurações e do assistente a cada abertura), a estimativa fica em "calculando" por `ESTIMATE_PENDING_WAIT_MS` (30 s).
  - Isso se repete até alguma mudança de receita ou despesa regravar aquele mês, o que, num mês passado, pode levar a janela inteira (até 12 meses).
- **Reprodução** (`b03-gancho2.mts remonta`, espera de 400 ms): três montagens seguidas, na mesma sessão com cache e em sessão nova.
  - SNAP: estimativa depois de **463, 419 e 426 ms**.
  - b97806c4: depois de 35, 5 e 26 ms. Era imediato porque não havia a espera, o que causava o N03.
- **Efeito:** fail-closed, sem número errado. É um custo de vivacidade recorrente, não documentado assim.
- **Correção mínima:**
  - corrigir o §5 ("a cada montagem, enquanto o mês não for regravado");
  - opcionalmente, medir a espera a partir da hora do servidor da escrita: `FinancialReport.generatedAt` (`reports/official.ts:346`) está disponível. Uma escrita `bounded` com `at < generatedAt − ESTIMATE_PENDING_WAIT_MS` já expirou. Isso mantém o mesmo limite de 30 s depois da escrita e elimina a repetição.

### M03 — LOW — a prova reescrita do Teorema 2 tem passos falsos num dia que segue a rotina, e o caso não tem teste

- **Onde:**
  - `rotinas-matematica.md:63`: "`o` os minutos das janelas de `d` depois da meia-noite".
  - `:82-84`, passo 1: "`o_d` nunca diminui; `w_d` perde no máximo `δ_d`".
  - `:90`, passo 4: "`m'_d ≥ m_d + δ_{d+1} − δ_d` … com `δ_{d+1} = o'_d − o_d`".
  - Código: `calendar.ts:432-434` (`afterMidnight`), `:461` e `:470`.
- **Mecanismo:**
  - Pela convenção de ocupação (`occupancyPieces`), o intervalo de uma janela da véspera que não cabe no trecho antes da meia-noite cai depois dela.
  - Coberta por uma janela do dia, essa lacuna conta na véspera (`prevFull`), mas ocupa o dia pela janela do dia (`ownPieces`), e não pela da véspera (`previousPieces`).
  - Então `afterMidnight = w − (ocupação própria)` fica **negativo** e não é "minutos depois da meia-noite". `w_d` perde mais que `δ_d`, e o passo 4 falha no dia.
- **Reprodução** (`revisao2/sondas/b02-prova-passo.mts`, log `b02-prova-passo.log`):
  - **Configuração:** segunda 20:00–24:00 e terça 00:00–06:00, sem intervalo; acrescentada a segunda 22:00–04:00 com 3 h de intervalo. Tudo aceito: `routinesAmbiguity` e `calendarAmbiguity` dão `null`.
  - **Terça:** `w` 360 → 120 (perde 240), com `δ_terça` = 180; `afterMidnight` vai de 0 a **−60**.
  - **Com 24 h de hora extra na terça:** a terça vai de 1.440 a **1.200**, abaixo do limite do passo 4 (1.440 + 0 − 180 = 1.260).
  - **Mês:** fica em 3.480 → 3.480. O teorema vale; a prova é que não.
- **O código está certo:** a terça tem 360 min de janelas no dia civil (240 contados na segunda e 120 na terça), e 1.440 − 360 = 1.080 de hora extra cabem; 120 + 1.080 = 1.200.
- **Teste ausente:** o mutante próprio `windowPart = happens ? Math.max(0, Math.min(minutes, afterMidnight)) : 0` (cópia em `revisao2/mutante-windowpart`) **sobrevive**: calendário 28/28, estimativa 23/23, preferência 12/12, consistência 26/26 e retenção 21/21. Com ele, a terça conta 1.260, o que dá 25 h no dia civil.
- **O teorema resiste:**
  - busca própria com 182.354 pares e 0 violações (§4);
  - argumento correto: `T_d` = minutos contados de `d` depois da meia-noite, que não diminuem. Num trecho de dias seguidos que seguem a rotina, as discrepâncias `D_{d+1} = E_d` (lacuna da véspera coberta pelo dia) se cancelam, e a soma ganha `ΔT_j ≥ 0`. Esse ganho cobre a perda `≤ δ` do dia seguinte de jornada reduzida ou sem a rotina, cuja `D` é zero, porque a véspera precisa estar coberta sem as janelas dele.
- **Correção mínima:**
  - reescrever §3 e §4 com `o` = `T_d − D_d` e o argumento por trecho;
  - acrescentar o caso acima como teste dirigido. Ele mata o mutante.

### M04 — LOW — o custo do conferidor está subestimado no documento, e a sonda citada não mede o caso coberto

- **Onde:**
  - `rotinas-matematica.md:54` e `respostas-revisao-1.md:86`: "com cobertura, média de 8 ms e pior caso de 65 ms (`sondas/custo-cal`)";
  - código: `calendar.ts:698-777`, executado em `WorkTimeSettingsView.tsx:266` a cada mudança do rascunho (inclusive ao digitar) e no assistente.
- **Reprodução** (`revisao2/sondas/b02-custo.mts`, node, desktop; cinco chamadas):
  - **comum:** 0 a 1 ms;
  - **coberta, sem exceções:** 172, 77, 50, 54 e 50 ms;
  - **pior caso dentro da gramática** (3 rotinas cobertas, uma cíclica 27×26, 120 exceções de 366 dias e 40 feriados anuais): **520, 431, 385, 409 e 487 ms**, com `validateDraft` em 416 ms.
- **Por que o documento erra:** a sonda da equipe (`<scratchpad>/p5f1r1/sonda-proto/custo-cal.mts`, fora da árvore) usa uma base **sem** janela coberta. O pré-filtro corta tudo em 0,1 ms, então nenhum dos casos dela mede o caminho coberto.
- **Correção mínima:**
  - corrigir os números e anexar a sonda;
  - opcionalmente, guardar o resultado em cache por (rotinas, feriados, exceções, `worksOnHolidays`, mês de hoje) ou adiar o conferidor (por exemplo, com debounce) fora do caminho da digitação.

### M05 — LOW — o aviso de estimativa antiga (N06) diz que algo falhou quando nada falhou

- **Onde:**
  - `useIncomeEstimateWith.ts:427-428` reaproveita `refreshFailed`;
  - o topo mostra `ESTIMATE_QUALIFIER_STALE` (`messages.ts:92`): "A última atualização da estimativa falhou: ela usa a leitura anterior";
  - os detalhes mostram `ESTIMATE_REFRESH_FAILED` (`messages.ts:76`).
- **Efeito:** depois de 30 s com a última provada no lugar da atual, por espera de confirmação e sem erro, o texto afirma uma falha. O texto está em pt-BR, mas é impreciso.
- **Correção mínima:** aceitar e registrar, já que a escolha foi não mexer na interface, ou usar um texto neutro ("ainda confirmando os lançamentos mais recentes; ela usa a leitura anterior").

### M06 — INFO — `validateDraft` passa a lançar `RangeError` com uma data de exceção inválida

- **Onde:** `draft.ts:440`. `calendarAmbiguity` roda **antes** da checagem de formato (`workTimePreferenceFields`, `:449-452`) e chama `dayNumber` nas datas (`calendar.ts:731-733`).
- **Reprodução** (`b02-custo.mts`, final): férias com início `2026-02-30` dão `validateDraft lançou RangeError: Data civil inválida.`, em vez de "Há exceções sobrepostas ou fora do formato".
- **Alcance:** não alcançável pela interface: o editor só aceita datas válidas (`draft.ts:215-217`), e a preferência salva passa pela gramática. Em Configurações, porém, a chamada fica dentro de `useMemo` na renderização.
- **Correção mínima:** checar o formato antes do conferidor, ou proteger `dayNumber`.

### M07 — INFO — `pairedReadIds`: o par se parte quando o espelho do estorno vem antes do recebimento na lista

- **Onde:** `receivableReversal.ts:60-61`. O par `(B, estorno de B)` é pulado se o estorno já entrou como primeiro elemento do próprio par.
- **Reprodução** (`revisao2/sondas/b01-pares-canto.mts`): `{"total":63,"repetidos":0,"loteDeB":2,"loteDoEstornoDeB":0,"consultas":3}`.
- **Alcance:** só com uma lista montada fora da interface (o estorno não soma renda e não é oferecido). Os espelhos são imutáveis, então não há efeito no valor. O teste N08 usa só a ordem inversa (recebimento antes).
- **Correção mínima:** ajustar a frase "sempre na mesma consulta" (matriz e comentário), ou pôr o par do recebimento primeiro.

### M08 — INFO — evidências citadas que não estão na árvore

**Referências ausentes:**
- `LEIAME.md` lista `execucoes.md`, `VEREDITOS.md`, `revisoes/revisao-2.md` e `respostas-revisao-2.md`, que não existem em `d7dabb10`.
- `respostas-revisao-1.md` cita os logs `cobertura-proto-80k*` e `busca-proto-60k`, e `rotinas-matematica.md` cita `sondas/custo-cal`. Estão só em `<scratchpad>/p5f1r1/sonda-proto/`.
- `consistency.ts:36` e `LEIAME.md` citam a "§20.16 do plano", mas o plano mestre não foi alterado e não tem a §20.16.

**Arquivo fora da árvore:** `mutantes.md` está na SNAP, mas não na árvore Git.

**Correção:** antes do pacote final, pôr as evidências na árvore e atualizar o plano mestre (§20.16) com decisões, riscos e limites.

### M09 — INFO — o calendário de exceções mostra "horas sem cálculo seguro" num mês antigo de uma configuração aceita

- **Reprodução** (`revisao2/sondas/b02-mes-antigo.mts`): `{"conferidor":null,"mes2024_10":["2024-10-14"]}`. É a folga de 15/10/2024, fora dos 12 meses conferidos.
- **Alcance:** é coerente com o desenho (nenhuma estimativa usa esse mês, e há teste disso), mas é uma inconsistência visual no editor.
- **Correção:** só registrar.

## 4. O que foi verificado e passou

### 4.1 B02: monotonia (periodStart no 1º mês) com geradores próprios

| Sonda (em `revisao2/sondas/`) | Árvore | Pares conferidos | Violações |
| --- | --- | --- | --- |
| `b02-mono-adv.mts`, modos `mix` 60k, `spill` 40k, `reduced` 40k, `cluster` 30k e `free` 30k (log `b02-mono-adv-snap.log`) | SNAP | 31.760 + 11.172 + 20.989 + 23.560 + 15.677 = **103.158** | **0** |
| `b02-mono-adv.mts mix` 3k | b97806c4 | 1.593 | 1 (classe N01) |
| `b02-mono-adv.mts mix` 3k | d9b33cd1 | 3.000 | 133 |
| `b02-motivos.mts`, 2 × 60k (log `b02-motivos-snap.log`) | SNAP | **79.196** | **0** (8.999 dias reduzidos no teto) |
| `b02-motivos.mts` 3k | b97806c4 | 1.974 | 28 |

**Cobertura dos geradores:**
- jornada reduzida até 24 h;
- plantão e hora extra até 24 h, juntos;
- alteração de escala de 0 a 24 h;
- férias, folga e ausência, isoladas ou em bloco;
- feriados locais, trabalhados ou não, e `worksOnHolidays`;
- turnos que passam da meia-noite, inclusive com intervalo maior que o trecho antes dela, coberto pelo dia seguinte;
- turnos de 24 h às 00:00 e às 12:00;
- durações de até 24 h;
- escalas cíclicas;
- cópia de rotina com outro intervalo;
- bloco no começo, no meio e no fim do período, com janelas de 1 a 3 meses.

### 4.2 B02: o dia civil e o §6

- **Sonda `b02-motivos`** (cópia instrumentada `revisao2/instr`, só um campo de depuração a mais, sem mudar o cálculo): 3,5 milhões de dias.
  - Acima de 24 h no dia civil, **só** com a véspera em jornada reduzida (8.408 casos); fora dela, 0.
  - "Num dia que segue a rotina, é o mesmo teto de antes" vale algebricamente: `windowPart = afterMidnight ≤ w`, e o limite é `w + 1.440 − ocupação`.
- **Tabelas §5 e §6 conferidas** com as sondas da própria R1 nas três árvores (`revisao2/sondas-r1.log`):
  - 480 → 480 (P5-F.1: 390);
  - 26 dias ambíguos no noturno;
  - borda: 44.640 → 44.640 no período e 44.280 no mês avulso (P5-F.1: 42.840);
  - teto: 7.200 → 7.440 (P5-F.1: 6.240);
  - véspera reduzida: segunda 480, terça 1.440; com a véspera seguindo a rotina, terça 1.080. A P5-F.1 dá os mesmos números com a véspera reduzida.
- **"Descontar quebraria o Teorema 2"** confere: acrescentar segunda 23:00–08:00 mantém a segunda em 480 e o mês sobe de 3.120 para 3.360.

### 4.3 B02: conferidor do calendário inteiro

- **Solidez** (`b02-conferidor.mts`):
  - **Geradores:** cobertura no mesmo dia, pela véspera e pelo dia seguinte, e escala cíclica que passa da meia-noite.
  - **Calendário:** exceções de todos os tipos e feriados anuais, inclusive 30/12 e 31/12 na virada do ano.
  - **Datas de hoje:** 05/11/2026, 10/01/2027 e 31/03/2026.
  - **Resultado:** 300 + 2.500 amostras, **1.373 aceitas, 85.126 planos de mês** (cada mês de hoje − 12 até hoje + 14, mais 2030-02, 2035-07, 2048-12 e 2099-11, avulso e abrindo o período): **0 dias ambíguos**.
- **Argumento de solidez** (confere com o código):
  - As entradas de `planDay` só mudam quando um vizinho (d − 2, d − 1 ou d + 1) não segue a rotina ou quando o dia abre o período.
  - Tirar janelas não cria cruzamento.
  - Um dia sem janela com intervalo coberta, nas rotinas sozinhas, não fica ambíguo com menos janelas.
  - O salto do ano em `first − 2` (31/12) é inócuo, porque 01/01 é feriado nacional.
- **Completude para a estimativa:**
  - a janela de 12 meses começa em hoje − 12, que é o `first`;
  - o 1º mês usado pode ser qualquer mês da janela (`estimate.ts:174-179`), e o laço confere o dia 1 de todos os meses até 2099;
  - `today` é a data de São Paulo, nos dois lados (`saoPauloDayKey`).

### 4.4 B03: espera limitada, leitura do servidor, poda e pares

- **`PendingWrite.bounded`, `pendingWriteKey`, `unappliedWrites` e `expired`** estão coerentes:
  - a espera é por escrita (lançamento, mês e hora);
  - expira só a `bounded`;
  - as escritas sem espera (criação, confirmação, anulação e estorno) sempre levam o gatilho a gravar.
- **Premissa conferida no backend:** toda escrita em lançamento grava `updatedAt` e `createdAt` (`createTransaction.ts:270-271`, `mutateTransaction.ts:666,828,933`, `receivables/model.ts:468-469`, importação). O gatilho grava os meses numa transação só (`periods.ts:1106`, `writeCashMonth`). Logo, nenhuma escrita sem espera fica com `at = null` e prende a prova.
- **Sem estado preso:**
  - escuta recusada, com e sem desconsiderada: o erro com "Tentar de novo";
  - escuta caindo durante a espera: o erro;
  - "Tentar de novo" reabre a escuta;
  - `blockedByListen` cobre o primeiro retorno que nunca chega.
- **`getDocsFromServer`:** mesma consulta e mesmo workspace-fonte; sem rede, falha.
- **Poda (`observeExcludedRead`):** remove só o que a projeção já passou, com a mesma premissa da regra 5.
- **`pairedReadIds`:** sem ID repetido e com o par no mesmo lote, salvo o canto M07.
- **Sem regressão** (testes da SNAP, 214/214; sondas da revisão 1 na SNAP): R11-01, R11-02, R8-02, R10-02, primeira renderização, troca de conta, workspace e janela, três ordens de resposta e B01 (`b01-parecer`: `loading → R$100`).
- **Os limites (a), (b) e (c) existem como descritos**, inclusive (c) só na primeira leitura da sessão e (b) imediato. São inevitáveis sem mudar a projeção, que não registra as escritas aplicadas. O que está errado é só a direção do erro (M01).

### 4.5 Testes

- **Nenhum enfraquecimento no delta inteiro sobre d9b33cd1:**
  - sem `skip`, `only`, `todo` ou `fixme`;
  - nenhuma mudança de configuração do Playwright nem de retries;
  - os `setTimeout` e `timeout: 30_000` novos seguem o padrão dos E2E existentes;
  - o `package.json` só acrescenta `work-time-consistency.test.ts` ao script.
- **As asserções removidas foram trocadas por versões atualizadas ou mais fortes:**
  - assinaturas novas de `validateDraft` e `holdEstimate`;
  - "erro: a anterior" virou "a anterior com o aviso";
  - "só o estado misto e o certo" virou "nenhum estado misto";
  - as contagens de releitura (2 → 3 e 3 → 5) estão documentadas em §5.
- **`pendingWaitMs: 800`** só no mundo de `work-time-consistency.test.ts`, maior que a latência do gatilho simulado. Por isso os testes não exercitam (a), que está documentado.
- **Os testes novos reprovam na b97806c4** pelos motivos certos:
  - calendário: 6;
  - consistência: 8;
  - estimativa: 1;
  - preferência: 2;
  - retenção: 2;
  - guarda: 2 das 5 falhas são da fiação nova; as outras 3 vêm da cópia sem `functions/` e sem Rules.
  - Uma ressalva: "editada sem efeito na renda" reprova lá só porque a b97806c4 mostrava o valor certo **mais cedo**. Ela testa a espera, não a correção.
- **Mutantes:** `mutantes.md` registra 67/67 mortos (não reexecutei a bateria). Achei um sobrevivente fora dela (M03).

### 4.6 Segurança, multi-tenant, pt-BR e interface

- **Sem leitura fora do workspace-fonte, sem escrita nova do cliente.** A busca por `setDoc`, `updateDoc`, `addDoc`, `deleteDoc`, `writeBatch`, `runTransaction` e `httpsCallable` no delta de `src/` não acha nada. A única mudança é `getDocsFromServer`.
- **Rules, índices, `firebase.json` e Functions não mudaram**, salvo testes. O teste de Rules novo nega `getDocsFromServer` em outro workspace (não reexecutado: Emulator).
- **Interface, só onde o contrato pede:**
  - o aviso `role="alert"` junto do botão de salvar;
  - o "?" e "horas sem cálculo seguro" no calendário;
  - uma frase de ajuda no editor de rotinas;
  - os textos de `capped_days` e `ambiguous_routines`;
  - a mensagem `calendarAmbiguityMessage` e o erro `ESTIMATE_UNCONFIRMED_FAILED`.
  - Tudo em pt-BR, acessível (`sr-only`, `aria-hidden`) e sem mudança de layout ou navegação. A única ressalva é a imprecisão de M05.

### 4.7 Não reexecutado (proibido nesta revisão)

- Emulator (Rules, integração do backend e o teste do N04 contra o SDK real);
- Playwright (E2E `B01`, `B02` e `B02 (revisão da R1, N07)`);
- `npm run verify:all`;
- a bateria de mutantes da equipe.

## 5. Sondas desta revisão (todas em `<scratchpad>/p5f1r1/revisao2/`)

| Sonda | Mostra |
| --- | --- |
| `sondas/b02-mono-adv.mts <raiz> [amostras] [semente] [modo]` | Monotonia adversarial (5 modos) |
| `sondas/b02-motivos.mts <raiz> [amostras] [semente] [raiz instrumentada]` | Monotonia por motivos e dia civil |
| `sondas/b02-prova-passo.mts <raiz> [instr]` | M03 |
| `sondas/b02-conferidor.mts <raiz> [amostras] [semente]` | Solidez do conferidor |
| `sondas/b02-custo.mts <raiz>` | M04, M06 |
| `sondas/b02-mes-antigo.mts <raiz>` | M09 |
| `sondas/b01-pares-canto.mts <raiz>` | M07 |
| `sondas/b03-gancho2.mts <raiz> <cenário> [esperaMs]` | Cenários `remonta` (M02), `limite-a-direcao` e `limite-b-direcao` (M01), `n05`, `escuta-cai-durante-espera` e `n06` |
| `sondas/b03-gancho-rev1.mts` | A sonda da revisão 1, com `node_modules` da SNAP |
| `instr/` | Cópia instrumentada de `calendar.ts` (campo `__debug`) |
| `mutante-windowpart/` | O mutante sobrevivente de M03 |
| `b97806c4-com-testes-d7dabb10/` | Os testes da SNAP sobre o `src/` da b97806c4 |

Comando: `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON <sonda> <raiz> …`

## 6. SHA-256 (16 hex) dos arquivos de `src/` revisados (SNAP = `d7dabb10`)

```
a00afb36f940e3ab src/components/WorkTimeSettingsView.tsx
5bd28e019bf974b3 src/components/workTime/ExceptionsEditor.tsx
789e848d634cd841 src/components/workTime/RoutineEditor.tsx
050625867141a84e src/components/workTime/WorkTimeWizard.tsx
9306458d2b10e9b6 src/modules/reports/basisRefresh.ts
0f38ad185f3e0bfe src/modules/reports/basisRegistry.ts
d5205070e5ef3273 src/modules/reports/basisSync.ts
bd915c7d85cc3cee src/modules/reports/hooks.ts
6cab2fd570e3e0bf src/modules/reports/liveRefresh.ts
36fb0c00b699770b src/modules/transactions/api.ts
e1ac703769dc114f src/modules/transactions/incomeReads.ts
b5b62b6fe3ace0e0 src/modules/work-time/calendar.ts
e78e891cc3fe59c1 src/modules/work-time/consistency.ts
a83d124898b2b305 src/modules/work-time/draft.ts
141737af818e6b12 src/modules/work-time/estimate.ts
fab816fcc3e8c2e4 src/modules/work-time/incomeBasis.ts
63cabc7bf76b2259 src/modules/work-time/messages.ts
e716ab22782874d5 src/modules/work-time/receivableReversal.ts
267623503069b3f1 src/modules/work-time/useIncomeEstimateWith.ts
```

Na b97806c4, conferem com a revisão 1: `calendar.ts` 9b956512bb0de6a1, `consistency.ts` 05ff4af8073b9987, `useIncomeEstimateWith.ts` fca49e5dd13b92b1 e `receivableReversal.ts` 96d05a96d72bb3c4.
