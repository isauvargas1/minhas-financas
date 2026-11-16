# Revisão independente 3 (somente leitura): P5-F.1-R1 depois das correções da revisão 2

**Data:** 2026-11-06 · **Árvore revisada:** `6c459430cd68b929f8c47df54d297235e3c7fd9c` (cópia fixa em `<scratchpad>/p5f1r1/revisao3/arvore-6c459430`, chamada aqui de SNAP).

`<scratchpad>` = `<scratchpad>`.

**Comparações:**
- `d7dabb10` (a árvore da revisão 2): só as correções feitas depois dela;
- `d9b33cd1` (a P5-F.1): o delta inteiro da R1.

**Modo:**
- Nada foi alterado na SNAP, nas árvores anteriores nem no worktree. Conferi no fim que a SNAP continua igual à árvore Git (0 divergências).
- Do worktree usei objetos Git: `diff` e `ls-tree` entre árvores, `show`, `cat-file`, `grep` numa árvore, `archive`. Houve também uma chamada `git status --porcelain` e uma `git log -1`. Elas só leem, mas o `status` pode atualizar os dados de stat do índice; o conteúdo do índice não muda.
- Não houve commit, push, rede externa, Firebase, Emulator, Playwright nem `npm run`.
- Rodei com `node`:
  - testes de unidade;
  - sondas próprias;
  - `tsc --noEmit` (sem gravar nada).
- Sondas, saídas e cópias de trabalho (híbrida e mutantes) ficaram todas em `<scratchpad>/p5f1r1/revisao3/`.
- Retomei a revisão depois do reinício do contêiner. Reconferi a SNAP e rodei de novo tudo o que tinha sido cortado.

## 0. Veredito

| Bloqueador | Veredito | Resumo |
| --- | --- | --- |
| **B01** | **CORRIGIDO**, sem regressão | O cenário do parecer dá R$ 100,00 em todas as renderizações. A leitura em par ficou certa em qualquer ordem da lista (M07), com teste que reprova na `d7dabb10`. |
| **B02** | **CORRIGIDO**; a prova agora está certa | O código não mudou desde a `d7dabb10`.<br>**Prova:** a do Teorema 2 (§3 e §4) confere com `planDay`. Os cinco passos valem dia a dia nos meus geradores: 0 falhas em 3.493.099 dias. O mesmo conferidor acha passos que falham na `b97806c4` (o defeito N01) e no mutante U68.<br>**Monotonia:** 0 violações em 137.211 pares.<br>**Dia civil:** acima de 24 h, 0 casos em 16,2 milhões de dias fora da exceção do §6.<br>**Teste:** o de M03 mata U68. |
| **B03** | **CORRIGIDO dentro dos limites registrados** | A espera pela hora do servidor (M02) é segura:<br>• não abre estado misto além do limite (a);<br>• não prende a estimativa;<br>• usa só horas do servidor.<br>R11-01, R11-02, R8-02, R10-02, B01 e N03 a N06 não regrediram.<br>**Resta (P01):** nenhum teste fixa o limite de 30 s. Um mutante que encerra a espera 1 ms depois da escrita passa em toda a suíte e traz de volta o estado misto do N03 (R$ 10.260,00) no caminho de produção. |

**Recomendação final: FAIL.** Não há defeito de código nos três bloqueadores. O FAIL vem de duas pendências:
- **P01:** a afirmação de segurança da correção nova, "o limite continua 30 s depois da escrita", não tem teste. O mutante U71 só fixa o limiar 0, porque no teste a base é gerada no mesmo segundo da escrita.
- **P02:** `VEREDITOS.md` afirma coisas falsas sobre o código e os testes revisados.

Há também pendências de evidência e de texto (P03 a P06).

**Para virar PASS sem mudar o cálculo:**
1. Acrescentar os três testes de P01 a `work-time-consistency.test.ts`. Prontos em `revisao3/sondas/r3-espera-servidor.test.ts.tail`: N03 com a hora do servidor, 59 s ainda segura e 60 s encerra.
2. Corrigir `VEREDITOS.md:5` e `:18` (P02).
3. Pôr os logs da revisão 2 na árvore ou no pacote (P04).

P03, P05 e P06 são correções de texto recomendadas.

## 1. Material e integridade

- **SNAP × árvore Git `6c459430`:** 2.520 entradas, das quais 2.510 arquivos (`git hash-object --stdin-paths`) e 10 links simbólicos (alvo conferido). Há 0 divergências e nenhum arquivo a mais. Conferi de novo no fim: igual.
- **Correções depois da revisão 2** (`diff d7dabb10 6c459430`): 47 arquivos.
  - **Código:** 4 arquivos de `src/`: `useIncomeEstimateWith.ts`, `draft.ts`, `messages.ts` e `receivableReversal.ts`.
  - **Testes:** 4 de unidade (calendário, consistência, estimativa e preferência) e o E2E (`work-time-p5f.spec.ts`, 3 asserções de texto).
  - **O resto:** documentos e sondas.
- **Unidade na SNAP:** 12 arquivos (tempo de trabalho e relatórios), **217/217 PASS**, 0 fail, 0 skip, 0 todo, em 19,6 s (`revisao3/unit-snap.log`). São 214 na `d7dabb10` mais os 3 testes novos (M02, M03 e M06); M07 entrou num teste que já existia.
- **`tsc --noEmit`** na SNAP (o mesmo `tsconfig` do `typecheck`): saída 0, sem gravar arquivo.
- **Base dos mutantes da equipe:** os 407 arquivos da rodada `mutantes-r1-rev2` (`*.sha-antes`) conferem com a SNAP (`sha256sum -c`: 407 OK). Antes e depois da rodada, o SHA e o `git status` são iguais. O log diz `73/73 mortos; 0 não compilam; 940 s`. O mesmo vale para a rodada dos mutantes do E2E (`e2e-mutantes-rev2b`): 407 OK e 3/3 mortos.
- **Cópias na árvore:** `revisoes/revisao-2.md` e as 9 sondas de `sondas-revisao-2/` são cópias fiéis dos originais, com o caminho trocado por `<scratchpad>`.

## 2. Achados da revisão 2 (M01–M09)

"Reprova na `d7dabb10`" significa: o teste da SNAP, rodado sem alteração sobre o `src/` da árvore `d7dabb10`. A cópia é `revisao3/h-d7dabb10-testes-6c459430`: `git archive` da `d7dabb10` com os `tests/` da SNAP. O `diff` confirma que só os 4 arquivos de `src/` diferem. Logs: `revisao3/antes-d7-*.log`, iguais aos `logs/antes-revisao2-*.log` da equipe.

| Achado | Veredito | Evidência |
| --- | --- | --- |
| **M01** (MEDIUM): direção do erro em (a) e (b) | **Corrigido** | **Texto:** `consistencia-estimativa.md:114-120` tem a direção por caso:<br>• (c) só superestima;<br>• o estorno em (b) só superestima;<br>• a desconsiderada que sobe de valor subestima, e a que cai superestima.<br>"Nunca desconta duas vezes" saiu. A matriz B03 (`matriz-bloqueadores.md:43`) repete a correção.<br>**Sondas da revisão 2 na SNAP** (`rev2-b03-gancho2-r3.log`):<br>• `limite-a-direcao`: `loading → R$10260 → R$10560`;<br>• `limite-b-direcao`: `R$10560 → R$10360 → R$10660`.<br>São os exemplos do §6. |
| **M02** (LOW): a espera recomeçava a cada montagem | **Corrigido** no caso descrito, com P01 e P03 | **Código:** `useIncomeEstimateWith.ts:68-73` e `:348-380` (análise na §4).<br>**Teste "revisão 2 da R1 (M02)"** (`work-time-consistency.test.ts:689-711`): reprova na `d7dabb10` (`tempo esgotado: a estimativa sem esperar de novo (mostrados: loading)`) e passa na SNAP.<br>**Restam:**<br>• o limite de 30 s sem teste (P01);<br>• o recomeço por montagem quando as bases em cache foram geradas nos 30 s da edição (P03). |
| **M03** (LOW): passos falsos na prova e mutante vivo | **Corrigido** | **Prova:** `rotinas-matematica.md` §3 (`:66-95`) e §4 (`:97-117`), conferidas na §3 deste relatório.<br>**Teste** (`work-time-calendar.test.ts:691`):<br>• passa na `d7dabb10`, como esperado, porque o código não mudou;<br>• com U68 (`windowPart` ≥ 0, cópia `revisao3/mut-u68-windowpart`) reprova (`not ok 22`, calendário 28/29).<br>Restam deslizes de notação (P06). |
| **M04** (LOW): custo do conferidor | **Corrigido** | **Documento:** os números de `rotinas-matematica.md:59-64` batem com `logs/sonda-final-custo-m04.log`: comum [1,0,0,0,0] ms, coberta [84,46,42,43,42], pior caso [389,382,368,378,370] e `validateDraft` 481 ms.<br>**Árvore da sonda:** o log foi rodado na árvore `75027d92`, que difere da SNAP só em 4 documentos (`diff --stat`). Logo, o código medido é o final.<br>**Minha execução** (`rev2-b02-custo-r3.log`, com outras 4 sondas em paralelo): 0–1 ms, 31–131 ms, 223–299 ms e `validateDraft` 222 ms. É a mesma ordem.<br>**Outros números:** "média 9 ms, pior entre 59 e 80 ms" confere com `sonda-final-aceita*` (8,74 e 8,95 ms; 58,9 e 80,4 ms). |
| **M05** (LOW): o aviso falava em falha | **Corrigido** | **Texto:** `messages.ts:92`, em pt-BR e verdadeiro nos dois casos.<br>**Unidade:** `work-time-estimate.test.ts:534` com o texto exato; reprova na `d7dabb10`.<br>**E2E** (`e2e/work-time-p5f.spec.ts`):<br>• `:1053` e `:1152`, com o texto inteiro;<br>• `:1059`, a negativa, agora com um prefixo comum ao texto dos detalhes (`ESTIMATE_REFRESH_FAILED`), o que a deixa **mais** estrita.<br>Nenhuma asserção saiu. O texto antigo só aparece em revisões históricas. Não rodei o E2E (proibido). |
| **M06** (INFO): `RangeError` em `validateDraft` | **Corrigido** | **Código:** `draft.ts:440-447`.<br>**O que o `catch` pega:** só lançam ali as datas de exceção em `dayNumber`. A referência da escala é conferida antes (`draft.ts:424-426`), e os feriados locais passam por `isCivilDate` no conferidor. A mensagem é a mesma da checagem de formato (`:455-458`), e o resultado continua fail-closed (`ok: false`).<br>**Teste** (`work-time-preference.test.ts:176`): reprova na `d7dabb10` (`RangeError: Data civil inválida.`) e passa na SNAP.<br>**Mutante U72** (o `try` tirado): morto (`mut-u72.log`). |
| **M07** (INFO): o par se partia | **Corrigido** | **Código:** `receivableReversal.ts:60-61`.<br>**Teste N08** nas duas ordens (`work-time-estimate.test.ts:329`): reprova na `d7dabb10` (`o estorno logo depois`).<br>**Mutante U73:** morto.<br>**Sonda própria** `b01-pares-r3.mts`, 3.000 listas aleatórias com espelhos antes e depois do recebimento, cadeias de estorno do estorno, IDs comuns e repetidos:<br>• SNAP: **0** pares partidos, nenhum ID repetido, até 61 IDs (≤ 100);<br>• `d7dabb10`: 2.532 listas com par partido. |
| **M08** (INFO): evidências fora da árvore | **Em parte** (P04) | **Na árvore:** `mutantes.md`, `VEREDITOS.md` (rascunho), `revisao-2.md`, `respostas-revisao-2.md`, as sondas das duas revisões e as sondas da R1.<br>**Pendentes, como diz o pedido:** `execucoes.md`, §20.16 e relatório.<br>**`roteiros/` e `logs/execucoes/`:** são diretórios do pacote (`empacotar.sh`), e os logs citados existem em `p5f1r1/logs/`.<br>**Falta:** os logs da revisão 2, que a resposta diz estarem na árvore (P04). |
| **M09** (INFO): mês antigo com "horas sem cálculo seguro" | **Registro incompleto** (P05) | **A resposta diz** "Registrado (`rotinas-matematica.md` §2, RR-R1-02)". O §2 não traz esse registro, e o RR-R1-02 está nos documentos pendentes.<br>**O comportamento é coerente:** o conferidor cobre de 12 meses antes do mês de hoje até 2099. |

## 3. B02: a prova reescrita (Teorema 2) e as buscas próprias

### 3.1 Conferência algébrica com `planDay` (`calendar.ts:407-505`)

**Identidade do teto.** Com a notação do §3 (`w = w^c + T`, `A`, `P`, `D = A − P`), as fórmulas conferem com o código:
- **Ocupação.** `civilOccupancy(d, own, prev) − P` é o tempo do dia civil ocupado pelas peças de `d` fora das da véspera.
- **Lacunas cobertas.** Num dia com cálculo seguro, as peças cobrem tudo o que é trabalhado no dia civil, porque cada lacuna da convenção de uma janela coberta está em janelas sem intervalo de `d − 1` ou de `d`. Então `|peças(own ∪ prev) ∩ civil(d)| = A + w^c`.
- **Depois da meia-noite.** `o = w − (A + w^c − P) = T − D` (`calendar.ts:432-434`).
- **Teto.** `limit = min(r, o) + 1.440 − P` (`:461`, `:470`). Num dia que segue a rotina, `o ≤ T ≤ w ≤ r`, logo `m = T + min(w^c + x + a, 1.440 − A)`. Confere com §3.
- **`D ≥ 0`.** As peças excluem só a lacuna da convenção.
- **`D = 0` num dia que não segue a rotina.** `planDay(d − 1)` lê `next = []` (`workedWindowsOn`, `:355-356`). A janela com intervalo da véspera que cruza outra precisa estar coberta por janelas de `d − 2` ou `d − 1`; senão `d − 1`, que segue a rotina, fica ambíguo e é marcado. Então a lacuna está nas peças da véspera, e `P = A`.
- **Exemplo M03** (§3, `:88-91`): `A = 240`, `P = 180`, `D = 60`, `T = 0`, `w = 120`, `o = −60`, e a terça com 24 h de hora extra conta `0 + min(120 + 1.440, 1.200) = 1.200`. Confere.

**Os passos 1 a 6 conferem:**

| Passo | Conferência |
| --- | --- |
| 1. `ΔT ≥ 0` | Uma janela da véspera termina antes da meia-noite de `d`. Uma janela isolada que passa a coberta só ganha a extensão inteira. |
| 2. `δ_d = ΔT_{d−1}` | Vale com a véspera seguindo a rotina no período; senão `δ = 0`. |
| 3. `w^c` perde no máximo `δ` | O trabalhado no dia civil só cresce, e a parte da véspera cresce `δ`. |
| 4. Dia que segue a rotina | `m' ≥ T + ΔT + min(w^c − δ + x + a, 1.440 − A − δ) = m + ΔT − δ`. |
| 5. Dia que não segue a rotina | `min(r, T)` não diminui (os dois casos da redução estão certos; com a rotina sem acontecer, o termo é 0). Os dois termos perdem no máximo `δ`. |
| 6. Soma | Cada `δ_d > 0` tem o `+ΔT_{d−1}` correspondente na véspera, que segue a rotina e está no período. O primeiro dia não tem `δ`. |

A frase de abertura do §4 também está certa: um minuto só muda de `d` para `d − 1` com uma janela **nova** da véspera. Uma janela antiga que era isolada não cruzava nenhuma janela de `d`.

Só há deslizes de notação (P06).

### 3.2 Buscas próprias (`revisao3/sondas/b02-r3.mts` e `b02-r3-passos.mts`)

**Gerador próprio.** Até 3 rotinas semanais ou cíclicas, com:
- janelas em grade de 1 a 60 min e horários especiais (00:00, 20:00, 22:00, 23:00 e 23:59);
- turnos de 24 h;
- intervalos que não cabem antes da meia-noite (de propósito);
- durações;
- as 8 exceções, com reduzida de 0 a 24 h, plantão e hora extra de até 24 h, inclusive no mesmo dia;
- feriados locais e `worksOnHolidays`;
- janelas de 1 a 3 meses, com o primeiro abrindo o período.

**Modos:**
- `spine`: o caso de M03 (véspera s–24:00, dia 00:00–e e a coberta com intervalo maior que o trecho antes da meia-noite), com exceções em X, X+1 e X+2;
- `edge`: meia-noite e 24 h;
- `copy`: a mesma rotina com outros intervalos;
- `free`: aleatório;
- `mix`: a mistura dos quatro.

**Par aceito:** C e C' sem dia ambíguo nos meses da janela.

**Oráculo geométrico próprio:** os conjuntos trabalhados de cada janela, no contexto do próprio `planDay`, com a convenção da ocupação só para a lacuna das janelas isoladas. Dele saem `A`, `T`, `P`, `D` e `w`.

**O que a sonda confere:**
1. `H(C') ≥ H(C)`;
2. o dia civil: `A_d + (m_d − parte depois da meia-noite) ≤ 1.440`, fora do dia seguinte a uma jornada reduzida (a exceção do §6);
3. nenhuma janela cortada num dia que segue a rotina;
4. `routineMinutes − durações` igual ao `w` geométrico, que confere o oráculo;
5. `D ≥ 0`, e `D = 0` num dia que não segue a rotina;
6. os passos 1 a 5 da prova, dia a dia, entre C e C'.

| Sonda (SNAP) | Pares | Dias no dia civil | Dias com `D > 0` | Passos conferidos | Violações |
| --- | --- | --- | --- | --- | --- |
| `b02-r3` mix 60k, spine 40k, edge 40k, copy 30k e free 30k | 78.879 | 9.299.974 | 178.270 | — | **0** em tudo; máximo do dia civil: 1.440 |
| `b02-r3-passos` mix 50k, spine 40k, edge 30k e copy 20k | 58.332 | 6.855.920 | 170.934 | 3.493.099 dias (`δ > 0` em 260.023, `ΔT > 0` em 289.232) | **0** em tudo |

**Poder do gerador** (`b02-r3-poder.log`, `b02-r3-passos-poder.log`):

| Árvore | Amostras | Pares | Monotonia | Dia civil | Passos e oráculo |
| --- | --- | --- | --- | --- | --- |
| `d9b33cd1` | 4.000 | 4.000 | 381 | 4.490 | 12.622 janelas cortadas; oráculo diferente, por ser outro modelo |
| `b97806c4` | 6.000 | 2.163 | 1 | 19 | passo 5 falha em 2 dias reduzidos (a classe N01) |
| mutante U68 | 6.000 | 2.163 | 0 | 65 (na rodada de 4.000 amostras: 50, até 1.820 min num dia civil) | passo 4 falha em 5 dias |

**Tabelas §5 e §6 de `rotinas-matematica.md`.** As sondas `sondas/` da R1, rodadas na SNAP e na `d9b33cd1` (`r1-tabela5.log`), dão todos os números:
- 480 → 480 (antes 390);
- 26 dias ambíguos;
- borda: 44.640 → 44.640 no período e 44.280 no mês avulso (antes 42.840);
- teto: 7.200 → 7.440 (antes 6.240);
- jornada reduzida: 1.920 → 2.880;
- véspera reduzida: terça 1.440; com a véspera seguindo a rotina, 1.080; o mês de 3.120 para 3.360.

**Conclusão B02:** nenhum contraexemplo à monotonia nem ao dia civil de 24 h fora da exceção registrada. A exceção do §6, o dia seguinte a uma jornada reduzida, é a única. Na véspera de folga, ausência ou feriado não há trabalho no dia civil seguinte. Na alteração de escala, os minutos cabem no próprio dia. No primeiro dia do período, a véspera fica fora de `H`.

## 4. B03: a espera pela hora do servidor (M02)

**Código:** `useIncomeEstimateWith.ts`:
- `ISO_INSTANT` e `serverInstantMs` (`:72-73`);
- `serverNowMs`, o maior `generatedAt` das bases em uso (`:348-353`);
- `passedOnServer`, as escritas `bounded` com `at ≤ serverNowMs − waitMs` (`:356-363`);
- o efeito de `waitStarts`, que encerra pela hora do servidor ou pelo relógio da montagem e não arma relógio para as já encerradas (`:367-380`).

### 4.1 As horas do servidor são usadas com segurança

- **`generatedAt`:**
  - vem de `new Date()` no handler da callable, depois da transação do limite de frequência (`functions/src/reports/callables.ts:64-65`);
  - é usado como `now` em `executeGetFinancialReport` (`report.ts:206`), antes de ler as projeções (`readMonths`), e gravado como `now.toISOString()` (`report.ts:409`);
  - é, portanto, um limite inferior da hora em que a base leu a projeção.
- **`updatedAt` das desconsideradas:** `FieldValue.serverTimestamp()`, a hora de confirmação da escrita (`createTransaction.ts:271`; `mutateTransaction.ts:666`, `:828`, `:933`; `receivables/model.ts:469`).
- **Nenhum caminho do cliente fabrica `generatedAt`:** `officialApi.ts` devolve o dado da callable, e não há persistência do cache do React Query.
- **O regex estrito recusa os rótulos:** `Date.parse('s-1')` dá 2001, e o regex o descarta.
- **A diferença de relógio** entre Functions e Firestore é desprezível diante de 30 s. No Emulator, as duas horas vêm da mesma máquina.

### 4.2 Não encerra cedo demais além do limite (a)

- **O que a expiração pela hora do servidor exige.** Ela exige `G ≥ W + 30 s`. Então a base leu a projeção 30 s ou mais depois da escrita.
- **Se o gatilho já gravou o mês nesse momento:**
  - a base inclui a escrita;
  - a regra 3 (bases iguais à projeção confirmada) e a regra 4 dão uma combinação consistente, ou nada provado.
- **Para haver estado misto,** a projeção confirmada no aparelho precisa estar sem a escrita 30 s depois dela. Isso só acontece:
  - com o gatilho mais lento que 30 s, que é o limite (a);
  - ou, caso que já existia na `d7dabb10` com o relógio da montagem, com a escuta deste aparelho atrasada sem erro e uma base não relida. Exemplo: o "Tentar de novo" com o mês avulso falhando de novo. Isso é análise do código, sem sonda; é um caminho estreito.
- **As escritas sem espera nunca expiram:** criação, confirmação, anulação e estorno.
- **Conclusão:** não há classe nova. O §6(a) atribui o efeito só ao gatilho; o atraso da escuta é a mesma janela e não muda com M02.
- **Limiar conferido** (`sondas/r3-espera-servidor.test.ts`, mundo de teste da equipe com espera de 60 s):

| Árvore | N03 na produção (sessão 5 s depois da edição) | Base 59 s depois | Base 60 s depois |
| --- | --- | --- | --- |
| SNAP | `loading → R$10.560`, nenhum misto | ainda segura | encerra |
| `d7dabb10` | segura | segura | não encerra (tempo esgotado), o M02 original |
| mutante de 1 ms | `loading → 1026000`: **o misto do N03** | encerra cedo (`loading → 1056000`) | encerra |

### 4.3 Não prende a estimativa

- **A hora do servidor só acrescenta expirações:** o `OR` em `:373`.
- **Os relógios:** as escritas já encerradas saem dos relógios (`:375-376`).
- **Sem `generatedAt` válido,** vale o relógio da montagem, como antes.
- **Se `serverNowMs` diminuir,** caso que não ocorre com dados do servidor, a escrita volta ao relógio da montagem com o início original.
- **Sem laço de renderização:** `setExpired` só troca o conjunto quando o conteúdo muda.
- **Escuta caindo durante a espera:** dá o erro (`rev2-b03-gancho2-r3.log`).

### 4.4 Sem regressão

- **Testes de unidade:** 217/217 na SNAP.
- **Sondas de gancho das revisões 1 e 2:** linhas do tempo iguais nas duas árvores, SNAP e `d7dabb10` (`rev2-b03-gancho2-r3.log`, `rev1-b03-gancho-r3.log`):
  - `b01-parecer`: `loading → R$100`;
  - edição antes da primeira leitura: `loading → R$10560`;
  - escuta recusada: o erro;
  - N06: `R$10560 → R$10560(aviso) → R$10660`.
- **Os cenários R11-01, R11-02, R8-02, R10-02 e B01** passam pela regra 5 com escritas sem espera, ou sem escrita pendente. A expiração não os toca.
- **Mutantes da equipe U70 a U73** (reconstruídos por mim): mortos (`mut-u7*.log`).

## 5. Achados novos

### P01 — LOW — o limite de 30 s da espera pela hora do servidor não tem teste

- **Onde:**
  - `src/modules/work-time/useIncomeEstimateWith.ts:356-363` (`write.at … <= serverNowMs - waitMs`);
  - `tests/unit/work-time-consistency.test.ts:689-711`, o único teste com `serverClock = true`, em que a base sai no mesmo segundo da escrita;
  - `:220` (`serverClock: false` em todos os outros, inclusive N03 e N06, `:657-753`);
  - `docs/production/evidence/p5f1-r1/revisoes/respostas-revisao-2.md:29` ("o limite continua 30 s depois da escrita");
  - `mutantes.md:20` ("U69 a U71 cobrem a espera pela hora do servidor") e `:100` (U71 = limiar 0).
- **Mecanismo:**
  - Na produção, `generatedAt` é sempre ISO, então a espera do N03 depende desse limiar.
  - O teste do M02 só distingue limiar 0 de limiar acima de 61 s.
  - Os testes do N03 e do N06 usam rótulos (`s-1`), o que desliga a hora do servidor.
- **Reprodução:**
  - **Mutante** `revisao3/mut-m02-limiar-1ms` (`serverNowMs - waitMs` trocado por `serverNowMs - 1`): consistência 27/27, retenção 21/21 e guarda 17/17 (cópia completa) **passam**.
  - **A sonda** `revisao3/sondas/r3-espera-servidor.test.ts`, rodada nas três árvores (logs `r3-espera-servidor.*.log`):
    - no mutante, `not ok 4 … N03 com a hora do servidor das bases (produção): antes do gatilho, nenhuma estimativa (mostrados: loading → 1026000)` e `not ok 5 … 59 s: a espera ainda vale (mostrados: loading → 1056000)`;
    - na SNAP, 6/6;
    - na `d7dabb10`, só o caso de 60 s reprova, por tempo esgotado.
  - **Nenhum E2E cobre** a edição de valor de uma desconsiderada em outra sessão.
- **Efeito:**
  - O código está certo.
  - Uma regressão do limiar traria de volta o N03 (MEDIUM na revisão 1) sem nenhum teste reprovar.
- **Correção mínima:** acrescentar os três testes da sonda (`r3-espera-servidor.test.ts.tail`, que reusa o mundo do arquivo):
  - N03 com `serverClock`, 5 s depois;
  - 59 s com espera de 60 s: segura;
  - 60 s: encerra.
  - Opcional: ajustar o texto de U71 e da resposta ("U70 e U71 garantem a forma estrita": U71 é o limiar, não o formato).

### P02 — LOW — `VEREDITOS.md` afirma coisas falsas sobre o código e os testes revisados

- **Onde:**
  - `docs/production/evidence/p5f1-r1/VEREDITOS.md:5`: "O código e os testes dessa árvore são os da árvore `d7dabb10`, que a revisão independente 2 leu. As duas diferem só em `mutantes.md`.";
  - `:18`: "`mutantes.md`: 67/67 de unidade".
- **Fato** (`diff d7dabb10 6c459430`):
  - o código e os testes mudaram em 4 arquivos de `src/`, 4 testes de unidade e o E2E;
  - a rodada final de mutantes de unidade é 73/73 (`mutantes.md:11`, `mutantes-r1-rev2.log`).
  - Não são números finais pendentes: são afirmações sobre o que foi revisado.
- **Efeito:** um auditor entenderia que a revisão 2 leu o código final.
- **Correção mínima:** dizer que o código final é a `d7dabb10` mais as correções da revisão 2, lidas pela revisão 3, e trocar 67/67 por 73/73.

### P03 — INFO — "a espera não recomeça a cada montagem" vale só com bases geradas 30 s depois da escrita

- **Onde:**
  - `docs/production/DATA_MODEL.md:112` ("Os 30 s contam na hora do servidor … e não recomeçam a cada montagem");
  - `matriz-bloqueadores.md:43` ("M02: … e não recomeça a cada montagem").
  - O §5 de `consistencia-estimativa.md:102-103` e `respostas-revisao-2.md:27` dizem certo ("com bases geradas antes … conta no relógio da montagem").
- **Mecanismo:**
  - As bases têm `staleTime: Infinity` e `refetchOnMount: false` (`basisSync.ts:153`, `:159`).
  - Se elas foram geradas nos 30 s da edição sem efeito na renda (por exemplo, o app aberto logo depois de editar em outro aparelho), cada estimativa nova na mesma sessão espera 30 s de novo. A prévia de Configurações e o assistente são exemplos.
  - Isso dura até a base ser relida: projeção alterada, virada do mês, mutação nesta aba ou "Tentar de novo".
- **Reprodução** (`sondas/r3-remonta-cache.test.ts`, log `r3-remonta-cache.log`): mesma sessão, servidor 61 s depois, espera de 60 s: `{"serieRelida":0,"segundaMostrou":["loading"]}`.
- **Efeito:** fail-closed, sem número errado. É um custo de vivacidade bem mais raro que o da revisão 2.
- **Correção mínima:** ajustar as duas frases, por exemplo: "não recomeça a cada montagem quando as bases em uso foram geradas 30 s ou mais depois da escrita; com bases em cache geradas antes disso, conta no relógio de cada montagem até a base ser relida".

### P04 — INFO — os logs da revisão 2 não estão na árvore nem no pacote, e duas cópias de sonda não rodam como estão

- **Logs ausentes:**
  - `respostas-revisao-2.md:71` diz: "as sondas das duas revisões (…, `revisoes/sondas-revisao-2/`, com os logs da 2)".
  - `sondas-revisao-2/` só tem os 9 `.mts.txt`. Os logs (`b03-gancho2-snap.log`, `b02-mono-adv-snap.log` e outros) estão só em `<scratchpad>/p5f1r1/revisao2/sondas/`.
  - O `empacotar.sh` atual só copia `p5f1r1/logs/*.log`.
- **Sondas que não rodam:**
  - `sondas-revisao-1/b03-gancho.mts.txt:6` e `sondas-revisao-2/b03-gancho-rev1.mts.txt:6` trazem `const nm = '<scratchpad>/…/node_modules'`, efeito da troca de caminho.
  - Rodadas como estão, dão `ERR_MODULE_NOT_FOUND`. Com `` `${root}/node_modules` `` no lugar, rodam (`rev1-b03-gancho-r3.log`).
- **Correção mínima:** copiar os logs da revisão 2 para a árvore ou para o pacote e trocar a linha 6 das duas cópias, ou anotar no `LEIAME.md` que elas pedem o caminho de `node_modules`.

### P05 — INFO — o registro do M09 não está onde a resposta diz

- **Onde:** `respostas-revisao-2.md:79`: "Registrado (`rotinas-matematica.md` §2, RR-R1-02)".
- **Fato:**
  - O §2 (`:42-64`) diz até onde o conferidor olha, mas não registra que um mês mais antigo pode mostrar "horas sem cálculo seguro" no calendário de exceções de uma configuração aceita.
  - O RR-R1-02 está no relatório ou no plano, ainda pendentes.
- **Correção mínima:** uma frase no §2 ou no §6 (o efeito, o alcance e o teste do horizonte), ou a resposta apontando só o RR-R1-02.

### P06 — INFO — deslizes de notação na prova

- **`rotinas-matematica.md:115`:**
  - "(E1)" não está definido em lugar nenhum da árvore (busca em `docs/`, `src/` e `tests/`). Já vinha da versão anterior.
  - "Cada `−δ_d > 0`" tem o sinal trocado: o certo é "cada perda `δ_d > 0`".
- **Efeito:** nenhum na correção da prova (§3.1).
- **Correção mínima:** trocar "(E1)" por "(§3, Período)" e corrigir o sinal.

## 6. O que foi verificado e passou

### 6.1 Delta inteiro sobre `d9b33cd1`

- **Testes, sem enfraquecimento** (fora de `docs/`, 31 arquivos e 5.332 linhas de diff):
  - não há `skip`, `only`, `todo`, `fixme` nem `describe.skip`;
  - nenhuma mudança em `playwright.config.ts` nem em retries;
  - os `test.setTimeout` (180 a 360 s) e os `timeout: 30_000` novos seguem o padrão do arquivo, que já usava `test.setTimeout(300_000)` e `timeout: 30_000`;
  - o `package.json` só acrescenta `work-time-consistency.test.ts` ao script.
- **Asserções:** 41 linhas de asserção saíram e 404 entraram. Conferi as que saíram: todas foram trocadas por versões atualizadas ou mais fortes, pelo contrato novo de B01, B02 e B03:
  - a união sem piso;
  - a ambiguidade;
  - o texto do estorno, que deixou de dizer "sai duas vezes";
  - as assinaturas novas;
  - "só o estado misto e o certo", que virou "nenhum estado misto".
  - Depois da revisão 2, só o N08 virou laço nas duas ordens (as asserções de antes ficaram dentro), e houve as trocas de texto do M05.
- **Isolamento e escritas:**
  - a única leitura nova é `getDocsFromServer` na mesma consulta `transactions` do workspace-fonte (`transactions/api.ts:169`);
  - um campo novo, `updatedAt`, vem dos mesmos documentos da escuta (`reports/hooks.ts:79-86`);
  - não há `setDoc`, `updateDoc`, `addDoc`, `deleteDoc`, `writeBatch`, `runTransaction` nem `httpsCallable` novos em `src/`;
  - Rules, índices, `firebase.json` e `functions/src` não mudaram, salvo dois testes em `functions/`.
- **pt-BR:** os textos novos (`messages.ts:92`, `draft.ts:446`) e todos os do delta estão em pt-BR. O texto antigo do aviso sobrevive só em revisões históricas.
- **Interface, só o indispensável:**
  - o aviso `role="alert"` junto do botão de salvar e no editor de rotinas;
  - o "?" e "horas sem cálculo seguro" no calendário, com texto oculto acessível;
  - uma frase de ajuda.
  - Depois da revisão 2, só o texto do aviso mudou. Não há mudança de layout nem de navegação.

### 6.2 Documentos

- **`consistencia-estimativa.md`:**
  - o §2 (espera pela hora do servidor e pelo relógio da montagem) confere com o código;
  - o §6 (direção do erro) confere com as sondas.
- **`rotinas-matematica.md`:** §§3 e 4 corretos (salvo P06); §§5 e 6 conferidos com as sondas.
- **`mutantes.md`:** os números conferem com o log (73/73) e com a base de arquivos.
- **Respostas às revisões 1 e 2:** conferem com o código, salvo P04 e P05.

### 6.3 Não reexecutado (proibido nesta revisão)

- Emulator (Rules e integração);
- Playwright (os E2E, inclusive as asserções do M05);
- `verify:all`;
- a bateria completa de mutantes da equipe. Rodei U68 e U70 a U73, reconstruídos, mais o meu.

## 7. Sondas e cópias desta revisão (todas em `<scratchpad>/p5f1r1/revisao3/`)

| Arquivo | Mostra |
| --- | --- |
| `sondas/b02-r3.mts <raiz> [amostras] [semente] [modo] [conferidor]` | B02: monotonia, dia civil, janelas cortadas, oráculo e `D` |
| `sondas/b02-r3-passos.mts` (mesmos argumentos) | B02: o mesmo, mais os passos 1 a 5 da prova, dia a dia |
| `sondas/b02-r3-*.log`, `b02-r3-passos-*.log` | As rodadas da §3.2 |
| `sondas/b01-pares-r3.mts <raiz> [amostras] [semente]` | M07 |
| `sondas/r3-espera-servidor.test.ts` (e `.tail`, com os 3 testes propostos) | M02 e P01 |
| `sondas/r3-remonta-cache.test.ts` | P03 |
| `sondas/rev2-b03-gancho2.mts`, `sondas/rev2-b03-gancho-rev1.mts` (caminho corrigido), `sondas/rev2-b02-custo.mts`, `sondas/r1/*.mts` | As sondas das revisões e da R1, rodadas de novo |
| `h-d7dabb10-testes-6c459430/` | O `src/` da `d7dabb10` com os testes da SNAP ("antes") |
| `mut-m02-limiar-1ms/`, `mut-m02-limiar-1ms-completa/`, `mut-u68-windowpart/`, `mut-u70/` a `mut-u73/` | Mutantes |
| `copia-limpa-6c459430/` | A cópia limpa da SNAP usada pelas sondas de teste |
| `unit-snap.log`, `antes-d7-*.log`, `mut-*.log`, `tsc-snap.log` | Testes, "antes", mutantes e typecheck |

Comando: `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON <sonda> <raiz> …`. Testes: `--test <arquivo>`, de dentro da cópia.

## 8. SHA-256 (16 hex) dos arquivos de `src/` revisados (SNAP = `6c459430`)

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
e65cbc3fcc9c847b src/modules/work-time/draft.ts
141737af818e6b12 src/modules/work-time/estimate.ts
fab816fcc3e8c2e4 src/modules/work-time/incomeBasis.ts
02edf8faf493f329 src/modules/work-time/messages.ts
5aca4a3ecd2d0f4b src/modules/work-time/receivableReversal.ts
832694d58f2ed613 src/modules/work-time/useIncomeEstimateWith.ts
```

**Mudaram desde a `d7dabb10`:**

| Arquivo | Antes (revisão 2) | Agora |
| --- | --- | --- |
| `draft.ts` | `a83d124898b2b305` | `e65cbc3fcc9c847b` |
| `messages.ts` | `63cabc7bf76b2259` | `02edf8faf493f329` |
| `receivableReversal.ts` | `e716ab22782874d5` | `5aca4a3ecd2d0f4b` |
| `useIncomeEstimateWith.ts` | `267623503069b3f1` | `832694d58f2ed613` |

Os outros 15 conferem com a revisão 2 (`calendar.ts` `b5b62b6fe3ace0e0`).
